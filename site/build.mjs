#!/usr/bin/env node
// Open BRX site generator: docs/manual/*.md → webapp/ (static, Cloudflare assets).
// Usage: node build.mjs [--manual DIR] [--out DIR] [--site URL]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManual } from './lib/parse.mjs';
import { renderShell, pageBody, tocFor, markdownTwin, renderBlock, badge, md } from './lib/render.mjs';
import { buildWeapons, buildSounds } from './lib/data.mjs';
import { sourceStamp, sourceFiles } from './lib/sources.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1]] : []).filter(Boolean));
const MANUAL = path.resolve(args.manual || path.join(REPO, 'docs/manual'));
const OUT = path.resolve(args.out || path.join(REPO, 'webapp'));
const SITE = args.site || 'https://open-brx.iamrossi.workers.dev';
const PROTECTED = new Set(['mc']); // never written or deleted by this build
const NOW = new Date().toISOString();

const written = new Set();
function write(rel, content) {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  written.add(rel);
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugPath = slug => slug === '/' ? 'index.html' : slug.replace(/^\//, '') + '/index.html';
const twinPath = slug => slug === '/' ? 'index.md' : slug.replace(/^\//, '') + '.md';

// ---- load ---------------------------------------------------------------------------------
const manual = loadManual(MANUAL);
const sections = manual.sections.filter(s => s.slug && s.slug !== '/');
const pages = manual.pages;
const slugs = new Set(pages.map(p => p.slug));
for (const s of sections) slugs.add(s.slug);
// images available in docs/manual/img/<ID>.<ext>
const imgDir = path.join(MANUAL, 'img');
const imageFiles = {};
if (fs.existsSync(imgDir)) for (const f of fs.readdirSync(imgDir)) { const m = f.match(/^([A-Z]+-\d+[a-z]?)\.(png|jpe?g|webp|svg|avif)$/i); if (m) imageFiles[m[1]] = f; }
const norm = s => String(s).toLowerCase().replace(/[`*"“”]/g, '').replace(/\s+/g, ' ').trim();
const titles = new Map(); const slugTitles = new Map();
for (const p of pages) { titles.set(norm(p.title), p.slug); slugTitles.set(p.slug, p.title.replace(/[`*]/g, '')); }
for (const s of sections) { if (!titles.has(norm(s.title))) titles.set(norm(s.title), s.slug); if (!slugTitles.has(s.slug)) slugTitles.set(s.slug, s.title); }
const ctx = { site: SITE, slugs, images: manual.images, imageFiles, titles, slugTitles };

// ---- nav / sidebar ------------------------------------------------------------------------
const manualSections = sections.filter(s => s.slug.startsWith('/manual'));
function sidebarFor(page) {
  const secs = page.slug.startsWith('/platform') ? sections.filter(s => s.slug.startsWith('/platform')) : manualSections;
  return secs.map(s => {
    const sp = pages.filter(p => p.section === s && p.slug !== s.slug);
    const open = page.section === s;
    return `<details class="side-sec"${open ? ' open' : ''}><summary><span class="num">${s.num}</span> ${esc(s.title)}</summary><ul>` +
      (s.slug.startsWith('/platform') ? '' : `<li><a href="${s.slug}/"${page.slug === s.slug ? ' aria-current="page"' : ''}>Overview</a></li>`) +
      sp.map(p => `<li><a href="${p.slug}/"${p.slug === page.slug ? ' aria-current="page"' : ''}>${esc(p.title.replace(/[`*]/g, ''))}</a></li>`).join('') + `</ul></details>`;
  }).join('');
}
function crumbsFor(page) {
  const c = [{ title: 'Home', url: '/' }];
  if (page.slug.startsWith('/manual')) c.push({ title: 'Manual', url: '/manual/' });
  if (page.slug.startsWith('/platform') && page.slug !== '/platform') c.push({ title: 'Platform', url: '/platform/' });
  if (page.section?.slug && page.section.slug !== page.slug && page.slug !== '/manual' && !page.section.slug.startsWith('/platform') && page.section.slug !== '/') c.push({ title: page.section.title, url: page.section.slug + '/' });
  c.push({ title: page.title.replace(/[`*]/g, ''), url: page.slug + '/' });
  return c;
}
const plain = s => String(s).replace(/[`*]/g, '').replace(/\s*[✅📖🔍👥🧪📐🚧]*\s*src:.*$/u, '').replace(/[✅📖🔍👥🧪📐🚧]/gu, '').trim();
function jsonldFor(page) {
  const url = SITE + (page.slug === '/' ? '/' : page.slug + '/');
  const graph = [{ '@type': 'TechArticle', headline: page.title.replace(/[`*]/g, ''), description: page.subtitle || '', url, dateModified: page.section.lastVerified || undefined, author: { '@type': 'Organization', name: 'Open BRX' }, isPartOf: { '@type': 'WebSite', name: 'Open BRX — The BRX Manual', url: SITE + '/' } },
  { '@type': 'BreadcrumbList', itemListElement: crumbsFor(page).map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.title, item: SITE + c.url })) }];
  const faq = page.blocks.filter(b => b.type === 'faq' || b.type === 'accordion').flatMap(b => b.body.filter(l => /^\s*[-*]\s+/.test(l)).map(l => l.replace(/^\s*[-*]\s+/, '')));
  if (faq.length) graph.push({ '@type': 'FAQPage', mainEntity: faq.map(q => { const m = q.match(/^\*\*(.+?)\*\*\s*[—–:-]?\s*([\s\S]*)$/) || [null, q, '']; return { '@type': 'Question', name: plain(m[1]), acceptedAnswer: { '@type': 'Answer', text: plain(m[2] || '') } }; }) });
  const steps = page.blocks.find(b => b.type === 'steps' && b.title);
  if (steps) graph.push({ '@type': 'HowTo', name: plain(steps.title), step: steps.body.filter(l => /^\s*\d+\.\s+/.test(l)).map((l, i) => ({ '@type': 'HowToStep', position: i + 1, text: plain(l.replace(/^\s*\d+\.\s+/, '')) })) });
  const ex = EXPLORERS[page.slug];
  if (ex) graph.push({ '@type': 'Dataset', name: ex.title, description: ex.note, url, distribution: [{ '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: SITE + ex.src }], license: 'https://opensource.org/licenses/MIT', creator: { '@type': 'Organization', name: 'Open BRX' } });
  return { '@context': 'https://schema.org', '@graph': graph };
}

// ---- explorers (replace the manual's inline snapshot table with the generated component) ---
const weapons = buildWeapons(REPO);
const sounds = buildSounds(REPO, MANUAL);
write('data/weapons.json', JSON.stringify({ generated: NOW, source: ['mcp/brx_mcp/mc/weapons.json', 'docs/reference/weapons.md'], weapons }, null, 1));
write('data/sounds.json', JSON.stringify({ generated: NOW, source: ['protocol/callsign-extract/Sounds.json', 'docs/manual/04-sound.md'], count: sounds.rows.length, meanings_known: sounds.meanings_known, families: sounds.families, rows: sounds.rows }));
const EXPLORERS = {
  '/manual/gameplay/weapons': { id: 'weapons', src: '/data/weapons.json', title: 'Every weapon, from the wire', note: `${weapons.length} weapons · stats are the values the app sent over BLE when each was armed · pick two to compare` },
  '/manual/sound/sound-bank': { id: 'sounds', src: '/data/sounds.json', title: 'Sound Bank Explorer', note: `${sounds.rows.length} ids · ${sounds.meanings_known} with a known meaning · search by id, family or meaning` },
};
function explorerHtml(e, anchor) {
  return `<section class="blk blk-explorer" id="${e.id}-explorer" data-explorer="${e.id}" data-src="${e.src}">
<h2 id="${anchor || e.id + '-explorer-h'}">${esc(e.title)}</h2><p class="lead">${esc(e.note)}</p>
<div class="dt-bar"><input type="search" data-x-search placeholder="Search…" aria-label="Search ${e.id}"><div class="chips" data-x-chips role="group" aria-label="Filter"></div><span class="dt-count" data-x-count aria-live="polite">loading…</span></div>
<div class="x-error" data-x-error hidden role="alert">The ${e.id} data failed to load. <button type="button" data-x-retry>Reload data</button></div>
<div class="table-wrap"><table class="x-table" data-x-table><thead></thead><tbody></tbody></table></div>
<p class="x-more" data-x-more hidden><button type="button" data-x-more-btn>Show more</button></p>
<div class="x-dock" data-x-dock hidden aria-live="polite"></div>
<p class="src"><span>Source:</span> generated at build from the repo data files (see <code>${esc(e.src)}</code>).</p>
</section>`;
}

// ---- render pages -------------------------------------------------------------------------
const searchIndex = [];
const sitemap = [];
const twins = [];
function renderOne(page, opts = {}) {
  const ex = EXPLORERS[page.slug];
  let replaced = false;
  const extras = {
    replaceBlock: b => { if (ex && !replaced && b.type === 'data-table') { replaced = true; return explorerHtml(ex, b.id); } return undefined; },
  };
  const body = pageBody(page, ctx, extras);
  const isHome = page.slug === '/';
  const html = renderShell({
    title: isHome ? 'Open BRX — The Ultimate BRX Manual' : `${page.title.replace(/[`*]/g, '')} — ${page.section.title || 'Open BRX'} — The BRX Manual (Open BRX)`,
    description: page.subtitle || page.title, slug: page.slug, section: page.section, body,
    sidebar: isHome || page.slug === '/credits' || page.slug === '/changelog' ? '' : sidebarFor(page),
    toc: isHome ? '' : tocFor(page), breadcrumbs: crumbsFor(page), jsonld: jsonldFor(page), klass: isHome ? 'home' : (ex ? 'explorer-page' : ''),
  }, ctx);
  write(slugPath(page.slug), html);
  const twin = markdownTwin(page); write(twinPath(page.slug), twin); twins.push({ slug: page.slug, title: page.title, twin });
  sitemap.push(page.slug);
  const rows = page.blocks.flatMap(b => b.body.filter(l => l.startsWith('|') && !/^\|\s*-/.test(l)).map(l => l.split('|')[1]?.replace(/[`*]/g, '').trim()).filter(Boolean));
  const heads = page.blocks.filter(b => b.title).map(b => b.title.replace(/[`*]/g, ''));
  const faqs = page.blocks.flatMap(b => b.body.filter(l => /^\s*(?:[-*]|\d+\.)\s+\*\*/.test(l)).map(l => l.replace(/^\s*(?:[-*]|\d+\.)\s+\*\*(.+?)\*\*.*$/, '$1').replace(/[`*]/g, '')));
  searchIndex.push({ url: page.slug + (page.slug === '/' ? '' : '/'), title: page.title.replace(/[`*]/g, ''), section: page.section.title || 'Open BRX', subtitle: page.subtitle || '', heads, terms: [...new Set([...rows, ...faqs])].slice(0, 400) });
}
for (const page of pages) renderOne(page);

// section hub pages (generated: title, audience, goal, page cards)
for (const s of manualSections) {
  if (slugs.has(s.slug) && pages.some(p => p.slug === s.slug)) continue;
  const sp = pages.filter(p => p.section === s);
  const hub = { title: s.title, slug: s.slug, subtitle: s.goal || '', section: s, blocks: [] };
  const cards = `<section class="blk blk-cards"><div class="cards"><ul>${sp.map(p => `<li><a href="${p.slug}/"><strong>${esc(p.title.replace(/[`*]/g, ''))}</strong><br>${esc(p.subtitle || '')}</a></li>`).join('')}</ul></div></section>`;
  const body = `<article class="page hub"><header class="page-head"><p class="kicker">Section ${s.num}</p><h1>${esc(s.title)}</h1>${s.goal ? `<p class="subtitle">${md(s.goal, ctx).replace(/^<p>|<\/p>\s*$/g, '')}</p>` : ''}<p class="meta">${s.audience ? `<span class="aud">For ${esc(s.audience)}</span>` : ''}${s.lastVerified ? `<span class="lv">Last verified <time datetime="${s.lastVerified}">${s.lastVerified}</time></span>` : ''}<a class="md-link" href="${s.slug}.md">View as Markdown</a></p></header>${cards}</article>`;
  write(slugPath(s.slug), renderShell({ title: `${s.title} — The BRX Manual (Open BRX)`, description: s.goal || s.title, slug: s.slug, section: s, body, sidebar: sidebarFor(hub), toc: '', breadcrumbs: crumbsFor(hub), jsonld: jsonldFor(hub) }, ctx));
  const twin = [`# ${s.title}`, s.goal || '', '', ...sp.map(p => `- [${p.title}](${SITE}${p.slug}/) — ${p.subtitle || ''}`)].join('\n');
  write(twinPath(s.slug), twin); twins.push({ slug: s.slug, title: s.title, twin });
  sitemap.push(s.slug);
  searchIndex.push({ url: s.slug + '/', title: s.title, section: 'Manual', subtitle: s.goal || '', heads: sp.map(p => p.title), terms: [] });
}

// ---- assets, data, machine-readable layer ------------------------------------------------
for (const f of fs.readdirSync(path.join(HERE, 'assets'))) write(`assets/${f}`, fs.readFileSync(path.join(HERE, 'assets', f)));
for (const [id, f] of Object.entries(imageFiles)) write(`img/${f}`, fs.readFileSync(path.join(imgDir, f)));
write('favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#0c1016"/><path d="M8 4H4v16h4M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 5v8m-4-4h8" fill="none" stroke="#39b4ff" stroke-width="2" stroke-linecap="round"/></svg>`);
write('data/search.json', JSON.stringify(searchIndex));
write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.map(s => `<url><loc>${SITE}${s === '/' ? '/' : s + '/'}</loc>${manual.sections[0]?.lastVerified ? `<lastmod>${manual.sections[0].lastVerified}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`);
const llmsList = [...pages, ...manualSections.filter(s => !pages.some(p => p.slug === s.slug))].map(p => `- [${(p.title).replace(/[`*]/g, '')}](${SITE}${p.slug === '/' ? '/index' : p.slug}.md): ${(p.subtitle || p.goal || '').replace(/[`*]/g, '')}`);
write('llms.txt', `# Open BRX — The Ultimate BRX Manual\n\n> The definitive reference for the Battle Company BRX laser-tag tagger and headset, plus the Open BRX open-source platform that orchestrates BRX taggers. Known facts only: every statement carries its provenance (verified on our bench · official Battle Company docs · decoded from the Callsign app · community-reported) and a source path into the open repository. Nothing unconfirmed is published.\n\nEvery page is also available as plain Markdown at the same URL with a \`.md\` suffix. The full manual in one file: ${SITE}/llms-full.txt\n\nProtocol discovery credit: LaserTagMods (JEDGE / JBOX). Open BRX is independent and not affiliated with or endorsed by Battle Company. Source: ${'https://github.com/tony99nyr/open-brx'}\n\n## Pages\n\n${llmsList.join('\n')}\n`);
write('llms-full.txt', `# Open BRX — The Ultimate BRX Manual (full text)\n\nGenerated ${NOW}. Known facts only; provenance badges: ✅ verified on our bench · 📖 official Battle Company docs · 🔍 decoded from the Callsign app · 👥 community-reported · 🧪 built + software-tested · 📐 specified only · 🚧 under construction.\n\n` + twins.map(t => `\n\n---\n\n<!-- ${SITE}${t.slug === '/' ? '/' : t.slug + '/'} -->\n\n${t.twin}`).join(''));

// ---- link check (hard fail) ----------------------------------------------------------------
const problems = [];
for (const rel of written) {
  if (!rel.endsWith('.html')) continue;
  const html = fs.readFileSync(path.join(OUT, rel), 'utf8');
  for (const m of html.matchAll(/href="(\/[^"#?]*)"/g)) {
    const h = m[1];
    if (h.startsWith('/assets/') || h.startsWith('/data/') || h.startsWith('/img/')) { if (!written.has(h.slice(1))) problems.push(`${rel}: missing asset ${h}`); continue; }
    if (/\.(md|txt|xml|svg)$/.test(h)) { if (!written.has(h.slice(1))) problems.push(`${rel}: missing file ${h}`); continue; }
    const target = h === '/' ? 'index.html' : h.replace(/^\//, '').replace(/\/?$/, '/index.html');
    if (!written.has(target)) problems.push(`${rel}: broken link ${h}`);
  }
  if (/\[[a-z][a-z-]*(?::[a-z|]+)?(?:\s+[A-Za-z0-9-]+)?\]/.test(html.replace(/<code>[^<]*<\/code>/g, '').replace(/<pre[\s\S]*?<\/pre>/g, '').replace(/<script[\s\S]*?<\/script>/g, ''))) problems.push(`${rel}: raw block marker leaked into HTML`);
}
// ---- cleanup of stale generated files + manifest -------------------------------------------
const manifestPath = path.join(OUT, '.site-manifest.json');
let prev = [];
if (fs.existsSync(manifestPath)) { try { prev = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files || []; } catch {} }
for (const rel of prev) {
  const top = rel.split('/')[0];
  if (PROTECTED.has(top) || written.has(rel)) continue;
  const p = path.join(OUT, rel); if (fs.existsSync(p)) fs.unlinkSync(p);
}
console.log(`built ${sitemap.length} pages, ${written.size} files → ${OUT} (weapons ${weapons.length}, sounds ${sounds.rows.length}/${sounds.meanings_known} known)`);
if (problems.length) {
  // a failed gate never stamps a fresh manifest — the test guard must refuse this output
  fs.writeFileSync(manifestPath, JSON.stringify({ built: NOW, ok: false, problems, pages: sitemap.length, files: [...written].sort() }, null, 1));
  console.error(`\n${problems.length} problem(s):\n` + problems.map(p => '  ' + p).join('\n')); process.exit(1);
}
fs.writeFileSync(manifestPath, JSON.stringify({ built: NOW, ok: true, sourceStamp: sourceStamp(MANUAL), sources: sourceFiles(MANUAL).map(p => path.relative(REPO, p)), pages: sitemap.length, htmlFiles: [...written].filter(f => f.endsWith('.html')).length, files: [...written].sort() }, null, 1));
