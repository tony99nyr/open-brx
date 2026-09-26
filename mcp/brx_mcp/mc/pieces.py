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
from .compile import HEALTH_PRESETS, respawn_settings
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
def _int_in(v: object, lo: int, hi: int, field: str) -> int:
    if not (isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi):
        raise PieceError(400, f"{field} must be an integer {lo}..{hi}")
    return v


def _check_life(v: object) -> dict:
    if not isinstance(v, dict):
        raise PieceError(400, "life value must be an object")
    return {"max_hp": _int_in(v.get("max_hp"), 1, 255, "life.max_hp"),
            "max_armor": _int_in(v.get("max_armor"), 0, 255, "life.max_armor"),
            "max_shield": _int_in(v.get("max_shield"), 0, 255, "life.max_shield")}


def _check_spawn(v: object) -> dict:
    if not isinstance(v, dict):
        raise PieceError(400, "spawn value must be an object")
    t = v.get("type")
    if t not in ("auto", "scanner"):
        # games-presets.md §1: "spawn.type is auto or scanner" — "none" is a mode default (post-MVP LMS),
        # never a host-built piece.
        raise PieceError(400, "spawn.type must be auto|scanner (a bench-proven respawn mechanism)")
    d = _int_in(v.get("delay_s"), 0, 600, "spawn.delay_s")
    if d in (1, 2):
        raise PieceError(400, "spawn.delay_s of 1-2s wedges the headset in the relay's out-blink (F13); "
                              "use 0 (no respawn) or >= 3")
    try:
        respawn_settings(v)   # protect_s / weapon_delay_ms / station_protect_s: closed sets, compile.py
    except ValueError as e:
        raise PieceError(400, str(e)) from e
    out: dict[str, Any] = {"type": t, "delay_s": d}
    for k in ("protect_s", "weapon_delay_ms", "station_protect_s"):
        if k in v:
            out[k] = v[k]
    gate = v.get("gate")
    if gate is not None:
        if t != "scanner":
            raise PieceError(400, "spawn.gate only applies to a scanner (station) respawn")
        if gate != "trigger":
            # games-presets.md §1: only "trigger" is bench-proven; "presence" needs its own bench proof
            # (§13 of the brief) before BUILD can offer it.
            raise PieceError(400, "spawn.gate: only \"trigger\" is bench-proven — \"presence\" is not yet supported")
        out["gate"] = "trigger"
    return out


_SLOT_OF_KIND = {"primary": "primary", "secondary": "secondary", "perks": "perk"}


def _check_slot(kind: PieceKind, v: object) -> dict:
    try:
        return dict(_policy._check_rule(_SLOT_OF_KIND[kind], v if isinstance(v, dict) else {}))
    except ValueError as e:
        raise PieceError(400, str(e)) from e


def _check_misc_loadouts(v: object) -> dict:
    if not isinstance(v, dict) or not isinstance(v.get("hud_select"), bool) or not isinstance(v.get("heavies"), bool):
        raise PieceError(400, "misc_loadouts value must be {hud_select: bool, heavies: bool}")
    return {"hud_select": v["hud_select"], "heavies": v["heavies"]}


def check_value(kind: PieceKind, value: object) -> dict:
    """The `PUT /api/config`-equivalent validator for one piece's `value`. Raises `PieceError`."""
    if isinstance(value, dict) and "station_source" in value:
        # games-presets.md §1: "a piece never carries `station_source` (the mode's own default and
        # ARMORY decide it)". Every kind-specific checker below only reads its OWN known keys, so an
        # extra `station_source` alongside them used to be silently dropped (QA-25, visual QA round 1)
        # -- an operator who typed it got a 200 and never learned it did nothing.
        raise PieceError(400, "a piece may not carry station_source — the mode's default and ARMORY decide it")
    if kind == "mode":
        raise PieceError(403, "GAME MODE has no host-added pieces")
    if kind == "gameplay":
        raise PieceError(403, "GAMEPLAY has no host-added pieces yet (post-MVP, games-redesign.md §15)")
    if kind == "life":
        return _check_life(value)
    if kind == "spawn":
        return _check_spawn(value)
    if kind in ("primary", "secondary", "perks"):
        return _check_slot(kind, value)
    if kind == "misc_loadouts":
        return _check_misc_loadouts(value)
    raise PieceError(400, f"unknown kind {kind!r}")


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
        value = check_value(kind, r.get("value"))   # a value the server would now refuse drops the whole row
        raw_pid = r.get("piece_id")
        pid = raw_pid if isinstance(raw_pid, str) and raw_pid and not raw_pid.startswith("builtin:") else uuid.uuid4().hex[:8]
        now = self.now_ms()
        return _piece(pid, kind, name, value, note=note, builtin=False, post_mvp=False,
                     t=int(r.get("created_t") or now), updated_t=int(r.get("updated_t") or r.get("created_t") or now))

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
            raise PieceError(400, "name is required")
        name = " ".join(name.split())
        if len(name) > _NAME_MAX:
            raise PieceError(400, f"name must be {_NAME_MAX} characters or fewer")
        return name

    @staticmethod
    def _check_note(note: object) -> str:
        if note is None or note == "":
            return ""
        if not isinstance(note, str) or "\n" in note or "\r" in note:
            raise PieceError(400, "note must be one line")
        if len(note) > _NOTE_MAX:
            raise PieceError(400, f"note must be {_NOTE_MAX} characters or fewer")
        return note

    def _is_builtin_name(self, kind: str, name: str) -> bool:
        return any(b["kind"] == kind and b["name"].lower() == name.lower() for b in self._builtin)

    def _find_name(self, kind: str, name: str, exclude_id: str | None = None) -> GamePiece | None:
        return next((r for r in self._rows if r["kind"] == kind and r["name"].lower() == name.lower()
                    and r["piece_id"] != exclude_id), None)

    # ---------- CRUD ----------
    def list(self) -> list[GamePiece]:
        return [copy.deepcopy(b) for b in self._builtin] + [copy.deepcopy(r) for r in self._rows]

    def get(self, piece_id: str) -> GamePiece:
        for r in self._builtin + self._rows:
            if r["piece_id"] == piece_id:
                return copy.deepcopy(r)
        raise PieceError(404, "no such piece")

    def create(self, kind: object, name: object, note: object, value: object) -> GamePiece:
        if kind not in PIECE_KINDS:
            raise PieceError(400, f"kind must be one of {PIECE_KINDS}")
        if kind in ("mode", "gameplay"):
            raise PieceError(403, f"{kind} has no host-added pieces")
        name = self._check_name(name)
        if self._is_builtin_name(kind, name):
            raise PieceError(403, f"\"{name}\" is a built-in name — pick another")
        if self._find_name(kind, name):
            raise PieceError(409, f"a {kind} piece named \"{name}\" already exists")
        val = check_value(kind, value)
        now = self.now_ms()
        row = _piece(uuid.uuid4().hex[:8], kind, name, val, note=self._check_note(note),
                    builtin=False, post_mvp=False, t=now)
        self._rows.append(row)
        self._save()
        return copy.deepcopy(row)

    def update(self, piece_id: str, name: object = None, note: object = None, value: object = None) -> GamePiece:
        if any(b["piece_id"] == piece_id for b in self._builtin):
            raise PieceError(403, "a built-in piece can't be edited — copy it, tune it, then NEW ▸")
        row = next((r for r in self._rows if r["piece_id"] == piece_id), None)
        if row is None:
            raise PieceError(404, "no such piece")
        if name is not None:
            name = self._check_name(name)
            if self._is_builtin_name(row["kind"], name):
                raise PieceError(403, f"\"{name}\" is a built-in name — pick another")
            if self._find_name(row["kind"], name, exclude_id=piece_id):
                raise PieceError(409, f"a {row['kind']} piece named \"{name}\" already exists")
            row["name"] = name
        if note is not None:
            row["note"] = self._check_note(note)
        if value is not None:
            row["value"] = check_value(row["kind"], value)
        row["updated_t"] = self.now_ms()
        self._save()
        return copy.deepcopy(row)

    def delete(self, piece_id: str) -> None:
        if any(b["piece_id"] == piece_id for b in self._builtin):
            raise PieceError(403, "a built-in piece can't be deleted")
        before = len(self._rows)
        self._rows = [r for r in self._rows if r["piece_id"] != piece_id]
        if len(self._rows) == before:
            raise PieceError(404, "no such piece")
        self._save()


def default_path() -> pathlib.Path:
    return home_dir() / "pieces.json"   # home_dir(), not an import-time BASE_DIR: BRX_MCP_HOME must redirect this (test isolation)
