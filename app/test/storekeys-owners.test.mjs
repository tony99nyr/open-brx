// The store keys that app.js and utility.js used to retype now come from one owner each. The strings are on players' phones: they must not change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRIOR_UTILITY_KEY, ROLE_KEY, pubUrlKey } from '../src/transport/transport.js';
import { MC_URL_KEY } from '../src/mcurl.js';
import { HISTORY_KEY } from '../src/history.js';

test('each owned store key keeps its exact string', () => {
  assert.equal(PRIOR_UTILITY_KEY, 'brx.prior_utility');
  assert.equal(ROLE_KEY, 'brx.role');
  assert.equal(MC_URL_KEY, 'brx.mc_url');
  assert.equal(HISTORY_KEY, 'brx.history');
  assert.equal(pubUrlKey('brxu'), 'brxu.pub_url');
  assert.equal(pubUrlKey('brx'), 'brx.pub_url');
});
