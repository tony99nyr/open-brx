# Sound bank
Last verified: 2026-09-18

Every sound id stored on the BRX gun, in one searchable table, with its meaning where we know it and a community label where the community has one.

## How to read an id

The first letters are a family prefix (what kind of sound), and the rest is an index. `R02` is the second entry in the R (rifle-shot) family, and `V3A` is line A of the Heavy (V3) voice. An `E_` prefix marks an alternate take of the base id, so `E_VB17` is a variant of `VB17`. The `E_` set covers the VB, VA, J, K, N, X and VS families. Ids are the app's own names, and the protocol has no friendlier label.

- **2,477** sound files on the gun (2,166 in the app's list; 157 app ids missing from the gun; 468 gun files the app does not know)
- **~4,800 s** (80 min) of audio across the app's 2,166-id list
- **136** `E_`-prefixed alternate takes of existing ids in the app's list
- **Longest:** `J100` at 250 s (a music bed). **Shortest:** `N1A` at 0.04 s

We read every file off a v4.32 tagger's `AUDIO` folder on 2026-09-03. The official app's own configuration file, `Sounds.json`, names 2,166 ids, but the catalog below is the authoritative set of `$PLAY` arguments, and of the file names you would replace over USB.

## Play a sound, and what the labels mean

Play any sound id on the gun with `$PLAY,<id>,*`.

The table below marks a meaning three ways, by how sure we are of it:

- **Meaning, plain text.** We confirmed this meaning ourselves: a known trigger in the shipped game logic, or a voice line we checked by ear against its transcript.
- **Meaning, in italics.** A machine transcribed this voice line, and nobody has checked it by ear yet. Treat it as a label to check, not a quote.
- **Community label.** A community label is a listener's guess from the community BRX Audio sheet, shared by Jay of LaserTagMods. It is never a bench finding. The table always marks it unconfirmed, and it never replaces our own meaning. Where a sound has no meaning of ours, the community label is the only description the table shows, still marked. Where the sound also carries a voice transcript, the label is marked "agrees" or "differs" against it, so you can read both readings. A few ids carry no label at all: the sheet flags them as reported broken since firmware v4.30, and nobody has given them an ear check yet.

## Every family

Prefix meanings are restated from David Knox's audio map; counts are computed from the app's sound list. The on-gun catalog adds the `VX` and `VZ` voice families, `H102` to `H155` and more.

| Family | What it holds | Ids | Typical length |
|---|---|---|---|
| `VA` + `E_VA` | Male voice: announcer, system lines, weapon callouts, countdowns | 321 + 23 | 0.5-3 s (countdowns up to 11 s) |
| `VB` + `E_VB` | Scout / female-clean voice: score & lead lines | 90 + 64 | 1-2 s |
| `V0`-`V9` | Character voice packs (Fury, Grenadier, Guardian, Heavy, Hive Queen, V5 not named, Infiltrator, Marauder, Medic, Raider) | 23 each except V4 (33), V5 (26) and V8 (35); 255 total | 0.4-6 s |
| `V100`-`V144` | CTF / Slayer / King-of-the-Hill callouts | 34 | 1-2.4 s; three at 12-13 s |
| `VC`...`VS` (15 families) | Sentinel, Female sniper, Clean male, Creature, Female creature, Valkyrie, Viper, Wraith, Russian clean, Clean female, Mercenary, Clean male (alt), Nexus & Vanguard commanders, Clean commander | 9 base + 9-22 extra lines each (329 total, incl. 5 `E_VS` takes) | 1-6 s |
| `N` + `E_N` | Miscellaneous cues: the "kerchung", swish, revive ping, ultra-short ticks | 108 + 10 | 0.04-6.7 s |
| `NA` | Death beep (`NA0`) | 1 | 4 s |
| `M` | Mortal-Kombat-style SFX | 95 | 0.1-3.4 s (`M57` 25 s) |
| `U` | Beeps and boops (UI / system tones; `U16` is connect-related) | 91 | 0.05-1.9 s |
| `A` | Sci-fi SFX (incl. the shield loop `A10`; `A100`-`A103` run 7-24 s) | 80 | 0.2-24 s |
| `W` | Reloads | 74 | 0.3-8.7 s |
| `D` | Cocking / mechanical | 69 | 0.1-3.9 s |
| `H` | Hit SFX + special-weapon impacts (rail gun `H02`, energy blade `H50`, war hammer `H49`) | 59 | 0.4-6.4 s |
| `X` + `E_X` | Grenades and explosions (`X13` rocket) | 51 + 10 | 0.1-8 s |
| `R` | Rifle shots (`R02` M4) | 47 | 0.5-5 s |
| `SW` | Star-Wars-flavored SFX (`SW02` 28 s) | 34 | 0.3-28 s |
| `E` | Cool sci-fi SFX | 32 | 0.7-4.5 s |
| `JA` + `J` + `E_J` | Music & stings: `JA9` startup, `JAD` death music, `JAY` victory; `J01` 63 s and `J100` 250 s beds; `J07` MG7 fire | 32 + 23 + 12 | 1 s - 250 s |
| `B` | Bow / arrow | 31 | 0.2-2 s |
| `G` | SMG / gun shots (`G10` SMG-x3) | 23 | 0.5-2 s |
| `C` | Cool SFX | 21 | 1-4 s |
| `S` | Sniper / gun shots (`S16` SR-100) | 19 | 1-4 s |
| `P` | Pistol / gun shots | 18 | 0.7-2 s |
| `T` | Shotgun / gun shots (`T14` TAC-87) | 16 | 0.8-1.8 s |
| `F` | Fire / funny | 15 | 0.2-3.6 s |
| `Z` | Creature splat | 15 | 0.4-10 s |
| `K` + `E_K` | Fly-bys and air strikes | 12 + 12 | 2-30 s |
| `CC` | Contra-style SFX | 10 | 0.4-5.8 s |
| `Y` | Odd sci-fi | 10 | 0.2-3.7 s |
| `L` | Electrical | 7 | 0.4-4.5 s |
| `Q` | Silencers | 7 | 0.2-0.9 s |
| `O` | Big guns / ordnance | 6 | 1.5-2.5 s |

Sums to 2,166, the app's list; the gun holds 2,477 files.

## Notable ids

| Id | Family | Meaning | Length |
|---|---|---|---|
| `VA20` | VA | "Connection established": plays on every phone connect | 1.27 s |
| `U16` | U | Connect tone (paired with VA20) | 0.43 s |
| `VA81` | VA | 3-2-1 spawn countdown (arena) | 3.03 s |
| `VA33` | VA | "Game over" + music | 1.88 s |
| `VA85` | VA | Countdown to game over, no music | 10.01 s |
| `VSB` | VS | Countdown to game over + music | 10.46 s |
| `VS6` | VS | Game-end line (solo game close) | 2.42 s |
| `VSF` + `JAY` | VS / JA | Victory sting + "Victory": the winner's end-of-game pair | 1.86 s + 5.69 s |
| `VA46` | VA | Lives depleted / multi-kill | 1.47 s |
| `V3A` | V3 | "Kill": the app's per-kill announcer line | 0.79 s |
| `VB17` | VB | Score / lead-change line | 1.94 s |
| `N41` | N | Revive-countdown ping | 0.73 s |
| `NA0` | NA | Death beep (also the file swapped to change the death cue) | 4.00 s |
| `N03` | N | "Kerchung" | 0.82 s |
| `N04` | N | Swish | 1.43 s |
| `JA9` | JA | Startup music | 5.75 s |
| `JAD` | JA | Death music (the musicMixOnDeath slot) | 3.50 s |
| `H29` | H | Respawn / add-HP: a quiet, sustained "stim-pack" medical sound | 1.20 s |
| `VA16` | VA | "Armor suit": add armor | 0.94 s |
| `VA8C` | VA | "Shields online": add shields (SFX over the first word) | 1.50 s |
| `VA2` | VA | Tear gas effect | 5.98 s |
| `H02` | H | Rail gun impact | 0.39 s |
| `X13` | X | Rocket launcher / explosion | 1.55 s |
| `H50` | H | Energy blade | 0.99 s |
| `H57` | H | Rifle bash | 0.76 s |
| `H49` | H | War hammer | 1.21 s |
| `R02` | R | M4 fire | 2.20 s |
| `T14` | T | TAC-87 shotgun fire | 0.89 s |
| `S16` | S | SR-100 sniper fire | 1.61 s |
| `J07` | J | MG7 fire | 1.60 s |
| `G10` | G | SMG-x3 fire | 1.32 s |
| `V3I` | V3 | "Get some": Heavy respawn line | 1.53 s |
| `VA3` / `VA5` | VA | Male scream / yell (death-cue swap candidates) | 1.27 / 1.29 s |

## The full sound bank

The table below lists every sound on the gun: id, family, meaning where known, community label where one exists, duration, and the command that plays it. Search matches an id, a family, a meaning or a community label.

```data
sounds
```
