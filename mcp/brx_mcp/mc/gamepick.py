"""F411: `GamePick` (docs/spec/design/games-presets.md §2/§3) — what PLAY has chosen, and the pure
function that composes a `GameConfig` patch from it.

Deliberately has NO import of `state.py`: `state.py` imports this module, so the reverse would be a
cycle. Anything that needs a mode's own defaults (`default_config`, `state.MODES`) takes it as an
argument from the caller (`api.py`'s `/api/play/pick` route), which already owns both.
"""
from __future__ import annotations

from typing import Any, Mapping, cast

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


def looks_like_pick(gp: object) -> bool:
    return (isinstance(gp, dict) and isinstance(gp.get("pieces"), dict)
            and all(k in gp["pieces"] for k in PIECE_KINDS) and isinstance(gp.get("match"), dict))


def derive_pick_from_config(config: Mapping[str, Any], mvp_modes: frozenset[str]) -> GamePick:
    """§2: a session restored from before F411 has no `game_pick`. `mode` = the config's own mode if it
    is an MVP mode, else tdm; every other kind = its first builtin; the strip = the config's own values.
    MC does NOT recompose the config here — this only names what PLAY shows as picked."""
    mode = config.get("mode")
    ids = dict(BUILTIN_IDS)
    ids["mode"] = f"builtin:mode:{mode if mode in mvp_modes else 'tdm'}"
    match: MatchSettings = {"time_limit_s": config.get("time_limit_s"),
                            "frag_limit": (config.get("scoring") or {}).get("frag_limit"),
                            "night": bool(config.get("night")),
                            "silenced": (config.get("presentation") or {}).get("preset") == "silenced"}
    return {"pieces": ids, "match": match}


# ---------- resolving a POST /api/play/pick body ----------
def merge_piece_ids(prev_ids: Mapping[str, str], patch_ids: Mapping[str, Any]) -> dict[str, str]:
    if not isinstance(patch_ids, Mapping):
        raise PieceError(400, "pieces must be an object")
    ids = dict(prev_ids)
    for kind, pid in patch_ids.items():
        if kind not in PIECE_KINDS:
            raise PieceError(400, f"unknown piece kind {kind!r}")
        if not isinstance(pid, str) or not pid:
            raise PieceError(400, f"pieces.{kind} must be a piece id")
        ids[kind] = pid
    return ids


def resolve_pieces(store: PieceStore, ids: Mapping[str, str]) -> dict[PieceKind, GamePiece]:
    """Every kind's picked `GamePiece`, or a `PieceError` naming the first thing wrong with it."""
    resolved: dict[PieceKind, GamePiece] = {}
    for kind in PIECE_KINDS:
        pid = ids.get(kind)
        if not pid:
            raise PieceError(400, f"no piece picked for {kind!r}")
        piece = store.get(pid)                        # PieceError(404) if the id is unknown
        if piece["kind"] != kind:
            raise PieceError(400, f"{pid} is a {piece['kind']} piece, not {kind}")
        if piece.get("post_mvp"):
            raise PieceError(400, f"{piece['name']} is post-MVP and not offered on PLAY")
        resolved[kind] = piece
    return resolved


def _opt_int(v: object, field: str) -> int | None:
    if v is None:
        return None
    if not (isinstance(v, int) and not isinstance(v, bool)):
        raise PieceError(400, f"{field} must be an integer or null")
    return v


def merge_match(prev: MatchSettings, patch: Mapping[str, Any]) -> MatchSettings:
    """A partial `MatchSettings` patch onto the current strip. Shape-checked only — the exact ranges
    (`time_limit_s` 1..7200, `frag_limit` > 0) are `set_config`'s own `_merge_config` checks, run on the
    composed patch, so there is exactly one place that owns them."""
    if not isinstance(patch, Mapping):
        raise PieceError(400, "match must be an object")
    out = dict(prev)
    if "time_limit_s" in patch:
        out["time_limit_s"] = _opt_int(patch["time_limit_s"], "match.time_limit_s")
    if "frag_limit" in patch:
        out["frag_limit"] = _opt_int(patch["frag_limit"], "match.frag_limit")
    for field in ("night", "silenced"):
        if field in patch:
            if not isinstance(patch[field], bool):
                raise PieceError(400, f"match.{field} must be a boolean")
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
    patch["loadout_policy"] = {"preset": "custom", "hud_select": bool(misc.get("hud_select", True)),
                               "primary": primary, "secondary": secondary, "perk": perk}
    patch["mode_params"] = dict(gameplay.get("mode_params") or {})
    patch["time_limit_s"] = match.get("time_limit_s")
    patch["scoring"] = {"frag_limit": match.get("frag_limit")}
    patch["night"] = bool(match.get("night"))
    patch["presentation"] = (_pres.profile_from_preset("silenced") if match.get("silenced")
                             else _pres.profile_from_preset(mode_row.get("preset") or "standard"))
    return patch
