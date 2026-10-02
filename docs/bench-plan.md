# Bench plan: every open bench step, and the desk work that gates it

Updated: 2026-10-02. **Open this file first at the bench.** How a live bench run works with Tony (who drives
the tools, the "1" reply, the recorder at the end): the [`bench-session` skill](../.claude/skills/bench-session/SKILL.md).

**Parts 1 and 2 ran (2026-09-26 and 2026-09-28).** Part 3 is NOW: [below](#part-3-2026-09-29-three-independent-sheets). Part 2's results
are in `experiment-log/2026-09.md`'s 2026-09-28 entry; its sections below stay as the procedures Part 3 points at.

This file holds the ORDER only. Each step points to the sheet section or the FOLLOWUPS row that holds the procedure.
Do not copy a procedure into this file. When a sitting ends, strike its steps here (the skill's close, step 4).

## Part 3: 2026-09-29, three independent sheets

Tony splits today into three benches. Each sheet stands alone, with its own kit, setup commands, steps (each with a
control, a pass rule and its FOLLOWUPS row), a time estimate and the method from Part 2. A fresh session opens
one sheet and runs it. The procedures live in the sheets and in the Part 2 sections below; this index holds none.

| Sheet | Needs | Core steps | Time |
|---|---|---|---|
| ~~[`bench-standard-2026-09-29.md`](bench-standard-2026-09-29.md)~~ RAN 2026-10-02 (`experiment-log/2026-10.md`); steps 1-14 all ran | this box, three Pixels, two guns, no Stick | F297's 10-run repeat, brx4's powerup rechecks (F418, F381, F436 with the `$GLED` gun test), F348 with the poison and shield reads, F394, 4.0, GAMES 9 TEAMS | about 2 h 40 min, plus 70 min lower priority |
| [`bench-stick-2026-09-29.md`](bench-stick-2026-09-29.md) | the M5StickS3, two Pixels, two guns | reflash, -45 powerup default (F434), the 4.11 ladder, 11.2 with the ARMORY overrides, 11.6, the F417 race | about 3 h |
| [`bench-mac-2026-09-29.md`](bench-mac-2026-09-29.md) | the MacBook, the iPhone X, the grey Pixel | the IPHONE block, 11.7 over real mDNS, the iPhone as player 2 | about 75 min |

**Build under test:** app 0.4.16, release-signed and unpublished, at
`/home/tony/apk-0.4.16/brx-companion-0.4.16-android-release.apk` (branch `release/app-0.4.16`, `6a435152`,
not on `main`). MC runs from `main`.

### Re-bench after the fixes in flight (needs a NEW APK)

The standard sheet ran on 0.4.16. These fixes land after it, so they need brx1's rebuilt 0.4.16+ (path and sha
to come from brx1); none can be checked on today's APK. Each row holds its own bench step.

1. **F416, the partial go-live burst (P0, brx4).** The check must verify the weapon state, not only the pools.
2. **F436, an equip before the first pull since `$SPAWN` (brx4).** Plus one question: hold the trigger on the last
   Rocket and keep holding through the empty switch-back's swap window. Does the primary fire by itself when the
   window ends? Note any primary round and its delay.
3. **F440, the phone hill hears one phone only now and then (brx3).** Steps 13b and 13c of the standard sheet.
4. **F437 (the whole go-live taunt), F438 (an own-id hit never kills), F439 (the death stop and the heartbeat after
   the scream) (brx5).** For F439, re-run 11.8 in full, the Shields half included.
5. **F441 (MOVE opens a picker), F442 (the ACTIVE pip animation), F443 (MC LINK needs the locked hold) (brx3).**
6. **F445, a USP reload just after an ALT swap.** Capture the wire.
7. **Open questions:** a powerup take at the cap of 4 used up the item for nothing (now F447); MC's `PUT` of `night=true`
   in LOBBY did not reach the phones; after a match the hill assignment was gone.

F444 (the capture-begins alert) waits for Tony's storyboard pick, and F446 (the poison tick) for his ears.

## DONE: part 1, the short bench, 2026-09-26 (1.5 h, on what exists today)

~~Tony has 1.5 h before GAMES (F411) and 0.4.14 are ready. This runs on the phones' **0.4.13**, MC restarted from
the current `main` (powerups ON by default, F372; outdoor default, F410), **no iPhone**.~~ Ran 2026-09-26; results
in `experiment-log/2026-09.md`'s 2026-09-26 entry and the FOLLOWUPS diff of the same date.

~~**Setup (15 min).**~~ DONE: grey + green Pixels on 0.4.13, MC restarted from `main` (powerups on, no flag),
Stick flashed (found no changed sectors, already `main`), linked MC-ARMED.

~~**S1. KOTH, phone hill then Stick hill.**~~ **PARTIAL.** Stick hill (game 1) ran clean: **11.7** CONFIRMED (the
grey Pixel joined and bound with no tap); F382 (tick cadence, CONTESTED silence and score pause) CONFIRMED; F384
(recapture announced) and F385 (HUD card clears) CONFIRMED; F386's timed-whistle half CONFIRMED, but the same match
found a new half of that row (the powerup screen after END), now built by brx4, bench check in part 2. **The
phone-hill half (the black Pixel) did NOT run**, blocked by F420 (the ⓘ icon behind the status bar, the only exit
from an MC-armed utility screen once released left it stuck). Carried to part 2.

STOP POINT A: not fully reached (phone hill not run).

~~**S2. Powerups core, MC-side and Stick.**~~ **PARTIAL.** F372's default CONFIRMED. F416 (a P0 false death at
go-live) recurred once (1 of 3 starts) and stayed open; it surfaced F417 (a double pickup grant) and F418
(backgrounding loses a held pickup). F381's stacking re-run read CONFOUNDED by F418, needs a clean re-run after
F417. 11.6, 11.2 and F399's nine claims did NOT run this sitting (time went to the F416/F417/F418 chase). Carried
to part 2.

~~**S3. The Stick alone.**~~ DONE. F387 CONFIRMED and closed (RANGE opens at 5 s; the first "2.8 s" control was
confounded by the Stick's idle-timeout bug, found the same sitting as F386's new half, above). F333 CONFIRMED and
closed (every screen read fine at arm's length; only F398's known overlap stood out).

~~**S4. One gun, no phone.**~~ **PARTIAL.** The `$PLAY` spacing check found token 1 (150/300 ms) is the documented
INTERRUPT slot, not a new finding, but the QUEUE slot (token 4) at 300 ms drops and reorders clips (F419, new).
F282's A/B/A CONFIRMED and closed for the eyes-and-ears half; its t25/t26 isolation stays open.

STOP POINT D: not reached. F348 and the F383 field walk did not run; both stay in part 2.

Part 2 is next: everything above that did not run or finish, plus everything that needs 0.4.14, GAMES or the
iPhone (the GAMES CHECK, the iPhone block, F394, F400 and its lows, the 0.4.14 release loop, and every [RE-CHECK]
below) is the section below.

## Part 2: after GAMES, teams, the hold target and 0.4.15

App 0.4.15 is cut (built from `efd1961c`; install the latest published APK and log its version if 0.4.15 is not up yet), and F411, F413 and F415 have landed on `main` at `4275fad2`: PICK GAME, PLAY AGAIN, LAST MATCH, BUILD and FAVOURITES (`docs/spec/design/games-presets.md` §6)
are all real code now (`webapp/mc/src/screens/Games.tsx`), not only the brief. CI on that merge is green on the
app, server and MC UI jobs; only the unrelated "Refresh the site screenshots" job failed. Powerups ship on by
default now that F372 has landed: pass no `--powerups` flag to MC anywhere below.

### The 3 h cut: today's order (172 min, 8 min slack against 3 h)

**Ran 2026-09-28, ended early.** Done: Step 0; GAMES CHECK (F422, PICK GAME, F402, FAVOURITES, the BUILD guard
CONFIRMED; 11.7 not run, moved to the MacBook); item 0 F297 (first connect FAIL); items 1-5 (F416 no false down,
its zero-pool read CONFIRMED; F417 PASS by rule; F418 and F381 FAIL). Not run: the IPHONE block, TEAMS, F348,
Group 2, Group 4, Group 3, F394. Every open item is in Part 3 above.

Run this order today. It is the highest-value subset of everything below, picked to fit one 3 h sitting with
slack to spare. Each block points at its procedure further down this file (fixed by the round-2 review below);
do not copy a procedure here.

1. ~~**Step 0, setup (25 min).**~~ DONE 2026-09-28. Running total: 25.
2. **IPHONE block (15 min).** Running total: 40.
3. (DONE 2026-09-28 except 11.7 and TEAMS.) **GAMES CHECK: 11.7 + F422, PICK GAME, F402, FAVOURITES, the BUILD TypeChip guard (23 min), plus a short TEAMS
   re-split check (F413).** Skip PLAY AGAIN, LAST MATCH and the countdown default today. Running total: 63.
4. ~~**Group 1, item 0: F297 phone connect metrics (10 min).**~~ DONE 2026-09-28. Running total: 73.
5. ~~**Group 1, items 1-5: the P0 block, F416 then F417/F381 (50 min).**~~ DONE 2026-09-28. Running total: 123.
6. **Group 1, item 6: F348 (10 min).** Running total: 133.
7. **Group 2: KOTH, plus F420, F421 and F424, plus F415's hold target (25 min).** Running total: 158.
8. **Group 4, items 4-5 merged: F399 and F380 on an Overshield Stick, plus F425's silence check (12 min).**
   Running total: 170.
9. **Group 3, checks (a), (b) and (d): end the match (5 min).** Skip check (c) today. Running total: 175.
10. **Group 1, item 7: F394 (5 min).** Running total: 180.

Stop at 180 min, with no slack. If short on time, drop the TEAMS and HOLD checks first: they are additions, not
the core gate.

### Tomorrow list (not run in this sitting)

- GAMES CHECK's PLAY AGAIN and LAST MATCH items (both fixed below: END instead of a kill count for PLAY AGAIN,
  and MC/Stick re-pointed after a restart for LAST MATCH).
- GAMES CHECK item 9, re-checked on the 2026-09-28 UI (team dropdowns, no roster warnings).
- 11.6 (Group 1, item 9).
- The powerup setup: 4.11, 11.2, 3.4 and 3.5 (Group 1, item 10).
- 4.0, trimmed to the day/night launch only (Group 1, item 8 today's cut dropped it to make room for F297's
  phone connect metrics). Skip the through-MC match when it runs.
- F386 check (c), the idle-timeout control (Group 3).
- Groups 4-7, except the F399/F380/F425 block already run today (Group 4's items 4-5).

**Carried from part 1 (re-checks), threaded into the groups below at their matching setup:**
- The phone hill, KOTH game 1 (Group 2), blocked in part 1 by F420 (now built, `60b9db70`).
- F374's carry-out A/B/A (Group 4).
- F399's nine claims, re-timed from the Stick serial and the phone log, not MC's 1 s feed (Group 4).
- 11.6, the MC-assigned station ids (Group 1).
- F416, F417 part 2, F418 and F381's re-run: now the first items in Group 1, not an afterthought (see the P0
  rows there).
- F348 (Group 1).
- F419's queue-slot check on the phone's own path (Group 4), with the laptop-MCP run kept as the control
  (Group 7).
- The Stick reflash from `main` at `6f042126` or later (supersedes `b79de96d`; CI green), now Step 0, and
  F386's (a)/(b)/(c)/(d) checks, now Group 3 (replacing the closed F387/F333 re-tests).

**Kit.** Two guns and headsets. Player phones: a **Pixel 5** (0.4.15; this is "the grey Pixel" below) and an
**iPhone X**, built fresh from `main` on the MacBook (the `iphone-build` skill, or `npm run ios:push`;
`docs/mac-dev-runbook.md`, `app/README.md` "To build for iOS"; note the iOS debug toggle is written but
**uncompiled** until that build exercises it, `app/plugins/brx-debug/ios/`). The green and black Pixels are
extras and stations only (the black one is the phone powerup station). **Bench volume: `$VOL,65`, the house
default, unless Tony asks for more** (he raised it to 75 for the one 2026-09-25 session only, not a standing
change). Start MC with `--bench-volume` bare (defaults to 65) so every `$VOL` it writes, match heads and
try-outs alike, plays at the bench level; with no flag MC uses the venue volume instead (80 indoors, 90
outdoors). The Stick is COM10; after any MC restart in WSL, `stick.py cmd 10 "MC ws://<laptop>:8766/ws"` (the
node ws port; mDNS cannot reach MC in WSL). **COM10 takes one program at a time**: for a serial log use
`stick.py cmd <secs> PING > <file>` (the 2026-09-26 bench's own method) and close it before any other `stick.py`
command touches the port.

**Restart MC only after END, never with a match ARMED or LIVE.** After any MC or Stick restart, re-point the
Stick (`stick.py cmd 10 "MC ws://<laptop>:8766/ws"`, F397).

**About 6.5 h across every group below (the exact total is at the end); stop at any STOP POINT if time runs
out, earlier groups are worth more per minute than later ones.** The P0 block, the powerup setup and KOTH
(Groups 1 and 2) are the real priority core, about 3 h of bench time once setup is done. Groups are ordered so
hardware changes as little as possible.

**A note on iOS.** Several steps read a phone's own log or JS state over adb/CDP
(`mcp/tools/webview_eval.py`), which is Android-only. That still works on the Pixel 5. There is no equivalent
tool here for the iPhone X, so those reads are marked **Pixel-side only** below; Tony's eyes on the HUD are the
iPhone's substitute, and MC's own session log (`python -m brx_mcp.mc.diag <session.sqlite>`) covers anything MC
itself receives from either phone. **The iPhone joins MC by a typed ws address, never mDNS** (mDNS cannot reach
MC in WSL); that is expected, not a fault.

### Step 0: setup (about 25 min)

1. Tony re-enables wireless debugging on the grey and green Pixels; the agent `adb connect`s both.
2. **The iPhone X build.** On the MacBook, build and install `main` on the paired iPhone X (`npm run ios:push`
   or the `iphone-build` skill). Log the iOS version it reports (Settings > General > About): the iPhone X tops
   out at iOS 16, and the app wants Safari 16.2 for `color-mix()` (`app/README.md`), so a phone stuck below
   16.2 is a real risk, not a formality.
3. **Install app 0.4.15 on the green Pixel and the black station Pixel** with `adb install -r` (the same release
   key installs over an older 0.4.x with no uninstall). Do not claim which version is already there: install
   0.4.15 if it is not, and log what `adb shell dumpsys package com.openbrx.companion | grep versionName` reports
   on each phone afterwards.
4. **The grey Pixel gets a true first contact, for 11.7.** `adb install -r` keeps app data and the phone's MC
   trust key, so reinstalling over an old build is not a real "first open". Run `adb shell pm clear
   com.openbrx.companion` on the grey Pixel first (**this wipes its app data**, including its trust key and any
   saved BLE bond), then reinstall 0.4.15 only. **Do not open the app, and do not pair its gun.** Opening the app
   is what starts the auto-join and pairing is what SET MY GUN does, both of which are the actual test: the first
   GAMES CHECK item, below, is 11.7 and F422.
5. Restart Mission Control from the latest `main`, with no match ARMED or LIVE. Powerups are on by default
   (F372): pass no `--powerups` flag. Pass `--bench-volume` bare (defaults to 65) so match heads and try-outs
   both play at the bench level instead of the venue volume. Countdown default 30 s (`DEFAULT_RUNWAY_S` in
   `mcp/brx_mcp/mc/types.py`, confirmed 30 on `main`).
6. **Reflash the Stick from `main` at `6f042126` or later** (`stick.py flash`; CI green on that sha). Log the sha
   it was built from and its `STATUS` line.
7. Point the Stick at MC: `stick.py cmd 10 "MC ws://<laptop LAN address>:8766/ws"`.
8. **Reset the hill range to Tony's default, -75 dBm.** First PUT the Stick's MC assignment with `threshold: 0`
   (otherwise a `RANGE CLEAR` falls back to MC's own explicit value, `threshold_src=mc`, not the platform
   default). Then, with the Stick unlocked (it answers `ERR locked` while the A58 match lock is on), run
   `stick.py cmd 3 "RANGE CLEAR" STATUS`. Pass: `RANGE cleared threshold=-75 src=default tx=high`, then `STATUS`
   shows `threshold=-75 threshold_src=default`. `RANGE CLEAR` drops only the on-Stick NVS "range" key (and shows
   in MC as an on-station `range_edits` line); it does not touch anything else. Confirm a `PLAYERS STREAM 5` line
   also shows `thr=-75` before the KOTH block.
- **Log:** each phone's `APP_VER`/version and iOS build marker, the Stick's reflash sha and STATUS line, MC's
  boot banner, the Stick's `thr`.

If the phones are still on 0.4.14, a RED victim's kill confirm can pair with the wrong team (fixed in 0.4.15,
`f52d34dd`); do not log it as a new finding.

Running total: 25 min.

### IPHONE block: does the fresh build work at all (about 15 min; the iPhone X, one gun)

Gate for the rest of the sitting: if this fails, fall back to the green Pixel as player 2 for everything below,
and tell brx1.

1. **Install and open.** Pass: the app installs and opens to the picker with no crash. Log: the iOS version.
2. **BLE connect.** Pass: SET MY GUN finds a gun and links within the usual few seconds.
3. **A match.** Join an MC lobby by typing MC's ws address (mDNS does not reach MC in WSL, so this is expected,
   not a fault), arm, go live, take one hit, die, respawn. Pass: every HUD screen appears, as on Android.
4. **The ⓘ DEVELOPER debug toggle.** Open the ⓘ panel and flip WebView/remote debugging. Pass: it flips and
   holds after a re-open. **Fail, not INCONCLUSIVE, if the control is missing or does not hold**: the iOS side
   (`BrxDebugPlugin.swift`) is written but has never been exercised by a compiled build before this sitting, so a
   broken or absent toggle is real information. If it fails, use Safari's Web Inspector (iPhone: Settings >
   Safari > Advanced > Web Inspector; Mac Safari's Develop menu) to read the iPhone's own console for every step
   below instead.
- **Log:** a pass/fail per step and the iOS version, in the experiment log.

STOP POINT 1: if the iPhone failed, run everything below on the green Pixel as player 2 instead. If it passed,
keep the iPhone as player 2 throughout, and flag any step below that needed a Pixel-only read.

Running total: 40 min.

### GAMES CHECK: the new console (about 25 min; both phones, MC)

F411 (the MC GAMES redesign) is merged (`c2c51679`, CI green on the app/server/MC jobs): PICK GAME, PLAY AGAIN,
LAST MATCH, BUILD and FAVOURITES (`docs/spec/design/games-presets.md` §6) are real, not only the design doc. The
console's second tab now reads PLAY, not GAMES (`Games.tsx`'s own header is `[ 02 // PLAY ]`); PICK GAME is the
label inside it, unchanged.

1. **11.7 + F422, the grey Pixel's true first open.** With MC already up, open the app on the grey Pixel for the
   first time since Step 0's `pm clear` and reinstall. Time the auto-join. Pass: MC sees it join and bind
   (`preflight.auto_join_ok true`) within about 3 s, no tap, AND the idle/SET MY GUN screen's dot + line reads MC
   JOINED before the gun is paired (F422: the join line must show first, not silently or only after). Only then
   pair the gun through SET MY GUN.
2. **PICK GAME in 2-3 taps.** Start a game from the new picker. Pass: 2-3 taps from idle to LOADED, no dead end.
3. **PLAY AGAIN in 4 taps.** End the match with END (not a 15-kill finish; a kill count is not a reliable line to
   force on demand at the bench), then use PLAY AGAIN. Pass: back to LIVE in 4 taps, same settings.
4. **KOTH with no hill assigned (F402, closed at the desk: confirm on hardware).** Try to LOAD a KOTH game with
   no station assigned as the hill. Pass: LOAD is blocked, and the jump to ARMORY fixes it in 1-2 clicks.
5. **LAST MATCH.** End the current match with END first (never restart MC while a match is ARMED or LIVE), restart
   MC with `--bench-volume` again (a restart forgets the flag) and re-point the Stick at the new MC
   (`stick.py cmd 10 "MC ws://<laptop>:8766/ws"`, F397), then open the console. Pass: LAST MATCH restores the
   previous settings.
6. **The countdown default.** Start a game with no countdown override. Pass: it reads 30 s
   (`DEFAULT_RUNWAY_S = 30`, confirmed on `main`).
7. **FAVOURITES round-trips (`games-presets.md` §6).** Save a favourite from a chosen set of picks, load a
   different preset over it, then load the favourite back. Pass: every pick it saved (mode, life, spawn, loadout
   pieces) comes back exactly as saved.
8. **A BUILD weapon type toggle never surfaces a hidden weapon.** In BUILD's PRIMARY or SECONDARY editor, turn on
   a type toggle (`TypeChip`, e.g. "RIFLES"). Pass: the ids it selects are only from the server's visible weapon
   catalogue (`pieces.py`: "no preset may ever select a hidden weapon"); no cut-arsenal weapon appears under any
   type, on or partial.
9. **TEAMS re-splits evenly on a count change (F413), on the 2026-09-28 UI.** In MATCH SETTINGS, change the team
   count from 2 to 3. Pass: it applies on one tap with no warning, and no team is off by more than one. Then
   change one team's colour in its dropdown: nobody moves, only that team's colour changes. Then pick KOTH
   over a BLUE/YELLOW game: yellow becomes red, nobody moves, and no dropdown offers yellow.
- **Log:** a pass/fail per step and tap counts, in the experiment log.

STOP POINT 2: the new console's core flow, F402's fix, 11.7's auto-join, F422's join line, FAVOURITES, F413's
TEAMS re-split and the BUILD type-toggle guard are all proven. Everything below (powerups, Shields, KOTH, the
Stick) is next.

Running total: 65 min.

### Group 1: two phones, two guns, the P0s then powerups (about 180 min; the highest value)

Kit: both guns and headsets, the Pixel 5 and the iPhone X (or the green Pixel, per STOP POINT 1), MC as
restarted at setup, the black Pixel and the Stick as stations, a tape measure.

**F297's phone connect metrics run first, then the three 🔴 rows still open from part 1 (F416, F417, F418)**,
each against its own FOLLOWUPS pass rule, not just carried as a note.

0. **F297 (🔴), phone connect metrics (10 min).** Pass rule (Tony, 2026-09-28, "linked within 3 s"): 10/10
   linked on every phone, a median at or under 3 s, a worst at or under 3.5 s, and zero headset drops. Log the
   first-attempt rate, but do not gate on it; anything worse is a FAIL, and feeds F297/F293
   with the numbers, not an impression. A/B/A: **A** first, the laptop control (Windows Python; WSL has no
   Bluetooth) — `cd mcp && python -m brx_mcp connect-metrics <gun-address> --runs 3 --cold warm --hold-s 60` — 3
   quick re-runs of the existing control (10/10, median 1.37 s, p90 2.41 s, max 3.76 s, headset drops 0/10,
   `bench-2026-09-24.md` Block 1.1) to catch drift before **B**. **B**, per Pixel (at least two: grey and
   green), 10 cold connects under default phone settings (Fast Pair ON, as players carry them), gun and headset
   paired as they are in play, not freshly bonded: force-stop the app, let the headset settle, reopen to SET MY
   GUN, and log each run's connect time from the phone's own log (1 s resolution) plus a stopwatch — the tool
   itself is laptop-only and cannot hold the link while a phone does, so this repeats Block 1.2's method, not the
   CLI. Record per phone: connect time (median and max), first-connect success out of 10, and any headset drop
   at connect or in the 60 s after it (this also watches for F293's 5-12 s loop). Close with **A** again, 3 more
   laptop `connect-metrics` runs. Log every number against F297's row.

1. **F416 (🔴), the A/B/A on phone-to-gun distance (15 min).** The one false start in part 1 had both guns
   carried away from their own phones; the clean starts had each phone with its gun. Go live three times: phones
   about 10 m from their own guns, then beside them, then apart. Pass, for EACH of the three runs: the phone log
   shows a `write err` at go-live (`brxlink.js`'s own write failure), then the check's own line (`F416: ... the
   gun reads a 0 pool ... re-sending (n/2)` or `F416: ... landed`), then the gun's pools read up, with no false
   "down". A run with no `write err` proves nothing about the fix and reads INCONCLUSIVE, not a pass.
2. **F416, go-live with the Stick hill scanning (5 min).** Repeat one go-live with the Stick armed as a hill and
   actively scanning (the suspected radio-quiet trigger). Pass: no false down; the station scan should now yield
   the radio for 1.5 s around the spawn write (`radioQuiet`).
3. **F416, three `$LIFE,0,0,0` reads, then a power cycle (10 min).** Force-stop the phone app that holds this
   gun first: a gun takes one BLE central at a time, so the laptop MCP cannot connect while a phone still holds
   the link. On the laptop MCP, arm from `compile.resolve()` (never a capture), using the Toxin Rifle
   (`toxin_rifle`, `mcp/brx_mcp/mc/weapons.json`, the one weapon with a poison dot) for the mid-poison read. Read
   `$LIFE,0,0,0` on: an unspawned gun (confirm it answers `$HP,0,0,0`, as the fix assumes), a gun mid-poison from
   the Toxin Rifle, and a gun under a shield (confirm the read moves no pool in either case). Power-cycle the gun
   at the end, per the bench-session skill's safety rule. Log each read.
4. **F418 (🔴), a held pickup survives backgrounding (5 min).** Hold Rockets, background the app for Android
   Settings for at least 30 s, come back. Pass: the Rockets stay, with their charges (reproduced on `main` in
   part 1 before the fix).
5. **F417 part 2 (🔴), the Stick's double-grant race, then F381 (15 min).** Two phones walk into one Stick
   Rockets station together, at least three times, Stick serial logging on and both phones' logs on (ROBP1 needs
   WebView debugging on, or its log pulled through MC before any app restart). Read every Stick serial `CLAIM
   station=… taker=…` line and every phone `powerup: station N advert state S taker T value V seq Q (… dBm, … ms
   old)` line. Pass: exactly one phone grants on EVERY one of the three (or more) walk-ins, and each grant follows
   a Stick advert naming its own player number. Fail: any walk-in where a phone grants with no advert naming it.
   Then re-run F381 on the phone just granted Rockets (2 held): fire one rocket (2 held, now 1), re-take Rockets
   and expect 3, then take again with no firing and expect the cap at 4 (`PU_STACK_CAP_X = 2`,
   `app/src/engine.js`). If an `$AMMO` write is lost along the way, log it as "counts re-sent" (the F417/F418
   repair re-sends a lost count at most twice) rather than a fresh fail.

STOP POINT 3a: the three P0 rows from part 1 (F416, F417, F418) are proven or reopened. Powerups next.

Running total: 125 min.

6. **F348 (🔴), a Shields spawn starts at full shield (10 min).** Arm a Shields-preset match (45/0/105).
   Control: a Standard-preset spawn shows no shield line. Read the gun's own `$HP,<hp>,0,105` read-back from the
   Pixel's rx log only (the laptop cannot read a gun while a phone holds it) at spawn, not just the HUD meter. Pass: every spawn and revive's log
   ends `+ shield pool 105`, the read-back agrees, and one hit drains the shield before any HP moves. Log:
   `bench-2026-09-24.md` 4.18.
7. **F394, ammo pips match the number after ALT and after a reload (5 min).** ALT-switch twice, then reload
   once, on either phone. Control: fire one shot first and confirm the pips and the number agree. Then ALT with
   **no** shot, and compare the HUD's ammo number and pips against the gun's own physical round count (a manual
   check of the magazine, or `$ALCD`), not only against each other. Pass: after ALT and after the reload, the
   number, the pips and the physical count all agree with no shot needed. Log: which phone, per
   `bench-2026-09-24.md`'s F394 row.
8. **4.0, the 0.4.15 release loop (20 min).** First launch in day mode, then night mode, on both phones. Then one
   short match through MC: lobby, arm, live, a death and its death screen, the recap. Pass: every screen appears
   in order on both phones, Android and iOS alike, with no stuck or blank state. Log: a screenshot of any defect.
9. **11.6, MC-assigned station ids (F364, closed: confirm; 5 min).** Assign the black Pixel and the Stick on
   ITEMS with no id. Pass: MC gives them two different ids that survive a Stick restart. Log: both ids.
10. **The powerup setup, in order (S58, the now-shipped F372 default; 90 min).**
    - 4.11, the claim calibration (35 min): the ladder at 15/30/60/100 cm, 2 m and 3 m against the phone station
      and the Stick powerup, both player phones, phone on the rail facing the station, 30 s a rung. Log the median
      each phone reads per rung (the `powerup:` lines). Then repeat 30 cm and 3 m with the player's body between.
      Background (2026-09-28): at the Stick's old -57 default a Pixel 5 read about -40 at 30 cm (reported, not
      logged) and -49 to -60 at about 3 m, and claimed from 3 m (F434). The Stick powerup default is now -45 (reflash
      from main). Control: 3 m gives no ring. Pass: one threshold per station type with at least 4 dB
      margin to the weakest 30 cm median and the strongest 3 m median, on both phones (RSSI reads are Pixel-side;
      judge the iPhone's ring by eye).
    - 11.2, the claim, the winner and the respawn (15 min). Control: 2 m gives no ring. Pass: a 1 s dwell at
      30 cm claims; two players racing gives exactly one winner; the item respawns on schedule; death loses it.
      **TAKEN is checked on the station screen only**: per F425, the player HUD no longer shows a TAKEN hint or
      a countdown at all.
    - 3.4, the heavy on the trigger, end to end (25 min). Pass: SELECT toggles it, running dry restores the saved
      weapon, a death re-equips the saved weapon, Easy Reload still gets the grant.
    - 3.5, the overshield, protected (15 min). Pass: a hit during the 1 s grant is ignored, a hit after it drains
      the overshield first, it survives a respawn's `spawned` state.
    - Log: a pass/fail per item, in `bench-2026-09-24.md`'s own tables.

STOP POINT 3: the P0s, the new console, the iPhone build, the release loop, F348, F394, station ids and the
whole powerup setup (S58, the shipped F372 default) are all proven. **KOTH is next**: it is MVP, being built
right now (F382-F386), and costs only 15 min for high value, so it must land inside this block rather than
after it.

Running total: 255 min.

### Group 2: KOTH, phone hill then Stick hill (about 20 min; same hardware, no change)

1. **Game 1, phone hill (5 min).** MC: mode koth, station_source phone. Control: the point sits NEUTRAL with no
   tick before anyone approaches. Pass: the capture sound and HUD event fire; the tick runs every 3 s held, 1.5 s
   losing, silent while CONTESTED; the score pauses while CONTESTED; MC's recap names a winner. This is the
   phone-hill half F420 blocked in part 1; F420 is built (`60b9db70`), so it should run clean now. **F420**: once
   the hill phone is MC-armed, exit it through the ⓘ icon at the top edge (now clear of the status bar). Pass: it
   is tappable and opens the exit drawer, no dead end. **F421**: release the black Pixel from utility
   (`release_utility`). Pass: it rejoins MC as a HUD node within a few seconds, with no typed ws address needed.
2. **Game 2, Stick hill (10 min).** Same config, the Stick as the station. Pass: as game 1, plus F386's MATCH
   OVER freeze (the Stick freezes on the final owner and shows MATCH OVER, unlocked) and F353 (log the phone's
   Stick-advert arrivals during the hold; Pixel-side). F384 (recapture announced) and F385 (HUD card clears) are
   already CONFIRMED and closed in part 1; do not re-run them.
3. **The HOLD target ends the match early (F415).** Set HOLD to 3 MIN before LOAD. Pass: the match ends the
   instant one side's possession reaches 3:00, the recap names that team, and the pre-match BRIEFING's WIN row
   read "FIRST TO HOLD 3:00 WINS".
- **F416's scan-quiet question.** Across both games, watch whether the hill ever misses a capture or a tick
  inside the station-scan quiet window MC now opens around each spawn (about 9 s, F416 part 2).
- **F424.** In either game, tap the clock to open the KOTH score panel. Ask Tony to judge the HOLD TIME board's
  readability (mm:ss, this phone's own possession tally) at a glance.
- **Log:** the times to CAPTURING, HELD, CONTESTED and neutral; both phones' read of the point; the F416
  scan-quiet watch; Tony's F424 readability verdict.

STOP POINT 4: this closes the P0-then-powerups-then-KOTH core of the sitting, about 3 h of bench time once
setup is done. Everything after this is worth less per minute.

Running total: 275 min.

### Group 3: F386's powerup-station MATCH OVER checks (about 15 min; no guns, no match)

F387 and F333 are already CONFIRMED and closed (part 1); do not re-run them. F386's own fix (`c332b662`,
`01050e27`) still needs its bench check, right after a powerup END:

1. **(a) The Stick shows MATCH OVER on a powerup station too (4 min).** End a powerup match. Pass: the Stick's
   screen shows the item plus MATCH OVER, and its countdown stops.
2. **(b) No grant after END (3 min).** Stand at the Stick after END. Pass: no grant, no ring.
3. **(c) The idle-timeout control, done cleanly, serial log on (5 min).** Open STATS, wait about 18 s, then hold
   A. Pass: RANGE opens at 5 s, not cut short by the 20 s HOME idle timeout (this confounded F387's own control
   in part 1; `01050e27` now counts a held button as activity).
4. **(d) The phone doesn't see the item as available after END (3 min).** Pass: after END, the phone's own
   powerup state does not show the station's item as available.
- **Log:** a pass/fail per check.

STOP POINT 5.

Running total: 290 min.

### Group 4: two phones, two guns, the rest of sitting C (about 67 min; same hardware, no change)

Kit: as Group 1.

1. **11.4, the phone station's range edit (F365; 10 min).** Control: a tap and a knock do nothing. Pass: a 1.5 s
   hold opens RANGE, the edit reaches MC (EDITED ON STATION) and the walking phone's threshold changes. Log:
   MC's feed lines; the walk-in RSSI is Pixel-side, or judge the iPhone's own screen by eye.
2. **F400, the pickup switch card (10 min).** Take a heavy pickup. Pass: the full switch-card callout shows on
   the grant, on both SELECT directions and on the empty switch-back; ALT still holds its own time; SELECT works
   at once while the card is up. Then the two 0.4.15 lows: the STOWING/DRAWING/ACTIVE label reads at a legible
   size (was 10 px, under the 11 px floor); the ACTIVE bubble closes on the equip echo, not just its timer (was
   stuck on READY). **Ask Tony** whether a kill card should wait under the switch card (his lean, unconfirmed;
   see "Decisions for Tony" below). Log: a pass/fail per sub-check, and Tony's answer.
3. **F419, the phone's own queue path drops a cue (10 min).** F381's Rockets re-run already ran in Group 1's P0
   block, so this item is F419 only. Get a real kill plus a medal from the engine with the phone linked (a
   two-gun kill that earns first blood, or a double kill), so two cues queue on the phone's own token-4 path, not
   a synthetic laptop-MCP frame. Pass: both cues play in full, in order. Group 7's `$PLAY` spacing check (one
   gun, laptop MCP, `gap_ms=300`) is the control for this row, not the reproduction; keep both results.
4. **F399 and F380 merged, the Stick claim-latency re-run on an Overshield Stick (12 min).** Heavies respawn every
   120 s (`HEAVY_SPAWN_EVERY_S`, `mcp/brx_mcp/mc/powerups.py`), too slow for nine claims in this slot; assign the
   Stick an Overshield item instead (`OVERSHIELD_SPAWN_EVERY_S = 60`, same file), which fits nine claims in the
   time. Stand at the Stick until the claim is ready, nine times. Time each claim on the Pixel's own log only,
   from `powerup: claim ready at station <id>` to its grant write; use the Stick serial only for its own
   CLAIM-to-advert interval, not for the claim timing itself; read MC's session log
   (`python -m brx_mcp.mc.diag <session.sqlite>`) only for the grant row `<GUN> TOOK OVERSHIELD · STATION #<id>`.
   The Pixel makes all nine claims. **F380** (folded into the same nine): CONFIRMING shows every time, then the
   grant lands, with no NOT ANSWERING before 15 s (`POWERUP_NO_ANSWER_MS`); fail on any claim that reads NOT
   ANSWERING before then. **F399**: over the nine claims, the median is 2 s or less and the maximum 3 s or less.
   **F425's silence check**: after one claim, have the other player approach the same station while it reads
   TAKEN; pass means the HUD stays silent (no TAKEN hint, no countdown) for the player who did not take it.
5. **F374, the HELD Stick carried out of Wi-Fi before START (10 min).** Arm the Stick as a pickup, carry it out
   of Wi-Fi, then push START. Control: part 1 (LOBBY/countdown) already CONFIRMED. Pass: the Stick reads READY
   within a second of `first_at_s`, and no phone claims before it.
6. **11.8, death first (F158, F3, F21, F375 step 6; 15 min).** The scream and the death stop are never cut; a
   kill confirm, a medal or a hill line queues after it. Step 6 (F375, fixed in code, bench pending): take a
   player under 15 HP, then kill within about 1 s, three times normal and three times with a Shields life
   broken first. Pass: "Health critical" never plays after the scream.
- **Log:** each item against its own pass rule, in `docs/experiment-log/2026-09.md`.

STOP POINT 6: sitting C's higher-value checks are all done. The Shields fight, the kill-cue retest and the
voice audition are the lowest value per minute of the two-phone work and are next.

Running total: 357 min.

### Group 5: the Shields fight, the kill-cue retest and the voice audition (about 30 min; same hardware, no change)

1. **The pickup voice audition (10 min).** An **arm's-length try-out level** (`$VOL,69`, one gun; not MC's own
   `--bench-volume`). Play VA56 "Rocket Launcher!" and VX0S "Weapon Swap" alone, each twice. Then take a real
   Rockets pickup in a match and listen for what actually plays on the equip (today suspected to be the
   shotgun-like sound riding in the captured `$WEAP` head). Take an Overshield and confirm it plays the
   shield-charge cue (N102) with no voice line. Log: Tony's pick, and what actually played on each real pickup.
2. **The kill-cue A/B/A (F347, closed: confirm on 0.4.15; optional, 10 min).** t23 EMPTY. A kill confirm with the
   shield up, then at 0, then up again. Pass: on time, all three. Skip first if time is short: F347 is already
   closed at the desk.
3. **F298, a real Shields fight (10 min), the announcer and medal audio (S57).** A kill confirm, first blood, a
   double kill, a lead change. Watch for a wrong IR magnitude (S57: 22 read as 28).
- **Log:** each item against its own pass rule, in `docs/experiment-log/2026-09.md`.

STOP POINT 7.

Running total: 387 min.

### Group 6: a field walk (about 15 min; the Stick and one phone)

1. **F383, Stick-hears-phone at 3, 5 and 7 m (15 min).** The -75 dBm default. Tape-measure the three marks
   first. Start with an out-of-range control (well beyond 7 m: no presence read). Then walk the phone in to each
   mark. Pass: present at 3 m and 5 m, absent beyond 7 m, with no flapping. Log: the RSSI at each mark.

STOP POINT 8.

Running total: 402 min.

### Group 7: one gun, no phone (about 15 min; lowest priority)

1. **The `$PLAY` spacing control (5 min).** One gun on the laptop MCP, the phone app force-stopped. `send_batch`
   at `gap_ms=150`, then `gap_ms=300`. Pass: all four clips play, in order, at both gaps. This is the control for
   Group 4's F419 check, not a substitute for it: it exercises the laptop's synthetic frames, not the phone's own
   queue path.
2. **F282, silenced vs standard, eyes and ears (10 min).** A dark room, one weapon armed silenced then normal
   then silenced again (`compile.resolve()` with the preset, never a hand-built frame). Pass: a clear
   muzzle-flash and loudness difference, or none, is agreed on both readings, not just the first.
- **Log:** what Tony saw and heard, per pass.

**Total across every group: about 407 min (6 h 47 min). The practical 3 h core is the P0 block, the powerup
setup and KOTH (Groups 1 and 2): STOP POINT 4, above.**

Rules for every sitting: the preflight in [`gotchas.md`](gotchas.md) ("Before a bench session", which holds the rig
check), `$VOL,65` (the house default; raise it only if Tony asks), and never end on a bare `$CLEAR` (F11). Restart
MC only after END, never with a match ARMED or LIVE. Close every sitting with the three writes in
[`README.md`](README.md) ("Session close is three writes").

## Equipment key

- **2 guns**: shooter A and victim B, armed as in [levers "Roles and arming"](bench-firmware-levers-2026-09-19.md#roles-and-arming).
- **Rig**: the ESP32 IR rig (board A receiver COM7, board B emitter COM8).
- **Outdoor**: a range of 25 m or more, in shade.
- **Ears**: Tony listens and judges a sound.
- **Phones + MC**: both Pixels and Mission Control, for a real match.

Short names: **levers** = [`bench-firmware-levers-2026-09-19.md`](bench-firmware-levers-2026-09-19.md),
**screamers** = [`bench-screamers-2026-09-19.md`](bench-screamers-2026-09-19.md).

## Done: do not re-run

Levers session 1 ran in three sittings on 2026-09-18 (the log's three "firmware levers session 1" entries):
§1 runs a-e, §4 step 1, §5 (all, including the shield flag and the sound token), §6 step 4 and §10 fn 34 (both
answered by §16), §12 steps 1 and 3 (answered by §23), §13 step 1 and step 3 (magnitudes 1-39), §16 steps 1-3 and
6.1-6.2, §18, §19 step 15 (answered by F71 and F263: one Shotgun pull sends two words), §21 steps 1-10 and 15-18 (t4,
t5, t6, t7, t8, t9), §22 steps 1-6, and §23 (all five steps). Screamers A1 and A2. F276 (the Shotgun words). The whole perks sheet
(`bench-perks-2026-09-18.md`, §1-§8). F230 closed, so levers §19 step 18 is dropped.

**Pre-game check, run 2026-09-19 (Saturday morning office test).** Tony installed the 0.4.0-0.4.2 APKs across the
session. Levers §1 run f (a real TDM through Mission Control with two guns) **PASSED**: cross-team hits
registered on both sides, closing F206's last open gate. The spawn-protection check found a real bug instead of
confirming the design: on 0.4.2 a hit landed damage 0.73 s after a respawn even though the same window blocked
other hits cleanly. That result, plus a shooter seeing a protected player flash "hit" with no damage and a
respawner firing while still protected, drove the 0.4.3 respawn-profile rebuild the same day (F121/F209 closed,
superseded). See `docs/experiment-log/2026-09.md` (2026-09-19 pre-game entry) for the full write-up.

**The 2026-09-24 runbook, [`bench-2026-09-24.md`](bench-2026-09-24.md)** (the experiment log's 2026-09-24 bench
entries). Done: Block 0; Block 1 (F297's laptop control, 10/10 at a median of 1.37 s; F293's loop reproduced on
demand, so step 1.3's capture was not needed); Block 1.4 including step 5 (a mid-match headset power-cycle
reconnected in 2 s with no loop); Block 3.1-3.3 (F308's release order and fire intervals; S58's pickup slots,
button map and overshield clamp); Block 4.3 (the AR ladder passed the spec but felt too harsh, so the balance lane
eased `heavy` 40 to 45 and the Burst Rifle gap 550 to 540 ms, F308); Block 7 step 11 (S57: the victim-name word was
lost inside the headset's rate guard, and the wider gap is on main); and the evening audio A/B/A on one gun (F347:
the native shield hum blocks the gun's audio queue). Off the plan the same day: melee (K4, closed) and F336.

**The 2026-09-25 sitting, `bench-2026-09-25.md`, sittings A and B and stop point 2.**
Sitting A closed the 0.4.12 gate: A4, F341, F347 (t23 ships EMPTY, no restart delay needed), and F350 (H21 picked,
playtest confirmation left to sitting C's 11.1(c)); 4.19 parts 2-3 and the Burst Rifle gap stayed INCONCLUSIVE.
Sitting B closed F332, the Stick pickup online and offline (S58, found F380 and F381), F333 (reopened by Tony for a deliberate walk; F398 filed),
and Block 9 steps 3 and 4 (H9, H8, found F383-F386); it left F374's carry-out A/B/A un-run, F353 not logged, and
F365's Stick half PARTIAL (RADIUS/STRENGTH confirmed, the 5 s gesture REFUTED as F387, F388 filed; the phone
station half, 11.4, did not run). **Stop point 2 is DONE**: all three Pixels are on app 0.4.12; the grey Pixel
has not been opened since that install, so 11.7's auto-join must be sitting C's first step; MC runs from `main`
(powerups on by default, F372).

## Sittings, in priority order

### Superseded: `bench-2026-09-25.md`, sitting C

Folded into "Next sitting: after GAMES and 0.4.14" at the top of this file, which supersedes the list below, the
"Carry into sitting C" list and the "Awaiting Tony" note that used to sit here. Kept only for the sheet's own
history; do not run from this section.

### Sitting 1: screamers Phase A, transport half (about 55 min; 1 gun, a laptop)

Screamers are P0. Screamers A1c (the nonblocking loop control, **F272**), A3, A5, A6, A11, A12; A4, A7, A7b, A7c and A8 run in the runbook's Block 2. A7 and A8 give the block-pacing
numbers (**F269**, **F270**); a lock-up feeds **F272**. Keep the block pause off until A7 and A8 give a number.
A3 repeats A1 on other channels and can lock the gun: power-cycle and re-arm before the next step.

### Sitting 2: the rest of levers session 1 (about 100 min; 2 guns, ears, the rig for steps 8 and 9)

1. Levers §21 step 19, `$TMP` t10 crit chance, including the same-value re-send control (10 min). **S50**, **F285**.
2. Levers §21 step 11, and one run that asks whether t9 applies per slot or once for every slot (10 min). Extended
   Mags on `$TMP` waits on this. **S50**.
3. Levers §21 steps 12-14, t1-t3 pool maxima, repeating each same non-zero write before the second read (15 min). **S50**, **F285**.
4. `$TMP` t6 re-send: send t6 = 50 twice, then time one reload (5 min; method in the row). **F285**, **F281**.
5. Complete the F285 table: repeat same non-zero t5 and t7 writes and compare fire timing/damage; for t11 first
   prove the missing-row default sound, then write two distinct ids and identify which one plays (15 min). **F285**.
6. Levers §12 step 2 (does `$STOP` gate the trigger?), then §4 step 2 (a `$SIR` p5 stun on hit) (10 min). **U11′**.
7. **F262**: the shield-hit sound by sensor, ten shots at the headset and ten at the gun body (10 min, ears).
8. ~~Levers §2, melee.~~ **K4** closed 2026-09-24: melee works in our compiled game (bench 2026-09-24 entry, `archive/followups-closed.md`). Steps 5 and 7 (the `$BHIT`/`$FIREX` controls) stay optional, not blocking.
9. Levers §16 step 6.3: does `$CLEAR` stop a headset `$IRTX` loop? (5 min, the rig). **S57**.
10. **F282**: the compiled Suppressor against the compiled AR in a dark room: does either flash, and which is quieter?
   Then `$WEAP` t25/t26 at 0 and at a large value on one weapon (10 min; eyes, ears; method in the row).

### Sitting 3: the recoil numbers, groups A and B (about 30 min; 2 guns on a fixed mount)

Levers §26 groups A and B, pinned with `$TMP` t4 (§21 answered how; see "If §21 moves the mechanism"): the
measured recoil numbers behind the shipped rungs. Groups C, D, E and F go into sitting 8.

### Sitting 4: screamers Phase A, IR half (about 50 min; 1 gun, the rig)

Screamers A8b, A9, A10, A13. A13 gives the per-gun traffic budget (**F274**). A13 replays the shipped recoil writer,
which writes `$TMP` t4 only (S55, shipped).

### Runbook Block 2b: the native kill word and the R4 readings (70 min, plus 20 optional)

The old sittings 4a and 4b. Kit: 2 guns and their headsets, the rig, a laptop and a camera, plus Phones + MC for
the hosted trials. The procedure is [Block 2b of `bench-2026-09-24.md`](bench-2026-09-24.md): native
Death Match kills N1-N3, and the short R4 checks (**F320**, **F321**, **F322**, fn 36/37 on domes 1-3, fn 18/22 on
an enemy, the stored-ID compare, native Survival and FFA). The hosted trials H1-H3 ride on Block 4.2's kills, so
they need both Pixels and Mission Control. Do not send `$AS,1`.

### Sitting 5: match verification (about 60 min; 2 guns, Phones + MC, film)

Levers §1 run f (F206's proof) **already ran and passed**, 2026-09-19; do not re-run it here.
1. **F264** in a live match. If a gun stalls, send `$LIFE,<hp>,0,0,1,*` then `$HLED,,6,*` BEFORE any force respawn,
   and watch for a trigger answer. The row holds the gate.
2. Levers §22 step 7: reproduce the timed-out partial reload on the Energy Rifle. **F277**.
3. **F237** (a slow Pixel 5 re-pick): the row holds its repro.
4. The stun cue: hit a player with the EMP and listen for `X17` on the victim's gun (commit `273e949a`; the row is **U11′** in [`post-mvp.md`](post-mvp.md)).
5. The shield recharge cues on the Shields preset (**F349**: `N101`, `N102`, `VA6Y`, `N74`). If the runbook's 4.19
   already ran them, do not re-run them here; note the result instead.

### Sitting 6: levers session 2 (two sittings; 2 guns, the rig for §9 step 5)

- 6a (about 50 min): §3 `$BHIT`, §6 steps 1-3 (the shield levers), §7 (**S50**), §8 the fuse; use the levers sheet as the procedure source.
- 6b (about 40 min): §9 the crit bonus (**S50**), §10 fn 35, 38, 30, 33, 50-52 (**U11′**), §15 a headless gun (**B26**).

### Sitting 7: levers session 4, the IR rig (two sittings; 2 guns, the rig)

- 7a (about 50 min): §11 splash, §16 step 4 (field 4 = 1), §17 station words (research: the MVP respawn station runs over Bluetooth).
- 7b (about 45 min): §20 indoor half (**S48**, **Q15**), §24 the proc block (**F63**). §13 steps 2 and 3
  (magnitudes 40-63) are optional now (**S57**).

### Sitting 8: the recoil numbers, groups C to F (about 35 min; 2 guns, Phones + MC)

Levers §26 groups C, D, E and F, on the phone's node. The rung basis is settled (S54, `aa7b08b9`); the rungs to
expect are the recoil table in `spec/node.md` §3.15.

### Sitting 9: levers gap sweep (two sittings; 2 guns, the rig for two steps)

- 9a (about 45 min): §19 steps 1-9.
- 9b (about 40 min): §19 steps 10, 11, 14, 16 and 17. Step 17 (`$AS,4`) runs only after sittings 1 and 4. Steps 12
  and 13 moved to §21 and §22; step 15 is answered (F71, F263; the emitter and its reach are F275, sitting 10); step
  18 is dropped.

### Sitting 10: outdoor (about 60 min; 2 guns, outdoor, the rig or the S49 receiver)

**F275** (the `t13` ladder: where the headset word stops arriving). Then the outdoor half of levers §20. Then **F171**
and **F195** (aim tolerance in degrees) if time allows. ⚠ F254 is CLOSED (the eleven-row `$SIR` table). The outdoor
headset-word row was F254 before its renumber and is F275 now.

### Unattended and long runs (no sitting)

- **Screamers Phase C** runs 1-4, 2 h each, one gun and a laptop (now unblocked with `soak --phone-pacing` built). Run 3 soaks the `$TMP` t4 recoil writer (S55, shipped).
- **Screamers Phase D** (3 h, all guns, Phones + MC, the rig), after the Phase B rules are built.
- **Screamers Phase E** (20 min), after the lock-up detector (**F272**) passes its bench validation.

### Backlog (no fixed order; pick by setup)

- [`bench-sticks3-2026-09-23.md`](bench-sticks3-2026-09-23.md): the M5StickS3 gates. Gate 2 (IR receive, **F314**) is
  post-MVP (**F338**, Tony 2026-09-24); the Stick MVP runs over Bluetooth, Block 9 of the runbook.
  Kit: a Stick, the rig, a laptop, one gun for gates 4 and 5.
- [`bench-grenade.md`](bench-grenade.md) "Still to run": B0 first, then X, Z1-Z3, D, B, E, F (C is answered).
- The unrun rungs of `bench-queue-2026-09-09.md` that the table below does not mark as
  moved. Do not run BQ-A2 (`$AS,1`): it starts a native game, a screamer path.
- Rows whose method is in the row itself: **F232** and the other "Later" rows of the FOLLOWUPS MVP BENCH group
  that no sheet names yet, and the post-MVP **F167**, **F168** and **F169**.

## Desk work (no gun)

The HANDOFF lanes point here. Each item names its row, its lane, and what blocks it.

| row | lane | the work | blocked by |
|---|---|---|---|
| **F300** | levers and screamers | decode the remaining `$QUERY` sound/gyro/per-slot loop before extending arming read-back | stock-image/capture decode |
| **F269** | levers and screamers | switch the block pause on, and decide the runt `$SIR` rows | sittings 1 and 4 (A7, A8, A8b) |
| screamers Phase B: **F270**, plus one new row per trigger that Phase A reproduces | levers and screamers | one rule in code per reproduced trigger (write with response; the `$PB*`/`$AS` deny list) | sittings 1 and 4 |
| **F285** | levers and screamers | desk table is done; replace its UNMEASURED cells only from recorded bench results | sitting 2 steps 1, 3-5 |
| **F274** | playtest and node | measure the recoil writer's BLE write budget and complete the hardware soaks | A13 and the three two-hour hardware runs; S55 is shipped |
| **F277** | playtest and node | a detector for a reload that never completes | sitting 5 step 2 (a repro) |
| **F281** | weapons and perks | move Quick Hands onto `$TMP` t6 in one piece, or not at all | sitting 2 step 4 (t6 absolute or additive) |
| **S50** | weapons and perks | Extended Mags on `$TMP` t9 (one write per life, after `$SPAWN`, then an `$AMMO` fill) | sitting 2 step 2 (per slot or not) |

## Preconditions (build these first)

| tool or change | blocks | row |
|---|---|---|
| Screamers Phase B rules in code | Phase D | after sittings 1 and 4 |
| The lock-up detector's bench validation (built) | Phase E | F272 |
| Block pacing switched on, at the A7/A8 values | Phase C and D results that count | F269 |

## Which sheet owns what

| sheet | status | owns |
|---|---|---|
| [`bench-firmware-levers-2026-09-19.md`](bench-firmware-levers-2026-09-19.md) | live | claims 1-27, §1-§26 |
| [`bench-screamers-2026-09-19.md`](bench-screamers-2026-09-19.md) | live, P0 | the screamers: Phases A-E (A1, A2 done) |
| `bench-perks-2026-09-18.md` | history | every section answered 2026-09-18 |
| [`bench-sticks3-2026-09-23.md`](bench-sticks3-2026-09-23.md) | live | the M5StickS3 bring-up gates (**F314**, H7); run with the `m5stick-bench` skill, no fixed sitting |
| [`bench-grenade.md`](bench-grenade.md) | open, backlog | the grenade and hill rungs |
| `bench-queue-2026-09-09.md` | superseded as the order | the method of its unrun rungs. Moved: BQ-C2 answered (perks §1); BQ-C3 is levers §24; BQ-D2 is levers §2; BQ-D6 is levers §10; BQ-C8 is levers §19 step 11 |
| the 2026-09-05 flash-control, 2026-09-07 super-indoor and 2026-09-11 critical sheets | history | archived 2026-09-24: grep only. Critical: BC-A2 is levers §21 step 16 (done) plus grenade Z1; BC-B3 is grenade X; BC-C1 is levers §6; BC-C2 is answered (perks §2). Super-indoor: Q15; Tony defined S48 on 2026-09-23, and its sweep is Block 6 of the runbook. Flash-control: L1-L9 answered; BQ-D8 cites its rungs 9-10 |
| [`capture-runbook.md`](capture-runbook.md) | method | how to take a capture; no status |
| the 2026-09-13 runbook and the 2026-09-17 weapons sheet | history | already archived: grep only, open no step from them |
| [`FOLLOWUPS.md`](FOLLOWUPS.md) MVP BENCH, and [`post-mvp.md`](post-mvp.md) | register | the ids (MVP, then post-MVP); this plan is the order |

## Decisions for Tony

| decision | what it blocks |
|---|---|
| The ALT indoor/outdoor wording in `manual/fix.md` "IR isn't registering hits" step 4. The page says the field test found no emitted-range change, but V4_31 shows the mode sets emitter power (F171) | no sitting; a manual edit |
| Should a kill card wait under the pickup switch card, or take over it? Tony's lean is wait, unconfirmed (the switch card itself passed 2026-10-02) | the switch-card clash fix, checked in the "after GAMES and 0.4.14" sitting above |
