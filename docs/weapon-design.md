# Weapon design & balance

What our weapons are, why their numbers are what they are, and where every one of them comes from.

**Rewritten 2026-08-26 (second pass).** The first version of this document was built on a
four-sample template system and a mis-read token map. Both are gone. **Every weapon is now based on
its own captured Callsign `$WEAP` frame**, and the balance below is written on top of those frames.
Where the earlier analysis was wrong, it is marked *retracted* rather than quietly deleted.

- **Roster:** `mcp/brx_mcp/mc/weapons.json` — each row carries `capture.frame` (the real frame Battle
  Company sent) plus a `wire` block listing only the tokens we deliberately overwrite.
- **Raw traces:** `protocol/captures/raw/` · decode with
  `python -m brx_mcp.weapmap protocol/captures/raw/*.btsnoop` · named table in
  `docs/reference/weapons.md`.
- **Token map:** `protocol/callsign-extract/protocol-classes.md` · **bench truth:**
  `protocol/brx-protocol.md` §7r and the 2026-08-26 probe entries.
- **Sound bank:** `protocol/callsign-extract/sound-bank.md` (prefix legend credited to David Knox,
  shared by the owner community).

Protocol discovery credit: **LaserTagMods** (JEDGE/JBOX). Stock firmware is never modified — every
value here is a number we send in a `$WEAP` frame over BLE.

---

## 0. The damage model

Hardware-true, from `brx-protocol.md` §7r and the 2026-08-26 damage experiment:

- The default pool is **115 = 45 HP + 70 armor** (`compile.py`, `health: {max_hp: 45, max_armor: 70}`).
- **Armor absorbs at face value and spills into HP** — 70 → 46 → 22 → 0, then into HP. No multiplier,
  no reduction.
- **`t5` is the applied damage, exactly.** `$HIR` token 5 reports it back. Confirmed across four
  weapons on the bench.
- The stock Assault Rifle deals **9**, not the manual's 24. The manual is stale.

| term | formula |
|---|---|
| **htk** | `ceil(115 / dmg)` |
| **cycle** | `t14`, ms between shots (for charge weapons, the charge time) |
| **TTK** | `(htk-1) × cycle`; charge weapons `htk × cycle`; burst weapons use the burst-average cycle |
| **burst average** | `(2 × t14 + t23) / 3` — three rounds at `t14` spacing, `t23` between bursts |
| **sustained DPS** | `mag × dmg / (mag × cycle + reload_ms)` |
| **total kills** | `(mag + reserve) // htk` |

TTK is the honest headline. DPS flatters weapons that need many hits, and every hit is a discrete IR
event that can miss.

---

## 1. Everything is now based on its own captured frame

### 1.1 What changed and why it matters

The old `WeaponCatalog` built 16 of 19 weapons from **four** sample tails (`ar`, `charge`, `laser`,
`rocket`) with a handful of tokens overwritten. Every weapon built on the `ar` sample inherited the
AR's behaviour in every token we did not explicitly write — which was most of them.

All 20 Callsign weapon frames are now captured and parsed. `resolve()` starts from the weapon's own
frame and writes **only** the balance tokens. That inherits, for free, every behaviour we could not
synthesise:

| behaviour | token | who has it |
|---|---|---|
| **fire mode** | `t20` | see §4.1 — this is the big one |
| 3-round burst timing | `t23` | Burst Rifle (275), Force Rifle (250) — nobody else |
| overheat + overheat sound | `t24`/`t35` | SMG (5), Energy Rifle (6), Charge Rifle (14), Plasma Sniper (30) |
| damage type | `t3` | Rocket 10 lethal-explosive, Rail 6 armor-piercing, Melee 13, Charge Rifle 8 |
| reload type | `t19` | Shotgun **2 = Shells**, Melee 10 — everything else 0 |
| charge-up / down sounds | `t28`/`t29` | Rail `C08`, Laser `C11`, Charge Rifle `C15`/`C17` |
| per-weapon reload chains | `t31–33` | 11 distinct chains, not one shared `D04+D03+D02` |
| muzzle flash / quiet | `t25`/`t26` | Suppressor only |
| the weapon's real fire sound | `t27` | e.g. the SMG is `G03`, not the `G10` we had chosen |

The old system wrote `t20 = 0` into everything built on the `ar` sample. That single token is why
the sniper and the shotgun full-autoed on the bench.

### 1.2 The stock arsenal, as captured

What Battle Company actually ships. `htk`/`TTK` computed against our 115 pool.

| weapon | t20 fire mode | dmg | cycle ms | mag | reserve | reload | heat | htk@115 | TTK s |
|---|---|---|---|---|---|---|---|---|---|
| Assault Rifle | 0 full auto | 9 | 100 | 32 | 384 | 1400 | 0 | 13 | 1.20 |
| Burst Rifle | 9 3-round burst | 9 | 75 +275 burst | 36 | 216 | 1700 | 0 | 13 | 1.70 |
| Force Rifle | 9 3-round burst | 9 | 100 +250 burst | 36 | 144 | 1700 | 0 | 13 | 1.80 |
| Bolt Rifle | 7 single shot | 13 | 225 | 18 | 180 | 2000 | 0 | 9 | 1.80 |
| SMG | 0 full auto | 8 | 90 | 72 | 288 | 2500 | 5 | 15 | 1.26 |
| Shotgun | 7 single shot | 45 | 900 | 6 | 24 | 400 | 0 | 3 | 1.80 |
| Stinger | 0 full auto | 15 | 120 | 18 | 72 | 1700 | 0 | 8 | 0.84 |
| Sniper Rifle | 7 single shot | 80 | 300 | 4 | 24 | 1700 | 0 | 2 | 0.30 |
| Plasma Sniper | 7 single shot | 80 | 225 | 10 | 80 | 2000 | 30 | 2 | 0.23 |
| AMR | 7 single shot | 18 | 360 | 14 | 56 | 1400 | 0 | 7 | 2.16 |
| Suppressor | 0 full auto | 8 | 75 | 48 | 288 | 2000 | 0 | 15 | 1.05 |
| Energy Rifle | 0 full auto | 9 | 90 | 300 | 600 | 2400 | 6 | 13 | 1.08 |
| Charge Rifle | 14 charge, on release | 100 | 1250 | 100 | 200 | 2500 | 14 | 2 | 2.50 |
| Rocket Launcher | 7 single shot | 115 | 1000 | 2 | 8 | 1200 | 0 | 1 | 0.00 |
| Rail Gun | 2 charge, auto-fires | 115 | 1200 | 1 | 6 | 2400 | 0 | 1 | 1.20 |
| Laser Cannon | 3 charge, hold | 115 | 1500 | 4 | 8 | 2000 | 0 | 1 | 1.50 |
| Energy Launcher | 0 full auto | 115 | 360 | 1 | 6 | 1400 | 0 | 1 | 0.00 |
| Ion Sniper | 7 single shot | 115 | 1000 | 2 | 12 | 2000 | 0 | 1 | 0.00 |
| Melee | 13 melee | 90 | 1000 | 1 | 0 | 0 | 0 | 2 | 1.00 |

### SHIPPED (rebalanced on top of those frames)

**Stock Callsign is a low-damage, high-rate design.** Automatics deal 8–15 a hit and fire at
75–120 ms; a kill is 13–15 hits landed in about a second. Five weapons deal exactly **115** — the
default pool — and one-shot a full-health player. The two snipers deal 80 at a 225–300 ms cycle,
which makes them the fastest killers in the game by a wide margin (0.23 s and 0.30 s).

That is a coherent design, but it is not the one we want: TTKs cluster far below a second, and the
one-shot tier has 4–12 kills of ammo. §2 keeps the *feel* — the fire modes, the burst, the heat, the
sounds — and moves the numbers.

---

## 2. The rebalance (shipped)

### 2.1 Principles

1. **Never touch a token we cannot name.** Everything outside the balance set is emitted exactly as
   captured.
2. **Preserve the captured invariants.** `t39 == t16` (clip start == max clip) and `t17 == 2 × t40`
   hold on all 19 captured frames; `resolve()` maintains both. Pinned by a test.
3. **Tune damage and ammo before cycle.** Cycle carries fire feel — especially on burst weapons,
   where `t14` is the intra-burst spacing that `t23` is tuned against.
4. **`mag ≥ htk`, always.** Enforced in `Compiler.validate()` as an error.
5. **TTK band 1.5–3.5 s** at the 115 pool for everything that is not a one-shot weapon.
6. **No strict dominance.** No weapon may be ≥ another on TTK, sustained DPS **and** total kills at
   once. Checked in a test, not by eye.
7. **One-shot weapons are a pickup tier**: 2-round magazine, 4 total kills, and each differentiated
   by charge behaviour rather than by numbers.
8. **`htk` is the design unit, not DPS** — IR hits are discrete and misses are normal.

### 2.2 The table

| weapon | role | dmg | cycle ms | htk | **TTK s** | DPS | sust | mag | reserve | reload | mag/total kills | heat | changed |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| *Melee* | melee | 90 | 1000 | 2 | **1.00** | 90.0 | 90.0 | 1 | 0 | 0 | 0 / 0 | — | **stock** |
| Sniper Rifle | marksman | 60 | 1500 | 2 | **1.50** | 40.0 | 31.2 | 4 | 24 | 1700 | 2 / 14 | — | dmg 80→60, cycle 300→1500 |
| Shotgun | cqb | 45 | 800 | 3 | **1.60** | 56.2 | 51.9 | 6 | 24 | 400 | 2 / 10 | — | cycle 900→800 |
| Plasma Sniper | marksman | 25 | 400 | 5 | **1.60** | 62.5 | 41.7 | 10 | 80 | 2000 | 2 / 18 | 30 | dmg 80→25, cycle 225→400 |
| AMR | support | 24 | 400 | 5 | **1.60** | 60.0 | 48.0 | 14 | 56 | 1400 | 2 / 14 | — | dmg 18→24, cycle 360→400 |
| Force Rifle | assault | 10 | 100 +250 | 12 | **1.65** | 66.7 | 50.7 | 36 | 144 | 1700 | 3 / 15 | — | dmg 9→10 |
| Burst Rifle | assault | 9 | 75 +275 | 13 | **1.70** | 63.5 | 47.6 | 36 | 216 | 1700 | 2 / 19 | — | **stock** |
| Stinger | cqb | 15 | 250 | 8 | **1.75** | 60.0 | 43.5 | 18 | 144 | 1700 | 2 / 20 | — | cycle 120→250, res 72→144 |
| Bolt Rifle | assault | 13 | 225 | 9 | **1.80** | 57.8 | 38.7 | 18 | 180 | 2000 | 2 / 22 | — | **stock** |
| SMG | cqb | 8 | 140 | 15 | **1.96** | 57.1 | 45.8 | 72 | 288 | 2500 | 4 / 24 | 5 | cycle 90→140 |
| Suppressor | support | 8 | 160 | 15 | **2.24** | 50.0 | 39.7 | 48 | 384 | 2000 | 3 / 28 | — | cycle 75→160, res 288→384 |
| Assault Rifle | assault | 9 | 190 | 13 | **2.28** | 47.4 | 38.5 | 32 | 384 | 1400 | 2 / 32 | — | cycle 100→190 |
| Energy Rifle | support | 9 | 200 | 13 | **2.40** | 45.0 | 43.3 | 300 | 600 | 2400 | 23 / 69 | 6 | cycle 90→200 |
| Charge Rifle | support | 100 | 1250 | 2 | **2.50** | 80.0 | 68.6 | 12 | 12 | 2500 | 6 / 12 | 14 | mag 100→12, res 200→12 |
| Rocket Launcher | power | 115 | 1000 | 1 | **0.00** | 115.0 | 50.0 | 2 | 2 | 2600 | 2 / 4 | — | res 8→2, reload 1200→2600 |
| Energy Launcher | power | 115 | 1600 | 1 | **0.00** | 71.9 | 50.0 | 2 | 2 | 1400 | 2 / 4 | — | cycle 360→1600, mag 1→2, res 6→2 |
| Ion Sniper | power | 115 | 1400 | 1 | **0.00** | 82.1 | 47.9 | 2 | 2 | 2000 | 2 / 4 | — | cycle 1000→1400, res 12→2 |
| Rail Gun | power | 115 | 1200 | 1 | **1.20** | 95.8 | 47.9 | 2 | 2 | 2400 | 2 / 4 | — | mag 1→2, res 6→2 |
| Laser Cannon | power | 115 | 1500 | 1 | **1.50** | 76.7 | 50.0 | 2 | 2 | 1600 | 2 / 4 | — | mag 4→2, res 8→2, reload 2000→1600 |

Three weapons ship **exactly as Battle Company sent them** (`verified: true`): the Burst Rifle, the
Bolt Rifle and Melee — their stock numbers already sat in the band.

**Role identities**

- **Assault Rifle** — the anchor. Slowest kill (2.28 s), **deepest pool in the game** (32 kills, 384
  in reserve). Cycle slowed 100 → 190 ms; damage untouched at the captured 9.
- **Burst Rifle** — stock. A real three-round burst the gun enforces, and the most total ammo of the
  burst pair (19 kills).
- **Force Rifle** — the burst rifle's heavier twin: 10 damage instead of 9, so 12 hits instead of 13
  and a faster kill, paid for in half the reserve and a slower five-part reload.
- **Bolt Rifle** — stock. Single shot, 9 hits, 22 kills.
- **SMG** — four kills a magazine, 24 across the kit, and a real overheat budget (`t24 = 5`).
- **Shotgun** — three hits, six shells, a **400 ms Shells-type reload** — the highest sustained
  output in the arsenal from its shallowest ammo pool.
- **Stinger** — full auto, eight hits, 20 kills. Reserve doubled so it is not simply the SMG's worse
  sibling.
- **Sniper Rifle** — the only two-hit weapon outside the power tier, on a 1.5 s cycle.
- **Plasma Sniper** — a marksman rifle that fires like a carbine and **overheats** (`t24 = 30`).
  Damage dropped hard (80 → 25) precisely so its cycle could stay fast enough for the heat mechanic
  to matter.
- **AMR** — the hardest-hitting automatic (24 a hit) and the shallowest (14 kills).
- **Suppressor** — quiet, no muzzle flash, **28 kills**: the deepest total pool, the slowest kill.
- **Energy Rifle** — 23 kills on one magazine, 69 across the kit. The ammo weapon.
- **Charge Rifle** — hold-and-release charge with a heat budget. Its 100/200 ammo (100 kills) was the
  single most dominant thing in the arsenal; cut to 12/12.
- **Power tier** — Rocket, Rail, Laser, Energy Launcher, Ion Sniper. All 115 damage, all one-shot,
  all **2 + 2 rounds = 4 kills**, differentiated by charge behaviour and a deliberate cycle/reload
  ladder (see §2.4).

### 2.3 Dominance and the band

Checked mechanically in `test_ttk_band_and_no_strictly_dominant_weapon`:

- Every non-one-shot weapon lands between **1.50 s and 2.50 s** — inside the 1.5–3.5 s band.
- **No weapon strictly dominates another** on {TTK, sustained DPS, total kills}. The same check on
  the stock roster returns **43** dominated pairs.

**One honest caveat: range is not a differentiator.** `t41` (gun range) reads **75 on all eighteen
guns** and 20 on melee — Battle Company does not vary it. So the dominance check runs on three axes,
not four, and the shotgun's 25 %-range drawback from the earlier draft does not exist on the wire.
This is now the single biggest missing design axis (§5, U2).

### 2.4 The power tier

All five are one-shot kills, so TTK cannot separate them. They are separated by **behaviour** — what
the enemy hears, and whether the shot is yours to time — and by a cycle/reload ladder with no
strict winner:

| weapon | fire mode (`t20`) | cycle | reload | the tell |
|---|---|---|---|---|
| Rocket Launcher | 7 single shot | **1000 ms** (fastest) | 2600 ms (slowest) | none |
| Rail Gun | 2 charge, **auto-fires** | 1200 ms | 2400 ms | `C08` spool — and it fires whether you are ready or not |
| Ion Sniper | 7 single shot | 1400 ms | 2000 ms | none — a rifle body, the quiet one-shot |
| Laser Cannon | 3 charge, **must be held** | 1500 ms | 1600 ms | `C11` — and a tap fires nothing at all |
| Energy Launcher | 0 full auto | 1600 ms (slowest) | **1400 ms** (fastest) | none |

Fastest cycle has the slowest reload and vice versa; nothing leads on both.

### 2.5 Health-config sensitivity

`htk` moves with the host's health setting, and MC lets it change per game.

| weapon | 45/55 (100) | **45/70 (115)** | 50/100 (150) | 100/100 (200) |
|---|---|---|---|---|
| Power tier (115 dmg) | 1 | **1** | **2** | 2 |
| Sniper Rifle | 2 | **2** | 3 | 4 |
| Shotgun | 3 | **3** | 4 | 5 |
| Plasma Sniper | 4 | **5** | 6 | 8 |
| AMR | 5 | **5** | 7 | 9 |
| Bolt Rifle | 8 | **9** | 12 | 16 |
| Force Rifle | 10 | **12** | 15 | 20 |
| Assault / Burst / Energy Rifle | 12 | **13** | 17 | 23 |
| SMG / Suppressor | 13 | **15** | 19 | 25 |

Two consequences carried over from the first pass and still true:

- **At a 150 pool the power tier stops one-shotting.** Their `mag: 2` keeps `mag ≥ htk` true to a
  230 pool — which is why they are 2+2 and not 1+3.
- **MC should show htk, not a damage bar.** `weapons.json` now carries `htk` and `ttk_ms` per weapon,
  and the `dmg` UI bar is defined as *the share of a 115 pool one hit removes* rather than an
  arbitrary 0–100 number. The `rng` bar is now the literal `t41` value, which means it reads 75 on
  every gun — correctly, if unhelpfully. It was previously decorative and misleading.

---

## 3. Sound

### 3.1 Battle Company already assigned them

Re-basing on captured frames means **every weapon now plays the sound Callsign gives it**, with its
own reload chain, charge cue and dry-fire click. We no longer choose fire sounds at all. That
resolves the bench's C3 by itself: the SMG reads as a heavy machine gun because `G10` was *our*
pick — the real SMG frame is **`G03`** (1.08 s, against `G10`'s 1.32 s).

Ten distinct reload chains ship where there was previously one. The Suppressor is the only
weapon with `t25`/`t26` set (quiet, no muzzle flash), and the Rail Gun and Laser Cannon carry charge
cues (`C08`, `C11`) that the old build silently blanked.

### 3.2 Retracted: the duration ÷ cadence ceiling

> **The first pass defined a "2.07× ceiling"** — fire-sound duration divided by fire interval,
> derived from the stock AR playing a 1.76 s sample at what was then read as an 850 ms cadence.
> **`t14` is the fire interval, and the AR's real cadence is 100 ms**, so the stock reference ratio
> is **17.6×**, not 2.07×. Battle Company ships a 1.76 s sample at ten shots a second and it sounds
> like an assault rifle, which means the firmware truncates and retriggers by design.
>
> **The ceiling does not exist, and everything derived from it is void** — the per-weapon verdict
> column, the "audition shortlists", and the claim that no gunshot sample is short enough for a fast
> weapon. Sample duration constrains only weapons slow enough to play a sample out; below that, what
> identifies a weapon is its **attack transient**, which bank data (durations and community labels,
> no waveforms) cannot measure.

### 3.3 Retracted: the reload-chain budget

> The first pass also assumed the three reload parts play in sequence inside `reload_ms`, and audited
> every weapon for "dead air" and "overrun". The captured frames refute it: **six of Battle Company's
> own frames overrun under that model**, including the Shotgun (a 0.82 s chain inside a 400 ms
> `Shells` reload) and the Plasma Sniper (2.56 s inside 2000 ms). Whatever the parts do, it is not
> "play end to end within the reload window" — most likely they truncate and retrigger like the fire
> sound, or `t19` changes how they are used.
>
> No replacement rule is offered, because none is supported by the data. The chains are Battle
> Company's own and we now ship them unmodified. Timing is an open bench question (§5, U4).

### 3.4 What the bank still tells us

Useful for *new* weapons we invent later, not for the stock 19. Durations, by family:

| prefix | meaning (DK legend) | n | range | shortest |
|---|---|---|---|---|
| **R** | rifle gunshots | 47 | 0.52–5.02 s | R122 0.52 |
| **G** | gun shots (SMG family) | 23 | 0.54–2.00 s | G02 0.54 |
| **P** | gun shots — **entirely unused by any stock weapon** | 18 | 0.69–2.13 s | P15 0.69 |
| **S** | gun shots (S16 = SR-100) | 19 | 1.12–4.13 s | S07 1.12 |
| **T** | gun shots (T14 = TAC-87) | 16 | 0.84–1.80 s | T02 0.84 |
| **O** | ordnance — **unused by any stock weapon** | 6 | 1.45–2.51 s | O01 1.45 |
| **Q** | silencers | 7 | 0.21–0.86 s | Q04 0.21 |
| **L** | electrical — **unused by any stock weapon** | 7 | 0.36–4.50 s | L04 0.36 |
| **E** | sci-fi (E01–E32) | 32 | 0.58–4.46 s | E27 0.58 |
| **C** | sci-fi + charge cues | 21 | 1.02–3.96 s | C14 1.02 |
| **D** | cocking / reload beats | 69 | 0.05–3.92 s | D18 0.12 |
| **W** | reloads — **unused by any stock weapon** | 74 | 0.27–8.72 s | W09 0.27 |
| **X** | grenades / explosions | 51 | 0.09–8.06 s | X37 0.09 |

Four whole families — **P, O, L and W** — are untouched by the stock arsenal. Those are the palette
for custom weapons. Two legend corrections: the **E_\*** ids are alternate takes, not part of the
E01–E32 weapon family, and **ST** ("sci-fi mortars/rockets") **has no group in `Sounds.json`** — no
`ST*` id exists.

---

## 4. Wire levers

Most of §4 in the first pass argued for setting fields we were leaving at template defaults. Re-basing
settles nearly all of them: the values are Battle Company's and we now preserve them. What remains is
one discovery and one genuine gap.

### 4.1 `t20` is the fire mode — and it explains the full-auto bench failure

The field map calls `t20` "(secondary/overheat)". It is neither: overheat is `t24`, independently
populated on exactly the four weapons described as overheating. Across all 19 captured frames `t20`
tracks the operator's own capture-time behaviour notes:

| `t20` | weapons | described as |
|---|---|---|
| **0** | Assault Rifle, SMG, Suppressor, Energy Rifle, Stinger | "full auto" (5/5) |
| | Energy Launcher | "single shot" — the lone outlier |
| **2** | Rail Gun | "charges, **auto-fires** after ~1 s" |
| **3** | Laser Cannon | "must be **held** to charge; a tap fires nothing" |
| **7** | AMR, Bolt Rifle, Sniper Rifle, Plasma Sniper, Ion Sniper, Rocket Launcher, Shotgun | "single shot" (7/7) |
| **9** | Burst Rifle, Force Rifle | "3-round burst" (2/2) — and the only two frames with `t23` |
| **13** | Melee | "gyro swing" |
| **14** | Charge Rifle | "hold to charge, **fires on release**" |

5/5 full-auto, 7/7 single-shot, 2/2 burst, and three distinct values for three distinct described
charge behaviours. The single outlier is explainable: the Energy Launcher has a **one-round
magazine**, so "single shot" is what any operator would write regardless of the underlying mode.

**This resolves C1.** `WEAPON_TAILS["ar"]` carries `t20 = 0`, so every weapon the old template built
inherited full auto — which is exactly why the sniper and shotgun fired full-auto on the bench. It
was never a missing field; we were overwriting the right one with the AR's value.

**It also resolves C2.** Native burst exists: the Burst Rifle's `t20 = 9` with `t23 = 275`. Our
`ar`-derived burst rifle did not burst because the `ar` sample carries neither token.

*Status: inferred from 19 frames plus capture-time notes, not yet fired. One-field bench
confirmation: take the sniper's frame, flip `t20` from 7 to 0, and it should full-auto.*

### 4.2 `t41` — range is not differentiated, and that is a real gap

`t41` reads **75 on all eighteen guns** (20 on melee). Battle Company does not vary it, we do not
write it, and the semantics are unverified. So **range does not currently distinguish any two
weapons**, which is why a shotgun and a sniper trade only on hits, cadence and ammo.

The earlier draft claimed the captured rocket carried `t41 = 30`. **That was wrong** — the 30 sits at
`t42` (extra-headset range), present on the Rocket, Shotgun and Plasma Sniper. Corrected here.

Recovering range would be the largest single gain available to weapon design, and it is cheap to
test (§5, U2). It is deliberately left alone for now: writing an unverified field across the whole
arsenal on a guess is exactly the mistake the first pass made with `t14`.

### 4.3 Resolved by the re-base

- **`t3` damage type** — no longer guessed. Rocket 10 (lethal explosive), Rail 6 (armor-piercing),
  Melee 13, Charge Rifle 8, Energy Launcher 9. The first pass proposed assigning ShottyPellets to
  the shotgun; Battle Company leaves it 0, and we now follow the capture.
- **`t19` reload type** — the Shotgun really is `2 = Shells` (which is why a 400 ms reload is sane:
  it is per shell). Everything else is 0. Never settable by the old template, now inherited.
- **`t14` charge time** — the "silent Laser Cannon" bug from the first pass is gone: the real frame
  carries `C11`, and the Rail Gun carries `C08`.
- **`t23` burst, `t24`/`t35` overheat, `t25`/`t26` muzzle flash** — all inherited.

---

## 5. Open unknowns

| # | unknown | blocks | how to settle |
|---|---|---|---|
| **U2** | **`t41` range semantics.** Constant at 75 across the stock arsenal, so untested and unused. Is it %, metres, or an index? | the entire range axis; short-vs-long weapon identity | Two guns, one weapon, `t41` at 100 vs 25, walk it back until hits stop landing. **Highest value open item now that U0 is answered.** |
| **U1** | **`t20` confirmation.** §4.1 is inference from 19 frames, not a fired test. | nothing — we ship the captured values either way | Flip the sniper's `t20` 7 → 0 and listen. One field, one shot. |
| **U4** | **How the 3-part reload chain relates to `reload_ms`.** Six stock frames "overrun" a sequential model, so the model is wrong. | any future reload-sound work | One weapon, one long chain, one stopwatch. Also answers whether `t19` changes it. |
| **U5** | **Does a held trigger retrigger the fire sample from zero, or ring under the next shot?** Decides whether sample duration constrains anything at all. | custom weapon sound design | Fire the AR (1.76 s sample, 190 ms cycle) and listen. |
| **U6** | **What the victim's firmware does per damage type** (`t3`) — hit sound, LED, or nothing? | whether damage type is a design lever or just metadata | Same damage value at `t3` = 0 vs 6 vs 14, watch the receiving gun. |
| **U7** | **Damage ceiling in the IR payload** — Jay reports a ~7–8-bit value (≤ 256) (FOLLOWUPS P10). Our max is 115, so nothing is at risk today, but it caps any future double-damage powerup. | future powerups | Confirm on capture. |
| **U8** | **`t17` vs `t40`.** Every captured frame obeys `t17 == 2 × t40` and we preserve it, but *why* is unknown — is `t40` a per-magazine count and `t17` a total? | nothing today; would matter for a resupply powerup | Set them independently and watch `$ALCD`. |
| **U9** | **Reserve travels via `$AMMO`, not `$WEAP`.** Hardware-confirmed (§7r watched 384 → 352 → 338). A mid-game `$WEAP` re-push — a weapon pickup — needs its `$AMMO` re-sent too, or the player silently gets the frame's reserve. | weapon pickups / powerups | Re-push a `$WEAP` mid-game and watch `$ALCD`. |

**Closed since the first pass:** U0 (fire-mode token → `t20`, §4.1) · U3 (`t19` reload type →
captured, `Shells` on the shotgun) · the burst-token hunt (native burst is `t20 = 9` + `t23`) ·
`t3` damage type (captured, no longer guessed).

---

## Appendix — token positions

`resolve()` writes exactly these and nothing else. Doc `tokN` == `frame.split(",")[N+1]`.

| token | field | written? |
|---|---|---|
| `t0` | slot | ✅ set per call |
| `t5` | damage | ✅ when `wire.dmg` is present |
| `t14` | fire interval / charge time | ✅ when `wire.fire_ms` is present |
| `t16` / `t39` | max clip / clip start | ✅ always, kept equal |
| `t17` / `t40` | reserve / reserve-half | ✅ always, kept at `t17 == 2 × t40` |
| `t18` | reload ms | ✅ always |
| `t15` | the constant **850** in every captured frame | ❌ **never** — unidentified |
| `t3` `t4` `t19` `t20` `t23` `t24` `t25` `t26` `t27–36` `t41` `t42` | damage type, power type, reload type, **fire mode**, burst, overheat, muzzle flash, all sounds, ranges | ❌ inherited from the capture |
| `t7–t13` | secondary fire | ❌ empty on all twenty stock weapons — no BRX weapon has an alt-fire |
