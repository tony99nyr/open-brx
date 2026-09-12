# Mission Control — web UI

The operator console for Open BRX (spec: `docs/spec/design/mission-control.md` + `docs/spec/contracts.md`; server⇄UI contract:
`mcp/brx_mcp/mc/API.md`). Vite + React 19 + TypeScript. The visual design is a pixel-close port of the
the 2026-08-25 Claude Design export (archived at `docs/archive/design/mc-export/`, six screens A1–A8, "military armory" language); the shipping UI is now the visual source of truth.

```
npm install
npm run dev                # http://localhost:5173 — proxies /api + /ui-ws to the Python server on :8765
npm run dev -- --mode mock # or open http://localhost:5173/?mock — in-browser demo, no server needed
npm run build              # tsc -b && vite build → dist/ (served by `python -m brx_mcp.mc` at /)
npm run typecheck          # tsc -b — CI runs this before `npm test`; vitest alone type-checks nothing
npm test                   # jsdom tests, ~2s — mounts every screen, no server, no browser
npm run e2e                # starts `npm run dev` + a real MC and clicks the KotH setup flow in Chromium
                           #   ONLY=<step> npm run e2e   runs one step; HEADED=1 to watch
npm run e2e:kit            # F127/A27: the KIT -> LOBBY gate, on a real MC and a stale one
npm run e2e:m2             # S24/S25/A25/A27/A29/A31: the live board, the spectator route, version
                           #   chips and log sync. ONLY=measure|mock|phone|real|refusal|stale;
                           #   shots land in ~/brx-scratch/m2ui
npm run lint               # oxlint
```

## Verifying it in a real browser — there is nothing to build

**MC is a web app: `npm run dev` and point a browser at it.** That is the whole answer, and it is written
down because a capable agent got it wrong on 2026-09-10 and started building an e2e "harness" for a UI that
needs none. If you want Playwright, it is already installed under `app/node_modules` and `site/node_modules`
and `site/playwright.config.mjs` is a working example — but what you write is a short script that opens
`http://localhost:5173` (add `/?mock` for no server) and clicks. Not a framework.

**Why the confusion is easy, and the distinction worth keeping:** the phone HUD has a whole stage harness
(`cd app && npm run ui:stage`, plus `ui:screens`, `ui:e2e`, `ui:shots`) because it drives a real tagger over
BLE — it needs something to stand in for hardware you cannot script. **MC drives nothing.** It talks to a
Python server over HTTP and a WebSocket, both of which Playwright can intercept directly
(`page.route` for REST, **`page.routeWebSocket` for the pushed snapshots** — strip only REST and a
"stale server" run is a lie). So MC needs no stand-in for anything.

The jsdom suite below is the fast inner loop, not a substitute for looking at the screen. When a change
crosses the server boundary or touches layout, follow `.claude/skills/ui-build-verify/SKILL.md` (repo root) — real browser,
click every control, stale server, a forced 400, small viewports (Pixel 4 393x830 is the target device),
tap-target and tiny-text audits.

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

## Numbers do not jitter — use `<Num>`, not `TAB`

`tokens.ts` exports `TAB = {fontVariantNumeric:'tabular-nums'}` and it **does nothing**: the property
needs the FONT to ship tabular figures and neither product face does. Measured 2026-09-12 in Chromium
(`ONLY=measure npm run e2e:m2`): at 40 px with `tabular-nums` set, Oswald renders `"00"` and `"11"`
12 px apart. The phone HUD made exactly this assumption with Saira Condensed and its countdown
re-centred on every tick (game test 2026-09-11, A5).

So any number that CHANGES on screen goes through `<Num>` (`src/ui/Num.tsx`), which gives every digit
its own fixed-width centred cell and leaves separators (`:`, `.`, `%`) at natural width. `TAB` is kept
so untouched screens still compile; nothing new should use it. The measure step in `e2e:m2` re-checks
both halves — that `tabular-nums` still fails, and that every rendered digit cell of one size is the
same width.

Layout: `src/tokens.ts` (design tokens) · `src/ui/` (Chamfer, Brackets, SegBar, Tag, Seg, Toggle,
StripedSlot, HazardButton, …) · `src/frame/` (command bar, stepper, telemetry strip, PANIC w/ confirm,
join QR) · `src/screens/` (Armory A1, Build A2, Kit A3/A4, Lobby A5, Armed A6, Live A7, Recap A8, **Spectate**) ·
`src/api/` (`contract.gen.ts` — GENERATED, see below — plus the UI-only view types and the REST/WS
client) · `src/mock/` (stateful in-browser backend with the design's demo data — guns are
`GUN-A…H`; real sticker ids never enter the repo) · `src/store.tsx`.

**Where `src/api/contract.gen.ts` comes from.** It is not hand-kept: `mcp/tools/gen_contract.py`
renders it from `mcp/brx_mcp/mc/types.py` + `envelope.py` (the node↔MC wire's constants, kind
vocabularies, required-field tables and the 18 shared shapes), and `mcp/tests/test_contract_generated.py`
fails CI when it drifts from the source. Regenerate with `python3 mcp/tools/gen_contract.py` from the
repo root after touching either Python module. **Never hand-edit `contract.gen.ts`** — `types.ts`
re-exports from it and adds only the UI-only view types (`State`, `NodeView`, `LiveView`, …) that have
no Python shape yet.

Rules encoded in the UI (contracts A5): player numbers 1–63 shown as-is; the A1 gate is *no reds* —
amber never blocks; headset/screen are amber before the config push; abort reaches only nodes in range so
Reschedule is the primary action; K/A/ACC are MC-derived and reconcile at sync points (footnote verbatim);
FFA has no team-kill marker; recap is provisional until every node has flushed.

**A25 log sync (D6)** lives on the muster header: a `LOG SYNC` switch (`AUTO` lets MC ask each phone
on its own — at the recap, on an offer, on a reconnect; `MANUAL` leaves the asking to you) and a `⬇ LOGS`
button on every phone card, which is never gated either way. The per-node `LOG` row shows what the
**phone** reports, not what MC asked for: `NOTHING OFFERED · READY TO SEND · SENDING… · HOLDING · DELIVERED ✓`,
with the node's own `held` reason rendered verbatim. The switch is absent entirely on a server with no
option table, because a control that PUTs to a 404 is worse than no control.

**`#spectate` (S25) is the room-facing board** and is deliberately not in the nav: a small `SPECTATE ↗`
link on LIVE opens it in a new tab. It renders WITHOUT the command bar (that bar carries PANIC) and
holds no button, link or input at all — `test/spectate.test.tsx` asserts exactly that, because the
point of a separate route is that a stranger can touch the screen and change nothing. It is the
legible v1; the broadcast treatment Tony asked for is a later pass on top of it.

Fonts load from Google Fonts for now — self-host Oswald + Chakra Petch before a field deployment (the
field LAN has no internet).
