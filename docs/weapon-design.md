# Weapon design & balance

> ## 🔴 LIVE BUG IN SHIPPED CONFIG — the Energy Launcher deals **zero damage**
> Its `$WEAP` key `<t3,t4> = <9,3>` lands on `$SIR,9,3,,24` in `gameconfig._SIR_TABLE`, which MC pushes
> into **every** game head. Fired through the real shipped table on that key, it landed **0 damage per
> hit, 3/3 trials** (experiment-log 2026-08-26) — so the weapon is unusable in every game we run.
> Fix options in **§6.2**; it is a bug, not a design question.
>
> **On the mechanism, which has now flipped twice.** This banner originally said fn 24 is a status
> function that touches no pool. A listen-only run then fired fn 24 on protocol 7 and reported damage
> (armor 70→30), so I corrected it to "fn 24 is not inert". **A controlled matrix has since found fn
> 24 pool-neutral on protocols 0, 5, 7, 9 and 10** — the damaging observation does not reproduce
> (`eb73b0e`). So the original reading is the one currently supported, and my correction of it was
> based on a result that did not hold. The Energy Launcher landing 0 is *consistent* with fn 24 being
> pool-neutral; that is no longer a puzzle, though the non-reproducing observation is (§6.2).
>
> *(An earlier revision of this banner questioned the measurement because it shared a session with
> the disputed multipliers. Withdrawn: the emitter has since been shown to deliver faithful
> magnitudes — see §6.2 — so there is no rig-wide reliability problem, and this 0/3 stands.)*
>
> ⚠️ **DISPUTED (2026-08-27): the ×2 / ×1.25 multipliers did not reproduce.** This banner also used to
> say four more weapons — Burst Rifle, Bolt Rifle, AMR (×2), Force Rifle, Sniper Rifle (×1.25) — deal
> more than their `t5`. A later controlled matrix read **×1.0 in all 24 cells** with a clean fn 1
> control (`brx-protocol.md` §5). **Do not tune weapons on ×1.25/×2 until it is settled** — those five
> may be dealing base damage. §6.2.

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
- **Armor absorbs at face value and spills into HP** — 70 → 46 → 22 → 0, then into HP.
- ⚠ **"No multiplier, no reduction" was true only of the rows we had seen.** The IR work (**§6**)
  shows the victim's `$SIR` row can multiply the incoming magnitude (×1.25, ×2), bypass armor
  entirely, or apply it to a pool instead of subtracting it — and that a **shield** pool exists above
  armor. Everything in §0–§5 assumes a standard-damage row against a shieldless victim.
- **`t5` is the RAW magnitude, not the applied damage** — `$HIR` token 5 echoes the magnitude, and the
  victim's `$SIR` row decides what lands (§6.2). The earlier "applied damage, exactly, four weapons"
  reading held only because all four keyed to plain-damage rows.
- The stock Assault Rifle deals **9**, not the manual's 24. The manual is stale.
- Damage drains **shields → armor → HP**; armor overflow spills into shields (§6.1).

| term | formula |
|---|---|
| **htk** | `ceil(115 / dmg)` — see §6.2; this is the raw-`t5` reading and is wrong for five shipped weapons |
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

> ⚠ **Read §6.2 with this section.** The table below is computed on raw `t5`. The `$SIR` table MC
> actually pushes multiplies two of the three subtypes in use, so **five weapons do not deal their
> `t5`** and four of them fall outside the band once that is applied. The numbers here are correct as
> *frame* values and as a balance skeleton; they are not the damage that lands.

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
| Assault Rifle | assault | 9 | 140 | 13 | **1.68** | 64.3 | 49.0 | 32 | 192 | 1400 | 2 / 17 | — | cycle 100→140, res 384→192 |
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

- **Assault Rifle** — the anchor, and the one weapon players arrive already attached to. Cycle 100 →
  **140 ms**, reserve 384 → **192** (17 kills); damage untouched at the captured 9.
  **Retuned 2026-08-30 after the first live match** — Tony: *"the classic assault rifle doesn't feel
  like the native m4 at all. it feels slow."* He was right, and it was deliberate: the previous 190 ms
  was simply the first cycle at which the AR stopped strictly dominating, and it cost the weapon its
  identity. The dominance was never really about rate — it was rate **plus** the deepest pool in the
  game. Paying for speed out of the reserve instead buys back 36 % of the fire rate at zero dominance.
  Measured across the whole arsenal (see the table): at the native 100 ms with a 384 reserve the AR
  strictly dominates **ten** of the seventeen picker weapons; at 140/192 it dominates **none**.
  Shipping the true 100 ms is a one-token change (`wire.fire_ms`) for anyone who wants stock feel over
  a balanced arsenal — it fails `test_ttk_band_and_no_strictly_dominant_weapon`, by design.
- **Burst Rifle** — stock. A real three-round burst the gun enforces, and the most total ammo of the
  burst pair (19 kills).
- **Force Rifle** — the burst rifle's heavier twin: 10 damage instead of 9, so 12 hits instead of 13
  and a faster kill, paid for in half the reserve and a slower five-part reload.
- **Bolt Rifle** — stock. Single shot, 9 hits, 22 kills.
- **SMG** — four kills a magazine, 24 across the kit, and a heat value (`t24 = 5`) — **inert as shipped: overheat requires t37/t38, which only the Charge Rifle carries (bench 2026-08-26)**.
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

### 3.2 Sound overrides — the one sanctioned deviation

The byte-diff pinning test blocks *every* change outside the balance tokens, sound edits included.
That is the point, but the field range turned up two stock sounds that are genuinely wrong, so
`weapons.json` now supports a narrow, explicit escape hatch:

```json
"overrides": { "t33": { "value": "D02", "why": "bench 2026-08-26: captured D21 plays a 'disable' chirp …" } }
```

Applied after the capture base and the balance tokens. Deliberately awkward: an entry must name a
token `protocol-classes.md` has a **name** for, must carry a value, and must carry a `why` — enforced
in `resolve()` and pinned by tests. The pinning test then allows exactly the declared token for that
weapon and nothing else. An undeclared drift still fails.

Two overrides ship, both from the 2026-08-26 field range:

| weapon | token | change | why |
|---|---|---|---|
| Sniper Rifle, AMR, Force Rifle | `t33` reload part 3 | `D21` → `D02` | `D21` fires a "disable" chirp alongside the reload — reproduced on two guns. `D02` is the clean cocking beat the AR/Burst/Bolt chains already end on. |
| Energy Launcher | `t27` fire sound | `J15` → `O01` | `J15` is a **music sting** (`J` = music/SFX in the DK legend), inherited from the "unnamed secondary" frame. `O01` (1.45 s) is an ordnance report; the whole **O** family is otherwise unused by the stock arsenal. |

**Correction to the bench note:** the D21 weapons are the Sniper Rifle, the AMR and the **Force
Rifle** — not the Bolt Rifle. Bolt shares `D04+D03` but its captured chain already ends on `D02`, so
it needs no override; Force Rifle's chain is `D23+D22+D21`. Pinned by a test so the distinction
cannot quietly rot.

Other `O` candidates for a bench audition if `O01` does not sit right: `O05` 1.46 s, `O02` 1.71 s,
`O04` 1.79 s, `O06` 1.81 s, `O03` 2.51 s. Any of them fits the Energy Launcher's 1600 ms cycle.

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

*Status: **PROVEN 2026-08-26** — one-field bench flip (sniper t20 7→0 single→auto; captured Burst Rifle = true 3-round bursts). See §5 U1.*

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
| **U2** | **`t41` range — OPEN with one solid positive**: t41=100 killed at max indoor distance; t41=5 zeros CONTAMINATED by rig degradation (2026-08-26). | the range axis | **IR-instrument A/B** (bench-plan Session 1½a): VS1838B at a fixed distance, `ir-range` detect%/decode% at t41 100 vs 5 + a closing 100 control — no victim gun, ~10 min. Supersedes the two-gun A/B. |
| **U1** | ~~`t20` confirmation~~ ✅ **CLOSED 2026-08-26: PROVEN by one-field flip** — sniper t20 7→0 went single-shot→full-auto on the bench; captured Burst Rifle fired true 3-round bursts (exp-log). | — | done |
| **U4** | **How the 3-part reload chain relates to `reload_ms`.** Six stock frames "overrun" a sequential model, so the model is wrong. | any future reload-sound work | One weapon, one long chain, one stopwatch. Also answers whether `t19` changes it. |
| **U5** | **Does a held trigger retrigger the fire sample from zero, or ring under the next shot?** Decides whether sample duration constrains anything at all. | custom weapon sound design | Fire the AR (1.76 s sample, 190 ms cycle) and listen. |
| **U6** | ~~victim behaviour per damage type~~ — **CLOSED 2026-08-26, then PARTLY REOPENED by the IR work (§6.2).** The hit-SFX half stands. The conclusion *"presentation only; damage is always t5"* does **not**: `t3`/`t4` are the `$SIR` composite key, and the table MC pushes maps two of the three subtypes in use to **multiplier** functions. Damage is `t5 × the row's multiplier`. The earlier test was sound — every row it exercised happened to be a standard-damage row. | §2's balance table (§6.2) | Confirm the multiplier values with a logged bench entry (U10). |
| **U10** | **REOPENED 2026-08-27 — what switches the fn 36/37 multipliers on?** I closed this on a run reading `<0,1>` → 25 and `<0,3>` → 40; a later controlled matrix read **×1.0 in all 24 cells** with a correct fn 1 control. Both runs internally consistent. Our emitter is **exonerated** (§6.2) — the doubling happened inside the gun — so the question is what **gun-side state** differed between the runs, not whether the rig lied. | §2's balance, and whether five weapons need retuning at all | Still worth taking our emitter out of the loop: capture a *real BRX weapon* using fn 36/37 and compare `$HIR` tok5 against the applied `$HP` delta (`brx-protocol.md` §5). |
| **U11′** | **Which status function, if any, is a real STUN? — REOPENED 2026-08-27.** fn 23 is **eliminated**: a trigger pull showed the gun fires and emits IR normally; it is an **audio suppressor**. Category 10 remains unbuilt; next lead is capturing the native Sentinel EMP ability. ~~CLOSED 2026-08-26 — it is function 23.~~ 5/5 reps; the fn-1 control never fired it; it works under protocols 0/5/7/10 alike, so it is the **function**, not the protocol. It clears `$ALCD` **token 2 (100→0)** — the weapon *ready* flag — while **ammo and health are preserved**, and it **self-clears on a ~6–8 s firmware timer** (`$SPAWN` overrides early). ~~5/5 reps zeroed the victim to `$ALCD,0,0,0,0,0` … zeroing t2 *and* the slot is the "live gun, nothing loaded" state.~~ *(That all-zeros reading came from a victim with no loadout configured — superseded, see §6.3.)* | — | done |
| **U7** | ~~Damage ceiling in the IR payload~~ ✅ **CLOSED 2026-08-26** — read straight off the wire on our own VS1838B: the field is **8 bits (max 255)** and the rocket's 115 decoded exactly. A 2× powerup is expressible on anything up to 127. | future powerups | **Now directly readable** — the `D8` field on a VS1838B capture (bench-plan Session 1½b). |
| **U8** | **`t17` vs `t40`.** Every captured frame obeys `t17 == 2 × t40` and we preserve it, but *why* is unknown — is `t40` a per-magazine count and `t17` a total? | nothing today; would matter for a resupply powerup | Set them independently and watch `$ALCD`. |
| **U9** | ~~reserve via $AMMO on re-push~~ ✅ **CLOSED 2026-08-26**: a bare $WEAP re-push resets mag/reserve to the frame's baked-in values — pickups MUST re-send $AMMO (exp-log). | — | done |

**Closed since the first pass:** U0 (fire-mode token → `t20`, §4.1) · U3 (`t19` reload type →
captured, `Shells` on the shotgun) · the burst-token hunt (native burst is `t20 = 9` + `t23`) ·
`t3`/`t4` (captured, no longer guessed — and now known to be the `$SIR` key, **§6**, not just a
damage-type label).

---

## 6. The `$SIR` layer — damage is a negotiation, not a number

**Added 2026-08-26 (third pass), from the IR-emitter bench sessions.** Everything above this section
treats a weapon's damage as `t5` and the victim as a passive 115-point pool. That model is now known
to be incomplete, and in four places actively wrong. This section covers what the IR work opens up
and what it supersedes.

**Sources.** All of it is bench-measured, in `docs/experiment-log.md` (2026-08-26) and
`protocol/brx-ir-protocol.md`. The load-bearing entry is **"the COMPLETE two-sided `$SIR` function
map + crit multiplier + FF enforcement"** — cited below as **[two-sided map]**. It supersedes the
earlier *"`$SIR` FUNCTION MAP enumerated"* sweep, which fired same-team with FF off and therefore
silently blocked the entire damage family; the two entries are one experiment run at both
polarities. Also drawn on: *"THE SPECIAL-WEAPONS TIER IS REAL"* and *"a stock BRX tagger accepted a
FULLY SYNTHETIC shot"*.

Every function-class result carries a **trailing known-good control**, added after an earlier run
produced sixteen clean-looking negatives that were a configuration artifact — worth knowing when
reading any negative result in this area.

> ✅ **Scope: resolved — the classes travel.** An earlier revision of this note warned that each class
> had been measured at a single IR protocol and might not generalise. A controlled matrix across
> protocols **0, 5, 7, 9 and 10** has since found **no cell varying by protocol** (`eb73b0e`), with fn 1
> holding a correct 40 as control throughout. So "fn 6 is armor-piercing" can be read plainly, and a
> weapon designed on protocol 9 gets the same behaviour as one on protocol 0. The caveat was
> over-cautious and is withdrawn.
>
> The one thing that is **not** settled is the fn 36/37 **multiplier magnitude** — see §6.2.

### 6.1 The model

The 8-bit field in the IR word we have been calling "damage" is a **magnitude**. What it is applied
to is decided by the **`$SIR` row** the victim looks up — and that table is ours, pushed over BLE in
every game head (`gameconfig._SIR_TABLE`, sent by `Compiler.compile()`).

- The row is indexed by the composite key **`<protocol, subtype>`** = `$WEAP` **`t3`,`t4`** =
  IR-word fields **B**,**U** (`brx-ir-protocol.md`). 4 bits × 2 bits = **64 addressable effect
  cells**. A hit with no matching row is **silently dropped**.
- The row's **function** decides the effect: damage, add-HP, add-armor, add-shield, or a status
  event that touches no pool (experiment-log, *"SPECIAL-WEAPONS TIER"* — *"`D8` is not 'damage' — it
  is the MAGNITUDE"*).
- Pools drain **shields → armor → HP**, and armor overflow spills into shields.
  > ⚠ **The third pool is discarded in our code, not just under-specified.** `protocol.py` parses only
  > `$HP` token 1, `app/src/engine.js` drops the shield token, and the phone engine — the thing that
  > actually scores a live game — has no concept of shields anywhere. Harmless until now because
  > nothing could fill the pool; it **fails open** the moment a shield charger exists, which is now an
  > evening's work. Pending decision: `docs/spec/node.md` §10-Q12 and FOLLOWUPS Q12.
- **Shields are not a BLE-writable pool.** They fill only from an IR function-11 event — which is
  what closed P16 after `$PSET` shield values had done nothing all session.

So a weapon is a **`<t5, t3, t4>` triple against a table we author**, not a damage number. Two guns
with identical `t5` can do entirely different things.

### 6.2 ⚠ What this supersedes in this document

Four corrections, in descending order of how much they matter.

**1. §2's balance table is computed on raw `t5`, and five weapons do not deal `t5`.** The table MC
actually pushes assigns **multiplier functions** to two of the three subtypes in use — `<0,1>` → fn
36 (**×1.25**) and `<0,3>` → fn 37 (**×2**) **[two-sided map]**. Every weapon whose captured `t4` is 1 or
3 therefore lands more than its `t5`:

| weapon | t3,t4 | `$SIR` fn | multiplier | t5 | effective | htk shipped | htk real | TTK shipped | **TTK real** |
|---|---|---|---|---|---|---|---|---|---|
| Assault Rifle | 0,0 | 1 | standard | 9 | 9 | 13 | 13 | 2.28 | **2.28** |
| Burst Rifle | 0,3 | 37 | **x2** | 9 | 18 | 13 | 7 | 1.70 | **0.85** ⚠ |
| Force Rifle | 0,1 | 36 | **x1.25** | 10 | 12.5 | 12 | 10 | 1.65 | **1.35** ⚠ |
| Bolt Rifle | 0,3 | 37 | **x2** | 13 | 26 | 9 | 5 | 1.80 | **0.90** ⚠ |
| SMG | 0,0 | 1 | standard | 8 | 8 | 15 | 15 | 1.96 | **1.96** |
| Shotgun | 0,0 | 1 | standard | 45 | 45 | 3 | 3 | 1.60 | **1.60** |
| Stinger | 0,0 | 1 | standard | 15 | 15 | 8 | 8 | 1.75 | **1.75** |
| Sniper Rifle | 0,1 | 36 | **x1.25** | 60 | 75 | 2 | 2 | 1.50 | **1.50** |
| Plasma Sniper | 0,0 | 1 | standard | 25 | 25 | 5 | 5 | 1.60 | **1.60** |
| AMR | 0,3 | 37 | **x2** | 24 | 48 | 5 | 3 | 1.60 | **0.80** ⚠ |
| Suppressor | 0,0 | 1 | standard | 8 | 8 | 15 | 15 | 2.24 | **2.24** |
| Energy Rifle | 0,0 | 1 | standard | 9 | 9 | 13 | 13 | 2.40 | **2.40** |
| Charge Rifle | 8,0 | 38 | standard | 100 | 100 | 2 | 2 | 2.50 | **2.50** |
| Rocket Launcher | 10,0 | 1 | standard | 115 | 115 | 1 | 1 | 0.00 | **0.00** |
| Rail Gun | 6,0 | 1 | standard | 115 | 115 | 1 | 1 | 1.20 | **1.20** |
| Laser Cannon | 0,0 | 1 | standard | 115 | 115 | 1 | 1 | 1.50 | **1.50** |
| Energy Launcher | 9,3 | 24 | **landed 0 — mechanism open** | 115 | — | 1 | — | 0.00 | **never kills** |
| Ion Sniper | 0,0 | 1 | standard | 115 | 115 | 1 | 1 | 0.00 | **0.00** |

**Four weapons fall out of the 1.5–3.5 s band once the multiplier is applied**, and the Energy
Launcher's cell `<9,3>` maps to **fn 24, which landed nothing on that key**, so as shipped it
**does no damage at all**. The `htk`/`ttk_ms` fields in `weapons.json` and the band/dominance test in
`test_mc_compile.py` all use raw `t5` and are wrong for those five rows.

**⚠️ DISPUTED — read this table as one of two disagreeing datasets, not as settled.** It was taken
through the real shipped `_SIR_TABLE`, one IR word per row, three trials each, `hits == 1` verified,
with a trailing known-good control (experiment-log 2026-08-26). **A later controlled matrix on the
same bench and emitter read ×1.0 in all 24 multiplier cells**, fn 1 control correct throughout
(`brx-protocol.md` §5 "DISPUTED"). Both runs were internally consistent; no systematic difference
between them has been found.

**Two results from the same measurement context have now failed to reproduce**, which is a pattern
rather than two flukes: the ×2 multiplier, and fn 24 dealing damage on protocol 7. Both original
observations came from sessions with **an operator physically holding the victim gun**; both re-tests
were **unattended, with the gun on the bench**. That is currently the single best-supported difference
between the runs, and it collapses two open questions into one: *what changes about a gun when
someone is holding it?* A concrete candidate is the **sensor struck** — `$HIR` token 1 distinguishes
front dome, back dome and gun body, and a held gun presents a completely different face and incidence
angle to the emitter than one lying on a bench. Whether the sensor that catches the IR affects the
damage applied has never been tested.

**And it cannot be settled from the existing data, which is the real lesson here.** The fn-24 evidence
records no `$HIR` tokens at all — only pool deltas and what the operator heard. So that dataset
neither supports nor kills the sensor hypothesis; it simply cannot speak to it.

**What we now do know is the scope of everything else.** A 20-shot check came back **20/20 at the gun
body** (`$HIR` tok1 = 4), delta 20 every shot, emitter at ~40 cm — the rig cannot produce a dome hit
at all. So the function map should be read as *"measured at the gun-body sensor"*, the same way it
carries a protocol. That converts an unknown condition into a known and uniform one, and it makes the
outstanding question small: **two rows re-measured at a dome**, not the whole map.

> ⚠️ With one limit on how far that reads. At ~40 cm, `$HIR` tok1 plausibly reports which sensor
> **fired first**, not which was struck — IR floods every receiver at close range. So 20/20 at the gun
> body does **not** establish that the domes were never illuminated, only that they never report first
> at this distance. The honest claim is about reporting, not about incidence.

> **Method rule: record the protocol, the `$HIR` token 1, and the firing range beside every pool
> measurement.** All three started as unstated conditions discovered after the fact — protocol first,
> then sensor, then distance — and each cost a re-run or left a dataset unable to answer a question
> retrospectively. Three in two days is a pattern, not bad luck. **The default question for any new
> claim should be "under what conditions is this true?", asked at capture time rather than
> reconstructed later**, because only the protocol one turned out cheap to clear.

**Our emitter is not the explanation, and that matters.** The obvious suspicion was that the rig had
encoded 40 where it meant 20, which would look exactly like a ×2. It didn't: the emitter is
*function-agnostic* — it sends 25 bits, and which function the victim applies is decided by the
victim's own `$SIR` row keyed on `<protocol, subtype>`. In the very run that produced the ×2, a fn 1
control read **20** while fn 37 read **40**, same session, same emitter, same `damage=20`, the words
differing only in the subtype field. Had the rig been sending 40, fn 1 would have read 40 too.
**So the magnitude on the wire was 20 and the doubling happened inside the gun**, which makes the
earlier measurement *more* credible, not less. The open question is what gun-side state differed
between the two runs.

| shipped row | function | magnitude 20 lands as | weapons on that key |
|---|---|---|---|
| `<0,0>` | 1 | **20** (×1) | the other 12 weapons |
| `<0,1>` | 36 | **25** (×1.25) | Force Rifle, Sniper Rifle |
| `<0,3>` | 37 | **40** (×2) | Burst Rifle, Bolt Rifle, AMR |
| `<8,0>` | 38 | **20** (×1) | Charge Rifle |
| `<6,0>` | 1 | **20** (×1) | Rail Gun |
| `<9,3>` | 24 | **0 — no damage at all** | **Energy Launcher** |

The multipliers behave identically through the shipped rows as through the synthetic protocol-5 row
they were first measured on, so the table above is the effective-damage table for the shipped game.

> ⚠ **A measurement artifact worth remembering.** The first pass read the Burst Rifle as unaffected.
> It was not — the trial had counted *registered hits* rather than per-hit damage, and a ×2 multiplier
> is indistinguishable from two registered hits unless you check `hits == 1`. Bolt and AMR registered
> twice and looked wrong; Burst registered once and looked fine. Same bug, opposite appearance.

**Two fixes, and they are not independent.**

1. **Flatten `_SIR_TABLE` to fn 1** everywhere and make multipliers an explicit opt-in per-game
   modifier. This also fixes the Energy Launcher for free, since `<9,3>` would become a damage row.
2. **Retune `t5`** for the five multiplied weapons and separately move the Energy Launcher off `<9,3>`
   (an `overrides` entry on `t3`/`t4`), or change that row's function.

> ⚠️ **This decision may be moot.** If the multipliers do not exist (U10), the shipped table already
> behaves as if flattened and the five weapons deal their `t5` — nothing to fix. Settle U10 first;
> acting now risks retuning five weapons to correct a multiplier that was never there.

**If the multipliers are real, the recommendation is flatten**, and the deciding argument is
asymmetry: flattening restores exactly the §2 numbers, which are *already* band-checked and
dominance-checked, so it costs **zero retune**.
Retuning means recomputing five weapons and re-running the dominance check with multipliers folded in —
and leaves a weapon's real damage depending on *the other player's* config, which is a nasty class of
bug and invisible to every balance tool we have (`htk`, `ttk_ms` and the band/dominance tests all
compute on raw `t5`).

**Not applied here.** The Energy Launcher is a bug and must be fixed either way; *which* fix is right
depends on the flatten decision, so doing it now risks doing it twice. Tony's call — the numbers are
in.

### 6.2b The worse bug: `validate()` passed it

Before the bench found it, an Energy Launcher loadout returned this from `Compiler.validate()`:

```
{'ok': True, 'errors': [], 'warnings': []}
```

A weapon that provably cannot kill anyone armed a live game with **no signal at all** — from the very
function whose job is to catch that. The `mag ≥ htk` invariant computes on raw `t5`, and the Energy
Launcher satisfies it (htk 1, mag 2) while dealing nothing. That blind spot is arguably worse than the
bug it missed.

The root cause is a modelling error, not a missing rule: **damage is a property of the
`(weapon, $SIR table)` pair, never of the weapon alone.** Every tool we had validated the weapon in
isolation, so the entire class was invisible.

`validate()` now cross-checks each loadout weapon's `<t3,t4>` against the table MC is about to push
and warns on three cases:

| case | signature | why it matters |
|---|---|---|
| **no row** for that key | every hit **silently dropped** | the quietest failure of the three — it looks exactly like the hardware refusing, and cost several wasted bench trials |
| function in the **no-pool** family | registers a `$HIR`, moves nothing | the Energy Launcher |
| function is a **multiplier** (36/37) | lands ×1.25 or ×2 | not broken, but `htk`/`ttk_ms` in `weapons.json` are computed on raw `t5` and are wrong for that weapon |

> ⚠ **Warning-only, deliberately and temporarily.** It cannot be an error while the Energy Launcher is
> still broken, because no clean pass exists. **Promote the first two cases to errors in the same
> commit that fixes it** — the code comment and the test name (`..._is_WARNING_ONLY_promote_to_error_
> with_the_energy_launcher_fix`) both carry the reminder. Under flatten the multiplier warning goes
> quiet on its own; under retune it is the prompt to recompute the published numbers.

**2. §0's "no multiplier, no reduction" is wrong.** It holds only for a standard-damage row against a
shieldless victim. The full expression is:

```
applied = t5 × (row multiplier for <t3,t4>) × (1.5 if crit)   → drains shields, then armor, then HP
                                                              ...unless the row is armor-piercing,
                                                              which goes straight to HP
```

**3. `htk = ceil(115 / dmg)` assumes a standard row, no crit, no shields, and armor present.** Against
an armor-piercing row the effective pool is **45 (HP only)**; against a shielded target it is larger
than 115. The `mag ≥ htk` invariant in `validate()` uses the raw-`t5` reading, which is the
*conservative* direction for standard weapons (it over-estimates htk) but **under**-estimates it for
armor-piercing — worth revisiting if AP ever ships.

**4. §5's U6 was closed too strongly.** It was marked resolved on 2026-08-26 with *"mapped types play
a distinct victim hit SFX (presentation only); **damage is always t5**"*. The hit-SFX half is right and
stands. The parenthetical does not: `t3`/`t4` are the `$SIR` lookup key, and the table we push maps two
of the three subtypes in use to multiplier functions, so damage is `t5 × the row's multiplier`. That
earlier test was not wrong — every row it exercised happened to be a standard-damage row (`<0,0>`,
`<10,0>`, `<6,0>`), which is precisely the set for which "damage is always t5" holds. U6 is re-opened
in §5 as **U10**.

One thing this *vindicates*: the first pass recommended reverting every weapon's `t4` to 0 because the
field was unpinned. We never did — re-basing on captured frames preserved it — and `t4` turns out to
be half the `$SIR` key. Reverting it would have collapsed three distinct effect classes into one.

### 6.3 New weapon axes

Five levers that did not exist in the model above.

**Armor-piercing — a real defensive-layer bypass.** Functions **2, 6** (and **17, 21** on their enemy
side) hit HP directly: measured **HP 45 → 25 → 5 with armor untouched at 70** **[two-sided map]**. That turns armor from a flat +70 into
something a weapon class can be built to ignore, and it makes the effective pool weapon-dependent:
115 for a standard weapon, **45** for an AP one. An AP weapon wants a *lower* `t5` than its TTK
suggests. Natural fits: the AMR (already `armor-piercing` in its `t3` semantics), the Rail Gun
(`t3 = 6`), and a dedicated anti-armor pickup.

**Damage multipliers live victim-side.** Fn 36 (×1.25) and 37 (×2) **[two-sided map]** mean a weapon's
punch can be changed **without touching its frame** — by pushing a different `$SIR` table. That is a
per-game modifier surface: a "hardcore" table where everything is ×2, a "juggernaut" table where one
player's protocol is ×0.5. It is also a trap (see §6.2) — the multiplier is invisible at the weapon.

**Dual-polarity weapons: one row, two behaviours.** Functions **16, 17, 20, 21, 22, 23** heal allies
and damage enemies **[two-sided map]**. This is not a fire-mode toggle and needs no host logic: the same
emitted word does opposite things depending on the target's team. A "flux beam" — point at a
teammate to top them up, at an enemy to hurt them — is **one table row**.

It composes with the firmware's own friend/foe gating. Support functions (10/11/13) register **only
from a same-team source** — heal fired at an enemy is silently dropped (experiment-log,
*"SPECIAL-WEAPONS TIER"*: 3/3 same-team, 0/N cross-team) — while **damage is not team-gated at all**
(bench exp 4). `$GSET` token 1 is firmware-enforced, replicated with alternating values **[two-sided map]**:

| `$GSET` t1 | damage same-team | damage enemy | heal from ally | heal from enemy |
|---|---|---|---|---|
| **0** (FF off) | **blocked** | lands | lands | **blocked** |
| **1** (FF on) | lands | lands | lands | lands |

(This also reconciles bench exp 4, which recorded "FF is not firmware-enforced": that run was at
**t1 = 1** and saw same-team damage land — exactly this table's second row. The evidence agreed all
along; only the generalisation to t1 = 0 was unsupported.) **A medic gun enforces "allies only" in hardware, with zero host
logic.**

**Crit is a live mechanic.** The IR word's **C** bit is emittable and echoes on `$HIR` tok6
(`brx-ir-protocol.md`, bench-verified) — **×1.5 damage**, replicated with alternating legs: at
magnitude 20, `crit=0` gave per-hit armor deltas of 20 and `crit=1` gave 30 **[two-sided map]**. It reads 0 on every stock
weapon: not dead, just never set. That is a whole unused axis — a weapon with a crit chance, a
headshot bonus (recall `$HIR` tok1 == 1 is a headset hit, §7r), or a "marked target" perk. Note the
existing `$GSET` `criticalShotModifier` (50 in our config) may interact; untested.

**Three overflow flavours make support weapons distinct.** The add-HP functions differ *only* in
where the overflow goes — **nowhere** (10, 17), **into armor** (9, 12, 16, 19), or **into shields**
(14, 21) (experiment-log, *"FUNCTION MAP enumerated"*). That is a genuine class distinction rather
than a number tweak:

| medic type | function | what a full-health ally gets |
|---|---|---|
| **Field medic** | 10 | nothing — pure top-up, no waste, no reward for overhealing |
| **Armorer** | 9 / 12 / 16 / 19 | plate: healthy allies gain armor |
| **Overshielder** | 14 / 21 | overshield: healthy allies gain a shield buffer that drains first |

Plus **fn 13/15/20/22** (armor only), **fn 11** (shields only — the sole way shields enter the game),
and **fn 18**, a further shields-only grant. (⚠️ An earlier draft called fn 18 a conversion costing
4 HP; re-measured on a clean baseline it leaves **HP and armor untouched** — the apparent cost was a
shifted baseline.)

**Status effects — one now has an observable effect.** A whole family registers a `$HIR` and moves no
pool: enemy-side **3, 8, 23, 24, 25, 26, 27, 28, 35**; friendly-side **31, 32, 34** **[two-sided map]**.
These are the stun/EMP candidates, and until now the problem was that a stun looks identical to an inert
row from the host side, because the effect is on the victim's *ability to fire*.

**❌ RETRACTED 2026-08-27 — function 23 is NOT a weapon disable.** With Tony on the trigger: the magazine decremented shot by shot, and the receiver logged **14 / 21 / 14** IR frames before / during / after — the gun **fires normally**. What it actually does is **silence the gun** (`$ALCD` token 2 = the AUDIO LEVEL, driven 0 → 100 over ~6–8 s; Tony: *"no sound on trigger pull… then a bit louder… then normal"*). A **sensory-disruption** weapon, not a stun — the victim can still fight but loses fire/reload/overheat cues. **Category 10 "Stun" remains unbuilt; U11 is REOPENED.** The original text follows, superseded: ~~Function 23 is a weapon disable — the EMP is real~~ (experiment-log 2026-08-26). Enemy-side fn 23
clears the victim's weapon **ready flag**: `$ALCD` token 2 goes **100 → 0**, 5/5 reps, while the fn-1
control never did, and it fires under **protocols 0/5/7/10 alike** — so the effect belongs to the
*function*, not the protocol.

⚠️ **Corrected:** an earlier draft of this section said the disable produced `$ALCD,0,0,0,0,0` and
"strips the gun to unloaded". With a real loadout the frame is **`$ALCD,32,0,0,192,0`** — **ammo is
preserved** (mag 32, reserve 192 intact) and **only token 2 changes**. The all-zeros reading came from
a victim that had no weapon/ammo configured at all. Health is untouched too.

Design consequences — **corrected 2026-08-27, this is NOT a stun:**

- **`$SIR,<proto>,<sub>,,23` is an AUDIO SUPPRESSOR**, not a disabler. A weapon keyed to that cell
  **silences** its target: the victim keeps firing and keeps emitting IR, they just lose their gun's
  audio for ~6–8 s. A **sensory-disruption** weapon — no fire sound, no reload chain, no overheat cue.
  ~~`$SIR,<proto>,<sub>,,23` is an EMP … any weapon keyed to that cell becomes a disabler.~~
- **The ~6–8 s timer, `$SPAWN`-clears-it and `$AMMO`-does-not are all correctly MEASURED — but they
  describe the `$ALCD` token 2 AUDIO METER, not a disable.** Disabled-looking at 2.5 s and 5.3 s, back
  to 100 by 8.0 s, 3/3 reps. `$AMMO` and `$WEAP` re-pushes do not move it; `$SPAWN` does (and also
  restores health).
- ~~Weapon category 10 ("Stun") is now buildable.~~ **Still UNBUILT.** No `$SIR` function has produced
  a stun. `$STUN`-over-BLE remains a no-op. **U11 is REOPENED** — the live lead is to capture the
  **native Sentinel EMP ability** and read its protocol/subtype off the wire.
- ~~Inference: a stunned player has burned a reload.~~ **Withdrawn** — ammo is preserved.
- ✅ **A human DID pull the trigger (2026-08-27), and it disproved the disable.** The operator's
  magazine decremented shot by shot during the effect, and a receiver logged **14 / 21 / 14** IR frames
  before / during / after — the gun fires and emits normally throughout.
  ~~Still unconfirmed by a human: that the trigger genuinely does nothing during the window.~~

**Three clean negatives worth carrying** — each one closes a design direction someone would otherwise
spend a session on:

- **All 16 protocols accept damage** given a fn-1 row, so there is no protocol whitelist and the 4-bit
  field is not a scarce resource **[two-sided map]**.
- **`$SIR` row parameters p5–p8 do not scale damage** — five different shapes all landed exactly the
  magnitude **[two-sided map]**. Whatever they do, it is not a multiplier.
- **No function tested is a damage-over-time.** Each of 3/8/23/24–28/35 and 31/32/34 was fired once and
  watched for 18 s: **no HP ticks without further shots** (IR bench, 2026-08-26). So poison, cryo and
  incendiary — all named in the `DamageType` enum and in the manual's perk list — are **not** `$SIR`
  functions that tick a pool. If we want a DoT it has to be host-driven (repeat emissions from a
  station, or a Companion applying `$BHIT` on a timer), not a fire-and-forget effect.
  > ⚠️ Note this list is no longer a "status function" list: **24, 25, 26 and 27 were later found to
  > deal damage on protocol 7**, having moved no pool on protocol 5. The DoT negative is unaffected —
  > none of them ticked — but do not read membership here as "inert".

### 6.4 What a weapon is now

The design space widened from one number to five independent choices:

| choice | token / field | what it decides |
|---|---|---|
| magnitude | `$WEAP` `t5` | how much |
| effect class | `$SIR` row function for `<t3,t4>` | damage / AP / multiplied / heal / armor / shield / status |
| polarity | function (dual-polarity set) | whether allies and enemies get different outcomes |
| crit | IR word **C** bit | ×1.5, per shot, ours to set |
| fire behaviour | `$WEAP` `t20`, `t23`, `t24`, `t37`/`t38` | full-auto / single / burst / charge / overheat |

None of it needs a Companion or host logic in the loop — the tagger applies the effect natively from
a table we wrote at game start. The practical consequence for this document is that **§2's single-axis
balance (damage × cadence × ammo) is now the *floor* of the design, not its ceiling**, and the next
rebalance should treat the `$SIR` table as a first-class part of a weapon's definition rather than a
fixed backdrop.

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
| `t3` `t4` | the **`$SIR` composite key** — selects the victim-side effect, including multipliers (§6) | ❌ inherited from the capture |
| `t19` `t20` `t23` `t24` `t25` `t26` `t27–36` `t41` `t42` | reload type, **fire mode**, burst, overheat, muzzle flash, all sounds, ranges | ❌ inherited from the capture |
| declared `overrides` | one named token per entry, with a stated reason (§3.2) | ✅ where declared |
| `t7–t13` | secondary fire | ❌ empty on all twenty stock weapons — no BRX weapon has an alt-fire |
