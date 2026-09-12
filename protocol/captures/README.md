# Decoded capture transcripts

> Section references of the form §7e, §7n, §7o point into `../session-findings-2026-08.md` (the archived
> session write-ups); the current reading of each fact is in `../brx-protocol.md`. How to take a capture
> of your own is `../../docs/capture-runbook.md`.

Decoded with `python -m brx_mcp.btsnoop <btsnoop-file>`. `>>` is host→tagger,
`<<` is tagger→host.

**These are the decoded transcripts. The raw btsnoop traces they came from are committed too**, in
[`raw/`](raw/) — a raw trace answers questions we have not thought of yet, and `raw/README.md`
carries the privacy audit that cleared them for a public repo (no headset PIN, no serial; two files
had a headset sticker id patched out in place on 2026-09-07, equal-length, so they still decode
byte-identically). A transcript here carries BRX protocol frames and nothing else, so it is the
faster thing to read.

Each transcript shares its basename with the raw trace it was decoded from.

| File | What it shows |
|---|---|
| `2026-08-23-solo-game-full-arm.txt` | The full working game-start sequence (protocol §7e) — the capture that solved remote game start. Clean 81 s solo game, no combat: the arm order our `GameConfig.setup_frames()` reproduces, with nothing else in the way |
| `2026-08-23-two-tagger-combat.txt` | Two-tagger combat over 421 s: `$HIR`/`$HP` damage, 23 hits taken, 2 deaths, 4 kills, host-driven respawn (§7f), and `$HIR` token 4 = the shooter's team (§7k) |
| `2026-08-23-gset-respawn15.txt` | Respawn 15 s, 1-minute clock. **Also contains a complete game ENDING** — the evidence that the app never queries the gun for results (§7n) |
| `2026-08-23-gset-respawn30.txt` | Respawn 30 s. Secondary weapon differs unintentionally — see §7n method note |
| `2026-08-23-gset-respawn05.txt` | Respawn 5 s, the clean third data point |
| `2026-08-23-no-headset-instant-disconnect.txt` | Callsign with **no headset paired**: ritual completes, zero frames back, hangs up ~1.2 s later (§7m). The negative control when a session "won't work" |
| `2026-08-25-two-gun-3-kills-sflash.txt` | **The `$SFLASH` capture**, operator-annotated end to end. The captured gun is the SHOOTER (never hit): 3 kills, 3× `$SFLASH` + 3× `$PLAY,,4,6,V3A`. Source of §7o, and proof the app's arm is byte-identical to ours |
| `2026-08-25-offline-game-playerid-69.txt` | Start Offline Game with the app's player id set to **69**. The wire carries `$PSET,63`, the 6-bit maximum — the P2 lead that `$PSET` token 1 is the player id |
| `2026-08-25-offline-game-playerid-7.txt` | The same offline game with the id set to **7**. Wire carries `$PSET,6`. With the capture above: the app is 1-based (1–64), the wire is 0-based (0–63) |
| `2026-08-26-weapons-ar-plus-burstrifle.txt` | Arm with two operator-named weapons: slot 0 Assault Rifle (`R01`, full auto), slot 1 Burst Rifle (`R18`, 3-round burst). Confirms `$WEAP` token 23 = burstWeaponTime (275 on `R18`, empty on `R01`) |

The `raw/` directory holds these ten plus thirteen more weapon-naming and failure-mode traces that
were never decoded to a transcript; `raw/README.md` describes each one.

**One trap when reading any of these.** A kill you *score* is invisible in your own gun's stream. The
shooter's gun reports `$BUT` (trigger) and `$ALCD` (ammo) and nothing else; `$HIR`/`$HP` only ever
describe damage *taken*. That is exactly why `$SFLASH` was logged for two days as "periodic, never
near a hit" — the file it was first seen in was the victim's gun.

To re-verify the §7n negative result:

```bash
python -m brx_mcp.gsetdiff <capA> <capB> [capC]     # raw btsnoop files, not these
```

The `$GSET` frames in the three `gset-respawn*` transcripts are byte-identical.
