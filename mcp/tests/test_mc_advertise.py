"""T3-A (field 2026-09-12): MC advertised a WSL2 NAT address in the QR/mDNS and no phone could reach
it. `--advertise <ip>` lets the operator hand out a different address than the one `_lan_ip()` guesses
-- WITHOUT moving where the socket binds -- and `build()` prints netinfo's loud warning at boot when
nothing has told it the advertised address is already correct."""
import argparse
import io
import contextlib

from brx_mcp.mc import __main__ as M
from brx_mcp.mc import netinfo as N


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


def test_build_advertises_the_override_ip_without_touching_bind(monkeypatch, tmp_path):
    """The whole point: `session.lan['ip']` and what the net layer actually hands out (`join_info` --
    the thing `advertise_mdns`/the QR read) follow `--advertise`, and nothing about `--host` (what the
    real bind would use) is read from it. (`session.lan['ws_url']` itself is NOT asserted here: with
    `--fake-net`, `Session._attach_net` snapshots `net.join_info()` at construction time -- before
    `build()` ever calls `net.start()` -- so it is stale at "ws://0.0.0.0:0/ws" for EVERY `--fake-net`
    run regardless of `--advertise`, a pre-existing gap unrelated to T3-A; see the report.)"""
    monkeypatch.setenv("BRX_MC_DIR", str(tmp_path))
    monkeypatch.setattr(N, "is_wsl", lambda: True)   # would warn if NOT overridden
    session, net, extra = M.build(_args(advertise="203.0.113.9"))
    assert session.lan["ip"] == "203.0.113.9"
    assert net.join_info()["url"].startswith("ws://203.0.113.9:")
    assert net.host == "203.0.113.9", "the fake net's own host, set by build()'s net.start(ip, ...)"
    assert session.lan["warning"] is None, "an explicit --advertise means nothing left to warn about"


def test_build_prints_the_loud_warning_on_wsl_with_no_override(monkeypatch, tmp_path):
    monkeypatch.setenv("BRX_MC_DIR", str(tmp_path))
    monkeypatch.setattr(N, "is_wsl", lambda: True)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        session, net, extra = M.build(_args())
    out = buf.getvalue()
    assert session.lan["warning"] == N.WSL_UNREACHABLE_WARNING
    assert "PHONES CANNOT REACH THIS ADDRESS" in out
    assert "--advertise" in out


def test_build_prints_nothing_extra_off_wsl_pin(monkeypatch, tmp_path):
    """The Mac/Linux pin at the call site that actually prints: off WSL, boot output carries none of
    this — `session.lan['warning']` is None and the loud banner never fires."""
    monkeypatch.setenv("BRX_MC_DIR", str(tmp_path))
    monkeypatch.setattr(N, "is_wsl", lambda: False)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        session, net, extra = M.build(_args())
    out = buf.getvalue()
    assert session.lan["warning"] is None
    assert "PHONES CANNOT REACH" not in out
    assert "!" * 78 not in out
