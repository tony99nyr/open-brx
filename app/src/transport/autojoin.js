// A60: when a phone joins a Mission Control with no tap, and when it asks (docs/spec/node.md "Joining").
//
// The policy only: app.js feeds it every address that discovery turned up (an mDNS advert, a LAN sweep
// hit) and does what it answers. It is a separate module so the rules are testable without a webview.
//
//   * a dial the player named (QR, typed, tapped JOIN) inside its welcome window  -> ignore (never override it)
//   * the remembered address, or the one being dialled                  -> kick that dial, no row
//   * any other host, with a trust key, not cooling down                -> verify dial (the proof breaks ties)
//   * F346 (d) first contact: no trust key AND no remembered address, exactly ONE distinct MC (host:port)
//     among the hosts discovery saw, FIRST_CONTACT_SETTLE_MS after the first of them  -> first-contact dial
//   * no trust key otherwise: one other host -> "new"; two or more distinct hosts -> "several"
//   * a host that failed a proof dial or a first-contact dial (10 min cool-down)  -> "unverified" / "new" / plain row
//
// A verify dial sends no node_key, no join secret and no utility proof, and the transport processes
// nothing from it until `welcome.mc_proof` checks out (transport.js `_onWelcome`). A first-contact dial is
// an untrusted dial (`trusted:false`): it sends no node_key, no join secret and no utility proof, but it
// sends `mc_enroll` + `mc_enroll_nonce`, so the MC that welcomes it issues this phone its trust key.
// Trust on first use is Tony's accepted trade-off (F346 d): a rogue host that is the only MC this phone
// can see claims a fresh phone. A phone that holds a key for any MC never first-contacts: another MC must
// prove itself, or the player taps UNVERIFIED.

export const CANDIDATE_TTL_MS = 120000;          // an address not seen again for 2 min is forgotten
// A host whose proof dial failed, however it failed, is not proof-dialled again for 10 min. A proof dial
// pauses the remembered dial, so a short cool-down on a silent host would keep pausing it (polish r1 #8).
export const VERIFY_COOLDOWN_MS = 10 * 60000;
// F346 (d): the discovery window. A first contact joins only when one distinct MC is in view this long after
// the first sighting, so a second MC whose advert lands a moment later gives "several", not a race.
export const FIRST_CONTACT_SETTLE_MS = 3000;

/** @typedef {'new'|'several'|'unproven'} OfferReason */
/** @typedef {{url:string, source:string, at:number, startedAt?:number}} Candidate */
/** @typedef {{do:'ignore'|'kick'|'verify'|'join'|'wait'|'offer', reason?:OfferReason|null, ms?:number, url?:string}} Decision
 *  `join` = a first-contact dial (F346 d), `wait` = ask again in `ms` (the discovery window is still open). */

/** @param {unknown} url @returns {string} */
export function urlKey(url) {
  return String(url || '').trim().toLowerCase().replace(/\/+$/, '');
}
/** @param {string} url @returns {string} */
export function hostOf(url) { return (String(url).match(/\/\/([^/]+)/) || [])[1] || String(url); }
/** The host:port a player reads on a JOIN row: parsed, so it never shows userinfo, a path or a query, and a URL that
 *  does not parse shows nothing rather than itself. Display only; `mcKey` is the identity.
 *  @param {string|null|undefined} url @returns {string} */
export function displayHost(url) {
  try { return new URL(String(url)).host; } catch (_) { return ''; }
}
/** One MC = one host:port. mDNS and the sweep can name the same MC with different paths.
 *  @param {string} url @returns {string} */
export function mcKey(url) { return hostOf(urlKey(url)); }

/** The HUD's JOIN-row text for each reason. The HUD renders it verbatim, and it fits one line at 667 px.
 *  @param {OfferReason|null|undefined} reason @param {string} url @returns {string|null} */
export function offerText(reason, url) {
  const host = displayHost(url);
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

/**
 * F659: two MCs on one LAN. Which one the phone prefers: first the last-good MC (the address it last bound to,
 * matched on host:port), else the newest `startedAt` (mDNS TXT; a sweep hit cannot read TXT and counts as 0, so the
 * first sweep hit never outranks a dated advert), else the first found. Shared cases: fixtures/mc-pick-cases.json.
 * @param {{url:string, startedAt?:number}[]} found @param {string|null|undefined} lastGood
 * @returns {{url:string, startedAt?:number}|null}
 */
export function pickMc(found, lastGood) {
  if (!found.length) return null;
  if (lastGood) {
    const good = found.find(c => mcKey(c.url) === mcKey(lastGood));
    if (good) return good;
  }
  let best = found[0];
  for (const c of found) if ((c.startedAt || 0) > (best.startedAt || 0)) best = c;
  return best;
}

export class McAutoJoin {
  /** @param {{now?: () => number}} [o] */
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    /** @type {Map<string, Candidate>} */ this.candidates = new Map();
    /** @type {Map<string, {until:number, why:'unproven'|'silent'}>} */ this.cooldown = new Map();
    /** F346 (d): when the first host of this discovery window was seen (null: no live candidate). */
    /** @type {number|null} */ this.firstSeenAt = null;
    /** F659: how many MCs were in view when the last join landed (the HUD's "(2 FOUND)"). */
    this.lastFound = 0;
  }
  /** @returns {Candidate[]} */
  live() {
    const now = this.now();
    for (const [k, c] of this.candidates) if (now - c.at > CANDIDATE_TTL_MS) this.candidates.delete(k);
    if (!this.candidates.size) this.firstSeenAt = null;   // everything expired: the next sighting opens a new window
    return [...this.candidates.values()];
  }
  /**
   * @param {string} url @param {string} source
   * @param {{bound:boolean, dialling:string|null, verifying:boolean, hasTrustKey:boolean, remembered?:string|null, userDialPending?:boolean}} ctx
   *   `dialling` = the url of the live (not closed) transport, `verifying` = that transport is an automatic
   *   dial (a proof dial or a first-contact dial) still waiting for its welcome,
   *   `remembered` = settings.mcUrl, `userDialPending` = a dial the player named is inside its welcome window
   * @param {number} [startedAt] the MC's own start time (mDNS TXT `started_at`), when the source could read it
   *   With more than one MC in view, `url` on the decision is the pick (pickMc): the one to dial or offer.
   * @returns {Decision}
   */
  onFound(url, source, { bound, dialling, verifying, hasTrustKey, remembered = null, userDialPending = false }, startedAt) {
    const t = this.now();
    for (const [k, c] of this.cooldown) if (c.until <= t) this.cooldown.delete(k);   // expired entries never pile up
    if (!url || bound) return { do: 'ignore' };
    const key = urlKey(url);
    if (!this.live().length) this.firstSeenAt = t;              // the first sighting opens the discovery window
    const prior = this.candidates.get(key);
    this.candidates.set(key, { url, source, at: t, startedAt: startedAt ?? (prior && prior.startedAt) });
    if (userDialPending) return { do: 'ignore' };               // the player's own choice is never overridden
    const mine = [dialling, remembered].filter(Boolean).map(urlKey);
    if (mine.includes(key)) return { do: verifying && urlKey(dialling) === key ? 'ignore' : 'kick' };
    if (verifying) return { do: 'ignore' };                    // one automatic dial at a time
    const others = this.live().filter(c => !mine.includes(urlKey(c.url)));
    const distinct = new Set(others.map(c => mcKey(c.url))).size;
    // F659: with several MCs in view the phone has ONE preferred: the last-good, else the newest.
    const pick = this.foundCount() > 1 ? pickMc(this.live(), remembered) : null;
    const pickIsMine = !!pick && mine.includes(urlKey(pick.url));
    if (pickIsMine && hasTrustKey) return { do: 'ignore' };   // the last-good MC is the dial already running
    const target = pick && !pickIsMine ? pick.url : url;
    const tkey = urlKey(target);
    const cd = this.cooldown.get(tkey);
    const cooling = !!cd && cd.until > t;
    const at = pick && !pickIsMine ? { url: target } : {};
    if (hasTrustKey && !cooling) return { do: 'verify', ...at };      // the proof breaks ties between several hosts
    if (distinct > 1) return { do: 'offer', reason: 'several', ...at };
    if (!hasTrustKey && !remembered && !cooling) {             // F346 (d): first contact, one MC in view
      const wait = (this.firstSeenAt ?? t) + FIRST_CONTACT_SETTLE_MS - t;
      return wait > 0 ? { do: 'wait', ms: wait } : { do: 'join' };
    }
    if (!hasTrustKey) return { do: 'offer', reason: 'new' };
    return { do: 'offer', reason: cd && cd.why === 'unproven' ? 'unproven' : null };
  }
  /** How many distinct MCs (host:port) discovery has in view now. @returns {number} */
  foundCount() { return new Set(this.live().map(c => mcKey(c.url))).size; }
  /** A verify dial ended without a join. @param {string} url @param {boolean} unproven the host answered but did not prove itself
   *  @returns {OfferReason|null} the row to show now (null: it never answered, so show nothing yet) */
  onVerifyFailed(url, unproven) {
    this.cooldown.set(urlKey(url), { until: this.now() + VERIFY_COOLDOWN_MS, why: unproven ? 'unproven' : 'silent' });
    return unproven ? 'unproven' : null;
  }
  /** F346 (d): a first-contact dial ended without a join (no welcome, or refused). Cool the host, so it is
   *  not redialled on every advert, and ask the player instead: SEVERAL if discovery saw another distinct
   *  host meanwhile (r1), else NEW. @param {string} url @returns {OfferReason} */
  onFirstContactFailed(url) {
    this.cooldown.set(urlKey(url), { until: this.now() + VERIFY_COOLDOWN_MS, why: 'silent' });
    return new Set(this.live().map(c => mcKey(c.url))).size > 1 ? 'several' : 'new';
  }
  /** A join landed: forget the discovery state of this run. */
  onBound() { this.lastFound = this.foundCount(); this.candidates.clear(); this.cooldown.clear(); this.firstSeenAt = null; }
}
