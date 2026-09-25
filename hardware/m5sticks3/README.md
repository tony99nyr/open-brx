# M5StickS3 station node

The first hardware Station (the ESP32 objective box of `../brx-station-spec.md`) in a case you can
buy: an M5StickS3 ($21.50, ESP32-S3, IR both ways, 1.14" screen, speaker, 250 mAh) running one
sketch. This is the ONE place to work with it: build, flash, bench, and how the firmware works.

IR protocol credit: **LaserTagMods** (JEDGE/JBOX) decoded the BRX tag; `protocol/brx-ir-protocol.md`
is our bench-verified copy.

## What it is

A kind-5 control-point station (`docs/spec/utility.md` §5d). It runs one of two modes:

- **BRIDGE** (default): the Stick sits beside a stock grenade and repeats what the grenade's own
  beacon says. It decides nothing; the grenade is the authority.
- **HILL**: the Stick is the hill. It takes shots on its own receiver and decides ownership itself.

Either way it advertises the owner over BLE, in the same kind-5 packet every HUD phone already
decodes, and emits BRX IR words on its own LED or a Grove emitter.

How it fits the game:

- Phones accept the Stick's IR words only when the game's `station_source` is `grenade`. The Stick
  behaves like a grenade on the wire in both modes. Whether a Stick should get its own
  `station_source` value, instead of borrowing `grenade`'s, is the open **H8** decision
  (`docs/spec/utility.md` §5g.7).
- Arming the Stick from Mission Control over Wi-Fi is **built, desk-verified, never flashed** (H8;
  see "Mission Control link (H8)" below): it takes a `hello`/`welcome`/`station_config` like any
  utility phone, self-spawns a powerup on its own local clock, and scans for a player's CLAIM.

## Bluetooth stations (MVP)

Tony's decision (2026-09-24): an MC-armed Stick station is **Bluetooth-only** for the MVP. It reads
the players' own adverts (role 2: id = player number, team, state bit 0 = alive) with one passive BLE
scan, 1 s windows every 1.2 s, beside its own advert. The rules are ports of the phone station's code
(`presence.h`, host-tested in `test/test_presence.cpp` and cross-checked against the JS):

- **Hill** (`control`): presence capture, `app/src/control.js`. A player counts when present
  (smoothed RSSI, EMA alpha 0.35, at or above the threshold for 0.8 s; off 6 dB below it or after
  4 s with no advert) and alive, on team 0, 1 or 3 (team 2 is refused, F82). Rate = net x 100 /
  10 s per second, where net is the leading team minus the largest single other team, capped at 3.
  An enemy-held point drains to neutral before it builds. Ticked every 250 ms; the advert republishes
  a state change at once and progress at most once a second. A capture also sends the S57 IR capture
  word once, and the hill beacon still goes out every 5 s.
- **Respawn**: advertises state 1 ("ready"; phones ignore a respawn advert with state 0), and does
  nothing else for the MVP. Revive feedback is post-MVP (Tony, 2026-09-24): behind one switch,
  `REVIVE_FEEDBACK_ENABLED` in `presence.h` (off; build with `-DBRX_REVIVE_FEEDBACK=1` to turn it on),
  a respawn Stick scans for players, counts revives (a present player's alive bit going 0 to 1),
  shows the count and a green REDEPLOY flash, takes the `REDEPLOY` serial command, and reports
  `revives` in the status. Off, it runs no scan at all, which also ends the scan-vs-advert flicker
  seen at the bench. The host tests build both ways.
- **Pickup**: unchanged.

Hill and respawn presence use MC's threshold, or the Stick's own default when MC sends none (see THRESHOLD
below); the pickup claim has no RSSI floor at all (see CLAIM below). A hill's owner is saved in NVS on each change of hands (never on a
progress tick), tagged with the game and station id, so a Stick restarted from its restored config
comes back held by that owner with the possession tally saved at that change (F332). The save is
tagged with the MC session too, so a new session, a new game, another id, `release_utility` or the
operator's point RESET clears it. The hill and available pickup scans run at 50% duty (window 50 of interval 100);
bench to confirm they still hear every phone. A
respawn Stick runs no player scan at all while revive feedback is off (the default, `presence.h`).
mDNS discovery is asynchronous, so the hill never waits on it.

**Arm hill Sticks with `station_source` `phone`, or leave it absent.** A phone follows a control
advert only then (`engine.js _hillSourceAllowed`); under `grenade` it follows the IR beacon instead.
**IR receive is post-MVP (F314):** it drives only the bench HILL/BRIDGE below.

## Timed HELD hills (A68)

MC sends `duration_ms` for a timed game from LOAD onward. A HELD hill that leaves Wi-Fi before START anchors go-live on the first alive player advert with its game byte, at any RSSI, from a player it has already heard down in this game (`anchor_hill_on_advert`). Lobby phones advertise down, so arm the Stick at MC with the phones in the lobby. A phone still alive from the last match cannot anchor. Until the anchor the hill shows WAITING and counts nothing; the 60 s offline go-live is only for a config without a duration. The hill then counts to its local deadline and freezes its owner and hold tally at MATCH OVER. START timing overrides the fallback if the Stick hears it. A new game byte clears the anchor. The time left is saved in NVS (`hclk_*`, `SavedHillClock`) at the anchor, at most every 30 s, and as 0 at the whistle, so an offline restart resumes the whistle late by at most 30 s plus the time off. Untimed matches and operator or objective ends cannot reach an offline Stick. HELD is the MVP field mode and the boot default when no mode is saved; a saved `LINK MUSTER` still wins. A same-game config without START (MC in LOBBY, or an abort) stops an anchored or resumed hill and erases the saved clock.

**Flash writes per match** (a 7200 s timed hill, the worst case): the hill clock 241 (the anchor, one per 30 s, 0 at the whistle); the A58 lock snapshot about 27 (LOAD, START, one per five minutes, the clear at END); the station config about 3 (LOAD, START, END); the typed MC URL 0 (only on `MC <url>`); range edits 0 (refused while the lock is on). The total is about 271, plus one SavedHill write per owner change and one at the whistle. Each clock save puts four keys, of which only `hclk_rem` changes.

## Status

**2026-09-24, late afternoon: F314's root cause is found, and a workaround is proven.** The onboard receiver
(G42) decodes an ordinary TV remote fine but not BRX-style IR at any distance tried; an external VS1838B on a
Grove pin (`RXPIN 9`/`RXPIN 10`) decoded 3 of 3 real gun shots at 1 m. See "External IR receiver" below. F314
stays open until a standalone Stick (its own receiver power, not shared) captures a HILL by being shot.

**2026-09-24: the Mission Control link (H8) is built and desk-verified only** -- host tests plus a
clean `stick.py compile` against the real toolchain, nothing run on a Stick yet. See "Mission
Control link (H8)" below.

**2026-09-23: first bring-up on a real Stick.** Flash, boot, and serial all work. The BLE advert
and IR transmit both work. IR receive of a gun shot is open (**F314**): the receiver hears a burst
of the right length at close range, but the decode comes out distorted, so the strict decoder
rejects it and no gun shot has decoded yet. Full gate results and the rerun plan are in
`docs/bench-sticks3-2026-09-23.md`; that sheet is the source of record for gate procedures and the
running results, not this file.

**Settled at the bench (2026-09-23):** the receiver's output is active-low, idle-high, as the firmware assumes: the
rig's word arrived at 6 in with the right bit order and mark widths (about 1020 and 520 us).

**Bench to confirm:**

- Whether a gun shot decodes at some distance at all, and if so, which distance (F314).
- What a `SELFTEST` PASS means, given M5 asks for 30 cm between sender and receiver and the
  self-test runs at millimetre range.
- The source of an intermittent ~650 Hz stream of 144 us pulses seen during bring-up.
- The emitter's real range on either TX pin (Seeed's "10 m" is to a TV receiver, not a laser-tag
  receiver).
- Which Grove pin (G9 or G10) the yellow wire actually drives on this unit.

## Hardware and pins

| pin | role | note |
|---|---|---|
| G42 | IR receiver | RMT only. M5's own IR example uses this pin (docs.m5stack.com/en/arduino/m5sticks3/ir_nec) and warns the speaker amplifier must be off or reception fails. The sketch never brings the speaker up |
| G46 | onboard IR LED | default transmit pin |
| G9 / G10 | Grove port (SDA / SCL) | the yellow-wire question: M5's own StickS3 pinout page (docs.m5stack.com/en/core/StickS3) says the yellow wire is SDA = G9. An earlier firmware comment guessed the opposite (SCL = G10 on the yellow wire, from M5Unified's port mapping, not the pinout page). The firmware accepts either as a Grove emitter pin (`TXPIN 9` or `TXPIN 10`), so this is safe to leave open until the bench settles which one lights the emitter |
| G11 / G12 | buttons A / B | bench mode (no Wi-Fi set): hold A 1 s resets the point to neutral, hold B 2 s toggles BRIDGE / HILL, an A click shows DIAGNOSTICS. Only a hold changes state, so a knock cannot flip a point. With Wi-Fi set, see "Buttons and power" |
| small side button | power, and download mode | this is the Stick's power button. Held while plugging in USB, it puts the board into download mode (needed once, on the first flash over factory firmware only) |
| HAT header | EXT_5V, GND, G1-G8, G10, G43, G44 | where a ring or an external emitter goes when the Grove port is busy |

The speaker amplifier must stay off: the sketch calls `M5.Speaker.end()` and sets `internal_spk =
false`, matching M5's own warning above. Nothing needs wiring for the first bench gates; only the
Grove pin question needs hardware in hand.

## Power

The IR receiver and the onboard IR LED both run off the M5PM1 EXT_5V rail, which M5Unified leaves
off by default (docs.m5stack.com/en/arduino/m5sticks3/m5pm1: disabling EXT_5V "turns off power to
the Grove interface, Hat EXT_5V interface, and IR TX/RX"). The firmware turns it on with
`M5.Power.setExtOutput(true, m5::ext_none)` in `setup()`. Without that call the receiver hears
nothing at all: the first bring-up saw only short random pulses until this call was added.

## Toolchain

### On this WSL/Windows box

WSL cannot see USB, so every flash and serial command runs on the Windows side. `hardware/m5sticks3/tools/stick.py`
(WSL system python3) shells out to Windows programs for you; see "The fast loop" below for day to
day use. This section is the one-time setup underneath it.

1. Install the M5Stack board core and M5Unified once, using the Arduino IDE's own bundled
   `arduino-cli.exe` so Tony's Arduino config is not rewritten:

   ```
   CLI="/mnt/c/Users/Tony/AppData/Local/Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe"
   URL=https://static-cdn.m5stack.com/resource/arduino/package_m5stack_index.json
   "$CLI" core install m5stack:esp32 --additional-urls $URL   # 3.3.9 has the m5stack_sticks3 board
   "$CLI" lib install M5Unified                                # 0.2.21 knows the StickS3 (pulls M5GFX)
   ```

2. `stick.py compile` and `stick.py flash` stage the sketch to
   `C:\Users\Tony\brx-sticks3\m5sticks3` before building, because the Windows `arduino-cli` cannot
   build from a `\\wsl.localhost` path. The FQBN is
   `m5stack:esp32:m5stack_sticks3:PartitionScheme=default_8MB,CDCOnBoot=cdc`: `default_8MB` gives a
   3 MB app partition (BLE plus M5Unified does not fit the 1.2 MB default), and `CDCOnBoot=cdc` is
   required or the upload cannot find the port.
3. The factory firmware ignores a software reset. The first flash after factory firmware needs
   download mode: hold the Stick's small side button while plugging in USB, then unplug and replug
   without the button. Later flashes do not need this.
4. The USB-C cable must carry data. A charge-only cable drops the Stick from the port list while
   its screen stays lit.
5. On Windows the port is a `COM` number; find the Stick by its vendor id `0x303a`, not by number
   (`stick.py ports` does this for you).

### On a Mac

No Mac-specific bench notes exist yet for the Stick. `docs/mac-dev-runbook.md` does not cover it.
Expect the Mac's own `arduino-cli` to see the Stick directly over `/dev/cu.usbmodem*`, with no
staging step, since macOS has native USB access; the FQBN, core, and library versions above should
still apply. Confirm this the first time a Stick is flashed from a Mac.

## The fast loop

Run everything through `hardware/m5sticks3/tools/stick.py` (WSL system python3; it never imports
`pyserial` or `bleak` itself, and shells out to Windows Python for anything that touches USB or
BLE). `stick.py ports` is the only subcommand safe to run without a Stick plugged in.

| command | does |
|---|---|
| `stick.py ports` | list COM ports with vid/pid/serial; labels the Stick and the two IR-rig boards |
| `stick.py compile [--revive-on]` | stage the sketch and run `arduino-cli compile`; prints the size line. `--revive-on` builds with the post-MVP revive feedback on (`BRX_REVIVE_FEEDBACK=1`, a build property): a compile check, `flash` always builds the default |
| `stick.py flash [--port COMn]` | stage, compile, and upload to the auto-detected Stick port |
| `stick.py cmd <secs> [cmd ...]` | send serial commands, print every line for `secs` |
| `stick.py status` | send `STATUS`, print its fields parsed out |
| `stick.py raw <secs>` | toggle RAW on, capture for `secs`, summarise with `rawscan.py` |
| `stick.py ble [secs]` | scan BLE adverts for `secs`, list every service UUID heard |
| `tools/sercmd.py COM<n> <secs> [cmd ...]` | what `cmd`/`status`/`raw` delegate to: open the port with DTR/RTS low, send each command, print every line for `secs` |
| `tools/blescan.py [secs]` | what `ble` delegates to |
| `tools/rawscan.py < capture.txt` | what `raw` delegates to: a DIAGNOSTIC summary of RAW bursts (mark/space ranges, sync length, a labelled CANDIDATE word). Never a decoder; see "Diagnostics" below |

Use `sercmd.py`/`blescan.py`/`rawscan.py` directly only when you need something `stick.py` does not
wrap yet. Do not write ad-hoc scripts for a bench step; see the
[`m5stick-bench` skill](../../.claude/skills/m5stick-bench/SKILL.md) for the session method.

## Serial commands (115200)

The capture and emit line formats are the DevKitC rig's, so `mcp/tools/native_capture.py` and the
`ir_emit.ino` one-liners work unchanged.

| command | does |
|---|---|
| `r` / `s` / `c` | toggle the RAW dump / print frame count / clear, as `ir_capture.ino` |
| `RAW ON` / `RAW OFF` | set the RAW dump explicitly (what `stick.py raw` sends; the bare `r` is a toggle, and RAW is on at boot) |
| `SELFTEST [bits]` | loop the Stick's own LED into its own receiver: send one word, wait for the echo, print RAW plus decode, and `SELFTEST PASS` or `FAIL`. Defaults to the current beacon word when `bits` is omitted. Never feeds ownership. **Bench to confirm** what a PASS means here: M5 asks for 30 cm between sender and receiver, so a FAIL at millimetre range may be overdrive, not a fault |
| `TX <bits>` · `TXN <n> <bits>` · `AUTO <bits>\|OFF` · `PING` | as `ir_emit.ino` |
| `STATUS` | mode, owner, per-team charges, captures, advert seq and count, words heard, settings, the live UUID |
| `MODE BRIDGE\|HILL` | ownership mode, persisted. Resets the point |
| `ID <n>` · `GAME <n>` | advert bytes 6-7 and 13, persisted; a republish follows |
| `TXPIN 46\|9\|10` | onboard LED or either Grove signal pin, persisted; refuses to double as the RX pin |
| `RXPIN 42\|9\|10` | onboard receiver or either Grove pin, persisted; refuses to double as the TX pin. An internal pull-up is enabled on a Grove pin (see "External IR receiver" below). The `STATUS` RX line names the active pin |
| `BL <n>` | screen brightness 0-255, not persisted; bench-only, for A/B-ing the backlight-PWM noise against the receiver (`BACKLIGHT_DIM 60` is the shipped idle level) |
| `RESET` | neutral, charges cleared |
| `PLAYERS` | read-only: every player the station hears (RSSI raw/median/EMA, threshold, near/present, age) and the revive count |
| `PLAYERS STREAM <s>` | read-only: repeat `PLAYERS` every 250 ms for `s` seconds (max 120), from loop(), non-blocking |
| `PMIC` | read-only: the side-button lock registers (0x49/0x4A bit0, 0x49 bit7 DL_LOCK), the wanted lock and whether the read-back confirmed it |
| `REDEPLOY` | bench: show the green REDEPLOY flash now. Only with revive feedback on (post-MVP, `presence.h`); off, the command does not exist |

Every received burst except the Stick's own echo prints `RAW n edges=.. us=[...]`, `DECODE bits=..
val=...`, and on a complete word (exactly 25 bits; a 26-bit frame is discarded, because an inserted
segment shifts every field and can still pass both parity tests) `SHOT player= team= dmg= proto=
crit= parityOK= genuine=`. `parityOK` is the gun's own test (Z0 != Z1); `genuine` is the odd/even
rule every real BRX frame carries, and ownership only moves on words that pass both, so a corrupted
word cannot credit the wrong team. An ownership change adds `OWNER team=..`, every BLE republish
adds `ADVERT <uuid> seq=..`, and a BRIDGE that loses its beacon prints `ADVERT withdrawn`.

### The two modes

**BRIDGE**: the Stick sits in the grenade's beacon cone and repeats what the grenade says. `proto=15
mag=8` carries the owner in its team bits, team 2 meaning neutral. `mag=50` is the capture word,
~50 ms after the shot, and its team bits are the NEW owner: ownership moves on it at once and the
advert's rising bit shows for 1.5 s; the next beacon, ~5 s later, only confirms. Two missed beacons
(12 s) withdraw the BLE advert, because a stale owner would look exactly like a live neutral point
on the phones; the screen keeps the last owner and says the beacon is lost. Respawn (6), boot (56)
and was-neutral (53) never touch ownership. Shots are ignored: the grenade is the authority.

**HILL**: the Stick is the hill. `proto=0` shots add their magnitude to the shooter's team; when the
attacker's total reaches the holder's total the point flips and the winner holds the total it took
to win. That is the **PROVISIONAL** rule from 2026-09-10 (F76 still open on the currency), and it
lives in one function in `control_point.h` so it can change without touching anything else. The
hill emits the grenade's own beacon word every 5 s so stock guns react to it, and on a flip it sends
the grenade's capture word once. See `docs/ir-callouts.md` for the general rule this follows: one
word per event, sent once, from the device where it happened (S57). The advert's value byte is the
holder's share of all charge, 0 to 100.

Both modes advertise `role 1, kind 5 (control), id, team (255 = neutral), state bits (held 1, rising
4), value, seq, game` as one 128-bit service UUID, non-connectable, republished at once on an owner
or state change and at most once a second on a value-only change.

## Mission Control link (H8)

**Status: built 2026-09-24, DESK-VERIFIED ONLY.** Every claim in this section comes from host tests
(`test/test_link.cpp`, `test/test_ui.cpp`) and a clean `stick.py compile` against the real ESP32-S3
toolchain. **None of it has run on a Stick.** Flashing and bench-confirming it is Tony's.

The Stick is a Wi-Fi utility node exactly like a phone in the `utility` role (`docs/spec/utility.md`
§5g): it says `hello {node_id, node_type:"utility", app_ver, platform:"esp32", seq_next:0}`, takes
`welcome`'s `node_key`, and MC arms it with the same `station_config` a phone gets. It never binds a
gun, never acks a config, and keeps `seq_next: 0` forever (a station emits no persisted facts). The
pure link/parsing/scheduling logic is `station_link.h` + `json_lite.h`; the operator's on-device
buttons are `station_ui.h`; the Arduino plumbing (Wi-Fi, mDNS, the WebSocket, BLE claim-scanning,
Preferences) is `mc_link_glue.h`.

**Discovery.** mDNS (`_openbrx._tcp`, an async query polled each loop so the station's play never waits;
`MDNS.begin` once Wi-Fi is up, stopped when Wi-Fi drops; bench to confirm on a real Stick) is the intended path; the
mandatory floor is the serial console, since a Stick has no camera to scan MC's QR (§5g.3). A typed MC address is saved beside the Wi-Fi credentials in Preferences and is retried after reboot. It takes precedence for three failed dials, then the Stick browses mDNS for a moved MC. It retries the typed address after 60 s if discovery has not connected. A new `MC <ws-url>` command gives the typed address priority again. **Both paths are LAN-only**: mDNS never crosses a router, and a typed `MC <ws-url>`
means the MC's LAN address (`ws://<lan-ip>:<port>/ws`, from the console or the QR). Pointing it at
A28's public backhaul URL will not work: that tunnel enforces a join secret
(`envelope.py`'s `via`/`secret`, contracts.md §5), and this firmware never sends one -- it only ever
dials the plain LAN socket a phone on the same Wi-Fi would use.

**Serial commands** (in addition to the ones above):

| command | does |
|---|---|
| `WIFI <ssid> <pass>` | join and persist the Wi-Fi credentials |
| `MC <ws://lan-ip:port/path>` | save and dial the typed MC LAN address |
| `WIFI CLEAR` | erase the saved Wi-Fi credentials and typed MC address |
| `LINK HELD` \| `LINK MUSTER` | the association mode (§5g.4), persisted. `HELD` (the default when nothing is saved, `boot_assoc_mode`) stays linked and reconnects; `MUSTER` drops Wi-Fi for the match once armed |
| `LINK OFF` | drop the socket and Wi-Fi association now |
| `LINK RECONNECT` | clear the MUSTER drop's latch (below) and rejoin Wi-Fi -- the operator action that brings a Stick back to the table between matches |
| `ACTIONS ON` \| `ACTIONS OFF` | whether `station_action` (RESET, CLAIM's report) is sent to MC at all, persisted, **default ON** since MC accepts it (A56); `ACTIONS OFF` for an older MC -- see "RESET" below |
| `STATUS` | gained a second `LINK ...` line: link state, mode, ACTIONS, whether a MUSTER drop is latched, node_id, SSID, and the current assignment |

**The two association modes** are carried end to end: `apply_station_config()` (`station_link.h`)
decides, on every game-byte edge under `MUSTER` -- **including the very first arm after boot**
(polish round 2: there is no separate "armed but not yet live" phase a station can observe, so
0 -> N counts as a new match exactly like N -> N+1 does). The decision LATCHES as
`dropped_for_match()`: the glue drops the socket once, and its own Wi-Fi reconnect kick then
refuses to re-associate while the latch holds (polish round 2 fixed a real bug here -- the kick
used to undo the drop on the very next `loop()` tick). A running station's known match deadline clears the latch and rejoins automatically. A lock expiry alone cannot prove the match ended. Untimed stations stay offline until `LINK RECONNECT` or three quick B clicks. `LINK OFF` stays off. `HELD` never sets the latch at
all. Neither mode ever discards `node_key` or the current assignment on a drop.

**The powerup station (A56, `docs/spec/powerups.md`).** `station_config.item`
(`{kind, weapon_id?, charges?, amount?, spawn_every_s, first_at_s, name, color}`) and
`station_update {id, available, next_spawn_in_ms, reset?}` are parsed and stored. SELF-SPAWN
(`PowerupSchedule` in `station_link.h`) counts its own local clock down to the next spawn and flips
itself available at zero -- a lost MC link never freezes it, and polish round 2 fixed a real bug
where the ticking (and the CLAIM scan below) were wrongly gated on the link being `ASSIGNED`, so any
drop froze both; both now run off the persisted assignment alone
(`StationLink::has_powerup_assignment()`). Every `station_update` re-anchors the clock, MC being
authoritative whenever it is reachable -- except that **a station which has locally awarded the
current spawn refuses a bare `available:true` for it** (polish round 2, brx5): accepted only when
`reset:true` (an explicit operator RESET, which still respects MC's own fixed schedule) or when the
update's own implied next spawn is at least half a `spawn_every_s` interval past the awarded instant
-- otherwise it is a stale echo of the claim that already happened, and applying it would silently
un-claim an item a player is legitimately holding.

**F374: a powerup arm starts unknown, not available.** Like the phone station (`app/src/powerup.js`), a
new arm advertises all-zero (state 0, value 0, taker 0), awards no claim and shows PICKUP_EMPTY until
MC's first `station_update`, which MC sends at START and which anchors `first_at_s`. Under `MUSTER` a
powerup keeps Wi-Fi up for that update while MC is live, with no timeout (after a restore too, so a
reboot in LOBBY still hears START). If MC goes out of reach first (a blip, or the operator carries the
Stick out before START, as the placement flow in `docs/spec/utility.md` does), the Stick falls back to
available at once. Once Wi-Fi itself is lost it rejoins for `MUSTER_WAIT_OFFLINE_MS` (60 s), then takes
the drop; with Wi-Fi up it keeps waiting, so a Stick whose MC restarts in LOBBY still hears START. **The
limit:** a Stick that leaves Wi-Fi before START, or restarts offline mid-match, offers its item before
`first_at_s`, because it has no anchor.

**CLAIM** (`ClaimGate`) scans for a player phone's own advert (role 2, state bit 4 `claiming`, bit 5
`claim_ready`, `value` = the target station id, `id` = the claimant's player_num). A ready claim
can arrive at any signal strength. The Stick waits 100 ms after the first ready advert, then awards
the first ready player it heard. Only adverts received in the same millisecond tie by lower player_num. The phone counts the player's dwell. The advert then
carries `state 0` (taken),
`value` = seconds to the next spawn (capped 255), and the new byte 15 `taker` (the winner's
player_num, 0 = none); `state 1` (available) is always `value 0`. A won claim is reported
best-effort as `station_action {id, action:"taken", player_num, t}` -- **proposed to brx5, not a
final contract**. The BLE callback only records claim candidates. The loop awards after the short window and enqueues
(`PendingActionQueue`, bounded at 8, the newest report per spawn instant replacing any older one for
the same instant); `mcLoop` is the only place anything is ever sent, draining the queue once per
tick while a socket is live (still gated by `ACTIONS`, below).

**Buttons and RESET.** Once Wi-Fi has ever been configured (the first `WIFI` command, ever, even
across a reboot), the Stick's two buttons become OPERATOR controls -- players never press anything
-- and this REPLACES the legacy standalone BRIDGE/HILL toggle on the buttons:

- **A: STATS**, a short press only. Pages through local stats (kind, last taker, time to next spawn,
  MC link, battery), all read-only; nothing here is ever sent anywhere.
- **B: RESET**, a 2 s hold. The first hold arms a confirm; a SECOND 2 s hold within 5 s sends
  `station_action {id, action:"reset", t}` (proposed to brx5, not final) and changes nothing locally
  -- the station only changes once MC answers (a powerup's answer is `station_update
  {available:true, ...}`, which is what actually clears a shown `taker`). With no MC link, or with
  `ACTIONS OFF` (below), the screen says RESET NEEDS MISSION CONTROL either way: this Stick is not
  telling MC anything in either case, so that is the honest message for both.

**ACTIONS gate.** MC accepts `station_action` since A56 landed (`f3fe3cf6`), so `ACTIONS` defaults to
**ON**. An older MC (before A56) counts the kind toward its per-socket malformed-frame quarantine (net.md §8), so
set `ACTIONS OFF` against one. With it off, RESET and a CLAIM's "taken" report are never sent to MC, though RESET's
local confirm flow and a CLAIM's local award (the advert's `taker` byte) still work the same.

**Getting the legacy toggle back.** With the buttons repurposed, `MODE BRIDGE|HILL` over serial still
works exactly as before (it is not gated on the link at all) -- that is the only way to reach it once
any `WIFI` command has ever been given, since Wi-Fi credentials persist across reboots and the `WIFI CLEAR` serial command erases them and returns the Stick to the pre-H8 NOT-CONFIGURED
state. `LINK OFF` only drops the current socket and association.

**THRESHOLD.** `0` in `station_config.threshold` (or the key absent) means the Stick default for that kind.
Every kind except `control` uses -57 dBm (`STICK_DEFAULT_THRESHOLD_DBM`). A `control` hill uses
-75 dBm (`STICK_HILL_DEFAULT_THRESHOLD_DBM`, Tony 2026-09-25, UNPROVEN): sitting B, 2026-09-25, Stick-side PLAYERS STREAM
medians were -43 touching, -64 at arm's length, -77/-81 at about 5 m (two phones), and -78 to -87 down the
hall, still present at -80. -80 reached past 7 m, so Tony set -75 for a 5-7 m target. Take clean 3 m
and 7 m readings. MC's nonzero value overrides the Stick default. A defaulted control hill still advertises
-57 in byte 14 because phones measure the Stick about 25 dB louder than it measures them.
An explicit MC threshold or the first on-station RADIUS edit also sets byte 14 to that threshold.
The separate -57 advert value applies only while the hill uses its unedited default.

**Bench to confirm, all of it:** the mDNS query actually resolving MC on the field router; the
WebSocket surviving a reconnect (and the library's own retry not fighting the association-mode
policy above it); Wi-Fi 4 + BLE 5 coexistence jitter on the advert while `HELD` (§5g.4's whole
reason for existing); the CLAIM scan actually catching a phone advertising every ~100-250 ms while
claiming (`SCAN_PERIOD_MS`/`SCAN_WINDOW_S`/`SCAN_WINDOW_UNITS` in `mc_link_glue.h` are guesses); the
claim-ready-to-grant time after the new 100 ms arbitration (F399 target about 1 s);
`ROLE_PLAYER` advert layout this firmware assumes (id = player_num, value = target station id) --
FYI'd by brx5, never seen on our own bench; the button timing
(2 s hold, 5 s confirm timeout) at arm's length; the operator screen's legibility on the real
1.14" panel (`paintOperator()` has never been seen lit); whether `LINK RECONNECT` actually needs
typing over serial in practice or wants a button/timeout of its own; and the `available:true`
refuse/accept rule (polish round 2) -- built from the coordinator's brief alone, since
`app/src/powerup.js` does not exist in this checkout to mirror.

**Bench steps (Tony's):**

1. Flash (`stick.py flash`), then `stick.py cmd 5 WIFI <your-ssid> <your-pass>` and confirm it joins
   (`STATUS` shows `LINK state=LOOKING FOR MC` or better).
2. Start MC with mDNS advertising on (the default), or `MC ws://<mc-ip>:<port>/ws` from the QR/console.
3. `STATUS` should show `LINK state=LINKED, NOT ARMED node_id=stick-...`.
4. From MC's ITEMS panel, assign the Stick as RESPAWN or CONTROL (POWERUP/EXTRACTION/BOMB arm but
   have no player-side rule yet, §5g.5) and confirm `STATUS` shows `kind=... id=... game=...` and the
   advert UUID changes (`stick.py ble` from another device).
5. For a POWERUP: arm it with an item, confirm the advert reads all-zero (state 0, PICKUP_EMPTY) until
   MC sends its first `station_update` at START (F374: `available:false` with the countdown to
   `first_at_s`, so state 0 with a value), then confirm the advert shows state 1 (available) at the spawn, then
   claim it from a player phone and confirm state flips to 0 with a plausible countdown in `value`
   and the taker's player_num in the last byte.
6. Try the `LINK HELD` default vs `LINK MUSTER` and watch whether the advert stays live at go-live.
   Under `MUSTER`, confirm `STATUS` shows `dropped_for_match=1` right after the drop, that the Stick
   does NOT rejoin Wi-Fi on its own, and that `LINK RECONNECT` is what brings it back.
7. (ACTIONS is on by default.) Hold B once (arms RESET) and again within 5 s (sends it) and confirm MC saw it
   (once MC accepts the kind); with `ACTIONS OFF` confirm nothing reaches MC either way
   and the screen still says RESET NEEDS MISSION CONTROL. Short-press A and confirm it only pages,
   never arms a reset.

## Firmware architecture

| file | what |
|---|---|
| `m5sticks3.ino` | the Arduino wrapper: RMT receive on G42, RMT transmit with a hardware 38 kHz carrier, NimBLE advert, M5Unified display and buttons, Preferences |
| `brx_ir.h` | pure C++: pulse durations to bits to fields, and back; the measured timings; the parity rule |
| `brx_advert.h` | pure C++: the 16-byte advert and its UUID string (+ the A56 `taker` byte and its reverse decoder), an exact port of `app/src/beacon.js encodeUuid`; the republish policy from `control.js` |
| `control_point.h` | pure C++: the bench BRIDGE and IR HILL ownership state machines |
| `presence.h` | pure C++: the Bluetooth stations -- player presence, the presence hill and the revive count, ports of `beacon.js`/`control.js`/`utility.js` |
| `json_lite.h` | pure C++: a tiny tolerant JSON reader/writer for the M-NET envelope bodies (H8) |
| `station_link.h` | pure C++: the MC link state machine, hello/status builders, station_config/station_update/control parsers, the powerup self-spawn schedule, and the CLAIM award logic (H8, A56) |
| `station_ui.h` | pure C++: the operator button state machine (page / RESET confirm) and the `station_action` builder (H8) |
| `station_screen.h` | pure C++: the screen MODEL -- state -> ScreenSpec, plus `HomeNav` (idle timeout / go-home). See "Screens" below |
| `station_render.h` | Arduino-only: draws a ScreenSpec with M5GFX into an off-screen `M5Canvas`. See "Screens" below |
| `mc_link_glue.h` | Arduino-only: Wi-Fi, mDNS, the WebSocket to MC, the shared BLE player scan and the 250 ms hill/revive tick, Preferences -- the plumbing on top of the headers above (H8) |
| `test/test_core.cpp` | host tests for `brx_ir.h`/`brx_advert.h`/`control_point.h` |
| `test/test_link.cpp` | host tests for `station_link.h`/`json_lite.h`, plus a golden-dump mode `mcp/tests/test_utility_esp32.py` uses to drive MC with the exact JSON this firmware builds |
| `test/test_ui.cpp` | host tests for `station_ui.h` |
| `test/test_screen.cpp` | host tests for `station_screen.h` |
| `test/test_presence.cpp` | host tests for `presence.h` |

All run under `mcp/tests/test_sticks3_core.py` when `g++` exists. The pure headers never include
Arduino, so the logic is tested on the laptop and the sketch + `mc_link_glue.h` are the only plumbing.
Keep it that way.

**BLE advert.** The advert is 16 bytes: a 4-byte magic, a version byte, then role, id (2 bytes),
kind, team, state, value, seq, game, an RSSI threshold, and a pad byte, rendered as one 128-bit
service UUID string. It is an exact port of `app/src/beacon.js`'s `encodeUuid`, so a phone HUD
decodes a Stick the same way it decodes a phone station. The republish policy (`AdvertPolicy`)
republishes at once on an owner or state change, and at most once a second on a value-only change,
bumping `seq` every time so a scanner can tell fresh from stale.

**IR receive.** RMT on G42, 1 us ticks, a 3 us hardware glitch filter (the ceiling of the 80 MHz
filter clock; see docs.espressif.com's RMT reference), a 20 ms idle threshold, and a 128-symbol
buffer split across 3 memory blocks (matching M5's own StickS3 IR example). Decode is strict: the
leading mark must land within 1800-2200 us to count as a sync, and a mark longer than 750 us reads
as a 1 bit. The genuine-parity check is the odd/even rule every real BRX frame carries, on top of
the gun's own Z0/Z1 test. **Bench to confirm:** whether this buffer and filter setup is enough
headroom for a full word plus the glitch fragments F314 has shown on real bursts.

**IR transmit.** RMT with a hardware 38 kHz carrier at 33% duty (matching both M5's and Espressif's
own examples, not the DevKitC rig's 50% LEDC carrier). After every transmit the sketch rebuilds the
whole RX channel (`rmtDeinit` then re-init) rather than just re-arming it: a bare re-arm failed on
first bring-up with `rmt: rmt_receive(401): channel not in enable state`, which is a known, open,
unresolved upstream bug on the ESP32-S3 (espressif/esp-idf#17811).

**Echo filter.** The onboard LED and receiver are millimetres apart, so the sketch drops any
received word that matches what it just sent within 150 ms of sending it, to stop self-hearing.

**External IR receiver (bench 2026-09-24, F314).** The onboard receiver (G42) hears an ordinary TV remote fine,
so its optics and RMT path are sound, but it does not decode BRX-style IR from a gun or an emitter at any
distance tried. `RXPIN 9` or `RXPIN 10` moves receive to a Grove pin for an external 38 kHz receiver (a VS1838B
or similar); the firmware enables an internal pull-up on that pin, because the receiver's own pull-up is weak
enough that the Stick's pin state can drag it low. A VS1838B wired this way, sharing 3.3 V power with another
receiver already on the bench, decoded 3 of 3 real gun shots at 1 m as whole 25-bit words.

Safe standalone wiring (not yet built): power the VS1838B's VCC from a Grove pin driven HIGH at 3.3 V (the part
draws about 1 mA and runs on 2.7-5.5 V), OUT to the Grove RX pin with the internal pull-up, GND to the Grove
black wire. Leave the Grove port's red 5 V wire unused. **Warning: never power a VS1838B from the Grove port's
5 V rail while its OUT pin sits on a Stick GPIO.** That puts 5 V on a 3.3 V pin.

## Screens

`mockups/render.py` is **the design of record** (Tony approved it 2026-09-24): every screen, its
exact copy, and its layout grid (status strip / main block / hint bar) live there first, rendered
with Pillow so they can be reviewed as PNGs before any firmware is touched. `station_screen.h` is a
pure, host-tested model of it: a state -> `ScreenSpec` function (which screen, its words, colour
roles, progress values, hint bar text, status-strip flags), tested by `test/test_screen.cpp` the same
way every other pure header here is. `station_render.h` is the other half, Arduino-only: it draws a
`ScreenSpec` with M5GFX into an off-screen `M5Canvas`, pushed once per paint
(`m5sticks3.ino`'s `paintFromModel()`).

**Fonts.** M5GFX ships no condensed bold font; the closest built-ins are the Adafruit-GFX
"FreeSansBold" family at four fixed sizes (9/12/18/24 pt) -- bold, but not condensed, so a long word
sits wider on the Stick than in the mockup. So `fitCenterText` never draws text wider than its box:
at each size (the caller's, then smaller ones down to 9 pt) it tries one line, then two lines where
the layout gives it the height, then a documented short form ("MC" for "MISSION CONTROL"), and last
cuts the text to the width (the screen gate fails on any cut). A stats value that would reach its
label drops to the small label font first, so it stays whole ("PICKUP - PLASMA RIFLE"), and only
then shortens to the part after a comma ("NOT ARMED"). Converting the repo's own Saira Condensed TTF to a VLW or
u8g2 font is a follow-up, not done here.

**Redraw policy.** `loop()` redraws on a real change (`displayDirty`, the same flag every other
handler here already sets) or at least every ~250 ms (4 Hz), so a countdown (a pickup's NEXT SPAWN, a
RESET confirm's draining timeout bar, the JOINING dots) still moves. Every screen is drawn into the
canvas and pushed once, never straight to the panel, so drawing never competes with IR receive (RMT
is hardware-buffered) or the Wi-Fi/BLE loop.

**Screen brightness.** `m5sticks3.ino`'s `loop()` (not the pure model) drops
`M5.Display.setBrightness()` from 120 to 60 after 30 s with no real event (a button press or a state
change such as a pickup or a capture), and wakes back to 120 on the next one.

**Home.** The operator can always get back to the live gameplay screen without a restart
(`station_screen.h`'s `HomeNav`, host-tested): 20 s with no button press returns home by itself, and
a 1 s hold of A goes home at once from anywhere, cancelling an open RESET confirm on the way. Neither
gesture changes any station state -- see "Buttons and power" below.

**Could not match render.py exactly:**

- HILL_CAPTURING and HILL_CONTESTED: only the Bluetooth hill reaches them. CAPTURING names the team
  whose bar it is with a verb render.py does not have: CAPTURING (rising), LOSING (its bar is
  draining) or STALLED (part built, nobody on it). A held point whose owner tops it back up stays
  HELD. The small lines under NEUTRAL and CONTESTED say STAND HERE TO CAPTURE and TEAMS ON THE POINT,
  since this hill counts bodies, not shots. The bench IR hill still never emits either screen.
- RESPAWN: OWNED shows the team and RESPAWN on the team colour, with no kicker (the revive count
  and REDEPLOY flash are post-MVP, see "Bluetooth stations"); a station for any team (team 255) shows ANY TEAM in the neutral colour. IDLE is shown only when the advert is down, and says ADVERT DOWN
  rather than render.py's AWAITING ASSIGNMENT. An extraction/bomb assignment shows the generic
  ASSIGNED screen.
- PICKUP_EMPTY: not a globally-exhausted item (nothing in `StationItem`/`PowerupSchedule` tracks
  that). F374: it means the station is armed but MC has never sent a `station_update` for it, so the
  schedule is UNKNOWN (`PowerupSchedule::known()` false): waiting for MC's first `station_update`,
  sent at START.
- SETTINGS: not wired to any button flow yet (`ID`/`GAME`/`TXPIN` stay serial-only); the renderer
  exists, `compute_screen()` never produces it.
- A welcomed-but-not-yet-armed link (MC found, no `station_config` applied yet) shows LINKED /
  ASSIGN ME IN MC (`SCR_LINKED_WAITING`); render.py has no screen for that state.
- `hold_time`/`next_spawn` both go through one canonical m:ss formatter (`format_mmss`: minutes
  unpadded, seconds zero-padded); render.py's own scene literals hardcode "04:12" vs "1:40"
  inconsistently, since render.py never defines the formatter itself.

**Bench to confirm:** colours and legibility on the real panel -- none of this has been seen lit.

### Screen simulator

**Rule: review the gallery before you flash any screen change.** The simulator shows which screen
the Stick picks in every state, and what that screen says, without a Stick:

```
python3 hardware/m5sticks3/sim/stick_sim.py --copy-to /mnt/c/Users/Tony/brx-stick-sim
```

Then open `C:\Users\Tony\brx-stick-sim\index.html` (or `hardware/m5sticks3/sim/out/index.html`).
Each scenario drives the real `StationLink`, `ControlPoint`, `PlayerPresence` and button state
machines with real MC messages. It maps the result through the firmware's own `build_stick_state()`
(`stick_state.h`, shared with the .ino) and `compute_screen()`. It then draws the screen with the
real `station_render.h`, compiled on the host against the installed M5GFX's sprite code, so each PNG
is pixel-exact. `sim/shim/M5Unified.h` stands in for the Arduino header. The glue's frame handling
and `pollButtons()` are Arduino-only, so `sim/stick_sim.cpp` copies their sequencing.

The gate is `mcp/tests/test_sticks3_screens.py` (`cd mcp && python3 run_tests.py sticks3`). It fails
when a scenario shows the wrong kind or copy (`EXPECT` in `stick_sim.py`), or when text leaves the
screen, its band or its box, or lands on other text. It also fails when two different states draw
the same picture, or when two strings sit closer than 2 px. `KNOWN` lists accepted exceptions, each
with its reason; it is empty (the 14 screens the first run flagged are fixed). A new screen or state gets a scenario and an `EXPECT` row. M5GFX is found in the Arduino
libraries folder or `$M5GFX_SRC`; without it only the screen kinds are checked. The simulator and the
gate also build with revive feedback on (`EXPECT_REVIVE_ON`), so the post-MVP respawn screens stay
checked; the gallery shows them in their own section. Any text the fitter had to cut fails the gate.

## Buttons and power

The two GPIO buttons (A = G11, B = G12; see "Hardware and pins" above) are OPERATOR controls once any
`WIFI` command has ever been given; before that they keep their standalone bench meaning (long-press
RESET / MODE toggle) documented there.

| button | gesture | does |
|---|---|---|
| A | short press | next page: leaves the home/gameplay screen for STATS (standalone bench mode: toggles DIAGNOSTICS) |
| A | hold 1-5 s, then release | HOME, on the release: back to the live gameplay screen from anywhere, cancelling an open RESET confirm on the way. Changes no station state (`station_screen.h`'s `HomeNav`, host-tested) |
| A | hold 5 s on STATS | RANGE (F365, below). From 1 s the hint bar fills with "HOLD FOR RANGE"; letting go before 5 s is HOME |
| B | hold 2 s, then hold again within 5 s | RESET: the second hold sends `station_action{action:"reset"}` to Mission Control. Only with a station assigned: an unassigned Stick has nothing to reset, so the hold does nothing and the hint bar shows only `A: STATS` |
| A + B | hold together 7 s | FORCE RESTART, locked or not (clears the saved lock) |
| B | three quick clicks | force a rejoin after a MUSTER drop; refused while locked |
| small side button | single click | power on, or restart if the Stick is already on |
| small side button | double click | POWER OFF (**bench to confirm:** whether this fires while the Stick is on USB power, as it always is at the bench) |
| small side button | held while plugging in USB | download mode (first flash over factory firmware only): the screen stays dark and the internal green LED flashes, matching our own bring-up |

Source: docs.m5stack.com/en/core/StickS3, "Button Operation Instructions". **Bench to confirm:** the
mapping assumed above of `M5.BtnA`/`M5.BtnB` to the Stick's two physical keys -- BtnA the front M5
logo key, BtnB the larger side key -- since this firmware's button code has never been seen lit.

### Range, edited on the station (F365, contract A67)

Tony, 2026-09-25: "if operator notices the range is too wide during gameplay, to long hold and be able
to edit it. if within wifi range sync with MC on the change." Two decisions of his shape the gesture:
**enter RANGE by holding A for 5 s on the STATS page** (the home page's B hold stays RESET), and
**RANGE works during play only while the station lock is unlocked**. Every edit is reported to MC.

- **Gesture.** A is read as one gesture (`station_ui.h AHoldGesture`, host-tested): released under 1 s it
  is a click, released between 1 s and 5 s it is HOME, and reaching 5 s on STATS (with a station
  assigned and unlocked) opens RANGE with nothing else firing. From 1 s the hint bar fills with "HOLD FOR RANGE" only while unlocked.
- **RANGE screen.** Two fields: RADIUS (the presence threshold in dBm, with a rough distance) and
  STRENGTH (the advertising power: ULTRA LOW -18 dBm, LOW -9, MEDIUM 0, HIGH +9, the default). The lit
  panel is the one being edited; each says EDITED (an on-station value) or MC. A click = CLOSER (radius
  +3 dB, e.g. -57 to -54) or WEAKER; B click = FARTHER (-3 dB) or STRONGER; an A hold (1 s) switches
  the field; a B hold (2 s) or 10 s idle leaves (the kicker says HOLD B: DONE; a held button keeps it
  open). In RANGE a B hold only leaves, it never arms RESET. RANGE does not open while a RESET confirm
  is open, and it closes by itself when the station is released or when bench mode takes over. It is
  also meant to close under the low-battery screen, but that is inert until a battery reading is wired
  up (none is today).
  The radius is clamped to -90..-40 dBm. Each step
  applies at once: presence (hill, respawn) uses it on the next tick, byte 14 of the advert
  republishes at once, and a new power restarts the advert at it.
- **Distances are rough**, and the screen says so: `station_range.h RANGE_DISTANCE_TABLE`, anchored on
  Tony's measurement (-57 dBm is about 3 m from a Stick), 6 dB per doubling of distance from there. The
  control hill uses its separate, unproven label table: -75 dBm is about 5-7 m.
- **Sync (A67).** Every status beat carries `threshold` (applied now), `threshold_src` ("station" |
  "mc") and, only while "station", `threshold_edit_age_ms`; the same three for `tx_power`; and
  `range_edits`, the last 8 edits (seq, field, from, to, locked, age_ms), restated every beat (MC
  dedupes by seq). MC's `station_config` carries `threshold` and `threshold_age_ms` (and optionally
  `tx_power` with `tx_power_age_ms`). Per field: an on-station edit YOUNGER than MC's age stays;
  otherwise MC's value applies and the edit goes. No age = an older MC, whose value applies. No
  `tx_power` = keep the Stick's. `threshold` 0 selects the kind's Stick default. The status reports the
  threshold used by the Stick, never 0. A defaulted control advert keeps byte 14 at -57 for phone-side presence.
  With no age (an MC before A67), MC's value applies only when it CHANGED: MC re-sends the same
  config as the lock carrier and on every reconnect, and that must not undo the operator's edit. A new
  station (kind or id) starts from MC's values. A new game alone (arming the next match) keeps the
  edit unless MC's value changed, since the station and its placement are the same.
- **Offline and reboots.** The edit lives in RAM and NVS ("brxmc"/"range", written only when it
  changes), so an offline edit is reported on the first beat after reconnect. After a reboot the
  edited value comes back (onto the same station id) with its age unknown, reported as
  2147483647 ms (`EDIT_AGE_UNKNOWN_MS`), so any MC value set since wins; the edit log's seq also
  survives. A release drops the edited values, not the log. `seq` never goes down: a release, a new
  session, a new identity or a stale NVS copy cannot lower it. The one reset is an erased NVS (a
  reinstall); if NVS cannot be opened at boot, or the saved range body is there but does not parse,
  that boot keeps edits in RAM and never writes the key, so it cannot overwrite a higher seq.
- **TX power: bench-confirmed 2026-09-25.** STRENGTH moves the advert by about 9 dB: an A/B/A at 1 m
  from a player phone read MEDIUM -47.5, HIGH -39.0, MEDIUM -49.0 dBm (median of 30-50 samples each),
  consistent with the ±9 dBm spacing above. Whether `BLEDevice::setPower(level, ESP_BLE_PWR_TYPE_ADV)`
  also moves the player scan's own transmissions on this core is still unconfirmed.
- **Presence RSSI is asymmetric, bench-measured 2026-09-25.** At 1 m a player phone hears the Stick at
  about -39 dBm, but the Stick hears the phone at only about -64 dBm at arm's length under the same
  conditions. Calibrate each side's threshold from its own reading; do not assume the two links are
  symmetric, or set one side's threshold from the other side's measurement.
- **Serial.** `STATUS`'s LINK line adds `threshold_src`, `tx_power`, `tx_src` and `range_edits`
  (a count); the log prints `RANGE opened (A held 5 s on STATS)`, `RANGE threshold=... tx=... (on-station
  edit, seq n)`, `RANGE closed (B hold | 10 s idle | no station assigned)`, `RESTORED range ...` at boot
  and `# advert TX power <name> (<dBm> dBm)` when the power changes.

### Match lock (A58)

While the lock is on, a 5 s A hold on STATS shows LOCKED. It does not open RANGE. An open RANGE screen closes if the lock arrives. MC still accepts `locked: true` edits from older firmware; in RANGE a B hold leaves, it never reaches RESET.

Mission Control can lock the operator controls for a match: `station_config.lock_s` (0 to 7200 s,
absent means 0) locks them for that many seconds from receipt. A later `station_config` replaces the
running lock, and `lock_s: 0` unlocks at once. A `control{cmd:"release_utility"}` also unlocks, since a
released Stick is UNASSIGNED and has nothing to protect. The lock counts down on the Stick's own clock and
unlocks itself at zero. While it is on, a padlock shows in the status strip and:

- the B-hold RESET is refused and shows LOCKED with the time left;
- A still pages the stats and goes home (read-only);
- the serial commands that change station state or transmit IR answer `ERR locked` (RESET, MODE,
  ID, GAME, TXPIN, WIFI, MC, LINK, ACTIONS, SELFTEST, TX, TXN, AUTO with bits). These still work:
  the read-only PING, STATUS, PLAYERS, PLAYERS STREAM and PMIC; RAW ON|OFF (it changes only what
  the Stick prints); and bare AUTO and AUTO OFF (both only stop a transmit)
  (`serial_command_allowed_while_locked`, `station_ui.h`).
- the side button's single-click reset and double-click power-off are disabled in the PMIC (F332).
  Both registers are read back after every write and the write is retried each second until they
  match (every 30 s after ten failures in a row). setup() clears them first thing on every boot, and
  while locked the loop watchdog is on at 20 s (the WebSocket library can block loop() for up to 5 s
  when MC goes away), so a real hang resets the Stick and the boot clear gives the button back.

**Force restart:** hold A and B together for 7 s. After 2 s the screen counts down (RESTART IN 5);
releasing either button cancels. It works whether the Stick is locked or not, and the joint hold
never also triggers A's home or B's RESET.

The lock remaining seconds are saved to NVS when a lock starts and at most once per five minutes. A boot restores at most 120 seconds because the Stick cannot count time while powered off. A saved lock applies only to the saved game byte. An ordinary restart keeps this bounded lock. Without Wi-Fi or MC, the screen shows `A+B 7S: RESTART`; that gesture clears the saved lock. A two-hour lock makes at most 24 timer snapshots, plus one removal at expiry. Each changed MC lock config can add one write. MC detects a restart from the status heartbeat: `uptime_s` goes back to near zero and
`boot_count` goes up. The heartbeat also carries `assoc` (`muster` or `held`) and `lock_s`, the
seconds left on the lock.

**What survives a restart.** Saved in flash: the Wi-Fi credentials, the node id and key, the LINK mode
(MUSTER or HELD), ACTIONS, and the last station config MC sent (without its `lock_s`, and written only
when it changes). The match lock remaining time is also saved. The spawn timer and taker are not saved. A Stick that
restarts mid-match comes back as the same station at once, with its saved lock and a fresh schedule,
and `STATUS` shows `restored=1` until MC sends a config again. A restored Stick does not know whether the match is still
running, so even under MUSTER it tries to rejoin Wi-Fi. If MC answers, MC's current config replaces
the restored one (with the remaining lock, once MC sends `lock_s` (A58)), and the MUSTER drop waits
for MC's next `station_update` so the schedule is re-anchored first: at most 2 s, or for a powerup
until START while MC is live (F374). If not, the Stick
keeps playing the restored station. A WELCOME from a different MC session erases the saved config and
drops a still-restored assignment back to UNASSIGNED. `control{cmd:"release_utility"}` also erases
it. With no Wi-Fi SSID set (bench mode) the Stick never restores. A button
still held when the Stick boots (hands still on A+B after a force restart) is ignored until it is
released.

The PMIC side-button lock is restored at boot before Wi-Fi starts when the saved match lock is active. Setup first clears an old PMIC lock so a crash loop cannot strand the operator. Each PMIC write logs its register, value and reason. A+B held for 7 s clears the saved lock before `ESP.restart()`; MC `lock_s: 0` also clears it.

## Diagnostics

- `r` toggles the RAW dump: every burst except the Stick's own echo, as mark/space durations in
  microseconds, plus the strict decode.
- `SELFTEST [bits]` (see "Serial commands" above) is the fastest way to check the transmit and
  receive paths are both alive without a gun or a grenade in the room.
- `stick.py raw <secs>` / `tools/rawscan.py` summarise RAW bursts: mark and space ranges, the
  sync-region length, and a labelled 25-mark CANDIDATE word at a 600 us bit threshold. This is a
  **diagnostic only, never a decoder, and it must never feed ownership**: on 2026-09-23 a tolerant
  re-read of real bursts produced wrong words that still passed both parity checks. Compare a
  CANDIDATE against the rig receiver's word for the same shot; that comparison is the result, not
  the CANDIDATE alone.

## Known pitfalls

- **EXT_5V is off by default.** A Stick with no IR activity at all is usually this, not a wiring
  fault; see "Power" above.
- **Download mode** is needed only on the first flash after factory firmware (hold the small side
  button while plugging in USB). A later flash over running firmware does not need it.
- **Charge-only USB-C cables** drop the Stick from the port list while its screen stays lit.
- **DTR/RTS reset the S3 on open.** `sercmd.py` (and everything `stick.py` delegates to) already
  opens the port with both low; a perceived reset needs checking the DTR/RTS lines first, not a
  delay added on top.
- **Read counts (`s`, `STATUS`) in the same serial session that captured them.** Closing and
  reopening the port does not reliably preserve what the firmware remembers across a bench
  narrative; a count read cold is a different measurement.
- **The RAW-split artefact is a known rig behaviour, not a Stick bug.** A burst printed as several
  short `RAW` lines instead of one long one is the receiver fragmenting on a mid-frame gap (the
  same behaviour documented for the DevKitC rig).
- **Aim and distance.** M5 says to keep at least 30 cm between sender and receiver; closer "can
  cause bad reception" (docs.m5stack.com/en/arduino/m5sticks3/ir_nec). Separately, a 38 kHz
  receiver in this class needs a gap after a burst of more than 5 times the burst length once the
  burst passes about 70 cycles (Vishay's TSOP382 datasheet, vishay.com/docs/82491/tsop382.pdf).
  BRX's ~2 ms sync is about 76 cycles at 38 kHz, and its own gaps are only ~500 us, so BRX frames sit
  right past the point where this class of receiver is documented to need a much longer recovery
  gap than BRX provides. That is a plausible, datasheet-grounded explanation for why the onboard
  receiver distorts BRX frames at close range; it is not proven root cause.
- **An intermittent ~650 Hz stream of about 144 us pulses** appeared during bring-up. Its source is
  unproven.
- **Never flash a BRX gun or headset with this tool.** `stick.py` and its FQBN target the StickS3
  only. The repo's hard rule stands: stock BRX firmware is never modified; all gun control stays on
  the Bluetooth serial protocol.

## Open questions

- **F314: IR receive of a gun shot is unproven.** The rerun plan, with a fixed-distance ladder and
  controls, is `docs/bench-sticks3-2026-09-23.md`'s Rerun section.
- **The standalone external-receiver wiring.** `RXPIN 9`/`RXPIN 10` and the external-receiver bench proof are
  built (see "External IR receiver" above), but only with the receiver sharing power with another one already
  on the bench. The standalone wiring (VS1838B powered from a Grove pin, not borrowed) and a HILL capture test
  with real shots on a standalone Stick are **not yet built**; this closes F314.
- **H8**, whether a Stick should carry its own `station_source` value instead of borrowing
  `grenade`'s: `docs/spec/utility.md` §5g.7. (The Wi-Fi link itself is built; this is the one loose
  end §5g.7 left open and it does not block arming a Stick today.)
- **Everything in "Mission Control link (H8)"'s "Bench to confirm" list above** -- none of it has
  run on a Stick.
- **`station_action` (RESET, CLAIM's "taken" report) is proposed to brx5, not a final contract.**
  Its shape lives in one function each (`build_station_action_body` in `station_ui.h`,
  `mcBuildStationActionTaken` in `mc_link_glue.h`) so a rename is a one-line change.
- **Which Grove pin (G9 or G10) the yellow wire drives on this unit**, given M5's own pinout page
  and the M5Unified port mapping disagree; see "Hardware and pins" above.


**Hill timing (A68):** MC sends `starts_in_ms` and `ends_in_ms` in the same `station_config` whenever it knows the times. Both are relative to MC send time; the start can be negative after go-live. A future start keeps the hill neutral, waiting, and accrual-free. A same-game config in LOBBY without a start also keeps it waiting. The MUSTER wait ends on any config with `starts_in_ms`, including an untimed START. The hill counts only from its local go-live to its local deadline, then freezes its owner and possession tally and shows MATCH OVER. A same-game config with neither time means no match is running and the hill waits. MC sends no `station_update` for a hill. A restored timed hill stays frozen until a fresh config provides timing, because `millis()` cannot measure time while powered off. After an abort, the same-game config omits both times and returns the hill to waiting. An early end reaches only a Stick still in Wi-Fi.

**Offline limit:** F374's 60 s MUSTER fallback still starts the hill if the Stick loses Wi-Fi before hearing START, then drops Wi-Fi. That hill counts as before because it has no go-live or deadline. An adopted match pushes nothing to stations, so an adopted match gives a Stick hill no go-live or deadline and it counts as before.


## Bench checks for F389-F398

1. **F389:** Connect by typed MC URL. Send `LINK MUSTER`, push a new lobby game, then confirm STATUS shows the drop and MC shows no socket. Repeat with `LINK OFF`; confirm neither typed nor mDNS reconnects until `LINK RECONNECT`.
2. **F390:** On a MUSTER hill with `ends_in_ms`, confirm it rejoins after the deadline. With an untimed match, confirm lock expiry leaves it offline. Check B three-click rejoin while unlocked, then confirm the same gesture is refused while locked.
3. **F391:** Lock a Stick, power-cycle it, and confirm `STATUS lock_s` remains nonzero and the PMIC side button stays locked. Hold A+B for 7 s and confirm the next boot is unlocked. Then send MC `lock_s: 0` and confirm the lock clears.
4. **F392:** Reproduce `LINK OFF`, `LINK HELD`, `LINK RECONNECT` while Wi-Fi is joining. Compare each PMIC write log and reason with PMIC readback; click the side button once and confirm restart. Record whether a join delays PMIC sync or changes either register.
5. **F397:** Type an MC URL, restart the Stick, and confirm it dials the saved URL without serial input. Send `WIFI CLEAR`, restart, and confirm both Wi-Fi credentials and the typed URL are gone.
6. **F398:** Render the countdown screen on the Stick and confirm the loading ring clears `NEXT SPAWN` with visible space.
