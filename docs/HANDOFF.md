# Handoff: Open BRX, state after the 48-hour improvement push
**State as of 2026-10-11.** This is the current truth; history is `git log -p -- docs/HANDOFF.md`.
Open MVP work is [`FOLLOWUPS.md`](FOLLOWUPS.md) (desk, bench, decision); ideas and the roadmap are [`post-mvp.md`](post-mvp.md);
what is done is [`archive/followups-closed.md`](archive/followups-closed.md). The bench order is [`bench-plan.md`](bench-plan.md).
What 1.0.0 ships is [`release-1.0.md`](release-1.0.md); the roadmap after it is [`post-launch.md`](post-launch.md).
Update only the lane you worked.
## State of main (2026-10-13)
**App 0.4.15 is the last published build** (`app-v0.4.15`). 0.4.16-0.4.21 were built on release branches and not
published. **0.4.22** (`/home/tony/apk-0.4.22`, from main `221d4fe1`, release commit `be55fbd7`) is the bench build, and the bench sheet is
[`bench-rebench-0422.md`](bench-rebench-0422.md). The push's reviews, triage and retro are in
`/home/tony/reviews-2026-10-10/` and `/home/tony/retro-2026-10-11.md` (outside the repo). The Stick firmware changed
(ButtonController, TickController, the advert checks): reflash every Stick from main before any Stick sheet. The iPhone X
build (B21 iOS half) is Tony's MacBook step, `.claude/skills/iphone-build`.
Every firmware fact from the drive is a disassembly reading until a bench proves it on v4.32; proven facts live in
[`protocol/brx-protocol.md`](../protocol/brx-protocol.md) and [`manual/dev.md`](manual/dev.md).
## Lane: field, the 2026-10-17 session (owned by brx1 since the evening of 2026-10-17)
**State:** the report [`field-2026-10-17.md`](field-2026-10-17.md) is on main, and every desk fix it asked for has
landed (the field push, 2026-10-17/18: about 60 lands across brx2-brx5, Claude + Codex reviewed, a milestone review
after). The evidence bundle is unscrubbed and stays off the repo and off public issues; ask Tony for it.
Tony's balance calls of the push are in [`weapon-design.md`](weapon-design.md) and, from now on, in
[`balance-decisions.md`](balance-decisions.md) through `.claude/skills/balance-review`.
**Next:** the bench sheet [`bench-field-1017.md`](bench-field-1017.md), P1 first (the large-reserve ceiling, the SMG
frame, the ALT swallow matrix); every phone-side fix needs the next APK first.
**Blocked on Tony:** F575 waits for the bench row "Charge Rifle heat while firing" first, then Tony (keep 70/16 or 73/14). F578 (phase B: the marksman rush test, the AMR fire rate, a Body Armor and Quick Switch direction). F572, F573 and F577 are decided and on main.

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
**State (2026-10-27):** everything is landed:
- **Balance 0.4.31:** `11107dbdf`.
- **A83, the 120 s bounded result wait:** `a0eb2fe47`. Its two gaps are `91bc983af`.
- **F631 and F630:** `0ce0f4d70`.
- **F633:** `3b2e20b2d`. A rejoin tells only itself, from a re-taken recap.
- **Cloudflared:** `4021de4a5`. The start script keeps it at Cloudflare's minimum.
- **NEXT bench sheet:** `fd0bd8adb` and `6d3d047dc`.

F631 and F630 are closed on brx4's end-to-end runs (all six cases pass on 2026-10-27).
**Next:** none open in this lane. Wait for brx1.
**Blocked:** none.

## Lane: brx4, the engine and the StickS3
**State (2026-10-26):** F598 is landed (the hill's last step counts presence as of the whistle; the clock ratchet
stays as it was). The firmware safety guards are on `brx4-fwguards`: `$ZTOG` and `$CLEARDEVICE` denied, every writer
refuses a `$WEAP` slot above 11 or a damage above 255, and the September firmware labels are corrected or marked
unproven. Nothing was flashed.
**Next (bench):** the code-read leads on F264, F277, F293 and F300. The older bench list (F519, F521, F525, F526,
F511, F501, F530) still stands.
**Blocked:** none.
## Lane: brx5, cross-language seams and the stage
**State:** 2026-10-13: everything is landed. That covers F522 and the F525 stage mirror (with brx4), brx3's reviews
(mock slices 1 to 6, F527 and the MC docs DRY pass), and the 0.4.22 bench sheet, which was walked against main and
reviewed in three rounds (log 2026-10-13).
**Next:** support Tony's 0.4.22 bench (`bench-rebench-0422.md`): fix any step that does not run as written. Trim the
sheet's MC-restart lines to a pointer once the bench-session skill's "Volume and MC" section is on main. Stay brx3's
second reviewer. `fix/koth-dense-adverts` (`wt-dense`) is still held for its own labelled-APK A/B.
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
(`ss -ltn | grep 876`). Launch with `setsid nohup ../.venv/bin/python -m brx_mcp.mc --advertise 192.168.0.55 --bench-volume`
(S58 powerups are on by default; add `--no-powerups` to turn them off). Shields recharge only on the Shields preset (armour 0). WSL runs Python/no-hardware MC,
Windows drives BLE, and the MacBook is the field target. Never modify stock firmware.
