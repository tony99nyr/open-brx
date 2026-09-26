// F221: lines MC words (readiness blockers and ambers, station attention lines, setup lines).
// MC owns the words (mcp/brx_mcp/mc/state.py); this table owns the colour. See ./index.ts.
//
// The list MC puts a line in is still the gate: a line in `blockers` blocks START whatever its colour
// here. A readiness line is pre-match by definition, so most of them are AMBER (fix before the next
// match); RED is kept for a gun that provably runs the wrong game, or a phone MC cannot play with.
import type { AlertDef, Severity } from './index';

/** The server-worded alerts, by the audit id, with the template MC writes. */
export const SERVER_ALERTS: Record<string, AlertDef> = {
  // ---- readiness blockers (state.py readiness()) ----
  'server-waiting-phone': { sev: 'neutral', text: 'WAITING FOR THE PHONE: OPEN THE APP AND SET THE GUN' },
  'server-phone-offline': { sev: 'neutral', text: 'OFFLINE (LAST SEEN {AGE}): RECONNECT THE PHONE' },
  'armory-blocker-clock-not-synced': { sev: 'amber', text: 'CLOCK NOT SYNCED: WAIT FOR THE PHONE TO SYNC' },
  'armory-blocker-reach-reason': { sev: 'red', text: 'NOT REACHED FOR {AGE}, TUNNEL DOWN: TURN THE TUNNEL ON IN REACH' },
  'server-not-reached': { sev: 'amber', text: 'NOT REACHED FOR {AGE}' },
  'armory-blocker-wrong-wifi': { sev: 'amber', text: 'WRONG WI-FI OR MC UNREACHABLE: JOIN THE PHONE TO THE FIELD WI-FI' },
  'armory-guncard-link-lost': {
    sev: 'amber', text: 'GUN LINK LOST: CHECK THE GUN IS ON AND RECONNECT IT',
    also: ['armory-blocker-not-powered', 'games-gun-not-powered', 'lobby-fault-row-waiting'],
    why: "The demo's invented NOT POWERED line is now the real server line, GUN LINK LOST. A readiness line is pre-match, and Tony's rule makes a gun link lost in the LOBBY AMBER (RED only during a match). It still blocks START.",
  },
  'armory-blocker-identity-reverted': { sev: 'amber', text: 'IDENTITY REVERTED: RE-STAMP `$NAME`' },
  'armory-blocker-gun-did-not-answer': { sev: 'amber', text: 'GUN DID NOT ANSWER CONFIG: CHECK THE HEADSET IS ON, THEN RE-PUSH' },
  'armory-blocker-stale-ack': { sev: 'amber', text: 'ACKED AN OLDER CONFIG ({ID}): RE-PUSH', also: ['lobby-fault-stale-ack-row'] },
  'armory-blocker-echo-mismatch': {
    sev: 'red', text: 'GUN ECHO ≠ CONFIG (WEAPON {GOT} ECHOED, {WANT} EXPECTED, MAG/RESERVE): RE-PUSH',
    also: ['lobby-fault-echo-mismatch'],
  },
  'armory-blocker-gun-config-fault': {
    sev: 'red', text: 'GUN CONFIG ≠ PUSHED HEAD ({FIELD} {GOT} READ BACK, {WANT} PUSHED): RE-PUSH',
    also: ['lobby-fault-readback-mismatch'],
  },
  'armory-blocker-pool-fault': {
    sev: 'red', text: 'GUN POOL ≠ CONFIG (REPORTS {HP}/{ARMOR}, THIS CONFIG GRANTS {HP}/{ARMOR}, HP/ARMOR, LIKELY AN OLDER HEAD): RE-PUSH BEFORE THE NEXT GAME',
    also: ['lobby-fault-pool-mismatch', 'games-gun-fault-line'],
  },
  'armory-blocker-app-incompatible': { sev: 'red', text: 'APP {VERSION} INCOMPATIBLE WITH MC (NEEDS {TIER}): UPDATE THE APP' },
  'armory-blocker-weapon-app-too-old': { sev: 'red', text: 'APP CANNOT RUN {WEAPON} (NEEDS {VERSION}): UPDATE THE APP' },

  // ---- readiness ambers ----
  'armory-amber-stale-link': { sev: 'neutral', text: 'STALE LINK ({AGE})' },
  'armory-amber-battery-unread': { sev: 'neutral', text: 'BATTERY UNREAD' },
  'server-phone-battery-low': { sev: 'amber', text: 'PHONE BATTERY LOW: CHARGE THE PHONE' },
  'server-screen-off': { sev: 'amber', text: 'SCREEN OFF OR APP IN THE BACKGROUND: BRING THE APP TO THE FRONT' },
  'armory-amber-headset-confirming': { sev: 'neutral', text: 'HEADSET CONFIRMING (LINK {N} S)' },
  'armory-amber-holding-older-config': { sev: 'neutral', text: 'HOLDING OLDER CONFIG ({ID})' },
  'armory-amber-app-older-field': { sev: 'amber', text: 'APP OLDER THAN THE FIELD ({MINE} < {NEWEST}): UPDATE THE APP' },
  'server-app-older-release': { sev: 'amber', text: 'APP OLDER THAN THE RELEASE ({MINE} < {RELEASE}): UPDATE THE APP' },
  'server-app-version-unknown': { sev: 'amber', text: 'APP VERSION UNKNOWN ({RAW}): UPDATE THE APP' },
  'armory-guncard-gun-flapping': { sev: 'amber', text: 'HEADSET OFF (GUN KEEPS DROPPING THE LINK): TURN THE HEADSET ON' },
  'server-pool-advisory': { sev: 'amber', text: 'GUN POOL BELOW CONFIG | GUN ARMOR ABOVE CONFIG (REPORTS {HP}/{ARMOR}, THIS CONFIG GRANTS {HP}/{ARMOR}, HP/ARMOR): RE-PUSH BEFORE THE NEXT GAME' },

  // ---- the roster, the game, the notices ----
  'lobby-roster-fault-banner': { sev: 'red', text: 'ONLY ONE SIDE HAS PLAYERS (NO HIT CAN REGISTER): MOVE PLAYERS BETWEEN TEAMS' },
  'frame-mc-verify': { sev: 'neutral', text: 'WIN IS CONFIRMED AT MC, {N} PHONES OFF-GRID ({NAMES}): TELL PLAYERS TO RETURN AFTER THE WHISTLE' },
  'games-respawn-rules-warning': { sev: 'amber', text: "APP TOO OLD FOR TODAY'S RESPAWN RULES ({NAMES}): UPDATE THE APP TO {VERSION}" },
  'games-config-errors': { sev: 'red', text: '{CONFIG ERRORS, JOINED}' },
  'frame-setup-conflict-control-vs-grenade': {
    sev: 'red', text: "SETUP: A CONTROL STATION IS ASSIGNED BUT THIS GAME'S OBJECTIVE IS {SOURCE} (EVERY PHONE IGNORES THE STATION'S HILL): SET OBJECTIVE SOURCE TO PHONE, OR CLEAR THE CONTROL STATION IN ITEMS",
  },
  'frame-setup-conflict': {
    sev: 'amber', text: 'SETUP: NO CONTROL STATION IS ASSIGNED | NO RESPAWN STATION IS ASSIGNED ({WHY}): ASSIGN A STATION IN ITEMS AND ARM IT',
  },
  // F402 item 2: the assigned hill has gone quiet since LOAD. Advisory, unlike `frame-setup-conflict`'s
  // koth case (now a hard refusal, `games-locked-banner`'s koth reason) -- this warns; it does not block.
  'frame-setup-hill-offline': { sev: 'amber', text: 'SETUP: THE HILL IS OFFLINE: BRING IT INTO WI-FI OR RE-ARM IT BEFORE YOU START' },
  'games-setup-line': { sev: 'amber', text: 'SETUP: {THE FIELD STEP}' },
  'recap-server-warning': {
    sev: 'amber', text: "POSSIBLE GUN REPLAY (F74): {VICTIM} TOOK {N} IDENTICAL {DMG}-DAMAGE HITS FROM {SHOOTER} AT A STEADY {P} S PERIOD, AND THEY COUNT, WITH ANY DEATH THEY CAUSED: CHECK THE SHOOTER'S SHOTS AGAINST THEM, AND RE-ARM THE VICTIM'S GUN WITH `$SPAWN`",
  },

  // ---- gun-card cues and gates the console words (src/api/derive.ts) ----
  'armory-guncard-pool-wrong-neutral': { sev: 'red', text: 'GUN POOLS WRONG: FORCE RESPAWN' },
  'armory-guncard-cure-no-answer': { sev: 'amber', text: 'GUN NOT ANSWERING: FORCE RESPAWN' },
  'armory-guncard-gun-locked': { sev: 'red', text: 'GUN STOPPED: TELL THE PLAYER TO POWER-CYCLE IT' },
  'armory-gate-blocked': { sev: 'amber', text: '{N} GUNS BLOCKED' },
  'armory-gate-waiting': { sev: 'neutral', text: 'WAITING FOR {N} PHONES' },
  'armory-gate-noplayers': { sev: 'neutral', text: 'NO PLAYERS YET' },
  'lobby-stale-ack-line': { sev: 'amber', text: '{NAMES} STILL ANSWERING FOR AN OLDER CONFIG: RE-PUSH CONFIG ON LOBBY' },

  // ---- station attention lines (state.py _station_view, _station_tamper_flags) ----
  'station-attention-bring-back': { sev: 'amber', text: 'NOT RE-ARMED, OUT OF WI-FI RANGE: BRING IT BACK TO RE-ARM', also: ['frame-station-bring-back'] },
  'station-attention-armed-older-game': { sev: 'amber', text: 'ARMED FOR AN OLDER GAME: RE-ARM IT FROM ITEMS ON ARMORY', also: ['frame-station-armed-older'] },
  'station-attention-phone-not-armed': { sev: 'amber', text: 'PHONE SAYS NOT ARMED: RE-ARM IT FROM ITEMS ON ARMORY', also: ['frame-station-not-armed'] },
  'station-attention-id-mismatch': { sev: 'amber', text: 'PHONE ADVERTISES ID {REPORTED}, ASSIGNED {ID}: RE-ARM IT FROM ITEMS ON ARMORY', also: ['frame-station-advertises-id'] },
  'station-attention-battery-low': { sev: 'amber', text: 'BATTERY LOW: CHARGE OR SWAP IT BEFORE THE WHISTLE', also: ['frame-station-battery-low'] },
  'station-attention-restarted': { sev: 'amber', text: 'STATION #{SID} RESTARTED [{N} TIMES]: CHECK THE STATION', also: ['frame-station-restarted'] },
  // Two ids, one server line: MC's own text cannot tell ARMED from LIVE, but the console knows the
  // phase it is drawing. `StationAlerts.tsx` picks `frame-station-offline` (RED, act now: a station
  // the match depends on right now) when the phase is `live`, and this row (AMBER, fix before the
  // next match) otherwise. F221 round 1: was one row, folded under `also`, AMBER always.
  'station-attention-offline': { sev: 'amber', text: 'STATION #{SID} OFFLINE: CHECK IT IS ON AND IN RANGE' },
  'frame-station-offline': { sev: 'red', text: 'STATION #{SID} OFFLINE: CHECK IT IS ON AND IN RANGE' },
  'station-attention-lock-expires': { sev: 'amber', text: 'STATION #{SID} LOCK EXPIRES MID-MATCH: TAKE IT BACK THROUGH MUSTER', also: ['frame-station-lock-expires'] },
  'server-station-range-edited': { sev: 'neutral', text: '{RANGE|STRENGTH} EDITED ON STATION {FROM} → {TO} [(LOCKED)]' },
  'armory-stations-locked-banner': { sev: 'amber', text: 'STATIONS LOCKED FOR THE LOADED GAME', also: ['frame-station-locked-unlockonly'] },
  'frame-station-unlock-error': { sev: 'red', text: 'UNLOCK REFUSED: {ERR}' },
  // F401: a HELD station (e.g. a StickS3) can end a timed match on its own clock while out of Wi-Fi
  // range; MC only gets its result once it is heard again. Shown beside LOAD for any station of the
  // LAST FINISHED match MC has not heard since that match's whistle -- advisory, clears on its own.
  'server-station-not-synced': {
    sev: 'amber',
    text: '{KIND} {ID} HAS NOT SYNCED THE LAST MATCH: BRING IT INTO WI-FI BEFORE YOU LOAD, OR ITS RESULT IS LOST',
  },
};

/** Audit ids this lane retired as alerts: id -> why (removed, merged into another id's words, or now
 *  positive/data status). */
export const SERVER_RETIRED: Record<string, string> = {
};

/** Head of a line MC writes -> its audit id. Matched with `startsWith` on the whole line (or `re`, for a
 *  line whose fixed words come after a number), first hit wins, so put a longer head before a shorter
 *  one that shares its start. */
export const SERVER_LINES: { head: string; id: string; re?: RegExp }[] = [
  { head: 'WAITING FOR THE PHONE', id: 'server-waiting-phone' },
  { head: 'OFFLINE (LAST SEEN', id: 'server-phone-offline' },
  { head: 'CLOCK NOT SYNCED', id: 'armory-blocker-clock-not-synced' },
  { head: 'NOT REACHED FOR', id: 'armory-blocker-reach-reason', re: /^NOT REACHED FOR .*TUNNEL DOWN/ },
  { head: 'NOT REACHED FOR', id: 'server-not-reached' },
  { head: 'WRONG WI-FI', id: 'armory-blocker-wrong-wifi' },
  { head: 'GUN LINK LOST', id: 'armory-guncard-link-lost' },
  { head: 'IDENTITY REVERTED', id: 'armory-blocker-identity-reverted' },
  { head: 'GUN DID NOT ANSWER CONFIG', id: 'armory-blocker-gun-did-not-answer' },
  { head: 'ACKED AN OLDER CONFIG', id: 'armory-blocker-stale-ack' },
  { head: 'GUN ECHO ≠ CONFIG', id: 'armory-blocker-echo-mismatch' },
  { head: 'GUN CONFIG ≠ PUSHED HEAD', id: 'armory-blocker-gun-config-fault' },
  { head: 'GUN POOL ≠ CONFIG', id: 'armory-blocker-pool-fault' },
  { head: 'GUN POOL BELOW CONFIG', id: 'server-pool-advisory' },
  { head: 'GUN ARMOR ABOVE CONFIG', id: 'server-pool-advisory' },
  { head: 'APP CANNOT RUN', id: 'armory-blocker-weapon-app-too-old' },
  { head: 'APP OLDER THAN THE FIELD', id: 'armory-amber-app-older-field' },
  { head: 'APP OLDER THAN THE RELEASE', id: 'server-app-older-release' },
  { head: 'APP VERSION UNKNOWN', id: 'server-app-version-unknown' },
  { head: 'APP TOO OLD FOR TODAY', id: 'games-respawn-rules-warning' },
  { head: 'APP ', id: 'armory-blocker-app-incompatible', re: /^APP \S+ INCOMPATIBLE WITH MC/ },
  { head: 'STALE LINK', id: 'armory-amber-stale-link' },
  { head: 'BATTERY UNREAD', id: 'armory-amber-battery-unread' },
  { head: 'PHONE BATTERY LOW', id: 'server-phone-battery-low' },
  { head: 'SCREEN OFF', id: 'server-screen-off' },
  { head: 'HEADSET CONFIRMING', id: 'armory-amber-headset-confirming' },
  { head: 'HEADSET OFF (GUN KEEPS DROPPING THE LINK)', id: 'armory-guncard-gun-flapping' },
  { head: 'HOLDING OLDER CONFIG', id: 'armory-amber-holding-older-config' },
  { head: 'ONLY ONE SIDE HAS PLAYERS', id: 'lobby-roster-fault-banner' },
  { head: 'WIN IS CONFIRMED AT MC', id: 'frame-mc-verify' },
  { head: 'SETUP: A CONTROL STATION IS ASSIGNED BUT', id: 'frame-setup-conflict-control-vs-grenade' },
  { head: 'SETUP: NO CONTROL STATION IS ASSIGNED', id: 'frame-setup-conflict' },
  { head: 'SETUP: NO RESPAWN STATION IS ASSIGNED', id: 'frame-setup-conflict' },
  { head: 'SETUP: THE HILL IS OFFLINE', id: 'frame-setup-hill-offline' },
  { head: 'SETUP:', id: 'games-setup-line' },
  { head: 'POSSIBLE GUN REPLAY', id: 'recap-server-warning' },
  { head: 'WIRE 0 HITS', id: 'recap-server-warning' },
  // station attention lines
  { head: 'NOT RE-ARMED, OUT OF WI-FI RANGE', id: 'station-attention-bring-back' },
  { head: 'ARMED FOR AN OLDER GAME', id: 'station-attention-armed-older-game' },
  { head: 'PHONE SAYS NOT ARMED', id: 'station-attention-phone-not-armed' },
  { head: 'PHONE ADVERTISES ID', id: 'station-attention-id-mismatch' },
  { head: 'BATTERY LOW', id: 'station-attention-battery-low' },
  { head: 'STATION #', id: 'station-attention-restarted', re: /^STATION #\d+ RESTARTED/ },
  { head: 'STATION #', id: 'station-attention-offline', re: /^STATION #\d+ OFFLINE/ },
  { head: 'STATION #', id: 'station-attention-lock-expires', re: /^STATION #\d+ LOCK EXPIRES/ },
  { head: 'RANGE EDITED ON STATION', id: 'server-station-range-edited' },
  { head: 'STRENGTH EDITED ON STATION', id: 'server-station-range-edited' },
  // one head per `StationKind` (state.py `_station_sync_warnings`: `f"{row['kind'].upper()} {row['id']} …"`)
  { head: 'RESPAWN ', id: 'server-station-not-synced', re: /^RESPAWN \d+ HAS NOT SYNCED THE LAST MATCH/ },
  { head: 'CONTROL POINT ', id: 'server-station-not-synced', re: /^CONTROL POINT \d+ HAS NOT SYNCED THE LAST MATCH/ },
  { head: 'POWERUP ', id: 'server-station-not-synced', re: /^POWERUP \d+ HAS NOT SYNCED THE LAST MATCH/ },
  { head: 'EXTRACTION ', id: 'server-station-not-synced', re: /^EXTRACTION \d+ HAS NOT SYNCED THE LAST MATCH/ },
  { head: 'BOMB SITE ', id: 'server-station-not-synced', re: /^BOMB SITE \d+ HAS NOT SYNCED THE LAST MATCH/ },
];

const hit = (line: string) => SERVER_LINES.find(r => (r.re ? r.re.test(line) : line.startsWith(r.head)));

/** The catalogue id and severity of one server line, for `<Alert id={..} sev={..}>`. A line the table
 *  does not know gets the id `server-line` and its list's default severity. */
export function serverLine(line: string, list: 'blocker' | 'amber' | 'neutral'): { id: string; sev: Severity } {
  const h = hit(line);
  return { id: h && SERVER_ALERTS[h.id] ? h.id : 'server-line', sev: serverLineSev(line, list) };
}

/** The severity of one server line. `list` is the list MC put it in; a line the table does not know
 *  keeps that list's default, so a new server line is never silently dimmed. */
export function serverLineSev(line: string, list: 'blocker' | 'amber' | 'neutral'): Severity {
  const h = hit(line);
  const d = h ? SERVER_ALERTS[h.id] : undefined;
  if (d) return d.sev;
  return list === 'blocker' ? 'red' : list === 'amber' ? 'amber' : 'neutral';
}
