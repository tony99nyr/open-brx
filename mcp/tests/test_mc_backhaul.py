"""A28 backhaul, server side (contracts.md §5d): the tunnel, the two-URL join, the secret gate,
`reach`, and derived coverage.

NO REAL CLOUDFLARED AND NO INTERNET. `Tunnel` takes its spawn as a parameter, and every lifecycle
test here drives a three-line python script that prints a fake `trycloudflare.com` line (or does not,
or exits) on demand. That is the whole point of the injection: a test that needed the binary would be
skipped on every machine that matters and would prove nothing on the one that had it.
"""
from __future__ import annotations

import asyncio
import json
import pathlib
import os
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import parse_qs, urlsplit

from _async import run
from _skip import needs

from brx_mcp.mc import envelope as E
from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.state import CoverageRequired, Session
from brx_mcp.mc.tunnel import QUICK_TUNNEL_RE, Tunnel, TunnelError
from brx_mcp.mc.types import MC_KINDS

try:
    import websockets  # noqa: F401
    HAVE_WS = True
except ImportError:
    HAVE_WS = False

try:
    from starlette.testclient import TestClient
    import httpx  # noqa: F401
    HAVE_API = True
except Exception:
    HAVE_API = False

FAKE_HOST = "https://polite-cotton-pine-nm.trycloudflare.com"


# --------------------------------------------------------------------------- helpers
def _sess(**kw) -> Session:
    net = FakeNet()
    net.start("10.0.0.5", 8766, "/ws")
    s = Session(FakeCompiler(), net, FakeArmory(demo_armory()), **kw)
    s.set_ws_url(net.join_info()["url"])
    return s


def _fake_child(*, delay_s: float = 0.0, url: str | None = FAKE_HOST, exit_after_s: float | None = None,
                noise: str = "2026-09-12T10:00:00Z INF Requesting new quick Tunnel...") -> list[str]:
    """argv for a stand-in cloudflared: some noise, maybe a URL, then either sleep or exit."""
    src = (
        "import sys, time\n"
        f"print({noise!r}, flush=True)\n"
        f"time.sleep({delay_s!r})\n"
        + (f"print('|  {url}  |', flush=True)\n" if url else "")
        + (f"time.sleep({exit_after_s!r})\nsys.exit(3)\n" if exit_after_s is not None
           else "time.sleep(60)\n")
    )
    return [sys.executable, "-c", src]


def _tunnel(argv: list[str], **kw) -> Tunnel:
    seen: list[list[str]] = []

    async def spawn(cmd):
        seen.append(list(cmd))
        return await asyncio.create_subprocess_exec(
            *argv, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)

    t = Tunnel(spawn=spawn, which=lambda _b: "/usr/bin/cloudflared", **kw)
    t.spawned = seen            # test-visible: what the REAL argv would have been
    return t


async def _until(pred, timeout=10.0, step=0.01):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if pred():
            return True
        await asyncio.sleep(step)
    return pred()


# --------------------------------------------------------------------------- Tunnel lifecycle
def test_the_url_regex_matches_a_quick_tunnel_line_and_not_a_lookalike():
    line = "2026-09-12T10:00:02Z INF |  https://polite-cotton-pine-nm.trycloudflare.com   |"
    assert QUICK_TUNNEL_RE.search(line).group(0) == FAKE_HOST
    assert not QUICK_TUNNEL_RE.search("https://trycloudflare.com.evil.example/ws")
    assert not QUICK_TUNNEL_RE.search("visit https://dash.cloudflare.com for the dashboard")


def test_tunnel_off_by_default_and_available_reflects_the_binary_on_PATH():
    off = Tunnel(which=lambda _b: None)
    assert off.public() == {"ws_url": None, "status": "off", "provider": None, "available": False}
    on_path = Tunnel(which=lambda _b: "/usr/bin/cloudflared")
    assert on_path.public()["available"] is True
    # A28.1: with no binary the control is REFUSED, and the refusal names the install line.
    try:
        off.start(8766)
        raise AssertionError("started a tunnel with no cloudflared on PATH")
    except TunnelError as e:
        assert "install" in str(e).lower() and e.status == 409


def test_tunnel_goes_starting_then_up_parses_the_url_and_stops_back_to_off():
    t = _tunnel(_fake_child(delay_s=0.05))
    seen: list[dict] = []
    t.on_change(lambda p: seen.append(p))

    async def go():
        assert t.start(8766)["status"] == "starting"
        assert t.start(8766)["status"] == "starting", "a second start while starting is a no-op"
        assert await _until(lambda: t.status == "up"), t.public()
        assert t.ws_url == "wss://polite-cotton-pine-nm.trycloudflare.com/ws"
        assert t.provider == "cloudflared" and not t.error
        out = await t.stop()
        assert out["status"] == "off" and out["ws_url"] is None
    run(go())
    assert [p["status"] for p in seen] == ["starting", "up", "off"], seen
    # the argv MC would really have run
    # the ABSOLUTE resolved path, not the bare name: PATH must not be re-read at exec time
    assert t.spawned[0] == ["/usr/bin/cloudflared", "tunnel", "--url",
                            "http://127.0.0.1:8766", "--no-autoupdate"]


def test_a_tunnel_that_never_prints_a_url_errors_at_the_cap_with_the_last_output_line():
    t = _tunnel(_fake_child(url=None, noise="ERR failed to dial edge"), timeout_s=0.3)

    async def go():
        t.start(8766)
        assert await _until(lambda: t.status == "error"), t.public()
        assert t.ws_url is None and "failed to dial edge" in t.error and "0s" in t.error
        # ...and the child is not left running
        assert t._proc is None
    run(go())


def test_the_child_exiting_at_any_time_is_an_error_not_a_silent_off():
    t = _tunnel(_fake_child(delay_s=0.02, exit_after_s=0.05))

    async def go():
        t.start(8766)
        assert await _until(lambda: t.status == "up"), t.public()
        assert await _until(lambda: t.status == "error"), t.public()
        assert "exited" in t.error and t.ws_url is None
    run(go())


def test_stopping_a_live_tunnel_settles_on_off_even_though_the_child_dies():
    t = _tunnel(_fake_child(delay_s=0.02))
    seen: list[str] = []
    t.on_change(lambda p: seen.append(p["status"]))

    async def go():
        t.start(8766)
        assert await _until(lambda: t.status == "up"), t.public()
        await t.stop()
        await asyncio.sleep(0.05)       # the reader task sees EOF after the kill
        assert t.status == "off" and t.error is None
    run(go())
    assert "error" not in seen, f"a stop we asked for must not look like a crash: {seen}"


def test_manual_provider_is_up_immediately_and_is_not_ours_to_start_or_stop():
    t = Tunnel(public_url="wss://mc.example.org/ws", which=lambda _b: None)
    pub = t.public()
    assert pub["status"] == "up" and pub["provider"] == "manual" and pub["ws_url"] == "wss://mc.example.org/ws"
    for call in (lambda: t.start(8766), lambda: run(t.stop())):
        try:
            call()
            raise AssertionError("a manual tunnel accepted a start/stop")
        except TunnelError as e:
            assert e.status == 409 and "--public-url" in str(e)


# --------------------------------------------------------------------------- A28.2 the join QR
def test_the_qr_carries_the_secret_and_gains_pub_only_while_the_tunnel_is_up():
    s = _sess()
    assert s.lan["ws_url"] == "ws://10.0.0.5:8766/ws", "ws_url stays the BARE LAN URL"
    q = urlsplit(s.lan["qr"])
    assert q.scheme == "ws" and q.netloc == "10.0.0.5:8766" and q.path == "/ws"
    assert parse_qs(q.query) == {"s": [s.join_secret]}
    assert len(s.join_secret) == 8 and s.lan["join_secret"] == s.join_secret

    s._tunnel_changed({"ws_url": "wss://abc.trycloudflare.com/ws", "status": "up",
                       "provider": "cloudflared", "available": True})
    assert parse_qs(urlsplit(s.lan["qr"]).query) == {
        "s": [s.join_secret], "pub": ["wss://abc.trycloudflare.com/ws"]}
    assert "%3A%2F%2F" in s.lan["qr"], "the public URL must be percent-encoded inside the query"

    # every not-up status drops `pub` again, error included
    for st in ("starting", "error", "off"):
        s._tunnel_changed({"ws_url": "wss://abc.trycloudflare.com/ws", "status": st,
                           "provider": "cloudflared", "available": True})
        assert "pub=" not in s.lan["qr"], st


def test_the_net_is_handed_the_same_secret_and_pub_the_qr_shows():
    s = _sess()
    assert s.net.join_secret == s.join_secret and s.net._pub is None
    assert s.net.gate_armed() is False, "no tunnel attached, nothing to guard"
    assert s.net.join_body() == {"pub": None, "secret": s.join_secret}
    s._tunnel_changed({"ws_url": "wss://abc.trycloudflare.com/ws", "status": "up",
                       "provider": "cloudflared", "available": True})
    assert s.net.join_body() == {"pub": "wss://abc.trycloudflare.com/ws", "secret": s.join_secret}
    # ...and the gate reads the TUNNEL, not that status dict: still nothing attached, still nothing armed
    assert s.net.gate_armed() is False
    s.attach_tunnel(Tunnel(public_url="wss://mc.example.org/ws", which=lambda _b: None))
    assert s.net.gate_armed() is True, "a manual provider is a public path, so the gate is up"


def test_the_join_secret_survives_a_snapshot_restore_so_a_printed_qr_stays_valid():
    with tempfile.TemporaryDirectory() as d:
        path = pathlib.Path(d) / "session.json"
        s = _sess()
        s._persist_path = path
        s.add_player("reaper", gun_id="GUN-A")
        s.persist_now()
        secret, qr = s.join_secret, s.lan["qr"]
        assert json.loads(path.read_text())["join_secret"] == secret

        s2 = _sess()
        s2._persist_path = path
        assert s2.join_secret != secret, "a fresh session mints its own before restoring"
        s2.restore_snapshot()
        assert s2.join_secret == secret and s2.lan["qr"] == qr
        assert s2.net.join_secret == secret, "the net must be re-armed with the RESTORED secret"


def test_join_is_broadcast_when_the_public_status_changes_and_not_on_a_no_op():
    s = _sess()
    up = {"ws_url": "wss://abc.trycloudflare.com/ws", "status": "up", "provider": "cloudflared", "available": True}
    s._tunnel_changed(up)
    assert s.net.pushes("join") == [(None, "join", {"pub": "wss://abc.trycloudflare.com/ws",
                                                    "secret": s.join_secret})]
    s._tunnel_changed(dict(up))
    assert len(s.net.pushes("join")) == 1, "the same public URL twice is not news"
    s._tunnel_changed({"ws_url": None, "status": "off", "provider": None, "available": True})
    assert s.net.pushes("join")[-1][2] == {"pub": None, "secret": s.join_secret}, "going down is news too"
    # `starting` is not a usable URL, so it is not a join change either
    n = len(s.net.pushes("join"))
    s._tunnel_changed({"ws_url": None, "status": "starting", "provider": "cloudflared", "available": True})
    assert len(s.net.pushes("join")) == n


def test_join_survives_the_mc_to_node_wire():
    assert "join" in MC_KINDS
    env = E.make_envelope("join", {"pub": None, "secret": "abc12345"})
    assert E.decode(E.encode(env), direction="mc")["body"] == {"pub": None, "secret": "abc12345"}
    try:
        E.validate(E.make_envelope("join", {"secret": "abc12345"}), direction="mc")
        raise AssertionError("a join with no `pub` key at all was accepted")
    except E.EnvelopeError as e:
        assert e.reason == "missing_field"


# --------------------------------------------------------------------------- A28.2 the secret gate
def _hello(node_id="n1", **kw) -> str:
    body = {"node_id": node_id, "node_type": "phone", "app_ver": "test", "seq_next": 1}
    body.update(kw)
    return E.encode(E.make_envelope("hello", body))


class _NetHarness:
    def __init__(self, **join):
        from brx_mcp.mc.net import NetServer
        self.net = NetServer(hello_timeout_s=2.0)
        if join:
            self.net.set_join(**join)

    async def __aenter__(self):
        await self.net.start("127.0.0.1", 0)
        self.url = f"ws://127.0.0.1:{self.net.port}/ws"
        return self

    async def __aexit__(self, *a):
        await self.net.stop()


async def _say_hello(url, *, headers=None, **body):
    """Connect, send one hello, return the welcome — or the close code as an int."""
    import websockets
    kw = {"additional_headers": headers} if headers else {}
    try:
        async with websockets.connect(url, **kw) as ws:
            await ws.send(_hello(**body))
            raw = await asyncio.wait_for(ws.recv(), timeout=3)
            return E.decode(raw, direction="mc")
    except Exception as e:
        code = getattr(getattr(e, "rcvd", None), "code", None) or getattr(e, "code", None)
        if code is None:
            raise
        return code


def test_the_secret_gate_matrix():
    """The whole of A28.2's enforcement rule, in one table."""
    needs(HAVE_WS, "websockets")

    async def go():
        # (1) tunnel OFF: a loopback hello with no secret is fine — every test and e2e fixture is this.
        async with _NetHarness() as h:
            w = await _say_hello(h.url, node_id="lan-1")
            assert isinstance(w, dict) and w["kind"] == "welcome"
            assert w["body"]["join"] == {"pub": None, "secret": ""}

        # (2) tunnel UP, loopback (i.e. through cloudflared), NO secret → 4004 and no record left behind
        async with _NetHarness(secret="s3cr3t99", pub="wss://x.trycloudflare.com/ws", armed=True) as h:
            assert await _say_hello(h.url, node_id="stranger") == 4004
            # the close frame reaches the client before the server unwinds, so wait for the sweep
            assert await _until(lambda: "stranger" not in h.net.nodes), \
                "a refused stranger must leave no NodeRecord"
            assert h.net.stats["quarantined"] == 1

            # (3) …the RIGHT secret gets in, and the welcome hands over the join body
            w = await _say_hello(h.url, node_id="pub-1", secret="s3cr3t99", via="backhaul")
            assert isinstance(w, dict) and w["kind"] == "welcome"
            assert w["body"]["join"] == {"pub": "wss://x.trycloudflare.com/ws", "secret": "s3cr3t99"}
            assert h.net.nodes["pub-1"].via == "backhaul"

            # (4) a WRONG secret is refused exactly like none at all
            assert await _say_hello(h.url, node_id="stranger2", secret="not-it") == 4004

            # (5) a hello the edge stamped `Cf-Connecting-Ip` on is judged tunnel-side too
            assert await _say_hello(h.url, node_id="stranger3",
                                    headers={"Cf-Connecting-Ip": "203.0.113.9"}) == 4004

        # (6) a secret is set but the tunnel is DOWN: the LAN rules, unchanged
        async with _NetHarness(secret="s3cr3t99", pub=None, armed=False) as h:
            w = await _say_hello(h.url, node_id="lan-2")
            assert isinstance(w, dict) and w["kind"] == "welcome"
    run(go())


def test_reach_is_stamped_by_mc_from_the_socket_not_taken_from_the_node():
    """A28.3 + review: `reach` gates things (coverage, and the readiness amber that un-blocks a start),
    so it must be MC's observation of the socket, never a string the client sent. The node's claim is
    kept beside it as `reach_claimed` so a disagreement shows up instead of being silently believed."""
    needs(HAVE_WS, "websockets")

    async def go():
        import websockets
        # gate DOWN: a loopback socket is just a dev box, whatever the node calls it
        async with _NetHarness() as h:
            await _say_hello(h.url, node_id="liar", via="backhaul")
            rec = h.net.nodes["liar"]
            assert rec.via == "lan", "a node cannot assert its way onto backhaul"
            assert rec.via_claimed == "backhaul"
            assert rec.view()["reach"] == "lan" and rec.view()["reach_claimed"] == "backhaul"

        # gate UP: the same loopback socket IS the tunnel hop, so now it really is backhaul
        async with _NetHarness(secret="s3cr3t99", pub="wss://x.trycloudflare.com/ws", armed=True) as h:
            seen: list[dict] = []
            h.net.on_node(seen.append)
            async with websockets.connect(h.url) as ws:
                await ws.send(_hello(node_id="n1", secret="s3cr3t99", via="lan"))
                await asyncio.wait_for(ws.recv(), timeout=3)
                assert await _until(lambda: any(i.get("reach") for i in seen)), seen
                rec = h.net.nodes["n1"]
                assert rec.via == "backhaul" and rec.via_claimed == "lan"
            assert await _until(lambda: not h.net.nodes["n1"].connected)
            assert h.net.nodes["n1"].via is None, "a dead socket has no path"
            assert h.net.nodes["n1"].view()["reach"] is None
    run(go())


def test_a_hello_with_a_nonsense_via_leaves_no_claim_behind():
    needs(HAVE_WS, "websockets")

    async def go():
        async with _NetHarness() as h:
            await _say_hello(h.url, node_id="n1", via="satellite")
            assert h.net.nodes["n1"].via_claimed is None
            assert h.net.nodes["n1"].via == "lan"
    run(go())


def test_a_status_body_cannot_move_reach_but_its_claim_is_kept():
    s = _sess()
    p = s.add_player("reaper", gun_id="GUN-A")
    s.net.simulate_hello("n1", "GUN-A", via="lan")
    assert s.nodes["n1"]["reach"] == "lan"
    s.net.simulate_status("n1", {"node_id": "n1", "arm_state": "kitted", "synced": True,
                                 "reach": "backhaul"}, s.now_ms())
    assert s.nodes["n1"]["reach"] == "lan", "a status body must not re-path a node"
    assert s.nodes["n1"]["reach_claimed"] == "backhaul"
    assert s.coverage() == {"level": "zones", "on_backhaul": 0, "bound": 1}
    assert s.snapshot()["nodes"][0]["reach"] == "lan"
    assert s.node_player["n1"] == p["player_id"]


def test_a_dropped_socket_clears_reach_on_the_view_the_snapshot_is_built_from():
    """The review's LOW: `NodeRecord.view()` nulls `reach` on a dead socket, but `snapshot()` renders
    Session's own node dicts and never reads that view -- so without this the null was dead code and a
    phone stayed "covered" for a full STALE_AFTER_MS after its socket went."""
    s = _sess()
    s.add_player("reaper", gun_id="GUN-A")
    s.net.simulate_hello("n1", "GUN-A", via="backhaul")
    assert s.coverage()["level"] == "full"
    s.net.simulate_disconnect("n1")
    assert "reach" not in s.nodes["n1"]
    assert s.coverage() == {"level": "zones", "on_backhaul": 0, "bound": 1}
    assert s.snapshot()["nodes"][0].get("reach") is None


# --------------------------------------------------------------------------- A28.4 coverage
def _two_players_on(s: Session, reach_a: str | None, reach_b: str | None):
    s.add_player("a", gun_id="GUN-A")
    s.add_player("b", gun_id="GUN-B")
    _redial(s, reach_a, reach_b)


def _redial(s: Session, reach_a: str | None, reach_b: str | None):
    """Both phones reconnect. A28.3 says a path change IS a reconnect (close + re-dial), and `reach` is
    stamped at the hello, so this is the only way a node's path moves."""
    s.net.simulate_hello("n-a", "GUN-A", via=reach_a)
    s.net.simulate_hello("n-b", "GUN-B", via=reach_b)


def test_coverage_is_full_only_when_every_bound_node_is_on_backhaul():
    s = _sess()
    assert s.coverage() == {"level": "zones", "on_backhaul": 0, "bound": 0}, "nobody bound is not coverage"
    _two_players_on(s, "backhaul", "lan")
    assert s.coverage() == {"level": "zones", "on_backhaul": 1, "bound": 2}
    s.net.simulate_hello("n-b", "GUN-B", via="backhaul")        # it re-dialled and got the tunnel
    assert s.coverage() == {"level": "full", "on_backhaul": 2, "bound": 2}
    assert s.snapshot()["coverage"]["level"] == "full"
    # a node that goes stale is not "connected" any more, whatever path it last used
    s.net.simulate_stale("n-a", 20_000)
    assert s.coverage() == {"level": "zones", "on_backhaul": 1, "bound": 2}


def test_full_coverage_clears_the_frag_warning_but_never_the_time_limit():
    s = _sess()
    s.set_config({"mode": "tdm", "time_limit_s": 600, "scoring": {"frag_limit": 25, "win_by": "kills"}})
    _two_players_on(s, "lan", "lan")
    assert any("frag_limit" in w for w in s.config_warnings), s.config_warnings
    _redial(s, "backhaul", "backhaul")
    s._validate()
    assert not any("frag_limit" in w for w in s.config_warnings), s.config_warnings
    # …and A4.8's floor is untouched: a null time limit is still an error under FULL backhaul coverage
    s.config["time_limit_s"] = None
    res = s._validate()
    assert not res["ok"] and any("time_limit_s" in e for e in res["errors"]), res


def test_a_mode_that_requires_coverage_refuses_the_lobby_push_until_it_has_it():
    from brx_mcp.modes import registry as R
    from brx_mcp.modes.deathmatch import DeathmatchEngine

    class _NeedsCoverage(DeathmatchEngine):
        # A28.4: the reserved hook. A flag, not a tunable — `params.schema_of` filters it out, which is
        # what keeps `default_params` from choking on a bare True.
        PARAMS = {"requires_coverage": True}

    R.register_mode("coveragetest", _NeedsCoverage)
    try:
        assert R.requires_coverage("coveragetest") is True
        assert R.params_schema("coveragetest") == {} and R.default_params("coveragetest") == {}
        assert R.requires_coverage("tdm") is False, "no catalog mode declares it"

        s = _sess()
        s.set_config({"mode": "tdm", "time_limit_s": 600})
        _two_players_on(s, "lan", "lan")
        for nid in ("n-a", "n-b"):
            s.net.simulate_status(nid, {"node_id": nid, "arm_state": "kitted", "synced": True,
                                        "gun_linked": True, "headset_ok": True}, s.now_ms())
        s.config["mode"] = "coveragetest"           # straight in: the catalog has no such row
        try:
            s.push_config(force=True)
            raise AssertionError("pushed a requires_coverage mode with two phones on the LAN")
        except CoverageRequired as e:
            assert e.status == 409 and e.coverage == {"level": "zones", "on_backhaul": 0, "bound": 2}
            assert "coveragetest" in str(e)
        assert not s.lobby_pushed, "a refused push must not leave the session in LOBBY"

        _redial(s, "backhaul", "backhaul")
        for nid in ("n-a", "n-b"):
            s.net.simulate_status(nid, {"node_id": nid, "arm_state": "kitted", "synced": True}, s.now_ms())
        s.push_config(force=True)
        assert s.lobby_pushed and s.phase == "lobby"
    finally:
        R._EXTRA.pop("coveragetest", None)


# --------------------------------------------------------------------------- POST /api/tunnel
def _client(**tunnel_kw):
    from brx_mcp.mc.api import create_app
    net = FakeNet()
    net.start("10.0.0.5", 8766, "/ws")
    s = Session(FakeCompiler(), net, FakeArmory(demo_armory()))
    s.set_ws_url(net.join_info()["url"])
    if tunnel_kw:
        s.attach_tunnel(Tunnel(**tunnel_kw))
    return TestClient(create_app(s)), s


def test_post_api_tunnel_starts_stops_and_refuses():
    needs(HAVE_API, "starlette + httpx")
    # (a) no binary → 409 naming the install line, and the control is still SHOWN (available:false)
    c, s = _client(which=lambda _b: None)
    assert c.get("/api/state").json()["lan"]["public"] == {
        "ws_url": None, "status": "off", "provider": None, "available": False}
    r = c.post("/api/tunnel", json={"on": True})
    assert r.status_code == 409 and "install" in r.json()["error"].lower()

    # (b) a manual URL is up at once and is not MC's to stop
    c, s = _client(public_url="wss://mc.example.org/ws", which=lambda _b: None)
    lan = c.get("/api/state").json()["lan"]
    assert lan["public"]["provider"] == "manual" and lan["public"]["status"] == "up"
    assert "pub=wss%3A%2F%2Fmc.example.org%2Fws" in lan["qr"]
    assert c.post("/api/tunnel", json={"on": False}).status_code == 409
    assert c.post("/api/tunnel", json={"on": True}).status_code == 409

    # (c) a bad body is a 400, not a crash
    c, s = _client(which=lambda _b: None)
    assert c.post("/api/tunnel", json={}).status_code == 400
    assert c.post("/api/tunnel", json={"on": "yes"}).status_code == 400


def test_post_api_tunnel_on_then_off_over_a_fake_child():
    needs(HAVE_API, "starlette + httpx")
    t = _tunnel(_fake_child(delay_s=0.02))
    from brx_mcp.mc.api import create_app
    net = FakeNet()
    net.start("10.0.0.5", 8766, "/ws")
    s = Session(FakeCompiler(), net, FakeArmory(demo_armory()))
    s.set_ws_url(net.join_info()["url"])
    s.attach_tunnel(t)
    with TestClient(create_app(s)) as c:
        r = c.post("/api/tunnel", json={"on": True})
        assert r.status_code == 200 and r.json()["status"] == "starting"
        assert t.spawned[0][-2:] == ["http://127.0.0.1:8766", "--no-autoupdate"], t.spawned
        for _ in range(400):                      # the reader runs on the app's loop
            if s.lan["public"]["status"] == "up":
                break
            time.sleep(0.01)
        pub = c.get("/api/state").json()["lan"]
        assert pub["public"]["status"] == "up", pub["public"]
        assert pub["public"]["ws_url"] == "wss://polite-cotton-pine-nm.trycloudflare.com/ws"
        assert "pub=wss%3A%2F%2Fpolite-cotton-pine-nm.trycloudflare.com%2Fws" in pub["qr"]
        assert net.pushes("join")[-1][2]["pub"] == pub["public"]["ws_url"]
        assert c.post("/api/tunnel", json={"on": True}).json()["status"] == "up", "idempotent"
        assert c.post("/api/tunnel", json={"on": False}).json()["status"] == "off"
        assert "pub=" not in c.get("/api/state").json()["lan"]["qr"]


def test_the_operator_token_gates_the_tunnel_route_like_every_other_non_get():
    needs(HAVE_API, "starlette + httpx")
    from brx_mcp.mc.api import create_app
    net = FakeNet()
    s = Session(FakeCompiler(), net, FakeArmory(demo_armory()))
    s.attach_tunnel(Tunnel(which=lambda _b: None))
    c = TestClient(create_app(s, token="sekrit"))
    assert c.post("/api/tunnel", json={"on": True}).status_code == 401
    assert c.get("/api/state").status_code == 200
    r = c.post("/api/tunnel", json={"on": True}, headers={"Authorization": "Bearer sekrit"})
    assert r.status_code == 409, "past auth, refused for the real reason (no binary)"


# --------------------------------------------------------------------------- A28.3 readiness
def test_a_backhaul_node_is_not_red_for_being_off_the_field_wifi():
    """A28.3: §5c gates (d)/(f) become warnings for a node that reports `reach: "backhaul"`.

    A phone reaching MC over its data plan is, by definition, not the phone the field-Wi-Fi preflight
    was written for — and MC is READING that preflight off a status that arrived, so "unreachable" is
    about the LAN, not about MC. Left as a red, backhaul would block the start on every field it exists
    for."""
    s = _sess()
    s.set_config({"mode": "tdm", "time_limit_s": 600})
    p = s.add_player("reaper", gun_id="GUN-A")
    s.net.simulate_hello("n1", "GUN-A", via="lan")
    off_wifi = {"node_id": "n1", "arm_state": "kitted", "synced": True,
                "preflight": {"ssid_ok": False, "mc_reachable": False, "gun_linked": True}}
    s.net.simulate_status("n1", dict(off_wifi), s.now_ms())
    row = next(r for r in s.readiness()["board"] if r["player_id"] == p["player_id"])
    assert any("WRONG WI-FI" in b for b in row["blockers"]), row
    assert row["status"] == "red"

    s.net.simulate_hello("n1", "GUN-A", via="backhaul")          # re-dialled, MC stamps the new path
    s.net.simulate_status("n1", dict(off_wifi), s.now_ms())
    row = next(r for r in s.readiness()["board"] if r["player_id"] == p["player_id"])
    assert not any("WI-FI" in b for b in row["blockers"]), row["blockers"]
    assert any("BACKHAUL" in a for a in row["ambers"]), row["ambers"]
    assert row["status"] != "red", row


# --------------------------------------------------------------------------- review: the gate's arming
def test_losing_the_childs_stdout_does_not_disarm_the_gate_while_it_still_routes():
    """The HIGH finding. `_run` used to exit its read loop on stdout EOF, wait 3 s for the process, get
    rc=None for a perfectly live child and call `_fail()` — status went to `error`, the gate came down,
    and the still-working trycloudflare hostname was then open to anyone with no secret.

    The stand-in prints its URL, CLOSES stdout, and keeps running."""
    argv = [sys.executable, "-c",
            "import os, sys, time\n"
            f"print('|  {FAKE_HOST}  |', flush=True)\n"
            "os.close(1); os.close(2)\n"       # stdout gone, process very much alive
            "time.sleep(60)\n"]
    t = _tunnel(argv)

    async def go():
        t.start(8766)
        assert await _until(lambda: t.status == "up"), t.public()
        await asyncio.sleep(0.3)               # long enough for the old 3 s-cap path to have fired
        assert t.armed is True, "the child is still routing — the gate must stay up"
        assert t.status == "up", "we stopped READING it; that is not the same as it dying"
        await t.stop()
        assert t.armed is False and t.status == "off"
    run(go())


def test_the_secret_is_still_required_after_stdout_dies():
    """The same fault, end to end: a hello through the tunnel with no secret must still be refused."""
    needs(HAVE_WS, "websockets")
    argv = [sys.executable, "-c",
            "import os, sys, time\n"
            f"print('|  {FAKE_HOST}  |', flush=True)\n"
            "os.close(1); os.close(2)\n"
            "time.sleep(60)\n"]
    t = _tunnel(argv)

    async def go():
        from brx_mcp.mc.net import NetServer
        net = NetServer(hello_timeout_s=2.0)
        net.set_join(secret="s3cr3t99", pub=None, armed=lambda: t.armed)
        await net.start("127.0.0.1", 0)
        try:
            t.start(8766)
            assert await _until(lambda: t.status == "up")
            await asyncio.sleep(0.3)
            url = f"ws://127.0.0.1:{net.port}/ws"
            assert await _say_hello(url, node_id="stranger") == 4004
            w = await _say_hello(url, node_id="ok-1", secret="s3cr3t99")
            assert isinstance(w, dict) and w["kind"] == "welcome"
        finally:
            await t.stop()
            await net.stop()
    run(go())


def test_the_gate_fails_closed_when_the_arming_callback_raises():
    from brx_mcp.mc.net import NetServer
    net = NetServer()

    def boom():
        raise RuntimeError("tunnel went away")

    net.set_join(secret="s3cr3t99", armed=boom)
    assert net._gate_armed() is True, "a gate we cannot evaluate must ASK for the secret, not skip it"


# --------------------------------------------------------------------------- review: orphan reaping
def test_an_orphaned_cloudflared_is_killed_at_the_next_launch():
    with tempfile.TemporaryDirectory() as d:
        pid_file = pathlib.Path(d) / "tunnel.pid"
        # a long-lived stand-in whose cmdline says cloudflared, exactly as the real orphan's would
        proc = subprocess.Popen([sys.executable, "-c", "import time  # cloudflared\ntime.sleep(60)"])
        try:
            t = Tunnel(which=lambda _b: "/usr/bin/cloudflared", pid_dir=pid_file.parent, ws_port=8766)
            t.pid_path.write_text(json.dumps({"pid": proc.pid}))   # no owner recorded: a crash, or legacy
            # A REAL orphan is nobody's child. This one is ours, so without a concurrent wait() it would
            # linger as a zombie that `os.kill(pid, 0)` still reports as alive, and the poll below would
            # correctly refuse to declare it dead.
            threading.Thread(target=lambda: proc.wait(), daemon=True).start()
            assert t.reap_orphan() == proc.pid
            assert proc.poll() is not None
            assert not t.pid_path.exists(), "the pid file goes with the process"
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait(timeout=5)


def test_reaping_never_kills_a_pid_that_is_no_longer_cloudflared():
    """Pids are reused. Terminating whatever now holds the number in a stale file would be far worse
    than leaving a tunnel up, so the cmdline is checked before anything is signalled."""
    with tempfile.TemporaryDirectory() as d:
        pid_file = pathlib.Path(d) / "tunnel.pid"
        proc = subprocess.Popen([sys.executable, "-c", "import time\ntime.sleep(30)"])
        try:
            t = Tunnel(which=lambda _b: None, pid_dir=pid_file.parent, ws_port=8766)
            t.pid_path.write_text(str(proc.pid))            # the bare-integer form still reads
            assert t.reap_orphan() is None
            assert proc.poll() is None, "an innocent process was killed"
            assert not t.pid_path.exists(), "...but the stale file is cleared"
        finally:
            proc.kill()
            proc.wait(timeout=5)
    # a missing or junk file is simply nothing to do
    with tempfile.TemporaryDirectory() as d:
        t = Tunnel(which=lambda _b: None, pid_dir=pathlib.Path(d))
        assert t.reap_orphan() is None
        t.pid_path.write_text("not-a-pid")
        assert Tunnel(which=lambda _b: None, pid_dir=pathlib.Path(d)).reap_orphan() is None
        assert not t.pid_path.exists()


def test_a_running_tunnel_writes_its_pid_and_clears_it_on_stop():
    with tempfile.TemporaryDirectory() as d:
        pid_file = pathlib.Path(d) / "tunnel.pid"
        t = _tunnel(_fake_child(delay_s=0.02), pid_dir=pid_file.parent)

        async def go():
            t.start(8766)
            assert await _until(lambda: t.status == "up"), t.public()
            rec = json.loads(t.pid_path.read_text())
            assert rec["pid"] == t._proc.pid and rec["owner"] == os.getpid() and rec["ws_port"] == 8766
            assert t.pid_path.name == "tunnel-8766.pid", "one file per ws port, not one per machine"
            await t.stop()
            assert not t.pid_path.exists()
        run(go())


# --------------------------------------------------------------------------- review: the public peer
class _FakeWs:
    """Just enough websocket to drive the peer rules — the injected peer address."""

    def __init__(self, host, headers=None):
        self.remote_address = (host, 41234) if host else None
        self.request = type("R", (), {"headers": dict(headers or {})})()


def test_peer_class_sorts_loopback_private_and_public():
    from brx_mcp.mc.net import peer_class
    assert peer_class("127.0.0.1") == "loopback" and peer_class("::1") == "loopback"
    assert peer_class("::ffff:127.0.0.1") == "loopback"
    for lan in ("192.168.1.40", "10.0.0.5", "172.16.3.9", "169.254.4.4", "fd00::1"):
        assert peer_class(lan) == "private", lan
    for pub in ("203.0.113.9", "8.8.8.8", "2606:4700::1111"):
        # 203.0.113/24 is TEST-NET-3, which `ipaddress.is_private` calls private. It is not a LAN, so
        # the classifier names its private ranges explicitly instead of borrowing that answer.
        assert peer_class(pub) == "public", pub
    assert peer_class("100.100.3.4") == "private", "a Tailscale tailnet is LAN-equivalent"
    assert peer_class(None) == "unknown" and peer_class("not-an-ip") == "unknown"


def test_a_public_peer_always_needs_the_secret_even_with_no_tunnel_running():
    """The review's port-forward hole: `--public-url` behind a plain forward gives a routable peer and
    no `Cf-Connecting-Ip`, so the old loopback/header test never fired and the socket was wide open."""
    from brx_mcp.mc.net import NetServer
    net = NetServer()
    net.set_join(secret="s3cr3t99", armed=False)          # gate DOWN on purpose

    stranger = _FakeWs("203.0.113.9")
    assert net.through_backhaul(stranger) is True
    assert net._secret_ok(stranger, {}) is False
    assert net._secret_ok(stranger, {"secret": "nope"}) is False
    assert net._secret_ok(stranger, {"secret": "s3cr3t99"}) is True

    # ...while the LAN and a gate-off loopback stay secret-free, which is the mandatory floor (§5)
    for host in ("192.168.1.40", "10.0.0.5", "127.0.0.1"):
        ws = _FakeWs(host)
        assert net.through_backhaul(ws) is False, host
        assert net._secret_ok(ws, {}) is True, host
    # an unreadable peer follows the GATE: with none armed there is nothing to guard, so it is LAN and
    # the typed-address floor still works (§5)
    assert net._secret_ok(_FakeWs(None), {}) is True


def test_the_cf_header_and_loopback_only_count_while_the_gate_is_armed():
    from brx_mcp.mc.net import NetServer
    net = NetServer()
    net.set_join(secret="s3cr3t99", armed=False)
    cf = _FakeWs("192.168.1.40", {"Cf-Connecting-Ip": "203.0.113.9"})
    assert net.through_backhaul(cf) is False, "no tunnel running, so nothing came through one"
    net.set_join(armed=True)
    assert net.through_backhaul(cf) is True and net._secret_ok(cf, {}) is False
    assert net.through_backhaul(_FakeWs("127.0.0.1")) is True
    assert net.through_backhaul(_FakeWs("192.168.1.40")) is False, "a LAN peer is still a LAN peer"


def test_a_pid_file_whose_owner_is_still_alive_is_left_alone():
    """Two Mission Controls on one laptop must not reap each other. The file is already per-ws-port; the
    owner pid is the second catch, for the case where the ports DO collide (a restart racing a shutdown,
    a copy-pasted command)."""
    with tempfile.TemporaryDirectory() as d:
        child = subprocess.Popen([sys.executable, "-c", "import time  # cloudflared\ntime.sleep(30)"])
        owner = subprocess.Popen([sys.executable, "-c", "import time\ntime.sleep(30)"])
        try:
            t = Tunnel(which=lambda _b: "/usr/bin/cloudflared", pid_dir=pathlib.Path(d), ws_port=8766)
            t.pid_path.write_text(json.dumps({"pid": child.pid, "owner": owner.pid}))
            assert t.reap_orphan() is None
            assert child.poll() is None, "another live MC's tunnel was killed"
            assert t.pid_path.exists(), "...and its file was left where it belongs"
        finally:
            for proc in (child, owner):
                proc.kill()
                proc.wait(timeout=5)


def test_an_unkillable_orphan_keeps_the_gate_armed_rather_than_pretending_it_is_gone():
    """If we cannot kill it, it may still be routing to this port. Lowering the gate then would leave an
    internet-reachable node socket with nobody asking for the secret, so the latch holds until someone
    starts or stops the tunnel explicitly."""
    with tempfile.TemporaryDirectory() as d:
        t = Tunnel(which=lambda _b: "/usr/bin/cloudflared", pid_dir=pathlib.Path(d),
                   ws_port=8766, term_grace_s=0.1)
        t.pid_path.write_text(json.dumps({"pid": 4242}))
        t._alive = staticmethod(lambda _pid: True)          # never dies, whatever we send it
        t._cmdline = staticmethod(lambda _pid: "/usr/bin/cloudflared tunnel --url http://127.0.0.1:8766")
        with_kills: list = []
        assert t.reap_orphan() is None
        assert t._orphan_pid == 4242
        assert t.armed is True, "an orphan we could not kill is still a public path"
        assert t.pid_path.exists(), "the file stays: the process it names is still there"
        assert with_kills == []
        # an explicit start or stop is the operator taking charge of the port, and clears the latch
        run(t.stop())
        assert t._orphan_pid is None and t.armed is False


# --------------------------------------------------------------------------- review 2: ownership
def test_an_old_run_never_disarms_the_gate_on_the_child_that_replaced_it():
    """The pass-2 MEDIUM. `shutdown()`'s post-kill wait can time out (suppressed) and a fresh `start()`
    then spawns a new child. When the OLD `_run` finally returned from `proc.wait()` it nulled `_proc`
    and called `_fail()` — disarming the gate on a cloudflared that was routing right then."""
    t = _tunnel(_fake_child(delay_s=0.02))

    async def go():
        t.start(8766)
        assert await _until(lambda: t.status == "up"), t.public()
        first, first_task = t._proc, t._task

        # a second child takes over without the first's reader having finished
        second = await asyncio.create_subprocess_exec(
            *_fake_child(), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        t._proc = second
        try:
            first.kill()                     # the old reader's `proc.wait()` returns now
            await asyncio.wait_for(asyncio.shield(first_task), timeout=5)
            assert t._proc is second, "the old _run released a process it no longer owned"
            assert t.armed is True, "the gate came down on a live child"
            assert t.status == "up" and t.error is None
        finally:
            second.kill()
            await second.wait()
    run(go())


def test_a_stop_inside_the_spawn_window_kills_the_child_it_could_not_see():
    """`stop()` between `start()` and the spawn returning had nothing to kill and settled on `off`, and
    `_run` then published a child MC no longer believed in — live, routing, gate down."""
    started = asyncio.Event()
    holder: list = []

    async def slow_spawn(cmd):
        started.set()
        await asyncio.sleep(0.2)                       # stop() lands in here
        proc = await asyncio.create_subprocess_exec(
            *_fake_child(), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        holder.append(proc)
        return proc

    t = Tunnel(spawn=slow_spawn, which=lambda _b: "/usr/bin/cloudflared")

    async def go():
        t.start(8766)
        await asyncio.wait_for(started.wait(), timeout=5)
        await t.stop()
        assert t.status == "off" and t.armed is False
        await asyncio.sleep(0.5)                       # let the spawn land and _run decide
        assert t.status == "off", "a stopped tunnel resurrected itself"
        assert t._proc is None and t.armed is False
        assert holder and holder[0].returncode is not None, "the child we could not see was leaked"
    run(go())


def test_a_child_that_will_not_die_keeps_the_gate_armed_instead_of_being_written_off():
    """`shutdown()` used to null `_proc` unconditionally after its kill, so a cloudflared that outlived
    SIGKILL left the gate down while it kept routing."""
    t = _tunnel(_fake_child(), term_grace_s=0.05)

    async def go():
        t.start(8766)
        assert await _until(lambda: t.status == "up"), t.public()
        real = t._proc
        t._proc = type("Undead", (), {"returncode": None,
                                      "terminate": lambda self: None, "kill": lambda self: None,
                                      "wait": lambda self: asyncio.sleep(60)})()
        await t.shutdown()
        assert t._proc is not None, "a process we could not confirm dead must not be released"
        assert t.armed is True, "...so the join secret is still required"
        t._proc = real
        await t.shutdown()
        assert t.armed is False
    run(go())


# --------------------------------------------------------------------------- review 2: the low items
def test_every_path_that_ends_a_socket_clears_reach():
    """`on_disconnect` has to fire from all four sites, not just the handler's `finally`. An evict, a
    takeover, a node_id switch and a refused bind end a socket just as surely as a dropped link — and a
    coverage fix that covers one of them is not a fix."""
    needs(HAVE_WS, "websockets")

    async def go():
        async with _NetHarness() as h:
            gone: list[str] = []
            h.net.on_disconnect(gone.append)
            w = await _say_hello(h.url, node_id="n1")
            assert isinstance(w, dict)
            rec = h.net.nodes["n1"]
            assert await _until(lambda: "n1" in gone)          # the plain drop
            assert rec.via is None

            rec.ws = object()                                   # a socket to take away again
            rec.via = "backhaul"
            assert h.net.evict("n1") is True
            assert gone.count("n1") == 2 and rec.via is None, "evict must clear the path too"
    run(go())


def test_the_mapped_ipv4_prefix_is_matched_whatever_its_case():
    from brx_mcp.mc.net import peer_class
    assert peer_class("::FFFF:127.0.0.1") == "loopback"
    assert peer_class("::ffff:192.168.1.9") == "private"
    assert peer_class("::FFFF:8.8.8.8") == "public"


def test_an_unreadable_peer_is_gated_once_there_is_a_public_path():
    from brx_mcp.mc.net import NetServer
    net = NetServer()
    net.set_join(secret="s3cr3t99", armed=False)
    blind = _FakeWs(None)
    assert net._secret_ok(blind, {}) is True, "no public path: the typed-address floor (§5) still holds"
    net.set_join(armed=True)
    assert net.through_backhaul(blind) is True
    assert net._secret_ok(blind, {}) is False, "with a tunnel up, a peer we cannot read is not waved past"
    assert net._secret_ok(blind, {"secret": "s3cr3t99"}) is True


def test_public_url_refuses_plaintext_to_a_public_host():
    from brx_mcp.mc.__main__ import _check_public_url
    assert _check_public_url(None) is None
    assert _check_public_url("wss://mc.example.org/ws") == "wss://mc.example.org/ws"
    # a local forward or a tailnet is inside the trust boundary §5b already draws
    for ok in ("ws://127.0.0.1:8766/ws", "ws://localhost:8766/ws", "ws://192.168.1.10:8766/ws",
               "ws://100.100.3.4:8766/ws"):
        assert _check_public_url(ok) == ok, ok
    for bad, why in (("ws://mc.example.org/ws", "PLAINTEXT"), ("ws://8.8.8.8:8766/ws", "PLAINTEXT"),
                     ("http://mc.example.org", "ws:// or wss://"), ("wss://", "ws:// or wss://")):
        try:
            _check_public_url(bad)
            raise AssertionError(f"accepted {bad!r}")
        except SystemExit as e:
            assert why in str(e), (bad, str(e))
