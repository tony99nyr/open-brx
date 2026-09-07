"""A loadout pick that lands AFTER start() — the suspicion, and why it is not a bug.

A clone review (2026-09-07) flagged that `Session._resend` re-sends `start` for exactly one of its
call sites (`_after_player_change`) and not for the others, and suspected that a phone loadout pick
arriving after `start()` therefore left the node "with a cleared ack and no schedule".

Investigated, and the suspicion does not hold. Both halves are false, for reasons that live on the
NODE rather than in MC, which is why reading `state.py` alone made it look wrong:

  * NO SCHEDULE LOST. `engine.js` `_applyConfig()` ends with
    `if (this.phase !== 'armed' && this.phase !== 'live') this._set('lobby')` — an armed or live node
    KEEPS its phase across a config push — and it never touches `this.start`. The schedule survives.
  * THE ACK SELF-HEALS. `_push_config_to` does clear `acks[pid]`, and that is correct: the node is
    being handed a NEW head it has not echoed yet, so claiming it is still acked would be a lie.
    `_checkEcho()` re-reports `ack_config` 1.5 s after the head write, and MC repopulates the ack.

And re-sending `start` anyway would be a no-op rather than a fix: `startAt()` returns
`{ok: true, reason: 'noop'}` for a repeat with the same `seq` and `match_id`.

So the asymmetry in `_resend` is correct as it stands. This file exists so that conclusion is
CHECKED rather than remembered — "we looked into it and it was fine" is worth nothing once the
person who looked has gone. If a future change breaks any leg of the chain above, one of these fails.
"""
from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.state import Session

T0 = 1_700_000_000_000
_TEAMS = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
          {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 2}]


def _live_session():
    """Two players, both online and acked, config pushed, match started."""
    clock = {"t": T0}
    net = FakeNet()
    s = Session(FakeCompiler(), net, FakeArmory(demo_armory()), now_ms=lambda: clock["t"])
    s.set_config({"mode": "tdm", "time_limit_s": 60})
    ps = [s.add_player(f"OP{i}", gun_id=f"GUN-{chr(65 + i)}") for i in range(2)]
    for i, p in enumerate(ps):
        tail = demo_armory()[i]["ble"]["tail"]
        net.simulate_hello(f"node{i}", f"GUN-{chr(65 + i)}-{tail}")
        net.simulate_status(f"node{i}", {"player_id": p["player_id"], "hp": 45, "armor": 70, "ammo": 36,
                                         "alive": True, "shots": 0, "battery": 80, "fw": "v4.32",
                                         "arm_state": "kitted", "synced": True,
                                         "preflight": {"ssid_ok": True, "mc_reachable": True, "phone_batt": 90,
                                                       "screen_on": True, "foreground": True, "gun_linked": True}},
                            clock["t"])
    s.push_config(force=True)
    for i, p in enumerate(ps):
        net.simulate_node_message(f"node{i}", "ack_config",
                                  {"config_id": s.config["config_id"], "ok": True, "gun_echo": "x"}, clock["t"])
    s.start(force=True)
    return s, net, clock, ps


def _pick(net, i, slot="primary", kind="weapon", rid=None, t=T0):
    body = {"node_id": f"node{i}", "player_id": "ignored-by-server", "slot": slot, "kind": kind}
    if rid:
        body["id"] = rid
    net.simulate_node_message(f"node{i}", "loadout_request", body, t)


def test_a_loadout_pick_after_start_does_not_disturb_the_match_schedule():
    """The half of the suspicion that mattered: `start_info` must survive untouched, because it is
    what every node's countdown is aligned to."""
    s, net, clock, ps = _live_session()
    before = dict(s.start_info)
    _pick(net, 0, rid="shotgun")
    assert s.start_info == before, (
        f"a loadout pick rewrote the match schedule: {before} -> {s.start_info}")


def test_a_loadout_pick_after_start_pushes_a_fresh_config_but_no_new_start():
    """MC re-compiles and re-pushes the bundle (the pick has to reach the gun) and deliberately does
    NOT re-send `start` — the node already holds the schedule and keeps it across a config push."""
    s, net, clock, ps = _live_session()
    starts_before = len(net.pushes("start", "node0"))
    configs_before = len(net.pushes("config", "node0"))
    _pick(net, 0, rid="shotgun")
    assert len(net.pushes("config", "node0")) == configs_before + 1, "the pick must reach the gun"
    assert len(net.pushes("start", "node0")) == starts_before, (
        "start was re-sent after a loadout pick — the node already holds this schedule, and "
        "_resend's with_start is deliberately False here")


def test_the_ack_clears_on_the_new_bundle_and_comes_back_when_the_node_echoes():
    """Clearing is CORRECT — the node has a new head it has not echoed, so reporting it as acked
    would be a lie. What matters is that it is recoverable, which the node's own `ack_config` does."""
    s, net, clock, ps = _live_session()
    pid = ps[0]["player_id"]
    assert s.acks.get(pid, {}).get("ok"), "precondition: acked before the pick"
    _pick(net, 0, rid="shotgun")
    assert not s.acks.get(pid), "a fresh bundle must invalidate the old ack"
    net.simulate_node_message("node0", "ack_config",
                              {"config_id": s.config["config_id"], "ok": True, "gun_echo": "x"}, clock["t"])
    assert s.acks.get(pid, {}).get("ok"), "the node's echo must restore the ack"


def test_a_pick_in_the_KIT_phase_applies_without_any_lobby_push():
    """The other end of the window, for contrast, and it is an ACCEPT rather than a refusal.

    Choosing a loadout before the game is pushed is the whole point of the KIT phase, and the phase
    begins as soon as a node says hello. The refusal in `_on_loadout_request` ("Mission Control is
    still setting up the game") is reserved for the narrower case of a pick arriving while the
    session is neither in KIT nor pushed — worth pinning because the accept path here and the
    re-push path above look identical from `_resend`'s side and are reached under opposite
    conditions."""
    clock = {"t": T0}
    net = FakeNet()
    s = Session(FakeCompiler(), net, FakeArmory(demo_armory()), now_ms=lambda: clock["t"])
    s.set_config({"mode": "tdm", "time_limit_s": 60})
    p = s.add_player("OP0", gun_id="GUN-A")
    tail = demo_armory()[0]["ble"]["tail"]
    net.simulate_hello("node0", f"GUN-A-{tail}")
    assert s.phase == "kit" and not s.lobby_pushed, f"expected an un-pushed KIT session, got {s.phase}"
    _pick(net, 0, rid="shotgun")
    acks = net.pushes("loadout_ack", "node0")
    assert acks and acks[-1][2]["ok"] is True, f"a KIT-phase pick should apply, got {acks[-1][2] if acks else None}"
    assert p["loadout"]["weapons"][0]["weapon_id"] == "shotgun", "the pick must reach the player row"
    # and with nothing pushed yet there is no config to re-push
    assert not net.pushes("config", "node0"), "no config should be pushed before the lobby push"
