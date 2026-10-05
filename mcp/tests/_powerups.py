"""Shared helpers for the powerup-station tests (test_mc_powerups, test_mc_clock_step)."""
from __future__ import annotations

import random

from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
from brx_mcp.mc.compile import Compiler
from brx_mcp.mc.state import Session


class PowerupClock:
    def __init__(self, t: int = 1_800_000_000_000):
        self.t = t

    def __call__(self) -> int:
        return self.t


def powerup_session(powerups: bool = True, n: int = 2):
    clock = PowerupClock()
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


def powerup_station(s, nid: str, sid: int, preset: str | None = None, kind: str = "powerup"):
    s.net.simulate_utility_hello(nid)
    body: dict = {"kind": kind, "team": "any", "id": sid}
    if preset is not None:
        body["item_preset"] = preset
    return s.set_station(nid, body)


def powerup_live(s, clock, runway_s=3):
    s.push_config(force=True)
    s.start(runway_s=runway_s, force=True)
    s.tick()
    return s.start_info["go_live_t"]


def powerup_pickup(s, clock, sid, kind="overshield", nid="phone-0", seq=1, **extra):
    p = s.players[s.node_player[nid]]
    ev = {"type": "pickup", "t": clock.t, "match_id": s.start_info["match_id"], "node_id": nid,
          "player_id": p["player_id"], "station_id": sid, "item_kind": kind, "seq": seq, **extra}
    s.net.simulate_event(nid, ev, clock.t)


def powerup_action(s, clock, nid, sid, action, **extra):
    s.net.simulate_node_message(nid, "station_action", {"id": sid, "action": action, "t": clock.t, **extra}, clock.t)


def powerup_feed(s):
    return [r["text"] for r in s.feed]
