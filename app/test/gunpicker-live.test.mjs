// F161 (field 2026-09-12): the HUD gun picker does not refresh live. A gun powered on while the list is
// open updates the RSSI bars of guns already listed, but a brand-new gun never gets a row of its own until
// "Set my gun" is tapped again (which re-opens the scan from a cleared picker).
//
// `hud.js`'s picker screen needs a real element tree (`_patchScan`/`_patchScanRows` walk `.idle .list`'s
// DOM, keyed on `dataset.arg`), so this file carries a tiny, purpose-built DOM: only the handful of tag/
// class selectors and node operations `hud.js`'s scan-patching code actually calls. It is not a general
// DOM shim -- app/package.json carries no jsdom, and this repo's house rule is small and mechanical over
// a new dependency for one test.
//
// The tree itself is built by PARSING `Hud.prototype._idle()`'s real output (below), not by hand-copying
// `_scanList()`'s markup: a hand-copy would silently drift from the real template (rename `.taggers` in
// hud.js and this suite would still pass against its own stale mirror) and prove nothing.
//
// NOT covered here: app.js's own dirty -> render wiring (`startPickerPaint`'s interval, `picker.dirty`,
// `hud.setScan`, `scheduleRender`). `app.js` is a boot-time IIFE with no exports (`bluetooth-picker.test.mjs`
// reads it as source text for the same reason), so this suite calls `hud._patchScan()` directly instead of
// going through that timer -- it proves the PAINT is correct once it happens, not that app.js schedules it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hud } from '../src/hud/hud.js';
import { GunPicker, COALESCE_MS } from '../src/gunpicker.js';
import { NUS } from '../src/brxlink.js';

// ---------- a minimal element tree, just enough for hud.js's scan-patching code ----------
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this._class = new Set();
    this.dataset = {};
    this.children = [];
    this.parentNode = null;
    this.hidden = false;
    this._text = '';
  }
  get className() { return [...this._class].join(' '); }
  set className(v) { this._class = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const c = this._class;
    return {
      contains: k => c.has(k),
      add: k => c.add(k),
      remove: k => c.delete(k),
      toggle: (k, force) => { const want = force === undefined ? !c.has(k) : !!force; if (want) c.add(k); else c.delete(k); return want; },
    };
  }
  get firstElementChild() { return this.children[0] || null; }
  get nextElementSibling() {
    if (!this.parentNode) return null;
    const i = this.parentNode.children.indexOf(this);
    return this.parentNode.children[i + 1] || null;
  }
  appendChild(el) { el.parentNode = this; this.children.push(el); return el; }
  insertBefore(el, ref) {
    if (el.parentNode) { const a = el.parentNode.children; const i = a.indexOf(el); if (i >= 0) a.splice(i, 1); }
    el.parentNode = this;
    const idx = ref == null ? -1 : this.children.indexOf(ref);
    if (idx < 0) this.children.push(el); else this.children.splice(idx, 0, el);
    return el;
  }
  remove() { if (!this.parentNode) return; const a = this.parentNode.children; const i = a.indexOf(this); if (i >= 0) a.splice(i, 1); this.parentNode = null; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return this._html || ''; }
  set innerHTML(html) { this._html = html; this.children = parseHtml(html); this.children.forEach(k => { k.parentNode = this; }); }
  querySelectorAll(sel) {
    const tokens = sel.trim().split(/\s+/);
    const last = tokens[tokens.length - 1], out = [];
    const walk = node => { for (const c of node.children) { if (matches(c, last)) out.push(c); walk(c); } };
    walk(this);
    if (tokens.length === 1) return out;
    const ancestors = tokens.slice(0, -1);
    return out.filter(el => {
      let ti = ancestors.length - 1, cur = el.parentNode;
      while (cur && ti >= 0) { if (matches(cur, ancestors[ti])) ti--; cur = cur.parentNode; }
      return ti < 0;
    });
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
function matches(el, token) {
  if (!el || !(el instanceof El)) return false;
  if (token.startsWith('.')) return el._class.has(token.slice(1));
  return el.tagName === token.toUpperCase();
}
/** A tiny stack-based tag parser: enough for hud.js's own scan-row/list markup (no self-closing tags,
 *  simple `name` / `name="value"` attributes, `class` and `data-*` and bare `hidden`). */
function parseHtml(html) {
  const root = { children: [] };
  const stack = [root];
  const re = /<\/([a-zA-Z0-9]+)\s*>|<([a-zA-Z0-9]+)((?:\s+[a-zA-Z-]+(?:="[^"]*")?)*)\s*>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    const [, closeTag, openTag, attrs, text] = m;
    if (text !== undefined) continue;   // this suite never reads text nodes back out
    if (closeTag) { stack.pop(); continue; }
    const el = new El(openTag);
    const attrRe = /([a-zA-Z-]+)(?:="([^"]*)")?/g;
    let am;
    while ((am = attrRe.exec(attrs || ''))) {
      const [, name, val] = am;
      if (name === 'class') el.className = val || '';
      else if (name === 'hidden') el.hidden = true;
      else if (name.startsWith('data-')) el.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = val;
    }
    stack[stack.length - 1].children.push(el);
    el.parentNode = stack[stack.length - 1] instanceof El ? stack[stack.length - 1] : null;
    stack.push(el);
  }
  return root.children;
}

/** Builds the picker's `.idle .list` structure by PARSING the real `Hud.prototype._idle()` output (which
 *  itself calls the real `_scanList()`) -- never a hand-copy of the markup, so a rename in hud.js shows up
 *  here as a missing box, not as a silently-stale mirror. */
function buildIdleScreen() {
  const src = Object.create(Hud.prototype);
  Object.assign(src, { bluetoothOn: true, locationOn: true });
  const html = Hud.prototype._idle.call(src, {});
  const hudEl = new El('div');
  hudEl.innerHTML = html;
  assert.ok(hudEl.querySelector('.idle .list .taggers'), '.idle .list .taggers is missing from the real _idle() markup -- the test DOM and hud.js have drifted apart');
  return hudEl;
}

/** A fake `Hud` instance: real prototype (so `_patchScan`/`_patchScanRows`/`_writeScanRow` run unmodified),
 *  hand-built data fields (no constructor, no real DOM). */
function fakeHud() {
  const hudEl = buildIdleScreen();
  const h = Object.create(Hud.prototype);
  Object.assign(h, { hudEl, root: { createElement: tag => new El(tag) }, scan: [], scanActive: true, scanOther: false, connecting: null });
  return h;
}
const rowIds = h => h.hudEl.querySelector('.taggers').children.map(el => el.dataset.arg);

test('F161: a gun discovered after the picker opens gets a row, with no re-open', () => {
  const picker = new GunPicker({ coalesceMs: COALESCE_MS });
  const hud = fakeHud();

  // The scan opens and finds one gun; the picker paints it, as SET MY GUN already does.
  picker.observe({ deviceId: 'gun1', name: 'ALPHA-FE30', rssi: -70, uuids: [NUS] });
  hud.scan = picker.list(); hud._patchScan();
  assert.deepEqual(rowIds(hud), ['gun1'], 'the first gun must be on screen before the second ever appears');

  // The list stays open. A second gun is switched on -- its adverts start arriving, and existing rows'
  // signal readings keep moving too, exactly as the field report describes.
  picker.observe({ deviceId: 'gun1', name: 'ALPHA-FE30', rssi: -68, uuids: [NUS] });   // gun1's bars move
  picker.observe({ deviceId: 'gun2', name: 'BRAVO-9498', rssi: -74, uuids: [NUS] });    // gun2 powers on
  assert.equal(picker.dirty, true, 'a brand-new device must mark the picker dirty');
  hud.scan = picker.list(); hud._patchScan();

  assert.deepEqual(rowIds(hud), ['gun1', 'gun2'], 'gun2 must appear as its own row without "Set my gun" being tapped again');
  const row2 = hud.hudEl.querySelector('.taggers').children[1];
  assert.equal(row2.querySelector('.sig b').textContent, '-74', 'the new row must show its own reading, not gun1\'s');
});

test('F161 control: gun1 keeps its row and place while only its signal reading changes', () => {
  let t = 0;
  const picker = new GunPicker({ now: () => t, coalesceMs: COALESCE_MS });
  const hud = fakeHud();
  picker.observe({ deviceId: 'gun1', name: 'ALPHA-FE30', rssi: -70, uuids: [NUS] });
  hud.scan = picker.list(); hud._patchScan();
  const before = hud.hudEl.querySelector('.taggers').children[0];

  t += COALESCE_MS + 1;   // past the coalesce window, so this reading is not the one it drops (gunpicker.test.mjs)
  picker.observe({ deviceId: 'gun1', name: 'ALPHA-FE30', rssi: -55, uuids: [NUS] });
  hud.scan = picker.list(); hud._patchScan();

  const after = hud.hudEl.querySelector('.taggers').children[0];
  assert.equal(after, before, 'an RSSI-only update must patch the same row node, never replace it');
  assert.equal(after.querySelector('.sig b').textContent, '-55');
});

// Mirrors gunpicker.test.mjs's own bench room: two taggers already on screen (at ranks 7 and 12 of a room
// full of televisions before F258, now the first two rows), then a THIRD tagger powers on live.
test('F161: a third gun found in a busy, already-open room still gets its own row', () => {
  const picker = new GunPicker({ coalesceMs: COALESCE_MS });
  const hud = fakeHud();
  const thing = (name, id, rssi) => ({ deviceId: id, name, rssi, uuids: ['0000fe9f-0000-1000-8000-00805f9b34fb'] });
  const tagger = (name, id, rssi) => ({ deviceId: id, name, rssi, uuids: [NUS] });
  for (const hit of [thing('Samsung Q80 TV', 'tv1', -41), thing('Hatch Rest', 'hatch', -48),
                      tagger('ALPHA-FE30', 'gun1', -70), tagger('BRAVO-9498', 'gun2', -74)]) picker.observe(hit);
  hud.scan = picker.list(); hud._patchScan();
  assert.deepEqual(rowIds(hud), ['gun1', 'gun2'], 'only the two taggers are in the main box, TVs go behind the fold');

  picker.observe(tagger('CHARLIE-E20D', 'gun3', -60));   // a third gun powers on, list still open
  hud.scan = picker.list(); hud._patchScan();

  assert.deepEqual(rowIds(hud), ['gun1', 'gun2', 'gun3'], 'gun3 must join the other two live rows');
  assert.equal(hud.hudEl.querySelector('.others').children.length, 2, 'the TVs stay folded and untouched');
});
