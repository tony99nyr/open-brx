# Handoff — after the first full match (2026-08-30/31)

**Status: all reported issues from the 2026-08-30 field session are FIXED and verified, and as of
2026-09-01 the whole Windows lane below (W1–W5) is done too.** On the Mac side **M1 is DECODED** and
**M2 is narrowed to one layer**, both from captures already on disk — read those sections before
planning any bench time. What still needs the hardware is **M2's last layer, M3 and M4**.

Suites: **mcp 577/577 · app 67/67 · MC console 66/66 (new) · browser e2e 75/75.**
(At handoff: mcp 542 · app engine 54 · e2e 75. The Mac's sweep took mcp to 543.)

> ### 📌 2026-09-01 — the Mac cleared the leftovers, and left W1–W5 alone as promised.
> Swept there after the handoff was written, so they are no longer open: an advisory-`settling`
> regression test (the feature had shipped without one); `reload_s` returning `0.0` instead of `null`
> for a missing reload time (it rendered a confident "RELOAD 0.0S"); a stale RECAP selection silently
> falling back to the live match; duplicate `<option>` keys when a registry gun id equals a node's
> tail; and dead try-out CSS. Also **three `rules-of-hooks` violations fixed** — one introduced in
> `Recap.tsx` and two pre-existing in `Kit.tsx`, all hooks sitting after an early `return null`.
>
> **The two machines found the `Kit.tsx` hooks bug independently**, from opposite directions: the Mac
> read the oxlint errors, the Windows side had a new console suite mount every screen with no
> snapshot. Same fix, and the comment here is the merge of both. Worth knowing that the lint gate and
> the test gate each caught it alone.

Lab notebook entry: `docs/experiment-log.md` → *2026-08-30 (Tony + Claude, MacBook)* and
*2026-09-01 (Claude, WSL)*. Open items also tracked in `docs/FOLLOWUPS.md` → *Field 2026-08-30*.

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

### M1 · Why don't the headsets flash green? — ✅ **DECODED 2026-09-01. Do NOT run a new capture.**

**It was already on disk, twice.** The `$SFLASH` capture (shooter, 3 kills) and
`2026-08-23-two-tagger-combat.btsnoop` (victim, 23 hits, 2 deaths) cover both sides of a fight. Full
write-up in the 2026-09-01 `experiment-log.md` entry. What Callsign sends to the headset:

| when | frame | which player |
|---|---|---|
| pre-game, with `$GLED` | `$HLED,<team>,0,,,10,,*` | every gun, every captured game |
| armour 0 → HP dropping | `$PLAY,VA8B,3,6,,,,,*` then `$HLED,7,4,90,90,10,15,*` | the **victim**, once per life |
| end of game | `$HLED,,6,,,,,*` | every gun |

**There is no per-hit and no per-kill headset frame.** 23 `$HIR` hits produced 2 alerts; the shooter's
3 kills produced none — our kill path was already byte-identical. So the *"blinks green on hit"* in the
2026-08-27 entry is almost certainly this **low-health alert** (Tony flagged his own uncertainty about
it at the time). The 2026-08-30 correction — green is **host-driven** — stands, and is now specific.

**Both frames are shipped** (head + `cues.hurt`/`hurt_led`) and **UNCONFIRMED on hardware.** All that
remains is an eyeball check at the next match: do the headsets show **team colour pre-game**, and do
they **light when someone's armour breaks**? If a per-hit blink then appears on its own, that is the
autonomous behaviour — we had simply never lit the headset at all.

*Unaffected:* rainbow-on-disconnect was observed with no host driving it, so the muster gate that rests
on rainbow still stands. Pre-game team colour, however, turns out to be **host-sent**.

### M2 · Empty mag showed no reload prompt — **narrowed 2026-09-01 to ONE layer**
Two of the three candidate layers are now eliminated **from evidence already on disk**:

- **The gun is not the problem.** `2026-08-26-weapons-smg-plus-amr.btsnoop` shows one `$ALCD` per shot
  all the way down — `9,8,7…1,0` at ~350 ms — and then a dry trigger emitting `$BUT` with **no**
  `$ALCD`. `$ALCD,0` is real and the gun sends it. (Same in the energy-rifle capture.)
- **The engine is not the problem.** Replaying that exact cadence through the real `Engine` gives
  `ammo 0`, `mag 32`, and the low-mag condition **armed** — the two values `hud.js` derives the RELOAD
  prompt and the solid/red empty state from. Pinned by `app/test/engine.test.mjs`
  ("emptying a mag leaves ammo 0 and the low-mag prompt armed").

⇒ What is left is the **phone's transport/render layer**: did the `$ALCD` frames actually *arrive* at
the WebView during sustained fire (7 frames/second on an iPhone X, alongside rendering), or did they
arrive and the paint never happen?
**Method (unchanged instrument, much sharper question):** **hit "Share log" on both phones before
closing the app.** The raw BLE frame ring answers "did the frames arrive" outright. If they did, it is
a render bug and the ring's timestamps will show the gap.

### M3 · How long does a weapon swap actually take?
Never measured. `SWITCH_MAX_MS` in `engine.js` is a display timeout, not a measurement.
`engine.lastSwitchMs` now records ALT-press → confirming shot — note that **includes the player's
reaction time**, so it is an upper bound on the swap, not the swap. Read it off the diagnostics log
after the next match. Do not tighten the constant from it naively.

### M4 · Decide the AR's identity (a taste call, not a bug)
It ships at **140 ms / 192 reserve**. Stock feel is a one-token change (`wire.fire_ms` → 100), which
**deliberately fails** `test_ttk_band_and_no_strictly_dominant_weapon`. Tony's call, not a machine's.

---

## 🪟 WINDOWS LANE — ✅ ALL DONE 2026-09-01

All code-only, no tagger. Kept below with what actually happened, because two of them found live bugs
the original write-up did not know about.

### W1 · Per-match CSV export (FOLLOWUPS F6) — ✅
`GET /api/matches/{id}.csv`, driven from `Store.matches()`. `Scorer.csv()` and the archived export
both run through one module-level `scoring.rows_csv(rows)`, so they cannot drift: an archived match
has only the `rows` its stored recap kept, and formula-injection escaping applies on both paths. The
RECAP picker exports the match it is showing (`api.matchCsvUrl(id)`); NEW MATCH stays live-only,
because an archived match is a record, not a place to start a game from. A match that scored nobody
is a header-only file, not a 404 — an empty download is a truthful answer; "that match is gone" is
not. `test_mc_api::test_archived_match_csv_*`.

### W2 · `POOL = 115` is hardcoded in `views.py` — ✅
`weapon_view(w, pool)` / `weapon_views(catalog, pool)` take the pool; `Session.health_pool(player)`
supplies it from `config.health`, with per-player `loadout.overrides` winning exactly as `_gset` and
`Compiler.validate()` read them — so the phone's stat block is the truth for *that* player. `dmg`
could not follow, because its definition **is** "share of a 115 pool"; the pool-independent number is
`dmg_per_hit`, and htk/ttk are re-derived from `dmg_hit`/`cycle_ms`/`charged` on the catalog row.
Both screens now name the pool they are quoting. A synthetic catalog with no derivation chain (the
demo backend's `damage` is an old decorative 0–100 bar) scales its *published* htk rather than
inventing a magnitude — a confident wrong number on screen is worse than an honest coarse one.

### W3 · Weapon stats are documented in two places and can drift — ✅
`mcp/tests/test_weapon_derivations.py` recomputes everything from `WeaponCatalog.resolve()` — the
literal `$WEAP` frame MC pushes — and compares it to three ledgers:
1. `weapons.json`'s `dmg`, `rof`, `rng`, `htk`, `ttk_ms`;
2. `docs/weapon-design.md` §2.2, the whole balance table including the **DPS and sustained-DPS
   columns** that went stale for the AR;
3. §2.5's hits-to-kill-at-four-health-configs table, which is what W2's UI now has to agree with.

The derivation lives in `compile.WeaponCatalog` (`fire_ms`, `cycle_ms`, `rate_of_fire`, `damage_bar`,
`time_to_kill`) so the tests and the views share one chain. Two things it had to learn to be true:
a **burst** weapon's sustained cycle is `(2*t14 + t23)/3`, not `t14` (that is the "75 +275" column),
and a **charge** weapon (t20 ∈ {2,3,14}) pays for its first shot, so its TTK is `htk` cycles rather
than `htk-1` — which is why the Rail Gun publishes 1.20 s while the Rocket Launcher, equally a
one-shot kill, publishes 0.00. Both historical defects (AR `rof: 53` vs a derived 54; the stale DPS
columns) were reintroduced deliberately and the tests caught both.

### W4 · The polish-loop deferred-lows ledger — ✅ worked and closed
`docs/FOLLOWUPS.md` → *polish-loop 2026-08-26 deferred lows* is now a table with an outcome per line:
**14 fixed, 1 deliberately kept** (CORS `*`, with the reason written down — the phone app
is a `capacitor://` origin and needs it). Highlights: an `ammo_mult` perk could ship a gun one round
short of what the HUD said (odd reserves floored in the frame but not in `spawn_ammo`); a restored
session could arm two guns with the same `$PSET` player id and score the wrong people; a wedged
zeroconf thread could advertise an MC that `stop()` had already run past; `RECONNECT MC` did nothing
at all after a discovery-only join. The seven-file bench-frame copy-paste is hoisted into
`mcp/tools/bench_common.py` with a test that fails if a frame is ever pasted back — the bench control
has to be the same control every run or its numbers are not comparable.

### W5 · Nothing tests the MC web console — ✅
`cd webapp/mc && npm test` — 66 jsdom tests in ~1.6 s (vitest + the real React renderer; no browser,
no server). Every screen is mounted three ways: a full session, an empty one, and `state: null`.
**It found two live bugs on its first run**, both of the exact class it was written for:
- `CommandBar` still did `PH[si][1]` for the *phase* label, so an unrecognised phase crashed the
  whole console — the same `PH[-1][1]` defect whose *view* half had been fixed on 2026-08-31.
- `Kit` called `useState`/`useEffect` below its `if (!state) return null`, so the render that first
  received a snapshot ran two more hooks than the one before it. oxlint had been reporting it as an
  error the whole time.

It does **not** replace `app/tools/e2e.mjs` (real widgets, a real MC, two phone HUDs); it is the gate
that runs before that suite is worth starting. `webapp/mc/README.md` → *Tests*.

---

## What is left

**Nothing in the Windows lane.** On the Mac side: **M1 is decoded** and **M2 is down to one layer**
(both settled from captures already on disk — do not spend bench time re-capturing them). What
genuinely still needs a tagger in hand is **M2's remaining layer, M3, and M4**.

~~**Do not split M1 across machines.**~~ Moot: M1 was answered without a new capture at all — the
evidence was already on disk, twice. The instruction to plan a fresh Callsign capture for it is
withdrawn; see the M1 section above before anyone spends bench time on it.

The process note still stands, and is now half-mechanised: every defect in the fixed table was found
by a person looking at a screen, and the two worst were **numbers that disagreed with other numbers in
the same repo**. W3 and W5 are the machines that check for that. What they cannot check is anything
that needs a gun to answer — which is precisely what M1–M4 are.

And the process note worth keeping: the MC session SQLite carried this entire debrief — the per-2-second
ammo, HP and preflight series for both phones is what settled *did hits register* (yes), *were the
headsets healthy* (yes, all match) and *did ammo ever hit zero* (no). **Start MC tee'd and copy the
SQLite off after every session** (`field-runbook-mc.md §0a`). The one gap was the phone-side frame ring,
because nobody hit "Share log" — and that gap is still the difference between fixing M2 and guessing at it.
