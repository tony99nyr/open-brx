# Mode limits & feasibility — by tier

> **Update 2026-08-25 — P2 is CLOSED over pure BLE** (`protocol/brx-protocol.md` §7p/§7q): `$PSET` token 1 sets the gun's player id (0–63) and `$HIR` token 3 reports the shooter's id on every hit, bench-verified both directions. No USB `SETUP`, no IR receiver needed for per-player attribution. References to P2 below are historical.

The honest companion to `game-modes.md` (what each mode *is*) and `build-tiers.md` (what each budget
*adds*). This doc is the **constraints ledger**: for the modes we've designed — Extraction, Counter-
Strike (plant/defuse), the health/regen variants, the objective family (Domination/KotH/CTF), respawn
stations, and phone-as-objective — *what actually limits them, at each tier, and whether the limit is a
**hard ceiling** or just **pending a hardware test**.*

**Two kinds of limit — keep them separate:**
- 🧱 **Hard** — a physical/platform ceiling we can't code around (no IR on a phone, iOS Web-BT gap, the
  Android 7-connection cap, LoRa bandwidth). Design around it.
- 🧪 **Pending** — plausibly fine, but unconfirmed on hardware; tracked as a `FOLLOWUPS` item. Not a
  ceiling, a to-do.

**Tiers** (the `build-tiers.md` spend ladder): **T0** $0 (guns + a laptop/phone you own) · **T1** old
phones as nodes · **T2** ESP32 Companion per gun · **T3** IR objective stations · **T4** field radio.

---

## 1. Cross-cutting constraints (they shape every mode)

### Platform / BLE
- ⚠️ **iOS has no Web Bluetooth in the *browser*** — not in any Safari version (through iOS 18), and
  every iOS browser is forced onto WebKit, so Chrome/Edge on iOS inherit the gap
  ([status](https://github.com/WebBluetoothCG/web-bluetooth/blob/main/implementation-status.md)).
  **This is a browser limit, not an iOS limit.** Three ways to give an iPhone/iPad full BLE:
  1. **Web path (zero-install):** works on **Android Chrome**; on iOS use a wrapper browser (**Bluefy**,
     **beacio** ~92/93 % W3C conformance — [ref](https://ioswebble.com/)). Second-class on iOS.
  2. **Hybrid app:** the same PWA wrapped in Capacitor/Cordova with a BLE plugin (or a
     `navigator.bluetooth` polyfill → CoreBluetooth). Same web core, first-class BLE.
  3. **Native / RN / Flutter app:** full BLE via **CoreBluetooth** — iOS is then **completely
     first-class** (see `docs/adr/0003`).

  So the *only* real ceiling is **web-zero-install vs. app-distribution overhead**, not capability. **For
  the zero-install first cut, Android (Pixel/OnePlus) is the BLE node and iOS is screens/MC; a native/
  hybrid iOS app removes that split entirely.** (The 7-connection cap below is **Android-specific**; iOS
  has its own, generally fine for a handful of guns.)
- 🧱 **Android central caps at 7 concurrent GATT connections** (`BTA_GATTC_CONN_MAX=7` in the Android
  Bluetooth stack; fewer are reliable in practice). **Consequence:** one phone hosts a *handful* of guns,
  not a crowd — so "one phone as the hub for everyone" doesn't scale; past ~4–6 guns you need a node per
  player (T1/T2) or multiple host phones. ([Android stack](https://support.google.com/android/thread/43071437/maximum-connection-limit-reached-on-connecting-via-android-ble?hl=en))
- ⚠️ **A laptop (MacBook running Mission Control) has no *officially documented* BLE limit** — it's
  **controller-bound and undocumented** by Apple. Practically it holds more than a phone but still a
  handful: the oft-cited **~7** (fewer with heavy per-link data; some report more), **degrading as links
  are added** (all active links share the radio's connection events). watchOS/visionOS are capped at 2;
  macOS is more generous but not unlimited. ([Apple forum](https://developer.apple.com/forums/thread/738861))
  **Two reasons this is a non-issue by design:** (1) **range** — even with a high count, BLE is ~1–10 m,
  so one laptop physically can't reach guns spread across a field; (2) **architecture** — **Mission
  Control is a *server the nodes report to over WiFi (WebSocket)*, not a BLE hub** (`../CLAUDE.md`,
  `docs/adr/0002`). Each player's node holds its *own* gun's single link; MC's own BLE count is
  ~0. **Small-scale exception that works today:** for ~4 guns a laptop *does* connect to all of them
  directly — the `arena`/`fieldstart` CLI already does exactly this. So: **direct-drive a few guns from
  one machine (fine for Tony's 4 BRX); go node-per-player for anything bigger or on a field.**
- 🧱 **The gun keeps no game state** (`protocol/brx-protocol.md` §7n) + **BLE range ~1 m reliable** →
  anything needing a clock/score/respawn needs a listener *on the player* out on a field. This is the
  whole reason for per-player nodes (T1/T2).
- 🧪 **"SCREAMERS" reliability** (`reference/community-notes.md`): in hosting/online modes, guns can
  buzz-fail after ~1 hr and **BLE won't re-pair once the battery drops below a threshold**. **Design
  rule:** budget for reboots, keep batteries topped, never assume a session-long link. Affects *every*
  BLE-hosted mode; worst for long games.
- 🧪 **BLE establishment is ~1-in-3 flaky** (holding is fine once up); MTU-20 chunking required.

### IR
- 🧱 **Phones have no IR** — can't shoot-to-capture, can't emit an IR respawn/"safe" tag, can't be shot.
  Phone objectives work by **touch / proximity / camera**, never by laser hit. Any *shoot-the-point*
  mechanic needs an **IR station (T3)** or **the grenade**.
- 🧱 **IR is line-of-sight & directional** (~30 ft grenade; range scales with indoor/outdoor mode). Cover
  blocks it; aim matters.
- ✅/❌ **Grenade objective state over BLE is mode-dependent** (G6 resolved): **Hill and Respawn beacon**
  (`$HIR,0,15,0,<team>,<mode>`, readable via a bare/`$SIR`-passthrough gun); **Assault/CTF/Frag do NOT**.
  So a live HUD / auto-proximity works for Hill/Respawn, not the others. A **spawned gun with a `$SIR`
  table silently swallows** grenade IR — read it bare or with a passthrough `$SIR`.

### Identity & protocol (mostly 🧪 — pending, not ceilings)
- ✅ **Per-player identity (P2 closed):** `$PSET` tok1 sets player_num (0–63), `$HIR` tok3 reports the
  shooter's player_num on every hit — bench-verified both directions over pure BLE (no `SETUP` cable, no
  IR). FFA per-player scoring and "credit the exact killer" (Syphon) both resolve exactly; the only limit
  is **LAN coverage** of the node that hears the hit, not identity.
- 🧪 **Max native team count (P9):** confirmed 2 (TDM) + 3 (Supremacy); N-team / duos native support
  untested. *Workaround today:* FFA + Mission-Control logical teams (any structure, no hardware FF
  protection).
- 🧪 **IR damage value (P10)** — needed for damage-weighted scoring. ✅ **Regen is NOT native (P11
  closed)** — armor held through 30 s idle, so Halo-shields are **host-driven** (node refills). 🧪
  **`$PB*` enums are v4.30; ours is v4.32 (P12).**
- ✅ **Health writes CONFIRMED** — `$LIFE` and `$BUMP` are **both additive grants clamped at max** (exp-log
  #33); heal/boost/(armor-)overshield work today. ⚠️ **shield pool is inactive until activated (P16)** —
  refill armor+HP, not shields, for now.

### Power / physical
- 🧱 **A phone with its screen on drains fast** (~a couple hours on an old phone) — mount with power for a
  fixed objective. 🧱 **Phones are fragile/weak outdoors** (glare, weather) — case/enclosure or keep them
  indoors.
- 🧪 **Station IR range is a power tradeoff** (`hardware/brx-station-spec.md`): 3.3 V GPIO drive = weaker
  beam; a separate 5 V emitter port = stronger. ✅ **<300 mA off the tagger is OK** (BC-confirmed) for an
  in-gun Companion.

### Networking / scale
- 🧱 **No venue WiFi on a field** → live *global* consensus (a live field-wide scoreboard, instant "flag
  taken" everywhere) needs a **broadcast downlink (T4)**; without it, modes still *run* but sync is
  store-and-forward, not live. 🧱 **LoRa is low-bandwidth** (multi-second round trips) → time-sequence
  low-rate control, keep scoring local; never a live per-hit firehose.
- 🧪 **Multi-node caps** (field-reported): LoRa domination **1 master + 9 slaves (10)**; hosted KotH
  **~21 boxes**; ESP-NOW ~250 ft (~581 ft with an antenna); LoRa-standard ~1,373 ft. (`jay-ecosystem.md` §5)

---

## 2. Per-mode limits, by tier

Legend: ✅ works · ⚠️ works with a caveat · ❌ blocked (reason). "Pending" caveats link a `FOLLOWUPS`
item; everything else is a hard limit.

### Extraction (raid-and-extract)
Mechanics: `game-modes.md` §Extraction. Engine built: `mcp/brx_mcp/modes/extraction.py`.

| Tier | Extraction status | Limit / why |
|---|---|---|
| **T0** ($0, guns + 1 phone) | ⚠️ playable at small scale | Loot wallet + channel + drop-on-death all run in the engine on one phone. **Hard limit: the 7-GATT / iOS-wrapper caps** → one phone ≈ ≤4–6 guns. "Loud extraction on every gun" only reaches connected guns. Loot is virtual (kills/timer), no physical loot pickup. |
| **+T1** (phones per player) | ✅ full small-field | Each player's node runs its own engine + plays its own alarm → the summon is a mesh event, **every** gun screams. ⚠️ iOS players need a wrapper; 🧪 per-player loot-from-kills wants P2 for exact credit. |
| **+T2** (Companion) | ✅ rugged/loud | Companion node = louder alarm, custom audio, no phone dependence, survives SCREAMERS reboots better. |
| **+T3** (stations) | ✅ real extraction *point* | A physical IR extraction site you defend (shoot/dwell), dropped-loot **beacons** you hunt. Without T3 the "site" is a phone (touch/proximity only, 🧪 G6 for auto-detect). |
| **+T4** (radio) | ✅ field-wide | Hidden multi-extracts + field-wide "extraction inbound" broadcast. 🧱 Without T4, "everyone hears it across a big field" is store-and-forward, not instant. |

**Bottom line:** Extraction runs at **T0** for ~4 guns on one phone; needs **T1** to scale the alarm to
everyone, **T3** for a real defendable site, **T4** for field-wide drama.

### Counter-Strike (plant / defuse)
Mechanics: `game-modes.md` (custom modes).

| Tier | CS status | Limit / why |
|---|---|---|
| **T0** ($0, grenade + 1 phone) | ⚠️ playable | **Grenade = bomb site**, a phone/host runs the plant timer + defuse puzzle. **Eligibility is hardware-gated: a dead gun can't fire → can't shoot-to-arm** (🧪 confirm through a death→respawn cycle). Detonation "blast" can't damage players without IR — resolve the round abstractly or push `$BUMP` to *connected* guns only. |
| **+T1/T2** (nodes) | ⚠️→✅ | **Auto-enable Plant in range** — if the site is a **Hill/Respawn-mode** grenade, its beacon (`$HIR,0,15,0,<team>,<mode>`) reaching a player's gun proves presence → node enables Plant (✅ G6 confirmed for those modes; **Android only** to read the gun stream; iOS needs a wrapper). Node greys out Plant while dead. |
| **+T3** (stations) | ✅ multi-site, robust | Real IR bomb-site stations run the plant timer locally, defenders defuse via IR; blast can damage via station IR. Cleanest version. |
| **+T4** | ✅ | Field-wide "bomb planted" callout + live round state. |

**Hard limits:** phone-as-bomb can't sense *who* touches it (team) — use team-gated codes / QR-badge
camera / BLE-proximity; and can't deliver an IR blast (needs station/grenade IR or an abstract round
end). **Everything else is buildable software, not ceilings.**

### Health / regen variants (Syphon, Halo shields, overshield, medic)
Mechanics: `game-modes.md` §Health/regen. All **T0** — no props.

| Variant | Tier | Limit / why |
|---|---|---|
| **Halo regenerating health** | ✅ T0 | Per-node, no P2. **Host-driven only** — regen tested, armor does NOT self-recover (P11 closed); node refills via additive `$LIFE`/`$BUMP` after a no-damage timer. Refill armor+HP (shields inactive — P16). |
| **Overshield / medic** | ✅ T0 (armor) | Host grants additive `$LIFE`. ⚠️ **shield pool inactive until activated (P16)** — use an armor overshield today. |
| **Syphon (health-on-kill)** | ✅ T0 | Routes to the *exact* killer — `$HIR` tok3 gives the shooter's player_num over BLE (P2 closed). The only limit is **LAN coverage** (a node must hear the hit), not identity. |

**Bottom line:** host-driven regen/heal/medic (armor+HP) are the cleanest modes we have (T0, per-node,
additive writes confirmed). Syphon now resolves the exact killer over BLE (P2 closed); shield-pool
effects still wait on P16.

### Objective family — Domination / King-of-the-Hill / CTF / Assault
Mechanics: `game-modes.md` catalog. These are inherently **contested-place** modes.

| Tier | Status | Limit / why |
|---|---|---|
| **T0/T1** (no props) | ❌ as *capture-by-fire* | 🧱 A *place* can't be authored by the guns (no state) and a **phone can't be shot** (no IR). Needs a physical IR point. *Exception:* the **grenade** gives you a single-point **Hill/Respawn/Assault/CTF** for $0 (Hill/Respawn state is BLE-readable; ⚠️ CTF turned red-not-team — team-assign open G9; grenade has no winner display/scoreboard). |
| **+T3** (IR stations) | ✅ the real thing | One station primitive → Domination (1 pt/s), KotH (hold 45 s, ~5 s recapture), CTF, Assault. 🧪 P10 for damage-weighted scoring. |
| **multi-point** | ⚠️ needs linking | 🧱 Several points that share score need base↔base networking (ESP-NOW arena / **T4** LoRa field). Caps: 10-station LoRa domination, ~21-box KotH. |
| **+T4** | ✅ live | Field-wide live ownership/scoreboard. Without it, multi-point still scores but syncs late. |

**Bottom line:** the objective family is fundamentally **T3** (needs IR points); the grenade is the only
$0 shortcut and only for a *single* point, with its own quirks.

### Respawn stations
| Tier | Status | Limit / why |
|---|---|---|
| **T0** (host phone) | ⚠️ authority-only | A phone can respawn guns it's connected to (`$LIFE`/`$SPAWN`) — but 🧱 7-connection cap + 🧱 no IR "melee/proximity respawn." Fine for a small base; doesn't scale. |
| **grenade** | ✅ $0 physical | The grenade natively does Respawn Station (shoot to claim team, button/melee IR to respawn) — but ⚠️ the "must signal each gun post-start" gotcha (`reference/grenade.md`). |
| **+T3** (station) | ✅ + data mule | Purpose-built respawn point that doubles as a store-and-forward sync node on a field. |

### Phone-as-objective (screen objectives: bomb, hack terminal, hostage, utility box)
The phone's superpower is the **touchscreen**; its ceiling is IR.

| Capability | Status | Limit / why |
|---|---|---|
| Touch/keypad/puzzle interaction, visual state, audio, camera-ID | ✅ any tier | It's a web page — runs on **any** phone incl. iOS (no BLE needed for the screen role). |
| Make connected guns react (`$PLAY`/`$LIFE`) | ⚠️ | 🧱 Android (or iOS wrapper) + 🧱 7-connection cap; at scale, drive via the mesh + per-node, not one phone. |
| Be *shot* / IR-captured / emit IR | ❌ | 🧱 No IR hardware — use the grenade/IR-station for the shoot-the-point half. |
| Run all day outdoors | ⚠️ | 🧱 Screen battery drain + fragility — mount with power, shelter it. |

---

## 3. The short version (what's a true ceiling vs a to-do)

**Hard ceilings to design around:**
1. **iOS has no *browser* Web-BT** → for the zero-install web path, iOS = screens/MC and Android = the
   BLE nodes. **Not a true ceiling:** a native/hybrid iOS app (CoreBluetooth) makes iOS fully
   first-class — and that's **still Tier 0** (software on phones you already own; only optional cost is a
   $99/yr Apple account **only if** you want smooth TestFlight sharing — the truly-free iOS route is
   AltStore/SideStore sideload with a ~7-day re-sign; Android is a free APK sideload).
2. **7 concurrent BLE connections per phone** → one phone hosts ~4–6 guns; scale with per-player nodes.
3. **Phones have no IR** → shoot-the-point needs an IR station or the grenade; phones do touch/proximity.
4. **LoRa is low-bandwidth + no field WiFi** → live field-wide state needs T4 broadcast; else
   store-and-forward.
5. **SCREAMERS** → plan for reboots and topped batteries in long hosted games.

**Resolved this session (exp-log #33–40):** G-2 health writes (additive-clamped, no native regen), G-1
grenade (mode map + Hill/Respawn beacon decode = G6), G8 (`$GREN` can't config objective modes), G7
(grenade USB-C power-only), P2 (per-player id over BLE → FFA scoring + Syphon exact-killer, §7p/§7q).
**Still pending (hardware tests that unlock things):** P16 (shield activation), P10 (damage-weighted scoring), P9 (native small teams),
G9 (CTF team-assign), G10 (thrown-blast `$GREN`). All tracked in `FOLLOWUPS.md`.

**Net:** with **Tony's kit** (4 BRX + 2 grenades + Pixel 4/OnePlus + 2 iPhone X + iPad Air), the modes
that run **today at T0/T1** are TDM/FFA, the health/shield variants, small-scale Extraction, single-point
grenade KotH/CTF, and grenade-site Counter-Strike — with the iPhones/iPad as screens and the two Android
phones as the BLE nodes. The multi-point objective modes and field-wide live play are the ones that
genuinely need **T3 stations** and **T4 radio**.
