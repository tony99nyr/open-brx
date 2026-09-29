# Bench sheet: the Stick, 2026-09-29 (everything that needs the M5StickS3 station)

Updated: 2026-09-29. One of three independent sheets for today; the index is [`bench-plan.md`](bench-plan.md) →
*Part 3*. The other two are [`bench-standard-2026-09-29.md`](bench-standard-2026-09-29.md) and
[`bench-mac-2026-09-29.md`](bench-mac-2026-09-29.md). How a bench run works with Tony: the
[`bench-session` skill](../.claude/skills/bench-session/SKILL.md); the Stick's own rules (COM port, download mode,
serial reads): the [`m5stick-bench` skill](../.claude/skills/m5stick-bench/SKILL.md). Each step names its
FOLLOWUPS row.

**Time:** about 3 h: setup 25 min, steps 1-5 (the core) 85 min, steps 6-9 about 55 min.

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
- Bench audio `$VOL,65` (`--bench-volume`). Restart MC only after END. After any MC or Stick restart, re-point the
  Stick (setup step 5).

## Setup (about 25 min)

1. `adb connect` the grey and green Pixels (and the black one for step 4). Install the unpublished 0.4.16 APK:
   `adb -s <ip:port> install -r /home/tony/apk-0.4.16/brx-companion-0.4.16-android-release.apk`, then log
   `adb -s <ip:port> shell dumpsys package com.openbrx.companion | grep versionName`.
2. Start MC from the latest `main`, detached:
   `cd mcp && setsid nohup ../.venv/bin/python -m brx_mcp.mc --bench-volume > ~/mc-$(date +%Y%m%d-%H%M).log 2>&1 &`.
   Log the banner and the token.
3. **Reflash the Stick from `main`:** `python3 hardware/m5sticks3/tools/stick.py flash`. Log the sha it was built
   from.
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

**6. KOTH, the Stick hill (15 min).** Follow [`bench-plan.md`](bench-plan.md) → *Group 2*, game 2 and item 3
(F415's HOLD 3 MIN target). First confirm the Stick reads `threshold=-75` as a hill (setup step 8 of Part 2's
*Step 0* has the reset). Rows: F386, F353, F424.

**7. F399 and F380 on an Overshield Stick, plus F425 (12 min).** Follow *Group 4*, item 4, with RESPAWN 0:30
instead of the 60 s default, so nine claims fit in about 5 min. Rows: F399, F380, F425.

**8. F386's MATCH OVER checks (15 min).** Follow *Group 3*, checks (a) to (d). Row: F386.

**9. F374, the HELD Stick carried out of Wi-Fi (10 min).** Follow *Group 4*, item 5. Row: F374.

## Close

Follow the bench-session skill's close. Power the Stick down or leave it on MC's feed; power-cycle any gun the
laptop armed.
