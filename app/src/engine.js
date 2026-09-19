// BRX node engine — docs/spec/node.md (contracts A6). DOM-free, BLE-free, transport-free.
//
// Inputs:  BRX frames (feedFrame), MC messages (onMcMessage), hydration (hydrate), clock ticks (tick),
//          BLE link events (onBleConnected / onBleDropped), app-lifecycle (resume).
// Outputs: frames to write (writer(frames[])), persisted facts (emit(fact)), non-fact reports
//          (report(kind, body)), and a render-able snapshot (state()) with a change callback.
//
// Every write to the gun goes through `writer`; the engine never composes a frame except the
// literal templates (`$SFLASH,*`, `$PLAYX,0,*`, the stun cue `STUN_PLAY`), the pre-config probe set
// (contracts §3/§8), and the `HILL_CUES` literals below (which the bundle overrides the moment it
// carries those cue keys).

import * as W from './transport/envelope.js';   // single source for the contracts §9 constants
import { SPAWN_KILL_WINDOW_MS } from './transport/contract.gen.js';   // 2026-09-19: the spawn-kill escalation window
import { stationView, TEAM_ANY } from './beacon.js';   // utility-item presence (docs/spec/utility.md)
import { CONTROL_STATE, claimable } from './control.js';   // the phone control point's advert bits + who may own a point (utility.md §5 `control`, K1)
export const C = {
  STATUS_HEARTBEAT_MS: W.STATUS_HEARTBEAT_MS, SYNC_FRESH_MS: W.SYNC_FRESH_MS, FEEDBACK_MAX_AGE_MS: W.FEEDBACK_MAX_AGE_MS,
  LATE_ARM_GRACE_MS: W.LATE_ARM_GRACE_MS, DEATH_LATCH_MS: W.DEATH_LATCH_MS, RESYNC_PROBE_S: W.RESYNC_PROBE_S,
  CONFIG_TTL_MS: W.CONFIG_TTL_MS,
};
export const SFLASH = '$SFLASH,*';
export const PLAYX = '$PLAYX,0,*';
/** The command word of a `$…` frame, or '' -- `$DPLAY,A10,4,*` -> 'DPLAY'. A gun<->radio control frame
 *  (`$!…`, `$^…`, `$&…`) keeps its prefix so it never matches a real command by accident. */
export function frameCommand(f) { return typeof f === 'string' && f[0] === '$' ? f.slice(1).split(',')[0].toUpperCase() : ''; }
/** True when the node must never write this frame (transport-hardening.md §4): the word is on the generated
 *  deny list, or it is a gun<->radio module control frame. */
export function deniedCommand(f) { const w = frameCommand(f); return !!w && (W.NODE_DENIED_COMMANDS.has(w) || '!^&'.includes(w[0])); }
export const PROBE_VOLTS = ['$PHONE,*'];
export const PROBE_FW = ['$STOP,*', '$PHONE,*', '$VERSION,*'];

const PHASES = ['idle', 'connected', 'kitted', 'lobby', 'armed', 'live'];
const TEAM_NAME = { 0: 'RED', 1: 'BLUE', 2: 'YELLOW', 3: 'GREEN' };
// How long the HUD shows the ALT indicator before giving up on a confirmation.
// The gun only volunteers $ALCD on a SHOT, so a swap is confirmed by the next trigger pull and this
// window is a display timeout, nothing more. On expiry the indicator simply clears — the HUD keeps
// showing the slot the GUN last reported. It deliberately does NOT guess a new slot: $BUT,1 is
// "alt-fire", which is also the native 3s indoor/outdoor toggle and is remapped to RELOAD by the
// easy_reload perk, so a press is not proof a weapon changed (review 2026-08-31).
const RECONCILE_MS = 3000;           // rejoin: hold the gun disarmed this long while we reconcile state (anti-cheat: a restart is slow + gains nothing; a real crash costs 3 s, which is rare and fine — Tony 2026-09-04)
// node.md §3.11: how long the engine must have been ASLEEP before a foreground counts as a suspension.
// `resume()` fires on every `visibilitychange` and `pageshow`, which includes a notification shade, a
// glance at the lock screen and an app switch of half a second — none of which froze the webview. A
// reconcile costs the player RECONCILE_MS disarmed AND re-arms from `frames.spawn`'s $AMMO, so running one
// on a phone that never stopped ticking is both a mid-fight disarm and a free full magazine on demand
// (review 2026-09-12). The engine ticks at 250 ms, so 5 s is ~20 missed ticks: a real freeze, never jitter.
const RESUME_GAP_MS = 5000;
// B4: how long the gun may go completely silent (no frame of any kind — not even the ~30 s $VOLTS
// telemetry) while `bleUp` is still true before the watchdog treats it as dead and forces a reconnect.
// Set well above the $VOLTS cadence (protocol: "only reliably returned at good RSSI") so a couple of
// missed samples at the edge of range never trips it, while still catching a truly stale link inside a
// normal-length match.
// Shipped at 75 s and raised to 150 s (~5 cadences) by the round-1 polish review 2026-09-12: 75 s is
// only ~2.5 cadences, so a healthy-but-marginal link whose player happened to take no hits and fire no
// shots for 75 s was force-disconnected — and what follows is not free. `_beginReconcile()` disarms
// both slots for RECONCILE_MS and `_endReconcile()` re-arms from `frames.spawn`'s $AMMO, i.e. a
// mid-firefight disarm plus a full magazine, which is the exact cheat RESUME_GAP_MS above exists to
// close. 150 s is still a DESK number: only a gun at the edge of range can say what the real silence
// looks like, which is FOLLOWUPS F136 (the B4 bench item, with the 20-minute two-node soak).
const LINK_STALE_MS = 150000;
// 🔴 ...and it SHIPS OFF (round-2 fix pass I, 2026-09-12). 150 s is a desk number, `$VOLTS` is the only
// idle traffic the threshold can be measured against and it is unreliable at exactly the marginal RSSI
// this is supposed to catch, and a FALSE trip is not free: `_beginReconcile()` disarms both slots for
// RECONCILE_MS and `_endReconcile()` re-arms from `frames.spawn`'s $AMMO — a mid-firefight disarm plus a
// full magazine and reserve, which is the cheat RESUME_GAP_MS exists to deny. The player it would hit is
// a defender at the edge of range who neither fires nor is hit: the one the watchdog is least able to
// tell from a real drop. So the mechanism stays (and stays tested — the B4 suite sets the flag on), but
// nothing trips until the bench gives it a measured number. Gate: FOLLOWUPS **F163**, the B4 bench item
// with the 20-minute two-node soak.
const LINK_WATCHDOG_ENABLED = false;
const HEADSET_REBLINK_MS = 120000;   // re-paint the DOWN out-blink every 2 min (< the ~160 s blink count) so a long scanner walk stays lit
const PICK_DEBOUNCE_MS = 400;        // A26 (S20): a WEAPON pick equips AND arms it for test-firing, so every tap costs an MC round-trip and a $WEAP write on the gun. Scrolling the rack must not spam either: only the last row tapped inside this window is sent (loadout.md §4.5)
const SWITCH_MAX_MS = 850;       // the stock $WEAP tok15 (bench 2026-09-04: 850 ms, linear, no floor) — a fallback; the bundle carries the real value in frames.swap_ms
const EVENT_MIN_GAP_MS = 1000;
const RESULT_SETTLE_MS = 30000;     // A24/node.md §3.13: after the whistle the results screen says PENDING for this long; only
                                    // then, and only with MC unreachable, does it say MC NOT REACHED. It NEVER says lost.
const READOUT_COALESCE_MS = 300;    // A16 §3.1/§5: a change within this of the last READOUT WRITE only restarts the hold, it does not write again
const PAIN_GAP_MS = 600;            // A15.3: at most one pain grunt per 600 ms (drop, never queue)
const TRYOUT_ARM_MAX_MS = 3000;     // F147: past this with no confirming $ALCD/$LCD, assume the write took anyway — same
                                     // "the real duration has never been timed" precedent as `switchWindowMs()`, so SWITCHING… never hangs forever
// A17.2: HP below which the once-per-life low-health alert fires (Tony, bench 2026-09-07). ABSOLUTE, not
// a fraction of maxHp. Set to 15 rather than the first-cut 20 precisely BECAUSE it is absolute: 20 is a
// third of the 45 HP default but well over half a 35 HP scout, so the smallest pool would have been warned
// almost as soon as it started taking damage. 15 keeps the warning late on every stock pool. If a loadout
// ever needs its own value this wants plumbing through the bundle the way `voice.pain_long_min` is.
const LOW_HEALTH_HP = 15;
// Office test 2026-09-19: how long the low-health write waits before it actually reaches the gun, so a
// death that lands inside the window can cancel it outright instead of merely interrupting it (see _onHp).
const HURT_DEBOUNCE_MS = 400;
// THE RELOAD NAG (Tony, bench 2026-09-18). The magazine is empty, the reserve is not, and the
// player keeps pulling the trigger: say RELOAD on the 5th pull of that dry spell and on every 3rd after it
// (5, 8, 11 …). Tony's numbers, verbatim, and they are a taste decision, not a measurement: the first four
// pulls are the player finding out, and one word per three pulls after that is a reminder rather than a
// scold. A reload resets the spell (`_onAmmo`), so the count is never carried between magazines.
const RELOAD_NAG_FIRST = 5, RELOAD_NAG_EVERY = 3;
// S29(a) THE SHIELD RECHARGE. Until this existed the shield pool only ever moved when something sent a
// `$LIFE` grant and nothing did, so shields never came back and none of the cues below could be benched at
// all (Tony, 2026-09-18: "shields also never recharged").
//
// The delay is Callsign's own, read off a capture on 2026-09-18: it waits 6.2-6.6 s after the last hit, then
// refills. ⚠ Callsign refills with `$BUMP,12,,1,,,*` every ~0.5 s, and `$BUMP` is INERT on our firmware v4.32
// (bench 2026-09-09) -- so the cadence below is Callsign's, the LEVER is the `$LIFE` shield grant, which is
// bench-proven (2026-09-17 step 7: grants of 10/20/25/30 all land and the gun clamps at the `$PSET` t5
// ceiling). 10 every 300 ms took 0 -> 120 in 4.1 s on the bench, which is the refill these numbers reproduce.
//
// ⚠ Not ear-tuned. Halo's own numbers are 5 s and 4 s; Callsign's measured 6.4 s and 2.5 s. These are the
// measured ones, and they are a named constant precisely so the bench can move them.
const SHIELD_REGEN_DELAY_MS = 6500;   // quiet since the last damage before a refill may start
const SHIELD_REGEN_STEP = 10;         // `$LIFE,0,0,10,*` -- the grant the bench refilled with
const SHIELD_REGEN_STEP_MS = 300;     // one grant per this: 0 -> 120 in 4.1 s
// A gun that stops echoing `$HP` would otherwise be granted at forever, so a refill is capped at the grants a
// full pool can possibly need plus slack for the ones that landed while a hit was in flight.
const SHIELD_REGEN_MAX_GRANTS_SLACK = 3;
// The shield-down heartbeat replays as the clip ENDS, so it can never stack with itself. N74 runs 1.94 s
// (sound catalog); a bundle may override per game through `cue_ms.shield_loop`, the same lever the hill cues use.
const SHIELD_LOOP_MS = 1940;
/** F209: the longest a spawn or revive stays hit-protected (`$TMP` t8 = -100, F121 rebuild) when the gun has not fired sooner. Its
 *  first shot proves the weapon is live and arms at once. 2100 ms is hud.js `_redeploy`, the REDEPLOYED overlay
 *  (gone at 2100 ms): the window in which Tony was hit. On the wire (rings 2026-09-16) `$BMAP,0,0` left at most
 *  ~1.5 s after the write started, so the cap never arms before the trigger is mapped; the real table's ~10
 *  frames then land over ~0.6 s more. */
export const SPAWN_PROTECT_MAX_MS = 2100;
/** 2026-09-19 respawn profiles (Tony; contracts.md §3). A bundle with `respawn_profile` never ends protection on a
 *  shot: a TIMED spawn or revive (in place) holds the trigger until `trigger_ms` and carries protection only when the
 *  game sets it; a STATION revive maps the trigger at once and shows a shield on the headset until
 *  `station_protect_ms`. An older bundle keeps the path above. The shield re-assert after a hit is gated to one per this. */
export const SHIELD_REASSERT_MS = 500;
/** 2026-09-19 (Tony, field: at go-live he held full auto on the other team and they were still protected). At match
 *  start everyone is equal: the live `$SIR` table goes on the gun this long before go-live, while the head still
 *  holds every trigger, so every player is hittable AND can fire at the same moment. The T-0 spawn carries no t8. */
export const PRE_ARM_TABLE_MS = 3000;
/** compile.py `TRIGGER_AFTER_PROTECT_MS` (types.py): a timed trigger goes live at least this long after
 *  protection ends. Mirrored here so a retried protection-off write can push `_triggerPending.due` out by
 *  the same margin -- the trigger must never go live while t8 is still -100 (review finding, 2026-09-19). */
export const TRIGGER_AFTER_PROTECT_MS = 500;
export { SPAWN_KILL_WINDOW_MS };
/** The down-screen warning levels: 1 = the normal line, 2 = larger and pulsing, 3 = maximum (held for the match). */
export const DOWN_WARN_MAX = 3;
/** F208: how long a live gun may say nothing at all before its pool is called stale. An idle gun in app mode
 *  sends only `$VOLTS`, and the captures put that at ~60 s, not 30 s (2026-08-23 two-tagger combat: 60.1, 60.2,
 *  60.2 s apart, one gap of 120.3 s where a sample went missing at close range; 2026-09-13 field ring: 60.2 s).
 *  185 s lets two samples in a row go missing before it says so. Display only: nothing is written to the gun. */
export const GUN_QUIET_STALE_MS = 185000;
/** F208: a trigger press on a live, loaded gun gets its `$ALCD` inside ~5 ms (2026-08-26 burst rifle capture).
 *  With no pool report 1500 ms after the press, the pull went unanswered (the same window resync uses). */
export const TRIGGER_NO_FIRE_MS = 1500;
/** F208: unanswered pulls in a row, with no `$HP`/`$LCD`/`$ALCD` between them, before the pool is stale. One is a
 *  charge hold or a fire-rate gap; three is a gun that does not fire (2026-09-13: ROCCO pulled for 105 s). */
export const NO_FIRE_PULLS = 3;
/** F264 (bench 2026-09-18): a player was dead on the gun and alive on the HUD for 94 s, and nothing self-healed
 *  it. `poolStale()` said `no_fire` 16 s in and again a minute later; nothing acted on it either time. The node
 *  now acts -- but it ASKS FIRST, because `no_fire` has two proven causes and only one of them wants a revive:
 *
 *    1. The gun died and the killing `$HP`/`$LCD` never reached the node. The gun is in its own dead state:
 *       still linked, still sending `$VOLTS`, still reporting `$BUT,0,1`, and answering a pull with nothing.
 *    2. The node's magazine account is AHEAD of the gun's (the other stall that night: a reload that timed out
 *       at `0 -> 12 of 32`, so the node believed 12 rounds the gun did not have). The player is alive.
 *
 *  A revive is right for (1) and wrong for (2): it would hand a live player a free life and lose the death. So
 *  the node asks, and acts only on the answer.
 *
 *  THE NODE NEVER REVIVES ON NO EVIDENCE. If nothing answers, the cure does NOTHING, says so in the status
 *  heartbeat so the operator's board can tell them to press FORCE RESPAWN, and logs the values. A blind revive
 *  would hand a free life to a player whose gun was merely empty with a stale belief behind it (Tony, 2026-09-18).
 *
 *  ⚠ TWO PROBES, AND THEY ARE NOT INTERCHANGEABLE. Measured on hardware, two taggers, v4.32, 2026-09-19:
 *   - `$LIFE,0,0,0,*` adds nothing to any pool. It answers **immediately** with `$HP`, from a LIVE gun (its
 *     unchanged pools) AND from a DEAD one (`$HP,0,0,0`). Positive evidence in both states, short reply, no side
 *     effect. It is THE detector, and it needs no new code at all: `_onHp` already books the death from a zero.
 *     ⚠ The same command word is also a REVIVE: `$LIFE,<hp>,0,0,1,*` brought a cleanly killed gun all the way
 *     back on the bench (2026-09-19) with no `$SPAWN` at all, keeping its magazine and its `$TMP`, in two frames
 *     against the revive head's seventeen. It is NOT built and must not be: it was measured on a cleanly killed
 *     gun, not on one in the F264 stall, and those may not be the same condition (F264 carries the gate). What it
 *     does mean is that the revive head is the only PROVEN cure here, which is a smaller claim than the only
 *     possible one -- do not let any comment in this file grow into the larger one.
 *     Measured against a live gun as the control, both the bare `$LIFE,*` and this all-zero form. An earlier
 *     disassembly reading had a dead gun reporting by SILENCE; the bench retired it and `protocol/brx-protocol.md`
 *     now carries the measurement. Nothing here rests on the disassembly any more.
 *   - `$QUERY,*` answers its `$LCD` at once, and that `$LCD` is the ONLY frame carrying the MAGAZINE, which is
 *     the one thing that tells an empty gun from a stuck one. But its status-array BODY arrives about 2 s later
 *     with NO trailing `*`, and **a dead gun holds its print loop for those 2 s** (a live gun: about 30 ms). That
 *     is the `$DPLAY` failure shape in miniature, which is why `$DPLAY` is on the deny list at all. So `$QUERY`
 *     NEVER goes on a timer and never goes to a gun that might be dead. It is sent in exactly ONE place: after
 *     `$LIFE` has already proved the gun ALIVE and the node still needs the magazine.
 *  ⚠ `$QUERY` CANNOT prove the `$SIR` table: nothing reads that back (transport-hardening.md §6). Nothing here
 *  implies the hit table is verified. The `$QUERY` token map is confirmed by SHAPE only, on an unconfigured gun
 *  (levers claim 19), so `_probeShapeOk` checks the shape and refuses a reply that does not fit. */
export const QUERY_REPLY_MS = 1500;      // how long a probe has to answer before it counts as lost. Measured: `$LIFE`'s `$HP` and `$QUERY`'s `$LCD` are both IMMEDIATE, so this is slack, not a deadline
/** The `$QUERY` status-array BODY, measured at about 2 s behind on a dead gun. It is deliberately NOT inside
 *  `QUERY_REPLY_MS`: the `$LCD` has already decided by then, and the body is only ever a corroborating HINT. */
const QUERY_BODY_MS = 2600;
export const CURE_ASKS = 2;              // probes before the cure gives up: one lost notification is ordinary, two in a row is not
export const CURE_COOLDOWN_MS = 30000;   // the floor between cures, ACROSS lives
/** F264: the divergence poll. The gun's outbound stream does NOT stop in this fault (`$VOLTS` kept arriving
 *  through both proven stalls), so a "gun has gone quiet" watchdog can never catch it and `no_fire` needs the
 *  player to pull a dead trigger three times. Polling catches the same divergence with nobody pulling anything.
 *  Tony approved 20 s (2026-09-18). The heartbeat sends `$LIFE` and NEVER `$QUERY` (bench 2026-09-19: a dead
 *  gun holds its print loop 2 s on a `$QUERY`, and a heartbeat is exactly the thing that would hit a dead gun
 *  over and over). LIVE MATCH ONLY. */
export const QUERY_POLL_MS = 20000;
const QUERY = '$QUERY,*';
/** F264 ⚠ THE DEAD-GUN PROBE, and it is a CONSTANT on purpose. `$LIFE` with a NON-ZERO token 1 is the revive
 *  path: a dead gun APPLIES it and comes back to life (protocol row, `[apk2018]`: the 2018 app revived a downed
 *  player with `$LIFE,30,0,0,1,*`). So a probe that ever carries a non-zero token silently revives the player it
 *  was asking about. Never turn this into a helper that takes arguments: the first argument anyone passes will be
 *  a heal. `app/test/cure.test.mjs` asserts the node writes this byte-exactly.
 *
 *  ⚠ ...and it is the ALL-ZERO form, not the bare `$LIFE,*` the 2018 app polled with, even though the bench
 *  proved both answer a dead gun. The bare form's safety rests on ABSENT tokens defaulting to zero, and we have
 *  measured that only on a DEAD gun, while this heartbeat runs mostly on LIVE ones. One constant, explicitly
 *  zero, is worth 6 bytes a frame. */
export const PROBE_LIFE = '$LIFE,0,0,0,*';
/** F264 ⚠ A HAZARD WITH A NAME, AND THIS IS THE ONLY READING OF IT. `PROBE_LIFE` and every shield-regen grant are
 *  BOTH `$LIFE` frames, so the command WORD cannot tell a question from a pool change. On the wire they are still
 *  distinguishable, but only by VALUE: a `$LIFE` whose pool tokens are all zero or absent moves nothing, by
 *  definition, so it can never be a grant. Nothing makes a reader look, which is how five S29 tests went red the
 *  hour the probe shipped (2026-09-19): they counted `$LIFE` writes and counted probes as grants.
 *
 *  So every counter of `$LIFE` frames goes through this one predicate -- here, in the stage, in the tests, and in
 *  anything that reads a frame ring later. `engine.test.mjs` scans the source and fails on a `$LIFE` filter that
 *  does not. `protocol.is_pool_probe` is the Python twin.
 *
 *  ⚠ IT CANNOT BE FIXED ON THE WIRE. We never modify firmware, the command set is fixed, and `$LIFE` is the only
 *  command that answers with the POOLS and changes nothing: `$PING` answers `$PONG` with no pools, `$VERSION`
 *  carries none. So the ambiguity is permanent, and it reaches the diag tool and any future log scan, which no
 *  test of ours can guard. It wants a FOLLOWUPS hazard row, not only this comment.
 *
 *  ⚠ And it cuts the other way too: `$LIFE,<hp>,0,0,1,*` is a REVIVE (bench 2026-09-19). The same command word is
 *  the safest question we have and one of the most destructive writes we have, separated by one token. PURE. */
export function isPoolProbe(frame) {
  if (typeof frame !== 'string') return false;
  const f = frame.trim();
  if (!f.startsWith('$LIFE,')) return false;   // `$LIFE,*`, the 2018 app's bare poll, matches this prefix too
  const t = f.replace(/,?\*$/, '').split(',');
  return [1, 2, 3].every(i => t[i] === undefined || t[i] === '' || Number(t[i]) === 0);
}
/** F264: how long after a spawn/revive the read-back probe waits. The burst is 17 frames and the bench measured
 *  30-90 ms a frame, so ~1.5 s to land; 2500 ms leaves the echo room to come back before we ask again. */
const SPAWN_PROBE_MS = 2500;
const STUN_DEFAULT_S = 10;          // F15: how long an EMP (proto-8 $HIR under config.stun) disarms the gun when the config names no duration
/** F15 (Tony, 2026-09-18): the stun had no audible cue on the victim's own gun -- `_event('stunned')` is a
 *  no-op until a profile carries one, and the shooter-side row that carries fn 23 never reaches the victim.
 *  `X17` is Battle Company's concussion-grenade clip (catalogue: fx:explosion, 7.9 s, community label
 *  "concussion grenade"). Token 1 (interrupt), matching the protocol's rule for hit-path/urgent sounds
 *  (`brx-protocol.md` $PLAY row) -- the stun should cut off whatever was playing, the same as a hit. Sent
 *  once, in the SAME write as the disarm, never on an extend (F274: one write per hit, not per tick). */
const STUN_PLAY = '$PLAY,X17,4,6,,,,,*';
/** F13: a `$SPAWN` within ~2 s of death wedges the headset in its green out-blink (threshold 2.0-2.5 s; use >= 3). Same
 *  value as `gameconfig.MIN_RESPAWN_S` on the CLI path. */
const MIN_RESPAWN_S = 3;
const MEDAL_GAP_MS = 2000;       // A11.4: medal lines are 1.5-2.5 s; play them back to back, not on top of each other   // A11: no two LED bursts inside a second (three flashes per second is the ceiling)
const ECHO_WINDOW_MS = 1500;     // how long after the last head frame is written the node waits for the gun's echo
const HEAD_WRITE_CAP_MS = 20000; // a head write that has not settled by now acks `no_echo` anyway
const RELOAD_GRACE_MS = 600;     // a reload the gun never echoed still clears the takeover this long after reload_s
// F27 (HANDOFF): handle-pull -> mag-refill on HARDWARE runs consistently LONGER than the catalog
// `reload_ms` — AR 1701 vs 1400, burst 2160 vs 1700, charge 3220 vs 2500, i.e. ~1.22-1.29x. A flat
// 600 ms grace covers the first two and misses the charge rifle by 120 ms, which would end the takeover
// on the frame BEFORE the gun's own echo and book a real reload as failed. The ceiling is therefore
// proportional as well as flat, and `_reloadDeadline` takes the larger of the two.
const RELOAD_OVERRUN = 0.5;      // ...and half the nominal reload on top, which clears every measured overrun
/** pl4 (bench 2026-09-17, Energy Rifle): an energy weapon refills on a HOLD of the lever, the whole cell in one
 *  step, 3.5-3.9 s after the pull starts (catalogue 2400 ms: 2400 + max(600, 1200) = 3600 ms missed the slow
 *  end). An energy weapon's watchdog waits at least this long from the pull, plus RELOAD_GRACE_MS. */
export const ENERGY_REFILL_MAX_MS = 3900;
const isEnergyWeaponId = id => /energy|charge/i.test(String(id || ''));   // the same rule as hud.js `isEnergyWeapon`
// Bench 2026-09-17 (Tony): weapon heat ($ALCD token 5) rises while firing a heat weapon, and the gun will not
// fire once it reaches the lockout line. Below it, heat is build-up, not a fault; the HUD shows the level either
// way, but only calls it OVERHEAT at or past this line. pl4 (brx-weapons bench, same day): the line is 99, not
// "above 100". The Charge Rifle (about +8 a shot) stopped at about 103-108 and locked for ~4.8 s; the Energy
// Rifle (about +3 a shot) stopped firing AT 99, never above 100, and locked for 10-23 s. `heat >= 99` holds
// both; the old `> 100` never saw the Energy Rifle's lockout at all.
const HEAT_LOCKOUT = 99;
// ---- the three heat windows move together (maint review 2026-09-17) --------------------------------
// OVERHEAT_SHOWN_MS < HEAT_STALE_MS < OVERHEAT_CAP_MS, and engine.test.mjs asserts that order.
//   OVERHEAT_SHOWN_MS  the DISPLAY window: how long the HUD keeps the word and the bar hot after the last
//                      evidence of the lockout (`_overheatOnHud`).
//   HEAT_STALE_MS      the MECHANIC's window: how long a heat reading is still trusted to mean "this gun
//                      cannot fire" (`_heatBlocksFire`), which exempts a dry pull from `no_fire`.
//   OVERHEAT_CAP_MS    the hard ceiling on the display window, so the word can never sit for a whole life.
// The display must clear BEFORE the mechanic's trust lapses (the lockout itself ends long before a player
// stops trying), and the cap must sit above both or it would cut the other two short.
// ----------------------------------------------------------------------------------------------------
// pl4: the longest OVERHEAT can stay up after the lockout's first reading, whatever else is seen. Above the
// longest measured lockout (Energy Rifle, 23 s) with margin, so the word can never stick for a whole life.
export const OVERHEAT_CAP_MS = 30000;
// Review 2026-09-17: a locked-out weapon sends NO $ALCD while it cools (bench match 592e444eff: "10 pulls,
// no $ALCD"), so a heat reading above HEAT_LOCKOUT can sit unrefreshed forever once the player stops
// pulling the trigger -- OVERHEAT would stick and `no_fire` would never take over from it. The bench-measured
// lockout hold is ~4.8 s and heat decays ~30/unit-per-s once it starts cooling, so the mechanic itself clears
// in a few seconds -- but the field capture pinned in pool-stale.test.mjs (the 02dd94 log) shows a player
// dry-firing a LOCKED weapon for ten pulls (~2 s cadence, ~20 s) before giving up, and the exemption must
// hold for every one of those pulls or the old false-positive "gun not firing" report comes straight back.
// HEAT_STALE_MS sits above that real window with margin, so a genuine lockout (or a player still trying it)
// is never cleared early, and only a reading old enough to be certainly abandoned counts as untrustworthy.
export const HEAT_STALE_MS = 25000;
// pl3 (2026-09-17): HEAT_STALE_MS above is for `no_fire` only. It must outlast a player who dry-fires a locked
// weapon for ~20 s. The HUD's OVERHEAT word must not: the lockout itself ends long before that. The reading that
// tips a weapon over the line arrives with the shot that caused it. The bench-measured lockout holds ~4.8 s,
// and at ~30/s of decay a reading near 106 falls back under the line in well under a second after that. So a
// lockout is over about 5 s after its last reading, and 6 s keeps the word up for the whole lockout with ~1 s of margin.
// pl4: the window runs from the last EVIDENCE of the lockout, not only the last reading: a reading at or past the
// line, or a trigger press that got no shot (the Energy Rifle locks for up to 23 s and sends no $ALCD while it
// does). A shot or a reading below the line ends it at once; OVERHEAT_CAP_MS bounds it.
export const OVERHEAT_SHOWN_MS = 6000;
// Bench 2026-09-17 (Tony): the shot-ready cue. `$WEAP` token 14 is the time between rounds (ms per round,
// calibrated 2026-09-10); for a charge weapon it is the hold time. At or above this line the HUD dims the ammo
// gauge after each shot and shines it once when the next round is due. Automatic weapons sit under it and get neither.
const SHOT_CUE_MIN_MS = 400;
// S42 (bench 2026-09-17): a $WEAP re-push resets mag/reserve/live-accuracy, and 5 writes 200 ms apart kept the
// gun armed and firing — 250 ms is comfortably inside "stays armed" with headroom for BLE jitter.
// ⚠ F259 step 2: it throttles only a write that RE-SENDS a value the gun has already been told (a retry, or a
// re-assertion after an accuracy hold). It was the only thing standing between the old per-shot ladder and a
// $WEAP flood; the state machine is now what bounds the write rate, to three a burst, so a write carrying a
// NEW value goes out at once. That matters: a deferred write is a CLOCK-driven write, composed in an
// inter-round gap and landing after the next round has left, and its `$AMMO` then hands that round back. The
// assault rifle's two rungs are three rounds apart, which is inside this gap on any weapon firing faster than
// about 80 ms a round, so deferring them would have put a lost round into every fast burst.
export const ACC_WRITE_MIN_GAP_MS = 250;
// ---- the accuracy writer's two windows move together (maint review 2026-09-17) ---------------------
// ACC_HOLD_MS > ACC_VERIFY_GRACE_MS, and engine.test.mjs asserts that order. A hold shorter than the
// verify grace would let the writer judge (and retry) a write while the OTHER write's `$AMMO` is still
// in flight, which is the exact race the hold exists to stop. The reasoning is on ACC_HOLD_MS below.
// ----------------------------------------------------------------------------------------------------
// How long to wait for the $ALCD that answers an accuracy write before judging it. Bench measured the write
// landing in 30-90 ms; this leaves plenty of headroom for a slower link without stalling the model for long.
export const ACC_VERIFY_GRACE_MS = 450;
// The heat at which the gun stops firing, from `$ALCD` token 5. Bench 2026-09-17: a full-auto Energy
// Rifle locked out at 99, the heat did NOT fall on its own, and only the reload lever vented it (about
// 35 a pull). The accuracy writer must not write into that window, so the guard reads this.
// t21 (accuracy ceiling) / t22 (accuracy floor), doc-token convention (frame.split(',')[tokN + 1]).
const ACC_CEILING_IDX = 22, ACC_FLOOR_IDX = 23;
// F68: an accuracy-model miss sends no $HIR and no $HP at all (S42 bench 2026-09-17), so the existing
// hit-driven headset repaint (`_onHp`, `dmg > 0`) never runs — but the gun's own near-miss flash still
// darkens the headset. A plain interval is the only fix that survives an event the wire never reports.
// 5 s is far above any hit-driven repaint rate, so this adds at most one $HLED write per interval, never
// a stream — cheap, on purpose, because BLE traffic during a match is precious.
export const TEAM_REPAINT_MS = 5000;
// S42 × A44/A47/F15 (merge 2026-09-17): the accuracy writer is the ONLY thing that re-pushes `$WEAP` during a
// life, and every write it makes carries an `$AMMO` restore of the live counts. A spawn, a revive, an operator
// RESYNC GUN and a stun disarm/restore all write `$AMMO` too, so the two must never be in flight together: a
// `$WEAP` + `$AMMO` landing beside a stun disarm would re-arm a disarmed gun, and one landing beside a spawn
// would put the PREVIOUS life's counts back. Each of those writes stands the accuracy writer down for this
// long, measured from the write. Comfortably above ACC_VERIFY_GRACE_MS (450 ms) and the slowest measured
// `$BMAP,0,0` after a `$SPAWN` (about 300 ms), so the gun has answered one before the other is considered.
export const ACC_HOLD_MS = 800;
// F259 (bench 2026-09-18): the quiet the trigger must hold before a degraded weapon is crisp again. The
// catalogue's `settle_ms` (once it carries one) only ever raises this floor. It exists because the old
// `recover_ms` was 120-150 ms — a per-STEP recovery interval, not a release detector — and a full-auto
// weapon's own gap between rounds is around 100 ms, so reading 150 ms of quiet as "the player stopped"
// makes the writer flap twice a burst for nothing. Above ACC_VERIFY_GRACE_MS too, so the recovery write
// is never racing the degrade write's own verify.
export const RECOIL_SETTLE_MIN_MS = 600;
// F259 step 2 (Tony, bench 2026-09-18): "maybe we can update it to do 2 steps instead of 1? normal
// degraded and very degraded." The rungs are the OLD GRADUAL LADDER'S OWN ENDS: `crisp` is the ceiling it
// started from and `heavy` is the floor it walked down to, with `degraded` halfway between. So the second
// step costs no weapon its identity -- the assault rifle still bottoms out at 70 exactly as it always
// did, it just arrives there in two visible stages instead of twenty invisible ones.
//
// `after_heavy` is twice `after_shots`: "you are holding the trigger", then "you are still holding it".
// ⚠ THE DOUBLING HAS NO EVIDENCE BEHIND IT. It is a reading of what the two stages mean, not a
// measurement, and it wants a bench pass.
export const RECOIL_HEAVY_BURST_FACTOR = 2;
// F259 (bench 2026-09-18): how long the node owns a slot's magazine after it writes one, when the gun has
// not yet echoed the number back. A `$WEAP` + `$AMMO` pair makes the gun send `$ALCD <clip>` then
// `$ALCD <n>`, and that second frame is a decrement of `clip - n` that is NOT fire. The window normally
// closes on the gun reporting `n` (one round trip: the bench measured a write landing in 30-90 ms), so this
// is only the backstop for a write the gun never answers.
//
// Polish review 2026-09-18: it was 400 ms, and BELOW ACC_VERIFY_GRACE_MS on the reasoning that the window
// must not outlive the verify judging the same write. That coupling was wrong -- the verify judges the two
// ACCURACY tokens, this window judges the MAGAZINE, and they are different facts about one write -- and the
// deadline reinstated the whole 2026-09-18 oscillation on any link slower than itself: the `$WEAP` reset
// frame then arrives after the window has lapsed, lands on the ordinary path as a magazine RISE (the HUD
// jumps to the clip, the reload takeover is fed), and the restore behind it books the synthetic drop as a
// burst. The window now closes on the VALUE -- `_acctAmmo` shuts it the moment the gun reports the number
// the node wrote -- so on a working link it lasts one round trip and this number is never reached. It is
// only the horizon past which the node stops waiting for a write the gun never answers.
//
// ⚠ It is a DIAL, and the only number here with no measurement behind it. What it trades: while the window
// is open the node shows its own account instead of the gun, and a round that leaves inside it is not
// booked into `shots`, because its `$ALCD` still reads above what we wrote and cannot be told from the
// reset (F266). 700 ms covers a link seven times slower than anything the bench has seen (30-90 ms) and
// costs about seven rounds of a 100 ms weapon in the worst case.
//
// 700 rather than 1200: a gun can stop talking ENTIRELY. One went silent for 100 s mid-match with its ammo
// frozen at 32 while the node went on reporting the last pools it had heard, so "the gun never answers" is
// neither hypothetical nor rare. When the node is blind it should admit it sooner, and every millisecond of
// horizon is a millisecond the HUD shows an account instead of the gun. Sitting just under
// TRIGGER_NO_FIRE_MS would have been a coincidence, not a reason.
export const ACC_ECHO_MS = 700;
// $BUT ids (protocol §$BUT — `$BUT,<id>,<state>`; state 1 press / 0 release).
const BTN_TRIGGER = 0, BTN_ALT = 1, BTN_RELOAD = 2;
const TEAM_KEY = { 0: 'red', 1: 'blue', 2: 'yellow', 3: 'green' };
// A16.5 (2026-09-09): outermost -> innermost, the order BRX depletes -- shield goes, then armour, then
// health. Mirrors `poolgauge.py`'s `READOUT_POOL_INWARD`; kept as its own constant here too rather than
// shipped through the bundle, so the phone and the bench stage can never silently disagree on it.
const READOUT_POOL_INWARD = ['shield', 'armor', 'health'];

// ---------- King of the Hill audio (F70/F72/F74/F85, docs/utility-roadmap.md "Where the hill audio has to live")
// The gun CANNOT speak for itself on a beacon: `$SIR` is keyed on <irProtocol, subtype> alone, every hill
// beacon decodes as the same cell <15,0>, and fn 28 ignores the row's <soundID> outright (measured
// 2026-09-10, rung Y). So all four hill states are the NODE's job, played over BLE from here.
const HILL_MAG = 8;                 // $HIR magnitude 8 = a control point / hill (6 = respawn station — never a hill)
const HILL_CAPTURE_MAG = 50;        // the capture word, carrying the NEW owner in the team field; lands ~50 ms after the shot
const HILL_WAS_NEUTRAL_MAG = 53;    // "the state being LEFT was neutral" — arrives ~5 s LATER, and only when it was neutral (n=2)
const HILL_NEUTRAL_TEAM = 2;        // a NEUTRAL point broadcasts team 2 (bench 2026-09-10; F82: a hill roster must not use tid 2)
const HILL_TICK_MS = 1000;          // the possession tick's cadence — the node's own clock, never the beacon's
// Presence expires on >= 2 MISSED beacons, not one: the beacon is clean at desk range (20+ consecutive at a
// flat 5.0 s) but goes intermittent at the edge of range (rung R), so a single miss is normal reception, not
// "left the hill". Only a magnitude-8 hill beacon refreshes this — F84: a respawn station's ~2.5 s period
// would otherwise keep a 12 s window permanently fresh and a hill nobody holds would tick forever.
const HILL_PRESENCE_MS = 12000;
// K1: the same hill state, sourced from a phone CONTROL POINT's BLE advert instead of a grenade's IR word
// (utility.md §5d). ⚠ A control point's freshness is the §3 PRESENCE rule (`Presence.expiryMs` 4 s), NOT the
// grenade's 12 s / two-missed-beacons rule (§5d.5): that 12 s exists only because a grenade beacons once per
// ~5 s, and a BLE station advertises continuously. So 4 s covers both halves — an advert older than this
// stops refreshing the point, and `_hillTick` expires a station-sourced point on the same window.
// (`Presence` itself keeps an entry for up to 8 s after the last advert, so without this a point nobody was
// hearing would go on owning the field.)
const CONTROL_STALE_MS = 4000;
// §5d.5: "a floor between repeats of the same line (proposed 10 s for contested, which can otherwise
// oscillate at net 0)". Unlike the IR path (F75) this is a MEASURED state, so it may play at all -- but a
// station at 2 v 2 crosses the line repeatedly and the clip is 2.078 s.
const HILL_CONTESTED_MIN_MS = 10000;
// The same rule for the transition lines, which had no floor at all. Two control-point phones left on the
// DEFAULT station id 1 are ONE presence entry (`beacon.js` keys `station:<id>`), so their fields alternate
// per scan callback and the decoded owner flips several times a second -- each callout preempting the last.
// The id latch in `_controlStation` fixes the distinct-id case; nothing on the reader side can separate two
// phones that claim the same id, so the floor is what bounds the damage to one line per 3 s.
const HILL_CALLOUT_MIN_MS = 3000;
// D: while OUR point is draining, the possession tick doubles. That is the "you are losing this, get help"
// signal, delivered by audio rather than by a screen the defender is not looking at -- and it is the only
// audible warning before "Hill Lost!", which arrives when it is already too late to matter.
const HILL_TICK_LOSING_MS = 500;
// A duration must never be measured across a clock STEP: `now()` is `Date.now()` plus an MC offset that
// updates as the sync converges, so one delta can jump. Clamp each accrual to a tick's worth of time.
const HOLD_STEP_MAX_MS = 1000;
// How often a growing tally goes to MC. `hold_ms` is cumulative and every report is idempotent
// (`mc/API.md` "Objective scoring"), so this is purely a wire-traffic choice; the tally at the whistle is
// sent unconditionally, because that is the report that decides the match.
const POSSESSION_REPORT_MS = 10000;
// Ids are the operator's picks, every one CONFIRMED BY EAR on hardware 2026-09-10 (rung S) — one female
// objectives announcer with a music bed, chosen over the male "Control Point" set (VA23/VA22/VA21, also
// confirmed). `ms` is the clip's real length from `mcp/brx_mcp/data/sound_catalog.json`, which is what the
// scheduler below uses to keep the 0.11 s tick out from under a 1.9-3.0 s callout; a bundle may override a
// duration through `frames.cue_ms`. Picked BY ID and never by category: `V8Q` is catalogued "Hill Confirmed"
// and actually says "KILL Confirmed" (rung S), so a by-category pick would announce a kill line on a capture.
export const HILL_CUES = {
  hill_captured:  { frame: '$PLAY,,4,6,VB0N,,,,*', ms: 1924 },   // VB0N "Hill Captured"  1.924 s
  hill_lost:      { frame: '$PLAY,,4,6,VB0P,,,,*', ms: 2976 },   // VB0P "Hill Lost!"     2.976 s
  hill_contested: { frame: '$PLAY,,4,6,VB0O,,,,*', ms: 2078 },   // VB0O "Hill Contested" 2.078 s — NOT WIRED, see `_hillCallout` (F75)
  hill_moved:     { frame: '$PLAY,,4,6,VB0Q,,,,*', ms: 2424 },   // VB0Q "Hill Moved"     2.424 s — rotating-hill modes only (F83), no caller yet
  hill_tick:      { frame: '$PLAY,U100,4,6,,,,,*', ms: 114 },    // U100 possession tick  0.114 s
};
// A hill beacon carries NO point identifier, so several points in play are indistinguishable on the wire:
// in Domination two grenades held by different teams would read as one point changing hands every few
// seconds and announce continuously. Excluded until K1 supplies a discriminator, rather than shipped noisy.
const HILL_AUDIO_EXCLUDED_MODES = new Set(['domination']);

/** A16.5: which pool the readout should actually SHOW, given that `pool` is the one that just moved and
 *  settled at level 0. Mirrors `poolgauge.handover_pool` exactly -- see its docstring for the full
 *  reasoning: a shot that took armour 35 -> 0 while health sat untouched at 45/45 left the gun body dark
 *  for the whole hold, which read as "nothing left" at the exact moment the player was at full health.
 *  Pure: takes the current pool values and which pools the bundle actually configured a readout for, and
 *  returns `pool` unchanged when nothing inward has anything left (in particular: health emptying hands
 *  over to nothing, because that is death, and death is deliberately hands-off, A16). */
export function handoverPool(pool, values, configured) {
  const vals = {}; for (const k of READOUT_POOL_INWARD) vals[k] = values[k] || 0;
  if (vals[pool] > 0) return pool;
  const start = READOUT_POOL_INWARD.indexOf(pool);
  if (start < 0) return pool;
  const allowed = configured ? new Set(configured) : null;
  for (let i = start + 1; i < READOUT_POOL_INWARD.length; i++) {
    const inner = READOUT_POOL_INWARD[i];
    if (vals[inner] > 0 && (!allowed || allowed.has(inner))) return inner;
  }
  return pool;
}

export function toks(f) {
  let s = String(f).trim();
  if (s[0] === '$') s = s.slice(1);
  if (s.endsWith('*')) s = s.slice(0, -1);
  if (s.endsWith(',')) s = s.slice(0, -1);
  return s.split(',');
}

/** Persisted context keys (localStorage-like `storage`). */
const KEY = 'brx.engine';
/** The HUD skin lives outside `KEY`: it is the phone's, not the match's, so no TTL expires it. `brx.night` is '1'/'0'
 *  (the key the app used before); `brx.night_choice` is `{session}`, the MC session a player's own tap belongs to. */
const NIGHT_KEY = 'brx.night', NIGHT_CHOICE_KEY = 'brx.night_choice';

/** Maint review 2026-09-17: "the writer stands down" was re-typed at seven call sites and no two agreed --
 *  `_recoilFlush` alone read `_accHoldUntil`, `_awaitShot` alone read `tutorial`, `_noFireTick` dropped
 *  `resync`/`reconciling`, and two `_writeMust` `still` lambdas spelled a third variant inline. Each site
 *  WANTS a different subset, so the sets stay different on purpose; only the PREDICATES live here now.
 *
 *  Ordered, and the order is the precedence `_standDown` reports: `_operatorAct` turns the first blocking
 *  name into the refusal the operator reads, so this order is that message's order. Everywhere else the
 *  answer is a boolean and the order does not matter.
 *
 *  Each test is `(engine, now) => true when this blocks`. `now` is passed so a caller inside `tick` can
 *  hand over the tick's own clock reading rather than taking a second, fractionally later one.
 *  ⚠ Mirrored in `mcp/brx_mcp/stage/stage.py` (`_STAND_DOWN`), which carries the subset the bench has. */
const STAND_DOWN = [
  ['phase',       e => e.phase !== 'live'],
  ['spawned',     e => !e.spawned],
  ['bundle',      e => !e.frames],
  ['ble',         e => !e.bleUp],
  ['alive',       e => !e.alive],
  ['reconciling', e => !!e.reconciling],
  ['resync',      e => !!e.resync],
  ['tutorial',    e => !!e.tutorial],
  ['switching',   e => !!e.switching],
  ['reloading',   e => !!e.reloading],
  ['stunned',     e => !!e.stunned],
  ['heat',        (e, now) => e._heatBlocksFire(now)],
  ['accHold',     (e, now) => now < e._accHoldUntil],
  // 2026-09-19: a timed respawn holds the trigger (`$BMAP,0,98`) for the weapon delay. A pull then fires nothing
  // by design, so it must not count towards F208's "the gun does not fire".
  ['weaponHold',  e => !!e._triggerPending],
  // F259 (bench 2026-09-18): a round the trigger has asked for that the gun has not reported yet. A write
  // does not land instantly -- the bench measured 30-90 ms -- so one sent NOW would reach the gun after that
  // round had left, and its `$AMMO` would put the round back. The degrade write is never blocked by this: it
  // fires from the `$ALCD` that just answered the press, when nothing is outstanding. What it does block is
  // the CLOCK-driven writes (a verify retry, a hold release), which have no reason to pick that instant.
  ['shotInFlight', (e, now) => e._acctOutstanding(e.activeSlot, now)],
];
/** ⚠ F264: THIS TABLE GATES ACTING, NOT READING. `reconciling` and `resync` are in it because the node must not
 *  INFER inside those windows (spec/node.md §3.10). A `$QUERY,*` / `$LIFE,0,0,0,*` probe is the opposite of an
 *  inference, so the probe sites (`_askGun`) deliberately run inside them and only the writes that follow stand
 *  down. Do not "fix" a probe that fires during a reconcile: reading is how §3.10's rule stops costing us a life.
 *
 *  The names `_standDown` answers to. engine.test.mjs reads every `_standDown([...])` call site out of this
 *  file and asserts each name is in here, so a typo cannot silently drop a guard. */
export const STAND_DOWN_NAMES = STAND_DOWN.map(([name]) => name);
/** A47: the refusal each `_operatorAct` stand-down name puts in front of the operator. `_operatorAct` names
 *  its own subset, so only those seven need a line here; `operatorRefusal()` below covers the rest rather
 *  than throwing at an operator mid-match if that subset ever grows. */
const OPERATOR_REFUSAL = {
  phase: e => `phase is ${e.phase}`,
  spawned: () => 'the T-0 spawn has not run',
  bundle: () => 'no bundle',
  ble: () => 'gun link down (RELINK first)',
  reconciling: () => 'a relink reconcile is running',
  resync: () => 'a restart resync is running',
  tutorial: () => 'a try-out is running',
};
/** The refusal line for a stand-down name, or the bare name when nothing has written one yet. A missing
 *  line is a message worth improving, never a reason to throw: `_standDown` is deliberately forgiving and
 *  this must be too (polish 2026-09-17). `app/test/operator.test.mjs` asserts every name resolves. */
export const operatorRefusalFor = (name, engine) => (OPERATOR_REFUSAL[name] || (() => name))(engine);

export class Engine {
  /**
   * @param {object} o
   * @param {(frames:string[]) => (void|Promise<void>)} o.writer   write frames verbatim to the gun
   * @param {(fact:object) => void} [o.emit]                        persisted fact sink (Transport.send)
   * @param {(kind:string, body:object) => void} [o.report]         non-fact uplink (Transport.report)
   * @param {() => number} [o.now]                                  synced clock (Transport.syncedNow)
   * @param {() => boolean} [o.synced]
   * @param {object} [o.storage]                                    localStorage-like
   * @param {(line:string, cls?:string) => void} [o.log]
   */
  constructor({ writer, emit = () => {}, report = () => {}, now = () => Date.now(), synced = () => false,
                storage = null, log = () => {}, onChange = () => {}, delay = (ms, fn) => setTimeout(fn, ms), rng = Math.random } = {}) {
    this.writer = writer; this.emitFact = emit; this.report = report; this.now = now; this.isSynced = synced;
    this.storage = storage; this.log = log; this.onChange = onChange; this.delay = delay; this.rng = rng;   // rng: the A15 cue-pool pick (tests seed it)
    this.reset();
    this._load();
    this._loadNight();
  }

  reset() {
    this.phase = 'idle';            // idle|connected|kitted|lobby|armed|live
    this.gun = null;                // {name, tail, fw?}
    this.bleUp = false; this.wsState = 'offline';
    this.gunFlapping = null;        // bench 2026-09-17: {count, next_retry_at} while the gun keeps dropping the link (BrxLink.flapping)
    this.player = null; this.team = null; this.roster = []; this.config = null; this.frames = null;
    this.start = null;              // {match_id, go_live_t, seq, countdown_s}
    this.matchId = null;
    this.hp = 0; this.armor = 0; this.shield = 0; this.ammo = 0; this.reserve = null; this.mag = null;
    // R2-3 (A37): WHERE the pool above came from, reported on every heartbeat. `_spawn`/`_revive`
    // fill hp/armor from `config.health` -- this phone's MODEL of the pool -- and the GUN's own
    // numbers arrive afterwards on `$LCD`/`$HP`. MC compares the heartbeat against the `$PSET` it
    // pushed, which bakes `loadout.overrides.max_hp/max_armor` and the body_armor perk, so the two
    // legitimately disagree until the gun has spoken: a player overridden DOWN to 30 hp under a 45 hp
    // config reported 45 and MC read it as a gun running an older head. Per LIFE, not per match.
    this.poolSrc = 'model';
    this.alive = false; this.deaths = 0; this.shots = 0; this.battery = null; this.fw = null;
    this.carrying = null;   // A11.6: flag team whose colour the headset is blinking while this player carries it (kept for back-compat reads; the source of truth is `_activeRole` once `headset.role` exists)
    this._activeRole = null;        // A16 §3.3: {name, tid} — the ONE headset role currently held (carrier|infected|vip|beacon|extracted), re-asserted after every hit, cleared on death
    this._lastHeadsetFlashAt = null; // led-language.md §2 (safety: bursts ≥ 1 s apart) / §5: node-initiated headset FLASH sequences (hit flash, role re-assert) share the gun burst's 1 s minimum — never the down rearm or the low-health alert
    this.latch = null;              // {shooter_num, shooter_team, at, ir_proto}
    this._spawnAt = null;            // B5: this.now() of the last _spawn/_revive WRITE — the settle window below is measured from here
    this._armPending = null;         // F209: {at, flip, until, shotEnds, off, shield} from a spawn/revive write until `_armLife` ends spawn protection
    this._triggerPending = null;     // 2026-09-19: {at, due} while a timed spawn/revive holds the trigger (`$BMAP,0,98`)
    this._downWarn = 1;              // 2026-09-19: the down-screen warning level, 1..DOWN_WARN_MAX; reset at match start
    this._timedLifeAt = null;        // 2026-09-19: now() of the last timed respawn, for the spawn-kill window
    this._shieldAt = 0;              // 2026-09-19: the last shield re-assert after a hit
    // F121 rebuild: is the `$SIR` table on the gun the LIVE one? False until a `sir_pool` take lands; any write that
    // carries a `$SIR` row or `$CLEAR` (a head, above all) makes it false again, and bumps `_sirGen` so a take whose
    // write was overtaken by such a write never claims the table. Not persisted: an app restart re-sends the take.
    this._sirLive = false; this._sirGen = 0;
    this._armedThisLife = false;     // B5: true once the gun has reported hp>0 on the wire since that write — clears the settle gate early
    this.beacon = null;             // F72: {owner_team, magnitude, sensor, at} — last grenade/station beacon (proto-15 $HIR)
    this._lastBeaconKey = null;     // F85: `${owner_team}:${magnitude}` of the last beacon ACCEPTED (not merely seen), for dedupe below
    this._lastBeaconAt = 0;         // F85: this.now() of that acceptance
    this.hill = null;               // {owner, at, from_neutral} — the control point's OWNER and when its last beacon landed. State from the wire; the cadence below is ours
    this._hillBusyUntil = 0;        // the announcer is occupied by a hill callout until this (now + the clip's real length) — the tick waits, it never overlaps
    this._hillTickAt = 0;           // when the possession tick last played (0 = not ticking)
    this._hillTeam2Warned = false;  // F82 is logged once per game, not once per beacon
    this._hillContestedAt = 0;      // K1: when "Hill Contested" last played, so a flapping bit cannot repeat it
    this._hillWasContested = false; // the contested bit we last read off a control point's advert (edge-triggered)
    this._controlSig = '';          // the control-point advert fields that are worth a re-render
    this._controlSite = null;       // the point we are latched to, so walking between two does not read as a capture
    this._hillSaidAt = 0;           // when a captured/lost line last played, for HILL_CALLOUT_MIN_MS
    this._hillOwnerWhenSilenced = undefined;  // C: the owner as we last heard it while audio was ON (undefined = never)
    this._hillSourceWarned = '';    // B: the refused objective source, logged once per game
    this.hold = {};                 // possession: site -> {tid -> cumulative ms} owned, as THIS node observed it
    this.observed = {};             // site -> cumulative ms this node could hear the point at all (the honest lower bound)
    this._holdAt = 0;               // when the accrual last ran
    this._possessionSentAt = 0; this._possessionSig = '';
    this.deadAt = 0; this.killedBy = null; this.lastHitAt = 0;
    this._deathBlinkAt = 0;         // when the headset out-blink was last (re)painted, so a long DOWN doesn't outlast the count
    this._downRearmSent = false;    // §3.2: `down.rearm` sent for THIS death — one write per death, reset on death and revive
    // A16 §3.1/§5: the transient gun-body pool readout (frames.gun.readout). `_readoutFrame` is whatever
    // frame is PHYSICALLY on the strip right now because of this system (a band, or `gun.rest` once the
    // hold has expired) — null before the gun has been taken. `_readoutHoldActive` + the pair below drive
    // a tick()-polled expiry (the same pattern as `_downRearm`/`_reassertDeathBlink`), never `this.delay`,
    // because a hold must be repeatedly RESTARTABLE by later pool changes, not a one-shot timer.
    this._readoutFrame = null;
    this._readoutHoldActive = false;
    this._readoutHoldStartAt = 0;
    this._readoutHoldMs = 0;
    this._readoutLastWriteAt = null; // last time a readout band was actually WRITTEN (for the 300 ms coalesce window)
    this._readoutLastPool = null;    // which pool most recently moved this life (what a reload glances)
    // A16.3 (bar-spec 2026-09-07): the seven-level pool bar + drop/gain animation, active only for a
    // `gun.readout.pools[]` entry that carries `levels` (a `bands` entry is untouched, see `_gunReadoutPaint`).
    this._roLevel = null;   // level (0-6) CURRENTLY on the strip; null = nothing painted yet this life (no "from" to animate out of)
    this._roPool = null;    // which pool's `levels` table `_roLevel` belongs to
    this._roGen = 0;        // bumped on every new/cancelled animation (death/revive/a later change) -- same pattern as `_hsGen`;
                             // teardown (end/panic/BLE drop) is still `_lightGen`, checked alongside it, not a second teardown flag
    this._roAnimating = false; // true while the drop/gain animation owns the strip -- suppresses `_gunReadoutTick`'s hold-expiry
                                // revert until `_readoutSettle` arms the real hold (an in-flight animation must not be cut off mid-step)
    this._roBlinkAt = 0;       // A16.3: last time the partial-level top-segment blink toggled (0 = not blinking); tick()-polled,
                                // same reasoning as the hold itself -- a self-rescheduling `this.delay` chain cannot be restarted
    this._roBlinkOn = false;   // which half of the blink pair (`levels[l][1]` vs `[0]`) is currently on the strip
    this._lightGen = 0;             // bumped on teardown (end/panic/BLE drop) so a stray delayed $GLED/$HLED/cue write can't land after it
    this.score = null;              // ScoreRow from MC (kills/assists/accuracy) — null until synced
    this.scoreAt = 0;
    // F265 fix (polish review #2, 2026-09-18): LOCAL phone clock time of the last message received
    // from MC over the bound socket -- any kind, `time_res` included, which arrives every
    // `syncIntervalMs` (5 s) whether or not a score changed. `scoreAt` only moves on a NEW score push,
    // and MC pushes a score only on change, so a quiet 5 s of no kills used to flip a perfectly live
    // board to STALE. This is `Date.now()`, not the synced clock `this.now()` returns, because
    // `hud.js _boardStale` compares it against its own `Date.now()` -- see that file for the reason.
    this.lastMcMsgAt = 0;
    // A24: the MATCH RESULT, computed per recipient by MC and pushed to every node, losers included. Null until it
    // arrives. NOTHING on the node may write win or lose from the ABSENCE of this — a `victory` cue that never came
    // means "lost" and "out of coverage" identically (game test 2026-09-11 D3).
    this.result = null;             // the `result` body for THIS match (contracts §5 `result`)
    this.resultAt = 0;
    this.headEcho = null; this.headWrittenAt = 0; this.awaitingEcho = false; this.headWriteDone = false;
    // A36: the SLOT-0 $ALCD the gun answers a head write with. `headEcho` is whatever frame came
    // back FIRST, and on a real tagger that is always $START's `$LCD,0,0,0,0,0,0,*` (protocol §3) --
    // proof the gun answered, and no evidence at all about which weapon it was just written. The
    // $ALCD echoes arrive right behind it carrying the magazine, which is what lets MC prove the
    // head LANDED rather than merely that something came back (field 2026-09-12: guns ran a
    // previous push in nearly every match and every signal MC had said `ok`).
    // A37/F-3: ...but `$ALCD` only streams on AMMO EVENTS (protocol), so a frame inside the echo
    // window may equally be a round the player fired. `butSinceHead` closes the window on the gun's
    // first `$BUT`, and MC then gets NO weapon claim rather than a magazine one round short.
    this.ammoEcho = null; this.butSinceHead = false;
    this._gunTid = null;         // F206: the last $TID this node wrote (head, try-out or infection flip); `_write` restores it after any $PSET
    this._headTid = null;        // B1 guard: the $TID the gun's written head actually holds (its COMBAT team), parsed from the last head write — null until a head is written, so an unknown head never raises a false divergence
    this.spawned = false; this.ended = false;
    this.cuesFired = new Set();
    this.tutorial = false; this.tutorialWeapon = null;
    this.tryoutArming = null;       // F147: {at, clip, gunSlot, baseline, tab, kind} between a try-out weapon write and the gun's own confirming $ALCD/$LCD
    this.tryoutUnconfirmed = null;  // polish-loop pass 3: {tab, kind} | null — the LAST try-out arm timed out with no confirming report (honest, distinct from a real ✓; identified so a later pick on a DIFFERENT row/kind never inherits it)
    // A10 — self-serve kitting (docs/spec/loadout.md §4)
    this.catalog = null;            // {weapons: WeaponView[], perks: PerkView[]} — arrives in `assign`
    this.policy = null;             // {hud_select, primary:{choice, allowed_ids}, secondary:{choice, kinds, allowed_weapon_ids}, perk:{choice, allowed_perk_ids}} (A14)
    this.browsing = false;          // the HUD's LOADOUT browser is open (reported to MC as loadout_browse)
    this.game = null;               // A10 §4.6: assign.game — what the BRIEFING screen shows
    this.briefSeen = false;         // the player tapped BUILD MY KIT ▸ on the briefing (reset when kit_open flips true)
    this.loadoutAck = null;         // MC's verdict on the last pick: {slot, ok, reason, t} — tick() clears it after ~4 s
    this.pendingPick = null;        // optimistic highlight until the ack lands: {slot, kind, id, at} — the row's ⟳
    this._pickDue = null;           // A26: a weapon pick waiting out PICK_DEBOUNCE_MS before it goes to MC: {slot, kind, id, at, try}
    this.kitLocked = false;         // A27/A30: the host advanced the phase while this player was still kitting — the lobby screen says so (loadout.md §4.4)
    // T2-B item 2 (2026-09-13): STANDBY (M-STANDBY §3): MC benched this player (`assign.standby: true`).
    // Forced back to KITTED-shaped, no frames written, no kit browsing -- "SITTING OUT" until PLAY sends
    // an ordinary `assign` (standby absent/false) and clears it.
    this.standby = false;
    this.tryoutSeen = null;         // weapon_id of a try-out panel the player dismissed with DONE (panel hides, gun stays armed)
    this.resync = null;             // §3.10 state machine: {step, since, lastAmmo, lastReserve}
    this.reconciling = null;        // {since} — a rejoin's disarmed reconcile window (S7.1); no death is inferred here
    this.rewriteHeadAtT10 = false;  // start-sequence §3 fallback (bench-gated)
    this._headRewritten = false;
    this.moment = null;             // transient HUD moment: {kind, at, data}
    this.probeSent = false;
    this.night = false;             // the HUD skin on screen (true = night). The player's, not the venue's: see setNight
    this.nightChoice = null;        // {session}: the player chose a skin in that MC session, so NIGHT OPS does not switch it
    this.sessionOf = () => null;    // the current MC session id (app.js wires the transport's)
    this.persistedSessionOf = () => null;   // pl3: the last MC session id the transport stored (survives an app restart)
    this.lastVoltsAt = 0;
    // B4 (2026-09-12 field session): the native BLE disconnect callback is the ONLY thing `bleUp` ever
    // relied on — a link that goes silent without the OS ever noticing (marginal RF, a supervision
    // timeout that hasn't fired, or the gun's own "app mode" tap closing) left `bleUp:true` for the rest
    // of the match while the gun sent nothing: no $HIR, no $BUT, no $VOLTS. `lastGunFrameAt` is stamped
    // on every frame off the gun (feedFrame) and reset at each (re)link; `tick()`'s watchdog below
    // forces a reconnect once nothing at all has been heard for LINK_STALE_MS, which is comfortably
    // above the ~30 s $VOLTS cadence (protocol §"idle taggers are silent" — outside app mode nothing
    // unsolicited is sent, but $VOLTS streams every ~30 s once it is opened).
    this.lastGunFrameAt = 0;
    // Per-instance so the bench harness / a future remote flag can turn it on without editing the
    // module, and so the B4 tests exercise the mechanism while the field ships with it off (F163).
    this.linkWatchdog = LINK_WATCHDOG_ENABLED;
    // F208: the pool watchdog. `lastPoolAt` is the last `$HP`/`$LCD`/`$ALCD`; `_shotDueAt` is a trigger press still
    // waiting for its `$ALCD`; `_noFirePulls` counts presses that never got one. See `poolStale()`.
    this.lastPoolAt = 0; this._shotDueAt = null; this._noFirePulls = 0;
    this._dryPulls = 0;             // the RELOAD nag: trigger pulls into an empty magazine this dry spell (the RELOAD nag's counter)
    // F264: the cure. `_queryAt` is when the last probe went out and `_probeSeen` says which reply kinds it has
    // already taken, so a SOLICITED reply can be told from the gun answering a trigger. `_cure` is
    // {askedAt, asks} while a probe is outstanding; `_cureLife` and `_cureAt` are the two bounds, one per life
    // and a floor between them. `_pollAt` and `_probedLife` are the heartbeat poll's and the spawn read-back's
    // own clocks. See `_cureTick`.
    this._queryAt = 0; this._probeSeen = {};
    this._cure = null; this._cureLife = null; this._cureAt = 0; this._pollAt = 0; this._probedLife = null;
    this.cure = null;               // the cure's own VERDICT, {verdict: 'asking'|'dead'|'alive'|'no_answer', at}. Rides `statusBody` so the operator's board can tell 'the node tried and got nothing' from a bare stale claim -- a phone log reached nobody on 2026-09-18
    // S29: the shield recharge. `_shieldQuietAt` is the clock the delay runs from (a spawn, or the last
    // damage); `_shieldRegen` is {startedAt, nextAt, grants} while the node is granting; `_shieldDown` says
    // the shield BROKE this life (a spawn starts at 0 without having broken, and must not heartbeat).
    this._shieldRegen = null; this._shieldQuietAt = 0; this._shieldLoopAt = 0; this._shieldDown = false; this._shieldGaveUp = false;
    this._actSeq = 0;               // pl4: shots and hits seen, so `_writeMust` can tell the life moved on
    this._writeLost = null;         // pl4: the `_lifeSeq` whose spawn/revive write resolved false (pool `write_lost`)
    this.hurtFired = false;         // low-health alert already sent this life
    this._pendingHurtWrite = false; // ...and whether that alert is still sitting in its debounce window
    this.stunned = null;            // F15: {at, until, ammo:{slot:[mag,reserve]}} while an EMP has the gun disarmed; the ammo is the LIVE count to restore
    this._recoil = null;            // S42: {weaponId, ceiling, floor, perShot, recoverMs, value, ...} for the ACTIVE weapon's live accuracy model, or null (no profile / recoil off)
    this._lastTeamRepaintAt = null; // F68: last periodic team-colour repaint (tick(), TEAM_REPAINT_MS)
    this._accHoldUntil = 0;         // S42 × A44/A47/F15: the accuracy writer stands down until this time (`_holdAccuracyWrites`)
    this._accHoldWhy = null;        // ...and which write asked it to, published as `state().accHold` so a reader can see why
    this.switching = null;          // {at, from} while an ALT weapon swap is in flight (field 2026-08-30)
    // {at, ms, slot, from, cap, mag, lastGainAt} from the reload-handle pull ($BUT,2) until the gun's OWN
    // $ALCD says the mag came back (review 2026-09-03 #15; reconciled against real ammo for F123).
    this.reloading = null;
    this._reloadOutcome = null;     // F123: how the LAST takeover ended — {ok, filled, from, to, cap, gained, slot, ms, why, at}; null before the first reload of a life
    this.held = {};                 // F123: $BUT id -> the `now()` of the press that is still down (a release deletes the entry)
    this.lastButton = null;         // the last $BUT edge either way: {id, state, at, heldMs}
    this.lastSwitchMs = null;       // measured duration of the last completed swap
    this._prevAmmo = {};            // per weapon slot ($ALCD token 3): last mag seen
    this._prevReserve = {};         // per weapon slot: last reserve seen ($ALCD token 4) -- the stun restore needs the LIVE pair, not the frame's (F15/F87)
    this._shotAcct = {};            // F259: per weapon slot, the node's OWN magazine account -- {mag, fired, at}. See `_acctLive`.
    this.activeSlot = 0;
    this.magBySlot = {};
    // Bench 2026-09-17: $ALCD token 5 is weapon heat (protocol.py `parse_alcd`), non-zero only on an
    // overheat weapon (§7j). Read straight off the wire, per slot -- no synthetic decay or reload-clear
    // here, because the gun's own next $ALCD already reports the true post-reload/post-cooldown value.
    // OVERHEATING is heat >= HEAT_LOCKOUT (pl4: 99; the charge rifle read 106 mid-lockout, 0 cool;
    // mcp/brx_mcp/protocol.py's own `overheating: bool(heat)` is untested between 1-99 and would light
    // up on the very first rising frame of ordinary fire, which is not what "OVERHEAT" means on the bench).
    this.heatBySlot = {};
    this._heatLock = null;   // pl4: {slot, at, lastAt} from the first reading at or past HEAT_LOCKOUT; see `_overheatOnHud`
    // Per slot, the `now()` of the last heat token recorded -- lets `_heatBlocksFire()` treat a reading as
    // stale once nothing has refreshed it for HEAT_STALE_MS (review 2026-09-17: see the constant's comment).
    this._heatAt = {};
    // Per slot, true once that slot has reported heat > 0 this life -- the HUD's heat bar exists only for a
    // weapon that actually heats (a bullet weapon's $ALCD always carries heat 0, which is a real "no heat",
    // not "unknown"; reading `heatBySlot[slot] != null` alone would show the bar on every weapon after its
    // first shot).
    this._everHeated = {};
    // Bench 2026-09-17: the last round that left a weapon slot, {slot, at, ms}, where `ms` is that slot's
    // `$WEAP` token 14 from the head (null when the head carries no full frame). Display only: the HUD cue.
    this.lastShot = null;
    this.endedMatches = [];         // match_ids already ended locally — a re-hydrated `start` for them is a no-op
    this.endAck = false;            // result screen shown until the player taps OK (then the 'over' screen)
    this.onEnd = null;              // app hook: called once per ended match with a stats summary (history)
    this.onResult = null;           // A24 app hook: the result landed — PATCH the history entry for that match_id
    this.onRelink = null;           // A47 app hook: MC's operator RELINK GUN -- app.js wires it to `link.relink()` (the HUD's RELINK GUN)
    this.onGunStale = null;         // B4 app hook: the gun link watchdog fired — BrxLink should force-cycle the radio (falls back to onBleDropped() if unset, e.g. demo/tests)
    this.endedAt = 0;               // when this node saw the match end (the results screen's 30 s settle window)
    this.configPending = false;     // config arrived while the gun was unlinked → write head on relink
    this.pendingTeardown = null;    // 'end' | 'panic' owed to the gun once it relinks
    this.stations = [];             // utility items in radio range (beacon.js Presence entries), newest snapshot from the app
    this._stationSig = '';
    this._awakeAt = 0;              // §3.11: `now()` of the last tick or gun frame — the evidence the webview was RUNNING. 0 = never (a cold start), which resume() reads as a full suspension.
  }

  /** The engine's proof of life: tick() and every frame off the gun stamp it, so `resume()` can tell a
   *  webview that was frozen from one that never stopped ticking (RESUME_GAP_MS). */
  _awake() { this._awakeAt = this.now(); }

  // ---------- persistence (§3.7) ----------
  _save() {
    if (!this.storage) return;
    try {
      this.storage.setItem(KEY, JSON.stringify({
        phase: this.phase, gun: this.gun, player: this.player, team: this.team, roster: this.roster,
        config: this.config, frames: this.frames, start: this.start, matchId: this.matchId,
        deaths: this.deaths, shots: this.shots, spawned: this.spawned, ended: this.ended, savedAt: this.now(),
        // A24: `ended` alone is not enough to restore the results screen. `resultWait` needs `endedAt` (the
        // 30 s settle window is measured from it) and a falsy one pins the screen on PENDING for ever — a
        // relaunch during recap could never reach MC NOT REACHED, and a result already pushed was lost with it.
        endedAt: this.endedAt, result: this.result, resultAt: this.resultAt,
        // combat state — WITHOUT this a rejoin defaults alive:false/hp:0, the recovery guard stamps a
        // death, and auto-respawn HEALS you to full: force-close at 1 hp, reopen, get a free respawn
        // (bench 2026-09-04, Tony — a real cheat). Restoring the real pools closes it; the resync still
        // corrects anything that changed while the link was down.
        alive: this.alive, hp: this.hp, armor: this.armor, shield: this.shield, deadAt: this.deadAt, killedBy: this.killedBy,
        endedMatches: this.endedMatches.slice(-8), configPending: this.configPending, pendingTeardown: this.pendingTeardown,
        catalog: this.catalog, policy: this.policy, game: this.game, briefSeen: this.briefSeen,
        // B4/T2-B-1: without this, a restart mid-match forgets the probe ran and the relink's defensive
        // `$PHONE,*` resend (onBleConnected) never fires -- exactly the case it was added for.
        probeSent: this.probeSent,
        // T2-B item 2: a benched player who force-closes must come back SITTING OUT, not to a normal
        // kit screen that lets them browse/ready while MC still thinks they are parked.
        standby: this.standby,
      }));
    } catch (_) { /* ignore */ }
  }
  _load() {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(KEY); if (!raw) return;
      const s = JSON.parse(raw);
      if (s.savedAt && this.now() - s.savedAt > C.CONFIG_TTL_MS) { this.log('persisted context expired', 'li'); return; }
      Object.assign(this, { gun: s.gun, player: s.player, team: s.team, roster: s.roster || [], config: s.config,
        frames: s.frames, start: s.start, matchId: s.matchId, deaths: s.deaths || 0, shots: s.shots || 0,
        spawned: !!s.spawned, ended: !!s.ended, endedAt: s.endedAt || 0, result: s.result || null, resultAt: s.resultAt || 0,
        endedMatches: s.endedMatches || [], configPending: !!s.configPending, pendingTeardown: s.pendingTeardown || null,
        alive: !!s.alive, hp: s.hp || 0, armor: s.armor || 0, shield: s.shield || 0, deadAt: s.deadAt || 0, killedBy: s.killedBy || null,
        catalog: s.catalog || null, policy: s.policy || null, game: s.game || null, briefSeen: !!s.briefSeen,
        probeSent: !!s.probeSent, standby: !!s.standby });
      // Phase is re-derived when the gun reconnects (resumeSchedule); until then we are idle.
      this._pendingPhase = s.phase;
    } catch (_) { /* ignore */ }
  }
  clearPersisted() { try { this.storage && this.storage.removeItem(KEY); } catch (_) { /* ignore */ } }

  // ---------- helpers ----------
  _set(phase) {
    if (this.phase === phase) return;
    this.log(`phase ${this.phase} → ${phase}`, 'lk');
    this.phase = phase;
    if (phase === 'armed' || phase === 'live') this._autoNight();
    this._changed();
  }

  // ---------- HUD skin (Tony, bench 2026-09-17) ----------
  // NIGHT OPS (`config.night`) dims the gun and headset LEDs. It does not own the phone screen: each player picks
  // day or night on their own HUD, at any time. NIGHT OPS only sets the default, at ARMED/LIVE, for a player who
  // has not picked in this MC session. A pick lasts for the MC session, across matches and app restarts; a fresh
  // MC session lets NIGHT OPS lead again. The skin itself is remembered on the phone either way.
  setNight(on) {
    this.night = !!on;
    this.nightChoice = { session: this.sessionOf() || null };
    this._storeNight();
    this.log(`skin: ${this.night ? 'night' : 'day'} (player's choice)`, 'li');
    this._changed();
  }
  /** True when the player picked a skin in the current MC session. A pick made before joining any MC joins the next one.
   *  Bench/review 2026-09-17: on an app restart mid-match the gun can relink over BLE (fast, local) before MC's
   *  welcome (a network round trip) has told the node its session id back, so `sessionOf()` reads null for a
   *  window in which `_autoNight` can still fire (ARMED/LIVE). Falling back to the PERSISTED session here (the
   *  one this pick is already tied to) treats "session not known yet" as "not proven different", so NIGHT OPS
   *  cannot override a real pick just because the welcome is late. Once the welcome arrives with a genuinely
   *  different session id, the fallback stops applying and a fresh MC session leads NIGHT OPS again as designed. */
  ownNightChoice() {
    const c = this.nightChoice; if (!c) return false;
    // pl3 (2026-09-17): the transport's last PERSISTED MC session comes before the pick's own. A pick from session
    // s1, then a welcome from s2, then a restart: the pick's session would still read "same" and block NIGHT OPS.
    const cur = this.sessionOf() || this.persistedSessionOf() || c.session || null;
    if (c.session == null && cur != null) { c.session = cur; this._storeNight(); }
    return (c.session || null) === cur;
  }
  _autoNight() {
    if (!this.config || !this.config.night || this.night || this.ownNightChoice()) return;
    this.night = true; this._storeNight();
    this.log('skin: night (NIGHT OPS)', 'li');
  }
  _loadNight() {
    if (!this.storage) return;
    try {
      this.night = this.storage.getItem(NIGHT_KEY) === '1';
      const c = JSON.parse(this.storage.getItem(NIGHT_CHOICE_KEY) || 'null');
      this.nightChoice = c && typeof c === 'object' ? { session: typeof c.session === 'string' ? c.session : null } : null;
    } catch (_) { /* a blocked or corrupt store starts on day with no pick */ }
  }
  _storeNight() {
    if (!this.storage) return;
    try {
      this.storage.setItem(NIGHT_KEY, this.night ? '1' : '0');
      if (this.nightChoice) this.storage.setItem(NIGHT_CHOICE_KEY, JSON.stringify(this.nightChoice)); else this.storage.removeItem(NIGHT_CHOICE_KEY);
    } catch (_) { /* best-effort */ }
  }
  _changed() { this._save(); try { this.onChange(this); } catch (_) { /* ignore */ } }
  /** Maint review 2026-09-17: the one reading of the `STAND_DOWN` table. `names` is THIS call site's subset --
   *  every site names its own, because the sets genuinely differ -- and the answer is the first name in table
   *  order that blocks, else null. Truthy means "stand down". PURE.
   *
   *  `now` defaults to a fresh clock reading; a caller already inside `tick` passes the tick's own `now`, which
   *  is what `_recoilFlush` and `_noFireTick` do. A name that is not in the table is ignored here and caught by
   *  engine.test.mjs instead, so a typo can never throw at a player mid-match. */
  _standDown(names, now = this.now()) {
    for (const [name, test] of STAND_DOWN) if (names.includes(name) && test(this, now)) return name;
    return null;
  }
  /** Every gun write goes through here, and the deny list is enforced HERE, not in the bundle: a frame whose
   *  command word is in `NODE_DENIED_COMMANDS` (generated from `protocol.DENIED_COMMANDS`: persistent state,
   *  pairing, DFU, the IR word-format switch, factory tests, and `$DPLAY`, which blocks the gun's main loop
   *  with the serial port unread) is dropped and logged, whatever MC, a debug panel or a stale bundle says.
   *  `docs/spec/transport-hardening.md` §4. */
  _write(frames, why) {
    if (!frames || !frames.length) return;
    // DENY FIRST, THEN THE TEAM. Do not swap these two steps for tidiness: the order is the behaviour, and
    // stage.py `write` does it in exactly this order (`test_stage_mirror` reads both bodies and fails on
    // whichever one moves). Restore the team first and a denied `$PSET` dropped afterwards leaves its `$TID`
    // behind as an orphan, because `$TID` is a KNOWN command and the deny filter has no reason to take it.
    // The gun would then read a team byte for a `$PSET` that never arrived. Filter first and no `$PSET` is
    // left to insert behind. Nothing on the deny list is a `$PSET` today, so this is latent, not live. It is
    // written down because the two steps look independent, and the next person to tidy this function will
    // otherwise reorder them.
    const denied = frames.filter(f => typeof f === 'string' && deniedCommand(f));
    if (denied.length) {
      this.refused = (this.refused || 0) + denied.length;
      this.log(`write ${why}: REFUSED ${denied.length} frame(s) the node must never send: ${denied.map(f => f.split(',')[0]).join(' ')}`, 'le');
      frames = frames.filter(f => !denied.includes(f));
      if (!frames.length) return;
    }
    frames = this._tidAfterPset(frames);   // LAST, and after the deny filter above, for the orphan `$TID` reason written there (F206)
    // F121 rebuild: a `$SIR` row or a `$CLEAR` leaves the gun's table something other than a `sir_pool` take, so the
    // next protection release must write one. Marked at CALL time, like the write order itself. stage.py `write` mirrors it.
    if (frames.some(f => typeof f === 'string' && (f.startsWith('$SIR,') || f.startsWith('$CLEAR')))) { this._sirGen++; this._sirLive = false; }
    this.log(`write ${why}: ${frames.length} frame(s)`, 'li');
    try { return this.writer(frames, why); } catch (e) { this.log(`write ${why} failed: ${e && e.message || e}`, 'le'); }
  }
  /** pl3 (2026-09-17): a write the gun must not miss AND that is harmless to repeat -- the stun restore and the
   *  operator resync (both re-send the live counts, `$TID` and `$BMAP`; nothing heals or re-heads). Spawn and
   *  revive are NOT repeatable: see `_writeLife`. BrxLink's `write()` resolves false when a chunk was lost and
   *  its own re-sends did not land. `still()` is asked before the one retry, and a shot or a hit since the first
   *  attempt also refuses it (pl4: the counts are then out of date, a repeat would refill). A second failure is
   *  logged loudly and left to the operator's RESYNC GUN, as `_armLife` leaves its own to the next trigger. */
  _writeMust(frames, why, still, actExempt = false) {
    const act = this._actSeq;   // pl4: a shot or a hit after this point makes a repeat unsafe (it re-sends counts the gun has moved past)
    const r = this._write(frames, why);
    Promise.resolve(r).then(ok => {
      if (ok !== false) return;
      // `actExempt`: 2026-09-19, `$BMAP,0,0` (weapon systems live) is safe to repeat whatever shots or
      // hits landed in between -- it maps a button, it never re-sends a count the gun has moved past.
      if (!still() || (this._actSeq !== act && !actExempt)) { this.log(`write ${why} failed -- the game moved on, not retried`, 'li'); return; }
      this.log(`write ${why} failed -- retrying once`, 'le');
      return Promise.resolve(this._write(frames, `${why} (retry)`)).then(again => {
        if (again === false) this.log(`*** write ${why} failed twice -- the gun may be out of step (RESYNC GUN) ***`, 'le');
      });
    }).catch(e => this.log(`write ${why} retry failed: ${e && e.message || e}`, 'le'));
    return r;
  }
  /** pl4 (2026-09-17): a spawn or revive write is NEVER sent twice. A repeat re-sends `$SPAWN` and the loadout
   *  `$AMMO` into a life in play (a refill and a second spawn line), and on a protected bundle it re-sends the
   *  protection (`$TMP` t8 = -100, or an older bundle's fn-28 twin), which can land after `_armLife` ended it and
   *  leave the gun unhittable for the life (F11).
   *  On a false resolve for THIS life: log loudly, make sure a live take is pending or written, and flag the
   *  pool `write_lost` so MC shows it and the operator's RESYNC GUN is the cure. */
  _writeLife(frames, why, life) {
    const r = this._write(frames, why);
    Promise.resolve(r).then(ok => {
      if (ok !== false) return;
      this.log(`*** write ${why} failed -- not re-sent; the gun may be out of step (RESYNC GUN) ***`, 'le');
      if (this._lifeSeq !== life || !this.alive || this.phase !== 'live' || this.ended) return;
      this._writeLost = life;
      if (this._protectsSpawn()) {
        if (this._armPending) return;   // the take still follows the first shot or the cap
        this._armPending = this._repairArm();
        if (this.bleUp && !this.reconciling) this._armLife(`${why} lost`);   // else the cap or the reconcile end arms it
      } else {
        const sir = frames.filter(f => typeof f === 'string' && f.startsWith('$SIR,'));
        if (sir.length && this.bleUp && !this.reconciling) this._write(sir, `${why} lost: hit table again`);   // F11 repair: rows only
      }
      this._changed();
    }).catch(e => this.log(`write ${why} failed: ${e && e.message || e}`, 'le'));
    return r;
  }
  /** F206 (bench 2026-09-16): any `$PSET` clears the gun's team (its shots carry `$HIR` t4 = 0) until a `$TID`
   *  follows; `$SPAWN` and `$SIR` do not. So every write is checked HERE, the one door to the gun: a `$PSET` with
   *  no `$TID` after it gets the gun's team right behind it. The team is the last `$TID` in this write, else the
   *  last one this node wrote, so an infection flip's `$TID` wins. Mirrors: stage.py `write`, driver.py `_send`. */
  _tidAfterPset(frames) {
    let lastPset = -1, lastTid = -1;
    frames.forEach((f, i) => { if (typeof f !== 'string') return; if (f.startsWith('$PSET,')) lastPset = i; else if (f.startsWith('$TID,')) lastTid = i; });
    if (lastTid >= 0) { const t = Number(frames[lastTid].split(',')[1]); if (Number.isFinite(t)) this._gunTid = t; }
    if (lastPset < 0 || lastTid > lastPset) return frames;
    const tid = this._liveTid();
    if (tid == null) return frames;
    return [...frames.slice(0, lastPset + 1), `$TID,${tid},*`, ...frames.slice(lastPset + 1)];
  }
  /** F206: the team the gun should carry now -- the last `$TID` this node wrote; after an app restart `_gunTid` is
   *  gone (not persisted), so the flipped roster team in infection, else the persisted head's own `$TID`. Null if none. */
  _liveTid() {
    let tid = this._gunTid;
    if (tid == null && this.config && this.config.mode === 'infection' && this.team && this.team.tid != null) tid = Number(this.team.tid);
    if (tid == null) { const h = ((this.frames && this.frames.head) || []).find(f => typeof f === 'string' && f.startsWith('$TID,')); if (h) tid = Number(h.split(',')[1]); }
    return tid == null || !Number.isFinite(tid) ? null : tid;
  }
  teamOf(num) { const r = this.roster.find(x => x.player_num === num); return r ? r.team_id : null; }
  nameOf(num) { const r = this.roster.find(x => x.player_num === num); return r ? r.display : null; }
  /** The kill banner's name for MC's `feedback{kill}`: `victim` is a player_id on the wire, never a name (field
   *  2026-09-17: the banner showed the raw id). MC's `victim_display` first, then this phone's roster, else null so
   *  the HUD says "<TEAM> OPERATIVE" rather than print an id. */
  victimName(body) {
    if (body && typeof body.victim_display === 'string' && body.victim_display) return body.victim_display;
    const r = body && body.victim != null ? this.roster.find(x => x.player_id === body.victim) : null;
    return r && r.display ? r.display : null;
  }
  get teamTid() { return this.team ? this.team.tid : null; }
  get teamKey() { return this.team ? (TEAM_KEY[this.team.tid] || String(this.team.color || 'blue')) : 'blue'; }
  /** F213: the pool ceiling THE HEAD ACTUALLY ARMS. `compile.py` bakes per-player `overrides.max_hp/max_armor`
   *  and the `body_armor` perk's `max_armor_add` into the pushed `$PSET` (`_to_gc`/`armed_armor`), so reading
   *  that frame back is the one source that cannot drift from a second copy of the rules -- the same reading
   *  `mc/frames.py head_pool()` and `mock_node.py` already use. Falls back to `config.health` when the head
   *  carries no readable `$PSET` yet (a stub bundle, or before the first config lands). */
  _headPool() {
    const head = (this.frames && this.frames.head) || [];
    const f = head.find(x => typeof x === 'string' && x.startsWith('$PSET,'));
    if (!f) return null;
    const p = f.split(',');
    const hp = Number(p[3]), armor = Number(p[4]), shield = Number(p[5]);
    // t5 is the shield CEILING, not a starting pool: a gun spawns at shield 0 and `$LIFE` grants fill it,
    // clamped there by the firmware (bench 2026-09-17, step 7). An older/stub head with no t5 reads 0, which
    // is exactly "this game has no shield to fill" for everything that asks.
    return (Number.isFinite(hp) && Number.isFinite(armor)) ? { hp, armor, shield: Number.isFinite(shield) ? shield : 0 } : null;
  }
  get maxHp() { const p = this._headPool(); if (p) return p.hp; return (this.config && this.config.health && this.config.health.max_hp) || 45; }
  /** F47: `??`, not `||` -- MC may ship `max_armor: 0` ("one-shot with a sniper"); `||` turned that explicit 0
   *  into 70. Only the config-fallback path needs this: a `$PSET`-sourced 0 already survives `Number.isFinite`. */
  get maxArmor() { const p = this._headPool(); if (p) return p.armor; const v = this.config && this.config.health && this.config.health.max_armor; return (v === 0 || v > 0) ? v : 70; }
  /** S45: the shield ceiling the compiled `$PSET` armed, `$PSET`-sourced first, same as `maxHp`/`maxArmor` --
   *  `config.health.max_shield` is the host's OWN field now (a preset pick, or Advanced), not a value the gun
   *  reported, so it is only the fallback for a stub bundle (before the first real head lands). */
  get maxShield() { const p = this._headPool(); if (p) return p.shield; const v = this.config && this.config.health && this.config.health.max_shield; return (v === 0 || v > 0) ? v : 0; }
  /** F34/F13: floored at MIN_RESPAWN_S on the node too. MC refuses 1-2 s at PUT, but a config that arrives another
   *  way (a stored preset, the demo, the stage) spawned at exactly that, inside the headset relay's out-blink wedge. */
  get respawnDelayMs() { const s = this.config && this.config.respawn && this.config.respawn.delay_s; return Math.max(MIN_RESPAWN_S, s > 0 ? s : 10) * 1000; }
  get respawnType() { return (this.config && this.config.respawn && this.config.respawn.type) || 'auto'; }
  /** F15: the host-driven stun is ON when the config carries a `stun` object (`{duration_s}`); a proto-8 `$HIR` is
   *  otherwise an ordinary hit (the stock `<8,0>` row is the charge rifle's plain damage) and must disarm nothing. */
  get stunEnabled() { return !!(this.config && this.config.stun && typeof this.config.stun === 'object'); }
  get stunMs() { const s = this.config && this.config.stun && +this.config.stun.duration_s; return (s > 0 ? s : STUN_DEFAULT_S) * 1000; }
  /** scanner respawn: 'trigger' = at the station AND pull the trigger (default); 'presence' = being at the station is enough.
   *  F212: `gate` is a SCANNER-ONLY knob (contracts.md §3 `respawn.gate`, "scanner only") -- the getter used to
   *  default to 'trigger' for every respawn type, so an `auto` config's status reported `respawnGate:"trigger"`
   *  even though nothing ever gates an auto respawn on the trigger (the `auto` branch below only checks the
   *  timer). That label then read as a real trigger-gated respawn reachable outside scanner mode -- it never
   *  was. `null` for anything but scanner, so a consumer cannot mistake "not applicable" for "gated". */
  get respawnGate() { return this.respawnType === 'scanner' ? ((this.config && this.config.respawn && this.config.respawn.gate) || 'trigger') : null; }
  get timeLimitMs() { const s = this.config && this.config.time_limit_s; return s ? s * 1000 : null; }
  get goLiveT() { return this.start ? this.start.go_live_t : null; }
  get endT() { return (this.goLiveT && this.timeLimitMs) ? this.goLiveT + this.timeLimitMs : null; }
  get weaponName() {
    const ws = this.player && this.player.loadout && this.player.loadout.weapons;
    const w = ws && (ws[this.activeSlot] || ws[0]);
    if (!w) return 'PRIMARY';
    const row = this.weaponRow(w.weapon_id);
    return (row && row.name ? row.name : String(w.weapon_id).replace(/_/g, ' ')).toUpperCase();
  }
  weaponRow(id) { const c = this.catalog; return (c && c.weapons && c.weapons.find(w => w.weapon_id === id)) || null; }
  perkRow(id) { const c = this.catalog; return (c && c.perks && c.perks.find(w => w.perk_id === id)) || null; }
  armState() { return this.phase; }

  // ---------- BLE link ----------
  onBleConnected(gun) {
    const first = !this.bleUp && !this.gun;
    this.gun = gun || this.gun; this.bleUp = true;
    this.lastGunFrameAt = this.now();   // B4: the watchdog's clock restarts at the moment of (re)link, not from whatever it was before the drop
    // B4: a RELINK (not the very first connect, which `_probe()` below covers with the full ritual) may
    // find the gun's own "app mode" event tap closed by whatever caused the drop — a bare `$PHONE,*` is
    // documented as side-effect-free once the tap is already open (bench 2026-08-25: "$PHONE,* returns
    // nothing"; it is also the one frame confirmed to wake a gun blind, "after a power-cycle $PHONE,*
    // alone wakes it") and carries no $STOP, so it never touches game/audio state. Without this a link
    // that drops and relinks mid-game could sit at `bleUp:true` while the gun stays mute — no $HIR, no
    // $BUT, no $VOLTS — until something else notices (field 2026-09-12, B4).
    if (this.probeSent) this._write(['$PHONE,*'], 'reopen event tap on relink');
    if (this.phase === 'idle') {
      // Re-derive the phase from persisted context (§3.7 / §3.11).
      const p = this._pendingPhase; this._pendingPhase = null;
      if (p && p !== 'idle' && this.player) { this.phase = p; this.log(`restored phase ${p} from storage`, 'li'); }
      else this.phase = this.player ? 'kitted' : 'connected';   // MC-first hydrate: player known → KITTED, not CONNECTED
    }
    let justPanicked = false;
    if (this.pendingTeardown) { justPanicked = this.pendingTeardown === 'panic'; this._writeTeardown(this.pendingTeardown, 'relink'); this.pendingTeardown = null; }
    if (this.phase === 'connected' || this.phase === 'kitted') this._probe();
    // A head we hold but never wrote (config/hydrate arrived with the gun unlinked) is written now —
    // never over a match-over screen (`ended`) and never right after a panic we just delivered.
    if (!justPanicked && !this.ended && this.frames && this.frames.head && (this.phase === 'kitted' || (this.phase === 'lobby' && !this.headEcho))) {
      this.configPending = false; this._applyConfig({ config: this.config, frames: this.frames, roster: this.roster }, 'relink');
    } else if (this.phase === 'live') this._beginReconcile();   // S7.1: a rejoin RECONCILES (disarm, keep real pools) — never the infer-death resync that healed on restart
    else if (this.phase === 'lobby' || this.phase === 'armed') this._beginResync('ble-reconnect');
    if (first) this.log(`gun ${this.gun ? this.gun.name : '?'} linked`, 'lk');
    // A restored/held schedule is reconciled against the clock now (E5: grace / hot-join / already over).
    // MC-first late joiner: the running `start` arrived while idle and the relink landed in LOBBY — reconcile from there too.
    if (this.start && (this.phase === 'lobby' || this.phase === 'armed')) this.resumeSchedule();
    this._changed();
  }
  /** BrxLink's flap state: the gun connects, then drops within seconds, again and again (headset off). */
  setGunFlapping(f) {
    const next = f && f.count >= 2 ? { count: f.count, next_retry_at: f.next_retry_at ?? null, ...(f.quiet ? { quiet: true } : {}) } : null;
    if (JSON.stringify(next) === JSON.stringify(this.gunFlapping)) return;
    this.gunFlapping = next; this._changed();
  }
  onBleDropped() { this.bleUp = false; this.lastGunFrameAt = 0; this._cure = null; this._queryAt = 0;   // F264: no link, no answer -- an ask in flight can never resolve, and it must not time out into a blind revive on the relink
    this._endReload('dropped'); this.switching = null; this.held = {}; this.lastButton = null; this._lightGen = (this._lightGen || 0) + 1; this.log('gun link lost', 'le'); this._changed(); }   // no link, no reload echo: the takeover would be fiction (pass-2 UX review 2026-09-03); the gen bump means a stray delayed write can't reach a gun that relinks mid-flight either. `held` goes with it: `_onButton` keeps the FIRST edge, so a press whose release never arrived before the drop would read as held forever — and `lastButton` with it, for the same reason: the last thing the gun said would otherwise sit on the diag panel as a live edge the link can no longer complete (review 2026-09-12). `lastGunFrameAt` resets too (B4): a dead watchdog clock must not immediately re-fire the instant the next relink's first frame is still pending
  setWsState(s, info) { this.wsState = s; this.wsReason = s === 'rejected' && info ? `${info.reason || 'refused'} (${info.code})` : null; this._changed(); }

  /** Pre-config probe set: only in CONNECTED/KITTED, never after a head is written (contracts §3). */
  _probe() {
    if (this.probeSent || !(this.phase === 'connected' || this.phase === 'kitted')) return;
    this.probeSent = true;
    this._write([...PROBE_FW], 'probe');
  }

  // ---------- MC context ----------
  hydrate(node) {
    if (!node) return;
    this.lastMcMsgAt = Date.now();   // F265: a welcome is a message from MC too
    // A40 (T2 review S1/S4): the welcome STATES the bench fact, and this is where a returning phone
    // learns it. `standby` is persisted locally (`_save`), and until now NOTHING in a welcome could
    // clear it -- only an `assign` with a falsy `standby` could, and that push needs a bound node, which
    // a benched player does not have. So: bench a player, their phone locks or walks out of range, the
    // operator taps PLAY, the phone reconnects -- and it came back still locally benched. SITTING OUT,
    // no frames, no READY UP, no control on the screen, while the console showed them rostered and
    // ready. Only a force-close plus a data wipe cured it. Applied BEFORE the config/start below, both
    // of which refuse while benched.
    if (node.standby != null) this.standby = !!node.standby;
    if (this.standby) this.ready = false;   // MC parks AND reinstates at ready:false (S7)
    if (node.player) this.player = node.player;
    if (node.team) this.team = node.team;
    if (node.roster) this.roster = node.roster;
    if (node.config) this.config = node.config;
    if (node.frames) this.frames = node.frames;
    if (node.catalog) this.catalog = node.catalog;   // A10: a welcome may re-hydrate the catalog/policy too
    if (node.policy) this.policy = node.policy;
    if (node.game) this.game = node.game;
    if (node.score) { this.score = node.score; this.scoreAt = this.now(); }
    if (node.match_id) this.matchId = node.match_id;
    if (node.result) this.onResultPush(node.result, 'welcome');   // A24: MC carries the final result in `welcome.node.result` through recap
    if (this.player && this.phase === 'connected') this._set('kitted');
    if (node.frames && node.config && (this.phase === 'kitted')) {
      // A rejoining node that missed the push: apply the head like a fresh `config`.
      this._applyConfig({ config: node.config, frames: node.frames, roster: node.roster || this.roster }, 'hydrate');
    }
    if (node.start && !(node.start.match_id && this.endedMatches.includes(node.start.match_id))) this.startAt(node.start);
    this._changed();
  }

  onMcMessage({ kind, body, t }) {
    this.lastMcMsgAt = Date.now();   // F265: every DELIVERED kind proves the socket is alive, `time_res` included
    switch (kind) {
      case 'assign': return this._assign(body);
      case 'config': return this._applyConfig(body, 'config');
      case 'tutorial': return this._tutorial(body);
      case 'loadout_ack': return this._loadoutAck(body);
      case 'start': return this.startAt(body);
      case 'feedback': return this.feedback(body, t);
      case 'alert': return this.alert(body, t);
      case 'control': return this.control(body);
      case 'apply': {
        const fr = body.frames || [];
        if (this.phase === 'live') return this._write(fr, 'apply');
        // A9.1 preview: sound-only applies may play OFF-live (voice/gamertag preview at the bench) —
        // restricted to $PLAY/$SFLASH so A6.4's no-state-writes-off-live safety holds.
        if (body.preview && ['connected', 'kitted', 'lobby'].includes(this.phase) && fr.length && fr.every(f => f.startsWith('$PLAY') || f.startsWith('$SFLASH'))) return this._write(fr, 'apply preview');
        return undefined;
      }
      case 'result': return this.onResultPush(body, 'push');   // A24 — never inferred, only ever pushed
      case 'score': if (body && typeof body === 'object') { this.score = body; this.scoreAt = this.now(); this._changed(); } return;   // may carry `board` {teams:[{team_id,name,score}], cap} for the DOWN recap
      default: return;
    }
  }

  /** A24 / node.md §3.13 — the MATCH RESULT. `outcome` ("win"|"lose"|"draw"|"undecided") is already computed FOR
   *  THIS RECIPIENT by MC; the node only stores and renders it. Accepted for the CURRENT `match_id` only: a stale
   *  one is logged and dropped, because a result from the previous match rendered over this one's screen is a
   *  confident lie. `source` is 'push' (live) or 'welcome' (a rejoin during recap).
   *
   *  What must NOT happen here (and is the whole reason the field exists): inventing an outcome when nothing
   *  arrived. There is no `else` branch below that writes win or lose — the absence of a result is rendered as
   *  "pending", never as a loss. */
  onResultPush(body, source = 'push') {
    if (!body || typeof body !== 'object' || Array.isArray(body)) { this.log('result: not an object — dropped', 'le'); return { ok: false, reason: 'bad_body' }; }
    const mid = body.match_id;
    if (!mid) { this.log('result with no match_id — dropped (MC must stamp it)', 'le'); return { ok: false, reason: 'no_match_id' }; }
    if (!this.matchId) { this.log(`result for ${mid} — this node has no current match — dropped`, 'li'); return { ok: false, reason: 'no_match' }; }
    if (mid !== this.matchId) { this.log(`result for ${mid} — not this match (${this.matchId}) — dropped`, 'li'); return { ok: false, reason: 'stale' }; }
    this.result = body; this.resultAt = this.now();
    this.log(`match result (${source}): ${body.outcome || '—'}${body.provisional ? ' · provisional' : ''}`, 'lk');
    try { if (this.onResult) this.onResult(body); } catch (_) { /* history is best-effort */ }
    this._changed();
    return { ok: true };
  }

  /** 'in' once MC has told us how it ended · 'unreached' once the settle window has passed with no MC link ·
   *  'pending' otherwise. NONE of the three is an outcome — the screen says what it knows, not what it guesses. */
  resultWait(now = this.now()) {
    if (this.result) return 'in';
    if (this.ended && this.endedAt && (now - this.endedAt) >= RESULT_SETTLE_MS && this.wsState !== 'bound') return 'unreached';
    return 'pending';
  }

  _assign({ player, team, roster, catalog, policy, game, standby }) {
    this.standby = !!standby;
    if (this.standby) {
      // T2-B item 2: benched. No frames, no kit browsing, no ready-up -- just SITTING OUT, wherever the
      // lobby had gotten to (never armed/live: the server refuses stand_down there). Nothing already
      // written to the gun (a previous head, an armed $SIR table) is touched or re-armed by this.
      this.browse(false);
      // S7 (T2 review): the bench clears READY. MC parks at `ready: False` (`stand_down`) and reinstates
      // at `ready: False` (`reinstate`), and this phone only ever reports its ready state from
      // `setReady` -- which refuses while benched. A flag left true therefore showed READY on the HUD
      // while MC counted the player as WAIT and held the start, with no reason shown on either screen.
      this.ready = false;
      this.player = player || this.player; this.team = team || this.team; if (roster) this.roster = roster;
      if ((this.phase === 'connected' || this.phase === 'idle') && this.bleUp) this._set('kitted');
      else if (this.phase === 'lobby') this._set('kitted');
      this._changed();
      return;
    }
    const wasOpen = this.kitOpen();
    if (catalog) this.catalog = catalog;
    if (policy) this.policy = policy;
    if (game) this.game = game;
    if (!wasOpen && this.kitOpen()) { this.briefSeen = false; this.kitLocked = false; }   // §4.6: the kit just opened — show the BRIEFING, the player taps through; A27: and last match's lock notice is retired
    if (!this.kitOpen()) this.browse(false);                   // MC went back to setting up: no browser while the kit is closed
    // A27: the lock notice belongs to the match it was raised in. It normally retires on the kit_open
    // false→true EDGE above — but an MC that never sends `kit_open:false` (and an older MC with no
    // `policy` at all) never gives that edge, so the latch survived into every later lobby and the screen
    // read "THE HOST LOCKED KITS" for ever (review 2026-09-12). A new match retires it too.
    if (this.ended) { this.ended = false; this.endAck = false; this.matchId = null; this.start = null; this.result = null; this.resultAt = 0; this.endedAt = 0; this.kitLocked = false; this.log('new match from MC — leaving the match-complete screen', 'lk'); }
    this.player = player || this.player; this.team = team || this.team; if (roster) this.roster = roster;
    // Bench 2026-09-17: MARK ALL READY (MC's roster-wide `host_override`) marks a player ready who
    // never tapped READY UP themselves, and `setReady` is the phone's ONLY other writer of `this.ready`
    // -- so without this, MC's own count went green while the gun that never tapped stayed on WAIT.
    // One-directional on purpose: this only ever turns READY on, never off. `setReady`/standby/S7 are
    // still the sole way to CLEAR it, so F-4's "a push never un-readies" and S7's "the bench clears
    // READY" both hold exactly as pinned.
    if (player && player.ready && !this.ready) this.ready = true;
    if (team) this._checkTeamVsHead();   // B1: a mid-match re-team the head never followed must not be silent
    if (this.phase === 'connected' || this.phase === 'idle') { if (this.bleUp) this._set('kitted'); }
    this._changed();
    if (this.browsing && !this.canPick('primary') && !this.canPick('secondary') && !this.canPick('perk')) this.browse(false);   // A10: rules locked every slot while the browser was open
  }

  _applyConfig({ config, frames, roster }, why) {
    // T2-B item 2: a benched player is never on the roster `push_config`/`_repush_lobby_config` loop, so
    // this should not arrive at all -- guarded anyway, belt-and-braces, since "no gun frames written"
    // while sitting out is the whole point of the state.
    if (this.standby) { this.log('config ignored while benched (standby)', 'li'); return; }
    // A27/A30 (loadout.md §4.4): a host advance that lands while this player is still kitting is NOT a silent
    // screen swap. A queued pick is dropped (the kit is locked — sending it would only earn a refusal), and the
    // lobby screen leads with "THE HOST LOCKED KITS". A player who had already readied up asked for this.
    if (why !== 'hydrate' && why !== 'relink' && this.phase === 'kitted' && !this.ended && this.kitOpen() && (this.browsing || !this.ready)) {
      this._cancelPick();
      this.kitLocked = true;
      this.moment = { kind: 'kit_locked_by_host', at: this.now() };
      this.log('host locked kits while I was still kitting', 'li');
    }
    this.config = config || this.config;
    this.browse(false);   // the LOADOUT browser is a KITTED-phase screen; a config push ends kit-out
    this.frames = frames || this.frames; if (roster) this.roster = roster;
    this.tutorial = false; this.tutorialWeapon = null; this.tryoutArming = null; this.tryoutUnconfirmed = null;
    this._gunRestFrame = null;   // F86: a new bundle's rest is `gun.rest` until this match's first take says otherwise
    if (!this.frames || !this.frames.head) { this.log('config without frames — ignored', 'le'); return; }
    if (!this.bleUp) { this.configPending = true; this.log('config stored; gun not linked yet — head will be written on relink', 'li'); this._changed(); return; }
    this.configPending = false; this._panicked = null;
    this.headEcho = null; this.ammoEcho = null; this.awaitingEcho = true; this.headWrittenAt = this.now();
    this.butSinceHead = false;         // A37/F-3: a fresh head, so the next ammo frame can be its echo again
    // Playtest 2026-09-13: the head is about 51 chunked BLE writes, and the window used to run from the QUEUE
    // time, so the gun's $ALCD landed about 3 s after the node had acked `no_echo`. The window now opens when
    // the writer says the last frame went out (`headWriteDone`). A writer that returns no promise opens it at once.
    const gen = this._headGen = (this._headGen || 0) + 1;
    this.headWriteDone = false;
    const written = () => { if (gen === this._headGen && this.awaitingEcho) { this.headWriteDone = true; this.headWrittenAt = this.now(); } };
    const w = this._writeHead(why === 'hydrate' ? 'head (rehydrate)' : 'head');
    if (w && typeof w.then === 'function') w.then(written, written); else written();
    this.spawned = false; this.ended = false;
    if (this.phase !== 'armed' && this.phase !== 'live') this._set('lobby');
    this._changed();
  }
  /** Called by tick(): 1.5 s after the LAST head frame is written, report the echo (or its absence). */
  _checkEcho() {
    if (!this.awaitingEcho) return;
    // Still writing: wait, but not for ever. A write that never settles (a hung bridge) acks `no_echo`.
    if (!this.headWriteDone) { if (this.now() - this.headWrittenAt < HEAD_WRITE_CAP_MS) return; }
    else if (this.now() - this.headWrittenAt < ECHO_WINDOW_MS) return;
    this.awaitingEcho = false;
    const cid = this.config && this.config.config_id;
    // The MOST INFORMATIVE echo of the window, not the first one: the $ALCD carries the magazine the
    // head just wrote, so MC can check it against the `$WEAP,0` it compiled. `headEcho` stays the
    // headset proof (`preflight.headset_ok`) either way — a gun that answered with only the $START
    // $LCD still answered.
    if (this.headEcho) this.report('ack_config', { config_id: cid, ok: true, gun_echo: this.ammoEcho || this.headEcho });
    else this.report('ack_config', { config_id: cid, ok: false, err: 'no_echo' });
  }

  _tutorial({ frames, weapon, end }) {
    if (this.phase !== 'kitted' || !frames) return;
    if (end) {                               // host ended the try-out: quiet the gun, drop the panel
      this.tutorial = false; this.tutorialWeapon = null; this.tryoutArming = null; this.tryoutUnconfirmed = null;
      this._write(frames, 'tutorial end');
      this._changed();
      return;
    }
    this.tutorial = true;
    this.tutorialWeapon = weapon || null;    // shown on the HUD: image + details of what's being tried
    this.tryoutSeen = null;                  // a fresh try-out always shows its panel
    // F147 (field 2026-09-12, "try-out shows EQUIPPED/READY on the send; the gun takes a few more seconds"):
    // this call is the ONE place that writes a fresh `$WEAP` table to the gun for a try-out — MC's
    // `loadout_ack` (the rack's ✓) is only the NETWORK round-trip and never waited on this. `$WEAP` has no
    // echo of its own (protocol.md), so — same family as F123 — the observable proxy is the gun's OWN next
    // ammo report on the new weapon's full clip (`_onAmmo`, mirroring how the live SWITCHING takeover
    // confirms on the next $ALCD rather than trusting the write). No clip on the row (an older/stub
    // catalog entry) arms nothing to wait for, so the ⓘ / rack read EQUIPPED at once, as before.
    // Polish-loop pass 3 (HIGH): `gunSlot` is NOT `pk.slot` — a try-out is written to gun slot 0 ALWAYS,
    // primary or secondary alike (compile.py `resolve(wid, 0)` + `$AMMO,0,…`; state.py routes every
    // weapon pick through `tryout()`), so the earlier "secondary → slot 1" guess meant the gun's own
    // $ALCD (which really does arrive on slot 0) was read as an OTHER-slot report and ignored — every
    // secondary pick timed out UNCONFIRMED even on a real gun. Derive it from the frames actually being
    // written instead of guessing: the first `$WEAP,<n>,` or `$AMMO,<n>,` frame names the true slot.
    // `baseline` is the OLD weapon's last-known magazine on THAT slot: a same-slot report that just
    // repeats it is not new information and must not pass for confirmation.
    const clip = weapon ? [weapon.clip, weapon.stats && weapon.stats.mag, weapon.mag].find(v => v != null) : null;
    const gunSlot = this._tryoutFrameSlot(frames);
    // `tab`/`kind` (HUD row identity, polish-loop pass 3 MEDIUM) ride along from the ack's placeholder when
    // there is one; an MC-pushed try-out with no phone-side pick behind it has none, so default to the
    // primary rack (the only tab an old-style host push could mean).
    const tab = (this.tryoutArming && this.tryoutArming.tab) || 'primary';
    const kind = (this.tryoutArming && this.tryoutArming.kind) || 'weapon';
    this.tryoutArming = clip != null ? { at: this.now(), clip, gunSlot, baseline: this._prevAmmo[gunSlot] != null ? this._prevAmmo[gunSlot] : null, tab, kind } : null;
    this.tryoutUnconfirmed = null;
    this._write(frames, 'tutorial');
    this._changed();
  }
  /** Polish-loop pass 3: the gun-wire slot a try-out's $WEAP/$AMMO frames actually target — read from the
   *  frames themselves rather than guessed from which rack tab the pick came from (a try-out always lands
   *  in slot 0 regardless of tab; §above). The first frame naming a slot wins; frames with no slot token
   *  (`$CLEAR,*`, `$TID,1,*`, …) are skipped. Falls back to 0 — the one slot a try-out is ever written to —
   *  if somehow neither frame is present. */
  _tryoutFrameSlot(frames) {
    for (const f of (frames || [])) { const m = /^\$(?:WEAP|AMMO),(\d+),/.exec(f); if (m) return +m[1]; }
    return 0;
  }

  // ---------- A10 self-serve kitting (docs/spec/loadout.md §4) ----------
  /** §4.1: MC opens the kit only while the host is on KIT before the push. No flag (older MC) = open. */
  kitOpen() { const p = this.policy; return !p || p.kit_open !== false; }
  /** §4.6: BUILD MY KIT ▸ / BRIEFING */
  closeBriefing() { if (!this.briefSeen) { this.briefSeen = true; this._changed(); } }
  openBriefing() { if (this.briefSeen) { this.briefSeen = false; this.browse(false); this._changed(); } }
  /** The player's rights on a slot, from MC's per-player policy (never computed locally). */
  slotRule(slot) {
    const p = this.policy; if (!p) return null;
    return (slot === 'primary' || slot === 'secondary' || slot === 'perk') ? (p[slot] || null) : null;   // A14: three rules
  }
  canPick(slot) {
    const p = this.policy, r = this.slotRule(slot);
    return !!(p && p.hud_select && r && r.choice === 'player' && this.phase === 'kitted' && !this.ended && this.kitOpen());
  }
  /** A14: what a pick would knock out of the OTHER slot, or null. Easy Reload (any perk with `effects.alt_reload`) takes the
   *  ALT button, so it cannot ride with a second weapon: picking it drops the secondary; picking a secondary drops it.
   *  The HUD asks for a second tap before sending (Tony 2026-09-04: "we should warn on that"). */
  conflictFor(slot, kind, id) {
    const lo = this.loadoutView();
    const alt = row => !!(row && row.effects && row.effects.alt_reload);
    if (slot === 'perk' && kind === 'perk' && lo.secondary && alt(this.perkRow(id))) return { slot: 'secondary', id: lo.secondary.weapon_id, name: lo.secondary.name };
    if (slot === 'secondary' && kind === 'weapon' && lo.perk && alt(lo.perk)) return { slot: 'perk', id: lo.perk.perk_id, name: lo.perk.name };
    return null;
  }
  /** A26 (S20, loadout.md §4.5): tap a row = EQUIP IT AND ARM IT for test-firing. There is no separate TRY IT
   *  any more, so every weapon tap would otherwise cost an MC round-trip and a `$WEAP` write on the gun —
   *  a player scrolling the rack with their thumb would fire off a dozen. So a weapon pick is DEBOUNCED here
   *  on the node (`PICK_DEBOUNCE_MS`): the row shows ⟳ at once, and only the LAST row tapped inside the window
   *  is sent, with `try:true`. Perks and NONE arm nothing and go straight out.
   *  `tryIt` is legacy and ignored for weapons (A26 made every weapon pick a try). Returns false if the slot isn't ours. */
  requestLoadout(slot, kind, id = null, tryIt = false) {   // eslint-disable-line no-unused-vars
    if (!this.canPick(slot)) { this.log(`pick refused locally: ${slot} is not player-choice`, 'le'); return false; }
    if (slot === 'primary' && kind !== 'weapon') return false;
    if (slot === 'secondary' && kind !== 'weapon' && kind !== 'none') return false;   // A14: perks have their own slot
    if (slot === 'perk' && kind !== 'perk' && kind !== 'none') return false;
    if (kind === 'none' && slot === 'primary') return false;
    // The debounce is ONE slot wide, and `pendingPick` moves with it. So a PRIMARY tap followed inside the
    // 400 ms window by a SECONDARY tap — or by a perk NONE, which sends immediately and nulls `_pickDue` on
    // the way past — used to DESTROY the first pick: nothing reached MC, nothing logged, and the player's
    // ⟳ row quietly became somebody else's ✓ (review 2026-09-12). The window exists to stop a thumb spamming
    // ONE rack; a pick in a DIFFERENT slot is the player having moved on, so it commits the old one first.
    if (this._pickDue && this._pickDue.slot !== slot) this._flushPick('slot switch');
    this.pendingPick = { slot, kind, id: kind === 'none' ? null : id, at: this.now() };
    this.loadoutAck = null;
    if (kind === 'weapon') this._pickDue = { slot, kind, id, at: this.now(), try: true };   // A26: coalesce; tick()/_flushPick sends it
    else { this._pickDue = null; this._sendPick({ slot, kind, id }); }
    this._changed(); return true;
  }
  /** The wire form of one pick (contracts §5 `loadout_request`). */
  _sendPick(p) {
    const body = { player_id: this.player && this.player.player_id, slot: p.slot, kind: p.kind };
    if (p.kind !== 'none') body.id = p.id;
    if (p.try && p.kind === 'weapon') body.try = true;
    this.report('loadout_request', body);
  }
  /** Send whatever pick is sitting in the debounce window, now. Called by tick() when the window elapses, and
   *  eagerly by anything that COMMITS the kit (closing the browser, readying up) so a pick is never dropped. */
  _flushPick(why) {
    const p = this._pickDue; if (!p) return false;
    this._pickDue = null;
    this.log(`pick sent (${why}): ${p.slot} ${p.kind} ${p.id || ''}`, 'lk');
    this._sendPick(p);
    this._changed(); return true;
  }
  /** A26: drop a queued pick that will never be sent (the kit locked under it). */
  _cancelPick() { this._pickDue = null; this.pendingPick = null; }
  /** A26: the HUD's way to commit a queued pick without closing the browser — switching the PRIMARY /
   *  SECONDARY / PERK tab leaves that rack behind, so the pick sitting in its window goes now. */
  commitPick(why = 'commit') { return this._flushPick(why); }
  browse(open) {
    open = !!open;
    if (this.browsing === open) return;
    if (!open) { this._flushPick('browser closed'); this.dismissTryout(); }   // A26: leaving the browser commits the last pick and retires the try-out panel (the gun stays armed — §4.5)
    this.browsing = open;
    this.report('loadout_browse', { player_id: this.player && this.player.player_id, open });
    this._changed();
  }
  _loadoutAck({ slot, ok, reason, dropped, loadout }) {
    if (loadout && this.player) this.player.loadout = loadout;   // MC's echo is the truth (applies on ok AND on a reject → reverts the optimistic row)
    // The ack names its SLOT, and only a pending pick for THAT slot is the one it answers. Clearing blind
    // let a perk ack retire a queued weapon's ⟳ (two slots can be in flight at once since the slot-switch
    // flush above), and stamped the ack's `key` from the wrong row — so a later refusal marked nothing and
    // the browser showed an equipped weapon MC had rejected (review 2026-09-12).
    const pk = this.pendingPick, mine = !!(pk && pk.slot === slot);
    this.loadoutAck = { slot, ok: !!ok, reason: reason || null, dropped: dropped || null, t: this.now(), key: mine ? (pk.kind === 'none' ? 'none' : `${pk.kind}:${pk.id}`) : null };   // A14: `dropped` = the other slot this pick knocked out
    if (dropped) this.log(`pick ${slot} dropped ${dropped.slot} ${dropped.id}: ${reason || ''}`, 'lk');
    if (mine) this.pendingPick = null;
    // F147/polish-loop pass 2: MC's ack lands BEFORE the `tutorial` message that actually writes the gun —
    // a real gap of up to ~250 ms during which the rack used to read a plain EQUIPPED (`tryoutArming` was
    // still null). Arm a PLACEHOLDER right here so SWITCHING… covers the whole gap, not just its tail;
    // `_tutorial` below fills in the real clip (and derives `gunSlot` from the actual frames, since the
    // placeholder cannot know it yet). `tab`/`kind` are carried purely for hud.js identity (polish-loop
    // pass 3): which RACK ROW this belongs to, so it is never confused with the gun-wire slot the ammo
    // confirmation itself keys on (pass 3: a try-out is ALWAYS written to gun slot 0 — compile.py's
    // `resolve(wid, 0)` — regardless of which rack tab the pick came from, so `gunSlot` can never tell a
    // primary pick from a secondary one; that is what `tab` is for).
    if (ok && mine && pk && pk.kind === 'weapon') { this.tryoutArming = { at: this.now(), clip: null, gunSlot: 0, tab: pk.slot, kind: pk.kind }; this.tryoutUnconfirmed = null; }
    this._changed();
  }
  /** DONE on the try-out panel: hide it (the gun stays armed until MC ends the try-out or the player readies). */
  dismissTryout() { if (this.tutorial && this.tutorialWeapon) { this.tryoutSeen = this.tutorialWeapon.weapon_id; this._changed(); } }
  /** Structured loadout for the HUD: catalog rows (or id-only stubs when the catalog hasn't arrived). */
  loadoutView() {
    const lo = (this.player && this.player.loadout) || {};
    const ws = lo.weapons || [];
    const stub = id => ({ weapon_id: id, name: String(id).replace(/_/g, ' ') });
    const wrow = id => ({ kind: 'weapon', ...(this.weaponRow(id) || stub(id)) });
    const primary = ws[0] ? wrow(ws[0].weapon_id) : null;
    const secondary = ws[1] ? wrow(ws[1].weapon_id) : null;
    // A14: the perk is its own slot beside the weapons
    const perk = lo.perk ? { kind: 'perk', ...(this.perkRow(lo.perk) || { perk_id: lo.perk, name: String(lo.perk).replace(/_/g, ' '), effects: {} }) } : null;
    return { primary, secondary, perk };
  }

  // F-4 (2026-09-13): a config push moves this player to 'lobby' whether or not they had readied up
  // yet (`_applyConfig` below never gates on `ready`), and until now `setReady` refused everywhere but
  // 'kitted' — a player whose kit-out window closed before they tapped READY UP (a host push that
  // landed mid-kit, or a re-push after an edit) had no way to ever ready for this match. The lobby
  // screen may ready up too, but ONLY once the kit is actually closed (`!this.kitOpen()` — the same
  // flag `_applyConfig`/`_assign` already read, set false by MC's own `_sync_kit_open` around a push):
  // while the kit is still open a phone belongs in 'kitted', and this stays a plain refusal there.
  setReady(ready) {
    // T2 INTEGRATION (A38 x A39, 2026-09-13): the two lanes met here. A38 parks a benched player in a
    // KITTED-shaped state, and F-4 above opened `setReady` to 'lobby' as well -- between them, BOTH of
    // the phases a benched phone can be sitting in now pass the test below. A38's own promise is "no
    // frames, no kit browsing, NO READY-UP", and the HUD honours it by never drawing the button; this
    // is the state machine honouring it, so a stale button, a restored `standby` that re-derived to
    // 'lobby' on relink, or a harness tap cannot ready a player MC has taken off the roster.
    if (this.standby) { this.log('cannot ready: you are on standby', 'le'); return false; }
    if (this.phase !== 'kitted' && !(this.phase === 'lobby' && !this.kitOpen())) return false;
    if (ready && !this.isSynced()) { this.log('cannot ready: clock not synced', 'le'); return false; }
    this.ready = !!ready;
    if (this.ready) { this._flushPick('ready up'); this.browse(false); }   // READY UP commits the kit — a pick still inside the A26 debounce goes now, then the browser closes (loadout.md §4.5)
    this.report('ready', { player_id: this.player && this.player.player_id, ready: this.ready });
    this._changed(); return true;
  }

  // ---------- start (M-START) ----------
  startAt(body) {
    // A40 (T2 review S2): a benched phone refuses the start outright. It still HOLDS the frames it took
    // before the bench, so `config_id` matches and every other guard below would have waved it through:
    // armed, then live, and the gun SPAWNS at T-0 -- for a player MC has taken off the roster and out of
    // the scorer. MC no longer sends one (the start is addressed now, not broadcast); this is the node's
    // own half of it, because a stale in-flight start, a re-hydrated schedule or a harness call must not
    // get through either. `_assign`/`_applyConfig`/`setReady` all already guard; this was the gap.
    if (this.standby) { this.log('start ignored: you are on standby', 'li'); return { ok: false, reason: 'standby' }; }
    this.browse(false);
    if (!body || !body.go_live_t) return { ok: false, reason: 'bad_start' };
    if (body.match_id && this.endedMatches.includes(body.match_id)) { this.log('start for an already-ended match — ignored', 'li'); return { ok: false, reason: 'match_ended' }; }
    if (this.start && body.seq != null && this.start.seq != null && body.seq < this.start.seq) return { ok: false, reason: 'stale_seq' };
    if (this.start && body.seq === this.start.seq && body.match_id === this.start.match_id) return { ok: true, state: this.phase, reason: 'noop' };
    if (this._panicked && body.match_id === this._panicked.match_id && (body.seq == null || this._panicked.seq == null || body.seq <= this._panicked.seq)) { this.log('start for a schedule I panicked out of — ignored (needs a newer seq)', 'li'); return { ok: false, reason: 'panicked' }; }
    this._panicked = null;
    if (this.config && body.config_id && body.config_id !== this.config.config_id) { this.log('start for a config I do not hold', 'le'); return { ok: false, reason: 'stale_config' }; }
    this.start = { match_id: body.match_id, go_live_t: body.go_live_t, config_id: body.config_id, seq: body.seq, countdown_s: body.countdown_s };
    this._prevRem = null;               // fresh schedule: runway cue edges re-arm
    const newMatch = body.match_id !== this.matchId;
    // a new match: last match's K/A/board and RESULT must not show on the first DOWN, and its spawn-kill
    // escalation must not carry into this one (review finding, 2026-09-19: a re-sent start for the SAME
    // match -- a bumped seq, a resumed schedule -- must never reset a down-warning level already earned)
    if (newMatch) { this.score = null; this.scoreAt = null; this.result = null; this.resultAt = 0; this.endedAt = 0; this._downWarn = 1; this._timedLifeAt = null; }
    this.matchId = body.match_id; this.cuesFired = new Set(); this.shots = 0; this.deaths = 0; this.ended = false; this._resyncRevive = false;
    this._cure = null; this._queryAt = 0; this._cureLife = null; this._cureAt = 0; this._pollAt = 0; this._probedLife = null; this.cure = null;   // F264: a new match owes the last one's gun nothing
    this.kitLocked = false;             // A27: the lock notice is spent the moment the countdown starts — it must never lead the NEXT lobby
    // A NEW match supersedes any in-flight reconnect resync of the OLD one. Without this the resync
    // stays set, the T-0 spawn (guarded on `!this.resync`) never runs, and the gun sits alive-with-0-hp
    // until the player pulls the trigger (bench 2026-09-04, S7). Clear it so the new match spawns clean.
    if (this.resync) { this.log('new match — clearing the old resync so it spawns clean', 'li'); this.resync = null; }
    if (this.reconciling) { this.log('new match — clearing the in-flight rejoin reconcile', 'li'); this.reconciling = null; }
    // A new match must SPAWN even if the node is already `live` from a rejoin of the OLD match. Without
    // this reset, startAt skipped re-arming from `live` and resumeSchedule returned `live` early — the
    // T-0 spawn never ran and the gun sat alive-with-0-hp (bench 2026-09-04, S7, on hardware). Drop the
    // stale live/down state so the new match re-arms → spawns.
    if (newMatch) { this.spawned = false; this.alive = false; this.deadAt = 0; this.killedBy = null; this._resetHill(); }   // game 2 must not inherit game 1's owner, tally or warnings
    this._turned = false;               // last match's infection flip must not score this one as "turned" (polish 2026-09-04)
    if (this.phase === 'lobby' || this.phase === 'kitted' || this.phase === 'armed' || (newMatch && this.phase === 'live')) this._set('armed');
    this._save();
    return this.resumeSchedule();
  }

  /** E1/E5/E9: reconcile the persisted schedule against synced time (never spawn a possibly-live gun blindly). */
  resumeSchedule() {
    if (!this.start) return { ok: false, reason: 'no_schedule' };
    // No gun linked: leave the phase alone (IDLE keeps its SET MY GUN screen); onBleConnected re-derives it.
    if (!this.bleUp) return { ok: false, reason: 'gun_not_linked' };
    const now = this.now(), T = this.goLiveT;
    if (this.phase === 'live') return { ok: true, state: 'live' };
    if (now < T) { if (this.phase !== 'armed') this._set('armed'); return { ok: true, state: 'armed' }; }
    if (this.endT && now >= this.endT) { this.log('match already over on resume', 'li'); this._endLocal('expired-on-resume'); return { ok: false, reason: 'match_over' }; }
    if (this.spawned) { this._set('live'); return { ok: true, state: 'live' }; }
    // T-0 passed and we never spawned: grace / hot-join (E5).
    const late = now - T;
    this.log(late <= C.LATE_ARM_GRACE_MS ? `late spawn (+${late} ms, grace)` : `hot-join (+${Math.round(late / 1000)} s)`, 'lk');
    this._spawn(late <= C.LATE_ARM_GRACE_MS);
    return { ok: true, state: 'live', reason: late <= C.LATE_ARM_GRACE_MS ? 'grace' : 'hot_join' };
  }

  /** A11.6 headset: write a [frame, hold_s] sequence to the headset (frames.headset.*), each step after
   *  the previous one's hold. A newer sequence supersedes an older one: a hit flash that lands while the
   *  start flash is still running simply takes over (the last frame written wins on the hardware). */
  _headset(seq, why) {
    if (!seq || !seq.length) return;
    // F68 × A11.6/A47: the strip has ONE owner at a time, and it is whoever last painted it deliberately.
    // A spawn/revive flash, a hit flash, an event burst, a role change and the operator's FORCE RESPAWN all
    // come through here, so stamping the repaint clock here makes `_teamRepaintTick` a BACKSTOP: it only
    // runs when nothing else has painted the headset for TEAM_REPAINT_MS. The two can then never fight on a
    // 5 s beat, and the repaint still recovers a strip that a native near-miss flash darkened.
    if (this.phase === 'live') this._lastTeamRepaintAt = this.now();
    const gen = (this._hsGen = (this._hsGen || 0) + 1);
    const lg = (this._lightGen = this._lightGen || 0);   // teardown snapshot: a delayed step checks this too, alongside `gen`'s supersession check
    let t = 0;
    for (const step of seq) {
      const frame = step[0], hold = Math.max(0, Math.round((step[1] || 0) * 1000));
      if (t === 0) this._write([frame], `headset ${why}`);
      else this.delay(t, () => { if (this._hsGen === gen && this._lightGen === lg) this._write([frame], `headset ${why}`); });
      t += hold;
    }
  }
  /** A11.7: take the gun body `after_spawn_s` after a spawn/revive: blank (stops the firmware breathing), then the
   *  rest frame. Inside the spawn burst the blank does not take -- the spawn animation re-enables the breathing
   *  (bench ladder 2026-09-04: +1.0 s and +1.5 s breathing, +2.0 s solid; 2.5 s shipped). Cancelled by a death or
   *  another spawn before it fires. */
  _gunTake() {
    const g = this.frames && this.frames.gun;
    this._gunTaken = false; this._gunBand = null;
    // A16: a fresh life starts with no readout — any hold from the last life is dead the moment `_gunTaken`
    // drops false (the tick-poll below is gated on it), but null the frame too so a reload glance before
    // the take completes has nothing stale to show.
    this._readoutFrame = null; this._readoutHoldActive = false; this._readoutLastWriteAt = null; this._readoutLastPool = null;
    // A16.3: a revive cancels any drop/gain animation from the last life outright (bar-spec: "Cancel
    // everything ... on revive") -- bump `_roGen` so a stray scheduled step from the old life cannot land.
    this._roGen = (this._roGen || 0) + 1; this._roLevel = null; this._roPool = null; this._roAnimating = false; this._roBlinkAt = 0; this._roBlinkOn = false;
    // ⚠ The PER-POOL map must be cleared too, not just `_roLevel`. Missing this made the "a life's first
    // paint animates from FULL" rule silently apply to the first life only: from life 2 on, any pool hit in
    // the PREVIOUS life still had an entry here, so its next drop animated from wherever it ended last life.
    // `stage.py` clears and reseeds at spawn, so the bench would have looked right while the phone did not --
    // the exact failure this map was added to fix, reintroduced in the other direction. Caught in the polish
    // loop's final pass, 2026-09-07, by replaying a second life rather than by reading the code.
    this._roLevels = {}; this._roLastStartAt = null;
    if (!g || !Array.isArray(g.take) || !g.take.length) return;
    // F86: `gun.take` was compiled for the ARMING team. After an infection flip this gun is on another
    // team, and taking it with the old frames painted the old colour back over a body the firmware had
    // just moved -- so the take is looked up by the team we are on NOW when MC shipped one for it.
    const flipTake = this.frames.team_flip_take && this.teamTid != null && this.frames.team_flip_take[String(this.teamTid)];
    const take = (Array.isArray(flipTake) && flipTake.length) ? flipTake : g.take;
    const rest = take === g.take ? g.rest : take[take.length - 1];
    this._gunRestFrame = rest;   // the readout's revert-to-rest (below) must paint THIS team's rest, not the arming team's
    const life = (this._gunLife = (this._gunLife || 0) + 1);
    const lg = (this._lightGen = this._lightGen || 0);   // teardown snapshot: a blank+paint must not land after _endLocal/panic writes $CLEAR/$SP,99
    this.delay(Math.round((g.after_spawn_s || 2.5) * 1000), () => {
      if (life !== this._gunLife || this._lightGen !== lg || !this.alive) return;
      this._write(take, 'gun take'); this._gunTaken = true; this._gunBand = rest; this._readoutFrame = rest;   // A16: the strip now shows `rest` — dark until a pool change paints a band
    });
  }
  /** F113 (2026-09-11) — blank the gun strip at death, overturning A16 §5's "no gun write here".
   *
   *  A16 §5 left the strip wherever the native hit flash put it, on the assumption that that was somewhere
   *  sensible. The field killed the assumption: "killed with sniper rifle, 2 shots. it took down to 1 led of
   *  purple and then dead. while dead it stayed at 1 purple." A fast kill lands DEATH in the middle of the
   *  drop animation, A16.3 cancels the animation outright, nothing is written after it — so the strip freezes
   *  at a partial level and reads as "a sliver of health left" for the whole death. The bigger the damage per
   *  shot the worse it looks, which is why a sniper shows it and a 13-hit rifle mostly does not.
   *
   *  ONE frame, the same `$GLED,,,,5,,,*` blank `gun.take` already opens with (led-language.md §3.2; gate 5
   *  applies empty colour tokens = OFF, and it is also what stops the firmware breathing). NOT `$HLED` —
   *  the A16 hard rule that `$HLED,,6` is never sent in play is untouched here, and nothing on the HEADSET is
   *  written at death at all, so the firmware's own out-flash still runs (that is the whole point of §3.2).
   *  The repaint on the way back is `_gunTake`'s, unchanged: blank + rest, `after_spawn_s` after `$SPAWN`.
   *
   *  A game whose gun is `in_play: 'native'` ships no frames and no blank: the strip was never ours, so it is
   *  not ours to turn off either. */
  _gunBlankOnDeath() {
    const g = this.frames && this.frames.gun;
    if (!g || !g.blank) return;
    this._gunTaken = false; this._gunBand = null;   // nothing is painted any more; a later rest paint must not be suppressed as a no-op
    this._write([g.blank], 'gun blank (down)');
  }
  /** A11.7: the gun body's resting frame when the game owns it (frames.gun; absent = firmware breathing).
   *  team/dark: a fixed frame; health: the band for the current hp (bands highest-first, [fraction, frame]). */
  _gunRest() {
    const g = this.frames && this.frames.gun; if (!g || !g.rest) return null;
    if (g.in_play !== 'health' || !Array.isArray(g.bands) || !g.bands.length) return g.rest;
    const frac = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    const band = g.bands.find(b => frac > b[0]) || g.bands[g.bands.length - 1];
    return band[1];
  }
  /** A16 §3.1/§5: on every `$HP`, repaint the transient pool readout for the innermost pool that moved
   *  (or, when the bundle has no `gun.readout`, fall back unchanged to the pre-A16 `gun.bands` health-only
   *  paint). Replaces `_gunHealthPaint` as the one entry point `_onHp` calls. */
  _gunPoolPaint(movedPool) {
    const g = this.frames && this.frames.gun; if (!g) return;
    if (g.readout && Array.isArray(g.readout.pools) && g.readout.pools.length) { if (movedPool) this._gunReadoutPaint(movedPool); return; }
    // legacy path (readout absent): unchanged health-band behaviour, keyed off health only
    if (g.in_play !== 'health' || !Array.isArray(g.bands) || !g.bands.length || !this._gunTaken) return;
    if (this.phase !== 'live' || !this.alive || !this.spawned) return;
    const f = this._gunRest(); if (!f || f === this._gunBand) return;
    this._gunBand = f; this._write([f], 'gun health hp');
  }
  /** A16 §5: the current band for one `gun.readout.pools[]` entry — highest band whose fraction the
   *  pool's level/max exceeds (bands ordered highest-first, same `frac > threshold` rule as `_gunRest`). */
  _readoutBand(entry) {
    const level = entry.pool === 'health' ? this.hp : entry.pool === 'armor' ? this.armor : this.shield;
    const frac = entry.max > 0 ? level / entry.max : 0;
    const bands = entry.bands || [];
    return bands.find(b => frac > b[0]) || bands[bands.length - 1] || null;
  }
  /** A16.3 (bar-spec 2026-09-07): the 7-level (0-6) reading for one `gun.readout.pools[]` entry that
   *  carries `levels` — `round(fraction * 6)` clamped to [0,6], floor-clamped to 1 while the pool has
   *  anything left so "1 HP" and "dead" never render the same (poolgauge._segments' rule, extended). */
  _readoutLevel(entry) {
    const value = entry.pool === 'health' ? this.hp : entry.pool === 'armor' ? this.armor : this.shield;
    const frac = entry.max > 0 ? value / entry.max : 0;
    let level = Math.max(0, Math.min(6, Math.round(frac * 6)));
    if (level === 0 && value > 0) level = 1;
    return level;
  }
  /** A16.5: the node's own view of its pools, keyed the way `handoverPool` expects. Mirrors
   *  `stage.py`'s `_pool_values`. */
  _poolValues() { return { shield: this.shield, armor: this.armor, health: this.hp }; }
  /** A16.5: names of every pool the bundle configured a readout for (`bands` or `levels`, either shape) --
   *  `handoverPool` only hands over to a pool the current loadout actually has. Mirrors `stage.py`'s
   *  `_readout_configured`. */
  _readoutConfiguredPools() {
    const readout = this.frames && this.frames.gun && this.frames.gun.readout;
    return (readout && Array.isArray(readout.pools) ? readout.pools : []).map(p => p.pool);
  }
  /** A16 §3.1: write the moved pool's band ONLY if it differs from the frame currently on the strip.
   *  Restarts the hold on every real change; a change that would repaint within READOUT_COALESCE_MS of the
   *  last WRITE is dropped (never queued, same shape as `_pain`'s PAIN_GAP_MS) but still restarts the hold,
   *  so a flurry of hits holds the last-shown band rather than flickering through several. The hold itself
   *  is tick()-polled (`_gunReadoutTick`), not `this.delay`, because later changes must be able to restart
   *  it — a one-shot delayed callback cannot be un-scheduled. */
  _gunReadoutPaint(pool) {
    if (this.phase !== 'live' || !this.alive || !this.spawned || !this._gunTaken) return;
    const g = this.frames.gun, readout = g.readout;
    const entry = readout.pools.find(p => p.pool === pool); if (!entry) return;
    // A16.3: a `levels` entry (the 7-level bar + drop/gain animation) is a completely separate path; a
    // `bands` entry (below) is untouched by any of this — the graceful-degradation contract in full.
    if (Array.isArray(entry.levels) && entry.levels.length === 7) { this._gunReadoutPaintLevels(readout, entry, pool); return; }
    if (!Array.isArray(entry.bands) || !entry.bands.length) return;
    const band = this._readoutBand(entry); if (!band) return;
    this._readoutLastPool = pool;   // A16: which pool a reload should glance -- the one that most recently actually moved, not a fresh "is it below max" guess (shield defaults to 0 and would always look "damaged")
    const frame = band[1];
    if (frame === this._readoutFrame) return;   // no visible change — nothing to write, hold left alone
    const now = this.now(), holdMs = Math.max(0, Math.round((readout.hold_s != null ? readout.hold_s : 4) * 1000));
    if (this._readoutLastWriteAt != null && now - this._readoutLastWriteAt < READOUT_COALESCE_MS) {
      this._readoutHoldStartAt = now; this._readoutHoldMs = holdMs; this._readoutHoldActive = true;   // coalesced: restart the hold, drop the write
      return;
    }
    this._write([frame], `readout ${pool}`);
    this._readoutFrame = frame; this._readoutLastWriteAt = now;
    this._readoutHoldStartAt = now; this._readoutHoldMs = holdMs; this._readoutHoldActive = true;
  }
  /** A16.3 (bar-spec 2026-09-07): entry point for a `levels`-table pool. Skips a true no-op (same pool,
   *  same level, already displayed — covers a partial level mid-blink too, since `_roLevel` names the
   *  level, not the current half of its blink); otherwise (re)starts the drop/gain animation from whatever
   *  level is CURRENTLY on the strip. A change mid-animation lands here again and restarts it from there —
   *  never queued, never a second one running (bar-spec: "cancels it and restarts from the currently
   *  displayed level"). First paint of a life (`_roLevel` still null) has no "from" to drop out of, so it
   *  settles straight onto the target level with no animation. */
  _gunReadoutPaintLevels(readout, entry, pool) {
    const level = this._readoutLevel(entry);
    this._readoutLastPool = pool;
    // A16.3 polish (2026-09-07): the "from" level is tracked PER POOL. It used to be one shared
    // `_roLevel`, so if the strip had last shown a different pool (shield at 4, say) and a later hit
    // finally broke into health, health animated from SHIELD's level -- a wrong-sized drop, or none at
    // all when the numbers happened to match. `stage.py` already kept a per-pool map, so the bench would
    // have looked right while the phone players actually use did not.
    this._roLevels = this._roLevels || {};
    const shown = this._roPool === pool ? this._roLevel : this._roLevels[pool];
    if (this._roPool === pool && this._roLevel === level) return;
    // Photosensitivity: every retrigger replays a dark->lit transition, and the ceiling is 3 light-ups in
    // any one second (poolgauge's own "looks like it's having a seizure" warning). Under automatic fire a
    // level can change several times a second, so coalesce: inside the window, retarget WITHOUT replaying
    // the lead + all-off blink -- step straight to the new level from where the strip already is.
    const now = this.now();
    const rapid = this._roLastStartAt != null && (now - this._roLastStartAt) < (readout.min_gap_ms != null ? readout.min_gap_ms : 400);
    this._roLastStartAt = now;
    // A16.3 (polish 2026-09-07): on a life's FIRST paint for a pool there is no `_roLevel` yet. Settling
    // straight in would mean the first hit of EVERY life has no drop animation -- health and armour start
    // full, so that is the commonest case there is, and it is exactly the moment the animation is for
    // ("show current health in one blink then show it dropping" -- Tony). It also made the bench stage lie:
    // stage.py seeds its own per-pool state at spawn and DID animate here, so the operator would have been
    // shown a sequence the phone never plays. Animate from the pool's FULL level instead (the level it was
    // sitting at, undisplayed, before this change), which is what the stage does.
    const from = shown != null ? shown : this._readoutFullLevel(entry, pool);
    this._readoutAnimStart(readout, entry, pool, from, level, rapid);
  }
  /** A16.3: the level a pool sits at when a life starts, used as the "from" for its first animation.
   *  Health and armour spawn FULL (top level); shield spawns EMPTY on real hardware (it is IR-granted
   *  only, P16 -- and F41: the fake tagger wrongly reports 70 there, so do not infer this from telemetry). */
  _readoutFullLevel(entry, pool) {
    const top = Array.isArray(entry.levels) ? entry.levels.length - 1 : 0;
    return pool === 'shield' ? 0 : top;
  }
  /** A16.3: drive the lead/blink-gap/step-down/settle sequence (or, for a GAIN, straight into stepping
   *  with no lead/gap) from `from` to `to` on `entry`. Every scheduled step is gated on a fresh `_roGen`
   *  (bumped here, exactly the `_hsGen` pattern) so a later change, a death or a revive invalidates it —
   *  see the explicit bumps in `_death`/`_gunTake` — plus `_lightGen`, shared with every other delayed
   *  light write, for the teardown case (end/panic/BLE drop). Writes only frames the bundle supplied
   *  (`entry.levels[l][0/1]`); it never composes a `$GLED` itself (A4.2). */
  _readoutAnimStart(readout, entry, pool, from, to, rapid) {
    const gen = (this._roGen = (this._roGen || 0) + 1);
    const lg = (this._lightGen = this._lightGen || 0);
    this._roPool = pool; this._roAnimating = true;
    const leadMs = Math.max(0, Math.round(readout.lead_ms != null ? readout.lead_ms : 180));
    const gapMs = Math.max(0, Math.round(readout.blink_gap_ms != null ? readout.blink_gap_ms : 80));
    const stepMs = Math.max(0, Math.round(readout.step_ms != null ? readout.step_ms : 120));
    const ok = () => this._roGen === gen && this._lightGen === lg && this.alive;
    const paint = (lvl, why) => {
      const f = entry.levels[lvl] && entry.levels[lvl][0];
      this._roLevel = lvl;
      (this._roLevels = this._roLevels || {})[pool] = lvl;   // per-pool memory: what THIS pool last showed
      if (f) { this._readoutFrame = f; this._write([f], `readout ${pool} anim ${why}`); }
    };
    // A16.5 (2026-09-09, found on the gun): the drain has reached its target. If that target is level 0
    // and something inward still has value, hand over and show THAT pool's own level instead of settling
    // into (and holding, for the full `hold_s`) an all-dark strip -- mirrors `stage.py` `_level_animate`'s
    // post-loop handover exactly, including the one-`step_ms`-beat pause first (so "it is gone" registers
    // before the handover paints) and painting the inner pool SOLID -- it did not change, so it gets no
    // drop animation of its own. Anything above zero settles normally, unchanged from before A16.5.
    const settle = lvl => {
      if (!ok()) return;
      if (lvl === 0) {
        const nxt = handoverPool(pool, this._poolValues(), this._readoutConfiguredPools());
        const inner = nxt !== pool && readout.pools.find(p => p.pool === nxt);
        if (inner && Array.isArray(inner.levels) && inner.levels.length === 7) {
          this.delay(stepMs, () => {
            if (!ok()) return;
            const target = this._readoutLevel(inner);
            const f = inner.levels[target] && inner.levels[target][0];
            this._roPool = nxt; this._roLevel = target;
            (this._roLevels = this._roLevels || {})[nxt] = target;
            // The strip now shows the HANDED-OVER pool, not the one that emptied -- a reload glance must
            // re-show what is actually on the strip (health), not re-derive the emptied pool (armor at 0),
            // which would repaint the very dark frame this feature exists to avoid. `stage.py` has no
            // reload path to expose this gap; the phone does, so this line is a deliberate addition on top
            // of the mirror, not a divergence from it.
            this._readoutLastPool = nxt;
            if (f) { this._readoutFrame = f; this._write([f], `readout ${nxt} handover from ${pool}`); }
            this._readoutSettle(gen, lg, readout, inner, nxt, target);
          });
          return;
        }
      }
      this._readoutSettle(gen, lg, readout, entry, pool, lvl);
    };
    const step = cur => {
      if (!ok()) return;
      const next = cur < to ? cur + 1 : cur > to ? cur - 1 : cur;
      paint(next, `step ${next}`);
      if (next === to) { settle(to); return; }
      this.delay(stepMs, () => step(next));
    };
    if (to === from) { paint(to, 'settle'); settle(to); return; }
    if (to > from) { step(from); return; }   // gain: same steps, no initial lead/blink-gap
    // `rapid` = another change inside the min gap. Step straight down from where the strip already is,
    // skipping the lead freeze and the all-off blink: replaying those under automatic fire is what would
    // put more than three light-ups in a second (the photosensitivity ceiling), and the information --
    // the bar getting shorter -- is carried by the steps, not by the blink.
    if (rapid) { step(from); return; }
    // drop: freeze the level we were AT solid for lead_ms (this is Tony's "show current health in one
    // blink" -- it also stops a running blink outright, since the from-level may have been blinking), one
    // all-off blink for blink_gap_ms, then step down.
    paint(from, 'from');
    this.delay(leadMs, () => {
      if (!ok()) return;
      const off = entry.levels[0] && entry.levels[0][0];
      if (off) { this._readoutFrame = off; this._write([off], `readout ${pool} anim blank`); }
      this.delay(gapMs, () => step(from));
    });
  }
  /** A16.3: settle on `level` -- arms the ordinary `hold_s` timer (`_gunReadoutTick` takes over from here,
   *  exactly as it does for a `bands` paint) and, at a PARTIAL level (`entry.levels[level][1]` present),
   *  arms the alternating top-segment blink. The blink itself is tick()-polled (`_gunReadoutTick`), NOT a
   *  self-rescheduling `this.delay` chain -- same reasoning as the hold: it must be repeatedly restartable
   *  by a later settle, and (proven the hard way) a `this.delay` that re-schedules itself recurses forever
   *  under a test harness whose `delay` runs its callback inline. */
  _readoutSettle(gen, lg, readout, entry, pool, level) {
    if (!(this._roGen === gen && this._lightGen === lg && this.alive)) return;
    this._roAnimating = false;
    const now = this.now(), holdMs = Math.max(0, Math.round((readout.hold_s != null ? readout.hold_s : 4) * 1000));
    this._readoutLastWriteAt = now; this._readoutHoldStartAt = now; this._readoutHoldMs = holdMs; this._readoutHoldActive = true;
    const pair = entry.levels[level];
    if (pair && pair[1]) { this._roBlinkOn = false; this._roBlinkAt = now; }   // the solid half is already on the strip from the settling step
    else this._roBlinkAt = 0;   // whole level (6/4/2/0): no blink
  }
  /** A16 §3.1 reload: paint the CURRENT readout for `reload_glance_s` — recomputed fresh (in case the pool
   *  has since changed further) for whichever pool most recently actually moved this life, NOT the
   *  last-shown frame, so a reload glances the real state even after the ordinary hold already reverted to
   *  rest. Deliberately NOT "whatever pool is below its max": shield spawns at 0 by hardware default
   *  (bench 2026-08-27) and would always look "damaged" against a configured max, even for a loadout that
   *  never grants any. A no-op when nothing has moved this life (nothing to glance) or the bundle has no
   *  readout. */
  _gunReadoutReloadGlance() {
    const g = this.frames && this.frames.gun, readout = g && g.readout;
    if (!readout || !this._gunTaken) return;
    if (this.phase !== 'live' || !this.alive || !this.spawned) return;
    const poolName = this._readoutLastPool; if (!poolName) return;
    const entry = readout.pools.find(p => p.pool === poolName); if (!entry) return;
    let frame;
    // A16.3: a `levels` pool glances its current level SOLID -- the glance is a plain peek, not another
    // animation, so it also cancels any drop/gain/blink in flight (`_roGen` bump) exactly as it already
    // overrides the ordinary `bands` hold below.
    if (Array.isArray(entry.levels) && entry.levels.length === 7) {
      const level = this._readoutLevel(entry); const pair = entry.levels[level]; frame = pair && pair[0];
      if (!frame) return;
      this._roGen = (this._roGen || 0) + 1; this._roAnimating = false; this._roPool = poolName; this._roLevel = level; this._roBlinkAt = 0; this._roBlinkOn = false;
      // the glance is what is now DISPLAYED for this pool, so record it per pool too -- otherwise a glance
      // that cuts an animation short leaves the map holding an intermediate step, and the next drop on this
      // pool (after some other pool has been shown) animates from a level that was never on the strip.
      (this._roLevels = this._roLevels || {})[poolName] = level;
    } else {
      const band = this._readoutBand(entry); if (!band) return; frame = band[1];
    }
    this._write([frame], 'readout reload glance');
    const now = this.now();
    this._readoutFrame = frame; this._readoutLastWriteAt = now;
    this._readoutHoldStartAt = now; this._readoutHoldMs = Math.max(0, Math.round((readout.reload_glance_s != null ? readout.reload_glance_s : 2) * 1000)); this._readoutHoldActive = true;
  }
  /** A16 §5: reverts the strip to `gun.rest` once the current readout/glance hold has run out. Called from
   *  tick() (the same pattern as `_downRearm`/`_reassertDeathBlink`) so a later pool change or reload can
   *  restart the hold before it fires. Gated on alive/spawned/taken/live exactly as the paint call is.
   *  A16.3: also skipped outright while `_roAnimating` -- the drop/gain animation owns the strip until
   *  `_readoutSettle` arms the real hold, and an in-flight step must never be cut off by this poll. */
  _gunReadoutTick(now) {
    const g = this.frames && this.frames.gun, readout = g && g.readout;
    if (!readout || !this._readoutHoldActive || !this._gunTaken || this._roAnimating) return;
    if (!this.alive || !this.spawned || this.phase !== 'live') return;
    // A16.3: the hold-expiry check runs FIRST -- an expiry must win outright over a blink toggle due in
    // the very same tick (otherwise a blink write and the revert-to-rest write would both land here).
    if (now - this._readoutHoldStartAt >= this._readoutHoldMs) {
      this._readoutHoldActive = false; this._roBlinkAt = 0;
      const rest = this._gunRestFrame || g.rest;   // F86: after an infection flip `g.rest` is the arming team's colour
      if (rest && this._readoutFrame !== rest) { this._readoutFrame = rest; this._write([rest], 'readout rest'); }
      return;
    }
    // The partial-level blink, tick()-polled (see `_readoutSettle`) -- runs only while `_roBlinkAt` is
    // armed, and stops on its own the instant the hold above expires.
    if (this._roBlinkAt && this._roPool != null) {
      const entry = readout.pools.find(p => p.pool === this._roPool);
      const pair = entry && Array.isArray(entry.levels) ? entry.levels[this._roLevel] : null;
      if (pair && pair[1]) {
        const blinkMs = Math.max(0, Math.round(readout.blink_ms != null ? readout.blink_ms : 400));
        if (now - this._roBlinkAt >= blinkMs) {
          this._roBlinkOn = !this._roBlinkOn;
          const f = this._roBlinkOn ? pair[1] : pair[0];
          if (f) { this._readoutFrame = f; this._write([f], `readout ${this._roPool} blink`); }
          this._roBlinkAt = now;
        }
      } else this._roBlinkAt = 0;
    }
  }
  /** The headset's resting frame between events (dark by default, or the team colour). */
  _headsetRest() { const h = this.frames && this.frames.headset; return h && h.rest ? [[h.rest, 0]] : null; }
  /** A16 §3.3: the sequence for one held role. `carrier` is tid-keyed (whose flag/objective); the rest
   *  (infected/vip/beacon/extracted) are flat. Falls back to the pre-A16 `headset.carrier` table for
   *  `carrier` when `headset.role` is absent — the only role that ever existed before it. */
  _roleSeq(name, tid) {
    const h = this.frames && this.frames.headset; if (!h) return null;
    if (h.role) {
      const entry = h.role[name];
      // A role sequence is either FLAT (carrier is white now — team colours are identity, §3.3 — as are
      // vip/beacon/extracted) or tid-keyed (infected: solid in the turned-into team's colour, one entry
      // per possible team). Branch on the actual shape rather than hard-coding it per role name, so a
      // later bundle reshuffling which roles are flat vs keyed does not silently break the lookup.
      if (Array.isArray(entry)) return entry;
      if (entry && typeof entry === 'object') return entry[String(tid)] || null;
      return null;
    }
    // legacy path (headset.role absent): only `carrier` ever existed, and it WAS tid-keyed (the flag's colour)
    return name === 'carrier' ? ((h.carrier && h.carrier[String(tid)]) || null) : null;
  }
  /** A16 §3.3: the headset holds AT MOST ONE role at a time. `on` assigns it (superseding whatever role
   *  was active — a new one simply overwrites `_activeRole`); `off` ends it and returns to `headset.rest`,
   *  but only if THAT role is the one currently active (a stale "off" for a role that already ended, e.g.
   *  a race with a hit re-assert, must not clobber a newer one). The re-assert-after-a-hit call is
   *  `_roleSeq` + `_headsetFlash` from `_onHp`, not this method — a role is not re-WRITTEN every tick,
   *  only when something (assignment, end, or a hit) actually changes what should be on the lamp. */
  _setRole(name, on, tid) {
    const h = this.frames && this.frames.headset; if (!h) return;
    if (on) {
      const seq = this._roleSeq(name, tid); if (!seq) return;
      this._activeRole = { name, tid: tid != null ? tid : null };
      if (name === 'carrier') this.carrying = tid;   // keeps the pre-A16 `carrying` field (read by state()/other callers) in sync
      this._headset(seq, `role ${name}${tid != null ? ' ' + tid : ''}`);
    } else if (this._activeRole && this._activeRole.name === name) {
      this._activeRole = null;
      if (name === 'carrier') this.carrying = null;
      this._headset(this._headsetRest(), `role ${name} off`);
    }
  }
  /** Back-compat entry point: flag/objective carrier blink, now routed through the general role mechanism
   *  (§3.3). Every existing caller (`alert()`'s objective_taken/objective_scored/flag_returned) is unchanged. */
  _carrier(on, tid) { this._setRole('carrier', on, tid); }
  /** led-language.md §2 (safety: bursts ≥ 1 s apart) / §5: node-initiated headset FLASH sequences (the hit flash, a role re-assert after a hit) share the
   *  gun burst's 1 s minimum — a burst weapon plus the firmware's own hit flash could otherwise exceed 3
   *  flashes/s on one lamp. Dropped, never queued (the `_pain`/PAIN_GAP_MS shape). The down rearm and the
   *  low-health alert bypass this entirely (they call `_headset`/`_write` directly) and must NEVER be gated. */
  _headsetFlash(seq, why) {
    const now = this.now();
    if (this._lastHeadsetFlashAt != null && now - this._lastHeadsetFlashAt < EVENT_MIN_GAP_MS) return;
    this._lastHeadsetFlashAt = now;
    this._headset(seq, why);
  }
  /** F68 (tick(), while LIVE+spawned+alive): a plain interval repaint of whatever the headset SHOULD be
   *  showing right now -- the active role's colour, or the team rest colour -- because an accuracy-model
   *  miss (S42) sends no `$HIR` and no `$HP` at all, so the hit-driven repaint in `_onHp` never runs and
   *  the gun's own native near-miss flash is free to darken the headset with nothing on the wire to react
   *  to. Deliberately NOT gated behind `EVENT_MIN_GAP_MS`/`_headsetFlash`'s rate limit -- `TEAM_REPAINT_MS`
   *  is already far above any hit-driven repaint rate, so double-gating would only slow the recovery a
   *  miss needs -- and deliberately a plain STATIC write (`_write`, not `_headset`'s stepped sequence),
   *  so it can never collide with a running flash burst's own delayed steps. */
  _teamRepaintTick(now) {
    if (this.phase !== 'live' || !this.spawned || !this.alive || this.tutorial) return;
    if (this._lastTeamRepaintAt != null && now - this._lastTeamRepaintAt < TEAM_REPAINT_MS) return;
    this._lastTeamRepaintAt = now;
    const hs = this.frames && this.frames.headset; if (!hs) return;
    const role = this._activeRole, roleSeq = role && this._roleSeq(role.name, role.tid);
    if (roleSeq && roleSeq.length) this._write([roleSeq[roleSeq.length - 1][0]], 'F68 team repaint (role)');
    else if (hs.rest && hs.in_play === 'team') this._write([hs.rest], 'F68 team repaint');
  }
  /** led-language.md §3.1 / §5 ("the respawn white flash is scheduled ≥ 1.0 s after `$SPAWN`"): the white
   *  "you're live" flash is scheduled a full second after `$SPAWN` — never inline —
   *  because `$SPAWN` itself clears the headset and can swallow a flash written any sooner (the old ~50 ms
   *  offset; +1.0 s is the only measured-good one, led-language.md §3.2 D). Used for `start` and `respawn`. */
  _headsetDelayed(seq, why, delayMs = 1000) {
    if (!seq || !seq.length) return;
    const lg = (this._lightGen = this._lightGen || 0);
    this.delay(delayMs, () => { if (this._lightGen === lg && this.alive) this._headset(seq, why); });
  }

  /** A11 presentation event: the bundle's `leds[kind]` burst (frames with holds) + `cues[kind]` sound.
   *  The burst is the hardware-tuned three-flash pattern (2026-09-03) and MUST NOT be repainted or
   *  extended -- a fourth flash in a second is the epilepsy line; so events closer than
   *  EVENT_MIN_GAP_MS apart drop their lights (the sound still plays). */
  _event(kind) {
    const f = this.frames; if (!f) return;
    const pick = this._pickCue(kind);
    if (pick.frame) this._write([pick.frame], `event cue ${kind}${pick.tag}`);
    this._eventLeds(kind);
  }
  /** A15 (Tony 2026-09-06: "the kill confirm sound and taunts should be selected on single kill at random"):
   *  an event whose sound is a `voice:<role>` with several takes ships them all in `cue_pools[kind]`;
   *  pick one at random per event so the gun does not say the same line every time. `cues[kind]` (one
   *  frame) is the pre-A15 shape and the fallback, so an older bundle plays exactly as before. */
  _pickCue(kind) {
    const f = this.frames; if (!f) return { frame: null, tag: '' };
    const single = f.cues && f.cues[kind];
    if (single === '') return { frame: null, tag: '' };   // deliberately mute (announcer off): the pool does not override the profile
    const pool = f.cue_pools && f.cue_pools[kind];
    if (Array.isArray(pool) && pool.length > 1) {
      const i = Math.min(pool.length - 1, Math.max(0, Math.floor(this.rng() * pool.length)));
      return { frame: pool[i], tag: ` (${i + 1}/${pool.length})` };
    }
    return { frame: (f.cues && f.cues[kind]) || null, tag: '' };
  }
  /** `' + spawn line (VAN 2/3)'` for a write reason: the take's id (token 4 of the $PLAY) and its place in the pool. */
  _lineTag(pick) {
    if (!pick || !pick.frame) return '';
    const id = (pick.frame.split(',')[4] || pick.frame.split(',')[1] || '').trim();
    return ` + spawn line (${id}${pick.tag ? ' ' + pick.tag.trim().slice(1, -1) : ''})`;
  }
  /** A15.3: one random frame of `frames[kind]` (a LIST of full frames -- `pset_pool`: one $PSET per death-scream
   *  take). `{frame: null}` when the bundle has no such pool (pre-A15.3), so nothing extra is written. */
  _pickFrame(kind) {
    const pool = this.frames && this.frames[kind];
    if (!Array.isArray(pool) || !pool.length) return { frame: null, tag: '', id: '' };
    const i = pool.length > 1 ? Math.min(pool.length - 1, Math.max(0, Math.floor(this.rng() * pool.length))) : 0;
    const frame = pool[i];
    const id = kind === 'pset_pool' ? (frame.split(',')[10] || '').trim() : '';   // $PSET token 10 = deathScream
    return { frame, tag: pool.length > 1 ? ` ${i + 1}/${pool.length}` : '', id };
  }
  /** A17: one random take of `frames.sir_pool` -- a LIST of frames (a whole `$SIR` table), not one frame.
   *  `[]` when the bundle has no pool (pre-A17), so nothing extra is written. Never returns the take we
   *  wrote last: the point is that the same weapon does not land the same clip twice running. */
  _pickTable(kind) {
    const pool = this.frames && this.frames[kind];
    if (!Array.isArray(pool) || !pool.length) return [];
    let i = pool.length > 1 ? Math.min(pool.length - 1, Math.max(0, Math.floor(this.rng() * pool.length))) : 0;
    if (pool.length > 1 && i === this._lastSirTake) i = (i + 1) % pool.length;
    this._lastSirTake = i;
    return Array.isArray(pool[i]) ? pool[i] : [];
  }
  /** How this bundle protects a fresh life. 'tmp' (F121 rebuild, levers §23): spawn/revive write `$TMP` t8 = -100
   *  right after `$SPAWN`, and `_armLife` writes `spawn_protect_off` (plus a `sir_pool` take when needed). 'twin'
   *  (A44, an older MC): spawn/revive carry the fn-28 twin and `_armLife` writes the take. null: a pre-A44 bundle
   *  that arms inside the revive write itself. A 'twin' bundle must keep its own path: the twin in its revive
   *  overwrites the live table every life, so skipping the take would leave the player immortal. */
  _protectMode() {
    const f = this.frames;
    if (!f || !Array.isArray(f.sir_pool) || !f.sir_pool.length) return null;
    if (typeof f.spawn_protect_off === 'string' && f.spawn_protect_off.startsWith('$TMP,')) return 'tmp';
    const rows = (f.revive || []).filter(x => typeof x === 'string' && x.startsWith('$SIR,'));
    return rows.length > 0 && rows.every(x => x.split(',')[4] === '28') ? 'twin' : null;
  }
  /** F209: true when spawn/revive leave the gun protected and `_armLife` must end it. */
  _protectsSpawn() { return this._protectMode() !== null; }
  /** F209: a spawn/revive write just made the gun live with hit reception still silent. `flip`: an infection flip
   *  respawns the gun while the engine counts the player down. */
  _armAfterSpawn(flip = false, kind = 'timed') {
    const rp = this._respawnProfile();
    if (!rp) { this._armPending = this._protectsSpawn() ? { at: this.now(), flip, until: SPAWN_PROTECT_MAX_MS, shotEnds: true, off: this._protectMode() === 'tmp', shield: false } : null; return; }
    // 2026-09-19: the profile decides. Protection ends on the clock alone, never on a shot. With no protection the
    // pending entry still exists (until 0) so `_armLife` writes the table take, if one is owed, straight away.
    const station = kind === 'station';
    const until = station ? rp.station_protect_ms : rp.protect_ms;
    this._armPending = this._protectsSpawn() || until > 0
      ? { at: this.now(), flip, until, shotEnds: false, off: until > 0, shield: station && until > 0 && !!rp.shield_on } : null;
    this._triggerPending = station ? null : { at: this.now(), due: this.now() + (rp.trigger_ms || 0), flip };
    // Only once the phase is live: the T-0 spawn runs this before `_set('live')`, and `_armLife` cancels a not-live arm,
    // which would leave the head's silent table on the gun for the life. The next tick arms that one instead.
    if (this._armPending && until <= 0 && this.phase === 'live' && this.bleUp && !this.reconciling) this._armLife('no protection');
  }
  /** 2026-09-19: write the live `$SIR` table before go-live (PRE_ARM_TABLE_MS), once per match, on a profile bundle.
   *  The head left the silent fn-28 twin on the gun for the countdown; every trigger is still held, so arming the
   *  table now costs nothing and makes every player hittable the moment the T-0 spawn maps the triggers. */
  _preArmTable() {
    if (this._preArmed === this.matchId || !this._respawnProfile() || !this.frames) return;
    this._preArmed = this.matchId;
    if (this._sirLive) return;
    const take = this._pickTable('sir_pool');
    if (!take.length) return;
    const r = this._write(take, `pre-arm hit table (T-${Math.round(PRE_ARM_TABLE_MS / 1000)})`);
    const gen = this._sirGen; this._sirLive = true;
    Promise.resolve(r).then(ok => {
      if (ok !== false || gen !== this._sirGen) return;
      this._sirLive = false;
      // 2026-09-19: the T-0 spawn reads `_sirLive` before this promise settles, so a slow failure can land
      // AFTER `_spawn` already ran on the (wrong) assumption the table was live -- with `rpSpawn` clearing
      // `_armPending` at go-live, nothing would otherwise retry, and the gun keeps the head's silent fn-28
      // twin all life. Repair it the same way any other lost protection write is repaired.
      if (this.phase === 'live' && this.alive && !this._armPending) { this._armPending = this._repairArm(); this.log('pre-arm hit table write failed after go-live -- repairing', 'le'); }
      else this.log('pre-arm hit table write failed: the T-0 spawn carries it', 'le');
    });
  }
  /** 2026-09-19: the bundle's respawn profile, or null on an older bundle (the legacy path). */
  _respawnProfile() {
    const rp = this.frames && this.frames.respawn_profile;
    return rp && Array.isArray(rp.spawn) && Array.isArray(rp.revive) && Array.isArray(rp.revive_station) && typeof rp.trigger_live === 'string' ? rp : null;
  }
  /** The pending entry a repair path (a lost write, the reconcile end, the operator resync) arms with: at once, and
   *  it always writes `spawn_protect_off` on a 'tmp' bundle, so a repair always ends protection. A station shield
   *  still showing goes off with it. */
  _repairArm() {
    const p = this._armPending;
    return { at: this.now(), flip: false, until: 0, shotEnds: false, off: this._protectMode() === 'tmp', shield: !!(p && p.shield) };
  }
  /** 2026-09-19: a timed respawn's weapon delay has run out. Map the trigger (`respawn_profile.trigger_live`). The
   *  write is repeatable, so a failed one is retried once while the life is still the same one. */
  _triggerLive(why) {
    const p = this._triggerPending; this._triggerPending = null;
    const rp = this._respawnProfile();
    if (!p || !rp) return;
    if (this.phase !== 'live' || this.ended || !(this.alive || p.flip)) { this.log(`weapon systems live (${why}) cancelled: not live`, 'li'); return; }
    const life = this._lifeSeq;
    this._writeMust([rp.trigger_live], `weapon systems live (${why})`, () => this._lifeSeq === life && !this._standDown(p.flip ? ['phase', 'ble'] : ['phase', 'ble', 'alive']), true);   // actExempt: $BMAP,0,0 is safe to repeat past a shot/hit
    this._changed();
  }
  /** 2026-09-19: a registered hit clears a painted headset colour, so the station shield is painted again after a
   *  hit that lands while it shows, at most once per SHIELD_REASSERT_MS. */
  _shieldReassert() {
    const p = this._armPending, rp = this._respawnProfile(), now = this.now();
    if (!p || !p.shield || !rp || !rp.shield_on || now - this._shieldAt < SHIELD_REASSERT_MS) return;
    this._shieldAt = now;
    this._write([rp.shield_on], 'shield after hit');
  }
  /** F209: end spawn protection. Called on the gun's first shot (`_onAmmo`) or at SPAWN_PROTECT_MAX_MS (`tick`), and
   *  by the reconcile end and the operator resync. Never arms a gun that died, ended or is no longer live.
   *  'tmp' bundle: one write of [a `sir_pool` take, if the gun's table is not the live one or class sounds are on]
   *  then `spawn_protect_off`. The take goes FIRST so its rows land while t8 still holds hits at 0 damage.
   *  'twin' bundle: the take alone, as A44 shipped it. */
  _armLife(why) {
    const p = this._armPending; this._armPending = null;
    if (!p) return;
    if (this.phase !== 'live' || this.ended || !(this.alive || p.flip)) { this.log(`arm hit reception (${why}) cancelled: not live`, 'li'); return; }
    const tmp = this._protectMode() === 'tmp';
    const pool = Array.isArray(this.frames.sir_pool) ? this.frames.sir_pool : [];
    const needTake = pool.length > 0 && (!tmp || !this._sirLive || pool.length > 1);   // > 1 takes = A17 class sounds: a fresh draw per life
    const take = needTake ? this._pickTable('sir_pool') : [];
    const rp = this._respawnProfile();
    // 2026-09-19: `off` says whether this life was protected (a timed life with protection 0 writes no `$TMP` at all);
    // a shielded station life ends with the headset back on its rest frame.
    const off = p.off !== false && tmp ? [this.frames.spawn_protect_off] : [];
    const shieldOff = p.shield && rp && rp.shield_off ? [rp.shield_off] : [];
    const frames = [...take, ...off, ...shieldOff];
    if (!frames.length) { this._changed(); return; }
    // F11 fix (playtest review 2026-09-13): `link.write` resolves `false` on a GATT error instead of
    // rejecting, so a failed write here used to leave the gun on fn 28 (no real $SIR table) for the
    // whole life -- immortal. Re-arm the pending take on a `false` resolve so the next tick's cap
    // (or the next shot) retries. Gated the same way the write itself was gated, so a life that ended
    // or moved on while the write was in flight is never re-armed; the retry itself only fires once the
    // link is back up (`tick()` gates the cap path on `bleUp`), so this cannot spin on a dead link.
    const r = this._write(frames, off.length ? `end spawn protection (${why})${take.length ? ` + hit table ${take.length}r` : ''}${shieldOff.length ? ' + shield off' : ''}` : `arm hit reception (${why})`);
    // Claimed at CALL time, as `_write` marks the opposite: the writes go out in call order, so a later head or
    // `$CLEAR` clears this again. A failed write takes the claim back, unless such a write already has.
    const gen = this._sirGen;   // read AFTER the call: the take's own rows bumped it
    if (take.length) this._sirLive = true;
    Promise.resolve(r).then(ok => {
      if (ok !== false) return;
      if (take.length && gen === this._sirGen) this._sirLive = false;
      if (this._armPending || this.phase !== 'live' || this.ended || !(this.alive || p.flip)) return;
      this.log(`arm hit reception (${why}) write failed -- re-arming to retry`, 'li');
      this._armPending = { ...p, at: this.now(), until: p.shotEnds ? p.until : 1000 };   // keep the original flip (an infection flip's retry must not read as "not live"); a profile life retries 1 s on
      // 2026-09-19: this retry may be ending real t8 protection (`off.length`), so hold the trigger past
      // it -- it must never go live while t8 is still -100. Push the due out to at least the retry plus
      // TRIGGER_AFTER_PROTECT_MS, never pull it earlier (the delay may already be later than that).
      if (!p.shotEnds && off.length && this._triggerPending) {
        this._triggerPending.due = Math.max(this._triggerPending.due, this._armPending.at + this._armPending.until + TRIGGER_AFTER_PROTECT_MS);
      }
    });
  }
  /** A15.3 (Tony 2026-09-06: "The long vs short pain should be used depending on the amount of damage. A big sniper
   *  shot -> long pain. A normal round -> short pain."): the $PSET pain fields ship EMPTY and WE play the grunt on
   *  each registered hit -- `pain_melee` on a melee word (proto 13), `pain_long` when the hit took at least
   *  `voice.pain_long_min` (40: shotgun / snipers / power weapons), else `pain_short`; one random take of that pool.
   *  Gated to one grunt per PAIN_GAP_MS (a burst of rifle hits must not queue six grunts in the gun); never on a
   *  lethal hit (the native death scream plays). `dmg` is what the pools actually lost (crit included).
   *
   *  A17 (Tony 2026-09-07: "only use the character hit sounds when real health is taken down"): the grunt is the
   *  CHARACTER being hurt, so it only plays when the hit reached HEALTH. `pool` is the innermost pool that moved
   *  (`_onHp`, mirroring `poolgauge.changed_pool`): a hit absorbed entirely by armour or shield is a hit on
   *  EQUIPMENT and the player hears the firmware's material sound for that pool ($PSET hitArrmor / hitShield,
   *  `hitaudio.MATERIAL_POOLS`) instead -- metal, not a voice. Short vs long is still chosen by damage exactly as
   *  above, from the same pain pools. This matches what `low_health` already does: the hurt loop fires only once
   *  armour is gone and HP is actually dropping. A bundle from an older MC passes no pool and grunts as before. */
  _pain(dmg, proto, pool) {
    const f = this.frames; if (!f) return;
    if (pool && pool !== 'health') return;   // A17: armour/shield took it -- equipment, not the character
    // A17.3 (Tony, bench 2026-09-07, asked explicitly and answered "total"): `dmg` is the TOTAL pools lost,
    // armour and shield included -- NOT the HP portion. A big hit sounds big regardless of what stopped it.
    // The consequence is deliberate and looks like a bug: the hit that breaks THROUGH armour sums the armour
    // absorbed plus the HP taken, so armour 30->0 with HP 45->35 is dmg 40 and trips the long pain for a hit
    // that cost 10 HP. That is the intended reading -- a round that strips your plating and reaches you IS a
    // heavy hit -- and it is the one place where the A17 gate ("armour absorbing is equipment, not the
    // character") and the pain SIZING deliberately disagree. Do not "fix" this to `prevHp - hp`.
    const kind = proto === 13 ? 'pain_melee' : dmg >= ((f.voice && f.voice.pain_long_min) || 40) ? 'pain_long' : 'pain_short';
    if (!((f.cues && f.cues[kind]) || (f.cue_pools && f.cue_pools[kind]))) return;   // pre-A15.3 bundle: the firmware's own pains
    const now = this.now();
    if (this._lastPainAt != null && now - this._lastPainAt < PAIN_GAP_MS) return;   // drop, never queue
    this._lastPainAt = now;
    const pick = this._pickCue(kind);
    if (pick.frame) this._write([pick.frame], `pain ${kind.slice(5)} (${(pick.frame.split(',')[4] || '').trim()}${pick.tag}) ${dmg} dmg into ${pool || 'pools'}`);
  }
  /** The lights of an event without its sound (feedback plays the medal lines itself). */
  _eventLeds(kind) {
    const f = this.frames; if (!f) return;
    const seq = f.leds && f.leds[kind];
    if (!seq || !seq.length) return;
    const now = this.now();
    if (this._lastEventLed != null && now - this._lastEventLed < EVENT_MIN_GAP_MS) return;
    this._lastEventLed = now;
    let t = 0;
    const gen = (this._hsGen = this._hsGen || 0);   // an event's static $HLED must not land over a later headset sequence (death blink, hit flash); seed the counter so the check is not undefined === 0 after a reload
    const lg = (this._lightGen = this._lightGen || 0);   // teardown snapshot: every delayed step below (headset AND gun) checks this
    for (const step of seq) {
      const frame = step[0], hold = Math.max(0, Math.round((step[1] || 0) * 1000));
      if (frame.startsWith('$HLED')) {
        if (!this.alive) { t += hold; continue; }   // down: the out-blink owns the headset (polish 2026-09-04)
        if (t === 0) this._write([frame], `event led ${kind}`); else this.delay(t, () => { if (this._hsGen === gen && this._lightGen === lg && this.alive) this._write([frame], `event led ${kind}`); });
      } else if (t === 0) this._write([frame], `event led ${kind}`); else this.delay(t, () => { if (this._lightGen === lg) this._write([frame], `event led ${kind}`); });
      t += hold;
    }
    const g = f.gun;
    // A16 §3.1: generalises the old health-band tail restore below — the burst must end on whatever the
    // readout is CURRENTLY showing (the live band, if its hold is still running) and never on the top band.
    // A16.3: `_roAnimating` counts alongside the hold here too -- a burst landing mid drop/gain animation
    // must restore the frame the animation actually left on the strip, not jump to rest underneath it.
    if (g && g.readout && this._gunTaken) {
      this.delay(t, () => {
        if (this._lightGen !== lg || !this.alive) return;
        const rest = this._gunRestFrame || g.rest;   // F86: the flip's rest, when the gun was taken on another team
        if ((this._readoutHoldActive || this._roAnimating) && this._readoutFrame && this._readoutFrame !== rest) { this._write([this._readoutFrame], `readout after ${kind}`); }
        else if (rest) { this._readoutFrame = rest; this._readoutHoldActive = false; this._write([rest], `readout rest after ${kind}`); }
      });
    } else if (g && g.in_play === 'health' && this._gunTaken) this.delay(t, () => { if (this._lightGen !== lg) return; const r = this._gunRest(); if (r && this.alive) { this._gunBand = r; this._write([r], `gun health after ${kind}`); } });   // A11.7: the burst ended on the full-health frame; restore the real band
  }
  _cue(key) {
    const f = this.frames && this.frames.cues && this.frames.cues[key];
    if (f && !this.cuesFired.has(key)) { this.cuesFired.add(key); this._write([f], `cue ${key}`); }
  }
  _spawn(withCountdown) {
    if (!this.frames) return;
    if (withCountdown && !this.cuesFired.has('countdown')) this._cue('countdown');
    // A15.2 (Tony 2026-09-06, bench-verified): the $PSET cry field ships EMPTY so the firmware says nothing at $SPAWN,
    // and WE play one take of the spawn pool in the SAME write ($SPAWN then $PLAY plays clean; a $PLAYX between
    // them clipped the firmware's line). A pre-A15.2 bundle has no cues.spawn: nothing is appended.
    const sp = this._pickCue('spawn');
    // A15.3: the death scream stays NATIVE but is rolled per LIFE -- one of the bundle's pre-composed $PSET frames
    // (one per scream take) goes out first, in the same write (bench 2026-09-06: a $PSET re-sent in play keeps $SIR,
    // does not heal, the gun fires). No pset_pool (pre-A15.3): nothing prepended, the head's $PSET stands.
    const ps = this._pickFrame('pset_pool');
    const life = this._lifeSeq = (this._lifeSeq || 0) + 1;   // pl3: a lost write is only this life's news
    // 2026-09-19: with a respawn profile the T-0 spawn is neither profile: no t8, the trigger live, and the live table
    // already on the gun (`_preArmTable` at T-3). A late start that missed T-3 carries the table IN FRONT of `$SPAWN`.
    const rpSpawn = this._respawnProfile();
    const late = rpSpawn && !this._sirLive ? this._pickTable('sir_pool') : [];
    if (rpSpawn && !late.length && !this._sirLive) this.log('*** T-0 spawn: no live hit table to write (no sir_pool) ***', 'le');
    this._writeLife([...late, ...(ps.frame ? [ps.frame] : []), ...(rpSpawn ? rpSpawn.spawn : this.frames.spawn), SFLASH, ...(sp.frame ? [sp.frame] : [])], 'spawn' + (late.length ? ` + hit table ${late.length}r (late)` : '') + this._lineTag(sp) + (ps.frame ? ` + scream ${ps.id}${ps.tag}` : ''), life);
    if (late.length) this._sirLive = true;
    this.hurtFired = false;        // the low-health alert is once per LIFE
    this._pendingHurtWrite = false;
    this._prevAmmo = {}; this._prevReserve = {}; this._shotAcct = {}; this.activeSlot = 0; this.magBySlot = {}; this.heatBySlot = {}; this._heatAt = {}; this._everHeated = {}; this._heatLock = null; this.lastShot = null;   // config echoes carry WEAP clip caps, not spawn mags — never let them set the denominator   // assumption (hardware-UNVERIFIED): a fresh spawn puts the gun on slot 0
    this._holdAccuracyWrites('spawn');   // the spawn write owns `$AMMO` until the gun has answered it
    this._lastTeamRepaintAt = this.now();   // F68: the spawn flash IS this life's first paint; the backstop clock runs from it
    this._recoilArm('spawn');   // S42: a fresh life starts at the weapon's ceiling
    this._cue('klaxon');
    // Spawn shield is ALWAYS 0 on hardware -- $PSET t5 is a capacity filled by an fn-11
    // grant, never a starting pool (bench 2026-08-27).
    this.spawned = true; this.alive = true; this.hp = this.maxHp; this.armor = this.maxArmor; this.shield = 0; this.killedBy = null; this.deadAt = 0; this.reloading = null; this._reloadOutcome = null; this.held = {};
    this.poolSrc = 'model';        // R2-3: those two numbers are config.health, not the gun's answer
    this._prevHp = this.hp; this._prevArmor = this.armor; this._prevShield = this.shield;
    this._spawnAt = this.now(); this._armedThisLife = false;   // B5: a settle window starts here — see `_deathPending`
    this._shotDueAt = null; this._noFirePulls = 0; this._dryPulls = 0;   // F208: a fresh life owes no shots; the RELOAD nag: and it starts loaded, so no dry spell is running
    // S29: a fresh life starts at shield 0 without the shield having BROKEN, so no heartbeat and no
    // refill in flight; the recharge delay runs from here, which is why a life's first fill lands
    // SHIELD_REGEN_DELAY_MS in and never inside the spawn write.
    this._shieldRegen = null; this._shieldDown = false; this._shieldLoopAt = 0; this._shieldGaveUp = false; this._shieldQuietAt = this.now();
    if (rpSpawn) { this._armPending = null; this._triggerPending = null; }   // 2026-09-19: nothing to end at go-live
    else this._armAfterSpawn();   // F209 (an older bundle): hits stay silent until the gun fires or the cap runs out
    this._gunTake();   // A11.7
    if (this.frames.headset) this._headsetDelayed(this.frames.headset.start, 'start');   // led-language.md §3.1/§5: scheduled +1.0 s after $SPAWN, not inline (A11.6: white flash marks the start, then dark/team)
    this.moment = { kind: 'go', at: this.now() };
    this._set('live');
  }

  // ---------- King of the Hill audio ----------
  // The architecture, and it is the whole point of this block: **beacons update STATE, a node timer sets the
  // CADENCE.** F74 measured a gun replaying a latched IR event every 5.07 s forever, so a multi-second
  // sequence launched per beacon stacks three deep and drifts; the possession tick is therefore a 0.11 s
  // clip fired by `_hillTick` off our own ~1 s clock while state says we hold a fresh point, and NOTHING
  // in this file plays audio directly from a beacon except a one-shot transition callout.

  /** The bundle's cue for a hill sound, else the literal fallback above, plus its real length in ms.
   *  The bundle WINS whenever it carries the key at all -- `''` is MC's deliberate mute (`cue_frames()`
   *  writes `''` for an objective cue when the profile's announcer is off), and a fallback that overrode
   *  that would turn the announcer switch into a lie. `{frame: null}` = play nothing. */
  _hillCue(kind) {
    const def = HILL_CUES[kind]; if (!def) return { frame: null, ms: 0 };
    const cues = this.frames && this.frames.cues;
    const fromBundle = cues && Object.prototype.hasOwnProperty.call(cues, kind) ? cues[kind] : undefined;
    const frame = fromBundle !== undefined ? fromBundle : def.frame;
    if (!frame) return { frame: null, ms: 0 };
    // `hasOwnProperty`, not `||`: a bundle deliberately setting `cue_ms[kind] = 0` means "this cue must not
    // suppress the tick", and `||` silently replaced that zero with the default length instead.
    const cm = this.frames && this.frames.cue_ms;
    const ms = cm && Object.prototype.hasOwnProperty.call(cm, kind) ? cm[kind] : def.ms;
    return { frame, ms };
  }
  /** True while hill audio should be audible at all: live, on our feet, and not a mode whose points we
   *  cannot tell apart. Death is deliberately silent — A16 makes the DOWN window hands-off and the death
   *  scream owns the announcer; a player who respawns learns the current owner from the tick within 1 s. */
  _hillAudioOn() {
    return this.phase === 'live' && this.alive
      && !(this.config && HILL_AUDIO_EXCLUDED_MODES.has(this.config.mode));
  }
  /** B/F70: MC names ONE objective source per game (`config.station_source`), and the phone accepts BOTH
   *  wires. Without this gate a grenade left live on the field (F69) during a phone-point game alternates
   *  ownership with the point every 5 s and announces continuously — two sources, one `this.hill`.
   *  The vocabulary (`STATION_SOURCES`, `mcp/brx_mcp/mc/types.py`): `grenade` = the IR beacon, `phone` = the
   *  BLE control point (F103 added it 2026-09-11), `ir_station` = a `$CAPTURE`-speaking box that reaches MC,
   *  not us. Absent = no objective in this game, so what we hear is it (a try-out, the stage). */
  _hillSourceAllowed(source) {
    const src = this.config && this.config.station_source;
    if (!src) return true;                                  // no game, or a mode with no objective: what we hear is it
    const ok = source === 'station' ? src === 'phone' : src === 'grenade';
    if (!ok && this._hillSourceWarned !== source) {
      this._hillSourceWarned = source;
      this.log(`ignoring the ${source === 'station' ? 'phone control point' : 'grenade hill beacon'}: this game's station_source is ${src}`, 'li');
    }
    return ok;
  }
  /** Do WE hold the point right now? `null`/neutral/an enemy all read false. */
  _hillMine() {
    const mine = this.teamTid;
    return mine != null && mine !== HILL_NEUTRAL_TEAM && !!this.hill && this.hill.owner === mine;
  }
  /** Which callout ONE wire event deserves for THIS listener: the same `mag=50` frame is "Hill Captured"
   *  to the incoming team and "Hill Lost" to the team that just lost it. A capture between two other teams
   *  (or from neutral to an enemy) is deliberately silent — it is not this player's event.
   *
   *  ⚠ "Hill Contested" (`VB0O`) is DELIBERATELY NOT WIRED. F75 checked four bench runs where a hill was
   *  shot and did NOT change hands: the only protocol-15 traffic is the ordinary `mag=8` beacon, so a
   *  non-capturing hit emits nothing we can decode. The only way to produce it is to INFER it from "I
   *  fired" + "an enemy hill is in range" + "no capture word followed" — which cannot tell a hit from a
   *  miss, so firing PAST the grenade while standing in an enemy point would announce it falsely. That
   *  false positive is not merely noise: at 2.078 s it would suppress the possession tick for two seconds
   *  and tell the player something untrue about the objective. Silence is the honest answer until F75's
   *  probe (deliberately miss a grenade in a NATIVE game and see whether native still says "contested")
   *  settles whether native infers it too or there is a word we have not captured. */
  _hillCallout(prevOwner, owner) {
    const mine = this.teamTid;
    if (mine == null) return null;
    if (mine === HILL_NEUTRAL_TEAM) {   // F82: a NEUTRAL point broadcasts team 2, so a tid-2 roster cannot tell "nobody holds it" from "we hold it"
      if (!this._hillTeam2Warned) { this._hillTeam2Warned = true; this.log('F82: we are on tid 2, which is what a NEUTRAL hill broadcasts — hill ownership is undecidable, so no hill audio will play', 'le'); }
      return null;
    }
    if (owner === mine) return 'hill_captured';
    if (prevOwner === mine) return 'hill_lost';
    return null;
  }
  /** Play one callout NOW. Priority rule: **the later callout wins outright — it preempts, it never
   *  queues.** These are 1.9-3.0 s announcements of a state that has just changed AGAIN, so a queued
   *  "Hill Captured" finishing three seconds after the point was already lost would state something
   *  false; the newest word is always the true one. A preempt sends `$PLAYX,0,*` in the SAME write, so
   *  the stale line is actually stopped on the gun rather than left to mix — and only when we are cutting
   *  off our OWN in-flight hill callout, so nothing else's audio is ever clipped by this path. */
  _hillSay(kind, why) {
    const cue = this._hillCue(kind);
    if (!cue.frame) return;
    const now = this.now();
    const preempt = now < this._hillBusyUntil;
    this._hillBusyUntil = now + cue.ms;
    this._write(preempt ? [PLAYX, cue.frame] : [cue.frame], `hill ${kind}${preempt ? ' (preempting the line still playing)' : ''} — ${why}`);
  }
  /** A deduped protocol-15 beacon: update hill state and, if this frame PROVES a change of hands, announce
   *  it in this same handler. Nothing here starts a sequence, and nothing here waits for a second word. */
  _onHillBeacon(ownerTeam, magnitude, now) {
    if (magnitude !== HILL_MAG && magnitude !== HILL_CAPTURE_MAG && magnitude !== HILL_WAS_NEUTRAL_MAG) return;   // magnitude 6 is a respawn station, not a point (F84)
    if (!this._hillSourceAllowed('beacon')) return;   // B: this game's objective is not a grenade
    // F82 is explained HERE, on the first beacon, not from `_hillCallout` — that is only reached when a
    // transition would be announced, so a tid-2 roster that never witnessed a capture went silent with no
    // reason in the log. The behaviour was always right (the tick is gated by `_hillMine`); the diagnostic
    // was missing, and the stage's default roster is blue(1) + yellow(2), so this is one click away.
    if (this.teamTid === HILL_NEUTRAL_TEAM && !this._hillTeam2Warned) {
      this._hillTeam2Warned = true;
      this.log('F82: we are on tid 2, which is what a NEUTRAL hill broadcasts — hill ownership is undecidable, so no hill audio will play', 'le');
    }
    const prev = this.hill;
    const prevOwner = prev ? prev.owner : null;
    const fresh = !!prev && (now - prev.at) < HILL_PRESENCE_MS;

    if (magnitude === HILL_WAS_NEUTRAL_MAG) {
      // `mag=53` is the state being LEFT, and bench 2026-09-10 measured it arriving ~5 s AFTER the `mag=50`
      // that already named the new owner (t=41820 vs t=46780). Its team field is therefore the OLD owner:
      // writing it into `owner` would hand the point back to nobody a full beacon cycle after we took it.
      // It refreshes presence and records that the capture started from neutral; it announces nothing, and
      // nothing ever waits for it — on an enemy-to-enemy capture it never arrives at all (n=2).
      // ⚠ Only when we already knew the point. With no prior hill this used to write `{owner: null}`, which
      // held a 12 s presence window open for a point whose owner was never known and then logged "presence
      // expired" for it — and left `state().hill` non-null with a null owner, so every downstream reader had
      // to test `owner` as well. We simply did not see this capture; the next `mag=8` names the owner.
      if (!prev) return;
      this.hill = { owner: prevOwner, at: now, from_neutral: true };
      this._changed();
      return;
    }

    // `mag=50` is an explicit capture word: it proves a change of hands by itself, whether or not we were
    // watching the point beforehand. A plain `mag=8` whose owner differs from the one we knew is the SAME
    // event seen late (we missed the capture word), so it announces too — but only while presence was
    // still fresh. Once presence has expired we were not watching, and adopting an owner on walking back
    // into range is not a capture: it is silent.
    const announce = magnitude === HILL_CAPTURE_MAG ? prevOwner !== ownerTeam : (fresh && prevOwner != null && prevOwner !== ownerTeam);
    // `from_neutral` is DERIVED on an owner change, never inherited. It used to carry `prev.from_neutral`
    // through the plain-beacon path, so once a point had been taken from neutral, every LATER owner adopted
    // via "we missed the capture word" still read `from_neutral: true` — claiming they took it from nobody
    // when they stole it from a team. Found 2026-09-10 porting this to the bench stage, and it is not
    // cosmetic: `modes/hillbeacon.py` splits its callouts on this field, and it computes the same fact
    // independently (`from_neutral = previous == NEUTRAL`), so a leak here makes MC and the phone disagree
    // about the same capture. A `mag=50` stays false until its `mag=53` confirms otherwise (that word
    // arrives ~5 s later, or never on an enemy-to-enemy capture); a heartbeat that changes nothing keeps
    // what we had; an owner CHANGE reads the previous owner, which is the only honest source.
    const sameOwner = prevOwner === ownerTeam;
    this.hill = { owner: ownerTeam, at: now,
      from_neutral: magnitude === HILL_CAPTURE_MAG ? false
                  : sameOwner ? (prev ? !!prev.from_neutral : false)
                  : prevOwner === HILL_NEUTRAL_TEAM };
    if (announce) {
      const kind = this._hillCallout(prevOwner, ownerTeam);
      if (kind && this._hillAudioOn()) this._hillSay(kind, magnitude === HILL_CAPTURE_MAG
        ? `capture word (mag 50): team ${prevOwner == null ? '?' : prevOwner} -> ${ownerTeam}`
        : `owner changed on a plain beacon (the mag-50 word never reached us): team ${prevOwner} -> ${ownerTeam}`);
    }
    this._changed();
  }
  /** K1 — the SAME hill state and the SAME four cues, sourced from a phone CONTROL POINT's BLE advert
   *  instead of a grenade's IR word (utility.md §5 row `control`). Called from `setStations` at ~4 Hz.
   *
   *  The station has already done the counting: its advert carries the owner (byte 9 + the `held` bit), the
   *  0-100 conversion progress (byte 11) and whether two teams are on it (byte 10 bit 1). So this is a
   *  TRANSLATOR, not a second audio system -- it writes `this.hill` in the shape `_hillMine` / `_hillTick` /
   *  `state().hill` already read, and announces through `_hillCallout` / `_hillSay`, which keeps the
   *  preempt-not-queue rule, the real clip lengths and the tick suppression identical on both sources.
   *
   *  Two things it does differently from the IR path, both because the station measures what the grenade
   *  cannot:
   *   - **Ownership changes only through neutral.** The station drains an enemy-held point to 0 (its owners
   *     have LOST it) and only then builds it to 100 for its new owner, so "Hill Lost!" lands on the team
   *     that was robbed at the moment they actually stop holding it, and "Hill Captured" lands on the new
   *     owner up to a conversion later. `_hillCallout` already resolves both from one owner change.
   *   - **"Hill Contested" (VB0O) IS wired here.** F75 forbids it on the IR path because a non-capturing hit
   *     emits nothing and the state could only be INFERRED from a miss. A station COUNTS living bodies of
   *     each team inside its own bubble, so the contested bit is a measurement. It is announced only to
   *     players the fight belongs to: someone standing on the point, or the team that owns it (a defender
   *     hearing their own point go contested is the whole reason the cue exists).
   *
   *  ⚠ ONE point. A station advert does name its own id, so unlike F88's grenades several points ARE
   *  distinguishable on this wire -- but `this.hill` models a single point, so the nearest/occupied one wins
   *  and multi-point Domination stays out of scope (`HILL_AUDIO_EXCLUDED_MODES` already mutes it). */
  _onControlAdvert(now) {
    const e = this._controlStation();
    if (!e) return;
    if (!this._hillSourceAllowed('station')) return;   // B: this game's objective is a grenade, not a phone point
    if (this.teamTid === HILL_NEUTRAL_TEAM && !this._hillTeam2Warned) {   // F82, the same warning as the IR path
      this._hillTeam2Warned = true;
      this.log('F82: we are on tid 2, which is what a NEUTRAL point broadcasts — control-point ownership is undecidable, so no hill audio will play', 'le');
    }
    // The station says 255 for "nobody holds it"; the hill model (and `modes/hillbeacon.py`) says team 2,
    // because that is what a NEUTRAL grenade broadcasts. Map once, HERE, so everything downstream is shared.
    const held = !!(e.state & CONTROL_STATE.held);
    // Not held, a colour tid, or 255 all mean the same thing to this model: nobody. A `held` advert naming
    // tid 2 needs no special case — 2 IS the neutral sentinel, so an unauthenticated advert cannot use it to
    // install an owner nobody could decide (F82), it just says "nobody" the long way round.
    // `claimable` rather than a restated `e.team <= 3`: the station side already decides who may hold a point
    // with it (control.js), and a hand-copy of that boundary is one edit away from disagreeing with it. A
    // mutation audit (2026-09-11) moved the old literal to `<= 4` and the whole suite stayed green, which
    // would have made a COLOUR tid a point owner — tids 4-7 are not teams ($TID is masked to 2 bits, F35/F96).
    const owner = (held && claimable(e.team)) ? e.team : HILL_NEUTRAL_TEAM;
    const contested = !!(e.state & CONTROL_STATE.contested);
    // §5d.3: `rising && falling` is INVALID and direction falls back to UNKNOWN. Flags are independent bits,
    // so unlike a 2-bit phase field they CAN both be set -- and adverts are unauthenticated (§3), so a buggy
    // or hostile station can say it. A reader that trusts whichever bit it tests first shows a defender the
    // point moving the wrong way, which is worse than showing no direction at all.
    const bothWays = (e.state & CONTROL_STATE.rising) && (e.state & CONTROL_STATE.falling);
    const rising = !bothWays && !!(e.state & CONTROL_STATE.rising);
    const falling = !bothWays && !!(e.state & CONTROL_STATE.falling);
    const prev = this.hill;
    // A: two points are two different objectives, and `site` was recorded and never compared. A point we
    // were not reading before tells us NOTHING about a change of hands — walking from our own point toward
    // an enemy's used to fire "Hill Lost!" for a point nobody had taken. A different site (or the other
    // source's state) is adopted SILENTLY, exactly as walking back into range is (`_onHillBeacon`).
    const sameSite = !!prev && prev.source === 'station' && prev.site === e.id;
    const prevOwner = sameSite ? prev.owner : null;
    if (!sameSite && prev && prev.site !== e.id) {
      this.log(`control point ${e.id} is a different point from ${prev.source === 'station' ? prev.site : 'the grenade hill'} — adopting its owner silently`, 'li');
      this._hillWasContested = false; this._hillOwnerWhenSilenced = undefined;
    }
    this._controlSite = e.id;
    this.hill = {
      owner, at: now,
      // A station capture ALWAYS passes through neutral (that is the two-phase rule), so this is true for
      // every handover it reports -- which is the literal truth, not a leak of the IR path's meaning.
      from_neutral: prevOwner === HILL_NEUTRAL_TEAM,
      source: 'station', site: e.id,
      progress: Math.max(0, Math.min(100, e.value | 0)),
      // Whose progress the bar is: the owner while held, else the team building it up, else null.
      holding: e.team <= 3 ? e.team : null,
      contested, rising, falling,
      onPoint: !!e.present,
    };
    // C: a transition that lands while we are DOWN used to be swallowed, not deferred — so a player
    // respawned and "we lost it", "out of range" and "nothing is happening" were all the same silence, and
    // only OWNING the point ever spoke. We remember the owner as we last heard it WITH audio on, and on the
    // first advert after revive we say the one line that describes the net change across the death window.
    // The net change, not a replay: the point may have changed hands twice, and the newest word is the true
    // one (the same rule `_hillSay` enforces by preempting).
    const audio = this._hillAudioOn();
    let said = false;
    const announceFrom = audio && this._hillOwnerWhenSilenced !== undefined && this._hillOwnerWhenSilenced !== prevOwner
      ? this._hillOwnerWhenSilenced : prevOwner;
    if (audio && announceFrom != null && announceFrom !== owner) {
      const kind = this._hillCallout(announceFrom, owner);
      // 2: a floor on the transition lines too. Two phones sharing the default station id 1 are ONE presence
      // entry, so the decoded owner can flip several times a second and each line preempted the last.
      if (kind && now - this._hillSaidAt >= HILL_CALLOUT_MIN_MS) {
        this._hillSaidAt = now;
        this._hillSay(kind, announceFrom === prevOwner ? `control point ${e.id}: team ${prevOwner} -> ${owner}`
          : `control point ${e.id}: it changed hands while we were down (team ${announceFrom} -> ${owner})`);
        said = true;
      }
    }
    // Track the owner we last heard with audio ON, so the line above can be owed across a death window.
    this._hillOwnerWhenSilenced = audio ? undefined : (this._hillOwnerWhenSilenced === undefined ? prevOwner : this._hillOwnerWhenSilenced);
    // Contested, on the rising edge only. A capture callout in the same advert wins outright: `_hillSay`
    // preempts, so announcing both would cut "Hill Captured" off with "Hill Contested" and leave the player
    // with the less important of the two facts.
    const mine = this.teamTid;
    if (contested && !this._hillWasContested && !said && audio
        && mine != null && mine !== HILL_NEUTRAL_TEAM && (e.present || owner === mine)
        && now - this._hillContestedAt >= HILL_CONTESTED_MIN_MS) {
      this._hillContestedAt = now;
      this._hillSay('hill_contested', `control point ${e.id} is contested (${e.value}% for team ${e.team})`);
    }
    this._hillWasContested = contested;
    // 4 Hz: only a fact the screen shows is worth a render (progress to the whole percent, like the RSSI
    // rounding in `setStations`).
    const sig = `${e.id}:${owner}:${held}:${contested}:${this.hill.progress}:${this.hill.holding}:${rising}:${falling}:${e.present}`;
    if (sig !== this._controlSig) { this._controlSig = sig; this._changed(); }
  }
  /**
   * POSSESSION, the thing an objective mode is actually scored on. Nothing anywhere counted it: the hill
   * tick ticks a SOUND, not a clock. This accrues, per point and per team, how long that team OWNED it as
   * THIS node observed it, plus how long this node could hear the point at all -- which is what makes the
   * number an honest lower bound rather than a guess (`mc/API.md`, the `possession` fact).
   *
   * ⚠ From ELAPSED TIME, never from a count of ticks: a stalled or throttled tick would silently under-count,
   * and that is the number the match is decided on. Each delta is clamped to one tick's worth because `now()`
   * is `Date.now()` plus an MC offset that MOVES as the sync converges -- an unclamped delta across one clock
   * step would add minutes of possession nobody played.
   *
   * ⚠ It accrues for WHOEVER owns it, not only for us, and it is never summed with a teammate's: MC merges by
   * MAX per (site, team) precisely because four players on one hill all observe the same ownership. The fact
   * says "team X owned point P for N ms as observed by me", which is why that merge is the obvious one.
   */
  _accrueHold(h, now) {
    if (this.phase !== 'live') { this._holdAt = 0; return; }   // a point heard in the lobby is not possession
    // Anchor the FIRST interval on when the point was last SEEN, not on when our tick happened to run.
    // Seeding from `now` instead lost one tick's worth on every fresh hold -- 250 ms at our normal cadence
    // but a full second on a throttled phone, which made possession depend on tick rate, the exact thing
    // this accumulator exists to avoid.
    if (!this._holdAt) this._holdAt = (h.at != null && h.at <= now) ? h.at : now;
    const dt = Math.max(0, Math.min(HOLD_STEP_MAX_MS, now - this._holdAt));
    this._holdAt = now;
    if (!dt) return;
    // A grenade beacon carries NO point id (F88), so its site is unnamed; a station advert names itself.
    const site = h.site != null ? String(h.site) : '';
    this._holdSource = h.source === 'station' ? 'station' : 'beacon';
    this.observed[site] = (this.observed[site] || 0) + dt;
    if (h.owner != null) {
      const by = this.hold[site] || (this.hold[site] = {});
      by[h.owner] = (by[h.owner] || 0) + dt;   // tid 2 included: MC credits it to nobody as `neutral_s`
    }
  }
  /** Send the tally to MC. `hold_ms` is CUMULATIVE and every report is idempotent, so this is
   *  resend-as-it-grows on a slow cadence, plus one unconditional report at the whistle. */
  _reportPossession(now, force = false) {
    if (!this.matchId) return;
    const sites = Object.keys(this.observed);
    if (!sites.length) return;
    const sig = JSON.stringify([this.hold, this.observed]);
    if (!force && (sig === this._possessionSig || now - this._possessionSentAt < POSSESSION_REPORT_MS)) return;
    this._possessionSig = sig; this._possessionSentAt = now;
    for (const site of sites) {
      const hold = this.hold[site] || {};
      this.emitFact({ type: 'possession', match_id: this.matchId, ...(site ? { site } : {}),
        hold_ms: Object.fromEntries(Object.entries(hold).map(([tid, ms]) => [String(tid), Math.round(ms)])),
        observed_ms: Math.round(this.observed[site]), source: this._holdSource || 'station' });
    }
  }
  /** A new match must not inherit the last one's point, its tally, or its once-per-game warnings. */
  _resetHill() {
    this.hill = null; this._hillTickAt = 0; this._hillBusyUntil = 0;
    this._controlSite = null; this._controlSig = ''; this._hillSaidAt = 0;
    this._hillWasContested = false; this._hillContestedAt = 0; this._hillOwnerWhenSilenced = undefined;
    this._hillTeam2Warned = false; this._hillSourceWarned = '';
    this.hold = {}; this.observed = {}; this._holdAt = 0; this._holdSource = null;
    this._possessionSig = ''; this._possessionSentAt = 0;
  }
  /** Called from tick() (~250 ms): expire a stale point, then play the possession tick on OUR clock while
   *  we hold a fresh one. This is the only place the tick fires from — a beacon arrives once per ~5 s and
   *  could never carry a 1 s cadence, and driving audio per beacon is exactly what F74 forbids. */
  _hillTick(now) {
    const h = this.hill;
    if (!h) { this._holdAt = 0; return; }   // nothing to hear: the next accrual must not count the gap
    // A grenade point expires on two missed 5 s beacons; a phone control point expires on the §3 presence
    // rule, because its advert is continuous (§5d.5). Same code, the window is the source's.
    const window = h.source === 'station' ? CONTROL_STALE_MS : HILL_PRESENCE_MS;
    if (now - h.at >= window) {   // out of range or off the point. NOT a "lost" — nobody took it from us
      this.hill = null; this._hillTickAt = 0; this._holdAt = 0;
      this._controlSig = ''; this._hillWasContested = false;   // K1: walking back into range must be able to re-announce
      this.log(`hill presence expired (${Math.round((now - h.at) / 1000)}s since its last beacon)`, 'li');
      this._changed();
      return;
    }
    this._accrueHold(h, now);   // the CLOCK runs whatever the audio does: possession is a fact about the point
    if (!this._hillAudioOn() || !this._hillMine()) return;
    if (now < this._hillBusyUntil) return;   // a callout owns the announcer for its own real length: the tick waits rather than playing under it
    // D: OUR point draining doubles the cadence. Nothing else is audible before "Hill Lost!", which arrives
    // when it is already too late — the defender hears an unchanged 1 s tick right up to the moment they
    // have lost it. `falling` comes off the advert, so this costs a comparison.
    const period = h.falling ? HILL_TICK_LOSING_MS : HILL_TICK_MS;
    if (this._hillTickAt && now - this._hillTickAt < period) return;
    const cue = this._hillCue('hill_tick');
    if (!cue.frame) return;
    this._hillTickAt = now;
    this._write([cue.frame], 'hill possession tick');
  }

  /** S45: does THIS game recharge shields? The game's armour is 0, so the shield IS the buffer -- a mirror of
   *  `compile.is_shields_preset`, down to the reason it reads the GAME's `health.max_armor` and never
   *  `this.maxArmor`: an individually handicapped player (armoured down to 0 for that one player) must not
   *  flip the branch for themselves or for anyone else. The preset is a fact about the game's design.
   *
   *  It is the opt-in on purpose, kept even now that `health.max_shield` is a real host field
   *  (`compile.HEALTH_PRESETS`): Standard ships shield 0, so `this.maxShield > 0` alone is already false
   *  there, but a host could still set a non-zero shield on an armoured game (Advanced), and armour ==0
   *  is the fact that says the shield is meant to be the buffer, not merely present on the wire. */
  get shieldRegenOn() {
    const h = this.config && this.config.health;
    return !!h && Number(h.max_armor) === 0 && this.maxShield > 0;
  }
  /** S29: the recharge, and the heartbeat that runs while there is nothing to recharge yet. Called from tick().
   *
   *  The shape, all four moments: the shield breaks (`shield_down`), the heartbeat loops while it is gone,
   *  SHIELD_REGEN_DELAY_MS of no damage starts a refill (`shield_charging`, once, on the first grant), grants
   *  land every SHIELD_REGEN_STEP_MS until the gun says the pool is full, and that frame says `shield_online`.
   *  Any damage restarts the clock and abandons the refill (`_onHp`). */
  _shieldTick(now) {
    if (!this.shieldRegenOn) return;
    // The same stand-down the other writers use. A dead, unspawned, resyncing, reconciling or stunned gun is
    // not ours to grant to, and a lost link means the write goes nowhere: in all of them the refill is
    // abandoned rather than paused, so it re-earns its delay once the player is back.
    if (this._standDown(['phase', 'spawned', 'ble', 'alive', 'reconciling', 'resync', 'tutorial', 'stunned'], now)) {
      // ⚠ Polish review 2026-09-18: restamping the quiet clock is what makes "abandoned, not paused" TRUE.
      // Clearing `_shieldRegen` alone put the next tick straight back at the top with the delay long since
      // served, so the refill resumed instantly and said `shield_charging` a SECOND time for one refill. A
      // stun, a resync, a reconcile and a BLE blip are all ordinary mid-match events. Only an abandoned
      // refill restamps: a stand-down that interrupts the WAIT does not keep pushing the clock out.
      if (this._shieldRegen) this._shieldQuietAt = now;
      this._shieldRegen = null; return;
    }
    if (this.shield >= this.maxShield) { this._shieldRegen = null; return; }   // nothing to do (the charged edge is `_onHp`'s)
    // The heartbeat runs while the shield is gone and the refill is not due yet. Asked BEFORE the refill
    // starts and answered here rather than at the top, because a heartbeat written in the same tick as
    // `shield_charging` is exactly the "it stops when the recharge starts" that Tony asked for, broken.
    if (this._shieldGaveUp || now - this._shieldQuietAt < SHIELD_REGEN_DELAY_MS) {
      // ⚠ `_shieldDown` says the shield BROKE this life, which is the right latch for the break cue and the
      // wrong one for the heartbeat: a hit that abandons a refill half way up leaves 40 of 70 on the pool,
      // and the gun went on saying the shield was gone. The heartbeat follows the POOL. And a refill that
      // GAVE UP is one nothing can fix, so replaying N74 every 1.94 s for the rest of the life is noise.
      if (this._shieldDown && this.shield === 0 && !this._shieldGaveUp && !this._shieldRegen) this._shieldLoopTick(now);
      return;
    }
    if (!this._shieldRegen) {
      this._shieldRegen = { startedAt: now, nextAt: now, grants: 0 };
      this.log(`shield recharge: ${this.shield}/${this.maxShield} after ${Math.round((now - this._shieldQuietAt) / 1000)}s without damage`, 'lk');
      this._event('shield_charging');
    }
    const r = this._shieldRegen;
    if (now < r.nextAt) return;
    if (r.grants >= Math.ceil(this.maxShield / SHIELD_REGEN_STEP) + SHIELD_REGEN_MAX_GRANTS_SLACK) {
      // The gun has taken a full pool's worth of grants and still does not report full. Stop rather than
      // write at it forever: either the echoes are lost (the pool is fine and the next `$HP` will say so) or
      // the ceiling is not what the head said, and neither is fixed by more writes.
      //
      // `_shieldGaveUp` is what makes that STICK. Clearing `_shieldRegen` alone put the next tick straight
      // back at the top with the delay long since served and a fresh grant counter -- the cap counted to ten
      // and then started again, forever, which is the failure it exists to prevent. The player earns another
      // refill by taking a hit or starting a life, both of which restamp the quiet clock.
      this._shieldRegen = null; this._shieldGaveUp = true;
      this.log(`shield recharge gave up after ${r.grants} grants -- the gun still reports ${this.shield}/${this.maxShield}`, 'le');
      return;
    }
    r.grants++; r.nextAt = now + SHIELD_REGEN_STEP_MS;
    this._write([`$LIFE,0,0,${SHIELD_REGEN_STEP},*`], `shield regen grant ${r.grants}`);
  }
  /** S45: the heartbeat, replayed for as long as the shield is down and the recharge has not started. A LOOP
   *  the node drives, because the gun has no looping `$PLAY` -- the same shape as the hill possession tick,
   *  and for the same reason: a clip relaunched faster than it runs stacks and drifts (F74). The period is
   *  the clip's own length, so each replay lands as the last one ends. `''` = the host turned the loop off. */
  _shieldLoopTick(now) {
    const f = this.frames && this.frames.cues && this.frames.cues.shield_loop;
    if (!f) return;
    const cm = this.frames.cue_ms;
    const period = cm && Object.prototype.hasOwnProperty.call(cm, 'shield_loop') ? cm.shield_loop : SHIELD_LOOP_MS;
    if (!(period > 0)) return;
    if (this._shieldLoopAt && now - this._shieldLoopAt < period) return;
    this._shieldLoopAt = now;
    this._write([f], 'shield down heartbeat');
  }
  /** S29: the pool reached its ceiling -- the refill is over and the shield is no longer down. The CUE for
   *  this moment is `_onHp`'s (`shield_online`), because only the gun's own frame proves the pool is full. */
  _shieldCharged() {
    if (this._shieldRegen) this.log(`shield recharged to ${this.maxShield} in ${this.now() - this._shieldRegen.startedAt} ms`, 'lk');
    this._shieldRegen = null; this._shieldDown = false; this._shieldLoopAt = 0; this._shieldGaveUp = false;
  }

  // ---------- clock tick (call every ~250 ms) ----------
  tick() {
    const now = this.now();
    this._awakeAt = now;             // §3.11: the heartbeat IS the proof the webview is running (see resume())
    // B4: the link watchdog. `bleUp` otherwise only ever goes false from the native disconnect callback —
    // a link the OS still calls "connected" but that has gone silent (no $HIR, no $BUT, not even the
    // ~30 s $VOLTS telemetry) would sit at `bleUp:true` for the rest of the match. Fire once the silence
    // clears LINK_STALE_MS and let `onGunStale` (BrxLink) force the radio to actually let go and retry —
    // falling back to a local `onBleDropped()` when nothing is wired (demo/tests), so the drop is at
    // least surfaced even without a real link to cycle.
    // ⚠ `this.linkWatchdog` ships FALSE (see LINK_WATCHDOG_ENABLED): until F163 is benched, silence is
    // left alone rather than paid for with a disarm and a free magazine.
    if (this.linkWatchdog && this.bleUp && this.lastGunFrameAt && now - this.lastGunFrameAt >= LINK_STALE_MS) {
      const silentMs = now - this.lastGunFrameAt;
      this.lastGunFrameAt = now;   // don't refire every tick while the forced reconnect runs its course
      this.log(`gun link silent ${Math.round(silentMs / 1000)}s — forcing a reconnect`, 'le');
      if (this.onGunStale) this.onGunStale(); else this.onBleDropped();
    }
    this._checkEcho();
    if (this.loadoutAck && now - this.loadoutAck.t > 4000) { this.loadoutAck = null; this._changed(); }
    if (this._pickDue && now - this._pickDue.at >= PICK_DEBOUNCE_MS) this._flushPick('debounce');   // A26: the last row tapped in the window goes now
    if (this.pendingPick && now - this.pendingPick.at > 6000) { this.pendingPick = null; this._changed(); }   // MC never answered — drop the optimistic row
    // F147: past TRYOUT_ARM_MAX_MS with no confirming $ALCD/$LCD, resolve it HONESTLY (polish-loop pass 2)
    // rather than silently claiming the same gun-confirmed EQUIPPED — `tryoutUnconfirmed` is what tells
    // hud.js to keep saying so (EQUIPPED · UNCONFIRMED, muted, its own glyph) instead of a settled ✓.
    // Pass 3 (MEDIUM): carries `{tab, kind}` (never just a bare flag) so hud.js can tell WHICH row this
    // was ever about — otherwise a perk picked after a timed-out weapon arm inherited the same badge on a
    // row that was never arming anything (`tryoutUnconfirmed` used to outlive the weapon it described).
    // The real duration has never been bench-timed, same as the live SWITCHING timeout this mirrors.
    if (this.tryoutArming && now - this.tryoutArming.at > TRYOUT_ARM_MAX_MS) {
      this.tryoutUnconfirmed = { tab: this.tryoutArming.tab, kind: this.tryoutArming.kind };
      this.tryoutArming = null;
      this.log('try-out arm timed out — resolved UNCONFIRMED (no confirming ammo report)', 'li'); this._changed();
    }
    if (this.phase === 'armed' && this.start) {
      const rem = this.goLiveT - now;
      // Runway cues are EDGE-triggered: fire only when crossing the threshold from above. With a runway shorter
      // than a threshold the stale cue is skipped — firing them all at arm time stacked three copies of the
      // counting track on the gun ("10, 9, 8, 10, …", bench 2026-08-25).
      const prevRem = this._prevRem != null ? this._prevRem : rem;
      this._prevRem = rem;
      const edge = (ms) => prevRem > ms && rem <= ms;
      if (edge(30000)) this._cue('runway_30');
      if (edge(20000)) this._cue('runway_20');
      if (edge(10000)) this._cue('runway_10');
      if (rem <= 9000 && rem > 3000) { const s = Math.ceil(rem / 1000); const k = `tick${s}`; if (!this.cuesFired.has(k) && this.frames && this.frames.cues && this.frames.cues.tick) { this.cuesFired.add(k); this._write([this.frames.cues.tick], 'tick'); } }
      if (rem <= 3000) this._cue('countdown');
      if (rem <= PRE_ARM_TABLE_MS && this.bleUp && !this.resync) this._preArmTable();   // 2026-09-19: hittable at go-live, not after it
      // Hold-across-disperse is bench-UNVERIFIED (start-sequence §3 / checklist NEXT #1): if the gun drops its
      // config while parked unspawned, enable rewriteHeadAtT10 to re-write frames.head at T-10 s.
      if (this.rewriteHeadAtT10 && rem <= 10000 && !this._headRewritten && this.frames && this.bleUp) { this._headRewritten = true; this._writeHead('T-10 head re-write'); }
      if (rem <= 0 && this.bleUp && !this.resync) this._spawn(false);
      this._changed();
    }
    if (this.phase === 'live') {
      if (this.endT && now >= this.endT) { this._endLocal('time-expiry'); return; }
      // Recovery: a cold boot / resync can land us DOWN (alive false) with no death time — deadAt is not
      // persisted, and resync observes a dead gun without stamping one. Without a deadAt the respawn logic
      // (timer, scanner hint, revive gate) all bail, so a recovered player is stuck with no way back
      // (bench 2026-09-04: "it isn't sensing the respawn station"). Stamp it: they are down as of now.
      if (this.reconciling && now - this.reconciling.since >= RECONCILE_MS) this._endReconcile();
      if (this._armPending && this.bleUp && !this.reconciling && now - this._armPending.at >= (this._armPending.until != null ? this._armPending.until : SPAWN_PROTECT_MAX_MS)) this._armLife(this._armPending.shotEnds === false ? 'protection over' : 'cap');   // F209; 2026-09-19 profiles
      if (this._triggerPending && this.bleUp && !this.reconciling && now >= this._triggerPending.due) this._triggerLive('weapon delay over');   // 2026-09-19
      this._noFireTick(now);   // F208
      this._cureTick(now);     // F264: and once `no_fire` is concluded, ASK the gun, then act on the answer
      this._pollTick(now);     // F264: ...and ask it every QUERY_POLL_MS anyway, so nobody has to pull a dead trigger first
      this._spawnProbeTick(now);   // F264: ...and once a life, read back the biggest write of that life
      // B5's settle window HOLDS an unattributed zero-HP frame rather than manufacturing a phantom death
      // out of a stale echo. A REAL death inside that window with no latch — grenade or station damage
      // (neither carries an $HIR to latch onto), or an $HIR simply lost — was then dropped forever:
      // `_onHp` had already written hp 0 while `alive` stayed true and `deadAt` stayed 0, the respawn
      // clock requires `!alive`, and a dead gun sends no further zero-HP frames. The player spent the
      // rest of the life a zombie at 0 HP: no DOWN screen, no respawn, no death fact for MC to score.
      // So re-examine it once the window has expired — the evidence (hp 0, on the wire) never went away,
      // only the reason to distrust it. The spawn-camp case is untouched: a FRESH latch clears
      // `_deathPending()` outright, so `_onHp` still takes that death immediately with the shooter
      // named. Held off during resync/reconcile, where the engine deliberately infers nothing and the
      // gun's own report is what moves state; the next tick after either ends catches it.
      if (this.hp === 0 && this.alive && !this.resync && !this.reconciling && !this._deathPending()) this._death(false);
      if (!this.alive && !this.deadAt && !this.resync && !this.reconciling) { this.deadAt = now; this.log('recovered while down — respawn clock started', 'li'); }
      if (this.endT) {   // A11.4 clock callouts from the node's own synced end time: edge-triggered, once each
        const left = this.endT - now, prev = this._prevLeft != null ? this._prevLeft : left; this._prevLeft = left;
        for (const [ms, k] of [[60000, 'time_60'], [30000, 'time_30'], [10000, 'time_10']]) {
          if (prev > ms && left <= ms && !this.cuesFired.has(k)) { this.cuesFired.add(k); this._event(k); this.moment = { kind: 'alert', at: now, data: { kind: k, text: k === 'time_60' ? 'ONE MINUTE LEFT' : k === 'time_30' ? '30 SECONDS' : '10 SECONDS' } }; }
        }
      }
      if (!this.alive && this.deadAt && this.respawnType === 'auto' && now - this.deadAt >= this.respawnDelayMs && this.bleUp && !this.resync && !this.reconciling) {
        const rs = !!this._resyncRevive; this._resyncRevive = false; this._revive(rs);   // §3.10: a resync re-arm is flagged respawn{resync:true}
      }
      // utility.md §4: a scanner respawn with the presence gate revives the moment the player has dwelt at
      // their team's respawn station past the delay. The trigger gate (default) waits for $BUT,0,1 instead.
      if (this.respawnType === 'scanner' && this.respawnGate === 'presence') {
        const st = this._stationRevivable(now); if (st) { this._resyncRevive = false; this._revive(false, st.id); }
      }
      if (this.stunned && now >= this.stunned.until) this._stunRestore('expired');   // F15: the stun timer -- restore the LIVE counts
      this._reassertDeathBlink(now);   // A11.6: keep the headset out-blink lit through a long DOWN (colour opt-in only)
      this._teamRepaintTick(now);      // F68: a periodic repaint that survives a miss the wire never reports (S42)
      this._recoilTick(now);           // S42: recoil recovery + the one accuracy writer/verify loop
      this._downRearm(now);            // §3.2: one $HLOOP rearm after the hands-off window (belt-and-braces; the native flash is already running)
      this._gunReadoutTick(now);       // A16 §3.1: revert the gun-body readout to rest once its hold has run out
      this._reloadTick(now);           // F123: end a takeover the gun stopped feeding — and BOOK whether the mag actually came back
      this._shieldTick(now);           // S29: the shield recharge, and the heartbeat while the shield is gone
      this._hillTick(now);             // the possession tick on OUR ~1 s clock, and the >= 2-missed-beacon presence expiry
      this._reportPossession(now);     // and the possession CLOCK, which is what the mode is scored on
      if (this.moment && now - this.moment.at > 4000) { this.moment = null; }
      // A swap the gun never confirmed with a shot: past the assumed window we TAKE the swap as done (the real
      // duration has never been timed — FOLLOWUPS F4; the next $ALCD corrects activeSlot if the gun disagrees).
      if (this.switching && now - this.switching.at > this.switchWindowMs()) {
        const to = this.switching.from === 0 ? 1 : 0; this.switching = null; this.activeSlot = to;
        this._recoilArm('swap (assumed)');   // S42: the new slot's weapon gets its own profile, at its ceiling
        this.moment = { kind: 'switched', at: now, data: { slot: to, assumed: true } };
        this.log(`swap to slot ${to} assumed after ${this.switchWindowMs()}ms (no shot yet)`, 'li');
      }
      this._changed();
    }
    if (this.resync) this._resyncTick();
  }

  _revive(resync, stationId = null, operator = false) {
    this.reloading = null; this._reloadOutcome = null; this.held = {};   // a reload that started in the last life does not follow you into this one, and no button is held across a death
    if (!this.frames) return;
    const down = this.frames.headset && this.frames.headset.down;
    if (down && down.stop) this._write([down.stop], 'down stop');   // §3.2: `$HLOOP,0,0,*` before $SPAWN — belt-and-braces, $SPAWN clears the loop on its own
    this._downRearmSent = false;   // §3.2: fresh rearm gate for the next life
    const sp = this._pickCue('respawned');   // A15.2: the spawn line rides in the revive write (one line, never two)
    const ps = this._pickFrame('pset_pool');   // A15.3: a fresh death scream for this life, written before $SPAWN
    // A17: a fresh $SIR table too, so the sound a given WEAPON makes on us changes between lives. It rides the
    // REVIVE write and not the first spawn deliberately -- the player is already down and waiting here, whereas the
    // spawn write is on the critical path and the headset needs its settling gap (F13). Re-sending $SIR rows is the
    // F11 REPAIR path, so this cannot cost us the table; the rows differ only in their sound tokens.
    // F209: a protected bundle does NOT write the take here; `_armLife` writes it once the gun can fire.
    const sir = this._protectsSpawn() ? [] : this._pickTable('sir_pool');
    // F206: the gun keeps ONE team byte, and the `pset_pool` $PSET above carries the ARMING team. A player
    // an infection flip has TURNED revives with the flip's own burst, which ends on the team they joined;
    // `frames.revive` would put them back on the arming team.
    // 2026-09-19: the respawn profile. A station revive protects, maps the trigger at once and shows the shield; every
    // other revive (timed, operator, resync, a turned player) is a timed life that holds the trigger for the weapon delay.
    const rp = this._respawnProfile();
    const tf = (rp && rp.team_flip) || this.frames.team_flip;
    const flipped = this._turned && tf && tf[String(this.teamTid)];
    const kind = rp && stationId != null && !flipped ? 'station' : 'timed';
    const revive = flipped || (rp ? (kind === 'station' ? rp.revive_station : rp.revive) : this.frames.revive);
    const life = this._lifeSeq = (this._lifeSeq || 0) + 1;   // pl3: a lost write is only this life's news
    this._writeLife([...(ps.frame ? [ps.frame] : []), ...sir, ...revive, ...(sp.frame ? [sp.frame] : [])], 'revive' + (flipped ? ' (turned)' : '') + this._lineTag(sp) + (ps.frame ? ` + scream ${ps.id}${ps.tag}` : '') + (sir.length ? ` + hit audio ${sir.length}r` : ''), life);
    this.hurtFired = false;
    this._pendingHurtWrite = false;
    // pl3 (2026-09-17): a swap or a heat reading from the last life must not follow the player into this one. An
    // operator respawn of a LIVE player skips `_death`, which is the only other place `switching` was cleared, so a
    // stale swap could flip the slot a second later, and a stale lockout reading kept OVERHEAT up. stage.py `_after_spawn` clears the same.
    this.switching = null; this.heatBySlot = {}; this._heatAt = {}; this._everHeated = {}; this._heatLock = null;
    this._holdAccuracyWrites('revive');   // the revive write owns `$AMMO` until the gun has answered it
    this._lastTeamRepaintAt = this.now();   // F68: as at spawn — the respawn flash is this life's first paint
    this._prevAmmo = {}; this._prevReserve = {}; this._shotAcct = {}; this.activeSlot = 0;   // both maps: a stun before the first shot of a NEW life must snapshot this life's reserve, not the last one's (polish review 2026-09-11)   // assumption (hardware-UNVERIFIED): a revive puts the gun back on slot 0
    this._recoilArm('revive');   // S42: a respawn resets to the weapon's ceiling
    this.alive = true; this.hp = this.maxHp; this.armor = this.maxArmor; this.shield = 0; this.deadAt = 0; this.killedBy = null;
    this.poolSrc = 'model';        // R2-3: a fresh life, and again from config.health until the gun speaks
    this._prevHp = this.hp; this._prevArmor = this.armor; this._prevShield = this.shield;
    this._spawnAt = this.now(); this._armedThisLife = false;   // B5: a settle window starts here — see `_deathPending`
    this._shotDueAt = null; this._noFirePulls = 0; this._dryPulls = 0;   // F208: a fresh life owes no shots; the RELOAD nag: and it starts loaded, so no dry spell is running
    // S29: a fresh life starts at shield 0 without the shield having BROKEN, so no heartbeat and no
    // refill in flight; the recharge delay runs from here, which is why a life's first fill lands
    // SHIELD_REGEN_DELAY_MS in and never inside the spawn write.
    this._shieldRegen = null; this._shieldDown = false; this._shieldLoopAt = 0; this._shieldGaveUp = false; this._shieldQuietAt = this.now();
    this._armAfterSpawn(false, kind);   // F209; 2026-09-19: the profile this revive used
    this._timedLifeAt = kind === 'timed' && stationId == null ? this.now() : null;   // a legacy bundle's station revive is not a timed one   // 2026-09-19: the spawn-kill window runs from a timed respawn
    this._gunTake();   // A11.7
    this.emitFact({ type: 'respawn', match_id: this.matchId, ...(resync ? { resync: true } : {}), ...(stationId != null ? { station: stationId } : {}), ...(operator ? { operator: true } : {}) });   // A47: `operator` = MC's FORCE RESPAWN (scoring keeps the streak)
    this.moment = { kind: 'redeploy', at: this.now() };
    this.log(operator ? 'respawned by the operator' : resync ? 'resync respawn' : stationId != null ? `respawned at station ${stationId}` : 'respawned', 'lk');
    this._eventLeds('respawned');   // A11 lights only (after the revive frames, so the burst ends on the fresh team colour); the sound went out with the revive write above
    if (this.frames.headset) { this.carrying = null; this._activeRole = null; if (!(this._armPending && this._armPending.shield)) this._headsetDelayed(this.frames.headset.respawn, 'respawn'); }   // 2026-09-19: the shield IS the respawn light   // led-language.md §3.1/§5: +1.0 s after $SPAWN; A11.6: white flash then dark/team
    this._changed();
  }

  /** The history entry for the match that just ended (A24: `outcome`, `team_scores`, `best_streak`, `medals` and this
   *  node's own hill hold ride along, so a recap read off the phone days later is the same story MC told).
   *  Written at the whistle, when `result` is usually still in flight — every A24 field is then `null`, and the app
   *  PATCHES the entry by `match_id` from `onResult`. Null, never a guess: a match played before the phone learned
   *  this field has them MISSING, never wrong. */
  historyEntry() {
    const R = (this.result && this.result.match_id === this.matchId) ? this.result : null;
    const my = R && R.my && typeof R.my === 'object' ? R.my : null;
    const sc = this.score || null;
    const pick = (a, b) => (a != null ? a : (b != null ? b : null));
    let hold = null;
    try { hold = (this.hold && Object.keys(this.hold).length) ? JSON.parse(JSON.stringify(this.hold)) : null; } catch (_) { hold = null; }
    return {
      t: this.now(), match_id: this.matchId,
      kills: pick(my && my.kills, sc && sc.kills), deaths: this.deaths,
      assists: pick(my && my.assists, sc && sc.assists),
      accuracy: pick(my && my.accuracy, sc && sc.accuracy),
      shots: this.shots, mode: this.config ? this.config.mode : null,
      // A24 fields — every one of them null until MC says otherwise
      outcome: R ? (R.outcome || null) : null,
      win_by: R ? (R.win_by || null) : (this.config && this.config.scoring ? this.config.scoring.win_by || null : null),
      team_scores: R && Array.isArray(R.team_scores) ? R.team_scores : null,
      best_streak: pick(my && my.best_streak, sc && sc.best_streak),
      medals: (my && Array.isArray(my.medals) ? my.medals : (sc && Array.isArray(sc.medals) ? sc.medals : null)),
      possession: hold,
    };
  }

  _endLocal(why) {
    if (this.ended) return;
    this.ended = true; this._panicked = null; this.endAck = false; this._armPending = null; this._triggerPending = null;   // F209: never arm an ended gun
    this.endedAt = this.now();   // the results screen's settle window runs from HERE, not from the result's arrival
    this._lightGen = (this._lightGen || 0) + 1;   // no delayed $GLED/$HLED/cue step from before teardown may land after it
    try { if (this.onEnd) this.onEnd(this.historyEntry()); } catch (_) { /* history is best-effort */ }
    // The tally that decides the match is the one sent AT the whistle: it is exempt from the A6.1 end freeze
    // and clamped on MC's side instead (`mc/API.md`), so send it before the phase leaves `live`.
    this._reportPossession(this.now(), true);
    if (this.matchId && !this.endedMatches.includes(this.matchId)) this.endedMatches.push(this.matchId);
    if (this.bleUp) this._writeTeardown('end', why); else { this.pendingTeardown = 'end'; this.log(`end (${why}) owed to the gun — link down`, 'le'); }
    this.spawned = false; this.alive = false; this.resync = null; this.reconciling = null; this.start = null; this._resyncRevive = false; this.reloading = null; this._reloadOutcome = null; this.held = {};
    this.stunned = null;   // F15: the end frames own the gun now
    this._recoil = null;   // S42: no more life to drive accuracy for
    this.ready = false;
    this.moment = { kind: 'match_over', at: this.now() };
    this._set('kitted');
    this.log(`match ended: ${why}`, 'lk');
  }

  // ---------- F15: the host-driven stun (EMP) ----------
  /** The proven chain (FOLLOWUPS F15): a proto-8 IR word -> the victim's `$SIR,8,0,,24` row (a STATUS function: `$HIR`
   *  fires, pools do not move, no `$HP` follows) -> `$AMMO,<slot>,0,0,1,*` for every live slot -> restore. The native
   *  stun is not relied on (2/5 singles, lasts until death). Only under `config.stun` (`stunEnabled`): the stock
   *  `<8,0>` row is the charge rifle's plain damage, and a plain hit must not disarm anyone.
   *  - EXTEND, never double-restore: a second EMP inside the window pushes `until` out and writes nothing.
   *  - The restore re-sends the LIVE counts snapshotted here (last `$ALCD` per slot, else the frame's spawn
   *    values), because a `$WEAP`/`$AMMO` re-push resets ammo to the frame's numbers (F87) and a stun must not refill.
   *  - Death cancels (`_death` -> `_stunRestore('died')`, no write): `frames.revive` carries its own `$AMMO`.
   *  - A rejoin's reconcile takes over (`_beginReconcile`), and a link that is down at expiry gets no write --
   *    the relink's reconcile re-arms it (coarsely, with the frame's counts).
   *  - Not persisted: a reload during a stun loses the timer and the relink reconcile re-arms the gun. */
  _stun() {
    if (!this.stunEnabled || this.phase !== 'live' || !this.spawned || !this.alive || this.tutorial) return;
    const now = this.now(), ms = this.stunMs;
    if (this.stunned) {
      this.stunned.until = Math.max(this.stunned.until, now + ms);
      this.log(`⚡ stun extended: ${Math.ceil((this.stunned.until - now) / 1000)} s left`, 'li');
      this._changed(); return;
    }
    const live = this._liveAmmo();
    this.stunned = { at: now, until: now + ms, ammo: live };
    // F15 (Tony, 2026-09-18): one cue on the gun that just went dark, in the same write as the disarm --
    // never repeated on an extend above, and never per tick (F274).
    this._write([...Object.keys(live).map(slot => `$AMMO,${slot},0,0,1,*`), STUN_PLAY], `stun: disarm ${ms} ms`);
    this._holdAccuracyWrites('stun disarm');   // a `$WEAP` + `$AMMO` restore would re-arm the gun mid-stun
    this.moment = { kind: 'stunned', at: now, data: { ms } };
    this._event('stunned');   // A11 presentation hook: no-op until a profile carries a `stunned` cue/burst
    this.log(`⚡ stunned ${ms} ms — by ${this.latch ? this.nameOf(this.latch.shooter_num) || TEAM_NAME[this.latch.shooter_team] || 'UNKNOWN' : 'UNKNOWN'}`, 'le');
    this._changed();
  }
  /** End the stun. Only an EXPIRY on a live, linked gun writes the restore; every other reason (death, reconcile)
   *  leaves the re-arm to the path that owns it. */
  _stunRestore(why) {
    const st = this.stunned; if (!st) return;
    this.stunned = null;
    if (why === 'expired' && this.alive && this.bleUp) {
      const life = this._lifeSeq;
      this._writeMust(Object.entries(st.ammo).map(([slot, [mag, res]]) => `$AMMO,${slot},${mag},${res},1,*`), 'stun over: restore live ammo',
        () => this._lifeSeq === life && !this._standDown(['phase', 'ble', 'alive', 'reconciling', 'stunned']));
      this._holdAccuracyWrites('stun restore');
      this.moment = { kind: 'stun_over', at: this.now() };
      this._event('stun_over');
    }
    this.log(`stun over (${why})`, 'li');
    this._changed();
  }
  /** Bench 2026-09-17: a slot's time between rounds, `$WEAP` token 14 (split index 15) from the head the gun
   *  was given. Null for a stub frame with no tokens, or no frame for that slot. PURE. */
  _fireIntervalMs(slot) {
    const f = ((this.frames && this.frames.head) || []).find(x => typeof x === 'string' && x.startsWith(`$WEAP,${slot},`));
    const p = f ? f.split(',') : null;
    const ms = p && p.length > 16 ? Number(p[15]) : NaN;
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  }
  /** The HUD's shot-ready cue for the ACTIVE slot: {at, ms, leftMs} after a shot from a weapon with at least
   *  SHOT_CUE_MIN_MS between rounds, else null (automatic weapon, unknown interval, dead, another slot). PURE. */
  shotCooldown(now = this.now()) {
    const s = this.lastShot;
    if (!s || s.ms == null || s.ms < SHOT_CUE_MIN_MS || !this.alive || this.phase !== 'live' || s.slot !== this.activeSlot) return null;
    return { at: s.at, ms: s.ms, leftMs: Math.max(0, s.at + s.ms - now) };
  }
  /** {slot: [mag, reserve]} the gun holds NOW: the node's magazine account per slot (F259 -- never the last
   *  `$ALCD`, which can be a round behind), else the frame's spawn values (F87: never a refill).
   *  The stun snapshot and the operator RESYNC GUN both restore from this, and neither consults the
   *  `shotInFlight` guard, so the VALUE has to be right on its own. */
  _liveAmmo() {
    const spawn = this._spawnAmmo(), live = {};
    for (const slot of Object.keys(spawn)) {
      const mag = this._acctLive(+slot), res = this._prevReserve[slot];
      live[slot] = [mag != null ? mag : spawn[slot][0], res != null ? res : spawn[slot][1]];
    }
    return live;
  }
  /** {slot: [mag, reserve]} straight from the bundle's spawn $AMMO frames -- the counts a slot that has never fired holds. */
  _spawnAmmo() {
    const out = {};
    for (const f of (this.frames && this.frames.spawn) || []) {
      if (f.startsWith('$AMMO,')) { const t = f.split(','); out[+t[1]] = [+t[2] || 0, +t[3] || 0]; }
    }
    return out;
  }

  /** True per-slot mags from the bundle's spawn $AMMO frames — the display/warn denominator. */
  _ammoBySlot() {
    const out = {};
    for (const f of (this.frames && this.frames.spawn) || []) {
      if (f.startsWith('$AMMO,')) { const t = f.split(','); out[+t[1]] = +t[2] || null; }
    }
    return out;
  }

  // ---------- F259: the node's own magazine account ----------
  // The gun's `$ALCD` is the truth about the magazine, but it is always a little late: the round has
  // already left by the time the frame lands. Every `$AMMO` the node writes carries a count, so a write
  // that uses the last `$ALCD` verbatim hands the gun back a round the player has already spent. That is
  // what F259 measured on the bench: the accuracy writer fired every 250-500 ms during a fight, each write
  // restored a stale count, and the magazine NEVER emptied.
  //
  // So the node keeps its own account per weapon slot: `{mag, fired, at}`. `mag` is the magazine the node
  // accepts as true, `fired` is the rounds the trigger has asked for that no `$ALCD` has confirmed yet, and
  // the number any restore should carry is `mag - fired` (`_acctLive`). The trigger press is the EARLIEST
  // evidence a round is leaving -- the node sees `$BUT,0,1` before the gun fires -- and `_awaitShot` already
  // models which presses produce no round (empty, overheat, swapping, reloading, stunned, unspawned).
  //
  // ⚠ The gun always wins. Outside the ECHO WINDOW below, every `$ALCD` re-seats `mag` on the gun's own
  // number, so a drifting account is corrected within one frame instead of fighting the hardware.
  //
  // ⚠⚠ THE ECHO WINDOW (bench 2026-09-18, the oscillation this account nearly caused). When the node writes
  // `$WEAP` + `$AMMO`, the gun answers with TWO frames: `$ALCD <clip>` (the `$WEAP` reset) and then
  // `$ALCD <n>` (our own restore landing). The second is a DECREMENT of `clip - n` -- 26 rounds, on the gun
  // Tony was holding -- and anything reading the raw frame-to-frame delta books it as fire. That fed the
  // recoil burst counter, which crossed its threshold, which wrote again, which reset again: nine seconds of
  // flapping after the player had stopped shooting, and a magazine jumping 11 to 32 and back on the HUD.
  // So from the instant the node writes a magazine count until the gun confirms it (or ACC_ECHO_MS passes),
  // the NODE owns that slot's magazine and every `$ALCD` for it is bookkeeping, not evidence. It cannot be
  // narrower: the reset frame and the restore frame are both inside it, and judging them one at a time is
  // what went wrong. It closes on the gun reporting the number we wrote, so in practice it lasts one round
  // trip, not the full deadline.
  //
  // ⚠ The two signals are SEPARATE, and keeping them apart is the whole design:
  //   the RESTORE VALUE (`_acctLive` = mag - fired) is press-aware, because a write must never hand back a
  //     round the trigger has already asked for;
  //   ROUNDS SPENT (`_acctSpent`) is the drop in the account's magazine across one `$ALCD`, and a press does
  //     NOT contribute. Stepping recoil off a press would put the write on the wire before the gun had
  //     fired, and its `$AMMO` would then take the round off a magazine the gun was about to decrement
  //     itself -- charging the player twice, which is the first bug's mirror image.
  // Because the account is what moves, the node's own writes are invisible to recoil BY CONSTRUCTION rather
  // than by a guard someone has to remember, and full-automatic fire -- one press, many rounds -- still
  // steps on every round.

  /** The magazine count a write should restore for `slot`, or null before the gun's first `$ALCD` of the
   *  life (nothing to account from -- `_recoilWrite` falls back to the frame's spawn counts).
   *  A press the gun never answered expires after TRIGGER_NO_FIRE_MS, the same window `_noFireTick` uses
   *  to call a pull unanswered, so a mis-modelled press cannot hold the account down for the whole life.
   *  PURE. */
  _acctLive(slot, now = this.now()) {
    const a = this._shotAcct[slot];
    if (!a) return null;
    const fired = a.at && now - a.at < TRIGGER_NO_FIRE_MS ? a.fired : 0;
    return Math.max(0, a.mag - fired);
  }
  /** Has the trigger asked for a round the gun has not reported yet? Bounded by the same TRIGGER_NO_FIRE_MS
   *  expiry `_acctLive` uses, so a press the gun never answers cannot hold the writer down for a whole life.
   *  PURE. */
  _acctOutstanding(slot, now = this.now()) {
    const a = this._shotAcct[slot];
    return !!(a && a.fired > 0 && a.at && now - a.at < TRIGGER_NO_FIRE_MS);
  }
  /** Is the node still waiting for the gun to echo a magazine IT wrote for this slot? See the echo-window
   *  note above: while it is, the gun's `$ALCD` says only where the node's own write has got to. PURE. */
  _acctEchoing(slot, now = this.now()) {
    const a = this._shotAcct[slot];
    return !!(a && a.echoPending > 0 && now < a.echoUntil);
  }
  /** The node has just written `$AMMO,<slot>,<mag>` and knows exactly what the gun will hold. Take the
   *  account there directly and open the echo window, so neither the `$WEAP` reset nor this restore can come
   *  back as fire. Called by `_recoilWrite`, the one writer that pairs a `$WEAP` (which resets the magazine)
   *  with an `$AMMO` (which puts it back) -- the only place a large synthetic decrement can appear. */
  _acctWrote(slot, mag, res) {
    const a = this._shotAcct[slot] || (this._shotAcct[slot] = { mag, fired: 0, at: 0, res: null, echoUntil: 0, echoExpect: null, echoPending: 0 });
    const now = this.now();
    a.mag = mag; a.fired = 0; a.at = 0;
    if (res != null) a.res = res;   // the `$WEAP` resets the RESERVE too, so the screen needs the node's number for that as well
    // ⚠ Polish review 2026-09-18: writes are COUNTED, not just timed. The verify can retry while the first
    // write's frames are still in the air, and then there are two `$WEAP` resets coming back for one window.
    // Closing on the first restore left the second reset to land on the ordinary path as a magazine rise --
    // the same leak the window exists to stop. Each write adds one, each restore answers one.
    if (!(now < a.echoUntil)) a.echoPending = 0;   // the last window lapsed unanswered: do not carry its count
    a.echoPending++;
    a.echoUntil = now + ACC_ECHO_MS; a.echoExpect = mag;
  }
  /** A trigger press that must produce a round (`_awaitShot` has already cleared every reason it would not).
   *  Books it against the account NOW, so a write between this press and the gun's `$ALCD` restores the
   *  post-shot count. Capped at the account's own magazine: a spammed trigger cannot book more rounds than
   *  the gun holds. */
  _acctPress() {
    const a = this._shotAcct[this.activeSlot]; if (!a) return;
    const now = this.now();
    // ⚠ Polish review 2026-09-18, and the reason this is not just `a.fired++`. `a.fired` is given back by
    // ONE thing only -- a confirmed magazine drop in `_acctAmmo` -- and `_acctLive` merely IGNORED a press
    // past TRIGGER_NO_FIRE_MS rather than dropping it, so the next pull that got through added to a count
    // that was still there. Five shipping weapons carry a 2-round magazine, so two unanswered pulls took the
    // account to zero while the gun was loaded. That matters because `_liveAmmo` restores `mag - fired`
    // straight to the gun on a stun or an operator RESYNC GUN, and neither consults `shotInFlight`: the
    // player got `$AMMO,<slot>,0` and a gun that could not fire until the next reload.
    if (a.at && now - a.at >= TRIGGER_NO_FIRE_MS) { a.fired = 0; a.at = 0; }
    // ...and a pull the gun is still cycling through fires nothing at all, so it must not spend a round.
    // `$WEAP` token 14 (`_fireIntervalMs`) is the weapon's own time between rounds, and it is the only
    // signal the node has for "this pull CAN be answered". A weapon whose frame declares no interval keeps
    // the old behaviour and books every press.
    const iv = this._fireIntervalMs(this.activeSlot);
    if (iv && a.at && now - a.at < iv) return;
    a.fired = Math.min(a.mag, a.fired + 1); a.at = now;
    // ⚠ Deliberately does NOT step recoil. A press books the round for the RESTORE, which must never hand
    // back a round that is already leaving; the burst counter is driven by the gun's own `$ALCD` instead
    // (`_acctAmmo` -> `_acctSpent`). Stepping here would put the degrade write on the wire BEFORE the gun
    // had fired, so its `$AMMO` would take the round off a magazine the gun was about to decrement itself,
    // and the player would be charged twice. The shot beats the write in practice -- the gun answers a
    // press in a few ms, and the bench measured a write landing in 30-90 ms.
  }
  /** Every `$ALCD` that reached `_onAmmo` (so: not stunned) feeds the account FIRST, before anything else in
   *  that function books anything from the frame. Returns the magazine `_onAmmo` should measure this frame
   *  against, or NULL when the frame is the node's own write coming back and nothing may be booked from it.
   *
   *  Inside the echo window there are exactly two cases:
   *    above what we wrote   the `$WEAP` reset, on its way back up to the compiled clip. Not news: null.
   *    at or below it        our `$AMMO` has landed. Close the window and measure from the number WE wrote.
   *
   *  ⚠ A round that leaves INSIDE the window is not booked (the window is one round trip, so at most one).
   *  Making it exact needs the node to tell a real round from the reset while both read above the written
   *  count, and the only signal for that is the write's flight time, which the node does not have. See the
   *  slow-link note in FOLLOWUPS: at the measured 30-90 ms the window is narrower than the gap between
   *  rounds and this does not arise -- `state().ammo` and `shots` both come out exact in the tests. */
  _acctAmmo(slot, mag, prev) {
    const a = this._shotAcct[slot];
    if (!a) { this._shotAcct[slot] = { mag, fired: 0, at: 0, res: null, echoUntil: 0, echoExpect: null, echoPending: 0 }; return prev; }   // the first frame of a life seeds it
    if (this._acctEchoing(slot)) {
      if (mag > a.echoExpect) return null;
      prev = a.mag;         // the restore has landed: measure from the number the node wrote, not from the reset
      a.echoPending--;      // ...and it answered one write. Another may still be in the air behind it.
    }
    if (!(a.echoPending > 0)) { a.echoPending = 0; a.echoUntil = 0; a.echoExpect = null; }
    const before = a.mag;   // the ACCOUNT's magazine, which the echo window keeps clear of the node's own writes
    const d = prev != null && mag < prev ? prev - mag : 0;
    if (d) { a.fired = Math.max(0, a.fired - d); if (!a.fired) a.at = 0; }   // the gun has answered that many presses
    a.mag = mag;                                                             // the gun wins, always
    a.res = null;                                                            // this frame IS the gun, so it owns the reserve again
    this._acctSpent(slot, before);
    return prev;
  }
  /** The magazine, denominator and reserve the HUD shows. Split out so the echo path can publish the
   *  ACCOUNT while the gun is briefly reporting the magazine the node's own `$WEAP` reset gave it --
   *  Tony, bench 2026-09-18: "it shoots up to 32 while shooting ... it syncs on trigger release". Every
   *  ammo-shaped thing on the screen reads these three: the gauge, the pip count, the `mag` text and the
   *  low-ammo warning, so a warning blinking off because the gun momentarily said "full" is the same bug. */
  _publishAmmo(slot, mag, reserve) {
    if (mag == null) return;
    this.magBySlot[slot] = Math.max(this.magBySlot[slot] || 0, mag);
    this.ammo = mag; this.mag = this.magBySlot[slot];
    if (reserve != null && !Number.isNaN(reserve)) this.reserve = reserve;
  }
  /** Rounds that LEFT the gun: the drop in the ACCOUNT's magazine across one `$ALCD`, and nothing else.
   *  The only thing that drives the recoil burst counter.
   *
   *  ⚠ Not the raw frame-to-frame delta (`_prevAmmo`), which counts the node's own `$WEAP` reset and `$AMMO`
   *  restore as a 26-round burst and made the writer oscillate on hardware. The echo window keeps `a.mag`
   *  clear of both, so a write is invisible here BY CONSTRUCTION, not by a guard someone has to remember. */
  _acctSpent(slot, before) {
    const a = this._shotAcct[slot], r = this._recoil;
    // ⚠ The model is armed for a SLOT, so that is what the round has to have come out of. This asked
    // `slot === this.activeSlot`, and `activeSlot` is whatever spoke LAST: melee is slot 4 and arrives on
    // its own `$ALCD` without the model re-arming, so after every swing the next real round out of the
    // primary was judged against the wrong slot and dropped from the burst (polish review 2026-09-18).
    if (!a || !r || before == null || slot !== r.slot || this.phase !== 'live') return;
    const n = before - a.mag;
    if (n > 0) this._recoilStep(n);
  }

  // ---------- S42/F259: node-driven recoil -- the accuracy ceiling/floor is OURS, not the gun's ----------
  // F230 (bench 2026-09-17): only one of three guns decayed live accuracy under sustained fire, so the
  // native t21->t22 walk is not a lever a game can be balanced on. Every weapon ships t21==t22==100
  // (native walk off) and this module drives the SAME two tokens itself, from the shot stream the node
  // already watches (`_onAmmo`'s mag decrement), never from a timer that guesses when the trigger is
  // down. A rewritten `$WEAP` resets the magazine/reserve/live-accuracy to the frame's baked-in values
  // (bench 2026-09-17), so every accuracy write carries a same-breath `$AMMO` restore of the LIVE
  // counts -- the same disarm/restore shape as the stun above (§3.12 in node.md, F15).
  //
  // F259 (Tony, at the bench 2026-09-18): recoil is a SHORT LADDER OF STATES, not a per-shot walk.
  // Accuracy is CRISP, then DEGRADED once the burst reaches `afterShots` rounds, then HEAVY once it
  // reaches `heavyAfter` -- Tony, after the first version ran on hardware: "maybe we can update it to do
  // 2 steps instead of 1? normal degraded and very degraded". The trigger going quiet for `settleMs`
  // puts it back to crisp in ONE step from wherever it got to, because the player releases once.
  //
  // ⚠ THE PROPERTY TO PROTECT: the number of writes is proportional to the number of STATE CHANGES and
  // never to the number of rounds. A burst of any length costs at most three `$WEAP` writes -- two down
  // and one back -- where the old ladder cost about twenty. Every write resets the gun's magazine, so
  // every write is a chance to lose a round, which is the whole of F259. A third rung would cost one
  // more write a burst; a rung per round is the bug.
  //
  // Both steps land DURING the burst, which is the point of recoil -- neither is deferred to the
  // trigger going quiet.
  //
  // Seam for stance/flinch (S42, not built here): a future stance module can move the threshold
  // `_recoilStep` reads from the motion sensor; a future flinch module can read `this._recoil.value`
  // (today's live accuracy) to decide how hard to jolt. Neither touches the writer or the verify/retry
  // loop below.
  get recoilEnabled() { return !this.config || this.config.recoil !== false; }   // S42: default ON -- only an explicit `false` turns it off
  /** {weapon_id} for the ACTIVE slot, straight off the loadout -- the same lookup `_reloadPulled` and
   *  `weaponName` already use. */
  _activeWeaponId() {
    const ws = this.player && this.player.loadout && this.player.loadout.weapons;
    const w = ws && (ws[this.activeSlot] || ws[0]);
    return w ? w.weapon_id : null;
  }
  /** S42 × A44/A47/F15: stand the accuracy writer down while a write that carries its own `$AMMO` is in
   *  flight (spawn, revive, operator RESYNC GUN, stun disarm, stun restore, reconcile re-arm). Any verify
   *  still open is DROPPED here -- an `$ALCD` answering THAT write proves nothing about ours -- and ONLY
   *  THEN is the model re-marked dirty, because dropping the verify is what makes the last write
   *  unconfirmed again: the gun may or may not have taken it, and none of these other writes carries a
   *  `$WEAP` (that only rides `frames.head`), so nothing else threatens a value already confirmed sitting
   *  on the gun. Polish review 2026-09-18: this used to mark dirty unconditionally, including when the
   *  writer was already idle (no verify open, nothing to lose) -- a redundant re-send of the SAME value
   *  every hold. */
  _holdAccuracyWrites(why) {
    this._accHoldUntil = this.now() + ACC_HOLD_MS;
    this._accHoldWhy = why;   // published as `state().accHold`: a reader should never have to guess which write took the gun
    const r = this._recoil; if (!r) return;
    const droppedVerify = r.pendingWriteAt !== 0;
    r.pendingWriteAt = 0; r.retried = false;
    if (!r.disabled && droppedVerify) r.dirty = true;
    this.log(`accuracy writes held ${ACC_HOLD_MS} ms — ${why}`, 'li');
  }
  /** The three-state shape, read from the catalogue's `recoil` block.
   *
   *  ⚠ The block the catalogue ships TODAY is `{ceiling, floor, per_shot, recover_ms}`, the old gradual
   *  ladder's shape, and `mcp/brx_mcp/mc/weapons.json` is owned elsewhere. So this reads the fields the
   *  model wants (`crisp`, `degraded`, `heavy`, `after_shots`, `after_heavy`, `settle_ms`) and derives
   *  each one when it is absent, which is how the new fields land without a second change here. The
   *  derivation reproduces the catalogue owner's table exactly, because the table is the old ladder read
   *  as three rungs rather than twenty:
   *    crisp       the ladder's CEILING -- where the weapon has always started.
   *    heavy       the ladder's FLOOR -- where it has always bottomed out. The second step therefore
   *                costs no weapon its identity: the assault rifle still ends at 70, it just gets there
   *                in two visible stages.
   *    degraded    halfway between the two, rounded DOWN (the burst rifle's 100/85 reads as 92).
   *    after_shots the ladder's LENGTH: the rounds it took to walk ceiling -> floor at `per_shot`. An
   *                assault rifle (100 -> 70 at 10) reads as 3 rounds, a force rifle (100 -> 60 at 10) as
   *                4, a stinger (100 -> 45 at 8) as 7. Those are playable numbers, not placeholders.
   *    after_heavy RECOIL_HEAVY_BURST_FACTOR times `after_shots`. See that constant: the doubling is a
   *                reading, not a measurement.
   *    settle_ms   RECOIL_SETTLE_MIN_MS or `recover_ms`, whichever is longer. See that constant: a shorter
   *                floor would let a gap between two rounds read as a player lowering the weapon.
   *
   *  ⚠ NOTHING DECLARES THESE FIELDS YET, so the derivation IS the design for every weapon (S54).
   *  `weapons.json` carries only {ceiling, floor, per_shot, recover_ms}. A proposal exists to raise three
   *  floors -- the SMG and the Suppressor from 55, the Stinger from 45, all to 60 -- because the accuracy
   *  bench measured only 7 of 18 shots landing at 50 to 60, and a weapon that lands 39% of its rounds is
   *  removed from the fight rather than penalised. That raise is F268 and IT IS NOT SHIPPED: an earlier
   *  draft of this comment and of spec/node.md said those three weapons DECLARE `heavy`, which was never
   *  true of any row. It wants the same bench pass as the doubling above: a magazine of full auto at 60
   *  and again at 55, against a static target, counting `$HIR`.
   *
   *  A weapon that cannot degrade (floor == ceiling, which is most of the catalogue) arms NOTHING: there
   *  is no state for it to change, so there is no write for it to make. Returns null for those.
   *
   *  ⚠ An `after_heavy` at or below `after_shots` is not rejected: the burst that crosses the first
   *  threshold crosses the second in the same breath, so the weapon drops straight to `heavy` in ONE
   *  write and `degraded` never appears. That is coherent, it costs no extra write, and it is the
   *  catalogue's choice to make. PURE. */
  _recoilProfile(r) {
    if (!r) return null;
    const crisp = +(r.crisp != null ? r.crisp : r.ceiling);
    const bottom = +(r.heavy != null ? r.heavy : r.floor);   // the ladder's floor: `heavy` once the catalogue declares it
    const perShot = Math.max(0, +r.per_shot || 0);
    const after = Math.round(+(r.after_shots != null ? r.after_shots
      : (perShot > 0 ? Math.ceil((crisp - bottom) / perShot) : 0)));
    const settle = Math.max(RECOIL_SETTLE_MIN_MS, +(r.settle_ms != null ? r.settle_ms : r.recover_ms) || 0);
    if (!(crisp > 0) || !(bottom < crisp) || !(after > 0)) return null;
    const mid = Math.round(+(r.degraded != null ? r.degraded : Math.floor((crisp + bottom) / 2)));
    // The two rungs must be DISTINCT VALUES, or the second write spends a magazine reset to send the gun
    // the number it is already holding. A ladder too short to split in two collapses back to one step.
    const two = mid > bottom && mid < crisp;
    return { crisp, degraded: two ? mid : bottom, afterShots: after, settleMs: settle,
      heavy: two ? bottom : null,
      heavyAfter: two ? Math.round(+(r.after_heavy != null ? r.after_heavy : after * RECOIL_HEAVY_BURST_FACTOR)) : 0 };
  }
  /** (Re)arm the accuracy model for the ACTIVE weapon: spawn, revive, a confirmed weapon swap and the
   *  reconcile re-arm all call this, because each one is a point where the gun's OWN live accuracy is known
   *  to be (or is assumed to be, for an off-slot swap -- a bench gap, not a design one) back at that
   *  weapon's CRISP value, with no burst behind it. A weapon with no usable `recoil` profile, or
   *  `config.recoil === false`, arms nothing. */
  _recoilArm(why) {
    this._recoil = null;
    if (!this.recoilEnabled) return;
    const id = this._activeWeaponId(); const row = id && this.weaponRow(id);
    const p = this._recoilProfile(row && row.recoil);
    if (!p) return;
    this._recoil = { weaponId: id, slot: this.activeSlot, crisp: p.crisp, degraded: p.degraded, afterShots: p.afterShots, settleMs: p.settleMs,
      heavy: p.heavy, heavyAfter: p.heavyAfter,
      value: p.crisp, state: 'crisp', burst: 0, dirty: false,
      lastShotAt: 0, lastWriteAt: 0, lastWriteValue: null, pendingWriteAt: 0,
      lastSeenAcc: null, retried: false, disabled: false, giveUp: false };
    // The gun is at whatever t21 the COMPILED frame baked in, which is 100 on every weapon today: compile.py
    // never writes t21/t22, because every captured frame ships t21 == t22 == 100 (native walk off, F230). So
    // arming asserts nothing and writes nothing. The moment the catalogue declares a `crisp` that is not the
    // frame's own value, the gun and this model would disagree for a whole burst before anything corrected
    // it -- so compare, and mark dirty when they differ. Costs one write a life in that case and nothing today.
    const baked = this._headAccuracy(this.activeSlot);
    if (baked != null && baked !== this._recoil.crisp) {
      this._recoil.dirty = true;
      this.log(`recoil: the compiled $WEAP holds accuracy ${baked}, the weapon's crisp value is ${this._recoil.crisp} — asserting it (${why})`, 'li');
    }
  }
  /** t21 off the compiled `$WEAP` for a slot, or null when there is no frame or the token is not a number.
   *  The one reading of what accuracy the gun is holding before this module writes anything. PURE. */
  _headAccuracy(slot) {
    const f = (this.frames && this.frames.head || []).find(x => typeof x === 'string' && x.startsWith(`$WEAP,${slot},`));
    const p = f ? f.split(',') : null;
    if (!p || p.length <= ACC_CEILING_IDX) return null;
    const n = Number(p[ACC_CEILING_IDX]);
    return Number.isFinite(n) ? n : null;
  }
  /** A shot just left the active slot's magazine (`_onAmmo`'s mag decrement, `n` rounds this frame --
   *  almost always 1, but a lost `$ALCD` can report more than one gone at once). Counts it against the
   *  burst; the `afterShots`-th round degrades the weapon and the `heavyAfter`-th round degrades it again,
   *  and every other round costs nothing -- the state is already where the burst puts it, so nothing is
   *  dirty and nothing is written. A burst therefore writes once per STATE CHANGE and never per round,
   *  which is the property to protect: every write resets the gun's magazine, so every write is a chance
   *  to lose a round (F259). */
  _recoilStep(n) {
    const r = this._recoil; if (!r || r.disabled || n <= 0) return;
    const now = this.now();
    r.lastShotAt = now;
    r.burst += n;
    // The BURST decides the state, never the state that came before it. A frame reporting several rounds
    // gone at once (a lost `$ALCD`) must land on the rung those rounds earned in ONE write, rather than
    // walk down a write at a time -- the walk is exactly what F259 took out.
    const want = r.heavy != null && r.burst >= r.heavyAfter ? 'heavy'
      : r.burst >= r.afterShots ? 'degraded'
      : 'crisp';
    if (want === r.state) return;
    r.state = want; r.value = want === 'heavy' ? r.heavy : want === 'degraded' ? r.degraded : r.crisp; r.dirty = true;
    // Flush from HERE rather than waiting for the next tick. This instant is the freshest the magazine
    // account will ever be -- the `$ALCD` that booked this very round has just landed, so nothing is
    // unaccounted for -- and every millisecond between the account and the `$AMMO` restore is a
    // millisecond in which another round can leave unseen. `_recoilFlush` still applies every guard.
    this._recoilFlush(now);
  }
  /** tick(): the settle clock (the trigger quiet for a full `settleMs`, which is long enough that a burst
   *  weapon's own gap between rounds is never read as a release) and the one writer/verify flush. Called
   *  every tick whether or not a shot happened, because settling and the verify-grace expiry are both
   *  TIME, not event, driven. A burst that never reached the threshold is forgotten here too, so three
   *  rounds now and three in a minute are not one six-round burst.
   *
   *  The recovery is ONE step from wherever the burst left the weapon -- degraded or heavy -- straight
   *  back to crisp. The player releases the trigger once, so the gun is told once. */
  _recoilTick(now) {
    const r = this._recoil; if (!r || !this.alive) return;   // a dead gun has no accuracy worth spending a write on (a write would not revive it either, bench 2026-09-17 -- just wasted BLE traffic)
    if (!r.disabled && now - r.lastShotAt >= r.settleMs) {
      r.burst = 0;
      if (r.state !== 'crisp') { r.state = 'crisp'; r.value = r.crisp; r.dirty = true; }
    }
    this._recoilFlush(now);
  }
  /** The single writer. Verifies a write already in flight before considering a new one (so a value
   *  that changes again before the verify window closes is simply picked up here, never queued behind
   *  it), then the guards: never mid-reload, never mid-swap, never while the gun is OVERHEATED
   *  (`$ALCD` token 5 at or above `HEAT_LOCKOUT`, bench 2026-09-17: firing stops at 99 and only the
   *  reload lever vents it), and never inside the minimum write gap.
   *
   *  ⚠ The overheat guard read `this.overheatLocked` until 2026-09-17, and NOTHING set that flag, so
   *  the guard was dead code and the writer was free to write through a lockout. Found by the HUD
   *  session reading this file, not by a test: the test asserted the flag, which is the mistake. It
   *  now reads the gun's own heat, and its test drives a real `$ALCD` heat frame. */
  _recoilFlush(now) {
    const r = this._recoil; if (!r) return;
    if (r.pendingWriteAt) {
      if (now - r.pendingWriteAt < ACC_VERIFY_GRACE_MS) return;
      this._recoilVerify(now);
    }
    if (r.disabled || !r.dirty) return;
    // F259 step 2: the minimum gap throttles a RE-SEND (a retry, a re-assertion after a hold), never a state
    // change. See ACC_WRITE_MIN_GAP_MS: the state machine bounds a burst to three writes by itself, and a
    // state change deferred to the clock is the write that costs the player a round.
    if (r.value === r.lastWriteValue && now - r.lastWriteAt < ACC_WRITE_MIN_GAP_MS) return;
    // The writer's stand-down set (`STAND_DOWN`), unchanged by the 2026-09-17 maint pass:
    //   reconciling / resync  §3.10: the node infers nothing in these windows, and both re-arm the gun themselves.
    //   switching / reloading the gun is mid-takeover; a `$WEAP` re-push lands in the middle of it.
    //   heat                  merge 2026-09-17: `overheatLocked` was a seam nothing set. The node DOES track the
    //                         lockout (`_heatBlocksFire`, heat >= HEAT_LOCKOUT on the active slot), and a locked
    //                         gun cannot fire, so the write is both pointless and badly timed.
    //   stunned / accHold     A44/A47/F15: a spawn, revive, operator resync or stun write owns `$AMMO` in flight.
    //   ble                   polish review: no recoil write to a gun whose link just dropped.
    if (this._standDown(['reconciling', 'resync', 'switching', 'reloading', 'stunned', 'heat', 'accHold', 'shotInFlight', 'ble'], now)) return;
    this._recoilWrite(now);
    if (r.giveUp) { r.disabled = true; r.giveUp = false; }
  }
  /** Judge the write `_recoilFlush` is holding open once its grace window has closed (or a fresher
   *  `$ALCD` already answered it -- `_recoilObserve` keeps `lastSeenAcc` current either way). A first
   *  mismatch retries once; a second gives up for the rest of the life: restore the ceiling (both
   *  tokens) with the live ammo and stop driving accuracy, logged so a field session can see it. */
  _recoilVerify(now) {
    const r = this._recoil; r.pendingWriteAt = 0;
    if (r.lastSeenAcc === r.lastWriteValue) { r.retried = false; return; }
    if (!r.retried) {
      r.retried = true; r.dirty = true;
      this.log(`recoil write unverified (wrote ${r.lastWriteValue}, gun answered ${r.lastSeenAcc}) — retrying`, 'li');
    } else {
      this.log(`recoil write failed twice (wrote ${r.lastWriteValue}, gun answered ${r.lastSeenAcc}) — restoring the crisp value and stopping for this life`, 'le');
      r.value = r.crisp; r.state = 'crisp'; r.burst = 0; r.dirty = true; r.giveUp = true;
    }
  }
  /** Pin BOTH t21 and t22 to the live value on the active slot's compiled `$WEAP` frame (never
   *  `crisp`/`degraded` separately) -- a written value is honoured even on a gun whose native walk
   *  never moves (bench 2026-09-17), so pinning both sidesteps F230 rather than depending on it.
   *  Immediately followed by an `$AMMO` restore of the magazine, mirroring the stun disarm/restore above.
   *
   *  ⚠ This is a TARGETED MUTATION of the frame MC compiled, not a frame rebuilt from the catalogue. Only
   *  the two accuracy tokens move; every other token goes back byte-identical, including the ones this file
   *  knows nothing about. Bench 2026-09-18: `$WEAP` t1 is `WeaponIRSource`, and on the Shotgun, the Plasma
   *  Sniper and the Rocket Launcher it is 2 -- every trigger pull also fires a SECOND word out of the
   *  shooter's own headset, configured by t12, t13 and t42. A rebuild that dropped those would disarm that
   *  word silently: the weapon keeps firing, the player notices nothing, and three weapons lose half their
   *  output. engine.test.mjs pins the whole token vector, not those three numbers, so a field added later
   *  is covered too.
   *
   *  ⚠ F259: the magazine comes from the node's OWN account (`_acctLive`), never from the last `$ALCD`.
   *  The `$WEAP` on the line above has just reset the gun's magazine to the frame's baked-in clip, so the
   *  `$AMMO` beside it decides what the player is left holding. Restoring the last count the node happened
   *  to receive gave a round back every time one was in flight, and the magazine never emptied. */
  _recoilWrite(now) {
    const r = this._recoil; if (!r) return;
    r.dirty = false;
    const base = (this.frames && this.frames.head || []).find(f => typeof f === 'string' && f.startsWith(`$WEAP,${this.activeSlot},`));
    if (!base) return;                                    // nothing compiled for this slot -- nothing to mutate
    const p = base.split(',');
    if (p.length <= ACC_FLOOR_IDX) return;                 // a frame too short to carry the tokens (synthetic test row)
    p[ACC_CEILING_IDX] = String(r.value); p[ACC_FLOOR_IDX] = String(r.value);
    const spawn = (this._spawnAmmo() || {})[this.activeSlot];
    const acct = this._acctLive(this.activeSlot, now);
    const mag = acct != null ? acct : (spawn ? spawn[0] : null);
    const res = this._prevReserve[this.activeSlot] != null ? this._prevReserve[this.activeSlot] : (spawn ? spawn[1] : null);
    const write = [p.join(',')];
    if (mag != null) {
      write.push(`$AMMO,${this.activeSlot},${mag},${res != null ? res : 0},1,*`);
      this._acctWrote(this.activeSlot, mag, res);   // F259: the node knows what the gun will hold -- its own echo is not fire, and not news for the screen
    }
    this._write(write, `recoil ${r.state} ${r.value}/${r.crisp}${r.retried ? ' (retry)' : ''}`);
    r.lastWriteAt = now; r.pendingWriteAt = now; r.lastWriteValue = r.value;
  }
  /** Every `$ALCD` that names a slot feeds this, whether or not a write is pending -- `lastSeenAcc`
   *  stays the freshest live-accuracy report the gun has sent. A frame that MATCHES a pending write
   *  confirms it immediately (bench 2026-09-17: a write applies in 30-90 ms, well inside the grace
   *  window, so a sustained-fire chain does not have to wait out the full grace on every step); a
   *  frame that does not match leaves the write pending -- an early stale answer must not be judged a
   *  failure while the grace window (`_recoilFlush`'s fallback) is still open. */
  _recoilObserve(acc, slot) {
    const r = this._recoil; if (!r || Number.isNaN(acc) || slot !== this.activeSlot) return;
    r.lastSeenAcc = acc;
    if (r.pendingWriteAt && acc === r.lastWriteValue) { r.pendingWriteAt = 0; r.retried = false; }
  }

  /** Loadout ammo for slot 0 straight from the bundle's spawn frames (display truth for the lobby plate). */
  _loadAmmo() {
    const f = this.frames && this.frames.spawn && this.frames.spawn.find(x => x.startsWith('$AMMO,0,'));
    if (!f) return [null, null];
    const t = f.split(',');
    return [+t[2] || null, +t[3] || null];
  }

  /** Player tapped OK on the result screen → fall through to the 'MATCH COMPLETE' over screen. */
  ackEnd() { if (this.ended) { this.endAck = true; this._changed(); } }

  _writeTeardown(kind, why) {
    this._armPending = null; this._triggerPending = null;   // F209
    if (kind === 'panic') { if (this.frames && this.frames.panic) this._write(this.frames.panic, `panic (${why})`); else this._write(['$CLEAR,*', '$SP,99,*'], `panic (${why})`); return; }
    if (this.frames) {
      this._write(this.frames.end, `end (${why})`);
      // A11.4 HUD-driven ending: in infection a survivor whose clock ran out KNOWS it survived -- it never
      // turned -- so it plays "the survivors have held their ground" itself; everyone else gets game_over.
      const c = this.frames.cues || {};
      const survived = why === 'time-expiry' && this.config && this.config.mode === 'infection' && !this._turned && c.survivors_win;
      const f = survived ? c.survivors_win : c.game_over;
      if (f) this._write([f], survived ? 'cue survivors_win' : 'cue game_over');
    }
  }

  // ---------- control ----------
  control({ cmd, seq, match_id, player_id }) {
    switch (cmd) {
      case 'end': case 'recall':
        // A34: MC ends a phone it finds still LIVE in a RETIRED match from that phone's own heartbeat, and names
        // the match. An end for some OTHER match must never stop the one this node is actually playing (a
        // reconnect can deliver a stale end after a newer start). No match_id = the operator's END/RECALL as before.
        if (match_id && this.matchId && match_id !== this.matchId) { this.log(`control ${cmd} for ${match_id} — not this match (${this.matchId}) — ignored`, 'li'); return; }
        if (this.phase === 'live' || this.phase === 'armed' || this.phase === 'lobby') this._endLocal(cmd);
        // Silently ignoring it is why "END MATCH EARLY did not reach the HUDs" was undiagnosable:
        // both phones were already in `kitted`, where this is a no-op, and nothing said so anywhere.
        else this.log(`control ${cmd} ignored — phase is ${this.phase}`, 'li');   // correct on an unkitted phone: info, not error
        return;
      case 'abort_start':
        if (this.phase === 'armed' && (seq == null || (this.start && this.start.seq === seq))) { this.start = null; this.cuesFired = new Set(); this._write([PLAYX], 'abort'); this._set('lobby'); }
        else if (this.phase === 'live' && this.start && this.start.seq === seq) this._endLocal('abort_start(live)=recall');
        return;
      case 'resync': case 'respawn': case 'relink':
        // A47 (bench 2026-09-17): the operator's menu on MC's LIVE board, aimed at ONE player. It must name THIS
        // match and, when it names a player, this player: a late push from an older match or a mis-bound phone
        // must never respawn anyone. The LIVE confirm on MC is the operator's confirm, so there is no tap here.
        if (!match_id || match_id !== this.matchId) { this.log(`operator ${cmd} for ${match_id || 'no match'} — not this match (${this.matchId || 'none'}) — ignored`, 'li'); return; }
        if (player_id && this.player && this.player.player_id && player_id !== this.player.player_id) { this.log(`operator ${cmd} for player ${player_id} — not this player — ignored`, 'li'); return; }
        return this._operator(cmd);
      case 'panic':
        this._lightGen = (this._lightGen || 0) + 1;   // same as _endLocal: cut off any pending delayed light/cue step immediately, not just once delivered
        if (this.bleUp) this._writeTeardown('panic', 'control'); else { this.pendingTeardown = 'panic'; this.log('panic owed to the gun — link down', 'le'); }
        this._resyncRevive = false;   // a panic does NOT retire the match_id — a NEWER start (higher seq) is still accepted later
        // …but a WS welcome re-delivering the SAME schedule must not re-arm a gun the operator just cleared.
        this._panicked = this.start ? { match_id: this.start.match_id, seq: this.start.seq } : null;
        this.spawned = false; this.alive = false; this.start = null; this.resync = null; this.reconciling = null;
        if (this.phase !== 'idle' && this.phase !== 'connected') this._set('kitted');
        this.ready = false;
        return;
      default: return;
    }
  }

  /** A47: one operator action from MC. Every refusal is logged, so "the operator pressed it and nothing
   *  happened" is readable from the phone's log.
   *  - `resync`: `_operatorResync` -- the live gun's state again, with no death and no pool change.
   *  - `respawn`: `_revive` -- the normal revive (full pools, A44 spawn protection, trigger mapped), no death, no kill.
   *  - `relink`: `onRelink` -- the HUD's RELINK GUN (app.js wires it to `link.relink()`). */
  _operator(cmd) {
    const why = this._operatorAct(cmd);
    // pl3 (2026-09-17): MC learns the outcome through the persisted fact path, so an operator press that did
    // nothing is visible on the board and not only in the phone's log. `why` is the refusal the log shows.
    this.emitFact({ type: 'operator_result', cmd, ok: !why, ...(why ? { why } : {}), match_id: this.matchId,
      player_id: this.player && this.player.player_id != null ? this.player.player_id : null });
  }
  /** Runs one operator command. Returns null when it acted (for relink: when the relink started), else the short
   *  refusal reason it logged. */
  _operatorAct(cmd) {
    if (cmd === 'relink') {
      if (!(this.phase === 'lobby' || this.phase === 'armed' || this.phase === 'live')) { const why = `phase is ${this.phase}`; this.log(`operator relink ignored — ${why}`, 'li'); return why; }
      if (typeof this.onRelink !== 'function') { const why = 'this build has no relink hook'; this.log(`operator relink ignored — ${why}`, 'le'); return why; }
      this.log('operator relink: dropping and reconnecting the gun', 'lk');
      try { Promise.resolve(this.onRelink()).catch(e => this.log(`operator relink failed: ${e && e.message || e}`, 'le')); } catch (e) { this.log(`operator relink failed: ${e && e.message || e}`, 'le'); return `relink failed: ${e && e.message || e}`; }
      return null;
    }
    // pl3: `resync` is the restart evidence protocol (§3.10). It owns the gun's state until it concludes, and an
    // operator write in the middle would feed it evidence the gun never produced on its own.
    // The first blocking name in `STAND_DOWN` order, turned into the line the operator reads. The table's
    // order IS this message's order, so the refusals come out exactly as they did before the 2026-09-17 pass.
    const blocked = this._standDown(['phase', 'spawned', 'bundle', 'ble', 'reconciling', 'resync', 'tutorial']);
    const why = blocked ? operatorRefusalFor(blocked, this) : null;
    if (why) { this.log(`operator ${cmd} ignored — ${why}`, 'le'); return why; }
    if (cmd === 'respawn') {
      this.log(`operator respawn (${this.alive ? 'alive' : 'down'} at hp ${this.hp})`, 'lk');
      this._stunRestore('operator respawn');   // no write: the revive's own $AMMO re-arms
      this._resyncRevive = false;
      this._revive(false, null, true);
      return null;
    }
    return this._operatorResync();
  }
  /** A47 RESYNC GUN: re-send what a live gun needs to play, and nothing that heals, kills or re-heads it:
   *  `$TID`, the current `$AMMO` per slot (the stun snapshot's counts, never a refill), the trigger mapping
   *  `$BMAP,0,0`, then one `sir_pool` take through `_armLife` (retried on a failed write; on a 'tmp' bundle it also
   *  writes `spawn_protect_off`, so a resync always ends spawn protection). The rejoin reconcile
   *  is not reused: it disarms for RECONCILE_MS, re-arms with the SPAWN counts and writes no `$TID`/`$BMAP`.
   *  Never `$SPAWN`, `$PSET` or a head: a config to a gun in play clears `spawned`. A take already pending
   *  (spawn protection, A44) is left to its own trigger. A down player is refused: FORCE RESPAWN is the cure. */
  _operatorResync() {
    // Two refusals of RESYNC GUN's own, kept out of `_operatorAct`'s subset because each names its own cure.
    // The predicate comes from `STAND_DOWN` like every other; only the message is local.
    if (this._standDown(['alive'])) { this.log('operator resync ignored — the player is down (FORCE RESPAWN revives)', 'le'); return 'the player is down'; }
    if (this._standDown(['stunned'])) { this.log('operator resync ignored — stunned (the stun restore re-arms)', 'le'); return 'stunned'; }
    // F264 (Tony, 2026-09-18): ASK, THEN WRITE ANYWAY -- the probe and the writes below are NOT sequenced.
    // `_askGun` below only sends the $LIFE probe; it does not wait for the $HP reply before this method goes
    // on to `_writeMust` the $TID/$AMMO/$BMAP burst. The probe still earns its place: its reply lands through
    // the ordinary handler, so a gun that had died while we thought it alive books its death there instead
    // of staying invisible -- writing blind at 14 frames is what failed on 2026-09-18. Gating the writes on
    // the $HP answer would close that gap properly; out of scope before the weekend (FOLLOWUPS: polish
    // review, added after the merge).
    this._askGun('operator resync: read the gun first');
    const life = this._lifeSeq;
    this._writeLost = null;   // pl4: the operator's cure for a lost spawn/revive write
    const tid = this._liveTid();
    const ammo = Object.entries(this._liveAmmo()).map(([slot, [mag, res]]) => `$AMMO,${slot},${mag},${res},1,*`);
    const bmap = ((this.frames && this.frames.revive) || []).find(f => typeof f === 'string' && f.startsWith('$BMAP,0,0')) || '$BMAP,0,0,,,,,*';
    this._writeMust([...(tid != null ? [`$TID,${tid},*`] : []), ...ammo, bmap], 'operator resync',
      () => this._lifeSeq === life && !this._standDown(['phase', 'ble', 'alive', 'reconciling', 'resync', 'stunned']));
    this._holdAccuracyWrites('operator resync');   // A47: the resync's own `$AMMO` (and its one retry) owns the counts
    if (this._protectsSpawn()) {
      if (this._armPending) this.log('operator resync: hit reception is still spawn-protected — the take follows the first shot or the cap', 'li');
      // F121 rebuild: the table is re-sent whatever `_sirLive` says. The operator is here because the gun is not
      // behaving, and a gun that rebooted has lost its table without any write of ours to say so (F11).
      else { this._sirLive = false; this._armPending = this._repairArm(); this._armLife('operator resync'); }
    } else {
      this._write(this._pickTable('sir_pool'), 'operator resync: hit audio');   // a pre-A44 bundle: the take, when it has one
    }
    this.log(`operator resync done — hp ${this.hp}, tid ${tid != null ? tid : '?'}`, 'lk');
    this._changed();
    return null;
  }

  // ---------- feedback (§3.6) ----------
  feedback(body, envT) {
    const t = body.t != null ? body.t : envT;
    if (t != null && this.now() - t > C.FEEDBACK_MAX_AGE_MS) { this.log('feedback too old — ignored', 'li'); return; }
    const pick = body.cue ? { frame: body.cue, tag: '' } : this._pickCue(body.kind);   // A15: a random take from the pool (kill confirms + taunts)
    const cue = pick.frame;
    this._write([SFLASH], `feedback ${body.kind}`);
    // A11.4 Halo-style medals: a kill can carry several ("killtacular" + "killing_spree"); each plays
    // its cue from THIS node's bundle, back to back, and replaces the plain kill line. A cue that is
    // "" is deliberately mute (announcer off) and is skipped; a missing one is skipped too.
    const medalCues = (Array.isArray(body.medals) ? body.medals : [])
      .map(m => ({ m, f: this.frames && this.frames.cues && this.frames.cues[m] })).filter(x => x.f);
    const lg = (this._lightGen = this._lightGen || 0);   // teardown snapshot: neither a medal line nor the feedback cue may land after the match ended
    if (medalCues.length) {
      medalCues.forEach((x, i) => this.delay(120 + i * MEDAL_GAP_MS, () => { if (this._lightGen === lg) this._write([x.f], `medal ${x.m}`); }));
      this.medals = body.medals.slice();
    } else if (cue) this.delay(120, () => { if (this._lightGen === lg) this._write([cue], `feedback cue ${body.kind}${pick.tag}`); });   // hardware-proven gap (seed): flash, then the line
    this._eventLeds(medalCues.length ? medalCues[0].m : body.kind);   // A11.8: the headset's small LED flash (+ any burst) for the top medal
    if (body.kind === 'kill') {
      if (this.score) this.score = { ...this.score, kills: (this.score.kills || 0) + 1 };
      else this.score = { kills: 1 };
      this.scoreAt = this.now();
      this.moment = { kind: 'kill', at: this.now(), data: { victim_team: body.victim_team, victim: this.victimName(body), medals: Array.isArray(body.medals) ? body.medals.slice() : [] } };
    }
    this._changed();
  }

  /** A11.4 named game event from MC (lead change, next kill wins, flag captured, bomb planted, VIP down…):
   *  play this node's own cue + LED burst for it and show the text as a HUD alert. Stale ones are dropped
   *  like feedback. `hud: false` on the body suppresses the banner (sound/lights still play). */
  alert(body, envT) {
    if (!body || !body.kind) return;
    const t = body.t != null ? body.t : envT;
    if (t != null && this.now() - t > C.FEEDBACK_MAX_AGE_MS) { this.log(`alert ${body.kind} too old — ignored`, 'li'); return; }
    if (this.phase !== 'live' && this.phase !== 'armed') return;
    const me = this.player && this.player.player_id;
    if (body.kind === 'infected' && this._turned && body.player_id_subject && body.player_id_subject === me) return;   // already played on the flip (HUD-driven); MC's copy is for the others
    this._event(body.kind);
    // A11.6 carrier blink: MC names who holds it (`carrier`) and whose flag it is (`flag_tid`)
    if (body.kind === 'objective_taken' && me && body.carrier === me) this._carrier(true, body.flag_tid != null ? body.flag_tid : (this.team ? this.team.tid : 0));
    if ((body.kind === 'objective_scored' || body.kind === 'flag_returned') && this.carrying != null && (!body.carrier || body.carrier === me)) this._carrier(false);
    // A19 (S10): a held headset ROLE named by MC — `role: {name, on, tid?}` — goes through the same mechanism the
    // carrier blink and the infection flip already use. The names are the five §3.3 states; anything else is
    // logged and IGNORED, so a newer MC can never paint an arbitrary state on the lamp (the lamp shows only what
    // this bundle's `headset.role` table can express).
    if (body.role && typeof body.role === 'object') {
      const r = body.role;
      if (['carrier', 'infected', 'vip', 'beacon', 'extracted'].includes(r.name)) this._setRole(r.name, !!r.on, r.tid != null ? r.tid : null);
      else this.log(`alert role ${String(r.name)} unknown — ignored`, 'li');
    }
    if (body.hud !== false) this.moment = { kind: 'alert', at: this.now(), data: { kind: body.kind, text: body.text || body.kind, player_id: body.player_id_subject || null } };
    this.log(`alert ${body.kind}`, 'lk');
    this._changed();
  }

  // ---------- BRX frames (§3.2) ----------
  feedFrame(f) {
    this._awake();                   // §3.11: a frame off the gun is proof too — the JS ran to parse it
    this.lastGunFrameAt = this.now(); // B4: ANY frame is proof the link is alive — feeds the staleness watchdog in tick()
    const t = toks(f), cmd = t[0];
    // F208: the gun answered. F264: ...answered WHAT, though. A pool frame the node ASKED for (`$QUERY,*`, the
    // cure or the 20 s divergence poll) proves the gun is reporting its pools, so `lastPoolAt` is honest -- and it
    // proves nothing about the trigger pull that is still unanswered, so the no-fire count must survive it.
    // Reset the count on a solicited reply and the poll would quietly retire the only detector this fault has.
    // ⚠ `$LCD` ONLY. A `$QUERY` reply's pool frame is an `$LCD` (protocol row; the F264 log: `tx $QUERY` -> `rx
    // $LCD,45,70,0,0,32,192`), never an `$ALCD` or an `$HP`. Widen this to `$ALCD` and a shot that lands inside a
    // poll's 1.5 s window reads as OUR reply, its pull is never cleared, and three such coincidences would
    // manufacture the very `no_fire` the poll exists to resolve.
    const solicited = this._solicited(cmd);
    if (solicited) this.lastPoolAt = this.now();
    else if (cmd === 'HP' || cmd === 'LCD' || cmd === 'ALCD') {
      this.lastPoolAt = this.now(); this._shotDueAt = null; this._noFirePulls = 0;   // F208: the gun answered the trigger
      // F264: ...and an UNSOLICITED pool frame is the gun working again, unasked. That retires the verdict, so
      // `GUN NOT ANSWERING - FORCE RESPAWN` cannot sit on the operator's board for the rest of a match over a gun
      // that came back. Crying wolf is its own failure: the next real one would be read as the same stale chip.
      if (this.cure) { this.log(`cure verdict '${this.cure.verdict}' cleared — the gun is reporting again`, 'li'); this.cure = null; }
    }
    switch (cmd) {
      case 'HP': this._onHp(+t[1] || 0, +t[2] || 0, t[3] !== undefined && t[3] !== '' ? (+t[3] || 0) : this.shield, solicited); if (solicited) this._cureAnswer('HP', t); break;
      case 'LCD': {
        this.hp = +t[1] || 0; this.armor = +t[2] || 0;
        this.poolSrc = 'gun';            // R2-3: the pool in the next heartbeat is the GUN's, not our model's
        if (this.hp > 0) this._armedThisLife = true;   // B5: the gun has now confirmed a life on the wire -- the settle window is over
        // NOTE: do NOT write this.shield from $LCD token 3. Unlike $HP, $LCD's tokens 3-4 are
        // UNDOCUMENTED (docs/manual/dev.md, protocol/brx-protocol.md "semantics TBD") and
        // read 0 in every observed frame -- so writing it can only ZERO a live shield, never set one,
        // which silently recreates the Q12 bug this file just fixed. Re-add only once t3 is
        // bench-confirmed as the shield.
        if (t[5] !== undefined) this._onAmmo(+t[5] || 0, t[6] !== undefined ? +t[6] : null, this.activeSlot);   // $LCD carries no heat token — leave it untouched this frame
        if (this.awaitingEcho && !this.headEcho) this.headEcho = f;
        const wasResync = !!this.resync;
        if (this.resync) this._resyncEvidence('lcd');
        // F264: a SOLICITED zero is a `desync` death by the §3.3 definition -- the node learned the `$HP,0` out of
        // band, from its own question, rather than from a live hit sequence. There is ONE death path and this is
        // it: the cure books nothing itself. (§3.3's wording names the reconcile and the resync; the poll is the
        // third way in and wants folding into the spec.)
        if (this.phase === 'live' && this.hp === 0 && this.alive && !this._deathPending()) this._death(wasResync || solicited);
        if (solicited) this._cureAnswer('LCD', t);
        break;
      }
      case 'ALCD': {
        if (this.awaitingEcho && !this.headEcho) this.headEcho = f;
        // A36: …and keep the SLOT-0 one, whether or not it was first. Token 3 is the weapon slot;
        // the head writes slot 0, 1 and 4, so the primary's frame is the only one whose mag/reserve
        // MC can compare against `$WEAP,0`.
        //
        // ⚠ `$ALCD` is an AMMO-EVENT stream (protocol §"$ALCD": "one frame per round fired and per
        // round reloaded ... only streams on ammo events"), NOT a guaranteed answer to a `$WEAP`
        // write -- LaserTagMods' `$WEAP` echo has never been seen from our v4.32 units (protocol
        // §"Echoes reported by LaserTagMods"). So this frame may well be the head's arming report
        // and may equally be the player pulling the trigger inside the 1500 ms window, in which case
        // it carries a magazine one BELOW the compiled one and MC would turn a correct push red
        // (F-3). `butSinceHead` is the cut: a `$BUT` is the gun saying a control was touched, and
        // after one the ammo stream belongs to the player, not to the head. No echo then, which MC
        // reads as NOT ECHOED -- no claim, rather than a wrong one.
        if (this.awaitingEcho && !this.ammoEcho && !this.butSinceHead
            && (t[3] === undefined || t[3] === '' || +t[3] === 0)) this.ammoEcho = f;
        // S42: token 2 is the live per-shot accuracy `$ALCD` reports (docs/weapon-design.md §4.4,
        // bench 2026-09-17) — the ONLY answer the accuracy writer's verify step ever gets.
        // F229 (bench 2026-09-17): token 5 is HEAT. Firing stops at 99, the gun does not cool on its
        // own, and only the reload lever vents it (about 35 a pull). `_onAmmo` below records it per slot,
        // and `_heatBlocksFire()` is the one reading of it (the accuracy writer's guard included).
        this._recoilObserve(t[2] !== undefined && t[2] !== '' ? +t[2] : NaN, t[3] !== undefined && t[3] !== '' ? +t[3] : 0);
        this._onAmmo(+t[1] || 0, t[4] !== undefined ? +t[4] : null, t[3] !== undefined && t[3] !== '' ? +t[3] : 0, t[5] !== undefined && t[5] !== '' ? +t[5] : null);
        break;
      }
      case 'HIR': {
        if (t[2] === '15') {
          // A grenade/station BEACON (F70/F72), not a shot: $HIR,<sensor>,15,<ownerId=0>,<ownerTeam>,<magnitude>,0,<sub>.
          // It rides the same $HIR command as a hit, but registers through the silent $SIR fn-28 row
          // (F73) specifically so the player feels nothing — no latch, no hit_taken, no pool change.
          // It repeats every ~5 s for as long as anyone stands on the point, so this is a STANDING
          // snapshot (read from state(), like `stations`), not a one-shot moment/event: re-deriving
          // it on every beacon must not re-trigger anything downstream.
          //
          // F85: the gun has multiple IR sensors (0-3 headset, 4 body) and ONE physical transmission
          // can land on more than one of them, each reported as its own $HIR ~14 ms apart. Dedupe on
          // IDENTITY (protocol 15 is implicit here + owner team + magnitude), never on time alone: a
          // real capture bench-measured two DIFFERENT beacon words (the outgoing owner's word, then the
          // new owner's) arriving in the SAME MILLISECOND on different sensors, and a time-only window
          // would drop one of those — silently swallowing the capture. Sensor is deliberately NOT part
          // of the key: a differing sensor is exactly what a duplicate looks like. The window (150 ms)
          // sits comfortably above the 14 ms observed spread and well clear of the ~5 s beacon period,
          // so a normal repeat of the same word is never mistaken for a duplicate of itself.
          const ownerTeam = parseInt(t[4], 10), magnitude = parseInt(t[5], 10);
          if (!Number.isNaN(ownerTeam)) {
            const now = this.now(), key = `${ownerTeam}:${Number.isNaN(magnitude) ? 'null' : magnitude}`;
            const isDupe = key === this._lastBeaconKey && (now - this._lastBeaconAt) < 150;
            if (!isDupe) {
              this.beacon = { owner_team: ownerTeam, magnitude: Number.isNaN(magnitude) ? null : magnitude, sensor: parseInt(t[1], 10), at: now };
              this._lastBeaconKey = key; this._lastBeaconAt = now;
              // Hill state + its callouts run HERE, on the frame that proves the change and in the same
              // handler — never on a timer poll, and never waiting for a second word (see `_onHillBeacon`).
              // Inside the dedupe so one transmission heard on two sensors cannot announce or tick twice.
              this._onHillBeacon(ownerTeam, magnitude, now);
            }
          }
          break;
        }
        const num = parseInt(t[3], 10), team = parseInt(t[4], 10);
        // $HIR,<sensor>,<irProto>,<shooterId>,<shooterTeam>,<damage>,,<subtype> — with t[0] the command
        // word, sensor is t[1] and irProto is t[2]. `ir_proto` read t[1], so it had been reporting
        // the SENSOR all along; every hit_taken fact ever recorded carries that mix-up.
        if (!Number.isNaN(team)) { this.latch = { shooter_num: Number.isNaN(num) ? 0 : num, shooter_team: team, at: this.now(), ir_proto: parseInt(t[2], 10), sensor: parseInt(t[1], 10) }; this.lastHitAt = this.now(); this._shieldReassert(); }
        if (t[2] === '8') this._stun();   // F15: an EMP word (proto 8) -- a no-op unless config.stun is on; no $HP follows a status row, so nothing below sees it
        break;
      }
      case 'VOLTS': { const b = parseInt(t[3], 10); if (!Number.isNaN(b)) this.battery = b; this.lastVoltsAt = this.now(); break; }
      case 'VERSION': { if (t[1]) this.fw = t[1]; break; }
      // F264: the status array that leads a `$QUERY` reply. Its fields are the pool MAXIMA and the TEAM, none of
      // which this cure reads -- the `$LCD` behind it carries the live pools and the magazine. Reading the team back
      // here is transport-hardening.md §6's arming read-back, which is a separate piece of work and touches MC.
      // F264 (bench 2026-09-19): the status array that trails a `$QUERY` reply. Its own fields are the pool MAXIMA
      // and the TEAM, none of which this cure reads, and reading the team back here is transport-hardening.md §6's
      // arming read-back, which is separate work. What it IS good for is a signature: a DEAD gun sends this body
      // about 2 s late and WITHOUT a trailing `*`, while a live gun's is about 30 ms behind and well formed. So a
      // malformed body is a dead-gun HINT. It is logged and nothing else: a frame with no health number in it is
      // not positive evidence, and the node books deaths only from positive evidence (§3.3). The `$LCD` that
      // arrived first already carried the number and has already decided.
      case 'QUERY': {
        // ⚠ NOT gated on `this._cure`. The body arrives about 2 s late, which is AFTER QUERY_REPLY_MS has already
        // closed the cure's own window, so gating it on a live cure would make this hint permanently unreachable.
        if (!this._queryAt || this.now() - this._queryAt > QUERY_BODY_MS) break;
        if (!String(f).trim().endsWith('*')) this.log('cure: the $QUERY body came back late and unterminated — the dead-gun signature (bench 2026-09-19). Not parsed, and not evidence on its own', 'le');
        break;
      }
      case 'BUT': {
        this.butSinceHead = true;      // A37/F-3: the ammo stream from here on is the player's, not the head's
        if (this.resync) this._resyncButton(+t[1], +t[2]);
        this._onButton(+t[1], +t[2]);
        break;
      }
      default: break;
    }
    this._changed();
  }

  // ---------- utility items: station presence (docs/spec/utility.md) ----------
  /** The app's latest presence snapshot (beacon.js Presence entries, strongest first). Re-renders only when the
   *  respawn station the HUD shows actually changed (id / present / rounded RSSI), not on every advert. */
  setStations(list) {
    this.stations = Array.isArray(list) ? list : [];
    this._onControlAdvert(this.now());          // K1: a kind-5 advert is the hill's other source (utility.md §5)
    const v = stationView(this._respawnStation()); const sig = v ? `${v.id}:${v.present}:${v.rssi}:${v.team}` : '';
    if (sig !== this._stationSig) { this._stationSig = sig; this._changed(); }
  }
  /** `config.stations`, when the bundle carries it, is the allow-list of station ids valid in this game --
   *  a stray phone from another game can neither revive anyone nor claim to be a control point. */
  _stationAllowed(e) {
    const allow = this.config && Array.isArray(this.config.stations) && this.config.stations.length
      ? new Set(this.config.stations.map(x => (x && typeof x === 'object') ? x.id : x)) : null;
    return !allow || allow.has(e.id);
  }
  /** My team's respawn station: a present one first, else the strongest (the HUD shows how close you are).
   *  A station admits me when it is neutral or on my gun's $TID team. */
  _respawnStation() {
    const tid = this.team ? this.team.tid : null;
    const mine = this.stations.filter(e => e && e.kind === 'respawn' && e.state !== 0 && (e.team === TEAM_ANY || e.team === tid) && this._stationAllowed(e));
    return mine.find(e => e.present) || mine[0] || null;
  }
  /** The control point this player reads: one we are standing on first, else the strongest in range.
   *  Unlike a respawn station a control point is NOT team-filtered -- an enemy-held point is exactly the
   *  one you need to hear about. A stale advert is ignored (see CONTROL_STALE_MS). */
  _controlStation() {
    // ⚠ `ageMs`, never `this.now() - e.seenAt`. `Presence` stamps `seenAt` (and now `ageMs`) with the RAW
    // `Date.now()`; a node's `now()` is that plus the MC clock offset, so subtracting one from the other
    // made every advert look stale — or none of them ever — depending on which way MC's clock leaned, with
    // no log line to explain it. The age is computed on one clock where the stamp was made.
    const live = this.stations.filter(e => e && e.kind === 'control' && this._stationAllowed(e)
      && !(Number.isFinite(e.ageMs) && e.ageMs > CONTROL_STALE_MS));
    // Latch the point we are already reading (item 2): `stations` arrives in RSSI order, so picking by
    // signal alone flips between two points as a player walks between them, and each flip looked like a
    // change of hands. Stay on the latched point while it is live; move only when it is gone, or when we
    // are actually STANDING on a different one.
    const latched = this._controlSite != null ? live.find(e => e.id === this._controlSite) : null;
    const present = live.find(e => e.present);
    if (latched && (latched.present || !present)) return latched;
    return present || live[0] || null;
  }
  /** THE MECHANIC. Bench 2026-09-17 (match 592e444eff): a charge rifle in OVERHEAT lockout will not fire no
   *  matter how many times the trigger is pulled -- that is the mechanic working, not a stale pool. True once
   *  the active slot's last-reported heat ($ALCD token 5) has passed HEAT_LOCKOUT -- UNLESS that reading is
   *  itself stale (review 2026-09-17): the gun sends no $ALCD while locked out or cooling, so a reading
   *  taken while OVERHEAT would otherwise sit above the line forever. Past HEAT_STALE_MS with nothing new
   *  for this slot, treat it as no longer trustworthy and let `poolStale`'s 'no_fire'/'silent' path take over.
   *
   *  ⚠ Named apart from `_overheatOnHud` by the 2026-09-17 maint review, which found the two used as if they
   *  were one truth. THIS one decides whether the gun can shoot: it gates the accuracy writer and exempts a
   *  dry pull from `no_fire`, on the 25 s HEAT_STALE_MS trust window. It is NOT what the HUD draws. */
  _heatBlocksFire(now = this.now()) {
    const slot = this.activeSlot;
    if ((this.heatBySlot[slot] || 0) < HEAT_LOCKOUT) return false;
    const at = this._heatAt[slot];
    return at == null || (now - at) < HEAT_STALE_MS;
  }
  /** pl4: one `$ALCD` for `slot`. A reading at or past the line starts or refreshes the lockout; a reading below
   *  it, or a round leaving the slot without such a reading, ends it. `prev` is the slot's last mag (null = none). */
  _heatLockFrame(slot, heat, prev, mag) {
    const now = this.now(), hot = heat != null && !Number.isNaN(heat) && heat >= HEAT_LOCKOUT, L = this._heatLock;
    if (hot) { if (L && L.slot === slot) L.lastAt = now; else this._heatLock = { slot, at: now, lastAt: now }; return; }
    if (!L || L.slot !== slot) return;
    if ((heat != null && !Number.isNaN(heat)) || (prev != null && mag < prev)) this._heatLock = null;   // cooled, or it fired
  }
  /** pl4: a trigger press on the locked slot. A press the gun can answer gets its `$ALCD` inside ~5 ms and ends the
   *  lockout there, so until then the press is evidence the lockout is still on. */
  _heatLockPress() {
    const L = this._heatLock;
    if (L && L.slot === this.activeSlot && this.phase === 'live' && this.alive) L.lastAt = this.now();
  }
  /** THE DISPLAY. pl4: the HUD's OVERHEAT word, overlay and hot heat bar -- all three read this one field, so
   *  they cannot disagree (maint review 2026-09-17: the bar read the mechanic and could stay hot for up to 19 s
   *  after the word cleared). True while the active slot's lockout has evidence inside OVERHEAT_SHOWN_MS and
   *  began less than OVERHEAT_CAP_MS ago. Display only: no game rule reads it. PURE. */
  _overheatOnHud(now = this.now()) {
    const L = this._heatLock;
    return !!(L && L.slot === this.activeSlot && now - L.lastAt < OVERHEAT_SHOWN_MS && now - L.at < OVERHEAT_CAP_MS);
  }
  /** F208: a trigger press the gun should answer with a shot. Only counted where a shot must follow: live, alive,
   *  loaded, and not swapping, reloading, stunned, resyncing, reconciling or overheat-locked. A press while
   *  one is due keeps the first. */
  _awaitShot() {
    if (this._standDown(['phase', 'spawned', 'ble', 'alive', 'reconciling', 'resync', 'tutorial', 'switching', 'reloading', 'stunned', 'heat', 'weaponHold'])) return;
    // The slot's live count once the gun has reported it this life, else the spawn magazine. An empty mag
    // dry-fires. F259: the ACCOUNT, not the last `$ALCD` -- a press whose round is still in flight has
    // already spent that round, and reading the gun's slower number would book a press an empty gun cannot
    // answer.
    const seen = this._acctLive(this.activeSlot);
    const mag = seen != null ? seen : this._ammoBySlot()[this.activeSlot];
    if (!(mag > 0)) { this._dryPull(); return; }
    this._dryPulls = 0;   // the RELOAD nag: a loaded pull ends the dry spell even if the gun never answers it
    this._acctPress();   // F259: the earliest evidence a round is leaving -- the gun has not fired yet
    if (this._shotDueAt == null) this._shotDueAt = this.now();
  }
  /** THE RELOAD NAG (Tony, bench 2026-09-18). Reached from `_awaitShot` ONLY, one line below its stand-down table, so every other
   *  reason a pull produced no round -- overheat, a swap, a reload already running, a stun, being down, not
   *  live, the link gone -- has already returned and the empty magazine is the only thing left that can have
   *  stopped it. That is the whole point of hanging it here rather than counting `$BUT` edges: a nag on an
   *  overheated gun would name the wrong fix.
   *
   *  A dry reserve stays SILENT. "Reload" said to a player with nothing to reload to is a lie, and they can
   *  hear the difference the moment they try. The reserve is the slot's OWN last `$ALCD` figure and nothing
   *  else: an unknown reserve counts as no reserve, the same way `_reloadPulled` refuses a reload it cannot
   *  prove is possible.
   *
   *  ⚠ It used to fall back to `this.reserve`, the last figure reported on ANY slot, which the doc comment
   *  described and then contradicted (polish review 2026-09-18). Melee is the live case: it is slot 4, it
   *  arrives on its own `$ALCD`, and `_onAmmo` makes whatever spoke last the active slot -- so after a swing
   *  every pull was nagged to RELOAD against the primary's reserve. */
  _dryPull() {
    const slot = this.activeSlot;
    const reserve = this._prevReserve[slot];
    if (!(reserve > 0)) return;
    this._dryPulls = (this._dryPulls || 0) + 1;
    if (this._dryPulls < RELOAD_NAG_FIRST || (this._dryPulls - RELOAD_NAG_FIRST) % RELOAD_NAG_EVERY !== 0) return;
    this.log(`dry pull ${this._dryPulls} on an empty magazine with ${reserve} in reserve: RELOAD`, 'li');
    this._event('reload_nag');
  }
  /** F208: called from tick(). A press with no pool report TRIGGER_NO_FIRE_MS later counts as unanswered. */
  _noFireTick(now) {
    if (this._shotDueAt == null || now - this._shotDueAt < TRIGGER_NO_FIRE_MS) return;
    this._shotDueAt = null;
    if (this._standDown(['alive', 'switching', 'reloading', 'stunned', 'heat'], now)) return;   // the reason changed while it was due -- overheat is a real cause too (592e444eff: heat 99->108, 10 pulls, no $ALCD)
    this._noFirePulls++;
    if (this._noFirePulls === NO_FIRE_PULLS) this.log(`gun not firing: ${NO_FIRE_PULLS} trigger pulls with no shot, the pool is stale`, 'le');
  }
  /** F264: ASK the gun where it stands. ONE `$LIFE,0,0,0,*`, 13 bytes, answered immediately with `$HP` whether
   *  the gun is alive or dead (bench 2026-09-19). This is every probe site except the cure's second step.
   *
   *  ⚠ READING IS NOT INFERRING. Every other write in this file stands down inside `reconciling` and `resync`
   *  because the node must not GUESS there (§3.10). A probe is the opposite of a guess: it is how the node stops
   *  guessing. So the probe sites deliberately run inside those windows, and only the ACTING stands down. If you
   *  are about to "fix" a probe that fires during a reconcile, read this first. */
  _askGun(why) {   // NOT `_probe`: that name is taken by the first-connect BLE ritual above (line ~1023), and a second `_probe` on this class silently overrode it
    this._queryAt = this.now(); this._probeSeen = {};
    this._write([PROBE_LIFE], why);
  }
  /** F264: ask for the MAGAZINE, which only a `$QUERY` reply's `$LCD` carries. ⚠ Sent from exactly one place, the
   *  cure's alive branch, and only after `$LIFE` has already answered `$HP` with health above 0. Bench 2026-09-19:
   *  a DEAD gun holds its print loop about 2 s on a `$QUERY`, so this must never reach a gun that might be dead,
   *  and it must never go on a timer. */
  _askMagazine(why) {
    this._queryAt = this.now(); this._probeSeen = {};
    this._write([QUERY], why);
  }
  /** F264: is this pool frame the answer to a probe we sent? True at most ONCE per probe PER FRAME KIND, inside
   *  QUERY_REPLY_MS, and then consumed. `$LIFE` answers with one `$HP`; `$QUERY` answers with a status array and
   *  one `$LCD`. A second frame of the same kind in the same window is the gun talking on its own and resets the
   *  no-fire count as it always did.
   *
   *  ⚠ `$ALCD` is NEVER solicited: no probe answers with one, and if it could, a shot landing inside a poll's
   *  1.5 s window would read as OUR reply, its pull would never clear, and three such coincidences would
   *  manufacture the very fault the poll exists to resolve. NOT pure: it consumes the token. */
  _solicited(kind) {
    if (kind !== 'HP' && kind !== 'LCD') return false;
    if (this._probeSeen[kind] || !this._queryAt || this.now() - this._queryAt > QUERY_REPLY_MS) return false;
    this._probeSeen[kind] = true;
    return true;
  }
  /** F264: does a `$QUERY` reply's `$LCD` fit the token map we have? The map is confirmed by SHAPE only, on an
   *  unconfigured gun (transport-hardening.md §6, levers claim 19), so a reply that does not fit is treated as NO
   *  REPLY rather than trusted. `$LCD,<hp>,<armor>,<t3>,<t4>,<mag>,<reserve>` -- six tokens, health and armour
   *  present and non-negative. Tokens 3 and 4 are undocumented and are not read. PURE. */
  _probeShapeOk(t) {
    if (t.length < 7) return false;                       // cmd + 6 tokens
    const hp = +t[1], armor = +t[2];
    return Number.isFinite(hp) && hp >= 0 && Number.isFinite(armor) && armor >= 0;
  }
  /** F264: what a cure probe came back with. The frame handler above has ALREADY landed the gun's real pools and
   *  magazine, and has booked the death when the gun said 0 -- there is ONE death path and this is not a second
   *  one. This only records the verdict, says it in the log with the values, and re-asserts the arming when the
   *  gun says it is alive.
   *
   *  ⚠ The re-assert sends the GUN'S OWN just-reported counts, not the node's. That is the whole point: the node's
   *  belief is the thing under suspicion, and a `$AMMO` built from it would hand a free magazine to a player whose
   *  reload timed out. It is deliberately NOT `_operatorResync` (which re-sends the node's counts and an 11-row
   *  `$SIR` take): two frames, both from the gun's own words, nothing that heals. */
  _cureAnswer(kind, t) {
    const c = this._cure;
    if (!c) return;
    if (kind === 'LCD' && !this._probeShapeOk(t)) {
      this.log(`cure: a $QUERY reply the token map does not fit (${t.join(',')}) — treating it as no reply (levers claim 19)`, 'le');
      return;                                             // c stays in flight: the window may still bring a good one
    }
    // The question this probe asked IS the no-fire claim, so the claim is spent. Leave the count standing and
    // `poolStale()` says `no_fire` for the rest of the life whatever the gun does next, and MC holds GUN NOT
    // FIRING up over a gun that has just told us exactly where it stands. A new stall builds from fresh pulls.
    this._shotDueAt = null; this._noFirePulls = 0;
    const mag = kind === 'LCD' && t[5] !== undefined && t[5] !== '' ? (+t[5] || 0) : null;
    const reserve = kind === 'LCD' && t[6] !== undefined && t[6] !== '' ? (+t[6] || 0) : null;
    if (this.hp === 0) {
      this._cure = null;
      this.cure = { verdict: 'dead', at: this.now() };
      this.log(`cure: the gun says it is DEAD (${kind === 'HP' ? '$LIFE,0,0,0 answered $HP,0' : '$QUERY answered $LCD health 0'}) and the node had missed it — the death is booked, the respawn revives it (F264)`, 'lk');
      this._changed();
      return;
    }
    // STEP 2, and only now. `$LIFE` has proved the gun ALIVE, so the 2 s print-loop hold a `$QUERY` costs a DEAD
    // gun cannot apply (bench 2026-09-19: a live gun's body is about 30 ms behind). The magazine is the one thing
    // `$HP` cannot carry and the one thing that tells an empty gun from a stuck one, so ask for it now, once.
    if (kind === 'HP' && c.step === 'life') {
      c.step = 'mag'; c.asks = 1; c.askedAt = this.now();
      this.log(`cure: the gun is ALIVE at hp ${this.hp} — asking for the magazine, the one thing $HP cannot carry`, 'lk');
      this._askMagazine('cure: the gun is alive, read the magazine');
      return;
    }
    this._cure = null;
    this.cure = { verdict: 'alive', at: this.now() };
    // THE FALSE POSITIVE THIS EXISTS FOR (Tony, 2026-09-18). `_awaitShot` only owes a shot when the node's OWN
    // account says the magazine has rounds, so an ordinary empty gun never reaches `no_fire` at all. It gets here
    // when that BELIEF is wrong: the account says loaded, the gun is empty and perfectly healthy, and the player
    // pulls three times. Reviving there would hand a live player a free respawn and wipe a gun that was never
    // broken. So: re-assert, never revive.
    this.log(`cure: the gun is ALIVE at hp ${this.hp}, magazine ${mag == null ? 'not reported' : mag}${reserve == null ? '' : `/${reserve}`} (the node believed ${this._acctLive(this.activeSlot)}) — re-asserting the gun's own counts, never a revive (F264)`, 'lk');
    this._cureReassert(mag, reserve);
    this._changed();
  }
  /** F264: put the gun's own just-reported counts back on it, and the trigger mapping with them. Two frames, and
   *  every number in them came off the gun in the frame being answered, so this can never be a refill. No
   *  `$SPAWN`, no `$PSET`, no `$SIR` (F264 proved a `$SIR` resync does not restart a gun in this state, and
   *  nothing reads the table back anyway -- transport-hardening.md §6). */
  _cureReassert(mag, reserve) {
    const frames = [];
    if (mag != null && reserve != null) frames.push(`$AMMO,${this.activeSlot},${mag},${reserve},1,*`);
    const bmap = ((this.frames && this.frames.revive) || []).find(f => typeof f === 'string' && f.startsWith('$BMAP,0,0')) || '$BMAP,0,0,,,,,*';
    frames.push(bmap);
    this._write(frames, 'cure: re-assert the arming from the gun\'s own reply');
    this._holdAccuracyWrites('cure re-assert');   // the re-assert's `$AMMO` owns the counts until the gun answers it
  }
  /** F264: THE CURE. `poolStale()` has already concluded `no_fire`; ask the gun where it stands rather than guess.
   *
   *  ⚠ THE NODE NEVER REVIVES ON NO EVIDENCE. If both probes go unanswered it does NOTHING, records `no_answer`
   *  so the operator's board says so, and logs the values. The old draft of this sent the revive head blind;
   *  Tony's call (2026-09-18) is that a free life for a gun that was merely empty is worse than a wait.
   *
   *  Never acts during a stand-down. `_noFireTick` stands down on alive/switching/reloading/stunned/heat; this
   *  adds `reconciling` and `resync` (§3.10) and the link, the phase, the spawn and the bundle. OVERHEAT is a real
   *  cause of unanswered pulls and must never reach a write.
   *
   *  Bounded: once per life (`_cureLife`) and a CURE_COOLDOWN_MS floor between cures across lives. Write cost: 2
   *  frames per probe, at most CURE_ASKS probes, then at most 2 more for the re-assert. */
  _cureTick(now) {
    const c = this._cure;
    if (c) {
      if (now - c.askedAt < QUERY_REPLY_MS) return;                      // the probe is still in its window
      const blocked = this._standDown(['phase', 'spawned', 'bundle', 'ble', 'alive', 'reconciling', 'resync', 'tutorial', 'switching', 'reloading', 'stunned', 'heat'], now);
      if (blocked) { this._cure = null; this.log(`cure abandoned — ${blocked}`, 'li'); return; }
      if (c.step === 'mag') {
        // The gun has ALREADY proved it is alive; only the magazine went unanswered. That is evidence, not
        // silence, so it never becomes `no_answer`: re-assert what we can and say the magazine is unknown.
        this._cure = null;
        this.cure = { verdict: 'alive', at: now };
        this.log(`cure: the gun answered $LIFE alive at hp ${this.hp} but never answered $QUERY — re-asserting the trigger map only, magazine unknown (F264)`, 'le');
        this._cureReassert(null, null);
        this._changed();
        return;
      }
      if (c.asks < CURE_ASKS) { c.asks++; c.askedAt = now; this._askGun(`cure: probe ${c.asks} of ${CURE_ASKS}`); return; }
      this._cure = null;
      this.cure = { verdict: 'no_answer', at: now };
      this.log(`*** cure: ${CURE_ASKS} $LIFE,0,0,0 probes went unanswered on a gun the node believes is alive `
        + `at hp ${this.hp} with ${this._acctLive(this.activeSlot)} in the magazine. The node cannot tell a dead gun `
        + `from a stuck one, so it is doing NOTHING and asking for a human: FORCE RESPAWN, or RELINK (F264) ***`, 'le');
      this._changed();
      return;
    }
    const stale = this.poolStale(now);
    if (!stale || stale.why !== 'no_fire') return;
    if (this._standDown(['phase', 'spawned', 'bundle', 'ble', 'alive', 'reconciling', 'resync', 'tutorial', 'switching', 'reloading', 'stunned', 'heat'], now)) return;
    if (this._cureLife === (this._lifeSeq || 0)) return;                 // one cure per life
    if (this._cureAt && now - this._cureAt < CURE_COOLDOWN_MS) return;   // ...and a floor between them, across lives
    this._cureLife = this._lifeSeq || 0; this._cureAt = now;
    this._cure = { askedAt: now, asks: 1, step: 'life' };
    this.cure = { verdict: 'asking', at: now };
    this._askGun(`cure: ${NO_FIRE_PULLS} trigger pulls with no answer — asking the gun where it stands`);
    this._changed();
  }
  /** F264: the divergence poll, so the node catches a diverged gun without a player pulling a dead trigger three
   *  times. LIVE MATCH ONLY, link up, spawned, alive, and never inside a reconcile, a resync or a try-out -- those
   *  three have their own one-off probes, which is a better use of the frames than a heartbeat on top of them.
   *  A cure already in flight IS the poll for now. `$LIFE` alone: 3 frames a minute, 39 bytes. */
  _pollTick(now) {
    if (this._cure) return;
    if (this._standDown(['phase', 'spawned', 'bundle', 'ble', 'alive', 'reconciling', 'resync', 'tutorial'], now)) return;
    if (this._pollAt && now - this._pollAt < QUERY_POLL_MS) return;
    this._pollAt = now;
    this._askGun('divergence poll');
  }
  /** F264 (Tony, 2026-09-18): READ BACK THE BIGGEST WRITE OF A LIFE. The spawn/revive burst is 17 frames, and the
   *  first proven stall began 4.6 s after one. A probe once the burst has had time to land and echo proves the gun
   *  actually took it, instead of the node assuming so for the rest of the life. Once per life, 1 frame. */
  _spawnProbeTick(now) {
    if (this._cure || !this._spawnAt || this._probedLife === (this._lifeSeq || 0)) return;
    if (now - this._spawnAt < SPAWN_PROBE_MS) return;
    if (this._standDown(['phase', 'spawned', 'bundle', 'ble', 'alive', 'tutorial'], now)) return;   // reading is allowed inside a reconcile/resync; see `_askGun`
    this._probedLife = this._lifeSeq || 0;
    this._pollAt = now;                          // the read-back IS this cadence's poll: do not send two in a breath
    this._askGun('spawn read-back: did the gun take the burst?');
  }
  /** F208: is the pool on the HUD still the gun's word? null when fresh, else `{why, ms}`. `why`: 'silent' (no frame
   *  of any kind for GUN_QUIET_STALE_MS) or 'no_fire' (NO_FIRE_PULLS unanswered pulls in a row) or 'write_lost' (pl4: this life's spawn/revive write
   *  resolved false; RESYNC GUN clears it). `ms`: time since the
   *  gun last reported a pool (`$HP`/`$LCD`/`$ALCD`), null if it never has. Only in a live match with the link up. PURE. */
  poolStale(now = this.now()) {
    if (this.phase !== 'live' || !this.bleUp) return null;
    const ms = this.lastPoolAt ? now - this.lastPoolAt : null;
    if (this.lastGunFrameAt && now - this.lastGunFrameAt >= GUN_QUIET_STALE_MS) return { why: 'silent', ms };
    if (this.alive && this._noFirePulls >= NO_FIRE_PULLS) return { why: 'no_fire', ms };
    if (this.alive && this._writeLost != null && this._writeLost === this._lifeSeq) return { why: 'write_lost', ms };   // pl4: a spawn/revive write was lost
    return null;
  }
  /** The station a scanner revive may use RIGHT NOW, or null: dead, past the delay, link up, not resyncing, present. */
  _stationRevivable(now) {
    if (this.alive || !this.deadAt || this.respawnType !== 'scanner' || !this.bleUp || this.resync || this.reconciling || this.phase !== 'live') return null;
    if (now - this.deadAt < this.respawnDelayMs) return null;
    const st = this._respawnStation();
    return st && st.present ? st : null;
  }
  /** Trigger pulled: on a DEAD gun in scanner mode with the trigger gate, this is the revive request. */
  _triggerPulled() {
    if (this.respawnType !== 'scanner' || this.respawnGate !== 'trigger') return;
    const st = this._stationRevivable(this.now());
    if (!st) { if (!this.alive && this.phase === 'live') this.log('trigger while down: not at a respawn station', 'li'); return; }
    this._resyncRevive = false; this._revive(false, st.id);
  }
  /** The headset out-blink frame list from the bundle (A11.6), or [] when the game opted out ('native'). */
  _headsetDeath() { const h = this.frames && this.frames.headset; return (h && h.death) || []; }
  /** Re-assert the out-blink while a player stays DOWN, so a count-limited blink (~160 s) can't die before
   *  they reach a station (scanner respawn can be a long walk). No-op when the game has no death frame, and
   *  never within a few seconds of the death/revive writes (F13: the headset is a relay, back-to-back writes
   *  to it stick). Called from tick(). */
  /** §3.2 (led-language.md, bench 2026-09-07): the firmware runs its OWN bright out-flash on the headset's
   *  small LED for the whole life, for free — UNLESS an `$HLED,,6` blank was sent during it, which disables
   *  the loop. We write NOTHING to the headset at death any more (the old node-driven pulse was ≥2x dimmer
   *  and cost ~80 writes/min). This is belt-and-braces only: `down.rearm` (`$HLOOP,2,750,*`) restores the
   *  flash at native drive or better for any life where a blank slipped through (an older node, a teardown
   *  race, a mode that still paints effect 6). One write per death, past the hands-off window, never during
   *  resync — same gate as the deleted `_deathFlash`. */
  _downRearm(now) {
    const down = this.frames && this.frames.headset && this.frames.headset.down;
    if (!down || !down.rearm || this.alive || !this.deadAt || this.resync || this._downRearmSent) return;
    if (now - this.deadAt < (down.rearm_after_ms != null ? down.rearm_after_ms : 2500)) return;
    this._downRearmSent = true;
    this._write([down.rearm], 'down rearm');
  }
  /** The `death: <colour>` opt-in ONLY (a big-LED blink held alongside the native flash) re-asserts through
   *  a long DOWN so a count-limited blink (~160 s) can't die before a scanner-mode walk reaches a station.
   *  Never during resync (the gun is disarmed/unverified there), and a no-op when the game didn't opt in. */
  _reassertDeathBlink(now) {
    if (this.alive || !this.deadAt || this.resync || !this._headsetDeath().length) return;
    if (now - this.deadAt < 5000) return;                          // the _die write is still fresh
    if (now - this._deathBlinkAt < HEADSET_REBLINK_MS) return;     // not due yet
    this._headset(this._headsetDeath(), 'death (re-assert)');
    this._deathBlinkAt = now;
  }

  /** What the DOWN screen should tell a scanner-mode player (utility.md §4.3). */
  respawnHint(now) {
    if (this.alive || !this.deadAt || this.phase !== 'live') return null;
    if (this.respawnType === 'auto') return 'timer';
    if (this.respawnType === 'none') return 'out';
    // Scanner: guide to a station from the instant of death (Tony 2026-09-04: a blank STAND BY for the
    // whole respawn delay leaves a first-timer with no idea what to do). The delay only gates the actual
    // revive (_stationRevivable), never the instructions. 'hold' = at your station, revive arms in a beat.
    const st = this._respawnStation();
    if (!st) return 'find_station';
    if (!st.present) return 'approach';
    if (now - this.deadAt < this.respawnDelayMs) return 'hold';
    return this.respawnGate === 'trigger' ? 'pull_trigger' : 'reviving';
  }

  /** Every `$BUT` edge — PRESS **and** RELEASE (protocol §$BUT: id 0 trigger · 1 alt-fire · 2 reload
   *  handle · 3 select · 4/5 left/right; state 1 press / 0 release).
   *
   *  F123: until 2026-09-11 this read `state === 1` only and threw every release on the floor, so a HELD
   *  button was invisible to the node — and the shotgun's reload is a HELD per-shell chain, which is why
   *  `easy_reload` (a momentary `$BMAP,1,97` remap of ALT) could not reload it and nothing here could see
   *  that it hadn't. The release edge was already on the wire the whole time; the frame ring from the
   *  2026-09-11 game has `$BUT,0,1` → `$ALCD` → `$BUT,0,0` 224 ms later.
   *
   *  `held` is the map of buttons still down (id → the `now()` of the press). A repeat press with no
   *  release between keeps the FIRST edge, so `heldMs` measures the hold and not the last repeat. */
  _onButton(id, state) {
    if (!Number.isFinite(id)) return;
    const now = this.now();
    if (state === 1) {
      if (this.held[id] == null) this.held[id] = now;
      this.lastButton = { id, state: 1, at: now, heldMs: null };
      // Field 2026-08-30: the HUD only ever learned the live slot from $ALCD, which the gun sends on a
      // SHOT -- so after an ALT swap it kept showing the old weapon "until you press trigger". The
      // button event is the earliest evidence a swap started; $ALCD's slot still gets the last word.
      if (id === BTN_ALT) this._altPressed();
      else if (id === BTN_RELOAD) this._reloadPulled();
      else if (id === BTN_TRIGGER) { this._triggerPulled(); this._heatLockPress(); this._awaitShot(); }   // a DEAD gun still reports the pull (bench 2026-09-04): the station-revive gate
      return;                                                // `feedFrame` fires the one `_changed()` for this frame
    }
    if (state !== 0) return;
    const since = this.held[id];
    delete this.held[id];
    const heldMs = since != null ? now - since : null;
    this.lastButton = { id, state: 0, at: now, heldMs };
    // A release is OBSERVATIONAL only. It must not cancel a reload: on a magazine weapon the handle is
    // let go instantly and the reload still completes ~1.4 s later. Whether a reload actually happened is
    // decided by the gun's ammo (`_onAmmo` / `_reloadDeadline`), never by a button edge or a timer.
    if (id === BTN_RELOAD && this.reloading) this.reloading.releasedAt = now;
  }
  /** How long each still-down button has been held, in ms. PURE — read from `state()` on every render. */
  heldMs() {
    const now = this.now(), out = {};
    for (const id of Object.keys(this.held)) out[id] = now - this.held[id];
    return out;
  }

  /** ALT pressed: a weapon swap has begun. Shooting is disabled until the gun finishes it. */
  /** S50: is ALT a reload for THIS player? `loadout.overrides.easy_reload` is the live shape (the
   *  per-player accessibility block, `docs/spec/loadout.md` §2); the `alt_reload` perk effect is the
   *  pre-move shape and stays readable so an older bundle still works. */
  _easyReload() {
    const lo = (this.player && this.player.loadout) || {};
    if (lo.overrides && lo.overrides.easy_reload) return true;
    const pk = lo.perk ? this.perkRow(lo.perk) : null;
    return !!(pk && pk.effects && pk.effects.alt_reload);
  }
  _altPressed() {
    if (this.phase !== 'live' || !this.alive || this.tutorial) return;
    // A20/F15, the same reason `_reloadPulled` refuses: a STUNNED gun is disarmed ($AMMO,<slot>,0,0) and
    // `_onAmmo` drops every $ALCD for the whole window, so a SWITCHING takeover opened here has nothing
    // that can confirm it — it runs to `switchWindowMs()` and then books an ASSUMED swap, leaving
    // `activeSlot` on a weapon the player is not holding for the rest of the life (review 2026-09-12).
    if (this.stunned) { this.log('ALT ignored — the gun is stunned', 'li'); return; }
    if (this._slotCount() < 2) {
      // Bench 2026-09-17 (match 592e444eff): with an empty slot 1, compile.py maps ALT to fn 98 (inert)
      // UNLESS the player is running easy_reload, which keeps ALT -> fn 97 (RELOAD) on purpose
      // (loadout.md §2 `alt_reload`). Calling `_reloadPulled()` for anyone else opened a RELOADING
      // takeover the gun could never complete, since no $ALCD ever answers a no-op button.
      // S50 (merge 2026-09-18): Easy Reload left the perk slot for `loadout.overrides`, where the rest of
      // the per-player accessibility block lives. `compile.py` reads `overrides.easy_reload` and keeps
      // ALT on fn 97 for that player, so the node must ask the same question: reading the retired perk
      // slot left the feature dead on the phone for anyone whose host switched it on. The old perk row
      // is still honoured for a bundle compiled before the move.
      if (this._easyReload()) this._reloadPulled();
      return;
    }
    // A swap ABANDONS a running reload: the gun is putting a different weapon in your hands, so the old
    // slot's magazine stops moving and no further $ALCD can reconcile the takeover. Left running it would
    // sit on the chip bar to its deadline (`reloadUp` outranks `switchUp` in hud.js) and hide SWITCHING.
    if (this.reloading) this._endReload('swapped');
    this.switching = { at: this.now(), from: this.activeSlot };
    this._changed();
  }

  /** Reload handle pulled: the gun refuses fire for the weapon's reload time (catalog reload_s; 1.5 s when unknown). */
  _reloadPulled() {
    if (this.phase !== 'live' || !this.alive || this.tutorial || this.resync || this.reconciling) return;   // resync/reconcile: the gun is disarmed and unverified, no takeover
    // A20/F15: a STUNNED gun is disarmed ($AMMO,<slot>,0,0) and `_onAmmo` drops every $ALCD for the whole
    // window, so a takeover started here could never be reconciled: it would run to its deadline and book
    // `ok:false` on a reload the player never asked the gun for. Refuse the pull instead.
    if (this.stunned) { this.log('reload pull ignored — the gun is stunned', 'li'); return; }
    const cap = this._ammoBySlot()[this.activeSlot] ?? this.mag;                 // the spawn $AMMO cap, not the biggest count seen so far
    if (cap && this.ammo >= cap && (this.reserve || 0) > 0) return;             // nothing to reload — the gun ignores the pull
    if (!(this.reserve > 0)) return;                                           // dry reserve: no reload happens (whatever is in the mag)
    const ws = this.player && this.player.loadout && this.player.loadout.weapons; const w = ws && (ws[this.activeSlot] || ws[0]);
    const row = w && this.weaponRow(w.weapon_id); let secs = row && row.reload_s != null ? +row.reload_s : 1.5;
    // The perk's reload multiplier is applied to the gun's $WEAP reload token by MC (compile.py apply_perks), so the
    // takeover must shrink with it too — quick_hands halves the reload (Tony, 2026-09-04).
    const pk = this.player && this.player.loadout && this.player.loadout.perk ? this.perkRow(this.player.loadout.perk) : null;
    const rm = pk && pk.effects && pk.effects.reload_mult ? +pk.effects.reload_mult : 1;
    if (rm > 0 && rm !== 1 && this.activeSlot === 0) secs *= rm;   // compile applies reload_mult to slot 0 only (slot 1 gets swap_mods)
    const now = this.now();
    // `from`/`cap`/`mag` are what make this a RECONCILIATION and not an animation: `ms` is only the
    // nominal length, and the takeover ends on what the gun's own $ALCD says the magazine did.
    this.reloading = { at: now, ms: Math.max(300, Math.round(secs * 1000)), slot: this.activeSlot,
                       from: this.ammo, cap: cap || null, mag: this.ammo, lastGainAt: now, releasedAt: null,
                       energy: !!(w && isEnergyWeaponId(w.weapon_id)) };
    this._reloadOutcome = null;
    this._gunReadoutReloadGlance();   // A16 §3.1: reload gets a glance at the current readout
    this._changed();
  }
  /** When a running takeover gives up waiting for the gun.
   *
   *  F123: `reloadingMs()` used to be a PURE TIMER, so a reload that never happened animated exactly like
   *  one that did — the 2026-09-11 field report ("the hud animates reloading, but the gun doesnt actually
   *  reload") is that timer. The deadline is now measured from the last time the MAGAZINE MOVED, not from
   *  the pull, which covers both real behaviours in one rule:
   *    · a magazine weapon gains its rounds in one $ALCD, late (F27) — the flat+proportional ceiling covers it;
   *    · a shell-by-shell chain (the shotgun: 6 × ~420 ms) feeds one round at a time, and each shell pushes
   *      the deadline out again, so the bar runs for as long as the gun is really loading and no longer.
   *  No per-weapon "is this a chain reload" flag is needed on the phone for this: the gun tells us. */
  _reloadDeadline() {
    const r = this.reloading; if (!r) return 0;
    const d = Math.max(r.at, r.lastGainAt || 0) + r.ms + Math.max(RELOAD_GRACE_MS, Math.round(r.ms * RELOAD_OVERRUN));
    return r.energy ? Math.max(d, r.at + ENERGY_REFILL_MAX_MS + RELOAD_GRACE_MS) : d;   // pl4: a held recharge lands late
  }
  /** Book the end of a takeover and record WHAT THE GUN DID, so a failed reload can never read as a success.
   *  `why`: 'filled' (mag reached the spawn cap) · 'fired' (a round left the mag, the reload is over) ·
   *  'swapped' (an ALT swap took the weapon away) · 'timeout' (the gun stopped feeding) · 'dropped' (link lost). */
  _endReload(why) {
    const r = this.reloading; if (!r) return;
    this.reloading = null;
    const gained = Math.max(0, (r.mag ?? r.from) - r.from);
    this._reloadOutcome = { ok: gained > 0, filled: r.cap != null ? r.mag >= r.cap : gained > 0,
                            from: r.from, to: r.mag, cap: r.cap, gained, slot: r.slot,
                            ms: this.now() - r.at, why, at: this.now() };
    // A shot mid-reload is the PLAYER cancelling it, not the gun failing to feed — 'reload did NOT take'
    // read as a defect in the log of every chain weapon anybody fires out of (review 2026-09-12).
    if (why === 'fired' && !this._reloadOutcome.filled) this.log(`reload cancelled by a shot: ${r.mag} of ${r.cap ?? r.mag} loaded`, 'li');
    else if (!gained) this.log(`reload did NOT take (${why}) — mag still ${r.mag}`, 'le');
    else if (!this._reloadOutcome.filled) this.log(`reload partial: ${r.from} → ${r.mag} of ${r.cap} (${why})`, 'li');
    this._changed();
  }
  /** tick(): end a takeover the gun has stopped feeding. The decision lives HERE, not in `reloadingMs()`,
   *  which stays pure — but both read the same deadline, so a render between ticks can never disagree. */
  _reloadTick(now) {
    if (this.reloading && now > this._reloadDeadline()) this._endReload('timeout');
  }
  /** Milliseconds into the current reload, or null when none is running (PURE, read by state()). */
  reloadingMs() {
    if (!this.reloading) return null;
    const now = this.now();
    return now > this._reloadDeadline() ? null : now - this.reloading.at;
  }

  _slotCount() {
    const ws = this.player && this.player.loadout && this.player.loadout.weapons;
    return ws ? ws.length : 0;
  }

  /** How long the ALT indicator has been up, or null once it has expired.
   *  PURE — it is read from state() on every render and must never mutate engine state. */
  switchingMs() {
    if (!this.switching) return null;
    const ms = this.now() - this.switching.at;
    return ms > this.switchWindowMs() ? null : ms;
  }
  /** The swap window: MC's `frames.swap_ms` (the tok15 the gun was actually given, perks applied — bench 2026-09-04);
   *  an older MC without it falls back to the stock 850 scaled by an equipped `switch_mult` perk. */
  switchWindowMs() {
    if (this.frames && Number(this.frames.swap_ms) > 0) return Number(this.frames.swap_ms);
    const pk = this.player && this.player.loadout && this.player.loadout.perk ? this.perkRow(this.player.loadout.perk) : null;
    const sm = pk && pk.effects && pk.effects.switch_mult ? +pk.effects.switch_mult : 1;
    return Math.round(SWITCH_MAX_MS * (sm > 0 ? sm : 1));
  }

  /** $ALCD,<mag>,100,<slot>,<reserve>,<heat> — counts are per weapon SLOT; a weapon swap is never a shot.
   *  `heat` is null on a frame with no heat token ($LCD's ammo echo) -- leaves the slot's last-known heat alone. */
  _onAmmo(mag, reserve, slot = 0, heat = null) {
    slot = Number.isFinite(slot) ? slot : 0;
    // Review 2026-09-17: heat is recorded BEFORE the stunned return below. A stun window can land while a
    // heat weapon is mid-cooldown, and skipping the token here (as the ammo/reserve fields correctly do)
    // would only add to how long a stale-but-locked reading can sit unrefreshed -- see HEAT_STALE_MS.
    if (heat != null && !Number.isNaN(heat)) { this.heatBySlot[slot] = heat; this._heatAt[slot] = this.now(); if (heat > 0) this._everHeated[slot] = true; }
    this._heatLockFrame(slot, heat, this.stunned ? null : this._prevAmmo[slot], mag);
    // F15: a stunned gun cannot fire, so any $ALCD in the window is the gun echoing OUR `$AMMO,<slot>,0,0` (whether
    // it does is hardware-UNVERIFIED; this guard makes it safe either way). Counting it would book a magazine of
    // phantom shots, and recording it would make the restore re-send 0 -- a gun disarmed for the rest of the life.
    if (this.stunned) return;
    // F259 (bench 2026-09-18): the same shape as the stun guard above, and for the same reason. Inside the
    // ECHO WINDOW this frame is the gun reading back the node's OWN `$WEAP` reset -- it is not evidence of
    // anything. Not a shot (it booked 26 phantom rounds into `this.shots` per write), not a try-out
    // confirmation (the reset magazine IS the clip a try-out looks for), not a reload, not resync proof,
    // and not a magazine worth showing: Tony watched the HUD jump to 32 every time he fired. The node
    // already knows the count, because it wrote it -- so book NOTHING, leave `_prevAmmo` where it was so
    // the next real frame measures from before the write, and put the ACCOUNT on the screen.
    let prev = this._acctAmmo(slot, mag, this._prevAmmo[slot]);
    if (prev === null) {
      const a = this._shotAcct[slot];
      this._publishAmmo(slot, this._acctLive(slot), a ? a.res : null);
      return;
    }
    // F147 (tightened, polish-loop passes 1+2): the gun's own confirmation that a try-out weapon write
    // actually took — a fresh magazine at the new weapon's full clip, on the SLOT that weapon is landing
    // in. Pass 2 bug: `$LCD` reports whichever slot is ACTIVE, so a routine report for the gun's CURRENT
    // (old) weapon — a different slot entirely — used to foreclose confirmation just by arriving first;
    // an other-slot report is now simply ignored, neither confirming nor foreclosing. Within the right
    // slot: only the FIRST report counts, it must be an exact clip match, AND it must differ from the
    // baseline (the old weapon's last-known magazine on that same slot before the write) — a same-slot
    // resend that just repeats what was already there proves nothing new happened. `clip == null` is the
    // ack-time placeholder (`_loadoutAck`) with no weapon confirmed yet: nothing to match against, so no
    // report can pass or fail it until `_tutorial` fills the clip in. A report that fails the check never
    // gets a second chance — it marks the arming unconfirmable-by-ammo, and the TRYOUT_ARM_MAX_MS timeout
    // is what resolves it (honestly, as unconfirmed — see `tick()`).
    if (this.tryoutArming && this.tryoutArming.clip != null && slot === this.tryoutArming.gunSlot) {
      if (!this.tryoutArming.seen && mag === this.tryoutArming.clip && mag !== this.tryoutArming.baseline) { this.tryoutArming = null; this.tryoutUnconfirmed = null; }
      else this.tryoutArming.seen = true;
    }
    // F209: a round leaving slot 0 or 1 is the gun's own proof it can fire, so hit reception arms now.
    // F209/S7.1: a reconcile disarms with its own `$AMMO` write (`_beginReconcile`), and the gun's echo
    // of that looks exactly like "a round left the mag" -- skip the first-shot arm while reconciling so
    // that echo cannot arm hit reception early; `_endReconcile` re-arms explicitly once it is done.
    if (this._armPending && this._armPending.shotEnds !== false && (slot === 0 || slot === 1) && prev != null && mag < prev && !this.reconciling) this._armLife('first shot');   // 2026-09-19: a profile life never ends on a shot
    if (prev != null && mag < prev) this._actSeq++;   // pl4: `_writeMust` never repeats counts past a shot
    if (prev != null && mag < prev && this.phase === 'live') this.shots += (prev - mag);
    // Bench 2026-09-17: the shot-ready cue times from THIS frame, the gun's own report of the round, so the
    // cue can only be late, never early. Slots 0/1 only: slot 4 is melee and has no gauge.
    if (prev != null && mag < prev && this.phase === 'live' && (slot === 0 || slot === 1)) this.lastShot = { slot, at: this.now(), ms: this._fireIntervalMs(slot) };
    if (this.resync && prev != null && mag < prev) this._resyncEvidence('alcd-dec');
    if (this.resync && prev != null && mag > prev) this._resyncEvidence('alcd-inc');
    // F123: the takeover is reconciled against the REAL magazine, one $ALCD at a time. A rise feeds it
    // (and pushes the deadline out, which is what lets a shell-by-shell chain run to the end instead of
    // clearing on shell #1); reaching the spawn cap finishes it; a round leaving the mag ends it, because
    // the player has started shooting again. It is no longer cleared by "the mag went up" alone.
    if (this.reloading && prev != null && slot === this.reloading.slot) {
      if (mag > prev) {
        this.reloading.mag = mag; this.reloading.lastGainAt = this.now();
        if (this.reloading.cap != null && mag >= this.reloading.cap) this._endReload('filled');
      } else if (mag < prev) {
        // Book the outcome from the PRE-SHOT magazine. Overwriting `r.mag` with the post-shot count first
        // made a shotgun chain that loaded two shells and then fired read as `gained:0, ok:false` — the exact
        // false verdict F123 exists to prevent. The shot is not part of what the reload achieved.
        this._endReload('fired');
      }
    }
    // the RELOAD nag: the magazine came back, so the dry spell is over and the RELOAD nag counts from one again. Keyed on
    // the gun's own rising count rather than on `_endReload`, because that is what "the player reloaded" means
    // on the wire -- a shell-by-shell shotgun chain, a swap onto a loaded slot and a spawn refill all land here.
    if (prev != null && mag > prev) this._dryPulls = 0;
    if (this.switching && slot !== this.switching.from && slot < 2) {
      // slot 4 is MELEE and arrives on its own $ALCD — it is not the weapon swap we were waiting for.
      // NB this interval is ALT-press -> next SHOT, so it includes the player's reaction time. It is a
      // lower bound on "the swap had finished by", NOT a measurement of the swap itself (FOLLOWUPS F4).
      this.lastSwitchMs = this.now() - this.switching.at;
      this.log(`slot ${this.switching.from}->${slot} confirmed ${this.lastSwitchMs}ms after ALT (incl. reaction)`, 'li');
      this.switching = null;
      this.moment = { kind: 'switched', at: this.now(), data: { slot } };   // the HUD flips SWITCHING → ACTIVE
      // ⚠ The slot moves BEFORE the re-arm (polish review 2026-09-18). `_recoilArm` reads `this.activeSlot`
      // for both the weapon it looks up (`_activeWeaponId`) and the slot it records, and the assignment used
      // to sit below this block -- so a confirmed swap armed the OLD weapon's profile and filed it under the
      // OLD slot, which is the opposite of what the line below says it does. The assignment after the block
      // is now a no-op on this path and still does the work on every other.
      this.activeSlot = slot;
      this._recoilArm('swap (confirmed)');   // S42: the new slot's weapon gets its own profile, at its ceiling
    }
    this._prevAmmo[slot] = mag; this.activeSlot = slot;
    // S42/F259: recoil is stepped by `_acctSpent`, off the ACCOUNT above, never off this raw decrement.
    // The node's own `$WEAP` reset and `$AMMO` restore arrive here as a 26-round drop that no player fired
    // (bench 2026-09-18), and reading the frame delta booked it as a burst -- see the echo-window note.
    if (reserve != null && !Number.isNaN(reserve)) this._prevReserve[slot] = reserve;
    this._publishAmmo(slot, mag, reserve);
    // heat itself is recorded at the top of this function, before the stunned return.
  }

  _onHp(hp, armor, shield, solicited = false) {
    this.poolSrc = 'gun';                     // R2-3: same as $LCD -- this pool is the gun's own word
    if (hp > 0) this._armedThisLife = true;   // B5: the gun has now confirmed a life on the wire -- the settle window is over
    // Damage drains shield -> armor -> HP (bench 2026-08-27). Omitting shield from the
    // total made every shield-absorbed hit compute dmg === 0, which the guard below then
    // dropped entirely -- no hit_taken fact, no HUD feedback, no score. See FOLLOWUPS Q12.
    if (shield === undefined) shield = this.shield;
    const before = this.hp + this.armor + this.shield;
    if (this._prevHp === undefined) { this._prevHp = this.hp; this._prevArmor = this.armor; this._prevShield = this.shield; }
    // A16 §3.1/§5: which pool actually moved -- health, then armour, then shield (mirrors poolgauge.changed_pool:
    // BRX depletes shield -> armour -> health, so when a hit spills across two pools the INNER one is the
    // news). Computed here, BEFORE `_prevHp` etc are overwritten below, and read by `_gunPoolPaint`.
    const movedPool = hp !== this._prevHp ? 'health' : armor !== this._prevArmor ? 'armor' : shield !== this._prevShield ? 'shield' : null;
    this.hp = hp; this.armor = armor; this.shield = shield;
    const dmg = Math.max(0, before - (hp + armor + shield));
    if (dmg > 0) this._actSeq++;   // pl4: nor past a hit
    // S29: damage RESTARTS the recharge clock and abandons a refill already running -- Callsign does the same
    // (`DetectRecoverShieldCommand._lastHitTime`), and it is the whole mechanic: the shield comes back only
    // when you break contact. Stamped on the pools moving, not on the `$HIR`, so a hit whose `$HIR` was lost
    // or merged (protocol §2) still counts -- the pool falling is the damage, the latch is only who did it.
    if (dmg > 0) { this._shieldQuietAt = this.now(); this._shieldRegen = null; this._shieldGaveUp = false; }
    // S29 (Tony, by ear 2026-09-18): the shield BREAKING is its own cue. The edge is `>0 -> 0`, so a spawn
    // (which starts at 0 and never crosses) cannot fire it, and neither can a second `$HP` repeating the 0.
    // ⚠ `reconciling`/`resync`/`ble` are in the stand-down too (polish review 2026-09-18): the node infers
    // nothing in those windows (§3.10), and the gun's first word back after a relink is it catching us up on
    // a break that happened while we were away. Announcing it then names a hit the player took minutes ago.
    if (!this._standDown(['phase', 'spawned', 'ble', 'alive', 'reconciling', 'resync', 'tutorial'])
        && this.maxShield > 0 && this._prevShield > 0 && shield === 0) {
      this._shieldDown = true;
      this._shieldLoopAt = this.now();   // the heartbeat starts one period LATER, so it does not land under the break cue
      this.log(`shield depleted (${this.maxShield} gone) -- health is all that is left`, 'lk');
      this._event('shield_down');
    }
    // Victim-side low-health alert, once per life. Callsign sends $PLAY,VA8B + $HLED,7,4,90,90,10,15
    // shortly after ARMOUR reaches 0 and HP starts dropping (capture 2026-08-23-two-tagger-combat:
    // 2 deaths, 2 alerts, both at $HP,34,0,0). We sent neither, which is why our headsets stayed dark.
    //
    // A17.2 (Tony, bench 2026-09-07: "low_health shouldn't be used there. it should be used when total
    // hp is under 20"): it now fires on an ACTUAL HEALTH THRESHOLD, not on armour running out. The old
    // condition (armour 0 AND any HP lost) fired on the FIRST health hit of a life -- at 44/45 HP if
    // that is where you were -- so an alert named "low health" meant "your armour just failed". A17 made
    // that impossible to ignore rather than causing it: health hits are now silent from the gun, so this
    // alert became the ONLY sound on the armour->health transition and read as the hit sound itself.
    // The `maxArmor > 0` guard is gone with it: a HP threshold is meaningful whether or not the loadout
    // ever had armour, which is what that guard was working around.
    let hurtNow = false;
    if (this.phase === 'live' && this.spawned && this.alive && !this.tutorial
        // `dmg > 0` mirrors stage.py, which imposes it structurally (its check is nested inside
        // `if dmg > 0`). Without it a ZERO-damage $HP frame -- a heal or regen tick, or a plain resend --
        // could trip the alert while merely LEAVING you under the threshold, and a heal is the opposite
        // of the news this alert exists to carry. A genuinely damaging drop always has dmg > 0, so
        // nothing real is lost. Found by review 2026-09-07: the two mirrors had diverged here.
        && !this.hurtFired && dmg > 0 && this.hp > 0 && this.hp < LOW_HEALTH_HP) {
      this.hurtFired = true; hurtNow = true;
      const c = this.frames && this.frames.cues;
      const fr = c ? [c.hurt, c.hurt_led].filter(Boolean) : [];
      // logged explicitly: after the last field session we could not tell whether the alert had
      // fired at all, because the frame ring only holds 60 frames and had rolled past it.
      this.log(`low-health alert: hp ${this.hp} < ${LOW_HEALTH_HP} — ${fr.length} frame(s)`, 'lk');
      // Office test 2026-09-19 (Pixel 4/5): a killing hit landing within the same second as this alert let the
      // voice line reach the gun BEFORE `_death`'s $PLAYX (F149, below) could stop it -- the write was already
      // away over BLE by the time the death frame arrived a few tens of ms later. HURT_DEBOUNCE_MS holds the
      // write here instead of sending it at once; `_death` cancels it outright (never sent) when it lands
      // inside the window, and falls back to the existing $PLAYX stop once the debounce has already fired.
      if (fr.length) {
        this._pendingHurtWrite = true;
        this.delay(HURT_DEBOUNCE_MS, () => {
          if (!this._pendingHurtWrite) return;   // cancelled by a death that landed first
          this._pendingHurtWrite = false;
          this._hsGen = (this._hsGen || 0) + 1; this._write(fr, 'low health');   // cancels a pending hit-flash rest step (polish 2026-09-04)
        });
      }
    }
    if (this.phase === 'live' && this.spawned && this.alive && this.hp > 0 && dmg > 0 && !this.tutorial) {
      // A registered hit WIPES the headset: the native flash runs, then it goes dark and our team
      // colour never comes back (bench 2026-09-03, hled_spawned.py). Re-send it so other players
      // keep seeing the team for the rest of the life. Skipped on the hit that fired the low-health
      // alert -- that alert IS the headset for the next ~3 s and a repaint would cut it short. A
      // static frame, one write per hit, never hammered. Empty cue = LEDs off or unknown colour.
      const hs = this.frames && this.frames.headset;
      if (hs && !hurtNow) {
        // A16 §3.3: whatever role is held (carrier/infected/vip/beacon/extracted) survives the hit — the
        // rate gate (§C) applies to this re-assert and to the plain hit flash, never to the alert/team-flip
        // writes that first turned the role on.
        const role = this._activeRole, roleSeq = role && this._roleSeq(role.name, role.tid);
        if (roleSeq) this._headsetFlash(roleSeq, `role ${role.name} after hit`);                            // the role blink survives a hit
        else if (hs.hit && hs.hit.length) this._headsetFlash(hs.hit, 'hit');                                // A11.6: flash, then back to rest
        else if (hs.rest && hs.in_play === 'team') this._write([hs.rest], 'team led');                     // no flash configured: just restore
      } else {
        const tl = this.frames && this.frames.cues && this.frames.cues.team_led;   // pre-A11.6 bundle
        if (tl && !hurtNow) this._write([tl], 'team led');
      }
    }
    if (this.phase === 'live' && this.spawned && this.latch && this.now() - this.latch.at <= 1000 && dmg > 0 && !this.tutorial) {
      // `sensor` is $HIR tok1: 0-3 are ALL HEADSET sensors (it has four; 0 = front and 1 = back are
      // bench-mapped, 2 and 3 are not), 4 = gun body. It was parsed
      // and dropped, so MC could not see WHICH sensor caught a hit — answering that took the phone's
      // raw frame ring (field 2026-09-01). One field, and the question becomes readable live.
      this.emitFact({ type: 'hit_taken', match_id: this.matchId, shooter_num: this.latch.shooter_num,
        shooter_team: this.latch.shooter_team, dmg, ir_proto: this.latch.ir_proto, sensor: this.latch.sensor });
      this.lastHitAt = this.now();
      // F57 (bench 2026-09-09, "the critical sounds are a bit bugged when it was at 1 red"): the hit that CROSSES the
      // low-health threshold used to fire `low_health` AND the pain grunt in the same millisecond, and the gun plays
      // one clip at a time, so they cut each other off -- exactly once per life, at the moment the warning is the
      // whole point. The warning IS the reaction to that hit, so the grunt is suppressed on it (the A17 "never on
      // the lethal hit" precedent: two cues, one speaker, the rarer one wins). The pain gate is stamped too, so a
      // follow-up hit inside PAIN_GAP_MS cannot cut the warning short either; past the gap the grunt is back.
      if (this.alive && hp > 0) { this._event('hit_taken'); if (hurtNow) this._lastPainAt = this.now(); else this._pain(dmg, this.latch.ir_proto, movedPool); }   // A11: a death is its own event; A15.3: our pain grunt by damage; A17: only when it reached HEALTH; F57: not on the low-health crossing
    }
    // HUD moments. The gun's own LED strip cannot hold a steady colour in game (the firmware
    // animates it, and winning that fight needs ~30Hz repaints which STROBE), so the phone carries
    // the detailed feedback — it is the one surface we fully control. See experiment-log 2026-09-02.
    if (this.phase === 'live' && this.spawned && this.alive && !this.tutorial) {
      // A hit must not overwrite a rarer, more important moment that is still on screen. There is
      // ONE moment slot and `hit` is by far the most frequent producer, so without this a kill
      // confirm landing in the same tick as a hit is silently lost -- verified, it rendered only the
      // hit. Kill/redeploy/down own the screen for their own duration.
      // ONE RENDER TICK, not the overlay's display duration. The race is only that a rarer moment
      // set in the same tick is overwritten before the HUD has rendered it -- once rendered, the
      // kill/redeploy overlay is its own DOM node and a later hit does not disturb it.
      // Guarding for the full display duration was worse than the bug: a player shot while a kill
      // banner was up would never be told they were hit, and being hit is the one thing they cannot
      // afford to miss.
      const RARE_GUARD_MS = 250;
      const m = this.moment;
      const busy = m && ['kill', 'redeploy', 'down', 'match_over'].includes(m.kind)
        && (this.now() - m.at) < RARE_GUARD_MS;
      if (busy) { /* let the rarer moment survive long enough to be rendered */ }
      else if (dmg > 0 && hp > 0) {
        // A death sets its own 'down' moment; a hit that kills must not flash "hit" first.
        this.moment = { kind: 'hit', at: this.now(),
          data: { dmg, shooter_team: this.latch ? this.latch.shooter_team : 0,
                  // the KEY, not the tid: the engine already owns tid->key (TEAM_KEY), and a second
                  // copy of that mapping in the HUD is a divergence waiting to happen
                  shooter_key: TEAM_KEY[this.latch ? this.latch.shooter_team : 0] || 'red',
                  sensor: this.latch ? this.latch.sensor : null, hp, armor, shield } };
      } else if (before > 0) {
        // Pools went UP: a heal, an armour pickup, or a shield grant. `before > 0` keeps the
        // spawn/respawn refill out of it — that has its own 'redeploy' moment.
        const gains = [['health', hp - this._prevHp], ['armor', armor - this._prevArmor],
                       ['shield', shield - this._prevShield]].filter(g => g[1] > 0);
        if (gains.length) {
          gains.sort((a, b) => b[1] - a[1]);
          this.moment = { kind: 'gain', at: this.now(),
            data: { pool: gains[0][0], amount: gains[0][1], hp, armor, shield } };
          // S29/S45: a RECHARGE is a dozen `$LIFE` grants 300 ms apart and the gun plays one clip at a time,
          // so the per-grant `shield_up` line cannot be allowed to fire twelve times over the top of it. The
          // recharge owns its own audio: `shield_charging` when `_shieldTick` writes the first grant, then
          // silence, then `shield_online` on the grant that reaches the ceiling (F57's rule -- two cues, one
          // speaker, the rarer one wins). `shield_up` survives for what it was always for: a grant that is
          // NOT our recharge, an IR pickup or a host grant.
          //
          // What makes "full" an EDGE is this branch, not a comparison of its own: nothing here runs unless a
          // pool actually ROSE this frame, so a `$HP` that merely reports a shield already at the ceiling is
          // silent, and a spawn cannot fire it either (a spawn shield is always 0, bench 2026-08-27, so the
          // first grant of a life is a real charge). `maxShield > 0` is the load-bearing half: a head with no
          // shield configured must not have every grant read as "full", and 0 >= 0 would say exactly that.
          const full = this.maxShield > 0 && shield >= this.maxShield;
          const pool = gains[0][0];
          if (pool === 'shield' && full) this._shieldCharged();
          const kind = pool === 'health' ? 'healed' : pool === 'armor' ? 'armour_up'
            : full ? 'shield_online' : this._shieldRegen ? null : 'shield_up';   // mid-recharge: `shield_charging` already spoke
          if (kind) this._event(kind);   // A11
        }
      }
    }
    this._prevHp = hp; this._prevArmor = armor; this._prevShield = shield;
    if (hp > 0) this._gunPoolPaint(movedPool);   // A16 §3.1 (readout) / A11.7 legacy (a hit does not clear a held paint, bench 2026-09-04; only the band change is written)
    const wasResync = !!this.resync || !!this.reconciling;
    if (this.resync) this._resyncEvidence('hp');
    // F264: `solicited` means this `$HP` answers our own `$LIFE,0,0,0,*` probe, so the node learned the zero out
    // of band rather than from a live hit sequence -- a desync death by §3.3's definition, same as a reconcile's.
    if (hp === 0 && this.alive && this.phase === 'live' && !this._deathPending()) this._death(wasResync || solicited);   // a death learned during resync/reconcile is a desync death
  }

  /** B5 (phantom death on spawn race): a zero-HP frame the instant after a `_spawn`/`_revive` write can be a
   *  STALE echo the gun queued before it processed `$SPAWN` -- it reflects the life that just ended, not this
   *  one. The write sets `alive`/`hp` locally right away, but nothing proves the GUN has caught up until it
   *  reports hp>0 on the wire. So for a short settle window after that write, an unattributed zero is presumed
   *  stale and dropped rather than manufacturing a shooter-0 death (which then swallows the REAL kill a moment
   *  later, since `alive` is already false when it arrives). Two ways out of the window, either is real evidence:
   *  the gun has reported hp>0 since the write (`_armedThisLife`), or there is a FRESH latch -- a spawn-camp kill
   *  is a real hit and must still count, immediately, with the shooter attributed. Past the window with neither,
   *  fall through to `_death`'s existing stale-latch handling (shooter unknown) -- that is attribution loss, a
   *  different and already-handled case, not this one. */
  _deathPending() {
    // S7.1 reconcile (a BLE-drop rejoin, not a spawn/revive write) trusts a real $HP,0 outright -- that
    // path already restores hp/alive from the gun's own state rather than a local write, so there is no
    // queued-before-$SPAWN echo to guard against, and "never infer death" there means never guess one
    // from silence, not suppress one the gun just reported.
    if (this.reconciling) return false;
    if (this._armedThisLife) return false;
    const now = this.now();
    if (this.latch && now - this.latch.at <= C.DEATH_LATCH_MS) return false;
    return this._spawnAt != null && now - this._spawnAt < C.DEATH_LATCH_MS;
  }

  _death(desync) {
    // F209: one death per life. Every caller checks `alive` too; this makes it hold for any future caller, so a
    // burst of lethal frames can never book a second death fact, a second deaths++ or a new respawn clock.
    if (!this.alive) return;
    this._armPending = null; this._triggerPending = null;   // F209: never arm a dead gun; the revive protects and arms again
    // 2026-09-19: killed this soon after a timed respawn = spawn-killed; the down-screen warning gets louder (never quieter).
    if (this._timedLifeAt != null && this.now() - this._timedLifeAt <= SPAWN_KILL_WINDOW_MS && this._downWarn < DOWN_WARN_MAX) { this._downWarn++; this.log(`killed ${Math.round((this.now() - this._timedLifeAt) / 100) / 10}s after a timed respawn: down warning level ${this._downWarn}`, 'li'); }
    this._timedLifeAt = null;
    this._shieldRegen = null; this._shieldDown = false;   // S29: a dead gun is not refilled, and the heartbeat stops with the life
    this.reloading = null; this.switching = null; this._reloadOutcome = null; this.held = {};   // the gun stops the reload/swap when you drop; so does the HUD
    const fresh = this.latch && this.now() - this.latch.at <= C.DEATH_LATCH_MS;
    const shooter_num = fresh ? this.latch.shooter_num : 0;
    const shooter_team = fresh ? this.latch.shooter_team : (this.latch ? this.latch.shooter_team : 0);
    // F81: wire id 0 is "no identity" (A5.1) -- a grenade hill's ambient damage word (F69) or a gun whose `$PSET`
    // never landed (F80). Its team field is the hill's OWNER, so naming that team as the killer told the player a
    // specific lie ("KILLED BY GREEN" when nobody shot them). MC already refuses to credit wire 0; the phone now
    // says the killer is unknown. A stale latch (older than DEATH_LATCH_MS) is the same case: nobody we can name.
    const unknown = !fresh || shooter_num === 0;
    this.alive = false; this.deaths++; this.deadAt = this.now(); this._downRearmSent = false;   // §3.2: fresh rearm gate for this life
    // F149 (field 2026-09-12, "the low-health breathing loop played AFTER a death"): `cues.hurt` (A17.2) is a
    // several-second voice sample, and a death can land while it is still playing -- the killing hit itself
    // was often a SEPARATE $HP frame moments after the one that first crossed under 15 HP. Death has nothing
    // of its own to interrupt it with: A15.3 keeps the death sound NATIVE on purpose (`cues.died` is never
    // populated, contracts.md A11.2/golden_bundle.json), so `_event('died')` below writes nothing. `$PLAYX,0,*`
    // is the one bench-proven stop-playback frame (protocol.md; the same trick `_hillSay`'s preempt already
    // uses) -- write it once, only when THIS life actually fired the alert, so an ordinary death never sends
    // an extra frame. ⚠ NOT bench-verified: whether this also clips the firmware's own native scream, which
    // fires off the same $HP,0 packet -- needs a real gun (FOLLOWUPS F149).
    if (this._pendingHurtWrite) { this._pendingHurtWrite = false; this.log('low-health alert cancelled — a death landed inside the debounce window (2026-09-19)', 'lk'); }
    else if (this.hurtFired) this._write([PLAYX], 'death: stop the low-health loop (F149)');
    this._stunRestore('died');   // F15: death cancels the stun -- no restore write; the revive's own $AMMO re-arms the next life
    // A16 §5 (AMENDED 2026-09-11 by F113): death clears the readout AND blanks the strip.
    this._readoutFrame = null; this._readoutHoldActive = false; this._readoutLastWriteAt = null; this._readoutLastPool = null;
    // A16.3: death cancels any drop/gain animation outright (bar-spec: "Cancel everything ... on death") --
    // the killing hit itself never reaches here (`_gunPoolPaint` is only called `if (hp > 0)`), but a hit
    // just before it can still be mid-animation when death registers.
    this._roGen = (this._roGen || 0) + 1; this._roLevel = null; this._roPool = null; this._roAnimating = false; this._roBlinkAt = 0; this._roBlinkOn = false;
    this._gunBlankOnDeath();   // F113: ...and then turn the strip OFF, rather than leaving it frozen mid-animation
    this._activeRole = null;   // A16 §3.3: cleared BEFORE the infection check below, which may assign a fresh 'infected' role in the same call
    this.killedBy = unknown
      ? { num: 0, team: null, name: null, teamName: null, teamKey: null, unknown: true }
      : { num: shooter_num, team: shooter_team, name: this.nameOf(shooter_num), teamName: TEAM_NAME[shooter_team] || `TEAM ${shooter_team}`, teamKey: TEAM_KEY[shooter_team] || 'red' };
    this.emitFact({ type: 'death', match_id: this.matchId, shooter_num, shooter_team, ...(desync ? { desync: true } : {}) });
    const flipTable = (this._respawnProfile() && this._respawnProfile().team_flip) || (this.frames && this.frames.team_flip);   // 2026-09-19: the timed-profile bursts
    if (this.config && this.config.mode === 'infection' && flipTable) {
      const tids = Object.keys(flipTable).filter(k => Number(k) !== this.teamTid);
      // Whether a mid-match $TID write changes the gun's own friendly-fire resolution is UNTESTED (modes §9); MC scores via team_change regardless.
      if (tids.length) {
        const tid = Number(tids[0]); this._write(flipTable[tids[0]], 'team_flip'); this._armAfterSpawn(true); this.emitFact({ type: 'team_change', match_id: this.matchId, tid });
        this._turned = true;
        this._event('infected');   // A11.4: HUD-driven -- this gun just turned; MC's broadcast only tells the OTHERS
        // A16 §3.3/finding #4: infection is not a real death (the player "re-takes the body" immediately),
        // so the turned player's held headset colour is assigned right here, through the role mechanism,
        // instead of the one-shot events table that a hit later wipes with nothing to restore it.
        this._setRole('infected', true, tid);
        const tm = ((this.config && this.config.teams) || []).find(x => Number(x.tid) === tid);
        this.team = tm ? { ...tm } : { ...(this.team || {}), tid, team_id: `tid-${tid}`, name: TEAM_NAME[tid] || `TEAM ${tid}` };
      }
    }
    this.switching = null;          // a swap indicator must not outlive the player
    this.moment = { kind: 'down', at: this.now() };
    this._event('died');   // A11
    if (this._headsetDeath().length) { this._headset(this._headsetDeath(), 'death'); this._deathBlinkAt = this.now(); }   // A11.6 out-blink (empty = the 'native' opt-out; nothing to paint)
    this.carrying = null;
    this.log(`☠ down — by ${this.killedBy.name || this.killedBy.teamName || 'UNKNOWN'}`, 'le');
    this._changed();
  }

  // ---------- §3.10 resync: trigger first, then reload, then trigger ----------
  // ---------- S7.1 reconnect reconcile: disarm, keep the real pools, re-arm — never infer death ----------
  /** A rejoin into a LIVE match. The gun keeps its config + pools across a BLE drop, and `_load` restored
   *  the real alive/hp — so we DON'T guess. Hold a disarmed window (anti-cheat: a restart is slow and
   *  gains nothing), then re-arm to the restored pools with NO $SPAWN/$PSET (so HP is never reset to full).
   *  This replaces the old trigger-first resync, which mis-concluded "dead" on reconnect and let the
   *  auto-respawn HEAL the player — a free respawn on restart (bench 2026-09-04, Tony). */
  _beginReconcile() {
    if (this.reconciling) return;
    this.reconciling = { since: this.now() };
    this.resync = null;                                   // never run the infer-death machine on a rejoin
    this._stunRestore('reconcile');                       // F15: the reconcile owns the disarm/re-arm from here (coarse: it re-arms with the frame's counts)
    this._write(['$AMMO,0,0,0,1,*', '$AMMO,1,0,0,1,*'], 'reconcile: disarm');   // no shots count while we reconcile
    // F264 (Tony, 2026-09-18): ...and ASK. §3.10's rule is that the node must never INFER inside this window, and
    // the gun may well have died while the app was away (the S7 gap-death limitation, which inference cannot see).
    // A probe is not an inference: it is how the node stops needing one. The reply lands through the ordinary
    // handler, which §3.10 already says to trust verbatim here. Acting still stands down; reading does not.
    this._askGun('reconcile: read the gun rather than infer it');
    this.log('reconnect — reconciling (gun held ' + RECONCILE_MS + ' ms)', 'li');
    this._changed();
  }
  /** End the reconcile: re-arm to the RESTORED pools. Alive → restore the loadout mags so the gun fires
   *  again at its real HP. Down → leave it disarmed (it is out, awaiting a real respawn). Never writes
   *  $SPAWN or $PSET, so a rejoin can never heal. */
  _endReconcile() {
    this.reconciling = null;
    if (this.alive) {
      const ammo = ((this.frames && this.frames.spawn) || []).filter(f => f.startsWith('$AMMO,'));
      if (ammo.length) {
        this._write(ammo, 'reconcile: re-arm');
        // S42 (merge 2026-09-17): the reconcile re-arms COARSELY, with the frame's spawn counts. The accuracy
        // writer's `$AMMO` restore carries the node's magazine account, which is still the pre-drop live
        // counts, so a write here would put the old magazine straight back over the re-arm. Re-arm the model
        // instead: it returns to the weapon's CRISP value with nothing dirty, so nothing is written until the
        // burst that degrades it -- by which time the gun's own `$ALCD` has re-seated the account (F259).
        this._holdAccuracyWrites('reconcile re-arm');
        this._recoilArm('reconcile');
      }
      // F209: the drop may have landed inside spawn protection, or an app restart lost `_armPending`. Re-sending
      // the real table is the F11 repair path, so a rejoin always ends with hit reception armed. Routed through
      // `_armLife` (not a bare `_write`) so a `false` resolve on a link that stays up re-arms for retry instead
      // of silently leaving the gun on fn 28 for the life.
      // F121 rebuild: a drop may hide a reboot, which empties the table (F11), so the take is re-sent here too.
      if (this._protectsSpawn()) { this._sirLive = false; this._armPending = this._repairArm(); this._armLife('reconcile'); }
      // 2026-09-19: a respawn profile's `trigger_live` write can be lost the same way -- a BLE drop in flight, or
      // an app restart mid-delay -- and nothing else would ever retry it, holding `$BMAP,0,98` for the rest of
      // the life. `!this._triggerPending` means the weapon delay is already over (or was never running): the
      // trigger should already be mapped, so re-send it as a repair. A delay still due is left alone -- `tick()`
      // fires it when it is due, and forcing it early would let the player fire while still protected.
      const rp = this._respawnProfile();
      if (rp && !this._triggerPending) {
        const r = this._write([rp.trigger_live], 'reconcile: weapon systems live');
        Promise.resolve(r).then(ok => {
          if (ok !== false || this.phase !== 'live' || this.ended || !this.alive || this._triggerPending) return;
          this._triggerPending = { at: this.now(), due: this.now(), flip: false };   // as `_armLife` re-arms its own lost take, not `_writeMust`'s one-shot retry
        });
      }
    }
    this.log(`reconcile done — ${this.alive ? 'live' : 'down'} at hp ${this.hp}`, 'lk');
    this._changed();
  }

  _beginResync(why) {
    if (!(this.phase === 'lobby' || this.phase === 'armed' || this.phase === 'live')) return;
    if (this.phase === 'lobby') { this.log(`resync (${why}): LOBBY → re-write head`, 'li'); this._applyConfig({ config: this.config, frames: this.frames, roster: this.roster }, 'hydrate'); return; }
    if (this.phase === 'armed') { this.log(`resync (${why}): ARMED → re-write head, T-0 spawns as scheduled`, 'li'); if (this.frames) this._writeHead('resync head (armed)'); return; }
    this.resync = { step: 1, since: this.now(), prompt: 'pull the trigger', reserve: this.reserve, probes: 0 };
    this.log(`resync (${why}): evidence protocol started`, 'li');
    this._changed();
  }
  _resyncEvidence(kind) {
    const r = this.resync; if (!r) return;
    if (kind === 'hp' || kind === 'lcd') {
      // Polish 2026-09-04: `alive` is not persisted and a reload mid-match restores it false. A state line
      // with hp > 0 IS the evidence the gun is up; without this, tick() stamped deadAt on a healthy gun and
      // auto-revive wrote $SPAWN + $AMMO (full heal, refill, a bogus respawn fact) 10 s later.
      if (this.hp > 0 && !this.alive) this.alive = true;
      this._resyncDone('state line'); return;
    }
    if (kind === 'alcd-dec') { this._resyncDone('alive (shot went out)'); if (!this.alive) { this.alive = true; } return; }
    if (kind === 'alcd-inc' && r.step === 2) { r.step = 3; r.since = this.now(); r.prompt = 'pull the trigger'; this._changed(); }
  }
  _resyncButton(id, state) {
    const r = this.resync; if (!r || state !== 1) return;
    if (id === 0 && r.step === 1) { r.step = 2; r.since = this.now(); r.prompt = 'now the reload handle'; r.trigNoAlcd = true; this._changed(); return; }
    if (id === 2 && r.step === 2) { r.reloadAt = this.now(); return; }
    if (id === 0 && r.step === 3) { r.trig3At = this.now(); return; }
  }
  _resyncTick() {
    const r = this.resync, now = this.now();
    // step 2: a reload pull happened but no $ALCD followed within 1.5 s
    if (r.step === 2 && r.reloadAt && now - r.reloadAt > 1500) {
      const reserveKnown = r.reserve != null ? r.reserve : (this.reserve != null ? this.reserve : 1);
      if (reserveKnown > 0 || r.probes >= 1) return this._resyncNotLive('reload silent');
      // reserve == 0: ambiguous (out of ammo vs unconfigured) — wait one more probe window, then escalate (non-LMS)
      r.probes++; r.reloadAt = null; r.since = now; r.escalateAt = now + C.RESYNC_PROBE_S * 1000; r.prompt = 'out of reserve? wait…'; this._changed(); return;
    }
    if (r.step === 2 && r.escalateAt && now >= r.escalateAt) {
      if (this.respawnType === 'none') { r.escalateAt = null; r.prompt = 'out of reserve — stay put'; this._changed(); return; }   // LMS: stay last-known
      return this._resyncNotLive('reserve 0 timeout');
    }
    // step 3: trigger pulled after a good reload, no $ALCD within 1.5 s → dead
    if (r.step === 3 && r.trig3At && now - r.trig3At > 1500) {
      this.resync = null;
      if (this.alive) { this.log('resync: dead (trigger after reload, no fire)', 'le'); this._death(true); }
      this._changed(); return;
    }
    if (now - r.since > C.RESYNC_PROBE_S * 1000) { r.since = now; /* keep prompting; never write */ this._changed(); }
  }
  _resyncNotLive(why) {
    const lms = this.respawnType === 'none';
    this.log(`resync: not a live configured gun (${why})${lms ? ' — LMS: marked dead, nothing written' : ''}`, 'le');
    this.resync = null;
    if (lms) { if (this.alive) this._death(true); this._changed(); return; }
    if (this.phase === 'live') {
      if (this.alive) this._death(true);
      if (this.frames) this._writeHead('resync head');
      // normal respawn timer then revive (flagged resync)
      this._resyncRevive = true;
      this._changed(); return;
    }
    if (this.phase === 'armed' && this.frames) this._writeHead('resync head (armed)');
    this._changed();
  }
  /** Every head write goes through here: the head starts with $CLEAR, so its $LCD,0,0,… echo must read as a
   *  reset (prev=0 per slot), never as a magazine dump into `shots`. */
  /** Every head write starts with $CLEAR → the gun is back on weapon slot 0 (so $LCD, which carries no slot, books to slot 0). */
  _writeHead(label) {
    this._armPending = null; this._triggerPending = null;   // F209: a head is fn 28 throughout (and holds the trigger); only a spawn/revive starts a new arm
    this._prevAmmo = {}; this._prevReserve = {}; this._shotAcct = {}; this.activeSlot = 0;
    this._recoil = null;   // S42: a fresh head is a fresh weapon table -- `_spawn`/`_revive` re-arm it for the life that actually follows
    // B1 guard: the gun's COMBAT team is whatever `$TID` this head carries, and only a config re-push
    // can change it. Remember it so `_assign` can catch a roster re-team that the head never followed.
    const tidFrame = (this.frames.head || []).find(f => typeof f === 'string' && f.startsWith('$TID,'));
    this._headTid = tidFrame ? Number(tidFrame.split(',')[1]) : this._headTid;
    return this._write(this.frames.head, label);
  }

  /** B1 belt-and-braces (2026-09-12): the gun resolves combat on the `$TID` in its written head; the
   *  roster team rides in `assign`. MC now refuses a team change once armed/live and re-pushes a fresh
   *  head in the lobby, so these never disagree — but if one ever does (an older/buggy MC, a lost
   *  config), the node must SAY SO rather than play a match where the beacon shows one team and the gun
   *  shoots for another. Detection only: the node cannot rewrite a locked head itself. */
  _checkTeamVsHead() {
    if (this.phase !== 'armed' && this.phase !== 'live') return;   // a lobby re-team arrives WITH its config
    if (this._headTid == null || !this.team || this.team.tid == null) return;
    if (Number(this.team.tid) === this._headTid) return;
    this.log(`WARNING: roster team tid ${this.team.tid} but the gun head holds $TID ${this._headTid} — combat resolves on the gun's team until a config re-push (RECALL to fix)`, 'le');
    this.moment = { kind: 'team_tid_mismatch', at: this.now(), teamTid: Number(this.team.tid), headTid: this._headTid };
  }
  _resyncDone(why) { this.log(`resync: ${why}`, 'lk'); this.resync = null; this._changed(); }

  // ---------- app lifecycle (§3.11) ----------
  resume() {
    this.log('app resumed', 'li');
    if (this.phase === 'live') {
      if (this.endT && this.now() >= this.endT) { this._endLocal('expired-while-suspended'); return; }
      // node.md §3.10: a LIVE resume RECONCILES (disarm, keep the restored pools, re-arm if alive) — the same
      // path the BLE relink takes. It must NOT be `_beginResync`: that is the retired trigger-first evidence
      // protocol, which mis-concluded "dead" and let auto-respawn heal the player on restart (bench 2026-09-04).
      // The evidence protocol survives ONLY for lobby/armed, where there is no live state to get wrong.
      //
      // ...but ONLY on evidence the webview was actually frozen. `resume()` is wired to `visibilitychange`
      // and `pageshow` (app.js), so it also fires on a notification shade, a lock-screen glance and an app
      // switch of half a second. Reconciling on those wrote `$AMMO,0,0,0,1` mid-fight — disarming the player
      // for RECONCILE_MS — and then re-armed from `frames.spawn`, which is a FULL MAGAZINE: pull the shade
      // down, get your ammo back (review 2026-09-12). No gap, no write at all. A link that went down while
      // we were away needs nothing here either: `onBleConnected` runs this same reconcile on the relink.
      const gap = this._awakeAt ? this.now() - this._awakeAt : Infinity;
      if (!this.bleUp) this.log('resume: gun link down — the relink will reconcile', 'li');
      else if (gap < RESUME_GAP_MS) this.log(`resume: ${gap} ms since the last tick — the app never stopped, nothing to reconcile`, 'li');
      else this._beginReconcile();
    }
    if (this.start) this.resumeSchedule();
    this._awake();   // both `visibilitychange` and `pageshow` can fire for one foreground: the second must not read the first's gap and reconcile again
    this._changed();
  }

  // ---------- status body (contracts §4) ----------
  statusBody(preflight = {}) {
    const now = this.now();
    const stale = this.poolStale(now);
    return {
      hp: this.hp, armor: this.armor, shield: this.shield, ammo: this.ammo, alive: this.alive, shots: this.shots,
      // A37/R2-3: which of the two the hp/armor above are. MC's pool proof judges `"gun"` ONLY.
      pool_src: this.poolSrc,
      // F208: present only while the pool is stale ('silent' | 'no_fire'), with the ms since the gun last reported it.
      ...(stale ? { pool_stale: stale.why, ...(stale.ms != null ? { pool_stale_ms: stale.ms } : {}) } : {}),
      // F264: what the NODE ITSELF then did about it, so the operator's board reads more than "stale". A phone log
      // is not loud: the node logged `no_fire` twice on 2026-09-18 and the player still stood there 94 s. `asking`
      // = a probe is out; `dead` = the gun answered health 0 and the death is booked; `alive` = the gun answered
      // above 0 and the arming was re-asserted, no revive; `no_answer` = nothing came back and the node has
      // deliberately done NOTHING. `no_answer` is the one that needs a human: FORCE RESPAWN.
      ...(this.cure ? { cure: this.cure.verdict } : {}),
      ...(this.phase === 'live' && !this.alive && this.deadAt ? { deadline_s: Math.max(0, Math.ceil((this.respawnDelayMs - (now - this.deadAt)) / 1000)) } : {}),
      ...(this.battery != null ? { battery: this.battery } : {}), ...(this.fw ? { fw: this.fw } : {}),
      arm_state: this.phase, ...(this.phase === 'armed' && this.goLiveT ? { t_minus_ms: Math.max(0, this.goLiveT - now) } : {}),
      synced: this.isSynced(), wsReason: this.wsReason || null, ...(this.matchId ? { match_id: this.matchId } : {}),
      // A36: WHICH HEAD THIS PHONE IS HOLDING, on every heartbeat. `ack_config` says which config a
      // gun took at the moment it took it; this says which one it is still on for the rest of the
      // game, which is the difference that made a whole field night of stale pushes invisible.
      ...(this.config && this.config.config_id ? { config_id: this.config.config_id } : {}),
      // Bench 2026-09-17: the gun keeps dropping the link, so MC can show one steady HEADSET OFF line
      // instead of GUN LINK LOST and HEADSET CONFIRMING in turn. Always sent, so false clears it.
      preflight: { gun_linked: this.bleUp, headset_ok: !!this.headEcho, gun_flapping: !!this.gunFlapping, ...preflight },
    };
  }

  // ---------- render snapshot ----------
  state() {
    const now = this.now();
    const r = this.respawnDelayMs;
    return {
      phase: this.phase, bleUp: this.bleUp, gunFlapping: this.gunFlapping, wsState: this.wsState, gun: this.gun, night: this.night,
      nightOps: !!(this.config && this.config.night),
      player: this.player, team: this.team, teamKey: this.teamKey, teamName: this.team ? (this.team.name || TEAM_NAME[this.team.tid] || '').toUpperCase() : '',
      callsign: this.player ? this.player.display : '', playerNum: this.player ? this.player.player_num : null,
      mode: this.config ? String(this.config.mode || '').toUpperCase() : '', weapon: this.weaponName,
      hp: this.hp, armor: this.armor, shield: this.shield, maxHp: this.maxHp, maxArmor: this.maxArmor, ammo: this.ammo, reserve: this.reserve, mag: (this._ammoBySlot()[this.activeSlot] ?? this.mag),
      // Bench 2026-09-17: `heat` is the active slot's last $ALCD heat token, null until one has been seen
      // this life (a non-heat weapon never sends a non-zero one).
      heat: this.heatBySlot[this.activeSlot] != null ? this.heatBySlot[this.activeSlot] : null,
      // THE MECHANIC (`_heatBlocksFire`): can this gun shoot right now? Trusted for HEAT_STALE_MS. Nothing on
      // the HUD reads it -- it is published for the bench (MC only ever sees `statusBody`), and pinned by engine.test.mjs.
      overheating: this._heatBlocksFire(),
      // THE DISPLAY (`_overheatOnHud`): the OVERHEAT word, the overlay AND the hot heat bar, all from this one
      // field, for OVERHEAT_SHOWN_MS after the last evidence of the lockout.
      overheatShown: this._overheatOnHud(now),
      heatEverSeen: !!this._everHeated[this.activeSlot],
      // S42 × A44/A47/F15 (maint review 2026-09-17): the accuracy writer's own stand-down, made visible.
      // `{until, why}` while a spawn, revive, operator resync or stun write owns `$AMMO`; null once it lifts.
      // Nothing acts on it -- it exists so a bench or a log reader can see the writer standing down AND the cause.
      accHold: now < this._accHoldUntil ? { until: this._accHoldUntil, why: this._accHoldWhy } : null,
      shotCooldown: this.shotCooldown(now),   // bench 2026-09-17: the ammo gauge's dim + ready shine
      scoreRows: this.score && Array.isArray(this.score.rows) ? this.score.rows : null,   // MC's mid-match leaderboard, for the HUD's results overlay
      loadMag: this._loadAmmo()[0], loadReserve: this._loadAmmo()[1],
      alive: this.alive, deaths: this.deaths, shots: this.shots, battery: this.battery,
      kills: this.score ? this.score.kills : null, assists: this.score ? this.score.assists : null, accuracy: this.score ? this.score.accuracy : null, scoreAt: this.scoreAt,
      lastMcMsgAt: this.lastMcMsgAt,   // F265: `hud.js _boardStale` freshness signal — see the field's own comment above
      // F208/F264: null, or {why: 'silent'|'no_fire', ms} / {verdict: 'asking'|'dead'|'alive'|'no_answer', at}.
      // Published for MC and the bench (`statusBody` carries `pool_stale`/`cure` too); `hud.js` does not read
      // either field today, so a `no_answer` verdict -- the one case that needs a human, FORCE RESPAWN -- is
      // invisible on the phone (polish review, added after the merge; F288).
      poolStale: this.poolStale(now), cure: this.cure,
      respawnType: this.respawnType, killedBy: this.killedBy, underFire: this.alive && this.lastHitAt > 0 && (now - this.lastHitAt) < 2000, respawnIn: (!this.alive && this.deadAt && this.respawnType === 'auto') ? Math.max(0, Math.ceil((r - (now - this.deadAt)) / 1000)) : 0,   // scanner/none modes have no countdown
      // utility.md: the respawn station this player would use, how close it reads, and what the DOWN screen should say
      station: stationView(this._respawnStation()), respawnGate: this.respawnGate, respawnHint: this.respawnHint(now),
      // 2026-09-19 respawn profiles: `weaponArming` = ms until a timed life's trigger goes live (null once it has);
      // `shielded` = a station life's protection is showing; `downWarn` = the down-screen warning level 1..3.
      weaponArming: this._triggerPending && this.alive ? Math.max(0, this._triggerPending.due - now) : null,
      shielded: !!(this._armPending && this._armPending.shield && this.alive), downWarn: this._downWarn,
      // F72: the most recent grenade/station beacon (proto-15 $HIR) — owner team + magnitude (8 hill, 6 respawn),
      // null once nobody has reported one this life. Not `station` above: that is BLE advert presence, this is IR.
      beacon: this.beacon || null,
      // The control point as the hill logic reads it: {owner (2 = neutral), at, from_neutral}, null once
      // presence has expired (>= 2 missed beacons). Two sources write it, never both in one game: a
      // grenade's IR beacon (derived from `beacon` above), or a phone CONTROL POINT's BLE advert, which adds
      // `source: 'station'`, `site`, `progress` 0-100, `holding`, `contested`, `rising`/`falling` and
      // `onPoint` (K1, utility.md §5). A reader that only knows `owner` behaves identically on both.
      hill: this.hill || null,
      // The possession CLOCK (`mc/API.md`'s `possession` fact): per point, per team, cumulative ms owned as
      // THIS node observed it, plus how long it could hear the point at all. Worth having in `state()` even
      // before the wire carries it — a person can read the number off a phone at the end of a match.
      possession: { by_site: this.hold, observed_ms: this.observed, source: this._holdSource || null },
      tMinusMs: this.phase === 'armed' && this.goLiveT ? Math.max(0, this.goLiveT - now) : null,
      clockMs: this.endT ? Math.max(0, this.endT - now) : (this.timeLimitMs || 0),
      ready: !!this.ready, tutorial: this.tutorial, tutorialWeapon: this.tutorialWeapon,
      tryoutArming: !!this.tryoutArming,   // F147: true between a try-out weapon write and the gun's own confirming ammo report
      tryoutUnconfirmed: this.tryoutUnconfirmed,   // polish-loop pass 3: {tab, kind} | null — the last arm settled with no confirming report — honest, not a real ✓, and identified so it never bleeds onto an unrelated row

      // follows the LIVE slot, not always the primary (field 2026-08-30)
      weaponId: (() => { const ws = this.player && this.player.loadout && this.player.loadout.weapons; const w = ws && (ws[this.activeSlot] || ws[0]); return w ? w.weapon_id : null; })(),
      // A48 (merge 2026-09-17): the catalogue now names the weapon's class and, for a charge weapon, what one
      // full charge costs. Both go to the HUD so it stops guessing either from the weapon id. Null when the
      // bundle is pre-A48 or the id is not in the catalogue -- the HUD keeps a named fallback for that.
      // `caution` is NOT here: the loadout card (hud.js) and MC's Kit/Catalog already read it off the
      // catalogue row directly, so a copy on the live state would be a second source of the same string.
      ...(row => ({
        weaponClass: row && row.weapon_class ? String(row.weapon_class) : null,   // `weapon_class` is the WIRE name (contracts §3 Weapon / WeaponView); weapons.json's own key is `class`
        roundsPerCharge: row && row.rounds_per_charge != null ? +row.rounds_per_charge : null,
      }))(this.weaponRow(this._activeWeaponId())),
      resync: this.resync ? { step: this.resync.step, prompt: this.resync.prompt } : null,
      reconciling: !!this.reconciling,
      stunned: this.stunned ? { until: this.stunned.until, leftMs: Math.max(0, this.stunned.until - now) } : null,   // F15: the HUD's STUNNED takeover reads this
      // read ONCE: two calls could straddle the expiry and disagree (switching:true, switchingMs:null)
      ...(ms => ({ switching: ms != null, switchingMs: ms }))(this.switchingMs()),
      switchWindowMs: this.switchWindowMs(), lastSwitchMs: this.lastSwitchMs, activeSlot: this.activeSlot,
      switchFrom: this.switching ? this.switching.from : null, switchTo: this.switching ? (this.switching.from === 0 ? 1 : 0) : null,
      // F123: `reloading` is no longer a timer's opinion — it runs until the GUN's ammo says the reload is
      // done (or stopped). `reloadOverrun` is true once the nominal time has passed and the magazine still
      // has not come back (normal on hardware: F27 measures handle-to-refill at ~1.25x the catalog figure).
      // `reloadOutcome` is the last takeover's verdict, and `ok:false` is the F123 symptom made visible.
      // The four move together: between the deadline and the tick that books the timeout `this.reloading` is
      // still set while `reloadingMs()` is already null, and a reader saw `reloading:false` beside a live
      // total and gain. `ms == null` is the single gate for all of them.
      ...(ms => ({ reloading: ms != null, reloadMs: ms, reloadTotalMs: ms != null ? this.reloading.ms : null,
                   // WHICH takeover this is. The HUD latches `reloadOverrun` for the life of one reload, and
                   // without an identity it could not tell a second reload from the first: a $ALCD (fired) and
                   // a $BUT,2,1 in ONE BLE batch end and re-open the takeover between two renders, and the new
                   // one opened already pulsing on the old one's latch (review 2026-09-12).
                   reloadAt: ms != null ? this.reloading.at : null,
                   reloadOverrun: !!(ms != null && ms > this.reloading.ms),
                   reloadGained: ms != null ? Math.max(0, this.reloading.mag - this.reloading.from) : null }))(this.reloadingMs()),
      reloadOutcome: this._reloadOutcome,
      held: this.heldMs(), lastButton: this.lastButton,
      hits: this.score ? this.score.hits : null, board: this.score ? this.score.board : null,
      fragLimit: this.config && this.config.scoring ? this.config.scoring.frag_limit : null,
      lives: (this.config && this.config.respawn && this.config.respawn.lives != null) ? Math.max(0, this.config.respawn.lives - this.deaths) : null,
      // A24: the pushed result and WHERE WE ARE IN WAITING FOR IT. `resultWait` is 'in' | 'pending' | 'unreached';
      // none of the three is an outcome, and there is deliberately no fourth value the HUD could read as "lost".
      result: this.result, resultAt: this.resultAt, resultWait: this.resultWait(now), endedAt: this.endedAt,
      moment: this.moment, ended: this.ended, endAck: this.endAck, matchId: this.matchId, synced: this.isSynced(), headEcho: this.headEcho,
      rejoin: !!(this.start && !this.bleUp && this.phase === 'idle'), pendingTeardown: this.pendingTeardown,
      // A10 self-serve kitting
      catalog: this.catalog, policy: this.policy, loadout: this.loadoutView(), browsing: this.browsing, loadoutAck: this.loadoutAck, pendingPick: this.pendingPick,
      canPickPrimary: this.canPick('primary'), canPickSecondary: this.canPick('secondary'), canPickPerk: this.canPick('perk'), tryoutSeen: this.tryoutSeen,
      game: this.game, kitOpen: this.kitOpen(), briefSeen: this.briefSeen, kitLocked: this.kitLocked,
      standby: !!this.standby,   // T2-B item 2: benched — the HUD shows SITTING OUT instead of the kit/lobby screen
    };
  }
}
