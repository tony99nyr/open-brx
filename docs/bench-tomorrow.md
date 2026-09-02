# Bench plan — what needs Tony (updated 2026-08-31)

Built overnight from the IR session. **Everything in here is blocked on a human**: a trigger pull, an
ear, an eye, floor space, or the grenade. Everything that could be cracked from the keyboard already
was — see `docs/experiment-log.md`, 2026-08-26 **and 2026-08-27** entries.

**This is the subset that needs a human.** For the whole board — including what's blocked on a capture,
on unwired hardware, or on a decision — see [`unknowns.md`](unknowns.md).

**Ordered to minimise re-rigging.** Do a whole group before moving to the next; the rig change between
groups is the expensive part, not the tests.

> ### 🗓️ TODAY (2026-09-01): run [`bench-hour-2026-09-01.md`](bench-hour-2026-09-01.md)
> A dated one-hour **selection from this file** — items 1 (`$HLED`, shipped-unverified), 2 (F1 gauge),
> 3 (0.1 multipliers), 4 (1.5a). It carries the gates and the exact commands. **This file is still the
> queue**; the sheet expires after the session and its results get struck here.
>
> Item 1 is **F10** — the only code path we ship that no one has ever seen work, and it gates a
> correction to a ✅ claim `docs/manual/` publishes today ("headset green: blink on hit, hold on kill").
> The morning's repo blocker is cleared; just `git pull --ff-only` first.

> ### 📍 START HERE — do these three, in this order
>
> **0. Power-cycle the gun AND the headset.** The victim gun went **screamer** after ~3 days powered
> (2026-08-29): it still advertises but will not complete a BLE connection, failing during service
> discovery. A headset also began advertising on its own. Nothing below works until this is done.
> **Verify** with `$PY -m brx_mcp scan` then `identify` — a clean connect means you are back.
>
> **1. The F1 gauge check — 5 minutes, and it can DELETE a planned feature.**
> *Does the gun's native health gauge appear in OUR compiled games, or only in native ones?*
> Start one of our games, take damage, watch the three gun LEDs. Step down = **FOLLOWUPS F1 is already
> shipped by the hardware**; no step down = F1 is a one-field config hunt. Either answer removes work.
> It is item **4.3** below, promoted here because it is cheap and it changes what is worth building.
>
> **2. Item 1.5a (in GROUP 1) — the ally re-measure.** Needs **no operator once the rig is up** (it is a
> keyboard test; only the power-cycle needs hands). It decides whether ally functions 9, 15, 31, 32
> and 34 are real status effects or just grants that were **clamped** by full pools — a ceiling
> artifact that already mis-binned fn 10, a known heal.
>
> **3. Then GROUP 0**, in the order written. From there, item order is priority order and the groups
> are ordered to minimise re-rigging — do a whole group before moving on.
>
> ---
>
> **This file is the ONLY bench queue.** `docs/HANDOFF.md` is the entry point; this is the queue.
> [`bench-next-30.md`](bench-next-30.md) is a 30-minute **subset** of it, not a rival plan, and
> `bench-plan-hardware.md` is **superseded** (it says so at its own top). If they disagree, this wins.
>
> ⚠️ **Closed on 2026-08-30, do not run:** **4.1** (P13 — `$GLED` tokens 1-3 are three independently
> addressable LEDs, each a direct palette index; the palette is nine colours, 0 red · 1 blue · 2 yellow ·
> 3 green · 4 purple · 5 teal · 6 white · 7 pink · 8 orange, with 7/8 read off a gun on 2026-09-02) and
> **4.2** (P17 — **token 4 = 5 turns the LEDs off**: Callsign's own `$GLED,,,,5,,,*`).
> `$GLED` is solved: `<led1>,<led2>,<led3>,<t4>,<brightness>`. ⚠️ **Corrected 2026-09-02: the earlier
> "token 4 = 3 blanks all three" is wrong** — a full t4 sweep 0-10 at green went dark only at 5. Also
> closed: `bench-next-30.md` item 3, which is the same pair.

## HOW TO RUN ANYTHING (read once — the items below assume this)

**Everything runs from Windows Python, not WSL** (WSL2 has no Bluetooth). From WSL the interpreter is:

```
PY=/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe
cd /mnt/c && $PY -m brx_mcp scan          # ALWAYS start here
```

`scan` prints every tagger's **BLE name and address**. The name carries the headset sticker, so that is
how you match a physical gun to an address. **The sticker-to-address mapping is deliberately NOT in this
repo** (the stickers are headset serials) — read it off `scan` each session.

**The ESP32 rig:** board **A = receiver, COM7** (VS1838B → GPIO4) · board **B = emitter, COM8**
(2N2222A + LED → GPIO5). Close the Arduino Serial Monitor first — **Windows COM ports are exclusive**
and it will silently steal the board.

### The verbs you will actually use

| what | command |
|---|---|
| find guns | `$PY -m brx_mcp scan` |
| run a real game | `$PY -m brx_mcp play <mode> <addr…> volume=69` — **`<mode>` is one of** `tdm ffa infection lms cs domination koth ctf extraction`. A gun may carry a gamertag: `<addr>@<Gamertag>` |
| two guns, quick duel | `$PY -m brx_mcp arena <addr1> <addr2> [minutes] [respawn_s] [volume]` |
| return a gun to clean idle | there is **no `reset` verb** — send `$CLEAR,*` (then `$SP,99,*` if it is still making noise). `$PY -m brx_mcp listen <addr>` to watch it settle |
| what the CLI actually offers | `$PY -m brx_mcp` with no args prints every verb — trust that over this table |
| capture IR | `$PY -m brx_mcp ir-capture COM7 <secs>` |
| emit one IR word | `$PY -m brx_mcp ir-emit <25-bits> COM8 [repeat]` |
| range / hit-rate at distance | `$PY -m brx_mcp ir-range COM7 <secs> <shots>` |
| end-to-end scorecard | `$PY -m brx_mcp diag-game <addr>` |

### The purpose-built bench scripts (`mcp/tools/`, run with the same `$PY`)

Each carries its usage in its docstring — `head -3 <file>` if unsure.

| script | usage | for |
|---|---|---|
| `hittest.py` | `<shooter> <victim>` | one clean hit, single timeline |
| `damage_bench.py` | `<shooter> <victim> [secs]` | does `$WEAP` t5 mean damage |
| `sensor_bench.py` | `<shooter> <victim> [secs]` | map `$HIR` token 1 (which sensor was struck) |
| `weapon_range.py` | see docstring | range work |
| `tid_bench.py` / `ff_probe.py` | see docstring | team + friendly-fire matrices |
| `victim_count.py` / `quick_victim.py` | see docstring | quick victim-side readouts |
| **`ally_remeasure.py`** | `<victim_addr> [com=COM8] [fns=10,11,9,15,31,32,34]` | **runs bench item 1.5a end to end** — arms, depletes, fires each ally fn, prints a verdict table |

> ⚠️ **Most of the night's throwaway probes live on the Windows box** (`C:\Users\Tony\.brx-mcp\*.py`,
> ~107 of them) and are **not in this repo**. They are one-shot scripts against a known rig state, not
> tools. If you need one, read it there — but anything worth re-running should be cleaned up and moved
> into `mcp/tools/` with a docstring, the way `ally_remeasure.py` was.

> ⚠️ **Two rules that have each cost a session.**
> **1. State the shooter TEAM in every IR test.** A wrongly-teamed shot is discarded with **no `$HIR`
> at all**, so it looks identical to a dead emitter. Damage needs an **enemy** team, grants need the
> victim's **own**.
> **2. Never advance an operator-in-the-loop sweep on a timer.** Send one frame, **wait for the call**,
> then send the next. A timed sweep racing a human observer binds observations to the wrong frame — it
> cost an afternoon and produced two confidently wrong theories on 2026-08-30.

---

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

**Commands for this group** (see HOW TO RUN for `$PY`):

```
$PY -m brx_mcp scan                                  # get addresses first, every time
$PY -m brx_mcp ir-capture COM7 60                    # 0.2 loopback: aim board B at board A, then TX
$PY ../gitrepos/battlecompany/mcp/tools/sensor_bench.py <shooter> <victim>    # 0.3 which sensor was struck
```

**0.1 is CLOSED (2026-09-02)** — the multipliers are real; the method note below is kept for its scope
caveat, which still applies to the result.

> ⚠️ **Which `$SIR` table is in play, and why it matters for 0.1.** The applied function is chosen by the
> **victim's** `$SIR` row for the incoming (protocol, subtype) — *not* by the shooter. So "nothing of ours
> in the signal path" is true only of the **emitter**: the victim must be armed by us to be on BLE at all,
> and that means **our** `$SIR` table decides that fn 36 is what gets applied.
>
> That is fine — it is exactly the configuration we ship, and it is the one whose numbers we would publish.
> **What it rules out** is concluding anything about *native* games from this test. The finding that
> landed is therefore "**fn 36 lands floor(magnitude × 1.25) and fn 37 lands magnitude × 2 in our
> table**"; whether stock BRX ships a different table is a separate question needing a native-game
> capture.
> **Record which gun was the victim** — 0.4 exists because a previous run did not.
Put the victim on BLE and watch: `$HIR` **token 5** is the raw magnitude, and the `$HP` delta is the
applied damage. Compare the two. That is the whole test, and it works because **our emitter is out of
the signal path**.


| # | Goal | Do this | Pass |
|---|---|---|---|
| ~~**0.1**~~ | ✅ **CLOSED 2026-09-02 — the fn 36/37 multipliers are REAL.** **fn 36 = floor(magnitude x 1.25) · fn 37 = magnitude x 2** | Measured: 16 trials, magnitudes **20 / 40 / 9 / 7**, **8 different `$SIR` row-tail shapes**, with an **fn 1 control on subtype 0 in every trial** (had to read exactly the magnitude or the trial was voided). 20→25/40 · 40→50/80 · 9→11/18 · 7→**8**/14. **The x1.25 TRUNCATES**: 7 x 1.25 = 8.75 lands as **8**, not 9 — this matters for hits-to-kill. **Negative:** the row tail does **not** gate the multiplier (`0,0,1,,` / `,,,,` / `0,0,0,,` / `0,0,2,,` / `0,1,1,,` / none / `0,0,1,60` all gave x1.25 and x2). Measured through **our** `$SIR` table, which is what we ship | **DONE.** Still unexplained: the 2026-08-27 24-cell x1.0 matrix (valid fn 1 control) is **outvoted, not explained** |
| **0.2** | **Re-aim the emitter at the receiver** so loopback capture works | Point board B's LED at board A's VS1838B, **attenuated** (it saturates point-blank). Then `TX` any word and confirm a DECODE line | a decoded 25-bit word ⇒ we can verify transmitted words over the air, not just in software. Currently the two boards cannot see each other at all |
| **0.3** | **Does the SENSOR STRUCK change the applied function?** The single cheapest test for the two results that would not reproduce (fn 36/37 ×2, and fn 24 damaging in an operator-held run). **Note the protocol framing is dead** — a 50-cell matrix showed the function classes do not vary across protocols 0/5/7/9/10, so the difference is not the protocol. **20/20 of my hits landed on `$HIR` tok1 = 4, the gun body** — this rig cannot produce a dome hit at all; a held gun is struck at a different angle | Fire the **same word** twice: once at the **headset dome** (expect `$HIR,0` or `,1`), once at the **gun body** (`$HIR,4`). Use fn 24 on protocol 7, magnitude 20 x2, and read the `$HP` delta | different pool delta between sensors ⇒ **both anomalies explained by one mechanism**, and the function map needs a sensor qualifier · identical ⇒ sensor is ruled out and the cause is elsewhere (different gun, or gun state) |
| **0.4** | **Which gun did the non-reproducing runs use?** | Just tell me, or re-run fn 24 protocol 7 on a *different* gun | a different gun reproducing 70→30 ⇒ per-unit difference, and every cross-session comparison needs the gun recorded |

**The stun shortlist is now evidence-based** — functions that register a `$HIR` but move **no pool**,
the same signature as fn 23 (the one proven status effect). Enemy-polarity candidates, in priority
order: **8, 24, 25, 26, 27, 28, 35**. (**fn 3 was removed 2026-08-29** — re-tested with a shield
granted first, it drains shield exactly as plain damage does. It only looked inert because the original
sweep ran with the shield at 0. The seven left moved no pool with 150 shield available.) Fire each at a gun you are holding and report what you
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
| **1.5** | **Status functions: what do enemy 8, 24-28, 35 and ally 31, 32, 34 actually DO?** They register a `$HIR`, change no pool, emit no BLE. ⚠️ **fn 3 was removed 2026-08-29** (it drains shield, so it is damage). ⚠️ **Do the ally ones LAST** and only after the keyboard re-measure in 1.5a, or you will burn trigger time on clamped grants | I fire each at you from the correct polarity team; **report anything you feel, hear or see** | naming even one is a new mechanic |
| **1.5a** | ⚠️ **NOT operator-free while the rig is in the screamer state — power-cycle first.** **Then keyboard-only: re-measure ally 9, 10, 15, 31, 32, 34 from DEPLETED pools.** The map ran at full HP/armour, so a heal or armour grant clamps and reads as "no pool change". That is how fn 10, a known heal, got mis-binned | **Run `mcp/tools/ally_remeasure.py <victim_addr>`** — it arms the victim, depletes, fires each ally function from the correct polarity and prints a verdict table. **fn 10 and 11 are the positive controls: if they do not read as GRANTs, the method is wrong and the rest of the table means nothing** — do not interpret it. Needs the emitter (board B) aimed at the victim. A `VOID` row means the deplete never landed (aim or connection), not a result. Manual fallback: `mcp/tools/hittest.py <shooter> <victim>` for one shot at a time. | any that moves a pool is a GRANT, not a status function, and drops off 1.5 |
| **1.6** | **KotH rate-of-fire buff** (your hardware fact) — likely one of the ally-side no-pool fns | While I fire 31/32/34 at you, **hold the trigger and listen for cadence change** | a fire-rate buff = 31/32/34 named |
| **1.7** | **t37/t38 overheat semantics** — what 20 vs 150 each mean | Two varied-value probes on the SMG+t37/t38 frame, watch the gauge | maps the two fields |
| **1.8** | **U4 reload chain / U5 held-trigger sound** | One long reload with a stopwatch; then hold the AR trigger and listen | closes both |

---

## GROUP 2 — IR instrument, measured distance (~25 min) 📏
*Receiver on a tripod/table at a taped mark. No victim gun needed.*

| # | Goal | Do this | Pass |
|---|---|---|---|
| **2.1** | **U2 / Q15 — does `t41` change emitted range?** ⭐ **Raised in priority 2026-08-30**: Tony reports native indoor is too strong for tight spaces and bounced IR registers hits. `t41` is a 0-100 per-weapon range value reading **75 on all 18 guns and 20 on melee**, so it plausibly is the dial we want | Tape one mark. `t41=100`, `ir-range` count; then **only** `t41=5`; then `t41=100` again as a **closing control** | detect% differs with controls agreeing ⇒ answered (a null is also an answer) |
| **2.4** | **Q16 - beam DIVERGENCE: would a snoot help at all?** Decides between a nozzle shroud and a power fix for Tony's indoor bounce. The emitter is a **collimated Class 1 laser** (980 nm, 16.9 mW, beam <18 mm at the aperture), so the prior is that off-axis splash is small and a snoot is pointless | Receiver on a taped mark at ~3 m. Fire on-axis, then step the gun off-axis 10/20/30/40/50 deg at the **same distance**, 10 shots each, counting detections. Return to 0 deg as a closing control | sharp fall-off by 10-20 deg ⇒ tight beam, **skip the snoot**, fix the power (t41) · detections still at 30-50 deg ⇒ real skirt, **a snoot is worth building** |
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

## ~~GROUP 3½ — the SECOND IR protocol~~ ✅ DONE UNATTENDED, NEGATIVE. SKIP.
**Do not spend bench time here.** `$GREN` does make the gun emit a second, longer IR word, but the
argument sweep came back **negative**: the bits do not track `iRType` / `operationMode` / `channel` /
`GrenadeType` (`experiment-log.md` 2026-08-26). It is a fixed broadcast, not a programmable emitter,
so it has no further use to us. The `IDLE_GAP_US` capture fix it asks for is already applied.
Kept below only as the record of what was tried.

### (superseded) original items
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
| ~~4.1~~ ✅ | ~~**P13 — is `$GLED` colour a single 0–8 index?** | Mid-game, sweep `$GLED,<n>,0,0,1,2000,2000,*` for n = 0…8, **one value at a time**, and write down the colour you see for each | a **stable n → colour map**. The FB map claims 0 red … 8 orange and fits 5/6 of our earlier probe — either confirm it or record where it diverges. Colour not changing at all ⇒ token 1 is not the index and colour really is only `$TID`-derived |
| ~~4.2~~ ✅ | ~~**P17 — how do you turn the LEDs OFF?** | Mid-game, try in order: `$GLED,0,4,0,0,0,,*` (effect=StopIR — what we ship today, **unconfirmed**), then all-zeros, then brightness/duration = 0 | **LEDs actually go dark and stay dark.** Whichever frame does it becomes night mode's. If none do, night mode cannot darken a gun and `GameConfig(leds=False)` is lying — say so, it's a mode-design constraint |
| **4.3** | **LED "life mode"** — ✅ **CONFIRMED NATIVE 2026-08-30.** The 3 gun LEDs are the gun's **own segmented health gauge**, in the **team colour**, with no host involvement: three pulsing at full health, stepping down to one as health falls (Tony, native FFA). The 2026-08-27 "purple then blue" reading was the same gauge seen on a blue faction — colour follows the **team**, segment count follows the **pools**. Drain order matches the wire (shields→armor→HP). **Do not build an LED driver for this** — `$GLED` overpaints and destroys it. | **The only question left:** does the gauge appear in **our compiled** games, or only native ones? Start one of our games, take damage, watch the three LEDs. If it does not appear, hunt the config field that enables it (`$GSET`/`$PSET` diff vs a native game) | ✅ gauge steps down in our game ⇒ **FOLLOWUPS F1 is already shipped by the hardware, delete the feature**. ❌ no gauge ⇒ F1 becomes a one-field config hunt, still not a driver |
| **4.5** | **`$PSET` t2 and t6 — what do they do?** Swept from the keyboard over wide ranges (t2 {0,1,2,5,10,50,100}, t6 {0,1,25,50,100,200}) with **byte-identical** `$HIR` and `$HP` in every cell — they touch no pool, no damage, no crit, no gating, and `$QUERY` does not echo them. If they do anything it is **audio or LED**, which is why they need you | Push each value mid-game and **listen / watch the LEDs** | any audible or visible difference names a token · nothing on either instrument ⇒ record them as inert and stop spending time on them |
| **4.4** | **Try-out LED strobe** — LEDs show the unspawned pattern during tutorials | In our try-out flow, note what the LEDs do vs a real game | the quieting token, or confirmation that try-out simply isn't spawned (in which case it's a mode fix, not an LED one) |

---

## If you only have ONE hour
**~~0.1~~ (CLOSED 2026-09-02) → 0.3 (sensor) → 1.5 (status functions, incl. the stun shortlist) → 3.1+3.3 (grenade capture + replay).**

**0.1 is done:** the multipliers are real (fn 36 = floor(mag x 1.25), fn 37 = mag x 2), so the five
weapons on fn 36/37 are **not** dealing base damage. 0.3 is still worth five minutes, but note its
premise has shrunk: the only unreproduced result it can now explain is **fn 24 damaging in an
operator-held run**, not the multipliers. Then 1.5 is the only way left to identify the status
functions — the wire has given up everything it can.

*(Previously this list led with the Sentinel EMP capture and melee. Both still matter — 1.1 melee and
`bench-next-30.md` §1.)*

## Do NOT re-run (already answered overnight)
B13 · B4 emit proof · U7 · P16 · B5 · the `$SIR` function map (both polarities, and it does **not**
vary by protocol — 50 cells) · **the crit FORMULA** (`magnitude × (1 + $GSET t7/100)`, exact at seven
levels) · `$GSET` t1 = enforced friendly fire · dead guns accept no
IR · `$HIR` tok5 = raw magnitude · AP bypasses shields · heals clamp · `$GREN` emits a second IR protocol · **fn 23 = AUDIO SUPPRESSION, not a stun** (trigger pull disproved the disable) · the `$ALCD` **token 2 audio meter**'s ~6–8 s recovery and the fact `$SPAWN` clears it / `$AMMO` does not — *those are meter facts, not stun facts* · **K3 the death nova** (proto 10, MAG 125, credits the corpse).

> ✅ **The fn 36/37 multipliers are now settled too (2026-09-02, item 0.1):** fn 36 = floor(magnitude
> × 1.25), fn 37 = magnitude × 2, the ×1.25 truncating. One caveat from the old exception note still
> stands: **×1.5 was only ever the shipped `t7=50` crit case**, not a constant. *Retracted:* the
> "DISPUTED, did not reproduce in 24 controlled cells" warning — that matrix is outvoted, though still
> unexplained.

*(P4 is only half closed: `$AS`/`$UP` are proven **silent** — no reply on v4.32 — but their **effect** was never probed. If you have a spare minute it belongs in Group 1.)*
