# Handoff: Open BRX
**State as of 2026-10-27.** This is the current truth; history is `git log -p -- docs/HANDOFF.md`.
Open MVP work is [`FOLLOWUPS.md`](FOLLOWUPS.md) (desk, bench, decision); ideas and the roadmap are [`post-mvp.md`](post-mvp.md);
what is done is [`archive/followups-closed.md`](archive/followups-closed.md). The bench order is [`bench-plan.md`](bench-plan.md).
What 1.0.0 ships is [`release-1.0.md`](release-1.0.md); the roadmap after it is [`post-launch.md`](post-launch.md).
Update only the lane you worked.
## State of main (2026-10-27)
**App 0.4.29 is the last published build** (`app-v0.4.29`, 2026-10-25). Publishing waits for Tony's own go. The next
bench is the Sunday AM sheet at the top of [`bench-plan.md`](bench-plan.md) (2026-11-01), then NEXT, "the bench after 0.4.30": every MVP BENCH row in rig order;
each step cites the sheet that holds its procedure. Reflash every Stick from main before a Stick step. The iPhone X
build (B21 iOS half) is Tony's MacBook step, `.claude/skills/iphone-build`. The 2026-10-17 field report
([`field-2026-10-17.md`](field-2026-10-17.md)) is closed at the desk; its evidence bundle is unscrubbed and stays off
the repo and off public issues. Tony's balance calls are in [`balance-decisions.md`](balance-decisions.md).
Every firmware fact from the drive is a disassembly reading until a bench proves it on v4.32; proven facts live in
[`protocol/brx-protocol.md`](../protocol/brx-protocol.md) and [`manual/dev.md`](manual/dev.md).

## Lane: brx1, orchestration
**State (2026-11-15):** the 2026-11-14/15 bench is recorded (log 2026-11-14/15, `bench-plan.md` *Start here*). The SR
sheet passed on 0.4.43 and 0.4.44 after the fixes it found: the revive P0, Easy Reload's 97 row, ALT bounce, the bind
on time, the Shotgun hold-to-chain and the heat HUD. The Stick strip hill passed H1 to H6 and PU. 0.4.44 (main
`0d8802917`) is on the three bench phones, local only. New rows: F671 to F675. The Stick strip's idle 8 % and
scoring band (Tony: "perfect") are on main (`3c8b06008`), and the bench Stick runs that build. `~/wt-heat` holds brx3's uncommitted
Energy Rifle heat numbers (F575 note).
**Next:** build the next APK from main (the phones lack `acb16124b` and `04147c037`). Then the re-bench in
`bench-plan.md` *Start here*: SR23 taps, SR22, SR5 part 3, SR13, P2 parts 2 and 5, H7.
**Blocked:** B21 on the MacBook; publishing waits for Tony's go.

## Lane: brx2, tooling, the test system, CI and the docs structure
**State (2026-11-02):** the balance review (`mcp/tools/balance_review.py`, skill `balance-review`) judges a change
on the scenario list in its `SCENARIO_VERSION`; Tony's decisions are in `docs/balance-decisions.md`. The 2026-11-01
bench and the evening game are recorded in [`bench-plan.md`](bench-plan.md) and the log; the game's issues are
F642 to F656. F643, F644 and F657 have desk fixes; F651's proposal waits on Tony. MC holds every laptop awake (F660). The HUD's melee-ready fist (F665) and Domination's row of hills (F666) are built.
The local gate splits Python into `mcp-core`, `mcp-docs` and `mcp-sim` (F626).
The gun model `app/src/gunmodel.js` replays the 2026-11-08 captures; `gun-model-phone.test.mjs` holds the engine to it, with SR17 and SR18 known red until brx5's swap fix lands. It now has the t14 floor and the rebind delay (F668 lists the rules to bench; SR20, SR21).
**Next:** F660 on the MacBook and a Windows-native start; then NEXT in `bench-plan.md`, and the balance review when
brx3's F575 heat fit asks for it. R4/T5 read-only research is authorised; flashing needs a decision first.
**Blocked:** nothing.
## Lane: brx3, releases and Mission Control
**State (2026-11-08):**
- **The Codex pass on compile and balance wiring (2026-11-07):** `935b8f213`. An R2 pull after the timer is crisp, the
  sim's burst rest runs from the release, and a kill on a burst's last round releases once. R2 stays off (Tony's call
  after the HE bench).
- **The Shotgun chain on the balance sheet:** `e1c0f937c` (wording only; no verdict moved).
- **The 2026-11-08 bench close:** recorded (log 2026-11-08). F647 and F645 are closed. The ALT lockout, ALT ignored
  while the trigger is held, the `$AMMO` write's answer and the refused melee swing are in `protocol/` and the manual.

**Next:** the next sitting starts from `bench-plan.md` → NEXT GAME PREP → *Start here*. Otherwise wait for brx1.
**Blocked:** none.

## Lane: brx4, the engine and the StickS3
**State (2026-11-14):** the swap-rule docs are landed (`ac0b6341b`, `173a8e598`). The Stick drives the SK6812 LED
strip on the Grove port: bench commands, a 300 mA cap and an LED team palette (bench-proven on G9), the role patterns,
and `STRIPPOWER EXT` (2000 mA, the strip on a U151 from the bank). stick.py has a build lock and a 30 min limit.
**Next:** whatever brx1 assigns. Bench: the role patterns on a live hill, the U151 wiring, a current reading.
**Blocked:** none.

## Lane: brx5, cross-language seams and the stage
**State (2026-10-27):** F574 (the mc-play vite proxy on IPv4), F512 (`mc-play` is a blocking CI gate), F624 (the
lander resolves an index-only FOLLOWUPS conflict) and F627 (CI's Python job split into `mcp`, `mcp-extras` and
`mcp-sim`, with `run_tests.py --group`) are landed. Now: the doc-rot apply lane for status, archive and privacy.
**Next:** whatever brx1 assigns. `fix/koth-dense-adverts` (`wt-dense`) is still held for its own labelled-APK A/B.
**Blocked:** none.
## Lane: brx-desk-reds, the red MVP desk rows (under brx1)
**State (2026-11-16):** the seven red rows are closed or on the bench (P5, P9, P16, P17). Batch A: F639 and F665
closed, F640 (2)(3) built and moved to bench P19.
**Next:** batch B, the Stick rows F671, F674 (2) and F675, built in an agent worktree; cherry-pick, review, land.
**Blocked:** none.

## Lane: brx-row-triage, the MVP BENCH rows (2026-11-16)
**State (2026-11-16):** every MVP BENCH row has a verdict (log 2026-11-16). Seven closed; 89 left, each in
`bench-plan.md` *Start here* in rig order.
**Next:** none; a new desk lane takes F453, F444 and F463 step 1. **Blocked:** none.

## Start here

1. **Next sitting:** the NEXT sheet in [`bench-plan.md`](bench-plan.md); record evidence and promote or close each row
   from the result.
2. **Desk:** B21's iOS compile on the MacBook (`.claude/skills/iphone-build`).
3. **Decisions for Tony:** the FOLLOWUPS MVP DECISION group.
4. **Only after MVP:** [`post-mvp.md`](post-mvp.md) is the roadmap; nothing there is scheduled.

If Tony is not at the bench, prepare the decision packet and read the exact FOLLOWUPS methods; do not invent a new
implementation for a bench-gated row.

## Machine state

MC is `mcp/` on 8765/8766 serving `webapp/mc/dist`; rebuild before starting and restart between matches
(`ss -ltn | grep 876`). Launch with `setsid nohup ../.venv/bin/python -m brx_mcp.mc --advertise <mc-lan-ip> --bench-volume 65`
(S58 powerups are on by default; add `--no-powerups` to turn them off). Shields recharge only on the Shields preset (armour 0). WSL runs Python/no-hardware MC,
Windows drives BLE, and the MacBook is the field target. Never modify stock firmware.
