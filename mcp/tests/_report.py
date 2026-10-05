"""Shared fixtures for the bug-report zip tests: one scrubbed-evidence builder and its fake secrets.

Moved out of `test_mc_report.py` (A19) so `test_launcher.py` does not import a test module.
"""
import json
import zipfile
from pathlib import Path

from brx_mcp.mc.store import Store


def make_evidence(root: Path, close: bool = True) -> tuple[Path, Path, Store]:
    ev = root / "sessions" / "launch-abc"
    ev.mkdir(parents=True)
    armory = root / "armory.json"
    armory.write_text(json.dumps({PIN: {"serial_head_pin": PIN, "gun_name": ARMORY_STICKER,
                                        "ble_address": BLE_ADDR}}), encoding="utf-8")
    st = Store("abc12345", ev / "session.sqlite")
    st.log("node-1", "hello", 1, 1000, 1000, None, False,
           {"node_id": "node-1", "app_ver": "0.3.0", "platform": "android", "node_key": NODE_KEY,
            "gun": {"name": f"{STICKER}-1A2B", "tail": "1A2B"}})
    st.log("node-1", "status", 2, 2000, 2000, "m1", False,
           {"player_id": "p1", "display": NAMES[0], "gun_id": PIN, "hp": 45, "mc_url": f"ws://{LAN}:8766/ws",
            "preflight": {"ssid": SSID, "gun_linked": True}})
    chunk = (f"12:00:01 connected to {ARMORY_STICKER} at {LOG_MAC}\n"
             f"12:00:02 {{\"phase\":\"live\",\"player\":{{\"display\":\"{NAMES[1]}\"}}}}\n"
             f"12:00:03 link {LAN6} tok={TOKEN}\n")
    st.log("node-1", "log_data", 3, 3000, 3000, "m1", False, {"node_id": "node-1", "seq": 0, "chunk": chunk, "last": True})
    st.match_started("m1", {"mode": "tdm", "_heads": {"p1": ["$PSET,1,45,70,*"]}}, 1500)
    st.match_ended("m1", {"rows": [{"player_id": "p1", "display": NAMES[0]}], "winner": {}})
    (ev / "mc.log").write_text(
        f"Mission Control  http://{LAN}:8765/#tok={TOKEN}\n"
        f"  operator token: {TOKEN}\n"
        f"  backhaul: up  wss://{TUNNEL}/ws\n"
        f"  gun {ARMORY_STICKER} ({BLE_ADDR}) bound to {NAMES[1]}\n"
        f"Traceback:\n  File \"{HOME}/gitrepos/open-brx/mcp/brx_mcp/mc/state.py\", line 1\n"
        f"  File \"{OTHER_HOME}\", line 2\n", encoding="utf-8")
    (ev / "manifest.json").write_text(json.dumps({
        "launch_id": "launch-abc", "status": "crashed", "repo": f"{HOME}/gitrepos/open-brx",
        "evidence_dir": str(ev), "url": f"http://{LAN}:8765/"}), encoding="utf-8")
    if close:
        st.close()
    return ev, armory, st


def members(zip_path: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(zip_path) as zf:
        return {n: zf.read(n) for n in zf.namelist()}


def assert_clean(files: dict[str, bytes]):
    for name, data in files.items():
        text = data.decode("utf-8", errors="replace").lower()
        for raw in raw_values():
            assert raw.lower() not in text, f"{raw!r} survived in {name}"


ARMORY_STICKER = "KESTREL7"                 # a sticker only the armory knows


BLE_ADDR = "C4:DE:E2:19:A0:7F"


HOME = str(Path.home())


LAN = "192.168.44.17"


LAN6 = "fe80::1c2b:3d4e:5f60:7182"


LOG_MAC = "AA:BB:CC:11:22:33"


NAMES = ["MAVERICKX", "GHOSTRIDER"]


NODE_KEY = "nk-4f5e6d7c8b9a"


OTHER_HOME = "/home/someoneelse/project/x.py"


PIN = "884211"


SSID = "HomeNet-5G"


STICKER = "R" + "0B" + "ZQ"                 # the pattern-shaped sticker (not from the armory)


TOKEN = "Zx9secretTok"


TUNNEL = "brave-otter-lake.trycloudflare.com"


def raw_values():
    return [STICKER, ARMORY_STICKER, PIN, BLE_ADDR, LOG_MAC, *NAMES, LAN, LAN6, TUNNEL, TOKEN, NODE_KEY, SSID,
            "someoneelse", HOME]
