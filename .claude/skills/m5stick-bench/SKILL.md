---
name: m5stick-bench
description: How to run a live hardware bench session on the M5StickS3 station node. Use whenever the session works the M5Stick/StickS3 station bench, flashes the Stick, or Tony says he has the Stick (and maybe a gun) in hand. Trigger phrases: M5Stick, StickS3, station bench, flash the Stick.
---

# M5Stick bench

The working method for a live bench session on the M5StickS3 station node (`hardware/m5sticks3/`),
built the same way as `bench-session` (guns). Keep to it.

## Roles

- **The agent drives `hardware/m5sticks3/tools/stick.py`.** It stages, compiles, flashes, sends
  serial commands, and runs RAW/BLE captures through the CLI. It does not write ad-hoc scripts for
  a step, and it does not touch the firmware (`.ino`/`.h`) mid-session: a firmware change means
  stopping to edit, then `stick.py flash` again.
- **Tony handles the hardware.** He holds the Stick and any gun, aims, powers the grenade, presses
  the side button for download mode, and reports what the screen shows (the wire cannot see it).
- **Recording and desk work go to subagents.** The foreground stays on the bench.

## Talking to Tony

- One short action per message. "Fire once at the Stick's receiver. Type 1." Not a paragraph.
- **"1" means done.** For yes/no, give "1 = yes, 2 = no". "Play again" or "a" repeats the last step.
- Do not block the turn with a wait loop. Give the instruction, stop, and read the output in one
  snapshot when he types 1.
- Before anything that risks bricking the Stick (a factory-firmware recovery, an untested MODE), say
  so and let Tony decide.

## The fast loop

For most steps: `stick.py flash` (only after a firmware edit) -> `stick.py cmd <secs> <commands>` ->
`stick.py raw <secs>` (when a decode question is open) -> `stick.py ble <secs>` (to check the advert).
`stick.py status` is the cheap first move whenever the Stick's state is in doubt. `stick.py ports`
never needs the Stick plugged in and is always safe to run first, to confirm which COM port is which.

## Controls first

Tony's rule from the gun bench applies here too: no bad data, nothing flaky.

1. **The IR rig receiver is the witness.** For anything about what the Stick transmits, aim it at
   the rig's receiver (`native_capture.py` or `stick.py raw`, whichever side is under test), not at
   a gun's less legible RAW dump.
2. **Fix the mount and measure the distance.** A range or decode claim without a fixed jig and a
   noted distance is not a result; write the distance down with the finding.
3. **A/B/A.** Change one thing, observe, restore it, observe again. A confounded run gets redone
   clean, not silently kept.
4. **A silence needs a control too.** No `SHOT` line on the Stick could mean "the gun said nothing"
   or "the receiver missed it": fire a control shot at the rig receiver in the same position to
   tell which.

## Gates and the sheet

The gate list and its running results live in `docs/bench-sticks3-2026-09-23.md` (a later session may
have renamed or superseded it: check `docs/HANDOFF.md`'s station lane first). Work the gates in
order; do not skip one because a later one looks more interesting. `hardware/m5sticks3/README.md`
"First bench gate" is the reference recipe if the sheet is stale.

## Known pitfalls

- **Let `stick.py` find the port.** It picks the Stick by vendor id 0x303a. An explicit `--port` must also be a Stick, or it refuses; never point it at a rig board or a gun's port.
- **EXT_5V is off by default.** The receiver and onboard LED are dead until the firmware calls
  `M5.Power.setExtOutput(true, ...)`; a Stick with no IR activity at all is often just this, not a
  wiring fault.
- **Download mode** (first flash from factory firmware only) needs the small side button held while
  plugging in USB, then a replug without it. A later flash over running firmware does not need it.
- **Charge-only USB-C cables drop the Stick from the port list while its screen stays lit.** If
  `stick.py ports` shows no `0x303a` device, try the cable before anything else.
- **DTR/RTS reset the S3 on open.** `sercmd.py` (and everything `stick.py` delegates to) already
  opens with both low; do not "fix" a perceived reset by adding a delay only, check the DTR/RTS
  lines first.
- **Read counts (`s`, `STATUS`) in the same serial session that captured them.** Closing and
  reopening the port does not always preserve what the firmware remembers between commands issued in
  one bench narrative; a count read cold is a different measurement, not a re-check.
- **The RAW-split artefact is a known rig behaviour, not a Stick bug.** A burst printed as several
  short `RAW` lines instead of one long one is the receiver firmware fragmenting on a mid-frame gap
  (the same F12 behaviour documented for the DevKitC rig); `rawscan.py`'s CANDIDATE line is a
  diagnostic read of that fragment, never a decoder result to act on alone.
- **Never flash a BRX gun or headset with this tool.** `stick.py` and its FQBN target the StickS3
  only. The hard rule from the repo's `CLAUDE.md` still applies: stock BRX firmware is never
  modified; all gun control stays on the Bluetooth serial protocol.

## Closing the session

1. Tell Tony the results in a short table, each with its control.
2. Give the full results to a recorder agent (in a worktree, not this one, unless this session owns
   the worktree). It writes one experiment-log entry (`docs/experiment-log/`), one FOLLOWUPS diff
   (strike or add rows, no prose), and the HANDOFF update (its own lane section only, never another
   lane's, never stacked on top of the last one).
3. Mark each claim on the bench sheet CONFIRMED, REFUTED or INCONCLUSIVE.
