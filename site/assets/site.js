/* Open BRX site: progressive enhancement. Every control here visibly responds; errors are shown, never swallowed. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ---- theme ----
  const themeBtn = $('[data-theme-toggle]');
  // Only 'dark' and 'light' are themes. A stale or hand-edited localStorage value used to land in
  // data-theme verbatim, which rendered light but made the first click a no-op.
  const clean = t => (t === 'dark' || t === 'light' ? t : '');
  const current = () => clean(document.documentElement.dataset.theme) || 'light';
  const applyTheme = t => {
    document.documentElement.dataset.theme = clean(t);
    // aria-pressed on a "toggle theme" label reads backwards; name the action instead
    themeBtn?.setAttribute('aria-label', current() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    themeBtn?.removeAttribute('aria-pressed');
  };
  applyTheme(document.documentElement.dataset.theme);
  themeBtn?.addEventListener('click', () => { const t = current() === 'light' ? 'dark' : 'light'; applyTheme(t); try { localStorage.setItem('brx-theme', t); } catch {} });

  // ---- mobile nav ----
  const navBtn = $('[data-nav-toggle]');
  const setNav = open => { document.body.classList.toggle('nav-open', open); navBtn?.setAttribute('aria-expanded', String(open)); navBtn?.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation'); };
  navBtn?.addEventListener('click', () => setNav(!document.body.classList.contains('nav-open')));
  document.addEventListener('click', e => { if (document.body.classList.contains('nav-open') && !e.target.closest('.side, [data-nav-toggle]')) setNav(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('nav-open')) setNav(false); });

  // ---- copy buttons on code blocks ----
  $$('pre').forEach(pre => {
    const wrap = document.createElement('div'); wrap.className = 'code-wrap';
    pre.parentNode.insertBefore(wrap, pre); wrap.appendChild(pre);
    const b = document.createElement('button'); b.type = 'button'; b.className = 'copy-btn'; b.textContent = 'copy'; b.setAttribute('aria-label', 'Copy code');
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(pre.querySelector('code')?.innerText ?? pre.innerText); b.textContent = 'copied'; b.dataset.done = '1'; }
      catch (err) { b.textContent = 'copy failed'; b.dataset.done = ''; console.error(err); }
      setTimeout(() => { b.textContent = 'copy'; delete b.dataset.done; }, 1800);
    });
    wrap.appendChild(b);
  });

  // ---- in-page table filter + sort (data-table blocks) ----
  $$('.dt').forEach(dt => {
    const input = $('input', dt), count = $('.dt-count', dt), table = $('table', dt);
    if (!table) return;
    const rows = $$('tbody tr', table);
    const empty = document.createElement('tr'); empty.className = 'dt-empty'; empty.hidden = true; empty.innerHTML = `<td colspan="${table.tHead?.rows[0]?.cells.length || 1}" class="muted">No rows match.</td>`; table.tBodies[0].appendChild(empty);
    const apply = () => { const q = input.value.trim().toLowerCase(); let n = 0; rows.forEach(r => { const hit = !q || r.innerText.toLowerCase().includes(q); r.hidden = !hit; if (hit) n++; }); empty.hidden = n > 0; count.textContent = q ? `${n} of ${rows.length} rows` : `${rows.length} rows`; };
    input.addEventListener('input', apply);
    sortable(table);
  });
  function sortable(table) {
    $$('thead th', table).forEach((th, i) => {
      th.dataset.sort = '1'; th.tabIndex = 0; th.setAttribute('aria-sort', 'none');
      const go = () => {
        const dir = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
        $$('thead th', table).forEach(x => x.setAttribute('aria-sort', 'none')); th.setAttribute('aria-sort', dir);
        const tb = table.tBodies[0]; const rs = [...tb.rows].filter(r => !r.classList.contains('dt-empty'));
        const val = r => (r.cells[i]?.innerText || '').trim(); const num = s => Number(s.replace(/[^0-9.-]/g, ''));
        rs.sort((a, b) => { const x = val(a), y = val(b); const nx = num(x), ny = num(y); const c = (x !== '' && y !== '' && !isNaN(nx) && !isNaN(ny) && /^[-\d.,\s%]+$/.test(x) && /^[-\d.,\s%]+$/.test(y)) ? nx - ny : x.localeCompare(y); return dir === 'ascending' ? c : -c; });
        rs.forEach(r => tb.appendChild(r));
      };
      th.addEventListener('click', go); th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  }

  // ---- TOC active state ----
  const tocLinks = $$('.toc a'); if (tocLinks.length && 'IntersectionObserver' in window) {
    const map = new Map(tocLinks.map(a => [a.getAttribute('href').slice(1), a]));
    const io = new IntersectionObserver(es => { es.forEach(e => { if (e.isIntersecting) { tocLinks.forEach(a => a.classList.remove('active')); map.get(e.target.id)?.classList.add('active'); } }); }, { rootMargin: '-10% 0px -70% 0px' });
    map.forEach((a, id) => { const h = document.getElementById(id); if (h) io.observe(h); });
  }

  // ---- search (⌘K) ----
  const modal = $('[data-search-modal]'), sInput = $('[data-search-input]'), sRes = $('[data-search-results]');
  let index = null, loadErr = null;
  const box = $('.search-box', modal);
  let lastFocus = null;
  box?.setAttribute('aria-modal', 'true');
  const openSearch = async () => { lastFocus = document.activeElement; modal.hidden = false; document.body.classList.add('modal-open'); sInput.value = ''; sInput.focus(); if (!index && !loadErr) { sRes.innerHTML = '<p class="muted">Loading index…</p>'; try { index = await (await fetch('/data/search.json')).json(); runSearch(); } catch (e) { loadErr = e; sRes.innerHTML = '<p class="x-error">Search index failed to load. Reload the page to retry.</p>'; } } };
  const closeSearch = () => { modal.hidden = true; document.body.classList.remove('modal-open'); lastFocus?.focus?.(); lastFocus = null; };
  // Tab must cycle inside the dialog: without this it walked onto the links behind the overlay
  modal?.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const f = [sInput, ...$$('a', sRes)].filter(el => el && el.offsetParent !== null);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    else if (i < 0) { e.preventDefault(); f[0].focus(); }
  });
  $('[data-search-open]')?.addEventListener('click', openSearch);
  document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); modal.hidden ? openSearch() : closeSearch(); } if (e.key === 'Escape' && !modal.hidden) closeSearch(); });
  sInput?.addEventListener('keydown', e => {
    const links = $$('a', sRes); if (!links.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); links[0].focus(); }
    if (e.key === 'Enter') { e.preventDefault(); links[0].click(); }
  });
  sRes?.addEventListener('keydown', e => {
    const links = $$('a', sRes); const i = links.indexOf(document.activeElement); if (i < 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); (links[i + 1] || links[0]).focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (i === 0 ? sInput : links[i - 1]).focus(); }
  });
  modal?.addEventListener('click', e => { if (e.target === modal) closeSearch(); });
  function runSearch() {
    const fold = s => String(s).toLowerCase().replace(/[’'`]/g, '');
    if (!index) return; const q = fold(sInput.value.trim()); if (!q) { sRes.innerHTML = '<p class="muted">Type to search.</p>'; return; }
    const terms = q.split(/\s+/);
    const score = p => { const t = fold(p.title), s = fold(p.subtitle || ''), h = fold(p.heads.join(' ')), r = fold(p.terms.join(' ')); let sc = 0; for (const w of terms) { if (t.includes(w)) sc += 10; if (s.includes(w)) sc += 4; if (h.includes(w)) sc += 3; if (r.includes(w)) sc += 2; if (!(t + s + h + r).includes(w)) return 0; } return sc; };
    const hits = index.map(p => [score(p), p]).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, 12);
    sRes.innerHTML = hits.length ? hits.map(([, p]) => { const term = p.terms.find(x => terms.some(w => fold(x).includes(w))); return `<a href="${esc(p.url)}"><div class="s">${esc(p.section)}</div><div class="t">${esc(p.title)}</div><div class="sub">${esc(term ? `matches “${term}” · ` : '')}${esc(p.subtitle)}</div></a>`; }).join('') : `<p class="muted">No results for “${esc(q)}”.</p>`;
  }
  sInput?.addEventListener('input', runSearch);

  // ---- explorers ----
  $$('[data-explorer]').forEach(ex => {
    const kind = ex.dataset.explorer, src = ex.dataset.src;
    const search = $('[data-x-search]', ex), chips = $('[data-x-chips]', ex), count = $('[data-x-count]', ex), err = $('[data-x-error]', ex), table = $('[data-x-table]', ex), more = $('[data-x-more]', ex), moreBtn = $('[data-x-more-btn]', ex), dock = $('[data-x-dock]', ex);
    let rows = [], facet = 'all', limit = 300, picked = [], sortCol = -1, sortDir = 1, evicted = null;
    const cfg = kind === 'weapons' ? {
      facetKey: 'role', facets: r => r.role, cols: [
        ['', r => `<label class="pick"><input type="checkbox" aria-label="Compare ${esc(r.name ?? r.id)}" data-pick="${esc(r.id)}"${picked.includes(r.id) ? ' checked' : ''}></label>`, null],
        ['Weapon', r => `<strong>${esc(r.name ?? 'n/a')}</strong>${r.behaviour ? `<br><span class="muted">${esc(r.behaviour)}</span>` : ''}`, r => r.name ?? ''],
        ['Class', r => r.role ? esc(r.role) : dash(), r => r.role ?? ''], ['Damage', r => n(r.dmg), r => r.dmg], ['Cycle ms', r => n(r.cycle_ms), r => r.cycle_ms], ['Mag', r => n(r.mag), r => r.mag], ['Reserve', r => n(r.reserve), r => r.reserve], ['Reload ms', r => n(r.reload_ms), r => r.reload_ms], ['Heat', r => n(r.heat), r => r.heat], ['Sound', r => r.sound ? `<code>${esc(r.sound)}</code>` : dash(), r => r.sound ?? ''],
      ], key: r => `${r.name ?? ''} ${r.role ?? ''} ${r.behaviour || ''} ${r.sound || ''}`,
    } : {
      facetKey: 'family', facets: r => r.family, cols: [
        ['ID', r => `<strong>${esc(r.id ?? 'n/a')}</strong>`, r => r.id ?? ''], ['Family', r => `${r.family ? esc(r.family) : dash()}${r.family_meaning ? `<br><span class="muted">${esc(r.family_meaning)}</span>` : ''}`, r => r.family ?? ''],
        ['Meaning', r => r.meaning_known && r.meaning ? esc(r.meaning) : `<span class="unknown">not yet identified</span>`, r => r.meaning ?? ''], ['Length s', r => n(r.len), r => r.len], ['File', r => r.file ? `<code>${esc(r.file)}</code>` : dash(), r => r.file ?? ''],
        ['Play', r => r.play ? `<button type="button" class="x-cell-copy" data-copy="${esc(r.play)}" aria-label="Copy ${esc(r.play)}">copy $PLAY</button>` : dash(), null],
      ], key: r => `${r.id ?? ''} ${r.family ?? ''} ${r.family_meaning ?? ''} ${r.meaning ?? ''}`,
    };
    function n(v) { return v == null || v === '' || Number.isNaN(v) ? dash() : `<span class="num">${esc(v)}</span>`; }
    // the house style has no em dash, so a missing value reads as n/a
    function dash() { return '<span class="unknown">n/a</span>'; }
    const filtered = () => {
      const q = search.value.trim().toLowerCase();
      const f = rows.filter(r => (facet === 'all' || cfg.facets(r) === facet) && (!q || cfg.key(r).toLowerCase().includes(q)));
      const get = cfg.cols[sortCol]?.[2];
      if (get) f.sort((a, b) => { const x = get(a), y = get(b); const nx = typeof x === 'number', ny = typeof y === 'number'; const c = nx && ny ? x - y : nx ? -1 : ny ? 1 : String(x ?? '').localeCompare(String(y ?? '')); return c * sortDir; });
      return f;
    };
    function render() {
      const f = filtered(); const show = f.slice(0, limit);
      table.tHead.innerHTML = `<tr>${cfg.cols.map((c, i) => c[2] ? `<th data-sort="1" tabindex="0" aria-sort="${sortCol === i ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'}" data-col="${i}">${esc(c[0])}</th>` : `<th>${esc(c[0])}</th>`).join('')}</tr>`;
      table.tBodies[0].innerHTML = show.map(r => `<tr${picked.includes(r.id) ? ' class="picked"' : ''}>${cfg.cols.map(c => `<td>${c[1](r)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cfg.cols.length}" class="muted">No matches.</td></tr>`;
      count.textContent = show.length < f.length ? `${f.length} of ${rows.length} match · showing ${show.length}` : `${f.length} of ${rows.length} shown`;
      more.hidden = f.length <= limit; if (!more.hidden) moreBtn.textContent = `Show more (${f.length - limit} hidden)`;
      renderDock();
    }
    let dockKey = null;
    function renderDock() {
      if (kind !== 'weapons') { dock.hidden = true; return; }
      dock.hidden = false;
      dock.classList.toggle('empty', picked.length === 0);
      // it is aria-live: rewriting identical markup on every keystroke re-announced the whole dock
      const key = picked.join(',') + '|' + (evicted || '');
      if (key === dockKey) return;
      dockKey = key;
      const ws = picked.map(id => rows.find(r => r.id === id)).filter(Boolean);
      const clearBtn = '<button type="button" class="x-clear" data-x-clear>Clear picks</button>';
      const note = evicted ? `<span class="muted"> · ${esc(evicted)} was replaced</span>` : '';
      if (ws.length === 0) { dock.innerHTML = '<span class="muted">Tick two weapons to compare them side by side.</span>'; return; }
      if (ws.length === 1) { dock.innerHTML = `<strong>${esc(ws[0].name ?? ws[0].id)}</strong> picked. Tick one more to compare.${note} ${clearBtn}`; return; }
      const [a, b] = ws; const stat = [['Damage', 'dmg', 1], ['Cycle ms', 'cycle_ms', -1], ['Magazine', 'mag', 1], ['Reserve', 'reserve', 1], ['Reload ms', 'reload_ms', -1], ['Hits to kill', 'htk', -1], ['Time to kill ms', 'ttk_ms', -1]];
      const bar = (v, max, lead) => `<div class="bar${lead ? ' lead' : ''}"><i style="width:${max ? Math.round((v / max) * 100) : 0}%"></i></div>`;
      dock.innerHTML = `<div class="x-dock-bar"><strong>${esc(a.name ?? a.id)}</strong> vs <strong>${esc(b.name ?? b.id)}</strong>${note} ${clearBtn}</div><div class="cmp"><span class="k"></span><span class="h">${esc(a.name ?? a.id)}</span><span class="h">${esc(b.name ?? b.id)}</span>` + stat.map(([label, k, better]) => { const va = Number(a[k] ?? 0) || 0, vb = Number(b[k] ?? 0) || 0, max = Math.max(va, vb) || 1; const la = better > 0 ? va > vb : va < vb, lb = better > 0 ? vb > va : vb < va; return `<span class="k">${label}</span><span>${esc(va)}${bar(va, max, la)}</span><span>${esc(vb)}${bar(vb, max, lb)}</span>`; }).join('') + `</div><p class="muted" style="margin:8px 0 0">Values as sent by the app when each weapon was armed; green = better for that stat.</p>`;
    }
    async function load() {
      err.hidden = true; count.textContent = 'loading…';
      try { const res = await fetch(src); if (!res.ok) throw new Error(`HTTP ${res.status}`); const data = await res.json(); rows = kind === 'weapons' ? data.weapons : data.rows; }
      catch (e) { err.hidden = false; count.textContent = 'failed'; table.tBodies[0].innerHTML = ''; console.error('explorer load failed', e); return; }
      const fs = [...new Set(rows.map(cfg.facets))].filter(Boolean).sort();
      chips.innerHTML = [`<button type="button" data-facet="all" aria-pressed="true">All</button>`, ...fs.map(f => `<button type="button" data-facet="${esc(f)}" aria-pressed="false">${esc(f)}</button>`)].join('');
      render();
    }
    // render() re-serialises thead/tbody, which destroys the focused node. Put the keyboard back on
    // the equivalent control, otherwise a sort or a pick throws the user to the top of the document.
    const refocus = sel => { const el = sel && $(sel, ex); if (el) el.focus({ preventScroll: true }); };
    const sortBy = th => { const i = Number(th.dataset.col); sortDir = sortCol === i ? -sortDir : 1; sortCol = i; render(); refocus(`th[data-col="${i}"]`); };
    table.tHead.addEventListener('click', e => { const th = e.target.closest('th[data-col]'); if (th) sortBy(th); });
    table.tHead.addEventListener('keydown', e => { const th = e.target.closest('th[data-col]'); if (th && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sortBy(th); } });
    chips.addEventListener('click', e => { const b = e.target.closest('[data-facet]'); if (!b) return; facet = b.dataset.facet; $$('[data-facet]', chips).forEach(x => x.setAttribute('aria-pressed', String(x === b))); limit = 300; render(); });
    search.addEventListener('input', () => { limit = 300; render(); });
    moreBtn.addEventListener('click', () => { limit += 500; render(); });
    $('[data-x-retry]', ex).addEventListener('click', load);
    table.addEventListener('change', e => { const cb = e.target.closest('[data-pick]'); if (!cb) return; const id = cb.dataset.pick; evicted = null; if (cb.checked) { picked.push(id); if (picked.length > 2) { const gone = picked.shift(); evicted = rows.find(r => r.id === gone)?.name ?? gone; } } else picked = picked.filter(x => x !== id); render(); refocus(`[data-pick="${CSS.escape(id)}"]`); });
    dock.addEventListener('click', e => { if (e.target.closest('[data-x-clear]')) { picked = []; evicted = null; render(); } });
    table.addEventListener('click', async e => { const b = e.target.closest('[data-copy]'); if (!b) return; try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'copied'; b.dataset.done = '1'; } catch { b.textContent = 'copy failed'; } setTimeout(() => { b.textContent = 'copy $PLAY'; delete b.dataset.done; }, 1500); });
    load();
  });
})();
