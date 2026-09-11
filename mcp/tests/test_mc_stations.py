"""A13.5 / F104: MC arms the utility stations (`station_config`), the ITEMS roster, the per-match game
byte, and `config.stations` in the bundle.

Found 2026-09-11: the phone side of arming had been built for a week (`utility.js applyStationConfig`),
the spec named the message, and `grep station_config mcp/` returned NOTHING -- so no station was ever
armed in the field, the allow-list never reached a player phone, and a phone control point carried
match 1's owner and possession seconds into match 2 (the only reset it has fires when the ARMED game
number changes). Every test here pairs the behaviour with a control on the same path.
"""
from __future__ import annotations

import pathlib
import re

from brx_mcp.mc import envelope as E
from brx_mcp.mc.compile import Compiler
from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
from brx_mcp.mc.state import Session
from brx_mcp.mc.types import MC_KINDS, STATION_KINDS

REPO = pathlib.Path(__file__).resolve().parents[2]


def _sess(mode="tdm", n=2, **cfg):
    s = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()))
    s.set_config({"mode": mode, **cfg})
    guns = [g["gun_id"] for g in s.armory.list()][:n]
    teams = [t["team_id"] for t in s.config["teams"]]
    for i, g in enumerate(guns):
        s.add_player(f"P{i}", teams[i % len(teams)], g, "male")
    return s


def _joined(s):
    """Every rostered player's phone said hello with its gun (bound), so a push reaches somebody."""
    for i, p in enumerate(s.players.values()):
        s.net.simulate_hello(f"phone-{i}", p["gun_id"])
    return s


def _pushed(s, kind, nid=None):
    return [b for n, k, b in s.net.pushed if k == kind and (nid is None or n == nid)]


# --------------------------------------------------------------------------- the wire
def test_station_config_is_an_mc_kind_on_both_ends_of_the_wire():
    """The message must be in BOTH whitelists. MC's `types.MC_KINDS` and the phone's
    `app/src/transport/envelope.js` MC_KINDS are hand-kept copies; the phone dropped `alert` for two
    days in September because only one was updated, and `station_config` was in neither."""
    env = E.make_envelope("station_config", {"kind": "control", "team": 255, "id": 7, "game": 3, "valid_ids": [7]})
    assert E.decode(E.encode(env), direction="mc")["body"]["id"] == 7
    try:
        E.validate(E.make_envelope("station_config", {"kind": "control", "team": 255}), direction="mc")
        raise AssertionError("station_config without an id was accepted")
    except E.EnvelopeError as e:
        assert e.reason == "missing_field", e.reason
    js = (REPO / "app/src/transport/envelope.js").read_text(encoding="utf-8")
    m = re.search(r"export const MC_KINDS = new Set\(\[(.*?)\]\);", js, re.S)
    assert m, "the phone's MC_KINDS moved"
    phone = set(re.findall(r"'([a-z_]+)'", m.group(1)))
    # CONTROL: the parity itself, so the next kind added on one side only fails here rather than in the field.
    assert phone == set(MC_KINDS), f"phone MC_KINDS {sorted(phone ^ set(MC_KINDS))} differ from MC's"
    # and the phone's transport must DELIVER it to onMessage, not just decode it
    tr = (REPO / "app/src/transport/transport.js").read_text(encoding="utf-8")
    m = re.search(r"const DELIVERED = new Set\(\[(.*?)\]\);", tr, re.S)
    assert m and "'station_config'" in m.group(1) and "'alert'" in m.group(1)


# --------------------------------------------------------------------------- hello / roster
def test_a_utility_hello_is_listed_as_a_station_and_never_bound_to_a_player():
    s = _sess()
    assert s.net.simulate_utility_hello("util-1") is None, "no welcome.node: a station is not hydrated as a player"
    assert "util-1" in s.stations and s.stations["util-1"]["assigned"] is None
    assert "util-1" not in s.node_player
    assert all(p.get("node_id") != "util-1" for p in s.players.values())
    view = s.snapshot()["stations"]
    assert [v["node_id"] for v in view] == ["util-1"] and view[0]["online"]
    # CONTROL: a phone hello with a gun still binds, so `_hydrate`'s early return is reading node_type.
    p0 = next(iter(s.players.values()))
    s.net.simulate_hello("phone-0", p0["gun_id"])
    assert s.node_player["phone-0"] == p0["player_id"]


def test_an_assigned_station_survives_the_unbound_node_prune():
    s = _sess()
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 3})
    s.net.simulate_utility_hello("util-2")            # heard once, never assigned
    later = s.now_ms() + 20 * 60 * 1000
    s.now_ms = lambda: later                          # twenty minutes later
    s._prune_unbound_nodes()
    assert "util-1" in s.stations and "util-1" in s.nodes, "a placed station is not a phantom"
    assert "util-2" not in s.stations and "util-2" not in s.nodes, "CONTROL: an unassigned one still goes"


# --------------------------------------------------------------------------- arming
def test_assigning_a_station_pushes_station_config_with_game_and_the_allow_list():
    s = _sess()
    s.net.simulate_utility_hello("util-1")
    v = s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 3, "threshold": -70})
    cfg = _pushed(s, "station_config", "util-1")
    assert cfg and cfg[-1] == {"kind": "respawn", "team": 1, "id": 3, "threshold": -70, "game": 1, "valid_ids": [3]}, cfg
    assert v["armed"]["game"] == 1 and v["attention"] == [], v
    # a second station changes the allow-list EVERY station echoes, so both are re-armed
    s.net.simulate_utility_hello("util-2")
    s.set_station("util-2", {"kind": "control", "team": "any", "id": 9})
    assert _pushed(s, "station_config", "util-1")[-1]["valid_ids"] == [3, 9]
    assert _pushed(s, "station_config", "util-2")[-1]["valid_ids"] == [3, 9]
    # and the envelope validator accepts what we send (the 2026-09-07 `alert` lesson, pinned)
    for b in _pushed(s, "station_config"):
        E.validate(E.make_envelope("station_config", b), direction="mc")


def test_the_assignment_is_validated_in_the_operators_voice():
    s = _sess()
    s.net.simulate_utility_hello("util-1")
    for bad, why in (({"kind": "hill", "team": "any", "id": 1}, "kind"),
                     ({"kind": "respawn", "team": "purple", "id": 1}, "team"),
                     ({"kind": "respawn", "team": 4, "id": 1}, "team"),
                     ({"kind": "respawn", "team": "blue", "id": 0}, "id"),
                     ({"kind": "respawn", "team": "blue", "id": 70000}, "id"),
                     ({"kind": "respawn", "team": "blue", "id": 1, "threshold": -20}, "threshold"),
                     ({"kind": "control", "team": "blue", "id": 1}, "NEUTRAL")):
        try:
            s.set_station("util-1", bad)
            raise AssertionError(f"accepted {bad}")
        except ValueError as e:
            assert why in str(e), (bad, str(e))
    assert s.stations["util-1"]["assigned"] is None, "a refused assignment leaves nothing behind"
    # ids are unique on the field
    s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 5})
    s.net.simulate_utility_hello("util-2")
    try:
        s.set_station("util-2", {"kind": "respawn", "team": "yellow", "id": 5})
        raise AssertionError("a duplicate station id was accepted")
    except ValueError as e:
        assert "util-1" in str(e)
    assert STATION_KINDS == ("respawn", "powerup", "extraction", "bomb", "control")


def test_a_station_that_is_offline_is_flagged_and_armed_on_its_next_hello():
    """The roadmap's A4 flag: an assignment made while the phone is out of Wi-Fi is not lost, it is owed."""
    s = _sess()
    s.net.simulate_utility_hello("util-1")
    s.net.push = lambda nid, kind, body: False           # NetServer: "no live socket"
    v = s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 3})
    assert v["arm_pending"] and "BRING IT BACK TO RE-ARM" in v["attention"]
    sent = []
    s.net.push = lambda nid, kind, body: sent.append((nid, kind, body))
    s.net.simulate_utility_hello("util-1")               # it walks back into range
    assert sent and sent[-1][1] == "station_config" and sent[-1][2]["id"] == 3
    assert not s._station_view("util-1")["arm_pending"]


# --------------------------------------------------------------------------- the game byte
def test_the_game_byte_changes_on_the_first_push_after_a_match_started_and_reaches_every_station():
    """F104 consequence (c): `applyStationConfig` resets the point only when the ARMED game number
    changes, so this number is the whole between-match reset. It must not change on every re-push
    before a match (an edit at muster is the same match), and it must change once a match has run."""
    s = _joined(_sess("koth", station_source="phone"))
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "control", "team": "any", "id": 9})
    s.push_config(force=True)
    s.push_config(force=True)                            # an edit at muster: same match
    games = [b["game"] for b in _pushed(s, "station_config", "util-1")]
    assert games and set(games) == {1}, games
    s.start(runway_s=3, force=True)
    s.control("end")                                     # match 1 ran
    s.push_config(force=True)                            # muster for match 2
    assert _pushed(s, "station_config", "util-1")[-1]["game"] == 2, "the station is told it is a NEW match"
    # a station that missed that push (out of Wi-Fi) gets the new number on its next hello
    s.net.simulate_utility_hello("util-2")
    s.set_station("util-2", {"kind": "respawn", "team": "blue", "id": 4})
    s.net.pushed.clear()
    s.net.simulate_utility_hello("util-2")
    assert _pushed(s, "station_config", "util-2")[-1]["game"] == 2
    # and the snapshot names the number the operator is looking at
    assert s.snapshot()["game_no"] == 2
    # CONTROL: 255 wraps to 1, never to 0 ("any game", the value the phone treats as unscoped)
    s.game_no = 256
    assert s._game_byte() == 1


def test_a_station_armed_for_an_older_game_is_flagged_on_the_items_panel():
    s = _joined(_sess())
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 3})
    s.push_config(force=True); s.start(runway_s=3, force=True); s.control("end")
    s.net.push = lambda nid, kind, body: False           # out of range for the match-2 muster push
    s.push_config(force=True)
    v = s._station_view("util-1")
    assert v["armed"]["game"] == 1 and v["game"] == 2
    assert "ARMED FOR AN OLDER GAME" in v["attention"], v["attention"]


# --------------------------------------------------------------------------- the allow-list
def test_the_config_a_player_phone_receives_carries_the_stations_mc_armed():
    """contracts A13.1: `config.stations` = `[{id, kind}]`. `engine.js _stationAllowed()` reads it and
    was inert all week because nothing ever produced it."""
    s = _joined(_sess(respawn={"type": "scanner", "delay_s": 15}))
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 3})
    s.net.simulate_utility_hello("util-2")
    s.set_station("util-2", {"kind": "powerup", "team": "any", "id": 8})
    s.push_config(force=True)
    cfgs = _pushed(s, "config")
    assert cfgs and cfgs[-1]["config"]["stations"] == [{"id": 3, "kind": "respawn"}, {"id": 8, "kind": "powerup"}]
    assert "stations" not in s.config, "derived on the wire, never written into the operator's config"
    # a late joiner hydrated after the push gets the same list in its welcome
    p = next(p for p in s.players.values())
    node = s.net.simulate_hello("phone-late", p["gun_id"])
    assert node and node["config"]["stations"] == cfgs[-1]["config"]["stations"]
    # CONTROL: with nothing assigned the key is absent, so a game with no stations honours every id (the old behaviour)
    t = _joined(_sess()); t.push_config(force=True)
    assert "stations" not in _pushed(t, "config")[-1]["config"]


# --------------------------------------------------------------------------- heartbeat + warnings
def test_the_utility_heartbeat_is_kept_as_the_stations_report():
    s = _sess()
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "control", "team": "any", "id": 9})
    s.net.simulate_status("util-1", {"node_id": "util-1", "arm_state": "connected", "synced": False, "role": "utility",
                                     "kind": "control", "team": 255, "station_id": 9, "threshold": -74, "live": True,
                                     "revives": 0, "armed": True, "battery": 22,
                                     "control": {"owner": 1, "progress": 100, "hold_ms": {"1": 42000}}}, s.now_ms() + 1)
    v = s._station_view("util-1")
    assert v["report"]["control"]["hold_ms"] == {"1": 42000} and v["report"]["live"] is True
    assert "BATTERY LOW" in v["attention"]
    # the phone advertising a DIFFERENT id than assigned is the kind of drift the panel exists to show
    s.net.simulate_status("util-1", {"node_id": "util-1", "arm_state": "connected", "synced": False, "role": "utility",
                                     "kind": "control", "station_id": 2, "armed": False}, s.now_ms() + 2)
    att = s._station_view("util-1")["attention"]
    assert any("ADVERTISES ID 2" in a for a in att) and "PHONE SAYS NOT ARMED" in att, att


def test_a_station_gated_game_with_nothing_assigned_says_so_in_config_warnings():
    s = _sess("koth", station_source="phone")
    s._validate()
    assert any("NO CONTROL-POINT PHONE" in w for w in s.config_warnings), s.config_warnings
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "control", "team": "any", "id": 9})
    assert not any("NO CONTROL-POINT PHONE" in w for w in s.config_warnings), "assigning one clears it"
    # scanner respawn wants a respawn station the same way
    t = _sess(respawn={"type": "scanner", "delay_s": 15})
    assert any("NO RESPAWN STATION" in w for w in t.config_warnings), t.config_warnings
    # CONTROL: a grenade objective wants no phone, and auto respawn wants no station
    u = _sess("koth", station_source="grenade")
    assert not any("PHONE IS ASSIGNED" in w or "RESPAWN STATION" in w for w in u.config_warnings)


def test_clearing_an_assignment_shrinks_the_allow_list_the_others_echo():
    s = _sess()
    s.net.simulate_utility_hello("util-1"); s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 3})
    s.net.simulate_utility_hello("util-2"); s.set_station("util-2", {"kind": "respawn", "team": "yellow", "id": 4})
    assert s.clear_station("util-2")
    assert _pushed(s, "station_config", "util-1")[-1]["valid_ids"] == [3]
    assert s._station_ids() == [{"id": 3, "kind": "respawn"}]
    assert not s.clear_station("nobody")


# --------------------------------------------------------------------------- review 2026-09-11
def test_an_assignment_made_after_the_lobby_push_reaches_the_players_allow_list():
    """Players already holding `config.stations` must learn a re-id / a late station / a cleared one, or
    `engine.js _stationAllowed` keeps filtering on the old list and nobody can use the new id."""
    s = _joined(_sess(respawn={"type": "scanner", "delay_s": 15}))
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 1})
    s.push_config(force=True)
    acks_before = dict(s.acks)
    s.net.pushed.clear()
    s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 2})      # re-id after the push
    cfgs = _pushed(s, "config")
    assert cfgs and all(c["config"]["stations"] == [{"id": 2, "kind": "respawn"}] for c in cfgs), cfgs
    assert len(cfgs) == sum(1 for p in s.players.values() if p.get("node_id")), "one per bound player"
    assert s.acks == acks_before, "the frames did not change, so no re-ack is demanded"
    s.net.pushed.clear()
    s.clear_station("util-1")
    assert all("stations" not in c["config"] for c in _pushed(s, "config")), "the last one cleared = allow all again"
    # CONTROL: before the lobby push nothing is re-sent (the push itself carries the list)
    t = _joined(_sess()); t.net.simulate_utility_hello("u"); t.net.pushed.clear()
    t.set_station("u", {"kind": "respawn", "team": "blue", "id": 1})
    assert not _pushed(t, "config")


def test_a_player_hud_cannot_be_assigned_as_a_station():
    s = _joined(_sess())
    try:
        s.set_station("phone-0", {"kind": "respawn", "team": "blue", "id": 1})
        raise AssertionError("a HUD phone was turned into a station")
    except ValueError as e:
        assert "utility" in str(e).lower(), e
    assert "phone-0" not in s.stations
    try:
        s.set_station("never-heard", {"kind": "respawn", "team": "blue", "id": 1})
        raise AssertionError("an unknown node was turned into a station")
    except ValueError:
        pass


def test_the_phones_report_only_contradicts_an_arming_it_post_dates():
    s = _sess()
    base = s.now_ms()
    s.net.simulate_status("util-1", {"node_id": "util-1", "arm_state": "connected", "synced": False, "role": "utility",
                                     "kind": "respawn", "station_id": 1, "armed": False}, base)
    s.net.simulate_utility_hello("util-1")
    s.now_ms = lambda: base + 10
    v = s.set_station("util-1", {"kind": "control", "team": "any", "id": 9})
    assert v["attention"] == [], f"a report from BEFORE the arming is not a contradiction: {v['attention']}"
    # CONTROL: the same report arriving AFTER the push is
    s.net.simulate_status("util-1", {"node_id": "util-1", "arm_state": "connected", "synced": False, "role": "utility",
                                     "kind": "respawn", "station_id": 1, "armed": False}, base + 20)
    att = s._station_view("util-1")["attention"]
    assert "PHONE SAYS NOT ARMED" in att and any("ADVERTISES ID 1" in a for a in att), att


def test_end_reaches_every_hud_but_counts_only_bound_players():
    s = _joined(_sess())
    s.net.simulate_utility_hello("util-1")
    s.push_config(force=True); s.start(runway_s=3, force=True)
    # a HUD whose binding MC lost mid-match (A8 takeover, a gun-name mismatch) still runs the match on its gun
    s.nodes["ghost"] = {"node_id": "ghost", "node_type": "phone", "arm_state": "live", "synced": True, "last_seen_ms": s.now_ms()}
    s.net.pushed.clear()
    r = s.control("end")
    targets = [n for n, k, _ in s.net.pushed if k == "control"]
    assert "ghost" in targets, "the unbound HUD still gets END"
    assert "util-1" not in targets, "a station has no match to end"
    assert r["reached"] == r["nodes"] == 2, r
