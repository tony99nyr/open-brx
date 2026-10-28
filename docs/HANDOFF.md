# Handoff: Open BRX
**State as of 2026-10-27.** This is the current truth; history is `git log -p -- docs/HANDOFF.md`.
Open MVP work is [`FOLLOWUPS.md`](FOLLOWUPS.md) (desk, bench, decision); ideas and the roadmap are [`post-mvp.md`](post-mvp.md);
what is done is [`archive/followups-closed.md`](archive/followups-closed.md). The bench order is [`bench-plan.md`](bench-plan.md).
What 1.0.0 ships is [`release-1.0.md`](release-1.0.md); the roadmap after it is [`post-launch.md`](post-launch.md).
Update only the lane you worked.
## State of main (2026-10-27)
**App 0.4.29 is the last published build** (`app-v0.4.29`, 2026-10-25). Publishing waits for Tony's own go. The next
bench is the NEXT list in [`bench-plan.md`](bench-plan.md), "the bench after 0.4.31": every MVP BENCH row in rig order;
each step cites the sheet that holds its procedure. Reflash every Stick from main before a Stick step. The iPhone X
build (B21 iOS half) is Tony's MacBook step, `.claude/skills/iphone-build`. The 2026-10-17 field report
([`field-2026-10-17.md`](field-2026-10-17.md)) is closed at the desk; its evidence bundle is unscrubbed and stays off
the repo and off public issues. Tony's balance calls are in [`balance-decisions.md`](balance-decisions.md).
Every firmware fact from the drive is a disassembly reading until a bench proves it on v4.32; proven facts live in
[`protocol/brx-protocol.md`](../protocol/brx-protocol.md) and [`manual/dev.md`](manual/dev.md).

## Lane: brx1, orchestration
**State:** 2026-10-24: Stick U002 IR bench and the outdoor range walk done (log 2026-10-24). The Unit IR sends on G9 and
receives on G10. Its receiver hears a real BRX gun at 3 to 30 m (10/10 pulls each) and at 67 m (11/11). Box to headset IR
reaches only about 1.5 m outdoors; the indoor 3 m results were bounce. A ground box needs side-facing receivers. Melee
(t2 60) reached the U002 to about 7 m and the Shotgun headset word to about 10 m, but that receiver is not a headset, so
the victim cutoffs are F580. A MacBook serial open restarts the Stick, so AUTO needs an open sercmd session. The field push
plan is in `~/reviews-2026-10-17/` (outside the repo).
**Next:** F580 (victim-side melee and Shotgun cutoffs) and the Stick-to-Stick IR range. Then the next APK cut on Tony's go.
**Blocked:** B21 on the MacBook; publishing waits for Tony's go. Power-cycle the gun after a CLI `deathmatch` run: the
Windows venv runs a main checkout without 575e58f0a (`end_hittable`), so the run still ends on a bare `$CLEAR`.

## Lane: brx2, tooling, the test system, CI and the docs structure
**State (2026-10-27):** the balance review (`mcp/tools/balance_review.py`, skill `balance-review`) judges a change
on the scenario list in its `SCENARIO_VERSION`. Tony's decisions are in `docs/balance-decisions.md`. F578: the
marksman rush counter becomes a flip test against the shipped baseline (Tony, "Relative"). The change is on its way
to main with the 0.4.31 AMR verdict. The local gate splits Python into `mcp-core`, `mcp-docs` and `mcp-sim` (F626).
The root, tooling and hardware doc-rot pass is landed. CLAUDE.md and the skill edits wait for Tony.
**Next:** the bench after 0.4.31 is the NEXT list in [`bench-plan.md`](bench-plan.md). The 0.4.30 release notes
stay on their own unmerged branch until brx1 cuts. R4/T5 read-only research is authorised; flashing needs
a decision first.
**Blocked:** F575 on the CR heat-while-firing bench row, then Tony.
## Lane: brx3, releases and Mission Control
**State (2026-10-27):** everything is landed or in the land queue:
- **Balance 0.4.31:** `11107dbdf`.
- **A83 and its gaps:** `a0eb2fe47` and `91bc983af`.
- **F631 and F630:** `0ce0f4d70`. Both are closed on brx4's end-to-end runs.
- **F633:** `3b2e20b2d`.
- **Cloudflared:** `4021de4a5`.
- **The NEXT bench sheet.**
- **F634, both halves (A84):** MC names the held match on every assign, and the phone keeps its results only for
  the match it ended.

The doc-rot pass (spec and protocol lane) is in the land queue: the design briefs, API.md, the protocol references,
and contracts.md folded into its body with §10 compacted to one line per older row.
**Next:** none open in this lane. Wait for brx1.
**Blocked:** none.

## Lane: brx4, the engine and the StickS3
**State (2026-10-28):** F635 is landed (`29f238707`): the post-match end-to-end gate is the `--ui` job `app-postmatch`.
F598 is landed. The doc-rot apply has landed (`e914148f1`, `587d7086d`, `2d5f66bf3`, `b998a70e5`). The review fixes are on
`fix/docrot-review`, to land after the gate. The firmware safety guards are on `brx4-fwguards`. Nothing was flashed.
**Next:** land `fix/docrot-review`. Bench: the code-read leads on F264, F277, F293 and F300; the older list (F519, F521, F525,
F526, F511, F501, F530) still stands.
**Blocked:** none.

## Lane: brx5, cross-language seams and the stage
**State (2026-10-27):** F574 (the mc-play vite proxy on IPv4), F512 (`mc-play` is a blocking CI gate), F624 (the
lander resolves an index-only FOLLOWUPS conflict) and F627 (CI's Python job split into `mcp`, `mcp-extras` and
`mcp-sim`, with `run_tests.py --group`) are landed. Now: the doc-rot apply lane for status, archive and privacy.
**Next:** whatever brx1 assigns. `fix/koth-dense-adverts` (`wt-dense`) is still held for its own labelled-APK A/B.
**Blocked:** none.
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
