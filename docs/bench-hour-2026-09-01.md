# One-hour bench session — 2026-09-01

**A dated SELECTION from [`bench-tomorrow.md`](bench-tomorrow.md), which remains the queue.** Nothing
here is new work; it is the four highest-value items that fit in an hour, ordered, with every gate that
can void a result stated up front. When the hour is done, results go in `docs/experiment-log.md` and the
items get struck in `bench-tomorrow.md`.

**Budget:** 5 gate + 12 + 5 + 15 + 10 = 47 min, leaving ~13 min of slack. **If you run short, protect
item 1** — it is the only path we ship that no one has ever seen work, and it gates a correction to a
✅ claim the public manual is making right now.

**Updated after pulling `31507ce`: the morning's repo blocker is cleared, and item 1
is sharper — a merge review checked the new `$HLED` frame against the captures its own comment cited
and found the provenance wrong in two ways we can now test for directly.

---

## GATE 0 — be current (the earlier repo blocker is CLEARED)

The uncommitted work that blocked `git pull` this morning has landed. `brx-mcp` runs **editable from
this WSL path**, so what is checked out here is literally what the guns get. Confirm before you start:

```
cd /home/tony/gitrepos/battlecompany && git pull --ff-only
grep -c HLED mcp/brx_mcp/mc/compile.py     # must be >= 3
```

## GATE 1 — the rig

| gate | why | check |
|---|---|---|
| **Power-cycle the gun AND the headset** | the victim gun went **screamer** 2026-08-29: still advertises, never completes service discovery | `$PY -m brx_mcp scan` then `identify <addr>` completes |
| **Headsets ON and settled** | a gun whose headset has dropped **silently refuses to join a game** | headset LEDs alive before you arm |
| **Power-rest** | a gun powered ~3 days is what went screamer in the first place | use guns that have been off |
| **Close the Arduino Serial Monitor** | Windows COM ports are **exclusive**; it silently steals the board | only needed for items 3-4 |
| **ASCII only in any script you write** | the Windows console is cp1252; one stray em dash kills a run mid-way | — |

```
PY=/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe
cd /mnt/c && $PY -m brx_mcp scan          # ALWAYS first: maps sticker -> address
```
Board **A = receiver COM7** · board **B = emitter COM8**.

## GATE 2 — the two rules that have each cost a session

1. **State the shooter TEAM in every IR test.** A wrongly-teamed shot is discarded with **no `$HIR` at
   all**, which looks identical to a dead emitter. Damage needs an **enemy** team; grants need the
   victim's **own**.
2. **Never advance an operator-in-the-loop sweep on a timer.** Send one frame, **wait for Tony's call**,
   then send the next. A timed sweep racing a human observer binds observations to the wrong frame. It
   cost an afternoon on 2026-08-30 and produced two confidently wrong theories.

---

# 1 · F10 · `$HLED` — the only shipped-unverified code path · 12 min · eyes

**Why this is first, and why it went UP in priority.** Two reasons now:

1. It is the **only code path we ship that no one has ever seen work**. `compile.py` puts a pre-game
   `$HLED` in every game head and the node fires `hurt`/`hurt_led` once per life.
2. **`docs/manual/` publishes the lit headset as a ✅ confirmed fact** — "green blink on a hit, hold on
   a kill" (`01-hardware.md:139`, `03-gameplay.md:187,197`) — and even carries a callout *correcting an
   earlier version of our own notes*, which reads as hard-won certainty. **We have never seen a headset
   lit.** That marker is not earned, and it is on the public site. F10 settles it so the manual gets
   corrected **once**, not retracted twice.

**What the captures actually say** (verified line by line, pinned by
`test_mc_compile::test_what_the_captures_actually_say_about_HLED` so it cannot drift back):

| when | frame | who |
|---|---|---|
| **lobby** (seconds BEFORE `$CLEAR`/`$START`), paired with a `$GLED` of the same token ~200 ms earlier | `$HLED,<n>,0,,,10,,*` | every gun, every capture |
| armour 0 → HP dropping, ~0.9 s after | `$PLAY,VA8B,3,6,,,,,*` then `$HLED,7,4,90,90,10,15,*` | the **victim**, once per life |
| end of game | `$HLED,,6,,,,,*` | every gun |

**There is no per-hit and no per-kill headset frame** — 23 `$HIR` hits produced 2 alerts; 3 kills, none.

⚠️ **Two ways ours differs from every capture**, both introduced by us and both live: we send it
**mid-head after `$BMAP`** rather than in the lobby, and we send it **alone** rather than paired with a
`$GLED`. If the headset stays dark, that is the first thing to vary.

### 1a · Does the headset light at all, pre-game? · 3 min
Arm a gun from our stack and look at the headset.
**Pass:** it lights. **Fail:** dark → try the **captured shape** before concluding anything: send a
`$GLED,<n>,…` and then `$HLED,<n>,0,,,10,,*` about 200 ms later, in the lobby, before `$CLEAR`/`$START`.

### 1b · ⭐ Is token 1 a colour at all? Put a player on **tid 2 or 3**. · 6 min

**Why this specific value.** `compile.py` writes `$HLED,<tid>,…`, but across **every capture on disk
that token is only ever 0, 1 or 7**, and **no capture contains a `$TID` at all**. Nothing observed links
that token to a team. "The tid is the colour" is an inference from the `$GLED` palette, not a
measurement. Our tids: red=0 · blue=1 · **yellow=2** · **green=3** · ffa=1 — so 0 and 1 would look
right by luck. **A player on tid 2 or 3 is the only assignment that can tell you.**

**Then sweep it, ONE VALUE AT A TIME, WAITING FOR THE CALL** (GATE 2 rule 2): `$HLED,<n>,0,,,10,,*`
for n = 0…6, saying the colour each time.
**Predicted if the palette is shared:** 0 red · 1 blue · 2 yellow · 3 green · 4 purple · 5 teal · 6 white.

**Carry it to n = 7 and 8** — never read off a gun (`manual/06-developer.md` backlog), and the
low-health alert uses **7**, so this is not idle curiosity.

### 1c · The low-health alert, and the per-hit question · 3 min
Send `$HLED,7,4,90,90,10,15,*` on a live headset. Note the **colour** (index 7) and the **behaviour** —
token 2 is `0` in the lobby frame and `4` here, so it is probably solid-vs-flash. `90,90` and `15` are
unmapped; call out any obvious period or count.

**Then the question F10 was actually opened for:** with the headset **lit**, take a plain hit. **Does a
per-hit blink happen on its own?** We have never been able to observe this, because we have never lit
the headset. If it blinks unprompted, that is autonomous firmware behaviour and the manual's claim is
right after all — for the wrong reason.

> **If 1b passes, FFA can have white headsets** (`$HLED,6`) instead of every player on tid 1 (blue).

# 2 · F1 — does the native health gauge appear in OUR compiled games? · 5 min · eyes

**Why:** it deletes a planned feature either way, and it is five minutes. The three gun LEDs are the
gun's **own** segmented health gauge in the team colour (confirmed in native FFA 2026-08-30). Every
confirmed sighting was a **native** game.

**Method:** start one of our compiled games, take damage, watch the three gun LEDs.

- **Gauge steps down** ⇒ **FOLLOWUPS F1 is already shipped by the hardware.** Delete the feature; the
  only work left is the config field that selects Supremacy's Marauder armour-then-health variant.
- **No gauge** ⇒ F1 becomes a one-field config hunt (`$GSET`/`$PSET` diff vs a native game). Still not
  an LED driver.

⚠️ **Do not "fix" this with `$GLED`.** Painting the LEDs overpaints the native gauge and destroys it —
that error already cost an afternoon.

---

# 3 · 0.1 — ✅ SETTLED 2026-09-02: the fn 36/37 multipliers are REAL

**Result: fn 36 = floor(magnitude × 1.25) · fn 37 = magnitude × 2.** 16 trials, magnitudes
20/40/9/7, 8 different `$SIR` row-tail shapes, an **fn 1 control on subtype 0 in every trial** that had
to read the magnitude exactly or the trial was voided. 20 → 25/40 · 40 → 50/80 · 9 → 11/18 ·
7 → **8**/14. **The ×1.25 truncates**: 7 × 1.25 = 8.75 lands as 8, not 9. **Negative result:** the row
tail does not gate the multiplier (`0,0,1,,` / `,,,,` / `0,0,0,,` / `0,0,2,,` / `0,1,1,,` / none /
`0,0,1,60` all gave ×1.25 and ×2). *Still unexplained:* the 2026-08-27 24-cell ×1.0 matrix, which had a
valid fn 1 control, is **outvoted, not explained**.

**Why it mattered:** it gates **every published weapon number** — `weapons.json`, the ARSENAL and KIT
screens, the damage calculator, and the W2/W3 work. The plan as written is kept below.

**Weapon:** the **Force Rifle** (`R23`, magnitude 9) or the **Sniper Rifle** — both sit on
`$SIR,0,1,,36` in our table.

**Method:** arm a shooter with it, arm the victim from our stack, spawn both on **opposing teams**,
fire, and compare the victim's **`$HIR` token 5** (raw magnitude) against its applied **`$HP` delta**.

- `delta = 2 × tok5` ⇒ multiplier real, our emitter path is at fault
- `delta = tok5` ⇒ the ×1.25/×2 claim is wrong

⚠️ **Which `$SIR` table is in play.** The applied function is chosen by the **victim's** row, not the
shooter's. The victim must be armed by us to be on BLE at all, so **our** table decides that fn 36 is
what gets applied. That is fine — it is the configuration we ship and the numbers we would publish — but
it means a `delta = tok5` result reads *"fn 36 applies no multiplier **in our table**"*. Whether stock
BRX differs is a separate question needing a native capture.

**Record which gun was the victim.** Bench item 0.4 exists only because a previous run did not.

---

# 4 · 1.5a — ally re-measure from DEPLETED pools · 10 min · scripted, emitter aimed

**Why:** the whole ally half of the `$SIR` map was measured at **full** pools, so any heal or armour
grant **clamped** and read as "moves no pool" — i.e. got mis-binned as a status function. That is
exactly how **fn 10, a known heal**, ended up on the stun shortlist.

```
$PY /path/to/mcp/tools/ally_remeasure.py <victim_addr>          # emitter defaults to COM8
```

Arms, depletes, fires each ally function from the correct polarity, prints a verdict table.

- ⚠️ **fn 10 and 11 are the POSITIVE CONTROLS. If they do not read as GRANTs, the method is wrong and
  the rest of the table means nothing** — do not interpret it. Check the control before the result.
- A **VOID** row means the deplete never landed (aim or connection), **not** a result. The 2026-08-29
  run voided this way because the gun was in the screamer state.

---

## Stretch, only if the hour holds — 0.3 · does the SENSOR STRUCK change the applied function?

Five minutes, and it may explain **two** unreproduced results at once (fn 36/37 ×2, and fn 24 damaging
in an operator-held run). **20/20 of the rig's hits landed on `$HIR` tok1 = 4 (gun body)** — it cannot
produce a dome hit at all, which is why this needs a human re-aiming.

Fire the **same word** twice: once at the **headset dome** (expect `$HIR,0` or `,1`), once at the **gun
body** (`,4`). Use fn 24 on protocol 7, magnitude 20 ×2, and read the `$HP` delta. Different delta ⇒ the
function map needs a sensor qualifier.

*(Protocol framing is already ruled out: a 50-cell matrix showed the classes do not vary across
protocols 0/5/7/9/10.)*

---

## Everything that is NOT in this hour, and why

| item | why not today |
|---|---|
| **F3** empty-mag / reload prompt on sustained auto | **narrowed 2026-09-01 to the phone-side path** — the gun and engine are both eliminated from captures. Needs **"Share log" hit on the phone** after a match, not a bench |
| **F4** weapon-swap duration | `engine.lastSwitchMs` now records it; read it off the diagnostics log after the next match |
| **F5** the AR at 140 ms vs the captured 100 | a taste call, Tony's alone, not a measurement |
| **1.5** stun shortlist by ear (fn 8, 24-28, 35) | needs 1.5a's result first, or you burn trigger time on clamped grants |
| **2.1 / Q15** `$WEAP` t41 sub-indoor IR range · **2.4 / Q16** beam divergence | both need the tripod + distance rig |
| **4.1 / 4.2** (P13/P17) | **CLOSED 2026-08-30. Do not run.** |
| **F6** per-match CSV | ✅ closed 2026-09-01 (handoff W1) |

## Log it

`docs/experiment-log.md` — date, machine, tagger state, what was sent, wire evidence, **Tony's own
words for anything observed by eye**, conclusion. Then strike the items in `bench-tomorrow.md`.
