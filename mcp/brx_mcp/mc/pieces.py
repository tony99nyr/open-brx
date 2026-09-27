"""F411: BUILD's preset store (docs/spec/design/games-presets.md §1) — GAMES = PLAY picks, BUILD creates.

`PieceStore` owns `~/.brx-mcp/pieces.json` (atomic write, corrupt-file move-aside), the same pattern the
old whole-game `presets.py` used. Every `value` is validated at create/update time through `check_value`,
which mirrors the SAME checks `PUT /api/config` runs (`policy._check_rule` for the slot kinds, the health
range and the respawn options in `compile.py`) — a piece can never carry a value the server would refuse
on the way into a game, and BUILD's bench-proven gate (games-presets.md §1) is enforced here, not just in
the console.

`mode` and `gameplay` builtins deliberately do NOT read `state.MODES`: `pieces.py` must not import
`state.py` (state.py imports `gamepick.py`, which imports this module — a cycle). The mode names/mvp
flags below are hand-kept in sync with `state.MODES`; `test_mc_pieces.py` cross-checks them.
"""
from __future__ import annotations

import copy
import json
import logging
import pathlib
import time
import uuid
from typing import Any, Callable, Mapping

from ..storage import home_dir
from . import policy as _policy
import functools

from .compile import HEALTH_PRESETS, WeaponCatalog, respawn_settings
from .perks import default_perks
from .types import GamePiece, PieceKind, PIECE_KINDS

log = logging.getLogger("brx.mc.pieces")

_NAME_MAX = 24
_NOTE_MAX = 80

# Kept in sync BY HAND with `state.MODES` (name, mvp) — see the module docstring for why this cannot be
# a live import. (mode, name, post_mvp).
_MODE_BUILTINS = (
    ("tdm", "TEAM DEATHMATCH", False),
    ("ffa", "FREE-FOR-ALL", False),
    ("koth", "KING OF THE HILL", False),
    ("infection", "INFECTION", True),
    ("lms", "LAST MAN STANDING", True),
    ("extraction", "EXTRACTION", True),
)

# The first (non-post_mvp) builtin of every kind — the fresh-install pick, and what a pre-F411 snapshot
# restores to for every kind but `mode` (`gamepick.derive_pick_from_config`). A plain module-level constant
# rather than something computed from a live store: it must be readable at session-restore time, before
# `__main__`/`api.py` has attached a real `PieceStore` (mirrors how `active_preset_id` used to be a bare
# string, resolved lazily).
BUILTIN_IDS: dict[str, str] = {
    "mode": "builtin:mode:tdm",
    "life": "builtin:life:standard",
    "spawn": "builtin:spawn:auto",
    "primary": "builtin:primary:all",
    "secondary": "builtin:secondary:all",
    "perks": "builtin:perks:all",
    "misc_loadouts": "builtin:misc_loadouts:standard",
    "gameplay": "builtin:gameplay:standard",
}


class PieceError(ValueError):
    def __init__(self, status: int, msg: str):
        super().__init__(msg)
        self.status = status


def _piece(piece_id: str, kind: PieceKind, name: str, value: Mapping[str, Any], *, note: str = "",
          builtin: bool = True, post_mvp: bool = False, t: int = 0, updated_t: int | None = None) -> GamePiece:
    return {"piece_id": piece_id, "kind": kind, "name": name, "note": note, "builtin": builtin,
            "post_mvp": post_mvp, "created_t": t, "updated_t": t if updated_t is None else updated_t,
            "value": dict(value)}


def _builtin_pieces() -> list[GamePiece]:
    """The shipped examples (games-presets.md §1). Never edited/deleted (403); BUILD copies one to start."""
    rows: list[GamePiece] = []
    for mode, name, post_mvp in _MODE_BUILTINS:
        rows.append(_piece(f"builtin:mode:{mode}", "mode", name, {"mode": mode}, post_mvp=post_mvp))
    for name_lower, (hp, armor, shield) in HEALTH_PRESETS.items():
        rows.append(_piece(f"builtin:life:{name_lower}", "life", name_lower.upper(),
                           {"max_hp": hp, "max_armor": armor, "max_shield": shield}))
    rows.append(_piece("builtin:spawn:auto", "spawn", "AUTO",
                       {"type": "auto", "delay_s": 15, "protect_s": 0, "weapon_delay_ms": 500}))
    rows.append(_piece("builtin:spawn:station", "spawn", "STATION",
                       {"type": "scanner", "delay_s": 10, "station_protect_s": 2, "gate": "trigger"}))
    _open = _policy.preset_rules("open")   # ALL is exactly the shipped OPEN rules, so it reads back "open"
    rows.append(_piece("builtin:primary:all", "primary", "ALL", _open["primary"]))
    rows.append(_piece("builtin:secondary:all", "secondary", "ALL", _open["secondary"]))
    rows.append(_piece("builtin:perks:all", "perks", "ALL", _open["perk"]))
    rows.append(_piece("builtin:misc_loadouts:standard", "misc_loadouts", "PLAYERS PICK · HEAVIES ON",
                       {"hud_select": True, "heavies": True}))
    rows.append(_piece("builtin:gameplay:standard", "gameplay", "OPEN BRX STANDARD", {"mode_params": {}}))
    assert {r["piece_id"] for r in rows} >= set(BUILTIN_IDS.values()), "BUILTIN_IDS drifted from _builtin_pieces()"
    return rows


# ---------- value validation (games-presets.md §1's bench-proven gate) ----------
# Round 3, MEDIUM 5: every message here is the console's own ALL-CAPS "WHAT: DO" copy, not raw mixed
# case -- the console shows `str(PieceError)` verbatim (`api.py _err`).
def _int_in(v: object, lo: int, hi: int, label: str) -> int:
    if not (isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi):
        raise PieceError(400, f"{label} MUST BE {lo}-{hi}: PICK A NUMBER IN THAT RANGE")
    return v


def _check_life(v: object) -> dict:
    if not isinstance(v, dict):
        raise PieceError(400, "LIFE PRESET NEEDS A VALUE: SEND MAX HP, MAX ARMOR AND MAX SHIELD")
    return {"max_hp": _int_in(v.get("max_hp"), 1, 255, "MAX HP"),
            "max_armor": _int_in(v.get("max_armor"), 0, 255, "MAX ARMOR"),
            "max_shield": _int_in(v.get("max_shield"), 0, 255, "MAX SHIELD")}


def _check_spawn(v: object) -> dict:
    if not isinstance(v, dict):
        raise PieceError(400, "SPAWN PRESET NEEDS A VALUE: SEND A RESPAWN TYPE AND DELAY")
    t = v.get("type")
    if t not in ("auto", "scanner"):
        # games-presets.md §1: "spawn.type is auto or scanner" — "none" is a mode default (post-MVP LMS),
        # never a host-built piece.
        raise PieceError(400, "SPAWN TYPE NOT SUPPORTED: USE AUTO OR STATION")
    d = _int_in(v.get("delay_s"), 0, 600, "RESPAWN DELAY")
    if d in (1, 2):
        raise PieceError(400, "RESPAWN DELAY OF 1-2S WEDGES THE HEADSET (F13): USE 0 (NO RESPAWN) OR 3 SECONDS OR MORE")
    try:
        respawn_settings(v)   # protect_s / weapon_delay_ms / station_protect_s: closed sets, compile.py
    except ValueError as e:
        # Low (brx1 review of 222b1a81): hand-written, not the raw `compile.respawn_settings` message
        # blindly uppercased -- "RESPAWN.PROTECT_S MUST BE ONE OF 0, 1, 2" leaks a Python attribute path
        # dressed up as house style, not actual house style.
        raise PieceError(400, "PROTECTION OR WEAPON-DELAY VALUE NOT SUPPORTED: PICK ONE OF THE OFFERED OPTIONS") from e
    out: dict[str, Any] = {"type": t, "delay_s": d}
    for k in ("protect_s", "weapon_delay_ms", "station_protect_s"):
        if k in v:
            out[k] = v[k]
    gate = v.get("gate")
    if gate is not None:
        if t != "scanner":
            raise PieceError(400, "GATE NOT APPLICABLE: ONLY A STATION (SCANNER) RESPAWN HAS A GATE")
        if gate != "trigger":
            # games-presets.md §1: only "trigger" is bench-proven; "presence" needs its own bench proof
            # (§13 of the brief) before BUILD can offer it.
            raise PieceError(400, "GATE NOT SUPPORTED: ONLY TRIGGER IS BENCH-PROVEN, NOT PRESENCE")
        out["gate"] = "trigger"
    return out


_SLOT_OF_KIND = {"primary": "primary", "secondary": "secondary", "perks": "perk"}


@functools.lru_cache(maxsize=1)
def _pickable_ids() -> tuple[frozenset[str], frozenset[str]]:
    """The weapon and perk ids a preset may name: the VISIBLE catalogues. A hidden row (the cut arsenal,
    melee, an unbenched perk) never reaches the console, so only a stale or hand-written request can
    name one; Tony 2026-09-26: no preset may ever select a hidden weapon."""
    # a pickup-only heavy is armed at a station in ARMORY, never carried from the start (games-redesign.md §7)
    return (frozenset(w["weapon_id"] for w in WeaponCatalog().all() if not w.get("pickup_only")),
            frozenset(default_perks().visible_ids()))


@functools.lru_cache(maxsize=1)
def _id_names() -> dict[str, str]:
    """id -> its catalogue display name, weapons and perks merged (disjoint id namespaces) -- so a
    refusal can say "FORCE RIFLE", not "force_rifle" (round 3, MEDIUM 5)."""
    names = {w["weapon_id"]: w["name"] for w in WeaponCatalog().all()}
    names.update({p["perk_id"]: p["name"] for p in default_perks().all()})
    return names


def _display(item_id: str) -> str:
    return _id_names().get(item_id, item_id.replace("_", " ")).upper()


def _check_slot(kind: PieceKind, v: object) -> dict:
    try:
        rule = _policy._check_rule(_SLOT_OF_KIND[kind], v if isinstance(v, dict) else {})
    except ValueError as e:
        # Low (brx1 review of 222b1a81): hand-written, same reason as `_check_spawn`'s own fix above --
        # `policy._check_rule`'s own message is a dotted `loadout_policy.<slot>.<field>` attribute path,
        # never meant for a console error strip.
        raise PieceError(400, "SLOT RULE NOT SUPPORTED: CHECK THE CHOICE, KINDS AND ID LISTS") from e
    weapons, perks = _pickable_ids()
    allowed = perks if kind == "perks" else weapons
    fixed = rule["fixed_id"]
    named: list[str] = ([fixed] if fixed else []) + list(rule["only_ids"])
    bad = [i for i in named if i not in allowed]
    if bad:
        # HIGH 1 / MEDIUM 5: the exact message a stored piece's `invalid` reason carries too, when a
        # weapon or perk it once named is later hidden or turned pickup-only.
        names = ", ".join(_display(i) for i in bad)
        verb = "IS" if len(bad) == 1 else "ARE"
        raise PieceError(400, f"NAMES {names}, WHICH {verb} NO LONGER OFFERED: PICK A DIFFERENT WEAPON OR PERK")
    return dict(rule)


def _check_misc_loadouts(v: object) -> dict:
    if not isinstance(v, dict) or not isinstance(v.get("hud_select"), bool) or not isinstance(v.get("heavies"), bool):
        raise PieceError(400, "MISC LOADOUTS PRESET NEEDS A VALUE: SEND WHO PICKS AND WHETHER HEAVIES ARE ON")
    return {"hud_select": v["hud_select"], "heavies": v["heavies"]}


def check_value(kind: PieceKind, value: object) -> dict:
    """The `PUT /api/config`-equivalent validator for one piece's `value`. Raises `PieceError`."""
    if isinstance(value, dict) and "station_source" in value:
        # games-presets.md §1: "a piece never carries `station_source` (the mode's own default and
        # ARMORY decide it)". Every kind-specific checker below only reads its OWN known keys, so an
        # extra `station_source` alongside them used to be silently dropped (QA-25, visual QA round 1)
        # -- an operator who typed it got a 200 and never learned it did nothing.
        raise PieceError(400, "STATION_SOURCE NOT ALLOWED HERE: THE MODE'S DEFAULT AND ARMORY DECIDE IT")
    if kind == "mode":
        raise PieceError(403, "GAME MODE HAS NO HOST-ADDED PRESETS: PICK ONE OF THE BUILT-IN MODES")
    if kind == "gameplay":
        raise PieceError(403, "GAMEPLAY HAS NO HOST-ADDED PRESETS YET: THIS PICKER IS POST-MVP")
    if kind == "life":
        return _check_life(value)
    if kind == "spawn":
        return _check_spawn(value)
    if kind in ("primary", "secondary", "perks"):
        return _check_slot(kind, value)
    if kind == "misc_loadouts":
        return _check_misc_loadouts(value)
    raise PieceError(400, "UNKNOWN PRESET KIND: PICK ONE OF THE EIGHT PICKERS")


class PieceStore:
    """CRUD over `GamePiece` rows, one JSON file, `path=None` keeps it in memory (tests)."""

    def __init__(self, path: pathlib.Path | None, now_ms: Callable[[], int] | None = None):
        self.path = path
        self.now_ms = now_ms or (lambda: int(time.time() * 1000))
        self._builtin: list[GamePiece] = _builtin_pieces()
        self._rows: list[GamePiece] = []
        self._load()

    # ---------- persistence ----------
    def _load(self) -> None:
        self._rows = []
        if not self.path or not self.path.exists():
            return
        try:
            raw = json.loads(self.path.read_text())
            rows = raw.get("pieces") if isinstance(raw, dict) else raw
            if not isinstance(rows, list):
                raise ValueError("pieces.json: expected a list")
        except Exception as e:
            aside = self.path.with_name(f"{self.path.name}.corrupt-{int(time.time())}")
            try:
                self.path.replace(aside)
            except Exception:
                pass
            log.error("pieces.json unreadable (%s) — moved aside to %s; starting with the builtins only", e, aside)
            return
        seen: set[tuple[str, str]] = set()
        seen_ids: set[str] = set()
        for r in rows:
            try:
                row = self._clean_row(r)
            except Exception as e:
                log.warning("pieces.json: dropping piece %r (%s)", (r or {}).get("name") if isinstance(r, dict) else r, e)
                continue
            if row["piece_id"] in seen_ids:
                # A hand-edited/duplicated file can carry two rows sharing an id -- `get`/`update`/
                # `delete` all resolve the FIRST match, so a silent second row is a live footgun
                # (edit ends up on the wrong one). Keep the first, drop the rest, same as a name clash.
                log.warning("pieces.json: dropping duplicate piece_id %r", row["piece_id"])
                continue
            key = (row["kind"], row["name"].lower())
            if key in seen or self._is_builtin_name(row["kind"], row["name"]):
                log.warning("pieces.json: dropping duplicate %s named %r", row["kind"], row["name"])
                continue
            seen.add(key)
            seen_ids.add(row["piece_id"])
            self._rows.append(row)

    def _clean_row(self, r: object) -> GamePiece:
        if not isinstance(r, dict):
            raise ValueError("not a piece object")
        kind = r.get("kind")
        if kind not in PIECE_KINDS:
            raise ValueError(f"bad kind {kind!r}")
        name = self._check_name(r.get("name"))
        note = self._check_note(r.get("note"))
        raw_value = r.get("value")
        invalid: str | None = None
        try:
            value = check_value(kind, raw_value)
        except PieceError as e:
            # HIGH 1: a value the CURRENT rules refuse (a weapon since hidden or turned pickup-only, a
            # rule tightened elsewhere) is KEPT, marked `invalid`, not dropped -- deleting a host's saved
            # work over a rule change made somewhere else is worse than showing it read-only. `mode` and
            # `gameplay` are never host-created at all (`check_value` 403s them unconditionally, so a
            # stored row of either kind is malformed from birth, not a rule-drift casualty) -- and a
            # `value` that is not even an object is too broken to keep either way.
            if kind in ("mode", "gameplay") or not isinstance(raw_value, dict):
                raise ValueError(f"bad value: {e}") from e
            value = raw_value
            invalid = str(e).upper()
        raw_pid = r.get("piece_id")
        pid = raw_pid if isinstance(raw_pid, str) and raw_pid and not raw_pid.startswith("builtin:") else uuid.uuid4().hex[:8]
        now = self.now_ms()
        row = _piece(pid, kind, name, value, note=note, builtin=False, post_mvp=False,
                    t=int(r.get("created_t") or now), updated_t=int(r.get("updated_t") or r.get("created_t") or now))
        if invalid:
            row["invalid"] = invalid
        return row

    def _save(self) -> None:
        if not self.path:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"v": 1, "pieces": self._rows}, indent=1))
        tmp.replace(self.path)                                # atomic on POSIX + NTFS

    # ---------- validation ----------
    @staticmethod
    def _check_name(name: object) -> str:
        if not isinstance(name, str) or not name.strip():
            raise PieceError(400, "NAME REQUIRED: TYPE A NAME FOR THIS PRESET")
        name = " ".join(name.split())
        if len(name) > _NAME_MAX:
            raise PieceError(400, f"NAME TOO LONG: KEEP IT TO {_NAME_MAX} CHARACTERS OR FEWER")
        return name

    @staticmethod
    def _check_note(note: object) -> str:
        if note is None or note == "":
            return ""
        if not isinstance(note, str) or "\n" in note or "\r" in note:
            raise PieceError(400, "NOTE MUST BE ONE LINE: REMOVE THE LINE BREAK")
        if len(note) > _NOTE_MAX:
            raise PieceError(400, f"NOTE TOO LONG: KEEP IT TO {_NOTE_MAX} CHARACTERS OR FEWER")
        return note

    def _is_builtin_name(self, kind: str, name: str) -> bool:
        return any(b["kind"] == kind and b["name"].lower() == name.lower() for b in self._builtin)

    def _find_name(self, kind: str, name: str, exclude_id: str | None = None) -> GamePiece | None:
        return next((r for r in self._rows if r["kind"] == kind and r["name"].lower() == name.lower()
                    and r["piece_id"] != exclude_id), None)

    def _check_new_name(self, kind: str, name: object, exclude_id: str | None = None) -> str:
        """Shared by `create`/`update`: the two name refusals, in the console's own copy (MEDIUM 5). The
        brief's own example is the 409 -- "NAME ALREADY USED: PICK ANOTHER NAME FOR THIS LIFE PRESET"."""
        checked = self._check_name(name)
        if self._is_builtin_name(kind, checked):
            raise PieceError(403, f"NAME ALREADY USED: \"{checked}\" IS A BUILT-IN {kind.upper()} PRESET, PICK ANOTHER NAME")
        if self._find_name(kind, checked, exclude_id=exclude_id):
            raise PieceError(409, f"NAME ALREADY USED: PICK ANOTHER NAME FOR THIS {kind.upper()} PRESET")
        return checked

    # ---------- CRUD ----------
    def list(self) -> list[GamePiece]:
        return [copy.deepcopy(b) for b in self._builtin] + [copy.deepcopy(r) for r in self._rows]

    def get(self, piece_id: str) -> GamePiece:
        for r in self._builtin + self._rows:
            if r["piece_id"] == piece_id:
                return copy.deepcopy(r)
        raise PieceError(404, "PRESET NOT FOUND: IT MAY HAVE BEEN DELETED")

    def create(self, kind: object, name: object, note: object, value: object) -> GamePiece:
        if kind not in PIECE_KINDS:
            raise PieceError(400, "UNKNOWN PRESET KIND: PICK ONE OF THE EIGHT PICKERS")
        if kind in ("mode", "gameplay"):
            raise PieceError(403, f"{kind.upper()} HAS NO HOST-ADDED PRESETS: BUILD CANNOT CREATE ONE HERE")
        checked_name = self._check_new_name(kind, name)
        checked_note = self._check_note(note)
        val = check_value(kind, value)
        now = self.now_ms()
        row = _piece(uuid.uuid4().hex[:8], kind, checked_name, val, note=checked_note,
                    builtin=False, post_mvp=False, t=now)
        self._rows.append(row)
        self._save()
        return copy.deepcopy(row)

    def update(self, piece_id: str, name: object = None, note: object = None, value: object = None) -> GamePiece:
        """MEDIUM 2 (round 3): every field is VALIDATED before anything is ASSIGNED -- a 400 on `value`
        must leave `name`/`note` (and the row generally) exactly as they were, in memory and on disk,
        not partially applied. `_check_new_name` alone would raise before the row is touched at all."""
        if any(b["piece_id"] == piece_id for b in self._builtin):
            raise PieceError(403, "BUILT-IN PRESET: COPY IT WITH NEW ▸, THEN EDIT THE COPY")
        row = next((r for r in self._rows if r["piece_id"] == piece_id), None)
        if row is None:
            raise PieceError(404, "PRESET NOT FOUND: IT MAY HAVE BEEN DELETED")
        new_name = row["name"] if name is None else self._check_new_name(row["kind"], name, exclude_id=piece_id)
        new_note = row["note"] if note is None else self._check_note(note)
        new_value = row["value"] if value is None else check_value(row["kind"], value)
        # every check passed -- assign now, in one go
        row["name"] = new_name
        row["note"] = new_note
        row["value"] = new_value
        if value is not None:
            row.pop("invalid", None)   # HIGH 1: a value the current rules accept again clears the flag
        row["updated_t"] = self.now_ms()
        self._save()
        return copy.deepcopy(row)

    def delete(self, piece_id: str) -> None:
        if any(b["piece_id"] == piece_id for b in self._builtin):
            raise PieceError(403, "BUILT-IN PRESET: IT CANNOT BE DELETED")
        before = len(self._rows)
        self._rows = [r for r in self._rows if r["piece_id"] != piece_id]
        if len(self._rows) == before:
            raise PieceError(404, "PRESET NOT FOUND: IT MAY HAVE BEEN DELETED")
        self._save()


def default_path() -> pathlib.Path:
    return home_dir() / "pieces.json"   # home_dir(), not an import-time BASE_DIR: BRX_MCP_HOME must redirect this (test isolation)
