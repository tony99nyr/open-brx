// Open BRX site. Three jobs: theme, copy buttons, the two generated tables.
(() => {
  'use strict';

  // ---- theme ----
  const root = document.documentElement;
  try { const t = localStorage.getItem('brx-theme'); if (t) root.dataset.theme = t; } catch {}
  document.querySelector('.theme')?.addEventListener('click', () => {
    const dark = root.dataset.theme === 'dark' ||
      (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('brx-theme', root.dataset.theme); } catch {}
  });

  // ---- copy buttons ----
  document.addEventListener('click', async e => {
    const b = e.target.closest('pre .copy');
    if (!b) return;
    const code = b.parentElement.querySelector('code');
    try { await navigator.clipboard.writeText(code.textContent); b.textContent = 'Copied'; }
    catch { b.textContent = 'Copy failed'; }
    setTimeout(() => { b.textContent = 'Copy'; }, 1500);
  });

  // ---- generated tables ----
  const COLS = {
    weapons: [
      ['name', 'Weapon'], ['role', 'Role'], ['dmg', 'Damage'], ['cycle_ms', 'Cycle ms'],
      ['mag', 'Mag'], ['reserve', 'Reserve'], ['reload_ms', 'Reload ms'],
      ['heat', 'Heat/shot'], ['sound', 'Fire sound'],
    ],
    sounds: [['id', 'Id'], ['family', 'Family'], ['len', 'Seconds'], ['meaning', 'Meaning'], ['play', 'Command']],
  };
  const PAGE = 200;

  for (const el of document.querySelectorAll('.dt')) {
    const key = el.dataset.table;
    const cols = COLS[key];
    const head = el.querySelector('[data-head]');
    const body = el.querySelector('[data-body]');
    const count = el.querySelector('[data-count]');
    const search = el.querySelector('[data-search]');
    let rows = [], shown = PAGE;

    head.innerHTML = `<tr>${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr>`;

    const cell = v => v === null || v === undefined || v === '' ? 'n/a' : String(v);
    const render = () => {
      const q = search.value.trim().toLowerCase();
      const hits = q ? rows.filter(r => cols.some(c => String(r[c[0]] ?? '').toLowerCase().includes(q))) : rows;
      if (!hits.length) {
        body.innerHTML = `<tr><td colspan="${cols.length}">Nothing matches ${JSON.stringify(q)}.</td></tr>`;
        count.textContent = `0 of ${rows.length} rows`;
        return;
      }
      body.innerHTML = hits.slice(0, shown)
        .map(r => `<tr>${cols.map(c => `<td>${cell(r[c[0]])}</td>`).join('')}</tr>`).join('');
      if (hits.length > shown) {
        body.insertAdjacentHTML('beforeend',
          `<tr><td colspan="${cols.length}"><button type="button" data-more>Show ${Math.min(PAGE, hits.length - shown)} more</button></td></tr>`);
      }
      // say how many are ON SCREEN, not just how many matched: "Show more" changes the first number
      const showing = Math.min(shown, hits.length);
      count.textContent = hits.length === rows.length
        ? `showing ${showing} of ${rows.length} rows`
        : `showing ${showing} of ${hits.length} matches (${rows.length} rows)`;
    };

    search.addEventListener('input', () => { shown = PAGE; render(); });
    body.addEventListener('click', e => {
      if (!e.target.closest('[data-more]')) return;
      shown += PAGE;
      render();
      // the button destroys itself on re-render, which dropped focus to <body>. On the LAST click
      // there is no next button, so fall back to the live count: focus should stay in the table.
      const next = body.querySelector('[data-more]');
      if (next) next.focus();
      else { count.setAttribute('tabindex', '-1'); count.focus(); }
    });

    fetch(`/data/${key}.json`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { rows = Array.isArray(d) ? d : []; render(); })
      .catch(err => {
        // never leave the reader with an empty box and no reason
        count.textContent = 'could not load';
        body.innerHTML = `<tr><td colspan="${cols.length}">This table could not load (${err.message}). The data file is at <code>/data/${key}.json</code>.</td></tr>`;
      });
  }
})();
