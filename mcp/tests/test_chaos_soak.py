"""The MC soak (`brx_mcp/chaos/soak.py`): OPT-IN. The default `test:all` run only checks the growth
rule itself, which is pure and instant.

Run the soak:
    cd mcp && BRX_CHAOS_SOAK_MIN=10 ../.venv/bin/python run_tests.py chaos_soak
    cd mcp && ../.venv/bin/python -m brx_mcp.chaos soak --minutes 10
(RUN_TESTS_TIMEOUT_S must exceed the soak: the runner kills a file after 300 s by default.)
"""
from __future__ import annotations

import os

from _skip import needs

from brx_mcp.chaos.soak import growth_verdict, rss_mb

try:
    import websockets  # noqa: F401
    HAVE_WS = True
except ImportError:
    HAVE_WS = False


def test_flat_memory_passes_and_steady_growth_fails():
    assert growth_verdict([100, 104, 102, 103, 101, 104, 103, 102], 16)[0]
    assert not growth_verdict([100 + 10 * i for i in range(12)], 16)[0], "10 MB a match is unbounded growth"
    assert growth_verdict([100, 101], 16)[0], "too few samples is no verdict, not a failure"


def test_rss_is_a_positive_number():
    assert rss_mb() > 0


def test_the_soak_itself():
    minutes = float(os.environ.get("BRX_CHAOS_SOAK_MIN", "0") or 0)
    needs(minutes > 0, "BRX_CHAOS_SOAK_MIN=<minutes> (opt-in soak)")
    needs(HAVE_WS, "websockets")
    from brx_mcp.chaos.soak import run_soak
    from brx_mcp.storage import home_dir
    assert run_soak(minutes=minutes, nodes=int(os.environ.get("BRX_CHAOS_SOAK_NODES", "12")),
                    max_growth_mb=float(os.environ.get("BRX_CHAOS_SOAK_MAX_MB", "32")),
                    workdir=home_dir() / "chaos-soak")
