// F221 round 1: `serverLine`/`SERVER_LINES` (src/alerts/server.ts) match an MC line by its HEAD, so a
// rewording that keeps the head still resolves to the right catalogue id even when nothing here would
// catch it. This test goes the other way: it feeds the EXACT line shapes MC writes today (copied from
// the f-strings and constants in mcp/brx_mcp/mc/state.py, compile.py and scoring.py, one sample per
// head), and pins each to the catalogue id and severity Tony's rule gives it. The samples are copies:
// a rewording in state.py does not fail this file. `mcp/tests/test_mc_alert_wording.py`
// (`test_every_line_mc_writes_has_a_console_colour`) is the join: it builds the real lines and checks each
// one against the heads in SERVER_LINES.
import { describe, expect, it } from 'vitest';
import { serverLine } from '../src/alerts';

// [line, list MC put it in, expected id, expected severity]
const CASES: [string, 'blocker' | 'amber' | 'neutral', string, 'red' | 'amber' | 'neutral'][] = [
  // ---- readiness blockers/ambers (state.py _version_flags, _readiness line builders) ----
  ['WAITING FOR THE PHONE: OPEN THE APP AND SET THE GUN', 'blocker', 'server-waiting-phone', 'neutral'],
  ['OFFLINE (LAST SEEN 12S): RECONNECT THE PHONE', 'blocker', 'server-phone-offline', 'neutral'],
  ['CLOCK NOT SYNCED: WAIT FOR THE PHONE TO SYNC', 'blocker', 'armory-blocker-clock-not-synced', 'amber'],
  ['NOT REACHED FOR 2M, TUNNEL DOWN: TURN THE TUNNEL ON IN REACH', 'blocker', 'armory-blocker-reach-reason', 'red'],
  ['NOT REACHED FOR 2M', 'amber', 'server-not-reached', 'amber'],
  ['WRONG WI-FI OR MC UNREACHABLE: JOIN THE PHONE TO THE FIELD WI-FI', 'blocker', 'armory-blocker-wrong-wifi', 'amber'],
  ['GUN LINK LOST: CHECK THE GUN IS ON AND RECONNECT IT', 'blocker', 'armory-guncard-link-lost', 'amber'],
  ['IDENTITY REVERTED: RE-STAMP $NAME', 'blocker', 'armory-blocker-identity-reverted', 'amber'],
  ['GUN DID NOT ANSWER CONFIG: CHECK THE HEADSET IS ON, THEN RE-PUSH', 'blocker', 'armory-blocker-gun-did-not-answer', 'amber'],
  ['ACKED AN OLDER CONFIG (9f2a1c04): RE-PUSH', 'blocker', 'armory-blocker-stale-ack', 'amber'],
  ['GUN ECHO ≠ CONFIG (WEAPON 8/24 ECHOED, 8/26 EXPECTED, MAG/RESERVE): RE-PUSH', 'blocker', 'armory-blocker-echo-mismatch', 'red'],
  ['GUN CONFIG ≠ PUSHED HEAD (HP 44 READ BACK, 45 PUSHED): RE-PUSH', 'blocker', 'armory-blocker-gun-config-fault', 'red'],
  ['GUN POOL ≠ CONFIG (REPORTS 115/70, THIS CONFIG GRANTS 45/70, HP/ARMOR, LIKELY AN OLDER HEAD): RE-PUSH BEFORE THE NEXT GAME', 'blocker', 'armory-blocker-pool-fault', 'red'],
  ['GUN POOL BELOW CONFIG (REPORTS 30/70, THIS CONFIG GRANTS 45/70, HP/ARMOR): RE-PUSH BEFORE THE NEXT GAME', 'amber', 'server-pool-advisory', 'amber'],
  ['GUN ARMOR ABOVE CONFIG (REPORTS 45/200, THIS CONFIG GRANTS 45/70, HP/ARMOR): RE-PUSH BEFORE THE NEXT GAME', 'amber', 'server-pool-advisory', 'amber'],
  ['APP CANNOT RUN ENERGY LAUNCHER (NEEDS 0.5.0): UPDATE THE APP', 'blocker', 'armory-blocker-weapon-app-too-old', 'red'],
  ['APP OLDER THAN THE FIELD (0.4.1 < 0.4.9): UPDATE THE APP', 'amber', 'armory-amber-app-older-field', 'amber'],
  ['APP OLDER THAN THE RELEASE (0.4.1 < 0.4.9): UPDATE THE APP', 'amber', 'server-app-older-release', 'amber'],
  ['APP VERSION UNKNOWN (garbage): UPDATE THE APP', 'amber', 'server-app-version-unknown', 'amber'],
  ["APP TOO OLD FOR TODAY'S RESPAWN RULES (Op1): UPDATE THE APP TO 0.4.9", 'amber', 'games-respawn-rules-warning', 'amber'],
  ['APP 0.0.1 INCOMPATIBLE WITH MC (NEEDS 0.4): UPDATE THE APP', 'blocker', 'armory-blocker-app-incompatible', 'red'],
  ['STALE LINK (52S)', 'amber', 'armory-amber-stale-link', 'neutral'],
  ['BATTERY UNREAD', 'amber', 'armory-amber-battery-unread', 'neutral'],
  ['PHONE BATTERY LOW: CHARGE THE PHONE', 'amber', 'server-phone-battery-low', 'amber'],
  ['SCREEN OFF OR APP IN THE BACKGROUND: BRING THE APP TO THE FRONT', 'amber', 'server-screen-off', 'amber'],
  ['HEADSET CONFIRMING (LINK 4 S)', 'amber', 'armory-amber-headset-confirming', 'neutral'],
  ['HEADSET OFF (GUN KEEPS DROPPING THE LINK): TURN THE HEADSET ON', 'amber', 'armory-guncard-gun-flapping', 'amber'],
  ['HOLDING OLDER CONFIG (9f2a1c04)', 'amber', 'armory-amber-holding-older-config', 'neutral'],

  // ---- the roster, the game, the notices ----
  ['ONLY ONE SIDE HAS PLAYERS (NO HIT CAN REGISTER): MOVE PLAYERS BETWEEN TEAMS', 'blocker', 'lobby-roster-fault-banner', 'red'],
  ['WIN IS CONFIRMED AT MC, 2 PHONES OFF-GRID (Op1, Op2): TELL PLAYERS TO RETURN AFTER THE WHISTLE', 'neutral', 'frame-mc-verify', 'neutral'],
  [
    "SETUP: A CONTROL STATION IS ASSIGNED BUT THIS GAME'S OBJECTIVE IS THE GRENADE (EVERY PHONE IGNORES THE STATION'S HILL): SET OBJECTIVE SOURCE TO PHONE, OR CLEAR THE CONTROL STATION IN ITEMS",
    'amber', 'frame-setup-conflict-control-vs-grenade', 'red',
  ],
  [
    'SETUP: NO CONTROL STATION IS ASSIGNED (THE OBJECTIVE IS A BLUETOOTH CONTROL POINT, SO NOTHING ON THE FIELD IS THE HILL): ASSIGN A STATION AS CONTROL IN ITEMS AND ARM IT',
    'amber', 'frame-setup-conflict', 'amber',
  ],
  [
    'SETUP: NO RESPAWN STATION IS ASSIGNED (RESPAWN IS SCANNER, SO A DOWNED PLAYER CAN ONLY COME BACK AT A STATION): ASSIGN A STATION AS RESPAWN IN ITEMS AND ARM IT',
    'amber', 'frame-setup-conflict', 'amber',
  ],
  // compile.py's own three physical-setup lines (Compiler.validate): the generic `SETUP:` fallback
  [
    'SETUP: POWER-CYCLE THE GRENADE SO IT STARTS NEUTRAL, SET IT TO HILL MODE, AND PLACE IT (A HILL THAT STARTS ALREADY OWNED SKEWS THE WHOLE MATCH, AND ONLY A POWER CYCLE GUARANTEES NEUTRAL). ONE POINT ONLY (F88)',
    'amber', 'games-setup-line', 'amber',
  ],
  [
    'POSSIBLE GUN REPLAY (F74): Op1 TOOK 3 IDENTICAL 20-DAMAGE HITS FROM Op2 AT A STEADY 0.5 S PERIOD, AND THEY COUNT, WITH ANY DEATH THEY CAUSED: CHECK THE SHOOTER\'S SHOTS AGAINST THEM, AND RE-ARM THE VICTIM\'S GUN WITH $SPAWN',
    'amber', 'recap-server-warning', 'amber',
  ],
  [
    'WIRE 0 HITS: 2 HIT(S) AND 1 DEATH(S) CAME FROM A SHOOTER WITH NO IDENTITY (A GRENADE HILL\'S DAMAGE WORD, F69, OR A GUN WHOSE $PSET NEVER LANDED, F80) AND SCORED FOR NOBODY: IF NO HILL WAS ON THE FIELD, CHECK EACH GUN\'S $PSET AT THE NEXT ARM',
    'amber', 'recap-server-warning', 'amber',
  ],

  // ---- station attention lines (state.py _station_view, _station_tamper_flags) ----
  ['NOT RE-ARMED, OUT OF WI-FI RANGE: BRING IT BACK TO RE-ARM', 'amber', 'station-attention-bring-back', 'amber'],
  ['ARMED FOR AN OLDER GAME: RE-ARM IT FROM ITEMS ON ARMORY', 'amber', 'station-attention-armed-older-game', 'amber'],
  ['PHONE SAYS NOT ARMED: RE-ARM IT FROM ITEMS ON ARMORY', 'amber', 'station-attention-phone-not-armed', 'amber'],
  ['PHONE ADVERTISES ID 3, ASSIGNED 1: RE-ARM IT FROM ITEMS ON ARMORY', 'amber', 'station-attention-id-mismatch', 'amber'],
  ['BATTERY LOW: CHARGE OR SWAP IT BEFORE THE WHISTLE', 'amber', 'station-attention-battery-low', 'amber'],
  ['STATION #4 RESTARTED: CHECK THE STATION', 'amber', 'station-attention-restarted', 'amber'],
  ['STATION #4 RESTARTED 2 TIMES: CHECK THE STATION', 'amber', 'station-attention-restarted', 'amber'],
  // AMBER is `serverLine`'s own answer for this head -- StationAlerts.tsx overrides it to RED
  // (`frame-station-offline`) itself, only while the phase is `live` (see station-alerts.test.tsx).
  ['STATION #4 OFFLINE: CHECK IT IS ON AND IN RANGE', 'amber', 'station-attention-offline', 'amber'],
  ['STATION #4 LOCK EXPIRES MID-MATCH: TAKE IT BACK THROUGH MUSTER', 'amber', 'station-attention-lock-expires', 'amber'],
  ['RANGE EDITED ON STATION -74 → -70', 'neutral', 'server-station-range-edited', 'neutral'],
  ['STRENGTH EDITED ON STATION 3 → 4 (LOCKED)', 'neutral', 'server-station-range-edited', 'neutral'],
];

describe('F221 round 1: serverLine against the exact line shapes MC writes today', () => {
  it.each(CASES)('%s', (line, list, id, sev) => {
    expect(serverLine(line, list)).toEqual({ id, sev });
  });
});
