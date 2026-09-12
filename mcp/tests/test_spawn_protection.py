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
bench-swept for player feedback, 2026-09-10), and the REAL table written in the spawn and revive
bursts. Cells persist across writes — only `$CLEAR` wipes the table — so this is a swap, not an
addition, and it is the same write the F11 repair path and A17's per-life `sir_pool` take already make.

Run: python3 run_tests.py spawn_protection
"""
from brx_mcp.gameconfig import _SIR_TABLE
from brx_mcp.mc.compile import (Compiler, _OBJECTIVE_SIR_ROW, _SPAWN_PROTECT_FN, _sir_cells,
                                _sir_index, assert_arms_at_spawn, assert_rearms_every_life,
                                assert_spawn_protected, golden_bundle, sir_spawn_protected)
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
    """Same cells, same order — the spawn table can only re-arm a cell the head already carries, and
    `assert_sir_covers_weapons` / `assert_sir_covers_objective` both run on the head."""
    b = C.compile(_cfg(), _player(), _TEAMS)
    assert _sir_cells(_sir(b["head"])) == _sir_cells(_sir(b["spawn"]))


# ---- (b) the spawn burst arms the real table ----------------------------------
def test_the_spawn_burst_carries_the_real_table_and_leads_with_it():
    b = C.compile(_cfg(), _player(), _TEAMS)
    rows = _sir(b["spawn"])
    assert rows == list(_SIR_TABLE), "the stock table, verbatim, where the player goes live"
    assert b["spawn"][:len(rows)] == rows, "armed BEFORE the $SPAWN that makes the player live"
    assert b["spawn"][len(rows)] == "$PLAYX,0,*" and b["spawn"][len(rows) + 1] == "$SPAWN,,*"


def test_every_life_gets_the_real_table_back():
    """A revive is not always preceded by a spawn: `engine.js _resyncNotLive` re-writes the HEAD on a
    LIVE node and revives from there, so a revive that did not re-arm would leave that player immortal
    for the rest of the match — F11 wearing the opposite hat."""
    b = C.compile(_cfg(), _player(), _TEAMS)
    assert _sir(b["revive"]) == list(_SIR_TABLE)
    assert b["revive"][0].startswith("$SIR"), "the table leads the revive write too"


def test_with_class_sounds_on_the_sir_pool_take_is_the_revive_carrier_instead():
    """A17 writes one `sir_pool` take immediately BEFORE `frames.revive` (engine.js `_revive`). Shipping
    the rows in both places would clobber that take's rolled sounds with one fixed draw, so exactly one
    carrier is active per bundle — and `assert_rearms_every_life` holds the invariant either way."""
    b = C.compile(_cfg(hit_audio_class=True), _player(), _TEAMS)
    assert b["sir_pool"], "class sounds on: the pool exists"
    assert not _sir(b["revive"]), "no second copy to clobber the take"
    assert _sir(b["spawn"]), "the first life still arms from the spawn burst"
    for take in b["sir_pool"]:
        assert set(_sir_cells(take)) >= set(_sir_cells(_sir(b["spawn"]))) - {("15", "0")}
        assert set(_sir_index(take).values()) & {1, 36, 37, 38}, "a take is a REAL table, not a registrar"


# ---- (c) the hill row survives, (d) fn 24-27 never ship pregame ---------------
def test_the_hill_beacon_row_is_untouched_in_both_tables():
    """F70/F79: an objective mode with no `$SIR,15,0` row discards every hill beacon in silence. The
    row is ALREADY a silent fn-28 registrar, so spawn protection reproduces it byte for byte — and the
    F79 guard still runs on the head, where the row has to be for the guard to mean anything."""
    for mode in ("koth", "domination"):
        b = C.compile(_cfg(mode), _player(), _TEAMS)
        assert _OBJECTIVE_SIR_ROW in b["head"], f"{mode} head cannot hear its own beacon"
        assert _OBJECTIVE_SIR_ROW in b["spawn"], f"{mode} spawn burst cannot hear its own beacon"
        assert _OBJECTIVE_SIR_ROW in b["revive"], f"{mode} revive cannot hear its own beacon"
    # CONTROL: a non-objective mode ships no proto-15 cell in either table
    b = C.compile(_cfg("tdm"), _player(), _TEAMS)
    assert not any(f.startswith("$SIR,15,0,") for f in b["head"] + b["spawn"])


def test_the_delayed_blast_family_never_reaches_a_pregame_table():
    """fn 24 registers on arrival and applies the word's magnitude ~4 s LATER (bench 2026-09-11). The
    stock table ships it on the Energy Launcher cell and A20's stun moves it onto the EMP cell, so both
    configurations are checked: pregame both are fn 28, live both are fn 24."""
    for cfg in (_cfg(), _cfg(stun={"duration_s": 10})):
        b = C.compile(cfg, _player(weapons=("charge_rifle", "shotgun")), _TEAMS)
        assert not (set(_fns(b["head"])) & {24, 25, 26, 27}), _sir(b["head"])
        assert 24 in set(_fns(b["spawn"])), "the live table keeps fn 24 where it belongs"


# ---- the guards themselves ----------------------------------------------------
def test_assert_spawn_protected_raises_on_the_bug_it_exists_to_catch():
    """The pre-A23 head, exactly: the stock table in the lobby push."""
    try:
        assert_spawn_protected(["$CLEAR,*"] + list(_SIR_TABLE) + ["$TID,1,*"])
        raise AssertionError("expected the F121 guard to raise on a head carrying the live table")
    except ValueError as e:
        assert "F121" in str(e) and "fn 1" in str(e), e
    assert_spawn_protected(["$CLEAR,*"] + sir_spawn_protected(_SIR_TABLE) + ["$TID,1,*"])


def test_assert_arms_at_spawn_raises_when_a_cell_is_left_disarmed():
    head = sir_spawn_protected(_SIR_TABLE)
    good = list(_SIR_TABLE)
    assert_arms_at_spawn(head, good + ["$SPAWN,,*"])
    short = [r for r in good if not r.startswith("$SIR,13,")]     # melee never re-armed
    try:
        assert_arms_at_spawn(head, short + ["$SPAWN,,*"])
        raise AssertionError("expected the F121 guard to raise on a cell that never comes back")
    except ValueError as e:
        assert "13,1" in str(e) and "F121" in str(e), e


def test_assert_rearms_every_life_raises_when_neither_carrier_has_the_table():
    b = C.compile(_cfg(), _player(), _TEAMS)
    assert_rearms_every_life(b)
    broken = dict(b, revive=[f for f in b["revive"] if not f.startswith("$SIR")])
    try:
        assert_rearms_every_life(broken)
        raise AssertionError("expected the F121 guard to raise when no revive path re-arms")
    except ValueError as e:
        assert "F121" in str(e), e


def test_sir_spawn_protected_leaves_non_sir_frames_alone():
    assert sir_spawn_protected(["$TID,1,*"]) == ["$TID,1,*"]
    assert sir_spawn_protected(["$SIR,10,0,X13,1,0,100,2,60,*"]) == ["$SIR,10,0,,28,0,0,1,,*"]


# ---- the fixture the phone app builds against ---------------------------------
def test_the_golden_bundle_is_spawn_protected_too():
    """`app/src/demo.js` and the node's own tests import this file — a stale one ships the old head to
    every demo and every engine test."""
    b = golden_bundle()
    assert all(f == _SPAWN_PROTECT_FN for f in _fns(b["head"]))
    assert _sir(b["spawn"]) == list(_SIR_TABLE) and _sir(b["revive"]) == list(_SIR_TABLE)


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
