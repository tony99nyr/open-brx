// A storyboard of real HUD states for Tony's review (the ui-storyboard skill): one page of live frames, each an iframe of
// the BUILT app (`www/`, `?demo&stage=<stage>`), copied beside the page so the folder is self-contained.
// Run from app/ after `npm run build`:
//   node tools/storyboard.mjs <out-dir> <frames.json>
// frames.json: { "title": "...", "frames": [{ "id": "E1", "group": "...", "stage": "live-hill-enemy-captured",
//   "query": "&night", "w": 891, "h": 411, "caption": "..." }] }. The screenshots never go in the repo.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), WWW = path.resolve(HERE, '..', 'www');
const [outArg, specArg] = process.argv.slice(2);
if (!outArg || !specArg) { console.error('usage: node tools/storyboard.mjs <out-dir> <frames.json>'); process.exit(2); }
if (!fs.existsSync(path.join(WWW, 'app.js'))) { console.error('no www/app.js: run npm run build first'); process.exit(2); }
const OUT = path.resolve(outArg), spec = JSON.parse(fs.readFileSync(specArg, 'utf8'));
fs.rmSync(path.join(OUT, 'www'), { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(WWW, path.join(OUT, 'www'), { recursive: true });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const groups = [...new Set(spec.frames.map(f => f.group))];
const frame = f => `<figure class="fr" data-frame="${esc(f.id)}"><figcaption><b>${esc(f.id)}</b> ${esc(f.caption)} <span class="dim">${f.w}×${f.h}</span></figcaption>`
  + `<iframe title="${esc(f.id)}" src="www/index.html?demo&stage=${encodeURIComponent(f.stage)}${esc(f.query || '')}" width="${f.w}" height="${f.h}" loading="lazy"></iframe></figure>`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(spec.title)}</title><style>
body{margin:0;padding:16px;background:#111;color:#ddd;font:14px/1.4 system-ui,sans-serif}
h1{font-size:18px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 8px;color:#fff}.dim{color:#888}
.row{display:flex;flex-wrap:wrap;gap:16px}.fr{margin:0}figcaption{max-width:891px;margin-bottom:6px}
iframe{border:1px solid #333;background:#000;display:block}
</style></head><body><h1>${esc(spec.title)}</h1><p class="dim">${esc(spec.note || '')}</p>
${groups.map(g => `<h2>${esc(g)}</h2><div class="row">${spec.frames.filter(f => f.group === g).map(frame).join('')}</div>`).join('\n')}
</body></html>`;
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log(`wrote ${path.join(OUT, 'index.html')} (${spec.frames.length} frames)`);
