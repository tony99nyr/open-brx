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
plan is in `/home/tony/reviews-2026-10-17/` (outside the repo).
**Next:** F580 (victim-side melee and Shotgun cutoffs) and the Stick-to-Stick IR range. Then the next APK cut on Tony's go.
**Blocked:** B21 on the MacBook; publishing waits for Tony's go. Power-cycle the gun after a CLI `deathmatch` run: the
Windows venv runs a main checkout without 575e58f0a (`end_hittable`), so the run still ends on a bare `$CLEAR`.

## Lane: brx2, tooling, the test system, CI and the docs structure
**State:** 2026-10-24: the field push's tooling and balance work is landed (log 2026-10-18): F565, F571 and a pool
flake; single-shot weapons player-paced and retuned; reserves doubled under a proven-reserve ceiling; the
balance-review tool and skill (`mcp/tools/balance_review.py`, `.claude/skills/balance-review/SKILL.md`); FOLLOWUPS
bookkeeping from the report and the lanes' FIXED lines. The Sniper is a 75-damage bolt action with a 2.2 s bolt
(Tony's call, `docs/balance-decisions.md`); he judges it in the next real match. The balance sims now model heat,
the secondary slot, Armour Piercing, the Toxin Rifle, the Haze, melee and the field's pace (scenario version 2).
The review also gained rush from 20 and 30 m at every marksman, a KOTH hill hold column, an ammo stress column and
the pistol finisher (scenario version 8).
The Codex sim critique is folded in too: heat in the rule engines with three cooling branches (fail on a flip),
Shields regen, stricter pickup, domination, marksman and noise gates, and sensitivity sweeps (scenario 12; 13 since F579's field-pace duels; 14 since F581's bolt cycle).
Phase B (2026-10-24) is done: no one-field set passes; Tony's three calls are F578.
F576 (2026-10-24): compile publishes the field fight interval for single-shot weapons, from one constant the sims
import; Tony set the Shotgun's band floor to 0.85 s and tests "pistols weak" on the R10b duel. F579: the duel engine
runs at field pace too, with USP damage 10 and the Shotgun gun word 19 (Tony's calls, `docs/balance-decisions.md`).
**Next:** the 0.4.26 bench sheet [`bench-0426.md`](bench-0426.md) (2026-10-25): it carries the Shotgun headset reach,
the 2.2 s bolt and the CR heat-while-firing rows. F538's rig ack check stays in `~/reviews-2026-10-17/bench.md`. F512
again once F574 has a cause.
R4/T5 read-only research is authorised; flashing stays decision first.
**Blocked:** F575 on the CR heat-while-firing bench row, then Tony; F578 on Tony.
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

**Next:** none open in this lane. Wait for brx1.
**Blocked:** none.

## Lane: brx4, the engine and the StickS3
**State (2026-10-27):** F635 is done on `fix/f635-postmatch-e2e`, to land: the post-match end-to-end gate is the
`--ui` job `app-postmatch` (cases 2, 6, 3, 3b, 5 and 7, about 230 s). F598 is landed. The firmware safety guards are
on `brx4-fwguards`. Nothing was flashed.
**Next:** land `fix/f635-postmatch-e2e`. Bench: the code-read leads on F264, F277, F293 and F300; the older list (F519, F521, F525,
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
(`ss -ltn | grep 876`). Launch with `setsid nohup ../.venv/bin/python -m brx_mcp.mc --advertise <mc-lan-ip> --bench-volume`
(S58 powerups are on by default; add `--no-powerups` to turn them off). Shields recharge only on the Shields preset (armour 0). WSL runs Python/no-hardware MC,
Windows drives BLE, and the MacBook is the field target. Never modify stock firmware.
