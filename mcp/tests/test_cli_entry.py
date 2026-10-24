"""F539: the command-line tool's entry papercuts, found in bench A.7 (0.4.22).

(a) `deathmatch --help` took `--help` for a gun address and tried to connect.
(b) A real Ctrl-C printed a KeyboardInterrupt/CancelledError traceback after the teardown.
(c) A CLI game ended on `$CLEAR` with no `$SIR` after it (F11), so the next bench run found a gun that
    could not be hit.
"""
import contextlib
import io
import os
import pathlib
import select
import signal
import subprocess
import sys

from brx_mcp import __main__ as cli
from brx_mcp import gameconfig as gc
from _cli import _run_cli_game

MCP = pathlib.Path(__file__).resolve().parents[1]

# Every command whose first argument is a gun address (or a list of them) and that the CLI parses by hand.
ADDRESS_COMMANDS = ("identify", "listen", "probe", "startgame", "deathmatch", "arena", "fieldstart",
                    "fieldresults", "diag", "diagnose", "fleet", "diag-game", "reset", "rename", "soak",
                    "raw-bytes", "connect-metrics")


def _main(argv):
    """Run `cli.main` with `argv`; return (exit code, stdout, stderr). Any attempt to run a coroutine fails."""
    out, err = io.StringIO(), io.StringIO()
    real_argv, real_run = sys.argv, cli.asyncio.run

    def no_run(coro):
        coro.close()
        raise AssertionError(f"{argv} tried to run a gun coroutine")

    sys.argv = ["brx_mcp", *argv]
    cli.asyncio.run = no_run
    code = 0                              # main() returning is a clean exit
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            cli.main()
    except SystemExit as e:
        code = e.code
    finally:
        sys.argv, cli.asyncio.run = real_argv, real_run
    return code, out.getvalue(), err.getvalue()


def test_help_prints_the_usage_and_never_connects():
    for cmd in ADDRESS_COMMANDS + ("play", "sounds", "ir-capture", "ir-range", "usb-query", "enroll"):
        for argv in ([cmd, "--help"], [cmd, "-h"], [cmd, "AA:BB:CC:DD:EE:FF", "--help"]):
            if cmd == "play":
                argv = [cmd, "tdm", *argv[1:]]
            code, out, _ = _main(argv)
            assert code == 0, (argv, code)
            assert "python -m brx_mcp deathmatch" in out, argv     # the usage, on stdout


def test_help_alone_prints_the_usage():
    for argv in (["--help"], ["-h"], ["help"]):
        code, out, _ = _main(argv)
        assert code == 0 and "python -m brx_mcp deathmatch" in out, argv


def test_an_unknown_option_is_refused_before_connecting():
    for argv in (["deathmatch", "--minutes", "5"], ["deathmatch", "AA:BB:CC:DD:EE:FF", "--frobnicate"],
                 ["arena", "A0", "A1", "--teams"], ["startgame", "-x"], ["reset", "--force"],
                 ["play", "tdm", "AA:BB:CC:DD:EE:FF", "--venue=indoor"], ["identify", "-5oops"]):
        code, _, err = _main(argv)
        assert code == 2, (argv, code)
        assert "unknown option" in err, (argv, err)


def test_the_arm_options_still_parse():
    seen = {}
    real = cli._deathmatch

    async def fake(address, *a, venue, friendly_fire):
        seen.update(address=address, rest=a, venue=venue, ff=friendly_fire)

    cli._deathmatch = fake
    real_argv = sys.argv
    sys.argv = ["brx_mcp", "deathmatch", "AA:BB:CC:DD:EE:FF", "3", "--venue", "indoor", "--friendly-fire"]
    try:
        with contextlib.redirect_stderr(io.StringIO()):
            cli.main()
    finally:
        cli._deathmatch, sys.argv = real, real_argv
    assert seen == {"address": "AA:BB:CC:DD:EE:FF", "rest": (3, 15, 69, "primary"), "venue": "indoor",
                    "ff": True}, seen


# A real SIGINT in a child process: the game's teardown runs, then the tool exits 130 with one line and no
# traceback. The child swaps the deathmatch body for one that blocks, so no Bluetooth is involved.
_CHILD = r"""
import asyncio, sys
from brx_mcp import __main__ as cli

async def blocking(address, *a, **kw):
    try:
        print("READY", flush=True)
        await asyncio.sleep(30)
    finally:
        await asyncio.sleep(0)            # the teardown awaits, as the real one does
        print("--- ending game", flush=True)

cli._deathmatch = blocking
sys.argv = ["brx_mcp", "deathmatch", "AA:BB:CC:DD:EE:FF"]
cli.main()
print("FELL THROUGH", flush=True)
"""


def test_ctrl_c_runs_the_teardown_then_exits_cleanly():
    if sys.platform == "win32":           # select() cannot wait on a pipe there, and SIGINT is a console event
        return
    env = {**os.environ, "PYTHONPATH": str(MCP)}
    p = subprocess.Popen([sys.executable, "-c", _CHILD], cwd=str(MCP), env=env, text=True,
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        ready, _, _ = select.select([p.stdout], [], [], 20)      # bounded: a child that never starts fails
        assert ready and p.stdout.readline().strip() == "READY"
        p.send_signal(signal.SIGINT)
        out, err = p.communicate(timeout=20)
    finally:
        if p.poll() is None:
            p.kill()
            p.communicate()
    assert "--- ending game" in out, out
    assert "FELL THROUGH" not in out, out
    assert p.returncode == 130, (p.returncode, err)
    assert "Traceback" not in err and "KeyboardInterrupt" not in err and "CancelledError" not in err, err
    assert "interrupted" in err, err


def _head_sir(plan):
    return [f for f in plan.arm if f.startswith("$SIR,")]


def test_a_cli_game_ends_hittable():
    for mode in ("tdm", "ffa"):
        for venue in ("outdoor", "indoor"):
            plan = cli.arm_plan(mode, venue, volume=65)
            gc.assert_sir_follows_clear(plan.end)
            n = len(gc.END_SEQUENCE)
            assert plan.end[:n] == list(gc.END_SEQUENCE), plan.end      # MC's game-over end, unchanged
            assert plan.end[n:] == _head_sir(plan), plan.end            # then the table the arm wrote


def test_reset_leaves_the_gun_hittable():
    frames = cli.reset_frames()
    gc.assert_sir_follows_clear(frames)
    assert frames[:len(gc.END_SEQUENCE)] == list(gc.END_SEQUENCE), frames


def test_a_name_may_start_with_a_dash():
    seen = []
    real = cli._rename

    async def fake(address, name):
        seen.append((address, name))

    cli._rename = fake
    real_argv = sys.argv
    sys.argv = ["brx_mcp", "rename", "AA:BB:CC:DD:EE:FF", "-Ghost-"]
    try:
        cli.main()
    finally:
        cli._rename, sys.argv = real, real_argv
    assert seen == [("AA:BB:CC:DD:EE:FF", "-Ghost-")], seen


def test_a_second_ctrl_c_in_the_end_sequence_says_to_run_reset():
    real = cli._dispatch

    def interrupted(cmd, args):
        cli._ENDING.add("AA:BB:CC:DD:EE:FF")     # the end sequence started and never finished
        raise KeyboardInterrupt

    cli._dispatch = interrupted
    real_argv = sys.argv
    sys.argv = ["brx_mcp", "deathmatch", "AA:BB:CC:DD:EE:FF"]
    err = io.StringIO()
    try:
        with contextlib.redirect_stderr(err):
            cli.main()
        raise AssertionError("main() did not exit")
    except SystemExit as e:
        assert e.code == 130
    finally:
        cli._dispatch, sys.argv = real, real_argv
        cli._ENDING.clear()
    assert "python -m brx_mcp reset AA:BB:CC:DD:EE:FF" in err.getvalue(), err.getvalue()


def test_a_finished_end_sequence_leaves_nothing_pending():
    _run_cli_game(lambda: cli._deathmatch("AA", 1, 0, 65))
    _run_cli_game(lambda: cli._startgame("AA", 3, 0, 65))
    _run_cli_game(lambda: cli._arena(["A0", "A1"], 1, 0, 65))
    assert not cli._ENDING, cli._ENDING


def _ctrl_c_in_the_end(on_alias):
    """A hook that raises a Ctrl-C at `on_alias`'s first `$SIR` row after its `$STOP` (inside the end)."""
    stopped = set()

    def hook(alias, cmd):
        if cmd == "$STOP,*":
            stopped.add(alias)
        elif alias == on_alias and alias in stopped and cmd.startswith("$SIR,"):
            raise KeyboardInterrupt
    return hook


def test_a_ctrl_c_inside_the_end_leaves_the_gun_listed():
    for run, alias, want in ((lambda: cli._deathmatch("AA", 1, 0, 65), "cli", {"AA"}),
                             (lambda: cli._startgame("AA", 3, 0, 65), "cli", {"AA"}),
                             # gun p0's end is cut short, so p1's never starts: both are listed
                             (lambda: cli._arena(["A0", "A1"], 1, 0, 65), "p0", {"A0", "A1"})):
        try:
            _run_cli_game(run, hook=_ctrl_c_in_the_end(alias))
            raise AssertionError("the Ctrl-C did not reach the caller")
        except KeyboardInterrupt:
            pass
        assert cli._ENDING == want, cli._ENDING
        cli._ENDING.clear()


def test_reset_falls_back_when_the_compile_fails():
    real = cli.arm_plan

    def broken(*a, **kw):
        raise ValueError("no catalogue")

    cli.arm_plan = broken
    try:
        with contextlib.redirect_stderr(io.StringIO()):
            frames = cli.reset_frames()
    finally:
        cli.arm_plan = real
    gc.assert_sir_follows_clear(frames)
    assert frames[:len(gc.END_SEQUENCE)] == list(gc.END_SEQUENCE), frames


def test_a_link_lost_inside_the_end_says_to_run_reset():
    def hook(alias, cmd):
        if cmd == "$STOP,*":
            hook.stopped = True
        elif getattr(hook, "stopped", False) and cmd.startswith("$SIR,"):
            raise ConnectionError("link lost")
    for run in (lambda: cli._deathmatch("AA", 1, 0, 65), lambda: cli._startgame("AA", 3, 0, 65)):
        hook.stopped = False
        _, err = _run_cli_game(run, hook=hook)
        assert "Run: python -m brx_mcp reset AA" in err, err
        assert "hittable;" not in err, err             # startgame no longer claims the gun is hittable
        cli._ENDING.clear()
    assert not cli._ENDING


def test_an_interrupted_or_failed_reset_says_to_run_reset_again():
    try:
        _run_cli_game(lambda: cli._reset("AA"), hook=_ctrl_c_in_the_end("rst"))
        raise AssertionError("the Ctrl-C did not reach the caller")
    except KeyboardInterrupt:
        pass
    assert cli._ENDING == {"AA"}, cli._ENDING
    cli._ENDING.clear()

    def lost(alias, cmd):
        if cmd.startswith("$SIR,"):
            raise ConnectionError("link lost")
    _, err = _run_cli_game(lambda: cli._reset("AA"), hook=lost)
    assert "Run: python -m brx_mcp reset AA" in err, err
    cli._ENDING.clear()
    _run_cli_game(lambda: cli._reset("AA"))
    assert not cli._ENDING, cli._ENDING
