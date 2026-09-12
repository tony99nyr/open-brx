"""A28.1 — the public node socket: MC's cloudflared child process (contracts.md §5d).

`Tunnel` owns ONE optional child process whose whole job is to make the **node WebSocket port**
(never the operator API) reachable from the internet, so a phone with a data plan can hold its
socket to MC from anywhere in the park:

    tunnel = Tunnel()                       # `available` = cloudflared found on PATH at construction
    tunnel.on_change(session._tunnel_changed)
    tunnel.start(ws_port)                   # -> status "starting", then "up" with a wss:// URL
    await tunnel.stop()                     # -> "off"

The quick tunnel (`cloudflared tunnel --url …`) needs **no account, no domain and no login** — the
one path a stranger who cloned the repo can use — and its hostname is random per start, which is why
the node keeps the LAN URL too (A28.2). Everything here is opt-in and additive: with the tunnel off,
nothing about the LAN path changes.

`provider:"manual"` (`--public-url wss://…`) is the escape hatch for a named Cloudflare tunnel, a
Tailscale Funnel or a port forward: MC did not start it, so MC will not stop it (`POST /api/tunnel`
answers 409).

The binary, the spawn and the timeouts are all injectable so the tests drive a fake child process —
they need neither cloudflared nor the internet.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import pathlib
import re
import shutil
import signal
import subprocess
import time
from typing import Any, Awaitable, Callable

log = logging.getLogger("brx.mc.tunnel")

# The quick tunnel announces itself on one line of its output, e.g.
#   |  https://polite-cotton-pine-nm.trycloudflare.com                                            |
QUICK_TUNNEL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")

START_TIMEOUT_S = 20.0      # A28.1: no starting→up inside this → status "error"
TERM_GRACE_S = 3.0          # terminate, then kill
WS_PATH = "/ws"

INSTALL_HINT = ("cloudflared is not on PATH — install it (macOS: `brew install cloudflared`; "
                "Linux: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/"
                "downloads/) and restart Mission Control")


class TunnelError(RuntimeError):
    """A refusal the API renders verbatim. `status` is the HTTP code (409 for every case A28.1 names)."""

    def __init__(self, msg: str, status: int = 409):
        super().__init__(msg)
        self.status = status


class Tunnel:
    """The `lan.public` block and the process behind it."""

    def __init__(self, *, binary: str = "cloudflared", public_url: str | None = None,
                 ws_port: int = 0, spawn: Callable[[list[str]], Awaitable[Any]] | None = None,
                 which: Callable[[str], str | None] | None = None,
                 timeout_s: float = START_TIMEOUT_S, term_grace_s: float = TERM_GRACE_S,
                 pid_dir: "pathlib.Path | None" = None):
        self.binary = binary
        self.ws_port = ws_port
        self.timeout_s = timeout_s
        self.term_grace_s = term_grace_s
        self._spawn = spawn or self._default_spawn
        self._which = which or shutil.which
        # A28.1: `available` is decided at LAUNCH, not per call — the UI shows the install line when it is
        # false and never hides the control. The resolved ABSOLUTE path is what we spawn: a bare name is
        # resolved again by the OS at exec time, against whatever PATH we inherited.
        self._resolved = self._which(self.binary)
        self.available = bool(self._resolved)
        self._pid_dir = pid_dir if pid_dir is not None else (pathlib.Path.home() / ".brx-mcp")
        self._pid_owned = False
        self._orphan_pid: int | None = None   # an orphan we could not kill; keeps `armed` True
        self._listeners: list[Callable[[dict], None]] = []
        self._proc: Any = None
        self._task: asyncio.Task | None = None
        self._stopping = False
        self._last_line = ""
        if public_url:
            self.status, self.provider, self.ws_url, self.error = "up", "manual", str(public_url), None
        else:
            self.status, self.provider, self.ws_url, self.error = "off", None, None, None

    # ---------------- the public block ----------------
    def public(self) -> dict[str, Any]:
        """`State.lan.public` (A28.1). `error` is present only when there is one."""
        out: dict[str, Any] = {"ws_url": self.ws_url, "status": self.status,
                               "provider": self.provider, "available": self.available}
        if self.error:
            out["error"] = self.error
        return out

    def on_change(self, cb: Callable[[dict], None]) -> None:
        self._listeners.append(cb)

    @property
    def stoppable(self) -> bool:
        """`--public-url` is not MC's to stop (A28.1)."""
        return self.provider != "manual"

    def _owns(self, proc) -> bool:
        """Is `proc` still THE child? Every mutation `_run` makes is guarded on this: a `_run` whose
        process has been superseded must report, but never write."""
        return self._proc is proc

    @property
    def armed(self) -> bool:
        """Is there a public path into the node socket RIGHT NOW? This, not `status`, is what gates the
        join secret (A28.2).

        The two must not be the same question. `status` is what we have managed to read off the child's
        stdout; the child is what actually routes. They come apart in the obvious way: cloudflared's
        stdout closes (a log rotation, a pipe error, anything our reader cannot parse) while the process
        keeps serving the same hostname. Arming the gate on `status == "up"` meant that the moment we
        stopped being able to READ the child, we stopped asking strangers for the secret — while the
        hostname they had was still live. So the question is ownership of a process we have not
        confirmed dead, plus the manual provider, whose URL is up by assertion."""
        if self.provider == "manual":
            return True
        if self._orphan_pid is not None:
            return True                 # an orphan we could not kill is still a public path (see reap_orphan)
        proc = self._proc
        return proc is not None and proc.returncode is None

    def _emit(self) -> None:
        pub = self.public()
        for cb in list(self._listeners):
            try:
                cb(dict(pub))
            except Exception:          # a listener must never take the tunnel (or MC) down
                log.exception("tunnel on_change listener raised")

    def _set(self, status: str, ws_url: str | None, error: str | None, provider: str | None) -> None:
        if (status, ws_url, error, provider) == (self.status, self.ws_url, self.error, self.provider):
            return                      # no-op transitions must not re-render the QR or re-broadcast `join`
        self.status, self.ws_url, self.error, self.provider = status, ws_url, error, provider
        log.info("tunnel %s%s", status, f" {ws_url}" if ws_url else (f" ({error})" if error else ""))
        self._emit()

    def _fail(self, why: str) -> None:
        self._set("error", None, why, self.provider or "cloudflared")

    # ---------------- lifecycle ----------------
    def start(self, ws_port: int | None = None, loop: asyncio.AbstractEventLoop | None = None) -> dict:
        """Spawn the child (or no-op when one is already starting/up). Returns the public block at once —
        `up` arrives later, through `on_change`. Raises `TunnelError` for the two 409 cases."""
        if not self.stoppable:
            raise TunnelError("this MC was started with --public-url (provider: manual) — the tunnel is not "
                              "MC's to start or stop")
        if not self.available:
            raise TunnelError(INSTALL_HINT)
        if self.status in ("starting", "up"):
            return self.public()        # idempotent (API.md: a no-op 200)
        port = int(ws_port or self.ws_port or 0)
        if port <= 0:
            raise TunnelError("the node WebSocket port is not bound yet — try again once MC has started")
        self.ws_port = port
        self._orphan_pid = None        # an explicit start supersedes an un-killable orphan latch
        self._stopping = False
        self._last_line = ""
        self._set("starting", None, None, "cloudflared")
        if loop is None:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = asyncio.get_event_loop()
        self._task = loop.create_task(self._run(port))
        return self.public()

    async def stop(self) -> dict:
        if not self.stoppable:
            raise TunnelError("this MC was started with --public-url (provider: manual) — the tunnel is not "
                              "MC's to start or stop")
        await self.shutdown()
        return self.public()

    async def shutdown(self) -> None:
        """Kill the child if we own one and settle on `off`. Never raises — MC's own shutdown path calls it."""
        self._stopping = True
        self._orphan_pid = None        # an explicit stop supersedes the latch too
        # `self._proc` is NOT released until the child is confirmed dead: `armed` reads it, and a gate
        # that comes off while the process is still routing is the bug this whole method exists around.
        proc = self._proc
        if proc is not None and proc.returncode is None:
            with contextlib.suppress(Exception):
                proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=self.term_grace_s)
            except Exception:               # timed out, or the child was already reaped
                with contextlib.suppress(Exception):
                    proc.kill()
                with contextlib.suppress(Exception):
                    await asyncio.wait_for(proc.wait(), timeout=self.term_grace_s)
        if proc is not None and proc.returncode is None:
            # Terminated, killed, and still not reaped. We do NOT own-nothing here: `armed` reads
            # `_proc`, and releasing a process we could not confirm dead would drop the gate on a
            # cloudflared that may still be routing. `_run` releases it when `proc.wait()` returns.
            log.warning("cloudflared did not die within %.0fs — keeping the join gate ARMED until it does",
                        self.term_grace_s * 2)
        else:
            self._proc = None
            self._clear_pid()
        task, self._task = self._task, None
        if task is not None and not task.done():
            with contextlib.suppress(Exception):
                await asyncio.wait_for(asyncio.shield(task), timeout=self.term_grace_s)
        if self.provider != "manual":
            self._set("off", None, None, None)

    # ---------------- orphan reaping across an MC crash ----------------
    @property
    def pid_path(self) -> pathlib.Path:
        """One file PER WS PORT. A single shared name meant two Mission Controls on one laptop (a bench
        MC and a field MC, or a second one on another port) reaped each other's tunnel at launch."""
        return self._pid_dir / f"tunnel-{self.ws_port}.pid"

    def _write_pid(self, pid: int) -> None:
        try:
            self._pid_dir.mkdir(parents=True, exist_ok=True)
            # `owner` is THIS MC. A file whose owner is still alive belongs to a running Mission
            # Control, not to a crash, and must never be reaped out from under it.
            self.pid_path.write_text(json.dumps({"pid": pid, "owner": os.getpid(), "ws_port": self.ws_port}))
            self._pid_owned = True
        except Exception:          # a pid file we cannot write must never stop the tunnel
            log.debug("could not write %s", self.pid_path, exc_info=True)

    def _clear_pid(self) -> None:
        """Remove the pid file ONLY if this MC wrote it — never one another MC is relying on."""
        if not self._pid_owned:
            return
        self._pid_owned = False
        with contextlib.suppress(Exception):
            self.pid_path.unlink()

    def _read_pid_file(self) -> tuple[int, int | None] | None:
        """`(child_pid, owner_pid)` or None. Tolerates the bare-integer form."""
        try:
            raw = self.pid_path.read_text().strip()
        except Exception:
            return None
        try:
            d = json.loads(raw)
            return int(d["pid"]), (int(d["owner"]) if d.get("owner") is not None else None)
        except Exception:
            pass
        try:
            return int(raw), None
        except ValueError:
            with contextlib.suppress(Exception):
                self.pid_path.unlink()
            return None

    @staticmethod
    def _alive(pid: int) -> bool:
        try:
            os.kill(pid, 0)
            return True
        except Exception:
            return False

    @staticmethod
    def _cmdline(pid: int) -> str:
        """The process's command line, or "" when we cannot tell. `/proc` on Linux, `ps` everywhere else
        (the match-day machine is a MacBook, which has no `/proc`)."""
        try:
            return pathlib.Path(f"/proc/{pid}/cmdline").read_bytes().decode("utf-8", "replace")
        except Exception:
            pass
        try:
            out = subprocess.run(["ps", "-p", str(pid), "-o", "command="],
                                 capture_output=True, timeout=3, check=False)
            return out.stdout.decode("utf-8", "replace")
        except Exception:
            return ""

    def reap_orphan(self) -> int | None:
        """Kill a cloudflared we started and then died without stopping (a hard MC crash, a SIGKILL).

        The orphan keeps the random hostname pointed at this ws port, and the FRESH MC has no child, so
        `armed` would be False and the secret gate down — an internet-reachable node socket nobody is
        guarding. Returns the pid it killed, or None.

        Two safety catches. Pids are reused, so the process must still LOOK like cloudflared before
        anything is signalled. And the file's `owner` must be dead: a live owner means another Mission
        Control is running this tunnel on purpose.

        If the orphan survives SIGTERM and SIGKILL we do NOT pretend it is gone: `_orphan_pid` latches,
        `armed` stays True, and the join secret keeps being demanded until someone starts or stops the
        tunnel explicitly. An unguarded public socket is the worse failure."""
        if os.name == "nt":
            # `os.kill(pid, 0)` is TerminateProcess on Windows — the liveness probe would KILL the pid
            # before the cmdline check could veto it, and `_cmdline` has no /proc or ps to read anyway.
            log.info("orphan tunnel reaping is not supported on Windows — skipping (%s)", self.pid_path)
            return None
        got = self._read_pid_file()
        if got is None:
            return None
        pid, owner = got
        if pid <= 0:
            self._drop_pid_file()
            return None
        if owner is not None and owner != os.getpid() and self._alive(owner):
            log.info("tunnel pid file %s belongs to a LIVE Mission Control (pid %d) — leaving it alone",
                     self.pid_path, owner)
            return None
        if not self._alive(pid):
            self._drop_pid_file()
            return None
        if "cloudflared" not in self._cmdline(pid):
            log.info("stale tunnel pid %d is not cloudflared any more — leaving it alone", pid)
            self._drop_pid_file()
            return None
        log.warning("killing orphaned cloudflared pid %d from a previous Mission Control (%s)", pid, self.pid_path)
        for sig in (signal.SIGTERM, signal.SIGKILL):
            with contextlib.suppress(Exception):
                os.kill(pid, sig)
            deadline = time.monotonic() + self.term_grace_s
            while time.monotonic() < deadline:
                if not self._alive(pid):
                    self._orphan_pid = None
                    self._drop_pid_file()
                    return pid
                time.sleep(0.05)
        # Still there. Do not clear the file and do not lower the gate.
        self._orphan_pid = pid
        log.error("orphaned cloudflared pid %d SURVIVED SIGTERM and SIGKILL — it may still be routing "
                  "to this port, so the join secret stays REQUIRED. Kill it by hand.", pid)
        return None

    def _drop_pid_file(self) -> None:
        """Remove a pid file we have just judged stale (a different rule from `_clear_pid`, which only
        removes the one THIS MC wrote)."""
        self._pid_owned = False
        with contextlib.suppress(Exception):
            self.pid_path.unlink()

    # ---------------- the child ----------------
    def argv(self, ws_port: int) -> list[str]:
        return [self._resolved or self.binary, "tunnel", "--url",
                f"http://127.0.0.1:{ws_port}", "--no-autoupdate"]

    async def _default_spawn(self, cmd: list[str]):
        # stderr folded into stdout: cloudflared writes its banner (URL included) to stderr, and one
        # stream is one readline loop with no interleaving to reason about.
        return await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)

    async def _run(self, ws_port: int) -> None:
        cmd = self.argv(ws_port)
        try:
            proc = await self._spawn(cmd)
        except Exception as e:
            self._fail(f"could not start {self.binary}: {type(e).__name__}: {e}")
            return
        if self._stopping:
            # `stop()` ran while we were awaiting the spawn, so it had nothing to kill and has already
            # settled on `off`. Kill what we just made and claim nothing, or MC leaks a live cloudflared
            # it no longer believes in -- with the gate down, because `_proc` was never published.
            with contextlib.suppress(Exception):
                proc.kill()
            with contextlib.suppress(Exception):
                await proc.wait()
            log.info("tunnel stopped while the child was starting — killed it")
            return
        self._proc = proc
        self._write_pid(proc.pid)
        deadline = time.monotonic() + self.timeout_s
        try:
            while True:
                if self.status == "starting":
                    remaining = deadline - time.monotonic()
                    timed_out = remaining <= 0
                    if not timed_out:
                        try:
                            raw = await asyncio.wait_for(proc.stdout.readline(), timeout=remaining)
                        except asyncio.TimeoutError:
                            timed_out = True
                    if timed_out:
                        # Kill FIRST, then report. `armed` reads `proc.returncode`, so declaring the
                        # failure before the child is actually dead would disarm the gate while it was
                        # still running -- the same ordering bug as the reader-EOF path below.
                        with contextlib.suppress(Exception):
                            proc.kill()
                        with contextlib.suppress(Exception):
                            await proc.wait()
                        if self._owns(proc):
                            self._proc = None
                            self._clear_pid()
                            self._fail(f"no tunnel URL within {self.timeout_s:.0f}s: "
                                       f"{self._last_line or 'no output'}")
                        return
                else:
                    raw = await proc.stdout.readline()
                if not raw:
                    break                          # EOF — the child is gone
                line = raw.decode("utf-8", "replace").strip()
                if line:
                    self._last_line = line
                    log.debug("cloudflared: %s", line)
                m = QUICK_TUNNEL_RE.search(line)
                if m and self.status != "up" and self._owns(proc) and not self._stopping:
                    host = m.group(0).split("//", 1)[1]
                    self._set("up", f"wss://{host}{WS_PATH}", None, "cloudflared")
        except asyncio.CancelledError:
            raise
        except Exception:
            # We have stopped being able to READ the child. That says nothing about whether it is still
            # routing, so it must not change `status` and must not disarm the gate.
            log.exception("tunnel reader failed — the child may still be serving; waiting for it to exit")
        # Losing stdout is not the child dying. Wait on the PROCESS, with no timeout: a 3 s cap here was
        # the HIGH finding — it returned rc=None for a perfectly live cloudflared, `_fail()` ran, and the
        # secret gate came off a hostname that still worked.
        rc = None
        try:
            rc = await proc.wait()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("could not wait on the cloudflared child — leaving the tunnel status alone")
            return                       # `armed` still reads the live returncode; nothing is claimed
        if not self._owns(proc):
            # A LATER child is the live one now: our `shutdown()` timed out, kept `_proc`, and a fresh
            # `start()` replaced it. Nulling `_proc` here would disarm the gate on a cloudflared that is
            # routing right now, which is the same class of bug as the stdout-EOF one -- one step later.
            log.info("an old cloudflared (%s) exited; a newer child owns the tunnel", rc)
            return
        self._proc = None
        self._clear_pid()
        if self._stopping:
            self._set("off", None, None, None)
        else:
            # A28.1: the process exiting at ANY time is an error, whether or not we ever saw a URL.
            self._fail(f"cloudflared exited ({rc}): {self._last_line or 'no output'}")
