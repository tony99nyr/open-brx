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
import logging
import re
import shutil
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
                 timeout_s: float = START_TIMEOUT_S, term_grace_s: float = TERM_GRACE_S):
        self.binary = binary
        self.ws_port = ws_port
        self.timeout_s = timeout_s
        self.term_grace_s = term_grace_s
        self._spawn = spawn or self._default_spawn
        self._which = which or shutil.which
        # A28.1: `available` is decided at LAUNCH, not per call — the UI shows the install line when it is
        # false and never hides the control.
        self.available = bool(self._which(self.binary))
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
        proc, self._proc = self._proc, None
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
        task, self._task = self._task, None
        if task is not None and not task.done():
            with contextlib.suppress(Exception):
                await asyncio.wait_for(asyncio.shield(task), timeout=self.term_grace_s)
        if self.provider != "manual":
            self._set("off", None, None, None)

    # ---------------- the child ----------------
    def argv(self, ws_port: int) -> list[str]:
        return [self.binary, "tunnel", "--url", f"http://127.0.0.1:{ws_port}", "--no-autoupdate"]

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
        self._proc = proc
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
                        self._fail(f"no tunnel URL within {self.timeout_s:.0f}s: "
                                   f"{self._last_line or 'no output'}")
                        self._proc = None
                        with contextlib.suppress(Exception):
                            proc.kill()
                        with contextlib.suppress(Exception):
                            await asyncio.wait_for(proc.wait(), timeout=self.term_grace_s)
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
                if m and self.status != "up":
                    host = m.group(0).split("//", 1)[1]
                    self._set("up", f"wss://{host}{WS_PATH}", None, "cloudflared")
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("tunnel reader failed")
        rc = None
        with contextlib.suppress(Exception):
            rc = await asyncio.wait_for(proc.wait(), timeout=self.term_grace_s)
        if self._stopping:
            self._set("off", None, None, None)
        else:
            # A28.1: the process exiting at ANY time is an error, whether or not we ever saw a URL.
            self._fail(f"cloudflared exited ({rc}): {self._last_line or 'no output'}")
