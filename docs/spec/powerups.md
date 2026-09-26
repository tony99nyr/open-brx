# Powerups: a station grants an item (design, 2026-09-24)

Status: **BUILT, ON by default (F372, Tony 2026-09-25: "rockets, railgun, overshield as powerup/pickups. yes
lets enable them").** `--no-powerups` is the opt-out. Sitting A's slot and button checks ran on 2026-09-24
(bench 3.3, below); steps 3.4, 3.5 and 4.11 remain as verification, not as a condition for the default.
Tony's model: a station (a utility phone or an M5Stick) is assigned a kind and its data by Mission Control
(MC) per game. A powerup station grants an item, for example a pickup-only heavy (rockets). Contract row: A56.
Roadmap entry it replaces: K3 in `docs/utility-roadmap.md`; the station half of S46.

## The mechanism: armed at start, straight onto the trigger

Tony, 2026-09-24: "straight to trigger. id prefer trigger fires it", then "select should equip it if possible". A
picked-up heavy (Rockets, Rail Gun) goes onto the trigger at once. The player needs no button to reach it.

A mid-match config re-push to a live gun clears `spawned` and silences it for the rest of the match
(`utility.md` §5g.6), so a pickup must never re-arm the gun. Instead the phone writes small mid-life frames:

1. **At arm time** MC compiles the game's pickup weapon into a spare gun slot with its normal `$WEAP`: slot 2 for
   the first powerup weapon, slot 3 for a second. Every spawn and revive writes `$AMMO,<slot>,0,0,1` for it, so the
   slot is empty. The ALT `$BMAP` row is not touched: a heavy is never in the ALT cycle.
2. **The grant.** The phone saves the slot the trigger is on and its magazine and reserve (from its `$ALCD`
   account). Then it re-sends the pickup slot's head `$WEAP` verbatim, which equips it on the trigger (bench
   2026-09-24), then `$AMMO,<slot>,<charges>,0,1,*`. The grant writes no `$BMAP`, so an Easy Reload player is granted
   like anyone.
3. **A second heavy swaps.** The phone zeroes the old slot's `$AMMO`, then writes the new slot's `$WEAP` and `$AMMO`.
   The switch-back target stays the loadout weapon. The HUD says RAIL GUN, REPLACES ROCKETS.
4. **SELECT toggles** (`$BUT,3,1`, a press; the release, which `$PHONE` also sends, never acts). On the heavy, SELECT
   saves its charges left and re-sends the saved weapon's `$WEAP` plus its saved `$AMMO`. On the loadout weapon, SELECT
   saves that weapon's counts and re-sends the heavy's `$WEAP` plus `$AMMO` with its charges left. The phone does the
   equip, because a native `$BMAP` fires a slot and never equips it. SELECT stays at the head's `$BMAP,3,98`. SELECT is
   ignored with no heavy held, while dead, stunned or reconciling, while an ALT swap is pending, and inside
   `PU_SELECT_DEBOUNCE_MS` (400) of the last one.
5. **ALT keeps its job.** If ALT moves the trigger off the heavy, the heavy keeps its charges and SELECT brings it
   back. The phone tracks the trigger's slot from `$ALCD`; melee's slot 4 does not count as leaving the heavy.
6. **The end, when the heavy's magazine reaches 0** (its `$ALCD`). The phone re-sends the saved slot's head `$WEAP`,
   then `$AMMO` with the saved magazine and reserve. The HUD shows ROCKETS EMPTY, BACK TO <WEAPON> briefly.
7. **A death with the heavy held.** The item is lost (`LOST_AT_DEATH`). Compile's revive re-empties the pickup slot.
   The trigger's slot after `$SPAWN` is unproven, so after the revive burst the phone re-sends slot 0's head `$WEAP`
   and the burst's own `$AMMO,0,…` row (a safe re-equip). An operator respawn of a live player does the same.
8. **A reconcile** (a BLE relink) disarms the held heavy's slot with slots 0 and 1, and the re-arm carries the heavy's
   charges in place of its spawn zero row, in the same write (a separate write let the gun's echo of 0 end the item).
   A switch-back the gun does not answer with an `$ALCD` for that slot is re-sent every 1.5 s (3 times at most), and
   SELECT re-sends it at once.
9. **Persisted:** the held item, its saved switch-back slot and counts, the trigger's slot, and a pending slot-0
   re-equip. An app restart mid-item still switches back correctly.

The HUD's grant hint is `<ITEM> ON TRIGGER` with the shots (for example 2 SHOTS). The held chip beside the ammo shows
the heavy, its charges and SELECT on one line, lit while the heavy is on the trigger. Everything stays behind the
powerups flag. The overshield is unchanged by this section.

**F403 (2026-09-25):** the BRIEFING screen (`app/src/hud/hud.js _briefing`) adds one PICKUPS line, naming each
distinct item the game's powerup stations carry (the same station config `engine.js _puItems()` reads), in station
order and each in its own colour by day, collapsing to the one night accent at night; a game with no items shows
no line. Storyboard: `C:\Users\Tony\brx-brief-pickups`, awaiting Tony's look.

**Decided by the lead, 2026-09-24, then overridden the same day:** a first draft blocked ALT (`$BMAP,1,98`) while the
heavy was on the trigger. Tony's SELECT decision dropped the block: ALT keeps its normal job.

## Bench gate (verification, not a condition for the default)

**Powerups are ON by default** (Tony, 2026-09-25: "rockets, railgun, overshield as powerup/pickups. yes lets
enable them", FOLLOWUPS F372). This section's steps are no longer a gate on the default; they stay as the bench
plan that verifies the mechanism and calibrates the claim thresholds. Items 1 to 6 ran at bench 3.3 on 2026-09-24
(the next section), and so did item 7's clamp and death checks. Open: item 7's hit and dead-gun cases, item 8
(`bench-2026-09-24.md` step 4.11, the claim calibration for a phone station and the Stick) and item 9 (steps 3.4
and 3.5), plus the claim race and the respawn (step 11.2). Step 11.3 gives the order. Once those steps pass, the
calibrated thresholds replace the placeholders (`POWERUP_THRESHOLD_DEFAULT`, `beacon.js POWERUP_RSSI_DBM`, the
Stick's -57).

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
   is unmeasured). Built 2026-09-24 as the grant burst in "Overshield mechanics" below; its open checks are there.
8. Pickup range calibration (`bench-2026-09-24.md` step 4.11): the RSSI median at 15, 30, 60 and 100 cm for each
   phone (Pixel, iPhone) against each station type (phone station, StickS3). It sets the pickup threshold per station kind and
   decides whether a per-phone offset is needed. It also measures the claim latency (in range to TAKEN on the
   station).
9. **The trigger flow (Tony, 2026-09-24):** (a) does a mid-life `$WEAP` re-send reset per-weapon state beyond ammo
   (heat, the swap delay)? (b) Which slot is on the trigger after a `$SPAWN`, with the heavy on it at the death? (The
   phone re-equips slot 0 either way.) (c) Does the gun report `$BUT,3,1` while SELECT is mapped `$BMAP,3,98`
   (blocked)? If it does not, SELECT needs a direct map (for example `$BMAP,3,<a spare fn>`) that the gun reports but
   that fires nothing, and this section changes. (d) The flow end to end: bench-2026-09-24 step 3.4.

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

## Mission Control side (built 2026-09-24, on by default since F372)

- **The flag:** powerups are on by default (`python -m brx_mcp.mc`); `--no-powerups` turns them off. `--powerups`
  is still accepted, as a no-op, so an old command line does not break. With powerups off, MC refuses an
  `item_preset`, compiles no spare slot, sends no `item` and runs no schedule; an item restored from an old
  session is inert.
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

- **Weapon pickups** (Rockets, Rail Gun, later the other heavies) share ONE pickup-weapon holding. Taking the same
  weapon adds its charges to the charges left and puts it back on the trigger, with no replacement card. The stack caps at twice the item's own charges (`PU_STACK_CAP_X`; Tony, 2026-09-25: "double the drop is max"), so Rockets (2) hold at most 4.
  Taking a different weapon SWAPS: the new one replaces the old, which is gone (not dropped for someone else; that is an idea for
  later). On the gun: zero the old slot's `$AMMO`, then the new slot's head `$WEAP` and its `$AMMO` with the charges
  (the mechanism above). The HUD says it on the callout card: RAIL GUN replaces ROCKETS. **Bench 2026-09-24, measured: the
  pickup equips straight onto the trigger, with no extra write.** A mid-life `$WEAP,<slot>,…` for the new weapon
  plus its `$AMMO` write, sent in that order, fires it on the very next trigger pull; a mid-life `$WEAP` write
  alone, with no `$AMMO` sent, also equips the weapon on the trigger. `$AMMO` alone never switches the trigger's
  weapon. Switching back to the primary needs both writes in the same order: re-send its `$WEAP`, then its saved
  `$AMMO`. Reading: a re-armed slot's ALT position holds where it last was, not slot 0. Untested: whether a
  mid-life `$WEAP` re-send resets other per-weapon state, such as heat or swap delay.
- **Non-weapon powerups** (first: Overshield) stack alongside a held weapon pickup: Rockets and an Overshield
  together is fine.

**Overshield mechanics (Tony, 2026-09-24: "in halo if you get hit while you are getting overshield the damage is
ignored").** A positive `$BUMP` clamps at the `$PSET` maximum, and the bench showed a raw `$LIFE` set past the max
clamps back within 0.75 s. A mid-life `$PSET` re-send that raises ONLY the shield max (70 → 145) then holds a
`$LIFE,…,145,2` for over 100 s, and the gun still fires and cycles ALT. So the grant is one burst, in this order:

1. spawn protection on (`$TMP` t8 = -100, the frame compile's spawn and revive use);
2. the node's current `$PSET` (the life's `pset_pool` take, else the head's) with only the shield max changed, to the
   new shield, never below the preset max (the Standard preset at shield 0 gets 75);
3. `$LIFE,<hp>,<armour>,<current shield + amount>,2,*`, at the pools as they stood when the station named the player.

`OVERSHIELD_GRANT_MS` (1000) later the phone writes `spawn_protect_off`. A hit inside the window does no damage, and a
hit in flight before it is overwritten by the absolute `$LIFE`: the damage is ignored. A lower `$HP` inside the window
is a pre-grant hit reported late, so it does not end the overshield. The phone never grants to a gun at 0 health (an
absolute `$LIFE` there could revive it), nor while a `$HIR` has arrived with no `$HP` after it (up to 1 s: a lethal
hit in flight must stand); the claim stays warm and the grant goes out once the `$HP` is in. A life still inside its
own spawn protection keeps it: the grant writes no `$TMP` then. A lost protection-off write is retried on the next
tick, and MC's status reads `protected` for the whole window (F289). The `$PSET` restore is retried once.

The overshield takes hits first (the gun's cascade drains shield before armour and HP), does not regenerate
(`OVERSHIELD_REGEN` off; the S29 recharge writes nothing while it is up), and does not decay
(`OVERSHIELD_DECAY_PER_S` 0). When it is gone, drained back to its base, the phone re-sends the `$PSET` at the preset
shield max, so a later refill or spawn cannot fill to the raised one. At a death the revive burst's own `pset_pool`
`$PSET` lands before its `$SPAWN` at the preset max; an older bundle without one gets the preset `$PSET` at the death.
Everything is behind the powerups flag.

Bench items (step 3.5 of `docs/bench-2026-09-24.md`): a hit on the raised max drains the overshield first; `spawned`
survives a hit and a death after a mid-life `$PSET`; spawn protection covers the grant (a hit inside the window does
nothing); and the burst order: does `$TMP` t8 = -100 sent BEFORE the `$PSET` survive it, or does a mid-life `$PSET`
reset `$TMP` the way `$SPAWN` does? (If it does, protection goes after the `$PSET`.) The heat reset on a `$WEAP`
re-send is Bench gate item 9a. Two more: does a `$PSET` that lowers the shield max below the current
shield clamp the shield down at once (the drain restore assumes nothing is above the preset max by then)? And at a
death with no `pset_pool` in the revive, the preset `$PSET` goes out while the gun is dead: does it take, or does the
revive's `$SPAWN` refill the shield to the raised max? (Today's bundles all carry a `pset_pool`, so this is the older
bundle's case.)

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
2. **Threshold.** RSSI differs by phone and by station hardware, so there are three layers. The player phone
   judges a pickup against the station's byte 14, and falls back to `POWERUP_THRESHOLD_DEFAULT` (-55, `engine.js`, a
   placeholder until the calibration step) only when that byte is 0. MC can override the station's value
   (`StationAssignment.threshold`, 0 = the station's own default). A powerup PHONE station at threshold 0 advertises
   its own claim default, -55 (`beacon.js POWERUP_RSSI_DBM.phone`; fixed 2026-09-24, it used to advertise the -74 of
   other kinds), and MC sends -55 explicitly to a phone app older than 0.4.12. A StickS3 still advertises its one
   station default, -57, which is close. The HUD's "near" hint (GET CLOSER) starts
   `PU_NEAR_DB` (10) under the threshold, so at -55 it shows within about 1-2 m. If the calibration shows phones differing by more than 4 dB, the app gains a
   per-model offset table.
3. **Dwell.** In range continuously for `POWERUP_DWELL_MS` (1000). Leaving range resets it. The HUD shows a
   1 s progress ring and HOLD STILL.
4. **Claim.** The player advert (role 2) carries state bit 4 `claiming` while in range and bit 5 `claim_ready`
   after the dwell. Its `value` byte carries the claimed station id (a powerup station id is 1..255). While
   `claiming` is set the phone advertises in low-latency mode (about 100 ms on Android), otherwise balanced.
5. **The station decides.** It is the one party that hears every claimant (a phone station and a Stick alike). It
   awards the item to the **first** player advert it hears with `claim_ready` for its own id while the item is
   available. A phone station breaks claims in one tick by lower `player_num`. A StickS3 awards the first ready advert it hears and breaks equal-millisecond ties by lower `player_num`.
   **No RSSI floor** (Tony, 2026-09-24, pickups placed outside Wi-Fi range must work offline): the phone's
   `claim_ready` already proves it met the station's advertised threshold for 1 s by its own reading of the station's
   strong advert, while a station hears player adverts 20-30 dB weaker and sparsely (the StickS3 bench), so the old
   -80 dBm floor refused legitimate claims. Its screen shows a 1 s ring from the first
   `claiming` advert, for display only.
6. **Taken.** The station advertises state 0, `value` = the seconds to the next spawn (capped at 255), and byte 15
   `taker` = the winner's `player_num` (1..63, 0 = none) until the next spawn. It reports
   `station_action {id, action: "taken", player_num, t}` to MC (best effort).
7. **The grant.** A phone applies the item only when the station's advert shows `taker` equal to its own
   `player_num` and it was `claim_ready` for that station. It then sends the `pickup` fact (queued, so it is the
   reliable record; MC dedupes it against the station's report by station and spawn). **A loser's HUD says
   nothing** (F425, below: the HUD never names who took a station, or that it was taken at all). A phone that is
   ready for 3 s with no answer still says STATION NOT ANSWERING (that is a claim failure, not a taken report).
8. **Unavailable until the next spawn.** The next spawn is the fixed schedule above, not a cooldown from the
   moment of taking (Halo). MC's `station_update` always carries `next_spawn_in_ms` (the time to the next spawn
   instant, even while available). The station counts it down itself, spawns at 0 and then every `spawn_every_s`,
   and re-anchors on every update, never spawning one instant twice. A lost MC link therefore does not freeze a station.

The HUD walks GET CLOSER → HOLD STILL (the ring) → <ITEM> READY, and the item then shows beside the ammo with its
charges. **A taken (cooling) station shows nothing** on the claiming player's HUD (F425, below).

**Security posture** is unchanged from `utility.md` §3: adverts are unauthenticated. A second phone advertising
`claim_ready` could take an item from anywhere the station can hear it, since the claim has no RSSI floor (item 5).
That is the same casual-threat trade-off as the respawn station.

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
  (the grant burst in "Overshield mechanics" above; a raw `$LIFE` past the preset's max clamps back, bench 3.3). In the Shields preset the regenerating shield only
  refills up to its own max, so it never tops the overshield back up.

Defaults still to confirm (named constants, easy to change):
- **Charges:** `item.charges` is the rounds granted to the player who takes it (the magazine, no reserve), never a count of pickups left: a station holds at most one item. MC decides it per game, in the item it sends. The default is the weapon's own magazine (Rockets: 2) until a balance decision (Tony, 2026-09-24: "2 rockets, or 4 shots"); an operator control to change it is later. The Stick shows no charges count.
- **Lost at death:** a weapon item's unused charges do not carry into the next life.
- *(decided, see above: the same weapon adds charges; a different weapon SWAPS.)*

## The switch card (F400, 2026-09-25)

Tony, 2026-09-25: "we need a louder rockets have the trigger alert on hud. that is pretty small. we probably need
the switching screen like the alt button. players need to know their active switched." Before this, a powerup
weapon landing on the trigger showed only the small hint chip (`<ITEM> ON TRIGGER`, "The mechanism" above). Built:

1. **A weapon item landing on the trigger** (the first grant, and a same-weapon stack that re-equips it) shows the
   same full weapon-switch card an ALT press shows, with ALT's own timing. The tile names the pickup weapon; the
   item's colour is an accent (a ring round the icon, never overriding the STOWING/DRAWING/ACTIVE state colour) and
   its charges show on the card (`app/src/hud/hud.js` `_wtile`'s `.wc` badge).
2. **Every SELECT toggle**, both directions (to the heavy, and back to the player's own weapon), plays the same
   card. The switch-back when the heavy's charges run out also plays it, naming the player's own weapon on the
   ACTIVE tile.
3. **While the card is up, the small hint chip is hidden** for a weapon grant or a switch-back (`_puHint`'s own
   `granted`/`switched_back` kinds); the held chip beside the ammo is untouched. The hint still computes the same
   way underneath, so it resumes for whatever is left of its own window once the card has gone.
4. **Clash (Tony's final call, 2026-09-26):** "Not stacked. The weapon switch overlay is on top. When it finishes
   then the rest of ui is shown. Events and streaks show. Anything which has a temporary show should have their timer
   adjusted since the user was in that overlay. This should be true for regular alt weapon switches too." The card
   is SWITCHING and then its ACTIVE bubble, for ALT and every pickup equip alike. While it is up, the alert lanes are
   hidden and their clocks stop: a kill card, a feed row and a badge each get their full time once it leaves, and an
   event that arrives under it shows afterwards. The persistent lead badge hides too (Tony, 2026-09-26: "yes it should
   behave like the KC and events"). See `docs/announcer.md` "Layering and priority on the phone HUD".
5. **The Overshield is not a weapon: no switch card, ever.** Its grant already animates the shield bar (the
   existing gain animation on `.svos`, `shieldmeter.js`) via the same width transition a hit's drain uses; it now
   also plays the shield-recharge sound again -- `_announceStatus('shield_charging')`, the exact clip the ordinary
   S29 recharge plays on its first grant (N102 in the golden bundle; F349: no separate "Shields Online" voice).
6. **No new voice lines.** VA56 ("Rocket Launcher!"), VX0S ("Weapon Swap") and V130 ("Overshield") from the F400
   FOLLOWUPS row's AUDIO panel are unaudited community labels and stay out of scope.
7. **The ACTIVE bubble's sub-line reads CONFIRMED for a pickup switch, never READY nor CONFIRMED BY YOUR GUN**
   (desk fix, 2026-09-26). `_puSwitchCard` sets `this.switching.pu = true` precisely so a pickup equip is
   display-only for `_onAmmo`'s confirm-by-shot code (below): the card can never close early on the gun's own
   echo, so it always reaches the ACTIVE bubble by way of the tick's assumed-timeout. For an ALT swap that path
   means "we never got a shot to prove it, but the window has passed" -- an honest guess, so the bubble says
   READY. A pickup switch is not a guess: the phone's own equip write (`_puEquip`) already settled the trigger
   before the card even opened, so `assumed: true` on this moment's data is true only in the sense of "closed by
   the timer", not "unproven". READY would undersell that; CONFIRMED BY YOUR GUN would claim a mechanism
   (the gun's echo) that this path deliberately never uses. CONFIRMED, on its own, is the state the bubble now
   shows (`hud.js` `_switched`, keyed on a new `pu` flag the moment's `data` carries alongside `assumed`).

Engine mechanism: `_puSwitchCard(from, to, going?)` sets `this.switching = {at, from, to, pu: true}`, the SAME
`at`/`from`/`to` shape an ALT press sets (`engine.js` around the `$BUT,1,1` handler), plus the `pu` flag. `_onAmmo`'s
confirm-by-shot code explicitly excludes a `pu` switch (`this.switching && !this.switching.pu`, so it can only ever
close on the tick's assumed-timeout, never early on the gun's echo of the equip write itself -- decision 7 is why
that is the right call, not a gap. `going` is `{name, color, weapon_id, charges}` for a slot about to lose its
identity this call (the empty switch-back's heavy, whose `_puHeld` is cleared before the equip): the HUD's tile
still needs to name it on the render after that, so it rides on `state().powerup.going` until the card's own
window has passed. The tick's assumed-timeout path never lets a pickup slot (2 or 3) become `_altPtr`: that field
is the gun's OWN ALT-cycle position (always 0 or 1), and a powerup equip never touches ALT's `$BMAP` row (see
"The mechanism" above).

The STOWING/DRAWING/ACTIVE label (`.wt .wl`, shared with ALT's own card) rendered at 10px, under the 11px type
floor (desk fix, 2026-09-26): raised to 11px in `www/index.html`. The tile is 220px wide with plenty of headroom,
so the extra pixel does not wrap or clip either tile at either phone width.

Not built: the AUDIO panel's voice lines (decision 6). The bench check and the unbuilt voice lines are still open on
the F400 row (`docs/FOLLOWUPS.md`).

## The near-station hint drops its countdown and TAKEN state (F425, Tony's decision, 2026-09-26, option A)

Prompted by a multi-pickup display question (the old hint showed only the nearest or claiming station's timer,
and could flip between stations at equal range): "idk if we need the pickups timer on hud the whole time... use
the left-side game alert 'X AVAILABLE' when a pickup spawns." Storyboard: `C:\Users\Tony\brx-pickup-alert`, three
options; Tony picked **A**, the plain one: drop the always-on countdown and the TAKEN hint, add nothing new.

**Tony's rationale:** "Halo never told you it was taken or who took it. I think not knowing is better for
gameplay." The HUD never reports that a pickup was taken, or who took it -- not as a countdown, not as a name,
not in any form. This also answers the multi-pickup display question: each spawn gets its own left-side alert,
never a shared timer.

**What changed.** The near-station hint (`_puHint`, `#puhint`) drops its `taken` and `taken_by` states outright:
standing near a station that is not there to claim now shows nothing, where it used to show `<ITEM> TAKEN · 0:52`
or `<ITEM> TAKEN · BY <name>` counting down to the next spawn. `engine.js`'s `powerupView()` no longer computes
either kind (and its `_puNextInMs` helper is gone with them); `hud.js`'s `_puHint` no longer renders them. The
CSS rule that sized their text (`app/www/index.html`) is gone too.

**What is unchanged.** The at-station claim feedback -- GET CLOSER, HOLD STILL / CONFIRMING (the 1 s ring),
STATION NOT ANSWERING, and the grant's `<ITEM> ON TRIGGER` / `PICKED UP` -- is exactly as it was: none of that
names a taker or counts down a cooldown, so F425 does not touch it. The left-side "`<ITEM> AVAILABLE` · AT
STATION N" feed alert at every spawn (4 s, `docs/announcer.md`) is also unchanged: it was already the sole
spawn signal (`docs/spec/powerups.md` "The spawn announcement", above) and stays that way. The wire (the
station's own advert state/`taker`/countdown byte, `station_update`'s `next_spawn_in_ms`, `station_action
{action: "taken", ...}` to MC) is unchanged: the station still decides and reports who took its item, MC's board
still names the taker for the operator, and a station's own on-device screen (`utility.js`) still shows its own
TAKEN/NEXT state -- none of that is the claiming player's phone HUD, which is the only surface this row touches.
