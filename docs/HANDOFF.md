# Handoff: Open BRX, state on the morning of bench part 2
**State as of 2026-09-27.** This is the current truth; history is `git log -p -- docs/HANDOFF.md`.
Open MVP work is [`FOLLOWUPS.md`](FOLLOWUPS.md) (desk, bench, decision); ideas and the roadmap are [`post-mvp.md`](post-mvp.md);
what is done is [`archive/followups-closed.md`](archive/followups-closed.md). The bench order is [`bench-plan.md`](bench-plan.md).
What 1.0.0 ships is [`release-1.0.md`](release-1.0.md); the roadmap after it is [`post-launch.md`](post-launch.md).
Update only the lane you worked.
## State of main (2026-09-27)
**App 0.4.14 is published** (`app-v0.4.14`, release-signed, main 56fbece4) and installed on the three bench Pixel 5s.
It carries powerups on by default (F372), the go-live spawn check (F416), held pickups that survive a resume (F418,
F417 part 1), the switch card with paused lanes (F400), no pickup countdown (F425), F394, F420-F424 and mode art C.
Three polish rounds ran before the cut. **MC GAMES (F411) is on main** (c2c51679, review fixes 222b1a81), with PLAY,
BUILD, MATCH SETTINGS, FAVOURITES and the weapon-type toggles; F413 (teams) and F415 (per-mode items, the KOTH hold
target) are in progress (brx3). The Stick firmware is b79de96d + RANGE CLEAR (6f042126); the hill default is -75/6. The iPhone X build (B21 iOS half, uncompiled Swift) is Tony's MacBook
step, `.claude/skills/iphone-build`. Bench part 2 is at the top of [`bench-plan.md`](bench-plan.md).
Every firmware fact from the drive is a disassembly reading until a bench proves it on v4.32; proven facts live in
[`protocol/brx-protocol.md`](../protocol/brx-protocol.md) and [`manual/dev.md`](manual/dev.md).
## Lane: brx1, orchestration
**State:** 0.4.15 is BUILT and verified but NOT published: local commits in the main checkout (bump `efd1961c`, merge
`1a2e9927` which the APK is stamped with, notes `1400bc49`). It carries F419 and the red (tid 0) kill-confirm fix.
Everything else is on main: F411/F413/F415, the land lane (CLAUDE.md rule, Tony-approved), the test speed-ups and
memory headroom (F429/F430 closed), the app-screens sleep-wait fix (F432 closed), the doc cleanup. Handoff:
`~/.claude/handoffs/battlecompany-brx1-0415-pending.md`.
**Next:** at the bench, Tony turns the phones on: install 0.4.15, merge main (never rebase), commit the sidecar, one
push, publish `app-v0.4.15`, restart MC from main; then bench part 2.
**Blocked:** the publish waits on the phones; B21 on the MacBook.
## Lane: brx2, bench, audio, utility and docs
**State:** bench part 2 ran 2026-09-28 (brx1 drove, brx2 recorded; ended early). Full write-up: the 2026-09-28
entry in `experiment-log/2026-09.md`. Confirmed: F422 (closed), F402, PICK GAME, FAVOURITES, the BUILD guard, and
F416's zero-pool read on an unspawned gun (no false down in 6 go-lives). Failed on 0.4.15: F418, F381 (brx4 fixing)
and F297's first connect (6/10, GATT 133; brx5). New: F434 (claims from about 3 m), F435 (camped re-grant), F436
(first-grant slot bug).
**Next:** part 3 of [`bench-plan.md`](bench-plan.md): brx4's and brx5's rechecks first, then the rows that never ran.
R4/T5 read-only research is authorised; flashing stays decision first.
**Blocked:** 11.7 and the IPHONE block on the MacBook (WSL MC is never mDNS-discoverable); F270 on A8; F274 on its
three 2-hour soaks; F275 on outdoor space.
## Lane: brx3, releases and Mission Control
MC GAMES is PLAY + BUILD (F411) with FAVOURITES, LAST MATCH, teams (F413; a colour-only change recolours by index,
a count change re-splits) and the KOTH hold target (F415). `scripts/land.mjs` (the land lane) is how commits reach main.
APK 0.4.15 (built from `efd1961c`) carries the phone tid-0 kill-confirm fix and publishes at the bench.
- **F297 / F434 (2026-09-28):** a fast GATT 133 retries after 200 ms (`dec8065a`); the pass rule is now "linked
  within 3 s". The Stick powerup default is -45 dBm; reflash the Stick from main before bench 4.11. F435 closed:
  camping is fine.
- **F437 (2026-10-02):** the go-live klaxon (interrupt slot) cut the character taunt; it now goes before the line.
  Bench: `bench-standard-2026-09-29.md` step 10.
- **F438 (2026-10-02):** our own `$HIR` is a self-hit: the pools are given back, and a lethal one revives at once. Bench
  step 11 (and the FF A/B, a possible firmware finding).
- **F439 (2026-10-02):** the native death scream interrupts, so the phone sends no stop at death; body cues behind it
  are stopped after it ends. Bench step 12.
- **Next:** Tony's GAMES check at the bench. F429/F430 (browser-closed flakes): close after 3 clean lander runs once
  brx1's test-all headroom fix lands.
- **Tools:** Codex returns 401 until `codex login`; Sonnet and Opus lanes in worktrees did the builds.
## Lane: brx4, the StickS3
**State:** Stick stations are Bluetooth-only for MVP (hill, pickup, respawn); IR receive, the grenade hill and
revive counting are post-MVP. HELD is the boot default. Hill default: -75 dBm, hysteresis 6, until the outdoor
walk (F383).
**Next:** bench part 2, reflash from `6f042126`, then F386's a-d and sitting C (F388, F383's 3/7 m readings, F399,
F391, F392, F397). Desk: F342 (the scan-flood fix). Resume in a fresh worktree off `origin/main`; native Windows MC
for mDNS: `cd mcp && /mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe -m brx_mcp.mc --host 0.0.0.0 --port 8785
--ws-port 8786 --ephemeral`.
**Blocked:** none.
## Lane: brx5, powerups, the HUD and gun audio
**State:** powerups ON by default on main (F372); F416, F417 part 1 and F418 are shipped (spawn-write retry, lost
equip re-send, a held heavy ends only on a trigger pull).
**Next:** desk: B21's iOS half on the MacBook. F419's engine side is built (queue-slot cues wait for the clip on the gun); its bench check is on the row. Bench part 2: re-verify F416/F417/F418; sitting C's F394, F381,
F400 and spacing checks.
**Blocked:** none.
## Start here

1. **Next sitting:** [`bench-plan.md`](bench-plan.md) part 2, the 3 h cut first; record evidence and promote or close
   each row from the result.
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
