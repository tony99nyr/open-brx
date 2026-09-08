"""A17 HIT AUDIO — what a hit SOUNDS like to the player who took it.

Tony, 2026-09-07: *"metal/armor hitting sounds when the players have armor and only use the character
hit sounds when real health is taken down"* … *"use a variety of hit sounds based on the weapon hit
with. dynamic and immersive, not repetitive"*.

Three layers stack on one registered hit. They are ORTHOGONAL — different tables, different keys —
which is why we can have both "what hit me" and "what it bit into" without a 22x3 matrix:

  MATERIAL   `$PSET` hitHp / hitArrmor / hitShield / hitCrit  ->  WHICH POOL the hit bit into.
             Four positional slots the firmware already branches on; we shipped Callsign's inherited
             ids (`H55 H13 H21 H02`) in every game, all four generic `fx:hit`. Chosen here instead.
  CLASS      `$SIR,<proto>,<sub>,<soundID>,...`                ->  WHICH WEAPON fired it.
             The row's sound plays on the VICTIM when the row fires (brx-protocol.md §5), and the row
             is keyed by the shooter's `$WEAP` tok3/tok4. Weapon-specific, zero latency, firmware-side.
  CHARACTER  the node's own pain grunt (`engine.js _pain`, A15.3)  ->  only when real HEALTH went down
             (A17.1). Short vs long still by damage, from the character's pain pools, as before.

**Why the class layer was silent.** 22 catalogued weapons collapse into 8 `$SIR` cells, and NINE of
them -- AR, SMG, shotgun, stinger, plasma sniper, suppressor, energy rifle, laser cannon, ion sniper --
all key `<0,0>`, whose sound token ships EMPTY. Six more share `<0,3>`. So for most of the arsenal the
victim heard no weapon flavour at all, and a shotgun to the chest was byte-identical to a suppressor.
`$WEAP` tok3/tok4 are freely settable (bench-proven, protocol §6) and all 64 cells are writable per
game, so MC re-keys the weapons ACTUALLY IN THE MATCH onto distinct cells and gives each its own row.

⚠️ **Re-keying is a loaded gun.** An unmatched `$SIR` cell is SILENTLY IGNORED — no `$HIR`, no damage,
the same failure mode as F11. A weapon may only be moved off its stock cell when every gun in the
match gets the matching row, and the row must carry the weapon's EXISTING function so damage does not
move. `compile.assert_sir_covers_weapons` enforces both; nothing here is safe on its own.

**Variety without latency.** We do NOT play a sound per hit over BLE — a hit sound arriving a BLE round
trip late is not a hit sound (the A15.3 finding that kept the death scream in firmware). Instead the
pools are rolled and RE-WRITTEN BETWEEN hits: the node writes a fresh `$PSET` / `$SIR` set before every
`$SPAWN` and again after a lull, so the firmware always fires instantly from a freshly-drawn id. Both
re-writes are bench-safe: re-sending `$PSET` mid-game keeps `$SIR`, does not heal, and the gun still
fires (2026-09-06); re-sending `$SIR` rows is the F11 REPAIR path.

**BENCH-PROVEN 2026-09-07** (Tony at the bench, one Tactix2, `$PLAY` audition + live IR hits). What the
hardware settled, including the things it settled against me:

  1. **The `$PSET` foot order IS the APK's.** hitHp / hitArrmor / hitShield / hitCrit sit exactly where
     `protocol-classes.md` says. Mid-session I concluded they were SWAPPED and said so; that was wrong
     and is retracted. Two different clips both read as "a computer sound" to the ear, I hung an
     inference chain on the ambiguity, and only a CONTROL killed it -- moving one clip and watching the
     sound NOT change. The confirming evidence is a voice line at position 3 being heard on a shield hit.
  2. **AN EMPTY EFFECT FIELD IS NOT SILENCE. IT FALLS THROUGH OUTWARD.** An empty `hitShield` plays the
     ARMOUR clip. `hitHp` is silent ONLY because nothing lies further inward to fall to. This is new,
     undocumented, and it is NOT the A15.2/A15.3 rule ("an empty field makes the firmware play nothing"),
     which was established on the VOICE fields and does not generalise here. It explains most of an
     evening of incoherent readings: every time we emptied a slot expecting quiet, a neighbour spoke.
  3. **`$SIR`'s sound REPLACES the `$PSET` pool sound; it does not layer** (F38). So the CLASS layer and
     the MATERIAL layer compete for one hit. They are not orthogonal after all -- the paragraph above
     that says they are is describing the tables, not the audio. Only one can speak, and the material
     layer wins by default: it is ear-confirmed, the class pools are not.
  4. **Position 7 (`energyShieldLoop`) is a REAL LOOP** that runs while the shield is up, survives a
     `$PSET` rewrite, and is stopped by `$PLAYX,0,*`. Callsign's inherited `A10` is a geiger-ish tick and
     it ran under every shield-band hit all session. Left EMPTY here; picking a hum is a followup.

⚠️ **THE METHOD THAT BUILT THE FIRST VERSION OF THIS FILE DOES NOT WORK, and that is the transferable
finding.** Every id was originally chosen by ACOUSTIC SHAPE from `data/sound_catalog.json`. Not one
survived a listen. Signal features separate TONAL from NOISY; they cannot separate METAL from
ELECTRONIC, an IMPACT from a NEAR-MISS, a PLAYER from a CREATURE, or a clean clip from one with a cough
tail. In a bank whose largest family is sci-fi, shape-picking `fx:hit` lands on synth tones and
whizz-bys, confidently and repeatedly. What it produced, and what the ear said:
    H14 -> "another computer sound coming online"      (synth tone, picked as the ARMOUR head)
    H22 -> "makes me think shield hit", said twice     (energy; picked into ARMOUR, is the SHIELD sound)
    H03 -> "a hit and a cough from smoke or gas"       (voice tail; picked as the HEALTH head)
    H07, H09 -> "a bullet whizzing by"                 (near-misses; picked into HEALTH)
    H33, Z06, Z07 -> "weird ... like a creature sound" (creature audio; `fx:splat` is a SIGNAL label)
    H140 -> "more like a disabled sound than a hit"
    H13 -> "like the stock hit sound, less metal"      (Callsign's own armour id: mediocre, not wrong)
A second trap: **a rapid audition hides tails.** `H03` passed a six-clip run as "metal" and failed
instantly when heard ALONE on a live hit -- the ear gets each clip's ONSET in a sequence, and a hit
sound is mostly tail. Confirm every candidate SOLO before believing it. `sound_catalog.json` reads as
authoritative and is not, for this question; its `speech_untrusted` transcripts are wrong too (it calls
`V116` "Can't believe!"; on the gun it says "gained the lead").

Every id in `MATERIAL_POOLS` below was heard on real hardware and named by a person. That is the only
provenance this file accepts now.
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field

from . import sounds as _snd

# --------------------------------------------------------------------------- #
# 1. THE MATERIAL LAYER -- $PSET hitHp / hitArrmor / hitShield / hitCrit
# --------------------------------------------------------------------------- #
# `$PSET` foot order (gameconfig._PSET_FOOT): missShothit, hitHp, hitArrmor, hitShield, hitCrit,
# emptyUnboundButtonSound, ammoOrGearPickUp, energyShieldLoop. Only the four hit slots are ours.
MATERIAL_ROLES = ("hit_hp", "hit_armor", "hit_shield", "hit_crit")

# EAR-CONFIRMED on hardware 2026-09-07 (Tony at the bench, one Tactix2, `$PLAY` audition + live IR hits).
# These are no longer shape picks: every id below was played on a real gun and named by ear, twice for
# the ones that mattered. What the audit overturned is recorded here because the mistakes are the useful
# part -- see the METHOD LIMIT note above the module's shape helpers.
#
# ⚠️ THE SHAPE METHOD'S CEILING, measured the hard way. Signal features separate TONAL from NOISY. They
# do NOT separate METAL from ELECTRONIC, nor an IMPACT from a NEAR-MISS -- those pairs are identical on
# envelope, flatness, centroid and duration. Picking `fx:hit` by shape in a bank whose largest family is
# sci-fi therefore lands on synth tones and whizz-bys, confidently and repeatedly. It did:
#   H14  picked as the armour HEAD -> "another computer sound coming online". A synth tone.
#   H22  picked into ARMOUR        -> "makes me think shield hit", said twice, unprompted. Energy, not metal.
#   H03  picked as the health HEAD -> "metal". So the HEALTH pool led with a clank, which is precisely
#                                     the confusion this whole layer exists to prevent.
#   H07  picked into HEALTH        -> "a bullet whizzing by". A near-miss, not an impact.
#   H09  picked into HEALTH        -> same.
#   Z06/Z07 (`fx:splat`)           -> "weird sound effects, not hits ... related to the creature". The
#                                     catalog's "splat" is a signal label; these are creature-family audio.
#   H03  grouped as "metal" in a 6-clip run; heard ALONE on a live hit it is "a hit and a cough from
#        smoke or gas" -- a voice tail, disqualifying. THE AUDITION FORMAT ITSELF LIES: a rapid sequence
#        gives the ear each clip's ONSET and hides its TAIL, and a hit sound is mostly tail. Confirm every
#        pool member alone before trusting it.
#   H33  a "squishy tomato hit"    -> and on the confirm listen, "sounds weird, like a creature sound".
#                                     Rejected for the player pools. Creature audio is a whole seam of this
#                                     bank that reads as body impact on one pass and as wrong on the next.
# Every id chosen by shape is PROVISIONAL until an ear confirms it. The catalog reads as authoritative
# and is not, for this question.
#
# Kept SHORT on purpose: a weapon cycling at 100-140 ms fires 3-4 rounds inside a 0.5 s clip and the
# firmware gives us no mixing control.
MATERIAL_POOLS: dict[str, tuple[str, ...]] = {
    # HEALTH IS SILENT, ON PURPOSE (Tony, bench 2026-09-07: "yeah that's way better, lock it in").
    # An empty `hitHp` makes the firmware play nothing HERE -- not by the A15.2/A15.3 voice-field rule,
    # which does not hold for the effect slots (see the fallthrough finding above), but because health is
    # the INNERMOST pool and has nothing further in to fall through to. So a hit that reaches health
    # makes NO firmware sound -- and the only thing the player hears is the node's own pain
    # grunt, which fires on exactly these hits (A17.1). THE ABSENCE IS THE SIGNAL: armour rings, and real
    # damage is the moment the metal STOPS and a human sound starts. Contrast by subtraction.
    #
    # Reached by ELIMINATION, and the elimination is the useful record: the gun has no clean body-impact
    # sound. `H15` ("a light hit, kind of a thud") was the best candidate found and still failed IN CONTEXT
    # -- heard after three metal takes it read as "all metal/armor hits", because a quiet impact next to a
    # ringing one is just a smaller version of the same event. `H140` -> "a disabled sound". `H33`/`Z06`/
    # `Z07` -> creature audio. `H07`/`H09` -> bullet whizz-bys, near-misses not impacts. `H03` -> a hit
    # with a smoke/gas COUGH tail. The melee rows (`H57`/`H50`/`H49`) are the ATTACKER's sound: "those are
    # all melee attacks, dont sound like getting hit". `fx:hit` was audited clip by clip, `fx:splat` is
    # creature audio, `fx:misc_fx` are effects. Nothing in the 2,477 reads as a round hitting a body.
    # Importing one is possible (`ltp_convert.py` over the data port, as S-A12.3 contemplates for the CS
    # pistol audio) and is NOT needed: silence tested BETTER than the best clip, not merely equal to it.
    "hit_hp":     ("",),
    # ARMOUR. Four ids the ear called metal AND called "slight variants" of each other -- which is exactly
    # the anti-repetition pool Tony asked for ("dynamic and immersive, not repetitive"), got for free from
    # the audit rather than from any rolling machinery. `H13`, Callsign's own stock armour id, is NOT here:
    # second pass called it "like the stock hit sound, less metal". Their choice was mediocre, not wrong.
    "hit_armor":  ("H02", "H36", "H37"),
    # SHIELD. ONE take, on purpose. `H22` was independently named "shield hit" twice, and beat the entire
    # `fx:electrical` family head to head ("none of the others were nearly as good"). Padding this with
    # shape picks is exactly the mistake above, so it stays a single confirmed id until a second audit pass
    # earns a second one. Shield is IR-granted only (P16) so it is the rarest pool in play anyway.
    "hit_shield": ("H22",),
    # CRIT. NOT yet audited, and down to one shape pick: `H02` moved to armour (confirmed metal) and `H33`
    # is out of every pool (creature audio, rejected by ear). `H43` carries the shape-method caveat above
    # and is a placeholder, not a choice. Next bench pass.
    "hit_crit":   ("H43",),
}

# What a hit on each pool sounds like is now carried by the pools; a caller that pins nothing gets the
# head of each. `hit_hp` can afford two takes where armour has four because HEALTH ALREADY HAS A VOICE:
# the node plays the character's pain grunt on exactly those hits (A17.1), so this slot sits UNDER a grunt
# rather than carrying the news alone. Armour and shield have nothing else speaking for them.
MATERIAL_DEFAULT = {r: MATERIAL_POOLS[r][0] for r in MATERIAL_ROLES}

# `$PSET` foot position 7, `energyShieldLoop`. BENCH 2026-09-07: it is a REAL LOOP that runs while the
# shield is UP, survives a `$PSET` rewrite, and stops only on `$PLAYX,0,*` or the shield reaching zero.
# Callsign's inherited `A10` is a geiger-ish tick, and because it loops it ran UNDER every shield-band
# hit of the session -- which is what made an hour of shield readings incoherent ("that geiger counter
# hit came back", "wtf"). It ships EMPTY until a hum is chosen by ear: an unexplained ticking loop
# during play is worse than no shield ambience at all. Followup F44: pick a low hum (`fx:scifi_fx` /
# `fx:retro_fx` on PITCH, not centroid; the whole `SW` family is Star-Wars-style and was rejected).
SHIELD_LOOP_INDEX = 7
SHIELD_LOOP = ""

# --------------------------------------------------------------------------- #
# 2. THE CLASS LAYER -- $SIR <soundID> per (irProtocol, subtype)
# --------------------------------------------------------------------------- #
# One texture per weapon FAMILY, not per weapon: a player needs "a sniper hit me", not "an ion sniper
# rather than a plasma sniper hit me", and the row budget (below) does not stretch to 22 anyway.
CLASS_POOLS: dict[str, tuple[str, ...]] = {
    "rifle":    ("H15",),                           # mid, short, snappy -- rifles cycle at 100-160 ms
                                                    # (`H07`/`H09` whizz-bys, `H140` a "disabled" sound: all removed by ear 2026-09-07)
    "cqb":      ("H31", "H36", "H141"),             # lower and punchier: shotgun / SMG / stinger
                                                    # (`H03` removed 2026-09-07: a cough tail, see below)
    "marksman": ("H22", "H35", "H26", "H43"),       # heavier crack with a tail; ~1.25 s between shots
    "support":  ("H56", "H137", "H105", "H08"),
    "sidearm":  ("H126", "H112", "H113"),           # light and bright, quick out of the way
                                                    # (`H33` removed 2026-09-07: creature audio, rejected by ear)
    "power":    ("H50", "H30", "H24"),              # big and slow; these weapons cycle in seconds
    "melee":    ("H57", "H49", "H45"),              # the stock melee rows already sound like this
}
# weapons.json `role` -> class key. An unknown role falls back to "rifle" (the most neutral pool),
# never to silence: a missing sound is indistinguishable from a dropped hit, which is the bug F11 was.
ROLE_CLASS = {"assault": "rifle", "cqb": "cqb", "marksman": "marksman", "support": "support",
              "sidearm": "sidearm", "power": "power", "melee": "melee"}
FALLBACK_CLASS = "rifle"

# Weapons whose stock row already carries a chosen, weapon-SPECIFIC sound. Left alone: X13 is the
# rocket's explosion and H02 the rail gun's crack, both in the shipped Callsign table, and neither is
# improved by a family pool. (The melee rows carry H50/H57/H49 -- the "melee" pool IS those ids.)
# A pinned weapon is its OWN class (`pin:<weapon_id>`) so it always lands on its own cell: pinning at
# the weapon level while the ROW is per (class, function) would silently drop the pin whenever a
# second weapon of the same family and function shared the cell.
CLASS_PINNED = {"rocket_launcher": "X13", "rail_gun": "H02"}
PIN_PREFIX = "pin:"


def class_for(role: str | None, weapon_id: str | None = None) -> str:
    """The class-pool key for a weapon. `role` is weapons.json's own vocabulary."""
    if weapon_id in CLASS_PINNED:
        return PIN_PREFIX + weapon_id
    return ROLE_CLASS.get((role or "").strip().lower(), FALLBACK_CLASS)


# --------------------------------------------------------------------------- #
# 3. CELL ALLOCATION -- which (proto, subtype) each weapon family gets to own
# --------------------------------------------------------------------------- #
# "Max distinct IR recognitions per game: 14" is a COMMUNITY figure (brx-protocol.md §5), never
# measured here, so it is a soft budget: over it we share cells (audio degrades, damage does not)
# rather than emitting a table we have no evidence the gun accepts. F39 measures the real ceiling.
MAX_SIR_ROWS = 14

# Protocols with no stock meaning (brx-protocol.md §5 "Unused: 4, 5, 7, 12, 14") plus the free
# subtypes under protocols we already own. Ordered: whole unused protocols first, because a spare
# subtype under a live protocol is likelier to collide with hardware we have not characterised.
FREE_CELLS: tuple[tuple[str, str], ...] = (
    ("4", "0"), ("5", "0"), ("7", "0"), ("12", "0"), ("14", "0"),
    ("4", "1"), ("5", "1"), ("7", "1"), ("12", "1"), ("14", "1"),
    ("0", "2"), ("8", "1"), ("10", "1"), ("6", "1"),
)
# Cells that must keep their stock meaning whatever else moves: grenade-station words and the three
# support grants. Re-keying one of these breaks a pickup, not a sound.
RESERVED_CELLS: frozenset[tuple[str, str]] = frozenset({("1", "0"), ("2", "1"), ("3", "0"), ("15", "0")})


@dataclass(frozen=True)
class Entry:
    """One weapon as the allocator sees it: its id, its family, the cell it natively keys, and the
    `$SIR` function that cell carries today (which MUST travel with it -- damage is a property of the
    (weapon, table) pair, never of the weapon alone)."""
    weapon_id: str
    class_key: str
    cell: tuple[str, str]
    fn: int


@dataclass
class Plan:
    """The allocation for one match. `cells` re-keys `$WEAP`; `groups` builds `$SIR`."""
    cells: dict[str, tuple[str, str]] = field(default_factory=dict)          # weapon_id -> cell
    groups: dict[tuple[str, str], tuple[str, int]] = field(default_factory=dict)  # cell -> (class, fn)
    shared: list[str] = field(default_factory=list)   # classes that ran out of budget and share a cell

    def cell_for(self, weapon_id: str) -> tuple[str, str] | None:
        return self.cells.get(weapon_id)


def plan(entries, max_rows: int = MAX_SIR_ROWS, base_cells=()) -> Plan:
    """Give every (class, function) pair in the match its own `$SIR` cell, budget permitting.

    Grouping is by (class, fn) and not by class alone because one family spans several functions --
    "assault" holds the AR on <0,0> fn 1, the Burst and Bolt Rifles on <0,3> fn 37 (x2) and the Force
    Rifle on <0,1> fn 36 (x1.25). Merging those onto one cell would silently rebalance three weapons.

    A group already alone on its stock cell KEEPS it (no re-key, no risk). Groups sharing a cell are
    moved to `FREE_CELLS` in a deterministic order until the budget runs out; the remainder stay put
    and share a sound, which is exactly today's behaviour and never worse than it.

    `base_cells` = cells the pushed table carries regardless (support grants, grenade); they count
    against the budget. Deterministic: same entries in, same plan out."""
    entries = list(entries)
    out = Plan()
    if not entries:
        return out
    # occupancy of the stock cells, so "is this group alone on its cell?" is answerable
    occupants: dict[tuple[str, str], set[tuple[str, int]]] = {}
    for e in entries:
        occupants.setdefault(e.cell, set()).add((e.class_key, e.fn))
    # deterministic group order: by class (pool order), then by function
    order = list(CLASS_POOLS)
    def rank(cls: str) -> int:      # pinned weapons first: their cell is the one that must not move
        return -1 if cls.startswith(PIN_PREFIX) else (order.index(cls) if cls in order else len(order))
    groups = sorted({(e.class_key, e.fn, e.cell) for e in entries},
                    key=lambda g: (rank(g[0]), g[1], g[2]))
    taken: set[tuple[str, str]] = set(base_cells)
    free = [c for c in FREE_CELLS if c not in taken and c not in RESERVED_CELLS]
    assigned: dict[tuple[str, int], tuple[str, str]] = {}
    # pass 1: a group alone on its own stock cell keeps it, free of charge
    for cls, fn, cell in groups:
        if len(occupants.get(cell, ())) == 1 and (cls, fn) not in assigned:
            assigned[(cls, fn)] = cell
            taken.add(cell)
    # pass 2: everyone else gets a free cell while the table has room
    for cls, fn, cell in groups:
        if (cls, fn) in assigned:
            continue
        while free and free[0] in taken:
            free.pop(0)
        if free and len(taken) < max_rows:
            assigned[(cls, fn)] = free.pop(0)
            taken.add(assigned[(cls, fn)])
        else:
            assigned[(cls, fn)] = cell          # out of budget: share the stock cell, as today
            taken.add(cell)
            if cls not in out.shared:
                out.shared.append(cls)
    for e in entries:
        out.cells[e.weapon_id] = assigned[(e.class_key, e.fn)]
    for (cls, fn), cell in assigned.items():
        out.groups[cell] = (cls, fn)
    return out


def plan_in_place(entries) -> Plan:
    """The SAFE plan: nobody moves, every weapon keeps the cell it already keys, and each cell simply
    gains a sound. This is what ships with `hit_audio_rekey` off.

    A cell several families share needs one winner, since the row carries one sound token: the family
    with the most weapons on that cell wins, ties broken by `CLASS_POOLS` order (a pinned weapon --
    the rocket, the rail gun -- always wins its own cell, which is the point of pinning). So `<0,0>`
    with a shotgun, an SMG and an AR reads as CQB rather than as nothing, which is today's sound."""
    entries = list(entries)
    out = Plan()
    order = list(CLASS_POOLS)
    counts: dict[tuple[str, str], dict[tuple[str, int], int]] = {}
    for e in entries:
        out.cells[e.weapon_id] = e.cell
        counts.setdefault(e.cell, {})[(e.class_key, e.fn)] = counts.get(e.cell, {}).get((e.class_key, e.fn), 0) + 1
    for cell, tally in counts.items():
        def rank(item):
            (cls, _fn), n = item
            pinned = 0 if cls.startswith(PIN_PREFIX) else 1
            return (pinned, -n, order.index(cls) if cls in order else len(order))
        (cls, fn), _n = sorted(tally.items(), key=rank)[0]
        out.groups[cell] = (cls, fn)
        if len(tally) > 1:
            for c, _f in tally:
                if c != cls and c not in out.shared:
                    out.shared.append(c)
    return out


# --------------------------------------------------------------------------- #
# 4. PICKING -- duration-aware draws from a pool
# --------------------------------------------------------------------------- #
def duration(sound_id: str) -> float:
    """Clip length in seconds from the measured catalog; 0.0 for an id the catalog does not carry."""
    e = _snd._catalog().get(sound_id) or {}
    try:
        return float(e.get("duration_s") or 0.0)
    except (TypeError, ValueError):
        return 0.0


def fits(pool, cycle_ms: int | None) -> tuple[str, ...]:
    """The takes of `pool` that finish before the weapon fires again, longest-first-eliminated.

    A hit clip outlasting the shooter's fire interval cannot play cleanly -- the firmware gives us no
    mixing control, so the next hit either stutters over it or is swallowed. When NOTHING in the pool
    fits (an AR at 100 ms: no `fx:hit` clip is that short) this returns the SHORTEST takes rather than
    an empty pool, because a slightly-overlapping sound beats silence, which reads as a dropped hit."""
    ids = tuple(pool)
    if not ids:
        return ids
    if not cycle_ms or cycle_ms <= 0:
        return ids
    ok = tuple(i for i in ids if duration(i) <= cycle_ms / 1000.0)
    if ok:
        return ok
    shortest = min(duration(i) for i in ids)
    return tuple(i for i in ids if duration(i) <= shortest + 0.05)


def roll(pool, rng: random.Random) -> str:
    """One take of `pool` (`rng.choice`; a one-id pool is not a draw). Deterministic for a seeded Random."""
    ids = tuple(pool)
    if not ids:
        return ""
    return ids[0] if len(ids) == 1 else rng.choice(list(ids))


def roll_material(rng: random.Random, fixed: dict | None = None) -> dict[str, str]:
    """`{material role: id}`, every role an explicit pick did not fix rolled from its pool."""
    fixed = {k: v for k, v in (fixed or {}).items() if k in MATERIAL_ROLES}
    # `in fixed`, not `fixed.get(...) or ...`: "" is a REAL pick meaning SILENCE (the health pool), and a
    # truthiness test would silently roll over it and put a sound back where we chose to have none.
    return {r: (fixed[r] if r in fixed else roll(MATERIAL_POOLS[r], rng)) for r in MATERIAL_ROLES}


def class_sound(class_key: str, rng: random.Random, cycle_ms: int | None = None) -> str:
    """The `$SIR` sound token for one weapon family: a pinned weapon keeps its chosen id, everything
    else takes a duration-aware draw from its family pool."""
    if class_key.startswith(PIN_PREFIX):
        return CLASS_PINNED.get(class_key[len(PIN_PREFIX):], "")
    return roll(fits(CLASS_POOLS.get(class_key) or CLASS_POOLS[FALLBACK_CLASS], cycle_ms), rng)


def pool_ids() -> set[str]:
    """Every sound id this module can emit -- what `test_hitaudio` asserts is really on the gun."""
    out: set[str] = set(CLASS_PINNED.values())
    for p in MATERIAL_POOLS.values():
        out |= set(p)
    for p in CLASS_POOLS.values():
        out |= set(p)
    return out
