# Bench sheet: the tests from the 2026-10-17 field session

Updated: 2026-10-17. This sheet holds the nine bench tests from the field session of 2026-10-17, plus P1.0 and P2.4 added since
([`field-2026-10-17.md`](field-2026-10-17.md) §5), in order of gameplay impact. Each test settles a question that
the desk cannot. Each has a control, a pass rule or a read, and its FOLLOWUPS row; the row holds the history and the
fix. How a bench run works with Tony: the [`bench-session` skill](../.claude/skills/bench-session/SKILL.md). The
index is [`bench-plan.md`](bench-plan.md).

1. **P1, about 70 min**: a large reserve, the SMG frame, the ALT swallow matrix, the lever on a full magazine, the charge rifle.
2. **P2, about 40 min**: the hill off the ground, the shotgun hold, the Desert Eagle reload time, the single-shot retune.
3. **P3, about 25 min**: the melee range ladder and the single-shot fire rate.

The lanes add their own bench rows for the field fixes to P2 as the fixes land.

## Before you start

- **Volume 65** (`$VOL,65`) for every laptop-held gun. Never use a venue volume on the bench.
- **Arm from the compiled frames** (`compile.resolve()` or the MC push), never from a capture.
- **End every test re-armed.** Never end on a bare `$CLEAR`: the gun then has no `$SIR` table (F11).
- **Do not hold the trigger while a gun powers on.** It opens the stock gun's "Game host" menu (F545).
- **Log the time at each mark** in a presence test.

## Kit

- Tactix-9498 with its headset, on the laptop MCP (Windows Python), for P1, the shotgun and Deagle tests, and P3.
- Tactix-E20D with its headset, or the IR rig receiver, as the target for the melee ladder (P3.1).
- The black Pixel 5 as the KOTH hill, and the green Pixel 5 as the player phone, for the hill test (P2.1).
- A tape measure (12 m), a stopwatch, a box or stand 20-30 cm high, and a USB cable for the player phone (F544).

## P1: the bugs that broke real matches (about 70 min)

**P1.0. A large reserve counts down normally (10 min).** *Impact: reserves are capped at 384 (Energy Rifle 600)
until this passes, so Extended Mags adds nothing to the reserve of five rifles.* One gun, `$VOL,65`. Take the
Energy Rifle's frame from `compile.resolve()` and set its reserve tokens by hand: t17 = 1200 and t40 = 600 (the
compiler writes the reserve into `$WEAP` as well as `$AMMO`, and `$SPAWN` refills from t17). Push that `$WEAP`,
then `$SPAWN,,*`, and read the `$LCD`/`$ALCD` reserve; then send `$AMMO,0,300,1200,1,*` and read the echo. Fire a
magazine and reload twice, reading each `$ALCD`: the reserve must fall by the rounds loaded. Then repeat with t17 =
2400, t40 = 1200 and `$AMMO,0,300,2400,1,*`. **Pass:** each echo reads the reserve sent and counts down normally.
A 600 echo after `$AMMO` alone would mean `$AMMO` clamps to t17, which is why the frame goes first. **Control:**
the shipped frame (t17 600) with `$AMMO,0,300,384,1,*` echoes 384 (proven 2026-09). End re-armed from the shipped
frame. Then raise `RESERVE_PROVEN_MAX` in `compile.py` to the proven value. Row: reserves x2 (Tony, 2026-10-17);
see `perk-design.md`.

**P1.1. The SMG frame with its terminator (5 min).** *Impact: an SMG primary never loaded, and the push retried for
17 minutes.* One gun, no IR rig. Arm normally (`$VOL,65`, `$CLEAR,*`, `$START,*`, a `$PSET`). Then send the field's
SMG frame with `,*` appended, then `$SPAWN,,*`:

    $WEAP,0,2,40,0,0,7,0,,,,,,2,100,100,850,54,216,2500,0,0,100,100,,5,,,G03,,,,D26,D25,D24,D18,D11,,,,54,108,75,100,*

**Pass:** `$ALCD,54,100,0,108,0,*` arrives: the terminator was the whole bug. **Read:** no `$ALCD` means the gun may
also refuse t42 on a 44-field capture. Then send it with t42 dropped (43 fields, then `,*`). **Control:** an
Assault Rifle frame from the same compile loads and echoes `$ALCD`. Do not send the frame without `,*` through
`brx-mcp send` (it refuses it). If you send it unterminated for a control, use `rawbytes.py` or the phone, then
send `$*` (`PARSER_RESET`). Row: F548.

**P1.2. The ALT swallow matrix (40 min).** *Impact: the HUD shows one weapon while the gun fires the other, and
reloads fail.* Two slots loaded, a full capture. In each trial, press ALT, wait at least the loadout's swap delay
(a shot inside it can hide a swap), pull the trigger once, and read `$ALCD` token 3 (the slot). Six trials for each
of these five conditions:

1. The first ALT after `$SPAWN`, with no trigger pull since the spawn.
2. ALT after one trigger pull.
3. Two ALT presses 200 ms apart.
4. ALT 300 ms after a reload-lever pull.
5. ALT 300 ms after the magazine rise.

Run the matrix twice. First with the two pistols, the Desert Eagle and the USP (both ship t15 = 500, so the swap
delay is 500 ms). Then with the field's match-3 loadout, the AMR in slot 0 and the Shotgun in slot 1 (1105 ms).
**Read:** how many of the six trials swapped, per condition and per delay. The answer picks the fix: no assumed swap after a spawn until
the first pull, a wider mid-reload guard, or no second ALT inside `swap_ms`. **Control:** ALT on a settled life,
long after a spawn and with no lever near it, six times: record its count beside each condition's count. Rows:
F542, F445 (folded into F542).

**P1.3. The lever on a full magazine (2 min).** *Impact: a reload on the wrong slot repeats `mag still 0` at every
pull.* With a full magazine, pull the reload lever. **Pass:** the gun stays silent and sends no `$ALCD`. That
confirms the `mag still 0` loop: the phone opens the reload on the slot it guessed, and the gun ignores a lever on
a full slot. **Control:** the lever on a part-empty magazine gives a reload and an `$ALCD`. Row: F542.

**P1.4. The charge rifle below one charge (10 min).** *Impact: the charge rifle locks, and the HUD says OVERHEAT.*
The Charge Rifle on Tactix-9498. Set about 4 rounds in the cell with `$AMMO,0,4,<reserve>,1,*` (the reserve from
the arming recipe's own `$AMMO,0,...` line). Hold a charge, then pull the reload lever. Read `$ALCD` token 1 (the
magazine) and token 5 (the heat) after each step. **Read:** is the reload refused, or only delayed by the lockout?
Log the heat and the time until a reload takes, if one does. End with `$AMMO,0,<clip>,<reserve>,1,*` from the
recipe (F226: only an `$AMMO` refill clears the lock), then re-arm. **Control:** from exactly 10 rounds, a charge
fires. Rows: F226, F238.

## P2: the hill and the reloads (about 40 min)

**P2.1. The hill off the ground (20 min).** *Impact: a KOTH hill on grass counts players only to about 5 m.* The
black Pixel 5 as the hill, the green Pixel 5 as the only player phone. Walk the C.5 ladder (1, 5, 7.5, 9 and 12 m
clear, then 2.5 and 5 m with the body between the phone and the hill) four times: the hill flat on the ground and
then 20-30 cm up on the box, each at -75 and at -80 dBm. Set the hill's threshold from MC's station settings (the
hill logs `threshold -80 dBm`, `threshold_src: "mc"`). Log the app build and the player phone's advert tx power in
every pass: if F440's change to `high` lands between passes, the passes do not compare. Stand 10 s at each mark and
log the time at each mark.
**Read:** IN or OUT, and the hill's dBm, at each mark. 2026-10-16's flat pass at -75: IN at 1 and 5 m clear (-74),
OUT at 7.5 m (-86) and past. **Control:** 1 m clear reads IN at the start and at the end of each pass. A new
threshold goes to Tony, not into `types.py`. Rows: F383, F440.

**P2.2. The shotgun, tap and hold (5 min).** *Impact: a quick lever pull feeds no shells, and the HUD never says to
hold.* Arm the P1.2 match-3 loadout (the AMR in slot 0, the Shotgun in slot 1) on Tactix-9498. Empty the magazine before each trial (`$AMMO,1,0,<reserve>,1,*` for the Shotgun
in slot 1). Pull the lever for under 200 ms, for 1 s and for 3 s, three times each. Count the shells from `$ALCD`
token 1. **Read:** expect 0, about 2 and 6 shells, at about 420 ms a shell. **Control:** the AMR in slot 0, part-empty,
refills its magazine with one lever pull. Row: F128 (the hold half; its `easy_reload` question, whether a held
`$BUT,1,1` drives the chain, stays open).

**P2.3. The Desert Eagle reload time (2 min).** *Impact: rules a reload deadline in or out as a cause of reload
fails.* The Desert Eagle, magazine part-empty. One lever pull; time the pull to the magazine rise in `$ALCD`, five
times. **Read:** expect 2.7 to 2.8 s, inside the 3.3 s deadline. **Control:** the Assault Rifle's reload under the
same timer. Row: F542.

**P2.4. The single-shot retune on a real gun (10 min).** *Impact: the new Shotgun, AMR and USP intervals reach
the gun as the sim assumes.* Push a kit from MC on main after the single-shot land: the Shotgun (t14 400 ms),
the AMR (26 at 350 ms) and the USP (12 at 190 ms). For each, tap the trigger as fast as you can for 5 s, then
at a steady pace. Log each round's time from `$ALCD`. **Pass:** no two rounds closer than the weapon's t14, and under fast tapping the gaps spread above t14 rather than
cluster at exactly t14 (a cluster would mean the gun buffers a press instead of dropping it, which the model
does not assume), and
the Shotgun's `$HIR` on a target reads 20 and 20. Then the Shotgun with Armour Piercing (15 at 500 ms): rounds
at least 500 ms apart. Ask Tony how the Shotgun's pump feels. **Control:** the Assault Rifle held fires every
100 ms. Rows: F542 (the field session's single-shot calls), weapon-design.md Balance rules row 14.

## P2b: the lanes' fix checks (about 45 min)

Each row checks a fix that landed on 2026-10-17, from main after that land. One gun with its phone and MC unless the
row says otherwise; `$VOL,65`.

**L1. F548, the SMG primary after the fix (5 min).** Load a kit with the SMG as PRIMARY and push it from MC. **Pass:**
the push acks first try (`ok:true` with a real `$ALCD` echo, not a zeroed `$LCD`), and the SMG fires and reloads.
The compiled SMG frame is 45 fields ending `...,54,108,75,100,*` (t42 100 kept, the terminator after it). If the
gun never echoes, the firmware may reject t42 on this capture: report it to brx3 (the fallback is dropping t42).

**L2. F542 cause 2, the post-spawn ALT rule and GUN WAS ON (15 min).** Two weapons loaded: the two pistols (swap
500), then the AMR and the Shotgun (swap 1105). Full capture.
1. Fresh spawn, no trigger pull, press ALT. The phone shows no SWITCHING and logs "ALT ignored by the gun: no
   trigger pull since the spawn". Pull the trigger: the `$ALCD` slot token must be 0. If it is 1, report it to brx4.
2. After one pull, press ALT, then fire about 0.5 s into the swap. If the round's `$ALCD` is on the old slot, the
   HUD closes SWITCHING, shows GUN WAS ON over the old weapon, and stays on it after the window.
3. After an assumed swap the gun did not make, fire once: the HUD shows GUN WAS ON over the weapon the gun fired.
4. An assumed swap to a full slot the gun did not make, then the lever: the gun reloads its own slot, and the HUD
   moves to it with GUN WAS ON when the reload ends.
5. Record whether the gun keeps slot 1 across `$SPAWN` after dying on slot 1 (the phone assumes slot 0).

**L3. F549 and F550, no config and the headset (10 min).** (a) A normal push acks ok with an `$ALCD` echo. (b) Push
a head the gun refuses: the ack is `ok:false`, `err:"no_config"`; the lobby reads GUN DID NOT TAKE THE KIT · TELL THE
HOST (headset joined), and MC's Debug headset column reads ok. (c) Headset off: the lobby reads GUN NOT ANSWERING ·
CHECK HEADSET, and the Debug headset column reads no.

**L4. F554, a hill banks only with a living owner on it (10 min).** A station, a phone or a Stick hill. RED captures
it; RED goes down on the point and stays down 20 s; then RED walks off while BLUE alone drains it. **Pass:** RED's
HELD time stops rising the moment RED is down, and while BLUE drains; it resumes when a living RED stands on it
again. The progress bar is unchanged (an owned point stays at 100 until an enemy drains it).

**L5. The 10% larger hill (-78 dBm default) (10 min).** Repeat F383's flat-phone ladder at 5, 5.5, 7.5 and 8.25 m
with the default threshold. **Pass:** the edge where a lone player stops counting moves out by about 10% (from
about 5.2 m to about 5.7 m on the 2026-10-16 ladder). If it moves less than 5% or more than 20%, report the new
ladder so the dB step can be re-derived (n = 6.8, from -74 at 5 m and -86 at 7.5 m).

## P3: tuning reads (about 25 min)

**P3.1. The melee range ladder (20 min).** *Impact: melee reached 15-20 ft in the field.* Melee is emitted by the
headset. Change only `$WEAP` slot 4 token 2 (range): 90, then 60, 50, 40 and 30. Tony set 60 as the new value
(2026-10-17, headset carrier about 32.4 kHz); 60 is still inside the receiver's pass-band by the bench model, so
the felt change may be small. Goal: a reach of a few feet. At each value, strike the target
from 0.5, 1, 2, 3, 5 and 6 m, three times each (the field saw 15-20 ft, about 4.6-6.1 m). **Read:** the longest distance that hits at each value: does 60 cut the reach, or must the value
sit near the knee? The knee near 40 is arithmetic, not a measurement: this ladder measures it. **Control:** 90 (the field value) hits at every
distance. Row: F567.

**P3.2. The single-shot fire rate (5 min).** *Impact: the arsenal ranks single-shot weapons with a fire rate that
no player reaches.* The AMR (fire mode 7, t14 400 ms). Count the rounds over 10 s with the trigger held, then with
taps at a metronome's 250 ms, then at 400 ms. **Read:** whether t14 is a floor that taps cannot beat (250 ms
taps give no more rounds than 400 ms taps), and the rounds at each rate. **Control:** the Assault Rifle (mode 0, t14 100 ms) fires about 10 rounds a second while held, until its magazine empties. Row: F562.

## Close

Follow the bench-session skill's close: a results table with each control, then the three writes (one log entry,
one FOLLOWUPS diff, the HANDOFF lane), and strike the tests that ran here and in [`bench-plan.md`](bench-plan.md).
