"""O2 (operator review 2026-10-03): armory.json holds every gun's headset PIN and BLE binding. It was
read-merge-written with no lock, written non-atomically, and a corrupt read returned `{}`, so the next
merge rewrote the whole armory as one gun."""
import contextlib, os, pathlib, sys, tempfile, threading
from unittest import mock
sys.path.insert(0, str(pathlib.Path(__file__).parent))

from brx_mcp import storage as _storage
from brx_mcp import usbconsole as _uc


def _raises(exc_type, fn, *a):
    try:
        fn(*a)
    except exc_type as e:
        return e
    raise AssertionError(f"{exc_type.__name__} not raised")


def _on_base(fn):
    """Run `fn(base_dir)` against a throwaway armory folder (the plain runner has no fixtures)."""
    d = pathlib.Path(tempfile.mkdtemp())
    with mock.patch.object(_storage, "BASE_DIR", d):
        return fn(d)


def _rec(serial, name="G"):
    return {"serial_head_pin": serial, "gun_name": name}


def test_a_corrupt_armory_raises_and_is_kept_aside_never_read_as_empty():
    def run(base):
        (base / "armory.json").write_text('{"S1": {"gun_name": "A"', encoding="utf-8")    # half-written
        e = _raises(_uc.InventoryCorrupt, _uc.load_inventory)
        kept = list(base.glob("armory.json.bad-*"))
        assert len(kept) == 1 and kept[0].read_text(encoding="utf-8") == '{"S1": {"gun_name": "A"'
        assert str(kept[0]) in str(e) and "armory.json" in str(e)
    _on_base(run)


def test_a_merge_into_a_corrupt_armory_never_rewrites_it_as_one_gun():
    def run(base):
        original = "{not json"
        (base / "armory.json").write_text(original, encoding="utf-8")
        _raises(_uc.InventoryCorrupt, _uc.add_to_inventory, _rec("S2"))
        kept = list(base.glob("armory.json.bad-*"))
        assert len(kept) == 1 and kept[0].read_text(encoding="utf-8") == original
        assert not (base / "armory.json").exists(), "a one-gun armory replaced the corrupt one"
    _on_base(run)


def test_a_json_value_that_is_not_an_object_is_corrupt_too():
    def run(base):
        (base / "armory.json").write_text("[1, 2]", encoding="utf-8")
        _raises(_uc.InventoryCorrupt, _uc.load_inventory)
    _on_base(run)


def test_a_missing_armory_is_empty_not_corrupt():
    def run(base):
        assert _uc.load_inventory() == {}
    _on_base(run)


def test_a_crash_between_the_temp_write_and_the_rename_leaves_the_old_armory():
    def run(base):
        _uc.add_to_inventory(_rec("S1", "Old"))
        before = (base / "armory.json").read_text(encoding="utf-8")

        def boom(src, dst):
            raise OSError("disk went away")
        with mock.patch.object(os, "replace", boom):
            _raises(OSError, _uc.add_to_inventory, _rec("S1", "New"))
        assert (base / "armory.json").read_text(encoding="utf-8") == before
        assert not list(base.glob("*.tmp")), "a temp file was left behind"
    _on_base(run)


def test_the_read_merge_write_waits_for_the_lock():
    def run(base):
        _uc.add_to_inventory(_rec("S1"))
        done = threading.Event()

        def writer():
            _uc.add_to_inventory(_rec("S2"))
            done.set()

        with _uc._inventory_lock():
            t = threading.Thread(target=writer, daemon=True)
            t.start()
            assert not done.wait(0.4), "add_to_inventory wrote while another writer held the lock"
        assert done.wait(5), "add_to_inventory never ran after the lock was released"
        assert set(_uc.load_inventory()) == {"S1", "S2"}
    _on_base(run)


def test_concurrent_writers_lose_no_gun():
    def run(base):
        def add(n):
            for i in range(15):
                _uc.add_to_inventory(_rec(f"S{n}-{i}"))
        threads = [threading.Thread(target=add, args=(n,)) for n in range(4)]
        for t in threads: t.start()
        for t in threads: t.join(30)
        assert len(_uc.load_inventory()) == 60
    _on_base(run)


def test_an_unreadable_but_valid_armory_is_not_moved_aside():
    def run(base):
        """A PermissionError or a sharing violation is not corruption: raise it, leave the file where it is."""
        _uc.add_to_inventory(_rec("S1"))
        real = pathlib.Path.read_text

        def deny(self, *a, **k):
            if self.name == "armory.json":
                raise PermissionError("denied")
            return real(self, *a, **k)
        with mock.patch.object(pathlib.Path, "read_text", deny):
            _raises(PermissionError, _uc.load_inventory)
        assert (base / "armory.json").exists() and not list(base.glob("armory.json.bad-*"))
    _on_base(run)
