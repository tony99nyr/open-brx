// The medal icon proposal (src/hud/medalicons.js): every MEDALS and AWARDS key draws its own glyph in every style and
// skin, an unknown key draws the fallback, the multi-kill ladder escalates, and night stays red and amber on its plate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MEDALS, AWARDS } from '../src/transport/contract.gen.js';
import { medalIcon, hasMedalIcon, MEDAL_ICON_VARIANTS, MEDAL_PALETTE } from '../src/hud/medalicons.js';

const KEYS = [...new Set([...MEDALS.map(m => m.key), ...AWARDS.map(a => a.key), 'beat_down'])];

test('every MEDALS and AWARDS key has its own icon in every variant, day and night', () => {
  for (const k of KEYS) {
    assert.ok(hasMedalIcon(k), k);
    for (const variant of MEDAL_ICON_VARIANTS) for (const night of [false, true]) {
      const svg = medalIcon(k, { variant, night, size: 24 });
      assert.match(svg, /^<svg [^>]*viewBox="0 0 32 32"[^>]*width="24"/, `${k} ${variant}`);
      assert.doesNotMatch(svg, /<text|<image|href=|font/, `${k} ${variant}: no fonts or external assets`);
      assert.notEqual(svg, medalIcon('no_such_key', { variant, night, size: 24 }).replace('no_such_key', k), `${k} ${variant} is not the fallback`);
    }
  }
});
test('an unknown key draws the fallback, not nothing', () => {
  assert.equal(hasMedalIcon('no_such_key'), false);
  assert.match(medalIcon('no_such_key'), /<path/);
});
test('the multi-kill ladder draws one ray per kill', () => {
  for (const m of MEDALS.filter(x => x.kind === 'multi')) {
    const rays = (medalIcon(m.key, { variant: 'roundel' }).match(/stroke-width="2.6"/g) || []).length;
    assert.equal(rays, m.count, m.key);
  }
});
test('night uses only the night palette, and every meaningful colour is 4.5:1 or better on its plate', () => {
  const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const P of Object.values(MEDAL_PALETTE)) for (const c of [P.fg, P.accent]) assert.ok(ratio(c, P.bg) >= 4.5, `${c} on ${P.bg}: ${ratio(c, P.bg).toFixed(2)}`);
  const N = MEDAL_PALETTE.night, allowed = new Set(Object.values(N));
  for (const k of KEYS) for (const variant of MEDAL_ICON_VARIANTS) {
    for (const hex of medalIcon(k, { variant, night: true }).match(/#[0-9a-f]{6}/gi) || []) assert.ok(allowed.has(hex), `${k} ${variant}: ${hex}`);
  }
});
