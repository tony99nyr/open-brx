"""Mission Control match control routes."""
from __future__ import annotations

from starlette.responses import JSONResponse
from starlette.routing import BaseRoute, Route

from ..state import CoverageRequired
from ..types import DEFAULT_RUNWAY_S, RUNWAY_MAX_S, RUNWAY_MIN_S

def routes(ctx) -> list[BaseRoute]:
    s = ctx.s
    body = ctx.body
    _err = ctx.err
    _int = ctx.parse_int

    async def ready_all(_req):
        """Bench 2026-09-17: MARK ALL READY, the roster-wide sibling of `ready` above. Same
        `host_override` cure, every rostered (non-standby) player at once."""
        try:
            return JSONResponse(s.ready_all())
        except ValueError as e:
            return _err(e)


    async def games_load(_req):
        """LOAD: announce the game to every bound phone. No frames, no head, no gun write --
        `state.py load_game()`. The LOBBY push is still the only thing that configures a gun."""
        try:
            return JSONResponse(s.load_game())
        except ValueError as e:
            return _err(e)


    async def lobby_push(req):
        b = await body(req)
        try:
            return JSONResponse(s.push_config(force=bool(b.get("force"))))
        except CoverageRequired as e:
            # A28.4: not a 400 -- the config is fine, the FIELD is not (yet). The UI needs the numbers to
            # say which phones are missing, so the coverage block rides along with the error.
            return JSONResponse({"error": str(e), "coverage": e.coverage}, status_code=409)
        except ValueError as e:
            return _err(e)


    async def start(req):
        b = await body(req)
        try:
            rw = _int(b.get("runway_s"), None, RUNWAY_MIN_S, RUNWAY_MAX_S)
            return JSONResponse(s.start(rw, force=bool(b.get("force"))))
        except ValueError as e:
            return _err(e)


    async def reschedule(req):
        b = await body(req)
        try:
            return JSONResponse(s.reschedule(_int(b.get("runway_s"), DEFAULT_RUNWAY_S, RUNWAY_MIN_S, RUNWAY_MAX_S)))
        except ValueError as e:
            return _err(e)


    async def abort(_):
        try:
            return JSONResponse(s.abort_start())
        except ValueError as e:
            return _err(e)


    async def control(req):
        b = await body(req)
        try:
            return JSONResponse(s.control(b.get("cmd", ""), confirm=bool(b.get("confirm"))))
        except ValueError as e:
            return _err(e)


    async def match_next(_req):
        """RECAP's NEXT MATCH (2026-09-16): roll forward with the roster and the game kept, then LOAD
        that game. `state.py next_match()`. Answers the full State, like `session/new`."""
        try:
            s.next_match()
        except ValueError as e:
            return _err(e)
        return JSONResponse(s.snapshot())


    async def orphan_resume(req):
        """RESUME MATCH (bench 2026-09-17): adopt the match bound phones report and this MC did not start.
        `state.py adopt_orphan()`. Answers the full State."""
        b = await body(req)
        try:
            s.adopt_orphan(str(b.get("match_id") or ""))
        except ValueError as e:
            return _err(e)
        return JSONResponse(s.snapshot())


    async def orphan_end(req):
        """END THEIR MATCH (bench 2026-09-17): `control{end, match_id}` to the phones reporting it only."""
        b = await body(req)
        try:
            s.end_orphan(str(b.get("match_id") or ""))
        except ValueError as e:
            return _err(e)
        return JSONResponse(s.snapshot())


    async def new_session(req):
        b = await body(req)
        try:
            s.new_session(keep_roster=bool(b.get("keep_roster", True)))
        except ValueError as e:
            return _err(e)
        return JSONResponse(s.snapshot())


    return [
        Route("/api/lobby/ready_all", ready_all, methods=["POST"]),
        Route("/api/games/load", games_load, methods=["POST"]),
        Route("/api/lobby/push", lobby_push, methods=["POST"]),
        Route("/api/start", start, methods=["POST"]),
        Route("/api/start/reschedule", reschedule, methods=["POST"]),
        Route("/api/start/abort", abort, methods=["POST"]),
        Route("/api/control", control, methods=["POST"]),
        Route("/api/session/new", new_session, methods=["POST"]),
        Route("/api/match/next", match_next, methods=["POST"]),
        Route("/api/match/orphan/resume", orphan_resume, methods=["POST"]),
        Route("/api/match/orphan/end", orphan_end, methods=["POST"]),
    ]
