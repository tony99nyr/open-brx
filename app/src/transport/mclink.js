// MC address discovery and dial lifecycle for the HUD and station phones.
// The caller supplies sockets, scan services and node-specific Transport setup.
import { McAutoJoin, namedDialPending } from './autojoin.js';
import { sweepPlan, localIpFrom, sweepForMc } from './discover.js';
import { startUtilitySweep } from './utility-join.js';

export const MC_MDNS_SERVICE = '_openbrx._tcp.';
export const AUTOJOIN_LOCK_MS = 10 * 60 * 1000;

/** @typedef {import('./transport.js').Transport} Transport */
/** @typedef {{remember?:boolean, trusted?:boolean, user?:boolean, firstContact?:boolean,
 *   wsFactory?:((url:string) => any), connect?:any}} DialOptions */
/** @typedef {{rememberAtDial:(o:DialOptions)=>boolean, rememberAtBound:(o:DialOptions)=>boolean,
 *   autoJoin:string, sweep:string}} LinkPolicy */

export const HUD_POLICY = Object.freeze({
  rememberAtDial: (/** @type {DialOptions} */ { remember }) => !!remember,   // the old `if (remember)`, exactly
  rememberAtBound: () => true,
  autoJoin: 'proof',
  sweep: 'suggest',
});
export const STATION_POLICY = Object.freeze({
  rememberAtDial: (/** @type {DialOptions} */ { trusted }) => !!trusted,         // the old `if (trusted)` / `!trusted`, exactly
  rememberAtBound: (/** @type {DialOptions} */ { trusted }) => !trusted,
  autoJoin: 'untrusted',
  sweep: 'dial',
});

/** @param {string|null|undefined} url */
function hostOf(url) {
  try { return new URL(String(url).replace(/^ws/, 'http')).hostname.toLowerCase(); } catch (_) { return ''; }
}

/** @param {any} res */
export function discoveredUrl(res) {
  if (!res || (res.action !== 'resolved' && res.action !== 'added')) return null;
  const svc = res.service || {};
  const ip = svc.ipv4Addresses && svc.ipv4Addresses[0];
  if (!ip || !svc.port) return null;
  const path = svc.txtRecord && svc.txtRecord.ws_path || '/ws';
  return `ws://${ip}:${svc.port}${path}`;
}

export class McLink {
  /** @param {{policy:LinkPolicy, makeTransport:(previous:Transport|null, options:DialOptions)=>Transport,
   *   current:()=>Transport|null, setCurrent:(transport:Transport)=>void,
   *   remember:(url:string, bound:boolean)=>void, now?:()=>number}} options */
  constructor({ policy, makeTransport, current, setCurrent, remember, now = () => Date.now() }) {
    this.policy = policy;
    this.makeTransport = makeTransport;
    this.current = current;
    this.setCurrent = setCurrent;
    this.remember = remember;
    this.now = now;
    this.autoJoin = new McAutoJoin({ now });
    /** @type {Transport|null} */ this.userDial = null;
    /** @type {Transport|null} */ this.firstContactDial = null;
    this.sweeping = false;
    /** @type {Map<string, number>} */ this.refusedAt = new Map();
  }

  /** @param {string} url @param {DialOptions} options @param {(transport:Transport)=>void} prepare */
  dial(url, options, prepare) {
    if (!url) return null;
    if (this.policy.rememberAtDial(options)) this.remember(url, false);
    const previous = this.current();
    if (previous) { try { previous.close(); } catch (_) { /* ignore */ } }
    const transport = this.makeTransport(previous, options);
    this.setCurrent(transport);
    this.userDial = options.user === true ? transport : null;
    this.firstContactDial = options.firstContact === true ? transport : null;
    prepare(transport);
    return { transport, promise: transport.connect(options.connect) };
  }

  /** @param {Transport} transport @param {string|null} url @param {DialOptions} options */
  bound(transport, url, options) {
    // Review #8 (a named change): a transport that binds after a redial replaced it is stale. The old code still
    // remembered the CURRENT dial's URL then (an unproven proof dial on the HUD); nothing is remembered now.
    if (this.current() !== transport) return;
    if (this.policy.rememberAtBound(options) && url) this.remember(url, true);
    if (this.policy.autoJoin === 'proof') this.autoJoin.onBound();
  }

  userDialPending() { return namedDialPending(this.userDial && { t: this.userDial }, this.current()); }
  /** @param {string} url @param {string} source
   *  @param {{remembered:string|null, hasTrustKey:boolean}} context */
  found(url, source, { remembered, hasTrustKey }) {
    const current = this.current();
    const live = current && !current.closed ? current : null;
    const firstContactLive = !!(live && this.firstContactDial === live && live.state !== 'bound');
    return this.autoJoin.onFound(url, source, { bound: !!(current && current.state === 'bound'),
      dialling: live && live.url, verifying: !!(live && (live.verify || firstContactLive)),
      hasTrustKey, remembered, userDialPending: this.userDialPending() });
  }

  /** @param {any} zeroconf @param {(url:string)=>void} onFound
   *  @param {(error:unknown, phase:string)=>void} onError */
  watch(zeroconf, onFound, onError) {
    if (!zeroconf) return;
    try {
      zeroconf.watch({ type: MC_MDNS_SERVICE, domain: 'local.' }, (/** @type {any} */ res) => {
        try { const url = discoveredUrl(res); if (url) onFound(url); }
        catch (e) { onError(e, 'discovery'); }
      }).catch((/** @type {unknown} */ e) => onError(e, 'watch'));
    } catch (e) { onError(e, 'init'); }
  }

  /** @param {string} url @param {{inPlay:boolean, lastBoundAt:number, heldUrls:(string|null)[],
   *  remembered:string, log:(message:string, cls?:string)=>void}} context */
  allowAutoJoin(url, { inPlay, lastBoundAt, heldUrls, remembered, log }) {
    if (this.policy.autoJoin !== 'untrusted' || !inPlay) return true;
    const boundAt = Number(lastBoundAt) || 0;
    const now = this.now();
    if (!boundAt || now - boundAt >= AUTOJOIN_LOCK_MS) return true;
    const held = heldUrls.map(hostOf).filter(Boolean);
    if (held.includes(hostOf(url))) return true;
    if (now - (this.refusedAt.get(url) || -Infinity) >= 60000) {
      this.refusedAt.set(url, now);
      log(`MC FOUND AT ${url}, NOT JOINING: THE STATION IS IN PLAY AND ${held.length ? `ITS MC IS ${remembered || held[0]}` : 'HOLDS NO MC ADDRESS'} (HOLD RANGE TO CHANGE IT)`, 'le');
    }
    return false;
  }

  /** @param {any} options */
  runSweep(options) {
    return this.policy.sweep === 'dial' ? startUtilitySweep(options) : this.sweepHud(options);
  }

  /** @param {{isBound:()=>boolean, isOnline:()=>boolean, getNetworkStatus:()=>Promise<any>,
   *  joinUrl:()=>string|null, remembered:()=>string, wsFactory:(url:string)=>any, isPaused:()=>boolean,
   *  log:(message:string, cls?:string)=>void, onFound:(url:string, source:string)=>void,
   *  sweep?:(options:import('./discover.js').SweepOptions)=>Promise<string|null>}} options */
  async sweepHud({ isBound, isOnline, getNetworkStatus, joinUrl, remembered, wsFactory, isPaused,
                   log, onFound, sweep = sweepForMc }) {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      if (isBound() || !isOnline()) return;
      let localIp = null;
      try { localIp = localIpFrom(await getNetworkStatus()); } catch (_) { /* ignore */ }
      const plan = sweepPlan({ localIp, joinUrl: joinUrl() });   // read after the network wait, as before
      const urlAtStart = remembered();
      const shouldStop = () => isBound() || remembered() !== urlAtStart;
      log(`sweeping for Mission Control on ${plan.subnets.map(sn => sn + '.x').join(', ')} :${plan.ports.join('/')}…`, 'li');
      const found = await sweep({ ...plan, wsFactory, shouldStop, isPaused,
        onSubnet: sn => log(`sweep: ${sn}.0/24`, 'li') });
      if (!found) { log('sweep found no Mission Control — QR/manual join', 'li'); return; }
      if (!shouldStop()) onFound(found, 'sweep');
    } finally { this.sweeping = false; }
  }
}
