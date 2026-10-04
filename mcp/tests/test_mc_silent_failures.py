"""Maintainability review 2026-10-03, operator lane: failures MC used to swallow (O4, O5, O11, O14)."""
import logging
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


def test_o4_log_lines_carry_a_millisecond_timestamp():
    from brx_mcp.mc.__main__ import LOG_DATEFMT, LOG_FORMAT
    rec = logging.LogRecord("brx_mcp.mc.x", logging.INFO, __file__, 1, "hello %s", ("world",), None)
    line = logging.Formatter(LOG_FORMAT, LOG_DATEFMT).format(rec)
    assert re.match(r"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} INFO brx_mcp\.mc\.x: hello world$", line), line


def test_o4_report_scrub_keeps_the_timestamp():
    from brx_mcp.mc.report import Aliaser, scrub_text
    line = "2026-10-04 12:34:56.789 INFO brx_mcp.mc.net: node up"
    out = scrub_text(Aliaser(), line)
    assert out.startswith("2026-10-04 12:34:56.789 INFO"), out


def _api_client(demo):
    from starlette.testclient import TestClient
    from brx_mcp.mc.api import create_app
    from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
    from brx_mcp.mc.state import Session
    comp = FakeCompiler()

    def boom():
        raise RuntimeError("catalogue broke")
    comp.weapon_catalog = boom
    s = Session(comp, FakeNet(), FakeArmory(demo_armory()))
    s.demo_session = demo
    return TestClient(create_app(s))


class _Capture(logging.Handler):
    def __init__(self):
        super().__init__()
        self.records = []

    def emit(self, record):
        self.records.append(record)


def test_o5_real_mc_weapons_error_is_503_and_logged_once():
    from _skip import needs
    try:
        import httpx  # noqa: F401
        from starlette.testclient import TestClient  # noqa: F401
        have = True
    except Exception:
        have = False
    needs(have, "starlette + httpx")
    cap, lg = _Capture(), logging.getLogger("brx.mc")
    lg.addHandler(cap)
    try:
        c = _api_client(False)
        r1, r2 = c.get("/api/weapons"), c.get("/api/weapons")
    finally:
        lg.removeHandler(cap)
    assert r1.status_code == 503 and r2.status_code == 503
    assert r1.json()["error"].startswith("WEAPONS UNAVAILABLE"), r1.json()
    assert len(cap.records) == 1 and cap.records[0].exc_info, cap.records


def test_o5_demo_mc_still_serves_the_fake_catalogue():
    from _skip import needs
    try:
        import httpx  # noqa: F401
        from starlette.testclient import TestClient  # noqa: F401
        have = True
    except Exception:
        have = False
    needs(have, "starlette + httpx")
    r = _api_client(True).get("/api/weapons")
    assert r.status_code == 200 and len(r.json()) > 0


def test_o11_pull_log_names_why_it_did_not_ask():
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from test_mc_logsync_versions import mk, online
    s, net, clock, ps = mk(1)
    online(s, net, clock, ps[0], 0)
    net.simulate_utility_hello("util-1")
    assert s.pull_log_refusal("node0", "manual") is None
    assert s.pull_log_refusal("util-1", "manual") == "utility_node"
    assert s.pull_log_refusal("nobody", "manual") == "no_node"
    s.options["log_sync"] = "manual"
    assert s.pull_log_refusal("node0", "recap") == "auto_sync_off"
    s._log_bytes["node0"] = 1_000_000
    assert s.pull_log_refusal("node0", "manual") == "budget_spent"
    s._log_bytes["node0"] = 0

    def boom(*a, **k):
        raise OSError("gone")
    net.push = boom
    assert s.pull_log_refusal("node0", "manual") == "push_failed"
    assert s.pull_log("node0", "manual") is False


def test_o11_route_returns_the_reason():
    from _skip import needs
    try:
        import httpx  # noqa: F401
        from starlette.testclient import TestClient
        have = True
    except Exception:
        have = False
    needs(have, "starlette + httpx")
    from brx_mcp.mc.api import create_app
    from test_mc_logsync_versions import mk, online
    s, net, clock, ps = mk(1)
    online(s, net, clock, ps[0], 0)
    net.simulate_utility_hello("util-1")
    c = TestClient(create_app(s))
    ok = c.post("/api/nodes/node0/pull_log").json()
    assert ok["ok"] is True and ok["reason"] is None
    bad = c.post("/api/nodes/util-1/pull_log").json()
    assert bad["ok"] is False and bad["reason"] == "utility_node", bad


def test_o14_oversize_push_is_logged_counted_and_not_raised():
    from _skip import needs
    try:
        import websockets  # noqa: F401
        have = True
    except ImportError:
        have = False
    needs(have, "websockets")
    import asyncio
    from brx_mcp.mc import envelope as E
    from brx_mcp.mc.net import NetServer, NodeRecord

    sent = []

    class WS:
        async def send(self, text):
            sent.append(text)

    async def go():
        net = NetServer()
        net._loop = asyncio.get_running_loop()
        net.nodes["node7"] = NodeRecord("node7", ws=WS())
        cap, lg = _Capture(), logging.getLogger("brx.mc.net")
        lg.addHandler(cap)
        try:
            ok_small = net.push("node7", "config", {"x": 1})
            ok_big = net.push("node7", "config", {"blob": "x" * (E.MAX_ENVELOPE_BYTES + 1)})
        finally:
            lg.removeHandler(cap)
        await asyncio.sleep(0)
        return net, ok_small, ok_big, cap

    net, ok_small, ok_big, cap = asyncio.run(go())
    assert ok_small is True and ok_big is False
    assert len(sent) == 1, "only the small frame went out"
    assert net.encode_failures == {"config": 1}
    msg = cap.records[0].getMessage()
    assert "node7" in msg and "config" in msg and "oversize" in msg, msg


def test_o14_worst_case_config_push_fits_the_envelope_cap():
    """A full-size field (every player number) with the real compiler: each `config` frame MC pushes must encode."""
    from brx_mcp.mc import envelope as E
    from brx_mcp.mc.compile import Compiler
    from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
    from brx_mcp.mc.state import Session
    from brx_mcp.mc.types import MAX_PLAYERS
    net = FakeNet()
    s = Session(Compiler(), net, FakeArmory(demo_armory()))
    s.set_config({"mode": "tdm", "time_limit_s": 60})
    for i in range(MAX_PLAYERS):
        s.add_player(f"OP{i}", gun_id=f"GUN-{i}")
    biggest = 0
    for p in s.players.values():
        s._compile_and_store(p)
        body = {"config": s._wire_config(), "frames": s.bundles[p["player_id"]], "roster": s.roster()}
        biggest = max(biggest, len(E.encode(E.make_envelope("config", body)).encode("utf-8")))
    print(f"worst config frame: {biggest} of {E.MAX_ENVELOPE_BYTES} bytes")
    assert biggest < E.MAX_ENVELOPE_BYTES, f"{biggest} bytes of {E.MAX_ENVELOPE_BYTES}"


def test_review1_pull_log_push_returning_false_is_push_failed_and_not_asked():
    from test_mc_logsync_versions import mk, online
    s, net, clock, ps = mk(1)
    online(s, net, clock, ps[0], 0)
    net.push = lambda *a, **k: False
    assert s.pull_log_refusal("node0", "manual") == "push_failed"
    assert s.pull_log_refusal("node0", "recap") == "push_failed"
    assert "node0" not in s._log_asked


def test_review2_result_is_recorded_pushed_only_when_the_push_landed():
    from test_mc_logsync_versions import mk, online, run_match
    s, net, clock, ps = mk(1)
    online(s, net, clock, ps[0], 0)
    run_match(s, net, clock, ps)
    s._result_pushed = {}
    real = net.push
    net.push = lambda *a, **k: False
    assert s._push_result() == 0 and s._result_pushed == {}
    net.push = real
    assert s._push_result() == 1, "the unchanged result must go out once the phone is reachable"
