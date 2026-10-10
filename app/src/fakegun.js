// ?mc=ws://host:8766/ws&gun=GUN-A-3D4F — a FAKE GUN + the REAL Mission Control: the HUD runs the true
// transport/engine against a live MC server with no hardware. The fake gun answers writes the way a real
// tagger does, as mcp/brx_mcp/fake.py models it: one $ALCD per $WEAP or $AMMO slot write; $SPAWN →
// $LCD,<hp>,<armor>,0,0,<mag>,<reserve>,*; the $LIFE,0,0,0 probe and $QUERY answer the pools. Drive it from the console / playwright: window.fakeGun.fire(n) /
// .hit(n[,shooter,team]) / .kill() / .reload() / .volts().
export function installFakeGun({ engine, log, name = 'GUN-A-3D4F' }) {
  // A9 (review 2026-10-10): the replies below are mcp/brx_mcp/fake.py FakeTagger's, the bench-proven gun CI uses;
  // app/test/fakegun-cases.test.mjs holds them to app/test/fixtures/gun-replies.json, which is generated from it.
  let hp = 45, armor = 70, spawned = false, maxHp = 45, maxArmor = 70, maxShield = 0, team = 0;
  /** One magazine and reserve per slot (fake.py `mag`/`reserve`), and what a $SPAWN refills each $WEAP slot to. */
  const mag = {}, reserve = {}, spawnFill = {};
  const num = (t, i) => (/^-?\d+$/.test(t[i] || '') ? +t[i] : null);
  const alcd = slot => `$ALCD,${mag[slot] ?? 0},100,${slot},${reserve[slot] ?? 0},0,*`;
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
        spawned = true; hp = maxHp; armor = maxArmor;
        for (const [slot, [clip, carried]] of Object.entries(spawnFill)) { mag[slot] = clip; reserve[slot] = carried; }
        now.push(`$LCD,${hp},${armor},0,0,${mag[0] ?? 0},${reserve[0] ?? 0},*`);
      } else if (f === '$LIFE,0,0,0,*') {
        now.push(spawned ? `$HP,${hp},${armor},0,*` : '$HP,0,0,0,*');   // the F264 read probe: live pools, or a dead gun's zeros
      } else if (cmd === 'QUERY') {
        now.push(`$QUERY,0,${team},${maxHp},${maxArmor},${maxShield},,1,*`, `$LCD,${hp},${armor},0,0,${mag[0] ?? 0},${reserve[0] ?? 0},*`);
      }
    }
    if (frames.includes('$CLEAR,*') && frames.some(f => f.startsWith('$SP,99'))) spawned = false;
    setTimeout(() => { for (const f of [...now, ...later]) feed(f); }, 120);
    log(`fakegun ← ${frames.length} frame(s)`, 'lr');
  };
  const api = {
    fire(n = 1) { for (let i = 0; i < n && (mag[0] ?? 0) > 0; i++) { mag[0]--; feed('$BUT,0,1,*'); if (spawned) feed(alcd(0)); feed('$BUT,0,0,*'); } },
    reload() { const cap = spawnFill[0]?.[0] ?? mag[0] ?? 0; const take = Math.min(cap - (mag[0] ?? 0), reserve[0] ?? 0);
      reserve[0] = (reserve[0] ?? 0) - take; mag[0] = (mag[0] ?? 0) + take; feed('$BUT,2,1,*'); feed('$BUT,2,0,*'); if (spawned) feed(alcd(0)); },
    hit(n = 1, shooter = 19, team = 2, dmg = 9) { for (let i = 0; i < n; i++) { if (!spawned) return;
      if (armor >= dmg) armor -= dmg; else { hp = Math.max(0, hp - (dmg - armor)); armor = 0; }
      feed(`$HIR,4,0,${shooter},${team},${dmg},0,0,*`); feed(`$HP,${hp},${armor},0,*`);
      if (hp === 0) { spawned = false; feed('$LCD,0,0,0,1,1,1,*'); } } },   // the protocol death $LCD (§4.1, bench 2026-09-18)
    kill(shooter = 19, team = 2) { while (hp > 0) api.hit(1, shooter, team, 24); },
    volts() { feed('$VOLTS,8101,3789,82,48,*'); },
    drop() { engine.onBleDropped(); },              // walk out of BLE range
    relink() { engine.onBleConnected({ name, basename: name.split('-').slice(0, -1).join('-'), tail: name.split('-').pop() }); },
    state: () => ({ hp, armor, mag: mag[0] ?? 0, reserve: reserve[0] ?? 0, spawned }),
    writes,
  };
  // link the gun IMMEDIATELY — the boot hook connects MC right after, so the hello carries the gun
  engine.onBleConnected({ name, basename: name.split('-').slice(0, -1).join('-'), tail: name.split('-').pop() });
  api.volts();
  return api;
}
