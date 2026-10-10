"""Mission Control tunnel lan routes."""
from __future__ import annotations

from starlette.responses import JSONResponse
from starlette.routing import BaseRoute, Route

from ..tunnel import TunnelError

def routes(ctx) -> list[BaseRoute]:
    s = ctx.s
    body = ctx.body
    _err = ctx.err

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


    return [
        Route("/api/tunnel", tunnel, methods=["POST"]),
    ]
