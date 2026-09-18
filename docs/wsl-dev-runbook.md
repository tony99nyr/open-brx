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
  (`.venv/bin/python`), same as any other Linux/macOS checkout: `pip install -e './mcp[mc]'` (or
  `./start.sh --setup-only` from the repo root, which does the same install plus the console build).

## Captures and the device registry

Anything the server writes at runtime — captures, `~/.brx-mcp/known-devices.json` — lands in
`~/.brx-mcp/` **on the machine actually running the server**. On this box that means
`C:\Users\Tony\.brx-mcp\`, not a WSL home directory, because the process doing the writing is Windows
Python.

## Passing arguments across the WSL→Windows boundary

Environment variables set on the WSL side of a `python.exe` invocation do not arrive — see the hard
rule in `CLAUDE.md`. Anything a Windows-side bench tool needs to read must go in as a `sys.argv`
argument instead, never an env var.

## Soak

`python -m brx_mcp soak <address> <pattern> <minutes>` is the screamers-investigation instrument
(docs/bench-screamers-2026-09-19.md Phase C, `mcp/brx_mcp/soak/`). It connects to one gun, arms it,
replays a named traffic pattern, probes liveness throughout, and logs + classifies every LOCK-UP /
LINK DROP / BAD FRAME. Patterns: `match`, `match-x10`, `callsign`, `burst-short`, `burst-weap` (see
`brx_mcp/soak/patterns.py` for what each one sends). It touches a gun, so it runs on Windows Python,
the same as every other `brx-mcp` command:

```
python.exe -m brx_mcp soak <address> match 120
```

Pacing flags for Phase B (compare `gap_ms`/`block` values): `--gap-ms N` sleeps `N` ms after every
frame; `--block N --pause-ms M` sleeps `M` ms every `N` frames. `--log PATH` overrides the default
log location (`captures/soak-<pattern>-<address>-<timestamp>.jsonl`, the same `~/.brx-mcp/captures/`
`session_log`/`diag-game` already write under). Ctrl-C ends the run cleanly and still prints the
summary.
