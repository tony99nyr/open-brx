"""brx-mcp — MCP server giving Claude Code direct BLE control of BRX taggers."""

__version__ = "0.1.0"

# Test runs must import THIS checkout. The dev venv's editable install points at the main checkout, so a worktree's
# or the land lane's test could silently run main's code and pass (a false green, 2026-10-04). test-all sets
# BRX_MCP_EXPECT_DIR to the checkout's mcp/ for every job; an import from anywhere else fails loudly.
import os as _os

_expect = _os.environ.get("BRX_MCP_EXPECT_DIR")
if _expect:
    _here = _os.path.realpath(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
    if _os.path.realpath(_expect) != _here:
        raise ImportError(
            f"brx_mcp imported from {_here}, but this test run checks {_os.path.realpath(_expect)}: put "
            "<checkout>/mcp first on PYTHONPATH (the venv's editable install points at another checkout)")

