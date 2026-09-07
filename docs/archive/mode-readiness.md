# Mode readiness: Counter-Strike and Extraction (2026-09-04)

How far off is a **playable end-to-end match** for the two flagship objective modes, and what physical
hardware (stations, phones, the grenade) each one leans on. Companion to
[`utility-roadmap.md`](../utility-roadmap.md) (the objective-station build plan) and
[`game-modes.md`](../game-modes.md) (the mode design/vision). This doc is a status snapshot, not a spec;
where it names code it cites `file:line` so it can be re-checked.

## 0. Two execution paths — the crux of both stories

The repo has **two independent runtimes**, and "playable" means something different in each:

1. **CLI + Sim path** — `brx_mcp/modes/` (the rules engines + `driver.py`'s `GameDriver`/`run_live`), driven
   by `python -m brx_mcp play <mode>` / `game-sim` / `extraction-sim` and the `SimGame` harness. **This is
   where the actual objective logic lives and runs** (plant/defuse timers, loot wallets, win conditions).
2. **Mission Control path** — `brx_mcp/mc/` (`state.py` Session, `api.py`, `compile.py`, `scoring.py`): the
   operator console that configures, compiles, pushes, and scores from death facts. **It does not instantiate
   the mode engines** — there is no import of `modes.driver`/`build_engine` anywhere under `brx_mcp/mc/`.
   Objective and round logic are absent from the MC layer by construction.

So a mode can be "done" in the CLI/sim world and still be unreachable from the operator console. Both modes
below are further along in path 1 than path 2. **Match-day runs through Mission Control**, so the MC gap is
the one that gates a real game.

## 1. The shared spine (both modes need this first)

Every objective mode rides the **objective-station primitive**: a physical thing (phone / station / grenade)
that advertises its state, and player nodes that read presence off it — the same primitive as the respawn
station we shipped. The cross-cutting prerequisites, from `utility-roadmap.md`:

- **S6** — the station reliably hears player adverts (fixed in code, commit `73d391a`; two-Pixel bench pending).
  Nothing objective works without it.
- **MC arming loop (A1-A6)** — the operator assigns/args stations at muster (ITEMS panel, `station_config`
  push, persisted assignments). ~1 day, **not started** (brx session, FOLLOWUPS S5).
- **Radio hardening (B1/B4)** — RSSI-vs-distance per TX level, per-kind thresholds. An hour of code + an
  evening of soak.
- **K1 control point** (~1 day) — builds the **presence plumbing** (station reads who is in its zone, by team)
  that extraction and the bomb both reuse. K1 is the first kind and the shared foundation.

Until this spine exists, CS and extraction can only run in the CLI/sim, with synthetic objective events.

## 2. Counter-Strike (bomb / defuse, round-based)

### Built
- **Full single-round state machine** — `modes/cs.py` `BombEngine` (34-149): plant → detonation countdown
  (56-66, 96-98 → attackers), defuse (68-72 → defenders), elimination (`_check_elimination` 105-112),
  round-time expiry pre-plant → defenders (100-101, correctly ignored once planted), late-plant guard (61-62),
  match resolution with `rounds_to_win` (114-128), and `next_round()` reset+revive (130-140).
- **Driver + CLI wiring** — `build_engine` maps `cs`/`bomb` → `BombEngine` (`modes/driver.py:90-91`); CLI
  advertises it (`__main__.py:16,18`).
- **Presentation ready** — `mc/presentation.py` `counter_strike` preset (bomb_planted/defused/detonated
  sounds + LEDs, 245-248), event catalog (91-93,127), `MODE_PRESET["cs"] = "counter_strike"` (282).
- **Compile-time guard** — `compile.py:711` requires a station/objective source for `cs`/`bomb`.
- **Strong tests** — `tests/test_cs.py` (11 unit) + `tests/test_sim_cs.py` (~17 through the real driver +
  FakeTaggers, incl. detonation timing, late-plant, best-of-three at 197-214). The per-round rules are solid.

### Missing
- **No side-swap / half-time** anywhere (`cs.py:38-39` pins attackers=team 2 all match). Standard CS swaps
  sides at halftime; entirely absent.
- **No live multi-round loop.** `GameDriver` never calls `next_round()` — only the *tests* do, by hand. So
  `play cs` runs exactly **one round** then `GameOver` (`rounds_to_win` defaults to 1). No freeze/buy/reset
  loop between rounds.
- **Unreachable through Mission Control.** MC's `MODES` catalog (`mc/state.py:32-53`) lists only
  `tdm, ffa, infection, lms, extraction`; `Session` raises `ValueError` on anything else (694-695, 724-725).
  The `counter_strike` preset and the "cs → counter_strike" default are dead wiring from the operator flow.
- **No MC round scorer** — `mc/scoring.py` scores kills; `win_by` other than `kills` returns
  `{"undecided": …}` (428-430). No round tally.
- **No real plant/defuse input** — the engine takes synthetic `PLANT`/`DEFUSE` commands (`cs.py:79-83`); the
  bomb-site station/grenade/phone that would emit them (see §4, K4) doesn't exist yet.

### Distance and critical path
The engine is the smallest part of the remaining work. To a playable CS **match** you need, roughly in order:
the shared spine (§1) + **K4 bomb site** station (~1.5 days + a bench, `utility-roadmap.md` K4) to source
plant/defuse and apply blast, **a round-orchestration loop** in the driver (advance N→N+1, freeze/buy), a
**side-swap** step, and — for match-day — **adding `cs` to the MC catalog + a round-aware scorer**. Ballpark:
**K1 + K4 + the round/MC work ≈ 3-4 sessions** on top of the spine.

**Open decision (yours):** blast-damage model. `utility-roadmap.md` proposes 45 HP (a kill) inside the site's
threshold, half outside to threshold-10 dB, delivered as `$BHIT` host-inflicted to each phone in radius.

## 3. Extraction (raid-and-extract)

### Built
- **Rich, complete rules engine** — `modes/extraction.py` `ExtractionGame` (138-329): per-player loot wallet
  (`carried/banked` 126-132), pickup + ground tokens (169-184), channel/hold extraction with a LOUD callout
  (`enter_zone` 226-242, `leave_zone` reset 244-252, complete 255-268), bank + `$LIFE` boost + win check
  (`_complete_extraction` 305-328), **drop-on-death with three policies** (`ground|killer|pool`, 187-215,
  275-303) incl. the dead-killer double-credit guard, channel interrupt on death, empty-handed respawn.
- **Uniform adapter** — `extraction_adapter.py` `ExtractionEngineAdapter` (63-176): maps BLE/station events
  (`ZONE/LEAVE/LOOT/PICKUP`, `$HIR` kill attribution with a 6 s fuse, `$HP,0` death) and host respawn; wired
  via `build_engine` (`driver.py:99-101`).
- **First-class MC mode** — present in `mc/state.py:49-52` (`win_by:"objective"`), so it's **selectable and
  configurable through the operator console** (unlike CS). Presentation preset fully specified
  (`presentation.py:96-110,129-131,268-276`); `compile.py` deliberately does not station-gate it (707-710).
- **Extensive tests, all green** — `test_extraction.py` (engine), `test_extraction_adapter.py` (through
  `build_engine`, incl. score+GameOver, kill-drops-loot, host respawn, repeat-death guard),
  `test_sim_extraction.py` (~20 through the real driver: loot→channel→bank→win, all three drop policies,
  ground-token-consumed-once, attribution fuse). The loot economy end-to-end is proven in sim.

### Missing
- **No real zone/loot input source.** `ZONE/LEAVE/LOOT/PICKUP` are synthetic station commands
  (`extraction_adapter.py:112-120`); the adapter says they come "Fed by the Utility Box / phone once B4/B13
  land." No hardware/phone emits them yet.
- **No MC objective scorer.** Banked totals live in the engine snapshot, but through MC extraction is
  `win_by:"objective"` and `mc/scoring.py` returns `{"undecided":"objective"}` (428-430). MC can *select*
  extraction but cannot itself declare the winner or show a loot board — that state exists only in the CLI/sim
  driver.
- **No raid window / hard-end.** The engine models a fixed `channel_s` hold (255-268); the design's timed
  open/closing window and the 30-min **raid-ending orbital strike** (`game-modes.md:131,137`; presentation
  events `extraction_closing`, `raid_over`) have no engine producer yet.
- **Field-wide "it's loud" is best-effort** — the alarm to *other* players (`extraction_alert`) needs the
  broadcast downlink (Tier 4) that doesn't exist; local loudness (station/gun audio) works at any tier.

### Distance and critical path
**Materially closer than CS** — it needs an input feed, not new game logic. To playable: the shared spine
(§1) + **K2 extraction zone** station (~1 day, loot mirroring is the tricky part, `utility-roadmap.md` K2) to
source `ZONE/LOOT/PICKUP` and mirror the loot wallet to the node, plus — for match-day — an **MC banked-loot
objective scorer**. The raid window + orbital strike are a nice second pass (a timed-end producer), not
required for a first playable game. Ballpark: **K1 + K2 + the loot-scorer ≈ 2-3 sessions** on top of the spine.

## 4. The hardware we still lean on — and the grenade bridge

Our utility system is a phone-based, MC-hosted reimplementation of what the BRX **grenade** does in native
games. Parity today (`reference/grenade.md`, 5 hardware-confirmed modes):

| Grenade mode | What it does | Our coverage |
|---|---|---|
| **Respawn** (yellow) | IR beacon → gun self-respawns near it | ✅ built (phone respawn station, validated on Tactix-E20D) |
| **Hill / KotH** (blue) | beacons owner; grants holder a rate-of-fire perk | 🟡 designed — K1 |
| **Assault** (green) | capture point, silent (LED only, no beacon) | 🟡 designed — K1 |
| **CTF** (white) | capture-the-flag, silent (no beacon) | 🟡 designed — K5 (new `kind 6 flag`) |
| **Frag** (red) | thrown / triggered physical blast | ❌ out of scope (a physical throwable; K4's `$BHIT` blast is a different mechanic) |

**Key constraint:** the grenade's objective beacons are honoured by **native games only** — a hosted (MC) gun
ignores all its IR words (B12/B23). So the grenade and our phone stations cover different contexts, and inside
our hosted games the phone *supersedes* the grenade.

### The grenade as a hosted respawn/objective station (FOLLOWUPS B23)

We can still bring the grenade *into* a hosted game as a physical station, by **reading** its beacon instead
of relying on the gun to act on it:

1. Grenade in **Respawn** mode, claimed to a team → beacons `$HIR,0,15,0,<team>,6` every ~3 s.
2. Add a **passthrough `$SIR` row** to the config head we push (`$SIR,15,*,,24,…`, FF on) so the gun receives
   the beacon and reports it over BLE.
3. The phone node reads it → team + respawn-delay check → **our** host-driven respawn. Same signal our
   phone-beacon stations produce ("a team-X station is present"), sensed over **IR** (directional, face-it)
   instead of BLE RSSI — it slots into the same `respawnGate`/station-present machinery.

**The catch:** a firmware-dead gun (`$HP,0`) hears **no IR at all** (bench: 448-word brute force, nothing
lands), so "downed" can't be the 0-HP state. B23's design makes DOWN a **node-defined stunned state** — on
`$HP,0` the node immediately re-spawns the gun stunned (`$SPAWN` + `$AMMO,0,0`), alive to IR but unable to
fire and painted dead by the node; it can then hear the grenade beacon, and the node does the real respawn.
Every link is bench-proven separately; **the assembly is not**. Open: the stunned gun still takes IR damage
(node must absorb + re-spawn), and FF must be ON for a same-team beacon to register (team policy then lives in
the node). The same `$HIR,0,15` passthrough also lets a **Hill**-mode grenade be a physical control-point
*input* for K1; Assault/CTF/Frag don't beacon, so they can't bridge.

## 5. Bottom line

- **The objective *logic* is largely done** for both modes in the CLI/sim; the gaps are the **input source**
  (a station that emits objective events) and the **Mission Control integration** (catalog entry + an
  objective/round scorer). CS additionally lacks a live multi-round loop and side-swap.
- **Shared prerequisite:** the objective-station spine (§1) — S6 bench, MC arming (A1-A6), K1 presence. About
  a week of sessions gets K1 playable and the spine in place (`utility-roadmap.md` §7).
- **Extraction is the shorter hop** from there (K2 + a loot scorer, ~2-3 sessions); **Counter-Strike is the
  longer one** (K4 bomb site + round loop + side-swap + MC catalog/scorer, ~3-4 sessions) and carries the
  open blast-damage decision.
- **The grenade** stays useful as a native-game objective, a physical throwable (Frag), and — via the B23
  bridge — a readable IR respawn/hill station inside our hosted games, pending one bench to prove the assembly.

Order that falls out: **S6 soak → MC arming (A1-A6) → K1 → K2 (extraction playable) → K4 (CS playable)**, with
the B23 grenade bridge as an optional physical-station bench alongside K1/the respawn work.
