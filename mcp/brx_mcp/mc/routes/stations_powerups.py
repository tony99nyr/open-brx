"""Mission Control stations powerups routes."""
from __future__ import annotations

from starlette.responses import JSONResponse
from starlette.routing import BaseRoute, Route


def routes(ctx) -> list[BaseRoute]:
    s = ctx.s
    body = ctx.body
    _err = ctx.err

    # ---- A13.5 / F104: utility stations (the ITEMS panel) ----
    async def stations_list(_):
        return JSONResponse({"stations": s.stations_view(), "game": s._game_byte()})


    async def powerups_view(_):
        """A56 (S58): `PowerupsView` -- MC's powerups flag and the item presets, expanded from its defaults."""
        return JSONResponse(s.powerups_view())


    async def reset_station(req):
        """A56: the operator reset of a powerup station's item (armed/live, only while powerups are on)."""
        try:
            return JSONResponse(s.reset_station(req.path_params["nid"]))
        except KeyError:
            return _err("no such station", 404)
        except ValueError as e:
            return _err(e)


    async def put_station(req):
        nid = req.path_params["nid"]
        try:
            return JSONResponse(s.set_station(nid, await body(req)))
        except (ValueError, TypeError) as e:
            return _err(e)


    async def delete_station(req):
        try:
            if not s.clear_station(req.path_params["nid"]):
                return _err("no such station", 404)
        except ValueError as e:                    # refused while armed/live: the operator's voice, not a 500
            return _err(e)
        return JSONResponse({"ok": True})


    async def arm_stations(_):
        return JSONResponse({"ok": True, **s.arm_stations()})


    async def unlock_stations(_):
        return JSONResponse(s.unlock_stations())     # A58: any phase


    async def release_station(req):
        """A41: the operator's cure for a phone stuck in utility mode -- releases in ANY phase, so no
        `_refuse_station_change_in_play` here (see `release_station`'s own docstring)."""
        nid = req.path_params["nid"]
        if nid not in s.stations:
            return _err("no such station", 404)
        return JSONResponse({"ok": s.release_station(nid)})


    async def dismiss_departure(req):
        """Polish r1 M2(b): DISMISS on an ITEMS away line -- forget one departed station. Any phase."""
        if not s.dismiss_departure(req.path_params["nid"]):
            return _err("NO DEPARTED STATION BY THAT ID: REFRESH ITEMS", 404)
        return JSONResponse({"ok": True})


    return [
        Route("/api/powerups", powerups_view),
        Route("/api/stations/{nid}/reset", reset_station, methods=["POST"]),
        Route("/api/stations", stations_list),
        Route("/api/stations/arm", arm_stations, methods=["POST"]),
        Route("/api/stations/unlock", unlock_stations, methods=["POST"]),
        Route("/api/stations/{nid}", put_station, methods=["PUT"]),
        Route("/api/stations/{nid}", delete_station, methods=["DELETE"]),
        Route("/api/stations/{nid}/release", release_station, methods=["POST"]),
        Route("/api/stations/{nid}/departure", dismiss_departure, methods=["DELETE"]),
    ]
