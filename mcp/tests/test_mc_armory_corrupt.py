"""O2 follow-up: a corrupt armory.json must reach the console as `armory_corrupt`, not as a quietly empty armory."""
import pathlib, sys
from unittest import mock
sys.path.insert(0, str(pathlib.Path(__file__).parent))

from test_mc_state import mk

from brx_mcp import usbconsole as _uc
from brx_mcp.mc.armory import LocalArmory


def _session():
    s = mk(2)[0]
    s.armory = LocalArmory()
    return s


def test_armory_corrupt_is_in_state_after_a_corrupt_read_and_cleared_by_a_good_one():
    s = _session()
    kept = pathlib.Path("/h/armory.json.bad-20261004T010203")
    assert "armory_corrupt" not in s.snapshot()
    with mock.patch.object(_uc, "load_inventory", side_effect=_uc.InventoryCorrupt(pathlib.Path("/h/armory.json"), kept, "ValueError: bad")):
        assert s.armory.list() == []
    assert s.snapshot()["armory_corrupt"] == {"kept": str(kept), "error": "ValueError: bad"}
    # the file is gone now, so the next read is a plain empty armory: still not the real one
    with mock.patch.object(_uc, "load_inventory", return_value={}):
        s.armory.list()
    assert "armory_corrupt" in s.snapshot()
    # review r2 HIGH: re-enrolling ONE gun must not hide the warning about the many that were lost
    with mock.patch.object(_uc, "load_inventory", return_value={"S1": {"gun_name": "G1", "ble_address": "AA:BB:CC:DD:EE:FF"}}):
        assert len(s.armory.list()) == 1
    assert s.snapshot()["armory_corrupt"] == {"kept": str(kept), "error": "ValueError: bad"}
    assert s.dismiss_armory_corrupt() is True
    assert "armory_corrupt" not in s.snapshot()
    assert s.dismiss_armory_corrupt() is False


def test_a_corrupt_armory_that_could_not_be_moved_aside_reports_no_kept_path():
    s = _session()
    with mock.patch.object(_uc, "load_inventory", side_effect=_uc.InventoryCorrupt(pathlib.Path("/h/armory.json"), None, "ValueError: x")):
        s.armory.list()
    assert s.snapshot()["armory_corrupt"]["kept"] is None


def test_a_held_inventory_lock_does_not_block_the_event_loop_during_a_scan():
    """Review MEDIUM: correlate() waits on a file lock for up to 10 s; run on the loop it froze MC."""
    import asyncio, tempfile, threading, types
    from brx_mcp import storage as _st

    class _Mgr:
        async def scan(self, _d):
            return [{"name": "G1-AABB", "address": "AA:BB", "has_uart_service": True}]

    async def main(base):
        held, release = threading.Event(), threading.Event()

        def holder():
            with _uc._inventory_lock():
                held.set()
                release.wait(10)
        t = threading.Thread(target=holder); t.start()
        assert await asyncio.to_thread(held.wait, 5)
        scan = asyncio.ensure_future(LocalArmory().scan(1))
        ticks = 0
        for _ in range(10):                     # the loop keeps servicing us while correlate waits on the lock
            await asyncio.sleep(0.01)
            ticks += 1
        assert ticks == 10 and not scan.done()
        release.set()
        rows = await asyncio.wait_for(scan, 10)
        t.join()
        return rows

    base = pathlib.Path(tempfile.mkdtemp())
    with mock.patch.object(_st, "BASE_DIR", base), mock.patch.dict(sys.modules, {"brx_mcp.ble": types.SimpleNamespace(ConnectionManager=_Mgr)}):
        rows = asyncio.run(main(base))
    assert rows and rows[0]["name"] == "G1-AABB"


def test_a_corrupt_file_hit_by_correlate_during_a_scan_is_still_reported():
    """Review r2 HIGH: correlate() moves the file aside, so load_inventory then sees none; the flag must be set from correlate."""
    import asyncio, tempfile, types
    from brx_mcp import storage as _st

    class _Mgr:
        async def scan(self, _d):
            return [{"name": "G1-AABB", "address": "AA:BB", "has_uart_service": True}]
    base = pathlib.Path(tempfile.mkdtemp())
    (base / "armory.json").write_text("{corrupt", encoding="utf-8")
    a = LocalArmory()
    with mock.patch.object(_st, "BASE_DIR", base), mock.patch.dict(sys.modules, {"brx_mcp.ble": types.SimpleNamespace(ConnectionManager=_Mgr)}):
        asyncio.run(a.scan(1))
    assert a.corrupt and a.corrupt["kept"] and "armory.json.bad-" in a.corrupt["kept"]


def test_an_armory_that_kept_changing_is_reported_as_unreadable_not_empty():
    s = _session()
    with mock.patch.object(_uc, "load_inventory", side_effect=_uc.InventoryUnstable("armory.json kept changing while it was read")):
        assert s.armory.list() == []
    c = s.snapshot()["armory_corrupt"]
    assert c["unreadable"] is True and c["kept"] is None


def test_the_dismiss_route_clears_the_flag_and_is_token_gated():
    try:
        from starlette.testclient import TestClient
    except Exception:
        return
    from brx_mcp.mc.api import create_app
    s = _session()
    s.armory.corrupt = {"kept": None, "error": "x"}
    c = TestClient(create_app(s, token="tok"))
    assert c.post("/api/armory/corrupt/dismiss").status_code == 401
    assert "armory_corrupt" in c.get("/api/state").json()
    r = c.post("/api/armory/corrupt/dismiss", headers={"Authorization": "Bearer tok"})
    assert r.status_code == 200 and r.json() == {"ok": True, "dismissed": True}
    assert "armory_corrupt" not in c.get("/api/state").json()
