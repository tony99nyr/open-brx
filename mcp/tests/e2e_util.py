"""Shared harness for the M-MODES/MC integration scenario tests (test_mc_e2e.py).

Stands up the REAL stack in-process (`brx_mcp/chaos/stack.py`) — Session + real NetServer + real Compiler — on an ephemeral
port and drives real MockNodes over a real WebSocket, then asserts game outcomes (scoring/recap).
Complements test_mc_net.py (net mechanics) and test_mc_state.py (Session unit, fake net).

Skips cleanly when `websockets` is absent; run for real with `.venv/bin/python run_tests.py mc_e2e`.
"""
from __future__ import annotations

import asyncio

try:
    import websockets  # noqa: F401
    HAVE_WS = True
except ImportError:
    HAVE_WS = False

from _skip import Skipped

if HAVE_WS:
    # The harness itself lives in the package (chaos testing reuses it outside the test runner).
    from brx_mcp.chaos.stack import GUN_ECHO, Stack, _FakeArmory, until  # noqa: F401
else:
    # Every flow skips without websockets; these names only have to import.
    GUN_ECHO = "$LCD,45,70,0,0,36,216,*"
    Stack = _FakeArmory = None

    async def until(pred, timeout=6.0, step=0.02):
        return pred()


def skip(name: str) -> None:
    """Bow out of an e2e flow. RAISES, so run_tests.py counts it as a skip — it used to print and
    return, which the runner scored as a PASS (review 2026-09-01)."""
    raise Skipped("websockets")


def run(coro):
    return asyncio.run(asyncio.wait_for(coro, 30))
