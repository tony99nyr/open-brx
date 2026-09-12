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
import sys
import tempfile
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
    assert t.spawned[0] == ["cloudflared", "tunnel", "--url", "http://127.0.0.1:8766", "--no-autoupdate"]


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
    assert s.net.join_secret == s.join_secret and s.net._pub is None and s.net._public_up is False
    assert s.net.join_body() == {"pub": None, "secret": s.join_secret}
    s._tunnel_changed({"ws_url": "wss://abc.trycloudflare.com/ws", "status": "up",
                       "provider": "cloudflared", "available": True})
    assert s.net._public_up is True and s.net.join_body() == {
        "pub": "wss://abc.trycloudflare.com/ws", "secret": s.join_secret}


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
        async with _NetHarness(secret="s3cr3t99", pub="wss://x.trycloudflare.com/ws", public_up=True) as h:
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
        async with _NetHarness(secret="s3cr3t99", pub=None, public_up=False) as h:
            w = await _say_hello(h.url, node_id="lan-2")
            assert isinstance(w, dict) and w["kind"] == "welcome"
    run(go())


def test_reach_comes_from_the_hello_then_from_every_status():
    needs(HAVE_WS, "websockets")

    async def go():
        import websockets
        async with _NetHarness() as h:
            seen: list[dict] = []
            h.net.on_node(seen.append)
            async with websockets.connect(h.url) as ws:
                await ws.send(_hello(node_id="n1", via="backhaul"))
                await asyncio.wait_for(ws.recv(), timeout=3)
                assert await _until(lambda: any(i.get("reach") == "backhaul" for i in seen)), seen
                rec = h.net.nodes["n1"]
                assert rec.via == "backhaul" and rec.view()["reach"] == "backhaul"
            assert await _until(lambda: not h.net.nodes["n1"].connected)
            assert h.net.nodes["n1"].view()["reach"] is None, "a dead socket has no path"
    run(go())


def test_a_hello_with_a_nonsense_via_is_ignored_rather_than_believed():
    needs(HAVE_WS, "websockets")

    async def go():
        async with _NetHarness() as h:
            await _say_hello(h.url, node_id="n1", via="satellite")
            assert h.net.nodes["n1"].via is None
    run(go())


def test_the_session_records_reach_from_the_hello_and_from_a_status():
    s = _sess()
    p = s.add_player("reaper", gun_id="GUN-A")
    s.net.simulate_hello("n1", "GUN-A", via="backhaul")
    assert s.nodes["n1"]["reach"] == "backhaul"
    assert s.snapshot()["nodes"][0]["reach"] == "backhaul"
    s.net.simulate_status("n1", {"node_id": "n1", "arm_state": "kitted", "synced": True, "reach": "lan"}, s.now_ms())
    assert s.nodes["n1"]["reach"] == "lan"
    assert s.node_player["n1"] == p["player_id"]


# --------------------------------------------------------------------------- A28.4 coverage
def _two_players_on(s: Session, reach_a: str | None, reach_b: str | None):
    s.add_player("a", gun_id="GUN-A")
    s.add_player("b", gun_id="GUN-B")
    s.net.simulate_hello("n-a", "GUN-A", via=reach_a)
    s.net.simulate_hello("n-b", "GUN-B", via=reach_b)


def test_coverage_is_full_only_when_every_bound_node_is_on_backhaul():
    s = _sess()
    assert s.coverage() == {"level": "zones", "on_backhaul": 0, "bound": 0}, "nobody bound is not coverage"
    _two_players_on(s, "backhaul", "lan")
    assert s.coverage() == {"level": "zones", "on_backhaul": 1, "bound": 2}
    s.net.simulate_status("n-b", {"node_id": "n-b", "arm_state": "kitted", "synced": True, "reach": "backhaul"}, s.now_ms())
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
    for nid in ("n-a", "n-b"):
        s.net.simulate_status(nid, {"node_id": nid, "arm_state": "kitted", "synced": True, "reach": "backhaul"}, s.now_ms())
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

        for nid in ("n-a", "n-b"):
            s.net.simulate_status(nid, {"node_id": nid, "arm_state": "kitted", "synced": True,
                                        "reach": "backhaul"}, s.now_ms())
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

    s.net.simulate_status("n1", dict(off_wifi, reach="backhaul"), s.now_ms())
    row = next(r for r in s.readiness()["board"] if r["player_id"] == p["player_id"])
    assert not any("WI-FI" in b for b in row["blockers"]), row["blockers"]
    assert any("BACKHAUL" in a for a in row["ambers"]), row["ambers"]
    assert row["status"] != "red", row
