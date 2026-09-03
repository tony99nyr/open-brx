# The unknowns index — everything not yet confirmed

**One page, every open question, organised by *what unblocks it*.** Built 2026-08-27 by extracting the
open items from `FOLLOWUPS.md`, `verification-checklist.md`, `weapon-design.md` §5, `spec/node.md` §10,
`mode-limits.md` and `bench-tomorrow.md` — which is where they had scattered to.

**This file is an INDEX, not a replacement.** It carries one line per item; the detail, method and
evidence stay in the owning doc. If a row and its source disagree, the source wins.

- **`docs/bench-tomorrow.md`** = the subset that needs Tony, sequenced for a bench session. Use that on
  bench day; use this file to see the whole board.
- **`docs/FOLLOWUPS.md`** = the detail and the method for each item.
- **`docs/manual/*.md` → `## Research backlog (held — NOT published)`** = the *manual-facing* view of
  the same board: every BRX fact that was **held back from the public manual** because it is
  unconfirmed or contradicted, listed next to the page it would go on, with both values where sources
  disagree. Confirming an item there means promoting it into the page above it (`manual/README.md` →
  *How a fact gets in*). Those sections are the detail; this index doesn't restate them.

---

## A. Blocked on TONY AT THE BENCH  ·  27 items

Nothing here can be cracked from the keyboard — it needs a trigger pulled, a sound heard, a light seen,
or floor space. This is the biggest category and the highest-value one.

### A1 · Needs a TRIGGER or BUTTON PRESS (12)
| id | unknown | why it matters |
|---|---|---|
| ~~1.2~~ | ✅ **ANSWERED 2026-08-27 — NO.** fn 23 does not stop the gun firing (trigger-verified) — it appears to **silence** it. ⚠️ The *firing* half is directly measured; the *audio-level* reading of `$ALCD` t2 is the best explanation of **one ear report plus one meter moving together, not two independent instruments** (see `experiment-log.md` confidence note). t2 goes 100 → 0 and recovers over ~6–8 s. A mic, or `$VOL` sweeps against t2, would settle it. | the proxy was wrong — see the log |
| **U11′** | **Which `$SIR` function, if any, is an actual STUN?** fn 23 eliminated (it is audio suppression). ⚠️ **2026-08-27: the prior sweeps of fn 3/8/23-28/35 are VOID** — they fired from an enemy team, and support-polarity functions are discarded with no `$HIR` from an enemy source, so a real stun would have presented as "no effect". The both-teams 0-40 re-sweep is **DONE** (50 cells + trailing control): the enemy-polarity shortlist is 8, 24, 25, 26, 27, 28, 35 (fn 3 dropped 2026-08-29: it drains shield, so it is damage) — all register a `$HIR` and move no pool. ⚠️ The *friendly* candidates are contaminated by a full-pool ceiling artifact and need re-measuring from depleted pools. | category 10 "Stun" still unbuilt. **Best lead is a human trigger-test of the shortlist** (`bench-tomorrow.md` 1.5). Capturing the native Sentinel EMP pins its protocol/subtype but **cannot tell us the function** — the effect is decided by the *victim's* `$SIR` row, and a native game's table is unreadable to us. ⚠️ It has **never been captured**; an attempt during the frame-splitting era produced no decodable word, so we do not actually know it emits IR at all. ⚠️ **Splitting is NOT fixed** — see `FOLLOWUPS.md` **F12**: our emitter decoded whole only 4/20 and a REAL BRX gun 3/44, every frame arriving as a full 52 edges. Fix the receiver first |
| **NEW** | **Capture the native Sentinel EMP ability word** | the stun answer, straight from BRX. ⚠️ **The rig is NOT ready** — the receiver fragments frames (F12). A capture taken today would be fragments recorded as facts |
| **NEW** | **Capture a `$GREN` accessory word intact** — **no gun needed**, host-driven; see D 3½.1, not duplicated here | ⚠️ blocked on the same receiver fault (**F12**) — long accessory words are its worst case |
| ~~**NEW**~~ ✅ **ANSWERED NO 2026-09-02** | ~~Which token drives LED life mode?~~ **None of ten candidates** (`$GSET` t8 gameMods 1/2/4/8/16, `$GSET` t4, `$GSET` t5, `$PSET` t2), each driven to ~30% of pools with the three LEDs always moving TOGETHER. The native gauge does not switch on in a host-driven game -- we paint it ourselves (F1). ⚠️ Scope: ten fields, single bits only for t8, no combinations. | closed |
| **1.3** | Does a stun cost the victim a reload? | decides the stun's real cost |
| **K4 / 1.1** | Why does **melee not work in our compiled game**? | a stock feature we lose; frames are byte-identical to Callsign's, so it is runtime/state |
| **1.5** | What do status functions 8, 24–28, 35 (fn 3 dropped 2026-08-29: it drains shield, so it is damage) (enemy) and 31, 32, 34 (ally) *do*? | they register but move no pool and emit nothing — invisible without a human |
| **1.6** | Is the KotH **rate-of-fire buff** one of the ally-side no-pool functions? | would name 31/32/34 |
| **K1 / 1.4** | Kid auto-reload: `alt_reload` (`$BMAP,1,97`, already ships) vs `$WEAP` t19=5 (`AutoReload`; the empty-magazine half is answered NEGATIVE 2026-08-27, only the fire-triggered case is left) | two different features; which does Tony want |
| **U4 / U5** | Reload-chain timing vs `reload_ms`; held-trigger fire sound retrigger vs ring-under | weapon sound design |
| **t37/t38** | What do the two overheat values (20 vs 150) each mean? | overheat is transplantable but unmapped |
| **A10a** | Empty **slot-2 button map** `$BMAP,1,100,0,0` — what does an ALT press do with no second weapon? | *(loadout v2, brx-fable)* expect nothing; then fire to prove the gun isn't **wedged** |
| **A10b** | **Body Armor** — push the head, read `$LCD`, take one hit: does the armor actually absorb? | *(loadout v2)* also answers the field-width question below |
| **A10d** | **Easy Reload** — ALT press on an empty mag → does it reload? | *(loadout v2)* button + ears |

### A2 · Needs EYES (5) — **the LED cluster, entirely unconfirmed**
| id | unknown | why it matters |
|---|---|---|
| ~~**P13**~~ | ~~Is `$GLED` colour a single 0–8 index?~~ | ✅ **CLOSED 2026-08-30, palette completed 2026-09-02** — yes, and there are **three** independently addressable LEDs. Nine colours: 0 red · 1 blue · 2 yellow · 3 green · 4 purple · 5 teal · 6 white · **7 pink · 8 orange** (9/10 dark). Indices 7/8 were read off a gun 2026-09-02 with the camera rig. `$HLED` token 1 shares the palette for 0-7 and diverges at 8 (red on the headset, orange on the gun). |
| ~~**P17**~~ | ~~How do you turn the LEDs **OFF**?~~ | ✅ **CLOSED 2026-08-30, mechanism corrected 2026-09-02** — send Callsign's own `$GLED,,,,5,,,*`, which is what we ship. ⚠️ **It does not work because "5 = off".** Token 4 is an **apply gate**: 0/6/7/8/9/10 apply the frame's colour tokens at full brightness, 5 applies them at about 1/3 brightness, and 1/2/3/4 are **no-ops** that leave the previous colour lit. `$GLED,,,,5,,,*` blanks the gun because **its colour tokens are empty and t4=5 applies them** — applying an empty colour is what turns the LEDs off. **There may be no dedicated off value at all**, which is why the originally recorded `$GLED,,,,3,,,*` failed (3 is a no-op) and why 6 and 7 also blanked with empty colours (they also apply). Use the Callsign frame. |
| ~~—~~ | ~~**LED life mode**~~ | ✅ **ANSWERED 2026-08-30** — the pulse **is** the native life gauge. Open part moved to **FOLLOWUPS F1**: does it appear in *our compiled* games? |
| — | **Try-out LED strobe** — LEDs show the unspawned pattern during tutorials | looks broken to a player |
| **A10c** | **Extended Mags HUD max** — does the HUD's mag/reserve cap match the `$AMMO,0` we write (64/768)? | *(loadout v2)* **eyes only, no trigger** — compare HUD to the frame |

### A3 · Needs EARS (3)
| id | unknown |
|---|---|
| **P3** | `$PSET` voice-pack token → which line changes (or get it from the API capture, §C) |
| — | Defeat announcer line (`JAW`/`JAX` sit next to the confirmed `JAY`) |
| **A10e** | **Quick Hands** — fire a mag dry and reload: does the D-family reload sound **chain clip** against the halved `t18`? | *(loadout v2)* trigger empties the mag, but the unknown is **audible** |

### A4 · Needs SPACE / a tape measure (4)
| id | unknown | why it matters |
|---|---|---|
| **U2 / 2.1 / Q15** | Does `$WEAP` **t41** change emitted range? ⭐ **Now a product need, not just a gap** (Q15): native indoor is too strong for tight spaces and bounces register hits. t41 reads **75 on all 18 guns, 20 on melee**, and that melee value is real evidence the field drives range. | **the last unresolved weapon token**; now measurable by IR instrument, no victim gun |
| **2.2** | The **"halo assassinate"** — is a back-dome melee a different word, or the same word on a different sensor? | melee is magnitude 90 and should *not* one-shot |
| **2.3** | Sensor map (tok1 0/1/4) at field distance | point-blank washes the domes together |
| **P15** | Max simultaneous BLE connections a phone holds; which `$PLAY` id makes a field-wide alarm | phone-as-station design |

---

### A5 · Protocol field widths (1) — answered by a bench push, not a capture
| id | unknown | why it matters |
|---|---|---|
| ~~**A10b′**~~ ✅ **CLOSED 2026-08-27** | ~~Does `$PSET` armor accept > 255, and does the gun CLAMP or WRAP?~~ **Neither — pools are not 8-bit.** **Armor and HP** store and decrement exactly to at least **1000**, clamping at zero with no wrap (`$QUERY` readback + live `$HP`). **Shield was not measured that far** — grant-saturation only, cap 600 / reached 500, never decremented above 255. The 255 cap is our policy, not a device limit.** | our policy layer caps at 255 as an *assumption*; the wire has never been asked. A wrap would make a "tanky" preset silently fragile. Cross-ref `weapon-design.md` `$PSET` notes |

---

## B. Blocked on THE GRENADE  ·  6 items
*The biggest single unlock left: if we can replay a station beacon, the Utility Box can impersonate a
grenade and the whole objective tier opens.*

> 🔴 **Every item here is gated on the receiver first — see [`FOLLOWUPS.md`](FOLLOWUPS.md) F12.** Board
> A splits one arriving frame into 2-4 pieces and decodes none of them (measured 2026-09-02: our
> emitter 4/20 clean, a REAL BRX gun 3/44). Capturing what the grenade beacons is exactly the long
> accessory word this fails hardest on, and `IDLE_GAP_US` was already raised once *for the grenade*
> and did not reach. **Anything captured on this board today would be fragments read as facts.**

| id | unknown |
|---|---|
| **3.1** | What each mode actually beacons (predicted: protocol 15, mode in the magnitude field — Respawn 6, Hill 8) |
| **3.2** | The **Hill buff word** — capture what the grenade sends the holder |
| **3.3** | Does a **replayed** beacon from our emitter make a gun behave like the real grenade? |
| **B12 / 3.4** | Respawn **arming**: does the passive beacon alone arm a living tagger, or is the button press required? Does it persist all match? |
| **G9 / 3.5** | **CTF flag team assignment** — likely the `$GREN` `channel` field |
| **G10 / 3.6** | `$GREN` blast type on a **paired thrown** grenade (needs an install-accessory pairing) |

---

## C. Blocked on a CAPTURE  ·  5 items
**▶ Next 30-min session: [`bench-next-30.md`](bench-next-30.md).**  ▶ Method for the capture items: [`capture-runbook.md`](capture-runbook.md)** — written 2026-08-27; they had a
name but no plan. MacBook + iPhone only (Callsign is iOS, PacketLogger is macOS); batch for Mac day.

| id | unknown | note |
|---|---|---|
| **P8 / R1** | **Callsign HTTPS API** (`settings`, `voice-profiles`, `arenas/games`) | **gun-free.** Would hand us every ability parameter, weapon stat and voice pack **at once** — the single highest-yield item on this page |
| **P3** | voice-pack presets | falls out of P8 |
| **P12** | `$PB*` playbook enum tables, re-tested on v4.32 | behaviour is version-sensitive |
| **G3** | The app configuring a grenade → the exact `$GREN` | |
| **R2** | Re-scrape the FB group **with comments expanded** | the 08-24 crawl missed comment threads |

---

## D. Blocked on HARDWARE WE HAVE BUT HAVEN'T WIRED  ·  4 items

| id | unknown | note |
|---|---|---|
| **D1 / D4** | **The nRF radio** — is there a native gun-to-gun mesh? Does it carry the multikill kill-confirm? | modules + adapters are in hand, unwired. **Time-box the mesh tap to 30 min** — unknown channel/address/CRC/rate |
| **3½.1** | Capture a **`$GREN` accessory word intact** | needs `IDLE_GAP_US` raised or the RAW print cut — every frame so far was split |
| **3½.2** | Is that word **arg-drivable**? | if yes, the gun becomes a programmable accessory emitter |
| **3½.3** | Which emitter sends it — gun muzzle or headset? | cover one, then the other |

---

## E. Blocked on PARTS WE DON'T HAVE  ·  3 items
| id | unknown | plan |
|---|---|---|
| **P14** | Is the audio SD card removable/swappable? | **no plan — needs a teardown**; not worth the risk on a 4-gun fleet until there's a spare ([why](capture-runbook.md)) |
| **G4** | Is grenade `.bin` flashing real? | **no plan possible** — the assumed method is dead (G7). Nothing to try until someone finds a mechanism |
| ~~K3~~ | ✅ **CLOSED 2026-08-27 — CAPTURED.** The Sentinel death-nova is `proto=10 (StandardLethalExplosive), MAG=125, player/team = the DYING player` — replayable from any emitter. Note it out-damages the Rocket Launcher (115) and **credits kills to the corpse**. | ~~mechanism is expressible today~~ (`$WEAP` powerType `HeadSetOnly`/`GunAndHead` + `extraHeadsetDamage`) — build the weapon and fire it. **Belongs in a bench session, not here** |

---

## F. NOT unknowns — build work  ·  10 items
**⭐ B19 — MC config verification via `$QUERY`** is the newest and the cheapest big win: the gun reads
its configured state back (identity, pools, voice, every weapon slot), so MC can *verify* a pushed head
instead of assuming it. See FOLLOWUPS B19.

*No open question; someone just has to do it.* B1 Companion · B4 Utility Box (now unblocked) ·
B8/G5 grenade state app · B9 manual website · B11 custom connect voice · B14 voice selection ·
B16 kid mode · B17 tutorial mode · H1–H6 print files.

---

## G. DECISIONS, not unknowns — Tony's call  ·  3 items
| # | decision |
|---|---|
| 1 | **Energy Launcher deals zero damage in every shipped game** — fix required either way |
| 2 | **Flatten `_SIR_TABLE` or retune five weapons.** Flatten costs no retune; it restores the already band-checked §2 numbers |
| 3 | **Q12** — should `hit_taken` include the **shield delta**? (both sessions recommend yes; `dmg: 0` invites `if dmg:` guards to drop the event) |

---

## H. Field / scale verification  ·  needs players, space, time
`verification-checklist.md` carries ~24 unverified items that aren't protocol unknowns but *system*
proofs: combat modes on real guns, live-path resilience with a tagger off, teardown, 20-minute two-node
soak, phone auto-rejoin, iOS locked-phone BLE, `$VOLTS` token decode, armory/muster end-to-end, FFA
attribution and the attribution fuse, syphon, time-limit/respawn ramp. **Not indexed line-by-line here —
that file is already the right home.** Read it before a field day.

---

## Scoreboard
| category | items |
|---|---|
| A · needs Tony at the bench | **27** (12 trigger/button · 6 eyes · 3 ears · 4 space · 1 field-width · 1 capture-at-bench) |
| B · needs the grenade | 6 |
| C · needs a capture | 5 |
| D · hardware in hand, unwired | 4 |
| E · parts we don't have | 3 |
| F · build work, no unknown | 9 |
| G · decisions | 3 |
| H · field/scale proofs | ~24 (see verification-checklist) |

| ~~**Q14**~~ | ~~fn 36/37 multipliers DISPUTED~~ ✅ **CLOSED 2026-09-02: the multipliers are REAL — fn 36 = floor(magnitude × 1.25), fn 37 = magnitude × 2** (16 trials, magnitudes 20/40/9/7, 8 `$SIR` row-tail shapes, fn 1 control every trial; ×1.25 truncates, 7 → 8). The 2026-08-27 24-cell ×1.0 matrix is **outvoted, not explained** | what still gates a published hits-to-kill is that this is measured through **our** `$SIR` table; whether the app pushes the same table every game is untested |
| **Q13** | **Friendly fire is invisible on the wire** — a team-blocked shot emits no `$HIR` at all | a DECISION, not a test: no teamkill feedback can be built from gun telemetry while `$GSET` t1=0 |
| **B20** | **Is `$LCD` token 3 the shield?** | one-line check; gates whether a mid-life client can learn the shield from anything but `$HP` |
| **R2** | **Add a `DUTY` command to the IR emitter** | would make the sensor and range tests answerable unattended |
| **Q16** | **What is the IR beam divergence?** | decides snoot vs attenuator for indoor bounce; receiver-only, ~10 min. The emitter is a collimated Class 1 laser, so the prior is a tight beam and no useful off-axis skirt |

**If you do only one thing:** the **Callsign HTTPS API capture (P8)** is gun-free and would collapse
several rows at once. **If you have a bench hour:** `bench-tomorrow.md`'s one-hour path.
