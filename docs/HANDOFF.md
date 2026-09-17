# Handoff — Open BRX

**State as of 2026-09-17.** The garden range test ran off the MacBook and produced a protocol finding:
**`$WEAP` token 2 is `gunRangeOutdoor`, the emitted-power control**, and the token the catalogue and MC
have been reasoning about (t41 `gunRangeIndoor`) **does nothing in outdoor mode**. Write-up:
`experiment-log/2026-09.md` (2026-09-17 afternoon). Capture:
`~/.brx-mcp/captures/range-t41-2026-09-17-victim-b.jsonl` (2220 lines, not in git). Ids: **F231-F234, S48**;
**F170 closed**. The 2026-09-13 playtest criticals (F206-F209) have not moved.

⚠️ **Two commits earlier the same day (`61b1074e`, `e20c7136`) recorded this finding against t41 and stated a 10 m
drop-off at t41=5.** That is the t2 result written against the wrong token; the t41 A/B showed no drop-off at any
distance. The Q15 row now carries the correction, and the per-venue targets in it still stand — only the token moved.

## What the range test settled

1. **`t41` is inert outdoors — Q15's lever 1 is a null.** Two slots differing only in t41 (5 vs 75), everything
   else identical: **27 of 27** low-range shots hit from 3 m to 200 ft, against 55 of 57 for stock. Counted off the
   mag walk, not inferred. Every hit in the run read sensor 0 (front dome), including at 2 m.
2. **`$WEAP` t2 `gunRangeOutdoor` is the real control (F231).** t2=5 landed **0 of 38** including muzzle-on-dome;
   t2=100 (stock) reaches 200 ft. Between: a floor, a transition roughly **13-26**, then a flat shelf from ~31 to
   100 where everything behaves alike at any distance we can pace. Every gun in the catalogue ships t2=100, melee 90.
3. **F170 closed.** A hosted head with `$GSET` t2=0 landed 12 hits at ~200 ft — the far-mark result the 2026-09-13
   handoff never recorded.
4. **`RANGE_ENV_OVERRIDE` is pointed at the wrong token (F234).** `mc/compile.py` has the venue→range plumbing
   already staged as a no-op, wired to t41. It should be t2, once F231's re-run says what value.

## The two things that make today's numbers provisional

- **The receiving dome sat in DIRECT SUN for the whole hour, and the sun moved.** F162 already says outdoor
  reception is light-sensitive. Misses came in **streaks of 5-6**, which is a threshold drifting, not per-shot
  randomness. Every sub-30 figure is a lower bound. **Re-run the ladder with the dome shaded.**
- **The first two trigger pulls are weaker than the rest (F232).** Tony, unprompted and repeatedly. Every group
  today was 5 or 10 rounds, so the first two of every group were handicapped — worst at low t2, where a weak shot
  falls under threshold rather than merely landing softer. **This invalidates short-group sampling for any IR-power
  work**, including most of the F231 ladder.

## What is NOT answered

Whether t2 can fence a weapon to a chosen distance. Above ~31 the cone at 30 m was barely different from the t2=100
control and 37/41/42/45 all land at 40 m on careful aim; below the transition it is genuine attenuation (13 gave 3/8
at 15 m on *precise* aim). Tony's field judgement is that range is clearly affected. Unresolved until the shaded
re-run — so **do not put per-weapon range into the catalogue yet**. The shotgun value, if it exists, is between 22
and 31.

## Next actions

1. **Re-run the F231 ladder properly**: dome shaded, full 32-round mags, discard the first two shots of every mag,
   one t2 value per mag, fixed marks. That single run decides F231, F232 and whether S48 ships per-weapon or as a
   venue-wide master.
2. **Promote t2 to `docs/manual/dev.md`** beside the t41 row, and name it in `weapmap.py` FIELDS (it is currently
   `(scale/const)`).
3. F206 still first among the playtest criticals. One free data point from today: `$HIR` t4 carried the shooter's
   team correctly on several hundred hits with `$TID` sent before `$SPAWN` and friendly fire off — which does **not**
   support F206's leading suspect. Not chased.
4. F207 is still keyboard-only and unblocks arming in the field.
5. Tony still owes the bench F198 (indoor, t2=0, watch for phantom hits).

## Gun state

Victim `Tactix-3D4F`: torn down correctly (`$CLEAR` then the `$SIR` row), armed and hittable. **Shooter
`Tactix-E20D` went out of BLE range before its teardown landed** — it still carries the t2 18/22 test slots. Its
`$SIR` table was never cleared so it is not in the F11 state, but **re-arm it before real use**. The advert prefix is NOT `Tactix-`; only the
four-character tail identifies a gun.

## Validation

None run — this session changed `docs/` only, plus a `mcp/` note in F234 that is not yet implemented. Anyone
touching code next should run `npm run test:all` per `CONTRIBUTING.md` → *Running things*.

**Machine roles:** WSL runs the Python suites and no-hardware MC; Windows Python is for BLE instruments; the
MacBook is the field target and ran this session. Never modify stock firmware.
