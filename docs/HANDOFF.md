# Handoff: Open BRX, state on the eve of the 0.4.18 re-bench
**State as of 2026-10-03.** This is the current truth; history is `git log -p -- docs/HANDOFF.md`.
Open MVP work is [`FOLLOWUPS.md`](FOLLOWUPS.md) (desk, bench, decision); ideas and the roadmap are [`post-mvp.md`](post-mvp.md);
what is done is [`archive/followups-closed.md`](archive/followups-closed.md). The bench order is [`bench-plan.md`](bench-plan.md).
What 1.0.0 ships is [`release-1.0.md`](release-1.0.md); the roadmap after it is [`post-launch.md`](post-launch.md).
Update only the lane you worked.
## State of main (2026-10-03)
**App 0.4.15 is the last published build** (`app-v0.4.15`; `app/package.json` on main reads 0.4.15). 0.4.16 (the
2026-10-02 standard bench) and 0.4.17 were built on release branches and not published. **0.4.18 is cut from main
overnight**, after brx3 lands the station RESTORE (F448) and the hill alerts (F444, F442); the morning re-bench runs
it: [`bench-rebench-2026-10-04.md`](bench-rebench-2026-10-04.md). On main since 0.4.15: F416's weapon-state spawn
check, F436's reconcile re-equip, F437-F439, F440 fair presence (a 3 dB exit band), F441, F443, F446, F447, the hill
kept across END and NEXT MATCH, and NIGHT OPS from a LOBBY edit. The Stick firmware on the bench predates F434 and
F440: reflash it from main before any Stick sheet. The iPhone X build (B21 iOS half, uncompiled Swift) is Tony's
MacBook step, `.claude/skills/iphone-build`.
Every firmware fact from the drive is a disassembly reading until a bench proves it on v4.32; proven facts live in
[`protocol/brx-protocol.md`](../protocol/brx-protocol.md) and [`manual/dev.md`](manual/dev.md).
## Lane: brx1, orchestration
**State:** overnight 2026-10-03: brx3, brx4 and brx5 polish code; brx2 does the docs; brx1 cuts 0.4.18 from main
once F448 and F444 land, and installs nothing until the phones are back.
**Next:** the morning re-bench on 0.4.18 ([`bench-rebench-2026-10-04.md`](bench-rebench-2026-10-04.md)), then the
Stick and Mac sheets.
**Blocked:** the phones (off overnight); B21 on the MacBook.
## Lane: brx2, bench, audio, utility and docs
**State:** 2026-10-03 desk: FOLLOWUPS re-verified row by row against main (closes, post-MVP moves, a real MVP DESK
queue, F448 claimed), the re-bench sheet written, and the review's D1, D3, D6 and D7 fixed (a backticked-path guard
in `test_docs_hygiene.py`). The 2026-10-02 standard bench is in `experiment-log/2026-10.md`.
**Next:** record the re-bench; then the Stick and Mac sheets. R4/T5 read-only research is authorised; flashing stays
decision first.
**Blocked:** the re-bench on 0.4.18; F270 on A8; F274 on its three 2-hour soaks; F275 on outdoor space.
## Lane: brx3, releases and Mission Control
MC GAMES is PLAY + BUILD (F411) with FAVOURITES, LAST MATCH, teams (F413; a colour-only change recolours by index,
a count change re-splits) and the KOTH hold target (F415). `scripts/land.mjs` (the land lane) is how commits reach main.
- **F297 / F434 (2026-09-28):** a fast GATT 133 retries after 200 ms (`dec8065a`); the pass rule is now "linked
  within 3 s". The Stick powerup default is -45 dBm; reflash the Stick from main before bench 4.11. F435 closed:
  camping is fine.
- **F437 (2026-10-02):** the go-live klaxon (interrupt slot) cut the character taunt; the klaxon and the line now
  go as one two-slot frame (`$PLAY,U16,4,6,<line>,,,,*`).
  Bench: the re-bench sheet, step 8.
- **F438 (2026-10-02):** our own `$HIR` is a self-hit: the pools are given back, and a lethal one revives at once. Bench
  step 2 (and the FF A/B, a possible firmware finding).
- **F439 (2026-10-02):** the native death scream interrupts, so the phone sends no stop at death; body cues behind it
  are stopped after it ends. Bench step 3 (11.8 in full).
- **F446 (2026-10-02):** poison plays H12 "Bubble Acid" at the hit and H31/H32 bubbles per tick (Tony's pick). Bench
  step 9.
- **Next:** land `feat/station-departure-restore` (F448) and `hud-capture-begins-alert` (F444, F442) before the
  0.4.18 cut; both are pushed and need their gates.
- **Tools:** Codex returns 401 until `codex login`; Sonnet and Opus lanes in worktrees did the builds.
## Lane: brx4, the engine and the StickS3
**State:** architecture items landed: #6 golden traces (6839d50e: `app/test/fixtures/traces/`, engine + GunStage
runners), #5 the presentation gate (`Engine.show`, `state().presented`) and #1 the powerup module
(`app/src/powerup-player.js`, pure `burstWithHeld`), together in 60b98c71. A refactor of engine code proves "no
behaviour change" with the golden traces: never re-record with `--accept` to make one pass.
**Next:** bench: step 11's heavy case (F438), F450 (Stick reflash for A2), F398 from a recorded sha.
**Blocked:** none.
## Lane: brx5, powerups, the HUD and gun audio
**State:** overnight 2026-10-03 polish of F437-F439, F446, F434: a lethal toxin hit no longer cuts the scream with
H12, and a self-kill keeps the magazine (log 2026-10-03).
**Next:** D4/A8 for brx1, one cue table (`presentation.EVENTS`); then the bench steps on the F437-F439 rows.
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
