// The HUD prints every medal in MC's ladder (contract.gen MEDALS, Tony's final list 2026-09-24): a key missing from the
// HUD's own label map used to be filtered out of the kill card and vanish.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MEDALS } from '../src/transport/contract.gen.js';
import { MEDAL_LABEL } from '../src/hud/hud.js';
import { CLIP_MS } from '../src/announcer.js';

test('every ladder medal has the HUD label the contract gives it', () => {
  for (const m of MEDALS) assert.equal(MEDAL_LABEL[m.key], m.label, m.key);
});
test('every voiced ladder medal has its clip length in the announcer', () => {
  for (const m of MEDALS) if (m.clip) assert.equal(CLIP_MS[m.clip], m.clip_ms, m.clip);
});
