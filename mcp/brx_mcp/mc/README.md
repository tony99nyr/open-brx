# Mission Control server (M-MC)

The match host: roster, armory, mode config, per-player `FrameBundle` compilation, the M-NET WebSocket
server the phone/Companion nodes join, start sequencing, victim-side scoring and the recap. Serves the
built web UI (`webapp/mc/dist`) on the same port.

## Start it (dev box, no hardware) — verified 2026-09-11 from WSL

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

**⚠ The banner prints BEFORE the port is bound.** If another MC already owns :8765 you still see
`Mission Control  http://…:8765/`, then one line later
`ERROR: [Errno 98] error while attempting to bind on address ('0.0.0.0', 8765)`, and every curl and
browser check after that is answered by the OTHER server (a demo from an earlier session, typically).
Check before you believe a result:

```bash
ss -ltnp | grep -E '8765|8766'            # who owns the ports (Linux/WSL; macOS: lsof -i :8765)
ps -o pid,lstart,args -p <pid>            # yours, or a leftover from an earlier session?
```

Stop the leftover if it is yours, or run on other ports (`--port 8770 --ws-port 8771`). Ports other
than 8765 work for the SERVED UI only: the Vite dev server proxies to :8765 and nothing else
(`webapp/mc/vite.config.ts`). The e2e refuses to run against a squatter for the same reason.

### The flags, as the code reads them

| flag | what it does |
|---|---|
| `--demo` | `FakeArmory` (no BLE) + 8 demo players on GUN-A…H, throwaway presets. **Alone it still starts the REAL node server** on :8766 and waits for phones. |
| `--fake-net` | in-memory node transport instead of the WebSocket server. **Alone it seeds nothing**: no players, no nodes, an empty MUSTER. |
| `--demo --fake-net` | the two together are what "simulated nodes" means: `DemoDriver` plays 8 fake phones through the whole match. |
| `--ephemeral` | no `~/.brx-mcp/session.json` read or write, and a throwaway presets shelf. `--demo` already implies both; the flag matters for a REAL run you do not want to inherit or overwrite the last bench roster with. |
| `--no-auth` | no operator token. Otherwise the URL is printed with `#tok=…` and every non-GET needs it (`API.md` → Operator auth). |
| `--tunnel` | A28: expose the **node socket only** through a `cloudflared` quick tunnel at boot — no account, no domain, no login. The public `wss://…trycloudflare.com/ws` goes into `lan.public`, into the join QR as `&pub=`, and out to every connected node as `join`. Needs `cloudflared` on PATH (`lan.public.available` says whether it was found); `POST /api/tunnel {on}` is the same switch at runtime. The LAN path is untouched either way. |
| `--public-url wss://…` | A28: a public node URL **you** already run (named Cloudflare tunnel, Tailscale Funnel, port forward). `provider: "manual"` — MC hands it out and never starts or stops it, so `POST /api/tunnel` answers 409. |
| `--port` / `--ws-port` / `--host` | HTTP UI+REST (8765), node WebSocket (8766), bind address (default 0.0.0.0, already every interface). |
| `-v` | debug logging. The banner is stdout, the log lines are **stderr**; capture both (`… > mc.log 2>&1`, `docs/mac-dev-runbook.md` §2). |

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
