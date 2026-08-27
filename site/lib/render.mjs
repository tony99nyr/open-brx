// Render page models (lib/parse.mjs) to HTML. One component per block type; unknown → visible TODO chip.
import { marked } from 'marked';
import { PROV_LABEL, PROV_EMOJI } from './parse.mjs';

marked.use({ gfm: true, breaks: false, mangle: false, headerIds: false });

export const REPO_URL = 'https://github.com/tony99nyr/open-brx';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = s => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[`*"“”]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'section';

export function badge(kind) {
  const label = { bench: 'bench', official: 'official', apk: 'app', community: 'community', software: 'software', spec: 'spec', wip: 'under construction' }[kind];
  return `<span class="badge b-${kind}" title="${esc(PROV_LABEL[kind])}"><i aria-hidden="true">${PROV_EMOJI[kind]}</i><span>${label}</span></span>`;
}
const EMOJI_RE = /[✅📖🔍👥🧪📐🚧]/gu;
const EMOJI_KIND = { '✅': 'bench', '📖': 'official', '🔍': 'apk', '👥': 'community', '🧪': 'software', '📐': 'spec', '🚧': 'wip' };
function badgesInline(html) { return html.replace(EMOJI_RE, e => badge(EMOJI_KIND[e])); }

function linkSlugs(html, slugs) {
  // `<code>/manual/x/y</code>` → link when the slug exists
  return html.replace(/<code>(\/(?:manual|platform|credits|changelog)[a-z0-9/-]*)<\/code>/g, (m, s) => {
    const slug = s.replace(/\/$/, '');
    return slugs.has(slug) ? `<a href="${slug}/">${esc(slug)}</a>` : `<code data-todo="missing page ${esc(slug)}">${esc(slug)}</code>`;
  });
}

export function md(text, ctx) {
  let html = marked.parse(text);
  html = badgesInline(html);
  if (ctx?.slugs) html = linkSlugs(html, ctx.slugs);
  return html;
}
const inline = (text, ctx) => md(text, ctx).replace(/^<p>|<\/p>\s*$/g, '');

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

function srcLine(b) {
  if (!b.src.length) return '';
  const html = b.src.join(' · ').replace(/((?:[\w-]+\/)+[\w.-]+\.(?:md|py|json|css|ts|toml|txt))/g,
    (m, p) => `<a href="${REPO_URL}/blob/main/${p}" rel="noopener">${esc(p)}</a>`);
  return `<p class="src"><span>Source:</span> ${html.replace(/`/g, '')}</p>`;
}
function blockHead(b, ctx) {
  let h = '';
  if (b.title) h += `<h2 id="${slugify(b.title)}">${inline(b.title, ctx)}</h2>`;
  if (b.head) h += `<p class="lead">${inline(b.head, ctx)}</p>`;
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
  return `<figure class="fig fig-${kind}${file ? '' : ' fig-pending'}" id="${esc(id)}">${body}<figcaption>${inline(cap, ctx)}</figcaption></figure>`;
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
  return `<dl>${items.map(it => { const [k, v] = splitLead(it); return `<dt>${inline(k, ctx)}</dt><dd>${md(v || '', ctx)}</dd>`; }).join('')}</dl>`;
}

function dataTable(b, ctx) {
  const table = md(b.body.join('\n'), ctx);
  const n = (b.body.filter(l => l.startsWith('|')).length - 2);
  return `<div class="dt" data-rows="${Math.max(n, 0)}"><div class="dt-bar"><input type="search" placeholder="Filter this table…" aria-label="Filter table"><span class="dt-count" aria-live="polite">${Math.max(n, 0)} rows</span></div><div class="table-wrap">${table}</div></div>`;
}

function underConstruction(b, ctx) {
  const first = b.body.find(l => l.trim()) || '';
  const one = first.replace(/^\s*[-*]\s*/, '').replace(/^\*\*What:\*\*\s*/, '');
  const title = b.title || b.head.split('—')[0];
  const status = (b.head.match(/[✅🧪📐🚧]+/gu) || ['🚧']).join('');
  return `<div class="uc"><div class="uc-head"><span class="uc-mark" aria-hidden="true">🚧</span><h2 id="${slugify(title)}">${inline(title, ctx)}</h2>${badgesInline(esc(status))}</div><p>${inline(one, ctx)}</p><p class="uc-note">Under construction — details when it has run on real hardware.</p></div>`;
}

export function renderBlock(b, ctx) {
  const body = b.body.join('\n');
  switch (b.type) {
    case 'hero': return wrap(b, '', `<p class="hero-text">${inline(b.head, ctx)}</p>${md(body, ctx)}${srcLine(b)}`);
    case 'callout': { const k = (b.mod || 'info').split('|')[0]; return wrap(b, `co-${k}`, `<aside class="callout ${k}" role="note">${b.title ? `<strong class="co-title">${inline(b.title, ctx)}</strong>` : ''}${b.head ? `<p>${inline(b.head, ctx)}</p>` : ''}${md(body, ctx)}${srcLine(b)}</aside>`); }
    case 'steps': return wrap(b, '', `${blockHead(b, ctx)}<div class="steps">${md(body, ctx)}</div>${srcLine(b)}`);
    case 'cards': return wrap(b, '', `${blockHead(b, ctx)}<div class="cards">${md(body, ctx)}</div>${srcLine(b)}`);
    case 'table': case 'compare': case 'timeline': case 'pricing-tiers': return wrap(b, '', `${blockHead(b, ctx)}<div class="table-wrap">${md(body, ctx)}</div>${srcLine(b)}`);
    case 'data-table': return wrap(b, '', `${blockHead(b, ctx)}${dataTable(b, ctx)}${srcLine(b)}`);
    case 'spec-sheet': return wrap(b, '', `${blockHead(b, ctx)}${specSheet(b, ctx)}${srcLine(b)}`);
    case 'accordion': return wrap(b, '', `${blockHead(b, ctx)}${details(b, ctx)}${srcLine(b)}`);
    case 'faq': return wrap(b, '', `${blockHead(b, ctx)}<div class="faq">${details(b, ctx)}</div>${srcLine(b)}`);
    case 'image': case 'diagram': return wrap(b, '', figure(b, ctx) + srcLine(b));
    case 'code': return wrap(b, '', `${blockHead(b, ctx)}${md(body, ctx)}${srcLine(b)}`);
    case 'bit-field': return wrap(b, '', `${blockHead(b, ctx)}<div class="bitfield">${md(body, ctx)}</div>${srcLine(b)}`);
    case 'symptom-ladder': return wrap(b, '', `${blockHead(b, ctx)}${ladder(b, ctx)}${srcLine(b)}`);
    case 'quote': return wrap(b, '', `<blockquote>${inline(b.head, ctx)}${md(body, ctx)}</blockquote>${srcLine(b)}`);
    case 'stat-row': return wrap(b, '', `${blockHead(b, ctx)}${statRow(b, ctx)}${srcLine(b)}`);
    case 'under-construction': return wrap(b, '', underConstruction(b, ctx));
    default: return wrap(b, 'blk-unknown', `<span class="todo" data-todo="unknown block type">TODO: content — unknown block [${esc(b.type)}]</span>${blockHead(b, ctx)}${md(body, ctx)}${srcLine(b)}`);
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
<link rel="stylesheet" href="/assets/site.css">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<script>try{var t=localStorage.getItem('brx-theme');if(t)document.documentElement.dataset.theme=t;}catch(e){}</script>
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ''}
</head>
<body class="${klass}">
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <button class="nav-toggle" aria-label="Open navigation" aria-expanded="false" data-nav-toggle>☰</button>
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
    ${breadcrumbs.length > 1 ? `<nav class="crumbs" aria-label="Breadcrumb">${crumbs}</nav>` : ''}
    ${body}
  </main>
  ${toc ? `<aside class="toc" aria-label="On this page"><div class="toc-in"><p class="toc-h">On this page</p>${toc}</div></aside>` : ''}
</div>
<footer class="foot">
  <p>Protocol discovered by <a href="https://github.com/LaserTagMods" rel="noopener">LaserTagMods</a> (JEDGE / JBOX) · Hardware by Battle Company · Fixes by the owner community.</p>
  <p>Open BRX is an independent open-source project and is not affiliated with or endorsed by Battle Company. MIT licence. <a href="/credits/">Credits &amp; sourcing</a> · <a href="/changelog/">Changelog</a> · <a href="/llms.txt">llms.txt</a> · <a href="${REPO_URL}" rel="noopener">GitHub</a></p>
</footer>
<div class="search-modal" data-search-modal hidden><div class="search-box" role="dialog" aria-label="Search"><input type="search" data-search-input placeholder="Search pages, headings, weapons, sound ids, commands…" autocomplete="off"><div class="search-results" data-search-results aria-live="polite"><p class="muted">Type to search.</p></div><p class="search-hint">Esc to close</p></div></div>
<script src="/assets/site.js" defer></script>
</body>
</html>`;
}

export function pageBody(page, ctx, extras = {}) {
  const blocks = page.blocks.map(b => extras.replaceBlock?.(b) ?? renderBlock(b, ctx)).join('\n');
  const prov = new Set(page.blocks.flatMap(b => b.badges));
  const lv = page.section.lastVerified;
  return `<article class="page">
<header class="page-head">
<h1>${inline(page.title, ctx)}</h1>
${page.subtitle ? `<p class="subtitle">${inline(page.subtitle, ctx)}</p>` : ''}
<p class="meta">${[...prov].map(badge).join('')}${lv ? `<span class="lv">Last verified <time datetime="${lv}">${lv}</time></span>` : ''}<a class="md-link" href="${page.slug === '/' ? '/index' : page.slug}.md">View as Markdown</a></p>
</header>
${blocks}
${extras.after || ''}
</article>`;
}

export function tocFor(page) {
  const hs = page.blocks.filter(b => b.title && b.type !== 'under-construction').map(b => `<li><a href="#${slugify(b.title)}">${esc(b.title.replace(/[`*]/g, ''))}</a></li>`);
  const uc = page.blocks.filter(b => b.type === 'under-construction').map(b => { const t = b.title || b.head.split('—')[0]; return `<li><a href="#${slugify(t)}">${esc(t.replace(/[`*]/g, ''))}</a></li>`; });
  const all = [...hs, ...uc];
  return all.length >= 2 ? `<ol>${all.join('')}</ol>` : '';
}

export function markdownTwin(page) {
  const out = [`# ${page.title}`, page.subtitle ? `_${page.subtitle}_` : '', page.section.lastVerified ? `Last verified: ${page.section.lastVerified}` : '', ''];
  for (const b of page.blocks) {
    if (b.type === 'under-construction') { out.push(`## ${b.title || b.head} 🚧`, 'Under construction — details when it has run on real hardware.', ''); continue; }
    if (b.type === 'image' || b.type === 'diagram') { out.push(`_[${b.type} ${b.arg}: ${b.head || ''}]_`, ''); continue; }
    if (b.title) out.push(`## ${b.title}`);
    if (b.head) out.push(b.head);
    out.push(...b.body);
    if (b.src.length) out.push(`Source: ${b.src.join(' · ')}`);
    out.push('');
  }
  return out.join('\n');
}
