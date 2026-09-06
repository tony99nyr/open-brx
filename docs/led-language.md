# The LED language (review + design of record proposal, 2026-09-06)

Updated: 2026-09-06. Status: **reviewed, not built.** A four-lens review (game design · hardware/protocol ·
code/spec consistency · match-day ops and accessibility) of how the gun body LEDs, the headset RGB LED and the
headset's small flash LED behave in a hosted game, and one design to build against. Goes into
`spec/contracts.md` as amendment **A16** when Tony signs off; the build item is FOLLOWUPS **S10**, the bench
ladder is §6 of [`bench-flash-control-2026-09-05.md`](bench-flash-control-2026-09-05.md).

Tony's constraints, in his words: LEDs "add to the immersion and have a functional purpose across the gun and
headset"; "configured per mode in the game config"; "LEAVE the native hit flash alone so it goes super bright
on hit"; "flash our brightest flash on headset during respawn when down since native doesn't help us there";
"nightmode is a toggle and should modify some behaviors of the leds in game … brightness and usage of the leds
less and generally dimmer"; "the team color on the gun doesn't need to be static bright, it should be dark and
only light up for events".

## 1. Verdict in six lines

1. The surface split is right (gun = what the player sees, headset = what others see) and the build inverts it
   on the gun: the body rests on a static team colour the player already knows and shows nothing about pools.
2. **Three real bugs ship today**: the gun-body team table is offset from the server's tids (yellow team gets a
   RED gun), `night: true` is a blackout that also deletes the DOWN signal, and the last-stand / infection
   "died: red headset" never lands because the engine marks the player dead before it plays the event.
3. The DOWN signal (small LED at 750 ms) is right in principle but has never been fired on a DEAD gun, starts
   inside the headset's death window, and runs right up to `$SPAWN`: the F13 relay-wedge class of risk.
4. Night must become an overlay (dim, sparse, slower) over the per-mode block, with the DOWN signal exempt.
5. The gun body becomes **dark at rest** with a **transient 3-segment pool readout** (now viable after the blank)
   and event bursts; the headset stays native on hits, gets **held role states** (carrier, infected, VIP,
   extraction beacon) that survive hits, and the brightest down pulse we can make.
6. One config block, `presentation.lights`, replaces the four overlapping switches (`led`, `night`-as-blackout,
   `gun_flash`, `headset_team`).

## 2. What the hardware lets us do (the facts this design stands on)

| surface | proven (log entry) | not proven (bench row) |
|---|---|---|
| gun body, 3 RGB LEDs | breathes team colour when spawned; `$GLED,,,,5,,,*` takes it out of the loop and any paint then HOLDS through fire, reload, registered hits; mixed frames render per LED (3-segment bar works in play); `$SPAWN` re-enables breathing; blank inside the spawn burst fails, +2.0 s holds (2026-09-04 ×4) | hold with no traffic over minutes (S4 b); whether `$PLAY`/`$AMMO`/`$HLED`/`$LED` disturb a held paint; a dim (tok5 = 1) paint keeping its hue after a blank (the 2026-09-02 "dim loses hue" was measured under the breathing) |
| headset big LED | one lamp, one colour; solid / breathe / blink / fade-blink / blank; brightness 1 dim, ≥ 2 full; `$SPAWN` and every hit clear a paint; **the firmware out-blink does NOT run in a hosted game** (2026-09-04 live) | a count-limited blink ending dark by itself; `$HLED,4..7` on a head |
| headset small flash LED | green only; `$LED,9,1,1,1,*` = one ~66 ms flash, big LED untouched; `$LED,3,1,…` = same flash + big LED green; native hit/out flash ≥ 2× ours (camera floor), "orders of magnitude" by eye; no intensity/count field | fires on a DEAD gun; stacking at 0–50 ms; `$HLOOP,2,<rate>` heartbeat; whether `$LED` inside the F13 window wedges the relay |
| relay | `$SPAWN` within ~2 s of death sticks the headset in the out-blink (F13, 2.5 s clean); any headset-executed frame needs a settling gap | which write kills the firmware's own hosted out-blink (a phone-less fallback if none does) |
| safety | ≤ 3 flashes in any 1 s window per surface; ~30 Hz repaint strobes; bursts ≥ 1 s apart | — |

## 3. The language

### 3.1 Standard (every mode inherits this)

| moment | gun body | headset big LED | headset small LED |
|---|---|---|---|
| pregame (armed, unspawned, muster) | team colour, held | team colour, solid | dark |
| start (T-0) | firmware spawn breathing, then `take` at +2.5 s: **dark** | white ×2 at +1.0 s, then dark | dark |
| in-play rest | **dark** | dark (native) | dark |
| pool change (damage, heal, grant) | **readout**: 3 / 2 / 1 segments of the pool that moved, hue by pool; held 4 s after the last change, then dark | native hit flash only, untouched | native hit flash only |
| reload | readout glance, 2 s | nothing | nothing |
| low health (armour 0, HP falling, once per life) | readout already shows 1–2 red/yellow segments | Callsign's pink fade-blink (`hurt_led`, byte-identical) | native |
| death | `died` burst: red ×3 ending **dark**; dark while down | quiet for the settling gap, then the **down signal** | down signal |
| last 1 s before an auto `$SPAWN` | dark | quiet | quiet |
| respawn | breathing, then `take`: dark | white ×2 at +1.0 s after `$SPAWN`, then dark | dark |
| kill credited (MC push) | no burst (the sight already flashes: `$SFLASH`) | nothing | one green flash (`$LED,9,1`) |
| medals / lead / clock | sound only | nothing | one green flash on the kill family only |

Readout mapping (depletion order shield → armour → HP, the order native Supremacy players already saw):

| pool that moved | segments (ceil of fraction × 3, min 1 while > 0) | hue |
|---|---|---|
| shield | 3 / 2 / 1 | white |
| armour | 3 / 2 / 1 | purple |
| HP | 3 (> 66 %) / 2 (33–66 %) / 1 (≤ 33 %) | green / yellow / red |
| down | 0 | dark |

Rules: the **innermost pool that moved is the news** (`poolgauge.changed_pool`); one write per change, none when
the frame is unchanged, a change inside 300 ms of the last write only restarts the hold; bursts end on dark, or on
the live readout frame if its hold is running, never on the top band. Segment count is the primary channel
(lit-vs-dark reads in sun, at night and for red-green colour-blind players); hue confirms it.

Dropped from today's defaults, with the reason: the `hit_taken` gun burst (the firmware already flashes the body
on a registered hit, the readout step is the feedback, and native + three of ours can exceed three flashes a
second); the `healed` / `armour_up` / `shield_up` bursts (the readout paint IS the feedback); the `respawned` gun
burst (it lands inside the first 2.5 s where it fights the breathing, and the headset white flash + spawn sound
already mark it); the `raid_ending` / `raid_over` headset red on everyone (tells others nothing, collides with red
team).

### 3.2 The down signal (constraint b)

Day: the small LED pulsed every **750 ms** (the native out cadence) **over a big-LED green breathe**
(`$HLED,3,1,,,10,,*` started once, `$LED,9,1,1,1,*` per pulse). If the bench shows colour 9 disturbs a running
breathe (L3), the fallback is `$LED,3,1,1,1,*` alternating with `$HLED,,6,,,,,*` at 375 ms (both lamps, two
writes per cycle). Night: small LED only, same cadence (it has no dim; dropping the companion is the sparseness).

| respawn type | after death | while down | before `$SPAWN` | at `$SPAWN` |
|---|---|---|---|---|
| auto (timer) | quiet 1.0 s (bench L1 may move this) | pulse 750 ms | pulses stop 1.0 s before the timer (the stopping IS the countdown others can read) | white ×2 at +1.0 s |
| scanner (walk) | quiet 1.0 s | pulse 750 ms indefinitely (node timer, no count to expire) | when the gate is satisfied: stop, blank the big LED, wait 1.0 s, then `$SPAWN` | white ×2 at +1.0 s |
| none (eliminated) | quiet 1.0 s | pulse 750 ms for 30 s | then one pulse every 3 s to game end (a marshal can find them, the field is not full of blinking heads) | — |

`respawn.delay_s` is validated ≥ 3 at PUT and floored in the engine (F13). The DOWN signal is **never cleared by
blackout**: it is the one light other players must read and it has no redundant channel.

### 3.3 Held role states on the headset (survive hits)

A `headset.role` state the node re-asserts after every registered hit (the way the carrier blink already is):

| role | headset | ends |
|---|---|---|
| flag / objective carrier, hill king, bomb carrier | **white** blink 300/300 (never the flag's team colour: team colours are identity) | scored, lost, dead |
| infected (Infection / Swarm) | solid in the infected team's colour | game end |
| VIP | solid white from the start | VIP down |
| extraction caller (the beacon) | orange blink 300/300 | banked, failed, dead |
| extracted (out of the raid, do not shoot) | solid white | game end |

### 3.4 Night overlay (constraint c)

`config.night` stays the venue toggle; it now SELECTS an overlay merged over the day block at resolve time.

| surface / moment | day | night |
|---|---|---|
| gun pregame | team, full | team, dim (`$GLED` tok5 = 1) |
| gun rest | dark | dark |
| gun readout | full, 4 s hold, reload glance 2 s | dim, 2 s hold, glance 1 s |
| gun bursts | died, objective, extraction ladder | same set, dim; no decorative bursts |
| headset pregame / role states / low health | full (`$HLED` tok5 = 10) | dim (tok5 = 1) |
| headset start / respawn | white ×2 | white ×1, dim |
| headset hit | native only | native only |
| down signal | small LED + big-LED breathe | small LED only, 750 ms, **full** (no dim exists; the downed player has nothing to lose from being lit and is the one most likely to be shot again or walked into in the dark) |
| MC-pushed bursts (objectives) | dim, ≥ 2 s apart | same |
| blackout (explicit `lights.blackout`) | nothing anywhere except the down signal | same |

### 3.5 Per mode: only the differences

| mode | difference from standard |
|---|---|
| FFA | everyone on one `$TID`; both surfaces **white** pregame (stock look, closes Q19) |
| TDM, Domination, KOTH, Generals, Supremacy | nothing on players (KOTH: hill holder = carrier white blink; stations light their own ownership) |
| Infection / Swarm | infected = held solid team colour on the head (survivors must identify them at range); the turned player's `team_flip` carries per-tid gun + headset tables and re-takes the body |
| Last Man Standing | eliminated cadence; gun dark for good; `last_survivor` sound only |
| CTF / Assault / Team Arena | carrier white blink; `objective_taken` orange burst, `objective_scored` white burst, `flag_returned` sound only |
| VIP | VIP head solid white from T-0; `vip_hit` orange burst on escorts' guns, `vip_down` red burst |
| Counter-Strike (bomb) | bomb carrier white blink; planted orange / defused green / detonated red gun bursts (as built); the timer lives on the site prop |
| Extraction | caller's head = orange beacon (held); `extraction_open` white burst; `extraction_complete` = head solid white; `extraction_closing` orange burst; drop the everyone-red |
| Scanner respawn (any mode) | down pulse indefinite; blank + 1.0 s quiet before `$SPAWN` |
| silenced | bursts off, readout off, hit null (as today) |

Palette rules: **green is never painted on a headset** (native hit + out green); red / yellow on the gun are safe
only because the body no longer rests on team colour; orange means "the objective changed" (one meaning per
mode); white is neutral / good / objective. Teams: 0 red · 1 blue · 2 yellow · 3 green on both surfaces
(identity map, fixing the gun table); a green team head reads as an out-blink at range, so a fourth team should be
**purple (tid 4)** once `$TID,4` + `$HLED,4` are bench-confirmed. Form carries state for colour-blind players:
solid = identity, slow blink (≤ 2 Hz) = a state, triple 80 ms = an event, small-LED pulse = down.

Low-health: Callsign's `$HLED,7,4,90,90,10,15` is ~5.5 Hz for 2.7 s, inside the 3–30 Hz band. Kept as the
default for native fidelity (players know it); `lights.headset.low_health: native|soft` where soft =
`$HLED,7,4,150,150,10,8`.

## 4. The config: `presentation.lights` (A16, additive)

```jsonc
presentation.lights: {
  blackout: false,                       // was led.mode:"off". true = no frame anywhere EXCEPT `down`
  gun: {
    pregame: "team" | "off",             // muster: the armed, unspawned body in the team colour
    rest:    "dark" | "team" | "native", // DEFAULT dark; native = firmware breathing, nothing sent
    bursts:  true,                       // was gun_flash
    readout: { pools: ["shield","armor","health"], hold_s: 4, reload_glance_s: 2 }   // [] = no readout
  },
  headset: { pregame: "team"|"off", start_flash: true, in_play: "dark"|"team", hit: null|colour,
             low_health: "native"|"soft", respawn_flash: true, role: true },       // A11.6, `carrier` → `role`
  down:    { flash: true, period_ms: 750, companion: "breathe"|"blink"|null,        // NOT subject to blackout
             quiet_after_death_s: 1.0, quiet_before_spawn_s: 1.0, eliminated_slow_after_s: 30 },
  night:   {                             // overlay, applied when config.night is true; every key optional
    brightness: "dim",                   // tok5 = 1 on every compiled $GLED / $HLED frame
    events: [/* the events that keep their lights at night; others sound only */],
    gun:     { readout: { hold_s: 2, reload_glance_s: 1 } },
    headset: { start_flash: "single", respawn_flash: "single" },
    down:    { companion: null }
  },
  events: { <event>: { sound, gun_led, headset, flash } }   // unchanged (A11.2)
}
```

Collapse map (old → new): `led.mode:"off"` → `lights.blackout` · `led.brightness` → `lights.night.brightness` ·
`led.colors` dropped (never read) · `gun_flash` → `gun.bursts` · `gun.in_play team|dark|native` → `gun.rest` ·
`gun.in_play: health` → `rest: dark` + `readout.pools: ["health"]` · `headset.carrier` → `headset.role` ·
`headset.death: flash|native|colour` → `down.flash` + `down.companion` · `headset_team` → derived in `summary()`
only · `gameconfig.leds` → `not blackout` · `is_night_mode()` deleted (compile passes `brightness`). `resolve()`
accepts the old keys (pure, no stored rewrite); `summary()` keeps emitting the old switches so the ADVANCED view
works unchanged; the snapshot restore already replaces a missing profile. The preset name becomes a field of each
`state.MODES` row so every catalogued mode resolves (mode-extensibility G3).

Validation in `merge`: `brightness ∈ {full, dim}`; `hold_s` 1..10; `readout.pools ⊆ {shield, armor, health}`;
`night.events ⊆ EVENTS`; `down.period_ms` 500..3000; gun colours 0–8, headset colours 0–7 (one `HEADSET_TIDS`
constant shared by compile and presentation); `respawn.delay_s ≥ 3`.

## 5. Bundle tables and node rules (A4.2: MC compiles every frame, the node selects and owns the timers)

```jsonc
gun: { rest: "$GLED,9,9,9,0,10,,*", blank: "$GLED,,,,5,,,*", after_spawn_s: 2.5, take: [blank, rest],
       readout?: { hold_s, reload_glance_s,
                   pools: [ { pool: "shield", max: 70, bands: [[0.66, f3], [0.33, f2], [0.0, f1]] },   // outermost first
                            { pool: "armor",  max: 70, bands: […] },
                            { pool: "health", max: 45, bands: […] } ] } }
headset: { rest, blank, start, respawn, hit, low_health, role: { carrier: [[…]], infected: [[…]], vip: [[…]], beacon: [[…]], extracted: [[…]] },
           down: { frame: "$LED,9,1,1,1,*", period_ms: 750, companion?: "$HLED,3,1,,,10,,*",
                   quiet_after_death_ms, quiet_before_spawn_ms, eliminated_slow_after_ms } }
```

Node rules (engine.js): on every `$HP`, `pool = changed_pool(prev, now)`, band by `level/max`, write only on frame
change, restart the hold, revert to `rest` on expiry; bursts end on `rest`, re-write the live readout frame after
a burst if its hold is running; `_death` clears the readout and the died burst ends dark; the down pulse starts
after `quiet_after_death_ms`, stops `quiet_before_spawn_ms` before an auto `$SPAWN`, and a scanner revive blanks,
waits, then spawns; the respawn white flash is scheduled ≥ 1.0 s after `$SPAWN`; one `_lightGen` bumped in
`_endLocal`, panic, resync, reconcile and BLE drop cancels every pending light step; `max` for shield comes from
MC (`$PSET` token 5), never parsed from a frame. Night arrives pre-compiled: no engine change.

## 6. Findings, ranked by match-day impact (all four lenses merged; ✔ = verified in code by the lead)

| # | finding | fix | where |
|---|---|---|---|
| 1 | ✔ **Gun-body team table is offset**: `TEAM_COLOURS = {1: BLUE, 2: RED, 3: YELLOW, 4: GREEN}` vs server tids red 0 / blue 1 / yellow 2 / green 3. Yellow team guns paint RED, red team WHITE, green YELLOW; only blue (every bench) agrees | identity map, tests for tid 0 and 2 | `poolgauge.py:46`, `state.py:25-29` |
| 2 | ✔ **Night is a blackout, not a profile**, and it deletes the DOWN signal: `leds = … and not night` empties every table incl. `death_flash`; the dim path is unreachable and its unit test asserts a state compile cannot produce | night overlay (§3.4); `down` exempt from blackout | `compile.py:465`, `gameconfig.py:265`, `presentation.py:537`, `test_presentation.py:305` |
| 3 | ✔ **Death pulse never fired on a dead gun** and starts ≤ 250 ms after `$HP,0`, then runs up to `$SPAWN`; no F13 floor on `respawn.delay_s` (MC accepts 0–600) | bench L1/L7 first; quiet gaps (§3.2); validate ≥ 3 s | `engine.js:846`, `state.py:765` |
| 4 | ✔ **Static "died" headset colour never lands** (`alive=false` precedes `_event('died')`; `_eventLeds` skips `$HLED` while down): last_stand / infection presets' only headset feature is dead code | mode down-looks go through the death sequence / role state, not the events table | `engine.js:1053, 1069, 526`, `presentation.py:260, 269` |
| 5 | ✔ Gun rest is a static bright team colour; a dead gun shows full health (died burst ends on the top band; repaint needs alive); health mode ignores armour and shield; poolgauge's 3-segment code is orphaned and its docstring still says segments do not work in play | dark rest + transient readout (§3.1) | `presentation.py:229, 514-518`, `engine.js:485-496`, `poolgauge.py:14-24` |
| 6 | Held headset states are one-shot event frames wiped by the first hit (infected red, extraction beacon orange); alive-event static `$HLED` under `in_play: dark` never returns to rest (VIP orange stays until the next hit, and an operator reads a lit head as "never joined") | `headset.role` re-asserted after hits; every static event `$HLED` gets a hold then rest | `presentation.py:260, 273, 519-521`, `engine.js:983-985` |
| 7 | Respawn white flash is written ~50 ms after `$SPAWN`, which clears the headset (a paint at 1 s is the only measured-good offset); the `respawned` gun burst lands inside the 2.5 s breathing window | schedule at +1.0 s; drop the gun burst | `engine.js:633`, `presentation.py:61` |
| 8 | Light timers outlive their state: burst steps, medal delays and the headset rest step fire after end/panic wrote the teardown blank; `_reassertDeathBlink` not gated on resync; a resync death re-writes the head, whose lobby `$HLED` team paint lands over the out-blink | one `_lightGen`; strip the head's `$HLED` on a dead re-arm | `engine.js:463, 531, 723, 852, 1156` |
| 9 | Config is four overlapping switches: `led` is dead but in the contract, `headset_team:false` strips spawn/revive but leaves the head and rest lit, `death` default (`flash`) contradicts the spec, `death_flash` is in no spec file, the 4-token `$LED` is narrated as `<effect>,<pulses>` | `presentation.lights` (§4) + one A16 amendment | `contracts.md:136, 162-173`, `compile.py:599`, `presentation.py:187-210` |
| 10 | Headset cadence has no rate gate: the hit-colour opt-in + native + a respawn flash can exceed 3/s; MC-pushed bursts land on every gun in sync in a dark arena | headset shares the 1 s gap; MC bursts ≥ 2 s apart, dim at night | `engine.js:984`, `presentation.py:509` |
| 11 | Carrier blinks the flag's team colour (identity spent on a non-identity fact); green team head = native out green; FFA paints 3+ team colours (Q19) | white carrier; purple 4th team after bench; FFA white | `presentation.py:551`, `poolgauge.py:46` |
| 12 | Phone dies → the gun holds the last readout and the headset stays dark on death: the player looks alive forever | bench: which write kills the firmware's hosted out-blink; MC NODE LOST + operator call until then | — |
| 13 | Headset tid range disagrees: compile paints heads 0–3, presentation 0–7; two different blank frames (`$HLED,0,0,0,0,0,0` in END_SEQUENCE vs `$HLED,,6`) | one `HEADSET_TIDS`; one blank | `compile.py:71`, `gameconfig.py:165`, `__main__.py:188` |
| 14 | Stale hardware claims in code and docs (poolgauge in-play prohibitions; "firmware blinks green while out"; 2-field `$LED` stated as fact but unrun; "team colour pre-game only" in manual/gotchas wrong for `in_play: team`) | sweep in the same commit as A16 | `poolgauge.py:14-20, 62-66, 104-106, 198, 211`, `presentation.py:166, 198`, `brx-protocol.md:98` |

Operator asks (ship with S10): a plain-language preset preview per venue ("HEADSET: team colour before start,
dark in play, bright green pulse while down; GUN: dark, pool bar when hit"); a muster **lights check** with a
per-player BLINK ME (`$HLED` white ×2); DOWN-screen copy for scanner players who cannot see their own head
("YOUR HEADSET IS FLASHING GREEN. EVERYONE CAN SEE YOU ARE OUT. Walk to your station." / night: "… call OUT as you
walk"); a HUD pill when `$HIR` and the trigger both go silent while alive (headset asleep).

## 7. Build plan (S10), by subagent

Contract first, then four parallel lanes with disjoint files, sonnet for the mechanical lanes:

1. **Contract** (main session): A16 text in `contracts.md` §3 + FrameBundle, `presentation.lights` shape, bundle
   tables (§5), `HEADSET_TIDS`, `$LED` shape decision after bench L2.
2. **MC lane** (`presentation.py`, `compile.py`, `poolgauge.py`, `state.py` validation, `test_presentation.py`,
   `test_poolgauge.py`): lights block + overlay + collapse map; identity team table; readout tables; role
   states; down block; delete `is_night_mode`; docstring sweep.
3. **Engine lane** (`engine.js`, `engine.test.mjs`): readout with hold/coalesce/reload glance; died ends dark;
   down pulse quiet gaps + eliminated cadence; respawn flash at +1.0 s; role re-assert after hits; `_lightGen`;
   delay floor. HUD copy goes to the brx-hud session.
4. **Console lane** (`AdvancedPresentation.tsx`, `types.ts`, `client.ts`, mock): lights block editor + preset
   preview sentence + muster lights check (`ui-build-verify`).
5. **Docs lane** (haiku/sonnet): protocol rows (`$LED` shape, `$HLED` blank), manual "reading the headset" table,
   gotchas line, `poolgauge.py` header, FOLLOWUPS/HANDOFF.
Gate: the bench ladder (§6 of the flash-control sheet) before lane 3's down-signal timing is final; everything
else can build now.
