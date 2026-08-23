# BRX Manual — distilled notes for agents

Source: `BRX_Manual_V7.pdf` (this directory), © Battle Company, downloaded from
https://battlecompany.com/wp-content/uploads/2021/01/BRX_Manual_V7_FINAL.pdf
**Note:** the PDF is here for private-repo reference only — before the repo goes public,
replace it with the link (it's Battle Company's copyright).

## Hardware (parts diagram, p.2)

- Controls: Trigger, ALT button (orange), Select button, Left/Right buttons
  (directional pad), Reload handle (screws in, right side).
- **Ports: charging port AND a separate micro-USB "Programing Port"** — the latter is
  the official firmware/sound update path (and our factory-restore safety net).
- **No user-accessible SD card.** (SD-card sound updates are a commercial-line feature —
  Battle Rifle Pro/XL/BRM — not BRX.)
- LED indicator shows ammo & health; hit sensor on the rifle itself plus the wireless
  head sensor (headset).
- Battery: ~8 h play from 2 h charge (charger LED red→green). Optional 6×AA. Never use
  rechargeable AAs.
- Class 1 laser. Typical max range ~600 ft in sunlight; range drops in full sun,
  improves in shade/night. Indoor vs outdoor mode: **hold ALT 3 s**.

## On-gun game flow (p.3, p.5) — protocol-relevant!

1. Power on (slide switch by barrel).
2. Left/Right cycle game modes; **trigger selects**.
3. Directional pad: team/faction. Trigger: cycle weapons/characters. ALT: cycle perks.
4. Settings (lives/time/respawn/volume) via directional pad, Select advances.
   Settings persist as new defaults after a game starts.
5. **Pull the reload handle to START the game.** ← key fact: reload-handle pull is the
   "go" signal; our remote-start experiments likely reached ready-mode and stalled here.

## Headset (p.3, p.8) — protocol-relevant!

- Pairs automatically to the rifle after power-on; can take up to **3 minutes** with
  many taggers/BT devices around (matters for 20-tagger events).
- **Anti-cheat lockout: if the headset disconnects after a game starts, the gun locks
  (won't shoot) until it reconnects. If no headset was connected at boot, the gun
  shoots fine without one.** ← candidate explanation for "gun won't fire" states;
  control for headset state in every experiment.
- Target mode (for scope sighting): hold LEFT while powering on → "TARGET MODE" voice;
  headset won't pair in this mode; direct hits flash it green.

## Game modes (p.6–7)

| Mode | Teams | Notes |
|---|---|---|
| Free For All | none | friendly fire on |
| Team Death Match | Alpha / Bravo | weapons + perks |
| Supremacy | Resistance (red) / Vanguard (green) / Nexus (blue) | class-based, 9 characters |
| Survival | Human / Infected | infection converts killed survivors |

Settings ranges: Lives ∞/1/3/5/10/15 · Game time off/5/10/15/20/30 min ·
Respawn off/15/30/60/ramp45/ramp90 s · Volume 1–5.

## Stock weapons (p.6–7) — $WEAP field-mapping anchors

| Weapon | Damage | Rate of fire | Accuracy | Mag |
|---|---|---|---|---|
| M-4 | 24 | 545 | 96–91 | 30 |
| SMG-X3 | 25 | 545 | 96–88 | 26 |
| MG-7 | 38 | 342 | 66–45 | 75 |
| SR-100 | 140 | 44 | 100–90 | 4 |
| TAC-87 | 120–40 | 150 | 95–80 | 8 |

The known-good `$WEAP,0` assault-rifle string carries a `24` in the damage-suspect
position — matching the M-4. Forcing each stock weapon via the app (once it works) and
diffing `$WEAP` outputs against this table is the fastest route to the 44-token map.

## Supremacy characters (p.6) — $PSET anchors (HP/Armor/Shield triplets)

| Character | Class | Mag | Damage | Health | Armor | Shield |
|---|---|---|---|---|---|---|
| Soldier | Offense | 30 | 22 | 100 | 50 | – |
| Medic | Support | 30 | 21 | 100 | 40 | – |
| Heavy | Tank | 75 | 38 | 100 | 75 | – |
| Guardian | Support | 50 | 20–100 | 75 | – | 125 |
| Marauder | Offense | 32 | 23 | 75 | – | 150 |
| Sentinal | Tank | 100 | 25 | 75 | – | 175 |
| Viper | Offense | 16 | 25 | 125 | 25 | – |
| Technician | Support | 8 | 28 | 125 | 30 | – |
| Wraith | Tank | 32 | 25 | 125 | 50 | – |

Same HP/Armor/Shield triplet shape as the `$PSET` health tokens — these are the values
the official firmware uses, so they're safe known-good configs to push.

## Troubleshooting nuggets (p.8)

- Reload handle has a mechanical switch under two screws (can fail; testable with a pen).
- Gun locks mid-game on headset loss (see above) — by design, not a fault.
- Laser emitter and headset receivers are separately repairable/replaceable parts.
