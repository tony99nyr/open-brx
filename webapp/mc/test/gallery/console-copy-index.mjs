// F599 gallery page: reads the PNGs and captions that console-copy-shots.mjs wrote and shows the default copy and its opened detail.
//   node test/gallery/console-copy-index.mjs <outDir> <baseCommit>
import fs from 'node:fs';
const out = process.argv[2];
const base = process.argv[3] || 'unknown';
const caps = JSON.parse(fs.readFileSync(`${out}/captions.json`, 'utf8'));
const has = f => fs.existsSync(`${out}/${f}`);
const GROUPS = [
  ['Red faults: a pill with an icon, about six words, the detail behind a tap', ['armory-banners', 'server-failures', 'frame-offline-token']],
  ['Amber lines: a chip on the item they concern', ['armory-outbox', 'join-panel', 'join-no-lan', 'games-hill', 'games-respawn', 'kit-locked', 'kit-continue', 'items-departed']],
  ['Neutral help notes: cut, or one INFO button', ['live', 'armed', 'kit-notes', 'items-notes']],
  ['Backhaul auto-start status (brx4)', ['backhaul', 'backhaul-error']],
];
const cap = id => caps.find(c => c.id === id)?.cap ?? id;
const fig = (id, kind, label) => has(`${id}-${kind}.png`) ? `<figure><figcaption>${label}</figcaption><a href="${id}-${kind}.png"><img src="${id}-${kind}.png" alt="${id} ${label}" width="1280" height="720" loading="lazy"></a></figure>` : '';
const card = id => `<section class="frame" id="${id}"><h3>${id}</h3><p class="cap">${cap(id)}</p><div class="pair">${fig(id, 'current', 'Default copy')}</div>${has(`${id}-open.png`) ? `<div class="pair">${fig(id, 'open', 'Detail opened')}</div>` : ''}</section>`;
const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Console copy cleanup F599</title>
<style>
:root{--bg:#0b0f14;--panel:#121923;--ink:#e8eef5;--dim:#9db0c2;--line:#25313f;--acc:#39b4ff;--red:#ff5252;--amber:#ffb020}
@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){--bg:#f4f6f9;--panel:#fff;--ink:#14202c;--dim:#4a5d70;--line:#cdd6df;--acc:#0b6fb8;--red:#c62828;--amber:#9a5b00}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,'Segoe UI',sans-serif}
main{max-width:1500px;margin:0 auto;padding:24px 16px 64px}
h1{margin:0 0 6px;font-size:28px}h2{margin:40px 0 8px;font-size:21px;border-top:1px solid var(--line);padding-top:20px}h3{margin:0;font-size:16px;color:var(--acc)}
p{max-width:80ch}.dim{color:var(--dim)}.box{background:var(--panel);border:1px solid var(--line);padding:14px 20px;margin:14px 0}
li{margin:6px 0;max-width:90ch}.tag{display:inline-block;padding:0 8px;border:1px solid var(--line);font-size:13px;margin-right:6px}
.pair{display:flex;gap:12px;flex-wrap:wrap;margin:8px 0}figure{margin:0;flex:1 1 560px;min-width:0}figcaption{font-weight:700;font-size:14px;margin-bottom:4px}
figure img{width:100%;height:auto;border:1px solid var(--line);display:block}
.frame{margin:22px 0}.cap{margin:2px 0 6px;color:var(--dim)}
table{border-collapse:collapse;font-size:14px}td,th{border:1px solid var(--line);padding:4px 10px;text-align:left;vertical-align:top}
</style></head><body><main>
<h1>Console copy cleanup (F599)</h1>
<p class="dim">Mission Control on the <code>?mock</code> backend at 1280 by 720. Base commit ${base}. Built ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC.</p>
<div class="box"><h2 style="margin-top:0;border:0;padding:0">The rule, in four bullets</h2><ol>
<li><b>Red faults stay prominent but short.</b> An icon and about six words in sentence case. The reason and the fix sit behind a tap on "Why?".</li>
<li><b>Amber lines become a chip on the item.</b> An icon and a short label on the node card, the station, the kit or the panel it concerns. Never a line across the page.</li>
<li><b>Neutral help notes are cut.</b> A note stays only when an operator cannot work without it, and then it sits behind one INFO button.</li>
<li><b>Sentence case, short sentences.</b> No full-width capitals. The backhaul status is a globe and a short label, with the error behind a tap.</li></ol></div>
${GROUPS.map(([title, ids]) => `<h2>${title}</h2>${ids.map(card).join('')}`).join('\n')}
</main></body></html>`;
fs.writeFileSync(`${out}/index.html`, html);
console.log('wrote', `${out}/index.html`);
