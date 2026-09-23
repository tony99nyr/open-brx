"""F289 (Tony, 2026-09-23): only the phone ends spawn protection, so a phone that dies inside the window
leaves its gun unhittable. The node reports the owed write (`status.protected`, and `protect_ms` on the
`respawn` / infection `team_change` fact, sent at once); MC flags a STALE player whose newest evidence says
the write was still owed, as `LiveRow.possibly_protected`. A connected phone is never flagged.

Run: python3 run_tests.py mc_possibly_protected
"""
import pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from test_mc_pool_stale import _session, _status


def live(n=2):
    s, net, clock, ps = _session(n)
    s.push_config(force=True)
    for i in range(n):
        net.simulate_node_message(f"node{i}", "ack_config", {"config_id": s.config["config_id"], "ok": True,
                                                           "gun_echo": "x"}, clock["t"])
    s.start(force=True)
    clock["t"] = s.start_info["go_live_t"] + 10
    s.tick()
    for i, p in enumerate(ps):
        _status(net, clock, i, p, arm_state="live")
    return s, net, clock, ps


def rows(s):
    return {r["player_id"]: r for r in s.snapshot()["live"]["rows"]}


def go_quiet(s, net, clock, ps, *quiet):
    """The quiet phones stop talking for 20 s (past STALE_AFTER_MS); every other phone keeps talking."""
    clock["t"] += 20_000
    for i, p in enumerate(ps):
        if i not in quiet:
            _status(net, clock, i, p, arm_state="live")


def respawn(s, net, clock, i, p, seq, **extra):
    net.simulate_event(f"node{i}", {"type": "respawn", "t": clock["t"], "match_id": s.scorer.match_id,
                                    "player_id": p["player_id"], **extra}, clock["t"], seq=seq)


def test_a_phone_that_goes_quiet_while_its_status_said_protected_is_flagged():
    s, net, clock, ps = live()
    _status(net, clock, 0, ps[0], arm_state="live", protected=True)
    assert "possibly_protected" not in rows(s)[ps[0]["player_id"]], "a phone MC can hear is never flagged"
    go_quiet(s, net, clock, ps, 0)
    r = rows(s)[ps[0]["player_id"]]
    assert r["status"] == "stale" and r["possibly_protected"] is True
    assert "possibly_protected" not in rows(s)[ps[1]["player_id"]]


def test_a_respawn_fact_with_a_window_and_no_status_after_it_is_flagged():
    s, net, clock, ps = live()
    respawn(s, net, clock, 0, ps[0], seq=1, protect_ms=2000)
    go_quiet(s, net, clock, ps, 0)
    assert rows(s)[ps[0]["player_id"]]["possibly_protected"] is True


def test_an_infection_flip_with_a_window_is_flagged_too():
    s, net, clock, ps = live()
    net.simulate_event("node0", {"type": "team_change", "t": clock["t"], "match_id": s.scorer.match_id,
                                 "player_id": ps[0]["player_id"], "tid": 2, "protect_ms": 2000}, clock["t"], seq=1)
    go_quiet(s, net, clock, ps, 0)
    assert rows(s)[ps[0]["player_id"]].get("possibly_protected") is True


def test_a_later_status_without_protected_clears_it():
    s, net, clock, ps = live()
    respawn(s, net, clock, 0, ps[0], seq=1, protect_ms=2000)
    _status(net, clock, 0, ps[0], arm_state="live")          # the phone ended protection and said so
    go_quiet(s, net, clock, ps, 0)
    assert "possibly_protected" not in rows(s)[ps[0]["player_id"]]


def test_a_respawn_with_no_window_and_a_stale_phone_is_not_flagged():
    s, net, clock, ps = live()
    respawn(s, net, clock, 0, ps[0], seq=1)
    respawn(s, net, clock, 0, ps[0], seq=2, protect_ms=0)
    go_quiet(s, net, clock, ps, 0)
    assert "possibly_protected" not in rows(s)[ps[0]["player_id"]], "offline alone is not protected"


def test_junk_is_not_a_claim():
    s, net, clock, ps = live()
    for i, junk in enumerate((True, "2000", -5, 1.5)):
        respawn(s, net, clock, 0, ps[0], seq=i + 1, protect_ms=junk)
    _status(net, clock, 1, ps[1], arm_state="live", protected="yes")
    go_quiet(s, net, clock, ps, 0, 1)
    assert not any("possibly_protected" in r for r in rows(s).values())


def test_a_fact_for_another_match_is_not_a_claim():
    s, net, clock, ps = live()
    net.simulate_event("node0", {"type": "respawn", "t": clock["t"], "match_id": "some-other-match",
                                 "player_id": ps[0]["player_id"], "protect_ms": 2000}, clock["t"], seq=1)
    go_quiet(s, net, clock, ps, 0)
    assert "possibly_protected" not in rows(s)[ps[0]["player_id"]]
