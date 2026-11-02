// Reading a Mission Control join target out of arbitrary scanned text.
//
// Its own module so it can be tested: `app.js` is the app shell and pulls in the DOM and Capacitor
// at import time, so nothing inside it can be exercised by `node --test`. This is pure.

/** The one owner of the stored MC address the operator typed or scanned (app.js reads and writes it, utility.js reads it). */
export const MC_URL_KEY = 'brx.mc_url';

/**
 * The full join target an MC join QR (or the console's join link, or a hand-typed address) encodes:
 * the bare LAN websocket URL (query stripped), the join secret, and — when MC's tunnel is up — the
 * public backhaul URL (contracts A28.2). Returns null if this is not an MC code at all.
 *
 * Accepts the same input shapes `parseMcQr` accepts: a bare `ws://`/`wss://` string (the query, if
 * any, carries `s=`/`pub=`), or any URL carrying the target in a `?ws=`/`#ws=` wrapper (the console's
 * own join link) — case-insensitive on the scheme in both the outer wrapper and the target itself
 * (URI schemes are case-insensitive, RFC 3986 §3.1).
 *
 * @param {string|null|undefined} text raw text decoded from the QR (or typed by hand)
 * @returns {{url:string, pub:string|null, secret:string|null}|null}
 */
export function parseMcJoin(text) {
  const t = (text || '').trim();
  let target;
  if (/^wss?:\/\//i.test(t)) {
    target = t;
  } else {
    const m = /[?#&]ws=([^&\s]+)/i.exec(t);
    if (!m) return null;
    try {
      target = decodeURIComponent(m[1]);
    } catch {
      return null;                            // a malformed %-escape is not an MC code either
    }
    if (!/^wss?:\/\//i.test(target)) return null;   // a ?ws= that is not a websocket URL is not an MC code
  }
  const qIdx = target.indexOf('?');
  const url = qIdx < 0 ? target : target.slice(0, qIdx);
  let pub = null, secret = null;
  if (qIdx >= 0) {
    const params = new URLSearchParams(target.slice(qIdx + 1));
    if (params.has('s')) secret = params.get('s') || null;
    if (params.has('pub')) {
      const raw = params.get('pub');
      // A28.2: pub is the optional half — the LAN url + secret are the mandatory floor (§5) and must
      // survive a malformed pub (rare: MC generates this value itself, but a typed/OCR'd code is not
      // MC's to control). Drop only pub, not the whole code.
      if (raw && /^wss?:\/\//i.test(raw)) pub = raw;
    }
  }
  return { url, pub, secret };
}

/** MC's operator console (HTTP) and its node websocket. A websocket to the console port is never a node link. */
export const MC_CONSOLE_PORT = 8765;
export const MC_WS_PORT = 8766;

/** @param {string} reason @returns {{refused:string}} */
const refuse = reason => ({ refused: reason });

/**
 * F659: the ONE place an MC address becomes a url to dial. Typed text, a scanned code, a console link, an mDNS record, a
 * stored value and `window.brx.connectMc` all pass through it. Returns `{url, join}` or `{refused}`.
 * - `http(s)://host[:port][/...]` is the console: it maps to `ws://host:8766/ws`. An https host that is a name (a
 *   tunnel) maps to `wss://host/ws` and keeps its port, if any.
 * - `ws(s)://host:8765/...` is the console port, so it maps to 8766. Any other port is kept (a wss tunnel has none).
 * - Any path becomes `/ws`: MC's node server answers 404 to every other path.
 * - `?s=` and `&pub=` (also inside a `?ws=`/`#ws=` wrapper) go to `join` and are never dialled: the secret belongs
 *   in the hello body.
 * - A bare `host[:port]` is read as a node address.
 * @param {string|null|undefined} text
 * @returns {{url:string, join:{secret?:string, pub?:string}, refused?:undefined}|{refused:string, url?:undefined, join?:undefined}}
 */
export function normaliseMcUrl(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return refuse('empty');
  /** @type {{secret?:string, pub?:string}} */ const join = {};
  let target = t;
  const j = parseMcJoin(t);
  if (j) {
    target = j.url;
    if (j.secret) join.secret = j.secret;
    if (j.pub) join.pub = j.pub;
  } else {
    if (/[?#&]ws=/i.test(t)) return refuse('not a websocket address');
    const q = t.search(/[?#]/);
    if (q >= 0) {
      const params = new URLSearchParams(t.slice(q + 1).replace(/^#/, ''));
      const s = params.get('s'), pub = params.get('pub');
      if (s) join.secret = s;
      if (pub && /^wss?:\/\//i.test(pub)) join.pub = pub;
      target = t.slice(0, q);
    }
  }
  const hostRe = '(\\[[^\\]]+\\]|[^/:?#\\s]+)(?::(\\d{1,6}))?';
  let scheme = 'ws', host, port, bare = false;
  const m = new RegExp(`^([a-z][a-z0-9+.-]*)://${hostRe}([/?#].*)?$`, 'i').exec(target);
  if (m) {
    scheme = m[1].toLowerCase(); host = m[2]; port = m[3];
    if (!['ws', 'wss', 'http', 'https'].includes(scheme)) return refuse('unknown scheme');
  } else {
    const b = new RegExp(`^${hostRe}$`).exec(target);
    if (!b || !(b[3] || b[2] || /[.[]/.test(b[1]))) return refuse('not an address');
    host = b[1]; port = b[2]; bare = true;
  }
  if (!host) return refuse('no host');
  let n = port === undefined ? null : Number(port);
  if (n !== null && (n < 1 || n > 65535)) return refuse('bad port');
  const lan = /^(\[.*\]|\d+\.\d+\.\d+\.\d+|localhost|[^.]+|.*\.local)$/i.test(host);
  if (scheme === 'http' || (scheme === 'https' && lan)) { scheme = 'ws'; n = MC_WS_PORT; }
  else if (scheme === 'https') scheme = 'wss';
  else if (bare && n === null) n = MC_WS_PORT;
  if (n === MC_CONSOLE_PORT) n = MC_WS_PORT;
  return { url: `${scheme}://${host}${n === null ? '' : ':' + n}/ws`, join };
}

/**
 * F659: `connectMc`'s entry. The url to dial and the join to send, or null for an address that cannot be one. A secret
 * or pub the caller passed wins over one found in the url's query.
 * @param {string} text
 * @param {{pub?:string|null, secret?:string|null, [k:string]:any}} [join]
 */
export function mcDialTarget(text, join = {}) {
  const n = normaliseMcUrl(text);
  if (n.refused !== undefined) return null;
  /** @type {{pub?:string|null, secret?:string|null, [k:string]:any}} */ const out = { ...join };
  if (out.secret == null && n.join.secret) out.secret = n.join.secret;
  if (out.pub == null && n.join.pub) out.pub = n.join.pub;
  return { url: n.url, join: out };
}

/**
 * The websocket URL an MC join QR encodes, or null if this is not one. Legacy shape kept for old
 * callers (A28.2): `parseMcJoin` is now the source of truth, this just returns its `url`.
 *
 * @param {string|null|undefined} text raw text decoded from the QR
 * @returns {string|null}
 */
export function parseMcQr(text) {
  const j = parseMcJoin(text);
  return j ? j.url : null;
}

/** F563 (field 2026-10-17): a field Wi-Fi that keeps dropping fired `network up (cellular)` 91 times, and each one aborted
 *  the transport's backoff and redialled a LAN address cellular cannot reach, so the phone never settled. `last` is the
 *  last kick that DIALLED ({at, why}) or null. Any kick within 1 s of it is the same transition reaching us twice; and
 *  within CELLULAR_KICK_GAP_MS of a cellular kick, every kick but Wi-Fi's waits (the webview's `online` included). Wi-Fi after
 *  a cellular kick always dials, even inside that 1 s (F588). */
export const CELLULAR_KICK_GAP_MS = 30000;
/** @param {string} why @param {number} now @param {{at:number, why:string}|null} last @returns {boolean} */
export function kickHeld(why, now, last) {
  if (!last) return false;
  if (why === 'wifi' && last.why === 'cellular') return false;   // F588 (brx3 review): Wi-Fi back after cellular is a new transition
  if (now - last.at < 1000) return true;
  return why !== 'wifi' && last.why === 'cellular' && now - last.at < CELLULAR_KICK_GAP_MS;
}
