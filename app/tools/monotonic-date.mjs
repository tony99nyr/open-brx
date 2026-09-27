// Every page a gate opens reads Date.now() from the monotonic clock, the clock the gate's own waits use.
// The engine times its badges, delays and countdowns with Date.now(). A host whose wall clock steps expires them early
// at random: on 2026-09-27 a WSL boot mis-calibrated the TSC and timesyncd stepped the clock +3 s every 32 s, and about
// ten timing steps went red on an unchanged main. A step that fakes time (`pg.clock.install()`) is unaffected.
const MONOTONIC_DATE = () => {
  const native = f => /\[native code\]/.test(Function.prototype.toString.call(f));
  if (!native(Date.now) || !native(performance.now)) return;   // a faked clock is already in charge
  const mono = performance.now.bind(performance), base = Date.now() - mono();   // bound now: never calls a later fake
  Date.now = () => Math.floor(base + mono());
};

/** Wrap `browser.newPage` and `browser.newContext` so each page gets the monotonic Date.now(). Returns the browser. */
export function monotonicDate(browser) {
  const newPage = browser.newPage.bind(browser), newContext = browser.newContext.bind(browser);
  browser.newPage = async o => { const p = await newPage(o); await p.addInitScript(MONOTONIC_DATE); return p; };
  browser.newContext = async o => { const c = await newContext(o); await c.addInitScript(MONOTONIC_DATE); return c; };
  return browser;
}
