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
        try:
            return bool(candidate) and hmac.compare_digest(str(candidate).encode("utf-8"), self.token.encode("utf-8"))
        except (TypeError, ValueError, UnicodeError):
            return False

    def _ok(self, scope) -> bool:
        headers = {k.decode(errors="ignore").lower(): v.decode(errors="ignore") for k, v in scope.get("headers", [])}
        auth = headers.get("authorization", "")
        if auth.startswith("Bearer ") and self._eq(auth[7:]):
            return True
        from urllib.parse import parse_qs
        qs = parse_qs(scope.get("query_string", b"").decode(errors="ignore"))
        tok = qs.get("tok", [None])[0]
        return self._eq(tok)


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

    async def state(_):
        return JSONResponse(s.snapshot())

    async def armory_scan(req):
        b = await body(req)
        try:
            dur = _int(b.get("duration_s"), 6, 1, 30)
        except ValueError as e:
            return _err(str(e))
        rows = await s.scan(dur)
        return JSONResponse(rows)

    async def armory_list(_):
        return JSONResponse(s.armory.list())

    async def modes(_):
        return JSONResponse(s.modes())

    async def weapons(_):
        from .fakes import weapon_views as fake_weapon_views
        from .views import weapon_views
        try:
            views = weapon_views(s.compiler.weapon_catalog(), s.health_pool())   # htk/ttk at THIS game's health
            return JSONResponse(views if views else fake_weapon_views())
        except Exception:
            return JSONResponse(fake_weapon_views())

    # ---- A10 §8 saved games (presets) ----
    from .presets import PresetError, PresetStore
    if getattr(s, "presets", None) is None:
        from .state import default_config
        from . import policy as _policy
        s.presets = PresetStore(None, s.sanitize_config, default_config, _policy.merge, now_ms=s.now_ms)   # memory-only

    def _perr(e: PresetError):
        return _err(str(e), e.status)

    async def presets_list(_):
        return JSONResponse(s.presets.list())

    async def presets_create(req):
        b = await body(req)
        cfg = b.get("config") if isinstance(b.get("config"), dict) else s.config
        try:
            return JSONResponse(s.presets.create(b.get("name"), b.get("desc"), cfg, replace=bool(b.get("replace"))))
        except PresetError as e:
            return _perr(e)
        except ValueError as e:
            return _err(str(e))

    async def presets_update(req):
        b = await body(req)
        try:
            return JSONResponse(s.presets.update(req.path_params["pid"], name=b.get("name"), desc=b.get("desc"),
                                                 config=b.get("config") if isinstance(b.get("config"), dict) else None))
        except PresetError as e:
            return _perr(e)
        except ValueError as e:
            return _err(str(e))

    async def presets_delete(req):
        try:
            s.presets.delete(req.path_params["pid"])
            if s.active_preset_id == req.path_params["pid"]:
                s.active_preset_id = None; s._changed()
        except PresetError as e:
            return _perr(e)
        return JSONResponse({"ok": True})

    async def presets_apply(req):
        try:
            row = s.presets.get(req.path_params["pid"])
            return JSONResponse(s.apply_preset(row["preset_id"], row["config"]))   # PUT /api/config path + remembers which game is playing
        except PresetError as e:
            return _perr(e)
        except ValueError as e:
            return _err(str(e))

    async def loadout_pool_preview(req):
        """A10 §5 designer: the pool a DRAFT `loadout_policy` would allow — same rule engine as `State.loadout_pool`,
        nothing applied. Body `{loadout_policy}` (partial ok: merged onto the mode's default policy)."""
        from . import policy as _policy
        b = await body(req)
        try:
            pol = _policy.merge(_policy.default_policy(b.get("mode") or s.config.get("mode", "tdm")), b.get("loadout_policy") or {})
            weapons = [w for w in s.compiler.weapon_catalog() if not w.get("hidden")]
            pc = getattr(s.compiler, "perk_catalog", None)
            perks = list(pc()) if callable(pc) else []
            return JSONResponse({"policy": pol, "pool": _policy.pool(pol, weapons, perks)})
        except ValueError as e:
            return _err(str(e))

    async def perks(_):
        """A10: visible perks (loadout.md §1.2) — `PerkView[]`."""
        pc = getattr(s.compiler, "perk_catalog", None)
        try:
            return JSONResponse(list(pc()) if callable(pc) else [])
        except Exception:
            return JSONResponse([])

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

    async def evict_node(req):
        nid = req.path_params["nid"]
        if not s.evict_node(nid):
            return _err("no such node", 404)
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

    async def lobby_push(req):
        b = await body(req)
        try:
            return JSONResponse(s.push_config(force=bool(b.get("force"))))
        except ValueError as e:
            return _err(str(e))

    async def start(req):
        b = await body(req)
        try:
            rw = _int(b.get("runway_s"), None, 5, 900)
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

    async def match_history(_):
        """Past matches, newest first (A8): the RECAP screen's history picker. Read-only, so it needs
        no operator token — a spectator may look at how the last round went."""
        if not s.store:
            return JSONResponse([])
        try:
            return JSONResponse([{k: m[k] for k in ("match_id", "go_live_t", "ended_t", "recap")}
                                 | {"mode": (m["config"] or {}).get("mode", "")} for m in s.store.matches()])
        except Exception:                            # history is a convenience; never 500 the console
            # NOT a header: Starlette encodes header values as latin-1, so an error message carrying a
            # non-ASCII character (this codebase's messages are full of em-dashes) would raise INSIDE
            # the guard and take the request down anyway. Log it and return the empty list.
            import logging
            logging.getLogger("brx.mc").exception("match history unavailable")
            return JSONResponse([])

    _SAFE_NAME = __import__("re").compile(r"[^A-Za-z0-9._-]")

    def _csv(body: str, name: str) -> Response:
        # The filename is sanitised, not trusted. It carries a match_id, which IS a path param — the
        # earlier comment here claimed it was "never echoed user text", which was simply wrong; it
        # was safe only because the store lookup 404s an unknown id first. Defence in depth: a quote
        # or newline reaching a header is a response-splitting bug, and Starlette encodes headers as
        # latin-1 so a non-ASCII one would raise inside the handler (review 2026-09-01).
        return Response(body, media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="{_SAFE_NAME.sub("_", name)}"'})

    async def recap_csv(_):
        if not s.scorer:
            return _err("no match", 404)
        return _csv(s.scorer.csv(), "recap.csv")

    async def match_csv(req):
        """One ARCHIVED match's stats table (W1/F6).

        `/api/recap.csv` serves the LIVE scorer, so the RECAP history picker had to hide its export
        button on a past match rather than hand the operator the wrong game's numbers. A finished
        match keeps its rows in the session store; this reads them back through the same writer.
        Read-only, so no operator token — exactly like `GET /api/matches`."""
        from .scoring import rows_csv
        mid = req.path_params["mid"]
        if not s.store:
            return _err("no session store", 404)
        try:
            m = next((m for m in s.store.matches() if m["match_id"] == mid), None)
        except Exception:
            logging.getLogger("brx.mc").exception("match csv: store unreadable")
            return _err("match history unavailable", 503)
        if not m:
            return _err("unknown match", 404)
        rows = (m.get("recap") or {}).get("rows")
        # A recap with no rows is a real match that scored nobody. Serve the header row: an empty
        # download is a truthful answer, and a 404 here reads as "that match is gone".
        return _csv(rows_csv(rows if isinstance(rows, list) else []), f"recap-{mid}.csv")

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

    def _range_path():
        from pathlib import Path as _P
        return _P.home() / ".brx-mcp" / "weapon-verdicts.jsonl"

    # A bench day appends one line per try-out and never prunes; the GET re-read and re-parsed the
    # whole file on every KIT mount. Only the LAST verdict per weapon is ever shown, so read the tail
    # (polish-loop deferred low, 2026-08-26). 256 KB is thousands of verdicts — far more than a day.
    _VERDICT_TAIL_BYTES = 256 * 1024

    async def range_verdicts(_):
        """Latest verdict per weapon from the bench log."""
        out = {}
        try:
            pth = _range_path()
            with pth.open("rb") as f:
                f.seek(0, 2)
                size = f.tell()
                f.seek(max(0, size - _VERDICT_TAIL_BYTES))
                raw = f.read().decode("utf-8", "replace")
            if size > _VERDICT_TAIL_BYTES:
                # Drop the half line the seek landed inside. Belt-and-braces over the `ValueError`
                # guard below, which already skips it in practice — kept because a truncated record
                # is not GUARANTEED to be invalid JSON, and a half row that happens to parse would
                # be a wrong verdict rather than a skipped one. Deliberately redundant, and no test
                # can distinguish the two paths on realistic data (review 2026-09-01).
                raw = raw.split("\n", 1)[-1]
            for line in raw.splitlines():
                if not line.strip():
                    continue
                try:
                    r = json.loads(line)
                except ValueError:
                    continue                        # a torn line must not hide the verdicts after it
                if isinstance(r, dict) and isinstance(r.get("weapon_id"), str):
                    out[r["weapon_id"]] = r
        except FileNotFoundError:
            pass
        except OSError:
            log.exception("range verdicts unreadable — serving none")
        return JSONResponse(out)

    async def range_verdict(request):
        """Append a bench verdict: {weapon_id, verdict: pass|issue, note?}."""
        # `request.json()` raises on malformed input, which Starlette turns into a 500 — a guard that
        # itself throws. `body()` above is the one that degrades to {} (polish-loop deferred low).
        b = await body(request)
        wid, verdict = b.get("weapon_id"), b.get("verdict")
        if not wid or not isinstance(wid, str) or verdict not in ("pass", "issue"):
            return _err("weapon_id + verdict (pass|issue) required")
        import time as _t
        rec = {"weapon_id": wid, "verdict": verdict, "note": str(b.get("note") or "")[:400], "t": int(_t.time() * 1000)}
        try:
            pth = _range_path(); pth.parent.mkdir(parents=True, exist_ok=True)
            with pth.open("a") as f:
                f.write(json.dumps(rec) + "\n")
        except OSError as e:                        # a full/read-only disk must not 500 the bench
            log.exception("range verdict not written")
            return _err(f"could not write the bench log: {e}", 503)
        return JSONResponse(rec)

    async def apk(_):
        """The companion APK, served from a stable path (webapp rebuilds wipe dist copies)."""
        from pathlib import Path as _P
        from starlette.responses import FileResponse
        for cand in (_P.home() / ".brx-mcp" / "openbrx-node-debug.apk", UI_DIST / "openbrx.apk"):
            if cand.exists():
                return FileResponse(str(cand), media_type="application/vnd.android.package-archive", filename="openbrx.apk")
        return JSONResponse({"error": "no apk staged"}, status_code=404)

    routes = [
        Route("/api/state", state),
        Route("/openbrx.apk", apk),
        Route("/api/range/verdicts", range_verdicts),
        Route("/api/range/verdict", range_verdict, methods=["POST"]),
        Route("/api/armory/scan", armory_scan, methods=["POST"]),
        Route("/api/armory", armory_list),
        Route("/api/modes", modes),
        Route("/api/weapons", weapons),
        Route("/api/perks", perks),
        Route("/api/loadout/pool", loadout_pool_preview, methods=["POST"]),
        Route("/api/presets", presets_list),
        Route("/api/presets", presets_create, methods=["POST"]),
        Route("/api/presets/{pid}", presets_update, methods=["PUT"]),
        Route("/api/presets/{pid}", presets_delete, methods=["DELETE"]),
        Route("/api/presets/{pid}/apply", presets_apply, methods=["POST"]),
        Route("/api/config", put_config, methods=["PUT"]),
        Route("/api/phase", set_phase, methods=["POST"]),
        Route("/api/players", post_player, methods=["POST"]),
        Route("/api/players/{pid}", patch_player, methods=["PATCH"]),
        Route("/api/players/{pid}", delete_player, methods=["DELETE"]),
        Route("/api/players/{pid}/tryout", tryout, methods=["POST", "DELETE"]),
        Route("/api/nodes/{nid}", evict_node, methods=["DELETE"]),
        Route("/api/players/{pid}/ready", ready, methods=["POST"]),
        Route("/api/lobby/push", lobby_push, methods=["POST"]),
        Route("/api/start", start, methods=["POST"]),
        Route("/api/start/reschedule", reschedule, methods=["POST"]),
        Route("/api/start/abort", abort, methods=["POST"]),
        Route("/api/control", control, methods=["POST"]),
        Route("/api/recap", recap),
        Route("/api/matches", match_history),
        Route("/api/recap.csv", recap_csv),
        Route("/api/matches/{mid}.csv", match_csv),
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
                    middleware=[Middleware(CORSMiddleware, allow_origins=["*"],
                                           allow_methods=["*"], allow_headers=["*"]),   # outermost so 401s carry CORS headers
                                Middleware(_AuthMiddleware, token=token)])
    app.state.session = s
    app.state.broadcaster = bc
    return app
