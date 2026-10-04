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
        real = pathlib.Path.read_bytes

        def deny(self, *a, **k):
            if self.name == "armory.json":
                raise PermissionError("denied")
            return real(self, *a, **k)
        with mock.patch.object(pathlib.Path, "read_bytes", deny):
            _raises(PermissionError, _uc.load_inventory)
        assert (base / "armory.json").exists() and not list(base.glob("armory.json.bad-*"))
    _on_base(run)


def test_a_reader_never_moves_aside_a_valid_file_that_replaced_the_corrupt_one_mid_read():
    """Review HIGH: an unlocked reader parsed the corrupt bytes, a writer atomically swapped in a valid
    armory, and the reader then quarantined the NEW file. It must read again instead."""
    def run(base):
        p = base / "armory.json"
        p.write_text("{corrupt", encoding="utf-8")
        real_loads, swapped = _uc.json.loads, []

        def loads_then_swap(text, *a, **k):
            if not swapped:
                swapped.append(1)
                _storage.atomic_write_text(p, '{"S1": {"gun_name": "NEW"}}')
            return real_loads(text, *a, **k)
        with mock.patch.object(_uc.json, "loads", loads_then_swap):
            inv = _uc.load_inventory()
        assert inv == {"S1": {"gun_name": "NEW"}}
        assert p.exists() and not list(base.glob("armory.json.bad-*"))
    _on_base(run)


def test_the_public_read_waits_for_the_inventory_lock():
    def run(base):
        held, release, done = threading.Event(), threading.Event(), threading.Event()

        def holder():
            with _uc._inventory_lock():
                held.set()
                release.wait(10)
        t = threading.Thread(target=holder); t.start()
        assert held.wait(5)
        out = []
        r = threading.Thread(target=lambda: (out.append(_uc.load_inventory()), done.set()))
        r.start()
        assert not done.wait(0.3), "load_inventory read without taking the lock"
        release.set()
        assert done.wait(5) and out == [{}]
        t.join(); r.join()
    _on_base(run)


def test_a_record_that_is_not_an_object_makes_the_file_corrupt():
    def run(base):
        (base / "armory.json").write_text('{"S1": 7}', encoding="utf-8")
        _raises(_uc.InventoryCorrupt, _uc.load_inventory)
        assert len(list(base.glob("armory.json.bad-*"))) == 1
        assert _uc.load_inventory() == {}
    _on_base(run)


def test_atomic_write_retries_a_sharing_violation_then_succeeds():
    d = pathlib.Path(tempfile.mkdtemp())
    real, calls = os.replace, []

    def flaky(src, dst):
        calls.append(1)
        if len(calls) <= 2:
            raise PermissionError("sharing violation")
        return real(src, dst)
    with mock.patch.object(os, "replace", flaky):
        _storage.atomic_write_text(d / "f.json", "{}")
    assert len(calls) == 3 and (d / "f.json").read_text() == "{}"


def test_atomic_write_gives_up_on_a_permanent_sharing_violation_and_cleans_up():
    d = pathlib.Path(tempfile.mkdtemp())
    (d / "f.json").write_text("old")

    def deny(src, dst):
        raise PermissionError("held open")
    with mock.patch.object(os, "replace", deny), mock.patch.object(_storage, "_REPLACE_BUDGET_S", 0.1):
        _raises(PermissionError, _storage.atomic_write_text, d / "f.json", "new")
    assert (d / "f.json").read_text() == "old" and [x.name for x in d.iterdir()] == ["f.json"]


def test_move_aside_never_overwrites_a_name_another_process_took():
    d = pathlib.Path(tempfile.mkdtemp())
    (d / "armory.json").write_text("bad")
    with mock.patch("time.time_ns", return_value=1_700_000_000_123_000_000):
        first = _storage.move_aside_exclusive(d / "armory.json")
        (d / "armory.json").write_text("bad2")
        taken = first                           # the very name the next call would pick
        taken.write_text("precious")
        second = _storage.move_aside_exclusive(d / "armory.json")
    assert second != taken and second.read_text() == "bad2" and taken.read_text() == "precious"
    assert not (d / "armory.json").exists()


def test_a_same_size_rewrite_with_the_same_mtime_is_not_quarantined():
    """Review r2 MEDIUM: ino/size/mtime can all match after a same-size rewrite on a coarse-timestamp
    filesystem. The bytes are what decide."""
    def run(base):
        p = base / "armory.json"
        good = '{"S1": {"gun_name": "NEW"}}'
        p.write_text("{" + "x" * (len(good) - 1), encoding="utf-8")
        st = p.stat()
        real_loads, done = _uc.json.loads, []

        def loads_then_rewrite(text, *a, **k):
            if not done:
                done.append(1)
                with open(p, "r+b") as f:       # in place: same inode, same size
                    f.write(good.encode())
                os.utime(p, ns=(st.st_atime_ns, st.st_mtime_ns))
            return real_loads(text, *a, **k)
        with mock.patch.object(_uc.json, "loads", loads_then_rewrite):
            inv = _uc.load_inventory()
        assert inv == {"S1": {"gun_name": "NEW"}} and not list(base.glob("armory.json.bad-*"))
    _on_base(run)


def test_a_file_that_keeps_changing_raises_unstable_and_is_never_moved():
    def run(base):
        p = base / "armory.json"
        p.write_text("{c0", encoding="utf-8")
        real_loads, n = _uc.json.loads, []

        def loads_then_change(text, *a, **k):
            n.append(1)
            p.write_text("{c%d" % len(n), encoding="utf-8")
            return real_loads(text, *a, **k)
        with mock.patch.object(_uc.json, "loads", loads_then_change):
            _raises(_uc.InventoryUnstable, _uc.load_inventory)
        assert p.exists() and not list(base.glob("armory.json.bad-*"))
    _on_base(run)


def test_move_aside_retries_a_sharing_violation_then_succeeds():
    d = pathlib.Path(tempfile.mkdtemp())
    (d / "armory.json").write_text("x")
    real, calls = os.replace, []

    def flaky(src, dst):
        calls.append(1)
        if len(calls) < 3:
            raise PermissionError("sharing violation")
        return real(src, dst)
    with mock.patch("os.replace", flaky):
        kept = _storage.move_aside_exclusive(d / "armory.json", budget_s=2.0)
    assert kept and kept.read_text() == "x" and len(calls) == 3 and not (d / "armory.json").exists()


def test_a_failed_move_aside_leaves_the_file_and_no_placeholder():
    d = pathlib.Path(tempfile.mkdtemp())
    (d / "armory.json").write_text("x")

    def deny(src, dst):
        raise PermissionError("locked")
    with mock.patch("os.replace", deny):
        assert _storage.move_aside_exclusive(d / "armory.json", budget_s=0.05) is None
    assert sorted(p.name for p in d.iterdir()) == ["armory.json"]


def test_the_exact_bad_bytes_are_saved_before_the_file_is_set_aside():
    def run(base):
        p = base / "armory.json"
        p.write_bytes(b"{corrupt\xff")
        e = _raises(_uc.InventoryCorrupt, _uc.load_inventory)
        assert e.kept.read_bytes() == b"{corrupt\xff" and not p.exists()
    _on_base(run)


def test_a_replacement_that_appears_just_before_the_move_is_not_quarantined():
    """Review r3 MEDIUM: the final byte-compare and the rename were not atomic with an external writer."""
    def run(base):
        p = base / "armory.json"
        p.write_text("{corrupt", encoding="utf-8")
        real_read, calls = pathlib.Path.read_bytes, []

        def read_bytes(self):
            data = real_read(self)
            if self == p:
                calls.append(1)
                if len(calls) == 2:       # the validator's re-read: still bad. Then a writer replaces it.
                    _storage.atomic_write_text(p, '{"S1": {"gun_name": "NEW"}}')
            return data
        with mock.patch.object(pathlib.Path, "read_bytes", read_bytes):
            inv = _uc.load_inventory()
        assert inv == {"S1": {"gun_name": "NEW"}}
        assert p.exists() and not list(base.glob("armory.json.bad-*")) and not _uc.read_corrupt_notice()
    _on_base(run)


def test_a_replacement_between_the_rename_and_the_verify_is_put_back():
    def run(base):
        p = base / "armory.json"
        p.write_bytes(b"{bad")
        real_replace, n = _storage._replace_with_retry, []

        def replace(src, dst, budget_s=None):
            real_replace(src, dst, budget_s)
            if not n:                     # a late writer's bytes are what the rename actually moved
                n.append(1)
                pathlib.Path(dst).write_bytes(b'{"S1": {"gun_name": "LATE"}}')
        with mock.patch.object(_storage, "_replace_with_retry", replace):
            inv = _uc.load_inventory()
        assert inv == {"S1": {"gun_name": "LATE"}}
        assert not list(base.glob("armory.json.bad-*"))
    _on_base(run)
