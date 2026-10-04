"""F411 §6: FAVOURITES — a named bundle of the whole PLAY pick (docs/spec/design/games-presets.md §6).

Tony: "bundle everything on PLAY under a name, like a named LAST MATCH." A `Favourite` stores piece
REFERENCES (piece ids), not copies of their values -- editing a piece in BUILD changes what every
favourite that names it loads next, exactly like editing a piece changes what a live `game_pick`
composes. `FavouriteStore` owns `~/.brx-mcp/favourites.json` (atomic write, corrupt-file move-aside),
the same pattern `pieces.py` uses for its own shelf.

Resolving a favourite's piece ids against the live `PieceStore` (a stale/deleted id falls back to that
kind's first builtin) is `gamepick.resolve_pieces_with_fallback` -- `api.py`'s
`POST /api/favourites/{id}/load` route composes the result through the same path
`POST /api/play/pick` does.
"""
from __future__ import annotations

import copy
import json
import logging
import pathlib
import re
import time
import uuid
from typing import Any, Callable

from ..storage import home_dir
from .types import Favourite, GamePick, MatchSettings, PIECE_KINDS, FAVOURITES_STORE_V

log = logging.getLogger("brx.mc.favourites")

_NAME_MAX = 24
# The same arm-runway range `POST /api/start`/`POST /api/start/reschedule` already enforce (`api.py`'s
# `_int(..., 5, 900)`) -- a favourite's countdown is the same knob, just saved under a name.
_COUNTDOWN_MIN, _COUNTDOWN_MAX = 5, 900
# F413: the same closed vocabulary `gamepick.TEAM_COLOURS` names -- duplicated, not shared, the same way
# every check in this module has its own copy rather than importing `gamepick.py`'s (a favourite outlives
# the pick it was made from, so its own validation must not drift with a picker-side refactor).
_TEAM_COLOURS = frozenset({"red", "blue", "yellow", "purple"})


class FavouriteError(ValueError):
    def __init__(self, status: int, msg: str):
        super().__init__(msg)
        self.status = status


# Round 3, MEDIUM 5: every message here is the console's own ALL-CAPS "WHAT: DO" copy.
_ID_MAX = 64   # Low: a piece id this long is already nonsense; cap it rather than store it


def _check_name(name: object) -> str:
    if not isinstance(name, str) or not name.strip():
        raise FavouriteError(400, "NAME REQUIRED: TYPE A NAME FOR THIS FAVOURITE")
    name = " ".join(name.split())
    if len(name) > _NAME_MAX:
        raise FavouriteError(400, f"NAME TOO LONG: KEEP IT TO {_NAME_MAX} CHARACTERS OR FEWER")
    return name


def _check_countdown(v: object) -> int:
    if not (isinstance(v, int) and not isinstance(v, bool) and _COUNTDOWN_MIN <= v <= _COUNTDOWN_MAX):
        raise FavouriteError(400, f"COUNTDOWN MUST BE {_COUNTDOWN_MIN}-{_COUNTDOWN_MAX} SECONDS: PICK A NUMBER IN THAT RANGE")
    return v


def _check_match(v: object) -> MatchSettings:
    if not isinstance(v, dict):
        raise FavouriteError(400, "FAVOURITE NEEDS MATCH SETTINGS: SEND THE FULL BUNDLE")
    for k in ("night", "silenced"):
        if not isinstance(v.get(k), bool):
            raise FavouriteError(400, f"{k.upper()} MUST BE ON OR OFF: CHECK THE VALUE")
    for k in ("time_limit_s", "frag_limit", "hold_target_s"):
        val = v.get(k)
        if val is not None and not (isinstance(val, int) and not isinstance(val, bool)):
            raise FavouriteError(400, f"{k.upper()} MUST BE A WHOLE NUMBER OR EMPTY: CHECK THE VALUE")
    out: MatchSettings = {"time_limit_s": v.get("time_limit_s"), "frag_limit": v.get("frag_limit"),
                         "night": v["night"], "silenced": v["silenced"]}
    if v.get("hold_target_s") is not None:
        out["hold_target_s"] = v["hold_target_s"]
    # F413: absent is fine (the pick it was saved from had no real teams), present must be 2-4 unique
    # native colours -- same shape `gamepick.looks_like_pick` checks, this module's own copy of it.
    if "teams" in v:
        teams = v["teams"]
        if not (isinstance(teams, list) and 2 <= len(teams) <= 4
               and all(isinstance(c, str) and c in _TEAM_COLOURS for c in teams)
               and len(set(teams)) == len(teams)):
            raise FavouriteError(400, "TEAM COLOURS MUST BE 2-4 UNIQUE PICKS FROM RED, BLUE, YELLOW, PURPLE")
        out["teams"] = list(teams)
    return out


def check_pick(v: object) -> GamePick:
    """Shape only -- NOT whether the piece ids still exist (that is LOAD's own job, with a fallback,
    never a 400/404 at save time: games-presets.md §6, "stores piece references, not copies")."""
    if not isinstance(v, dict):
        raise FavouriteError(400, "FAVOURITE NEEDS A PICK: SEND THE FULL BUNDLE")
    pieces = v.get("pieces")
    if not isinstance(pieces, dict) or not all(k in pieces and isinstance(pieces[k], str) and pieces[k]
                                               and len(pieces[k]) <= _ID_MAX for k in PIECE_KINDS):
        raise FavouriteError(400, "FAVOURITE NEEDS EVERY PICKER'S PRESET: CHECK ALL EIGHT KINDS ARE NAMED")
    return {"pieces": {k: pieces[k] for k in PIECE_KINDS}, "match": _check_match(v.get("match"))}


class FavouriteStore:
    """CRUD over `Favourite` rows. `path=None` keeps the store in memory (tests / a throwaway host)."""

    def __init__(self, path: pathlib.Path | None, now_ms: Callable[[], int] | None = None):
        self.path = path
        self.now_ms = now_ms or (lambda: int(time.time() * 1000))
        self._rows: list[Favourite] = []
        self._load()

    # ---------- persistence ----------
    def _load(self) -> None:
        self._rows = []
        if not self.path or not self.path.exists():
            return
        try:
            raw = json.loads(self.path.read_text())
            v = raw.get("v") if isinstance(raw, dict) else None   # a list or a dict with no `v` is the first shape
            if v is not None and v != FAVOURITES_STORE_V:
                # D15: a store from another MC version (usually a newer one after a downgrade) is never guessed at
                # and never overwritten: it is kept beside the live file under its version, and this MC starts clean.
                tag = re.sub(r"[^0-9A-Za-z]", "", str(v))[:8] or "x"
                kept = self.path.with_name(f"{self.path.name}.v{tag}-{int(time.time() * 1000)}")
                self.path.replace(kept)
                log.warning("favourites.json was saved by an MC with store version %r; this MC reads %d. Kept as %s "
                            "(restore it with the MC that wrote it); starting clean", v, FAVOURITES_STORE_V, kept)
                return
            rows = raw.get("favourites") if isinstance(raw, dict) else raw
            if not isinstance(rows, list):
                raise ValueError("favourites.json: expected a list")
        except Exception as e:
            aside = self.path.with_name(f"{self.path.name}.corrupt-{int(time.time() * 1000)}")
            try:
                self.path.replace(aside)
            except Exception:
                pass
            log.error("favourites.json unreadable (%s) — moved aside to %s; starting empty", e, aside)
            return
        seen: set[str] = set()
        seen_ids: set[str] = set()
        for r in rows:
            try:
                row = self._clean_row(r)
            except Exception as e:
                log.warning("favourites.json: dropping favourite %r (%s)",
                           (r or {}).get("name") if isinstance(r, dict) else r, e)
                continue
            if row["favourite_id"] in seen_ids:
                log.warning("favourites.json: dropping duplicate favourite_id %r", row["favourite_id"])
                continue
            if row["name"].lower() in seen:
                log.warning("favourites.json: dropping duplicate name %r", row["name"])
                continue
            seen.add(row["name"].lower())
            seen_ids.add(row["favourite_id"])
            self._rows.append(row)

    def _clean_row(self, r: object) -> Favourite:
        if not isinstance(r, dict):
            raise ValueError("not a favourite object")
        name = _check_name(r.get("name"))
        pick = check_pick(r.get("pick"))
        countdown_s = _check_countdown(r.get("countdown_s"))
        raw_id = r.get("favourite_id")
        fid = raw_id if isinstance(raw_id, str) and raw_id else uuid.uuid4().hex[:8]
        now = self.now_ms()
        return {"favourite_id": fid, "name": name, "created_t": int(r.get("created_t") or now),
                "updated_t": int(r.get("updated_t") or now), "pick": pick, "countdown_s": countdown_s}

    def _save(self) -> None:
        if not self.path:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"v": FAVOURITES_STORE_V, "favourites": self._rows}, indent=1))
        tmp.replace(self.path)                                # atomic on POSIX + NTFS

    def _find_name(self, name: str, exclude_id: str | None = None) -> Favourite | None:
        return next((r for r in self._rows if r["name"].lower() == name.lower() and r["favourite_id"] != exclude_id), None)

    # ---------- CRUD ----------
    def list(self) -> list[Favourite]:
        return [copy.deepcopy(r) for r in self._rows]

    def get(self, favourite_id: str) -> Favourite:
        for r in self._rows:
            if r["favourite_id"] == favourite_id:
                return copy.deepcopy(r)
        raise FavouriteError(404, "FAVOURITE NOT FOUND: IT MAY HAVE BEEN DELETED")

    def create(self, name: object, countdown_s: object, pick: Any) -> Favourite:
        name = _check_name(name)
        if self._find_name(name):
            raise FavouriteError(409, "NAME ALREADY USED: PICK ANOTHER NAME FOR THIS FAVOURITE")
        cd = _check_countdown(countdown_s)
        pk = check_pick(pick)
        now = self.now_ms()
        row: Favourite = {"favourite_id": uuid.uuid4().hex[:8], "name": name, "created_t": now,
                          "updated_t": now, "pick": pk, "countdown_s": cd}
        self._rows.append(row)
        self._save()
        return copy.deepcopy(row)

    def update(self, favourite_id: str, name: object) -> Favourite:
        row = next((r for r in self._rows if r["favourite_id"] == favourite_id), None)
        if row is None:
            raise FavouriteError(404, "FAVOURITE NOT FOUND: IT MAY HAVE BEEN DELETED")
        name = _check_name(name)
        if self._find_name(name, exclude_id=favourite_id):
            raise FavouriteError(409, "NAME ALREADY USED: PICK ANOTHER NAME FOR THIS FAVOURITE")
        row["name"] = name
        row["updated_t"] = self.now_ms()
        self._save()
        return copy.deepcopy(row)

    def delete(self, favourite_id: str) -> None:
        before = len(self._rows)
        self._rows = [r for r in self._rows if r["favourite_id"] != favourite_id]
        if len(self._rows) == before:
            raise FavouriteError(404, "FAVOURITE NOT FOUND: IT MAY HAVE BEEN DELETED")
        self._save()


def default_path() -> pathlib.Path:
    return home_dir() / "favourites.json"   # home_dir(), not an import-time BASE_DIR (test isolation)
