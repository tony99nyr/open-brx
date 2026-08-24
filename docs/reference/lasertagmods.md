# LaserTagMods (JEDGE / JBOX) — technical reference

Facts distilled from LaserTagMods' public GitHub (github.com/LaserTagMods, 13 repos) for our
own use. **Their repos carry NO license (all rights reserved).** Per repo policy we restate
**facts** — protocol tokens, UUIDs, timings, pinouts, feature behaviour (not copyrightable) —
in our own words and **never copy their code, READMEs, schematics, or binaries.** Credit
LaserTagMods (JEDGE/JBOX) prominently; this project is a fresh, independent implementation.

## Repo map (what exists, ranked by value to us)

| Repo | What it is | Value |
|---|---|---|
| **JEDGE** | ESP32 "tagger-rider" firmware: BLE-bridges each BRX for phone-free, host-coordinated multiplayer (scoring, respawn, team/perk/weapon assignment) over ESPNOW/LoRa. Serves a WiFi AP + web UI. | ⭐ de-facto BRX BLE-command dictionary |
| **JBOX** | ESP32 game-accessory box/base: domination, respawn, CTF, medic, sentry, supply/upgrade stations. IR + ESPNOW + LoRa. Full README + PCB Gerbers/PDF schematics (Box V5 / Disk / Mini). | ⭐ station/objective reference |
| **autoupdate** | OTA firmware store + version manifest — reveals the product lineup/versions. | versioning pattern |
| **ESPNOW-STUFF** | "BRX Host transceiver" (ESPNOW/LoRa gateway) + "SWAPTX Headset Control" sketches. | headset/gateway |
| **ESP32-Recoil-Project** | Same idea for **Recoil** taggers (different GATT). | cross-brand contrast only |
| **NRFL-Bases** | Referee-free 3-team domination over nRF24L01 (coordinator + ≤6 nodes). Schematic + PDFs. | nRF mesh |
| **LoRa-Controlled-Taggers** | Early JEDGE base + OTA/LoRa configurator. | precursor |
| **Infrared** | Standalone IR base sketches: respawn, sentry, frag, button-activated, repeating emitter. | minimal IR stations |
| **BLE-Domination-Point-with-Blynk** | Minimal BRX domination base (ESP32 + 1 IR RX on GPIO16, Blynk UI). | minimal example |
| **IR-Remote…Blynk…ESP8266** | Clearest statement of the raw IR bit encoding. | IR timing |
| **LoRa-Blynk-BRX-Smart-Bases** | Concept README (RYLR896 LoRa smart bases + Blynk). | concept |
| **BRX-How-To-s-and-Manuals** | QUERY/SETUP/PIN pairing procedure over serial. | pairing |
| **websocket-server** | Generic example, not BRX. | ignore |

## Protocol facts (corroborate + extend our `brx-protocol.md`)

- **BLE = Nordic UART** exactly as we have it: service `6E400001-…`, RX(write) `…0002`, TX(notify)
  `…0003`. Writes chunked to **20-byte** packets (matches our MTU-3 fix). Frames `$…,*`
  comma-delimited; receiver reassembles notification fragments until `*` then splits on commas.
- **Baud:** 57600 for **Gen1**, 115200 for **Gen2/3** (auto-selected). Confirms our transport table.
- **QUERY / SETUP / PIN:** `QUERY` dumps device settings over the USB serial console; `SETUP`
  changes device ID and sets a **PIN that binds a headset to a gun** — change one PIN digit and
  the pair breaks; re-matching re-pairs. (Corroborates our Teensy/QUERY findings.)
- **New `$`-commands / details beyond our doc:**
  - `$DD,killerPlayerID,killerTeamID,deadPlayerID,nonce,*` — death/kill confirmation (nonce
    de-dupes). This is the host-side kill event.
  - `$AS,…` — token 1 selects sub-mode (2=perk, 3=team, 4=apply, 5=weapon select), token 2 =
    game mode, token 3 = rules, **token 8 = "applicator"**: `99` = apply to all, `0` = local only.
  - Lifecycle/among-device: `$RV` revive, `$KK` kill-credit, `$RP,gunID,livesRemaining` respawn,
    `$PT` register-with-host, `$UR` unregister, `$TA,playerID,teamID` team assign, `$PKC`/`$HKC`
    player/headset kill-count acks, `$RADSK`, `$PH`.
  - **Player IDs numbered from 1901 up** (Player 1 = 1901). (Note: Callsign uses team ids; this
    1901 scheme is JEDGE's host-side convention.)
- **`$SIR` IR-effect codes** (matches our §5): 1=standard(shield→armor→HP), 10=+HP, 11=+shields,
  13=+armor, 36=force/sniper passthrough, 37=bolt/burst/AMR, 38=charge, 24=energy launcher,
  28=tear gas, plus rail/rocket/energy-blade/rifle-bash/war-hammer. **~14 distinct IR recognitions.**
- **`$BMAP` buttons:** 0=trigger, 1=alt-fire (`99`=wildcard), 2=reload(`97`=reload action),
  3=select, 4=left, 5=right, 8=gyro/motion. (Matches our hardware-verified map.)

## Raw IR tag encoding (for our own IR stations / effect nodes)

- **25-bit protocol, 38 kHz carrier.** Bit encoding: **logic-1 ≈ 1000 µs mark, logic-0 ≈ 500 µs**,
  ~500 µs inter-bit spacing. Software carrier ≈ 13 µs half-period. Start bit detected when a mark
  measures > ~1500 µs. This is what an objective-station / effect node must emit to "tag" a BRX.
- JBOX emits/decodes **three ecosystems** — BRX, **Evolver**, and **LTTO** (Lazer Tag Team Ops) —
  selectable per mode. Useful if we ever want cross-brand play.

## JBOX station behaviours (= the "boxes", our objective-station node)

The functional catalogue worth reproducing in our `firmware/objective-station/`:
- **Domination** — basic (per-player + per-team scoring over BLE), with score limits, and
  tug-of-war variants.
- **Capture the Flag** — via a LoRa base-pair or JEDGE flag-carrier.
- **Continuous IR emitter** — respawn point / mine / proximity damage.
- **Tag-activated IR emitter** — headset-activated respawn / medkit / armed drone, with cooldown
  and an activation-count limit.
- **Capturable continuous emitter** — sentry / heal / respawn that another team can overtake after
  N hits.
- Plus timed (5/10-min) modes, shots-accumulator, per-colour respawns, own-the-zone, medic /
  battle-royale checkpoint, and an upgrade/stat-boost station.

**Battle Company's own equivalent is QR codes** (see `protocol/callsign-extract/apk-harvest.md`);
JBOX does it with a physical IR box. Our platform can support both.

## Radios / transports (design the transport layer pluggable)

- **BLE** ESP32↔BRX (NUS, above).
- **ESPNOW** peer-to-peer WiFi for base↔base / tagger↔tagger relay (broadcast `FF:FF:FF:FF:FF:FF`;
  per-player MAC set via `esp_wifi_set_mac`).
- **LoRa via RYLR896** on a hardware UART @115200, `AT+` commands, incoming frames prefixed `+RCV`.
  UI ranges: LoRa Fast/Mid/Long + "ESPNOW LR".
- **nRF24L01** for the NRFL-Bases domination mesh. **This is likely the `NRFhost 1`/`NRFslave 1`
  our `QUERY` reported** — the BRX may already carry an nRF radio, which is the field-range lead
  in followup D.

## Firmware / product lineup (from the `autoupdate` manifest)

JEDGE tagger v5.1, JBOX v3 v6.0 + JBOX Mini, JTOWER v5.3, bossapp v1.1, a controller fw v5.0,
and swaptxhost v2. It's a live OTA server with `*version.txt` manifests — a good versioning
pattern to mirror if we ship firmware, and the canonical "what versions are current" source.

## JEDGE hardware mount (community-proven, no permanent BRX mod)

A USB power bank + ESP32 rides the tagger, held by the phone bracket; power bank has its own
on/off (tap on, hold 2 s off), a 5000 mAh pack runs JEDGE ~15 h (≈2 BRX battery cycles). No
permanent modification, no drain on the BRX battery. **This validates our BRX Companion approach**
(`hardware/brx-companion-spec.md`) — self-powered rider, no gun mod.

## What to study first

JEDGE `TAGGER_FIRMWARE` + `HOST_DEVICE` and JBOX `JBOX.ino` are together a reverse-engineered BRX
command dictionary + IR effect map. Re-document the *facts* into our protocol/hardware refs;
validate field-by-field against a live `QUERY` dump. Reproduce pin tables from our own
measurements, not their board files.
