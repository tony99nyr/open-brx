# Handoff — Open BRX

**State as of 2026-09-16.** The 2026-09-13 evening playtest is written up. It is the largest batch of
root-caused field defects we have had, and **four of them are 🔴**. Nothing was fixed in this pass: it is a
documentation handoff. Sheet: [`game-test-2026-09-13.md`](game-test-2026-09-13.md). Ids: **F206-F216**.
Evidence is committed, sanitised, at
[`evidence/2026-09-13-session-3782dc77/`](evidence/2026-09-13-session-3782dc77/) (heads, acks, event timeline,
status stream, node logs + the `extract.py` that rebuilds them).
Separately, contract-DRY phases 1-3, all five F42.9 batches, F42.12 and F42.14 are implemented, reviewed and
validated (log entries dated 2026-09-15/16); only the coverage/runtime-input audit remains.

## The four criticals, in the order they should be taken

1. **F206 — team modes register nothing.** A TDM match fired **116 shots** and recorded **zero hits and zero
   deaths** in 42 s, while two FFA matches on the same two guns in the same half hour registered normally.
   Teams were pushed correctly. The only variable across the three compiled heads is `$GSET` **t1
   `friendlyFire`**: ON → hits, OFF → nothing. `compile.py:978` is `friendly_fire=(mode == "ffa")`, so **every
   team mode we ship sends the value that registers nothing.** This is **F49** (bench, 2026-09-07) reproduced
   in a game — and the store says where the mismatch is: all 38 hits read **`shooter_team: 0`** while both
   shooters were on **`$TID,1`**, where protocol §5 says `$HIR` t4 is the shooter's effective `$TID & 3`. **The
   emitted word is not carrying the team we set.** (⛔ not `$PSET` t2 — bench-proven inert.)
   **First rung, two guns and five minutes:** `$TID,1` vs `$TID,2`, friendly fire ON so a hit must register,
   read `$HIR` t4 back. If it is 0 both ways, F206, F49 and Q13 collapse into that one fault — then re-send
   `$TID` right after `$SPAWN` and read it again. **Leading suspect:** we send `$TID` as the last head frame
   and `$SPAWN` arrives later carrying A23's `$SIR` re-arm, with nothing re-sending `$TID`; §3 already notes
   `$SPAWN` clears a painted LED colour. If that is it, the fix is one frame.
2. **F207 — the START echo refusal is a false positive on every gun, and it is ours.** Mag right every time,
   reserve exactly half every time, on three weapons — and the half is **the t40 value MC itself wrote into the
   same `$WEAP` frame** (`tok17 == 2 * tok40`). The gun's `$ALCD` reserve mirrors t40; `frames.py` compares it
   to t17. **This answers F201.** Fix compares against `t17 // 2`, with a test built on a real captured head —
   `test_mc_config_proof` proves the check against MC's own synthetic frames, which is why it stayed green.
3. **F208 — a gun can die with the HUD holding the player alive, and nothing recovers it.** 105 seconds of
   byte-identical status (`alive=True … src=gun`) while the frame ring shows the trigger being pulled and
   nothing firing. There is **no staleness detector on the pool anywhere**, and the operator's only exits are a
   whole-lobby RE-PUSH or ending the game. Tony ended the game. **F212** (`respawnGate:"trigger"` under an
   `auto` config) is the probable second half.
4. **F209 — the respawn delay is not a delay.** Five deaths and five respawns inside one second in a game with
   `delay_s: 5`; hits landing +1.6/+2.9/+3.0 s after a respawn. First field look at **F121/A23**'s spawn
   protection, whose bench gate has never been run. Hit reception returns before the trigger does.

## What the same session proves is FINE

- **`$GSET` t2 was 0 in all three heads** (the 2026-09-13 14:04 pin was in the running MC; `DRIVE_IO_MODE` was
  `"off"`), and **outdoor FFA registered at an indoor-comparable rate.** The 2026-09-12 "everything outdoors is
  unplayable" pattern did not recur — the t2 fix held up in a real game. It is **outdoor** evidence only:
  **F198**, the indoor phantom-hit question, is untouched and t2 stays pinned at 0.
- **Team assignment is correct.** MC pushed the right `$TID` to the right gun and both phones advertised the
  right team. F206 is about what the gun does with that, not about who was on which side.

## The rest of the batch

**F210** HUD loops if connected before the headset (uncaptured, needs one repro) · **F211** the HUD never
checks whether Bluetooth is off, so the picker silently stays empty · **F213** the HUD shows armour above its
own max (120 vs 70) for anyone carrying `body_armor` · **F214** the heavy breathing still follows the death
scream, and the ring proves `$PLAYX,0,*` IS sent — pair it with **F158** in one bench run · **F215** the
sniper's extended-mags reserve: the store can no longer settle 48-vs-24 now that we know the echo field is a
mirror, so fire one dry and count (that also settles **A10c**) · **F216** the dead/awaiting-respawn flash while
alive — do not chase it until F209 and F208 are fixed.

**F203 was seen a second time:** a phone opened the session on a remembered, unreachable MC address, burned 14 s
on five reconnects and a `no welcome within 10000 ms`, and was rescued only by a QR scan.

## Validation

None run for the playtest write-up, which changed only `docs/`. Contract-DRY validation is in its log entries. Anyone touching code next should run the four suites per
`CONTRIBUTING.md` → *Running things*.

## Next actions

1. Take F206 first. It is the one that makes half the mode catalog unplayable, and the rung is cheap.
2. F207 is keyboard-only and unblocks arming in the field; do it in the same sitting.
3. Then F209 + F208 + F212 together — they are one story about what a life looks like.
4. Tony still owes the bench F198 (indoor, t2=0, watch for phantom hits) and F170 (hosted vs native at the far
   mark). Neither moved this session.
5. Complete the contract-DRY coverage/runtime-input audit.

**Machine roles:** WSL runs the Python suites and no-hardware MC; Windows Python is for BLE instruments; the
MacBook is the field target. Never modify stock firmware.
