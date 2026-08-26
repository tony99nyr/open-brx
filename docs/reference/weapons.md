# BRX weapon reference — the complete Callsign arsenal

Every weapon selectable in the official Callsign app, captured over BLE while arming a game and
**named by the operator at capture time** (the wire carries no weapon name — token 27 is only a
*sound* id, and two different weapons share `C03`).

Field decode and the evidence behind it: `protocol/callsign-extract/protocol-classes.md`.
Raw traces: `protocol/captures/raw/`. Regenerate the underlying table with
`python -m brx_mcp.weapmap protocol/captures/raw/*.btsnoop`.

**Reading the columns.** `dmg` = `t5` (⚠ *unresolved* — see the field notes; an AR reads 9 here, not
the manual's 24). `cycle` = `t14`, the per-shot cycle time in ms, which for charge weapons is the
charge time. `clip`/`reserve` = `t16`/`t40`. `heat` = `t24`, non-zero only on weapons that overheat.

| weapon | sound | behaviour | dmg | cycle ms | clip | reserve | heat |
|---|---|---|---|---|---|---|---|
| **(unnamed secondary)** | `T01` | default secondary in every early capture | 45 | 900 | 6 | 12 | 0 |
| **AMR** | `S07` | single shot, no full auto | 18 | 360 | 14 | 28 | 0 |
| **Assault Rifle** | `R01` | full auto | 9 | 100 | 32 | 192 | 0 |
| **Bolt Rifle** | `R12` | single shot | 13 | 225 | 18 | 90 | 0 |
| **Burst Rifle** | `R18` | 3-round burst, one pull per burst | 9 | 75 | 36 | 108 | 0 |
| **Charge Rifle** | `E03` | hold to charge, **fires on release**; **overheats** | 100 | 1250 | 100 | 100 | 14 |
| **Energy Launcher** | `J15` | single shot | 115 | 360 | 1 | 3 | 0 |
| **Energy Rifle** | `E12` | full auto, **overheats**; 300-round clip | 9 | 90 | 300 | 300 | 6 |
| **Force Rifle** | `R23` | 3-round burst; 'pull back, let go' reload | 9 | 100 | 36 | 72 | 0 |
| **Ion Sniper** | `E07` | standard sniper, alien-sounding | 115 | 1000 | 2 | 6 | 0 |
| **Laser Cannon** | `C06` | must be held to charge; a tap fires nothing | 115 | 1500 | 4 | 4 | 0 |
| **Melee** | `M92` | gyro swing (butt of the gun) | 90 | 1000 | 1 | 0 | 0 |
| **Plasma Sniper** | `E17` | single shot, **overheats** when fired fast; shell reload | 80 | 225 | 10 | 40 | 30 |
| **Rail Gun** | `C03` | charges, **auto-fires** after ~1 s; a tap also fires | 115 | 1200 | 1 | 3 | 0 |
| **Rocket Launcher** | `C03` | standard single shot | 115 | 1000 | 2 | 4 | 0 |
| **SMG** | `G03` | full auto, **overheats** | 8 | 90 | 72 | 144 | 5 |
| **Sniper** | `S16` | single shot; bolt — pull back, release | 80 | 300 | 4 | 12 | 0 |
| **Stinger** | `E11` | full auto | 15 | 120 | 18 | 36 | 0 |
| **Suppressor** | `Q06` | full auto; **quiet (not silent)**, no muzzle flash | 8 | 75 | 48 | 144 | 0 |

## What the operator's descriptions pinned down

Each of these was confirmed by a field being populated on **exactly** the weapons whose named
behaviour it describes, and empty on all the others:

- **`t23` burst time** — only the Burst Rifle (275) and Force Rifle (250).
- **`t24` overheat** + **`t35` overheat sound** — only the SMG, Charge Rifle, Plasma Sniper and
  Energy Rifle. All four were described as overheating; the other sixteen read `0`.
- **`t28`/`t29` two extra action sounds** — `C…` ids on charge weapons, `D…` ids on weapons with a
  five-part reload. The Rail Gun (auto-fires) and Laser Cannon (can't be tapped) have **no release
  sound**; the Charge Rifle, which fires on release, has both. Two predicted absences.
- **`t1`=2 with `t12`/`t13`/`t42`** — four positions co-occurring on exactly three weapons.
- **`t25`/`t26`** — only the Suppressor, the one weapon that is quiet and has no muzzle flash.

**Tokens 7–11 (secondary fire) are empty on all twenty.** No stock BRX weapon has an alt-fire mode.

## Caveat worth carrying

`t5` does **not** match the manual's damage figures (an AR reads 9). Weapon stats are server-fetched
per `apk-harvest.md`, so the numbers above are what the app sent on the day — treat them as a
faithful record of the wire, not as authoritative game balance.
