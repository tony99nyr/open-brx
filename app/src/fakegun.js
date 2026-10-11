// ?mc=ws://host:8766/ws&gun=GUN-A-3D4F — a FAKE GUN + the REAL Mission Control: the HUD runs the true
// transport/engine against a live MC server with no hardware. The fake gun answers writes the way a real
// tagger does, as mcp/brx_mcp/fake.py models it: one $ALCD per $WEAP or $AMMO slot write; $SPAWN →
// $LCD,<hp>,<armor>,0,0,<mag>,<reserve>,*; the $LIFE,0,0,0 probe and $QUERY answer the pools. Drive it from the console / playwright: window.fakeGun.fire(n) /
// .hit(n[,shooter,team]) / .kill() / .reload() / .volts().
export function installFakeGun({ engine, log, name = 'GUN-A-3D4F' }) {
  // A9 (review 2026-10-10): the replies below are mcp/brx_mcp/fake.py FakeTagger's, the bench-proven gun CI uses;
  // app/test/fakegun-cases.test.mjs holds them to app/test/fixtures/gun-replies.json, which is generated from it.
  let hp = 45, armor = 70, shield = 0, spawned = false, maxHp = 45, maxArmor = 70, maxShield = 0, team = 0, playerId = 0;
  /** One magazine and reserve per slot (fake.py `mag`/`reserve`), and what a $SPAWN refills each $WEAP slot to. */
  const mag = {}, reserve = {}, spawnFill = {};
  const num = (t, i) => (/^-?\d+$/.test(t[i] || '') ? +t[i] : null);
  const alcd = slot => `$ALCD,${mag[slot] ?? 0},100,${slot},${reserve[slot] ?? 0},0,*`;
  /** The death $LCD (fake.py `_death_lcd`): pools 0, then slot 0's magazine and reserve; the rig fires slot 0 only. */
  const deathLcd = () => `$LCD,0,0,0,0,${mag[0] ?? 0},${reserve[0] ?? 0},*`;
  const feed = f => engine.feedFrame(f);
  const writes = [];                                  // every frame the 'gun' received — e2e assertions read this
  engine.writer = (frames) => {
    writes.push(...frames);
    const now = [], later = [];                       // fake.py: instant replies first, then each write's delayed $ALCD
    for (const f of frames) {
      const t = f.replace(/^\$/, '').replace(/,?\*$/, '').split(',');
      const cmd = t[0];
      if (cmd === 'TID') { if (num(t, 1) != null) team = num(t, 1); }
      else if (cmd === 'PSET') {
        // F341: the pools a spawn arms are the last `$PSET`'s t3/t4 (t5 is the shield ceiling), as on a real gun
        if (num(t, 1) != null) playerId = num(t, 1);   // t1 = the player id `$QUERY` reports (MC's F271 read-back)
        if (num(t, 3) != null) maxHp = num(t, 3);
        if (num(t, 4) != null) maxArmor = num(t, 4);
        if (num(t, 5) != null) maxShield = num(t, 5);
      } else if (cmd === 'WEAP') {
        // F259/S42 + F207: a $WEAP resets the slot's magazine to its clip (t16, index 17) and its reserve to t40
        // (index 41; t17 // 2 when absent), and a $SPAWN refills it to the carried t17 (index 18)
        const slot = num(t, 1);
        if (slot == null) continue;
        const clip = num(t, 17), full = num(t, 18);
        const rsv = num(t, 41) ?? (full == null ? null : Math.floor(full / 2));
        if (clip != null) mag[slot] = clip;
        if (rsv != null) reserve[slot] = rsv;
        const carried = full ?? rsv;
        if (clip != null && carried != null) spawnFill[slot] = [clip, carried];
        later.push(alcd(slot));
      } else if (cmd === 'AMMO') {
        // `$AMMO,<slot>,<mag>,<reserve>,…` sets both outright, and the gun echoes them (ammo.js `echoGens`)
        const slot = num(t, 1);
        if (slot == null) continue;
        if (num(t, 2) != null) mag[slot] = num(t, 2);
        if (num(t, 3) != null) reserve[slot] = num(t, 3);
        later.push(alcd(slot));
      } else if (cmd === 'SPAWN') {
        // the protocol `$SPAWN` row and the F264 bench log: one `$LCD` with the pools and slot 0's refilled counts
        spawned = true; hp = maxHp; armor = maxArmor; shield = 0;   // F41: a spawn's shield is always 0
        for (const [slot, [clip, carried]] of Object.entries(spawnFill)) { mag[slot] = clip; reserve[slot] = carried; }
        now.push(`$LCD,${hp},${armor},0,0,${mag[0] ?? 0},${reserve[0] ?? 0},*`);
      } else if (cmd === 'LIFE') {
        // fake.py's $LIFE (bench 2026-09-09/17/19, protocol $LIFE row): additive per pool, floored at 0, capped at the
        // $PSET maxima, no spill; mode 1 (t4) is an absolute set clamped at the maxima, mode 2 an unclamped one. The
        // gun answers $HP, or the death $LCD when the write kills; a dead gun answers the F264 zero probe with $HP,0,0,0.
        const d = [1, 2, 3].map(i => num(t, i) ?? 0), mode = num(t, 4);
        if (!spawned && mode !== 1 && mode !== 2 && d.every(v => v === 0)) { now.push('$HP,0,0,0,*'); continue; }
        if (mode === 1 || mode === 2) {
          const caps = mode === 1 ? [maxHp, maxArmor, maxShield] : [1e6, 1e6, 1e6];
          [hp, armor, shield] = d.map((v, i) => Math.max(0, Math.min(caps[i], v)));
        } else {
          const clamp = (cur, cap, v) => Math.max(0, Math.min(cap, cur + v));
          hp = clamp(hp, maxHp, d[0]); armor = clamp(armor, maxArmor, d[1]); shield = clamp(shield, maxShield, d[2]);
        }
        spawned = hp > 0;
        now.push(spawned ? `$HP,${hp},${armor},${shield},*` : deathLcd());
        // One death $LCD for a lethal $LIFE and an IR kill alike (fake.py `_death_lcd`: bench 0,32,192 and 0,6,24).
      } else if (cmd === 'QUERY') {
        now.push(`$QUERY,${playerId},${team},${maxHp},${maxArmor},${maxShield},,1,*`, `$LCD,${hp},${armor},0,0,${mag[0] ?? 0},${reserve[0] ?? 0},*`);
      }
    }
    if (frames.includes('$CLEAR,*') && frames.some(f => f.startsWith('$SP,99'))) spawned = false;
    // fake.py's timing: a reply to the write itself comes at once, a $WEAP/$AMMO $ALCD after its 40 ms write latency
    setTimeout(() => { for (const f of now) feed(f); }, 0);
    if (later.length) setTimeout(() => { for (const f of later) feed(f); }, 40);
    log(`fakegun ← ${frames.length} frame(s)`, 'lr');
  };
  const api = {
    fire(n = 1) { for (let i = 0; i < n && (mag[0] ?? 0) > 0; i++) { mag[0]--; feed('$BUT,0,1,*'); if (spawned) feed(alcd(0)); feed('$BUT,0,0,*'); } },
    // The clip is slot 0's $WEAP t16 (spawnFill); before any $WEAP there is none, so reload() cannot refill (fine for the rig).
    reload() { const cap = spawnFill[0]?.[0] ?? mag[0] ?? 0; const take = Math.max(0, Math.min(cap - (mag[0] ?? 0), reserve[0] ?? 0));
      reserve[0] = (reserve[0] ?? 0) - take; mag[0] = (mag[0] ?? 0) + take; feed('$BUT,2,1,*'); feed('$BUT,2,0,*'); if (spawned) feed(alcd(0)); },
    hit(n = 1, shooter = 19, team = 2, dmg = 9) { for (let i = 0; i < n; i++) { if (!spawned) return;
      let d = dmg;                                    // fake.py `_drain_pools`: shield, then armour, then HP
      const fromShield = Math.min(shield, d); shield -= fromShield; d -= fromShield;
      if (armor >= d) armor -= d; else { hp = Math.max(0, hp - (d - armor)); armor = 0; }
      feed(`$HIR,4,0,${shooter},${team},${dmg},0,0,*`); feed(`$HP,${hp},${armor},${shield},*`);
      if (hp === 0) { spawned = false; feed(deathLcd()); } } },   // bench 2026-09-18 (levers §22): `$HP,0,0,0` then the counts
    kill(shooter = 19, team = 2) { while (hp > 0) api.hit(1, shooter, team, 24); },
    volts() { feed('$VOLTS,8101,3789,82,48,*'); },
    drop() { engine.onBleDropped(); },              // walk out of BLE range
    relink() { engine.onBleConnected({ name, basename: name.split('-').slice(0, -1).join('-'), tail: name.split('-').pop() }); },
    state: () => ({ hp, armor, shield, mag: mag[0] ?? 0, reserve: reserve[0] ?? 0, spawned }),
    writes,
  };
  // link the gun IMMEDIATELY — the boot hook connects MC right after, so the hello carries the gun
  engine.onBleConnected({ name, basename: name.split('-').slice(0, -1).join('-'), tail: name.split('-').pop() });
  api.volts();
  return api;
}
