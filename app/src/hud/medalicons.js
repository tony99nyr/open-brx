// Medal and award icons for the RECAP surfaces only (Tony 2026-09-25: "just the recap UIs use the icons"): the phone's
// end-of-match AWARDS tab and PLAYERS medal column, and MC's recap. The in-game lanes (the kill card, FEED, OBJECTIVE)
// never draw them. Style B, the roundel, is Tony's pick: an outlined ring around a solid glyph, one colour plus an accent.
//
// These are ORIGINAL designs. They copy no Halo medal: no shape, layout or colour scheme of Bungie's art.
//
// The module has no imports and touches no DOM, so the phone imports it as is. MC takes a generated copy,
// webapp/mc/src/api/medalicons.gen.ts (`node app/scripts/gen-medalicons.mjs`); webapp/mc/test/medalicons-gen.test.ts
// fails when that copy is stale.
//
// Keys: contract.gen MEDALS (melee_kill is the BEAT DOWN medal; `beat_down` is an alias) and types.AWARDS.

// One colour plus one accent per skin. Night is red and amber only (no green, no white) on the night plate.
export const MEDAL_PALETTE = Object.freeze({
  day: Object.freeze({ fg: '#5fd6ff', accent: '#ffc53d', bg: '#05080d' }),
  night: Object.freeze({ fg: '#d65454', accent: '#d9952e', bg: '#120505' }),
});

// The multi-kill ladder: the tier is the number of rays and of accent ticks round the ring (one per kill).
const TIER = { double_kill: 2, triple_kill: 3, killtacular: 4, killtrocity: 5, killamanjaro: 6, killtastrophe: 7, killionaire: 8 };
const ALIAS = { beat_down: 'melee_kill' };

const r2 = n => Math.round(n * 100) / 100;
// A glyph is drawn in a 32-unit box centred on (16,16), mostly inside 7..25. `c` is its colour, `a` the accent,
// `gap` the plate colour (for a cut line that must separate two shapes).
const HEART = 'M16 25.4C9.4 20.7 7 17.2 7 13.4a4.5 4.5 0 0 1 9-1.8 4.5 4.5 0 0 1 9 1.8c0 3.8-2.4 7.3-9 12z';
const BOLT = 'M18.2 6.5 10.8 17.4h4.9l-2.1 8.1 7.6-11.2h-4.9z';
const G = {
  multi: (c, a, gap, n) => {
    let s = '';
    for (let i = 0; i < n; i++) {
      const t = -Math.PI / 2 + (i * 2 * Math.PI) / n, x = Math.cos(t), y = Math.sin(t);
      s += `<line x1="${r2(16 + x * 5.2)}" y1="${r2(16 + y * 5.2)}" x2="${r2(16 + x * 9.6)}" y2="${r2(16 + y * 9.6)}" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`;
    }
    // the core: a diamond; from five kills up it takes the accent, from seven it gets an outer ring of dots
    s += `<path d="M16 12.2 19.8 16 16 19.8 12.2 16z" fill="${n >= 5 ? a : c}"/>`;
    if (n >= 7) for (let i = 0; i < n; i++) {
      const t = -Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / n;
      s += `<circle cx="${r2(16 + Math.cos(t) * 9.2)}" cy="${r2(16 + Math.sin(t) * 9.2)}" r="1.15" fill="${a}"/>`;
    }
    return s;
  },
  first_blood: c => `<path d="M16 6.5C13.2 10.6 10 14.6 10 18.6a6 6 0 0 0 12 0c0-4-3.2-8-6-12.1z" fill="${c}"/>`,
  killing_spree: c => `<path d="${BOLT}" fill="${c}"/>`,
  unstoppable: (c, a) => `<g transform="translate(-4.2 0)"><path d="${BOLT}" fill="${c}"/></g><g transform="translate(4.2 0)"><path d="${BOLT}" fill="${a}"/></g>`,
  // Tony's pick 2026-09-25 (gallery B6): a clenched fist from the front (four knuckles, the thumb folded across, the
  // wrist below), drawn smaller, with an amber impact burst at its knuckles
  melee_kill: (c, a, gap) => `<g data-glyph="fist-impact"><g transform="translate(-2.2 2.4) scale(.84) translate(3 3)">`
    + `<rect x="8.6" y="12" width="14.8" height="9.4" rx="2.4" fill="${c}"/>`
    + [8.4, 12.2, 16, 19.8].map(x => `<rect x="${x}" y="7" width="3.8" height="8.6" rx="1.9" fill="${c}" stroke="${gap}" stroke-width="1.1" paint-order="stroke"/>`).join('')
    + `<rect x="8" y="15.4" width="11.4" height="3.8" rx="1.9" fill="${c}" stroke="${gap}" stroke-width="1.5" paint-order="stroke"/><path d="M11 21.4h10v4.2H11z" fill="${c}"/></g>`
    + `<path d="M21.6 8.6l2.4-2.6M23.2 11.4l3.2-.8M19.6 7.2l.4-3.2" stroke="${a}" stroke-width="1.8" stroke-linecap="round"/></g>`,
  killjoy: (c, a, gap) => `<path d="${BOLT}" fill="${c}"/><line x1="8.4" y1="23.8" x2="23.6" y2="8.2" stroke="${gap}" stroke-width="4.4"/>`
    + `<line x1="8.4" y1="23.8" x2="23.6" y2="8.2" stroke="${a}" stroke-width="2.2" stroke-linecap="round"/>`,
  mvp: (c, a) => `<path d="M8.6 20.6 7.8 10.6l4.6 4.2L16 8.4l3.6 6.4 4.6-4.2-.8 10z" fill="${c}"/><rect x="8.6" y="21.8" width="14.8" height="2.6" rx="1" fill="${c}"/><circle cx="16" cy="16.6" r="1.6" fill="${a}"/>`,
  most_kills: (c, a) => `<circle cx="16" cy="16" r="6.4" fill="none" stroke="${c}" stroke-width="2.2"/>`
    + `<path d="M16 6.6v4.6M16 20.8v4.6M6.6 16h4.6M20.8 16h4.6" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/><circle cx="16" cy="16" r="1.8" fill="${a}"/>`,
  best_kd: (c, a) => `<path d="M8 22.5 13 17l3.6 3L23 12.6" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.6 10.6h6.2v6.2z" fill="${a}"/>`,
  sharpshooter: (c, a) => `<circle cx="16" cy="16" r="8.2" fill="none" stroke="${c}" stroke-width="2"/><circle cx="16" cy="16" r="4.4" fill="none" stroke="${c}" stroke-width="2"/><circle cx="16" cy="16" r="1.7" fill="${a}"/>`,
  survivor: (c, a) => `<path d="M10 7.4h12v2.2l-4.6 6.4 4.6 6.4v2.2H10v-2.2l4.6-6.4L10 9.6z" fill="${c}"/><path d="M13.6 22.2 16 19l2.4 3.2z" fill="${a}"/>`,
  // Tony's pick 2026-09-25 (gallery I2b): a heart plate, an inner bevel cut in the plate colour, an amber highlight
  iron_man: (c, a, gap) => `<g data-glyph="iron-heart"><path d="${HEART}" fill="${c}"/>`
    + `<path d="${HEART}" transform="translate(16 16.6) scale(.68) translate(-16 -16.6)" fill="none" stroke="${gap}" stroke-width="1.9"/>`
    + `<path d="M8.9 13.2c0-2 1.4-3.4 3.2-3.4" fill="none" stroke="${a}" stroke-width="1.6" stroke-linecap="round"/></g>`,
  multikill: (c, a) => [[10.2, c], [15.2, c], [20.2, a]].map(([y, col]) => `<path d="M9 ${y + 3.6} 16 ${y - 1.4}l7 5" fill="none" stroke="${col}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`).join(''),
  wingman: (c, a) => `<path d="M14.6 12.4 6.6 10.2l1.8 3-2.6 1.4 3.6 1.4-1.8 2.6 7 .8z" fill="${c}"/><path d="M17.4 12.4l8-2.2-1.8 3 2.6 1.4-3.6 1.4 1.8 2.6-7 .8z" fill="${c}"/><circle cx="16" cy="15.6" r="1.9" fill="${a}"/>`,
  objective_hero: (c, a) => `<rect x="9.6" y="6.8" width="2" height="18.4" rx=".8" fill="${c}"/><path d="M11.6 7.8H23l-2.8 3.8 2.8 3.8H11.6z" fill="${c}"/><circle cx="10.6" cy="25.4" r="1.6" fill="${a}"/>`,
};
const UNKNOWN = (c, a) => `<path d="M16 8.4 23.6 16 16 23.6 8.4 16z" fill="none" stroke="${c}" stroke-width="2.4" stroke-linejoin="round"/><circle cx="16" cy="16" r="2" fill="${a}"/>`;

/** The keys this module draws its own glyph for (every MEDALS and AWARDS key, plus the alias). */
export const MEDAL_ICON_KEYS = Object.freeze([...Object.keys(TIER), ...Object.keys(G).filter(k => k !== 'multi'), ...Object.keys(ALIAS)]);
/** True when `key` has its own glyph (false means medalIcon draws the fallback diamond). */
export const hasMedalIcon = key => { const k = ALIAS[key] || key; return !!TIER[k] || (k !== 'multi' && Object.prototype.hasOwnProperty.call(G, k)); };

const escAttr = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

/** The roundel around any glyph `(c, a, gap) => markup`. medalIcon uses it; the gallery draws its candidates with it. */
export function roundelIcon(glyphFn, { key = '', tier = 0, night = false, size = 32, label = '' } = {}) {
  const P = MEDAL_PALETTE[night ? 'night' : 'day'];
  let ticks = '';
  for (let i = 0; i < tier; i++) {
    const t = -Math.PI / 2 + ((i - (tier - 1) / 2) * 0.34);
    ticks += `<line x1="${r2(16 + Math.cos(t) * 12.9)}" y1="${r2(16 + Math.sin(t) * 12.9)}" x2="${r2(16 + Math.cos(t) * 15.4)}" y2="${r2(16 + Math.sin(t) * 15.4)}" stroke="${P.accent}" stroke-width="1.7" stroke-linecap="round"/>`;
  }
  const name = escAttr(label || String(key || '').replace(/_/g, ' ') || 'medal');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}" role="img" aria-label="${name}" class="mi" data-medal="${String(key).replace(/[^a-z0-9_]/gi, '')}">`
    + `<title>${name}</title><circle cx="16" cy="16" r="12.6" fill="${P.fg}" fill-opacity=".12" stroke="${P.fg}" stroke-width="2.4"/>${ticks}`
    + `<g transform="translate(16 16) scale(.74) translate(-16 -16)">${glyphFn(P.fg, P.accent, P.bg)}</g></svg>`;
}

/** The SVG string for a medal or award `key`. An unknown key draws the fallback diamond.
 *  opts: night (bool), size (px, default 32), label (the accessible name; default the key in words). */
export function medalIcon(key, { night = false, size = 32, label = '' } = {}) {
  const k = ALIAS[key] || key, n = TIER[k] || 0;
  const g = n ? (c, a, gap) => G.multi(c, a, gap, n) : (hasMedalIcon(k) ? G[k] : UNKNOWN);
  return roundelIcon(g, { key: k, tier: n, night, size, label });
}

/** A recap medal chip as MC writes it ("DOUBLE KILL ×2", "MVP", "BEST K/D · NON-MVP", or a bare key) to
 *  { key, label, n }. `rows` is contract MEDALS and AWARDS ({key, label}); an unknown chip keeps its text and key null. */
export function medalChip(text, rows) {
  const s = String(text == null ? '' : text).trim();
  const m = /^(.*?)\s*×\s*(\d+)$/.exec(s), base = (m ? m[1] : s).trim(), n = m ? +m[2] : 1;
  const hit = rows.find(r => r.key === base || r.label === base) || rows.find(r => String(r.label).split(' · ')[0] === base);
  return { key: hit ? hit.key : null, label: hit ? hit.label : base, n };
}
