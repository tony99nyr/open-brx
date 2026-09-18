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

# `<redacted>` is what macOS 14+ returns to a process without Location Services permission — a real
# answer to the query and a non-answer to the question, so it is an absence like the rest. Printing it
# on the REACH panel would be the F143 bug again with a different word (round-2 review 2026-09-12).
_NOT_SSID = {"", "none", "<none>", "--", "not associated", "<redacted>", "redacted"}


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
    except Exception as exc:
        # One line, no traceback: a missing `nmcli` or `iw` is normal, and `-v` echoes this to the terminal.
        log.debug("probe failed: %s (%s)", " ".join(cmd), exc)
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


def _read_proc_version() -> str:
    """Broken out so tests can stand in for the kernel without touching a real file (`test_mc_netinfo.py`
    monkeypatches this, never `is_wsl` itself, so the string-matching stays exercised)."""
    try:
        with open("/proc/version", "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


def is_wsl() -> bool:
    """DETECTION, not inference: every WSL kernel (WSL1 and WSL2 alike) stamps `/proc/version` with
    "microsoft" — Microsoft's own build tag, present since WSL shipped and unrelated to which Linux
    distro is running on top. A machine with no `/proc` at all (macOS, a locked-down container) or a
    read that fails for any reason is simply not WSL; this must never raise (`_read_proc_version`
    swallows the OSError itself)."""
    return "microsoft" in _read_proc_version().lower()


# T3-A (field 2026-09-12): MC advertised a WSL2 NAT address in the QR and over mDNS, and no phone on
# the real LAN could reach it — the operator was told, over chat, to find the Windows LAN address by
# hand and forward it with a `netsh portproxy`, which points at a WSL IP that changes on every restart.
WSL_UNREACHABLE_WARNING = (
    "PHONES CANNOT REACH THIS ADDRESS — this looks like WSL2's own private network, not the Windows "
    "host's LAN. Pass --advertise <windows-lan-ip> (find it with `ipconfig` on Windows) to put the "
    "real address in the QR and mDNS without moving where MC binds, and forward the ports with a "
    "netsh portproxy (`netsh interface portproxy add v4tov4 listenaddress=<windows-lan-ip> "
    "listenport=8766 connectaddress=<this WSL IP> connectport=8766`, and again for 8765) — the WSL IP "
    "changes on every restart, so redo the portproxy each time."
)


def wsl_lan_warning(*, advertise_overridden: bool, public_url: bool = False) -> str | None:
    """An INFERENCE layered on top of the `is_wsl()` DETECTION above: this process can tell it is
    running inside WSL for certain, but it has no phone to ask and no reliable, non-fatal way to learn
    from inside the VM whether the address `_lan_ip()` found is actually reachable from outside the
    Windows host. In WSL2's default (NAT) networking mode it never is — that address is a virtual
    adapter private to the host, which is exactly what burned the 2026-09-12 field night. The one setup
    where this inference is WRONG is WSL's mirrored networking mode, where the WSL and Windows LAN
    addresses are the same thing; there is no cheap way to tell the two modes apart from here, so the
    warning is worded as what MC actually knows ("looks like") rather than a flat claim, and it stays
    silent the moment the operator has told us the real address with `--advertise` (or has otherwise
    overridden what gets advertised) — at that point MC has nothing left to warn about.

    `public_url` (A28) is the second way there is nothing left to warn about: this whole warning is about
    the LAN address in the QR, and a phone dialling a public `wss://` node URL never uses it. MC on WSL
    with a backhaul URL is a WORKING setup, and warning on it is how an operator learns to ignore the
    warning that matters. A tunnel that comes UP later is the same fact arriving later — the session
    re-reads it then (`state.py _refresh_lan_warning`), and puts the warning back if it goes away."""
    if advertise_overridden or public_url or not is_wsl():
        return None
    return WSL_UNREACHABLE_WARNING


def lan_info(ip: str, port: int, ws_url: str, *, advertise_overridden: bool = False,
             public_url: bool = False) -> dict:
    """The `State.lan` block at launch. `mode` is never a placeholder word: with no SSID it is `"lan"`,
    which the REACH panel renders as "LAN · <ip>:<port>" — true everywhere and nothing to explain.

    `warning` (T3-A) is `None` everywhere except WSL with nothing telling MC the advertised address is
    already correct and no public URL for phones to reach it by — see `wsl_lan_warning` for exactly what
    is detected and what is inferred."""
    ssid = detect_ssid()
    warning = wsl_lan_warning(advertise_overridden=advertise_overridden, public_url=public_url)
    return {"mode": "lan", "ssid": ssid, "ip": ip, "port": port, "ws_url": ws_url, "qr": ws_url,
            "warning": warning}
