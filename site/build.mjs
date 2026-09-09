#!/usr/bin/env node
// Open BRX site generator: docs/manual/*.md -> webapp/ (static, Cloudflare assets).
// The whole contract with the manual is docs/site/FORMAT.md. If it is not described there,
// it is not a feature. Usage: node build.mjs [--manual DIR] [--out DIR] [--site URL]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { marked } from 'marked';
import { buildWeapons, buildSounds } from './lib/data.mjs';
import { ledFacts, ledPalette } from './lib/led-facts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const arg = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : null; };
const MANUAL = path.resolve(arg('manual') || path.join(REPO, 'docs/manual'));
const OUT = path.resolve(arg('out') || path.join(REPO, 'webapp'));
const SITE = arg('site') || 'https://open-brx.iamrossi.workers.dev';
const GITHUB = 'https://github.com/tony99nyr/open-brx';

// One file, one page. Adding a page = adding a file and a row. (docs/site/FORMAT.md)
const PAGES = [
  { file: 'index.md', slug: '/', nav: null },
  { file: 'hardware.md', slug: '/manual/hardware', nav: 'Hardware' },
  { file: 'operate.md', slug: '/manual/operate', nav: 'Operate' },
  { file: 'gameplay.md', slug: '/manual/gameplay', nav: 'Gameplay' },
  { file: 'sound.md', slug: '/manual/sound', nav: 'Sound' },
  { file: 'fix.md', slug: '/manual/fix', nav: 'Fix' },
  { file: 'dev.md', slug: '/manual/dev', nav: 'Developer' },
  { file: 'platform.md', slug: '/platform', nav: 'Platform' },
  { file: 'platform-leds.md', slug: '/platform/leds', nav: null },
  { file: 'platform-modes.md', slug: '/platform/modes', nav: null },
  { file: 'platform-run.md', slug: '/platform/run-a-game', nav: null },
  { file: 'credits.md', slug: '/credits', nav: 'Credits' },
];
// webapp/ holds two hand-committed trees the generator must never touch.
const PROTECTED = new Set(['mc', 'download']);

// The old block DSL, so a half-converted page cannot ship. Anchored to line start and to the
// names the DSL actually used, because prose legitimately contains bracketed words.
import { BLOCK_MARKER } from './block-names.mjs';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = s => s.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const written = new Set();
function write(rel, content) {
  if (PROTECTED.has(rel.split('/')[0])) throw new Error(`refusing to write into protected ${rel}`);
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  written.add(rel);
}

// ---- assets: content-hashed so cached CSS can never outlive the markup ------------------------
const assetFiles = fs.readdirSync(path.join(HERE, 'assets')).map(f => {
  const buf = fs.readFileSync(path.join(HERE, 'assets', f));
  const ext = path.extname(f);
  return { src: f, out: `assets/${path.basename(f, ext)}.${createHash('sha256').update(buf).digest('hex').slice(0, 10)}${ext}`, buf };
});
const assetHref = name => '/' + assetFiles.find(a => a.src === name).out;
// NB: assets are hashed here but WRITTEN below, after validation. See the validate-first block.

// ---- parse: an H1, an optional Last verified line, then plain CommonMark ----------------------
function readPage(p) {
  const raw = fs.readFileSync(path.join(MANUAL, p.file), 'utf8');
  const lines = raw.split(/\r?\n/);
  const h1 = lines.findIndex(l => /^# /.test(l));
  if (h1 < 0) throw new Error(`${p.file}: no "# Title" line`);
  const title = lines[h1].replace(/^#\s+/, '').trim();
  const lv = (lines[h1 + 1] || '').match(/^Last verified:\s*(\d{4}-\d\d-\d\d)\s*$/);
  const body = lines.slice(h1 + 1 + (lv ? 1 : 0)).join('\n').replace(/^\s+/, '');
  return { ...p, title, lastVerified: lv ? lv[1] : null, body, source: raw };
}

// ---- render ----------------------------------------------------------------------------------
const DATA_TABLES = {
  weapons: { title: 'Weapons', note: 'Every weapon on the wire, from mcp/brx_mcp/mc/weapons.json.' },
  sounds: { title: 'Sound bank', note: 'Every sound id on the gun. A meaning in italics is machine transcription that nobody has confirmed by ear yet, so it can be wrong.' },
};

const renderer = new marked.Renderer();
const headings = [];
renderer.heading = function ({ tokens, depth }) {
  const text = this.parser.parseInline(tokens);
  const id = slugify(text);
  if (depth === 2) headings.push({ id, text });
  return `<h${depth} id="${id}">${text}</h${depth}>\n`;
};
renderer.table = function (token) {
  const head = `<tr>${token.header.map((c, i) => `<th${token.align[i] ? ` style="text-align:${token.align[i]}"` : ''}>${this.parser.parseInline(c.tokens)}</th>`).join('')}</tr>`;
  const rows = token.rows.map(r => `<tr>${r.map((c, i) => `<td${token.align[i] ? ` style="text-align:${token.align[i]}"` : ''}>${this.parser.parseInline(c.tokens)}</td>`).join('')}</tr>`).join('\n');
  // Only a genuinely tall table gets a capped, scrolling wrapper: capping every wrapper trapped
  // 14 short tables on a phone, where a wheel over a 2-row table moved the page not at all.
  const tall = token.rows.length > 15 ? ' tall' : '';
  return `<div class="table-wrap${tall}"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>\n`;
};
renderer.code = function ({ text, lang }) {
  // the one extension: ```data\n<name>\n``` becomes a browser-rendered table (docs/site/FORMAT.md)
  if (lang === 'data') {
    const key = text.trim();
    const d = DATA_TABLES[key];
    if (!d) return `<p class="todo">TODO: unknown data table "${esc(key)}"</p>\n`;
    return `<section class="dt" data-table="${key}">
<div class="dt-bar"><input type="search" data-search placeholder="Search ${esc(d.title.toLowerCase())}" aria-label="Search ${esc(d.title.toLowerCase())}"><span class="dt-count" data-count aria-live="polite">loading</span></div>
<div class="table-wrap"><table><thead data-head></thead><tbody data-body></tbody></table></div>
<p class="dt-note">${esc(d.note)}</p></section>\n`;
  }
  return `<pre><button class="copy" type="button">Copy</button><code${lang ? ` class="language-${esc(lang)}"` : ''}>${esc(text)}</code></pre>\n`;
};

// A diagnostic ladder is the most useful thing on this site and the plainest in markdown: the
// author writes `**Question?** -> yes -> do this`. Turn those pivots into visible branch marks so a
// ladder can be scanned instead of read. Source stays plain markdown; nothing new to learn.
// Skipped inside <pre>, where an arrow is data.
function markBranches(html) {
  return html.split(/(<pre[\s\S]*?<\/pre>)/).map(part => part.startsWith('<pre') ? part
    : part
        .replace(/\s*(?:→|-&gt;)\s*(yes|no)\s*(?:→|-&gt;)\s*/gi,
          (_, w) => `<b class="br br-${w.toLowerCase()}">${w.toLowerCase()}</b>`)
        // an unconditional rung ("**Still nothing?** -> it is the mainboard") has no yes/no. Mark
        // the pivot quietly so it reads as deliberate beside the chips, and leave menu paths
        // ("File -> Export") alone by only matching an arrow just after a bold lead-in.
        .replace(/(<\/strong>(?:\s*\([^)]{0,90}\))?)\s*(?:→|-&gt;)\s*/g,
          (_, lead) => `${lead}<span class="br-then" aria-hidden="true">→</span> `)
  ).join('');
}

// The mark: a sight reticle whose left side opens into a bracket. Same shape as the favicon.
const LOGO = `<svg class="logo" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 4H4v16h4M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 5v8m-4-4h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
// Two icons, one button: CSS shows whichever one names the action, so the control says what it does.
const SUN = `<svg class="i-sun" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 1.5v3M12 19.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1.5 12h3M19.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const MOON = `<svg class="i-moon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;

// Sub-pages of a section, so a reader inside /platform can reach its siblings without going up.
const SUBNAV = {
  '/platform': [
    ['/platform', 'Overview'],
    ['/platform/leds', 'What the lights mean'],
    ['/platform/modes', 'Modes and setup'],
    ['/platform/run-a-game', 'Running a match'],
  ],
};
const sectionOf = slug => Object.keys(SUBNAV).find(k => slug === k || slug.startsWith(k + '/'));

function shell(page, content) {
  const nav = PAGES.filter(p => p.nav).map(p => {
    const here = p.slug === page.slug || sectionOf(page.slug) === p.slug;
    return `<a href="${p.slug}/"${here ? ' aria-current="page"' : ''}>${p.nav}</a>`;
  }).join('');
  // Siblings go at the END of the article, not above the title. "Where else can I go in this
  // section" is a question a reader has when they have FINISHED, and putting it on top made a
  // second nav bar that competed with the top one and with the contents box.
  const sec = sectionOf(page.slug);
  const siblings = sec ? SUBNAV[sec].filter(([u]) => u !== page.slug) : [];
  const more = siblings.length
    ? `<nav class="more" aria-label="More in this section"><p>More in ${SUBNAV[sec][0][1] === 'Overview' ? 'the platform section' : 'this section'}</p><ul>${
        siblings.map(([u, t]) => `<li><a href="${u}/">${t}</a></li>`).join('')}</ul></nav>`
    : '';
  const title = page.slug === '/' ? 'Open BRX: the BRX manual' : `${page.title} | Open BRX`;
  const desc = page.body.split('\n').find(l => l.trim() && !l.startsWith('#') && !l.startsWith('|'))
    ?.replace(/[*`\[\]]/g, '').replace(/\(([^)]*)\)/g, '').slice(0, 180) || 'The BRX manual.';
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc.trim())}">
<link rel="canonical" href="${SITE}${page.slug === '/' ? '/' : page.slug + '/'}">
<link rel="alternate" type="text/markdown" href="${page.slug === '/' ? '/index.md' : page.slug + '.md'}">
<link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="${assetHref('site.css')}">
</head><body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
<a class="brand" href="/">${LOGO}<span>Open BRX</span></a>
<nav class="topnav" aria-label="Sections">${nav}</nav>
<form class="find" role="search" onsubmit="return false">
  <label class="vh" for="q">Search the manual</label>
  <input id="q" type="search" autocomplete="off" placeholder="Search, or a command like $WEAP"
         aria-expanded="false" aria-controls="results" aria-describedby="find-hint">
  <span class="vh" id="find-hint">Press slash to jump here. Results appear as you type.</span>
  <div id="results" class="results" role="listbox" aria-label="Search results" hidden></div>
</form>
<button class="theme" type="button" aria-label="Switch theme">${SUN}${MOON}<span class="vh">Switch theme</span></button>
</header>
<main id="main"><article>
<h1>${esc(page.title)}</h1>
${page.lastVerified ? `<p class="meta">Last verified <time datetime="${page.lastVerified}">${page.lastVerified}</time></p>` : ''}
${content}
${more}
</article></main>
<footer><p>Open BRX is independent and is not endorsed by Battle Company. Protocol discovery credit: LaserTagMods (JEDGE / JBOX). <a href="/credits/">Credits and sources</a> &middot; <a href="${GITHUB}">Source on GitHub</a></p></footer>
<script src="${assetHref('site.js')}"></script>
</body></html>
`;
}

// ---- build -----------------------------------------------------------------------------------
const weapons = buildWeapons(REPO);
const sounds = buildSounds(REPO);

const problems = [];
const built = [];
const pages = PAGES.map(readPage);
// Validate the whole manual before writing a single page. The build used to write everything and
// then exit 1, so a red build still left the bad page in webapp/ for the next `git commit -a`.
for (const p of pages) {
  if (/[—]/.test(p.source)) problems.push(`${p.file}: em dash`);
  const bm = p.source.match(BLOCK_MARKER);
  if (bm) problems.push(`${p.file}: leftover block marker ${bm[0]}`);
  for (const g of p.source.match(/[✅📖🔍👥🧪📐🚧]/gu) || []) problems.push(`${p.file}: provenance mark ${g}`);
  if (/^src:/m.test(p.source)) problems.push(`${p.file}: src: citation`);
  // A visitor does not care which repo file a fact came from; the footer links the repository.
  if (/^##+ Sources\s*$/m.test(p.source)) problems.push(`${p.file}: per-page Sources section`);
  // A page that describes an LED decision must agree with the code that makes it. Prose does not
  // follow a constant when it changes, and on 2026-09-09 two of these changed in one morning.
  if (/^platform-leds\.md$/.test(p.file)) {
    // Read the page's own Pool/Colour table rather than guessing by proximity: a first attempt
    // matched "shield" against every colour word within 40 characters and flagged the neighbouring
    // table rows. A guard that cries wolf gets switched off.
    const row = pool => {
      const m = p.source.match(new RegExp(`^\\|\\s*${pool}\\s*\\|([^|]*)\\|`, 'im'));
      return m ? m[1].toLowerCase() : null;
    };
    const palette = ledPalette(REPO);
    for (const { name, value } of ledFacts(REPO)) {
      const pool = name.startsWith('shield') ? 'Shield' : name.startsWith('armour') ? 'Armour' : null;
      if (!pool) { // gun body rest: a prose fact, so just require the word
        if (!p.source.toLowerCase().includes(value)) problems.push(`${p.file}: ${name} is "${value}" in the source, and the page never says it`);
        continue;
      }
      const cell = row(pool);
      if (cell === null) { problems.push(`${p.file}: no "| ${pool} |" row to check ${name} against`); continue; }
      if (!cell.includes(value)) problems.push(`${p.file}: the ${pool} row says "${cell.trim()}" but the source says ${value}`);
      for (const c of palette.filter(c => c !== value && new RegExp(`\\b${c}\\b`).test(cell))) {
        problems.push(`${p.file}: the ${pool} row still names "${c}"; the source says ${value}`);
      }
    }
  }
  // If a page says an official document is linked, it must actually contain a link. The manual
  // claimed "Official PDFs are linked and never rehosted" while publishing exactly one external
  // link, to our own GitHub.
  // Anchored on "rehost" and "we link it", NOT on the bare word "linked": in this manual "linked"
  // almost always means a headset linked to a gun, and matching that flagged four innocent pages.
  if (/\brehost|\bwe link it\b/i.test(p.source)) {
    const links = p.source.match(/https?:\/\/[^\s)"'<]+/g) || [];
    const external = links.filter(u => !u.includes('github.com/tony99nyr'));
    if (!external.length) problems.push(`${p.file}: says an official document is linked, but links none`);
  }
  // the manual states what is true now, it does not narrate its own corrections
  const hist = p.source.match(/\b(an? earlier (note|draft|reading|version)|we (got|were) (this )?wrong|predates the|this page said|the mistake shipped|until then,|we (previously|used to) (said|say|thought|believed))\b/i);
  if (hist) problems.push(`${p.file}: narrates its own history ("${hist[0]}")`);
}
if (problems.length) {
  // Nothing has been written yet, and that is the point: the build used to emit the assets, the
  // data files and every page and THEN exit 1, leaving a bad page and orphaned hashed assets in
  // webapp/ for the next `git commit -a`.
  console.error('BUILD PROBLEMS (nothing written):\n' + problems.map(x => '  ' + x).join('\n'));
  process.exit(1);
}
for (const a of assetFiles) write(a.out, a.buf);
write('data/weapons.json', JSON.stringify(weapons));
write('data/sounds.json', JSON.stringify(sounds));
for (const p of pages) {
  headings.length = 0;
  const content = markBranches(marked.parse(p.body, { renderer, mangle: false, headerIds: false }));
  const toc = headings.length > 2
    ? `<nav class="toc" aria-label="On this page"><p>On this page</p><ul>${headings.map(h => `<li><a href="#${h.id}">${h.text}</a></li>`).join('')}</ul></nav>`
    : '';
  // Say what the page is BEFORE offering to navigate it: the opening paragraph becomes a lead, and
  // the contents box follows it rather than standing between the title and the first sentence.
  const lead = content.match(/^\s*<p>[\s\S]*?<\/p>/);
  const body = lead
    ? `<p class="lead">${lead[0].replace(/^\s*<p>/, '').replace(/<\/p>$/, '')}</p>${toc}${content.slice(lead[0].length)}`
    : toc + content;
  write(p.slug === '/' ? 'index.html' : p.slug.slice(1) + '/index.html', shell(p, body));
  write(p.slug === '/' ? 'index.md' : p.slug.slice(1) + '.md', p.source); // the twin IS the source
  built.push(p);
}

write('404.html', shell({ slug: '/404', title: 'Page not found', body: 'That page does not exist.', lastVerified: null },
  '<p>That page does not exist. Try the <a href="/">front page</a>.</p>', ''));
// _redirects keeps the 65 URLs the 2026-09-09 cut removed pointing at the page that absorbed them.
// Cloudflare parses this natively for static assets; it is frozen history, not a maintained map.
// ---- search index -----------------------------------------------------------------------------
// Indexed per HEADING, not per page, so a hit lands on the exact anchor: these pages run to 800+
// lines and "it is somewhere on /manual/dev" is not an answer. Identifiers are pulled out
// separately because what people look up here is a symbol, not a phrase: $WEAP, t14, VA33, R01.
const IDENT = /(\$[A-Z][A-Z0-9]*|\b[A-Z]{1,2}\d{2,3}[A-Z]?\b|\bt\d{1,2}\b)/g;
const index = [];
for (const p of pages) {
  const lines = p.body.split('\n');
  let head = null, anchor = '', buf = [];
  const flush = () => {
    if (!head && !buf.length) return;
    const text = buf.join(' ').replace(/[|`*>#\-]+/g, ' ').replace(/\s+/g, ' ').trim();
    const ids = [...new Set((buf.join(' ').match(IDENT) || []))].join(' ');
    if (head || text) {
      index.push({
        u: p.slug + (p.slug === '/' ? '' : '/') + (anchor ? '#' + anchor : ''),
        p: p.title, h: head || p.title,
        // Identifiers are the primary key on this site and are already deduped, so they are NOT
        // capped: truncating at 400 chars dropped t14 out of the $WEAP section that defines it.
        x: ids,
        // One field, original case, uncapped. The client lowercases once on load for matching and
        // slices around the hit for display, so a result shows the sentence you searched for
        // rather than whatever the section happens to open with.
        b: text,
      });
    }
    buf = [];
  };
  for (const l of lines) {
    const m = l.match(/^(#{2,3})\s+(.+?)\s*$/);
    if (m) { flush(); head = m[2].replace(/[`*]/g, ''); anchor = slugify(head); }
    else buf.push(l);
  }
  flush();
}
write('data/search.json', JSON.stringify(index));

write('_redirects', fs.readFileSync(path.join(HERE, 'public/_redirects')));
write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${built.map(p => `<url><loc>${SITE}${p.slug === '/' ? '/' : p.slug + '/'}</loc>${p.lastVerified ? `<lastmod>${p.lastVerified}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`);
write('llms.txt', `# Open BRX: the BRX manual\n\n> A manual for the Battle Company BRX laser tagger and headset, and the open-source software that runs games on stock BRX guns. Only confirmed facts are published. Source: ${GITHUB}\n\nEvery page is also plain Markdown at the same URL with a .md suffix. The whole manual in one file: ${SITE}/llms-full.txt\n\nProtocol discovery credit: LaserTagMods (JEDGE / JBOX). Open BRX is independent and not endorsed by Battle Company.\n\n## Pages\n\n${built.map(p => `- [${p.title}](${SITE}${p.slug === '/' ? '/index' : p.slug}.md)`).join('\n')}\n`);
write('llms-full.txt', built.map(p => `<!-- ${SITE}${p.slug === '/' ? '/' : p.slug + '/'} -->\n\n${p.source}`).join('\n\n---\n\n'));

// sweep files this build no longer owns, so a removed page cannot linger in webapp/
const sweep = dir => {
  for (const e of fs.readdirSync(path.join(OUT, dir || '.'), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (PROTECTED.has(rel.split('/')[0]) || rel.startsWith('.')) continue;
    if (e.isDirectory()) { sweep(rel); if (!fs.readdirSync(path.join(OUT, rel)).length) fs.rmdirSync(path.join(OUT, rel)); }
    else if (!written.has(rel) && rel !== 'favicon.svg') fs.unlinkSync(path.join(OUT, rel));
  }
};
sweep('');

fs.writeFileSync(path.join(OUT, '.site-manifest.json'), JSON.stringify({
  // no `problems` key: the build exits before writing anything when there are any, so a manifest
  // that exists is by definition a clean one. Recording an always-empty array invited a test to
  // assert it and feel guarded.
  ok: true, pages: built.length,
  // twin URL -> the manual file it must equal byte-for-byte, so the gate can compare the real bytes
  twins: Object.fromEntries(built.map(p => [p.slug === '/' ? '/index.md' : p.slug + '.md', p.file])),
  files: [...written].sort(),
}, null, 1) + '\n');

console.log(`built ${built.length} pages, ${written.size} files -> ${OUT} (weapons ${weapons.length}, sounds ${sounds.length})`);
