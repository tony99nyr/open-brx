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
**State:** 0.4.14 cut and published (`56fbece4`), CI green; polish loop closed every Critical/High/Medium (Lows in
the F416 row). The day's UI/balance decisions are in `post-mvp.md` (F412, F413, F414, F415) and
`experiment-log/2026-09.md`'s 2026-09-26 brx1 entry.
**Next:** cut 0.4.15 on Tony's go; Tony builds the iPhone (`iphone-build` skill).
**Blocked:** none.
## Lane: brx2, bench, audio, utility and docs
**State:** bench part 1 done 2026-09-26 (full write-up: `experiment-log/2026-09.md`'s 2026-09-26 brx2 entry). KOTH's
Stick-hill half is confirmed (F382/F384/F385 closed); the phone-hill half is blocked by F420 (built, bench check
owed). Hill default: -75 dBm, hysteresis 6, until the outdoor walk (F383).
**Next:** part 2 of [`bench-plan.md`](bench-plan.md) (reflash the Stick from `6f042126`, `RANGE CLEAR` it at setup).
R4/T5 read-only research is authorised; flashing stays decision first.
**Blocked:** F270 on A8; F274 on its three 2-hour soaks; F275 on outdoor space.
## Lane: brx3, releases and Mission Control
APK 0.4.14 is current. MC GAMES is PLAY + BUILD (F411), with FAVOURITES, LAST MATCH, teams (F413) and the KOTH hold
target (F415), all on main at `4275fad2` with green CI. The phone tid-0 kill-confirm fix (`f52d34dd`) rides the next APK.
- **Next:** Tony's GAMES check at the bench (PLAY, BUILD, TEAMS, HOLD); the next APK cut for the phone fix.
- **Tools:** Codex returns 401 until `codex login`; Sonnet lanes in worktrees did the build, Opus reviewed.
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
**Next:** desk: B21's iOS half on the MacBook. Bench part 2: re-verify F416/F417/F418; sitting C's F394, F381,
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
