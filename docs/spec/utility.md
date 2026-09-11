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

Mission Control drives all of the §5 kinds from the ITEMS panel (§5b); stations are self-authoritative and
report at recap (MC is not live mid-match). (A duplicate of the §5 table that sat here as §5d was removed
2026-09-06; the roadmap's older "§5d" references mean §5. **§5d below is the control-point spec**, added
2026-09-10, and §5e the LAN-coupled variant.)

## 5d. kind 5 `control` — the phone control point (K1 base, design 2026-09-10 — Tony)

**Status: designed, not built.** Tony's design call, dictated 2026-09-10. This section is the spec of record for
`kind 5`; the §5 table row ("owner by team over time · present counts for your team") is the one-line summary and
this is the rule. Build row: `docs/utility-roadmap.md` K1. **Everything in §5d works with no LAN at all** — the
Wi-Fi-coupled extensions are §5e and are a separate, opt-in mode.

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
`held` hands the point to whoever is merely walking onto it. `engine.js:1259` gets this right —
`owner = (held && team <= 3) ? team : neutral` — and that line is the model everything downstream shares.

So a full enemy-to-own conversion costs `2 * capture_s` at net +1, and two phases give the defender a real chance
to arrive in the middle of it. **Only the team named in byte 9 scores** (possession seconds, or a Domination point
per second); progress itself scores nothing. **Neutral pays nobody** (Tony, 2026-09-10; §5f.6).

⚠ **Team 2 (F82).** A hill mode must not put anyone on tid 2 — that constraint comes from the grenade's polarity
gate, not from this advert, but a park will run both objectives, so MC's team assignment (0, 1, 3) is the same
either way.

### 5d.3 The advert (no new bytes)

`kind 5` uses the §2 advert as it stands. The station id in **bytes 6-7** is what makes multi-point Domination
possible on phones and impossible on grenades (F88: a grenade beacon carries no id at all).

**Byte 10 is INDEPENDENT FLAGS, not a packed bitfield** — `CONTROL_STATE` in `app/src/control.js:42`, written at
`:111-114` and read by `engine.js` (which imports the same constant, `:14`, and decodes at `:1255`/`:1260`). This is
the wire. It is stated here explicitly so that nobody, reading an earlier draft of this section, "fixes" the code
toward prose that was never shipped.

| byte | kind 5 meaning |
|---|---|
| 8 `kind` | **5** |
| 9 `team` | the **owner** when `held` is set, the **claimant** when it is clear, **255 = nobody** (§5d.2) |
| 10 `state` | flags, OR-ed: **`held` 1** (byte 9 is an owner, not a claimant) · **`contested` 2** (living present players of two or more teams) · **`rising` 4** (`value` climbing) · **`falling` 8** (`value` dropping). Bits 4-7 spare — **`hot` (§5e roaming) takes 16** when that variant is built |
| 11 `value` | **progress 0-100**, read per the §5d.2 table |
| 12 `seq` | bumps on every change of `team`, the flags or `value` — a phone one-shots its callouts off this |
| 15 `reserved` → `rate` | **specified, not yet emitted.** `advert()` returns `{team, state, value}` today. The intent is the clamped `net` (0..`net_cap`) so a screen can show speed without re-deriving it; it needs no sign, since `net` is never negative (§5d.1). A station's own screen has something better locally — `control.js timeToChange()`, the seconds until the point actually flips, which is the number a defender reads — so this byte is only worth emitting once a *player* HUD wants it |

⚠ **A reader must treat `rising && falling` as INVALID** and fall back to neither. This is the one virtue the
packed-bitfield draft had and it does not survive into flags for free: two bits *can* both be set, where a 2-bit
phase field made the contradiction unrepresentable. Our own station never emits it (`control.js:113-114` is
`if`/`else if`), but **adverts are unauthenticated** (§3) — a buggy or hostile station can set both, and a reader
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
| **a running score** across several points, and **points-to-win** | nowhere offline. This is the whole reason §5e exists |

### 5d.4 The station screen ANIMATES the contest and the transition

Static numbers are not enough: **a defender must be able to tell "you are losing this, get help" at a glance.**
The screen builds on what `utility.js` already renders.

| element | what it does |
|---|---|
| **owner colour** | the page already themes itself from the station's team (`utility.js:145` sets `document.documentElement.dataset.team`). `kind 5` drives it from the **live owner**, and **neutral is its own look** (grey/unlit), never a team colour |
| **progress bar** | one bar for `value` 0-100, animated between advert updates (CSS transition, not a jumping number). It is **two-toned across the phases**: draining shows the owner's colour retreating, building shows the claimant's colour advancing from neutral |
| **direction and rate** | an arrow on the moving edge pointing the way the point is going, plus the rate as a multiplier (`→ RED ×2`) from its own `net` (the station reads its own state, not the byte it emits), and **`timeToChange()`** as the seconds until the point actually flips, which is the number a defender reads to decide whether to run. At net 0 the arrow is replaced by **STALLED** |
| **the transition** | a one-shot full-width flash and a large word at each crossing: **NEUTRAL** when the drain completes, **CAPTURED BY <team>** when the build completes. The moment must be unmistakable from across a room |
| **contested** | a persistent band when the contested bit is set, so "both teams are here" reads even at net 0 (which is otherwise indistinguishable from an empty point by the bar alone) |
| **who is contributing** | the existing roster (`utility.js:161`, P-id · team · RSSI · ALIVE/DOWN · AT STATION) gains a **counts / does not count** marker per row: living + present = counted and shown in team colour; **DOWN** = struck through; in range but not present = dimmed. Under it, the net line: `RED 2 · BLU 1 → +1 RED` |
| **the tally** | possession seconds per team, persisted (§5d.6), so the screen is also the recap sheet if nobody ever collects it |

### 5d.5 The guns say the right thing per team — and this needs NO LAN

⭐ **This is the difference between the mode working on a field and not.** Every HUD phone already keeps a scan
open for the whole match and already feeds every OBRX advert into the presence tracker (`app/src/app.js:121`),
and stations are already surfaced to the engine (`app.js:158-163`, `presence.stations()` → `engine.setStations`).
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

⚠ **Every transition below is on the DECODED owner** — `held ? team : nobody` (§5d.2, `engine.js:1259`) — never on
raw byte 9, which carries a *claimant* while the point is unheld. Announcing off byte 9 alone would shout "Hill
Captured" the moment someone walked on.

| transition (on a `seq` bump) | the listener's team | plays |
|---|---|---|
| decoded owner: nobody → mine, or an enemy tid → mine | the new owner | **`VB0N` "Hill Captured"** (1.92 s) |
| decoded owner: mine → nobody (the drain completed) | the team that just lost it | **`VB0P` "Hill Lost!"** (2.98 s) |
| contested bit 0 → 1 with my team involved | both sides | **`VB0O` "Hill Contested"** (2.08 s) |
| `team` == my team, on the node's own ~1 s timer | the holder | **`U100`** possession tick (0.11 s) |
| a capture between two **other** teams | everyone else | **silence** — not this player's event |
| the hot point moves (**§5e only**) | everyone | **`VB0Q` "Hill Moved"** (2.42 s) |

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
  the tick **waits** rather than playing underneath it (`engine.js` `_hillBusyUntil`, `:151` / `:1221`), and a later
  callout **preempts outright — it never queues** (`_hillSay` sends `$PLAYX,0,*` in the same write, and only ever
  cuts off our own in-flight hill line). Both are implemented, commit `4348721`. A queued "Hill Captured" landing
  three seconds after the point was already lost would state something false; the newest word is always the true
  one. `U100` is safe at 1 s only because it is 0.11 s long and yields to every callout. §5d.4's animation is
  **additive to this**: the screen can show a transition continuously, the gun cannot.
- **The callout's reach is the advert's radio reach**, which is neither the 10 ft presence bubble nor the whole
  field — roughly tens of metres, body-blocked and uneven. So a capture is heard by whoever is near the fight, not
  by the far side of the park. Native's field-wide announcement is not reproducible offline; §5e can fan it out
  best-effort through MC, and per `hud-driven-events` nothing ever waits on that.
- **Freshness is the §3 presence rule** (`expiryMs` 4 s), not the grenade's 12 s / two-missed-beacons rule. That
  rule exists because the grenade beacons once per ~5 s; a BLE station advertises continuously.

### 5d.6 Progress persists, and the station is self-authoritative

The station owns its own state and answers to nobody mid-match (§5c: *stations are self-authoritative and report
at recap; MC is not live mid-match*). `utility.js` already persists role and settings in `localStorage`
(`brx.utility`, `:26-27`); `kind 5` adds **`brx.station.control`**: the `control.js` model as it stands — `owner`,
`capturing`, `progress`, `contested`, `dir`, `net` — plus `seq`, possession seconds per team, and the capture log
(`{t, from, to}`). Written on every change, read at startup, so a
phone that reboots, is force-closed or runs out of browser under it comes back holding the point it held — the
same "live after a reload" property the respawn station already has.

At recap the station reports its tally and capture log to MC when it is next in Wi-Fi range (roadmap A6's stations
row: the station's own count against the players' `capture` facts, ✓ when they agree, ⚠ when the station was
never heard). **MC is never asked for the answer mid-match, and never asked to arbitrate between two stations.**

## 5e. The LAN-coupled variant (opt-in): roaming hills

**Status: designed, not built, and it buys its feature with an architectural exception.** Tony asked for this
explicitly as a second mode, for a small field where every point really is on one Wi-Fi — his example: one hill in
the garage, another on the porch across the house, both on the house AP. §5d is the mode for a field; §5e is the
mode for a house.

⚠ **Read §5f first if you have not.** This section used to claim points-to-win as a second LAN-coupled feature,
and **it is not one** — §5f.2 shows a
Territories station scoring itself offline and reporting at recap, which is plain §5c. What is left needing a live
LAN is **one** feature, plus one optional flavour of the score:

| feature | why it needs the LAN |
|---|---|
| **Roaming hills** (the live point moves during the match) | somebody must **choose** which point is hot and tell the others. That is MC, mid-match, which is the exception. `VB0Q` "Hill Moved" (2.42 s, confirmed by ear, already in `HILL_CUES` with no caller) exists for exactly this, and **F83** already proposes the mode on the grenade side |
| ~~a points race that ENDS the match early on crossing a target~~ | 🔴 **DECLINED (Tony, 2026-09-10) and not being built.** The points target is read **at the horn** (§5f.2), which is fully offline. The early-end form is the only other thing that would have needed coverage, and it is now deliberately off the table — **not** "allowed but unbuilt". Anyone reviving it is opening a second A4.8 exception and must say so |

Mechanically: MC pushes the hot point to the stations (`station_config`, §5c, extended with the hot flag — advert
byte 10 bit 5). On a move, each player phone plays `VB0Q` off the hot bit changing, by the §5d.5 rule. Stations
still run §5d locally and still keep their own books; the LAN adds the rotation, it does not replace the local
rule.

### 5e.1 🔴 This is a DELIBERATE EXCEPTION to A4.8, and that is the most important line in this document

`docs/spec/contracts.md` §5 [**A4.8**] says: *on a large field most nodes are out of LAN range for most of the
match … live kill-confirm and a live individual board are coverage-zone features.* **Nothing about the match
outcome depends on coverage.**

**§5e breaks that last sentence on purpose.** A roaming hill is a match rule taking its orders from the laptop
mid-match: a control point out of Wi-Fi range is not merely invisible, it is **not in the game**, because it cannot
be told whether it is the live one. There is no way to have that feature and keep A4.8 — the exception is the
feature. **Roaming hills is the whole of the exception** — an early end on a points target would have been a
second one, and Tony declined it (see the table above), so it is not in the system and not reserved for later.

⚠ **The exception is NARROWER than this section first claimed**, and that is worth noticing rather than quietly
fixing: points-to-win was listed here as a second reason, on the reasoning that no station knows another station's
contribution. True — and irrelevant, because nothing has to add them up *during* the match. Territories (§5f.2)
scores offline and MC sums at recap. The rule that looked like it needed breaking twice needs breaking once.

We take it knowingly and we fence it:

- it applies **only** to modes explicitly flagged **`lan_coupled`** in the mode catalog;
- it **never** applies to §5d, which stays fully offline-capable and is the default for any field bigger than a house;
- it is the **only** place in the system where coverage decides an outcome; everything else A4.8 protects (facts
  queued in the ring and replayed, kills reconciled at sync points, a node whose own loop never waits on MC) stays
  exactly as it is;
- and because the requirement is physical, **both screens must say so before the match starts** (§5e.2, §5e.3).

If §5e is ever built, `contracts.md` A4.8 gains a pointer to this section. An exception that is not written next to
the rule it breaks is just a bug waiting to be rediscovered.

### 5e.2 MC must say the phones need a connection (setup surface)

The requirement is a **physical setup step**, which MC already has a channel for. `mcp/brx_mcp/mc/API.md`: a
`config_warnings` entry whose text starts **`SETUP: `** is a physical step the operator must do on the field
before the push, and the **GAMES rail renders those verbatim**. `lan_coupled` modes emit one, with live counts:

```
SETUP: this mode needs every control point on the match Wi-Fi for the whole game - 1 of 2 items linked
```

Reuse that channel; do not invent a second warning surface. Alongside it, the **ITEMS panel** (roadmap A2) shows a
link state per utility phone and raises an A4-style attention flag on any `kind 5` phone that is not linked while a
`lan_coupled` mode is selected. **Proposal:** MC should also **refuse to start** a `lan_coupled` game with an
unlinked control point (a 4xx naming the phone), the same way `compile.py` refuses `koth` with no `station_source`
— the mode cannot be scored correctly, so starting it is a guaranteed bad match rather than a risk.

### 5e.3 The utility screen must make the Wi-Fi requirement clear during setup

`utility.js` already renders an MC link state — **`MISSION CONTROL ✓ LINKED` / `· OFFLINE` / `· NO ADDRESS`**
(`:159`) — and the arming banner **`MC-ARMED · GAME N`** / `NOT ARMED BY MISSION CONTROL` (`:157`). Build on
those; add no new indicator.

- a station armed into a `lan_coupled` mode shows **`MC-ARMED · GAME N · LAN-COUPLED`**;
- while such a station is not linked, the existing MC line is **promoted from a footnote to a blocking band**:
  **`THIS GAME NEEDS WI-FI — MISSION CONTROL OFFLINE`**, in the alert treatment, above the fold, unmissable by
  whoever is propping the phone up. The point of putting it here is that the person who can fix it is standing in
  front of this screen and not in front of MC;
- when it is linked, the band is replaced by a quiet confirmation carrying the thing an operator actually wants to
  know: **`WI-FI OK · REPORTING TO MISSION CONTROL`**.

### 5e.4 LAN loss mid-match — ✅ DECIDED (Tony, 2026-09-10), accepted as proposed

This is the failure the exception buys, so it gets a written behaviour rather than whatever the code happens to do.
All four points below are **Tony's decision**, taken as they were proposed:

1. **Grace, then degrade.** A link down for more than **15 s** (a few reconnect backoffs, `contracts.md` §5) puts
   the station into **degraded** mode. It **keeps running §5d locally on the last known owner** — presence,
   net-difference capture, per-team possession seconds, the local callouts, all of which need no LAN — and stops
   contributing to the points race.
2. **Roaming freezes.** The hot point stays where it last was. A station never promotes itself; a hill that moved
   because a phone lost Wi-Fi would be worse than a hill that stopped moving.
3. **Both screens say it, in the words above.** The station: **`OFFLINE — POSSESSION ONLY, NOT SCORING`**. MC: the
   ITEMS row flagged, and the points race shown as **incomplete**, with the gap in seconds.
4. **At the time limit MC will not award a points win it cannot stand behind.** If any `lan_coupled` point was
   degraded for more than **10%** of the match, MC declines the points target and falls back to **most possession
   time from the facts it does hold**, saying so on the recap. Degraded seconds are collected from the station at
   recap and shown as a separate, clearly-marked column — they are real possession, they were simply never in the
   live race.

**The rationale for (4), in one line, because it is the one somebody will want to soften:** a win computed from
data we know is incomplete is not a win, and **failing loudly beats quietly crowning the wrong team.** The
friendlier alternative — award it anyway from partial data and put a warning on the recap — produces a scored
result nobody can check, which is the thing A4.8 exists to prevent.

## 5f. TERRITORIES — the multi-point scoring model, and the mode that needs no LAN at all

**Tony, 2026-09-10:** *"the other option for koth, is territories. You tick points whether you are there or not.
You turn it your colour and then you go find the next territory."*

Several `kind 5` points on the field. Capture one the §5d way, it turns your colour, and it **accrues score for
your team whether or not anyone is standing on it**. Then you leave it and go take the next one. Conquest scoring,
not possession scoring.

**§5d needs no change to support this.** §5d.2 already scores **ownership**, not presence — *"only the team named
in byte 9 scores"*, and an empty point holds its progress while the owner keeps scoring. So Territories is §5d
**configured with several points and a total to win**, which is why it is cheap: the capture rule, the advert, the
callouts and the station screen are all the same. What changes is the number of stations and what MC does with
their tallies.

### 5f.1 It solves camping by construction

The camping worry is real in single-point possession KotH: standing on your point is *how you earn*, so a 1-1
split settles into a stable, boring equilibrium where both teams sit on their own point and nothing happens.

In Territories, **standing on a point you already own earns you nothing extra.** The point is already ticking. The
only way to increase your rate is to go own another one, so the optimal play is always to leave and push. The
incentive comes out of the scoring model, which means **none of the anti-camp machinery is needed for this mode**:
no ownership decay, no capture bonus, no superlinear "holding both" multiplier, no timer that punishes standing
still. Every one of those is a rule that has to be tuned, explained to players, and then defended when it
misfires. Territories needs none of them, and that is the main argument for the mode.

### 5f.2 🔴 It removes the A4.8 exception for scoring: a station is its own scorekeeper

**A Territories point can score itself, offline, with no LAN at any point in the match.** It knows who owns it
(it decided), it is physically present for the whole match, and it already persists its tally across a reboot
(§5d.6). So it accrues its own ownership-seconds locally and hands MC the total **at recap** — which is not a
concession, it is exactly §5c: *stations are self-authoritative and report at recap; MC is not live mid-match*.
Add up the stations at recap and you have the score.

⚠ **This means §5e over-claimed, and the correction matters.** §5e originally listed **points to win** as needing
the LAN. That is only true of one *form* of it:

| form of "points to win" | needs coverage? |
|---|---|
| **the target decides the winner at the horn** — the match runs its full clock, MC sums each station's tally at recap, and the team past the target (or with the most territory-seconds if nobody reached it) wins | **No.** Fully offline. No A4.8 exception, no Wi-Fi requirement, nothing to warn the operator about |
| ~~**a live race that ENDS THE MATCH the moment someone crosses the target**~~ | **Yes**, and only this. Somebody must hold the running sum *during* the match to blow the horn early, and no station knows another station's contribution. 🔴 **DECLINED (Tony, 2026-09-10): not being built** |

✅ **Tony took the first, 2026-09-10: the target is read AT THE HORN.** To players the two are nearly
indistinguishable — a BRX match runs a clock anyway, and the runway is the normal one — and the first costs nothing
architecturally. So the §5e exception narrows to **roaming hills alone** (a match rule taking orders from the
laptop mid-match, which genuinely cannot be done offline), with no second exception held in reserve.

### 5f.3 ⚠ Territories does NOT work on grenades, and the reason is observation, not memory

A grenade **does** hold its ownership when unattended: F70 measured a captured hill reading the same owner for ten
straight beacons with nobody shooting it, and rung R's range walk still read the same owner from the far edge
(`docs/bench-grenade.md` rung R). The grenade remembers fine.

**The problem is that nobody observes it.** A grenade's ownership travels **only over IR**, and only a **gun**
receives IR (**F92**). So an unattended grenade territory is **unverifiable**: a rival can flip a far point and
nobody — no station, no node, not MC — learns of it until a player happens to wander into range, which rung R puts
at *solid close in, intermittent by ~30 ft* (85 s and 145 s dropouts at the edge). That is **eventually-consistent
scoring**: the score is right whenever someone last looked. Acceptable as flavour. Not acceptable as the thing
that decides who won.

This is the same sensor gap as F92, seen from a third angle — F92 saw it as "a station cannot learn who owns a
grenade hill", F88 as "a grenade carries no point id", and Territories sees it as "an unwatched point has no
scorekeeper."

➡ **So Territories is the strongest case in this document for building K1 phone control points.** A phone station
*is* the observer the grenade lacks: it sits on the point for the whole match, it decides ownership from adverts it
hears directly, and it keeps its own books. A grenade can only ever be a **contested** point that someone is
present for — a good objective, and never a territory.

### 5f.4 Scoring is LINEAR per owned territory — decided

**Tony, 2026-09-10: *"sounds like linear is the way to go."*** Two territories tick at twice the rate of one.
**No superlinear multiplier for holding more, and no majority threshold.** The rate is `n_owned * tick_rate`.

Both alternatives were considered, and the arguments against them are worth keeping, because each will be
proposed again by somebody:

| model | why not |
|---|---|
| **superlinear** in the count (a multiplier for holding two, three…) | the mode **already** rewards spreading out by construction (§5f.1: sitting on a point you own earns nothing extra), so a multiplier is not needed to create the push incentive — it pays twice for the same behaviour. And in a 10-minute game it risks a first-capture lead **snowballing out of reach** before the other team can answer |
| **a majority threshold** (score only while you hold 2 of 3) | genuinely good design — losing one point drops you to **zero**, so the scoring itself shouts *get help* — and **wrong for our point counts.** A threshold needs **three** points to mean anything: with two, "majority" is *both*, so a 1-1 split pays nobody and a 2v2 match can sit scoreless for minutes. ➡ **Revisit this if a three-point Territories game is ever built**, where the threshold is strictly better than linear |

⚠ **Do not attribute a single canonical answer to "Halo":** it shipped both. Halo 4's *Dominion* ticked per
captured base (linear-ish); *Strongholds* in Halo 5 / Infinite is the majority threshold. The reference is useful
for the shape of each model and settles nothing by itself.

⬜ **And a third option that is still open: scale ADVANTAGE, not points** — holding more territories shortens your
respawn delay, *Dominion*'s approach. It answers the superlinear objection (board control compounds, the score does
not snowball) and it is the one item here Tony has not ruled on. Written up in **§5f.7**.

### 5f.5 The two rates, and both are CONFIGURABLE

**Tony, 2026-09-10: *"3 needs to be configurable with a good default."*** Neither number is hard-coded; both live in
game config beside the other tunables. **They are two different quantities and are easy to conflate, so they are
named separately here and must stay separate in config:**

| # | what | unit | default |
|---|---|---|---|
| **conversion rate** | how fast a point *changes hands* (§5d.1) | progress points per second **per net player** | **10** = a lone player takes a neutral point in 10 s and steals a held one in 20 s (two phases); `capture_s` = 10 s. ⚠ **This is already `DEFAULT_RATE` in `app/src/control.js:49` — the spec value and the code constant must agree, and a change to one is a change to both** |
| **score tick** | how fast an *owned* territory **pays** (§5f) | score points per second **per owned territory** | **1/s proposed** (see the arithmetic below) |

**The arithmetic an operator actually needs, for a 10-minute match at 1 point/s per territory:**

| held all match | total |
|---|---|
| one territory | ~600 |
| two territories | ~1200 |
| three territories | ~1800 |

So **the target chosen decides whether holding a single point can ever win**: a target of 1000 means one territory
is never enough and a team must take a second; 500 means one territory held cleanly wins, which turns the mode back
into KotH. That relationship, not the constant, is the thing to tune — which is why the rate is configurable and why
this table is here rather than a bare number.

⚠ **Both numbers are proposals.** Tony asked for *a good default*, not for these values; 10 is what the
implementation already ships and 1/s is chosen so the totals above are round and readable. Neither has been
playtested.

### 5f.6 Decided: neutral pays nobody, and a dead station keeps what it earned

Both **Tony, 2026-09-10**:

- ✅ **A neutral point ticks for NOBODY.** (§5d.2 said this already — but that was the spec's own sentence, not a
  ruling, and an earlier draft wrongly cited it as settled. Now it is his, so §5d.2 is backed rather than
  self-referential.) An **owned** point ticks whether or not anyone is present; that is the mode.
- ✅ **A station powered off mid-match KEEPS the seconds it accrued up to its last advert, then stops.** The tally
  is **not** voided. Rationale, recorded because the opposite is the tidier-looking choice: voiding everything
  punishes a dead battery far more harshly than the information loss warrants, and **the seconds up to the last
  advert were genuinely earned**. What is lost is only the dark interval — an owner is silently under-paid for it,
  and a rival who flipped the point while it was dark gets no credit either. Trust caveat unchanged: the phone is
  assumed untampered, per §3's security posture.

### 5f.7 ⬜ Still open: scale ADVANTAGE rather than points

The one item Tony has **not** ruled on. Repeated here rather than left buried in §5f.4: instead of (or alongside)
scaling the score with territory count, let holding more territories **shorten your respawn delay** — *Dominion*'s
approach. `respawn_s` is host-driven, already fully in our control, already the lever §4/§5d use, so it is
buildable today with no new mechanism; it compounds board control without the score itself snowballing; and it
composes with the linear score rather than replacing it. **Needs his sign-off before anyone builds it.**

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
  new match clears an in-flight reconcile and spawns clean. Closed the force-close-at-low-HP cheat on Tactix-E20D.
- **Station doesn't see player adverts at high TX — FIXED in code** (S6, commit 73d391a): the station scans
  low-latency and restarts the scan every 8 s to recover an Android-stalled scan. Still needs the two-Pixel
  bench to confirm; a lower station TX is the fallback.

Still open:
- **Per-match scoping (half done).** The station carries a game byte in its advert and `station_config` pushes it
  (A13.5); the player-side `Presence.game` filter honours it. Pending: the compiler emitting `config.stations`
  (the authoritative allow-list players enforce). Today's fallback is disjoint ids (§3).
- **Station kinds 2–5** state machines (powerup/extraction/bomb/control) — build order in
  `docs/utility-roadmap.md` (K1 control point first). **kind 5 `control` is now fully specified in §5d**, with the
  opt-in LAN-coupled variant in §5e; kinds 2–4 are still the §5 table only. **MC muster / arming assignment is FOLLOWUPS S5** (brx).
- iOS build + test of `BrxBeaconPlugin.swift` on the MacBook (the superseded-start + power-toggle re-assert
  paths are written but unbuilt).
- Bench-tuned defaults are -74 dBm / 0.8 s / high TX (§3); revisit per station-kind (an extraction zone wants
  a looser, bigger bubble than a respawn point).
