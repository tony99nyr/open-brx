// The two generated tables. Both come from repo data files ONLY.
//   weapons = mcp/brx_mcp/mc/weapons.json
//   sounds  = mcp/brx_mcp/data/sound_catalog.json
// The build never reads facts out of manual prose: if a value belongs in a table, it belongs in
// the JSON. (This used to scrape markdown tables out of the manual, so renaming a column silently
// changed published data. See docs/archive/site/SIMPLIFY-PLAN.md §2.)
import fs from 'node:fs';
import path from 'node:path';

// $WEAP token positions, from the bench-proven map in docs/manual/dev.md.
// The frame is `$WEAP,<t0>,<t1>,...`, so token N sits at split index N+1.
// F207 (bench 2026-09-16/17): the player's spare rounds are **t40**, and the gun's `$ALCD` reserve mirrors it.
// t17 is twice t40 in every captured frame, so publishing t17 as "Reserve" doubled the number a player carries.
const TOK = { damage: 5, cycle: 14, mag: 16, reserve: 40, reload: 18, heat: 24, sound: 27 };
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
      // The reserve tokens carry 32768 as an "unlimited" flag rather than a round count (dev.md's $WEAP map).
      // No captured stock weapon uses it today, but printing "32768" as spare rounds would be a
      // published falsehood the moment one did.
      reserve: num(TOK.reserve) === 32768 ? 'unlimited' : num(TOK.reserve),
      reload_ms: num(TOK.reload),
      heat: num(TOK.heat), sound: tok(f, TOK.sound),
    };
  });
}

// Most transcripts in the catalog are MACHINE transcription, and they are known to be wrong: the
// catalog had V116 as "Can't believe!" where the gun says "gained the lead". A row-level ear review
// may confirm an effect without endorsing Whisper's words, so the page publishes the dedicated
// transcript-verification flag and marks every other transcript unchecked.
export function buildSounds(repo) {
  const catalog = JSON.parse(fs.readFileSync(path.join(repo, 'mcp/brx_mcp/data/sound_catalog.json'), 'utf8'));
  // Public-site policy excludes private individuals' names. The evidence retains attribution in
  // the repo; the reader needs the verdict and date, not the bench operator's name.
  const publicText = value => String(value || '').replace(/\bTony,\s*/g, '').replace(/\(Tony[:,]?\s*/g, '(');
  const rows = catalog.sounds.map(s => {
    const quoted = s.kind === 'voice' && s.transcript
      ? `"${s.transcript}"${s.speaker ? ` (${s.speaker})` : ''}` : '';
    const meaning = !s.on_gun ? 'listed by the app, not on the gun' : (s.known_use || quoted);
    return {
      id: s.id,
      family: s.family || ((s.id.match(/^([A-Z]+)/) || [])[1] || s.id[0]),
      // Keep the exact measured duration in the public data. `len` remains the compact display
      // value used by the table and by the hand-written notable-id checks.
      duration_s: s.duration_s ?? 0,
      len: Math.round((s.duration_s ?? 0) * 100) / 100,
      meaning: publicText(meaning),
      // true when this row is something we know: a confirmed use, or a transcript heard on the gun
      heard: Boolean(s.known_use || s.verified_by_ear || !s.on_gun),
      on_gun: Boolean(s.on_gun),
      in_app: Boolean(s.in_app),
      availability: !s.on_gun ? 'App list only (file missing from gun; plays fallback)'
        : s.in_app ? 'On gun + in app list' : 'On gun only (not in app list)',
      kind: s.kind || '',
      category: s.category || '',
      speaker: s.speaker || '',
      known_use: publicText(s.known_use),
      transcript: s.transcript || '',
      verified_by_ear: Boolean(s.verified_by_ear),
      transcript_verified_by_ear: Boolean(s.transcript_verified_by_ear),
      description: s.description || '',
      listener_note: publicText(s.context || s.heard),
      // These measurements are derived from the actual on-gun file. Preserve the numbers in the
      // downloadable JSON and provide a compact rendering for the page.
      shape: s.shape || null,
      analysis: s.shape ? [
        s.shape.envelope && `envelope ${s.shape.envelope}`,
        s.shape.rms_db != null && `level ${s.shape.rms_db} dB RMS`,
        s.shape.centroid_hz != null && `brightness centroid ${s.shape.centroid_hz} Hz`,
        s.shape.pitch_hz != null && `pitch ${s.shape.pitch_hz} Hz`,
        s.shape.attack_s != null && `attack ${s.shape.attack_s} s`,
        s.shape.onset_rate_hz != null && `onset rate ${s.shape.onset_rate_hz} Hz`,
        s.shape.flatness != null && `flatness ${s.shape.flatness}`,
      ].filter(Boolean).join('; ') : '',
      // Volume and priority are required. The tempting short form `$PLAY,<id>,*` is silent on the
      // gun. Slot 1 works for every id and intentionally interrupts current playback.
      play: s.on_gun ? `$PLAY,${s.id},4,6,,,,,*` : '',
      // A community label (the LaserTagMods BRX Audio sheet) is a listener's guess, never our own
      // evidence: it sits beside `meaning`, never inside it. `community_status` stays exactly the
      // three words the catalog uses, upper-cased: NEW_LABEL, AGREES or DIFFERS.
      community_label: s.community_label || '',
      community_status: s.community_status ? s.community_status.toUpperCase() : '',
      flag_noise: Boolean(s.community_flag_noise),
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
  // Meta for the table's note: generated from the JSON, never hand-typed into prose
  // (docs/site/FORMAT.md, docs/manual/README.md "Data that is generated, never typed").
  rows.communityMeta = {
    labelled: catalog.community_labels_count ?? rows.filter(r => r.community_label).length,
    noise: catalog.community_noise_flagged_count ?? rows.filter(r => r.flag_noise).length,
  };
  return rows;
}
