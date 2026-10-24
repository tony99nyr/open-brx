"""F595 item 1 (field 2026-10-17): the MC MacBook slept through every timed whistle, so the phones' results waited for it
to wake (355 of the 540 s of post-whistle wait measured). MC now holds the Mac awake itself with `caffeinate`, on macOS
only, never for an --ephemeral run (the tests, the demo harness) and never fatally."""
from brx_mcp.mc import keepawake


class FakeProc:
    def __init__(self):
        self.terminated = False

    def poll(self):
        return 0 if self.terminated else None

    def terminate(self):
        self.terminated = True


def _run(platform="darwin", ephemeral=False, exe="/usr/bin/caffeinate", fail=False):
    calls = []

    def popen(argv, **kw):
        calls.append(argv)
        if fail:
            raise OSError("no such file")
        return FakeProc()
    proc = keepawake.start(ephemeral=ephemeral, platform=platform, which=lambda _n: exe, popen=popen, pid=4242,
                           register=lambda *_a: None)
    return proc, calls


def test_on_macos_mc_holds_the_mac_awake_until_its_own_pid_exits():
    proc, calls = _run()
    assert calls == [["/usr/bin/caffeinate", "-dimsu", "-w", "4242"]], calls
    assert proc is not None
    keepawake.stop(proc)
    assert proc.terminated, "the exit path ends it (and -w ends it if MC dies first)"


def test_off_on_other_platforms_on_an_ephemeral_run_and_without_caffeinate():
    assert _run(platform="linux") == (None, [])
    assert _run(platform="win32") == (None, [])
    assert _run(ephemeral=True) == (None, []), "the tests and the demo harness run --ephemeral"
    assert _run(exe=None) == (None, [])


def test_a_failed_spawn_never_stops_mc():
    proc, calls = _run(fail=True)
    assert proc is None and len(calls) == 1


def test_mc_main_calls_it_once_with_the_ephemeral_flag():
    src = (keepawake.__file__.rsplit("/", 1)[0] + "/__main__.py")
    text = open(src, encoding="utf-8").read()
    assert text.count("keepawake.start(") == 1, "one call site in MC's own startup"
    assert "keepawake.start(ephemeral=args.ephemeral" in text


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("ok")
