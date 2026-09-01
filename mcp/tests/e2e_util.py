"""Shared harness for the M-MODES/MC integration scenario tests (test_mc_e2e.py).

Stands up the REAL stack in-process — Session + real NetServer + real Compiler — on an ephemeral
port and drives real MockNodes over a real WebSocket, then asserts game outcomes (scoring/recap).
Complements test_mc_net.py (net mechanics) and test_mc_state.py (Session unit, fake net).

Skips cleanly when `websockets` is absent; run for real with `.venv/bin/python run_tests.py mc_e2e`.
"""
from __future__ import annotations

import asyncio
import time

try:
    import websockets  # noqa: F401
    HAVE_WS = True
except ImportError:
    HAVE_WS = False

from _skip import Skipped

if HAVE_WS:
    from brx_mcp.mc.mock_node import MockNode
    from brx_mcp.mc.net import NetServer
    from brx_mcp.mc.state import Session
    from brx_mcp.mc.compile import Compiler

# A healthy configured-gun echo (headset proven); None = headset off / gun asleep.
GUN_ECHO = "$LCD,45,70,0,0,36,216,*"


def skip(name: str) -> None:
    """Bow out of an e2e flow. RAISES, so run_tests.py counts it as a skip — it used to print and
    return, which the runner scored as a PASS (review 2026-09-01)."""
    raise Skipped("websockets")


def run(coro):
    return asyncio.run(asyncio.wait_for(coro, 30))


async def until(pred, timeout=6.0, step=0.02):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if pred():
            return True
        await asyncio.sleep(step)
    return pred()


class _FakeArmory:
    """No enrolled guns — nodes self-identify; binding is by gun_id==gun_name (state._find_player_for_gun)."""
    def list(self):
        return []

    async def scan(self, duration_s: int = 6):
        return []


class Stack:
    """Real Session + NetServer + Compiler on an ephemeral port. `async with Stack() as s: ...`."""

    def __init__(self, mode: str = "tdm", time_limit_s: int = 30, **cfg):
        self.net = NetServer()
        self.session = Session(Compiler(), self.net, _FakeArmory())
        self._mode = mode
        self._time_limit_s = time_limit_s
        self._cfg = cfg
        self.nodes: list = []

    async def __aenter__(self):
        await self.net.start("127.0.0.1", 0, "/ws", advertise_host="127.0.0.1")
        self.url = self.net.join_info()["url"]
        patch = {"mode": self._mode, "time_limit_s": self._time_limit_s}
        patch.update(self._cfg)
        self.session.set_config(patch)
        return self

    async def __aexit__(self, *a):
        for n in self.nodes:
            await n.close()
        await self.net.stop()

    # -- driving helpers ---------------------------------------------------
    def add_player(self, display: str, gun: str, team_id: str | None = None, **kw):
        return self.session.add_player(display, team_id=team_id, gun_id=gun, **kw)

    async def connect_node(self, gun: str, *, gun_echo: str | None = GUN_ECHO,
                           node_id: str | None = None, heartbeat_ms: int = 40) -> "MockNode":
        node = MockNode(self.url, node_id=node_id, gun_name=gun, gun_tail=gun.rsplit("-", 1)[-1],
                        gun_echo=gun_echo, heartbeat_ms=heartbeat_ms, backoff_cap_s=0.2)
        self.nodes.append(node)
        await node.start()
        await node.wait_connected()
        return node

    async def wait_ready(self, timeout=6.0) -> bool:
        """Every node bound + synced + a green readiness row → go."""
        return await until(lambda: self.session.readiness()["go"], timeout=timeout)

    async def push_and_start(self, runway_s: int = 1):
        self.session.push_config()
        assert await until(self.session.all_acked, 6.0), "not all nodes acked the config"
        info = self.session.start(runway_s=runway_s)
        return info

    async def wait_live(self, timeout=6.0) -> bool:
        return await until(lambda: all(n.arm_state == "live" and n.alive for n in self.nodes), timeout=timeout)
