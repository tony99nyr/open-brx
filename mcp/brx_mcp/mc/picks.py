"""Session-backed GAME PICK rules for PLAY, favourite loads and picked pieces."""
from __future__ import annotations

import logging
from typing import TypedDict, cast

from . import gamepick as _gamepick
from .pieces import PieceError, PieceStore, check_value
from .state import MODES, TEAM_DEFS, ModeRow, Session, default_config
from .types import GameConfig, GamePick as GamePickData, MatchSettings, PieceKind, TeamColour

log = logging.getLogger("brx.mc.api")


class PickResult(TypedDict):
    ok: bool
    errors: list[str]
    config: GameConfig
    pick: GamePickData
    fallbacks: list[PieceKind]


class PickPrecheckError(ValueError):
    """A picked-piece precheck refusal, returned as {errors} with status 400."""

    def __init__(self, errors: list[str]):
        super().__init__(str(errors))
        self.errors = errors


class GamePick:
    def __init__(self, session: Session):
        self.s = session

    def _pieces(self) -> PieceStore:
        if self.s.pieces is None:
            raise PieceError(409, "PIECES NOT AVAILABLE: RESTART MISSION CONTROL")
        return self.s.pieces

    @staticmethod
    def _mode_row(mode: str) -> ModeRow:
        return next(m for m in MODES if m["mode"] == mode)

    def _apply_patch(self, patch: dict) -> dict:
        """Precheck -> `set_config`, shared by PICK and FAVOURITES LOAD. May
        raise `ValueError` (a phase 400: the caller's own `_refuse_config_locked()` call should have
        already caught this, but a race is still possible between the two).

        `ok: false` always means the caller must NOT commit `game_pick` -- but (e, round 2) `config` in
        that reply is NOT always the unchanged current one. The PRECHECK-failure path truly changes
        nothing (`self.config` is never touched). The M2 BACKSTOP path below is different: `set_config`
        has ALREADY run for real by the time it disagrees with the precheck, and `set_config` always
        commits (errors and all -- `PUT /api/config`'s own long-standing "show the red instead of
        silently reverting"). So that reply's `config` IS the newly-applied one, with real reteam/
        apply_policy side effects (frames sent, players re-kitted) already done -- only `game_pick`
        stays on the OLD pick, deliberately HALF-MOVED rather than presenting a config nobody chose to
        load into that state as something PLAY still shows picked."""
        s = self.s
        precheck = s._compose_precheck(patch)
        if not precheck["ok"]:
            return {"ok": False, "errors": precheck["errors"], "config": s.config}
        res = s.set_config(patch)
        if not res["ok"]:
            # M2 backstop (polish round 1): the precheck said this patch would validate and
            # `set_config`'s own `_validate()` just disagreed. That is a real bug in the precheck (it
            # is meant to run the SAME pipeline) -- config_id was still minted and the config WAS
            # committed for real, but the CALLER must not also commit `game_pick` over a config nobody
            # actually chose to load into that state.
            log.warning("F411 M2: _compose_precheck passed but set_config's own validate refused the "
                        "same patch -- game_pick will NOT be updated. errors=%r", res["errors"])
        return res

    def begin_pick(self) -> None:
        """Call before reading the PLAY request body to preserve the phase gate's order."""
        self.s._refuse_config_locked()   # Low (polish round 1): refuse an armed/live pick before the precheck work

    def pick(self, pieces_patch: dict, match_patch: dict) -> PickResult:
        s = self.s
        patch_ids = pieces_patch or {}
        ids = _gamepick.merge_piece_ids(s.game_pick["pieces"], patch_ids)
        # M1 (polish round 1): a kind the REQUEST itself names still 404s/400s on a bad id; a kind
        # merely inherited from a stale/restored pick falls back to that kind's own first builtin.
        resolved, fallbacks = _gamepick.resolve_pieces_mixed(self._pieces(), ids, set(patch_ids))
        mode = resolved["mode"]["value"]["mode"]
        # round 3: `.get` here is the STRICT lookup (`PieceError` 404 on an unknown id), and the
        # OLD `game_pick.pieces.mode` is exactly the kind of inherited id that can go stale (a
        # session/store drift M1 already tolerates everywhere else). Left unguarded, that 404
        # bubbled out and refused an otherwise unrelated pick that never named "mode" at all.
        # Unresolvable -> treat it as a mode change: `prev_mode` can equal nothing, so `mode !=
        # prev_mode` is true and the strip resets to the (real, current) mode's own defaults --
        # the same safe assumption `resolve_pieces_mixed`'s own fallback makes elsewhere.
        try:
            prev_mode = self._pieces().get(s.game_pick["pieces"]["mode"])["value"]["mode"]
        except PieceError:
            prev_mode = None
        match = cast(MatchSettings, dict(s.game_pick["match"]))
        if mode != prev_mode:
            dc = default_config(mode)
            match["time_limit_s"] = dc["time_limit_s"]
            match["frag_limit"] = (dc.get("scoring") or {}).get("frag_limit")
            # F413/F415: a mode change resets hold_target_s to the NEW mode's own default (same
            # reset `time_limit_s`/`frag_limit` already get) -- unless the SAME request also sets
            # one, which `merge_match` applies right after this. Teams (bench 2026-09-28, Tony) are
            # CARRIED when the count still fits, with only an illegal colour swapped
            # (`carry_teams`), so a TDM blue/yellow roster picked into KOTH stays two sides, blue/red.
            # A pick that never named teams (an older session) carries the roster's own.
            prev_teams = match.pop("teams", None) or _gamepick.match_from_config(s.config).get("teams")
            match.pop("hold_target_s", None)
            row = self._mode_row(mode)
            new_teams = cast(list[TeamColour], list(row.get("teams") or []))
            if new_teams != ["ffa"]:
                # Only a mode that OFFERS the TEAMS control carries (mock/backend.ts gates the same
                # way); a mode without one takes its own default, as before. Parity only today: the
                # rows without it (infection, extraction) are post_mvp and cannot be picked.
                match["teams"] = (_gamepick.carry_teams(prev_teams, new_teams, mode)
                                  if "teams" in (row.get("match_items") or []) else new_teams)
        match = _gamepick.merge_match(match, match_patch or {})
        # From `resolved`, not the raw merged `ids` (M1, polish round 1): a kind that fell back to its
        # builtin must PERSIST that builtin's id, or the stale one just resolved past would sit right
        # back in `game_pick` for the next request to trip over again.
        ids = {kind: piece["piece_id"] for kind, piece in resolved.items()}
        # F470: a pick that NAMES the mode or the gameplay piece (even the one already picked: "back to STANDARD") resets
        # mode_params to the mode's defaults under the piece's own; a pick of only time, NIGHT or SILENCED keeps a KIT edit
        reset = mode != prev_mode or bool({"mode", "gameplay"} & set(pieces_patch or {}))
        patch = _gamepick.compose(resolved, match, self._mode_row(mode), TEAM_DEFS, reset_mode_params=reset)
        res = self._apply_patch(patch)
        if res["ok"]:
            # games-presets.md §4: "a pick with ok: false changes nothing" -- neither the config nor the
            # pick; `_apply_patch` already refused to commit the config, so `game_pick` must not move either.
            s.game_pick = {"pieces": ids, "match": match}
            s._changed()
        # Low (round 2): a kind that fell back (e.g. an inherited post-MVP mode -> TDM) is named the
        # same way FAVOURITES LOAD already names one, so the console can say so either way.
        return cast(PickResult, {"ok": res["ok"], "errors": res["errors"], "config": res["config"],
                                 "pick": s.game_pick, "fallbacks": fallbacks})

    def load(self, fav_pick: GamePickData) -> PickResult:
        """Applies the favourite's pieces + match through the SAME compose/precheck/set_config path
        `POST /api/play/pick` uses (same phase gating, `ok: false` changes nothing) -- the one
        difference is `resolve_pieces_with_fallback`: a piece the favourite named that no longer
        exists (or turned post_mvp) falls back to that kind's first builtin rather than 404ing the
        whole favourite, and is named in `fallbacks`."""
        s = self.s
        s._refuse_config_locked()   # Low (polish round 1): refuse an armed/live load before the precheck work
        resolved, fallbacks = _gamepick.resolve_pieces_with_fallback(self._pieces(), fav_pick["pieces"])
        mode = resolved["mode"]["value"]["mode"]
        match = fav_pick["match"]
        ids = {kind: piece["piece_id"] for kind, piece in resolved.items()}
        patch = _gamepick.compose(resolved, match, self._mode_row(mode), TEAM_DEFS)
        res = self._apply_patch(patch)
        if res["ok"]:
            s.game_pick = {"pieces": ids, "match": match}
            s._changed()
        return cast(PickResult, {"ok": res["ok"], "errors": res["errors"], "config": res["config"],
                                 "pick": s.game_pick, "fallbacks": fallbacks})

    def edit_piece(self, pid: str, name: object, note: object, value: object) -> dict:
        s = self.s
        piece = self._pieces().get(pid)   # 404/403(builtin) before the in-use check
        picked = not piece["builtin"] and pid in s.game_pick["pieces"].values()
        if picked:
            # Low (round 2): rolls RECAP forward before any precheck work below, the same reason
            # play_pick/favourites_load call this first -- the armed/live case still answers with the
            # specific IN-USE message, not `_refuse_config_locked`'s generic one.
            try:
                s._refuse_config_locked()
            except ValueError as e:
                raise PieceError(409, "IN USE BY THE RUNNING GAME") from e
        patch = None
        fallbacks: list = []
        if picked and value is not None:
            # H1 (polish round 1): precheck the RECOMPOSED config BEFORE saving anything -- a value
            # such as `fixed_id: "not_a_real_weapon"` must not drop a pushed lobby silently.
            checked = check_value(piece["kind"], value)
            # M-b (round 2): resolve_pieces_mixed, not the strict resolve_pieces -- an INHERITED
            # post-MVP mode (H2's `_sync_game_pick_from_config` can point `game_pick` at one via a
            # plain `PUT /api/config`) must not refuse an edit to an unrelated piece.
            resolved, fallbacks = _gamepick.resolve_pieces_mixed(self._pieces(), s.game_pick["pieces"], {piece["kind"]})
            resolved[piece["kind"]] = {**piece, "value": checked}
            patch = _gamepick.compose(resolved, s.game_pick["match"], self._mode_row(resolved["mode"]["value"]["mode"]), TEAM_DEFS,
                                      reset_mode_params=piece["kind"] in ("mode", "gameplay"))   # F470
            precheck = s._compose_precheck(patch)
            if not precheck["ok"]:
                raise PickPrecheckError(precheck["errors"])
        row = self._pieces().update(pid, name=name, note=note, value=value)
        out: dict = dict(row)
        if patch is not None:
            # round 3: ONLY a value change recomposes -- a name/note-only edit changes no game value
            # and must not touch the config at all. This used to run for EVERY picked-piece edit
            # (recomposing "so game_cfg/the lobby repush stay in step"), which is exactly what broke:
            # pick a custom LIFE piece, `PUT /api/config {"mode": "infection"}` (a legal, non-pick config
            # edit), then just rename the LIFE piece -- the unconditional recompose re-resolved every
            # kind including the now-inherited post-MVP mode, which `resolve_pieces_mixed` correctly
            # falls back to TDM, and `set_config` applied THAT for real. A rename silently reverted the
            # game's mode. `fallbacks` (the fallen-back kinds from the resolve above) rides the reply
            # the same way `POST /api/play/pick` reports its own.
            res = s.set_config(patch)
            if not res["ok"]:
                log.warning("F411 M2: pieces_update's own precheck said ok but set_config's validate "
                            "refused the same patch. errors=%r", res["errors"])
            out["ok"] = res["ok"]
            out["errors"] = res["errors"]
            out["fallbacks"] = fallbacks
        return out

    def delete_piece(self, pid: str) -> None:
        piece = self._pieces().get(pid)   # 404 before anything else; builtin-ness before the in-use check
        if not piece["builtin"] and pid in self.s.game_pick["pieces"].values():
            raise PieceError(409, "IN USE: PICK ANOTHER ON PLAY FIRST")
        self._pieces().delete(pid)
