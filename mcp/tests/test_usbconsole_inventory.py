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




def test_a_json_value_that_is_not_an_object_is_corrupt_too():
    def run(base):
        (base / "armory.json").write_text("[1, 2]", encoding="utf-8")
        _raises(_uc.InventoryCorrupt, _uc.load_inventory)
        (base / "armory.json").write_text('{"S1": 7}', encoding="utf-8")      # a non-dict record
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


# ---- redesign: a read never moves the live file; only DISMISS does ----
_BAD = b'{"S1": {"gun_name": "A"\xff'          # half-written, and not even UTF-8


def _bad_backups(base):
    return sorted(base.glob("armory.json.bad-*"))


def test_a_corrupt_read_leaves_the_live_file_in_place_and_raises():
    def run(base):
        p = base / "armory.json"
        p.write_bytes(_BAD)
        before = p.stat()
        e = _raises(_uc.InventoryCorrupt, _uc.load_inventory)
        assert p.read_bytes() == _BAD and p.stat().st_ino == before.st_ino, "the read touched the live file"
        assert e.kept in _bad_backups(base) and str(e.kept) in str(e)
        assert not list(base.glob("*.moving")) and not list(base.glob("*.raced"))
        _raises(_uc.InventoryCorrupt, _uc.load_inventory)       # and again: still in place
        assert p.read_bytes() == _BAD
    _on_base(run)


def test_the_backup_is_an_exact_copy_with_mode_0600():
    def run(base):
        (base / "armory.json").write_bytes(_BAD)
        old = os.umask(0o022)
        try:
            e = _raises(_uc.InventoryCorrupt, _uc.load_inventory)
        finally:
            os.umask(old)
        assert e.kept.read_bytes() == _BAD
        if sys.platform != "win32":
            assert (e.kept.stat().st_mode & 0o777) == 0o600
            assert (_uc.corrupt_notice_path().stat().st_mode & 0o777) == 0o600
        n = _uc.read_corrupt_notice()
        assert n["kept"] == str(e.kept) and "Error" in n["error"]
    _on_base(run)


def test_repeated_corrupt_reads_make_one_backup_and_a_changed_file_makes_another():
    def run(base):
        p = base / "armory.json"
        p.write_bytes(_BAD)
        for _ in range(4):
            _raises(_uc.InventoryCorrupt, _uc.load_inventory)
        assert len(_bad_backups(base)) == 1
        p.write_bytes(b"{other")
        _raises(_uc.InventoryCorrupt, _uc.load_inventory)
        assert len(_bad_backups(base)) == 2
    _on_base(run)


def test_every_write_op_refuses_while_the_file_is_corrupt_and_changes_nothing():
    def run(base):
        p = base / "armory.json"
        p.write_bytes(_BAD)
        ops = [lambda: _uc.add_to_inventory(_rec("S2")),
               lambda: _uc.correlate([{"name": "G-AABB", "address": "AA:BB"}]),
               lambda: _uc.bind_address("S1", "AA:BB"),
               lambda: _uc.mark_rename("New", serial="S1")]
        for op in ops:
            _raises(_uc.InventoryCorrupt, op)
            assert p.read_bytes() == _BAD, "a write op changed the corrupt armory"
        assert not list(base.glob("*.tmp"))
    _on_base(run)


def test_a_missing_file_is_empty_and_writes_no_notice_or_backup():
    def run(base):
        assert _uc.load_inventory() == {} and _uc.read_corrupt_notice() is None and not _bad_backups(base)
        _uc.add_to_inventory(_rec("S1"))
        _uc.load_inventory()
        assert _uc.read_corrupt_notice() is None and not _bad_backups(base)    # no stale notice from a good read
    _on_base(run)


def test_dismiss_moves_a_still_corrupt_file_aside_and_writes_work_again():
    def run(base):
        p = base / "armory.json"
        p.write_bytes(_BAD)
        _raises(_uc.InventoryCorrupt, _uc.load_inventory)
        assert _uc.dismiss_corrupt_inventory() is True
        assert not p.exists() and _uc.read_corrupt_notice() is None
        moved = list(base.glob("armory.json.dismissed-*"))
        assert len(moved) == 1 and moved[0].read_bytes() == _BAD
        _uc.add_to_inventory(_rec("S2"))
        assert set(_uc.load_inventory()) == {"S2"}
    _on_base(run)


def test_dismiss_keeps_the_permissions_of_the_file_it_moves():
    if sys.platform == "win32":
        return
    def run(base):
        p = base / "armory.json"
        p.write_bytes(_BAD)
        os.chmod(p, 0o600)
        _uc.dismiss_corrupt_inventory()
        (moved,) = base.glob("armory.json.dismissed-*")
        assert (moved.stat().st_mode & 0o777) == 0o600
    _on_base(run)


def test_dismiss_does_not_move_a_file_that_became_valid_and_clears_the_notice():
    def run(base):
        p = base / "armory.json"
        p.write_bytes(_BAD)
        _raises(_uc.InventoryCorrupt, _uc.load_inventory)
        assert _uc.read_corrupt_notice()
        _storage.atomic_write_text(p, '{"S1": {"gun_name": "FIXED"}}')       # restored by hand
        assert _uc.dismiss_corrupt_inventory() is False
        assert p.read_text(encoding="utf-8") == '{"S1": {"gun_name": "FIXED"}}'
        assert not list(base.glob("armory.json.dismissed-*")) and _uc.read_corrupt_notice() is None
    _on_base(run)


def test_a_failed_dismiss_move_raises_and_keeps_the_file_and_the_notice():
    def run(base):
        p = base / "armory.json"
        p.write_bytes(_BAD)
        _raises(_uc.InventoryCorrupt, _uc.load_inventory)

        def deny(src, dst):
            raise PermissionError("locked")
        with mock.patch("os.replace", deny), mock.patch.object(_storage, "_REPLACE_BUDGET_S", 0.05):
            _raises(OSError, _uc.dismiss_corrupt_inventory)
        assert p.read_bytes() == _BAD and _uc.read_corrupt_notice()
        assert not list(base.glob("armory.json.dismissed-*"))
    _on_base(run)


def test_r5_a_corrupt_record_never_names_its_key():
    """Review round 5: armory keys are headset PINs, and the corruption text reaches /api/state (no token)."""
    def run(base):
        (base / "armory.json").write_text('{"PIN-4821": 7}', encoding="utf-8")
        try:
            _uc.load_inventory()
        except _uc.InventoryCorrupt as e:
            assert "4821" not in str(e) and "4821" not in e.error, str(e)
        else:
            raise AssertionError("a non-object record must be corrupt")
    _on_base(run)
