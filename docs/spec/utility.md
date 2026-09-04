# M-UTILITY — phones as items on the field: stations, radius control, and the scanner respawn

**Status:** v1 built 2026-09-04 (contracts **A13**). Owner: Tony (product). Implementation: `app/plugins/brx-beacon`
(advertise), `app/src/beacon.js` (codec + presence), `app/src/engine.js` (scanner respawn gates),
`app/src/utility.js` + `app/www/utility.html` (the utility role), `app/scripts/android-setup.sh` (permission).

## 0. Why

The grenade's station modes are native-firmware features that a host-driven game never sees, and a dead
tagger hears no IR at all in a hosted game (experiment-log 2026-09-04). Callsign itself does stations with
QR codes read by the phone and revives over BLE (`apk-harvest.md` §station modes). So a hosted station has
to talk to the **node**, not to the gun — and the node already owns respawn. This module makes **the same
app** either a player's HUD or a **utility item** on the field, with the node deciding presence by
Bluetooth advertising, and the radius under the operator's control on both platforms.

## 1. Roles

One install, one role at a time, chosen on the phone or assigned by Mission Control at muster:

| role | what the phone is | connects to |
|---|---|---|
| **hud** (default) | the player's node: one gun, the HUD, the M-NET wire | its tagger (BLE central), MC (LAN) |
| **utility** | an item on the field: respawn station · powerup · extraction point · bomb site · control point | nothing; it **advertises** and **scans** |

Both roles run the same BLE stack. A HUD phone keeps the scan open for the whole match (balanced duty
cycle) and **also advertises itself as a player**; a utility phone advertises itself as a station and scans
for players. No connections between phones, ever: adverts are broadcast state, so any number of phones read
them and the Android 7-connection cap is irrelevant.

Switching: `localStorage brx.role`; the HUD exposes `hud.h.onUtility` (the HUD session adds the control; until
then 7 taps on the idle stage within 3 s); the utility screen has BACK TO HUD.

## 2. The advert (the wire between phones)

An iOS app can advertise **only** a local name and service UUIDs, so the identity is one **128-bit service
UUID** on both platforms (Android could carry manufacturer data; one format keeps the scanner simple). The
local name (`BRX-RESPAWN-1`) is set where the platform allows it and is decoration only.

```
byte  0-3   4F 42 52 58   'OBRX'
      4     version        1
      5     role           1 station · 2 player
      6-7   id             station id 1..65535 · player_num (big-endian)
      8     kind           station: 1 respawn · 2 powerup · 3 extraction · 4 bomb · 5 control   (player: 0)
      9     team           0..3 = the gun's $TID team · 255 = neutral / any
      10    state          kind-specific (respawn 1 ready/0 disabled · bomb 0 idle 1 planted 2 defused 3 detonated ·
                            player: bit0 alive, bit1 planting, bit2 defusing, bit3 extracting)
      11    value          kind-specific small number (seconds left, cooldown, progress %)
      12    seq            bumps on every state change (a scanner tells fresh from stale)
      13    game           low 8 bits of the game's config hash · 0 = any game
      14    threshold      the station's own "you are AT me" RSSI, int8 dBm · 0 = scanner default
      15    reserved       0
```

Codec: `beacon.js encodeUuid()/decodeUuid()`, pinned by `app/test/beacon.test.mjs` (round trip, case and
dash tolerance, foreign UUIDs rejected, version-gated). Adverts are non-connectable; the Android advert
carries the TX-power field so a scanner can do path-loss later; 21–24 bytes, inside the legacy 31.

## 3. Radius: two knobs, and what they cannot do

| knob | where | platforms | effect |
|---|---|---|---|
| **transmit power** | the station, `brx-beacon start({txPower})` | **Android only** (ultraLow ≈ -21 dBm · low · medium · high ≈ +1 dBm); iOS exposes none | shrinks the whole bubble: at ultraLow a phone is barely receivable past 2–3 m |
| **threshold** | the station's screen → byte 14 of its advert → every player phone | both | "at the station" = smoothed RSSI ≥ threshold. Per station, so a respawn point can be arm's length while an extraction zone is a room |

**Calibration** (utility screen): stand where the edge should be holding a player phone, press **SET FROM
NEAREST PLAYER**; the threshold becomes that phone's smoothed reading minus 3 dB and goes out in the advert.
The HUD shows the live reading against the threshold on the DOWN screen (§4.3), so the edge is visible.

**Presence** (`beacon.js Presence`, both roles): EMA of RSSI (α 0.35); **present** after `dwellMs` continuously at/above the threshold; **gone** when the EMA drops `hysteresisDb` (6) below it, or after
`expiryMs` (4 s) with no advert. Pinned by tests: dwell, hysteresis band, expiry, a dip restarting the dwell,
the advertised threshold overriding the default, neutral admitting every team, other games ignored.

**Bench-tuned defaults 2026-09-04:** threshold **-74 dBm** at **high** TX, dwell **0.8 s** — get in range, a brief pause, green; about a 10 ft radius. -74 + 0.8 s is the shipped default in `app/src/app.js` (player presence) and `utility.js` (station). Phone-to-phone RSSI falls off fast up close, so at 3 in it reads ~-53: the bubble is genuinely small, which is what a respawn point wants.

**Scan reliability (Android):** a BLE scan left running goes silently deaf — `scanning` stays true but callbacks stop (hardware 2026-09-04: a down player at the station saw "find a respawn station" until a fresh scan was forced). `app.js` fights this: scan at low-latency, kick a fresh scan the instant the player goes DOWN, and restart every **7 s** while hunting a station (slower otherwise). 7 s keeps the death-kick + steady restarts under Android's ~5-starts-per-30 s throttle; a scan that dies mid-match is restarted on the next tick (the intent flag `beaconWanted`), so a single failed start can't freeze presence for the game.

**What radio cannot give:** a shape. The bubble is a fuzzy sphere: it leaks through drywall, shrinks behind a
body, and is not directional. That is why the respawn gate below requires an act, not just proximity. For
area effects (blast, extraction zone) the fuzziness is acceptable. A hard edge needs line of sight, which is
the QR-on-screen method — a last resort, not built.

**Security posture (be honest):** adverts are **unauthenticated** — any BLE device can broadcast one, and the station *dictates* its own team and "at me" threshold to every player. So the only real gates on a revive are: the gun must be **physically dead**, the player must **pull the trigger**, and the station id must be on the game's `config.stations` **allow-list** (small integers — weak). A determined player can carry a second phone in utility role advertising a team-matched station with `threshold:-100` and revive themselves anywhere. This is an **accepted casual-threat tradeoff** (friends on a LAN), not a proximity *guarantee*. The `game` byte scopes presence to one match (a station on a different non-zero game byte is ignored) but is **best-effort**: manual stations default to game 0 ("any"), so today two nearby games must use **disjoint station ids**; real per-match scoping waits on MC assigning stations (§5). For a hard, un-spoofable edge, the QR-on-screen method is the only option.

## 4. The scanner respawn (v1, built and unit-tested)

`config.respawn = { type: "scanner", delay_s, gate?: "trigger" | "presence" }` · optional
`config.stations = [ { id, kind }, … ]` = the allow-list of station ids valid in this game (a stray phone from
another game cannot revive anyone). Team comes from the **advert**, so MC can re-arm a station mid-match when
it is in range and a capturable station is just one that rewrites its own advert.

### 4.1 Rule
A dead player revives when **all** of: phase LIVE · `now - deadAt ≥ delay_s` · BLE link up · not resyncing ·
not reconciling (a rejoin's disarmed window, §3.10) · their team's **respawn** station (neutral or same `$TID`
team, state ≠ 0, on the allow-list) is **present** ·
and the gate:
- **`trigger`** (default): the player **pulls the trigger**. A dead gun still reports `$BUT,0,1` over BLE
  (bench 2026-09-04). Presence is the gate, the pull is the act — fifty feet away the gate is closed, and
  standing near without pulling does nothing. It also feels like the native station: face it and pull.
- **`presence`**: dwelling there past the delay is enough (a mode's choice).

On revive the node writes `frames.revive` exactly as an auto respawn does, and the `respawn` fact carries
**`station: <id>`** (A13.2). Auto and none modes ignore stations entirely.

### 4.2 Engine surface (`engine.js`)
`setStations(entries)` from the app every 250 ms · `state().station` = `{id, kind, team, state, value, rssi,
threshold, present}` of the station this player would use (present first, else strongest) · `state().respawnGate`
· `state().respawnHint` ∈ `timer | find_station | approach | hold | pull_trigger | reviving | out | null`.
`setStations` re-renders only when id / presence / rounded RSSI change. Tests: `engine.test.mjs`
"utility items" block (trigger gate, delay, wrong team, neutral, allow-list, disabled station, presence gate,
auto mode untouched, re-render economy).

### 4.3 DOWN screen (HUD session)
Scanner mode replaces the countdown with the hint (shipped copy, `hud.js`): **RUN TO YOUR TEAM'S RESPAWN
STATION** with the sub-label THEN PULL THE TRIGGER THERE (trigger gate) or AND STAND THERE (presence gate) (none
in range) → **GET CLOSER** with a closeness bar and STATION IN RANGE · the live RSSI / threshold (approach) → **HOLD…** · AT THE
STATION · ALMOST THERE (present, the respawn delay still running) → **PULL THE TRIGGER TO RESPAWN** (trigger
gate) or **RESPAWNING…** (presence gate) → REDEPLOY moment on revive. Timer phase shows the delay countdown as today.
The trigger-vs-presence copy is selected by the engine's `respawnGate` getter, so the HUD never re-derives the
gate from config (commit c97e5ce).

## 5. Other kinds (designed, not built)

**Build order and ownership: `docs/utility-roadmap.md`** (cross-cutting first — MC arming, radio hardening,
match scoping — then kinds by value: K1 control point, K2 extraction, K3 powerup, K4 bomb, K5 flag). This
spec stays the spec of record; if a roadmap row disagrees, the spec wins.

Same primitive; the difference is the station's state machine and the player node's action from its bundle.
For kinds where the station must know **who** is there, it reads **player** adverts (id, team, alive, intent
bits) — no connection.

| kind | station shows / advertises | player node does | still needs |
|---|---|---|---|
| powerup | what it gives; ready or depleted + cooldown (`value`) | present: `$LIFE` armor/HP · `$WEAP`+`$AMMO` swap · ammo; marks taken | shields (IR fn-11 only) |
| extraction | zone active, who is channelling, alarm on its own speaker | present: channel starts; leave resets; death drops loot (engine already speaks ZONE/LEAVE) | — |
| bomb | idle → planted (countdown in `value`) → defused / detonated | attacker present + plant intent → planted; defender present + defuse intent → defused; on detonate every phone in radius applies blast damage to its own gun (`$BHIT`, host-inflicted) | — |
| control | owner by team over time | present counts for your team | shoot-to-capture = the IR box |

## 5b. MC setup, arming, and placement (design, 2026-09-04 — Tony)

**Setup needs WiFi; play does not.** A utility phone joins MC at muster like a node — `hello` with
`role:"utility"` (and its current id/kind/team if it has any). Once the match is live a station is a
passive beacon: it needs **no** MC contact for the rest of the game (same island rule as a player node).

1. **Assign at muster (WiFi).** MC's KIT/muster gains an **ITEMS** panel beside the roster: the operator
   sets each utility phone's **kind / team / station id / threshold**. MC pushes **`station_config`** to the
   phone (M-NET, §5c); the phone applies it, shows **MC-ARMED · game N**, and **locks its controls**
   (the on-device 7-tap gate stays only as a no-WiFi/field-fix fallback). The game bundle carries
   `config.stations` = the allow-list of ids MC handed out, so a player phone only honours those ids.
2. **Placement BEFORE start, not inside the countdown.** Stations advertise from the moment MC arms them;
   presence is irrelevant until players are live. Flow: assign at muster → operators carry the phones out
   and prop them → back at MC, start the match with the normal runway. **Putting placement inside the
   countdown only creates a race** — a station not yet in place when the match goes live simply revives
   nobody until it arrives. No failure mode, no countdown coupling.
3. **Between games: stations do NOT walk back** unless their role/team changes. Revive counts are
   self-authoritative and report at recap when the phone is next in WiFi range (§5). Re-arm over WiFi
   only when the operator changes something. **Scoping caveat (v1):** the advert `game` byte would let a
   stale station be ignored the moment a new bundle reaches the players — but the station must LEARN the
   new game number, which needs MC contact. So **v1 keeps station adverts at `game 0` (any game) and
   relies on the id allow-list**: same ids, same stations, no walk-back. Per-match `game` scoping arrives
   with `station_config` carrying the game number (a station in WiFi range at each start picks it up).
4. **Station status copy:** **"NOT ARMED BY MISSION CONTROL"** until the push lands; **"MC-ARMED · game N"**
   after. The 7-tap manual path stays for a WiFi-less field.

## 5c. `station_config` (M-NET, MC → utility phone) — the arming message

`{ kind, team, id, threshold?, game?, valid_ids? }` — MC → the utility node at muster (and on any re-arm).
The phone applies it to its advert, sets MC-ARMED, and locks the config drawer. `valid_ids` (optional) is
the allow-list echoed for the station's own display; the authoritative allow-list players enforce is
`config.stations` in the game bundle. Absent `game` = 0 (any). This is a **contracts A13.5** addition.

## 5d. Other kinds (designed, not built)

Same primitive; the difference is the station's state machine and the player node's action from its bundle.
For kinds where the station must know **who** is there, it reads **player** adverts (id, team, alive, intent
bits) — no connection.

| kind | station shows / advertises | player node does | still needs |
|---|---|---|---|
| powerup | what it gives; ready or depleted + cooldown (`value`) | present: `$LIFE` armor/HP · `$WEAP`+`$AMMO` swap · ammo; marks taken | shields (IR fn-11 only) |
| extraction | zone active, who is channelling, alarm on its own speaker | present: channel starts; leave resets; death drops loot (engine already speaks ZONE/LEAVE) | — |
| bomb | idle → planted (countdown in `value`) → defused / detonated | attacker present + plant intent → planted; defender present + defuse intent → defused; on detonate every phone in radius applies blast damage to its own gun (`$BHIT`, host-inflicted) | — |
| control | owner by team over time | present counts for your team | shoot-to-capture = the IR box |

Mission Control drives all of it from the ITEMS panel (§5b); stations are self-authoritative and report at
recap (MC is not live mid-match).

## 6. Platform notes (verified where marked)

- **Scan while connected** is normal on Android and iOS; the HUD uses the same scan the gun picker does,
  at scanMode 1 after connecting. Android demotes a scan past ~30 min and throttles apps that restart scans
  often (restart on a timer — TODO). iOS coalesces duplicates only in the background; the HUD is foreground.
- **Permissions:** Android 12+ `BLUETOOTH_ADVERTISE` is a runtime permission — the plugin requests it on
  `start()`, the manifest carries it (plugin manifest + `android-setup.sh`). iOS: the existing
  `NSBluetoothAlwaysUsageDescription` covers peripheral mode.
- **iOS advertising:** name + service UUIDs only; no TX power; foreground only. The Swift side queues the start
  until the peripheral manager is powered on. ⚠️ **Not yet built on a Mac** — the Android path is the one
  exercised first (2026-09-04).
- **Android advertising:** non-connectable, TX power per the four levels, device name excluded (it is the
  phone's Bluetooth name, not ours).

## 7. Open

Verified on two Pixels 2026-09-04 (respawn end to end). Followups, roughly in priority:

Resolved since the first draft (see FOLLOWUPS + experiment-log):
- **Headset out-blink while down — BUILT** (A11.6/A11.7). The node paints the headset green out-blink (`$HLED`)
  on death and clears it on revive; the gun-body look while down is `presentation.gun` (health/dark modes).
- **Reconnect / new-match reconciliation — BUILT + VALIDATED ON HARDWARE** (S7.1; contracts A6.8; node.md §3.10).
  A live rejoin runs a 3 s disarmed reconcile that keeps the real pools and **never heals or infers death**; a
  new match clears an in-flight reconcile and spawns clean. Closed the force-close-at-low-HP cheat on R0BQT.
- **Station doesn't see player adverts at high TX — FIXED in code** (S6, commit 53e62bd): the station scans
  low-latency and restarts the scan every 8 s to recover an Android-stalled scan. Still needs the two-Pixel
  bench to confirm; a lower station TX is the fallback.

Still open:
- **Per-match scoping (half done).** The station carries a game byte in its advert and `station_config` pushes it
  (A13.5); the player-side `Presence.game` filter honours it. Pending: the compiler emitting `config.stations`
  (the authoritative allow-list players enforce). Today's fallback is disjoint ids (§3).
- **Station kinds 2–5** state machines (powerup/extraction/bomb/control) — build order in
  `docs/utility-roadmap.md` (K1 control point first). **MC muster / arming assignment is FOLLOWUPS S5** (brx).
- iOS build + test of `BrxBeaconPlugin.swift` on the MacBook (the superseded-start + power-toggle re-assert
  paths are written but unbuilt).
- Bench-tuned defaults are -74 dBm / 0.8 s / high TX (§3); revisit per station-kind (an extraction zone wants
  a looser, bigger bubble than a respawn point).
