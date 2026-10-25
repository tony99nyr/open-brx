// F221: the alerts this lane's screens render, by the audit id. See ./index.ts for the rule.
import type { AlertDef } from './index';

export const RECAP_ALERTS: Record<string, AlertDef> = {
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
  'recap-station-never-heard': { sev: 'amber', text: 'NEVER HEARD FROM: CHECK THE STATION ON SITE.' },
  'recap-status-inplay': { sev: 'neutral', text: 'IN PLAY · PROVISIONAL' },
  // SENDING/HOLDING is a NEUTRAL family (F221 rule): a node still delivering its own data is routine.
  // a phone out of range after the whistle is fix-before-next, not a live-safety fault; it used to
  // render red (the same colour as a true act-now fault) — flagged in the audit's own issues list.
  'recap-sync-outofrange': { sev: 'amber', why: 'fix-before-next-match, not act-now, though it used to render red',
    text: 'OUT OF RANGE: WILL SYNC ON RETURN' },
  'recap-sync-sending': { sev: 'neutral', why: 'SENDING/HOLDING family', text: 'SENDING: {n} LEFT' },

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
  'recap-after-whistle-breakdown': 'F596: the after-the-whistle box is gone; RESULT CHANGED covers a flipped winner',
  'recap-after-whistle-count': 'F596: the after-the-whistle box is gone; RESULT CHANGED covers a flipped winner',
  'recap-archived-banner': 'F596: now a small ARCHIVED chip beside the title, not an alert line',
  'recap-possession-neutral': 'F596: the possession caveat lines are gone from RECAP',
  'recap-possession-thin': 'F596: the possession caveat lines are gone from RECAP',
  'recap-possession-sites': 'F596: the possession caveat lines are gone from RECAP',
  'recap-possession-station': 'F596: the possession caveat lines are gone from RECAP',
  'recap-provisional-banner': 'F596: the NOT FLUSHED line is gone; the sync strip carries its meaning',
  'recap-settling-banner': 'F596: the STILL SETTLING line is gone; the sync strip carries its meaning',
  'recap-station-not-synced': 'F596: a station that has not synced is an icon in the sync strip',
  'recap-team-kill-note': 'F596: now a small icon beside the negative score, with the words as its hover',
  'recap-sync-awaiting': 'F596: the per-player DATA SYNC chips are gone; the strip icon carries the stage',
  'recap-sync-no-report': 'F596: the per-player DATA SYNC chips are gone; the strip icon carries the stage',
};
