---
name: bench-session
description: How to run a live hardware bench session with Tony on the BRX taggers. The agent drives the brx MCP tools and the ESP32 IR rig; Tony handles the guns and types "1" when a step is done. Use this skill whenever a session starts a bench run, works through a bench sheet (docs/bench-*.md, docs/bench-plan.md), or Tony says he is at the bench, has guns in hand, or has time for tests.
---

# Bench session

This is the working method from the 2026-09-18 firmware levers bench. Tony said it worked well. Keep to it.

## Roles

- **The agent drives the wire.** It sends every frame with the brx MCP tools (`mcp__brx__send`, `send_batch`,
  `get_events`) and fires the ESP32 IR rig with the `ir-emit` CLI. It does not write ad-hoc scripts for a step.
- **Tony handles the hardware.** He holds the guns, pulls the trigger and the reload lever, aims the rig and power-cycles.
  He also reports what he hears and sees. His ears and eyes are primary evidence, because the wire cannot see LEDs or
  sounds.
- **Recording and desk work go to subagents.** The foreground stays on the bench. Build work that needs no gun runs in
  a background worktree agent. A recorder agent does the log, FOLLOWUPS and HANDOFF writes at the end.

## Talking to Tony

- One short action per message. "Fire 3, reload once. Type 1." Not a paragraph.
- **"1" means done.** For a yes/no question, give "1 = yes, 2 = no". "Play again" or "a" means repeat the last step
  exactly.
- In chat, name guns by their sticker labels, which Tony uses. In the repo, use `Tactix-XXXX` only (`docs/gotchas.md`).
- Use one gun when you can. The IR rig is the shooter, so Tony does not have to swap guns. Tell him to keep his hands
  off the trigger when the rig does the shooting.
- Do not block the turn with a wait loop. Give the instruction, stop, and read the events in one snapshot when he types 1.
- Before anything risky (a factory menu, a hang-prone frame), read the manual page first. Then explain the risk and let
  Tony decide. Cancel it if the manual shows it cannot answer the question.

## Every result needs a control

Tony's words: "im not convinced you are being scientific about these findings. you are assuming a little too much."
"we dont want bad data at the bench". "flaky is no good".

1. **Run the control first.** Prove that the setup works before you change anything. Example: one rig hit does 9
   damage before any `$TMP` write.
2. **Change one thing.** One token, one frame.
3. **Restore it and check again (A/B/A).** Example: reload 1.78 s at `$TMP` t6 = 0, 2.76 s at t6 = 50, 1.80 s at t6 = 0.
4. **Look for a leftover state.** On 2026-09-18, three hits with no damage looked like proof of spawn protection. The
   "off" step still showed no damage, which exposed a `$STOP` that had survived the `$SPAWN`. Only the restore step
   caught it.
5. **Silence needs a control too.** If Tony hears a sound, send the same frame with the sound removed and ask again.
6. **A confounded run is not the record.** Say so plainly ("that run is confounded"), find the cause, and redo it
   cleanly. Keep the confounded run in the log, marked as confounded.
7. **Read the wire, not the proxy.** Confirm a pool with `$LIFE,*`, not with an absent frame.

## Arming and safety

- Run the pre-flight in `docs/gotchas.md` → *Before a bench session* first.
- Arm from the bench sheet's recipe (for example "Roles and arming" in `docs/bench-firmware-levers-2026-09-19.md`) or
  from `compile.resolve()`. The CLI commands `startgame`, `deathmatch`, `arena` and `fieldstart` also arm MC's compiled
  head. Never arm from a capture.
- Poll a gun that may be dead with `$LIFE,*`, not `$QUERY`.
- `$TMP` frames carry all 12 commas.
- Never end on a bare `$CLEAR` (`CLAUDE.md` hard rules, F11). Power-cycle the gun at the end, and disconnect the MCP
  session.

## Volume and MC

This skill owns these two bench rules. Other bench docs point here.

- **Bench volume is `$VOL,65`.** At the bench, 30 and 55 are barely audible. The measured levels are in
  `docs/manual/sound.md` → *Volume*: at 30 no weapon sound rises above room noise, and 45 is barely audible.
  - Start MC with `--bench-volume` and no value (65), so match heads and try-outs play at 65. With no flag, MC uses
    the venue volume (80 or 90). A restart forgets the flag: pass it again.
  - The CLI arm commands default to 30 (`startgame`, the TDM path) or 69 (`deathmatch`, `arena`, `fieldstart`).
    Pass 65 as their volume argument.
  - Use 30 only for protocol probing, where nobody needs to hear the gun.
  - Raise the volume only when Tony asks.
- **Restart MC only after END.** Never restart MC with a match ARMED or LIVE, and tell Tony first. After any MC or
  Stick restart, re-point the Stick (`stick.py cmd 10 "MC ws://<laptop>:8766/ws"`, F397).

## Closing the session

1. Tell Tony the results in a short table, each with its control.
2. Mark each claim in the bench sheet: CONFIRMED, REFUTED or INCONCLUSIVE.
3. Give the full results to a recorder agent in a worktree. It does the session close in `docs/README.md` → *Session close is three writes*, promotes confirmed facts into `docs/manual/` and `protocol/brx-protocol.md`, runs the docs
   hygiene test, and submits through the land lane (`CLAUDE.md` → *Reaching main*).
4. Update `docs/bench-plan.md`, so the next bench session starts from the steps that are still open.
