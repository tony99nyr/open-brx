# M-NODE — the phone node: per-gun engine + video-game HUD

- **Status:** Draft (Wave 2). Binds to the frozen backbone: [`README.md`](README.md) §3/§4/§7,
  [`contracts.md`](contracts.md) §4 (events), §5 (protocol), §6 (lifecycle), §7 (clock).
- **Owner interface (from README §4):** *the node app; consumes `Transport` (M-NET) + `armFrames()`
  (M-MODES).* **Depends on:** M-CONTRACTS, M-NET, M-MODES.
- **Seed:** the current single-gun app — [`app/src/app.js`](../../app/src/app.js) +
  [`app/www/index.html`](../../app/www/index.html). This spec **evolves that code**; it does not
  rewrite it. Where a mechanism already exists and works, we say *keep it* and point at it.
- **Later target:** the same engine logic runs on the ESP32 Companion (ADR-0001). Keep the engine a
  pure state machine over BRX frames + Transport messages so it ports without the DOM.

> **Invariant this module must never break (README §2, ADR-0001):** a node owns **exactly one gun**
> and its own-gun loop (arm → damage → death → respawn → local feedback) **runs with the LAN dead.**
> The gun is **host-blind about its own kills** — the node never tries to detect its own kills. See §3.6.

---

## 1. Scope & non-scope

**In scope:** the per-gun game engine (§3), the HUD (§4), field diagnostics (§5), on-device log
capture + export (§6), and the BLE plumbing carried over from the seed app (§7). Cross-platform
notes (§8), tasks + open questions (§9/§10).

**Explicitly NOT this module:** cross-player scoring (kills/assists/accuracy — MC derives them,
contracts §4), the LAN transport itself (M-NET owns the `Transport` class + envelopes), frame
authoring (M-MODES owns `armFrames()`/`WeaponCatalog`), the dispersed-start scheduler (M-START owns
`startAt`; the node only executes the countdown it is handed). This module *consumes* all four.

---

## 2. Shape of the thing

Two layers, one process:

```
   ┌─────────────────────────── M-NODE (one phone, one gun) ────────────────────────────┐
   │  HUD (§4)  ◄── state ──  Engine (§3)  ── frames ──►  BLE plumbing (§7)  ──► the gun  │
   │   glare/blackout          pure state machine          init-once, retry,             │
   │   diagnostics (§5)        emits Event (§4 contracts)   reassembler, 20B chunk        │
   │        ▲                       │  ▲                                                  │
   │        │                       ▼  │  consumes assign/feedback/start/tutorial         │
   │   log capture (§6) ◄──────  Transport (M-NET client) ◄──── field LAN ──── MC         │
   └────────────────────────────────────────────────────────────────────────────────────┘
```

- **Engine** is the seed's `me` object + `handleFrame`/`death`/respawn loop, promoted to a real state
  machine over contracts §6. It knows nothing about the DOM or the socket directly — it **emits
  Events** and **accepts commands**. This is what ports to the Companion.
- **HUD** is a pure function of engine state (§4.4). It never writes frames.
- **Transport** is injected (M-NET). With no Transport, the node still runs — it just can't report
  or receive MC feedback. The seed already proves this: it plays a whole local game with no server.

---

## 3. The per-gun engine

### 3.1 Arming from a pushed GameConfig

The seed hard-codes a TDM `SETUP` array and `spawnFrames(team)`. **Replace that with M-MODES.** On an
`assign` (contracts §5, `{player, team, config}`) the node:

1. stores `player`, `team`, `config` (and `config.health.max_hp`/`max_armor` → the HUD's bar caps,
   replacing the hard-coded `MAX_HP=45`/`MAX_AR=70`);
2. calls `frames = armFrames(config, player)` — M-MODES returns the ordered frame list (the
   team-independent setup + `$WEAP`/`$GSET`/`$PSET`/`$SIR`/`$BMAP` + per-team `$TID`/`$SPAWN`/`$AMMO`,
   exactly the shape the seed hard-codes today, now derived). The node **never invents frames**
   (contracts §8);
3. writes them over BLE (§7) at **volume 69** (house rule — `armFrames` bakes `$VOL,69,...`; the node
   asserts it, never silently downgrades to the diagnostic default 30);
4. replies `ack_config{config_id, ok, err?}` (contracts §5). On write failure `ok:false` + the error;
   MC's readiness board reflects it.

`config.respawn.delay_s` replaces the manual `#respawn` input; `config.time_limit_s` drives the HUD
match clock (§4.4). `night` selects blackout defaults (§4.3).

### 3.2 Tracking hp / armor / ammo

Keep the seed's frame handlers (`handleFrame`), which already work on hardware:

| frame | tokens read | engine effect |
|---|---|---|
| `$HP,<hp>,<armor>,*` | hp, armor | set `hp`, `armor`; **if `hp==0 && alive && running` → death() (§3.4)** |
| `$LCD,...` | hp, armor, ammo (tok 5) | set `hp`, `armor`, `ammo` — the periodic full-state line |
| `$ALCD,<ammo>,*` | ammo | set `ammo` |
| `$HIR,...` | shooter team (tok 4), guard tok 2≠`15` | latch `lastShooterTeam` + `lastShooterAt` (§3.5) |
| `$VOLTS,...` | tok 3 = pack % (verified, protocol §… `$VOLTS`) | set `battery` (§4 batt, §5) |

Ammo is **observed**, never asserted — the gun is the source of truth for its own magazine. The node
does **not** simulate reloads; it reflects `$ALCD`/`$LCD`.

### 3.3 Emitting Events (contracts §4)

The engine emits **only node-observable facts**, handed to Transport (queued if the LAN is down —
§3.7). Mapping from local state to the frozen `Event` union:

- **`status`** — every `STATUS_HEARTBEAT_MS` (2000): `{hp, armor, ammo, alive, deadline_s?, battery}`.
  `deadline_s` = seconds left on the respawn timer when DOWN (§3.4).
- **`hit_taken`** — on a `$HIR` that also drops `$HP`: `{shooter_team, dmg}` (dmg = the hp+armor
  delta). `shooter_id` omitted (phone can't IR-decode — Companion P2 only).
- **`death`** — on `$HP→0` (§3.4): `{shooter_team}` from the latched `$HIR`.
- **`respawn`** — on local respawn (§3.4).
- **`shot`** — from trigger/ammo deltas: `{weapon_id, ammo_after}`. *(Ammo-delta shot detection is
  new work vs. the seed; see §10-Q3 for the false-positive risk on reload/pickup.)*

Every event carries `t = synced_now()` (contracts §7) and a per-node monotonic `seq` (M-NET stamps
the envelope; the engine just produces the bodies). Idempotent by `(node_id, seq)`.

### 3.4 Own-death detection + local respawn

Keep the seed's model exactly — it is already correct:

- **death():** `$HP→0` while alive+running → `alive=false`, `deaths++`, `deadAt=synced_now()`, latch
  who (from `lastShooterTeam`), emit `death`, HUD flips to DOWN (§4.4). **No frame is written to the
  gun on death** — the firmware handles its own down-state; the node only *observes* it.
- **respawn:** the 500 ms tick. When `respawn.type=="auto"` and `now - deadAt ≥ delay_s`, write
  `reviveFrames()` (M-MODES: `$SPAWN` + `$AMMO` refills), set `alive=true`, refill HUD caps, emit
  `respawn`. For `type:"scanner"`/`"none"` the node does **not** auto-revive — it waits for the
  gun's own respawn signal / stays down (surface a "find a respawn point" HUD hint). Respawn math
  uses **synced time** so a mid-match reconnect doesn't warp the countdown.

### 3.5 Shooter-team from `$HIR`

`$HIR` token 4 = shooter **team** (contracts §4: always available; individual `shooter_id` is
Companion-only). Latch `lastShooterTeam`+`lastShooterAt` on every valid `$HIR`; at death read the
latch. This yields **team-level** attribution only (README §6 [DECIDE]) — honest and sufficient for
the "killed by BLUE" HUD line and for MC's team-level scoring. Never fabricate an individual id.

### 3.6 Kill feedback is MC-driven — do NOT detect own-kills

**Hard boundary (ADR-0001).** In a BLE-armed game the gun does **not** self-fire the green sight; it
emits **no shooter-side kill event**. The node therefore **cannot and must not** try to detect that
*it* killed someone. Instead it exposes a **`feedback()` hook** that MC calls (contracts §5
`feedback{player_id, kind, sound?}`):

```
feedback(kind):  $SFLASH,*   → sleep 120ms → $PLAY,,4,6,<kill|multi|medal line>,,,,*   (vol 69)
```

This is the seed's `feedback()` — keep it. `kind`/`sound` select the sound-bank line (V3A "kill",
multikill/medal ids from M-MODES). The hook is **best-effort**: no local game logic ever depends on
receiving it (contracts §5 store-and-forward). If the LAN is down at the kill instant, the sight just
doesn't flash — the match is unaffected. Kills/assists/accuracy on the HUD stay **"— MC"** (§4.4)
until MC pushes them; the node never computes them.

### 3.7 Autonomy — the whole loop runs with the LAN down

This is the headline requirement (README §2/§7). Concretely, with **no Transport connected**:

- arming still works if the node already holds a `config` (from a prior `assign`, persisted §6) — and
  the node can arm from a **locally cached last config** so a power-cycled phone rejoins the same game
  without MC in range;
- damage/death/respawn/battery all run off BLE frames alone;
- Events **queue** in a bounded persisted ring (contracts §5) and flush as `event_batch` on reconnect;
- only two things degrade: MC `feedback` (no sight flash) and cross-player HUD stats (stay "— MC").

The node **never blocks** on the LAN. Start uses the pre-shared `go_live_t` (contracts §7 / M-START),
so even T-0 needs no signal.

### 3.8 Lifecycle (contracts §6) → engine states

```
IDLE ──setGun──► CONNECTED ──assign──► KITTED ──ready──► LOBBY ──start(go_live_t)──► ARMED(countdown)
   ▲                                                                                     │
   └──────────────── end / disconnect ◄──── LIVE{ALIVE ⇄ DOWN} ◄──── T ──────────────────┘
```

The seed collapses this to IDLE/READY/ALIVE/DOWN; **promote it** to the full set so the HUD and MC
agree on one vocabulary. `DISCONNECTED` is orthogonal (auto-reconnect, §7) and returns to the prior
state. `control{cmd:"panic"}` (contracts §5) → the **panic sequence** `$CLEAR,*` then `$SP,99,*`
(house rule) and drop to IDLE. `control{cmd:"end"|"recall"}` → the seed's end frames + LIVE→IDLE.

---

## 4. The HUD — a glare-legible video-game HUD (the heart)

The HUD is the player's whole world during a match. Design target: **readable at a glance, at arm's
length, in direct outdoor sun, while moving** — and **fully dark at night** (§4.3). It is a pure
render of engine state (§4.4); it holds no game logic.

### 4.1 Layout — big, sparse, thumb-free

Portrait, full-bleed, **no scrolling during play** (the log/diagnostics live behind a button). One
screen, three zones:

```
┌──────────────────────────────────────────────┐
│  R0BAT · BLUE            ⏱ 07:12   🔋 55%  ⓘ  │  top strip: identity, match clock, batt, info
├──────────────────────────────────────────────┤
│                                                │
│                  ██  ALIVE  ██                 │  STATE band — the single most important pixel:
│                                                │  a full-width color field (green ALIVE / red DOWN)
├──────────────────────────────────────────────┤
│  HEALTH ███████████████░░░░░   32              │  two fat bars, huge tabular numerals
│  ARMOR  ████████░░░░░░░░░░░░   18              │
│                                                │
│            AMMO   36        ☠ by YELLOW        │  ammo giant; killed-by line (team-colored)
├──────────────────────────────────────────────┤
│   K —MC    D 2    A —MC    ACC —MC             │  bottom stat row (kills/assists/acc = MC-owned)
└──────────────────────────────────────────────┘
```

- **STATE band is the hero.** Peripheral-vision readable: when you die the whole band goes red and
  the ALIVE→DOWN swap is unmissable without focusing. When DOWN it becomes the **respawn countdown**:
  a giant number ticking down over red, plus a shrinking bar.
- Health/armor keep the seed's fat bars (`.bar`/`.bar.armor`) but **scaled up** and paired with the
  numeral — never a bar alone (color-blind + glare safety). Health bar color steps green→amber→red at
  ~50%/25% for glance-readable danger.
- Ammo is the largest number on the screen after the state band — it's what a player checks mid-firefight.
- Match clock (`⏱`) counts down `time_limit_s` off synced time; hidden when `time_limit_s==null`.

### 4.2 Outdoor / sun-glare palette

Non-negotiable (README §7). Rules the palette must obey:

- **Maximum contrast, minimum chrome.** Near-black ground, pure-white/pure-color foreground. No subtle
  greys for anything load-bearing — glare eats them. The seed's `--dim` mid-greys are fine for the log,
  **not** for HUD values.
- **Color = state, not decoration.** Green=alive, red=dead/danger, amber=warning (low hp / low batt),
  team color only on the identity chip + killed-by line. Nothing else is colored, so a color *means*
  something at a glance.
- **Big type, tabular numerals** (`font-variant-numeric:tabular-nums`, already in the seed) so numbers
  don't jitter as they change.
- **No thin strokes, no gradients, no shadows** as the only signal — sun flattens them.
- Force **full brightness** while the HUD is foregrounded (Capacitor: keep-awake + max screen
  brightness); a dimmed auto-brightness screen is unreadable outdoors.

### 4.3 Blackout night mode (no light leak)

For `night:true` games (or a manual toggle): a phone glowing on a dark field paints a target.
Blackout means **truly dark**, not "dark theme":

- Screen goes to **pure `#000`** with only the few pixels that must exist. Kill the STATE band's
  color field — replace with a thin outline; render health/ammo as **dim red** (retains night vision,
  lowest visible-at-distance signature) at minimum legible size.
- **On damage/death, no bright flash** — the gun's own audio/haptics carry the alert; the screen must
  not strobe and give away position. A brief haptic tick (§ Capacitor Haptics) replaces visual pops.
- Drop screen brightness to minimum-usable; disable any white UI (log, diagnostics) while blacked out.
- Blackout is a **display concern only** — the engine, frames, and events are identical. It ships on
  **both platforms**; nothing here is platform-specific (§8).
- One-tap toggle reachable without leaving the HUD (long-press the STATE band), plus auto-on from
  `config.night`.

### 4.4 State → display mapping (single source of truth)

| lifecycle (§3.8) | STATE band | health/armor/ammo | stat row | notes |
|---|---|---|---|---|
| IDLE | grey "SET GUN" | — | hidden | picker CTA (§7) front and center |
| CONNECTED | grey "READY" | live from gun | hidden | gun linked, not yet kitted |
| KITTED | team-tint "KITTED" | caps from config | shown, all "— MC" | shows loadout/weapon name |
| LOBBY | team-tint "READY UP ✓/○" | caps | shown | ready toggle sends `ready` to MC |
| ARMED (countdown) | **giant T-minus** | full caps | shown | M-START countdown; gun plays klaxon |
| LIVE · ALIVE | **green ALIVE** | live | K/D/A/ACC | D is local-real; K/A/ACC = MC |
| LIVE · DOWN | **red + respawn count** | health 0, ammo dim | stat row frozen | "☠ by <TEAM>"; countdown = `deadline_s` |
| DISCONNECTED | amber "RECONNECTING…" overlay | last-known, dimmed | last-known | non-destructive; returns to prior state |

**Honesty rule (README §6, contracts §4):** **Kills, Assists, Accuracy render literally as "— MC"**
until MC pushes them, because a phone node cannot observe them (host-blind about own kills; hits-landed
known only from victims). **Deaths and ammo are locally real.** Never show a fabricated kill count —
the "— MC" is a deliberate honesty affordance, not a placeholder to be filled with a guess.

---

## 5. Diagnostics — an optional info button for field debugging

Behind the `ⓘ` in the top strip (never in the player's way). A slide-over panel exposing the raw
state the seed already logs, made inspectable on the field:

- **BLE link:** deviceId (opaque handle §8), connection state, retry count, last disconnect **HCI
  reason code** with plain-English gloss (`0x16` local, `0x13` gun/headset gate, `0x08` out-of-range,
  `0x3E` failed-establish — table from `handoff-ios-ble-findings.md` §2). This turns "it dropped" into
  "the *gun* hung up (0x13 — headset gate)" on the spot.
- **Last frames:** a live tail of parsed frames in/out (the seed's `#log`), with the hardened
  reassembler's output so a merged-notify shows as two clean frames.
- **Engine state dump:** hp/armor/ammo/alive, `lastShooterTeam`, `deadAt`, config_id, team, caps.
- **Link + battery:** RSSI (from scan), `$VOLTS` pack%/cell mV, time since last `$VOLTS`.
- **Timings:** clock offset vs MC (contracts §7), last heartbeat sent, queue depth (unflushed events),
  Transport state.
- A **Panic** button (house-rule sequence) and a manual **reconnect** here too, for field recovery.

The panel is diagnostic-only — it must not be a path to arm/fire the gun in a way that bypasses the
game engine.

---

## 6. Log capture + export

The seed's in-DOM `#log` becomes a **rolling on-device log** the node can hand to MC or share out.

- **Rolling ring buffer**, bounded (size + line count), timestamped, persisted across restarts (so a
  crash/power-cycle keeps the pre-crash tail). Captures: frames in/out, connect/disconnect + reason
  codes, state transitions, emitted Events, config applied, panic.
- **Offer to MC:** on connect (or when MC asks) the node sends `log_offer{node_id, bytes, lines}`
  (contracts §5); MC replies `pull_log{}`; the node uploads the buffer as an `event_batch`-style
  transfer (M-NET defines the chunk framing). This feeds MC's recap ingest (README §7 "MC can ingest
  node logs at recap").
- **Share out:** a **Share** button in diagnostics uses the native share sheet (Capacitor Share /
  Filesystem) to export the log as a text file — for offline debugging when MC isn't around. On
  Android/iOS both, plain UTF-8 text; filename `brx-node-<gun_tail>-<ts>.log`.
- **Redaction:** the log is field-debug data, not PII — but it contains the opaque deviceId and gun
  name; that's fine (both are already on the sticker). Don't log vanity gamertags beyond what MC sent.

---

## 7. BLE plumbing to preserve (reference, don't re-derive)

All of this exists in the seed and is **hardware-proven** (ADR-0001 confirmations; iOS handoff).
**Carry it forward unchanged**; the notes say *why* so a refactor doesn't regress it.

- **Init exactly once.** `ensureInit()` memoizes `BleClient.initialize({androidNeverForLocation:true})`.
  iOS `initialize()` **replaces** the CBCentralManager and drops every live gun — a second call
  disconnects the gun (`cap9`). **A "rescan" button must not re-init** (handoff §1).
- **Connect-with-retry.** BRX establishment succeeds ~1 in 3; retry 5–6 attempts with a guard closure
  (`connectWithRetry`). Shared by first-connect and reconnect. `deviceId` is committed **only on a
  successful connect** (handoff §4) so `updateStart()`/arming can't enable for an unconnected gun.
- **Continuous low-latency scan picker.** `requestLEScan({allowDuplicates:true, scanMode:2})` +
  our own in-app list (not `requestDevice`'s one-shot picker), accumulating hits until the player
  taps. Shows name + **MAC-tail suffix** + **RSSI** (closest = in your hand) to disambiguate two
  `Tactix2` guns on iOS (handoff §3). Enrolled guns advertise `<$NAME>-<tail>` → unambiguous.
- **Hardened reassembler.** `pump()` splits on both `*` and `$` boundaries to survive merged
  notifications (`$ALCD,..$BUT,0,1,*`). Keep it; it's the parser the whole engine trusts.
- **20-byte chunking + pacing.** `sendFrame` writes 20-byte chunks with `writeWithoutResponse` +
  8 ms inter-chunk / 18 ms inter-frame sleeps; a per-device write queue (`enqueue`/`wq`) serializes
  writes. Proven for full config+spawn arms with >20-byte frames (ADR-0001 G5).
- **`androidNeverForLocation`** in `initialize()` **and** the `neverForLocation` manifest flag (via
  `app/scripts/android-setup.sh`) — lets Android 12+ scan **without** the system Location toggle. iOS
  ignores the option (harmless). iOS also needs `NSBluetoothAlwaysUsageDescription` (via
  `app/scripts/ios-setup.sh`) or the app is terminated on `initialize()` (handoff §5).
- **Auto-reconnect** on `onDrop` with the same retry loop, guarded by `me.deviceId` so a deliberate
  disconnect doesn't fight the user.

Refactor guidance: extract the above into a `BrxLink` module (init/scan/connect/write/notify) so the
**engine** talks to it through a thin interface — that same seam is where the Companion swaps BLE for
its native ESP32 stack.

---

## 8. Cross-platform notes

- **`deviceId` is opaque.** Android → MAC, iOS → per-device CoreBluetooth UUID. Treat it as a handle;
  **never persist it and expect meaning on another phone/OS** (contracts §1: correlate by
  sticker/advert name, not address). Binding to MC uses the **gun tail/name**, not the deviceId.
- **Scan labels:** the MAC-tail suffix is real on Android; on iOS the "tail" is derived from the UUID
  and is only locally stable — still useful for disambiguation, not for cross-host identity.
- **Blackout works on both** (§4.3) — it's pure CSS/brightness; no platform BLE difference. Keep-awake,
  brightness, haptics, and share all go through Capacitor plugins that resolve per-platform.
- Everything in `mcp/` stays cross-platform (bleak) for the bench; the **node** stays Capacitor
  (Android + iOS) — one web UI/engine, native BLE. Web Bluetooth is **ruled out** (ADR-0001; iOS has
  none) — the node is a **native app**, and the webapp harness is not a player path.
- iOS deployment target 15.0; iPhone X (16.7) supported. Generated `ios/`/`android/` are rebuilt —
  platform settings live in `app/scripts/*-setup.sh`, never hand-edited in Xcode/Studio.

---

## 9. Task breakdown

1. **Extract the engine** from `app.js` into a DOM-free state machine over contracts §6 (states,
   `handleFrame`, death/respawn, event emission). Unit-testable with a fake BRX frame source.
2. **Extract `BrxLink`** (§7) behind a thin interface; engine ↔ link seam = the Companion port point.
3. **Wire M-MODES** `armFrames(config, player)` / `reviveFrames` in place of the hard-coded arrays;
   caps + respawn + weapon come from `GameConfig`.
4. **Wire Transport** (M-NET): `hello`/`bind`/`assign`/`event`/`event_batch`/`ack_config`/`feedback`/
   `control`/`tutorial`/`start`; the bounded persisted event ring + reconnect flush.
5. **Rebuild the HUD** to §4: STATE band, scaled bars+numerals, match clock, stat row with honest
   "— MC", full lifecycle mapping (§4.4).
6. **Blackout mode** (§4.3): night palette, no-flash-on-damage, brightness/haptics, toggle + auto.
7. **Diagnostics panel** (§5): reason-code decode, frame tail, state dump, timings, panic/reconnect.
8. **Log ring + export** (§6): persisted buffer, `log_offer`/`pull_log`, native share.
9. **Tutorial arming** (§3a): handle `tutorial{weapon}` → silent private arm so the player can feel a
   weapon before committing (M-MODES supplies the frames).
10. **Clock sync** (contracts §7): `time_req`/`time_res`, smoothed offset, `synced_now()` used by all
    event `t`, respawn, and countdown math.

Ships with its own fakes (a scripted BRX frame emitter + a mock Transport) so it builds and demos with
neither a gun nor MC present — matching the seed's "runs with the LAN dead" property.

## 10. Open questions

- **Q1 — shot detection source.** Is a reliable `shot` event derivable from `$ALCD`/`$LCD` ammo
  deltas alone, or do we need `$BUT` trigger frames? Ammo deltas false-positive on reload/pickup.
  *Recommendation:* prefer a trigger frame if one exists; else ammo-decrement-only with a reload guard,
  and mark accuracy's shots-fired as approximate until validated on hardware.
- **Q2 — respawn ownership for `scanner`/`none` modes.** Does the gun emit a respawn-point signal the
  node can observe, or must the node stay DOWN until an `$HP` refill appears? Needs a bench check;
  affects §3.4.
- **Q3 — hit vs. death dmg accounting.** `hit_taken.dmg` = `$HP`+armor delta; confirm armor-vs-health
  order so `dmg` matches what MC expects for assist windows (contracts `ASSIST_WINDOW_MS`).
- **Q4 — `$VOLTS` token map.** Seed reads token 3 as pack %; protocol §`$VOLTS` marks the last two
  tokens "likely charge %/levels (TBC)". Confirm which token is the battery % the HUD/readiness shows.
- **Q5 — cached-config rejoin (§3.7).** How much of a prior game may a power-cycled phone re-arm from
  cache without MC in range before it's unsafe/stale? Propose a config TTL + a "stale config" HUD warning.
- **Q6 — keep-awake vs. battery.** Full brightness + keep-awake + continuous BLE drains the phone over
  a long event. Measure; consider dimming only the non-STATE zones between firefights.
