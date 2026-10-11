"""Mission Control reports routes."""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from starlette.responses import JSONResponse
from starlette.routing import BaseRoute, Route


def routes(ctx) -> list[BaseRoute]:
    s = ctx.s
    token = ctx.token
    _err = ctx.err
    log = logging.getLogger("brx.mc.api")

    # Report files THIS server built, by name. The download route serves nothing else, so a crafted
    # name (`..`, a slash, another session's zip) is a 404 before any path is formed from it.
    reports_built: dict[str, Path] = {}

    def _report_known() -> dict[str, list[str]]:
        """What only the live server knows: the roster's names and the armory's gun ids. Best effort."""
        from .. import report as _report
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
        from .. import report as _report
        from ...storage import home_dir
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
        from .. import report as _report
        name = req.path_params.get("file", "")
        path = reports_built.get(name) if _report.REPORT_NAME.fullmatch(name) else None
        if path is None or not path.is_file():
            return _err("no such report", 404)
        return FileResponse(str(path), media_type="application/zip", filename=name,
                            content_disposition_type="attachment")


    return [
        Route("/api/report", report_build, methods=["POST"]),
        Route("/api/report/{file}", report_download),
    ]
