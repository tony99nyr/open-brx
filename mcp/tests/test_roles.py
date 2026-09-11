"""A19 / S10 — held headset roles reach the node: `alert.role = {name, on, tid?}` + `GameConfig.vip_player_id`.

Before this the node's role mechanism (`engine.js _setRole`, led-language.md §3.3) was general and wired for
`carrier` (via the objective alerts) and `infected` (via the death/team_flip path), but nothing MC sent could
say "you are the VIP". These tests pin the MC half: the body shape, WHO receives it (the VIP and nobody
else), WHEN (after the node's own start / respawn flash has settled, never at the whistle), that a saved
game never carries the person, and that the roster check refuses a VIP who is not playing.

Run: python3 run_tests.py roles
"""
from brx_mcp.mc import presentation as P
from brx_mcp.mc.compile import Compiler
from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
from brx_mcp.mc.state import Session

T0 = 5_000_000


def _sess(n=2, **cfg):
    clock = {"t": T0}
    net = FakeNet()
    s = Session(Compiler(), net, FakeArmory(demo_armory()), now_ms=lambda: clock["t"])
    s.set_config({"mode": "tdm", "time_limit_s": 600, **cfg})
    ps = [s.add_player(f"OP{i}", gun_id=f"GUN-{chr(65 + i)}") for i in range(n)]
    return s, net, clock, ps


def _online(s, net, clock, p, i):
    tail = demo_armory()[i]["ble"]["tail"]
    net.simulate_hello(f"node{i}", f"GUN-{chr(65 + i)}-{tail}")
    net.simulate_status(f"node{i}", {"player_id": p["player_id"], "hp": 45, "armor": 70, "ammo": 36, "alive": True,
                                     "shots": 0, "battery": 80, "fw": "v4.32", "arm_state": "kitted", "synced": True,
                                     "preflight": {"ssid_ok": True, "mc_reachable": True, "phone_batt": 90,
                                                   "screen_on": True, "foreground": True, "gun_linked": True}}, clock["t"])


def _role_alerts(net):
    return [(nid, b) for nid, k, b in net.pushed if k == "alert" and b.get("kind") == "role"]


def _raises(fn, *needles):
    try:
        fn()
    except ValueError as e:
        for n in needles:
            assert n in str(e), f"{n!r} not in {e}"
        return
    raise AssertionError("expected a ValueError")


# --------------------------------------------------------------------------- #
# 1. the body                                                                  #
# --------------------------------------------------------------------------- #
def test_the_alert_body_carries_a_checked_role_and_refuses_a_state_the_node_cannot_hold():
    b = P.role_alert_body("vip", True)
    assert b == {"kind": "role", "text": "YOU ARE THE VIP", "role": {"name": "vip", "on": True}}
    assert P.role_alert_body("carrier", True, tid=2)["role"] == {"name": "carrier", "on": True, "tid": 2}
    assert P.role_alert_body("vip", False)["role"] == {"name": "vip", "on": False}
    assert P.alert_body("role", {"role": {"name": "extracted", "on": True}})["role"]["name"] == "extracted"
    # CONTROLS: a name outside §3.3, a non-bool `on`, a tid off the wire, or a bare string are all code bugs
    _raises(lambda: P.alert_body("role", {"role": {"name": "king", "on": True}}), "alert role must be")
    _raises(lambda: P.alert_body("role", {"role": {"name": "vip", "on": "yes"}}), "alert role must be")
    _raises(lambda: P.alert_body("role", {"role": {"name": "vip", "on": True, "tid": 7}}), "tid must be")
    _raises(lambda: P.alert_body("role", {"role": "vip"}), "alert role must be")
    # and the pre-A19 extras still map exactly as they did
    assert P.alert_body("last_survivor", {"player_id": "p0"})["player_id_subject"] == "p0"


# --------------------------------------------------------------------------- #
# 2. the config field                                                          #
# --------------------------------------------------------------------------- #
def test_vip_player_id_must_name_a_rostered_player_and_a_saved_game_never_carries_it():
    s, net, clock, ps = _sess(2)
    s.set_config({"vip_player_id": ps[0]["player_id"]})
    assert s.config["vip_player_id"] == ps[0]["player_id"] and s._validate()["ok"]
    _raises(lambda: s.set_config({"vip_player_id": 7}), "vip_player_id must be")
    s.set_config({"vip_player_id": "ghost"})
    res = s._validate()
    assert not res["ok"] and any("vip_player_id 'ghost' is not on the roster" in e for e in res["errors"]), res
    # removing the VIP after naming them is the same stale-id case, and the push refuses it by name
    s.set_config({"vip_player_id": ps[1]["player_id"]})
    assert s._validate()["ok"]
    s.remove_player(ps[1]["player_id"])
    assert any("not on the roster" in e for e in s._validate()["errors"])
    try:
        s.push_config(force=True); assert False, "push must refuse a stale VIP"
    except ValueError as e:
        assert "vip_player_id" in str(e)
    # null clears it, and a preset built from this config names nobody
    s.set_config({"vip_player_id": ps[0]["player_id"]})
    assert "vip_player_id" not in s.sanitize_config(dict(s.config))
    s.set_config({"vip_player_id": None})
    assert "vip_player_id" not in s.config and s._validate()["ok"]
    # the VIP presentation profile with nobody named is a WARNING (the profile still plays), never an error
    s.set_config({"presentation": {"preset": "vip"}})
    assert s._validate()["ok"] and any("VIP profile with no VIP named" in w for w in s.config_warnings)
    # CONTROL: the standard profile says nothing about a VIP
    s.set_config({"presentation": {"preset": "standard"}})
    assert not any("VIP" in w for w in s.config_warnings)


# --------------------------------------------------------------------------- #
# 3. who gets it, and when                                                     #
# --------------------------------------------------------------------------- #
def test_only_the_vip_receives_the_role_and_only_once_the_start_flash_has_settled():
    s, net, clock, ps = _sess(2)
    _online(s, net, clock, ps[0], 0); _online(s, net, clock, ps[1], 1)
    s.set_config({"vip_player_id": ps[1]["player_id"]})
    s.push_config(force=True)
    s.start(runway_s=10, force=True)
    net.pushed.clear()
    assert _role_alerts(net) == []                                      # not at the whistle
    clock["t"] = T0 + 10_000; s.tick()
    assert s.phase == "live" and _role_alerts(net) == []                # not at go-live either: the start flash is painting
    clock["t"] = T0 + 10_000 + Session.ROLE_SETTLE_MS - 1; s.tick()
    assert _role_alerts(net) == []
    clock["t"] = T0 + 10_000 + Session.ROLE_SETTLE_MS; s.tick()
    got = _role_alerts(net)
    assert len(got) == 1, got
    nid, body = got[0]
    assert nid == "node1" and body["player_id"] == ps[1]["player_id"]  # the VIP's node, addressed to the VIP
    assert body["role"] == {"name": "vip", "on": True} and body["text"] == "YOU ARE THE VIP"
    assert body["t"] == clock["t"]                                      # fresh: the node's staleness gate accepts it
    assert any(e.get("tag") == "ROLE" and "VIP" in e["text"] for e in s.feed)   # the console sees it too
    # CONTROL: the non-VIP's node never got one, and another tick sends nothing more
    assert not any(nid == "node0" for nid, _ in got)
    s.tick()
    assert len(_role_alerts(net)) == 1


def test_a_vip_respawn_reasserts_the_role_after_the_respawn_flash_and_a_teammates_respawn_does_not():
    s, net, clock, ps = _sess(2)
    _online(s, net, clock, ps[0], 0); _online(s, net, clock, ps[1], 1)
    s.set_config({"vip_player_id": ps[0]["player_id"]})
    s.push_config(force=True)
    s.start(runway_s=1, force=True)
    clock["t"] = T0 + 1_000 + Session.ROLE_SETTLE_MS; s.tick()
    assert len(_role_alerts(net)) == 1
    net.pushed.clear()
    mid = s.start_info["match_id"]
    # the VIP goes down and comes back: the node cleared its roles on the revive (engine.js), so MC re-sends
    s._on_event("node0", {"type": "respawn", "match_id": mid, "t": clock["t"], "node_id": "node0"}, clock["t"])
    s.tick()
    assert _role_alerts(net) == []                                      # not yet: the respawn flash is painting
    clock["t"] += Session.ROLE_SETTLE_MS; s.tick()
    got = _role_alerts(net)
    assert [(n, b["role"]) for n, b in got] == [("node0", {"name": "vip", "on": True})]
    # CONTROL: a teammate's respawn queues nothing, and a parked (other-match) respawn from the VIP queues nothing
    net.pushed.clear()
    s._on_event("node1", {"type": "respawn", "match_id": mid, "t": clock["t"], "node_id": "node1"}, clock["t"])
    s._on_event("node0", {"type": "respawn", "match_id": "stale-match", "t": clock["t"], "node_id": "node0"}, clock["t"])
    clock["t"] += Session.ROLE_SETTLE_MS; s.tick()
    assert _role_alerts(net) == []


def test_the_role_push_ignores_the_mc_events_switch_but_not_the_phase():
    """A role is a rule of the match, not a flourish: a SILENCED profile (`mc_events: false`, which mutes every
    MC-pushed presentation event) still tells the VIP who they are. CONTROL: `_alert` on the same session is
    muted, so the two paths really are gated differently; and nothing is pushed outside armed/live."""
    s, net, clock, ps = _sess(2)
    _online(s, net, clock, ps[0], 0); _online(s, net, clock, ps[1], 1)
    s.set_config({"vip_player_id": ps[0]["player_id"], "presentation": {"mc_events": False}})
    s.push_config(force=True)
    assert s._push_role(ps[0]["player_id"], "vip", True) == 0           # lobby: the node would drop it anyway
    s.start(runway_s=1, force=True)
    net.pushed.clear()
    assert s._push_role(ps[0]["player_id"], "vip", True) == 1
    assert len(_role_alerts(net)) == 1
    assert s._alert("lead_taken", "all") == 0                           # CONTROL: the presentation gate still mutes events
    # a reschedule re-queues from scratch (no double push for the first schedule's due time)
    s.reschedule(runway_s=5)
    assert len(s._role_due) == 1 and s._role_due[0][0] == s.start_info["go_live_t"] + Session.ROLE_SETTLE_MS


def test_no_vip_named_means_no_role_traffic_at_all():
    """CONTROL for the whole feature: a match with no `vip_player_id` (every game before A19) sends no role alert."""
    s, net, clock, ps = _sess(2)
    _online(s, net, clock, ps[0], 0); _online(s, net, clock, ps[1], 1)
    s.push_config(force=True)
    s.start(runway_s=1, force=True)
    net.pushed.clear()
    clock["t"] = T0 + 1_000 + Session.ROLE_SETTLE_MS; s.tick()
    mid = s.start_info["match_id"]
    s._on_event("node0", {"type": "respawn", "match_id": mid, "t": clock["t"], "node_id": "node0"}, clock["t"])
    clock["t"] += Session.ROLE_SETTLE_MS; s.tick()
    assert _role_alerts(net) == [] and s._role_due == []


def test_a_role_push_that_reaches_no_socket_is_withheld_in_the_feed_not_claimed():
    """Polish round 2: `_push_role` wrote the ROLE feed line whether or not the push landed. MC is not live
    mid-match, so a VIP out of Wi-Fi at go-live + 3 s is never retried -- the operator must read that it did NOT
    land, not "VIP: name"."""
    s, net, clock, ps = _sess(2)
    _online(s, net, clock, ps[0], 0); _online(s, net, clock, ps[1], 1)
    s.set_config({"vip_player_id": ps[1]["player_id"]})
    s.push_config(force=True)
    s.start(runway_s=10, force=True)
    real_push = net.push
    net.push = lambda nid, kind, body: (False if nid == "node1" and kind == "alert" else real_push(nid, kind, body))   # NetServer: no live socket
    clock["t"] = T0 + 10_000 + Session.ROLE_SETTLE_MS; s.tick()
    line = next(e for e in s.feed if "VIP" in e["text"] and e.get("kind") == "alert")
    assert line["tag"] == "WITHHELD" and "NOT REACHED" in line["text"], line
    # CONTROL: with the socket back, the same push is a ROLE line
    net.push = real_push
    s._role_due.append((clock["t"], ps[1]["player_id"], "vip", True, None))   # re-queue by hand, as a VIP respawn would
    clock["t"] += 1; s.tick()
    assert any(e.get("tag") == "ROLE" and "VIP" in e["text"] for e in s.feed)
