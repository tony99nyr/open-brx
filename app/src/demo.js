// ?demo — a fake gun + a fake Mission Control so the HUD runs in a desktop browser with no
// hardware and no server. Feeds the engine scripted BRX frames and MC messages.
import golden from '../../mcp/brx_mcp/mc/golden_bundle.json';

export function startDemo({ engine, log }) {
  const frames = [];
  engine.writer = fr => { frames.push(...fr); log(`demo gun ← ${fr.length} frame(s)`, 'lr'); };
  engine.now = () => Date.now(); engine.isSynced = () => true;
  const player = { player_id: 'p-demo', player_num: 7, display: 'REAPER', team_id: 'blue', node_id: null, gun_id: 'GUN-A',
    loadout: { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'shotgun' }] }, voice: 'male', ready: false };
  const team = { team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 };
  const roster = [{ player_id: 'p-demo', player_num: 7, display: 'REAPER', team_id: 'blue' }, { player_id: 'p-2', player_num: 19, display: 'VIPER', team_id: 'yellow' }];
  const config = { config_id: golden.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 }, teams: [team, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }] };
  const bundle = { ...golden, player_id: 'p-demo' };

  let hp = 45, armor = 70, mag = 32, reserve = 384;
  const lcd = () => engine.feedFrame(`$LCD,${hp},${armor},0,0,${mag},${reserve},*`);
  const fire = n => { for (let i = 0; i < n && mag > 0; i++) { mag--; engine.feedFrame('$BUT,0,1,*'); engine.feedFrame(`$ALCD,${mag},100,0,${reserve},0,*`); engine.feedFrame('$BUT,0,0,*'); } };
  const reload = () => { const need = 32 - mag; const take = Math.min(need, reserve); reserve -= take; mag += take; engine.feedFrame(`$ALCD,${mag},100,0,${reserve},0,*`); };
  const hit = (dmg = 9) => { if (armor > 0) armor = Math.max(0, armor - dmg); else hp = Math.max(0, hp - dmg); engine.feedFrame('$HIR,4,0,19,2,9,0,3,*'); engine.feedFrame(`$HP,${hp},${armor},0,*`); };

  const t0 = Date.now();
  // 0 s: gun linked; 1 s: kit-out; 2 s: config; 4 s: start with an 8 s runway
  setTimeout(() => engine.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' }), 300);
  setTimeout(() => engine.feedFrame('$VOLTS,8101,3789,82,48,*'), 600);
  setTimeout(() => engine.onMcMessage({ kind: 'assign', body: { player, team, roster } }), 1200);
  setTimeout(() => { engine.setWsState('bound'); }, 1300);
  setTimeout(() => { engine.onMcMessage({ kind: 'config', body: { config, frames: bundle, roster } }); setTimeout(lcd, 300); }, 2600);
  setTimeout(() => engine.onMcMessage({ kind: 'start', body: { match_id: 'demo-1', go_live_t: Date.now() + 9000, config_id: golden.config_id, seq: 1, countdown_s: 9 } }), 4200);
  // after spawn: echo, shoot, get shot, die, respawn, get a kill confirm
  const afterSpawn = 4200 + 9000;
  setTimeout(() => { hp = 45; armor = 70; mag = 32; reserve = 384; lcd(); }, afterSpawn + 400);
  setTimeout(() => fire(3), afterSpawn + 2500);
  setTimeout(() => engine.onMcMessage({ kind: 'feedback', body: { player_id: 'p-demo', kind: 'kill', t: Date.now(), cue: golden.cues.kill, victim_team: 'yellow', victim: 'VIPER' } }), afterSpawn + 4500);
  setTimeout(() => { hit(); hit(); hit(); }, afterSpawn + 9000);
  setTimeout(() => { for (let i = 0; i < 6; i++) hit(); }, afterSpawn + 12000);
  setTimeout(() => fire(20), afterSpawn + 13000);
  setTimeout(() => { for (let i = 0; i < 4; i++) hit(); }, afterSpawn + 16000);  // dies
  setTimeout(() => { hp = 45; armor = 70; lcd(); }, afterSpawn + 16000 + 8500);   // gun echoes revive
  setTimeout(() => { reload(); fire(5); }, afterSpawn + 27000);
  setTimeout(() => engine.onMcMessage({ kind: 'score', body: { kills: 3, deaths: 1, assists: 1, accuracy: .41, shots_total: 28 } }), afterSpawn + 29000);
  setTimeout(() => { engine.onBleDropped(); setTimeout(() => engine.onBleConnected(), 2500); }, afterSpawn + 33000); // resync prompt
  setTimeout(() => fire(1), afterSpawn + 38000);
  log('demo running — scripted gun + MC (t0=' + t0 + ')', 'lk');
  return { fire, hit, reload, lcd };
}
