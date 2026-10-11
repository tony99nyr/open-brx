# Handoff: Open BRX, state on the eve of the 0.4.20 re-bench
**State as of 2026-10-05.** This is the current truth; history is `git log -p -- docs/HANDOFF.md`.
Open MVP work is [`FOLLOWUPS.md`](FOLLOWUPS.md) (desk, bench, decision); ideas and the roadmap are [`post-mvp.md`](post-mvp.md);
what is done is [`archive/followups-closed.md`](archive/followups-closed.md). The bench order is [`bench-plan.md`](bench-plan.md).
What 1.0.0 ships is [`release-1.0.md`](release-1.0.md); the roadmap after it is [`post-launch.md`](post-launch.md).
Update only the lane you worked.
## State of main (2026-10-05)
**App 0.4.15 is the last published build** (`app-v0.4.15`; `app/package.json` on main reads 0.4.15). 0.4.16-0.4.18 were
built on release branches and not published; the 0.4.18 re-bench never ran. **The bench build is 0.4.20, built, not published**,
from `release/app-0.4.20` (`cea5a9d7` = main `9ab8b345` plus the bump and notes; APK `/home/tony/apk-0.4.20`, release
key, sha256 `d1a5e308…6324e03c22c56dd4d7932b516c26406fc1fb84`). It carries F495, F478-F480 and `58c4d829` (late-start
quirks, F496/F497); 0.4.19 (`c7f08cf0`) is superseded. The bench is [`bench-rebench-0419.md`](bench-rebench-0419.md)
(now the 0.4.20 sheet). The MVP desk list holds only F498.
The Stick firmware on the bench predates `a317bb37`: reflash it from main. The iPhone X build (B21 iOS half) is Tony's
MacBook step, `.claude/skills/iphone-build`.
Every firmware fact from the drive is a disassembly reading until a bench proves it on v4.32; proven facts live in
[`protocol/brx-protocol.md`](../protocol/brx-protocol.md) and [`manual/dev.md`](manual/dev.md).
## Lane: brx1, orchestration
**State:** 2026-10-05: the 0.4.19 cross-lane review, its fixes and every desk row landed; 0.4.19 built (not published).
Tony picked F464 option 1. Lane rules this session: check `pids.current` before a `--ui` run, a load loop or an agent
fan-out (WSL cap 4,915); new mcp tests use A19's shared helpers.
**Next:** the 0.4.19 bench. Open question to Tony: rebuild as 0.4.20 from main first, to carry `58c4d829`.
**Blocked:** the phones (re-pair adb); B21 on the MacBook; publishing waits for Tony's go.
## Lane: brx2, tooling, the test system, CI and the docs structure
**State:** 2026-10-11, the improvement push: everything landed and CI is green. The lander gates on one `results.json`
rule, refuses Claude attribution and bad flags, and regenerates the FOLLOWUPS index itself (rows-only branches).
`scripts/lib/jobs.mjs` is the one job registry: a changed job shows as a diff of `mcp/tests/fixtures/test_all_jobs.json`;
regenerate it with `node scripts/test/jobs-snapshot.mjs mcp/tests/fixtures/test_all_jobs.json`. A change to `jobs.mjs`
runs the full `--ui` gate.
**Next:** post-push, from the push's tooling review (outside the repo): the admission scheduler (#3), then the
`test-all.mjs` and `land.mjs` splits; F523 (the e2e port race). R4/T5 read-only research is authorised; flashing stays
decision first.
**Blocked:** nothing.
## Lane: brx3, releases and Mission Control
**State as of 2026-10-11.** The improvement push is closed for this lane; nothing is queued or gating.
- **Landed in the push** (fix log with every commit: `~/reviews-2026-10-10/mc.md`; summary: the 2026-10 log entry):
  robustness (one MC per home, orderly stop, F513 holes and their grace), the armory data-loss fix (`a7981b84`), the
  route split, the Scorer, game-pick and ledger modules, declared compiler and armory capabilities, and the console's
  `src/rules/` and `useResource`.
- **Next, after the push** (design notes in `~/reviews-2026-10-10/mc.md`, "Design notes for after the push"):
  candidate 2 slice 2 (the station registry: 10 host members pass directly, 21 wait for candidate 1), then candidate 1
  (a match-in-play module), with candidate 2 slice 3 (the snapshot codec) folded into it. Each gets a design review.
  Also deferred: splitting Games.tsx and Kit.tsx by concern, and building the mock from recorded snapshots.
- **Bench rows, owner brx3:** see [`FOLLOWUPS.md`](FOLLOWUPS.md) (bench).

## Lane: brx4, the engine and the StickS3
**State (2026-10-11, end of the improvement push):** the desk list is empty and nothing of brx4's is gating. Landed:
the DRY pass and Lows A to C, TraceGun matching FakeTagger (`de286be5`), the outbox renumber fix (`aaae7f27`), the
Stick ButtonController (`5c51eed7`) and TickController (`0b8dc2ea`), and the hill listener in `hill.js` (`b4804541`).
Nothing was flashed.
**Next (bench, run first):** F519 and F521 together on one Stick flash; F518 (does a `$QUERY` `$LCD` carry the live
shield?); F511 (a phone restart around a RECALL) and F501 (a reconnect into a new match). Post-push desk: F522
(traces age a dropped station like a phone), F520 (the Stick sim's own button policy), F517 (stage id bound).
**Blocked:** none.
## Lane: brx5, cross-language seams and the stage
**State:** 2026-10-11, the seams push is landed (log 2026-10-11). This covers one schema for every case file, one envelope rule,
one gun model, and the contract alias layer gone in all three languages. The engine tunables come from `types.py`, with one
generated-file registry and a stage capability manifest. The bench CLI arms MC's compiled head.
**Next:** F522. Both golden-trace runners age a dropped station as beacon.js `Presence` does (opt-in `setup.stations_age`, with brx4),
and `stations_keep` then retires. `fix/koth-dense-adverts` (`wt-dense`) is still held for its A/B after the F342 baseline.
**Blocked:** none.
## Start here

1. **Next sitting:** [`bench-rebench-2026-10-04.md`](bench-rebench-2026-10-04.md) on 0.4.18; record evidence and
   promote or close each row from the result. Then the Stick and Mac sheets in [`bench-plan.md`](bench-plan.md).
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
