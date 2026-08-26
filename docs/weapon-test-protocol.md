# Weapon Test Protocol

Bench-verify every weapon on a real tagger. One gun, one operator, MC on Kit.

## Procedure (per weapon)

1. Kit screen → select the operator whose gun is on the bench → tap the weapon card (try-out pushes it to the gun).
2. Fire a full mag: listen for the FIRE sound, count the rate, note charge-up if any.
3. Shoot the second gun/headset: verify hit damage feels right (HP 45 / armor 70 baseline → expected hits-to-kill below).
4. Reload: verify the reload sound chain and time.
5. On MC: **SOUNDS RIGHT ✓** or **LOG ISSUE ✗** (say what's wrong). Verdicts persist to `~/.brx-mcp/weapon-verdicts.jsonl` and badge the weapon cards.

## Expected wire behavior

| weapon | verified | sample | dmg | fire ms | charge ms | fire snd | hits-to-kill (115hp) |
|---|---|---|---|---|---|---|---|
| Assault Rifle (`assault_rifle`) | ✓ | — | — | — | — | — | — |
| Burst Rifle (`burst_rifle`) | prov | ar | 14 | 180 | — | R07 | 9 |
| Sniper Rifle (`sniper_rifle`) | prov | ar | 60 | 1500 | — | S16 | 2 |
| Shotgun (`shotgun`) | prov | ar | 50 | 1100 | — | T14 | 3 |
| SMG (`smg`) | prov | ar | 12 | 400 | — | G10 | 10 |
| AMR (`amr`) | prov | ar | 40 | 900 | — | R04 | 3 |
| Energy Launcher (`energy_launcher`) | prov | charge | 95 | 2000 | 1500 | E08 | 2 |
| Rail Gun (`rail_gun`) | prov | charge | 90 | 2200 | 1800 | O03 | 2 |
| Rocket Launcher (`rocket_launcher`) | prov | rocket | 115 | 1800 | — | C03 | 1 |
| Laser Cannon (`laser_cannon`) | prov | laser | 150 | 1600 | — | E07 | 1 |
| Charge Rifle (`charge_rifle`) | ✓ | — | — | — | — | — | — |
| Bolt Rifle (`bolt_rifle`) | prov | ar | 30 | 700 | — | R05 | 4 |
| Plasma Sniper (`plasma_sniper`) | prov | ar | 55 | 1300 | — | E17 | 3 |
| Force Rifle (`force_rifle`) | prov | ar | 24 | 850 | — | R09 | 5 |
| Stinger (`stinger`) | prov | ar | 30 | 600 | — | E14 | 4 |
| Energy Rifle (`energy_rifle`) | prov | ar | 10 | 200 | — | E01 | 12 |
| Suppressor (`suppressor`) | prov | ar | 20 | 500 | — | Q06 | 6 |
| Ion Sniper (`ion_sniper`) | prov | ar | 80 | 2000 | — | E20 | 2 |
| Melee (`melee`) | ✓ | — | — | — | — | — | — |

## Known gaps

- Burst Rifle: native burst token not yet captured — currently fast tap-fire (see FOLLOWUPS).
- Damage model: tagger-side armor interaction unverified; hits-to-kill above is naive dmg math.
