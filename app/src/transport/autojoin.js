// A60: when a phone joins a Mission Control with no tap, and when it asks (docs/spec/node.md "Joining").
//
// The policy only: app.js feeds it every address that discovery turned up (an mDNS advert, a LAN sweep
// hit) and does what it answers. It is a separate module so the rules are testable without a webview.
//
//   * a dial the player named (QR, typed, tapped JOIN) inside its welcome window  -> ignore (never override it)
//   * the remembered address, or the one being dialled                  -> kick that dial, no row
//   * any other host, with a trust key, not cooling down                -> verify dial (the proof breaks ties)
//   * no trust key: one other host -> "new"; two or more -> "several"
//   * a host that failed a proof dial (10 min cool-down)                -> "unverified" (or the plain row)
//
// A verify dial sends no node_key, no join secret and no utility proof, and the transport processes
// nothing from it until `welcome.mc_proof` checks out (transport.js `_onWelcome`).

export const CANDIDATE_TTL_MS = 120000;          // an address not seen again for 2 min is forgotten
// A host whose proof dial failed, however it failed, is not proof-dialled again for 10 min. A proof dial
// pauses the remembered dial, so a short cool-down on a silent host would keep pausing it (polish r1 #8).
export const VERIFY_COOLDOWN_MS = 10 * 60000;

/** @typedef {'new'|'several'|'unproven'} OfferReason */
/** @typedef {{url:string, source:string, at:number}} Candidate */
/** @typedef {{do:'ignore'|'kick'|'verify'|'offer', reason?:OfferReason|null}} Decision */

/** @param {unknown} url @returns {string} */
export function urlKey(url) {
  return String(url || '').trim().toLowerCase().replace(/\/+$/, '');
}
/** @param {string} url @returns {string} */
export function hostOf(url) { return (String(url).match(/\/\/([^/]+)/) || [])[1] || String(url); }

/** The HUD's JOIN-row text for each reason. The HUD renders it verbatim, and it fits one line at 667 px.
 *  @param {OfferReason|null|undefined} reason @param {string} url @returns {string|null} */
export function offerText(reason, url) {
  const host = hostOf(url);
  if (reason === 'new') return `NEW MISSION CONTROL · ${host} · TAP JOIN`;
  if (reason === 'several') return 'SEVERAL MISSION CONTROLS · TAP YOURS';
  if (reason === 'unproven') return `UNVERIFIED MISSION CONTROL · ${host} · TAP JOIN IF YOURS`;
  return null;
}

/** F346 (c): the dial the player named still owns its welcome window. The window is the transport's own
 *  armed deadline (`welcomeWindowOpen()`), so a 4003 reclaim wait (about 19.5 s) is covered, not only the
 *  10 s welcome timeout.
 *  @param {{t:any}|null} dial the dial the player named last  @param {any} current the live transport */
export function namedDialPending(dial, current) {
  return !!(dial && current && dial.t === current && !current.closed && current.state !== 'bound'
    && typeof current.welcomeWindowOpen === 'function' && current.welcomeWindowOpen());
}

export class McAutoJoin {
  /** @param {{now?: () => number}} [o] */
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    /** @type {Map<string, Candidate>} */ this.candidates = new Map();
    /** @type {Map<string, {until:number, why:'unproven'|'silent'}>} */ this.cooldown = new Map();
  }
  /** @returns {Candidate[]} */
  live() {
    const now = this.now();
    for (const [k, c] of this.candidates) if (now - c.at > CANDIDATE_TTL_MS) this.candidates.delete(k);
    return [...this.candidates.values()];
  }
  /**
   * @param {string} url @param {string} source
   * @param {{bound:boolean, dialling:string|null, verifying:boolean, hasTrustKey:boolean, remembered?:string|null, userDialPending?:boolean}} ctx
   *   `dialling` = the url of the live (not closed) transport, `verifying` = that transport is a proof dial,
   *   `remembered` = settings.mcUrl, `userDialPending` = a dial the player named is inside its welcome window
   * @returns {Decision}
   */
  onFound(url, source, { bound, dialling, verifying, hasTrustKey, remembered = null, userDialPending = false }) {
    const t = this.now();
    for (const [k, c] of this.cooldown) if (c.until <= t) this.cooldown.delete(k);   // expired entries never pile up
    if (!url || bound) return { do: 'ignore' };
    const key = urlKey(url);
    this.candidates.set(key, { url, source, at: this.now() });
    if (userDialPending) return { do: 'ignore' };               // the player's own choice is never overridden
    const mine = [dialling, remembered].filter(Boolean).map(urlKey);
    if (mine.includes(key)) return { do: verifying && urlKey(dialling) === key ? 'ignore' : 'kick' };
    if (verifying) return { do: 'ignore' };                    // one proof dial at a time
    const others = this.live().filter(c => !mine.includes(urlKey(c.url)));
    const cd = this.cooldown.get(key);
    const cooling = !!cd && cd.until > this.now();
    if (hasTrustKey && !cooling) return { do: 'verify' };      // the proof breaks ties between several hosts
    if (others.length > 1) return { do: 'offer', reason: 'several' };
    if (!hasTrustKey) return { do: 'offer', reason: 'new' };
    return { do: 'offer', reason: cd && cd.why === 'unproven' ? 'unproven' : null };
  }
  /** A verify dial ended without a join. @param {string} url @param {boolean} unproven the host answered but did not prove itself
   *  @returns {OfferReason|null} the row to show now (null: it never answered, so show nothing yet) */
  onVerifyFailed(url, unproven) {
    this.cooldown.set(urlKey(url), { until: this.now() + VERIFY_COOLDOWN_MS, why: unproven ? 'unproven' : 'silent' });
    return unproven ? 'unproven' : null;
  }
  /** A join landed: forget the discovery state of this run. */
  onBound() { this.candidates.clear(); this.cooldown.clear(); }
}
