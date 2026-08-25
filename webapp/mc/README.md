# Mission Control — web UI

The operator console for Open BRX (spec: `docs/spec/mission-control.md`; server⇄UI contract:
`mcp/brx_mcp/mc/API.md`). Vite + React 19 + TypeScript. The visual design is a pixel-close port of the
Claude Design export (`docs/spec/design/mc-export/`, six screens A1–A8, "military armory" language).

```
npm install
npm run dev                # http://localhost:5173 — proxies /api + /ui-ws to the Python server on :8765
npm run dev -- --mode mock # or open http://localhost:5173/?mock — in-browser demo, no server needed
npm run build              # tsc -b && vite build → dist/ (served by `python -m brx_mcp.mc` at /)
```

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
