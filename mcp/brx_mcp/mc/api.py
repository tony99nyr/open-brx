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
            try:
                await self._send_all({"kind": "snapshot", "state": self.s.snapshot()})
            except Exception:
                log.exception("snapshot broadcast failed — continuing")
            await asyncio.sleep(0.25)

    async def ticker(self):
        while True:
            try:
                self.s.tick()
            except Exception:
                log.exception("tick failed — continuing")   # a bad tick must not stop armed→live / timed-end
            await asyncio.sleep(0.5)


class _AuthMiddleware:
    """Operator token gate (contracts/threat model: any phone on the field LAN can reach the API).
    Non-GET /api/* needs `Authorization: Bearer <token>` or `?tok=`; /ui-ws needs `?tok=`.
    Read-only GETs stay open so a spectator board / phone can watch. token=None disables auth."""

    def __init__(self, app, token: str | None):
        self.app, self.token = app, token

    async def __call__(self, scope, receive, send):
        if self.token and scope["type"] in ("http", "websocket"):
            path = scope.get("path", "")
            method = scope.get("method", "GET")
            need = (scope["type"] == "websocket" and path == "/ui-ws") or \
                   (scope["type"] == "http" and path.startswith("/api/") and method not in ("GET", "HEAD", "OPTIONS"))
            if need and not self._ok(scope):
                if scope["type"] == "websocket":
                    await send({"type": "websocket.close", "code": 4401})
                else:
                    await send({"type": "http.response.start", "status": 401,
                                "headers": [(b"content-type", b"application/json")]})
                    await send({"type": "http.response.body", "body": b'{"error":"operator token required"}'})
                return
        await self.app(scope, receive, send)

    def _ok(self, scope) -> bool:
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        auth = headers.get("authorization", "")
        if auth.startswith("Bearer ") and auth[7:] == self.token:
            return True
        from urllib.parse import parse_qs
        qs = parse_qs(scope.get("query_string", b"").decode())
        return qs.get("tok", [None])[0] == self.token


def create_app(session: Session, extra_tasks: list | None = None, token: str | None = None) -> Starlette:
    bc = Broadcaster(session)
    s = session
    session.lan["auth_required"] = bool(token)

    async def body(req: Request) -> dict:
        try:
            raw = await req.body()
            b = json.loads(raw) if raw else {}
        except Exception:
            return {}
        return b if isinstance(b, dict) else {}

    def _int(v, default, lo, hi):
        try:
            n = int(v)
        except (TypeError, ValueError):
            return default
        return max(lo, min(hi, n))

    async def state(_):
        return JSONResponse(s.snapshot())

    async def armory_scan(req):
        b = await body(req)
        rows = await s.scan(_int(b.get("duration_s"), 6, 1, 30))
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
                              "dmg": st.get("dmg", st.get("damage", 50)), "rpm": st.get("rof", st.get("rpm", 50)), "rng": st.get("rng", st.get("range_pct", 50)),
                              "verified": bool(w.get("verified"))})
            return JSONResponse(views if views else weapon_views())
        except Exception:
            return JSONResponse(weapon_views())

    async def put_config(req):
        try:
            return JSONResponse(s.set_config(await body(req)))
        except ValueError as e:
            return _err(str(e))

    async def post_player(req):
        b = await body(req)
        try:
            p = s.add_player(str(b.get("display", ""))[:24], b.get("team_id"), b.get("gun_id"),
                             str(b.get("voice", "male"))[:16], b.get("loadout") if isinstance(b.get("loadout"), dict) else None)
        except (ValueError, TypeError) as e:
            return _err(str(e))
        return JSONResponse(p)

    async def patch_player(req):
        pid = req.path_params["pid"]
        if pid not in s.players:
            return _err("no such player", 404)
        b = await body(req)
        allowed = {k: b[k] for k in ("display", "team_id", "voice", "loadout", "player_num", "gun_id", "ready") if k in b}
        try:
            return JSONResponse(s.patch_player(pid, **allowed))
        except (ValueError, TypeError, KeyError) as e:
            return _err(str(e))

    async def delete_player(req):
        pid = req.path_params["pid"]
        if pid not in s.players:
            return _err("no such player", 404)
        try:
            s.remove_player(pid)
        except ValueError as e:
            return _err(str(e))
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
        rw = _int(b.get("runway_s"), None, 5, 900) if b.get("runway_s") is not None else None
        try:
            return JSONResponse(s.start(rw, force=bool(b.get("force"))))
        except ValueError as e:
            return _err(str(e))

    async def reschedule(req):
        b = await body(req)
        try:
            return JSONResponse(s.reschedule(_int(b.get("runway_s"), 120, 5, 900)))
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
                    middleware=[Middleware(_AuthMiddleware, token=token),
                                Middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                                           allow_methods=["*"], allow_headers=["*"])])
    app.state.session = s
    app.state.broadcaster = bc
    return app
