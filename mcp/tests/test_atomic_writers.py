"""O16: every persistent-state writer goes through `storage.atomic_write_text`.

Two kinds of test. Per caller: a crash while the file is renamed into place leaves the OLD file byte for
byte, and no temp file behind. And a guard: no new bare `write_text(` / `open(.., "w")` on a state path
may appear in brx_mcp outside the helper (break it: add `p.write_text("x")` to any module and it fails).
"""
from __future__ import annotations

import json
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


# ---------- the guard ----------

# file (relative to brx_mcp) -> why a bare write is fine there. Anything not listed must use atomic_write_text.
_ALLOWED = {
    "storage.py": "the helper itself (os.fdopen on a mkstemp file)",
    "usbconsole.py": "the .bad-<stamp> quarantine copy: a new O_EXCL file, never an overwrite (os.fdopen)",
    "btsnoop.py": "CLI export to a path the operator names on the command line",
    "__main__.py": "the diag report: generated output, rewritten whole on every run",
    "chaos/__main__.py": "chaos trace output, generated and disposable",
    "chaos/runner.py": "chaos trace output, generated and disposable",
    "mc/__main__.py": "evidence_dir mc-session.json: a launch marker for the e2e harness, rewritten each boot",
}
# Append mode ("a") is not scanned: logs and the fsynced append-only trust list never truncate, so a crash cannot
# lose old content. Only truncating writes ("w", "x", write_text) need the temp-and-rename helper.
_BARE = re.compile(r"\.write_text\(|\bopen\([^)]*[\"'][wx]b?[\"']|os\.fdopen\([^)]*[\"'][wx]b?[\"']")


def test_no_persistent_state_writer_bypasses_atomic_write_text():
    root = Path(storage.__file__).parent
    offenders = []
    for py in sorted(root.rglob("*.py")):
        rel = py.relative_to(root).as_posix()
        if rel in _ALLOWED:
            continue
        for n, line in enumerate(py.read_text(encoding="utf-8").splitlines(), 1):
            code = line.split("#", 1)[0]
            if _BARE.search(code):
                offenders.append(f"{rel}:{n}: {line.strip()}")
    assert not offenders, "use storage.atomic_write_text (or allowlist with a reason):\n" + "\n".join(offenders)
    stale = [k for k in _ALLOWED if not (root / k).exists()]
    assert not stale, f"allowlist names files that do not exist: {stale}"
