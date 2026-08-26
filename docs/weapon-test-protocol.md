# Weapon Test Protocol

**GENERATED from the RESOLVED wire frames** (source of truth: weapons.json `capture.frame` + balance
tokens + declared sound overrides, via `Compiler.resolve()`). Do not hand-edit the table.

Bench-verify weapons on a real tagger. One gun, one operator, MC on Kit.

## Procedure (per weapon)

1. Kit: select the bench operator, tap the weapon card (try-out pushes the shipped frame).
2. Fire: confirm the FIRE MODE column's behavior (single-shot never auto-fires on hold; bursts are 3-round; charge modes wind up).
3. Hit the second gun: damage is EXACT (t5, bench-proven) vs the 45+70=115 default pool.
4. Reload: sound chain + time. 5. MC: **SOUNDS RIGHT ✓ / LOG ISSUE ✗** → `~/.brx-mcp/weapon-verdicts.jsonl` + card badges.

Design + rebalance rationale: **docs/weapon-design.md**. Token truth: **protocol/brx-protocol.md** (§6.1 + t20/overheat sections).

## Shipped wire truth

| weapon | dmg (t5) | cycle ms (t14) | fire mode (t20) | burst ms (t23) | heat/shot (t24) | mag | reserve | reload | fire snd |
|---|---|---|---|---|---|---|---|---|---|
| Assault Rifle (`assault_rifle`) | 9 | 190 | full-auto |  |  | 32 | 384 | 1400 | R01 |
| Burst Rifle (`burst_rifle`) | 9 | 75 | burst | 275 |  | 36 | 216 | 1700 | R18 |
| Force Rifle (`force_rifle`) | 10 | 100 | burst | 250 |  | 36 | 144 | 1700 | R23 |
| Bolt Rifle (`bolt_rifle`) | 13 | 225 | single/bolt |  |  | 18 | 180 | 2000 | R12 |
| SMG (`smg`) | 8 | 140 | full-auto |  | 5 | 72 | 288 | 2500 | G03 |
| Shotgun (`shotgun`) | 45 | 800 | single/bolt |  |  | 6 | 24 | 400 | T01 |
| Stinger (`stinger`) | 15 | 250 | full-auto |  |  | 18 | 144 | 1700 | E11 |
| Sniper Rifle (`sniper_rifle`) | 60 | 1500 | single/bolt |  |  | 4 | 24 | 1700 | S16 |
| Plasma Sniper (`plasma_sniper`) | 25 | 400 | single/bolt |  | 30 | 10 | 80 | 2000 | E17 |
| AMR (`amr`) | 24 | 400 | single/bolt |  |  | 14 | 56 | 1400 | S07 |
| Suppressor (`suppressor`) | 8 | 160 | full-auto |  |  | 48 | 384 | 2000 | Q06 |
| Energy Rifle (`energy_rifle`) | 9 | 200 | full-auto |  | 6 | 300 | 600 | 2400 | E12 |
| Charge Rifle (`charge_rifle`) | 100 | 1250 | tap-or-charge-release |  | 14 | 12 | 12 | 2500 | E03 |
| Rocket Launcher (`rocket_launcher`) | 115 | 1000 | single/bolt |  |  | 2 | 2 | 2600 | C03 |
| Rail Gun (`rail_gun`) | 115 | 1200 | charge-auto-release |  |  | 2 | 2 | 2400 | C03 |
| Laser Cannon (`laser_cannon`) | 115 | 1500 | hold-to-charge |  |  | 2 | 2 | 1600 | C06 |
| Energy Launcher (`energy_launcher`) | 115 | 1600 | full-auto |  |  | 2 | 2 | 1400 | O01 |
| Ion Sniper (`ion_sniper`) | 115 | 1400 | single/bolt |  |  | 2 | 2 | 2000 | E07 |

## Known gaps (current, 2026-08-26)

- **t41 range (U2)**: OPEN — one solid far-kill at 100; the low-value zeros were contaminated by rig degradation. Fresh-fleet A/B method in FOLLOWUPS.
- **Overheat is ENABLED only where t37/t38 are populated** (Charge Rifle stock; proven transplantable). t24/t35 alone are inert — heat values in this table without t37/t38 do not overheat as shipped.
- **t37 vs t38 semantics** (rate/threshold/cooldown) unmapped — two varied-value probes.
- Power-rest the fleet: day-long powered guns degrade ("screamer") — rotate batteries/power between sessions.
