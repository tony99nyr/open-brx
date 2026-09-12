# BRX sound bank (the app's list)

> ⚠️ **Corrected 2026-09-03: this list is neither complete nor entirely valid.** The gun itself
> holds **2477** sound files (read off a v4.32 tagger's `AUDIO` folder); this app-side list has
> 2166. **468 ids exist only on the gun** (the VX and VZ voice families, H102-H155, 52 extra VA
> lines, SH, ST, J, U, …) and **157 ids listed here are NOT on the gun** (mostly `E_`-prefixed
> variants, V00…V90, some Z) and play the fallback. The authority for what `$PLAY` can play, with a
> category and transcript per id, is **`docs/reference/sound-catalog.md`** /
> `mcp/brx_mcp/data/sound_catalog.json`. This file is kept for the durations and the prefix legend.

Derived from the Callsign app's `assets/Configs/Sounds.json` (Battle Company); the raw file was
committed here as a temporary exception and removed 2026-09-07 (`RAW_ASSETS_NOTE.md`) — its
id → duration map is restated as `mcp/brx_mcp/data/sound_ids.json`.
**2166 sound IDs** with playback durations. IDs are the app's own names; there is no friendlier
label in the app (the protocol uses these codes directly). This retires the microphone-sweep
approach (which failed because unknown ids play a fallback — see experiment-log #7).

`MaxMusicVolume` = 100.

## Sound-bank meaning map (community, David Knox)

Prefix legend + key IDs from **David Knox's "DK BRX Audio File Names.pdf"** (shared by the owner
community; [Drive folder](https://drive.google.com/drive/folders/1lJRgVUubTHQnF9T7RGfTKv54nX2-li5m)).
Restated as factual reference (credit DK). On-tagger files are named **`<ID>.LTP`** (e.g. `R02.LTP`)
— this is the format you swap over the data port (see `docs/reference/community-notes.md`).

**SFX prefixes** (rough): A/E/C cool sci-fi SFX · B bow/arrow · CC Contra · D cocking · F fire/funny ·
**G/P/R/S/T gun shots** · H hit SFX · J music/SFX/guns · K fly-bys/air strikes · L electrical ·
M Mortal Kombat · N misc/junk-drawer · O big guns/ordnance · Q silencers · SH swipes/swishes ·
ST sci-fi mortars/rockets · **SW Star Wars** · U beeps/boops · **V voice** · **W reloads** ·
**X grenades/explosions** · Y odd sci-fi · Z creature splat.

**Voice (V) prefixes** map to characters/factions: VA male · VB scout/female-clean · VC Sentinel ·
VD female sniper · VE Soldier · VF creature · VG female creature · VH Valkyrie · VJ Viper ·
VK Wraith/Russian · VL Russian clean · VM female clean · VN mercenary · VP Male (clean) ·
VQ Nexus commander · VR Vanguard commander · VS clean commander · V0 Fury · V1 Grenadier ·
V2 Guardian · V3 Heavy · V4 Hive Queen · V6 Infiltrator · V7 Marauder · V8 Medic · V9 Raider ·
V101–V144 gameplay callouts (CTF, Slayer, KotH).

*Corrected 2026-09-12: this row said VE = "clean male" (duplicating VP); `mcp/brx_mcp/gameconfig.py`'s
comment, read off the on-gun catalog's transcripts, says VE = Soldier and VP = Male (clean).*

**Weapon fire sounds:** `R02`=M4 · `T14`=TAC-87 shotgun · `S16`=SR-100 · `J07`=MG7 · `G10`=SMG-x3
(Tar-33 = silenced AR). **Weapon callouts:** VA4B=M4 · VA6A=TAC-87 · VA5Y=SR-100 · VA4F=MG7 ·
VA5R=SMG-x3 · VA6B=Tar-33 · VA90=silenced AR.

**Game cues:** `JA9`=startup music · `JAD`=death music · `N41`=revive-countdown ping · `VSB`=countdown
to game-over+music · `VA85`=countdown no music · `VA33`=game over+music · `VA46`=lives depleted/multi-
kill · `N03`=kerchung · `N04`=swish · `NA0`=death beep.

**Voice-pack structure = the `$PSET` voice profile (answers followup P3's shape).** Each voice profile
provides a consistent slot set: a "move" line, ~4 gasps (E/F/G/H), ~3 death screams, and a kill line.
Examples — Heavy (V3): `V3I` "Get Some" (the respawn line the Mac heard), `V3G/V3H/V3E/V3F` gasps,
`V35/V34/V33` death screams, `V3A` kill. Medic (V8): `V8W` "one shot one kill", `V85/83/84` death,
`V8S` kill. Male (VA): `VAQ` "let's move out", `VA3/4/5` death, `VAA` kill. Scout (VB): `VBI` "let's
move", `VB3/4/5` death, `VBA` kill. Valkyrie (VH): `VHT` "weapons hot", `VHR` kill. Clean male (VE):
`VEI` "locked and loaded", `VEA` kill. So a `$PSET` audio-set token that names a `V3*`/`V8*`/… family
selects that character's voice pack — which is exactly what the server `voice-profiles` endpoint
configures.

## Confirmed meanings (from captures + $SIR table)

| ID | Meaning |
|---|---|
| `VA20` | "connection established" (1.27s) |
| `U16` | connect-related (0.43s) |
| `H29` | respawn/add-HP ($SIR) (1.20s) — **heard 2026-08-26: a quiet sustained "stim pack"-style medical sound**, not a voice line. Fits the add-HP role; good as-is for a medic gun. |
| `VA8C` | add shields ($SIR) (1.50s) — **heard 2026-08-26: says "shields online"** (confirmed). A loud sound effect plays over the word "shields", so only "online" is clear at low volume — if a mode needs it intelligible, layer a `$PLAY` voice line instead of relying on this cue alone. |
| `VA16` | add armor ($SIR) (0.94s) — **heard 2026-08-26: says "armor suit"** (confirmed twice by ear at the bench) |
| `V3M` | (played in diag) (0.79s) |
| `VA81` | countdown/spawn (arena) (2.97s) |
| `VA2` | tear gas ($SIR) (5.98s) |
| `H02` | rail gun ($SIR) (0.39s) |
| `X13` | rocket launcher ($SIR) (1.55s) |
| `H50` | energy blade (0.99s) |
| `H57` | rifle bash (0.76s) |
| `H49` | war hammer (1.21s) |


## Full inventory by prefix — summary

The per-id duration dump (2166 rows, one per sound) was cut from this file 2026-09-12 (it accounted
for ~1,800 of its lines and duplicated `mcp/brx_mcp/data/sound_ids.json`, the machine-readable copy
derived from the same source). What's below is the prefix breakdown only, id counts summing to 2166:

`VA` (303) · `V` (289) · `N` (108) · `M` (95) · `U` (91) · `A` (80)  
`VB` (77) · `W` (74) · `D` (69) · `E_VB` (64) · `H` (59) · `X` (51)  
`R` (47) · `SW` (34) · `E` (32) · `B` (31) · `E_VA` (23) · `G` (23)  
`J` (23) · `C` (21) · `S` (19) · `P` (18) · `T` (16) · `F` (15)  
`Z` (15) · `E_J` (12) · `E_K` (12) · `K` (12) · `CC` (10) · `E_N` (10)  
`E_X` (10) · `JA` (10) · `Y` (10) · `VC` (9) · `VD` (9) · `VE` (9)  
`VF` (9) · `VG` (9) · `VH` (9) · `VJ` (9) · `VK` (9) · `VL` (9)  
`VM` (9) · `VN` (9) · `VP` (9) · `VQ` (9) · `VR` (9) · `VS` (9)  
`L` (7) · `Q` (7) · `O` (6) · 

...plus 248 three-letter voice-line codes with exactly one clip each (`VAA`-`VSI`, e.g. `VQA`
through `VSI` are the three commander families' individual lines; `JAA`-`JAY` are individual music
cues; `NA`/`E_VS*` one-offs).

**Full durations, per id:** `mcp/brx_mcp/data/sound_ids.json` (this file's own source of truth) or,
for category + transcript instead of duration, `docs/reference/sound-catalog.md` /
`mcp/brx_mcp/data/sound_catalog.json` (the gun's own 2477-id catalog — see this file's opening
correction for how the two lists diverge).
