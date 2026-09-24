// A60: the phone's half of the Mission Control identity proof (docs/spec/contracts.md §5, A60).
//
// MC keeps an install secret and gives each phone ONE trust key, derived from its node_id
// (`welcome.mc_trust.key`). A later dial to an address the player never named sends a fresh
// `hello.mc_challenge`, and MC answers with
//   mc_proof = base64url(HMAC-SHA256(trust_key_bytes, "open-brx mc proof v1:" + challenge + ":" + session_id))
// where `trust_key_bytes` is the DECODED 32-byte key. The mirror is `mcp/brx_mcp/mc/mcid.py`, and one
// test vector (`app/test/fixtures/mc-proof-vector.json`) pins the two together.
//
// Synchronous on purpose: the transport checks the proof inside the welcome handler, BEFORE anything
// else in that welcome is processed. WebCrypto's HMAC is async, and a promise there would open a gap
// in which later frames arrive while the welcome is still unproven.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);

/** @param {Uint8Array} data @returns {Uint8Array} the 32-byte SHA-256 digest */
export function sha256(data) {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const bitLen = data.length * 8;
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  padded.set(data); padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + 4 * i);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(4 * i, h[i]);
  return out;
}

/** @param {Uint8Array} key @param {Uint8Array} msg @returns {Uint8Array} */
export function hmacSha256(key, msg) {
  const k = key.length > 64 ? sha256(key) : key;
  const block = new Uint8Array(64); block.set(k);
  const inner = new Uint8Array(64 + msg.length), outer = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) { inner[i] = block[i] ^ 0x36; outer[i] = block[i] ^ 0x5c; }
  inner.set(msg, 64);
  outer.set(sha256(inner), 64);
  return sha256(outer);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** base64url, no padding. @param {Uint8Array} bytes @returns {string} */
export function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) s += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) s += B64[n & 63];
  }
  return s;
}
/** @param {string} text @returns {Uint8Array|null} null for anything that is not base64url */
export function b64urlDecode(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const out = [];
  let buf = 0, bits = 0;
  for (const ch of text) {
    buf = (buf << 6) | B64.indexOf(ch); bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 0xff); }
  }
  return new Uint8Array(out);
}
const utf8 = (/** @type {string} */ s) => new TextEncoder().encode(s);

/** A trust key as MC issues it: base64url of exactly 32 bytes. @param {unknown} key @returns {boolean} */
export function validTrustKey(key) {
  const raw = typeof key === 'string' && key.length === 43 ? b64urlDecode(key) : null;
  return !!raw && raw.length === 32;
}

/** @param {string} keyB64 @param {string} challenge @param {string} sessionId @returns {string|null} */
export function mcProof(keyB64, challenge, sessionId) {
  const key = validTrustKey(keyB64) ? b64urlDecode(keyB64) : null;
  if (!key) return null;
  return b64url(hmacSha256(key, utf8(`open-brx mc proof v1:${challenge}:${sessionId}`)));
}

/** Constant-time for equal lengths (the length of a proof is public). @param {unknown} a @param {unknown} b */
export function ctEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The key in `keys` that `proof` proves for this challenge and session, or null. Every key is checked,
 *  whatever the first result, so the time taken does not say which key matched.
 *  @param {string[]} keys @param {unknown} proof @param {string} challenge @param {unknown} sessionId @returns {string|null} */
export function matchingKey(keys, proof, challenge, sessionId) {
  if (typeof proof !== 'string' || typeof sessionId !== 'string' || !sessionId || !challenge) return null;
  let hit = null;
  for (const k of keys) { const want = mcProof(k, challenge, sessionId); if (want && ctEqual(want, proof) && hit === null) hit = k; }
  return hit;
}
/** @param {string[]} keys @param {unknown} proof @param {string} challenge @param {unknown} sessionId */
export function proofMatches(keys, proof, challenge, sessionId) { return matchingKey(keys, proof, challenge, sessionId) !== null; }

/** A fresh challenge: 16 random bytes, base64url (22 characters). Throws with no CSPRNG, so a verify
 *  dial fails closed rather than sending a guessable challenge. @param {(n:number) => Uint8Array} [randomBytes] */
export function newChallenge(randomBytes) {
  const bytes = randomBytes ? randomBytes(16) : globalThis.crypto.getRandomValues(new Uint8Array(16));
  if (!(bytes instanceof Uint8Array) || bytes.length < 16) throw new Error('mc challenge: no random bytes');
  return b64url(bytes);
}
