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
- The `?mc=&gun=` page works in ANY browser too — open it on the desktop next to the MC UI for manual poking.

Regression canary: if `?demo` never leaves phase `idle`, the boot hung (see the Capacitor thenable-proxy
incident, FOLLOWUPS 2026-08-26).
