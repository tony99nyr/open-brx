"""T1-A: MC must PROVE that the config it pushed is the config the guns are running.

Field night 2026-09-12: guns ran a PREVIOUS push in nearly every match and nothing on screen said
so. Every signal MC needed was already on the wire and thrown away --

  * `ack_config` carries the `config_id` the node applied; `state.py` stored `{ok, gun_echo, err}`
    and DROPPED it, so an ack for last game's head satisfied `all_acked()` and the whistle blew.
  * `gun_echo` is the gun's own answer to the head write and was only ever tested for TRUTHINESS.
  * the status heartbeat reports the pool the gun is actually holding, and nothing compared it to
    the pool MC compiled.

Each check below is written against the head MC ACTUALLY PUSHED (`self.bundles[pid]["head"]`),
never against a re-derivation of it: a guard that recomputes what it is checking can only ever
agree with itself.

Run: python3 run_tests.py mc_config_proof
"""
from brx_mcp.mc.compile import Compiler
from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.state import Session
from brx_mcp.mc.types import POOL_CHECK_SETTLE_MS

T0 = 5_000_000


def mk(n_players=2, compiler=None):
    clock = {"t": T0}
    net = FakeNet()
    s = Session(compiler or FakeCompiler(), net, FakeArmory(demo_armory()), now_ms=lambda: clock["t"])
    s.set_config({"mode": "tdm", "time_limit_s": 60})
    ps = [s.add_player(f"OP{i}", gun_id=f"GUN-{chr(65 + i)}") for i in range(n_players)]
    return s, net, clock, ps


def online(s, net, clock, p, i, synced=True, **body):
    tail = demo_armory()[i]["ble"]["tail"]
    net.simulate_hello(f"node{i}", f"GUN-{chr(65 + i)}-{tail}")
    net.simulate_status(f"node{i}", {"player_id": p["player_id"], "hp": 45, "armor": 70, "ammo": 36,
                                     "alive": True, "shots": 0, "battery": 80, "fw": "v4.32",
                                     "arm_state": "kitted", "synced": synced,
                                     "preflight": {"ssid_ok": True, "mc_reachable": True, "phone_batt": 90,
                                                   "screen_on": True, "foreground": True, "gun_linked": True},
                                     **body}, clock["t"])


def echo_for(s, pid, slot=0):
    """The `$ALCD` a gun holding THIS player's pushed head would answer with."""
    from brx_mcp.mc import frames as _f
    mag, reserve = _f.head_spawn_ammo(s.bundles[pid]["head"]) or (0, 0)
    return f"$ALCD,{mag},100,{slot},{reserve},0,*"


def ack(net, s, i, pid, *, config_id=None, echo=None, t=None):
    net.simulate_node_message(f"node{i}", "ack_config",
                              {"config_id": config_id or s.config["config_id"], "ok": True,
                               "gun_echo": echo if echo is not None else echo_for(s, pid)},
                              t if t is not None else s.now_ms())


def row(s, pid):
    return next(r for r in s.readiness()["board"] if r["player_id"] == pid)


# --------------------------------------------------------------- 1. the stale ack ---------- #

def test_a_stale_ack_never_satisfies_start_and_force_does_not_open_it():
    """The field failure itself. An ack for a PREVIOUS head is not an ack for this one.

    Shape: the lobby is pushed and acked, the operator edits the game (A35 re-pushes and clears the
    acks), and the node's answer that arrives next is a LATE ack for the config it was holding
    before. Truthiness alone read that as "every gun has answered" and `start()` blew the whistle on
    a roster still running last game's frames.

    `force` does NOT open this one, for `_refuse_push_in_play`'s reason: force is the operator's
    override of a READINESS judgement they can see and accept (a phone that is off, a row they know
    about). A stale ack is not a judgement -- it is the gun telling us, in its own words, which game
    it is running. RE-PUSH is the only answer.
    """
    s, net, clock, ps = mk(2)
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    s.push_config()
    old_id = s.config["config_id"]
    for i, p in enumerate(ps):
        ack(net, s, i, p["player_id"])
    assert s.all_acked()

    s.set_config({"time_limit_s": 120})          # A35 re-push: new config_id, acks cleared
    assert s.config["config_id"] != old_id and s.acks == {}
    for i, p in enumerate(ps):                    # …and both phones answer for the OLD head
        ack(net, s, i, p["player_id"], config_id=old_id)

    assert not s.all_acked(), "an ack naming a previous config_id is not an ack for this one"
    for force in (False, True):
        try:
            s.start(runway_s=10, force=force)
            raise AssertionError(f"start(force={force}) accepted a stale ack")
        except ValueError as e:
            assert old_id in str(e) or "OLDER CONFIG" in str(e).upper() or "stale" in str(e).lower()
    assert s.phase == "lobby"


def test_the_board_names_the_older_config_the_gun_acked():
    s, net, clock, ps = mk(2)
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    s.push_config()
    old_id = s.config["config_id"]
    for i, p in enumerate(ps):
        ack(net, s, i, p["player_id"])
    s.set_config({"time_limit_s": 90})
    ack(net, s, 0, ps[0]["player_id"], config_id=old_id)
    ack(net, s, 1, ps[1]["player_id"])            # node1 answers the CURRENT head

    r0, r1 = row(s, ps[0]["player_id"]), row(s, ps[1]["player_id"])
    assert r0["status"] == "red" and any("ACKED AN OLDER CONFIG" in b and old_id in b for b in r0["blockers"]), r0["blockers"]
    assert not any("ACKED AN OLDER CONFIG" in b for b in r1["blockers"]), r1["blockers"]
    assert not s.readiness()["go"]


def test_every_re_push_resets_the_per_node_ack():
    s, net, clock, ps = mk(1)
    online(s, net, clock, ps[0], 0)
    s.push_config()
    ack(net, s, 0, ps[0]["player_id"])
    assert s.all_acked()
    s.push_config()                               # a second push: the old ack proves nothing about it
    assert s.acks == {} and not s.all_acked()


# ----------------------------------------------------------- 2. the gun echo --------------- #

def test_gun_echo_mag_reserve_must_match_the_pushed_weapon():
    """The echo is the gun repeating back the magazine it was just written.

    Compared against the `$WEAP,0` frame in the head MC ACTUALLY PUSHED, not against a fresh
    catalog lookup: the point of the check is that the gun and the push agree, and re-deriving the
    expected numbers from the same catalog the push came from would make the two sides the same
    statement twice.
    """
    s, net, clock, ps = mk(2, compiler=Compiler())
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    s.push_config()
    from brx_mcp.mc import frames as _f
    mag, reserve = _f.head_spawn_ammo(s.bundles[ps[0]["player_id"]]["head"])
    assert mag > 0 and reserve > 0, "the real compiler's head must carry a readable $WEAP,0"

    ack(net, s, 0, ps[0]["player_id"])                                            # exact echo
    ack(net, s, 1, ps[1]["player_id"], echo=f"$ALCD,{mag - 1},100,0,{reserve},0,*")   # one round short

    r0, r1 = row(s, ps[0]["player_id"]), row(s, ps[1]["player_id"])
    assert not any("GUN ECHO" in b for b in r0["blockers"]), r0["blockers"]
    assert r1["status"] == "red"
    fault = next(b for b in r1["blockers"] if "GUN ECHO" in b)
    assert f"{mag - 1}/{reserve}" in fault and f"{mag}/{reserve}" in fault, fault
    assert not s.readiness()["go"]


def test_a_non_ammo_echo_makes_no_claim_about_the_weapon():
    """`$START` answers `$LCD,0,0,0,0,0,0,*` and that frame says nothing about the magazine.

    An older app reports it as the echo. MC must read that as "no evidence", never as a mismatch --
    a red on every row of a field running last week's build would be worse than the silence this
    check replaces.
    """
    s, net, clock, ps = mk(1, compiler=Compiler())
    online(s, net, clock, ps[0], 0)
    s.push_config()
    ack(net, s, 0, ps[0]["player_id"], echo="$LCD,0,0,0,0,0,0,*")
    assert not any("GUN ECHO" in b for b in row(s, ps[0]["player_id"])["blockers"])


def test_the_engine_reports_the_ammo_echo_when_the_gun_gives_one():
    """The phone's own contract, pinned here because MC's check is worthless without it: a head
    write is answered by `$START`'s `$LCD` FIRST and the `$WEAP` `$ALCD` echoes after it, so
    reporting "the first frame" can only ever report the one that carries no weapon."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2] / "app" / "src" / "engine.js").read_text(encoding="utf-8")
    assert "ammoEcho" in src, "engine.js must keep the slot-0 $ALCD config echo"
    assert "gun_echo: this.ammoEcho || this.headEcho" in src, \
        "ack_config must prefer the $ALCD echo (it carries the magazine) over the $START $LCD"


# ------------------------------------------------------- 3. the post-spawn pool ------------ #

def _go_live(s, net, clock, ps, runway_s=10):
    s.push_config()
    for i, p in enumerate(ps):
        ack(net, s, i, p["player_id"])
    info = s.start(runway_s=runway_s)
    clock["t"] = info["go_live_t"] + 1
    s.tick()
    assert s.phase == "live"
    return info


def _live_status(net, clock, i, p, hp, armor, mid, alive=True):
    net.simulate_status(f"node{i}", {"player_id": p["player_id"], "hp": hp, "armor": armor, "alive": alive,
                                     "shots": 0, "synced": True, "arm_state": "live", "match_id": mid,
                                     "preflight": {"gun_linked": True, "ssid_ok": True, "mc_reachable": True}},
                        clock["t"])


def test_first_settled_pool_must_equal_the_pushed_pset():
    """This is the check that caught the staleness retroactively: a gun on last game's head spawns
    into last game's pool, and it says so on every heartbeat."""
    s, net, clock, ps = mk(2)
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    info = _go_live(s, net, clock, ps)
    mid = info["match_id"]
    _live_status(net, clock, 0, ps[0], 45, 70, mid)      # the life starts: settle window opens
    _live_status(net, clock, 1, ps[1], 45, 70, mid)
    clock["t"] += POOL_CHECK_SETTLE_MS + 100
    _live_status(net, clock, 0, ps[0], 45, 70, mid)      # exactly the pushed $PSET
    _live_status(net, clock, 1, ps[1], 45, 115, mid)     # a PREVIOUS game's armour

    r0, r1 = row(s, ps[0]["player_id"]), row(s, ps[1]["player_id"])
    assert not any("GUN POOL" in b for b in r0["blockers"]), r0["blockers"]
    assert r1["status"] == "red"
    fault = next(b for b in r1["blockers"] if "GUN POOL" in b)
    assert "45/115" in fault and "45/70" in fault, fault
    assert any("GUN POOL" in (e.get("text") or "") for e in s.feed), s.feed


def test_the_settle_window_and_a_hit_both_suppress_the_pool_check():
    """Two honest silences. Inside the settle window the gun may not have applied the head yet; once
    the player has been hit, a pool BELOW the compiled one is the game working."""
    s, net, clock, ps = mk(2)
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    info = _go_live(s, net, clock, ps)
    mid = info["match_id"]
    _live_status(net, clock, 0, ps[0], 45, 70, mid)
    _live_status(net, clock, 1, ps[1], 45, 70, mid)
    clock["t"] += POOL_CHECK_SETTLE_MS - 500
    _live_status(net, clock, 0, ps[0], 45, 115, mid)     # still settling: no claim
    assert not any("GUN POOL" in b for b in row(s, ps[0]["player_id"])["blockers"])

    net.simulate_event("node1", {"type": "hit_taken", "t": clock["t"], "match_id": mid,
                                 "player_id": ps[1]["player_id"], "shooter_num": ps[0]["player_num"],
                                 "shooter_team": 1, "dmg": 9}, clock["t"], seq=1)
    clock["t"] += POOL_CHECK_SETTLE_MS + 100
    _live_status(net, clock, 1, ps[1], 45, 61, mid)      # damaged, not stale
    assert not any("GUN POOL" in b for b in row(s, ps[1]["player_id"])["blockers"])


# ------------------------------------------------- 4. the heartbeat's held config ---------- #

def test_a_heartbeat_holding_an_older_config_is_amber_until_it_re_acks():
    s, net, clock, ps = mk(2)
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    s.push_config()
    old_id = s.config["config_id"]
    for i, p in enumerate(ps):
        ack(net, s, i, p["player_id"])
    s.set_config({"time_limit_s": 120})
    online(s, net, clock, ps[0], 0, config_id=old_id)    # the gun still holds the previous head
    online(s, net, clock, ps[1], 1, config_id=s.config["config_id"])

    r0, r1 = row(s, ps[0]["player_id"]), row(s, ps[1]["player_id"])
    assert any("HOLDING OLDER CONFIG" in a for a in r0["ambers"]), r0["ambers"]
    assert not any("HOLDING OLDER CONFIG" in a for a in r1["ambers"]), r1["ambers"]

    ack(net, s, 0, ps[0]["player_id"])                   # re-acked: the drift is settled
    assert not any("HOLDING OLDER CONFIG" in a for a in row(s, ps[0]["player_id"])["ambers"])


def test_the_phone_puts_its_held_config_id_on_every_heartbeat():
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[2] / "app" / "src" / "engine.js").read_text(encoding="utf-8")
    body = src[src.index("statusBody(preflight = {})"):]
    body = body[:body.index("// ---------- render snapshot")]
    assert "config_id" in body, "statusBody() must report the config the phone is holding"


# --------------------------------------------------------- 5. the reset between games ------ #

def test_next_match_clears_every_proof_and_demands_a_fresh_full_push():
    # The REAL compiler on purpose: `FakeCompiler` has no `hit_plan`, so `_pinned_hit_plan` never
    # gets set with it and the A17 half of this assertion would pass by never having been true.
    s, net, clock, ps = mk(2, compiler=Compiler())
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    info = _go_live(s, net, clock, ps)
    _live_status(net, clock, 0, ps[0], 45, 70, info["match_id"])
    clock["t"] += POOL_CHECK_SETTLE_MS + 100
    _live_status(net, clock, 0, ps[0], 45, 115, info["match_id"])     # earn a pool fault to clear
    assert s._pool_faults, "control: there is something to reset"
    assert s._pinned_hit_plan is not None, "control: the match really did pin a hit-audio plan"
    clock["t"] = info["go_live_t"] + 60_000 + 6000
    s.tick()
    assert s.phase == "recap"

    s.new_session(keep_roster=True)
    assert s.acks == {} and s.bundles == {} and not s.lobby_pushed
    assert s._pinned_hit_plan is None, "the next match re-derives its own hit-audio plan (A17)"
    assert s._pool_faults == {}
    # `_stale_told` goes (an entry from the last session would suppress a legitimate reconcile in
    # this one); `_ended` STAYS -- it is the ledger a phone still out on the field is reconciled
    # against (A34), and a NEW session is exactly when one turns up.
    assert s._stale_told == {} and info["match_id"] in s._ended
    try:
        s.start(runway_s=10)
        raise AssertionError("START was allowed with no fresh push")
    except ValueError as e:
        assert "push config first" in str(e)
    # …and the old acks cannot be re-used: the new push carries a new config_id
    s.push_config()
    assert s.acks == {}


# -------------------------------------------------- 6. duplicate team_id / tid ------------- #

def test_duplicate_team_id_or_tid_is_refused_by_name():
    s, _net, _clock, _ps = mk(0)
    for teams, needle in (
        ([{"team_id": "blue", "tid": 1, "name": "BLUE"}, {"team_id": "blue", "tid": 3, "name": "ALSO BLUE"}], "blue"),
        ([{"team_id": "blue", "tid": 1, "name": "BLUE"}, {"team_id": "red", "tid": 1, "name": "RED"}], "1"),
    ):
        try:
            s.set_config({"mode": "tdm", "teams": teams})
            raise AssertionError(f"accepted duplicate teams: {teams}")
        except ValueError as e:
            assert needle in str(e), str(e)


def test_distinct_teams_still_pass():
    s, _net, _clock, _ps = mk(0)
    res = s.set_config({"mode": "tdm", "teams": [{"team_id": "blue", "tid": 1, "name": "BLUE"},
                                                 {"team_id": "yellow", "tid": 3, "name": "YELLOW"}]})
    assert res["ok"] or res["errors"]     # valid SHAPE; roster errors are a different judgement
    assert [t["tid"] for t in s.config["teams"]] == [1, 3]
