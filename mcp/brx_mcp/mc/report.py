"""A scrubbed, self-describing bug report for one Mission Control session.

    python -m brx_mcp.mc.report [SESSION] [--out DIR] [--json] [--open]

A community member hits a bug, runs this (or presses the report button in MC, `POST /api/report`),
and attaches the zip to a GitHub issue. GitHub issues are PUBLIC, so everything that names a person,
a gun, a network or a machine is replaced before anything is written:

  * headset sticker ids -> `TAGGER-1`, `TAGGER-2`, ...   * BLE addresses/UUIDs -> `BLE-1`, ...
  * headset PINs/serials -> `[PIN]`                      * player names -> `Player 1`, ...
  * private IPs -> `LAN-IP-1`, other IPs -> `IP-1`       * Wi-Fi names -> `WIFI-1`, ...
  * local host names (`.local`, `.lan`, `.home.arpa`, `*.ts.net`) -> `HOST-1`, ...
  * `*.trycloudflare.com` -> `TUNNEL-HOST`               * the home folder -> `~`, the user name -> `USER`
  * operator token, join secret, node keys, MC trust keys and install secret (A60) -> `[REDACTED]`

The same raw value always gets the same alias inside one report, so a reader can still follow
"TAGGER-2 dropped out" from the log to the database. The alias map itself never goes in the zip.

Where the known values come from: the armory file (`armory.json`, if present), the saved roster
(`session.json`), every JSON value in the store under a name-like key (`display`, `gun_name`,
`gun_id`, `ble_address`, `ssid`, ...), the caller (the live server passes its roster, token and join
secret), and pattern matches (MAC addresses, IP addresses, tunnel hosts, the sticker shape).

**The guard.** After scrubbing, every file that will go in the zip (and a full SQL dump plus the raw
bytes of the scrubbed database) is searched again for every raw value seen, and for the patterns. One
hit and `ReportLeak` is raised and NOTHING is written. Values shorter than 3 characters are not
searched as free text (a one- or two-letter player name matches all over hex ids and JSON), but they
are still replaced wherever they sit under a name-like key. The same holds for an ALL-DIGIT value (a
grenade PIN is a small integer): a bare number in free text cannot be told apart from a row id, a
sequence number or a count, so it is replaced only under its own key (`"grenade_pin": 4321`, structural
or in a log line), and the guard checks that shape instead of every number in the file. (Found on a
real session: a 4-digit grenade PIN equal to three `envelopes.id` values stopped every report.)

The scrub works on a COPY taken with the sqlite backup API, so it is safe while MC is running and it
includes rows still in the write-ahead log. The original evidence is never modified.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import ipaddress
import json
import os
import platform
import re
import sqlite3
import subprocess
import sys
import tempfile
import unicodedata
import zipfile
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Mapping
from urllib.parse import urlencode

from ..storage import home_dir

REPO_SLUG = "tony99nyr/open-brx"
ISSUE_TEMPLATE = "bug_report.yml"
GITHUB_ATTACHMENT_LIMIT = 25 * 1024 * 1024
MAX_ISSUE_URL = 6000
MIN_GUARD_LEN = 3
REPORT_NAME = re.compile(r"open-brx-report-[A-Za-z0-9._-]{1,80}\.zip")

# ---------------------------------------------------------------- categories ---- #

TAGGER, BLE, PIN, PLAYER, LAN_IP, IP, WIFI, TUNNEL, HOME, USER, SECRET, HOST = (
    "tagger_id", "ble_address", "headset_pin", "player_name", "lan_ip", "public_ip", "wifi_name",
    "tunnel_host", "home_folder", "user_name", "secret", "lan_host")

_KEYS_PLAYER = {"display", "callsign", "player_name", "gamertag", "vanity", "killer_name", "victim_name"}
_KEYS_TAGGER = {"gun_name", "sticker", "basename"}
_KEYS_PIN = {"gun_id", "headset_pin", "serial_head_pin", "grenade_pin", "head_pin", "serial"}
_KEYS_BLE = {"ble_address", "address", "uuid", "ble_uuid", "mac", "deviceid", "device_id"}
_KEYS_SECRET = {"token", "tok", "join_secret", "secret", "node_key", "password", "psk", "operator_token"}
_KEYS_WIFI = {"ssid", "wifi", "wifi_name"}
# Aliases are words the scrub itself writes. A raw value equal to one would make the guard trip on
# the replacement, so such a value is scrubbed but not searched for afterwards.
_ALIAS_SHAPE = re.compile(r"(player \d+|(tagger|ble|lan-ip|ip|wifi|host)-\d+)")
_ALIAS_WORDS = {"user", "player", "tagger", "tunnel-host", "redacted", "pin", "lan-ip", "ble", "wifi", "ip"}
# Generic gun names every stock tagger advertises: not an identity, and replacing them would hide
# the one fact a reader most needs ("this gun had lost its name").
_GENERIC_GUN = {"tactix", "tactix2"}

# The one headset sticker shape seen so far; assembled at run time, as the docs hygiene test does, so
# this file never matches its own rule.
_STICKER = re.compile("R" + "0B" + r"[A-Z0-9]{2}(?![A-Za-z0-9])")
_MAC = re.compile(r"(?<![0-9A-Fa-f:-])(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}(?![0-9A-Fa-f:-])")
# Not followed by a letter or `-`: a kernel release (`6.6.87.2-microsoft-standard`) is not an address.
_IPV4 = re.compile(r"(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.A-Za-z_-])")
_IPV6 = re.compile(r"(?<![0-9A-Fa-f:])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![0-9A-Fa-f:])")
_TUNNEL = re.compile(r"[A-Za-z0-9-]+\.trycloudflare\.com", re.I)
# A local-network host name (mDNS `.local`, router `.lan`, `.home.arpa`, a Tailscale `*.ts.net` name).
# Not followed by `.`, `[` or `(`, so `session.lan["ip"]` in a traceback is code, not a host.
_LAN_HOST = re.compile(r"(?<![A-Za-z0-9._-])[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:local|lan|home\.arpa|ts\.net)"
                       r"(?![A-Za-z0-9_\[(-])(?!\.[A-Za-z0-9_\[(-])", re.I)   # a sentence-ending dot is fine
_HOME_ANY = re.compile(r"(/home/|/Users/|[A-Za-z]:\\{1,2}Users\\{1,2})(?!USER(?![A-Za-z0-9]))([A-Za-z0-9._-]+)(?=[/\\\"'\s]|$)")
_SECRET_PATTERNS = [
    re.compile(r"((?:[#?&]|\b)(?:tok|token|secret)=|[?&](?:s|key)=)(?!\[REDACTED\])([^\s&\"'#)\]<>]+)"),
    re.compile(r"(operator token:\s*)(?!\[REDACTED\])(\S+)", re.I),
    re.compile(r"(Bearer\s+)(?!\[REDACTED\])([A-Za-z0-9._~+/=-]+)"),
    re.compile(r"(\"(?:token|tok|join_secret|secret|node_key|operator_token)\"\s*:\s*\")(?!\[REDACTED\])([^\"]+)"),
]
# The guard's OWN compiled copies of the patterns. A change (or a bug) in one scrub pattern then
# cannot also blind the check that is meant to catch it.
_GUARD_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("MAC address", re.compile(_MAC.pattern)), ("tunnel host", re.compile(_TUNNEL.pattern, re.I)),
    ("local host name", re.compile(_LAN_HOST.pattern, re.I)),
    ("sticker id", re.compile(_STICKER.pattern)), ("home folder", re.compile(_HOME_ANY.pattern)),
    *[("token or secret", re.compile(p.pattern, p.flags)) for p in _SECRET_PATTERNS]]
_GUARD_IPV4 = re.compile(_IPV4.pattern)
# A PIN under its own key inside free text (a JSON dump in a phone log line), quoted or a bare number.
_PIN_KEYS_RE = r"(\"(?:gun_id|serial_head_pin|headset_pin|head_pin|grenade_pin)\"\s*:\s*\"?)"
_TEXT_PIN = re.compile(_PIN_KEYS_RE + r"(?!null\b|true\b|false\b)([A-Za-z0-9*_-]{1,32})")
_GUARD_PATTERNS.append(("headset pin", re.compile(_TEXT_PIN.pattern)))
# Name-like keys inside free text (a phone log line holding an engine-state JSON dump, mc.log).
_TEXT_KEY = re.compile(r"\"(display|callsign|gun_name|gun_id|serial_head_pin|ble_address|deviceId|ssid)\"\s*:\s*\"([^\"]{1,64})\"")


_KEY_END = re.compile(r'"\s*:')


LEAK_NEXT_STEP = ("No report was made, to keep private data out of a public issue. File the issue without "
                  "the zip and paste this message: a developer will follow up.")


class ReportLeak(RuntimeError):
    """A raw identifier survived the scrub. Nothing was written."""


@dataclass
class ReportResult:
    zip_path: Path
    issue_url: str
    summary: dict[str, Any]
    removed: dict[str, int]
    size_bytes: int = 0
    notes: list[str] = field(default_factory=list)

    @property
    def too_large(self) -> bool:
        return self.size_bytes > GITHUB_ATTACHMENT_LIMIT

    def as_json(self) -> dict[str, Any]:
        return {"zip": str(self.zip_path), "issue_url": self.issue_url, "summary": self.summary,
                "removed": self.removed, "too_large": self.too_large}


# ---------------------------------------------------------------- aliasing ---- #

class Aliaser:
    """Raw value -> stable alias, per category. Case-insensitive: `tony` and `TONY` are one player."""

    def __init__(self) -> None:
        self.by_raw: dict[str, tuple[str, str]] = {}      # lower(raw) -> (category, alias)
        self.raws: dict[str, str] = {}                     # lower(raw) -> raw as first seen
        self.counts: Counter[str] = Counter()              # category -> aliases handed out
        self.removed: Counter[str] = Counter()             # category -> replacements made
        self._literal: re.Pattern[str] | None = None

    def add(self, category: str, raw: Any) -> str | None:
        if raw is None or isinstance(raw, bool):
            return None
        value = str(raw).strip()
        if not value or value.startswith("[") or value.lower() in ("none", "null", "unknown", "-", "\u2014"):
            return None
        key = value.lower()
        if key in self.by_raw:
            return self.by_raw[key][1]
        alias = self._next(category)
        # The same value as it may be stored: JSON-escaped (`Zo\u00eb`) and in either Unicode form
        # (NFC `Zo\u00eb` or NFD `Zoe` + a combining mark). Each variant gets the SAME alias, and the
        # guard searches for every one.
        for variant in _variants(value):
            vkey = variant.lower()
            if vkey not in self.by_raw:
                self.by_raw[vkey] = (category, alias)
                self.raws[vkey] = variant
        self._literal = None
        return alias

    def _next(self, category: str) -> str:
        if category == PIN:
            return "[PIN]"
        if category == SECRET:
            return "[REDACTED]"
        if category == TUNNEL:
            return "TUNNEL-HOST"
        if category == HOME:
            return "~"
        if category == USER:
            return "USER"
        self.counts[category] += 1
        n = self.counts[category]
        return {TAGGER: f"TAGGER-{n}", BLE: f"BLE-{n}", PLAYER: f"Player {n}", LAN_IP: f"LAN-IP-{n}",
                IP: f"IP-{n}", WIFI: f"WIFI-{n}", HOST: f"HOST-{n}"}.get(category, f"ID-{n}")

    def replace(self, category: str, raw: str) -> str:
        alias = self.add(category, raw) or raw
        if alias != raw:
            self.removed[category] += 1
        return alias

    def literal_pattern(self) -> re.Pattern[str] | None:
        if self._literal is None:
            raws = sorted(self.raws.values(), key=len, reverse=True)
            raws = [r for r in raws if not r.isdigit()
                    and (len(r) >= MIN_GUARD_LEN or self.by_raw.get(r.lower(), ("",))[0] in (PIN, SECRET, BLE))]
            if not raws:
                return None
            self._literal = re.compile(r"(?<![A-Za-z0-9_])(?:" + "|".join(re.escape(r) for r in raws)
                                       + r")(?![A-Za-z0-9_])", re.I)
        return self._literal

    def guard_values(self) -> list[str]:
        return [raw for key, raw in self.raws.items()
                if len(raw) >= MIN_GUARD_LEN and not raw.isdigit() and key not in _ALIAS_WORDS
                and not _ALIAS_SHAPE.fullmatch(key)]


def _variants(value: str) -> list[str]:
    forms = [value]
    for form in ("NFC", "NFD"):
        forms.append(unicodedata.normalize(form, value))
    for f in list(forms):
        forms.append(json.dumps(f)[1:-1])
    out: list[str] = []
    for f in forms:
        if f and f not in out:
            out.append(f)
    return out


def _gun_base(name: str) -> str:
    """`<sticker>-<4 hex tail>` (the BLE advert name) -> the sticker. The tail is the public half the
    repo already uses (`Tactix-XXXX`), so it stays."""
    m = re.fullmatch(r"(.+?)-([0-9A-Fa-f]{4})", name.strip())
    return m.group(1) if m else name.strip()


def _add_gun_name(al: Aliaser, name: Any) -> None:
    if not isinstance(name, str) or not name.strip():
        return
    base = _gun_base(name)
    if base.lower() not in _GENERIC_GUN and not base.lower().startswith("tactix-"):
        al.add(TAGGER, base)


def _add_ble(al: Aliaser, addr: Any) -> None:
    if not isinstance(addr, str) or not addr.strip():
        return
    addr = addr.strip()
    if _classify_ip(addr):
        al.add(_classify_ip(addr) or LAN_IP, addr)
        return
    al.add(BLE, addr)
    bare = re.sub(r"[^0-9A-Fa-f]", "", addr)
    if len(bare) == 12 and bare != addr:
        al.add(BLE, bare)            # the same MAC written without separators


def _classify_ip(text: str) -> str | None:
    try:
        ip = ipaddress.ip_address(text)
    except ValueError:
        return None
    if ip.is_loopback or ip.is_unspecified or str(ip) == "255.255.255.255" or ip.is_multicast:
        return None
    if ip.is_private or ip.is_link_local or (ip.version == 4 and ip in ipaddress.ip_network("100.64.0.0/10")):
        return LAN_IP
    return IP


# ---------------------------------------------------------------- collection (pass 1) ---- #

def _collect_json(al: Aliaser, value: Any, parent_key: str = "") -> None:
    if isinstance(value, dict):
        is_player = "player_id" in value
        for k, v in value.items():
            kl = str(k).lower()
            if isinstance(v, (str, int)) and not isinstance(v, bool):
                sv = str(v)
                if kl in _KEYS_PLAYER or kl.endswith("_display") or (kl == "name" and is_player):
                    al.add(PLAYER, sv)
                elif kl in _KEYS_TAGGER or (kl == "name" and parent_key == "gun"):
                    _add_gun_name(al, sv)
                elif kl in _KEYS_PIN:
                    al.add(PIN, sv)
                elif kl in _KEYS_BLE:
                    _add_ble(al, sv)
                elif kl in _KEYS_SECRET or (kl == "key" and parent_key == "mc_trust"):   # A60 trust key
                    al.add(SECRET, sv)
                elif kl in _KEYS_WIFI:
                    al.add(WIFI, sv)
            if isinstance(v, str):
                _collect_text(al, v)
            else:
                _collect_json(al, v, kl)
    elif isinstance(value, list):
        for v in value:
            _collect_json(al, v, parent_key)
    elif isinstance(value, str):
        _collect_text(al, value)


def _collect_install_identity(al: Aliaser, db: sqlite3.Connection) -> None:
    """A60: MC's install secret (`mc-install-secret`, never packed) and the trust key it derives for
    every node in this store are secrets the guard must search for, whether or not the caller passed
    them. Read only: a report never creates the file."""
    from .mcid import b64url, read_install_secret, trust_key
    inst = read_install_secret(home_dir())
    if not inst:
        return
    al.add(SECRET, b64url(inst))
    try:
        ids = [str(n) for (n,) in db.execute("SELECT DISTINCT node_id FROM envelopes") if n]
    except sqlite3.Error:
        ids = []
    for nid in ids:
        al.add(SECRET, trust_key(inst, nid))


def _collect_text(al: Aliaser, text: str) -> None:
    for m in _TEXT_KEY.finditer(text):
        key, val = m.group(1).lower(), m.group(2)
        if key in ("display", "callsign"):
            al.add(PLAYER, val)
        elif key == "gun_name":
            _add_gun_name(al, val)
        elif key in ("gun_id", "serial_head_pin"):
            al.add(PIN, val)
        elif key in ("ble_address", "deviceid"):
            _add_ble(al, val)
        elif key == "ssid":
            al.add(WIFI, val)
    for m in _TEXT_PIN.finditer(text):
        al.add(PIN, m.group(2))
    for m in _STICKER.finditer(text):
        al.add(TAGGER, m.group(0))


def _collect_armory(al: Aliaser, path: Path | None) -> None:
    if not path or not path.is_file():
        return
    try:
        inv = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return
    if not isinstance(inv, dict):
        return
    for serial in sorted(inv):          # sorted: the same armory always yields the same aliases
        rec = inv[serial]
        al.add(PIN, serial)
        if not isinstance(rec, dict):
            continue
        for k in ("serial_head_pin", "grenade_pin"):
            al.add(PIN, rec.get(k))
        _add_gun_name(al, rec.get("gun_name"))
        _add_ble(al, rec.get("ble_address"))


def _collect_roster(al: Aliaser, path: Path | None) -> None:
    if not path or not path.is_file():
        return
    try:
        _collect_json(al, json.loads(path.read_text(encoding="utf-8")))
    except Exception:
        return


def _collect_environment(al: Aliaser) -> None:
    home = str(Path.home())
    if len(home) > 1:
        al.add(HOME, home)
        al.add(HOME, home.replace("\\", "/"))
        al.add(HOME, home.replace("\\", "\\\\"))
    try:
        import getpass
        user = getpass.getuser()
    except Exception:
        user = os.environ.get("USER") or os.environ.get("USERNAME") or ""
    if user and len(user) >= MIN_GUARD_LEN and user.lower() not in ("root", "runner", "user"):
        al.add(USER, user)


# ---------------------------------------------------------------- scrubbing (pass 2) ---- #

def scrub_text(al: Aliaser, text: str) -> str:
    """Every replacement a free-text value gets, in order: secrets, known literals, then patterns."""
    for pat in _SECRET_PATTERNS:
        def _secret(m: re.Match[str]) -> str:
            al.add(SECRET, m.group(2))
            al.removed[SECRET] += 1
            return m.group(1) + "[REDACTED]"
        text = pat.sub(_secret, text)
    def _pin(m: re.Match[str]) -> str:
        al.add(PIN, m.group(2))
        al.removed[PIN] += 1
        return m.group(1) + "[PIN]"
    text = _TEXT_PIN.sub(_pin, text)
    lit = al.literal_pattern()
    if lit is not None:
        def _lit(m: re.Match[str]) -> str:
            cat, alias = al.by_raw.get(m.group(0).lower(), (SECRET, "[REDACTED]"))
            al.removed[cat] += 1
            return alias
        text = lit.sub(_lit, text)
    text = _TUNNEL.sub(lambda m: al.replace(TUNNEL, m.group(0)), text)
    text = _LAN_HOST.sub(lambda m: al.replace(HOST, m.group(0)), text)
    text = _MAC.sub(lambda m: al.replace(BLE, m.group(0)), text)
    text = _STICKER.sub(lambda m: al.replace(TAGGER, m.group(0)), text)

    def _ip(m: re.Match[str]) -> str:
        cat = _classify_ip(m.group(0))
        return al.replace(cat, m.group(0)) if cat else m.group(0)
    text = _IPV4.sub(_ip, text)

    def _ip6(m: re.Match[str]) -> str:
        raw = m.group(0)
        if len(raw) < 6:
            return raw
        cat = _classify_ip(raw)
        return al.replace(cat, raw) if cat else raw
    text = _IPV6.sub(_ip6, text)
    text = _HOME_ANY.sub(lambda m: m.group(1) + al.replace(USER, m.group(2)), text)
    return text


def _scrub_json(al: Aliaser, value: Any, parent_key: str = "") -> Any:
    if isinstance(value, dict):
        is_player = "player_id" in value
        out = {}
        for k, v in value.items():
            kl = str(k).lower()
            # Keys are structure, not data: scrubbing them turned a player called "Red" into a broken
            # `score` table. A key that DOES hold an identifier is still caught by the guard.
            nk = k
            if isinstance(v, (str, int)) and not isinstance(v, bool):
                sv = str(v)
                cat, base = None, ""
                if kl in _KEYS_PLAYER or kl.endswith("_display") or (kl == "name" and is_player):
                    cat = PLAYER
                elif kl in _KEYS_PIN:
                    cat = PIN
                elif kl in _KEYS_SECRET:
                    cat = SECRET
                elif kl in _KEYS_WIFI:
                    cat = WIFI
                elif kl in _KEYS_TAGGER or (kl == "name" and parent_key == "gun"):
                    base = _gun_base(sv)
                    if base.lower() not in _GENERIC_GUN and not base.lower().startswith("tactix-"):
                        cat = TAGGER
                if cat == TAGGER:
                    out[nk] = sv.replace(base, al.replace(TAGGER, base), 1)
                    continue
                if cat is not None and sv.strip() and not sv.startswith("["):
                    out[nk] = al.replace(cat, sv)
                    continue
            out[nk] = _scrub_json(al, v, kl)
        return out
    if isinstance(value, list):
        return [_scrub_json(al, v, parent_key) for v in value]
    if isinstance(value, str):
        return scrub_text(al, value)
    return value


def scrub_value(al: Aliaser, text: str) -> str:
    """A column value: JSON gets the structural pass first (so short names under a name key still go),
    anything else is free text."""
    stripped = text.lstrip()
    if stripped[:1] in ("{", "["):
        try:
            parsed = json.loads(text)
        except ValueError:
            parsed = None
        if isinstance(parsed, (dict, list)):
            return json.dumps(_scrub_json(al, parsed), default=str)
    return scrub_text(al, text)


# ---------------------------------------------------------------- sqlite ---- #

def _backup(src_path: Path, dst_path: Path) -> None:
    """A consistent copy through the backup API: it reads through the WAL, and a running MC holding its
    own connection is not blocked. Read-only first; a crashed run can leave a `-wal` with no `-shm`, which
    a read-only handle cannot open, so fall back to an ordinary handle (it never writes a row)."""
    try:
        src = sqlite3.connect(src_path.resolve().as_uri() + "?mode=ro", uri=True)
        src.execute("SELECT count(*) FROM sqlite_master").fetchone()
    except sqlite3.Error:
        src = sqlite3.connect(str(src_path))
    dst = sqlite3.connect(str(dst_path))
    try:
        src.backup(dst)
    finally:
        src.close()
        dst.close()


def _tables(db: sqlite3.Connection) -> list[str]:
    return [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]


def _text_cells(db: sqlite3.Connection):
    for table in _tables(db):
        cols = [r[1] for r in db.execute(f'PRAGMA table_info("{table}")')]
        for row in db.execute(f'SELECT rowid, * FROM "{table}"'):
            for col, val in zip(cols, row[1:]):
                if isinstance(val, str):
                    yield table, col, row[0], val


def _scrub_db(al: Aliaser, path: Path) -> None:
    db = sqlite3.connect(str(path))
    try:
        db.execute("PRAGMA journal_mode=DELETE").fetchall()
        db.execute("PRAGMA secure_delete=ON").fetchall()
        _rejoin_log_chunks(al, db)
        # `envelopes.kind` is a fixed vocabulary (`death`, `status`, `hello`, ...) that diag counts by;
        # a player called "Death" must not turn it into `Player 1`.
        updates = [(t, c, rid, scrub_value(al, v)) for t, c, rid, v in list(_text_cells(db))
                   if (t, c) != ("envelopes", "kind")]
        for t, c, rid, nv in updates:
            db.execute(f'UPDATE "{t}" SET "{c}"=? WHERE rowid=?', (nv, rid))
        db.commit()
        db.execute("VACUUM")          # no free page may keep an old value
    finally:
        db.close()


def _rejoin_log_chunks(al: Aliaser, db: sqlite3.Connection) -> None:
    """Phones cut a log by BYTE count (app/src/logsync.js `chunkByBytes`), so a name can straddle two
    `log_data` rows. Per node, join the chunks in arrival order, scrub the joined text, and write it
    back as the FIRST row's chunk, with every later row's chunk emptied. Row count, seq and every
    other field stay as they were, so nothing that counts or orders the rows changes."""
    if "envelopes" not in _tables(db):
        return
    for rows in _log_groups(db):
        joined = scrub_text(al, "".join(b["chunk"] for _rid, b in rows))
        for i, (rowid, b) in enumerate(rows):
            b["chunk"] = joined if i == 0 else ""
            db.execute("UPDATE envelopes SET body=? WHERE rowid=?", (json.dumps(b), rowid))
    db.commit()


def _log_groups(db: sqlite3.Connection) -> list[list[tuple[int, dict]]]:
    """`log_data` rows grouped into uploads: per node, in arrival order, a new group at `seq == 0` or
    after a chunk marked `last` (the phone restarts `seq` for every upload, app/src/logsync.js)."""
    if "envelopes" not in _tables(db):
        return []
    groups: list[list[tuple[int, dict]]] = []
    open_group: dict[str, list[tuple[int, dict]]] = {}
    for rowid, node_id, body in db.execute(
            "SELECT rowid, node_id, body FROM envelopes WHERE kind='log_data' ORDER BY id"):
        try:
            b = json.loads(body)
        except (TypeError, ValueError):
            continue
        if not isinstance(b, dict) or not isinstance(b.get("chunk"), str):
            continue
        node = str(node_id)
        cur = open_group.get(node)
        if cur is None or b.get("seq") == 0:
            cur = []
            groups.append(cur)
            open_group[node] = cur
        cur.append((rowid, b))
        if b.get("last") is True:
            open_group.pop(node, None)
    return groups


def _joined_log_chunks(db: sqlite3.Connection) -> dict[str, str]:
    """Each upload's `log_data` chunks joined in order (`_log_groups`). Pass 1 learns names from it (a
    `"display":"..."` can straddle a seam) and the guard searches it after the scrub, which rejoins the
    same groups (`_rejoin_log_chunks`)."""
    return {f"session.sqlite (phone log {i}, chunks joined)": "".join(b["chunk"] for _rid, b in rows)
            for i, rows in enumerate(_log_groups(db), 1)}


def _db_facts(path: Path) -> dict[str, Any]:
    db = sqlite3.connect(str(path))
    try:
        facts: dict[str, Any] = {"match_count": 0, "envelope_count": 0, "node_count": 0, "phone_apps": []}
        names = set(_tables(db))
        if "matches" in names:
            facts["match_count"] = db.execute("SELECT count(*) FROM matches").fetchone()[0]
            sid = db.execute("SELECT session_id FROM matches WHERE session_id IS NOT NULL LIMIT 1").fetchone()
            facts["session_id"] = sid[0] if sid else None
        if "envelopes" in names:
            facts["envelope_count"] = db.execute("SELECT count(*) FROM envelopes").fetchone()[0]
            facts["node_count"] = db.execute("SELECT count(DISTINCT node_id) FROM envelopes").fetchone()[0]
            apps: Counter[tuple[str, str]] = Counter()
            for (body,) in db.execute("SELECT body FROM envelopes WHERE kind='hello'"):
                try:
                    b = json.loads(body)
                except (TypeError, ValueError):
                    continue
                if isinstance(b, dict) and b.get("app_ver"):
                    apps[(str(b.get("app_ver")), str(b.get("platform") or "?"))] += 1
            facts["phone_apps"] = [{"app_ver": v, "platform": p, "hellos": n} for (v, p), n in sorted(apps.items())]
        return facts
    finally:
        db.close()


# ---------------------------------------------------------------- environment ---- #

def _git(repo: Path | None) -> dict[str, Any] | None:
    if repo is None or not (repo / ".git").exists():
        return None
    try:
        commit = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True,
                                text=True, timeout=5).stdout.strip()
        dirty = subprocess.run(["git", "-C", str(repo), "status", "--porcelain", "--untracked-files=no"],
                               capture_output=True, text=True, timeout=5).stdout.strip()
    except Exception:
        return None
    return {"commit": commit or None, "dirty": bool(dirty)} if commit else None


def _os_name() -> str:
    system = platform.system()
    if system == "Darwin":
        return f"macOS {platform.mac_ver()[0]}".strip()
    if system == "Windows":
        return f"Windows {platform.release()}"
    rel = platform.release()
    return f"{system} {rel}" + (" (WSL)" if "microsoft" in rel.lower() else "")


def _mc_version() -> str:
    try:
        from importlib.metadata import version
        return version("brx-mcp")
    except Exception:
        return "unknown"


def _environment(launch_id: str, repo: Path | None, facts: dict[str, Any]) -> dict[str, Any]:
    return {"report_format": 1,
            "created_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
            "launch_id": launch_id, "os": _os_name(), "platform": platform.platform(),
            "machine": platform.machine(), "python": platform.python_version(),
            "mc_version": _mc_version(), "git": _git(repo), "match_count": facts.get("match_count", 0),
            "envelope_count": facts.get("envelope_count", 0), "node_count": facts.get("node_count", 0),
            "phone_apps": facts.get("phone_apps", [])}


def env_summary(env: dict[str, Any]) -> str:
    git = env.get("git") or {}
    commit = (git.get("commit") or "")[:9]
    parts = [f"Open BRX {commit}{' (modified)' if git.get('dirty') else ''}".strip() if commit else
             f"brx-mcp {env.get('mc_version')}", env.get("os") or "", f"Python {env.get('python')}"]
    apps = sorted({a["app_ver"] for a in env.get("phone_apps") or []})
    if apps:
        parts.append("phone app " + ", ".join(apps))
    return "; ".join(p for p in parts if p)[:400]


def issue_url(file_name: str, env: dict[str, Any]) -> str:
    q = urlencode({"template": ISSUE_TEMPLATE, "title": "[bug] ", "environment": env_summary(env),
                   "report": file_name})
    url = f"https://github.com/{REPO_SLUG}/issues/new?{q}"
    if len(url) > MAX_ISSUE_URL:          # never in practice (the summary is capped); belt and braces
        url = f"https://github.com/{REPO_SLUG}/issues/new?" + urlencode(
            {"template": ISSUE_TEMPLATE, "title": "[bug] ", "report": file_name})
    return url


# ---------------------------------------------------------------- README ---- #

_LABELS = {TAGGER: "tagger (headset sticker) ids -> TAGGER-n", BLE: "Bluetooth addresses -> BLE-n",
           PIN: "headset PINs and serials -> [PIN]", PLAYER: "player names -> Player n",
           LAN_IP: "local network addresses -> LAN-IP-n", IP: "other IP addresses -> IP-n",
           WIFI: "Wi-Fi network names -> WIFI-n", HOST: "local network host names -> HOST-n", TUNNEL: "tunnel host names -> TUNNEL-HOST",
           HOME: "your home folder -> ~", USER: "your user name -> USER",
           SECRET: "tokens, join secrets and keys -> [REDACTED]"}


def _readme(name: str, members: list[str], removed: dict[str, int], env: dict[str, Any], missing: list[str]) -> str:
    lines = [f"Open BRX bug report: {name}", "",
             "This zip holds the evidence from one Mission Control session, with personal details replaced.",
             "", "What is inside:"]
    about = {"session.sqlite": "every message the phones sent to Mission Control, and each match's settings",
             "mc.log": "what Mission Control printed while it ran",
             "manifest.json": "when the session started and stopped, and how it ended",
             "diag.json": "a per-match summary of the database (the same as python -m brx_mcp.mc.diag)",
             "environment.json": "the computer, Python, Mission Control and phone app versions",
             "README.txt": "this file"}
    lines += [f"  {m:<17} {about.get(m, '')}" for m in members]
    if missing:
        lines += ["", "Not in this session folder, so not included: " + ", ".join(missing)]
    lines += ["", "What was replaced (and how many times):"]
    if removed:
        lines += [f"  {_LABELS.get(k, k)}: {n}" for k, n in sorted(removed.items())]
    else:
        lines.append("  nothing needed replacing")
    lines += ["",
              "The same original value always gets the same replacement, so TAGGER-2 in mc.log is TAGGER-2",
              "in session.sqlite too. The list that maps a replacement back to the original is not in this zip.",
              "",
              "Not changed: names shorter than 3 letters, bare numbers, and text you typed yourself",
              "(team names, game names, notes). Check for those before you post.",
              "",
              "IMPORTANT: GitHub issues are public. Anyone can download this file.",
              "Open it and check it before you attach it. If you see a name or number you do not want to",
              "share, do not post it: say so in the issue text instead, and a developer will help.",
              "",
              "For developers:",
              "  unzip " + name,
              "  python -m brx_mcp.mc.diag session.sqlite          (add --json for machine-readable output)",
              "  sqlite3 session.sqlite 'select kind, count(*) from envelopes group by kind'",
              "",
              "Environment: " + env_summary(env), ""]
    return "\n".join(lines)


# ---------------------------------------------------------------- the guard ---- #

def _guard(al: Aliaser, files: dict[str, bytes], extra_text: dict[str, str],
           schema: Iterable[str] = (), prose_only: Iterable[str] = (), vocabulary: Iterable[str] = ()) -> None:
    """Search every byte that will ship for every raw value seen and for the patterns. Raise on a hit.
    The message names the file and the kind of value, never the value (it may be printed or logged)."""
    # `vocabulary`: the envelope kinds, which stay as they are (see `_scrub_db`). A player named after one
    # is still scrubbed everywhere else, but the guard cannot tell that name from the kind column.
    vocab = {v.lower() for v in vocabulary}
    raws = [r for r in al.guard_values() if r.lower() not in vocab]
    # `_` is a word character here: a player called "Max" must not match `max_hp`.
    lit = (re.compile(r"(?<![A-Za-z0-9_])(?:" + "|".join(re.escape(r) for r in sorted(raws, key=len, reverse=True))
                      + r")(?![A-Za-z0-9_])", re.I) if raws else None)
    texts = {n: b.decode("utf-8", errors="replace") for n, b in files.items()}
    texts.update(extra_text)
    schema = [sql for sql in schema if sql]
    prose_only = set(prose_only)
    for name, text in texts.items():
        # Words the report writes itself are not the user's data: the table schema (a player called
        # "Kind" would otherwise match the `kind` column) and the fixed prose of README.txt, whose only
        # variable text (the file name, the environment) is guarded in its own member.
        lit_text = text
        for sql in schema:
            lit_text = lit_text.replace(sql, "")
        if lit is not None and name not in prose_only:
            # A WHOLE JSON object key (`"red": 3`) is structure the scrub leaves alone, so a player
            # called "Red" in a game with a red team does not refuse every report. MC keys its maps by
            # ids, never by display names; a name INSIDE a longer key still counts.
            m = next((m for m in lit.finditer(lit_text)
                      if not (lit_text[m.start() - 1:m.start()] == '"' and _KEY_END.match(lit_text, m.end()))), None)
            if m:
                cat = al.by_raw.get(m.group(0).lower(), ("identifier",))[0]
                raise ReportLeak(f"a {cat.replace('_', ' ')} survived the scrub in {name}; no report was written. " + LEAK_NEXT_STEP)
        for label, pat in _GUARD_PATTERNS:
            if pat.search(text):
                raise ReportLeak(f"a {label} survived the scrub in {name}; no report was written. " + LEAK_NEXT_STEP)
        for m in _GUARD_IPV4.finditer(text):
            if _classify_ip(m.group(0)):
                raise ReportLeak(f"an IP address survived the scrub in {name}; no report was written. " + LEAK_NEXT_STEP)


# ---------------------------------------------------------------- build ---- #

def _read_json(path: Path) -> dict[str, Any]:
    try:
        v = json.loads(path.read_text(encoding="utf-8"))
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def _safe_id(value: Any) -> str:
    s = re.sub(r"[^A-Za-z0-9._-]", "-", str(value or "")).strip("-.")[:80]
    return s or "session"


def build_report(evidence_dir: Path, out_dir: Path | None = None, *, armory_path: Path | None = None,
                 repo: Path | None = None, sqlite_path: Path | None = None, launch_id: str | None = None,
                 roster_path: Path | None = None, secrets: Iterable[str] = (),
                 known: Mapping[str, Iterable[str]] | None = None) -> ReportResult:
    """Build `open-brx-report-<launch-id>.zip` in `out_dir` (default: the evidence dir).

    `sqlite_path` defaults to `<evidence_dir>/session.sqlite` (a manual run keeps its store under
    `~/.brx-mcp/mc/` instead). `armory_path` and `roster_path` default to the files under
    `BRX_MCP_HOME`; a missing file is simply skipped. `secrets` and `known` ({category: values}) let
    the live server add what only it knows: its token, join secret and roster.
    """
    evidence_dir = Path(evidence_dir)
    sqlite_path = Path(sqlite_path) if sqlite_path else evidence_dir / "session.sqlite"
    if not sqlite_path.is_file():
        raise FileNotFoundError(f"no session database at {sqlite_path}")
    out_dir = Path(out_dir) if out_dir else evidence_dir
    manifest_path, log_path = evidence_dir / "manifest.json", evidence_dir / "mc.log"
    manifest = _read_json(manifest_path) if manifest_path.is_file() else {}
    mc_session = _read_json(evidence_dir / "mc-session.json")
    if repo is None:
        repo_guess = manifest.get("repo") or Path(__file__).resolve().parents[3]
        repo = Path(str(repo_guess))
    armory_path = armory_path if armory_path is not None else home_dir() / "armory.json"
    roster_path = roster_path if roster_path is not None else home_dir() / "session.json"

    al = Aliaser()
    with tempfile.TemporaryDirectory(prefix="brx-report-") as tmp:
        work = Path(tmp) / "session.sqlite"
        _backup(sqlite_path, work)
        facts = _db_facts(work)
        launch_id = _safe_id(launch_id or manifest.get("launch_id") or mc_session.get("launch_id")
                             or facts.get("session_id") or evidence_dir.name)

        # ---- pass 1: learn every identifier before replacing any ----
        _collect_environment(al)
        for s in secrets:
            if s:
                al.add(SECRET, s)
        for cat, values in (known or {}).items():
            for v in values:
                if cat == TAGGER:
                    _add_gun_name(al, v)
                elif cat == BLE:
                    _add_ble(al, v)
                else:
                    al.add(cat, v)
        _collect_armory(al, armory_path)
        _collect_roster(al, roster_path)
        db = sqlite3.connect(str(work))
        try:
            _collect_install_identity(al, db)
            for _t, _c, _rid, val in _text_cells(db):
                parsed = None
                if val.lstrip()[:1] in ("{", "["):
                    try:
                        parsed = json.loads(val)
                    except ValueError:
                        parsed = None
                if isinstance(parsed, (dict, list)):
                    _collect_json(al, parsed)
                else:
                    _collect_text(al, val)
            for joined_text in _joined_log_chunks(db).values():
                _collect_text(al, joined_text)
            kinds = {str(k).lower() for (k,) in db.execute("SELECT DISTINCT kind FROM envelopes")} \
                if "envelopes" in _tables(db) else set()
        finally:
            db.close()
        log_text = log_path.read_text(encoding="utf-8", errors="replace") if log_path.is_file() else None
        manifest_text = manifest_path.read_text(encoding="utf-8", errors="replace") if manifest_path.is_file() else None
        for text in (log_text, manifest_text):
            if text:
                _collect_text(al, text)
        if manifest:
            _collect_json(al, manifest)

        # ---- pass 2: scrub the copy and the text files ----
        _scrub_db(al, work)
        files: dict[str, bytes] = {"session.sqlite": work.read_bytes()}
        missing = []
        if log_text is not None:
            files["mc.log"] = scrub_text(al, log_text).encode("utf-8")
        else:
            missing.append("mc.log")
        if manifest_text is not None:
            files["manifest.json"] = scrub_value(al, manifest_text).encode("utf-8")
        else:
            missing.append("manifest.json")
        from . import diag
        db = sqlite3.connect(str(work))
        try:
            diag_report = diag.build_report(db)
            schema = [sql for (sql,) in db.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL")]
            dump = "\n".join(line for line in db.iterdump() if not line.startswith(("CREATE ", "BEGIN", "COMMIT")))
            joined = _joined_log_chunks(db)
        finally:
            db.close()
        files["diag.json"] = scrub_value(al, json.dumps(diag_report, indent=1, default=str)).encode("utf-8")
        env = _environment(launch_id, repo, facts)
        env = json.loads(scrub_value(al, json.dumps(env)))
        files["environment.json"] = (json.dumps(env, indent=2) + "\n").encode("utf-8")
        name = f"open-brx-report-{launch_id}.zip"
        removed = {k: v for k, v in sorted(al.removed.items()) if v}
        members = ["README.txt", *files.keys()]
        files["README.txt"] = _readme(name, members, removed, env, missing).encode("utf-8")

        # ---- the guard: nothing is written unless every byte passes ----
        _guard(al, files, {"session.sqlite (SQL dump)": dump, **joined, "README.txt (launch id)": launch_id},
               schema=schema, prose_only=["README.txt"], vocabulary=kinds)

        out_dir.mkdir(parents=True, exist_ok=True)
        zip_path = out_dir / name
        # A unique part file per build: two concurrent POSTs each write their own, and os.replace
        # makes the last complete zip win; neither can interleave into the other.
        fd, part_name = tempfile.mkstemp(prefix=name + ".", suffix=".part", dir=str(out_dir))
        os.close(fd)
        part = Path(part_name)
        with zipfile.ZipFile(part, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for member in members:
                zf.writestr(member, files[member])
        os.replace(part, zip_path)

    size = zip_path.stat().st_size
    summary = {"launch_id": launch_id, "matches": facts.get("match_count", 0),
               "envelopes": facts.get("envelope_count", 0), "nodes": facts.get("node_count", 0),
               "phone_apps": env.get("phone_apps", []), "members": members, "missing": missing,
               "size_bytes": size, "aliases": dict(sorted(al.counts.items()))}
    return ReportResult(zip_path=zip_path, issue_url=issue_url(name, env), summary=summary,
                        removed=removed, size_bytes=size)


# ---------------------------------------------------------------- CLI ---- #

def sessions_root() -> Path:
    return home_dir() / "sessions"


def resolve_session(arg: str | None) -> tuple[Path, Path | None]:
    """SESSION -> (evidence dir, sqlite path). Accepts a launch id, an evidence dir, or a .sqlite file;
    with nothing, the newest launcher session that has a database, then the newest manual-run store."""
    if arg:
        p = Path(arg).expanduser()
        if p.is_file():
            return p.parent, p
        if p.is_dir():
            return p, None
        cand = sessions_root() / arg
        if cand.is_dir():
            return cand, None
        raise FileNotFoundError(f"no session called {arg!r} (looked in {sessions_root()})")
    root = sessions_root()
    dbs = sorted((d / "session.sqlite" for d in root.iterdir() if (d / "session.sqlite").is_file()),
                 key=lambda f: f.stat().st_mtime) if root.is_dir() else []
    if dbs:
        return dbs[-1].parent, None
    mc = home_dir() / "mc"
    manual = sorted(mc.glob("session-*.sqlite"), key=lambda f: f.stat().st_mtime) if mc.is_dir() else []
    if manual:
        return manual[-1].parent, manual[-1]
    raise FileNotFoundError("no Mission Control session found. Start Mission Control with ./start.sh "
                            "(start.cmd on Windows), open a session or play a match, then run this "
                            f"again. Looked in {root} and {mc}")


def _reveal(path: Path) -> None:
    """Show the zip in the file manager. Best effort: a failure only means the path is printed."""
    try:
        if sys.platform == "darwin":
            subprocess.Popen(["open", "-R", str(path)])
        elif os.name == "nt":
            subprocess.Popen(["explorer", f"/select,{path}"])
        else:
            subprocess.Popen(["xdg-open", str(path.parent)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m brx_mcp.mc.report",
                                 description="Make a scrubbed bug-report zip from a Mission Control session.")
    ap.add_argument("session", nargs="?", help="a launch id or a session folder (default: the newest session)")
    ap.add_argument("--out", default=None, help="where to write the zip (default: the session folder)")
    ap.add_argument("--json", action="store_true", help="print a JSON result instead of the friendly text")
    ap.add_argument("--open", action="store_true", help="open the GitHub issue form and show the zip")
    args = ap.parse_args(argv)
    try:
        evidence, sqlite_path = resolve_session(args.session)
        out = Path(args.out).expanduser() if args.out else (
            home_dir() / "reports" if sqlite_path is not None and sqlite_path.name != "session.sqlite" else None)
        res = build_report(evidence, out, sqlite_path=sqlite_path)
    except (FileNotFoundError, ReportLeak, sqlite3.Error) as e:
        if args.json:
            print(json.dumps({"error": str(e)}))
        else:
            print(f"Could not make the report: {e}", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(res.as_json(), indent=2))
    else:
        size = f"{res.size_bytes / (1024 * 1024):.1f} MB" if res.size_bytes >= 1024 * 1024 else f"{max(1, res.size_bytes // 1024)} KB"
        print(f"Your bug report is ready ({size}):\n  {res.zip_path}\n")
        if res.too_large:
            print("It is larger than 25 MB, which is GitHub's limit for an attachment. Make the issue\n"
                  "anyway and say so; a developer will ask for the file another way.\n")
        print("Names, tagger ids, PINs, addresses and tokens were replaced. GitHub issues are public,\n"
              "so open the zip and check it before you post it.\n")
        print("Next: " + ("drag the zip into the issue form that just opened, fill in what happened, and submit."
                          if args.open else "open this link, drag the zip into the form, and submit:\n  " + res.issue_url))
    if args.open:
        try:
            import webbrowser
            webbrowser.open(res.issue_url)
        except Exception:
            print(f"(could not open the browser; the link is {res.issue_url})")
        _reveal(res.zip_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
