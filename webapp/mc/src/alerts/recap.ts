// F221: the alerts this lane's screens render, by the audit id. See ./index.ts for the rule.
import type { AlertDef } from './index';

export const RECAP_ALERTS: Record<string, AlertDef> = {
  // ---- RECAP.tsx -------------------------------------------------------------------------------
  'recap-after-whistle-breakdown': { sev: 'neutral',
    text: 'RECORDED, NOT COUNTED: THESE LANDED AFTER SCORING FROZE AND ARE NOT IN THE RESULT ABOVE.' },
  'recap-after-whistle-count': { sev: 'neutral',
    text: 'RECORDED, NOT COUNTED: THESE LANDED AFTER SCORING FROZE AND ARE NOT IN THE RESULT ABOVE. '
      + 'THIS MC SENT THE COUNT WITHOUT THE PER-PLAYER SPLIT, SO THERE IS NONE TO SHOW.' },
  'recap-archived-banner': { sev: 'neutral', text: 'ARCHIVED MATCH: ENDED {date} · READ ONLY' },
  // an export failure is not a live-safety issue, so it is fix-before-next, not act-now, though it
  // used to render red on screen — the audit's own note on this row. One render site, three causes:
  // a 404 (words are MC_OLDER's, imported), a bad status, or a fetch failure (MC_OFFLINE.act, imported).
  'recap-csv-err': { sev: 'amber', why: 'an export failure, not a live-safety issue',
    text: 'MC SERVER IS OLDER THAN THIS CONSOLE: RESTART MC' },
  // A42: `also` folds the DATA SYNC chip's "END NOT CONFIRMED" suffix in here while MC is still
  // trying — the one instance the audit captured. Once the retry ladder is SPENT the chip switches
  // to `recap-end-delivery-spent`'s red at the call site: a gun that may still be live after the
  // operator thinks the match ended is act-now, not fix-before-next, whichever widget says so.
  'recap-end-delivery-retrying': { sev: 'amber', also: ['recap-sync-end-not-confirmed'],
    text: '{n} OF {total} NODES HAVE NOT CONFIRMED THE END YET ({who}). MC IS STILL RE-DELIVERING IT '
      + '({tries} DELIVERIES SO FAR). {reach}, AND REACHING A NODE IS NOT A CONFIRMATION. '
      + 'THIS IS A DELIVERY FACT: IT SAYS NOTHING ABOUT HOW THEY PLAYED.' },
  'recap-end-delivery-spent': { sev: 'red',
    text: '{n} OF {total} NODES NEVER CONFIRMED THE END ({who}). MC TOLD THEM {tries} TIMES AND HAS STOPPED. '
      + '{reach}, AND REACHING A NODE IS NOT A CONFIRMATION. THIS IS A DELIVERY FACT: IT SAYS NOTHING ABOUT '
      + 'HOW THEY PLAYED. THAT TAGGER MAY HAVE PLAYED ON AFTER THE WHISTLE: CHECK IT ON THE GUN.' },
  'recap-possession-neutral': { sev: 'neutral',
    text: 'NEUTRAL {dur}: NOBODY HELD THE POINT (A HILL BROADCASTS TEAM 2 WHEN UNOWNED)' },
  // a coverage caveat about the MEASUREMENT, not a fault in the match: no glyph, no amber.
  'recap-possession-thin': { sev: 'neutral', why: 'a measurement caveat, not a fault',
    text: 'BEST COVERAGE {dur} OF {dur2}: A HILL IS ONLY SEEN BY A GUN IN BEACON RANGE, SO THIS IS A FLOOR, '
      + 'NOT A FULL ACCOUNT.' },
  'recap-provisional-banner': { sev: 'amber',
    text: '{n} NODE(S) HAVE NOT FLUSHED ({names}): BRING THEM INTO RANGE TO FINALIZE '
      + '(KILLS LIVE IN THEIR REPORTS UNTIL THEN).' },
  'recap-settling-banner': { sev: 'amber',
    text: '{n} NODE(S) HAVE NOT REPORTED SINCE THE WHISTLE ({names}) · {s}S AGO: THESE TOTALS CAN STILL CHANGE.' },
  'recap-station-never-heard': { sev: 'amber', text: 'NEVER HEARD FROM: CHECK THE STATION ON SITE.' },
  'recap-status-inplay': { sev: 'neutral', text: 'IN PLAY · PROVISIONAL' },
  // SENDING/HOLDING is a NEUTRAL family (F221 rule): a node still delivering its own data is routine.
  'recap-sync-awaiting': { sev: 'neutral', why: 'SENDING/HOLDING family', text: 'CONNECTED: AWAITING DATA' },
  'recap-sync-no-report': { sev: 'amber', text: 'NO REPORT SINCE THE WHISTLE: BRING IT INTO RANGE.' },
  // a phone out of range after the whistle is fix-before-next, not a live-safety fault; it used to
  // render red (the same colour as a true act-now fault) — flagged in the audit's own issues list.
  'recap-sync-outofrange': { sev: 'amber', why: 'fix-before-next-match, not act-now, though it used to render red',
    text: 'OUT OF RANGE: WILL SYNC ON RETURN' },
  'recap-sync-sending': { sev: 'neutral', why: 'SENDING/HOLDING family', text: 'SENDING: {n} LEFT' },
  'recap-team-kill-note': { sev: 'neutral',
    text: 'K BELOW ZERO: A TEAM KILL COSTS THE SHOOTER ONE KILL, SO K AND K/D CAN GO BELOW ZERO.' },

  // ---- Spectate.tsx ------------------------------------------------------------------------------
  'spectate-clock-frozen': { sev: 'red', text: 'CLOCK FROZEN' },
  'spectate-escape-line': { sev: 'neutral',
    text: '{VIEW} IS A CONSOLE SCREEN: THIS TAB IS THE BOARD. RELOAD IT TO OPEN {VIEW}.' },
  'spectate-feed-nothing-yet': { sev: 'neutral', text: 'NOTHING YET.' },
  'spectate-final-provisional': { sev: 'amber', text: 'PROVISIONAL: STILL SETTLING' },
  // the MC-offline cluster: the words are MC_OFFLINE's, imported, never re-typed (the LIVE banner is
  // the model per Tony's rule). This template documents the same words for the gallery/review.
  'spectate-frozen-tag': { sev: 'red',
    text: 'MC OFFLINE, THE BOARD IS FROZEN AT THE LAST SNAPSHOT: CHECK THAT MC IS RUNNING' },
  'spectate-hill-last-report': { sev: 'neutral', text: '(LAST REPORT)' },
  'spectate-hill-owner-none': { sev: 'neutral', text: 'OWNER NOT REPORTED LIVE' },
  'spectate-no-possession-yet': { sev: 'neutral', text: 'NO POSSESSION REPORTED YET' },
  'spectate-no-scores': { sev: 'neutral', text: 'NO SCORES YET.' },
  // a wall rotating pages is mechanical, not a fault — it used to render amber for a purely routine
  // notice (flagged in the audit's own issues list).
  'spectate-page-strip': { sev: 'neutral', why: 'paging is routine, not a fault, though it used to render amber',
    text: 'PAGE {n} / {N} · {rows} PLAYERS' },
  'spectate-team-kill-note': { sev: 'neutral',
    text: 'K BELOW ZERO: A TEAM KILL COSTS THE SHOOTER ONE KILL, SO K AND K/D CAN GO BELOW ZERO.' },
  'spectate-waiting-connecting': { sev: 'neutral', text: 'CONNECTING TO MISSION CONTROL' },
  'spectate-waiting-horn': { sev: 'neutral', text: '{MODE}: WAITING FOR THE HORN' },
};

/** Audit ids this lane retired as alerts: id -> why (removed, merged into another id's words, or now
 *  positive/data status). */
export const RECAP_RETIRED: Record<string, string> = {
};
