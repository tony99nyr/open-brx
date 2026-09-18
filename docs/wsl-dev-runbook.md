# WSL dev runbook

Everything specific to developing on the Windows/WSL2 box. Sibling of
[`mac-dev-runbook.md`](mac-dev-runbook.md); read that one for the MacBook instead.

The two facts that matter everywhere in this repo — WSL2 has no Bluetooth, and WSL→Windows env vars
do not cross — live in `CLAUDE.md`. This page is the how-to that follows from them.

## The two Pythons

Nothing here can talk to a gun from WSL2 directly, so BLE work and everyday dev work run under two
different interpreters:

- **`brx-mcp` (anything that touches a gun)** runs on **Windows Python**, reached from WSL over the
  interop shim:
  - Windows venv: `C:\Users\Tony\.brx-mcp\venv` (from WSL: `/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe`).
  - Installed editable from the UNC path to this checkout:
    `\\wsl.localhost\Ubuntu-24.04\home\tony\gitrepos\battlecompany\mcp` — code edits made in WSL take
    effect immediately, no reinstall.
  - First contact from a Windows shell: `python.exe -m brx_mcp scan|identify|listen`.
- **Mission Control (`python -m brx_mcp.mc`) is the exception.** Its one radio route — the match-day
  armory scan — is the MacBook's job, so on this box it runs from the plain **WSL `.venv`**
  (`.venv/bin/python`), same as any other Linux/macOS checkout: `pip install -e ./mcp` plus
  `starlette uvicorn websockets`.

## Captures and the device registry

Anything the server writes at runtime — captures, `~/.brx-mcp/known-devices.json` — lands in
`~/.brx-mcp/` **on the machine actually running the server**. On this box that means
`C:\Users\Tony\.brx-mcp\`, not a WSL home directory, because the process doing the writing is Windows
Python.

## Passing arguments across the WSL→Windows boundary

Environment variables set on the WSL side of a `python.exe` invocation do not arrive — see the hard
rule in `CLAUDE.md`. Anything a Windows-side bench tool needs to read must go in as a `sys.argv`
argument instead, never an env var.

## MC on this box

Mission Control listens on two ports: **8765** (HTTP) and **8766** (WebSocket). On this box, WSL2's
NAT networking hands out a private address that no phone on the real LAN can reach, so a plain
`python -m brx_mcp.mc` advertises an address in the QR code and over mDNS that looks fine from here
and is dead to every phone. MC detects the WSL kernel and prints a warning when this happens
(`netinfo.py`, `WSL_UNREACHABLE_WARNING`).

The fix is two steps, both needed, and both redone on every restart because the WSL IP changes each
time:

1. Find the Windows LAN IP with `ipconfig` on the Windows side, then start MC with
   `--advertise <windows-lan-ip>`. This swaps the address MC puts in the QR and mDNS for the real one,
   without moving where MC actually binds.
2. Forward the two ports from that Windows LAN IP into WSL with a `netsh portproxy` (run as
   Administrator in PowerShell, one line per port):
   ```
   netsh interface portproxy add v4tov4 listenaddress=<windows-lan-ip> listenport=8766 connectaddress=<wsl-ip> connectport=8766
   netsh interface portproxy add v4tov4 listenaddress=<windows-lan-ip> listenport=8765 connectaddress=<wsl-ip> connectport=8765
   ```
   Find `<wsl-ip>` from inside WSL (`hostname -I` or `ip addr show eth0`). It is a **different** address
   from the Windows LAN IP, and it changes on every WSL restart, so redo the portproxy each time.

`--public-url ws://<windows-lan-ip>:8766/ws` is the alternative when a phone must reach MC through a
URL rather than a QR/mDNS discovery (for example, a bookmarked address); it takes priority over
`--advertise` and skips the WSL warning outright.

Mirrored WSL networking (where the Windows host and WSL share one IP) makes the portproxy step a
no-op, but this box runs NAT mode, so treat the portproxy as required until that changes.
