// Explorer data, built from the repo's data files (never hand-copied):
//   weapons  = mcp/brx_mcp/mc/weapons.json  +  docs/reference/weapons.md (sound id, behaviour, cycle, heat)
//   sounds   = protocol/callsign-extract/Sounds.json (ids + lengths)  +  meanings from the MANUAL's own tables
import fs from 'node:fs';
import path from 'node:path';

function mdTableRows(text, headerPred) {
  // returns [{cols:[...]}] for every markdown table whose header matches headerPred
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('|') || !/^\|\s*-{2,}/.test(lines[i + 1] || '')) continue;
    const header = lines[i].replace(/^\||\|$/g, '').split('|').map(s => s.trim().replace(/\*/g, '').toLowerCase());
    if (!headerPred(header)) { continue; }
    for (let j = i + 2; j < lines.length && lines[j].startsWith('|'); j++) {
      const cols = lines[j].replace(/^\||\|$/g, '').split('|').map(s => s.trim());
      const row = {}; header.forEach((h, k) => row[h] = cols[k] ?? '');
      out.push(row);
    }
  }
  return out;
}
const strip = s => s.replace(/[`*]/g, '').trim();

export function buildWeapons(repo) {
  const cat = JSON.parse(fs.readFileSync(path.join(repo, 'mcp/brx_mcp/mc/weapons.json'), 'utf8')).weapons;
  const ref = mdTableRows(fs.readFileSync(path.join(repo, 'docs/reference/weapons.md'), 'utf8'), h => h[0] === 'weapon' && h.includes('sound'));
  const byName = {};
  for (const r of ref) byName[strip(r.weapon).toLowerCase()] = r;
  const alias = { 'sniper rifle': 'sniper', 'shotgun': '(unnamed secondary)' }; // the 20th captured frame is the default secondary = the Shotgun (docs/manual/03-gameplay.md)
  return cat.map(w => {
    const key = w.name.toLowerCase();
    const r = byName[key] || byName[alias[key]] || null;
    return {
      id: w.weapon_id, name: w.name, role: w.role, desc: w.desc,
      dmg: w.dmg, mag: w.mag, reserve: w.reserve, reload_ms: w.reload_ms, rof: w.rof, rng: w.rng, htk: w.htk, ttk_ms: w.ttk_ms,
      cycle_ms: r ? Number(strip(r['cycle ms'])) : null, heat: r ? Number(strip(r.heat)) : null,
      sound: r ? strip(r.sound) : null, behaviour: r ? strip(r.behaviour) : null,
      frame: w.capture?.frame || null, capture_src: w.capture?.src || null,
      provenance: 'apk', // stats are the values the app sent on the wire (captured)
    };
  });
}

export function buildSounds(repo, manualDir) {
  const bank = JSON.parse(fs.readFileSync(path.join(repo, 'protocol/callsign-extract/Sounds.json'), 'utf8')).SoundsLengthMap;
  const manual = fs.readFileSync(path.join(manualDir, '04-sound.md'), 'utf8');
  const published = manual.split(/^## Research backlog/m)[0];
  // families: any manual table with a "family"/"prefix" column and a meaning/category column
  const fam = {};
  for (const r of mdTableRows(published, h => (h[0] === 'family' || h[0] === 'prefix') )) {
    const key = strip(r.family ?? r.prefix); const meaning = strip(r.meaning ?? r.category ?? r['what it holds'] ?? r['character / voice'] ?? r.what ?? '');
    for (const p of key.split(/[,/]/).map(s => s.trim()).filter(Boolean)) if (!fam[p] || !fam[p].meaning) fam[p] = { meaning, count: strip(r.ids ?? r.count ?? '') || null };
  }
  // meanings: any published manual table with an id column
  const meaning = {};
  for (const r of mdTableRows(published, h => h[0] === 'id' || h[0] === 'sound id')) {
    const id = strip(r.id ?? r['sound id']).split(/\s/)[0];
    const m = strip(r.meaning ?? r['what it is'] ?? r.what ?? r.cue ?? r.description ?? '');
    if (id && m && !meaning[id]) meaning[id] = { meaning: m, provenance: (r.provenance || r.conf || r.confidence || '').trim() };
  }
  const familyOf = id => {
    // longest matching known family prefix, else the leading letters
    const keys = Object.keys(fam).sort((a, b) => b.length - a.length);
    for (const k of keys) if (id.startsWith(k)) return k;
    const m = id.match(/^([A-Z]+)/); return m ? m[1] : id[0];
  };
  const rows = Object.entries(bank).map(([id, len]) => {
    const f = familyOf(id);
    return {
      id, len: Math.round(len * 100) / 100, family: f, family_meaning: fam[f]?.meaning || '',
      meaning: meaning[id]?.meaning || '', meaning_known: Boolean(meaning[id]),
      provenance: meaning[id]?.provenance || '', file: `${id}.LTP`, play: `$PLAY,${id},*`,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
  return { rows, families: fam, meanings_known: Object.keys(meaning).length };
}
