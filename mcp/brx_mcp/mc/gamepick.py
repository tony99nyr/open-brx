"""F411: `GamePick` (docs/spec/design/games-presets.md §2/§3) — what PLAY has chosen, and the pure
function that composes a `GameConfig` patch from it.

Deliberately has NO import of `state.py`: `state.py` imports this module, so the reverse would be a
cycle. Anything that needs a mode's own defaults (`default_config`, `state.MODES`) takes it as an
argument from the caller (`api.py`'s `/api/play/pick` route), which already owns both.
"""
from __future__ import annotations

from typing import Any, Container, Mapping, cast

from ..modes.registry import default_params as _default_params
from . import presentation as _pres
from .pieces import BUILTIN_IDS, PieceError, PieceStore
from .types import OBJECTIVE_MODES, GamePick, GamePiece, MatchSettings, PieceKind, PIECE_KINDS, Team, TeamColour

# F413 (2026-09-27): the closed vocabulary `match.teams` picks from -- "ffa" is a pseudo-team (the
# no-teams sentinel `state.TEAM_DEFS` also carries), never a real choice on the strip, so it is
# deliberately left out here even though it lives in the same table on the state.py side.
TEAM_COLOURS: frozenset[str] = frozenset({"red", "blue", "yellow", "purple"})
# The strip's own order (Games.tsx ALL_TEAM_COLOURS): the order a swapped-in colour is chosen in.
_COLOUR_ORDER: tuple[TeamColour, ...] = ("red", "blue", "yellow", "purple")


def legal_colours(mode: str) -> list[TeamColour]:
    """The colours `mode` may use. A hill mode never uses yellow: tid 2 is the team a NEUTRAL hill
    broadcasts (F82), the same rule `state._merge_config` enforces on the composed config."""
    return [c for c in _COLOUR_ORDER if not (mode in OBJECTIVE_MODES and c == "yellow")]


def carry_teams(prev: list[TeamColour] | None, default: list[TeamColour], mode: str) -> list[TeamColour]:
    """Bench 2026-09-28 (Tony, "just change the choices, don't make me read warnings"): a mode change
    keeps the operator's teams when the new mode's own default has the same count, and swaps only a colour
    the new mode cannot use for a free legal one (the new mode's default colours first). With the count
    unchanged, `state._reteam_for_config` then recolours by index, so every player keeps their team.
    A different count (or no previous teams) takes the new mode's own default, as before."""
    if not prev or len(prev) != len(default):
        return list(default)
    legal = legal_colours(mode)
    kept: list[TeamColour | None] = [c if c in legal else None for c in prev]
    free: list[TeamColour] = list(dict.fromkeys(c for c in [*default, *legal] if c in legal and c not in kept))
    return [c if c is not None else free.pop(0) for c in kept]


def default_pick(default_config: Any) -> GamePick:
    """A fresh session: the first builtin of every kind, the strip at TDM's own defaults (§2)."""
    return {"pieces": dict(BUILTIN_IDS), "match": match_from_config(default_config("tdm"))}


def _teams_to_colours(config: Mapping[str, Any]) -> list[TeamColour]:
    """F413: `config["teams"]` is a list of full `Team` dicts (`state.TEAM_DEFS` copies); a `team_id`
    already IS the native colour name, so reading it back needs no `TEAM_DEFS` lookup (and so no import
    of `state.py`) -- only `compose()`, which WRITES a colour name back into a full `Team` dict, needs
    the table at all. The pseudo-team "ffa" is dropped, same reason `TEAM_COLOURS` leaves it out."""
    out: list[TeamColour] = []
    for t in config.get("teams") or []:
        if isinstance(t, dict) and t.get("team_id") in TEAM_COLOURS:
            out.append(cast(TeamColour, t["team_id"]))
    return out


def match_from_config(config: Mapping[str, Any]) -> MatchSettings:
    """The MATCH SETTINGS strip a `GameConfig` implies (H2, polish round 1) -- used both to derive a
    pick from a pre-F411 config (`derive_pick_from_config`) and to keep a live `game_pick.match` truthful
    to whatever `set_config` just committed (`Session._sync_game_pick_from_config`), so the two never
    drift into two different call sites disagreeing about the same four (now six) fields.

    F413/F415: `teams` is left OUT of the returned dict for a mode with no real teams (FFA/LMS) -- the
    field is `NotRequired` for exactly this, and an empty list on a two-team game would be a lie, not a
    fact. `hold_target_s` is left out the same way when the live config carries none."""
    out: MatchSettings = {"time_limit_s": config.get("time_limit_s"),
                         "frag_limit": (config.get("scoring") or {}).get("frag_limit"),
                         "night": bool(config.get("night")),
                         "silenced": (config.get("presentation") or {}).get("preset") == "silenced"}
    teams = _teams_to_colours(config)
    if teams:
        out["teams"] = teams
    hold = (config.get("scoring") or {}).get("hold_target_s")
    if hold is not None:
        out["hold_target_s"] = hold
    return out


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
    # A bool is an int in Python, but never a legal time_limit_s/frag_limit/hold_target_s --
    # `favourites._check_match` already excludes it the same way (Low, round 2).
    for k in ("time_limit_s", "frag_limit", "hold_target_s"):
        v = match.get(k)
        if v is not None and not (isinstance(v, int) and not isinstance(v, bool)):
            return False
    # F413: absent is fine (FFA/LMS carry no teams at all), but present must be 2-4 unique native colours.
    if "teams" in match and not _valid_teams_list(match["teams"]):
        return False
    return True


def _valid_teams_list(v: object) -> bool:
    return (isinstance(v, list) and 2 <= len(v) <= 4
           and all(isinstance(c, str) and c in TEAM_COLOURS for c in v)
           and len(set(v)) == len(v))


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
    # F413: 2-4 unique native colours, or null to drop back to the picked mode's own default (`compose()`
    # then falls back to `mode_row["teams"]`) -- the mode-specific rules (koth exactly 2, never yellow)
    # are `set_config`'s own `_merge_config` checks (F413/F82/F97), run on the composed patch, same split
    # as every other field here.
    if "teams" in patch:
        v = patch["teams"]
        if v is None:
            out.pop("teams", None)
        elif not _valid_teams_list(v):
            raise PieceError(400, "TEAM COLOURS MUST BE 2-4 UNIQUE PICKS FROM RED, BLUE, YELLOW, PURPLE")
        else:
            out["teams"] = list(v)
    # F415: shape-checked only, same split as `frag_limit` above -- the koth-only gate and the bound
    # (<=7200) are `_merge_config`'s own checks on the composed patch.
    if "hold_target_s" in patch:
        hts = _opt_int(patch["hold_target_s"], "HOLD TARGET")
        if hts is None:
            out.pop("hold_target_s", None)
        else:
            out["hold_target_s"] = hts
    return cast(MatchSettings, out)


# ---------- composing the GameConfig patch (§3) ----------
def compose(resolved: Mapping[PieceKind, GamePiece], match: MatchSettings, mode_row: Mapping[str, Any],
           team_defs: Mapping[str, Team]) -> dict:
    """Pure: the `GameConfig` patch for `Session.set_config` (fed through the SAME phase gating, RECAP
    roll-forward and re-announce `PUT /api/config` already has). `mode_row` is the picked mode's own
    `state.MODES` row — used for the "respawn.type == 'none' keeps its own respawn" rule and the mode's
    day-mode presentation preset. Does not decide default_config(mode) vs the current config for an
    unclaimed field (stations, powerups, vip, stun): `set_config` already does that (item 1, §3).

    `team_defs` is `state.TEAM_DEFS` (F413) -- this module cannot import `state.py` (see the module
    docstring), so the caller (`api.py`) hands it over the same way it already hands over `mode_row`."""
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
    # Cross-lane review #3: a pick replaces the mode's parameters, never merges onto them: the mode's full defaults
    # under the gameplay piece's own, so a KIT edit does not survive picking STANDARD.
    patch["mode_params"] = {**_default_params(patch["mode"]), **(gameplay.get("mode_params") or {})}
    patch["time_limit_s"] = match.get("time_limit_s")
    patch["scoring"] = {"frag_limit": match.get("frag_limit")}
    # F415: only a mode that OFFERS a hold target ("hold" in its own `match_items`, i.e. koth) ever
    # gets one written -- a stale `match.hold_target_s` left over from a mode switch away from koth
    # must not reach `_merge_config`'s koth-only check as a 400 for an unrelated pick.
    # Cross-lane review #3: written whenever the mode offers one, None included, so clearing it on PLAY (or loading a
    # favourite with no target) clears it in the config too; `_merge_config` keeps a key a patch leaves out.
    hold = match.get("hold_target_s")
    if "hold" in (mode_row.get("match_items") or []):
        patch["scoring"]["hold_target_s"] = hold
    patch["night"] = bool(match.get("night"))
    patch["presentation"] = (_pres.profile_from_preset("silenced") if match.get("silenced")
                             else _pres.profile_from_preset(mode_row.get("preset") or "standard"))
    patch["environment"] = "outdoor"   # F410: MVP is outdoors only, whatever the session held before
    # F413: a mode with no real teams (FFA/LMS, `mode_row["teams"] == ["ffa"]`) leaves `teams` UNCLAIMED,
    # the same "set_config decides" treatment `stations`/`powerups`/`vip`/`stun` already get above --
    # writing an `["ffa"]`-derived team list here would be actively wrong (`state.TEAM_DEFS["ffa"]` is a
    # display-only sentinel, not a real $TID row `_merge_config` should ever see as `config.teams`).
    # `match.get("teams")` is the picked colours if the strip named any; absent (fresh pick, mode just
    # changed) falls back to the mode's own default order (`state.MODES`' F413 comment on each row).
    if mode_row.get("teams") != ["ffa"]:
        colours = match.get("teams") or mode_row.get("teams") or []
        patch["teams"] = [dict(team_defs[c]) for c in colours if c in team_defs]
    return patch
