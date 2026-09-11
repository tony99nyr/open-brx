#!/usr/bin/env node
// Open BRX site generator: docs/platform/*.md + docs/manual/*.md -> webapp/ (static, Cloudflare assets).
// The whole contract with the source is docs/site/FORMAT.md. If it is not described there, it is
// not a feature. Two layouts: `doc` (the manual and the platform docs, one readable column) and
// `landing` (the root and the manual front door, marketing anatomy rendered from plain markdown).
// Usage: node build.mjs [--docs DIR] [--out DIR] [--site URL]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { marked } from 'marked';
import { buildWeapons, buildSounds } from './lib/data.mjs';
import { ledFacts, ledPalette, drainDirection } from './lib/led-facts.mjs';
import { modes as readModes, roles as readRoles, release as readRelease } from './lib/facts.mjs';
import { renderLanding } from './lib/landing.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const arg = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : null; };
const DOCS = path.resolve(arg('docs') || path.join(REPO, 'docs'));
const OUT = path.resolve(arg('out') || path.join(REPO, 'webapp'));
const SITE = arg('site') || 'https://open-brx.iamrossi.workers.dev';
const GITHUB = 'https://github.com/tony99nyr/open-brx';
// Was false while the repository was private, because every repo link 404s for a visitor and the
// site had published them anyway on all twelve pages. **The repo went public 2026-09-10**, verified
// by `gh repo view` (visibility=PUBLIC) and by an anonymous 200 on a release asset, so the links are
// live again everywhere at once. If it ever goes private again, flip this back FIRST: the build
// refuses a page that links the repo while this is false, which is what caught it last time.
const REPO_PUBLIC = true;

// One file, one page. Adding a page = adding a file and a row. (docs/site/FORMAT.md)
// `section` picks the header nav a page shows; `nav` is its label in that nav (null = not listed).
const PAGES = [
  { file: 'platform/index.md', slug: '/', section: 'root', nav: null, layout: 'landing' },
  { file: 'platform/platform.md', slug: '/platform', section: 'platform', nav: null, layout: 'landing' },
  { file: 'platform/docs.md', slug: '/docs', section: 'docs', nav: 'Overview', layout: 'doc' },
  { file: 'platform/install.md', slug: '/docs/install', section: 'docs', nav: 'Install', layout: 'doc' },
  { file: 'platform/run.md', slug: '/docs/run-a-game', section: 'docs', nav: 'Run a match', layout: 'doc' },
  { file: 'platform/modes.md', slug: '/docs/modes', section: 'docs', nav: 'Modes and setup', layout: 'doc' },
  { file: 'platform/leds.md', slug: '/docs/leds', section: 'docs', nav: 'The lights', layout: 'doc' },
  { file: 'platform/download.md', slug: '/download', section: 'docs', nav: 'Download', layout: 'doc' },
  { file: 'manual/index.md', slug: '/manual', section: 'manual', nav: null, layout: 'manual' },
  { file: 'manual/hardware.md', slug: '/manual/hardware', section: 'manual', nav: 'Hardware', layout: 'doc' },
  { file: 'manual/operate.md', slug: '/manual/operate', section: 'manual', nav: 'Operate', layout: 'doc' },
  { file: 'manual/gameplay.md', slug: '/manual/gameplay', section: 'manual', nav: 'Gameplay', layout: 'doc' },
  { file: 'manual/sound.md', slug: '/manual/sound', section: 'manual', nav: 'Sound', layout: 'doc' },
  { file: 'manual/fix.md', slug: '/manual/fix', section: 'manual', nav: 'Fix', layout: 'doc' },
  { file: 'manual/dev.md', slug: '/manual/dev', section: 'manual', nav: 'Developer', layout: 'doc' },
  { file: 'manual/credits.md', slug: '/credits', section: 'manual', nav: null, layout: 'doc' },
];
// a marketing landing's header lists its own sections (the first few `##`), then its doors
const LANDING_DOORS = { root: [['/platform/', 'Platform'], ['/manual/', 'Manual']], platform: [['/docs/', 'Docs'], ['/manual/', 'Manual']] };
const landingNav = page => {
  const secs = [...page.body.matchAll(/^## (.+)$/gm)].map(m => m[1].trim()).filter(t => !/^get it$/i.test(t)).slice(0, 4);
  return [...secs.map(t => ['#' + slugify(t), t]), ...(LANDING_DOORS[page.section] || [])];
};
// webapp/ holds hand-committed files the generator must never touch: the whole Mission Control UI
// tree, and the APK sidecar (plus any APK) inside download/. The /download PAGE shares that
// directory, so protection is per path, not per directory.
const isProtected = rel => rel === 'mc' || rel.startsWith('mc/') || rel === 'download/build.json' || rel.endsWith('.apk');

// The old block DSL, so a half-converted page cannot ship. Anchored to line start and to the
// names the DSL actually used, because prose legitimately contains bracketed words.
import { BLOCK_MARKER } from './block-names.mjs';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = s => s.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hash10 = buf => createHash('sha256').update(buf).digest('hex').slice(0, 10);

const written = new Set();
function write(rel, content) {
  if (isProtected(rel)) throw new Error(`refusing to write into protected ${rel}`);
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  written.add(rel);
}

// ---- assets: content-hashed so cached CSS can never outlive the markup ------------------------
const hashed = (dir, outDir) => fs.readdirSync(path.join(HERE, dir)).filter(f => !f.startsWith('.') && !f.endsWith('.json')).map(f => {
  const buf = fs.readFileSync(path.join(HERE, dir, f));
  const ext = path.extname(f);
  return { src: f, out: `${outDir}/${path.basename(f, ext)}.${hash10(buf)}${ext}`, buf };
});
const assetFiles = hashed('assets', 'assets');
const assetHref = name => '/' + assetFiles.find(a => a.src === name).out;
// Screenshots (generated by shots.mjs, pinned by mcp/tests/test_site_shots.py) and staged photos.
// Hashed like CSS: a republished shot must never be served from a stale cache.
const imageFiles = [...hashed('shots', 'shots'), ...hashed('photos', 'photos')];
const imageHref = href => {
  const f = imageFiles.find(i => '/' + i.out.split('/')[0] + '/' + i.src === href);
  if (!f) throw new Error(`image ${href} is referenced but not in site/shots or site/photos`);
  return '/' + f.out;
};
// width/height so the browser reserves the box and the page never jumps as images arrive
function imageSize(buf, name) {
  if (name.endsWith('.svg')) {
    const s = buf.toString('utf8');
    const vb = s.match(/viewBox="[\d.\s-]*?(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)"/);
    if (vb) return { w: Math.round(+vb[1]), h: Math.round(+vb[2]) };
    return null;
  }
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) {
    // walk the JPEG markers to the first SOF frame header
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) return null;
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
  }
  if (name.endsWith('.png')) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  return null;
}
const imageDims = href => {
  const f = imageFiles.find(i => '/' + i.out.split('/')[0] + '/' + i.src === href);
  return f ? imageSize(f.buf, f.src) : null;
};
// public/ is copied verbatim (fonts, _redirects): stable names, no hash
const publicFiles = [];
const walk = (dir, rel = '') => {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(dir, r); else publicFiles.push({ rel: r, buf: fs.readFileSync(path.join(dir, r)) });
  }
};
walk(path.join(HERE, 'public'));
// NB: assets are hashed here but WRITTEN below, after validation. See the validate-first block.

// ---- parse: an H1, an optional Last verified line, then plain CommonMark ----------------------
function readPage(p) {
  const raw = fs.readFileSync(path.join(DOCS, p.file), 'utf8');
  const lines = raw.split(/\r?\n/);
  const h1 = lines.findIndex(l => /^# /.test(l));
  if (h1 < 0) throw new Error(`${p.file}: no "# Title" line`);
  const title = lines[h1].replace(/^#\s+/, '').trim();
  const lv = (lines[h1 + 1] || '').match(/^Last verified:\s*(\d{4}-\d\d-\d\d)\s*$/);
  const body = lines.slice(h1 + 1 + (lv ? 1 : 0)).join('\n').replace(/^\s+/, '');
  // the opening paragraph, as plain text: the page's description and its door blurb. The WHOLE
  // paragraph (source lines are hard-wrapped), cut at its first sentence so a door reads as a door.
  const para = body.split(/\n\s*\n/).map(x => x.trim()).find(x => x && !x.startsWith('#') && !x.startsWith('|') && !x.startsWith('```') && !x.startsWith('!['));
  const flat = (para || '').replace(/\s*\n\s*/g, ' ').replace(/[*`\[\]]/g, '').replace(/\(([^)]*)\)/g, '').replace(/\s{2,}/g, ' ').trim();
  const sentence = flat.match(/^.*?[.!?](?=\s|$)/);
  const pick = sentence && sentence[0].length >= 40 ? sentence[0] : flat;
  // too long for a door: end on the last clause boundary before the limit, as a sentence, never a bare cut
  const cut = pick.slice(0, 160);
  const clause = Math.max(cut.lastIndexOf(','), cut.lastIndexOf(':'), cut.lastIndexOf(';'));
  const blurb = pick.length <= 160 ? pick : (clause > 60 ? cut.slice(0, clause) : cut.replace(/\s+\S*$/, '')) + '.';
  return { ...p, title, lastVerified: lv ? lv[1] : null, body, source: raw, blurb };
}

// ---- render (doc layout) ------------------------------------------------------------------------
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
  // A scrollport is focusable in Chrome, so it needs a name; the first header cell is the honest one.
  const label = token.header[0] ? String(token.header[0].text || '').replace(/[`*]/g, '').slice(0, 40) : 'Table';
  return `<div class="table-wrap${tall}" role="region" tabindex="0" aria-label="${esc(label)} table, scrollable"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>\n`;
};
renderer.code = function ({ text, lang }) {
  // the one extension: ```data\n<name>\n``` becomes a browser-rendered table (docs/site/FORMAT.md)
  if (lang === 'data') {
    const key = text.trim();
    if (key === 'download') return downloadCard();
    const d = DATA_TABLES[key];
    if (!d) return `<p class="todo">TODO: unknown data table "${esc(key)}"</p>\n`;
    return `<section class="dt" data-table="${key}">
<div class="dt-bar"><input type="search" data-search placeholder="Search ${esc(d.title.toLowerCase())}" aria-label="Search ${esc(d.title.toLowerCase())}"><span class="dt-count" data-count aria-live="polite">loading</span></div>
<div class="table-wrap"><table><thead data-head></thead><tbody data-body></tbody></table></div>
<p class="dt-note">${esc(d.note)}</p></section>\n`;
  }
  // The button lives OUTSIDE the <pre>: inside it, selecting a command by hand copied the word
  // "Copy" as the first line, on a site where select-and-copy is the main action.
  return `<div class="code"><button class="copy" type="button">Copy</button><pre><code${lang ? ` class="language-${esc(lang)}"` : ''}>${esc(text)}</code></pre></div>\n`;
};
// images in a doc page are the same hashed files the landing uses
renderer.image = function ({ href, text }) {
  const dims = imageDims(href);
  return `<img src="${esc(imageHref(href))}" alt="${esc(text)}"${dims ? ` width="${dims.w}" height="${dims.h}"` : ''} loading="lazy">`;
};

// The Android download card. Every number on it comes from webapp/download/build.json, which
// mcp/tests/test_published_build.py pins to a real, reachable release: nothing here is typed.
function downloadCard() {
  const r = JSON.parse(fs.readFileSync(path.join(REPO, 'webapp/download/build.json'), 'utf8'));
  const mb = (r.bytes / 1048576).toFixed(1);
  const day = String(r.built).slice(0, 10);
  return `<div class="dl">
<div class="dl-head"><span class="dl-name">BRX Companion for Android</span><span class="dl-ver">v${esc(r.version)}</span></div>
<a class="dl-btn" href="${esc(r.url)}" download>Download APK <span>${mb} MB</span></a>
<dl class="dl-meta"><dt>Built</dt><dd><time datetime="${esc(r.built)}">${day}</time></dd><dt>From</dt><dd><a href="https://github.com/tony99nyr/open-brx/releases/tag/${esc(r.release)}">${esc(r.release)}</a></dd><dt>SHA-256</dt><dd><code>${esc(r.sha256)}</code></dd></dl>
</div>\n`;
}

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
const BURGER = `<button class="burger" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="topnav">
<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
</button>`;

const url = slug => slug === '/' ? '/' : slug + '/';
// The site has two worlds and the header must say which one you are in: the Platform (the root,
// /docs, /download) and the BRX Manual (/manual, /credits). One segmented control, always visible.
const worldOf = page => page.section === 'manual' ? 'manual' : 'platform';
// The wordmark names the place, the way the HUD's does (`BRX/` + COMBAT HUD): OPEN-BRX/ on the
// ecosystem landing, PLATFORM/ and PLATFORM/DOCS in the platform half, BRX/ and BRX/DOCS in the
// manual. Clicking it opens the core places.
// A marketing landing shows the bare name; every doc-layout page carries the DOCS label.
const wordmarkOf = page => {
  if (page.slug === '/') return ['Open-BRX', ''];
  const sub = page.layout === 'doc' ? 'Docs' : '';   // a marketing landing shows the bare name
  return page.section === 'manual' ? ['BRX', sub] : ['Platform', sub];
};
const PLACES = [['/', 'Open BRX', 'the ecosystem'], ['/platform/', 'Platform', 'Mission Control, the HUD, brx-mcp'], ['/manual/', 'BRX manual', 'everything known about the BRX'], [GITHUB, 'GitHub', 'source, MIT']];
const brand = page => {
  const [name, sub] = wordmarkOf(page);
  return `<div class="brand">
<button class="wm" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="places" aria-label="${esc(name)}${sub ? ' ' + sub : ''}. Open site menu">${LOGO}<span class="wm-name">${esc(name)}<b>/</b></span>${sub ? `<span class="wm-sub">${esc(sub)}</span>` : ''}</button>
<ul id="places" class="places" role="menu" hidden>${PLACES.map(([href, label, hint]) => `<li role="none"><a role="menuitem" href="${esc(href)}"${href === url(page.slug) ? ' aria-current="page"' : ''}><span>${label}</span><small>${hint}</small></a></li>`).join('')}</ul>
</div>`;
};
function navFor(page) {
  if (page.layout === 'landing') return landingNav(page);
  return PAGES.filter(p => p.section === page.section && p.nav).map(p => [url(p.slug), p.nav]);
}
const SEARCH = `<form class="find" role="search" onsubmit="return false">
  <label class="vh" for="q">Search the manual</label>
  <input id="q" type="search" role="combobox" autocomplete="off" aria-autocomplete="list"
         placeholder="Search, or a command like $WEAP"
         aria-expanded="false" aria-controls="results" aria-describedby="find-hint">
  <span class="vh" id="find-live" role="status" aria-live="polite"></span>
  <span class="vh" id="find-hint">Press slash to jump here. Results appear as you type.</span>
  <div id="results" class="results" role="listbox" aria-label="Search results" hidden></div>
</form>`;

function head(page, { title, desc, image }) {
  const canonical = `${SITE}${url(page.slug)}`;
  const og = image ? `<meta property="og:image" content="${SITE}${esc(image)}"><meta name="twitter:card" content="summary_large_image">` : `<meta name="twitter:card" content="summary">`;
  const ld = page.slug === '/' ? `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'Open BRX', applicationCategory: 'GameApplication',
    operatingSystem: 'Android, Windows, macOS, Linux', description: desc, url: SITE, license: 'https://opensource.org/licenses/MIT',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, sameAs: [GITHUB],
  })}</script>` : '';
  return `<!doctype html>
<html lang="en"${page.layout === 'doc' ? '' : ' data-theme="dark" class="landing"'}><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Open BRX">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${canonical}">
${og}
<meta name="theme-color" content="#07090d">
<link rel="alternate" type="text/markdown" href="${page.slug === '/' ? '/index.md' : page.slug + '.md'}">
<link rel="icon" href="/favicon.svg">
<script>document.documentElement.classList.add('js')</script>
<link rel="preload" href="/fonts/oswald-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${assetHref('site.css')}">
${page.layout === 'doc' ? `<script>try{var t=localStorage.getItem('brx-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}</script>` : ''}
${ld}
</head>`;
}
const description = page => (page.blurb || 'Open BRX: open-source software for stock Battle Company BRX taggers, and the BRX manual.').slice(0, 180);

function shellDoc(page, content) {
  const nav = navFor(page).map(([href, label]) => {
    const here = href === url(page.slug);
    return `<a href="${href}"${here ? ' aria-current="page"' : ''}>${label}</a>`;
  }).join('');
  const title = `${page.title} | Open BRX`;
  return `${head(page, { title, desc: description(page) })}<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
${brand(page)}
${BURGER}
<nav class="topnav" id="topnav" aria-label="Pages in this section">${nav}</nav>
${SEARCH}
<button class="theme" type="button" aria-label="Switch theme">${SUN}${MOON}<span class="vh">Switch theme</span></button>
</header>
<main id="main" tabindex="-1"><article>
<h1>${esc(page.title)}</h1>
${page.lastVerified ? `<p class="meta">Last verified <time datetime="${page.lastVerified}">${page.lastVerified}</time></p>` : ''}
${content}
</article></main>
${footer()}
<script src="${assetHref('site.js')}"></script>
</body></html>
`;
}

// The landing shell: dark by design, a marketing header, no theme toggle. The manual's front door
// keeps the search box, moved into its hero where it is the point of the page.
function shellLanding(page, content, { image }) {
  const nav = navFor(page).map(([href, label]) => `<a href="${href}"${href === url(page.slug) ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  const title = page.slug === '/' ? 'Open BRX: the BRX, unlocked' : page.slug === '/platform' ? 'The Open BRX platform | Open BRX' : `${page.title} | Open BRX`;
  const cta = page.layout === 'landing' ? `<a class="btn btn-acc top-cta" href="/download/">Get the app</a>` : '';
  return `${head(page, { title, desc: description(page), image })}<body class="${page.layout}">
<a class="skip" href="#main">Skip to content</a>
<header class="top">
${brand(page)}
${BURGER}
<nav class="topnav" id="topnav" aria-label="Pages in this section">${nav}</nav>
${cta}
</header>
<main id="main" class="landing" tabindex="-1">
${content}
</main>
${footer()}
<script src="${assetHref('site.js')}"></script>
</body></html>
`;
}
const footer = () => `<footer><p>Open BRX is independent and is not endorsed by Battle Company. Protocol discovery credit: LaserTagMods (JEDGE / JBOX). <a href="/credits/">Credits and sources</a>${REPO_PUBLIC ? ` &middot; <a href="${GITHUB}">Source on GitHub</a>` : ''}</p></footer>`;

// ---- build -----------------------------------------------------------------------------------
const weapons = buildWeapons(REPO);
const sounds = buildSounds(REPO);

const problems = [];
const built = [];
const pages = PAGES.map(readPage);
// Validate the whole site before writing a single page. The build used to write everything and
// then exit 1, so a red build still left the bad page in webapp/ for the next `git commit -a`.
for (const p of pages) {
  if (/[—]/.test(p.source)) problems.push(`${p.file}: em dash`);
  const bm = p.source.match(BLOCK_MARKER);
  if (bm) problems.push(`${p.file}: leftover block marker ${bm[0]}`);
  for (const g of p.source.match(/[✅📖🔍👥🧪📐🚧]/gu) || []) problems.push(`${p.file}: provenance mark ${g}`);
  if (/^src:/m.test(p.source)) problems.push(`${p.file}: src: citation`);
  // A visitor does not care which repo file a fact came from; the footer links the repository.
  if (/^##+ Sources\b/m.test(p.source)) problems.push(`${p.file}: per-page Sources section`);
  // A landing page carries capabilities, never status. Dates and progress words are what went
  // stale twice; the only number that moves is the app version, and the build renders that.
  if (p.layout !== 'doc') {
    if (p.lastVerified) problems.push(`${p.file}: a landing page carries no "Last verified" line`);
    const date = p.source.match(/\b20\d\d-\d\d-\d\d\b|\b20\d\d\b/);
    if (date) problems.push(`${p.file}: a landing page carries no dates ("${date[0]}")`);
    const status = p.source.match(/\b(not yet|unfinished|coming soon|so far|work in progress|proven on|has never|have never|we ran|matches? on)\b/i);
    if (status) problems.push(`${p.file}: a landing page carries no status prose ("${status[0]}")`);
    const ver = p.source.match(/\bv?\d+\.\d+\.\d+\b/);
    if (ver) problems.push(`${p.file}: a landing page never types a version ("${ver[0]}"); the build renders it`);
  }
  // A page that describes an LED decision must agree with the code that makes it. Prose does not
  // follow a constant when it changes, and on 2026-09-09 two of these changed in one morning.
  if (/^platform\/leds\.md$/.test(p.file)) {
    // Read the page's own Pool/Colour table rather than guessing by proximity: a first attempt
    // matched "shield" against every colour word within 40 characters and flagged the neighbouring
    // table rows. A guard that cries wolf gets switched off.
    const row = pool => {
      const m = p.source.match(new RegExp(`^\\|\\s*${pool}\\s*\\|([^|]*)\\|`, 'im'));
      return m ? m[1].toLowerCase() : null;
    };
    const palette = ledPalette(REPO);
    // Which LED is lost first. Every colour can be right while the bar drains backwards.
    const dir = drainDirection(REPO);
    const saysLast = /led\s*3\s+is\s+the\s+last|last\s+one\s+lit|empties\s+toward\s+the\s+muzzle/i.test(p.source);
    const saysFirst = /led\s*1\s+is\s+the\s+last|led\s*3\s+goes\s+out\s+first/i.test(p.source);
    if (dir === 'last' && !saysLast) problems.push(`${p.file}: the bar empties toward LED 3 in the source, and the page does not say so`);
    if (dir === 'first' && !saysFirst) problems.push(`${p.file}: the bar empties toward LED 1 in the source, and the page does not say so`);
    if (dir === 'last' && saysFirst) problems.push(`${p.file}: the page has the drain direction backwards`);
    for (const { name, value } of ledFacts(REPO)) {
      const pool = name.startsWith('shield') ? 'Shield' : name.startsWith('armour') ? 'Armour' : null;
      if (!pool) {
        // The gun body's rest is prose, so check EVERY sentence that talks about resting, not one
        // paragraph: editing only the "**Rest.**" paragraph while another line still said the old
        // value left the page self-contradicting and the build green.
        const MODES = ['team', 'dark', 'health', 'native'];
        // Prose only. The headset's own table row legitimately reads "In play, resting | dark",
        // and the gun body's rest is never stated in a table.
        const sentences = (p.source.split('\n').filter(l => !l.trimStart().startsWith('|')).join('\n')
          .match(/[^.\n]*\brest(?:s|ing)?\b[^.\n]*/gi) || []);
        if (!sentences.length) {
          problems.push(`${p.file}: no sentence about the gun body resting, so ${name} cannot be checked`);
          continue;
        }
        const says = sentences.filter(x => new RegExp(`\\b${value}\\b`, 'i').test(x));
        if (!says.length) {
          problems.push(`${p.file}: the gun body rests on "${value}" in the source, and no sentence says so`);
        }
        for (const x of sentences) {
          for (const other of MODES.filter(v => v !== value)) {
            if (new RegExp(`\\b${other}\\b`, 'i').test(x)) {
              problems.push(`${p.file}: "${x.trim().slice(0, 60)}" names "${other}", but the source says "${value}"`);
            }
          }
        }
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
  // Landing pages state the policy in one line and link nothing; the manual's credits page proves it.
  if (p.layout === 'doc' && /\brehost|\bwe link it\b/i.test(p.source)) {
    const links = p.source.match(/https?:\/\/[^\s)"'<]+/g) || [];
    const external = links.filter(u => !u.includes('github.com/tony99nyr'));
    if (!external.length) problems.push(`${p.file}: says an official document is linked, but links none`);
  }
  // Do not publish a link a visitor cannot open. While the repo is private every one of these is
  // a 404, and the site had them on all twelve pages plus an APK download people were told to fetch.
  if (!REPO_PUBLIC && p.source.includes('github.com/tony99nyr')) {
    problems.push(`${p.file}: links the repository, which is private (set REPO_PUBLIC when it is not)`);
  }
  // the manual states what is true now, it does not narrate its own corrections
  const hist = p.source.match(/\b(an? earlier (note|draft|reading|version)|we (got|were) (this )?wrong|predates the|this page said|the mistake shipped|until then,|we (previously|used to) (said|say|thought|believed))\b/i);
  if (hist) problems.push(`${p.file}: narrates its own history ("${hist[0]}")`);
}
// every image a page references must exist under site/shots or site/photos
for (const p of pages) {
  for (const m of p.source.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
    try { imageHref(m[1]); } catch (e) { problems.push(`${p.file}: ${e.message}`); }
  }
}
let facts;
try {
  const manual = pages.filter(p => p.section === 'manual' && p.nav).map(p => ({ slug: p.slug, nav: p.nav, blurb: p.blurb }));
  // on-gun sounds only: the catalog also lists ids the app names that the gun does not carry
  facts = { modes: readModes(REPO), roles: readRoles(REPO), release: readRelease(REPO), sounds: sounds.filter(s => s.on_gun).length, manual };
} catch (e) { problems.push(e.message); }
if (problems.length) {
  // Nothing has been written yet, and that is the point: the build used to emit the assets, the
  // data files and every page and THEN exit 1, leaving a bad page and orphaned hashed assets in
  // webapp/ for the next `git commit -a`.
  console.error('BUILD PROBLEMS (nothing written):\n' + problems.map(x => '  ' + x).join('\n'));
  process.exit(1);
}
for (const a of assetFiles) write(a.out, a.buf);
for (const i of imageFiles) write(i.out, i.buf);
for (const f of publicFiles) write(f.rel, f.buf);
write('data/weapons.json', JSON.stringify(weapons));
write('data/sounds.json', JSON.stringify(sounds));

const ctx = { asset: imageHref, dims: imageDims, facts, github: GITHUB };
for (const p of pages) {
  let html;
  if (p.layout === 'doc') {
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
    html = shellDoc(p, body);
  } else {
    const { html: inner } = renderLanding(`# ${p.title}\n\n${p.body}`, ctx);
    // the manual's front door: the search box is the point of the page, so it sits in the hero
    const content = p.layout === 'manual'
      ? inner.replace(/<\/p>\n(?=<ul class="doors")/, `</p>\n<div class="hero-find">${SEARCH.replace('placeholder="Search, or a command like $WEAP"', 'placeholder="Search the manual, or $WEAP"')}</div>\n`)
      : inner;
    // the share card: a dedicated og.jpg when one is staged, else a real (non-placeholder) hero photo
    const heroImg = p.source.match(/!\[[^\]]*\]\((\/photos\/[^)\s]+)\)/);
    const og = imageFiles.some(i => i.src === 'og.jpg') ? imageHref('/photos/og.jpg')
      : heroImg && !heroImg[1].endsWith('.svg') ? imageHref(heroImg[1]) : null;
    html = shellLanding(p, content, { image: og });
  }
  write(p.slug === '/' ? 'index.html' : p.slug.slice(1) + '/index.html', html);
  write(p.slug === '/' ? 'index.md' : p.slug.slice(1) + '.md', p.source); // the twin IS the source
  built.push(p);
}

write('404.html', shellDoc({ slug: '/404', title: 'Page not found', body: 'That page does not exist.', lastVerified: null, section: 'manual', layout: 'doc', blurb: 'That page does not exist.' },
  '<p>That page does not exist. Try the <a href="/">front page</a> or <a href="/manual/">the manual</a>.</p>'));
// _redirects (in public/) keeps every URL an earlier cut removed pointing at the page that absorbed it.
// ---- search index -----------------------------------------------------------------------------
// Indexed per HEADING, not per page, so a hit lands on the exact anchor: these pages run to 800+
// lines and "it is somewhere on /manual/dev" is not an answer. Identifiers are pulled out
// separately because what people look up here is a symbol, not a phrase: $WEAP, t14, VA33, R01.
// Only doc pages: a landing's sections are a table of contents, not facts.
const IDENT = /(\$[A-Z][A-Z0-9]*|\b[A-Z]{1,2}\d{2,3}[A-Z]?\b|\bt\d{1,2}\b)/g;
const index = [];
for (const p of pages.filter(p => p.layout === 'doc')) {
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

write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${built.map(p => `<url><loc>${SITE}${url(p.slug)}</loc>${p.lastVerified ? `<lastmod>${p.lastVerified}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`);
write('llms.txt', `# Open BRX\n\n> Open-source software (MIT) that turns stock Battle Company BRX laser taggers into a hosted game system: Mission Control on a laptop, a Companion HUD on each player's phone, and brx-mcp, a command line and MCP server for the tagger. The site also carries the BRX manual: only confirmed facts are published. Source: ${GITHUB}\n\nEvery page is also plain Markdown at the same URL with a .md suffix. The whole site in one file: ${SITE}/llms-full.txt\n\nProtocol discovery credit: LaserTagMods (JEDGE / JBOX). Open BRX is independent and not endorsed by Battle Company.\n\n## Pages\n\n${built.map(p => `- [${p.title}](${SITE}${p.slug === '/' ? '/index' : p.slug}.md)`).join('\n')}\n`);
write('llms-full.txt', built.map(p => `<!-- ${SITE}${url(p.slug)} -->\n\n${p.source}`).join('\n\n---\n\n'));

// sweep files this build no longer owns, so a removed page cannot linger in webapp/
const sweep = dir => {
  for (const e of fs.readdirSync(path.join(OUT, dir || '.'), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (isProtected(rel) || rel.startsWith('.')) continue;
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
  // twin URL -> the source file (relative to docs/) it must equal byte-for-byte
  twins: Object.fromEntries(built.map(p => [p.slug === '/' ? '/index.md' : p.slug + '.md', p.file])),
  layouts: Object.fromEntries(built.map(p => [url(p.slug), p.layout])),
  files: [...written].sort(),
}, null, 1) + '\n');

console.log(`built ${built.length} pages, ${written.size} files -> ${OUT} (weapons ${weapons.length}, sounds ${sounds.length}, modes ${facts.modes.length}, shots ${imageFiles.length})`);
