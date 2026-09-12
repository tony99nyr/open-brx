# Open BRX

Open-source platform orchestrating Battle Company BRX laser taggers.
**Strategy/vision:** `docs/VISION.md`; mode catalog:
`docs/game-modes.md`. **Spec of record: `docs/spec/`** (`contracts.md` = the node↔MC wire + game data
model, amendments folded into the body; §10 is the index, newest first; + the module docs) — the software is built + tested against it. Architecture
decisions: `docs/adr/` (0001 per-player node · 0002 laptop Mission Control + local LAN · 0003 native app
over Web Bluetooth). Ground truth for tagger I/O: `protocol/brx-protocol.md`.

**Start with [`docs/README.md`](docs/README.md)** — the docs index. **BRX facts: `docs/manual/`** is the
canonical, confirmed-facts manual (also the source the public website is built from) — read the page
there before digging through `reference/`/`protocol/`, and promote new confirmed facts into it
(`docs/manual/README.md` → *How a fact gets in*). It is **plain markdown**, one file per page (the platform pages live in
`docs/platform/`); the format contract is `docs/site/FORMAT.md`. There is no block syntax, no provenance badge and no
per-sentence `src:` line: confidence lives in `docs/experiment-log/` and `docs/FOLLOWUPS.md`. Before any hardware/protocol
work also read `docs/HANDOFF.md` (one screen of current state), `docs/FOLLOWUPS.md` (every open item,
incl. **Needs Tony at the bench**), and the current month under `docs/experiment-log/` (lab notebook).
**Session close is three writes:** one log entry, one FOLLOWUPS diff (strike or add rows, no prose), one
HANDOFF replacement (overwrite, never stack). A closed item becomes one dated line in
`docs/archive/followups-closed.md`; ids are never renumbered or reused. `docs/archive/` is history:
grep it, do not read it. `mcp/tests/test_docs_hygiene.py` enforces the stamp, id, and length rules. Ground truth:
`protocol/brx-protocol.md` + `protocol/callsign-extract/` (APK teardown: command/field maps, WEAP
token positions, the app's 2166-id sound list, game modes, grenade); the 2477 sounds actually on the gun are
`docs/reference/sound-catalog.md` (generated from `mcp/brx_mcp/data/sound_catalog.json`). Product spec: `docs/spec/`; hardware:
`hardware/brx-companion-spec.md` + `brx-station-spec.md`. Community/JEDGE facts:
`docs/reference/lasertagmods.md` + `community-notes.md`.

## Hard rules

- **Never modify stock BRX firmware.** All control is over the Bluetooth serial protocol.
- Credit **LaserTagMods** (JEDGE/JBOX) for protocol discovery in anything public-facing.
- MCP/server enforce the known-safe command list (`protocol.py`); unknown commands need
  explicit confirm. Panic sequence: `$CLEAR,*` then `$SP,99,*` — ⚠️ this leaves the gun with
  **no `$SIR` table**, so it cannot be hit until re-armed (F11). Never end a bench run on a
  bare `$CLEAR`.
- **WSL→Windows env vars do NOT cross**: `FOO=1 python.exe …` arrives unset, silently. Use
  `sys.argv` for anything a Windows-side bench tool reads (this faked a hardware result).
- **Volume:** the diagnostic default is `$VOL,30` (kind to ears indoors), but **30 is measurably
  inaudible for weapon/game audio**. MC now sets play volume **from the venue** —
  `compile.play_volume()`: **80 indoors (on-gun L3), 90 outdoors (L4)**; an unknown venue resolves to
  the *quieter* value. Field-corrected 2026-08-30: `$VOL,69` (iOS Callsign's value, and our old
  default) measures as roughly **on-gun level 2** and was inaudible outdoors. **Try-outs stay at 69** —
  they are fired at arm's length from the player's own head. CLI game commands still take volume as an
  argument; keep the low default for probing. ⚠️ We have **no absolute SPL measurement** for any of
  these — treat 90 as a field value, not an indoor one.

## Environment (important)

- WSL Python dev venv: `.venv/` (`.venv/bin/python`; has websockets/starlette/uvicorn/zeroconf/pytest;
  system python3 has no pip — bootstrap via get-pip if recreating). `cd mcp && python3 run_tests.py`
  must stay green under system python (tests needing extras skip cleanly).
- Development happens in **WSL2, which has no Bluetooth**; the `brx-mcp` instrument (anything that
  touches a gun) runs on **Windows Python** via WSL interop instead. Match-day target is a
  **MacBook**: everything in `mcp/` must stay cross-platform (bleak: WinRT/CoreBluetooth/BlueZ) —
  macOS gives BLE UUIDs, not MAC addresses, so never assume address formats. (The WSL→Windows env-var
  rule above applies whenever you cross that boundary.)
- Working on **this WSL/Windows box**: read **`docs/wsl-dev-runbook.md`** (the two-Python split, the
  UNC install path, first contact, where captures land).
- Working on **the MacBook** (dev or field): read **`docs/mac-dev-runbook.md`** first — the setup
  that is not in git, and the restart-MC-vs-hard-reload rule that has caused three false bug reports.

## Layout

| Path | What | Where the detail lives |
|---|---|---|
| `mcp/` | Python MCP server (lab instrument) **+ `mcp/brx_mcp/mc/`**, the Mission Control server (M-MC) | `mcp/brx_mcp/mc/README.md` → *Start it* (no-hardware demo: `cd mcp && ../.venv/bin/python -m brx_mcp.mc --demo --fake-net --no-auth --ephemeral`, the WSL venv, not Windows Python; the banner prints BEFORE the port binds, so a busy :8765 looks like success). `API.md` is the server⇄UI contract |
| `app/` | Native phone app (Capacitor → Android + iOS) | `app/README.md`; `npm run android:apk` cuts a build and publishes it to the `app-v<version>` GitHub Release, and the site links the releases page (not a pinned asset) so a new cut never stales a manual page |
| `firmware/` | Does not exist yet | Companion/station firmware is still to write; the ESP32 code that exists is `hardware/esp32-ir-bridge/` and `hardware/m5sticks3/` |
| `webapp/mc/` | The Mission Control web UI (Vite/React/TS) | `webapp/mc/README.md`: `npm run dev`, `?mock` for the in-browser demo, design brief `docs/spec/design/mission-control.md`. **Nothing to build to verify it in a real browser** — it's a web app, so run the dev server and drive it. (Unlike MC, the phone HUD drives a real tagger over BLE and needs its stage harness: `app && npm run ui:stage`.) Any UI change follows the `ui-build-verify` skill; a repo-wide accuracy pass follows `doc-rot-review` (`.claude/skills/ui-build-verify/SKILL.md`, `.claude/skills/doc-rot-review/SKILL.md`) |
| `webapp/` | **The Cloudflare deploy root**: the site generator's git-ignored output lands here beside the hand-kept `webapp/mc/` and `webapp/download/` | — |
| `hardware/` | STLs/BOM, the Companion + Station specs | `hardware/brx-companion-spec.md`, `hardware/brx-station-spec.md`, `hardware/inventory.md` |
| `protocol/` + `docs/` | Reference | `docs/README.md` |
| `site/` | The static generator for the public site. **Two doors, one source:** `docs/platform/*.md` → `/`, `/docs/*` and `/download`; `docs/manual/*.md` → `/manual/*` | The whole contract is `docs/site/FORMAT.md`; how to run it is `docs/site/README.md`. A push to `main` deploys the site and Cloudflare rebuilds it itself (`wrangler.toml`'s `[build]`); the built pages are git-ignored, so there is nothing to rebuild before committing |

**No em dashes in `docs/manual/` or `docs/platform/`**: the build fails if one reaches a page. See
`docs/manual/README.md` for the house style.

**Generated, never hand-edit:** `app/ios/`, `app/android/`, `app/www/app.js` (all git-ignored and
rebuilt by `npm run` scripts). iOS settings we depend on live in `app/scripts/ios-setup.sh`, not in
the Xcode project — regenerating the platform wipes anything edited there.
