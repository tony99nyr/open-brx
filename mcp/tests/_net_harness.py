"""Shared NetServer harness for the live-server tests (test_mc_net, test_mc_clock_step). Needs `websockets`."""
from __future__ import annotations

import asyncio
import time

try:
    from brx_mcp.mc.net import NetServer
except ImportError:  # system python without websockets
    NetServer = None


def run_net(coro):
    return asyncio.run(asyncio.wait_for(coro, 20))


class NetHarness:
    """A NetServer with recording callbacks, on an ephemeral port."""

    def __init__(self, **kw):
        self.net = NetServer(**kw)
        self.events: list[tuple[str, dict, int]] = []
        self.statuses: list[tuple[str, dict, int]] = []
        self.msgs: list[tuple[str, str, dict]] = []
        self.nodes: list[dict] = []
        self.stale: list[tuple[str, int]] = []
        self.returned: list[str] = []
        self.hydrate_calls: list[dict] = []
        self.context: dict | None = None
        self.net.on_event(lambda n, ev, t: self.events.append((n, ev, t)))
        self.net.on_status(lambda n, b, t: self.statuses.append((n, b, t)))
        self.net.on_node_message(lambda n, k, b, t: self.msgs.append((n, k, b)))
        self.net.on_node(lambda info: self.nodes.append(info))
        self.net.on_stale(lambda n, a: self.stale.append((n, a)))
        self.net.on_return(lambda n: self.returned.append(n))
        self.net.hydrate(self._hydrate)

    def _hydrate(self, hello):
        self.hydrate_calls.append(hello)
        return self.context

    async def __aenter__(self):
        await self.net.start("127.0.0.1", 0)
        self.url = f"ws://127.0.0.1:{self.net.port}/ws"
        return self

    async def __aexit__(self, *a):
        await self.net.stop()


async def net_until(pred, timeout=5.0, step=0.02):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if pred():
            return True
        await asyncio.sleep(step)
    return pred()
