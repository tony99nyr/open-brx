// How a UTILITY phone (utility.js) finds and names Mission Control. Pure, so `node --test` can drive it:
// utility.js pulls in the DOM and the plugins at import time.
//
// 1. `startUtilitySweep`: the LAN sweep fallback for the utility screen's own search (bench 2026-09-24,
//    app 0.4.10, Pixel 5). The utility search was mDNS-only. MC in WSL sits behind a Windows portproxy,
//    so its mDNS never reaches the LAN, and the screen said "SEARCHING THIS WI-FI" forever while the
//    player screen's sweep (app.js `sweepForMc`) found MC at 192.168.0.55:8766 on the same Wi-Fi.
//    A utility phone has no player takeover key, so a hit may auto-join (`trusted: false`, the same as an
//    mDNS hit). A player phone only SUGGESTS a sweep hit; see app.js.
// 2. `resolveTypedMc`: what the typed-address buttons dial. The HUD runs the text through `parseMcJoin`
//    first (app.js `onSetUrl`); the utility buttons passed it raw, so a pasted console address
//    (`http://<host>:8765/`) was saved as settings.mc and redialled on every start.

import { parseMcJoin } from '../mcurl.js';
import { sweepPlan, sweepForMc, MC_WS_PORT } from './discover.js';

/** @typedef {import('./discover.js').DiscoverWebSocket} DiscoverWebSocket */
/** @typedef {import('./discover.js').DiscoverTimers} DiscoverTimers */
/** @typedef {import('./discover.js').SweepOptions} SweepOptions */
/** @typedef {{url:string, join:boolean, pub:string|null, secret:string|null, note:string|null}} TypedMc  `join`: a join code, so pub/secret replace the held ones (null clears), as the HUD's onSetUrl does */
/** @typedef {{isBound: () => boolean, operatorUrl: () => boolean, connect: (url:string, options:{trusted:false}) => void,
 *   log?: (msg:string, cls?:string) => void, wsFactory?: (url:string) => DiscoverWebSocket, getLocalIp?: () => Promise<string|null>,
 *   isOnline?: () => boolean, timers?: DiscoverTimers, firstDelayMs?: number, everyMs?: number,
 *   sweep?: (options:SweepOptions) => Promise<string|null>, sweepOptions?: SweepOptions}} UtilitySweepOptions */

/** First sweep this long after discovery starts, if mDNS has not bound the phone by then. */
export const UTILITY_SWEEP_FIRST_MS = 4000;
/** Then again this long after each sweep that ended unbound. */
export const UTILITY_SWEEP_EVERY_MS = 30000;

/**
 * The typed text → what to dial, or null for empty text.
 * - A join code or a ws(s):// url: `parseMcJoin`'s url, pub and secret.
 * - An http:// console address: MC's node socket on the same host (`ws://<host>:8766/ws`), with a note to log.
 *   An https:// address (the tunnel) passes through: its node socket is not on the LAN port.
 * - Anything else: passed through as typed (the bare-address floor the HUD also keeps).
 * @param {string|null|undefined} text
 * @returns {TypedMc|null}
 */
export function resolveTypedMc(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return null;
  const j = parseMcJoin(t);
  if (j) return { url: j.url, join: true, pub: j.pub, secret: j.secret, note: null };
  const m = /^http:\/\/(\[[^\]]+\]|[^/:?#]+)/i.exec(t);
  if (m) {
    const url = `ws://${m[1]}:${MC_WS_PORT}/ws`;
    return { url, join: false, pub: null, secret: null, note: `that is the console address; connecting to the default node port ${url}` };
  }
  return { url: t, join: false, pub: null, secret: null, note: null };
}

/**
 * Sweep the LAN for MC while the utility phone is unbound and the operator named no address.
 * First round after `firstDelayMs`, then `everyMs` after each round that ended unbound. It ends for good
 * once the phone is bound or the operator types or scans a URL, and a round in flight ends at the next batch.
 * @param {UtilitySweepOptions} o
 * @returns {{stop(): void, readonly stopped: boolean, readonly rounds: number}}
 */
export function startUtilitySweep({ isBound, operatorUrl, connect, log = () => {}, wsFactory, getLocalIp = async () => null,
                                    isOnline = () => true, timers = globalThis, firstDelayMs = UTILITY_SWEEP_FIRST_MS,
                                    everyMs = UTILITY_SWEEP_EVERY_MS, sweep = sweepForMc, sweepOptions = {} }) {
  let stopped = false, rounds = 0;
  /** @type {unknown} */ let timer = null;
  const done = () => stopped || isBound() || operatorUrl();
  const stop = () => {
    stopped = true;
    if (timer != null) { try { timers.clearTimeout(timer); } catch (_) { /* ignore */ } timer = null; }
  };
  /** @param {number} ms */
  const schedule = ms => { if (!stopped) timer = timers.setTimeout(() => { timer = null; void round(); }, ms); };
  const round = async () => {
    if (done()) { stop(); return; }
    if (!isOnline()) { schedule(everyMs); return; }   // no network, no sweep this round
    rounds++;
    /** @type {string|null} */ let localIp = null;
    try { localIp = await getLocalIp(); } catch (_) { /* ignore */ }
    const plan = sweepPlan({ localIp });              // never a remembered url: that swept yesterday's subnet (F139)
    log(`sweeping for Mission Control on ${plan.subnets.map(sn => sn + '.x').join(', ')} :${plan.ports.join('/')}…`, 'li');
    /** @type {string|null} */ let found = null;
    try {
      found = await sweep({ ...plan, ...sweepOptions, wsFactory, timers, shouldStop: done,
        onSubnet: sn => log(`sweep: ${sn}.0/24`, 'li') });
    } catch (e) { log('MC sweep: ' + (e instanceof Error ? e.message : String(e)), 'le'); }
    if (done()) { stop(); return; }
    if (found) {
      log(`MISSION CONTROL FOUND BY SWEEP — CONNECTING ${found}`, 'lk');
      connect(found, { trusted: false });
    } else log('sweep found no Mission Control — QR/manual join', 'li');
    schedule(everyMs);
  };
  schedule(firstDelayMs);
  return { stop, get stopped() { return stopped; }, get rounds() { return rounds; } };
}
