"""H8: the M5StickS3 as a Wi-Fi utility node (docs/spec/utility.md §5g). MC has never seen a real
esp32 station -- everything in `state.py`/`envelope.py` that "already admits it" (§5g.1) was proven
only against a phone's `utility.js`. This test drives MC's `Session` with the EXACT hello/status
JSON `hardware/m5sticks3/station_link.h` builds, not a hand-typed approximation of it: the strings
come from compiling and running `hardware/m5sticks3/test/test_link.cpp` in its golden-dump mode
(see that file's `main`), so a change to the C++ builder that drifted from the wire contract would
fail here even though `test_sticks3_core.py`'s own checks stayed green (they pin the builder to
itself, not to what MC accepts).

Skips when there is no g++, exactly like `test_sticks3_core.py`.

`station_config.item` / `station_update` (A56, docs/spec/powerups.md, confirmed 2026-09-24) are
NOT exercised against a real Session here: MC does not implement either yet (`item` never rides in
`_arm_station`'s pushed body, and `station_update` is not in `types.MC_KINDS` -- grep finds nothing,
2026-09-24), so there is nothing on the MC side to prove. The Stick's own parsing and storage of
both is host-tested in `hardware/m5sticks3/test/test_link.cpp` instead.
"""
from __future__ import annotations

import json
import pathlib
import shutil
import subprocess
import tempfile

from _skip import needs

from brx_mcp.mc import envelope as E
from brx_mcp.mc.compile import Compiler
from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
from brx_mcp.mc.state import Session

ROOT = pathlib.Path(__file__).resolve().parents[2]
CORE = ROOT / "hardware" / "m5sticks3"
LINK_TEST = CORE / "test" / "test_link.cpp"
GXX = shutil.which("g++")


def _sess():
    s = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()))
    s.set_config({"mode": "tdm"})
    return s


def _hydrate_utility_hello(s: Session, node_id: str, body: dict) -> dict | None:
    """What `FakeNet.simulate_utility_hello` does internally, but driven by an arbitrary decoded
    hello BODY instead of one it builds itself -- `simulate_utility_hello`'s own signature has no
    way to pass `platform`, which is exactly the field this test needs to prove MC captures from a
    real esp32 hello (utility.md §5g.1: "`platform` SHOULD be `esp32`... so the ITEMS panel can
    tell an operator which of their items is a phone and which is a box")."""
    node = s.net._hydrate(body) if s.net._hydrate else None
    s.net._seen.add(node_id)
    info = {"node_id": node_id, "node_type": "utility", "app_ver": body.get("app_ver")}
    for cb in s.net._cb["node"]:
        cb(info)
    return node


def _goldens() -> dict[str, dict]:
    """Compile and run test_link.cpp's golden-dump mode; return {name: decoded envelope}."""
    needs(GXX, "g++")
    assert LINK_TEST.exists(), f"{LINK_TEST} is missing"
    with tempfile.TemporaryDirectory() as build_dir, tempfile.TemporaryDirectory() as out_dir:
        exe = pathlib.Path(build_dir) / "test_link"
        build = subprocess.run(
            [GXX, "-std=c++17", "-Wall", "-Wextra", "-Werror", f"-I{CORE}", str(LINK_TEST), "-o", str(exe)],
            capture_output=True, text=True, timeout=120,
        )
        assert build.returncode == 0, f"g++ failed:\n{build.stdout}\n{build.stderr}"
        run = subprocess.run([str(exe), out_dir], capture_output=True, text=True, timeout=60)
        assert run.returncode == 0, f"golden dump failed:\n{run.stdout}\n{run.stderr}"
        out = {}
        for f in pathlib.Path(out_dir).glob("*.json"):
            text = f.read_text(encoding="utf-8")
            # CONTROL: every golden the firmware would send must itself be a wire-valid envelope --
            # the same validator MC runs on a real socket (envelope.py's whole job).
            out[f.stem] = E.decode(text, direction="node")
        return out


def test_the_goldens_are_wire_valid_and_cover_what_this_test_needs():
    g = _goldens()
    assert set(g) == {"hello", "hello_rekeyed", "status_respawn", "status_control"}, g.keys()
    assert g["hello"]["kind"] == "hello" and "node_key" not in g["hello"]["body"]
    assert g["hello_rekeyed"]["body"]["node_key"] == "wk-h8-demo-1"


def test_an_esp32_hello_is_a_utility_node_never_hydrated_as_a_player():
    g = _goldens()
    s = _sess()
    body = g["hello"]["body"]
    node_id = body["node_id"]
    assert body["node_type"] == "utility"
    node = _hydrate_utility_hello(s, node_id, body)
    assert node is None, "no welcome.node: an esp32 station is not hydrated as a player"
    assert node_id in s.stations and s.stations[node_id]["assigned"] is None
    assert node_id not in s.node_player


def test_the_items_panel_shows_it_as_esp32_with_the_sketchs_app_ver():
    """utility.md §5g.1: `platform` SHOULD be `esp32` so the ITEMS panel can tell a box from a
    phone with no second field. Nothing before this test ever fed MC a hello that claimed it."""
    g = _goldens()
    s = _sess()
    body = g["hello"]["body"]
    node_id = body["node_id"]
    _hydrate_utility_hello(s, node_id, body)
    view = next(v for v in s.snapshot()["stations"] if v["node_id"] == node_id)
    assert view["platform"] == "esp32", view
    assert view["app_ver"] == body["app_ver"], view
    assert view["online"] is True


def test_mc_arms_the_esp32_station_exactly_like_a_phone():
    """A13.5/F104: `set_station` + `_arm_station` push `station_config` to ANY utility node, phone
    or box, by the same path (utility.md §5g.1: "reaches it by the same three paths it reaches a
    phone"). This is the first time that claim is checked against a hello an esp32 actually sends."""
    g = _goldens()
    s = _sess()
    body = g["hello"]["body"]
    node_id = body["node_id"]
    _hydrate_utility_hello(s, node_id, body)
    v = s.set_station(node_id, {"kind": "respawn", "team": "blue", "id": 3, "threshold": -70})
    pushed = [b for n, k, b in s.net.pushed if k == "station_config" and n == node_id]
    assert pushed and pushed[-1] == {"kind": "respawn", "team": 1, "id": 3, "threshold": -70,
                                      "game": 1, "valid_ids": [3], "lock_s": 0}, pushed
    assert v["armed"]["game"] == 1 and v["attention"] == []
    # And what MC just sent is itself a wire-valid station_config (the 2026-09-07 `alert` lesson).
    E.validate(E.make_envelope("station_config", pushed[-1]), direction="mc")


def test_the_esp32_status_heartbeat_updates_the_stations_report():
    g = _goldens()
    s = _sess()
    hello = g["hello"]["body"]
    node_id = hello["node_id"]
    _hydrate_utility_hello(s, node_id, hello)
    s.set_station(node_id, {"kind": "respawn", "team": "blue", "id": 3, "threshold": -74})
    status_body = g["status_respawn"]["body"]
    assert status_body["node_id"] == node_id
    s.net.simulate_status(node_id, status_body, s.now_ms() + 1)
    view = s._station_view(node_id)
    assert view["report"]["kind"] == "respawn"
    assert view["report"]["station_id"] == 3
    assert view["report"]["threshold"] == -74
    assert view["report"]["live"] is True
    assert view["report"]["armed"] is True
    assert view["report"]["battery"] == 81
    assert view["attention"] == [], view["attention"]


def test_the_esp32_control_kind_status_carries_owner_and_progress():
    g = _goldens()
    s = _sess()
    hello = g["hello"]["body"]
    node_id = hello["node_id"]
    _hydrate_utility_hello(s, node_id, hello)
    s.set_station(node_id, {"kind": "control", "team": "any", "id": 9})
    status_body = g["status_control"]["body"]
    assert status_body["kind"] == "control" and status_body["station_id"] == 9
    s.net.simulate_status(node_id, status_body, s.now_ms() + 1)
    report = s._station_view(node_id)["report"]
    assert report["control"] == {"owner": 1, "progress": 50, "contested": False}, report


def test_a_re_hello_with_a_held_node_key_is_still_a_wire_valid_hello():
    """A8.2: the node_key from `welcome` rides on the NEXT hello (a reconnect, or a `held` station
    re-associating mid-match). This only proves the envelope is well-formed and MC's hydrate path
    does not choke on the extra field -- the socket-level 4003 in_use re-claim check lives in
    NetServer, not Session, and is out of scope for a FakeNet-driven test."""
    g = _goldens()
    s = _sess()
    body = g["hello_rekeyed"]["body"]
    node_id = body["node_id"]
    assert body["node_key"] == "wk-h8-demo-1"
    node = _hydrate_utility_hello(s, node_id, body)
    assert node is None
    assert node_id in s.stations
