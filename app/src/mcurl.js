// Reading a Mission Control join target out of arbitrary scanned text.
//
// Its own module so it can be tested: `app.js` is the app shell and pulls in the DOM and Capacitor
// at import time, so nothing inside it can be exercised by `node --test`. This is pure.

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
      if (raw) {
        if (!/^wss?:\/\//i.test(raw)) return null;   // A28.2: a pub that is not a websocket URL is not an MC code
        pub = raw;
      }
    }
  }
  return { url, pub, secret };
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
