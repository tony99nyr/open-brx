"""F411: `GamePick` (docs/spec/design/games-presets.md §2/§3) — what PLAY has chosen, and the pure
function that composes a `GameConfig` patch from it.

Deliberately has NO import of `state.py`: `state.py` imports this module, so the reverse would be a
cycle. Anything that needs a mode's own defaults (`default_config`, `state.MODES`) takes it as an
argument from the caller (`api.py`'s `/api/play/pick` route), which already owns both.
"""
from __future__ import annotations

from typing import Any, Container, Mapping, cast

from . import presentation as _pres
from .pieces import BUILTIN_IDS, PieceError, PieceStore
from .types import GamePick, GamePiece, MatchSettings, PieceKind, PIECE_KINDS


def default_match(time_limit_s: int | None, frag_limit: int | None) -> MatchSettings:
    return {"time_limit_s": time_limit_s, "frag_limit": frag_limit, "night": False, "silenced": False}


def default_pick(default_config: Any) -> GamePick:
    """A fresh session: the first builtin of every kind, the strip at TDM's own defaults (§2)."""
    cfg = default_config("tdm")
    return {"pieces": dict(BUILTIN_IDS),
            "match": default_match(cfg["time_limit_s"], (cfg.get("scoring") or {}).get("frag_limit"))}


def match_from_config(config: Mapping[str, Any]) -> MatchSettings:
    """The MATCH SETTINGS strip a `GameConfig` implies (H2, polish round 1) -- used both to derive a
    pick from a pre-F411 config (`derive_pick_from_config`) and to keep a live `game_pick.match` truthful
    to whatever `set_config` just committed (`Session._sync_game_pick_from_config`), so the two never
    drift into two different call sites disagreeing about the same four fields."""
    return {"time_limit_s": config.get("time_limit_s"),
            "frag_limit": (config.get("scoring") or {}).get("frag_limit"),
            "night": bool(config.get("night")),
            "silenced": (config.get("presentation") or {}).get("preset") == "silenced"}


def looks_like_pick(gp: object) -> bool:
    """Shape only, for trusting a persisted/restored `game_pick` (M1, polish round 1: piece EXISTENCE
    is never checked here -- that is `Session.attach_pieces`'s own job, with a fallback, not a reason
    to distrust the pick's shape)."""
    if not (isinstance(gp, dict) and isinstance(gp.get("pieces"), dict)
           and all(k in gp["pieces"] and isinstance(gp["pieces"][k], str) for k in PIECE_KINDS)):
        return False
    match = gp.get("match")
    if not (isinstance(match, dict) and isinstance(match.get("night"), bool) and isinstance(match.get("silenced"), bool)):
        return False
    # A bool is an int in Python, but never a legal time_limit_s/frag_limit -- `favourites._check_match`
    # already excludes it the same way (Low, round 2).
    for k in ("time_limit_s", "frag_limit"):
        v = match.get(k)
        if v is not None and not (isinstance(v, int) and not isinstance(v, bool)):
            return False
    return True


def derive_pick_from_config(config: Mapping[str, Any], mvp_modes: frozenset[str]) -> GamePick:
    """§2: a session restored from before F411 has no `game_pick`. `mode` = the config's own mode if it
    is an MVP mode, else tdm; every other kind = its first builtin; the strip = the config's own values.
    MC does NOT recompose the config here — this only names what PLAY shows as picked."""
    mode = config.get("mode")
    ids = dict(BUILTIN_IDS)
    ids["mode"] = f"builtin:mode:{mode if mode in mvp_modes else 'tdm'}"
    return {"pieces": ids, "match": match_from_config(config)}


# ---------- resolving a POST /api/play/pick body ----------
_ID_MAX = 64   # Low (round 3): a piece/favourite id this long is already nonsense; cap it rather than store it


def merge_piece_ids(prev_ids: Mapping[str, str], patch_ids: Mapping[str, Any]) -> dict[str, str]:
    if not isinstance(patch_ids, Mapping):
        raise PieceError(400, "PIECES MUST BE AN OBJECT: SEND {KIND: PIECE_ID} PAIRS")
    ids = dict(prev_ids)
    for kind, pid in patch_ids.items():
        if kind not in PIECE_KINDS:
            raise PieceError(400, "UNKNOWN PRESET KIND: PICK ONE OF THE EIGHT PICKERS")
        if not isinstance(pid, str) or not pid or len(pid) > _ID_MAX:
            raise PieceError(400, f"{kind.upper()} PICK MUST BE A PIECE ID: SEND THE PRESET'S OWN ID STRING")
        ids[kind] = pid
    return ids


def _check_strict(kind: PieceKind, piece: GamePiece) -> None:
    """A piece a REQUEST itself named must be usable outright: wrong kind, post-MVP or `invalid` (HIGH
    1, round 3: a rule-drift casualty -- a weapon it names since hidden or turned pickup-only) are each
    the operator's own mistake to fix, not something a strict resolve papers over."""
    if piece["kind"] != kind:
        raise PieceError(400, f"WRONG PRESET KIND: THAT ID IS A {piece['kind'].upper()} PRESET, NOT {kind.upper()}")
    if piece.get("post_mvp"):
        raise PieceError(400, f"{piece['name'].upper()} IS POST-MVP: NOT OFFERED ON PLAY YET")
    if reason := piece.get("invalid"):
        raise PieceError(400, f"{piece['name'].upper()} CAN'T BE PICKED: {reason}")


def _usable(kind: PieceKind, candidate: GamePiece) -> bool:
    """A piece a kind merely INHERITED may fall back past instead of raising: the same three faults
    `_check_strict` refuses outright, just tolerated here (HIGH 1: `invalid` joins post_mvp/wrong-kind)."""
    return candidate["kind"] == kind and not candidate.get("post_mvp") and not candidate.get("invalid")


def resolve_pieces(store: PieceStore, ids: Mapping[str, str]) -> dict[PieceKind, GamePiece]:
    """Every kind's picked `GamePiece`, or a `PieceError` naming the first thing wrong with it."""
    resolved: dict[PieceKind, GamePiece] = {}
    for kind in PIECE_KINDS:
        pid = ids.get(kind)
        if not pid:
            raise PieceError(400, f"NO {kind.upper()} PICKED: CHOOSE A PRESET FOR THIS KIND")
        piece = store.get(pid)                        # PieceError(404) if the id is unknown
        _check_strict(kind, piece)
        resolved[kind] = piece
    return resolved


def resolve_pieces_with_fallback(store: PieceStore, ids: Mapping[str, str]) -> tuple[dict[PieceKind, GamePiece], list[PieceKind]]:
    """§6 FAVOURITES LOAD: like `resolve_pieces`, but a favourite outlives the pieces it named, so a
    missing/wrong-kind/post_mvp/invalid id falls back to that kind's first builtin instead of raising --
    named in the returned list (`fallbacks`) rather than a 404 for the whole favourite."""
    resolved: dict[PieceKind, GamePiece] = {}
    fallbacks: list[PieceKind] = []
    for kind in PIECE_KINDS:
        pid = ids.get(kind)
        piece = None
        if pid:
            try:
                candidate = store.get(pid)
                if _usable(kind, candidate):
                    piece = candidate
            except PieceError:
                piece = None
        if piece is None:
            piece = store.get(BUILTIN_IDS[kind])
            fallbacks.append(kind)
        resolved[kind] = piece
    return resolved, fallbacks


def resolve_pieces_mixed(store: PieceStore, ids: Mapping[str, str],
                         strict_kinds: Container[str]) -> tuple[dict[PieceKind, GamePiece], list[PieceKind]]:
    """M1 (polish round 1): `POST /api/play/pick` resolves a kind the REQUEST itself named (`strict_kinds`)
    exactly like `resolve_pieces` -- an unknown/wrong-kind/post_mvp/invalid id there is still a 400/404,
    the operator's own mistake to fix. A kind merely INHERITED from the previous `game_pick` (a session/
    snapshot that drifted from the pieces shelf, or one H2's own `_sync_game_pick_from_config` pointed
    at a post_mvp mode via a plain `PUT /api/config`) falls back to that kind's first builtin instead,
    same grace as `resolve_pieces_with_fallback` -- a stale id nobody asked to change must never 404 an
    unrelated pick. Returns the fallen-back kinds too (Low, round 2): `POST /api/play/pick` reports them
    in `fallbacks`, the same as FAVOURITES LOAD, so the console can say so."""
    resolved: dict[PieceKind, GamePiece] = {}
    fallbacks: list[PieceKind] = []
    for kind in PIECE_KINDS:
        pid = ids.get(kind)
        if kind in strict_kinds:
            if not pid:
                raise PieceError(400, f"NO {kind.upper()} PICKED: CHOOSE A PRESET FOR THIS KIND")
            piece = store.get(pid)                        # PieceError(404) if the id is unknown
            _check_strict(kind, piece)
            resolved[kind] = piece
            continue
        piece = None
        if pid:
            try:
                candidate = store.get(pid)
                if _usable(kind, candidate):
                    piece = candidate
            except PieceError:
                piece = None
        if piece is None:
            piece = store.get(BUILTIN_IDS[kind])
            fallbacks.append(kind)
        resolved[kind] = piece
    return resolved, fallbacks


def _opt_int(v: object, label: str) -> int | None:
    if v is None:
        return None
    if not (isinstance(v, int) and not isinstance(v, bool)):
        raise PieceError(400, f"{label} MUST BE A WHOLE NUMBER OR EMPTY: CHECK THE VALUE")
    return v


def merge_match(prev: MatchSettings, patch: Mapping[str, Any]) -> MatchSettings:
    """A partial `MatchSettings` patch onto the current strip. Shape-checked only — the exact ranges
    (`time_limit_s` 1..7200, `frag_limit` > 0) are `set_config`'s own `_merge_config` checks, run on the
    composed patch, so there is exactly one place that owns them."""
    if not isinstance(patch, Mapping):
        raise PieceError(400, "MATCH SETTINGS MUST BE AN OBJECT: CHECK THE REQUEST")
    out = dict(prev)
    if "time_limit_s" in patch:
        out["time_limit_s"] = _opt_int(patch["time_limit_s"], "TIME LIMIT")
    if "frag_limit" in patch:
        out["frag_limit"] = _opt_int(patch["frag_limit"], "KILL LIMIT")
    for field in ("night", "silenced"):
        if field in patch:
            if not isinstance(patch[field], bool):
                raise PieceError(400, f"{field.upper()} MUST BE ON OR OFF: CHECK THE VALUE")
            out[field] = patch[field]
    return cast(MatchSettings, out)


# ---------- composing the GameConfig patch (§3) ----------
def compose(resolved: Mapping[PieceKind, GamePiece], match: MatchSettings, mode_row: Mapping[str, Any]) -> dict:
    """Pure: the `GameConfig` patch for `Session.set_config` (fed through the SAME phase gating, RECAP
    roll-forward and re-announce `PUT /api/config` already has). `mode_row` is the picked mode's own
    `state.MODES` row — used for the "respawn.type == 'none' keeps its own respawn" rule and the mode's
    day-mode presentation preset. Does not decide default_config(mode) vs the current config for an
    unclaimed field (stations, powerups, vip, stun): `set_config` already does that (item 1, §3)."""
    life = dict(resolved["life"]["value"])
    spawn = dict(resolved["spawn"]["value"])
    primary = dict(resolved["primary"]["value"])
    secondary = dict(resolved["secondary"]["value"])
    perk = dict(resolved["perks"]["value"])
    misc = resolved["misc_loadouts"]["value"]
    gameplay = resolved["gameplay"]["value"]

    patch: dict[str, Any] = {"mode": resolved["mode"]["value"]["mode"], "health": life}
    if (mode_row.get("respawn") or {}).get("type") != "none":
        patch["respawn"] = spawn
    if not misc.get("heavies", True):
        # games-presets.md §3.4: the blanket exclude applies UNLESS the slot piece already carries its
        # own exclude_tags — that piece's own choice wins.
        if not primary.get("exclude_tags"):
            primary = {**primary, "exclude_tags": ["heavy"]}
        if not secondary.get("exclude_tags"):
            secondary = {**secondary, "exclude_tags": ["heavy"]}
    # "open" makes `policy.merge` reset to the open rules BEFORE it lays the three slot pieces on top, so no rule
    # of the previous game leaks into a piece that leaves a key out, and the read-back preset name is derived
    # ("open" for the builtins), not a blanket "custom".
    patch["loadout_policy"] = {"preset": "open", "hud_select": bool(misc.get("hud_select", True)),
                               "primary": primary, "secondary": secondary, "perk": perk}
    patch["mode_params"] = dict(gameplay.get("mode_params") or {})
    patch["time_limit_s"] = match.get("time_limit_s")
    patch["scoring"] = {"frag_limit": match.get("frag_limit")}
    patch["night"] = bool(match.get("night"))
    patch["presentation"] = (_pres.profile_from_preset("silenced") if match.get("silenced")
                             else _pres.profile_from_preset(mode_row.get("preset") or "standard"))
    patch["environment"] = "outdoor"   # F410: MVP is outdoors only, whatever the session held before
    return patch
