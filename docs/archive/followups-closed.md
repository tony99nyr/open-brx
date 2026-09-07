# Closed followups (archive)

Moved out of `docs/FOLLOWUPS.md` on 2026-09-06. **Not maintained; grep it, do not read it.** Each block is
verbatim, headed by the id, its close date and the line range it occupied in `FOLLOWUPS.md` at the time of the
move. A block's *internal* statuses were true when it closed and may since have been superseded (the living
files win: `docs/manual/`, `docs/spec/contracts.md`, `protocol/brx-protocol.md`, `docs/FOLLOWUPS.md`).
Ordered by close date. Evidence for every claim is in `docs/experiment-log/`.

---

# Historical A–G followup lists (experiment-log snapshots)
*superseded 2026-08-27 · was experiment-log.md L200–281 and L486–511*

# Followups — open research, prioritised

> **HISTORICAL — superseded by [`docs/FOLLOWUPS.md`](../FOLLOWUPS.md)**, the single source for open
> work. This A–G list is kept as a notebook snapshot; do not treat its statuses as current.

## A. The range problem — **ANSWERED 2026-08-23, see entries 17-19 and protocol §7n**

> **Closed as answered, not solved.** Respawn and game time are not in the protocol
> stream, and the gun keeps no score. BLE cannot support out-of-range play; it is a
> design property. The reasoning below is kept for context. **The live thread is now
> the nRF radio** (D).


Our `arena` command drives everything from the host: it detects `$HP,0,` and sends
`$SPAWN,,*` itself. **That only works while the laptop is in BLE range.** On a real field
players leave range within seconds, and a downed player would simply never respawn.

The official system sidesteps this — **each player carries their own phone**, so the BLE
link is always about a metre away and the phone can be the game engine. One-laptop-many-
taggers is a fundamentally different topology.

What has to be true for it to work:

1. **The tagger must respawn itself.** The manual (§7h) lists respawn as an *on-gun*
   setting (off / 15 / 30 / 60 / ramp45 / ramp90 s), so the firmware can already do this —
   we just have not found the command. **Almost certainly a `$GSET` token.** Highest
   priority: decode it, then stop driving respawn from the host.
2. **Game time and lives likewise** — same `$GSET` frame, same experiment.
3. **The tagger must accumulate results while disconnected.** Unknown whether it does.
   `$SP` is documented as an end-of-game report and `$UP` as a status report; neither has
   been probed. If the gun keeps score, players return to the laptop and we read it. If it
   does not, one-laptop scoring is impossible for out-of-range play and the design must
   change (a relay/repeater, per-player phones, or the nRF radio — see D).
4. **Reconnect-and-read flow.** Scan → connect → pull results → display. Needs 1–3 first.

**Do not build more host-driven game logic until A1 and A3 are answered.** The current
respawn loop is a demo of the protocol, not a design for a real match.

## B. Death/respawn UX

Players need to know how long they are waiting. If A1 lands, the gun owns the timer and
most likely announces it (the official app shows a HUD countdown because the phone is on
the player). Check what the gun does on its own before building anything host-side —
we may get the countdown for free.

## C. Values and states still unknown

| Item | Why it matters | Method |
|---|---|---|
| `$GSET` token map | respawn, game time, lives, mode — see A | differential capture: change ONE app setting, re-capture, diff |
| `$WEAP` 44 tokens | custom weapons | same; the manual's stock stats (§7h) are anchors — M-4 damage 24 already matches |
| Per-player identity | `$HIR` gives shooter *team*, not player (§7k). FFA scoring needs per-player | `QUERY` reports a device-level `PlayerID` we have never changed — find the command that sets it |
| `$TID,0,*` | neutral LED for FFA (§7i) | one-line test |
| `$HIR` `45,0,0` / `70,0,0` | recur across matches, unexplained; the numbers equal starting HP/armor | correlate against what the operator was doing |
| `$HIR` IR protocol per weapon | two frames came as `$HIR,0,...` not `4` | fire each slot deliberately, watch token 1 |
| `$SFLASH,*` | **RESOLVED §7o:** shooter's green-sight kill-confirm flash, 1/kill (old "periodic" note was a victim-side capture) | — |
| `$SP` / `$UP` | central to A3. **`$UP,*` probed — no reply (§7l)**; LaserTagMods' arg form looks like a write. `$SP` must NOT be probed on hardware ($SP,99 is half the panic sequence) | learn both from a full end-of-game capture instead |
| Headset lockout | manual says a headset lost mid-game locks the gun (§7h). **Never controlled for in any experiment** | run one match headset-paired, one headset-off-from-boot |

## D. The nRF radio — **NOW THE CRITICAL PATH** (A is closed; this is the way out)

`QUERY` reports `NRFhost 1` and `NRFslave 1`, and LaserTagMods build LoRa/nRF base
stations (`NRFL-Bases`, `LoRa-Controlled-Taggers`). **The taggers may already have a
long-range radio that is not Bluetooth.** If so, the range problem may have a native
solution and BLE is simply the wrong transport for field play. Unprobed, and potentially
more important than anything in C.

## E. Sound inventory

Wanted: the complete sound bank, so audio can be designed rather than guessed.
**The microphone sweep is a dead end** (see entry 7 — the negative control failed).
Better routes, in order:

1. **Decompile the Callsign Android APK.** The app has to know every sound id it sends, so
   the list is in there — very likely with names. This is the highest-value route by far
   and needs no hardware.
2. **`$PSET`'s audio-set tokens.** The trailing `H44,JAD,V33,V3I,…,A10` list appears to be
   a positional voice pack (the "GET SOME" respawn line came from it, not from any `$PLAY`
   we sent). Change one token, hear which line changes — maps meaning, not just existence.
3. **Battle Company's updater sound package**, if it ships sounds as files.

---

# Followups — added 2026-08-24

## F. Smart Grenade — never touched; build a better config path ⚠️ HIGH INTEREST
The grenade enables objective modes (the user runs CTF, KotH, Assault with it) but its on-gun
config is **hard and buggy**. We have NOT connected to or configured a grenade yet. What the APK
tells us (see `callsign-extract/apk-harvest.md`):
- Grenade mode/type is set by **`$GREN` sent to the GUN**, which programs the grenade — NOT a
  separate BLE device, NOT a QR code. Fields: iRType,crit,modifier,indoorMode,operationMode,
  channel,GrenadeType,MaxCount. GrenadeMode = FlashBang/Gas/Confusion/Molotov.
- **The win:** a clean scriptable `$GREN` frame (via MCP / the Companion) replaces the buggy menu.
- **Hardware tests needed:** (1) does `$GREN`→gun take effect immediately, or only while a grenade
  is "loaded"/tapped to the gun's IR? (2) map each field's effect (channel, MaxCount, the mode
  selector). (3) BLE-scan with a grenade powered on — is it visible at all? (protocol §7 still
  lists this as unknown). (4) capture the official app configuring a grenade (PacketLogger) to see
  the exact `$GREN` it sends.
- **No public grenade manual found** — only the product page + a YouTube "Grenade Basics" demo
  (arm by pulling clip + button, underhand throw, ~3 s after impact, 30 ft radius). If a manual
  surfaces, add it to `docs/reference/`.
- **Goal:** a proper grenade-config UI in the webapp + an MCP `configure_grenade` helper, so
  objective modes (CTF/KotH/Assault) become reliable.

## G. Accessory hardware — BRX Companion spec written
`hardware/brx-companion-spec.md` — the per-tagger ESP32-S3 module (offline game engine + powerups
+ custom audio + Wi-Fi sync). Next: prototype Tier-0 "Brain" and validate the powerup command
sequences ($LIFE/$WEAP re-push/$AMMO) on hardware.


---

# Done (for reference)
*closed 2026-08-25 · was FOLLOWUPS.md L2127–2135*

## Done (for reference)

- ✅ Remote game start (`$SPAWN,,*` + `$AMMO` + `$BMAP`), two-tagger arena, `$HIR` team attribution
- ✅ `$GSET` map (hardware-confirmed), `$WEAP` token positions, `$PSET`/all command field maps
- ✅ Complete 2166-id sound bank (retired the mic-sweep dead end)
- ✅ Game modes, QR-station system, weapon-spawn types, grenade modes (APK harvest)
- ✅ Headset re-pair procedure recovered (`community-notes.md`) — the fix for the lockout that blocks firing
- ✅ Link stability (retry 5×; connecting is 1-in-3 flaky, holding is fine)


---

# Snooping — do we need more?
*closed 2026-08-25 (answered: P8 is the only capture left) · was FOLLOWUPS.md L2152–2164*

## Snooping — do we need more?

The APK teardown gave us the command **structure** (field names, order, enums) but the deeper dive
(UnityPy, 2026-08-24) proved the game **data** (weapon stats, voice-profiles, secondary-fire values)
is **server-fetched, not bundled**. So two capture routes remain, both gun-off-friendly:
- **P8 — Callsign HTTPS API capture** (MITM proxy) — the highest-yield: `settings`/`voice-profiles`/
  `arenas/games` endpoints hand over weapon/voice/game data in one shot. Answers P1, P3, weapon stats.
- **Targeted one-setting BLE captures** — P1 ($WEAP secondary), P3 (voice profile), G3 (grenade);
  a full end-of-game capture settles P4/P7. These need the gun.

No broad "watch the app over BLE" sweep is needed; the remaining data is either in the server API or
in a couple of one-setting diffs.


---

# Bench 2026-08-25 (late) · Phone-path bench · Phone HUD polish · end-of-match (fixed in 5278561)
*closed 2026-08-26 (open bullets carried into FOLLOWUPS.md) · was FOLLOWUPS.md L2186–2244*

## Bench 2026-08-25 (late) — new items
- ✅ **ANSWERED 2026-08-30 — LED life mode.** The "slow blink" **was** the life gauge: three LEDs pulsing
  in the team colour, stepping down as health falls (Tony, native FFA). Confirmed in native games; the open
  part — does it appear in **our compiled** games? — is tracked in **F1**, not here.
- **5-min hold-across-disperse** — re-run (the 2-min run passed; the 5-min run was cut by the headset event).
- ✅ BUILT (5278561, peer session: MC pushes `victory` to the winning team's connected nodes at recap + e2e test; defeat line still unpinned) **Victory cue wiring** — `compile.py` now has `victory` (VSF+JAY) separate from `game_over` (VA33); MC should
  send `victory` to winning nodes in coverage at recap (M-MC), losers get nothing extra. Find a defeat line
  (`JAW`/`JAX` are 8-s announcer lines next to `JAY` — pin by ear).
- **Reconnect-after-`$DISCONNECT`** — a fresh link right after the gun's own `$DISCONNECT` comes up dead
  (NUS TX char missing). Node should back off ≥5 s before reconnecting after a gun-initiated drop; log it.
- **Node: detect a power-cycled gun** — after resync, a `$SPAWN` that echoes `$LCD,0,0,0,0,0,0` means the config
  was wiped (power-cycle): re-write the head (§3.10 "silence → re-push" gets a second, positive trigger).
- ✅ FIXED (5278561, peer session) **MC banner** printed `nodes: ws://<ip>:0/ws` before the net server binds — print after `_start_net`.
- **Phone-path bench** (items 4/8/13 + the whole MC↔phone↔gun path) — APK is on the Pixel; MC runs on the
  Windows Python (`/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe -m brx_mcp.mc --no-auth`).

## Phone-path bench 2026-08-25 (night)
- **Try-out LED flashes** — the gun fires in try-out but the LEDs strobe (standby/unspawned pattern). Find the
  LED-quieting token for the tutorial head (relates to the LED-life-mode item above).
- **MC self-discovery on the phone** — MC advertises `_brx-mc._tcp` over mDNS; the app should auto-fill the MC
  URL (and offer a camera QR scan) instead of manual `ws://ip:8766/ws` entry.
- ✅ FIXED (5278561: full-width MC LINKED ✓ chip on the connected screen) **HUD: MC-link state is too subtle** — "MC LINKED" is tiny green top-right; make link/disconnect obvious.
- ✅ FIXED (5278561: moved to the free corner) **HUD: info icon clips behind "LINKED"** on the post-connect screen (CSS alignment).
- **Node keep-alive across shade/short-lock** — investigate a foreground-service or wake path so a brief shade
  pull / glance doesn't drop the socket (today it recovers in ~10 s; acceptable but not ideal).
- **HUD weapon-select (self-serve kitting)** — let each player pick/try weapons on their own phone during KIT
  instead of the operator running tryouts one at a time. Fits the architecture: HUD shows the catalog (already
  in `welcome`/`assign`), player taps → node sends a **new up-message (loadout/tryout request)** → MC pushes the
  existing `tutorial` frames (just proven on hardware) and records the selection as the player's loadout for
  compile. **MC gates it** with a per-session/per-mode setting (allow vs lock weapon-select on the HUD) — some
  modes want fixed loadouts. Touches: node HUD picker + `engine`/`transport`, a NODE_KIND, contract, MC state.

## Phone HUD polish — bench 2026-08-25 (night), on-device findings (batch before next bench)
- ✅ FIXED (5278561, pending device re-test) **Cam button dead** — `@capacitor-community/camera-preview` throws: the Android manifest has no `CAMERA`
  permission (only INTERNET/BT/LOCATION) and no runtime request; iOS needs `NSCameraUsageDescription`. Add both
  in `scripts/android-setup.sh` / `scripts/ios-setup.sh` + request at first toggle.
- ✅ FIXED (5278561) **RELOAD blinks constantly** — `lowMag = st.ammo/st.mag <= .15` fires in transient states; should only show
  when live, alive, ammo<mag, ratio<=.15 (never at spawn / on a fresh mag).
- ✅ FIXED (5278561: bigger pips + warn gating; root cause was the boot hang + warn rule) **Ammo pips bar bugged** — the pip strip above the weapon name shows a single yellow tick at full ammo
  instead of a filled magazine; `_pips()` mis-maps mag→pips (likely divides by the wrong max or fixed pip count).
- **Top-right cluster cramped/tiny on device** — LINK + battery + CAM chip on one skewed row plus K/D/A/ACC
  reads micro on a phone; needs a responsive pass (bigger CAM target, wrap/space the row).
- ✅ FIXED (5278561: edge-triggered cues, runway_30/20 silenced; re-verify by ear) **Countdown audio bunches on the gun** — heard "10,9,8,10,3,2,1" with the last 3-2-1 together; the node's
  runway/countdown voice cues are scheduled or written with wrong timing/duplication. Review the M-START
  countdown scheduler on the node (BLE write pacing vs tick clock).
- (already logged: info icon clips behind "LINKED"; MC-LINKED text too subtle; MC mDNS auto-fill + QR.)
- **Non-cam layout should differ from cam-overlay** — the HUD is designed as a camera overlay (scrims, vignette,
  edge glow, thin skewed chips). With no camera behind it, that reads cramped/hard. Want a distinct **no-cam
  layout**: drop the overlay scrims, use the full screen for big readable HP/ammo/clock/K-D, and switch to the
  overlay treatment only when CAM is on. (Design-tool pass — Tony owns the HUD visuals per the design workflow.)

## Phone HUD — end-of-match + history (bench 2026-08-25 night)
- ✅ BUILT (5278561: GAME OVER + K/D/A/ACC/shots + session totals → OK → MATCH COMPLETE; VICTORY/DEFEAT variants still need the winner reaching the node) **No game-over / victory / defeat screen** — at match end the HUD shows nothing (no result, no stats). Want a
  real end screen: VICTORY / DEFEAT / GAME OVER banner + this player's K/D/A/ACC, an **OK** button → the existing
  "MATCH COMPLETE — READY FOR NEXT" idle-between-games screen. (MC already sends `score`/recap; the node has its
  own totals.) Ties into the `victory`/`game_over` cues just pinned (VSF+JAY / VA33).
- ✅ BUILT (5278561: localStorage per-match history, session totals on the result screen; a browsable history view is still open) **Game history / running totals (nice-to-have)** — keep per-game results on the phone (localStorage) so a
  player can see how they did each game across a session; optional lifetime totals. Node-local, no MC needed.


---

# Night session 2026-08-25→26 — root cause worth remembering
*closed 2026-08-26 (open bullets carried into FOLLOWUPS.md) · was FOLLOWUPS.md L2245–2325*

## Night session 2026-08-25→26 — root cause worth remembering
- **Capacitor plugin proxies are thenables-of-doom**: any promise that RESOLVES WITH a plugin proxy makes
  `await` call `proxy.then()` (a fake native method) and NEVER SETTLES — the app's whole boot hung there on
  device and web, silently killing keep-awake, the app-state listener, auto-scan, cam and demo mode. Rule:
  never let a plugin object be a promise's resolution value — box it (`{v: Plugin}`). Regression canary: the
  `?demo` page must reach phase `connected` (playwright harness in the scratchpad did this).
- **Screen-lock answer (Tony's question)**: with the boot fixed, keep-awake holds FLAG_KEEP_SCREEN_ON → no
  auto-lock (re-asserted on every foreground). Still IMPOSSIBLE to prevent from an app: power-button lock,
  incoming calls, user-initiated backgrounding — webview JS suspends; engine reconciles on resume (§3.11).
  The remaining hardening option is the Android foreground service (manifest already carries the permission)
  plus moving T-0/respawn/expiry into native — logged above, M3-scale.
- Verify on device next bench: KEEP_SCREEN_ON flag present (`dumpsys window`), cam permission prompt + preview,
  countdown by ear (single count, no stacking), result screen after a real match. Webview devtools now
  enabled in debug builds (`webContentsDebuggingEnabled`) — `adb forward tcp:9224 localabstract:webview_devtools_remote_<pid>`.
- **$WEAP tok3/tok4 naming** — captured frames all carry the $SIR protocol number at tok3 (charge 8, gas 11, **[UPDATE 2026-08-26: t3=damageType is working truth — U6 evidence, see protocol-classes note]**
  melee 13, rocket 10), so wire.proto lives there; but the metadata order (damageType vs powerType) and the
  SUBTYPE-at-tok4 guess (sniper 1 / AMR 3) are unpinned — one-field Callsign capture arbitrates (brx-opus2).
- **Rocket desc couples to default health** — the blurb says 115 beats a default kit (45+70); update if the
  default health block changes.

- **Persist the session (roster/kits) across MC restarts.** 2026-08-26: an MC restart mid-setup wiped the
  in-memory roster; a connected phone then sat on "WAITING FOR KIT-OUT" with no hint why. Snapshot
  roster+kits to `~/.brx-mcp/session.json` and restore on boot (phase resets to muster, players survive).

- **SUPERSEDED — t20 = fire mode + t23 = burst cycle, PROVEN 2026-08-26 (see the U0-closed entry).** ~~Capture the burst-fire token.~~ 2026-08-26 field: Burst Rifle fired single heavy shots (no burst) —
  our 4 captured $WEAP samples (ar/charge/laser/rocket) never exercise burst. `burstWeaponTime` is now
  **suspected at `tok23`** (raw idx24; a sniper probe read ≈275 there, unverified). But the
  `GunWeaponType` enum has **no burst member** (C2 in `weapon-design.md`), so a "burst rifle" may only
  ever be a fast-cadence weapon with burst-shaped audio — capture Callsign's Burst Rifle frame to settle
  whether `tok23` changes anything. Until then it's tuned as fast tap-fire (14 dmg / 180 ms).

- **SUPERSEDED same day — t20 IS the fire mode, PROVEN by one-field flip (see the U0-closed entry).** ~~Original claim: fire-mode token likely does not exist.~~ Original text: Range session 2026-08-26:
  sniper and shotgun fire FULL-AUTO on trigger hold. **Eliminated** as the selector: `tok1` (sniper
  `tok1=2`, still full-auto) and `tok19`=`reloadType` (a reload mechanism — probe changed nothing).
  The `GunWeaponType` enum (`FullAutoFire/Bow/ChargeAndAutoRelease/ChargeAndRelease`) has **no semi
  member**, so per-pull semi-auto may not be expressible in this firmware — every built weapon stays
  full-auto. **What DID resolve:** fire RATE is now real — `tok14` = fire-interval ms is **bench-PROVEN**
  (sniper `1250`→1 shot/s), and the compiler bug that had pinned every weapon at 10 shots/s is fixed
  (it wrote `fire_ms` to the constant `tok15`; now writes `tok14`, commit a5dbec2). Cadences work; only
  per-pull discipline can't be enforced.

- **Bench: held-trigger fire sounds — retrigger-from-zero or ring-under?** Decides whether any
  sound-duration ceiling exists at all (weapon-design §3.3 void note, 2026-08-26).

- **Directional hit mechanics are now buildable** (2026-08-26): $HIR tok1 = 0 front dome / 1 back
  dome / 4 gun body, shield-isolated. Design candidates: backstab bonus, flank callouts, HUD hit
  direction indicator. Field-distance validation recommended before shipping a mode on it.

- **Special weapons & accessories design space (Tony, 2026-08-26).** The protocol natively supports it:
  (a) the victim-side `$SIR` matrix interprets each IR protocol/subtype separately (sound + undecoded
  numeric params — likely modifiers) → per-weapon on-target effects; (b) **medic heal-gun**: custom IR
  protocol + harmless `$SIR` row + Companion reads the `$HIR` tok2 protocol echo and applies +HP —
  buildable today with attribution; (c) **EMP grenade** — ⚠️ **UPDATED 2026-08-27: `$SIR` fn 23 is NOT a stun, it is AUDIO SUPPRESSION** (the gun keeps firing and keeps emitting IR; it just goes silent for ~6–8 s). **No `$SIR` function has produced a stun; U11 is REOPENED.** The live lead is to capture the **native Sentinel EMP ability word** and read its protocol/subtype off the wire. Original note: `$STUN` direct command is a NO-OP (probed 4 arg shapes 2026-08-26 — stun is likely IR-delivered via a $SIR row, weapon category 10 'Stun') +
  `$GREN`/`$BUT` (grenade + alt-fire button notifications, unprobed) — bench-probe these three next
  session; (d) decode the `$SIR` row params (e.g. `90,1,40` / `100,2,60`) — probably damage %/stun.

- ✅ **U0 CLOSED — t20 = fire mode, PROVEN by one-field flip (2026-08-26).** 0 auto / 7 single / 9
  burst (+t23 cycle) / 2-3-14 charge variants / 13 melee. Sniper flipped 7→0 changed single-shot to
  full-auto on the bench; captured Burst Rifle fired true 3-round bursts. The re-based catalog ships
  native modes.

- ✅ **Overheat mechanism SOLVED (2026-08-26): t37/t38 enable it** — SMG + t37=20/t38=150 transplant
  brought the dead heat gauge alive (28→52/dump, trigger gating at top). t24/t35 are inert without
  them. Remaining: map what 20 vs 150 each mean (two varied-value probes).

- **U2 (t41 range) — OPEN, one tantalizing positive.** t41=100 killed at max indoor distance; t41=5
  read zero — but the session ended in rig degradation (point-blank zeros on a known-good frame), so
  5's zeros are unattributable. **METHOD SUPERSEDED 2026-08-26 (IR kit arrived):** run it against a
  **VS1838B receiver** instead of a victim gun — fixed distance, `ir-range` detect%/decode% at t41=100
  vs 5 with a closing 100 control. Removes the screamer/arming-race failure mode that contaminated the
  first attempt. See `docs/bench-plan-hardware.md` Session 1½a.

- ✅ **`$GSET` token1 RESOLVED 2026-08-26 — it IS friendlyFire, and it IS firmware-enforced.** The
  earlier "not enforced under either value" reading did not survive a controlled, repeated matrix
  (IR emitter + BLE readback): at **t1=0** same-team damage and enemy heals are both **blocked**; at
  **t1=1** every combination registers. The token switches whether team identity is enforced on
  incoming IR effects. See P9 and the experiment log.
- **Fleet ops rule: POWER-REST the guns.** Two "screamer" failures on day-long-powered taggers
  (2026-08-26): advertise-but-won't-link / connect-then-drop. Rotate power between sessions; never
  bench-marathon a match-day fleet.


---

# Q12 — the shield pool is discarded in code (fixed + original report)
*closed 2026-08-27 · was FOLLOWUPS.md L1990–2050*

## ✅ Q12 — FIXED 2026-08-27 (was: the shield pool is discarded in code)

**Fixed in `mcp/brx_mcp/protocol.py` and `app/src/engine.js`, with regression tests.**

Bench evidence that forced it (`docs/experiment-log.md` 2026-08-27): the shield is a **real,
damage-absorbing pool** — shield 150 took four 30-damage hits as `150/120/90/60/30` with HP and armour
**untouched** — and its ceiling is `$PSET` token 5.

**The bug was worse than "the shield isn't displayed".** `_onHp` summed only `hp + armor`, so a hit
absorbed entirely by the shield computed `dmg === 0`, and the `dmg > 0` guard then dropped the
`hit_taken` fact **completely**. Against the measured sequence above, **all four hits would have
emitted nothing at all** — no HUD feedback, no MC event, no score, while the player really was being
shot.

What changed:
- `protocol.py` now parses `$HP` as `<hp>,<armor>,<shield>` (it read only `<hp>`).
- `engine.js` tracks `this.shield`, includes it in the damage total, and reads **`$HP`** token 3.
  ⚠️ **Not `$LCD`.** A first version also read `$LCD` token 3; it was **reverted 2026-08-28** as a bug.
  `$LCD` tokens 3-4 are undocumented and read 0 in every observed frame, so that write could only
  *zero* a live shield, recreating Q12 verbatim. `engine.js` carries a comment saying not to re-add
  it. Open question filed as **B20**.
- Spawn and respawn **zero** the shield, matching hardware: `$PSET` t5 is a capacity filled by an
  fn-11 grant, never a starting pool. A stale shield would have inflated the next damage computation.
- Two regression tests in `app/test/engine.test.mjs` (48/48 pass; Python 533/533).

**Still open (design, not code):** whether `hit_taken` should carry the shield delta as a separate
field so the HUD can distinguish "your shield ate that" from "you took it in the face". The fix above
makes the event *fire*; it does not yet break out which pool absorbed it.

---

## 🔴 Q12 (original report) — THE SHIELD POOL IS DISCARDED IN CODE, not just in the spec (2026-08-26)

`$HP` is **three** pools — `$HP,<hp>,<armor>,<shield>` — confirmed on the wire tonight (a shield grant
reads `$HP,45,70,70` and the next hit drains **shield first**). brx-opus2 found `docs/spec/node.md`
documented it as a two-token frame; **the code matches the wrong spec**:

| where | what it does | consequence |
|---|---|---|
| `mcp/brx_mcp/protocol.py:93-99` | parses **only `tok(1)`** (hp) | armor *and* shield never reach the parsed event |
| `app/src/engine.js:450` | `case 'HP': this._onHp(+t[1] \|\| 0, +t[2] \|\| 0)` | reads hp + armor, **drops the shield token** |
| `app/src/` | **zero** occurrences of `shield` | the phone engine has no concept of the pool at all |

**Why it was harmless until tonight:** nothing could put a value in the shield pool — `$PSET` shield is
inert (P16). **It stopped being harmless the moment we proved an IR `$SIR` fn-11 event fills it.**

**Failure mode, in order of nastiness:**
1. A hit **fully absorbed by a shield** changes neither hp nor armor ⇒ the engine sees nothing ⇒ on a
   strict reading **no `hit_taken` event at all**: no damage, no assist, no "who shot me", nothing in
   the outbox. A player being shot appears untouched.
2. `status` carries no shield ⇒ the HUD and MC's board cannot show it.
3. It fails **open** — everything looks correct until the first shield charger exists.

**Decision needed (Tony's, not ours):** `hit_taken.dmg` should almost certainly **include the shield
delta** rather than emit `dmg: 0` — a hit that landed is a hit that landed, and `dmg: 0` invites
`if dmg:` guards downstream to drop the event again, which is the same bug wearing a different hat.
Both brx-ir and brx-opus2 independently reached that recommendation. Parsing the third token is
additive and safe; changing the event's meaning is a **contract change** and wants sign-off.

Full write-up: `docs/spec/node.md` §10-Q12.


---

# Q17 — kill attribution used shooter TEAM
*closed 2026-08-30 · was FOLLOWUPS.md L346–399*

## ✅ Q17 — FIXED 2026-08-30. (was: kill attribution used shooter TEAM, so it broke whenever a team had 2+ guns)

**Root-caused 2026-08-30. Not a bug: an unfinished migration.** Two earlier framings of this item were
wrong and are superseded — it is neither a general attribution failure nor a player-id collision.

**Symptom.** Two live games, same shooter, same weapon, same mode:

| | teams | result |
|---|---|---|
| 3 guns, TDM 2v1 | team 1 has **two** guns | **every gun `kills: 0`**, team score correct |
| 2 guns, TDM 1v1 | each team has **one** gun | **5/5 kills credited correctly** |

**Cause, documented in the code itself** (`mcp/brx_mcp/modes/base.py:14`):

> *"Kill attribution: a victim's gun reports `$HIR` (**shooter TEAM in token 4**)... Per-player credit
> works when each gun has a **unique team** (`$TID`) - FFA - or once P2 sets a real PlayerID."*

The engine credits kills by **shooter team**. That is unambiguous only when one gun owns a team, i.e.
FFA or 1v1. Put two guns on team 1 and the victim's `$HIR` says "team 1 shot me", which cannot pick
between them, so nobody is credited. Team scoring is unaffected because it comes from **deaths**, which
the victim reports about itself.

**The fix is already half-built.** The precondition that comment waits for has been met:

- `mcp/brx_mcp/protocol.py:92` already parses **`shooter_player_id` = `$HIR` token 3**.
- `mcp/brx_mcp/modes/driver.py:113-120` already **assigns a distinct id per gun** (auto-numbered 0,1,2,
  overridable via `config.player_ids`) and pushes it as `$PSET` token 1, with a comment noting distinct
  ids are "what make per-player attribution possible at all". The assignment is computed once so a
  mid-game resetup re-sends the same id and does not orphan a player's kills.

**So the driver did its half and the engine never switched over.** `grep` finds **no use of
`shooter_player_id` anywhere in `modes/`** - the engine still reads only token 4.

**FIXED as described.** `modes/base.py` gained `shooter_player_id(ev)` (reads `$HIR` token 3) and
`Roster.wire_ids` / `Roster.by_wire_id()`. `modes/driver.py` populates that map from the ids it already
assigns. `modes/deathmatch.py` now resolves the killer by player id first and falls back to
`sole_member_of_team` when the id is unmapped, so a gun we never assigned an id to is no worse off than
before. A guard drops the id if it disagrees with the shooter's team rather than guessing.

**The harness was also blind, and that is fixed too.** `fake.py` hardcoded `$HIR` token 3 to `0`, so
**no sim scenario could express a two-gun team** - which is exactly why 156 scenarios missed this.
`receive_ir()` and `SimGame.kill()` now take an optional `shooter_id`.

**Two regression tests**, mutation-proven: reverting the fix fails
`test_tdm_credits_the_specific_killer_when_a_team_holds_two_guns`, restoring it passes 535/535. The
second test covers the unknown-id fallback.

**Test that proves it:** the 3-gun TDM above is the failing case and takes one short game to re-run.
Also worth an FFA run, where the current team-based path is expected to work with 3 guns - that would
confirm the diagnosis from the other direction.

**Impact:** per-player scoreboards, K/D, streaks and medals are wrong in any team mode where a team has
more than one gun, which is the normal case. Team scores and win conditions are correct.


---

# Field 2026-09-01 — second live match, six findings
*closed 2026-09-01 (open rows carried as F28–F32) · was FOLLOWUPS.md L2425–2454*

## Field 2026-09-01 — second live match (2 Android HUDs, TDM). Six findings, evidence attached

Session: `~/.brx-mcp/mc/session-8bbf96ab.sqlite` — **both phones' BLE frame rings were shared to MC**,
so several of these are settled from data rather than recollection.

- **G1 · ⛔ RETRACTED — "the headset domes never registered a hit" is wrong.** It rested on 10 frames
  from a 60-frame teardown ring, and on counting only sensors 0 and 1 as headset. `$HIR` tok1 **0–3
  are ALL headset** (it has four sensors, operator-confirmed 2026-09-01). Split by match: the reported
  match was **13 headset / 62 gun (17%)** — above Callsign's native 3/23 ≈ 13% — and the later nozzle
  test **95 / 0**. Refuted causes: `outdoorMode`, daylight, gun uptime. **What is still unexplained:**
  sensor 1 (back dome) took **zero** hits in the reported match and 69 in the test. Tracked as
  `field-issues.md` F2-1, tested by `verify-together.md` V1.
- **G2 · ✅ DONE** — `hit_taken` now carries `sensor`. Doing it exposed a real bug: `ir_proto` was read
  from `$HIR` tok1, i.e. it had been carrying the SENSOR all along. Facts recorded before 2026-09-01
  carry that mix-up with no version marker.
- **G3 · The low-health alert did not visibly fire.** Instrumented: the HUD now logs when the cue
  fires, so absence becomes decidable — the 60-frame ring could never settle it. `verify-together.md` V2.
- **G4 · The headsets DID show team colour, but on DEATH rather than pre-game.** Consistent with the
  Windows lane's correction that our `$HLED` sits mid-head where Callsign sends it as a LOBBY frame
  paired with `$GLED`. Try matching Callsign's position and pairing.
- **G5 · A game whose rules fix the weapon/perk did not apply them.** No evidence captured yet —
  needs a repro with the config id noted.
- **G6 · END MATCH EARLY on MC did not reach either HUD.** `control{end}` fan-out. Both nodes were
  `wsState: bound` at the time, so this is not a transport drop.
- **G7 · The perks menu on the phone is too small and hard to find.** UX.
- **NOT a bug:** "a phone HUD would not reconnect/sync on Wi-Fi". Its own log says
  `wsState: "bound"`, `synced: true`, `mc_reachable: true`, `pending: 0`, and **it delivered its log
  over the wire**. What was down was `bleUp:false` — the *gun*, which was off. The HUD presented that
  as a sync problem, which is the real defect: **UI truth, not transport.**


---

# polish-loop 2026-08-26 deferred lows — WORKED 2026-09-01 (handoff W4)
*closed 2026-09-01 (W4a carried as an open ears item) · was FOLLOWUPS.md L2326–2359*

## polish-loop 2026-08-26 deferred lows — ✅ WORKED 2026-09-01 (handoff W4)

The ledger sat un-owned for six days. It is closed now: **15 rows — 14 fixed, 1 deliberately kept.**
Each line says what happened and, where one exists, which test pins it; the rows without a test are
copy or wiring changes with no sensible unit. Nobody should have to re-derive whether an item is real.

| item | outcome |
|---|---|
| `api.py range_verdict` 500s on malformed JSON | ✅ fixed — it used `request.json()` (which raises) instead of the `body()` helper that degrades to `{}`. Same class as the header defect fixed 2026-08-31: **a guard that itself throws**. A full/read-only disk is now a 503, not a 500. `test_mc_api_range::test_malformed_json_is_400_not_500` + `::test_a_failed_write_is_503_not_500` |
| verdicts jsonl unbounded / full-rescan per GET | ✅ fixed — the GET reads the last 256 KB and skips a torn line instead of re-parsing a whole bench day on every KIT mount. `test_verdicts_read_only_the_tail_and_skip_torn_lines` |
| CORS `*` + `--no-auth` | ⬜ **deliberately left.** Both halves are needed: the phone app is a `capacitor://` origin, so `*` is the only value that lets it reach `/api/state` during the sweep fallback, and `--no-auth` is a bench convenience. With a token on (the default) mutating routes are gated anyway, and the read-only ones expose a LAN game's roster. Revisit only if MC is ever exposed off-LAN — at which point the answer is not CORS. Pinned by `test_range_cors_allows_any_origin` so it stays a decision, not an accident. |
| compile floors odd reserves; overrides could write ammo tokens | ✅ both fixed — the even-rounding moved into `_mods`, so the frame and the number `spawn_ammo()` gives the phone's HUD cannot disagree (an `ammo_mult` perk could ship a gun one round short of what the HUD said). An `overrides` entry naming an ammo token is now a hard error. `test_mc_compile::test_an_odd_reserve_never_splits_the_frame_from_the_hud`, `…::test_an_override_may_not_write_an_ammo_token` |
| `restore_snapshot` trusts file `player_nums` | ✅ fixed — `player_num` is the `$PSET` player id on the wire, so a duplicate arms two guns that answer to the same id and every hit either takes is scored to whoever MC looks up first. Restore now repairs to unique 1..63, first claimant keeps its number. `test_mc_persist::test_restore_repairs_duplicate_and_out_of_range_player_nums` |
| zeroconf thread survives the 6 s timeout | ✅ fixed — `wait_for` abandons the *await*, not the thread. A late registration now unpublishes itself rather than advertising an MC that `stop()` has already run past. `test_mc_net::test_a_late_mdns_registration_unpublishes_itself` |
| app `onReconnectMc` no-ops after a discovery-only connect | ✅ fixed — it dialled `settings.mcUrl`, which a discovery-only connect deliberately never writes, so the button returned on line 1 and did nothing. It falls back to the last URL actually dialled, and says so in the log when there is no target at all rather than no-opping again (review 2026-09-01). No unit test: `app.js` imports the DOM at module scope. |
| `allowAssist` never resets after bind | ✅ fixed — cleared on `bound`, so a momentary drop mid-match cannot hand the phone to a second MC on the LAN. |
| Kit registry fetched once; `v as never` cast | ✅ both fixed — the gun picker refetches when the FLEET changes (`registrySig`), and the cast is a real narrowing. ⚠️ The first fix keyed it on `readiness.t`, which is a clock pushed at 4/s — i.e. it re-created the RECAP refetch storm this same ledger documents. Caught in review and now pinned both ways: `console.test.tsx` "the armory is refetched when the FLEET changes, not on a clock". |
| `parseMcQr`: no "not an MC code" feedback, rejects uppercase `WS://` | ✅ both fixed, and the function moved to `app/src/mcurl.js` so it can be tested at all — `app.js` imports the DOM at module scope. `app/test/mcurl.test.mjs` |
| JoinPanel GET-THE-APP header with no QR | ✅ fixed — the header alone told the operator to point a camera at nothing. Guards on `isRoutableLanIp()`, not truthiness: `lan.ip` falls back to `127.0.0.1`, so the first fix was dead code and the real failure still printed a QR for loopback (review 2026-09-01). `console.test.tsx` "the APK QR is only offered on an address a phone can reach". |
| NEW MATCH not disabled in-flight | ✅ fixed — `newSession()` rebuilds the session, and a double-tap on a slow LAN fired it twice. `console.test.tsx` "NEW MATCH disables itself in flight". |
| `u9_pickup`/`quick_victim` lack try/finally disconnect | ✅ fixed via `bench_common.connected()` — a tool that died holding an open BLE link left a gun that would not accept the next connection until it was power-cycled. `test_bench_common::test_connected_always_disconnects` (covers a raise inside the block, a teardown that itself fails, and a part-way connect). |
| hoist shared PSET/SIR/AR frames (7-file drift) | ✅ done — `mcp/tools/bench_common.py`. Not a style fix: a run that re-tunes the arming config in one tool and not the others measures two different games and reports one number. `ally_remeasure.py` keeps its own 190 ms AR and shield-150 `$PSET` **deliberately** (its experiment depends on them) and is exempted by name. `test_bench_common.py` fails if a frame is ever pasted back. |
| Docs: header dates stale · stale P10 markers · O-family alternates only in prose | ✅ done — `mode-limits.md`'s two 🧪 P10 markers now say resolved (2026-08-26); the duplicate `### 3.2` heading in `weapon-design.md` is renumbered (§3.3–§3.5); the Energy Launcher audition shortlist is a real bench item below rather than a line of prose. |

### W4a · Energy Launcher fire sound — bench audition ⬜

`O01` (1.45 s) ships as the Energy Launcher's `t27` override. If it does not sit right on the range,
the alternates are **`O05` 1.46 s · `O02` 1.71 s · `O04` 1.79 s · `O06` 1.81 s · `O03` 2.51 s** — any
of them fits the 1600 ms cycle (`weapon-design.md` §3.2). Ten minutes with one gun and the KIT
try-out button; log the verdict through the range-verdict API like any other weapon.
⚠️ Its damage is the bigger problem: the Energy Launcher sits on `$SIR,9,3,,24` — a **status** row
that moves no pool — so it deals **zero damage** in every game we ship (`weapon-design.md` §6.2, and
`Compiler.validate()` warns on it). Fixing that comes first; the sound is cosmetic beside it.


---

# F11 — SOLVED: `$CLEAR` wipes the `$SIR` table (plus the original report and its ~20 dead hypotheses)
*closed 2026-09-02 · was FOLLOWUPS.md L520–1277*

## ✅ F11 — SOLVED 2026-09-02. `$CLEAR` wipes the `$SIR` table; a gun with no `$SIR` rows ignores every hit

> **ROOT CAUSE.** `$CLEAR` clears the `$SIR` matrix. Unmatched `$SIR` cells are silently ignored (this
> was already documented), so a gun with NO rows discards **every** incoming hit: no `$HIR`, no
> headset flash, pools untouched, while it reports alive, in-game and healthy to `$QUERY`.
>
> | step | result |
> |---|---|
> | armed normally | 4/4 registered |
> | `$CLEAR,*` then `$SPAWN,*` | **0/2**, gun `$LCD,45,70` alive, headset DARK |
> | re-send the `$SIR` rows, nothing else | **4/4** restored |
>
> **Deterministic 5/5**, and 3/3 at every `$CLEAR`→`$SPAWN` gap from 0.05 s to 1.0 s, so it is not a
> timing race. Table SIZE is irrelevant: one row and ten rows both gave 24/24 in an interleaved A/B.
> Only ABSENCE matters. `$START`, `$GSET`, `$PSET`, `$TID` and any number of `$SPAWN`s do NOT restore
> it. Repro: `mcp/tools/clear_spawn_repro.py`; found by `mcp/tools/desync_fuzz.py`.
>
> **It explains every symptom** across two sessions: gun in game and alive with the headset dark;
> all four domes AND the gun body silent together (the hit is discarded above the sensor layer, so no
> per-dome theory was ever needed); native games unaffected (the gun falls back to its own built-in
> `$SIR` config); a power cycle "fixing" it for the same reason. **It was never intermittent** — it
> follows a `$CLEAR` with no `$SIR` behind it, and nothing else.
>
> ### Mission Control fixes — ✅ ALL 4 DONE, and VALIDATED ON HARDWARE 2026-09-02
>
> **End-to-end bench test through the SHIPPED `GameDriver`** (`mcp/tools/mc_driver_bench.py`):
>
> | phase | result |
> |---|---|
> | `GameDriver.setup()` — the real path | **6/6** registered, `snapshot()` reports no `unhittable` |
> | strand it: `$CLEAR,*` then `$SPAWN,*` | **0/6**, gun `$LCD,45,70` ALIVE and in game — fault reproduced |
> | `GameDriver.setup()` again | **6/6** — recovered, because the `$SIR` rows follow the `$CLEAR` |
>
> All three phases passed. The shipped arming path is safe AND self-recovering.
>
> 1. ✅ **Retry the `$SIR` rows if any setup frame fails**, and refuse to call the gun armed if they
>    still will not land — `GameDriver._arm_one()`. ⚠️ Note there is **no readback** for `$SIR` on the
>    wire, so this verifies the SEND, not the gun's table. That limit is real; say so rather than
>    implying we confirm it.
> 2. ✅ **A bundle containing `$CLEAR` must carry `$SIR` after it** — `gameconfig.assert_sir_follows_clear()`,
>    called from `setup_frames()`, raises otherwise. Checks ORDER and PRESENCE, not count.
> 3. ✅ **Setup-frame failures are no longer swallowed** — `_send(..., critical=True)` records them;
>    `snapshot()` exposes `arming_failures` and, when a `$SIR` row is among them, `unhittable`, so the
>    operator console can flag a player who cannot be hit BEFORE the match.
> 4. ✅ **Flag a player who has registered no hits all match** — `GameDriver` counts hits taken per
>    player and `snapshot()` reports `never_hit` (plus `hits_taken`) once the match is
>    `NEVER_HIT_AFTER_S = 90 s` old. Not at kickoff: a list that cries wolf every match start is one
>    the operator learns to ignore. This is the cheapest LIVE detector for the whole class, because
>    an unhittable gun looks perfectly healthy from every other angle.
>
> ### The exposure, for context (fixes above)
>
> `setup_frames()` orders `$CLEAR` before the `$SIR` rows, so a COMPLETE bundle is safe. A PARTIAL one
> is not, and **`GameDriver._send()` swallows every send error by design** (one gun's BLE hiccup must
> not abort a game). So if `$CLEAR` lands and a later `$SIR` write fails, that player is **silently
> unhittable for the whole match**: no error surfaces, the gun reports healthy, pools stay full, and
> the scoreboard shows them alive and simply never hit.
>
> 1. **Verify the `$SIR` table landed** after any bundle containing `$CLEAR`; re-send if not.
> 2. **Never send a bare `$CLEAR` mid-game** without re-sending `$SIR` behind it.
> 3. **Stop swallowing setup-frame failures silently** — a failed `$SIR` write must be visible and
>    should fail that player's arming rather than being announced and forgotten.
> 4. **Flag a player who has registered no hits all match** — cheap, and it catches this class live.
>
> The original investigation and its ~20 dead hypotheses are kept below: they are the reason this
> entry exists, and re-running any of them would be wasted work.

## 🔴 F11 (original report) — A gun can arm, spawn and look healthy while SILENTLY registering no hits (2026-09-02)

> ### 🔻 2026-09-02 (evening) — THE SURVIVING CLAIM DID NOT SURVIVE, and there is a real suspect
>
> **the victim tagger registers 16/16.** Solo run with the validated edge-count witness (`f11_ab.py`), mag-1
> shots so nothing died and nothing respawned: 15/15 of witnessed shots, 16/16 of all shots, on both
> the gun body and headset dome0. The one finding this entry had left — *"the victim tagger is genuinely worse
> than the control tagger"* — is now contradicted by the same tagger measured with a better instrument.
>
> That does **not** mean it was never deaf. Tony watched it fail, repeatedly, and that observation
> stands. Nor can the intervening battery charge be credited: "works now" against "failed hours ago"
> is exactly the non-simultaneous comparison that produced the eight retractions below.
>
> **What it does is change the shape of the question**, from *"is this unit worse?"* to *"what state
> do taggers get into?"* — which is what Tony said at the outset: *"it maybe is a bad state it gets
> in."* A comparison cannot catch that. Only a repro can.
>
> **❌ RETRACTED suspect (kept for the trap it documents): A SECOND PROCESS WAS HOLDING THE GUN.** Four `brx_mcp` servers from
> previous sessions (2026-08-26 x2, 2026-08-30 x2) were still running. One had the control tagger held: the gun
> was invisible to three scans, announced "phone connected" the instant it was power-cycled, and
> announced "phone disconnected" the moment the processes were killed. A forgotten process can arm,
> configure or spawn a gun underneath you, and it fits the symptom exactly — *arms, spawns, looks
> healthy, registers nothing.* It also fits Tony's instinct at the time: *"you must be doing SOMETHING
> which puts it in this cant get hit state."* Something was; it just was not this session.
>
> ⚠️ Suspect, not cause. Nobody has yet shown a held connection making a tagger deaf to IR. **The test
> is a repro:** hold a gun from a second process, arm it normally from the first, and fire witnessed
> shots at it. See `gotchas.md` for the enumerate-and-kill procedure that must now precede any bench
> session.

**Observed at the bench.** Mid-session the victim stopped registering IR entirely: ~80 shots, zero
`$HIR`. Everything else looked correct — it connected, took the full arm sequence, echoed
`$LCD,45,70,0,0,32,384` on `$SPAWN`, reported `$VOLTS`, and drove its own LEDs and the headset's on
command. **Nothing in the BLE stream said anything was wrong.**

**Root cause: the headset had dropped its link to the gun.** It showed up in a BLE scan as
`BC-HEADSET-8F8C` advertising **standalone**. Power-cycling the headset restored hits immediately
(3/3 on the next burst). Tony also saw the headset **flash green and take a hit** at one point in the
dead window, so the headset's own sensors were alive — the path from headset to gun was what was gone.

**Why this matters beyond the bench.** `gotchas.md` records that a gun whose headset has dropped
*"silently refuses to join a game"*. This is a **different and worse symptom**: the game arms and
spawns completely normally and simply never scores. In a match that is a player who appears fine to
MC, to their phone and to themselves, and is invisible to everyone shooting them.

### ⚠️ SECOND OCCURRENCE 2026-09-02 (later) — and it is a DIFFERENT failure mode

Caught live and characterised before clearing it. Tony: *"this headset not registering hits, it's a
hard to repro but consistent problem... maybe a bad state it gets in."*

| signal | reading | meaning |
|---|---|---|
| `$VERSION` | `v4.32,**hds.59**,4,,devhost.03` | the gun **SEES the headset** — reports its firmware, and token 3 = 4 (matching the four sensors) |
| standalone advert | **absent** | the headset is **LINKED**, unlike the first occurrence |
| `$VOLTS` | 8062 mV pack, 3796 mV cell, 88% | battery fine, not a brownout |
| arm + spawn | `$LCD,45,70,0,0,0,0` | game state healthy |
| emitter | receiver decoded the full 25-bit word | **transmitting correctly** |
| `$HIR` | **ZERO** over 14+ shots | not registering |

**So the first occurrence's tell does NOT generalise.** That one had the headset advertising standalone
with a dropped link; this one is linked, visible to the gun, healthy battery, and still deaf. **There
are at least two distinct failure modes with the same symptom**, and only one of them shows up in a
BLE scan.

**`$VERSION` token 2 is a live headset-presence signal over BLE** (`hds.59`), which is new and useful:
it is the first BLE-visible headset field we have found, and it did NOT flag this fault. So it is
necessary but not sufficient for a preflight check.

**Recovery: cycle BOTH the gun and the headset.** This matters and was learned the hard way. On the
second occurrence, cycling the tagger alone did not clear it and cycling the headset alone did not
clear it; the fault persisted through each. Doing **both** restored hits immediately (4/4 on the next
burst, armour 70 -> 0 with normal spill). So "I power cycled it" is not a sufficient description of the
fix, and an operator who tries one, sees no change, and concludes the unit is dead would be wrong.

### ⭐ ISOLATED: the link is alive in ONE DIRECTION only

Tested while the fault was live, before clearing it. **`$HLED,0` lit all three visible headset modules
RED** (measured 1.00/0.07/0.37, 1.00/0.09/0.27, 1.00/0.03/0.20) **while the same headset registered
zero hits from a verified-transmitting emitter.**

So in this state:

| path | status |
|---|---|
| host → gun (BLE) | ✅ works |
| gun → headset (commands, `$HLED`) | ✅ **works — the headset lights on demand** |
| headset → gun (IR hit reporting) | ❌ **dead** |

That rules out the whole obvious set: not unlinked, not unpowered, not a BLE fault, not a flat battery
(88%), not the emitter (the receiver decoded the word). **The fault is confined to the IR sensor path**
— either the sensors themselves or the headset's reporting of them back to the gun.

### ⚠️ THE PREFLIGHT MUST LAND A REAL TEST SHOT  *(was: "must hit a headset DOME")*

> ❌ **The per-dome mechanism below is RETRACTED (2026-09-02).** F11 was `$CLEAR` wiping the
> `$SIR` table, which discards hits **above** the sensor layer, so every dome and the gun body
> go silent together and no dome-specific theory was ever needed. **What survives:** a preflight
> must fire a real test shot and see it register. Do NOT build dome-specific logic, and do not
> flag `tok1 = 4` as meaningful.

**Operator: this happened in a real game on 2026-09-01.** It went unidentified for the whole game,
and the root cause explains why: the player was **partially scoring**. Their gun body registered
normally while all four headset domes reported nothing, so they took hits when shot head-on at gun
level and nothing from any other angle. That presents as *"tagging is flaky today"*, not as a broken
headset.

**This invalidates the simpler fix.** An earlier note here said muster needs a *test shot*. Not
sufficient: **a test shot at the GUN BODY passes while the headset is dead.** The check has to land on
a **headset dome** (`$HIR` tok1 = 0, 1, 2 or 3) and verify the sensor id, not merely that *a* hit
arrived.

**Concrete requirements this creates:**
- **Muster / Armory** (`docs/field-process.md`): the per-player check is a shot **at the headset**, and
  it passes only on `$HIR` with tok1 in {0,1,2,3}. Ideally all four domes, since we do not yet know
  whether they fail together or individually.
- **MC preflight**: a player whose only registered hits are tok1 = 4 should be flagged, not green.
- **Match data from 2026-09-01 is suspect** for any player on this unit: their hit counts are an
  undercount of unknown size, so K/D and accuracy from that game cannot be trusted.

### ⚠️ Consequence: lighting the headset is NOT a valid health check

A preflight that lights the headset and calls it good **passes a headset that cannot score**. Same for
`$VERSION` reporting `hds.59`: it does too. **The only signal that distinguishes a working headset from
this fault is an actual registered hit**, so muster/preflight needs a **test shot**, not a light test.
That is a concrete change to `docs/field-process.md`'s Armory/Muster flow and to MC's preflight.

### ⭐ AND IT SURVIVES A TAGGER POWER CYCLE — the fault is in the HEADSET

Re-tested immediately after a full tagger recycle, with the operator confirming the emitter LED was
aimed directly at the headset and the board had not moved:

- `$HLED,3` lit all three visible modules **green** (0.28/1.00/0.52, 0.23/1.00/0.52, 0.12/1.00/0.33)
- the same headset registered **zero hits** from 45+ shots

So a **gun** power cycle does not clear it. Recovery required cycling the **headset** itself, both
times it has happened.

### ✅ CONFIRMED TWICE: the rig is fine, ONE TAGGER (the victim tagger) is faulty

The discriminator, run twice hours apart: with the victim tagger registering nothing, the **same emitter, same
aim, same moment killed a DIFFERENT tagger** (the control tagger) outright. A second run after several power
cycles and a fresh arm reproduced it exactly.

So this is **not** our emitter, our encoding, our arming, team gating, aim, or anything in the
software. **the victim tagger has a genuine intermittent fault in its IR receive path.**

**Practical consequences:**
- **Pull the victim tagger from field use** until the headset-swap test says which half is bad. It will pass every
  check an operator can run and then fail to score during a match.
- **Use a different tagger as the bench victim.** the victim tagger cannot sustain a multi-cycle IR experiment,
  and a long run against it silently fills with VOID rows.
- The recovery that worked once (cycle both, gun first then headset) did **not** reproduce on later
  attempts, so there is no reliable field workaround.

### ❌ RETRACTED (was: ROOT CAUSE): the headset's sensors have DEGRADED SENSITIVITY, not a fault state

**The decisive test.** With the unit "deaf" (0 hits from 6 at working distance), the emitter was held
**right against a headset dome**:

```
5 of 6 hits, every one $HIR tok1 = 0   (headset FRONT dome)
$HP 45,50 -> 45,30 -> 45,10 -> 35,0 -> 15,0
```

**The headset's sensors work. They just need far more signal than they should.** This is a
**hardware sensitivity loss**, not a logic state, not a stuck death state, not our frames, not the
arming sequence.

**It explains every observation in this entry, including the ones that misled us:**

| observation | explanation under this cause |
|---|---|
| partial scoring in a real game | only close-range hits clear the threshold; reads as "tagging is flaky" |
| the gun body always registered | a different sensor, unaffected |
| one stray hit out of three | marginal signal, occasionally over threshold |
| power cycles "fixing" it | **coincidence.** Sensitivity sits near a threshold, so any burst can look like a recovery |
| "it takes TWO power cycles" | the same illusion — which is why nothing reproduced reliably |
| `$GSET` appearing to clear it | one marginal hit, and it did **not** reproduce |
| predates our LED experiments | degradation, not something we did |

⚠️ **Everything in this entry above that treats recovery as reproducible is therefore SUPERSEDED.**
The power-cycle patterns and the `$GSET` result were us reading structure into a threshold effect. The
localisation results still stand (gun sensor healthy, headset sensors at fault) — the *mechanism* is
what changed.

### The field test that detects it, and why the earlier one was not enough

A test shot must land on a **headset dome** *from realistic range* and verify `$HIR` tok1 ∈ {0,1,2,3}.
Both halves matter:
- a **gun-body** hit passes while the player is half-blind;
- a **point-blank** headset hit also passes, because the sensors work at 2 cm. **Muster must shoot
  from across the room, not at arm's length.**

**Action: replace or service the headset.** Confirming test, and the prediction is explicit: swap this
headset onto a known-good gun and the reduced range should follow the headset.

### 🔋 IT DEGRADES WITHIN MINUTES OF POWER-ON — leading cause is now the HEADSET BATTERY

**The measurement that reframed everything.** Three arms, same emitter, same 3 ft distance, same
target, run back to back immediately after a double power cycle:

| | when | result |
|---|---|---|
| A  our usual FAST arm | ~1 min after power-on | **5/6 hits**, sensors 1 and 2 |
| B  our frames, SLOW 700 ms gaps | ~2 min | **1/6** |
| C  Callsign's order, full 10-row `$SIR`, slow | ~4 min | **0/6** |

**Arming order, timing and completeness are RULED OUT** — Callsign's own sequence did *worst*, purely
because it ran last. What the data actually shows is **progressive degradation with time since
power-on**: full range for about a minute, then fading to nothing within a few minutes.

**This retro-explains every "recovery" in this entry.** They were all measured in the first minute
after a cycle. The "two power cycles are needed" pattern, the `$GSET` recovery, the apparent
arm/spawn trigger — all of them were the clock, not the treatment.

### ⚠️⚠️ RETRACTED: the HEALTHY headset fades too — the shared suspect is OUR EMITTER

**The control was run to completion and it reverses the conclusion below.** the control tagger, the known-good
unit, also fades:

| minutes after power-on | **the control tagger** (healthy) | **the victim tagger** (suspect) |
|---|---|---|
| 0.2 – 3.9 | **6/6 throughout** | — |
| ~1 | 6/6 | 5/6 |
| ~2 | 6/6 | **1/6** |
| ~4 | 6/6 | **0/6** |
| 4.7 | **5/6** | — |
| 5.4 | **1/6** | — |

**Both headsets fade.** the victim tagger in about 2 minutes, the control tagger in about 5. So this is **not a fault specific
to one unit** — it is systemic, and the component shared by every test is **our ESP32 emitter**.

**Why that is now the leading explanation.** If the IR LED or its drive weakens with sustained firing
(heat, or current sag), every target fades over a run. And it retro-explains the single most
confounding pattern of the whole session: **every "recovery" followed a PAUSE.** Power cycling,
re-aiming the board, waiting for the operator — all of them rested the emitter. We were repeatedly
crediting the tagger for the emitter cooling down.

**⚠️ Everything below in this entry that concludes the victim tagger is faulty is therefore SUSPECT**, including
the "root cause localised" and "degraded sensitivity" sections. What still stands unaltered:
- the gun body registers when the headset does not (that was a *simultaneous* comparison)
- the headset works at 3 inches and not at 3 feet (also simultaneous)
- muster needs a headset-dome shot at realistic range

What does **not** stand: that the victim tagger is defective and should be pulled or serviced. **Do not replace
that headset on the strength of this entry.**

**Emitter rest: TESTED, and it does NOT explain it.** With the control tagger faded to 1/6, the emitter was left
idle for 3 minutes with the tagger untouched, then fired: **still 1/6**. A `$CLEAR`/`$START` re-arm
immediately before that burst also failed to restore it, so game state is not the factor either.

**So neither emitter heating nor game state explains the fade.** What still tracks it is **time since
the TAGGER was powered on**: the control tagger was 6/6 for its first ~4 minutes and was still 1/6 at ~10 minutes
regardless of the emitter resting.

### 🚨 THE EMITTER HAS DEGRADED — and the boards never moved

**Operator confirms both ESP32 boards have been in a STATIC location all day**, which makes the
loopback a valid before/after comparison rather than a geometry change:

| when | shots | frames at board A | clean 25-bit decodes |
|---|---|---|---|
| earlier today | 6 | several | **yes**, full word, parity OK |
| now | 15 | **0** | **0** |

**Same boards, same positions, and the receiver now sees nothing at all.**

**This reframes the back half of this investigation.** A steadily weakening emitter produces exactly
the "fade" seen on BOTH taggers: hits at the start of the day, then only at 3 inches, then barely at
all — and it looks like a tagger problem because the tagger is what we were watching.

⚠️ **Everything in this entry treating the fade as a property of a HEADSET is now in doubt**,
including the the control tagger-vs-the victim tagger comparison. What survives are the SIMULTANEOUS comparisons, which a
drifting emitter cannot explain:
- the gun body registered while the headset did not, **in the same burst**
- 3 inches worked while 3 feet did not, **in the same sitting**

Those still show the headset needs more signal than the gun body. They no longer establish that any
headset is defective.

### ❌ RETRACTED IN FULL: the emitter is FINE — it killed a tagger during the very test

**Operator, while the LED was being filmed: "that ir test hit the robat and killed him."** The same
burst that board A could not see **killed a tagger outright.** So board B emits perfectly well, and
the "emitter has degraded" conclusion is **wrong**, not merely over-claimed.

**What board A's silence actually means:** the two boards are not aimed at each other well enough.
That fits the morning loopback, which was already marginal — **one** clean decode among a pile of
partial frames (13 bits, 11 bits, 6 bits, 2 bits). A marginal path can fall to zero without anything
failing. "Static boards" told us nothing moved; it did not tell us the path was ever good.

**The camera check was inconclusive, and the analysis says why:** apparent luma spikes in the LED ROI
recur every ~0.74 s **including before firing began**, and the firing window (2-8 s) had a *lower*
mean than the pre-firing window. That is a periodic display artefact, not IR. The phone filters near
infrared too well to see this LED.

⚠️ **So the emitter-decline explanation for the "fade" is withdrawn**, and the fade observations are
back to being unexplained. What remains solid are only the SIMULTANEOUS comparisons:
- **the control tagger took hits while the victim tagger registered nothing, same emitter, same session** — the victim tagger is worse
- the gun body registered while the headset did not, same burst
- 3 inches worked while 3 feet did not, one sitting

**Method note this whole sequence earns:** across one afternoon this fault was attributed to a stuck
death state, accumulated hits, arming order, `$GSET` outdoorMode, headset battery, tagger uptime,
receiver adaptation, and finally our own emitter. **Every one of those came from comparing
measurements taken at different times on a rig with at least one drifting variable.** Only the
simultaneous comparisons ever survived contact with the next test. On this bench, a difference is
only real if both sides of it were measured in the same burst.

### ~~CORRECTION: "the emitter is dead" was OVER-CLAIMED~~ (now fully retracted, see above)

**Board B is NOT dead.** It produced a registered hit on the control tagger minutes before that conclusion was
written — a dead emitter gives zero hits, not one. The claim was contradicted by data already in this
entry, and it was stated far too strongly.

**What the evidence actually supports:**

| fact | status |
|---|---|
| board A (receiver) is healthy | ✅ decoded a real gun cleanly, parity OK |
| board B still emits | ✅ the tagger registered a hit from it |
| board A no longer sees board B | ✅ 15 shots, 0 frames, where it worked this morning |

Those are consistent with board B's output **weakening**, and equally consistent with **the path
between the two boards being blocked** — taggers, headsets and props were moved around that bench all
day, and neither board being moved does not mean nothing came to sit between them.

**Check before concluding anything: is there now an obstruction between board B and board A?**

### ~~CONFIRMED: the RECEIVER is fine, the EMITTER (board B) is DEAD~~ (over-claimed, see above)

A real tagger was fired at board A and it decoded perfectly:

```
0000000101010001011000010  ->  player=5 team=1 dmg=22 proto=0 subtype=0 crit=0 parity=ok
```

**So board A is healthy and board B produces nothing it can see** — 15 shots, zero frames, static
geometry, where the same pair worked this morning.

**Our EMITTER died partway through 2026-09-02.** Hours of "the headset is fading" were our own rig
declining, watched through the only thing we were instrumenting.

**What this costs:**
- every IR-based measurement from the later part of the session is **void**, not merely suspect
- the F1 config hunt never ran (it needs a working emitter)
- the the control tagger "fade curve" measures the emitter, not the headset

**What it does NOT cost — the SIMULTANEOUS comparisons, which a drifting emitter cannot explain:**
- **the control tagger took hits fine while the victim tagger registered nothing, same emitter, same session.** the victim tagger is
  genuinely worse than the control tagger. That stands.
- the gun body registered while the headset did not, in the same burst
- 3 inches worked while 3 feet did not, in one sitting
- the fn 36/37 multiplier results, which required an fn 1 control to read exactly the magnitude

**Repair before any further IR work:** board B (2N2222A + IR LED on GPIO5). A loose wire on it was
already found and re-seated earlier the same day, so the driver stage is the first suspect.

**Re-test after repair, with a working emitter:** is the victim tagger's headset actually less sensitive than
the control tagger's, measured **simultaneously** — same burst, both units in frame — rather than in sequence.
That is the only form of that comparison that survives a drifting rig, and it is the one question
worth re-asking.

**Unaffected:** results with a built-in control, notably the fn 36/37 multipliers, where an fn 1
control had to read exactly the magnitude or the trial was void. A weak emitter cannot fake that.

**Also ruled out: receiver adaptation to a repeated code.** Every shot fired all session was a
BYTE-IDENTICAL word (pid 42, mag 20, no crit). Real guns vary, so if the receiver de-duplicated or
adapted to a repeated code it would look exactly like a fade and would never happen in a match. Fired
three different shooter ids (7, 13, 55) and a different magnitude at the faded headset: **none
registered.** So it is not the repetition.

**Next test (needs the operator):** power cycle the control tagger and fire immediately.
- back to 6/6 → the fade tracks **uptime on both units** (the victim tagger simply faster), which is a systemic
  behaviour that would affect real matches and is worth understanding properly
- still 1/6 → uptime is not it either, and the emitter returns to the suspect list

### ~~CONTROL: a healthy headset does NOT fade~~ (SUPERSEDED by the completed run above)

The control this entry badly needed. Every claim that the victim tagger is "faulty" rested on an assumption that
a good headset holds its range, and that had never been measured. Same emitter, same **3 ft**, same
target position, bursts of 6:

| minutes after power-on | **the control tagger** (healthy) | **the victim tagger** (suspect) |
|---|---|---|
| ~0.2 | **6/6** | — |
| ~1 | **6/6** | 5/6 |
| ~1.7 | **6/6** | — |
| ~2 | — | **1/6** |
| ~4 | — | **0/6** |

**the control tagger holds 6/6 flat across the window in which the victim tagger collapses from 5/6 to nothing.** So the fade
is real and specific to the victim tagger — it is not how these headsets behave, and not a limitation of our
emitter or of 3 ft as a distance.

*(the control tagger run recorded to 1.7 min at the time of writing; it was still 6/6 at every point.)*

This is also the measurement that should have been taken first. Hours were spent deciding whether
the victim tagger's behaviour was abnormal without ever measuring a normal unit, and several wrong conclusions
(a two-power-cycle pattern, a `$GSET` recovery, an arming trigger) came from reading structure into
one unit's noisy decline with nothing to compare it against.

### 🔌 ON CHARGE it partially recovers — supply is involved, but is not the whole story

Tested with the headset **plugged in and NO power cycle**, so the "fresh boot" confound is absent.
Same emitter, same 3 ft, same target:

| condition | result |
|---|---|
| before, on battery | **0 / 6** |
| plugged in, burst 1 | **3 / 6** (sensor 1) |
| plugged in, burst 2 | **1 / 6** |

**0/6 → 3/6 with no reset is not noise**, so the supply is genuinely part of it. But it **still faded
within a minute or two while plugged in**, and external power should hold the rail steady. So a flat
cell alone does not explain it.

**What that leaves:** a supply that is marginal even while charging (limited charge current, or a
fault between the cell and the receiver), or a second time-dependent factor such as thermal drift.
Both are consistent with everything seen: fine when rested, fading under use, partially helped by
external power.

**Do not close this as "flat battery".** The next measurement is the one that separates them: charge
the headset FULLY, then run `range_decay.py` for ten minutes. Range that returns **and holds** on a
full cell means charge state; range that fades again on a full cell means the receiver or its supply
path, and the unit needs service.

### Why the battery was the leading suspect

The behaviour is the classic signature of a supply sagging under load: works when rested, fades as it
runs, recovers after being off. USB-read headset voltages (`armory.json`, 2026-08-26):

| unit | headset volts |
|---|---|
| **the control tagger** (known good, tags normally) | **4.6** |
| Tactix-FE30 | 3.911 |
| **the victim tagger** (faulty) | **3.833** |
| Tactix-9498 | 3.677 |

the control tagger sits well above the others. ⚠️ Not a clean correlation — Tactix-9498 is lower still and has not been
tested — and the snapshot is a week stale, so this is a lead, not a conclusion.

**Next step, cheap and decisive: fully charge the victim tagger's headset, then re-test at 3 ft over several
minutes.** If range returns *and holds*, the cause is charge state, not a broken part — which would
also explain it appearing partway through a real game, after the headset had been on a while.

**If charging does not fix it**, the same test still stands as the diagnostic: measure hits at a fixed
distance at 1, 3 and 5 minutes after power-on. A unit that starts fine and fades is a supply or
thermal problem; one that is bad from the first shot is the receiver itself.

### ❌ NOT `$GSET` outdoorMode

A promising config hypothesis, tested and dead. Every arm we send has `$GSET` token 2 = 0 (indoor),
and indoor mode exists to shorten IR range (operator, 2026-08-30: *"native indoor is way too powerful,
the ir hits after bouncing way too easily"*). If it also desensitised the receiver, it would explain
short range in our games and normal range natively.

At 3 feet, same emitter, same dome, nothing else changed:

| `$GSET` t2 | result |
|---|---|
| 0 (indoor) | 0 of 6 |
| 1 (outdoor) | 0 of 6 |

**No difference.** `outdoorMode` does not affect receive sensitivity, and the config explanation for
F11 is not this token.

⚠️ **The hardware-degradation conclusion below is NOT yet confirmed.** The operator doubts it, and the
control that settles it has not been run: **does this headset tag normally in a NATIVE on-gun game?**
If it does, the fault is in something *we* send and the degradation reading is wrong. That test is
outstanding and should be done before anyone replaces hardware.

### 📏 The range figure

Operator-measured, same emitter, same dome, same session:

| distance | result |
|---|---|
| **3 feet** | **0 of 6** |
| **3 inches** | **5 of 6** |

So the headset's effective range has collapsed to **under a metre**, against a stock unit that has to
work across a field. That is the quantified signature of the fault, and it makes the muster check
specifiable: **the test shot must be taken from at least ~3 m / 10 ft.** Anything closer passes a
headset this badly degraded.

For comparison the same emitter, at working distance, killed a **different** tagger outright — so this
is not an emitter-power limitation, it is this headset.

**Still worth measuring** (not needed for the diagnosis, useful for the spec): whether all four domes
are equally degraded or only some, and where between 3 inches and 3 feet it starts failing. A
threshold distance would let muster state an exact number rather than "across the room".

### ✅ Earlier localisation (still valid): the GUN sensor works, the HEADSET's four do not

The decisive test, and it took one aim change. With the unit in the deaf state and the **headset**
registering nothing from 14+ shots, the emitter was pointed at the **GUN BODY** instead:

```
$HIR,4,0,42,2,20,0,0     <- tok1 = 4 = GUN BODY
$HP,45,50,0 -> 45,30,0 -> 45,10,0 -> 35,0,0
```

**Four shots, four hits**, armour 70 → 50 → 30 → 10 → 0 with normal spill into HP.

**So the gun's own sensor and its entire IR-to-BLE reporting chain are HEALTHY.** The fault is
confined to the **headset's four sensors** (`$HIR` tok1 = 0, 1, 2, 3).

**The complete picture of a unit in this state:**

| subsystem | status |
|---|---|
| gun IR sensor (tok1 = 4) | ✅ **registers normally** |
| gun → BLE hit reporting | ✅ works (that is how we saw the above) |
| gun → headset commands (`$HLED`) | ✅ headset lights on demand |
| headset link + firmware (`$VERSION` → `hds.59`) | ✅ reported |
| headset battery | ✅ fine |
| headset knows it is alive | ✅ shows the normal dark in-play state |
| **headset's four IR sensors** | ❌ **report nothing** |

**Action: the HEADSET is the faulty part.** Swap it. The gun does not need servicing, and a swap
should move the fault with the headset — that is the confirming test, and the prediction is explicit.

**Why this matters beyond one unit:** in a real match this player is not fully invisible — their
**gun body still scores**. So they take hits when shot from the front at gun level and nothing when
shot anywhere else, which reads as "the tagging is unreliable today" rather than as a broken headset.
That is far harder to notice than a total failure, and is very likely what was happening in the
2026-09-01 test game.

### ❌ RULED OUT: it is NOT stuck in the death state

The best remaining software explanation, and it is wrong. Hypothesis (Tony's): we killed the gun, the
`$SPAWN` did not propagate to the headset, and the headset stayed in its death state — which would
explain a unit that takes no IR, still answers `$HLED`, and needs a power cycle. It fits the known
death behaviour (dark in play, blinking green while out, stops on respawn).

**Tested while the fault was live.** Armed and spawned with **no `$HLED` sent at all**, so the headset
showed its own native state. Gun reported `$LCD,45,70` (alive). **The headset was DARK** — the normal
in-play state, not the blinking green of a dead player.

So the headset knows it is alive and simply does not report hits.

### 🎯 LEADING HYPOTHESIS: something in ARM or SPAWN disables the headset's sensors

Operator: *"only the gun detected hits, so something in the respawn or game setup can cause it."* The
timeline supports this and is the strongest evidence we have about the trigger:

- a confirmed-good burst: **6/6 hits on the headset**, clean kill
- **one arm cycle later** (`$CLEAR`/`$START`/`$GSET`/`$PSET`/`$SIR`/`$TID`/`$WEAP`/`$SPAWN`), the
  **very first shot missed**, and so did the next 14

Nothing else happened in between. If it were wear, heat or accumulated hits, the early shots of that
run should have landed. **The headset went deaf across an arming sequence, without being shot.**

**Why this is worth chasing hard: if a frame breaks it, a frame may fix it.** A software recovery
would be enormously more useful than "power cycle it twice" — it could run automatically from MC when
preflight detects the fault, mid-match, with no operator intervention.

**The experiment** (needs the emitter aimed back at a headset dome, with the gun-body sensor kept as a
live control proving the rig still works): with the fault present, send one candidate recovery frame
at a time and fire after each — `$SPAWN` alone, `$CLEAR` + full re-arm, `$PSET` alone, `$TID` alone,
`$STOP`/`$START`. Then, to find the *trigger*, do the reverse: from a known-good state, add back one
arming frame at a time until the headset goes deaf.

### ❌ ALSO RULED OUT: it is not the hits

The timeline settles this without a new experiment. After a confirmed-good burst (6/6 hits, clean
kill), the next run did **one arm cycle** and then its **very first shot missed**, along with all 14
after it. If accumulated hits were the trigger, the early shots of that run should have landed.
**It was already deaf before any hit in that run.**

### 🔑 RECOVERY PATTERN: it takes TWO power cycles, not one (operator observation)

Tony, after the second recovery: *"the second power cycle of the tagger fixed it both times."* The
session log bears that out — on 2026-09-02 the sequence was:

| action | result |
|---|---|
| cycle the tagger alone | still deaf |
| cycle the headset alone | still deaf |
| cycle **both** (1st round) | ✅ hits, 4/4 — then failed again within minutes |
| cycle both, gun on first then headset (2nd round) | still deaf |
| cycle **both** again (3rd round) | ✅ hits, 6/6, killed cleanly |

**A single power cycle does not reliably clear it; a second round does.** That is strange for a true
power-off and suggests a mechanism worth chasing: **the headset may retain state across one cycle** —
a soft power / sleep rather than a real power-down, so the first "off" does not drain it and the
second does. If that is right, the fix is a genuine power-down (battery pull, or holding the button
longer), not a quick off-on.

**Test that would confirm it:** next occurrence, cycle ONCE and verify with a test shot, then cycle a
SECOND time and verify again. If one never works and two always do, the retained-state hypothesis is
confirmed and the field instruction becomes "cycle it twice", which is a cheap and immediately usable
workaround even before the underlying cause is found.

### ⏪ IT PREDATES TODAY'S EXPERIMENTS

**Operator report: the same headset was unhittable during a test game on 2026-09-01**, a day before any
of today's LED sweeps. That largely **exonerates the frames we send** — the `$HLED` count=200
animations, the effect values 5-8 and the 255 token values were all sent for the first time on 09-02.

It also means this is **not** a fault we introduced with unusual probing, and it has now been seen in
two independent contexts: a real test game and a bench session. Root cause matters: this is a unit
that will silently stop scoring in a match.

**Prior claim kept for the record but now unlikely:** Whether something WE send latches it into this state.
Tony's hypothesis, and a fair one — the frames swept today are ones Callsign never sends, notably
`$HLED,...,200,*` (a count of 200 at 600 ms is a **two-minute** animation, fired back to back across
eleven effect values), `$HLED` effect values 5-8, and token values of 255 on both commands. A
software-only clear was attempted and FAILED (`$HLED,,6` + `$GLED,,,,5` + `$CLEAR` + full re-arm), so
if a frame does latch it, it latches below the command layer.

### ⚠️ IT RECURS WITHIN MINUTES — this unit is not field-usable

After cycling both gun and headset, hits worked perfectly: **4/4 on the next burst**, armour
70 → 50 → 30 → 10 → 0 with normal spill into HP. A config sweep was started **immediately** afterwards
against the same rig, same aim, same arming, and its very first row registered **zero hits from 14
shots**.

So the recovery is **not durable**. The fault returned inside a few minutes of normal use, which makes
this tagger **unusable for a match** rather than merely flaky: a player would pass muster, take a
successful test shot, and then go dark partway through the game with nobody able to score on them.

**It also blocks bench work.** The F1 config hunt needs a victim that registers hits reliably across
ten arm/damage cycles, and this unit cannot sustain that — a long IR experiment on it silently fills
with VOID rows, which is exactly how a rig fault gets mistaken for a protocol result.

### The full signature, and why no cheap preflight can catch it

| check | result while broken |
|---|---|
| advertising standalone? | **no** — still linked |
| `$VERSION` reports `hds.59`? | **yes** — the gun sees it |
| responds to `$HLED`? | **yes** — lights on demand, all modules |
| battery | **88%** |
| registers hits? | **NO** |
| survives a tagger power cycle? | **yes, the fault persists** |
| emitter transmitting? | verified — the receiver decoded the word |
| aim? | ruled out by the operator |

**Every non-invasive check a preflight could plausibly run — link status, firmware presence, LED
response, battery — PASSES while the headset cannot score.** There is no cheap proxy. **Only a real
registered hit distinguishes a working headset from this fault**, which makes a **test shot**
mandatory in muster and in MC preflight rather than a nice-to-have.

### ⭐ ISOLATED TO ONE UNIT: the same emitter kills a DIFFERENT tagger

The decisive test, arrived at by accident: while the faulty unit was registering nothing, the **same
emitter at the same aim killed Tony's OTHER tagger**, which was sitting in a native FFA game.

So the rig is fully exonerated and the fault is **specific to that one tagger (the victim tagger)**, not to our
emitter, our word encoding, our arming, or team gating.

**Free corroboration worth keeping:** our synthetic IR words are accepted by a stock tagger running a
**native** on-gun game, not only by one we armed ourselves over BLE. That is the cleanest evidence yet
that the ESP32 rig produces genuine, firmware-legal BRX shots.

### Everything eliminated, on the record

| suspect | ruled out by |
|---|---|
| our emitter / encoding | **the same shots killed another tagger** |
| aim | operator confirmed, board unmoved |
| team gating | all four `$TID` values fired, zero hits |
| the BLE link | headset lights on `$HLED` |
| battery | 87% |
| gun power cycle **alone** | fault survived it |
| headset power cycle **alone** | fault survived it |
| **BOTH cycled together** | ✅ **CLEARED IT** — 4/4 hits on the next burst |
| game state | armed, spawned, `$LCD,45,70`, trigger and `$ALCD` both live |

**Next, and it is the only branch left:** swap a known-good headset onto the faulty gun, or the faulty
headset onto a known-good gun. **Whichever side the fault follows is the broken part.** Until that is
done we know the unit is faulty but not which half.

**The diagnostic ladder that found the FIRST one** (it cost ~40 minutes without one):
1. **Have the RECEIVER decode the emitter** (`ir-capture COM7` while `ir-emit COM8`). A clean decode
   separates *"not transmitting"* from *"not aimed"* — this is the step that saved us, and it also
   incidentally closed bench 0.2.
2. If TX is good, **scan for `BC-HEADSET-*` advertising on its own**. That is the tell.

**Open:**
- **What breaks the link?** Ours went during a session in which the gun's own hit-vibration walked it
  off its stand — so mechanical shock is the leading suspect, but it is not proven.
- **Can the gun tell us over BLE?** `armory.json` has a `headset_linked` field harvested over USB;
  find whether anything on the BLE side exposes it (`$QUERY`?). **If it does, MC and the node should
  surface an unlinked headset as a RED preflight** — this is exactly the class of fault the preflight
  exists for, and right now it would pass.
- Does a `$HIR` ever arrive from the **gun body** sensor while the headset is unlinked? If the gun's
  own sensor still works, the failure is partial, not total, and looks even more like flaky scoring.


---

# F1 — BUILT across three surfaces (two BUILT entries + the original spec)
*closed 2026-09-02 (superseded again by S4 on 2026-09-04) · was FOLLOWUPS.md L1751–1938*

## ✅ F1 — BUILT 2026-09-02, across THREE surfaces (the design changed twice; read this first)

> **The finished shape.** One surface could not carry it, so the feedback is split by WHO the message
> is for (Tony: *"you cant see your own head to confirm a kill or know your health"*):
>
> | surface | audience | carries | contested by firmware? |
> |---|---|---|---|
> | **gun strip** `$GLED` | the PLAYER | pool colour + event flashes | YES — a single paint breathes (~18% of frames) |
> | **headset** `$HLED` | OTHER players | hit taken, out, team | ⚠️ **UNVERIFIED** — assumed no (dark in native play), never measured on a SPAWNED gun |
> | **sight** `$SFLASH` | the PLAYER | kill confirm | native, already wired on `KillConfirm` |
> | **phone HUD** | the PLAYER | everything detailed, animated | none — the one surface we fully own |
>
> **Built and shipped:** `poolgauge.py` (pure mapping + event paints, night-mode dimming) wired into
> `GameDriver` — pool gauge on `$HP` change, event paints on `Respawn`/`Heal`/`Eliminate`, each a
> 3-pulse BURST ending on the team colour (tuned 2026-09-03; see the banner above). Phone HUD gained animated `hit` and `gain` moments
> (`app/src/hud/hud.js`, `tools/moments.mjs`, 9 screen-truth steps).
>
> 🔴 **NEVER hammer `$GLED` to hold a colour.** ~32 Hz wins the hue (93% of frames against 18% for a
> single paint) and **STROBES** — operator: *"it looks like its having a seizure"*. Flicker in the
> 10-25 Hz band is the photosensitive-epilepsy trigger range, and this sits on a gun in a dark arena
> in front of a player's face for a whole match. A warning sits in `poolgauge.py` next to the event
> table, because that is where someone would reach for the technique.
>
> ⚠️ **Still open:** (a) `$HLED` on a SPAWNED gun is UNVERIFIED — the claim that it holds because the
> headset is dark natively is reasoning, not measurement, and reasoning lost to the operator's eyes
> repeatedly this session; (b) whether the gun's breathing pulse actually READS as feedback is a human
> judgement nobody has made yet (`mcp/tools/led_demo.py` shows it). Both are on
> `docs/bench-2026-09-03.md`.

## ✅ F1 — BUILT 2026-09-02. Pool-status LEDs, painted over BLE, verified on hardware

> **The config route was ruled out first, on hardware, exactly as this entry demanded.**
> `gauge_hunt.py`, ten candidates (`$GSET` t8 gameMods 1/2/4/8/16, `$GSET` t4 autoAmbientLight,
> `$GSET` t5 gyroscope, `$PSET` t2), every one driven to pools (35,0,0) — about 30% of total. **No
> gauge.** The three LEDs always moved TOGETHER; a gauge collapses ONE segment while its neighbours
> hold near 1. No spread exceeded 0.05 against a 0.45 threshold. So there is nothing to switch on and
> we paint it. ⚠️ Scope: ten fields, single bits only for t8, no combinations — "not these ten", not
> "impossible".
>
> **Built:** `mcp/brx_mcp/poolgauge.py` (pure: frames in, frames out, no I/O and no clock) wired into
> `GameDriver` via the existing `Action` path — `feed()` emits the gauge off `$HP`, `tick()` emits the
> revert, so the driver's single-I/O-path rule holds. 14 unit tests.
>
> - shield **teal** · armour **purple** · health **green → yellow → red** as it falls. Hue says WHICH
>   pool; only health encodes urgency, because only health is urgent.
> - Segments: `ceil(level/max × 3)`, and **anything above zero lights at least one** — a player on
>   1 HP must not look identical to one who is out.
> - Reverts after **4 s**; a fresh change RESTARTS the window (a deadline, not a countdown).
> - Encodes with COLOUR at full brightness, never brightness: at the dim setting our colour stops
>   being the dominant hue (measured 2026-09-02).
>
> **Verified end-to-end on hardware** (`mcp/tools/gauge_paint_check.py`): all 10 level/pool cases plus
> the team revert, through camera ROIs that were themselves verified with a 3×3 response matrix.
>
> ⚠️ **The measurement needed three attempts, and that is the lesson.** A lit LED bathes the whole
> housing in its colour, so a DARK neighbour's ROI fills with reflected light: armour 2-of-3 measured
> LED3 at 170 against a 134 dark baseline, and BOTH a flat threshold and a nearest-reference
> classifier called it lit. Looking at the actual crop settled it in seconds — LED3 was visibly dark,
> just washed. The discriminator is that a lit LED **core blows out to white** (255/254/255) while
> reflected wash does not (that LED3 peaked at G=203). Judging by saturated-pixel fraction separates
> them cleanly: lit 0.10–0.51, dark 0.000–0.025.

## 🟢 F1 (original spec) — POOL-STATUS LEDs: show health/armour/shield on change, revert to team colour (2026-08-30)

**Tony's spec, verbatim:** *"during game we want to be able to take over and show shield health. after a
time of no damage reset to team color."* … *"on health/armor/shield change +/- the leds should indicate
that status. then after a few seconds maybe 3-5s go back to team color or mode color."*

### ⭐ THIS ALREADY EXISTS IN STOCK FIRMWARE — find the field, do not build a driver

Tony, on Supremacy (2026-08-30): *"the maurader health bar worked differently. it showed armor and then
health and it would switch back to team after being delt damage."* That is this entire spec, running
natively, with the **gun** handling the revert timeout.

**So F1 is probably a CONFIG question, not an LED-driver question.** The Marauder differs from other
classes, so a field selects the behaviour. Find it and F1 costs one setting instead of a BLE write per
hit per player.

**Where to look:** diff a Supremacy class setup against ours — `$PSET` (the class/character block)
first, then `$GSET`. Note a native game runs on-gun and may never touch BLE, in which case config
diffing is the *only* route and there is nothing to capture.

**Do not build the `$GLED` driver below until this is ruled out.** Driving it from the host is strictly
worse: it flickers against the native gauge, costs a write per hit, and reimplements something the
hardware already does properly.

### Behaviour (as originally specified)

1. Any change to **health, armour or shield** — up or down — paints the three gun LEDs as a gauge of the
   pool that changed.
2. After **3-5 s with no further change**, revert to the team (or mode) colour.
3. A new change inside that window **restarts the timer** rather than queuing.

### What makes it buildable

`$GLED,<led1>,<led2>,<led3>,<apply-gate>,<brightness>` — three independently addressable LEDs, direct palette
indices over nine colours (**0 red · 1 blue · 2 yellow · 3 green · 4 purple · 5 teal · 6 white ·
7 pink · 8 orange**; 9/10 dark). **Token 4 is an apply gate**, not an effect enum: 0/6/7/8/9/10 apply the
frame's colours at full brightness, 5 applies them at ~1/3 brightness, 1/2/3/4 are no-ops that leave the
previous colour lit. `$GLED,,,,5,,,*` (Callsign's) blanks because **its colour tokens are empty and t4=5
applies them**, not because 5 means off. Token 5 is brightness: **0 off · 1 dim · >=2 full**. Solved
2026-08-30; palette completed and token 4 explained 2026-09-02.

The host already sees every pool change on the wire: `$HP,<hp>,<armor>,<shield>` arrives on damage, and
`$HIR` on every hit. So the trigger is free — no polling.

Suggested mapping (colour per pool, segments per level):
- **shield** teal · **armour** purple · **health** green, shifting yellow then red as it drops
- 3 lit = full, 2 = two-thirds, 1 = one-third, 0 = empty

### ⚠️ RESOLVED 2026-08-30 — the "blocker" was the native gauge, and my override was destroying it

**This subsection used to argue that a spawned gun's pulse was interference to suppress. That reading is
RETRACTED.** Tony, watching a **native FFA** game: *"two guns went blue. i shoot the other, the pulsing
blue led represents the health. now only the 3rd led is pulsing blue."*

The pulsing is the gun's **own 3-segment health gauge**, in the team colour: three LEDs at full health,
dropping to one as health falls. So:

- The "alternation" that "washed out" my gauge **was a working gauge underneath**. `$GLED` was not being
  ignored and was not fighting an animation — it was **overpainting the real thing**.
- A spawned gun pulses **because it is displaying pools**. That is why it only ever appeared when
  spawned, and why it never "settled".
- The old option list ("find the suppressor", "re-assert on a repeat") aimed at destroying the feature
  F1 was asking for. **Do not pursue it.** `$HLOOP,0,0` is still not a suppressor — that part stands.

`$GLED` per-LED control remains real and useful for **night mode, hit flash, per-player colour and FFA
white**. It is simply the wrong tool for **health**, because the gun does health itself.

### ✅ ANSWERED 2026-09-02 — F1 IS BUILDABLE (an earlier answer here was wrong, see below)

Both halves are now measured, on hardware, with a camera rig.

**1. The native gauge does NOT appear in our compiled games.** Armed and spawned from our own frames,
damaged to armour 0 / HP 15 of 45: still three LEDs pulsing, no step-down at any point. The 2026-08-30
"the pulse IS the gauge" sighting was a **native** FFA and does not transfer; in our games the same
pulse is only team colour.

**2. And we cannot paint over it either.** Sampled repeatedly rather than once, because the failure
mode is "works for a moment and is then repainted":

| state | result |
|---|---|
| UNSPAWNED, we set green | **HELD**, stable over 9.3 s |
| SPAWNED, our green | **wiped** — the gun shows its own team blue |
| SPAWNED, we set red / white | **alternates** blue ↔ ours |
| SPAWNED, re-sent before every sample (~1 Hz) | **still alternates** |

⚠️ **THE TABLE ABOVE IS RETRACTED.** It was measured with `screencap` at ~1 Hz. Re-measured at 60 fps,
⚠️ **CORRECTED 2026-09-02 (night):** that 100% was measured inside the window before the gun's
own animation repaints. A SINGLE paint holds ~18% of frames (it breathes); hammering at ~32 Hz
holds 93% but STROBES and must not ship. See the F1 entry and experiment-log 2026-09-02 (night).
~~our colour is the dominant hue in 100% of frames~~ (white 317 mean / 40 ripple, red 227/32, green
224/61, against 65 for the native animation alone). The native pulse modulates BRIGHTNESS by 10-25%;
it does not replace the hue. The apparent "alternation" was **aliasing** — stills landing in the
ripple's troughs and being classified as the team colour.

**So F1 as originally specified — a persistent 3-segment pool gauge on the gun — IS BUILDABLE**, as
per-LED colour at full brightness. Use colour, not brightness, to encode: at the dim setting
(`t4=5`) our hue stops dominating and the native colour shows through.

### ⭐ What IS buildable, and where F1 should go instead

**The headset holds a colour.** It is natively dark during play, so nothing competes for it:

| state | result |
|---|---|
| SPAWNED, colour re-sent once after `$SPAWN` | **HELD**, stable over 8.4 s |

| want | surface | verdict |
|---|---|---|
| **3-segment pool gauge** | **gun** | ✅ **buildable** — per-LED colour, full brightness |
| sustained state (low health, flag held, powerup) | gun or headset | ✅ both work |
| flash on hit / pickup / kill | either | ✅ |
| brightness as an encoding | gun | ❌ dim loses hue dominance |

**So F1 becomes: pool state as a single headset colour, plus optional transient gun flashes.** Not the
three-segment gauge, which the hardware will not give us.

⚠️ **The caveat that bites in a match and not on a bench.** The native hit flash returns the headset
to **DARK, not to the previous colour**. A held headset colour therefore dies on that player's **first
hit**. The host must re-assert on `$HIR` — one BLE write per hit, cheap, but it has to be designed in
or the feature tests perfectly and silently degrades the moment someone is shot.

**Still open (config, not driver):** what selects the Marauder's armour-then-health native gauge, and
whether that field can be set in a compiled game. That would give us the gauge for free and is the
only route to it.


---

# Q14 — the fn 36/37 multipliers are REAL
*closed 2026-09-02 · was FOLLOWUPS.md L1939–1968*

## ✅ Q14 — the fn 36/37 multipliers are REAL (CLOSED 2026-09-02)

**fn 36 = floor(magnitude × 1.25) · fn 37 = magnitude × 2.**

**Measured 2026-09-02:** 16 trials, 4 magnitudes, 8 different `$SIR` row-tail shapes, with an **fn 1
control on subtype 0 in every trial** that had to read exactly the magnitude or the trial was voided.

| magnitude | control fn 1 | fn 36 | fn 37 |
|---|---|---|---|
| 20 | 20 | 25 | 40 |
| 40 | 40 | 50 | 80 |
| 9 | 9 | 11 | 18 |
| 7 | 7 | 8 | 14 |

**The ×1.25 TRUNCATES:** 7 × 1.25 = 8.75 landed as **8**, not 9. That matters for hits-to-kill.
**Negative result:** the row's trailing tokens do **not** gate the multiplier — tails `0,0,1,,` /
`,,,,` / `0,0,0,,` / `0,0,2,,` / `0,1,1,,` / none / `0,0,1,60` all produced ×1.25 and ×2.

**Still unexplained, recorded not buried:** the 2026-08-27 24-cell controlled matrix read **×1.0 in
every multiplier cell** with a clean fn 1 control. It is **outvoted, not explained** — we do not know
why it read ×1.0. The 2026-08-27 emitter exoneration still stands (the emitter is function-agnostic).

**Scope:** measured through **our** `$SIR` table, which is the configuration we ship; the victim's row
picks the function.

**What is still blocked:** `docs/manual/03-gameplay.md` still withholds hits-to-kill for the **Burst
Rifle, Force Rifle, Bolt Rifle, AMR and Energy Launcher** — not because of the multiplier any more, but
because whether the Callsign app pushes this same `$SIR` table in every game is not established, and
the Energy Launcher's fn 24 lands no damage at all.


---

# Protocol — still unknown (worth a capture or probe) — the P1–P17 table
*closed 2026-09-02 (open rows P3/P4/P8/P14/P15 carried into FOLLOWUPS.md) · was FOLLOWUPS.md L2051–2079*

## Protocol — still unknown (worth a capture or probe)

| # | Item | Status | Method |
|---|---|---|---|
| P1 | `$WEAP` ~6 secondary-fire token positions (7–13) | 🟢 **largely RESOLVED on hardware (2026-08-26)** — 7–11 closed as dormant | **Confirmed not static** (server-fetched, `apk-harvest.md`). Field names/order known; pin wire positions via a one-field Callsign BLE capture, or the server API response. **PROGRESS (2026-08-26, `weapmap` + cap14):** 8 previously-unvalidated positions now move. **`t23` = burstWeaponTime CONFIRMED** (275 on the named Burst Rifle, empty on the full-auto AR and every other weapon). **`t17` == 2 × `t40` in all 6 frames** and `t39` == `t16` — so those are not independent knobs. Wire signatures named: `R01`=Assault Rifle, `R18`=Burst Rifle. ⚠ `t5` (primaryDamage) reads **9** on the AR, not the 24 the 2-frame derivation anchored to — **t5 is unresolved**. **Still empty in every frame: tokens 7–11 (the secondary-fire block)** — needs a weapon with a real alt-fire. Tool: `python -m brx_mcp.weapmap <captures…>`. **DONE: the full Callsign arsenal (20 weapons) is captured and named** → `docs/reference/weapons.md`. Hardware-confirmed: `t14` cycle/charge, `t15` swap delay, `t23` burst, `t24` overheat, `t28`/`t29` action sounds, `t35` overheat sound, `t1`=2 → `t12`/`t13`/`t42`, `t25`/`t26` (Suppressor only, 1 sample). Constraints: `t17`==2×`t40`, `t39`==`t16`. Corrected: `t14`/`t15` were swapped; token 27 is a SOUND not a weapon id. **t5 since RESOLVED (= the RAW magnitude carried in the IR word, NOT applied damage — see P10); t19 captured (Shells on the shotgun); the demotion below is historical** — an AR reads 9 not 24, and a shell-reload weapon reads `t19`=0. **Tokens 7–11 CLOSED as dormant** — empty on all 20, no stock weapon has an alt-fire. Further weapon captures are not worth running. |
| P2 | Per-player identity (not just team) | ✅ **RESOLVED over pure BLE (2026-08-25, §7p + §7q)** | **Set:** `$PSET` token 1 = player id, 0-based 0–63 (app shows 1–64; write `id-1`) — cap10/cap11. **Read:** `$HIR` token 3 = the shooter's player id on every hit (token 4 = shooter `$TID`) — bench-verified both directions on two guns with ids 6 and 19 (§7q). Every earlier capture had all guns at id 0, which is why tok3 looked constant. **No USB `SETUP` cable, no IR receiver needed** for attribution; MC numbers the fleet at arm time. Unlocks FFA per-player scoring, individual K/D + assists, Syphon, and per-player `$SFLASH` kill feedback. FFA no longer needs unique `$TID`s (P9 becomes a duos/trios question only). Remaining: `$HIR` token 2 (always 0) and the IR `P[6]` field cross-check (B13, optional). |
| P3 | `$PSET` voice-pack token→sound mapping | ⬜ | **Server-side** — it's the Callsign `voice-profiles` endpoint (`apk-harvest.md`). Get it from the API capture, or change one voice profile and diff the `$PSET`. |
| P8 | **Callsign server API capture** (gun-off) | 🟡 NEW | MITM the app's HTTPS (`/api/v1/callsign/settings`, `voice-profiles`, `arenas/games`) → yields weapon stats, voice-pack presets, game defs directly. Needs proxy + cert on the phone, not the gun. Distinct from BLE snooping. Answers P1/P3 + weapon stats at once. |
| P4 | `$AS` / `$UP` semantics | 🟡 **probed 2026-08-26 — SILENT on v4.32** | Seven shapes sent to a live, spawned, in-game gun: `$UP,*` · `$UP,0,*` · `$UP,1,*` · `$AS,*` · `$AS,0,*` · `$AS,1,0,0,0,0,0,0,99,*` · `$AS,1,0,0,0,0,0,0,0,*` — **every one produced no reply frame at all.** So neither command is a query on this firmware. Either they are write-only (effect not observable over BLE), or inert on v4.32. `$AS` token 8 = applicator (99=all, 0=local) per LaserTagMods remains untested for *effect*; a future probe should look for a behaviour change, not a reply. |
| P5 | `$HIR` variants; per-weapon IR protocol | ✅ **RESOLVED 2026-08-26** | Per-weapon IR protocol is carried on **`$HIR` token 2** (0 standard, 10 on the rocket — bench exp 2, `brx-protocol.md` §7r / P10). The `45,0,0`/`70,0,0` variants were `$HP`-pool echoes, not damage classes. `tok1` = a per-hit sensor id (groups {0,4} seen; front-vs-back **not** resolvable at bench distance — sensor sweep 2026-08-26, needs shielded isolation). |
| P6 | Results read-back after a game | ❎ | Gun keeps **no score** (§7n). There is nothing to read; the host/phone is the only score-keeper. **Do not probe `$SP`** (half the panic sequence). |
| P7 | `$SFLASH,*` | ✅ **RESOLVED** | **It is the shooter's green-sight kill-confirm flash** — one per kill scored, sent by the host over plain BLE (cap8, §7o). The old "periodic, never near a hit" note came from a **victim-side** capture; kills you score are invisible in your own `$HIR`/`$HP`. |
| P9 | **Max native team count** (`$TID` range) | ✅ **RESOLVED (bench exp 4, 2026-08-26)** | `$TID` is **masked to 2 bits** — effective team = `$TID & 3` (tok4 read 4→0, 63→3, 100→0). **All four masked teams (0–3) are usable** — a re-run with a properly re-armed victim (spawned, team 1, full `$SIR`) caught **5 clean `$HIR,4,0,0,2,24,0,0`** registrations from a `$TID,2` shooter; the earlier team-2 silences were a **bench-script re-setup race** (shooter caught mid-`$CLEAR`), not a team-2 limit. So **native team count = FOUR (0,1,2,3)**; larger squad counts → MC logical teams (FFA + armbands). ~~**FF sub-open now CLOSED:** friendly fire is **NOT IR/firmware-enforced**~~ — **⚠ OVERTURNED 2026-08-26 (unattended IR bench, replicated 2× with a trailing known-good control).** `$GSET` **token 1 IS friendlyFire and IS firmware-enforced**, exactly as the APK teardown labelled it, and it gates **both** damage and support effects:

| `$GSET` t1 | dmg from same team | dmg from enemy | heal from same team | heal from enemy |
|---|---|---|---|---|
| **0** (FF off) | **blocked** (0, 1) | 3, 3 | 3, 4 | **blocked** (0, 0) |
| **1** (FF on) | 4, 3 | 3, 3 | 3, 5 | 5, 3 |

FF off ⇒ team identity is enforced in both directions (damage enemies only, heal allies only). FF on ⇒ team is ignored entirely. The earlier "same-team damage lands under both values" reading came from a single un-repeated probe; a controlled matrix does not reproduce it. **MC keeping `friendly_kills` separately is still right** — but "FF off" is now *also* enforced on the gun, so a mode can rely on it. See exp-log + `brx-protocol.md` `$TID` row. |
| P10 | **IR damage value in the hit payload** | ⚠️ **PARTLY OVERTURNED 2026-08-26 (night)** — **tok5 is the RAW MAGNITUDE from the IR word, NOT the applied damage.** Measured with the emitter at magnitude 20: fn 1 → tok5 20 / pool −20 · ✅ **CONFIRMED 2026-09-02 — see brx-protocol.md §5** fn 36 → tok5 20 / pool −25** · **fn 37 → tok5 20 / pool −40**. The original reading held only because every weapon tested sat on a `$SIR` **fn-1** row, where raw and applied coincide. ⇒ **tok5 is unusable as a damage source wherever a multiplier row is in play**; derive damage from the `$HP` delta instead (our node path already does). Original text: | `$HIR` **token 5 = the applied damage, EXACT** across 4 weapons (AR 9, Shotgun 45, Sniper 80, Rocket 115) — it equals the `$WEAP` `t5` field, so **damage-weighted scoring and heavy-weapon balance are BLE-native** (no IR-payload bit-decode needed). **Token 2 = the shooter's IR protocol** (0 standard, 10 on the rocket) — the explosive/tag-type signal Jay described; **token 7 = weapon subtype** (sniper 1). **Armor model pinned:** armor absorbs 1:1, overflow spills to HP, **no per-hit cap** (feeds the engine/sim — B15). See `brx-protocol.md` §7r. |
| P11 | Health-write semantics | ✅ RESOLVED | exp-log #33: **`$LIFE` and `$BUMP` are both ADDITIVE grants, clamped at max** (send the delta to add; neither is an absolute-set). **NO native regen** — armor held at 18 through 30 s idle. ⇒ shields/overshield/medic/Syphon are buildable via **host-driven** writes (heal on event; Halo-shields = host timer refill). Writes **don't self-emit `$HP`** — value shows on next hit/HUD refresh. |
| P16 | **Do shields activate?** | ✅ **CLOSED 2026-08-26** — **YES, via an IR `$SIR` function-11 event**, never a BLE pool value: shield 0→50→70 on our emitter, and a later hit drains **shield first** (order shields→armor→HP). `$PSET` shield=70 alone does nothing, which is why G-2 saw 0. Original note: | The `$HP` **shield** field stayed **0** all through G-2 despite `$PSET` shield=70/99. Shields may need explicit **activation** (APK `ActivateShield` ability / a `$SIR` or mode setting), not just a pool value — so armor+HP are the working health pools today. Find how to turn shields on (needed for overshield / energy-shield modes). |
| P12 | **`$PB*` playbook enum tables + re-test on v4.32** | ❎ **NEGATIVE on v4.32 (2026-08-27)** — all 12 `$PB*` shapes plus `$INIT` are **silent**: no reply, no state change. The v4.30 FB sequence does not respond on our firmware, so the enums cannot be mapped this way. Enum values would have to come from P8 (the HTTPS capture). Original note: | FB captured the full `$PB*` remote-start sequence on **v4.30** with enum values (`$PBGAME 0=FFA`, `$PBWEAP 0=M4 AUTO`, `$PBPERK 2=Body Armor`, `$PBLIVES 2=5`, `$PBTIME 5=Inf`; `$INIT` blocks start) — `brx-protocol.md` §7j. Map the **full enum tables** for each `$PB*` and confirm the sequence on our **v4.32** (behaviour is version-sensitive). |
| P13 | **`$GLED` colour = single index (0–8)?** | ✅ **CLOSED 2026-08-30 · palette completed 2026-09-02** | **YES, and there are three of them.** `$GLED,<led1>,<led2>,<led3>,<t4>,<brightness>` — tokens 1-3 are the three body LEDs, each a direct palette index over **nine colours**: **0 red · 1 blue · 2 yellow · 3 green · 4 purple · 5 teal · 6 white · 7 pink · 8 orange** (9/10 dark). Bench-verified one field at a time, then predicted and confirmed: `$GLED,3,2,1,0,10` → green/yellow/blue. **7 and 8 were read off a gun on 2026-09-02** with the camera rig (normalised R/G/B: 7 = 1.00/0.30/0.66 pink, 8 = 1.00/0.38/0.30 orange), all three LEDs agreeing on every row and matching the community lead. `$HLED` token 1 shares the palette for 0-7 and diverges at 8 (red on the headset, orange on the gun). **Do not re-run.** |
| P17 | **How to turn the LEDs OFF (night mode)** | ✅ **CLOSED 2026-08-30 · mechanism corrected 2026-09-02** | Send Callsign's own death frame `$GLED,,,,5,,,*`, which is what `gameconfig._led_frames` already ships — **the shipped frame was always right; only the rationale was wrong.** ⚠️ **RETRACTED 2026-09-02: "token 4 = 5 is the off value".** Token 4 is an **apply gate**, measured on a black-background camera rig, 3 trials per value, pre-state verified, driven from a known GREEN by sending RED (which distinguishes a no-op from a blank in a way a dark start cannot): **0, 6, 7, 8, 9, 10 apply** the frame's colour tokens at full brightness · **5 applies them at about 1/3 brightness** (ratios 0.29/0.41, 0.30/0.44, 0.33/0.44 on two LEDs over three trials) · **1, 2, 3, 4 are no-ops** — colours ignored, gun keeps what it was showing. **No value animates** (trustworthy null: the positive control, a spawned gun's native pulse, swings luminance ~494 against 24-70 here). So `$GLED,,,,5,,,*` blanks **because its colour tokens are empty and t4=5 applies them**; applying an empty colour is what turns the LEDs off, and **there may be no dedicated off value at all**. This retro-explains the leftovers: `$GLED,,,,6,,,*`/`$GLED,,,,7,,,*` blanked a lit gun because 6 and 7 also apply with empty colours; `$GLED,,,,3,,,*` did not blank because 3 is a no-op. It also explains why four sweeps of this token disagreed with each other — **a no-op leaves the previous row's colour lit**, so a sweep that blanks between rows reports "nothing is lit" and one that does not reports "everything is lit", from identical hardware. **New the same session: token 5 is a three-state brightness — 0 off · 1 dim (~70%) · >=2 full**, saturating at 2 (2 through 255 indistinguishable; 3× alternating with no overlap, t5=1 → 172/181/184, t5=2 → 267/254/247). ⚠️ `$GLED` now has **two apparent brightness controls** (token 4 = 5 and token 5); whether they compose or one overrides the other is **UNTESTED**. ⚠️ The older shipped frame `$GLED,0,4,0,0,0,,*` was built on the retracted "index 0 = off" reading — index 0 is **red**, so it never turned anything off. Fixed 2026-08-31. |
| P14 | **Audio SD card removable?** | 🟡 NEW | FB: audio is on a **(removable) SD card** ("pop" at boot = speaker OK; corrupt SD = no sound) — tensions our "SD hot-glued, not removed" note. Inspect on hardware: is the card accessible/swappable, and does swapping it change sound independent of the USB `AUDIO`-folder path? (`community-notes.md`) |
| P15 | **`$PLAY` alarm + phone-as-station BLE limits** | 🟡 NEW | For phone-as-extraction-site (`docs/adr/0003-native-app-over-web-bluetooth.md`; phone-app-spec.md deleted): confirm which `$PLAY` sound ids make a good field-wide **extraction alarm** (grenade/explosion bank), and measure the **max simultaneous BLE connections** an Android target phone holds (decides how many guns one phone can make scream — ~3–7 expected). Below that count → mesh-event + per-node alarm. |


---

# R2 (blocker) — the emitter no longer reaches 3 ft → FIXED
*closed 2026-09-03 · was FOLLOWUPS.md L154–175*

## ✅ R2 (blocker) — FIXED 2026-09-03: reseated board B + LED anode moved to 5 V; ceiling ~8-9 ft

> Range ladder, same rig, gun `Tactix-9498`, magnitude-1 shots, re-armed per rung: **3 ft 6/6 · 6 ft
> 10/10 · 8 ft 9/10 · 10 ft 0/10** (witness 10/10 at 10 ft, Tony saw no flashes). All hits `dome0`.
> Sharp cliff between 8 and 10 ft, as a bare unlensed LED should give. Reseat and 5 V were done
> together, so which one fixed it is unknown; leave the rig on 5 V. The software power control below
> is back to being a nicety. Original blocker entry kept below.

## ~~🔴 R2 — the emitter NO LONGER REACHES 3 FT. Power control is now a BLOCKER, not a nicety (2026-09-02)~~ (FIXED 2026-09-03, see above)

> **Measured, same rig, nothing moved:** 5/6 registered at **3 inches**, **0/6 at 3 feet**, with the
> witness hearing 6/6 at both. A **real BRX gun registers normally at 3 ft** against the same
> headset, so the tagger is fine and the board still emits -- our LED just does not carry. It managed
> 78/78 and then 198/200 earlier the SAME session, so it degraded in place over a few thousand shots.
>
> **This blocks:** every hit experiment at realistic range, the muster/preflight test shot, F13
> verification in a live match, and all range work (Q15/Q16).
>
> **First:** inspect the board (a loose wire was reported on it earlier that session). If the wiring
> is sound, this is a power problem -- a fresh IR LED, a harder-driven stage, or the software power
> control below.


---

# S1 — the sound catalog (steps 1, 3, 5 done)
*closed 2026-09-03 (steps 2 and 4 carried into FOLLOWUPS.md) · was FOLLOWUPS.md L1648–1679*

## 🟢 S1 — THE SOUND CATALOG: classify all 2477 on-gun sounds so game modes can pick by meaning (2026-09-03)

> **Steps 1, 3 and 5 DONE 2026-09-03 night** (experiment log "EVERY SOUND CLASSIFIED"): catalog JSON
> + reference page shipped, `python -m brx_mcp sounds <words|category:|ids:> [addr]` searches and
> auditions, `test_every_shipped_sound_id_is_on_the_gun` enforces on-gun ids, five mis-mapped cues
> fixed. **Open: step 2 (Tony's by-ear audit — 148 ids done by 2026-09-04, the rest pending), step 4 (MC picker).**
> ✅ VB17 → the team-neutral VA6D/VA6E lead lines (presentation.py, 2026-09-04).


Tony's ask: *"quickly and easily create new game modes that use real sound effects. for that you need
to understand everyone of them."* State: the bank is off the gun (`~/brx-audio-bank/`, and
`C:\Users\Tony\.brx-mcp\audio-bank\`; raw PCM s16le 44.1 kHz mono; NOT in the repo) and
`mcp/tools/soundbank_analyze.py` produces descriptors + spectrograms + Whisper transcripts per id.
Remaining:

1. **Classify.** From `analysis/catalog.jsonl`: a `category` per id from a fixed vocabulary that maps
   onto game events (hit_hp / hit_armor / hit_shield / crit / death / respawn / kill_confirm /
   heal / shield_on / emp / poison / cryo / incendiary / gas / explosion / weapon_fire:<class> /
   reload / empty / beep_ui / countdown / music / voice:<character>:<intent>), a one-line
   description, and a confidence. Voices get the transcript verbatim. Do it from the rows and the
   spectrograms; do NOT guess from the prefix alone (the H family alone spans hit thuds to headset
   cues).
2. **Audit by ear.** 30-id sample across categories, played through a gun (`$PLAY,<id>,4,6,,,,,*`),
   Tony judging. Fix the rules, re-run, repeat once.
3. **Ship the derived data**: `mcp/brx_mcp/sounds/catalog.json` (id, family, duration, category,
   description, transcript, on_gun, in_app) + `docs/reference/sound-catalog.md` (restated, our
   words -- no raw audio, no raw Sounds.json copy). Retire `sound-bank.md`'s "complete/authoritative"
   claim: 468 ids are gun-only, 157 app-only (see experiment log 2026-09-03 evening).
4. **Picker.** `python -m brx_mcp sounds <query>` (search by category/word, play one) and a
   category-driven picker in the MC game-mode editor, so a mode says "emp hit" and gets a real id.
5. **Sanity**: refuse any `$PLAY` id that is not on the gun (the 157 app-only ids play a fallback).


---

# S4 — the gun body LED as a host-owned in-game display — BUILT (A11.7)
*closed 2026-09-04 (open bench items (b)/(e)/muzzle LED carried) · was FOLLOWUPS.md L1413–1465*

## 🟢 S4 — THE GUN BODY LED AS A HOST-OWNED IN-GAME DISPLAY (2026-09-04) — BUILT (A11.7); default `team` + `pregame: team`, body taken 2.5 s after `$SPAWN` (bench-corrected)

`experiment-log.md` 2026-09-04 "IN-GAME GUN LED CONTROL" (Tactix-E20D, Tony watching): a spawned gun breathes its
team colour and a plain `$GLED` only alternates with it -- but **`$GLED,,,,5,,,*` (the blank) first takes
the LED out of the breathing loop**: the gun goes dark and stays dark, and any `$GLED,<c>,<c>,<c>,0,10,*`
after that HOLDS solid, snaps between colours, and survives firing. **`$SPAWN` re-enables the breathing**, so
the blank must follow every spawn/revive. Tony is calling it a refactor of the gun-LED game config.

**What today's bundle does** (for the record, so the refactor starts from the truth): in play it sends no
resting `$GLED`, ceding the body to the firmware breathing, BUT the A11 event bursts DO write `$GLED`
(three flashes ending on `poolgauge.team_frame`) and `cues.hurt_led` paints the low-health blink. Those
were tuned against the breathing (a single frame was "invisible" because the firmware repainted within
~0.33 s -- 2026-09-03). After a blank the firmware no longer repaints, so the burst's "end on the team
frame" step becomes a HOLD, and the single-frame-is-invisible finding no longer applies.

**Bench-corrected the same night on Tactix-E20D (stage ladder):** the blank must come **≥ 2 s after `$SPAWN`** (+1.0 / +1.5 s
breathing, +2.0 s solid); inside the spawn burst it is undone by the spawn animation. Shipped as `gun.take` on a
2.5 s node timer. Default is now `in_play: team` + `pregame: team` (Tony's verdicts). Open: an event burst that
lands before the take (first 2.5 s of a life) still fights the breathing; the exact threshold (1.5-2.0 s).

**Built 2026-09-04 (night), after brx-grenade's bench answered (a), (d), (f) and the mixed-LED question:**
`presentation.gun.in_play = native | team | dark | health` (A11.7). `native` = today's look, nothing sent, golden
bundle byte-identical. The other three: `$GLED,,,,5` + the rest frame right after `$SPAWN` in spawn AND revive,
`bundle.gun` for the node, event bursts end on the rest frame; `health` ships the HEALTH_BANDS frames and the
node repaints on band change + after each burst (engine `_gunHealthPaint`). Shown in the ADVANCED panel as
GUN BODY. ~~Next: Tony picks the default~~ (decided on the bench: `team`; the blank-inside-the-burst clause above is
also superseded -- see the "Bench-corrected" paragraph). Open bench items: (b) hold time with no traffic, (e) blink forms after a blank.

**Design sketch (as first built; the blank has since moved to the 2.5 s node timer, see above):**
1. `compile.py`: `$GLED,,,,5,,,*` right after `$SPAWN,,*` in `spawn` and `revive`; then the presentation's
   in-play gun frame (`gun.in_play: team|dark|health`, default team colour so the gun looks as it does today).
2. `presentation.py`: a `gun` block beside `headset` -- in_play (team / dark / health), hit flash colour,
   low_ammo colour, powerup colour, and whether event bursts end on the in-play frame (they should).
3. Node (`engine.js`): repaint the in-play gun frame after every spawn/revive (and after a hit if the bench
   says a hit clears it); a health ramp green → yellow → red on `$HP` changes when `in_play: health`.
4. `poolgauge.event_burst` / `led_table`: the burst's last step becomes the in-play frame, not `team_frame`.

**Bench first (brx-grenade offered Tactix-E20D):** (a) does a registered HIT clear a painted colour (2026-09-03
said hits clear the LED -- with or without the blank?); (b) hold time with no traffic; (c) is one blank per
life enough, or does the breathing come back on any event; (d) does the 3-flash burst still read after a
blank, and does its final frame hold; (e) does `cues.hurt_led` (the Callsign low-health blink form) still
run after a blank; (f) does the blank affect the `$SFLASH` sight or the headset. Then build 1-4 with the
same test-first discipline as A11.6.

**✅ BENCH DONE 2026-09-04 (Tactix-E20D — experiment-log "GUN LED bench (S4)"):** (a) a hit does NOT clear a
painted colour when the blank was sent first (flashes, returns; only `$SPAWN` re-breathes) → paint once
per life, repaint on respawn only. **Mixed frames render per-LED after a blank** (`$GLED,3,3,0`=green/
green/red, `$GLED,3,3,9`=green/green/dark) → the 3-segment health bar (`pool_frame`) is viable in-game.
(d) the shipped `event_burst` reads as 3 flashes and its final frame HOLDS. Brightness is capped (255 =
10); the "bright strobe" was the HEADSET reflecting, not a gun mode. (f) the blank is `$GLED`-only. Still
open: (b) minutes-long hold; (e) blink-form after a blank; the separate **muzzle-flash LED**'s
addressability. Refactor (1-4) is **brx's** — bench answers delivered, they hold until Tony says go.


---

# S7 — reconnect / new-match reconciliation on the phone node (S7.1/S7.2 built + validated)
*closed 2026-09-04 (three follow-ups carried) · was FOLLOWUPS.md L1466–1520*

## 🟢 S7 — RECONNECT / NEW-MATCH RECONCILIATION on the phone node (2026-09-04, from the utility bench)

**Status:** the anti-cheat is CLOSED and hardware-validated (S7.1 below); two small HW follow-ups remain
(gap-death re-arm, the dead-player rejoin path) plus one link-hygiene item (S7 #3).

**🔴 ANTI-CHEAT (found + FIXED on hardware 2026-09-04, Tony):** force-close the app at low HP, reopen,
and the app RESPAWNED the player to FULL — a free respawn on demand. Root cause: alive/hp weren't
persisted, so a rejoin defaulted alive:false/hp:0, the recovery deadAt guard stamped a death, and
auto-respawn healed to max. **Fixed (commit 0c3ddf4): `_save`/`_load` now persist
alive/hp/armor/shield/deadAt/killedBy** — a rejoin restores the REAL pools (live at 25 → back at 25,
no false down, no heal). Verified on Tactix-E20D: force-close at 25 → reopen → waits past the respawn delay →
still 25, deadAt 0, no respawn. Engine test added.

**✅ BUILT (S7.1, Tony's design, 2026-09-04): an explicit RECONCILING phase on rejoin where the gun is
DISARMED until state is confirmed.** "It will feel slow and not helpful, but if an app actually crashes
it's no big deal" — the deliberate slow reconcile is itself an anti-cheat measure (restarting to escape
or heal is made unattractive; a genuine crash costs a few seconds, which is rare and fine).
**Implemented in `engine.js`:** a BLE reconnect into a `live` match now calls `_beginReconcile()` instead
of the old trigger-first `_beginResync` — it disarms the gun (`$AMMO,0,0,0,1` on both slots) and holds a
`reconciling` window for `RECONCILE_MS` (3 s). `_endReconcile()` then re-arms to the RESTORED pools
(the `frames.spawn` `$AMMO` frames) **only if alive** — it never writes `$SPAWN`/`$PSET`, so a rejoin can
never heal. No death is inferred during reconcile (the old "reload silent → dead → auto-respawn heal"
path is gone); a REAL `$HP,0` arriving mid-reconcile is still honoured as a (desync) death, so a genuine
death during the BLE gap keeps its real respawn timer. A new match, a match end, and a panic all clear an
in-flight reconcile. Auto-respawn, the recovery deadAt stamp, and scanner-revive are all gated off while
`reconciling`. Reload takeover does not open while disarmed. `state().reconciling` is exposed for the HUD.
8 old §3.10 live-reconnect resync tests were rewritten to the reconcile contract; suite green (99 engine
/ 124 app). HUD takeover copy landed by brx-hud (9f06b19: "GUN RELINKED / SYNCING WITH YOUR GUN / WEAPON
DISARMED FOR A MOMENT · STAND BY", ~3 s, self-clearing). **✅ VALIDATED ON HARDWARE 2026-09-04
(Tactix-E20D):** shot down to HP 29 / armour 0, force-closed, reopened, reconnected → **HP held at 29 (not
healed to 45), same match, alive, no respawn**; Tony saw the takeover and could shoot after it cleared.
The old build countdown-healed to full here. Exploit closed. See experiment-log 2026-09-04 (late night).

Live-bench weaknesses in the §3.10 resync + hydrate path, surfaced repeatedly on 2026-09-04 (they predate
the utility work; only unit-tested before). `app/src/engine.js` / `app.js`:
1. **✅ RESOLVED by the reconcile (S7.1).** The old trigger-first resync left the gun `alive:true hp:0` until
   the player pulled the trigger. The reconcile restores the real pools and shows brx-hud's "SYNCING WITH YOUR
   GUN · WEAPON DISARMED" takeover for 3 s — no trigger pull, no live-but-empty window.
2. **✅ FIXED (S7.2, commit 6512dfa): a new match started on a just-reconnected node now spawns clean** —
   `startAt` clears an in-flight resync/reconcile (a new match supersedes the old one's reconnect state); the
   T-0 spawn is no longer blocked on `!resync`, so it goes alive at full health. Engine test added.
3. **A soft reload left the native BLE link half-open** (still open), so the rejoin scan couldn't find the
   still-connected gun. Node should release the BLE link on teardown/reload. (Not seen again since, but
   unfixed.)

**New HW follow-ups from the 2026-09-04 validation (both need the gun, low risk):**
- **Gap-death re-arm.** If the gun DIED while the app was closed and does not re-report `$HP,0` on reconnect,
  the reconcile trusts the restored "alive" and re-arms it. The firmware gates firing on a truly-dead gun (so
  no cheat — you can't fire a dead gun), but the HUD would read alive until the gun re-announces. Confirm the
  exact failure mode on hardware; decide whether the reconcile should also re-probe once. (node.md §3.10)
- **Dead-player rejoin path untested.** Only the alive-at-low-HP path was validated on Tactix-E20D. Force-close
  while actually DOWN → reopen → confirm you come back DOWN at the real `deadAt` (awaiting your real respawn),
  not healed and not auto-revived early. Should already hold (reconcile gates auto-respawn while reconciling,
  and re-arms only if alive), but verify on the gun.


---

# S8 — the utility station intermittently doesn't see player adverts — FIXED in code
*closed 2026-09-04 (two-Pixel confirmation carried) · was FOLLOWUPS.md L1521–1537*

## 🟢 S8 — the utility STATION intermittently doesn't see PLAYER adverts at high TX (2026-09-04) (was numbered S6; S6 is the legacy-shim sweep)

**Status:** fixed in code (low-latency scan + 8 s restart, commit 73d391a); two-Pixel bench confirmation pending.

On the two-Pixel bench the respawn station (advertising at high TX) sometimes read **zero** player adverts
though players were advertising and its own scan was open; it recovered on its own. Suspect: scanning WHILE
advertising on one radio starves the scan (Android). **Does not affect respawn** (player-side), but **gates
bomb / extraction**, where the station must read who is planting/defusing/extracting.

**✅ FIXED (2026-09-04, code — needs the two-Pixel bench to confirm):** the station opened ONE balanced-mode
(`scanMode:1`) scan at startup and never restarted it — both the exact conditions that froze the player-side
watch. `app/src/utility.js` now (a) scans **low-latency (`scanMode:2`)** like the player watch, and (b)
**restarts the scan on an 8 s cadence** and recovers one stuck OFF, from `tick()` — the same stop+start cure
as `app.js`'s `refreshBeaconScan`, with a `_scanBusy` re-entrancy guard so the stop→start gap can't race a
concurrent tick. **Still open / to try on HW if it recurs:** a lower station TX to ease advertise+scan
concurrency (the roadmap's B "RSSI-vs-distance per TX level" bench will settle the TX choice).


---

# S2 — presentation profile (A11) — BUILT
*closed 2026-09-04 (write UI + open bullets + Lows carried) · was FOLLOWUPS.md L1555–1647*

## 🟢 S2 — PRESENTATION PROFILE (A11): sounds + lights per event, per game — BUILT 2026-09-04 (backend, read-only UI; APK 0.1.6 = 83542f3, the A11.7 take + A11.8 flash engine changes await 0.1.7); the WRITE UI is pending

Tony: *"how the gleds and hleds behave, what sounds are used and when, these should be made into a
config that MC can program … silenced snipers cuts out the announcer stuff and extra led flashes …
counter-strike mode … bomb armed and bomb defused sounds … 'protect the VIP' mode … VIP hits."*

**Done:** `mc/presentation.py` (events, presets standard / silenced / counter_strike / vip / infection / last_stand / extraction, merge +
validation against the on-gun catalog, resolve, cue + LED expansion); `GameConfig.presentation` in the
PUT whitelist; the compiler emits per-event `cues` + a `leds` burst table + a summary; the phone
engine plays them on hit_taken / died / respawned / healed / armour_up / shield_up with a one-burst-
per-second guard; contracts A11; 17 tests + 2 engine tests. **Open:**
> **A11.4 added the same day (Tony: "it should be like halo … probably want an event SYSTEM"):**
> MC→node `alert{kind,text}` fan-out (`Session._alert`, scope all / team / player), Halo-style medal
> stacks on `feedback.medals` (first_blood · double/triple/killtacular · killing_spree 5 · unstoppable 10,
> several per kill, played back to back instead of the kill line), scorer alerts for lead_taken /
> lead_lost / next_kill_wins / last_survivor / infected, node-side clock callouts time_60/30/10, and
> per-mode presets: tdm/ffa → standard · infection → infection · lms → last_stand · extraction →
> extraction · cs (CLI) → counter_strike. **Rule (Tony): events are HUD-driven; MC pushes only cross-player
> facts, best-effort, never waited on** (A11.4). HUD animations for the new `alert` moment and medal
> stacks are with the **brx-hud** session. Suites: mcp 691, app 89.

0b. **A11.6 (same day, Tony)**: the headset as its own block -- team colour pre-game, white flash at the
   whistle then DARK, NATIVE flash on hit (`hit: null`, corrected the same night), the small flash LED pulsed every
   750 ms while dead (`death: flash`; a colour = our big-LED blink; the native out-blink does not run in a hosted game), white flash on respawn,
   flag-colour blink while carrying. Default in-play is now dark; `headset.in_play: "team"` restores the held
   team colour. **Bench to verify**: does `$HLED,<c>,2,120,120,10,2` (count-limited blink) end dark by itself?
   The node follows every flash with an explicit rest frame until that is known; also confirm the white
   double-flash reads as "start" at 6 ft, and that the carrier blink is legible across a field.
0. **A11.5 (same day)**: event `source` hud/mc/both, `hud_events` / `mc_events` / `mc_confidence` switches,
   `Session.mc_confidence()` gating the global-state pushes, `GET /api/presentation`. Done, tested.
1. ✅ **MC UI, read-only (2026-09-04)**: section 5 of the DESIGNER, an **ADVANCED** disclosure that loads
   `/api/presentation` on click — preset, seven switches, MC confidence line, the event table (source
   HUD/MC/both · when · sound id + catalog words · gun / headset colour · HUD text; a muted row carries a SOUND OFF chip). Older server → "THE MC SERVER PREDATES THIS UI" with the restart command; any other error
   → its message. Verified: console unit tests (open/close, 404, error, mounted in the Designer), the
   real-browser suite (fresh server: table rendered from the live MC; stale server: the banner), and an
   old-session boot (fixed on the way: a restored pre-A11 config now gets the mode's presentation
   default, or the console read a stock mode as TUNED). **Next**: the preset picker + switches (write).
   Until then `PUT /api/config {"presentation":{"preset":"silenced"}}`.
2. ✅ **APK rebuilt** 0.1.2 → 0.1.3 (clean tree) → 0.1.4 → 0.1.6 (83542f3) on 2026-09-04, site rebuilt each time. **0.1.7 pending** (gun take, A11.8, A14, utility MC link).
3. **Objective / VIP emitters**: the cues + `alert` plumbing exist; the extraction/objective engines on
   the phone path do not call `Session._alert("objective_scored", …)` yet, and `survivors_win` needs
   the infection end decided. Wire when those modes move onto the phone path.
4. **Per-event override editor** (custom sounds from the catalog picker) — after 1.
5. `bomb_detonated` uses X12 on Tony's ear ("X13 might actually be a sniper"); confirm and align
   `sounds.BOMB_DETONATED` + the proto-10 `$SIR` row.
6. ✅ **HUD** (brx-hud, a34eb3e): `alert` moment banner + medal stack badges on the kill moment. ✅ The scanner DOWN hint now follows the respawn gate ("pull the trigger" vs "stand there", brx-hud 0ac162b, same night).
6b. **Headset flash LED (A11.8, 2026-09-04 night)**: `$LED,9,1,1,1,*` fires the small green flash LED (kill
   feedback). The native hit flash is >= 2x ours by wall reflection and the wall clipped on native -- bound the ratio
   from above with an ND filter / manual shutter; try `$LED` tokens 3/4 at other values for a longer or repeated
   pulse; check whether `$LED` needs the gun spawned. `headset.hit` is native now; `death` default is `flash` = the small LED pulsed at 750 ms while out (Tony's call, same night); a colour still gives the big-LED slow blink.
   **Plan: `docs/bench-flash-control-2026-09-05.md`** (12 rungs + Appendix A: the wire layouts READ from the APK metadata --
   `$LED` has only Color + IsUsedGreenLed (no lever), `$BLINK` order corrected, **`$BHIT` 7-token = inject a hit through the
   firmware path**, the best remaining route to the native flash).

7. **CLI `GameDriver` headset**: the direct-BLE driver still holds the team colour in play and repaints it
   after every spawn/hit (the A11 behaviour); the phone now follows the A11.6 headset block (dark in play,
   flashes). Align the driver with `presentation.headset_frames()` when the CLI grows a profile.

### Polish round 2026-09-04 (night) — LOW items left for a later session (three reviewers over the day's 37 commits)

Fixed in the round (see experiment-log "POLISH ROUND"): the catalog re-parse on every `describe()`, the alert
subject id being overwritten by the recipient id, resync on a healthy gun marking it dead (bogus auto-revive),
event `$HLED` paints over the out-blink, the low-health blink cut by a pending hit-flash rest, `reload_mult` on
the sidearm in the HUD, `headset.death: null` accepted then failing at push, lead/last-survivor alerts skipped
on team kills, `last_survivor` never firing in infection, the turned player hearing "infected" twice.

Left as LOW (not fixed, no behaviour at stake tonight):
- `presentation.merge`: `{"preset": "custom"}` (what `summary()` reports) is rejected -- treat as a no-op preset;
  an unhashable preset value 500s instead of 400s (operator-token-gated); a stored bare `{"preset":…}` profile
  would KeyError in `merge()` on `prof["events"]` (`setdefault`).
- `presentation._colour` admits 8 (orange) and `headset_frames` paints tids 0-7, while compile's
  `_HLED_SEEN_COLOURS` is 0-3: a tid 4-7 head omits the lobby colour but the bundle's headset block paints it;
  `$HLED,8` is unverified on hardware.
- An event's static `$HLED` paint while ALIVE with `in_play: dark` leaves the headset lit until the next flash
  (hold 0 = "leave it"). Decide: follow it with the rest frame after ~1 s.
- engine: medal `delay()`s and event GLED steps are not cancelled by `_endLocal`/panic (a `$GLED`/`$PLAY` can
  land ≤ 6 s after `frames.end`); `_reassertDeathBlink` is not gated on `!resync`; `alert()` plays events in
  `armed` (a parked, unspawned gun); `app.js syncPlayerAdvert` sets `playerAdvert = want` before `start()` so a
  failed advert is not retried; `utility.js stopAdvert` swallows the plugin error.
- `mc_confidence()` treats a rostered player with no `node_id` as missing (a phoneless player silences lead
  alerts for the night) and trusts the node's own `pending` -- both intended; document.
- Beacon plugin: iOS `CBUUID(string:)` on a malformed uuid throws (guard with `UUID(uuidString:)`); Android
  catches only `SecurityException` around `startAdvertising`. `mcp/tools/webview_eval.py` carries a personal
  adb path + default device IP. `app/capacitor.config.json` `webContentsDebuggingEnabled: true` ships in the
  debug APK -- turn off with the release build (B21).
- `compile.py:563` `int(f.split(",")[16])` on a legacy-template `$WEAP` has no isdigit guard (synthetic catalogs only).
- engine `_turned` is neither persisted nor cleared in `reset()`: a player who turned and then reloads the app
  mid-match comes back "never turned" and plays `survivors_win` at time-expiry. Persist it with the match
  context; and the new start-reset test asserts the field, not the time-expiry behaviour -- upgrade it.
- 3-team infection: `_infected_team` is the target of the LAST turn and the engine flips to the first other
  tid, so with three teams the turned players scatter and the survivor count is wrong. Restrict infection to
  two teams in `validate()` or define the infected team in the config.


---

# Build table B1–B23 + B19 (snapshot with histories)
*snapshot 2026-09-04 (open rows carried without their histories) · was FOLLOWUPS.md L60–117*

## Build (hardware/software the platform needs)

| # | Item | Status | Notes |
|---|---|---|---|
| B1 | **BRX Companion accessory** (ESP32-S3 rider: offline engine + powerups + audio + WiFi) | 🔴 spec'd, not built | `hardware/brx-companion-spec.md`. Prototype Tier-0 "Brain" first; validate powerup command sequences ($LIFE/$WEAP re-push/$AMMO) on hardware. Community-proven mount pattern (power-bank + ESP32 on phone bracket, no gun mod). **⚠️ Hardware gotchas from FB (`community-notes.md`):** BRX serial needs a **~5 ms delay per char**, **3.0–3.4 V logic (~3.06 V sweet spot; 5 V corrupts)**, a **diode on ESP32 pin 17 → board RX**; keep tagger-drawn current **<300 mA** (BC-confirmed OK). Design to survive **"SCREAMERS"** (BLE drops / random buzz-fail after ~1 hr, and BC firmware won't re-pair below a battery threshold) — expect reboots, keep batteries topped, don't assume a session-long BLE link. |
| B2 | **Native phone app** to replace Callsign | 🟢 **BUILT** | Native Capacitor app (Android + iOS), the per-player game engine + HUD, reporting to Mission Control over the LAN. Web Bluetooth is dead — see `docs/adr/0003-native-app-over-web-bluetooth.md` + `app/README.md`. Field path (MC↔phone) VERIFIED for the live path (2026-08-25/26 real phone→MC→gun sessions); soak/scale still unverified on hardware (verification-checklist). |
| B3 | **Mission Control** (scan → assign games/teams/weapons → live scoreboard) | 🟢 **BUILT + TESTED** | `docs/spec/mission-control.md`. Operator console built + tested **with operator auth**; compiles per-player `FrameBundle`s (`mcp/brx_mcp/mc/compile.py`) and drives the live game over the LAN (WebSocket). MC↔phone field path VERIFIED for the live path (2026-08-25/26 real phone→MC→gun sessions); soak/scale still unverified on hardware (verification-checklist). |
| B4 | **BRX Utility Box** (open, MC-programmable objective node) | 🟢 **UNBLOCKED 2026-08-26 — emit PROVEN on hardware**: a stock tagger accepted a fully synthetic word from our ESP32+LED rig (`$HIR,4,0,42,2,33` = our invented player/team/damage), armor model applied correctly. Build is now a packaging exercise, not a research one. | `hardware/brx-station-spec.md` — one ESP32+IR box → Hill/Assault/CTF/Respawn/Domination/**Extraction**/**Bomb**/perk emitter, driven live by Mission Control. The open answer to the sealed grenade (G7/G8). ~~Gating build task → B13~~ — **B13 is closed and emit is hardware-proven**; the build is now a packaging exercise. Sounds are `$SIR`-mapped (ours to assign), not cloned from the grenade. QR codes stay the ~$0 alt for simple pickups. |
| B13 | **Capture the BRX IR bit-layout** (for the Utility Box emit side) | ✅ **CLOSED — BENCH-VERIFIED 2026-08-26** (timings, 25 bits, field offsets, parity rule; B=IR-protocol not bullet-type; `payload_parity()` added). Emit side (Session 2) is next. | **Answered from LaserTagMods `NRFL-Bases/Nodes/node1.ino`** — full layout in `protocol/brx-ir-protocol.md`: ~25-bit word after a **2 ms sync**, pulse-width bits (**~1000 µs=1 / ~500 µs=0**, split 750 µs), fields **B4 bullet · P6 player-id · T2 team · D8 damage · C1 crit · U2 · Z parity** (accept if `Z1≠Z0 && Z2<250`). IR-RX prototyping (VS1838B, arriving 2026-08-26) now has a target to confirm. ~~Verify pulse timings/thresholds before trusting the emit side.~~ **Done** — measured sync 1988–1991 µs, marks 990/500, and a stock gun accepted our synthetic word. Field names updated: **B = IR protocol / DamageType**, **U = `$SIR` subtype** (the old "B4 bullet … U2" labels are retracted). |
| B5 | Fix `server.py` for **mcp 2.0** | ✅ **DONE** (commit `6d74728`) | Ported to the 2.0 API — `mcp.server.mcpserver.MCPServer` replaces the removed `mcp.server.fastmcp.FastMCP`. Verified 2026-08-26 on the Windows venv (`mcp` 2.0.0): `import brx_mcp.server` OK and the `mcp__brx__*` tools are live in-session. No pin needed. |
| B9 | **Definitive BRX manual website** (high-polish public site) | 🟡 strategic | Aggregate everything on tagger + headset into *the* authoritative, beautifully-designed public reference (searchable sound bank, pairing/repairs/mods/protocol). Community magnet + SEO funnel to the platform/hardware. Prototype the design + sound-bank explorer as an Artifact first. Restate-with-credit, link official PDFs. See `VISION.md`. |
| B8 | **Grenade STATE app** (phone/web, $0) | 🟡 reframed (exp-log #35/#36) | **Config-over-BLE is DEAD** — objective modes are button-set + locked on the grenade (G8 negative); the app can't replace the on-grenade setup. **Real value = a live STATE DISPLAY:** read the grenade's beacons over BLE (`$HIR` token2=15) → show **Hill** possession + **Respawn** availability live (those two beacon; Assault/CTF/Frag don't). Pair with a printed setup cheat-sheet for the manual button config. Optional: thrown-blast config via `$GREN` if paired (G10). |
| B7 | **Serial-console backend** (pyserial) for `brx-mcp` | 🟢 **QUERY built + verified 2026-08-24** | `brx_mcp/usbconsole.py` + CLI `usb-query [port]`. Reads the full device record over the Teensy USB CDC (VID 16C0): **Serial/Head PIN (= the paired headset's sticker id), Headset Version + Head voltage, Gun voltage, PlayerID, nRF flags, Grenade Pin, PCB rev, BT versions**. Live-confirmed on COM5 (`headset_linked=true`, head 4.0 V). Raw dump backed up to `~/.brx-mcp/device-backups/<serial>.txt` (**out of repo — contains the headset PIN**). **Still open:** `SETUP` (write — set tagger ID / re-pair headset; feeds **P2** per-player identity) — deliberately NOT built yet (factory-provisioning writes; gate behind explicit confirm). |
| B10 | **Synchronized multi-gun start** | 🟢 **HW-PROVEN 3-gun (2026-08-25)** | G-2 (exp-log #33): sequential per-gun config = starts **~10 s apart**. **Fix HARDWARE-PROVEN in `arm_test.py`:** connect ALL → config each → **hold until all live+configured simultaneously** → `$SPAWN` burst to all → armed all 3 **first-try, zero retries, repeatably**. Overturns the old "direct-BLE multi-gun unreliable/pilot-only" call (that was a **dead headset**, not the radio — see B18b). Bake the **config-all-then-spawn barrier + reconnect-until-all-live** into the engine/driver (M0.2, `docs/spec/`); retire per-gun config-then-spawn. |
| B12 | **Host-respawn vs grenade-respawn conflict** | 🟢 **RESOLVED BY MEASUREMENT 2026-09-04 — there is no conflict in a hosted game**: the station words (boot mag 56 = pre-game arm, crit-1 = mid-game arm, beacon mag 6 = revive) are honoured by **native** game modes only; a host-driven game neither arms nor revives by IR, with or without a `$SIR` row (experiment-log 2026-09-04). So in MC games the host is the only respawn authority, and a physical respawn point has to be built on top of it → **B23**. Original note: | The grenade respawn-station disables a gun's self-respawn and provides its own (grenade button → team in-area, or headset-front + trigger); our engine does host-driven `$SPAWN` respawn. **Two competing authorities** — a mode using grenade respawn stations must NOT also host-respawn those players (or must reconcile). Decide per-mode which owns respawn; document in the engine. (exp-log #37) **Respawn-station arming is a per-game step ("Station Arming", `field-process.md` §Muster):** each tagger must **receive the station IR** to switch from self-respawn to station-respawn — an unarmed tagger just self-respawns. **Timing RECONCILED (Jay's video, 2026-08-25):** two arming paths, both valid — **pre-game passive arming** (expose each tagger to station IR before start → it respawns at the station, not automatically) **and** a **post-start grenade-button press** (works even if the game started before the grenade was set to respawn — pressing the button forces each gun in range into respawn-station mode mid-match; explains exp-log #37's "signal after start"). The button press is the reliable per-gun force/re-arm. Still to confirm on HW (→ verification-checklist): (a) a button-armed gun **stays** station-respawn all match; (b) whether the passive beacon alone (no button) also arms. Engine: pick one respawn authority per mode; if using grenade stations, don't also host-`$SPAWN` those players. |
| B23 | **Respawn station for HOSTED games = a node-defined "downed" state** | 🔴 NEW 2026-09-04 | Measured: a dead hosted gun (`$HP,0`) hears **no** IR, and the native station words do nothing in a host-driven game (experiment-log 2026-09-04). So the firmware's 0-HP state cannot be the MC "dead". Design: on `$HP,0` the node immediately re-spawns the gun (`$SPAWN,,*`, ≥3 s after the death per F13) **stunned** (`$AMMO,0,0,0,1` + `$AMMO,1,0,0,1`, the F15 host-driven stun) with the dead LED/sound painted by the node — the gun is alive to IR but cannot fire; MC/scoring treat it as DOWNED (enemy hits on a downed gun are ignored by the node). The station (Utility Box, or a grenade) repeats the Respawn beacon; the downed gun hears it through the **passthrough row** (`$SIR,15,*,,24,…`, FF on — G6) → `$HIR,0,15,0,<team>,6` over BLE → the node checks team + respawn delay → restores ammo/pools = the real respawn. Everything in the chain is bench-proven separately; the assembly is not. Open: the downed gun still takes IR damage (node must absorb/re-spawn), and FF must be ON for a same-team beacon to register (policy is then the node's, not `$GSET`'s). Alternative without the row: station→node over ESP-NOW/BLE proximity, or a QR scan (Callsign's own model). |
| B15 | **FakeTagger fidelity roadmap** (deferred sim gaps) | 🟡 sim built | `brx_mcp/fake.py` runs the full `run_live` path in CI (scoring, respawn, frag-limit, teardown revive, mid-game drop). **Not modeled (each hides a bug class):** weapon-specific damage/ammo, crit modifier, `$GSET` FF→scoring closed-loop, `$VERSION`/`$VOLTS` handshake timing (30 s cadence, `$PHONE` gate) + a fake `diagnose`/`fleet`, native multikill audio, physical LED/headset/audio state, MTU-20 chunking + 5 ms/char serial timing, grenade/objective `$HIR` token2==15 beacons (so cs/domination/ctf/extraction aren't integration-tested yet). Add per-value as those paths are hardened; keep the sim honest (a green test ≠ "works on real guns" — that's earned on the bench). |
| B17 | **Tutorial mode** (guided onboarding, in-range of MC) | 🟡 NEW | A short scripted "training" game that teaches players the controls + what the sounds mean, run while in BLE range of Mission Control (direct-BLE, host-driven). Host walks each player through a sequence and confirms each step from the event stream: pull the trigger (→ hear fire), **reload** (lever or the B16 alt-button; watch `$BUT`/`$ALCD` ammo refill), get tagged (→ hear the hit/pain/death sounds; `$HP` drops), **respawn** (host `$SPAWN`; hear the respawn cue), team LED colour, low-ammo/empty chirp. Each step: `$PLAY` a spoken/cue prompt → wait for the expected event → confirm → next. A `TutorialEngine` (host prompts + event-gated progression) reusing the driver; great first-run experience + a live demo of the sound catalog. No screen, so it's all audio-guided. Sim-testable (scripted events). |
| B18 | **MC Scorekeeper feedback engine** (reconstruct native feedback over BLE) | 🟢 **announcer BUILT + tested** · **mechanism CAPTURED (cap8, §7o)** — wiring `$SFLASH` + confirmed ids open | **The landmark unlock, now upgraded twice.** MC is the **scorekeeper that drives feedback itself**: subscribe to every gun's `$HIR`/`$HP,0`, attribute the kill (team-granular over BLE; per-player needs P2), track streaks + the **4 s double-kill window** (`game-medals-config.json`), and play the right line back to the **shooter**. Host-stamp arrival time — **each gun uses its own boot-local clock**, don't trust `$t_ms`. **⚠ SUPERSEDED:** the earlier *"green-sight is nRF-only, not BLE-drivable, audio compensates"* call is **WRONG** — it probed `$GLED` (team-derived, §7i), the wrong command. `cap8` caught the official app doing it over plain BLE: **`$SFLASH,*` = the shooter's green-sight kill-confirm flash** (exactly one per kill, ~0.4 s after the burst) and **`$PLAY,,4,6,<id>,,,,*` = the announcer slot** (`$PLAY` has a second sound slot at **token 4**; `V3A` = **"kill"**, **confirmed**; `VB17` = score/lead line, sent only when the lead changes). Game end uses both slots: `$PLAY,VSF,4,6,JAY,,,,*`. The app's per-kill burst is `$SFLASH` → kill line → (lead-change) score line. **DONE (2026-08-25):** `brx_mcp/modes/announcer.py` `KillAnnouncer` — first-blood, multikill chain (4 s window), per-life streaks (5/10), all scoped to the shooter's gun; wired into `DeathmatchEngine` (fires in **FFA / unique-team** where a specific killer resolves), snapshot-visible, 10 tests. **WIRED (2026-08-25):** `KillConfirm` action → **`$SFLASH,*`** on every credited kill (the visual, now ours), the **confirmed** `V3A` kill line, and `PlaySound(slot="voice")` → the **token-4** `$PLAY` form for every announcer line (effects keep slot 1). Wire-level tests pin the exact frames. **OPEN:** confirm the remaining **medal/streak** ids (bench `$PLAY` probe or the 2166 bank — `Callout`-only until set); add the **score/lead line** (`VB17`-style, on lead change) which no engine emits yet; adopt the helper in cs/lms/survival/objectives; ~~verify `$SFLASH` on hardware from *our* stack~~ ✅ **DONE 2026-08-26: bare `$SFLASH,*` greens the sight unconditionally, latches several seconds** (exp-log); per-player announces in **shared-team** modes need P2 — **the only stock-feel gap left over pure BLE**. |
| B18b | **Headset-present pre-game GATE in Mission Control** | 🔴 blocking — **but there is now a FREE VISUAL CHECK**: a headset **slow-blinks RAINBOW when disconnected** (Tony, 2026-08-27), so an operator can spot a non-joining gun across the room during muster, before any software gate exists. Add to `field-process.md` §Muster. | A gun with its **headset OFF silently refuses to join** a game (§7m, confirmed live — it was the real cause of every "only 2 of 3 in-game"). A dark headset = a player standing dead all round. **MC muster MUST verify each headset before allowing start.** Detectors: (a) **cabled** — `QUERY` → `Headset Version:` present & ≠ `?` (already parsed in `usbconsole.py`); (b) **BLE/field** — send spawn, require the `$LCD,45,70,…` echo within ~500 ms; **silence = not ready** (headset off/asleep) — a headset-less gun is 100% BLE-silent. Add to the readiness board next to battery; block/flag start on any unready gun. Ties to B3 + `field-process.md` §Muster. |
| B16 | **Kid-mode alt-button reload** (`GameConfig`, per-tagger) | 🟡 NEW | Young kids can't work the reload lever — option to remap the **orange ALT button → reload** (via `$BMAP`). Per-tagger pre-game toggle; allowed on any mode that doesn't need alt-fire; optionally **disable secondary fire** for kids (they won't use it). Clean config→frames feature (the `$BMAP` table is already in GAME_CONFIG). Find the orange-button `$BMAP` index + the reload action code from the app capture / `protocol-classes.md`, add `alt_reload`/`disable_secondary` to GameConfig, emit the remapped `$BMAP`, sim-test the frames. Ties to kid_mode. |
| B14 | **Voice-pack selection in `GameConfig`** (`voice=`) | 🟡 NEW | The official Callsign app lets you **pick a voice** (announcer character); we don't — our `$PSET` voice-pack tail is hardcoded to **Heavy** (`V33/V3I/V3C/V3G/V3E/V37` in `gameconfig.py:_PSET_TAIL`). Add a `voice` field that swaps the 6 voice-event ids (deathAlarm/pain/hitHP/armor/shield/crit + respawn line) to another character. **Data need (P3):** the per-character voice-event id set — sound-bank.md has the prefixes (V0 Fury, V2 Guardian, V3 Heavy, V8 Medic, V9 Raider, VA male…) and examples (Heavy V3I "Get Some", Medic V8W "one shot one kill", V85/83/84 death) but not the full per-event map. Extract the app's voice profiles from the APK, or capture by ear. Fits Tony's "customize everything" requirement. |
| B22 | **APK pipeline: the leftovers a review team flagged and we chose not to fix** | 🟢 low, none blocking (2026-09-01) | Recorded so they are not lost with the session. (a) **minSdk/targetSdk can drift silently**: `app/README.md` and `/platform/app` state 24 / 36, but both live in the generated, git-ignored `android/variables.gradle`, so a Capacitor bump changes them with nothing checking the docs. Fix when convenient: have `android-apk.sh` record them in `build.json` and have site step 9 assert the page matches (do it in the same change, or it is another field with no consumer). (b) **`site/build.mjs` link check does not decode percent-encoding** on `/download/` hrefs; harmless while filenames are restricted to `[A-Za-z0-9._-]`. (c) **The section stamp** `docs/manual/07-platform.md` "Last verified: 2026-08-27" is section-wide and renders above a newer build date on this page; it also drives `sitemap.xml` lastmod. (d) **iOS has no distribution path at all** (folded into B21): an iPhone player still builds from source with a free Apple ID and a 7-day expiry. **What is already handled and needs no work:** dirty-tree publishing (the site build refuses it), a hand-written or orphaned `build.json`, two APKs, an illegal filename, a missing sidecar, and writes into `webapp/download/` (the generator now throws). All are pinned by site step 9c. |
| B21 | **Release-sign + distribute the Android app** | 🟡 NEW (2026-08-30) | The site now hands out the app at `/platform/app` (`webapp/download/*.apk`, built by `npm run android:apk`), but it is a **debug-signed** build: it is signed with Android's throwaway debug key, so the first release-signed build will **not** upgrade over it (every tester has to uninstall first). The debug build is also **`android:debuggable="true"`** (verified in the shipped manifest), so anything with USB debugging can attach to it and read its data; `assembleRelease` clears that too. Before anyone outside the bench installs it: create a release keystore (kept OUT of the repo, password in a git-ignored `android/keystore.properties`), switch the script to `assembleRelease`, and bump `app/package.json` per build (`android-setup.sh` stamps `versionName`/`versionCode` from it). iOS has no sideload path at all, so an iPhone player still builds from source (free Apple ID = 7-day build) until TestFlight. |
| B11 | **Custom connect/disconnect voice** ("Open BRX connected/disconnected") | 🟡 NEW | Branding polish: **back up + replace** the tagger's "phone connected" / "phone disconnected" audio with "Open BRX connected" / "Open BRX disconnected" via the USB `AUDIO`-folder sound swap (`<ID>.LTP`, `reference/brx-extended-user-guide.md`). First find the sound IDs (probe `$PLAY,<id>` around the connect voice, or diff the bank), archive originals, drop in the new clips. Nice first sound-swap demo. |

### ⭐ B19 — MC config VERIFICATION via `$QUERY` (new 2026-08-27, high value / low effort)

**`$QUERY,*` reads the gun's configured state back over BLE** — player id, team, HP, armor, shield,
voice, and **every weapon slot's damage + fire sound** (bench-validated one field at a time, see the
experiment log). `$LCD` returns the *live* pools alongside it. **This turns MC's status from asserted
into observed.**

What it unlocks, roughly in order of value:

1. **Verify the head landed.** We push ~20 frames and *assume* success. A gun that power-cycles silently
   loses its config, and today the only tell is a `$SPAWN` echoing `$LCD,0,0,0,0,0,0`. **Read back after
   arming and diff against what we compiled** — a mismatch means re-push, before the match starts
   rather than during it.
2. **Real muster readiness.** The armory/roster screen can show each gun's **actual** loadout, pools and
   team instead of what we intended. Pairs with the headset **rainbow = disconnected** check (B18b) for
   a muster that is genuinely verified rather than hopeful.
3. **Catch drift.** Callsign wiping `$NAME`, a stale head from a previous game, a gun someone
   power-cycled mid-setup — all become visible.
4. **Debugging aid.** "Did that frame take?" stops being a guess for every future protocol probe.

**Implementation notes / gotchas:**
- **Replies arrive SECONDS late.** Query repeatedly until the answer stops changing; never read the
  first frame back. (This is what first made it look like `$WEAP,*` was the read-back.)
- The read surface is **`$QUERY` + `$VERSION` only** — `$SIR`, `$BMAP`, `$GSET`, `$PSET`, `$TID`, `$LCD`,
  `$HP` bare reads are all **silent**. So the `$SIR` table and button map **cannot** be verified this
  way; the check covers identity, pools, voice and the arsenal.
- Fields are the *configured* values; `$LCD` is the *current* state. Both are useful and they differ.

**Untested and worth 2 minutes at the bench:** `$QUERY,*` against a gun in a **native** game — it should
report that character's HP/armor/shield and weapon damage, which would give us Supremacy character
stats straight off the hardware (part of what P8 is for, with no proxy or Mac).


---

# Tony's asks 2026-08-26 — K1–K6 (snapshot with histories)
*snapshot 2026-09-04 (K1/K2/K4/K6 carried) · was FOLLOWUPS.md L142–153*

## ⭐ Tony's asks 2026-08-26 (night) — perks / alt-fire / headset-explosion

| # | Item | Status | The mechanism (found, needs a trigger-pull to verify) |
|---|---|---|---|
| **K1** | **Auto-reload for kids who can't work the lever** | 🟢 **ALREADY SHIPS — plus a second untested mechanism** | ⚠️ My earlier "t19=5" answer was incomplete. **The feature already exists**: `GameConfig`'s **`alt_reload` flag remaps `$BMAP,1,97`** so the orange ALT button reloads (`gameconfig.py:108/188`) — kid-mode is a per-tagger toggle we already build. **Separately**, the APK's `ReloadType` enum ends in **`AutoReload` (ordinal 5)** and `$WEAP` **t19 = reloadType** — that would be *fully automatic* reloading rather than a button. **Bench: push `$WEAP` t19=5 and pull the trigger on an EMPTY chamber.** ⚠️ Half of this is already answered (2026-08-27, controls both ends): t19=5 does **not** self-reload on an empty or near-empty magazine. Only the *fire-triggered* case remains. Two different kid-modes; test which Tony actually wants. |
| **K2** | **Equip a secondary weapon / perk to the ALT-FIRE button** | 🟡 **mechanism corrected — NOT the t7–t11 block** | ⚠️ My earlier claim that `$WEAP` t7–t11 is the alt-fire mechanism is **refuted by the captures**: t7–t13 are empty in **every** captured frame *and* in ours, and Callsign's alt-fire works anyway. The real path: **the alt button cycles weapon slots** via `$BMAP,1,100,0,1,99,99` (slots 0↔1), which we already push — so "secondary weapon on ALT" is a **slot-loading** question (put the perk/weapon in slot 1), not a token-filling one. `$BUT`'s `ButtonCode` enum (`Trigger, AltFire, Analog`) still gives a host-side path for arbitrary perks. P1's "t7–t11 dormant" call **stands** — I was wrong to reopen it. |
| ~~K3~~ | **Death-explosion** | ✅ **CLOSED 2026-08-27 — CAPTURED**: `proto=10 (StandardLethalExplosive), MAG=125, player/team = the DYING player`. Out-damages the Rocket Launcher (115) and **credits kills to the corpse**. Replayable from any emitter. See the experiment log. Original note: | Tony (hardware fact): a Supremacy robot's death **emits IR from the HEADSET**, damaging like a grenade. That means **the headset is an IR emitter we don't control yet** — and `$WEAP`'s field map has **`extraHeadsetDamage`, `extraHeadsetRangeOutdoor`, `extraHeadsetRangeIndoor`, `headsetDirection`, `headsetRepeat`** (tokens 12–13, 39–40, 43), plus **`PowerType/IRSource` enum members `HeadSetOnly`, `GunAndHead`, `DoubleGunAndHead`**. So headset emission is a **`$WEAP` `primaryPowerType` (t4) setting**, not a hidden command. ⇒ **Suicide-bomber / death-nova is buildable**: set powerType to a HeadSet variant + `extraHeadsetDamage`. Verify on hardware. |
| **K4** | **MELEE does not work in our compiled game** (native mode does) | 🔴 NEW — **NOT a config bug** | Tony had to reboot into a native on-gun game to melee (2026-08-26). But two independent capture reviews found **our melee surface is byte-identical to Callsign's**: `$WEAP,4` character-for-character (`…,4,1,90,13,1,90,…M92…` — proto 13, sub 1, magnitude 90, matching the native swing we captured), all three `$SIR,13,*` rows, `$GSET` with `gyroscope=1`, and all seven `$BMAP` rows including **`$BMAP,8,4`** (button 8 = gyro → melee). Callsign sends only `$GLED` and `$PLAY` beyond what we send; neither gates a swing. ⇒ **runtime/state/trial issue, not a frame.** **Bench (one swing):** in *our* compiled game, **select slot 4 and swing hard**, watching the victim for `$HIR,…,13,…` and the shooter for **`$BUT,8`**. `$BUT,8` + no IR ⇒ slot-4 firing. No `$BUT,8` ⇒ the gyro mapping isn't live despite being sent (check whether `$SPAWN` wipes `$BMAP`, since spawn only re-sends `$BMAP,0,0`). |
| **K5** | **Slot 2 = weapon; PERK is its own slot (A14, 2026-09-04 — was "weapon OR perk"); loadout policy; phone self-serve picks** | 🟢 **BUILT** — server 2026-08-27 (`docs/spec/loadout.md`, contracts A10), perk slot across server + MC + HUD 2026-09-04 (contracts A14, `aec840f`); ⚠️ **not in an APK yet** (0.1.6 = `83542f3`) — the next cut carries it with `00a6a7d` | v1 perks are the PASSIVE ones (Body Armor → `$PSET` armor; Extended Mags → `$AMMO,0` + t16/t39/t17/t40; Quick Hands → t18; **Easy Reload = K1's `alt_reload`, now per-player**). **Med Kit / Concussion stay `hidden` in `perks.json`** until the emit-side bench: their effect lives in the VICTIM's `$SIR` table (a shared constant, game-wide), so a per-player heal-gun needs the table to become policy-derived first. **Empty slot 1 is now legal** (Tony: "alt-fire just does nothing") — the compiler no longer writes a silent default shotgun; bench item: one ALT press with slot 1 empty should reload, not chirp (`brx-protocol.md:48` says reload). The `tutorial` path is unchanged (a try-out is the raw weapon, no perk knobs). |
| **K6** | **Per-game WEAPON TUNING (damage / fire-sound / rate overrides inside a saved game)** | ⬜ deferred — own spec | Tony's "silenced sniper" wants a fire-sound override. `SavedGame.weapon_tuning` is RESERVED in `docs/spec/loadout.md` §8 (always absent today) so it slots in without a schema change; the builtin "Silenced Sniper" preset ships with the stock sound and says so in its desc. Needs: which `$WEAP` tokens per weapon are host-tunable (t5 dmg, t14 fire interval, t27–t29 sounds — `compile._NAMED`), a per-preset override shape, and the bench for sound ids. |



---

# Grenade G1–G10 + Field-range / transport D1–D4 (snapshot with histories)
*closed 2026-09-04 (G3/G4/G9/G10, D1/D3/D4 carried) · was FOLLOWUPS.md L2080–2126*

## Grenade (mostly RESOLVED on hardware, exp-log #33–40 — see `reference/grenade.md`)

> **✅ DONE 2026-09-04 — see experiment-log 2026-09-04 "THE RESPAWN STATION IS ONE IR WORD".** Respawn mode
> captured (beacon / button / boot words), replayed, arms + revives a native-game gun from our emitter; hosted
> games ignore it (→ **B23**). Hill/Assault/CTF/Frag captures still to do (`docs/bench-grenade.md` steps 1, 5, 6).
>
> ~~**⭐ NEXT BENCH — GRENADE + IR EMITTER, side by side (Tony, 2026-08-26; deferred: too loud, family asleep).**~~
> Now that we can **emit arbitrary BRX IR**, the grenade stops being a sealed black box: we can put our
> VS1838B next to it and **capture exactly what each station mode beacons**, then **replay it** and see
> whether a gun responds identically. Specifically:
> 1. **Capture** the real Respawn-mode and Hill-mode beacons on the receiver (`ir-capture`), decoding
>    protocol/team/magnitude/subtype with the now-verified field map. Our decode predicts
>    `$HIR,0,15,0,<team>,<mode>` → protocol **15**, mode in the **magnitude** field (Respawn 6, Hill 8).
> 2. **Replay** them from our emitter at a gun and compare the reaction to the real grenade's.
> 3. **Tony's correction (2026-08-26): IR CAN respawn — the grenade does it.** Our unattended test that
>    concluded otherwise only tried protocol 1 / fn 10 at a dead gun. Find the beacon that actually
>    revives, and whether it revives the dead or only **arms the living** (B12's two arming paths).
> 4. If the replay works, the **Utility Box can impersonate a grenade station** — which answers G9 (CTF
>    team assignment) and the whole objective tier without needing the sealed hardware at all.

| # | Item | Status | Notes |
|---|---|---|---|
| G1 | Grenade objective modes | ✅ RESOLVED (exp-log #33–40) | **5 button-set modes** — red=Frag, green=Assault, blue=Hill(KotH), yellow=Respawn, white=CTF. Set on-grenade only (`$GREN` can't — G8). Beacon decode: `$HIR,0,15,0,<team>,<mode>` (token5: Hill=8, Respawn=6); only Hill/Respawn beacon. Full detail in `reference/grenade.md`. Open sub-items: G9 (CTF team-assign), G10 (thrown-blast). |
| G6 | What objective state does the gun expose over BLE? | ✅ **ANSWERED 2026-09-04** — the passthrough row works: `$SIR,15,<0..3>,,24,0,0,1,,*` with `$GSET` FF on makes a SPAWNED hosted gun report grenade words as `$HIR,0,15,0,<team>,<mode>,<crit>,0` with no pool change (3/3). Earlier: | **Grenade IR surfaces as `$HIR` with token2==15**, but only if the gun's `$SIR` table doesn't eat it (bare/`minfire` config). **Mode-dependent:** **Hill** (`$HIR,0,15,0,2,8`) and **Respawn** (`,2,6`) **beacon their state ~every 2.5–5 s** → readable live; **Assault/CTF/Frag do NOT beacon** (state on the grenade LED only). Remaining: decode the beacon's owner/charge fields over a full capture; confirm the dead-gun-can't-fire gate through a death→respawn cycle. |
| G8 | Active `$GREN` — drive objective modes | ❎ NEGATIVE (exp-log #36) | Swept `$GREN` operationMode 0–7 × iRType {0,15} → **no effect**. **Objective modes (Respawn/Hill/Assault/CTF/Frag) are button-set and LOCKED on the grenade** (set in the boot/setup window only — anti-tamper). `$GREN` is **not** the objective-mode config path. Remaining `$GREN` question → G10. |
| G10 | **`$GREN` for a *paired thrown* grenade's blast type** | 🔴 NEW | `$GREN`'s `GrenadeType` = FlashBang/Gas/Confusion/Molotov = *blast effects* → `$GREN` likely configures a **thrown** grenade (needs the install-accessory pairing), not station modes. Test: pair a thrown grenade, send `$GREN` GrenadeType variants, observe blast. Also test the APK hypothesis that `$GREN` needs the grenade "tapped/loaded" to the gun first. |
| G9 | **CTF flag team assignment** (Tony's hypothesis) | 🔴 NEW | Shooting a CTF (white) grenade w/ a team-1 gun turned it **red**, not team colour (exp-log #35) — CTF likely needs the flag **assigned to a team/home base first** (you grab the *enemy* flag). Likely knob = `$GREN` **`channel`** field (channel/MaxCount decoded from APK → per-team/objective addressing). Test alongside G8. **Also: pull Jay's CTF videos** (`SWAPTX capture the flag JBOX` CxGkNrxUKIQ, `10 gen1 CTF + respawns w/ QR` -_zSFsG79tI) — not yet transcribed; they'd explain the CTF mechanic (JBOX/QR, likely transfers to the grenade). |
| G2 | Grenade pairing procedure | ✅ known | **Hold RIGHT while powering on the gun → "install accessory" → power on grenade (30 s window) → pull trigger aimed at it → it chirps/flashes.** Pair all accessories in one session, tap SELECT to finish (`brx-extended-user-guide.md`). |
| G3 | Capture the app configuring a grenade | 🟡 | PacketLogger while Callsign sets a grenade → exact `$GREN` |
| G4 | Grenade firmware `.bin` flashing | ⬜ uncertain | Community says grenade firmware is `.bin`-updatable, **but G7 found the USB-C is power-only (no disk/DFU) and there's NO PROGRAM pin** — so the assumed "hold pin → USB disk" method does NOT apply. If `.bin` flashing is real it uses an unknown method. Unresolved (`community-notes.md` tension note). |
| G5 | Grenade STATE-display UI | 🟡 (=B8) | NOT a config UI (config is button-locked, G8). Build a live objective screen reading Hill/Respawn beacons (`$HIR,0,15,0,<team>,<mode>`) via a BLE tagger relay. Folded into **B8**. |
| G7 | Grenade USB-C data interface | ❎ RESOLVED negative (exp-log #40) | USB-C is **power/charge only** — no console/drive/DFU in any state (off/on/purple button-hold), no PROGRAM pin. Verified on a known-good data path (a Pixel enumerated on it). So there's **no non-IR channel** to the grenade; state-read = the IR-beacon relay. Grenade audio is reskinned on the gun/headset/Companion, not on the grenade. |

## Field-range / transport (followup D — the way to scale)

| # | Item | Status | Notes |
|---|---|---|---|
| D1 | **Probe the nRF radio** | 🔴 | `QUERY` reports `NRFhost 1`/`NRFslave 1`; LaserTagMods ship NRFL-Bases on nRF24L01. **The BRX may already carry a long-range radio** — if so the range problem has a native answer. Highest-upside unknown. **NEW lead (D4):** the gun natively announces **multikills** ("double kill" on 2 back-to-back enemy kills) — so the *shooter's* gun receives kill confirmations, plausibly over nRF (guns meshing). If so, nRF is already carrying game events. Probe together. |
| D4 | **Native multikill / kill-confirmation mechanism** | 🔴 NEW | Hardware fact (Tony): a BRX gun says **"double kill"** when you tag two different enemies back-to-back in TDM — so the firmware tracks **local ephemeral kill state** and the **shooter's** gun *knows it got a kill* (it must receive a hit/kill confirmation — likely nRF, maybe a return IR ack). Reconciles with §7n (no host-readable *score*, but local kill tracking exists). **Investigate:** (1) does our **BLE-configured** TDM still fire multikill/streak/first-blood callouts (free announcer sounds)? (2) is there a **shooter-side kill event on the BLE stream** (watch the *shooter's* gun on a kill — cleaner attribution than victim `$HP,0`)? (3) mechanism — nRF (→ D1, guns already mesh) vs IR-ack? A 2-gun capture watching the killer's stream is the test. |
| D2 | Transport layer pluggable | 🟡 | design for BLE now, LoRa (RYLR896) / ESPNOW later (`lasertagmods.md`). The Companion's WiFi/MQTT covers most fields. **Radio baseline decided from Jay's measured tests** (`jay-ecosystem.md` §5): **ESP-NOW + external antenna (~581 ft)** for arena chatter; **LoRa in *standard/fast* mode (~1,373 ft, zero loss)** — NOT max-range (~1-in-7 loss) — for the field backbone; LoRa too slow for live score sync → time-sequence control + local scoring. |
| D3 | **Reproduce JEDGE 45-gun host** | 🟡 NEW | Jay ran **45 BRX rifles on one LoRa channel, no server** (`jay-ecosystem.md`). Validates our scale target. Confirm the broadcast-to-all-on-channel model and how per-gun addressing/scoring is time-sequenced. |

**Range problem itself is ❎ answered:** BLE can't support out-of-range play because the gun holds
no state (§7n). The fix is a device *on* each player (the Companion / a phone) — not a better
courtside radio. That reframes D1 as "is there a bonus native radio" rather than "how do we reach
the field."


---

# Field 2026-08-30 — open after the first full match (F2–F10)
*closed 2026-09-04 (F3 and F5 carried) · was FOLLOWUPS.md L2360–2424*

## Field 2026-08-30 — open after the first full match (see `experiment-log.md` 2026-08-30)

- ~~**F2 · The headset never flashes green on hit or kill under our host.**~~ ✅ **DECODED
  2026-09-01, from captures already on disk — do NOT run the capture this item used to ask for.**
  Callsign sends exactly three headset frames: a pre-game `$HLED,<team>,0,,,10,,*`, a once-per-life
  low-health alert (`$PLAY,VA8B,3,6,,,,,*` then `$HLED,7,4,90,90,10,15,*`, fired ~0.9 s after armour
  reaches 0 and HP starts dropping), and an end-of-game blank. **There is no per-hit and no per-kill
  headset frame**: 23 `$HIR` hits produced 2 alerts, one per death. We sent none of the first two,
  which is why our headsets were dark. Both now ship (`compile.py` head, `cues.hurt`/`hurt_led`).
  Full write-up: `experiment-log.md` 2026-09-01 (MacBook).
  **Still open, and it is an EYEBALL test, not a capture (~12 min):** does a per-hit blink happen
  autonomously once the headset has been lit by that pre-game frame? We have never seen the lit
  state, so we have never been able to observe it. Also unconfirmed on hardware: that the two new
  frames do what the capture says. → **F10 below.**
- **F3 · Empty-mag / reload prompt never appeared on sustained full-auto — NARROWED 2026-09-01 to
  one layer.** The gun and the engine are both eliminated, from captures already on disk: a capture
  shows one `$ALCD` per shot all the way down to 0 and then a dry trigger emitting `$BUT` with no
  `$ALCD`, so the gun does report it. What is left is the phone-side path. **Needs:** the phone's raw
  BLE frame ring — hit **Share log** on the phone before closing the app; it lands in the session
  SQLite. See `experiment-log.md` 2026-09-01 (MacBook) for what was ruled out and how.
- **F10 · The two new headset frames are shipped but UNCONFIRMED on hardware.** `compile.py` sends
  the pre-game `$HLED,<tid>,…` and the node fires `hurt`/`hurt_led` once per life; neither has ever
  been seen on a real headset. This is the **only shipped-unverified code path** we have. Next match,
  before anything else: look at the headsets pre-game (do they show team colour?) and at the moment a
  player's armour breaks (does the alert fire?). Either machine, ~12 min, no rig.
  **Test the colour token specifically.** `compile.py` writes `$HLED,<tid>,…` — but across every
  capture on disk that token is only ever **0, 1 or 7**, and no capture contains a `$TID` at all, so
  nothing observed links it to a team. "The tid is the colour" is an inference from `$GLED`'s
  palette, not a measurement (review 2026-09-01; pinned by
  `test_mc_compile::test_what_the_captures_actually_say_about_HLED`). Put a player on **tid 2 or 3**
  and see whether the headset takes the colour at all. Also note Callsign sends this frame in the
  **lobby**, seconds before `$CLEAR`/`$START`, and always paired with a `$GLED` of the same token —
  we send it mid-head and alone. If the headset does not light, try the captured shape first.
  ⚠️ **`docs/manual/` publishes "headset green: blink on a hit, hold on a kill" as a ✅ confirmed
  fact** (`01-hardware.md:139,144`, `03-gameplay.md:187,197-198,205`, `02-operation.md:389`,
  `00-home.md:95`). That marker is not earned — we have never seen the lit state. Settle F10 first,
  then correct the manual in one pass rather than retracting twice. A manual edit needs a site
  rebuild before the next push (`CLAUDE.md` → Layout).
- ~~**F4 · A weapon swap has never been timed.**~~ **RESOLVED 2026-09-04:** the swap delay is `$WEAP` tok15 (850 ms stock; linear, no floor; the gun takes the larger of slots 0/1). MC writes it and ships the enforced value as `FrameBundle.swap_ms`; the HUD's SWITCHING takeover runs for exactly that (`docs/bench-weap-tokens-2026-09-04.md`).
  `engine.lastSwitchMs` now records the true figure whenever an `$ALCD` confirms a swap — pull it off
  the diagnostics log after the next match and tighten the constant.
- **F5 · The AR ships at 140 ms, not the captured 100 ms.** Deliberate (see the log entry): native
  speed with the stock 384 reserve strictly dominates 10 of 17 picker weapons. If stock feel is worth
  more than a balanced arsenal, set `wire.fire_ms` back to 100 and delete
  `test_ttk_band_and_no_strictly_dominant_weapon` — it will fail, by design.
- ~~**F6 · `/api/recap.csv` only ever serves the LIVE scorer.**~~ ✅ **CLOSED 2026-09-01 (handoff W1).**
  `GET /api/matches/{id}.csv` serves any finished match in the session store, through the same writer
  as the live export (`scoring.rows_csv`) so the two cannot drift. The RECAP picker exports the match
  it is showing; NEW MATCH stays live-only, because an archived match is a record, not a place to
  start a game from. `test_mc_api::test_archived_match_csv_exports_that_match_not_the_live_one`.

- ~~**F8 · `POOL = 115` is hardcoded in `views.py`.**~~ ✅ **CLOSED 2026-09-01 (handoff W2).** ARSENAL
  and KIT quoted `HITS TO KILL 13 · TTK 1.68S` for the AR at every health config; at a 100/100 pool
  the real answer is 23 hits. `weapon_view(..., pool=)` now follows `config.health` (per-player
  `loadout.overrides` win, exactly as `_gset` reads them), the screens name the pool they are
  quoting, and `weapon-design.md` §2.5's sensitivity table is machine-checked against the wire.

- ~~**F9 · Nothing tests the MC web console.**~~ ✅ **CLOSED 2026-09-01 (handoff W5).** `webapp/mc`
  has a `test` script: 69 jsdom tests in ~1.7 s that mount every screen against a full session, an
  empty one and a null one. It found two live bugs on its first run — `CommandBar` still crashed on
  `PH[si][1]` for an unrecognised phase (the same defect as the black ARSENAL page), and `Kit` called
  two hooks below its `if (!state) return null`, so the render that first received a snapshot ran
  more hooks than the one before it. It does not replace `app/tools/e2e.mjs`; it is the gate that
  runs before that suite is worth starting.


---
- 2026-09-07 **Q19** FFA colour: WHITE (tid 6) on both surfaces — Tony, matches stock FFA; eight teams verified on hardware the same night. **S4 (b)** a held gun paint survives 8 min with no traffic.


# S15 — the FrameBundle boundary has no guard
*closed 2026-09-07 · raised by brx-sound, built the same hour · `mcp/tests/test_bundle_contract.py`*

- **S15 🟡** **Nothing guards the FrameBundle boundary** (raised by brx-sound, 2026-09-07). The UI contract test
  added 2026-09-07 compares `types.py` against `webapp/mc/src/api/types.ts`, which covers the MC console. The
  **phone** consumes a different contract, `FrameBundle`, and reads it in **57 places** in `app/src/engine.js`
  against **zero** mirrored declarations, so a field the compiler renames or drops fails as `undefined` at
  match time rather than in CI. It is the same class of bug the UI test was written for, on the boundary that
  actually runs a game. A cheap first cut: assert every key `compile.py` emits is named in `contracts.md` §3,
  and that each bundle key the engine reads is one the compiler emits. Worth doing before the bundle grows
  again — S14's `siphon` block crosses exactly this line. `build`.

**Built.** `test_bundle_contract.py`, four steps. Errors: every key `compile.py` emits must be declared in
`types.py`'s `FrameBundle` **and** named in `contracts.md` §3, and the two declarations may not disagree.
Warning only: bundle keys `engine.js` reads that the compiler never emits are printed, never failed, because
the engine tolerates older bundles on purpose (`_pickTable` returns `[]` with no `sir_pool`; an absent
`pset_pool` means the head's `$PSET` stands) — brx-sound's call, and it is right. Both error directions were
proven to fire against copies of the sources, not by editing the shared ones.
