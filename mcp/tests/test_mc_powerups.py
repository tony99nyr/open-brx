"""A56 / S58 (docs/spec/powerups.md): powerup stations, MC side.

The flag (`--powerups`, off by default), the item presets (`GET /api/powerups`, `item_preset` on the station PUT),
the compile (pickup weapons armed EMPTY in spare slots 2 and 3, out of the ALT cycle), the `pickup` fact (stored,
never scored) and the Halo spawn schedule on MC's own match clock (`station_update` to the station).
Every behaviour test carries a control on the same path: the flag off, or the state before the change.
"""
from __future__ import annotations

import argparse
import random
import re

from brx_mcp.mc import envelope as E
from brx_mcp.mc import powerups as PU
from brx_mcp.mc.compile import Compiler, WeaponCatalog
from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
from brx_mcp.mc.state import Session


class _Clock:
    def __init__(self, t: int = 1_800_000_000_000):
        self.t = t

    def __call__(self) -> int:
        return self.t


def _sess(powerups: bool = True, n: int = 2):
    clock = _Clock()
    s = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()), now_ms=clock, voice_rng=random.Random(7))
    s.powerups_enabled = powerups
    s.set_config({"mode": "tdm"})
    guns = [g["gun_id"] for g in s.armory.list()][:n]
    teams = [t["team_id"] for t in s.config["teams"]]
    for i, g in enumerate(guns):
        s.add_player(f"P{i}", teams[i % len(teams)], g, "male")
    for i, p in enumerate(s.players.values()):
        s.net.simulate_hello(f"phone-{i}", p["gun_id"])
    return s, clock


def _station(s, nid: str, sid: int, preset: str | None = None, kind: str = "powerup"):
    s.net.simulate_utility_hello(nid)
    body: dict = {"kind": kind, "team": "any", "id": sid}
    if preset is not None:
        body["item_preset"] = preset
    return s.set_station(nid, body)


def _pushed(s, kind, nid=None):
    return [b for n, k, b in s.net.pushed if k == kind and (nid is None or n == nid)]


def _refused(fn, *words):
    try:
        fn()
    except ValueError as e:
        msg = str(e)
        for w in words:
            assert w in msg, f"{w!r} not in {msg!r}"
        return msg
    raise AssertionError("not refused")


# --------------------------------------------------------------------------- defaults
def test_the_three_presets_expand_from_the_named_defaults():
    cat = WeaponCatalog()
    view = PU.presets_view(True, cat)
    assert view["enabled"] is True
    by = {p["preset"]: p["item"] for p in view["presets"]}
    assert list(by) == ["rockets", "rail_gun", "overshield"]
    assert by["rockets"]["weapon_id"] == "rocket_launcher" and by["rail_gun"]["weapon_id"] == "rail_gun"
    # charges = the weapon's COMPILED magazine, read from the catalogue, never a literal
    assert by["rockets"]["charges"] == cat.spawn_ammo("rocket_launcher")[0] == 2
    assert by["rail_gun"]["charges"] == cat.spawn_ammo("rail_gun")[0]
    for k in ("rockets", "rail_gun"):
        assert by[k]["kind"] == "weapon" and by[k]["spawn_every_s"] == 120 and by[k]["first_at_s"] == 120
        assert "amount" not in by[k]
    o = by["overshield"]
    assert o == {**o, "kind": "overshield", "amount": 75, "spawn_every_s": 60, "first_at_s": 60}
    assert "weapon_id" not in o and "charges" not in o
    for item in by.values():
        assert 1 <= len(item["name"]) <= 12 and re.fullmatch(r"#[0-9a-f]{6}", item["color"])
        assert 1 <= item["spawn_every_s"] <= 255
    # the still-to-confirm defaults are named constants the phone mirrors
    assert PU.LOST_AT_DEATH is True and PU.WEAPON_PICKUP_SWAPS is True
    assert PU.OVERSHIELD_AMOUNT == 75 and PU.OVERSHIELD_DECAY_PER_S == 0 and PU.OVERSHIELD_REGEN is False
    assert PU.PICKUP_SLOTS == (2, 3)
    # CONTROL: the flag rides through, the presets do not depend on it
    assert PU.presets_view(False, cat)["enabled"] is False
    assert PU.presets_view(False, cat)["presets"] == view["presets"]


def test_the_cli_flag_defaults_off_and_reaches_the_session():
    from brx_mcp.mc import __main__ as M
    assert M.parser().parse_args([]).powerups is False
    assert M.parser().parse_args(["--powerups"]).powerups is True
    s = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()))
    assert s.powerups_enabled is False, "a Session is built with the flag OFF"
    assert s.powerups_view()["enabled"] is False
    s.powerups_enabled = True
    assert s.powerups_view()["enabled"] is True


def test_build_carries_the_flag_to_the_session():
    import os
    import shutil
    import tempfile
    from brx_mcp.mc import __main__ as M
    tmp = tempfile.mkdtemp(prefix="brx-mc-powerups-test-")
    had, old = "BRX_MC_DIR" in os.environ, os.environ.get("BRX_MC_DIR")
    os.environ["BRX_MC_DIR"] = tmp
    try:
        for flag in (False, True):
            args = M.parser().parse_args(["--fake-net", "--ephemeral", "--no-auth", "--port", "0", "--ws-port", "0"]
                                         + (["--powerups"] if flag else []))
            session, _net, _extra = M.build(argparse.Namespace(**vars(args)))
            assert session.powerups_enabled is flag
    finally:
        if had:
            os.environ["BRX_MC_DIR"] = old or ""
        else:
            os.environ.pop("BRX_MC_DIR", None)
        shutil.rmtree(tmp, ignore_errors=True)


# --------------------------------------------------------------------------- the PUT
def test_item_preset_is_refused_with_the_flag_off():
    s, _ = _sess(powerups=False)
    s.net.simulate_utility_hello("u1")
    _refused(lambda: s.set_station("u1", {"kind": "powerup", "team": "any", "id": 5, "item_preset": "rockets"}),
             "--powerups")
    assert s.stations["u1"]["assigned"] is None
    # CONTROL: the same station without an item is still accepted with the flag off
    assert s.set_station("u1", {"kind": "powerup", "team": "any", "id": 5})["assigned"]["id"] == 5


def test_item_preset_validation():
    s, _ = _sess()
    s.net.simulate_utility_hello("u1")
    _refused(lambda: s.set_station("u1", {"kind": "respawn", "team": "any", "id": 5, "item_preset": "rockets"}),
             "powerup")
    _refused(lambda: s.set_station("u1", {"kind": "powerup", "team": "any", "id": 5, "item_preset": "bfg"}),
             "rockets", "rail_gun", "overshield")
    _refused(lambda: s.set_station("u1", {"kind": "powerup", "team": "any", "id": 5, "item_preset": 3}),
             "item_preset")
    _refused(lambda: s.set_station("u1", {"kind": "powerup", "team": "any", "id": 5,
                                          "item": {"kind": "overshield", "amount": 999}}), "item_preset")
    assert s.stations["u1"]["assigned"] is None
    v = s.set_station("u1", {"kind": "powerup", "team": "any", "id": 5, "item_preset": "rockets"})
    assert v["assigned"]["item"] == PU.expand("rockets", WeaponCatalog())


def test_item_preset_is_refused_in_play():
    s, _ = _sess()
    _station(s, "u1", 5, "overshield")
    s.push_config(force=True)
    s.start(runway_s=3, force=True)
    _refused(lambda: s.set_station("u1", {"kind": "powerup", "team": "any", "id": 5, "item_preset": "rockets"}),
             "ARMED")
    assert s.stations["u1"]["assigned"]["item"]["kind"] == "overshield", "locked for the match"


def test_get_api_powerups():
    try:
        import httpx  # noqa: F401
        from starlette.testclient import TestClient
    except Exception:
        return
    from brx_mcp.mc.api import create_app
    s, _ = _sess(powerups=False)
    c = TestClient(create_app(s))
    r = c.get("/api/powerups")
    assert r.status_code == 200 and r.json()["enabled"] is False
    assert [p["preset"] for p in r.json()["presets"]] == ["rockets", "rail_gun", "overshield"]
    s.net.simulate_utility_hello("u1")
    r = c.put("/api/stations/u1", json={"kind": "powerup", "team": "any", "id": 5, "item_preset": "rockets"})
    assert r.status_code == 400 and "--powerups" in r.json()["error"]
    s.powerups_enabled = True
    assert c.get("/api/powerups").json()["enabled"] is True
    r = c.put("/api/stations/u1", json={"kind": "powerup", "team": "any", "id": 5, "item_preset": "rockets"})
    assert r.status_code == 200 and r.json()["assigned"]["item"]["weapon_id"] == "rocket_launcher"


# --------------------------------------------------------------------------- compile
def _frames(s):
    return {pid: b for pid, b in s.bundles.items()}


def test_flag_off_compiles_nothing_new_even_with_a_stored_item():
    """A restored snapshot can carry an item into a run started WITHOUT --powerups: it must be inert."""
    base, _ = _sess(powerups=False)
    base.push_config(force=True)
    s, _ = _sess(powerups=False)
    s.net.simulate_utility_hello("u1")
    s.set_station("u1", {"kind": "powerup", "team": "any", "id": 5})
    s.stations["u1"]["assigned"]["item"] = PU.expand("rockets", WeaponCatalog())   # as a restored snapshot would
    s.push_config(force=True)
    for b, ref in zip(s.bundles.values(), base.bundles.values(), strict=True):   # same roster order, new ids
        for part in ("head", "spawn", "revive"):
            assert b[part] == ref[part], f"{part} moved with the flag off"
    wire = s._wire_config()
    assert "powerups" not in wire
    assert wire["stations"] == [{"id": 5, "kind": "powerup"}], "no item rides with the flag off"
    body = _pushed(s, "station_config", "u1")[-1]
    assert "item" not in body


def test_flag_on_arms_the_pickup_weapons_empty_in_slots_2_then_3():
    off, _ = _sess(powerups=True)
    off.push_config(force=True)                         # CONTROL: flag on, no item station
    s, _ = _sess(powerups=True)
    _station(s, "u1", 5, "rockets")
    _station(s, "u2", 6, "rail_gun")
    _station(s, "u3", 7, "overshield")
    _station(s, "u4", 8, "rockets")                      # the same weapon shares its slot
    s.push_config(force=True)
    wire = s._wire_config()
    assert wire["powerups"] == [{"weapon_id": "rocket_launcher", "slot": 2}, {"weapon_id": "rail_gun", "slot": 3}]
    items = {r["id"]: r.get("item") for r in wire["stations"]}
    assert items[5]["weapon_id"] == "rocket_launcher" and items[7]["kind"] == "overshield"
    cat = Compiler().catalog
    for b, ctrl_b in zip(s.bundles.values(), off.bundles.values(), strict=True):
        head = b["head"]
        assert any(f.startswith("$WEAP,2,") for f in head) and any(f.startswith("$WEAP,3,") for f in head)
        weap2 = next(f for f in head if f.startswith("$WEAP,2,"))
        assert weap2.split(",")[2:] == cat.resolve("rocket_launcher", 2, environment=s.config.get("environment")).split(",")[2:], "its normal $WEAP tokens"
        for part in ("spawn", "revive"):
            assert "$AMMO,2,0,0,1,*" in b[part] and "$AMMO,3,0,0,1,*" in b[part], f"{part}: empty magazine"
        # the ALT row is unchanged: the pickup slots are out of the cycle
        alt = [f for f in head if f.startswith("$BMAP,1,")]
        assert alt == [f for f in ctrl_b["head"] if f.startswith("$BMAP,1,")]
        assert not any(",2,99" in f or ",2,3," in f for f in alt)
        # everything the control head had is still there, in order
        ctrl = ctrl_b["head"]
        assert [f for f in head if not f.startswith("$WEAP,2,") and not f.startswith("$WEAP,3,")
                and not f.startswith("$SIR")] == [f for f in ctrl if not f.startswith("$SIR")]
    # every station's config carries its own item
    assert _pushed(s, "station_config", "u2")[-1]["item"]["weapon_id"] == "rail_gun"
    assert "powerups" not in off._wire_config()


def test_an_overshield_alone_needs_no_slot():
    s, _ = _sess()
    _station(s, "u1", 5, "overshield")
    s.push_config(force=True)
    assert "powerups" not in s._wire_config()
    assert not any(f.startswith("$WEAP,2,") for b in s.bundles.values() for f in b["head"])


def test_compile_reads_config_powerups():
    c = Compiler()
    s, _ = _sess(powerups=False)
    p = next(iter(s.players.values()))
    plain = c.compile(s.config, p, s.teams)
    armed = c.compile({**s.config, "powerups": [{"weapon_id": "rail_gun", "slot": 2}]}, p, s.teams,
                      plan=c.hit_plan(list(s.players.values()) + [{"player_id": "_pu", "loadout": {
                          "weapons": [{"weapon_id": "rail_gun"}]}}]))
    assert not any(f.startswith("$WEAP,2,") for f in plain["head"]) and "$AMMO,2,0,0,1,*" not in plain["spawn"]
    assert any(f.startswith("$WEAP,2,") for f in armed["head"]) and "$AMMO,2,0,0,1,*" in armed["spawn"]
    try:
        c.compile({**s.config, "powerups": [{"weapon_id": "rail_gun", "slot": 1}]}, p, s.teams)
        raise AssertionError("slot 1 accepted for a pickup")
    except ValueError:
        pass


def test_adding_an_item_after_the_lobby_push_recompiles_every_gun():
    s, _ = _sess()
    s.push_config(force=True)
    assert not any(f.startswith("$WEAP,2,") for b in s.bundles.values() for f in b["head"])
    s.net.pushed.clear()
    _station(s, "u1", 5, "rockets")
    assert all(any(f.startswith("$WEAP,2,") for f in b["head"]) for b in s.bundles.values())
    cfgs = _pushed(s, "config")
    assert cfgs and all(c["config"].get("powerups") for c in cfgs)
    assert all(any(f.startswith("$WEAP,2,") for f in c["frames"]["head"]) for c in cfgs)


# --------------------------------------------------------------------------- the pickup fact
def test_the_pickup_fact_is_a_valid_persisted_event():
    ev = {"type": "pickup", "t": 1_800_000_000_000, "match_id": "m", "node_id": "n", "player_id": "p",
          "station_id": 5, "item_kind": "weapon", "weapon_id": "rocket_launcher"}
    assert E.validate_event(ev)["station_id"] == 5
    try:
        E.validate_event({k: v for k, v in ev.items() if k != "station_id"})
        raise AssertionError("pickup without station_id accepted")
    except E.EnvelopeError as e:
        assert e.reason == "bad_event"


def _live(s, clock, runway_s=3):
    s.push_config(force=True)
    s.start(runway_s=runway_s, force=True)
    s.tick()
    return s.start_info["go_live_t"]


def _pickup(s, clock, sid, kind="overshield", nid="phone-0", seq=1, **extra):
    p = s.players[s.node_player[nid]]
    ev = {"type": "pickup", "t": clock.t, "match_id": s.start_info["match_id"], "node_id": nid,
          "player_id": p["player_id"], "station_id": sid, "item_kind": kind, "seq": seq, **extra}
    s.net.simulate_event(nid, ev, clock.t)


def test_the_halo_schedule_on_the_match_clock():
    s, clock = _sess()
    _station(s, "u1", 5, "overshield")
    s.net.pushed.clear()
    go = _live(s, clock, runway_s=3)
    # at arm time the station hears: nothing there, first spawn 60 s after go-live
    up = _pushed(s, "station_update", "u1")
    assert up == [{"id": 5, "available": False, "next_spawn_in_ms": 3000 + 60_000}]
    view = s._station_view("u1")
    assert view["item_available"] is False and view["next_spawn_at_ms"] == go + 60_000
    clock.t = go + 59_000; s.tick()
    assert len(_pushed(s, "station_update", "u1")) == 1, "CONTROL: nothing before the spawn time"
    clock.t = go + 60_000; s.tick()
    # the time to the NEXT spawn instant rides even while the item is there: the station counts down itself
    assert _pushed(s, "station_update", "u1")[-1] == {"id": 5, "available": True, "next_spawn_in_ms": 60_000}
    assert s._station_view("u1")["item_available"] is True
    assert s._station_view("u1")["next_spawn_at_ms"] == go + 120_000
    # untaken through the next spawn time: it never stacks, it just stays
    clock.t = go + 120_500; s.tick()
    assert s._station_view("u1")["item_available"] is True
    # a pickup at 2:10 empties it until the next spawn time on the schedule (3:00), not 2:10 + 60
    clock.t = go + 130_000
    _pickup(s, clock, 5)
    assert _pushed(s, "station_update", "u1")[-1] == {"id": 5, "available": False, "next_spawn_in_ms": 50_000}
    view = s._station_view("u1")
    assert view["item_available"] is False and view["next_spawn_at_ms"] == go + 180_000
    # a second player's pickup of the SAME (already taken) item changes nothing and is not re-sent
    n = len(_pushed(s, "station_update", "u1"))
    _pickup(s, clock, 5, nid="phone-1", seq=1)
    assert len(_pushed(s, "station_update", "u1")) == n
    clock.t = go + 180_000; s.tick()
    assert _pushed(s, "station_update", "u1")[-1] == {"id": 5, "available": True, "next_spawn_in_ms": 60_000}


def test_a_reconnecting_station_is_told_its_current_state():
    s, clock = _sess()
    _station(s, "u1", 5, "rockets")
    go = _live(s, clock)
    clock.t = go + 125_000; s.tick()
    s.net.pushed.clear()
    s.net.simulate_utility_hello("u1")               # the phone rebooted
    assert _pushed(s, "station_config", "u1"), "re-armed as before"
    assert _pushed(s, "station_update", "u1") == [{"id": 5, "available": True, "next_spawn_in_ms": 115_000}]
    _pickup(s, clock, 5, kind="weapon", weapon_id="rocket_launcher")
    s.net.pushed.clear()
    clock.t = go + 200_000
    s.net.simulate_utility_hello("u1")
    assert _pushed(s, "station_update", "u1") == [{"id": 5, "available": False, "next_spawn_in_ms": 40_000}]


def test_no_schedule_and_no_update_with_the_flag_off():
    s, clock = _sess(powerups=False)
    s.net.simulate_utility_hello("u1")
    s.set_station("u1", {"kind": "powerup", "team": "any", "id": 5})
    s.stations["u1"]["assigned"]["item"] = PU.expand("overshield", WeaponCatalog())
    go = _live(s, clock)
    clock.t = go + 60_000; s.tick()
    assert _pushed(s, "station_update") == []
    assert "item_available" not in s._station_view("u1")


def test_pickup_is_stored_and_never_scored():
    s, clock = _sess()
    _station(s, "u1", 5, "overshield")
    logged = []
    real_log = s._log
    s._log = lambda nid, kind, body, t, seq=None, parked=False: (logged.append((kind, body)),
                                                                 real_log(nid, kind, body, t, seq, parked))
    go = _live(s, clock)
    clock.t = go + 61_000; s.tick()
    def stats():
        return {pid: {k: getattr(st, k, None) for k in type(st).__slots__} for pid, st in s.scorer.stats.items()}
    before = stats()
    feed = len(s.scorer.hits_log)
    _pickup(s, clock, 5)
    assert [k for k, _ in logged] == ["pickup"], logged
    assert stats() == before, "a pickup moved a score"
    assert len(s.scorer.hits_log) == feed
    # the batch path too
    logged.clear()
    clock.t = go + 121_000; s.tick()
    p = s.players[s.node_player["phone-1"]]
    s.ingest_batch("phone-1", [{"type": "pickup", "t": clock.t, "match_id": s.start_info["match_id"],
                                "node_id": "phone-1", "player_id": p["player_id"], "station_id": 5,
                                "item_kind": "overshield", "seq": 3}], clock.t)
    assert [k for k, _ in logged] == ["pickup"]
    assert s._station_view("u1")["item_available"] is False


# --------------------------------------------------------------------------- station_action (the station's uplink)
def _action(s, clock, nid, sid, action, **extra):
    s.net.simulate_node_message(nid, "station_action", {"id": sid, "action": action, "t": clock.t, **extra}, clock.t)


def _feed(s):
    return [r["text"] for r in s.feed]


def test_station_action_is_a_node_kind_with_required_fields():
    from brx_mcp.mc.types import NODE_KINDS, StationAction  # noqa: F401
    assert "station_action" in NODE_KINDS
    env = E.make_envelope("station_action", {"id": 5, "action": "reset", "t": 1_800_000_000_000})
    assert E.decode(E.encode(env), direction="node")["body"]["action"] == "reset"
    try:
        E.validate(E.make_envelope("station_action", {"id": 5}), direction="node")
        raise AssertionError("station_action without an action was accepted")
    except E.EnvelopeError as e:
        assert e.reason == "missing_field", e.reason


def test_operator_reset_from_the_station_makes_the_item_available_now_on_the_fixed_schedule():
    s, clock = _sess()
    _station(s, "u1", 5, "overshield")
    go = _live(s, clock)
    clock.t = go + 70_000; s.tick()
    _pickup(s, clock, 5)
    assert s._station_view("u1")["item_available"] is False
    clock.t = go + 80_000
    _action(s, clock, "u1", 5, "reset")
    # `reset: true` tells the station this is an operator reset, not a re-send of a spawn it already awarded
    assert _pushed(s, "station_update", "u1")[-1] == {"id": 5, "available": True, "next_spawn_in_ms": 40_000, "reset": True}
    assert s._station_view("u1")["item_available"] is True
    assert "OPERATOR RESET · STATION #5" in _feed(s)
    # the pickup the player made BEFORE the reset, replayed late from its outbox, does not take the new item
    p = s.players[s.node_player["phone-0"]]
    s.net.simulate_event("phone-0", {"type": "pickup", "t": go + 70_000, "match_id": s.start_info["match_id"],
                                     "node_id": "phone-0", "player_id": p["player_id"], "station_id": 5,
                                     "item_kind": "overshield", "seq": 9}, clock.t)
    assert s._station_view("u1")["item_available"] is True
    # no restart and no stacking: the next spawn is still 2:00
    clock.t = go + 120_000; s.tick()
    assert _pushed(s, "station_update", "u1")[-1] == {"id": 5, "available": True, "next_spawn_in_ms": 60_000}
    # CONTROL: a reset naming another station's id changes nothing here
    _pickup(s, clock, 5, seq=10)
    _action(s, clock, "u1", 99, "reset")
    assert s._station_view("u1")["item_available"] is False


def test_console_reset_route_and_its_refusals():
    s, clock = _sess()
    _station(s, "u1", 5, "rockets")
    _refused(lambda: s.reset_station("u1"), "armed or live")
    go = _live(s, clock)
    clock.t = go + 1_000
    s.reset_station("u1")
    assert _pushed(s, "station_update", "u1")[-1] == {"id": 5, "available": True, "next_spawn_in_ms": 119_000, "reset": True}
    assert "OPERATOR RESET · STATION #5" in _feed(s)
    off, clock2 = _sess(powerups=False)
    off.net.simulate_utility_hello("u1")
    off.set_station("u1", {"kind": "powerup", "team": "any", "id": 5})
    _live(off, clock2)
    _refused(lambda: off.reset_station("u1"), "--powerups")
    try:
        import httpx  # noqa: F401
        from starlette.testclient import TestClient
    except Exception:
        return
    from brx_mcp.mc.api import create_app
    c = TestClient(create_app(s))
    assert c.post("/api/stations/u1/reset").status_code == 200
    assert c.post("/api/stations/nope/reset").status_code == 404
    assert c.post("/api/stations/u1/reset").json()["ok"] is True
    r = TestClient(create_app(off)).post("/api/stations/u1/reset")
    assert r.status_code == 400 and "--powerups" in r.json()["error"]


def test_taken_records_the_winner_and_dedupes_against_the_pickup_fact():
    s, clock = _sess()
    _station(s, "u1", 5, "rockets")
    go = _live(s, clock)
    clock.t = go + 121_000; s.tick()
    p0 = s.players[s.node_player["phone-0"]]
    n = len(_pushed(s, "station_update", "u1"))
    _action(s, clock, "u1", 5, "taken", player_num=p0["player_num"])
    v = s._station_view("u1")
    assert v["item_available"] is False and v["taken_by"] == p0["player_num"]
    line = f"{p0['display']} TOOK ROCKETS · STATION #5"
    assert _feed(s).count(line) == 1
    assert len(_pushed(s, "station_update", "u1")) == n + 1
    # the player's own pickup fact for the same spawn is a no-op: no second line, no second update
    _pickup(s, clock, 5, kind="weapon", weapon_id="rocket_launcher")
    assert _feed(s).count(line) == 1 and len(_pushed(s, "station_update", "u1")) == n + 1
    # cleared at the next spawn
    clock.t = go + 240_000; s.tick()
    assert "taken_by" not in s._station_view("u1") and s._station_view("u1")["item_available"] is True
    # the other order: the pickup first writes the same line, then `taken` is the no-op
    _pickup(s, clock, 5, kind="weapon", weapon_id="rocket_launcher", seq=2)
    assert _feed(s).count(line) == 2 and s._station_view("u1")["taken_by"] == p0["player_num"]
    m = len(_pushed(s, "station_update", "u1"))
    p1 = s.players[s.node_player["phone-1"]]
    _action(s, clock, "u1", 5, "taken", player_num=p1["player_num"])
    assert s._station_view("u1")["taken_by"] == p0["player_num"], "the second report never overwrites the first"
    assert len(_pushed(s, "station_update", "u1")) == m
    assert not any("P1 TOOK" in t for t in _feed(s))


# --------------------------------------------------------------------------- polish round 1
def test_a_restart_mid_match_keeps_a_taken_item_taken():
    """M1: `_pu_sched` rides in the snapshot and is restored for the SAME match only."""
    import pathlib
    import tempfile
    s, clock = _sess()
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    _station(s, "u1", 5, "overshield")
    go = _live(s, clock)
    clock.t = go + 61_000; s.tick()
    _pickup(s, clock, 5)
    assert s._station_view("u1")["item_available"] is False
    clock.t = go + 70_000
    s._persist_last = 0.0
    s._persist()
    s2 = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()), now_ms=clock, voice_rng=random.Random(7))
    s2.powerups_enabled = True
    s2._persist_path = s._persist_path
    assert s2.restore_snapshot()
    s2.tick()
    assert s2.phase in ("armed", "live") and s2.start_info["match_id"] == s.start_info["match_id"]
    s2.net.simulate_utility_hello("u1")
    ups = _pushed(s2, "station_update", "u1")
    assert ups and all(u["available"] is False for u in ups), ups
    assert ups[-1]["next_spawn_in_ms"] == 50_000
    view = s2._station_view("u1")
    assert view["item_available"] is False and view["taken_by"] == s.players[s.node_player["phone-0"]]["player_num"]
    # CONTROL: the next spawn still comes on the fixed schedule
    clock.t = go + 120_000; s2.tick()
    assert _pushed(s2, "station_update", "u1")[-1]["available"] is True


def test_a_station_reconnecting_after_the_match_gets_no_update():
    """M2: RECAP / LOBBY is not the match; the old schedule must not reach the station."""
    s, clock = _sess()
    _station(s, "u1", 5, "overshield")
    go = _live(s, clock)
    clock.t = go + 61_000; s.tick()
    s.net.pushed.clear()
    s.net.simulate_utility_hello("u1")
    assert _pushed(s, "station_update", "u1"), "CONTROL: in play the reconnect is told"
    s.control("end")
    s.net.pushed.clear()
    s.net.simulate_utility_hello("u1")
    assert _pushed(s, "station_update", "u1") == [], f"phase {s.phase}"
    assert "item_available" not in s._station_view("u1")
    s.set_phase("lobby", force=True)
    assert s.phase == "lobby"
    s.net.pushed.clear()
    s.net.simulate_utility_hello("u1")
    assert _pushed(s, "station_update", "u1") == []
    # and a station action out of play does nothing
    _action(s, clock, "u1", 5, "reset")
    assert _pushed(s, "station_update", "u1") == [] and "OPERATOR RESET · STATION #5" not in _feed(s)


def test_a_station_action_naming_another_stations_id_is_refused():
    s, clock = _sess()
    _station(s, "u1", 5, "overshield")
    _station(s, "u2", 6, "rockets")
    go = _live(s, clock)
    clock.t = go + 125_000; s.tick()
    n = len(_pushed(s, "station_update"))
    p0 = s.players[s.node_player["phone-0"]]
    _action(s, clock, "u1", 6, "taken", player_num=p0["player_num"])     # u1 claims u2's item
    assert s._station_view("u2")["item_available"] is True and "taken_by" not in s._station_view("u2")
    assert s._station_view("u1")["item_available"] is True
    assert len(_pushed(s, "station_update")) == n and not any("TOOK" in t for t in _feed(s))
    # CONTROL: the same report from the station that holds id 6 is taken
    _action(s, clock, "u2", 6, "taken", player_num=p0["player_num"])
    assert s._station_view("u2")["item_available"] is False
