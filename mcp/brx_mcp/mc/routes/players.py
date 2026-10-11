"""Mission Control players routes."""
from __future__ import annotations

from starlette.responses import JSONResponse
from starlette.routing import BaseRoute, Route


def routes(ctx) -> list[BaseRoute]:
    s = ctx.s
    body = ctx.body
    _err = ctx.err

    async def post_player(req):
        b = await body(req)
        try:
            p = s.add_player(str(b.get("display", "")), b.get("team_id"), b.get("gun_id"),
                             str(b.get("voice", "male"))[:16], b.get("loadout") if isinstance(b.get("loadout"), dict) else None,
                             voice_slots=b.get("voice_slots") if isinstance(b.get("voice_slots"), dict) else None)
        except (ValueError, TypeError) as e:
            return _err(str(e))
        return JSONResponse(p)


    async def patch_player(req):
        pid = req.path_params["pid"]
        if pid not in s.players:
            return _err("no such player", 404)
        b = await body(req)
        allowed = {k: b[k] for k in ("display", "team_id", "voice", "voice_slots", "loadout", "player_num", "gun_id", "ready") if k in b}
        try:
            return JSONResponse(s.patch_player(pid, **allowed))
        except (ValueError, TypeError, KeyError) as e:
            return _err(str(e), getattr(e, "status", 400))   # A30: the kit lock is a 409 (state of play), not a 400


    async def delete_player(req):
        pid = req.path_params["pid"]
        if pid not in s.players and pid not in s.standby:     # STANDBY: a parked record can be dropped too
            return _err("no such player", 404)
        try:
            s.remove_player(pid)
        except ValueError as e:
            return _err(str(e))
        return JSONResponse({"ok": True})


    async def standby(req):
        """STANDBY (2026-09-12): POST parks a rostered player (stand down), DELETE puts a parked one back
        (reinstate). Both answer with the Player as it now stands; a phase refusal is a 400 in the
        operator's voice, like DELETE /api/players/{id}."""
        pid = req.path_params["pid"]
        try:
            if req.method == "DELETE":
                if pid not in s.standby:
                    return _err("no such player on standby", 404)
                return JSONResponse(s.reinstate(pid))
            if pid not in s.players:
                return _err("no such player", 404)
            return JSONResponse(s.stand_down(pid))
        except ValueError as e:
            return _err(str(e))


    async def tryout(req):
        pid = req.path_params["pid"]
        if pid not in s.players:
            return _err("no such player", 404)
        try:
            if req.method == "DELETE":
                s.tryout(pid, None)
            else:
                s.tryout(pid, (await body(req)).get("weapon_id"))
        except (ValueError, KeyError) as e:
            return _err(str(e))
        return JSONResponse({"ok": True})


    async def ready(req):
        pid = req.path_params["pid"]
        if pid not in s.players:
            return _err("no such player", 404)
        try:
            return JSONResponse(s.set_ready(pid, bool((await body(req)).get("ready", True)), host_override=True))
        except ValueError as e:
            return _err(str(e))


    async def operator_action(req):
        """A47: the LIVE board's operator menu -- `control{resync|respawn|relink}` to ONE player's phone.
        `state.py operator_action()`. Token-gated like every non-GET route."""
        b = await body(req)
        try:
            return JSONResponse(s.operator_action(req.path_params["pid"], str(b.get("cmd") or ""),
                                                  str(b.get("match_id") or "")))
        except ValueError as e:
            return _err(str(e), getattr(e, "status", 400))


    return [
        Route("/api/players", post_player, methods=["POST"]),
        Route("/api/players/{pid}", patch_player, methods=["PATCH"]),
        Route("/api/players/{pid}", delete_player, methods=["DELETE"]),
        Route("/api/players/{pid}/tryout", tryout, methods=["POST", "DELETE"]),
        Route("/api/players/{pid}/standby", standby, methods=["POST", "DELETE"]),
        Route("/api/players/{pid}/ready", ready, methods=["POST"]),
        Route("/api/players/{pid}/operator", operator_action, methods=["POST"]),
    ]
