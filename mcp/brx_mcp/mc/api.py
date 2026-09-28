"""HTTP JSON API + UI WebSocket feed for Mission Control — implements mcp/brx_mcp/mc/API.md."""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from pathlib import Path
from typing import Callable, cast

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse, Response
from starlette.routing import Mount, Route, WebSocketRoute
from starlette.staticfiles import StaticFiles
from starlette.websockets import WebSocket, WebSocketDisconnect

from .state import CoverageRequired, NotReadyError, Session
from .types import DEFAULT_RUNWAY_S, MatchHistoryRow, MatchSettings, PerkView, PresentationView, TeamColour, VoiceList
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

    async def presentation(_):
        """A11.5: the resolved presentation profile for the read-only ADVANCED view -- every event with its
        source (hud / mc / both), sound + the catalog's words, colours, whether it is enabled -- plus the
        switches and MC's live confidence (which gates the MC-driven global-state events)."""
        from . import presentation as _pres
        view: PresentationView = {"summary": _pres.summary(s.config.get("presentation") or _pres.default_for(s.config.get("mode"))),
                                  "events": _pres.table(s.config), "mc_confidence": s.mc_confidence(),
                                  "presets": sorted(_pres.PRESETS)}
        return JSONResponse(view)

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

    async def voices(_):
        """The selectable voice personas. `$PSET`'s trailing tokens are a positional voice pack and
        only HEAVY is confirmed by ear — see gameconfig.VOICE_PACKS for the evidence and the caveat."""
        from ..gameconfig import DEFAULT_VOICE
        body: VoiceList = {"default": DEFAULT_VOICE, "voices": s.compiler.voice_options()}
        return JSONResponse(body)

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

    # ---- F411: BUILD's pieces + PLAY's pick (docs/spec/design/games-presets.md) ----
    from . import gamepick as _gamepick
    from .pieces import PieceError, PieceStore, check_value
    from .state import MODES, ModeRow, TEAM_DEFS, default_config
    if getattr(s, "pieces", None) is None:
        s.attach_pieces(PieceStore(None, now_ms=s.now_ms))   # memory-only; M1 reconciles a stale game_pick too

    def _perr(e: PieceError):
        return _err(str(e), e.status)

    def _pieces(s: Session) -> PieceStore:
        """`s.pieces` is only ever None before the memory-only fallback above runs -- which happens
        unconditionally in this same function, before any route can be dispatched -- but it stays
        Optional on `Session` (attached by `__main__`/here), so every route reads it through this
        rather than five copies of the same narrowing."""
        if s.pieces is None:
            raise PieceError(409, "PIECES NOT AVAILABLE: RESTART MISSION CONTROL")
        return s.pieces

    def _mode_row(mode: str) -> ModeRow:
        return next(m for m in MODES if m["mode"] == mode)

    def _apply_patch(patch: dict) -> dict:
        """Precheck -> `set_config`, shared by PICK, FAVOURITES LOAD and a picked piece's PUT. May
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
            piece = _pieces(s).get(pid)   # 404/403(builtin) before the in-use check
        except PieceError as e:
            return _perr(e)
        picked = not piece["builtin"] and pid in s.game_pick["pieces"].values()
        if picked:
            # Low (round 2): rolls RECAP forward before any precheck work below, the same reason
            # play_pick/favourites_load call this first -- the armed/live case still answers with the
            # specific IN-USE message, not `_refuse_config_locked`'s generic one.
            try:
                s._refuse_config_locked()
            except ValueError:
                return _err("IN USE BY THE RUNNING GAME", 409)
        value = b.get("value")
        patch = None
        fallbacks: list = []
        if picked and value is not None:
            # H1 (polish round 1): precheck the RECOMPOSED config BEFORE saving anything -- a value
            # such as `fixed_id: "not_a_real_weapon"` must not drop a pushed lobby silently.
            try:
                checked = check_value(piece["kind"], value)
                # M-b (round 2): resolve_pieces_mixed, not the strict resolve_pieces -- an INHERITED
                # post-MVP mode (H2's `_sync_game_pick_from_config` can point `game_pick` at one via a
                # plain `PUT /api/config`) must not refuse an edit to an unrelated piece.
                resolved, fallbacks = _gamepick.resolve_pieces_mixed(_pieces(s), s.game_pick["pieces"], {piece["kind"]})
            except PieceError as e:
                return _perr(e)
            resolved[piece["kind"]] = {**piece, "value": checked}
            patch = _gamepick.compose(resolved, s.game_pick["match"], _mode_row(resolved["mode"]["value"]["mode"]), TEAM_DEFS)
            precheck = s._compose_precheck(patch)
            if not precheck["ok"]:
                return JSONResponse({"errors": precheck["errors"]}, status_code=400)
        try:
            row = _pieces(s).update(pid, name=b.get("name"), note=b.get("note"), value=value)
        except PieceError as e:
            return _perr(e)
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
            try:
                res = s.set_config(patch)
            except ValueError as e:
                return _err(str(e))
            if not res["ok"]:
                log.warning("F411 M2: pieces_update's own precheck said ok but set_config's validate "
                           "refused the same patch. errors=%r", res["errors"])
            out["ok"] = res["ok"]
            out["errors"] = res["errors"]
            out["fallbacks"] = fallbacks
        return JSONResponse(out)

    async def pieces_delete(req):
        pid = req.path_params["pid"]
        try:
            piece = _pieces(s).get(pid)   # 404 before anything else; builtin-ness before the in-use check
        except PieceError as e:
            return _perr(e)
        if not piece["builtin"] and pid in s.game_pick["pieces"].values():
            return _err("IN USE: PICK ANOTHER ON PLAY FIRST", 409)
        try:
            _pieces(s).delete(pid)
        except PieceError as e:
            return _perr(e)
        return JSONResponse({"ok": True})

    async def play_pick(req):
        try:
            s._refuse_config_locked()   # Low (polish round 1): refuse an armed/live pick before the precheck work
        except ValueError as e:
            return _err(str(e))
        b = await body(req)
        try:
            patch_ids = b.get("pieces") or {}
            ids = _gamepick.merge_piece_ids(s.game_pick["pieces"], patch_ids)
            # M1 (polish round 1): a kind the REQUEST itself names still 404s/400s on a bad id; a kind
            # merely inherited from a stale/restored pick falls back to that kind's own first builtin.
            resolved, fallbacks = _gamepick.resolve_pieces_mixed(_pieces(s), ids, set(patch_ids))
            mode = resolved["mode"]["value"]["mode"]
            # round 3: `.get` here is the STRICT lookup (`PieceError` 404 on an unknown id), and the
            # OLD `game_pick.pieces.mode` is exactly the kind of inherited id that can go stale (a
            # session/store drift M1 already tolerates everywhere else). Left unguarded, that 404
            # bubbled out and refused an otherwise unrelated pick that never named "mode" at all.
            # Unresolvable -> treat it as a mode change: `prev_mode` can equal nothing, so `mode !=
            # prev_mode` is true and the strip resets to the (real, current) mode's own defaults --
            # the same safe assumption `resolve_pieces_mixed`'s own fallback makes elsewhere.
            try:
                prev_mode = _pieces(s).get(s.game_pick["pieces"]["mode"])["value"]["mode"]
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
                new_teams = _mode_row(mode).get("teams") or []
                if new_teams != ["ffa"]:
                    match["teams"] = _gamepick.carry_teams(prev_teams, cast(list[TeamColour], list(new_teams)), mode)
            match = _gamepick.merge_match(match, b.get("match") or {})
        except PieceError as e:
            return _perr(e)
        # From `resolved`, not the raw merged `ids` (M1, polish round 1): a kind that fell back to its
        # builtin must PERSIST that builtin's id, or the stale one just resolved past would sit right
        # back in `game_pick` for the next request to trip over again.
        ids = {kind: piece["piece_id"] for kind, piece in resolved.items()}
        patch = _gamepick.compose(resolved, match, _mode_row(mode), TEAM_DEFS)
        try:
            res = _apply_patch(patch)
        except ValueError as e:
            return _err(str(e))
        if res["ok"]:
            # games-presets.md §4: "a pick with ok: false changes nothing" -- neither the config nor the
            # pick; `_apply_patch` already refused to commit the config, so `game_pick` must not move either.
            s.game_pick = {"pieces": ids, "match": match}
            s._changed()
        # Low (round 2): a kind that fell back (e.g. an inherited post-MVP mode -> TDM) is named the
        # same way FAVOURITES LOAD already names one, so the console can say so either way.
        return JSONResponse({"ok": res["ok"], "errors": res["errors"], "config": res["config"], "pick": s.game_pick,
                             "fallbacks": fallbacks})

    # ---- F411 §6: FAVOURITES -- a named bundle of the whole PLAY pick ----
    from .favourites import FavouriteError, FavouriteStore
    if getattr(s, "favourites", None) is None:
        s.favourites = FavouriteStore(None, now_ms=s.now_ms)   # memory-only

    def _ferr(e: FavouriteError):
        return _err(str(e), e.status)

    def _favourites(s: Session) -> FavouriteStore:
        """Mirrors `_pieces` above: `s.favourites` is only ever None before the memory-only fallback
        just ran, but stays Optional on `Session` (attached by `__main__`/here)."""
        if s.favourites is None:
            raise FavouriteError(409, "FAVOURITES NOT AVAILABLE: RESTART MISSION CONTROL")
        return s.favourites

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
        """Applies the favourite's pieces + match through the SAME compose/precheck/set_config path
        `POST /api/play/pick` uses (same phase gating, `ok: false` changes nothing) -- the one
        difference is `resolve_pieces_with_fallback`: a piece the favourite named that no longer
        exists (or turned post_mvp) falls back to that kind's first builtin rather than 404ing the
        whole favourite, and is named in `fallbacks`."""
        try:
            fav = _favourites(s).get(req.path_params["fid"])
        except FavouriteError as e:
            return _ferr(e)
        try:
            s._refuse_config_locked()   # Low (polish round 1): refuse an armed/live load before the precheck work
        except ValueError as e:
            return _err(str(e))
        resolved, fallbacks = _gamepick.resolve_pieces_with_fallback(_pieces(s), fav["pick"]["pieces"])
        mode = resolved["mode"]["value"]["mode"]
        match = fav["pick"]["match"]
        ids = {kind: piece["piece_id"] for kind, piece in resolved.items()}
        patch = _gamepick.compose(resolved, match, _mode_row(mode), TEAM_DEFS)
        try:
            res = _apply_patch(patch)
        except ValueError as e:
            return _err(str(e))
        if res["ok"]:
            s.game_pick = {"pieces": ids, "match": match}
            s._changed()
        return JSONResponse({"ok": res["ok"], "errors": res["errors"], "config": res["config"], "pick": s.game_pick,
                             "countdown_s": fav["countdown_s"], "fallbacks": fallbacks})

    async def loadout_pool_preview(req):
        """A10 §5 designer: the pool a DRAFT `loadout_policy` would allow — same rule engine as `State.loadout_pool`,
        nothing applied. Body `{loadout_policy}` (partial ok: merged onto the mode's default policy)."""
        from . import policy as _policy
        b = await body(req)
        try:
            pol = _policy.merge(_policy.default_policy(b.get("mode") or s.config.get("mode", "tdm")), b.get("loadout_policy") or {})
            weapons = [w for w in s.compiler.weapon_catalog() if not w.get("hidden")]
            pc: Callable[[], list[PerkView]] | None = getattr(s.compiler, "perk_catalog", None)
            perks = list(pc()) if callable(pc) else []
            return JSONResponse({"policy": pol, "pool": _policy.pool(pol, weapons, perks)})
        except ValueError as e:
            return _err(str(e))

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
            return _err(str(e))

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
            return _err(str(e))

    async def put_station(req):
        nid = req.path_params["nid"]
        try:
            return JSONResponse(s.set_station(nid, await body(req)))
        except (ValueError, TypeError) as e:
            return _err(str(e))

    async def delete_station(req):
        try:
            if not s.clear_station(req.path_params["nid"]):
                return _err("no such station", 404)
        except ValueError as e:                    # refused while armed/live: the operator's voice, not a 500
            return _err(str(e))
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

    async def ready_all(_req):
        """Bench 2026-09-17: MARK ALL READY, the roster-wide sibling of `ready` above. Same
        `host_override` cure, every rostered (non-standby) player at once."""
        try:
            return JSONResponse(s.ready_all())
        except ValueError as e:
            return _err(str(e))

    async def games_load(_req):
        """LOAD: announce the game to every bound phone. No frames, no head, no gun write --
        `state.py load_game()`. The LOBBY push is still the only thing that configures a gun."""
        try:
            return JSONResponse(s.load_game())
        except ValueError as e:
            return _err(str(e))

    async def lobby_push(req):
        b = await body(req)
        try:
            return JSONResponse(s.push_config(force=bool(b.get("force"))))
        except CoverageRequired as e:
            # A28.4: not a 400 -- the config is fine, the FIELD is not (yet). The UI needs the numbers to
            # say which phones are missing, so the coverage block rides along with the error.
            return JSONResponse({"error": str(e), "coverage": e.coverage}, status_code=409)
        except ValueError as e:
            return _err(str(e))

    async def tunnel(req):
        """A28.1: start / stop the public node socket. `lan.public` is the answer in every case."""
        b = await body(req)
        on = b.get("on")
        if not isinstance(on, bool):
            return _err("on must be true or false")
        try:
            return JSONResponse(await s.set_tunnel(on))
        except TunnelError as e:
            return _err(str(e), e.status)

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
            return JSONResponse(s.reschedule(_int(b.get("runway_s"), DEFAULT_RUNWAY_S, 5, 900)))
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

    async def operator_action(req):
        """A47: the LIVE board's operator menu -- `control{resync|respawn|relink}` to ONE player's phone.
        `state.py operator_action()`. Token-gated like every non-GET route."""
        b = await body(req)
        try:
            return JSONResponse(s.operator_action(req.path_params["pid"], str(b.get("cmd") or ""),
                                                  str(b.get("match_id") or "")))
        except ValueError as e:
            return _err(str(e), getattr(e, "status", 400))

    async def recap(_):
        r = s.recap()
        return JSONResponse(r) if r else _err("no match", 404)

    async def match_history(_):
        """Past matches, newest first (A8): the RECAP screen's history picker. Read-only, so it needs
        no operator token — a spectator may look at how the last round went."""
        if not s.store:
            return JSONResponse([])
        try:
            # the FULL config (and the compiled head under `_heads`), not just the mode — debugging a
            # field report needs every setting the game actually ran with, not a summary of it
            rows: list[MatchHistoryRow] = []
            for m in s.store.matches():
                config = m["config"] or {}
                rows.append({"match_id": m["match_id"], "go_live_t": m["go_live_t"],
                             "ended_t": m["ended_t"], "recap": m["recap"], "config": config,
                             "mode": config.get("mode", "")})
            return JSONResponse(rows)
        except Exception:                            # history is a convenience; never 500 the console
            # NOT a header: Starlette encodes header values as latin-1, so an error message carrying a
            # non-ASCII character (this codebase's messages are full of em-dashes) would raise INSIDE
            # the guard and take the request down anyway. Log it and return the empty list.
            import logging
            logging.getLogger("brx.mc").exception("match history unavailable")
            return JSONResponse([])

    async def diag_matches(req):
        """T1-B: the post-match diagnostic (`brx_mcp.mc.diag`) as JSON, over THIS session's own store —
        go_live/ended/duration, mode/config_id/environment/cfg health, shots/hits/hit%/deaths, per-node
        arm_state + alive + gun_linked distributions, the hp/armor comparison (vs the config AND vs the
        head actually pushed), the first settled pool of each node's first life, and each node's
        `ack_config` vs the match it was pushed for. Read-only, using a short-lived connection owned
        by the diagnostic worker rather than the store's writer. `?match=<id>` narrows to one match.

        F-5 (polish loop, 2026-09-13) — three guards this route did not have. It is a FULL-SESSION
        sqlite scan (every `status` row and every event of every match played tonight):
          * **operator token.** `_AuthMiddleware` leaves GETs open so a spectator board can watch
            `/api/state`; this one is the session's raw telemetry, and a scan is also the cheapest
            way for anyone on the field LAN to make MC unresponsive. It is in `_TOKEN_GETS`.
          * **off the event loop.** `run_in_executor`: a night's store is tens of thousands of rows,
            and every hit, every heartbeat and the whole UI feed queue behind a blocking scan.
            The worker opens and closes its own read-only connection, so it never races the event
            loop through the store's writer handle.
          * **not mid-match.** LIVE always 409s. During ARMED, an explicitly named previous match is
            allowed (F174), while the current match and a full-session scan still 409. That keeps the
            night's evidence reachable on the runway without scanning the game being started.
        """
        match = req.query_params.get("match")
        current_match = (s.start_info or {}).get("match_id")
        blocked_armed = s.phase == "armed" and (not match or not current_match or match == current_match)
        if s.phase == "live" or blocked_armed:
            return _err(f"the match is {s.phase.upper()} — the diagnostic scans the whole session store "
                        f"and is not run on the current game; during ARMED, request a previous match id, "
                        f"or ask again at the recap", 409)
        if not s.store:
            return JSONResponse([])
        from . import diag
        path = s.store.path
        try:
            loop = asyncio.get_running_loop()
            return JSONResponse(await loop.run_in_executor(None, lambda: diag.build_report_path(path, match)))
        except Exception:
            import logging
            logging.getLogger("brx.mc").exception("diag unavailable")
            return JSONResponse([])

    # Report files THIS server built, by name. The download route serves nothing else, so a crafted
    # name (`..`, a slash, another session's zip) is a 404 before any path is formed from it.
    reports_built: dict[str, Path] = {}

    def _report_known() -> dict[str, list[str]]:
        """What only the live server knows: the roster's names and the armory's gun ids. Best effort."""
        from . import report as _report
        players = list(s.players.values()) + list(getattr(s, "standby", {}).values())
        known: dict[str, list[str]] = {
            _report.PLAYER: [str(p.get("display") or "") for p in players],
            _report.PIN: [str(p.get("gun_id") or "") for p in players],
            _report.WIFI: [str(s.lan.get("ssid") or "")],
            _report.TAGGER: [], _report.BLE: []}
        try:
            for rec in s.armory.list() or []:
                known[_report.TAGGER].append(str(rec.get("sticker") or ""))
                known[_report.PIN] += [str(rec.get("gun_id") or ""), str(rec.get("headset_pin") or "")]
                ble = rec.get("ble") or {}
                known[_report.BLE] += [str(ble.get("address") or ""), str(ble.get("uuid") or "")]
        except Exception:
            log.warning("report: armory list unavailable; the armory file is still read")
        return known

    async def report_build(_):
        """`python -m brx_mcp.mc.report` for THIS session, on demand: a scrubbed zip the operator can
        attach to a public GitHub issue. Allowed in every phase (a bug can happen mid-match): the report
        reads its own COPY of the store through the sqlite backup API, in a worker thread, so it never
        shares or blocks the live connection. Operator-token gated (a POST)."""
        if not s.store:
            return _err("this Mission Control has no session database, so there is nothing to report", 409)
        from . import report as _report
        from ..storage import home_dir
        store_path = Path(s.store.path)
        evidence = store_path.parent
        # A launcher run keeps `session.sqlite` in its own evidence folder; a manual run shares
        # `~/.brx-mcp/mc/` with every other session, so its zips go to `reports/` instead.
        out_dir = evidence if store_path.name == "session.sqlite" else home_dir() / "reports"
        launch_id = None if store_path.name == "session.sqlite" else f"session-{s.store.session_id}"
        secrets = [t for t in (token, getattr(s, "join_secret", None)) if t]
        # A60: the install secret and every trust key this MC can name are never allowed into a zip.
        _net = getattr(s, "net", None)
        _trust = getattr(_net, "trust", None)
        if _trust is not None:
            secrets += _trust.secret_values(list(getattr(_net, "nodes", {}) or {}))
        known = _report_known()
        try:
            loop = asyncio.get_running_loop()
            res = await loop.run_in_executor(None, lambda: _report.build_report(
                evidence, out_dir, sqlite_path=store_path, launch_id=launch_id, secrets=secrets, known=known))
        except _report.ReportLeak as e:
            return _err(str(e), 500)
        except Exception:
            logging.getLogger("brx.mc").exception("report failed")
            return _err("the report could not be built; see the Mission Control log", 500)
        name = res.zip_path.name
        reports_built[name] = res.zip_path
        return JSONResponse({"file": name, "download": f"/api/report/{name}", "issue_url": res.issue_url,
                             "summary": res.summary, "removed": res.removed, "too_large": res.too_large})

    async def report_download(req):
        from starlette.responses import FileResponse
        from . import report as _report
        name = req.path_params.get("file", "")
        path = reports_built.get(name) if _report.REPORT_NAME.fullmatch(name) else None
        if path is None or not path.is_file():
            return _err("no such report", 404)
        return FileResponse(str(path), media_type="application/zip", filename=name,
                            content_disposition_type="attachment")

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

    async def match_next(_req):
        """RECAP's NEXT MATCH (2026-09-16): roll forward with the roster and the game kept, then LOAD
        that game. `state.py next_match()`. Answers the full State, like `session/new`."""
        try:
            s.next_match()
        except ValueError as e:
            return _err(str(e), getattr(e, "status", 400))
        return JSONResponse(s.snapshot())

    async def orphan_resume(req):
        """RESUME MATCH (bench 2026-09-17): adopt the match bound phones report and this MC did not start.
        `state.py adopt_orphan()`. Answers the full State."""
        b = await body(req)
        try:
            s.adopt_orphan(str(b.get("match_id") or ""))
        except ValueError as e:
            return _err(str(e), getattr(e, "status", 400))
        return JSONResponse(s.snapshot())

    async def orphan_end(req):
        """END THEIR MATCH (bench 2026-09-17): `control{end, match_id}` to the phones reporting it only."""
        b = await body(req)
        try:
            s.end_orphan(str(b.get("match_id") or ""))
        except ValueError as e:
            return _err(str(e), getattr(e, "status", 400))
        return JSONResponse(s.snapshot())

    async def new_session(req):
        b = await body(req)
        s.new_session(keep_roster=bool(b.get("keep_roster", True)))
        return JSONResponse(s.snapshot())

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
            return _err(str(e), getattr(e, "status", 400))
        return JSONResponse(s.snapshot())

    async def get_options(_):
        return JSONResponse(dict(s.options))

    async def put_options(req):
        """A25: the session option table. Only the keys we know, only the values we know."""
        b = await body(req)
        from .state import OPTION_DEFAULTS
        unknown = [k for k in b if k not in OPTION_DEFAULTS]
        if unknown:
            return _err(f"unknown option(s): {', '.join(sorted(unknown))}")
        try:
            for k, v in b.items():
                s.set_option(k, v)
        except ValueError as e:
            return _err(str(e))
        return JSONResponse(dict(s.options))

    async def node_pull_log(req):
        """A25: the operator's LOGS button. `reason: "manual"` — never gated by `log_sync`."""
        nid = req.path_params["nid"]
        if nid not in s.nodes:
            return _err("no such node", 404)
        asked = s.pull_log(nid, "manual")
        return JSONResponse({"ok": asked, "node_id": nid, "log": s.nodes[nid].get("log")})

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

    def _range_path():
        # `home_dir()`, not `Path.home() / ".brx-mcp"`: the bench log belongs wherever this MC persists
        # everything else, which `BRX_MCP_HOME` moves for a test run (storage.py). Hardcoding the real
        # dotfile path here meant a suite that posted a verdict wrote into the operator's field evidence.
        from ..storage import home_dir
        return home_dir() / "weapon-verdicts.jsonl"

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
        from starlette.responses import FileResponse
        from ..storage import home_dir          # the staged APK lives wherever this MC persists things
        for cand in (home_dir() / "openbrx-node-debug.apk", UI_DIST / "openbrx.apk"):
            if cand.exists():
                return FileResponse(str(cand), media_type="application/vnd.android.package-archive", filename="openbrx.apk")
        return JSONResponse({"error": "no apk staged"}, status_code=404)

    routes = [
        Route("/api/state", state),
        Route("/api/presentation", presentation),
        Route("/openbrx.apk", apk),
        Route("/api/range/verdicts", range_verdicts),
        Route("/api/range/verdict", range_verdict, methods=["POST"]),
        Route("/api/armory/scan", armory_scan, methods=["POST"]),
        Route("/api/armory", armory_list),
        Route("/api/modes", modes),
        Route("/api/voices", voices),
        Route("/api/weapons", weapons),
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
        Route("/api/players", post_player, methods=["POST"]),
        Route("/api/players/{pid}", patch_player, methods=["PATCH"]),
        Route("/api/players/{pid}", delete_player, methods=["DELETE"]),
        Route("/api/players/{pid}/tryout", tryout, methods=["POST", "DELETE"]),
        Route("/api/players/{pid}/standby", standby, methods=["POST", "DELETE"]),
        Route("/api/nodes/{nid}", evict_node, methods=["DELETE"]),
        Route("/api/nodes/{nid}/pull_log", node_pull_log, methods=["POST"]),
        Route("/api/options", get_options),
        Route("/api/options", put_options, methods=["PUT"]),
        Route("/api/powerups", powerups_view),
        Route("/api/stations/{nid}/reset", reset_station, methods=["POST"]),
        Route("/api/stations", stations_list),
        Route("/api/stations/arm", arm_stations, methods=["POST"]),
        Route("/api/stations/unlock", unlock_stations, methods=["POST"]),
        Route("/api/stations/{nid}", put_station, methods=["PUT"]),
        Route("/api/stations/{nid}", delete_station, methods=["DELETE"]),
        Route("/api/stations/{nid}/release", release_station, methods=["POST"]),
        Route("/api/players/{pid}/ready", ready, methods=["POST"]),
        Route("/api/players/{pid}/operator", operator_action, methods=["POST"]),
        Route("/api/lobby/ready_all", ready_all, methods=["POST"]),
        Route("/api/games/load", games_load, methods=["POST"]),
        Route("/api/lobby/push", lobby_push, methods=["POST"]),
        Route("/api/tunnel", tunnel, methods=["POST"]),
        Route("/api/start", start, methods=["POST"]),
        Route("/api/start/reschedule", reschedule, methods=["POST"]),
        Route("/api/start/abort", abort, methods=["POST"]),
        Route("/api/control", control, methods=["POST"]),
        Route("/api/recap", recap),
        Route("/api/matches", match_history),
        Route("/api/diag/matches", diag_matches),
        Route("/api/report", report_build, methods=["POST"]),
        Route("/api/report/{file}", report_download),
        Route("/api/recap.csv", recap_csv),
        Route("/api/matches/{mid}.csv", match_csv),
        Route("/api/session/new", new_session, methods=["POST"]),
        Route("/api/match/next", match_next, methods=["POST"]),
        Route("/api/match/orphan/resume", orphan_resume, methods=["POST"]),
        Route("/api/match/orphan/end", orphan_end, methods=["POST"]),
        WebSocketRoute("/ui-ws", ui_ws),
        # Bench 2026-09-24: a phone that dials the CONSOLE port with a websocket fell through to the
        # StaticFiles mount below, which asserts on a non-http scope (8 ASGI tracebacks per connect).
        # Every other websocket path on this port closes with 4404 and names the node URL instead.
        WebSocketRoute("/{path:path}", wrong_port_ws),
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
            # A28.1: the cloudflared child dies with MC. Killing it here rather than leaving it to the
            # OS means a --reload / test teardown does not leave a tunnel pointing at a dead port.
            tun = getattr(s, "tunnel", None)
            if tun is not None:
                with contextlib.suppress(Exception):
                    await tun.shutdown()
            # Fold the WAL into `session.sqlite` and close it, so the evidence folder ends with one
            # self-contained file (`Store.close` is idempotent and never raises).
            if s.store is not None:
                with contextlib.suppress(Exception):
                    s.store.close()

    app = Starlette(routes=routes, lifespan=lifespan,
                    middleware=[Middleware(CORSMiddleware, allow_origins=["*"],
                                           allow_methods=["*"], allow_headers=["*"]),   # outermost so 401s carry CORS headers
                                Middleware(_AuthMiddleware, token=token)])
    app.state.session = s
    app.state.broadcaster = bc
    return app
