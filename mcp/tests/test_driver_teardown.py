"""F539 follow-up: `play`'s teardown ends hittable. `$CLEAR` wipes the `$SIR` table (F11), so a bench game that
signs off on MC's bare end leaves the next run a gun that ignores every hit."""
from _async import run
from brx_mcp import gameconfig as gc
from brx_mcp.gameconfig import GameConfig
from brx_mcp.modes.driver import GameDriver


def test_end_hittable_is_the_end_then_a_sir_table():
    frames = gc.end_hittable()
    gc.assert_sir_follows_clear(frames)
    assert frames == [*gc.END_SEQUENCE, *gc._SIR_TABLE], frames
    assert gc.end_hittable(["$SIR,0,0,,1,0,0,1,,*"]) == [*gc.END_SEQUENCE, "$SIR,0,0,,1,0,0,1,,*"]


def test_play_teardown_re_sends_each_guns_own_sir_table():
    sent = {}

    async def sender(pid, frame, reply_window_ms=None):
        sent.setdefault(pid, []).append(frame)
    cfg = GameConfig()
    d = GameDriver(cfg, {"p1": 1, "p2": 2}, sender, announce=lambda s: None)
    run(d.teardown())
    for pid in ("p1", "p2"):
        gc.assert_sir_follows_clear(sent[pid])
        rows = [f for f in cfg.setup_frames(d.player_ids[pid], team=int(d.players[pid])) if f.startswith("$SIR,")]
        assert rows == list(gc._SIR_TABLE), pid             # what `_arm_one` armed
        assert sent[pid] == gc.end_hittable(rows), (pid, sent[pid])


def test_play_teardown_still_ends_hittable_if_the_setup_frames_fail():
    sent = []

    async def sender(pid, frame, reply_window_ms=None):
        sent.append(frame)
    cfg = GameConfig()
    d = GameDriver(cfg, {"p1": 1}, sender, announce=lambda s: None)

    def broken(*a, **kw):
        raise AssertionError("bad config")
    cfg.setup_frames = broken
    run(d.teardown())
    assert sent == gc.end_hittable(), sent
