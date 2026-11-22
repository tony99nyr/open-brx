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


def test_play_teardown_re_sends_the_rows_that_gun_was_armed_with():
    sent = []

    async def sender(pid, frame, reply_window_ms=None):
        sent.append(frame)
    cfg = GameConfig()
    d = GameDriver(cfg, {"p1": 1}, sender, announce=lambda s: None)
    cfg.setup_frames = lambda *a, **kw: ["$CLEAR,*", "$SIR,15,0,,1,0,0,1,,*"]
    run(d.teardown())
    assert sent == gc.end_hittable(["$SIR,15,0,,1,0,0,1,,*"]), sent


def test_f685_a_cli_heal_plays_the_heal_line_because_t15_ships_empty():
    """F685: the CLI `$PSET` ships t15 empty, so the gun says nothing on a heal. The driver plays the default voice's
    `healed` line after a health grant. CONTROL: an armour-only grant plays no heal line."""
    from brx_mcp import voices
    from brx_mcp.modes.base import Heal
    sent = []

    async def sender(pid, frame, reply_window_ms=None):
        sent.append(frame)
    d = GameDriver(GameConfig(), {"p1": 1}, sender, announce=lambda s: None)
    line = voices.play_line_frame(voices.role_id(None, "healed"))
    assert gc.voice_tail(None)[5] == "", "setup: the CLI $PSET ships t15 empty"
    run(d.execute([Heal("p1", hp=20, armor=0)]))
    assert sent.count(line) == 1, sent
    sent.clear()
    run(d.execute([Heal("p1", hp=0, armor=20)]))
    assert line not in sent, sent
    d._pools["p1"] = (d.config.hp, 10, 0)                  # the last `$HP`: health full, armour down
    run(d.execute([Heal("p1", hp=d.config.hp, armor=d.config.armor)]))
    assert line not in sent, f"a grant that cannot raise health is not a heal: {sent}"
    d._pools["p1"] = (d.config.hp - 10, 10, 0)
    run(d.execute([Heal("p1", hp=d.config.hp, armor=d.config.armor)]))
    assert sent.count(line) == 1, sent
    run(d.execute([Heal("p1", hp=d.config.hp, armor=d.config.armor)]))
    assert sent.count(line) == 1, f"a second grant before the next $HP finds health already full: {sent}"
