# Bench sheet: standard, 2026-09-29 (the WSL/Windows box, the Pixels, two guns, no Stick)

Updated: 2026-09-29. One of three independent sheets for today; the index is [`bench-plan.md`](bench-plan.md) →
*Part 3*. The other two are [`bench-stick-2026-09-29.md`](bench-stick-2026-09-29.md) and
[`bench-mac-2026-09-29.md`](bench-mac-2026-09-29.md). How a bench run works with Tony: the
[`bench-session` skill](../.claude/skills/bench-session/SKILL.md). Each step names its FOLLOWUPS row; the row
holds the history and the fix. This sheet needs no Stick: the pickup source is the black Pixel as a phone
powerup station.

**Time:** about 2 h 40 min for the core (setup and steps 1-9), plus about 70 min of lower-priority steps (10-14).

## Kit

- Two guns with their headsets: Tactix-FE30 (grey Pixel, player 1) and Tactix-9498 (green Pixel, player 2).
- Three Pixel 5s: grey and green as players, black as the phone powerup station. Phones ride on the rail.
- This box: WSL for MC and the tools, Windows Python for anything that touches a gun
  (`/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe`, [`wsl-dev-runbook.md`](wsl-dev-runbook.md)).
- A tape measure and a stopwatch.

## Method (it worked on 2026-09-28; keep it)

- **Drive MC through its API**, not by clicking: every non-GET `/api/*` call takes
  `Authorization: Bearer <token>` (the token is in MC's boot banner; `mcp/brx_mcp/mc/API.md`).
- **Read each phone's log over CDP**, not from screenshots: from WSL,
  `/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe mcp/tools/webview_eval.py "window.brx.log.slice(-40)" --serial <ip:port>`.
  Read it after each step, before the next one starts.
- **Time cold connects through adb** with `mcp/tools/coldconn.sh` (step 1).
- **Read a gun's pools with `$LIFE,0,0,0`** (a read probe; `$QUERY` returns the maxima). The laptop MCP can
  reach a gun only while no phone holds it: force-stop that phone's app first.
- Bench audio: `$VOL,65` (`--bench-volume` on MC). Never end on a bare `$CLEAR`; power-cycle any gun the laptop
  armed.

## Setup (about 20 min)

1. Tony turns on wireless debugging on the three Pixels and reads out each `ip:port`. Then run
   `adb connect <ip:port>` for each one.
2. Install the unpublished, release-signed 0.4.16 APK on all three (built from `release/app-0.4.16` at `6a435152`,
   not on `main`): `adb -s <ip:port> install -r /home/tony/apk-0.4.16/brx-companion-0.4.16-android-release.apk`. Log each phone's version:
   `adb -s <ip:port> shell dumpsys package com.openbrx.companion | grep versionName`.
3. Start MC from the latest `main`, with no match ARMED or LIVE anywhere, detached from the agent shell (a harness
   kill takes MC with it):
   `cd mcp && setsid nohup ../.venv/bin/python -m brx_mcp.mc --bench-volume > ~/mc-$(date +%Y%m%d-%H%M).log 2>&1 &`.
   Powerups are on by default: pass no `--powerups`. Log the boot banner and the token.
4. Each player phone joins MC and runs SET MY GUN with its own gun. The black Pixel becomes the phone powerup
   station (utility mode). In ARMORY, set it to **Rockets, RESPAWN 0:30** (the per-station override, so a stack
   does not wait 120 s).
- **Log:** the three versions, MC's sha and banner, the station's id and item.

## Steps, in priority order

**1. F297, phone cold connects, 10 runs a phone (20 min).** Control first, the laptop (Windows Python; WSL has no
Bluetooth): `cd mcp && /mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe -m brx_mcp connect-metrics <Tactix-9498 address> --runs 3 --cold warm --hold-s 60`.
Part 2's laptop reference: 3/3, median 1.61 s and 1.91 s. Then both phones in parallel, each with its gun set:
`mcp/tools/coldconn.sh <grey ip:port> grey 10 60` and `mcp/tools/coldconn.sh <green ip:port> green 10 60`.
Tony watches both headsets for a drop during every 60 s hold. Close with the laptop control again.
**Pass (Tony, 2026-09-28):** 10/10 linked on each phone, median t_ready at most 3 s, worst at most 3.5 s, zero
headset drops. Log the first-attempt rate and every GATT 133, but do not gate on them. The fix under test is
`GATT133_GAP_MS` (a 200 ms retry). Part 2 read 6/10 first-attempt, medians 2.40 s and 2.69 s, worst 6.69 s. Row:
F297.

**2. F418, a held pickup survives the background (10 min).** Green claims Rockets at the phone station.
Control: hold it for 30 s with the app in front; slot 2 still reads 2. Then background the app to Android
Settings for at least 30 s and resume. **Pass:** after the re-arm, slot 2 reads 2 (phone log and `$ALCD`); fire
2 → 1 → 0, and the primary comes back after the last Rocket. The Rockets must not go to empty with no pull (part 2's
failure: `ROCKETS read 0 with no trigger pull` then `ROCKETS over (empty)`). Row: F418.

**3. F381, a stack to 4 and the swap delay (15 min).** Control: one grant reads 2 on `$ALCD` slot 2. Claim Rockets
again with 2 held (RESPAWN 0:30 brings it back). **Pass:** `$ALCD` slot 2 reads 4 at once; the player stays
spawned with no pool change; all four Rockets fire. After the last Rocket, no primary shot lands inside the swap
delay (`frames.swap_ms`, 850 ms fallback): Tony holds the trigger through the switch-back and hears a gap. At the
pickup, read slot 0's count and check it against a logged `0/…`. Row: F381.

**4. F436, the gun side: an equip, then a `$GLED` within 100 ms (10 min; one gun, the laptop MCP, no phone).**
Force-stop green's app. Arm Tactix-9498 from `compile.resolve()` (never a capture) with a pickup weapon's frames.
Send the equip frames the phone's grant sends (copy them from part 2's grant line or the engine's grant path), then read
the active slot from `$ALCD` token 3 on one trigger pull. A/B/A, five trials each: **A** equip alone; **B** equip,
then a `$GLED` within 100 ms (the armour-blink frame); **A** again. **Pass:** slot 2 fires in every B trial, as
in A. If B fires slot 0 even once, the gun-side race is proven: log the delay that did it. Power-cycle the gun
at the end. Row: F436.

**5. F436, a claim during an armour blink, on the phone (10 min).** Take a hit on armour so the phone logs a
readout armour blink, then claim within 1 s. Control: a claim with no blink near it fires Rockets (part 2's
23:04:35 grant). **Pass:** the trigger fires Rockets; or the phone logs
`gun fired slot 0 while ROCKETS was expected in slot 2`, re-sends the equip, and the next pull fires Rockets.
Three trials. Row: F436.

**6. F348, a Shields spawn starts at full shield, plus F416's poison and shield reads (20 min).** Follow
[`bench-plan.md`](bench-plan.md) → *Group 1*, item 6 (F348) and item 3 (the `$LIFE,0,0,0` reads, the Toxin
Rifle for the mid-poison read). Part 2 already confirmed the unspawned read (`$HP,0,0,0`). **Pass:** every spawn
and revive ends `+ shield pool 105` with the gun's read-back agreeing; one hit drains the shield before any HP
moves; the mid-poison and under-shield `$LIFE,0,0,0` reads move no pool. Rows: F348, F416.

**7. F394, ammo pips after ALT and after a reload (5 min).** Follow *Group 1*, item 7. Rows: F394.

**8. 4.0, the release loop on 0.4.16 (20 min).** Follow *Group 1*, item 8, on the grey and green Pixels (the iOS
half is in the Mac sheet). Row: the 4.0 step in `bench-2026-09-24.md`.

**9. GAMES 9, TEAMS on the new UI (5 min).** Follow [`bench-plan.md`](bench-plan.md) → *GAMES CHECK*, item 9.
Control: a 2-team game loads as red and blue. Row: F413's check (closed at the desk; bench-confirm only).

**10. F437, the go-live taunt plays whole at volume 80 (5 min).** MC with no `--bench-volume`, so the match plays at
80 (the venue value; ears at arm's length). Start a short match on both player phones. Control: the T-3 countdown
"3, 2, 1, GO" plays. **Pass:** at go-live each gun plays the klaxon, then the whole character line (for example
"no where to hide", not "no.."), on 3 of 3 starts. Log each phone's `write spawn + klaxon + spawn line (...)` line.
Row: F437.

STOP POINT: the core is done. Everything below is lower value per minute.

**11. KOTH, the phone hill, plus F420, F421, F424 and F415 (20 min).** Follow *Group 2*, game 1 and item 3, with
the black Pixel as the hill (release it from the powerup role first). Rows: F420, F421, F424.

**12. F400, the pickup switch card (10 min).** Follow *Group 4*, item 2. Row: F400.

**13. F419, the phone's own queue path (10 min).** Follow *Group 4*, item 3. Row: F419.

**14. 11.8, death first (15 min).** Follow *Group 4*, item 6. Rows: F158, F3, F21, F375.

**15. 11.4, the phone station's range edit (10 min).** Follow *Group 4*, item 1. Row: F365.

## Close

Follow the bench-session skill's close: a results table with each control, then a recorder writes the log entry,
the FOLLOWUPS diff and the HANDOFF lane, and strikes the steps that ran here.
