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
   value plus 75 with `$LIFE` token 4 = 2 (set past max). Pass: `$HP` reads the new shield; the next hits take the
   shield first; nothing refills it; a death clears it.

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
- **`station_update {id, available, next_spawn_in_ms?}`** from MC to the station, on a pickup and at each spawn
  time: the time REMAINING, since a Stick has no synced clock (agreed with brx4 for H8, 2026-09-24). The station
  advertises state 1 (available) or 0 (taken) and, while taken, the seconds to the next spawn in `value` (capped
  at 255). On a reconnect MC re-sends the current state and the station re-anchors on arrival. An older Stick
  ignores `item`.

## The schedule (Tony, 2026-09-24: "like Halo")

Items spawn at fixed times on the match clock: at `first_at_s`, then every `spawn_every_s`. An item is available
from its spawn time until a player takes it; then the station is empty until the next spawn time. An item nobody
took simply stays; a spawn time never stacks a second one. Every phone and station can compute the schedule from
the match clock; MC's `pickup` relay tells the station (and so every phone, through the station's advert) that an
item was taken early.

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
  its charges. The HUD says it on the callout card: RAIL GUN replaces ROCKETS.
- **Non-weapon powerups** (first: Overshield) stack alongside a held weapon pickup: Rockets and an Overshield
  together is fine.

**Overshield mechanics.** A positive `$BUMP` clamps at the `$PSET` maximum (protocol.md, the `$BUMP` row), so it
cannot put shield above max. The grant is `$LIFE` with token 4 = 2 (set past max) on the shield pool: current +
`OVERSHIELD_AMOUNT` (75). It takes hits first (the gun's cascade drains shield before armour and HP), does not
regenerate (`OVERSHIELD_REGEN` off), does not decay (`OVERSHIELD_DECAY_PER_S` 0), and is gone at death. In the Shields
preset the node's own recharge (S29, `$BUMP` refills) must never write while the shield is above the preset max, so
a clamping refill cannot cut the overshield down. Bench (Bench gate item 7): the shield set past max sticks; hits
drain it first; a `$BUMP` shield refill on a gun already above max does not lower it (so the recharge rule is
belt-and-braces, not load-bearing).

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

## The grant on the phone

Presence (the existing `Presence` tracker, the station's own threshold byte), then the trigger: the same gate as a
station respawn, so a player walking past does not take an item by accident. The HUD hint walks
GET CLOSER → PULL THE TRIGGER FOR <ITEM> → <ITEM> READY, and the item then shows beside the ammo with its charges.
A depleted station shows its cooldown. Offline (no MC relay), the phone keeps its own per-station cooldown for
this player.

## Items and defaults (Tony, 2026-09-24)

Decided:
- **Items:** Rockets (rocket_launcher), Rail Gun (rail_gun), and Overshield.
- **Schedule:** Overshield every 60 s, the heavies every 120 s, each first spawning after one interval (1:00 and
  2:00), on the match clock.
- **Overshield:** +75 shield on top of whatever the player has, taking hits first, no regeneration, gone at death
  (`$LIFE` shield add past the preset's max, bench step below). In the Shields preset the regenerating shield only
  refills up to its own max, so it never tops the overshield back up.

Defaults still to confirm (named constants, easy to change):
- **Charges:** a weapon item's own magazine (Rockets: 2), no reserve.
- **Lost at death:** a weapon item's unused charges do not carry into the next life.
- *(decided, see below: a second weapon SWAPS.)*
