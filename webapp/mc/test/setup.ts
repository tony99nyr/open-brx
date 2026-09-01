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

// React needs to be told this is an act() environment or every state update warns.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// NOTE: `URL.createObjectURL` / `revokeObjectURL` DO exist under vitest+jsdom on this Node (they
// return `blob:nodedata:…`), so they are deliberately NOT stubbed here — a review round-2 finding
// asserted they were missing, and the probe disproved it. Tests that care about the download
// lifecycle spy on them locally instead, which tests the real ordering rather than a stub's.
