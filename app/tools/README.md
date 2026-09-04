# app/tools — browser test rig (no hardware)

One-time: `cd app && npm i --no-save playwright && npx playwright install chromium`.

- **`rig.mjs`** — full stack in two headless pages: the REAL MC server + MC web UI (page A) and the REAL
  HUD joined via `?mc=<ws>&gun=<name>` with a **fake gun** (`src/fakegun.js`: answers head/spawn writes with
  the bench-verified echoes; `window.fakeGun.fire/hit/kill/reload` drives combat). Plays a whole match —
  join → kit → ready → push → start → live → down → redeploy → end → result → over — and screenshots BOTH
  pages per phase into `app/shots/`. Start MC first: `cd mcp && ../.venv/bin/python -m brx_mcp.mc --demo --no-auth`,
  then `MC=http://<ip>:8765 node tools/rig.mjs`.
- **`shots.mjs`** — HUD-only screenshot sweep over `?demo` (no MC server needed): every screen state at a
  phone-landscape viewport. `node tools/shots.mjs`.
- **`stage.mjs`** — `npm run ui:stage` → http://localhost:4190/ : the STAGE harness for visual review. The real HUD in
  a phone-sized frame with a sidebar that jumps it to any screen state (`?demo&stage=<state>`, 44 states from idle to
  MATCH COMPLETE — no timeline, the state holds) and an event panel that forces in-game events by hand: fire, hit,
  death, respawn, kill confirm, low ammo/HP, gun drop/relink, MC lost/back, push/start/abort/end/PANIC. Variants:
  screen size, team colour, respawn type/delay, night, host-locked loadout, MC rejecting picks. `/hud/?demo&stage=live`
  opens a state alone. The states live in `src/demo.js` (STAGES); every load starts from a clean engine.
- **`screens.mjs`** — `npm run ui:screens`: the screen-truth suite from the 2026-09-03 HUD review (docs/hud-review-2026-09-03.md).
  Every reported item is an assertion about what a person sees (rects, wraps, overlaps, visible text), run over the stage
  states at the design width AND a 667px phone, with desktop scrollbars ON — both reproduced the report and headless
  defaults hide them. Shots in `app/shots/screens/`. `ONLY=<substring>` runs matching steps.
- The `?mc=&gun=` page works in ANY browser too — open it on the desktop next to the MC UI for manual poking.

Regression canary: if `?demo` never leaves phase `idle`, the boot hung (see the Capacitor thenable-proxy
incident, FOLLOWUPS 2026-08-26).

## `npm run ui:e2e` — the browser suite (app/tools/e2e.mjs)

Pre-steps (the suite REFUSES to run on stale bundles — a stale dist once "passed" a whole run on old UI code):
1. `cd webapp/mc && npm run build` — the MC bundle the suite serves (`webapp/mc/dist`).
2. `cd app && npm run build` — the HUD bundle (`app/www/app.js`, generated).
3. Nothing may listen on 8865 (the suite's MC) or 8867 (the old-session MC). `pkill -f "brx_mcp.m[c]"` — note the
   `[c]` trick: a plain pattern self-matches the invoking shell.
Then `npm run ui:e2e`. `ONLY=<step-substring> npm run ui:e2e` runs matching steps only (stand-alone steps such as
`designer-controls`, `compat-older-server`, `compat-old-session` self-navigate); the F9 rollup + report always run.
`ALLOW_STALE=1` skips the bundle-freshness gate (mid-edit only). Shots + `report.md` land in `app/shots/e2e/`.

What the suite guards beyond the happy path: the same UI against a server that predates it (`compat-older-server`:
snapshots stripped over the WebSocket via `routeWebSocket`, A10 routes 404), a session persisted before A10
(`compat-old-session`: `--session-file` fixture in `tools/fixtures/`), a rejected host pick (400 on PATCH), the
designer's every control by VISIBLE state (tile art opacity/filter, chip fill, summary text), and tap targets under
36 px on GAMES / DESIGNER / KIT as failures, not findings.
