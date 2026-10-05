"""O16: every persistent-state writer goes through `storage.atomic_write_text`.

Two kinds of test. Per caller: a crash while the file is renamed into place leaves the OLD file byte for
byte, and no temp file behind. And a guard: no new bare `write_text(` / `open(.., "w")` on a state path
may appear in brx_mcp outside the helper (break it: add `p.write_text("x")` to any module and it fails).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import stat
import sys
import tempfile
from pathlib import Path

from brx_mcp import storage, usbconsole
from brx_mcp.mc import favourites, mcid, pieces
from brx_mcp.mc.tunnel import Tunnel


def _tmp() -> Path:
    return Path(tempfile.mkdtemp(prefix="brx-atomic-test-"))


class _Crash:
    """Make the final rename fail, as a power cut or a locked file would."""

    def __enter__(self):
        self.real = storage._replace_with_retry

        def boom(*_a, **_k):
            raise OSError("power cut")
        storage._replace_with_retry = boom
        return self

    def __exit__(self, *_exc):
        storage._replace_with_retry = self.real
        return False


def _intact(path: Path, before: bytes, folder: Path) -> None:
    assert path.read_bytes() == before, "the crash damaged the old file"
    assert sorted(p.name for p in folder.iterdir()) == [path.name], "a temp file was left behind"


def test_favourites_crash_keeps_the_old_file():
    d = _tmp()
    try:
        store = favourites.FavouriteStore(d / "fav.json")
        store._save()
        before = (d / "fav.json").read_bytes()
        store._rows = [{"favourite_id": "x"}]  # type: ignore[list-item]
        with _Crash():
            try:
                store._save()
                assert False, "no crash"
            except OSError:
                pass
        _intact(d / "fav.json", before, d)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_pieces_crash_keeps_the_old_file():
    d = _tmp()
    try:
        store = pieces.PieceStore(d / "pieces.json")
        store._save()
        before = (d / "pieces.json").read_bytes()
        store._rows = [{"piece_id": "x"}]  # type: ignore[list-item]
        with _Crash():
            try:
                store._save()
                assert False, "no crash"
            except OSError:
                pass
        _intact(d / "pieces.json", before, d)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_known_devices_registry_crash_keeps_the_old_file():
    d = _tmp()
    real_path, real_dirs = storage.REGISTRY_PATH, storage.ensure_dirs
    try:
        storage.REGISTRY_PATH = d / "known-devices.json"
        storage.ensure_dirs = lambda: None
        storage.save_device("AA:BB", alias="one")
        before = storage.REGISTRY_PATH.read_bytes()
        with _Crash():
            try:
                storage.save_device("CC:DD", alias="two")
                assert False, "no crash"
            except OSError:
                pass
        _intact(storage.REGISTRY_PATH, before, d)
        assert json.loads(before)["devices"][0]["address"] == "AA:BB"
    finally:
        storage.REGISTRY_PATH, storage.ensure_dirs = real_path, real_dirs
        shutil.rmtree(d, ignore_errors=True)


def test_tunnel_pid_file_crash_keeps_the_old_file():
    d = _tmp()
    try:
        t = Tunnel(ws_port=9, pid_dir=d)
        t._write_pid(111)
        before = t.pid_path.read_bytes()
        with _Crash():
            t._write_pid(222)                      # swallows the error by design: a pid file never stops the tunnel
        _intact(t.pid_path, before, d)
        assert json.loads(before)["pid"] == 111
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_mcid_crash_keeps_the_old_list_and_new_files_stay_private():
    d = _tmp()
    try:
        lst = d / mcid.ENROLLED_FILE
        lst.write_text("node-aa\n", encoding="utf-8")
        before = lst.read_bytes()
        with _Crash():
            try:
                mcid.load_install_secret(d)
                assert False, "no crash"
            except OSError:
                pass
        _intact(lst, before, d)
        mcid.load_install_secret(d)
        if sys.platform != "win32":
            for name in (mcid.ENROLLED_FILE, mcid.SECRET_FILE):
                assert stat.S_IMODE((d / name).stat().st_mode) == 0o600, name
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_device_backup_crash_keeps_the_old_file():
    d = _tmp()
    real = usbconsole.backup_dir
    try:
        usbconsole.backup_dir = lambda: d
        path = usbconsole.save_backup({"serial_head_pin": "S1", "raw": "old"})
        assert path is not None
        before = path.read_bytes()
        with _Crash():
            try:
                usbconsole.save_backup({"serial_head_pin": "S1", "raw": "new"})
                assert False, "no crash"
            except OSError:
                pass
        _intact(path, before, d)
    finally:
        usbconsole.backup_dir = real
        shutil.rmtree(d, ignore_errors=True)


def test_an_existing_file_keeps_its_mode_and_a_new_one_gets_the_umask_default():
    if sys.platform == "win32":
        return
    d = _tmp()
    try:
        p = d / "f.json"
        p.write_text("old")
        os.chmod(p, 0o644)
        storage.atomic_write_text(p, "new")
        assert p.read_text() == "new" and stat.S_IMODE(p.stat().st_mode) == 0o644
        old = os.umask(0o022)
        real_umask = os.umask

        def no_umask(*_a):
            raise AssertionError("a write must not touch the process-wide umask")
        os.umask = no_umask
        try:
            storage.atomic_write_text(d / "fresh", "x")
        finally:
            os.umask = real_umask
            os.umask(old)
        assert stat.S_IMODE((d / "fresh").stat().st_mode) == 0o644
        storage.atomic_write_text(d / "secret", "x", mode=0o600)
        storage.atomic_write_text(d / "secret", "y", mode=0o600)
        assert stat.S_IMODE((d / "secret").stat().st_mode) == 0o600
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_a_symlinked_target_is_written_through_not_replaced():
    if sys.platform == "win32":
        return
    d = _tmp()
    try:
        real = d / "real.json"
        real.write_text("old")
        link = d / "link.json"
        link.symlink_to(real)
        storage.atomic_write_text(link, "new")
        assert link.is_symlink(), "the link was replaced by a regular file"
        assert real.read_text() == "new"
        assert sorted(p.name for p in d.iterdir()) == ["link.json", "real.json"]
    finally:
        shutil.rmtree(d, ignore_errors=True)


# ---------- the guard ----------

# (file relative to brx_mcp, exact text that must appear on the call's line, reason). Per CALL, so a new bare
# write in the same file still fails. A stale entry (its text no longer found) fails too.
_ALLOWED = [
    ("chaos/operator_actions.py", 'armory_path.write_text("{bad json")', "chaos fault injection: a torn, non-atomic armory write is the point (F468)"),
    ("storage.py", 'os.fdopen(fd, "w"', "the helper itself, on its own mkstemp file"),
    ("storage.py", 'open(kept, "xb")', "quarantine copy: a new exclusive-create file, never an overwrite"),
    ("usbconsole.py", 'os.fdopen(fd, "wb")', "the .bad-<stamp> quarantine copy: a new O_EXCL file"),
    ("btsnoop.py", 'open(sys.argv[2], "w"', "CLI export to a path the operator names"),
    ("btlink.py", "f.write_bytes(data)", "scratch file inside a TemporaryDirectory, deleted on exit"),
    ("__main__.py", "path.write_text(json.dumps(report.to_dict()", "diag report: generated output, rewritten whole each run"),
    ("chaos/__main__.py", "path.write_text(json.dumps(small.trace()", "chaos trace: generated, disposable"),
    ("chaos/runner.py", "path.write_text(json.dumps(res.trace()", "chaos trace: generated, disposable"),
    ("mc/__main__.py", '"mc-session.json").write_text(', "evidence-folder launch marker for the e2e harness, rewritten each boot"),
]
# Append mode ("a") is not scanned: logs and the fsynced append-only trust list never truncate, so a crash
# cannot lose old content. Truncating writes need the temp-and-rename helper.
_MODE = r"[rwxabt+]*[wx][rwxabt+]*"
_BARE = re.compile(
    r"\.write_text\(|\.write_bytes\("
    r"|\b(?:open|fdopen)\([^)]*[\"']" + _MODE + r"[\"']"        # open(p, "w"), "w+", "wt", "wb+", "x", os.fdopen
    r"|\.open\([^)]*mode\s*=\s*[\"']" + _MODE + r"[\"']"      # Path.open(mode="w")
)


def _scan(root: Path, allowed=_ALLOWED):
    offenders, used = [], set()
    for py in sorted(root.rglob("*.py")):
        rel = py.relative_to(root).as_posix()
        for n, line in enumerate(py.read_text(encoding="utf-8").splitlines(), 1):
            code = line.split("#", 1)[0]
            if not _BARE.search(code):
                continue
            hit = next((i for i, (f, marker, _r) in enumerate(allowed) if f == rel and marker in code), None)
            if hit is None:
                offenders.append(f"{rel}:{n}: {line.strip()}")
            else:
                used.add(hit)
    stale = [allowed[i][:2] for i in range(len(allowed)) if i not in used]
    return offenders, stale


def test_no_persistent_state_writer_bypasses_atomic_write_text():
    offenders, stale = _scan(Path(storage.__file__).parent)
    assert not offenders, "use storage.atomic_write_text (or allowlist the call with a reason):\n" + "\n".join(offenders)
    assert not stale, f"allowlist entries that match no call: {stale}"


def test_the_guard_sees_every_write_shape():
    d = _tmp()
    try:
        shapes = ['p.write_text("x")', 'p.write_bytes(b"x")', 'open(p, "w+")', 'open(p, "wt")', 'open(p, "wb+")',
                  'open(p, "x")', 'p.open(mode="w")', 'p.open("wb")', 'os.fdopen(fd, "wb")']
        for i, s in enumerate(shapes):
            (d / f"m{i}.py").write_text(s + "\n")
        offenders, _ = _scan(d, allowed=[])
        assert len(offenders) == len(shapes), offenders
        (d / "ok.py").write_text('open(p, "a")\nopen(p)\nopen(p, "rb")\nx.read_text()\n')
        offenders, _ = _scan(d, allowed=[])
        assert not any("ok.py" in o for o in offenders), offenders
    finally:
        shutil.rmtree(d, ignore_errors=True)
