# Handoff: Open BRX

**State as of 2026-09-18 (night).** `main` carries the LaserTagMods drive integration (stock firmware
images, Jay's ESP32 sources, BC's command sheets, BC's 2018 app, a Callsign capture, the `soak` tool),
the fix/playtest-2026-09-13 desk work (F264-F268, S54-S55, the recoil writer rebuild, the cure test
suite), and tonight's firmware levers bench, session 1 (all three sittings). **Every firmware fact from the
drive is a disassembly reading until this bench proves it on v4.32.** The full plan, all five sessions
in one running order: [`bench-plan.md`](bench-plan.md). **Open that file first at the bench.** The
claim-by-claim checklist is [`bench-firmware-levers-2026-09-19.md`](bench-firmware-levers-2026-09-19.md).

## Tonight's bench: what session 1 settled

Two guns (Tactix-E20D, Tactix-3D4F), then Tactix-E20D alone with the ESP32 IR rig. Full findings:
`docs/experiment-log/2026-09.md` (2026-09-18, "firmware levers session 1").

- **F206 CONFIRMED at the wire level** (runs a-e). Run f, a real TDM through Mission Control, is the
  only part still open.
- **`$STUN,<ms>` is a real, native, SILENT stun**, about 6 s. The node must play its own cue (`X17`,
  matching Battle Company's concussion-grenade sheet entry) since the gun plays nothing.
- **`$BUMP` is confirmed in full, including the shield flag and the sound token** (third sitting,
  2026-09-18): `<amount>,<hp 0/1>,<armour 0/1>,<shield 0/1>,<sound>`. Closes F65.
- **`$TMP` t4 (accuracy), t5 (fire interval), t6 (reload time), t7 (outgoing damage), t8 (incoming
  damage) and t9 (magazine) are all confirmed over BLE**, none of them reset the magazine or reserve on
  their own, and this unblocks three things at once: the recoil writer can move off `$WEAP`+`$AMMO`
  onto one 20-byte `$TMP` frame (F274), spawn protection can drop from a 28-frame fn-28 twin table to
  `$SPAWN,,*` + one `$TMP` t8 write (levers §23, F121/F269), and Extended Mags and Quick Hands each get
  a wire-only alternative to today's compile-time multipliers (S50). ⚠️ **`$TMP` t4 is last-writer-wins
  against the gun's own fn 23 smoke, and the smoke's own ~6 s timer resets t4 to 0 regardless of the
  last write.** Any accuracy writer needs the single-owner design S55 already proposes, plus one more
  rule: never write t4 while a smoke is active, and re-send the owner's value once it ends.
- **Spawn protection's 7-frame `$SPAWN` + `$TMP` design is confirmed step by step** (§23, third
  sitting), with one design rule it surfaced: **`$STOP` blocks a hit's damage but not the hit itself**
  (`$HIR` still arrives, no `$HP`), **and `$STOP` survives `$SPAWN`** — only `$START,*` (plus a
  `$GSET`/`$TID` re-send) reopens it. Anything that sends `$STOP` must send `$START` before the next
  life.
- **Desk (built, not bench-tested tonight, and now landed as F15):** the node plays
  `$PLAY,X17,4,6,,,,,*` once at stun start.
- **A dead gun answers the bare `$LIFE,*` with `$HP,0,0,0` at once; poll with that, not `$QUERY`**
  (`$QUERY`'s reply holds a dead gun's print loop busy for about 2 s). Confirms F264/F272's probe.
- **`$DD` REFUTED for this gun**: a one-hit kill gave no `$DD` at all. Do not build any cure on it.
- **No native kill-confirm callout either** (levers §13 step 3): every protocol-15 magnitude 1-39 registered
  silently on the killer's gun, but none produced an audible line. Callsign's own kill voice is an app-side
  `$PLAY`. That leaves a protocol-15 word as a cheap IR-only carrier for a host-defined kill confirm (B31).
- **Screamers A1/A2**: `$DPLAY` on a looping sound blocked the gun (no `$PONG`, no reply, no audio) and
  dropped the BLE link about 15 s in, but it recovered on reconnect with no power cycle needed this
  run: a partial screamer, not yet a proven full lock. `$DPLAY` stays on the never-send list either way.
- **A dead gun still forwards a host `$IRTX` out through its headset** (a dying gun emits no IR of its
  own), the headset loop fields on `$IRTX` work as read, and fn 34 registers on a dead gun. `$LIFE` set
  mode fully revives a dead gun (fires, takes hits, keeps its magazine and any `$TMP` write), though the
  headset death flash needs a separate `$HLED,,6,*` clear. **Untested against the F264 stall state
  specifically**: reproduce that stall before trusting this as the cure.

## Weapons: what changed today, and what is decided vs proposed

`$WEAP` **t1 = 2 means the shot leaves the gun AND the shooter's headset**, and **t12 is the second
word's damage**. Measured twice (cap30: 45 then 70, 88 ms apart, a kill; then a victim at 250 armour
read BETWEEN the words: Shotgun 250 → 205 → 135, Plasma Sniper 126 → 101 → 21). Three weapons do it.
We had been pricing t5 and shipping Battle Company's t12 untouched. **t12 is now a declared
`wire.headset_dmg`, and a captured t12 with no declared price is a REFUSAL.** Armour Piercing zeroes
it, because the perk rekeys the whole frame to the armour-bypassing cell and was delivering 35 to bare
health for the price of 15.

**Crits ship on three weapons** (`crit_pct`): Burst Rifle 40%, AMR 30%, Toxin Rifle 15% where the crit
is the poison PROC. Paid for in damage, so averages hold. ⚠️ **Hits-to-kill stays the GUARANTEED
number**: a test pins `htk == ceil(pool / damage_per_pull())` so nobody folds an expected value in.

**Four counting faults fixed, one cause: counting rows in a file, not weapons in a game.** The site
said 25 weapons (15), the phone demanded 7 perks (5), the pools said 11 OF 13 (primary 11 of 15,
secondary 13 of 15, genuinely different), and the home page said 22. All four now derive from the
shipped artefact. `support` also stopped being a dumping ground and now MEANS "cannot kill".

**Shipped:** the public `/arsenal` page, generated from the catalogue, linked from the home page, art
for every weapon. All 25 descriptions rewritten as player copy, balance notes moved to `notes`.

⚠️ **PROPOSED, NOT SHIPPED: every recoil number.** The two-step table lives in `spec/node.md` as a
proposal; `weapons.json` carries none of it. **F268** (two judgements in it), **F280** (the rungs do
not scale with the magazine, and their derivation is wrong underneath), **F281** (Quick Hands must
move in one piece or not at all) and **S54** (wiring the fields) all bear on it. S54 is deliberately
unbuilt until the other three settle: wiring six fields three times is worse than wiring them once
late.

## Still open, unchanged by tonight

1. **F264** a player can be dead on the gun and alive on the HUD. **The CURE IS SHIPPED** (2026-09-19): on three
   unanswered pulls the node probes with `$LIFE,*` and acts only on the answer, never revives on no evidence, and
   puts GUN NOT ANSWERING on the operator's board when it cannot help. **What is still open is the CAUSE** (why a
   gun leaves the state our writes assume) and whether the cure works on a real stall: the two-frame `$LIFE` revive
   was measured on a cleanly killed gun, NOT on a stalled one. Next stall at the bench, try it BEFORE any force
   respawn, which destroys the evidence. **F277** is the variant the cure cannot see: a reload that never completes
   leaves an empty magazine, which correctly never reaches `no_fire`.
2. **F265** a bound phone's scoreboard can freeze while the overlay says LIVE.
3. **F261** a fresh Mission Control never offers to adopt a running match.
4. **F257** the HUD says OUT OF ENERGY on a charge weapon that can still fire taps.
5. **F256** the coverage line claims an internet path WiFi-only phones do not have.
6. **F262** the gun's native shield-hit sound tracks something other than the pool.
7. **F209** the respawn burst read as an outbox-flush artefact, not the engine; ordering facts by their
   own `t` (F223) is what is left.
8. **Screamers is still Tony's top priority.** Tonight's A1/A2 is one run of Phase A; the rest of
   `bench-screamers-2026-09-19.md` (Phase A remainder, B, C, D) is unrun.

## Next actions, in order

1. **Screamers Phase A, the rest of it**, then Phase C (`python -m brx_mcp soak <address> <pattern>
   <minutes>`) once A gives F269/F270/F272 their numbers. Do not turn the block pause on before that.
2. **Levers session 1, the rest of it**: §21 remaining steps (9-14, 19: t9 sub-behaviour, t1-t3 pool
   maxima), §2, §12, §16, per `bench-plan.md`. §5 (`$BUMP`) and §23 (spawn protection) are now done.
3. **Levers session 2** (§3, §6-§10, §15) and the IR-rig session (§11, §13, §16, §17, §20, §24), both in
   `bench-plan.md`.
4. **S55, the single accuracy owner** -- the recoil writer's move onto one `$TMP` t4 frame is accepted and
   BLOCKED behind it. t4 is shared with the gun's own smoke in both directions, so writing it without the owner's
   three rules (never during a smoke, re-send when it ends, re-send after a `$SPAWN` but not after a `$LIFE`
   revive) would ship the bug the bench found. This is the largest write-budget saving available (F274).
5. **Fix F265 and F261**, both small: never print LIVE over a stale board, and record an orphan match
   whether or not a node is bound.
6. **Weapons decisions, no bench needed** (all numbers nobody has played): **F268**, **F280** and
   **F281** should settle in one pass. **Toxin** needs three from Tony before its node tick clock can
   be built: who gets kill credit for a lethal tick, whether poison survives a respawn, and what the
   HUD shows while it ticks.
7. **F275 🔴 needs outdoor space** (Tony: not today). At what `t13` value does the headset word stop
   arriving. (It was F254 until 2026-09-19: F254 collided, and the ARCHIVED row keeps the id because a closed id must stay citable, so this open one moved.) It unlocks the close-range weapon class, which `t2` cannot express: F231 says everything
   from 55 to 100 reaches the same distance.

## Machine state

MC runs from `mcp/` on 8765/8766 and serves `webapp/mc/dist`; rebuild that before starting it, and
restart MC **between matches only**. Check with `ss -ltn | grep 876`.

```
setsid nohup ../.venv/bin/python -m brx_mcp.mc --advertise 192.168.0.55 --bench-volume
```

Both Pixels hold 0.3.0. The shield recharge only runs on the **Shields preset** (armour 0), because
every compiled head carries a shield ceiling regardless.

**Machine roles:** WSL runs the Python suites and no-hardware MC; Windows Python is for BLE
instruments; the MacBook is the field target. Never modify stock firmware.
