"""Pins the bytes the CLI and the diag tool send to a gun, and the CLI/arm_sequence weapon rules.

The golden lists are literal on purpose: they are built from `GameConfig`, so a builder default that
changes (a voice id, a damage token, a $SIR row) must show up here as a failing test and be reviewed,
not slide through a test that repeats the builder expression. Update them only when the wire change is
intended.

DRY review 2026-10-10 #5: the CLI and the diag tool used to hold literal copies of these frames.
"""
import contextlib
import io
import time as _time

from brx_mcp import __main__ as cli
from brx_mcp import gameconfig as gc
from brx_mcp.diag import cases as C
from brx_mcp.mc.compile import Compiler, WeaponCatalog
from _session import match_config

# The default CLI arm (tdm, outdoor, volume 65): MC's compiled head plus the CLI additions.
GOLDEN_CLI_ARM_OUTDOOR = [
    '$VOL,65,0,*',
    '$CLEAR,*',
    '$START,*',
    '$GSET,0,0,1,0,1,0,0,1,*',
    '$PSET,1,1,45,70,0,50,,H44,JAD,VA3,,,,,VA7,H06,,H02,H21,X49,U15,W71,,*',
    '$WEAP,0,,70,0,3,10,40,,,,,,,,75,850,36,384,1700,0,9,100,100,540,0,,,R18,,,,D04,D03,D02,D18,,,,,36,192,75,*',
    '$WEAP,1,2,30,0,0,20,0,,,,,,20,100,400,850,6,48,400,2,7,100,100,,0,,,T01,,,,D01,D28,D27,D18,,,,,6,24,75,100,*',
    '$WEAP,4,1,60,13,1,90,0,,,,,,,,1000,100,1,0,0,10,13,100,100,,0,0,,M92,,,,,,,,,,,,1,0,20,*',
    '$SIR,0,0,,1,0,0,1,,*',
    '$SIR,0,1,,36,0,0,1,,*',
    '$SIR,0,3,,37,0,0,1,,*',
    '$SIR,8,0,,1,0,0,1,,*',
    '$SIR,9,3,,1,0,0,1,,*',
    '$SIR,10,0,X13,1,0,100,2,60,*',
    '$SIR,6,0,H02,1,0,90,1,40,*',
    '$SIR,13,1,H57,1,0,0,1,,*',
    '$SIR,13,0,H50,1,0,0,1,,*',
    '$SIR,13,3,H49,1,0,100,0,60,*',
    '$SIR,4,0,,2,0,0,1,,*',
    '$SIR,15,0,,28,0,0,1,,*',
    '$BMAP,0,98,,,,,*',
    '$BMAP,1,100,0,1,99,99,*',
    '$BMAP,2,97,,,,,*',
    '$BMAP,3,98,,,,,*',
    '$BMAP,4,98,,,,,*',
    '$BMAP,5,98,,,,,*',
    '$BMAP,8,4,,,,,*',
    '$HLED,1,0,,,10,,*',
    '$GLED,1,1,1,0,10,,*',
    '$TID,1,*',
    '$PLAYX,0,*',
    '$PLAY,VA81,4,6,,,,,*',
]

GOLDEN_CLI_ARM_INDOOR = [
    '$VOL,65,0,*',
    '$CLEAR,*',
    '$START,*',
    '$GSET,0,0,1,0,1,0,0,1,*',
    '$PSET,1,1,45,70,0,50,,H44,JAD,VA3,,,,,VA7,H06,,H02,H21,X49,U15,W71,,*',
    '$WEAP,0,,100,0,3,10,40,,,,,,,,75,850,36,384,1700,0,9,100,100,540,0,,,R18,,,,D04,D03,D02,D18,,,,,36,192,75,*',
    '$WEAP,1,2,100,0,0,20,0,,,,,,20,100,400,850,6,48,400,2,7,100,100,,0,,,T01,,,,D01,D28,D27,D18,,,,,6,24,75,100,*',
    '$WEAP,4,1,90,13,1,90,0,,,,,,,,1000,100,1,0,0,10,13,100,100,,0,0,,M92,,,,,,,,,,,,1,0,20,*',
    '$SIR,0,0,,1,0,0,1,,*',
    '$SIR,0,1,,36,0,0,1,,*',
    '$SIR,0,3,,37,0,0,1,,*',
    '$SIR,8,0,,1,0,0,1,,*',
    '$SIR,9,3,,1,0,0,1,,*',
    '$SIR,10,0,X13,1,0,100,2,60,*',
    '$SIR,6,0,H02,1,0,90,1,40,*',
    '$SIR,13,1,H57,1,0,0,1,,*',
    '$SIR,13,0,H50,1,0,0,1,,*',
    '$SIR,13,3,H49,1,0,100,0,60,*',
    '$SIR,4,0,,2,0,0,1,,*',
    '$SIR,15,0,,28,0,0,1,,*',
    '$BMAP,0,98,,,,,*',
    '$BMAP,1,100,0,1,99,99,*',
    '$BMAP,2,97,,,,,*',
    '$BMAP,3,98,,,,,*',
    '$BMAP,4,98,,,,,*',
    '$BMAP,5,98,,,,,*',
    '$BMAP,8,4,,,,,*',
    '$HLED,1,0,,,10,,*',
    '$GLED,1,1,1,0,10,,*',
    '$TID,1,*',
    '$PLAYX,0,*',
    '$PLAY,VA81,4,6,,,,,*',
]

GOLDEN_DIAG_CONFIG = [
    '$CLEAR,*',
    '$START,*',
    '$GSET,1,0,1,0,1,0,0,1,*',
    '$PSET,0,0,45,70,70,50,,H44,JAD,VA3,,,,,VA7,H06,,H02,H21,X49,U15,W71,,*',
    '$WEAP,0,,100,0,3,9,0,,,,,,,,75,850,36,216,1700,0,9,100,100,275,0,,,R18,,,,D04,D03,D02,D18,,,,,36,108,75,*',
    '$SIR,0,0,,1,0,0,1,,*',
    '$SIR,0,1,,36,0,0,1,,*',
    '$SIR,0,3,,37,0,0,1,,*',
    '$SIR,8,0,,1,0,0,1,,*',
    '$SIR,9,3,,1,0,0,1,,*',
    '$SIR,10,0,X13,1,0,100,2,60,*',
    '$SIR,6,0,H02,1,0,90,1,40,*',
    '$SIR,13,1,H57,1,0,0,1,,*',
    '$SIR,13,0,H50,1,0,0,1,,*',
    '$SIR,13,3,H49,1,0,100,0,60,*',
    '$SIR,4,0,,2,0,0,1,,*',
    '$BMAP,0,0,,,,,*',
    '$BMAP,1,98,,,,,*',
    '$BMAP,2,97,,,,,*',
    '$BMAP,3,98,,,,,*',
    '$BMAP,4,98,,,,,*',
    '$BMAP,5,98,,,,,*',
    '$BMAP,8,4,,,,,*',
]


def test_cli_default_arm_is_the_outdoor_head_golden():
    assert cli.arm_frames(volume=65) == GOLDEN_CLI_ARM_OUTDOOR
    assert cli.arm_frames(volume=65, venue="outdoor") == GOLDEN_CLI_ARM_OUTDOOR
    assert len(GOLDEN_CLI_ARM_OUTDOOR) == 32
    assert "$GSET,0,0,1,0,1,0,0,1,*" in GOLDEN_CLI_ARM_OUTDOOR         # TDM: friendly fire off, as MC writes it


def test_cli_indoor_arm_is_golden_and_differs_only_in_the_range_tokens():
    assert cli.arm_frames(volume=65, venue="indoor") == GOLDEN_CLI_ARM_INDOOR
    diff = [i for i, (a, b) in enumerate(zip(GOLDEN_CLI_ARM_OUTDOOR, GOLDEN_CLI_ARM_INDOOR)) if a != b]
    # melee (slot 4) joined the outdoor range table on 2026-10-17 (t2 90 -> 60 outdoors, indoor unchanged)
    assert [GOLDEN_CLI_ARM_OUTDOOR[i][:8] for i in diff] == ["$WEAP,0,", "$WEAP,1,", "$WEAP,4,"]
    assert GOLDEN_CLI_ARM_INDOOR[diff[0]].split(",")[3] == "100"
    assert GOLDEN_CLI_ARM_OUTDOOR[diff[0]].split(",")[3] == "70"


def _mc_head(mode, venue, tid=None, weapons=("burst_rifle", "shotgun")):
    """What MC compiles for the same inputs: its default config for the mode, one player, the CLI loadout.
    `tid` puts the gun on that team (a team MC itself knows: red 0, blue 1, yellow 2, purple 3)."""
    from brx_mcp.mc.state import TEAM_DEFS, default_config
    cfg = default_config(mode)
    cfg["environment"] = venue
    if tid is None:
        team = cfg["teams"][0] if mode == "ffa" else next(t for t in cfg["teams"] if t["tid"] == 1)
    else:
        team = next(t for t in TEAM_DEFS.values() if t["tid"] == tid and t["team_id"] != "ffa")
        cfg["teams"] = [*cfg["teams"], team] if team not in cfg["teams"] else cfg["teams"]
    player = {"player_id": "p1", "player_num": (tid if tid is not None else 0) + 1, "display": "X",
              "team_id": team["team_id"], "node_id": None, "gun_id": None, "voice": "male", "ready": True,
              "loadout": {"weapons": [{"weapon_id": w} for w in weapons]}}
    return Compiler().compile(cfg, player, cfg["teams"])


def test_cli_head_equals_mc_compile_frame_for_frame_except_the_named_additions():
    for mode in ("tdm", "ffa"):
        for venue in ("outdoor", "indoor"):
            b = _mc_head(mode, venue)
            mc, got = b["head"], cli.arm_frames(mode, venue, volume=65)
            # the CLI-only additions: (1) its own volume frame, (2) the live $SIR table for the
            # disarmed rows, (3) the tail. Everything else must be MC's frame, byte for byte.
            sir = [i for i, f in enumerate(mc) if f.startswith("$SIR,")]
            tail = ["$PLAYX,0,*", b["cues"]["countdown"]]
            assert got[len(got) - 2:] == tail, (mode, venue)
            body = got[:len(got) - 2]
            assert body[0] == "$VOL,65,0,*" and mc[0].startswith("$VOL,"), (mode, venue)
            assert body[sir[0]:sir[-1] + 1] == b["sir_pool"][0], (mode, venue)
            assert body[sir[0]:sir[-1] + 1] != mc[sir[0]:sir[-1] + 1], "the CLI must not arm the disarmed rows"
            assert body[1:sir[0]] == mc[1:sir[0]], (mode, venue)
            assert body[sir[-1] + 1:] == mc[sir[-1] + 1:], (mode, venue)
            assert len(body) - (sir[-1] - sir[0] + 1) == len(mc) - len(sir)


def test_cli_ffa_head_gset_follows_the_mode_and_friendly_fire_flag_forces_it_on():
    assert "$GSET,0,0,1,0,1,0,0,1,*" in cli.arm_frames("tdm")
    assert "$GSET,1,0,1,0,1,0,0,1,*" in cli.arm_frames("ffa")        # solo mode: MC writes friendly fire on
    on = cli.arm_frames("tdm", friendly_fire=True)
    off = cli.arm_frames("tdm")
    assert "$GSET,1,0,1,0,1,0,0,1,*" in on and "$GSET,0,0,1,0,1,0,0,1,*" not in on
    assert [(a, b) for a, b in zip(on, off) if a != b] == [("$GSET,1,0,1,0,1,0,0,1,*", "$GSET,0,0,1,0,1,0,0,1,*")]


def test_cli_catalogue_ids_are_the_r18_t01_m92_rows():
    heads = {n: cli.weap(s, n) for n, s in (("primary", 0), ("secondary", 1), ("melee", 4))}
    assert ",R18," in heads["primary"] and ",T01," in heads["secondary"] and ",M92," in heads["melee"]
    cat = WeaponCatalog()
    assert heads["primary"] == cat.resolve("burst_rifle", 0, environment="outdoor")
    assert cli.cli_ammo("primary") == cat.spawn_ammo("burst_rifle") == (36, 384)
    assert cli.cli_ammo("secondary") == cat.spawn_ammo("shotgun") == (6, 48)
    assert cli.arm_plan().spawn == ["$PLAYX,0,*", "$SPAWN,,*", "$TID,1,*", "$AMMO,0,36,384,1,*",
                                    "$AMMO,1,6,48,1,*", "$BMAP,0,0,,,,,*"]


def test_arena_gives_each_gun_its_own_team_and_player_number():
    for tid in (0, 1, 2, 3):
        frames = cli.arm_frames("tdm", tid=tid, player_num=tid + 1)
        assert frames[-3] == f"$TID,{tid},*"
        assert next(f for f in frames if f.startswith("$PSET,")).split(",")[1:3] == [str(tid + 1), str(tid)]
        gc.assert_team_byte_consistent(frames)


def test_take_arm_options_and_the_printed_venue_line():
    assert cli._take_arm_options(["a", "5"]) == (["a", "5"], "outdoor", False)
    assert cli._take_arm_options(["a", "--venue", "indoor", "5", "--friendly-fire"]) == (["a", "5"], "indoor", True)
    assert cli._take_arm_options(["--venue=indoor", "a"]) == (["a"], "indoor", False)
    for bad in (["--venue", "garage"], ["--venue"]):
        err = _stderr_of(lambda: _expect_exit(lambda: cli._take_arm_options(bad)))
        assert "unknown venue" in err, err


def _expect_exit(fn):
    try:
        fn()
    except SystemExit as e:
        assert e.code == 2
        return
    raise AssertionError("expected SystemExit(2)")


def test_dispatch_passes_venue_and_friendly_fire_and_prints_the_venue_once():
    seen = []

    async def fake(*a, **kw):
        seen.append((a, kw))

    real = cli._startgame, cli._deathmatch
    cli._startgame = cli._deathmatch = fake
    try:
        out = _stderr_of(lambda: cli._dispatch("startgame", ["startgame", "AA", "--venue", "indoor"]))
        assert out.count("venue: indoor") == 1 and "friendly" not in out, out
        out = _stderr_of(lambda: cli._dispatch("deathmatch", ["deathmatch", "AA", "--friendly-fire"]))
        assert out.count("venue: outdoor") == 1 and "friendly fire forced on" in out, out
    finally:
        cli._startgame, cli._deathmatch = real
    assert seen[0][1] == {"venue": "indoor", "friendly_fire": False}
    assert seen[1][1] == {"venue": "outdoor", "friendly_fire": True}
    assert seen[0][0][0] == "AA" and len(seen[0][0]) == 4


# ---- round 2: the whole sequence, not just the head -------------------------------------------------

# What the phone writes that the bundle does not hold, and the CLI therefore adds or leaves out, by name:
#  - bench variants: their own $AMMO rows (the bundle carries the base weapon's magazines);
#  - the phone's `pset_pool` roll, the live-table take, the headset and gun LED takes after a spawn, the
#    F416 pool probe and weapon query: NOT reproduced (the CLI has no node).
_VARIANT_AMMO = {"ar-bench-infinite": "assault_rifle", "charge-bench-infinite": "charge_rifle"}


def _expect_sequences(b, ammo_rows=None):
    rp = b["respawn_profile"]
    swap = (lambda fs: [ammo_rows.get(f.split(",")[1], f) if f.startswith("$AMMO,") else f for f in fs]) \
        if ammo_rows else (lambda fs: list(fs))
    return {"spawn": swap(rp["spawn"]),
            # the phone writes `headset.down.stop` ($HLOOP,0,0) first, then the revive; trigger_live follows
            "revive": [b["headset"]["down"]["stop"], *swap(rp["revive"])],
            "trigger_live": rp["trigger_live"], "trigger_ms": rp["trigger_ms"], "end": list(b["end"])}


def test_cli_spawn_revive_trigger_and_end_equal_the_bundles():
    cases = [(m, v, tid, ff) for m in ("tdm", "ffa") for v in ("outdoor", "indoor")
             for tid, ff in ((None, False), (2, True))
             if not (m == "ffa" and tid is not None)]
    for mode, venue, tid, ff in cases:
        plan = cli.arm_plan(mode, venue, friendly_fire=ff, volume=65, tid=tid)
        b = _mc_head(mode, venue, tid)
        want = _expect_sequences(b)
        got = {"spawn": plan.spawn, "revive": plan.revive, "trigger_live": plan.trigger_live,
               "trigger_ms": plan.trigger_ms, "end": plan.end}
        assert got == want, (mode, venue, tid, ff)
        assert plan.end == list(gc.END_SEQUENCE)                  # the soak runner's teardown is the same one
        assert plan.arm == cli.arm_frames(mode, venue, friendly_fire=ff, volume=65, tid=tid)
        if tid is not None:
            assert plan.spawn[2] == plan.revive[3] == f"$TID,{tid},*"
        assert "$BMAP,0,0,,,,,*" == plan.spawn[-1] == plan.trigger_live != plan.revive[1]   # revive HOLDS it


def test_bench_variant_keeps_its_own_ammo_rows_in_spawn_and_revive():
    for name, base in _VARIANT_AMMO.items():
        plan = cli.arm_plan("tdm", "outdoor", primary=name)
        b = _mc_head("tdm", "outdoor", weapons=(base, "shotgun"))
        mag, res = gc.WEAPON_AMMO[name]
        want = _expect_sequences(b, {"0": f"$AMMO,0,{mag},{res},1,*"})
        assert plan.spawn == want["spawn"] and plan.revive == want["revive"], name
        assert any(f.startswith("$AMMO,0,") and f"{mag},{res}" in f for f in plan.spawn)


def test_team_outside_0_to_3_is_refused_with_the_f35_reason():
    for tid in (0, 1, 2, 3):
        cli.arm_plan("tdm", tid=tid)                                # all four valid teams arm
    for tid in (4, 5, 7, -1):
        try:
            cli.arm_plan("tdm", tid=tid)
        except ValueError as e:
            assert "0-3" in str(e) and "F35" in str(e), str(e)
        else:
            raise AssertionError(f"tid {tid} was armed")


class _VirtualTime:
    """A fake clock and scheduler: `sleep` parks the caller until the clock is moved to its wake time, and the
    driver moves the clock only when every other task is idle. No wall-clock time passes, nothing races."""

    def __init__(self):
        import heapq
        self.now = 1000.0
        self.heap = []
        self.n = 0
        self._push, self._pop = heapq.heappush, heapq.heappop
        self.yield0 = None

    async def sleep(self, seconds):
        import asyncio
        if seconds <= 0:
            await self.yield0(0)
            return
        fut = asyncio.get_running_loop().create_future()
        self._push(self.heap, (self.now + seconds, self.n, fut))
        self.n += 1
        await fut

    async def drive(self, main):
        for _ in range(2_000_000):
            for _ in range(40):                      # let every runnable task run to its next wait
                await self.yield0(0)
            if main.done():
                return
            while self.heap:
                t, _n, fut = self._pop(self.heap)
                if not fut.done():
                    self.now = max(self.now, t)
                    fut.set_result(None)
                    break
        raise AssertionError("the virtual clock ran away")


def _fake_ble(vt, deaths=1, hook=None):
    """A stand-in for `brx_mcp.ble`: records every connect and send with its virtual time (`log.times`), pays
    each send's reply window in virtual time, and serves events by `since_seq`. `deaths` is a number (one
    `$HP,0` every second, the first half a second after the first poll) or a list of offsets in seconds from
    the first poll. `hook(alias, cmd)` may raise, to fail a write."""
    import types
    log = types.SimpleNamespace(sent=[], connects=[], disconnects=[], times=[])
    offsets = [0.5 + k for k in range(deaths)] if isinstance(deaths, int) else list(deaths)

    class Mgr:
        def __init__(self):
            self.sessions = {}
            self._first = {}

        def _visible(self, alias):
            t0 = self._first.get(alias)
            if t0 is None:
                return []
            return [{"seq": k + 1, "direction": "rx", "raw": "$HP,0,0,0,*", "t_ms": 1, "parsed": {}}
                    for k, off in enumerate(offsets) if vt.now >= t0 + off]

        async def connect(self, addr, alias):
            log.connects.append(alias)
            mgr = self

            class Session:
                @property
                def seq(self):              # live, as in ble.py: the newest event so far, polled or not
                    return len(mgr._visible(alias))
            self.sessions[alias] = Session()

        async def send(self, alias, cmd, reply_window_ms=0):
            log.sent.append((alias, cmd))
            log.times.append(vt.now)
            if hook:
                hook(alias, cmd)
            if reply_window_ms:
                await vt.sleep(reply_window_ms / 1000)
            return {"replies_within_window": []}

        def get_events(self, alias, since_seq=0):
            self._first.setdefault(alias, vt.now)
            vis = self._visible(alias)
            return {"events": [e for e in vis if e["seq"] > since_seq]}

        async def disconnect(self, alias):
            log.disconnects.append(alias)

    mod = types.ModuleType("brx_mcp.ble")
    mod.ConnectionManager = Mgr
    return mod, log


def _run_cli(coro_fn, deaths=1, out=None, hook=None):
    """Run a CLI coroutine against the fake manager on virtual time (see `_VirtualTime`)."""
    import asyncio
    import sys
    import types
    vt = _VirtualTime()
    vt.yield0 = cli.asyncio.sleep                     # the real sleep, for yielding only
    mod, log = _fake_ble(vt, deaths, hook)
    if out is not None:
        out["log"] = log
    real_mod = sys.modules.get("brx_mcp.ble")
    real_time, real_sleep = cli.time, cli.asyncio.sleep
    cli.time = types.SimpleNamespace(monotonic=lambda: vt.now, sleep=lambda s: None)
    cli.asyncio.sleep = vt.sleep

    async def main():
        task = asyncio.ensure_future(coro_fn())
        driver = asyncio.ensure_future(vt.drive(task))
        try:
            await asyncio.gather(task, driver)
        finally:
            driver.cancel()

    sys.modules["brx_mcp.ble"] = mod
    buf = io.StringIO()
    try:
        with contextlib.redirect_stderr(buf), contextlib.redirect_stdout(io.StringIO()):
            asyncio.run(main())
    finally:
        log.err = buf.getvalue()
        cli.time, cli.asyncio.sleep = real_time, real_sleep
        if real_mod is None:
            sys.modules.pop("brx_mcp.ble", None)
        else:
            sys.modules["brx_mcp.ble"] = real_mod
    return log, log.err


def _sent(log, alias="cli"):
    return [c for a, c in log.sent if a == alias]


def test_startgame_spawns_revives_releases_the_trigger_and_ends_with_the_bundles_sequences():
    plan = cli.arm_plan("tdm", "outdoor", volume=65)
    log, _ = _run_cli(lambda: cli._startgame("AA", 3, 0, 65))
    sent = _sent(log)
    assert sent == plan.arm + plan.spawn + plan.revive + [plan.trigger_live] + plan.end, sent
    assert log.disconnects == ["cli"]


def test_deathmatch_spawns_revives_releases_the_trigger_and_ends_with_the_bundles_sequences():
    plan = cli.arm_plan("ffa", "outdoor", volume=65)
    log, _ = _run_cli(lambda: cli._deathmatch("AA", 1, 0, 65))
    sent = _sent(log)
    assert sent == plan.arm + plan.spawn + plan.revive + [plan.trigger_live] + plan.end, sent


def test_arena_and_fieldstart_use_the_bundles_sequences_per_gun():
    log, _ = _run_cli(lambda: cli._arena(["A0", "A1"], 1, 0, 65))
    for i, alias in enumerate(("p0", "p1")):
        plan = cli.arm_plan("tdm", "outdoor", volume=65, tid=i, player_num=i + 1)
        arm = [f for f in plan.arm if not f.startswith("$PLAY,VA81")]
        want = arm + ["$PLAY,VA81,4,6,,,,,*"] + plan.spawn + plan.revive + [plan.trigger_live] + plan.end
        assert _sent(log, alias) == want, alias
    log, _ = _run_cli(lambda: cli._fieldstart(["A0", "A1"], 65))
    for i, alias in enumerate(("p0", "p1")):
        plan = cli.arm_plan("tdm", "outdoor", volume=65, tid=i, player_num=i + 1)
        want = [f for f in plan.arm if not f.startswith("$PLAY,VA81")] + ["$PLAY,VA81,4,6,,,,,*"] + plan.spawn
        assert _sent(log, alias) == want, alias


def test_a_lost_trigger_live_is_sent_again_once():
    plan = cli.arm_plan("tdm")
    calls = []

    async def send(cmds, label, fast=False):
        calls.append(list(cmds))
        if cmds == [plan.trigger_live] and calls.count([plan.trigger_live]) == 1:
            raise RuntimeError("write failed")

    import asyncio

    async def fake_sleep(s):
        pass
    real = cli.asyncio.sleep
    cli.asyncio.sleep = fake_sleep
    try:
        _stderr_of(lambda: asyncio.run(cli._respawn(send, plan)))
    finally:
        cli.asyncio.sleep = real
    assert calls == [plan.revive, [plan.trigger_live], [plan.trigger_live]]


def test_trigger_live_waits_the_bundles_trigger_ms_after_the_revive():
    import asyncio
    plan = cli.arm_plan("tdm")
    order = []

    async def send(cmds, label, fast=False):
        order.append(("send", list(cmds)))

    async def fake_sleep(s):
        order.append(("sleep", s))
    real = cli.asyncio.sleep
    cli.asyncio.sleep = fake_sleep
    try:
        asyncio.run(cli._respawn(send, plan))
    finally:
        cli.asyncio.sleep = real
    assert plan.trigger_ms == 1500
    assert order == [("send", plan.revive), ("sleep", 1.5), ("send", [plan.trigger_live])], order


def test_a_cancel_during_the_hold_still_releases_the_trigger():
    import asyncio
    plan = cli.arm_plan("tdm")
    sent = []
    real_sleep = asyncio.sleep

    async def send(cmds, label, fast=False):
        sent.append(list(cmds))

    async def hang(s):
        await asyncio.Event().wait()           # the 500 ms hold, never ending

    async def go():
        cli.asyncio.sleep = hang
        task = asyncio.ensure_future(cli._respawn(send, plan))
        for _ in range(5):
            await real_sleep(0)
        assert sent == [plan.revive], "the revive is out and the hold is running"
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            return "cancelled"
        return "finished"
    try:
        assert asyncio.run(go()) == "cancelled", "the cancel must propagate"
    finally:
        cli.asyncio.sleep = real_sleep
    assert sent == [plan.revive, [plan.trigger_live]], sent
    assert [f for fs in sent for f in fs if f.startswith("$BMAP,0,")][-1] == "$BMAP,0,0,,,,,*"


def test_a_failed_release_during_a_cancel_is_logged_and_the_cancel_still_propagates():
    import asyncio
    plan = cli.arm_plan("tdm")
    real_sleep = asyncio.sleep

    async def send(cmds, label, fast=False):
        if cmds == [plan.trigger_live]:
            raise RuntimeError("link gone")

    async def hang(s):
        await asyncio.Event().wait()

    async def go():
        cli.asyncio.sleep = hang
        task = asyncio.ensure_future(cli._respawn(send, plan))
        for _ in range(5):
            await real_sleep(0)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            return True
        return False
    buf = io.StringIO()
    try:
        with contextlib.redirect_stderr(buf):
            assert asyncio.run(go())
    finally:
        cli.asyncio.sleep = real_sleep
    assert "link gone" in buf.getvalue()


def _first_revive_and_release(log, plan, aliases):
    revive_t, live_t = {}, {}
    for (a, c), t in zip(log.sent, log.times):
        if a in aliases and c == plan.revive[0]:       # the first $HLOOP,0,0 is the revive's (the end's comes last)
            revive_t.setdefault(a, t)
    for (a, c), t in zip(log.sent, log.times):
        if a in revive_t and c == plan.trigger_live and t > revive_t[a]:
            live_t.setdefault(a, t)
    return revive_t, live_t


def _with_hold(ms):
    import dataclasses
    real = cli.arm_plan
    cli.arm_plan = lambda *a, **kw: dataclasses.replace(real(*a, **kw), trigger_ms=ms)
    return real


def test_two_guns_dying_together_are_both_released_within_one_hold():
    plan = cli.arm_plan("tdm", tid=0, player_num=1)
    hold = plan.trigger_ms / 1000
    out = {}
    _run_cli(lambda: cli._arena(["A0", "A1"], 1, 0, 65), out=out)
    revive_t, live_t = _first_revive_and_release(out["log"], plan, ("p0", "p1"))
    assert set(revive_t) == set(live_t) == {"p0", "p1"}, (revive_t, live_t)
    for a in live_t:
        assert abs(live_t[a] - revive_t[a] - hold) < 1e-6, "each gun waits its own hold"
    span = max(live_t.values()) - min(revive_t.values())
    assert span < 1.5 * hold, f"{span}s for two guns: one after the other would be {2 * hold}s"


def test_arena_end_releases_an_in_flight_hold_before_the_teardown():
    real = _with_hold(10 ** 9)                  # a hold that is still running when the match ends
    out = {}
    try:
        _run_cli(lambda: cli._arena(["A0", "A1"], 1, 0, 65), out=out)
    finally:
        cli.arm_plan = real
    plan = real("tdm", tid=0, player_num=1)
    revive_t, live_t = _first_revive_and_release(out["log"], plan, ("p0", "p1"))
    assert set(live_t) == {"p0", "p1"}
    for alias in ("p0", "p1"):
        sent = _sent(out["log"], alias)
        stop = sent.index("$STOP,*")
        before = [f for f in sent[:stop] if f.startswith("$BMAP,0,")]
        assert before[-1] == "$BMAP,0,0,,,,,*", (alias, before)
        assert live_t[alias] - revive_t[alias] < 120, "released by the cancel at the whistle, not by the 10^9 s hold"


def test_a_gun_that_dies_again_during_its_hold_is_not_revived_twice_at_once():
    real = _with_hold(2500)                     # longer than the one-second poll, so deaths land inside the hold
    out = {}
    try:
        _run_cli(lambda: cli._arena(["A0"], 1, 0, 65), deaths=[0.5, 1.5, 2.5, 3.5], out=out)
    finally:
        cli.arm_plan = real
    plan = real("tdm", tid=0, player_num=1)
    sent = _sent(out["log"], "p0")
    sent = sent[sent.index("$BMAP,0,0,,,,,*") + 1:sent.index("$STOP,*")]       # after the T-0 spawn, before the end
    marks = [("R" if c == plan.revive[0] else "L") for c in sent if c in (plan.revive[0], "$BMAP,0,0,,,,,*")]
    assert marks.count("R") >= 2, marks
    assert "".join(marks).replace("RL", "") == "", f"revives overlapped: {''.join(marks)}"


def test_a_death_that_lands_while_a_respawn_task_runs_is_still_seen_and_respawned():
    out = {}
    # death 1 at +0.5 s is seen by the poll at +1 s; its respawn runs +1 s to +1.5 s; death 2 at +1.2 s lands
    # inside that hold, after the last poll. Only the main loop's own cursor may advance past it.
    _run_cli(lambda: cli._arena(["A0"], 1, 0, 65), deaths=[0.5, 1.2], out=out)
    plan = cli.arm_plan("tdm", tid=0, player_num=1)
    revives = [c for c in _sent(out["log"], "p0") if c == plan.revive[0]]
    assert len(revives) == 3, "two respawns and the end's $HLOOP,0,0"
    assert "respawns 2" in out["log"].err, out["log"].err


def test_a_failed_respawn_is_reported_for_that_gun_and_not_counted():
    plan = cli.arm_plan("tdm", tid=0, player_num=1)
    seen = []

    def hook(alias, cmd):
        if alias == "p1" and cmd == plan.revive[0] and not seen:
            seen.append(cmd)
            raise RuntimeError("link dropped")

    out = {}
    _run_cli(lambda: cli._arena(["A0", "A1"], 1, 0, 65), out=out, hook=hook)
    err = out["log"].err
    assert "[p1] respawn failed: RuntimeError: link dropped" in err, err
    assert "[p0] respawn failed" not in err
    assert "p0 (team 0): hits 0  deaths 1  respawns 1  respawn failures 0" in err, err
    assert "p1 (team 1): hits 0  deaths 1  respawns 0  respawn failures 1" in err, err
    sent = _sent(out["log"], "p1")
    assert [f for f in sent if f.startswith("$BMAP,0,")][-1] == "$BMAP,0,0,,,,,*" or "$STOP,*" in sent


def test_the_end_of_match_cancel_is_silent():
    real = _with_hold(10 ** 9)
    out = {}
    try:
        _run_cli(lambda: cli._arena(["A0"], 1, 0, 65), out=out)
    finally:
        cli.arm_plan = real
    assert "respawn failed" not in out["log"].err and "Cancelled" not in out["log"].err, out["log"].err
    assert "respawns 0  respawn failures 0" in out["log"].err, out["log"].err


def test_a_cancel_during_the_trigger_live_retry_still_ends_released():
    import asyncio
    plan = cli.arm_plan("tdm")
    done = []                                     # frames whose write completed
    calls = []
    real_sleep = asyncio.sleep

    async def send(cmds, label, fast=False):
        calls.append(label)
        if label == "trigger live":
            raise RuntimeError("write failed")
        if label == "trigger live (repeat)":
            await asyncio.Event().wait()          # the retry hangs; the cancel arrives here
        done.append(list(cmds))

    async def no_wait(s):
        await real_sleep(0)

    async def go():
        cli.asyncio.sleep = no_wait
        task = asyncio.ensure_future(cli._respawn(send, plan))
        for _ in range(10):
            await real_sleep(0)
        assert "trigger live (repeat)" in calls
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            return True
        return False
    try:
        with contextlib.redirect_stderr(io.StringIO()):
            assert asyncio.run(go())
    finally:
        cli.asyncio.sleep = real_sleep
    assert [f for fs in done for f in fs if f.startswith("$BMAP,0,")][-1] == "$BMAP,0,0,,,,,*", done


def test_the_trigger_is_held_for_trigger_ms_not_for_every_reply_window():
    plan = cli.arm_plan("tdm", volume=65)
    out = {}
    _run_cli(lambda: cli._startgame("AA", 3, 0, 65), out=out)
    log = out["log"]
    sent = [c for _a, c in log.sent]
    i = len(plan.arm) + len(plan.spawn)                      # the revive starts here
    assert sent[i:i + len(plan.revive)] == plan.revive
    t98 = log.times[i + plan.revive.index("$BMAP,0,98,,,,,*")]
    t0 = log.times[i + len(plan.revive)]
    assert sent[i + len(plan.revive)] == plan.trigger_live
    spacing = 0.04                                          # the phone's write latency, about 40 ms a frame
    after_98 = len(plan.revive) - 1 - plan.revive.index("$BMAP,0,98,,,,,*")
    assert plan.trigger_ms / 1000 <= t0 - t98 <= plan.trigger_ms / 1000 + after_98 * spacing + 1e-9, t0 - t98


def test_arena_and_fieldstart_refuse_more_than_four_guns_before_sending_anything():
    for fn in (lambda: cli._arena([f"A{i}" for i in range(5)], 1, 0, 65),
               lambda: cli._fieldstart([f"A{i}" for i in range(5)], 65)):
        holder = {}
        try:
            _run_cli(fn, out=holder)
        except SystemExit as e:
            holder["code"] = e.code
        assert holder.get("code") == 2, holder
        log = holder["log"]
        assert log.connects == [] and log.sent == [], "the refusal comes before any connect or frame"
        assert "F35" in log.err and "at most 4" in log.err, log.err


def test_the_cli_no_longer_uses_its_own_spawn_respawn_or_end_lists():
    import inspect
    src = inspect.getsource(cli)
    assert not hasattr(cli, "END_SEQUENCE") and not hasattr(cli, "spawn_frames")
    assert "RESPAWN_SEQUENCE" not in src.split("def _dispatch_soak")[0]
    assert "assert " not in inspect.getsource(cli.arm_plan), "explicit raises, not asserts"


def test_diag_config_is_golden():
    assert list(C.CONFIG) == GOLDEN_DIAG_CONFIG
    assert len(C.CONFIG) == 23


def test_cli_sends_its_own_volume_separately():
    assert cli.arm_frames(volume=65)[0] == "$VOL,65,0,*"
    assert sum(f.startswith("$VOL,") for f in cli.arm_frames(volume=65)) == 1
    assert cli.volume_cmd(65) == "$VOL,65,0,*"


def test_sir_follows_clear_and_the_full_table_is_present():
    for frames in (cli.arm_frames(), list(C.CONFIG)):
        gc.assert_sir_follows_clear(frames)
        last_clear = max(i for i, f in enumerate(frames) if f.startswith("$CLEAR"))
        first_sir = min(i for i, f in enumerate(frames) if f.startswith("$SIR,"))
        assert last_clear < first_sir, "every $SIR row must come after the last $CLEAR (F11)"
        assert [f for f in frames if f.startswith("$SIR,")][:len(gc._SIR_TABLE)] == list(gc._SIR_TABLE)


def test_diag_loads_one_weap_slot_and_the_inert_alt_row():
    assert len([f for f in C.CONFIG if f.startswith("$WEAP,")]) == 1
    assert "$BMAP,1,98,,,,,*" in C.CONFIG
    assert not any(f.startswith("$BMAP,1,100") for f in C.CONFIG)


def test_cli_weapons_is_the_gameconfig_one():
    assert cli.WEAPONS is gc.WEAPONS
    assert gc.WEAPONS == ("primary", "secondary", "melee", "ar", "charge",
                          "ar-bench-infinite", "charge-bench-infinite")


# Literal catalogue frames for slot 0, by venue. A catalogue change fails here, not on both sides.
GOLDEN_WEAP = {
    ("ar", "indoor"): "$WEAP,0,,100,0,0,9,0,,,,,,,,100,850,32,384,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,192,75,*",
    ("ar", "outdoor"): "$WEAP,0,,70,0,0,9,0,,,,,,,,100,850,32,384,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,192,75,*",
    ("charge", "indoor"): "$WEAP,0,,100,8,0,70,0,,,,,,,,1250,850,40,160,2500,0,14,100,100,,14,,,E03,C15,C17,,D30,D29,D37,A73,D11,C04,16,150,40,80,75,*",
    ("charge", "outdoor"): "$WEAP,0,,85,8,0,70,0,,,,,,,,1250,850,40,160,2500,0,14,100,100,,14,,,E03,C15,C17,,D30,D29,D37,A73,D11,C04,16,150,40,80,75,*",
}
GOLDEN_AMMO = {"ar": (32, 384), "charge": (40, 160)}
_IDS = {"ar": "assault_rifle", "charge": "charge_rifle"}


def test_default_ar_and_charge_frames_and_ammo_are_golden():
    for (name, env), want in GOLDEN_WEAP.items():
        assert gc.weapon_frame(0, name, outdoor=env == "outdoor") == want
        assert gc.GameConfig(primary=name, outdoor=env == "outdoor")._weap(0, name) == want
    assert cli.weap(0, "ar") == GOLDEN_WEAP[("ar", "outdoor")]      # the CLI default venue is outdoor
    assert cli.weap(0, "ar", "indoor") == GOLDEN_WEAP[("ar", "indoor")]
    for name, ammo in GOLDEN_AMMO.items():
        assert gc.weapon_ammo(name) == ammo
        frames = gc.arm_sequence(team=1, player_id=1, weapon=name)
        assert f"$AMMO,0,{ammo[0]},{ammo[1]},1,*" in frames


def test_cli_ar_and_charge_equal_what_the_mc_compiler_ships():
    teams = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
             {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 2}]
    for (name, env), want in GOLDEN_WEAP.items():
        player = {"player_id": "p7", "player_num": 7, "display": "REAPER", "team_id": "blue",
                  "node_id": None, "gun_id": None, "voice": "male", "ready": True,
                  "loadout": {"weapons": [{"weapon_id": _IDS[name]}]}}
        cfg = dict(match_config("tdm", frag=0, time_limit_s=600, led=None, teams=teams), environment=env)
        head = Compiler().compile(cfg, player, teams)["head"]
        assert [f for f in head if f.startswith("$WEAP,0,")] == [want], (name, env)
        assert WeaponCatalog().spawn_ammo(_IDS[name]) == GOLDEN_AMMO[name]


def _stderr_of(fn):
    buf = io.StringIO()
    with contextlib.redirect_stderr(buf):
        fn()
    return buf.getvalue()


def test_bench_variants_warn_once_per_process_per_variant():
    msg = "not a shipped weapon: bench variant with an infinite reserve"
    for name in ("ar-bench-infinite", "charge-bench-infinite"):
        gc._warned_variants.discard(name)
        out = _stderr_of(lambda: gc.arm_sequence(team=1, player_id=1, weapon=name))
        assert out.count(msg) == 1 and name in out, out
        again = _stderr_of(lambda: (gc.arm_sequence(team=1, player_id=1, weapon=name), cli.loadout(name)))
        assert again == "", again
        gc._warned_variants.discard(name)
        assert _stderr_of(lambda: cli.loadout(name)).count(msg) == 1


def test_shipped_weapons_do_not_warn():
    for name in ("primary", "ar", "charge"):
        assert _stderr_of(lambda: gc.arm_sequence(team=1, player_id=1, weapon=name)) == ""
        assert _stderr_of(lambda: cli.loadout(name)) == ""
