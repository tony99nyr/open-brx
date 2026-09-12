# Field Runbook — Mission Control (MacBook)

The match-day operator guide for running a game from the MacBook. **Grounded in what the code does
today** (`mcp/brx_mcp/mc/` — `__main__.py`, `api.py`, `state.py`), not the spec's aspirations.

> ✅ **Hardware-verified.** The MC↔phone↔gun path ran whole matches on real hardware: a 300 s FFA on
> 2026-08-30 (two iPhones, MacBook host) and a TDM outdoors on 2026-09-01 (two Android HUDs). It is also
> proven in software (`cd mcp && python3 run_tests.py`, incl. the full-stack e2e with mock phones; `cd app
> && npm run ui:e2e` for the browser suite). What is still unproven at scale (20-min soak, phone auto-rejoin,
> iOS locked-phone BLE, a gun joining a running match) is listed in `docs/FOLLOWUPS.md` under **System proofs**.

---

## 0a. Capture the evidence BEFORE you start (added 2026-08-30)

Assume something will misbehave and make sure it leaves a trace. Two sides, two mechanisms:

**MC — tee it, or it scrolls away.** MC logs to stdout only. Start it as:

```
python3 -m brx_mcp.mc -v 2>&1 | tee ~/mc-$(date +%Y%m%d-%H%M).log
```

**MC also persists every node event to SQLite automatically** at
`~/.brx-mcp/mc/session-<id>.sqlite` (`store.log()`). That is the authoritative record of what each
phone reported — you do not have to do anything to get it, but do **copy it off the Mac** after the
session along with the tee'd log.

**The phones — hit "Share log" on each one, before closing the app.** The HUD keeps its log and the
**last 60 raw BLE frames** in memory only; closing the app loses them. "Share log" pushes the bundle to
MC over the wire (`log_offer` → `pull_log` → chunked `log_data`), where it lands in the same SQLite. It
also offers a local share/clipboard copy, which works even if MC is unreachable.

> The BLE frame ring was added to that bundle on 2026-08-30. It is the only record of what the gun
> actually said to the phone, and without it a phone-side fault is undebuggable after the fact.

**If something goes wrong, do this before rebooting anything:** hit Share log on both phones, then copy
`~/mc-*.log` and `~/.brx-mcp/mc/session-*.sqlite`. A reboot loses the phone side entirely.

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

**Phone app (each player's phone) — install at home, with internet.** The player node is the **BRX
Combat HUD** in `app/` (Capacitor → Android + iOS, one codebase; HUD v2). Build/sign/sync per
**`app/README.md`** — Android via the hosted APK or `adb install`, iOS via Xcode. Each player needs it
installed and BLE-paired to their tagger **before** match day; on the field the app only needs the game
Wi-Fi and the MC `ws://` URL (from the join QR).

Verify the install with no hardware and no phones:

```bash
python -m brx_mcp.mc --demo --fake-net --ephemeral   # 8 demo players + 8 simulated phones, no session file
# (--fake-net ALONE seeds nothing and --demo ALONE starts the real node server; both flags = the walkthrough.
#  Every flag, and the busy-port trap: mcp/brx_mcp/mc/README.md → "Start it".)
# it prints  Mission Control  http://127.0.0.1:8765/#tok=<token> … — open THAT link (the #tok= part is
# the operator token; without it the console shows an OPERATOR TOKEN REQUIRED prompt — paste the token).
# On a trusted bench you can skip auth entirely: add --no-auth
```

---

## 2. Field network (before the players arrive)

MC coordinates over a **local Wi-Fi LAN with no internet** (ADR-0002). Two ways to host it:

**Recommended — a battery travel router.** Power it, note its SSID/password, and join the MacBook to
it. The router is the AP; MC binds its sockets to whatever LAN IP it's given. This keeps the Mac free
and is more robust than a laptop AP. Both live matches so far used a travel router.

**Fallback — the Mac's own hotspot.** macOS is a weak AP (Internet Sharing needs a separate uplink and
flakes with many clients); use it only for a small game. Untested at scale.

**Phone node checklist** (each player's phone, from `net.md §8b`; the Android app's `android-setup.sh`
already sets the cleartext + Wi-Fi permissions and forces landscape):
- **Join the game SSID**, and set it to **auto-join** (so a phone that drops rejoins without a human).
- **Mobile data: Android OFF, iOS can stay on.** The field router has no internet, so Android marks it "no
  internet" and many phones (Samsung "switch to mobile data", Pixel adaptive connectivity) move the default route to
  cellular — a `ws://<private-ip>` then leaves over LTE and never reaches MC. Turning mobile data off (or tapping
  "stay connected" on the no-internet prompt) is the reliable workaround until the app binds its socket to Wi-Fi
  (net.md §8b(d), not yet implemented). iOS routes on-link private IPs over Wi-Fi regardless; just turn **Wi-Fi
  Assist off**.
- **Do Not Disturb ON.** The app itself keeps the screen awake and locked to landscape while armed/live (keep-awake
  plugin), so no auto-lock setting is needed — but **do not press the power button and do not take calls**: a locked or
  backgrounded phone suspends the HUD's timers (iOS/Android WebViews pause JS) until the app is back in front, when it
  reconciles (missed T-0 → late spawn, missed respawn/expiry → applied on resume). DND is what stops a call from
  foregrounding the dialer mid-match.
- The app talks **cleartext `ws://` to a private IP** (Android ≥9 blocks this by default; the app opts
  in via `usesCleartextTraffic`). iOS needs the ATS local-network exception (in `ios-setup.sh`).

---

## 3. Start MC (match day)

```bash
source .venv/bin/activate
python -m brx_mcp.mc                    # real node server; binds every interface by default (--host to narrow)
# prints:  Mission Control  http://<ip>:8765/#tok=<token>   nodes: ws://<ip>:8766/ws
#          (a new operator token every launch; --token <fixed> to choose it; --no-auth on a trusted bench)
```

Flags (`brx_mcp/mc/__main__.py`): `--host` (default `0.0.0.0`), `--port` (UI, default **8765**),
`--ws-port` (nodes, default **8766**), `--fake-net` (no phones — dry run), `--token <t>` (fixed operator
token), `--no-auth` (no token — trusted bench only).

**Operator token.** Every mutating console action (`POST/PUT/PATCH/DELETE /api/*`, and the live `/ui-ws`
feed) needs the per-launch operator token; read-only GETs are open so a spectator can watch. Open the
**exact link the server prints** (`…/#tok=<token>`) — the console stores the token and strips it from the
address bar. A bookmark without `#tok=` (or after a restart, which mints a new token) shows the **OPERATOR
TOKEN REQUIRED** prompt: paste the token from the server's console line and tap APPLY.

Open the printed `http://<ip>:8765/#tok=<token>` link in the Mac's browser. The UI shows the **join
QR** (the `ws://` URL) for phones to scan, and steps through the phases below. A tablet/second laptop on
the same LAN can open the **same `#tok=` link** as a roaming console (a bare `http://<ip>:8765/` gets the
read-only board plus the token prompt).

---

## 4. Phase-by-phase (the host flow)

The server owns the `phase`; the UI walks it. Phases (`state.py`): **muster → build → kit → lobby →
armed → live → recap**. The console names them differently in two places: the `build` phase is two
pages, **GAMES** (pick a saved game, a stock mode, the venue) and **GAME DESIGNER** (define and save a
game), and `live` + `recap` are one **MATCH** tab that shows the result when there is one and the live
board otherwise. Each phase's actions map to REST calls (§7) the UI makes for you.

### Muster — is the gear ready?
The **readiness board** must be green-enough to start. Its gate is **no reds** (amber never blocks).
- Add each player and assign their gun (`POST /api/players`). A player's phone, once it opens the app,
  joins the node socket and **binds to that player by gun**, turning its row from "NO NODE" to linked.
- A bench **armory scan** (`POST /api/armory/scan`, needs `bleak` + BLE on the Mac) can pre-populate
  guns; without it, nodes self-identify and the board fills as phones connect. A fresh Mac has an empty
  `~/.brx-mcp/armory.json` (it holds headset PINs and is never in git): copy it over, or KIT offers the
  connected nodes' guns by tail.
- **Green needs:** node linked + **clock synced** + on the right Wi-Fi + gun link up. **Reds block
  start** (see §6). Battery-unread / screen-off / firmware-unread are **amber** — they don't block.

### GAMES + GAME DESIGNER (the `build` phase) — pick the game
Choose a **mode** (tdm / ffa / infection / lms / extraction / koth) and settings — **`time_limit_s` is
required** on the phone path (it's the only end that reaches a dispersed node), plus respawn, scoring,
health, indoor/outdoor, night. `PUT /api/config` validates live; **`config_errors` block**,
**`config_warnings` don't** (e.g. a frag-limit on a non-fully-covered venue warns that the winner is an
in-coverage early-end, provisional until recap).

### Kit — set each player up (while they gear up)
Per player: **display name, team, voice**, and three loadout slots — **primary, secondary and perk**
(`PATCH /api/players/{id}`). The perk is its own slot beside the two weapons; **Easy Reload** is the
exception that takes the second weapon with it, and the UI asks twice before dropping it. A player can
also be armed with a **pool** (HP / armour) different from the game's, and their row shows a chip when a
host set one deliberately.

What each slot may hold comes from the game's **loadout policy** — `POST /api/loadout/pool` previews it,
and the KIT screen greys out anything the policy refuses and says which rule did it. Phones may self-serve
within the same policy.

A weapon change can push a **silent try-out** (`POST /api/players/{id}/tryout`) so the player fires +
reloads to feel it. Try-outs are disabled once any node is in LOBBY. A configured-but-unspawned gun
ignores IR completely (bench 2026-08-25), so try-outs are safe in a crowd; point the gun away from others
anyway.

**CONTINUE is two steps when someone is still kitting.** The button reads `CONTINUE · 6/8 READY ▸`; the
first tap opens an inline confirm naming who is not ready and warning that they lose their screen, and
only the second advances. On an older server that cannot report readiness it reads `READINESS UNKNOWN`.

### Lobby — ready up, then push
Players **ready up** on their phones; the board fills (`ready N/total`). When everyone's ready and
readiness is `go`, **push the config** (`POST /api/lobby/push`): MC compiles each player's frame bundle
and sends it; each gun answers with an **echo** (`ack_config.gun_echo`). A gun that doesn't echo goes
**red — headset off?** and **blocks start** (bench 2026-08-25: with the headset off the head write
echoes nothing and the link dies, so the echo is the headset proof).
> **Known gap (software):** a player **added after the push** is scheduled but not sent a bundle — re-do
> the lobby push (or re-add before pushing) so their gun is configured.

### Start — the dispersed countdown
`POST /api/start` with a **runway** (countdown length; default 120 s = "walk to your base" time). MC
hands every node a synced **go-live time**; players disperse **out of Wi-Fi range** and each phone counts
its own gun down and spawns it at T-0 — **no signal needed at the moment of start**. The board shows each
node **armed, T-minus**.

### MATCH, live
Phones run their own guns and stream events as the LAN allows; MC shows a **Halo-style scoreboard**
(`live` view). **Attribution is exact** (`$PSET`/`$HIR` player ids) — kills, deaths, K/D, accuracy per
player (accuracy shows only once MC has counted hits for that player). Nodes out of range show
**last-known + a staleness age** — they are **stale, not gone**; their buffered events flush when they
walk back into coverage (store-and-forward, credited exactly once).

### MATCH, recap
At the time limit (or `POST /api/control {end}`), MC computes the winner, K/D, accuracy, and medals.
`GET /api/recap`, and **`GET /api/recap.csv`** for the full table. Recap stays **provisional** until every
victim's facts have flushed (a returning phone can still backfill). Every finished match is kept:
`GET /api/matches` lists them and `GET /api/matches/{id}.csv` exports one. `POST /api/session/new`
starts the next game (keep or clear the roster).

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
  this. Phone auto-reconnect across an MC IP change is untested.
- **Nothing connects at all** → check the Mac's firewall isn't blocking `8765`/`8766`, and that phones
  and Mac are on the **same** LAN (not the router's guest network).
- **Console shows OPERATOR TOKEN REQUIRED** → open the `#tok=` link the server printed, or paste the
  token from that console line. **MC OFFLINE with the server clearly running** → almost always a wrong or
  stale token (a bookmark without `#tok=`, or the server was restarted and minted a new one) — open the
  freshly printed link.

---

## 7. REST reference (what the UI calls; also for scripting)

**[`../mcp/brx_mcp/mc/API.md`](../mcp/brx_mcp/mc/API.md) is the contract** — every route, its phase gate,
its body and its errors, kept beside the code that serves them. All JSON, all times Unix ms. The live UI
feed is `GET /ui-ws` (WebSocket): a `snapshot` on every state change, plus `feed` entries for kills.

---

## 8. Pre-game 60-second check

1. Router up; Mac + phones on the game SSID; **mobile data off, DND on** each phone.
2. `python -m brx_mcp.mc` running; UI open; QR visible.
3. Every rostered gun's row **green** (or amber-only) — **no reds**.
4. Config set with a **time limit**; no `config_errors`.
5. All players **ready**; **lobby push** done; every gun **echoed** (no headset-off reds).
6. Start with a runway long enough to reach the bases → confirm every node shows **armed, T-minus**.
