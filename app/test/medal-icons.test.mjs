// The recap medal icons (src/hud/medalicons.js, style B, the roundel): every MEDALS and AWARDS key draws its own glyph
// day and night with an accessible name, an unknown key draws the fallback, the multi-kill ladder escalates, night stays
// red and amber on its plate, and a recap chip as MC writes it ("DOUBLE KILL ×2") parses to its key and count.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MEDALS, AWARDS } from '../src/transport/contract.gen.js';
import { medalIcon, medalChip, hasMedalIcon, MEDAL_PALETTE } from '../src/hud/medalicons.js';

const KEYS = [...new Set([...MEDALS.map(m => m.key), ...AWARDS.map(a => a.key), 'beat_down'])];
const ROWS = [...MEDALS, ...AWARDS];

test('every MEDALS and AWARDS key has its own icon, day and night, with an accessible name and no fonts', () => {
  const fallback = medalIcon('no_such_key', { size: 24 }).replace(/aria-label="[^"]*"|<title>[^<]*<\/title>|data-medal="[^"]*"/g, '');
  for (const k of KEYS) {
    assert.ok(hasMedalIcon(k), k);
    for (const night of [false, true]) {
      const svg = medalIcon(k, { night, size: 24, label: 'NAME' });
      assert.match(svg, /^<svg [^>]*viewBox="0 0 32 32"[^>]*width="24"[^>]*role="img" aria-label="NAME"/, k);
      assert.doesNotMatch(svg, /<text|<image|href=|font/, `${k}: no fonts or external assets`);
      assert.notEqual(svg.replace(/aria-label="[^"]*"|<title>[^<]*<\/title>|data-medal="[^"]*"/g, ''), fallback, `${k} is not the fallback`);
    }
  }
});
test('an unknown key draws the fallback, not nothing', () => {
  assert.equal(hasMedalIcon('no_such_key'), false);
  assert.match(medalIcon('no_such_key'), /<path/);
});
test('the multi-kill ladder draws one ray per kill', () => {
  for (const m of MEDALS.filter(x => x.kind === 'multi')) {
    const rays = (medalIcon(m.key).match(/stroke-width="2.6"/g) || []).length;
    assert.equal(rays, m.count, m.key);
  }
});
test('night uses only the night palette, and every meaningful colour is 4.5:1 or better on its plate', () => {
  const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const P of Object.values(MEDAL_PALETTE)) for (const c of [P.fg, P.accent]) assert.ok(ratio(c, P.bg) >= 4.5, `${c} on ${P.bg}: ${ratio(c, P.bg).toFixed(2)}`);
  const allowed = new Set(Object.values(MEDAL_PALETTE.night));
  for (const k of KEYS) for (const hex of medalIcon(k, { night: true }).match(/#[0-9a-f]{6}/gi) || []) {
    assert.ok(allowed.has(hex), `${k}: ${hex}`);
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    assert.ok(r >= g && r >= b, `${k}: ${hex} is not red or amber`);
  }
});
test('a recap chip as MC writes it parses to its key and count', () => {
  assert.deepEqual(medalChip('DOUBLE KILL ×2', ROWS), { key: 'double_kill', label: 'DOUBLE KILL', n: 2 });
  assert.deepEqual(medalChip('BEST K/D · NON-MVP', ROWS), { key: 'best_kd', label: 'BEST K/D · NON-MVP', n: 1 });
  assert.equal(medalChip('BEST K/D', ROWS).key, 'best_kd');
  assert.equal(medalChip('BEAT DOWN', ROWS).key, 'melee_kill');
  assert.equal(medalChip('SOMETHING NEW', ROWS).key, null);
});
test('IRON MAN is the picked iron heart (I2b), not the placeholder initial, day and night', () => {
  const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const night of [false, true]) {
    const P = MEDAL_PALETTE[night ? 'night' : 'day'], svg = medalIcon('iron_man', { night });
    assert.doesNotMatch(svg, /M16 9\.2v13\.6M12\.6 9\.2h6\.8/, 'still the placeholder "I"');
    assert.match(svg, /data-glyph="iron-heart"/, 'the iron heart glyph');
    // the heart is the colour on the plate, and the bevel is the plate cut into the heart: the same pair, >= 4.5:1
    assert.match(svg, new RegExp(`fill="${P.fg}"`)); assert.match(svg, new RegExp(`stroke="${P.bg}"`));
    assert.ok(ratio(P.fg, P.bg) >= 4.5, `${P.fg} on ${P.bg}`);
  }
});
