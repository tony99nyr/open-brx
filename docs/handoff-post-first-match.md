# Handoff — after the first full match (2026-08-30/31)

**Status: all reported issues from the 2026-08-30 field session are FIXED and verified.** What is left
is split below by *which machine can do it*, because the two highest-value items are **Mac-only** and
the Windows machine cannot start them.

Suites at handoff: **mcp 543/543 · app engine 54/54 · browser e2e 75/75.**

> ### 📌 2026-09-01 — the Mac cleared the leftovers. **W1–W5 below are untouched and still yours.**
> Swept here after the handoff was written, so they are no longer open: an advisory-`settling`
> regression test (the feature had shipped without one); `reload_s` returning `0.0` instead of `null`
> for a missing reload time (it rendered a confident "RELOAD 0.0S"); a stale RECAP selection silently
> falling back to the live match; duplicate `<option>` keys when a registry gun id equals a node's
> tail; and dead try-out CSS. Also **three `rules-of-hooks` violations fixed** — one I introduced in
> `Recap.tsx` and two pre-existing in `Kit.tsx`, all hooks sitting after an early `return null`.
> `npx oxlint src/` in `webapp/mc` is now **clean of errors** (it had two at HEAD), which matters for
> W5 below: a lint gate there would now pass from a green start.
> **Nothing in the Windows section was started.** No file under W1–W5 was edited beyond those fixes.
Lab notebook entry: `docs/experiment-log.md` → *2026-08-30 (Tony + Claude, MacBook)*.
Open items also tracked in `docs/FOLLOWUPS.md` → *Field 2026-08-30*.

---

## 🏆 The headline

**The MC↔phone↔gun path is hardware-verified.** Two phones, two taggers, one MacBook hosting: a
300-second FFA ran start to finish — **12 kills, 126 landed hits, 24 respawns, live streaks, a winner.**
That closes the top `[UNVERIFIED]` banner in `docs/field-runbook-mc.md`. Evidence:
`~/.brx-mcp/mc/session-e615e251.sqlite` (984 envelopes) + `~/mc-20260830-1930.log` on the Mac.

Everything below came out of that single match.

---

## ✅ Fixed this session (no action needed — listed so nobody re-opens them)

| Area | Symptom | Root cause |
|---|---|---|
| MC · KIT | Could not assign a gun to a player | `~/.brx-mcp/armory.json` is built by cabling a tagger over USB and is git-ignored, so a fresh Mac has an **empty armory** and KIT's picker was registry-only. It now also offers connected nodes' guns by tail, as muster's device-first claim already did. |
| Phones | Both HUDs stuck on "waiting" | Same cause: a node binds to a player **by gun**, so with no gun assigned nothing bound, nothing got `assign`, and `kit_open` never reached the phone. |
| Audio | Volume ≈ on-gun level 2 | `$VOL,69` (iOS Callsign's value, our old default) really is L2. Now venue-driven: **80 indoors / 90 outdoors**, unknown venue resolves **quiet**. Try-outs stay at 69 — arm's length from the player's own head. |
| Weapons UI | Every damage meter near-empty, all weapons identical | `stats.dmg` is *"share of a 115 pool one hit removes"* (7–11 for most guns) — a raw 0–100 bar can never fill past a tenth. Bars are now ranked **across the arsenal** with the real numbers beside them. `rng` is gone as a bar: it is identical (75) on all 18 guns. |
| Balance | "the classic assault rifle doesn't feel like the native m4. it feels slow" | **Deliberate, and the wrong nerf.** Exactly one token differed from the captured frame: `t14` 100→190 ms. At native speed with its 384 reserve the AR **strictly dominates 10 of 17 picker weapons** — but that was rate *plus the deepest pool in the game*. Paying out of the reserve instead: **140 ms / 192 reserve** → zero dominance, still in the 1.5–3.5 s band, **36 % more rate of fire**. |
| Phone HUD | Wrong weapon shown after ALT until you fire | `$BUT,1` was parsed and thrown away; the slot was only ever learned from `$ALCD`, which arrives **on a shot**. |
| Phone HUD | No weapon-switch feedback | Centre-screen ALT indicator, night-safe, and the swap is timed into `engine.lastSwitchMs`. |
| Phone HUD | Weapon name unreadable at a glance | 11 px muted → 24 px + PRIMARY/SECONDARY chip; kept (dimmed) under night ops instead of hidden. |
| MC | Countdown reset to 02:00 on every tab switch | `useState(120)` in two screens — React re-runs an initialiser on **remount**, which is what a tab switch is. Now shared + persisted (`webapp/mc/src/runway.ts`). |
| MC | A red row blocked the game with no way past | `start()` has had a `force` since A6; `push_config()` had none. The override now covers **push *and* arm** (forcing a push does not clear a red — it usually adds one), and the lobby prints the real blocker instead of just "E20D RED". |
| MC | Recap read FINAL, then totals moved | Advisory `settling` (`GET /api/recap`) — bound nodes not heard from since the whistle. **Gates nothing.** |
| MC | No way to see a previous match | Every finished match was already written to the session store; nothing read it back. `Store.matches()` + `GET /api/matches` + a history picker. |
| MC | No way to review weapons without kitting someone | New **ARSENAL** tab: read-only, sortable, all real stats. |
| MC | Tabs lost on refresh | The view now lives in the URL hash (the operator token is stripped out of the same hash without wiping it). |

**Two of my own fixes were wrong and were caught by review — do not reintroduce them.**
1. Folding "has this node checked in since the whistle?" into `_mark_flushed_live` left a phone that
   went quiet at the whistle **permanently un-flushable** and the recap permanently PROVISIONAL. It is
   now a separate advisory signal. See the docstring on `Session.settling()`.
2. The swap banner said "HOLD FIRE — GUN IS CHANGING WEAPON" and **guessed** the new slot on timeout.
   Nothing in the protocol says a swap has a duration, and `$BUT,1` is *alt-fire* — also the native
   3-second indoor/outdoor toggle, and remapped to RELOAD by the `easy_reload` perk. A press is not
   proof a weapon changed. It never guesses a slot now.

---

## 🍎 MAC ONLY — waits for Tony and the hardware

Neither can be started on Windows. Callsign is **iOS-only** and PacketLogger is **macOS-only**
(`CLAUDE.md` → Machine roles), and the second needs the taggers in hand.

### M1 · Why don't the headsets flash green? 🔴 highest value
**126 landed hits, 12 kills, both headsets healthy all match (`preflight.headset_ok == true` in all 328
live status envelopes) — and no green, on a hit or on a death.**
This **contradicts** the 2026-08-27 experiment-log entry, which recorded green-on-hit/kill as
*autonomous* and concluded "we get them free… nothing in our config needs to reproduce it". That entry
is **corrected in place**. If the green were autonomous it would have fired regardless of host. It did
not, so Callsign sends something on hit/kill that we never send — the only `$HLED` we emit all game is
the blanking frame in `END_SEQUENCE`.
**Method:** capture a Callsign game on the Mac (PacketLogger → File → New iOS Trace → export btsnoop →
`python -m brx_mcp.btsnoop`), then diff its **in-play** frames against ours. The feedback frame is in
that delta.
*Unaffected by this:* rainbow-on-disconnect and pre-game team colour were both observed with no host
driving them, so the muster gate that rests on rainbow still stands.

### M2 · Does the gun stop sending `$ALCD` during sustained full-auto?
Emptying a mag on full auto showed **no reload prompt and no empty-clip state**. The data path is fine —
ammo tracks and decrements across all 328 status samples — but **ammo never once read 0** in the whole
match. Two-second status sampling cannot separate "the gun stops emitting `$ALCD` under sustained auto
fire" from a HUD render-gate bug.
**Method:** it needs the phone's raw BLE frame ring. **Hit "Share log" on both phones before closing
the app** — it lands in the same session SQLite. Without that, this is speculation.

### M3 · How long does a weapon swap actually take?
Never measured. `SWITCH_MAX_MS` in `engine.js` is a display timeout, not a measurement.
`engine.lastSwitchMs` now records ALT-press → confirming shot — note that **includes the player's
reaction time**, so it is an upper bound on the swap, not the swap. Read it off the diagnostics log
after the next match. Do not tighten the constant from it naively.

### M4 · Decide the AR's identity (a taste call, not a bug)
It ships at **140 ms / 192 reserve**. Stock feel is a one-token change (`wire.fire_ms` → 100), which
**deliberately fails** `test_ttk_band_and_no_strictly_dominant_weapon`. Tony's call, not a machine's.

---

## 🪟 WINDOWS CAN START NOW

All of these are code-only, need no tagger, and touch files the Mac is not sitting on.

### W1 · Per-match CSV export (FOLLOWUPS F6)
`/api/recap.csv` only ever serves the **live** scorer, so the new RECAP history picker has to *hide*
the CSV button on an archived match rather than export the wrong one. Add `GET /api/matches/{id}.csv`
(or a `match_id` param) driven from `Store.matches()`, then re-enable the button in
`webapp/mc/src/screens/Recap.tsx`.

### W2 · `POOL = 115` is hardcoded in `views.py`
`docs/weapon-design.md` §2.5 says hits-to-kill moves with the host's per-game health config, but the
ARSENAL and KIT screens always show `DAMAGE/HIT 9 · HITS TO KILL 13 · TTK 1.68S` for the AR. At a
50/100 or 100/100 pool the real htk is 17 or 23. Pre-existing for `htk`; this session added
`dmg_per_hit`, `pool` and a TTK cell on the same false basis. Make it follow `config.health`.

### W3 · Weapon stats are documented in two places and can drift
`weapons.json` `_note` defines `rof = round(7500 / cycle_ms)`. That held for all 18 weapons only after
this session fixed the AR (it had been hand-set to 53; the derived value is 54). Add a test that
recomputes `rof`, `ttk_ms` and `htk` from the shipped frame for **every** weapon, so a hand-edited
number can never disagree with the wire again. Same for `docs/weapon-design.md` §2.2's DPS/sustained
columns, which were stale for the AR until this session.

### W4 · The polish-loop deferred-lows ledger
`docs/FOLLOWUPS.md` → *polish-loop 2026-08-26 deferred lows*. Still open and still un-owned. Two are
now partly overtaken: "Kit registry fetched once (no refresh after later scans)" is still true, and
`api.py range_verdict 500s on malformed JSON` is the same class of bug as the header defect fixed this
session (a guard that itself throws).

### W5 · Nothing tests the MC web console
`webapp/mc` has `build` and `lint` scripts and **no test script**. Every MC UI regression this session —
the black ARSENAL page (`PH[-1][1]`), the countdown reset, the history refetch storm — was found by a
human or a reviewer, not by a suite. The browser e2e in `app/` drives MC but is owned by the app lane.

---

## Recommendation

**Give the Windows machine W3 and W5, in that order, and leave the rest.**

W3 and W5 are the two that stop this from happening again. Every single defect in the fixed table above
was found by a person looking at a screen — none by a test — and the two worst
(`stats.dmg` rendered as a percentage; `golden_bundle.json` five days stale, which had also silently
drifted on `game_over`, `victory`, `tick`, `klaxon` and two runway cues) were **numbers that disagreed
with other numbers in the same repo**. That is exactly what a machine should be checking, and it
needs no hardware.

W1 and W2 are real but small and safe to defer — W2 in particular is only wrong when someone changes
the health config, which no game has done yet.

**Do not split M1 across machines.** It is one capture and one diff; it is Mac-only end to end, and the
answer changes what the phone HUD and MC both have to send.

And the process note worth keeping: the MC session SQLite carried this entire debrief — the per-2-second
ammo, HP and preflight series for both phones is what settled *did hits register* (yes), *were the
headsets healthy* (yes, all match) and *did ammo ever hit zero* (no). **Start MC tee'd and copy the
SQLite off after every session** (`field-runbook-mc.md §0a`). The one gap was the phone-side frame ring,
because nobody hit "Share log" — and that gap is the difference between fixing M2 and guessing at it.
