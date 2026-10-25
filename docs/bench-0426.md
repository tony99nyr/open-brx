# Bench sheet: the bench on APK 0.4.26

Updated: 2026-10-24. This sheet is the bench of 2026-10-25 on APK 0.4.26. It collects the open field tests from
[`bench-field-1017.md`](bench-field-1017.md) (which never ran), the lanes' bench rows since 2026-10-17, and the F579
and F580 checks. The steps run in order of game impact, about 4 h in all:

1. **P1, about 1 h 45 min**: the Stick firmware, the SMG frame, the ALT matrix, the spawn repairs, the F579 weapons
   and the Charge Rifle.
2. **P2, about 1 h 35 min**: the Sniper bolt, the large reserve, the reconnect battery cost, the backhaul fallback and the hidden EMP perk.
3. **P3, outdoors, about 40 min**: the victim-side reach of the Shotgun headset word and of melee.

Where a step says "procedure: 1017 P1.2", the procedure is in that sheet; this sheet adds only what changed. Each
step has a control, a pass rule or a read, and its FOLLOWUPS row. The row holds the history and the fix. How a bench
run works with Tony: the [`bench-session` skill](../.claude/skills/bench-session/SKILL.md). The index is
[`bench-plan.md`](bench-plan.md).

## Before you start

- **The APK** is `/home/tony/apk-0.4.26/brx-companion-0.4.26-android-release.apk`. Its sha256 must be
  `1e7aa24b4c5397a57bac5e464a2e36fb276cb10c148fc6430e71e9585a3473a7` (`/home/tony/apk-0.4.26/build.json`, which also
  reads `"dirty": false` and `"git": "29c755645"`). Each phone's `versionName` reads 0.4.26. If brx3 cuts 0.4.27
  tonight, use `/home/tony/apk-0.4.27/` instead and check its `build.json` the same way.
- **Volume 65** (`$VOL,65`) for every laptop-held gun. MC runs with `--bench-volume 65`. Never use a venue volume on
  the bench.
- **Arm from the compiled frames** (`compile.resolve()` or the MC push), never from a capture.
- **The Windows venv runs the main checkout's code.** Before the first arm, check that the main checkout is at
  `origin/main` or later, or the CLI arms old frames (and `deathmatch` ends on a bare `$CLEAR`).
- **End every step re-armed.** Never end on a bare `$CLEAR`: the gun then has no `$SIR` table (F11).
- **Do not hold the trigger while a gun powers on.** It opens the stock gun's "Game host" menu (F545).
- **Log the time at each mark** in a presence or range step.

## Lessons for this sheet

- **Indoor IR range is bounce.** On 2026-10-24 a receiver flat on the floor heard a gun at 3 m indoors (30/30) and
  nothing outdoors (0/10): the ceiling carried the hit. Every range claim in this sheet is measured outdoors, in P3.
- **A range claim needs a BRX headset as the receiver.** The U002 receiver bounds the emitter only (F580).
- **A player phone's adb port changes on every Wi-Fi reconnect** (F544). Read the `ip:port` again before a CDP read.
- **MC accepts ABORT only while ARMED.** Once LIVE, the operator's end is END.

## Kit

- Tactix-9498 with its headset and the green Pixel 5: the player gun for P1 and P2.
- Tactix-E20D with its headset and the grey Pixel 5: the second player for the spawn steps, and the target in P3.
  Any third gun with its headset can be the target instead.
- Every Stick, on USB, for P1.0.
- The IR rig, a tape measure (30 m), a stopwatch, a USB cable for the player phone (F544), and a cloth for the fabric
  controls.

## P1: what changes a match (about 1 h 45 min)

**P1.0. Every Stick from main (10 min).** *Impact: an old Stick runs an old hill and station.* For each Stick, from a
checkout at `origin/main`: `python3 hardware/m5sticks3/tools/stick.py flash`, then `python3
hardware/m5sticks3/tools/stick.py status`. Once the Stick joins MC, read its `app_ver` in the `stations` list of MC's
`GET /api/state` (the serial `STATUS` line does not carry it). **Pass:** `app_ver` reads `h8-0.3+` and the first 10
characters of that checkout's sha (`git rev-parse --short=10 HEAD`), with no `_dirty`, and MC's station list shows no
STICK FIRMWARE TOO OLD line. **Control:** `python3 hardware/m5sticks3/tools/stick.py ports` lists the Stick before
the flash. MC must run from a checkout at or after e6399e22b (floor h8-0.3). Before the first flash, check that one
Stick on its old build appears in MC's `stations` list: a Stick below h8-0.3 shows STICK FIRMWARE TOO OLD: REFLASH IT
in MC's station list (MC's floor is h8-0.3), and the line goes once it is reflashed. Unplug each Stick when it is
done: an unassigned Stick on USB moved a presence reading on 2026-10-16.

**P1.1. The SMG frame with its terminator (5 min).** *Impact: an SMG primary never loaded, and the push retried for
17 minutes.* Procedure: 1017 P1.1, then 1017 L1 (an MC push with the SMG as PRIMARY). **Pass:** the raw frame echoes
`$ALCD,54,100,0,108,0,*`, and the MC push acks first try with a real `$ALCD` echo. **Control:** an Assault Rifle
frame from the same compile. Row: F548.

**P1.2. The ALT swallow matrix (40 min).** *Impact: the HUD shows one weapon while the gun fires the other, and
reloads fail.* Procedure: 1017 P1.2, the five conditions, six trials each, at swap 500 (the two pistols) and then at
swap 1105 (the AMR and the Shotgun). In the same trials, read the HUD checks of 1017 L2 (no SWITCHING on a first ALT
before any pull, GUN WAS ON when the gun fired the old slot). Add 1017 P1.3 (the lever on a full magazine: no
`$ALCD`) and L2 step 5 (does the gun keep slot 1 across `$SPAWN`). **Read:** the swaps per condition and per delay.
**Control:** ALT on a settled life, six times. Rows: F542, F445.

**P1.3. The spawn repairs (20 min).** *Impact: a player can go live with no ammo, or come back from a power-cycle with
no weapon.* Two guns, MC, a TDM match.
1. F533: procedure 0424 P1.1 ([`bench-rebench-0424.md`](bench-rebench-0424.md)), `window.brx.link.relink()` about
   1 s before go-live on 5 starts. **Pass:** each start that logs a `write err` fires at go-live or heals once. No life
   starts at 0/0. A start with no `write err` does not test F533: say so.
2. F532, alive: power-cycle Tactix-9498 mid-match. **Pass:** no death, and the gun fires at its pools after the relink.
3. F532, down: kill the player, power-cycle the gun at once, let the timed respawn run with the gun off, then relink.
   **Pass:** the respawn fires and the headset lights.

**Control:** a start with no relink and no power-cycle. Rows: F533, F532.

**P1.4. The F579 weapons on the gun (10 min).** *Impact: the USP and the Shotgun changed on 2026-10-24, from the sim
alone.* Push a kit from MC with the USP and the Shotgun (gun word 19, headset word 20, t14 400 ms). Indoors is fine:
this step reads damage, not reach. Shoot the target headset at 2 m.
1. Shotgun: the target's `$HIR` reads 19, then 20 about 88 ms later, per pull. Three pulls kill a full Standard
   target.
2. USP: each `$HIR` reads 10. A full magazine (12 rounds) kills a full Standard target only if every round hits. The
   magazine stays 12 (Tony, 2026-10-24).
3. Tap each weapon as fast as you can for 5 s. Log each round's time: no two rounds closer than t14 (USP 190 ms,
   Shotgun 400 ms). This replaces 1017 P2.4, whose numbers predate F579.
4. Ask Tony how each one feels. Does the USP feel weaker than the rifles? Does the Shotgun still win up close?

**Control:** the Assault Rifle's `$HIR` reads 8 per round. Expected and not a fault: the victim's "what hit me" line
cannot tell the USP from the Burst Rifle (both 10). Rows: F579 (closed, the caveat in `balance-decisions.md`).

**P1.5. The Charge Rifle (25 min).** *Impact: the Charge Rifle locked in a real match, and its numbers wait on this
read.* Tactix-9498, armed from `compile.resolve()` with the shipped Charge Rifle (70/16) in slot 0, full capture.
1. Heat while firing (F575): heat reads 0; build a full charge and release it, then tap 6 times as fast as the gun
   allows (about 285 ms apart). Read `$ALCD` token 5 (heat) after every round. Note the round on which the gun stops
   firing, if it does. Let the gun sit 3 s and read the heat again. Three times. **Read:** a heat table per round. A
   rise of about 14 per tap means the gun does not cool while firing; about 5 to 6 means it cools about 30 a second.
   Record when the lockout starts (heat and round) and how long it lasts.
2. Below one charge (F226): procedure 1017 P1.4. **Read:** is the reload refused, or only delayed by the lockout?

**Control:** from exactly 10 rounds, a charge fires. End with `$AMMO,0,<clip>,<reserve>,1,*` from the recipe (only
an `$AMMO` refill clears the lock), then re-arm. Rows: F575 (Tony's call waits on step 1), F226, F238.

## P2: the gun's own limits (about 1 h 35 min)

**P2.1. The Sniper's 2.2 s bolt (10 min).** *Impact: the Sniper fires one round, then needs the lever, as the sim
assumes.* Procedure: 1017 P2.5, three times. Then arm with Quick Hands, and then with Extended Mags: the bolt stays
2.2 s and the magazine stays 1. **Pass:** each shot needs one lever pull, a trigger press during the bolt fires
nothing, and the HUD shows the BOLT cue, not RELOADING. Report the bolt time per pull. **Control:** the AMR fires its
magazine with no lever between shots. Row: F573.

**P2.2. A large reserve counts down normally (10 min).** *Impact: reserves are capped at 384 (Energy Rifle 600), so
Extended Mags adds nothing to the reserve of five rifles.* Procedure: 1017 P1.0. **Pass:** each echo reads the
reserve sent and counts down normally. Then raise `RESERVE_PROVEN_MAX` in `compile.py` to the proven value (desk,
after the bench).

**P2.3. The reconnect's battery cost (up to 30 min, runs beside P2.1 and P2.2).** *Impact: a phone showing GUN LINK
LOST drained fast in the field.* The grey Pixel, the app open on the lobby, outside a match, its gun off. Note the
battery percentage and the time. When the link rests at TAP TO RECONNECT (stop at 30 min), note them again and count
the connect attempts in the app log. **Pass:** the wait after each failed attempt is at most about 10 s for the first
12 tries (the first few shorter), then 30 s and 60 s, and the link rests after 30 tries (about 14 min of waits plus
each attempt's own time: expect about 20 min). Judge the spacing by the log's "retrying in N ms" value. **Read:** the
battery drop per hour. **Control:** the same phone for the same time with its gun on and linked. Row: F563.

**P2.4. The backhaul is a fallback, not a pull (15 min).** *Impact: a kit-started tunnel must not move every phone
off the LAN inside the config-ack window, and a phone that leaves the Wi-Fi must still reach MC.* MC on main with its
backhaul up (MC shows the public URL), two or more phones bound on the field Wi-Fi, and one of them with mobile data.
Start a match. Mid-match, turn off Wi-Fi on the phone with data. **Pass:** that phone reaches MC through `pub` within
about 20 s (the LAN giveup of 8 s plus the tunnel dial), and MC shows it on backhaul. The other phones never redial:
the MC log shows no new hello from them after the start. **Control:** before the match, with the tunnel up, every
phone stays on the LAN and MC logs no new hello from any of them. Then run two variants:

1. **Wi-Fi on, no internet.** Unplug the field router's uplink, or use a router with no uplink. Android moves the
   phone's default route to cellular. **Pass:** the phone with data stays on the LAN while the LAN works, and MC
   logs no new hello from it.
2. **Wi-Fi returns.** With the phone with data riding `pub` (from the main step), turn its Wi-Fi back on. Wait
   2 min. **Read:** does it stay on `pub`? It should: the current policy keeps a phone on `pub` until that socket
   drops. Record the Lobby row (LAN or BACKHAUL) and any new hello in the MC log.

Row: F595.

**P2.5 to P2.11: the EMP perk (45 min).** *Impact: the EMP replaces the Haze weapon, and it stays hidden until these
pass.* The thrower is Tactix-9498 with the EMP perk (`loadout.perk: "emp"`), a second gun is the victim, and a third
is a teammate of the thrower. Arm all three from `compile.resolve()`, friendly fire off. The phone throws on LEFT:
`$IRTX,100,8,<player>,<own tid>,1,0,1,100,1,,0,*` (`engine.js _empThrow`). Rows: this sheet.

**P2.5. A blocked LEFT reports (5 min).** Send `$BMAP,4,98,,,,,*`, then press LEFT. **Pass:** `$BUT,4,1` arrives and no
IR leaves the gun. **Control:** a receiver facing the barrel and the domes hears nothing on the press.

**P2.6. The throw lands on `<8,1>` (10 min).** Press LEFT on the thrower. **Pass:** the victim reports `$HIR` with
proto 8 and subtype 1, its accuracy reads 0 and its trigger fires nothing, no pool moves, and its HUD shows STUNNED
for 6 s (the placeholder, and the gun's own fn-23 blind: the phone never holds it shorter). **Control:** a Charge Rifle hit on the same victim, with `config.stun` off,
still deals its plain damage on `<8,0>`.

**P2.7. Team immunity (5 min).** Throw with the teammate in range. **Pass:** the teammate registers no `$HIR` and its
gun keeps firing; if its gun does register the word, its phone still shows no STUNNED (`engine.js _empFriendly`). **Control:** the enemy victim beside it is stunned by the same throw.

**P2.8. Range (10 min).** Throw at 3, 6 and 10 m, with the victim in front of the thrower, behind and beside. Three
throws per mark. **Read:** which marks stun, for the numbers Tony sets. **Control:** a cloth over the victim's
headset at 3 m gives no `$HIR`.

**P2.9. The cooldown (5 min).** Throw, then press LEFT again inside the cooldown, then once after it. **Pass:** the
second press sends nothing (the app log says "EMP not thrown: recharging") and the third throws. **Control:** the
HUD chip counts the seconds down (SEC) and lights with a full ring when the third press is allowed.

**P2.10. A yellow thrower (5 min).** Repeat P2.6 and P2.7 with the thrower on team 2, yellow, the team BC's sheet says
every gun accepts. **Pass:** the enemy victim is stunned and a yellow teammate is not. **Read:** whether field 4 = 2
lets the word through to the yellow teammate's gun; if it does, only the phone keeps the teammate unjammed.

**P2.11. An FFA match (5 min).** Arm all three in FFA and throw. **Pass:** both other guns are stunned and the
thrower is not. **Control:** the thrower's own `$HIR`, if its headset hears the word, shows no STUNNED (F438).

## P3: outdoors, the victim-side reach (about 60 min)

Outdoors only, no walls or ceiling near the line. The shooter is Tactix-9498, the target is a second gun's headset at
full Standard health, with a full capture. Both are armed from `compile.resolve()`.

**P3.1. The Shotgun headset word (20 min).** *Impact: F579's mid-range gain assumes only the gun word reaches past
headset range.* One pull at 5, 10, 15, 20 and 30 m, five pulls per mark. Record the damage each pull takes off.
**Read:** the distance where a pull drops from 39 to 19 (the headset word stops landing), and where it drops to 0 (the
gun word stops). On the U002 proxy the headset word reached about 10 m. **Control:** a cloth over the target headset
at 5 m gives 0. If the headset word lands as far as the gun word, say so: that reopens F579's Shotgun call. Rows:
F580, the F579 caveat.

**P3.2. Melee at t2 60 (20 min).** *Impact: melee hit from 15-20 ft in the field.* The shipped melee (slot 4, t2 60)
at the target headset from 1, 2, 3, 5 and 7 m, five strikes per mark. **Read:** the longest distance that hits. On the
U002 proxy melee reached about 7 m, and the range token showed no usable effect on reach at 3 to 7 m. **Control:** a
cloth over the target headset at 1 m gives 0. Rows: F580, F567.

**P3.3. Hit odds against t2 and distance (20 min).** *Impact: the balance sim's range bands are invented; it needs a
measured curve (F606).* The AR gun word at the target headset at 10, 20 and 30 m, with outdoor t2 100, 60 and 30, ten
pulls per cell. Arm each t2 from `compile.resolve()` with only `range_outdoor_pct` changed. **Read:** hits out of ten
per cell. **Control:** a cloth over the target headset at 10 m, t2 100, gives 0. Row: F606.

## Not in this sheet

The hill rows (1017 P2.1, L4 and L5), the shotgun hold (P2.2), the Desert Eagle reload time (P2.3), F549 and F550
(L3), and the single-shot fire rate (P3.2) keep their procedure in [`bench-field-1017.md`](bench-field-1017.md). Run
them if time is left.

## Close

Follow the bench-session skill's close: a results table with each control, then the three writes (one log entry,
one FOLLOWUPS diff, the HANDOFF lane). Strike the steps that ran here, in `bench-field-1017.md` and in
[`bench-plan.md`](bench-plan.md).
