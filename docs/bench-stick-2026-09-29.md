# Bench sheet: the Stick, 2026-09-29 (everything that needs the M5StickS3 station)

Updated: 2026-10-03. One of three independent sheets for today; the index is [`bench-plan.md`](bench-plan.md) →
*Part 3*. The other two are [`bench-standard-2026-09-29.md`](bench-standard-2026-09-29.md) and
[`bench-mac-2026-09-29.md`](bench-mac-2026-09-29.md). How a bench run works with Tony: the
[`bench-session` skill](../.claude/skills/bench-session/SKILL.md); the Stick's own rules (COM port, download mode,
serial reads): the [`m5stick-bench` skill](../.claude/skills/m5stick-bench/SKILL.md). Each step names its
FOLLOWUPS row.

**Time:** about 3 h 20 min: setup 25 min, steps 1-5 (the core) 85 min, steps 6-12 about 90 min.

## Kit

- The M5StickS3 on USB (COM10 last time; `stick.py ports` finds it).
- Two guns with their headsets: Tactix-FE30 (grey Pixel, player 1) and Tactix-9498 (green Pixel, player 2).
- The grey and green Pixel 5s as players, on the rail. The black Pixel for step 4 only.
- A tape measure, marked at 15, 30, 60 and 100 cm, 2 m and 3 m from the Stick.

## Method (it worked on 2026-09-28; keep it)

- **Drive MC through its API** (`Authorization: Bearer <token>`, `mcp/brx_mcp/mc/API.md`); station edits are
  `PUT /api/stations/{id}`.
- **Read each phone's log over CDP**:
  `/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe mcp/tools/webview_eval.py "window.brx.log.slice(-40)" --serial <ip:port>`.
  The station lines are `powerup: station N advert state S taker T value V seq Q (… dBm, … ms old)`.
- **Log the Stick serial for every powerup match**, not only the first:
  `python3 hardware/m5sticks3/tools/stick.py cmd <secs> PING > ~/stick-<step>.log`. COM10 takes one program at
  a time: close the log before any other `stick.py` command.
- Bench volume and the MC restart rule (with the F397 Stick rejoin check): the
  [`bench-session` skill](../.claude/skills/bench-session/SKILL.md) → *Volume and MC*. The re-point command is setup
  step 5.

## Setup (about 25 min)

1. `adb connect` the grey and green Pixels (and the black one for step 4). Install the 0.4.18 APK:
   `adb -s <ip:port> install -r /home/tony/apk-0.4.18/brx-companion-0.4.18-android-release.apk`, then log
   `adb -s <ip:port> shell dumpsys package com.openbrx.companion | grep versionName`.
2. Start MC from the latest `main`, detached:
   `cd mcp && setsid nohup ../.venv/bin/python -m brx_mcp.mc --bench-volume > ~/mc-$(date +%Y%m%d-%H%M).log 2>&1 &`.
   Log the banner and the token.
3. **Reflash EVERY Stick from current `main` before the session:** `python3 hardware/m5sticks3/tools/stick.py flash`.
   MC refuses older firmware: its floor is `STATION_MIN_FW` "h8-0.3", and a Stick still on h8-0.2 or older shows
   the station line "STICK FIRMWARE TOO OLD: REFLASH IT" until it is reflashed. The firmware reports `h8-0.3+<git sha>`, with
   `_dirty` added when built from a dirty tree: log that string, and reflash from a clean tree if it says `_dirty`.
   Other new lines can appear. On the console: "STICK CANNOT SAVE TO FLASH [N FAILED WRITE(S)], A RESTART LOSES ITS
   SETTINGS: REPLACE IT". On the Stick's serial port: "ERR MC url refused: <why> (saved url unchanged)" and
   "ERR NVS <key> write failed (<got> of <want> bytes)". Log any of them with its full text.
4. `python3 hardware/m5sticks3/tools/stick.py status`. Log the line.
5. Point the Stick at MC: `python3 hardware/m5sticks3/tools/stick.py cmd 10 "MC ws://<laptop LAN address>:8766/ws"`.
6. Both player phones join MC and run SET MY GUN.

## Steps, in priority order

**1. F434, the new powerup default (5 min).** In ARMORY, make the Stick a Rockets powerup station, then PUT its
assignment with `threshold: 0` so the platform default applies. With the Stick unlocked, run
`stick.py cmd 3 "RANGE CLEAR" STATUS`. **Pass:** `threshold=-45 threshold_src=default` for the powerup kind.
Control: switch the same Stick to a hill and read -75, then back. Row: F434.

**2. 4.11, the claim-range ladder at -45 (35 min).** Both phones on the rail, facing the Stick, 30 s a rung, at
15, 30, 60 and 100 cm, 2 m and 3 m. Log the median dBm each phone reads per rung (the `powerup:` lines). Then repeat
30 cm and 3 m with the player's body between phone and Stick. Control: 3 m gives no ring and no claim. **Pass:** on
both phones, the weakest 30 cm median is at least 4 dB above -45, and the strongest 3 m median at least 4 dB
below it (Part 2's desk estimate: about -40 at 30 cm, -49 at 3 m). If it fails, log the medians and hand them to
brx5 (the threshold is F434's decision). Row: F434, S58.

**3. 11.2 with the ARMORY overrides (20 min).** In ARMORY, set the Stick's Rockets to **CHARGES 3** and **RESPAWN
0:30**. Control: at 2 m, no ring. **Pass:** a 1 s dwell at 30 cm claims; the grant reads 3 on `$ALCD` slot 2, and
the gun fires exactly 3 Rockets; the Stick shows TAKEN on its own screen (the HUD shows none, F425) and the item
is back 30 s after the take; a death loses a held Rocket. Row: S58 (11.2), and the overrides' first bench run.

**4. 11.6, MC-assigned station ids (5 min).** Assign the black Pixel and the Stick on ITEMS with no id. **Pass:**
two different ids, and both survive a Stick restart (re-point it after the restart). Row: 11.6 (F364, closed:
confirm only).

**5. F417, a true race at the Stick (20 min).** Keep RESPAWN 0:30. Put both phones on the rail side by side, at
30 cm, both PRESENT, and let the item respawn with both waiting: that is a race inside one second, which Part 2
never got. At least five respawns, the Stick serial logging throughout. **Pass:** exactly one grant per respawn;
each grant follows an advert naming the winner; one `CLAIM station=… taker=…` serial line per grant. Also log
each phone's time to PRESENT after the respawn advert (Part 2's loser lagged 4 to 8 s). Control: one phone alone
gets every respawn. A player who camps is allowed (F435, closed): a repeat grant to a camper is not a fail. Row:
F417.

STOP POINT: the core is done.

**6. KOTH, the Stick hill and its ladder (30 min).** First confirm the Stick reads `threshold=-75` as a hill: PUT
its MC assignment with `threshold: 0`, then, with the Stick unlocked, run `stick.py cmd 3 "RANGE CLEAR" STATUS` (step
1's method). A `PLAYERS STREAM 5` line also shows `thr=-75`. **Pass:** `STATUS` shows
`threshold=-75 threshold_src=default`.

1. **The Stick hill game.** MC: mode koth, the Stick as the station, HOLD set to 3 MIN before LOAD. **Control:** the
   point sits NEUTRAL with no tick before anyone approaches. **Pass:** the capture sound and the HUD event fire; the
   tick runs every 3 s held and 1.5 s losing, and is silent while CONTESTED; the score pauses while CONTESTED. The
   match ends the instant one side's possession reaches 3:00, the recap names that team, and the pre-match
   BRIEFING's WIN row reads "FIRST TO HOLD 3:00 WINS" (F415, closed: confirm only). At the end, the Stick freezes on
   the final owner and shows MATCH OVER, unlocked (F386). Log each phone's Stick-advert arrivals during the hold
   (F353, Pixel-side). Tap the clock to open the KOTH score panel, and ask Tony whether the HOLD TIME board reads at a
   glance (F424, closed: confirm only). **Log:** the times to CAPTURING, HELD, CONTESTED and neutral.
2. **The radio-quiet watch (F416 part 2).** Through the game, watch whether the hill misses a capture or a tick
   inside the phone's radio-quiet window around each spawn (`app/src/engine.js`, `RADIO_QUIET_AFTER_MS`).
3. **The hill ladder.** Each player phone, body between it and the Stick, stands at 5, 7.5, 9 and 12 m, 3 times
   each, for 10 s at each mark. **Pass:** IN at 5 and 7.5 m every time, OUT at 12 m every time, 9 m recorded as the
   edge. Near the Stick, read each phone's gaps over CDP:
   `window.brx.presence.stations().map(s => ({id: s.id, kind: s.kind, gaps: s.gaps}))`. Log any gap over 1 s.

Rows: F386, F353, F383, F416.

**7. F399 and F380 on an Overshield Stick, plus F425 (12 min).** Assign the Stick an Overshield item with RESPAWN 0:30
(a heavy respawns only every 120 s, too slow for this), so nine claims fit in about 5 min. The Pixel stands at the
Stick until the claim is ready, nine times (the grey Pixel; the green one is the other player for F425). Time each
claim on the Pixel's own log only, from `powerup: claim ready at station <id>` to its grant write. Use the Stick
serial only for its own CLAIM-to-advert interval. Read MC's session log (`python -m brx_mcp.mc.diag <session.sqlite>`)
only for the grant row `<GUN> TOOK OVERSHIELD · STATION #<id>`. **Pass (F380):** CONFIRMING shows every time, then the
grant lands, with no NOT ANSWERING before 15 s (`POWERUP_NO_ANSWER_MS`). **Pass (F399):** over the nine claims, the
median is 2 s or less and the maximum 3 s or less. **Pass (F425):** after one claim, the other player approaches the
station while it reads TAKEN, and that player's HUD stays silent (no TAKEN hint, no countdown). Rows: F399, F380,
F425.

**8. F386's MATCH OVER checks (15 min; no guns).** Right after a powerup END:

- (a) **Pass:** the Stick's screen shows the item plus MATCH OVER, and its countdown stops.
- (b) Stand at the Stick after END. **Pass:** no grant, no ring.
- (c) With the serial log on, open STATS, wait about 18 s, then hold A. **Pass:** RANGE opens at 5 s, and the 20 s
  HOME idle timeout does not cut it short.
- (d) **Pass:** after END, the phone's own powerup state does not show the station's item as available.

Row: F386.

**9. F374, the HELD Stick carried out of Wi-Fi (10 min).** Arm the Stick as a pickup, carry it out of Wi-Fi, then
push START. **Control:** the LOBBY and countdown half passed on 2026-09-26. **Pass:** the Stick reads READY within a
second of `first_at_s`, and no phone claims before it. Row: F374.

**10. F388, RANGE refused under the lock (10 min).** Lock the Stick at LOAD, then try a RANGE hold on the Stick.
Repeat with the lock set mid-match. Control: with the Stick unlocked, the same hold opens RANGE. **Pass:** both
locked holds are refused, and the threshold does not change. Row: F388.

**11. F397, the typed MC address survives a restart (5 min).** Restart MC, then restart the Stick. **Pass:** the
Stick rejoins MC with no re-type. Row: F397.

**12. F391, the lock across an offline restart (5 min).** Tony's call (2026-10-24): the lock comes back as it was
before the restart. Load a timed match at MC (MC locks the Stick for the time limit plus about 32 min), wait at least
2 min, note `lock_s` on the `LINK` line of `python3 hardware/m5sticks3/tools/stick.py cmd 2 STATUS` (`stick.py
status` does not show it), take the Stick off Wi-Fi and restart it. **Pass:** `lock_s` on the same line after the
boot is within about a minute of its value before the restart (not 0, not 120), and the side button stays locked.
**Control:** A+B held 7 s, then the next boot is unlocked. Row: F391.

## Close

Follow the bench-session skill's close. Power the Stick down or leave it on MC's feed; power-cycle any gun the
laptop armed.
