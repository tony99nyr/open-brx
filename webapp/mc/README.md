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
npm run e2e:backhaul       # A28: the Armory REACH panel and Lobby coverage/reach readout, against `?mock`
npm run e2e:kit            # F127/A27: the KIT -> LOBBY gate, on a real MC and a stale one
npm run e2e:end            # A42: the END delivery readout, on a real MC over its own REST API
npm run e2e:operator       # A47: the LIVE board's operator menu (curing a stuck node), on a real MC
npm run e2e:standby        # pulling a player out of the lobby and back in, clicked against a real MC
npm run e2e:m2             # S24/S25/A25/A27/A29/A31: the live board, the spectator route, version
                           #   chips and log sync. ONLY=measure|mock|phone|real|refusal|stale;
                           #   shots land in ~/brx-scratch/m2ui
npm run e2e:game-edit      # B3: editing the loaded game inline on KIT/LOBBY, against a mock AND a real MC
npm run e2e:report         # "Report a problem" against a real MC: the real zip, the token-gated
                           #   download, the GitHub issue link; ONLY=real|stale
npm run e2e:frame          # the console frame against `?mock`: one-row bar, WSL note, PANIC, report focus
npm run lint               # oxlint
```

`package.json` is the authoritative script list: check it before trusting this table, since a new
e2e script can land without a matching line here.

## `?mock` demo switches

`?mock` is a full in-browser backend, and these flags put it into a state a clean demo can never
reach — each one exists because a screen was unverifiable by eye without it.

| flag | what it demos |
|---|---|
| `?mock&faults=1` | **A36/A37/F271 — five config-proof states, one gun each.** GUN-A has a stale ack, GUN-B a weapon echo mismatch, GUN-C a pool fault, GUN-G a `$QUERY` read-back mismatch, and GUN-E the neutral **NOT ECHOED** state. The four reds survive the initial push and clear on the first RE-PUSH; NOT ECHOED remains. The query mismatch is force-proof, so LOBBY shows the re-push cure and no HOST OVERRIDE. DRIFT's phone has never arrived, providing the separate `waiting` row. |
| `?mock&laststale=1` | a node that WAS reached over the internet tunnel and has since gone dark (F155) |
| `?mock&nossid=1` | MC could not read the phone's Wi-Fi name — the REACH block must print `LAN · ip:port` |
| `?mock&restored=1` | a persisted session silently restored, two ghost players with no phone ever bound (F142) |
| `?mock&powerups=off` / `=old` | A56 powerups: MC started without `--powerups` (the ITEMS picker is replaced by a one-line note, and an `item_preset` is refused), or an MC that predates `GET /api/powerups` (404). With neither, the demo has powerups ON |
| `?mock&tunnelfail=1` | the next TURN ON of the tunnel fails instead of coming up (A28) |
| `?mock&stationlock=1` | A58: the seeded ASSIGNED station carries a live tamper lock and a RESTARTED attention line, so `StationAlerts`, UNLOCK STATIONS and the ITEMS card's LOCKED tag can be seen without a real station |

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
crosses the server boundary or touches layout, follow the `ui-build-verify` user skill — real browser,
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
vocabularies, required-field tables and the shared shapes), and `mcp/tests/test_contract_generated.py`
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

Fonts (Oswald, Chakra Petch) are self-hosted under `public/fonts/` and loaded with `@font-face` in
`index.html` — no internet dependency, which matters because the field LAN has none.
