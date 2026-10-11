import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoveredRow } from '../src/hud/shared.js';
import { displayHost, offerText } from '../src/transport/autojoin.js';

// DRY #5 (2026-10-11): the HUD's found row and the JOIN offer name an MC by one helper, so the two rows
// never disagree on the same address.
test('the found row names the MC host as the join offer does', () => {
  for (const url of ['ws://10.0.0.5:8765/ws', 'ws://MC-Laptop.local:8765/ws', 'ws://10.0.0.5:80/ws', 'http://[fe80::1]:8765/']) {
    const row = discoveredRow({ url, source: 'mdns' });
    assert.ok(row.includes(` AT ${displayHost(url)} · JOIN`), `${url}: ${row}`);
    assert.ok(offerText('new', url).includes(` ${displayHost(url)} `), url);
  }
});

test('a JOIN row shows only the host: no userinfo, path or query, and nothing for a URL that does not parse', () => {
  assert.equal(displayHost('ws://user:pass@10.0.0.5:8765/ws?token=secret'), '10.0.0.5:8765');
  assert.equal(displayHost('ws://10.0.0.5:8765?token=secret'), '10.0.0.5:8765');
  for (const bad of [null, undefined, '', 'not a url']) assert.equal(displayHost(bad), '', String(bad));
  assert.ok(!offerText('new', 'ws://user:pass@10.0.0.5:8765/ws').includes('pass'));
});
