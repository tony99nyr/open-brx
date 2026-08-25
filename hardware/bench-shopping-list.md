# Bench shopping list / BOM

Persistent record of hardware for the Open BRX bench work — so a purchasing decision never lives only
in chat again. Grounded in our own notes: the nRF24L01 mesh (`docs/reference/lasertagmods.md` — NRFL-Bases
= nRF24L01 coordinator + ≤6 nodes; the BRX's `NRFhost 1`/`NRFslave 1`), the ESP32↔BRX electrical gotchas
(`docs/reference/community-notes.md`), and the IR stack (`hardware/ir-prototype-plan.md`, `range-experiment.md`).

**Status legend:** ✅ have / arriving · ⬜ recommended, not yet ordered.

## ✅ Confirmed order — arriving 2026-08-26 (placed Aug 24, $16.40)

This box is the **IR bench**, not the nRF tap — no nRF radio in it.
- **ELEGOO Electronic Fun Kit** (235 pc) — breadboard, jumpers, resistors, transistors (2N2222),
  caps (incl. the 10µF/0.1µF we need), LEDs (use red for TX status, green for RX status).
- **CHANZON 940nm IR kit** — 10× 940nm emitters (45°), 5× 940nm receivers (30°), 5× **VS1838B/HX1838**
  38kHz demod receivers (70°). Emitter 1.2–1.5V; VS1838B 3–5V. → drives `ir_capture.ino`/`ir_emit.ino`.
- **ESP32-S3-DevKitC-1, 2-pack** (WROOM-1-N16R8) — run one as IR-RX, one as IR-TX (each with a status
  LED). Also the future Companion brains **and** the SPI driver for an nRF24 module *if* we add one.

→ Enables: **B13 IR bit-layout capture**, the range experiment, IR Utility-Box (B4) prototyping.
→ Does **NOT** enable: the nRF24 mesh tap (needs a module, below) or BLE sniffing (needs nRF52840).

## 🛒 nRF24 mesh kit — CHOSEN 2026-08-25 (Aideepen 3-pack, ~$15, overnight → arrives 2026-08-26)

**Aideepen 3× nRF24L01+PA+LNA (SMA antenna, ~1100m) + 3× breakout adapter (AMS1117-3.3).** Picked over a
bare 3-pack (no adapters) and a UMLIFE 5+5 (not overnight) because it **bundles the adapters** *and* ships
overnight, so the nRF track starts alongside the IR kit. 3 modules = a coordinator + 2 nodes / a TX-RX pair
+ spare — enough to prove the tap and build the first Companion. Buy the 5-pack later for a full mesh.
- **Power:** feed the *adapter* board **5V** (ESP32-S3 5V/VIN pin) → it regulates 3.3V to the module. Never
  put 5V on the module directly.
- **SPI pins (ESP32-S3, avoid GPIO 26–37):** SCK=12, MISO=13, MOSI=11, CSN=10, CE=9, IRQ=14 — finalise at build.
- Reference design (wiring + RF params) in `NRFL-Bases` (see `protocol/brx-ir-protocol.md` bottom).

---

## Route 2 — nRF24 mesh tap (the priority; the Companion / D1 per-player attribution path)

Goal: join the guns' gun-to-gun **nRF24L01** game mesh to *observe* kill-confirms (→ per-player
attribution, native-game visibility) and later drive native feedback. This is the track tomorrow's parts
should serve.

| Item | Why | Notes / gotchas | Status |
|---|---|---|---|
| **nRF24L01+ PA/LNA** module (w/ external antenna) | The mesh radio the guns use; PA/LNA = arena range | Get 2–3 (need ≥2 to test a link). **The one thing still to buy.** ~$7–10 multipack | ⬜ **order** |
| **nRF24L01 breakout/adapter board** w/ onboard **3.3V reg + decoupling cap** | nRF24 browns out on TX from a bare 3.3V pin | The #1 nRF24 failure mode. Or substitute a **10µF cap** across the module's VCC/GND (ELEGOO kit ✅) | ⬜ opt |
| **ESP32-S3** dev board | Drives the nRF24 over SPI; the Companion brain (JEDGE uses ESP32) | 3.3V logic — matches nRF24 | ✅ 2-pack arriving |
| **Dupont jumpers** (F-F) + **breadboard** + caps | SPI wiring + power smoothing | ELEGOO kit | ✅ arriving |

**⚠ nRF24 is not a plug-and-play sniffer.** To hear the BRX mesh you must match its **RF channel,
pipe address, data-rate, CRC** — all unknown. Shortcut: read **LaserTagMods' NRFL-Bases source** (their
bases join that mesh) to extract the params, then the ESP32-S3 + nRF24 joins directly. Code-read task,
doable before the module arrives.
**SPI pins (ESP32-S3, avoid GPIO 26–37):** e.g. SCK=12, MISO=13, MOSI=11, CSN=10, CE=9, IRQ=14 — finalise at build.

**Electrical reminders (community-notes):** BRX *serial* mod wants **3.0–3.4V logic (~3.06V), 5V corrupts,
diode on ESP32 pin17→board RX, <300mA draw** — that's for the UART rider, **not** the nRF24 SPI (which is
plain 3.3V SPI). Don't cross the two up.

---

## Route 1 — BLE capture (the Callsign/nRF-enable question; mostly no hardware)

Goal: capture what Callsign sends over BLE (see `docs/handoff-callsign-nrf-capture.md`).

| Item | Why | Notes | Status |
|---|---|---|---|
| *(nothing required)* | iOS **PacketLogger** captures the iPhone's BLE natively | Primary method — free, Mac + iPhone only | ✅ |
| **nRF52840 USB dongle** (Nordic) | Over-the-air BLE sniffer (nRF Sniffer for BLE + Wireshark); general BLE dev | **Fallback only.** ⚠️ This is a *BLE* radio — it can **NOT** do the Route-2 nRF24 mesh tap | ⬜ |

> ⚠️ **nRF52840 ≠ nRF24L01.** The dongle sniffs BLE; the module joins the game mesh. If tomorrow's box
> has one but not the other, we can only do that one route. This is the key thing to confirm.

---

## IR bench (B13 capture / B4 Utility Box / range experiment)

| Item | Why | Notes | Status |
|---|---|---|---|
| **TSOP38238** (38kHz IR receiver) | Capture the BRX IR **bit-layout** (B13, gates the Utility Box emit side) + station RX | 940/980nm, 38kHz — matches BRX optical | ⬜ |
| **IR LED 940nm** + NPN driver (2N2222) + resistors | Emit side (objective/effect tags) — later | After B13 decode | ⬜ |
| **Cheap 8-ch logic analyzer** (~$10) | Decode IR mark/space timing **and** nRF24 SPI | Sigrok/PulseView | ⬜ |

---

## Power (no bench PSU / batteries needed)

- **Each ESP32-S3 ← USB-C cable ← Mac** (or any 5V USB charger/power bank). Powers the board + carries serial.
- **nRF24 PA/LNA ← its adapter board ← ESP32-S3 `5V`/`VIN` pin.** The adapter's AMS1117 makes clean 3.3V and
  its cap absorbs TX spikes. **Never 5V directly on the module.**
- IR parts (VS1838B / IR-LED-via-2N2222) run off the ESP32 3V3/5V pins — negligible.
- Shared **GND** on the breadboard. Optional headroom: a **5V/2A+ USB charger or powered hub** so a hard-TX
  PA/LNA on both boards never browns out (a laptop port at 500–900 mA is fine for one board + one PA/LNA).

## General bench (likely already have)

| Item | Status |
|---|---|
| Teensy USB console cable (the `QUERY`/`SETUP` port — worked on COM5) | ✅ |
| **USB-C cables** (one per ESP32-S3) + a **5V/2A USB charger or power bank** | ✅ likely |
| multimeter | ✅ |
| The 4 taggers + headsets (R0BAT/R0BAS/R0BP1/R0BQT) | ✅ |

---

## Open decision this list serves

`docs/handoff-callsign-nrf-capture.md` decides **Route 1 vs Route 2**:
- If Callsign enables nRF peering **over BLE** → Route 1 wins, most nRF24 hardware becomes optional.
- If not → **Route 2 (nRF24 mesh tap) is the path**, and the parts above are the build.

Either way the nRF24 kit also builds the **B1 Companion** (`hardware/brx-companion-spec.md`), so it's not
wasted. Update this file whenever parts are ordered/arrive.
