// Facts the landing pages render from REPO SOURCE, never from typed prose.
//   modes   = mcp/brx_mcp/mc/state.py MODES (the list Mission Control offers)
//   roles   = mcp/brx_mcp/mc/weapons.json role counts, labelled and coloured by webapp/mc/src/tokens.ts
//   release = webapp/download/build.json (the published APK sidecar; tests pin its freshness)
//   counts  = modes.length, weapons.length, sounds.length
// F40 rule: a pattern that stops matching is a HARD FAILURE, never a silent empty list. A landing
// page that quietly rendered "0 modes" would be a published falsehood with a green build.
import fs from 'node:fs';
import path from 'node:path';

const read = (repo, rel) => {
  const p = path.join(repo, rel);
  if (!fs.existsSync(p)) throw new Error(`facts: ${rel} is gone; the landing pages render from it`);
  return fs.readFileSync(p, 'utf8');
};

/** Every game mode Mission Control offers, in the order it offers them. */
export function modes(repo) {
  const src = read(repo, 'mcp/brx_mcp/mc/state.py');
  // `MODES: list[ModeRow] = [` since the pyright pass (2026-09-12); the annotation is optional here so a
  // typed or untyped declaration both parse (the build was red on main for the typed one).
  const block = src.match(/^MODES(?:\s*:\s*[^=\n]+?)?\s*=\s*\[([\s\S]*?)^\]/m);
  if (!block) throw new Error('facts: could not find the MODES list in mcp/brx_mcp/mc/state.py (renamed?)');
  const out = [];
  // one dict per entry; each starts with {"mode": ... and carries name/abbr/desc/brief on the wire
  for (const m of block[1].matchAll(/\{"mode":\s*"([a-z_]+)",\s*"name":\s*"([^"]+)",\s*"abbr":\s*"([^"]+)",\s*"desc":\s*"([^"]+)"[\s\S]*?"brief":\s*"([^"]+)"[\s\S]*?"proven":\s*(True|False)/g)) {
    out.push({ id: m[1], name: m[2], abbr: m[3], desc: m[4], // the briefs use em dashes as asides; a comma reads where a colon did not
    brief: m[5].replace(/\s*—\s*/g, ', '), proven: m[6] === 'True' });
  }
  if (out.length < 3) throw new Error(`facts: read only ${out.length} modes out of state.py; the entry shape changed`);
  return out;
}

// Both roles() and arsenal() label a weapon the way Mission Control does, off the one ROLE const.
const roleLabels = repo => {
  const tok = read(repo, 'webapp/mc/src/tokens.ts');
  const block = tok.match(/export const ROLE[\s\S]*?=\s*\{([\s\S]*?)\n\};/);
  if (!block) throw new Error('facts: could not find ROLE in webapp/mc/src/tokens.ts (renamed?)');
  const label = {};
  for (const m of block[1].matchAll(/(\w+):\s*\{\s*label:\s*'([^']+)',\s*color:\s*'(#[0-9a-fA-F]{6})'/g)) label[m[1]] = { label: m[2], color: m[3] };
  return label;
};

/** Weapon classes with counts, labelled the way Mission Control labels them. */
export function roles(repo) {
  // VISIBLE weapons only, the same predicate the server publishes its catalogue with
  // (`WeaponCatalog.all()`, mc/compile.py: "hidden weapons excluded"). Counting every ROW instead
  // advertised 25 weapons on the home page when 15 are in the game, and gave the class pills a MELEE
  // entry for a weapon nobody can pick (every player carries it, no loadout names it) and a HEAVY
  // entry of 5 when 3 of those are cut. Fixed 2026-09-18 after Tony spotted the pills on the live
  // site; the same "count the file, not the game" bug had already been fixed once in Designer.tsx.
  const cat = JSON.parse(read(repo, 'mcp/brx_mcp/mc/weapons.json')).weapons.filter(w => !w.hidden);
  if (!cat.length) throw new Error('facts: weapons.json has no visible weapons; the landing renders from them');
  const label = roleLabels(repo);
  const counts = {};
  for (const w of cat) counts[w.role] = (counts[w.role] || 0) + 1;
  const out = Object.entries(counts).map(([role, n]) => {
    if (!label[role]) throw new Error(`facts: weapons.json role "${role}" has no label in tokens.ts ROLE`);
    return { role, n, ...label[role] };
  });
  // the order Mission Control shows them: as declared in tokens.ts
  const order = Object.keys(label);
  out.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  return { roles: out, total: cat.length };
}

// SIMPLIFIED 2026-09-18: this used to hunt for a weapon's first sentence because `desc` carried
// dated balance notes ("2026-09-17 arsenal review: ..."), which a landing page may not show
// (docs/site/FORMAT.md). That symptom is gone: weapons.json now refuses a `desc` that carries a
// date stamp, a raw timing, a section reference or a wire identifier, so every `desc` is already
// short player copy. What is left is a plain soft cap, for a future weapon whose copy runs long,
// plus the em-dash guard the site build never tolerates on a rendered page.
const shortDesc = text => {
  const flat = text.replace(/\s*—\s*/g, ', ').replace(/\s+--\s+/g, ', ').replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (flat.length <= 170) return flat;
  const cut = flat.slice(0, 170);
  const clause = Math.max(cut.lastIndexOf(','), cut.lastIndexOf('.'), cut.lastIndexOf(';'), cut.lastIndexOf(':'));
  return (clause > 60 ? cut.slice(0, clause) : cut.replace(/\s+\S*$/, '')) + '.';
};

/** Every pickable weapon (visible, non-melee), grouped and labelled the way Mission Control does. */
export function arsenal(repo) {
  const cat = JSON.parse(read(repo, 'mcp/brx_mcp/mc/weapons.json')).weapons.filter(w => !w.hidden);
  if (!cat.length) throw new Error('facts: weapons.json has no visible weapons; the landing renders from them');
  const label = roleLabels(repo);
  const order = Object.keys(label);
  const out = cat.map(w => {
    if (!label[w.role]) throw new Error(`facts: weapons.json role "${w.role}" has no label in tokens.ts ROLE`);
    for (const k of ['name', 'desc', 'htk', 'mag']) {
      if (w[k] === undefined || w[k] === null) throw new Error(`facts: ${w.weapon_id} has no ${k}`);
    }
    return {
      id: w.weapon_id, name: w.name, desc: shortDesc(w.desc), htk: w.htk, mag: w.mag,
      // driven off `lethal`, never off `htk === 0`: a weapon that reaches 0 hits through a future
      // bug must still look wrong, not deliberate.
      lethal: w.lethal !== false,
      role: w.role, pickupOnly: !!w.pickup_only, ...label[w.role],
    };
  });
  out.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  return out;
}

/** The published Android build. */
export function release(repo) {
  const r = JSON.parse(read(repo, 'webapp/download/build.json'));
  for (const k of ['version', 'url', 'release']) if (!r[k]) throw new Error(`facts: build.json has no ${k}`);
  return { version: r.version, url: r.url, release: r.release, releases: 'https://github.com/tony99nyr/open-brx/releases' };
}
