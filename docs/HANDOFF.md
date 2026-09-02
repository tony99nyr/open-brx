# Handoff — Open BRX

**Updated:** 2026-09-01.

> ## 🏆 2026-08-30/31 — THE FIRST FULL MATCH RAN ON OUR OWN STACK, and 16 things it exposed.
> Two phones, two taggers, one MacBook hosting: a 300 s FFA start to finish — **12 kills, 126 landed
> hits, 24 respawns, a winner.** That closes the top `[UNVERIFIED]` in `field-runbook-mc.md`: the
> MC↔phone↔gun field path is **hardware-verified**.
> **Everything reported that day is fixed** (mcp 542/542 · engine 54/54 · e2e 75/75). What is left is
> split by machine in **[`handoff-post-first-match.md`](handoff-post-first-match.md)** — read it before
> picking up field work; the two highest-value items are **Mac-only**.
>
> ### 2026-09-01 — the whole Windows lane of that handoff is done (W1–W5), and the 2026-08-26 ledger with it
> Suites now: **mcp 579/579 · app 70/70 · MC console 69/69 (new) · e2e 75/75.** In order of what it
> changes about the product:
> - **Weapon stats follow the host's health config.** `POOL = 115` was hardcoded, so KIT and ARSENAL
>   both said the AR takes 13 hits at any health setting — at a 100/100 game it takes 23. Both
>   screens now name the pool they are quoting.
> - **Every published weapon number is now derived from the frame we actually ship**, and a test
>   fails if a hand-set one drifts — `weapons.json`'s five stat fields, plus `weapon-design.md`
>   §2.2's whole balance table (DPS and sustained DPS included) and §2.5's sensitivity table. Both
>   historical defects (the AR's `rof: 53` vs a derived 54, the stale DPS columns) reproduce and are
>   caught. This is the answer to *"every defect was found by a person, none by a test."*
> - **The MC console has a test suite at last** (`cd webapp/mc && npm test`). It found two live bugs
>   on its first run: the `PH[-1][1]` crash was still present in the status bar, and KIT called two
>   hooks below its `if (!state) return null`.
> - **Any past match exports its own CSV** (`GET /api/matches/{id}.csv`); the RECAP picker no longer
>   has to hide the button on an archived game.
> - **The 2026-08-26 deferred-lows ledger is worked and closed** — 15 rows: 14 fixed, one
>   (CORS `*`) deliberately kept with the reason written down. 11 of the 14 name a test; the rest
>   are copy or wiring changes with no sensible unit. See FOLLOWUPS.
>
> ### 2026-09-01 — and the OTHER lane decoded the headset, from captures already on disk
> Running in parallel on the Mac, so read both. **M1 is CLOSED**: Callsign sends a pre-game
> `$HLED,<team>,0,,,10,,*`, a once-per-life low-health alert (`$PLAY,VA8B` + `$HLED,7,4,90,90,10,15,*`
> at armour-0 → HP dropping), and an end-of-game blank — **and no per-hit or per-kill headset frame at
> all**. We sent none of the first two, which is why our headsets were dark for a whole match. Both are
> shipped in `compile.py` and `engine.js` and are **UNCONFIRMED on hardware** — the next match should
> look at the headsets pre-game. **M2 is narrowed**: the gun and the engine are both eliminated as
> suspects, again from captures on disk. That lane also swept leftovers, hardened the APK/site
> pipeline, and rebuilt the site.
>
> ⚠️ **What is NOT settled**, and matters for the public manual: whether a per-hit blink happens
> autonomously *once the headset has been lit* by that pre-game frame. We have never seen the lit
> state, so we have never been in a position to observe it. `docs/manual/` currently publishes
> "blink on a hit, hold on a kill" as a ✅ confirmed fact — that marker is not earned. It is a
> 12-minute eyeball test at the next bench session, not a capture; settle it, then fix the manual.
>
> Still open and needing the hardware: **M2's last layer**, **M3 timing a weapon swap**,
> **M4 the AR's identity** — plus the `$HLED` confirmation above.
> Two corrections that change what you believe:
> - **The headset green flash is HOST-DRIVEN, not autonomous.** 126 hits, both headsets healthy all
>   match, no green. The 2026-08-27 "we get them free" entry is corrected in place — and as of the
>   same day it is **decoded**: see the section above for the exact frames.
> - **`$VOL,69` is on-gun level 2.** Play volume is now venue-driven (80 indoor / 90 outdoor); the
>   CLAUDE.md hard rule and the spec/manual pages were updated with it.
> Also: the AR was retuned (140 ms / 192 reserve — the 190 ms nerf cost it its identity), weapon stat
> bars are ranked across the arsenal (raw `dmg` is a *share of a 115 pool*, so every meter read empty),
> and `golden_bundle.json` had been **five days stale** — now pinned by a test.

**Read [`docs/gotchas.md`](gotchas.md) before any bench work** — the field
lore, indexed by symptom; several of those quirks each cost a whole session.
[`docs/unknowns.md`](unknowns.md) is every open question grouped by what unblocks it.
**The bench queue is [`docs/bench-tomorrow.md`](bench-tomorrow.md), and it is the ONLY one.**
[`bench-next-30.md`](bench-next-30.md) is a 30-minute subset of it; `bench-plan-hardware.md` is
**superseded**. If two documents disagree about what to do first, bench-tomorrow wins — and its
**START HERE** block names the first three things in order.

> ### ⚠️ 2026-08-30 — `$GLED` SOLVED, and the LED "pulse" was the health gauge all along
>
> - **`$GLED,<led1>,<led2>,<led3>,<t4>,<brightness>`** — the three gun LEDs are **independently
>   addressable**, each a direct palette index (**0 red · 1 blue · 2 yellow · 3 green · 4 purple ·
>   5 teal · 6 white**). **t4 = 3 blanks all three** (night mode, **P17 closed**). The old
>   "colour is team-derived, `$GLED` = mid/effect/optionA/optionB" reading is **wrong**.
> - **The pulsing LEDs on a spawned gun are the gun's OWN health gauge**, not interference. Supremacy's
>   Marauder shows armour then health and reverts to team colour unaided. So the pool-status feature
>   (**F1**) is likely a **config** question, not an LED driver — and *"does that gauge appear in our
>   compiled games?"* is a five-minute test that could delete a planned feature.
> - **Q17 FIXED in code** — kills were credited by shooter *team*, so per-player attribution collapsed
>   whenever a team held 2+ guns. Now resolved by `$HIR` token 3 (shooter player id). 535 tests green.
> - ⚠️ **A whole afternoon was lost to a method bug**: timed sweeps racing an asynchronous human
>   observer, which bound observations to the wrong frames and produced two confidently wrong theories.
>   **Never advance an operator-in-the-loop sweep on a timer** (`gotchas.md`).
>
> ### ⚠️ 2026-08-27/29 — THREE THINGS THAT CHANGE HOW YOU TEST. Read before planning anything.
>
> **1. IR is TEAM-GATED, and a wrongly-teamed shot is INVISIBLE.** Damage lands only from an enemy
> team; heals, shields and other grants land only from your own. A wrongly-teamed frame is discarded
> with **no `$HIR` at all**, so it is indistinguishable from a dead emitter or a function that does
> nothing. This **voided** several earlier "no effect" negatives. Every IR test must state its shooter
> team, and a silent cell is a **void trial, not a negative**.
>
> **2. Two measurement artifacts in the `$SIR` function map.** The victim was re-armed to **full**
> HP/armour, so a heal or armour grant **clamps** and reads as "no pool change" (this mis-binned
> **fn 10**, a known heal). And the shield started at **0**, so a shield-only drain also read as no
> change (this mis-binned **fn 3**, which is actually damage). Before calling anything a status
> function, check the pool it would move had somewhere to go.
>
> **3. The crit formula and the damage multipliers changed.** `crit = magnitude × (1 + $GSET t7/100)`.
> It is a **per-game knob**, not a fixed ×1.5 — that value is only the shipped t7=50. And the
> **fn 36 / fn 37 multipliers are ✅ CONFIRMED (2026-09-02, bench item 0.1 CLOSED): fn 36 =
> floor(magnitude × 1.25), fn 37 = magnitude × 2** — 16 trials, magnitudes 20/40/9/7, 8 `$SIR` row-tail
> shapes, an fn 1 control in every trial; the ×1.25 **truncates** (7 → 8). Tune weapons on them.
> *Retracted:* the "DISPUTED, did not reproduce in 24 controlled cells" reading. That 24-cell matrix is
> **outvoted, not explained** — we still do not know why it read ×1.0.
>
> Also since: `$GSET` t1 = friendly fire (enforced) · `$PSET` t5 = shield **capacity**, spawn shield is
> always 0 · pools are **not 8-bit** (armour and HP exact to 1000; shield not measured that far) ·
> **Q12 fixed in code** (the shield pool is parsed and counted; it was silently dropping hits) ·
> the stun shortlist is **fn 8, 24, 25, 26, 27, 28, 35**.

> **⚡ 2026-08-27 — a live Supremacy session, and four retractions.**
> - **K3 CLOSED — the death nova is CAPTURED**: `proto=10 (StandardLethalExplosive), MAG=125,
>   player/team = the DYING player`. Out-damages the Rocket Launcher, **credits kills to the corpse**
>   (MC's scorer must expect a `$HIR` naming someone already dead). Replayable from any emitter.
> - **`$SIR` fn 23 is AUDIO SUPPRESSION, not a stun** — the gun keeps firing and keeps emitting IR, it
>   just goes silent for ~6–8 s. **`$ALCD` token 2 is the gun's AUDIO LEVEL**, not a ready flag.
>   **U11 is REOPENED; category 10 "Stun" is still unbuilt.**
> - **WITHDRAWN: "fns 24–27 deal damage"** (did not reproduce) and **"the function map is
>   protocol-dependent"** (it is not — identical on 5 and 7).
> - **`$SIR` functions carry their own victim AUDIO** even with an empty sound column: electrical (3),
>   shotgun (24), growing hiss (25/26), normal AR (27), gas hiss (28).
> - **Enum anchors 7 and 8**: the charge weapon emits **protocol 8** (Shrapnel) *alongside* protocol 0 —
>   a native weapon emits **two protocols per trigger pull** — and the death nova emits **protocol 10**.
> - **Headset LEDs are autonomous**: **rainbow = disconnected** (now Muster step 0 — a free pre-game gate
>   for B18b), team colour **pre-game only**, **dark during play is normal**, green blinks on hit / holds
>   on kill.
> - **⚠ The stun may not be findable by sweeping.** The effect of an IR hit is decided by the **victim's
>   `$SIR` row**, not the shooter's word — and a stun that only stops the victim's trigger moves no pool
>   and emits no BLE frame, so it is invisible to every instrument we have. It needs a human on the
>   trigger, one candidate at a time.
> - **`$GREN` is NOT a programmable emitter** — its emission does not track its arguments.

**(Previous header)** 2026-08-26, end of the marathon Windows/WSL bench + build session. Read `CLAUDE.md`
first, then this, then `docs/FOLLOWUPS.md` (all open work incl. the polish-loop deferred-lows
ledger), then the newest `docs/experiment-log.md` entries. Protocol ground truth:
`protocol/brx-protocol.md` (§6.1 + the t20/overheat/tok1 sections at the end).

> **⚡ LATEST (2026-08-26 overnight) — THE IR TRANSCEIVER IS NOW A GENERAL-PURPOSE INSTRUMENT.**
> (exp-log entries from "B13 CLOSED" onward — all bench-measured, controls passed, replicated)
> - **B13 CLOSED**: BRX IR word bench-verified (sync ~1990 µs, marks 992/500; field offsets pinned by
>   pushing known $WEAP frames) and the **Z trailer is computed parity** (odd 1s→01, even→10).
> - **🏆 A stock tagger accepts fully synthetic shots** from our ESP32+LED rig (invented player/team/
>   damage land as real $HIR) — the Utility Box (B4) emit side is PROVEN. Emitter has standalone AUTO-TX.
> - **$SIR is a programmable 16-protocol × 4-subtype effects matrix (64 cells, all writable over BLE)**
>   with a complete two-sided function map: damage / armor-piercing (fn 2,6) / fn 36 and fn 37 multipliers
>   (**floor(mag ×1.25) / mag ×2 — ✅ CONFIRMED 2026-09-02, see the banner above**) / heal variants / add-armor / add-shield / **dual-polarity heal-ally+damage-enemy**
>   (fn 16,17,20…) / status-only ids. The IR damage field is a **magnitude** whose meaning the row's
>   function sets. **B = the DamageType enum**; with the 2-bit subtype it forms the `$SIR` composite key (16 x 4 = 64 cells, all writable by us). *(An earlier "~10 free slots is a real design constraint" framing is retracted — see `brx-ir-protocol.md`.)*
> - **P16 CLOSED — shields DO activate** (IR event, never a BLE pool value; drain shields→armor→HP).
>   **Crit echoes `$HIR` tok6** and applies `1 + $GSET t7/100` (×1.5 only at the shipped t7=50). **U7 CLOSED** (damage field = 8 bits, 0–255).
> - **FF CORRECTED: `$GSET` token 1 IS friendlyFire and IS firmware-enforced BOTH directions**
>   (t1=0 blocks same-team damage AND enemy heals — four-cell matrix, replicated). The earlier
>   "host-side only" reading generalised an FF=1 observation; the evidence always agreed.
> - **A DEAD gun accepts NO IR** (448-word brute force) → respawn stations **arm the living** (B12).
> - Also closed: P4 **in part** — `$AS`/`$UP` are proven **silent** (no reply to 7 shapes on v4.32), but their *effect* was never probed · B5 (mcp 2.0 port was already done).
> - Rig lore: phone cameras can't see a ~5 mA IR LED; VS1838B AGC saturates point-blank (attenuate for
>   loopback); the capture sketch's RAW print truncates frames landing in its ~15 ms window.

> **⚡ LATEST (2026-08-26) — the protocol map is essentially DONE and the arsenal is real.**
> Bench-proven on live taggers, all committed with evidence + instruments:
> - **$WEAP**: t5=the RAW magnitude (applied = magnitude x the victim's $SIR-function multiplier x (1 + $GSET t7/100) if crit; fn 36 = floor(mag x 1.25), fn 37 = mag x 2, confirmed 2026-09-02) · t14=fire interval · t15=850 constant (never write) ·
>   **t20=FIRE MODE** (0 auto / 7 single-bolt / 9 burst / 2·3·14 charge variants / 13 melee — proven
>   by one-field flip) · t23=burst cycle · **overheat = t24+t35 GATED by t37/t38** (transplantable).
> - **$HIR fully decoded**: tok1 sensor (0=headset FRONT dome, 1=BACK dome, 4=gun — shield-isolated),
>   tok2=IR-protocol echo, tok3=shooter pid, tok4=effective team, tok5=the RAW magnitude (NOT applied damage), tok7=subtype.
> - **$TID & 3 → four usable teams**; ~~friendly fire is NOT firmware-enforced~~ **[CORRECTED overnight: `$GSET` t1 IS
>   firmware-enforced FF — see the LATEST block above]**; $SFLASH latches green unconditionally; $STUN direct = no-op; a bare
>   $WEAP re-push RESETS ammo (pickups must re-send $AMMO); mapped damage types play their $SIR
>   sound on the victim (the heal/EMP audio path works).
> - **All 20 Callsign weapons captured** (`docs/reference/weapons.md`, raw btsnoops in
>   `protocol/captures/raw/`), catalog **re-based on the real frames** with a zero-dominance
>   rebalance + surgical sound overrides (byte-diff pinned; `docs/weapon-design.md`).
> - **MC/app**: session persistence (survives restarts), mDNS+sweep+in-app-QR discovery with
>   guards, device-first muster (claim a phone+gun in one gesture), dynamic game-state top bar,
>   weapon-range verdict system on Kit, auto log-pull at match end. Suites: mcp 499/499 (both
>   pythons), app 37/37, e2e 42/42. Windows MC: double-click `C:\Users\Tony\.brx-mcp\mc-start.bat`.
> - **🔌 THE IR + nRF KIT HAS ARRIVED (2026-08-26)** — ELEGOO 235-pc, CHANZON 940nm + VS1838B,
>   2× ESP32-S3-DevKitC-1, Aideepen 3× nRF24L01+PA/LNA + adapters. Playbook:
>   **`docs/bench-plan-hardware.md`** (sketches `hardware/esp32-ir-bridge/`, wiring
>   `hardware/ir-breadboard.svg`, host decoder `brx_mcp/irbridge.py`, CLI `ir-capture`/`ir-emit`/`ir-range`).
>   **This changes the method for several open items:** a VS1838B receiver replaces the *victim gun*
>   as the measuring instrument, which removes the screamer/arming-race failure mode that
>   contaminated U2. Prefer the instrument method over any two-gun A/B where the question is
>   "what did the shooter emit".
> - **📍 EVERYTHING STILL UNKNOWN: [`docs/unknowns.md`](unknowns.md)** — one page, grouped by what
>   unblocks it (18 need Tony at the bench, 6 need the grenade, 5 need a capture, …).
> - **➡️ NEXT BENCH SESSION: [`docs/bench-tomorrow.md`](bench-tomorrow.md)** — the authoritative list of
>   what still needs a human, grouped to minimise re-rigging, with a one-hour path and a
>   **do-not-re-run** list. It supersedes the Session 0/1/2 menu that used to sit here: those are
>   **done** (B13 closed, emit hardware-proven). **Bench tools**: `mcp/tools/` (`hittest` = the
>   one-script two-gun pattern; raw_weapon/firemode_probe/sendframes/weapon_range/…).
> - **⚠ Fleet ops rules, learned the hard way:** POWER-REST the guns (two day-long-powered taggers
>   went "screamer": advertise-but-won't-link / connect-then-drop); headsets ON and settled or the
>   gun silently refuses; one script owning both guns + ONE audible GO beats any window choreography;
>   Callsign wipes $NAME (re-stamp with `python -m brx_mcp rename`).

> **⚡ LATEST (2026-08-25) — read the newest `experiment-log.md` entries before hardware work.**
> (1) **The feedback fork is resolved, then resolved AGAIN in our favour.** A BLE-only Mission Control
> gets the **full native feel including the green sight** — the Callsign capture (`cap8`) showed the
> app has no nRF radio either: it scores on the phone and sends **`$SFLASH,*`** (the green-sight
> kill-confirm) plus **`$PLAY,,4,6,<id>,,,,*`** (the announcer slot) over plain BLE. **The earlier
> "green-sight is nRF-only" call is WRONG — it probed `$GLED`, the wrong command.** See
> **`protocol/brx-protocol.md` §7o**. There is **no
> hidden enabler frame** — Callsign's arm is byte-identical to ours — and none is needed.
> (2) **Headset-present is a hard pre-game join-gate** (**B18b**) — a dark headset silently blocks a
> gun (the real cause of "only 2 of 3 armed"). (3) **Direct-BLE 3-gun synced arm is HW-proven**
> (**B10**) — the old "pilot-only" call is dead. (4) **The BRX IR shot protocol is decoded**
> (`protocol/brx-ir-protocol.md`) — per-player id is in the IR.
>
> **UPDATE 2026-08-25 (later): P2 is CLOSED — `$PSET` token 1 sets the player id, `$HIR` token 3 reads it (§7p/§7q). No stock-feel gap remains over pure BLE; the IR/nRF bench is for stations, not attribution.** *(and by 08-26 overnight the IR rig outgrew even that — it's now a general-purpose protocol instrument; see the top block)*
> ~~**Per-player attribution (P2) is now the ONLY stock-feel gap over pure BLE**~~ (`$HIR` names the
> shooter's *team*, not the player). Re-scope the IR/nRF bench around that alone — not around
> feedback, which BLE now covers. Bench plan: `docs/bench-plan-hardware.md`.

## Machine roles (NEW — this changed today)

| Machine | Role | Notes |
|---|---|---|
| **Windows PC (WSL2 + Windows Python)** | **primary development** | Code, protocol work, Android-side captures. |
| **MacBook** | **field / match day — AND the only capture rig** | Goes to the field with the taggers. Keep `mcp/` working here. |

**Only the MacBook can capture the official app.** Callsign works on **iOS only** (it has
never worked on Android), iOS Bluetooth traces need **PacketLogger**, and PacketLogger is
**macOS-only**. So every "capture what the real app does" task — including the `$GSET`
capture work — **must happen on the Mac**. Windows cannot do
it. Plan accordingly: batch up capture work for when the Mac is available.

PacketLogger is already installed at `/Applications/PacketLogger.app` and the iPhone X
already has Apple's Bluetooth logging profile. Flow: plug the iPhone in via USB (it needs
a hub — the Mac has no USB-A), **File → New iOS Trace**, confirm lines are scrolling
*before* playing, then **File → Export → btsnoop**. Decode with
`python -m brx_mcp.btsnoop <file>`. Two traps that cost us a capture each: export acts on
the **frontmost** window (easy to re-export an old trace), and a trace that is not actually
recording produces a silently useless file.

`CLAUDE.md`'s cross-platform rule matters more than ever: **code must run on both.**
macOS gives BLE **UUIDs**, Windows/BlueZ give **MACs** — never pattern-match address
format. (A bug exactly like that shipped today and was caught only by asking "will this
run on Windows?" — `_split_addrs()` in `__main__.py` now handles both.)

## Where the project stands

**Remote game start is solved and implemented.** Our own software configures taggers,
takes them live, runs a timed match, tracks hits and deaths, and drives respawns. Verified
on hardware across several matches, including two taggers driven simultaneously from one
laptop with a synchronised start.

**Loadout v2 (2026-08-27, `docs/spec/loadout.md`, contracts A10) — BUILT, not yet bench-verified:** every
player has two slots (primary + secondary **weapon | perk | empty**); the host sets **loadout rules** per game
in BUILD (presets OPEN / NO HEAVIES / SNIPERS / CUSTOM, per-slot who-picks + class allow-chips; FFA defaults
to NO HEAVIES); **players pick + try weapons from the phone** when the rules allow (`loadout_request` →
`tutorial` → `loadout_ack`, MC roster shows PICKING… / TRYING / READY live); v1 perks are passive (Body Armor,
Extended Mags, Quick Hands, Easy Reload — compiled into the head frames); **saved games** persist a whole
build under a name (`~/.brx-mcp/presets.json`, builtin "Silenced Sniper"). Per-game weapon tuning (silenced
fire sound, damage overrides) is deferred (FOLLOWUPS K6). **Later the same day:** BUILD became **GAMES** (pick the
game: saved cards + stock modes + VENUE) plus a separate **GAME DESIGNER** page (define/save a game); phones show
"setting up the game" until KIT, then a **BRIEFING** screen, then their kit (`assign.policy.kit_open` +
`assign.game`). Bench items: `docs/bench-tomorrow.md` (empty
slot 1 + ALT, Body Armor `$PSET`, Extended Mags HUD max, Easy Reload). e2e: `cd app && npm run ui:e2e`.

**Current state (2026-08-25):** the platform is now a Mission Control host on a local Wi-Fi LAN
(WebSocket, not MQTT) that compiles a per-player `FrameBundle` (`mcp/brx_mcp/mc/compile.py`), plus a
native Capacitor phone node (Web Bluetooth is dead — `adr/0003`). Software is **built + tested (438
tests incl. 12 e2e)**; the **MC↔phone LIVE path is field-VERIFIED (2026-08-25/26 real phone→MC→gun sessions); soak/scale/lock-screen certification still open (verification-checklist).** The authoritative spec
set is **`docs/spec/`** (roadmap + `mission-control.md`) and the ADRs (`docs/adr/`); the open hardware
proofs are in **`docs/verification-checklist.md`**.

Working CLI:

```
scan [s] · identify <addr> · listen <addr> [s] [pair] · probe <addr> [s]
startgame  <addr> [seconds] [respawn_s] [volume]
deathmatch <addr> [minutes] [respawn_s] [volume] [weapon]
arena      <addr...> [minutes] [respawn_s] [volume] [weapon]
fieldstart <addr...> [volume] [weapon]      # configure + spawn, then disconnect
fieldresults <addr...> [listen_s]           # reconnect afterwards
```

Weapons: `primary` / `secondary` / `melee` (verified on hardware) · `ar` / `charge`
(from the §6 doc, **never fired — unverified**).

## ANSWERED (2026-08-23 night): BLE cannot support out-of-range play

**Read this before planning anything else. It closes what were the top two open questions
and it invalidates part of what is built.**

A field test proved taggers **keep playing with no host connected** — but nothing respawned
and the round never ended. The plan was to decode `$GSET` and configure those on the gun.
**That plan is dead:**

- **Respawn and game time are not in the protocol stream at all.** Three captures with
  respawn 15 / 30 / 5 produced **byte-identical** `$GSET` *and* `$PSET` (§7n). A 1-minute
  clock produced the same `$GSET` as a default one. Callsign keeps the clock and drives
  respawn itself — the manual lists both as *on-gun menu* settings, and the app simply
  never uses that path. **No capture will ever reveal a command for it. Stop looking.**
- **The gun keeps no score.** A complete game ending was captured: the app sends
  `$VOL` → `$HLED` → `$STOP` → `$CLEAR` → `$PLAY,VS6` and **never queries the tagger for
  anything**. That explains `$UP,*`'s silence (§7l) and why reconnecting after a field game
  produced zero frames. The phone tallies `$HIR`/`$HP` live and is the only place a score
  has ever existed.

**So this is a design property, not a missing command.** Anything needing respawn, a clock,
or scoring requires a host in BLE range **for the whole match**. That is why the official
system gives every player their own phone.

### What this means for the code

`arena`'s host-driven respawn works only in range. It is a correct demonstration of the
protocol and a **wrong design for field play** — do not build further game logic on it
without deciding the transport question first.

### Attribution + feedback are BLE-native (the old nRF "critical path" is retired)

The framing that once lived here — *"the nRF radio is the new critical path"* — is **dead.**
Per-player attribution is BLE-native (`$PSET` token 1 sets player_num, `$HIR` token 3 reports the
shooter — §7p/§7q), and native kill feedback (green sight + announcer) is host-driven over plain BLE
(§7o). Neither needs nRF, IR, or USB `SETUP`. ~~The IR/nRF bench is now only about~~ *(08-26: the rig became a general-purpose instrument — closed U7/P16/FF/the $SIR map in one night)* **objective
stations**, not attribution or feedback.

Out-of-range field play is still solved the way the official system does it — a device **on each
player** (the Companion, or the native phone node reporting to Mission Control over the LAN) — not a
better courtside radio. The nRF probe (D1) survives only as a "is there a bonus native radio for the
station/broadcast tier" question, not the linchpin it was framed as here.

## Followups and unknown fields

Open work is tracked in **[`docs/FOLLOWUPS.md`](FOLLOWUPS.md)** (the single source; refer to items by
id — P2, F, D1…). Summary below is a snapshot only:

| Item | Status |
|---|---|
| `$GSET` 8 tokens | ✅ **mapped + hardware-confirmed** (friendlyFire…gameMods). No respawn/time/lives token — those are host-side |
| `$WEAP` 44 tokens | ✅ **mapped + validated** vs two live frames (`protocol-classes.md`); ~6 empty positions want a one-field capture |
| `$GLED` tokens | ✅ **SOLVED 2026-08-30 — three independently addressable LEDs.** `$GLED,<led1>,<led2>,<led3>,<t4>,<brightness>`, each LED a direct palette index (**0 red · 1 blue · 2 yellow · 3 green · 4 purple · 5 teal · 6 white**). **t4=3 blanks all three** (night mode, P17 closed). ⚠️ The older "colour is team-derived, `$GLED` = mid/effect/optionA/optionB" reading is **WRONG** — a gun held on `$TID,1` took six colours on command. The APK field names do not describe this command. |
| Sound inventory | ✅ **2166-id bank** (`sound-bank.md`) |
| Smart Grenade | ✅ config = `$GREN` to gun (FlashBang/Gas/Confusion/Molotov). ⬜ hardware test pending (followup F) |
| Per-player identity | ✅ **SOLVED 2026-08-25** — `$PSET` token 1 = player id (0–63), `$HIR` token 3 = shooter id on every hit (§7p/§7q). Over BLE, per game, no cable. |
| Results read-back | ⬜ likely doesn't exist — gun keeps no score (§7n) |
| `$HIR` `45,0,0`/`70,0,0` variants | ⬜ recur; equal starting HP/armor |
| `$SFLASH,*` | ✅ shooter's green-sight kill-confirm flash, 1 per kill scored — host-driven over BLE (§7o / P7) |
| `$AS` / `$UP` semantics | ⬜ open |
| Headset lockout | ⬜ manual says headset lost mid-game locks the gun; **never controlled for** |

## The APK — ✅ DONE (2026-08-24, Windows)

The Callsign APK teardown is **complete**. Results live in `protocol/callsign-extract/`:
- `protocol-classes.md` — the full command vocabulary (~20 commands we never knew), per-command
  **field maps**, `$GSET` fully mapped + hardware-confirmed, the `$WEAP` **token positions**
  (cross-validated vs two live frames), and all the enums (DamageType, PowerType, ReloadType,
  LedEffect…).
- `sound-bank.md` — the complete **2166-id sound bank** (kills the mic-sweep dead end).
- `apk-harvest.md` — game modes, win conditions, the **QR-code station system** (= LaserTagMods'
  JBOX, done with paper: respawn/pickup/capture/supply-drop), **weapon-spawn types**, and the
  **grenade** (`$GREN` → gun; GrenadeMode = FlashBang/Gas/Confusion/Molotov).

Method note: the app is **Unity/IL2CPP** (not Java — `jadx` doesn't reach the game logic). The
metadata is obfuscated (v39 + encrypted index tables) so Il2CppDumper/Inspector fail, but the
identifier strings are plaintext in declaration order — field maps read straight out of them.
Deeper work (method bodies, exact serialization, server-fetched weapon stats) would need Ghidra;
low priority since field order is validated against live frames. Policy honoured: facts only,
raw config JSON kept for build use under a deferred-licensing note (`RAW_ASSETS_NOTE.md`), APK
binary + decompiled tree NOT committed.

## Sound inventory — ✅ DONE (do NOT use a microphone)

The complete 2166-id bank is in `protocol/callsign-extract/sound-bank.md` (from the APK). A
mic-based sweep was tried first and **failed its negative control** (nonsense id `ZZ99` produced
audio — the tagger plays a fallback for unknown ids) — so the APK was the only reliable route for the
*inventory*, and it worked. (Note: on-tagger sounds **are** swappable via the USB `AUDIO` folder —
`reference/brx-extended-user-guide.md`; the "no SD" claim was about *firmware* backup, not sound
storage.) Confirmed by ear: `VA20` =
"connection established", `VA81` = 3-2-1 countdown. Still open: the `$PSET` positional voice-pack
token→line mapping (change one token, hear which line changes) — now targeted since we know the
field names.

## Environment

**MacBook (field):** `.venv` built with `/opt/homebrew/bin/python3.13` (system python3 is
3.9 — too old), `pip install -e ./mcp`. `cat` is aliased to `bat` — use `sed -n`/python in
scripts. Extras used by scratch tooling only: `pyserial`, `numpy`, `sox`.

**Both:** `pip` resolves `mcp` to **2.0.0**, which moved `mcp.server.fastmcp` →
`mcp.server.mcpserver`, breaking `server.py` (MCP-server mode). The CLI is unaffected.
Check what the Windows venv has — if it is still `mcp` 1.x and works there, pin
`mcp>=1.2,<2` rather than porting the ~15 decorators.

## Hardware facts

- Two taggers, both fw **`v4.32` / `devhost.03`**, `devHost 1` — **developer images**, not
  retail. Callsign warns "supported version is until v2.01e" (an *upper* bound) but the
  warning is **soft**: games run fine.
- **MCU is a Teensy.** Micro-USB is the manual's "Programing Port" and enumerates as
  `USB Serial` / `Teensyduino`. Console commands are **`QUERY`** (read-only, dumps
  versions/serial/voltages/flags) and **`SETUP`** (factory provisioning — asks for the
  headset SN; entering and power-cycling out changed nothing). Everything else → `ERROR`.
- **Firmware cannot be backed up** — HalfKay is write-only (this is about *firmware*, not the sound
  storage, which IS writable over USB). Rollback depends entirely on Battle Company. **The email
  asking what `devhost.03` is was never sent.**
- Settings backup: `~/.brx-mcp/device-backups/` (on the Mac).

## BLE: connecting is flaky, holding is not

**Do not re-derive today's wrong conclusion.** Hours went into "the link dies after 6 s"
and even "v4.32's BLE stack is broken" — both **retracted**. Reality: establishment
succeeds roughly 1 attempt in 3 (the official app behaves the same); a session that comes
up cleanly runs 75 s+. `ble.py` now retries 5×, and that was the entire fix.

The Windows machine is where the original wrong theory came from. With retry in place it
may simply work there now.

## Before ANY app-driven session: check the headset

**With no headset paired, Callsign silently connects and immediately disconnects the
tagger** (§7m). No error, no voice line. This masqueraded as "the app is flaky" for a long
stretch and is the single most likely cause of a wasted capture session. Confirm the
headset is on and linked — `QUERY` over USB reports `Headset Version` and `Head:` voltage.
**You cannot create a game in Callsign unless its top-right icon is green and reads
"connected"** — that icon is both the gate and the source of truth; the tagger's voice
lines are not. This is the entire explanation for the "app is flaky then suddenly works"
pattern: nothing was intermittent, the headset was simply linked sometimes and not others.

## Working agreements with Tony

- Hands-on and fast. One clear physical instruction at a time; say exactly what to report.
  Power-cycle between experiments.
- **His observations are primary evidence.** Three confident conclusions were overturned
  today by what he noticed physically, not by any log: "the tagger never said phone
  disconnected", "it works maybe 1 in 3 times", and "alt fire doesn't switch weapons".
  When his report contradicts your reading of the data, assume your inference is wrong first.
- **Weigh cost against value before proposing long investigations.** He will follow a plan
  without second-guessing it, so a badly-prioritised one burns his evening. He stopped a
  multi-hour sound sweep with "what are we solving for here again?" — and was right.
- Distinguish signals: the tagger saying "phone connected" (a central attached) is **not**
  the same as the app saying "connection established" (its ritual succeeded — the real
  health check).
- Volume: `CLAUDE.md` says 30, but **30 is measurably inaudible** for weapon audio; the app
  uses 69. Commands take volume as an argument; the default stays 30 per the rule.
- Never modify tagger firmware. Credit LaserTagMods (JEDGE/JBOX) publicly.
- **LaserTagMods' repos carry no license** (all rights reserved). Their findings are
  restated independently in our docs — **do not copy their code** into this MIT project.
  Worth asking them to add a license; it would unlock a lot.
