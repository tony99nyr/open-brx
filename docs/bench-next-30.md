# Next bench session — 30 minutes

Written 2026-08-27 after the Supremacy session. **The rig is already set up and verified** — board A
(`5C93045958`, COM7) is the receiver with the **fixed** capture sketch (RAW toggle), board B
(`5C4C136487`, COM8) is the emitter. Nothing to build.

**Do them in this order.** Item 1 is worth the whole session on its own.

---

## 1 · Capture the native Sentinel EMP ability  ·  10 min  ⭐ THE STUN ANSWER
**Why this is first:** we have spent two sessions guessing which `$SIR` function is a stun and got it
wrong twice. **BRX already knows.** The Sentinel's EMP is a native firmware ability — capture the word
it emits and the protocol/subtype are simply *told* to us. We tried this earlier and the frames were
produced **no decodable word** — raw IR arrived in that window but nothing assembled, so we cannot
yet say the ability emits IR at all. The splitting bug that would explain it **is now fixed**
(`IDLE_GAP_US` 30 ms + RAW off).

1. Native **Supremacy**, play **Sentinel**. Receiver ~1 m in front of the muzzle.
2. I open a capture (RAW off).
3. **Fire the EMP ability 3–4 times, ~6 s apart.** Nothing else — no normal shots, so nothing to confuse.

**Pass:** a complete 25-bit word whose **protocol** is not 0 (evidence so far points at **protocol 8**).
⚠️ **This pins the protocol but NOT the effect** — the effect is decided by the *victim's* `$SIR` row,
which we cannot read from a native game. So this narrows the search; item **2b** is what actually
closes it.
**If it decodes as a 28–32 bit word instead:** the ability uses the **accessory format** (like `$GREN`),
which is a finding in itself — abilities would live on a second protocol we barely know.

## 2 · ~~Capture a `$GREN` accessory word intact~~ — ❌ DONE UNATTENDED, NEGATIVE
Swept every `$GREN` field with the splitting fix in place and a clean baseline: the emission decodes to
**all-zeros at varying lengths and does NOT track the arguments**. `$GREN` is not a programmable
emitter. **Skip this — replaced by item 2b.**

## 2b · Trigger-test the remaining status functions  ·  10 min  ⭐ the only way to detect a stun
**Why this replaces the `$GREN` item:** a stun that only stops the victim's trigger is **invisible to
every instrument we have** — it moves no pool and emits no BLE frame. That is exactly how fn 23 fooled
us. The only detector is a human pulling a trigger.
I arm `$SIR,<p>,0,,<fn>` for each remaining candidate (**3, 8, 24, 25, 26, 27, 28, 35**), fire it at you,
and **you try to fire immediately**. ~1 min each.
**Pass:** any function where the trigger genuinely does nothing ⇒ **that is the stun, U11 closes.**
**All nine fire normally ⇒ no `$SIR` function is a stun**, and category 10 needs a different mechanism —
also a real answer, and it would close a hunt that has now cost three sessions.
Same splitting bug hid this one. I drive `$GREN` over BLE, receiver watching.
**Pass:** one unbroken word of **≥28 bits, identical across ≥3 repeats** (the earlier 28/32 figures came from *split fragments*, so treat the exact length as unknown until a whole frame lands). Then sweep `iRType / operationMode /
channel / GrenadeType` — **if the bits track the arguments, the gun becomes a programmable emitter.**

## 3 · P13 — the `$GLED` colour index  ·  10 min  ·  needs your eyes, dim room
Now has a sharper target: native life-mode shows **purple while the protective pools have charge, then
switches colour** when they empty. ⚠️ Tony's own correction: the second colour was **blue, and Nexus is
the blue faction** — so it is probably the **faction** colour, not a health colour. **Cheap decisive
test: run the same observation on a RED or GREEN faction character.** If the second colour follows the
faction, colour = team and the gauge is **segment-count only**.
Mid-game I sweep `$GLED,<n>,0,0,1,2000,2000,*` for n = 0…8, one at a time; **say the colour you see.**
**Pass:** a stable n → colour map, with purple and blue identified.
**Then P17 in the same breath:** try `$GLED,0,4,0,0,0,,*` (StopIR), all-zeros, and brightness 0 —
**pass = the LEDs actually go dark.** If none work, night mode cannot darken a gun and
`GameConfig(leds=False)` is lying — that is a real answer too.

## 4 · If time remains — K4 melee  ·  5 min
In **our** compiled game: select **slot 4** and swing hard. Watch for **`$BUT,8`** (we confirmed `$BUT`
streams) and `$HIR,…,13,…` on a victim.
`$BUT,8` + IR ⇒ never a bug · `$BUT,8` no IR ⇒ slot-4 firing · no `$BUT,8` ⇒ the gyro mapping isn't live.

---

## Ground rules — the short list (full lore: [`gotchas.md`](gotchas.md))
- **Never fire toward the bench receiver.** Your own IR reflects back onto your own headset — it drained
  your armor, killed you mid-window and left the gun dead. Cost 3 runs.
- **RAW dump OFF for any capture that matters** (send `r`). It is a debugging aid; at 115200 its ~15–20 ms
  print splits back-to-back frames. Cost 4 runs.
- **Check the baseline is non-zero before reading a result.** A control that is merely *present* is not
  a control.
- **Power-rest the guns** between sessions.

## Do NOT re-run
fn 23 (audio suppression, measured twice) · the fn 24–27 damage claim (withdrawn, did not reproduce) ·
protocol-dependence of the function map (none — identical on 5 and 7) · K3 the death nova (captured:
proto 10, MAG 125, credits the corpse) · LED life-mode *behaviour* (the segmented-gauge observation stands; the colour SEMANTICS are open — see above — and the driving token is open).
