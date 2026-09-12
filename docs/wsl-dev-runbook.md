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
