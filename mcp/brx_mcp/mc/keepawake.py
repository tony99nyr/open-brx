"""Keep the MC laptop awake while MC runs (F595, F660).

F595 (field 2026-10-17): the MC MacBook slept through every timed whistle. The phones' results then waited for it to
wake: 355 of the 540 s of post-whistle wait measured. F660: any laptop that runs `./start.sh` or `start.cmd` gets the
same hold, with no step to remember. MC starts one holder at startup, and the holder ends with MC:

- macOS: `caffeinate -dimsu -w <pid>`. `-w` ends it when MC's pid exits. `-s` holds only on AC power, and a closed
  lid sleeps the Mac anyway, so MC prints a warning on battery.
- Windows (native Python): `SetThreadExecutionState(ES_CONTINUOUS | SYSTEM | DISPLAY [| AWAYMODE])` from MC's own
  thread through ctypes. Windows drops the request when MC's process exits; the exit path also clears it.
- WSL: Linux does not sleep, Windows does. MC starts `powershell.exe`, which makes the same call and then reads its
  stdin to the end. MC holds the write end of that pipe, so the holder gets EOF and exits when MC exits or dies. The
  script goes in `-EncodedCommand` (argv), because env vars do not cross from WSL to Windows.
- Linux: `systemd-inhibit --what=sleep:idle … cat`, with `cat` on the same stdin pipe as the WSL holder.

The display hold matters as much as the system hold: on Windows Modern Standby, a screen that turns off can take the
Wi-Fi with it, and the phones lose MC. Skipped for an --ephemeral run (most tests and every demo e2e). Never fatal:
every branch prints one `keep-awake:` line that says what holds the laptop awake, or why nothing does.
"""
from __future__ import annotations

import atexit
import base64
import logging
import os
import shutil
import subprocess
import sys
import threading
from typing import Any, Callable

log = logging.getLogger("brx.mc.keepawake")

ES_CONTINUOUS = 0x80000000
ES_SYSTEM_REQUIRED = 0x00000001
ES_DISPLAY_REQUIRED = 0x00000002
ES_AWAYMODE_REQUIRED = 0x00000040
HOLD = ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
WIN_POWERSHELL = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"

# The WSL holder. It prints one status line, then blocks on stdin until MC closes the pipe (or dies).
_PS_HOLDER = f"""
Add-Type -Namespace BrxKeepAwake -Name K -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
$s = 'held+away'
if ([BrxKeepAwake.K]::SetThreadExecutionState([uint32]{HOLD | ES_AWAYMODE_REQUIRED}) -eq 0) {{
  $s = 'held'
  if ([BrxKeepAwake.K]::SetThreadExecutionState([uint32]{HOLD}) -eq 0) {{ $s = 'failed' }}
}}
[Console]::Out.WriteLine($s)
[Console]::Out.Flush()
if ($s -eq 'failed') {{ exit 1 }}
$null = [Console]::In.ReadToEnd()
"""


def _say(msg: str) -> None:
    print(f"  keep-awake: {msg}", flush=True)


class Hold:
    """What `start` returns: `release()` ends the hold. Safe to call twice."""

    def __init__(self, how: str, release: Callable[[], None], proc: Any = None):
        self.how, self.proc, self._release, self.released = how, proc, release, False

    def release(self) -> None:
        if not self.released:
            self.released = True
            try:
                self._release()
            except Exception as e:   # the exit path never raises
                log.debug("keep-awake release: %s", e)


def is_wsl(read_osrelease: Callable[[], str] | None = None) -> bool:
    try:
        text = read_osrelease() if read_osrelease else open("/proc/sys/kernel/osrelease", encoding="utf-8").read()
    except OSError:
        return False
    return "microsoft" in text.lower()


def start(*, ephemeral: bool, platform: str = sys.platform, which: Callable[[str], str | None] = shutil.which,
          popen: Callable[..., Any] = subprocess.Popen, pid: int | None = None,
          register: Callable[..., Any] = atexit.register, run: Callable[..., Any] = subprocess.run,
          kernel32: Any = None, wsl: bool | None = None, exists: Callable[[str], bool] = os.path.exists,
          watch: Callable[[Hold, Callable[[], None]], None] | None = None) -> Hold | None:
    """Start the holder for this platform. Returns the Hold, or None when nothing holds the laptop awake."""
    if ephemeral:
        _say("off for an --ephemeral run")
        return None
    watch = watch or _watch
    try:
        if platform == "darwin":
            hold = _mac(which, popen, pid or os.getpid(), run)
        elif platform == "win32":
            hold = _windows(kernel32, run)
        elif platform.startswith("linux") and (is_wsl() if wsl is None else wsl):
            hold = _wsl(which, popen, exists, watch)
        elif platform.startswith("linux"):
            hold = _linux(which, popen, watch)
        else:
            _say(f"not supported on {platform} -- the laptop may sleep during a match")
            return None
    except Exception as e:   # never fatal
        _say(f"did not start ({e}) -- the laptop may sleep during a match")
        return None
    if hold is not None:
        register(stop, hold)
    return hold


def stop(hold: Any) -> None:
    """MC's exit path. Each holder also ends on its own when MC's process is gone."""
    if hold is not None:
        hold.release()


# ---- macOS ----

def _mac(which, popen, pid, run) -> Hold | None:
    exe = which("caffeinate")
    if not exe:
        _say("caffeinate not found -- the Mac may sleep during a match")
        return None
    try:
        proc = popen([exe, "-dimsu", "-w", str(pid)],
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError as e:
        _say(f"caffeinate did not start ({e}) -- the Mac may sleep during a match")
        return None
    _say("caffeinate holds the Mac awake while MC runs (keep the lid open: a closed lid still sleeps it)")
    if _mac_on_battery(run):
        _say("WARNING the Mac is on battery: plug it in. On battery the Mac can still sleep (caffeinate -s needs AC)")
    log.info("keep-awake: caffeinate pid %s", getattr(proc, "pid", "?"))
    return Hold("caffeinate", lambda: _end(proc), proc)


def _mac_on_battery(run) -> bool:
    try:
        out = run(["pmset", "-g", "batt"], capture_output=True, text=True, timeout=3).stdout or ""
    except (OSError, subprocess.SubprocessError):
        return False
    return "Battery Power" in out


# ---- Windows (native Python) ----

def _windows(kernel32, run) -> Hold | None:
    if kernel32 is None:
        import ctypes
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)   # type: ignore[attr-defined]
        kernel32.SetThreadExecutionState.argtypes = [ctypes.c_uint32]
        kernel32.SetThreadExecutionState.restype = ctypes.c_uint32
    how = "system + display + away mode"
    if not kernel32.SetThreadExecutionState(HOLD | ES_AWAYMODE_REQUIRED):
        how = "system + display"
        if not kernel32.SetThreadExecutionState(HOLD):
            _say("SetThreadExecutionState failed -- Windows may sleep during a match")
            return None
    _say(f"Windows held awake while MC runs (SetThreadExecutionState: {how})")
    if _windows_on_battery(kernel32):
        _say("WARNING the laptop is on battery: plug it in. Windows can cut Wi-Fi power on battery")
    return Hold("SetThreadExecutionState", lambda: kernel32.SetThreadExecutionState(ES_CONTINUOUS))


def _windows_on_battery(kernel32) -> bool:
    try:
        import ctypes

        class _Status(ctypes.Structure):
            _fields_ = [("ACLineStatus", ctypes.c_ubyte), ("BatteryFlag", ctypes.c_ubyte),
                        ("BatteryLifePercent", ctypes.c_ubyte), ("SystemStatusFlag", ctypes.c_ubyte),
                        ("BatteryLifeTime", ctypes.c_ulong), ("BatteryFullLifeTime", ctypes.c_ulong)]
        st = _Status()
        if not kernel32.GetSystemPowerStatus(ctypes.byref(st)):
            return False
        return st.ACLineStatus == 0   # 0 offline, 1 online, 255 unknown
    except Exception:
        return False


# ---- WSL and Linux: a child on a stdin pipe that MC holds ----

def _wsl(which, popen, exists, watch) -> Hold | None:
    exe = which("powershell.exe") or (WIN_POWERSHELL if exists(WIN_POWERSHELL) else None)
    if not exe:
        _say("powershell.exe not found (WSL interop off?) -- Windows may sleep during a match")
        return None
    script = base64.b64encode(_PS_HOLDER.encode("utf-16-le")).decode("ascii")
    try:
        proc = popen([exe, "-NoProfile", "-NonInteractive", "-EncodedCommand", script],
                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    except OSError as e:
        _say(f"powershell.exe did not start ({e}) -- Windows may sleep during a match")
        return None
    _say("a Windows holder (powershell.exe) holds Windows awake while MC runs")
    hold = Hold("powershell.exe", lambda: _end(proc), proc)

    def check() -> None:
        line = (proc.stdout.readline() if proc.stdout else "").strip()
        if line.startswith("held"):
            log.info("keep-awake: Windows holder %s (pid %s)", line, getattr(proc, "pid", "?"))
        elif not hold.released:
            _say(f"WARNING the Windows holder did not hold ({line or 'it exited'}) -- Windows may sleep")
    watch(hold, check)
    return hold


def _linux(which, popen, watch) -> Hold | None:
    exe = which("systemd-inhibit")
    cat = which("cat")
    if not exe or not cat:
        _say("systemd-inhibit not found -- skipped, so Linux may sleep during a match")
        return None
    try:
        proc = popen([exe, "--what=sleep:idle", "--who=Open BRX Mission Control",
                      "--why=A match may be running", "--mode=block", cat],
                     stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    except OSError as e:
        _say(f"systemd-inhibit did not start ({e}) -- Linux may sleep during a match")
        return None
    _say("systemd-inhibit holds off sleep and idle while MC runs")
    hold = Hold("systemd-inhibit", lambda: _end(proc), proc)

    def check() -> None:
        code = proc.wait()
        if not hold.released:
            err = (proc.stderr.read() if proc.stderr else "").strip().splitlines()
            _say(f"WARNING systemd-inhibit exited ({code}{': ' + err[-1] if err else ''}) -- Linux may sleep")
    watch(hold, check)
    return hold


def _watch(hold: Hold, check: Callable[[], None]) -> None:
    threading.Thread(target=check, name=f"keep-awake-{hold.how}", daemon=True).start()


def _end(proc: Any) -> None:
    """Close the holder's stdin (its EOF is the normal end), then make sure it is gone."""
    if proc is None or proc.poll() is not None:
        return
    stdin = getattr(proc, "stdin", None)
    if stdin is not None:
        try:
            stdin.close()
        except OSError:
            pass
        try:
            proc.wait(timeout=1)
            return
        except subprocess.TimeoutExpired:
            pass
    try:
        proc.terminate()
    except OSError:
        pass
