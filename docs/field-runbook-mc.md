# Field Runbook — Mission Control (MacBook)

The match-day operator guide for running a game from the MacBook. **Grounded in what the code does
today** (`mcp/brx_mcp/mc/` — `__main__.py`, `api.py`, `state.py`), not the spec's aspirations.

> ⚠️ **Hardware-verified status.** The MC↔phone field path — a MacBook hosting the game over a field
> Wi-Fi, phones joining as nodes and driving real BRX taggers — has **NOT** yet been run end-to-end on
> real hardware over a real field LAN. It is proven in software (438 tests incl. 12 full-stack e2e
> scenarios with mock phones) and in the earlier **single-gun bench** (one phone ↔ one tagger over BLE).
> Everything below that touches a real tagger or the field network is **UNVERIFIED** until a live
> muster confirms it; those steps are tagged **[UNVERIFIED]**. The open hardware items live in
> `docs/verification-checklist.md`.

---

## 0. What MC is (and is not)

MC is a **local web app**: a Python server (`brx_mcp.mc`) that hosts the game and a browser UI that
drives it. It is BLE-connected to guns **only at the bench** (armory/muster); during play it talks to
**phone nodes over the field Wi-Fi**, never to guns directly (ADR-0001/0002). Nothing here needs the
internet — the field is an island.

Two ports:
- **HTTP UI + REST** — `http://<mac-ip>:8765/` (the operator console; also the REST API in §7).
- **Node WebSocket** — `ws://<mac-ip>:8766/ws` (phones connect here; shown as a QR in the UI).

---

## 1. Install (once, at home, with internet)

```bash
# Python 3.13 (Homebrew). 3.11+ works; the field Mac used 3.13.
brew install python@3.13
cd <repo>
python3.13 -m venv .venv
source .venv/bin/activate
pip install -e ./mcp websockets starlette uvicorn zeroconf
```

- `websockets` (node socket), `starlette`+`uvicorn` (HTTP/UI), `zeroconf` (optional mDNS advertise —
  QR/manual-IP are the mandatory paths, so this is nice-to-have).
- `bleak` comes with `mcp` and is needed **only for the bench armory scan** (`POST /api/armory/scan`),
  not for running a game.

**Web UI:** the operator console is `webapp/mc` (built assets). The server serves `webapp/mc/dist` at
`/` when it exists; if there's no committed `dist`, build it once at home (`cd webapp/mc && npm install
&& npm run build`) or run the Vite dev server, which proxies `/api` + `/ui-ws` to the Python server.

Verify the install with no hardware and no phones:

```bash
python -m brx_mcp.mc --fake-net        # in-memory node transport + demo nodes
# open http://127.0.0.1:8765/  → you should see the console reach the muster phase
```

---

## 2. Field network (before the players arrive)

MC coordinates over a **local Wi-Fi LAN with no internet** (ADR-0002). Two ways to host it:

**Recommended — a battery travel router.** Power it, note its SSID/password, and join the MacBook to
it. The router is the AP; MC binds its sockets to whatever LAN IP it's given. This keeps the Mac free
and is more robust than a laptop AP.

**Fallback — the Mac's own hotspot.** macOS is a weak AP (Internet Sharing needs a separate uplink and
flakes with many clients); use it only for a small game. `[UNVERIFIED]` at scale.

**Phone node checklist** (each player's phone, from `net.md §8b`; the Android app's `android-setup.sh`
already sets the cleartext + Wi-Fi permissions and forces landscape):
- **Join the game SSID**, and set it to **auto-join** (so a phone that drops rejoins without a human).
- **Mobile data OFF** — otherwise the phone routes `ws://<private-ip>` over cellular and never reaches MC.
- **Do Not Disturb ON**, auto-lock long / stay-awake — a locked screen suspends the node's timers.
- The app talks **cleartext `ws://` to a private IP** (Android ≥9 blocks this by default; the app opts
  in via `usesCleartextTraffic`). iOS needs the ATS local-network exception (in `ios-setup.sh`).

---

## 3. Start MC (match day)

```bash
source .venv/bin/activate
python -m brx_mcp.mc                    # real node server; add --host 0.0.0.0 to bind all interfaces
# prints:  Mission Control  http://<ip>:8765/   nodes: ws://<ip>:8766/ws
```

Flags (`brx_mcp/mc/__main__.py`): `--host` (default `0.0.0.0`), `--port` (UI, default **8765**),
`--ws-port` (nodes, default **8766**), `--fake-net` (no phones — dry run).

Open `http://<ip>:8765/` in the Mac's browser. The UI shows the **join QR** (the `ws://` URL) for
phones to scan, and steps through the phases below. A tablet/second laptop on the same LAN can open the
same URL as a roaming console.

---

## 4. Phase-by-phase (the host flow)

The server owns the `phase`; the UI walks it. Phases (`api.py`): **muster → build → kit → lobby →
armed → live → recap**. Each phase's actions map to REST calls (§7) the UI makes for you.

### Muster — is the gear ready?
The **readiness board** must be green-enough to start. Its gate is **no reds** (amber never blocks).
- Add each player and assign their gun (`POST /api/players`). A player's phone, once it opens the app,
  joins the node socket and **binds to that player by gun**, turning its row from "NO NODE" to linked.
- `[UNVERIFIED]` A bench **armory scan** (`POST /api/armory/scan`, needs `bleak` + BLE on the Mac) can
  pre-populate guns; without it, nodes self-identify and the board fills as phones connect.
- **Green needs:** node linked + **clock synced** + on the right Wi-Fi + gun link up. **Reds block
  start** (see §6). Battery-unread / screen-off / firmware-unread are **amber** — they don't block.

### Build — pick the game
Choose a **mode** (tdm / ffa / infection / lms / extraction) and settings — **`time_limit_s` is
required** on the phone path (it's the only end that reaches a dispersed node), plus respawn, scoring,
health, indoor/outdoor, night. `PUT /api/config` validates live; **`config_errors` block**,
**`config_warnings` don't** (e.g. a frag-limit on a non-fully-covered venue warns that the winner is an
in-coverage early-end, provisional until recap).

### Kit — set each player up (while they gear up)
Per player: **display name, team, weapon, voice** (`PATCH /api/players/{id}`). A weapon change can push a
**silent try-out** (`POST /api/players/{id}/tryout`) so the player fires + reloads to feel it. `[UNVERIFIED]`
Try-outs are disabled once any node is in LOBBY (a stray try-out shot hitting a configured gun is
untested) — point the gun away from others.

### Lobby — ready up, then push
Players **ready up** on their phones; the board fills (`ready N/total`). When everyone's ready and
readiness is `go`, **push the config** (`POST /api/lobby/push`): MC compiles each player's frame bundle
and sends it; each gun answers with an **echo** (`ack_config.gun_echo`). A gun that doesn't echo goes
**red — headset off?** and **blocks start**. `[UNVERIFIED]` the head-echo-as-headset-proof is a bench
item (the proven detector is the spawn echo at T-0).
> **Known gap (software):** a player **added after the push** is scheduled but not sent a bundle — re-do
> the lobby push (or re-add before pushing) so their gun is configured.

### Start — the dispersed countdown
`POST /api/start` with a **runway** (countdown length; default 120 s = "walk to your base" time). MC
hands every node a synced **go-live time**; players disperse **out of Wi-Fi range** and each phone counts
its own gun down and spawns it at T-0 — **no signal needed at the moment of start**. The board shows each
node **armed, T-minus**.

### Live — the match
Phones run their own guns and stream events as the LAN allows; MC shows a **Halo-style scoreboard**
(`live` view). **Attribution is exact** (`$PSET`/`$HIR` player ids) — kills, deaths, K/D, accuracy per
player. `[UNVERIFIED]` on real dispersed hardware, but proven in the e2e suite. Nodes out of range show
**last-known + a staleness age** — they are **stale, not gone**; their buffered events flush when they
walk back into coverage (store-and-forward, credited exactly once).

### Recap — the payoff
At the time limit (or `POST /api/control {end}`), MC computes the winner, K/D, accuracy, and medals.
`GET /api/recap`, and **`GET /api/recap.csv`** for the full table. Recap stays **provisional** until every
victim's facts have flushed (a returning phone can still backfill). `POST /api/session/new` starts the
next game (keep or clear the roster).

---

## 5. Aborting, rescheduling, ending

- **Reschedule a pending start** (still in the runway): `POST /api/start/reschedule {runway_s}`.
- **Abort a pending start**: `POST /api/start/abort` → `{reached, unreachable}`. Nodes in range get the
  cancel and drop back to lobby; **nodes already out of range won't hear it** and are listed as
  `unreachable` — you cannot silently un-start a dispersed field, so abort **before** players scatter.
- **End / recall a live game**: `POST /api/control {end}` (normal end) or `{recall}` (stop a live/armed
  game). **`{panic}` needs `{confirm:true}`** and fires `$CLEAR,*` → `$SP,99,*` on reachable guns.

---

## 6. Troubleshooting — why a node is red (readiness blockers, from `state.py`)

| Board says | Means | Fix |
|---|---|---|
| **NO NODE — OPEN THE APP AND SET THE GUN** | no phone has bound this player's gun | player opens the app, taps Set Gun, connects the tagger |
| **CLOCK NOT SYNCED — BLOCKS START** | the node hasn't completed the time handshake | wait a few seconds; if stuck, the phone can't reach MC — check Wi-Fi (below) |
| **WRONG WI-FI / MC UNREACHABLE** | phone is off the game SSID or on cellular | join the game SSID, **turn mobile data off**, disable "smart network switch" |
| **GUN LINK LOST — BLOCKS START** | the phone's BLE to its tagger dropped | power-cycle the tagger with its headset on; re-tap Set Gun |
| **IDENTITY REVERTED — RE-STAMP $NAME** | the gun's stored name reverted (opened in Callsign) | re-enroll the gun's name; **never open the Callsign app on an enrolled gun** |
| **GUN DID NOT ANSWER CONFIG — HEADSET OFF?** | empty `gun_echo` after the push | connect/replace the headset, power-cycle, re-push |
| (amber) BATTERY / SCREEN OFF / FIRMWARE UNREAD | non-blocking notices | fine to start; charge / wake / ignore |

Other field issues:
- **A phone won't rejoin the SSID** after a drop → confirm **auto-join** is on for that SSID and mobile
  data is off; a phone that never rejoins still ran its own gun locally — its events backfill when it
  reconnects, and it shows **stale** on the board meanwhile.
- **MC's address changed** (router handed a new IP / you restarted) → the printed `ws://` and the UI's
  QR update; phones re-scan the QR or re-enter the IP. Pin the router's DHCP lease for the Mac to avoid
  this. `[UNVERIFIED]` phone auto-reconnect across an MC IP change.
- **Nothing connects at all** → check the Mac's firewall isn't blocking `8765`/`8766`, and that phones
  and Mac are on the **same** LAN (not the router's guest network).

---

## 7. REST reference (what the UI calls; also for scripting)

All JSON, all times Unix ms, from `mcp/brx_mcp/mc/API.md`:

| method path | phase | purpose |
|---|---|---|
| `GET /api/state` | any | full `State` snapshot (same as the live `/ui-ws` feed) |
| `POST /api/armory/scan` | muster | BLE scan for guns `[UNVERIFIED — needs Mac BLE]` |
| `PUT /api/config` | ≤ kit | set/patch the `GameConfig` → `{ok, errors, config}` |
| `POST /api/players` · `PATCH /api/players/{id}` · `DELETE …` | ≤ lobby | roster + kit-out (server assigns `player_num`) |
| `POST /api/players/{id}/tryout` (`DELETE` to end) | kit | silent weapon try-out |
| `POST /api/players/{id}/ready` | lobby | host ready override |
| `POST /api/lobby/push` | lobby | compile + push bundles; refuses on reds |
| `POST /api/start` · `/api/start/reschedule` · `/api/start/abort` | lobby/armed | the dispersed start controls |
| `POST /api/control` | armed/live | `{end｜recall｜panic}` (`panic` needs `confirm:true`) |
| `GET /api/recap` · `GET /api/recap.csv` | live/recap | results + export |
| `POST /api/session/new` | recap | next game (`keep_roster?`) |

Live UI feed: `GET /ui-ws` (WebSocket) — `snapshot` on every state change + `feed` entries for kills.

---

## 8. Pre-game 60-second check

1. Router up; Mac + phones on the game SSID; **mobile data off, DND on** each phone.
2. `python -m brx_mcp.mc` running; UI open; QR visible.
3. Every rostered gun's row **green** (or amber-only) — **no reds**.
4. Config set with a **time limit**; no `config_errors`.
5. All players **ready**; **lobby push** done; every gun **echoed** (no headset-off reds).
6. Start with a runway long enough to reach the bases → confirm every node shows **armed, T-minus**.
