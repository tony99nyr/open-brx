"""F143 (field 2026-09-12) — what network is Mission Control itself on?

`State.lan.mode` was the literal string `"unknown"`, hard-coded at launch because no SSID detection
existed on any platform. The REACH block prints the mode when there is no SSID, so the operator's
first look at the new backhaul panel read **"UNKNOWN · 192.168.28.167:8765"** — a placeholder word
rendered as a fact. The same word fed Debug's SSID row.

Two rules come out of that:

  * **Never a placeholder as a display word.** With nothing detected the mode is `"lan"` and the ssid
    is `None`, so the panel says "LAN · <ip>:<port>" — true on every machine, and nothing to explain.
  * **Never fatal, never slow.** Each probe is a short-lived subprocess with a 2 s cap, every failure
    is swallowed, and a machine with no Wi-Fi at all (a wired laptop, a CI box, WSL) simply reports
    nothing. This runs once, at launch, before the port is bound.

The parsers are separate from the process calls on purpose: the commands cannot run in CI, and the
part that can be wrong is the parsing. Each one is pinned against real captured output.
"""
from __future__ import annotations

import logging
import re
import subprocess
import sys

log = logging.getLogger("brx.mc.netinfo")

PROBE_TIMEOUT_S = 2.0

# `networksetup -getairportnetwork en0` — "Current Wi-Fi Network: <ssid>", or a "not associated" line.
_MAC_NETWORKSETUP = re.compile(r"^Current (?:Wi-?Fi|AirPort) Network:\s*(.+?)\s*$", re.M | re.I)
# `ipconfig getsummary en0` — a deep property list; the SSID appears as `SSID : <name>` (macOS 14+,
# where `airport -I` was removed and `networksetup` can answer "not associated" on a live link).
_MAC_IPCONFIG = re.compile(r"^\s*SSID\s*:\s*(.+?)\s*$", re.M)
# `nmcli -t -f active,ssid dev wifi` — colon-separated, one row per network, `yes` marks the joined one.
# An SSID may itself contain a colon, which nmcli escapes as `\:`.
_NMCLI_ROW = re.compile(r"^(yes|no):(.*)$", re.I)
# `iw dev` — the joined network appears as an indented `ssid <name>` under the interface.
_IW_SSID = re.compile(r"^\s*ssid\s+(.+?)\s*$", re.M)
# `netsh wlan show interfaces` — "    SSID                   : <name>". BSSID matches too if the
# pattern is not anchored to the start of the field, and it is the line right underneath.
_NETSH_SSID = re.compile(r"^\s*SSID\s*:\s*(.+?)\s*$", re.M)

_NOT_SSID = {"", "none", "<none>", "--", "not associated"}


def _clean(v: str | None) -> str | None:
    """An SSID, or None for anything that is really an absence."""
    if v is None:
        return None
    v = v.strip().strip('"')
    return None if v.lower() in _NOT_SSID else (v or None)


def parse_macos_networksetup(out: str) -> str | None:
    m = _MAC_NETWORKSETUP.search(out or "")
    return _clean(m.group(1)) if m else None


def parse_macos_ipconfig(out: str) -> str | None:
    m = _MAC_IPCONFIG.search(out or "")
    return _clean(m.group(1)) if m else None


def parse_nmcli(out: str) -> str | None:
    for line in (out or "").splitlines():
        m = _NMCLI_ROW.match(line)
        if m and m.group(1).lower() == "yes":
            return _clean(m.group(2).replace("\\:", ":"))
    return None


def parse_iw(out: str) -> str | None:
    m = _IW_SSID.search(out or "")
    return _clean(m.group(1)) if m else None


def parse_netsh(out: str) -> str | None:
    # `BSSID` would match a start-anchored `SSID` field only if the anchor were dropped, so the
    # regex is start-anchored and BSSID lines (which begin with a B) never enter.
    m = _NETSH_SSID.search(out or "")
    return _clean(m.group(1)) if m else None


def _run(cmd: list[str]) -> str | None:
    """A probe's stdout, or None. Every failure mode — missing binary, non-zero exit, a hang — is None."""
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=PROBE_TIMEOUT_S, check=False)
    except Exception:
        log.debug("probe failed: %s", " ".join(cmd), exc_info=True)
        return None
    return r.stdout.decode("utf-8", "replace")


def _macos_interfaces() -> list[str]:
    """Wi-Fi interface names, newest macOS first. `en0` is the fallback when the listing says nothing."""
    out = _run(["networksetup", "-listallhardwareports"]) or ""
    names = re.findall(r"Hardware Port:\s*Wi-?Fi\s*\nDevice:\s*(\w+)", out, re.I)
    return names or ["en0"]


def detect_ssid() -> str | None:
    """The SSID of the network this machine is on, or None when nothing can tell us."""
    try:
        if sys.platform == "darwin":
            for iface in _macos_interfaces():
                for cmd, parse in ((["networksetup", "-getairportnetwork", iface], parse_macos_networksetup),
                                   (["ipconfig", "getsummary", iface], parse_macos_ipconfig)):
                    got = parse(_run(cmd) or "")
                    if got:
                        return got
            return None
        if sys.platform.startswith("win"):
            return parse_netsh(_run(["netsh", "wlan", "show", "interfaces"]) or "")
        # Linux (and WSL, where both simply report nothing)
        got = parse_nmcli(_run(["nmcli", "-t", "-f", "active,ssid", "dev", "wifi"]) or "")
        return got or parse_iw(_run(["iw", "dev"]) or "")
    except Exception:                       # a detector is never allowed to stop MC from starting
        log.debug("SSID detection failed", exc_info=True)
        return None


def lan_info(ip: str, port: int, ws_url: str) -> dict:
    """The `State.lan` block at launch. `mode` is never a placeholder word: with no SSID it is `"lan"`,
    which the REACH panel renders as "LAN · <ip>:<port>" — true everywhere and nothing to explain."""
    ssid = detect_ssid()
    return {"mode": "lan", "ssid": ssid, "ip": ip, "port": port, "ws_url": ws_url, "qr": ws_url}
