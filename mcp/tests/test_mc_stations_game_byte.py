"""One game byte for a match: the `config` every player phone receives carries `game_byte`, and it is the
SAME number MC arms its stations with (`station_config.game`).

Shipped broken in app 0.4.10: MC armed stations with `_game_byte()` (the match counter) while player phones
hashed their `config_id`, and `beacon.js Presence` drops a non-zero game byte that differs. So every
MC-armed respawn, hill and pickup station and every player ignored each other; only a hand-armed game-0
station worked. These tests drive MC's real push paths (muster push, re-push, hello, restart, next match)
and read the phone's byte through the phone's own helper (`beacon.js configGameByte`) where node exists.
"""
from __future__ import annotations

import json
import pathlib
import shutil
import subprocess
import tempfile

from brx_mcp.mc.compile import Compiler
from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
from brx_mcp.mc.state import Session

REPO = pathlib.Path(__file__).resolve().parents[2]
NODE = shutil.which("node")


def _sess(**cfg):
    s = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()))
    s.set_config({"mode": "tdm", "respawn": {"type": "scanner", "delay_s": 15}, **cfg})
    guns = [g["gun_id"] for g in s.armory.list()][:2]
    teams = [t["team_id"] for t in s.config["teams"]]
    for i, g in enumerate(guns):
        s.add_player(f"P{i}", teams[i % len(teams)], g, "male")
    for i, p in enumerate(s.players.values()):
        s.net.simulate_hello(f"phone-{i}", p["gun_id"])
    s.net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "respawn", "team": "any", "id": 3})
    return s


def _last(s, kind, nid=None):
    rows = [b for n, k, b in s.net.pushed if k == kind and (nid is None or n == nid)]
    assert rows, f"no {kind} pushed"
    return rows[-1]


def _phone_byte(config: dict) -> int:
    """The byte the PHONE scopes by, read through the phone's own helper when node exists."""
    if NODE:
        js = ("import { configGameByte } from %s;\n"
              "process.stdout.write(String(configGameByte(JSON.parse(process.argv[1]))));"
              % json.dumps((REPO / "app/src/beacon.js").as_uri()))
        out = subprocess.run([NODE, "--input-type=module", "-e", js, json.dumps(config)],
                             capture_output=True, text=True, timeout=30)
        assert out.returncode == 0, out.stderr[-400:]
        return int(out.stdout)
    b = config.get("game_byte")        # the pinned equivalent of beacon.js configGameByte
    return b if isinstance(b, int) and not isinstance(b, bool) and 1 <= b <= 255 else 0


def _assert_same(s, where: str):
    station = _last(s, "station_config", "util-1")["game"]
    for i in range(2):
        cfg = _last(s, "config", f"phone-{i}")["config"]
        assert cfg.get("game_byte") == station, f"{where}: phone-{i} config game_byte {cfg.get('game_byte')} != station {station}"
        assert _phone_byte(cfg) == station, f"{where}: the phone's helper reads {_phone_byte(cfg)}, station armed {station}"
    return station


def test_the_muster_push_gives_phones_and_stations_one_game_byte():
    s = _sess()
    s.push_config(force=True)
    assert _assert_same(s, "first push") == 1
    # a re-push at muster (an edit) is the same match: same byte on both sides
    s.push_config(force=True)
    assert _assert_same(s, "re-push") == 1
    # CONTROL: the helper does not just echo whatever it is handed; a config with no byte reads 0 (any game)
    assert _phone_byte({"config_id": "abc"}) == 0


def test_a_hello_after_the_push_hydrates_the_same_byte_the_station_holds():
    s = _sess()
    s.push_config(force=True)
    p = next(iter(s.players.values()))
    node = s.net.simulate_hello("phone-0", p["gun_id"])      # a reconnect / late hello: welcome.node
    assert node and node["config"]["game_byte"] == _last(s, "station_config", "util-1")["game"]


def test_a_second_match_bumps_the_byte_on_both_sides_together():
    s = _sess()
    s.push_config(force=True)
    s.start(runway_s=3, force=True)
    live = _assert_same(s, "match 1")
    s.control("end")
    s.next_match()                     # the operator's NEXT MATCH: roll forward, then LOAD
    s.push_config(force=True)          # the muster push for match 2
    second = _assert_same(s, "match 2")
    assert second == live + 1, f"match 2 must be a new game byte: {live} -> {second}"
    # and the direct path (END, then a push from RECAP) agrees too
    s.start(runway_s=3, force=True)
    s.control("end")
    s.push_config(force=True)
    assert _assert_same(s, "match 3") == second + 1


def test_a_restart_restores_the_byte_for_phones_and_stations_alike():
    s = _sess()
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s.push_config(force=True)
    s.start(runway_s=3, force=True)
    s.control("end")
    s.push_config(force=True)                      # match 2's byte is on the field
    armed = _assert_same(s, "before restart")
    s._persist_last = 0.0
    s._persist()
    s2 = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()))
    s2._persist_path = s._persist_path
    s2.restore_snapshot()
    s2.net.simulate_utility_hello("util-1")
    station = _last(s2, "station_config", "util-1")["game"]
    assert station == armed, f"the restarted MC re-armed the station with {station}, not {armed}"
    # the phones still hold the pre-restart config (byte `armed`); whatever MC sends them next agrees
    assert s2._wire_config()["game_byte"] == station
    for i, p in enumerate(s2.players.values()):
        node = s2.net.simulate_hello(f"phone-{i}", p["gun_id"])
        if node and "config" in node:
            assert node["config"]["game_byte"] == station
    s2.push_config(force=True)                     # the operator re-pushes after the restart: same match
    assert _assert_same(s2, "after restart") == armed
