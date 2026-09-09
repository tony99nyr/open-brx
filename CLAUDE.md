# Open BRX

Open-source platform orchestrating Battle Company BRX laser taggers.
**Strategy/vision:** `docs/VISION.md`; mode catalog:
`docs/game-modes.md`. **Spec of record: `docs/spec/`** (`contracts.md` = the node↔MC wire + game data
model, amendments A1–A14 folded into the body; + the module docs) — the software is built + tested against it. Architecture
decisions: `docs/adr/` (0001 per-player node · 0002 laptop Mission Control + local LAN · 0003 native app
over Web Bluetooth). Ground truth for tagger I/O: `protocol/brx-protocol.md`.

**Start with [`docs/README.md`](docs/README.md)** — the docs index. **BRX facts: `docs/manual/`** is the
canonical, confirmed-facts manual (also the source the public website is built from) — read the page
there before digging through `reference/`/`protocol/`, and promote new confirmed facts into it
(`docs/manual/README.md` → *How a fact gets in*). It is **plain markdown**, nine files, one per page;
the format contract is `docs/site/FORMAT.md`. There is no block syntax, no provenance badge and no
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
  system python3 has no pip — bootstrap via get-pip if recreating). `python3 run_tests.py` must stay green
  under system python (tests needing extras skip cleanly).
- Development happens in **WSL2, which has no Bluetooth**. The `brx-mcp` server runs on
  **Windows Python** via WSL interop:
  - Windows venv: `C:\Users\Tony\.brx-mcp\venv` (from WSL: `/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe`)
  - Installed editable from `\\wsl.localhost\Ubuntu-24.04\home\tony\gitrepos\battlecompany\mcp`
    — code edits in WSL take effect immediately, no reinstall.
  - CLI first contact: `python.exe -m brx_mcp scan|identify|listen`.
- Working **on the MacBook** (dev or field): read **`docs/mac-dev-runbook.md`** first — the setup
  that is not in git, and the restart-MC-vs-hard-reload rule that has caused three false bug reports.
- Match-day target is a **MacBook**: everything in `mcp/` must stay cross-platform
  (bleak: WinRT/CoreBluetooth/BlueZ). macOS gives BLE UUIDs, not MAC addresses — never
  assume address formats.
- Captures + device registry live in `~/.brx-mcp/` on the machine running the server
  (i.e. `C:\Users\Tony\.brx-mcp\` here).

## Layout

`mcp/` Python MCP server (lab instrument) **+ `mcp/brx_mcp/mc/` = the Mission Control server** (M-MC: API.md is the server⇄UI contract; run `python -m brx_mcp.mc`) ·
`app/` native phone app (Capacitor → Android + iOS; see `app/README.md` — `npm run android:apk` cuts a
build and publishes it to the `app-v<version>` GitHub Release; the site links the releases page, not a
pinned asset, so a new cut does not stale a manual page) ·
`firmware/` PlatformIO ESP32 flavors · `webapp/mc/` the **Mission Control web UI** (Vite/React/TS; `npm run dev`, `?mock` for the in-browser demo; design brief `docs/spec/design/mission-control.md`) · `webapp/` legacy static harness (Web BT is not the player path — ADR-0003) ·
`hardware/` STLs/BOM · `protocol/` + `docs/` reference · **`site/`** the static generator for the public
website (`docs/manual/*.md` → `webapp/`, ~150 lines of `marked` plus one template; `cd site && npm test`
builds and runs the gate; **a push to `main` deploys the site** (Cloudflare runs the root `npm run build`
via `wrangler.toml`, so the pages are generated at deploy time and are not committed);
`webapp/mc/` is the separate MC UI and is never touched by the site build;
**`webapp/download/`** holds only the `build.json` sidecar: the APK itself is **git-ignored and lives on
the `app-v<version>` GitHub Release** (a committed APK cost ~5 MB of history per cut). `npm run android:apk`
builds it, publishes the release and writes the asset URL into the sidecar. `mcp/tests/test_published_build.py` fails if the sidecar
goes stale, names a commit that does not exist, or an APK gets committed).
**No em dashes in `docs/manual/`**: a test fails the build if one reaches a page. See
`docs/manual/README.md` for the house style.

**Generated, never hand-edit:** `app/ios/`, `app/android/`, `app/www/app.js` (all git-ignored and
rebuilt by `npm run` scripts). iOS settings we depend on live in `app/scripts/ios-setup.sh`, not in
the Xcode project — regenerating the platform wipes anything edited there.
