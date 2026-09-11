// The LANDING layout: plain markdown in, a marketing page out. The markdown carries no DSL; the
// shapes below are ordinary CommonMark and the renderer reads structure, not markers.
// (docs/site/FORMAT.md "Landing pages" is the contract; this file is its implementation.)
//
//   # Title                      hero headline
//   first paragraph              hero lede
//   list of links                buttons (first is primary)
//   image                        photo (under /photos/) or screenshot (under /shots/)
//   ## Short name                a section: eyebrow + anchor
//   ### Big headline             the section's h2 on the page
//   paragraph of only images     a row of shots (1 = wide, 2-3 = a row)
//   list of **Bold lead.** items a caption grid
//   fenced code, no language     a terminal panel
//   ```data <keyword>```         a generated component (counts, modes, roles, manual, release)
import { marked } from 'marked';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = s => s.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const inline = tokens => marked.Parser.parseInline(tokens);
const isImagePara = t => t.type === 'paragraph' && t.tokens.every(x => x.type === 'image' || (x.type === 'text' && !x.text.trim()));
const isLinkList = t => t.type === 'list' && t.items.every(i => i.tokens.length === 1 && i.tokens[0].tokens?.length === 1 && i.tokens[0].tokens[0].type === 'link');
const isCaptionList = t => t.type === 'list' && t.items.every(i => i.tokens[0]?.tokens?.[0]?.type === 'strong');

// Photos are staged shots of the gear; screenshots are generated from the UIs. Different frames.
const kindOf = href => href.startsWith('/photos/') ? 'photo' : 'shot';

function figure(img, ctx, cls = '') {
  const href = ctx.asset(img.href);       // content-hashed by the build
  const kind = kindOf(img.href);
  const dims = ctx.dims(img.href);        // {w,h} so the browser reserves space and nothing jumps
  const size = dims ? ` width="${dims.w}" height="${dims.h}"` : '';
  // a phone-landscape screenshot reads as a device, whatever pixel density it was captured at
  const phone = dims && dims.w / dims.h > 2 ? ' phone' : '';
  return `<figure class="${kind}${cls ? ' ' + cls : ''}${phone}"><img src="${esc(href)}" alt="${esc(img.text)}"${size} loading="lazy" decoding="async"></figure>`;
}

function shots(t, ctx, inHero) {
  const imgs = t.tokens.filter(x => x.type === 'image');
  // the hero can be two real screens composed as one product shot: the console large, the phone over it
  if (inHero && imgs.length === 2) return `<div class="hero-duo" data-reveal>${figure(imgs[0], ctx, 'duo-main')}${figure(imgs[1], ctx, 'duo-phone')}</div>`;
  if (imgs.length === 1) return figure(imgs[0], ctx, 'wide');
  return `<div class="row row-${imgs.length}" data-reveal>${imgs.map(i => figure(i, ctx)).join('')}</div>`;
}

function buttons(t) {
  return `<div class="cta" data-reveal>${t.items.map((it, i) => {
    const l = it.tokens[0].tokens[0];
    return `<a class="btn ${i === 0 ? 'btn-acc' : 'btn-line'}" href="${esc(l.href)}">${inline(l.tokens)}</a>`;
  }).join('')}</div>`;
}

function captions(t) {
  return `<ul class="caps" data-reveal>${t.items.map(it => `<li>${inline(it.tokens[0].tokens)}</li>`).join('')}</ul>`;
}

// A terminal: `$ ` and `> ` are prompts, `# ` is a comment, anything else is output.
function terminal(t) {
  const lines = t.text.split('\n').map(l => {
    if (/^\$ /.test(l)) return `<span class="t-p">$</span> ${esc(l.slice(2))}`;
    if (/^> /.test(l)) return `<span class="t-p">&gt;</span> ${esc(l.slice(2))}`;
    if (/^# /.test(l)) return `<span class="t-c">${esc(l)}</span>`;
    if (!l.trim()) return '';
    return `<span class="t-o">${esc(l)}</span>`;
  });
  return `<pre class="term" data-reveal aria-label="Terminal session">${lines.map((l, i) => `<span class="t-l" style="--i:${i}">${l}</span>`).join('\n')}</pre>`;
}

// ---- generated components ----
const DATA = {
  counts(ctx) {
    const f = ctx.facts;
    const one = (n, label) => `<div class="count" data-reveal><b data-n="${n}">${n.toLocaleString('en-US')}</b><span>${label}</span></div>`;
    return `<div class="counts">${one(f.modes.length, 'game modes')}${one(f.roles.total, 'weapons')}${one(f.sounds, 'sounds on the tagger')}</div>`;
  },
  modes(ctx) {
    const colour = { tdm: '#39b4ff', ffa: '#e8eef5', infection: '#2ecc71', lms: '#ffb020', extraction: '#ff8c42', koth: '#c48bff' };
    return `<ul class="tiles" data-reveal>${ctx.facts.modes.map(m => `<li class="tile${m.proven ? '' : ' wip'}"><span class="abbr" style="color:${colour[m.id] || '#8aa0b4'}">${esc(m.abbr)}</span><span class="name">${esc(titleCase(m.name))}</span>${m.proven ? '' : '<span class="badge">In development</span>'}<p>${esc(m.brief)}</p></li>`).join('')}</ul>`;
  },
  roles(ctx) {
    return `<ul class="chips" data-reveal aria-label="Weapon classes">${ctx.facts.roles.roles.map(r => `<li class="chip" style="--c:${r.color}">${esc(titleCase(r.label))} <b>${r.n}</b></li>`).join('')}</ul>`;
  },
  manual(ctx) {
    return `<ul class="doors" data-reveal>${ctx.facts.manual.map(p => `<li><a class="door" href="${p.slug}/"><span class="t">${esc(p.nav)}</span><span class="s">${esc(p.blurb)}</span></a></li>`).join('')}</ul>`;
  },
  // the real phone HUD, live, in the phone frame: loads on tap so the page stays light
  huddemo(ctx) {
    const poster = ctx.asset('/shots/hud-kitted.jpg');
    return `<div class="huddemo shot phone" data-reveal data-src="/demo/hud/index.html?demo&kit" style="background-image:url('${esc(poster)}')">
<div class="huddemo-veil" aria-hidden="true"></div>
<button type="button" class="btn btn-acc huddemo-go">Try the HUD <span class="v">live</span></button>
<p class="huddemo-hint">The real app, running in your browser with a pretend tagger. Tap a plate to pick a weapon, then ready up.</p>
</div>`;
  },
  release(ctx) {
    const r = ctx.facts.release;
    return `<ul class="cards" data-reveal>
<li class="card c-app"><span class="eyebrow">Android</span><span class="name">BRX Companion</span><p>The HUD. One phone per tagger, mounted on the rail. iOS builds from source.</p><dl><dt>version</dt><dd>${esc(r.version)}</dd><dt>from</dt><dd><a href="${esc(r.releases)}">GitHub Releases</a></dd></dl><a class="btn btn-acc" href="/download/">Get the app <span class="v">v${esc(r.version)}</span></a></li>
<li class="card c-mc"><span class="eyebrow">Laptop</span><span class="name">Mission Control + brx-mcp</span><p>One Python package. The console, the command line and the MCP server.</p><pre class="term small"><span class="t-l"><span class="t-p">$</span> pip install -e ./mcp</span>
<span class="t-l"><span class="t-p">$</span> python -m brx_mcp.mc</span></pre><a class="btn btn-line" href="/docs/install/">Read the docs</a></li>
<li class="card c-src"><span class="eyebrow">Source</span><span class="name">GitHub</span><p>The whole platform, the protocol reference and the manual in one repository.</p><dl><dt>license</dt><dd>MIT</dd><dt>repo</dt><dd>tony99nyr/open-brx</dd></dl><a class="btn btn-line" href="${esc(ctx.github)}">Open on GitHub</a></li>
</ul>`;
  },
};
const titleCase = s => s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\bOf\b/g, 'of').replace(/\bThe\b/g, 'the').replace(/^the/, 'The');

/**
 * Render a landing page body. `ctx` supplies: asset(href) -> hashed URL, dims(href) -> {w,h}|null,
 * facts {modes, roles, sounds, manual, release}, github. Returns { html, sections:[{id,text}] }.
 */
export function renderLanding(body, ctx) {
  const toks = marked.lexer(body);
  const sections = [];
  let hero = { html: '' };
  let cur = null;     // current section
  let n = 0;
  const flush = () => { if (cur) { sections.push(cur); cur = null; } };
  const target = () => cur || hero;
  const push = html => { target().html += html + '\n'; };

  for (const t of toks) {
    if (t.type === 'space') continue;
    if (t.type === 'heading' && t.depth === 2) {
      flush();
      n += 1;
      const text = inline(t.tokens);
      cur = { id: slugify(text), eyebrow: `${String(n).padStart(2, '0')} · ${text}`, text, headline: null, html: '', photo: null };
      continue;
    }
    if (t.type === 'heading' && t.depth === 3 && cur && !cur.headline) { cur.headline = inline(t.tokens); continue; }
    if (t.type === 'heading') { push(`<h${t.depth}>${inline(t.tokens)}</h${t.depth}>`); continue; }
    if (isImagePara(t)) {
      const imgs = t.tokens.filter(x => x.type === 'image');
      // a photo that OPENS a section becomes its backdrop; a photo after the copy is shown whole
      if (cur && imgs.length === 1 && kindOf(imgs[0].href) === 'photo' && cur.html.trim() === '') { cur.photo = imgs[0]; continue; }
      push(shots(t, ctx, !cur));
      continue;
    }
    if (isLinkList(t)) { push(buttons(t)); continue; }
    if (isCaptionList(t)) { push(captions(t)); continue; }
    if (t.type === 'code' && t.lang === 'data') {
      const key = t.text.trim();
      if (!DATA[key]) throw new Error(`landing: unknown data component "${key}"`);
      push(DATA[key](ctx));
      continue;
    }
    if (t.type === 'code') { push(terminal(t)); continue; }
    if (t.type === 'paragraph') {
      // the first paragraph of the hero or a section is its lede
      const tgt = target();
      const cls = tgt.lede ? 'copy' : 'lede';
      tgt.lede = true;
      push(`<p class="${cls}" data-reveal>${inline(t.tokens)}</p>`);
      continue;
    }
    push(marked.parser([t]));
  }
  flush();

  const heroHtml = `<section class="hero">${hero.html}</section>`;
  const secs = sections.map(s => {
    const head = `<div class="feat-head"><p class="eyebrow" data-reveal>${s.eyebrow}</p><h2 id="${s.id}" data-reveal>${s.headline || s.text}</h2></div>`;
    if (s.photo) {
      return `<section class="feat backdrop" aria-labelledby="${s.id}">${figure(s.photo, ctx, 'bg')}<div class="over">${head}${s.html}</div></section>`;
    }
    // a single wide shot followed by captions is the pinned layout: the shot holds while the captions scroll
    const pin = /^<figure class="shot wide">[\s\S]*?<\/figure>\n<ul class="caps"/.test(s.html.replace(/^<p class="lede"[\s\S]*?<\/p>\n/, ''));
    // the pinned shot lives in its own grid cell, so `position: sticky` is bounded by that cell and
    // the shot lets go before the row beneath it, instead of sticking over it
    const html = pin ? s.html.replace(/(<figure class="shot wide">[\s\S]*?<\/figure>)/, '<div class="pin-shot">$1</div>') : s.html;
    return `<section class="feat${pin ? ' pin' : ''}" aria-labelledby="${s.id}">${head}${html}</section>`;
  }).join('\n');
  return { html: heroHtml + '\n' + secs, sections: sections.map(s => ({ id: s.id, text: s.text })) };
}
