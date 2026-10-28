# The whole arsenal. Three slots.

Six classes, and one rule underneath all of them: every weapon keeps one damage number, and the health pool you choose sets how many hits it takes to kill.

- [Run a match](/docs/run-a-game)
- [The platform](/platform)
- [Get the app](/download)

## Rule

### One damage number, and the pool sets the hits

The hits to kill are the pool divided by the weapon's damage, rounded up. So the hit count moves with the pool, and the damage stays the same. The default pool is 115 (Standard: 45 health and 70 armour), and there an assault rifle takes 13 hits. The same rifle takes 17 against Shields (150) and 5 in a Hardcore match (45). The hit counts in the list below are for the default pool.

That is the whole reason the arsenal can be retuned between matches without anyone touching a tagger. The weapon is data. The gun runs stock firmware and always will.

## Classes

### Six classes, and none of them is a dumping ground

```data
roles
```

Assault holds the middle. Close range trades reach for a kill that arrives in three pulls. Sniper pays in cycle time for hits that land from anywhere. Sidearms are the second slot, not a weak primary. Heavy kills outright and has to be found on the field rather than chosen. Support cannot kill at all.

## Arsenal

### Every weapon, and the fight it is for

```data
arsenal
```

## Counters

### There are four ways to take someone down

Every weapon in the list above is one of these, and so is the Armour Piercing perk, and each one beats something and loses to something else. That is the whole design, and it is why the arsenal is not a ladder with a best weapon at the top.

- **Plain damage.** Drains shield, then armour, then health. Against a bare target nothing is faster. Against a big pool it is the slowest thing you can carry.
- **Armour piercing.** Goes straight to health and ignores the armour entirely. It has to be priced down to pay for that, so against someone wearing nothing it is strictly worse than the rifle you gave up.
- **Stripping.** Removes every protective layer and cannot kill. Devastating against a heavily armoured target with a teammate behind you, and literally nothing against a bare one.
- **Damage over time.** The Toxin Rifle poisons on every hit: the target's own phone keeps draining its pools for a few seconds after it breaks contact. It is the answer to walking away.

## Limits

### What the hardware actually allows, and what it does not

This is a platform built on someone else's firmware, over a serial protocol, and being honest about the edges is more useful than pretending there are none.

- **Range is a hit-odds setting, not a distance.** The range field changes how likely a shot is to register. It does not shorten the beam. We measured it in a garden with two taggers. A very low value barely lands at all, there is a sharp change somewhere between 13 and 26, and between about 31 and 100 every value reaches as far as anyone has been able to pace out. So a short-range weapon is not something the hardware lets us simply ask for.
- **Some weapons fire twice.** Three of them send a second infrared word from the shooter's own headset, about 88 milliseconds behind the first, with its own damage and its own reach. We measured it on the wire rather than reading it off a spec.
- **The firmware is never modified.** Every weapon here is assembled from frames the tagger already understands. That is a hard rule, not a limitation we are working around.

Protocol discovery credit belongs to LaserTagMods. The way powerful weapons are held in check here, through ammunition and reload rather than raw damage, is how the original designers did it, as it was described to us.
