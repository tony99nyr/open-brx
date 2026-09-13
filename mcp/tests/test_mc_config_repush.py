"""B1 / B3 (field session 2026-09-12) — editing a LOADED game must keep the guns current.

The P0: a TDM where "they can't shoot each other" while FFA worked. The distinct $TID MC compiled was
not reaching the guns' combat resolution, because:

* `set_config`, called while the lobby was already pushed, silently DROPPED the push (`lobby_pushed`
  went False and `acks` cleared) and never re-compiled — so every gun kept the STALE head (old
  $TID / mode / health / weapons) with nothing on screen saying so (B3, and the mechanism of B1).
* A team change after that un-push then rode in `assign` alone (beacon/LED/scorer), so the gun's
  $TID — the last frame of the config head — never moved. Same effective $TID on every gun =
  friendly resolution = no $HIR = no hits.

The fix: an edit while `lobby_pushed` in KIT/LOBBY AUTO re-pushes fresh frames to every bound node and
keeps `lobby_pushed` True (acks reset + re-collected). A team change while armed/live is REFUSED.
FFA must stay green throughout.
"""
from brx_mcp.mc.fakes import demo_armory
from test_mc_block_b import go_live, mk, online

from brx_mcp.mc.state import ConflictError

# the FakeCompiler writes `$TID,<tid>,*` as the LAST frame of `head`; TDM defaults are blue=1, yellow=2.
BLUE, YELLOW = "$TID,1,*", "$TID,2,*"


def _push_lobby(n_players=2, mode="tdm", cfg=None):
    s, net, clock, ps = mk(n_players, mode, cfg)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    s.push_config()
    for i in range(n_players):
        net.simulate_node_message(f"node{i}", "ack_config",
                                  {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD"}, clock["t"])
    assert s.lobby_pushed and s.phase == "lobby" and s.all_acked()
    return s, net, clock, ps


def _head_to(net, node_id):
    cfgs = net.pushes("config", node_id=node_id)
    assert cfgs, f"no config ever pushed to {node_id}"
    return cfgs[-1][2]["frames"]["head"]


# ---------------------------------------------------------------------------------------------
# B3 — a config edit in a pushed lobby re-pushes fresh frames to every bound node
# ---------------------------------------------------------------------------------------------
def test_editing_mode_health_or_weapons_in_a_pushed_lobby_repushes_to_all_bound_nodes():
    """Today (pre-fix): `set_config` set `lobby_pushed=False`, cleared acks, and pushed NOTHING — the
    guns kept the old frames silently. After the fix: a fresh `config` reaches every bound node, the
    lobby stays pushed, and the acks reset to 0 then re-collect."""
    s, net, clock, ps = _push_lobby(2, "tdm")
    before = {f"node{i}": len(net.pushes("config", node_id=f"node{i}")) for i in range(2)}
    s.set_config({"health": {"max_hp": 25}})             # a plain on-the-fly edit of the loaded game
    assert s.lobby_pushed is True, "the lobby must STAY pushed across an edit, not silently un-push"
    assert s.acks == {}, "acks reset to re-collect as the guns echo the new head"
    for i in range(2):
        n = len(net.pushes("config", node_id=f"node{i}"))
        assert n == before[f"node{i}"] + 1, f"node{i} was not re-pushed a fresh config ({n})"
    # and the re-pushed head actually carries the edit
    head = _head_to(net, "node0")
    assert any(f.startswith("$PSET,") and ",25," in f for f in head), head


def test_changing_mode_to_ffa_in_a_pushed_lobby_repushes_with_the_new_mode_frames():
    """A mode swap is the widest edit — the whole bundle changes. It must reach every gun, not strand
    them on the previous mode's frames."""
    s, net, clock, ps = _push_lobby(2, "tdm")
    before = len(net.pushes("config", node_id="node1"))
    s.set_config({"mode": "ffa"})
    assert s.lobby_pushed is True
    assert len(net.pushes("config", node_id="node1")) == before + 1
    cfg = net.pushes("config", node_id="node1")[-1][2]["config"]
    assert cfg["mode"] == "ffa", cfg.get("mode")


# ---------------------------------------------------------------------------------------------
# B1 — a team change carries the new $TID, and the combined edit-then-reteam keeps guns current
# ---------------------------------------------------------------------------------------------
def test_a_team_change_in_lobby_repushes_a_fresh_config_with_the_new_tid():
    """The gun's team lives in the head's `$TID`. Moving a player to a new team in the lobby must put a
    fresh head — with the NEW $TID — on that player's gun, or the beacon/LED change teams while combat
    does not (the TDM P0)."""
    s, net, clock, ps = _push_lobby(2, "tdm")
    assert ps[1]["team_id"] == "yellow", ps[1]["team_id"]      # ps[0] blue, ps[1] yellow by default
    before = len(net.pushes("config", node_id="node1"))
    s.patch_player(ps[1]["player_id"], team_id="blue")
    assert len(net.pushes("config", node_id="node1")) == before + 1, "a re-team in lobby must re-push"
    assert _head_to(net, "node1")[-1] == BLUE, "the re-pushed head must carry the NEW $TID"


def test_editing_the_loaded_game_then_reteaming_still_rewrites_the_gun_tid():
    """The exact field sequence that produced B1: the operator edits the loaded game (health), THEN
    drags a player to another team. Pre-fix the edit un-pushed the lobby, so the later re-team saw
    `lobby_pushed=False` and rode in `assign` alone — the gun's $TID never moved. Post-fix both legs
    re-push, so the gun ends on the team it is shown as."""
    s, net, clock, ps = _push_lobby(2, "tdm")
    s.set_config({"health": {"max_hp": 30}})
    assert s.lobby_pushed is True, "the edit must not silently disable the re-team re-push"
    before = len(net.pushes("config", node_id="node1"))
    s.patch_player(ps[1]["player_id"], team_id="blue")
    assert len(net.pushes("config", node_id="node1")) == before + 1
    assert _head_to(net, "node1")[-1] == BLUE, "combat team ($TID) follows the roster, not just the beacon"


# ---------------------------------------------------------------------------------------------
# B1 — a team change once the match is armed/live is REFUSED (never silently assign-only)
# ---------------------------------------------------------------------------------------------
def test_a_team_change_is_refused_once_the_match_is_live():
    """The A30 head-lock means a live re-team cannot rewrite the gun's $TID, so MC must refuse it rather
    than let the roster and the gun silently disagree. The player stays on their team; no `assign` goes
    out carrying the stale combat team."""
    s, net, clock, ps, info = go_live(2, "tdm")
    assert s.phase == "live"
    assigns_before = len(net.pushes("assign", node_id="node1"))
    configs_before = len(net.pushes("config", node_id="node1"))
    try:
        s.patch_player(ps[1]["player_id"], team_id="blue")
        assert False, "a live re-team must be refused"
    except ConflictError as e:
        assert "LIVE" in str(e) and "RECALL" in str(e), str(e)
    assert ps[1]["team_id"] == "yellow", "the roster must not move on a refused re-team"
    assert len(net.pushes("assign", node_id="node1")) == assigns_before, "no assign with a stale team"
    assert len(net.pushes("config", node_id="node1")) == configs_before, "no frames to a gun in play"


# ---------------------------------------------------------------------------------------------
# The SNAPSHOT surface the operator console reads (`state.lobby`) — the re-ack indicator
# ---------------------------------------------------------------------------------------------
def test_the_lobby_snapshot_shows_the_repush_as_acks_resetting_and_reclimbing():
    """The console has no new server field to watch: it reads `lobby.pushed` / `lobby.acks` /
    `lobby.all_acked`. Across an edit the lobby must stay PUSHED while the ack count drops to 0 and
    climbs back, so "config pushed X/Y" reads as a re-push in progress rather than the push vanishing.
    Pinned here because that snapshot — not the Session attributes — is what the UI and its e2e assert."""
    s, net, clock, ps = _push_lobby(2, "tdm")
    lob = s.snapshot()["lobby"]
    assert lob["pushed"] is True and len(lob["acks"]) == 2 and lob["all_acked"] is True, lob

    s.set_config({"health": {"max_hp": 25}})
    lob = s.snapshot()["lobby"]
    assert lob["pushed"] is True, "the lobby must still read as PUSHED across an edit"
    assert lob["acks"] == {}, "every ack is withdrawn — the guns hold a head they have not echoed yet"
    assert lob["all_acked"] is False, "so the operator cannot start until the re-push is echoed"

    # ...and each gun's echo of the NEW head climbs the counter back to full.
    for i in range(2):
        net.simulate_node_message(f"node{i}", "ack_config",
                                  {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD"}, clock["t"])
    lob = s.snapshot()["lobby"]
    assert lob["pushed"] is True and len(lob["acks"]) == 2 and lob["all_acked"] is True, lob


# ---------------------------------------------------------------------------------------------
# FFA stays green — the single-team case the whole fix must not disturb
# ---------------------------------------------------------------------------------------------
def test_ffa_edit_in_lobby_repushes_and_keeps_the_single_team():
    """FFA masked the bug (one team, friendly fire forced on). The re-push path must work there too,
    and never split FFA into teams."""
    s, net, clock, ps = _push_lobby(2, "ffa")
    before = len(net.pushes("config", node_id="node0"))
    s.set_config({"health": {"max_hp": 35}})
    assert s.lobby_pushed is True
    assert len(net.pushes("config", node_id="node0")) == before + 1
    cfg = net.pushes("config", node_id="node0")[-1][2]["config"]
    assert len(cfg["teams"]) == 1 and cfg["mode"] == "ffa", cfg


# ---------------------------------------------------------------------------------------------
# Round-1 polish review 2026-09-12 — ONE edit is ONE push
# ---------------------------------------------------------------------------------------------
def test_a_policy_edit_pushes_each_gun_exactly_one_fresh_config():
    """The B3 fix keeps `lobby_pushed` True across `apply_policy()` — and `_resend` takes its config leg
    for every player the new ruleset re-kitted, so `_repush_lobby_config` then pushed the WHOLE roster a
    second time. One operator edit, two full compiles and two `config` frames per gun; the first of them
    compiled against the not-yet-cleared `_pinned_hit_plan`, so the two pushes could disagree about the
    shared hit-audio plan (A17) and a gun re-armed from the earlier one has no row for a rekeyed cell.

    `test_editing_mode_health_or_weapons_...` above cannot see this: a health edit changes no loadout, so
    `apply_policy` resends nothing. A PRESET edit re-kits everyone, which is where the double push lives."""
    s, net, clock, ps = _push_lobby(2, "tdm")
    before = {f"node{i}": len(net.pushes("config", node_id=f"node{i}")) for i in range(2)}
    s.set_config({"loadout_policy": {"preset": "snipers"}})
    assert [w["weapon_id"] for p in s.players.values() for w in p["loadout"]["weapons"]] == \
        ["sniper_rifle", "sniper_rifle"], "setup: the preset must actually re-kit both players"
    for i in range(2):
        n = len(net.pushes("config", node_id=f"node{i}")) - before[f"node{i}"]
        assert n == 1, f"node{i} got {n} config pushes for ONE edit"
    assert s.lobby_pushed is True and s.acks == {}
    head = _head_to(net, "node0")
    assert any("<sniper_rifle>" in f for f in head), ("the one push must carry the NEW ruleset", head)


# ---------------------------------------------------------------------------------------------
# Round-2 fix pass H + J (2026-09-12)
# ---------------------------------------------------------------------------------------------
def test_h_a_player_with_no_node_bound_is_recompiled_by_the_repush_too():
    """H: `_repush_lobby_config` recompiled only `if p.get("node_id")`, but `_push_config_to` (which
    `push_config` runs for EVERY player) writes `self.bundles[pid]` BEFORE it looks for a socket.

    So a player unbound at edit time -- phone not up yet, or cleared by `evict_node`, which drops
    `node_id` and the ack but KEEPS the bundle -- kept the PRE-EDIT bundle. On their next hello
    `_hydrate` finds the id already in `bundles` and the welcome ships the NEW `config_id` beside the
    OLD frames: `engine.js` `startAt` passes (it holds the new id) and the gun arms on the stale
    $TID/$GSET, while the board reads pushed. The edit must recompile EVERY player's bundle, exactly
    as a full push does; only the SENDING is conditional on having a socket."""
    s, net, clock, ps = _push_lobby(2, "tdm")
    pid = ps[1]["player_id"]
    stale_head = list(s.bundles[pid]["head"])
    assert YELLOW in stale_head, stale_head                     # control: player 1 starts on yellow
    s.evict_node("node1")                                       # the phone goes away, the bundle stays
    assert s.players[pid].get("node_id") is None

    s.patch_player(pid, team_id="blue")                         # the edit lands while they are unbound
    s.patch_player(ps[0]["player_id"], team_id="yellow")        # ...and somebody has to hold the other side
    fresh = s.bundles[pid]["head"]
    assert BLUE in fresh, f"the unbound player kept a STALE head: {fresh}"
    assert YELLOW not in fresh, fresh

    # and the welcome that phone gets on its next hello carries those same fresh frames
    tail = demo_armory()[1]["ble"]["tail"]
    node = net.simulate_hello("node1-again", f"GUN-B-{tail}")
    assert node and node["player"]["player_id"] == pid
    assert node["frames"]["head"] == fresh, node["frames"]["head"]
    assert node["config"]["config_id"] == s.config["config_id"]


def test_j_a_repush_re_arms_every_assigned_station():
    """J: `push_config` calls `arm_stations()` (A13.5) and `_repush_lobby_config` did not, so a team or
    `station_source` edit left an assigned station holding the PRE-EDIT allow-list."""
    s, net, clock, ps = _push_lobby(2, "tdm")
    net.simulate_utility_hello("st1")
    s.set_station("st1", {"kind": "respawn", "team": "blue", "id": 3})
    before = len(net.pushes("station_config", node_id="st1"))
    assert before >= 1, "control: the station was armed once when it was assigned"
    s.set_config({"health": {"max_hp": 33}})
    after = len(net.pushes("station_config", node_id="st1"))
    assert after > before, f"the re-push never re-armed the station ({before} -> {after})"


def test_h_the_lobby_repush_recompiles_an_unbound_players_bundle_too():
    """The same defect on `_repush_lobby_config`'s own path (a CONFIG edit, not a player edit): it
    looped `if p.get("node_id")` while `push_config` loops over the whole roster, because
    `_push_config_to` stores the bundle before it looks for a socket."""
    s, net, clock, ps = _push_lobby(2, "tdm")
    pid = ps[1]["player_id"]
    s.evict_node("node1")
    assert s.players[pid].get("node_id") is None
    s.set_config({"health": {"max_hp": 25}})
    head = s.bundles[pid]["head"]
    assert any(f.startswith("$PSET,") and ",25," in f for f in head), head
