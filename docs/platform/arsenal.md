# The whole arsenal. Three slots.

Fifteen weapons, six classes, and one rule underneath all of them: a weapon is defined by how many hits it takes to kill, not by a damage number. You choose the health pool, and Mission Control works out the damage that lands on it.

- [Run a match](/docs/run-a-game)
- [The platform](/platform)
- [Get the app](/download)

## Rule

### Hits to kill, not damage

Set a pool of 115 and an assault rifle takes 13 hits. Set 45 for a hardcore match and it still takes 13, because the compiler scales every weapon to the pool before it writes a single frame. Nothing in the catalogue is a fixed damage number pretending to be balance.

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

### There are only four ways to take someone down

Every weapon in the list above is one of these, and each one beats something and loses to something else. That is the whole design, and it is why the arsenal is not a ladder with a best weapon at the top.

- **Plain damage.** Drains shield, then armour, then health. Against a bare target nothing is faster. Against a big pool it is the slowest thing you can carry.
- **Armour piercing.** Goes straight to health and ignores the armour entirely. It has to be priced down to pay for that, so against someone wearing nothing it is strictly worse than the rifle you gave up.
- **Stripping.** Removes every protective layer and cannot kill. Devastating against a heavily armoured target with a teammate behind you, and literally nothing against a bare one.
- **Denial.** Drops the target's accuracy to zero for a few seconds. It beats anyone who has to aim and does nothing at all to someone who simply walks away.

A fifth is coming: damage over time, which is the answer to walking away, and therefore the natural counter to denial.

## Limits

### What the hardware actually allows, and what it does not

This is a platform built on someone else's firmware, over a serial protocol, and being honest about the edges is more useful than pretending there are none.

- **Range is a carrier frequency, not a distance.** The range field shifts the infrared carrier, and the receiver has a knee in its response curve. Between about 31 and 100 every value reaches as far as anyone has been able to pace out, so a short-range weapon is not something the hardware lets us simply ask for.
- **Some weapons fire twice.** Three of them send a second infrared word from the shooter's own headset, about 88 milliseconds behind the first, with its own damage and its own reach. We measured it on the wire rather than reading it off a spec.
- **The firmware is never modified.** Every weapon here is assembled from frames the tagger already understands. That is a hard rule, not a limitation we are working around.

Protocol discovery credit belongs to LaserTagMods. The way powerful weapons are held in check here, through ammunition and reload rather than raw damage, is how the original designers did it, as it was described to us.
