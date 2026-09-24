# Mission Control server (M-MC)

The match host: roster, armory, mode config, per-player `FrameBundle` compilation, the M-NET WebSocket
server the phone/Companion nodes join, start sequencing, victim-side scoring and the recap. Serves the
built web UI (`webapp/mc/dist`) on the same port.

## Start it

**A newcomer on any of the three platforms:** run `./start.sh` (macOS, Linux) or `start.cmd` (Windows)
from the repo root. It sets up Python, the `.venv` and the console, then starts Mission Control and
opens it in the browser; `./start.sh --demo` runs the no-hardware demo below with no manual steps at
all. See the root [`README.md`](../../../README.md) → *Quickstart: run Mission Control*.

The rest of this section is the manual path, for a dev box that already has the environment set up.

### Manual demo (dev box, no hardware) — verified 2026-09-11 from WSL

MC needs **no Bluetooth**: the only route that touches a radio is the armory scan. So on the Windows
dev box it runs under the **WSL venv** (`.venv/bin/python`), not the Windows Python that gun work
needs; the browser e2e (`webapp/mc/test/e2e/koth.mjs`) uses the same interpreter. On plain Linux or a
fresh clone: `python3 -m venv .venv && .venv/bin/pip install -e ./mcp websockets starlette uvicorn`, then
the same command. On the MacBook, do
`docs/mac-dev-runbook.md` §1 first (the venv ships without starlette/uvicorn/websockets).

```bash
cd mcp
../.venv/bin/python -m brx_mcp.mc --demo --fake-net --no-auth --ephemeral
```

That is the whole answer for "show me Mission Control". Expected output, in this order:

```
INFO brx.mc: compiler: real M-MODES compiler
INFO brx.mc: presets: throwaway shelf at /tmp/brx-mc-presets-…/presets.json (demo/ephemeral)
INFO brx.mc: demo: 8 fake nodes driving the board
Mission Control  http://<lan-ip>:8765/
  nodes: ws://0.0.0.0:0/ws
  auth DISABLED (--no-auth): any device on this LAN can control the match
```

Open the URL: the LOBBY shows GUN-A…H, 8/8 ready. `nodes: ws://0.0.0.0:0/ws` is normal under
`--fake-net` (the in-memory transport has no socket). Prove it from a shell:

```bash
curl -s http://127.0.0.1:8765/api/state | python3 -c 'import sys,json;s=json.load(sys.stdin);print(s["phase"],len(s["nodes"]),"nodes")'
# lobby 8 nodes
```

**A busy HTTP port stops MC before the banner (F108).** MC binds :8765 first, so if another MC already
owns it you get `Mission Control could not bind …:8765 (Address already in use)` on stderr and exit code
2, never a success line. The node socket (:8766) still binds later, after the banner. To find a leftover:

```bash
ss -ltnp | grep -E '8765|8766'            # who owns the ports (Linux/WSL; macOS: lsof -i :8765)
ps -o pid,lstart,args -p <pid>            # yours, or a leftover from an earlier session?
```

Stop the leftover if it is yours, or run on other ports (`--port 8770 --ws-port 8771`). Ports other
than 8765 work for the SERVED UI only: the Vite dev server proxies to :8765 and nothing else
(`webapp/mc/vite.config.ts`). The e2e refuses to run against a squatter for the same reason.

### The flags that need more than their `--help` line

| flag | what it does |
|---|---|
| `--demo` | `FakeArmory` (no BLE) + 8 demo players on GUN-A…H, throwaway presets. **Alone it still starts the REAL node server** on :8766 and waits for phones. |
| `--fake-net` | in-memory node transport instead of the WebSocket server. **Alone it seeds nothing**: no players, no nodes, an empty MUSTER. |
| `--demo --fake-net` | the two together are what "simulated nodes" means: `DemoDriver` plays 8 fake phones through the whole match. |
| `--ephemeral` | no `~/.brx-mcp/session.json` read or write, and a throwaway presets shelf. `--demo` already implies both; the flag matters for a REAL run you do not want to inherit or overwrite the last bench roster with. |
| `--no-auth` | no operator token. Otherwise the URL is printed with `#tok=…` and every non-GET needs it (`API.md` → Operator auth). |
| `--tunnel` | A28: expose the **node socket only** through a `cloudflared` quick tunnel at boot — no account, no domain, no login. The public `wss://…trycloudflare.com/ws` goes into `lan.public`, into the join QR as `&pub=`, and out to every connected node as `join`. Needs `cloudflared` on PATH (`lan.public.available` says whether it was found); `POST /api/tunnel {on}` is the same switch at runtime. The LAN path is untouched either way. |
| `--public-url wss://…` | A28: a public node URL **you** already run (named Cloudflare tunnel, Tailscale Funnel, port forward). `provider: "manual"` — MC hands it out and never starts or stops it, so `POST /api/tunnel` answers 409. |
| `--advertise IP` | T3-A: put this address in the QR/mDNS instead of the one MC auto-detects, without moving where it binds. Fixes the WSL2-NAT case: MC auto-detects the WSL2 NAT address, a phone cannot reach it, and the UI shows `lan.warning` (`API.md`) until you pass the real Windows LAN address here (from `ipconfig`). |
| `--bench-volume [N]` | bench run only: every `$VOL` MC compiles (match heads at any venue, try-outs) plays at N, default 65, 0-100. Without it, heads use the venue volume (80 indoors, 90 outdoors) and try-outs 69. The banner says `BENCH VOLUME N: not for a real game`, the state carries `bench_volume`, and the console header shows a BENCH VOL tag. `npm run mc -- --bench-volume` forwards it. |
| `-v` / `--verbose` | debug logging. The banner is stdout, the log lines are **stderr**; capture both (`… > mc.log 2>&1`, `docs/mac-dev-runbook.md` §2). |

`python -m brx_mcp.mc --help` is the full, current flag list (ports, bind address, token, session file, evidence
directory, demo speed and the bench-only switches). This table covers only the flags whose behaviour needs prose.

Other launches:

```
python -m brx_mcp.mc                        # match day: real armory + real node server, token on
python -m brx_mcp.mc.mock_node ws://<ip>:8766/ws --gun GUN-A --tail 3D4F   # phoneless node + REPL
```

### The UI you are looking at

`/` serves `webapp/mc/dist` when it exists. **`dist` is git-ignored and never rebuilt for you**: a
fresh clone gets a plain-text "UI not built" page from `/`, and a clone with an old `dist` serves an
old UI without complaint. Two ways to be current:

- **served build:** `cd webapp/mc && npm install && npm run build`, then a **hard reload** (the JS
  filename is content-hashed; a normal reload can keep the old `index.html`).
- **dev server:** `cd webapp/mc && npm run dev` → http://localhost:5173, proxied to the Python server on
  :8765. `?mock` needs no server at all.

Python edits need an MC restart (editable install, no hot reload). The amber "server predates this UI"
banner means the SERVER is old; a control you just removed still showing means the PAGE is old.

To drive it headless, Playwright is installed under `webapp/mc/node_modules` (the natural home for an
MC-driving script; `test/e2e/koth.mjs` is the worked example), `app/node_modules` and `site/node_modules`;
a script must live under one of those directories (ESM resolution ignores `NODE_PATH`), which is why a
script in `/tmp` fails with `Cannot find package 'playwright'`.

## Post-match diagnostic (T1-B)

`python -m brx_mcp.mc.diag <path/to/session-*.sqlite> [--match ID] [--json]` reproduces, as one
read-only pass over a session store, the analysis a field report needs by hand: per match — go_live/
ended/duration, mode/config_id/environment/cfg health, total shots (max `status.shots` per node),
hits (`hit_taken` rows, plus any nested in an `event_batch` row), hit%, deaths, per-node `arm_state` +
`alive` + `preflight.gun_linked` distributions, three per-node POOL pairs, `shooter_team` values seen,
and each node's most recent `ack_config` before go-live vs the match's own `config_id`.

The pool pairs are `cfg hp/armor`, `pushed hp/armor` and `first_live hp/armor`, with a mismatch flag
naming which of the first two it was compared against:

- **`hp≠cfg` / `armor≠cfg`** answer the NARROW question — the match's `config.health`. A per-player
  `LoadoutOverrides.max_hp/max_armor` is baked into the pushed `$PSET` and **never** into
  `config.health`, so in a game that uses one these flag that node in every match. Perk-aware: armor
  ABOVE the config is a `body_armor` perk and is never flagged.
- **`hp≠pushed` / `armor≠pushed`** compare against the `$PSET` in the head MC actually pushed that
  player (persisted as `config["_heads"][player_id]`), which already has the overrides and the perk
  in it. These are exact, and they are the ones that mean "this gun was on another head". `-` when
  the store predates `_heads`, when no status body named a player, or when the head has no `$PSET`.
- **`first_live hp/armor`** is the first `status` with `arm_state: live` and `alive: true` for that
  table row's player (or unknown) attribution. The JSON physical-node summary separately retains the
  node's first such frame. This is the signature A36's pool check exists for and the one `max` cannot
  see: a gun that spawned into the wrong pool and self-corrected has a clean max.
- **A node re-bound during a match prints one row per player**, plus an unknown row for heartbeats that named
  none. Shot counts are cumulative-counter deltas, so each shot belongs to the binding that reported its change
  without inflating the match total. The JSON keeps the physical-node summary and adds `player_ids` plus
  `attributions`; its singular `player_id` is null when the summary is not unambiguous.

Markdown tables by default, `--json` for the raw report. Pure sqlite, no
`Session` import, read-only (`?mode=ro`) — safe to point at a session MC still has open, or at any
past night's file under `~/.brx-mcp/mc/`. The same report is served live for the CURRENT session at
`GET /api/diag/matches` (`API.md`).

## Reporting a bug

A bug report is one zip with the session's evidence in it, safe to attach to a public GitHub issue:

```
cd mcp && python -m brx_mcp.mc.report --open        # the newest session under ~/.brx-mcp/sessions/
python -m brx_mcp.mc.report <launch-id or folder> [--out DIR] [--json]
```

The zip holds `session.sqlite`, `mc.log`, `manifest.json`, `diag.json`, `environment.json` and a
`README.txt`. Before anything is written, `report.py` replaces player names (`Player 1`), sticker ids
(`TAGGER-1`), headset PINs (`[PIN]`), BLE addresses (`BLE-1`), IP addresses (`LAN-IP-1`), Wi-Fi names,
the tunnel host, the home folder, the user name and every token. The same value gets the same alias in
every file. It then searches every byte of the zip again for each original value; one hit and it stops
and writes nothing. `--open` opens the GitHub bug form (environment prefilled) and shows the zip, so the
reporter drags it in. MC does the same on demand with `POST /api/report` (`API.md`). GitHub issues are
public, so the reporter still opens the zip and checks it before posting.

## Where the rest is

- **`API.md`** — the server ⇄ web-UI contract (REST + `/ui-ws` snapshot), incl. the operator-token rule.
- **`docs/spec/contracts.md`** §5 — the node ⇄ MC wire (`envelope.py`, `net.py`); amendments A1–A20.
- **`API.md`** (behaviour) + **`docs/spec/design/mission-control.md`** (screens) — the MC spec since 2026-09-06 (the module spec is archived at `docs/archive/spec-mission-control.md`); `docs/spec/modes.md` — what `compile.py` emits.
- **`docs/field-runbook-mc.md`** — match-day procedure (MacBook, real phones, field network).
- **`docs/mac-dev-runbook.md`** — the MacBook setup that is not in git, and the restart-vs-hard-reload rule.
- **`webapp/mc/README.md`** — the console: dev server, jsdom tests, the browser e2e, why MC needs no stage harness.

**Where the wire types come from.** `types.py` (constants, `Literal` aliases, TypedDict shapes, kind
vocabularies) and `envelope.py` (`REQUIRED`/`EVENT_REQUIRED`/`ACCEPT_MIN`, plus its module-level
constants — the size caps and the `t` plausibility bounds) are the one hand-edited source; `webapp/mc/src/api/contract.gen.ts` and `app/src/transport/contract.gen.js` are
generated from them. Regenerate with `python3 mcp/tools/gen_contract.py` (from the repo root) after
touching either module; `mcp/tests/test_contract_generated.py` fails CI when a generated file goes
stale. **Never hand-edit `contract.gen.ts` or `contract.gen.js`.**

Modules: `state.py` (Session/phases/readiness), `scoring.py`, `compile.py` + `weapons.json`
(`golden_bundle.json` is the frozen reference bundle), `net.py` (NetServer, A8 takeover rules), `armory.py`
(bleak scan-only; `fakes.py` for demo), `store.py` (session persistence + CSV), `api.py` + `__main__.py`.
Tests: `mcp/tests/test_mc_*.py` (`python3 run_tests.py`).
