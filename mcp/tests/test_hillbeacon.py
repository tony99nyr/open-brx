"""The grenade-hill bridge: real `$HIR` beacons → King of the Hill scoring.

**Every frame in this file was captured off hardware on 2026-09-10** (the evening entries in
`docs/experiment-log/2026-09.md`), copied here verbatim rather than invented, timestamps included.
Three captures matter, and two of them are the discriminating pair that settled `mag=53`:

  * a NEUTRAL → blue capture, which carried both `mag=50` and (5 s later) `mag=53`;
  * blue → red and red → blue captures, on continuous BLE streams, which carried **only `mag=50`**.

That is why "captured from neutral" vs "stolen from an enemy" is decidable at all, and why nothing
here waits for `mag=53` before acting.

Each behavioural test carries a CONTROL — a companion assertion that a do-nothing engine would
fail. "Possession accrues for the holder" is worthless without "and does NOT accrue for the team
that lost the point"; "a respawn station is ignored" is worthless without "and a hill is not".
"""

from brx_mcp.gameconfig import GameConfig
from brx_mcp.modes import DominationEngine, PlaySound, Callout, Score, GameOver, build_engine
from brx_mcp.modes import hillbeacon as hb
from brx_mcp.modes.base import shooter_player_id, shooter_team
from brx_mcp.modes.driver import assign_teams
from brx_mcp.protocol import parse_event
from sim import SimGame


def ev(frame: str) -> dict:
    """A frame exactly as the gun puts it on BLE, through the real parser."""
    return parse_event(frame)


def _types(actions, typ):
    return [a for a in actions if isinstance(a, typ)]


def _koth(**kw) -> GameConfig:
    base = dict(mode="koth", control_points=1, score_target=0, game_time_s=0)
    base.update(kw)
    return GameConfig(**base)


def _engine(teams=(("blue", 1), ("green", 3)), **kw) -> DominationEngine:
    e = DominationEngine(_koth(**kw))
    for pid, team in teams:
        e.add_player(pid, team)
    return e


# --------------------------------------------------------------------------- #
# The three captured capture sequences, verbatim (ms in the log → seconds here) #
# --------------------------------------------------------------------------- #
# Gun on team 1 (blue), a NEUTRAL grenade, one AR round. The grenade turned blue and beeped.
NEUTRAL_TO_BLUE = [
    (41.770, "$HIR,4,15,0,2,8,0,0"),     # last NEUTRAL beacon (team 2 = neutral)
    (41.820, "$HIR,4,15,0,1,50,0,0"),    # mag 50, 50 ms after the shot: NEW OWNER = team 1
    (46.780, "$HIR,0,15,0,2,53,0,0"),    # mag 53, 5 s LATER, headset sensor: the state LEFT
    (46.780, "$HIR,4,15,0,1,8,0,0"),     # ... same millisecond, gun sensor: first blue hill beacon
    (51.720, "$HIR,4,15,0,1,8,0,0"),
    (56.770, "$HIR,4,15,0,1,8,0,0"),
    (61.780, "$HIR,4,15,0,1,8,0,0"),
    (66.790, "$HIR,4,15,0,1,8,0,0"),
]

# `$TID` live-written to 0 (red) mid-session, then the gun shot a BLUE-held hill. No `mag=53`
# anywhere in the stream -- the whole point of the run.
BLUE_TO_RED = [
    (291.755, "$HIR,4,15,0,1,8,0,0"),    # blue still holds it
    (292.265, "$HIR,4,15,0,0,50,0,0"),   # mag 50: NEW OWNER = team 0 (red). Team 0 is a REAL team.
    (296.835, "$HIR,4,15,0,0,8,0,0"),
    (301.845, "$HIR,4,15,0,0,8,0,0"),
]

RED_TO_BLUE = [
    (406.846, "$HIR,4,15,0,0,8,0,0"),
    (411.846, "$HIR,4,15,0,0,8,0,0"),
    (432.472, "$HIR,4,15,0,1,50,0,0"),   # mag 50 only -- second enemy-to-enemy capture, n=2
    (436.846, "$HIR,4,15,0,1,8,0,0"),
]

# Rung S: 20+ consecutive beacons off a neutral grenade, period 5.0 s, zero misses.
NEUTRAL_HEARTBEAT = [(t, "$HIR,4,15,0,2,8,0,0")
                     for t in (534.5, 539.4, 544.5, 549.5, 554.5, 559.5)]

# F85: ONE transmission arriving as TWO $HIR on different sensors, 14 ms apart.
DOUBLE_BEACON = [(684.500, "$HIR,4,15,0,2,8,0,0"),      # sensor 4, gun body
                 (684.514, "$HIR,0,15,0,2,8,0,0")]      # sensor 0, headset front -- SAME beacon

# The hill's OTHER word: ambient protocol-0 damage, wire id 0, that drains an intruder (F69).
HILL_DAMAGE = "$HIR,0,0,0,1,8,0,0"
# A real player's shot for contrast: wire id 1, team 1.
REAL_SHOT = "$HIR,0,0,1,1,9,0,3"
# A respawn station: same protocol, same $SIR cell, magnitude 6 instead of 8.
RESPAWN_STATION = "$HIR,0,15,0,1,6,0,0"
# The $HP echo a registration emits with the pools completely unchanged.
BEACON_HP_ECHO = "$HP,45,70,0"


def _replay(e, frames, player_id="blue"):
    """Feed a captured sequence; returns the Actions per frame, in order."""
    return [e.on_event(player_id, ev(f), now=t) for t, f in frames]


def _play(e, frames, until, dt=1.0, player_id="blue"):
    """Interleave the captured frames with a 1 s tick cadence, in time order.

    ⚠ Scoring MUST be driven this way. `tick()` credits the whole interval since the last tick to
    the CURRENT owner (its own comment says so, bounded in `run_live` by a ~0.5 s cadence), so a
    single tick after a 60 s gap credits all 60 s to whoever happens to hold the point at the end.
    Every point-second asserted below would then be an artefact of the test's tick pattern rather
    than of possession.
    """
    q = list(frames)
    t = 0.0
    while t <= until:
        while q and q[0][0] <= t:
            ft, f = q.pop(0)
            e.on_event(player_id, ev(f), now=ft)
        e.tick(now=t)
        t += dt


# --------------------------------------------------------------------------- #
# 1. Neutral is team 2, and team 2 is nobody                                   #
# --------------------------------------------------------------------------- #
def test_a_neutral_beacon_owns_the_point_for_nobody():
    """Team 2 on the wire means NEUTRAL. A reader that passed 2 through as an owner would accrue
    possession for a team that does not exist -- and, under F82, for real players if anyone were
    rostered there."""
    r = hb.HillBeaconReader()
    r.on_event("blue", ev("$HIR,4,15,0,2,8,0,0"), now=0.0)
    assert r.owner is None and r.neutral is True
    # CONTROL: the identical frame with team 1 DOES name an owner, so "owner is None" cannot be
    # satisfied by a reader that simply never resolves one.
    r2 = hb.HillBeaconReader()
    r2.on_event("blue", ev("$HIR,4,15,0,1,8,0,0"), now=0.0)
    assert r2.owner == 1 and r2.neutral is False


def test_nobody_scores_while_the_hill_is_neutral():
    e = _engine()
    _replay(e, NEUTRAL_HEARTBEAT)
    e.tick(now=580.0)
    assert e.snapshot()["score"] == {1: 0, 3: 0}, "a neutral hill scored for somebody"
    # CONTROL: the same engine, one owned beacon, does accrue.
    e.on_event("blue", ev("$HIR,4,15,0,1,8,0,0"), now=580.0)
    e.tick(now=590.0)
    assert e.snapshot()["score"][1] == 10


# --------------------------------------------------------------------------- #
# 2. Possession scoring off the real beacons                                   #
# --------------------------------------------------------------------------- #
def test_koth_scores_possession_for_the_team_that_holds_the_hill():
    e = _engine()
    _play(e, NEUTRAL_TO_BLUE, until=66.0)
    s = e.snapshot()
    assert s["owner"]["A"] == 1
    # blue captured at t=41.820, so the ticks at 42.0 … 66.0 accrue to it: 25 point-seconds.
    assert s["score"][1] == 25, s["score"]
    # CONTROL: green was in the game the whole time and holds nothing, so it accrues nothing.
    assert s["score"][3] == 0, "possession accrued for a team that never held the point"


def test_a_steal_moves_the_accrual_to_the_new_holder():
    e = _engine(teams=(("blue", 1), ("red", 0)))
    _play(e, NEUTRAL_TO_BLUE + BLUE_TO_RED, until=301.0)
    s = e.snapshot()["score"]
    assert s[1] == 251, s                          # blue: ticks 42.0 … 292.0 (red takes it at 292.265)
    assert s[0] == 9, s                            # red:  ticks 293.0 … 301.0
    # CONTROL: blue's total is FROZEN by the steal, not still climbing. Without this, "red scores 9"
    # would be satisfied just as well by an engine that credits every owner it has ever seen.
    e.tick(now=320.0)
    after = e.snapshot()["score"]
    assert after[1] == 251 and after[0] > 9, after


def test_the_hill_reaches_a_score_target_and_ends_the_game():
    e = _engine(score_target=10)
    _play(e, NEUTRAL_TO_BLUE, until=50.0)           # ticks 42.0 … 50.0 = 9 point-seconds
    assert not e.over, e.snapshot()["score"]
    over = _types(e.tick(now=51.0), GameOver)       # the 10th → win
    assert over and over[0].winner == "team1"


# --------------------------------------------------------------------------- #
# 3. mag=50 alone triggers; mag=53 only says what was LEFT                     #
# --------------------------------------------------------------------------- #
def test_the_capture_fires_on_mag_50_and_does_not_wait_for_mag_53():
    """`mag=50` arrived 50 ms after the shot; `mag=53` arrived 5 s later on the next beacon cycle.
    A node that waited for both would announce every capture five seconds late -- and would never
    announce an enemy-to-enemy one at all, because there `53` never comes."""
    e = _engine()
    per_frame = _replay(e, NEUTRAL_TO_BLUE)
    at_50 = per_frame[1]                            # t=41.820
    assert _types(at_50, PlaySound), "nothing announced on mag=50"
    assert e.snapshot()["owner"]["A"] == 1, "the point did not change hands on mag=50 alone"
    # CONTROL: the mag=53 frame five seconds later announces no SECOND capture.
    at_53 = per_frame[2]                            # t=46.780
    assert not _types(at_53, PlaySound)


def test_mag_53_never_hands_the_point_back_to_neutral():
    """The `mag=53` frame carries team **2** in the team field -- the state that was LEFT, not the
    new owner. Adopting it would flip a freshly captured point straight back to neutral one beacon
    after every capture from neutral."""
    e = _engine()
    _replay(e, NEUTRAL_TO_BLUE[:3])                 # ... up to and including the mag=53
    assert e.snapshot()["owner"]["A"] == 1
    assert e.beacons.neutral is False


def test_captured_from_neutral_and_stolen_from_an_enemy_are_told_apart():
    """The discriminating pair, both from continuous BLE streams so neither can be blamed on a
    missed window: the neutral→blue capture carried `mag=53`, and BOTH enemy-to-enemy captures
    (blue→red, red→blue) carried only `mag=50`."""
    r = hb.HillBeaconReader()
    caps = []
    for t, f in NEUTRAL_TO_BLUE + BLUE_TO_RED + RED_TO_BLUE:
        caps += [b for b in r.on_event("blue", ev(f), now=t) if isinstance(b, hb.PointCaptured)]
    assert [c.owner for c in caps] == [1, 0, 1]
    assert [c.from_neutral for c in caps] == [True, False, False], \
        "the mag=53 distinction was lost"


def test_a_steal_tells_the_two_sides_different_things():
    """A capture from neutral is one fact for everybody. A steal is two at once, so it is per-team:
    the side that took the point hears "Hill Captured", the side that lost it hears "Hill Lost"."""
    e = _engine(teams=(("blue", 1), ("red", 0)))
    from_neutral = _replay(e, NEUTRAL_TO_BLUE[:2])[1]
    assert [(p.sound_id, p.scope) for p in _types(from_neutral, PlaySound)] == \
        [(hb.HILL_CAPTURED, "all")]
    steal = _replay(e, BLUE_TO_RED)[1]              # red takes it off blue
    heard = {p.scope: p.sound_id for p in _types(steal, PlaySound)}
    assert heard == {"red": hb.HILL_CAPTURED, "blue": hb.HILL_LOST}, heard


# --------------------------------------------------------------------------- #
# 4. Team 0 is red, not a malformed token                                      #
# --------------------------------------------------------------------------- #
def test_a_capture_by_team_zero_is_scored_because_zero_is_red_on_the_wire():
    """The station `$CAPTURE` path treats a zero team as a malformed token. A BEACON's team is the
    wire's 2-bit `$TID` field, where **0 is red** -- bench-captured taking a blue-held hill. Routing
    beacons through the station guard would silently drop every capture by one of the four teams."""
    e = _engine(teams=(("blue", 1), ("red", 0)))
    _play(e, BLUE_TO_RED, until=301.0)
    s = e.snapshot()
    assert s["owner"]["A"] == 0
    assert s["score"][0] == 9, s["score"]           # red: ticks 293.0 … 301.0
    # CONTROL: the same engine still refuses a zero team on the STATION path, where it means
    # "malformed", so this is not a blanket "zero is fine now".
    e2 = _engine()
    e2.on_event("st", {"command": "CAPTURE", "tokens": ["CAPTURE", "A", "0"]}, now=0.0)
    assert e2.snapshot()["owner"]["A"] is None


# --------------------------------------------------------------------------- #
# 5. mag=6 is a respawn station, not a hill                                    #
# --------------------------------------------------------------------------- #
def test_a_respawn_station_beacon_never_takes_the_hill():
    """Same protocol, same `$SIR` cell, different device: magnitude 6 is a respawn station and 8 is
    a hill. Treating 6 as a hill would hand the point to whichever team owns the respawn box."""
    e = _engine()
    e.on_event("blue", ev(RESPAWN_STATION), now=1.0)
    e.tick(now=11.0)
    assert e.snapshot()["owner"]["A"] is None, "a respawn station captured the hill"
    assert e.snapshot()["score"] == {1: 0, 3: 0}
    # CONTROL: the SAME frame with magnitude 8 does take it -- so this is a check on the magnitude,
    # not on an engine that ignores protocol 15 altogether.
    e.on_event("blue", ev(RESPAWN_STATION.replace(",6,", ",8,")), now=11.0)
    assert e.snapshot()["owner"]["A"] == 1


def test_a_respawn_station_does_not_make_a_player_present_on_the_hill():
    r = hb.HillBeaconReader()
    r.on_event("blue", ev(RESPAWN_STATION), now=1.0)
    assert r.is_present("blue", now=1.0) is False
    r.on_event("blue", ev("$HIR,4,15,0,1,8,0,0"), now=2.0)     # CONTROL: a hill beacon does
    assert r.is_present("blue", now=2.0) is True


# --------------------------------------------------------------------------- #
# 6. The ambient damage word is not a beacon and credits nobody (F69)          #
# --------------------------------------------------------------------------- #
def test_the_hills_damage_word_never_moves_the_point():
    """The hill's second word is an ordinary protocol-0 shot carrying wire id 0 -- the one that
    drains an intruder. It must not be read as a beacon: protocol 0 is not protocol 15."""
    assert hb.parse(ev(HILL_DAMAGE)) is None
    e = _engine()
    for t in (0.0, 5.0, 10.0, 15.0):
        e.on_event("blue", ev(HILL_DAMAGE), now=t)
    e.tick(now=20.0)
    assert e.snapshot()["owner"]["A"] is None
    assert e.snapshot()["score"] == {1: 0, 3: 0}
    # CONTROL: a real proto-15 beacon on the same engine DOES move it.
    assert hb.parse(ev("$HIR,4,15,0,1,8,0,0")) is not None


def test_the_hills_damage_word_is_refused_for_attribution():
    """F69's guard, re-checked on the objective path: `$HIR` wire id 0 is A5.1's "no identity",
    never a player, so a hill can never be credited with a kill."""
    assert shooter_team(ev(HILL_DAMAGE)) is None
    assert shooter_player_id(ev(HILL_DAMAGE)) is None
    assert shooter_team(ev(NEUTRAL_TO_BLUE[0][1])) is None      # and the beacon itself
    # CONTROL: a real shot still resolves, so "returns None" is not the answer to everything.
    assert shooter_team(ev(REAL_SHOT)) == 1
    assert shooter_player_id(ev(REAL_SHOT)) == 1


# --------------------------------------------------------------------------- #
# 7. One transmission, two sensors (F85)                                       #
# --------------------------------------------------------------------------- #
def test_one_transmission_heard_on_two_sensors_counts_once():
    """A gun reports the same beacon on sensor 4 and sensor 0, 14 ms apart. Anything that counts
    or ticks per `$HIR` would run at double rate."""
    r = hb.HillBeaconReader()
    for t, f in DOUBLE_BEACON:
        r.on_event("blue", ev(f), now=t)
    assert r.beacons_heard == 1
    # CONTROL: two beacons a real period apart are two, so the dedupe is not just swallowing
    # everything after the first.
    r.on_event("blue", ev("$HIR,4,15,0,2,8,0,0"), now=689.5)
    assert r.beacons_heard == 2


def test_the_capture_pair_is_not_deduped_away():
    """⚠ The trap in deduping on TIME alone: a real capture puts `mag=53` and `mag=8` on the wire
    in the SAME millisecond on different sensors (t=46.780 in the capture above). A time window
    would eat one of them; deduping on IDENTITY -- owner + magnitude -- keeps both."""
    r = hb.HillBeaconReader()
    out = []
    for t, f in NEUTRAL_TO_BLUE[:4]:
        out += r.on_event("blue", ev(f), now=t)
    kinds = [type(o).__name__ for o in out]
    assert "NeutralCaptureConfirmed" in kinds and kinds.count("HillBeacon") == 2, kinds


# --------------------------------------------------------------------------- #
# 8. Presence expires on two missed beacons, not one (rung R)                  #
# --------------------------------------------------------------------------- #
def test_presence_survives_one_missed_beacon_and_expires_after_two():
    """Reception goes intermittent at the edge of range, so a single miss is normal reception --
    not "left the hill"."""
    r = hb.HillBeaconReader()
    r.on_event("blue", ev("$HIR,4,15,0,1,8,0,0"), now=100.0)
    assert r.is_present("blue", now=105.1) is True      # one missed beacon
    assert r.is_present("blue", now=111.9) is True      # two missed, still inside the grace
    assert r.is_present("blue", now=112.1) is False     # past ~12 s → gone
    assert [e.player_id for e in r.expire(now=112.1)] == ["blue"]
    assert r.expire(now=113.0) == [], "presence lapsed twice for one departure"
    # CONTROL: hearing another beacon re-arms them.
    r.on_event("blue", ev("$HIR,4,15,0,1,8,0,0"), now=120.0)
    assert r.is_present("blue", now=121.0) is True


def test_the_hill_grace_is_wider_than_the_beacon_period():
    """F84, as an assertion rather than a comment: three host constants in one day were narrower
    than the emitter's own 5 s period, and each one broke silently."""
    assert hb.PRESENCE_GRACE_S > 2 * hb.BEACON_PERIOD_S


# --------------------------------------------------------------------------- #
# 9. F82: nobody may be rostered on team 2                                      #
# --------------------------------------------------------------------------- #
def test_a_hill_mode_refuses_a_player_on_the_neutral_team():
    e = DominationEngine(_koth())
    try:
        e.add_player("blue", 2)
        raise AssertionError("F82: a hill mode accepted a player on team 2")
    except ValueError as exc:
        assert "F82" in str(exc)
    # CONTROL: every other valid $TID is accepted, so this is not a broken add_player.
    for team in (0, 1, 3):
        DominationEngine(_koth()).add_player("p", team)


def test_the_default_hill_rosters_never_produce_team_two():
    for mode in ("domination", "koth"):
        teams = assign_teams(mode, ["a", "b", "c", "d"])
        assert 2 not in teams.values(), teams
        assert len(set(teams.values())) == 2, teams
    # CONTROL: the modes that legitimately use team 2 still do (infection's seed).
    assert 2 in assign_teams("infection", ["a", "b"]).values()


def _mc_validate(mode, tid):
    """A minimal MC config/roster through the real compiler's validate()."""
    from brx_mcp.mc.compile import Compiler
    teams = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
             {"team_id": "other", "name": "Other", "color": "yellow", "tid": tid}]
    cfg = {"config_id": "c1", "mode": mode, "environment": "indoor", "night": False,
           "time_limit_s": 600, "respawn": {"type": "auto", "delay_s": 15},
           "scoring": {"frag_limit": 0, "win_by": "kills"},
           "health": {"max_hp": 45, "max_armor": 70}, "teams": teams}
    roster = [{"player_id": f"p{n}", "player_num": n, "display": "X", "team_id": t,
               "node_id": None, "gun_id": None, "voice": "male", "ready": True,
               "loadout": {"weapons": [{"weapon_id": "assault_rifle"}]}}
              for n, t in ((1, "blue"), (2, "other"))]
    return Compiler().validate(cfg, roster, {"station_source": "grenade"})


def test_mc_validate_refuses_a_hill_roster_on_tid_two():
    bad = _mc_validate("koth", 2)
    assert not bad["ok"] and any("F82" in e for e in bad["errors"]), bad["errors"]
    assert any("F82" in e for e in _mc_validate("domination", 2)["errors"])
    # CONTROL: the identical config on tid 3 raises no F82 error, so the guard is reading the tid
    # and not simply objecting to every hill roster.
    assert not any("F82" in e for e in _mc_validate("koth", 3)["errors"])
    # CONTROL: and tid 2 is still fine in a mode with no hill, where 2 is an ordinary team.
    assert not any("F82" in e for e in _mc_validate("tdm", 2)["errors"])


# --------------------------------------------------------------------------- #
# 10. Adopting an owner we never saw captured                                  #
# --------------------------------------------------------------------------- #
def test_an_already_held_hill_is_adopted_silently():
    """A node that joins a hill already held (or misses the mag=50 out of range) must still SCORE it
    correctly -- but must not announce a capture that happened minutes ago."""
    e = _engine()
    for t in range(0, 11):                          # a quiet first 10 s -- nobody is heard from
        e.tick(now=float(t))
    acts = e.on_event("blue", ev("$HIR,4,15,0,1,8,0,0"), now=10.5)
    assert e.snapshot()["owner"]["A"] == 1
    assert not _types(acts, PlaySound), "announced a capture it never saw"
    for t in range(11, 21):                         # ticks 11.0 … 20.0 accrue to blue
        e.tick(now=float(t))
    assert e.snapshot()["score"][1] == 10, e.snapshot()["score"]
    # CONTROL: an actual mag=50 on the same engine DOES announce.
    assert _types(e.on_event("blue", ev("$HIR,4,15,0,3,50,0,0"), now=20.0), PlaySound)


# --------------------------------------------------------------------------- #
# 10b. An owner that is not in this match owns the point but scores nothing     #
# --------------------------------------------------------------------------- #
def test_a_hill_owned_by_a_team_not_in_the_match_scores_nothing():
    """Grenades PERSIST their ownership between games (F70: ten straight beacons on one owner). A
    hill still held by RED from an earlier match, carried into a blue/green game, beacons red from
    the first second — and the adoption is silent by design, which is exactly what would hide this.
    A team that cannot field a player cannot hold a point: the ownership is real and still reported,
    but it accrues nothing."""
    stream = [(t, "$HIR,4,15,0,0,8,0,0") for t in (1.0, 6.0, 11.0, 16.0)]
    e = _engine()                                    # blue=1, green=3 -- nobody on team 0
    _play(e, stream, until=20.0)
    s = e.snapshot()
    assert s["owner"]["A"] == 0, s["owner"]           # ownership is REAL and still reported
    assert s["hill"]["owner_in_play"] is False
    assert 0 not in s["score"], s["score"]            # ... and scores nothing
    assert s["score"] == {1: 0, 3: 0}, s["score"]
    # CONTROL: the identical stream owned by a ROSTERED team does accrue. Without it, "scores
    # nothing" would be satisfied just as well by an engine that had stopped scoring at all.
    e2 = _engine()
    _play(e2, [(t, f.replace(",0,8,", ",1,8,")) for t, f in stream], until=20.0)
    s2 = e2.snapshot()
    assert s2["score"][1] == 20, s2["score"]          # ticks 1.0 … 20.0
    assert s2["hill"]["owner_in_play"] is True


def test_a_team_not_in_the_match_cannot_win_on_the_clock():
    """The half that turns the bug above into a wrong RESULT: `_leader()` reads `_acc`, so an
    unrostered team that accrued anything at all could be announced as the winner."""
    stream = [(t, "$HIR,4,15,0,0,8,0,0") for t in (1.0, 6.0, 11.0)]
    e = _engine(game_time_s=30)
    _play(e, stream, until=29.0)
    over = _types(e.tick(now=30.0), GameOver)
    assert over and over[0].winner == "draw", over[0] if over else over
    # CONTROL: a ROSTERED owner on the identical stream does win it on the clock.
    e2 = _engine(game_time_s=30)
    _play(e2, [(t, f.replace(",0,8,", ",1,8,")) for t, f in stream], until=29.0)
    over2 = _types(e2.tick(now=30.0), GameOver)
    assert over2 and over2[0].winner == "team1", over2[0] if over2 else over2


def test_losing_the_hill_to_a_team_not_in_the_match_still_tells_the_losers():
    """Refusing to SCORE an outside team is not the same as pretending nothing happened: blue
    genuinely lost the point and is told so. Nobody hears "Hill Captured", because nobody in this
    match took it."""
    e = _engine()
    e.on_event("blue", ev("$HIR,4,15,0,1,8,0,0"), now=1.0)          # blue holds it
    acts = e.on_event("blue", ev("$HIR,4,15,0,0,50,0,0"), now=10.0)  # an outside gun takes it
    assert {p.scope: p.sound_id for p in _types(acts, PlaySound)} == {"blue": hb.HILL_LOST}
    assert e.snapshot()["owner"]["A"] == 0


def test_a_station_capture_by_an_unrostered_team_scores_nothing_either():
    """The same hole on the station path, which has no beacon anywhere near it: `$CAPTURE,A,3` in a
    game with nobody on team 3."""
    e = _engine(teams=(("blue", 1), ("red", 0)))
    e.on_event("st", {"command": "CAPTURE", "tokens": ["CAPTURE", "A", "3"]}, now=0.0)
    for t in range(1, 11):
        e.tick(now=float(t))
    s = e.snapshot()
    assert s["owner"]["A"] == 3 and 3 not in s["score"], s
    # CONTROL: a rostered team capturing the same site the same way does score.
    e.on_event("st", {"command": "CAPTURE", "tokens": ["CAPTURE", "A", "1"]}, now=10.0)
    for t in range(11, 21):
        e.tick(now=float(t))
    assert e.snapshot()["score"][1] == 10


# --------------------------------------------------------------------------- #
# 11. Through the whole stack (config → driver → engine → frames)              #
# --------------------------------------------------------------------------- #
def test_koth_plays_off_real_beacons_end_to_end():
    g = SimGame(GameConfig(mode="koth", control_points=1, score_target=20, game_time_s=0),
                guns={"G1": 1, "G2": 3}).setup()
    # Interleaved on a 1 s tick cadence, as run_live does. Ticking only AFTER the last frame would
    # credit the whole 62 s to whoever holds the point at the end -- the game would "win" on one
    # tick and prove nothing about possession.
    q = list(NEUTRAL_TO_BLUE)
    for t in range(0, 63):
        while q and q[0][0] <= t:
            ft, f = q.pop(0)
            g.event("G1", f, now=ft)
        g.tick(now=float(t))
    s = g.snapshot()
    assert g.over and s["winner"] == "team1", s
    assert s["hill"]["owner"] == 1 and s["hill"]["neutral"] is False
    # CONTROL: the losing team is in the same game and scored nothing off the same stream.
    assert s["score"][3] == 0
    # the announcer line reached both guns
    frame = f"$PLAY,,4,6,{hb.HILL_CAPTURED},,,,*"
    assert frame in g.frames_to("G1") and frame in g.frames_to("G2")
    g.close()


def test_a_beacon_is_not_counted_as_a_hit_taken():
    """`hits_taken` is the live detector for an unhittable gun (F11): a player still on zero well
    into a match is the only symptom. A hill beacons every 5 s, so counting beacons would make an
    unhittable gun look hit all match and silence the detector in exactly the modes that have a
    hill."""
    g = SimGame(GameConfig(mode="koth", control_points=1, game_time_s=0),
                guns={"G1": 1, "G2": 3}).setup()
    before = len(g.frames_to("G1"))
    for t, f in NEUTRAL_HEARTBEAT:
        g.event("G1", f, now=t)
    g.event("G1", BEACON_HP_ECHO, now=560.0)            # the $HP echo, pools unchanged
    assert g.drv.hits_taken.get("G1", 0) == 0, g.drv.hits_taken
    # ... and no headset repaint per beacon: fn 28 registers with zero player feedback, so there is
    # nothing to repaint and a 5 s repaint would run for the whole match.
    assert len(g.frames_to("G1")) == before
    # CONTROL: a real hit is still counted, and still repaints.
    g.event("G1", REAL_SHOT, now=561.0)
    assert g.drv.hits_taken["G1"] == 1
    assert len(g.frames_to("G1")) > before
    g.close()


def test_two_guns_in_the_hill_announce_one_capture_between_them():
    """Both guns standing on the point hear the same `mag=50`. The per-player dedupe window cannot
    see across guns, so the second report is refused on the fact that a team cannot capture a point
    it already owns — otherwise the same capture is announced twice and the second one reads as a
    steal from itself."""
    e = _engine(teams=(("g1", 1), ("g2", 1)))
    e.on_event("g1", ev("$HIR,4,15,0,2,8,0,0"), now=41.770)
    e.on_event("g2", ev("$HIR,4,15,0,2,8,0,0"), now=41.775)
    first = e.on_event("g1", ev("$HIR,4,15,0,1,50,0,0"), now=41.820)
    echo = e.on_event("g2", ev("$HIR,0,15,0,1,50,0,0"), now=41.834)
    assert [(p.sound_id, p.scope) for p in _types(first, PlaySound)] == \
        [(hb.HILL_CAPTURED, "all")]
    assert echo == [], echo
    # The load-bearing part: the echo must not rewrite the capture as "stolen from team 1", which
    # would make the mag=53 five seconds later arrive as a CORRECTION and announce a second time.
    conf = e.on_event("g1", ev("$HIR,0,15,0,2,53,0,0"), now=46.780)
    assert conf == [], conf
    assert e.beacons._capture_from_neutral is True
    # ... and the second gun is still counted as standing on the point.
    assert e.beacons.present(now=42.0) == {"g1", "g2"}


def test_build_engine_gives_koth_the_beacon_bridge():
    e = build_engine(_koth(control_points=5))
    assert isinstance(e, DominationEngine) and len(e.sites) == 1
    assert e.hill_site == "A" and isinstance(e.beacons, hb.HillBeaconReader)


# --------------------------------------------------------------------------- #
# 10. F97: a hill mode has three teams, never four                              #
# --------------------------------------------------------------------------- #
def _mc_validate_teams(mode, tids):
    """Like `_mc_validate` but with one single-member team per tid -- the FFA-hill shape."""
    from brx_mcp.mc.compile import Compiler
    names = {0: "red", 1: "blue", 2: "yellow", 3: "green"}
    teams = [{"team_id": names[t], "name": names[t].upper(), "color": names[t], "tid": t} for t in tids]
    cfg = {"config_id": "c1", "mode": mode, "environment": "indoor", "night": False,
           "time_limit_s": 600, "respawn": {"type": "auto", "delay_s": 15},
           "scoring": {"frag_limit": 0, "win_by": "kills"},
           "health": {"max_hp": 45, "max_armor": 70}, "teams": teams}
    roster = [{"player_id": f"p{n}", "player_num": n, "display": "X", "team_id": names[t],
               "node_id": None, "gun_id": None, "voice": "male", "ready": True,
               "loadout": {"weapons": [{"weapon_id": "assault_rifle"}]}}
              for n, t in enumerate(tids, start=1)]
    return Compiler().validate(cfg, roster, {"station_source": "grenade"})


def test_a_four_player_ffa_hill_is_refused_by_count_not_just_by_tid_two():
    """F97: four tids exist, neutral is 2, so a hill mode fields at most three teams. A four-team koth
    is refused with the LIMIT named -- F82's "use tid 0, 1 or 3" is advice a fourth single-member team
    cannot follow, so the operator is told the real cap instead."""
    errs = _mc_validate_teams("koth", (0, 1, 2, 3))["errors"]
    assert any("F97" in e and "three" in e.lower() for e in errs), errs
    assert any("F97" in e for e in _mc_validate_teams("domination", (0, 1, 2, 3))["errors"])
    # CONTROL: the three-player FFA hill (0, 1, 3) is exactly the shape the row wants, and it is clean.
    three = _mc_validate_teams("koth", (0, 1, 3))["errors"]
    assert not any("F97" in e or "F82" in e for e in three), three
    # CONTROL: four teams in a mode with no hill are still four teams.
    assert not any("F97" in e for e in _mc_validate_teams("tdm", (0, 1, 2, 3))["errors"])


def test_the_engine_refuses_a_fourth_distinct_hill_team():
    e = DominationEngine(_koth())
    e.add_player("a", 0); e.add_player("b", 1); e.add_player("c", 3)
    try:
        e.add_player("d", 2)
        raise AssertionError("a fourth team was accepted")
    except ValueError as exc:
        assert "F82" in str(exc) or "F97" in str(exc)
    # CONTROL: a fourth PLAYER on an existing team is fine -- the cap is on teams, not bodies.
    e.add_player("d", 3)
    assert len({t for t in e._acc}) == 3
