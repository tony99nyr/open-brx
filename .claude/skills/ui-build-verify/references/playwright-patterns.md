# Playwright patterns for screen-truth UI verification

Copy-paste starting points. All assume `import { chromium } from 'playwright'` and a page `pg`.

## Stale server (new UI, old backend) — REST *and* WebSocket

`page.route` never sees WebSocket frames; a "stale server" run that only strips REST is not stale.

```js
const strip = o => { if (o && typeof o === 'object') { delete o.new_field; delete o.other_new_field; for (const k of Object.keys(o)) strip(o[k]); } return o; };
await pg.route('**/api/**', async r => {
  if (/\/api\/(new_route_a|new_route_b)/.test(r.request().url())) return r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' });
  const res = await r.fetch(); let body = await res.text();
  try { body = JSON.stringify(strip(JSON.parse(body))); } catch { /* not JSON */ }
  await r.fulfill({ response: res, body, headers: { ...res.headers(), 'content-length': String(Buffer.byteLength(body)) } });
});
await pg.routeWebSocket('**/ws-path*', ws => {           // Playwright ≥ 1.48
  const s = ws.connectToServer();
  s.onMessage(m => { try { ws.send(JSON.stringify(strip(JSON.parse(m)))); } catch { ws.send(m); } });
  ws.onMessage(m => s.send(m));
});
// then: every page renders, the skew banner is visible, controls still respond
```

## Failure path for one action

```js
await pg.route('**/api/players/*', r => r.request().method() === 'PATCH'
  ? r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"weapon not allowed by the rules"}' })
  : r.continue());
await pg.click('div[role="button"][aria-label^="Shotgun"]');
await until(async () => (await pg.locator('[role="alert"]:has-text("NOT ALLOWED")').count()) > 0, 4000, 'server error shown');
expect((await pg.locator('text=CHANGED FROM THEIR PHONE').count()) === 0, 'a rejected pick must not be blamed on someone else');
```

## Assert what is visible, not what the app believes

```js
const art = prim.locator('button[aria-label="Rocket Launcher, off"] span').first();
const { opacity, filter } = await art.evaluate(el => { const s = getComputedStyle(el); return { opacity: +s.opacity, filter: s.filter }; });
expect(opacity <= 0.3 && /grayscale/.test(filter), 'a weapon switched off must LOOK off');
expect((await chip.getAttribute('aria-pressed')) === 'false', 'chip state');
await until(async () => /13 OF 18/.test(await pg.getByTestId('primary-summary').textContent()), 4000, 'count follows the chip');
```

Give controls `aria-label`s that encode state (`"Rail Gun, off"` / `"Rail Gun, allowed"`) and summaries a
`data-testid` — the test reads what a screen reader reads.

## Old persisted data

Keep a fixture of a session written *before* the change (`fixtures/session-preX.json`), boot a second server
from it (`--session-file <tmp copy>` or `HOME=<tmpdir>`), open every page, assert no crash banner and the
normalised defaults render.

## Audits that fail the run

```js
const tapAudit = async (pg, where, hard = false) => {
  const rows = await pg.evaluate(() => [...document.querySelectorAll('main button,main [role="button"],main [role="switch"]')]
    .filter(el => el.offsetParent !== null)
    .map(el => { const r = el.getBoundingClientRect(); return { t: (el.textContent || el.getAttribute('aria-label') || '?').trim().slice(0, 28), h: Math.round(r.height) }; }));
  const small = rows.filter(r => r.h < 36);
  if (hard) expect(small.length === 0, `${where}: undersized controls ${JSON.stringify(small)}`);
  return small;
};
```

Exclude decorative regions (nav digits) from the tiny-text sweep so the real hits aren't buried under
noise; do not cap the list.

## Bundle freshness at boot

```js
const newest = dir => Math.max(...walk(dir).map(f => fs.statSync(f).mtimeMs));
if (newest('webapp/src') > fs.statSync(servedBundle).mtimeMs && !process.env.ALLOW_STALE) { console.error('STALE BUNDLE — rebuild first'); process.exit(3); }
```

## Isolated steps

`ONLY=<substring> node e2e.mjs` runs matching steps only; a step that can run alone must `goto` the app
itself if the page is still `about:blank`. Keep the JS-error rollup and the report running under `ONLY=`.

## Pitfalls seen in practice

- `text=OPEN` matches "OPEN BRX" in the logo — prefer `button[role="radio"]:has-text("OPEN")` or aria labels.
- `pkill -f "pattern"` matches the shell that invoked it; write the pattern as `"patter[n]"`.
- Coalesced snapshots: after an action, wait for the *card's* `aria-pressed` before the next tap.
- A `<button>` inside a `<form>` submits by default — a cancel button will submit too; prefer explicit
  handlers over forms for small inline editors.
- Do not rebuild the served bundle while a suite run is live.
