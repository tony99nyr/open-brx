// F221: the alerts this lane's screens render, by the audit id. See ./index.ts for the rule.
//
// LOBBY lane owns: screens/Lobby.tsx, screens/Games.tsx, screens/Armed.tsx, and the ui/ files behind
// them (PreArmSummary, SetupSteps, LoadedGame, GameEditPanel, OrphanMatch, UnrosteredPhones,
// Standby, ui/index.tsx's shared coverage/balance chips).
import type { AlertDef } from './index';

export const LOBBY_ALERTS: Record<string, AlertDef> = {
  // ---- ARMED ------------------------------------------------------------------------------------
  'armed-node-noack': { sev: 'amber', text: 'NO ACK' },
  'armed-nodes-summary': { sev: 'neutral', text: '{ARMED}/{TOTAL} NODES ARMED · {WAITING} AWAITING ACK · {OUT} OUT OF RANGE' },
  // Tony's rule names MC offline explicitly RED; this used to dim to 45% opacity with a grey label,
  // the single clearest colour-vs-rule mismatch the audit found. Now a red banner in the LIVE
  // screen's own words (MC_OFFLINE, imported, never re-typed).
  'armed-offline-synced': { sev: 'neutral', text: 'OFFLINE', why: 'the frame already shows the RED MC OFFLINE banner on every screen; a second red sentence on ARMED said one fact twice, so the countdown only notes OFFLINE as status (F221 round 2)' },
  'armed-reminder-line': { sev: 'neutral', text: 'GUNS COUNT DOWN ON THEIR OWN. PLAYERS MAY SCATTER OUT OF RANGE. ALL GO LIVE AT T-0. RESCHEDULE FURTHER OUT BEFORE THE WALK. AN ABORT REACHES ONLY NODES IN RANGE.' },
  // Sweep: an unacked node during the countdown, AND a node that acked but has since gone stale (no
  // longer reporting), are the same gun-link risk mid-match — Tony's RED example names exactly this.
  'armed-retrying': { sev: 'red', text: 'RETRYING · LAST SEEN {AGE}' },
  'armed-unsynced-suffix': { sev: 'amber', text: 'UNSYNCED' },
  'armed-no-schedule': { sev: 'neutral', text: 'NO SCHEDULE: PUSH CONFIG AND ARM FROM THE LOBBY.' },

  // ---- shared coverage chip (LOBBY header, ARMED header, ui/index.tsx) --------------------------
  'lobby-coverage-tag': { sev: 'neutral', text: 'INTERNET: {N} OF {M} PHONES', also: ['armed-coverage-tag'] },

  // ---- "N gun(s) cannot start" — one fact, three render sites ------------------------------------
  'lobby-status-line-red': { sev: 'red', text: '{N} GUN(S) CANNOT START', also: ['games-cannot-start-count', 'lobby-notonlystale-suffix'] },
  // Sweep: LOBBY's own rail status line was a bare `notReady.length || armDisabled ? T.warn : T.ok`
  // with no id at all: the audit's captured shot never caught it mid-wait. It covers several
  // different sentences (NOT READY YET, WAITING FOR EVERY GUN TO VERIFY…) that all share one fact,
  // the operator has something to do before ARM is live. One id, so the colour cannot drift again.
  'lobby-status-line-amber': { sev: 'amber', text: '{NOT READY YET, OR WAITING FOR CONFIG VERIFICATION}: {NAMES}' },

  'lobby-roster-fault-tag': { sev: 'red', text: '{A} V {B}: CANNOT PLAY' },
  'lobby-not-ready-tag': { sev: 'amber', text: 'NOT READY' },
  'lobby-updating-header': { sev: 'amber', text: '{N} UPDATING', also: ['lobby-updating-chip'] },
  'lobby-prepush-short': { sev: 'amber', text: 'ROSTER CANNOT PLAY / NO PLAYERS YET / {N} PHONE(S) NOT ARRIVED · {M} BLOCKED / {N} GUN(S) BLOCKED' },
  'lobby-arm-why-pushed': { sev: 'amber', text: '{VERIFICATION OR FAULT SUMMARY}' },
  // Same words as `lobby-arm-why-pushed`, printed a second time under the fault list, deliberately
  // quieter (kept NEUTRAL, not merged with the amber row above — the audit flags the inconsistency
  // but Tony's own two buckets keep them apart: one sits beside the disabled button, one is
  // supplementary detail already covered by the red/amber lines above it).
  'lobby-verification-lines': { sev: 'neutral', text: '{NO-ECHO OR PENDING-ACK SENTENCE}' },
  'lobby-override-tray': { sev: 'red', text: 'HOST OVERRIDE: {LABEL}' },
  'lobby-override-risk-block': { sev: 'red', text: '{N} GUN(S) {HAS|HAVE} NEVER TAKEN THIS CONFIG: {NAMES}', also: ['frame-arm-override-copy'] },
  'lobby-repush-btn-blocked': { sev: 'amber', text: 'RE-PUSH CONFIG OVER {N} BLOCKED ▸', also: ['games-repush'] },
  // Sweep: the BALANCED/UNBALANCED tag's own green half is NOT-ALERT (audit's captured state), but the
  // UNBALANCED half already renders T.warn in code and was never given its own id — a real "fix
  // before the next match" fact, not covered by the audit's single captured shot.
  'lobby-balance-tag-unbalanced': { sev: 'amber', text: '{A} V {B}: UNBALANCED' },
  'lobby-no-players-tag': { sev: 'neutral', text: 'NO PLAYERS YET' },
  'lobby-no-override-forceproof': { sev: 'neutral', text: 'CANNOT BE OVERRIDDEN: RE-PUSH CONFIG BEFORE THE COUNTDOWN' },
  'lobby-roster-no-override': { sev: 'neutral', text: 'CANNOT BE OVERRIDDEN: FIX THE ROSTER FIRST' },
  'lobby-ready-closed-note': { sev: 'neutral', text: 'MARK ALL READY OPENS ONCE THE CONFIG IS PUSHED. MC IS AT {PHASE}, NOT LOBBY.' },
  'lobby-inplay-banner': { sev: 'neutral', text: 'THE COUNTDOWN IS RUNNING. THIS LOBBY IS READ-ONLY.' },
  'lobby-no-phone-chip': { sev: 'neutral', text: 'NO PHONE' },
  'lobby-reach-lan-chip': { sev: 'neutral', text: 'LAN / INTERNET' },

  // ---- GUNS READY (QA-02, visual QA round 1, 2026-09-26) ----------------------------------------
  'lobby-guns-ready-line': { sev: 'amber', text: 'GUNS READY {N}/{M}' },
  'lobby-guns-not-ready-line': { sev: 'amber', text: '{STICKER} NOT READY: {WHAT}' },

  // ---- PreArmSummary ------------------------------------------------------------------------------
  'frame-prearm-action': { sev: 'amber', text: '{N} OF {M} PLAYER(S) NEED(S) ACTION: SEE BELOW' },
  'frame-prearm-no-game': { sev: 'neutral', text: 'NO GAME LOADED' },
  // F221 polish r2: the per-row "what to do" cell hard-coded amber with no catalogue id — one id per
  // fault kind, so its colour comes off the catalogue like every other alert. The echo-mismatch row
  // reuses `armory-blocker-echo-mismatch` (src/alerts/server.ts): one fact, one severity, everywhere;
  // ARMORY/LOBBY already say GUN ECHO ≠ CONFIG in RED, so this row now says the same, not "another weapon".
  'prearm-todo-no-phone': { sev: 'amber', text: 'NO PHONE BOUND: SWITCH IT ON AND BIND IT, OR STAND DOWN' },
  'prearm-todo-phone-missed-load': { sev: 'amber', text: 'PHONE MISSED LOAD: WAIT, MC IS RETRYING AUTOMATICALLY' },
  'prearm-todo-gun-no-head': { sev: 'amber', text: 'GUN HAS NO HEAD YET: PUSH CONFIG BELOW' },
  'prearm-todo-gun-not-confirmed': { sev: 'amber', text: 'GUN HAS NOT CONFIRMED THIS CONFIG: RE-PUSH CONFIG BELOW' },

  // ---- SetupSteps / Standby / UnrosteredPhones / OrphanMatch --------------------------------------
  'frame-setup-steps-reminders': { sev: 'neutral', text: 'MATCH REMINDERS: {SETUP STEP LINES} / {MC VERIFY LINE}' },
  'frame-standby-section': { sev: 'neutral', text: 'STANDBY // {N} SITTING OUT' },
  'frame-unrostered-phones': { sev: 'amber', text: '{N} CONNECTED PHONE(S) NOT IN THE ROSTER: CLAIM {IT|THEM} ON ARMORY ▸' },
  'frame-orphan-match': { sev: 'amber', text: '{N} PHONE(S) {IS|ARE} IN A MATCH THIS MC DID NOT START' },

  // ---- GameEditPanel ------------------------------------------------------------------------------
  'frame-bench-volume-override': { sev: 'neutral', text: 'BENCH VOLUME {N} OVERRIDES THIS ON THIS RUN: EVERY GUN PLAYS AT {PLAYS}.' },
  'frame-game-edit-dirty': { sev: 'neutral', text: 'UNSAVED: {FIELDS} / NO CHANGES YET' },
  'frame-game-edit-locked': { sev: 'amber', text: 'THE MATCH IS {PHASE}. MC REFUSES CONFIG EDITS ONCE IT HAS STARTED. RECALL FIRST, THEN EDIT.' },

  // ---- LoadedGame -----------------------------------------------------------------------------
  'frame-game-sent-nobody': { sev: 'amber', text: 'NOBODY IS ROSTERED YET: NO PHONE HAS THIS GAME', also: ['frame-game-sent-partial'] },
  'frame-load-status-not-configured': { sev: 'neutral', text: 'GUNS NOT CONFIGURED YET: {PUSH CONFIG BELOW | PUSH CONFIG IN LOBBY AFTER KITTING}' },
  'frame-load-status-repushing': { sev: 'neutral', text: 'CONFIG CHANGED: RE-PUSHING TO EVERY GUN… {ACKED}/{TOTAL} CONFIRMED' },
  // Sweep: the standing "N/M confirmed" count (the transitional re-pushing window has expired, and
  // some guns still have not answered) was a bare T.warn with no id: a real fix-before-the-next-
  // match fact, not a status colour picked at the call site.
  'frame-load-status-confirmed': { sev: 'amber', text: '{ACKED}/{TOTAL} GUNS CONFIRMED ON THIS CONFIG' },

  // ---- PLAY (screens/Games.tsx, F411 rewrite) ------------------------------------------------------
  'games-locked-banner': { sev: 'red', text: 'GAME SETTINGS ARE LOCKED: {REASON}' },
  // VQA round 1 (2026-09-26): QA-19 splits KOTH-with-no-hill-yet off the red banner above -- it is a
  // setup step, not a fault (the storyboard draws it amber). QA-09: a `GET /api/pieces` failure that
  // is not the older-console 404 is a real fetch problem, shown and retried on reconnect.
  'games-koth-no-hill': { sev: 'amber', text: 'NO HILL STATION ASSIGNED: KING OF THE HILL NEEDS ONE PHONE OR STICK SET AS THE HILL, IN ARMORY.' },
  'games-pieces-error': { sev: 'amber', text: 'COULD NOT LOAD THE GAME PIECES: {msg}' },
  // Polish round 1 M5: a 404 here means an older MC with no FAVOURITES route -- stale, not a fault
  // (silent, same as `games-pieces-error`'s own 404 case). Any OTHER failure is a real fetch problem.
  'games-favourites-error': { sev: 'amber', text: 'COULD NOT LOAD FAVOURITES: {msg}' },
  // Config-warning wording is server-authored (`state.py` validate), but this one line has always been
  // stable enough to catalogue directly rather than route through `serverLine` (which is for the
  // readiness board's blocker/amber lists, not `config_warnings`).
  'games-loadouts-reset': { sev: 'amber', text: '{N} LOADOUT(S) RESET BY {LABEL}' },
  'games-wait-why': { sev: 'neutral', text: 'WAITING FOR {N} PHONE(S): {NAMES}' },
};

/** Audit ids this lane retired as alerts: id -> why (removed, merged into another id's words, or now
 *  positive/data status). */
export const LOBBY_RETIRED: Record<string, string> = {
  'lobby-unassigned-heading': 'a column header, not a fact about any one player — restyled off T.warn to plain ink; the audit itself flagged the borrowed amber as unearned.',
  'games-jump-to-match': 'a navigation button beside the locked banner, not itself an alert — its border no longer borrows T.bad.',
  // F411 (docs/spec/design/games-presets.md): PLAY is rewritten — no more LOAD/ACTIVE GAME CONFIG dual
  // state (LOAD stays on PLAY, but PLAY never becomes "the loaded game" screen), no gun-programming
  // line (brief §10: "isn't it at the kit?" — LOBBY alone reports GUNS READY n/n), no venue chips/EDIT
  // draft (day/night is a MATCH SETTINGS switch now), and no "TUNED: NOT SAVED" state (a pick is always
  // either a saved BUILD piece or the composed config; nothing is ever left dangling and unsaved).
  'games-guns-not-configured': 'PICK GAME never shows this any more — LOBBY alone reports GUNS READY n/n (games-redesign.md §10).',
  'games-partial-delivery': 'the LOAD/ACTIVE-GAME-CONFIG dual state (and its phone-delivery status line) is retired with the old GAMES shelf UI.',
  'games-no-echo': 'same: the gun-echo status line moved to LOBBY (frame-load-status-*), never shown on PLAY any more.',
  'games-tuned-not-saved': 'PLAY never leaves a "tuned, not saved" draft (games-redesign.md §1) — every pick is a BUILD piece or the composed default.',
  'games-venue-in-draft': 'PLAY has no venue chips or EDIT draft any more; DAY/NIGHT is one MATCH SETTINGS switch.',
  'games-venue-locked': 'same: no venue control on PLAY to lock.',
};
