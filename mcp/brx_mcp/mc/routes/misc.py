"""Mission Control misc routes."""
from __future__ import annotations

from starlette.responses import JSONResponse
from starlette.routing import BaseRoute, Route

from ..net import peer_class


def routes(ctx) -> list[BaseRoute]:
    s = ctx.s
    token = ctx.token
    body = ctx.body
    _err = ctx.err
    operator = ctx.operator
    _without_pins = ctx.without_pins
    ui_dist = ctx.ui_dist

    async def shutdown(req):
        """A graceful stop the launcher can ask for (brx2's contract, 2026-10-10): on Windows Node's kill() is a hard
        TerminateProcess, so no signal handler would run. Gated like every write by `_AuthMiddleware`; with auth off it
        answers loopback only, and it always needs `X-BRX-Shutdown: 1`. 202, then uvicorn stops; the lifespan's shutdown writes the session snapshot, and the
        process exits 0."""
        # A plain HTML form (a page on the operator's laptop) cannot set a custom header, so this stops a drive-by form
        # post. It is NOT a defence against a script: the CORS middleware allows every origin, and with --no-auth every
        # write is open to anything on the LAN, as the banner says. With auth on, the token protects this route.
        if req.headers.get("x-brx-shutdown") != "1":
            return _err("SHUTDOWN NEEDS THE X-BRX-Shutdown: 1 HEADER", 400)
        # Round 2 L2: under `--host ::` the launcher's 127.0.0.1 arrives as ::ffff:127.0.0.1; net.peer_class reads the
        # IPv4-mapped form (it got a 403, so the launcher killed MC and, on Windows, skipped the final snapshot)
        if token is None and (req.client is None or peer_class(req.client.host) != "loopback"):
            return _err("SHUTDOWN IS LOCAL ONLY WITH AUTH OFF", 403)
        stop = getattr(req.app.state, "request_shutdown", None)
        if stop is None:
            return _err("THIS MC CANNOT BE STOPPED FROM THE API", 503)
        stop()
        return JSONResponse({"ok": True}, status_code=202)


    async def state(req):
        snap = s.snapshot()
        return JSONResponse(snap if operator(req) else _without_pins(snap))


    async def evict_node(req):
        nid = req.path_params["nid"]
        if not s.evict_node(nid):
            return _err("no such node", 404)
        return JSONResponse({"ok": True})


    async def get_options(_):
        return JSONResponse(dict(s.options))


    async def put_options(req):
        """A25: the session option table. Only the keys we know, only the values we know."""
        b = await body(req)
        from ..state import OPTION_DEFAULTS
        unknown = [k for k in b if k not in OPTION_DEFAULTS]
        if unknown:
            return _err(f"unknown option(s): {', '.join(sorted(unknown))}")
        try:
            for k, v in b.items():
                s.set_option(k, v)
        except ValueError as e:
            return _err(e)
        return JSONResponse(dict(s.options))


    async def node_pull_log(req):
        """A25: the operator's LOGS button. `reason: "manual"` — never gated by `log_sync`."""
        nid = req.path_params["nid"]
        if nid not in s.nodes:
            return _err("no such node", 404)
        why = s.pull_log_refusal(nid, "manual")
        return JSONResponse({"ok": why is None, "reason": why, "node_id": nid, "log": s.nodes[nid].get("log")})


    async def apk(_):
        """The companion APK, served from a stable path (webapp rebuilds wipe dist copies)."""
        from starlette.responses import FileResponse
        from ...storage import home_dir          # the staged APK lives wherever this MC persists things
        for cand in (home_dir() / "openbrx-node-debug.apk", ui_dist() / "openbrx.apk"):
            if cand.exists():
                return FileResponse(str(cand), media_type="application/vnd.android.package-archive", filename="openbrx.apk")
        return JSONResponse({"error": "no apk staged"}, status_code=404)


    return [
        Route("/api/state", state),
        Route("/api/shutdown", shutdown, methods=["POST"]),
        Route("/openbrx.apk", apk),
        Route("/api/nodes/{nid}", evict_node, methods=["DELETE"]),
        Route("/api/nodes/{nid}/pull_log", node_pull_log, methods=["POST"]),
        Route("/api/options", get_options),
        Route("/api/options", put_options, methods=["PUT"]),
    ]
