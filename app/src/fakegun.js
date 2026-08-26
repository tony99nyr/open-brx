// ?mc=ws://host:8766/ws&gun=GUN-A-3D4F — a FAKE GUN + the REAL Mission Control: the HUD runs the true
// transport/engine against a live MC server with no hardware. The fake gun answers writes the way a real
// tagger does (bench-verified echoes, protocol §7r): head → 3×$ALCD config echoes; spawn/revive →
// $LCD,<hp>,<armor>,… + $ALCD refill. Drive it from the console / playwright: window.fakeGun.fire(n) /
// .hit(n[,shooter,team]) / .kill() / .reload() / .volts().
export function installFakeGun({ engine, log, name = 'GUN-A-3D4F' }) {
  let hp = 45, armor = 70, mag = 32, reserve = 384, spawned = false;
  const feed = f => engine.feedFrame(f);
  engine.writer = (frames) => {
    const batch = frames.join(' ');
    setTimeout(() => {
      if (batch.includes('$PSET')) { feed('$ALCD,32,100,0,9999999,0,*'); feed('$ALCD,24,100,1,12,0,*'); feed('$ALCD,1,100,4,0,0,*'); }
      if (batch.includes('$SPAWN')) { spawned = true; hp = 45; armor = 70; mag = 32;
        feed(`$LCD,${hp},${armor},0,0,${mag},32768,*`); feed(`$ALCD,${mag},100,0,${reserve},0,*`); }
      if (batch.includes('$CLEAR') && batch.includes('$SP,99')) { spawned = false; }
    }, 120);
    log(`fakegun ← ${frames.length} frame(s)`, 'lr');
  };
  const api = {
    fire(n = 1) { for (let i = 0; i < n && mag > 0; i++) { mag--; feed('$BUT,0,1,*'); if (spawned) feed(`$ALCD,${mag},100,0,${reserve},0,*`); feed('$BUT,0,0,*'); } },
    reload() { const take = Math.min(32 - mag, reserve); reserve -= take; mag += take; feed('$BUT,2,1,*'); feed('$BUT,2,0,*'); if (spawned) feed(`$ALCD,${mag},100,0,${reserve},0,*`); },
    hit(n = 1, shooter = 19, team = 2, dmg = 9) { for (let i = 0; i < n; i++) { if (!spawned) return;
      if (armor >= dmg) armor -= dmg; else { hp = Math.max(0, hp - (dmg - armor)); armor = 0; }
      feed(`$HIR,4,0,${shooter},${team},${dmg},0,0,*`); feed(`$HP,${hp},${armor},0,*`);
      if (hp === 0) { spawned = false; feed(`$LCD,0,0,0,0,${mag},${reserve},*`); } } },
    kill(shooter = 19, team = 2) { while (hp > 0) api.hit(1, shooter, team, 24); },
    volts() { feed('$VOLTS,8101,3789,82,48,*'); },
    state: () => ({ hp, armor, mag, reserve, spawned }),
  };
  // link the gun IMMEDIATELY — the boot hook connects MC right after, so the hello carries the gun
  engine.onBleConnected({ name, basename: name.split('-').slice(0, -1).join('-'), tail: name.split('-').pop() });
  api.volts();
  return api;
}
