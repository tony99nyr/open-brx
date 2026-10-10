// EFF-6: TAKING FIRE is one element in the centre slot, not screen structure. An under-fire edge swaps that element in
// place; it must not rebuild the whole `#hud` (that restarted every CSS animation and replaced the node under a finger).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hud } from '../src/hud/hud.js';
import { renderDom, loadStates } from './hud-html-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const live = loadStates(path.join(here, 'fixtures/hud-html-states.json')).live;

function run(steps) {
  const real = Hud.prototype._structure; let builds = 0;
  Hud.prototype._structure = function (...a) { builds++; return real.apply(this, a); };
  try {
    const out = renderDom(live, steps.map(underFire => ({ state: { underFire } })));
    return { out, builds };
  } finally { Hud.prototype._structure = real; }
}

test('EFF-6: an under-fire edge on, then off, rebuilds the screen zero times', () => {
  const base = run([false, false]).builds;       // the first render builds once; a repeat render builds no more
  const edges = run([false, true, false]).builds;
  assert.equal(edges, base, `rebuilds across the edges: ${edges - base}`);
});

test('EFF-6: TAKING FIRE still appears on the edge and clears after it', () => {
  const { out } = run([false, true, false]);
  assert.ok(!out[0].hud.includes('takingfire') && out[0].hud.includes('class="reticle"'), 'reticle before');
  assert.ok(out[1].hud.includes('<div class="takingfire"><span class="r"></span><span class="t">TAKING FIRE</span></div>') && !out[1].hud.includes('class="reticle"'), 'TAKING FIRE up');
  assert.ok(!out[2].hud.includes('takingfire') && out[2].hud.includes('class="reticle"'), 'reticle back');
});
