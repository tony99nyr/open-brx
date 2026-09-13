"""F143 (field 2026-09-12) — `lan.mode` was the hard-coded word "unknown", and the REACH panel printed
it: "UNKNOWN · 192.168.28.167:8765". The parsers are pinned here against real captured output; the
subprocess calls themselves cannot run in CI and are not what goes wrong."""
from brx_mcp.mc import netinfo as N


def test_macos_networksetup_output():
    assert N.parse_macos_networksetup(
        "Current Wi-Fi Network: Battle Company 5G\n") == "Battle Company 5G"
    # the pre-Monterey spelling
    assert N.parse_macos_networksetup("Current AirPort Network: HomeNet\n") == "HomeNet"
    # not joined: an absence, never a display word
    assert N.parse_macos_networksetup(
        "You are not associated with an AirPort network.\n") is None
    assert N.parse_macos_networksetup("") is None


def test_macos_ipconfig_getsummary_output():
    captured = """<dictionary> {
  IPv4 : <array> {
  }
  Wi-Fi : <dictionary> {
    BSSID : 0:11:22:33:44:55
    SSID : Battle Company 5G
    Security : WPA2 Personal
  }
}
"""
    assert N.parse_macos_ipconfig(captured) == "Battle Company 5G"
    assert N.parse_macos_ipconfig("<dictionary> {\n}\n") is None


def test_linux_nmcli_terse_output():
    out = "no:Neighbour Wifi\nyes:Battle Company 5G\nno:BTWifi-X\n"
    assert N.parse_nmcli(out) == "Battle Company 5G"
    assert N.parse_nmcli("no:A\nno:B\n") is None, "no active row is None, not the first row"
    # nmcli escapes a colon inside an SSID
    assert N.parse_nmcli(r"yes:Tony\:s Hotspot" + "\n") == "Tony:s Hotspot"
    assert N.parse_nmcli("") is None


def test_linux_iw_dev_output():
    out = """phy#0
\tInterface wlan0
\t\tifindex 3
\t\ttype managed
\t\tssid Battle Company 5G
\t\tchannel 36
"""
    assert N.parse_iw(out) == "Battle Company 5G"
    assert N.parse_iw("phy#0\n\tInterface wlan0\n\t\ttype managed\n") is None


def test_windows_netsh_output_and_the_bssid_trap():
    out = """
There is 1 interface on the system:

    Name                   : Wi-Fi
    Description            : Intel(R) Wi-Fi 6 AX201
    State                  : connected
    SSID                   : Battle Company 5G
    BSSID                  : 00:11:22:33:44:55
    Signal                 : 88%
"""
    got = N.parse_netsh(out)
    assert got == "Battle Company 5G"
    assert ":" not in got, "the BSSID line was read as the SSID"
    assert N.parse_netsh("    State                  : disconnected\n") is None


def test_a_placeholder_word_is_never_an_ssid():
    for junk in ("", "  ", "none", "<none>", "--", '""'):
        assert N._clean(junk) is None, junk


def test_macos_redacts_the_ssid_without_location_services():
    """macOS 14+ answers the query and withholds the answer when the process has no Location Services
    permission. `<redacted>` is a real reply and a non-answer to the question, so it is an absence —
    printing it on the REACH panel is the F143 bug with a different word (round-2 review 2026-09-12)."""
    assert N.parse_macos_networksetup("Current Wi-Fi Network: <redacted>\n") is None
    assert N.parse_macos_ipconfig("  SSID : <redacted>\n") is None
    assert N._clean("<redacted>") is None and N._clean("REDACTED") is None
    # a network genuinely CALLED something with redacted inside it is still a network
    assert N._clean("redacted-guest") == "redacted-guest"


def test_lan_info_never_reports_unknown_as_a_display_word():
    real = N.detect_ssid
    try:
        N.detect_ssid = lambda: None
        lan = N.lan_info("192.168.0.5", 8765, "ws://192.168.0.5:8766/ws")
        assert lan["mode"] == "lan" and lan["ssid"] is None
        assert "unknown" not in repr(lan).lower()
        N.detect_ssid = lambda: "Battle Company 5G"
        assert N.lan_info("192.168.0.5", 8765, "ws://x/ws")["ssid"] == "Battle Company 5G"
    finally:
        N.detect_ssid = real


def test_detection_is_never_fatal_and_never_slow():
    """Every probe is a short subprocess with a cap, and every failure mode is None. A machine with no
    Wi-Fi tooling at all (WSL, a wired laptop, CI) must simply report nothing."""
    assert N.PROBE_TIMEOUT_S <= 2.0
    assert N._run(["brx-no-such-binary-f143"]) is None
    assert N.detect_ssid() is None or isinstance(N.detect_ssid(), str)


def test_main_builds_the_lan_block_from_the_detector():
    """The whole point: `__main__` must not write the placeholder back in."""
    import pathlib
    src = (pathlib.Path(N.__file__).with_name("__main__.py")).read_text(encoding="utf-8")
    assert '"mode": "unknown"' not in src, "the hard-coded placeholder is back in __main__"
    assert "netinfo.lan_info(" in src


# --------------------------------------------------------------------------- T3-A: WSL reachability
# Field 2026-09-12: MC advertised a WSL2 NAT address in the QR/mDNS and no phone could reach it. These
# pin the one thing that IS reliable (WSL detection, from the kernel's own version string) separately
# from the one thing that is an INFERENCE (that the address found is unreachable from a phone) — see
# `netinfo.wsl_lan_warning`'s docstring for exactly which is which.

def test_is_wsl_detects_the_microsoft_kernel_tag(monkeypatch):
    monkeypatch.setattr(N, "_read_proc_version",
                         lambda: "Linux version 5.15.167.4-microsoft-standard-WSL2 (...)\n")
    assert N.is_wsl() is True
    monkeypatch.setattr(N, "_read_proc_version",
                         lambda: "Linux version 6.8.0-45-generic (buildd@lcy02-amd64-... ) #45\n")
    assert N.is_wsl() is False
    # WSL1 carries the same tag on an otherwise very different kernel string
    monkeypatch.setattr(N, "_read_proc_version",
                         lambda: "Linux version 4.4.0-19041-Microsoft (Microsoft@Microsoft.com)\n")
    assert N.is_wsl() is True


def test_is_wsl_is_false_and_never_raises_with_no_proc(monkeypatch):
    monkeypatch.setattr(N, "_read_proc_version", lambda: "")
    assert N.is_wsl() is False


def test_wsl_warning_fires_only_under_wsl_and_only_unless_overridden(monkeypatch):
    monkeypatch.setattr(N, "is_wsl", lambda: True)
    warned = N.wsl_lan_warning(advertise_overridden=False)
    assert warned and "PHONES CANNOT REACH THIS ADDRESS" in warned and "--advertise" in warned
    # the operator already told MC the real address -- nothing left to warn about
    assert N.wsl_lan_warning(advertise_overridden=True) is None


def test_wsl_warning_is_silent_off_wsl_no_matter_what(monkeypatch):
    """Pins the "no behaviour change on macOS/Linux" requirement at the function that decides it."""
    monkeypatch.setattr(N, "is_wsl", lambda: False)
    assert N.wsl_lan_warning(advertise_overridden=False) is None
    assert N.wsl_lan_warning(advertise_overridden=True) is None


def test_lan_info_carries_the_warning_key_through(monkeypatch):
    monkeypatch.setattr(N, "is_wsl", lambda: True)
    lan = N.lan_info("192.168.28.167", 8765, "ws://192.168.28.167:8766/ws")
    assert lan["warning"] and "PHONES CANNOT REACH" in lan["warning"]
    lan2 = N.lan_info("10.0.1.9", 8765, "ws://10.0.1.9:8766/ws", advertise_overridden=True)
    assert lan2["warning"] is None


def test_lan_info_on_a_non_wsl_host_is_byte_for_byte_what_it_was_before(monkeypatch):
    """The Mac/Linux pin: every field a pre-T3-A caller relied on is unchanged, and the new key is
    always present (never a KeyError surprise for a caller that indexes it) but always falsy."""
    monkeypatch.setattr(N, "is_wsl", lambda: False)
    lan = N.lan_info("10.0.1.9", 8765, "ws://10.0.1.9:8766/ws")
    assert lan["mode"] == "lan" and lan["ip"] == "10.0.1.9" and lan["port"] == 8765
    assert lan["ws_url"] == "ws://10.0.1.9:8766/ws" and lan["qr"] == "ws://10.0.1.9:8766/ws"
    assert lan["warning"] is None
