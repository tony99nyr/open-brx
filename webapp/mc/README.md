# Mission Control — web UI

The operator console for Open BRX (spec: `docs/spec/design/mission-control.md` + `docs/spec/contracts.md`; server⇄UI contract:
`mcp/brx_mcp/mc/API.md`). Vite + React 19 + TypeScript. The visual design is a pixel-close port of the
the 2026-08-25 Claude Design export (archived at `docs/archive/design/mc-export/`, six screens A1–A8, "military armory" language); the shipping UI is now the visual source of truth.

```
npm install
npm run dev                # http://localhost:5173 — proxies /api + /ui-ws to the Python server on :8765
npm run dev -- --mode mock # or open http://localhost:5173/?mock — in-browser demo, no server needed
npm run build              # tsc -b && vite build → dist/ (served by `python -m brx_mcp.mc` at /)
npm test                   # 69 jsdom tests, ~1.7s — mounts every screen, no server, no browser
npm run lint               # oxlint
```

## Tests

`test/` mounts the real screens with the real React renderer against fixture state. It exists because
every MC regression of the 2026-08-30 field session — the black ARSENAL page, the countdown reset on
tab switch, the RECAP history refetch storm — was found by a person looking at a screen, and none of
them needed a browser to catch. On its first run it found two more: the `PH[-1][1]` crash still live
in the status bar, and two hooks called below `Kit`'s `if (!state) return null`.

- `test/harness.tsx` — `mountScreen(<Screen/>, fixture)`. The fixture's `api` defers to the real
  `MockBackend`, so a screen calling a new route gets the mock's implementation instead of
  `api.getX is not a function` thrown inside an effect. `starved(state)` is the empty-session shape.
- `test/screens.test.tsx` — every screen, three ways: a full session, an empty one, and `state: null`.
- `test/console.test.tsx` — the specific regressions, each pinned where it broke.
- `test/client.test.ts` — the REAL `createHttpApi()` URLs, checked against the route table parsed
  out of `mcp/brx_mcp/mc/api.py`. The screen tests all run against the MockBackend, which cannot
  catch a wrong URL: without this a `matchCsvUrl` pointing at `/api/recap.csv` was invisible.

**This does not replace `app/tools/e2e.mjs`** (real widgets, a real MC, two phone HUDs). It is the
gate that runs before that suite is worth starting — see the `ui-build-verify` skill for what "done"
means for a UI change.

Layout: `src/tokens.ts` (design tokens) · `src/ui/` (Chamfer, Brackets, SegBar, Tag, Seg, Toggle,
StripedSlot, HazardButton, …) · `src/frame/` (command bar, stepper, telemetry strip, PANIC w/ confirm,
join QR) · `src/screens/` (Armory A1, Build A2, Kit A3/A4, Lobby A5, Armed A6, Live A7, Recap A8) ·
`src/api/` (types mirroring API.md + the REST/WS client) · `src/mock/` (stateful in-browser backend with
the design's demo data — guns are `GUN-A…H`; real sticker ids never enter the repo) · `src/store.tsx`.

Rules encoded in the UI (contracts A5): player numbers 1–63 shown as-is; the A1 gate is *no reds* —
amber never blocks; headset/screen are amber before the config push; abort reaches only nodes in range so
Reschedule is the primary action; K/A/ACC are MC-derived and reconcile at sync points (footnote verbatim);
FFA has no team-kill marker; recap is provisional until every node has flushed.

Fonts load from Google Fonts for now — self-host Oswald + Chakra Petch before a field deployment (the
field LAN has no internet).
