# Bench plan — what needs Tony (updated 2026-08-28)

Built overnight from the IR session. **Everything in here is blocked on a human**: a trigger pull, an
ear, an eye, floor space, or the grenade. Everything that could be cracked from the keyboard already
was — see `docs/experiment-log.md`, 2026-08-26 **and 2026-08-27** entries.

**This is the subset that needs a human.** For the whole board — including what's blocked on a capture,
on unwired hardware, or on a decision — see [`unknowns.md`](unknowns.md).

**Ordered to minimise re-rigging.** Do a whole group before moving to the next; the rig change between
groups is the expensive part, not the tests.

## Before you start (5 min)
- **POWER-REST first** — the fleet ops rule. Use guns that have been off; Tactix-FE30 ran all night.
- **Headsets ON and settled** or the gun silently refuses to join.
- Rig: **board A (`5C93045958`) = receiver** (VS1838B → GPIO4), **board B (`5C4C136487`) = emitter**
  (2N2222A + LED → GPIO5). Flash from the **UART** port; see `hardware/esp32-ir-bridge/README.md`.
- Close the Arduino Serial Monitor — Windows ports are exclusive.
- **Aim matters**: attenuate for loopback (the VS1838B saturates point-blank), and fire spaced ~1–2 s
  so the capture sketch's RAW print doesn't truncate frames.

---

## ⚠️ READ FIRST — team gating changes how these tests must be run (2026-08-27)

**Every IR shot must be fired from the correct SHOOTER TEAM or it will not register at all.**
Bench-measured: the receiver discards a frame whose team is wrong for the function's polarity, and
emits **no `$HIR` whatsoever** — a wrongly-teamed shot is indistinguishable from a broken rig.

| you are testing | fire from |
|---|---|
| damage, armour-pierce (fn 1, 2, …) | an **enemy** team (victim on `$TID,1` ⇒ shoot as 0/2/3) |
| heals, shields, armour, respawn, any grant (fn 9, 10, 11, 13, …) | the **victim's own** team |
| an unknown function | **both**, and compare — this is how you learn its polarity |

This voided several earlier negatives (fn 24-27, and the stun hunt across 3/8/23-28/35) which had all
been fired from an enemy team only. **If a test below says "no effect", check the team before
believing it.**

---

## GROUP 0 — settle what blocks published numbers (~25 min) 🎯

| # | Goal | Do this | Pass |
|---|---|---|---|
| **0.1** | **Settle the DISPUTED fn 36/37 multipliers** — two of our own datasets disagree (x2 vs x1.0) and four hypotheses were tested and refuted. Until this is resolved, **every weapon mapped to fn 36/37 may be dealing base damage** and we must not publish x1.25/x2 | Fire a **real BRX weapon** known to use fn 36/37 at a victim. Compare **`$HIR` token 5** (raw magnitude) against the applied **`$HP` delta** | delta = 2 x tok5 ⇒ multiplier real, our emitter path is at fault · delta = tok5 ⇒ the x1.25/x2 claim is wrong. Either way it reads off stock hardware with **nothing of ours in the signal path** |
| **0.2** | **Re-aim the emitter at the receiver** so loopback capture works | Point board B's LED at board A's VS1838B, **attenuated** (it saturates point-blank). Then `TX` any word and confirm a DECODE line | a decoded 25-bit word ⇒ we can verify transmitted words over the air, not just in software. Currently the two boards cannot see each other at all |
| **0.3** | **Does the SENSOR STRUCK change the applied function?** The single cheapest test for the two results that would not reproduce (fn 36/37 ×2, and fn 24 damaging in an operator-held run). **Note the protocol framing is dead** — a 50-cell matrix showed the function classes do not vary across protocols 0/5/7/9/10, so the difference is not the protocol. **20/20 of my hits landed on `$HIR` tok1 = 4, the gun body** — this rig cannot produce a dome hit at all; a held gun is struck at a different angle | Fire the **same word** twice: once at the **headset dome** (expect `$HIR,0` or `,1`), once at the **gun body** (`$HIR,4`). Use fn 24 on protocol 7, magnitude 20 x2, and read the `$HP` delta | different pool delta between sensors ⇒ **both anomalies explained by one mechanism**, and the function map needs a sensor qualifier · identical ⇒ sensor is ruled out and the cause is elsewhere (different gun, or gun state) |
| **0.4** | **Which gun did the non-reproducing runs use?** | Just tell me, or re-run fn 24 protocol 7 on a *different* gun | a different gun reproducing 70→30 ⇒ per-unit difference, and every cross-session comparison needs the gun recorded |

**The stun shortlist is now evidence-based** — functions that register a `$HIR` but move **no pool**,
the same signature as fn 23 (the one proven status effect). Enemy-polarity candidates, in priority
order: **3, 8, 24, 25, 26, 27, 28, 35**. Fire each at a gun you are holding and report what you
**hear, see, or cannot do** — the wire has told us everything it can.

---

## GROUP 1 — trigger pulls, gun in hand (~35 min) 🔫
*One gun, our compiled game, you firing. Highest value first.*

| # | Goal | Do this | Pass |
|---|---|---|---|
| **1.1** | **K4 — why melee doesn't work in our game** (config is byte-identical to Callsign's, so it's runtime/state) | In **our** compiled game: select **slot 4**, swing hard. Watch the shooter for **`$BUT,8`** and a victim for `$HIR,…,13,…` | `$BUT,8` **+ IR** ⇒ never a bug, trial artifact · `$BUT,8` **no IR** ⇒ slot-4 firing · **no `$BUT,8`** ⇒ gyro mapping not live despite `$BMAP,8,4` being sent (then check whether `$SPAWN` wipes the map) |
| ~~1.2~~ ✅ | ~~EMP — does the disable stop you firing?~~ **CLOSED 2026-08-27: NO — fn 23 silences the gun, it does not disable it.** `$ALCD` t2 → 0, self-clears in ~6–8 s (3/3), `$SPAWN` clears it early, ammo + health untouched | — superseded by **1.5**, which retests the other status functions for a real stun | — |
| ~~1.3~~ | ~~Does a stun cost a reload?~~ **MOOT 2026-08-27** — there is no stun. fn 23 preserves ammo and never stops the trigger; it silences the gun. Re-ask if a real stun is ever found | — | — |
| **1.4** | **K1 — auto-reload for kids.** Two mechanisms, pick one | (a) `GameConfig(alt_reload=True)` → **already ships** (`$BMAP,1,97`, ALT = reload). (b) `$WEAP` **t19 = 5** (`ReloadType.AutoReload`) → fire dry. ⚠️ **Half of this is already answered (2026-08-27): it does NOT self-reload on an empty or near-empty magazine**, controls both ends. Only the *fire-triggered* case is left — pull the trigger on an empty chamber and watch `$ALCD` | which one feels right for young kids |
| **1.5** | **Status functions — what do 3, 8, 24–28, 35 (enemy) and 31, 32, 34 (ally) actually DO?** They register, change no pool, emit no BLE. Not DoTs (proved) | I fire each at you; **report anything you feel/hear/see** — sound, vibration, LED, fire-rate change | naming even one is a new mechanic |
| **1.6** | **KotH rate-of-fire buff** (your hardware fact) — likely one of the ally-side no-pool fns | While I fire 31/32/34 at you, **hold the trigger and listen for cadence change** | a fire-rate buff = 31/32/34 named |
| **1.7** | **t37/t38 overheat semantics** — what 20 vs 150 each mean | Two varied-value probes on the SMG+t37/t38 frame, watch the gauge | maps the two fields |
| **1.8** | **U4 reload chain / U5 held-trigger sound** | One long reload with a stopwatch; then hold the AR trigger and listen | closes both |

---

## GROUP 2 — IR instrument, measured distance (~25 min) 📏
*Receiver on a tripod/table at a taped mark. No victim gun needed.*

| # | Goal | Do this | Pass |
|---|---|---|---|
| **2.1** | **U2 — does `t41` change emitted range?** The last unresolved `$WEAP` token | Tape one mark. `t41=100`, `ir-range` count; then **only** `t41=5`; then `t41=100` again as a **closing control** | detect% differs with controls agreeing ⇒ answered (a null is also an answer) |
| **2.2** | **Back-dome melee — the "halo assassinate"** | Swing at a headset's **BACK** dome with the receiver watching, and a victim on BLE | is it a **different word**, or the same word landing on tok1=1? Melee magnitude is 90 — it should NOT one-shot, so something else is happening |
| **2.3** | **Sensor-map validation at field distance** | Fire at front dome / back dome / gun body from ~5 m | confirms tok1 0/1/4 outside point-blank |

---

## GROUP 3 — THE GRENADE (~30 min) 💣 *you asked for this list specifically*
*This is the biggest single unlock left: if we can replay station beacons, the Utility Box can
impersonate a grenade and the whole objective tier opens — including **G9 (CTF team assignment)**,
stuck since the flag turned red instead of team-coloured.*

| # | Goal | Do this | Pass |
|---|---|---|---|
| **3.1** | **Capture what each mode actually beacons** | Grenade in **Respawn** (yellow) mode, receiver pointed at it, `ir-capture` 60 s. Then **Hill** (blue) | our decode predicts protocol **15**, mode in the **magnitude** field (Respawn 6, Hill 8) — confirm or correct |
| **3.2** | **Capture the Hill BUFF** (your rate-of-fire boost) | Stand a gun in the hill; capture what the grenade sends the holder | names the buff word — and probably names fns 31/32/34 |
| **3.3** | **REPLAY a captured beacon** from our emitter at a gun | `ir-emit` the exact word from 3.1 | gun reacts as it does to the real grenade ⇒ **Utility Box can impersonate a station** |
| **3.4** | **B12 — respawn arming** | Does the **passive beacon alone** arm a living tagger into station-respawn, or does it need the **button press**? Does a button-armed gun stay armed all match? | settles the respawn-station design (we proved a **dead** gun accepts no IR — 448 words — so stations must arm the *living*) |
| **3.5** | **G9 — CTF team assignment** | Sweep `$GREN`'s **`channel`** field, then shoot the white grenade | flag takes a team colour |
| **3.6** | **G10 — thrown grenade blast type** | Pair a thrown grenade, send `$GREN` GrenadeType variants | blast type changes |

---

## GROUP 3½ — the SECOND IR protocol (~10 min, no grenade needed) 🆕
**`$GREN` makes the gun emit IR** — 8/8 probes, against a clean 20 s zero-ambient baseline. It is a
**28–32 bit word**, not the 25-bit shot format: same physical layer (~2029 µs sync, 500/1000 µs marks)
but longer, with shot-parity invalid. Almost certainly the **gun→grenade accessory-config channel**
(nothing public decodes it). It does **not** let a gun fire a damage/station word — scope it as
accessory signalling.

| # | Goal | Do this | Pass |
|---|---|---|---|
| **3½.1** | **Capture a `$GREN` word INTACT** | Raise `IDLE_GAP_US` in `ir_capture.ino` to ~30000 (or drop the per-frame RAW print) — every frame so far was split by print latency. Then `$GREN,*` at the receiver | **one unbroken frame of 28–32 bits**, same word on ≥3 repeats. If it still splits, cut the RAW print — that is the known cause |
| **3½.2** | **Is it arg-drivable?** | Sweep `iRType / operationMode / channel / GrenadeType` one field at a time and diff the captured words | **any bit changes with any argument** ⇒ the gun is a programmable accessory emitter. **All identical** ⇒ it's a fixed broadcast; stop here, it has no further use to us |
| **3½.3** | **Which emitter sends it?** | Cover the gun's muzzle emitter with a finger/tape, fire `$GREN`; then uncover and cover the **headset** emitter instead | whichever covering **kills** the IR names the source. Neither ⇒ a third emitter, or reflection — move the receiver off-axis and retry |

## GROUP 3¾ — LOADOUT v2: perks + empty slot 1 (~10 min, one gun + MC) 🎒 *new 2026-08-27*
Kit a player in MC (or `python -m brx_mcp.mc.mock_node … ` then `pick secondary body_armor`), PUSH, and read the gun:
1. **Body Armor** — `$PSET` armor should read **+50** (`$PSET,<n>,0,45,120,…`); `$SPAWN` → `$LCD` shows 120 armor; take one
   hit → armor drops first, HP untouched. *(Proves the perk lands; the mechanism itself is already bench-proven.)*
2. **Extended Mags** — primary `$WEAP` t16/t39 doubled, `$AMMO,0` doubled; the HUD max (from the config echo) matches;
   fire a mag dry → the reload refills to the doubled count.
3. **Easy Reload** — ALT button reloads (`$BMAP,1,97`); the pump still reloads too; ALT does NOT cycle a weapon.
4. **Empty slot 1** (secondary = none, no perk) — press ALT: expected **reload / no-op, no error chirp**
   (`brx-protocol.md:48`). If it chirps "disabled", the compiler should mirror the primary into slot 1 instead — tell brx-fable.
5. **Quick Hands** — reload chain audibly faster (t18 halved). Unverified: if the chain does NOT shorten, flip
   `quick_hands.verified` stays false and we hide it.
6. **Snipers preset** — BUILD → LOADOUT RULES → SNIPERS: every gun gets `$WEAP,0` = sniper, no `$WEAP,1`; the phone
   shows the padlock and refuses a pick (`loadout_ack.reason` = "Set by the host…").

### GROUP 3¾ continued — loadout edge cases flagged in review

- **[A10] Empty slot 2 button map.** With no secondary and no Easy Reload the head now pushes
  `$BMAP,1,100,0,0,99,99` (ALT cycles to slot 0 only) instead of the stock `…,0,1,…` that targets an unloaded
  slot 1 (brx-opus review). Bench: kit a player with an EMPTY secondary, spawn, press ALT → expect nothing
  (no reload, no swap, no crash); fire still works. Then Easy Reload → ALT reloads. Then a secondary weapon
  → ALT swaps 0↔1.
- **[A10] Quick Hands vs the reload sound chain.** `reload_mult` halves t18 only; the D-family reload sounds keep
  their fixed length, so the reload may finish mid-sound. Listen for clipping/overlap; if ugly, floor t18 at
  the chain length (brx-opus review). Perk stays `verified:false` until then.
- ~~**[A10] Body Armor `$PSET` armor ceiling.**~~ ✅ **ANSWERED 2026-08-27 — no bench time needed.**
  `$PSET` pools are **not 8-bit**: armour/HP/shield store and decrement exactly to at least **1000**,
  clamping at zero with no wrap (`$QUERY` readback + live `$HP`, both directions). The compiler's 255
  cap is **our policy**, not a device limit, and is annotated as such in `mc/compile.py`. Still worth
  eyeballing that Body Armor lands (armour 120 → a hit absorbs) as part of item 5 below.
- **[A10] Try-out shows the RAW weapon** (no perk ammo): a player with Extended Mags sees 32/384 in try-out and
  64/768 at spawn. Acceptable for v1; if the HUD try-out panel confuses people, label its ammo "base".

---

## GROUP 4 — ears and eyes (~15 min) 👂
*All four need a lit gun in front of you. Do them in a dim room — several are colour calls.*

| # | Goal | Do this | Pass |
|---|---|---|---|
| **4.1** | **P13 — is `$GLED` colour a single 0–8 index?** | Mid-game, sweep `$GLED,<n>,0,0,1,2000,2000,*` for n = 0…8, **one value at a time**, and write down the colour you see for each | a **stable n → colour map**. The FB map claims 0 red … 8 orange and fits 5/6 of our earlier probe — either confirm it or record where it diverges. Colour not changing at all ⇒ token 1 is not the index and colour really is only `$TID`-derived |
| **4.2** | **P17 — how do you turn the LEDs OFF?** | Mid-game, try in order: `$GLED,0,4,0,0,0,,*` (effect=StopIR — what we ship today, **unconfirmed**), then all-zeros, then brightness/duration = 0 | **LEDs actually go dark and stay dark.** Whichever frame does it becomes night mode's. If none do, night mode cannot darken a gun and `GameConfig(leds=False)` is lying — say so, it's a mode-design constraint |
| **4.3** | **LED "life mode"** — ✅ **behaviour now KNOWN (2026-08-27, observed):** the 3 gun LEDs are a **segmented gauge** — **purple** while the protective pools have charge, draining segment by segment, then a **colour change** (observed blue — but ⚠️ Nexus is the blue *faction*, so the colour is probably team-derived, not a pool identity; test on a red/green faction); at zero, the death grenade + death sound; the **headset flashes green on death**. This matches the wire-measured drain order shields→armor→HP exactly. | Only the **driving token** is missing now. Sweep `$GSET` / `$PSET` / `$GLED` effect values in a native game vs ours and find what selects gauge-mode | our compiled head reproduces purple-then-blue segments tracking the pools |
| **4.5** | **`$PSET` t2 and t6 — what do they do?** Swept from the keyboard over wide ranges (t2 {0,1,2,5,10,50,100}, t6 {0,1,25,50,100,200}) with **byte-identical** `$HIR` and `$HP` in every cell — they touch no pool, no damage, no crit, no gating, and `$QUERY` does not echo them. If they do anything it is **audio or LED**, which is why they need you | Push each value mid-game and **listen / watch the LEDs** | any audible or visible difference names a token · nothing on either instrument ⇒ record them as inert and stop spending time on them |
| **4.4** | **Try-out LED strobe** — LEDs show the unspawned pattern during tutorials | In our try-out flow, note what the LEDs do vs a real game | the quieting token, or confirmation that try-out simply isn't spawned (in which case it's a mode fix, not an LED one) |

---

## If you only have ONE hour
**0.1 (disputed multipliers) → 0.3 (sensor) → 1.5 (status functions, incl. the stun shortlist) → 3.1+3.3 (grenade capture + replay).**

Why this order changed: **0.1 and 0.3 are cheap and they gate what we can publish.** Five shipped
weapons map to fn 36/37 and may be dealing base damage; until 0.1 settles it we cannot print a
hits-to-kill table. 0.3 is five minutes and may explain **two** unreproduced results at once. Then 1.5
is the only way left to identify the status functions — the wire has given up everything it can.

*(Previously this list led with the Sentinel EMP capture and melee. Both still matter — 1.1 melee and
`bench-next-30.md` §1 — but neither blocks a published number the way 0.1 does.)*

## Do NOT re-run (already answered overnight)
B13 · B4 emit proof · U7 · P16 · B5 · the `$SIR` function map (both polarities, and it does **not**
vary by protocol — 50 cells) · **the crit FORMULA** (`magnitude × (1 + $GSET t7/100)`, exact at seven
levels) · `$GSET` t1 = enforced friendly fire · dead guns accept no
IR · `$HIR` tok5 = raw magnitude · AP bypasses shields · heals clamp · `$GREN` emits a second IR protocol · **fn 23 = AUDIO SUPPRESSION, not a stun** (trigger pull disproved the disable) · the `$ALCD` **token 2 audio meter**'s ~6–8 s recovery and the fact `$SPAWN` clears it / `$AMMO` does not — *those are meter facts, not stun facts* · **K3 the death nova** (proto 10, MAG 125, credits the corpse).

> ⚠️ **EXCEPTION — do NOT read the above as covering the fn 36/37 multipliers.** An earlier version of
> this list said "crit ×1.5 and its multiplicative stacking with fn 36/37" was settled. **It is not.**
> ×1.5 was only ever the shipped `t7=50` case, and the ×1.25/×2 multipliers are **DISPUTED** — they did
> not reproduce in 24 controlled cells. That is exactly **item 0.1**, which is the one thing in this
> plan that most needs doing.

*(P4 is only half closed: `$AS`/`$UP` are proven **silent** — no reply on v4.32 — but their **effect** was never probed. If you have a spare minute it belongs in Group 1.)*
