"""Import `brx_mcp.server` under system python (no MCP SDK, no bleak) and give tests a fake manager.

Moved out of `test_server_safety.py` (A19) so `test_command_safety.py` no longer imports a test module.
The stub is installed and undone around the import, so `sys.modules` is clean afterwards (house rule:
run_tests.py imports every test file into ONE interpreter).
"""
import contextlib
import sys
import types

from brx_mcp.fake import FakeConnectionManager, FakeTagger


# ---------------------------------------------------------------------------
# Stub the two hardware/SDK-only dependencies just long enough to import server.py
# ---------------------------------------------------------------------------

def _install_stub_deps() -> dict:
    saved = {k: sys.modules.get(k) for k in
             ("mcp", "mcp.server", "mcp.server.mcpserver", "bleak", "bleak.exc")}

    class _StubMCPServer:
        """Mirrors the real MCPServer's tool()/resource() enough to import server.py:
        both decorators register (irrelevantly, here) and return the function unchanged."""

        def __init__(self, name: str) -> None:
            self.name = name

        def tool(self, *_a, **_kw):
            return lambda fn: fn

        def resource(self, *_a, **_kw):
            return lambda fn: fn

        def run(self) -> None:
            raise AssertionError("stub MCPServer.run() must never be called by a test")

    mcp_pkg = types.ModuleType("mcp")
    mcp_server_pkg = types.ModuleType("mcp.server")
    mcp_mcpserver_mod = types.ModuleType("mcp.server.mcpserver")
    mcp_mcpserver_mod.MCPServer = _StubMCPServer
    mcp_pkg.server = mcp_server_pkg
    mcp_server_pkg.mcpserver = mcp_mcpserver_mod

    class _StubBleakClient:
        def __init__(self, *_a, **_kw) -> None:
            raise AssertionError("stub BleakClient must never be instantiated by a test "
                                  "(no real BLE under system python)")

    class _StubBleakScanner:
        @staticmethod
        async def discover(*_a, **_kw):
            raise AssertionError("stub BleakScanner must never be called by a test")

    class _StubBleakError(Exception):
        pass

    bleak_mod = types.ModuleType("bleak")
    bleak_exc_mod = types.ModuleType("bleak.exc")
    bleak_mod.BleakClient = _StubBleakClient
    bleak_mod.BleakScanner = _StubBleakScanner
    bleak_mod.exc = bleak_exc_mod
    bleak_exc_mod.BleakError = _StubBleakError

    sys.modules["mcp"] = mcp_pkg
    sys.modules["mcp.server"] = mcp_server_pkg
    sys.modules["mcp.server.mcpserver"] = mcp_mcpserver_mod
    sys.modules["bleak"] = bleak_mod
    sys.modules["bleak.exc"] = bleak_exc_mod
    return saved


def _restore_stub_deps(saved: dict) -> None:
    for name, mod in saved.items():
        if mod is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = mod


_saved = _install_stub_deps()
try:
    import brx_mcp.server as server
finally:
    _restore_stub_deps(_saved)

_ORIGINAL_MANAGER = server.manager   # the real ConnectionManager server.py built at import time


# ---------------------------------------------------------------------------
# A manager double that adds what server.py needs and FakeConnectionManager doesn't have
# ---------------------------------------------------------------------------

class _TestManager(FakeConnectionManager):
    """`send_batch`, `_get`, `identify`, and a full-shape `get_events` — the parts of
    server.py's surface FakeConnectionManager (built for the game-sim path) doesn't cover.
    Everything else (scan/connect/disconnect/send/wait_for/diagnose/fleet_status) is inherited
    unchanged."""

    async def send_batch(self, alias: str, commands: list[str], gap_ms: int = 0) -> dict:
        sent = []
        for cmd in commands:
            await self.send(alias, cmd)
            sent.append(cmd)
        return {"sent_count": len(sent), "commands": sent}

    def _get(self, alias: str):
        return self.sessions[alias]

    def list_connections(self) -> list[dict]:
        return [{"alias": a, "address": s.address} for a, s in self.sessions.items()]

    async def identify(self, address: str) -> dict:
        reachable = address in self.taggers
        return {"address": address, "reachable": reachable,
                "generation": "fake" if reachable else "unknown",
                "pong_latency_ms": 0 if reachable else None}

    def get_events(self, alias: str, since_seq: int = 0, max_events: int = 200) -> dict:
        # Mirrors ble.ConnectionManager.get_events exactly (fake.py's own version only
        # returns {"events": [...]}), so this pins server.get_events's REAL contract.
        session = self.sessions[alias]
        events = [e.to_dict() for e in session.buffer if e.seq > since_seq]
        truncated = len(events) > max_events
        events = events[:max_events]
        return {"alias": alias, "events": events, "last_seq": session.seq, "truncated": truncated}


@contextlib.contextmanager
def fake_server_manager(taggers: list[FakeTagger]):
    """Point server.manager at a fresh _TestManager for one test; always restored after."""
    mgr = _TestManager(taggers)
    old = server.manager
    server.manager = mgr
    try:
        yield mgr
    finally:
        server.manager = old
