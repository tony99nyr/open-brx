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

⚠️ **Two things here are unproven and both are one bench probe** (FOLLOWUPS F37, F38):
  1. The `$PSET` slot ORDER. hitHp/hitArrmor/hitShield/hitCrit are source-derived from the APK
     (protocol-classes.md "PSET"); `docs/manual/06-developer.md` still marks the wire-slot -> name
     mapping unknown. If the order is wrong we play a real but wrong sound per pool -- cosmetic,
     instantly audible, and F37 settles it with one armoured life.
  2. Whether a non-empty `$SIR` sound LAYERS with the `$PSET` pool sound or REPLACES it. Both designs
     work (layered = impact + material, the ideal; replaced = weapon flavour wins and the material
     layer only speaks on the rows we leave silent), but which one we get is measured, not chosen.

**Every id below is a PROVISIONAL pick BY ACOUSTIC SHAPE**, not by ear: drawn from
`data/sound_catalog.json`, which is measured off the real bank (envelope / spectral flatness /
centroid / duration), filtered to `fx:hit` on-gun ids, and grouped so that armour reads TONAL+RINGING
(metal), health reads NOISY+DULL (body), shield reads BRIGHT+TONAL (energy). That is a defensible
starting point and an honest label -- it is not a claim that anyone has heard them. `sounds.py`
PROVISIONAL rules apply: every id is a real bank id, so a wrong pick plays a real but wrong clip.
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

# Kept SHORT on purpose. A weapon cycling at 100-140 ms fires 3-4 rounds inside a 0.5 s clip, and the
# firmware gives us no mixing control -- an overlong material sound either stutters or swallows the
# next hit. Nothing here runs past 0.62 s; the pool-slot picks stay at or under 0.56 s.
MATERIAL_POOLS: dict[str, tuple[str, ...]] = {
    # BODY: noisy / mixed, dull-to-mid centroid, fast decay, LOUD (rms -14 to -24 dB). The hit that
    # actually costs the player something is the one that must cut through a firefight.
    "hit_hp":     ("H03", "H15", "H07", "H140", "H09"),
    # METAL: tonal (flatness <= 0.08 = a ringing partial, not noise), mid centroid, short ring-out.
    # H13 is Callsign's inherited armour id and stays in the pool so the shipped sound is still drawn.
    "hit_armor":  ("H14", "H22", "H36", "H56", "H13"),
    # ENERGY: bright (centroid >= 2.9 kHz) and tonal -- the shield is the one pool that is not a
    # physical material. H21 is the inherited id, kept in pool for the same reason.
    "hit_shield": ("H21", "H126", "H155", "H112", "H11"),
    # CRIT: loudest and most distinct of the four; it has to read as "that one was different".
    "hit_crit":   ("H02", "H33", "H43"),
}

# The single ids `$PSET` ships when nothing is rolled (pool head). Byte-identical to the inherited
# frame for armour, shield and crit; only hitHp moves, and only because H55 is a tonal RISING chirp
# (flatness 0.025, pitch 64 Hz rising) -- the least body-like clip of the four we inherited.
MATERIAL_DEFAULT = {r: MATERIAL_POOLS[r][0] for r in MATERIAL_ROLES}

# --------------------------------------------------------------------------- #
# 2. THE CLASS LAYER -- $SIR <soundID> per (irProtocol, subtype)
# --------------------------------------------------------------------------- #
# One texture per weapon FAMILY, not per weapon: a player needs "a sniper hit me", not "an ion sniper
# rather than a plasma sniper hit me", and the row budget (below) does not stretch to 22 anyway.
CLASS_POOLS: dict[str, tuple[str, ...]] = {
    "rifle":    ("H15", "H07", "H09", "H140"),      # mid, short, snappy -- rifles cycle at 100-160 ms
    "cqb":      ("H03", "H31", "H36", "H141"),      # lower and punchier: shotgun / SMG / stinger
    "marksman": ("H22", "H35", "H26", "H43"),       # heavier crack with a tail; ~1.25 s between shots
    "support":  ("H56", "H137", "H105", "H08"),
    "sidearm":  ("H33", "H126", "H112", "H113"),    # light and bright, quick out of the way
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
    fixed = {k: v for k, v in (fixed or {}).items() if k in MATERIAL_ROLES and v}
    return {r: fixed.get(r) or roll(MATERIAL_POOLS[r], rng) for r in MATERIAL_ROLES}


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
