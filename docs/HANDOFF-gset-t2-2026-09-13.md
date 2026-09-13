# Handoff: `$GSET` token 2 (`outdoorMode`) cripples hit reception

**Filed 2026-09-13 from the field, by the session that found it. Not fixed. Do not close without a bench check.**

## The bug

`GameConfig._gset()` (`mcp/brx_mcp/gameconfig.py:436`) ships:

    $GSET,<friendlyFire>,<outdoorMode>,1,0,1,0,<crit>,1,*

`outdoorMode` is token 2, fed from `compile.py:981` (`outdoor = config["environment"] == "outdoor"`).
So an OUTDOOR game sends `t2=1` and an INDOOR game sends `t2=0`, in every head, to every gun.

**At `t2=1` the gun barely receives hits.** Registration collapses to roughly one shot in ten and only
works from a few inches. At `t2=0` the same gun registers normally.

## The measurement that proved it

Same shooter (its own config unchanged), same target headset, same aim point, same spot, same afternoon,
minutes apart. One variable: the venue field, which is the only thing that moves `t2`.

| `t2` | Result at 30 ft |
|---|---|
| 1 (venue outdoor) | a full clip, **0 hits**. Only registers from inches. |
| 0 (venue indoor) | **16 hits in 27 shots**, two kills, then "I can hit every single shot now at 30ft". |

## Why it hid

- **The stock phone app never writes this field.** A tagger left native registers hits at ~200 ft all day.
  Every "native works, ours doesn't" reading is this. It reads as the *shooter* having no range, because the
  fault is on the *receiving* gun, so every test aimed at the shooter comes back clean.
- **Indoor venue sends 0**, so indoor games always worked. **Outdoor venue sends 1**, so outdoor games failed.
  That is exactly the 2026-09-12 field pattern: free-for-all indoors fine, everything outdoors unplayable.
- **Point blank still works** at `t2=1`, because at inches the infrared floods every receiver anyway. That is
  why the night's report was "we couldn't hit each other from 30-40 ft, point blank worked".

## What the repo currently says, and what is wrong with it

`protocol/brx-protocol.md` §3 describes t2 as "`outdoorMode` … the APK's name for the on-gun ALT-hold toggle"
and lists it as one of two candidates for the venue's **emitted IR range**, marked unmeasured.

Both halves of that are wrong and should be corrected with the fix:

1. **It is not the ALT-hold toggle.** The physical toggle was measured separately the same day on three guns:
   it changes beam WIDTH (roughly double the aim tolerance outdoors) and does **not** gate reception. A gun in
   native indoor mode still takes hits at ~200 ft.
2. **It does not move emitted range.** It gates **hit reception** on the gun that receives it.

## The fix

Stop sending 1. Ship `t2=0` at both venues until the field is characterised:

    return (f"$GSET,{int(self.friendly_fire)},0,1,0,1,0,"
            f"{int(self.crit_modifier)},1,*")

Needed with it:

- A test pinning t2 to 0 for both venues, so nobody "restores" it to the venue flag later. The comment must say
  why, or this reverts the first time someone tidies it.
- `compile.py:981`'s `outdoor=` flag still feeds the volume and other venue behaviour; only t2 changes.
- **`docs/spec/` and the venue reminder need revising.** The ALT-hold reminder shipped 2026-09-13 tells the
  operator to set every gun to outdoor, justified by a range theory that is now disproved. The reminder still has
  value (wider aim tolerance outdoors) but its stated reason is wrong.
- Correct the two protocol claims above.

## Still unknown, worth a bench pass

- What `t2=1` physically does. Receiver attenuation? A decode threshold? Nobody knows.
- Whether it affects the gun-body sensor and the four headset domes equally.
- Whether any value other than 0/1 is meaningful.
- Whether the gun's own ALT toggle interacts with it now that we know they are different fields.

## Evidence

Full working notes, including the three-gun measurements that ruled out range, the toggle, the weapon range
token and the emitter: the 2026-09-13 entries in this session's evidence file, and the session store at
`~/.brx-mcp/mc/session-f814f790.sqlite` (envelope kinds `hit_taken` carry the sensor that answered each hit).

## The likely design intent, and why the fix may want to be an inversion (operator, 2026-09-13)

Tony's reading, and it is better than treating the field as broken: **low sensitivity is probably deliberate,
and it is probably for INDOOR play.** Indoors the beam reflects off walls and ceilings, so a deliberately deaf
receiver rejects phantom hits from bounced shots. Outdoors there is nothing to reflect off and you want every
bit of sensitivity you can get.

If that is right, the field is working exactly as designed and **we simply had the polarity inverted**: we sent
the reflection-rejecting value outdoors, where it costs range and buys nothing, and the sensitive value indoors,
where reflections are the problem it exists to solve. The APK field name `outdoorMode` would then be wrong, or
at least the sense of it is opposite to what the name suggests.

**This changes the recommended fix.** Pinning t2 to 0 is correct as an immediate measure, because maximum
sensitivity is never wrong outdoors and the worst case indoors is some reflected hits registering. But the
better end state is probably:

    indoor  -> t2 = 1   (reject reflections)
    outdoor -> t2 = 0   (maximum sensitivity)

which is exactly the inverse of what shipped.

**Do not make that change without bench evidence.** The test is to play indoors at t2=0 and see whether phantom
hits from reflected shots appear — hits with no line of sight, or hits registering on players nobody aimed at.
If they do, invert as above. If they do not, leave t2 pinned at 0 everywhere and the field is simply one we do
not want. Filed as a follow-up; it is the only question this handoff leaves open that changes the code.

## NOT POLISHED — owed before this is considered done
This fix was made in the field under time pressure and has had **no polish-loop**: no review lenses, no
adversarial pass, no UX/field-safety review. It is a one-line pin plus repinned tests, validated only by the
Python suite (1818 passed) and one operator measurement. Run the loop over it, and specifically check:
the venue reminder's now-wrong rationale, `docs/spec/` and `protocol/brx-protocol.md`'s two incorrect claims
about t2, and whether any other code path still reads `self.outdoor` expecting it to reach the wire.
