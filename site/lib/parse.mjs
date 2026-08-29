// Parse docs/manual/*.md (the block format defined in docs/manual/README.md + docs/site brief §5)
// into a page model. Pure: no I/O beyond reading the files handed to it.
import fs from 'node:fs';
import path from 'node:path';

const PROV = { '✅': 'bench', '📖': 'official', '🔍': 'apk', '👥': 'community', '🧪': 'software', '📐': 'spec', '🚧': 'wip' };
export const PROV_LABEL = {
  bench: 'Verified on our bench', official: 'Official Battle Company docs', apk: 'Decoded from the Callsign app',
  community: 'Community-reported', software: 'Built + software-tested', spec: 'Specified only', wip: 'Under construction',
};
export const PROV_EMOJI = Object.fromEntries(Object.entries(PROV).map(([e, k]) => [k, e]));

const BLOCK_RE = /^\[([a-z][a-z-]*)(?::([a-z|]+))?(?:\s+([A-Za-z0-9-]+))?\]\s*(.*)$/;
const PAGE_RE = /^### Page:\s*(.+?)\s+\(`(\/[^`]*)`\)\s*(?:[—–·|].*)?$/;
const SECTION_RE = /^#\s+(\d\d)\s*·\s*(.+?)\s+\((?:section )?slugs?:\s*([^)]+)\)/;
const SRC_RE = /^(?:[✅📖🔍👥🧪📐🚧\s·]*)\s*`?src:\s*(.*?)`?\s*$/u;
const IGNORE_H2 = /^## (Images for this section|Interactive ideas|Sources used|Research backlog|Honest gaps|Still cracking)/;

export function badgesIn(text) {
  const out = [];
  for (const [e, k] of Object.entries(PROV)) if (text.includes(e) && !out.includes(k)) out.push(k);
  return out;
}

function parseImagesTable(lines) {
  const map = {};
  for (const l of lines) {
    if (!l.startsWith('|')) continue;
    const c = l.trim().replace(/^\||\|$/g, '').split('|').map(s => s.trim());
    if (c.length < 6 || !/^[A-Z]+-\d+/.test(c[0])) continue;
    const id = c[0].match(/^[A-Z]+-\d+[a-z]?/)[0];
    const kind = /REAL PHOTO/i.test(c[3]) ? 'photo' : /SVG/i.test(c[3]) ? 'svg' : 'generate';
    map[id] = { id, where: c[1], what: c[2], kind, source: c[4], prompt: c[5] };
  }
  return map;
}

/** Parse one manual file into { section, pages[], images{} }. */
export function parseManualFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split(/\r?\n/);
  const section = { file: path.basename(file), num: null, title: null, slug: null, lastVerified: null, audience: null, goal: null, legend: null };
  const pages = [];
  let images = {};

  // header
  for (const l of lines.slice(0, 12)) {
    const m = l.match(SECTION_RE);
    if (m) { section.num = m[1]; section.title = m[2].trim(); section.slug = m[3].split(',')[0].replace(/`/g, '').trim(); }
    const lv = l.match(/\*\*Last verified:\*\*\s*(\d{4}-\d\d-\d\d)/); if (lv) section.lastVerified = lv[1];
    const au = l.match(/\*\*Audience:\*\*\s*(.+?)\s*·\s*\*\*Goal[^*]*\*\*\s*(.+)$/); if (au) { section.audience = au[1]; section.goal = au[2]; }
    const lg = l.match(/\*\*(?:Provenance|Confidence|Status) legend:\*\*\s*(.+)$/); if (lg) section.legend = lg[1];
  }

  // locate ## Pages … up to the next top-level ## that we ignore
  let i = lines.findIndex(l => /^## Pages/.test(l));
  if (i < 0) i = 0;
  let cur = null, block = null;
  const flush = () => { if (block) { finishBlock(block); cur.blocks.push(block); block = null; } };
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (/^## /.test(l) && !/^## Pages/.test(l)) {
      flush();
      if (/^## Images for this section/.test(l)) {
        const j = lines.slice(i + 1).findIndex(x => /^## /.test(x));
        images = parseImagesTable(lines.slice(i + 1, j < 0 ? undefined : i + 1 + j));
      }
      cur = null; // everything after Pages that isn't a page is ignored
      if (IGNORE_H2.test(l)) continue;
      continue;
    }
    const pm = l.match(PAGE_RE);
    if (pm) { flush(); cur = { title: pm[1].trim(), slug: pm[2].trim().replace(/\/$/, '') || '/', subtitle: null, blocks: [], section }; pages.push(cur); continue; }
    if (!cur) continue;
    if (/^---\s*$/.test(l)) { flush(); continue; }
    if (cur.subtitle === null && /^_.+_\s*$/.test(l.trim()) && cur.blocks.length === 0 && !block) { cur.subtitle = l.trim().replace(/^_|_$/g, ''); continue; }
    const bm = l.match(BLOCK_RE);
    if (bm) {
      flush();
      block = { type: bm[1], mod: bm[2] || null, arg: bm[3] || null, head: bm[4] || '', body: [], src: [], badges: [], line: i + 1 };
      continue;
    }
    if (block) block.body.push(l);
    else if (l.trim()) { // prose outside a block → treat as an implicit "prose" block
      block = { type: 'prose', mod: null, arg: null, head: '', body: [l], src: [], badges: [], line: i + 1 };
    }
  }
  flush();
  return { section, pages, images };
}

const SPLIT_SRC = /(?:[;,·]\s*)?(?:[✅📖🔍👥🧪📐🚧]\s*)*`?src:\s*/u;
function pushSrc(b, s) { for (const part of String(s).split(SPLIT_SRC)) { const c = part.replace(/`/g, '').replace(/[\s;,·]+$/, '').trim(); if (c) b.src.push(c); } }
function finishBlock(b) {
  // trailing blank lines
  while (b.body.length && !b.body[b.body.length - 1].trim()) b.body.pop();
  while (b.body.length && !b.body[0].trim()) b.body.shift();
  // pull src lines (anywhere at the tail; also a src: inside head)
  const keep = [];
  const TAIL_SRC = /^(.*?)(?:\s*[·—-]\s*|\s+)?(?:[✅📖🔍👥🧪📐🚧]\s*)*`?src:\s*(.+?)`?\s*$/u;
  for (const l of b.body) {
    const m = l.match(SRC_RE);
    if (m && !l.trim().startsWith('|') && !l.trim().startsWith('-') && !/^\d+\./.test(l.trim())) { pushSrc(b, m[1]); continue; }
    // a src: at the END of a list item / sentence ("… ✅ `src: path`") → strip it into the sources
    const t = l.match(TAIL_SRC);
    if (t && !l.trim().startsWith('|') && /src:/.test(l) && t[1].trim()) { pushSrc(b, t[2]); keep.push(t[1].replace(/\s+$/, '')); continue; }
    keep.push(l);
  }
  b.body = keep;
  const hs = b.head.match(/\s+(?:[✅📖🔍👥🧪📐🚧]\s*)*`?src:\s*(.*?)`?\s*$/u);
  if (hs) { pushSrc(b, hs[1]); b.head = b.head.slice(0, hs.index).trim(); }
  b.head = b.head.replace(/\(copy-to-clipboard\)/, '').trim();
  b.badges = badgesIn(b.head + '\n' + b.body.join('\n'));
  // a bold lead-in on the head line is the block title
  const t = b.head.match(/^\*\*(.+?)\*\*\s*(.*)$/) || b.head.match(/^"(.+?)"\s*(.*)$/) || b.head.match(/^“(.+?)”\s*(.*)$/);
  if (t) { b.title = t[1].trim(); b.head = t[2].trim().replace(/^[—–:-]\s*/, ''); }
  // A [spec-sheet] head names the thing being specified ("Tagger battery 📖 👥:"). Without this it
  // rendered as a grey lead paragraph, leaving the spec-sheet page with no headings and no TOC.
  if (!b.title && b.type === 'spec-sheet' && b.head.trim()) {
    const [name, ...rest] = b.head.split(/\s+[—–]\s+|:\s+/);
    b.title = name.replace(/\s*:\s*$/, '').trim();
    b.head = rest.join(': ').trim();
  }
}

/** Load every manual file in a directory (sorted). */
export function loadManual(dir) {
  const files = fs.readdirSync(dir).filter(f => /^\d\d-.*\.md$/.test(f)).sort();
  const sections = [], pages = [], images = {};
  for (const f of files) {
    const r = parseManualFile(path.join(dir, f));
    sections.push(r.section); pages.push(...r.pages); Object.assign(images, r.images);
  }
  return { sections, pages, images };
}
