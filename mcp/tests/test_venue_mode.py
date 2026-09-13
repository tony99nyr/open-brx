"""T1-C: MC driving the gun's indoor/outdoor (IR range) mode over BLE — the GATE, not the fix.

Field evidence (2026-09-12, `bug-dossier-2026-09-12.md` B6 / FOLLOWUPS **F162**): outdoor hit rates
ran ~7-32% against ~41% indoor, and Tony could not register a hit at 30-40 ft outside. The gun has a
native indoor/outdoor toggle (hold ALT 3 s) that changes IR range and LED brightness and PERSISTS
across power cycles (`docs/manual/operate.md`), and `$GSET` token 2 (`outdoorMode`) is the APK name
for the same setting — but **no candidate command has ever been flipped on a bench with a receiver
control**, so whether ANY of them moves emitted IR range is UNKNOWN.

⚠ THE INVARIANT THIS FILE EXISTS FOR: **shipping must not change what a gun emits today.**
`DRIVE_IO_MODE` is `"off"`, every compiled head is byte-identical to the pre-gate head, and the
candidate frames are only reachable by editing that one constant at the bench (Runs C/D/E in
`docs/experiment-log/2026-09.md`'s 2026-09-12 range entry).

Run: python3 run_tests.py venue_mode
"""
import brx_mcp.mc.compile as mcc
from brx_mcp.mc.compile import Compiler
from _session import match_config

C = Compiler()

_TEAMS = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
          {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 2}]


def _cfg(environment="indoor"):
    c = match_config("tdm", teams=_TEAMS)
    c["environment"] = environment
    return c


def _player(num=7, team="blue"):
    return {"player_id": f"p{num}", "player_num": num, "display": "REAPER", "team_id": team,
            "node_id": None, "gun_id": None, "voice": "male", "ready": True,
            "loadout": {"weapons": [{"weapon_id": "assault_rifle"}]}}


def _head(environment):
    return C.compile(_cfg(environment), _player(), _TEAMS)["head"]


# ---- the ship gate -------------------------------------------------------
def test_drive_io_mode_ships_off():
    """The one line a bench session edits. If this test fails, somebody shipped a value that changes
    emitted IR — re-read F162 before touching it."""
    assert mcc.DRIVE_IO_MODE == "off"


def test_off_emits_nothing_and_leaves_gset_alone():
    """`"off"` = no venue-mode frame at all, at either venue, and the ONE `$GSET` the head has always
    carried is untouched (t2 `outdoorMode` still tracks the venue exactly as it did before the gate)."""
    for env, t2 in (("indoor", "0"), ("outdoor", "1")):
        head = _head(env)
        assert mcc.venue_mode_frames(head[3], env) == []
        gsets = [f for f in head if f.startswith("$GSET")]
        assert gsets == [f"$GSET,0,{t2},1,0,1,0,50,1,*"], f"{env}: {gsets}"
        assert not any(f.startswith("$IRTX") for f in head), f"{env}: an $IRTX reached a shipped head"


def test_head_is_byte_identical_to_the_pre_gate_head():
    """The head the field ran on 2026-09-12, pinned frame for frame. Anything the gate adds while it
    is `"off"` shows up here as a diff."""
    head = _head("outdoor")
    assert head[:4] == ["$VOL,90,0,*", "$CLEAR,*", "$START,*", "$GSET,0,1,1,0,1,0,50,1,*"], head[:4]
    # $PSET's tail is the per-player voice pack (A15) and belongs to other tests; what this one pins
    # is that NOTHING sits between $GSET and $PSET, and nothing between $PSET and the first $WEAP.
    assert head[4].startswith("$PSET,7,0,45,70,70,50,,"), head[4]
    assert head[5].startswith("$WEAP,0,"), head[5]


# ---- the candidates, as they would land at the bench ---------------------
_GSET = "$GSET,0,1,1,0,1,0,50,1,*"          # the outdoor head's own $GSET, t3 = 1 as shipped
_GSET_IN = "$GSET,0,0,1,0,1,0,50,1,*"       # the indoor one


def test_candidate_gset_t3_reissues_the_same_gset_with_only_token_3_moved():
    """Candidate (b): `$GSET` t3 `gunLaserRegion`, the field the manual calls "the one field that
    looks like a direct power control ... the first thing to try" (`docs/manual/dev.md`). The frame
    is a BYTE COPY of the head's own `$GSET` with exactly one token changed, so a bench run moves one
    variable. Indoor keeps the captured/shipped region (1) and emits nothing; outdoor is the venue
    that is failing, so it gets the untried region (0)."""
    assert mcc.venue_mode_frames(_GSET, "outdoor", mode="gset_t3") == ["$GSET,0,1,0,0,1,0,50,1,*"]
    assert mcc.venue_mode_frames(_GSET_IN, "indoor", mode="gset_t3") == []
    # an unknown venue resolves to today's value, so it can never emit a surprise
    assert mcc.venue_mode_frames(_GSET, None, mode="gset_t3") == []


def test_candidate_irtx_is_the_eleven_field_shape_with_zero_damage():
    """Candidate (c): `$IRTX`. ⚠ The 4-field `iRPower,soundOnHit,rangeOutdoor,rangeIndoor` list in
    `protocol/callsign-extract/protocol-classes.md` is SUPERSEDED — the 2026-09-04 metadata read
    recovered an 11-field shape and the 4-field guess had already emitted ZERO IR against a receiver
    control (`protocol/brx-protocol.md`). In its real shape `$IRTX` TRANSMITS, so this frame carries
    Damage 0 and player id 0 (uncredited) and the range/power pair is the only thing the venue moves."""
    assert mcc.venue_mode_frames(_GSET, "outdoor", mode="irtx") == ["$IRTX,0,0,0,0,0,0,100,100,0,0,0,*"]
    assert mcc.venue_mode_frames(_GSET_IN, "indoor", mode="irtx") == ["$IRTX,0,0,0,0,0,0,75,75,0,0,0,*"]


def test_the_two_candidates_are_never_both_emitted():
    """One gate, one family of frames: a run that emits both proves nothing about either."""
    for env in ("indoor", "outdoor"):
        for mode in ("off", "gset_t3", "irtx"):
            frames = mcc.venue_mode_frames(_GSET if env == "outdoor" else _GSET_IN, env, mode=mode)
            kinds = {f.split(",")[0] for f in frames}
            assert len(kinds) <= 1, f"{env}/{mode} mixed families: {frames}"
            if mode == "off":
                assert frames == []
            elif mode == "gset_t3":
                assert all(f.startswith("$GSET,") for f in frames)
            else:
                assert all(f.startswith("$IRTX,") for f in frames)


def test_an_unrecognised_gate_value_refuses_rather_than_transmitting():
    """⚠ A TYPO AT THE BENCH MUST NOT FIRE IR. The gate is edited by hand between rungs, and `$IRTX`
    is the one candidate that TRANSMITS — so "anything that is not off or gset_t3" must never be
    allowed to mean "irtx". `Literal` + pyright catch a typo in the module constant; this catches one
    that reaches the function any other way (a bench driver, a mangled env read, a rename)."""
    for typo in ("gset", "GSET_T3", "on", "true", "", "IRTX"):
        try:
            frames = mcc.venue_mode_frames(_GSET, "outdoor", mode=typo)  # type: ignore[arg-type]
        except ValueError:
            continue                       # refusing loudly is the intended behaviour
        assert frames == [], f"{typo!r} silently emitted {frames}"


def test_unknown_venue_tracks_the_indoor_value_rather_than_a_literal():
    """Both candidate tables resolve an unknown venue to their INDOOR entry, by reference. A
    hardcoded fallback stops tracking the table the moment a bench result moves indoor."""
    was = dict(mcc.GSET_T3_BY_ENV)
    try:
        mcc.GSET_T3_BY_ENV["indoor"] = 7
        # the head already carries t3 = 1, so an unknown venue that resolved to a literal 1 would
        # emit nothing; one that follows the table re-issues t3 = 7
        assert mcc.venue_mode_frames(_GSET, None, mode="gset_t3") == ["$GSET,0,1,7,0,1,0,50,1,*"]
    finally:
        mcc.GSET_T3_BY_ENV.clear()
        mcc.GSET_T3_BY_ENV.update(was)


def test_gate_reaches_the_head_when_it_is_turned_on():
    """The bench edit actually lands, and it lands RIGHT AFTER `$GSET` (before `$PSET`) — the
    position the Run C/D/E procedures assume.

    Hand-rolled setattr rather than pytest's `monkeypatch`: `run_tests.py` calls test functions with
    no arguments, so a fixture parameter makes the test uncollectable there (and `run_tests.py` is
    the suite that has to stay green under system python)."""
    was = mcc.DRIVE_IO_MODE
    try:
        mcc.DRIVE_IO_MODE = "gset_t3"           # type: ignore[assignment]
        head = _head("outdoor")
        assert head[3] == "$GSET,0,1,1,0,1,0,50,1,*"
        assert head[4] == "$GSET,0,1,0,0,1,0,50,1,*"
        assert head[5].startswith("$PSET,")

        mcc.DRIVE_IO_MODE = "irtx"              # type: ignore[assignment]
        head = _head("outdoor")
        assert head[3] == "$GSET,0,1,1,0,1,0,50,1,*"
        assert head[4] == "$IRTX,0,0,0,0,0,0,100,100,0,0,0,*"
        assert head[5].startswith("$PSET,")
    finally:
        mcc.DRIVE_IO_MODE = was
