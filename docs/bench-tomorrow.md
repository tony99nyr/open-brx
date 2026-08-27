# Bench plan — what needs Tony (2026-08-27)

Built overnight from the IR session. **Everything in here is blocked on a human**: a trigger pull, an
ear, an eye, floor space, or the grenade. Everything that could be cracked from the keyboard already
was — see `docs/experiment-log.md` 2026-08-26 entries.

**Ordered to minimise re-rigging.** Do a whole group before moving to the next; the rig change between
groups is the expensive part, not the tests.

## Before you start (5 min)
- **POWER-REST first** — the fleet ops rule. Use guns that have been off; R0BAS ran all night.
- **Headsets ON and settled** or the gun silently refuses to join.
- Rig: **board A (`5C93045958`) = receiver** (VS1838B → GPIO4), **board B (`5C4C136487`) = emitter**
  (2N2222A + LED → GPIO5). Flash from the **UART** port; see `hardware/esp32-ir-bridge/README.md`.
- Close the Arduino Serial Monitor — Windows ports are exclusive.
- **Aim matters**: attenuate for loopback (the VS1838B saturates point-blank), and fire spaced ~1–2 s
  so the capture sketch's RAW print doesn't truncate frames.

---

## GROUP 1 — trigger pulls, gun in hand (~35 min) 🔫
*One gun, our compiled game, you firing. Highest value first.*

| # | Goal | Do this | Pass |
|---|---|---|---|
| **1.1** | **K4 — why melee doesn't work in our game** (config is byte-identical to Callsign's, so it's runtime/state) | In **our** compiled game: select **slot 4**, swing hard. Watch the shooter for **`$BUT,8`** and a victim for `$HIR,…,13,…` | `$BUT,8` **+ IR** ⇒ never a bug, trial artifact · `$BUT,8` **no IR** ⇒ slot-4 firing · **no `$BUT,8`** ⇒ gyro mapping not live despite `$BMAP,8,4` being sent (then check whether `$SPAWN` wipes the map) |
| **1.2** | **EMP — does the disable actually stop you firing?** Now fully specified from the keyboard: `$ALCD` t2 → 0, **self-clears in ~6–8 s** (3/3 reps), `$SPAWN` clears it early, ammo + health untouched. Only a trigger can confirm the *felt* effect | I fire `$SIR,7,0,,23` at your gun → **try to shoot immediately, then keep trying** | can't fire, then can again after ~6–8 s ⇒ **EMP CLOSED**; also tells us what the player hears (EmpStart/Loop/End) |
| **1.3** | **Does a stun cost a reload?** | During the ~6–8 s window: does an `$AMMO` re-push let you fire, or must you wait/reload? (`$AMMO` does NOT clear the flag, so probably wait) | tells us the stun's true cost |
| **1.4** | **K1 — auto-reload for kids.** Two mechanisms, pick one | (a) `GameConfig(alt_reload=True)` → **already ships** (`$BMAP,1,97`, ALT = reload). (b) `$WEAP` **t19 = 5** (`ReloadType.AutoReload`) → fire dry | which one feels right for young kids |
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

| # | Goal | Do this |
|---|---|---|
| **3½.1** | **Capture a `$GREN` word INTACT** | Raise `IDLE_GAP_US` in `ir_capture.ino` (or drop the per-frame RAW print) — every frame so far was split by print latency. Then `$GREN,*` at the receiver |
| **3½.2** | **Is it arg-drivable?** | Sweep `iRType / operationMode / channel / GrenadeType` and diff the captured words. **If the bits track the args, the gun becomes a programmable accessory emitter** |
| **3½.3** | **Which emitter sends it?** | Cover the gun's muzzle emitter, then the headset's — whichever kills the `$GREN` IR is the source |

## GROUP 4 — ears and eyes (~15 min) 👂
| # | Goal | Do this |
|---|---|---|
| **4.1** | **P13 — `$GLED` colour index** | Mid-game sweep `$GLED,<0-8>,0,0,1,2000,2000,*`, one field at a time |
| **4.2** | **P17 — how to turn LEDs OFF** (night mode) | StopIR vs all-zeros vs brightness-0 |
| **4.3** | **LED "life mode"** + the try-out strobe | find the token that shows HP on the LEDs |

---

## If you only have ONE hour
**1.1 (melee) → 1.2 (EMP trigger) → 3.1+3.3 (grenade capture + replay) → 2.1 (t41).**
That closes the melee gap, finishes the special-weapons tier, opens the objective tier, and settles the
last weapon token.

## Do NOT re-run (already answered overnight)
B13 · B4 emit proof · U7 · P16 · B5 · the `$SIR` function map (both polarities) · crit ×1.5 and
its multiplicative stacking with fn 36/37 · `$GSET` t1 = enforced friendly fire · dead guns accept no
IR · `$HIR` tok5 = raw magnitude · AP bypasses shields · heals clamp · `$SPAWN` clears the EMP · the EMP's ~6–8 s self-clearing duration · `$GREN` emits a second IR protocol.

*(P4 is only half closed: `$AS`/`$UP` are proven **silent** — no reply on v4.32 — but their **effect** was never probed. If you have a spare minute it belongs in Group 1.)*
