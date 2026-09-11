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

`mcp/` Python MCP server (lab instrument) **+ `mcp/brx_mcp/mc/` = the Mission Control server** (M-MC: API.md is the server⇄UI contract; **to see it running with no hardware: `cd mcp && ../.venv/bin/python -m brx_mcp.mc --demo --fake-net --no-auth --ephemeral`** — WSL venv, not Windows Python; `--fake-net` alone shows an empty board; the banner prints BEFORE the port binds, so a busy :8765 looks like success — `mcp/brx_mcp/mc/README.md` → *Start it*) ·
`app/` native phone app (Capacitor → Android + iOS; see `app/README.md` — `npm run android:apk` cuts a
build and publishes it to the `app-v<version>` GitHub Release; the site links the releases page, not a
pinned asset, so a new cut does not stale a manual page) ·
`firmware/` PlatformIO ESP32 flavors · `webapp/mc/` the **Mission Control web UI** (Vite/React/TS; `npm run dev`, `?mock` for the in-browser demo; design brief `docs/spec/design/mission-control.md`). ⚠ **To verify MC in a real browser there is NOTHING to build** — it is a web app, so run the dev server and drive it (Playwright is already installed under `app/` and `site/`). The phone HUD needs its stage harness (`app && npm run ui:stage`) because it drives a tagger over BLE; MC drives nothing, so it needs no stand-in. `webapp/mc/README.md` has the detail, and for any UI change follow the `ui-build-verify` skill · `webapp/` legacy static harness (Web BT is not the player path — ADR-0003) ·
`hardware/` STLs/BOM · `protocol/` + `docs/` reference · **`site/`** the static generator for the public
website. **Two doors, one source (2026-09-11):** `docs/platform/*.md` → `/` (the MARKETING landing for the
Open BRX ecosystem), `/docs/*` and `/download`; `docs/manual/*.md` → `/manual/*` (the BRX manual; its
`index.md` is the manual's own landing). Two templates in `site/build.mjs`: `doc` (one readable column,
light/dark) and `landing` (dark, Mission Control's type, rendered from PLAIN markdown by
`site/lib/landing.mjs`: `##` = section, `###` = its headline, an image-only paragraph = a row of shots,
a `**Bold.**` list = captions, a link list = buttons, a bare code fence = a terminal, a ```data fence =
a generated component: `counts`/`modes`/`roles`/`manual`/`release`/`download`, all read from repo
source by `site/lib/facts.mjs`). **Landing pages carry capabilities, never status**: the build FAILS on
a date, a version number, "not yet"/"unfinished"/"coming soon" or a match report in `docs/platform/index.md`
or `docs/manual/index.md`; the only moving number is the app version, rendered from
`webapp/download/build.json`. **Screenshots are generated, never taken**: `cd site && npm run shots`
drives the built MC UI (`?mock`) and the HUD (`?demo`) with Playwright into `site/shots/` (committed,
content-hashed on publish), and `mcp/tests/test_site_shots.py` fails when `webapp/mc/src` or `app/src`
has moved past `site/shots/manifest.json`. Staged photos live in `site/photos/` (`hero.*`, `grenade.*`;
SVG placeholders until real ones land). Fonts are self-hosted from `site/public/fonts/`. **The landing embeds the REAL HUD** (`app/www` → `/demo/hud/`, `?demo&kit`) as a tap-to-try demo, so the site build needs `cd app && npm run build` first; root `build:ci` does that on Cloudflare and `site/build.mjs` fails if `app/www` is missing. The contract is
`docs/site/FORMAT.md`; `cd site && npm test` builds and runs the gate (~90 browser steps at 1280 and 390,
incl. the landing steps 12–12g); **a push to `main` deploys the site**, and Cloudflare REBUILDS it:
Workers Builds runs `wrangler deploy`, which runs `[build]` in `wrangler.toml` (`npm run build:ci`).
**The built pages are git-ignored**, so there is no stale-output failure mode and nothing to rebuild
before committing. `webapp/mc/`, `webapp/download/build.json`, `webapp/favicon.svg` and
`webapp/.assetsignore` are hand-kept and stay tracked; `webapp/mc/` is the separate MC UI and is never
touched by the site build; **`webapp/download/`** holds the `build.json` sidecar (the generated
`/download` page shares the directory and is ignored): the APK itself is **git-ignored and lives on
the `app-v<version>` GitHub Release** (a committed APK cost ~5 MB of history per cut). `npm run android:apk`
builds it, publishes the release and writes the asset URL into the sidecar. `mcp/tests/test_published_build.py` fails if the sidecar
goes stale, names a commit that does not exist, or an APK gets committed).
**No em dashes in `docs/manual/` or `docs/platform/`**: the build fails if one reaches a page. See
`docs/manual/README.md` for the house style.

**Generated, never hand-edit:** `app/ios/`, `app/android/`, `app/www/app.js` (all git-ignored and
rebuilt by `npm run` scripts). iOS settings we depend on live in `app/scripts/ios-setup.sh`, not in
the Xcode project — regenerating the platform wipes anything edited there.
