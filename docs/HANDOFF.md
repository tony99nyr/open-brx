# Handoff: Open BRX

**State as of 2026-09-18 (night).** **Rules for this file.** One screen. It says what is true now; history is `git log -p -- docs/HANDOFF.md`. It has
one section per open lane. **When several sessions close together, each one overwrites only its own lane section,
never another lane's.** (On 2026-09-18 three lanes closed on the same night and rewrote each other's sections.)
The bench order and the desk-work list live in one place: [`bench-plan.md`](bench-plan.md).

## State of main (2026-09-18, night, after overnight cycle 1)

`main` carries the LaserTagMods drive integration (stock firmware images, BC's sheets, the `soak` tool), the
playtest branch's desk work (the F264 cure, the recoil writer rebuild), the arsenal rework with its public
`/arsenal` page, levers bench session 1 (three sittings), and overnight cycle 1: the spawn-protection rebuild
(F121, desk work done, bench check still open), the stale-scoreboard label fix and the fresh-MC orphan record
(F265's label half and F261, closed), the charge-weapon HUD fix (F257, closed) and the runtime crit-perk refusal
(F278, closed). App **0.4.0** is released (`app-v0.4.0`, DEBUG-signed) and both Pixels still need the install.
**Every firmware fact from the drive is a disassembly reading until a bench proves it on v4.32**; the claim
checklist is [`bench-firmware-levers-2026-09-19.md`](bench-firmware-levers-2026-09-19.md). Facts that session 1
proved, and that every lane builds on:

- **`$TMP` works over BLE** for t4 (accuracy, also the REAL hit rate), t5 (full-auto interval only), t6 (reload
  time), t7 (outgoing damage), t8 (incoming damage) and t9 (magazine, raw rounds, ADDS on every re-send). No token
  resets the magazine. `$SPAWN` zeroes `$TMP`; a `$LIFE` revive keeps it. ⚠️ t4 is last-writer-wins against the
  gun's own fn 23 smoke, and the smoke's ~6 s timer resets t4 to 0 regardless.
- **`$STOP` blocks a hit's damage but not its `$HIR`, and it survives `$SPAWN`.** Anything that sends `$STOP` must
  send `$START` (plus `$GSET` and `$TID`) before the next life.
- **`$SPAWN,,*` then `$TMP` t8 = -100 then `$TID` protects a spawn** with no fn-28 twin table; the `$SIR` table
  survives `$SPAWN`. The t8 write must come AFTER `$SPAWN`.
- **`$BUMP,<amount>,<hp>,<armour>,<shield>,<sound>` is confirmed on every field** (F65 closed).
- **`$STUN,<ms>` is a native, SILENT stun.** The node plays `X17` itself (built, commit `273e949a`, not yet heard in a match).
- **Poll a gun with the bare `$LIFE,*`**: a dead gun answers `$HP,0,0,0` at once. `$QUERY` holds a dead gun for ~2 s.
- **`$DD` does not exist on this gun**, and no protocol-15 word plays a native kill callout. A DEAD gun still
  forwards a host `$IRTX` through its headset, so a kill confirm can ride IR (B31).
- **`$LIFE,<hp>,0,0,1,*` then `$HLED,,6,*` revives a gun killed over BLE.** Untested on a real F264 stall.
- **`$DPLAY` on a looping sound blocked the gun and dropped the link** (screamers A1). It stays on the never-send list.

## Lane: levers and screamers

Screamers are Tony's P0. Levers session 1 ran in three sittings; its remainder is bench-plan sitting 2.
Screamers Phase A has run A1 and A2 only.

- **Next desk task:** **F272**, the lock-up detector on the phone and in MC. F283 (`soak --phone-pacing`) is built.
  Then **F272** (the lock-up detector) and **F271** (the `$QUERY` read-back).
- **Next bench task:** bench-plan sitting 1, screamers Phase A transport half (one gun, a laptop, about 55 min).
  Nothing blocks it. Its A7/A8 numbers unblock **F269** (turn the block pause on) and the Phase B rules.
- **Blocked:** Phase C on the A7/A8 numbers; Phase E on F272; Phase D on the Phase B rules.

## Lane: playtest and the node cure

The F264 cure SHIPPED: on three unanswered pulls the node probes with `$LIFE,*`, acts only on the reply, and puts
GUN NOT ANSWERING on the operator's board when it cannot help. Overnight cycle 1 (2026-09-18 night) closed
**F261** (a fresh MC now records an orphan match from any unbound node) and **F257** (the charge-weapon HUD), and
shipped **F121**'s spawn-protection rebuild: `$SPAWN,,*` then `$TMP` t8 = -100 then `$TID`, in place of the
28-frame fn-28 twin table; MC refuses START and withholds hot-join, welcome, resend and the start broadcast for
any bound node not on app 0.4.x. **F289** (filed the same night) flags the gap this leaves: an offline player
mid-protection-window may stay protected all match. **F265**'s HUD half shipped (LIVE only within 16 s of the
last MC message); its cause, why the score pushes stopped, is still not found. Also open: **F277** (a reload that
never completes, which the cure cannot see). App **0.4.0** is released; both Pixels still need the install.

- **Next desk task:** the F265 cause (why a bound phone stops receiving score pushes). Then **S55** (one accuracy
  owner), then **F274** (the recoil writer onto one `$TMP` t4 frame).
- **Next bench task:** the pre-game check in [`bench-plan.md`](bench-plan.md) (install 0.4.0, then levers §1 run f
  and a spawn-protection check), then sitting 5, match verification: F264 live, the F277 repro, and the F256
  row.
- **Blocked:** F274 on S55; F277's detector on its repro.

## Lane: weapons and perks

Shipped: the `$WEAP` t12 headset word as a declared `wire.headset_dmg` (a captured t12 with no price is a refusal),
crits on two weapons (`crit_pct`; hits-to-kill stays the GUARANTEED number), the counts derived from the shipped
artefact, and the `/arsenal` page. **PROPOSED, NOT SHIPPED: every recoil number** (`spec/node.md` §3.15).
The Toxin Rifle SHIPPED 2026-09-19 (S16 closed): every hit poisons, the node tick clock, credited `death`
with `dot: true`, the HUD poison and smoke tells, unhidden. `mcp/tools/balance_sim.py` balances any weapon
(weapon-design.md §7.5c). The F268 floors stay at 60. The "fraction of the magazine" rung approval is
WITHDRAWN; do not act on it.

- **Next desk task:** settle the rung basis with Tony (**F268** second judgement and **F280**), then wire it
  once (**S54**). **F291** (Charge Rifle dominates, Shotgun trails) needs Tony's decision. **F290**: `main` is
  red in two browser gates.
- **Next bench task:** **F292** (the Toxin Rifle on a real gun), then bench-plan sitting 2 steps 1-4, then
  sitting 3 (§26 groups A and B).
- **Blocked:** S54 and sitting 8 on the rung decision; Extended Mags on `$TMP` (S50) and F281 on sitting 2;
  **F275** on outdoor space (sitting 10).

## Start here

Read [`bench-plan.md`](bench-plan.md). If Tony is at the bench, load the `bench-session` skill and run sitting 1.
Otherwise take the first desk task, **F272**, then **F271**. F265's root cause (why score pushes stopped) is still open.

## Machine state

MC runs from `mcp/` on 8765/8766 and serves `webapp/mc/dist`; rebuild that before starting it, and restart MC
**between matches only**. Check with `ss -ltn | grep 876`.

```
setsid nohup ../.venv/bin/python -m brx_mcp.mc --advertise 192.168.0.55 --bench-volume
```

The shield recharge runs only on the **Shields preset** (armour 0). WSL runs the Python suites and no-hardware MC;
Windows Python drives BLE; the MacBook is the field target. Never modify stock firmware.
