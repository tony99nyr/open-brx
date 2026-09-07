// Render page models (lib/parse.mjs) to HTML. One component per block type; unknown → visible TODO chip.
import { marked } from 'marked';
import { PROV_LABEL } from './parse.mjs';

marked.use({ gfm: true, breaks: false, mangle: false, headerIds: false });

export const REPO_URL = 'https://github.com/tony99nyr/open-brx';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// a block head is "Name<delimiter>what it is"; that delimiter was an em dash and is now a colon
export const SUBTITLE_SPLIT = /\s+[—–]\s+|:\s+/;
const slugify = s => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[`*"“”]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'section';

export function badge(kind) {
  const label = { bench: 'bench', official: 'official', apk: 'app', community: 'community', software: 'software', spec: 'spec', wip: 'under construction' }[kind];
  // no emoji in the markup: the dot is drawn in CSS, so a missing font can never leave tofu behind
  return `<span class="badge b-${kind}" title="${esc(PROV_LABEL[kind])}"><span>${label}</span></span>`;
}
const EMOJI_RE = /[✅📖🔍👥🧪📐🚧]/gu;
const EMOJI_KIND = { '✅': 'bench', '📖': 'official', '🔍': 'apk', '👥': 'community', '🧪': 'software', '📐': 'spec', '🚧': 'wip' };
function badgesInline(html) { return html.replace(EMOJI_RE, e => badge(EMOJI_KIND[e])); }
// A paragraph whose whole content is provenance marks is a status line, not prose: the dot alone
// says nothing there, so it spells the marks out instead of leaving orphaned coloured dots behind.
const ONLY_BADGES = /^(?:\s|<span class="badge[^"]*"[^>]*>(?:<span>[^<]*<\/span>)?<\/span>)+$/;
function badgeRow(html) {
  return html.replace(/<p([^>]*)>([\s\S]*?)<\/p>/g, (m, attrs, inner) =>
    ONLY_BADGES.test(inner) ? `<p class="badge-row">${inner}</p>` : m);
}

function linkSlugs(html, ctx) {
  // `<code>/manual/x/y</code>` → a link labelled with the page's title when the slug exists
  const { slugs, slugTitles } = ctx;
  return html.replace(/<code>(\/(?:manual|platform|credits|changelog)[a-z0-9/-]*)<\/code>/g, (m, s) => {
    const slug = s.replace(/\/$/, '');
    if (!slugs.has(slug)) return `<code data-todo="missing page ${esc(slug)}">${esc(slug)}</code>`;
    const label = slugTitles?.get(slug) || slug;
    return `<a class="pl" href="${slug}/">${esc(label)}</a>`;
  });
}

function crossRefs(html, ctx) {
  // "→ <em>Page title</em>" written by the manual authors → a link when a page (or section) with that title exists
  if (!ctx?.titles) return html;
  return html.replace(/(→|&rarr;)\s*<em>([^<]+)<\/em>/g, (m, arrow, title) => {
    const key = title.replace(/&amp;/g, '&').toLowerCase().replace(/[`*"“”]/g, '').replace(/\s+/g, ' ').trim();
    const first = key.split(/[:—–(/]/)[0].trim();
    let slug = ctx.titles.get(key) || ctx.titles.get(first) || ctx.aliases?.get(key) || ctx.aliases?.get(first);
    if (!slug) { for (const [k, v] of ctx.titles) if (k.startsWith(first + ' ') || k.startsWith(first + ',') || k === first) { slug = v; break; } }
    return slug ? `${arrow} <a href="${slug}/">${title}</a>` : m;
  });
}
export function md(text, ctx) {
  // an [image ID] / [diagram ID] reference embedded in prose → an inline placeholder chip (or the image link)
  text = text.replace(/\[(image|diagram)\s+([A-Z]+-\d+[a-z]?)\]/g, (m, kind, id) => {
    const file = ctx?.imageFiles?.[id];
    return file ? `<a class="img-ref" href="/img/${esc(file)}">${esc(id)}</a>` : `<span class="img-ref ph-inline" title="${kind} pending">${esc(id)}</span>`;
  });
  let html = marked.parse(text);
  // a "src: …" fragment that survived inside a table cell is provenance noise, not content
  html = html.replace(/(<td>[^<]*?)\s*(?:<code>)?src:\s*[^<]*(?:<\/code>)?(\s*<\/td>)/g, '$1$2');
  html = badgesInline(html);
  if (ctx?.slugs) html = linkSlugs(html, ctx);
  html = crossRefs(html, ctx);
  // every table scrolls inside its own container, never the page
  html = html.replace(/<table>[\s\S]*?<\/table>/g, m => `<div class="table-wrap">${m}</div>`);
  return badgeRow(html);
}
// unwrap the single paragraph marked produces — including one md() has already re-classed
const inline = (text, ctx) => md(text, ctx).replace(/^<p[^>]*>|<\/p>\s*$/g, '');

function listItems(body) {
  // split a markdown list body into items (each may span continuation lines)
  const items = []; let cur = null;
  for (const l of body) {
    if (/^\s*(?:[-*•]|\d+\.)\s+/.test(l)) { if (cur) items.push(cur); cur = l.replace(/^\s*(?:[-*•]|\d+\.)\s+/, ''); }
    else if (cur !== null && l.trim()) cur += '\n' + l.trim();
    else if (cur !== null && !l.trim()) { items.push(cur); cur = null; }
  }
  if (cur) items.push(cur);
  return items;
}
function splitLead(item) {
  const m = item.match(/^\*\*(.+?)\*\*\s*[—–:-]?\s*([\s\S]*)$/) || item.match(/^"(.+?)"\s*[—–:-]?\s*([\s\S]*)$/) || item.match(/^(.+?\?)\s*([\s\S]*)$/);
  return m ? [m[1], m[2]] : [item, ''];
}
// A spec sheet writes its facts as "Wavelength: **980 nm**" — the term first, the value emphasised.
// splitLead only understands a leading **bold**, so without this every fact landed in the term
// column and all 20 <dd> came out empty. A short, emphasis-free run before ": " is the term.
function splitSpec(item) {
  const [k, v] = splitLead(item);
  if (v) return [k, v];
  const c = item.match(/^([^:*`\n]{1,44}):\s+([\s\S]+)$/);
  return c ? [c[1].trim(), c[2]] : [item, ''];
}

function srcLine(b) {
  if (!b.src.length) return '';
  const html = b.src.join(' · ').replace(/\bsrc:\s*/g, '').replace(/((?:[\w-]+\/)+[\w.-]+\.(?:md|py|json|css|ts|toml|txt))/g,
    (m, p) => `<a href="${REPO_URL}/blob/main/${p}" rel="noopener">${esc(p)}</a>`);
  return `<p class="src"><span>Source:</span> ${html.replace(/`/g, '')}</p>`;
}
export function assignIds(page) {
  const seen = new Map();
  const NO_ANCHOR = new Set(['image', 'diagram', 'quote', 'prose']);
  for (const b of page.blocks) {
    const t = b.title || (b.type === 'under-construction' ? (b.head.split(SUBTITLE_SPLIT)[0] || '') : '');
    if (!t.trim() || NO_ANCHOR.has(b.type)) { b.id = null; continue; }
    const base = slugify(t); const n = (seen.get(base) || 0) + 1; seen.set(base, n);
    b.id = n === 1 ? base : `${base}-${n}`;
  }
}
function blockHead(b, ctx) {
  let h = '';
  if (b.title) h += `<h2 id="${b.id || slugify(b.title)}">${inline(b.title, ctx)}</h2>`;
  if (b.head) { const inner = inline(b.head, ctx); h += ONLY_BADGES.test(inner) ? `<p class="badge-row">${inner}</p>` : `<p class="lead">${inner}</p>`; }
  return h;
}
const wrap = (b, cls, inner) => `<section class="blk blk-${b.type}${cls ? ' ' + cls : ''}" data-type="${esc(b.type)}">${inner}</section>`;

function figure(b, ctx) {
  const id = b.arg || '';
  const meta = ctx.images[id];
  const file = ctx.imageFiles[id];
  const cap = b.head || meta?.what || id;
  const kind = meta?.kind || (b.type === 'diagram' ? 'svg' : 'generate');
  const body = file
    ? `<img src="/img/${esc(file)}" alt="${esc(meta?.what || cap)}" loading="lazy">`
    : `<div class="ph ph-${kind}" role="img" aria-label="${esc(meta?.what || cap)}"><span class="ph-id">${esc(id)}</span><span class="ph-kind">${kind === 'photo' ? 'photo pending' : kind === 'svg' ? 'diagram pending' : 'illustration pending'}</span></div>`;
  const ratio = (meta?.prompt || meta?.what || '').match(/\b(21:9|16:9|4:3|1:1|3:2)\b/)?.[1] || '16:9';
  // captions describe a picture's flow ("A → *B*"); those arrows are not cross-references
  return `<figure class="fig fig-${kind}${file ? '' : ' fig-pending'}" id="${esc(id)}" style="--ratio:${ratio.replace(':', '/')}">${body}<figcaption>${inline(cap, { ...ctx, titles: null, aliases: null })}</figcaption></figure>`;
}

function ladder(b, ctx) {
  const items = listItems(b.body).map((it, i) => {
    const m = it.match(/^([\s\S]*?)\s*→\s*(yes|no)\s*→\s*([\s\S]*)$/i);
    if (!m) return `<li class="rung"><div class="check"><span class="n">${i + 1}</span>${inline(it, ctx)}</div></li>`;
    return `<li class="rung"><div class="check"><span class="n">${i + 1}</span>${inline(m[1], ctx)}</div><div class="ans"><span class="chip ${m[2].toLowerCase()}">${m[2].toLowerCase() === 'yes' ? 'Yes →' : 'No →'}</span><div class="fix">${inline(m[3], ctx)}</div></div></li>`;
  }).join('');
  return `<ol class="ladder">${items}</ol>`;
}

function details(b, ctx, open = false) {
  const items = listItems(b.body);
  if (!items.length) return md(b.body.join('\n'), ctx);
  return items.map(it => { const [q, a] = splitLead(it); return `<details${open ? ' open' : ''}><summary>${inline(q, ctx)}</summary><div>${md(a || '', ctx)}</div></details>`; }).join('');
}

function statRow(b, ctx) {
  const items = listItems(b.body);
  if (!items.length) return md(b.body.join('\n'), ctx);
  return `<ul class="stats">${items.map(it => { const m = it.match(/^\*\*(.+?)\*\*\s*([\s\S]*)$/); return m ? `<li><strong>${inline(m[1], ctx)}</strong><span>${inline(m[2], ctx)}</span></li>` : `<li><span>${inline(it, ctx)}</span></li>`; }).join('')}</ul>`;
}

function specSheet(b, ctx) {
  const items = listItems(b.body);
  if (!items.length) return md(b.body.join('\n'), ctx);
  // an item that is a sentence rather than a term:value pair spans the full width instead of
  // being squeezed into the term column with nothing beside it
  return `<dl>${items.map(it => { const [k, v] = splitSpec(it); return v ? `<dt>${inline(k, ctx)}</dt><dd>${md(v, ctx)}</dd>` : `<dt class="full">${inline(k, ctx)}</dt><dd class="full"></dd>`; }).join('')}</dl>`;
}

// A [table] whose head says "columns: A | B | C" and whose body is a list of "a | b | c" items → real table.
function listTable(b, ctx) {
  if (b.body.some(l => l.startsWith('|'))) return null;
  const cm = (b.head || '').match(/columns?:\s*(.+)$/i);
  const items = listItems(b.body);
  if (!items.length || !items.every(it => it.includes('|'))) return null;
  const cols = cm ? cm[1].split('|').map(s => s.trim()).filter(Boolean) : null;
  if (cm) b.head = b.head.slice(0, cm.index).replace(/[—–-]\s*$/, '').trim();
  const rows = items.map(it => it.split('|').map(s => s.trim()));
  const n = cols ? cols.length : Math.max(...rows.map(r => r.length));
  const head = cols ? `<thead><tr>${cols.map(c => `<th>${inline(c, ctx)}</th>`).join('')}</tr></thead>` : '';
  return `<table>${head}<tbody>${rows.map(r => `<tr>${Array.from({ length: n }, (_, i) => `<td>${inline(r[i] || '', ctx)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

// A markdown table whose rows don't match the header width is malformed content → visible TODO chip.
function tableWarning(b) {
  const rows = b.body.filter(l => l.trim().startsWith('|')).map(l => l.trim().replace(/^\||\|$/g, '').split('|').length);
  if (rows.length < 2) return '';
  const bad = rows.slice(2).filter(n => n !== rows[0]).length;
  return bad ? `<span class="todo" data-todo="malformed table">TODO: content. Malformed table: ${bad} row${bad > 1 ? 's' : ''} don't match the ${rows[0]}-column header</span>` : '';
}
function dataTable(b, ctx) {
  const table = md(b.body.join('\n'), ctx);
  const n = (b.body.filter(l => l.startsWith('|')).length - 2);
  return `${tableWarning(b)}<div class="dt" data-rows="${Math.max(n, 0)}"><div class="dt-bar"><input type="search" placeholder="Filter this table…" aria-label="Filter table"><span class="dt-count" aria-live="polite">${Math.max(n, 0)} rows</span></div>${table}</div>`;
}

function underConstruction(b, ctx) {
  const first = b.body.find(l => l.trim()) || '';
  const one = first.replace(/^\s*[-*]\s*/, '').replace(/^\*\*What:\*\*\s*/, '');
  const title = b.title || b.head.split(SUBTITLE_SPLIT)[0];
  const status = (b.head.match(/[✅🧪📐🚧]+/gu) || ['🚧']).join('');
  return `<div class="uc"><div class="uc-head"><span class="uc-mark" aria-hidden="true">🚧</span><h2 id="${b.id || slugify(title)}">${inline(title, ctx)}</h2>${badgesInline(esc(status))}</div><p>${inline(one, ctx)}</p><p class="uc-note">Under construction. We will add details once it has run on real hardware.</p></div>`;
}

// A [download] block advertises the one apk committed under webapp/download/. Every hard fact in
// the card (name, size, date, checksum) is read off that file at build time by build.mjs, so the
// page cannot drift from the bytes it serves. No apk present = a visible TODO, not a dead link.
function downloadCard(b, ctx) {
  const d = ctx.download;
  if (!d) return `<p class="todo" data-todo="no build published">TODO: content. No build published: run <code>npm run android:apk</code> in <code>app/</code>.</p>`;
  const rows = [
    ['File', `<code>${esc(d.file)}</code>`],
    ['Version', `${esc(d.version || 'unversioned')} (${esc(d.variant || 'debug')} build)`],
    ['Size', esc(d.size)],
    ['Built', esc(d.date)],
    ['SHA-256', `<code class="sha">${esc(d.sha256)}</code>`],
  ];
  return `<div class="dl">
<a class="dl-btn" href="${esc(d.href)}" download>Download for Android<span>APK · ${esc(d.size)}</span></a>
<dl class="dl-meta">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
</div>`;
}

export function renderBlock(b, ctx) {
  const body = b.body.join('\n');
  switch (b.type) {
    case 'hero': return wrap(b, '', `<p class="hero-text"${b.id ? ` id="${b.id}"` : ''}>${b.title ? `<strong>${inline(b.title, ctx)}</strong> ` : ''}${inline(b.head, ctx)}</p>${md(body, ctx)}${srcLine(b)}`);
    case 'callout': { const k = (b.mod || 'info').split('|')[0]; return wrap(b, `co-${k}`, `<aside class="callout ${k}" role="note"${b.id ? ` id="${b.id}"` : ''}>${b.title ? `<strong class="co-title">${inline(b.title, ctx)}</strong>` : ''}${b.head ? `<p>${inline(b.head, ctx)}</p>` : ''}${md(body, ctx)}${srcLine(b)}</aside>`); }
    case 'steps': return wrap(b, '', `${blockHead(b, ctx)}<div class="steps">${md(body, ctx)}</div>${srcLine(b)}`);
    case 'cards': return wrap(b, '', `${blockHead(b, ctx)}<div class="cards">${md(body, ctx)}</div>${srcLine(b)}`);
    case 'table': case 'compare': case 'timeline': case 'pricing-tiers': { const lt = listTable(b, ctx); return wrap(b, '', `${blockHead(b, ctx)}${tableWarning(b)}${lt ? `<div class="table-wrap">${lt}</div>` : md(body, ctx)}${srcLine(b)}`); }
    case 'data-table': return wrap(b, '', `${blockHead(b, ctx)}${dataTable(b, ctx)}${srcLine(b)}`);
    case 'spec-sheet': return wrap(b, '', `${blockHead(b, ctx)}${specSheet(b, ctx)}${srcLine(b)}`);
    case 'accordion': return wrap(b, '', `${blockHead(b, ctx)}${details(b, ctx)}${srcLine(b)}`);
    case 'faq': return wrap(b, '', `${blockHead(b, ctx)}<div class="faq">${details(b, ctx)}</div>${srcLine(b)}`);
    case 'image': case 'diagram': return wrap(b, '', figure(b, ctx) + srcLine(b));
    case 'code': return wrap(b, '', `${blockHead(b, ctx)}${md(body, ctx)}${srcLine(b)}`);
    case 'bit-field': return wrap(b, '', `${blockHead(b, ctx)}<div class="bitfield">${md(body, ctx)}</div>${srcLine(b)}`);
    case 'symptom-ladder': return wrap(b, '', `${blockHead(b, ctx)}${ladder(b, ctx)}${srcLine(b)}`);
    case 'quote': return wrap(b, '', `<blockquote>${b.title ? `<p class="q">“${inline(b.title, ctx)}”</p>` : ''}${b.head ? `<footer class="q-by">${inline(b.head, ctx)}</footer>` : ''}${md(body, ctx)}</blockquote>${srcLine(b)}`);
    case 'stat-row': return wrap(b, '', `${blockHead(b, ctx)}${statRow(b, ctx)}${srcLine(b)}`);
    case 'download': return wrap(b, '', `${blockHead(b, ctx)}${downloadCard(b, ctx)}${md(body, ctx)}${srcLine(b)}`);
    case 'under-construction': return wrap(b, '', underConstruction(b, ctx));
    default: return wrap(b, 'blk-unknown', `<span class="todo" data-todo="unknown block type">TODO: content. Unknown block type “${esc(b.type)}”</span>${blockHead(b, ctx)}${md(body, ctx)}${srcLine(b)}`);
  }
}

// ---- page chrome ---------------------------------------------------------------------------
const LOGO = `<svg class="logo" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 4H4v16h4M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 5v8m-4-4h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

export function renderShell({ title, description, slug, section, body, sidebar, toc, breadcrumbs, jsonld, meta, klass = '' }, ctx) {
  const crumbs = breadcrumbs.map((c, i) => i === breadcrumbs.length - 1 ? `<span aria-current="page">${esc(c.title)}</span>` : `<a href="${c.url}">${esc(c.title)}</a>`).join('<span class="sep">/</span>');
  const nav = [['Manual', '/manual/'], ['Platform', '/platform/'], ['Credits', '/credits/'], ['Changelog', '/changelog/']]
    .map(([t, u]) => `<a href="${u}"${slug === u.replace(/\/$/, '') || (u !== '/' && slug.startsWith(u.replace(/\/$/, '') + '/')) || (u === '/manual/' && slug.startsWith('/manual')) ? ' aria-current="true"' : ''}>${t}</a>`).join('');
  return `<!doctype html>
<html lang="en" data-theme="">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${ctx.site}${slug === '/' ? '/' : slug + '/'}">
<link rel="alternate" type="text/markdown" href="${slug === '/' ? '/index' : slug}.md" title="Markdown version">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${ctx.cssHref || '/assets/site.css'}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<meta name="color-scheme" content="light dark">
<script>try{var t=localStorage.getItem('brx-theme');if(t)document.documentElement.dataset.theme=t;}catch(e){}</script>
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ''}
</head>
<body class="${klass}">
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  ${sidebar ? `<button class="nav-toggle" aria-label="Open navigation" aria-expanded="false" data-nav-toggle>&#9776;</button>` : ''}
  <a class="brand" href="/">${LOGO}<span>OPEN BRX</span></a>
  <nav class="topnav" aria-label="Primary">${nav}</nav>
  <div class="tools">
    <button class="search-btn" data-search-open aria-label="Search the manual"><span>Search</span><kbd>⌘K</kbd></button>
    <button class="theme-btn" data-theme-toggle aria-label="Toggle light and dark theme" aria-pressed="false">◐</button>
    <a class="gh" href="${REPO_URL}" rel="noopener" aria-label="GitHub repository">GitHub</a>
  </div>
</header>
<div class="layout${sidebar ? ' has-side' : ''}${toc ? ' has-toc' : ''}">
  ${sidebar ? `<nav class="side" id="side" aria-label="Manual sections">${sidebar}</nav>` : ''}
  <main id="main" class="main">
    ${breadcrumbs.length > 1 && slug !== '/' ? `<nav class="crumbs" aria-label="Breadcrumb">${crumbs}</nav>` : ''}
    ${body}
  </main>
  ${toc ? `<aside class="toc" aria-label="On this page"><div class="toc-in"><p class="toc-h">On this page</p>${toc}</div></aside>` : ''}
</div>
<footer class="foot">
  <p>Protocol discovered by <a href="https://github.com/LaserTagMods" rel="noopener">LaserTagMods</a> (JEDGE / JBOX) · Hardware by Battle Company · Fixes by the owner community.</p>
  <p>Open BRX is an independent open-source project and is not affiliated with or endorsed by Battle Company. MIT licence. <a href="/credits/">Credits &amp; sourcing</a> · <a href="/changelog/">Changelog</a> · <a href="/llms.txt">llms.txt</a> · <a href="${REPO_URL}" rel="noopener">GitHub</a></p>
</footer>
<div class="search-modal" data-search-modal hidden><div class="search-box" role="dialog" aria-label="Search"><input type="search" data-search-input aria-label="Search the manual" placeholder="Search pages, headings, weapons, sound ids, commands…" autocomplete="off"><div class="search-results" data-search-results aria-live="polite"><p class="muted">Type to search.</p></div><p class="search-hint">Esc to close</p></div></div>
<script src="${ctx.jsHref || '/assets/site.js'}" defer></script>
</body>
</html>`;
}

export function pageBody(page, ctx, extras = {}) {
  assignIds(page);
  const blocks = page.blocks.map(b => extras.replaceBlock?.(b) ?? renderBlock(b, ctx)).join('\n');
  const prov = new Set(page.blocks.flatMap(b => b.badges));
  const lv = page.section.lastVerified;
  if (page.slug === '/') {
    // Home: a documentation landing — wordmark, the pitch, then straight into the section index.
    // The pitch is the manual's own [hero] block promoted into the head (with its src), not a second copy.
    const h = extras.pitchBlock;
    // the hero's bold lead-in is the project name; the wordmark above already says it
    const dupe = t => t.replace(/[.\s]/g, '').toLowerCase() === 'openbrx';
    const pitch = h ? `${h.title && !dupe(h.title) ? `<strong>${inline(h.title, ctx)}</strong> ` : ''}${inline(h.head, ctx)}` : inline(page.subtitle || '', ctx);
    return `<article class="page"><header class="page-head">${page.subtitle ? `<p class="kicker">${inline(page.subtitle, ctx)}</p>` : ''}<h1 class="wordmark">Open BRX</h1><p class="pitch">${pitch}</p>${metaLine({ lv, lvLabel: 'Manual last verified', mdHref: '/index.md' })}${h ? srcLine(h) : ''}</header>${extras.before || ''}${blocks}${extras.after || ''}</article>`;
  }
  return `<article class="page">
<header class="page-head">
<h1>${inline(page.title, ctx)}</h1>
${page.subtitle ? `<p class="subtitle">${inline(page.subtitle, ctx)}</p>` : ''}
${metaLine({ prov: [...prov], lv, mdHref: `${page.slug}.md` })}
</header>
${blocks}
${extras.after || ''}
</article>`;
}

// One line of page furniture: provenance · last verified · how we know · the markdown twin.
// The badge legend lives once, on /credits/ — not repeated on all 73 pages.
export function metaLine({ prov = [], lv, lvLabel = 'Last verified', aud, mdHref }) {
  // spacing, not middots: on a narrow screen a separator character strands itself at the end of a
  // wrapped row and reads as debris, so the flex gap does the separating instead
  const parts = [];
  if (prov.length) parts.push(`<span class="prov">${prov.map(badge).join('')}</span>`);
  if (aud) parts.push(`<span class="aud">For ${esc(aud)}</span>`);
  if (lv) parts.push(`<span class="lv">${lvLabel} <time datetime="${lv}">${lv}</time></span>`);
  if (prov.length) parts.push(`<a class="how" href="/credits/#how-we-know">How we know</a>`);
  if (mdHref) parts.push(`<a class="md-link" href="${mdHref}">Markdown</a>`);
  return parts.length ? `<p class="meta">${parts.join('')}</p>` : '';
}

// The provenance legend, rendered once at the bottom of /credits/.
export function legendHtml() {
  return `<section class="blk" id="how-we-know"><h2>How we know each fact</h2><p class="lead">Every block on this site carries one of these. If a fact is not confirmed on the bench, in an official document, or in the app's own data, it is not published.</p><ul class="legend-list">${Object.entries(PROV_LABEL).map(([k, v]) => `<li>${badge(k)} ${esc(v)}</li>`).join('')}</ul></section>`;
}

// The rail lists the page's SECTIONS. A callout or a hero paragraph has a title but renders no
// heading, so those entries were full sentences pointing at a paragraph with no landing target.
const TOC_SKIP = new Set(['callout', 'hero', 'quote', 'image', 'diagram', 'prose']);
export function tocFor(page, extra = []) {
  assignIds(page);
  const all = page.blocks.filter(b => b.id && !TOC_SKIP.has(b.type))
    .map(b => { const t = b.title || b.head.split(SUBTITLE_SPLIT)[0]; return `<li><a href="#${b.id}">${esc(t.replace(/[`*]/g, ''))}</a></li>`; })
    .concat(extra.map(e => `<li><a href="#${e.id}">${esc(e.title)}</a></li>`));
  return all.length >= 2 ? `<ol>${all.join('')}</ol>` : '';
}

export function markdownTwin(page, ctx = {}) {
  const out = [`# ${page.title}`, page.subtitle ? `_${page.subtitle}_` : '', page.section.lastVerified ? `Last verified: ${page.section.lastVerified}` : '', ''];
  for (const b of page.blocks) {
    if (b.type === 'under-construction') { out.push(`## ${b.title || b.head} 🚧`, 'Under construction. We will add details once it has run on real hardware.', ''); continue; }
    if (b.type === 'download') {
      const d = ctx.download;
      if (b.title) out.push(`## ${b.title}`);
      if (b.head) out.push(b.head);
      out.push(d ? `Download: ${ctx.site || ''}${d.href} (${d.size}, version ${d.version || 'unversioned'}, built ${d.date}, sha256 ${d.sha256})` : 'No build is published yet.', '');
      out.push(...b.body.filter(l => l.trim()));
      if (b.src.length) out.push(`Source: ${b.src.join(' · ')}`);
      out.push('');
      continue;
    }
    if (b.type === 'image' || b.type === 'diagram') { out.push(`_[${b.type} ${b.arg}: ${b.head || ''}]_`, ''); continue; }
    if (b.title) out.push(`## ${b.title}`);
    const cm = (b.head || '').match(/columns?:\s*(.+)$/i);
    const items = listItems(b.body);
    if (['table', 'compare', 'timeline', 'pricing-tiers'].includes(b.type) && !b.body.some(l => l.startsWith('|')) && items.length && items.every(it => it.includes('|'))) {
      if (b.head && !cm) out.push(b.head); else if (cm && b.head.slice(0, cm.index).trim()) out.push(b.head.slice(0, cm.index).replace(/[—–-]\s*$/, '').trim());
      const cols = cm ? cm[1].split('|').map(s => s.trim()).filter(Boolean) : null;
      const rows = items.map(it => it.split('|').map(s => s.trim()));
      const n = cols ? cols.length : Math.max(...rows.map(r => r.length));
      out.push(`| ${(cols || Array.from({ length: n }, (_, i) => `col ${i + 1}`)).join(' | ')} |`, `|${'---|'.repeat(n)}`, ...rows.map(r => `| ${Array.from({ length: n }, (_, i) => r[i] || '').join(' | ')} |`));
    } else {
      if (b.head) out.push(b.head);
      out.push(...b.body);
    }
    if (b.src.length) out.push(`Source: ${b.src.join(' · ')}`);
    out.push('');
  }
  return out.join('\n');
}
