// What the QR scanner accepts as a Mission Control join code.
//
// Closes two polish-loop 2026-08-26 deferred lows: a `WS://` code was silently ignored (URI schemes
// are case-insensitive, RFC 3986 §3.1), and a code the camera READ but that was not an MC code
// looked identical to reading nothing at all — the operator kept aiming at a Wi-Fi QR wondering why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMcQr, parseMcJoin } from '../src/mcurl.js';

test('a bare websocket URL is the code', () => {
  assert.equal(parseMcQr('ws://192.168.1.20:8765/ws'), 'ws://192.168.1.20:8765/ws');
  assert.equal(parseMcQr('  wss://mc.local:8765/ws  '), 'wss://mc.local:8765/ws');
});

test('the scheme is case-insensitive', () => {
  // a QR generator may emit an upper-cased scheme; the scanner used to just ignore the code
  assert.equal(parseMcQr('WS://192.168.1.20:8765/ws'), 'WS://192.168.1.20:8765/ws');
  assert.equal(parseMcQr('WSS://mc/ws'), 'WSS://mc/ws');
  assert.equal(parseMcQr('http://mc/#WS=ws%3A%2F%2Fx%2Fy'), 'ws://x/y');
});

test('the console join link carries the target in ?ws= or #ws=', () => {
  assert.equal(parseMcQr('http://192.168.1.20:8765/?ws=ws%3A%2F%2F192.168.1.20%3A8765%2Fws'), 'ws://192.168.1.20:8765/ws');
  assert.equal(parseMcQr('http://mc/#ws=ws%3A%2F%2Fmc%2Fws'), 'ws://mc/ws');
  assert.equal(parseMcQr('http://mc/?a=1&ws=ws%3A%2F%2Fmc%2Fws&b=2'), 'ws://mc/ws');
});

test('anything else is NOT an MC code', () => {
  for (const junk of ['', '   ', null, undefined,
                      'WIFI:S=field;T=WPA;P=secret;;',          // the other QR on a field table
                      'https://example.com',                     // a plain URL
                      'https://example.com/?ws=notaurl',         // a ws= that is not a websocket
                      'https://example.com/?ws=http%3A%2F%2Fx',  // ...nor a downgrade to http
                      'https://example.com/?ws=%E0%A4%A']) {     // a malformed %-escape must not throw
    assert.equal(parseMcQr(junk), null, JSON.stringify(junk));
  }
});

// ---------------- parseMcJoin (A28.2: the two-URL join) ----------------

test('parseMcJoin: a bare LAN url with no query is just {url, pub:null, secret:null}', () => {
  assert.deepEqual(parseMcJoin('ws://192.168.1.20:8765/ws'), { url: 'ws://192.168.1.20:8765/ws', pub: null, secret: null });
});

test('parseMcJoin: the join secret rides in ?s=', () => {
  assert.deepEqual(parseMcJoin('ws://192.168.1.20:8765/ws?s=abcDEF12'), { url: 'ws://192.168.1.20:8765/ws', pub: null, secret: 'abcDEF12' });
});

test('parseMcJoin: pub rides in &pub= (url-decoded), alongside the secret', () => {
  const pub = 'wss://random-name.trycloudflare.com/ws';
  const code = `ws://192.168.1.20:8765/ws?s=abcDEF12&pub=${encodeURIComponent(pub)}`;
  assert.deepEqual(parseMcJoin(code), { url: 'ws://192.168.1.20:8765/ws', pub, secret: 'abcDEF12' });
});

test('parseMcJoin: the ?ws=/#ws= wrapper carries a full join code, query and all', () => {
  const pub = 'wss://x.trycloudflare.com/ws';
  const inner = `ws://mc/ws?s=xyz&pub=${encodeURIComponent(pub)}`;
  assert.deepEqual(parseMcJoin(`http://mc/?ws=${encodeURIComponent(inner)}`), { url: 'ws://mc/ws', pub, secret: 'xyz' });
  assert.deepEqual(parseMcJoin(`http://mc/#ws=${encodeURIComponent(inner)}`), { url: 'ws://mc/ws', pub, secret: 'xyz' });
});

test('parseMcJoin: a bad pub (not a websocket URL) rejects the whole code', () => {
  assert.equal(parseMcJoin('ws://mc/ws?s=abc&pub=http%3A%2F%2Fnotws'), null);
  assert.equal(parseMcJoin('ws://mc/ws?s=abc&pub=not-a-url-at-all'), null);
});

test('parseMcJoin: an empty pub= is the same as no pub at all', () => {
  assert.deepEqual(parseMcJoin('ws://mc/ws?s=abc&pub='), { url: 'ws://mc/ws', pub: null, secret: 'abc' });
});

test('parseMcJoin: junk is still junk (same matrix as parseMcQr)', () => {
  for (const junk of ['', '   ', null, undefined, 'WIFI:S=field;T=WPA;P=secret;;', 'https://example.com']) {
    assert.equal(parseMcJoin(junk), null, JSON.stringify(junk));
  }
});

test('parseMcQr is unchanged: it is parseMcJoin(text)?.url, still null (not undefined) on a miss', () => {
  const pub = 'wss://x.trycloudflare.com/ws';
  assert.equal(parseMcQr(`ws://mc/ws?s=abc&pub=${encodeURIComponent(pub)}`), 'ws://mc/ws');
  assert.equal(parseMcQr('not an mc code'), null);
});
