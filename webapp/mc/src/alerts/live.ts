// F221: the alerts this lane's screens render, by the audit id. See ./index.ts for the rule.
//
// This lane owns the frame (CommandBar, App's boot states, Debug, ReportPanel, client.ts) and the
// MATCH screen (Live.tsx, OperatorMenu.tsx). Four render sites all stated the operator-token fact in
// different words (App.tsx's boot screen, CommandBar's header button, Debug's form, ReportPanel's
// auth screen) — merged into one row (`frame-token-required-app`) with the other three in `also`.
import type { AlertDef } from './index';

export const LIVE_ALERTS: Record<string, AlertDef> = {
  'frame-bench-vol': { sev: 'neutral', text: 'BENCH VOL {n}' },
  'frame-connecting': { sev: 'neutral', text: 'CONNECTING TO MISSION CONTROL… IF THIS DOES NOT CLEAR, CHECK THAT THE MC SERVER IS RUNNING.' },
  'frame-console-error': { sev: 'red', text: 'CONSOLE ERROR: {message}' },
  'frame-debug-gun-link-lost': { sev: 'red', text: 'GUN LINK LOST' },
  'frame-debug-last-error': { sev: 'red', text: 'LAST ERROR: {error}' },
  'frame-debug-mock-mode': { sev: 'neutral', text: 'MOCK: NO REAL SERVER' },
  'frame-debug-pending': { sev: 'neutral', text: '{n} FRAME(S) PENDING' },
  'frame-debug-synced-no': { sev: 'amber', text: 'CLOCK NOT SYNCED' },
  'frame-debug-uplink-down': { sev: 'red', text: 'MC UPLINK DOWN' },
  'frame-error-toast': { sev: 'red', text: '{error}' },
  'frame-lan-warning-details': { sev: 'neutral', text: '{details}' },
  'frame-lan-warning-head': { sev: 'neutral', text: '{head}' },
  'frame-match-tab-dot': { sev: 'amber', text: 'PHONES ARE IN A MATCH THIS MC DID NOT START: OPEN MATCH' },
  'frame-mc-offline': { sev: 'red', text: 'MC OFFLINE, THE BOARD IS FROZEN AT THE LAST SNAPSHOT: CHECK THAT MC IS RUNNING' },
  'frame-notice-toast': { sev: 'neutral', text: '{notice}' },
  'frame-op-not-in-play': { sev: 'neutral', text: 'THE MATCH IS NOT IN PLAY, NOTHING CAN BE SENT' },
  'frame-op-out-of-reach': { sev: 'red', text: "{WHO}'S PHONE IS OUT OF REACH: WAIT FOR IT TO CHECK IN" },
  'frame-op-outcome-refused': { sev: 'amber', text: 'THE PHONE REFUSED {word}: {why}' },
  'frame-op-outcome-sent': { sev: 'neutral', text: '{word} SENT, WAITING FOR THE PHONE' },
  'frame-op-wait-t0': { sev: 'neutral', text: 'RESYNC AND RESPAWN WAIT FOR T-0, RELINK WORKS NOW' },
  'frame-panicked-toast': { sev: 'red', text: '{receipt}' },
  'frame-report-busy': { sev: 'neutral', text: 'MAKING REPORT… THIS CAN TAKE A FEW SECONDS' },
  'frame-report-download-err': { sev: 'red', text: '{error}' },
  'frame-report-error': { sev: 'red', text: '{error}' },
  'frame-report-idle': { sev: 'neutral', text: 'THIS MAKES A REPORT FROM THIS SESSION' },
  'frame-report-too-large': { sev: 'amber', text: "REPORT LARGER THAN 25 MB, GITHUB'S ATTACHMENT LIMIT: MAKE THE ISSUE ANYWAY AND SAY SO" },
  'frame-server-old': { sev: 'amber', text: 'MC SERVER IS OLDER THAN THIS CONSOLE: RESTART MC' },
  // The one fact four files stated four different ways (App's boot screen, CommandBar's header
  // button, Debug's form, ReportPanel's auth screen). One row, one wording, via `OPERATOR_TOKEN`.
  'frame-token-required-app': {
    sev: 'neutral', text: 'OPERATOR TOKEN NEEDED: OPEN THE `#tok=` LINK THAT MC PRINTED',
    also: ['frame-token-btn', 'frame-debug-token-form', 'frame-report-auth'],
  },
  'frame-tunnel-down': { sev: 'red', text: 'INTERNET TUNNEL DOWN: {reason}' },

  'live-controls-offline': { sev: 'red', text: 'MC IS OFFLINE: END AND RECALL RETURN WHEN IT RECONNECTS' },
  'live-end-delivery-retrying': { sev: 'amber', text: '{n} OF {total} NODE(S) NOT CONFIRMED THE END: RE-DELIVERING' },
  'live-end-delivery-spent': { sev: 'red', text: '{n} OF {total} NODE(S) NOT CONFIRMED THE END: END IT ON THE GUN' },
  'live-feed-alert-line': { sev: 'neutral', text: '{call}' },
  'live-feed-withheld-note': { sev: 'neutral', text: 'WITHHELD = MC RECORDED IT BUT DID NOT CALL IT TO THE PLAYERS.' },
  'live-hill-none': { sev: 'neutral', text: 'NO PHONE HAS REPORTED POSSESSION YET' },
  'live-hill-owner-none': { sev: 'neutral', text: 'OWNER NOT REPORTED LIVE' },
  'live-no-match': { sev: 'neutral', text: 'NO MATCH LIVE: THE BOARD FILLS WHEN NODES GO LIVE AT T-0' },
  'live-order-held': { sev: 'neutral', text: 'ORDER HELD WHILE THE POINTER IS ON THE BOARD OR A MENU IS OPEN, IT RE-SORTS WHEN YOU MOVE AWAY' },
  'live-phones-ended': { sev: 'amber', text: 'PHONES HAVE ENDED THIS MATCH: PRESS END' },
  'live-row-cure-dead': { sev: 'neutral', text: 'NODE FOUND IT DEAD' },
  // derive.ts (server lane) still writes this with a ` - `; the render here follows the audit's
  // proposed severity regardless. Reported to the server lane to fold into the colon form.
  'live-row-cure-no-answer': { sev: 'red', text: 'GUN NOT ANSWERING: FORCE RESPAWN' },
  'live-row-gun-locked': { sev: 'red', text: 'GUN STOPPED: POWER-CYCLE THE GUN' },
  'live-row-gun-not-firing': { sev: 'neutral', text: 'GUN NOT FIRING' },
  'live-row-gun-silent': { sev: 'neutral', text: 'GUN SILENT {age}' },
  'live-row-gun-write-lost': { sev: 'neutral', text: 'GUN WRITE LOST' },
  'live-row-pools-wrong-cue': { sev: 'red', text: 'GUN POOLS WRONG: FORCE RESPAWN' },
  'live-row-shielded': { sev: 'amber', text: 'POSSIBLY PROTECTED: HITS MAY NOT COUNT' },
  'live-row-status-end-not-confirmed': { sev: 'amber', text: 'END NOT CONFIRMED' },
  'live-row-status-last-known': { sev: 'amber', text: 'LAST KNOWN' },
  'live-row-status-poolswrong': { sev: 'red', text: 'POOLS WRONG' },
  'live-row-status-respawn': { sev: 'neutral', text: 'RESPAWN {n}S' },
  'live-row-status-unknown': { sev: 'neutral', text: 'UNKNOWN' },
  'live-row-sync-stale': { sev: 'neutral', text: '{age} AGO' },
  'live-scroll-hint': { sev: 'neutral', text: 'SCROLL FOR K/D, ACC, STK, STATUS' },
  'live-team-kill-note': { sev: 'neutral', text: 'K BELOW ZERO: A TEAM KILL COSTS THE SHOOTER ONE KILL, SO K AND K/D CAN GO BELOW ZERO.' },
  'live-timecell-offline': { sev: 'red', text: 'TIME REMAINING, OFFLINE' },
};

/** Audit ids this lane retired as alerts: id -> why (removed, merged into another id's words, or now
 *  positive/data status). */
export const LIVE_RETIRED: Record<string, string> = {
  'live-feed-first-blood-tag': 'a fact tag on a notable kill, not a warning: restyled to T.ink (was T.bad, the same red as a real fault).',
  'live-feed-team-kill-tag': 'a fact tag, not an instruction: restyled to T.ink (was T.bad, overloading red as an event colour).',
  // F221 round 2: this restated MC_OFFLINE in a second red banner under the frame's own one. The rows
  // dim to 0.6 opacity already; nothing left for this screen to say that the frame has not said once.
  'live-offline-banner': 'a second RED MC_OFFLINE banner under the frame’s own one: removed, rows dim instead.',
};
