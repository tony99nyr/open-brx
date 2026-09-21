# Handoff: Open BRX

**State as of 2026-09-18 (night).** **Rules for this file.** One screen. It says what is true now; history is `git log -p -- docs/HANDOFF.md`. It has
one section per open lane. **When several sessions close together, each one overwrites only its own lane section,
never another lane's.** (On 2026-09-18 three lanes closed on the same night and rewrote each other's sections.)
The bench order and the desk-work list live in one place: [`bench-plan.md`](bench-plan.md).

## State of main (2026-09-19, after the pre-game office test)

App **0.4.4 is ready on branch `integrate-2026-09-19`, NOT yet published as a GitHub release and NOT yet
pushed. Tony publishes and field-tests it after lunch.** It carries 0.4.1-0.4.4 (flap-backoff fixes, picker
connecting-state and pacing fixes, the respawn-profile rebuild, and today's office-test fixes: connecting-screen
layout, the Mission Control LAN sweep paused during a gun connect, the low-health debounce, HUD layout, immersive
fullscreen), an eight-finding review pass, life presets (Standard 45/70/0, Shields 45/0/105, Hardcore 45/0/0),
and perk gain/cost lines on both UIs. **F206 is PROVEN**: levers §1 run f passed in a real TDM through Mission
Control (cross-team hits registered). **The respawn-protection mechanism F121/F209 described is gone, replaced
by 0.4.3's respawn profiles** (timed vs station, a weapon-arming delay independent of the protection window,
equal go-live at T-3); both rows are closed. Today's two ghost-node incidents are already answered by the
stale-node fix (`88ead536`), filed before the office test even ran. **The first field test after publish is the
Shields preset in a real match, plus the new respawn rules on both phones; both phones need wireless debugging
re-enabled first.** Still open and P0: the BLE link-loop root cause (**F293**) and BLE setup-reliability metrics
(**F297**); see `bench-plan.md`'s new "0.4.4 field check".
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
GUN NOT ANSWERING on the operator's board when it cannot help. **F121 and F209 are CLOSED (2026-09-19)**,
superseded by 0.4.3's respawn-profile rebuild (a separate weapon-arming delay, no default protection on a timed
respawn, equal go-live at T-3); F223 (order node facts by their own `t`) is the one open thread F209 leaves
behind. Overnight cycle 1 (2026-09-18 night) closed **F261** (a fresh MC now records an orphan match from any
unbound node) and **F257** (the charge-weapon HUD). Today's stale-node fix (`88ead536`, no open row) answers both
ghost-node incidents from the office test. **F289** still flags the gap it leaves: an offline player
mid-protection-window may stay protected all match. **F265**'s HUD half shipped (LIVE only within 16 s of the
last MC message); its cause, why the score pushes stopped, is still not found. Also open: **F277** (a reload
that never completes), **F287** (operator RESYNC still writes before the `$HP` probe answers), **F288** (the HUD
never renders `poolStale`/`cure`), and the office test's own new rows, **F293-F298** (link-loop root cause,
  the MC LAN sweep, the down-pattern LED redesign, BLE setup-reliability
metrics, and a real Shields-preset match). App **0.4.4** is built on this branch, not yet published; see "State
of main" above.

- **Next desk task:** the F265 cause (why a bound phone stops receiving score pushes). Then **S55** (one accuracy
  owner), then **F274** (the recoil writer onto one `$TMP` t4 frame).
- **Next bench task:** the "0.4.4 field check" in [`bench-plan.md`](bench-plan.md) (connect timing on both
  phones, the new respawn rules, the Shields preset, the down animation, full screen), then sitting 5, match
  verification: F264 live, the F277 repro, and the F256 row.
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
  once (**S54**). **F291** (Charge Rifle dominates, Shotgun trails) needs Tony's decision.
- **Next bench task:** **F292** (the Toxin Rifle on a real gun), then bench-plan sitting 2 steps 1-4, then
  sitting 3 (§26 groups A and B).
- **Blocked:** S54 and sitting 8 on the rung decision; Extended Mags on `$TMP` (S50) and F281 on sitting 2;
  **F275** on outdoor space (sitting 10).

## Lane: sound catalog and public manual

The public sound bank now exposes the complete 2,634-id union: AI category and description, raw acoustic
measurements, on-gun/app availability, transcript and speaker, confirmed use, 291 by-ear checks (214 listener
notes), 1,004 LaserTagMods community labels, and the 20 community noise flags. Copyable `$PLAY` frames now include
the required volume and priority. The remaining S1 work is listening, not publishing: audit every FX category and
build the category-driven Mission Control picker.

- **Next desk task:** none; the source-to-site fidelity gate prevents fields being dropped again.
- **Next bench task:** continue S1 with any FX category except the completed `fx:hit` family.
- **Blocked:** nothing.

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
