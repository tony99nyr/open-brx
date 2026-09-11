# Bench run sheet — the whole queue, ordered for the operator's time

Updated: 2026-09-11 (2026-09-09, re-checked). **This sheet replaces reading `FOLLOWUPS.md` §9 at the bench.**
§9 stays the register (ids are permanent and live there); this is the running order. Every command below exists
in the repo and was checked against its source. Nothing here is a new script.

⚠ **Answered rungs are OUT of the tables.** A1, C1, D7 and G 3.2 are done; each keeps one line where it was and
its lesson in *Answered rungs* near the bottom, so nothing you read on the way to the next rung is closed work.
**Tomorrow's sitting is not this sheet** — it is [`bench-critical-2026-09-11.md`](bench-critical-2026-09-11.md),
six readings, deliberately self-contained. Come back here for the rest of the queue.

**Read first:** [`gotchas.md`](gotchas.md) §"Before a bench session" (the four-check preflight, in
order, every time). `$PY` below = the Windows venv python,
`/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe`. Rig: board A = receiver **COM7**, board B =
emitter **COM8**. Never end a run on a bare `$CLEAR` (F11) — close with
`bench_common.teardown_frames()`.

## The scheduling rule

Setup costs minutes, readings cost seconds. So this sheet is ordered by **setup block**, not by
followup id, and a block is finished before the next one starts. Blocks A-D are the whole
design-gating core and fit one evening; E-H are their own sittings.

## Before you touch a gun: four traps that fake results

1. **`firemode_probe.py` takes a RAW token index: `raw = doc token + 1`.** Doc t20 (fire mode) is
   raw 21; t21/t22 (accuracy) are raw 22/23; t6 (crit) is raw 7; the secondary block t7-t11 is raw
   8-12; t37/t38 are raw 38/39. The tool PRINTS the frame before sending — read it against
   [`reference/weapons.md`](reference/weapons.md) and confirm the value moved where you meant, every
   rung. A probe aimed one token off reads exactly like an inert token.
2. **`Compiler.tutorial_frames()` (what `firemode_probe.py` pushes) ships ONE `$SIR` row,
   `$SIR,0,0,,1,…`.** A weapon whose `<t3,t4>` is anything else has no cell, and an unmatched cell is
   discarded in silence: sniper/force are t4=1, burst/bolt/AMR/pistols t4=3, charge t3=8, rail 6,
   energy launcher 9/3, rocket 10, melee 13/1. **Arm the VICTIM from `bench_common.SIRS` (all ten
   rows), never from a try-out.**
3. **`tutorial_frames()` also ships `$BMAP,0,0` only** — trigger fires, nothing else is mapped. No
   gyro (so it cannot swing a melee), no reload handle, no ALT. Any rung needing those uses
   `bench_common.BMAP` (which carries `$BMAP,8,4`) before `$SPAWN`, with `spawn_tail()` after (F16:
   without it the trigger produces `$BUT` and no shot at all). **"Full arm" below means exactly that:**
   `arming_frames(pid,tid)` + the weapon frame + the full 7-row `BMAP` + `$SPAWN,,*` + `spawn_tail()`,
   **staying connected** — the pattern `sensor_bench.py` and `ff_ab.py` already use. ⚠ `bench_common.AR`
   is the raw capture (t14 = 100, reserve 384); **MC ships the AR at `fire_ms` 140 and reserve 192**, so
   arming from that constant measures a weapon we do not ship. Use the compiled frame for any cadence or
   reload reading.
4. **The known-safe list is enforced in `server.py` (the MCP tools) and NOWHERE ELSE.** `$LIFE`,
   `$BUMP`, `$UP` and `$BHIT` are not on it, so the MCP `send` tool **refuses them silently unless you
   pass `confirm=true`** — while `mcp/tools/sendframes.py` calls `ConnectionManager.send` directly and
   sends anything. This produced a false finding tonight (2026-09-09): `$LIFE` "does not heal" was two
   refusals read as the gun ignoring the frame. **Confirm the frame was SENT before concluding anything
   about how the gun answered.** `$AS` is on the list; `$UP` and `$BHIT` are not.
5. **A STITCHED IR word can be parity-valid and WRONG in exactly the field you are measuring.**
   Rig-qualified 2026-09-09 against a real gun: every clean reading decoded identically
   (`proto=0 player=0 team=1 mag=9 sub=0`, matching the arming byte for byte), but the stitcher's
   `AMBIGUOUS 2` lines offered a second candidate that also passed parity — and the impostors were
   `proto=4`, `proto=1`, `mag=137`, `mag=41`, `sub=1`, `sub=2`, `player=16`. **C3 counts words by
   PROTOCOL and C1 counts MAGNITUDE 0**, so an ambiguous stitch manufactures the very signal those
   rungs look for. Count only `WORD` lines (whole, `edges=51`) or an unambiguous `STITCH`; never an
   `AMBIGUOUS`. And budget for the rate: **7 whole words out of 45 bursts** in that qualification, so a
   10-pull rung yields one or two usable decodes. Either pull 3-4x more per rung, or design the rung
   around a COUNT (did any word arrive at all) which the ambiguity cannot fake. This is F12's
   frame-splitting trap in a sharper form: the repair does not merely lose data, it invents readings.
6. **`firemode_probe.py` disconnects when it is done** (config survives the drop). So it can never
   read the shooter's own `$ALCD`/`$BUT`. For a shooter-side reading, push first, then reconnect with
   `$PY -m brx_mcp listen <addr> 90` and fire while that streams.

---

## Block A — desk, no rig, no dim room (~20 min, do this first)

Highest value per minute in the queue: A1 gates a whole feature class and validates an assumption
the syphon code already depends on.

| # | item | run | read | control |
|---|---|---|---|---|
| A1 | ✅ **DONE 2026-09-09** — `$LIFE` takes negatives, `$BUMP` is inert. Do not re-run; the ordering lesson it cost is in *Answered rungs* below | — | — | — |
| A2 | **P4** | `$PY mcp/tools/sendframes.py <addr> '$AS,1,0,0,0,0,0,0,99,*' '$UP,1,*'` on a live gun. ⚠ Also try LaserTagMods' actual shape, `$UP,100,<n>,0,*` followed by `$UR,*` — `$UP,1,*` matches nothing any source documents and may just be an 8th silent shape rather than a probe | not "does it reply" (known: no, across 7 shapes) but does the GUN's behaviour change after: fire, reload, LEDs, anything | fire and reload normally for a minute BEFORE sending, same gun same session, so "no change" is established rather than assumed |
| A3 | **1.5a (gates 1.5)** | `$PY mcp/tools/ally_remeasure.py <victim> COM8 10,11,9,15,31,32,34` | per-fn pool deltas against a **depleted** pool | fn 10/11 are the known heals: if they do not move, the rig or the team polarity is wrong, not the fn |

**Why A1 was first, and what it returned:** the firmware has no damage-over-time function, so a node applying
the tick was the only possible route to poison/burn/bleed. ✅ **Answered 2026-09-09: `$LIFE` takes negatives and
drains, so DoT is real** (S16). `$BUMP` — the command this rung was originally written around — turned out to be
**inert in both directions** (F65), and `$LIFE` was the one that worked.

---

## Block B — ears, one connected gun, no firing (~90 min, interruptible anywhere)

**One instrument for the whole block:** `$PY -m brx_mcp sounds ids:<A,B,C> <addr> --audit`. It plays
ONE clip, prints the label it expects, and blocks until you type: `Enter` right · `x` wrong (it asks
what you heard) · `r` replay · `q` quit. Verdicts append to `~/.brx-mcp/sound-audit.jsonl`, so there
is nothing to write down. This satisfies F43's confirm-solo rule structurally: the tool cannot
advance without you, and a rapid audition is what hid the tails last time.

**Two limits:** playback is capped at **60 ids per run**, and `--audit` reads stdin across the
WSL→Windows boundary. **B0 first:** `$PY -m brx_mcp sounds ids:H06 <addr> --audit` — if the prompt
does not take your keystroke, run it from a Windows terminal instead of losing an hour.

| # | item | run | note |
|---|---|---|---|
| B1 | **F45** the four never-heard `$PSET` tokens | `sounds ids:H06,U15,W71,H43,H07,H09 <addr> --audit` | H06 = `missShotHit`, U15 = `emptyUnboundButtonSound`, W71 = `ammoOrGearPickUp` (fires on every pickup in a real game, never heard), H43 = `hitCrit` (a shape pick, not a choice). H07/H09 ride along: they are the confirmed whizz-bys and the obvious `missShotHit` candidates. U15 may just confirm its 2026-09-04 label |
| B2 | **F48** heartbeat for `low_health` | `sounds ids:V06,V16,N74,N75,N25 <addr> --audit` | V06/V16 (today's `voice:hurt_loop`) FIRST as the baseline, then the three candidates. All three are shape picks and must not be trusted on paper (F43). `low_health` is once per life, so a longer clip is affordable |
| B3 | **P3** the defeat line | `sounds ids:JAY,JAW,JAX <addr> --audit` | JAY is the confirmed victory outro; which of JAW/JAX plays as its loss partner |
| B4 | **W4a** Energy Launcher fire sound | `sounds ids:O01,O05,O02,O04,O06,O03 <addr> --audit` | O01 ships. Wanted: an ordnance report that fits the 1600 ms cycle. ⚠ W4a has **no defining row in FOLLOWUPS** — see "Bookkeeping" below |
| B5 | **S-A12.1** sidearms | `sounds ids:P09,Q04,P16,D08,D07,D06,D04,D03,D02 <addr> --audit` | the three pistol fire ids, then the reload chain: does it read as distinct steps or clip together |
| B6 | **S9** the events that failed the walkthrough | `sounds ids:K01,U100,U13,U41,VX0R,VQ8,VX0U,VA7K,V125 <addr> --audit` | `extraction_tick` (K01 ships), `extraction_closing` (VX0R failed), `extraction_complete` (VQ8 failed), `unstoppable` (no line at all), `killing_spree` (VA7K vs V125). Winning ids go into `presentation.EVENTS` + its catalog pin |
| B7 | **S1** the `fx:hit` audit | `sounds category:fx:hit <addr> --audit` | 122 ids, so **two runs** past the 60 cap. Do it last: it is the long tail, and it is the batch that makes every future hit-sound pick honest |

**Not in this block: F44 (the shield hum).** It needs a shield actually up, and no compiled mode can
grant one (F60). See "Blocked on code".

---

## Block C — trigger in hand, one gun, board A as an optional witness (~60 min)

Every rung is the same shape: push one token, read the printed frame, pull ten times, count. Trap 1
applies to every line. Where a rung needs the reload handle or the gyro, it says so — those cannot
use `firemode_probe.py` at all (trap 3).

| # | item | run | read | control |
|---|---|---|---|---|
| C1 | ✅ **DONE 2026-09-09** — the simulated-recoil model is REAL (F46 closed). Do not re-run; the ordering lesson it cost is in *Answered rungs* below | — | — | — |
| C2 | **t6 crit chance** (no id yet) | design already written: same sheet §t6, ~10 min. `firemode_probe.py <addr> assault_rifle 7=100`, then 50, then 0 | victim `$HIR` tok6 (the crit bit) and applied damage: 9 vs 18 with `$GSET` t7=100 | t6=0 opens and closes. 100 giving 0 crits ⇒ try 1 and 255 before calling it inert |
| C3 | **t7-t11 secondary fire** (no id yet) — the per-shot damage-type question | `firemode_probe.py <addr> assault_rifle 8=100 9=5 10=5 11=50`, board A capturing with `native_capture.py sec-t7 COM7 60`. Then repeat under `$GSET` t6=0 vs t6=1 | count captured words **by decoded protocol** — **`WORD` lines only** (trap 5: a stitch invented `proto=4` and `proto=1` during rig qualification, parity-valid). Does a protocol-5 word ever appear, and does its rate move with `$GSET` t6 | t7 empty (every stock frame) as the control: zero protocol-5 words, proving nothing already leaks there. Read on the RIG, not the victim — protocol 5 has no `$SIR` row, so a victim would discard it silently |
| C4 | **1.4 K1** t19=5 on an empty chamber | needs the reload handle ⇒ arm with `bench_common.arming_frames` + `BMAP` + `$SPAWN` + `spawn_tail()`, `firemode_probe.py <addr> assault_rifle 20=5` (**raw 20** = doc t19) → it disconnects → `$PY -m brx_mcp listen <addr> 60`, then empty the mag and pull on empty | does `$ALCD` mag climb on its own after firing dry and pulling again? | run **t19=0 first**, empty it, confirm NO auto-reload, then flip to 5 in the same session. Only the fire-triggered case is open; the idle case is answered |
| C5 | **1.7 t37/t38 overheat** — *which* is threshold, *which* is cooldown (only the transplanted pair 20/150 has ever been proven, never varied independently) | probe A `firemode_probe.py <addr> smg 38=5 39=150`, probe B `… smg 38=20 39=5`. Each: push → it disconnects → `listen <addr> 60` → hold the trigger to the same point | `$ALCD` token 5 (raw heat, >100 at overheat) from the session log — there is no HUD surface for heat | closing run pushes t37/t38 **empty** again: token 5 must read inert for a full mag, ruling out gauge drift |
| C6 | **1.8 U4/U5** | **full arm** (the reload handle is button 2 — `firemode_probe` cannot do this) with MC's **compiled** AR, not `bench_common.AR`. Pull the handle, stopwatch it; then hold the trigger and listen | U4: `$BUT,2`→`$ALCD` refill vs the catalog's **`reload_ms`** (1400 for the AR). U5: does the fire sound retrigger cleanly per shot at the true 140 ms cycle, or ring under | repeat the reload 2-3× before trusting one number. This calibrates the method C9/D9 reuse |
| C7 | **S-A12.2** pistol cadence | `firemode_probe.py <addr> glock` / `usp` / `deagle`, catalog frames as-is; push → disconnects → `listen <addr> 60` → hold the trigger | `$ALCD` interval per pistol vs fire_ms (glock 150 / usp 200 / deagle 375); does it ever fire >1 per pull; USP-S (t25=2/t26=50, no flash, half loud) against the Glock by eye and ear | fire the AR first: t20=7 is already protocol-proven, so the AR validates the RIG, not the mechanism. All three pistols are `verified: false` today |
| C9 | **A10 Quick Hands** | **full arm** (the reload is handle-triggered) with the AR frame's **raw 19** (= doc t18) set to 700, halved from 1400 | ears: does the D04→D03→D02→D18 reload chain play out, or get cut off? `reload_mult` halves the number; the sound chain is fixed length | the same chain at stock t18=1400 from C6 as the clean baseline. If it clips, t18 wants a floor at the chain's real length |
| C10 | **A10a** empty secondary, ALT — *the repo contradicts itself here* | **full arm** (button 1 must be remapped, so not `firemode_probe`), primary only, no secondary, no ALT perk. `Compiler.compile()`'s empty-slot-2 branch rewrites the ALT row to `$BMAP,1,100,0,0,99,99,*` so that "ALT is a no-op by construction"; `protocol/brx-protocol.md`'s `$BMAP` note says function 100 with one slot loaded **falls back to reloading**. Only the bench settles it | press ALT: `$BUT,1,1` arrives — does `$ALCD` change (a reload fired) or nothing at all? Then confirm the trigger still fires | press ALT on the UNMODIFIED stock row (`…0,1,99,99,*`) with the same one-weapon kit first |
| C11 | **A10d** Easy Reload | **full arm**; kit the `easy_reload` perk (policy forces no secondary), or by hand `$BMAP,1,97,,,,,*` in place of the default ALT row. Empty the mag, press ALT not the handle | `$ALCD` reload burst — same shape and timing as a handle reload? | pull the reload HANDLE on the same gun immediately before and after, as the known-good baseline |
| C8 | **F39** the real `$SIR` row ceiling ("max 14 recognitions" is a community figure we have never measured) | full-arm a victim with **20 rows on distinct `<protocol,subtype>` cells** — the 10 stock rows plus 10 built from the unused protocol space (4, 5, 7, 12, 14) — each `fn=1` with **a distinct `<soundID>` so the ear names which row fired**. Fire one matching IR word per cell with `ir-emit` | `$HIR` + the `$HP` delta + the right sound on **all 20**, not just the first 10 | the 10 stock rows are the built-in control: if they register and the new 10 do not, that is the ceiling; all 20 registering refutes "14" outright |

---

## Block D — two guns / victim side (~45 min)

| # | item | run | read | control |
|---|---|---|---|---|
| D1 | **F23** — the highest-value single reading in the queue | **the design is already written: do not re-derive it.** [`bench-weap-tokens-discovery-2026-09-04.md`](bench-weap-tokens-discovery-2026-09-04.md) §"applied damage depends on the SENSOR" (~10 min): victim at armour 200, `$GSET` t7=100, a subtype-3 weapon for fn 37 then a subtype-1 for fn 36; 5 shots at the headset dome, 5 at the gun body, one magnitude | `$HIR` tok1 **paired with the `$HP` delta on every shot** | recording the sensor per shot IS the control the two contradicting readings lacked (the 2026-08-27 ×1.0 matrix was rig-pinned to the body; the 2026-09-02 ×2 result did not record the sensor). It also settles the fn 36/37 ×1-vs-×2 dispute. If body hits are ×1 and headset ×2, **a body-shot kill takes twice the rounds we print** |
| D2 | **1.1 K4 + the slot-4 read** — one swing answers three questions | full `bench_common.BMAP` (it has `$BMAP,8,4`), victim armed from `SIRS` (it has all three proto-13 rows), `$GSET` gyroscope=1 (it is). Push, then reconnect with `listen` and swing | on the shooter: does `$BUT,8` appear, does an isolated `$ALCD` with token 3 = slot 4 appear. On the victim: `$HIR,4,13,<id>,<enemy team>,90,…` + the `$HP` delta | **5 swings, expect 5/5 `$BUT,8`.** If `$BUT,8` fires and the victim never gets `$HIR`, that isolates the bug to IR EMISSION rather than gyro detection — a diagnostic split, not a pass/fail. Front dome first (the known case). ⚠ **fix the `_onAmmo` slot-4 guard before this rung** — see "Blocked on code" |
| D3 | **2.2** the halo assassinate | same arming as D2. One swing at the front dome, one at the back | is a back-dome melee a different word, or the same proto-13/mag-90 word with only `$HIR` tok1 differing? Read board A's decoded word, not just the victim's post-decode | the front-dome swing |
| D4 | **2.3 + F28** sensor map at field distance | victim on a stand at ~5 m, sensors masked one at a time, 10 shots each | `$HIR` tok1 per shot, and hit rate per sensor at 5 m | sensor 4 (gun body) at every distance. The map itself is known at point-blank; what is open is whether it survives 5 m (F28 saw 0/69 on the back dome in a real match) |
| D5 | **F26** attribution | two guns, two phones, ten shots | does the `$HIR` shooter field map to `player_num` as `scoring.py` assumes | shoot from a known `$PSET` player id |
| D6 | **0.5 U11′** the status functions — **enemy 8 and 24-28 are DONE** (F73, closed 2026-09-11: fn 28 registers with NO sound, flash or vibration — the row to ship for beacons; fn 8 is silent but still flashes and buzzes; fn 24-27 fire ONE long grenade-ish clip, truncated by the next event). **Still open: enemy 35 and ally 31, 32, 34** | fire enemy 35 and ally 31, 32, 34 at a held gun. ⚠ **The three traps that VOIDED this run the first time, all mandatory:** (1) **`$SPAWN` before every arm** — a gun can latch an IR event and replay it every ~5 s with nothing in the air (F74), which is what produced the "varied sounds"; (2) **ONE row in the table at a time**, and read the `$HIR` protocol back per trial, or you are attributing another cell's effect; (3) **3 ft of separation** — a point-blank emitter corrupts the protocol field and silently lands you in a different cell | what you hear, see, or cannot do — only a human holding the gun can name these | fn 1 (plain damage) and fn 10/11 (heals) as the two known ends |
| D7 | ✅ **ANSWERED 2026-09-10** — holding a hill does NOT change `$ALCD` cadence (a clean null). Do not re-run; see *Answered rungs* below | — | — | — |
| D8 | **F15** rung 9 | **frames already written**: [`bench-flash-control-2026-09-05.md`](bench-flash-control-2026-09-05.md) rungs 9-10, plus a Damage=0 variant `$BHIT,0,1,<enemy team>,0,0,1,0,*` for the flash-only question. `$BHIT` is host→gun self-injection: **no shooter gun needed**. Not on the safe list (trap 4) | native small-LED flash? hit sound? `$HP` drop? any `$HIR` self-echo (probably none — `$BHIT` bypasses the sensor; confirm it explicitly) | after the three shapes, fire a real synthetic IR shot at the same gun and confirm it still registers — rules out `$BHIT` corrupting internal state |
| D9 | **F27** | **full arm** per weapon (handle-triggered, so `firemode_probe` cannot do it): swap the weapon frame, resend `BMAP`/`$SPAWN`/`spawn_tail`, pull the handle, next | `$ALCD` refill timing per weapon vs its catalog **`reload_ms`** (§9's row says `reload_s`, which is not a field that exists) | C6's AR measurement calibrates the method; past that, no stopwatch precision needed |

---

## Block E — eyes, dim room + camera rig (~50 min, one sitting)

Rig: `ledcam.py` / `led_flashcam.py`, ND filter or a sunglasses lens. The hosted-vs-native control
pair from [`bench-flash-control-2026-09-05.md`](bench-flash-control-2026-09-05.md) §6b runs **before**
any rung — a missing control spoiled U2.

- **S2 6b** the flash-LED ladder (baseline `$LED,9,1,1,1,*` should read peak 41-44 / w-sum 135-156;
  native 3-hit baseline peaks ~94 and clips).
- **S10 (a)** a metered A/B of `$HLOOP,2,750` against the native out-blink. The "might be brighter"
  call was one operator, one evening, no meter.
- **S10 (b)** that rate's usable range (750 and 2000 both work; the ends are unknown).
- **S10 (c)** L10 dim 2-of-3 **held 60 s**, then one at a time `$PLAY`, `$AMMO`, `$HLED`, `$LED` —
  the paint must survive each. The render is confirmed; only the long hold is not.
- **S10 (d)** L11 purple `$TID,4`. ⚠ **F35: `$TID` ≥ 4 breaks combat resolution. Revert to 0-3 the
  moment the rung ends.**
- **Night mode** — a blanked gun must stay dark once spawned (only `$SPAWN` re-breathes).
- **S4 (e) + muzzle LED** — does a blink form correctly after a blank; is the muzzle LED separately
  addressable. (S4 **(b)** is closed: a paint held 8 min with no traffic.)
- **4.4** try-out LED strobe: a mode artifact, or does it need a quieting token? Compare directly
  against a real `$SPAWN` on the same gun.
- **4.5** `$PSET` t2/t6 pushed mid-game. Already swept for `$HIR`/`$HP`/`$QUERY` with byte-identical
  output, so **only** ears and eyes can show anything here. Nothing ⇒ record inert.

**Not in this block: B20** (`$LCD` token 3 = shield?) — it needs a shield granted, which no compiled
mode can do (F60).

---

## Block F — space and tape measure (~80 min, its own sitting)

Taped stations at 3/6/9/12…50 ft, reused by all three rungs.

- **2.4 Q16** divergence at 3 m: `$PY -m brx_mcp ir-range COM7 12 10` at 0/10/20/30/40/50°. Closing
  control re-reads 0° and must reproduce the opening.
- **IR range, real guns vs our emitter**, per weapon and indoor/outdoor. Incoming: board A, you fire
  a real gun per station. Outgoing: `range_step.py <victim> <label> COM8 10 COM7`. Cycle weapons with
  `weapon_range.py <addr>`. The run sheet exists at `archive/hardware/range-experiment.md` and its
  data table is **blank** — it has never been run.
- **Grenade beacon range** (~18-20 ft, and off-axis): `native_capture.py <label> COM7 <secs>` per
  station, grenade in RESPAWN, untouched.

## Block G — grenade (~60 min, its own sitting)

All receiver-first: run board A alone before involving a gun (that is how the Respawn words were
found). Commands are already written in [`bench-grenade.md`](bench-grenade.md) §§0-1 and §5.

- ✅ **3.2 DONE 2026-09-10 — the hill is a full KotH primitive** (F70). Do not re-run; see *Answered rungs* below.
  REAL HILL / boxed-SILENCE / REPLAY / ENEMY phases. The boxed phase is the built-in control.
- **§8 captures**: the Hill/Assault/CTF/Frag mode words, the RF scan, and a headset-mounted capture
  of the three unexplained emissions.
- **G10** `$GREN` `GrenadeType`: push each value to a gun, diff the captured word's bits. Control is
  the same frame with `GrenadeType` empty.
- **G9** CTF flag team assignment is **capture-then-hypothesise** — pull Jay's CTF videos first;
  there is no confirmed `$GREN` channel behaviour to test yet.

## Block H — the MacBook / capture day

- **Q15 super-indoor** has its own sheet,
  [`bench-super-indoor-2026-09-07.md`](bench-super-indoor-2026-09-07.md), and it is **entirely
  outstanding**. It needs its own plumbing pass first (pyserial, `/dev/cu.*`, the CH34x driver) —
  do not fold it into the Windows-rig blocks.
- **P8, P3, P12, G3** — batch the Mac + iPhone PacketLogger captures ([`capture-runbook.md`](capture-runbook.md)).
- The Facebook re-scrape is **not** a capture job: it is a browser crawl from the dev machine and
  does not belong in this block.

---

## Blocked on code — do not take these to the bench yet

| item | what has to land first |
|---|---|
| **F44** shield hum · **B20** `$LCD` token 3 · the teal shield bar · A16.5's shield→armour handover | **F60**: no compiled mode ships a proto-1 row, so a medic word is discarded silently and the shield pool can never be filled in one of our games. `fn 10` is a known heal and `_SIR_GRANT` is fns 9-22, so the row is buildable — it is a decision plus a few lines |
| **D2 / K4** melee | the slot-4 guard in `engine.js` `_onAmmo`: an isolated `$ALCD` with slot 4 currently sets `activeSlot = 4`, overwrites `ammo`/`mag` from the melee slot (maxClip 1), and can count a swing as a shot. Fix it, and mirror it in `stage.py`, or the swing corrupts the HUD you are reading it on |
| **F21** the display-corner inset | a new APK carrying A16/A17. Checking it on 0.1.7 checks stale UI |
| **F26** attribution · **S7** dead-player rejoin and gap-death re-arm | **F36**: 0.1.7 is cut, published and advertised, but **no build since 0.1.6 (2026-09-04) has ever run on a phone** — and 0.1.7 is the build carrying the S7.1 rejoin anti-cheat these two rungs would be testing. Install it on both phones first, or you are bench-testing code that was never deployed |
| **P15** the alarm id | a candidate shortlist. There is no "alarm" category in the catalog; the only repo hit is `deathAlarm`, a different thing. This is a data search before it is a bench item |
| **A10c** Extended Mags HUD max | nothing — but it is not bench work either. `loadout.md` defines `verified` as "effect proven on hardware", which the ×2 mag/reserve is; whether the **HUD's** max matches the `$AMMO,0` we write is a HUD-vs-bundle check the stage harness can do with no gun |

## Decisions — keyboard, no gun, ~10 minutes for the seven still open

These sit in §9 today but none of them needs hardware.

1. **Energy Launcher deals zero damage in every shipped game** (`$SIR,9,3,,24` is a status row):
   flatten `_SIR_TABLE`, or retune five weapons?
2. **F60**: does a heal/grant row belong in the compiled table at all, or is shield permanently
   node-granted? (Saying "no medic words in a hosted game" is a valid answer — but say it, because
   today the gap is silent and reads as a bug from the bench.)
3. **Q12′**: should `hit_taken` carry the shield delta as its own field? Both prior sessions said yes.
4. **Q13**: friendly fire is invisible on the wire. Run FF on and score teamkills as policy, or
   accept no teamkill feedback? Decide before any mode advertises it.
5. **F5**: the AR at 140 ms / reserve 192 (balance), or 100 / 384 (stock feel, which deletes
   `test_ttk_band_and_no_strictly_dominant_weapon`)?
6. **F20**: kill confirm during a reload deferred until the takeover ends (~2 s) — keep?
7. **F25**: the kill strip says "CONFIRMED BY MISSION CONTROL" — keep, or "ELIMINATION"?
8. ~~The single-hue 4-state bar.~~ **Decided 2026-09-09, do not re-open** (`HANDOFF.md` next-action 3,
   recorded in `led-language.md`): a partial level KEEPS its loop-blink, because on a single-hue pool
   that blink is the only thing separating adjacent levels — dropping it would collapse armour and
   shield from seven levels to four. Healing also gets no opening beat: a gain steps up immediately,
   and that asymmetry against a hit is the signal. Seven decisions remain.

## Answered rungs — kept for the LESSON each one cost, not for re-running

Four rungs in the tables above are done; their rows there are one line each now. What is worth reading is why
three of them gave the WRONG answer on the first attempt. The findings themselves live in
`experiment-log/2026-09.md` and, where they are wire facts, in `protocol/`.

- **A1 ✅ 2026-09-09 — `$LIFE` takes negatives, `$BUMP` is inert** (F61 closed; F64 and S16 opened; three
  `brx-protocol.md` rows corrected). ⚠ **Ordering lesson: run the NEGATIVE first.** On a full pool an
  additive-clamped write cannot move, so a `+5` control proves nothing until a negative or a real hit has
  depleted the pool. `$BUMP` — the command the rung was written around — turned out to be the inert one.
- **C1 ✅ 2026-09-09 — the simulated-recoil model is REAL** (F46 closed; F66/F67/F68/S17 opened; t21/t22
  promoted to bench-proven; `$ALCD` token 2 relabelled as live accuracy). ⚠ **Ordering lesson, the important
  one: the first three rungs fired SINGLE SHOTS 2 s apart**, which is maximum recovery time and never switches
  the feature on. They gave a clean A-B-A control and the wrong answer. **Sustained fire is the condition.**
- **D7 ✅ 2026-09-10 — holding a hill does NOT change `$ALCD` cadence** (the "KotH rate-of-fire buff", a clean
  null): 102.0 ms/round hill-owned vs 101.6 ms/round enemy-held, and the hill flipped teams mid-burst with no
  cadence change, so the control sits inside the single measurement. ⚠ **Method: count `$ALCD` DECREMENTS,
  never trigger pulls** — under this gun's fire mode 14 one press sometimes releases two rounds. ⚠ Hosted-only:
  a native game drops the BLE link, so this does not disprove a native buff. The node-side boost is **F87**,
  gated on `bench-grenade.md` rung Z.
- **G 3.2 ✅ 2026-09-10 — the hill is a full KotH primitive** (F70). The wire is documented once, in
  `protocol/brx-ir-protocol.md` §"The grenade beacon"; the rung index and what is still open are in
  [`bench-grenade.md`](bench-grenade.md). Hazard **F69** (a hill's ordinary `proto=0` damage word) opened here
  and is still 🔴.

## Bookkeeping

*Re-checked against `FOLLOWUPS.md` on 2026-09-11; the items that were fixed are struck rather than
deleted, so the guard blind spots they exposed stay on the record.*

- ~~**W4a has no defining row in `FOLLOWUPS.md`.**~~ ✅ **FIXED** — W4a now has its own row in §6, and the
  row itself records why it went missing. The BLIND SPOT stands and is the reason to keep this line:
  `test_followups_ids_are_defined_exactly_once` only flags an id **defined more than once**, never an id
  **referenced with no definition at all**, so nothing could have caught it. Worth a second assertion.
- **A second blind spot in the same guard, found 2026-09-11:** it recognises a definition by its STATUS
  MARKER, and five rows wrote the word `decision` instead of one — so **F5, F20, F25, Q13 and Q12′ were
  invisible to it**. They now carry a marker as well as the tag, but the guard would still miss the next
  row written that way.
- ~~Closed rows still sitting in §9, safe to strike: **F37**, **F38** …~~ ✅ **DONE** — F37 and F38 were
  archived 2026-09-10; **F35**, **F73** and **F96** followed on 2026-09-11. S10's "L1-L9 and L12-L14
  ANSWERED" clause, S10's verified state-by-state list, **S4 (b)** and **2.1 Q15** are deliberately kept:
  each one is a *narrowing* of a still-open item, not a closed item.
- Not hardware, and misfiled in a bench queue: **F47** and **F53** (`build`), **F43** (a methodology
  warning, not an experiment), **A10c** (stage harness). Still true; they are in FOLLOWUPS §0's
  keyboard-only lane.
