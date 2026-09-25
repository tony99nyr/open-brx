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
import { SPAWN_KILL_WINDOW_MS, READOUT_LEAD_MS, READOUT_BLINK_GAP_MS, READOUT_STEP_MS, READOUT_BLINK_MS, READOUT_MIN_GAP_MS, READOUT_HOLD_S } from './transport/contract.gen.js';   // the spawn-kill window (2026-09-19) and the A16.3 readout timings (F52)
import { stationView, TEAM_ANY } from './beacon.js';   // utility-item presence (docs/spec/utility.md)
import { CONTROL_STATE, claimable } from './control.js';   // the phone control point's advert bits + who may own a point (utility.md §5 `control`, K1)
import { Announcer, GunAudio, clipMs, clipId, CLIP_MS, ANNOUNCE_GAP_MS } from './announcer.js';
import { LANE_HERO_MS } from './lanes.js';
import { MEDALS } from './transport/contract.gen.js';
const MEDAL_KIND = Object.fromEntries(MEDALS.map(m => [m.key, m.kind]));   // first | multi | streak (Tony's ladder)   // docs/announcer.md "The three lanes": when a spree's HERO ends   // the ONE announcer queue: every voice line and banner (docs/announcer.md)
export const C = {
  STATUS_HEARTBEAT_MS: W.STATUS_HEARTBEAT_MS, SYNC_FRESH_MS: W.SYNC_FRESH_MS, FEEDBACK_MAX_AGE_MS: W.FEEDBACK_MAX_AGE_MS,
  LATE_ARM_GRACE_MS: W.LATE_ARM_GRACE_MS, DEATH_LATCH_MS: W.DEATH_LATCH_MS, RESYNC_PROBE_S: W.RESYNC_PROBE_S,
  CONFIG_TTL_MS: W.CONFIG_TTL_MS,
};
export const SFLASH = '$SFLASH,*';
export const PLAYX = '$PLAYX,0,*';
/** The command word of a `$…` frame, or '' -- `$DPLAY,A10,4,*` -> 'DPLAY'. A gun<->radio control frame
 *  (`$!…`, `$^…`, `$&…`) keeps its prefix so it never matches a real command by accident. Whitespace and a
 *  `*` that ends the word are stripped, so `$DPLAY*` or `$ DPLAY,*` cannot slip past the deny list. */
export function frameCommand(f) { return typeof f === 'string' && f[0] === '$' ? f.slice(1).split(',')[0].trim().replace(/\*+$/, '').trim().toUpperCase() : ''; }
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
const PAIN_STALE_MS = 500;          // docs/announcer.md: a grunt that would start later than this after its hit is dropped
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
// F349 (Tony, live match 2026-09-24: "the hud animation is kinda chunky" and SHIELDS ONLINE 3-4 s late): 10 every
// 300 ms was 11 writes for a 105 pool, each with a readout step or blink behind it, and in the field the BLE queue
// stretched the planned 3.3 s to 5.1 s. Now a full pool is SHIELD_REGEN_GRANTS writes, one a second (about the same
// 3 s), and the readout is not animated while a recharge runs. The phone draws the fill smoothly from `shieldRegen`.
const SHIELD_REGEN_GRANTS = 4;        // a full pool in this many `$LIFE,0,0,<step>,*` grants (step = ceil(max / this): 27 for 105; 10-30 are bench-proven)
const SHIELD_REGEN_STEP_MS = 1000;    // one grant per this: 0 -> full in about 3 s
export const SHIELD_REGEN_WRITE_BUDGET = SHIELD_REGEN_GRANTS + 2;   // one recharge, `shield_charging` to `shield_online` inclusive
// F348 (Tony, live match 2026-09-24: "you can die from a couple hits right after spawn"): a Shields life starts at
// FULL shield, Halo's rule. `$SPAWN` leaves the shield POOL at 0 on hardware ($PSET t5 is a ceiling), so every
// spawn and revive burst ends with one additive `$LIFE,0,0,<max>,*` that the gun clamps at t5. The gun answers it
// with `$HP`; that rise is the spawn fill, not a recharge, so it says nothing (SHIELD_FILL_ECHO_MS).
export const SPAWN_SHIELD_FULL = true;
const SHIELD_FILL_ECHO_MS = 5000;     // a shield rise this soon after a spawn fill is the fill's own echo (under SHIELD_REGEN_DELAY_MS, so a recharge never reads as one)
const SHIELD_CHARGING_MIN_MS = 1000;  // C4: a refill shorter than this is not announced ("Shields charging" would outlast it)
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
export const OPERATOR_PROBE_WRITE_MS = 5000; // bounded wait for the serialized BLE queue before F287's answer clock starts
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
/** F272: a LIVE, alive gun that has said nothing for this long gets an all-zero `$LIFE` proof-of-life read.
 *  The first read is repeated after `GUN_PROBE_GAP_MS`; after the second write has had
 *  `GUN_PROBE_REPLY_MS` to answer, continued silence is the affirmative lock-up verdict. */
export const GUN_SILENT_MS = 8000;
export const GUN_PROBE_GAP_MS = 3000;
export const GUN_PROBE_REPLY_MS = 1000;
export const GUN_RECOVERY_RETRY_MS = 1000;
export const GUN_RECOVERY_MAX_WRITES = 3;
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
/** F341 (field 2026-09-24): the spawn read-back only asked whether an answer came. The gun answered `$HP,4545,7070,0`
 *  (a `$PSET` whose re-send was appended to a partial copy, brxlink `PARSER_RESET`), the read-back was satisfied, and
 *  the player was unkillable for the match. Now every pool the gun reports is CHECKED against the ceilings the compiled
 *  `$PSET` arms (`maxHp`/`maxArmor`/`maxShield`, the one reading of that frame). A pool above its ceiling is repaired
 *  with `$*`, the life's own `$PSET` and a clamped `$LIFE` set, then read back; POOL_REPAIR_TRIES repairs that do not
 *  hold, or a read-back that goes unanswered, become `pool_stale: 'pool_wrong'` on the operator's board. */
export const POOL_REPAIR_TRIES = 2;
/** How long after a repair write the node asks the gun again: the write is 3-4 frames, well inside this. */
export const POOL_REPAIR_READ_MS = 1500;
/** The gun's parser reset (brxlink `PARSER_RESET`: v4.32 code read, screamers A4 is its pending bench proof), sent in front of a repair. */
const PARSER_RESET = '$*';
/** S16 (spec/node.md §3.17): the poison tick clock the node runs. A tick is one `$LIFE` write the node makes itself, and
 *  the gun answers a non-lethal one with `$HP` (bench 2026-09-09). That `$HP` is the TICK, not a hit: it must never
 *  become a `hit_taken` fact (MC would count a hit nobody fired) or a hit flash. This is how long after a tick write
 *  an `$HP` that moves the tick's pool by exactly the tick (`dotEchoMatches`) is read as the tick's own echo. */
export const DOT_ECHO_MS = 1000;
/** S16: a death this soon after our own tick write, with no newer `$HIR` latched, is the tick's kill, and the kill
 *  goes to the player who last applied the poison (Tony, 2026-09-18). A lethal negative answers `$LCD` at once. */
export const DOT_KILL_MS = 1500;
/** S56 "what hit me": how long after a death the last life's `dealt` ledger stays PARTIAL. A victim's MC
 *  `feedback{kind:'hit'}` relay is best-effort and can still be in flight when this phone's own `death` fact
 *  lands, so the total is not yet final; past this window it is read as complete (unless the MC link was ever
 *  unbound during that life, which keeps it partial regardless). HUD information only, never a game rule. */
const DEALT_GRACE_MS = 2000;
const DUAL_RELAY_MS = 150;   // S56: two relays of one two-word shot (the victim pairs its words inside the same window)
/** S16: is this pool change exactly the echo of the tick `echo` ({pool, n})? The tick's pool moved by
 *  `min(n, before)` (a negative floors at 0) and the other two pools did not move. PURE. */
export function dotEchoMatches(echo, before, after) {
  for (const k of ['health', 'armor', 'shield']) {
    const moved = before[k] - after[k];
    if (k === echo.pool ? moved !== Math.min(echo.n, before[k]) || moved <= 0 : moved !== 0) return false;
  }
  return true;
}
/** S53 (bench 2026-09-18, the controlled redo): a fn-23 smoke holds the victim's live accuracy at 0 for about 6 s,
 *  then the gun restores it in one step (the V4_31 6000 ms timer). */
export const SMOKE_MS = 6000;
/** S53: the victim's `$ALCD` accuracy drops to 0 "in the same millisecond" as the smoke's `$HIR` (bench 2026-09-18).
 *  A drop to 0 and a `$HIR` this close together, in either order, is a smoke landing. */
export const SMOKE_PAIR_MS = 400;
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
const MUST_HEAR_MAX_STOPS = 4;  // round 3 H1: at most this many `$PLAYX,0` before a must-hear line (the shield loop + 3 clips)
const KILL_CARD_MS = 1800;      // hud.js `_kill`'s card hold: MC's kill card owns the announcer slot at least this long
const LANE_FEED_MAX = 6;           // docs/announcer.md "The three lanes": the FEED rows kept (the HUD draws the newest three)
const ECHO_WINDOW_MS = 1500;     // how long after the last head frame is written the node waits for the gun's echo
const HEAD_WRITE_CAP_MS = 20000; // a head write that has not settled by now acks `no_echo` anyway
const CONFIG_QUERY_MS = 2600;    // v4.32 can trail the `$QUERY` status body by about 2 s
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
// verify grace would let the writer judge (and retry) t4 while another gun write is still in flight.
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
// S42 × A44/A47/F15: spawn, revive, operator RESYNC GUN and stun all own multi-frame gun transitions.
// Keep the short t4 writer out of those windows so its confirmation cannot be mistaken for their `$ALCD`
// traffic. This is comfortably above ACC_VERIFY_GRACE_MS and the slowest measured post-spawn `$BMAP`.
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
// step cost no weapon its identity at the time -- the assault rifle bottomed out at 70 exactly as it
// always did, it just arrived there in two visible stages instead of twenty invisible ones. S54
// (2026-09-23) later moved the Assault Rifle's own floor to 60 (see below): a DEPTH change, not a return
// of the coupling this paragraph is describing.
//
// S54/F268/F280 (Tony, 2026-09-23): the ladder's DEPTH used to decide how many rounds a burst takes to
// degrade (`ceil((crisp - heavy) / per_shot)`), which has no relationship to how long a player has held
// the trigger down -- the bench measurement that forced this rewrite found `after_heavy` landing 6 rounds
// into EVERY degrading weapon regardless of its floor, so `heavy` owned 84-98% of a magazine instead of
// being the second of two stages. The rungs now key off ROUNDS PER TRIGGER PULL instead, scaled by
// calibre: a reference weapon doing `RECOIL_REF_DMG` a hit fires `RECOIL_CLEAN_ROUNDS` clean rounds
// before the next one degrades it, and `RECOIL_HEAVY_EXTRA_ROUNDS` more before heavy. A weapon with a
// different `dmg` scales both counts by `RECOIL_REF_DMG / dmg`, so a bigger round kicks in sooner --
// the calibre pays for its own damage, not the ladder's shape. This mirrors held-fire TIME without
// depending on a weapon's fire interval, which several catalogue rows do not publish cleanly.
export const RECOIL_CLEAN_ROUNDS = 5;
export const RECOIL_HEAVY_EXTRA_ROUNDS = 3;
// The reference weapon the two counts above are tuned against (the Assault Rifle/SMG/Energy Rifle's 8).
// A weapon with double the damage kicks in after half the rounds; half the damage, twice as many.
export const RECOIL_REF_DMG = 8;
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
const BTN_TRIGGER = 0, BTN_ALT = 1, BTN_RELOAD = 2, BTN_SELECT = 3;
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

// ---------- S57 IR callout bus (docs/ir-callouts.md) ----------
// Presentation only (never scores, never books a death/kill, never touched by `mcp/brx_mcp/stage/stage.py`):
// a dying gun tells every gun in range, once, over a bench-silent protocol-15 `$IRTX`/`$HIR` magnitude nobody
// else uses (1-39, clear of 2/6/8/10 — the doc's "bench facts"). One word carries one player id, so it names
// the KILLER for `DOWN_BY` and the VICTIM for a bare `DOWN` (killer unknown, or the victim's own doing); the
// magnitude is always `base + the VICTIM's team id (0-3)`, so a receiver decodes the team by arithmetic, never
// a lookup. A hill needs no code here: the grenade (and a Stick hill) send the native capture word, magnitude 50.
// `FLAG_TAKEN`/`FLAG_CAPTURED` are reserved for CTF, which no station or phone produces yet (docs/ir-callouts.md,
// Tony 2026-09-23): their player would be the carrier, but nothing sends or handles them yet. A receiver must still recognise their
// magnitudes (29-36) and ignore them outright, never mistaking them for a hill beacon (`_onHillBeacon` only
// ever sees magnitude 6/8/50/53, well clear of this range).
export const IR_CALLOUT = {
  PROTO: 15, SUBTYPE: 0, DIRECTION: 100,
  DOWN_BY: 21,        // 21-24: the named player KILLED a member of the magnitude's team
  DOWN: 25,           // 25-28: the named player IS the victim; the killer is unknown (or was the victim)
  FLAG_TAKEN: 29,     // 29-32: RESERVED (CTF, not built): player = the carrier, + the flag's team
  FLAG_CAPTURED: 33,  // 33-36: RESERVED (CTF, not built): player = the carrier, + the captured flag's team
  LAST: 39,           // 37-39: unassigned, still the bus (bench-silent range): ignored, never read as a beacon
  ENEMY_DOWN_CUE: 'VB8',   // "Target down." (sound_catalog.json: 1.014 s)
};
const CALLOUT_DEDUPE_MS = 600;   // one physical word lands on several sensors ~14 ms apart (F85); short enough that a real double kill still counts twice a second or so later
const CALLOUT_PAIR_MIN_MS = 250; // S57 names (Tony 2026-09-24): a DOWN pairs with a DOWN_BY for the same victim team only this long (round 2: 250, the sender spaces them >= 300 ms)
const CALLOUT_PAIR_MS = 800;     // ...to this long after it: the sender spaces them >= 300 ms after the first word is WRITTEN (plus BLE queueing), so 800 ms leaves margin (was 600 at a 250 ms gap)
const CALLOUT_NAME_GAP_MS = 300; // the victim's DOWN word goes out this long after its DOWN_BY was WRITTEN: clear of the headset's 199 ms single-shot guard with margin (bench 2026-09-24: 250 ms from the queue call left 186 ms on the wire, and the name word was lost)
const CALLOUT_WINDOW_MS = 3000;  // kill-confirm first-to-arrive (Tony), and how long `state().callout` stays lit

// ---------- A56 (S58): powerups (docs/spec/powerups.md) ----------
// Everything below is INERT unless the pushed config carries a powerup station with an `item` (MC sends one only with
// its `--powerups` flag on). Tony's defaults (2026-09-24), each a named constant so a change is one line:
export const PU_RESERVE = 0;                // a weapon item grants its charges as the MAGAZINE and no reserve
export const PU_LOST_AT_DEATH = true;       // a weapon item's unused charges do not carry into the next life
export const PU_WEAPON_SWAPS = true;        // lead 2026-09-24: a second WEAPON pickup replaces the first (never refused)
export const OVERSHIELD_AMOUNT = 75;        // the fallback when an item carries no `amount` (MC normally expands it)
export const OVERSHIELD_DECAY_PER_S = 0;    // Tony: no decay. Not read yet: a non-zero value needs a decay writer first
// `charges` falls back to the weapon's own catalogue magazine (`clip`) when the item carries none: the fifth default.
// Tony 2026-09-24: "straight to trigger. id prefer trigger fires it", then "select should equip it if possible". A mid-life
// `$WEAP,<slot>,…` equips that slot on the trigger at once (bench 2026-09-24, powerups.md "Sitting A 3.3"), so the phone
// equips the heavy itself and no `$BMAP` is ever written: ALT keeps its job, SELECT stays at the head's `$BMAP,3,98`.
export const PU_SELECT_DEBOUNCE_MS = 400;   // a second SELECT press inside this is the same press (a double press toggles once)
export const PU_ANNOUNCE_MS = 2400;         // the spawn card's hold, and the gap between two announcements that land together
export const PU_ANNOUNCE_LATE_MS = 5000;    // a spawn noticed later than this (a frozen webview) is not announced
export const PU_READY_MS = 2500;            // how long the station hint names the item after a grant
export const PU_NEAR_DB = 10;               // GET CLOSER shows only within this of the station's own threshold
// The claim (Tony 2026-09-24, via the brx5 lead): stand about a foot from the station for 1 s, no button. Range is the
// MEDIAN of the last three samples of the station's advert (beacon.js `median`), never the respawn path's EMA.
export const POWERUP_THRESHOLD_DEFAULT = -55;   // byte 14 = 0: a placeholder for ~1 ft until the bench calibrates it
export const POWERUP_EXIT_DB = 3;               // out of range = the median below the threshold minus this
export const POWERUP_DWELL_MS = 1000;           // continuously in range this long = `claim_ready`; leaving range resets it
export const POWERUP_NO_ANSWER_MS = 3000;       // ready this long and the station still says available: STATION NOT ANSWERING
export const POWERUP_READY_LATCH_MS = 10000;    // a `taker` advert still counts this long after the phone was last ready
export const PU_ADVERT_STALE_MS = 8000;     // an advert older than this says nothing about the item
// Tony 2026-09-24: "in halo if you get hit while you are getting overshield the damage is ignored". The grant is one burst
// (spawn protection on, a `$PSET` with the shield max raised, the absolute `$LIFE`), and protection ends this long after it.
export const OVERSHIELD_GRANT_MS = 1000;
export const OVERSHIELD_HIR_WAIT_MS = 1000;  // polish M1: a `$HIR` with no `$HP` after it holds the grant this long at most (a lethal hit in flight)
export const PU_BACK_RETRY_MS = 1500;       // polish M3: a switch-back the gun has not answered with an `$ALCD` for that slot is re-sent after this
export const OVERSHIELD_OFF_RETRIES = 3;   // r2: a protection-off that keeps failing is retried this often, then left to RESYNC GUN
export const PU_BACK_TRIES = 3;             // ...at most this many times
export const OVERSHIELD_ECHO_MS = 1500;     // a pre-grant `$HP` still in flight must not read as the overshield breaking
/** The spawn index at `elapsedMs` on the match clock (0 = the first spawn at `first_at_s`), or -1 before the first. PURE. */
export function puSpawnIndex(item, elapsedMs) {
  const every = Number(item && item.spawn_every_s) * 1000, first = Number(item && item.first_at_s) * 1000;
  if (!(every > 0) || !Number.isFinite(first) || !(elapsedMs >= first)) return -1;
  return Math.floor((elapsedMs - first) / every);
}
/** The match-clock time (ms after go-live) of spawn `k`. PURE. */
export function puSpawnAt(item, k) { return (Number(item.first_at_s) + k * Number(item.spawn_every_s)) * 1000; }

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
    this._ann = new Announcer(() => this.now(), m => this.log(m, 'li'));   // docs/announcer.md: one line or banner at a time, on this clock
    this._gun = new GunAudio(m => this.log(m, 'li'));   // docs/announcer.md: the ONE model of the gun's audio FIFO
    this._ann.gun = this._gun; this._ann.sync = now => this._audioSync(now);
    this._sirSound = {};   // `${proto}:${subtype}` -> the sound id on the `$SIR` row the gun holds (from what we wrote)
    this._psetSounds = null;   // the last `$PSET` written, split: t10 = deathScream, t23 = energyShieldLoop
    this.reset();
    this._load();
    this._loadNight();
  }

  reset() {
    if (this._ann) this._ann.clear();
    if (this._gun) this._gun.clear();   // the gun's audio model starts empty with the state it describes
    this.phase = 'idle';            // idle|connected|kitted|lobby|armed|live
    this.gun = null;                // {name, tail, fw?}
    this.bleUp = false; this.wsState = 'offline';
    this.gunFlapping = null;        // bench 2026-09-17: {count, next_retry_at} while the gun keeps dropping the link (BrxLink.flapping)
    this.headsetJoin = null;        // F293: {state: 'joining'|'not_joined'|'joined', since} from BrxLink's `$VERSION` probe (BrxLink.headsetJoin)
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
    this.latch = null;              // {shooter_num, shooter_team, at, ir_proto, ir_subtype, sensor}
    this._hitGroupSeq = 0;
    this._hitGroupEpoch = Math.random().toString(36).slice(2);
    this._dualEmitters = [];
    this._lastHitFact = null;
    this._life = this._freshLedger();   // S56 "what hit me": this life's damage taken/dealt ledger
    this._lastLife = null;              // ...and a snapshot of the one before it, kept until the next death
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
    this.callout = null;            // S57: {kind, name, team, at} — the latest IR callout (docs/ir-callouts.md), kept CALLOUT_WINDOW_MS then cleared in tick()
    this._calloutSeen = null;       // S57: Map `${magnitude}:${player}` -> this.now() of the last ACCEPTED word, CALLOUT_DEDUPE_MS dedupe (F85: one word, several sensors)
    // S57 kill confirm, first to arrive, once (Tony): each channel stamps ONLY its own timestamp and reads
    // ONLY the other's, so two of the SAME channel's kills close together (a real double kill) never
    // self-suppress -- only a genuinely DIFFERENT channel confirming the same kill does.
    this._downByOpen = [];           // S57 names: DOWN_BY words still waiting for their victim's DOWN, [{at, team}], oldest first
    this._irKillOpen = [];           // S57: IR kill confirms that played a cue and no MC feedback{kill} has matched yet, [{at, team}]
    this._mcKillOpen = [];           // S57: MC feedback{kill}s no IR confirm has matched yet, [{at, team}] (see `_takeKillMatch`)
    this.hill = null;               // {owner, at, from_neutral} — the control point's OWNER and when its last beacon landed. State from the wire; the cadence below is ours
    this.hillCallout = null;        // QA-05: {kind: 'hill_captured'|'hill_lost', at} — the last transition `_hillSay` announced, for the HUD card (read-only)
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
    this.deadAt = 0; this.killedBy = null; this.downReason = null; this.lastHitAt = 0;
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
    this.configQuery = null;
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
    this.kitLockedFor = null;       // F133: the config_id the lock was raised for; a push of another game retires it
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
    this._lanes = null;             // docs/announcer.md "The three lanes": {hero, obj, feed}, drawn as each event ARRIVES (presentation only)
    this.card = null;               // C2: the announcer's own card ({kind: 'kill'|'alert', at, data}); only `_card` writes it (docs/announcer.md)
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
    // F272: `_gunProbe` is deliberately ephemeral (a pending write is not evidence after a restart).
    // `gunLocked` is durable through the expected power-cycle drop and an app restart, because the next
    // LIVE relink must take the destructive recovery path rather than the ordinary keep-pools reconcile.
    this._gunProbe = null; this._gunProbeSeq = 0; this._gunProbeRetryAt = 0; this._gunLifeAt = 0;
    this._gunRecovery = null; this._gunRecoverySeq = 0; this.gunLocked = null;
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
    this._queryAt = 0; this._probeSeen = {}; this._probeSeq = 0;
    this._operatorResyncPending = null;   // F287: accepted RESYNC, waiting for its own `$LIFE` -> `$HP` proof
    this._cure = null; this._cureLife = null; this._cureAt = 0; this._pollAt = 0; this._probedLife = null;
    this.cure = null;               // the cure's own VERDICT, {verdict: 'asking'|'dead'|'alive'|'no_answer', at}. Rides `statusBody` so the operator's board can tell 'the node tried and got nothing' from a bare stale claim -- a phone log reached nobody on 2026-09-18
    // S29: the shield recharge. `_shieldQuietAt` is the clock the delay runs from (a spawn, or the last
    // damage); `_shieldRegen` is {startedAt, nextAt, grants} while the node is granting; `_shieldDown` says
    // the shield BROKE this life (a spawn starts at 0 without having broken, and must not heartbeat).
    this._shieldRegen = null; this._shieldQuietAt = 0; this._shieldLoopAt = 0; this._shieldDown = false; this._shieldGaveUp = false;
    this._actSeq = 0;               // pl4: shots and hits seen, so `_writeMust` can tell the life moved on
    this._writeLost = null;         // pl4: the `_lifeSeq` whose spawn/revive write resolved false (pool `write_lost`)
    this._poolCheck = null;         // F341: {life} while the spawn read-back's answer is owed a pool comparison
    this._poolRepair = null;        // F341: {life, attempts, dueAt, readAt, wrote} while the node repairs pools above their ceilings
    this.poolWrong = null;          // F341: {life, at, hp, armor, shield} once POOL_REPAIR_TRIES repairs did not hold (pool `pool_wrong`)
    this.hurtFired = false;         // low-health alert already sent this life
    this._pendingHurtWrite = false; // ...and whether that alert is still sitting in its debounce window
    this.poison = null;             // S16: {proto, per, tickMs, at, until, nextAt, by:{num,team}, ticks} while a poison stack ticks (spec/node.md §3.17)
    this._dotEcho = null;           // S16: {at, pool, n} of the last tick write, until its `$HP` echo is consumed (DOT_ECHO_MS)
    this._dotKill = null;           // S16: {at, num, team} of the last HEALTH tick write, read by `_death` (DOT_KILL_MS)
    this.smoke = null;              // S53: {at, until} while a fn-23 smoke holds the gun's accuracy at 0
    this.gunAcc = null;             // S53: the live accuracy the gun last reported on `$ALCD` token 2 (active slot), null until one this life
    this._accZeroAt = null; this._smokeHirAt = null;   // S53: the two halves of a smoke landing, paired in `_smokeCheck`
    this.stunned = null;            // F15: {at, until, ammo:{slot:[mag,reserve]}} while an EMP has the gun disarmed; the ammo is the LIVE count to restore
    this._recoil = null;            // S42: {weaponId, ceiling, floor, perShot, recoverMs, value, ...} for the ACTIVE weapon's live accuracy model, or null (no profile / recoil off)
    this._accuracyOffset = 0;        // S55: the t4 modifier this node last wrote; unlike recoil, t4 survives a $WEAP/swap
    this._nativeAccUntil = 0;        // S55: fn-23 owns t4 until this clock; the node must not cancel smoke/EMP
    this._nativeAccWhy = null;
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
    this._puReset();                // A56: no powerup state before a config carries items
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
        alive: this.alive, hp: this.hp, armor: this.armor, shield: this.shield, deadAt: this.deadAt, killedBy: this.killedBy, downReason: this.downReason,
        endedMatches: this.endedMatches.slice(-8), configPending: this.configPending, pendingTeardown: this.pendingTeardown,
        catalog: this.catalog, policy: this.policy, game: this.game, briefSeen: this.briefSeen,
        // B4/T2-B-1: without this, a restart mid-match forgets the probe ran and the relink's defensive
        // `$PHONE,*` resend (onBleConnected) never fires -- exactly the case it was added for.
        probeSent: this.probeSent,
        // F272: only the verdict persists, and only for this match. Pending probe timestamps never do.
        gunLocked: this.gunLocked,
        // T2-B item 2: a benched player who force-closes must come back SITTING OUT, not to a normal
        // kit screen that lets them browse/ready while MC still thinks they are parked.
        standby: this.standby,
        // A56: an app restart mid-match must still end a held item (the switch-back needs `held.back`, the saved weapon and its
        // counts, and `held.trig`, the slot on the trigger), re-equip slot 0 after a death with a heavy held, and keep the
        // overshield out of the S29 refill's way.
        pu: this._puHeld || this._overshield || this._puReequip || this._puBackPending ? { held: this._puHeld, overshield: this._overshield, seen: this._puSeen, reequip: !!this._puReequip, osProtectUntil: this._osProtectUntil || 0, psetNow: this._psetNow || null, backPending: this._puBackPending || null } : null,
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
        alive: !!s.alive, hp: s.hp || 0, armor: s.armor || 0, shield: s.shield || 0, deadAt: s.deadAt || 0, killedBy: s.killedBy || null, downReason: s.downReason || null,
        catalog: s.catalog || null, policy: s.policy || null, game: s.game || null, briefSeen: !!s.briefSeen,
        probeSent: !!s.probeSent, standby: !!s.standby,
        gunLocked: s.gunLocked && s.gunLocked.match_id === s.matchId && s.phase === 'live' ? s.gunLocked : null });
      if (s.pu && typeof s.pu === 'object') { this._puHeld = s.pu.held || null; this._overshield = s.pu.overshield || null; this._puSeen = s.pu.seen || {}; this._puReequip = !!s.pu.reequip; this._osProtectUntil = +s.pu.osProtectUntil || 0; this._psetNow = s.pu.psetNow || null; this._puBackPending = s.pu.backPending || null; }   // A56
      // Phase is re-derived when the gun reconnects (resumeSchedule); until then we are idle.
      this._pendingPhase = s.phase;
    } catch (_) { /* ignore */ }
  }
  clearPersisted() { try { this.storage && this.storage.removeItem(KEY); } catch (_) { /* ignore */ } }

  /** F202: forget only the locally owned tagger so the picker can bind another one.
   *  The MC player/roster context stays intact and will be re-bound when the next gun connects. */
  forgetGun() {
    this.gun = null;
    this.bleUp = false;
    this.probeSent = false;
    this.fw = null;
    this.battery = null;
    this.lastVoltsAt = 0;
    this.headEcho = null;
    this._pendingPhase = null;
    this._set('idle');
    this._save();
    this._changed();
  }

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
  _write(frames, why, options = undefined) {
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
    frames = this._audioWrite(frames, why);   // docs/announcer.md: the gun's audio FIFO sees every sound-bearing frame
    if (!frames.length) return;
    this.log(`write ${why}: ${frames.length} frame(s)`, 'li');
    try { return this.writer(frames, why, options); } catch (e) { this.log(`write ${why} failed: ${e && e.message || e}`, 'le'); return false; }
  }
  /** docs/announcer.md, the gun's audio FIFO. Records what a write puts on (or takes off) the gun's audio queue, keeps the
   *  `$SIR` sound map and the `$PSET` sound slots current, and, while the shield loop blocks the FIFO, drops every
   *  `$PLAY` that is not a must-hear line (`_sayMust` writes those itself): anything written then would play late,
   *  all at once, when the loop stops (bench 2026-09-24: a queued line waited 60+ s). */
  _audioWrite(frames, why) {
    const now = this.now(), g = this._gun;
    this._audioSync(now);   // the shield as it stands NOW (a hit that just broke it has unblocked the gun)
    let stops = 0, out = frames;
    for (const f of frames) {
      if (typeof f !== 'string') continue;
      if (f.startsWith('$CLEAR')) this._sirSound = {};
      else if (f.startsWith('$SIR,')) { const t = f.split(','); this._sirSound[`${t[1]}:${t[2]}`] = (t[3] || '').trim(); }
      else if (f.startsWith('$PSET,')) { this._psetSounds = f.split(','); this._audioSync(now); }
      else if (f === PLAYX && !this._mustWrite) stops++;
    }
    if (this._mustWrite) return frames;   // `_sayMust` keeps the model itself
    if (stops) {   // a stop takes the playing clip off (the loop, while it blocks: it resumes, so it frees nothing)
      g._prune(now);
      g.clips.splice(0, g.blocked ? stops - 1 : stops);
    }
    const plays = frames.filter(f => typeof f === 'string' && f.startsWith('$PLAY,'));
    if (plays.length && g.blocked) {
      out = frames.filter(f => !plays.includes(f));
      if (!this._blockedLogAt || now - this._blockedLogAt > 5000) { this._blockedLogAt = now; this.log(`audio: ${why}: not written, the shield loop blocks the gun's audio (docs/announcer.md)`, 'li'); }
      return out;
    }
    for (const f of plays) g.add(this._clipLen(f), why, now, clipId(f));
    return out;
  }
  /** A cue frame's real length: the bundle's `cue_ms` for the kind that ships this frame, else CLIP_MS. */
  _clipLen(frame) {
    const f = this.frames, cm = f && f.cue_ms;
    if (cm && f.cues) for (const k of Object.keys(cm)) if (f.cues[k] === frame) return cm[k];
    return clipMs(frame);
  }
  /** A must-hear line (my kill confirm, a lead change): one `$PLAYX,0,*` per clip the model says the gun still holds
   *  (the shield loop counts as one while it blocks, and resumes after, so every must-hear line gets its own), sent
   *  tightly in the same write, then the line. No stop when nothing is outstanding. */
  _sayMust(frame, why) {
    const now = this.now(); this._audioSync(now);
    const k = Math.min(this._gun.outstanding(now), MUST_HEAR_MAX_STOPS);   // the loop + 3: an over-count costs a fragment, 20 stops cost a stutter
    this._mustWrite = true;
    try { this._write([...Array(k).fill(PLAYX), frame], k ? `${why} (after ${k} × $PLAYX: the gun held ${k} clip${k > 1 ? 's' : ''}${this._gun.blocked ? ', the shield loop among them' : ''})` : why); }
    finally { this._mustWrite = false; }
    this._gun.flushed(now, { ms: this._clipLen(frame), why });
  }
  /** Is the `$PSET` t23 shield loop playing? It runs while a loop is armed and the shield is above 0. */
  _audioSync(now = this.now()) {
    const loop = this._psetSounds && (this._psetSounds[23] || '').replace('*', '').trim();
    this._gun.setBlocked(!!loop && this.shield > 0 && this.phase === 'live', now);
  }
  /** A hit the gun registered (`$HIR`): the gun plays the `$SIR` row's sound for it, into the same FIFO. */
  _audioHit(proto, subtype, now) {
    const id = this._sirSound[`${proto}:${subtype}`];
    const ms = id ? CLIP_MS[id] : undefined;
    if (!(ms > 0)) {
      const key = `${proto}:${subtype}:${id || ''}`;
      if (!(this._hitSoundWarned || (this._hitSoundWarned = new Set())).has(key)) { this._hitSoundWarned.add(key); this.log(`audio: a hit on $SIR ${proto},${subtype} has ${id ? `sound ${id}, of unknown length` : 'no row sound'}: counted as 0 ms`, 'li'); }
      return;
    }
    this._gun.add(ms, `hit sound ${id}`, now, id);   // under the shield loop, hits of one sound collapse to one clip
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
  get respawnAutoTeams() { return Array.isArray(this.config && this.config.respawn_auto_teams) ? this.config.respawn_auto_teams : []; }
  get timedRespawn() { return this.respawnType === 'auto' || (this.respawnType === 'scanner' && this.team && this.respawnAutoTeams.includes(this.team.tid)); }
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
    if (this._puOnHeavy()) return this._puHeld.name;   // A56: the heavy is on the trigger
    const ws = this.player && this.player.loadout && this.player.loadout.weapons;
    const w = ws && (ws[this.activeSlot] || ws[0]);
    if (!w) return 'PRIMARY';
    const row = this.weaponRow(w.weapon_id);
    return (row && row.name ? row.name : String(w.weapon_id).replace(/_/g, ' ')).toUpperCase();
  }
  weaponRow(id) { const c = this.catalog; return (c && c.weapons && c.weapons.find(w => w.weapon_id === id)) || null; }
  perkRow(id) { const c = this.catalog; return (c && c.perks && c.perks.find(w => w.perk_id === id)) || null; }
  /** S56 "what hit me": name the weapon behind a latched `$HIR`. NEVER guesses -- two candidates that the
   *  latch cannot tell apart come back `ambiguous`, with `weapon_id: null`, rather than a coin-flip pick that
   *  could name the wrong gun. Returns `null` (no claim at all, not even "unknown") when there is nothing to
   *  resolve against: no latch, or the shooter's roster entry predates `RosterEntry.weapons` (an older MC).
   *  Otherwise `{weapon_id, name, source: 'loadout'|'catalog'|null, ambiguous, candidates}`: the shooter's OWN
   *  loadout is tried first (one match -> 'loadout'); with none, the wider catalogue is tried as a pickup,
   *  excluding the loadout's own ids so a pickup can never be misread as a loadout weapon; nothing matched
   *  comes back `{weapon_id: null, ambiguous: false, candidates: []}` -- unknown, but still a claim.
   *  F315: each source is matched in three tiers, and the first tier that finds ANY match decides (one match
   *  names the weapon, two or more are ambiguous):
   *    1. cell + magnitude: a `cells` entry on the latch's (ir_proto, ir_subtype) AND its `mag`;
   *    2. cell alone: a `cells` entry on that (proto, subtype) -- names a crit, or an overkill-clamped
   *       killing blow, whose magnitude no table lists, when only one weapon fires that cell;
   *    3. magnitude alone, off `hir` (the S56 rule, and the only tier an older MC's roster supports).
   *  A latch with no proto or subtype (older data) skips tiers 1 and 2. HUD information only: MC's own
   *  scoring never reads this. */
  _resolveHitWeapon(latch) {
    if (!latch) return null;
    const shooter = this.roster.find(r => r.player_num === latch.shooter_num);
    if (!shooter || !Array.isArray(shooter.weapons)) return null;   // no claim: older MC, or the shooter is not on the roster
    const { mag, ir_proto: proto, ir_subtype: subtype } = latch;
    // The cell tiers need the shooter's own cells: an older MC's roster has none, and a catalogue cached from a newer
    // MC must not out-vote that roster's magnitude match with a cell match of its own.
    const rosterHasCells = shooter.weapons.some(w => Array.isArray(w.cells));
    const hasCell = rosterHasCells && Number.isInteger(proto) && Number.isInteger(subtype);
    const onCell = c => c && Number(c.proto) === proto && Number(c.subtype) === subtype;
    const tiers = [
      w => hasCell && Array.isArray(w.cells) && w.cells.some(c => onCell(c) && Number(c.mag) === mag),   // 1. cell + magnitude
      w => hasCell && Array.isArray(w.cells) && w.cells.some(onCell),                                    // 2. cell alone
      w => Array.isArray(w.hir) && w.hir.includes(mag),                                                   // 3. magnitude alone
    ];
    const nameFor = id => { const row = this.weaponRow(id); return (row && row.name) || id; };
    const verdict = (ms, source) => ms.length === 1
      ? { weapon_id: ms[0].weapon_id, name: nameFor(ms[0].weapon_id), source, ambiguous: false, candidates: [] }
      : { weapon_id: null, name: null, source: null, ambiguous: true, candidates: ms.map(w => w.weapon_id) };
    // A pickup is the catalogue (`this.catalog.weapons`, the whole visible arsenal) less the shooter's own ids, so a
    // shared cell or magnitude cannot be misread. Each tier tries the loadout, then the catalogue, before the next
    // looser tier: a picked-up USP-S (0,3) hit on a shooter who carries a magnitude-9 AR names the USP-S at tier 1,
    // not the AR at tier 3.
    const loadoutIds = new Set(shooter.weapons.map(w => w.weapon_id));
    const pickups = ((this.catalog && this.catalog.weapons) || []).filter(w => !loadoutIds.has(w.weapon_id));
    for (const t of tiers) {
      const own = shooter.weapons.filter(t);
      if (own.length) return verdict(own, 'loadout');
      const other = pickups.filter(t);
      if (other.length) return verdict(other, 'catalog');
    }
    return { weapon_id: null, name: null, source: null, ambiguous: false, candidates: [] };   // nothing claims it
  }
  /** The killing word's weapon (see its call site in `_onHp`): an exact, unambiguous loadout match stands; failing
   *  that, the one weapon this shooter has used on this player this life (only if exactly one); failing that, no weapon
   *  at all rather than a catalogue guess made from a clamped magnitude. Same return shape as `_resolveHitWeapon`. */
  _lethalWeapon(num, resolved) {
    if (resolved && resolved.source === 'loadout' && !resolved.ambiguous) return resolved;
    // Only when this shooter has used exactly ONE weapon (or one ambiguous set) on this player this life: a pistol
    // chip followed by a rifle kill must not name the pistol (polish round 1). Two or more is a guess, so none.
    const entry = this._life && this._life.taken.get(num);
    const used = entry ? entry.weapons.filter(w => w.weapon_id != null || w.ambiguous) : [];
    const prior = used.length === 1 ? used[0] : null;
    if (prior && prior.weapon_id != null) return { weapon_id: prior.weapon_id, name: prior.name, source: prior.pickup ? 'catalog' : 'loadout', ambiguous: false, candidates: [] };
    if (prior && prior.ambiguous) return { weapon_id: null, name: null, source: null, ambiguous: true, candidates: prior.candKey ? prior.candKey.split('|') : [] };
    return resolved ? { weapon_id: null, name: null, source: null, ambiguous: false, candidates: [] } : null;
  }
  armState() { return this.phase; }

  // ---------- BLE link ----------
  /** F293: the frames BrxLink sends as its connect probe, before it tells us the link is up. A connect that the
   *  engine's own first-connect probe (`_probe`) would answer keeps that order (`$STOP`, `$PHONE`, `$VERSION`);
   *  every other connect sends `$PHONE`, `$VERSION`: `$STOP` disarms IR reception, and a relink mid-match must never. */
  linkProbeFrames() {
    const pend = this._pendingPhase;
    const p = this.phase !== 'idle' ? this.phase : (pend && pend !== 'idle' && this.player ? pend : (this.player ? 'kitted' : 'connected'));
    return !this.probeSent && (p === 'connected' || p === 'kitted') ? [...PROBE_FW] : ['$PHONE,*', '$VERSION,*'];
  }
  /** `probe` (F293): what BrxLink's connect probe already sent and read ({probed, frames, fw, headset}). The engine
   *  then sends no probe of its own: no second `$PHONE`, and no `_probe()` when the link sent `$STOP`. */
  onBleConnected(gun, probe = null) {
    const first = !this.bleUp && !this.gun;
    const probed = !!(probe && probe.probed);
    if (probed && probe.fw) this.fw = probe.fw;
    this.gun = gun || this.gun; this.bleUp = true;
    this.lastGunFrameAt = this.now();   // B4: the watchdog's clock restarts at the moment of (re)link, not from whatever it was before the drop
    // B4: a RELINK (not the very first connect, which `_probe()` below covers with the full ritual) may
    // find the gun's own "app mode" event tap closed by whatever caused the drop — a bare `$PHONE,*` is
    // documented as side-effect-free once the tap is already open (bench 2026-08-25: "$PHONE,* returns
    // nothing"; it is also the one frame confirmed to wake a gun blind, "after a power-cycle $PHONE,*
    // alone wakes it") and carries no $STOP, so it never touches game/audio state. Without this a link
    // that drops and relinks mid-game could sit at `bleUp:true` while the gun stays mute — no $HIR, no
    // $BUT, no $VOLTS — until something else notices (field 2026-09-12, B4).
    if (this.probeSent && !probed) this._write(['$PHONE,*'], 'reopen event tap on relink');
    if (probed && Array.isArray(probe.frames) && probe.frames.includes('$STOP,*')) this.probeSent = true;   // the link sent PROBE_FW
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
    } else if (this.phase === 'live' && this.gunLocked && this.gunLocked.match_id === this.matchId) {
      // F272: the player followed the takeover and power-cycled the gun. Unlike a plain BLE drop, that wiped
      // the head, so the keep-pools reconcile is wrong. Book one out-of-band DOWN, restore the whole head, then
      // let the configured respawn path bring the player back on its ordinary timer.
      this._gunProbe = null;
      this._beginGunRecovery();
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
  /** F293: BrxLink's headset state. The first `joined` reading clears the flap warnings at once: the headset
   *  answered, so HEADSET OFF? is no longer true (it used to wait out the link's 30 s hold timer). */
  setHeadsetJoin(h) {
    const next = h && h.state ? { state: h.state, since: h.since ?? null } : null;
    const same = JSON.stringify(next) === JSON.stringify(this.headsetJoin);
    if (same && !(next && next.state === 'joined' && this.gunFlapping)) return;
    this.headsetJoin = next;
    if (next && next.state === 'joined') this.gunFlapping = null;
    this._changed();
  }
  onBleDropped() {
    const pendingResync = this._operatorResyncPending;
    this.bleUp = false; this.lastGunFrameAt = 0; this._gunProbe = null; this._gunProbeRetryAt = 0; this._gunRecovery = null; this._cure = null; this._queryAt = 0; this._operatorResyncPending = null; this.configQuery = null;   // F264/F287: no link, no answer -- an ask in flight can never resolve, and it must not act on the relink
    if (pendingResync) this._operatorResult('resync', 'gun link down (RELINK first)', pendingResync);
    this._endReload('dropped'); this.switching = null; this.held = {}; this.lastButton = null; this._lightGen = (this._lightGen || 0) + 1; this._ann.clear(); this._gun.clear(); this.log('gun link lost', 'le'); this._changed();
  }   // no link, no reload echo: the takeover would be fiction (pass-2 UX review 2026-09-03); the gen bump means a stray delayed write can't reach a gun that relinks mid-flight either. `held` goes with it: `_onButton` keeps the FIRST edge, so a press whose release never arrived before the drop would read as held forever — and `lastButton` with it, for the same reason: the last thing the gun said would otherwise sit on the diag panel as a live edge the link can no longer complete (review 2026-09-12). `lastGunFrameAt` resets too (B4): a dead watchdog clock must not immediately re-fire the instant the next relink's first frame is still pending
  setWsState(s, info) { this.wsState = s; this.wsReason = s === 'rejected' && info ? `${info.reason || 'refused'} (${info.code})` : null; if (s !== 'bound' && this._life) this._life.wsEverDown = true; this._changed(); }   // S56: dealtPartial reads this for the running life

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
      this.kitLockedFor = (config && config.config_id) || null;
      this.moment = { kind: 'kit_locked_by_host', at: this.now() };
      this.log('host locked kits while I was still kitting', 'li');
    }
    // F133: the lock notice belongs to the game it was raised for. A host who locks, never starts, and pushes
    // a NEW game spends none of the other retirements (the kit_open edge, START, match end), so the next
    // lobby still led with THE HOST LOCKED KITS. A config for another config_id retires it here.
    else if (this.kitLocked && this.kitLockedFor && config && config.config_id && config.config_id !== this.kitLockedFor) {
      this.kitLocked = false; this.kitLockedFor = null;
    }
    this.config = config || this.config;
    this.browse(false);   // the LOADOUT browser is a KITTED-phase screen; a config push ends kit-out
    this.frames = frames || this.frames; if (roster) this.roster = roster;
    this._dualEmitters = Array.isArray(this.frames && this.frames.dual_emitters) ? this.frames.dual_emitters : [];
    this.tutorial = false; this.tutorialWeapon = null; this.tryoutArming = null; this.tryoutUnconfirmed = null;
    this._gunRestFrame = null;   // F86: a new bundle's rest is `gun.rest` until this match's first take says otherwise
    if (!this.frames || !this.frames.head) { this.log('config without frames — ignored', 'le'); return; }
    if (!this.bleUp) { this.configPending = true; this.log('config stored; gun not linked yet — head will be written on relink', 'li'); this._changed(); return; }
    this.configPending = false; this._panicked = null;
    this.headEcho = null; this.ammoEcho = null; this.awaitingEcho = true; this.headWrittenAt = this.now(); this.configQuery = null;
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
  /** Called by tick(): collect the head echo, then its optional `$QUERY` configuration read-back. */
  _checkEcho() {
    if (this.awaitingEcho) {
      // Still writing: wait, but not for ever. A write that never settles (a hung bridge) acks `no_echo`.
      if (!this.headWriteDone) { if (this.now() - this.headWrittenAt < HEAD_WRITE_CAP_MS) return; }
      else if (this.now() - this.headWrittenAt < ECHO_WINDOW_MS) return;
      this.awaitingEcho = false;
      const cid = this.config && this.config.config_id;
      if (!this.headEcho) { this.report('ack_config', { config_id: cid, ok: false, err: 'no_echo' }); return; }
      // Keep this independent of F264's `_queryAt`: that query classifies the following `$LCD` as a
      // cure response. This one only reads the status body and must not alter live pool/no-fire state.
      const q = this.configQuery = { queued_at: this.now(), reply_at: null,
        config_id: cid, gun_echo: this.ammoEcho || this.headEcho };
      const settled = () => {
        if (this.configQuery === q && q.reply_at === null) q.reply_at = this.now();
      };
      const write = this._write(['$QUERY,*'], 'config read-back');
      if (write && typeof write.then === 'function') write.then(settled, settled); else settled();
      return;
    }
    if (this.configQuery
        && ((this.configQuery.reply_at !== null && this.now() - this.configQuery.reply_at > CONFIG_QUERY_MS)
          || (this.configQuery.reply_at === null && this.now() - this.configQuery.queued_at > HEAD_WRITE_CAP_MS))) {
      const q = this.configQuery; this.configQuery = null;
      this.report('ack_config', { config_id: q.config_id, ok: true, gun_echo: q.gun_echo });
    }
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
    // S52: Easy Reload moved out of the perk slot into the per-player accessibility
    // override. A second weapon still owns ALT, so warn before the request goes out.
    if (slot === 'secondary' && kind === 'weapon' && lo.overrides && lo.overrides.easy_reload) {
      return { slot: 'accessibility', id: 'easy_reload', name: 'Easy Reload' };
    }
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
    if (loadout && this.player) {
      // Older MCs omit accessibility overrides from slot-scoped echoes. Keep the
      // current override unless the echo explicitly supplies a replacement.
      const prior = this.player.loadout || {};
      this.player.loadout = {
        ...prior,
        ...loadout,
        overrides: loadout.overrides === undefined ? prior.overrides : loadout.overrides,
      };
    }   // MC's echo is the truth (applies on ok AND on a reject → reverts the optimistic row)
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
    return { primary, secondary, perk, overrides: lo.overrides ? { ...lo.overrides } : undefined };
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
    if (newMatch) { this.score = null; this.scoreAt = null; this.result = null; this.resultAt = 0; this.endedAt = 0; this._downWarn = 1; this._timedLifeAt = null; this._gunProbe = null; this._gunProbeRetryAt = 0; this._gunRecovery = null; this.gunLocked = null; }
    this.matchId = body.match_id; this.cuesFired = new Set(); this.shots = 0; this.deaths = 0; this.ended = false; this._resyncRevive = false;
    this._cure = null; this._queryAt = 0; this._cureLife = null; this._cureAt = 0; this._pollAt = 0; this._probedLife = null; this.cure = null; this._poolCheck = null; this._poolRepair = null; this.poolWrong = null;   // F341   // F264: a new match owes the last one's gun nothing
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
    if (newMatch) { this.spawned = false; this.alive = false; this.deadAt = 0; this.killedBy = null; this.downReason = null; this._resetHill(); this.callout = null; this._irKillOpen = []; this._mcKillOpen = []; this._downByOpen = []; this._ann.clear(); this._gun.clear(); this.card = null; this._lanes = null; }   // game 2 must not inherit game 1's owner, tally, warnings or kill-confirm race
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
    const max = this._readoutMax(entry);
    const frac = max > 0 ? level / max : 0;
    const bands = entry.bands || [];
    return bands.find(b => frac > b[0]) || bands[bands.length - 1] || null;
  }
  /** A16.3 (bar-spec 2026-09-07): the 7-level (0-6) reading for one `gun.readout.pools[]` entry that
   *  carries `levels` — `round(fraction * 6)` clamped to [0,6], floor-clamped to 1 while the pool has
   *  anything left so "1 HP" and "dead" never render the same (poolgauge._segments' rule, extended). */
  _readoutLevel(entry) {
    const value = entry.pool === 'health' ? this.hp : entry.pool === 'armor' ? this.armor : this.shield;
    const max = this._readoutMax(entry);
    const frac = max > 0 ? value / max : 0;
    let level = Math.max(0, Math.min(6, Math.round(frac * 6)));
    if (level === 0 && value > 0) level = 1;
    return level;
  }
  /** A56 (Tony, 2026-09-24): the maximum one readout entry measures against. While an overshield is held,
   *  the shield entry's maximum is the preset's max PLUS the overshield, so the gun shows shield + overshield
   *  as ONE teal pool that drains visibly (the phone HUD shows the overshield as its own layer; see
   *  led-language.md §5). On a no-shield preset (max 0) the overshield alone is that pool. Mirrors
   *  `stage.py`'s `_readout_max`. */
  _readoutMax(entry) {
    const max = entry.max > 0 ? entry.max : 0;
    const o = entry.pool === 'shield' && this._overshield;
    return o && o.amount > 0 ? max + o.amount : max;
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
    // F349: no readout animation while a recharge runs: each grant's step and blink sat in the BLE queue in front of
    // SHIELDS ONLINE. The grant that fills the pool ends the recharge first (`_shieldCharged`), so full is painted.
    if (pool === 'shield' && this._shieldRegen) return;
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
    const now = this.now(), holdMs = Math.max(0, Math.round((readout.hold_s != null ? readout.hold_s : READOUT_HOLD_S) * 1000));
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
    const rapid = this._roLastStartAt != null && (now - this._roLastStartAt) < (readout.min_gap_ms != null ? readout.min_gap_ms : READOUT_MIN_GAP_MS);
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
    const leadMs = Math.max(0, Math.round(readout.lead_ms != null ? readout.lead_ms : READOUT_LEAD_MS));
    const gapMs = Math.max(0, Math.round(readout.blink_gap_ms != null ? readout.blink_gap_ms : READOUT_BLINK_GAP_MS));
    const stepMs = Math.max(0, Math.round(readout.step_ms != null ? readout.step_ms : READOUT_STEP_MS));
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
    const now = this.now(), holdMs = Math.max(0, Math.round((readout.hold_s != null ? readout.hold_s : READOUT_HOLD_S) * 1000));
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
    if (this._roBlinkAt && this._roPool != null && !(this._roPool === 'shield' && this._shieldRegen)) {   // F349: no blink during a recharge
      const entry = readout.pools.find(p => p.pool === this._roPool);
      const pair = entry && Array.isArray(entry.levels) ? entry.levels[this._roLevel] : null;
      if (pair && pair[1]) {
        const blinkMs = Math.max(0, Math.round(readout.blink_ms != null ? readout.blink_ms : READOUT_BLINK_MS));
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
  _event(kind, pick = this._pickCue(kind), must = false) {
    const f = this.frames; if (!f) return;
    if (pick.frame) { if (must) this._sayMust(pick.frame, `event cue ${kind}${pick.tag}`); else this._write([pick.frame], `event cue ${kind}${pick.tag}`); }
    this._eventLeds(kind);
  }
  /** C2 (Tony's match 2026-09-24): an announcer card (the kill card, an alert banner). It lands in `card`, a field only the
   *  announcer queue writes, so a later `moment` (a hit, a stun) in the same render can no longer overwrite it before the
   *  HUD draws it. `moment` still carries it too, for the readers that have always looked there. */
  _card(m) { this.card = m; this.moment = m; }
  /** docs/announcer.md: an MC alert (or the node's own clock warning) as ONE announcer item: its cue, its LED burst
   *  and its HUD banner start together when the queue reaches it, never on top of another line. A lead change is
   *  its own kind (it outranks every other alert, Tony); every other alert is `alert`. */
  _announceAlert(evKind, text, { hud = true, subject = null, src = 'PHONE' } = {}) {
    // The three lanes: the lead and the hill are persistent OBJECTIVE badges; any other alert is a FEED row.
    if (evKind === 'lead_taken' || evKind === 'lead_lost') this._laneObj('lead', { kind: evKind, text: text || evKind, src });
    else if (evKind === 'hill_captured' || evKind === 'hill_lost') this._laneObj('hill', { kind: evKind, src });
    else if (evKind !== 'kill' && hud) this._laneFeed({ kind: 'alert', alert: evKind, text: text || evKind, src });
    // A kill line is said for exactly two sources: MC's `feedback{kind:'kill'}` and an S57 DOWN_BY naming this player.
    // An alert that names `kill` is neither, so it must not borrow the kill pool.
    if (evKind === 'kill') { this.log('alert kill ignored: a kill confirm comes only from MC feedback or an S57 DOWN_BY naming me', 'li'); return null; }
    const kind = evKind === 'lead_taken' || evKind === 'lead_lost' ? evKind : 'alert';
    const pick = this._pickCue(evKind), cm = this.frames && this.frames.cue_ms;
    const lg = (this._lightGen = this._lightGen || 0);
    return this._ann.push({ kind, key: kind === 'alert' ? `alert:${evKind}` : 'lead', text: text || evKind, audioMs: clipMs(pick.frame, cm ? cm[evKind] : undefined),
      ...(hud ? {} : { bannerMs: 0 }),
      ok: () => this._lightGen === lg,
      play: ({ muted }) => {
        this._event(evKind, muted ? { frame: null, tag: '' } : pick, kind !== 'alert');   // a lead change is must-hear
        if (hud) this._card({ kind: 'alert', at: this.now(), data: { kind: evKind, text: text || evKind, player_id: subject } });
        this._changed();
      } });
  }
  /** docs/announcer.md: a pool voice line ("Shields online", "Healed", "Armour up", "Shields charging") at the lowest
   *  priority with a short TTL. A bundle with no line for it still gets its LED burst at once. */
  _announceStatus(evKind) {
    const pick = this._pickCue(evKind);
    if (!pick.frame) { this._event(evKind, pick); return null; }
    const cm = this.frames && this.frames.cue_ms, lg = (this._lightGen = this._lightGen || 0);
    // One key for every pool line, `preemptKey`: the newest pool state takes over a pool line on air at once (no `$PLAYX`:
    // the gun's own queue slot holds it behind the line already playing), as F57's "the rarer cue wins" always had it.
    return this._ann.push({ kind: 'status', key: 'status', preemptKey: true, audioMs: clipMs(pick.frame, cm ? cm[evKind] : undefined),
      ok: () => this._lightGen === lg, play: ({ muted }) => { this._event(evKind, muted ? { frame: null, tag: '' } : pick); this._changed(); } });
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
  /** F289: the ms of spawn protection the PHONE still has to end, or 0. Only the phone lifts it (no gun-side timer is
   *  known for `$TMP` t8), so a phone that dies inside the window leaves the gun unhittable. MC flags such an OFFLINE
   *  player as possibly protected from this (`respawn` fact `protect_ms`, status `protected`). */
  _protectOwedMs() {
    // A56 polish H2: an overshield grant's protection is owed until its end is written (F289).
    const os = this._osProtectUntil && this.alive ? Math.max(1, this._osProtectUntil - this.now()) : 0;
    const p = this._armPending, mode = this._protectMode();
    if (!p || !(this.alive || p.flip) || !(mode === 'twin' || (mode === 'tmp' && p.off !== false))) return os;
    return Math.max(os, 1, p.until != null ? p.until : SPAWN_PROTECT_MAX_MS);
  }
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
    this._write([rp.shield_on], 'protection light after hit');
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
    // F348: `shield_off` is the station's protection LIGHT going dark (a headset frame), never the shield POOL.
    const lightOff = p.shield && rp && rp.shield_off ? [rp.shield_off] : [];
    const frames = [...take, ...off, ...lightOff];
    if (!frames.length) { this._changed(); return; }
    // F11 fix (playtest review 2026-09-13): `link.write` resolves `false` on a GATT error instead of
    // rejecting, so a failed write here used to leave the gun on fn 28 (no real $SIR table) for the
    // whole life -- immortal. Re-arm the pending take on a `false` resolve so the next tick's cap
    // (or the next shot) retries. Gated the same way the write itself was gated, so a life that ended
    // or moved on while the write was in flight is never re-armed; the retry itself only fires once the
    // link is back up (`tick()` gates the cap path on `bleUp`), so this cannot spin on a dead link.
    const r = this._write(frames, off.length ? `end spawn protection (${why})${take.length ? ` + hit table ${take.length}r` : ''}${lightOff.length ? ' + protection light off' : ''}` : `arm hit reception (${why})`);
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
    // docs/announcer.md: a grunt is stale PAIN_STALE_MS after its hit. One that would wait longer than that in the gun's
    // FIFO (behind the shield-break line of the same hit, say) is dropped, not queued. While the loop blocks, never.
    this._audioSync(now);   // the shield as it stands NOW: the hit may just have broken it
    if (this._gun.freeAt(now) - now > PAIN_STALE_MS) { this.log(`pain ${kind.slice(5)} dropped: the gun is busy for ${this._gun.freeAt(now) - now} ms`, 'li'); return; }
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
  /** F348: the pool write that makes a Shields life start at full shield: one additive `$LIFE,0,0,<max>,*` placed after
   *  the burst's `$SPAWN` (which leaves the pool at 0), clamped by the gun at `$PSET` t5. Only a shields game
   *  (`shieldRegenOn`, armour 0): Standard ships shield 0, and an armoured game keeps its IR-filled shield.
   *  `[]` when SPAWN_SHIELD_FULL is off. A spawn read-back that follows the burst should read shield = maxShield. */
  _spawnShieldFill() {
    if (!SPAWN_SHIELD_FULL || !this.shieldRegenOn) return [];
    return [`$LIFE,0,0,${this.maxShield},*`];
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
    const fill = this._spawnShieldFill();   // F348: a Shields life starts at full shield
    this._writeLife([...late, ...(ps.frame ? [ps.frame] : []), ...(rpSpawn ? rpSpawn.spawn : this.frames.spawn), ...fill, SFLASH, ...(sp.frame ? [sp.frame] : [])], 'spawn' + (late.length ? ` + hit table ${late.length}r (late)` : '') + (fill.length ? ` + shield pool ${this.maxShield}` : '') + this._lineTag(sp) + (ps.frame ? ` + scream ${ps.id}${ps.tag}` : ''), life);
    if (late.length) this._sirLive = true;
    this.hurtFired = false;        // the low-health alert is once per LIFE
    this._pendingHurtWrite = false;
    this._prevAmmo = {}; this._prevReserve = {}; this._shotAcct = {}; this.activeSlot = 0; this.magBySlot = {}; this.heatBySlot = {}; this._heatAt = {}; this._everHeated = {}; this._heatLock = null; this.lastShot = null;   // config echoes carry WEAP clip caps, not spawn mags — never let them set the denominator   // assumption (hardware-UNVERIFIED): a fresh spawn puts the gun on slot 0
    this._holdAccuracyWrites('spawn');   // the spawn write owns `$AMMO` until the gun has answered it
    this._lastTeamRepaintAt = this.now();   // F68: the spawn flash IS this life's first paint; the backstop clock runs from it
    this._accuracyOffset = 0; this._nativeAccUntil = 0; this._nativeAccWhy = null;   // `$SPAWN` clears every `$TMP`
    this._recoilArm('spawn');   // S42: a fresh life starts at the weapon's ceiling
    this._poisonClear('spawn'); this._smokeClear('spawn'); this.gunAcc = null; this._accZeroAt = null; this._smokeHirAt = null; this._dotEcho = null; this._dotKill = null;   // S16/S53: a new life carries neither
    this._resetLifeLedger();   // S56: nor does the "what hit me" ledger
    this._puReset();           // A56: a new match starts with no item held, taken or announced
    if (ps.frame) this._psetNow = ps.frame;   // A56: the overshield raises THIS frame's shield max, and restores it
    this._cue('klaxon');
    // Spawn shield is ALWAYS 0 on hardware -- $PSET t5 is a capacity filled by an fn-11
    // grant, never a starting pool (bench 2026-08-27).
    this._shieldFillAt = fill.length ? this.now() : 0;   // F348: the pool is 0 until the gun answers the fill
    this.spawned = true; this.alive = true; this.hp = this.maxHp; this.armor = this.maxArmor; this.shield = 0; this.killedBy = null; this.downReason = null; this.deadAt = 0; this.reloading = null; this._reloadOutcome = null; this.held = {};
    this.poolSrc = 'model';        // R2-3: those two numbers are config.health, not the gun's answer
    this._prevHp = this.hp; this._prevArmor = this.armor; this._prevShield = this.shield;
    this._spawnAt = this.now(); this._gunLifeAt = this._spawnAt; this._armedThisLife = false;   // B5/F272: settle and silence clocks start with this life
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
    // docs/announcer.md: one announcer item, keyed 'hill'. The later hill word still wins outright over a hill line on
    // air (`preemptKey`), and `preempted` is true only while THAT line is still sounding, so the `$PLAYX` only ever
    // cuts our own hill callout. Behind any other item (a kill confirm, a lead change) it waits like everything else.
    const cue = this._hillCue(kind);
    const card = kind === 'hill_captured' || kind === 'hill_lost';
    if (card) this._laneObj('hill', { kind, src: /control point/.test(why) ? 'BLE' : 'IR 15' });
    if (!cue.frame && !card) return;
    this._ann.push({ kind: card ? kind : 'alert', key: 'hill', preemptKey: true, stopsOwn: true, audioMs: cue.frame ? cue.ms : 0, ...(card ? {} : { bannerMs: 0 }),
      ok: () => this._hillAudioOn(),
      play: ({ preempted, muted, flush }) => {
        // QA-05: the HUD's HILL CAPTURED / HILL LOST card reads this, set when the line starts (a muted line still shows).
        if (card) this.hillCallout = { kind, at: this.now() };
        // docs/announcer.md: an objective line cuts the shield loop (`flush`) rather than being muted by it
        if (cue.frame && !muted && flush) this._sayMust(cue.frame, `hill ${kind} (through the shield loop) — ${why}`);
        else if (cue.frame && !muted) this._write(preempted ? [PLAYX, cue.frame] : [cue.frame], `hill ${kind}${preempted ? ' (preempting the line still playing)' : ''} — ${why}`);
        this._changed();
      } });
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
  /** S57 (docs/ir-callouts.md): a proto-15 `$HIR` whose magnitude is 21-36 — the IR callout bus, dispatched by
   *  the `case 'HIR'` parser BEFORE it ever reaches the beacon code above, and it never touches `this.beacon`
   *  or `_onHillBeacon`. `player` is the word's raw t[3] (the KILLER for `DOWN_BY`, the VICTIM for a bare
   *  `DOWN`); `magnitude` decodes which, plus the victim's team, by plain arithmetic (base + team id 0-3) — the
   *  word's own team field (t[4], not read here) is a transmit-side friendly-fire lever (contracts.md/the doc's
   *  "bench facts"), not information for this phone. Presentation only: never books a death/kill, never moves
   *  the score. Dedupe is `magnitude:player` (never the sensor — F85: one physical word lands on more than one
   *  ~14 ms apart), inside CALLOUT_DEDUPE_MS; short enough that a real double kill (the same key again a
   *  second or so later) still counts twice. */
  _onIrCallout(player, magnitude, now) {
    if (magnitude >= IR_CALLOUT.FLAG_TAKEN) return;   // 29-39: FLAG_TAKEN/FLAG_CAPTURED reserved — ignored outright, v1 sends and handles neither (Tony, 2026-09-23)
    if (!this.alive || this.phase !== 'live') return;    // a dead gun would not report it anyway (the doc), and callouts are a live-match thing only
    if (Number.isNaN(player) || Number.isNaN(magnitude)) return;
    const key = `${magnitude}:${player}`;
    if (this._calloutSeen && this._calloutSeen.has(key) && now - this._calloutSeen.get(key) < CALLOUT_DEDUPE_MS) {
      // A same-killer double kill of one team inside the dedupe: the second DOWN_BY is not a new callout, but its
      // victim's DOWN is coming, so it still opens a pairing slot (sensor copies, ~14 ms apart, do not).
      if (magnitude < IR_CALLOUT.DOWN && now - this._calloutSeen.get(key) >= CALLOUT_PAIR_MIN_MS) {
        (this._downByOpen || (this._downByOpen = [])).push({ at: now, team: magnitude - IR_CALLOUT.DOWN_BY, quiet: true });
        this._calloutSeen.set(key, now);
      }
      return;
    }
    (this._calloutSeen || (this._calloutSeen = new Map())).set(key, now);
    const isDownBy = magnitude < IR_CALLOUT.DOWN;
    const victimTeam = magnitude - (isDownBy ? IR_CALLOUT.DOWN_BY : IR_CALLOUT.DOWN);
    const myNum = this.player && this.player.player_num;
    // S57 names (Tony 2026-09-24): the victim's phone sends DOWN_BY (the killer) and, CALLOUT_NAME_GAP_MS later, DOWN
    // (the victim). A DOWN that pairs with the OLDEST open DOWN_BY for the same victim team inside CALLOUT_PAIR_MS is
    // the same death: it only adds the victim's name to that callout, with no second callout and no cue. A DOWN_BY
    // left unpaired past the window is dropped; a lone DOWN (its DOWN_BY lost, or a killer unknown) is a callout.
    this._downByOpen = (this._downByOpen || []).filter(e => now - e.at <= CALLOUT_PAIR_MS);
    const entry = isDownBy ? { at: now, team: victimTeam } : null;
    if (entry) this._downByOpen.push(entry);
    else {
      // Round 2 M2: of the open DOWN_BYs for this team old enough to be this word's pair, the one whose age is closest to
      // the sender's own gap (CALLOUT_NAME_GAP_MS), not simply the oldest: with an 800 ms window, the oldest may be an
      // earlier death whose name word was lost.
      let i = -1;
      this._downByOpen.forEach((e, k) => {
        if (e.team !== victimTeam || now - e.at < CALLOUT_PAIR_MIN_MS) return;
        if (i < 0 || Math.abs(now - e.at - CALLOUT_NAME_GAP_MS) < Math.abs(now - this._downByOpen[i].at - CALLOUT_NAME_GAP_MS)) i = k;
      });
      if (i >= 0) {
        // docs/announcer.md: the DOWN_BY's callout gets the name wherever it is: on air (named in place), waiting (it plays
        // named) or already shown and back in the queue (a card a kill confirm displaced shows again, named).
        const open = this._downByOpen.splice(i, 1)[0], it = open.item;
        if (open.lane && player !== myNum) this._laneName(open.lane, this.nameOf(player));
        if (it && player !== myNum) {
          const victim = this.nameOf(player);
          it.callout = { ...it.callout, victim };
          if (it.shown && this.callout === it.shown) { this.callout = it.shown = { ...this.callout, victim }; this._changed(); }
        }
        return;
      }
    }
    if (isDownBy && player === myNum) { entry.item = this._irKillConfirmed(victimTeam, now, entry); return; }   // row 1: I made this kill
    if (!isDownBy && player === myNum) { this.log(`S57: DOWN naming me, magnitude ${magnitude}, ignored`, 'li'); return; }   // row 4: my own DOWN (my own phone already knows); logged, so a mis-decoded or mis-sent word is visible (field 2026-09-24: 28 where 22 was expected)
    // FFA: `$TID` equality never means friendly (A5.2/contracts.md), so a bare team match is always ENEMY DOWN there.
    const teammate = this.config && this.config.mode !== 'ffa' && this.teamTid != null && victimTeam === this.teamTid;
    // QA-05: a DOWN_BY word names the KILLER, never the victim, so `by` carries that name for the HUD card
    // ("YELLOW DOWN · BY GHOST"). Read-only presentation, present only when the word named a killer.
    const by = isDownBy ? this.nameOf(player) : null;
    const kind = teammate ? 'teammate_down' : 'enemy_down';
    const row = this._laneFeed({ kind, name: isDownBy ? null : this.nameOf(player), team: TEAM_KEY[victimTeam] || null, by, src: 'IR 15' });
    if (entry) entry.lane = row;   // the victim's DOWN word names this row when it pairs (below)
    const line = teammate ? null : `$PLAY,,4,6,${IR_CALLOUT.ENEMY_DOWN_CUE},,,,*`;   // row 3: a teammate gets the HUD chip only, no sound
    const it = this._ann.push({ kind, src: 'ir', audioMs: line ? clipMs(line) : 0,
      callout: { kind, name: isDownBy ? null : this.nameOf(player), team: TEAM_KEY[victimTeam] || null, at: now, ...(by ? { by } : {}) },
      ok: () => this.alive && this.phase === 'live',
      play: ({ muted, flush }, self) => {
        this.callout = self.shown = { ...self.callout, at: self.startedAt };   // the SAME instant the queue stamped (MC's `ir_at` names it): never a second clock read
        if (line && !muted && flush) this._sayMust(line, 'S57 ENEMY DOWN (through the shield loop)');   // an objective line (docs/announcer.md)
        else if (line && !muted) this._write([line], 'S57 ENEMY DOWN');
        this._changed();
      } });
    if (entry) entry.item = it;
    this._changed();
  }
  /** S57 kill confirm, first to arrive, once (Tony): an IR `DOWN_BY` naming me and MC's `feedback{kind:'kill'}`
   *  both confirm the SAME kill. Each channel stamps only ITS OWN timestamp (`_irKillCueAt` here,
   *  `_mcKillCueAt` in `feedback()`) and reads only the OTHER's -- so two of the same channel's kills close
   *  together (a real double kill) never suppress each other, only a genuinely different channel racing the
   *  same kill does. Whichever lands first plays the cue; `feedback()` reads `_irKillCueAt` back to skip its
   *  own plain kill line within CALLOUT_WINDOW_MS (medal cues still play — they carry information this word
   *  does not). The IR word never touches the score: only MC's feedback does that. No victim name is ever
   *  known here — read `victimName`'s comment: the `kill` moment's HUD banner names Mission Control as
   *  its source (hud.js `_kill`), which would be a lie for a pure IR confirm, so this uses
   *  `state().callout` instead of that moment. */
  /** S57 polish: pair the two kill-confirm channels ONE-TO-ONE, never by a bare timestamp. `open` is the other channel's
   *  list of unmatched confirms; the oldest one inside CALLOUT_WINDOW_MS whose victim team agrees (or is unknown on
   *  either side) is consumed and the caller skips its plain cue. A double kill where only one IR word lands still
   *  plays MC's cue for the second kill: the one IR confirm pairs with one MC confirm, not with both. */
  _takeKillMatch(open, team, now) {
    for (let i = open.length - 1; i >= 0; i--) if (now - open[i].at > CALLOUT_WINDOW_MS) open.splice(i, 1);
    const i = open.findIndex(x => !x.team || !team || x.team === team);
    if (i < 0) return null;
    return open.splice(i, 1)[0];   // the matched confirm: its `item` is the announcer item that said it (docs/announcer.md)
  }
  _irKillConfirmed(victimTeam, now, pair = null) {
    const callout = { kind: 'kill_confirmed', name: null, team: TEAM_KEY[victimTeam] || null, at: now };
    const tid = Number.isInteger(victimTeam) ? victimTeam : null;   // pair on the numeric tid: MC's team_id is not a colour key
    const mcAlreadyConfirmed = this._takeKillMatch(this._mcKillOpen, tid, now);
    let it = null;
    // The HERO lane: MC's confirm for this kill already made the row, so the IR word only adds its source to it
    if (mcAlreadyConfirmed && mcAlreadyConfirmed.lane) this._laneUpdate(mcAlreadyConfirmed.lane, { src: 'MC · IR 15' });
    if (pair) pair.lane = mcAlreadyConfirmed ? mcAlreadyConfirmed.lane || null : null;
    if (!mcAlreadyConfirmed) {
      const entry = { at: now, team: tid, lane: this._laneKill({ victim: null, team: callout.team, src: 'IR 15' }) };
      if (pair) pair.lane = entry.lane;
      this._irKillOpen.push(entry);
      const pick = this._pickCue('kill');
      const lg = (this._lightGen = this._lightGen || 0);
      this._write([SFLASH], 'S57 IR kill confirmed');   // the sight flash is the gun's light: at once
      // docs/announcer.md: the line and the KILL CONFIRMED card are one top-priority announcer item
      it = this._ann.push({ kind: 'kill_confirmed', src: 'ir', audioMs: pick.frame ? 120 + clipMs(pick.frame) : 0, bannerMs: 2000, callout,
        ok: () => this._lightGen === lg,
        onDrop: () => { this._irKillOpen = this._irKillOpen.filter(x => x !== entry); },   // unheard: MC's twin must speak for itself
        play: ({ muted }, self) => {
          this.callout = self.shown = { ...self.callout, at: self.startedAt };   // the SAME instant the queue stamped (MC's `ir_at` names it): never a second clock read
          if (pick.frame && !muted) this.delay(120, () => { if (this._lightGen === lg) this._sayMust(pick.frame, `S57 IR kill confirmed cue${pick.tag}`); });
          this._changed();
        } });
      entry.item = it;
    } else if (!mcAlreadyConfirmed.killLine) {
      // C1 (Tony's match 2026-09-24, "first kill had no confirm at all"): MC's item for this kill says no kill line (a
      // medal replaced it, or it was too late to say anything). The IR word says the confirmation itself, voice only:
      // MC's card is the kill's one card, so this adds no card and no flash.
      const pick = this._pickCue('kill');
      const lg = (this._lightGen = this._lightGen || 0);
      if (pick.frame) it = this._ann.push({ kind: 'kill_confirmed', src: 'ir-voice', audioMs: 120 + clipMs(pick.frame), bannerMs: 0,
        ok: () => this._lightGen === lg,
        play: ({ muted }) => { if (!muted) this.delay(120, () => { if (this._lightGen === lg) this._sayMust(pick.frame, `S57 IR kill confirmed cue${pick.tag} (MC's item for this kill said no kill line)`); }); } });
      this.log('S57: IR kill confirmed; MC confirmed it too, but wrote no kill line for it, so the IR word says it', 'li');
    } else {
      // MC's item owns this kill. On air, the chip still reflects the word (hud.js keeps MC's named card over it); still
      // queued, nothing is shown, or the IR card would flash first and MC's card flash again for the same kill.
      const mc = this._ann.find(x => x.kind === 'kill_confirmed' && x.src === 'mc');
      if (!mc || mc === this._ann.current) { if (mc) this.callout = callout; }
      this.log('S57: IR kill confirmed; MC\'s item for this kill says (or said) the kill line, so the IR word adds no sound', 'li');
    }
    this._changed();
    return it;
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
    this.hill = null; this.hillCallout = null; this._hillTickAt = 0;
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
    // docs/announcer.md: the tick never queues behind a clip on the gun, nor jumps a waiting line, nor sounds while the item on
    // air still has audio due (the gaps inside a kill item: the 120 ms flash-to-line gap, the gap between medal lines). It is
    // a token-1 clip, the gun's interrupt slot: written there, it cuts whatever plays.
    if (this._gun.outstanding(now) > 0 || this._ann.queue.length || this._ann.audioBusy(now)) return;
    // D: OUR point draining doubles the cadence. Nothing else is audible before "Hill Lost!", which arrives
    // when it is already too late — the defender hears an unchanged 1 s tick right up to the moment they
    // have lost it. `falling` comes off the advert, so this costs a comparison.
    const period = h.falling ? HILL_TICK_LOSING_MS : HILL_TICK_MS;
    if (this._hillTickAt && now - this._hillTickAt < period) return;
    const cue = this._hillCue('hill_tick');
    if (!cue.frame) return;
    this._hillTickAt = now;
    this._write([cue.frame], 'hill possession tick');   // recorded in the gun's audio FIFO by `_audioWrite`
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
    // A56 (lead 2026-09-24): never write a refill while an overshield is up or the shield sits above the preset max. The
    // grant is additive and clamps AT the max, so a refill would cut the overshield down (and it must never top one up).
    if (this._overshield || this.shield > this.maxShield) { this._shieldRegen = null; return; }
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
      // docs/announcer.md: a beat that would still be sounding when the refill starts is not begun, so "Shields charging"
      // finds the gun free (the heartbeat is a clip in the gun's FIFO, and it would hold that line back).
      const period = this._shieldLoopPeriod();
      if (this._shieldDown && this.shield === 0 && !this._shieldGaveUp && !this._shieldRegen
        && !(period > 0 && !this._shieldGaveUp && now + period > this._shieldQuietAt + SHIELD_REGEN_DELAY_MS)) this._shieldLoopTick(now);
      return;
    }
    if (!this._shieldRegen) {
      const step = this._shieldRegenStep(), need = Math.max(1, Math.ceil((this.maxShield - this.shield) / step));
      // `from`/`step`/`fullAt` are published (`state().shieldRegen`) so the phone draws the fill from them (F349)
      this._shieldRegen = { startedAt: now, nextAt: now, grants: 0, from: this.shield, step, fullAt: now + (need - 1) * SHIELD_REGEN_STEP_MS };
      this.log(`shield recharge: ${this.shield}/${this.maxShield} after ${Math.round((now - this._shieldQuietAt) / 1000)}s without damage`, 'lk');
      // C4 (Tony's match 2026-09-24: a 72 ms refill spoke 4.1 s of audio): say it only when the refill will take longer
      // than SHIELD_CHARGING_MIN_MS, reckoned from the grants it needs at SHIELD_REGEN_STEP_MS each.
      const refillMs = Math.ceil(Math.max(0, this.maxShield - this.shield) / this._shieldRegenStep()) * SHIELD_REGEN_STEP_MS;
      if (refillMs > SHIELD_CHARGING_MIN_MS) this._announceStatus('shield_charging');
      else this.log(`shield recharge: ${refillMs} ms to refill, too short to announce`, 'li');
    }
    const r = this._shieldRegen;
    if (now < r.nextAt) return;
    if (r.grants >= SHIELD_REGEN_GRANTS + SHIELD_REGEN_MAX_GRANTS_SLACK) {
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
    this._write([`$LIFE,0,0,${r.step},*`], `shield regen grant ${r.grants}`);
  }
  /** F349: one recharge grant, so a full pool takes SHIELD_REGEN_GRANTS writes. The gun clamps the last at t5. */
  _shieldRegenStep() { return Math.max(1, Math.ceil((this.maxShield || 0) / SHIELD_REGEN_GRANTS)); }
  /** S45: the heartbeat, replayed for as long as the shield is down and the recharge has not started. A LOOP
   *  the node drives, because the gun has no looping `$PLAY` -- the same shape as the hill possession tick,
   *  and for the same reason: a clip relaunched faster than it runs stacks and drifts (F74). The period is
   *  the clip's own length, so each replay lands as the last one ends. `''` = the host turned the loop off. */
  _shieldLoopPeriod() {
    const cm = this.frames && this.frames.cue_ms;
    return cm && Object.prototype.hasOwnProperty.call(cm, 'shield_loop') ? cm.shield_loop : SHIELD_LOOP_MS;
  }
  _shieldLoopTick(now) {
    const f = this.frames && this.frames.cues && this.frames.cues.shield_loop;
    if (!f) return;
    const period = this._shieldLoopPeriod();
    if (!(period > 0)) return;
    if (this._shieldLoopAt && now - this._shieldLoopAt < period) return;
    // C3 (Tony's match 2026-09-24): the heartbeat is a body sound outside the announcer queue, but it shares the gun's
    // one FIFO. It never starts while the gun still holds a clip (a must-hear line included, for that line's length) or
    // while any announcer item waits; once written it is a clip in the model, so a kill confirm flushes it.
    if (this._gun.outstanding(now) > 0 || this._ann.queue.length) return;
    this._shieldLoopAt = now;
    this._write([f], 'shield down heartbeat');   // recorded in the gun's audio FIFO by `_audioWrite`
  }
  /** S29: the pool reached its ceiling -- the refill is over and the shield is no longer down. The CUE for
   *  this moment is `_onHp`'s (`shield_online`), because only the gun's own frame proves the pool is full. */
  _shieldCharged() {
    if (this._shieldRegen) this.log(`shield recharged to ${this.maxShield} in ${this.now() - this._shieldRegen.startedAt} ms`, 'lk');
    this._shieldRegen = null; this._shieldDown = false; this._shieldLoopAt = 0; this._shieldGaveUp = false;
  }

  // ---------- F272: affirmative gun lock-up detector ----------
  /** Count one proof-of-life read only after the serialized BLE writer says it landed. A rejected/false write
   *  is transport failure, not an unanswered gun, and can never contribute to a lock verdict. */
  _sendGunProbe(n, now) {
    const token = ++this._gunProbeSeq;
    const pending = this._gunProbe = { token, n, requestedAt: now, writing: true };
    const retry = message => {
      if (!this._gunProbe || this._gunProbe.token !== token) return;
      this._gunProbe = null; this._gunProbeRetryAt = this.now() + GUN_RECOVERY_RETRY_MS;
      this.log(message, 'le');
    };
    const settle = ok => {
      if (!this._gunProbe || this._gunProbe.token !== token) return;
      if (ok === false || this.phase !== 'live' || !this.spawned || !this.alive || !this.bleUp || this.gunLocked) {
        if (ok === false) retry(`gun liveness probe ${n} did not reach the gun — not counted`);
        else this._gunProbe = null;
        return;
      }
      this._gunProbeRetryAt = 0; pending.writing = false; pending.sentAt = this.now();
    };
    const failed = e => retry(`gun liveness probe ${n} write failed — not counted: ${e && e.message || e}`);
    // Use the common solicitation path: an answering $HP proves liveness, but it is not evidence that an
    // independently unanswered trigger suddenly worked, so F208/F264's no-fire evidence must survive it.
    const started = () => {
      if (!this._gunProbe || this._gunProbe.token !== token) return;
      this._queryAt = this.now(); this._probeSeen = {};
    };
    const r = this._askGun(`gun liveness probe ${n}/2`, { deferClock: true, onStart: started });
    if (r && typeof r.then === 'function') r.then(settle, failed);
    else { started(); settle(r); }   // a synchronous writer has no queue to invoke `onStart` for it
  }

  _gunLockTick(now) {
    if (this.gunLocked) return;
    if (this.phase !== 'live' || !this.spawned || !this.alive || !this.bleUp || this.reconciling || this.resync || this.tutorial || this._cure || this._operatorResyncPending) {
      this._gunProbe = null; return;
    }
    const p = this._gunProbe;
    if (!p) {
      if (now < this._gunProbeRetryAt) return;
      if (this._queryAt && now - this._queryAt <= QUERY_REPLY_MS) return;   // let an F264 read finish before owning the shared reply token
      const silentSince = Math.max(this.lastGunFrameAt || 0, this._gunLifeAt || 0);
      if (silentSince && now - silentSince >= GUN_SILENT_MS) this._sendGunProbe(1, now);
      return;
    }
    if (p.writing) return;
    if (p.n === 1) {
      if (now - p.sentAt >= GUN_PROBE_GAP_MS) this._sendGunProbe(2, now);
      return;
    }
    if (now - p.sentAt < GUN_PROBE_REPLY_MS) return;
    this._gunProbe = null;
    this.gunLocked = { at: now, match_id: this.matchId };
    this.moment = { kind: 'gun_locked', at: now };
    this.log('*** gun locked: two all-zero LIFE probes went unanswered — player must power-cycle ***', 'le');
    this._changed();
  }

  /** A power-cycle erased the head. Keep the player model alive and the durable instruction visible until the
   *  serialized writer confirms the replacement head landed; only that success books the recovery DOWN and
   *  starts its respawn clock. Failed transport retries are paced and capped; another relink resets the budget. */
  _beginGunRecovery() {
    this._gunRecovery = { attempts: 0, writing: false, nextAt: this.now() };
    this._gunRecoveryWrite();
  }

  _gunRecoveryWrite() {
    const recovery = this._gunRecovery;
    if (!recovery || recovery.writing || !this.gunLocked || !this.bleUp || this.phase !== 'live' || !this.frames) return;
    if (recovery.attempts >= GUN_RECOVERY_MAX_WRITES) return;
    const token = ++this._gunRecoverySeq;
    recovery.attempts++; recovery.writing = true; recovery.token = token;
    const failed = detail => {
      if (!this._gunRecovery || this._gunRecovery.token !== token) return;
      this._gunRecovery.writing = false;
      this._gunRecovery.nextAt = this._gunRecovery.attempts < GUN_RECOVERY_MAX_WRITES ? this.now() + GUN_RECOVERY_RETRY_MS : null;
      this.log(`locked-gun recovery head did not land (${detail}); ${this._gunRecovery.nextAt == null ? 'retry budget spent — power-cycle/relink again' : 'will retry'}`, 'le');
      this._changed();
    };
    const landed = ok => {
      if (!this._gunRecovery || this._gunRecovery.token !== token) return;
      if (ok !== true) { failed(`writer returned ${String(ok)}`); return; }
      // Only a confirmed head may start the respawn clock. Until this point the player remains alive in the
      // engine model but unable to play, with the lock takeover explaining the required recovery action.
      if (this.alive) this._death(true, 'gun_recovery');
      this._gunRecovery = null; this.gunLocked = null;
      this.log('locked gun relinked — full head restored; normal respawn path running', 'le');
      this._changed();
    };
    const r = this._writeHead('locked-gun recovery head');
    if (r && typeof r.then === 'function') r.then(landed, e => failed(e && e.message || e)); else landed(r);
  }

  _gunRecoveryTick(now) {
    const r = this._gunRecovery;
    if (r && !r.writing && r.nextAt != null && now >= r.nextAt) this._gunRecoveryWrite();
  }

  // ---------- clock tick (call every ~250 ms) ----------
  tick() {
    const now = this.now();
    this._awakeAt = now;             // §3.11: the heartbeat IS the proof the webview is running (see resume())
    this._gunRecoveryTick(now);       // F272: paced, bounded full-head retry while the durable instruction stays up
    this._gunLockTick(now);           // F272: silence -> two proved writes -> durable lock-up verdict
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
    this._operatorResyncTick(now);   // F287: also cancels outside LIVE, so a phase change cannot strand it
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
      // F272 recovery is a hard gameplay stand-down. The model intentionally stays alive until the replacement
      // head is confirmed, but no poison/shield/recoil/poll/death clock may run behind that instruction.
      if (this.gunLocked) return;
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
      this._poolRepairTick(now);   // F341: ...and when the pools it read back are wrong, repair them and read again
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
          if (prev > ms && left <= ms && !this.cuesFired.has(k)) { this.cuesFired.add(k); this._announceAlert(k, k === 'time_60' ? 'ONE MINUTE LEFT' : k === 'time_30' ? '30 SECONDS' : '10 SECONDS'); }
        }
      }
      if (!this.alive && this.deadAt && this.timedRespawn && now - this.deadAt >= this.respawnDelayMs && this.bleUp && !this.resync && !this.reconciling) {
        const rs = !!this._resyncRevive; this._resyncRevive = false; this._revive(rs);   // §3.10: a resync re-arm is flagged respawn{resync:true}
      }
      // utility.md §4: a scanner respawn with the presence gate revives the moment the player has dwelt at
      // their team's respawn station past the delay. The trigger gate (default) waits for $BUT,0,1 instead.
      if (this.respawnType === 'scanner' && this.respawnGate === 'presence') {
        const st = this._stationRevivable(now); if (st) { this._resyncRevive = false; this._revive(false, st.id); }
      }
      if (this.stunned && now >= this.stunned.until) this._stunRestore('expired');   // F15: the stun timer -- restore the LIVE counts
      this._poisonTick(now);           // S16: the poison tick clock (spec/node.md §3.17)
      if (this.smoke && now >= this.smoke.until) this._smokeClear('expired');   // S53: the gun's own ~6 s timer has given accuracy back
      this._reassertDeathBlink(now);   // A11.6: keep the headset out-blink lit through a long DOWN (colour opt-in only)
      this._teamRepaintTick(now);      // F68: a periodic repaint that survives a miss the wire never reports (S42)
      this._recoilTick(now);           // S42: recoil recovery + the one accuracy writer/verify loop
      this._downRearm(now);            // §3.2: one $HLOOP rearm after the hands-off window (belt-and-braces; the native flash is already running)
      this._gunReadoutTick(now);       // A16 §3.1: revert the gun-body readout to rest once its hold has run out
      this._reloadTick(now);           // F123: end a takeover the gun stopped feeding — and BOOK whether the mag actually came back
      this._shieldTick(now);           // S29: the shield recharge, and the heartbeat while the shield is gone
      this._puTick(now);               // A56: the powerup spawn announcements (inert without items)
      this._audioSync(now);
      if (this._ann.tick(now)) this._changed();   // docs/announcer.md: the next queued line or banner, once the one on air is done
      this._puClaimTick(now);          // A56: the claim's dwell runs on the clock too, not only on a fresh advert
      this._osTick(now);               // A56: the overshield grant's spawn protection ends OVERSHIELD_GRANT_MS after it
      this._puBackTick(now);           // A56 polish M3: a switch-back the gun never answered is re-sent
      this._hillTick(now);             // the possession tick on OUR ~1 s clock, and the >= 2-missed-beacon presence expiry
      this._reportPossession(now);     // and the possession CLOCK, which is what the mode is scored on
      if (this.moment && now - this.moment.at > 4000) { this.moment = null; }
      if (this.card && now - this.card.at > 4000) { this.card = null; }
      if (this.callout && now - this.callout.at > CALLOUT_WINDOW_MS) { this.callout = null; }   // S57: the HUD chip's own lifetime, independent of `moment`'s
      if (this.hillCallout && now - this.hillCallout.at > CALLOUT_WINDOW_MS) { this.hillCallout = null; }   // QA-05: the same lifetime
      // A swap the gun never confirmed with a shot: past the assumed window we TAKE the swap as done (the real
      // duration has never been timed — FOLLOWUPS F4; the next $ALCD corrects activeSlot if the gun disagrees).
      if (this.switching && now - this.switching.at > this.switchWindowMs()) {
        const to = this._nextAltSlot(this.switching.from); this.switching = null; this.activeSlot = to;
        if (this._puHeld) this._puHeld.trig = to;   // A56: ALT took the trigger off the heavy (the heavy keeps its charges)
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
    if (this._overshield || this._puHeld) this._puDeath();   // A56: an operator respawn of a LIVE player skips `_death`; the $PSET restore must precede the $SPAWN
    const down = this.frames.headset && this.frames.headset.down;
    if (down && down.stop) this._write([down.stop], 'down stop');   // §3.2: `$HLOOP,0,0,*` before $SPAWN — belt-and-braces, $SPAWN clears the loop on its own
    this._downRearmSent = false;   // §3.2: fresh rearm gate for the next life
    const sp = this._pickCue('respawned');   // A15.2: the spawn line rides in the revive write (one line, never two)
    const ps = this._pickFrame('pset_pool');   // A15.3: a fresh death scream for this life, written before $SPAWN
    if (ps.frame) this._psetNow = ps.frame;   // A56: ...and, at the preset shield max, it undoes an overshield's raised one
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
    const fill = this._spawnShieldFill();   // F348: a Shields life starts at full shield
    this._writeLife([...(ps.frame ? [ps.frame] : []), ...sir, ...revive, ...fill, ...(sp.frame ? [sp.frame] : [])], 'revive' + (flipped ? ' (turned)' : '') + (fill.length ? ` + shield pool ${this.maxShield}` : '') + this._lineTag(sp) + (ps.frame ? ` + scream ${ps.id}${ps.tag}` : '') + (sir.length ? ` + hit audio ${sir.length}r` : ''), life);
    this.hurtFired = false;
    this._pendingHurtWrite = false;
    // pl3 (2026-09-17): a swap or a heat reading from the last life must not follow the player into this one. An
    // operator respawn of a LIVE player skips `_death`, which is the only other place `switching` was cleared, so a
    // stale swap could flip the slot a second later, and a stale lockout reading kept OVERHEAT up. stage.py `_after_spawn` clears the same.
    this.switching = null; this.heatBySlot = {}; this._heatAt = {}; this._everHeated = {}; this._heatLock = null;
    this._holdAccuracyWrites('revive');   // the revive write owns `$AMMO` until the gun has answered it
    this._lastTeamRepaintAt = this.now();   // F68: as at spawn — the respawn flash is this life's first paint
    this._prevAmmo = {}; this._prevReserve = {}; this._shotAcct = {}; this.activeSlot = 0;   // both maps: a stun before the first shot of a NEW life must snapshot this life's reserve, not the last one's (polish review 2026-09-11)   // assumption (hardware-UNVERIFIED): a revive puts the gun back on slot 0
    this._accuracyOffset = 0; this._nativeAccUntil = 0; this._nativeAccWhy = null;   // the revive's `$SPAWN` clears every `$TMP`
    this._puRevive(revive);   // A56: a heavy held at the death is gone; slot 0 is re-equipped behind the revive burst
    this._recoilArm('revive');   // S42: a respawn resets to the weapon's ceiling
    this._poisonClear('respawn'); this._smokeClear('respawn'); this.gunAcc = null; this._accZeroAt = null; this._smokeHirAt = null; this._dotEcho = null; this._dotKill = null;   // S16/S53: a new life carries neither
    this._resetLifeLedger();   // S56: nor does the "what hit me" ledger
    this._shieldFillAt = fill.length ? this.now() : 0;   // F348: the pool is 0 until the gun answers the fill
    this.alive = true; this.hp = this.maxHp; this.armor = this.maxArmor; this.shield = 0; this.deadAt = 0; this.killedBy = null; this.downReason = null;
    this.poolSrc = 'model';        // R2-3: a fresh life, and again from config.health until the gun speaks
    this._prevHp = this.hp; this._prevArmor = this.armor; this._prevShield = this.shield;
    this._spawnAt = this.now(); this._gunLifeAt = this._spawnAt; this._armedThisLife = false;   // B5/F272: settle and silence clocks start with this life
    this._shotDueAt = null; this._noFirePulls = 0; this._dryPulls = 0;   // F208: a fresh life owes no shots; the RELOAD nag: and it starts loaded, so no dry spell is running
    // S29: a fresh life starts at shield 0 without the shield having BROKEN, so no heartbeat and no
    // refill in flight; the recharge delay runs from here, which is why a life's first fill lands
    // SHIELD_REGEN_DELAY_MS in and never inside the spawn write.
    this._shieldRegen = null; this._shieldDown = false; this._shieldLoopAt = 0; this._shieldGaveUp = false; this._shieldQuietAt = this.now();
    this._armAfterSpawn(false, kind);   // F209; 2026-09-19: the profile this revive used
    this._timedLifeAt = kind === 'timed' && stationId == null ? this.now() : null;   // a legacy bundle's station revive is not a timed one   // 2026-09-19: the spawn-kill window runs from a timed respawn
    this._gunTake();   // A11.7
    const protectMs = this._protectOwedMs();   // F289: sent at once, so MC knows of the window even if the phone dies inside it
    this.emitFact({ type: 'respawn', match_id: this.matchId, ...(resync ? { resync: true } : {}), ...(stationId != null ? { station: stationId } : {}), ...(operator ? { operator: true } : {}), ...(protectMs ? { protect_ms: protectMs } : {}) });   // A47: `operator` = MC's FORCE RESPAWN (scoring keeps the streak)
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
    this.ended = true; this._panicked = null; this.endAck = false; this._armPending = null; this._triggerPending = null; this._gunProbe = null; this._gunProbeRetryAt = 0; this._gunRecovery = null; this.gunLocked = null;   // F209/F272: never arm or keep a lock verdict for an ended match
    this.endedAt = this.now();   // the results screen's settle window runs from HERE, not from the result's arrival
    this._lightGen = (this._lightGen || 0) + 1;   // no delayed $GLED/$HLED/cue step from before teardown may land after it
    this._ann.clear(); this._gun.clear();         // nor a queued announcer line or banner, nor the old audio model
    this._pendingHurtWrite = false;   // review 2026-09-19: a queued low-health alert must not survive match end
    try { if (this.onEnd) this.onEnd(this.historyEntry()); } catch (_) { /* history is best-effort */ }
    // The tally that decides the match is the one sent AT the whistle: it is exempt from the A6.1 end freeze
    // and clamped on MC's side instead (`mc/API.md`), so send it before the phase leaves `live`.
    this._reportPossession(this.now(), true);
    if (this.matchId && !this.endedMatches.includes(this.matchId)) this.endedMatches.push(this.matchId);
    if (this.bleUp) this._writeTeardown('end', why); else { this.pendingTeardown = 'end'; this.log(`end (${why}) owed to the gun — link down`, 'le'); }
    this.spawned = false; this.alive = false; this.downReason = null; this.resync = null; this.reconciling = null; this.start = null; this._resyncRevive = false; this.reloading = null; this._reloadOutcome = null; this.held = {};
    this.stunned = null;   // F15: the end frames own the gun now
    this._poisonClear('match end'); this._smokeClear('match end');   // S16/S53: no life left to tick or to tell about
    this._life = this._freshLedger(); this._lastLife = null;   // S56: nor a "what hit me" ledger to carry into the next lobby
    this._recoil = null;   // S42: no more life to drive accuracy for
    this._puReset();       // A56: the end frames own the gun; no item survives the match
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
    this._nativeAccuracyHold('EMP fn-23', now + SMOKE_MS);
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
      // A56: a pickup slot is restored to the held heavy's count as it is NOW (0 for one not held), never the snapshot's.
      const pu = new Set(((this.config && this.config.powerups) || []).map(p => +p.slot)), h = this._puHeld;
      const cnt = (slot, mag, res) => !pu.has(+slot) ? [mag, res] : h && h.slot === +slot ? [h.left, PU_RESERVE] : [0, 0];
      this._writeMust(Object.entries(st.ammo).map(([slot, [mag, res]]) => { const [m, r] = cnt(slot, mag, res); return `$AMMO,${slot},${m},${r},1,*`; }), 'stun over: restore live ammo',
        () => this._lifeSeq === life && !this._standDown(['phase', 'ble', 'alive', 'reconciling', 'stunned']));
      this._holdAccuracyWrites('stun restore');
      this.moment = { kind: 'stun_over', at: this.now() };
      this._event('stun_over');
    }
    this.log(`stun over (${why})`, 'li');
    this._changed();
  }
  // ---------- S16: damage over time, on the node (spec/node.md §3.17) ----------
  /** The tick numbers for an IR protocol, from the bundle's game-wide `dot` table (MC keys it by the protocol the
   *  SHOOTER's `$WEAP` t3 puts on the wire; JSON keys are strings). Null for any other protocol, and for a bundle
   *  that predates S16. PURE. */
  _dotSpec(proto) {
    const tbl = this.frames && this.frames.dot;
    const d = tbl && !Number.isNaN(proto) ? tbl[String(proto)] : null;
    if (!d) return null;
    const per = Number(d.per_tick), tickMs = Number(d.tick_ms), durMs = Number(d.duration_ms);
    return per > 0 && tickMs > 0 && durMs >= tickMs ? { per, tickMs, durMs } : null;
  }
  /** A `$HIR` on a poison protocol (Tony 2026-09-18/19: every hit poisons). The FIRST hit starts the stack and plays
   *  `poisoned`; any later hit, from the same shooter or another, REFRESHES it to full duration and names the new
   *  applier (kill credit goes to the most recent one). Stacks never add, and a refresh keeps the tick cadence: under
   *  sustained fire a reset cadence would push the next tick out on every round and the poison would never tick. */
  _poisonHit(proto) {
    const spec = this._dotSpec(proto); if (!spec) return;
    if (this._standDown(['phase', 'spawned', 'bundle', 'alive', 'tutorial'])) return;
    const now = this.now();
    const by = { num: this.latch ? this.latch.shooter_num : 0, team: this.latch ? this.latch.shooter_team : 0 };
    const p = this.poison;
    if (p) {
      p.until = now + spec.durMs; p.by = by; p.proto = proto; p.per = spec.per; p.tickMs = spec.tickMs; p.durMs = spec.durMs;
      this.log(`☣ poison refreshed by #${by.num}: ${spec.durMs} ms from now`, 'li');
      this._changed(); return;
    }
    this.poison = { proto, per: spec.per, tickMs: spec.tickMs, durMs: spec.durMs, at: now, until: now + spec.durMs, nextAt: now + spec.tickMs, by, ticks: 0 };
    this._event('poisoned');   // A11: the gun plays nothing for the `$LIFE` ticks, so the node speaks for the poison
    this.log(`☣ poisoned by #${by.num}: ${spec.per} every ${spec.tickMs} ms for ${spec.durMs} ms`, 'le');
    this._changed();
  }
  /** The clock, from `tick()` while LIVE. One tick per call at most: a webview that stalled drops the ticks it
   *  missed rather than firing them in a burst. The stack ends straight after its last tick. */
  _poisonTick(now) {
    const p = this.poison; if (!p || now < p.nextAt) return;
    if (p.nextAt <= p.until && (now <= p.until || now - p.nextAt < p.tickMs)) this._poisonStrike(p, now);   // a clock that stalled past `until` fires nothing; the last tick is due exactly AT `until`, so a `tick()` up to one interval late still fires it
    if (this.poison !== p) return;   // the strike ended it (nothing does today; a guard for the next change)
    p.nextAt += p.tickMs;
    if (p.nextAt <= now) p.nextAt = now + p.tickMs;
    if (p.nextAt > p.until) this._poisonClear('expired');
  }
  /** ONE tick: a negative `$LIFE` on the OUTERMOST non-empty pool, shield, then armour, then health. A negative is
   *  per pool with no spill and floors at 0 (bench 2026-09-09), so the node walks the pools itself, and a tick that
   *  empties a pool loses its remainder. Mode 0 only, never a mode 1/2 set: those revive a dead gun (levers §16).
   *  The cue rides every tick except a lethal one, where the firmware's own death scream owns the speaker. */
  _poisonStrike(p, now) {
    if (this._standDown(['phase', 'spawned', 'bundle', 'ble', 'alive', 'reconciling', 'resync', 'tutorial'])) {
      this.log(`☣ poison tick skipped (${this._standDown(['phase', 'spawned', 'bundle', 'ble', 'alive', 'reconciling', 'resync', 'tutorial'])})`, 'li');
      return;
    }
    const n = p.per;
    const pool = this.shield > 0 ? 'shield' : this.armor > 0 ? 'armor' : 'health';
    const frame = pool === 'shield' ? `$LIFE,0,0,-${n},*` : pool === 'armor' ? `$LIFE,0,-${n},0,*` : `$LIFE,-${n},0,0,*`;
    const lethal = pool === 'health' && this.hp <= n;
    // The echo is matched on WHAT moved, not on timing alone: under sustained fire a `$HIR` lands between a tick
    // write and its `$HP`, or just before the write, so "no newer `$HIR`" misread both ways (review 2026-09-19).
    this._dotEcho = { at: now, pool, n };
    // Only a HEALTH tick can kill. An armour or shield tick must not claim a death that lands in the next 1.5 s.
    // `dmg`: what a lethal tick takes. The gun answers a lethal `$LIFE` with `$LCD`, never `$HP` (bench 2026-09-09), so
    // no echo books it; `_death` books it to the ledger instead (the death screen's final tick, S56).
    if (pool === 'health') this._dotKill = { at: now, num: p.by.num, team: p.by.team, dmg: Math.min(n, this.hp), booked: false };
    p.ticks++;
    this._write([frame], `poison tick ${p.ticks}: -${n} ${pool}${lethal ? ' (lethal)' : ''}`);
    if (!lethal) this._event('poison_tick');
    this._changed();
  }
  /** The stack ends: expiry, death, respawn, match end. A stack never survives a life (Tony, 2026-09-18). */
  _poisonClear(why) {
    if (!this.poison) return;
    this.poison = null;
    this.log(`☣ poison over (${why})`, 'li');
    this._changed();
  }

  // ---------- S56: "what hit me" -- per-life damage taken/dealt ledger (HUD information, no game rule) ----------
  /** A fresh per-life ledger: `taken`/`dealt` keyed by shooter_num / victim player_id, `shotGroups` so a
   *  dual-emitter pair's second word adds to the hit its first word already opened instead of booking a
   *  second one, `wsEverDown` (read by `dealtPartial`) and `startedAt`/`deathAt` (read by `_lifeForFact`,
   *  stamped on the same synced clock as every fact). */
  _freshLedger() {
    return { taken: new Map(), dealt: new Map(), shotGroups: new Map(), wsEverDown: this.wsState !== 'bound', startedAt: this.now(), deathAt: null,
      shots: 0, kills: 0, finalHit: null };   // death screen: rounds fired, kills MC confirmed, and the last hit booked
  }
  /** Reset at every new life: `_spawn` (go-live), `_revive` (timed/station/resync/operator), an infection
   *  flip (inside `_death`, right after the snapshot below), and `_endLocal` (match end). */
  _resetLifeLedger() { this._life = this._freshLedger(); }
  /** Book a `hit_taken`'s damage against its shooter. The SECOND word of a dual-emitter pair (`shotGroup`
   *  shared with the first -- see the pairing in `_onHp`) is the same physical shot, not a second hit: its
   *  damage is added to the row the first word opened, `hits` is left alone, and the weapon breakdown
   *  accumulates onto that same entry instead of opening a new one. `resolved` is `_resolveHitWeapon`'s
   *  return; an ambiguous or null resolution books under `weapon_id: null` (an "unclaimed" row), same as an
   *  unknown magnitude -- there is nothing more specific to say in either case. */
  _lifeBookHit(num, team, dmg, shotGroup, resolved, hit = {}) {
    if (!this._life) return;
    const wid = resolved && !resolved.ambiguous && resolved.weapon_id != null ? resolved.weapon_id : null;
    const wname = wid != null ? resolved.name : null;
    const ambiguous = !!(resolved && resolved.ambiguous);
    // Death screen: a catalogue match is a PICKUP (not the shooter's own kit), and an ambiguous row keeps its
    // candidates' names, keyed by the candidate SET so two different ambiguities from one source stay apart.
    const pickup = !!(resolved && resolved.source === 'catalog' && wid != null);
    const cands = ambiguous ? (resolved.candidates || []).slice().sort() : [];
    const candKey = cands.join('|');
    const names = cands.map(id => { const row = this.weaponRow(id); return (row && row.name) || id; });
    const groups = this._life.shotGroups;
    const prior = groups.get(shotGroup);
    if (prior) { prior.entry.dmg += dmg; prior.weapon.dmg += dmg; if (this._life.finalHit && this._life.finalHit.group === shotGroup) this._life.finalHit.dmg += dmg; return; }
    let entry = this._life.taken.get(num);
    if (!entry) { entry = { num, name: this.nameOf(num), teamKey: TEAM_KEY[team] || null, dmg: 0, hits: 0, weapons: [] }; this._life.taken.set(num, entry); }
    entry.dmg += dmg; entry.hits += 1;
    let weapon = entry.weapons.find(w => w.weapon_id === wid && w.ambiguous === ambiguous && (w.candKey || '') === candKey);
    if (!weapon) { weapon = { weapon_id: wid, name: wname, ambiguous, pickup, dmg: 0, ...(ambiguous ? { names, candKey } : {}) }; entry.weapons.push(weapon); }
    weapon.dmg += dmg;
    groups.set(shotGroup, { entry, weapon });
    this._life.finalHit = { num, dmg, group: shotGroup, sensor: hit.sensor != null ? hit.sensor : null, crit: !!hit.crit, dot: false,
      weapon: wid != null || ambiguous ? { name: wname, ambiguous, pickup, ...(ambiguous ? { names } : {}) } : null };
  }
  /** A poison/DOT tick's damage (the `$HP` that answers our own `$LIFE` write -- `dotEcho` in `_onHp`) counts
   *  against the poisoner the same as any other hit, but `_dotSpec`'s table carries no weapon reference for
   *  it -- there is nothing honest to name a breakdown row after. Left OUT of `weapons` rather than invented;
   *  only the source's total/hit count carry a tick's damage. (Judgement call: FOLLOWUPS can add a name once
   *  `frames.dot` carries a `weapon_id`, per `DotSpec` in the wire contract.) */
  _lifeBookDot(num, team, dmg) {
    if (!this._life || dmg <= 0) return;
    let entry = this._life.taken.get(num);
    if (!entry) { entry = { num, name: this.nameOf(num), teamKey: TEAM_KEY[team] || null, dmg: 0, hits: 0, ticks: 0, weapons: [] }; this._life.taken.set(num, entry); }
    entry.dmg += dmg; entry.ticks = (entry.ticks || 0) + 1;   // a tick is not a hit: the death screen counts hits
    this._life.finalHit = { num, dmg, group: null, sensor: null, crit: false, dot: true, weapon: null };   // a lethal tick is the final hit
  }
  /** Which per-life ledger a fact timestamped `t` belongs to: the running life, the one just finished (still
   *  open to a straggling MC relay, see `dealtPartial`), or neither -- an older life is gone, so its facts
   *  are dropped rather than misattributed. `t` is stamped on the engine's synced clock, the same one
   *  `_freshLedger`/`_death` stamp `startedAt`/`deathAt` on; no `t` at all books to the running life. */
  _lifeForFact(t) {
    if (t == null) return this._life;
    if (t >= this._life.startedAt) return this._life;
    if (this._lastLife && this._lastLife.deathAt != null && t >= this._lastLife.startedAt && t <= this._lastLife.deathAt) return this._lastLife;
    return null;
  }
  /** MC's best-effort relay of a hit WE landed (`feedback{kind:'hit'}`: `{victim, victim_num, victim_display,
   *  dmg, weapon_id?}`), forwarded from the victim's own `hit_taken` fact -- so it can arrive late, out of
   *  order, or never arrive at all, and is never waited on. `weapon_id` absent means MC could not resolve it
   *  either (the victim had no claim, or it was ambiguous): booked as an unclaimed row, same as `_lifeBookHit`. */
  _bookDealtHit(body, t) {
    if (!body || body.victim == null) return;
    const dmg = Number(body.dmg) || 0;
    if (dmg <= 0) return;
    const life = this._lifeForFact(t);
    if (!life) return;   // too old for this life or the one behind it -- nobody left to credit it to
    const weaponId = body.weapon_id != null ? body.weapon_id : null;
    const weaponName = weaponId != null ? (() => { const row = this.weaponRow(weaponId); return (row && row.name) || weaponId; })() : null;
    let entry = life.dealt.get(body.victim);
    if (!entry) { entry = { victim: body.victim, name: null, dmg: 0, hits: 0, weapons: [] }; life.dealt.set(body.victim, entry); }
    const name = (typeof body.victim_display === 'string' && body.victim_display) ? body.victim_display
      : (body.victim_num != null ? this.nameOf(body.victim_num) : null);
    if (name) entry.name = name;   // a later, better name replaces a null from an earlier num-only relay
    // A two-word weapon's shot reaches MC as TWO hit_taken facts (body word + headset word), so it is relayed twice.
    // Count it once: by the victim's `shot_group` when the relay carries it, else (a batched relay has none) by a
    // second relay for the same victim inside DUAL_RELAY_MS while this gun's active weapon is a two-word one.
    const sg = body.shot_group != null ? body.shot_group : null;
    const own = this.weaponRow(this._activeWeaponId());
    const sameShot = sg != null ? entry.lastGroup === sg
      : (t != null && entry.lastT != null && Math.abs(t - entry.lastT) <= DUAL_RELAY_MS && !!(own && own.dual_emitter));
    entry.dmg += dmg; if (!sameShot) entry.hits += 1;
    entry.lastGroup = sg; entry.lastT = t;
    let weapon = entry.weapons.find(w => w.weapon_id === weaponId);
    if (!weapon) { weapon = { weapon_id: weaponId, name: weaponName, ambiguous: false, dmg: 0 }; entry.weapons.push(weapon); }
    weapon.dmg += dmg;
  }
  /** The read-only view `state()` publishes: sorted arrays and totals off the live Maps above, computed fresh
   *  on every call (nothing else needs the sorted order, so nothing keeps it in sync). `finished` is true only
   *  for `_lastLife` -- the running life's `dealtPartial` never carries the death grace, only `wsEverDown`. */
  _ledgerSnapshot(life, finished) {
    if (!life) return { taken: [], dealt: [], takenTotal: 0, dealtTotal: 0, dealtPartial: false, shots: 0, kills: 0, aliveMs: 0, finalHit: null };
    const taken = [...life.taken.values()].map(e => ({ ...e, weapons: e.weapons.map(w => ({ ...w, ...(w.names ? { names: w.names.slice() } : {}) })) })).sort((a, b) => b.dmg - a.dmg);
    const dealt = [...life.dealt.values()].map(e => ({ ...e, weapons: e.weapons.map(w => ({ ...w })) })).sort((a, b) => b.dmg - a.dmg);
    const grace = finished && life.deathAt != null && (this.now() - life.deathAt) < DEALT_GRACE_MS;
    const fh = life.finalHit;
    return { taken, dealt, takenTotal: taken.reduce((s, e) => s + e.dmg, 0), dealtTotal: dealt.reduce((s, e) => s + e.dmg, 0), dealtPartial: !!(life.wsEverDown || grace),
      // death screen: rounds fired, kills MC confirmed (best-effort, like dealt), time alive, and the last hit taken
      shots: life.shots || 0, kills: life.kills || 0, aliveMs: Math.max(0, (life.deathAt != null ? life.deathAt : this.now()) - life.startedAt),
      finalHit: fh ? { ...fh, weapon: fh.weapon ? { ...fh.weapon, ...(fh.weapon.names ? { names: fh.weapon.names.slice() } : {}) } : null } : null };
  }

  // ---------- S53: the smoke tell (fn 23) ----------
  /** Every `$ALCD` that names the active slot feeds this. A DROP to 0 (from anything else, or from nothing yet this
   *  life) is half of a smoke landing. A report above 0 once a smoke is on means the gun has given accuracy back, so
   *  the tell ends with it. The recoil writer never writes 0, so a drop to 0 is never the node's own write. */
  _smokeObserve(acc, slot) {
    if (Number.isNaN(acc) || slot !== this.activeSlot) return;
    const prev = this.gunAcc; this.gunAcc = acc;
    const now = this.now();
    if (acc === 0 && prev !== 0) {
      this._accZeroAt = now;
      this._nativeAccuracyHold('possible fn-23', now + SMOKE_PAIR_MS);
      this._smokeCheck();
    }
    else if (acc > 0 && this.smoke && now - this.smoke.at > SMOKE_PAIR_MS) this._smokeClear(`the gun reports accuracy ${acc}`);
  }
  /** A `$HIR` and an accuracy drop to 0 within SMOKE_PAIR_MS of each other, in either order, is a smoke. The
   *  EMP (proto 8 under `config.stun`) is fn 23 too, but it has its own STUNNED takeover, so it is not a smoke. */
  _smokeCheck() {
    const a = this._accZeroAt, h = this._smokeHirAt;
    if (a == null || h == null || Math.abs(a - h) > SMOKE_PAIR_MS) return;
    this._accZeroAt = null; this._smokeHirAt = null;   // one pair, one smoke
    if (this._standDown(['phase', 'spawned', 'alive', 'tutorial', 'stunned'])) return;
    if (this.latch && this.latch.ir_proto === 8 && this.stunEnabled) return;
    const now = this.now();
    this._nativeAccuracyHold('smoke', now + SMOKE_MS);
    if (this.smoke) { this.smoke.until = now + SMOKE_MS; this._changed(); return; }
    this.smoke = { at: now, until: now + SMOKE_MS };
    this._event('smoked');   // A11 presentation hook: no-op until a profile carries a `smoked` cue
    this.log(`🌫 smoked: accuracy 0 for about ${SMOKE_MS / 1000} s`, 'le');
    this._changed();
  }
  _smokeClear(why) {
    if (!this.smoke) return;
    const smokeUntil = this.smoke.until;
    this.smoke = null;
    if (why === 'expired' || why.startsWith('the gun reports')) {
      // Another fn-23 owner may have landed after this smoke (for example EMP). Ending the tell may
      // release only its own deadline; a later native recovery must keep t4 protected.
      if (this._nativeAccUntil <= smokeUntil) { this._nativeAccUntil = 0; this._nativeAccWhy = null; }
      if (this._recoil && !this._recoil.disabled) this._recoil.dirty = true;
    }
    this.log(`smoke over (${why})`, 'li');
    this._changed();
  }
  /** S53/S55: the input to the HUD's ONE accuracy pill -- why the player cannot hit, and how long for.
   *  Smoke has priority over the built recoil reason; future flinch/stance mechanics can join the same shape.
   *  The HUD renders the reason it is handed and never guesses one. */
  _aimView(now) {
    if (this.smoke) return { reason: 'smoke', acc: this.gunAcc != null ? this.gunAcc : 0, leftMs: Math.max(0, this.smoke.until - now), totalMs: SMOKE_MS };
    const r = this._recoil;
    if (!r || !r.model || r.disabled || r.state === 'crisp') return null;
    return { reason: 'recoil', acc: r.value, leftMs: Math.max(0, r.settleMs - (now - r.lastShotAt)), totalMs: r.settleMs };
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
   *  account there directly and open the echo window, so neither a preceding `$WEAP` reset nor this restore
   *  can come back as fire. Accuracy no longer calls this; spawn/stun/resync and other ammo owners do. */
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
  // (native walk off) and this module drives absolute `$TMP` t4 from the shot stream the node already
  // watches (`_onAmmo`'s mag decrement). A t4 write changes real hit rate, survives `$WEAP`, and changes
  // neither magazine nor reserve; `$SPAWN` and `$CLEAR` reset it (bench 2026-09-18).
  //
  // F259 (Tony, at the bench 2026-09-18): recoil is a SHORT LADDER OF STATES, not a per-shot walk.
  // Accuracy is CRISP, then DEGRADED once the burst reaches `afterShots` rounds, then HEAVY once it
  // reaches `heavyAfter` -- Tony, after the first version ran on hardware: "maybe we can update it to do
  // 2 steps instead of 1? normal degraded and very degraded". The trigger going quiet for `settleMs`
  // puts it back to crisp in ONE step from wherever it got to, because the player releases once.
  //
  // ⚠ THE PROPERTY TO PROTECT: the number of writes is proportional to the number of STATE CHANGES and
  // never to the number of rounds. A burst of any length costs at most three short t4 writes -- two down
  // and one back -- where the old ladder cost about twenty `$WEAP` + `$AMMO` pairs. A third rung would
  // cost one more write a burst; a rung per round is the traffic bug.
  //
  // Both steps land DURING the burst, which is the point of recoil -- neither is deferred to the
  // trigger going quiet.
  //
  // Seam for stance/flinch (S42, not built here): a future stance module can move the threshold
  // `_recoilStep` reads from the motion sensor; a future flinch module can read `this._recoil.value`
  // (today's live accuracy) to decide how hard to jolt. Neither touches the writer or the verify/retry
  // loop below.
  //
  // S54 (2026-09-23), BENCH-PROVISIONAL: `_onButton` also reads the trigger's own `$BUT,0,0` release
  // edge, but ONLY while the weapon is still CRISP -- a burst that never reached `afterShots` is cleared
  // the moment the trigger comes up, rather than waiting out `settleMs` for a round count that was never
  // going anywhere. This costs no write; the state has not changed. A DEGRADED or HEAVY weapon still
  // recovers exactly as above: on the settle clock, one write, never on a button edge, because a release
  // is evidence this pull is over, not that the player has stopped shooting for good.
  get recoilEnabled() { return !this.config || this.config.recoil !== false; }   // S42: default ON -- only an explicit `false` turns it off
  /** {weapon_id} for the ACTIVE slot, straight off the loadout -- the same lookup `_reloadPulled` and
   *  `weaponName` already use. */
  _activeWeaponId() {
    const ws = this.player && this.player.loadout && this.player.loadout.weapons;
    const w = ws && (ws[this.activeSlot] || ws[0]);
    return w ? w.weapon_id : null;
  }
  /** docs/announcer.md "The three lanes" (F351/F352): what the HUD shows at the moment each event ARRIVES, apart from
   *  the announcer queue, which still says one line at a time. `hero` = my kills in a spree (a kill while the hero is
   *  still up extends it); `obj` = the OBJECTIVE badges, one per key (`lead`, `hill`), each up until the next one of
   *  its key replaces it; `feed` = downs, pickups and every other alert, newest first. Presentation only: nothing here writes
   *  the gun, says a line or touches the score. */
  _lanesOf() { return this._lanes || (this._lanes = { hero: null, obj: {}, feed: [] }); }
  /** When the hero leaves: LANE_HERO_MS after the last kill, or later while that kill's own announcer slot is on air. */
  _heroUntil(now = this.now()) {
    const h = this._lanes && this._lanes.hero; if (!h) return 0;
    const a = this._ann.current, onAir = a && now < a.until && (a.kind === 'kill_confirmed' || a.kind === 'medal') && a.startedAt >= h.id ? a.until : 0;
    return Math.max(h.lastAt + LANE_HERO_MS, onAir);
  }
  _laneKill(k) {
    const L = this._lanesOf(), now = this.now();
    if (!L.hero || now >= this._heroUntil(now)) L.hero = { id: now, kills: [], lastAt: now };
    const row = { victim: k.victim || null, team: k.team || null, medals: (k.medals || []).slice(), src: k.src, at: now };
    L.hero = { ...L.hero, kills: [...L.hero.kills, row], lastAt: now };
    this._changed(); return row;
  }
  _laneUpdate(row, patch) { if (!row || !this._lanes || !this._lanes.hero) return; Object.assign(row, patch); this._lanes.hero = { ...this._lanes.hero }; this._changed(); }
  /** The victim's own DOWN word names a hero row (only when MC has not named it) or a feed row, in place. */
  _laneName(row, name) {
    if (!row || !name || !this._lanes) return;
    if (this._lanes.hero && this._lanes.hero.kills.includes(row)) { if (!row.victim) this._laneUpdate(row, { victim: name }); return; }
    if (this._lanes.feed.includes(row)) { row.name = name; this._lanes.feed = [...this._lanes.feed]; this._changed(); }
  }
  _laneObj(key, v) { const L = this._lanesOf(); L.obj = { ...L.obj, [key]: { ...v, id: (this._laneSeq = (this._laneSeq || 0) + 1), at: this.now() } }; this._changed(); }
  _laneFeed(v) { const L = this._lanesOf(), row = { ...v, id: (this._laneSeq = (this._laneSeq || 0) + 1), at: this.now() };   // `id`: the HUD's key (two rows can share a ms)
    L.feed = [row, ...L.feed].slice(0, LANE_FEED_MAX); this._changed(); return row; }
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
  /** The three-state shape, read from the catalogue ROW (`weaponRow(id)`'s shape: the `recoil` block
   *  plus `dmg`, top-level or nested under `stats` -- the wire ships it under `stats`, test catalogues
   *  often ship it flat, so both are read).
   *
   *  S54/F268/F280 (Tony, 2026-09-23): the rungs are keyed off ROUNDS PER TRIGGER PULL, scaled by
   *  calibre, not off the ladder's own depth or the magazine size. A row's `crisp`/`degraded`/`heavy`/
   *  `after_shots`/`after_heavy`/`settle_ms` fields still win outright when the catalogue declares them
   *  (S54); a row that omits any of them derives it here:
   *    crisp       the ladder's CEILING (`r.ceiling` if `r.crisp` is absent) -- where every weapon starts.
   *    heavy       the ladder's FLOOR (`r.floor` if `r.heavy` is absent) -- where it bottoms out.
   *    degraded    halfway between the two, rounded DOWN (a 100/85 pair reads as 92).
   *    after_shots a reference weapon doing `RECOIL_REF_DMG` a hit fires `RECOIL_CLEAN_ROUNDS` (5) clean
   *                rounds and degrades on the next one; a weapon with a different `dmg` scales the clean
   *                count by `k = RECOIL_REF_DMG / dmg` (bigger rounds kick in sooner), floored at 2 clean
   *                rounds so no weapon degrades on its opening shot.
   *    after_heavy `RECOIL_HEAVY_EXTRA_ROUNDS` (3) more clean rounds beyond that, scaled by the same `k`,
   *                then heavy on the next one. Floored at `after_shots + 1`, so the second rung can never
   *                land before or beside the first.
   *    settle_ms   RECOIL_SETTLE_MIN_MS or `recover_ms`, whichever is longer. See that constant: a shorter
   *                floor would let a gap between two rounds read as a player lowering the weapon.
   *
   *  A weapon that cannot degrade (floor == ceiling, most of the catalogue, and every one-press burst
   *  trigger such as the Burst Rifle, which cannot be held in full auto) arms NOTHING: there is no state
   *  for it to change, so there is no write for it to make. Returns null for those.
   *
   *  ⚠ An `after_heavy` at or below `after_shots` is not rejected: the burst that crosses the first
   *  threshold crosses the second in the same breath, so the weapon drops straight to `heavy` in ONE
   *  write and `degraded` never appears. That is coherent, it costs no extra write, and it is the
   *  catalogue's choice to make. PURE. */
  _recoilProfile(row) {
    const r = row && row.recoil;
    if (!r) return null;
    const crisp = +(r.crisp != null ? r.crisp : r.ceiling);
    const bottom = +(r.heavy != null ? r.heavy : r.floor);   // the ladder's floor: `heavy` once the catalogue declares it
    if (!(crisp > 0) || !(bottom < crisp)) return null;
    const stats = row.stats || {};
    const dmg = +((stats.dmg != null ? stats.dmg : row.dmg)) || 0;
    const k = dmg > 0 ? RECOIL_REF_DMG / dmg : 1;
    const clean = Math.max(2, Math.round(RECOIL_CLEAN_ROUNDS * k));   // clean rounds before the burst earns a rung
    const derivedAfter = clean + 1;                                    // the round that DOES earn one
    const after = Math.round(+(r.after_shots != null ? r.after_shots : derivedAfter));
    const settle = Math.max(RECOIL_SETTLE_MIN_MS, +(r.settle_ms != null ? r.settle_ms : r.recover_ms) || 0);
    if (!(after > 0)) return null;
    const mid = Math.round(+(r.degraded != null ? r.degraded : Math.floor((crisp + bottom) / 2)));
    // The two rungs must be DISTINCT VALUES, or the second write wastes a BLE frame sending the value the
    // gun already holds. A ladder too short to split in two collapses back to one step.
    const two = mid > bottom && mid < crisp;
    const extra = Math.round(RECOIL_HEAVY_EXTRA_ROUNDS * k);
    const derivedHeavyAfter = Math.max(after + 1, clean + extra + 1);
    return { crisp, degraded: two ? mid : bottom, afterShots: after, settleMs: settle,
      heavy: two ? bottom : null,
      heavyAfter: two ? Math.round(+(r.after_heavy != null ? r.after_heavy : derivedHeavyAfter)) : 0 };
  }
  /** (Re)arm the accuracy model for the ACTIVE weapon: spawn, revive, a confirmed weapon swap and the
   *  reconcile re-arm all call this, because each one is a point where the gun's OWN live accuracy is known
   *  to be (or is assumed to be, for an off-slot swap -- a bench gap, not a design one) back at that
   *  weapon's CRISP value, with no burst behind it. A weapon with no usable `recoil` profile, or
   *  `config.recoil === false`, arms nothing. */
  _recoilArm(why) {
    const priorOffset = this._accuracyOffset;
    this._recoil = null;
    const id = this._activeWeaponId(); const row = id && this.weaponRow(id);
    const p = this.recoilEnabled ? this._recoilProfile(row) : null;
    const baked = this._headAccuracy(this.activeSlot);
    const base = baked != null ? baked : 100;
    const target = p ? p.crisp : base;
    const offset = target - base;
    // t4 survives `$WEAP`, so moving from a recoiling weapon to a flat/recoil-off one still needs an
    // owner long enough to clear the inherited modifier. With nothing inherited there is no model and
    // no write, preserving the cheap path for the catalogue's many flat weapons.
    const force = why === 'reconcile';   // an app restart cannot know the durable t4 already on the gun
    if (!p && !force && priorOffset === offset) return;
    this._recoil = { weaponId: id, slot: this.activeSlot, crisp: target, degraded: p ? p.degraded : target,
      afterShots: p ? p.afterShots : 0, settleMs: p ? p.settleMs : RECOIL_SETTLE_MIN_MS,
      heavy: p ? p.heavy : null, heavyAfter: p ? p.heavyAfter : 0, model: !!p, base,
      value: target, state: 'crisp', burst: 0, dirty: force || priorOffset !== offset,
      lastShotAt: 0, lastWriteAt: 0, lastWriteValue: null, pendingWriteAt: 0,
      lastSeenAcc: null, retried: false, disabled: false, giveUp: false };
    // The gun is at whatever t21 the COMPILED frame baked in, which is 100 on every weapon today: compile.py
    // never writes t21/t22, because every captured frame ships t21 == t22 == 100 (native walk off, F230). So
    // arming asserts nothing and writes nothing. The moment the catalogue declares a `crisp` that is not the
    // frame's own value, the gun and this model would disagree for a whole burst before anything corrected
    // it -- so compare, and mark dirty when they differ. Costs one write a life in that case and nothing today.
    if (p && baked != null && baked !== this._recoil.crisp) {
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
   *  bounding BLE traffic without touching the magazine. */
  _recoilStep(n) {
    const r = this._recoil; if (!r || !r.model || r.disabled || n <= 0) return;
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
    // Flush from HERE rather than waiting for the next tick. The `$ALCD` that booked this round is the
    // freshest accuracy evidence available, and `_recoilFlush` still applies every ordering guard.
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
    if (r.model && !r.disabled && now - r.lastShotAt >= r.settleMs) {
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
    if (now < this._nativeAccUntil) return;   // S55: native fn-23 smoke/EMP owns t4; never cancel it early
    if (r.pendingWriteAt) {
      if (now - r.pendingWriteAt < ACC_VERIFY_GRACE_MS) return;
      this._recoilVerify(now);
    }
    if (r.disabled || !r.dirty) return;
    // F259 step 2: the minimum gap throttles a RE-SEND (a retry, a re-assertion after a hold), never a state
    // change. See ACC_WRITE_MIN_GAP_MS: the state machine bounds a burst to three writes by itself.
    if (r.value === r.lastWriteValue && now - r.lastWriteAt < ACC_WRITE_MIN_GAP_MS) return;
    // The writer's stand-down set (`STAND_DOWN`), unchanged by the 2026-09-17 maint pass:
    //   reconciling / resync  §3.10: the node infers nothing in these windows, and both re-arm the gun themselves.
    //   switching / reloading the gun is mid-takeover; keep one conservative ordering rule for gun writes.
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
   *  mismatch retries once; a second gives up for the rest of the life: restore crisp t4 and stop
   *  driving accuracy, logged so a field session can see it. */
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
  /** Write the absolute `$TMP` t4 modifier against the active weapon's compiled base accuracy. Every
   *  other modifier token stays blank. Bench 2026-09-18 proved this changes real hit rate, does not touch
   *  magazine/reserve, survives `$WEAP`, has no self-decay, and is cleared by `$SPAWN`. */
  _recoilWrite(now) {
    const r = this._recoil; if (!r) return;
    r.dirty = false;
    const modifier = Math.round(r.value - r.base);
    const frame = `$TMP,,,,${modifier},,,,,,,,*`;   // t4 only; twelve commas keep every other modifier blank
    this._write([frame], `accuracy ${r.state} ${r.value}/${r.base}${r.retried ? ' (retry)' : ''}`);
    this._accuracyOffset = modifier;
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
    if (this.now() < this._nativeAccUntil) return;
    if (r.pendingWriteAt && acc === r.lastWriteValue) { r.pendingWriteAt = 0; r.retried = false; }
  }

  /** S55: native fn-23 smoke/EMP temporarily owns the same absolute modifier. Cancel an open verify,
   *  keep the latest recoil target dirty, and reassert it only after the native recovery window. */
  _nativeAccuracyHold(why, until) {
    if (until >= this._nativeAccUntil) { this._nativeAccUntil = until; this._nativeAccWhy = why; }
    const r = this._recoil;
    if (r) { r.pendingWriteAt = 0; r.retried = false; if (!r.disabled) r.dirty = true; }
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
    this._pendingHurtWrite = false;   // review 2026-09-19: panic/end teardown must cancel a queued low-health alert too
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
        if (this.phase === 'live' || this.phase === 'armed' || this.phase === 'lobby'
          || (this.phase === 'idle' && (['live', 'armed', 'lobby'].includes(this._pendingPhase)
            || (this.gunLocked && this.gunLocked.match_id === this.matchId)))) this._endLocal(cmd);
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
        this._ann.clear(); this._gun.clear();
        this._gunProbe = null; this._gunProbeRetryAt = 0; this._gunRecovery = null; this.gunLocked = null; this.downReason = null; this._pendingPhase = null;
        if (this.bleUp) this._writeTeardown('panic', 'control'); else { this.pendingTeardown = 'panic'; this.log('panic owed to the gun — link down', 'le'); }
        this._resyncRevive = false;   // a panic does NOT retire the match_id — a NEWER start (higher seq) is still accepted later
        // …but a WS welcome re-delivering the SAME schedule must not re-arm a gun the operator just cleared.
        this._panicked = this.start ? { match_id: this.start.match_id, seq: this.start.seq } : null;
        this.spawned = false; this.alive = false; this.start = null; this.resync = null; this.reconciling = null; this.ready = false;
        if (this.phase !== 'idle' && this.phase !== 'connected' && this.phase !== 'kitted') this._set('kitted');
        else this._changed();   // a cold-restored IDLE latch still owes its clear to storage and the HUD
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
    // F287: RESYNC is not successful merely because its `$LIFE` probe reached the wire. Its result is
    // emitted when that probe answers and the burst starts, or false on dead/no-answer/cancellation.
    if (cmd === 'resync' && !why) return;   // its continuation (including a synchronous write failure) owns the result
    this._operatorResult(cmd, why);
  }
  _operatorResult(cmd, why, context = null) {
    // pl3 (2026-09-17): MC learns the outcome through the persisted fact path, so an operator press that did
    // nothing is visible on the board and not only in the phone's log. `why` is the refusal the log shows.
    this.emitFact({ type: 'operator_result', cmd, ok: !why, ...(why ? { why } : {}),
      match_id: context ? context.matchId : this.matchId,
      player_id: context ? context.playerId : (this.player && this.player.player_id != null ? this.player.player_id : null) });
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
    if (this._operatorResyncPending) { this.log('operator resync ignored — already waiting for the gun', 'li'); return 'already waiting for the gun'; }
    // F287: the operator is here because the gun is suspect. Send the safe dead-gun probe ALONE and keep
    // the entire re-arm burst behind the `$HP` answer. No answer means no write; a `$HP,0` takes the normal
    // death path and likewise receives nothing.
    const probe = (this._probeSeq || 0) + 1;
    const pending = this._operatorResyncPending = { probe, queuedAt: this.now(), startedAt: null, sentAt: null, answer: null,
      life: this._lifeSeq, matchId: this.matchId,
      playerId: this.player && this.player.player_id != null ? this.player.player_id : null };
    this._cure = null; this.cure = null;   // the operator's explicit read owns this one probe/reply window
    this._pollAt = this.now();       // this read is also this cadence's divergence poll
    this._probedLife = this._lifeSeq || 0;   // and it is this life's read-back; do not ask again on the timeout tick
    const written = this._askGun('operator resync: read the gun first',
      { deferClock: true, onStart: () => this._operatorResyncProbeStarted(pending) });
    const settled = ok => this._operatorResyncProbeSent(pending, ok);
    if (written && typeof written.then === 'function') Promise.resolve(written).then(settled)
      .catch(e => this._operatorResyncProbeSent(pending, false, e));
    else { this._operatorResyncProbeStarted(pending); settled(written); }
    return null;
  }
  _operatorResyncProbeStarted(p) {
    if (this._operatorResyncPending !== p || p.startedAt != null) return;
    p.startedAt = this.now();
    this._queryAt = p.startedAt; this._probeSeen = {};
  }
  _operatorResyncProbeSent(p, ok, error = null) {
    if (this._operatorResyncPending !== p) return;
    if (ok === false) {
      this._operatorResyncPending = null;
      const why = error ? `probe write failed: ${error && error.message || error}` : 'probe write failed';
      this.log(`operator resync stopped — ${why}; no re-arm burst sent`, 'le');
      this._operatorResult('resync', why, p); this._changed();
      return;
    }
    this._operatorResyncProbeStarted(p); p.sentAt = this.now();
    if (!p.answer) { this._queryAt = p.sentAt; this._probeSeen = {}; }
    // BrxLink can deliver the immediate `$HP` before its write Promise settles. Keep that proof, then
    // consume it now that the serialized batch is known to have completed.
    if (p.answer) this._operatorResyncAnswer('HP', p.answer, true);
  }
  _operatorResyncWrite(p) {
    if (!p || this._lifeSeq !== p.life || this._standDown(['phase', 'ble', 'alive', 'reconciling', 'resync', 'stunned'])) {
      this.log('operator resync stopped — the game moved on before the gun answer could be used', 'li');
      if (p) this._operatorResult('resync', 'the game moved on before the gun answered', p);
      return;
    }
    const life = p.life;
    this._writeLost = null;   // the live reply is the evidence that retires a lost spawn/revive write
    const tid = this._liveTid();
    const ammo = Object.entries(this._liveAmmo()).map(([slot, [mag, res]]) => `$AMMO,${slot},${mag},${res},1,*`);
    const bmap = ((this.frames && this.frames.revive) || []).find(f => typeof f === 'string' && f.startsWith('$BMAP,0,0')) || '$BMAP,0,0,,,,,*';
    // Review 2026-09-19: a timed respawn's weapon delay holds the trigger with `$BMAP,0,98` (`_triggerPending`).
    // RESYNC must not overwrite that with `$BMAP,0,0` (weapon systems live) mid-hold -- `_triggerLive` writes
    // the real one once the delay is over. `$TID`/`$AMMO` are independent of the hold and still go out.
    if (this._triggerPending) this.log('operator resync: weapon delay still holds the trigger -- $BMAP,0,0 held back', 'li');
    this._writeMust([...(tid != null ? [`$TID,${tid},*`] : []), ...ammo, ...(this._triggerPending ? [] : [bmap])], 'operator resync',
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
    this._operatorResult('resync', null, p);
    this._changed();
  }
  _operatorResyncAnswer(kind, t = null, solicited = false) {
    const p = this._operatorResyncPending;
    if (!p || kind !== 'HP' || p.probe !== this._probeSeq) return;
    if (p.sentAt == null) {
      if (p.startedAt != null) p.answer = t;   // during THIS probe's send; pre-start HP belongs to older traffic
      return;
    }
    if (this.now() - p.sentAt > QUERY_REPLY_MS) { this._operatorResyncTick(this.now()); return; }
    this._operatorResyncPending = null;
    const answerHp = t && t[1] !== undefined ? (+t[1] || 0) : this.hp;
    if (!this.alive || answerHp <= 0) {
      this.log('operator resync stopped — the gun answered dead; no re-arm burst sent', 'le');
      this._operatorResult('resync', 'the gun answered dead', p);
      this._changed();
      return;
    }
    this._operatorResyncWrite(p);
  }
  _operatorResyncTick(now) {
    const p = this._operatorResyncPending;
    if (!p) return;
    if (this._lifeSeq !== p.life || this._standDown(['phase', 'ble', 'alive', 'reconciling', 'resync', 'stunned'])) {
      this._operatorResyncPending = null;
      this.log('operator resync stopped — the game moved on before the gun answered', 'li');
      this._operatorResult('resync', 'the game moved on before the gun answered', p);
      this._changed();
      return;
    }
    if (p.sentAt == null) {
      if (now - p.queuedAt <= OPERATOR_PROBE_WRITE_MS) return;
      this._operatorResyncPending = null;
      this.log('operator resync stopped — probe write did not finish; no re-arm burst sent', 'le');
      this._operatorResult('resync', 'probe write did not finish', p); this._changed();
      return;
    }
    if (now - p.sentAt <= QUERY_REPLY_MS) return;
    this._operatorResyncPending = null;
    this.log('operator resync stopped — no answer from the gun; no re-arm burst sent', 'le');
    this._operatorResult('resync', 'the gun did not answer', p);
    this._changed();
  }

  // ---------- feedback (§3.6) ----------
  feedback(body, envT) {
    const t = body.t != null ? body.t : envT;
    // S56 "what hit me": MC's relay of a hit WE landed is a stats-only message -- no cue, no LED, no moment.
    // The victim's OWN phone already played the hit/kill feedback for it; this is purely the ledger `state()`
    // publishes, so it returns here rather than falling into the generic cue/SFLASH write below. It runs BEFORE
    // the age gate: that gate stops a stale kill SOUND, and a victim that flushes its facts late still landed the hit
    // (`_lifeForFact` decides which life it belongs to).
    if (body.kind === 'hit') { this._bookDealtHit(body, t); this._changed(); return; }
    if (body.kind === 'kill') { const life = this._lifeForFact(t); if (life) life.kills += 1; }   // death screen: booked before the age gate, like a hit
    if (t != null && this.now() - t > C.FEEDBACK_MAX_AGE_MS) { this.log('feedback too old — ignored', 'li'); return; }
    const pick = body.cue ? { frame: body.cue, tag: '' } : this._pickCue(body.kind);   // A15: a random take from the pool (kill confirms + taunts)
    const cue = pick.frame;
    this._write([SFLASH], `feedback ${body.kind}`);   // the sight flash is the gun's light, not the announcer: it lands at once
    // A11.4 Halo-style medals: a kill can carry several ("killtacular" + "killing_spree"); each plays
    // its cue from THIS node's bundle, back to back, and replaces the plain kill line. A cue that is
    // "" is deliberately mute (announcer off) and is skipped; a missing one is skipped too.
    const medalCues = (Array.isArray(body.medals) ? body.medals : [])
      .map(m => ({ m, f: this.frames && this.frames.cues && this.frames.cues[m] })).filter(x => x.f);
    const lg = (this._lightGen = this._lightGen || 0);   // teardown snapshot: neither a medal line nor the feedback cue may land after the match ended
    // S57 (docs/ir-callouts.md): kill confirm, first to arrive, once. An IR DOWN_BY naming us plays the kill
    // cue over `_irKillConfirmed`, and it usually beats MC here (IR is local, this is a BLE round trip). When it
    // already has, this plain kill line is redundant and is skipped; medal cues still play regardless, because
    // they carry information the IR word does not, and the score below moves exactly as it always did -- only
    // MC's feedback ever touches it. The two channels pair ONE-TO-ONE (`_takeKillMatch`), never by a timestamp.
    // S57: MC names the victim's team by its team_id; resolve it to the tid through this match's own teams, since the IR
    // word names it by tid (a team_id is a free config string, not always the colour key TEAM_KEY assumes)
    const vtRow = body.victim_team != null ? ((this.config && this.config.teams) || []).find(x => x.team_id === body.victim_team) : null;
    const vt = vtRow && Number.isInteger(vtRow.tid) ? vtRow.tid : null;
    const irMatch = body.kind === 'kill' ? this._takeKillMatch(this._irKillOpen, vt, this.now()) : null;
    const irAlreadyConfirmed = !!irMatch;
    let laneRow = null;
    if (body.kind === 'kill') {   // the HERO lane: MC names the IR word's row in place, or makes its own
      if (irMatch && irMatch.lane) this._laneUpdate(laneRow = irMatch.lane, { victim: this.victimName(body), medals: Array.isArray(body.medals) ? body.medals.slice() : [], src: 'IR 15 · MC' });
      else laneRow = this._laneKill({ victim: this.victimName(body), team: body.victim_team, medals: Array.isArray(body.medals) ? body.medals : [], src: 'MC' });
    }
    let mcEntry = null;
    if (body.kind === 'kill') {
      if (this.score) this.score = { ...this.score, kills: (this.score.kills || 0) + 1 };
      else this.score = { kills: 1 };
      this.scoreAt = this.now();
      if (!irAlreadyConfirmed) this._mcKillOpen.push(mcEntry = { at: this.now(), team: vt, lane: laneRow });   // an unmatched MC confirm waits for its IR twin
    } else if (!cue) { this._eventLeds(body.kind); this._changed(); return; }
    // docs/announcer.md: the lines, the LED burst and the kill card are ONE announcer item (`kill_confirmed`, the top
    // priority), so a lead change or anything else MC sends with this kill waits for it instead of playing on top.
    // The matched IR confirm's own item: an IR confirm that is dropped unplayed leaves the pairing list (`onDrop`), so a
    // match here was either heard already or is still waiting, never lost.
    const ir = irMatch && irMatch.item && (irMatch.item === this._ann.current || this._ann.queue.includes(irMatch.item)) ? irMatch.item : null;
    let irAt = irMatch && irMatch.item && irMatch.item.startedAt != null ? irMatch.item.startedAt : null, plain = !!cue && !irAlreadyConfirmed;
    if (ir && ir !== this._ann.current) {
      // Its IR twin is still WAITING: it was never heard or shown, so MC's item replaces it and speaks the kill itself.
      this._ann.remove(ir); irAt = null; plain = !!cue;
      this.log('announcer: MC named the kill before its queued IR confirm played: one item, MC\'s', 'li');
    } else if (ir && !medalCues.length) {
      // The IR confirm is ON AIR: MC's named card replaces its card in place (no second line, no second flash), and
      // holds the slot for the card's own hold. Nothing new to say, so nothing waits.
      this._card({ kind: 'kill', at: this.now(), data: { victim_team: body.victim_team, victim: this.victimName(body), medals: [], ir_paired: true, ir_at: irAt } });
      this._ann.extend(ir, this.now() + KILL_CARD_MS);
      this._eventLeds(body.kind);
      this._changed();
      return;
    } else if (ir) this._ann.release(ir);   // on air with medals to say: they follow the IR line the moment it ends
    if (!plain && !medalCues.length && body.kind !== 'kill') { this._changed(); return; }
    if (cue && !plain && !medalCues.length) this.log('feedback: kill line skipped: the IR confirm for this kill already said it (S57)', 'li');
    const isKill = body.kind === 'kill';
    let medals = medalCues, medalList = Array.isArray(body.medals) ? body.medals.slice() : [];
    if (isKill) {
      // Round 2 M1, a spree: older MC kills still WAITING fold into this one item, so the queue never stacks a line per
      // kill. The newest medal line only (a triple supersedes the double), the newest card. FIRST BLOOD is never folded:
      // it is said first, then the newest tier (it is a different fact, and the `medal` rank makes it wait behind a lead
      // change, so a second kill often lands while it waits). The card lists every folded medal. The folded items leave
      // WITHOUT `onDrop`: their pairing entries stay, marked as said, so their IR twins do not speak for them either.
      const waiting = this._ann.queue.filter(q => (q.kind === 'kill_confirmed' || q.kind === 'medal') && q.src === 'mc');
      if (waiting.length) {
        waiting.forEach(q => { this._ann.remove(q); if (q.entry) q.entry.killLine = true; });
        const folded = waiting.flatMap(q => q.medals || []);
        // HUD QA R2-11: fold only WITHIN a medal kind. The newest multi-kill and the newest streak are different facts
        // (KILLTROCITY is not KILLING SPREE), so each keeps its own line.
        const all = [...folded, ...medals], newest = kind => all.filter(x => MEDAL_KIND[x.m] === kind).pop();
        medals = [all.find(x => x.m === 'first_blood'), newest('multi'), newest('streak')].filter(Boolean);
        medalList = [...new Set([...waiting.flatMap(q => q.medalList || []), ...medalList])];
        this.log(`announcer: ${waiting.length} waiting kill confirm(s) folded into this one (${medals.length ? medals[0].m : 'the plain line'})`, 'li');
      }
    }
    const lines = medals.length ? medals.map(x => ({ f: x.f, why: `medal ${x.m}` })) : plain ? [{ f: cue, why: `feedback cue ${body.kind}${pick.tag}`, kill: true }] : [];
    // C1 (Tony's match 2026-09-24): an IR twin skips its own kill line only when THIS item really says one. A medal
    // replaces MC's plain line, so a medal-only item leaves the confirmation to the IR word.
    if (mcEntry) mcEntry.killLine = lines.some(x => x.kill);
    const cm = this.frames && this.frames.cue_ms;
    // Round 3 M4: each line starts when the one before it has ENDED (plus ANNOUNCE_GAP_MS), never on a fixed 2 s grid: a
    // 2.5 s medal on a 2 s grid queued in the gun past the item's slot, and the next kill's stop cut its tail. So the
    // item's sound is the SUM of its clips and the gaps actually used.
    const lens = lines.map((x, i) => clipMs(x.f, cm ? cm[medals.length ? medals[i].m : body.kind] : undefined));
    const at = []; lens.reduce((t, ms, i) => { at[i] = t; return t + ms + ANNOUNCE_GAP_MS; }, 120);
    const audioMs = lines.length ? at[lines.length - 1] + lens[lines.length - 1] : 0;
    // docs/announcer.md: once this kill's line was said (its IR twin started and was not muted), what is left to say is
    // medal lines only. They rank `medal`, after a lead change, so the lead MC sent with this kill is not held behind them.
    const killSaid = isKill && medals.length > 0 && irAt != null && !(irMatch && irMatch.item && irMatch.item.muted);
    const item = this._ann.push({ kind: isKill ? (killSaid ? 'medal' : 'kill_confirmed') : 'alert', src: 'mc', key: isKill ? null : `fb:${body.kind}`, audioMs, entry: mcEntry, medals, medalList,
      bannerMs: isKill ? Math.max(KILL_CARD_MS, audioMs) : 0,
      ok: () => this._lightGen === lg,
      onDrop: () => { if (mcEntry) this._mcKillOpen = this._mcKillOpen.filter(x => x !== mcEntry); },   // unheard: no IR twin may pair with it
      play: ({ muted }) => {
        // hardware-proven gap (seed): the flash, then the line; medal lines back to back, MEDAL_GAP_MS apart
        if (muted && mcEntry) mcEntry.killLine = false;   // said nothing after all: a later IR twin speaks for itself
        // My own kill is must-hear, every line of it (round 3 M3): each medal line goes out after the one before it has
        // ended, so its flush finds nothing of ours to cut, and under the shield loop each gets its own stop.
        if (!muted) lines.forEach((x, i) => this.delay(at[i], () => { if (this._lightGen === lg) this._sayMust(x.f, x.why); }));
        if (medals.length) this.medals = medalList;
        this._eventLeds(medals.length ? medals[0].m : body.kind);   // A11.8: the headset's small LED flash (+ any burst) for the top medal
        // `ir_paired` (presentation only): an IR KILL CONFIRMED card already flashed for this kill, so the HUD must not
        // flash and buzz a second time for it (QA polish round 2). `ir_at` is that card's own `callout.at`, so the HUD
        // matches the exact card and an IR card whose MC twin never came can never stand in for it.
        if (isKill) this._card({ kind: 'kill', at: this.now(), data: { victim_team: body.victim_team, victim: this.victimName(body), medals: medalList, ir_paired: irAt != null, ir_at: irAt } });
        this._changed();
      } });
    if (mcEntry) mcEntry.item = item;
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
    // docs/announcer.md: the cue, the LED burst and the banner are one announcer item; the state below is not
    this._announceAlert(body.kind, body.text, { hud: body.hud !== false, subject: body.player_id_subject || null, src: 'MC' });
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
    this.log(`alert ${body.kind}`, 'lk');
    this._changed();
  }

  // ---------- BRX frames (§3.2) ----------
  feedFrame(f) {
    this._awake();                   // §3.11: a frame off the gun is proof too — the JS ran to parse it
    this._gunProbe = null; this._gunProbeRetryAt = 0;   // F272: any MCU frame answers/cancels a pre-verdict liveness probe
    this.lastGunFrameAt = this.now(); // B4: ANY frame is proof the link is alive — feeds the staleness watchdog in tick()
    const t = toks(f), cmd = t[0];
    // A full head emits zero-pool LCD/HP echoes while it is still crossing the serialized writer. They remain
    // useful proof that the MCU is talking (accounted above), but are not combat state: only a confirmed head
    // settlement may book the deliberate desync recovery death and start its respawn clock.
    if (this._gunRecovery && (cmd === 'HP' || cmd === 'LCD' || cmd === 'ALCD')) return;
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
      case 'HP': this._onHp(+t[1] || 0, +t[2] || 0, t[3] !== undefined && t[3] !== '' ? (+t[3] || 0) : this.shield, solicited); this._poolVerify(this.hp, this.armor, this.shield, solicited); if (solicited || this._operatorResyncPending) this._operatorResyncAnswer('HP', t, solicited); if (solicited) this._cureAnswer('HP', t); break;
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
        this._poolVerify(this.hp, this.armor, this.shield, false);   // F341: a `$SPAWN`'s own `$LCD` carries the pools it armed
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
        this._smokeObserve(t[2] !== undefined && t[2] !== '' ? +t[2] : NaN, t[3] !== undefined && t[3] !== '' ? +t[3] : 0);   // S53: before the recoil reader, which ignores why accuracy moved
        this._recoilObserve(t[2] !== undefined && t[2] !== '' ? +t[2] : NaN, t[3] !== undefined && t[3] !== '' ? +t[3] : 0);
        this._onAmmo(+t[1] || 0, t[4] !== undefined ? +t[4] : null, t[3] !== undefined && t[3] !== '' ? +t[3] : 0, t[5] !== undefined && t[5] !== '' ? +t[5] : null);
        break;
      }
      case 'HIR': {
        if (t[2] !== '15') this._audioHit(t[2], t[7], this.now());   // docs/announcer.md: the gun's own hit sound joins its FIFO
        if (t[2] === '15') {
          // S57 (docs/ir-callouts.md): magnitudes 21-36 are the IR callout bus, not a beacon — checked BEFORE
          // any of the beacon handling below, so a callout word never reaches `_onHillBeacon` and never writes
          // `this.beacon`. Everything else on protocol 15 (6/8/50/53 today) falls through unchanged.
          const calloutMag = parseInt(t[5], 10);
          if (calloutMag >= IR_CALLOUT.DOWN_BY && calloutMag <= IR_CALLOUT.LAST) {
            this._onIrCallout(parseInt(t[3], 10), calloutMag, this.now());
            break;
          }
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
        // S56: `mag` is token 5 as the shooter's OWN `$WEAP` t5 (or t12/t37 for a two-word weapon's second
        // word), latched raw and unmapped to any pool -- `_resolveHitWeapon` matches it against the roster's
        // `RosterWeapon.hir` to name what hit us. Never confused with the `dmg` `_onHp` computes from the
        // pool delta a moment later: that number is armour/shield-adjusted, this one is the wire magnitude.
        if (!Number.isNaN(team)) { this.latch = { shooter_num: Number.isNaN(num) ? 0 : num, shooter_team: team, at: this.now(), ir_proto: parseInt(t[2], 10), ir_subtype: parseInt(t[7], 10), crit: parseInt(t[6], 10), sensor: parseInt(t[1], 10), mag: parseInt(t[5], 10) }; this.lastHitAt = this.now(); this._shieldReassert(); }
        if (t[2] === '8') this._stun();   // F15: an EMP word (proto 8) -- a no-op unless config.stun is on; no $HP follows a status row, so nothing below sees it
        if (t[2] === '7') {               // S55: the Haze's fn-23 cell; repeated hits arrive while accuracy is already 0
          const until = this.now() + SMOKE_MS;
          this._nativeAccuracyHold('smoke', until);
          if (this.smoke) this.smoke.until = until;
        }
        if (!Number.isNaN(team)) this._poisonHit(parseInt(t[2], 10));   // S16: a protocol in `frames.dot` starts or refreshes the stack
        this._smokeHirAt = this.now(); this._smokeCheck();               // S53: half of a smoke landing (the other half is the $ALCD drop to 0)
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
        const queryOpen = this.configQuery && (this.configQuery.reply_at === null
          ? this.now() - this.configQuery.queued_at <= HEAD_WRITE_CAP_MS
          : this.now() - this.configQuery.reply_at <= CONFIG_QUERY_MS);
        if (queryOpen && String(f).trim().endsWith('*')) {
          const values = t.slice(1, 6).map(v => /^\d+$/.test(v) ? Number(v) : NaN);
          if (values.length === 5 && values.every(Number.isSafeInteger)) {
            const q = this.configQuery; this.configQuery = null;
            this.report('ack_config', { config_id: q.config_id, ok: true, gun_echo: q.gun_echo,
              gun_config: { player_id: values[0], team: values[1], hp: values[2], armor: values[3], shield: values[4] } });
          }
        }
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
    this._puObserve(this.now());                // A56: a powerup station's advert says whether its item is there
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

  // ---------- A56 (S58): powerups (docs/spec/powerups.md) ----------
  // The item is armed at start (MC compiles a pickup weapon into a spare slot, empty and out of the ALT cycle) and
  // UNLOCKED here with small mid-life writes -- never a config re-push, which would clear `spawned` (utility.md §5g.6).
  /** Every powerup state field back to empty: a new match, a new config, a reset. */
  _puReset() {
    this._puHeld = null;        // the weapon item: {station, weapon_id, slot, charges, left, name, color, at, back: {slot, mag, res}, trig}
    this._overshield = null;    // {station, base, amount, name, color, at}: the shield at the grant is `base`
    this._puClaim = null;       // {station, since, readyAt}: standing in range of a station whose item is there
    this._puReadyFor = null;    // {station, at}: the last station this phone was claim_ready for (the grant needs it)
    this._osProtectUntil = 0;   // now() at which the overshield grant's spawn protection ends (0 = none owed)
    this._puAdvert = {};        // station id -> {state, value, taker, at}: the station's own last advert
    this._puSeen = {};          // station id -> the last spawn index the announcer has dealt with
    this._puBack = null;        // {name, to, at}: a weapon item ran dry and the saved weapon went back on the trigger
    this._puReequip = false;    // a heavy was held at the death: re-equip slot 0 behind the revive burst
    this._puSelectAt = 0;       // now() of the last SELECT that acted (the debounce)
    this._puBackPending = null; // {slot, mag, res, at, tries}: a switch-back not yet answered by an `$ALCD` for that slot
    this._puHpAt = 0;           // now() of the last `$HP` (polish M1: a `$HIR` after it holds the overshield grant)
    this._psetNow = null;       // the `$PSET` the gun holds (the life's pool take); the next spawn sets it
    this.powerupSpawn = null;   // {name, color, at, station}: the "<ITEM> AVAILABLE" card (presentation only)
    this.powerupGrant = null;   // {name, color, kind, at, replaced?}: the grant, for the HUD's READY hint (state, at once)
    this.powerupSwap = null;    // {name, color, replaced, at}: the "<NEW> REPLACES <OLD>" card, set when the announcer reaches it
  }
  /** `{id: item}` for every powerup station in this game's config, or null when there is none (the inert case). */
  _puItems() {
    const st = this.config && Array.isArray(this.config.stations) ? this.config.stations : [];
    let out = null;
    for (const s of st) {
      if (!s || typeof s !== 'object' || s.kind !== 'powerup' || !s.item || typeof s.item !== 'object') continue;
      if (s.item.kind !== 'weapon' && s.item.kind !== 'overshield') continue;
      (out || (out = {}))[s.id] = s.item;
    }
    return out;
  }
  /** ms since go-live on the synced match clock, or null outside a live match. */
  _puElapsed(now) { return this.phase === 'live' && this.goLiveT ? now - this.goLiveT : null; }
  /** The station's own advert, when it is fresh and says something: state 1 (available) or state 0 with a
   *  countdown. State 0 with value 0 is a station that does not know yet (no `station_update` since it was armed),
   *  and reads as no advert at all, so the phone's own schedule decides. */
  _puAdvertOf(id, now) {
    const a = this._puAdvert[id];
    if (!a || now - a.at > PU_ADVERT_STALE_MS) return null;
    if (a.state === 0 && !a.value) return null;
    return a;
  }
  /** Is the item at station `id` there to claim? The station owns taken and untaken, so its advert decides; only a
   *  station with nothing to say yet falls back to the phone's own schedule (and then decides nothing: it names the taker). */
  _puClaimable(id, item, now) {
    const el = this._puElapsed(now); if (el == null) return false;
    const a = this._puAdvertOf(id, now);
    if (a) return a.state === 1;
    return puSpawnIndex(item, el) >= 0;
  }
  /** ms until the next spawn at station `id` on the phone's own schedule, or null. */
  _puNextInMs(item, now) {
    const el = this._puElapsed(now); if (el == null) return null;
    const k = puSpawnIndex(item, el);
    return Math.max(0, puSpawnAt(item, k + 1) - el);
  }
  /** The claim's range reading for a station entry: the median of its last three samples (beacon.js). */
  _puMedian(e) { return Number.isFinite(e.median) ? e.median : Number.isFinite(e.raw) ? e.raw : e.rssi; }
  _puThreshold(e) { return e.threshold || POWERUP_THRESHOLD_DEFAULT; }
  /** The powerup station this player reads: the one being claimed while it is still heard, else the loudest median. */
  _puStation(items = this._puItems()) {
    if (!items) return null;
    const mine = this.stations.filter(e => e && e.kind === 'powerup' && items[e.id] && this._stationAllowed(e)
      && !(Number.isFinite(e.ageMs) && e.ageMs > PU_ADVERT_STALE_MS));
    const held = this._puClaim ? mine.find(e => e.id === this._puClaim.station) : null;
    return held || mine.sort((a, b) => this._puMedian(b) - this._puMedian(a))[0] || null;
  }
  /** The ALT cycle as the gun runs it right now (for an ASSUMED swap and the HUD's SWITCHING target). A heavy is never in
   *  it: the phone puts the heavy on the trigger with its `$WEAP` and never rewrites ALT (Tony, 2026-09-24). */
  _altCycle() { return this._slotCount() >= 2 ? [0, 1] : [0]; }
  _nextAltSlot(from) { const c = this._altCycle(), i = c.indexOf(from); return i < 0 ? c[0] : c[(i + 1) % c.length]; }
  /** The head's own `$WEAP` row for `slot`, verbatim, or null. Re-sending it mid-life equips that slot on the trigger
   *  at once (and refills it, so an `$AMMO` always follows): bench 2026-09-24, powerups.md "Sitting A 3.3". */
  _puHeadWeap(slot) {
    const head = (this.frames && this.frames.head) || [];
    return head.find(f => typeof f === 'string' && f.startsWith(`$WEAP,${slot},`)) || null;
  }
  /** Is the held heavy on the trigger? `held.trig` is fed by `$ALCD` for slots 0-3 and by the node's own equips;
   *  melee's slot 4 never moves it (it is its own button, not the trigger). PURE. */
  _puOnHeavy() { const h = this._puHeld; return !!(h && h.trig === h.slot); }
  /** The loadout slot the trigger is on, for the switch-back target: 0 or 1, else 0 (slot 4 is melee). PURE. */
  _puLoadoutSlot(s) { return s === 0 || (s === 1 && this._slotCount() >= 2) ? s : 0; }
  /** [mag, reserve] the gun holds in `slot` now: the node's magazine account (`_liveAmmo`), else the spawn row. PURE. */
  _puCounts(slot) {
    const l = this._liveAmmo()[slot]; if (l) return l;
    const m = this._acctLive(slot), r = this._prevReserve[slot];
    return [m != null ? m : 0, r != null ? r : 0];
  }
  /** Put `slot` on the trigger: `pre` (a swap's zeroing), its head `$WEAP`, then `$AMMO` with the counts it must hold.
   *  The `$WEAP` refills the slot, so the `$AMMO` is what makes the counts right; both go in one write, in that order. */
  _puEquip(slot, mag, res, why, pre = []) {
    const weap = this._puHeadWeap(slot);
    if (!weap) { this.log(`powerup: the head carries no $WEAP for slot ${slot}; nothing equipped (${why})`, 'le'); return false; }
    this._acctWrote(slot, mag, res);   // F259: the gun's `$WEAP` reset and our `$AMMO` echo are bookkeeping, never a shot
    this._prevAmmo[slot] = mag; this._prevReserve[slot] = res;   // what the slot holds now, should the echo never come back
    this._write([...pre, weap, `$AMMO,${slot},${mag},${res},1,*`], why);
    this._holdAccuracyWrites('powerup equip');
    if (this.reloading) this._endReload('swapped');
    this.switching = null; this.activeSlot = slot;
    this._publishAmmo(slot, mag, res);   // the ammo block shows what is on the trigger now, before the gun's first `$ALCD`
    if (this._puHeld) this._puHeld.trig = slot;
    this._recoilArm('powerup equip');   // S42: as a confirmed ALT swap, the slot's own profile
    return true;
  }
  /** Called from `setStations`: remember each powerup station's advert (the "taken early" relay reaches phones this way). */
  _puObserve(now) {
    for (const e of this.stations) {
      if (!e || e.kind !== 'powerup') continue;
      const at = now - (Number.isFinite(e.ageMs) ? e.ageMs : 0);
      const prev = this._puAdvert[e.id];
      if (!prev || at >= prev.at) this._puAdvert[e.id] = { state: e.state, value: e.value, taker: e.taker || 0, at };
    }
    this._puClaimTick(now);
  }
  /** The claim: 1 s continuously within range of a station whose item is there. `state().powerupClaim` carries it to
   *  the player advert (app.js: `claiming`, then `claim_ready`, with the station id in `value`) and to the HUD's ring.
   *  The STATION picks the winner; the grant waits for its `taker` byte (`_puTakerCheck`). */
  _puClaimTick(now) {
    const items = this._puItems(); if (!items) { this._puClaim = null; return; }
    const ok = this.phase === 'live' && this.alive && this.bleUp && !this.resync && !this.reconciling && !this.gunLocked && !this.tutorial;
    // Polish M2: a STUNNED gun is disarmed and `_stunRestore` rewrites its ammo, which would erase a weapon grant. The claim
    // is not dropped: the ready latch is kept warm, so the station's answer is taken the moment the stun ends.
    // F331: but only while the player stays in range; walking out drops the claim, so no claim_ready goes out.
    if (ok && this.stunned) {
      const cl = this._puClaim, st = cl ? this._puStation(items) : null;
      const held = st && st.id === cl.station && Number.isFinite(this._puMedian(st)) && this._puMedian(st) >= this._puThreshold(st) - POWERUP_EXIT_DB;
      if (!held) { this._puClaim = null; this._puReadyFor = null; } else if (this._puReadyFor) this._puReadyFor.at = now;
      return;
    }
    if (!ok) { this._puClaim = null; this._puReadyFor = null; return; }
    this._puTakerCheck(items, now);
    const st = this._puStation(items);
    if (!st) { this._puClaim = null; return; }
    const c = this._puClaim && this._puClaim.station === st.id ? this._puClaim : null;
    const med = this._puMedian(st), thr = this._puThreshold(st);
    const inRange = Number.isFinite(med) && (c ? med >= thr - POWERUP_EXIT_DB : med >= thr);   // enter at the threshold, leave 3 dB under it
    if (!inRange || !this._puClaimable(st.id, items[st.id], now)) { this._puClaim = null; return; }
    if (!c) this._puClaim = { station: st.id, since: now, readyAt: null };
    const cl = this._puClaim;
    if (cl.readyAt == null && now - cl.since >= POWERUP_DWELL_MS) { cl.readyAt = now; this.log(`powerup: claim ready at station ${st.id}`, 'li'); }
    if (cl.readyAt != null) this._puReadyFor = { station: st.id, at: now };
  }
  /** The `$PSET` the gun holds now (the life's `pset_pool` take, else the head's), with its shield max (token 5) set to
   *  `max`. Everything else is the frame verbatim: the bench raised ONLY the shield max (70 -> 145) and the gun kept
   *  firing and cycling ALT. `_write` puts the team back behind it (F206). Null when there is no `$PSET` to copy. */
  _osPset(max) {
    const head = (this.frames && this.frames.head) || [];
    const f = this._psetNow || head.find(x => typeof x === 'string' && x.startsWith('$PSET,'));
    if (!f) return null;
    const t = f.split(','); if (t.length < 6) return null;
    t[5] = String(max);
    return t.join(',');
  }
  /** The spawn-protection pair the bundle compiles (`$TMP` t8 = -100, then `spawn_protect_off`), or null for an older
   *  bundle without it (then the grant simply goes without protection). */
  _osProtectFrames() {
    const f = this.frames; if (!f || typeof f.spawn_protect_off !== 'string' || !f.spawn_protect_off.startsWith('$TMP,')) return null;
    const on = [...(f.spawn || []), ...(f.revive || [])].find(x => typeof x === 'string' && /^\$TMP,(?:[^,]*,){7}-100,/.test(x)) || '$TMP,,,,,,,,-100,,,,*';
    return { on, off: f.spawn_protect_off };
  }
  /** tick(): the grant's protection ends OVERSHIELD_GRANT_MS after it. A death or a new life owns `$TMP` itself (`$SPAWN`
   *  clears it), so only a live, linked gun gets the write; a lost link waits for the relink. */
  _osTick(now) {
    if (!this._osProtectUntil || now < this._osProtectUntil) return;
    if (!this.alive || this.phase !== 'live') { this._osProtectUntil = 0; return; }
    if (!this.bleUp) return;
    const pf = this._osProtectFrames(); this._osProtectUntil = 0;
    if (!pf || this._armPending) return;   // a life still owed its own protection end keeps it
    const life = this._lifeSeq;
    const r = this._write([pf.off], 'overshield: grant window over, spawn protection off');
    // Polish H2, as `_armLife` does: a false resolve re-arms the end, so the next tick retries it on a live link. A lost
    // write would otherwise leave the player unhittable for the life.
    Promise.resolve(r).then(ok => {
      if (ok !== false || this._lifeSeq !== life || !this.alive || this.phase !== 'live' || this.ended || this._osProtectUntil) return;
      if ((this._osOffTries = (this._osOffTries || 0) + 1) > OVERSHIELD_OFF_RETRIES) {
        this._writeLost = life;   // r3: as `_writeLife` does, so the pool reads `write_lost` and MC offers RESYNC GUN
        this.log(`*** overshield: spawn protection off failed ${OVERSHIELD_OFF_RETRIES + 1} times -- the player may be unhittable (RESYNC GUN) ***`, 'le'); return;
      }
      this.log(`overshield: spawn protection off was lost, retrying (${this._osOffTries}/${OVERSHIELD_OFF_RETRIES})`, 'le');
      this._osProtectUntil = this.now();
    });
  }

  /** The grant happens only when a station's advert names THIS player as `taker` and this phone was claim_ready for it. */
  _puTakerCheck(items, now) {
    const me = this.player ? this.player.player_num : null;
    for (const id of Object.keys(items)) {
      const a = this._puAdvert[id]; if (!a || now - a.at > PU_ADVERT_STALE_MS) continue;
      if (a.state !== 0 || !a.taker || a.taker !== me) continue;
      const r = this._puReadyFor;   // cleared by the grant: one ready claim, one grant
      if (!r || String(r.station) !== String(id) || now - r.at > POWERUP_READY_LATCH_MS) continue;
      const item = items[id];
      // Never to a dead gun, and never over a hit whose `$HP` is still in flight (polish M1: a lethal one would be revived by
      // the absolute `$LIFE`). The claim latch stays warm, so the grant goes out on the next tick once the `$HP` is in.
      if (item.kind === 'overshield' && (this.hp <= 0 || (this.latch && this.latch.at > this._puHpAt && now - this.latch.at < OVERSHIELD_HIR_WAIT_MS))) continue;
      this._puReadyFor = null; this._puClaim = null;
      const granted = item.kind === 'weapon' ? this._puGrantWeapon(+id, item, now) : this._puGrantShield(+id, item, now);
      if (!granted) continue;
      this.emitFact({ type: 'pickup', match_id: this.matchId, station_id: +id, item_kind: item.kind, ...(item.kind === 'weapon' ? { weapon_id: item.weapon_id } : {}) });
      this._save();
      this._changed();
    }
  }
  /** tick(): the spawn announcements, from the phone's own schedule and the match clock. Presentation only. */
  _puTick(now) {
    const items = this._puItems(); if (!items) return;
    const el = this._puElapsed(now); if (el == null) return;
    const batch = [];
    for (const id of Object.keys(items)) {
      const item = items[id], k = puSpawnIndex(item, el);
      const seen = this._puSeen[id] != null ? this._puSeen[id] : -1;
      if (k <= seen) continue;
      this._puSeen[id] = k;
      if (el - puSpawnAt(item, k) > PU_ANNOUNCE_LATE_MS) continue;   // a resumed webview does not replay old news
      // Skipped when the phone KNOWS nobody took the last one: the station advertised it available after that spawn.
      const a = this._puAdvert[id];
      if (k >= 1 && a && a.state === 1 && a.at >= this.goLiveT + puSpawnAt(item, k - 1)) continue;
      if (!batch.some(b => b.name === item.name)) batch.push({ name: String(item.name || '').toUpperCase(), color: item.color || null, station: +id });
    }
    // docs/announcer.md: each spawn is one announcer item (the lowest priority), so two that land together show one at a
    // time, PU_ANNOUNCE_MS each, and never on top of a kill confirm or a lead change.
    for (const next of batch) this._laneFeed({ kind: 'powerup_spawn', text: `${next.name} AVAILABLE`, color: next.color, src: 'PHONE' });   // the FEED lane, at once
    for (const next of batch) this._ann.push({ kind: 'powerup_spawn', key: `pu:${next.name}`, bannerMs: PU_ANNOUNCE_MS,
      play: () => { this.powerupSpawn = { ...next, at: this.now() }; this.log(`powerup: ${next.name} AVAILABLE (station ${next.station})`, 'li'); this._changed(); } });
    if (this.powerupSpawn && now - this.powerupSpawn.at > PU_ANNOUNCE_MS + 1000) this.powerupSpawn = null;
    if (this.powerupSwap && now - this.powerupSwap.at > PU_ANNOUNCE_MS + 1000) this.powerupSwap = null;
    if (this.powerupGrant && now - this.powerupGrant.at > PU_READY_MS + 1000) this.powerupGrant = null;
  }
  /** A weapon item goes STRAIGHT ONTO THE TRIGGER (Tony, 2026-09-24): save the slot the trigger is on and its counts
   *  (the switch-back target), then the pickup slot's head `$WEAP` and `$AMMO` with the charges. No ALT or SELECT write,
   *  so an Easy Reload player is granted like anyone. A second weapon item SWAPS (PU_WEAPON_SWAPS): the old slot is
   *  zeroed first, and the switch-back target stays the loadout weapon. */
  _puGrantWeapon(id, item, now) {
    const armed = ((this.config && this.config.powerups) || []).find(p => p && p.weapon_id === item.weapon_id);
    if (!armed || !Number.isFinite(+armed.slot)) { this.log(`powerup: ${item.weapon_id} has no armed slot in this game (config.powerups)`, 'le'); return false; }
    const slot = +armed.slot;
    if (!this._puHeadWeap(slot)) { this.log(`powerup: the head carries no $WEAP for slot ${slot} (${item.weapon_id})`, 'le'); return false; }
    const row = this.weaponRow(item.weapon_id);
    const charges = Number.isFinite(+item.charges) && +item.charges > 0 ? +item.charges : (row && row.clip > 0 ? row.clip : 1);
    const old = this._puHeld;
    if (old && !PU_WEAPON_SWAPS) { this.log(`powerup: already holding ${old.name}`, 'li'); return false; }
    // The switch-back target. A swap keeps the first grant's, unless the trigger has since gone back to a loadout
    // weapon (ALT or SELECT), whose counts are newer.
    let back = old && old.trig === old.slot && old.back ? old.back : null;
    if (!back) { const t = this._puLoadoutSlot(old ? old.trig : this.activeSlot), [mag, res] = this._puCounts(t); back = { slot: t, mag, res }; }
    const pre = old && old.slot !== slot ? [`$AMMO,${old.slot},0,0,1,*`] : [];
    if (pre.length) this._acctWrote(old.slot, 0, 0);
    const name = String(item.name || item.weapon_id).toUpperCase();
    this._puHeld = { station: id, weapon_id: item.weapon_id, slot, charges, left: charges, name, color: item.color || null, at: now, back, trig: back.slot };
    this._puBack = null;
    this._puEquip(slot, charges, PU_RESERVE, `powerup: ${name} on the trigger (${charges} in slot ${slot}; back to slot ${back.slot} at ${back.mag}/${back.res})${old ? ` replaces ${old.name}` : ''}`, pre);
    this.powerupGrant = { kind: 'weapon', name, color: item.color || null, charges, at: now, ...(old ? { replaced: old.name } : {}) };
    if (old) {   // docs/announcer.md: "<NEW> REPLACES <OLD>" is an announcer card, so it waits its turn like the rest
      const swap = { name, color: item.color || null, replaced: old.name };
      this._laneFeed({ kind: 'powerup_swap', text: name, sub: `REPLACES ${old.name}`, color: swap.color, src: 'BLE' });   // the FEED lane, at once
      this._ann.push({ kind: 'powerup_swap', key: 'pu_swap', play: () => { this.powerupSwap = { ...swap, at: this.now() }; this._changed(); } });
    }
    return true;
  }
  /** The overshield (Tony, 2026-09-24): one burst of spawn protection on, the `$PSET` with its shield max raised to the
   *  preset max plus `amount` (bench: the gun clamps a shield past the `$PSET` max back within 0.75 s, and holds it once
   *  the max is raised), and the absolute `$LIFE` at the pools as they stand now. A hit in flight is overwritten and a hit
   *  inside the window does nothing: "the damage is ignored". Protection ends OVERSHIELD_GRANT_MS later (`_osTick`). It
   *  stacks beside a weapon item. */
  _puGrantShield(id, item, now) {
    const amount = Number.isFinite(+item.amount) && +item.amount > 0 ? +item.amount : OVERSHIELD_AMOUNT;
    const base = this._overshield ? this._overshield.base : this.shield;
    const to = this.shield + amount, max = Math.max(this.maxShield, to);
    const pset = this._osPset(max), pf = this._armPending ? null : this._osProtectFrames();   // a life still protected keeps its own
    this._write([...(pf ? [pf.on] : []), ...(pset ? [pset] : []), `$LIFE,${this.hp},${this.armor},${to},2,*`],
      `powerup: ${item.name} +${amount} (shield ${this.shield} -> ${to}, max ${this.maxShield} -> ${max}${pf ? ', protected' : ''})`);
    if (pf) { this._osProtectUntil = now + OVERSHIELD_GRANT_MS; this._osOffTries = 0; }
    this.shield = to; this._prevShield = to;
    this._shieldRegen = null;   // S29: no refill may be in flight under it
    const name = String(item.name || 'OVERSHIELD').toUpperCase();
    this._overshield = { station: id, base, amount: to - base, name, color: item.color || null, at: now, max };
    this.powerupGrant = { kind: 'overshield', name, color: item.color || null, at: now };
    return true;
  }
  /** The overshield is over: the `$PSET` back at the preset shield max, so no later spawn or refill fills to the raised one. */
  _osRestore(why) {
    const pset = this._osPset(this.maxShield), life = this._lifeSeq;
    if (pset) this._writeMust([pset], `overshield over (${why}): shield max back to ${this.maxShield}`, () => this._lifeSeq === life && !this._overshield, true);   // polish M2 (a `$PSET` carries no counts: safe to repeat after a shot or a hit)
  }
  /** Every `$ALCD` that reached the ordinary path: the slot is the trigger's (melee's slot 4 is not, and an unheld pickup
   *  slot is only our own zeroing echo). The heavy's own magazine reaching 0 ends the item. */
  _puAmmo(slot, mag, prev) {
    const bp = this._puBackPending;
    // Polish M3: the gun answered the switch-back. Never the reconcile disarm's echo (r2 M1): `_endReconcile` re-sends it.
    // A real round from a loadout slot means the player is shooting something else by choice: stop re-sending (r2 low).
    if (bp && !this.reconciling && (slot === bp.slot || (slot < 2 && prev != null && mag < prev))) this._puBackPending = null;
    const h = this._puHeld; if (!h || slot === 4 || (slot >= 2 && slot !== h.slot) || this.reconciling) return null;   // polish H1: the disarm's echo is not a shot
    // Only a round leaving (or a slot's first report) says which weapon is on the trigger: the echo of our own `$AMMO`
    // for another slot is not the trigger moving (bench: `$AMMO` alone never switches).
    const shot = prev == null || mag < prev;
    if (shot) h.trig = slot;
    if (slot !== h.slot) return null;
    h.left = mag;
    if (mag > 0 || !shot) return null;
    this._puEnd('empty');
    return this.activeSlot;   // the slot the switch-back just put on the trigger: `_onAmmo` must not move it back
  }

  /** SELECT (`$BUT,3,1`) with a heavy held TOGGLES the trigger (Tony, 2026-09-24: "select should equip it if possible"):
   *  on the heavy -> the saved weapon with its saved counts; on a loadout weapon -> the heavy with its charges left, the
   *  weapon's counts saved first. The PHONE equips (a native `$BMAP` fires a slot, never equips it), so SELECT stays at
   *  the head's `$BMAP,3,98` and nothing but `$WEAP` + `$AMMO` is written. */
  _puSelectPressed() {
    const h = this._puHeld; if (!h && !this._puBackPending) return;
    if (this.phase !== 'live' || !this.alive || this.tutorial || !this.bleUp || this.stunned || this.reconciling || this.resync || this.switching) {
      this.log('SELECT ignored (dead, stunned, reconciling or a swap pending)', 'li'); return;
    }
    const now = this.now();
    if (this._puSelectAt && now - this._puSelectAt < PU_SELECT_DEBOUNCE_MS) return;
    this._puSelectAt = now;
    if (!h) { this._puBackResend(now, 'SELECT'); return; }
    if (this._puOnHeavy()) {
      h.left = this._puCounts(h.slot)[0];
      const b = h.back || { slot: 0, mag: this._puCounts(0)[0], res: this._puCounts(0)[1] };
      this._puEquip(b.slot, b.mag, b.res, `SELECT: ${h.name} off the trigger (${h.left} left), slot ${b.slot} back at ${b.mag}/${b.res}`);
    } else {
      const t = this._puLoadoutSlot(h.trig), [mag, res] = this._puCounts(t);
      h.back = { slot: t, mag, res };
      this._puEquip(h.slot, h.left, PU_RESERVE, `SELECT: ${h.name} on the trigger (${h.left} left), slot ${t} saved at ${mag}/${res}`);
    }
    this._save();
  }
  /** Polish M3: re-send a switch-back the gun has not answered (no `$ALCD` for the back slot yet). A lost write would
   *  leave the trigger on an empty heavy with the item already over. */
  _puBackResend(now, why) {
    const bp = this._puBackPending; if (!bp) return;
    if (bp.tries >= PU_BACK_TRIES) { this._puBackPending = null; this.log(`powerup: switch-back to slot ${bp.slot} never answered after ${bp.tries} re-sends`, 'le'); return; }
    bp.tries++; bp.at = now;
    this._puEquip(bp.slot, bp.mag, bp.res, `powerup: switch-back to slot ${bp.slot} re-sent (${why}, ${bp.tries}/${PU_BACK_TRIES})`);
  }
  /** tick(): the pending switch-back, re-sent every PU_BACK_RETRY_MS while the gun can take it. */
  _puBackTick(now) {
    const bp = this._puBackPending; if (!bp || now - bp.at < PU_BACK_RETRY_MS) return;
    if (this.phase !== 'live' || !this.alive) { this._puBackPending = null; return; }
    if (!this.bleUp || this.stunned || this.reconciling || this.switching) return;   // r3: never fight an ALT swap in flight
    this._puBackResend(now, 'no answer');
  }
  /** The end of a weapon item. Empty: the saved weapon back on the trigger with its saved counts (`$WEAP` then `$AMMO`),
   *  and the HUD says so briefly. Death: nothing now (compile's revive re-empties the pickup slot); `_puRevive`
   *  re-equips slot 0 behind the revive burst, since the trigger slot after `$SPAWN` is unproven. */
  _puEnd(why) {
    const h = this._puHeld; if (!h) return;
    this._puHeld = null;
    if (why === 'death' && PU_LOST_AT_DEATH) { this._puReequip = true; this.log(`powerup: ${h.name} lost at the death`, 'li'); this._save(); return; }
    const b = h.back || { slot: 0, mag: this._puCounts(0)[0], res: this._puCounts(0)[1] };
    this._puEquip(b.slot, b.mag, b.res, `powerup: ${h.name} over (${why}), slot ${b.slot} back on the trigger at ${b.mag}/${b.res}`);
    this._puBackPending = { slot: b.slot, mag: b.mag, res: b.res, at: this.now(), tries: 0 };   // polish M3: until the gun answers for that slot
    this._puBack = { name: h.name, to: this.weaponName, at: this.now() };
    this._save();
  }
  /** Death: a weapon item's charges are lost, and the overshield is gone. */
  _puDeath() {
    if (this._puHeld) this._puEnd('death');
    // The revive burst's pool `$PSET` (A15.3) lands before its `$SPAWN` at the preset max; an older bundle has none, so the
    // max goes back now, or the `$SPAWN` would refill the shield to the raised one.
    const pool = this.frames && Array.isArray(this.frames.pset_pool) && this.frames.pset_pool.length;
    if (this._overshield && !pool) this._osRestore('death');
    this._overshield = null; this._puBack = null; this._osProtectUntil = 0; this._puBackPending = null;
  }
  /** `_revive`, after its burst: an item still held (an operator respawn of a LIVE player skips `_death`) is lost the same
   *  way, and slot 0 is re-equipped with its head `$WEAP` and the burst's own `$AMMO,0,…` (a safe re-equip). */
  _puRevive(burst) {
    if (this._puHeld) { this._puHeld = null; this._puReequip = true; }
    if (!this._puReequip) return;
    this._puReequip = false;
    const row = (burst || []).find(f => typeof f === 'string' && f.startsWith('$AMMO,0,')) || ((this.frames && this.frames.spawn) || []).find(f => f.startsWith('$AMMO,0,'));
    const t = row ? row.split(',') : null;
    if (t) this._puEquip(0, +t[2] || 0, +t[3] || 0, 'powerup: slot 0 re-equipped after the revive');
    this._save();
  }
  /** The reconcile re-arm's spawn `$AMMO` rows with a held heavy's zero row swapped for its charges, in the SAME write:
   *  a separate restore opened the echo window after the zero had gone out, so the gun's echo of 0 read as the charges
   *  fired and ended the item (polish H1). */
  _puRearmRows(rows) {
    const h = this._puHeld; if (!h) return rows;
    this._acctWrote(h.slot, h.left, PU_RESERVE); this._prevAmmo[h.slot] = h.left;
    return rows.map(f => f.startsWith(`$AMMO,${h.slot},`) ? `$AMMO,${h.slot},${h.left},${PU_RESERVE},1,*` : f);
  }

  /** `$HP`: the overshield is gone once the shield is back to where it started (a stale pre-grant frame excepted). */
  _puShieldFrame(shield) {
    const o = this._overshield; if (!o) return;
    if (this.now() - o.at < OVERSHIELD_GRANT_MS) return;   // inside the grant window a lower `$HP` is a pre-grant hit reported late: ignored
    if (shield < o.base || (shield <= o.base && this.now() - o.at > OVERSHIELD_ECHO_MS)) { this._overshield = null; this.log(`powerup: ${o.name} gone`, 'li'); this._osRestore('drained'); }
  }
  /** The HUD's powerup view, or null when the game has no powerup items (the inert case). PURE. */
  powerupView(now = this.now()) {
    const items = this._puItems(); if (!items) return null;
    const h = this._puHeld, o = this._overshield;
    const held = h ? { name: h.name, color: h.color, weapon_id: h.weapon_id, slot: h.slot, charges: h.charges, left: h.left, active: this._puOnHeavy(), back: h.back ? { ...h.back } : null } : null;
    const overshield = o ? { name: o.name, color: o.color, amount: o.amount, left: Math.max(0, Math.min(o.amount, this.shield - o.base)), base: o.base } : null;
    let hint = null;
    if (this.phase === 'live' && this.alive) {
      const st = this._puStation(items), g = this.powerupGrant, cl = this._puClaim;
      const nameOf = item => String(item.name || '').toUpperCase();
      const b = this._puBack;
      if (b && now - b.at < PU_READY_MS) hint = { kind: 'switched_back', name: b.name, to: b.to, color: null };
      else if (g && now - g.at < PU_READY_MS) hint = { kind: 'granted', name: g.name, color: g.color, itemKind: g.kind, ...(g.charges != null ? { charges: g.charges } : {}), ...(g.replaced ? { replaced: g.replaced } : {}) };
      else if (cl && items[cl.station]) {
        const item = items[cl.station], base = { name: nameOf(item), color: item.color || null, station: cl.station };
        hint = cl.readyAt != null && now - cl.readyAt >= POWERUP_NO_ANSWER_MS ? { kind: 'no_answer', ...base }
          : { kind: 'claiming', ...base, progress: Math.min(1, (now - cl.since) / POWERUP_DWELL_MS), ready: cl.readyAt != null };
      } else if (st) {
        const item = items[st.id], base = { name: nameOf(item), color: item.color || null, station: st.id };
        const med = this._puMedian(st), near = Number.isFinite(med) && med >= this._puThreshold(st) - PU_NEAR_DB;
        const a = this._puAdvertOf(st.id, now), me = this.player ? this.player.player_num : null;
        if (near && this._puClaimable(st.id, item, now)) hint = { kind: 'approach', ...base };
        else if (near && a && a.state === 0 && a.taker && a.taker !== me) hint = { kind: 'taken_by', ...base, by: String(this.nameOf(a.taker) || `PLAYER ${a.taker}`).toUpperCase(), nextInMs: this._puNextInMs(item, now) };
        else if (near) hint = { kind: 'taken', ...base, nextInMs: this._puNextInMs(item, now) };
      }
    }
    return { hint, held, overshield };
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
  _askGun(why, options = undefined) {   // NOT `_probe`: that name is taken by the first-connect BLE ritual above (line ~1023), and a second `_probe` on this class silently overrode it
    if (!(options && options.deferClock)) { this._queryAt = this.now(); this._probeSeen = {}; }
    this._probeSeq = (this._probeSeq || 0) + 1;
    return this._write([PROBE_LIFE], why, options);
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
    if (this._operatorResyncPending || this.gunLocked) return;
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
    if (this._gunProbe) return;   // F272 owns the shared all-zero LIFE solicitation until it answers or concludes
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
    if (this._cure || this._operatorResyncPending || this._gunProbe || this.gunLocked) return;
    if (this._standDown(['phase', 'spawned', 'bundle', 'ble', 'alive', 'reconciling', 'resync', 'tutorial'], now)) return;
    if (this._pollAt && now - this._pollAt < QUERY_POLL_MS) return;
    this._pollAt = now;
    this._askGun('divergence poll');
  }
  /** F264 (Tony, 2026-09-18): READ BACK THE BIGGEST WRITE OF A LIFE. The spawn/revive burst is 17 frames, and the
   *  first proven stall began 4.6 s after one. A probe once the burst has had time to land and echo proves the gun
   *  actually took it, instead of the node assuming so for the rest of the life. Once per life, 1 frame. */
  _spawnProbeTick(now) {
    if (this._cure || this._operatorResyncPending || this._gunProbe || this.gunLocked || !this._spawnAt || this._probedLife === (this._lifeSeq || 0)) return;
    if (now - this._spawnAt < SPAWN_PROBE_MS) return;
    if (this._standDown(['phase', 'spawned', 'bundle', 'ble', 'alive', 'tutorial'], now)) return;   // reading is allowed inside a reconcile/resync; see `_askGun`
    this._probedLife = this._lifeSeq || 0;
    this._pollAt = now;                          // the read-back IS this cadence's poll: do not send two in a breath
    this._poolCheck = { life: this._lifeSeq || 0 };   // F341: the answer is COMPARED, not just awaited (`_poolVerify`)
    this._askGun('spawn read-back: did the gun take the burst?');
  }
  /** F341: the pool ceilings this life armed: the compiled `$PSET`'s hp and armour (`maxHp`/`maxArmor`), and its shield
   *  max, raised while an overshield holds (A56 writes a `$PSET` with a higher t5). PURE. */
  _poolCeilings() {
    const os = this._overshield && Number.isFinite(+this._overshield.max) ? +this._overshield.max : 0;
    return { hp: this.maxHp, armor: this.maxArmor, shield: Math.max(this.maxShield, os) };
  }
  /** F341: is a pool report ABOVE the armed ceilings? Armour counts only in a game that arms some: armour granted in a
   *  no-armour game is a state the HUD shows (Visor polish r2 M1), and a doubled `$PSET` doubles the hp anyway. PURE. */
  _poolsOver(hp, armor, shield, c = this._poolCeilings()) {
    return hp > c.hp || (c.armor > 0 && armor > c.armor) || shield > c.shield;
  }
  /** F341: does a pool report fit what this life armed? Called with every `$HP` and `$LCD` in a live life.
   *  - A pool ABOVE its ceiling is always wrong: the gun clamps every grant at its `$PSET`, so only a `$PSET` the gun
   *    misread gets one there. That starts a repair (`_poolRepair`), and only that does.
   *  - The spawn read-back's answer (`_poolCheck`) BELOW the spawn pools with no `$HIR` since the spawn is logged, never
   *    repaired: grenade and station damage carry no `$HIR`, and a hit's `$HP` can beat its `$HIR`, so a write there
   *    could heal real damage (polish review 2026-09-24).
   *  - The answer to a repair's own read-back confirms it, or schedules the next attempt.
   *  Never writes: the tick does, outside the stand-downs. */
  _poolVerify(hp, armor, shield, solicited) {
    if (this.phase !== 'live' || !this.spawned || !this.alive || this.tutorial || !(hp > 0)) return;
    const life = this._lifeSeq || 0, now = this.now();
    if (this.poolWrong && this.poolWrong.life === life) return;   // the verdict stands: the operator's FORCE RESPAWN, not a loop
    const c = this._poolCeilings();
    const over = this._poolsOver(hp, armor, shield, c);
    if (solicited && this._poolCheck && this._poolCheck.life === life) {
      this._poolCheck = null;
      const hit = !!(this.latch && this._spawnAt && this.latch.at >= this._spawnAt);
      if (!over && !hit && (hp !== c.hp || armor !== c.armor)) {
        this.log(`spawn read-back: the gun reads ${hp}/${armor}/${shield}, not the spawn pools ${c.hp}/${c.armor}, with no $HIR since the spawn `
          + '(a grenade, a station or a lost $HIR can do that; nothing is written) (F341)', 'le');
      }
    }
    const rp = this._poolRepair && this._poolRepair.life === life ? this._poolRepair : null;
    if (rp && rp.readAt && solicited) {
      rp.readAt = 0;
      if (!over) {
        this.log(`pool repair held: the gun reads ${hp}/${armor}/${shield} (attempt ${rp.attempts} of ${POOL_REPAIR_TRIES})`, 'lk');
        this._poolRepair = null; this._changed();
        return;
      }
      rp.dueAt = now;   // it did not hold: the next attempt, or the verdict, on the next tick
    }
    if (!over || rp) return;
    this.log(`*** gun pools ${hp}/${armor}/${shield} are above the armed ceiling ${c.hp}/${c.armor}/${c.shield} -- repairing ($*, the life's $PSET, $LIFE set) (F341) ***`, 'le');
    this._poolRepair = { life, attempts: 0, dueAt: now, readAt: 0, wrote: false };
  }
  /** F341: one repair step per tick. Waits out a reconcile, a resync, a dropped link, and any other probe in flight (the
   *  cure, an operator resync, the F272 liveness probe: they share the one reply window). Drops the repair on a new
   *  life or a death (the next `$SPAWN` burst carries its own `$PSET`).
   *  A write is `$*` (the parser reset), the life's `$PSET` verbatim (`_osPset`, with the shield max it holds now;
   *  `_write` puts the `$TID` behind it, F206), then `$LIFE,<hp>,<armor>,<shield>,1,*`: an absolute set clamped at the
   *  new maxima (mode 1), at the gun's LATEST pools clamped to the ceilings, so a hit taken meanwhile is kept. The model
   *  takes those numbers at once, so the `$HP` the set echoes reads as no damage.
   *  ⚠ A mode-1 `$LIFE` revives a dead gun. So a write needs a live answer: a read-back that goes unanswered is the
   *  verdict (`pool_wrong`), never another write (the F264 rule: no action on no evidence). */
  _poolRepairTick(now) {
    const rp = this._poolRepair;
    if (!rp) return;
    if (rp.life !== (this._lifeSeq || 0) || !this.alive || this.phase !== 'live') { this._poolRepair = null; return; }
    const held = this._standDown(['spawned', 'bundle', 'ble', 'alive', 'reconciling', 'resync', 'tutorial'], now)
      || this._cure || this._operatorResyncPending || this._gunProbe;
    if (held) {   // a read-back in flight cannot be answered through a drop or another probe: ask again afterwards, never a verdict
      if (rp.readAt) { rp.readAt = 0; rp.wrote = true; rp.dueAt = now; }
      return;
    }
    if (this._armPending && !rp.wrote && !rp.readAt) return;   // spawn protection is still up: a `$PSET` mid-window is untested (powerups.md)
    const verdict = why => {
      this._poolRepair = null;
      this.poolWrong = { life: rp.life, at: now, hp: this.hp, armor: this.armor, shield: this.shield };
      this.log(`*** gun pools still wrong (${why}): the player may be unkillable. Operator: FORCE RESPAWN (F341) ***`, 'le');
      this._changed();
    };
    if (rp.readAt) {
      if (now - rp.readAt < QUERY_REPLY_MS) return;
      verdict(`the read-back after repair ${rp.attempts} went unanswered`);
      return;
    }
    if (now < rp.dueAt) return;
    if (rp.wrote) {   // the repair has had POOL_REPAIR_READ_MS to land: ask
      rp.wrote = false; rp.readAt = now;
      this._askGun(`pool repair read-back ${rp.attempts}/${POOL_REPAIR_TRIES}`);
      return;
    }
    const c = this._poolCeilings();
    if (!this._poolsOver(this.hp, this.armor, this.shield, c)) {   // the gun's latest word is in range again
      this.log(`pool repair not needed: the gun now reads ${this.hp}/${this.armor}/${this.shield}`, 'li');
      this._poolRepair = null;
      return;
    }
    if (rp.attempts >= POOL_REPAIR_TRIES) { verdict(`${POOL_REPAIR_TRIES} repairs did not hold, it reads ${this.hp}/${this.armor}/${this.shield}`); return; }
    rp.attempts++;
    const t = { hp: Math.min(this.hp, c.hp), armor: Math.min(this.armor, c.armor), shield: Math.min(this.shield, c.shield) };
    const pset = this._osPset(c.shield);
    this._write([PARSER_RESET, ...(pset ? [pset] : []), `$LIFE,${t.hp},${t.armor},${t.shield},1,*`],
      `pool repair ${rp.attempts}/${POOL_REPAIR_TRIES}: ${this.hp}/${this.armor}/${this.shield} above ${c.hp}/${c.armor}/${c.shield} -> ${t.hp}/${t.armor}/${t.shield}`);
    this.hp = t.hp; this.armor = t.armor; this.shield = t.shield;
    this._prevHp = t.hp; this._prevArmor = t.armor; this._prevShield = t.shield;
    rp.wrote = true; rp.dueAt = now + POOL_REPAIR_READ_MS;
    this._changed();
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
    if (this.alive && this.poolWrong && this.poolWrong.life === this._lifeSeq) return { why: 'pool_wrong', ms };   // F341: the gun's pools are not the armed ones
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
   *  and cost ~80 writes/min). This is belt-and-braces only: `down.rearm` (`$HLOOP,1,2500,*`) restores the
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
    if (this.timedRespawn) return 'timer';
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
      else if (id === BTN_SELECT) this._puSelectPressed();   // A56: a PRESS only; `$PHONE` also sends `$BUT,3,0`, a release, which never acts
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
    // S54 (2026-09-23), BENCH-PROVISIONAL: the gun streams `$BUT,0,0` on every trigger release in app
    // mode (docs/manual/dev.md), so a released trigger is direct evidence the burst has stopped -- while
    // the weapon is still CRISP this costs no write, so the release simply clears the round count rather
    // than waiting out `settleMs` for a burst that never degraded anything. A weapon already DEGRADED or
    // HEAVY does NOT restore on release: recovery still needs the quiet the settle timer measures, in one
    // write, because a release is not proof the player has stopped for good -- only that this pull has.
    // The settle timer still clears the counter on its own as a fallback, so a dropped release edge never
    // strands a stale burst. Not yet bench-proven: confirm no `$BUT,0,0` is lost under full auto and that
    // it arrives in order with the `$ALCD` stream it is meant to race (docs/FOLLOWUPS.md F308).
    if (id === BTN_TRIGGER) { const r = this._recoil; if (r && r.state === 'crisp' && r.burst > 0) r.burst = 0; }
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
    if (this._armPending && this._armPending.shotEnds !== false && (slot === 0 || slot === 1 || (this._puHeld && slot === this._puHeld.slot)) && prev != null && mag < prev && !this.reconciling) this._armLife('first shot');   // A56: a heavy's round proves it too   // 2026-09-19: a profile life never ends on a shot
    if (prev != null && mag < prev) this._actSeq++;   // pl4: `_writeMust` never repeats counts past a shot
    if (prev != null && mag < prev && this.phase === 'live') { this.shots += (prev - mag); if (this._life && this.alive) this._life.shots += (prev - mag); }   // death screen: this life's rounds too
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
    const puBack = this._puAmmo(slot, mag, prev);   // A56: the held item's magazine; empty ends the item and switches back
    if (this.switching && slot !== this.switching.from && (slot < 2 || (this._puHeld && slot === this._puHeld.slot))) {
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
      if (this._puHeld) this._puHeld.trig = slot;   // A56 r2 M2: ALT took the trigger off the heavy, as the assumed-swap path says
      this._puBackPending = null;   // A56 r3: the player's own confirmed swap supersedes a pending switch-back
      this._recoilArm('swap (confirmed)');   // S42: the new slot's weapon gets its own profile, at its ceiling
    }
    this._prevAmmo[slot] = mag;
    if (puBack != null) {   // A56: the heavy ran dry and the node put the saved weapon back on the trigger: show THAT
      if (reserve != null && !Number.isNaN(reserve)) this._prevReserve[slot] = reserve;
      this._publishAmmo(puBack, this._prevAmmo[puBack], this._prevReserve[puBack]);
      return;
    }
    this.activeSlot = slot;
    // S42/F259: recoil is stepped by `_acctSpent`, off the ACCOUNT above, never off this raw decrement.
    // The node's own `$WEAP` reset and `$AMMO` restore arrive here as a 26-round drop that no player fired
    // (bench 2026-09-18), and reading the frame delta booked it as a burst -- see the echo-window note.
    if (reserve != null && !Number.isNaN(reserve)) this._prevReserve[slot] = reserve;
    this._publishAmmo(slot, mag, reserve);
    // heat itself is recorded at the top of this function, before the stunned return.
  }

  _onHp(hp, armor, shield, solicited = false) {
    this._puHpAt = this.now();   // A56 polish M1: the pools a `$HIR` moved have been reported
    this.poolSrc = 'gun';                     // R2-3: same as $LCD -- this pool is the gun's own word
    if (hp > 0) this._armedThisLife = true;   // B5: the gun has now confirmed a life on the wire -- the settle window is over
    // Damage drains shield -> armor -> HP (bench 2026-08-27). Omitting shield from the
    // total made every shield-absorbed hit compute dmg === 0, which the guard below then
    // dropped entirely -- no hit_taken fact, no HUD feedback, no score. See FOLLOWUPS Q12.
    if (shield === undefined) shield = this.shield;
    const before = this.hp + this.armor + this.shield;
    const pools0 = { health: this.hp, armor: this.armor, shield: this.shield };   // S16: what `dmg` measures from, read by the echo match
    if (this._prevHp === undefined) { this._prevHp = this.hp; this._prevArmor = this.armor; this._prevShield = this.shield; }
    // A16 §3.1/§5: which pool actually moved -- health, then armour, then shield (mirrors poolgauge.changed_pool:
    // BRX depletes shield -> armour -> health, so when a hit spills across two pools the INNER one is the
    // news). Computed here, BEFORE `_prevHp` etc are overwritten below, and read by `_gunPoolPaint`.
    const movedPool = hp !== this._prevHp ? 'health' : armor !== this._prevArmor ? 'armor' : shield !== this._prevShield ? 'shield' : null;
    this.hp = hp; this.armor = armor; this.shield = shield;
    this._puShieldFrame(shield);   // A56: the overshield ends when the shield is back to where it started
    const dmg = Math.max(0, before - (hp + armor + shield));
    if (dmg > 0) this._actSeq++;   // pl4: nor past a hit
    // S16: the `$HP` that answers our own poison tick is the TICK, not a hit -- no `hit_taken` fact (MC would score a
    // hit nobody fired), no pain grunt, no hit flash. It is the tick's echo when it lands inside DOT_ECHO_MS of the
    // write AND the tick's pool is the only pool that moved, by exactly the tick. A negative floors at 0, so the tick
    // moves the pool by `min(n, what the pool held before this frame)`. A real hit moves a different amount or a
    // different pool, so it reads as a hit whichever order its `$HIR` and `$HP` take around the tick.
    const dotEcho = !!(dmg > 0 && this._dotEcho && this.now() - this._dotEcho.at <= DOT_ECHO_MS
      && dotEchoMatches(this._dotEcho, pools0, { health: hp, armor, shield }));
    if (dotEcho) this._dotEcho = null;
    // S56: a poison tick is not a `hit_taken` fact (see the guard below), but it is still damage the ledger
    // owes the poisoner -- `this.poison.by` is still the applier here, ahead of any `_death`/`_poisonClear`.
    if (dotEcho && this.poison && this.poison.by) { this._lifeBookDot(this.poison.by.num, this.poison.by.team, dmg); if (this._dotKill) this._dotKill.booked = true; }
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
    let hitWeapon = null;   // S56 "what hit me": set inside the hit_taken block below, read by the HUD 'hit' moment further down
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
        const lg = (this._lightGen = this._lightGen || 0);   // teardown snapshot: match end/panic/BLE drop must not let this land late
        this.delay(HURT_DEBOUNCE_MS, () => {
          if (!this._pendingHurtWrite) return;   // cancelled by a death that landed first
          this._pendingHurtWrite = false;
          if (this._lightGen !== lg || !this.alive || this.ended) return;   // match ended/panicked/relinked during the debounce window (review 2026-09-19)
          this._hsGen = (this._hsGen || 0) + 1; this._write(fr, 'low health');   // cancels a pending hit-flash rest step (polish 2026-09-04)
        });
      }
    }
    if (this.phase === 'live' && this.spawned && this.alive && this.hp > 0 && dmg > 0 && !this.tutorial && !dotEcho) {
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
    if (this.phase === 'live' && this.spawned && this.latch && this.now() - this.latch.at <= 1000 && dmg > 0 && !this.tutorial && !dotEcho) {
      // `sensor` is $HIR tok1: 0-3 are ALL HEADSET sensors (it has four; 0 = front and 1 = back are
      // bench-mapped, 2 and 3 are not), 4 = gun body. It was parsed
      // and dropped, so MC could not see WHICH sensor caught a hit — answering that took the phone's
      // raw frame ring (field 2026-09-01). One field, and the question becomes readable live.
      const prior = this._lastHitFact, now = this.now();
      const candidates = this._dualEmitters.filter(s => Number(s.proto) === this.latch.ir_proto && Number(s.subtype) === this.latch.ir_subtype);
      const valuesMatch = !!candidates.find(s => Number(s.body) === prior?.dmg && Number(s.headset) === dmg);
      const equalDual = candidates.find(s => Number(s.body) === Number(s.headset) && Number(s.body) === dmg
        && prior && prior.dmg === dmg && now - prior.at <= 150 && Number(s.cycle_ms) > 150);
      const paired = prior && now - prior.at <= 150 && prior.shooter_num === this.latch.shooter_num
        && prior.ir_proto === this.latch.ir_proto && prior.ir_subtype === this.latch.ir_subtype
        && prior.crit === this.latch.crit && (valuesMatch || !!equalDual);
      const shot_group = paired ? prior.shot_group : `${this._hitGroupEpoch}:${++this._hitGroupSeq}`;
      // S56 "what hit me": resolved off THIS word's own `mag` -- a dual-emitter pair's second word carries a
      // different magnitude from the first (e.g. body vs headset), and the roster's `hir` list covers both, so
      // resolving per word rather than once per shot_group still converges on the one weapon. NEVER guessed:
      // an ambiguous resolution never reaches the fact (MC would rather show nothing than the wrong gun), only
      // the HUD's own "could be either of" line below.
      // Integration pass 2026-09-23: on the killing blow the gun can report the victim's REMAINING pool in token 5
      // instead of the weapon's own value (the overkill clamp, protocol/brx-protocol.md `$HIR` token 5), and that
      // number can match some other catalogue weapon ("AMR · PICKUP"). The clamp is recognisable: token 5 equals the
      // whole pool held before the hit. Only then does the word keep just an exact loadout match; otherwise it takes
      // the weapon this shooter was already resolved to this life, else it names nothing.
      const clamped = hp <= 0 && this.latch.mag === pools0.health + pools0.armor + pools0.shield;
      const resolved = clamped ? this._lethalWeapon(this.latch.shooter_num, this._resolveHitWeapon(this.latch)) : this._resolveHitWeapon(this.latch);
      hitWeapon = resolved && resolved.weapon_id != null ? { id: resolved.weapon_id, name: resolved.name, source: resolved.source }
        : resolved && resolved.ambiguous ? { ambiguous: true, names: resolved.candidates.map(id => { const row = this.weaponRow(id); return (row && row.name) || id; }) }
        : null;
      this.emitFact({ type: 'hit_taken', match_id: this.matchId, shooter_num: this.latch.shooter_num,
        shooter_team: this.latch.shooter_team, dmg, ir_proto: this.latch.ir_proto, ir_subtype: this.latch.ir_subtype,
        sensor: this.latch.sensor, shot_group, ...(resolved && !resolved.ambiguous && resolved.weapon_id != null ? { weapon_id: resolved.weapon_id } : {}) });
      this._lastHitFact = { at: now, shooter_num: this.latch.shooter_num, ir_proto: this.latch.ir_proto,
        ir_subtype: this.latch.ir_subtype, crit: this.latch.crit, dmg, shot_group };
      this.lastHitAt = this.now();
      this._lifeBookHit(this.latch.shooter_num, this.latch.shooter_team, dmg, shot_group, resolved, { sensor: this.latch.sensor, crit: this.latch.crit });   // S56: the per-life "what hit me" ledger
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
      else if (dotEcho) { /* S16: a poison tick is not a hit; the HUD's poison pill carries it */ }
      else if (dmg > 0 && hp > 0) {
        // A death sets its own 'down' moment; a hit that kills must not flash "hit" first.
        this.moment = { kind: 'hit', at: this.now(),
          data: { dmg, shooter_team: this.latch ? this.latch.shooter_team : 0,
                  // the KEY, not the tid: the engine already owns tid->key (TEAM_KEY), and a second
                  // copy of that mapping in the HUD is a divergence waiting to happen
                  shooter_key: TEAM_KEY[this.latch ? this.latch.shooter_team : 0] || 'red',
                  // S56 "what hit me": {id, name, source} resolved, {ambiguous: true, names} two-or-more
                  // candidates share the magnitude, or null (no claim, or an unknown magnitude) -- set above
                  // in the hit_taken block, which always runs first (same `dmg > 0` gate) when this fires.
                  sensor: this.latch ? this.latch.sensor : null, hp, armor, shield, weapon: hitWeapon } };
      } else if (before > 0) {
        // Pools went UP: a heal, an armour pickup, or a shield grant. `before > 0` keeps the
        // spawn/respawn refill out of it — that has its own 'redeploy' moment.
        const gains = [['health', hp - this._prevHp], ['armor', armor - this._prevArmor],
                       ['shield', shield - this._prevShield]].filter(g => g[1] > 0);
        // F348: the gun's answer to the spawn fill. The life started full; this is not a pickup or a recharge.
        const fillEcho = gains.length && gains[0][0] === 'shield' && this._shieldFillAt && this.now() - this._shieldFillAt <= SHIELD_FILL_ECHO_MS;
        if (fillEcho) {
          if (shield >= this.maxShield) { this._shieldFillAt = 0; this._shieldCharged(); }
          this.log(`spawn shield fill: ${shield}/${this.maxShield}`, 'li');
        } else if (gains.length) {
          gains.sort((a, b) => b[1] - a[1]);
          this.moment = { kind: 'gain', at: this.now(),
            data: { pool: gains[0][0], amount: gains[0][1], hp, armor, shield } };
          // S29/S45: a RECHARGE is several `$LIFE` grants (F349: 4, a second apart) and the gun plays one clip at a time,
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
          // Tony 2026-09-24: no voice line when the shield comes back online. Its lights stay; the line is gone.
          if (kind === 'shield_online') this._eventLeds(kind);
          else if (kind) this._announceStatus(kind);   // A11; docs/announcer.md: a pool voice line waits its turn
        }
      }
    }
    this._prevHp = hp; this._prevArmor = armor; this._prevShield = shield;
    this._audioSync();   // the shield loop plays while the shield is above 0
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

  _death(desync, reason = null) {
    // F209: one death per life. Every caller checks `alive` too; this makes it hold for any future caller, so a
    // burst of lethal frames can never book a second death fact, a second deaths++ or a new respawn clock.
    if (!this.alive) return;
    this._armPending = null; this._triggerPending = null;   // F209: never arm a dead gun; the revive protects and arms again
    { const scream = this._psetSounds && (this._psetSounds[10] || '').trim(); if (scream && CLIP_MS[scream]) this._gun.add(CLIP_MS[scream], `native death scream ${scream}`, this.now(), scream); }   // the gun screams on its own: it joins the FIFO
    // 2026-09-19: killed this soon after a timed respawn = spawn-killed; the down-screen warning gets louder (never quieter).
    if (this._timedLifeAt != null && this.now() - this._timedLifeAt <= SPAWN_KILL_WINDOW_MS && this._downWarn < DOWN_WARN_MAX) { this._downWarn++; this.log(`killed ${Math.round((this.now() - this._timedLifeAt) / 100) / 10}s after a timed respawn: down warning level ${this._downWarn}`, 'li'); }
    this._timedLifeAt = null;
    this._shieldRegen = null; this._shieldDown = false;   // S29: a dead gun is not refilled, and the heartbeat stops with the life
    this.reloading = null; this.switching = null; this._reloadOutcome = null; this.held = {};   // the gun stops the reload/swap when you drop; so does the HUD
    // S16: a death straight after our own poison tick, with no newer `$HIR` behind it, is the TICK's kill, and the
    // kill goes to the player who last applied the poison (Tony, 2026-09-18). A newer latch means a real hit landed
    // after the tick, and that hit is the kill.
    // Integration pass 2026-09-23: "newer" means a newer DAMAGING hit (`_lastHitFact`, stamped only when a hit moved
    // a pool), not any latch: a smoke, EMP or Breacher word latches too, and one landing between the lethal tick and
    // its `$LCD` used to hand the kill to a player who did no damage.
    const dk = this._dotKill && this.now() - this._dotKill.at <= DOT_KILL_MS && (!this._lastHitFact || this._lastHitFact.at < this._dotKill.at) ? this._dotKill : null;
    this._dotKill = null; this._dotEcho = null;
    this._poisonClear('died'); this._smokeClear('died');   // S16/S53: neither survives a life
    // S56: snapshot the life just ended (`state()`'s `lastLife`, kept until the NEXT death) before resetting
    // for whatever comes next -- a normal down, or (below) an infection flip, which is itself a new life and
    // must not carry the old one's numbers.
    if (dk && !dk.booked && dk.dmg > 0) this._lifeBookDot(dk.num, dk.team, dk.dmg);   // the lethal tick: answered by $LCD, so no echo booked it
    this._life.deathAt = this.now(); this._lastLife = this._life; this._resetLifeLedger();
    const fresh = dk ? true : this.latch && this.now() - this.latch.at <= C.DEATH_LATCH_MS;
    const shooter_num = dk ? dk.num : fresh ? this.latch.shooter_num : 0;
    const shooter_team = dk ? dk.team : fresh ? this.latch.shooter_team : (this.latch ? this.latch.shooter_team : 0);
    // F81: wire id 0 is "no identity" (A5.1) -- a grenade hill's ambient damage word (F69) or a gun whose `$PSET`
    // never landed (F80). Its team field is the hill's OWNER, so naming that team as the killer told the player a
    // specific lie ("KILLED BY GREEN" when nobody shot them). MC already refuses to credit wire 0; the phone now
    // says the killer is unknown. A stale latch (older than DEATH_LATCH_MS) is the same case: nobody we can name.
    const unknown = !fresh || shooter_num === 0;
    this.alive = false; this.deaths++; this.deadAt = this.now(); this.downReason = reason; this._downRearmSent = false;   // §3.2: fresh rearm gate for this life
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
    this._puDeath();             // A56: a weapon item's charges are lost and the overshield is gone
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
    if (dk) this.killedBy.dot = true;   // S16: the DOWN screen says POISONED BY
    // Tony 2026-09-24: "melee kills should be a medal". The killing blow is the last DAMAGING hit (`_lastHitFact`,
    // stamped only when a hit moved a pool), not the raw latch: a smoke or EMP word landing between the melee blow and
    // the `$HP,0` re-latches without doing damage (the same trap `dk` avoids above). Proto 13 is melee.
    const lh = this._lastHitFact;
    const melee = !dk && fresh && !!lh && lh.ir_proto === 13 && lh.shooter_num === shooter_num && this.now() - lh.at <= C.DEATH_LATCH_MS;
    this.emitFact({ type: 'death', match_id: this.matchId, shooter_num, shooter_team, ...(desync ? { desync: true } : {}), ...(dk ? { dot: true } : {}), ...(melee ? { melee: true } : {}) });
    const flipTable = (this._respawnProfile() && this._respawnProfile().team_flip) || (this.frames && this.frames.team_flip);   // 2026-09-19: the timed-profile bursts
    let irFlip = false;   // S57: true once this death turns out to BE an infection flip, not a real death (see below)
    if (this.config && this.config.mode === 'infection' && flipTable) {
      const tids = Object.keys(flipTable).filter(k => Number(k) !== this.teamTid);
      // Whether a mid-match $TID write changes the gun's own friendly-fire resolution is UNTESTED (modes §9); MC scores via team_change regardless.
      if (tids.length) {
        irFlip = true;
        const tid = Number(tids[0]); this._write(flipTable[tids[0]], 'team_flip'); this._armAfterSpawn(true); const protectMs = this._protectOwedMs(); this.emitFact({ type: 'team_change', match_id: this.matchId, tid, ...(protectMs ? { protect_ms: protectMs } : {}) });   // F289: a flip respawns the gun protected too
        this._turned = true;
        this._announceAlert('infected', null, { hud: false });   // A11.4: HUD-driven -- this gun just turned; MC's broadcast only tells the OTHERS
        // A16 §3.3/finding #4: infection is not a real death (the player "re-takes the body" immediately),
        // so the turned player's held headset colour is assigned right here, through the role mechanism,
        // instead of the one-shot events table that a hit later wipes with nothing to restore it.
        this._setRole('infected', true, tid);
        const tm = ((this.config && this.config.teams) || []).find(x => Number(x.tid) === tid);
        this.team = tm ? { ...tm } : { ...(this.team || {}), tid, team_id: `tid-${tid}`, name: TEAM_NAME[tid] || `TEAM ${tid}` };
      }
    }
    // S57 (docs/ir-callouts.md): tell every gun in range, once, over IR -- presentation only, one write, never
    // retried. Skipped on an infection flip (`irFlip` above): that is not a real death for this player, so
    // there is nothing to call out. `player` is the killer for DOWN_BY, or our own num for a bare DOWN (killer
    // unknown, or we killed ourselves — S16 DOT deaths DO have a killer, the poisoner, and get DOWN_BY too,
    // since `killedBy` already carries the applier there); the magnitude always carries OUR OWN team, because
    // the sender is always the victim. `frames.callout_team` (MC's pick, an id nobody plays) rides in the
    // word's team field so friendly-fire-off still delivers it to enemies; falling back to our own tid keeps
    // an OFF gun immune to its own team's word instead, so teammates stay silent (the doc's "all four team ids
    // in use" case) -- see `_onIrCallout`'s comment for why that field is otherwise unread on receipt.
    if (!irFlip && reason !== 'gun_recovery' && this.phase === 'live' && this.bleUp) {   // a gun-recovery DOWN is a power-cycle, not a kill: announcing it would tell every gun someone was shot
      const myNum = this.player && this.player.player_num, myTid = this.teamTid;
      if (myNum != null && myTid != null) {
        const selfOrUnknown = this.killedBy.unknown || this.killedBy.num === myNum;
        const player = selfOrUnknown ? myNum : this.killedBy.num;
        const magnitude = (selfOrUnknown ? IR_CALLOUT.DOWN : IR_CALLOUT.DOWN_BY) + myTid;
        const calloutTeam = typeof (this.frames && this.frames.callout_team) === 'number' ? this.frames.callout_team : myTid;
        const sent = this._write([`$IRTX,${IR_CALLOUT.DIRECTION},${IR_CALLOUT.PROTO},${player},${calloutTeam},${magnitude},0,${IR_CALLOUT.SUBTYPE},100,1,,0,*`], 'S57 IR callout');
        // S57 names (Tony 2026-09-24): a DOWN_BY names only the killer, so a second word, DOWN naming ME, follows it
        // for every receiver to pair (see `_onIrCallout`). Once, through the normal write path, never retried.
        if (!selfOrUnknown) {
          const down = `$IRTX,${IR_CALLOUT.DIRECTION},${IR_CALLOUT.PROTO},${myNum},${calloutTeam},${IR_CALLOUT.DOWN + myTid},0,${IR_CALLOUT.SUBTYPE},100,1,,0,*`;
          const lg = this._lightGen;
          // The gap runs from when the FIRST word was actually written (the link's write resolves once the frame is on
          // the wire), never from this call: queued behind the death burst, a gap timed from here left 186 ms between
          // the two on the wire, inside the headset's 199 ms one-shot guard, and the name word never arrived.
          const after = () => this.delay(CALLOUT_NAME_GAP_MS, () => { if (this._lightGen === lg && this.phase === 'live' && this.bleUp) this._write([down], 'S57 IR callout: the victim\'s name'); });
          if (sent && typeof sent.then === 'function') sent.then(after, after); else after();
        }
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
    this._write(['$AMMO,0,0,0,1,*', '$AMMO,1,0,0,1,*', ...(this._puHeld ? [`$AMMO,${this._puHeld.slot},0,0,1,*`] : [])], 'reconcile: disarm');   // no shots count while we reconcile; A56: nor a held heavy's
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
      const ammo = this._puRearmRows(((this.frames && this.frames.spawn) || []).filter(f => f.startsWith('$AMMO,')));   // A56: a held heavy keeps its charges
      if (ammo.length) {
        this._write(ammo, 'reconcile: re-arm');
        if (this._puBackPending) { this._puBackPending.tries = 0; this._puBackResend(this.now(), 'after the reconcile'); }   // A56 r2 M1: the re-arm is not the switch-back
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
      // F289: true-only while the phone still owes the write that ends spawn protection.
      ...(this._protectOwedMs() ? { protected: true } : {}),
      // During an active relink/head retry the player is already doing the right thing: KEEP POWER ON. Clear
      // MC's positive POWER-CYCLE claim until recovery either succeeds or spends its retry budget.
      ...(this.gunLocked && (!this._gunRecovery || (this._gunRecovery.nextAt == null && !this._gunRecovery.writing)) ? { gun_locked: true } : {}),
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
      phase: this.phase, bleUp: this.bleUp, gunFlapping: this.gunFlapping, headsetJoin: this.headsetJoin, wsState: this.wsState, wsReason: this.wsReason || null, gun: this.gun, night: this.night,   // QA-08: the HUD reads MC's refusal reason (the chip and the READY note both asked for it and got undefined)
      nightOps: !!(this.config && this.config.night),
      player: this.player, team: this.team, teamKey: this.teamKey, teamName: this.team ? (this.team.name || TEAM_NAME[this.team.tid] || '').toUpperCase() : '',
      callsign: this.player ? this.player.display : '', playerNum: this.player ? this.player.player_num : null,
      mode: this.config ? String(this.config.mode || '').toUpperCase() : '', weapon: this.weaponName,
      hp: this.hp, armor: this.armor, shield: this.shield, maxHp: this.maxHp, maxArmor: this.maxArmor, maxShield: this.maxShield, ammo: this.ammo, reserve: this.reserve, mag: (this._puOnHeavy() ? this._puHeld.charges : (this._ammoBySlot()[this.activeSlot] ?? this.mag)),   // A56: a held item's denominator is its charges
      // S29 shield meter (2026-09-24): a READ-ONLY view of the recharge so the phone can draw the engine's real
      // timing (the delay since `quietAt`). null in a game with no shield. It changes no rule.
      // `down` = the shield BROKE this life (a spawn at 0 has not); `paused` = `_shieldTick`'s own stand-down, when no refill runs.
      shieldRegen: this.maxShield > 0 ? { on: this.shieldRegenOn, delayMs: SHIELD_REGEN_DELAY_MS, quietAt: this._shieldQuietAt || 0,
        charging: !!this._shieldRegen, down: !!this._shieldDown, gaveUp: !!this._shieldGaveUp,
        // F349: the running recharge's clock, so the meter fills smoothly: `from` at `startedAt`, max at `fullAt`
        ...(this._shieldRegen ? { startedAt: this._shieldRegen.startedAt, from: this._shieldRegen.from, step: this._shieldRegen.step, fullAt: this._shieldRegen.fullAt } : {}),
        paused: !!this._standDown(['phase', 'spawned', 'ble', 'alive', 'reconciling', 'resync', 'tutorial', 'stunned']) } : null,
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
      // Published for MC and the bench (`statusBody` carries `pool_stale`/`cure` too); F288 also renders
      // `no_fire` / `no_answer` on the live phone HUD so the player can bring the host the proven failure.
      poolStale: this.poolStale(now), cure: this.cure, gunLocked: !!this.gunLocked,
      gunRecovery: this._gunRecovery ? (this._gunRecovery.nextAt == null && !this._gunRecovery.writing ? 'retry_exhausted' : 'rearming') : null,
      respawnType: this.respawnType, respawnAuto: this.timedRespawn, killedBy: this.killedBy, downReason: this.downReason, underFire: this.alive && this.lastHitAt > 0 && (now - this.lastHitAt) < 2000, respawnIn: (!this.alive && this.deadAt && this.timedRespawn) ? Math.max(0, Math.ceil((r - (now - this.deadAt)) / 1000)) : 0,
      // utility.md: the respawn station this player would use, how close it reads, and what the DOWN screen should say
      station: stationView(this._respawnStation()), respawnGate: this.respawnGate, respawnHint: this.respawnHint(now),
      // 2026-09-19 respawn profiles: `weaponArming` = ms until a timed life's trigger goes live (null once it has);
      // `shielded` = a station life's protection is showing; `downWarn` = the down-screen warning level 1..3.
      weaponArming: this._triggerPending && this.alive ? Math.max(0, this._triggerPending.due - now) : null,
      shielded: !!(this._armPending && this._armPending.shield && this.alive), downWarn: this._downWarn,
      // F72: the most recent grenade/station beacon (proto-15 $HIR) — owner team + magnitude (8 hill, 6 respawn),
      // null once nobody has reported one this life. Not `station` above: that is BLE advert presence, this is IR.
      beacon: this.beacon || null,
      callout: this.callout || null,   // S57: {kind: 'kill_confirmed'|'enemy_down'|'teammate_down', name, team, at, by?, victim?} — `victim` arrives with the paired DOWN word — cleared in tick() above; `by` = the killer a DOWN_BY word named (QA-05)
      hillCallout: this.hillCallout || null,
      // docs/announcer.md "The three lanes": {hero: {id, kills: [{victim, team, medals, src, at}], lastAt}, heroUntil,
      // obj: {lead?, hill?: {kind, text?, src, at}}, feed: [{kind, alert?, name?, team?, by?, text?, sub?, color?, src, at}]}
      lanes: this._lanes ? { ...this._lanes, heroUntil: this._heroUntil(now) } : null,
      announcer: this._ann.view(now),   // docs/announcer.md: {kind, at, ms, queued: [kind…]}: what is on air and what waits (null when idle)
      // A56 (docs/spec/powerups.md): null unless the config carries powerup items. `powerup` = {hint, held, overshield};
      // `powerupSpawn` = {name, color, at} for the "<ITEM> AVAILABLE" card; `powerupGrant` = {name, color, kind, at, replaced?};
      // `powerupSwap` = {name, color, replaced, at} for the swap card. The two cards are set by the announcer queue (docs/announcer.md).
      powerup: this.powerupView(now), powerupSpawn: this.powerupSpawn || null, powerupGrant: this.powerupGrant || null, powerupSwap: this.powerupSwap || null,
      // A56 claim: {station, claiming, ready, progress} while this phone stands in range of an item that is there. app.js
      // turns it into the player advert's `claiming` / `claim_ready` bits with the station id in `value`.
      powerupClaim: this._puClaim && this._puItems() ? { station: this._puClaim.station, claiming: true, ready: this._puClaim.readyAt != null,
        progress: Math.min(1, (now - this._puClaim.since) / POWERUP_DWELL_MS) } : null,   // QA-05: {kind: 'hill_captured'|'hill_lost', at}, the transition `_hillSay` just announced; presentation only, cleared in tick()
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
      weaponId: this._puOnHeavy() ? this._puHeld.weapon_id : (() => { const ws = this.player && this.player.loadout && this.player.loadout.weapons; const w = ws && (ws[this.activeSlot] || ws[0]); return w ? w.weapon_id : null; })(),
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
      stunned: this.stunned ? { until: this.stunned.until, leftMs: Math.max(0, this.stunned.until - now) } : null,
      // S16: the poison pill's input. `by` names the applier, who gets the kill if a tick finishes the player.
      poison: this.poison ? { leftMs: Math.max(0, this.poison.until - now), durMs: this.poison.durMs, perTick: this.poison.per, tickMs: this.poison.tickMs, ticks: this.poison.ticks,
        by: { num: this.poison.by.num, team: this.poison.by.team, name: this.nameOf(this.poison.by.num), teamKey: TEAM_KEY[this.poison.by.team] || null } } : null,
      aim: this._aimView(now),   // S53/S55: why accuracy is held down ({reason, acc, leftMs}), or null   // F15: the HUD's STUNNED takeover reads this
      // read ONCE: two calls could straddle the expiry and disagree (switching:true, switchingMs:null)
      ...(ms => ({ switching: ms != null, switchingMs: ms }))(this.switchingMs()),
      switchWindowMs: this.switchWindowMs(), lastSwitchMs: this.lastSwitchMs, activeSlot: this.activeSlot,
      switchFrom: this.switching ? this.switching.from : null, switchTo: this.switching ? this._nextAltSlot(this.switching.from) : null,
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
      hits: this.score ? this.score.hits : null,
      board: (() => { const s = this.config && this.config.scoring; const b = this.score ? this.score.board : null; const killScored = !!(s && (s.win_by == null || s.win_by === '' || s.win_by === 'kills')); return !killScored && b && typeof b === 'object' ? { ...b, cap: null } : b; })(),
      fragLimit: (() => { const s = this.config && this.config.scoring; return s && (s.win_by == null || s.win_by === '' || s.win_by === 'kills') ? s.frag_limit : null; })(),
      lives: (this.config && this.config.respawn && this.config.respawn.lives != null) ? Math.max(0, this.config.respawn.lives - this.deaths) : null,
      // A24: the pushed result and WHERE WE ARE IN WAITING FOR IT. `resultWait` is 'in' | 'pending' | 'unreached';
      // none of the three is an outcome, and there is deliberately no fourth value the HUD could read as "lost".
      result: this.result, resultAt: this.resultAt, resultWait: this.resultWait(now), endedAt: this.endedAt,
      moment: this.moment, card: this.card || null, ended: this.ended, endAck: this.endAck, matchId: this.matchId, synced: this.isSynced(), headEcho: this.headEcho,
      rejoin: !!(this.start && !this.bleUp && this.phase === 'idle'), pendingTeardown: this.pendingTeardown,
      // A10 self-serve kitting
      catalog: this.catalog, policy: this.policy, loadout: this.loadoutView(), browsing: this.browsing, loadoutAck: this.loadoutAck, pendingPick: this.pendingPick,
      canPickPrimary: this.canPick('primary'), canPickSecondary: this.canPick('secondary'), canPickPerk: this.canPick('perk'), tryoutSeen: this.tryoutSeen,
      game: this.game, kitOpen: this.kitOpen(), briefSeen: this.briefSeen, kitLocked: this.kitLocked,
      standby: !!this.standby,   // T2-B item 2: benched — the HUD shows SITTING OUT instead of the kit/lobby screen
      // S56 "what hit me": this life's damage taken/dealt breakdown, and the one just finished (kept until
      // the NEXT death). Each is `{taken, dealt, takenTotal, dealtTotal, dealtPartial}`; `taken`/`dealt` rows
      // are sorted by `dmg` descending. `dealtPartial` is true while MC's best-effort relay could still be
      // catching up (the link has dropped this life, or -- for `lastLife` only -- death was under 2 s ago).
      life: this._ledgerSnapshot(this._life, false),
      lastLife: this._lastLife ? this._ledgerSnapshot(this._lastLife, true) : null,
    };
  }
}
