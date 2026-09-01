// jsdom gaps the console's UI primitives use. Each of these is a real browser API that jsdom simply
// does not implement — stubbing them is not papering over a product bug, and each stub is inert
// (never fires), so a test can only assert what the component renders WITHOUT it.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;
globalThis.matchMedia ??= ((q: string) => ({
  matches: false, media: q, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  dispatchEvent: () => false,
})) as unknown as typeof matchMedia;
// jsdom's scrollTo/scrollIntoView throw "not implemented" and would fail an otherwise fine render
Element.prototype.scrollIntoView ??= function () {};
globalThis.scrollTo ??= (() => {}) as unknown as typeof scrollTo;

// localStorage. NOT present under vitest+jsdom on Node 26: Node ships its own built-in global that
// is `undefined` unless the process was started with `--localstorage-file`, and it shadows the one
// jsdom would otherwise expose (jsdom's own works fine — `new JSDOM('', {url}).window.localStorage`
// is a real Storage). The result is version-dependent: this suite passes on the Node the Windows
// lane used and fails on a Mac with Node 26, which is exactly the cross-platform trap CLAUDE.md
// warns about. An in-memory Storage keeps the behaviour identical on both.
if (typeof globalThis.localStorage === 'undefined') {
  const mem = new Map<string, string>();
  const storage = {
    get length() { return mem.size; },
    key: (i: number) => [...mem.keys()][i] ?? null,
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => { mem.clear(); },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true, writable: true });
  }
}

// React needs to be told this is an act() environment or every state update warns.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// NOTE: `URL.createObjectURL` / `revokeObjectURL` DO exist under vitest+jsdom on this Node (they
// return `blob:nodedata:…`), so they are deliberately NOT stubbed here — a review round-2 finding
// asserted they were missing, and the probe disproved it. Tests that care about the download
// lifecycle spy on them locally instead, which tests the real ordering rather than a stub's.
