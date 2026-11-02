"""F595 + F660: MC holds the laptop awake on every platform that `./start.sh` and `start.cmd` support. Each branch
runs here with its OS calls mocked: macOS (caffeinate), Windows (SetThreadExecutionState through ctypes), WSL (a
powershell.exe holder on a stdin pipe) and Linux (systemd-inhibit). Every branch prints exactly one `keep-awake:`
line (plus a WARNING line for a laptop on battery or a holder that did not hold), never stops MC, and releases on
the exit path."""
import base64
import contextlib
import io
import pathlib
import subprocess

from brx_mcp.mc import keepawake as ka


class FakeStream:
    def __init__(self, text=""):
        self.text, self.closed = text, False

    def readline(self):
        return self.text

    def read(self):
        return self.text

    def close(self):
        self.closed = True


class FakeProc:
    def __init__(self, out="", err="", code=None, hang=False):
        self.terminated, self.code, self.hang = False, code, hang
        self.stdin, self.stdout, self.stderr = FakeStream(), FakeStream(out), FakeStream(err)

    def poll(self):
        if self.code is not None:
            return self.code
        ended = self.terminated or (self.stdin is not None and self.stdin.closed and not self.hang)
        return 0 if ended else None

    def wait(self, timeout=None):
        if self.code is not None:
            return self.code
        if self.hang:
            raise subprocess.TimeoutExpired("holder", timeout)
        return 0

    def terminate(self):
        self.terminated = True


class FakeKernel32:
    def __init__(self, away=True, works=True, on_ac=True):
        self.calls, self.away, self.works, self.on_ac = [], away, works, on_ac

    def SetThreadExecutionState(self, flags):
        self.calls.append(flags)
        if not self.works or (flags & ka.ES_AWAYMODE_REQUIRED and not self.away):
            return 0
        return ka.ES_CONTINUOUS

    def GetSystemPowerStatus(self, ref):
        ref._obj.ACLineStatus = 1 if self.on_ac else 0
        return 1


def _start(platform, *, exe="/bin/x", proc=None, fail=False, ephemeral=False, wsl=False, kernel32=None,
           batt="Now drawing from 'AC Power'", exists=False, check=True):
    calls, registered, out = [], [], io.StringIO()

    def popen(argv, **kw):
        calls.append((argv, kw))
        if fail:
            raise OSError("no such file")
        return proc or FakeProc()

    def run(argv, **kw):
        return subprocess.CompletedProcess(argv, 0, stdout=batt, stderr="")
    with contextlib.redirect_stdout(out):
        hold = ka.start(ephemeral=ephemeral, platform=platform, which=lambda _n: exe, popen=popen, pid=4242,
                        register=lambda *a: registered.append(a), run=run, kernel32=kernel32, wsl=wsl,
                        exists=lambda _p: exists, watch=lambda _h, fn: fn() if check else None)
    lines = [ln.strip() for ln in out.getvalue().splitlines()]
    assert lines and all(ln.startswith("keep-awake:") for ln in lines), lines
    assert len([ln for ln in lines if "WARNING" not in ln]) == 1, f"one status line per platform: {lines}"
    if hold is not None:
        assert registered == [(ka.stop, hold)], "the exit path releases the hold"
    return hold, calls, lines


# ---- macOS ----

def test_macos_caffeinate_holds_until_mcs_own_pid_exits():
    proc = FakeProc()
    proc.stdin = None   # caffeinate gets DEVNULL, so there is no pipe to close
    hold, calls, lines = _start("darwin", exe="/usr/bin/caffeinate", proc=proc)
    assert [c[0] for c in calls] == [["/usr/bin/caffeinate", "-dimsu", "-w", "4242"]], calls
    assert "keep the lid open" in lines[0] and len(lines) == 1, lines
    ka.stop(hold)
    assert hold.proc.terminated, "the exit path ends it (and -w ends it if MC dies first)"


def test_macos_on_battery_warns_that_the_mac_can_still_sleep():
    _hold, _calls, lines = _start("darwin", batt="Now drawing from 'Battery Power'\n -InternalBattery-0 80%")
    assert len(lines) == 2 and "WARNING" in lines[1] and "battery" in lines[1], lines


def test_macos_without_caffeinate_or_with_a_failed_spawn_carries_on():
    assert _start("darwin", exe=None)[:2] == (None, [])
    hold, calls, lines = _start("darwin", fail=True)
    assert hold is None and len(calls) == 1 and "did not start" in lines[0]


# ---- Windows (native) ----

def test_windows_holds_system_display_and_away_mode_then_clears_on_exit():
    k = FakeKernel32()
    hold, calls, lines = _start("win32", kernel32=k)
    assert calls == [], "no child process: MC's own thread holds the state"
    assert k.calls == [ka.ES_CONTINUOUS | ka.ES_SYSTEM_REQUIRED | ka.ES_DISPLAY_REQUIRED | ka.ES_AWAYMODE_REQUIRED]
    assert "away mode" in lines[0] and len(lines) == 1, lines
    ka.stop(hold)
    ka.stop(hold)
    assert k.calls[1:] == [ka.ES_CONTINUOUS], "release clears the request exactly once"


def test_windows_without_away_mode_falls_back_to_system_and_display():
    k = FakeKernel32(away=False)
    hold, _calls, lines = _start("win32", kernel32=k)
    assert hold is not None and k.calls[-1] == ka.HOLD and "away mode" not in lines[0], (k.calls, lines)


def test_windows_failed_call_and_battery():
    hold, _calls, lines = _start("win32", kernel32=FakeKernel32(works=False))
    assert hold is None and "failed" in lines[0]
    _hold, _calls, lines = _start("win32", kernel32=FakeKernel32(on_ac=False))
    assert len(lines) == 2 and "WARNING" in lines[1] and "Wi-Fi" in lines[1], lines


# ---- WSL ----

def test_wsl_starts_a_windows_holder_on_a_pipe_that_mc_holds():
    proc = FakeProc(out="held+away\n")
    hold, calls, lines = _start("linux", wsl=True, exe="/mnt/c/WINDOWS/powershell.exe", proc=proc)
    argv, kw = calls[0]
    assert argv[:4] == ["/mnt/c/WINDOWS/powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand"], argv
    assert kw["stdin"] == subprocess.PIPE, "MC holds the write end, so the holder gets EOF when MC dies"
    assert "env" not in kw, "env vars do not cross from WSL to Windows: everything goes in argv"
    script = base64.b64decode(argv[4]).decode("utf-16-le")
    assert "SetThreadExecutionState" in script and "ReadToEnd" in script, script
    assert str(ka.HOLD | ka.ES_AWAYMODE_REQUIRED) in script and str(ka.HOLD) in script
    assert len(lines) == 1 and "powershell.exe" in lines[0], lines
    ka.stop(hold)
    assert proc.stdin.closed and not proc.terminated, "closing stdin is the normal end"


def test_wsl_holder_that_hangs_is_terminated_and_one_that_fails_warns():
    proc = FakeProc(out="held\n", hang=True)
    hold, _calls, _lines = _start("linux", wsl=True, proc=proc)
    ka.stop(hold)
    assert proc.stdin.closed and proc.terminated
    _hold, _calls, lines = _start("linux", wsl=True, proc=FakeProc(out="failed\n"))
    assert len(lines) == 2 and "WARNING" in lines[1] and "failed" in lines[1], lines


def test_wsl_finds_powershell_by_path_or_says_why_not():
    _hold, calls, _lines = _start("linux", wsl=True, exe=None, exists=True, proc=FakeProc(out="held\n"))
    assert calls[0][0][0] == ka.WIN_POWERSHELL
    hold, calls, lines = _start("linux", wsl=True, exe=None, exists=False)
    assert hold is None and calls == [] and "not found" in lines[0]


def test_is_wsl_reads_the_kernel_release():
    assert ka.is_wsl(lambda: "6.6.87.2-microsoft-standard-WSL2")
    assert not ka.is_wsl(lambda: "6.8.0-45-generic")

    def missing():
        raise OSError
    assert not ka.is_wsl(missing)


# ---- Linux ----

def test_linux_systemd_inhibit_holds_sleep_and_idle_on_a_pipe():
    proc = FakeProc()
    hold, calls, lines = _start("linux", exe="/usr/bin/systemd-inhibit", proc=proc, check=False)
    argv, kw = calls[0]
    assert argv[0] == "/usr/bin/systemd-inhibit" and "--what=sleep:idle" in argv and argv[-1] == "/usr/bin/systemd-inhibit"
    assert kw["stdin"] == subprocess.PIPE
    assert len(lines) == 1 and "systemd-inhibit" in lines[0], lines
    ka.stop(hold)
    assert proc.stdin.closed


def test_linux_without_systemd_inhibit_skips_and_a_dead_inhibitor_warns():
    hold, calls, lines = _start("linux", exe=None)
    assert hold is None and calls == [] and "skipped" in lines[0]
    _hold, _calls, lines = _start("linux", proc=FakeProc(code=1, err="Failed to connect to bus"))
    assert len(lines) == 2 and "WARNING" in lines[1] and "connect to bus" in lines[1], lines


# ---- every platform ----

def test_ephemeral_runs_hold_nothing_and_say_so():
    for platform in ("darwin", "win32", "linux"):
        hold, calls, lines = _start(platform, ephemeral=True, kernel32=FakeKernel32())
        assert hold is None and calls == [] and "ephemeral" in lines[0]


def test_an_unexpected_error_or_platform_never_stops_mc():
    class Broken:
        def SetThreadExecutionState(self, _f):
            raise RuntimeError("boom")
    hold, _calls, lines = _start("win32", kernel32=Broken())
    assert hold is None and "boom" in lines[0]
    hold, _calls, lines = _start("freebsd14")
    assert hold is None and "not supported" in lines[0]


def test_mc_main_calls_it_once_with_the_ephemeral_flag():
    text = (pathlib.Path(ka.__file__).parent / "__main__.py").read_text(encoding="utf-8")
    assert text.count("keepawake.start(") == 1, "one call site in MC's own startup"
    assert "keepawake.start(ephemeral=args.ephemeral" in text


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("ok")
