"""A loadout pick that lands AFTER start() — why it is now REFUSED, and what still happens before one.

THE KIT LOCKS AT START (2026-09-12). Every kit change is compiled into `frames`, and the only way to put
new frames on a gun is a `config` envelope, which rewrites `frames.head`. Since A23/F121 that head is the
DISARMED fn-28 `$SIR` table — the real one now rides `frames.spawn` / `frames.revive` — and on the node
`_applyConfig()` sets `spawned = false` while KEEPING an armed/live phase, with `resumeSchedule()`
returning early in `live`. So nothing re-spawns that gun: the player registers every hit, moves no pool
and cannot fire, for the rest of the match. A pick is refused instead, in the player's own words.

This file used to argue the opposite. A clone review (2026-09-07) had flagged that `Session._resend`
re-sends `start` for exactly one of its call sites and suspected a post-`start()` pick left the node
"with a cleared ack and no schedule"; that suspicion was investigated and did not hold, and the re-push
was pinned here as correct. It was correct about the SCHEDULE and wrong about the gun — the head write it
looked past is the whole problem, and F121 made it a disarm. The schedule findings are still true and are
still pinned below; the re-push itself moved to the LOBBY case, where it is right and where it is tested.
"""
from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.state import KIT_LOCKED, Session

T0 = 1_700_000_000_000
_TEAMS = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
          {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 2}]


def _pushed_session():
    """Two players, both online and acked, config pushed — the LOBBY, nothing started."""
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
    return s, net, clock, ps


def _live_session(live: bool = True):
    """…and started. `live=False` stops at ARMED (the countdown), which the rule covers too."""
    s, net, clock, ps = _pushed_session()
    info = s.start(force=True)
    if live:
        clock["t"] = info["go_live_t"] + 1
        s.tick()
    assert s.phase == ("live" if live else "armed"), s.phase
    return s, net, clock, ps


def _pick(net, i, slot="primary", kind="weapon", rid=None, t=T0):
    body = {"node_id": f"node{i}", "player_id": "ignored-by-server", "slot": slot, "kind": kind}
    if rid:
        body["id"] = rid
    net.simulate_node_message(f"node{i}", "loadout_request", body, t)


def _acks(net, i=0):
    return [b for _n, _k, b in net.pushes("loadout_ack", f"node{i}")]


def test_a_loadout_pick_after_start_does_not_disturb_the_match_schedule():
    """The half of the 2026-09-07 suspicion that mattered, and it is still pinned: `start_info` must
    survive untouched, because it is what every node's countdown is aligned to."""
    s, net, clock, ps = _live_session()
    before = dict(s.start_info)
    _pick(net, 0, rid="shotgun")
    assert s.start_info == before, (
        f"a loadout pick rewrote the match schedule: {before} -> {s.start_info}")


def test_a_pick_after_start_is_refused_in_the_players_own_words_and_changes_nothing():
    """The rule: no `config` reaches a gun in play, the stored kit does not move, and the phone is told
    WHY in a line the HUD shows verbatim."""
    s, net, clock, ps = _live_session()
    configs_before = len(net.pushes("config", "node0"))
    before = dict(ps[0]["loadout"])
    _pick(net, 0, rid="shotgun")
    ack = _acks(net)[-1]
    assert ack["ok"] is False and ack["reason"] == KIT_LOCKED, ack
    assert ack["loadout"] == before, "the ack must carry the kit they still have"
    assert ps[0]["loadout"] == before, "nothing is stored"
    assert len(net.pushes("config", "node0")) == configs_before, "no config envelope may reach a gun in play"
    assert len(net.pushes("start", "node0")) == 1, "and no second start"


def test_the_host_cannot_change_a_kit_mid_match_either_but_a_re_team_still_works():
    """Same rule from the other side. Only the fields that are COMPILED to the gun are refused; a
    mid-match re-team, a ready flag and a gamertag ride in `assign` and never touch the head."""
    s, net, clock, ps = _live_session(live=False)       # the countdown is already too late to re-kit
    pid = ps[0]["player_id"]
    configs_before = len(net.pushes("config", "node0"))
    for field, value in (("loadout", {"weapons": [{"weapon_id": "shotgun"}]}), ("voice", "female"),
                         ("gun_id", "GUN-Z")):
        try:
            s.patch_player(pid, **{field: value})
            assert False, f"the host changed {field} on a gun in play"
        except ValueError as e:
            assert s.phase.upper() in str(e) and field in str(e), (field, str(e))
    assert ps[0]["loadout"] == {"weapons": [{"weapon_id": "assault_rifle"}]}, ps[0]["loadout"]
    s.patch_player(pid, team_id="yellow")                 # the scorer follows a re-team; the gun does not care
    assert ps[0]["team_id"] == "yellow" and s.scorer.stats[pid].team_id == "yellow"
    assert len(net.pushes("config", "node0")) == configs_before, "not even an allowed patch re-pushes frames"
    assert net.pushes("assign", "node0"), "the roster change still reaches the phone"


def test_the_lobby_is_where_a_pick_still_re_pushes_and_the_ack_self_heals():
    """Before the start, a pick MUST reach the gun — that is what KIT and LOBBY are for. The ack clearing
    is correct (the node holds a new head it has not echoed, so calling it acked would be a lie) and it is
    recoverable: the node's own `ack_config` ~1.5 s later restores it. Both were pinned in the old file
    against the live case; they belong here.
    """
    s, net, clock, ps = _pushed_session()
    pid = ps[0]["player_id"]
    assert s.phase != "live" and s.acks.get(pid, {}).get("ok"), "precondition: pushed, acked, not started"
    configs_before = len(net.pushes("config", "node0"))
    _pick(net, 0, rid="shotgun")
    assert _acks(net)[-1]["ok"] is True, _acks(net)[-1]
    assert ps[0]["loadout"]["weapons"][0]["weapon_id"] == "shotgun", "the pick reaches the player row"
    assert len(net.pushes("config", "node0")) == configs_before + 1, "and the gun"
    assert not s.acks.get(pid), "a fresh bundle must invalidate the old ack"
    net.simulate_node_message("node0", "ack_config",
                              {"config_id": s.config["config_id"], "ok": True, "gun_echo": "x"}, clock["t"])
    assert s.acks.get(pid, {}).get("ok"), "the node's echo must restore the ack"
    # and no `start` is invented by a pick, which is the other half of the 2026-09-07 investigation
    assert not net.pushes("start", "node0")


def test_a_pick_in_the_KIT_phase_applies_without_any_lobby_push():
    """The other end of the window, for contrast, and it is an ACCEPT rather than a refusal.

    Choosing a loadout before the game is pushed is the whole point of the KIT phase, and the phase
    begins as soon as a node says hello. The refusal in `_on_loadout_request` ("Mission Control is
    still setting up the game") is reserved for the narrower case of a pick arriving while the
    session is neither in KIT nor pushed."""
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


def test_a_late_joiner_still_hot_joins_a_running_match():
    """A30 locks the kit of a gun IN PLAY; it does not close the door on a phone that was never in this
    match. Contracts §5 `start` / node.md M-START E5: `assign` → `config` → the SAME `start`, and
    `engine.js resumeSchedule()` — whose phase is not `live` for a node that never took this config —
    reaches `_spawn()` and logs the hot join. So the arriving node gets both, in that order."""
    s, net, clock, ps = _live_session()
    late = s.add_player("OP2", gun_id="GUN-C")
    assert not net.pushes("config", "node2"), "nothing to push until the phone is actually there"
    tail = demo_armory()[2]["ble"]["tail"]
    net.simulate_hello("node2", f"GUN-C-{tail}")
    kinds = [k for n, k, _b in net.pushes(None, "node2") if n == "node2"]   # not the broadcast start of the match itself
    assert "config" in kinds and "start" in kinds, kinds
    assert kinds.index("config") < kinds.index("start"), f"the head first, then the schedule: {kinds}"
    started = [b for n, _k, b in net.pushes("start", "node2") if n == "node2"][-1]
    assert started == s._start_body(), "the SAME start (seq + match_id), or the node treats it as a new match"
    assert late["player_id"] in s.bundles and s.phase == "live"


def test_but_a_node_that_already_took_this_config_is_refused():
    """The other side of the same question, and the reason the guard is per-player: a node holding this
    match's head would be UN-SPAWNED by a fresh one, so nothing may push to it."""
    s, net, clock, ps = _live_session()
    p = ps[0]
    assert s.acks.get(p["player_id"], {}).get("ok"), "fixture: this node acked the config it is playing"
    # Both halves of the per-player question, and both falsifiable (round-2 review 2026-09-12: the old
    # line read `not X is False`, which asserted the opposite of its own wording and could not fail).
    assert s._took_this_config(p) is True, "a node that acked this config is playing it"
    late = s.add_player("OP9", gun_id="GUN-D")     # added mid-match: no ack, no node, no head
    assert s._took_this_config(late) is False, "a player who never got a push holds none of this config"
    pushes = len(net.pushes("config", "node0"))
    try:
        s._push_config_to(p)
        assert False, "a gun in play was re-armed"
    except ValueError as e:
        assert getattr(e, "status", None) == 409 and "locked" in str(e), (getattr(e, "status", None), str(e))
    assert len(net.pushes("config", "node0")) == pushes
    # the ack alone is not the only signal: a node that never acked but REPORTS itself live is in play too
    q = s.players[ps[1]["player_id"]]
    s.acks.pop(q["player_id"], None)
    s.nodes[q["node_id"]]["arm_state"] = "live"
    assert s._took_this_config(q)
    try:
        s._push_config_to(q)
        assert False, "a node reporting itself live was re-armed"
    except ValueError:
        pass


def test_adopting_a_node_that_is_ALREADY_in_play_binds_it_without_raising():
    """Round-2 review 2026-09-12: `_bind` pushed the config AFTER rebinding, so a raise left a half-bind.

    The reachable route: a phone hellos with a gun nobody on the roster holds yet, so it stays unbound,
    and it is already armed and playing. The operator then adds that gun's player mid-match. `_bind`
    rebinds the node, clears the previous holder and rebases the scorer, and only THEN called
    `_push_config_to` — which raises for a node that took this config (A30). The escape left the node
    bound in `node_player` with a player row that never finished being written, and `add_player` itself
    blew up in the operator's face. The decision is made before anything is pushed now: a node in play
    is bound and simply left alone."""
    s, net, clock, ps = _live_session()
    tail = demo_armory()[2]["ble"]["tail"]
    net.simulate_hello("node2", f"GUN-C-{tail}")                  # no GUN-C on the roster yet
    assert s.node_player.get("node2") is None, "fixture: this node binds nobody at hello"
    net.simulate_status("node2", {"arm_state": "live", "synced": True, "alive": True}, clock["t"])
    late = s.add_player("OP2", gun_id="GUN-C")                    # <- used to raise ConflictError
    assert late["node_id"] == "node2" and s.node_player["node2"] == late["player_id"], (
        f"the adopt left a half-binding: {late.get('node_id')} / {s.node_player.get('node2')}")
    assert s._took_this_config(late), "fixture: the adopted node really is in play"
    assert late["player_id"] not in s.bundles, "a gun in play is never handed a fresh head"
    assert not net.pushes("config", "node2"), "no config may reach a node that is already playing"
    # `_resend` still re-sends the RUNNING start, which is the same shape `_resend` documents: same seq
    # and match_id, so `engine.js startAt()` answers `reason: 'noop'`. It is the head that must not go.
    starts = [b for n, _k, b in net.pushes("start", "node2") if n == "node2"]
    assert starts and all(b == s._start_body() for b in starts), starts
