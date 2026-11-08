#!/usr/bin/env node
// Turn a phone's bench frame ring (the `{t, dir, f}` lines the app logs) into a gun-model replay fixture
// (app/test/fixtures/bench-gun/). The raw rings are unscrubbed and stay off the repo: this keeps only the frames the
// gun model reads or answers, with times relative to the first kept frame, and nothing that names a player or a gun.
//
//   node tools/bench-gun-fixture.mjs --ring <ring.json> --out <fixture.json> --source "<bench and step>"
//        [--until <ring.json>] [--mark <label>=<ring.json> ...] [--seed <ring.json>] [--init '<json>']
//
// A ring that starts mid-life (a phone restart) has no head: --seed copies the `$WEAP` rows of another ring of the same
// loadout, and --init sets the gun state the ring starts in (as GunModel fields), read off its first answers.
// --until cuts the session where that (shorter) ring of the same session ends. --mark records where a step's own ring
// ends, so a test can name the step a difference falls in. A ring is a JSON array of JSON strings (or objects), the
// same array double-encoded as a string, or `{tail: [...]}`.
import { readFileSync, writeFileSync } from 'node:fs';

/** The frames the gun model reads (phone writes) or answers (gun reports). Nothing else leaves the ring. */
export const KEEP = /^\$(BUT|ALCD|LCD|AMMO|BMAP|WEAP|SPAWN|START|CLEAR|QUERY|TMP),/;

export function readRing(path) {
  let d = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof d === 'string') d = JSON.parse(d);
  if (d && !Array.isArray(d)) d = d.tail;
  return d.map(x => (typeof x === 'string' ? JSON.parse(x) : x)).filter(x => x && typeof x.f === 'string');
}

const lastT = path => Math.max(...readRing(path).map(x => x.t));

/** The fixture: kept frames as [ms, 'tx'|'rx', frame], sorted by time, deduplicated. */
export function extract(ring, { until = Infinity, marks = {} } = {}) {
  const seen = new Set(), rows = [];
  for (const x of ring) {
    if (x.t > until || !KEEP.test(x.f) || (x.dir !== 'tx' && x.dir !== 'rx')) continue;
    const k = `${x.t}|${x.dir}|${x.f}`;
    if (seen.has(k)) continue;
    seen.add(k); rows.push(x);
  }
  rows.sort((a, b) => a.t - b.t);
  const t0 = rows.length ? rows[0].t : 0;
  return {
    frames: rows.map(x => [x.t - t0, x.dir, x.f]),
    marks: Object.fromEntries(Object.entries(marks).map(([k, t]) => [k, t - t0])),
  };
}

function main(argv) {
  const opt = { mark: [] };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i].replace(/^--/, ''), v = argv[i + 1];
    if (k === 'mark') opt.mark.push(v); else opt[k] = v;
  }
  if (!opt.ring || !opt.out) { console.error('usage: --ring <ring.json> --out <fixture.json> [--source ...] [--until <ring>] [--mark label=<ring>]'); process.exit(2); }
  const marks = {};
  for (const m of opt.mark) { const [label, p] = m.split('='); marks[label] = lastT(p); }
  const out = { source: opt.source || '', ...extract(readRing(opt.ring), { until: opt.until ? lastT(opt.until) : Infinity, marks }) };
  if (opt.seed) out.seed = [...new Set(readRing(opt.seed).filter(x => x.f.startsWith('$WEAP,')).map(x => x.f))];
  if (opt.init) out.init = JSON.parse(opt.init);
  // one frame per line keeps a fixture diff readable
  const body = out.frames.map(r => '    ' + JSON.stringify(r)).join(',\n');
  const extra = ['seed', 'init'].filter(k => out[k]).map(k => `  "${k}": ${JSON.stringify(out[k])},\n`).join('');
  writeFileSync(opt.out, `{\n  "source": ${JSON.stringify(out.source)},\n  "marks": ${JSON.stringify(out.marks)},\n${extra}  "frames": [\n${body}\n  ]\n}\n`);
  console.log(`${opt.out}: ${out.frames.length} frames, marks ${Object.keys(marks).join(' ')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
