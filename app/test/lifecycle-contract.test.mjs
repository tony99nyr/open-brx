import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const utility = await readFile(new URL('../src/utility.js', import.meta.url), 'utf8');

test('S35: app lifecycle keeps log sync on the shared transport and uploads from the ring', () => {
  assert.match(app, /const logsync = new LogSync\(/);
  assert.match(app, /transport: \(\) => transport/);
  assert.match(app, /snapshot: from => logSnapshot\(from\)/);
  assert.match(app, /onUploaded: through => logRing\.pulled\(through\)/);
  assert.match(app, /logsync\.onBound\(\)/);
  assert.match(app, /m\.kind === 'pull_log'/);
});

test('S35: app lifecycle keeps background log sync bounded to live match phases', () => {
  assert.match(app, /phase: \(\) => engine\.phase/);
  assert.match(app, /if \(s === 'bound'\).*logsync\.onBound\(\)/s);
  assert.match(app, /logsync\.request\(\(m\.body && m\.body\.reason\) \|\| 'pull'\)/);
});

test('S35: utility lifecycle reports its node identity and persists station settings', () => {
  assert.match(utility, /node_type: 'utility'/);
  assert.match(utility, /app_ver: UTIL_VER/);
  assert.match(utility, /keyPrefix: 'brxu'/);
  assert.match(utility, /localStorage\.getItem\('brx\.utility'\)/);
  assert.match(utility, /localStorage\.setItem\('brx\.utility'/);
});

test('S35: utility release flushes status before handing back to the HUD', () => {
  assert.match(utility, /transport\.status\(utilityStatusBody\(\)\)/);
  assert.match(utility, /localStorage\.setItem\(PRIOR_UTILITY_KEY/);
  assert.match(utility, /localStorage\.setItem\('brx\.role', 'hud'\)/);
  assert.match(utility, /location\.replace\('index\.html\?hud'\)/);
});
