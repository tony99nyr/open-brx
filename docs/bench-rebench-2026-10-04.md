# Bench sheet: the re-bench on APK 0.4.18, 2026-10-04

Updated: 2026-10-05. **Replaced:** [`bench-rebench-0419.md`](bench-rebench-0419.md), the sheet for APK 0.4.19, replaces this
one once 0.4.19 exists; it carries every step below. This sheet never ran. It re-runs every fix that landed after the 2026-10-02 standard bench (app 0.4.16). It
stands alone: kit, setup, steps in priority order, each with a control, a pass rule and its FOLLOWUPS row. The row
holds the history and the fix; this sheet holds the procedure. How a bench run works with Tony: the
[`bench-session` skill](../.claude/skills/bench-session/SKILL.md). The index is [`bench-plan.md`](bench-plan.md).

**Time:** about 3 h 25 min for the core (setup and steps 1-9), plus about 80 min below the STOP POINT.

## Kit

- Two guns with their headsets: Tactix-FE30 (player 1, red) and Tactix-9498 (player 2, blue).
- Three Pixel 5s, in the 2026-10-02 roles: the black Pixel is player 1, the green Pixel player 2, and the grey Pixel
  the phone station (the powerup station, then the KOTH hill), on its charger. Phones ride on the rail.
- This box: WSL for MC and the tools, Windows Python for anything that touches a gun
  (`/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe`, [`wsl-dev-runbook.md`](wsl-dev-runbook.md)).
- A tape measure (the hill ladder needs 12 m), a stopwatch, and a wall for the self-hit step.
- No Stick and no MacBook: those are [`bench-stick-2026-09-29.md`](bench-stick-2026-09-29.md) and
  [`bench-mac-2026-09-29.md`](bench-mac-2026-09-29.md).

## Method (it worked on 2026-10-02; keep it)

- **Drive MC through its API**, not by clicking, except where a step tests the console itself. Every non-GET
  `/api/*` call takes `Authorization: Bearer <token>` (the token is in MC's boot banner; `mcp/brx_mcp/mc/API.md`).
- **Read each phone's log over CDP** after each step, before the next one starts:
  `/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe mcp/tools/webview_eval.py "window.brx.log.slice(-40)" --serial <ip:port>`.
- **Read a gun's pools with `$LIFE,0,0,0`** (a read probe). The laptop MCP reaches a gun only while no phone
  holds it: force-stop that phone's app first. Arm a laptop-held gun from `compile.resolve()`, never from a capture.
- **Volume:** MC runs with `--bench-volume` (65), except step 8, which plays at the venue value. Tony raised the
  guns to `$VOL,80` on 2026-10-02 because 65 was too quiet; say which level each audio step used.
- Never end on a bare `$CLEAR`. Power-cycle any gun the laptop armed. Never restart MC while a match is ARMED or
  LIVE.

## Setup (about 25 min)

1. **Re-pair adb.** The phones were off overnight, so the old `ip:port` pairs are gone. On each Pixel: Developer
   options → Wireless debugging → *Pair device with pairing code*. Tony reads out the pairing `ip:port` and code;
   run `adb pair <ip>:<pairing port> <code>`. Then Tony reads the connect `ip:port` from the Wireless debugging
   screen; run `adb connect <ip:port>`. Check with `adb devices`: three phones, each `device`.
2. **Install 0.4.18 on all three:**
   `adb -s <ip:port> install -r /home/tony/apk-0.4.18/brx-companion-0.4.18-android-release.apk`. The same
   release key installs over 0.4.16 with no uninstall. Log each phone's version:
   `adb -s <ip:port> shell dumpsys package com.openbrx.companion | grep versionName`. Log the APK's sha from
   `/home/tony/apk-0.4.18/build.json`; it must be at or after the land of F442, F444 and F448 (brx1 confirms).
3. **Start MC from the latest `main`**, with no match ARMED or LIVE anywhere, detached from the agent shell:
   `cd mcp && setsid nohup ../.venv/bin/python -m brx_mcp.mc --advertise 192.168.0.55 --bench-volume > ~/mc-$(date +%Y%m%d-%H%M).log 2>&1 &`.
   Rebuild `webapp/mc/dist` first if it is older than main. Powerups are on by default. Log the boot banner, the
   token and MC's sha.
4. Each player phone joins MC and runs SET MY GUN with its own gun. The station Pixel becomes the phone powerup
   station: in ARMORY, **Rockets, RESPAWN 0:30**.
- **Log:** the three versions, the APK sha, MC's sha and banner, the station's id and item.

## Steps, in priority order

**1. F416, a lost spawn write at go-live (P0; 25 min).** The fix: positive pools no longer close the spawn check;
it closes only when the gun's `$LCD` slot and magazine match the node's own trigger slot and live count.
- **1a, the gun side (one gun, the laptop MCP, no phone).** Force-stop player 2's app. Power-cycle Tactix-9498, send
  the head (kit) frames and no `$SPAWN`. Read `$QUERY`'s `$LCD` and time its body. Then send `$SPAWN` 50 ms after the
  read and confirm it lands. **Control:** a spawned gun reads `$LCD,45,0,105,0,52,360`-shaped (slot 0, full mag).
  **Pass:** the unspawned gun's `$LCD` shows a slot or magazine that does not match a live slot 0, and the late
  `$SPAWN` lands. Power-cycle the gun at the end.
- **1b, the phone side.** Three go-lives with player 2's phone about 10 m from its gun (the distance that gave the
  2026-09-26 write error), then three with the phone beside it. Over CDP, call `window.brx.link.relink()` about 1 s
  before go-live on two of the starts, to force a drop mid-burst. **Pass:** every start ends with a live trigger
  and reload (one shot, one reload). Any start that logs a `write err` must also log the spawn check's re-send and
  a closing `$LCD` match. A start with no `write err` does not test the fix: say so in the log. **Fail:** any life
  with a dead trigger, or an undying player (a 0 pool must still book a death).
Row: F416.

**2. F438, your own shot never hurts you, and the team-damage check (15 min).** Indoors, a TDM match, standard
health. The victim stands 1-2 m from a wall and fires the sniper at it, 5 shots. **Control first:** the other
player hits the victim once, and the pools move. **Pass:** no damage to self on any of the 5 shots. Any self `$HIR`
that arrives logs `self-hit: own shot (...) took ..., restored` or `self-hit: own shot was lethal, revived at ...`,
and the HUD, MC's feed and the recap show no hit or death. A `... no revive (...): booked as a down by nobody` line
is a fail: log its reason. Then the firmware A/B: the same 5 wall shots in an FFA match (friendly fire on) and in
TDM (off). Log every `$HIR` with its shooter id and team (tokens 3 and 4), and whether the gun applied it. Then
Q13's check 1 in the same TDM: a teammate's shot does no damage. Rows: F438, Q13.

**3. F439, 11.8 in full: death first (25 min).** Tony's rule: the death scream and the death stop are never cut,
and kill confirms, medals and alerts queue after it.
1. **Control.** A death on a quiet gun (no line playing). Pass: the native scream plays, and the node log shows no
   `$PLAYX` at the death.
2. **The scream is never cut.** B kills A while A's own kill confirm plays (A kills C, then B kills A within 1 s).
   Pass: A hears the scream in full; A's kill line, if cut, plays after the scream; no `$PLAYX` after the death
   until the respawn.
3. **The queue while dead.** While A is dead, let a lead change fire. Pass: it plays after the scream, not over it.
4. **Fast kills, standard health.** Bring the victim under 15 HP, then kill within about 1 s, three times, so the
   low-health alert is in flight at the death. Pass: the scream is heard 3 of 3, "Health critical" never plays
   after it, and no `$PLAYX` is written at the death.
5. **Fast kills, Shields.** The same three times on a Shields life, the shield broken first, so the shield-down
   heartbeat is in flight. Pass: as 4, and no heartbeat after the scream.
6. **F3.** Empty a full-auto magazine with the trigger held. Pass: the RELOAD prompt shows. If not, press Share
   log before closing the app.
7. **F21.** Look at both player Pixels' status bar and display corners on the HUD. Pass: nothing is hidden.
- **Log:** a pass or fail per sub-step, and any `death: stop N for a body cue queued behind the scream` lines with
  their times. Rows: F439 (F375 and F158 folded in), F3, F21.

**4. F436, a held heavy survives a resume (10 min).** Player 2 claims Rockets and holds them on the trigger.
**Control:** with the app in front, one pull fires a Rocket. Then leave the app for Android Settings for 30 s and
come back, and force the reconcile with `window.brx.link.relink()`. **Pass:** the first pull after the re-arm fires a
Rocket, and the log has no `gun fired slot 0 while ROCKETS was expected` line. Three trials. **Then the open
question:** hold the trigger on the last Rocket and keep holding through the empty switch-back's swap window. Does
the primary fire by itself when the window ends? Log any primary round and its delay. Row: F436.

**5. F447, no take at the stack cap (10 min).** Player 2 holds Rockets at the cap of 4 (two claims; RESPAWN 0:30
brings the item back). **Control:** under the cap, a claim takes the item (to 4). Then stand on the station for the
full dwell with 4 held. **Pass:** no take, no `TOOK` line in MC's feed, no HUD approach hint, and the station still
offers the item. Fire one Rocket: the same claim now takes it (back to 4). Camping stays allowed under the cap
(F435). Row: F447.

**6. KOTH: F440 fair presence on the phone hill (25 min).** Release the station Pixel from the powerup role and
assign it as the KOTH hill (default threshold). Read the hill's log (`player N (TEAM) IN THE CIRCLE` and `quiet`
lines) or `window.brx.diag()` over CDP, and each player's `advertising as player` lines.
1. Player 1 alone at the hill captures within 15 s. 3 runs.
2. Both players together, on different teams: CONTESTED at once (within about 1 s of the second arriving), and the
   hill's ticks stop. 3 runs, then swap the two phones' teams and 3 more.
3. Record each run's gap histogram for both phones from `diag()`.
**Control:** player 2 alone captures within 15 s (the 2026-10-02 fault followed the black Pixel). Row: F440.

**7. KOTH: F444 the capture-begins alert, then F448 and the hill across matches (25 min; same setup).**
- **F444.** One player walks into the empty hill. **Pass:** both HUDs show the neutral HILL CAPTURE STARTED badge
  with the capturing team's colour (by day a block with the team token and initial; at night the initial in a red
  outline), at the moment capturing begins. Once that team HOLDS the hill, the other player walks in: the "Hill Contested"
  voice plays for the holding team only, once per contest. A DOWN player gets no hill badge; a hill voice line still queues after the
  scream. **Control:** a neutral hill (players in another room) shows no badge. Rows: F444.
- **The hill across matches.** End the match, then NEXT MATCH. **Pass:** the hill assignment is still there, and
  LOAD needs no reassignment (the 2026-10-02 open question; pinned on main at `c5840639`).
- **F448, RESTORE.** In RECAP, press BACK TO HUD on the hill phone. **Pass:** MC's KOTH LOAD refusal and the ITEMS
  panel name the hill that left (its label and why). When the same phone comes back as a utility node, its ITEMS
  card offers RESTORE; one tap restores the hill with its old id, and LOAD works. RESTORE never happens by itself.
  DISMISS clears the away line. Row: F448.

**8. F437, the go-live taunt plays whole at volume 80 (10 min).** Restart MC with no match ARMED and
`--bench-volume 80`, so the match plays at 80 (Tony's 2026-10-02 level; ears at arm's length). With no
`--bench-volume`, a GAMES match is outdoors and plays at 90. Start a short match on both
player phones, three times. **Control:** the "3, 2, 1, GO" countdown plays. **Pass:** at go-live each gun plays the
klaxon, then the whole character line (for example "no where to hide", not "no.."), 3 of 3 starts. Log each phone's
`write spawn + klaxon (one two-slot frame) + spawn line (...)` line; a line without `(one two-slot frame)` is a
fail. Keep MC at 80 for step 9. Row: F437.

**9. F446, the poison sounds (10 min; MC still at 80 from step 8).** A Toxin Rifle hit on a victim.
**Control:** an ordinary hit plays its normal hit sound. **Pass:** the hit plays H12 "Bubble Acid" once. Then H31 or
H32 bubbles play on each tick, with no voice and no cough, about 4 times, 1 s apart (the first tick may yield to H12
still playing). A second Toxin hit during the poison plays no second H12. Log whether a tick cut another clip (it
must not). Then F292's lethal tick: poison a victim at low HP so a tick kills. **Pass:** one death, booked once
on MC's feed, with the scream heard. Then restart MC with
`--bench-volume` (65) again, with no match ARMED. Rows: F446 (F393's check folded in), F292.

STOP POINT: the core is done. Everything below is lower value per minute.

**10. The hill ladder (20 min; sets the hill threshold once per station type).** The hill phone on its stand. Each
player phone, body between it and the hill, stands at 5, 7.5, 9 and 12 m, 3 times each, for 10 s at each mark.
**Pass:** IN at 5 and 7.5 m every time, OUT at 12 m every time, and 9 m recorded as the edge. If 7.5 m is not
reliably IN, lower the default threshold by the measured shortfall (`beacon.js`, `station_range.h`), never per
phone. Rows: F440, F383.

**11. F445, a USP reload just after an ALT swap (15 min).** A loadout with the USP-S as the secondary. Five trials
each, reading the `$ALCD` slot and magazine. **A:** reload the primary, press ALT mid-reload, then reload again 2 s
later. **B:** press ALT, then pull the reload within 300 ms. **Pass:** no `reload did NOT take (timeout)` line and
no stuck pips in either. A is expected to pass now (`67807025`); if B times out, log the wire: the cure is to settle
the reload on the swap's target slot. Row: F445.

**12. F443 and F365, the station's holds (10 min).** With the phone station MC-locked in play. **Control:** RANGE opens
only after the 5 s locked hold. **Pass:** MC LINK also needs the same 5 s hold. Then F365's unlocked half, with no match loaded: a tap and a knock
do nothing, a 1.5 s hold opens RANGE, and the edit reaches MC (EDITED ON STATION). Rows: F443, F365.

**13. F442, the ACTIVE pip shine for Rockets (5 min).** Hold Rockets on the trigger and fire one. **Control:** a
primary with 400 ms or more between rounds dims, then shines green once when the next round is due. **Pass:** the
Rockets' gauge does the same. Row: F442.

**14. NIGHT OPS from a LOBBY edit (5 min).** Use a phone whose player has not tapped the HUD skin switch in this MC
session. In LOBBY, set NIGHT on MC. **Control, before any push:** over CDP, `engine.game.night` is true. **Pass:**
`engine.config.night` turns true on both phones (pinned on main at `aab05a8e`), and START turns the HUD to the night
skin at ARMED. Row: bench 2026-10-02's night note.

**15. F379, the ALT pointer after a Rocket (5 min).** Player 2 presses ALT onto the secondary with no shot, takes
Rockets at the station, empties them, then presses ALT once. **Control:** an ALT with no pickup in the life lands on
the slot the phone expects. **Pass:** the gun's next `$ALCD` slot matches the phone's assumed target, and no stale
switch-back re-send follows. Row: F379.

**16. F464 part 3, dense KOTH adverts against gun writes (20 min; only with a build of `fix/koth-dense-adverts`).**
That branch makes every player phone advertise at lowLatency (about 10 adverts a second) during a live KOTH match.
It is held because the scan flood guard (`scanwatch.js` `SCAN_BUDGET_PER_S` = 25, F342) may trip, and a flooded scan
once starved gun GATT writes. Set up a KOTH match with the hill station and one gun, and every player phone available
(the kit has three Pixels and the iPhone; the target is 4-8, so log the count as a limit of the result).
**Control:** all phones on balanced advertising (main's build), 5 minutes: log the gun's write latency and any
dropped writes from the gun's phone log, and every flood-guard trip the HUD log names. **Then** the same 5 minutes
with every phone on lowLatency (the branch build, or the mode forced). **Pass:** no extra write drops, and write
latency within the balanced run's spread. Log both runs' numbers; they set the KOTH scan budget. Row: F464.

## Close

Follow the bench-session skill's close: a results table with each control, then the three writes (one log entry,
one FOLLOWUPS diff, the HANDOFF lane), and strike the steps that ran here and in [`bench-plan.md`](bench-plan.md).
