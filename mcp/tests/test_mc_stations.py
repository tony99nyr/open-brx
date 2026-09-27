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
from brx_mcp.mc.net import NetServer, NodeRecord
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
    # MC_KINDS is generated (contract-DRY; mcp/tools/gen_contract.py): envelope.js re-exports it from
    # contract.gen.js rather than defining it literally, so the parity check reads the generated file.
    js = (REPO / "app/src/transport/contract.gen.js").read_text(encoding="utf-8")
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


def test_a_station_that_rehellos_as_a_hud_leaves_the_items_roster_and_allow_list():
    """F184: BACK TO HUD changes the next hello's node_type; that role transition owns station cleanup."""
    s = _joined(_sess())
    player = next(iter(s.players.values()))
    s.net.simulate_utility_hello("brxu-role-swap")
    s.set_station("brxu-role-swap", {"kind": "respawn", "team": "blue", "id": 3})
    s.push_config(force=True)
    assert s._station_ids() == [{"id": 3, "kind": "respawn"}]
    s.net.pushed.clear()

    s.net.simulate_hello("brx-player", player["gun_id"], prior_utility_node_id="brxu-role-swap")

    assert "brxu-role-swap" not in s.stations, "a plain HUD must not leave its old utility identity in ITEMS"
    assert s.node_player["brx-player"] == player["player_id"], "the new HUD identity still binds normally"
    cfgs = _pushed(s, "config")
    assert cfgs and all("stations" not in c["config"] for c in cfgs), "the removed id left every HUD allow-list"
    assert _pushed(s, "config", "brx-player"), "the corrected allow-list reached the newly bound HUD identity"


def test_a_released_station_leaves_the_items_roster_on_its_plain_hud_hello():
    """F184 field path: RELEASE retains the card only until the reloaded phone confirms its new role."""
    s = _sess()
    player = next(iter(s.players.values()))
    s.net.simulate_utility_hello("brxu-released")
    s.set_station("brxu-released", {"kind": "respawn", "team": "blue", "id": 3})

    assert s.release_station("brxu-released")
    assert "brxu-released" in s.stations, "RELEASE alone cannot claim that a phone changed roles"
    assert s.stations["brxu-released"]["assigned"] is None

    s.net.simulate_hello("brx-returned", player["gun_id"], prior_utility_node_id="brxu-released")

    assert "brxu-released" not in s.stations, "the confirmed HUD must disappear from ITEMS without CLEAR"
    assert all(v["node_id"] != "brxu-released" for v in s.snapshot()["stations"]), "the UI snapshot lost the card"
    assert "brxu-released" not in s.nodes, "the consumed utility identity must not survive as an ARMORY ghost"
    assert s.node_player["brx-returned"] == player["player_id"]


def test_a_live_station_that_returns_to_hud_keeps_its_self_authoritative_recap_count():
    """F184 polish: leaving ITEMS must not erase the station's already-reported match contribution."""
    s = _joined(_sess(respawn={"type": "scanner", "delay_s": 15}))
    player = next(iter(s.players.values()))
    s.net.simulate_utility_hello("brxu-live")
    s.set_station("brxu-live", {"kind": "respawn", "team": "blue", "id": 3})
    s.push_config(force=True)
    s.start(runway_s=3, force=True)
    s.phase = "live"
    s.net.simulate_status("brxu-live", {"node_id": "brxu-live", "arm_state": "connected", "synced": False,
                                         "role": "utility", "kind": "respawn", "station_id": 3, "armed": True,
                                         "revives": 4}, s.now_ms())

    assert s.release_station("brxu-live"), "the operator's accepted RELEASE is the primary field path"
    s.net.simulate_hello("brx-live", player["gun_id"], prior_utility_node_id="brxu-live")
    s.control("end")

    rows = [{k: v for k, v in r.items() if k != "synced"} for r in s.last_recap["stations"]]
    assert rows == [{"node_id": "brxu-live", "kind": "respawn", "id": 3, "team": 1, "heard": True, "revives": 4}]


def test_an_accepted_live_release_keeps_recap_counts_even_if_the_hud_has_not_returned_yet():
    s = _joined(_sess(respawn={"type": "scanner", "delay_s": 15}))
    s.net.simulate_utility_hello("brxu-live")
    s.set_station("brxu-live", {"kind": "respawn", "team": "blue", "id": 3})
    s.push_config(force=True); s.start(runway_s=3, force=True); s.phase = "live"
    s.net.simulate_status("brxu-live", {"node_id": "brxu-live", "arm_state": "connected", "synced": False,
                                         "role": "utility", "kind": "respawn", "station_id": 3, "armed": True,
                                         "revives": 4}, s.now_ms())
    assert s.release_station("brxu-live")
    s.control("end")
    assert s.last_recap["stations"][0]["revives"] == 4
    s.net.simulate_status("brxu-live", {"node_id": "brxu-live", "arm_state": "connected", "synced": False,
                                         "role": "utility", "kind": "respawn", "station_id": 3, "armed": True,
                                         "revives": 5}, s.now_ms())
    assert s.last_recap["stations"][0]["revives"] == 5, "a final heartbeat after END still corrects recap"


def test_a_failed_live_release_keeps_the_active_assignment_and_recap_count():
    s = _joined(_sess(respawn={"type": "scanner", "delay_s": 15}))
    s.net.simulate_utility_hello("brxu-live")
    s.set_station("brxu-live", {"kind": "respawn", "team": "blue", "id": 3})
    s.push_config(force=True); s.start(runway_s=3, force=True); s.phase = "live"
    s.net.simulate_status("brxu-live", {"node_id": "brxu-live", "arm_state": "connected", "synced": False,
                                         "role": "utility", "kind": "respawn", "station_id": 3, "armed": True,
                                         "revives": 4}, s.now_ms())
    real_push = s.net.push
    s.net.push = lambda nid, kind, body: False
    assert not s.release_station("brxu-live")
    s.net.push = real_push
    assert s.stations["brxu-live"]["assigned"]["id"] == 3
    s.control("end")
    assert s.last_recap["stations"][0]["revives"] == 4


def test_a_partial_final_control_heartbeat_preserves_the_last_complete_recap_tally():
    s = _joined(_sess(mode="koth", station_source="phone"))
    s.net.simulate_utility_hello("brxu-live")
    s.set_station("brxu-live", {"kind": "control", "team": "any", "id": 3})
    s.push_config(force=True); s.start(runway_s=3, force=True); s.phase = "live"
    common = {"node_id": "brxu-live", "arm_state": "connected", "synced": False,
              "role": "utility", "kind": "control", "station_id": 3, "armed": True}
    s.net.simulate_status("brxu-live", {**common, "control": {"hold_ms": {"1": 12_000}, "owner": 1}}, s.now_ms())
    assert s.release_station("brxu-live")
    s.net.simulate_status("brxu-live", {**common, "control": {"progress": 50}}, s.now_ms())
    s.control("end")
    # `synced` compares a heartbeat's ms with the whistle's on the real clock, so it is not pinned here
    # (the F401 tests pin it on controlled times).
    rows = [{k: v for k, v in r.items() if k != "synced"} for r in s.last_recap["stations"]]
    assert rows == [{"node_id": "brxu-live", "kind": "control", "id": 3,
                     "team": 255, "heard": True, "hold_ms": {"1": 12_000}, "owner": 1}]


def test_f426_a_hills_neutral_tid_is_dropped_from_the_stations_recap_not_shown_as_a_phantom_team():
    """F426 (bench part 1, 2026-09-26): a KOTH match rosters only blue (tid 1) and green (tid 3), but the
    control station's own `hold_ms` still carries tid 2 -- the sentinel a hill passes through on its way
    to a real owner (F82) -- because the station counts every tid it ever saw, not just the roster.
    `Scorer.possession()` already excludes that tid from every team's total
    (`test_a_hills_neutral_time_is_nobodys`); this is the same rule for the station's own
    self-authoritative recap row, which used to pass tid 2 straight through as if it were a rostered
    team (122_744 ms, this row's own bench number)."""
    s = _joined(_sess(mode="koth", station_source="phone"))
    s.net.simulate_utility_hello("brxu-live")
    s.set_station("brxu-live", {"kind": "control", "team": "any", "id": 3})
    s.push_config(force=True); s.start(runway_s=3, force=True); s.phase = "live"
    common = {"node_id": "brxu-live", "arm_state": "connected", "synced": False,
              "role": "utility", "kind": "control", "station_id": 3, "armed": True}
    s.net.simulate_status("brxu-live", {**common, "control": {
        "hold_ms": {"1": 12_000, "2": 122_744, "3": 4_000}, "owner": 1}}, s.now_ms())
    s.control("end")
    rows = [{k: v for k, v in r.items() if k != "synced"} for r in s.last_recap["stations"]]
    assert rows == [{"node_id": "brxu-live", "kind": "control", "id": 3, "team": 255, "heard": True,
                     "hold_ms": {"1": 12_000, "3": 4_000}, "owner": 1}], rows


def test_f431_a_stale_unrostered_tid_already_in_the_restored_tally_is_still_dropped():
    """F431 (2026-09-26): F426 filters `control.hold_ms` (the LIVE beat) to rostered tids, but the
    station's own persisted `tally["hold_ms"]` (`_keep_station_tally`, resumed from `session.json` across
    a Stick restart -- `_tally_ok` checks only its SHAPE, not roster membership) only ever grows and used
    to be merged back in LAST, unfiltered. A tid 2 already sitting in the tally from before this session's
    roster was set (or from an old snapshot saved before F426 existed) rode straight back into every later
    beat's report and the recap, exactly the F426 bug, just entering through the tally instead of the wire."""
    s = _joined(_sess(mode="koth", station_source="phone"))
    s.net.simulate_utility_hello("brxu-live")
    s.set_station("brxu-live", {"kind": "control", "team": "any", "id": 3})
    s.push_config(force=True); s.start(runway_s=3, force=True); s.phase = "live"
    common = {"node_id": "brxu-live", "arm_state": "connected", "synced": False,
              "role": "utility", "kind": "control", "station_id": 3, "armed": True}
    t0 = s.now_ms()
    # a first beat, well past the arming heartbeat gate, seeds the tally (rostered tids only -- F426
    # already filtered this one)
    s.net.simulate_status("brxu-live", {**common, "control": {
        "hold_ms": {"1": 12_000, "3": 4_000}, "owner": 1}}, t0 + 60_000)
    assert s.stations["brxu-live"]["tally"]["hold_ms"] == {"1": 12_000, "3": 4_000}, "the tally must be seeded by now"
    # simulate a resumed snapshot: an unrostered tid 2 already sitting in the persisted tally, as it
    # could from before F426 existed, or a roster that has since changed
    s.stations["brxu-live"]["tally"]["hold_ms"]["2"] = 122_744
    # a later beat must not let that stale entry back into the report or the recap
    s.net.simulate_status("brxu-live", {**common, "control": {
        "hold_ms": {"1": 13_000, "3": 4_500}, "owner": 1}}, t0 + 65_000)
    s.control("end")
    rows = [{k: v for k, v in r.items() if k != "synced"} for r in s.last_recap["stations"]]
    assert rows == [{"node_id": "brxu-live", "kind": "control", "id": 3, "team": 255, "heard": True,
                     "hold_ms": {"1": 13_000, "3": 4_500}, "owner": 1}], rows


# --------------------------------------------------------------------------- arming
def test_assigning_a_station_pushes_station_config_with_game_and_the_allow_list():
    s = _sess()
    s.net.simulate_utility_hello("util-1")
    v = s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 3, "threshold": -70})
    cfg = _pushed(s, "station_config", "util-1")
    body = dict(cfg[-1]) if cfg else {}
    age = body.pop("threshold_age_ms", None)   # A67: wall-clock ms since MC set the value; tiny, not exactly 0 under load
    assert isinstance(age, int) and 0 <= age < 1000, cfg
    assert body == {"kind": "respawn", "team": 1, "id": 3, "threshold": -70, "game": 1, "valid_ids": [3], "lock_s": 0}, cfg
    assert v["armed"]["game"] == 1 and v["attention"] == [], v
    # a second station changes the allow-list EVERY station echoes, so both are re-armed
    s.net.simulate_utility_hello("util-2")
    s.set_station("util-2", {"kind": "control", "team": "any", "id": 9})
    assert _pushed(s, "station_config", "util-1")[-1]["valid_ids"] == [3, 9]
    assert _pushed(s, "station_config", "util-2")[-1]["valid_ids"] == [3, 9]
    for b in _pushed(s, "station_config"):
        E.validate(E.make_envelope("station_config", b), direction="mc")


def test_station_config_carries_match_end_deadline_when_known_and_zero_after_end():
    s = _sess()
    s.net.simulate_utility_hello("stick-1")
    s.set_station("stick-1", {"kind": "control", "team": "any", "id": 3})
    s.phase = "live"
    t0 = s.now_ms()
    s.now_ms = lambda: t0  # a fixed clock: the asserts below are exact milliseconds
    s.start_info = {"go_live_t": t0 - 1000}
    s.config["time_limit_s"] = 600
    s._arm_station("stick-1")
    assert _pushed(s, "station_config", "stick-1")[-1].get("duration_ms") == 600000
    assert _pushed(s, "station_config", "stick-1")[-1].get("ends_in_ms") == 599000
    assert _pushed(s, "station_config", "stick-1")[-1].get("starts_in_ms") == -1000
    s.phase = "recap"
    s._arm_station("stick-1")
    assert _pushed(s, "station_config", "stick-1")[-1]["ends_in_ms"] == 0
    s.phase = "live"
    s.start_info["adopted"] = True
    s._arm_station("stick-1")
    assert "duration_ms" not in _pushed(s, "station_config", "stick-1")[-1]
    assert "ends_in_ms" not in _pushed(s, "station_config", "stick-1")[-1]
    assert "starts_in_ms" not in _pushed(s, "station_config", "stick-1")[-1]
    s.start_info["adopted"] = False
    s.config["time_limit_s"] = None
    s._arm_station("stick-1")
    assert "ends_in_ms" not in _pushed(s, "station_config", "stick-1")[-1]
    assert "duration_ms" not in _pushed(s, "station_config", "stick-1")[-1]


def test_station_config_carries_match_end_deadline_when_known():
    s = _sess()
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "control", "team": "any", "id": 3})
    s.phase = "live"
    t0 = s.now_ms()
    s.now_ms = lambda: t0  # a fixed clock: the asserts below are exact milliseconds
    s.start_info = {"go_live_t": t0 - 1000}
    s.config["time_limit_s"] = 600
    s._arm_station("util-1")
    body = _pushed(s, "station_config", "util-1")[-1]
    assert body.get("ends_in_ms") == 599000, body
    # and the envelope validator accepts what we send (the 2026-09-07 `alert` lesson, pinned)
    for b in _pushed(s, "station_config"):
        E.validate(E.make_envelope("station_config", b), direction="mc")


def test_recall_and_panic_freeze_a_connected_hill():
    """A held hill needs an explicit stop when MC cancels a live match."""
    for cmd in ("recall", "panic"):
        s = _sess()
        s.net.simulate_utility_hello("stick-1")
        s.set_station("stick-1", {"kind": "control", "team": "any", "id": 3})
        s.push_config(force=True)
        s.start(runway_s=3, force=True)
        s.phase = "live"
        s.net.pushed.clear()
        s.control(cmd, confirm=cmd == "panic")
        body = _pushed(s, "station_config", "stick-1")[-1]
        assert body.get("ends_in_ms") == 0, (cmd, body)
        s.net.simulate_utility_hello("stick-1")
        assert _pushed(s, "station_config", "stick-1")[-1].get("ends_in_ms") == 0, cmd


def test_aborted_start_clears_its_deadline_for_the_same_game():
    s = _sess()
    s.net.simulate_utility_hello("stick-1")
    s.set_station("stick-1", {"kind": "control", "team": "any", "id": 3})
    s.push_config(force=True)
    s.start(runway_s=3, force=True)
    assert _pushed(s, "station_config", "stick-1")[-1].get("ends_in_ms", -1) > 0
    s.abort_start()
    assert "ends_in_ms" not in _pushed(s, "station_config", "stick-1")[-1]
    s.start(runway_s=3, force=True)
    assert _pushed(s, "station_config", "stick-1")[-1].get("ends_in_ms", -1) > 0


def test_abort_start_resends_a_clockless_config_without_utility_control():
    s = _sess()
    s.net.simulate_hello("stick-1", "", node_type="utility", platform="esp32")
    s.net.simulate_utility_hello("utility-phone")
    for nid, sid in (("stick-1", 3), ("utility-phone", 4)):
        s.set_station(nid, {"kind": "control", "team": "any", "id": sid})
    s.push_config(force=True)
    s.start(runway_s=3, force=True)
    s.net.pushed.clear()

    s.abort_start()

    stick = [(kind, body) for nid, kind, body in s.net.pushed if nid == "stick-1"]
    assert [kind for kind, _ in stick] == ["station_config"], stick
    assert "starts_in_ms" not in stick[0][1]
    assert "ends_in_ms" not in stick[0][1]
    assert not _pushed(s, "control", "utility-phone"), "a phone utility never held the start"


def test_untimed_hill_gets_a_go_live_time_at_start_and_on_reconnect():
    s = _sess()
    s.net.simulate_hello("stick-1", "", node_type="utility", platform="esp32")
    s.net.simulate_utility_hello("utility-phone")
    for nid, sid in (("stick-1", 3), ("utility-phone", 4)):
        s.set_station(nid, {"kind": "control", "team": "any", "id": sid})
    s.push_config(force=True)
    s.config["time_limit_s"] = None
    s.net.pushed.clear()

    start = s.start(runway_s=30, force=True)

    assert start["go_live_t"] > s.now_ms(), "the config must describe the scheduled go-live"
    stick = [(kind, body) for nid, kind, body in s.net.pushed if nid == "stick-1"]
    assert [kind for kind, _ in stick] == ["station_config"], stick
    assert "ends_in_ms" not in stick[0][1]
    assert stick[0][1]["starts_in_ms"] > 0
    s.now_ms = lambda: start["go_live_t"] - 1
    s.tick()
    assert not _pushed(s, "station_update", "stick-1")
    s.now_ms = lambda: start["go_live_t"]
    s.tick()
    assert not _pushed(s, "station_update", "stick-1")
    assert not _pushed(s, "station_update", "utility-phone")
    s.net.pushed.clear()
    s.net.simulate_hello("stick-1", "", node_type="utility", platform="esp32")
    assert _pushed(s, "station_config", "stick-1")[-1]["starts_in_ms"] == 0
    assert not _pushed(s, "station_update", "stick-1")


def test_timed_hill_gets_a_go_live_time_in_its_deadline_config():
    s = _sess()
    s.net.simulate_hello("stick-1", "", node_type="utility", platform="esp32")
    s.set_station("stick-1", {"kind": "control", "team": "any", "id": 3})
    s.push_config(force=True)
    s.net.pushed.clear()

    start = s.start(runway_s=30, force=True)

    assert _pushed(s, "station_config", "stick-1")[-1]["ends_in_ms"] > 30_000
    assert _pushed(s, "station_config", "stick-1")[-1]["starts_in_ms"] > 0
    assert not _pushed(s, "station_update", "stick-1"), "a hill must wait through the runway"
    s.now_ms = lambda: start["go_live_t"]
    s.tick()
    assert not _pushed(s, "station_update", "stick-1")
    s.net.pushed.clear()
    s.net.simulate_hello("stick-1", "", node_type="utility", platform="esp32")
    stick = [(kind, body) for nid, kind, body in s.net.pushed if nid == "stick-1"]
    assert [kind for kind, _ in stick] == ["station_config"], stick
    assert stick[0][1]["starts_in_ms"] == 0


def test_adopted_live_match_pushes_nothing_to_stations_or_player_phones():
    s = _joined(_sess())
    s.net.simulate_hello("stick-1", "", node_type="utility", platform="esp32")
    s.set_station("stick-1", {"kind": "control", "team": "any", "id": 3})
    s.net.simulate_status("phone-0", {"arm_state": "live", "match_id": "other-match",
                                       "game_byte": s._game_byte(), "synced": True}, s.now_ms())
    s.net.pushed.clear()

    s.adopt_orphan("other-match")

    assert s.phase == "live"
    stick = [(kind, body) for nid, kind, body in s.net.pushed if nid == "stick-1"]
    assert not stick
    assert not [kind for nid, kind, _ in s.net.pushed if nid.startswith("phone-")], \
        "adoption must not reconfigure a player phone"


def test_threshold_0_or_absent_means_the_stations_own_platform_default():
    """F345: a respawn station's default range is per platform (a phone -66, a StickS3 -60, about 3 m). MC must
    not stamp one number over both: absent or 0 goes out as 0, and the station advertises its own default."""
    s = _sess()
    s.net.simulate_utility_hello("util-1", app_ver="0.4.12+abc")
    s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 3})
    assert _pushed(s, "station_config", "util-1")[-1]["threshold"] == 0
    s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 3, "threshold": 0})
    assert _pushed(s, "station_config", "util-1")[-1]["threshold"] == 0
    s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 3, "threshold": -58})   # the override stays
    assert _pushed(s, "station_config", "util-1")[-1]["threshold"] == -58
    for bad in (-1, -29, -101):
        try:
            s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 3, "threshold": bad})
            raise AssertionError(f"accepted threshold {bad}")
        except ValueError as e:
            assert "threshold" in str(e)


def test_threshold_0_goes_out_explicit_to_a_phone_app_that_clamps_it():
    """F345 review H1: app 0.4.11 and older clamps a `station_config` threshold of 0 to -30 dBm (a few cm), so no
    revive is possible. Such a phone (or one whose version MC cannot parse) gets the explicit old value: -66 for a
    respawn station (the new phone default), -74 for any other kind. 0.4.12 and later, and a StickS3, get 0."""
    s = _sess()
    for nid, ver, kind, team, sid, want in (("util-old", "0.4.11+f366156e", "respawn", "blue", 3, -70),
                                            ("util-unk", "utility", "control", "any", 4, -74),
                                            ("util-new", "0.4.12+abc", "respawn", "blue", 5, 0)):
        s.net.simulate_utility_hello(nid, app_ver=ver)
        s.set_station(nid, {"kind": kind, "team": team, "id": sid})
        assert _pushed(s, "station_config", nid)[-1]["threshold"] == want, (nid, _pushed(s, "station_config", nid)[-1])
    s.net.simulate_utility_hello("util-old2", app_ver="0.4.10+85c98553")
    s.set_station("util-old2", {"kind": "respawn", "team": "blue", "id": 6, "threshold": -58})   # an override is sent as is
    assert _pushed(s, "station_config", "util-old2")[-1]["threshold"] == -58


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
    assert v["arm_pending"] and "NOT RE-ARMED, OUT OF WI-FI RANGE: BRING IT BACK TO RE-ARM" in v["attention"]
    sent = []
    s.net.push = lambda nid, kind, body: sent.append((nid, kind, body))
    s.net.simulate_utility_hello("util-1")               # it walks back into range
    assert sent and sent[-1][1] == "station_config" and sent[-1][2]["id"] == 3
    assert not s._station_view("util-1")["arm_pending"]


def test_a_stale_station_reads_offline_and_refuses_a_new_assignment():
    """Field, twice in one day (2026-09-19): a respawn station reopened elsewhere as a PLAYER phone
    under a NEW node_id, and this old node_id's record just sat there -- `online: True` (it used the
    10-minute `OFFLINE_AFTER_MS` line, not the net layer's own STALE_AFTER_MS = 8 s freshness flag),
    still listed in ITEMS, still assignable, still "armable". The operator assigned it, arming failed
    (there was no socket left to push to), and CLEARING it did not make the confusion go away.

    Break it once: before the fix, `online` stayed True and `set_station` accepted the assignment no
    matter how stale `self.nodes["util-1"]["stale"]` was -- the assert below is exactly the line that
    used to read True, and the `set_station` call is exactly the one that used to succeed."""
    s = _sess()
    s.net.simulate_utility_hello("util-1")
    assert s._station_view("util-1")["online"] is True, "a fresh hello is online"
    s.net.simulate_stale("util-1", 9_000)                 # the net layer's own STALE_AFTER_MS sweep
    assert s.nodes["util-1"]["stale"] is True
    v = s._station_view("util-1")
    assert v["online"] is False, "a stale node_id must not read as online any more"
    # the record survives (it may come back) -- only NEW claims against it are refused
    assert "util-1" in s.stations
    try:
        s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 3})
        raise AssertionError("a stale station accepted an assignment")
    except ValueError as e:
        assert "stale" in str(e).lower(), e
    assert s.stations["util-1"]["assigned"] is None, "the refused assignment left nothing behind"
    # ...and a reconnect (the SAME node_id coming back, not a new one) clears it and re-admits assignment
    s.net.simulate_return("util-1")
    assert s.nodes["util-1"]["stale"] is False
    assert s._station_view("util-1")["online"] is True
    s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 3})   # no longer refused
    assert s.stations["util-1"]["assigned"] is not None


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
    assert "ARMED FOR AN OLDER GAME: RE-ARM IT FROM ITEMS ON ARMORY" in v["attention"], v["attention"]


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
    assert "BATTERY LOW: CHARGE OR SWAP IT BEFORE THE WHISTLE" in v["attention"]
    # the phone advertising a DIFFERENT id than assigned is the kind of drift the panel exists to show
    s.net.simulate_status("util-1", {"node_id": "util-1", "arm_state": "connected", "synced": False, "role": "utility",
                                     "kind": "control", "station_id": 2, "armed": False}, s.now_ms() + 2)
    att = s._station_view("util-1")["attention"]
    assert any("ADVERTISES ID 2" in a for a in att) and "PHONE SAYS NOT ARMED: RE-ARM IT FROM ITEMS ON ARMORY" in att, att


def test_a_station_gated_game_with_nothing_assigned_says_so_in_config_warnings():
    """F402 (2026-09-25): for KOTH this is no longer an advisory in `config_warnings` -- it is a hard
    LOAD/push refusal (`Session._koth_hill_fault`), so the amber SETUP line is gone for this mode and
    the fault lives on `_koth_hill_fault()` / the refusal itself instead."""
    s = _sess("koth", station_source="phone")
    s._validate()
    assert not any("NO CONTROL STATION IS ASSIGNED" in w for w in s.config_warnings), \
        "F402: the amber advisory is retired for koth, replaced by the hard refusal"
    assert s._koth_hill_fault() == Session._KOTH_HILL_FAULT_NONE, s._koth_hill_fault()
    try:
        s.push_config(force=True)
        raise AssertionError("F402: MC pushed a koth game with no hill on the field")
    except ValueError as e:
        assert str(e) == Session._KOTH_HILL_FAULT_NONE, e
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "control", "team": "any", "id": 9})
    assert s._koth_hill_fault() is None, "assigning a hill clears the fault"
    s.push_config(force=True)
    # scanner respawn wants a respawn station the same way
    t = _sess(respawn={"type": "scanner", "delay_s": 15})
    assert any("NO RESPAWN STATION" in w for w in t.config_warnings), t.config_warnings
    # CONTROL: a grenade objective wants no phone, and auto respawn wants no station
    u = _sess("koth", station_source="grenade")
    assert not any("PHONE IS ASSIGNED" in w or "RESPAWN STATION" in w for w in u.config_warnings)
    assert u._koth_hill_fault() == Session._KOTH_HILL_FAULT_SOURCE, u._koth_hill_fault()


def test_scanner_respawn_warns_when_one_team_has_no_station():
    s = _sess(respawn={"type": "scanner", "delay_s": 15})
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 3})
    partial = [w for w in s.config_warnings if "SCANNER RESPAWN HAS NO STATION FOR" in w]
    assert partial and "YELLOW" in partial[0], s.config_warnings
    s.net.simulate_utility_hello("util-2")
    s.set_station("util-2", {"kind": "respawn", "team": "yellow", "id": 4})
    assert not [w for w in s.config_warnings if "SCANNER RESPAWN HAS NO STATION FOR" in w]


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
    assert "PHONE SAYS NOT ARMED: RE-ARM IT FROM ITEMS ON ARMORY" in att and any("ADVERTISES ID 1" in a for a in att), att


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


# --------------------------------------------------------------------------- polish review 2026-09-11
def test_a_station_cannot_be_assigned_or_cleared_once_the_match_is_armed_or_live():
    """`_repush_stations_to_players` gated only on `lobby_pushed`, which stays True through armed and
    live; a re-id mid-match re-sent `config` to every HUD, whose `_applyConfig` rewrites the gun head and
    sets `spawned = false` -- every hit and death handler is gated on it, so a live player stopped
    booking hits in silence. The ITEMS panel is a muster/lobby control and says so."""
    s = _joined(_sess(respawn={"type": "scanner", "delay_s": 15}))
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 1})
    s.push_config(force=True)
    s.start(runway_s=30, force=True)
    assert s.phase == "armed"
    for phase in ("armed", "live"):
        s.phase = phase
        s.net.pushed.clear()
        for call in (lambda: s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 2}),
                     lambda: s.clear_station("util-1")):
            try:
                call()
                raise AssertionError(f"a station change was accepted while {phase}")
            except ValueError as e:
                assert phase.upper() in str(e) and "RECALL" in str(e), str(e)
        assert not _pushed(s, "config"), f"no HUD was re-armed while {phase}"
        assert s.stations["util-1"]["assigned"]["id"] == 1, "the refused change left nothing behind"
    # CONTROL: the same calls in LOBBY (the phase the panel is for) do re-push, as the test above proves
    s.phase = "lobby"
    s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 2})
    assert _pushed(s, "config"), "in lobby the players learn the new id"


def test_evicting_an_assigned_station_shrinks_the_allow_list_like_clearing_it():
    """`evict_node` popped the station but left its id in every survivor's `valid_ids` and in every HUD's
    `config.stations` until the next full push."""
    s = _joined(_sess(respawn={"type": "scanner", "delay_s": 15}))
    s.net.simulate_utility_hello("util-1"); s.net.simulate_utility_hello("util-2")
    t1, t2 = (t["team_id"] for t in s.config["teams"][:2])
    s.set_station("util-1", {"kind": "respawn", "team": t1, "id": 1})
    s.set_station("util-2", {"kind": "respawn", "team": t2, "id": 2})
    s.push_config(force=True)
    s.net.pushed.clear()
    assert s.evict_node("util-1")
    assert "util-1" not in s.stations
    survivors = _pushed(s, "station_config", "util-2")
    assert survivors and survivors[-1]["valid_ids"] == [2], survivors
    cfgs = _pushed(s, "config")
    assert cfgs and all(c["config"]["stations"] == [{"id": 2, "kind": "respawn"}] for c in cfgs), cfgs
    # CONTROL: evicting an UNASSIGNED utility node re-arms nobody (nothing on the field changed)
    s.net.simulate_utility_hello("util-3"); s.net.pushed.clear()
    assert s.evict_node("util-3")
    assert not _pushed(s, "station_config") and not _pushed(s, "config")


def test_a_team_scoped_station_must_be_on_a_team_that_is_in_the_game():
    """`engine.js _stationAllowed` admits a player only when the station's team is ANY or the player's
    own tid, so a station on a tid nobody is on (or on the F82 neutral broadcast in a hill mode) is a
    station that serves nobody, silently."""
    s = _sess("koth", station_source="phone")           # teams are on tids other than 2
    s.net.simulate_utility_hello("util-1")
    tids = {int(t["tid"]) for t in s.config["teams"]}
    assert 2 not in tids, "the F82 rule holds: a hill game has no team on tid 2"
    for team in sorted({0, 1, 2, 3} - tids):
        try:
            s.set_station("util-1", {"kind": "respawn", "team": team, "id": 1})
            raise AssertionError(f"tid {team} accepted though no team in the game is on it")
        except ValueError as e:
            assert "serve nobody" in str(e), str(e)
    assert s.stations["util-1"]["assigned"] is None
    # CONTROL: a tid that IS in the game, and 'any', are accepted as before
    s.set_station("util-1", {"kind": "respawn", "team": min(tids), "id": 1})
    assert s.stations["util-1"]["assigned"]["team"] == min(tids)
    s.set_station("util-1", {"kind": "respawn", "team": "any", "id": 1})
    assert s.stations["util-1"]["assigned"]["team"] == 255


# --------------------------------------------------------------------------- F106 lows (2026-09-11)
def test_fire_node_forwards_app_ver():
    """F106(b): `net.py _fire_node` never carried `rec.app_ver` into the info dict it fires to `on_node`
    callbacks, so `state.py _on_node`'s utility branch (`st["app_ver"] = n.get("app_ver") or ...`) read a
    key that never arrived off a REAL socket -- `station.app_ver` stayed None forever except on `FakeNet`,
    whose hand-rolled `simulate_*_hello` info dicts always included it and so never caught this."""
    net = NetServer()
    seen: list[dict] = []
    net.on_node(lambda info: seen.append(info))
    net._fire_node(NodeRecord(node_id="util-1", node_type="utility", app_ver="utility-0.2"))
    assert seen[-1]["app_ver"] == "utility-0.2", seen[-1]
    # CONTROL: this is an ADDITION, not a replacement -- the existing fields still ride along
    net._fire_node(NodeRecord(node_id="n2", node_type="phone", app_ver="hud-0.2", gun_name="GUN-A"))
    assert seen[-1]["gun_name"] == "GUN-A" and seen[-1]["app_ver"] == "hud-0.2", seen[-1]


def test_status_heartbeat_keeps_app_ver_fresh():
    """Roadmap A3: `app_ver` rides the STATUS heartbeat too, not only the hello, so a phone that updated
    mid-session is never stuck showing its old version until its next reconnect."""
    s = _sess()
    s.net.simulate_utility_hello("util-1", app_ver="utility-0.1")
    assert s.stations["util-1"]["app_ver"] == "utility-0.1"
    s.net.simulate_status("util-1", {"node_id": "util-1", "arm_state": "connected", "synced": False,
                                     "role": "utility", "app_ver": "utility-0.2"}, s.now_ms())
    assert s.stations["util-1"]["app_ver"] == "utility-0.2"
    # CONTROL: a heartbeat with no app_ver field at all does not blank out what the hello already gave
    s.net.simulate_status("util-1", {"node_id": "util-1", "arm_state": "connected", "synced": False, "role": "utility"}, s.now_ms())
    assert s.stations["util-1"]["app_ver"] == "utility-0.2"


def test_a_node_that_switches_from_player_to_utility_drops_its_player_binding():
    """F106(c): the SAME node_id said hello as a player once (a phone taken OUT of the HUD role on the
    field, or a reused node_id on a fresh install); `node_player`/the player's own `node_id` must not
    keep pointing at a socket that is now a station, or a later push (config/start/control) silently
    lands on a utility phone that drops everything but `station_config`."""
    s = _joined(_sess(n=1))
    p = next(iter(s.players.values()))
    nid = p["node_id"]
    assert s.node_player.get(nid) == p["player_id"]
    s.net.simulate_utility_hello(nid)
    assert nid not in s.node_player, "the station kept speaking for the player"
    assert s.players[p["player_id"]]["node_id"] is None
    assert nid in s.stations, "CONTROL: the utility side of the switch still worked"


def test_abort_start_clears_the_started_flag_so_the_next_push_does_not_bump_the_game():
    """F106(a): `abort_start` left `_game_no_started` set, so the NEXT muster push (an edit, a re-try)
    silently skipped a game number and re-armed every station though no match actually ran."""
    s = _joined(_sess())
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 1})
    s.push_config(force=True)
    s.start(runway_s=3, force=True)
    assert s._game_no_started is True          # CONTROL: start() really does set it
    s.abort_start()
    assert s._game_no_started is False, "an aborted start must not count as a played match"
    s.push_config(force=True)
    assert s.game_no == 1, f"the game byte moved though nothing was ever played: {s.game_no}"


def test_finish_and_abort_start_skip_utility_nodes():
    """F106(d): a utility phone never held the pending start (it is not a player, §5c) and its log holds
    nothing about a match it never binds -- `abort_start`'s broadcast and `_finish`'s log-pull loop used
    to reach it anyway, on a wire that is supposed to need it no LAN mid-match."""
    s = _joined(_sess())
    s.net.simulate_utility_hello("util-1")
    s.push_config(force=True)
    s.start(runway_s=3, force=True)
    s.net.pushed.clear()
    s.abort_start()
    controlled = [n for n, k, _ in s.net.pushed if k == "control"]
    assert "util-1" not in controlled and controlled, controlled     # CONTROL: the real players still got it
    s.push_config(force=True)
    s.start(runway_s=3, force=True)
    s.net.pushed.clear()
    s.control("end")
    logged = [n for n, k, _ in s.net.pushed if k == "pull_log"]
    assert "util-1" not in logged and logged, logged                 # CONTROL: the real players still got their log pulled


def test_recap_carries_a_stations_row():
    """Roadmap A6: the recap sheet gets a row per ASSIGNED station, straight from its own
    self-authoritative heartbeat -- MC never watches a revive happen, so this is the only place a station's
    own count is ever shown."""
    s = _joined(_sess(respawn={"type": "scanner", "delay_s": 15}))
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 1})
    s.net.simulate_status("util-1", {"node_id": "util-1", "arm_state": "connected", "synced": False,
                                     "role": "utility", "kind": "respawn", "station_id": 1, "armed": True,
                                     "revives": 4}, s.now_ms())
    s.push_config(force=True)
    s.start(runway_s=3, force=True)
    s.control("end")
    rows = s.recap()["stations"]
    assert rows == [{"node_id": "util-1", "kind": "respawn", "id": 1, "team": 1, "heard": True,
                      "revives": 4, "synced": False}], rows
    # CONTROL: a station that said hello but was never assigned contributes no row
    s.net.simulate_utility_hello("util-2")
    assert all(r["node_id"] != "util-2" for r in s.recap()["stations"])


def test_recap_stations_heard_is_set_for_every_kind_and_flips_true_on_first_heartbeat():
    """Finding 1 (review 2026-09-11, F105): `heard` is set on EVERY row regardless of kind -- extraction,
    powerup and bomb have no count of their own (unlike revives/hold_ms), so before this `heard` existed
    those three kinds had nothing at all to tell "reported" from "never heard from" with, and Recap.tsx
    rendered them identically either way."""
    s = _joined(_sess())
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "extraction", "team": "any", "id": 8})
    s.push_config(force=True)
    s.start(runway_s=3, force=True)
    # CONTROL: assigned, but no status body has arrived yet -- heard is False, not a missing/absent row
    rows = s.recap()["stations"]
    assert rows == [{"node_id": "util-1", "kind": "extraction", "id": 8, "team": 255, "heard": False}], rows
    s.net.simulate_status("util-1", {"node_id": "util-1", "arm_state": "connected", "synced": False,
                                     "role": "utility", "kind": "extraction", "station_id": 8, "armed": True}, s.now_ms())
    rows = s.recap()["stations"]
    assert rows == [{"node_id": "util-1", "kind": "extraction", "id": 8, "team": 255, "heard": True}], rows


def test_a_late_fact_after_end_keeps_the_stations_rows_in_the_recap():
    """Polish review 2026-09-11: `_restore_recap` (the re-store on a fact that lands after END -- the outbox
    flush, i.e. every real match) called `scorer.recap()` bare, so the first late fact dropped `stations`
    from `last_recap` and from the archived row."""
    s = _joined(_sess(respawn={"type": "scanner", "delay_s": 15}))
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 1})
    s.net.simulate_status("util-1", {"node_id": "util-1", "arm_state": "connected", "synced": False,
                                     "role": "utility", "kind": "respawn", "station_id": 1, "armed": True,
                                     "revives": 2}, s.now_ms())
    s.push_config(force=True)
    s.start(runway_s=3, force=True)
    s.control("end")
    assert s.last_recap and s.last_recap.get("stations"), "CONTROL: the END recap carries the row"
    # a hit fact from a bound player arrives after END (the outbox flush)
    p = next(pl for pl in s.players.values() if pl.get("node_id"))
    s.net.simulate_event(p["node_id"], {"type": "hit_taken", "shooter_num": 0, "shooter_team": 0, "dmg": 9, "t": s.now_ms(), "match_id": s.scorer.match_id}, s.now_ms())
    assert s.phase == "recap"
    assert s.last_recap.get("stations") == [{"node_id": "util-1", "kind": "respawn", "id": 1, "team": 1,
                                              "heard": True, "revives": 2, "synced": False}], s.last_recap.get("stations")


def test_a_late_fact_after_a_roll_keeps_match_1s_stations_not_match_2s():
    """F206 (review 2026-09-16): `_ingest_retired` re-took match 1's recap with `_scorer_recap`, which
    reads `self.stations` LIVE. Once the operator rolled to match 2 and the station heartbeat moved on,
    a late match-1 fact rewrote match 1's archive row with match 2's station report. The rows must be
    frozen at `_finish` and reused for a retired scorer."""
    s = _joined(_sess(respawn={"type": "scanner", "delay_s": 15}))
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 1})
    s.net.simulate_status("util-1", {"node_id": "util-1", "arm_state": "connected", "synced": False,
                                     "role": "utility", "kind": "respawn", "station_id": 1, "armed": True,
                                     "revives": 2}, s.now_ms())
    s.push_config(force=True)
    s.start(runway_s=3, force=True)
    mid1 = s.scorer.match_id
    p = next(pl for pl in s.players.values() if pl.get("node_id"))
    t_kill = s.now_ms()
    s.control("end")
    assert s.last_recap["stations"][0]["revives"] == 2, "CONTROL: match 1 ended on 2 revives"
    s.next_match()   # roll forward, roster + game kept, match 1 retired
    # match 2's station heartbeat moves on to a different count
    s.net.simulate_status("util-1", {"node_id": "util-1", "arm_state": "connected", "synced": False,
                                     "role": "utility", "kind": "respawn", "station_id": 1, "armed": True,
                                     "revives": 9}, s.now_ms())
    # a fact for match 1, flushed late from the phone's outbox
    s.net.simulate_event(p["node_id"], {"type": "hit_taken", "shooter_num": 0, "shooter_team": 0, "dmg": 9,
                                        "t": t_kill, "match_id": mid1}, s.now_ms())
    rows = s._ended[mid1]["recap"]["stations"]
    # F401: `revives` stays frozen at match 1's count, but `synced` is a LIVE question -- the node itself
    # was heard again (for match 2's heartbeat), so match 1's debrief can say so too.
    assert rows == [{"node_id": "util-1", "kind": "respawn", "id": 1, "team": 1, "heard": True,
                      "revives": 2, "synced": True}], rows


def test_a_late_fact_in_recap_before_any_roll_keeps_the_frozen_stations():
    """Review 2026-09-16: `_restore_recap` and `recap()` called `_scorer_recap(self.scorer)` with no frozen
    rows while still in RECAP, before any roll -- so they read the CURRENT stations, not the ones frozen at
    the whistle. The operator can set/clear/release stations in RECAP -- match 2's setup -- and that must
    not leak into match 1's still-open debrief, no roll required. (A heartbeat whose assignment is
    UNCHANGED is a different case, and IS allowed to land late -- see
    `test_a_same_assignment_late_station_heartbeat_in_recap_lands` below.)"""
    s = _joined(_sess(respawn={"type": "scanner", "delay_s": 15}))
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 1})
    s.net.simulate_status("util-1", {"node_id": "util-1", "arm_state": "connected", "synced": False,
                                     "role": "utility", "kind": "respawn", "station_id": 1, "armed": True,
                                     "revives": 2}, s.now_ms())
    s.push_config(force=True)
    s.start(runway_s=3, force=True)
    p = next(pl for pl in s.players.values() if pl.get("node_id"))
    t_kill = s.now_ms()
    s.control("end")
    assert s.phase == "recap"
    assert s.last_recap["stations"][0]["revives"] == 2, "CONTROL: match ended on 2 revives"
    # still in RECAP -- no roll -- the operator reassigns the station for match 2 (a new id)
    s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 2})
    s.net.simulate_status("util-1", {"node_id": "util-1", "arm_state": "connected", "synced": False,
                                     "role": "utility", "kind": "respawn", "station_id": 2, "armed": True,
                                     "revives": 9}, s.now_ms())
    # F401: `revives` stays frozen at 2 (the reassigned heartbeat's count must not leak in), but the
    # reassignment heartbeat IS proof the node itself came back into Wi-Fi, so `synced` flips true --
    # it tracks the node, not which match's assignment last touched the row.
    frozen = [{"node_id": "util-1", "kind": "respawn", "id": 1, "team": 1, "heard": True, "revives": 2,
               "synced": True}]
    # the `recap()` accessor must not pick up the reassigned heartbeat either, with no late fact at all
    assert s.recap()["stations"] == frozen, s.recap()["stations"]
    # a fact for the finished match, flushed late from the phone's outbox, while still in RECAP
    s.net.simulate_event(p["node_id"], {"type": "hit_taken", "shooter_num": 0, "shooter_team": 0, "dmg": 9,
                                        "t": t_kill, "match_id": s.scorer.match_id}, s.now_ms())
    assert s.last_recap["stations"] == frozen, s.last_recap["stations"]


def test_a_same_assignment_late_station_heartbeat_in_recap_lands():
    """F206 addendum, 2026-09-17: utility.md §5c/§5d.6 -- a station is self-authoritative and "reports ...
    to MC when it is next in Wi-Fi range". A station out of coverage at the whistle must not be stuck
    showing `heard: False` (or a stale count) forever just because `_finish` froze the row -- as long as
    its ASSIGNMENT (node_id + kind + id) has not moved on to a NEXT match, its late heartbeat must update
    the frozen row and the archive row, same as a late scoring fact does."""
    s = _joined(_sess(respawn={"type": "scanner", "delay_s": 15}))
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 1})
    s.push_config(force=True)
    s.start(runway_s=3, force=True)
    s.control("end")
    assert s.phase == "recap"
    assert s.last_recap["stations"] == [{"node_id": "util-1", "kind": "respawn", "id": 1, "team": 1,
                                          "heard": False, "revives": None, "synced": False}], \
        "CONTROL: never heard from this station yet"
    # the station was out of Wi-Fi range at the whistle and only now reports in, SAME assignment
    s.net.simulate_status("util-1", {"node_id": "util-1", "arm_state": "connected", "synced": False,
                                     "role": "utility", "kind": "respawn", "station_id": 1, "armed": True,
                                     "revives": 4}, s.now_ms())
    landed = [{"node_id": "util-1", "kind": "respawn", "id": 1, "team": 1, "heard": True, "revives": 4,
               "synced": True}]
    assert s.recap()["stations"] == landed, s.recap()["stations"]
    assert s.last_recap["stations"] == landed, s.last_recap["stations"]


def test_a_player_phone_that_rehellos_as_utility_is_unbound_like_an_evict():
    """F106(c) + polish review: the re-hello unbound `node_player` but left `ready` and the ack, so kit->lobby
    could advance on a phone that had become a station."""
    s = _joined(_sess())
    p = next(pl for pl in s.players.values() if pl.get("node_id"))
    nid = p["node_id"]
    p["ready"] = True
    s.acks[p["player_id"]] = {"ok": True}
    s.net.simulate_utility_hello(nid)
    assert p.get("node_id") is None and nid not in s.node_player
    assert p["ready"] is False and p["player_id"] not in s.acks
    assert nid in s.stations
    # CONTROL: a status body saying `role: utility` from a still-bound PLAYER phone does not unbind it -- and
    # (polish round 2) does not RE-TYPE it either: the node stays a player node, so END still reaches it and
    # its log is still pulled. A status never changes what a bound node is (A8); only a hello does.
    q = next(pl for pl in s.players.values() if pl.get("node_id"))
    q["ready"] = True
    s.net.simulate_status(q["node_id"], {"node_id": q["node_id"], "arm_state": "connected", "synced": True, "role": "utility"}, s.now_ms())
    assert q.get("node_id") and q["ready"] is True
    assert s.nodes[q["node_id"]].get("node_type") != "utility", "a status field must not re-type a bound player node"
    assert q["node_id"] not in s.stations or not s.stations[q["node_id"]].get("report"), "and it files no station report"
    s.push_config(force=True); s.start(runway_s=3, force=True); s.phase = "live"
    s.net.pushed.clear()
    s.control("end")
    assert any(n == q["node_id"] and k == "control" for n, k, _ in s.net.pushed), "END reaches the phone the status tried to re-type"


# --------------------------------------------------------------------------- A41: release a stuck phone
def test_release_utility_is_a_control_cmd_on_both_ends_of_the_wire():
    """Same trap as `station_config` (top of this file): a `control` cmd MC sends and the phone's own
    whitelist (`app/src/transport/contract.gen.js CONTROL_CMDS`, generated from `types.py`) does not list
    is dropped as malformed before `onMessage` ever sees it."""
    from brx_mcp.mc.types import CONTROL_CMDS
    assert "release_utility" in CONTROL_CMDS
    env = E.make_envelope("control", {"cmd": "release_utility"})
    assert E.decode(E.encode(env), direction="mc")["body"]["cmd"] == "release_utility"
    js = (REPO / "app/src/transport/contract.gen.js").read_text(encoding="utf-8")
    assert "release_utility" in js, "app/src/transport/contract.gen.js is stale -- rerun mcp/tools/gen_contract.py"


def test_release_station_pushes_control_release_utility_to_that_one_node():
    """A41 (field 2026-09-12): the operator's cure for a phone stuck in utility mode. Works on a phone
    nobody has assigned yet (the usual stuck case) as much as on a fully armed one, and touches nothing
    else about the station's own bookkeeping."""
    s = _sess()
    s.net.simulate_utility_hello("util-1")
    assert s.release_station("util-1") is True
    assert _pushed(s, "control", "util-1") == [{"cmd": "release_utility"}]
    # it did not assign, arm, or otherwise change the station's own record
    assert s.stations["util-1"]["assigned"] is None and s.stations["util-1"]["armed"] is None


def test_release_station_is_best_effort_like_arm_and_refuses_an_unknown_node():
    """No socket, no delivery -- there is nothing to retry against a phone with a dead radio (unlike
    `_arm_station`, a release is a one-shot, never retried on a timer: the phone's own seven-tap gate is
    still there under it). An unknown node id (never said hello as utility) is a plain False, not a raise
    -- the same voice `clear_station`/`set_station` use for "not a station"."""
    s = _sess()
    assert s.release_station("never-said-hello") is False
    s.net.simulate_utility_hello("util-1")
    s.net.push = lambda nid, kind, body: False           # NetServer: "no live socket"
    assert s.release_station("util-1") is False


def test_release_station_is_not_phase_gated_unlike_set_and_clear_station():
    """A stranded phone needs releasing in every phase -- armed/live most of all, since that is exactly
    when a phone that fell into utility mode mid-match is missing from the game. Unlike `set_station`/
    `clear_station` this never calls `_refuse_station_change_in_play`."""
    s = _joined(_sess())
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "respawn", "team": "any", "id": 9})
    s.phase = "live"
    assert s.release_station("util-1") is True
    assert _pushed(s, "control", "util-1")[-1] == {"cmd": "release_utility"}
    # CONTROL: an ordinary assignment change IS refused in this phase (the behaviour release deliberately skips)
    try:
        s.set_station("util-1", {"kind": "respawn", "team": "any", "id": 10})
        raise AssertionError("a station reassignment during LIVE was accepted")
    except ValueError as e:
        assert "LIVE" in str(e)


def test_releasing_a_station_takes_its_assignment_with_it():
    """A release that left the assignment standing kept MC vouching for a field item that had walked
    away. The ITEMS card still rendered its kind/team/id as deployed, `_station_warnings` still counted
    it as the respawn point (or control point) this game's rules need -- so a station-gated game read as
    SET UP with nothing on the field emitting anything, which is the F104 failure mode produced by MC's
    own bookkeeping -- and its id stayed in every player's `config.stations` allow-list."""
    s = _joined(_sess(respawn={"type": "scanner", "delay_s": 15}))
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "respawn", "team": "any", "id": 9})
    assert [x["id"] for x in s._station_ids()] == [9]
    assert not [w for w in s.config_warnings if "NO RESPAWN STATION" in w]

    assert s.release_station("util-1") is True
    assert s.stations["util-1"]["assigned"] is None and s.stations["util-1"]["armed"] is None
    assert s._station_ids() == [], "a released phone's id must leave the allow-list"
    assert [w for w in s.config_warnings if "NO RESPAWN STATION" in w], \
        "scanner respawn with nothing assigned is a SETUP warning again"


def test_a_release_that_reached_no_socket_leaves_the_assignment_alone():
    """The other direction of the same honesty. A release is best-effort (there is no ack kind for
    `control`); one that reached no socket changed NOTHING on the field -- that phone is still a station,
    propped up wherever it was left -- so clearing the row then would be the same lie pointing the other
    way. `ok` means only that a socket took the push, and the bookkeeping follows exactly that."""
    s = _joined(_sess(respawn={"type": "scanner", "delay_s": 15}))
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "respawn", "team": "any", "id": 9})
    s.net.push = lambda nid, kind, body: False           # NetServer: "no live socket"
    assert s.release_station("util-1") is False
    assert (s.stations["util-1"]["assigned"] or {}).get("id") == 9
    assert [x["id"] for x in s._station_ids()] == [9]


def test_a_control_station_under_a_grenade_objective_is_named_not_silently_ignored():
    """Stick hills (Tony 2026-09-24: Stick stations are Bluetooth-only for MVP) advertise the same kind-5
    control point a phone does, and every phone drops it unless station_source is "phone"
    (`engine.js _hillSourceAllowed`). KOTH's stock card is "grenade", so an assigned CONTROL station
    was a hill nobody could take, and MC said nothing. It says so now; it does not switch the source
    (a grenade hill with a spare station out is a real setup)."""
    for src, word in (("grenade", "GRENADE"), ("ir_station", "IR STATION")):
        s = _sess("koth", station_source=src)
        s.net.simulate_utility_hello("util-1")
        s.set_station("util-1", {"kind": "control", "team": "any", "id": 9})
        hits = [w for w in s.config_warnings if "A CONTROL STATION IS ASSIGNED" in w]
        assert hits and word in hits[0] and "OBJECTIVE SOURCE" in hits[0], (src, s.config_warnings)
        assert s.config["station_source"] == src, "never auto-switched"
    # CONTROL: the right source, or no control station, says nothing
    s = _sess("koth", station_source="phone")
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "control", "team": "any", "id": 9})
    assert not any("A CONTROL STATION IS ASSIGNED" in w for w in s.config_warnings), s.config_warnings
    t = _sess("koth", station_source="grenade")
    t.net.simulate_utility_hello("util-1")
    t.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 4})
    assert not any("A CONTROL STATION IS ASSIGNED" in w for w in t.config_warnings), t.config_warnings


def test_an_old_phone_powerup_station_gets_the_1ft_claim_default_not_the_3m_one():
    """S58 (doc-rot 2026-09-24): a powerup station's own default is the ~1 ft claim range (-55, a placeholder until
    bench 4.11), so an old phone that clamps 0 gets -55 explicitly, never the -74 of the other kinds."""
    from brx_mcp.mc.state import Session
    from brx_mcp.mc.types import PHONE_POWERUP_THRESHOLD_DBM
    assert PHONE_POWERUP_THRESHOLD_DBM == -55
    got = Session._wire_threshold("util-old", {"app_ver": "0.4.11+f366156e"}, {"threshold": 0, "kind": "powerup", "team": 255, "id": 9})
    assert got == -55, got


# --------------------------------------------------------------------------- F364: MC assigns the station id
def _restart_mc(s):
    """A new MC process reading the old one's session.json."""
    import tempfile
    if s._persist_path is None:
        s._persist_path = pathlib.Path(tempfile.mkdtemp(prefix="brx-ids-test-")) / "session.json"
    s._persist_last = 0.0
    s._persist()
    s2 = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()))
    s2._persist_path = s._persist_path
    s2.restore_snapshot()
    return s2


def test_f364_mc_assigns_1_2_3_across_a_phone_and_a_stick():
    s = _sess()
    for nid in ("util-a", "stick-0123456789ab", "util-b"):
        s.net.simulate_utility_hello(nid)
    got = [s.set_station(nid, {"kind": "respawn", "team": "any"})["assigned"]["id"]
           for nid in ("util-a", "stick-0123456789ab", "util-b")]
    assert got == [1, 2, 3], got
    assert _pushed(s, "station_config", "stick-0123456789ab")[-1]["id"] == 2
    assert _pushed(s, "station_config", "util-a")[-1]["valid_ids"] == [1, 2, 3]
    # a re-assignment with no id (a kind change) keeps the station's own number
    assert s.set_station("util-a", {"kind": "control", "team": "any"})["assigned"]["id"] == 1


def test_f364_a_station_keeps_its_id_across_its_restart_a_relink_and_a_clear():
    s = _sess()
    for nid in ("util-a", "stick-1"):
        s.net.simulate_utility_hello(nid)
        s.set_station(nid, {"kind": "respawn", "team": "any"})
    s.net.simulate_utility_hello("stick-1")                       # the Stick rebooted: same node_id, new hello
    assert s.stations["stick-1"]["assigned"]["id"] == 2
    assert _pushed(s, "station_config", "stick-1")[-1]["id"] == 2
    s.clear_station("stick-1")                                    # cleared, then a new station joins
    s.net.simulate_utility_hello("util-new")
    assert s.set_station("util-new", {"kind": "respawn", "team": "any"})["assigned"]["id"] == 3, \
        "a new station must not take the number a cleared station still owns"
    s.net.simulate_utility_hello("stick-1")                       # the Stick relinks and is assigned again
    assert s.set_station("stick-1", {"kind": "respawn", "team": "any"})["assigned"]["id"] == 2


def test_f364_an_mc_restart_keeps_every_station_id():
    s = _sess()
    for nid in ("util-a", "stick-1", "util-c"):
        s.net.simulate_utility_hello(nid)
        s.set_station(nid, {"kind": "respawn", "team": "any"})
    s.clear_station("util-c")
    s2 = _restart_mc(s)
    assert {n: st["assigned"]["id"] for n, st in s2.stations.items() if st.get("assigned")} == {"util-a": 1, "stick-1": 2}
    s2.net.simulate_utility_hello("util-c")
    s2.net.simulate_utility_hello("util-d")
    assert s2.set_station("util-d", {"kind": "respawn", "team": "any"})["assigned"]["id"] == 4
    assert s2.set_station("util-c", {"kind": "respawn", "team": "any"})["assigned"]["id"] == 3, \
        "a cleared station's number survives the restart too"


def test_f364_an_explicit_id_from_an_older_console_is_still_validated_for_uniqueness():
    s = _sess()
    s.net.simulate_utility_hello("util-a")
    s.net.simulate_utility_hello("stick-1")
    s.set_station("util-a", {"kind": "respawn", "team": "any"})                  # MC gives it 1
    try:
        s.set_station("stick-1", {"kind": "respawn", "team": "any", "id": 1})
        raise AssertionError("an explicit id that clashes with an MC-assigned one was accepted")
    except ValueError as e:
        assert "already assigned to util-a" in str(e), e
    assert s.set_station("stick-1", {"kind": "respawn", "team": "any", "id": 7})["assigned"]["id"] == 7
    s.net.simulate_utility_hello("util-b")
    assert s.set_station("util-b", {"kind": "respawn", "team": "any"})["assigned"]["id"] == 2
    for bad in (0, "3", True):
        try:
            s.set_station("util-b", {"kind": "respawn", "team": "any", "id": bad})
            raise AssertionError(f"accepted id {bad!r}")
        except ValueError as e:
            assert "id must be" in str(e)


def test_f364_polish_a_reinstall_frees_the_old_number_once_the_old_node_is_evicted():
    s = _sess()
    for nid in ("util-a", "util-old"):
        s.net.simulate_utility_hello(nid)
        s.set_station(nid, {"kind": "respawn", "team": "any"})       # 1, 2
    s.clear_station("util-a")
    s.evict_node("util-a")                                           # the phone was reinstalled: a new node_id
    s.net.simulate_utility_hello("util-a-new")
    assert s.set_station("util-a-new", {"kind": "respawn", "team": "any"})["assigned"]["id"] == 1, \
        "the evicted node's number is free again"
    # control: a CLEARED (not evicted) station keeps its number reserved
    s.clear_station("util-old")
    s.net.simulate_utility_hello("util-c")
    assert s.set_station("util-c", {"kind": "respawn", "team": "any"})["assigned"]["id"] == 3


def test_f364_polish_a_new_session_without_the_roster_starts_at_1_and_one_with_it_keeps_ids():
    s = _sess()
    for nid in ("util-a", "util-b"):
        s.net.simulate_utility_hello(nid)
        s.set_station(nid, {"kind": "respawn", "team": "any"})
        s.clear_station(nid)
    s.new_session(keep_roster=True)
    s.net.simulate_utility_hello("util-x")
    assert s.set_station("util-x", {"kind": "respawn", "team": "any"})["assigned"]["id"] == 3, "keep_roster keeps the ids"
    s.clear_station("util-x")
    s.new_session(keep_roster=False)
    s.set_config({"mode": "tdm"})
    s.net.simulate_utility_hello("util-y")
    assert s.set_station("util-y", {"kind": "respawn", "team": "any"})["assigned"]["id"] == 1


def test_duration_ms_follows_a_time_limit_edited_after_load_and_stops_at_end():
    """A68 review 2026-09-25: MC sends `duration_ms` from LOAD. An edit in LOBBY re-pushes the NEW limit
    (`_repush_lobby_config` -> `arm_stations`), clearing the limit drops it, and END's recap push has none."""
    s = _sess(time_limit_s=600)
    s.net.simulate_utility_hello("stick-1")
    s.set_station("stick-1", {"kind": "control", "team": "any", "id": 3})
    assert "duration_ms" not in _pushed(s, "station_config", "stick-1")[-1]   # nothing LOADed yet
    r = s.push_config(force=True)
    assert s.lobby_pushed, r
    assert _pushed(s, "station_config", "stick-1")[-1].get("duration_ms") == 600000
    s.set_config({"time_limit_s": 900})
    assert s.lobby_pushed
    assert _pushed(s, "station_config", "stick-1")[-1].get("duration_ms") == 900000
    s.set_config({"coverage": "full", "time_limit_s": None})
    assert "duration_ms" not in _pushed(s, "station_config", "stick-1")[-1]
    s.phase = "recap"
    s.lobby_pushed = False
    s._arm_station("stick-1")
    last = _pushed(s, "station_config", "stick-1")[-1]
    assert last["ends_in_ms"] == 0 and "duration_ms" not in last


def test_f401_the_load_warning_survives_an_mc_restart_and_clears_when_the_station_is_heard():
    """F401 polish: restarting MC between matches is the house routine, so the list of stations the last match
    still waits to hear from is in the snapshot. A heartbeat after the whistle clears it, once."""
    import json, pathlib, tempfile
    s = _joined(_sess(mode="koth", station_source="phone"))
    s.net.simulate_utility_hello("brxu-live")
    s.set_station("brxu-live", {"kind": "control", "team": "any", "id": 3})
    s.push_config(force=True); s.start(runway_s=3, force=True); s.phase = "live"
    common = {"node_id": "brxu-live", "arm_state": "connected", "synced": False,
              "role": "utility", "kind": "control", "station_id": 3, "armed": True}
    s.net.simulate_status("brxu-live", {**common, "control": {"hold_ms": {"1": 12_000}, "owner": 1}}, s.now_ms())
    s.control("end")
    s.nodes["brxu-live"]["last_seen_ms"] = s._match_end_t - 1          # it walked out of Wi-Fi before the whistle
    s._validate()
    assert any("HAS NOT SYNCED THE LAST MATCH" in w for w in s.config_warnings), s.config_warnings
    tmp = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s._persist_path = tmp; s._persist_last = 0.0; s._persist()
    assert json.loads(tmp.read_text())["sync_pending"]["nodes"] == {"brxu-live": "CONTROL POINT 3"}
    s2 = _sess(mode="koth", station_source="phone")
    s2._persist_path = tmp
    s2.restore_snapshot()                                             # no hand-run _validate: the restore must show it
    assert any(w.startswith("CONTROL POINT 3 HAS NOT SYNCED") for w in s2.config_warnings), s2.config_warnings
    s2.net.simulate_status("brxu-live", {**common, "control": {"hold_ms": {"1": 12_000}}}, s2._match_end_t + 5_000)
    assert not any("HAS NOT SYNCED" in w for w in s2.config_warnings), "a heartbeat after the whistle clears it"
    assert "brxu-live" not in s2._sync_pending


def test_f401_the_sync_warning_stops_once_a_new_game_byte_has_reset_the_station():
    """F401 polish: the next cycle's first push bumps the game byte (`_next_game_no`), which resets the station's
    tally, so "BEFORE YOU LOAD" is stale from then on and the warning goes."""
    s = _joined(_sess(mode="koth", station_source="phone"))
    s.net.simulate_utility_hello("brxu-live")
    s.set_station("brxu-live", {"kind": "control", "team": "any", "id": 3})
    s.push_config(force=True); s.start(runway_s=3, force=True); s.phase = "live"
    s.control("end")
    s.nodes["brxu-live"]["last_seen_ms"] = s._match_end_t - 1
    s._validate()
    assert any("HAS NOT SYNCED" in w for w in s.config_warnings), s.config_warnings
    s._next_game_no()
    s._validate()
    assert not any("HAS NOT SYNCED" in w for w in s.config_warnings), s.config_warnings



def test_f402_start_refuses_a_koth_whose_hill_was_unassigned_after_load():
    """F402 polish: LOAD passed with a hill, then the host cleared it in LOBBY; START must refuse (force too)."""
    from _session import assign_koth_hill
    s = _joined(_sess(mode="koth", station_source="phone"))
    nid = assign_koth_hill(s)
    s.push_config(force=True)
    assert s.clear_station(nid)
    for force in (False, True):
        try:
            s.start(runway_s=3, force=force)
            raise AssertionError("a koth with no hill reached START")
        except ValueError as e:
            assert "KING OF THE HILL NEEDS A HILL" in str(e), e


def test_f402_the_hill_offline_warning_skips_a_held_stick_and_a_second_online_hill():
    """F402 polish: a HELD or muster Stick is out of Wi-Fi by design (A68), and one online hill is enough."""
    from _session import assign_koth_hill
    s = _joined(_sess(mode="koth", station_source="phone"))
    a = assign_koth_hill(s, "hill-a")
    offline = lambda: [w for w in s.snapshot()["config_warnings"] if "THE HILL IS OFFLINE" in w]
    s.nodes[a]["stale"] = True                                  # its link has gone stale
    assert offline(), "CONTROL: a plain hill gone quiet is warned"
    s.stations[a].setdefault("report", {})["assoc"] = "held"
    assert not offline(), "a HELD Stick carried out of Wi-Fi is not 'offline' news"
    s.stations[a]["report"].pop("assoc")
    b = assign_koth_hill(s, "hill-b")                          # a second hill, heard just now
    assert not offline(), "one online hill is enough"


def test_f402_switching_a_loaded_game_to_koth_without_a_hill_unloads_it_instead_of_raising():
    s = _joined(_sess(mode="tdm"))
    s.push_config(force=True)
    s.load_game()
    assert s.game_loaded
    r = s.set_config({"mode": "koth", "station_source": "phone"})    # must not raise half-way
    assert s.game_loaded is False and s.config["mode"] == "koth", r
