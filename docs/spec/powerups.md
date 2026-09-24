# Powerups: a station grants an item (design, 2026-09-24)

Status: **DESIGN, built behind a flag that stays off until bench Sitting A passes** (the slot and button checks
below). Tony's model: a station (a utility phone or an M5Stick) is assigned a kind and its data by Mission Control
(MC) per game. A powerup station grants an item, for example a pickup-only heavy (rockets). Contract row: A56.
Roadmap entry it replaces: K3 in `docs/utility-roadmap.md`; the station half of S46.

## The mechanism: armed at start, unlocked at the station

A mid-match config re-push to a live gun clears `spawned` and silences it for the rest of the match
(`utility.md` §5g.6), so a pickup must never re-arm the gun. Instead:

1. **At arm time** MC compiles the game's pickup weapon into a spare gun slot with its normal `$WEAP`: slot 2 for
   the first powerup item, slot 3 for a second (bench 2026-09-17: slots 0-3 each take a `$WEAP` and their own
   `$AMMO`). Its magazine and reserve start at **0**.
2. **Locked** means two things, both already proven levers: the slot is **out of the ALT cycle**
   (`$BMAP,1,100,0,1,99,99`, today's default, cycles 0 and 1 only), and its **magazine is empty**. A player who
   somehow reached it could not fire it.
3. **The grant** (the player's own phone, at the station): one `$AMMO` write for the pickup slot (the item's
   charges as the magazine, reserve 0), then one `$BMAP` write that puts the slot into the ALT cycle
   (`$BMAP,1,100,0,1,2,99`). Both are small mid-life writes, like recoil's and the trigger hold's; neither touches
   the config.
4. **The end of an item**: when its magazine reaches 0, or at the player's death, the phone writes the old ALT
   cycle back (`$BMAP,1,100,0,1,99,99`) and, if the pickup slot is active, the HUD tells the player to switch
   (the gun, not the phone, owns the active slot).

**Fallback** if the bench shows the spare slot is unusable: the grant writes the item into slot 1 mid-life
(`$WEAP,1,…` then `$AMMO`, bench-proven 2026-09-17, S42) and restores the loadout's secondary at the end. It
costs the player their secondary while the item lasts.

## Bench gate (Sitting A, MUST, before the flag turns on)

1. A `$WEAP` in slot 2 and 3 at arm time; `$ALCD` reports each slot; each fires and takes its own `$AMMO`.
2. Slots 4 and 5: does a `$WEAP` take (Jay: "about 5 weapons")? Slot 4 is melee today.
3. `$BMAP,1,100,0,1,2,99` makes ALT cycle 0 → 1 → 2; `$BMAP,1,100,0,1,99,99` written back mid-life removes 2.
4. Which physical buttons are `$BUT` 3, 4 and 5 (left, select, right), and whether a `$BMAP` on any of them
   selects a slot directly (a "select" key to the item).
5. With the item slot out of the cycle and an empty magazine, confirm it cannot fire by any button.
6. After a death and `$SPAWN`, does the pickup slot's magazine come back? (If it does, the phone zeroes it.)
7. Overshield: on a Standard-preset gun (shield max 0) and a Shields-preset gun, write the shield to its current
   value plus 75 with `$LIFE` token 4 = 2 (set past max). **Bench 2026-09-24, measured: the raw write does NOT
   stick past the `$PSET` shield max; `$HP` clamps back to the max within about 0.75 s.** A grant above the
   preset max holds only once a mid-life `$PSET` re-send raises the shield max first. A death clears it. Also:
   the same write to a gun at `$HP,0` must not revive it (mode 1 with health above 0 is a proven revive; mode 2
   is unmeasured).
8. Pickup range calibration (brx2's runbook): the RSSI median at 15, 30, 60 and 100 cm for each phone (Pixel,
   iPhone) against each station type (phone station, StickS3). It sets `POWERUP_RSSI_DBM` per station kind and
   decides whether a per-phone offset is needed. It also measures the claim latency (in range to TAKEN on the
   station).

## Bench 2026-09-24, Sitting A 3.3 (brx2, Tactix-FE30): what it changed

Measured on one gun, raw MCP writes (not the app). They overturn parts of the mechanism above; the build stays
behind the flag until the design catches up (open for Tony, S58).
- **Overshield set past max does NOT stick.** `$LIFE,45,70,75,2,*` echoes 75, then reads back 70 (the `$PSET` shield
  max) within 0.75 s; 60 holds. A mid-life `$PSET` re-send raising shield max 70 → 145 (nothing else changed) then
  holds 145 for over 100 s, and the gun still fires and ALT still cycles. Untested: being hit, and `spawned` across a
  hit and a death. Death clears it (145 → 0; the respawn gives 45/70/0).
- **`$BMAP,<btn>,<slot>,,,,,*` FIRES that slot on each press and does not move the trigger's weapon** (the trigger
  kept firing slot 1 after SELECT fired slot 2; the same for slot 3, outside the cycle). It fires even with the
  trigger blocked (`$BMAP,0,98`). `$BMAP,<btn>,100,<slot>,99,99,99` does NOT select a slot. Button ids: SELECT 3,
  left 4, right 5. The ALT cycle `$BMAP,1,100,0,1,2,99` goes 0 → 1 → 2, and a new `$BMAP` restarts it at the list start.
- **A respawn refills EVERY slot, item slots included**, so item slots must be re-emptied after each `$SPAWN`
  (compile's spawn and revive already write `$AMMO,<slot>,0,0,1` after `$SPAWN`). An empty slot cannot fire.
- **An empty slot stays in the ALT cycle** (ALT went 1 → 2, clicking empty, → 0): an ALT-cycle design must drop an
  empty item slot from the list, or keep item slots out of ALT.
- A mid-life `$AMMO` for another slot did not move the trigger's weapon (after `$AMMO,2,0,0,1` the trigger fired
  slot 1). OPEN: once, after the right button fired slot 2, the reload handle reloaded slot 2; whether reload targets
  the last slot fired needs a disassembly read.
- **Heavies straight on the trigger (Tony wants this; bench the same day, frames from `compile.resolve`).** A mid-life
  `$WEAP,<slot>,…` for a heavy makes it the trigger's weapon at once: rockets in slot 2 (`$WEAP` then `$AMMO`) and the
  rail in slot 3 (`$WEAP` only) both fired from the trigger; the rail keeps its charge behaviour. `$AMMO` alone never
  switches weapons. When the heavy runs dry, ALT goes to the NEXT slot in its own cycle (the pistol, not the AR). The
  switch-back works: re-send the primary's `$WEAP,0,…` (it equips and refills), then `$AMMO,0,<saved mag>,<saved
  reserve>,1,*`, and the trigger fires the AR with its real count. Untested: whether a `$WEAP` re-send resets
  per-weapon state beyond ammo (heat, the swap delay).

## Contract (A56, additive)

- **`StationAssignment.item?`** for kind `powerup`:
  `{kind: "weapon" | "overshield", weapon_id?, charges?, amount?, spawn_every_s, first_at_s, name, color}`.
  A weapon item grants `charges` rounds (the magazine) of `weapon_id`; an overshield grants `amount` shield.
  `spawn_every_s` (1-255) and `first_at_s` set the schedule on the match clock (below); `name` is at most 12
  characters (a Stick may marquee it); `color` is `#rrggbb`, the item's own colour, not a team. The same object rides
  in the player's `config.stations[]` entry (`{id, kind, item?}`), so a player's phone knows the schedule without MC.
- **`GameConfig.powerups?`**: `[{weapon_id, slot}]`, the pickup WEAPONS MC armed and where (compile's output; at
  most two, slots 2 and 3). An overshield needs no slot.
- **New fact `pickup`** from the player phone: `{match_id, station_id, item_kind, weapon_id?, t}`.
- **`station_update {id, available, next_spawn_in_ms?}`** from MC to the station, on a pickup, at each spawn time and
  on an operator reset, always with `next_spawn_in_ms` (the next spawn instant, even while available): the time REMAINING, since a Stick has no synced clock (agreed with brx4 for H8, 2026-09-24). The station
  advertises state 1 (available) or 0 (taken) and, while taken, the seconds to the next spawn in `value` (capped
  at 255). On a reconnect MC re-sends the current state and the station re-anchors on arrival. An older Stick
  ignores `item`.
- **`station_action {id, action: "reset" | "taken", player_num?, t}`** from a station to MC, live-only: an operator
  reset request, or the station's own record of who took the item (below).
- **The advert (utility.md §2):** the player advert gains state bit 4 `claiming` and bit 5 `claim_ready`, with the
  claimed station id in `value`; the station advert's reserved byte 15 becomes `taker` (the winner's
  `player_num`, 0 = none).

## Mission Control side (built 2026-09-24, behind `--powerups`)

- **The flag:** `python -m brx_mcp.mc --powerups`. Off (the default), MC refuses an `item_preset`, compiles no spare
  slot, sends no `item` and runs no schedule; an item restored from an old session is inert.
- **Defaults** live in one place, `mcp/brx_mcp/mc/powerups.py`: the three presets, the intervals, `OVERSHIELD_AMOUNT`,
  and the rules the phone mirrors (`LOST_AT_DEATH`, `WEAPON_PICKUP_SWAPS`, `OVERSHIELD_DECAY_PER_S`,
  `OVERSHIELD_REGEN`). Those rules are constants, not item fields.
- **Compile:** each distinct pickup weapon, ordered by station id, goes into slot 2 then 3 with its normal `$WEAP`
  tokens, and every spawn and revive writes `$AMMO,<slot>,0,0,1` for it. The ALT `$BMAP` row is not touched. The
  pickup weapons join the match's hit plan, so every gun's `$SIR` table covers their cells. A slot change after the
  lobby push re-pushes a fresh head to the whole roster.
- **Schedule:** MC's own tick, from `go_live_t`. At arm time each item station is told "taken, first spawn in N ms";
  at each spawn time "available"; on a `pickup` fact that took the item "taken, next spawn in N ms"; and the current
  state again when the station reconnects. The API is in `mcp/brx_mcp/mc/API.md` (`GET /api/powerups`, the
  station PUT, `StationView.item_available`/`next_spawn_at_ms`).

## The schedule (Tony, 2026-09-24: "like Halo")

Items spawn at fixed times on the match clock: at `first_at_s`, then every `spawn_every_s`. An item is available
from its spawn time until a player takes it; then the station is empty until the next spawn time. An item nobody
took simply stays; a spawn time never stacks a second one (Tony: only ever ONE item waiting at a station; the next spawn replaces it). Every phone and station can compute the schedule from
the match clock. The station itself decides who took an item (below) and advertises it, so every phone in range sees it taken.

## One item per station, locked for the match (Tony, 2026-09-24)

The host picks each powerup station's item at setup (the ITEMS panel), and it cannot change once the match is armed
(MC already refuses station changes in play). Nothing is random. One powerup station in play grants its one item on
its interval; two stations can hold different items and each follows its own schedule, so an Overshield station
and a Rockets station both spawn at 2:00. At most two different WEAPON items per game (spare slots 2 and 3); two
stations with the same weapon share its slot.

## Two kinds of powerup (Tony, 2026-09-24)

"You could pickup rockets and pickup overshield. You can't pickup the railgun and the rockets, if you tried it would
swap and you would only have 1."

- **Weapon pickups** (Rockets, Rail Gun, later the other heavies) share ONE pickup-weapon holding. Taking a second
  weapon SWAPS: the new one replaces the old, which is gone (not dropped for someone else; that is an idea for
  later). On the gun: zero the old slot's `$AMMO`, write the ALT cycle with the new slot, `$AMMO` the new slot with
  its charges. The HUD says it on the callout card: RAIL GUN replaces ROCKETS. **Bench 2026-09-24, measured: the
  pickup equips straight onto the trigger, with no extra write.** A mid-life `$WEAP,<slot>,…` for the new weapon
  plus its `$AMMO` write, sent in that order, fires it on the very next trigger pull; a mid-life `$WEAP` write
  alone, with no `$AMMO` sent, also equips the weapon on the trigger. `$AMMO` alone never switches the trigger's
  weapon. Switching back to the primary needs both writes in the same order: re-send its `$WEAP`, then its saved
  `$AMMO`. Reading: a re-armed slot's ALT position holds where it last was, not slot 0. Untested: whether a
  mid-life `$WEAP` re-send resets other per-weapon state, such as heat or swap delay.
- **Non-weapon powerups** (first: Overshield) stack alongside a held weapon pickup: Rockets and an Overshield
  together is fine.

**Overshield mechanics.** A positive `$BUMP` clamps at the `$PSET` maximum (protocol.md, the `$BUMP` row), so it
cannot put shield above max. The grant is `$LIFE` with token 4 = 2 (set past max) on the shield pool: current +
`OVERSHIELD_AMOUNT` (75). Design: it takes hits first (the gun's cascade drains shield before armour and HP), does
not regenerate (`OVERSHIELD_REGEN` off), does not decay (`OVERSHIELD_DECAY_PER_S` 0), and is gone at death. **Bench
2026-09-24 (Bench gate item 7), measured: the raw `$LIFE` write does NOT stick past the `$PSET` shield max; `$HP`
clamps back to the max within about 0.75 s.** The grant must pair a mid-life `$PSET` re-send that raises the shield
max, and only then does the `$LIFE` write hold. A death clears it. Untested: hits draining the shield first, and a
`$BUMP` refill on a gun already holding a raised max, so the recharge-rule design above remains a design intent,
not a bench-confirmed guard.

## Station powerup modes (Tony, 2026-09-24: "future variations wanted")

A powerup station's config is its item plus its schedule, set per game by MC. **Fixed** (the item and the Halo
schedule above) is the first mode Open BRX supports. Later modes are additive, for example a **random** station or
a game mode built around one: MC picks the item at each spawn time and sends it in `station_update` (a new optional
`item`), and phones and Sticks take it from there. The trade-off to design for then: with a fixed item every phone
knows what spawns when, even offline; with a random one a phone learns the item only from MC or the station's
advert, so an offline phone may announce "POWERUP AVAILABLE" without the item's name. Bluetooth closes most of that gap (Tony): while an item is
available the station's advert `value` is free (it is 0 in the fixed mode; it counts down only while the station is
taken), so a random station can put the current item's index there, from a small item table in the game config.
Any phone in Bluetooth range then reads what is sitting at the station with no MC contact.

## The spawn announcement (Tony, 2026-09-24)

At each spawn time every player's phone shows a HUD event on the callout card (QA-05's component): the item's name
and AVAILABLE, for example OVERSHIELD AVAILABLE, in the item's colour. It fires from the phone's own copy of the
schedule and the match clock, so it needs neither MC nor the station. It is skipped when the phone knows the item is
still sitting there untaken since the last spawn (the station's advert said available). Presentation only.

## The pickup: about 1 ft, 1 s, first come at the station (Tony, 2026-09-24)

"You need to be close to the pickup, within 1ft bluetooth range. Hold for 1s to get the powerup and then its taken
and unavailable until the next spawn." Tony then confirmed the hold means "standing in range for 1s": there is no
button, and the gun's buttons play no part.

1. **Range.** The player's phone judges it from the station advert's RSSI: the **median of the last 3 samples**
   (the scan samples each device at 4/s), so one wild packet neither grants nor blocks. In range means the median is
   at or above the station's threshold (advert byte 14). Out of range means below the threshold minus 3 dB. The respawn
   path keeps its EMA.
2. **Threshold.** RSSI differs by phone and by station hardware, so there are three layers. Each station kind has
   its own default (`POWERUP_RSSI_DBM`: a phone station -55, a StickS3 -58, both placeholders until the calibration
   step below). MC can override it (`StationAssignment.threshold`, 0 = the station's default). The station advertises
   the result in byte 14. If the calibration shows phones differing by more than 4 dB, the app gains a
   per-model offset table.
3. **Dwell.** In range continuously for `POWERUP_DWELL_MS` (1000). Leaving range resets it. The HUD shows a
   1 s progress ring and HOLD STILL.
4. **Claim.** The player advert (role 2) carries state bit 4 `claiming` while in range and bit 5 `claim_ready`
   after the dwell. Its `value` byte carries the claimed station id (a powerup station id is 1..255). While
   `claiming` is set the phone advertises in low-latency mode (about 100 ms on Android), otherwise balanced.
5. **The station decides.** It is the one party that hears every claimant (a phone station and a Stick alike). It
   awards the item to the **first** player advert it hears with `claim_ready` for its own id while the item is
   available. A tie inside one scan batch goes to the lower `player_num`. It ignores a claim it hears below
   `CLAIM_FLOOR_DBM` (-80), which limits cross-talk and a cheap spoof. Its screen shows a 1 s ring from the first
   `claiming` advert, for display only.
6. **Taken.** The station advertises state 0, `value` = the seconds to the next spawn (capped at 255), and byte 15
   `taker` = the winner's `player_num` (1..63, 0 = none) until the next spawn. It reports
   `station_action {id, action: "taken", player_num, t}` to MC (best effort).
7. **The grant.** A phone applies the item only when the station's advert shows `taker` equal to its own
   `player_num` and it was `claim_ready` for that station. It then sends the `pickup` fact (queued, so it is the
   reliable record; MC dedupes it against the station's report by station and spawn). A loser's HUD says TAKEN BY
   <name>. A phone that is ready for 3 s with no answer says STATION NOT ANSWERING.
8. **Unavailable until the next spawn.** The next spawn is the fixed schedule above, not a cooldown from the
   moment of taking (Halo). MC's `station_update` always carries `next_spawn_in_ms` (the time to the next spawn
   instant, even while available). The station counts it down itself, spawns at 0 and then every `spawn_every_s`,
   and re-anchors on every update, never spawning one instant twice. A lost MC link therefore does not freeze a station.

The HUD walks GET CLOSER → HOLD STILL (the ring) → <ITEM> READY, and the item then shows beside the ammo with its
charges. An unavailable station shows its countdown.

**Security posture** is unchanged from `utility.md` §3: adverts are unauthenticated. A second phone advertising
`claim_ready` could take an item from across the field if the station hears it above the floor. That is the same
casual-threat trade-off as the respawn station.

## Operator reset (Tony, 2026-09-24)

A Stick's buttons are for the MC operator only (view stats, reset the station), never for players. The operator
reset makes the item available **now**. It comes from the Stick (a 2 s long press plus an on-screen confirm) or from
the MC console (RESET on the station's card, `POST /api/stations/{node_id}/reset`). The station sends
`station_action {id, action: "reset", t}` (live-only) and applies nothing until MC answers with
`station_update {available: true, next_spawn_in_ms}`, so MC stays the source of truth. Offline, the Stick says
RESET NEEDS MISSION CONTROL. The schedule keeps its fixed times; the next spawn instant finds the item taken or
still there (no stacking). MC logs OPERATOR RESET · STATION #<id> and records it on the board. Agreed with brx4.

## Items and defaults (Tony, 2026-09-24)

Decided:
- **Items:** Rockets (rocket_launcher), Rail Gun (rail_gun), and Overshield.
- **Schedule:** Overshield every 60 s, the heavies every 120 s, each first spawning after one interval (1:00 and
  2:00), on the match clock.
- **Overshield:** +75 shield on top of whatever the player has, taking hits first, no regeneration, gone at death
  (`$LIFE` shield add past the preset's max, bench step below). In the Shields preset the regenerating shield only
  refills up to its own max, so it never tops the overshield back up.

Defaults still to confirm (named constants, easy to change):
- **Charges:** `item.charges` is the rounds granted to the player who takes it (the magazine, no reserve), never a count of pickups left: a station holds at most one item. MC decides it per game, in the item it sends. The default is the weapon's own magazine (Rockets: 2) until a balance decision (Tony, 2026-09-24: "2 rockets, or 4 shots"); an operator control to change it is later. The Stick shows no charges count.
- **Lost at death:** a weapon item's unused charges do not carry into the next life.
- *(decided, see below: a second weapon SWAPS.)*
