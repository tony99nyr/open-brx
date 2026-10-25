"""Mission Control recap history routes."""
from __future__ import annotations

import asyncio
import logging

from starlette.responses import JSONResponse
from starlette.responses import Response
from starlette.routing import BaseRoute, Route

from ..types import MatchHistoryRow

def routes(ctx) -> list[BaseRoute]:
    s = ctx.s
    body = ctx.body
    _err = ctx.err

    _SAFE_NAME = __import__("re").compile(r"[^A-Za-z0-9._-]")

    def _csv(body: str, name: str) -> Response:
        # The filename is sanitised, not trusted. It carries a match_id, which IS a path param — the
        # earlier comment here claimed it was "never echoed user text", which was simply wrong; it
        # was safe only because the store lookup 404s an unknown id first. Defence in depth: a quote
        # or newline reaching a header is a response-splitting bug, and Starlette encodes headers as
        # latin-1 so a non-ASCII one would raise inside the handler (review 2026-09-01).
        return Response(body, media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="{_SAFE_NAME.sub("_", name)}"'})


    async def recap(_):
        r = s.recap()
        return JSONResponse(r) if r else _err("no match", 404)


    async def finalise_recap(_):
        try:
            return JSONResponse(s.finalise_recap())
        except ValueError as e:
            return _err(e, 409)


    async def match_history(_):
        """Past matches, newest first (A8): the RECAP screen's history picker. Read-only, so it needs
        no operator token — a spectator may look at how the last round went."""
        if not s.store:
            return JSONResponse([])
        try:
            # the FULL config (and the compiled head under `_heads`), not just the mode — debugging a
            # field report needs every setting the game actually ran with, not a summary of it
            rows: list[MatchHistoryRow] = []
            current = s.match
            scorer = current.scorer if current is not None else None
            current_id = scorer.match_id if s.phase == "recap" and scorer is not None else None
            sync = (s.recap().get("sync") or {}) if current_id else {}
            pending = bool(sync.get("pending"))
            for m in s.store.matches():
                config = m["config"] or {}
                is_pending = pending and m["match_id"] == current_id
                row = {"match_id": m["match_id"], "go_live_t": m["go_live_t"],
                       "ended_t": m["ended_t"],
                       "mode": config.get("mode", "")}
                if is_pending:
                    row["pending"] = True
                else:
                    row["recap"] = m["recap"]
                    row["config"] = config
                rows.append(row)
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
        current = s.match
        head = current.head if current is not None else None
        current_match = (head or {}).get("match_id")
        blocked_armed = s.phase == "armed" and (not match or not current_match or match == current_match)
        if s.phase == "live" or blocked_armed:
            return _err(f"the match is {s.phase.upper()} — the diagnostic scans the whole session store "
                        f"and is not run on the current game; during ARMED, request a previous match id, "
                        f"or ask again at the recap", 409)
        if not s.store:
            return JSONResponse([])
        from .. import diag
        path = s.store.path
        try:
            loop = asyncio.get_running_loop()
            return JSONResponse(await loop.run_in_executor(None, lambda: diag.build_report_path(path, match)))
        except Exception:
            import logging
            logging.getLogger("brx.mc").exception("diag unavailable")
            return JSONResponse([])


    async def recap_csv(_):
        match = s.match
        scorer = match.scorer if match is not None else None
        if not scorer:
            return _err("no match", 404)
        if (s.recap().get("sync") or {}).get("pending"):
            # F596: the table is provisional until every phone is received or FINALISE, as on the RECAP page
            return _err("results pending: wait for every phone to sync, or FINALISE", 409)
        return _csv(scorer.csv(), "recap.csv")


    async def match_csv(req):
        """One ARCHIVED match's stats table (W1/F6).

        `/api/recap.csv` serves the LIVE scorer, so the RECAP history picker had to hide its export
        button on a past match rather than hand the operator the wrong game's numbers. A finished
        match keeps its rows in the session store; this reads them back through the same writer.
        Read-only, so no operator token — exactly like `GET /api/matches`."""
        from ..scoring import rows_csv
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
        current = s.match
        scorer = current.scorer if current is not None else None
        current_id = scorer.match_id if s.phase == "recap" and scorer is not None else None
        if mid == current_id and (s.recap().get("sync") or {}).get("pending"):
            return _err("results pending: wait for every phone to sync, or FINALISE", 409)
        rows = (m.get("recap") or {}).get("rows")
        # A recap with no rows is a real match that scored nobody. Serve the header row: an empty
        # download is a truthful answer, and a 404 here reads as "that match is gone".
        return _csv(rows_csv(rows if isinstance(rows, list) else []), f"recap-{mid}.csv")


    return [
        Route("/api/recap", recap),
        Route("/api/recap/finalise", finalise_recap, methods=["POST"]),
        Route("/api/matches", match_history),
        Route("/api/diag/matches", diag_matches),
        Route("/api/recap.csv", recap_csv),
        Route("/api/matches/{mid}.csv", match_csv),
    ]
