# Utility items: the implementation plan (2026-09-04; §8–§9 added 2026-09-06)

The utility role turns a spare phone into an item on the field. One kind, the **respawn station**, is built,
bench-proven on two Pixels and shipping in APK 0.1.6. This is the plan for everything else, written so any
session can pick up a row and know what to build, on which surface, and what proves it.

The spec of record stays `docs/spec/utility.md` (advert format, presence, the respawn rule, MC arming);
mode rules stay `docs/game-modes.md`; the frame compiler and the MC mode catalog are `docs/spec/modes.md`. This
document is the **order of work** across them, plus (§8) where each objective mode stands and (§9) what it costs
an outsider to add a mode. When a row lands, mark it here and promote the facts into the spec. The two review
documents §8 and §9 were distilled from (`mode-readiness.md`, `mode-extensibility.md`, both 2026-09-04) are in
`docs/archive/`.

## 0. Principles every row obeys

- **Same app, one role at a time.** `brx.role` = `hud` | `utility`. No third app to install or keep in step.
- **Adverts are the wire between phones.** A station advertises its 16-byte identity + state; player phones
  advertise id / team / alive / intent bits. Nobody connects to anybody; any number of phones read the air.
- **Presence = smoothed RSSI against the station's own advertised threshold**, with dwell and hysteresis
  (`beacon.js Presence`). Bench-tuned default -74 dBm / 0.8 s at high TX ≈ 10 ft.
- **Stations are self-authoritative and MC is not live mid-match.** A station decides its own state from the
  adverts it hears; player phones decide their own actions from the station adverts they hear; both report
  facts at recap. Two phones can disagree for a moment and reconcile later; nothing waits on the laptop.
- **Setup needs Wi-Fi, play does not.** MC arms a phone at muster (`station_config`); after that a station is
  a passive beacon. Placement happens BEFORE start, never inside the countdown. Stations do not walk back
  between games unless their role changes.
- **Anti-cheat by construction.** A station's screen is a status display; its controls sit behind seven taps
  on the ⓘ; MC arming is the primary lock. Player phones enforce `config.stations` (the allow-list) so a stray
  phone cannot revive, plant or score.
- **The station never touches a gun.** It reads adverts and shows state; the player's own node writes to the
  player's own gun. The exception is the bomb's blast, which every player node applies to its own gun.

## 1. Where we are

| # | piece | surface | state | proof |
|---|---|---|---|---|
| 1 | Advert codec (`encodeUuid`/`decodeUuid`), Presence tracker | `app/src/beacon.js` | ✅ built | `beacon.test.mjs` |
| 2 | Beacon plugin (advertise + TX power, Android) | `app/plugins/brx-beacon` | ✅ Android · ⚠ iOS written, unbuilt | two Pixels 2026-09-04 |
| 3 | Respawn station rule (trigger / presence gate, delay, team, allow-list, disabled) | `engine.js` | ✅ built | "utility items" tests |
| 4 | DOWN screen lesson (run → get closer → hold → pull the trigger) | `hud.js` | ✅ built | screens #45 a/b/c |
| 5 | Utility screen: status only, ⓘ ×7 drawer, DEFAULT badges, reset, live-after-reload | `utility.html/.js` | ✅ built | screens #48 |
| 6 | Phone side of MC arming: hello as `utility`, heartbeat, `station_config` apply → MC-ARMED · game | `utility.js` | ✅ built | screens #49 |
| 7 | MC side of arming: `station_config` push, ITEMS panel at muster, persisted assignments | `mcp/brx_mcp/mc`, `webapp/mc` | ✅ server 2026-09-11 (F104: utility roster, `PUT /api/stations/{id}`, arm on hello / assign / push, per-match game byte, `config.stations`); ITEMS panel in the MC console the same day; assignments live for the SESSION (not persisted across an MC restart yet) | `test_mc_stations.py` (12) |
| 8 | Headset out-blink while down, re-asserted | `engine.js` | ✅ built (A11.6/7) | bench 2026-09-04 |
| 9 | Station intermittently hears no player adverts at high TX | `utility.js` scan | ✅ fixed (S6, 73d391a: low-latency scan + restart) | soak on two phones pending |
| 10 | Reconnect / new-match reconciliation on a rejoin | `engine.js` | ✅ built (S7.1, 2e36f58: 3 s disarmed reconcile, never heals) + the HUD's RECONCILING takeover | validated on hardware 2026-09-04 (contracts A6.8, node.md §3.10) |
| 11 | Harness: utility presets, fake players, fake `station_config` | `tools/stage.html`, `?stage` | ✅ built | — |

Kinds 2–5 (powerup, extraction, bomb, control) are designed in the spec's §5 table and not built.

## 2. Cross-cutting work first

These unblock every kind and are cheap relative to the kinds themselves.

### A. The arming loop (MC ↔ station)
| what | surface | owner | done when |
|---|---|---|---|
| A1 `station_config` push over M-NET (`{kind, team, id, threshold?, game?, valid_ids?}`), accept `hello node_type "utility"` with no gun, never bind | MC server | brx | ✅ 2026-09-11 (F104). ⚠ The phone's `MC_KINDS` lacked the kind too, so this was a TWO-sided fix. Still owed: step #49 against the real push instead of `window.brxUtility.applyStationConfig` |
| A2 ITEMS panel at muster: one row per utility phone from its heartbeat (kind, team, id, threshold, live, revives, armed, **battery**, last seen, app version); assign + ARM buttons; persisted per session | MC UI | brx | e2e step: assign a phone, see MC-ARMED on the utility page |
| A3 Battery + app version in the utility heartbeat | `utility.js` | brx-hud | field visible in A2 |
| A4 **Attention flags** on the ITEMS row: "bring back to re-arm" (assignment changed since last contact), "battery low", "not seen since last match", "app behind" | MC UI | brx | e2e: change a team on an offline phone → the flag appears |
| A5 `config.stations` from the compiler = the ids MC armed this game; the utility phone displays `valid_ids` | compiler + `utility.js` | brx + brx-hud | ✅ MC half 2026-09-11 (`Session._wire_config()` puts `stations: [{id, kind}]` on every config push and hydrate); the utility screen still does not display `valid_ids` |
| A6 Recap: stations row — revives per station from player facts vs the station's own count; ✓ when they agree, ⚠ when the station was never heard | MC scoring + recap UI | brx | recap e2e |

### B. Radio hardening
| what | surface | owner | done when |
|---|---|---|---|
| B1 S6: station scan starvation while advertising — ✅ fixed (73d391a); the two-phone soak is still owed | `utility.js` | brx-grenade | 10-minute soak: player list never empties while a player phone stands there |
| B2 Android opportunistic-scan demotion: restart the HUD's beacon scan every 25 min | `app.js` | brx-grenade | soak |
| B3 iOS: build `BrxBeaconPlugin.swift` on the MacBook, verify advertise + scan | plugin | whoever has the Mac | iPhone as station revives a Pixel |
| B4 RSSI-vs-distance at each TX level, phone-to-phone; per-kind default thresholds (a zone is bigger than a respawn point) | bench doc | Tony + a session | a table in `utility.md` §3 |

### C. Match scoping
| what | surface | owner | done when |
|---|---|---|---|
| C1 `game` byte from `station_config` (already applied on the phone); MC bumps it per match | MC | brx | ✅ 2026-09-11: `Session.game_no` bumps on the first lobby push after a match STARTED (so an edit at muster is the same game), every station is re-armed with it, and a station that missed the push gets it on its next hello. C2 (players filtering presence by game byte) is still open |
| C2 Player phones filter presence by the bundle's game byte (Presence already supports `game`) | `app.js` | brx-hud | engine test |

## 3. The kinds, in build order

Each kind = a station state machine (what it advertises in `state`/`value`), a player-node rule (engine +
HUD copy), an MC mode/scoring, tests, and a bench gate. The order is by (game value × how much of the respawn
primitive it reuses).

### K1 · Control point → Territories, Domination and King of the Hill (first)

**➡ The rule is now specified: `docs/spec/utility.md` §5d** (Tony's design, 2026-09-10) — capture rate is the
**net difference between the leading team and its largest single rival** (2v1 counts as the 1; 2v0 goes twice
as fast; 2v1v1 still converts, slowly; a tie for the lead nets zero), a
**two-phase conversion** (drain an enemy point to neutral, then build it for the claimant, on one 0-100 scale in
advert byte 11), an **animated** station screen that shows which way the point is going and who is contributing,
per-team gun callouts (`VB0N` captured / `VB0P` lost / `VB0O` contested / `U100` tick) played **by each player
phone off the station's own advert, with no LAN**, and progress persisted on the station, which stays
self-authoritative and reports at recap. **§5e** is the opt-in LAN-coupled variant (points-to-win, roaming hills)
and is a deliberate exception to A4.8. The rows below are the surfaces; the spec wins on the rule.
**Followups: F94** (build §5d), **F95** (build §5e) and **F98** (Territories, §5f).

⭐ **Territories (§5f, F98) is the strongest case for building this row**, and it needs nothing beyond §5d: several
points, each scoring for its owner **whether or not anyone stands on it**, win on the total. It kills camping by
construction (owning a point you already hold earns nothing extra, so the play is always to go take another — no
decay rule, no bonus, no multiplier to tune), and because each station keeps its own books and reports at recap it
needs **no LAN at all**, which shrank §5e's A4.8 exception to roaming hills alone. It also cannot be done on
grenades: a grenade holds its owner unattended fine, but ownership travels only over IR and only a gun hears IR
(F92), so an unwatched grenade point has no scorekeeper.

**The grenade is complementary, not a substitute.** The shortcut below is real for a single hill, and it does not
replace the phone point: a grenade gives **shoot-to-capture and physical feedback** that a phone cannot, and a
phone gives **a head count** that a grenade cannot. The grenade's charge mechanic counts the **magnitude fired
into it**, so one shotgun shell can outweigh four rifle rounds and a lone player with the right weapon out-caps
two with the wrong one — it can never say *how many living players of each team are standing here*, which is
exactly what §5d's rule is made of. And **F88**: a grenade beacon carries **no station id**, so two grenades in
range are indistinguishable on the wire. **So multi-point Domination needs phones** (advert bytes 6-7 are the
station id), and **F92** is why the two sources cannot be coupled into one point: a grenade's ownership travels
only over IR, a station has no gun to hear it, and a mid-match relay through MC contradicts §5c. Run them as
separate objectives, or run the phone point.

| surface | work |
|---|---|
| station (`utility.js`) | state machine per **spec §5d.3** (this row's older sketch is superseded where they differ): `team` = owner tid (255 neutral) · `value` = progress 0-100 **always** (hold time is node-side, never in the advert) · `state` carries phase / `toward` / contested · byte 15 carries the signed net rate. Inputs: player adverts (team, alive) present at the station. Rule: **net difference** of living present players sets the rate (§5d.1 — leader minus the **largest single other team**: 2v1 = the 1, 2v0 = double, 2v1v1 = 1, a tie for the lead = no movement, empty = the owner holds and keeps scoring). ⚠ **Not a contested freeze** — the older wording here said "mixed → frozen" and that is explicitly not the design. Screen: **animated** per §5d.4 (owner colour, two-toned progress bar, direction arrow + rate, CONTESTED band, the roster marked counts / does not count, transition flashes). Tally per team persisted (§5d.6) for recap. |
| player node (`engine.js`) | `state().objective` = the nearest control station `{id, owner, progress, contested, mine}`; facts `capture` (station, team) when the owner flips while this player is present. No gun writes. |
| HUD (`hud.js`) | a live-screen OBJECTIVE line: HOLD THE HILL · 32 s / CONTESTED / LOST — reuses the alert banner (`point_captured`, `hill_captured` already exist) and the DOWN recap's "race to the cap". |
| MC | modes `hill` (win: hold total ≥ N s or most hold time at time-limit), `domination` (points per second, cap) and **`territories`** (§5f: several points, each scoring for its owner unattended, **linear in the count** — Tony's decision, no multiplier and no majority threshold — win on the total summed from the stations' own tallies at recap); the ITEMS panel arms kind `control`; scoring from `capture` facts + the station's tally at recap. Alerts `point_captured` / `hill_captured` / `lead_taken` already wired in A11. |
| tests | engine: owner flips, **net-difference arithmetic (1v0 · 2v0 · 2v1 · 1v1 · 2v1v1 · 2v2v1 · 3v2v1 — the multi-team cases are the only ones that distinguish largest-single-rival from summing the others)**, the two-phase drain-then-build crossing, dead players don't count, allow-list, one callout per transition (never per advert). screens: an OBJECTIVE line stage. utility: a fake-player script drives the state machine in the harness. |
| bench gate | two phones + two guns: capture, contest, recapture; hold timer matches a stopwatch within 1 s. |
| needs | B1 (the station must hear player adverts reliably) — this is the first kind that depends on it, and §5d's whole rule is a head count of player adverts. §5e additionally needs A1/A2 (MC arming + the ITEMS panel) for its setup warnings. |

### K2 · Extraction zone

**Rule.** A player carrying loot who is present at the zone channels for `channel_s`; leaving resets; dying
drops the loot. The extraction is loud: the station's speaker plays the alarm and MC's alerts
(`extraction_called / open / closing / complete / failed`) already exist.

| surface | work |
|---|---|
| station | `state` 0 idle · 1 channelling · 2 extracted · 3 failed; `value` = channel seconds left; screen shows who is channelling (player id, team) and the countdown; plays the alarm on its own speaker (WebAudio, the bank line). |
| player node | intent bit `extracting` in the player advert while present with loot; `state().objective` = zone + channel progress; facts `extract_start / extract_done / extract_fail`. The loot wallet and drop-on-death already live in `mcp/brx_mcp/modes/extraction.py` — the node needs the same wallet mirrored (A13.x) or MC pushes `loot` in `score`. |
| HUD | CHANNELLING · 12 s bar; STAY IN THE ZONE; the existing alert banners. |
| MC | the extraction mode exists; add the station as the zone source (today the zone is a phone/host). |
| tests | engine: channel start/stop/reset/death; screens: channelling stage. |
| bench gate | one phone channels at a station, walks out, walks back; a second gun kills mid-channel → failed + loot dropped. |
| needs | K1's presence plumbing; B1. |

### K3 · Powerup

**Rule.** A present player takes the powerup: armour / HP grant, an ammo refill, or a weapon swap; the
station goes depleted for a cooldown.

| surface | work |
|---|---|
| station | `state` 1 ready · 0 depleted; `value` = cooldown seconds; `kind`-specific payload needs a byte: reuse `value` while ready as the payload code (1 armour, 2 HP, 3 ammo, 4 weapon slot swap). Screen: what it gives, READY / cooldown ring. Marks the taker (id) so the same player cannot re-take before cooldown. |
| player node | on present + ready + a trigger pull (same gate as respawn): write the grant to its own gun — `$LIFE` armour/HP (additive, proven), `$AMMO` refill, or the `$WEAP`+`$AMMO` swap from the bundle's `powerups[]` frames; fact `pickup`. |
| HUD | a GAIN moment already exists (health/armour/shield); add "AMMO" and "WEAPON: SMG" variants. |
| MC | compiler adds `bundle.powerups` (frames per payload code); ITEMS panel arms kind `powerup` with a payload; scoring optional. |
| tests | engine: take once, cooldown, wrong team (if team-locked), the written frames. |
| bench gate | take an armour powerup, `$LCD` echo shows the pool; take a weapon swap, fire the new weapon. |
| needs | nothing beyond the respawn primitive; shields stay IR-only (fn-11) and are out of scope. |

### K4 · Bomb site (last: the most moving parts)

**Rule.** An attacker present with the `planting` intent for `plant_s` plants; the site counts down
`fuse_s`; a defender present with `defusing` for `defuse_s` defuses; on detonation every player phone
within blast radius applies host-inflicted damage to its own gun.

| surface | work |
|---|---|
| station | `state` 0 idle · 1 planted · 2 defused · 3 detonated; `value` = fuse seconds; plant/defuse progress shown; the station's speaker does the beeps. It must read player intent bits — B1 is a hard prerequisite. |
| player node | intents from the HUD (rail-mounted, so: present + hold the trigger = plant/defuse, exactly the respawn gesture); on `detonated` with the site present at ≥ threshold-N dB: write `$BHIT`-style damage to its own gun (frame from the bundle); facts `plant / defuse / detonate`. |
| HUD | PLANTING · bar; BOMB PLANTED · 40 s (alert exists); DEFUSING · bar; the DOWN recap shows the round state. |
| MC | round-based mode (`cs`): win by detonate / defuse / elimination; sides swap; alerts exist (`bomb_planted / defused / detonated`). |
| tests | engine: plant, defuse race, detonation damage radius; utility: state machine under fake intents. |
| bench gate | plant with one phone, defuse with another, let one detonate and read the `$HP` drop on a gun in radius vs none on a gun outside. |
| needs | K1 presence, B1, a decision on blast damage (proposal: 45 HP — a kill — inside the threshold, half outside to threshold-10 dB). |

### K5 · Flag base (later; a new kind id)

CTF needs `kind 6 flag` (grab by presence + trigger, carry = a player intent bit, return = present at own
base) and a player-advert `carrying` bit. Designed in `game-modes.md`; not in the advert table yet. Do it
after K1–K4 prove the intent-bit path.

## 4. Shared player-side surfaces (build once, in K1)

- `state().objective` on the engine: the nearest relevant station for the current mode with its state,
  progress and whether it is ours. One shape for hill / zone / site / powerup.
- A live-screen OBJECTIVE line under the clock: mode-specific copy, progress bar, colour by ownership.
- The DOWN recap already shows the race; add the objective state (HILL: BLUE 30 s · BOMB PLANTED 22 s).
- Intents: present + trigger held (plant/defuse/extract/take), the same gesture the respawn taught; the
  player advert's intent bits follow the engine state.
- Alerts: `point_captured`, `hill_captured`, `bomb_*`, `extraction_*`, `lead_taken` are already rendered.

## 5. Bench gates, in order

1. **S6** (station hears players reliably) — nothing objective works without it.
2. RSSI-vs-distance per TX level; per-kind thresholds (B4).
3. K1 capture / contest / recapture with a stopwatch.
4. K3 grants land on the gun (`$LCD` echo).
5. K2 channel + loot drop.
6. K4 plant / defuse / blast radius.
7. iOS station (B3) once a Mac is at hand.

## 6. Ownership

| who | rows |
|---|---|
| **brx-grenade** (spec, plugin, radio) | spec updates for each kind (`utility.md` §5 → real sections), B1–B3, station state machines' spec text, S7 |
| **brx** (MC server + console) | A1, A2, A4, A5 (compiler), A6, C1, the `hill` / `domination` / `cs` modes and scoring, E1–E2 (§9) |
| **brx-hud** (phones) | A3, A5 (phone), C2, every `utility.js` state machine and screen, every engine rule + HUD copy per kind, harness stages and screen-truth steps |
| **Tony** | bench gates (§5), thresholds, the blast-damage decision, which kind after K1 |

## 7. Rough size

K1 is about a day across the three surfaces once A1/A2 exist (the presence primitive is done). K3 half a day.
K2 a day (loot mirroring is the tricky part). K4 a day and a half plus its bench. A1–A6 a day for the MC side.
B1 is an hour of code and an evening of soak. Total: about a week of sessions, with K1 playable first.

## 8. Status per mode: how far a playable match is (snapshot 2026-09-04)

**Two execution paths, the crux of every objective mode.** The repo has two runtimes: the **CLI + sim path**
(`brx_mcp/modes/` engines + `driver.py`, run by `python -m brx_mcp play <mode>` / `game-sim`), where the
objective logic actually lives and runs; and the **Mission Control path** (`brx_mcp/mc/` — `state.py`,
`compile.py`, `scoring.py`), which configures, compiles, pushes and scores from death facts and **does not
instantiate the mode engines** (no import of `modes.driver` anywhere under `mc/`). Match-day runs through MC, so
the MC gap is what gates a real game. Until the spine above exists (S6, A1–A6, K1), objective modes only run in
the CLI/sim with synthetic objective events.

| mode | built (CLI/sim) | missing | distance |
|---|---|---|---|
| **Counter-Strike** (bomb, rounds) | `modes/cs.py` `BombEngine`: plant → countdown → defuse / elimination / round-time expiry, late-plant guard, `rounds_to_win`, `next_round()`; `counter_strike` presentation preset; `compile.py` refuses `cs` without a station source; `test_cs.py` + `test_sim_cs.py` | no side-swap / half-time (attackers pinned to team 2); no live multi-round loop (`GameDriver` never calls `next_round()`, so `play cs` is one round); **not in MC's `MODES` catalog** (`mc/state.py`'s `MODES` lists tdm/ffa/infection/lms/extraction; anything else raises); no MC round scorer (`scoring.py` returns `undecided` for `win_by` other than kills/survival); plant/defuse input is synthetic until K4 | spine + **K4** (~1.5 days + bench) + a round-orchestration loop + side-swap + MC catalog entry + round scorer ≈ **3–4 sessions**. Open decision (Tony): the blast-damage model (K4). |
| **Extraction** | `modes/extraction.py` `ExtractionGame`: per-player loot wallet, pickup + ground tokens, channel/hold with a loud callout, bank + `$LIFE` boost + win check, drop-on-death with three policies, channel interrupt on death; `extraction_adapter.py` maps ZONE/LEAVE/LOOT/PICKUP + `$HIR`/`$HP,0`; **first-class in MC** (`win_by:"objective"`, preset, not station-gated); `test_extraction*.py`, `test_sim_extraction.py` | no real zone/loot input (synthetic station commands until K2); no MC objective scorer (MC can select it but returns `undecided`, no loot board); no raid window / hard end producer (`extraction_closing`, `raid_over` events exist, nothing emits them); the field-wide alert is best-effort (Tier 4 for instant) | spine + **K2** (~1 day) + an MC banked-loot scorer ≈ **2–3 sessions**; the raid window is a second pass. **The shorter hop.** |
| **Domination / KotH** | `modes/objectives.py` engines + sim tests | station input (K1); MC catalog + scorer | spine + K1 ≈ the first playable objective mode |
| **CTF** | `modes/objectives.py` | K5 (`kind 6 flag`, carrier bit) after K1–K4 | later |

### ⭐ The grenade shortcut to K1 (bench 2026-09-10)

**A grenade is already a working control point, and two small changes make a hosted game read it** (a `$SIR` row, and stopping the phone discarding protocol 15). K1 was
scoped as building a station; for Hill and Respawn the hardware exists and the protocol is decoded:

| what K1 needs | the grenade already does it |
|---|---|
| a capturable point | shoot it to claim; **neutral is team 2**, then the beacon carries the owner |
| possession broadcast | `proto=15 team=<owner> mag=8` every ~5 s (respawn: `mag=6`, ~2.5 s) |
| the node knowing | **`$SIR,15,0,,28,0,0,1,,*`** → `$HIR,<sensor>,15,0,<owner>,8,0,0`, no pool change and **no player feedback at all** (F73). Both halves have SHIPPED: the compiler emits the row for every objective mode (`_OBJECTIVE_SIR_ROW`, guarded by F79) and the phone parses the beacon (F72, closed 2026-09-10). ⚠ **fn 28, not fn 24** — 24 proved the mechanism first and makes the gun flash, buzz and play a long clip on every beacon |
| holder feedback | the firmware already loops a tick on the owner's gun |
| punishing intruders | the hill emits an ordinary `proto=0 mag=8` damage word (see the hazard below) |

**So K1's station hardware is optional for Hill/Respawn.** What remains is node work — read the beacon, track
the owner, score possession — plus an MC catalog entry and scorer, which K1 needed anyway. That is a materially
shorter path to the first playable objective mode than building a station first.

🔴 **The "$30 grenade" that used to open this section was WRONG, by about 7x.** Tony, who bought it, 2026-09-10:
*"pretty sure i paid $200 for the grenade from BC."* That is a first-hand purchase report and it inverts the
argument: a grenade is the **expensive** way to get a control point, not the cheap one, and what the money buys is
shoot-to-capture plus native-game compatibility, not capability. A second-hand Android phone is a small fraction of
that and you can run several. Quote it as **what was paid** ("about $200 when we bought ours"), never as a current
price.

📖 **The reader-facing grenade-vs-phone comparison now lives in the manual**: `docs/manual/gameplay.md` "Control
points: the grenade or a phone" (2026-09-10), phone column marked designed-not-built, and it carries the price
above. Keep it in step when K1 lands or F91/F82 resolve.

**Three constraints the bench found, which any design here must respect:**
1. 🔴 **The damage word lands in hosted games TODAY** (F69). Protocol 0 is our standard damage row, so a hill
   chips and kills players while MC cannot say why. Ship the protocol-15 row so the node can name it, or
   document the hazard loudly, before anyone takes a grenade to a match.
2. ✅ **The row is SILENT, and that took choosing the right function.** fn **24** — the one this mechanism was
   first proved with — makes the gun acknowledge every beacon with a vibration, a headset flash and a long
   grenade-ish clip, for as long as anyone stands on the point: unbearable within a minute. fn **28** registers
   with nothing at all, and **ignores the row's `<soundID>` outright** (rung Y), so a gun-native beacon cue is
   not available and all hill audio is node work. That is what ships (F73).
3. ✅ **Any weapon can capture, and the contest tunes itself** (F70, settled 2026-09-10). It is CHARGE, not a
   special emission, so a rifleman plays the objective and no weapon needs special tokens. **That much is
   multiply-sourced** — the bench run, `reference/grenade.md`'s prior hardware-confirmed charge mechanic, and
   Tony's own native play, which a three-weapon mechanism could never explain.

   ⚠ **The EXCHANGE RATE is where the design must not get ahead of the bench.** "1:1 and linear" rests on
   **two points** (seeded 1 → retaken with 1; seeded 5 → retaken with 5), and two points define a line by
   construction rather than by measurement. "The currency is MAGNITUDE" rests on **one** discriminating trial
   (one shotgun shell at 70 retook a hill holding five AR rounds at 45). The logic of that trial is sound — a
   rounds model predicts it should have failed — but **F76 records a standing contradiction**: this page's own
   `reference/grenade.md`, equally hardware-confirmed, makes the shotgun the SLOWEST capturer where magnitude
   makes it among the fastest. **So the shape is settled and the rate is not.** Design the mode on "any weapon
   captures"; do NOT yet build economy or scoring that assumes capture power equals damage, and do not assume
   linearity beyond the two points measured. Max charge is also unmeasured (rung M).

### How a hosted hill actually works (design, 2026-09-10)

**What the node gets.** With the `$SIR` proto-15 row and the phone-side parse (both shipped, F72/F79), every node in range receives
`$HIR,<sensor>,15,0,<owner>,8,0,0` about every 5 s. One frame, two facts: **who owns the point**, and **that
this player is near it**.

🔴 **NEVER ASSIGN TEAM 2 IN A HILL MODE.** A neutral hill broadcasts **team 2** (F70), and the firmware's
polarity gate compares that against the receiving gun's own `$TID`. So a roster that actually contains team 2
reads every NEUTRAL hill as *its own team's*: under an enemy-only row those players go **deaf to neutral
points** entirely, and the `proto=0` damage word — the enemy-only one that punishes intruders — **cannot land
on them**, handing team 2 free run of any uncaptured point. This falls straight out of "neutral is team 2" and
nothing anywhere said it. ✅ **MC now refuses it at three layers and this paragraph is the WHY, not open work**
(**F82**): `mc/state.py`'s validate rejects a hill config containing tid 2 at all, `DominationEngine.add_player`
rejects the player, and `assign_teams` defaults domination/koth to 1/3 — one `NEUTRAL_TEAM` constant imported
from `modes/hillbeacon.py` drives all three. ⚠ What is still open in F82 is the **measurement**: the consequence
above is predicted from two measured facts and has never been observed on hardware.

**Presence is a heartbeat, and timing is node-side.** Beacons arriving = in range; beacons stopping = gone. The
node runs its own clock, accumulates "seconds in range while my team owned it", and reports totals to MC when it
has coverage — so possession scoring **works offline**, which matches the node-is-the-engine architecture.
Ownership scoring does not even need presence: any node in range can report "owned by team X at time T", so MC
can build the ownership timeline from whoever is nearby.

**Three limits to design around:**
1. **Granularity is one beacon period (~5 s).** Entry and exit cannot be resolved finer, so a player dipping in
   and out carries ±5 s. Fine for a hold timer, not for anything needing precise moments.
2. **The hill's beacon RANGE is known only by estimate** (rung R, 2026-09-10 evening): solid at desk range,
   zero misses across 20+ consecutive 5.0 s reads; **intermittent by ~30 ft**, with 85 s and 145 s dropouts.
   Further than the respawn station's documented ~18-20 ft. That number IS the physical size of the objective,
   and it is still one operator estimate with no tape measure and an uncontrolled aim variable, so a proper
   measurement is worth having before a mode ships. **Design consequence already taken:** presence expires on
   ≥ 2 missed beacons (~12 s), never one.
3. **A node knows only about itself.** The beacon cannot say an enemy is also standing there, so "contested"
   exists only once MC has several nodes' reports: best-effort, and possibly late.

**What we control on the gun, and what we do not.** Ours: whether the beacon reports at all (the row exists),
what it does (the function), and what it sounds like (the row's `<soundID>`, which REPLACES the `$PSET` pool
sound). **Not ours:** the ~5 s beacon rate, and the fact that a *registered* hit drags a **headset flash and
vibration** with it — the firmware's response to any registered IR event. Tony, standing in a hill with an fn-24
row loaded: flash, hit sound and buzz every 5 s, **and it queues** (acknowledgements kept arriving after the
grenade was switched off).

✅ **ANSWERED 2026-09-10: `$SIR` fn 28 registers with ZERO player feedback** — no sound, no headset flash, no
vibration — so a node can read a hill beacon every ~5 s and the player perceives nothing. **That is the row to
ship on protocol 15**, and it removes the "a control point buzzes at you" objection entirely (F73).
**One `$GSET` bit decides how much the node can see.** fn 28 is **enemy-only** with FF off, so you hear only
hills you do NOT own — cheap, but "no beacon" is then ambiguous between out-of-range and we-own-it, and you miss
your own captures. With **FF on** every beacon and capture registers and the owner arrives in `$HIR` token 4, so
the node has complete information; the cost is same-team IR registering elsewhere. **KotH wants FF on.**
**The U11′ sweep that used to sit here is mostly answered** (F73, 2026-09-10): enemy 8, 24, 25, 26, 27 and 28
were swept and characterised — fn 8 is silent but still flashes and buzzes, 24-27 fire one long grenade-ish
clip, and **only fn 28 gives the player nothing**. Still unswept, and kept only as the fallback if fn 28 turns
out to have a side effect nobody has looked for: enemy **35** and the ally side **31 / 32 / 34**
(`bench-queue-2026-09-09.md` D6). **Polarity is a mode-level decision, and it is made: KotH runs FF on.** With
`$GSET` t1 = 0 a gun registers only hills it does NOT own, so a holder cannot see their own point; t1 = 1 lifts
the gate and the owner arrives in `$HIR` token 4.

### The four native hill callouts, and whether a hosted game can reproduce them (2026-09-10)

Tony's description of native play: a ticking timer while you hold it; silence when the other team holds it and
you step in; "control point contested" when you shoot an enemy-held point without taking it; and a callout when
it changes hands. Mapped against what the wire actually carries:

| native behaviour | hosted? | how |
|---|---|---|
| ticking while YOU hold it | ✅ direct | beacon owner == my team → node plays a tick; the ~5 s beacon is a ready-made cadence |
| silence while THEY hold it | ✅ direct | beacon owner != my team → play nothing; purely a node decision |
| "hill lost" on a switch | ✅ direct | the `mag=50` capture word carries the NEW owner |
| **"control point contested"** | ⚠️ **inferred, no signal exists** | node reasons: *I fired* (`$ALCD` decrement) + *enemy hill in range* + *no capture word followed* |

**A non-capturing hit produces NO DECODABLE WORD** — checked across four runs where a hill was shot and did not
change hands (single rounds into a 45-charge hill, and a shotgun shell): the only protocol-15 traffic decoded is
the ordinary `mag=8` beacon. So the grenade appears to announce CAPTURES, not HITS.
⚠️ **This null has a known blind spot and is NOT "nothing".** The same session established that the grenade
replies essentially instantaneously, inside the SHOOTER's burst — which is precisely where a hit-acknowledgement
word would live, and *"any word that only occurs inside a shot's burst has been invisible to every capture ever
taken"*. Four captures with that blind spot cannot distinguish "no word" from "a word we structurally cannot
see". **Gated on rung B0** (move the receiver so it sees the GRENADE and not the SHOOTER); until B0 runs, design
for the event and do not treat the silence as proven.

So "contested" is a guess, and it fails in one specific way: **the node cannot tell whether the shot hit the
grenade**, so firing past it while standing in an enemy hill produces a false "contested". Probably acceptable
(you are on the point, shooting, and the game agrees something is happening) but it is inference, not
observation, and it will misbehave exactly there.

⚠ **Worth checking rather than assuming:** does NATIVE know about hits directly? If a native gun says "contested"
even when you miss, it is inferring too and we lose nothing. If it only says it when you connect, the grenade is
telling it something we have not captured, and that word is worth finding.

**This is also the concrete case for FF on** (F73): three of the four need to know the hill is YOURS, and with
`$GSET` t1=0 a gun cannot see its own hill at all. The tick and the "hill lost" callout are both impossible
without it.

### Where the hill audio has to live

**✅ MEASURED 2026-09-10 (evening) — the gun CANNOT speak on a beacon, at least not through fn 28.** The
reasoning below was the prediction going in (a `$SIR` row's `<soundID>` field plays on the victim when that
cell fires, so `$SIR,15,0,<soundID>,28,0,0,1,,*` should make every hill beacon audible with no node involved);
it does not hold. Armed live with `$SIR,15,0,U100,28,0,0,1,,*` — `U100` known audible, confirmed by ear the
same evening — the row registered repeatedly (`$HIR,4,15,0,0,8,0,0`, no misses) and produced **no sound at
all**. **fn 28 ignores the `<soundID>` field outright** — F73's "zero player feedback" is a property of the
function, not of an empty sound slot. Full detail: `docs/bench-grenade.md` rung Y,
`docs/experiment-log/2026-09.md` 2026-09-10 (evening, cont.).

The keying limit below still stands as the reason no OTHER protocol-15 function is a better candidate, even
though it never got exercised: **`$SIR` is keyed on `<irProtocol, subtype>` alone** — the B/U fields, 4 bits +
2 bits, 64 cells total (`protocol/brx-ir-protocol.md` "the `$SIR` composite key"; `protocol/brx-protocol.md`
§5). Every captured hill beacon decodes as the same key, `<15,0>` — owner and mode ride in the IR word's
team/magnitude fields, and **neither is part of the lookup**. One cell, one sound at best: the gun could never
have played a different clip for captured / contested / lost / neutral, because it cannot key on any of those.
⚠ Still untested, because no sound played at all to observe it on: whether fn 28 or any other protocol-15
function honours polarity WITH a sound loaded, and `docs/spec/contracts.md`'s `$PSET` note (also §5) that a
non-empty `$SIR` `<soundID>` overrides the `$PSET` pool sound on the row that fired.

**So the four team-aware callouts (`VB0N` Hill Captured, `VB0O` Hill Contested, `VB0P` Hill Lost, `U100` the
possession tick) are phone work, not gun work** — they need to distinguish four+ states from one wire fact
(owner) that changes over time, and a single `$SIR` cell cannot hold four sounds. Concretely, the node algorithm:

- Every `$HIR,<sensor>,15,0,<owner>,<mode>,0,0` beacon updates two pieces of state, **`hill_owner`** and
  **`last_beacon_at`** — nothing plays here directly.
- A **separate** ~1 s timer checks that state and plays `U100` while `hill_owner == my_team` **and** the beacon
  is fresh (see the next bullet for "fresh"). This is the only place the possession tick fires from; it is not
  triggered by the beacon itself, because the beacon only arrives once per ~5 s.
- **Presence expires after ≥ 2 missed beacons (~12 s)**, not one — `rung R` measured the beacon going
  intermittent at the edge of range, so a single miss is normal reception, not "left the hill."
- **Announce a capture on `mag=50` alone.** Never wait for `mag=53` — on an enemy-to-enemy capture it never
  arrives at all (n=2, settled in `protocol/brx-ir-protocol.md`), so a node gated on both words would simply
  never announce that class of capture.
- **The LISTENER'S TEAM picks the callout, not the magnitude.** ⚠ An earlier version of this line said `mag=53`
  present/absent switched between "captured" and "contested/lost" for the "losing/gaining side respectively".
  That was garbled and is corrected here against what is now implemented (`engine.js:_hillCallout`,
  `4348721`): **one wire event, different audio per listener.** The same `mag=50` frame is `VB0N` **Hill
  Captured** to the team named in it, and `VB0P` **Hill Lost** to the team that just lost it. A capture
  between two OTHER teams is deliberately silent — it is not this player's event.
- **`mag=53` distinguishes WHERE the point came from, not who says what**: present = it was NEUTRAL before,
  absent = it was stolen from an enemy. Both are still "captured" for the taker and "lost" for the loser, so
  this is available for flavour (a different line for a first claim) and for scoring, not for choosing between
  captured and lost. ⚠ And nothing may WAIT for it: it arrives ~5 s later, and on an enemy-to-enemy capture it
  never arrives at all.
- ⚠ **`VB0O` "Hill Contested" is NOT in this mapping and is not wired.** F75: a non-capturing hit emits nothing
  decodable, so contest cannot be detected — only guessed at, and a guess cannot tell a hit from a miss.
- ⚠ **Never queue a multi-second audio sequence off a beacon.** F74 proved this gun really does replay long
  events, and a beacon repeats every 5 s — a 15 s clip fired on three consecutive beacons stacks three deep.
  `U100` is chosen precisely because it is ~0.1 s and cannot overlap its own 1 s cadence; a capture callout
  (`VB0N`/`VB0O`/`VB0P`) is a one-shot per transition, not a per-beacon repeat, for the same reason.

**And a mode primitive we did not have: shield the holder.** Both grenade words carry the OWNER's team, and the
firmware gates by polarity — damage lands only from an enemy, grants only from your own team. So `<0,0>` on fn 1
punishes challengers while `<15,0>` on a grant function (fn 11/18) shields holders, with the firmware doing the
team logic. Untested (see `bench-grenade.md` programme D), and it would be the first shield our stack can fill
at all (F60).
⚠ **But you cannot have both halves in one cell** — a grant on `<15,0>` costs you the READ of every enemy-held
hill, which is the whole mode. The conflict is worked through in the next section; it applies to any
firmware-granted hill reward, shield included, not just to rate of fire.

### Rewarding the holder: a hosted rate-of-fire boost (design, 2026-09-10)

Tony's ask: while your team holds the hill, your gun fires faster; when you lose it, it goes back to stock. He
believes native KotH does this. Two facts frame the design, both from the 2026-09-10 evening bench.

**1. The hill does not do it for us in a hosted game.** Measured, counting `$ALCD` decrements off the wire:
**102.0 ms/round while the operator's team held the point, 101.6 ms/round while the enemy held it** — same gun,
same `$WEAP`, same session, indistinguishable. Stronger than a plain A/B, because the hill flipped to the
operator's team *partway through the enemy-held burst* and the inter-round cadence never broke: the control sits
inside the single measurement. Expected, since fn 28 moves no pools. ⚠ **This does NOT say native has no RoF
buff** — a native game drops the BLE link and cannot be instrumented this way, so a native buff would be
invisible to this method. What is measured is that the grenade does not buff *our* guns through the row we ship.

**2. So a boost has to be something WE apply**, from the node, over BLE — the same place the hill audio ended up
(previous section), and for a related reason.

#### Why the firmware cannot grant it: one cell, two jobs

The obvious idea is to let the firmware do the team logic, exactly as the shield sketch above proposes: put an
**ally-polarity** function on the hill's cell at `$GSET` t1 = 0, and the polarity gate grants only when the
beacon's team matches the gun's own `$TID`. That is genuinely how the gate works. It still cannot be made to
work here, and the reason is worth writing down because it constrains *every* firmware-granted hill reward:

- **`$SIR` is keyed on `<irProtocol, subtype>` alone.** Every hill word — the `mag=8` possession beacon, the
  `mag=50` capture announcement, `mag=53`, every owner — lands in the **single cell `<15,0>`**. Owner and mode
  ride in the IR word's team/magnitude fields and **neither is part of the lookup** (`protocol/brx-protocol.md`
  §5). One cell holds one function.
- **At t1 = 0, an ally function in that cell would gate correctly and go blind.** Enemy-team beacons are
  **silently rejected** — no `$HIR` at all — so the node stops seeing hills it does not own, stops seeing the
  `mag=50` capture word for enemy captures, and loses capture detection entirely. That is the mode.
- **At t1 = 1 the gate lifts and the grant stops discriminating.** Everything registers, the owner arrives in
  `$HIR` token 4, the node has complete information — and the firmware would fire the grant on **any** beacon,
  boosting a player standing in an **enemy** hill.

**One cell cannot both read every owner and grant only to the owner.** So: **read** with fn 28 at `$GSET`
t1 = 1 (already the documented KotH arm — see the FF-on argument above), and **apply the boost from the node**,
which knows the owner from `$HIR` token 4 anyway.

⚠ **The ally-function half is UNMEASURED, and the conflict does not depend on it.** No `$SIR` function anywhere
in the map is known to change weapon cadence — the function classes are damage, armour-pierce, multipliers,
heals, armour, shield, audio suppression, and register-only. fn **31 / 32 / 34** (the ally side of the
register-only class) are still unswept for player effect (`docs/bench-queue-2026-09-09.md` D6, and the old 1.6
"KotH rate-of-fire buff" item): they are known **pool-neutral**, but nobody has checked what they do to a gun's
firing behaviour, so "an ally function that buffs RoF" is not ruled out — it is simply unevidenced. Either way
the polarity conflict above stands, so the node-side design is the one to build.

#### The mechanism

The node already holds `hill_owner` and `last_beacon_at` for the audio timer (previous section). The boost
hangs off the same two pieces of state, plus one more the phone already has: the live magazine, which
`app/src/engine.js` reads from `$ALCD`.

**On boost (my team owns the point AND the beacon is fresh):**

1. `$WEAP,<slot>,…,*` — the player's own weapon frame from the bundle, with **t14 reduced** and every other
   token identical.
2. **Immediately** `$AMMO,<slot>,<live mag>,<live reserve>,1,*` using the counts the node read from `$ALCD`.

**On revert (the point changes hands, or the beacon goes stale — ≥ 2 missed beacons, ~12 s, per rung R):** the
same two frames with the **stock** `$WEAP` and, again, the live counts.

🔴 **Step 2 is not optional, and skipping it is an exploit, not a cosmetic bug.** A `$WEAP` re-push **resets
ammo to the frame's values** (`protocol/brx-protocol.md`: *"re-send `$AMMO` after any weapon swap"*). A boost
that omits the `$AMMO` restore hands the player a **free full magazine every time they step onto their own
hill** — mid-firefight, on demand, by walking. Worse, it is repeatable: step off, step back on. The restore is
what makes the boost a reward instead of an infinite-ammo button.

**Risks, plainly:**

- **The ammo blip.** There is a window between the `$WEAP` and the `$AMMO` in which the gun holds the frame's
  magazine. It is two frames on a link that carries them back to back, but it is not zero, and the HUD may see
  one `$ALCD` frame with the wrong count. Do not treat that frame as a reload event.
- **A write landing mid-burst.** Both transitions can arrive while the trigger is held. What a `$WEAP` re-push
  does to an in-flight burst is **unmeasured** — the `$ALCD` count could tear, and the recoil model resets its
  ceiling on a weapon change. Rung Z step 2 exists to look at exactly this.
- **A dropped link leaves the player stuck.** If BLE drops while boosted, the gun keeps the boosted `$WEAP`
  (weapon config survives a drop, §7) with no node to revert it; if it drops while the revert is in flight, the
  player may be stuck slow. **The safe default is: revert on reconnect.** Push the stock `$WEAP` + live `$AMMO`
  as part of the reconnect head, unconditionally, and let the next fresh beacon re-apply the boost. Stock is the
  state you can always justify; boosted is not.
- **Boost churn at the edge of range.** The ≥ 2-missed-beacons staleness rule is what keeps a player at the
  fringe from being re-armed every 5 s. Never revert on a single miss.

#### Balance: the arithmetic, and what is still unmeasured

**t14 is milliseconds per round** (calibrated 2026-09-10, now in `protocol/brx-protocol.md` §6): an AR at
t14 = 100 measured **101.6–102.0 ms/round**. So a boost is a straight ratio — halving t14 doubles the cadence —
and stock cadences are all in the same units (burst 75, SMG 90, AR 100, sniper 300, shotgun 900, charge rifle
1250). **Pick the boost as a percentage of the weapon's own t14, not as an absolute**, or the same rule turns a
shotgun into a different gun and an SMG into nothing.

**No number is proposed here, because two inputs are missing:**

1. **The floor is UNKNOWN.** Nobody has measured how low t14 can go before the firmware clamps it, or before the
   IR word stops keying reliably at that repetition rate. Rung Z sweeps 100 → 70 → 50 → 30 to find it. Until
   that runs, any chosen ratio might silently land on a clamp and produce a boost the player cannot feel.
2. **The boost interacts with the recoil model, and the direction is not obvious.** `$WEAP` **t21/t22** are the
   simulated-recoil ceiling and floor (F46, bench-proven 2026-09-09), and accuracy is a **per-shot hit
   probability** that decays under sustained fire and recovers with time between shots. A shorter t14 means less
   recovery per round, so **a faster gun may also be a less accurate one** — the same finding notes that at
   t22 = 0 single shots ~2 s apart held a flat 80 while a held trigger reached 0 in eight rounds. Whether that
   makes the boost self-limiting (nice) or worthless (bad) depends on the t21/t22 the mode ships. ⚠ **Flag, not
   assumption:** the interaction is predicted from two proven mechanisms, and the combination has never been
   measured. Note that stock ships t21 = t22 = 100, which disables the model entirely — so on a stock-accuracy
   loadout this concern does not arise at all.

Everything else the mode needs is already decided: fn 28 on `<15,0>`, `$GSET` t1 = 1, node-side timing,
`$SPAWN` before every arm. The boost is a small amount of node code sitting on state the hill audio already
maintains — but it must not be written before **rung Z** (`docs/bench-grenade.md`) says what the floor is and
that the push/revert loop preserves ammo exactly. Tracked as **F87**.

**The grenade bridge (FOLLOWUPS B23).** Our phone stations are a hosted reimplementation of what the Smart
Grenade does in native games: Respawn (yellow) ✅ built as the phone station; Hill (blue) and Assault (green) →
K1; CTF (white) → K5; Frag (red) out of scope. A hosted (MC) gun ignores all the grenade's IR words, so inside
our games the phone supersedes the grenade. B23 would bring the grenade back in as a physical station by
*reading* its beacon: a passthrough `$SIR,15,*` row lets the gun report `$HIR,0,15,0,<team>,6` over BLE, and the
node treats it as "a team-X station is present" (IR, directional) in the same `respawnGate` machinery. The
catch: a firmware-dead gun hears no IR, so DOWN must become a node-defined stunned state (`$SPAWN` +
`$AMMO,0,0`, painted dead by the node). Every link is bench-proven separately; the assembly is not.

Order that falls out: **S6 soak → MC arming (A1–A6) → K1 → K2 (extraction playable) → K4 (CS playable)**, with
the B23 grenade bridge as an optional physical-station bench alongside K1.

## 9. Extensibility: what it costs an outsider to add a mode (review 2026-09-04; FOLLOWUPS E1–E7)

- **Re-parameterize or re-skin a shipped mode** (a faster TDM, low-HP snipers, custom sounds/LEDs, loadout
  rules): **well supported by JSON today** — `GameConfig` carries health, respawn, scoring, teams, loadout
  policy and the full presentation profile.
- **A genuinely new ruleset** (a new win condition or objective interaction): **not easy.** The engine seam is
  good — `GameEngine(ABC)` is four methods (`add_player`, `on_event`, `tick`, `snapshot`) emitting a semantic
  Action vocabulary (`Respawn`, `Heal`, `PlaySound`, `KillConfirm`, `Callout`, `Score`, `Eliminate`, `GameOver`,
  `SetTeam`, `SendFrame`; a mode author never writes a raw BRX frame) — but the JSON wire schema
  (`mc/types.py:GameConfig`) has **no slot for mode-specific parameters** (no `detonation_s`, `control_points`,
  `channel_s`, `drop_policy`, `rounds_to_win`, lives…), those knobs exist only in the CLI dataclass
  (`gameconfig.py`), and registration is hardcoded in four places (`modes/driver.py` `build_engine`,
  `mc/state.py` `MODES`, `mc/presentation.py` `MODE_PRESET`, `mc/scoring.py`) — which is exactly why CS runs in
  the CLI but is invisible to MC (§8).

| # | change | unblocks | size |
|---|---|---|---|
| **E1** | `mode_params: dict` on the wire `GameConfig`, validated by the engine itself | JSON-carried custom params, incl. CS/extraction through MC | small |
| **E2** | one `register_mode(name, engine_cls, meta, preset, scorer)` replacing the four hardcoded points; a mode may supply its own scorer | a mode lights up everywhere from one call | medium |
| **E3** | unify the two config schemas (one source of truth) + publish a JSON Schema | contributors validate; no drift | medium |
| **E4** | a "How to add a game mode" doc with a ~40-line worked example | the on-ramp | small |

After E1–E4 a contributor writes `my_mode.py` (subclass, four methods, Actions), makes one `register_mode`
call, and ships `{"mode": "my_mode", "mode_params": {…}, …}` validated against the schema.

**Sound packs / custom announcers (E5–E7).** The gun plays only its on-gun bank by id — there is no
audio-over-BLE — so a custom clip on the gun speaker must be USB-loaded as `<ID>.LTP` over an existing id (the
bank is a fixed set; archive the originals; FOLLOWUPS B11). The A11 profile already maps event → id in JSON, so
the reference layer works; missing are a **pack** abstraction (E6, supersets the B14 voice-pack selection), the
**phone-speaker path** (E5, the clean path: the app plays no game audio today) and an `.LTP` import/gun-load tool
(E7, lowest priority). Halo/UT announcer audio is copyrighted: the project ships the slot, never the packs.
