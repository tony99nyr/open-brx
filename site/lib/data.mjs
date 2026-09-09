// The two generated tables. Both come from repo data files ONLY.
//   weapons = mcp/brx_mcp/mc/weapons.json
//   sounds  = mcp/brx_mcp/data/sound_catalog.json
// The build never reads facts out of manual prose: if a value belongs in a table, it belongs in
// the JSON. (This used to scrape markdown tables out of the manual, so renaming a column silently
// changed published data. See docs/site/SIMPLIFY-PLAN.md §2.)
import fs from 'node:fs';
import path from 'node:path';

// $WEAP token positions, from the bench-proven map in docs/manual/dev.md.
// The frame is `$WEAP,<t0>,<t1>,...`, so token N sits at split index N+1.
const TOK = { fireInterval: 14, heat: 24, fireSound: 27 };
const tok = (frame, n) => {
  if (!frame) return null;
  const v = frame.split(',')[n + 1];
  return v === undefined || v === '' ? null : v;
};

export function buildWeapons(repo) {
  const cat = JSON.parse(fs.readFileSync(path.join(repo, 'mcp/brx_mcp/mc/weapons.json'), 'utf8')).weapons;
  return cat.map(w => {
    const frame = w.capture?.frame || null;
    const num = n => { const v = tok(frame, n); return v === null ? null : Number(v); };
    return {
      id: w.weapon_id, name: w.name, role: w.role, desc: w.desc,
      dmg: w.dmg, mag: w.mag, reserve: w.reserve, reload_ms: w.reload_ms,
      rof: w.rof, rng: w.rng, htk: w.htk, ttk_ms: w.ttk_ms,
      // read off the captured wire frame, never out of manual prose
      cycle_ms: num(TOK.fireInterval), heat: num(TOK.heat), sound: tok(frame, TOK.fireSound),
    };
  });
}

export function buildSounds(repo) {
  const catalog = JSON.parse(fs.readFileSync(path.join(repo, 'mcp/brx_mcp/data/sound_catalog.json'), 'utf8'));
  return catalog.sounds.map(s => ({
    id: s.id,
    family: s.family || ((s.id.match(/^([A-Z]+)/) || [])[1] || s.id[0]),
    len: Math.round((s.duration_s ?? 0) * 100) / 100,
    meaning: !s.on_gun ? 'listed by the app, not on the gun'
      : s.known_use || (s.kind === 'voice' && s.transcript ? `"${s.transcript}"${s.speaker ? ` (${s.speaker})` : ''}` : ''),
    on_gun: Boolean(s.on_gun),
    play: s.on_gun ? `$PLAY,${s.id},*` : '',
  })).sort((a, b) => a.id.localeCompare(b.id));
}
