"""HTTP JSON API + UI WebSocket feed for Mission Control — implements mcp/brx_mcp/mc/API.md."""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse, Response
from starlette.routing import BaseRoute, Mount, Route, WebSocketRoute
from starlette.staticfiles import StaticFiles
from starlette.websockets import WebSocket, WebSocketDisconnect

from .state import CoverageRequired, NotReadyError, Session
from .types import DEFAULT_RUNWAY_S, MatchHistoryRow, PerkView, PresentationView, VoiceList
from .tunnel import TunnelError

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
        session.on_feed_edit(lambda entry: self._feed(entry, "feed_edit"))
        self.loop: asyncio.AbstractEventLoop | None = None

    def _mark(self):
        if self.loop:
            self.loop.call_soon_threadsafe(self._dirty.set)

    def _feed(self, entry: dict, kind: str = "feed"):
        entry = dict(entry)     # F454: a later in-place edit of the shared row must not change what is serialised on the loop
        if self.loop:
            self.loop.call_soon_threadsafe(lambda: asyncio.ensure_future(self._send_all({"kind": kind, "entry": entry})))

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

    def tick_once(self) -> None:
        """One match tick. A bad tick must not stop the loop, but a repeating one must not log a traceback every
        0.5 s either (O8): `tick_failed` logs the first, then one count line a minute, and puts `ticker_failing`
        on the snapshot until a tick succeeds. While it fails, armed->live and the timed end do not happen."""
        try:
            self.s.tick()
        except Exception as e:
            self.s.tick_failed(e)
        else:
            self.s.tick_ok()

    async def ticker(self):
        while True:
            self.tick_once()
            await asyncio.sleep(0.5)


class _AuthMiddleware:
    """Operator token gate (contracts/threat model: any phone on the field LAN can reach the API).
    Non-GET /api/* needs `Authorization: Bearer <token>` or `?tok=`; /ui-ws needs `?tok=`.
    Read-only GETs stay open so a spectator board / phone can watch. token=None disables auth."""

    # F-5: the read-only GETs that are NOT spectator data. "Read-only" answers whether a request can
    # CHANGE the game; it does not answer whether a stranger on the field LAN may have the thing.
    # `/api/diag/matches` serves the whole session's raw telemetry and scans the store to build it —
    # so it is gated like a write even though it writes nothing.
    _TOKEN_GETS = ("/api/diag/matches",)
    # The bug-report zip (`GET /api/report/<file>`) is the same telemetry, packed for download. The UI
    # fetches it with the header and saves a blob, so this prefix takes the header ONLY: a `?tok=` link
    # would put the operator token in browser history and in any log of the URL.
    _TOKEN_GET_PREFIXES = ("/api/report/",)
    _HEADER_ONLY_PREFIXES = ("/api/report/",)

    def __init__(self, app, token: str | None):
        self.app, self.token = app, token

    async def __call__(self, scope, receive, send):
        if self.token and scope["type"] in ("http", "websocket"):
            path = scope.get("path", "")
            method = scope.get("method", "GET")
            need = (scope["type"] == "websocket" and path == "/ui-ws") or \
                   (scope["type"] == "http" and path.startswith("/api/")
                    and (method not in ("GET", "HEAD", "OPTIONS") or path in self._TOKEN_GETS
                         or path.startswith(self._TOKEN_GET_PREFIXES)))
            if need and not self._ok(scope, header_only=path.startswith(self._HEADER_ONLY_PREFIXES)):
                if scope["type"] == "websocket":
                    await send({"type": "websocket.accept"})          # accept, then close so the client sees 4401
                    await send({"type": "websocket.close", "code": 4401})
                else:
                    await send({"type": "http.response.start", "status": 401,
                                "headers": [(b"content-type", b"application/json")]})
                    await send({"type": "http.response.body", "body": b'{"error":"operator token required"}'})
                return
        await self.app(scope, receive, send)

    def _eq(self, candidate) -> bool:
        """Constant-time token compare that never raises (non-ASCII / smart quotes → simply False)."""
        import hmac
        if self.token is None:      # only ever called (via `_ok`) from `__call__`'s `if self.token and ...` gate
            return False
        try:
            return bool(candidate) and hmac.compare_digest(str(candidate).encode("utf-8"), self.token.encode("utf-8"))
        except (TypeError, ValueError, UnicodeError):
            return False

    def _ok(self, scope, header_only: bool = False) -> bool:
        headers = {k.decode(errors="ignore").lower(): v.decode(errors="ignore") for k, v in scope.get("headers", [])}
        auth = headers.get("authorization", "")
        if auth.startswith("Bearer ") and self._eq(auth[7:]):
            return True
        if header_only:
            return False
        from urllib.parse import parse_qs
        qs = parse_qs(scope.get("query_string", b"").decode(errors="ignore"))
        tok = qs.get("tok", [None])[0]
        return self._eq(tok)


_PIN_KEYS = ("gun_id", "headset_pin")


def _pin_values(o, out: set | None = None) -> set:
    """Every value held under a PIN key anywhere in `o`."""
    out = set() if out is None else out
    if isinstance(o, dict):
        for k, v in o.items():
            if k in _PIN_KEYS and isinstance(v, str) and v:
                out.add(v)
            else:
                _pin_values(v, out)
    elif isinstance(o, list):
        for v in o:
            _pin_values(v, out)
    return out


def _without_pins(o, pins: set | None = None):
    """OP2: the same value with every headset PIN blanked. A gun's id IS its headset PIN (armory.py), so both keys go
    wherever they appear (the roster, the readiness board, the sync rows, the armory), and so does any other string
    that IS one of those PINs: the readiness row names a gun with no armory record by its id (Codex r1)."""
    if pins is None:
        pins = _pin_values(o)
    if isinstance(o, dict):
        return {k: ("" if k in _PIN_KEYS and v else _without_pins(v, pins)) for k, v in o.items()}
    if isinstance(o, list):
        return [_without_pins(v, pins) for v in o]
    if isinstance(o, str) and o in pins:
        return ""
    return o


@dataclass(frozen=True)
class _RouteContext:
    s: Session
    bc: Broadcaster
    token: str | None
    body: Callable
    err: Callable
    parse_int: Callable
    operator: Callable
    without_pins: Callable
    ui_dist: Callable[[], Path]   # read per request, as the handler always did (a test may rebind api.UI_DIST)


def create_app(session: Session, extra_tasks: list | None = None, token: str | None = None) -> Starlette:
    bc = Broadcaster(session)
    s = session
    session.lan["auth_required"] = bool(token)
    _auth = _AuthMiddleware(None, token)

    def operator(req: Request) -> bool:
        """OP2: the open GETs stay open for a spectator board, but only the operator (auth off, or the token as the
        header or `?tok=`, as `_AuthMiddleware` takes it) is answered with headset PINs."""
        return token is None or _auth._ok(req.scope)

    async def body(req: Request) -> dict:
        try:
            raw = await req.body()
            b = json.loads(raw) if raw else {}
        except Exception:
            return {}
        return b if isinstance(b, dict) else {}

    def _int(v, default, lo, hi):
        """Strict integer parse: None → default; bool/float-with-fraction/overflow/non-numeric → ValueError (400);
        an integer outside lo..hi is clamped (the UI controls clamp the same way)."""
        if v is None:
            return default
        if isinstance(v, bool):
            raise ValueError("expected an integer")
        try:
            if isinstance(v, float):
                if v != v or v in (float("inf"), float("-inf")) or v != int(v):
                    raise ValueError("expected an integer")
            n = int(v)
        except (TypeError, ValueError, OverflowError):
            raise ValueError("expected an integer")
        return max(lo, min(hi, n))

    async def wrong_port_ws(ws: WebSocket):
        node = s.lan.get("ws_url") or "the node port (default 8766)"
        await ws.accept()     # accept, then close: a close before accept reaches the client as a bare 403
        await ws.close(code=4404, reason=f"this is the console port; nodes connect to {node}"[:120])

    async def ui_ws(ws: WebSocket):
        await ws.accept()
        bc.clients.add(ws)
        try:
            await ws.send_text(json.dumps({"kind": "snapshot", "state": s.snapshot()}, default=str))
            while True:
                try:
                    await ws.receive_text()   # UI has nothing to say yet; keeps the socket open
                except WebSocketDisconnect:
                    break
                except Exception:              # a binary/odd frame must not tear down the feed loop
                    continue
        except WebSocketDisconnect:
            pass
        finally:
            bc.clients.discard(ws)

    async def index(_):
        return PlainTextResponse("Mission Control API is up. UI not built — run `npm run build` in webapp/mc "
                                 "(or `npm run dev` and open http://localhost:5173). API: /api/state")


    from .routes import (armory_guns, config_game, match_control, misc, players,
                         recap_history, reports, stations_powerups, tunnel_lan)

    ctx = _RouteContext(s, bc, token, body, _err, _int, operator, _without_pins, lambda: UI_DIST)   # read per request
    grouped = (misc.routes(ctx) + config_game.routes(ctx) + players.routes(ctx)
               + armory_guns.routes(ctx) + stations_powerups.routes(ctx)
               + match_control.routes(ctx) + recap_history.routes(ctx)
               + reports.routes(ctx) + tunnel_lan.routes(ctx))
    by_endpoint = {r.endpoint.__name__: r for r in grouped if isinstance(r, Route)}
    routes: list[BaseRoute] = [by_endpoint[name] for name in (
        "state",
        "shutdown",
        "presentation",
        "apk",
        "range_verdicts",
        "range_verdict",
        "armory_scan",
        "armory_list",
        "modes",
        "voices",
        "weapons",
        "perks",
        "loadout_pool_preview",
        "pieces_list",
        "pieces_create",
        "pieces_update",
        "pieces_delete",
        "play_pick",
        "favourites_list",
        "favourites_create",
        "favourites_update",
        "favourites_delete",
        "favourites_load",
        "put_config",
        "set_phase",
        "post_player",
        "patch_player",
        "delete_player",
        "tryout",
        "standby",
        "evict_node",
        "node_pull_log",
        "get_options",
        "put_options",
        "powerups_view",
        "reset_station",
        "stations_list",
        "arm_stations",
        "unlock_stations",
        "put_station",
        "delete_station",
        "release_station",
        "dismiss_departure",
        "dismiss_armory_corrupt",
        "ready",
        "operator_action",
        "ready_all",
        "games_load",
        "lobby_push",
        "tunnel",
        "start",
        "reschedule",
        "abort",
        "control",
        "recap",
        "match_history",
        "diag_matches",
        "report_build",
        "report_download",
        "recap_csv",
        "match_csv",
        "new_session",
        "match_next",
        "orphan_resume",
        "orphan_end",
    )]
    routes.extend([
        WebSocketRoute("/ui-ws", ui_ws),
        # Bench 2026-09-24: a phone that dials the CONSOLE port with a websocket fell through to the
        # StaticFiles mount below, which asserts on a non-http scope (8 ASGI tracebacks per connect).
        # Every other websocket path on this port closes with 4404 and names the node URL instead.
        WebSocketRoute("/{path:path}", wrong_port_ws),
    ])
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
            # The debounced session snapshot is written HERE, in the server's own shutdown: uvicorn answers SIGTERM
            # (how scripts/mc.mjs stops MC) with this graceful shutdown and then re-raises the signal, so the process
            # dies before `atexit` (where the flush used to live) ever runs. A no-op for --demo/--ephemeral. FIRST, so
            # nothing below (a slow socket close, a blocking mDNS close, the tunnel) can stand between a stop and it.
            with contextlib.suppress(Exception):
                s.persist_now()
            # Then close the node socket (Opus r1): it stayed open through this whole shutdown, and a fact that landed
            # after the store closed was ACKED (the phone then drops it from its outbox) but stored nowhere. Bounded, and
            # a cancellation here must not skip the writes below (Codex r2).
            stop = getattr(s.net, "stop", None)
            if stop is not None:
                with contextlib.suppress(Exception, asyncio.CancelledError):
                    await asyncio.wait_for(stop(), 3)
                with contextlib.suppress(Exception):
                    s.persist_now()          # what the facts that landed during that close changed
            # Fold the WAL into `session.sqlite` and close it, so the evidence folder ends with one
            # self-contained file (`Store.close` is idempotent and never raises).
            if s.store is not None:
                with contextlib.suppress(Exception):
                    s.store.close()
            # OP10: a --demo/--ephemeral MC's throwaway folder goes with it (after the store above has closed its file)
            scratch = getattr(s, "scratch_dir", None)
            if scratch:
                import shutil
                shutil.rmtree(scratch, ignore_errors=True)
            # A28.1: the cloudflared child dies with MC. Killing it here rather than leaving it to the
            # OS means a --reload / test teardown does not leave a tunnel pointing at a dead port. LAST: its stop can
            # take up to about 6 s (terminate, wait, kill, wait), and a stopper with less patience must not kill MC before
            # the snapshot and the store above are written (brx2's launcher review, 2026-10-10).
            tun = getattr(s, "tunnel", None)
            if tun is not None:
                with contextlib.suppress(Exception):
                    await tun.shutdown()

    app = Starlette(routes=routes, lifespan=lifespan,
                    middleware=[Middleware(CORSMiddleware, allow_origins=["*"],
                                           allow_methods=["*"], allow_headers=["*"]),   # outermost so 401s carry CORS headers
                                Middleware(_AuthMiddleware, token=token)])
    app.state.session = s
    app.state.broadcaster = bc
    return app
