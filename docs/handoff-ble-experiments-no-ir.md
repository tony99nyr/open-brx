# Handoff — four BLE-only experiments (no IR hardware, no Callsign, no PacketLogger)

**For:** the WSL/Windows session.
**From:** the MacBook session, 2026-08-26, after closing P1.
**Needs:** two taggers + the laptop's BLE radio. **Nothing else** — no IR receiver, no phone, no
capture rig. All four run against our own stack.

---

## Why now

Two things landed today that make these possible and that earlier sessions could not have run:

1. **Player ids are settable over BLE** (`$PSET` token 1, §7p) and the driver now **auto-numbers the
   fleet 0,1,2…**, so two guns are automatically distinct. `GameConfig.player_ids` pins specific ids.
2. **The full weapon arsenal is captured and named** (`docs/reference/weapons.md`), so each weapon's
   `t5`, cycle time, clip and heat are known *before* firing it — which turns "shoot things" into a
   measurement.

**Bench safety:** panic = `$CLEAR,*` then `$SP,99,*`. Headsets **ON** or a gun silently refuses to
join (§7m). Volume **69** for real audio. Never modify firmware.

---

## 1. Does `$HIR` carry the shooter's PLAYER ID? 🔴 highest value

> ✅ **ALREADY CLOSED — 2026-08-25, before this handoff (WSL/Windows session).** `$HIR` tok3 IS the
> shooter's player id, bench-verified both directions on two guns with ids 6 and 19 (`brx-protocol.md`
> §7q; FOLLOWUPS P2). Every earlier capture had all guns at id 0, exactly as this experiment suspected.
> Per-player attribution is BLE-native and shipping in the MC scorer; the VS1838B IR bench is an
> optimisation. Do not re-run.

**Question.** `$HIR` was decoded as naming the shooter's **team** (§7k). But `protocol.py` has always
parsed it as `tok3 = shooter player id, tok4 = team`, and **every capture behind the team-only
reading was taken with all guns on the default id** — so a player-id field would have been
indistinguishable from a constant. That conclusion may simply have been unable to see the difference.

**Why it matters.** Per-player attribution is the **last stock-feel gap over pure BLE**. If `tok3`
tracks the shooter, attribution is BLE-native and the VS1838B IR bench becomes an *optimisation*
rather than a prerequisite for FFA scoring. This one result can delete a hardware dependency.

**Method.**
1. Arm two guns with our stack; they get player ids **0** and **1** automatically.
2. Confirm on the wire that each gun received a *different* `$PSET` token 1.
3. Have gun A shoot gun B. Record every `$HIR` from **B**.
4. Swap: B shoots A. Record every `$HIR` from **A**.
5. Optional third point: pin ids far apart (`GameConfig(player_ids={"A": 5, "B": 40})`) and repeat —
   a field that reads 5 then 40 is unarguable.

**Record.** The full `$HIR` frame per hit, plus which gun fired and its configured id.

**Outcomes.**
- `tok3` tracks the shooter's id → **P2 closed over BLE.** Update §7k, `protocol.py`, and re-scope
  the IR work around *reading* rather than *identifying*.
- `tok3` is constant while ids differ → §7k stands, per-player needs IR, and we've spent one bench
  session to confirm a hardware purchase was necessary.

---

## 2. Does `$WEAP` `t5` actually mean damage? 🟡

> ✅ **PASSED — 2026-08-26 (WSL/Windows session).** `t5` **is** the applied damage — **exact, 4-of-4**
> across the range (AR 9→armor −9; Shotgun `T01` 45→−45; Sniper 80→70 absorbed +10 HP; Rocket 115→
> instant kill). The manual's M-4=24 was stale; the AR really deals 9. `weapons.md` ✓ restored + caveat
> dropped; `protocol-classes.md` `t5` resolved. Bonus decodes: `$HIR` **tok2 = shooter IR protocol**
> (0 standard, 10 on the rocket) and **tok7 = subtype echo** (sniper 1); armor model pinned (1:1
> absorb, spill to HP, no cap). See `brx-protocol.md` §7r + experiment-log.

**Question.** `t5` was read as `primaryDamage`, anchored to the manual's M-4 = 24. cap14's Assault
Rifle carries **9**, so it is currently marked **unresolved** (`protocol-classes.md`).

**Why it matters.** It is the field a game engine most wants to trust, and `weapons.md` currently
publishes numbers we cannot vouch for. Also feeds **P10** (whether the IR payload carries a damage
value).

**Method.** Same two guns. For each of ~4 weapons spanning the range — e.g. AR (`t5`=9), Shotgun-ish
`T01` (45), Sniper `S16` (80), Rocket Launcher (115) — put it in the shooter's slot 0, fire **one**
shot at a stationary target, and record the victim's `$HP` before and after.

⚠ **Armor absorbs first** (~9/hit observed, exp-log): let armor deplete, or track the armor field
rather than HP, or the deltas will not be comparable.

**Outcomes.** Deltas scale with `t5` → `t5` is damage and the manual's 24 was stale; restore the ✓
and drop the caveat in `weapons.md`. Deltas identical regardless of weapon → damage is **not** in
`$WEAP` and is decided elsewhere (server-side or the IR payload) — which is a bigger finding.

---

## 3. Fire `$SFLASH` from OUR stack 🟡 quick

> ✅ **PASSED — 2026-08-26 (WSL/Windows session).** Bare `$SFLASH,*` on an idle unspawned gun turns the
> sight green, **latching for several seconds**. Unconditional — no game state needed. Kill-confirm
> engine validated; see experiment-log.

**Question.** `$SFLASH` = the shooter's green-sight kill confirm was decoded from the official app
(§7o) and is now wired into our engine (`KillConfirm` → `$SFLASH,*`). **We have never actually sent
it.** Everything about it is inferred from watching Callsign.

**Method.** Run a two-gun game on our engine, score a kill, and *watch the shooter's sight*. Also
worth sending `$SFLASH,*` bare, outside a game, to see whether it flashes unconditionally.

**Outcome.** Sight greens → the feedback engine is validated end-to-end and the B18 work is real.
Nothing happens → `$SFLASH` needs game state or a companion frame we haven't identified, and B18's
visual half is still open. **Either way stop describing the green sight as "ours" until this passes.**

---

## 4. `$TID` team range (P9) 🟡 quick

**Question.** 2 teams (TDM) and 3 (Supremacy) are confirmed. How many distinct `$TID` values does
the gun honour for friendly-fire resolution?

**Why it matters.** Decides whether small squads (duos/trios) work **natively** or need a Mission
Control logical-team workaround.

**Method.** Set the two guns to `$TID,4` / `$TID,5`, fire cross-team (expect damage), then set both
to `$TID,4` and fire (expect none, with friendly fire off). Walk upward until the behaviour breaks.

**Outcome.** Records the real usable team count in `game-modes.md` + `mode-limits.md`.

---

## Suggested order

1 → 3 → 2 → 4. Experiment 1 can delete a hardware dependency; 3 is a two-minute check that validates
a thing we've already built and shipped; 2 needs the most careful setup (armor); 4 is cheap and can
fill any leftover time.

**Log everything to `docs/experiment-log.md`** and update `FOLLOWUPS.md` (P2, P5, P10, P9, B18).
Where a result overturns a documented conclusion, **say so explicitly in the doc it overturns** —
several of today's wins came from re-reading old captures and finding a confident claim that had
never actually been tested.
