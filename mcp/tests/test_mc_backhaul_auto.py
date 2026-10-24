"""F595 (Tony 2026-10-24): MC starts the backhaul itself, during kit, never at ARM.

Two triggers: the first config push with a phone bound (kit-start), and the first `cellular` status from a
bound phone in KIT through LIVE (the backstop). Neither waits, neither refuses, the operator's OFF sticks,
and nothing but a real, persistent run with a real net may fire them. Every tunnel here is `_FakeTunnel`:
no test spawns cloudflared.
"""
from __future__ import annotations

import os
import pathlib
import shutil
import tempfile

from _session import ack_lobby, mk_kit_session, online
from _skip import needs
from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.state import Session
from brx_mcp.mc.tunnel import TunnelError

try:
    import uvicorn  # noqa: F401
    HAVE_UVICORN = True
except Exception:
    HAVE_UVICORN = False


class _FakeTunnel:
    """The slice of `Tunnel` that Session drives. `start` never awaits, like the real one."""

    def __init__(self, *, fail: str | None = None):
        self.starts: list[int] = []
        self.stops = 0
        self.fail = fail
        self.status = "off"
        self.available = True
        self.stoppable = True
        self._cbs: list = []

    @property
    def armed(self) -> bool:
        return self.status in ("starting", "up")

    def public(self) -> dict:
        return {"ws_url": None, "status": self.status, "provider": "cloudflared" if self.armed else None,
                "available": True, "was_up": False}

    def on_change(self, cb) -> None:
        self._cbs.append(cb)

    def _emit(self) -> None:
        for cb in self._cbs:
            cb(self.public())

    def start(self, ws_port=None, loop=None) -> dict:
        self.starts.append(int(ws_port or 0))
        if self.fail:
            raise TunnelError(self.fail)
        if self.status not in ("starting", "up"):
            self.status = "starting"
            self._emit()
        return self.public()

    async def stop(self) -> dict:
        self.stops += 1
        self.status = "off"
        self._emit()
        return self.public()


def _kit(n=2, *, auto=True, fail=None):
    s, net, clock, ps = mk_kit_session(n)
    net.start("10.0.0.5", 8766, "/ws")
    t = _FakeTunnel(fail=fail)
    s.attach_tunnel(t)
    s.tunnel_auto = auto
    return s, net, clock, ps, t


def _status(s, net, clock, i, transport):
    net.simulate_status(f"node{i}", {"node_id": f"node{i}", "arm_state": "kitted", "synced": True,
                                     "transport": transport}, clock["t"])


def _arm(s, net, clock, ps):
    for i in range(len(ps)):
        ack_lobby(s, net, clock, i)
    return s.start(runway_s=10)


# --------------------------------------------------------------------------- kit-start
def test_the_kit_push_starts_the_tunnel_once_and_says_why():
    s, net, clock, ps, t = _kit()
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    assert t.starts == [], "a phone saying hello is not the kit push"
    s.push_config()
    assert t.starts == [8766], t.starts
    assert s.snapshot()["lan"]["public"]["auto"] == {"reason": "kit", "cellular": 0}
    s.push_config()                           # a re-push in LOBBY
    assert t.starts == [8766], "the kit trigger fires once"


def test_nothing_starts_before_a_phone_is_bound():
    s, net, clock, ps, t = _kit()
    s.push_config(force=True)                 # roster only, no phone has said hello
    assert t.starts == [] and "auto" not in s.snapshot()["lan"]["public"]
    _status(s, net, clock, 0, "cellular")     # an unbound node's status is not a bound phone's
    assert t.starts == []


# --------------------------------------------------------------------------- cellular backstop
def test_a_cellular_status_in_kit_starts_it_and_counts_the_phones():
    s, net, clock, ps, t = _kit()
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    _status(s, net, clock, 0, "wifi")
    assert t.starts == []
    _status(s, net, clock, 0, "cellular")
    assert t.starts == [8766]
    assert s.snapshot()["lan"]["public"]["auto"] == {"reason": "cellular", "cellular": 1}
    _status(s, net, clock, 1, "cellular")
    assert t.starts == [8766], "already starting: no second start"
    assert s.snapshot()["lan"]["public"]["auto"]["cellular"] == 2


def test_a_cellular_status_during_live_starts_it_when_the_kit_trigger_missed():
    """The 10-17 shape: every phone said wifi through kitting, one said cellular in LIVE."""
    s, net, clock, ps, t = _kit()
    t.fail = "cloudflared is not installed"   # the kit trigger fails...
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    s.push_config()
    assert t.starts == [8766]
    t.fail = None                             # ...and the backstop still gets its own try
    _arm(s, net, clock, ps)
    clock["t"] += 11_000
    s.tick()
    assert s.phase == "live"
    _status(s, net, clock, 1, "cellular")
    assert t.starts == [8766, 8766] and t.status == "starting"
    assert s.snapshot()["lan"]["public"]["auto"]["reason"] == "cellular"


def test_cellular_before_kit_does_not_start_it():
    s, net, clock, ps, t = _kit()
    s.set_phase("build")
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    _status(s, net, clock, 0, "cellular")
    assert t.starts == []


# --------------------------------------------------------------------------- operator wins
def test_a_manual_off_sticks_for_the_session():
    s, net, clock, ps, t = _kit()
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    s.push_config()
    assert t.starts == [8766]
    from _async import run
    run(s.set_tunnel(False))
    assert t.status == "off" and "auto" not in s.snapshot()["lan"]["public"]
    _status(s, net, clock, 0, "cellular")
    s.push_config()
    assert t.starts == [8766], "neither trigger restarts a tunnel the operator switched off"
    run(s.set_tunnel(True))                   # the manual switch still works both ways
    assert t.starts == [8766, 8766] and t.status == "starting"


# --------------------------------------------------------------------------- never blocks
def test_a_start_failure_never_blocks_the_push_or_arm():
    s, net, clock, ps, t = _kit(fail="cloudflared is not installed")
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    out = s.push_config()
    assert out["ok"] and s.phase == "lobby" and t.starts == [8766]
    pub = s.snapshot()["lan"]["public"]
    assert pub["status"] == "off"
    assert pub["auto"] == {"reason": "kit", "cellular": 0, "error": "cloudflared is not installed"}
    _status(s, net, clock, 0, "cellular")     # the backstop tries once, fails, and ARM is untouched
    _status(s, net, clock, 0, "cellular")
    assert t.starts == [8766, 8766]
    info = _arm(s, net, clock, ps)
    assert s.phase == "armed" and info["go_live_t"]


def test_a_tunnel_still_starting_at_arm_does_not_delay_it():
    s, net, clock, ps, t = _kit()
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    s.push_config()
    assert t.status == "starting"
    _arm(s, net, clock, ps)
    assert s.phase == "armed"


# --------------------------------------------------------------------------- stays off
def test_the_triggers_are_inert_unless_the_launch_allows_them():
    s, net, clock, ps, t = _kit(auto=False)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    s.push_config()
    _status(s, net, clock, 0, "cellular")
    assert t.starts == []


def test_a_bare_session_never_auto_starts_and_has_no_tunnel():
    """Every test builds a Session; none of them may reach a real cloudflared by accident."""
    s = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))
    assert s.tunnel is None and s.tunnel_auto is False


def test_only_a_real_persistent_run_with_a_real_net_allows_the_triggers():
    from brx_mcp.mc.__main__ import auto_tunnel_allowed, parser
    P = parser()
    assert auto_tunnel_allowed(P.parse_args([]), fake_net=False) is True
    assert auto_tunnel_allowed(P.parse_args([]), fake_net=True) is False
    for flags in (["--no-tunnel"], ["--demo"], ["--ephemeral"], ["--fake-net"]):
        assert auto_tunnel_allowed(P.parse_args(flags), fake_net=False) is False, flags
    assert "--no-tunnel" in P.format_help()


def test_a_demo_or_ephemeral_build_wires_the_triggers_off():
    needs(HAVE_UVICORN, "uvicorn")
    from brx_mcp.mc.__main__ import build, parser
    old, old_tmp = os.environ.get("BRX_MCP_HOME"), tempfile.tempdir
    root = pathlib.Path(tempfile.mkdtemp())
    os.environ["BRX_MCP_HOME"] = str(root / "home")
    tempfile.tempdir = str(root)
    try:
        for flags in (["--demo", "--fake-net"], ["--ephemeral", "--fake-net"]):
            s, _n, _x = build(parser().parse_args([*flags, "--no-auth"]))
            assert s.tunnel is not None and s.tunnel_auto is False, flags
            if s.store:
                s.store.close()
    finally:
        tempfile.tempdir = old_tmp
        if old is None:
            os.environ.pop("BRX_MCP_HOME", None)
        else:
            os.environ["BRX_MCP_HOME"] = old
        shutil.rmtree(root, ignore_errors=True)


# --------------------------------------------------------------------------- A28.2 unchanged
def test_an_auto_started_tunnel_arms_the_join_secret_gate():
    """The auto trigger goes through the same `Tunnel` as the switch, so the gate rides on it: a public
    peer with no secret is refused, which is `test_the_secret_gate_matrix` end to end over a socket."""
    from brx_mcp.mc.net import NetServer
    s, net, clock, ps, t = _kit()
    gate = NetServer()
    s.net.set_join = gate.set_join            # the session hands its secret and gate to a real NetServer
    s._render_join()

    class _Ws:
        remote_address = ("127.0.0.1", 5555)  # cloudflared delivers from loopback
        request = type("R", (), {"headers": {}})()
    assert gate._secret_ok(_Ws(), {}) is True, "no tunnel yet: loopback is a dev box"
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    s.push_config()
    assert t.status == "starting" and gate._gate_armed()
    assert gate._secret_ok(_Ws(), {}) is False
    assert gate._secret_ok(_Ws(), {"secret": "nope"}) is False
    assert gate._secret_ok(_Ws(), {"secret": s.join_secret}) is True
