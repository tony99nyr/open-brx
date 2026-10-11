"""Mission Control config game routes."""
from __future__ import annotations

from typing import Callable

from starlette.responses import JSONResponse
from starlette.routing import BaseRoute, Route

from ..state import NotReadyError, Session
from ..types import PerkView, PresentationView, VoiceList

def routes(ctx) -> list[BaseRoute]:
    s = ctx.s
    body = ctx.body
    _err = ctx.err

    # ---- F411: BUILD's pieces + PLAY's pick (docs/spec/design/games-presets.md) ----
    from ..picks import GamePick, PickPrecheckError
    from ..pieces import PieceError, PieceStore
    if getattr(s, "pieces", None) is None:
        s.attach_pieces(PieceStore(None, now_ms=s.now_ms))   # memory-only; M1 reconciles a stale game_pick too
    picks = GamePick(s)

    def _perr(e: PieceError):
        return _err(e)

    def _pieces(s: Session) -> PieceStore:
        """`s.pieces` is only ever None before the memory-only fallback above runs -- which happens
        unconditionally in this same function, before any route can be dispatched -- but it stays
        Optional on `Session` (attached by `__main__`/here), so every route reads it through this
        rather than five copies of the same narrowing."""
        if s.pieces is None:
            raise PieceError(409, "PIECES NOT AVAILABLE: RESTART MISSION CONTROL")
        return s.pieces


    # ---- F411 §6: FAVOURITES -- a named bundle of the whole PLAY pick ----
    from ..favourites import FavouriteError, FavouriteStore
    if getattr(s, "favourites", None) is None:
        s.favourites = FavouriteStore(None, now_ms=s.now_ms)   # memory-only

    def _ferr(e: FavouriteError):
        return _err(e)

    def _favourites(s: Session) -> FavouriteStore:
        """Mirrors `_pieces` above: `s.favourites` is only ever None before the memory-only fallback
        just ran, but stays Optional on `Session` (attached by `__main__`/here)."""
        if s.favourites is None:
            raise FavouriteError(409, "FAVOURITES NOT AVAILABLE: RESTART MISSION CONTROL")
        return s.favourites


    async def presentation(_):
        """A11.5: the resolved presentation profile for the read-only ADVANCED view -- every event with its
        source (hud / mc / both), sound + the catalog's words, colours, whether it is enabled -- plus the
        switches and MC's live confidence (which gates the MC-driven global-state events)."""
        from .. import presentation as _pres
        view: PresentationView = {"summary": _pres.summary(s.config.get("presentation") or _pres.default_for(s.config.get("mode"))),
                                  "events": _pres.table(s.config), "mc_confidence": s.mc_confidence(),
                                  "presets": sorted(_pres.PRESETS)}
        return JSONResponse(view)


    async def voices(_):
        """The selectable voice personas. `$PSET`'s trailing tokens are a positional voice pack and
        only HEAVY is confirmed by ear — see gameconfig.VOICE_PACKS for the evidence and the caveat."""
        from ...gameconfig import DEFAULT_VOICE
        body: VoiceList = {"default": DEFAULT_VOICE, "voices": s.compiler.voice_options()}
        return JSONResponse(body)


    async def modes(_):
        return JSONResponse(s.modes())


    async def pieces_list(_):
        return JSONResponse(_pieces(s).list())


    async def pieces_create(req):
        b = await body(req)
        try:
            return JSONResponse(_pieces(s).create(b.get("kind"), b.get("name"), b.get("note"), b.get("value")))
        except PieceError as e:
            return _perr(e)


    async def pieces_update(req):
        pid = req.path_params["pid"]
        b = await body(req)
        try:
            return JSONResponse(picks.edit_piece(pid, b.get("name"), b.get("note"), b.get("value")))
        except PieceError as e:
            return _perr(e)
        except PickPrecheckError as e:
            return JSONResponse({"errors": e.errors}, status_code=400)
        except ValueError as e:
            return _err(e)


    async def pieces_delete(req):
        pid = req.path_params["pid"]
        try:
            picks.delete_piece(pid)
        except PieceError as e:
            return _perr(e)
        return JSONResponse({"ok": True})


    async def play_pick(req):
        b = await body(req)
        try:
            return JSONResponse(picks.pick(b.get("pieces") or {}, b.get("match") or {}))
        except PieceError as e:
            return _perr(e)
        except ValueError as e:
            return _err(e)


    async def favourites_list(_):
        return JSONResponse(_favourites(s).list())


    async def favourites_create(req):
        b = await body(req)
        pick = b.get("pick") if isinstance(b.get("pick"), dict) else s.game_pick   # default: the current pick
        try:
            return JSONResponse(_favourites(s).create(b.get("name"), b.get("countdown_s"), pick))
        except FavouriteError as e:
            return _ferr(e)


    async def favourites_update(req):
        b = await body(req)
        try:
            return JSONResponse(_favourites(s).update(req.path_params["fid"], b.get("name")))
        except FavouriteError as e:
            return _ferr(e)


    async def favourites_delete(req):
        try:
            _favourites(s).delete(req.path_params["fid"])
        except FavouriteError as e:
            return _ferr(e)
        return JSONResponse({"ok": True})


    async def favourites_load(req):
        try:
            fav = _favourites(s).get(req.path_params["fid"])
        except FavouriteError as e:
            return _ferr(e)
        try:
            result = picks.load(fav["pick"])
        except PieceError as e:   # its own status (the 409 PIECES NOT AVAILABLE, a 404), not a 500 as before the move
            return _perr(e)
        except ValueError as e:
            return _err(e)
        return JSONResponse({"ok": result["ok"], "errors": result["errors"], "config": result["config"],
                             "pick": result["pick"], "countdown_s": fav["countdown_s"],
                             "fallbacks": result["fallbacks"]})


    async def loadout_pool_preview(req):
        """A10 §5 designer: the pool a DRAFT `loadout_policy` would allow — same rule engine as `State.loadout_pool`,
        nothing applied. Body `{loadout_policy}` (partial ok: merged onto the mode's default policy)."""
        from .. import policy as _policy
        b = await body(req)
        try:
            pol = _policy.merge(_policy.default_policy(b.get("mode") or s.config.get("mode", "tdm")), b.get("loadout_policy") or {})
            weapons = [w for w in s.compiler.weapon_catalog() if not w.get("hidden")]
            pc: Callable[[], list[PerkView]] | None = getattr(s.compiler, "perk_catalog", None)
            perks = list(pc()) if callable(pc) else []
            return JSONResponse({"policy": pol, "pool": _policy.pool(pol, weapons, perks)})
        except ValueError as e:
            return _err(e)


    async def perks(_):
        """A10: visible perks (loadout.md §1.2) — `PerkView[]`."""
        pc: Callable[[], list[PerkView]] | None = getattr(s.compiler, "perk_catalog", None)
        try:
            return JSONResponse(list(pc()) if callable(pc) else [])
        except Exception:
            return JSONResponse([])


    async def put_config(req):
        try:
            return JSONResponse(s.set_config(await body(req)))
        except ValueError as e:
            return _err(e)


    async def set_phase(req):
        b = await body(req)
        try:
            s.set_phase(b.get("phase") or "", force=bool(b.get("force")))
        except ValueError as e:
            # A27: NotReadyError is a ConflictError (409) and carries WHO is not ready — the UI's second
            # CONTINUE tap names them. Every other ValueError is the old 400.
            payload = e.body() if isinstance(e, NotReadyError) else None
            if payload is not None:
                return JSONResponse(payload, status_code=getattr(e, "status", 409))
            return _err(e)
        return JSONResponse(s.snapshot())


    return [
        Route("/api/presentation", presentation),
        Route("/api/modes", modes),
        Route("/api/voices", voices),
        Route("/api/perks", perks),
        Route("/api/loadout/pool", loadout_pool_preview, methods=["POST"]),
        Route("/api/pieces", pieces_list),
        Route("/api/pieces", pieces_create, methods=["POST"]),
        Route("/api/pieces/{pid}", pieces_update, methods=["PUT"]),
        Route("/api/pieces/{pid}", pieces_delete, methods=["DELETE"]),
        Route("/api/play/pick", play_pick, methods=["POST"]),
        Route("/api/favourites", favourites_list),
        Route("/api/favourites", favourites_create, methods=["POST"]),
        Route("/api/favourites/{fid}", favourites_update, methods=["PUT"]),
        Route("/api/favourites/{fid}", favourites_delete, methods=["DELETE"]),
        Route("/api/favourites/{fid}/load", favourites_load, methods=["POST"]),
        Route("/api/config", put_config, methods=["PUT"]),
        Route("/api/phase", set_phase, methods=["POST"]),
    ]
