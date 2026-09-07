"""Characterisation tests for `brx_mcp/server.py` — the MCP tool surface that drives real BRX
taggers over BLE. Zero coverage existed before this file.

WHY THIS MATTERS (CLAUDE.md hard rule): "MCP/server enforce the known-safe command list
(`protocol.py`); unknown commands need explicit confirm. Panic sequence: `$CLEAR,*` then
`$SP,99,*`". Nothing verified any of that. `protocol.py` (`KNOWN_SAFE_COMMANDS`, `is_known_safe`,
`validate_frame`, `command_name`) is the authority this file pins server.py against.

WHY THE IMPORT NEEDS STUBBING. Under system python (no pip, `run_tests.py`'s contract):
  - `brx_mcp/server.py` does `from mcp.server.mcpserver import MCPServer` — the real MCP SDK is
    not installed here.
  - `brx_mcp/ble.py` (imported by server.py for `ConnectionManager`) does `from bleak import
    BleakClient, BleakScanner` — bleak is not installed here either (there is no Bluetooth in
    WSL2 at all).
Both are stubbed into `sys.modules` JUST long enough to import `brx_mcp.server`, then restored
(house rule: any sys.modules stub must be undone in a `finally`, since run_tests.py imports every
test file into ONE interpreter). The stub `MCPServer.tool()`/`.resource()` decorators register and
return the function UNCHANGED — confirmed against the real SDK
(.venv/lib/python3.12/site-packages/mcp/server/mcpserver/server.py:~700, `tool()` ends `return
fn`) — so every `@mcp.tool()` function in server.py stays a plain, directly-callable coroutine or
function, exactly as it is when the real SDK is present.

Once imported, `server.manager` (a real `ConnectionManager`) is swapped for a small
`_TestManager(FakeConnectionManager)` for the duration of each test (via the `_fake_manager`
context manager, always restored). `FakeConnectionManager` (brx_mcp/fake.py) was built for the
game-sim path and lacks `send_batch`/`_get`/`identify` and a full `get_events` shape — `_TestManager`
adds those here, in test code only; `fake.py` itself is not touched.

No real BLE connection is ever opened. No production code is modified.
"""
from __future__ import annotations

import contextlib
import pathlib
import sys
import tempfile
import types

from _async import run
from brx_mcp import protocol
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
def _fake_manager(taggers: list[FakeTagger]):
    """Point server.manager at a fresh _TestManager for one test; always restored after."""
    mgr = _TestManager(taggers)
    old = server.manager
    server.manager = mgr
    try:
        yield mgr
    finally:
        server.manager = old


@contextlib.contextmanager
def _no_op_save_device():
    """server.connect/identify/diagnostics all call storage.save_device — stub it so a test
    never writes to the real ~/.brx-mcp registry. Returns the list of recorded calls."""
    calls: list[tuple[tuple, dict]] = []
    old = server.storage.save_device
    server.storage.save_device = lambda *a, **kw: calls.append((a, kw))
    try:
        yield calls
    finally:
        server.storage.save_device = old


@contextlib.contextmanager
def _fake_captures_dir():
    """session_log() reads/writes under storage.CAPTURES_DIR — redirect it to a scratch dir
    so a test never touches the real ~/.brx-mcp/captures."""
    tmp = pathlib.Path(tempfile.mkdtemp())
    old = server.storage.CAPTURES_DIR
    server.storage.CAPTURES_DIR = tmp
    try:
        yield tmp
    finally:
        server.storage.CAPTURES_DIR = old


@contextlib.contextmanager
def _broken_is_known_safe():
    """Monkeypatch protocol.is_known_safe to always say yes — used ONLY to prove the gate
    is load-bearing (a gate that can't be made to fail is indistinguishable from no gate)."""
    old = protocol.is_known_safe
    protocol.is_known_safe = lambda _cmd: True
    try:
        yield
    finally:
        protocol.is_known_safe = old


UNSAFE = "$FOOBAR,1,*"          # FOOBAR is not in KNOWN_SAFE_COMMANDS
SAFE = "$PING,*"                # PING is


# ===========================================================================
# 1. send() — the gate
# ===========================================================================

def test_send_known_safe_command_goes_through_without_confirm():
    with _fake_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        result = run(server.send("t1", SAFE))
    assert result == {"sent": SAFE, "replies_within_window": []}


def test_send_unsafe_command_without_confirm_is_refused_cleanly():
    with _fake_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        result = run(server.send("t1", UNSAFE))
        # refused BEFORE it ever reached the tagger: no tx was recorded
        assert len(mgr.sessions["t1"].buffer) == 0
    assert result == {
        "error": "'FOOBAR' is not in the known-safe command list; retry with "
                 "confirm=true if you intend to send it",
        "command": UNSAFE,
    }


def test_send_refusal_is_a_plain_dict_not_an_exception():
    # A test that only checks "it did not raise" is worthless on a safety rail; this asserts
    # the SHAPE (a dict with 'error' and 'command', nothing else that would suggest a crash
    # path) so a regression that turned the refusal into an exception, or into a silent
    # no-op-returning-None, would fail loudly here.
    with _fake_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        result = run(server.send("t1", UNSAFE))
    assert isinstance(result, dict)
    assert set(result) == {"error", "command"}


def test_send_unsafe_command_with_confirm_true_is_let_through():
    with _fake_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        result = run(server.send("t1", UNSAFE, confirm=True))
    assert result == {"sent": UNSAFE, "replies_within_window": []}


def test_send_gate_is_load_bearing_not_vacuous():
    """Proves the refusal above is really coming from is_known_safe: break it, and the SAME
    unsafe command, with the SAME confirm=False, slips straight through. A gate that cannot be
    made to fail this way is indistinguishable from no gate at all."""
    with _fake_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        with _broken_is_known_safe():
            result = run(server.send("t1", UNSAFE))
    assert "error" not in result
    assert result == {"sent": UNSAFE, "replies_within_window": []}


# ===========================================================================
# 2. send() — malformed frames (validate_frame)
# ===========================================================================

def test_send_rejects_frame_missing_dollar_prefix():
    with _fake_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        result = run(server.send("t1", "PING,*"))
        assert len(mgr.sessions["t1"].buffer) == 0
    assert result == {"error": "malformed frame: frame must start with '$'",
                       "command": "PING,*"}


def test_send_rejects_frame_missing_trailing_comma_star():
    with _fake_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        result = run(server.send("t1", "$PING"))
    assert result == {"error": "malformed frame: frame must end with ',*'",
                       "command": "$PING"}


def test_send_rejects_frame_that_fails_the_pattern_check():
    # starts with '$', ends with ',*', still not a valid frame (no command word)
    with _fake_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        result = run(server.send("t1", "$,*"))
    assert result == {
        "error": "malformed frame: frame failed pattern check ($NAME,tokens...,*)",
        "command": "$,*",
    }


def test_send_malformed_frame_check_runs_before_the_safety_gate():
    # a malformed frame that would ALSO be unsafe reports the framing error, not the
    # not-known-safe error — validate_frame runs first in server.send().
    with _fake_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        result = run(server.send("t1", "$FOOBAR"))
    assert result["error"].startswith("malformed frame:")


# ===========================================================================
# 3. send_batch() — same gate, applied to every command in the batch
# ===========================================================================

def test_send_batch_all_known_safe_commands_go_through():
    with _fake_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        result = run(server.send_batch("t1", ["$CLEAR,*", "$SP,99,*"]))
    assert result == {"sent_count": 2, "commands": ["$CLEAR,*", "$SP,99,*"]}


def test_send_batch_one_unsafe_command_blocks_the_whole_batch():
    """A batch of otherwise-safe commands with ONE unsafe command in the middle must not let
    the safe ones through either -- server.send_batch validates every command before sending
    any of them, so the whole batch is refused as a unit."""
    commands = ["$PING,*", "$SP,99,*", UNSAFE, "$CLEAR,*"]
    with _fake_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        result = run(server.send_batch("t1", commands))
        # NOTHING reached the tagger -- not even the three safe commands before/after it
        assert len(mgr.sessions["t1"].buffer) == 0
    assert result == {
        "error": "'FOOBAR' is not known-safe; retry with confirm=true",
        "command": UNSAFE,
    }


def test_send_batch_unsafe_command_anywhere_in_the_list_is_caught():
    # same property, unsafe command placed FIRST rather than in the middle
    commands = [UNSAFE, "$PING,*"]
    with _fake_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        result = run(server.send_batch("t1", commands))
        assert len(mgr.sessions["t1"].buffer) == 0
    assert result["command"] == UNSAFE


def test_send_batch_malformed_frame_blocks_the_whole_batch():
    commands = ["$PING,*", "$MALFORMED_NO_STAR"]
    with _fake_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        result = run(server.send_batch("t1", commands))
        assert len(mgr.sessions["t1"].buffer) == 0
    assert result == {"error": "malformed frame: frame must end with ',*'",
                       "command": "$MALFORMED_NO_STAR"}


def test_send_batch_confirm_true_lets_the_unsafe_command_through_with_the_rest():
    commands = ["$PING,*", UNSAFE]
    with _fake_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        result = run(server.send_batch("t1", commands, confirm=True))
    assert result == {"sent_count": 2, "commands": commands}


def test_send_batch_gate_is_load_bearing_not_vacuous():
    """Same proof as the send() version, for the batch path: break is_known_safe and the
    previously-blocked batch (test_send_batch_one_unsafe_command_blocks_the_whole_batch) now
    goes through in full."""
    commands = ["$PING,*", UNSAFE, "$CLEAR,*"]
    with _fake_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        with _broken_is_known_safe():
            result = run(server.send_batch("t1", commands))
    assert "error" not in result
    assert result == {"sent_count": 3, "commands": commands}


# ===========================================================================
# 4. panic() — the hard-coded panic sequence
# ===========================================================================

def test_panic_sequence_constant_is_clear_then_sp99_in_that_order():
    # This exact pair, this exact order, is a CLAUDE.md hard rule.
    assert protocol.PANIC_SEQUENCE == ["$CLEAR,*", "$SP,99,*"]


def test_panic_sends_clear_then_sp99_to_the_tagger_in_order():
    with _fake_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        result = run(server.panic("t1"))
    assert result == {"sent_count": 2, "commands": ["$CLEAR,*", "$SP,99,*"]}


def test_panic_leaves_the_gun_with_no_sir_row_by_design():
    # Do NOT "fix" this: an empty $SIR table (unhittable until re-armed, F11) is the POINT of
    # a panic stop, and protocol.PANIC_SEQUENCE is explicitly allowlisted for exactly this in
    # tests/test_clear_safety.py's INTENTIONAL_TEARDOWNS.
    assert not any(cmd.startswith("$SIR") for cmd in protocol.PANIC_SEQUENCE)


def test_panic_bypasses_the_confirm_gate_entirely():
    """CHARACTERISATION, not endorsement: server.panic() calls manager.send_batch() directly,
    never going through server.send_batch()'s validate_frame/is_known_safe loop. This is
    currently harmless -- CLEAR and SP are both in KNOWN_SAFE_COMMANDS -- but it means panic()
    would send ANY future PANIC_SEQUENCE content unconditionally, gate or no gate. Documented
    here so a change to PANIC_SEQUENCE can't quietly start bypassing the safety rail; not fixing
    it per the task brief (this is the one weapon-of-last-resort path where "always fires,
    no confirmation" is arguably correct)."""
    with _fake_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        with _broken_is_known_safe():
            # even with the gate broken (which would make send_batch's OWN check useless
            # anyway), panic's result is identical -- it never consulted the gate to begin with
            result = run(server.panic("t1"))
    assert result == {"sent_count": 2, "commands": ["$CLEAR,*", "$SP,99,*"]}


# ===========================================================================
# 5. connection lifecycle bookkeeping
# ===========================================================================

def test_connect_opens_a_session_and_persists_alias_via_storage():
    with _fake_manager([FakeTagger("AA:1")]) as mgr, _no_op_save_device() as calls:
        result = run(server.connect("AA:1", "t1"))
        assert mgr.list_connections() == [{"alias": "t1", "address": "AA:1"}]
    assert result == {"alias": "t1", "address": "AA:1", "connected": True}
    assert calls == [(("AA:1",), {"alias": "t1"})]


def test_disconnect_removes_the_session():
    with _fake_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        result = run(server.disconnect("t1"))
        assert mgr.list_connections() == []
    assert result == {"alias": "t1", "disconnected": True}


def test_list_connections_reflects_open_sessions():
    with _fake_manager([FakeTagger("AA:1"), FakeTagger("BB:2")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        run(mgr.connect("BB:2", "t2"))
        result = server.list_connections()
    assert result == [{"alias": "t1", "address": "AA:1"},
                       {"alias": "t2", "address": "BB:2"}]


def test_identify_reports_reachable_and_persists_via_storage():
    with _fake_manager([FakeTagger("AA:1")]) as mgr, _no_op_save_device() as calls:
        result = run(server.identify("AA:1"))
    assert result["reachable"] is True
    assert calls == [(("AA:1",), {"generation": "fake"})]


# ===========================================================================
# 6. get_events — since_seq filtering + truncation
# ===========================================================================

def test_get_events_only_returns_events_newer_than_since_seq():
    with _fake_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        run(mgr.send("t1", "$PING,*"))    # seq 1 (tx)
        run(mgr.send("t1", "$PING,*"))    # seq 2 (tx)
        result = server.get_events("t1", since_seq=1)
    assert [e["seq"] for e in result["events"]] == [2]
    assert result["last_seq"] == 2
    assert result["truncated"] is False


def test_get_events_since_seq_zero_returns_everything():
    with _fake_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        run(mgr.send("t1", "$PING,*"))
        run(mgr.send("t1", "$PING,*"))
        result = server.get_events("t1", since_seq=0)
    assert [e["seq"] for e in result["events"]] == [1, 2]


def test_get_events_truncates_at_max_events_and_says_so():
    with _fake_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        for _ in range(3):
            run(mgr.send("t1", "$PING,*"))
        result = server.get_events("t1", since_seq=0, max_events=2)
    assert [e["seq"] for e in result["events"]] == [1, 2]
    assert result["truncated"] is True
    assert result["last_seq"] == 3


# ===========================================================================
# 7. wait_for
# ===========================================================================

def test_wait_for_matches_an_already_buffered_reply_by_prefix():
    with _fake_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        run(mgr.send("t1", "$PHONE,*"))     # FakeTagger answers with $BUT then $VOLTS
        result = run(server.wait_for("t1", "$BUT"))
    assert result["matched"] is True
    assert result["event"]["raw"] == "$BUT,3,0,*"


def test_wait_for_reports_no_match_rather_than_hanging_or_raising():
    with _fake_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        result = run(server.wait_for("t1", "$NEVER_ARRIVES"))
    assert result == {"matched": False}


# ===========================================================================
# 8. session_log
# ===========================================================================

def test_session_log_start_requires_a_label():
    with _fake_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        result = server.session_log("t1", "start", label="")
    assert result == {"error": "label required for start"}


def test_session_log_start_records_label_and_path_on_the_session():
    with _fake_manager([FakeTagger("AA:1")]) as mgr, _fake_captures_dir() as tmp:
        run(mgr.connect("AA:1", "t1"))
        result = server.session_log("t1", "start", label="bench_run")
        session = mgr._get("t1")
    assert result == {"logging": True, "label": "bench_run",
                       "path": str(tmp / "bench_run.jsonl")}
    assert session.log_label == "bench_run"
    assert session.log_file == tmp / "bench_run.jsonl"


def test_session_log_stop_clears_the_session_and_reports_what_was_stopped():
    with _fake_manager([FakeTagger("AA:1")]) as mgr, _fake_captures_dir():
        run(mgr.connect("AA:1", "t1"))
        server.session_log("t1", "start", label="bench_run")
        result = server.session_log("t1", "stop")
        session = mgr._get("t1")
    assert result == {"logging": False, "stopped_label": "bench_run"}
    assert session.log_file is None
    assert session.log_label is None


def test_session_log_dump_of_a_missing_capture_reports_available_ones():
    with _fake_manager([FakeTagger("AA:1")]) as mgr, _fake_captures_dir():
        run(mgr.connect("AA:1", "t1"))
        result = server.session_log("t1", "dump", label="does_not_exist")
    assert "error" in result
    assert result["available"] == []


def test_session_log_dump_counts_lines_of_an_existing_capture():
    with _fake_manager([FakeTagger("AA:1")]) as mgr, _fake_captures_dir() as tmp:
        run(mgr.connect("AA:1", "t1"))
        target = tmp / "prewritten.jsonl"
        target.write_text('{"a": 1}\n{"a": 2}\n{"a": 3}\n', encoding="utf-8")
        result = server.session_log("t1", "dump", label="prewritten")
    assert result == {"label": "prewritten", "path": str(target), "line_count": 3}


def test_session_log_unknown_action_is_rejected():
    with _fake_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        result = server.session_log("t1", "nonsense_action")
    assert result == {"error": "action must be start|stop|dump"}


# ===========================================================================
# 9. parse_query_dump / diff_captures (pure text/storage helpers, no BLE at all)
# ===========================================================================

def test_parse_query_dump_extracts_known_fields():
    dump = "Serial Number / Head PIN: ABC123\nBT central Version: 1.4\nTested by: Tony\n"
    result = server.parse_query_dump(dump)
    assert result["serial_head_pin"] == "ABC123"
    assert result["bt_central_version"] == "1.4"
    assert result["tested_by"] == "Tony"


def test_diff_captures_reports_no_diffs_for_identical_files():
    with _fake_captures_dir() as tmp:
        a = tmp / "a.jsonl"
        b = tmp / "b.jsonl"
        line = '{"raw": "$PING,*", "wall_ts": 0}\n'
        a.write_text(line, encoding="utf-8")
        b.write_text(line, encoding="utf-8")
        result = server.diff_captures(str(a), str(b))
    assert result["diffs"] == []
    assert result["frames_a"] == result["frames_b"] == 1


def test_diff_captures_finds_the_changed_token():
    with _fake_captures_dir() as tmp:
        a = tmp / "a.jsonl"
        b = tmp / "b.jsonl"
        a.write_text('{"raw": "$WEAP,1,24,*"}\n', encoding="utf-8")
        b.write_text('{"raw": "$WEAP,1,38,*"}\n', encoding="utf-8")
        result = server.diff_captures(str(a), str(b))
    assert len(result["diffs"]) == 1
    diff = result["diffs"][0]
    assert diff["command"] == "WEAP"
    assert diff["changed_tokens"] == [{"token_index": 2, "a": "24", "b": "38"}]
