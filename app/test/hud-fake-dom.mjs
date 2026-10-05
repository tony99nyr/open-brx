// A small DOM stand-in for the HUD golden test: an HTML parser, the selectors the HUD uses, and the element API it calls.
// It is only as capable as the HUD needs. An unsupported selector throws, so a new HUD query cannot pass unseen.
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link']);
const kebab = s => s.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#'
  ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e] ?? m));
const escText = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

class Text {
  constructor(data) { this.data = data; this.parentNode = null; this.nodeType = 3; }
  get textContent() { return this.data; }
}

class Style {
  constructor() {
    const map = new Map();
    Object.defineProperty(this, '_map', { value: map });
    for (const [name, fn] of Object.entries({
      setProperty: (k, v) => { map.set(k, String(v)); },
      getPropertyValue: k => map.get(k) ?? '',
      removeProperty: k => { const v = map.get(k) ?? ''; map.delete(k); return v; },
    })) Object.defineProperty(this, name, { value: fn });
    return new Proxy(this, {
      get: (t, k) => (k in t ? t[k] : typeof k === 'string' ? (map.get(kebab(k)) ?? '') : undefined),
      set: (t, k, v) => { if (v === '' || v == null) map.delete(kebab(k)); else map.set(kebab(k), String(v)); return true; },
    });
  }
}

export class El {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase(); this.localName = tag.toLowerCase(); this.ownerDocument = doc;
    this.nodeType = 1; this.parentNode = null; this.childNodes = []; this._attrs = new Map(); this.style = new Style();
    this.value = ''; this.inert = false; this.listeners = {};
    const self = this;
    this.dataset = new Proxy({}, {
      get: (t, k) => (typeof k === 'string' && self._attrs.has('data-' + kebab(k)) ? self._attrs.get('data-' + kebab(k)) : undefined),
      set: (t, k, v) => { self._attrs.set('data-' + kebab(k), String(v)); return true; },
      deleteProperty: (t, k) => { self._attrs.delete('data-' + kebab(k)); return true; },
      has: (t, k) => self._attrs.has('data-' + kebab(String(k))),
    });
    const cl = this.classList = {
      contains: c => self._classes().includes(c),
      add: (...cs) => { const l = self._classes(); for (const c of cs) if (!l.includes(c)) l.push(c); self._attrs.set('class', l.join(' ')); },
      remove: (...cs) => { const l = self._classes().filter(c => !cs.includes(c)); if (l.length) self._attrs.set('class', l.join(' ')); else self._attrs.delete('class'); },
      toggle: (c, force) => { const has = self._classes().includes(c), want = force === undefined ? !has : !!force;
        if (want && !has) cl.add(c); else if (!want && has) cl.remove(c); return want; },
    };
    if (this.localName === 'template') this.content = new El('#fragment', doc);
  }
  _classes() { return (this._attrs.get('class') || '').split(/\s+/).filter(Boolean); }
  get className() { return this._attrs.get('class') || ''; }
  set className(v) { this._attrs.set('class', String(v)); }
  get id() { return this._attrs.get('id') || ''; }
  set id(v) { this._attrs.set('id', String(v)); }
  get hidden() { return this._attrs.has('hidden'); }
  set hidden(v) { if (v) this._attrs.set('hidden', ''); else this._attrs.delete('hidden'); }
  get attributes() { return [...this._attrs].map(([name, value]) => ({ name, value })); }
  getAttribute(n) { return this._attrs.has(n) ? this._attrs.get(n) : null; }
  hasAttribute(n) { return this._attrs.has(n); }
  setAttribute(n, v) { this._attrs.set(n, String(v)); }
  removeAttribute(n) { this._attrs.delete(n); }
  toggleAttribute(n, force) { const want = force === undefined ? !this._attrs.has(n) : !!force; if (want) this._attrs.set(n, this._attrs.get(n) ?? ''); else this._attrs.delete(n); return want; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get firstElementChild() { return this.children[0] || null; }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get nextElementSibling() { const p = this.parentNode; if (!p) return null; const s = p.children; return s[s.indexOf(this) + 1] || null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === this.ownerDocument.documentElement; }
  // `El.layout` is null (no layout) unless a test sets it to a function el -> height; then that element is "rendered".
  get offsetParent() { return El.layout && El.layout(this) ? this.parentNode : null; }
  get offsetHeight() { return (El.layout && El.layout(this)) || 0; } get offsetWidth() { return 0; }
  get scrollWidth() { return 0; } get clientWidth() { return 0; } get scrollHeight() { return 0; } get clientHeight() { return 0; }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { this._clear(); if (String(v) !== '') this._add(new Text(String(v))); }
  get innerHTML() { return this.childNodes.map(n => (n.nodeType === 3 ? escText(n.data) : n.outerHTML)).join(''); }
  set innerHTML(html) {
    const target = this.content || this;
    target._clear();
    for (const n of parse(String(html), this.ownerDocument)) target._add(n);
  }
  get outerHTML() {
    const tag = this.localName, attrs = [...this._attrs].map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${escAttr(v)}"`)).join('');
    const css = [...this.style._map].map(([k, v]) => `${k}:${v}`).join(';');
    const open = `<${tag}${attrs}${css ? ` style="${escAttr(css)}"` : ''}>`;
    return VOID.has(tag) ? open : `${open}${this.innerHTML}</${tag}>`;
  }
  set outerHTML(html) {
    const p = this.parentNode; if (!p) return;
    const at = p.childNodes.indexOf(this);
    const nodes = parse(String(html), this.ownerDocument);
    p.childNodes.splice(at, 1, ...nodes);
    for (const n of nodes) n.parentNode = p;
    this.parentNode = null;
  }
  _clear() { for (const n of this.childNodes) n.parentNode = null; this.childNodes = []; }
  _add(n) { n.parentNode = this; this.childNodes.push(n); }
  _detach(n) { if (n.parentNode) { const l = n.parentNode.childNodes; l.splice(l.indexOf(n), 1); n.parentNode = null; } }
  appendChild(n) { this._detach(n); this._add(n); return n; }
  insertBefore(n, ref) {
    this._detach(n);
    if (!ref) return this.appendChild(n);
    this.childNodes.splice(this.childNodes.indexOf(ref), 0, n); n.parentNode = this; return n;
  }
  remove() { this._detach(this); }
  _walk(fn) { for (const c of this.children) { fn(c); c._walk(fn); } }
  querySelectorAll(sel) { const m = compile(sel), out = []; this._walk(el => { if (m(el, this)) out.push(el); }); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { const m = compile(sel); for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (m(n, null)) return n; return null; }
}

El.layout = null;

// ---- parser ----
function parse(html, doc) {
  const root = new El('#parse', doc), stack = [root];
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+|<)/g;
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) { const tag = m[1].toLowerCase(); const i = stack.map(e => e.localName).lastIndexOf(tag); if (i > 0) stack.length = i; continue; }
    if (m[2]) {
      const tag = m[2].toLowerCase(), el = new El(tag, doc);
      for (const a of m[3].matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        const v = a[2] ?? a[3] ?? a[4] ?? '';
        if (a[1] === 'style') for (const d of v.split(';')) { const i = d.indexOf(':'); if (i > 0) el.style._map.set(d.slice(0, i).trim(), d.slice(i + 1).trim()); }
        else el._attrs.set(a[1], decode(v));
      }
      top._add(el);
      if (!m[4] && !VOID.has(tag)) stack.push(el);
      continue;
    }
    top._add(new Text(decode(m[5])));
  }
  const out = root.childNodes; root._clear(); return out;
}

// ---- selectors: comma lists, compounds (tag #id .class [attr] [attr=v] :scope), descendant and child combinators ----
function compound(src) {
  const tests = [];
  const re = /^(?:([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|([^\]]*)))?\]|(:scope))/;
  let rest = src;
  while (rest) {
    const m = re.exec(rest); if (!m) throw new Error(`fake-dom: unsupported selector part "${rest}" in "${src}"`);
    if (m[1]) tests.push(el => el.localName === m[1].toLowerCase());
    else if (m[2]) tests.push(el => el.id === m[2]);
    else if (m[3]) tests.push(el => el._classes().includes(m[3]));
    else if (m[4]) { const want = m[5] ?? m[6]; tests.push(el => el._attrs.has(m[4]) && (want === undefined || el._attrs.get(m[4]) === want)); }
    else tests.push((el, scope) => el === scope);
    rest = rest.slice(m[0].length);
  }
  return (el, scope) => tests.every(t => t(el, scope));
}
function compile(list) {
  const alts = list.split(',').map(s => {
    const parts = s.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/); const steps = [];
    let child = false;
    for (const p of parts) { if (p === '>') { child = true; continue; } steps.push({ child, test: compound(p) }); child = false; }
    return steps;
  });
  const matchFrom = (steps, i, el, scope) => {
    if (!steps[i].test(el, scope)) return false;
    if (i === 0) return true;
    const { child } = steps[i];
    for (let p = el.parentNode; p && p.nodeType === 1; p = p.parentNode) {
      if (matchFrom(steps, i - 1, p, scope)) return true;
      if (child) return false;
    }
    return false;
  };
  return (el, scope) => alts.some(steps => matchFrom(steps, steps.length - 1, el, scope));
}

export class FakeDocument {
  constructor(bodyHtml) {
    this.documentElement = new El('html', this);
    this.activeElement = null;
    this.documentElement.innerHTML = bodyHtml;
  }
  createElement(tag) { return new El(tag, this); }
  querySelector(sel) { return this.documentElement.querySelector(sel); }
  querySelectorAll(sel) { return this.documentElement.querySelectorAll(sel); }
}
