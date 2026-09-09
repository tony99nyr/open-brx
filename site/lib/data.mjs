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
const TOK = { damage: 5, cycle: 14, mag: 16, reserve: 17, reload: 18, heat: 24, sound: 27 };
const tok = (frame, n) => {
  const v = frame.split(',')[n + 1];
  return v === undefined || v === '' ? null : v;
};

// The published arsenal is what the Callsign app put ON THE WIRE, read out of each weapon's own
// captured $WEAP frame. It is deliberately NOT the top-level dmg/rof/rng fields of weapons.json:
// those are Open BRX's rebalanced 0-100 UI bars, and publishing them under headings like "Damage"
// stated Assault Rifle 8 where the wire says 9. Weapons with `captured: false` (the Open BRX
// sidearms) are excluded: they carry a copied frame and were never in Callsign.
export function buildWeapons(repo) {
  const cat = JSON.parse(fs.readFileSync(path.join(repo, 'mcp/brx_mcp/mc/weapons.json'), 'utf8')).weapons;
  return cat.filter(w => w.captured && w.capture?.frame).map(w => {
    const f = w.capture.frame;
    const num = n => { const v = tok(f, n); return v === null ? null : Number(v); };
    return {
      id: w.weapon_id, name: w.name, role: w.role,
      dmg: num(TOK.damage), cycle_ms: num(TOK.cycle), mag: num(TOK.mag),
      // t17 carries 32768 as an "unlimited" flag rather than a round count (dev.md's $WEAP map).
      // No captured stock weapon uses it today, but printing "32768" as spare rounds would be a
      // published falsehood the moment one did.
      reserve: num(TOK.reserve) === 32768 ? 'unlimited' : num(TOK.reserve),
      reload_ms: num(TOK.reload),
      heat: num(TOK.heat), sound: tok(f, TOK.sound),
    };
  });
}

// Most transcripts in the catalog are MACHINE transcription, and they are known to be wrong: the
// catalog had V116 as "Can't believe!" where the gun says "gained the lead". Only ~146 of 1,244 have
// been confirmed by ear. Publishing all of them as plain "meaning" states guesses as facts, so the
// page marks the unconfirmed ones instead of hiding the distinction.
export function buildSounds(repo) {
  const catalog = JSON.parse(fs.readFileSync(path.join(repo, 'mcp/brx_mcp/data/sound_catalog.json'), 'utf8'));
  return catalog.sounds.map(s => {
    const quoted = s.kind === 'voice' && s.transcript
      ? `"${s.transcript}"${s.speaker ? ` (${s.speaker})` : ''}` : '';
    const meaning = !s.on_gun ? 'listed by the app, not on the gun' : (s.known_use || quoted);
    return {
      id: s.id,
      family: s.family || ((s.id.match(/^([A-Z]+)/) || [])[1] || s.id[0]),
      len: Math.round((s.duration_s ?? 0) * 100) / 100,
      meaning,
      // true when this row is something we know: a confirmed use, or a transcript heard on the gun
      heard: Boolean(s.known_use || s.verified_by_ear || !s.on_gun),
      on_gun: Boolean(s.on_gun),
      play: s.on_gun ? `$PLAY,${s.id},*` : '',
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}
