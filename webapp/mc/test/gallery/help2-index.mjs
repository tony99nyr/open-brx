// Build the F599 phase 2 gallery index from the notes and shot manifest.
// Usage: node test/gallery/help2-index.mjs <outDir> <baseCommit>
import fs from 'node:fs';
import path from 'node:path';
const out = process.argv[2];
const base = process.argv[3] || 'unknown';
if (!out) throw new Error('Usage: node test/gallery/help2-index.mjs <outDir> <baseCommit>');
const notes = JSON.parse(fs.readFileSync(new URL('./help2-notes.json', import.meta.url), 'utf8'));
const frames = JSON.parse(fs.readFileSync(path.join(out, 'help2-captions.json'), 'utf8'));
const skipped = fs.existsSync(path.join(out, 'help2-skipped.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'help2-skipped.json'), 'utf8')) : [];
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const exists = name => fs.existsSync(path.join(out, name));
const figure = (id, kind, label) => exists(`${id}-${kind}.png`) ? `<figure><figcaption>${label}</figcaption><a href="${id}-${kind}.png"><img src="${id}-${kind}.png" alt="${esc(label)}" width="1280" height="720" loading="lazy"></a></figure>` : '';
const card = f => {
  const id = f.id;
  return `<section class="frame" id="${esc(id)}"><h3>${esc(f.screen)}</h3><div class="pair">${figure(id, 'current', 'Current copy')}${figure(id, 'open', 'INFO opened')}</div></section>`;
};
const rows = notes.map(n => `<tr><td data-label="Screen">${esc(n.screen)}</td><td data-label="Source">${esc(n.file)}:${esc(n.line)}</td><td data-label="Current text">${esc(n.current)}</td><td data-label="Proposal"><span class="tag ${esc(n.proposal.toLowerCase())}">${esc(n.proposal)}</span></td><td data-label="New wording">${esc(n.wording || 'None')}</td><td data-label="Reason">${esc(n.reason)}</td></tr>`).join('');
const shotGroups = [...new Map(frames.map(f => [f.id, f])).values()];
const counts = notes.reduce((a, n) => (a[n.proposal] = (a[n.proposal] || 0) + 1, a), {});
const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>F599 phase 2 console help gallery</title>
<style>
:root{color-scheme:dark;--bg:#0b0f14;--panel:#121923;--ink:#e8eef5;--dim:#9db0c2;--line:#25313f;--acc:#39b4ff;--cut:#a9b6c4;--info:#54c5a4;--inline:#ffc45c}
@media(prefers-color-scheme:light){:root{color-scheme:light;--bg:#f4f6f9;--panel:#fff;--ink:#14202c;--dim:#4a5d70;--line:#cdd6df;--acc:#0b6fb8;--cut:#526273;--info:#087b61;--inline:#8b5700}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,'Segoe UI',sans-serif}main{max-width:1500px;margin:0 auto;padding:24px 16px 64px}h1{font-size:clamp(24px,4vw,34px);margin:0}h2{font-size:22px;margin:36px 0 10px;border-top:1px solid var(--line);padding-top:18px}h3{font-size:18px;color:var(--acc);margin:0 0 6px}.dim{color:var(--dim)}.box{background:var(--panel);border:1px solid var(--line);padding:12px 18px;margin:14px 0}li{margin:5px 0}.count{display:flex;gap:8px;flex-wrap:wrap}.tag{display:inline-block;border:1px solid var(--line);padding:1px 7px;font-size:12px;font-weight:700}.cut{color:var(--cut)}.info{color:var(--info)}.inline{color:var(--inline)}.table-wrap{overflow-x:auto;border:1px solid var(--line)}table{border-collapse:collapse;width:100%;min-width:820px;font-size:14px;background:var(--panel)}td,th{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}th{position:sticky;top:0;background:var(--panel)}td:nth-child(2){min-width:260px}td:nth-child(4){min-width:200px}.frame{margin:22px 0}.pair{display:flex;gap:12px;flex-wrap:wrap;margin:8px 0}figure{margin:0;flex:1 1 560px;min-width:0}figcaption{font-weight:700;font-size:14px;margin-bottom:4px}figure img{width:100%;height:auto;border:1px solid var(--line);display:block}@media(max-width:600px){main{padding:16px 10px 40px}.box{padding:10px 12px}.pair{display:block}figure{margin-bottom:12px}table,tbody,tr,td{display:block;width:100%;min-width:0!important}table{font-size:14px}thead{display:none}tr{border-bottom:2px solid var(--line);padding:7px 0}td{border:0;padding:4px 12px;overflow-wrap:anywhere}td:before{content:attr(data-label);display:block;color:var(--dim);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}}
</style></head><body><main>
<h1>F599 phase 2: console help notes</h1>
<p class="dim">Mock console gallery at 1280 × 720. Base ${esc(base)}. Approved treatments: <span class="count">${Object.entries(counts).map(([k,v]) => `<span class="tag ${esc(k.toLowerCase())}">${esc(k)}: ${v}</span>`).join('')}</span></p>
<div class="box"><h2 style="margin:0;border:0;padding:0">The rule</h2><ul><li>Cut neutral notes unless an operator needs them to work.</li><li>Keep necessary help behind one INFO button per screen or panel.</li><li>Use short sentence case. Do not use full-width capital sentences.</li></ul></div>
<h2>Every note</h2><div class="table-wrap"><table><thead><tr><th>Screen</th><th>Source (file:line)</th><th>Current text</th><th>Proposal</th><th>New wording</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table></div>
<h2>Current screens</h2>${shotGroups.map(card).join('\n')}
<h2>Not rendered</h2>${skipped.length ? `<ul>${skipped.map(s => `<li>${esc(s.screen)}: ${esc(s.reason)}${s.notes?.length ? ` Notes: ${esc(s.notes.join(', '))}` : ''}</li>`).join('')}</ul>` : '<p class="dim">Every configured panel rendered.</p>'}
<h2>Approved decisions</h2><ul><li>Keep the disabled power-ups explanation behind INFO.</li><li>Cut the catalogue dual-emitter caveat.</li><li>Keep the LIVE hill host decision rule behind INFO.</li></ul>
</main></body></html>`;
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log('wrote', path.join(out, 'index.html'));
