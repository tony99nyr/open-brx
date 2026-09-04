# Utility items: the implementation plan (2026-09-04)

The utility role turns a spare phone into an item on the field. One kind, the **respawn station**, is built,
bench-proven on two Pixels and shipping in APK 0.1.6. This is the plan for everything else, written so any
session can pick up a row and know what to build, on which surface, and what proves it.

The spec of record stays `docs/spec/utility.md` (advert format, presence, the respawn rule, MC arming);
mode rules stay `docs/game-modes.md`; hardware ceilings stay `docs/mode-limits.md`. This document is the
**order of work** across them. When a row lands, mark it here and promote the facts into the spec.

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
| 7 | MC side of arming: `station_config` push, ITEMS panel at muster, persisted assignments | `mcp/brx_mcp/mc`, `webapp/mc` | 🔴 not started (brx session, FOLLOWUPS S5) | — |
| 8 | Headset out-blink while down, re-asserted | `engine.js` | ✅ built (A11.6/7) | bench 2026-09-04 |
| 9 | Station intermittently hears no player adverts at high TX | `utility.js` scan | ✅ fixed (S6, 53e62bd: low-latency scan + restart) | soak on two phones pending |
| 10 | Reconnect / new-match reconciliation on a rejoin | `engine.js` | ✅ built (S7.1, a63aa10: 3 s disarmed reconcile, never heals) + the HUD's RECONCILING takeover | validated on R0BQT 2026-09-04 (contracts A6.8, node.md §3.10) |
| 11 | Harness: utility presets, fake players, fake `station_config` | `tools/stage.html`, `?stage` | ✅ built | — |

Kinds 2–5 (powerup, extraction, bomb, control) are designed in the spec's §5d table and not built.

## 2. Cross-cutting work first

These unblock every kind and are cheap relative to the kinds themselves.

### A. The arming loop (MC ↔ station)
| what | surface | owner | done when |
|---|---|---|---|
| A1 `station_config` push over M-NET (`{kind, team, id, threshold?, game?, valid_ids?}`), accept `hello node_type "utility"` with no gun, never bind | MC server | brx | a `--demo` MC arms `utility.html?mc=…` from the harness; step #49 goes end to end against the real push |
| A2 ITEMS panel at muster: one row per utility phone from its heartbeat (kind, team, id, threshold, live, revives, armed, **battery**, last seen, app version); assign + ARM buttons; persisted per session | MC UI | brx | e2e step: assign a phone, see MC-ARMED on the utility page |
| A3 Battery + app version in the utility heartbeat | `utility.js` | brx-hud | field visible in A2 |
| A4 **Attention flags** on the ITEMS row: "bring back to re-arm" (assignment changed since last contact), "battery low", "not seen since last match", "app behind" | MC UI | brx | e2e: change a team on an offline phone → the flag appears |
| A5 `config.stations` from the compiler = the ids MC armed this game; the utility phone displays `valid_ids` | compiler + `utility.js` | brx + brx-hud | player phone ignores a station not on the list (engine test exists; wire the list) |
| A6 Recap: stations row — revives per station from player facts vs the station's own count; ✓ when they agree, ⚠ when the station was never heard | MC scoring + recap UI | brx | recap e2e |

### B. Radio hardening
| what | surface | owner | done when |
|---|---|---|---|
| B1 S6: station scan starvation while advertising — ✅ fixed (53e62bd); the two-phone soak is still owed | `utility.js` | brx-grenade | 10-minute soak: player list never empties while a player phone stands there |
| B2 Android opportunistic-scan demotion: restart the HUD's beacon scan every 25 min | `app.js` | brx-grenade | soak |
| B3 iOS: build `BrxBeaconPlugin.swift` on the MacBook, verify advertise + scan | plugin | whoever has the Mac | iPhone as station revives a Pixel |
| B4 RSSI-vs-distance at each TX level, phone-to-phone; per-kind default thresholds (a zone is bigger than a respawn point) | bench doc | Tony + a session | a table in `utility.md` §3 |

### C. Match scoping
| what | surface | owner | done when |
|---|---|---|---|
| C1 `game` byte from `station_config` (already applied on the phone); MC bumps it per match | MC | brx | a station armed for game 3 is ignored by players holding bundle game 4 |
| C2 Player phones filter presence by the bundle's game byte (Presence already supports `game`) | `app.js` | brx-hud | engine test |

## 3. The kinds, in build order

Each kind = a station state machine (what it advertises in `state`/`value`), a player-node rule (engine +
HUD copy), an MC mode/scoring, tests, and a bench gate. The order is by (game value × how much of the respawn
primitive it reuses).

### K1 · Control point → Domination and King of the Hill (first)

**Rule.** A control point is owned by the team with the most present players, after a capture time with
nobody else present (KotH: hold 45 s to win the hill, ~5 s recapture; Domination: 1 point per second held).
One station = King of the Hill; several = Domination.

| surface | work |
|---|---|
| station (`utility.js`) | state machine: `state` = owner tid (255 neutral) · `value` = capture progress % while contested, then seconds held (8-bit, saturating). Inputs: player adverts (team, alive) present at the station. Rules: alive present players of one team and none of another → progress toward that team over `capture_s`; mixed → frozen; empty → holds owner. Screen: owner in the team colour, CONTESTED, capture bar, hold time. Tally per team persisted for recap. |
| player node (`engine.js`) | `state().objective` = the nearest control station `{id, owner, progress, contested, mine}`; facts `capture` (station, team) when the owner flips while this player is present. No gun writes. |
| HUD (`hud.js`) | a live-screen OBJECTIVE line: HOLD THE HILL · 32 s / CONTESTED / LOST — reuses the alert banner (`point_captured`, `hill_captured` already exist) and the DOWN recap's "race to the cap". |
| MC | modes `hill` (win: hold total ≥ N s or most hold time at time-limit) and `domination` (points per second, cap); the ITEMS panel arms kind `control`; scoring from `capture` facts + the station's tally at recap. Alerts `point_captured` / `hill_captured` / `lead_taken` already wired in A11. |
| tests | engine: owner flips, contested freeze, dead players don't count, allow-list. screens: an OBJECTIVE line stage. utility: a fake-player script drives the state machine in the harness. |
| bench gate | two phones + two guns: capture, contest, recapture; hold timer matches a stopwatch within 1 s. |
| needs | B1 (the station must hear player adverts reliably) — this is the first kind that depends on it. |

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
| **brx-grenade** (spec, plugin, radio) | spec updates for each kind (`utility.md` §5d → real sections), B1–B3, station state machines' spec text, S7 |
| **brx** (MC server + console) | A1, A2, A4, A5 (compiler), A6, C1, the `hill` / `domination` / `cs` modes and scoring |
| **brx-hud** (phones) | A3, A5 (phone), C2, every `utility.js` state machine and screen, every engine rule + HUD copy per kind, harness stages and screen-truth steps |
| **Tony** | bench gates (§5), thresholds, the blast-damage decision, which kind after K1 |

## 7. Rough size

K1 is about a day across the three surfaces once A1/A2 exist (the presence primitive is done). K3 half a day.
K2 a day (loot mirroring is the tricky part). K4 a day and a half plus its bench. A1–A6 a day for the MC side.
B1 is an hour of code and an evening of soak. Total: about a week of sessions, with K1 playable first.
