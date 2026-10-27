"""Test-only launcher for app/tools/postmatch-e2e.mjs (F635): Mission Control with a short A81 release bound.

MC releases a result without the missing phones and hills SYNC_STUCK_S after the whistle (120 s, types.py). The gate
waits for that release twice, so it sets a short bound here instead of waiting four minutes. state.py imports the
constant by name and reads it at call time (`release_due_mono` at the whistle, the stuck flag, a resumed wait), so
patching the module global is enough. No product file changes.

Usage: python postmatch_mc.py <sync_stuck_s> <MC arguments...>
The bound comes in argv, not in an environment variable (CLAUDE.md: env vars do not cross from WSL to Windows Python).
"""
from __future__ import annotations

import runpy
import sys


def _fail(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)
    sys.exit(2)


def main() -> None:
    if len(sys.argv) < 2 or not sys.argv[1].isdigit() or int(sys.argv[1]) < 1:
        print("usage: postmatch_mc.py <sync_stuck_s> <MC arguments...>", file=sys.stderr)
        sys.exit(2)
    stuck_s = int(sys.argv[1])
    import brx_mcp.mc.state as state
    import brx_mcp.mc.types as types
    if "SYNC_STUCK_S" not in vars(state):
        _fail("app/tools/postmatch_mc.py: brx_mcp.mc.state no longer holds SYNC_STUCK_S, so this override would "
              "change nothing. Update the launcher to patch where MC now reads the release bound.")
    old = state.SYNC_STUCK_S
    state.SYNC_STUCK_S = stuck_s   # the name state.py reads
    types.SYNC_STUCK_S = stuck_s   # for any later `from .types import SYNC_STUCK_S`
    stale = sorted(name for name, mod in list(sys.modules.items())
                   if name.startswith("brx_mcp") and vars(mod).get("SYNC_STUCK_S", stuck_s) == old)
    if stale:
        _fail(f"app/tools/postmatch_mc.py: {', '.join(stale)} still hold SYNC_STUCK_S={old} after the override. "
              "Patch those modules too, or the gate tests a bound MC does not use.")
    print(f"postmatch_mc: SYNC_STUCK_S={state.SYNC_STUCK_S} (test override)", flush=True)
    sys.argv = ["brx_mcp.mc", *sys.argv[2:]]
    runpy.run_module("brx_mcp.mc", run_name="__main__", alter_sys=True)


if __name__ == "__main__":
    main()
