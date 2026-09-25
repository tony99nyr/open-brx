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

Both roles run the same BLE stack. In a game with stations on the field, a HUD phone keeps the scan open for
the whole match and **also advertises itself as a player**; in a game without stations it does neither
(see *Scan budget* below). A utility phone advertises itself as a station and scans
for players. No connections between phones, ever: adverts are broadcast state, so any number of phones read
them and the Android 7-connection cap is irrelevant.

Switching: `localStorage brx.role`; the HUD exposes `hud.h.onUtility` (the HUD session adds the control; until
then 7 taps on the idle stage within 3 s, held on the last one); the utility screen has BACK TO HUD, behind the
same seven-tap-on-ⓘ gate as the rest of its settings drawer (kind/team/id/threshold — the anti-cheat concern,
so a player cannot wander in and fiddle with a deployed station mid-game). Leaving utility mode is NOT that
concern: getting back to your own HUD is rejoining the game you are locked out of, not a cheat. **A41
(2026-09-13, field: the seven-tap gate was the ONLY way out, with zero feedback and no MC-side cure)** adds
two more exits that touch nothing in the drawer: a plain, HELD `#exitHud` control on the utility screen's main
view, shown only while nobody has claimed this phone as a field item yet AND it is not already broadcasting as
one (`!mcArmed && !advertising` — a station stays behind the seven-tap gate exactly as before, whether MC
armed it or an operator armed it BY HAND in the drawer, and a LIVE station stays there too: hiding is the
only guard, since the hold handler asks nothing but whether the button is hidden); and an operator's MC-side release,
`control{cmd:"release_utility"}` (§5c), which works on a deployed station too, in any phase.

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
                            player: bit0 alive, bit1 planting, bit2 defusing, bit3 extracting,
                            bit4 claiming, bit5 claim_ready (A56, powerups.md),
                            bit6 revived: "revived at the station in `value`", read by the StickS3, post-MVP (F344))
      11    value          kind-specific small number (seconds left, cooldown, progress %; a claiming player: the station id)
      12    seq            bumps on every state change (a scanner tells fresh from stale)
      13    game           the match's game byte from MC (station_config.game = config.game_byte, A59) · 0 = any game
      14    threshold      the station's own "you are AT me" RSSI, int8 dBm · 0 = scanner default
      15    taker          a powerup station: the player_num that took the item (A56) · 0 = none / other kinds
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

**Respawn range: 3 m at most (Tony, 2026-09-24; F345).** Measured at 3 m on the player phone: a phone station reads
-63 to -68 dBm, a StickS3 -53 to -58 (the Stick transmits hotter). So the default is **per platform**. Tony then walked both stations at 3-5 m and set the defaults (2026-09-24, "the stick actually works
better"): a phone station **-70 dBm**, a StickS3 **-57 dBm** (`beacon.js RESPAWN_RSSI_DBM`; the Stick's copy is
`hardware/m5sticks3/station_link.h STICK_DEFAULT_THRESHOLD_DBM`, since `8d5e6d13`: non-control Stick kinds resolve 0 to -57 and advertise -57). The other kinds on a phone station keep the
2026-09-04 bench value, -74 dBm at high TX (about 10 ft). MC's `StationAssignment.threshold` still overrides; **0**
(or absent) means the station's own default, which it resolves and advertises in byte 14. A phone app older than
0.4.12 clamped 0 to -30, so MC sends such a phone the explicit value (`state.py _wire_threshold`). A player phone falls
back to its own `Presence` default (-74, `app.js`) only for an advert whose byte 14 is 0; an MC-armed station never
sends that. Dwell stays **0.8 s** on both sides.

**The revive count (F344).** A respawn station counts a revive when a player's alive bit goes 0 → 1 while the
station hears them **near**: the median of the last 3 readings at or above its threshold minus
`REVIVE_MARGIN_DB` (10). It does not use `present`. It counts only a player of its own team (any player at a
neutral station), and only after it has seen that player die this game, so go-live and a resync never count. The player decides the revive on the station's HIGH-TX advert,
and the station hears the player's MEDIUM-TX advert, about 8 dB weaker; `present` also adds a dwell behind the EMA.
Field 2026-09-24: a phone station at -74 counted neither of two revives at it. The StickS3 (`presence.h
ReviveCounter`) also counts, with no RSSI, on the rising edge of the player's state bit 6 `PLAYER_REVIVED` with
`value` = its own id, and uses only that rule for a phone that has ever set the bit. No phone on main sets it, and
the Stick's revive feedback is off (`REVIVE_FEEDBACK_ENABLED`).

**Scan reliability (Android):** a BLE scan left running goes silently deaf — `scanning` stays true but callbacks stop (hardware 2026-09-04: a down player at the station saw "find a respawn station" until a fresh scan was forced). `app.js` fights this: scan at low-latency, kick a fresh scan the instant the player goes DOWN, and restart every **7 s** while hunting a station (slower otherwise). 7 s keeps the death-kick + steady restarts under Android's ~5-starts-per-30 s throttle; a scan that dies mid-match is restarted on the next tick (the intent flag `beaconWanted`), so a single failed start can't freeze presence for the game.

**Scan budget (bench 2026-09-16/17):** the Capacitor BLE plugin sends every scan result to JS over the channel that
also carries gun notifications and call replies. A Pixel 5 took ~57 results/s in a plain TDM, skipped frames and
answered gun writes seconds late. The rules now, all in `app/src/scanwatch.js`:
- **No stations, no scan, no player advert.** `stationsInPlay(config)` is true only for `respawn.type: "scanner"`,
  `station_source: "phone"`, or a non-empty `config.stations`.
- **No native filter exists for our adverts.** The identity UUID changes with the station's state, the plugin
  matches service UUIDs exactly, and the advert has no name or manufacturer data. The bridge still carries every
  advert in range while the scan is open.
- **JS samples each device at most every 250 ms** (4/s), the rate `presenceTick` reads it at: 3 samples inside the
  0.8 s dwell, 16 inside the 4 s expiry.
- **A flood guard** counts raw results over a 2 s window. Above **25/s** (two stations at low latency plus a few
  players) the HUD scan closes for 5 s and reopens one mode lower (low latency, balanced, low power), and steps back
  up after a quiet minute. A DOWN scanner-respawn player never drops below balanced and is never paused. A utility
  station drops only to balanced. The rate, peak and back-off count ride in the diagnostic bundle
  (`--- ble beacon scan ---`).

**What radio cannot give:** a shape. The bubble is a fuzzy sphere: it leaks through drywall, shrinks behind a
body, and is not directional. That is why the respawn gate below requires an act, not just proximity. For
area effects (blast, extraction zone) the fuzziness is acceptable. A hard edge needs line of sight, which is
the QR-on-screen method — a last resort, not built.

**Security posture (be honest):** adverts are **unauthenticated** — any BLE device can broadcast one, and the station *dictates* its own team and "at me" threshold to every player. So the only real gates on a revive are: the gun must be **physically dead**, the player must **pull the trigger**, and the station id must be on the game's `config.stations` **allow-list** (small integers — weak). A determined player can carry a second phone in utility role advertising a team-matched station with `threshold:-100` and revive themselves anywhere. This is an **accepted casual-threat tradeoff** (friends on a LAN), not a proximity *guarantee*. The `game` byte scopes presence to one match (a station on a different non-zero game byte is ignored) but is **best-effort**: manual stations default to game 0 ("any"), so two nearby games with hand-armed stations must use **disjoint station ids**. MC-armed stations and players share MC's byte (§5c, A59). For a hard, un-spoofable edge, the QR-on-screen method is the only option.

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
- **`presence`**: dwelling there past the delay is enough (a mode's choice). Only the node reads `gate` today:
  MC has no field for it (`types.Respawn`) and drops the key at `PUT /api/config`, so every MC game plays `trigger`.

On revive the node writes `frames.revive` exactly as an auto respawn does, and the `respawn` fact carries
**`station: <id>`** (A13.2). Auto and none modes ignore stations entirely.

**Station profile (A49, 2026-09-19).** A bundle with `respawn_profile` revives at a station with
`respawn_profile.revive_station` instead: protected for `respawn.station_protect_s` (0 / 2 / 3 s, default 2), the
trigger live at once so the spawner can clear campers, and a white shield blink on the headset for the window. A shot
does not end the protection. At the end of the window the node writes `spawn_protect_off`, then `shield_off`.

### 4.2 Engine surface (`engine.js`)
`setStations(entries)` from the app every 250 ms · `state().station` = `{id, kind, team, state, value, rssi,
threshold, present}` of the station this player would use (present first, else strongest) · `state().respawnGate`
· `state().respawnHint` ∈ `timer | find_station | approach | hold | pull_trigger | reviving | out | null`.
`setStations` re-renders only when id / presence / rounded RSSI change. Tests: `engine.test.mjs`
"utility items" block (trigger gate, delay, wrong team, neutral, allow-list, disabled station, presence gate,
auto mode untouched, re-render economy).

### 4.3 DOWN screen (HUD session)
Scanner mode replaces the countdown with the hint (shipped copy, `hud.js`): **HEAD TO YOUR TEAM'S RESPAWN
STATION** with the sub-label THEN PULL THE TRIGGER (trigger gate) or AND STAND THERE (presence gate) (none
in range) → **GET CLOSER** with a closeness bar and STATION IN RANGE · the live RSSI / threshold (approach) → **HOLD…** · AT THE
STATION · ALMOST THERE (present, the respawn delay still running) → **PULL THE TRIGGER TO RESPAWN** (trigger
gate) or **RESPAWNING…** (presence gate) → REDEPLOY moment on revive. Timer phase shows the delay countdown as today.
The trigger-vs-presence copy is selected by the engine's `respawnGate` getter, so the HUD never re-derives the
gate from config (commit 0ac162b).

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
| control | owner by team over time | present counts for your team | **specified in §5d** (net-difference presence capture); shoot-to-capture stays the grenade's, and cannot be bridged to a phone station (F92) |

## 5b. MC setup, arming, and placement

**Setup needs WiFi; play does not.** A utility phone joins MC at muster like a node — `hello` with
`role:"utility"` (and its current id/kind/team if it has any). Once the match is live a station is a
passive beacon: it needs **no** MC contact for the rest of the game (same island rule as a player node).

1. **Assign at muster (WiFi).** MC's KIT/muster gains an **ITEMS** panel beside the roster: the operator
   sets each utility phone's **kind / team / threshold**, and MC gives it a **station id** (A66: the next free id,
   unique across phones and Sticks, kept for that node_id across its restart, a relink and an MC restart; the
   console shows it read-only). MC pushes **`station_config`** to the
   phone (M-NET, §5c); the phone applies it, shows **MC ✓ GAME N**, and **locks its controls**
   (the on-device 7-tap gate stays only as a no-WiFi/field-fix fallback). The game bundle carries
   `config.stations` = the allow-list of ids MC handed out, so a player phone only honours those ids.
2. **Placement BEFORE start, not inside the countdown.** Stations advertise from the moment MC arms them;
   presence is irrelevant until players are live. Flow: assign at muster → operators carry the phones out
   and prop them → back at MC, start the match with the normal runway. **Putting placement inside the
   countdown only creates a race** — a station not yet in place when the match goes live simply revives
   nobody until it arrives. No failure mode, no countdown coupling.
   **A pickup Stick is the exception (F374, 2026-09-25):** it learns the go-live anchor for `first_at_s` only from
   MC's `station_update` at START. Keep it in Wi-Fi until START is pressed. One carried out
   earlier offers its item from go-live, not at `first_at_s`.
3. **Between games: stations do NOT walk back** unless their role/team changes. Revive counts are
   self-authoritative and report at recap when the phone is next in WiFi range (§5). Re-arm over WiFi
   only when the operator changes something. **Scoping caveat (v1):** the advert `game` byte would let a
   stale station be ignored the moment a new bundle reaches the players — but the station must LEARN the
   new game number, which needs MC contact. So **v1 keeps station adverts at `game 0` (any game) and
   relies on the id allow-list**: same ids, same stations, no walk-back. Per-match `game` scoping arrives
   with `station_config` carrying the game number (a station in WiFi range at each start picks it up).
4. **Station status copy** (quiet unless it matters, Tony 2026-09-24): **"MC ✓ GAME N"** once the push lands;
   linked but not yet armed, **"WAITING FOR MC TO ARM IT"**; linked and on the air WITHOUT the push, the warning
   **"SET BY HAND · PLAYERS MAY IGNORE IT"** (player phones check the game byte the push sets); no MC at all, nothing
   (a hand-set station on its own is valid). The 7-tap manual path stays for a WiFi-less field.

## 5c. `station_config` (M-NET, MC → utility phone) — the arming message

**"phone" here is the first client, not a requirement.** A non-phone utility node (the M5StickS3) takes the
same message over the same wire with no amendment: **§5g**.

`{ kind, team, id, threshold?, game?, valid_ids?, lock_s?, starts_in_ms?, ends_in_ms? }` — MC → the utility node at muster (and on any re-arm).

**A58 Stick lock persistence:** the Stick saves the lock's remaining seconds to NVS when a lock starts and at most once per five minutes while it runs. On boot it restores at most 120 seconds for the saved game byte and restores the PMIC side-button lock before Wi-Fi starts. The cap limits an old offline snapshot because no clock runs while the Stick is off. An ordinary restart does not clear the lock. A+B held for 7 s clears the saved lock before the force restart. MC `lock_s: 0` also clears it.
The phone applies it to its advert, sets MC-ARMED, and locks the config drawer. `valid_ids` (optional) is
the allow-list echoed for the station's own display; the authoritative allow-list players enforce is
`config.stations` in the game bundle. Absent `game` = 0 (any). This is a **contracts A13.5** addition.

**Range edited on the station, last edit wins (A67, F365).** An operator can change a station's RANGE (threshold)
and STRENGTH (`tx_power`: `ultra_low`, `low`, `medium`, `high`) on the Stick itself behind a long hold, only while its station lock is unlocked. A phone station keeps its existing behaviour. The station applies it at once and reports it on every heartbeat: `threshold`/`tx_power` (applied now; a phone
that cannot set its power, iOS, sends no `tx_power` and records no STRENGTH edit),
`<field>_src` (`station` or `mc`), `<field>_edit_age_ms` (src station only) and `range_edits` (the last 8 edits,
`seq` persisted across a reboot). MC keeps who set each value and when. A station edit newer than MC's value is
adopted; an operator edit in the ITEMS card after it wins and re-arms the station. `station_config` carries
`threshold_age_ms` (and `tx_power` with `tx_power_age_ms` once MC holds one): the station keeps its own edit only
when that edit is younger. An edit made out of Wi-Fi syncs when the station returns. After a StickS3 reboot the
Stick cannot know the edit's time, so it reports a large age and MC's value wins at the next arm. Players need no
change: they read the station's advert. Each new edit is a feed line and an attention line on the ITEMS card.


**Hill timing (A68, Stick hill).** MC sends `starts_in_ms` and `ends_in_ms` in the same station config whenever it knows those times. Each value is relative to MC send time; `starts_in_ms` can be negative after go-live. A future or unknown go-live keeps a same-game hill waiting, neutral and without accrual. MUSTER releases that wait on a config with `starts_in_ms`, including an untimed START. A same-game config without either time means no match is running. The hill counts only from local go-live to its local deadline, then freezes its owner, bar and possession tally and shows MATCH OVER. At match end, RECALL or PANIC, MC sends `ends_in_ms: 0` to connected stations and on reconnect. After abort, the same-game config omits both times and returns the hill to waiting. MC sends no `station_update` for a hill. A MUSTER Stick that takes F374's 60 s offline fallback without hearing START starts counting as before; it cannot know go-live or enforce the deadline. An early score cap or operator END reaches only a Stick still in Wi-Fi. An adopted match pushes nothing to stations, so its Stick hill receives no go-live or deadline and counts as before.

**One game byte per match (A59, F339).** `game` is MC's match counter (1..255, bumped by the first push after a
match has started). Every player `config` MC sends carries the same number as `config.game_byte`, so a player
phone scopes presence and its own advert by the byte its stations advertise (`beacon.js configGameByte`). A
config without it (an older MC) reads 0, any game. Before A59 the player hashed its `config_id`, and every
MC-armed station and every player ignored each other.

Mission Control drives all of the §5 kinds from the ITEMS panel (§5b); stations are self-authoritative and
report at recap (MC is not live mid-match). (A duplicate of the §5 table that sat here as §5d was removed
2026-09-06; the roadmap's older "§5d" references mean §5. **§5d below is the control-point spec**, added
and the roaming-hill variant is `utility-roadmap.md` §8 5e.)

### 5c.1 `control{cmd:"release_utility"}` (M-NET, MC → utility phone) — the release message (A41)

`{ cmd: "release_utility" }`, on the ordinary `control` kind (contracts.md §5, `CONTROL_CMDS`) — MC → ONE
utility node, any phase. Unlike `station_config` this carries no station fields: `utility.js` takes it exactly
as its own BACK TO HUD button (`brx.role` → `'hud'`, reload into the HUD). It is the field cure for a phone
stuck in utility mode (§1): an operator
presses RELEASE ▸ HUD on the ITEMS card (`state.py release_station`, `POST /api/stations/{nid}/release`).
Best-effort like `station_config` — no ack kind exists for `control`, so the API's `ok` means only that a
socket took the push, never that the phone actually reloaded; a phone with no socket has only its own
seven-tap ⓘ gesture left. Deliberately NOT `_refuse_station_change_in_play`-gated: a stranded phone needs
releasing in every phase, armed/live most of all. A failed send changes nothing. An accepted send clears the
assignment and active allow-lists, but retains the ITEMS card because delivery alone cannot prove the reload.
The first HUD `hello` carries the prior utility id and its takeover key; MC validates and consumes that proof,
then removes the old card. Utility and HUD ids are deliberately distinct (`brxu` / `brx`). If this happens
mid-match, the station's last self-authoritative report remains frozen for that match's recap. A pre-F184 HUD
cannot send the proof: release still works safely, but the unassigned old card remains until the stale-row prune,
an operator evicts the old node, or the updated phone makes a fresh utility→HUD round trip; it never counts as a
deployed station in the meantime.

## 5d. kind 5 `control` — the phone control point (K1 base)

**Status: designed, not built.** Tony's design call, dictated 2026-09-10. This section is the spec of record for
`kind 5`; the §5 table row ("owner by team over time · present counts for your team") is the one-line summary and
this is the rule. Build row: `docs/utility-roadmap.md` K1. **Everything in §5d works with no LAN at all** — the
Wi-Fi-coupled extensions are `utility-roadmap.md` §8 5e and are a separate, opt-in mode.

### 5d.1 The rule: capture rate is the NET DIFFERENCE of living present players

A control point is captured by **presence**, and the rate is the **net difference** between the leading team and
its **largest single rival** (Tony, 2026-09-10: *"against largest single rival, yeah"*):

```
leader = the team with the most LIVING PRESENT players   (a tie for the lead -> net 0)
net    = leader's count - the LARGEST SINGLE OTHER team's count      (not the sum of the others)
rate   = net * 100 / capture_s        progress points per second; net 0 means no movement
```

| present | net | behaviour |
|---|---|---|
| 1 v 0 | 1 | converts at the base rate: `capture_s` seconds per phase |
| 2 v 0 | 2 | **twice** the rate |
| 2 v 1 | 1 | "2v1 only counts as the 1" (Tony) — the defender cancels one attacker |
| 1 v 1 | 0 | stalled |
| **2 v 1 v 1** | **1** | the pair converts, **slowly** — two opponents on two different teams do NOT stall a pair |
| 2 v 2 v 1 | 0 | stalled — only a single rival team of equal size can stall you |
| 3 v 2 v 1 | 1 | converts |
| nobody | 0 | progress holds; the owner keeps scoring |

**"Largest single other team", never the sum.** Only a single rival of equal size can stall you; two opponents
split across two teams must not be able to. This has to be written out because in a **two-team game the two
readings are identical** — every 2v2 example is silent about which rule is in force, so the rule cannot be left to
be inferred from them.

**`net` is never negative**, because the leader is by definition the largest. So progress only ever moves in the
leader's favour, and a point is never drained by anybody except whoever is currently leading on it. In an **FFA**
(every player their own team, **F97**) that is the sensible behaviour rather than an accident: a lone holder facing
two separate rivals nets 1 - 1 = 0, so the point **stalls** instead of draining, and a player must be **alone** on
the point to convert it. ⚠ FFA KotH **caps at three players** (Tony, 2026-09-10): four teams exist, F82 removes
tid 2, leaving tids 0/1/3, and a fourth player forces tid 2 or the forbidden tid 4 (**F96**).

**This is net difference, not a freeze-on-contested rule.** An even fight stalls because the arithmetic says so,
not because a special case says so, and one extra body always moves the needle. A **down** player counts for
nothing (the station reads `alive` from the player advert, byte 10 bit 0 — already decoded and already rendered),
and a present-but-dead player is a body that does not help: reviving matters on the point.

`net` is clamped to `net_cap` (**proposed default 3**, tunable, not measured) so a six-player rush is fast and
not instant.

### 5d.2 Two-phase conversion: drain to neutral, then build

An enemy-held point does **not** flip. It is drained to neutral, then built up for the claimant, on one 0-100
scale so it fits advert byte 11:

| byte 10 `held` | byte 9 `team` is… | what `value` means | how it moves |
|---|---|---|---|
| **set** | the **owner** | how much of the owner's hold remains; 100 = fully held | enemy net drains it; the owner's own net rebuilds it. At **0** the `held` flag clears and the point is neutral, `value` 0 |
| **clear** | the **claimant** building it up (255 = nobody is) | how far that claimant has built; 0 = fully neutral | the claimant's net builds it; net against it drains it back. At **100** `held` sets and that tid owns it |

**`held` is what makes byte 9 readable**, and it is the one flag a reader cannot skip: the same tid in byte 9 means
"this team owns the point" with `held` set and "this team is *taking* it" with `held` clear. A reader that ignores
`held` hands the point to whoever is merely walking onto it. `engine.js`'s `_onControlAdvert()` gets this right —
`owner = (held && team <= 3) ? team : neutral` — and that line is the model everything downstream shares.

So a full enemy-to-own conversion costs `2 * capture_s` at net +1, and two phases give the defender a real chance
to arrive in the middle of it. **Only the team named in byte 9 scores** (possession seconds, or a Domination point
per second); progress itself scores nothing. **Neutral pays nobody** (`utility-roadmap.md` §8 5f.6).

⚠ **Team 2 (F82).** A hill mode must not put anyone on tid 2 — that constraint comes from the grenade's polarity
gate, not from this advert, but a park will run both objectives, so MC's team assignment (0, 1, 3) is the same
either way.

### 5d.3 The advert (no new bytes)

`kind 5` uses the §2 advert as it stands. The station id in **bytes 6-7** is what makes multi-point Domination
possible on phones and impossible on grenades (F88: a grenade beacon carries no id at all).

**Byte 10 is INDEPENDENT FLAGS, not a packed bitfield** — `CONTROL_STATE` in `app/src/control.js`, written by
`ControlPoint.advert()` and read by `engine.js`'s `_onControlAdvert()`, which imports the same constant rather
than restating the bit values. This is
the wire. It is stated here explicitly so that nobody, reading an earlier draft of this section, "fixes" the code
toward prose that was never shipped.

| byte | kind 5 meaning |
|---|---|
| 8 `kind` | **5** |
| 9 `team` | the **owner** when `held` is set, the **claimant** when it is clear, **255 = nobody** (§5d.2) |
| 10 `state` | flags, OR-ed: **`held` 1** (byte 9 is an owner, not a claimant) · **`contested` 2** (living present players of two or more teams) · **`rising` 4** (`value` climbing) · **`falling` 8** (`value` dropping). Bits 4-7 spare — **`hot` (roaming hills, `utility-roadmap.md` §8 5e) takes 16** when that variant is built |
| 11 `value` | **progress 0-100**, read per the §5d.2 table |
| 12 `seq` | bumps on every change of `team`, the flags or `value` — a phone one-shots its callouts off this |
| 15 `reserved` → `rate` | **specified, not yet emitted.** `advert()` returns `{team, state, value}` today. The intent is the clamped `net` (0..`net_cap`) so a screen can show speed without re-deriving it; it needs no sign, since `net` is never negative (§5d.1). A station's own screen has something better locally — `control.js timeToChange()`, the seconds until the point actually flips, which is the number a defender reads — so this byte is only worth emitting once a *player* HUD wants it |

⚠ **A reader must treat `rising && falling` as INVALID** and fall back to neither. This is the one virtue the
packed-bitfield draft had and it does not survive into flags for free: two bits *can* both be set, where a 2-bit
phase field made the contradiction unrepresentable. Our own station never emits it (`ControlPoint.advert()` sets the two direction bits in one `if`/`else if`), but **adverts are unauthenticated** (§3) — a buggy or hostile station can set both, and a reader
that trusts whichever flag it happens to test first will show a point moving the wrong way. Check for both, then
treat direction as unknown.

**Why flags and not packing** (recorded so the question is not reopened): the implementation is shipped and
self-consistent, writer and reader sharing one constant; `mcp/brx_mcp/stage/stage.py` must mirror `engine.js`
whatever it does, so the code is the de-facto contract; and the packing bought nothing — byte 10 has eight bits and
the flags use four. The spec was the stale side here, not the code.

**Byte 10's meaning is KIND-SCOPED**, as it already is throughout §2 (respawn uses 1 ready / 0 disabled, bomb uses
0-3, a player advert uses it for alive/planting/defusing/extracting bits). So `kind 5`'s flags cannot collide with
another kind's use of the same offset: a reader that has not first checked byte 8 is reading the wrong record.

**Byte 15 is role-scoped and does not collide with F93/F92.** This is the **station** advert (byte 5 `role` = 1);
F93's note about byte 15 being the cheap spare for relaying grenade-hill ownership phone-to-phone concerns the
**player** advert (`role` = 2). Same offset, different records, no contention.

**What the 16 bytes cannot carry, and where those facts live instead:**

| fact | where it lives |
|---|---|
| **who** is contributing (ids, teams, alive) | the station's own screen only (§5d.4). The station knows it from player adverts; it cannot fan a per-player list out in 16 bytes, and no player phone needs it |
| **hold time / possession seconds** | each node's own clock, exactly as the grenade hill does it (`utility-roadmap.md` "presence is a heartbeat, and timing is node-side"). The old K1 sketch put "seconds held" in `value`; `value` is progress now, permanently, and hold time never rides in the advert |
| **a running score** across several points, and **points-to-win** | nowhere offline. This is the whole reason the roaming-hill variant exists (`utility-roadmap.md` §8 5e) |

### 5d.4 The station screen ANIMATES the contest and the transition

Static numbers are not enough: **a defender must be able to tell "you are losing this, get help" at a glance.**
The screen builds on what `utility.js` already renders.

Round 3 (Tony, 2026-09-24: "the animation should explain what's happening. less labels and icons"): the bar and its
sentences are gone. ONE ring around ONE big word carries the meaning; the only other text is the % line.

| element | what it does |
|---|---|
| **owner colour** | the page themes itself from the **live owner** (`render()` sets `document.documentElement.dataset.team`); **neutral is its own look** (grey), never a team colour. The big word in the ring is the owner, or NEUTRAL |
| **the ring's fill** | the HOLDER's colour fills the ring to `value` (the claimant while it builds, the owner while it drains: whoever byte 9 names), and the rival's colour creeps into the rest while it drains or is contested |
| **direction and rate** | a bright sweep runs round the ring the way the point is moving: clockwise while it gains, anticlockwise while it drains; its speed follows the station's own `net` |
| **stalled / contested** | the fill freezes, the sweep stops, and the two teams' colours pulse against each other at the frontier (where the fill stopped) |
| **neutral / held** | neutral: a dim ring turning slowly. Held: the full ring in the owner's colour, breathing |
| **the transition** | a one-shot burst of the new owner's colour over the whole screen, and a word inside the ring in place of the % line: **NEUTRAL** when the drain completes, **CAPTURED BY <team>** when the build completes |
| **the % line** | the one small line under the word, readable from 2 m. The seconds-to-flip sentence, the arrow, the rate and the CONTESTED band are retired (the ring shows each of them) |
| **who is contributing** | the roster (P-id · team · RSSI · ALIVE/DOWN · ON POINT), folded away by default behind SHOW PLAYERS: living + present = counted, team colour; **DOWN** = struck through; in range but not present = dimmed; tid 2 = CAN'T HOLD |
| **the tally** | possession seconds per team, persisted (§5d.6), at the foot of the roster, so the screen is still the recap sheet |
| **motion rules** | transform and opacity only (compositor work, no per-frame JS); `prefers-reduced-motion` gets a static glow |

### 5d.5 The guns say the right thing per team — and this needs NO LAN

⭐ **This is the difference between the mode working on a field and not.** In a game with phone control points, every HUD phone
keeps a scan open for the whole match and feeds every OBRX advert into the presence tracker (`app/src/app.js:121`),
and stations are already surfaced to the engine (`app.js`'s `presenceTick()`, `presence.stations()` → `engine.setStations`).
So a player phone **reads the control point's own advert** — `team`, `value`, `seq`, the contested bit — and plays
its own callout on its own gun, locally, over its own BLE link. **No LAN, no MC, no peer connection, no server in
the path.** Radio reach is the only requirement, and the point is broadcasting anyway.

**The callout set is closed: these five ids and nothing else.** All five are in `app/src/engine.js` (`HILL_CUES`)
and all five were **confirmed by ear** 2026-09-10. `VB0N` "Hill Captured" covers both the capture moment and the
"your team controls this" announcement — **Tony's call: there is no separate "hill controlled" line and none is
wanted**, so nothing here needs a catalogue search.

⚠ **And do not go looking for one by name.** `V8Q` is catalogued as "Hill Confirmed" and **says "*Kill*
Confirmed" by ear** — it is a hill line in the catalogue and not one in reality. That trap is exactly why the five
below are trustworthy and nothing outside this table is: a candidate found by catalogue name must be **heard**
before it is used.

⚠ **Every transition below is on the DECODED owner** — `held ? team : nobody` (§5d.2, `engine.js`'s
`_onControlAdvert()`) — never on
raw byte 9, which carries a *claimant* while the point is unheld. Announcing off byte 9 alone would shout "Hill
Captured" the moment someone walked on.

| transition (on a `seq` bump) | the listener's team | plays |
|---|---|---|
| decoded owner: nobody → mine, or an enemy tid → mine | the new owner | **`VB0N` "Hill Captured"** (1.92 s) |
| decoded owner: mine → nobody (the drain completed) | the team that just lost it | **`VB0P` "Hill Lost!"** (2.98 s) |
| contested bit 0 → 1 with my team involved | both sides | **`VB0O` "Hill Contested"** (2.08 s) |
| `team` == my team, on the node's own ~1 s timer | the holder | **`U100`** possession tick (0.11 s) |
| a capture between two **other** teams | everyone else | **silence** — not this player's event |
| the hot point moves (**roaming hills only**) | everyone | **`VB0Q` "Hill Moved"** (2.42 s) |

**The listener's team picks the line, not the wire event** — the same rule `engine.js:_hillCallout` already
implements for the grenade path, reused verbatim. "Hill Lost!" fires the moment the point stops being yours (the
drain completing), which is the moment the defender needs to hear it; the attacker's "Hill Captured" comes later,
when the build completes. Two teams, two moments, one scale.

⭐ **`VB0O` "Hill Contested" is unlocked by the phone path specifically.** On the grenade path it cannot be
wired at all: **F75** — a non-capturing IR hit emits nothing decodable, so contest can only be guessed at from
*I fired* + *enemy hill in range* + *no capture word*, which cannot tell a hit from a miss. `HILL_CUES.hill_contested`
therefore sits in the engine today with **no caller**. A phone control point **measures** contest instead of
inferring it — it counts living present bodies of each team and says so in a bit — so this is the first path on
which the cue has a truthful caller. That is a reason to build the phone point even where a grenade is available.

⚠ **Limits to state, not to promise around:**
- **One-shot per transition, never per advert.** F74's lesson (this gun really does replay long events) plus a
  station advertising several times a second: a 2-3 s callout fired on every advert stacks instantly. Callouts fire
  on a `seq` change only, with a floor between repeats of the same line (**proposed 10 s** for contested, which can
  otherwise oscillate at net 0).
- **The scheduling rule is the phone's, it already exists, and the animated screen does not replace it.** These are
  1.9-3.0 s clips against a 1 s tick cadence, so: a callout **owns the announcer for the clip's real length** and
  the tick **waits** rather than playing underneath it (`engine.js`'s `_hillBusyUntil`, set in `_hillSay()` and honoured in `_hillTick()`), and a later
  callout **preempts outright — it never queues** (`_hillSay` sends `$PLAYX,0,*` in the same write, and only ever
  cuts off our own in-flight hill line). Both are implemented, commit `4348721`. A queued "Hill Captured" landing
  three seconds after the point was already lost would state something false; the newest word is always the true
  one. `U100` is safe at 1 s only because it is 0.11 s long and yields to every callout. §5d.4's animation is
  **additive to this**: the screen can show a transition continuously, the gun cannot.
- **The callout's reach is the advert's radio reach**, which is neither the 10 ft presence bubble nor the whole
  field — roughly tens of metres, body-blocked and uneven. So a capture is heard by whoever is near the fight, not
  by the far side of the park. Native's field-wide announcement is not reproducible offline; the roaming-hill variant can fan it out
  best-effort through MC, and per `hud-driven-events` nothing ever waits on that.
- **Freshness is the §3 presence rule** (`expiryMs` 4 s), not the grenade's 12 s / two-missed-beacons rule. That
  rule exists because the grenade beacons once per ~5 s; a BLE station advertises continuously.

### 5d.6 Progress persists, and the station is self-authoritative

The station owns its own state and answers to nobody mid-match (§5c: *stations are self-authoritative and report
at recap; MC is not live mid-match*). `utility.js` already persists role and settings in `localStorage`
(the `brx.utility` key); `kind 5` adds **`brx.station.control`**: the `control.js` model as it stands — `owner`,
`capturing`, `progress`, `contested`, `dir`, `net` — plus `seq`, possession seconds per team, and the capture log
(`{t, from, to}`). Written on every change, read at startup, so a
phone that reboots, is force-closed or runs out of browser under it comes back holding the point it held — the
same "live after a reload" property the respawn station already has.

At recap the station reports its tally and capture log to MC when it is next in Wi-Fi range (roadmap A6's stations
row: the station's own count against the players' `capture` facts, ✓ when they agree, ⚠ when the station was
never heard). **MC is never asked for the answer mid-match, and never asked to arbitrate between two stations.**

### 5d.7 Hill audio is the NODE's job, and this is the algorithm

The gun cannot speak on a beacon. `$SIR` is keyed on `<irProtocol, subtype>` alone, every hill word decodes to
the same key `<15,0>`, and the shipped function (fn 28) **ignores the row's `<soundID>` outright** (measured
2026-09-10). One cell cannot hold four sounds, so the four team-aware callouts — `VB0N` Hill Captured, `VB0P`
Hill Lost, `VB0O` Hill Contested and the `U100` possession tick — are played by the player's own phone.
`engine.js:_hillCallout` implements what follows; the evidence is `utility-roadmap.md` §7.

- **A beacon updates state, it never plays.** Every `$HIR,<sensor>,15,0,<owner>,<mode>,0,0` sets two fields,
  **`hill_owner`** and **`last_beacon_at`**. Nothing sounds here.
- **A separate ~1 s timer plays the tick.** It fires `U100` while `hill_owner == my_team` and the beacon is
  fresh. This is the only source of the possession tick; it cannot ride the beacon, which arrives once per ~5 s.
- **Presence expires on ≥ 2 missed beacons (~12 s), never one.** The beacon goes intermittent at the edge of
  range, so a single miss is normal reception, not "left the hill".
- **Announce a capture on `mag=50` alone.** Never wait for `mag=53`: on an enemy-to-enemy capture it never
  arrives, so a node gated on both words would never announce that class of capture at all.
- **The LISTENER'S TEAM picks the callout, not the magnitude.** One wire event, different audio per listener:
  the same `mag=50` frame is `VB0N` **Hill Captured** to the team named in it and `VB0P` **Hill Lost** to the
  team that just lost it. A capture between two other teams is deliberately silent.
- **`mag=53` says WHERE the point came from, not who says what.** Present = it was neutral before, absent = it
  was stolen from an enemy. Both are "captured" for the taker and "lost" for the loser, so it is available for
  flavour and for scoring, never for choosing between the two callouts. ⚠ Nothing may WAIT for it.
- ⚠ **`VB0O` "Hill Contested" is not wired.** A non-capturing hit emits nothing decodable (F75), so contest
  cannot be detected, only guessed, and a guess cannot tell a hit from a miss.
- ⚠ **Never queue a multi-second sequence off a beacon.** A beacon repeats every ~5 s, and this gun really does
  replay long events (F74): a 15 s clip fired on three consecutive beacons stacks three deep. `U100` is chosen
  because it is ~0.1 s and cannot overlap its own 1 s cadence; a capture callout is one-shot per transition.

## 5e / 5f. Roaming hills and TERRITORIES — designed, not built

Two full designs that build on §5d and ship nothing today: **5e roaming hills**, the opt-in LAN-coupled
variant and a deliberate exception to A4.8 (F95), and **5f TERRITORIES**, multi-point scoring where each
station keeps its own books and needs no LAN at all (F98). Both live in
[`../utility-roadmap.md`](../utility-roadmap.md) §8, under the same 5e / 5f numbers. Promote them back here as
they are built.

## 5g. A NON-PHONE utility node: the M5StickS3 armed over Wi-Fi (H8)

**Status: built 2026-09-24, flashed and bench-run the same day** (the Stick runbook's pickup, hill and respawn
blocks; `docs/experiment-log/`). What the bench has not yet exercised is marked "bench to confirm" where it is
described. `hardware/m5sticks3/station_link.h`
(+ `json_lite.h`, `station_ui.h`) implement §5g.2's minimum client: hello/welcome/station_config,
the two association modes below, and the powerup schedule and CLAIM award (A56, `docs/spec/powerups.md`),
host-tested in `hardware/m5sticks3/test/`. An MC-side test (`mcp/tests/test_utility_esp32.py`)
drives a real `Session` with the exact JSON the firmware builds. `hardware/m5sticks3/mc_link_glue.h`
is the Arduino plumbing (Wi-Fi, mDNS, WebSocket, BLE claim-scanning) and compiles clean against the
real ESP32-S3 toolchain. Everything else in this section, the bench behaviour of any of it, is
**Tony's to confirm**; see `hardware/m5sticks3/README.md` §"Mission Control link (H8)" for the full
bench-to-confirm list and steps. 2026-09-14, Tony's call: program the Stick at Mission Control during
setup, then carry it out and place it. This section is the spec of record for a utility node that is
**not** a phone. It changes no wire (A56's `station_config.item` and `station_update` are additive,
and its advert byte 15 `taker` was previously a fixed pad byte); it is written down because every
sentence in §5b/§5c says "phone", and the next reader needs to know which of those words are
load-bearing and which are just the first client we happened to build.

### 5g.1 The wire already admits it — there is nothing to amend

A station reaches MC as a `hello` with `node_type: "utility"` (contracts §5). Checked 2026-09-14:

- `envelope.py` requires only the KEYS `("node_id", "node_type", "app_ver", "seq_next")` on a `hello`; it does
  not validate `node_type` against a vocabulary.
- `state.py set_station()` gates on exactly one string: `(self.nodes.get(nid) or {}).get("node_type") != "utility"`.
- `NodeView.platform` is `str | None` (`types.py:613`) — free text, rendered, never matched on.

So **an ESP32 that speaks the envelope is a utility node today**, with no `contracts.md` amendment, no new kind,
and no MC change. `station_config` (A13.5, server side built 2026-09-11, F104) reaches it by the same three
paths it reaches a phone: on its `hello` if MC has it assigned, on every `PUT /api/stations/{node_id}`, and on
every lobby push. ⚠ **This is the reason to keep the Stick on the M-NET envelope rather than inventing a
private Wi-Fi protocol for it**: the arming half is already written, tested and shipped, and a second protocol
would be a second thing to keep in sync.

`platform` SHOULD be `"esp32"` and `app_ver` the sketch's own `"<version>+<sha>"`, so the ITEMS panel can tell
an operator which of their items is a phone and which is a box without a second field.

### 5g.2 The minimum client (four kinds, no ring, no gun)

A station is not a player node and must not be built like one. It never binds, never acks a config, never
writes a gun head, and owns no store-and-forward ring — MC already refuses a log pull from a utility node
(F106(d)). The whole client is:

| direction | kind | the Stick's obligation |
|---|---|---|
| → MC | `hello` | `{node_id, node_type:"utility", app_ver, platform:"esp32", seq_next:0}`. `node_id` is stable across reboots (Preferences), or MC sees a new item every power cycle |
| ← MC | `welcome` | keep `node_key` and present it on the next `hello` (A8.2) or a re-claim of a still-live id is refused `4003 in_use` |
| ← MC | `station_config` | `{kind, team, id, threshold?, game?, valid_ids?, lock_s?, starts_in_ms?, ends_in_ms?}` → advert and screen; persist the assignment; A68 hill timing uses both fields |
| ← MC | `station_update` | Pickup schedule updates only (A56); MC sends no hill update |
| → MC | `status` | every `STATUS_HEARTBEAT_MS` (2000 ms) while connected; stale at `STALE_AFTER_MS` (8000 ms). Live-only, never queued, no `seq` |

`seq_next: 0` forever is honest: a station emits no persisted facts, so there is no seq to advance and nothing
for `welcome.seq_hi` to reconcile.

**Hill timing (A68).** MC puts `starts_in_ms` and `ends_in_ms` in the same `station_config` whenever it knows
the respective go-live or end time. Each value is relative to MC send time; a start can be negative after go-live.
A future start keeps a hill neutral and waiting. A same-game config in LOBBY without a start also keeps it
waiting. MUSTER releases this wait when the config carries a start, including an untimed START. The hill counts
only from its local go-live to its local deadline. A MUSTER Stick that takes F374's 60 s offline fallback
without hearing START starts counting as before; it has no go-live or deadline information. MC sends no
`station_update` for a hill. A same-game config without either timing field means no match is running, so the
hill waits. An adopted match pushes nothing to stations, so its Stick hill gets no go-live or deadline and
counts as before.

For a Stick `control` station, threshold 0 or absent selects the separate -75 dBm hill default (Tony, 2026-09-25, UNPROVEN)
(`STICK_HILL_DEFAULT_THRESHOLD_DBM`, UNPROVEN, pending a 3, 5 and 7 m walk test). Other Stick kinds keep
-57 dBm (`STICK_DEFAULT_THRESHOLD_DBM`). A defaulted hill advertises -57 in byte 14 for phone-side presence:
the phone hears the Stick about 25 dB louder than the Stick hears the phone. An explicit MC threshold
overrides the relevant Stick measurement threshold and also sets byte 14. The first on-station RADIUS
edit also sets byte 14 to the edited threshold. The -57 advert exception applies only to an unedited,
defaulted hill.

The `status` body mirrors what `utility.js` already reports (`{role:"utility", kind, team, station_id,
threshold, live, armed, ...}`) so `_station_view()`'s `report` block and its attention lines
(BRING IT BACK TO RE-ARM · ARMED FOR AN OLDER GAME) work unchanged on a Stick.

### 5g.3 Credentials and discovery: the Stick cannot scan the QR

The field default for a phone is **scan MC's QR** (contracts §5). A Stick has a camera-less 1.14" screen, so
that door is shut and the other two must both work:

1. **mDNS** — MC advertises `_openbrx._tcp` with TXT `{ver, session_id, ws_path, server_name}` (`net.py
   advertise_mdns`); the Stick browses it. This is the intended path.
2. **The typed address, as the mandatory floor** — contracts is explicit that mDNS fails on hostile Wi-Fi and
   locked-down routers, so a floor is required. On a Stick that floor is the **serial console**, which already
   exists and already persists settings (`ID`, `GAME`, `TXPIN`): add `WIFI <ssid> <pass>` and `MC <ws url>`.

⚠ **Do NOT cache an MC IP across sessions** (contracts §5, and A28: the public hostname is random per tunnel
start). The Stick caches the SSID, never the address.

The SoftAP captive-config tier in `../../hardware/brx-station-spec.md` would remove the serial cable from this
story entirely. It is designed and unbuilt; the serial path is what unblocks the first Stick.

### 5g.4 The Wi-Fi association is a MODE, not a phase — and `held` must be buildable from day one

**Tony, 2026-09-14: build the capability to stay connected.** The use case is his own §5e example, restated —
hills placed around the house, all of them still inside the house AP. So the Stick has **two association
modes**, chosen per game, and the firmware must carry both from the first version:

| mode | the Wi-Fi association | for |
|---|---|---|
| **`muster`** (default) | joins at muster, takes `station_config`, **drops the association for the match** | §5d on a field. Nothing about the match then depends on coverage — A4.8 as written |
| **`held`** | joins at muster and **stays linked for the whole match**, reconnecting per contracts §5 backoff | §5e roaming hills, and any house game where the AP genuinely covers every point |

`muster` is the default because §5b's rule ("Setup needs WiFi; play does not") is what makes a station robust:
a §5d point out of range is still a fully correct point. `held` is not a tuning knob on that — it buys a
feature that is impossible without it (§5g.8), and it is selected by the MODE, not by an operator's mood.

⚠ **`held` is not free, and the two costs are the same measurement.** The ESP32-S3 runs Wi-Fi 4 and BLE 5 on
**one shared 2.4 GHz radio**, time-shared by the coexistence scheduler, and a station's entire job during play
is a steady advert. Under `muster` that contention never happens; under `held` it happens for the whole match.
So the advert-interval jitter with Wi-Fi associated is **no longer avoidable and is now on the critical path** —
it is the bench number that decides whether `held` is trustworthy, and it has never been measured. The same is
true of power: `../../hardware/m5sticks3/README.md` guesses ~2 h with BLE + RMT + screen and no Wi-Fi at all,
so `held` almost certainly needs the power bank that `../../hardware/inventory.md` still lists as "planned, not
ordered". Indoors that is easy — a house game is near mains — which is a real argument that `held` and
"around the house" belong together.

**Build implication, and the reason this section is worth its length:** the two modes differ only in *when the
association is dropped*, so a firmware written for `muster` alone would still be one line from `held` — but
only if it never assumes the socket is gone once the match starts. Nothing in the client may treat
"match started" as "MC is unreachable forever": no tearing down the WS stack at go-live, no discarding
`node_key`, no stopping the 2 s `status` heartbeat. **Under `muster` the association ENDS; under `held` it is
the live channel a match rule rides on.** Write the client so dropping is a policy decision at one call site.

### 5g.5 What MC can ARM versus what will actually PLAY

`STATION_KINDS` is all five (`types.py`), so MC can arm a Stick as any of them **today**. That is not the same
as the game working:

| kind | armable by MC | player-side rule |
|---|---|---|
| 1 respawn | yes | **shipped** — the scanner respawn, §4, unit-tested and field-proven 2026-09-04 |
| 5 control | yes | **shipped** — §5d, `control.js` + `engine.js _onControlAdvert()` |
| 2 powerup | yes | **in build behind `--powerups`** (docs/spec/powerups.md, A56): MC stores the item, compiles the pickup slots, runs the spawn schedule and sends `station_update`; the flag stays off until bench Sitting A passes |
| 3 extraction | yes | **not built** — roadmap K2 |
| 4 bomb | yes | **not built** — roadmap K4 |

So the first Stick that takes a `station_config` should be armed **respawn** or **control**. An operator who
arms it as a bomb site gets a box that correctly says BOMB SITE and correctly advertises kind 4, and a field on
which nothing happens. This is a property of the kinds, not of the Stick.

### 5g.6 Reprogramming is a MUSTER control, by design

`state.py _refuse_station_change_in_play()` refuses `set_station` / `clear_station` once the phase is ARMED or
LIVE, because an assignment re-pushes `config` to every player and a phone's `_applyConfig` rewrites the gun
head and clears `spawned` — on a live gun that silences every hit and death handler for the rest of the match.

That rule is about the PLAYERS, not about the station, and it does not soften for a Stick: the same re-push
reaches the same live guns. **Per-game reprogramming is the designed flow; mid-match reprogramming is refused
in the operator's voice.** Nothing here asks for that to change.

### 5g.7 Two loose ends this section does not close

- **`STATION_SOURCES` value for a Stick control point: DECIDED (2026-09-24, Tony).** `phone`, with no fourth
  value: a Stick control point uses `station_source: "phone"`, the same as a phone, because the advert and the
  capture rules (presence, §5d) are the same whether the advertiser is a phone or a Stick. Not yet bench-proven:
  the StickS3 port of presence capture landed in `e65aea17` and needs a hardware run (H9, Block 9 of
  `bench-2026-09-24.md`) before it counts as working.
- **`control{cmd:"release_utility"}` (§5c.1) has no meaning on a Stick.** It exists to free a PHONE stuck in
  utility mode by sending it back to its HUD; a Stick has no HUD to return to. A Stick MUST NOT ignore the
  message silently — the operator pressed a button and deserves an effect — so it should drop to UNASSIGNED
  (advert off, screen says NOT ARMED BY MISSION CONTROL), which is the nearest true equivalent: stop being an
  item on the field. It also lifts any A58 match lock, so MC must clear its own lock state for that station.

### 5g.8 What `held` is FOR: roaming hills, and what the firmware must not preclude

`held` exists to make **§5e roaming hills** (`../utility-roadmap.md` §8, **F95**) possible on a Stick. That
design is complete and unbuilt; nothing below asks to build it now. It is written here because these are the
assumptions that are cheap to honour while writing the client and expensive to retrofit.

**Roaming hills is the system's ONE deliberate exception to A4.8** (§5e.1): a match rule takes its orders from
the laptop mid-match, so a control point out of Wi-Fi range is not merely invisible, it is **not in the game**.
That exception is fenced to modes flagged `lan_coupled`; §5d stays fully offline-capable and is the default for
any field bigger than a house. ⚠ `lan_coupled` exists **nowhere in the code today** (checked 2026-09-14): not
in the mode catalog, not in `compile.py`, not in `types.py`. The flag is design.

| what §5e needs | what the Stick must not preclude |
|---|---|
| **The hot bit** — MC names which point is live | advert byte 10, value **16**. §5d.3 is the authority and says 16; §8 5e's "bit 5" is the same bit named loosely, and a firmware that reads it as value 32 would be silently wrong. `CONTROL_STATE` in `app/src/control.js` is still `{held:1, contested:2, rising:4, falling:8}` — **`hot` is unimplemented on every side**, so the Stick is free to be first, and must use 16 |
| **A mid-match push** carrying the hot flag | §5e routes it through `station_config`. ⚠ That message reaches a station today only via `_arm_station()`, and the ITEMS assignment path above it (`set_station`/`clear_station`) is refused in ARMED/LIVE by `_refuse_station_change_in_play()`. **The two are not in conflict** — that refusal exists because an *assignment* re-pushes `config` to every player and re-arms their gun heads, which a hot flag does not do — but it does mean §5e needs a mid-match sender that is NOT the assignment path. The Stick's obligation is only to accept a `station_config` at any time and apply the hot flag without resetting its point |
| **Grace, then degrade** (§5e.4, Tony's decision) | link down > **15 s** → degraded: keep running §5d locally on the last known owner (presence, net-difference capture, possession seconds, local callouts all need no LAN), stop contributing to the points race, and **keep the degraded seconds** to hand over at recap as a separate marked column |
| **Roaming freezes on LAN loss** | the hot point stays where it last was. **A station never promotes itself** — a hill that moved because a node lost Wi-Fi is worse than a hill that stopped moving |
| **The screen says it** (§5e.3) | armed into a `lan_coupled` mode → `MC-ARMED · GAME N · LAN-COUPLED`; while unlinked, a blocking band `THIS GAME NEEDS WI-FI — MISSION CONTROL OFFLINE`; degraded → `OFFLINE — POSSESSION ONLY, NOT SCORING`. ⚠ These were written for a phone screen. The Stick's LCD is **1.14"**, so the band is a legibility problem, not a copy problem: the person who can fix the Wi-Fi is standing in front of this screen, and the words have to survive being read from arm's length on a propped-up box |

The `VB0Q` "Hill Moved" callout (2.42 s, confirmed by ear) is already in `engine.js`'s `HILL_CUES` **with no
caller**, and every player phone plays it off the hot bit changing by the §5d.5 rule — so the Stick emits the
bit and nothing else. Same division of labour as the rest of §5d: the station measures, the phones announce.

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

Verified on two Pixels 2026-09-04 (respawn end to end). Open items for the utility work are FOLLOWUPS
rows (S6, S36 and the K-series); S5 is closed, in
[`../archive/followups-closed.md`](../archive/followups-closed.md).
