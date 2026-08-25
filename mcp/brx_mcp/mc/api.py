"""HTTP JSON API + UI WebSocket feed for Mission Control — implements mcp/brx_mcp/mc/API.md."""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from pathlib import Path

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse, Response
from starlette.routing import Mount, Route, WebSocketRoute
from starlette.staticfiles import StaticFiles
from starlette.websockets import WebSocket, WebSocketDisconnect

from .state import Session

log = logging.getLogger("brx.mc.api")
UI_DIST = Path(__file__).resolve().parents[3] / "webapp" / "mc" / "dist"


def _err(msg: str, status: int = 400) -> JSONResponse:
    return JSONResponse({"error": msg}, status_code=status)


class Broadcaster:
    """Coalesces session changes into ≤4 snapshots/s over /ui-ws; feed entries go immediately."""

    def __init__(self, session: Session):
        self.s = session
        self.clients: set[WebSocket] = set()
        self._dirty = asyncio.Event()
        self._task: asyncio.Task | None = None
        session.on_change(self._mark)
        session.on_feed(self._feed)
        self.loop: asyncio.AbstractEventLoop | None = None

    def _mark(self):
        if self.loop:
            self.loop.call_soon_threadsafe(self._dirty.set)

    def _feed(self, entry: dict):
        if self.loop:
            self.loop.call_soon_threadsafe(lambda: asyncio.ensure_future(self._send_all({"kind": "feed", "entry": entry})))

    async def _send_all(self, msg: dict):
        data = json.dumps(msg, default=str)
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    async def run(self):
        self.loop = asyncio.get_running_loop()
        while True:
            await self._dirty.wait()
            self._dirty.clear()
            await self._send_all({"kind": "snapshot", "state": self.s.snapshot()})
            await asyncio.sleep(0.25)

    async def ticker(self):
        while True:
            self.s.tick()
            await asyncio.sleep(0.5)


def create_app(session: Session, extra_tasks: list | None = None) -> Starlette:
    bc = Broadcaster(session)
    s = session

    async def body(req: Request) -> dict:
        try:
            raw = await req.body()
            return json.loads(raw) if raw else {}
        except Exception:
            return {}

    async def state(_):
        return JSONResponse(s.snapshot())

    async def armory_scan(req):
        b = await body(req)
        rows = await s.scan(int(b.get("duration_s", 6)))
        return JSONResponse(rows)

    async def armory_list(_):
        return JSONResponse(s.armory.list())

    async def modes(_):
        return JSONResponse(s.modes())

    async def weapons(_):
        from .fakes import weapon_views
        try:
            cat = s.compiler.weapon_catalog()
            views = []
            for w in cat:
                st = w.get("stats", {})
                views.append({"weapon_id": w["weapon_id"], "name": w["name"], "cls": w.get("cls", ""),
                              "clip": st.get("mag"), "mags": (st.get("reserve", 0) // max(st.get("mag", 1), 1)),
                              "reserve": st.get("reserve"), "reload_s": round(st.get("reload_ms", 0) / 1000, 1),
                              "dmg": st.get("damage"), "rpm": st.get("rof"), "rng": st.get("range_pct", st.get("rng", 50)),
                              "verified": bool(w.get("verified"))})
            return JSONResponse(views if views else weapon_views())
        except Exception:
            return JSONResponse(weapon_views())

    async def put_config(req):
        return JSONResponse(s.set_config(await body(req)))

    async def post_player(req):
        b = await body(req)
        try:
            p = s.add_player(b.get("display", ""), b.get("team_id"), b.get("gun_id"), b.get("voice", "male"), b.get("loadout"))
        except ValueError as e:
            return _err(str(e))
        return JSONResponse(p)

    async def patch_player(req):
        pid = req.path_params["pid"]
        if pid not in s.players:
            return _err("no such player", 404)
        try:
            return JSONResponse(s.patch_player(pid, **(await body(req))))
        except ValueError as e:
            return _err(str(e))

    async def delete_player(req):
        pid = req.path_params["pid"]
        if pid not in s.players:
            return _err("no such player", 404)
        s.remove_player(pid)
        return JSONResponse({"ok": True})

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

    async def lobby_push(_):
        try:
            return JSONResponse(s.push_config())
        except ValueError as e:
            return _err(str(e))

    async def start(req):
        b = await body(req)
        try:
            return JSONResponse(s.start(b.get("runway_s"), force=bool(b.get("force"))))
        except ValueError as e:
            return _err(str(e))

    async def reschedule(req):
        b = await body(req)
        try:
            return JSONResponse(s.reschedule(int(b.get("runway_s", 120))))
        except ValueError as e:
            return _err(str(e))

    async def abort(_):
        try:
            return JSONResponse(s.abort_start())
        except ValueError as e:
            return _err(str(e))

    async def control(req):
        b = await body(req)
        try:
            return JSONResponse(s.control(b.get("cmd", ""), confirm=bool(b.get("confirm"))))
        except ValueError as e:
            return _err(str(e))

    async def recap(_):
        r = s.recap()
        return JSONResponse(r) if r else _err("no match", 404)

    async def recap_csv(_):
        if not s.scorer:
            return _err("no match", 404)
        return Response(s.scorer.csv(), media_type="text/csv",
                        headers={"Content-Disposition": "attachment; filename=recap.csv"})

    async def new_session(req):
        b = await body(req)
        s.new_session(keep_roster=bool(b.get("keep_roster", True)))
        return JSONResponse(s.snapshot())

    async def set_phase(req):
        b = await body(req)
        ph = b.get("phase")
        from .state import PHASES
        if ph not in PHASES or ph in ("armed", "live", "recap"):
            return _err("phase must be one of muster|build|kit|lobby (armed/live/recap are driven by start/end)")
        s.phase = ph
        s._changed()
        return JSONResponse(s.snapshot())

    async def ui_ws(ws: WebSocket):
        await ws.accept()
        bc.clients.add(ws)
        try:
            await ws.send_text(json.dumps({"kind": "snapshot", "state": s.snapshot()}, default=str))
            while True:
                await ws.receive_text()   # UI has nothing to say yet; keeps the socket open
        except WebSocketDisconnect:
            pass
        finally:
            bc.clients.discard(ws)

    async def index(_):
        return PlainTextResponse("Mission Control API is up. UI not built — run `npm run build` in webapp/mc "
                                 "(or `npm run dev` and open http://localhost:5173). API: /api/state")

    routes = [
        Route("/api/state", state),
        Route("/api/armory/scan", armory_scan, methods=["POST"]),
        Route("/api/armory", armory_list),
        Route("/api/modes", modes),
        Route("/api/weapons", weapons),
        Route("/api/config", put_config, methods=["PUT"]),
        Route("/api/phase", set_phase, methods=["POST"]),
        Route("/api/players", post_player, methods=["POST"]),
        Route("/api/players/{pid}", patch_player, methods=["PATCH"]),
        Route("/api/players/{pid}", delete_player, methods=["DELETE"]),
        Route("/api/players/{pid}/tryout", tryout, methods=["POST", "DELETE"]),
        Route("/api/players/{pid}/ready", ready, methods=["POST"]),
        Route("/api/lobby/push", lobby_push, methods=["POST"]),
        Route("/api/start", start, methods=["POST"]),
        Route("/api/start/reschedule", reschedule, methods=["POST"]),
        Route("/api/start/abort", abort, methods=["POST"]),
        Route("/api/control", control, methods=["POST"]),
        Route("/api/recap", recap),
        Route("/api/recap.csv", recap_csv),
        Route("/api/session/new", new_session, methods=["POST"]),
        WebSocketRoute("/ui-ws", ui_ws),
    ]
    if UI_DIST.exists():
        routes.append(Mount("/", app=StaticFiles(directory=str(UI_DIST), html=True), name="ui"))
    else:
        routes.append(Route("/", index))

    @contextlib.asynccontextmanager
    async def lifespan(app):
        tasks = [asyncio.create_task(bc.run()), asyncio.create_task(bc.ticker())]
        for coro_fn in extra_tasks or []:
            tasks.append(asyncio.create_task(coro_fn()))
        try:
            yield
        finally:
            for t in tasks:
                t.cancel()

    app = Starlette(routes=routes, lifespan=lifespan,
                    middleware=[Middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                                           allow_methods=["*"], allow_headers=["*"])])
    app.state.session = s
    app.state.broadcaster = bc
    return app
