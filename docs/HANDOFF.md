# Handoff — continue BRX work on the MacBook

**Date:** 2026-08-23. **From:** Claude session on Tony's Windows/WSL2 PC.
**You are:** Claude on Tony's MacBook, picking up mid-investigation with the tagger in hand.
Read `CLAUDE.md` first, then this. Protocol ground truth: `protocol/brx-protocol.md`
(especially §7a session findings — everything verified today is recorded there).

## Fresh-Mac bootstrap (do this first)

This MacBook is brand new. `bash dotfiles/setup-mac.sh` installs Tony's shell environment
(Homebrew, oh-my-zsh + his plugins, gh, bat, pnpm, python, git config) — idempotent, then
`gh auth login` and a new terminal. His WSL `.zshrc` had a plaintext `GH_TOKEN`; it was
deliberately NOT carried over — gh handles GitHub auth here, and the old token should be
revoked (remind Tony if he hasn't).

## The immediate mission

The BLE link from the Windows PC to the tagger **degraded from rock-solid (75–90 s
sessions) to dying 5–10 s after every connect**, and we exhausted every Windows-side
fix (driver restarts, bond removal, phone unplugged, WiFi confirmed off, tagger
power-cycles). Your first job is the **cross-check**: does macOS hold the link?

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e ./mcp
python -m brx_mcp scan                      # expect "Tactix2-3D4F" (UUID address on macOS)
python -m brx_mcp listen <uuid> 40          # heartbeat prints link state every 5 s
```

- macOS pops a Bluetooth permission prompt for the terminal — Tony must allow it.
- **Link holds 40 s** (with Tony pressing buttons → `$BUT` events streaming):
  Windows radio (Qualcomm FastConnect 7800) was the problem. Proceed to "Next protocol
  work" below, on the Mac permanently.
- **Link dies at ~5–10 s here too:** the tagger itself is in a bad state — it changed
  after the official Android app connected earlier today (the app *bonded* the tagger
  and renamed it via `$NAME,Tactix2,*`, proving persistent state). Suspects: tagger
  bond table, app-written config. Reset of last resort: Battle Company's USB updater
  (factory restore — never modify firmware otherwise). Try `pair` first:
  `python -m brx_mcp listen <uuid> 40 pair` (pairing extended survival on Windows).

## Hardware & identity

- Tagger: Battle Company BRX, **Gen2/3**, firmware **v4.32**, advertises as
  **Tactix2-3D4F** (Nordic UART service). Windows saw MAC `FE:AD:FD:10:3D:4F`;
  macOS will show a per-machine UUID — re-scan, don't reuse the MAC.
- There is also an untested **headset** and (unprobed) **Smart Grenade**.
- Battery telemetry arrives free in-session: `$VOLTS,<pack_mV>,<cell_mV>,~%,~%,*`
  (was ~7.65 V / 55% today).

## Experiment protocol (agreed with Tony)

- **Power-cycle the tagger between experiments** — connections lock the on-gun
  controls and leave state behind; a fresh boot per test keeps results attributable.
- One BLE central at a time; the phone app must be force-closed during our sessions.
- Volume: use `$VOL,30,0,*`, never the app's 100 — it's painfully loud indoors.
- All sends: known-safe list enforced in `mcp/brx_mcp/protocol.py`; panic =
  `$CLEAR,*` + `$SP,99,*`; power-cycle always restores.
- CLI experiment commands (in `mcp/brx_mcp/__main__.py`): `scan`, `identify <addr>`,
  `listen <addr> [s] [pair]`, `probe <addr> [s]`, `diag <addr>`, `startgame <addr> [s]`.
  All print raw frames; `diag`/`startgame` narrate what Tony should watch/hear.

## State of the protocol investigation

**Solved today** (details + exact frames in `protocol/brx-protocol.md` §7a):
- Idle taggers are silent; any BLE connection opens the event tap (`$BUT`, `$VOLTS`)
  and locks on-gun controls until power-cycle. "Phone connected" voice = central attached.
- Official app connect ritual (HCI snoop, no `$PHONE`): `$STOP` → `$PLAYX,0` →
  `$VOL,100,0` → `$PLAY,VA20,3,9` ("connection established"), once per session
  `$NAME`/`$VERSION`.
- Button map verified; `$VERSION` query; `$LCD`/`$ALCD` display echoes decode HP/armor/
  mag/reserve; writes must be MTU-chunked (~20 B, handled in `ble.py`).

**Unsolved — the big one: remote game start.** Config is *accepted* (`$GSET`, `$PSET`
health triplet, `$WEAP` slot 0, `$SIR` rules — all echoed via `$LCD`/`$ALCD`, and
`$PBWEAP,0,*` triggers a reload sound = "game starting"), but the gun never goes live:
trigger/buttons give the "disabled" chirp, no local firing, no `$HP` stream. Current
sequence in `GAME_SEQUENCE` (`__main__.py`). Untested hypotheses, in order:
1. **Capture a working app game session.** The Android app couldn't hold its BLE
   connection (never started a game), so our HCI snoop only caught the connect ritual.
   If the app works on iPhone: capture with Apple's Bluetooth logging profile +
   PacketLogger on the Mac, then parse with `python -m brx_mcp.btsnoop <log>` (btsnoop
   format; PacketLogger can export .btsnoop). This is the highest-value single capture.
2. `$BMAP` restores button functions in app mode (tested trigger→0, alt→97 once,
   inconclusive due to link drops — retest on stable link, watch for alt-fire making a
   reload sound).
3. Try `$SPAWN,,*` variant, `$START` *after* config, `$UR`/`$IT`/`$RP` family probes.

**Also unstarted:** sound-bank mapping (`$PLAY` id sweep with Tony logging what plays —
confirmed so far: `VA20` = "connection established"; `U16` also connect-related),
`$WEAP` 44-token field map (method: one-setting-at-a-time app captures +
`diff_captures`), Smart Grenade BLE probe, headset link protocol.

## Working agreements with Tony

- Tony is hands-on and fast — give him one clear physical instruction at a time
  (press X, listen for Y, power-cycle) and tell him exactly what to report.
- Long-running listens: launch in background, tell Tony what to do *while* it runs,
  read the capture after. His observations (sounds/LEDs) + wire log together are the
  experiment — neither alone is enough.
- Never modify tagger firmware; credit LaserTagMods (JEDGE/JBOX) in public docs.
- MIT-licensed public project eventually; repo currently private (`tony99nyr/battlecompany`).

## MCP server (optional on the Mac)

The same package is a Claude Code MCP server:
`claude mcp add brx -- <path-to-venv>/bin/python -m brx_mcp` — tools: scan/identify/
connect/disconnect/send/send_batch/get_events/wait_for/session_log/diff_captures/panic,
resources `brx://protocol`, `brx://known-devices`, `brx://captures/{label}`. For tight
experiment loops the CLI commands above work without any MCP registration.
