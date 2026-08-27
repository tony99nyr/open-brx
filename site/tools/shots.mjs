// Screenshot helper: node tools/shots.mjs <outDir> [base]
import { chromium } from 'playwright';
import path from 'node:path';
const out = process.argv[2] || 'shots'; const base = process.argv[3] || 'http://localhost:4173';
const pages = ['/', '/manual/', '/manual/hardware/leds/', '/manual/operate/headset-pairing/', '/manual/gameplay/weapons/', '/manual/sound/sound-bank/', '/manual/fix/diagnose/', '/manual/dev/commands/', '/platform/', '/platform/pieces/'];
const b = await chromium.launch();
for (const [name, vp] of [['desk', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  for (const u of pages) {
    await p.goto(base + u, { waitUntil: 'networkidle' });
    await p.screenshot({ path: path.join(out, `${name}${u.replace(/\//g, '_') || '_home'}.png`), fullPage: name === 'phone' ? false : false });
  }
  console.log(name, 'errors:', errors);
  await ctx.close();
}
await b.close();
