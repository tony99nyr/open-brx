// Medal and award icons (Tony 2026-09-25: "lean just on the icon and drop the verbosity"). PROPOSAL ONLY: nothing in
// the HUD or MC imports this yet; Tony picks a style from the gallery (app/tools/medal-gallery.mjs) first.
//
// These are ORIGINAL designs. They copy no Halo medal: no shape, layout or colour scheme of Bungie's art.
//
// One glyph per key (the concept), drawn inside one of three frames (the style). Every variant uses the same glyph,
// so Tony picks a style, not a mapping. The module has no imports and touches no DOM, so the phone imports it as is,
// and MC (webapp/mc) can take a generated copy the way it takes contract.gen.ts (it imports nothing from app/ today).
//
// Keys: contract.gen MEDALS (melee_kill is the BEAT DOWN medal; `beat_down` is an alias) and types.AWARDS.

export const MEDAL_ICON_VARIANTS = Object.freeze(['shield', 'roundel', 'tag']);
export const MEDAL_ICON_NOTES = Object.freeze({
  shield: 'A · Shield: a solid shield with the glyph cut out of it. The heaviest mass, the easiest to see at arm\'s length.',
  roundel: 'B · Roundel: an outlined ring around a solid glyph, with accent tick marks for the multi-kill tier.',
  tag: 'C · Tag: a flat tinted badge with the glyph on it and a row of tier pips underneath.',
});
// One colour plus one accent per skin. Night is red and amber only (no green, no white) on the night plate.
// `ink` is the colour of a knockout (the glyph cut out of a solid frame); `bg` is the plate the icon sits on.
export const MEDAL_PALETTE = Object.freeze({
  day: Object.freeze({ fg: '#5fd6ff', accent: '#ffc53d', ink: '#05080d', bg: '#05080d' }),
  night: Object.freeze({ fg: '#d65454', accent: '#d9952e', ink: '#120505', bg: '#120505' }),
});

// The multi-kill ladder: the tier is the number of rays (and, in B and C, ticks or pips). count = kills in the chain.
const TIER = { double_kill: 2, triple_kill: 3, killtacular: 4, killtrocity: 5, killamanjaro: 6, killtastrophe: 7, killionaire: 8 };
const ALIAS = { beat_down: 'melee_kill' };

const r2 = n => Math.round(n * 100) / 100;
// A glyph is drawn in a 32-unit box centred on (16,16), mostly inside 7..25. `c` is its colour, `a` the accent,
// `gap` the colour behind it (for a cut line that must separate two shapes).
const BOLT = 'M18.2 6.5 10.8 17.4h4.9l-2.1 8.1 7.6-11.2h-4.9z';
const G = {
  multi: (c, a, gap, n) => {
    let s = '';
    for (let i = 0; i < n; i++) {
      const t = -Math.PI / 2 + (i * 2 * Math.PI) / n, x = Math.cos(t), y = Math.sin(t);
      s += `<line x1="${r2(16 + x * 5.2)}" y1="${r2(16 + y * 5.2)}" x2="${r2(16 + x * 9.6)}" y2="${r2(16 + y * 9.6)}" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`;
    }
    // the core: a diamond; from five kills up it takes the accent, from seven it gets a second, outer ring of dots
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
  melee_kill: c => `<rect x="10" y="13" width="12.5" height="11" rx="2.4" fill="${c}"/>`
    + [11.6, 14.6, 17.6, 20.6].map(x => `<circle cx="${x + 0.3}" cy="12.4" r="1.9" fill="${c}"/>`).join('')
    + `<path d="M7.4 14.5 10 16.2M7 18.5h3M7.4 22.4 10 20.8" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>`,
  killjoy: (c, a, gap) => `<path d="${BOLT}" fill="${c}"/><line x1="8.4" y1="23.8" x2="23.6" y2="8.2" stroke="${gap}" stroke-width="4.4"/>`
    + `<line x1="8.4" y1="23.8" x2="23.6" y2="8.2" stroke="${a}" stroke-width="2.2" stroke-linecap="round"/>`,
  mvp: (c, a) => `<path d="M8.6 20.6 7.8 10.6l4.6 4.2L16 8.4l3.6 6.4 4.6-4.2-.8 10z" fill="${c}"/><rect x="8.6" y="21.8" width="14.8" height="2.6" rx="1" fill="${c}"/><circle cx="16" cy="16.6" r="1.6" fill="${a}"/>`,
  most_kills: (c, a) => `<circle cx="16" cy="16" r="6.4" fill="none" stroke="${c}" stroke-width="2.2"/>`
    + `<path d="M16 6.6v4.6M16 20.8v4.6M6.6 16h4.6M20.8 16h4.6" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/><circle cx="16" cy="16" r="1.8" fill="${a}"/>`,
  best_kd: (c, a) => `<path d="M8 22.5 13 17l3.6 3L23 12.6" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.6 10.6h6.2v6.2z" fill="${a}"/>`,
  sharpshooter: (c, a) => `<circle cx="16" cy="16" r="8.2" fill="none" stroke="${c}" stroke-width="2"/><circle cx="16" cy="16" r="4.4" fill="none" stroke="${c}" stroke-width="2"/><circle cx="16" cy="16" r="1.7" fill="${a}"/>`,
  survivor: (c, a) => `<path d="M10 7.4h12v2.2l-4.6 6.4 4.6 6.4v2.2H10v-2.2l4.6-6.4L10 9.6z" fill="${c}"/><path d="M13.6 22.2 16 19l2.4 3.2z" fill="${a}"/>`,
  iron_man: (c, a) => `<path d="M7.4 10.4h17c0 3.2-2.4 4.8-5 5.2v3.4l3 3.6H10.6l3-3.6v-3.4c-3-.4-6.2-2-6.2-5.2z" fill="${c}"/><rect x="9.6" y="23.2" width="12.8" height="1.9" rx=".8" fill="${a}"/>`,
  multikill: (c, a) => [[10.2, c], [15.2, c], [20.2, a]].map(([y, col]) => `<path d="M9 ${y + 3.6} 16 ${y - 1.4}l7 5" fill="none" stroke="${col}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`).join(''),
  wingman: (c, a) => `<path d="M14.6 12.4 6.6 10.2l1.8 3-2.6 1.4 3.6 1.4-1.8 2.6 7 .8z" fill="${c}"/><path d="M17.4 12.4l8-2.2-1.8 3 2.6 1.4-3.6 1.4 1.8 2.6-7 .8z" fill="${c}"/><circle cx="16" cy="15.6" r="1.9" fill="${a}"/>`,
  objective_hero: (c, a) => `<rect x="9.6" y="6.8" width="2" height="18.4" rx=".8" fill="${c}"/><path d="M11.6 7.8H23l-2.8 3.8 2.8 3.8H11.6z" fill="${c}"/><circle cx="10.6" cy="25.4" r="1.6" fill="${a}"/>`,
  _unknown: (c, a) => `<path d="M16 8.4 23.6 16 16 23.6 8.4 16z" fill="none" stroke="${c}" stroke-width="2.4" stroke-linejoin="round"/><circle cx="16" cy="16" r="2" fill="${a}"/>`,
};

/** The keys this module draws (every MEDALS and AWARDS key, plus the alias). */
export const MEDAL_ICON_KEYS = Object.freeze([...Object.keys(TIER), ...Object.keys(G).filter(k => k !== 'multi' && k !== '_unknown'), ...Object.keys(ALIAS)]);

const glyph = (key, c, a, gap) => TIER[key] ? G.multi(c, a, gap, TIER[key]) : (G[key] || G._unknown)(c, a, gap);
const place = (inner, s, cy = 16) => `<g transform="translate(16 ${cy}) scale(${s}) translate(-16 -16)">${inner}</g>`;

const FRAME = {
  // A: a solid shield; the glyph is cut out of it in the plate colour. The multi tier also adds accent rims.
  shield: (key, P) => {
    const n = TIER[key] || 0;
    const body = 'M16 2.2 27.6 6v9.2c0 7.2-5 12.2-11.6 14.6C9.4 27.4 4.4 22.4 4.4 15.2V6z';
    return `<path d="${body}" fill="${P.fg}"/>`
      + (n >= 5 ? `<path d="${body}" fill="none" stroke="${P.accent}" stroke-width="1.4"/>` : '')
      + place(glyph(key, P.ink, P.ink, P.fg), 0.7, 15.4);
  },
  // B: an outlined ring; the glyph in the colour. A multi-kill puts one accent tick per kill round the ring.
  roundel: (key, P) => {
    const n = TIER[key] || 0;
    let ticks = '';
    for (let i = 0; i < n; i++) {
      const t = -Math.PI / 2 + ((i - (n - 1) / 2) * 0.34);
      ticks += `<line x1="${r2(16 + Math.cos(t) * 12.9)}" y1="${r2(16 + Math.sin(t) * 12.9)}" x2="${r2(16 + Math.cos(t) * 15.4)}" y2="${r2(16 + Math.sin(t) * 15.4)}" stroke="${P.accent}" stroke-width="1.7" stroke-linecap="round"/>`;
    }
    return `<circle cx="16" cy="16" r="12.6" fill="${P.fg}" fill-opacity=".12" stroke="${P.fg}" stroke-width="2.4"/>` + ticks
      + place(glyph(key, P.fg, P.accent, P.bg), 0.74);
  },
  // C: a flat, tinted badge with square corners cut; a multi-kill shows one pip per kill below it.
  tag: (key, P) => {
    const n = TIER[key] || 0;
    const h = n ? 24.4 : 28, y0 = n ? 1.8 : 2;
    const body = `M8 ${y0}h16l5 5v${h - 10}l-5 5H8l-5-5V${y0 + 5}z`;
    let pips = '';
    const gapx = 3.4, x0 = 16 - ((n - 1) * gapx) / 2;
    for (let i = 0; i < n; i++) pips += `<rect x="${r2(x0 + i * gapx - 1.2)}" y="28.2" width="2.4" height="2.8" rx=".5" fill="${P.accent}"/>`;
    return `<path d="${body}" fill="${P.fg}" fill-opacity=".16" stroke="${P.fg}" stroke-width="1.8" stroke-linejoin="round"/>`
      + place(glyph(key, P.fg, P.accent, P.bg), n ? 0.72 : 0.8, y0 + h / 2) + pips;
  },
};

/** The SVG string for a medal or award `key`. An unknown key draws the fallback diamond.
 *  opts: variant ('shield' | 'roundel' | 'tag', default 'shield'), night (bool), size (px, default 32),
 *  label (the accessible name; default the key in words). */
export function medalIcon(key, { variant = 'shield', night = false, size = 32, label } = {}) {
  const k = ALIAS[key] || key;
  const P = MEDAL_PALETTE[night ? 'night' : 'day'];
  const frame = FRAME[variant] || FRAME.shield;
  const name = String(label || String(key || '').replace(/_/g, ' ') || 'medal').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}" role="img" aria-label="${name}" class="mi" data-medal="${String(k).replace(/[^a-z0-9_]/gi, '')}">${frame(k, P)}</svg>`;
}

/** True when `key` has its own glyph (false means medalIcon draws the fallback). */
export const hasMedalIcon = key => !!(TIER[ALIAS[key] || key] || (G[ALIAS[key] || key] && !['multi', '_unknown'].includes(ALIAS[key] || key)));
