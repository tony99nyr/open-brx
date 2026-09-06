# BRX IR prototype — capture, emit, and characterize every IR sound + function

**Goal:** understand the BRX IR link *in practice*, end to end — (1) **capture** the exact 25-bit IR
frames a stock gun emits (this is the gating task **B13** for the Utility Box), (2) **emit** a frame and
confirm a stock gun registers it, and (3) **sweep every sound + function** a gun can be made to do from
incoming IR (the full `$SIR` effect space). Total parts: **~$15–20 from Amazon** (less if you have a
breadboard kit). This is the prototype behind `brx-station-spec.md`.

## The key idea: one ESP32 does both directions

The **ESP32 RMT peripheral** is purpose-built for IR — it timestamps incoming pulse trains (RX) and
generates carrier-modulated pulse trains (TX). So a single ESP32 + a receiver + an LED both **reads** BRX
IR (to decode the format) and **emits** it (to trigger guns). No logic analyzer needed. Arduino-ESP32's
`IRremoteESP8266` / `IRrecv`/`IRsend` or the raw `rmt` driver both work.

## Bill of materials (Amazon)

| Part | ~$ | Notes |
|---|---|---|
| **ESP32 dev board** (ESP32-WROOM DevKitC or clone) | $5–8 | the brain; RMT on any GPIO |
| **IR receiver module** — VS1838B / TSOP38238 (38 kHz) | ~$1–2 (multipack) | demodulates the 38 kHz carrier → clean logic pulses on one pin. Broadband photodiode — responds fine to BRX's 980 nm. |
| **IR LED** — 940 nm 5 mm (multipack) | ~$1 | emitter. **Note:** BRX is 980 nm, but the gun's receiver is a 38 kHz TSOP-type (wideband) — a **940 nm LED modulated at 38 kHz with the right bit timing should still trigger it** (detection is carrier+timing, not exact wavelength). Grab a few **980 nm** LEDs too if available, for best range. |
| **NPN transistor** (2N2222 / BC547) + **~10–100 Ω** resistor | pennies | drive the IR LED harder than a GPIO can alone (a bare GPIO ~works at short range, but a transistor gives real range). |
| **Breadboard + jumpers** | ~$8 kit | probably already have. |

*(Optional later: a WS2812 LED for owner-colour, a buzzer, a LiPo — for the actual box. Not needed to
characterize IR.)*

## Wiring (minimal)

- **RX:** VS1838B `OUT` → an ESP32 GPIO (e.g. GPIO 15); `VCC`→3V3, `GND`→GND. (Add a 0.1 µF across
  VCC/GND if noisy.)
- **TX:** ESP32 GPIO (e.g. GPIO 4) → resistor → transistor base; IR LED between 3V3 and the transistor
  collector (LED anode→3V3 through a current-limit R, cathode→collector), emitter→GND. Point the LED at
  the target gun's headset/receiver.

## Phase 0 — start TODAY, no new hardware (2 guns + `$SIR`)

Before any parts arrive, you can characterize a big chunk of the **function/sound space** with **two
stock guns + our BLE config**, because the gun's reaction to a hit is set by its **`$SIR` table** (which
we push over BLE), not baked in:

- Config gun **A** (the "emitter") with a weapon whose IR **type/subtype** you choose (`$WEAP` sets the
  weapon; its IR protocol id = the `$SIR` first field).
- Config gun **B** (the "receiver") with a **`$SIR,<type>,<subtype>,<soundID>,<function>,…`** entry that
  maps that incoming type → any sound + any effect.
- Shoot B with A → observe: **what sound plays, what happens to B's HP/armor/shield** (read the `$HP`/
  `$LCD` stream). Sweep the `<function>` codes and `<soundID>` values.
- This maps the **effect/sound space** using gear you own — the M1-style test — *before* the custom
  emitter exists. (The custom box just reproduces gun A's IR on demand.)

## Phase A — CAPTURE (the gating task, B13)

ESP32 + VS1838B. Log every incoming IR frame as raw pulse timings, then decode to the **25-bit word**.

1. Point a stock gun at the receiver; fire. The RMT RX gives a list of mark/space durations.
2. Match against the known encoding (`reference/lasertagmods.md`): **logic-1 ≈ 1000 µs, logic-0 ≈ 500 µs**
   marks, ~500 µs spacing, 38 kHz carrier, start bit. Decode to 25 bits.
3. **Sweep every emitter:** fire each **weapon type** (`$WEAP` different guns), each **team** (`$TID`),
   and — crucially — the **grenade** in each mode (Hill/Respawn beacon, Assault/CTF capture). Log the
   25-bit word for each.
4. **Diff the words** → identify which bits are **type**, **team**, **mode/subtype**, **damage** (~7–8
   bits, P10). That completes the **bit-layout map** — the one gap for the Utility Box emit side.

**Deliverable:** a table `IR event → 25-bit pattern → decoded fields`. This *is* B13.

## Phase B — EMIT (prove we can trigger a stock gun)

ESP32 + IR LED. Replay a captured frame and confirm a stock gun reacts.

1. Take a captured "standard hit" word; RMT-transmit it (38 kHz carrier, 1000/500 µs marks) at the gun's
   headset.
2. Config the target gun (BLE) with a `$SIR` that maps that type → e.g. damage + a sound.
3. Fire the ESP32 → the gun should register the hit (HP drops, sound plays). **If it does, we can emit
   BRX IR.** Tune LED drive/range.
4. Then emit **objective** tags: a respawn tag, an add-armor tag, a capture/beacon — confirm each does
   what the `$SIR` mapping says.

## Phase A½ — RANGE (measure the numbers)

Full walk-back protocol + data tables: **`hardware/range-experiment.md`**. Uses the Phase-A receiver rig;
`python -m brx_mcp ir-range <port> <secs> <shots>` turns each tape distance into a detect%/decode% reading.
Measures the stock gun/grenade range (confirm the grenade's ~18–20 ft), the indoor/outdoor + weapon +
angle effects, and — with the Phase-B emitter — our own box's reach. Feeds the objective-node coverage spec.

## Phase C — full sound + function sweep (the "every sound and function" test)

Systematically catalog what the box can make a gun do from IR:

- **Function codes** (`$SIR` `<function>` field): sweep the known + unknown codes and record the effect.
  Known so far (`protocol/brx-protocol.md` §5): `1`=standard damage (shield→armor→HP), `10`=respawn+HP,
  `11`=add shields, `13`=add armor, `24`,`36`,`37`,`38`=various; APK `DamageType`/`AbilityType` enum adds
  Standard, **MedicHeal, ActivateShield, RallyPulse, Radiation, ArmorPiercing, Shrapnel, StickyBomb**, …
  → **map every code → effect** (heal? damage? stun? shield? ammo? nothing?).
- **Sounds** (`$SIR` `<soundID>`): confirm an IR event can trigger **any** of the 2166 bank ids
  (`callsign-extract/sound-bank.md`) — try a spread (weapon, respawn, capture, voice lines) and note any
  that don't play or are volume/priority-gated.
- **Cross-terms:** does `subtype` change the effect? Do `crit`/`modifier`/`indoorMode` (`$GREN`/`$WEAP`
  fields) alter the IR? Record the matrix.

**Deliverable:** a complete **IR effect catalog** — every (type, subtype, function, sound) the box can
emit and exactly what the gun does. That's the API for every objective mode.

## Notes / gotchas

- **980 vs 940 nm:** RX is fine (wideband). For TX, 940 nm *should* trigger (carrier+timing matter); if
  range is poor, switch to 980 nm LEDs. Test empirically in Phase B.
- **Sounds need our config:** a gun only plays IR-triggered sounds while running our `$SIR` (loaded at
  game start). Bare guns just report a raw `$HIR`. So run the sweep inside a configured game.
- **Timing precision:** the RMT peripheral handles µs timing; keep the carrier at ~38 kHz and marks at
  ~1000/500 µs. Small drift is usually tolerated by the TSOP.
- **Credit:** encoding facts from **LaserTagMods**; this reproduces/extends their open BRX-IR work.

## What this unblocks

Phase A alone completes **B13** (the Utility Box's only gating unknown) and gives the full **IR event ↔
bit pattern** map. Phase C gives the **full effect/sound catalog** — the complete vocabulary the
open Utility Box speaks. After that, the box is "wrap the ESP32 + IR + LED + radio in firmware," all
standard work (`brx-station-spec.md`).
