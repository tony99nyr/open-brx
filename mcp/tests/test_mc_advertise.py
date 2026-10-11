"""T3-A (field 2026-09-12): MC advertised a WSL2 NAT address in the QR/mDNS and no phone could reach
it. `--advertise <ip>` lets the operator hand out a different address than the one `_lan_ip()` guesses
-- WITHOUT moving where the socket binds -- and `build()` prints netinfo's loud warning at boot when
nothing has told it the advertised address is already correct.

No pytest fixtures here: `run_tests.py` (the system-Python gate, F42) calls each `test_*` with no
arguments, so every patch below is manual save/restore in a try/finally, same convention as
`test_mc_netinfo.py`."""
import argparse
import asyncio
import io
import os
import contextlib
import shutil
import tempfile

from brx_mcp.mc import __main__ as M
from brx_mcp.mc import netinfo as N
from brx_mcp.mc import net as net_module


def test_check_advertise_rejects_urls_and_paths():
    for bad in ("ws://192.168.1.9:8766/ws", "http://192.168.1.9", "192.168.1.9/24"):
        try:
            M._check_advertise(bad)
            raise AssertionError(f"accepted {bad!r}")
        except SystemExit as e:
            assert "bare host/IP" in str(e), str(e)


def test_check_advertise_passes_through_a_bare_host():
    assert M._check_advertise(None) is None
    assert M._check_advertise("") is None
    assert M._check_advertise("192.168.1.42") == "192.168.1.42"
    assert M._check_advertise("  10.0.0.5  ") == "10.0.0.5"


def _args(**over):
    base = dict(host="0.0.0.0", port=0, ws_port=0, fake_net=True, ephemeral=True, session_file=None,
                demo=False, demo_speed=1.0, token=None, no_auth=True, tunnel=False, public_url=None,
                advertise=None, verbose=False)
    base.update(over)
    return argparse.Namespace(**base)


class _Env:
    """Manual `monkeypatch.setenv` substitute: a `BRX_MC_DIR` pointed at a throwaway directory, so
    `Store()` (opened unconditionally inside `build()`) never touches the real `~/.brx-mcp` (the exact
    litter T3-B's item 2 is about) -- restored, and the directory removed, on exit either way."""
    def __enter__(self):
        self.tmp = tempfile.mkdtemp(prefix="brx-mc-advertise-test-")
        self.had, self.old = "BRX_MC_DIR" in os.environ, os.environ.get("BRX_MC_DIR")
        os.environ["BRX_MC_DIR"] = self.tmp
        return self.tmp

    def __exit__(self, *exc):
        if self.had:
            os.environ["BRX_MC_DIR"] = self.old
        else:
            os.environ.pop("BRX_MC_DIR", None)
        shutil.rmtree(self.tmp, ignore_errors=True)


def test_build_advertises_the_override_ip_without_touching_bind():
    """The whole point: `session.lan['ip']` and what the net layer actually hands out (`join_info` --
    the thing `advertise_mdns`/the QR read) follow `--advertise`, and nothing about `--host` (what the
    real bind would use) is read from it. The synchronous fake transport refreshes the session URL after
    `start()`, while the real transport refreshes it from its bound `join_info()` in the startup task."""
    real_is_wsl = N.is_wsl
    try:
        N.is_wsl = lambda: True   # would warn if NOT overridden
        with _Env():
            session, net, extra = M.build(_args(advertise="203.0.113.9"))
    finally:
        N.is_wsl = real_is_wsl
    assert session.lan["ip"] == "203.0.113.9"
    assert net.join_info()["url"].startswith("ws://203.0.113.9:")
    assert net.host == "203.0.113.9", "the fake net's own host, set by build()'s net.start(ip, ...)"
    assert session.lan["warning"] is None, "an explicit --advertise means nothing left to warn about"


def test_build_refreshes_session_join_url_after_fake_net_starts():
    """The session is constructed before the in-memory transport starts, so its join URL must be
    refreshed after ``FakeNet.start`` or the console's QR keeps the pre-start 0.0.0.0:0 address."""
    with _Env():
        session, net, extra = M.build(_args(host="127.0.0.1", ws_port=8766))

    expected = "ws://127.0.0.1:8766/ws"
    assert net.join_info()["url"] == expected
    assert session.lan["ws_url"] == expected
    assert session.lan["qr"].startswith(expected + "?s=")


def test_real_net_start_refreshes_join_url_inside_startup_coroutine():
    """The async transport path must refresh the QR from its post-bind join info too."""
    class StubNet(net_module.NetServer):
        def __init__(self):
            super().__init__()
            self._port = 0
            self._url = "ws://0.0.0.0:0/ws"

        @property
        def port(self):
            return self._port

        async def start(self, bind, port, path, *, advertise_host=None):
            self._port = 9876
            self._url = f"ws://{advertise_host or bind}:9876{path}"

        def join_info(self):
            return {"url": self._url}

        def advertise_mdns(self):
            return False

        def abort_mdns(self):
            pass

    original = net_module.NetServer
    net_module.NetServer = StubNet
    try:
        with _Env():
            session, net, extra = M.build(_args(fake_net=False, host="127.0.0.1", ws_port=8766))
            asyncio.run(extra[0]())
    finally:
        net_module.NetServer = original
    assert session.lan["ws_url"] == "ws://127.0.0.1:9876/ws"
    assert session.lan["qr"].startswith("ws://127.0.0.1:9876/ws?s=")


def test_build_prints_the_loud_warning_on_wsl_with_no_override():
    real_is_wsl = N.is_wsl
    buf = io.StringIO()
    try:
        N.is_wsl = lambda: True
        with _Env():
            with contextlib.redirect_stdout(buf):
                session, net, extra = M.build(_args())
    finally:
        N.is_wsl = real_is_wsl
    out = buf.getvalue()
    assert session.lan["warning"] == N.WSL_UNREACHABLE_WARNING
    assert "PHONES CANNOT REACH THIS ADDRESS" in out
    assert "--advertise" in out


def test_build_prints_nothing_extra_off_wsl_pin():
    """The Mac/Linux pin at the call site that actually prints: off WSL, boot output carries none of
    this -- `session.lan['warning']` is None and the loud banner never fires."""
    real_is_wsl = N.is_wsl
    buf = io.StringIO()
    try:
        N.is_wsl = lambda: False
        with _Env():
            with contextlib.redirect_stdout(buf):
                session, net, extra = M.build(_args())
    finally:
        N.is_wsl = real_is_wsl
    out = buf.getvalue()
    assert session.lan["warning"] is None
    assert "PHONES CANNOT REACH" not in out
    assert "!" * 78 not in out


def test_check_advertise_rejects_a_host_carrying_a_port():
    """The likeliest typo of all, and it used to pass whole: `--advertise 192.168.1.42:8766` was spliced
    into `ws://192.168.1.42:8766:8766/ws` — a doubled port, in the QR, on the one flag whose entire
    reason to exist is that a wrong address in the QR cost a field night."""
    for bad in ("192.168.1.42:8766", "[fe80::1]", "fe80::1"):
        try:
            M._check_advertise(bad)
            raise AssertionError(f"accepted {bad!r}")
        except SystemExit as e:
            assert "port" in str(e) or "IPv6" in str(e), str(e)


def test_check_advertise_rejects_something_that_cannot_be_a_host_at_all():
    for bad in ("not a host", "192.168.1.42,8766", "-leading-hyphen"):
        try:
            M._check_advertise(bad)
            raise AssertionError(f"accepted {bad!r}")
        except SystemExit as e:
            assert "IP address or a hostname" in str(e), str(e)
    # ...and a real hostname is still a bare host, not a URL: the QR takes either
    assert M._check_advertise("mc.local") == "mc.local"


def test_build_does_not_warn_about_the_lan_address_when_a_public_node_url_is_configured():
    """A28 + T3-A together: MC on WSL reached through a public `wss://` node URL is a working setup, and
    it was getting the loud boot banner AND a red alert on every console screen telling the operator to
    find a Windows LAN address no phone needs."""
    real_is_wsl = N.is_wsl
    buf = io.StringIO()
    try:
        N.is_wsl = lambda: True
        with _Env():
            with contextlib.redirect_stdout(buf):
                session, net, extra = M.build(_args(public_url="wss://mc.example.org/ws"))
    finally:
        N.is_wsl = real_is_wsl
    out = buf.getvalue()
    assert session.lan["warning"] is None
    assert "PHONES CANNOT REACH" not in out
    assert "!" * 78 not in out
