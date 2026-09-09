// The published LED pages describe decisions that live in code, and those decisions move: on
// 2026-09-09 alone the shield went white to teal and the gun body's rest went dark to team. Prose
// cannot be trusted to follow. This reads the CURRENT value straight out of the source and the
// build asserts the page agrees.
//
// F40 rule: a guard that cannot see its own fault is worse than none. So a pattern that no longer
// matches is a HARD FAILURE, not a skip. If someone renames `SHIELD_COLOUR`, this breaks loudly
// instead of quietly deciding everything is fine.
import fs from 'node:fs';
import path from 'node:path';

/** Each fact: where it lives, how to read it, and what the page must therefore say. */
const FACTS = [
  {
    name: 'shield colour',
    file: 'mcp/brx_mcp/poolgauge.py',
    re: /^SHIELD_COLOUR\s*=\s*([A-Z_]+)\s*$/m,
    // the page must contain this word near "shield", and must NOT contain the other palette names
    say: v => v.toLowerCase(),
  },
  {
    name: 'armour colour',
    file: 'mcp/brx_mcp/poolgauge.py',
    re: /^ARMOUR_COLOUR\s*=\s*([A-Z_]+)\s*$/m,
    say: v => v.toLowerCase(),
  },
  {
    name: 'gun body rest',
    file: 'mcp/brx_mcp/mc/presentation.py',
    re: /^GUN_DEFAULT\s*=\s*\{\s*"in_play"\s*:\s*"([a-z]+)"/m,
    say: v => v.toLowerCase(),
  },
];

/** Read every fact. Throws if a pattern stops matching, which means the source was renamed. */
export function ledFacts(repo) {
  return FACTS.map(f => {
    const p = path.join(repo, f.file);
    if (!fs.existsSync(p)) {
      throw new Error(`led-facts: ${f.file} is gone. The LED pages assert against it; fix this file.`);
    }
    const m = fs.readFileSync(p, 'utf8').match(f.re);
    if (!m) {
      throw new Error(
        `led-facts: could not read "${f.name}" from ${f.file}. The constant was probably renamed. ` +
        `Update site/lib/led-facts.mjs, because the LED pages are asserted against it.`);
    }
    return { name: f.name, value: f.say(m[1]) };
  });
}

/** The palette, so a page naming a colour index cannot drift from the gun's own order. */
export function ledPalette(repo) {
  const src = fs.readFileSync(path.join(repo, 'mcp/brx_mcp/poolgauge.py'), 'utf8');
  const m = src.match(/^([A-Z]+(?:,\s*[A-Z]+)+)\s*=\s*range\((\d+)\)\s*$/m);
  if (!m) throw new Error('led-facts: could not read the colour palette from poolgauge.py');
  const names = m[1].split(',').map(s => s.trim().toLowerCase());
  if (names.length !== Number(m[2])) {
    throw new Error(`led-facts: palette names (${names.length}) do not match range(${m[2]})`);
  }
  return names;
}
