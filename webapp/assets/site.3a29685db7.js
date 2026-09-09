// Open BRX site. Three jobs: theme, copy buttons, the two generated tables.
(() => {
  'use strict';

  // The sticky header is ~60px wide-screen and ~184px at 390px, where the nav wraps. Publish the
  // measured height so heading anchors clear it instead of guessing a single number.
  const top = document.querySelector('.top');
  if (top) {
    const setH = () => document.documentElement.style.setProperty('--header-h', top.offsetHeight + 'px');
    setH();
    if (window.ResizeObserver) new ResizeObserver(setH).observe(top);
    else addEventListener('resize', setH);
  }

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

    const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const cell = (v, r, key) => {
      if (v === null || v === undefined || v === '') return 'n/a';
      // an unconfirmed machine transcription is marked, not passed off as a known meaning
      if (key === 'meaning' && r.heard === false) return `<i class="unheard">${esc(v)}</i>`;
      return esc(v);
    };
    const render = () => {
      const q = search.value.trim().toLowerCase();
      const hits = q ? rows.filter(r => cols.some(c => String(r[c[0]] ?? '').toLowerCase().includes(q))) : rows;
      if (!hits.length) {
        body.innerHTML = `<tr><td colspan="${cols.length}">Nothing matches ${esc(JSON.stringify(q))}.</td></tr>`;
        count.textContent = `0 of ${rows.length} rows`;
        return;
      }
      body.innerHTML = hits.slice(0, shown)
        .map(r => `<tr>${cols.map(c => `<td>${cell(r[c[0]], r, c[0])}</td>`).join('')}</tr>`).join('');
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
        body.innerHTML = `<tr><td colspan="${cols.length}">This table could not load (${esc(err.message)}). The data file is at <code>/data/${esc(key)}.json</code>.</td></tr>`;
      });
  }
  // ---- search ----
  // These pages run long, so a result must land on a HEADING, not a page. And what people look up
  // in a protocol reference is a symbol: an exact identifier hit outranks everything else.
  const form = document.querySelector('.find');
  if (form) {
    const input = form.querySelector('#q');
    const panel = form.querySelector('#results');
    let rows = null, active = -1, items = [];

    // memoise the PROMISE, not the rows: typing "$WEAP" fired four concurrent fetches of the whole
    // index, and whichever landed last won.
    let loading = null;
    const load = () => rows ? Promise.resolve(rows) : (loading ||= fetch('/data/search.json')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => (rows = d.map(r => ({ ...r, lb: flat(r.b || '') }))))
      .catch(err => { rows = []; panel.innerHTML = `<p class="r-none">Search could not load (${esc(err.message)}).</p>`; return rows; }));

    // must escape the double quote too: these values land in href="..." as well as in text, and
    // without it an index entry could close the attribute and add an event handler.
    const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    // Offsets must come from a string the SAME LENGTH as the one being sliced. Stripping
    // apostrophes to find the index shifted every highlight left by one character per apostrophe
    // before it, so "the gun's headset" highlighted " headse".
    const soft = t => String(t).toLowerCase().replace(/['\u2019]/g, '\u0000');
    const mark = (t, q) => {
      const i = soft(t).indexOf(q.replace(/['\u2019]/g, '\u0000'));
      if (i < 0) return esc(t);
      return `${esc(t.slice(0, i))}<mark>${esc(t.slice(i, i + q.length))}</mark>${esc(t.slice(i + q.length))}`;
    };

    // A section that DEFINES a symbol beats one that merely mentions it, so the heading is checked
    // first. Otherwise "$WEAP" ranked an audio page above "$WEAP: the weapon definition".
    const flat = t => String(t).toLowerCase().replace(/['\u2019]/g, '');
    // Show the sentence that matched, not the section's first line.
    const snippet = (r, q) => {
      const body = r.b || '';
      if (!body) return '';
      const i = soft(body).indexOf(q.replace(/['\u2019]/g, '\u0000'));
      if (i < 0) return `<span class="r-t">${esc(body.slice(0, 110))}</span>`;
      const from = Math.max(0, i - 42);
      const cut = body.slice(from, from + 150);
      return `<span class="r-t">${from ? '&hellip;' : ''}${mark(cut, q)}&hellip;</span>`;
    };

    const score = (r, q) => {
      const h = flat(r.h);
      const ids = ' ' + r.x.toLowerCase() + ' ';
      if (h === q) return 0;
      if (h.includes(q)) return 1;                          // "$WEAP: the weapon definition"
      if (ids.includes(' ' + q + ' ')) return 2;            // exact symbol in the body
      if (r.x.toLowerCase().includes(q)) return 3;          // partial symbol
      if (r.lb.includes(q)) return 4;
      return 99;
    };
    // Tie-break: the section that says it MOST is the one that is about it.
    // Ties are common for a symbol that two pages mention. The section that is ABOUT symbols
    // carries dozens of them; a passing mention carries one. So: how often it says the word,
    // then how symbol-dense the section is. That puts "t14" on the $WEAP token map rather than
    // on a voice-pack table that happens to name it once.
    const weight = (r, q) => {
      const hits = (flat(r.x) + ' ' + r.lb).split(q).length - 1;
      const density = Math.min(r.x ? r.x.split(' ').length : 0, 40);
      return -(hits * 1000 + density);
    };

    // Multi-word: every word must appear somewhere in the section. "headset pairing" found nothing
    // when it was treated as one literal string.
    const scoreQuery = (r, q) => {
      const words = q.split(/\s+/).filter(Boolean);
      if (words.length < 2) return score(r, q);
      const hay = flat(r.h + ' ' + r.x) + ' ' + r.lb;
      if (!words.every(w => hay.includes(w))) return 99;
      return flat(r.h).includes(q) ? 1 : 3;
    };

    const render = hits => {
      items = hits;
      active = hits.length ? 0 : -1;
      if (!hits.length) {
        panel.innerHTML = `<p class="r-none">Nothing matches ${esc(JSON.stringify(input.value.trim()))}.</p>`;
      } else {
        const q = input.value.trim().toLowerCase();
        panel.innerHTML = hits.map((r, i) => `<a role="option" href="${esc(r.u)}" id="r${i}"${i === 0 ? ' aria-selected="true" class="on"' : ' aria-selected="false"'}>
          <span class="r-h">${mark(r.h, q)}</span><span class="r-p">${esc(r.p)}</span>
          ${snippet(r, q)}</a>`).join('');
      }
      panel.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      // Only on CHANGE: setting the same text is still a mutation and most screen readers
      // re-announce it, so typing "shield" said "12 results" five times.
      const live = document.getElementById('find-live');
      const msg = hits.length ? `${hits.length} result${hits.length === 1 ? '' : 's'}` : 'No results';
      if (live && live.textContent !== msg) live.textContent = msg;
    };

    const close = () => {
      panel.hidden = true; active = -1; items = [];
      const live = document.getElementById('find-live');
      if (live) live.textContent = '';   // otherwise it keeps announcing a count for a closed list
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    };

    const move = d => {
      if (!items.length) return;
      active = (active + d + items.length) % items.length;
      [...panel.children].forEach((el, i) => {
        const on = i === active;
        el.classList.toggle('on', on);
        el.setAttribute('aria-selected', String(on));
        if (on) { el.scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', el.id); }
      });
    };

    input.addEventListener('input', async () => {
      // drop apostrophes so "wont fire" finds "won't fire"
      const q = input.value.trim().toLowerCase().replace(/['\u2019]/g, '');
      if (q.length < 2) return close();
      const data = await load();
      // the box may have been cleared or retyped while the index was loading
      if (flat(input.value.trim()) !== q) return;
      if (!data.length) return;
      const hits = data.map(r => [scoreQuery(r, q), weight(r, q.split(/\s+/)[0]), r]).filter(([s]) => s < 99)
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, 12).map(([, , r]) => r);
      render(hits);
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter' && items[active]) { e.preventDefault(); location.href = items[active].u; }
      else if (e.key === 'Escape') {
        // preventDefault stops Chromium's native type=search clear, which wiped the query on the
        // FIRST Escape no matter what this handler decided.
        e.preventDefault();
        // first Escape closes the list and keeps the query and the focus; a second clears
        if (!panel.hidden) { close(); } else { input.value = ''; input.blur(); }
      }
    });

    document.addEventListener('click', e => { if (!form.contains(e.target)) close(); });
    // "/" jumps to search, the convention on a reference site; cmd-K too for the people who expect it
    document.addEventListener('keydown', e => {
      const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
      if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault(); input.focus(); input.select();
      }
    });
  }
})();
