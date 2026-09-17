"""A47 — the LIVE board's operator menu: RESYNC GUN, FORCE RESPAWN, RELINK GUN for ONE player.

Bench 2026-09-17 (Tony): a player in a bad state (for example a gun that cannot fire) had no cure MC could
send. `POST /api/players/{pid}/operator {cmd, match_id}` pushes `control{cmd, player_id, match_id}` to that
player's bound phone only. MC refuses it outside ARMED/LIVE, for a stale board's match, and for a phone that
is unbound or out of reach. It is never a config or head push.

Run: python3 run_tests.py mc_operator_actions
"""
from _skip import needs

from brx_mcp.mc import envelope as E
from brx_mcp.mc.state import STALE_AFTER_MS, ConflictError
from test_mc_block_b import DeafNet, go_live, kill, mk, online

try:
    from starlette.testclient import TestClient
    import httpx  # noqa: F401
    HAVE_HTTP = True
except Exception:
    HAVE_HTTP = False


def _refused(fn, *a, conflict=True):
    try:
        fn(*a)
    except ValueError as e:
        assert isinstance(e, ConflictError) == conflict, (type(e), e)
        return str(e)
    raise AssertionError("expected a refusal")


def test_each_action_pushes_one_control_to_that_player_phone_only():
    s, net, clock, ps, info = go_live(2)
    for cmd in ("resync", "respawn", "relink"):
        before = len(net.pushed)
        r = s.operator_action(ps[1]["player_id"], cmd, info["match_id"])
        assert r == {"ok": True, "cmd": cmd, "player_id": ps[1]["player_id"],
                     "match_id": info["match_id"], "pushed": True}, r
        new = net.pushed[before:]
        assert new == [("node1", "control", {"cmd": cmd, "player_id": ps[1]["player_id"],
                                             "match_id": info["match_id"]})], new
        # the envelope a phone receives is valid on the wire (CONTROL_CMDS lists the cmd)
        E.validate(E.make_envelope("control", new[0][2]), direction="mc")
    assert not any(k in ("config", "start") for _n, k, _b in net.pushed[-3:])


def test_the_match_feed_names_the_operator_and_the_player():
    s, net, clock, ps, info = go_live(2)
    s.operator_action(ps[0]["player_id"], "respawn", info["match_id"])
    s.operator_action(ps[0]["player_id"], "resync", info["match_id"])
    s.operator_action(ps[0]["player_id"], "relink", info["match_id"])
    texts = [f["text"] for f in s.feed[:3]]
    assert texts == ["OPERATOR RELINKED OP0'S GUN", "OPERATOR RESYNCED OP0'S GUN", "OPERATOR RESPAWNED OP0"], texts
    assert all(f["tag"] == "OPERATOR" and f["kind"] == "alert" for f in s.feed[:3])


def test_refused_outside_armed_and_live():
    s, net, clock, ps = mk(2)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    before = len(net.pushed)
    msg = _refused(s.operator_action, ps[0]["player_id"], "respawn", "any-match")
    assert "ARMED or LIVE" in msg, msg
    assert len(net.pushed) == before, "a refusal sends nothing"


def test_refused_for_a_stale_match_id():
    s, net, clock, ps, info = go_live(2)
    before = len(net.pushed)
    assert "match is over" in _refused(s.operator_action, ps[0]["player_id"], "resync", "old-match")
    assert "match is over" in _refused(s.operator_action, ps[0]["player_id"], "resync", "")
    assert len(net.pushed) == before


def test_refused_for_a_phone_out_of_reach_or_unbound():
    s, net, clock, ps, info = go_live(2)
    clock["t"] += STALE_AFTER_MS + 1          # no heartbeat since go_live
    before = len(net.pushed)
    assert "OUT OF REACH" in _refused(s.operator_action, ps[0]["player_id"], "respawn", info["match_id"])
    assert len(net.pushed) == before
    s.players[ps[1]["player_id"]]["node_id"] = None
    assert "OUT OF REACH" in _refused(s.operator_action, ps[1]["player_id"], "respawn", info["match_id"])


def test_a_push_no_socket_took_is_reported_not_claimed():
    s, net, clock, ps, info = go_live(2, net=DeafNet(("node0",)))
    assert "NO CONNECTION" in _refused(s.operator_action, ps[0]["player_id"], "relink", info["match_id"])
    assert not s.feed or s.feed[0]["tag"] != "OPERATOR", "nothing reached a phone, so the feed does not say it did"


def test_unknown_cmd_and_unknown_player_are_bad_requests():
    s, net, clock, ps, info = go_live(1)
    _refused(s.operator_action, ps[0]["player_id"], "panic", info["match_id"], conflict=False)
    _refused(s.operator_action, "nobody", "resync", info["match_id"], conflict=False)


def test_an_operator_respawn_fact_keeps_the_streak():
    """The phone's revive emits `respawn{operator:true}`. A normal respawn after a death resets the streak;
    the operator's respawn of a living player is not a new life after a death, so it must not."""
    s, net, clock, ps, info = go_live(2)
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    kill(s, net, clock, ps, 0, 1, info, seq=2)
    streak = s.scorer.stats[ps[0]["player_id"]].streak
    assert streak == 2, streak
    clock["t"] += 100
    net.simulate_event("node0", {"type": "respawn", "t": clock["t"], "match_id": info["match_id"],
                                 "player_id": ps[0]["player_id"], "operator": True}, clock["t"], seq=3)
    assert s.scorer.stats[ps[0]["player_id"]].streak == 2
    net.simulate_event("node0", {"type": "respawn", "t": clock["t"], "match_id": info["match_id"],
                                 "player_id": ps[0]["player_id"]}, clock["t"], seq=4)
    assert s.scorer.stats[ps[0]["player_id"]].streak == 0


def test_the_route_needs_the_operator_token_and_answers_409_for_a_refusal():
    needs(HAVE_HTTP, "starlette + httpx")
    from brx_mcp.mc.api import create_app
    s, net, clock, ps, info = go_live(2)
    tok = "op-menu-token"
    c = TestClient(create_app(s, token=tok))
    url = f"/api/players/{ps[0]['player_id']}/operator"
    body = {"cmd": "respawn", "match_id": info["match_id"]}
    before = len(net.pushed)
    assert c.post(url, json=body).status_code == 401
    assert len(net.pushed) == before, "an unauthenticated press sends nothing"
    auth = {"Authorization": f"Bearer {tok}"}
    r = c.post(url, json=body, headers=auth)
    assert r.status_code == 200 and r.json()["ok"] is True, r.text
    r = c.post(url, json={**body, "match_id": "old"}, headers=auth)
    assert r.status_code == 409 and "match is over" in r.json()["error"], r.text
    r = c.post(url, json={**body, "cmd": "nope"}, headers=auth)
    assert r.status_code == 400, r.text
