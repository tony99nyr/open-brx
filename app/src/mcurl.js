// Reading a Mission Control join target out of arbitrary scanned text.
//
// Its own module so it can be tested: `app.js` is the app shell and pulls in the DOM and Capacitor
// at import time, so nothing inside it can be exercised by `node --test`. This is pure.

/**
 * The websocket URL an MC join QR encodes, or null if this is not one.
 *
 * Accepts a bare `ws://`/`wss://` string, or any URL carrying the target in a `?ws=` / `#ws=`
 * parameter (which is how the console's own join link is shaped). Case-insensitive on the scheme:
 * URI schemes are case-insensitive (RFC 3986 §3.1) and a QR generator is free to emit `WS://`,
 * which the scanner used to silently ignore.
 *
 * @param {string|null|undefined} text raw text decoded from the QR
 * @returns {string|null}
 */
export function parseMcQr(text) {
  const t = (text || '').trim();
  if (/^wss?:\/\//i.test(t)) return t;
  const m = /[?#&]ws=([^&\s]+)/i.exec(t);
  if (!m) return null;
  try {
    const u = decodeURIComponent(m[1]);
    return /^wss?:\/\//i.test(u) ? u : null;   // a ?ws= that is not a websocket URL is not an MC code
  } catch {
    return null;                               // a malformed %-escape is not an MC code either
  }
}
