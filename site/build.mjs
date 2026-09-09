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
  { file: 'credits.md', slug: '/credits', nav: 'Credits' },
];
// webapp/ holds two hand-committed trees the generator must never touch.
const PROTECTED = new Set(['mc', 'download']);

// The old block DSL, so a half-converted page cannot ship. Anchored to line start and to the
// names the DSL actually used, because prose legitimately contains bracketed words.
const BLOCK_MARKER = /^\[(hero|callout|steps|cards|table|data-table|spec-sheet|accordion|faq|image|diagram|code|bit-field|symptom-ladder|compare|stat-row|quote|timeline|pricing-tiers|download|under-construction)\b/m;
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
for (const a of assetFiles) write(a.out, a.buf);

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
  sounds: { title: 'Sound bank', note: 'Every sound id on the gun, from mcp/brx_mcp/data/sound_catalog.json.' },
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
  return `<div class="table-wrap"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>\n`;
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

function shell(page, content, toc) {
  const nav = PAGES.filter(p => p.nav).map(p =>
    `<a href="${p.slug}/"${p.slug === page.slug ? ' aria-current="page"' : ''}>${p.nav}</a>`).join('');
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
<header class="top"><a class="brand" href="/">Open BRX</a><nav class="topnav">${nav}</nav>
<button class="theme" type="button" aria-label="Toggle theme">Theme</button></header>
<main id="main"><article>
<h1>${esc(page.title)}</h1>
${page.lastVerified ? `<p class="meta">Last verified <time datetime="${page.lastVerified}">${page.lastVerified}</time></p>` : ''}
${toc}
${content}
</article></main>
<footer><p>Open BRX is independent and is not endorsed by Battle Company. Protocol discovery credit: LaserTagMods (JEDGE / JBOX). <a href="/credits/">Credits and sources</a> &middot; <a href="${GITHUB}">Source on GitHub</a></p></footer>
<script src="${assetHref('site.js')}"></script>
</body></html>
`;
}

// ---- build -----------------------------------------------------------------------------------
const weapons = buildWeapons(REPO);
const sounds = buildSounds(REPO);
write('data/weapons.json', JSON.stringify(weapons));
write('data/sounds.json', JSON.stringify(sounds));

const problems = [];
const built = [];
for (const p of PAGES.map(readPage)) {
  headings.length = 0;
  const content = marked.parse(p.body, { renderer, mangle: false, headerIds: false });
  const toc = headings.length > 2
    ? `<nav class="toc" aria-label="On this page"><p>On this page</p><ul>${headings.map(h => `<li><a href="#${h.id}">${h.text}</a></li>`).join('')}</ul></nav>`
    : '';
  write(p.slug === '/' ? 'index.html' : p.slug.slice(1) + '/index.html', shell(p, content, toc));
  write(p.slug === '/' ? 'index.md' : p.slug.slice(1) + '.md', p.source); // the twin IS the source
  if (/[—]/.test(p.source)) problems.push(`${p.file}: em dash`);
  // a leftover block marker from the old DSL: only at line start, and only a name the DSL used.
  // (A loose /\[word\]/ flagged legitimate prose like a CLI's "usb-query [port]".)
  if (BLOCK_MARKER.test(p.source)) problems.push(`${p.file}: leftover block marker`);
  for (const g of p.source.match(/[✅📖🔍👥🧪📐🚧]/gu) || []) problems.push(`${p.file}: provenance mark ${g}`);
  if (/^src:/m.test(p.source)) problems.push(`${p.file}: src: citation`);
  built.push(p);
}

write('404.html', shell({ slug: '/404', title: 'Page not found', body: 'That page does not exist.', lastVerified: null },
  '<p>That page does not exist. Try the <a href="/">front page</a>.</p>', ''));
// _redirects keeps the 65 URLs the 2026-09-09 cut removed pointing at the page that absorbed them.
// Cloudflare parses this natively for static assets; it is frozen history, not a maintained map.
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
  ok: problems.length === 0, problems, pages: built.length, files: [...written].sort(),
}, null, 1) + '\n');

if (problems.length) { console.error('BUILD PROBLEMS:\n' + problems.map(p => '  ' + p).join('\n')); process.exit(1); }
console.log(`built ${built.length} pages, ${written.size} files -> ${OUT} (weapons ${weapons.length}, sounds ${sounds.length})`);
