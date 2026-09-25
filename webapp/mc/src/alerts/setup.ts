// F221: the alerts this lane's screens render, by the audit id. See ./index.ts for the rule.
//
// Lane files: screens/Kit.tsx, screens/Items.tsx, ui/Powerups.tsx, screens/Designer.tsx,
// screens/AdvancedPresentation.tsx, screens/HealthPresetEditor.tsx.
import type { AlertDef } from './index';

export const SETUP_ALERTS: Record<string, AlertDef> = {
  // F366 landed on main after the audit: the gamertag length hint. Over the limit the tag is refused (fix
  // it before the match); inside the soft band it is status only.
  'kit-tag-too-long': { sev: 'amber', text: '{N} OF {MAX} CHARACTERS: SHORTEN IT' },
  'kit-tag-may-shorten': { sev: 'neutral', text: '{N} OF {MAX} CHARACTERS: MAY BE SHORTENED ON THE PHONE HUD' },
  // ---- DESIGNER (Advanced panel) — AdvancedPresentation.tsx --------------------------------------
  'adv-confidence-armed': { sev: 'neutral',
    text: 'MC CONFIDENCE GATE ARMED: MC-DRIVEN GLOBAL EVENTS (LEAD, NEXT KILL WINS, LAST SURVIVOR) ARE SENT ONLY WHILE EVERY HUD IS CONNECTED, FRESH AND FLUSHED; CHECKED AT EACH EVENT. RIGHT NOW: {counts}' },
  'adv-confidence-gate-off': { sev: 'neutral',
    text: 'MC CONFIDENCE GATE OFF: MC-DRIVEN GLOBAL EVENTS ARE SENT REGARDLESS OF WHO IS CONNECTED. RIGHT NOW: {counts}' },
  'adv-mc-events-off': { sev: 'neutral', text: 'MC-DRIVEN EVENTS OFF: THIS GAME SENDS NO LEAD / NEXT KILL WINS / LAST SURVIVOR CALLS' },
  'adv-not-confident': { sev: 'red',
    text: 'MC NOT CONFIDENT: MC-DRIVEN GLOBAL EVENTS ARE WITHHELD. OFFLINE: {names} · STALE: {names} · UNFLUSHED: {names}',
    why: "a gun/phone link problem DURING a match is Tony's own RED example, not amber." },
  'adv-load-failed': { sev: 'amber', text: 'COULD NOT LOAD THE PRESENTATION PROFILE: {msg}' },
  'adv-loading': { sev: 'neutral', text: 'LOADING…' },
  'adv-server-old': { sev: 'amber', text: "MC SERVER IS OLDER THAN THIS CONSOLE: RESTART MC. IT HAS NO `/api/presentation`." },

  // ---- DESIGNER — Designer.tsx --------------------------------------------------------------------
  'designer-blocked-banner': { sev: 'red', text: '{blockedReason}' },
  'designer-name-it-first': { sev: 'neutral', text: 'NAME IT FIRST' },
  'designer-old-version': { sev: 'amber', text: "TONIGHT'S GAME STILL RUNS THE OLD VERSION" },
  'designer-pick-objective': { sev: 'amber', text: 'PICK AN OBJECTIVE SOURCE: THE SERVER REFUSES THIS MODE WITHOUT ONE.' },
  'designer-plays-without-saving': { sev: 'neutral', text: 'PLAYS TONIGHT WITHOUT SAVING: NAME IT ABOVE TO KEEP IT ON THE SHELF' },
  'designer-preview-off': { sev: 'amber',
    text: 'MC SERVER IS OLDER THAN THIS CONSOLE: RESTART MC. RULES PREVIEW LOCALLY, BUT SAVE / PLAY WILL FAIL UNTIL THEN.' },
  'designer-slot-empty-pool': { sev: 'red', text: "{SLOT}'S {FIXED PICK IS NOT IN THIS GAME | ALLOW-LIST NAMES NOTHING | CLASS/ID FILTERS EXCLUDE EVERYTHING | CANNOT BE PLAYED}" },

  // ---- ARMORY / ITEMS — screens/Items.tsx, ui/Powerups.tsx (audit's "ARMORY" screen, this lane's files) --
  'frame-health-preset-custom': { sev: 'neutral', text: 'CUSTOM' },   // NOT-ALERT would fit too; kept as a plain status tag, never amber-filled
  'frame-item-reset-error': { sev: 'red', text: 'RESET REFUSED: {err}' },
  'frame-powerup-err': { sev: 'amber', text: 'COULD NOT READ THE ITEM LIST: {msg}',
    why: 'a genuine fetch failure is worse than a capability-off fact, and must not share its neutral colour.' },
  'frame-powerup-predates': { sev: 'amber', text: 'MC SERVER IS OLDER THAN THIS CONSOLE',
    why: 'the audit proposed NEUTRAL for this one MC_OLDER render site, but every other one (CommandBar, AdvancedPresentation, Designer, Items) already shows the same MC_OLDER fact as AMBER: one fact, one severity, everywhere (F221 polish, 2026-09-25).' },
  // F221 polish (2026-09-25): a station out of Wi-Fi range is a normal, expected field state ("a
  // station needs no Wi-Fi once armed", H1 above) — the real fault, if there is one, is the separate
  // `station-attention-bring-back` amber line under LINK. NEUTRAL matches the same-shaped
  // `armory-amber-stale-link` on the gun card.
  'items-link-out-of-wifi': { sev: 'neutral', text: '{AGE} AGO: OUT OF WI-FI' },

  'items-apply-err': { sev: 'amber', text: 'NOT ARMED: {error}' },
  'items-itempicker-err': { sev: 'amber', text: 'COULD NOT READ THE ITEM LIST: {msg}' },
  'items-itempicker-loading': { sev: 'neutral', text: 'READING THE ITEM LIST…' },
  'items-itempicker-locked': { sev: 'neutral', text: "LOCKED FOR THE MATCH: RECALL OR END IT TO CHANGE THIS STATION'S ITEM" },
  'items-itempicker-old-mc': { sev: 'amber',
    text: 'MC SERVER IS OLDER THAN THIS CONSOLE: RESTART MC (`./start.sh`) TO GIVE A STATION AN ITEM. NO ITEM PICKER UNTIL THEN.' },
  'items-itempicker-powerups-off': { sev: 'neutral', text: 'POWERUPS ARE OFF ON THIS MC: THIS STATION ARMS WITH NO ITEM. TO GIVE IT ONE, RESTART MC WITH {flag}' },
  'items-need-attention-count': { sev: 'amber', text: '{N} NEED ATTENTION' },
  'items-pick-item-warning': { sev: 'neutral', text: 'PICK AN ITEM ABOVE' },
  'items-released-no-socket': { sev: 'neutral', text: 'NO SOCKET' },
  'items-rep-not-armed': { sev: 'neutral', text: '{KIND} {id} · {TEAM} · NOT ARMED',
    why: 'unassigned, this is a device-says-so status, not yet a fault to fix.' },
  'items-rep-not-armed-advertising': { sev: 'amber', text: '{KIND} {id} · {TEAM} · NOT ARMED · ADVERTISING' },
  'items-setup-conflict': { sev: 'red', text: '{friendly CONTROL_CONFLICT line}',
    why: "Tony names the KOTH grenade-vs-control conflict RED by name: the game is wrong." },
  'items-status-arm-pending': { sev: 'amber', text: 'ARM PENDING' },
  'items-status-not-assigned': { sev: 'neutral', text: 'NOT ASSIGNED' },
  'items-tag-locked': { sev: 'neutral', text: 'LOCKED' },

  // ---- KIT — screens/Kit.tsx ------------------------------------------------------------------------
  'kit-changed-from-phone': { sev: 'amber', text: 'CHANGED FROM THEIR PHONE: YOURS WAS {label}' },
  'kit-continue-refusal': { sev: 'amber', text: '{server error}: {names}: CONTINUE ANYWAY?' },
  'kit-continue-refused-force': { sev: 'red', text: 'MC REFUSED THE OVERRIDE: {said}',
    why: "an operator override the server itself will not honour: stop and look, not just fix-before-next-match." },
  'kit-continue-warn': { sev: 'amber', text: '{names} {IS|ARE} STILL KITTING AND WILL LOSE THEIR SCREEN: CONTINUE ANYWAY?' },
  'kit-easy-note-off': { sev: 'neutral', text: 'THE ALT BUTTON RELOADS, FOR A PLAYER WHO CANNOT WORK THE RELOAD LEVER. IT WINS NO FIGHTS: IT COSTS THE SECOND WEAPON.' },
  'kit-easy-note-on': { sev: 'neutral', text: 'ON PURPOSE: {NAME} RELOADS WITH THE ALT BUTTON, NOT THE LEVER. NO SECOND WEAPON, BECAUSE ALT CANNOT DO BOTH.' },
  'kit-no-node': { sev: 'amber', text: 'NO NODE',
    why: "a gun link lost pre-match (LOBBY/KIT) is Tony's AMBER bucket, not the RED 'lost during a match' one." },
  'kit-perk-unproven': { sev: 'neutral', text: 'UNPROVEN' },
  'kit-player-num-invalid': { sev: 'red', text: 'PLAYER NUMBER MUST BE 1–63' },
  'kit-pool-chip': { sev: 'neutral', text: '{hp}/{armor} POOL' },
  'kit-pool-note-off': { sev: 'neutral', text: 'SET A DIFFERENT POOL FOR THIS ONE PLAYER (A HANDICAP: A YOUNGER PLAYER, OR THE SOLO SIDE OF A 2V1).' },
  'kit-pool-note-on': { sev: 'neutral', text: 'ON PURPOSE: {NAME} IS ARMED AT {hp} HP / {armor} AR. EVERY OTHER PLAYER USES THE GAME POOL.' },
  'kit-primary-required': { sev: 'red', text: 'A PRIMARY IS REQUIRED' },
  'kit-range-log-issue': { sev: 'amber', text: 'RANGE LOG: {note}' },
  'kit-readiness-unknown': { sev: 'neutral', text: 'READINESS UNKNOWN' },
  'kit-roster-no-phone': { sev: 'amber', text: 'NO PHONE' },
  'kit-roster-restored-ghost': { sev: 'amber', text: 'RESTORED · NO PHONE',
    why: "matches Tony's 'a restored roster' bucket; the chip now says RESTORED rather than reusing NO PHONE unlabelled." },
  'kit-roster-trying': { sev: 'neutral', text: 'TRYING {weapon}' },
  'kit-slot-note-locked': { sev: 'amber', text: 'THE KIT LOCKED AT THE START OF THE MATCH. CHANGE IT AFTER THE WHISTLE.',
    why: 'a real constraint on the operator right now deserves colour, not grey.' },
  'kit-slot-note-phone-off': { sev: 'neutral', text: 'PHONE PICKS ARE OFF: YOU KIT EVERY PLAYER HERE' },
  'kit-slot-note-phone-picks': { sev: 'neutral', text: 'PLAYERS PICK ON THEIR PHONE: ANYTHING YOU SET HERE OVERRIDES IT AND SHOWS ON THEIR SCREEN' },
  'kit-tryout-banner': { sev: 'amber', text: "TRYING OUT ON {name}'S GUN: HAVE THEM FIRE A FEW ROUNDS · POINT AWAY FROM OTHERS" },
  'kit-tryouts-closed': { sev: 'neutral', text: 'TRY-OUTS CLOSED: THE GAME HAS BEEN PUSHED TO THE GUNS' },
  'kit-weapon-caution-hero': { sev: 'amber', text: '{caution}' },
  'kit-weapon-caution-icon': { sev: 'amber', text: '(WEAPON CAUTION ICON, TITLE = THE CAUTION SENTENCE)' },
};

/** Audit ids this lane retired as alerts: id -> why (removed, merged into another id's words, or now
 *  positive/data status). */
export const SETUP_RETIRED: Record<string, string> = {
  'adv-confident': 'positive live status, restyled T.ok — not an alert (NOT-ALERT).',
  'adv-sound-off-chip': 'a plain config fact chip, restyled neutral outline — not an alert (NOT-ALERT).',
  'adv-source-chip': 'a source-type classification tag, not a status — not an alert (NOT-ALERT).',
  'adv-switch-chip': 'a plain on/off status chip — not an alert (NOT-ALERT).',
  'designer-saved-ok': 'positive confirmation, restyled T.ok — not an alert (NOT-ALERT).',
  'designer-unsaved-leave': 'a two-tap drop-your-draft confirm; UNCHANGED per Tony\'s rule, left exactly as it is.',
  'frame-item-available': 'a positive status chip, already T.ok — not an alert (NOT-ALERT).',
  'frame-item-reset-confirm': 'a two-tap hazard confirm (hands out a heavy mid-match); UNCHANGED per Tony\'s rule.',
  'frame-switch-confirm': "the shared SwitchConfirm component (ui/index.tsx), not owned by this lane; UNCHANGED per Tony's rule (named explicitly). The doubled-▲-glyph issue the audit flagged is reported to the lane that owns ui/index.tsx, not fixed here.",
  'items-release-confirm': 'the shared SwitchConfirm two-tap hazard confirm; UNCHANGED per Tony\'s rule.',
  'items-released-sent': 'a positive/ok status tag, already T.ok — not an alert (NOT-ALERT).',
  'items-status-mc-armed': 'a positive/ok status tag, already T.ok — not an alert (NOT-ALERT).',
  'kit-easy-ask': 'a two-tap confirm (drops the other slot); UNCHANGED per Tony\'s rule.',
  'kit-easy-chip': 'an accent-coloured accessibility status chip, not a caution — not an alert (NOT-ALERT).',
  'kit-roster-ready': 'a positive status chip, already T.ok — not an alert (NOT-ALERT).',
  'kit-range-verdict-icon': 'a pass/fail QA marker, not a live-match alert — not an alert (NOT-ALERT); the fail glyph moved off T.bad to T.body per the NOT-ALERT rule (never T.warn/T.bad).',
  'kit-weapon-confirm-drop': 'a two-tap confirm (drops the conflicting slot); UNCHANGED per Tony\'s rule.',
};
