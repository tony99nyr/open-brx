"""USB serial-console backend (B7) — read a tagger's device record over the cable.

The BRX "Programming Port" is the Teensy's USB CDC serial port (VID 16C0). It runs a
plain serial console (NOT the BLE `$…,*` protocol): commands are case-insensitive and
CR-terminated. `QUERY` is read-only and dumps the whole device record — including the
**Serial Number/Head PIN that matches the sticker on the paired headset**, the headset
version + voltage, PlayerID, nRF flags, PCB rev, and laser power — none of which BLE
exposes (verified 2026-08-24).

Pure `parse_usb_query()` is testable without hardware. `UsbConsole` needs pyserial + a
cabled tagger (runs on the machine with the USB port; here, the Windows tower).

Credit: the QUERY/SETUP command set is from LaserTagMods' "Pairing Headset and Tagger".
"""
from __future__ import annotations

import contextlib
import json
import re
import sys
import threading
import time
from pathlib import Path
from typing import Optional

TEENSY_VID = "16c0"   # PJRC/Teensy — the BRX gun's USB CDC


def find_tagger_port() -> Optional[str]:
    """Best-effort auto-detect of a cabled tagger's COM port (Teensy VID 16C0)."""
    try:
        import serial.tools.list_ports as lp
    except Exception:
        return None
    for p in lp.comports():
        if f"{p.hwid}".lower().find("16c0") >= 0:
            return p.device
    return None


def _num(s: Optional[str]):
    if s is None:
        return None
    s = s.strip()
    try:
        return int(s)
    except ValueError:
        try:
            return float(s)
        except ValueError:
            return s or None


def parse_usb_query(text: str) -> dict:
    """Parse a `QUERY` device-record dump into a normalized dict (pure)."""
    def grab(pattern: str):
        m = re.search(pattern, text, re.IGNORECASE)
        if not m:
            return None
        # fields are CR-terminated and some are NUL-padded (e.g. Gun Name) — strip
        # control chars/nulls, then whitespace
        val = re.sub(r"[\x00-\x1f]", "", m.group(1)).strip()
        return val or None

    rec = {
        "gun_version": grab(r"Gun Version:\s*(\S+)"),
        "serial_head_pin": grab(r"Serial Number/Head PIN:\s*(\S+)"),
        "gun_name": grab(r"Gun Name:\s*([^\r\n\x00]*)"),   # bounded — don't bleed across lines
        "headset_version": grab(r"Headset Version:\s*(\S+)"),
        "gun_volts": _num(grab(r"Gun:\s*([\d.]+)\s*VOLTS")),
        "head_volts": _num(grab(r"Head:\s*([\d.]+)\s*VOLTS")),
        "player_id": _num(grab(r"PlayerID\s*[:]?\s*(\d+)")),
        "field_id": _num(grab(r"FieldID\s*[:]?\s*(\d+)")),
        "nrf_host": _num(grab(r"NRFhost\s*[:]?\s*(\d+)")),
        "nrf_slave": _num(grab(r"NRFslave\s*[:]?\s*(\d+)")),
        "dev_host": _num(grab(r"devHost\s*[:]?\s*(\d+)")),
        "grenade_pin": _num(grab(r"Grenade Pin:\s*(\d+)")),
        "laser": grab(r"Laser:\s*([^\r\n]+)"),        # "16.9 mW" or "UNTESTED"
        "laser_mw": _num(grab(r"Laser:\s*([\d.]+)\s*mW")),
        "tested_by": grab(r"Tested by:\s*(.+)"),
        "gun_burn_in": grab(r"Gun BURN in test:\s*(.+)"),
        "head_burn_in": _num(grab(r"Head BURN in test:\s*(\d+)")),
        "pcb": _num(grab(r"PCB-?\s*(\d+)")),
        "bt_chip": _num(grab(r"BTchip-?\s*(\d+)")),
        "bt_central_v": grab(r"BT central V:\s*(\S+)"),
    }
    # a linked headset = a Serial/Head PIN present and a real (non-'?') version
    hv = rec["headset_version"]
    rec["headset_linked"] = bool(rec["serial_head_pin"]) and hv not in (None, "?")
    return rec


class UsbConsole:
    """Thin pyserial wrapper around the tagger's USB CDC console."""

    def __init__(self, port: Optional[str] = None, baud: int = 115200,
                 timeout: float = 0.25):
        self.port = port or find_tagger_port()
        if not self.port:
            raise RuntimeError("no tagger USB port found (Teensy VID 16C0); pass one "
                               "explicitly, e.g. COM5 / /dev/ttyACM0")
        import serial  # local import so the module loads without pyserial on WSL
        self._ser = serial.Serial(self.port, baud, timeout=timeout)
        time.sleep(0.3)

    def close(self) -> None:
        try:
            self._ser.close()
        except Exception:
            pass

    _END_MARKER = "BT central V"   # the last line of a QUERY dump

    def _flush_stale(self, drain_s: float = 0.3) -> None:
        """Discard any bytes left from a prior response so this read is clean."""
        self._ser.reset_input_buffer()
        start = time.monotonic()
        while time.monotonic() - start < drain_s:
            if not self._ser.read(256):
                break

    def _read_record(self, overall_s: float = 3.0, tail_s: float = 0.3) -> str:
        """Read until the terminal marker appears (a COMPLETE record), or timeout."""
        buf = ""
        start = time.monotonic()
        while time.monotonic() - start < overall_s:
            data = self._ser.read(256)
            if data:
                buf += data.decode("utf-8", errors="replace")
                if self._END_MARKER.lower() in buf.lower():
                    time.sleep(tail_s)   # let the last line finish
                    buf += self._ser.read(2048).decode("utf-8", errors="replace")
                    break
        return buf

    def query(self, retries: int = 2) -> dict:
        """Send `QUERY` and return the parsed device record + raw text. Flushes
        stale bytes first and retries if the record comes back incomplete
        (a partial/interleaved read misses the serial or the terminal line)."""
        text = ""
        for _ in range(retries + 1):
            self._flush_stale()
            self._ser.write(b"QUERY\r")
            text = self._read_record()
            rec = parse_usb_query(text)
            if rec.get("serial_head_pin") and rec.get("bt_central_v"):
                return {"port": self.port, "raw": text, **rec}
        return {"port": self.port, "raw": text, **parse_usb_query(text)}


# identity fields from USB QUERY + the BLE-side binding (ble_address / name_confirmed)
INVENTORY_FIELDS = ("serial_head_pin", "gun_name", "gun_version", "headset_version",
                    "headset_linked", "player_id", "field_id", "pcb", "bt_central_v",
                    "gun_volts", "head_volts", "grenade_pin", "laser",
                    "ble_address", "name_confirmed")


def inventory_path() -> Path:
    # NOT home_dir(): `test_usbconsole` monkeypatches `storage.BASE_DIR` by NAME, so calling
    # home_dir() here reads the real home and un-isolates those tests. Converting this file
    # means converting them with it.
    from .storage import BASE_DIR
    return BASE_DIR / "armory.json"


class InventoryCorrupt(Exception):
    """armory.json could not be read as a JSON object of objects. The live file is LEFT IN PLACE (a read never
    moves it); `kept` is an exact 0600 copy of the bad bytes (None when the copy could not be made). Every
    read-merge-write refuses while the live file is corrupt, so no merge can turn the armory into one gun.
    Only the operator's DISMISS (`dismiss_corrupt_inventory`) moves the file aside."""

    def __init__(self, path: Path, kept: Optional[Path], error: str):
        self.path, self.kept, self.error = path, kept, error
        where = f"a copy is kept at {kept}" if kept else "no backup copy could be made"
        super().__init__(f"armory inventory {path} is corrupt ({error}); {where}. Writes are refused until the "
                         f"file is fixed or dismissed in the console (DISMISS moves it aside and starts a fresh armory).")


def _backup_corrupt_inventory(p: Path, raw: bytes) -> Optional[Path]:
    """Save an exact copy of `raw` (the bytes that failed validation) beside `p`, mode 0600 (it holds headset
    PINs). The live file is never touched. One backup per distinct content: the name carries a digest of the
    bytes, and an existing backup with identical bytes is reused, so repeated reads do not pile up copies.
    The name is reserved with an exclusive create (never overwrites). None when the copy could not be made."""
    import hashlib
    import os
    digest = hashlib.sha256(raw).hexdigest()[:12]
    try:
        for old in sorted(p.parent.glob(f"{p.name}.bad-*-{digest}*")):
            with contextlib.suppress(OSError):
                if old.read_bytes() == raw:
                    return old
        ns = time.time_ns()
        stamp = time.strftime("%Y%m%dT%H%M%S", time.gmtime(ns // 10**9)) + f"{ns // 10**6 % 1000:03d}"
        n = 0
        while True:
            kept = p.with_name(f"{p.name}.bad-{stamp}-{digest}" + (f"-{n}" if n else ""))
            try:
                fd = os.open(kept, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            except FileExistsError:
                n += 1
                continue
            try:
                with os.fdopen(fd, "wb") as fh:
                    fh.write(raw)
            except BaseException:
                with contextlib.suppress(OSError):
                    kept.unlink()
                raise
            with contextlib.suppress(OSError):
                os.chmod(kept, 0o600)       # best effort (Windows ignores most mode bits)
            return kept
    except OSError:
        return None


def corrupt_notice_path() -> Path:
    return inventory_path().with_name("armory.json.corrupt-notice")


def _write_corrupt_notice(kept: Optional[Path], error: str) -> None:
    """Persist the corrupt-armory warning so it survives an MC restart (cleared only by DISMISS or a
    dismiss that finds the file valid again). Written ONLY when a corrupt read happened."""
    from .storage import atomic_write_text
    try:
        atomic_write_text(corrupt_notice_path(), json.dumps(
            {"kept": str(kept) if kept else None, "error": error, "at": int(time.time() * 1000)}), mode=0o600)
    except OSError:
        pass     # the in-memory warning still stands


def read_corrupt_notice() -> Optional[dict]:
    try:
        d = json.loads(corrupt_notice_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(d, dict):
        return None
    return {"kept": d["kept"] if isinstance(d.get("kept"), str) else None, "error": str(d.get("error") or "unknown")}


def clear_corrupt_notice() -> None:
    with contextlib.suppress(OSError):
        corrupt_notice_path().unlink()


def _validate_inventory(inv) -> dict:
    if not isinstance(inv, dict):
        raise ValueError(f"expected a JSON object, found {type(inv).__name__}")
    for k, v in inv.items():
        if not isinstance(k, str) or not isinstance(v, dict):
            # never name the key: armory keys are headset PINs, and this text reaches /api/state
            raise ValueError(f"a record is a {type(v).__name__}, expected an object")
    return inv


def _read_inventory_locked() -> dict:
    """The read itself. The caller MUST hold `_inventory_lock` (it is not re-entrant, so the locked write
    ops call this, never `load_inventory`). It NEVER moves, renames or deletes the live file. A missing file
    is {}. A file that is not a JSON object of objects raises InventoryCorrupt after saving an exact backup
    copy and the sticky `armory.json.corrupt-notice` (so MC can still warn after a restart). Any other
    read failure (permissions, a sharing violation) propagates as the OSError it is."""
    p = inventory_path()
    try:
        raw = p.read_bytes()
    except FileNotFoundError:
        return {}
    try:
        return _validate_inventory(json.loads(raw.decode("utf-8")))
    except ValueError as exc:      # JSONDecodeError and UnicodeDecodeError are ValueErrors
        kept = _backup_corrupt_inventory(p, raw)
        err = f"{type(exc).__name__}: {exc}"
        _write_corrupt_notice(kept, err)
        raise InventoryCorrupt(p, kept, err) from exc


def load_inventory() -> dict:
    """The armory, or {} when no file exists yet. A file that exists but is not a JSON object of objects
    raises InventoryCorrupt (the file stays where it is): an unreadable armory is never the same as an empty
    one. Takes the inventory lock, so it never reads a file a writer is replacing."""
    with _inventory_lock():
        return _read_inventory_locked()


def _save_inventory(inv: dict) -> None:
    from .storage import atomic_write_text
    atomic_write_text(inventory_path(), json.dumps(inv, indent=2), mode=0o600)   # it holds headset PINs


_inventory_thread_lock = threading.RLock()


if sys.platform == "win32":
    import msvcrt

    def _lock_file(fh) -> None:
        fh.seek(0)
        msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)

    def _unlock_file(fh) -> None:
        fh.seek(0)
        with contextlib.suppress(OSError):
            msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
else:
    import fcntl

    def _lock_file(fh) -> None:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)

    def _unlock_file(fh) -> None:
        fcntl.flock(fh.fileno(), fcntl.LOCK_UN)


@contextlib.contextmanager
def _inventory_lock(timeout_s: float = 10.0):
    """Serialise every read-merge-write of armory.json across threads and across processes (MC scans and the
    bench tools write it from different processes). Take it ONCE per operation: it is not re-entrant
    across file handles."""
    p = inventory_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    with _inventory_thread_lock:
        fh = open(p.with_name(p.name + ".lock"), "a+b")
        try:
            deadline = time.monotonic() + timeout_s
            while True:
                try:
                    _lock_file(fh)
                    break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise TimeoutError(f"armory inventory lock {fh.name} still held after {timeout_s:g} s: "
                                           f"another brx-mcp process is writing it")
                    time.sleep(0.05)
            try:
                yield
            finally:
                _unlock_file(fh)
        finally:
            fh.close()


def _under_inventory_lock(fn):
    """Run a read-merge-write of armory.json under `_inventory_lock`."""
    import functools

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        with _inventory_lock():
            return fn(*args, **kwargs)
    return wrapper


@_under_inventory_lock
def add_to_inventory(record: dict) -> dict:
    """Merge one QUERY record into the armory inventory (keyed by Serial/Head PIN).
    Only non-None fields overwrite, so a USB re-query preserves the BLE binding
    (ble_address / name_confirmed). Kept under ~/.brx-mcp (holds the headset PIN),
    never the repo. Returns the full inventory."""
    key = record.get("serial_head_pin")
    if not key:
        return _read_inventory_locked()
    inv = _read_inventory_locked()
    entry = inv.get(key, {})
    old_name = entry.get("gun_name")
    for f in INVENTORY_FIELDS:
        v = record.get(f)
        if v is not None:
            entry[f] = v
    # if this QUERY reports a DIFFERENT gun_name than a previously-confirmed one,
    # the old BLE binding is now stale → drop the confirmation so correlate re-checks
    # it against the live advert (prevents a confidently-wrong name↔MAC mapping).
    new_name = record.get("gun_name")
    if new_name is not None and old_name is not None and new_name != old_name:
        entry["name_confirmed"] = False
    inv[key] = entry
    _save_inventory(inv)
    return inv


def advert_basename(advert: str) -> str:
    """BLE advert `<GunName>-<MACtail>` → the GunName. The tail is the last 2 MAC
    bytes (4 hex). Names may contain '-', so strip only a trailing '-XXXX' hex4."""
    return re.sub(r"-[0-9A-Fa-f]{4}$", "", advert or "").strip() or (advert or "")


@_under_inventory_lock
def correlate(scan_entries: list) -> list:
    """Bind `ble_address` + set `name_confirmed` for inventory records whose gun_name
    matches exactly one BLE advert basename — and only when that name is UNIQUE in the
    inventory (duplicate names can't be told apart). This is both the initial MAC bind
    and the post-rename reconfirm. `scan_entries`: [{'name','address'}, ...].
    Returns [(serial, address), ...] newly confirmed."""
    from collections import Counter
    inv = _read_inventory_locked()
    name_counts = Counter((r.get("gun_name") or "").strip().lower() for r in inv.values())
    adv: dict[str, list] = {}
    for e in scan_entries:
        bn = advert_basename(e.get("name", "")).lower()
        if bn:
            adv.setdefault(bn, []).append(e.get("address"))
    bound = []
    for serial, r in inv.items():
        gn = (r.get("gun_name") or "").strip().lower()
        addrs = adv.get(gn, [])
        if gn and name_counts[gn] == 1 and len(addrs) == 1:
            if r.get("ble_address") != addrs[0] or not r.get("name_confirmed"):
                bound.append((serial, addrs[0]))
            r["ble_address"] = addrs[0]
            r["name_confirmed"] = True
    if bound:                       # only rewrite armory.json when something changed
        _save_inventory(inv)
    return bound


@_under_inventory_lock
def bind_address(serial: str, address: str, name: Optional[str] = None) -> bool:
    """Bind a BLE MAC to an inventory record with certainty (isolation enroll: the
    gun was the only one powered, so this address IS this serial). Optionally set the
    name too. Marks name_confirmed=True (we know both facts). Returns True if bound."""
    inv = _read_inventory_locked()
    if serial not in inv:
        return False
    inv[serial]["ble_address"] = address
    if name:
        inv[serial]["gun_name"] = name
    inv[serial]["name_confirmed"] = True
    _save_inventory(inv)
    return True


@_under_inventory_lock
def mark_rename(new_name: str, serial: Optional[str] = None,
                address: Optional[str] = None) -> Optional[str]:
    """Record a just-sent rename: set the target record's gun_name to `new_name` and
    clear `name_confirmed` (the advert won't match until the gun reboots). Target by
    serial, else by bound ble_address. Returns the serial updated, or None."""
    inv = _read_inventory_locked()
    key = serial
    if key is None and address is not None:
        key = next((s for s, r in inv.items() if r.get("ble_address") == address), None)
    if key is None or key not in inv:
        return None
    inv[key]["gun_name"] = new_name
    inv[key]["name_confirmed"] = False
    _save_inventory(inv)
    return key


def dismiss_corrupt_inventory() -> bool:
    """The operator's DISMISS: the ONLY place the live armory.json is moved aside. Under the inventory lock,
    and only if the file is STILL corrupt (re-validated now): it is renamed to an exclusively reserved
    `.dismissed-*` name (a rename keeps its 0600 mode) and the notice is deleted, so writes work again on a
    fresh armory. A file that is missing or has become valid just clears the notice. Raises OSError when the
    move fails (the notice stays). Returns True when a file was moved aside."""
    from .storage import move_aside_exclusive
    with _inventory_lock():
        p = inventory_path()
        try:
            _validate_inventory(json.loads(p.read_bytes().decode("utf-8")))
            corrupt = False
        except FileNotFoundError:
            corrupt = False
        except ValueError:
            corrupt = True
        moved = False
        if corrupt:
            if move_aside_exclusive(p, "dismissed") is None:
                raise OSError(f"could not move the corrupt armory {p} aside")
            moved = True
        clear_corrupt_notice()
        return moved


def backup_dir() -> Path:
    # NOT home_dir(): `test_usbconsole` monkeypatches `storage.BASE_DIR` by NAME, so calling
    # home_dir() here reads the real home and un-isolates those tests. Converting this file
    # means converting them with it.
    from .storage import BASE_DIR
    d = BASE_DIR / "device-backups"
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_backup(record: dict) -> Optional[Path]:
    """Save the raw QUERY dump — the ONLY local device backup (contains the headset
    PIN, so it lives under ~/.brx-mcp, never the repo). Named by serial, else port."""
    raw = record.get("raw")
    if not raw:
        return None
    name = record.get("serial_head_pin") or record.get("port", "tagger")
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", str(name))
    path = backup_dir() / f"{safe}.txt"
    path.write_text(raw, encoding="utf-8")
    return path
