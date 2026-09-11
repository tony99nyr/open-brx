# Bench hardware inventory

The live list of what the bench owns, what is on order, and what is still only planned. Purchases are
recorded here the day they are made, so a buying decision never lives only in chat. The August 2026
shopping list this grew from is archived at `docs/archive/hardware/bench-shopping-list.md` (grep it, do
not read it). Gun sticker labels stay out of the repo; the device registry in `~/.brx-mcp/` holds them.

**Updated: 2026-09-11.**

## On hand

| item | qty | role | since |
|---|---|---|---|
| BRX taggers (Tactix2 v4.32) + headsets | 4 | the fleet under test | before 2026-08 |
| BRX grenade | 1 | the stock objective (hill / respawn / bomb words), see `docs/reference/grenade.md` | before 2026-08 |
| ESP32-S3-DevKitC-1 (WROOM-1-N16R8), two USB-C ports | 2 | the IR bridge: one RX, one TX (`esp32-ir-bridge/`) | 2026-08-26 |
| CHANZON 940 nm IR kit: 10 emitters (45°), 5 bare photodiodes, 5 VS1838B | 1 kit | receiver + bare-LED emitter for the bridge. Only the 3-leg VS1838B demodulates | 2026-08-26 |
| ELEGOO Electronic Fun Kit (235 pc) | 1 kit | breadboard, jumpers, resistors, 2N2222, caps, status LEDs | 2026-08-26 |
| Aideepen nRF24L01+PA+LNA + HW-200 adapter | 3 + 3 | exploratory gun-mesh tap; off the critical path | 2026-08-26 |
| USB-C cables, 5 V USB charger | several | power + serial for every board | before 2026-08 |

## On order

| item | qty | vendor | cost | ordered | purpose |
|---|---|---|---|---|---|
| M5StickS3 ESP32-S3 Mini IoT Dev Kit (M5Stack K150) | 2 | M5Stack | $21.50 each + ~$10 shipping incl. tariff | 2026-09-11 | the hardware Station node (`brx-station-spec.md` S1 tier in a case): IR RX G42, IR TX G46, 1.14" LCD, speaker, 250 mAh, BLE 5. One is the hill or powerup, one the witness receiver |
| Seeed Grove Infrared Emitter (101020026), 940 nm, ±17°, driver on board | 3 | Mouser | $12.90 + $8.49 shipping + $2.84 tariff = $24.23 | 2026-09-11 | the stronger beacon for the Stick (the bare CHANZON LED cliffs at 8 to 10 ft). Two in use, one spare |

Seeed direct wanted $26.11 DHL on $8.60 of parts. Mouser (used here) and Amazon (the Seeed listing and the
M5Stack official store, checked 2026-09-11) carry both with domestic shipping. Buy there.

## Planned, not ordered

| item | why | note |
|---|---|---|
| Seeed Grove RGB LED Ring, 16× WS2813 Mini | owner colour visible across a field; the Stick's LCD is not | both Seeed modules signal on Grove pin 1 (G9), so the ring takes the Grove port and the emitter moves to the HAT header via a Grove-to-Dupont cable |
| Grove to 4-pin female Dupont conversion cable, 5-pack (Seeed 110990028) | puts the second Grove module on the HAT header (5 V, GND, one GPIO) | only needed once the ring is added |
| USB-C power bank, 5,000 to 10,000 mAh | the Stick's 250 mAh is about two hours | pick one that does not auto-off at low draw |

## Stick facts that shape the build

- IR receive on **G42 is RMT-only** (no GPIO-interrupt decode), and the **speaker amplifier must be off** while receiving.
- Grove port = 5 V (0.38 A max), GND, G9, G10. HAT header exposes GPIO 1 to 8, 10, 43, 44 plus EXT_5V.
- The 16-pixel ring at full single-colour brightness is an estimated 320 mA (16 × 20 mA per channel, not measured), most of the Grove budget: cap brightness near 50 percent or feed the ring from the power bank.
- The Atom Matrix ($14.95, 5×5 matrix, IR TX only, no receiver, no battery) was considered and rejected for the first unit; it remains the cheaper fixed-hill option once a receiver unit is added.

## First bench gate (when the Sticks arrive)

1. Flash `m5sticks3/`, speaker off, hold the Stick in the grenade's cone at 6 ft: a `proto=15 mag=8` decode on serial.
2. Watch a HUD phone pick up the Stick's kind-5 control-point advert with the beacon's owner.
3. Range walk the Grove emitter against a stock gun, against the bare-LED cliff of 8 to 10 ft.
