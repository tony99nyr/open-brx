"""F411 §6: FAVOURITES — a named bundle of the whole PLAY pick (docs/spec/design/games-presets.md §6).

Tony: "bundle everything on PLAY under a name, like a named LAST MATCH." A `Favourite` stores piece
REFERENCES (piece ids), not copies of their values -- editing a piece in BUILD changes what every
favourite that names it loads next, exactly like editing a piece changes what a live `game_pick`
composes. `FavouriteStore` owns `~/.brx-mcp/favourites.json` (atomic write, corrupt-file move-aside),
the same pattern `pieces.py` uses for its own shelf.

Resolving a favourite's piece ids against the live `PieceStore` (a stale/deleted id falls back to that
kind's first builtin) is `gamepick.resolve_pieces_with_fallback` -- `routes/config_game.py`'s
`POST /api/favourites/{id}/load` route composes the result through the same path
`POST /api/play/pick` does.
"""
from __future__ import annotations

import copy
import json
import logging
import pathlib
import time
import uuid
from typing import Any, Callable

from ..storage import atomic_write_text, home_dir, load_versioned
from .gamepick import hill_valid
from .types import HILL_CAPTURE_S_MAX, HILL_CAPTURE_S_MIN, HILL_NET_CAP_MAX, HILL_NET_CAP_MIN, Favourite, GamePick, MatchSettings, PIECE_KINDS, FAVOURITES_STORE_V, RUNWAY_MAX_S, RUNWAY_MIN_S, TEAM_COUNT_MAX, TEAM_COUNT_MIN, TEAM_KEYS
from .named_store import StoreError, check_name

log = logging.getLogger("brx.mc.favourites")

# F413: the four native $TID teams. A15: taken from types.TeamColour (a frozen wire vocabulary, so a favourite saved
# today still validates after any picker-side refactor), not restated here.
_TEAM_COLOURS = frozenset(TEAM_KEYS)


FavouriteError = StoreError


# Round 3, MEDIUM 5: every message here is the console's own ALL-CAPS "WHAT: DO" copy.
_ID_MAX = 64   # Low: a piece id this long is already nonsense; cap it rather than store it


def _check_name(name: object) -> str:
    return check_name(name, "favourite")


def _check_countdown(v: object) -> int:
    if not (isinstance(v, int) and not isinstance(v, bool) and RUNWAY_MIN_S <= v <= RUNWAY_MAX_S):
        raise FavouriteError(400, f"COUNTDOWN MUST BE {RUNWAY_MIN_S}-{RUNWAY_MAX_S} SECONDS: PICK A NUMBER IN THAT RANGE")
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
    if "hill" in v:
        if not hill_valid(v["hill"]):
            raise FavouriteError(400, f"HILL SETTINGS MUST BE CAPTURE_S {HILL_CAPTURE_S_MIN}-{HILL_CAPTURE_S_MAX} AND/OR NET_CAP "
                                       f"{HILL_NET_CAP_MIN}-{HILL_NET_CAP_MAX}, WHOLE NUMBERS: CHECK THE VALUES")
        if v["hill"]:
            out["hill"] = dict(v["hill"])
    # F413: absent is fine (the pick it was saved from had no real teams), present must be 2-4 unique
    # native colours -- same shape `gamepick.looks_like_pick` checks, this module's own copy of it.
    if "teams" in v:
        teams = v["teams"]
        if not (isinstance(teams, list) and TEAM_COUNT_MIN <= len(teams) <= TEAM_COUNT_MAX
               and all(isinstance(c, str) and c in _TEAM_COLOURS for c in teams)
               and len(set(teams)) == len(teams)):
            raise FavouriteError(400, f"TEAM COLOURS MUST BE {TEAM_COUNT_MIN}-{TEAM_COUNT_MAX} UNIQUE PICKS FROM "
                                       f"{', '.join(c.upper() for c in TEAM_KEYS)}")
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
        if not self.path:
            return
        rows = load_versioned(self.path, FAVOURITES_STORE_V, "favourites", log, "starting empty")
        if rows is None:              # load_versioned logged why: the operator's file stays where it is, untouched
            self.path = None
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
        atomic_write_text(self.path, json.dumps({"v": FAVOURITES_STORE_V, "favourites": self._rows}, indent=1))

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
