// What the QR scanner accepts as a Mission Control join code.
//
// Closes two polish-loop 2026-08-26 deferred lows: a `WS://` code was silently ignored (URI schemes
// are case-insensitive, RFC 3986 §3.1), and a code the camera READ but that was not an MC code
// looked identical to reading nothing at all — the operator kept aiming at a Wi-Fi QR wondering why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMcQr } from '../src/mcurl.js';

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
