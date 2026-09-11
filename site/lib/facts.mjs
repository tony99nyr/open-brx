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
  const block = src.match(/^MODES\s*=\s*\[([\s\S]*?)^\]/m);
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

/** Weapon classes with counts, labelled the way Mission Control labels them. */
export function roles(repo) {
  const cat = JSON.parse(read(repo, 'mcp/brx_mcp/mc/weapons.json')).weapons;
  const tok = read(repo, 'webapp/mc/src/tokens.ts');
  const block = tok.match(/export const ROLE[\s\S]*?=\s*\{([\s\S]*?)\n\};/);
  if (!block) throw new Error('facts: could not find ROLE in webapp/mc/src/tokens.ts (renamed?)');
  const label = {};
  for (const m of block[1].matchAll(/(\w+):\s*\{\s*label:\s*'([^']+)',\s*color:\s*'(#[0-9a-fA-F]{6})'/g)) label[m[1]] = { label: m[2], color: m[3] };
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

/** The published Android build. */
export function release(repo) {
  const r = JSON.parse(read(repo, 'webapp/download/build.json'));
  for (const k of ['version', 'url', 'release']) if (!r[k]) throw new Error(`facts: build.json has no ${k}`);
  return { version: r.version, url: r.url, release: r.release, releases: 'https://github.com/tony99nyr/open-brx/releases' };
}
