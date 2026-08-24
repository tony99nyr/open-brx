# IR range experiment — measure the numbers

**Goal:** replace guesses with measured range. Answer, in feet: how far a **stock gun
shot** reaches, how far the **grenade beacons** reach (confirm the ~18–20 ft respawn
figure from `docs/reference/grenade.md`), how **indoor/outdoor mode + weapon + angle**
change it, and what range **our Utility-Box emitter** can achieve. Those numbers set the
objective-node coverage spec (FOLLOWUPS **B4**) and the weapon range tuning.

Runs on the `hardware/esp32-ir-bridge/` rig (VS1838B receiver, `ir_capture.ino`). **Needs
the ESP32 on the bench** (~Aug 26) + one tagger and/or the grenade. Software is ready now:
`python -m brx_mcp ir-range` turns each walk-back station into a hit-rate reading.

---

## Two directions (measure both)

1. **Incoming — gun/grenade → our receiver.** How far *their* IR reaches. Needs only the
   VS1838B rig. **Doable the moment the ESP32 arrives** (no B13 dependency).
2. **Outgoing — our LED → a stock tagger.** How far *our box* reaches. Two ways:
   - **Payload path** (real): a stock gun registers a `$HIR` from our emit — needs the IR
     bit-layout solved first (**B13**). Measure by the gun's BLE `$HIR`.
   - **Optical path** (now): a *second* VS1838B detects our carrier at distance — measures
     raw optical reach before B13, upper-bounds the payload range.

## The metric — why two rates

`ir-range` reports both, because range has two edges:
- **detect_rate** = detections / shots fired → *coverage*: did the burst arrive at all.
- **decode_rate** = clean 25-bit frames / detections → *quality*: did it arrive intact.

As you walk back, `decode_rate` degrades first (marginal, bursts arrive but garble), then
`detect_rate` falls to 0 (out of range). Define:
- **Effective range** = farthest distance with **decode_rate ≥ 0.8** (reliable tag).
- **Max detection range** = farthest distance with **any** detection (the fuzzy edge).

## Rig

- VS1838B: `+`→3.3V, `–`→GND, `OUT`→GPIO4 (per `hardware/esp32-ir-bridge/README.md`).
- Mount the receiver at ~chest height on a box/tripod, **aimed at the shooter** (on-axis).
- A tape measure or pre-marked floor. Mark stations: **3, 6, 9, 12, 15, 20, 25, 30, 40, 50 ft**.
- Shooter holds the gun at the receiver's height, aimed at the sensor.

## Procedure — the walk-back

At **each** distance station:
1. Fire **10 shots**, steady, one every ~1 s, during the capture window.
2. Run: `python -m brx_mcp ir-range <port> 12 10`  (12 s window, 10 expected shots).
3. Record `detected / decoded / detect% / decode%` in the table.
4. Stop walking back once `detected` hits 0 for two stations in a row.

Repeat the whole sweep for each **variable** below (change one at a time).

## Variables to sweep

| Variable | How to set | Why it matters |
|---|---|---|
| **Indoor vs outdoor mode** | `play … outdoor=1` / `outdoor=0` on the shooting gun (`$GSET` token 2), or the gun's own setting | Outdoor mode boosts IR power → longer range. The single biggest lever. |
| **Weapon** | `play … primary=<weap>` — AR vs sniper vs shotgun | Different `iRPower` / `gunRange` per weapon (protocol-classes.md). |
| **Angle (beam width)** | Fix distance (e.g. 15 ft); re-read at **0° / 15° / 30° / 45°** off-axis | Beam width = how wide a zone a node covers vs a narrow lane. |
| **Grenade beacon** | Respawn (yellow) then Hill (blue); walk back | Confirm ~18–20 ft respawn; map hill radius. Omnidirectional, so also test **off to the side**, not just on-axis. |

## Our emitter (outgoing) — extra variables

Once measuring direction 2, sweep our side:
- **Drive current** — series resistor value / LED count (stay within the LED's rated
  current; the 940 nm kit LEDs are ~100 mA continuous — **do not exceed**).
- **Optics** — bare LED (wide, short) vs a lens/collimator (narrow, long). This is the
  omnidirectional-zone vs directional-beam tradeoff.
- **Wavelength** — our 940 nm vs the gun's ~980 nm; note any efficiency loss.

## Safety

- **IR is invisible** — you can't see when a high-power emitter is on. The status LED
  (GPIO6) on the bridge lights on TX so you know. Don't stare into a driven IR LED at
  close range; don't assume "off" because it looks dark.
- **Never exceed the LED's rated current.** Use the series resistor from the kit; more
  current ≠ free range, it's a dead LED.
- BRX-serial cautions still apply if a tagger is cabled (5 ms/char, ~3.06 V logic, diode on
  pin 17 — `community-notes.md`). Not relevant to the receive-only rig.

---

## Data table (copy per variable sweep)

Sweep: `____________`  (e.g. "AR, indoor, on-axis")   Date: `______`

| Distance (ft) | detected / 10 | decoded | detect % | decode % | notes |
|---|---|---|---|---|---|
| 3  | | | | | |
| 6  | | | | | |
| 9  | | | | | |
| 12 | | | | | |
| 15 | | | | | |
| 20 | | | | | |
| 25 | | | | | |
| 30 | | | | | |
| 40 | | | | | |
| 50 | | | | | |

**Effective range (decode ≥80%):** `____ ft`   **Max detection:** `____ ft`

Log the summary rows to `docs/experiment-log.md` (append after the session) and fold the
final numbers into `hardware/brx-station-spec.md` (node coverage) + the weapon range notes.
