# One-hour bench session — 2026-09-01

**A dated SELECTION from [`bench-tomorrow.md`](bench-tomorrow.md), which remains the queue.** Nothing
here is new work; it is the four highest-value items that fit in an hour, ordered, with every gate that
can void a result stated up front. When the hour is done, results go in `docs/experiment-log.md` and the
items get struck in `bench-tomorrow.md`.

**Budget:** 5 gate + 12 + 5 + 15 + 10 = 47 min, leaving ~13 min of slack. **If you run short, item 1 is
the one to protect** — it is the only item testing code we are *already shipping unverified*.

---

## 🚨 GATE 0 — THE REPO IS THE BLOCKER. Fix this before touching a tagger.

**Item 1 tests `$HLED` frames that are NOT in this working tree.** The Mac decoded and shipped them
(`6c4550c`, on `origin/main`); this checkout is **3 commits behind** and has **51 files / ~2300 lines of
uncommitted work** (the W2/W3 pool + ammo work) that makes `git pull` abort.

`brx-mcp` is installed **editable from this WSL path**, so whatever is checked out here is literally what
the guns get. Bench item 1 against the current tree and the headsets stay dark for a reason that has
nothing to do with the hardware.

```
grep -c HLED mcp/brx_mcp/mc/compile.py     # MUST be >= 3.  Right now it is 0.
git log --oneline -1                       # MUST be 0142d4c or later
```

**Resolving it is the other session's call, not the bench's** — that uncommitted work is real and
un-pushed. Either it commits and pulls, or it stashes and pulls. **Do not `git checkout --` anything.**

> If GATE 0 cannot be cleared in time: **skip item 1 and run 2 → 3 → 4.** They are all independent of it.
> Say so in the log rather than recording a false negative on `$HLED`.

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

# 1 · `$HLED` — confirm the two frames we are already shipping · 12 min · eyes

**Why this is first.** The Mac decoded headset feedback from captures already on disk and **shipped it
into the head of every game we compile**, correctly marked UNCONFIRMED. Until someone looks at a
headset, every game we run carries two unverified frames. Nothing else on this list is live code.

**What Callsign does (byte-verified in `2026-08-23-two-tagger-combat.btsnoop`, independently re-checked
2026-09-01 including the fragmented tail):**

| when | frame | who |
|---|---|---|
| pre-game, with `$GLED` | `$HLED,<n>,0,,,10,,*` | every gun, every captured game |
| armour 0 → HP dropping | `$PLAY,VA8B,3,6,,,,,*` then `$HLED,7,4,90,90,10,15,*` | the **victim**, once per life |
| end of game | `$HLED,,6,,,,,*` | every gun |

**There is no per-hit and no per-kill headset frame** — 23 `$HIR` hits produced 2 alerts; 3 kills
produced none.

### 1a · Pre-game team colour · 3 min
Arm a gun from our stack (any compiled game) and **look at the headset**.
**Pass:** the headset lights in the team colour at arm time. **Fail:** dark → the frame is not landing,
or token 1 is not a colour.

### 1b · ⭐ The load-bearing inference — is `$HLED` token 1 the `$GLED` palette? · 6 min

**Why this is not already answered.** The shipped code puts our `$TID` value straight into `$HLED`
token 1, reasoning that both use one palette. But **Callsign sends no `$TID` at all** — not in
`two-tagger-combat`, not in `solo-game-full-arm`, not in `two-gun-3-kills-sflash` (`$TID` is a
LaserTagMods/bench command, not in the app's vocabulary). So no capture correlates the two. The support
is indirect: `$TID` 1→blue and 2→yellow were observed on the bench, and both match the `$GLED` palette.

**Method — ONE VALUE AT A TIME, WAIT FOR THE CALL (GATE 2 rule 2).** With a gun armed and a live
headset, send `$HLED,<n>,0,,,10,,*` for n = 0,1,2,3,4,5,6 and **say the colour you see** for each.

**Predicted, if the palette is shared:** 0 red · 1 blue · 2 yellow · 3 green · 4 purple · 5 teal · 6 white.
**Pass:** the map matches. **Fail:** any divergence — record where, because `compile.py` is writing
`tid` into that token on every game head. Our tids are blue=1 · yellow=2 · red=0 · green=3 · **ffa=1**.

**Bonus, and it closes a genuinely open item:** carry the sweep to **n = 7 and 8**. Those two palette
indices have never been read off a gun (`manual/06-developer.md` research backlog); a community lead
says 7 pink, 8 orange. The low-health alert in 1c uses **7**, so this is not idle curiosity.

### 1c · The low-health alert · 3 min
Send `$HLED,7,4,90,90,10,15,*` on a live headset. Note **colour** (that is index 7) and **behaviour** —
token 2 is `0` in the pre-game frame and `4` here, so it is probably solid-vs-flash. `90,90` and `15`
are unmapped; if the flash has an obvious period or count, say so.
**Pass:** the headset does something visibly distinct from the 1a solid colour.

> **Outcome worth knowing either way:** if 1b passes, **FFA can finally have white headsets**
> (`$HLED,6`) instead of every player on tid 1 (blue) — Tony's own note that native FFA is white.

---

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

# 3 · 0.1 — settle the DISPUTED fn 36/37 multipliers · 15 min · two guns + trigger

**Why:** it gates **every published weapon number** — `weapons.json`, the ARSENAL and KIT screens, the
damage calculator, and the W2/W3 work the other session is doing right now. Two of our own datasets
disagree (×2 vs ×1.0) and four hypotheses were tested and refuted.

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
| **M2** gun stops `$ALCD` under sustained auto | needs a **match** with phones, not a bench; needs "Share log" hit on both phones |
| **M3** weapon swap duration | read off the diagnostics log after the next match, no bench action |
| **M4** the AR's identity (140 ms vs stock 100) | a taste call and Tony's alone, not a measurement |
| **1.5** stun shortlist by ear (fn 8, 24-28, 35) | needs 1.5a's result first, or you burn trigger time on clamped grants |
| **2.1 / Q15** `$WEAP` t41 sub-indoor IR range | needs the tripod + distance rig, the setup Tony called a pain |
| **2.4 / Q16** beam divergence | same rig |
| **W1-W5** | code-only, no tagger, belongs to the Windows session |
| **4.1 / 4.2** (P13/P17) | **CLOSED 2026-08-30. Do not run.** |

## Log it

`docs/experiment-log.md` — date, machine, tagger state, what was sent, wire evidence, **Tony's own
words for anything observed by eye**, conclusion. Then strike the items in `bench-tomorrow.md`.
