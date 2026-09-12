"""A32 — a SUSTAINED BLE link proves the headset (`readiness().board[].headset` / `headset_proof`).

Run: python3 run_tests.py test_mc_headset_proof

Bench fact behind the rule (docs/manual/hardware.md, docs/manual/dev.md): a gun with NO headset still
accepts a BLE link and answers a `$PING`, then drops it within ~6 s; switching a linked headset off makes
the gun send `$DISCONNECT,*` and drop the same way. So a link that SURVIVES `HEADSET_LINK_PROOF_MS` is a
headset, and the board no longer has to wait for the config push to say so.
"""
from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.state import Session
from brx_mcp.mc.types import HEADSET_LINK_PROOF_MS

T0 = 5_000_000


def mk(n_players=1):
    clock = {"t": T0}
    net = FakeNet()
    s = Session(FakeCompiler(), net, FakeArmory(demo_armory()), now_ms=lambda: clock["t"])
    s.set_config({"mode": "tdm", "time_limit_s": 60})
    ps = [s.add_player(f"OP{i}", gun_id=f"GUN-{chr(65 + i)}") for i in range(n_players)]
    return s, net, clock, ps


def hello(net, clock, p, i=0):
    tail = demo_armory()[i]["ble"]["tail"]
    net.simulate_hello(f"node{i}", f"GUN-{chr(65 + i)}-{tail}")


def beat(net, clock, p, i=0, gun_linked=True):
    """One ~2 s status heartbeat at the current clock."""
    pf = {"ssid_ok": True, "mc_reachable": True, "phone_batt": 90, "screen_on": True, "foreground": True}
    if gun_linked is not None:
        pf["gun_linked"] = gun_linked
    net.simulate_status(f"node{i}", {"player_id": p["player_id"], "hp": 45, "armor": 70, "ammo": 36, "alive": True,
                                     "shots": 0, "battery": 80, "fw": "v4.32", "arm_state": "kitted", "synced": True,
                                     "preflight": pf}, clock["t"])


def row(s):
    return s.readiness()["board"][0]


def test_a_link_four_seconds_old_is_still_unknown_and_says_it_is_confirming():
    """The amber COUNTS UP instead of telling the operator to push the lobby."""
    s, net, clock, ps = mk()
    hello(net, clock, ps[0]); beat(net, clock, ps[0])
    clock["t"] += 4_000
    beat(net, clock, ps[0])                     # still linked — the window does NOT restart
    r = row(s)
    assert r["headset"] == "unknown", "4 s is inside the ~6 s a HEADLESS gun can hold a link"
    assert r["headset_proof"] is None
    assert "HEADSET · CONFIRMING (LINK 4 s)" in r["ambers"]
    assert r["status"] == "amber" and s.readiness()["go"], "confirming is an advisory, never a gate"
    assert not any("HEADSET UNPROVEN" in a for a in r["ambers"]), "A32 retired that amber"


def test_a_link_held_for_the_proof_window_proves_the_headset():
    s, net, clock, ps = mk()
    hello(net, clock, ps[0]); beat(net, clock, ps[0])
    clock["t"] += HEADSET_LINK_PROOF_MS
    beat(net, clock, ps[0])
    r = row(s)
    assert r["headset"] == "proven" and r["headset_proof"] == "link"
    assert not any("HEADSET" in a for a in r["ambers"]), "proven says nothing; it just stops complaining"
    assert r["status"] == "green"


def test_the_link_dropping_un_proves_the_headset():
    """`$DISCONNECT,*` is what a headset being switched off looks like from the phone."""
    s, net, clock, ps = mk()
    hello(net, clock, ps[0]); beat(net, clock, ps[0])
    clock["t"] += HEADSET_LINK_PROOF_MS; beat(net, clock, ps[0])
    assert row(s)["headset"] == "proven"
    clock["t"] += 2_000; beat(net, clock, ps[0], gun_linked=False)
    r = row(s)
    assert r["headset"] == "unknown" and r["headset_proof"] is None
    assert not any("CONFIRMING" in a for a in r["ambers"]), "nothing is confirming while the link is DOWN"
    assert "GUN LINK LOST — BLOCKS START" in r["blockers"]


def test_a_re_link_has_to_earn_the_proof_again():
    s, net, clock, ps = mk()
    hello(net, clock, ps[0]); beat(net, clock, ps[0])
    clock["t"] += HEADSET_LINK_PROOF_MS; beat(net, clock, ps[0])
    clock["t"] += 2_000; beat(net, clock, ps[0], gun_linked=False)
    clock["t"] += 2_000; beat(net, clock, ps[0])                    # re-linked NOW
    assert row(s)["headset"] == "unknown", "the old window died with the link"
    clock["t"] += HEADSET_LINK_PROOF_MS - 1; beat(net, clock, ps[0])
    assert row(s)["headset"] == "unknown", "one millisecond short is short"
    clock["t"] += 1; beat(net, clock, ps[0])
    r = row(s)
    assert r["headset"] == "proven" and r["headset_proof"] == "link"


def test_a_missing_gun_linked_flag_is_not_a_link():
    """A preflight that says nothing about the gun proves nothing — it must not age into a headset."""
    s, net, clock, ps = mk()
    hello(net, clock, ps[0]); beat(net, clock, ps[0], gun_linked=None)
    clock["t"] += HEADSET_LINK_PROOF_MS * 2; beat(net, clock, ps[0], gun_linked=None)
    r = row(s)
    assert r["headset"] == "unknown" and r["headset_proof"] is None
    assert not any("CONFIRMING" in a for a in r["ambers"])


def test_the_config_echo_still_proves_it_immediately_and_says_echo():
    s, net, clock, ps = mk()
    hello(net, clock, ps[0]); beat(net, clock, ps[0])
    s.push_config(force=True)
    net.simulate_node_message("node0", "ack_config", {"config_id": s.config["config_id"], "ok": True,
                                                      "gun_echo": "$LCD,0,0,0,0,0,0,*"}, clock["t"])
    r = row(s)
    assert r["headset"] == "proven" and r["headset_proof"] == "echo", "the gun answering IS the headset"
    assert not any("CONFIRMING" in a for a in r["ambers"])


def test_a_head_that_echoed_nothing_is_absent_and_red_unchanged():
    s, net, clock, ps = mk()
    hello(net, clock, ps[0]); beat(net, clock, ps[0])
    clock["t"] += HEADSET_LINK_PROOF_MS; beat(net, clock, ps[0])
    assert row(s)["headset"] == "proven"                      # proven by link, and then the push disagrees
    s.push_config(force=True)
    net.simulate_node_message("node0", "ack_config", {"config_id": s.config["config_id"], "ok": True,
                                                      "gun_echo": None}, clock["t"])
    r = row(s)
    assert r["headset"] == "absent" and r["headset_proof"] is None, "a silent head beats any link evidence"
    assert "GUN DID NOT ANSWER CONFIG — HEADSET OFF? BLOCKS START" in r["blockers"]
    assert r["status"] == "red"


def test_a_node_that_has_never_sent_a_status_reads_as_before():
    """Bound but silent: unknown, no proof, and no CONFIRMING count-up for a link nobody reported."""
    s, net, clock, ps = mk()
    hello(net, clock, ps[0])
    r = row(s)
    assert r["headset"] == "unknown" and r["headset_proof"] is None
    assert not any("HEADSET" in a for a in r["ambers"])


def test_an_offline_node_is_not_aged_into_a_proven_headset():
    """Its `gun_linked_since` is a fact about a phone that left. OFFLINE must not print PROVEN."""
    s, net, clock, ps = mk()
    hello(net, clock, ps[0]); beat(net, clock, ps[0])
    clock["t"] += 11 * 60 * 1000                              # past OFFLINE_AFTER_MS, no heartbeat
    r = row(s)
    assert r["headset"] == "unknown" and r["headset_proof"] is None
    assert any(b.startswith("OFFLINE") for b in r["blockers"])


def test_the_demo_fake_net_reads_sensibly():
    """`--demo` drives real heartbeats, so its board must settle on PROVEN BY LINK, not sit amber."""
    s, net, clock, ps = mk(2)
    for i, p in enumerate(ps):
        hello(net, clock, p, i); beat(net, clock, p, i)
    clock["t"] += HEADSET_LINK_PROOF_MS
    for i, p in enumerate(ps):
        beat(net, clock, p, i)
    rd = s.readiness()
    assert [r["headset_proof"] for r in rd["board"]] == ["link", "link"]
    assert rd["go"] and rd["greens"] == 2


def test_an_echoed_proof_is_un_proved_by_the_link_dropping_too():
    """The echo set `nodes[nid]["headset"] = "proven"` and NOTHING ever cleared it.

    So A32's "falls back to `unknown` when the link drops" did not apply to a gun that had echoed once:
    the operator could switch the headset off, watch GUN LINK LOST go red, and still read HEADSET ·
    CONNECTED beside it. The echo proves the head answered THEN; the link is what proves it is still on.
    """
    s, net, clock, ps = mk()
    hello(net, clock, ps[0]); beat(net, clock, ps[0])
    s.push_config(force=True)
    net.simulate_node_message("node0", "ack_config", {"config_id": s.config["config_id"], "ok": True,
                                                      "gun_echo": "$LCD,0,0,0,0,0,0,*"}, clock["t"])
    assert row(s)["headset_proof"] == "echo"

    clock["t"] += 2_000; beat(net, clock, ps[0], gun_linked=False)      # headset switched off
    r = row(s)
    assert r["headset"] == "unknown" and r["headset_proof"] is None, "an old echo outlived the headset"
    assert "GUN LINK LOST — BLOCKS START" in r["blockers"]

    clock["t"] += 2_000; beat(net, clock, ps[0])                        # re-linked: earn it again
    assert row(s)["headset"] == "unknown"
    clock["t"] += HEADSET_LINK_PROOF_MS; beat(net, clock, ps[0])
    r = row(s)
    assert r["headset"] == "proven" and r["headset_proof"] == "link"


def test_the_whistle_clears_an_echo_proof_for_the_next_match():
    """`acks` is emptied at `_finish`, so the echo's OTHER half — the red "GUN DID NOT ANSWER CONFIG"
    — resets for the next lobby. The proof it set must reset with it, or a gun whose headset died in
    the debrief reads PROVEN through the whole next muster on an echo from the match before."""
    s, net, clock, ps = mk()
    hello(net, clock, ps[0]); beat(net, clock, ps[0])
    s.push_config(force=True)
    net.simulate_node_message("node0", "ack_config", {"config_id": s.config["config_id"], "ok": True,
                                                      "gun_echo": "$LCD,0,0,0,0,0,0,*"}, clock["t"])
    info = s.start(runway_s=10)
    clock["t"] = info["go_live_t"] + 1; s.tick()
    beat(net, clock, ps[0])
    s.control("end")
    assert s.phase == "recap"
    assert s.nodes["node0"].get("headset") != "proven", "the echo proof rode into the next match"
    beat(net, clock, ps[0])
    assert row(s)["headset_proof"] != "echo"
