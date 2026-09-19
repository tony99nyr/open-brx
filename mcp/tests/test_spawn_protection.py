"""F121 / A23 — SPAWN PROTECTION: the head must not arm hit reception.

Field 2026-09-11, two reports that turned out to be one bug: "during the countdown you can take damage
apparently. while team colours are still on headsets" and "you can get hit by shots before the gun is
armed during spawn". The `$SIR` table IS the arming of hit reception (F11: a gun with no rows silently
eats every hit), and it shipped in the HEAD — the lobby push, in the same frame list as the pregame
team colour, minutes before go-live. MC's SCORE was never wrong (`engine.js` books a damage fact only
on `phase === 'live' && spawned && alive`); the GUN was. Hit sounds, the headset flash and the
firmware's own pool decrements all landed, so a player could walk to the line already hurt while the
match said nothing happened.

The fix is a two-table head: the same CELLS pregame with every function replaced by fn 28 (registers a
`$HIR` with no sound, no flash, no vibration and no pool movement — the one no-pool function
bench-swept for player feedback, 2026-09-10), and the REAL table written by the node as a `sir_pool`
take. Cells persist across writes — only `$CLEAR` wipes the table — so this is a swap, not an
addition, and it is the same write the F11 repair path and A17's per-life `sir_pool` take already make.

F121 rebuild (bench 2026-09-18, levers §23): each LIFE is protected by `$TMP` t8 = -100, written right
after `$SPAWN` and before `$TID`, and ended by `spawn_protect_off` (t8 = 0). No `$SIR` row rides the
spawn or revive: the table survives `$SPAWN` and death.

Run: python3 run_tests.py spawn_protection
"""
from brx_mcp.gameconfig import _SIR_TABLE
from brx_mcp.mc.compile import (SPAWN_PROTECT_OFF, SPAWN_PROTECT_ON, Compiler, _OBJECTIVE_SIR_ROW,
                                _SPAWN_PROTECT_FN, _sir_cells, _sir_index, assert_arms_after_spawn,
                                assert_rearms_every_life, assert_spawn_protected, assert_spawn_shielded,
                                assert_tmp_frames_whole, golden_bundle, sir_spawn_protected)
from _session import match_config

C = Compiler()

_TEAMS = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
          {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 3}]

# Every function that moves a pool, plus the delayed-blast family. A pregame row carrying one of these
# is the bug: fn 1/36/37/38 drain on arrival, fn 24-27 drain ~4 s LATER (bench 2026-09-11), which in a
# countdown means the damage lands inside the live match.
_MUST_NOT_SHIP_PREGAME = {1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
                          24, 25, 26, 27, 29, 30, 33, 36, 37, 38}


def _cfg(mode="tdm", **kw):
    return match_config(mode, teams=_TEAMS, **kw)


def _player(num=7, team="blue", weapons=("assault_rifle", "shotgun")):
    return {"player_id": f"p{num}", "player_num": num, "display": "REAPER", "team_id": team,
            "node_id": None, "gun_id": None, "voice": "male", "ready": True,
            "loadout": {"weapons": [{"weapon_id": w} for w in weapons]}}


def _sir(frames):
    return [f for f in frames if f.startswith("$SIR")]


def _fns(frames):
    rows = _sir(frames)
    return [_sir_index([r]).get(c) for r, c in zip(rows, _sir_cells(rows))]


# ---- (a) the head does not arm ------------------------------------------------
def test_the_head_ships_no_row_that_can_move_a_pool():
    """The bug, stated as a property. Every `$SIR` row in the lobby push is a silent registrar."""
    for mode in ("tdm", "ffa", "koth", "infection"):
        head = C.compile(_cfg(mode), _player(), _TEAMS)["head"]
        fns = _fns(head)
        assert fns, f"{mode}: a head with NO rows is the F11 failure, not spawn protection"
        assert all(f == _SPAWN_PROTECT_FN for f in fns), f"{mode} head arms hit reception: {_sir(head)}"
        assert not (set(fns) & _MUST_NOT_SHIP_PREGAME), f"{mode}: {set(fns) & _MUST_NOT_SHIP_PREGAME}"


def test_a_pregame_row_is_silent_as_well_as_harmless():
    """fn 28's "no sound, no flash, no vibration" was measured on a row with an EMPTY `<soundID>`, and a
    row's own sound plays whenever the row fires (§5). A hit in the lobby must not wipe the headset
    team colour, which is the operator's only read on who is on which team before go-live."""
    head = C.compile(_cfg(), _player(), _TEAMS)["head"]
    for row in _sir(head):
        assert row.split(",")[3] == "", f"a pregame row must carry no sound id: {row}"


def test_the_pregame_table_keeps_every_cell_the_live_one_has():
    """Same cells, same order — the take can only re-arm a cell the head already carries, and
    `assert_sir_covers_weapons` / `assert_sir_covers_objective` both run on the head."""
    b = C.compile(_cfg(), _player(), _TEAMS)
    assert _sir_cells(_sir(b["head"])) == _sir_cells(_sir(b["sir_pool"][0]))


# ---- (b) F121 rebuild: t8 protects each life, in the bench-proven order -----------
# Bench 2026-09-18 (levers §23): `$SPAWN,,*`, `$TMP,,,,,,,,-100,,,,*`, `$TID` registers hits with 0 damage;
# `$TMP,,,,,,,,0,,,,*` restores damage; a `$TMP` before `$SPAWN` is wiped by the spawn (step 5, the control).
def test_every_spawn_revive_and_flip_writes_spawn_then_t8_then_tid_and_no_table():
    for mode in ("tdm", "ffa", "koth", "infection"):
        for cfg in (_cfg(mode), _cfg(mode, hit_audio_class=True)):
            b = C.compile(cfg, _player(), _TEAMS)
            lists = {"spawn": b["spawn"], "revive": b["revive"], **{f"flip {t}": f for t, f in (b.get("team_flip") or {}).items()}}
            for k, frames in lists.items():
                i = frames.index("$SPAWN,,*")
                assert frames[i + 1] == SPAWN_PROTECT_ON, f"{mode} {k}: t8 must follow $SPAWN at once: {frames}"
                assert frames[i + 2].startswith("$TID,"), f"{mode} {k}: $TID follows t8: {frames}"
                assert not _sir(frames), f"{mode} {k}: no $SIR row, the table survives $SPAWN: {_sir(frames)}"
                assert [f for f in frames if f.startswith("$TMP")] == [SPAWN_PROTECT_ON], f"{mode} {k}"
            assert b["spawn_protect_off"] == SPAWN_PROTECT_OFF, mode


def test_the_protection_frames_are_the_bench_frames_byte_for_byte():
    assert SPAWN_PROTECT_ON == "$TMP,,,,,,,,-100,,,,*" and SPAWN_PROTECT_OFF == "$TMP,,,,,,,,0,,,,*"
    for f in (SPAWN_PROTECT_ON, SPAWN_PROTECT_OFF):
        assert f.count(",") == 12, f"{f}: a $TMP frame always carries all twelve commas"
        assert f.split(",")[8] in ("-100", "0"), f"{f}: the value sits on t8"


def test_assert_spawn_shielded_raises_when_the_order_is_reversed():
    """Levers §23 step 5: t8 BEFORE `$SPAWN` is wiped, so the player goes live unprotected."""
    good = ["$SPAWN,,*", SPAWN_PROTECT_ON, "$TID,1,*", "$AMMO,0,32,192,1,*", "$BMAP,0,0,,,,,*"]
    assert_spawn_shielded(good, "revive")
    for bad, why in (([SPAWN_PROTECT_ON, "$SPAWN,,*", "$TID,1,*"], "t8 before $SPAWN"),
                     (["$SPAWN,,*", "$TID,1,*", SPAWN_PROTECT_ON], "t8 after $TID"),
                     (["$SPAWN,,*", "$TID,1,*"], "no t8 at all"),
                     (["$SPAWN,,*", "$TMP,,,,,,,,-100,,,*", "$TID,1,*"], "a short $TMP"),
                     (["$SIR,0,0,,28,0,0,1,,*", "$SPAWN,,*", SPAWN_PROTECT_ON, "$TID,1,*"], "the old fn-28 twin"),
                     (["$SIR,0,0,,1,0,0,1,,*", "$SPAWN,,*", SPAWN_PROTECT_ON, "$TID,1,*"], "a live row")):
        try:
            assert_spawn_shielded(bad, "revive")
            raise AssertionError(f"expected the guard to raise on {why}")
        except ValueError as e:
            assert "F121" in str(e) and "revive" in str(e), (why, e)


def test_the_sir_pool_take_is_the_one_carrier_of_the_real_table():
    b = C.compile(_cfg(), _player(), _TEAMS)
    assert b["sir_pool"] == [list(_SIR_TABLE)], "class sounds off: one take, the stock table verbatim"
    for mode in ("koth", "domination"):
        b = C.compile(_cfg(mode), _player(), _TEAMS)
        assert _OBJECTIVE_SIR_ROW in b["sir_pool"][0], f"{mode}: the take keeps the beacon row"


def test_with_class_sounds_on_every_take_is_a_real_table():
    """A17's rolled takes are the carrier too; the stock rows never ride the spawn or revive write."""
    b = C.compile(_cfg(hit_audio_class=True), _player(), _TEAMS)
    assert len(b["sir_pool"]) > 1, "class sounds on: the rolled pool"
    for take in b["sir_pool"]:
        assert set(_sir_cells(take)) >= set(_sir_cells(_sir(b["head"]))) - {("15", "0")}
        assert set(_sir_index(take).values()) & {1, 36, 37, 38}, "a take is a REAL table, not a registrar"


# ---- (c) the hill row survives, (d) fn 24-27 never ship pregame ---------------
def test_the_hill_beacon_row_is_untouched_in_both_tables():
    """F70/F79: an objective mode with no `$SIR,15,0` row discards every hill beacon in silence. The
    row is ALREADY a silent fn-28 registrar, so spawn protection reproduces it byte for byte — and the
    F79 guard still runs on the head, where the row has to be for the guard to mean anything."""
    for mode in ("koth", "domination"):
        b = C.compile(_cfg(mode), _player(), _TEAMS)
        assert _OBJECTIVE_SIR_ROW in b["head"], f"{mode} head cannot hear its own beacon"
        assert _OBJECTIVE_SIR_ROW in b["sir_pool"][0], f"{mode} arm take cannot hear its own beacon"
    # CONTROL: a non-objective mode ships no proto-15 cell in either table
    b = C.compile(_cfg("tdm"), _player(), _TEAMS)
    assert not any(f.startswith("$SIR,15,0,") for f in b["head"] + b["spawn"])


def test_the_delayed_blast_family_never_reaches_a_pregame_table():
    """fn 24 must never reach a PREGAME table, which is the rule this guard exists for.

    ⚠ What fn 24 actually does was re-measured on 2026-09-18 and it is not a delayed blast: a single
    word applies NO damage and leaves the victim's gun manufacturing a fake `$HIR` every 5.07 s until
    the next `$SPAWN`, with sound, vibration and a headset flash, so the player is told they are being
    shot by nobody for the rest of the life (P18, closed). 25, 26 and 27 do the same.

    Both cells that used to carry it were fixed the same day: the Energy Launcher's `<9,3>` row went to
    fn 1 (it is why that weapon dealt zero damage), and A20's stun cell went to fn 23 (F253), which is
    the real primitive: accuracy to 0, no pool change, automatic recovery, nothing left behind. So the
    assertion is now the strongest one available: **the phantom family reaches NO shipped table, in any
    configuration, pregame or live.** If a future feature wants a delayed effect, it does not get one
    from 24-27, and this guard is what says so."""
    for cfg in (_cfg(), _cfg(stun={"duration_s": 10})):
        b = C.compile(cfg, _player(weapons=("charge_rifle", "shotgun")), _TEAMS)
        for table in ("head", "spawn", "revive"):
            assert not (set(_fns(b[table])) & {24, 25, 26, 27}), f"{table}: {_sir(b[table])}"


# ---- the guards themselves ----------------------------------------------------
def test_assert_spawn_protected_raises_on_the_bug_it_exists_to_catch():
    """The pre-A23 head, exactly: the stock table in the lobby push."""
    try:
        assert_spawn_protected(["$CLEAR,*"] + list(_SIR_TABLE) + ["$TID,1,*"])
        raise AssertionError("expected the F121 guard to raise on a head carrying the live table")
    except ValueError as e:
        assert "F121" in str(e) and "fn 1" in str(e), e
    assert_spawn_protected(["$CLEAR,*"] + sir_spawn_protected(_SIR_TABLE) + ["$TID,1,*"])


def test_assert_arms_after_spawn_raises_on_the_F209_bundle_and_on_a_cell_left_disarmed():
    b = C.compile(_cfg(), _player(), _TEAMS)
    assert_arms_after_spawn(b["head"], b)
    # the bug itself: the pre-F209 shape, the live table leading the revive write
    pre = dict(b, revive=list(_SIR_TABLE) + [f for f in b["revive"] if not f.startswith("$SIR")])
    try:
        assert_arms_after_spawn(b["head"], pre)
        raise AssertionError("expected the guard to raise on a revive that arms before the gun can fire")
    except ValueError as e:
        assert "revive" in str(e) and "F121" in str(e), e
    # no off frame: every protected life would stay at 0 damage until the next $SPAWN, i.e. forever
    try:
        assert_arms_after_spawn(b["head"], {k: v for k, v in b.items() if k != "spawn_protect_off"})
        raise AssertionError("expected the guard to raise on a bundle with no spawn_protect_off")
    except ValueError as e:
        assert "spawn_protect_off" in str(e), e
    # a take that never re-arms melee: that cell would take nothing off the player all life
    short = dict(b, sir_pool=[[r for r in _SIR_TABLE if not r.startswith("$SIR,13,")]])
    try:
        assert_arms_after_spawn(b["head"], short)
        raise AssertionError("expected the guard to raise on a cell that never comes back")
    except ValueError as e:
        assert "13,1" in str(e) and "F121" in str(e), e
    try:
        assert_arms_after_spawn(b["head"], dict(b, sir_pool=[]))
        raise AssertionError("expected the guard to raise when nothing carries the real table")
    except ValueError as e:
        assert "sir_pool" in str(e), e


def test_assert_rearms_every_life_raises_when_neither_carrier_has_the_table():
    b = C.compile(_cfg(), _player(), _TEAMS)
    assert_rearms_every_life(b)
    try:
        assert_rearms_every_life(dict(b, sir_pool=[]))
        raise AssertionError("expected the F121 guard to raise when no revive path re-arms")
    except ValueError as e:
        assert "F121" in str(e), e
    try:
        assert_rearms_every_life(dict(b, team_flip={"3": ["$TID,3,*"] + list(_SIR_TABLE) + ["$SPAWN,,*"]}))
        raise AssertionError("expected the guard to raise on an infection flip that arms at once")
    except ValueError as e:
        assert "team_flip" in str(e), e
    try:
        assert_tmp_frames_whole(["$TMP,,,,,,,,-100,*"], "revive")
        raise AssertionError("expected the guard to raise on a $TMP frame without its twelve commas")
    except ValueError as e:
        assert "TMP GUARD" in str(e), e


def test_sir_spawn_protected_leaves_non_sir_frames_alone():
    assert sir_spawn_protected(["$TID,1,*"]) == ["$TID,1,*"]
    assert sir_spawn_protected(["$SIR,10,0,X13,1,0,100,2,60,*"]) == ["$SIR,10,0,,28,0,0,1,,*"]


# ---- the fixture the phone app builds against ---------------------------------
def test_the_golden_bundle_is_spawn_protected_too():
    """`app/src/demo.js` and the node's own tests import this file — a stale one ships the old head to
    every demo and every engine test."""
    b = golden_bundle()
    assert all(f == _SPAWN_PROTECT_FN for f in _fns(b["head"]))
    for k in ("spawn", "revive"):
        assert_spawn_shielded(b[k], k)
    assert b["spawn_protect_off"] == SPAWN_PROTECT_OFF
    assert b["sir_pool"] == [list(_SIR_TABLE)]


def test_a_MALFORMED_sir_row_is_rejected_rather_than_waved_through_pregame():
    """Round-2 review 2026-09-12: `_sir_cells` answered `("", "")` — "not a $SIR row" — for a row that
    IS one but carries no `<proto>,<sub>` cell.

    Both F121 guards key off that answer, and both then do the wrong thing with it: `sir_spawn_protected`
    copies the row into the pregame head VERBATIM (it looks like a `$TID`), and `assert_spawn_protected`
    skips it without reading its function. A truncated row out of a hand-written frame list therefore
    reached the countdown carrying whatever it carried, and the guard said the head was clean. A row
    that says `SIR` and cannot be parsed is now an error, which is the only honest answer: nothing here
    can tell what cell it would arm."""
    for bad in ("$SIR*", "$SIR,*", "$SIR,10,*"):
        for fn, label in ((_sir_cells, "_sir_cells"),
                          (sir_spawn_protected, "sir_spawn_protected"),
                          (assert_spawn_protected, "assert_spawn_protected")):
            try:
                fn([bad])
                raise AssertionError(f"{label} waved through the malformed row {bad!r}")
            except ValueError as e:
                assert "SIR" in str(e) and bad in str(e), (label, bad, str(e))
    # the guard still reads a WELL-FORMED row: an empty cell token is a real cell ("0"), not a parse failure
    assert _sir_cells(["$SIR,,,,28,0,0,1,,*"]) == [("0", "0")]
    assert sir_spawn_protected(["$SIR,,,,1,0,100,2,60,*"]) == ["$SIR,0,0,,28,0,0,1,,*"]
