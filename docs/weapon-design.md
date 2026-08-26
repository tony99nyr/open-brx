# Weapon design & balance

The reference for **what our weapons are, why their numbers are what they are, and which sounds
they should make**. Written 2026-08-26 from the in-repo sources only — no new hardware work.

- **Roster + wire tables:** `mcp/brx_mcp/mc/weapons.json` (19 weapons; the `wire` block is what
  `WeaponCatalog.resolve()` stamps into the `$WEAP` frame).
- **Wire semantics:** `protocol/callsign-extract/protocol-classes.md` (the 44-token `$WEAP` map +
  the enums), `protocol/brx-protocol.md` §7r (bench truth for the damage model).
- **Sound bank:** `protocol/callsign-extract/sound-bank.md` (2166 ids with durations; prefix legend
  credited to David Knox, shared by the owner community).
- **Bench procedure:** `docs/weapon-test-protocol.md`.

Protocol discovery credit: **LaserTagMods** (JEDGE/JBOX). Nothing here modifies stock firmware —
every value below is a number we send over BLE in a `$WEAP` frame.

> **Status: proposal.** §1 and §3 are analysis of what is in the repo right now. §2 is a rebalance
> that has **not** been applied to `weapons.json` and has **not** been fired on hardware. Every
> provisional weapon stays provisional until the bench says otherwise.

---

## 0. The damage model (what is actually hardware-true)

From `brx-protocol.md` §7r, observed directly on two taggers:

- The default pool is **115 = 45 HP + 70 armor** (`compile.py` `health: {max_hp: 45, max_armor: 70}`).
- **Armor absorbs at face value and spills into HP** — 70 → 46 → 22 → 0, then `$HP,43,0,0` at
  24 damage a hit. There is no armor multiplier and no damage reduction.
- **Kill in 5 hits at 24 damage**, matching the sim.
- `$HIR` token 5 = the damage applied = the `$WEAP` damage field, so the number we write is the
  number that lands.

So the naive arithmetic is the real arithmetic, and the caveat in `weapon-test-protocol.md`
("hits-to-kill above is naive dmg math") can be **upgraded to confirmed for the AR**, with the
same model assumed for everything else until a second weapon is bench-fired.

Definitions used throughout:

| term | formula | note |
|---|---|---|
| **htk** | `ceil(115 / dmg)` | hits to kill at the default pool |
| **TTK** | `charge_ms + (htk-1) × fire_ms` | first trigger pull to kill, all shots landing |
| **DPS** | `dmg / fire_ms` | burst damage rate |
| **sustained DPS** | `mag×dmg / (mag×fire_ms + reload_ms)` | includes one reload |
| **mag kills / total kills** | `mag // htk` / `(mag+reserve) // htk` | ammo economy |

TTK is the honest headline number; DPS flatters weapons that need many hits, and **every hit is a
discrete IR event that can miss**, so a 10-htk weapon is far worse than its DPS suggests.

---

## 0.1 Hard constraints from the bench (2026-08-26)

Tony ran our built `$WEAP` frames on a real tagger. Three findings constrain everything below, and
the first one constrains it hard. Verdicts are logged to `~/.brx-mcp/weapon-verdicts.jsonl` on the
MC host (`burst_rifle`, `sniper_rifle`, `shotgun`, `smg` — all "issue"). Further bench runs are on
hold pending this document.

### C1 — Everything we build is FULL-AUTO. There is no semi-auto yet.

The sniper rifle and the shotgun both **fired full-auto on a held trigger**. That is not a tuning
problem, it is a missing field: **all four frames we have captured** — `ar`, `charge`, `laser`,
`rocket` — are full-auto, so every weapon `resolve()` builds inherits full-auto. The semi/bolt
fire-mode flag lives in the `$WEAP` tokens we have never pinned (the same hunt as the burst token,
§4.4).

Consequences for this document:

- **The rebalance below cannot use fire mode as a design lever.** Nothing in §2 depends on it.
- **`fire_ms` is the only rate control we have**, and it is a weak approximation of semi-auto: an
  1800 ms sniper still fires forever on a held trigger, it just does it slowly. A player who holds
  the trigger gets the weapon's full DPS with zero trigger discipline, so **DPS and TTK are always
  achievable, never aspirational** — which is exactly the assumption the numbers in §2 make.
- **Low-htk weapons are what this hurts.** A 2-hit shotgun on full-auto is an auto-shotgun that
  kills in under a second with no skill expressed. §2.2 therefore keeps the shotgun at **3 hits**
  and leaves the 2-hit version as an explicit *"apply once semi-auto is captured"* note.
- **Capturing the fire-mode token is the single highest-value protocol task open.** It is worth
  more to weapon feel than every damage number in §2 combined. See U0 in §5.

**Update — 2026-08-26 bench:** `fire_ms` is now REAL, and the fire-mode hunt is largely retired. Two
things changed. (1) The rate field was **proven**: a sniper built with fire-interval `tok14=1250`
fired exactly 1 shot/s. (2) A compiler bug that had made `fire_ms` inert was fixed — it wrote the
value into the constant `tok15` (`850` in every capture), so every weapon had actually been running
at the AR sample's `tok14=100` → **10 shots/s**, not its configured cadence. With `compile.py` now
writing fire→`tok14` (commit c606417), the `fire_ms` values in §2 finally take effect on hardware.
The full-auto limit above is unchanged (a held trigger still auto-fires at that cadence; semi-auto is
still unenforceable), but the rebalance's cadences are now **real cadences, not inert numbers** — and
the "highest-value task" framing above no longer holds: the bad feel was the rate bug, now fixed, and
a true semi-auto mode probably does not exist to capture (`GunWeaponType` has no semi member — C2).

### C2 — There is no native burst fire.

Confirmed on hardware: the Burst Rifle built on the `ar` sample with `subtype: 3` **does not
burst**. This matches the `GunWeaponType` enum from the APK teardown (`FullAutoFire, Bow,
ChargeAndAutoRelease, ChargeAndRelease`), which has **no burst member**. The open followup to
"capture the burst token" should be closed: a burst rifle can only be a fast-cadence weapon with
burst-shaped audio until proven otherwise.

### C3 — The SMG sound is miscast.

`G10` reads as a **heavy machine gun**, not a submachine gun — despite the DK legend identifying it
as "SMG-x3". The SMG needs a small, fast, low-calibre report. See §3.5 for what the bank actually
offers at that cadence; the short answer is that the entirely-unused **P** family is the best
candidate, and taking it requires relaxing the SMG's cadence to ~400 ms.

**Otherwise the bench was clean:** the damage/TTK model held, and weapon switching, fire sounds and
reload chains all landed correctly via `tutorial_frames`.

---

## 1. Current state

### 1.1 Per-weapon identity table

`dmg`/`fire`/`chg` are the literal `wire` values; the two **HW** rows carry no `wire` block and
these are read out of their captured hardware tails (`WEAPON_TAILS`). `x` = fire-sound duration ÷
fire interval (see §3.2). Reserve is delivered by `$AMMO`, not by the `$WEAP` frame.

> ⚠️ **Pre-fix / theoretical — corrected 2026-08-26.** Two problems make this "current state" table
> describe a config that **never physically ran on hardware**:
> 1. **Fire/charge are swapped on the HW rows.** The bench proved `tok14` = the *fire interval*
>    (`protocol/brx-protocol.md` §6.1), so the AR's real cadence is the **`100` shown under `chg ms`**
>    (`tok14` → 10 shots/s), and the `850` under `fire ms` is the unknown constant `tok15`. The HW
>    rows' `fire ms`/`x`/TTK/DPS are computed from the wrong field.
> 2. **Authored `fire_ms` never reached the gun.** Until tonight's compiler fix it was written to the
>    constant `tok15`, so every `prov` weapon physically fired at the `ar` sample's `tok14=100 ms`
>    (10 shots/s), not its listed cadence.
>
> Read the `fire ms`/`x`/TTK/DPS/sust here as **pre-fix/theoretical** and recompute against real
> `tok14` values on the next revision. **§2.2's forward-looking column is unaffected** and, post-fix
> (compiler commit c606417), is now **real** — its cadences land on the gun.

| weapon | cls | ver | dmg | fire ms | chg ms | htk | TTK s | DPS | sust | mag | res | reload | mag/total kills | fire snd | x |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Assault Rifle | 0 Rifle | **HW** | 24 | 850 | 100 | 5 | **3.40** | 28.2 | 26.9 | 32 | 384 | 1400 | 6 / 83 | R01 | 2.07 |
| Burst Rifle | 0 Rifle | prov | 14 | 180 | — | 9 | **1.44** | 77.8 | 61.6 | 36 | 216 | 1700 | 4 / 28 | R07 | **9.00** |
| Bolt Rifle | 0 Rifle | prov | 30 | 700 | — | 4 | 2.10 | 42.9 | 37.0 | 18 | 180 | 2000 | 4 / 49 | R05 | 2.67 |
| Force Rifle | 0 Rifle | prov | 24 | 850 | — | 5 | 3.40 | 28.2 | 26.7 | 36 | 144 | 1700 | 7 / 36 | R09 | 1.67 |
| SMG | 1 SMG | prov | 12 | 400 | — | 10 | **3.60** | 30.0 | 27.6 | 72 | 288 | 2500 | 7 / 36 | G10 | **3.30** |
| Suppressor | 1 SMG | prov | 20 | 500 | — | 6 | 2.50 | 40.0 | 36.9 | 48 | 288 | 2000 | 8 / 56 | Q06 | 0.98 |
| Sniper Rifle | 2 Sniper | prov | 60 | 1500 | — | 2 | 1.50 | 40.0 | 31.2 | 4 | 24 | 1700 | 2 / 14 | S16 | 1.07 |
| Plasma Sniper | 2 Sniper | prov | 55 | 1300 | — | 3 | 2.60 | 42.3 | 36.7 | 10 | 80 | 2000 | 3 / 30 | E17 | 1.15 |
| Ion Sniper | 2 Sniper | prov | 80 | 2000 | — | 2 | 2.00 | 40.0 | 26.7 | 2 | 12 | 2000 | 1 / 7 | E20 | 0.76 |
| Shotgun | 3 Shotgun | prov | 50 | 1100 | — | 3 | 2.20 | 45.5 | 42.9 | 6 | 24 | **400** | 2 / 10 | T14 | 0.81 |
| AMR | 4 Heavy | prov | 40 | 900 | — | 3 | 1.80 | 44.4 | 40.0 | 14 | 56 | 1400 | 4 / 23 | R04 | 2.71 |
| Laser Cannon | 4 Heavy | prov | 150 | 1600 | *1000 silent* | 1 | **0.00** | 93.8 | 71.4 | 4 | 8 | 2000 | 4 / 12 | E07 | 2.79 |
| Charge Rifle | 5 Energy | **HW** | 150 | 850 | 1250 | 1 | 1.25 | 176.5 | **171.4** | 100 | 200 | 2500 | **100 / 300** | E03 | 1.79 |
| Energy Rifle | 5 Energy | prov | 10 | 200 | — | 12 | 2.20 | 50.0 | 48.1 | 300 | 600 | 2400 | 25 / 75 | E01 | **6.00** |
| Stinger | 6 Support | prov | 30 | 600 | — | 4 | 1.80 | 50.0 | 43.2 | 18 | 72 | 1700 | 4 / 22 | E14 | 2.13 |
| Rail Gun | 7 Power | prov | 90 | 2200 | 1800 | 2 | 4.00 | 40.9 | 19.6 | **1** | 6 | 2400 | **0 / 3** | O03 | 1.14 |
| Energy Launcher | 9 Launcher | prov | 95 | 2000 | 1500 | 2 | 3.50 | 47.5 | 27.9 | **1** | 6 | 1400 | **0 / 3** | E08 | 1.03 |
| Rocket Launcher | 9 Launcher | prov | 115 | 1800 | *1000 inherited* | 1 | **0.00** | 63.9 | 47.9 | 2 | 8 | 1200 | 2 / 10 | C03 | 1.74 |
| *Melee (hidden)* | 12 Melee | **HW** | 90 | 100 | 1000 | 2 | 1.10 | — | — | 1 | 0 | — | 0 / 0 | M92 | 7.70 |

`cls` values are the Callsign **WeaponCategory** ids (`weapon-categories-config.json`): 0 Rifle,
1 SMG, 2 Sniper, 3 Shotgun, 4 Heavy, 5 Energy, 6 Support, 7 Power, 8 Exotic, 9 Launcher, 10 Stun,
12 Melee. They are the app's UI grouping; whether they map to any `$WEAP` token is untested.

### 1.2 What the numbers say

**Four weapons are broken, not merely unbalanced.**

1. **Rail Gun and Energy Launcher cannot kill on a magazine.** Both need 2 hits (90 and 95 damage
   against a 115 pool) and both carry `mag: 1`. A kill costs charge + shot + full reload + charge
   again — about **8.2 s** for the rail gun and **6.4 s** for the energy launcher. They are the two
   worst weapons in the arsenal while being labelled Power and Launcher. **`mag ≥ htk` is a hard
   invariant** and nothing enforces it today.
2. **Charge Rifle is strictly dominant.** 150 damage one-shots the pool, and it carries a
   **100-round magazine with 200 in reserve — 300 kills** at 171 sustained DPS. It beats every
   other weapon on every axis simultaneously. It is a *verified hardware frame*, i.e. this is
   genuinely what Battle Company ships in that slot, which is exactly why it should not sit in an
   open picker next to a 5-hit assault rifle.
3. **Laser Cannon one-shots for free.** 150 damage, no charge cost on the wire (`fire_ms` 1600),
   4 in the mag and 8 in reserve — **12 one-shot kills** with no drawback beyond ammo.
4. **Rocket Launcher one-shots for free too**, at exactly 115 damage — one point of health config
   away from becoming a 2-hit weapon (see §2.4).

**The assault rifle is the slowest killer in the game** (TTK 3.40 s). Everything else is faster.
Its actual edge is the ammo pool — 384 in reserve, 83 kills, the deepest in the arsenal — but
nothing in the UI or the numbers communicates that as a role.

**Force Rifle is an exact Assault Rifle clone**: 24 damage at 850 ms, same htk, same TTK, same DPS.
The only differences are mag 36 vs 32 and reserve 144 vs 384 — i.e. it is a *worse* AR.

**Three snipers, one of which is strictly better.** Sniper Rifle (60 dmg, htk 2, TTK 1.50) beats Ion
Sniper (80 dmg, htk 2, TTK 2.00) on speed and carries 14 kills to Ion's 7. At the default pool the
extra 20 damage buys nothing, because both are 2-hit kills.

**Burst Rifle is now the fastest non-power killer** (TTK 1.44 s at 77.8 DPS) and needs 9 hits to
get there — the worst of both worlds: strong on paper, brutal to actually land over IR.

**Two levers that would create real identity are never written** (see §4): weapon **range** and
**reload type**. Every weapon fires at the same 75 % range except the rocket launcher, which
inherits 30 % from its captured sample. The `rng` field in `weapons.json` (5–100) is a **cosmetic
UI bar only** — the Sniper Rifle displays `rng: 100` and fires at the same range as the SMG.

---

## 2. Rebalance proposal

### 2.1 Principles

1. **Roles before numbers.** Five tiers — Assault, CQB, Marksman, Support, Power — and every
   weapon must be the best in the arsenal at *something*.
2. **No strict dominance.** No weapon may be ≥ another on TTK, sustained DPS, total kills **and**
   range at once. Checked mechanically; see §2.3.
3. **Primary TTK band 1.5–3.5 s**, with one documented exception (§2.2).
4. **`mag ≥ htk`, always.** A weapon that cannot kill on one magazine is a bug.
5. **One-shot weapons pay a real price** — a charge, a 2-round magazine, ≤ 4 total kills, and a
   long reload. The Power tier is a pickup tier, not a loadout choice.
6. **`htk` is the design unit, not DPS**, because IR hits are discrete and misses are the norm.
   Keep htk in a tight set (1–2 power/marksman, 3–4 mid, 5–6 assault, 8–10 sustain).
7. **Assume the trigger is always held.** Until the fire-mode token is captured (C1), every
   weapon is full-auto, so a weapon's numbers must be balanced at their *maximum* rate. No design
   here relies on the player choosing to fire slowly.
8. **The Assault Rifle stays exactly as captured.** It is one of only two ground-truth frames and
   the calibration anchor for everything else. Its role is *deepest ammo pool, longest sustain*.

### 2.2 Proposed table

`dt` = the tok3 damage-type value proposed in §4.1. `rng` = the tok41 gun-range % proposed in §4.2.

| weapon | role | dmg | fire ms | chg ms | htk | **TTK** | DPS | sust | mag | res | reload | mag/total kills | rng | dt | fire snd | x |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Shotgun | CQB | 45 | 750 | — | 3 | **1.50** | 60.0 | 45.8 | 6 | 24 | 1400 | 2 / 10 | 25 | 12 ShottyPellets | T14 | 1.19 |
| Burst Rifle | Assault | 20 | 320 | — | 6 | **1.60** | 62.5 | 52.2 | 30 | 120 | 1900 | 5 / 25 | 65 | 0 Standard | G02 | 1.69 |
| Sniper Rifle | Marksman | 60 | 1800 | — | 2 | **1.80** | 33.3 | 25.5 | 4 | 20 | 2200 | 2 / 12 | 100 | 0 Standard | S16 | 0.89 |
| Plasma Sniper | Marksman | 40 | 950 | — | 3 | **1.90** | 42.1 | 34.4 | 9 | 72 | 1900 | 3 / 27 | 85 | 14 Plasma | E17 | 1.57 |
| SMG | CQB | 20 | 400 | — | 6 | **2.00** | 50.0 | 45.0 | 50 | 200 | 2200 | 8 / 41 | 45 | 0 Standard | P-family (§3.5) | 1.72 |
| Stinger | CQB | 23 | 500 | — | 5 | **2.00** | 46.0 | 40.6 | 24 | 120 | 1600 | 4 / 28 | 55 | 7 EMP | L06 | 1.16 |
| AMR | Support | 40 | 1000 | — | 3 | **2.00** | 40.0 | 34.5 | 12 | 48 | 1900 | 4 / 20 | 90 | 6 ArmorPiercing | O05 | 1.46 |
| Ion Sniper | Marksman | 95 | 2200 | — | 2 | **2.20** | 43.2 | 27.9 | 2 | 10 | 2400 | 1 / 6 | 100 | 7 EMP | E20 | 0.69 |
| Bolt Rifle | Assault | 30 | 750 | — | 4 | **2.25** | 40.0 | 34.8 | 18 | 180 | 2000 | 4 / 49 | 85 | 0 Standard | R18 | 2.00 |
| Energy Rifle | Support | 12 | 250 | — | 10 | **2.25** | 48.0 | 45.1 | 150 | 300 | 2400 | 15 / 45 | 60 | 14 Plasma | L07 | 1.56 |
| Force Rifle | Assault | 29 | 800 | — | 4 | **2.40** | 36.2 | 33.4 | 28 | 224 | 1900 | 7 / 63 | 75 | 6 ArmorPiercing | R09 | 1.77 |
| Suppressor | Support | 20 | 500 | — | 6 | **2.50** | 40.0 | 36.9 | 48 | 288 | 2000 | 8 / 56 | 50 | 0 Standard | Q06 | 0.98 |
| **Assault Rifle** | Assault | 24 | 850 | 100 | 5 | **3.40** | 28.2 | 26.9 | 32 | 384 | 1400 | 6 / **83** | 75 | 0 Standard | R01 | 2.07 |
| Rocket Launcher | Power | 115 | 2500 | — | 1 | **0.00**† | 46.0 | 30.3 | 2 | 2 | 2600 | 2 / 4 | 30 | 10 LethalExplosive | C03 | 1.26 |
| Energy Launcher | Power | 115 | 2000 | 1000 | 1 | **1.00** | 57.5 | 35.9 | 2 | 2 | 2400 | 2 / 4 | 45 | 14 Plasma | E08 | 1.03 |
| Laser Cannon | Power | 150 | 2400 | 1200 | 1 | **1.20** | 62.5 | 40.5 | 2 | 2 | 2600 | 2 / 4 | 60 | 14 Plasma | E07 | 1.86 |
| Rail Gun | Power | 115 | 2400 | 1600 | 1 | **1.60** | 47.9 | 31.1 | 2 | 2 | 2600 | 2 / 4 | 100 | 6 ArmorPiercing | O03 | 1.05 |
† Rocket TTK is 0.00 s because it is a one-shot kill with no charge — the trigger pull *is* the kill. Its cost is entirely in the 2.5 s cycle, the 2-round magazine and 30 % range.

| *Charge Rifle* | **calibration / pickup** | *150* | *850* | *1250* | *1* | *1.25* | *176.5* | *171.4* | *100* | *200* | *2500* | *100 / 300* | *75* | *8* | *E03* | *1.79* |

**Role identities in one line each**

- **Assault Rifle** — the anchor. Slowest TTK, *deepest pool in the game* (83 kills). Never edited:
  it is ground truth. Pick it for a long game with no ammo resupply.
- **Force Rifle** — armor-breaker. 4 hits instead of 5, 63 kills, second-deepest pool. Was an AR
  clone; now it trades reserve for one fewer hit.
- **Bolt Rifle** — the long assault rifle. 85 % range, 4 hits, 49 kills.
- **Burst Rifle** — the aggressive one. Highest assault DPS, half the ammo economy of the AR,
  shortest assault range. Rewards landing 6 fast hits, punishes spray.
- **SMG** — volume at knife range. 41 kills, 45 % range, 6 hits to drop. Cadence relaxed from
  270 ms to 400 ms specifically to open up the P-family fire sounds (C3, §3.5).
- **Shotgun** — fastest TTK in the arsenal outside the Power tier (1.50 s), at 25 % range and
  10 total kills. Held at 3 hits by C1: see the note below.
- **Stinger** — the disruptor (EMP damage type). Mid cadence, mid range, deepest CQB ammo pool.
- **Sniper Rifle** — 2 hits at maximum range, 12 kills. The reference marksman.
- **Plasma Sniper** — the forgiving marksman. 3 hits, fastest marksman cadence, 27 kills.
- **Ion Sniper** — one magazine, one kill. Hardest single hit outside the Power tier, and the
  damage matters at raised health configs and for damage-weighted scoring (FOLLOWUPS P10).
- **AMR** — long-range 3-hit heavy with the smallest sustain pool of the rifles.
- **Suppressor** — pins a lane. Deepest sustained fire, lowest rifle range, quietest signature.
- **Energy Rifle** — the hose. 15 kills per magazine, 10 hits each, no burst threat.
- **Power tier** (Rocket / Laser / Rail / Energy Launcher) — one-shot kills, **2-round magazine,
  4 total kills**, 2.4–2.6 s reloads, each differentiated by range and charge: Rocket is the
  no-charge short-range one, Energy Launcher the fastest (1.0 s), Laser the hardest-hitting,
  Rail the long-range one with the longest wind-up.
- **Charge Rifle** — pulled from the picker. Keep the stock frame verbatim as the second
  calibration reference and as a pickup/power reward. Editing it forfeits `verified: true`.

**Every TTK now sits inside the 1.5–3.5 s band**, with no exception needed — the full-auto
constraint (C1) tidied the design rather than complicating it. The shotgun was drafted as a 2-hit
weapon (58 damage, 0.90 s TTK) before the bench; on full-auto that is an auto-shotgun, so it is
held at 3 hits.

> **Apply once semi-auto is captured (U0):** shotgun → `dmg: 58`, `fire_ms: 900` (htk 2,
> TTK 0.90 s), and revisit the sniper cadences, which are currently slowed only to approximate
> single-shot fire. That is the single change waiting on the fire-mode token.

### 2.3 Dominance check

Run mechanically over the 17 picker weapons (Charge Rifle excluded as calibration tier): for every
ordered pair, is A ≥ B on all four of {TTK speed, sustained DPS, total kills, range} with at least
one strict? Result: **no pair**. Each weapon is beaten by something on at least one axis.

For contrast, the same check on the current roster returns 15 dominated pairs, 8 of them by the
Charge Rifle alone.

### 2.4 Health-config sensitivity (important)

`htk` is a function of the health config, and MC lets a host change it per game. At the proposed
damage values:

| weapon | 45/55 (100) | **45/70 (115, default)** | 50/100 (150) | 100/100 (200) |
|---|---|---|---|---|
| Sniper Rifle | 2 | **2** | 3 | 4 |
| Ion Sniper | 2 | **2** | 2 | 3 |
| Plasma Sniper / AMR / **Shotgun** | 3 | **3** | 4 | 5 |
| Bolt Rifle / Force Rifle | 4 | **4** | 5–6 | 7 |
| Assault Rifle / Stinger | 5 | **5** | 7 | 9 |
| Burst Rifle / Suppressor / **SMG** | 5 | **6** | 8 | 10 |
| Energy Rifle | 9 | **10** | 13 | 17 |
| Power tier (115 dmg) | 1 | **1** | **2** | 2 |
| Laser Cannon (150 dmg) | 1 | **1** | 1 | 2 |

Two consequences:

- **At a 150 pool the 115-damage power weapons stop one-shotting.** That is exactly the bug that
  breaks the current rail gun. The proposed `mag: 2` keeps `mag ≥ htk` true all the way to a
  230 pool, which is why the Power tier is 2/2 rather than 1/3.
- **MC should surface htk, not a damage bar.** The Kit panel already has the numbers; computing
  `ceil(pool / dmg)` against the *live* health config and showing "3 HITS" is far more useful than
  a 0–100 bar, and it makes a bad health/weapon combination visible before the match instead of
  during it.

### 2.5 Migration

Nothing here is applied. Suggested order, each independently shippable:

1. **Invariant first** — add a `mag ≥ ceil(pool/dmg)` assertion to `Compiler.validate()` so the
   rail-gun class of bug cannot ship again. This is worth doing even if none of the rest lands.
2. **Fix the four broken weapons** (§1.2) — smallest diff, biggest gameplay change.
3. **Pull the Charge Rifle from the picker** (a `tier` field, or reuse the existing `hidden`
   mechanism) while keeping its frame byte-identical.
4. **Apply the §2.2 table**, then re-run the dominance check as a test.
5. **Sound pass** (§3) — independent of the numbers except where cadence changed.
6. **Bench** per `weapon-test-protocol.md`; that table's Burst Rifle row (14 dmg / 180 ms) already
   drifted out of sync with `weapons.json` once, so regenerate it from `weapons.json` rather than
   maintaining it by hand. Add a `desc` and the new columns while regenerating.
7. **In parallel, chase U0** (the fire-mode token). It does not block any of the above, and it is
   worth more to how the weapons feel than the whole of steps 2–5.

---

## 3. Sound assignment audit

### 3.1 What is on the device

2166 ids, grouped by prefix. The families that matter for weapons, with their **duration ranges** —
duration is the constraint that decides what a sound can be used for:

| prefix | meaning (DK legend) | n | duration range | shortest few |
|---|---|---|---|---|
| **R** | gun shots (rifles) | 47 | 0.52–5.02 s | R122 0.52, R106 0.81, R20 0.96 |
| **G** | gun shots (SMG family; G10 = SMG-x3) | 23 | 0.54–2.00 s | G02 0.54, G21 0.78, G09 0.81 |
| **P** | gun shots | 18 | 0.69–2.13 s | P15 0.69, P02 0.74, P05 0.95 |
| **S** | gun shots (S16 = SR-100 sniper) | 19 | 1.12–4.13 s | S07 1.12, S18 1.60, S16 1.61 |
| **T** | gun shots (T14 = TAC-87 shotgun) | 16 | 0.84–1.80 s | T02 0.84, T14 0.89, T09 1.17 |
| **O** | big guns / ordnance | 6 | 1.45–2.51 s | O01 1.45, O05 1.46, O02 1.71 |
| **Q** | silencers | 7 | 0.21–0.86 s | Q04 0.21, Q03 0.23, Q02 0.29 |
| **L** | electrical | 7 | 0.36–4.50 s | L04 0.36, L07 0.39, L06 0.58 |
| **E** | sci-fi SFX (E01–E32 base) | 32 | 0.58–4.46 s | E27 0.58, E13 0.65, E29 0.68 |
| **C** | sci-fi SFX (C15/C17 = stock charge up/down) | 21 | 1.02–3.96 s | C14 1.02, C05 1.18, C10 1.19 |
| **X** | grenades / explosions | 51 | 0.09–8.06 s | X37 0.09, X47 0.16, X50 0.36 |
| **D** | cocking | 69 | 0.05–3.92 s | D18 0.12, D23 0.14, D26 0.15 |
| **W** | **reloads** | 74 | 0.27–8.72 s | W09 0.27, W08 0.33, W40 0.40 |
| **B** | bow / arrow | 31 | 0.23–1.98 s | B12 0.23, B31 0.36, B10 0.37 |
| **SW** | Star Wars | 34 | 0.27–28.26 s | SW15/SW16 0.27, SW11 0.46 |
| **H** | hit SFX (victim side; H02 = rail, X13 = rocket) | 59 | 0.37–6.35 s | — |

Two notes on the legend: the **E_\*** ids (E_VA…, E_VB…, E_X…) are alternate takes of other ids and
are not part of the E01–E32 weapon family. And **ST** ("sci-fi mortars/rockets" in the DK legend)
has **no group in `Sounds.json`** — there are no `ST*` ids, only `S01–S19` and `SW*`. Worth a line
in the legend when the sound-bank page gets rebuilt (FOLLOWUPS B9).

### 3.2 The rule that actually matters: duration vs cadence

A fire sound is retriggered on every shot. The stock Assault Rifle — captured from real hardware,
therefore known-acceptable — plays a **1.76 s** sample at an **850 ms** cadence: a **2.07×**
overlap. That gives a usable ceiling:

> **`fire_sound_duration ÷ fire_ms ≤ 2.07`** — the stock AR's ratio. Above that the sample never
> gets near its tail and the weapon turns to mush; the higher the ratio the more every weapon
> sounds like the same truncated bark. This is a design guideline, not a firmware limit.

Current roster against that ceiling:

| weapon | fire snd | dur | fire ms | x | verdict |
|---|---|---|---|---|---|
| Energy Rifle | E01 | 1.20 s | 200 | **6.00** | ✗ worst in the arsenal — 6 shots stacked on one sample |
| Burst Rifle | R07 | 1.62 s | 180 | **9.00** | ✗ worst ratio outright (after the 14 dmg / 180 ms retune) |
| SMG | G10 | 1.32 s | 400 | **3.30** | ✗ correct *id* (DK: G10 = SMG-x3), far too long for the cadence |
| Laser Cannon | E07 | 4.46 s | 1600 | **2.79** | ✗ the longest sample in E, on a 1.6 s cycle |
| AMR | R04 | 2.44 s | 900 | **2.71** | ✗ longest R sample on a mid cadence |
| Bolt Rifle | R05 | 1.87 s | 700 | **2.67** | ✗ |
| Stinger | E14 | 1.28 s | 600 | 2.13 | ~ marginal |
| Assault Rifle | R01 | 1.76 s | 850 | 2.07 | ✓ reference |
| Charge Rifle | E03 | 1.52 s | 850 | 1.79 | ✓ stock |
| Rocket / Force / Plasma Sniper / Rail / Sniper / Energy Launcher / Shotgun / Ion | C03 / R09 / E17 / O03 / S16 / E08 / T14 / E20 | — | — | 0.76–1.74 | ✓ |
| **Suppressor** | Q06 | 0.49 s | 500 | **0.98** | ✓ **the best-matched weapon in the arsenal** |

The Suppressor is the proof the model is right: a silencer sample against a 500 ms cadence, one
sound per shot, no overlap. Every fast weapon should be built that way.

### 3.3 Prefix appropriateness

Mostly good, with a clear pattern in the misses.

**Correct and worth keeping:** Suppressor → **Q** (silencers) · Sniper Rifle → **S16** (SR-100) ·
Shotgun → **T14** (TAC-87) · Rail Gun → **O03** (ordnance) · Burst / Bolt / Force / AMR → **R**
(rifles).

**Wrong despite the legend:** SMG → **G10**. The DK legend calls G10 "SMG-x3", but on the bench it
reads as a **heavy machine gun** (C3). This is the one place where the legend and the ear disagree,
and the ear wins — a reminder that the bank gives us durations and community labels, not waveforms.

**Captured, therefore authoritative even where the prefix looks odd:** the Rocket Launcher's
**C03** and the Laser Cannon's **E07** come from the two Callsign slot captures, not from our
guesswork. C is "sci-fi SFX" in the legend rather than ordnance, but Battle Company chose it for
their own rocket, so it stays.

**The real gap — the electrical family is unused.** Six weapons are labelled Energy/Plasma/Ion and
every one of them uses **E** (generic sci-fi). **L** (electrical, 7 ids) is untouched, and it
happens to contain the two shortest non-silencer sounds on the device: **L04 0.36 s** and
**L07 0.39 s**. Those are the only ids that fit a 200–300 ms energy cadence. §2.2 puts L07 on the
Energy Rifle and L06 (0.58 s) on the Stinger for exactly this reason.

**Unused and interesting:** **P** (18 gun shots) is entirely unused — a whole rifle/pistol family
free for future weapons. **SW** contains blaster-short samples (SW15/SW16 at 0.27 s) if an exotic
energy weapon ever wants a distinct signature. **X** (grenades/explosions) belongs on the victim
side via `$SIR`, not on `$WEAP` fire — X13 is already the rocket's hit sound.

### 3.4 Reload chains

Every weapon uses a **3-part chain** (`reloadPart1/2/3`, tok31/32/33) plus a `noAmmo` id (tok34).
Both captured hardware frames build that chain from **D** (cocking) ids — AR `D04+D03+D02`,
Charge Rifle `D30+D29+D37` — which tells us what the three parts *are*: mechanical beats
(mag out, mag in, bolt), not a single continuous reload sample. **W** (74 reload sounds) is
completely unused by us, and its short end (W09 0.27, W08 0.33, W40 0.40, W10 0.42, W24 0.44 …)
is exactly the right shape for those beats.

Assuming the three parts play in sequence across the reload window — consistent with the AR's
1.18 s chain inside a 1400 ms reload, but **not yet confirmed on the bench** — the chain should
sum to just under `reload_ms`. Current chains against the **proposed** reload times:

| weapon | current chain | sum | proposed reload | gap | verdict |
|---|---|---|---|---|---|
| AMR | D09+D10+D02 | 2.45 s | 1900 ms | −0.55 | **overruns** — audio still playing when the gun is live |
| Plasma Sniper | D09+D10+D02 | 2.45 s | 1900 ms | −0.55 | **overruns** |
| Sniper Rifle | D09+D10+D02 | 2.45 s | 2200 ms | −0.25 | **overruns** |
| Ion Sniper | D09+D10+D02 | 2.45 s | 2400 ms | −0.05 | borderline |
| SMG | D04+D03+D02 | 1.18 s | 2200 ms | +1.02 | **1 s of dead air** |
| Rocket Launcher | D14+D13+D12 | 1.59 s | 2600 ms | +1.01 | **1 s of dead air** |
| Bolt / Suppressor | D04+D03+D02 | 1.18 s | 2000 ms | +0.82 | dead air |
| Burst / Force | D04+D03+D02 | 1.18 s | 1900 ms | +0.72 | dead air |
| Rail Gun | D30+D29+D37 | 2.03 s | 2600 ms | +0.57 | dead air |
| Charge Rifle | D30+D29+D37 | 2.03 s | 2500 ms | +0.47 | fits (stock) |
| Stinger / Shotgun / AR / Energy Rifle / Energy Launcher / Laser | — | — | — | +0.02…+0.42 | fits |

Against the **current** reload times the same audit flags the Shotgun hardest: a 1.06 s chain
inside a **400 ms** reload — the sound runs 2.6× past the window. (§2.2 lengthens that reload to
1400 ms, which fixes it without touching the ids.)

**Recommendations**

1. **Give the three sniper-family weapons a chain that fits.** `D09+D10+D02` (2.45 s) is the
   longest chain in use and lands on the three weapons with the tightest reload windows.
2. **Audition W ids for every weapon with > 0.5 s of dead air** — SMG, Rocket, Bolt, Suppressor,
   Burst, Force, Rail. The budget is the gap column; the candidate pool is the short end of W.
   **The exact ids have to be chosen by ear on the bench** — we have durations, not waveforms, and
   picking ids to fill a time budget without hearing them would be guessing dressed as data.
3. **Keep `noAmmo` as-is.** D18 (0.12 s dry click) on ballistic weapons and A73 (0.28 s) on energy
   weapons are both from the captured frames and both correct.
4. **Restore the Laser Cannon's charge sounds** — see §4.3; this is a bug, not a preference.

### 3.5 Audition shortlists — what the bank offers at each cadence

The 2.07× ceiling is a hard filter, and at fast cadences it is *brutal*. For each proposed weapon,
every gunshot-family (**G/P/R/S/T**) id that fits:

| weapon | fire ms | max duration | gunshot ids that fit |
|---|---|---|---|
| Energy Rifle | 250 | 0.52 s | **none** — no gunshot sample on the device is this short |
| Burst Rifle | 320 | 0.66 s | **2**: `R122` 0.52, `G02` 0.54 |
| **SMG @ 270** | 270 | 0.56 s | **2**: `R122` 0.52, `G02` 0.54 |
| **SMG @ 400** | 400 | 0.83 s | **7**: `R122` 0.52, `G02` 0.54, **`P15` 0.69**, **`P02` 0.74**, `G21` 0.78, `G09` 0.81, `R106` 0.81 |
| Stinger / Suppressor | 500 | 1.04 s | 26 |
| Bolt / Force / Shotgun | 750–800 | 1.55–1.66 s | 68–85 |
| Assault / Plasma / AMR | 850–1000 | 1.76–2.07 s | 81–99 |
| Snipers / Power tier | 1800–2500 | 3.73–5.18 s | 120+ |

This is the concrete answer to C3. At the SMG's originally-proposed 270 ms cadence the device
offers **exactly two** non-silencer gunshot samples, and one of them (`G02`) is the same G family
that just failed the ear test. **Relaxing the SMG to 400 ms opens the P family** — 18 ids, entirely
unused by any weapon, and the only untouched gunshot family on the device. `P15` (0.69 s) and
`P02` (0.74 s) are the shortest, which for a gunshot sample usually means the lightest report.
§2.2 therefore moves the SMG to 400 ms; the exact P id is a bench pick.

The same filter explains the two remaining fast weapons. The **Energy Rifle at 250 ms has no
gunshot option at all** — which is fine, because it should not sound like a gun; **`L07` 0.39**
(electrical) is the intended answer and one of only four ids on the whole device short enough.
The **Burst Rifle at 320 ms** has `R122` and `G02` and nothing else; if neither reads right,
its cadence has to move too.

**General rule for future weapons:** pick the cadence and the sound together. A weapon faster than
~350 ms can only use the **Q** (silencer), **L** (electrical), **SW** (blaster) or **B**
(bow) families — the device simply has no short gunshots.


---

## 4. Unused wire levers

Four fields the firmware reads and we never set. Each is a source of weapon identity that costs
nothing but a bench capture to unlock.

### 4.1 tok3 — damage type

`protocol-classes.md` flags the tok3/tok4 order (primaryDamageType vs primaryPowerType) as
**unresolved**, because both read `0` on the AR. Four independent frames now settle it in favour of
**tok3 = primaryDamageType**:

| frame | tok3 | DamageType enum at that index | agrees? |
|---|---|---|---|
| melee (stock) | 13 | MeleeDamage | ✓ and decisive — PowerType only runs 0–11 |
| tear gas | 11 | NonLethalExplosive | ✓ |
| rocket (captured slot 5) | 10 | StandardLethalExplosive | ✓ |
| rail gun (ours) | 6 | ArmorPiercing | ✓ consistent |
| charge rifle (stock) | 8 | Shrapnel | plausible |

Enum order: `0 Standard, 1 MedicHeal, 2 ActivateShield, 3 RallyPulse, 4 Radiation, 5 Cryogenic,
6 ArmorPiercing, 7 EMP, 8 Shrapnel, 9 StickyBomb, 10 StandardLethalExplosive,
11 NonLethalExplosive, 12 ShottyPellets, 13 MeleeDamage, 14 Plasma`.

That makes the current assignments visibly wrong in two places: **the Shotgun is `0 Standard` when
`12 ShottyPellets` exists**, and **the Energy Launcher is `9 StickyBomb`**, which is almost
certainly not what was intended. The `dt` column in §2.2 assigns a type to every weapon on this
reading. What the victim's firmware *does* differently per type is unknown — it may change the hit
sound, the LED, or nothing at all. That is a one-afternoon bench question and the payoff is a
whole axis of weapon feel.

### 4.2 tok41 — gun range %

Both stock frames carry `75`. The captured rocket frame carries **`30`** — proof the field is
per-weapon and that Battle Company varies it. `resolve()` never writes it, so **every weapon we
ship fires at 75 %, except the rocket launcher at 30 %**, and the `rng` bar in the UI is
decorative. §2.2 proposes a range per weapon (25 % shotgun → 100 % snipers/rail). If the bench
confirms tok41 does what its name says, this single field turns three near-identical rifles into
a short/medium/long trio without touching a damage number — and it is the constraint that
justifies the Shotgun's 0.90 s TTK.

Related and unmeasured: `$GSET` `gunLaserRegion`, `$IRTX` `rangeOutdoor`/`rangeIndoor`, and
`$HFIRE` `Range` are three more range surfaces; how they interact with tok41 is unknown.

### 4.3 tok14 — charge time, and the Laser Cannon bug

> ⚠️ **Superseded (2026-08-26 bench): `tok14` is the FIRE INTERVAL, not charge time.** A sniper with
> `tok14=1250` fired exactly 1 shot/s (`protocol/brx-protocol.md` §6.1). So the CR's `tok14=1250` is
> its *fire* rate, and the charge mechanism lives in other tokens (open hunt — currently the
> `tok20`+`tok24` pair). The inheritance bug below is still real, but re-read it as "a `charge` value
> written into `tok14` **corrupts the fire rate**" — which is exactly the 10-shots/s bug the compiler
> fix (c606417) resolved: `charge` is now parked, not written to `tok14`.

`resolve()` only writes `charge` when the weapon declares `charge_ms`, so weapons built from the
`laser` and `rocket` samples silently inherit **`charge: 1000`** from the capture. For the Laser
Cannon that is worse than cosmetic: `wire.sounds.up`/`down` are `""`, which **overwrites the
captured `D32`/`D31` charge-up/charge-down sounds with nothing**. The result is a weapon that winds
up for a full second in total silence — no cue to the shooter, no warning to anyone nearby.

**Fix:** either declare `charge_ms` and restore `up: "D32"`, `down: "D31"` (§2.2 does this, with
`charge_ms: 1200`), or set `charge_ms: 0` and mean it. The same inherited `1000` sits on the Rocket
Launcher with no charge sounds in the capture either — there it may simply be an unused field, but
it should be explicit rather than inherited.

### 4.4 tok19 — reload type, and the missing fire-mode field

`ReloadType` is `Magazine, Quiver, Shells, SingleBolt, BoltWithMagazine, AutoReload`. **Every
weapon we ship writes `0`.** `Shells` is presumably what makes a shotgun reload shell-by-shell
(and would explain a 400 ms reload being sane in the original design as a *per-shell* value rather
than a full reload); `SingleBolt` is what a bolt-action sniper wants. This likely also governs
whether the 3-part chain plays once or per round — which would change every conclusion in §3.4.
**Pin this before doing detailed reload-sound work.**

Separately, `apk-harvest.md` records the **`GunWeaponType`** enum: `FullAutoFire, Bow,
ChargeAndAutoRelease, ChargeAndRelease`. Two things follow. First, `Bow` (draw/release) and the two
charge modes are firing behaviours we have never used — a bow-pattern weapon is available and would
be genuinely novel. Second, **there is no burst member in that enum**, and the bench has now confirmed it (C2): our
Burst Rifle frame does not burst. The followup to capture a "native burst token" should be
**closed** — that token does not appear to exist.

Third, and most important: the enum has no **semi-auto** member either, yet the stock guns clearly
have one — Battle Company's own sniper is not full-auto. So either `GunWeaponType` is not the whole
story, or the semi/single-shot behaviour is carried by a *different* field. **Both `GunWeaponType`
and the fire-mode flag are unlocated** in the 44 tokens — most likely among the unpinned positions
(tok7–13, tok20, tok24, tok42–43), since all four of our captured frames are full-auto and
therefore cannot discriminate the field by diffing. Pinning it needs **a capture of a stock
semi-auto weapon** (fire the Callsign app's own sniper into a BLE capture and diff it against our
`ar` frame), not more diffing of what we already have. This is U0.

**Bench update (2026-08-26):** `tok19`=`reloadType` is now enum-matched and probe-confirmed as a
reload mechanism — a sniper probe of it changed nothing about firing. Fire-mode eliminations so far:
`tok1` (sniper `tok1=2`, still full-auto) and `tok19`. The strong new read: **semi-auto may not
exist in the firmware at all** — `GunWeaponType` has no semi member, and the "always full-auto" feel
turned out to be the `tok14` rate bug (now fixed, c606417), not a missing mode. U0 is downgraded:
chase a stock semi-auto capture only to **confirm absence**; real cadence control (`tok14`) already
delivers most of the feel. (The Charge Rifle's charge mechanism *is* in the frame — a byte-identical
CR taps-vs-holds differently — and localizes to the `tok20`+`tok24` pair; see the exp-log.)

---

## 5. Open unknowns

Ordered by how much they block the design above.

| # | unknown | blocks | how to settle |
|---|---|---|---|
| **U0** | **The fire-mode / semi-auto token.** Every frame we build is full-auto (C1) — sniper and shotgun both fired on a held trigger. All four captured samples are full-auto, so the field cannot be found by diffing what we have. | **Weapon feel, everywhere.** The 2-hit shotgun, real bolt-action snipers, and any weapon whose identity is trigger discipline. | **Capture a stock semi-auto weapon from the Callsign app over BLE** and diff it against our `ar` frame. Highest-value protocol task open. (⚠ opening Callsign resets an enrolled gun's `$NAME` — use an unenrolled gun.) |
| U1 | **tok4 = PowerType?** Current values (snipers `1 IRSource`, AMR/Burst/Bolt `3 HeadSetOnly`) are guesses on an unpinned field. If tok4 really is PowerType, `HeadSetOnly` means **those weapons only tag the headset, not the gun body** — five weapons that would feel broken and nobody would know why. | §2.2 for 5 weapons | **Revert all tok4 to `0`** (the hardware-verified AR value) until a one-field Callsign capture pins it. Cheap insurance. Then explore deliberately: `GunAndHead`/`DoubleGun` for a wide-cone shotgun, `GunLaser` for a tight sniper, is a real design lever. |
| U2 | **tok41 range semantics** — does the number do what its name says, and is it %, metres, or an index? | §4.2, the whole range axis, every CQB-vs-marksman trade | Two guns, one weapon, tok41 at 100 vs 25, walk it back until hits stop landing. |
| U3 | **tok19 reload type** — and whether it makes the 3-part chain play per round | §3.4, §4.4 | Set `Shells` on the shotgun, listen. |
| U4 | **Does the 3-part reload chain play sequentially across `reload_ms`?** The whole §3.4 audit assumes it does. | §3.4 | One weapon, one obviously-long chain, one stopwatch. |
| U5 | **What the victim's firmware does per damage type** — hit sound? LED? nothing? | §4.1's payoff | Fire the same damage value at tok3 = 0 vs 6 vs 14 and watch/listen to the receiving gun. |
| ~~U6~~ | ~~Burst fire may not exist~~ — **RESOLVED on the bench (C2):** it does not. | — | Close the burst-token followup; the Burst Rifle is a fast-cadence weapon with burst-shaped audio. |
| U7 | **Damage ceiling in the IR payload.** Jay reports the hit carries a ~7–8-bit damage value (≤ 256) (FOLLOWUPS P10). Our maximum is 150, so nothing is at risk today — but it caps any future "double damage" powerup at ~2× the Laser Cannon. | future powerups | Confirm on capture. |
| U8 | **`cls` (WeaponCategory) may be UI-only.** We store it per weapon and never write it to the wire. Harmless, but it means category is our own grouping, not the gun's. | nothing today | — |
| U9 | **Reserve travels via `$AMMO`, not `$WEAP`** — tok40 stays `9999999` on every frame. Hardware-confirmed correct (§7r watched 384 → 352 → 338). **But a mid-game `$WEAP` re-push — a weapon pickup — would need its `$AMMO` re-sent too**, or the player silently gets unlimited reserve. | powerups / weapon pickups (FOLLOWUPS B1) | Re-push a `$WEAP` mid-game and watch `$ALCD`. |

---

## Appendix — quick reference

**Weapon-relevant sound families, shortest usable ids**

- fast cadence (< 400 ms): `Q04` 0.21, `Q03` 0.23, `Q02` 0.29, `Q05` 0.29, `Q01` 0.34 (silencers) ·
  `L04` 0.36, `L07` 0.39 (electrical) · `SW15`/`SW16` 0.27, `SW11` 0.46 (blaster)
- mid cadence (400–900 ms): `G02` 0.54, `R122` 0.52, `Q06` 0.49, `Q07` 0.86, `L06` 0.58, `T02` 0.84,
  `P15` 0.69, `G21` 0.78, `R106` 0.81
- slow / heavy (> 1 s): `S16` 1.61 and the rest of S (snipers) · `O01`–`O06` 1.45–2.51 (ordnance) ·
  `C03` 3.14 (rocket, captured) · `E07` 4.46 (laser, captured)
- charge up / down: `C15` 1.52 / `C17` 3.96 (stock) · `D32` 0.60 / `D31` 0.59 (laser capture)
- reload beats: `D` for mechanical clicks (both stock frames) · `W` short end untapped —
  `W09` 0.27, `W08` 0.33, `W40` 0.40, `W10` 0.42, `W24` 0.44, `W69` 0.44, `W73` 0.50, `W68` 0.53
- dry fire: `D18` 0.12 (ballistic) · `A73` 0.28 (energy) — both captured, both correct

**`$WEAP` token positions used by `resolve()`** (doc `tokN` == `frame.split(",")[N+1]`)

`tok3` damage type · `tok4` power type · `tok5` damage · `tok14` charge ms · `tok15` fire ms ·
`tok16` mag · `tok18` reload ms · `tok27` fire sound · `tok28/29` charge up/down ·
`tok31/32/33` reload parts · `tok34` no-ammo · `tok39` clip start. **Never written:** `tok19`
reload type · `tok40` reserve (goes via `$AMMO`) · `tok41` range · `tok20`/`tok24` overheat ·
`tok7–13` secondary fire (FOLLOWUPS P1).
