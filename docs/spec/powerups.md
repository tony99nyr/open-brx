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

## Contract (A56, additive)

- **`StationAssignment.item?`** for kind `powerup`: `{weapon_id, charges, cooldown_s, name, color}`.
  `charges` is the magazine granted; `cooldown_s` (1-255, so the advert's one-byte `value` can count it down) is how
  long this station stays depleted after a grant; `name` is at most 12 characters (a Stick may marquee it); `color`
  is `#rrggbb`, the item's own colour, not a team.
  The same object rides in the player's `config.stations[]` entry for that station (`{id, kind, item?}`), so a
  player's phone knows what a station grants without MC.
- **`GameConfig.powerups?`**: `[{weapon_id, slot}]`, the pickup weapons MC armed and where (compile's output;
  at most two, slots 2 and 3).
- **New fact `pickup`** from the player phone: `{match_id, station_id, weapon_id, t}`. MC relays a
  `station_update {id, depleted_for_ms, depleted_until?}` to the station: the time REMAINING (a Stick has no synced
  clock), with the epoch as an optional extra. The station advertises state 0 (depleted) and the seconds left in
  `value`, then state 1 again. On a reconnect MC re-sends the current state and the station re-anchors on arrival.
- The Stick (H8) takes the same `station_config` and `station_update`; brx4 builds its client on this payload
  (agreed 2026-09-24). An older Stick ignores `item`.

## The grant on the phone

Presence (the existing `Presence` tracker, the station's own threshold byte), then the trigger: the same gate as a
station respawn, so a player walking past does not take an item by accident. The HUD hint walks
GET CLOSER → PULL THE TRIGGER FOR <ITEM> → <ITEM> READY, and the item then shows beside the ammo with its charges.
A depleted station shows its cooldown. Offline (no MC relay), the phone keeps its own per-station cooldown for
this player.

## Defaults for Tony to confirm (game rules)

- **Items:** the `pickup_only` heavies (rocket launcher, rail gun, and so on); one item per powerup station.
- **Charges:** the item's own magazine (rockets: 2), no reserve.
- **Cooldown:** 60 s per station after a grant.
- **Lost at death:** yes; unused charges do not carry into the next life.
- **One item at a time per player:** a second grant while holding one is refused.
