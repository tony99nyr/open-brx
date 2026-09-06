// Explorer data, built from the repo's data files (never hand-copied):
//   weapons  = mcp/brx_mcp/mc/weapons.json  +  docs/reference/weapons.md (sound id, behaviour, cycle, heat)
//   sounds   = mcp/brx_mcp/data/sound_catalog.json (every file on a v4.32 gun + the app-only ids, 2026-09-03)
//              + meanings from the MANUAL's own tables (the catalog's transcript / known_use fill the rest)
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
  const catalog = JSON.parse(fs.readFileSync(path.join(repo, 'mcp/brx_mcp/data/sound_catalog.json'), 'utf8'));
  const soundFile = path.join(manualDir, '04-sound.md');
  const manual = fs.existsSync(soundFile) ? fs.readFileSync(soundFile, 'utf8') : '';
  const published = manual.split(/^## Research backlog/m)[0];
  // families: any manual table with a "family"/"prefix" column and a meaning/category column
  const fam = {};
  for (const r of mdTableRows(published, h => (h[0] === 'family' || h[0] === 'prefix') )) {
    const key = strip(r.family ?? r.prefix); const meaning = strip(r.meaning ?? r.category ?? r['what it holds'] ?? r['character / voice'] ?? r.what ?? '');
    for (const p of key.split(/[,/+]/).map(s => s.trim()).filter(Boolean)) if (!fam[p] || !fam[p].meaning) fam[p] = { meaning, count: strip(r.ids ?? r.count ?? '') || null };
  }
  // meanings: any published manual table with an id column
  const meaning = {};
  for (const r of mdTableRows(published, h => h[0] === 'id' || h[0] === 'sound id')) {
    const id = strip(r.id ?? r['sound id']).split(/\s/)[0];
    const m = strip(r.meaning ?? r['what it is'] ?? r.what ?? r.cue ?? r.description ?? '');
    if (id && m && !meaning[id]) meaning[id] = { meaning: m, provenance: (r.provenance || r.conf || r.confidence || '').trim() };
  }
  const famKeys = Object.keys(fam).sort((a, b) => b.length - a.length);
  const familyOf = (id, fallback) => {
    // longest matching manual family prefix, else the catalog's own family
    for (const k of famKeys) if (id.startsWith(k)) return k;
    return fallback || ((id.match(/^([A-Z]+)/) || [])[1] || id[0]);
  };
  const rows = catalog.sounds.map(s => {
    const id = s.id, f = familyOf(id, s.family);
    let m = meaning[id]?.meaning || '', prov = meaning[id]?.provenance || '';
    if (!s.on_gun) { m = 'listed by the app, not on the gun (plays the fallback)'; prov = ''; }
    else if (!m && s.known_use) { m = s.known_use; prov = '✅'; }
    else if (!m && s.kind === 'voice' && s.transcript) { m = `"${s.transcript}"${s.speaker ? ` (${s.speaker})` : ''}`; prov = '✅ transcript'; }
    return {
      id, len: Math.round((s.duration_s ?? 0) * 100) / 100, family: f, family_meaning: fam[f]?.meaning || '',
      meaning: m, meaning_known: Boolean(m), provenance: prov,
      on_gun: Boolean(s.on_gun), in_app: Boolean(s.in_app), category: s.category || '', speaker: s.speaker || '',
      file: s.on_gun ? `${id}.LTP` : '', play: s.on_gun ? `$PLAY,${id},*` : '',
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
  return { rows, families: fam, meanings_known: rows.filter(r => r.meaning_known && r.on_gun).length, on_gun: catalog.count_on_gun, app_only: catalog.count_app_only };
}
