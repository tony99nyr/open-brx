// F221: the alerts this lane's screens render, by the audit id. See ./index.ts for the rule.
import type { AlertDef } from './index';

export const ARMORY_ALERTS: Record<string, AlertDef> = {
  'armory-backhaul-error': { sev: 'amber', text: 'BACKHAUL FAILED: {reason}' },
  'armory-backhaul-starting': { sev: 'neutral', text: 'STARTING' },
  'armory-counts-red': { sev: 'amber', text: '{n} RED' },
  'armory-ghostcard-registry': { sev: 'neutral', text: 'IN THE REGISTRY: POWER IT UP AND SCAN' },
  // gun battery: one threshold (`batteryColour`, `BATTERY_LOW_PCT`), no red.
  'armory-guncard-battery-red': { sev: 'amber', text: '{pct}%' },
  'armory-guncard-blocked-tag': { sev: 'amber', text: 'BLOCKED' },
  'armory-guncard-check-tag': { sev: 'amber', text: 'CHECK' },
  'armory-guncard-no-phone-yet-tag': { sev: 'neutral', text: 'NO PHONE YET' },
  'armory-guncard-offline-tag': { sev: 'neutral', text: 'OFFLINE' },
  // same one-threshold rule as the gun's own battery: also drawn by the NodeCard's PH BATT row
  // (2026-09-25 sweep — the audit only caught the GunCard row, NodeCard had the identical <20% red bug).
  'armory-guncard-ph-batt-red': { sev: 'amber', text: '{pct}%' },
  'armory-headset-unknown-amber': { sev: 'amber', text: 'UNKNOWN' },
  'armory-joinpanel-lanwarn': { sev: 'amber', text: 'PHONES WILL NOT FIND MC ON THIS WI-FI UNTIL THE ADDRESS NOTE AT THE TOP IS FIXED{tail}' },
  'armory-joinpanel-no-lan-address': { sev: 'amber', text: 'NO LAN ADDRESS ({ip}): MC IS NOT ON A NETWORK PHONES CAN REACH. JOIN THE FIELD WI-FI AND RESTART MC; SIDELOAD THE APK BY CABLE MEANWHILE.' },
  'armory-nodecard-claim-error': { sev: 'amber', text: '{error}' },
  'armory-nodecard-link-offline': { sev: 'neutral', text: '{age} AGO: OFFLINE',
    why: 'the same stale-node fact as the neutral OFFLINE tag right above it on the same card: one fact, one colour.' },
  'armory-nodecard-not-heard': { sev: 'neutral', text: 'NOT HEARD FROM RECENTLY: WAITING TO RECONNECT' },
  'armory-nodecard-offline-tag': { sev: 'neutral', text: 'OFFLINE' },
  'armory-nodecard-waiting-for-gun': { sev: 'neutral', text: 'WAITING FOR ITS GUN: SET IT ON THE PHONE',
    why: 'a phone with no gun set yet is a normal muster step, not a fault: nothing has gone wrong yet.' },
  'armory-pulllog-notice': { sev: 'neutral', text: 'ASKED FOR THE LOG: THE PHONE ANSWERS WHEN IT CAN',
    why: 'the toast itself is drawn by the app frame outside this lane\'s files; this lane owns only the trigger site and its wording, both fixed to plain status.' },
  'armory-reach-install-cloudflared': { sev: 'neutral', text: 'INSTALL CLOUDFLARED' },
  'armory-reach-predates-backhaul': { sev: 'amber', text: 'MC SERVER IS OLDER THAN THIS CONSOLE: RESTART MC' },
  'armory-restored-banner': { sev: 'amber', text: 'SESSION RESTORED FROM {stamp}, {n} PLAYERS CARRIED OVER: CHECK THE ROSTER BEFORE YOU KIT OUT' },
  'armory-unclaimed-identity-tag': { sev: 'amber', text: '{identity}' },
  'armory-weapon-echo-mismatch-row': { sev: 'red', text: 'ECHO ≠ CONFIG' },
  'armory-weapon-not-echoed-row': { sev: 'neutral', text: 'GUN DID NOT ECHO ITS WEAPON: UNPROVEN ON THIS FIRMWARE' },
  'frame-catalog-caution': { sev: 'amber', text: '{caution}' },
  'frame-catalog-no-catalog': { sev: 'neutral', text: 'NO CATALOG: MISSION CONTROL HAS NOT SENT ONE.' },
  'frame-catalog-not-playable': { sev: 'amber', text: 'NOT PLAYABLE: HIT ROW DEALS NO DAMAGE' },
};

/** Audit ids this lane retired as alerts: id -> why (removed, merged into another id's words, or now
 *  positive/data status). */
export const ARMORY_RETIRED: Record<string, string> = {
  'armory-guncard-battery-amber': 'Tony\'s single 30% battery threshold (BRIEF 2026-09-25) removes the old 30-59% amber band: a reading in that range is now ordinary data colour (T.ink) via batteryColour, same as any other value, never amber.',
  'armory-setup-blocker': 'polish round 1 (2026-09-25): Armory.tsx no longer re-tells this line in sentence case; it draws MC\'s own SETUP words through serverLine(w, \'amber\'), which resolves per line to frame-setup-conflict (amber) or frame-setup-conflict-control-vs-grenade (red) — both already catalogued and exercised via SERVER_LINES.',
};
