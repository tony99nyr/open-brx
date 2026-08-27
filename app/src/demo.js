// ?demo — a fake gun + a fake Mission Control so the HUD runs in a desktop browser with no
// hardware and no server. Feeds the engine scripted BRX frames and MC messages.
import golden from '../../mcp/brx_mcp/mc/golden_bundle.json';

import { DEMO_WEAPONS, DEMO_PERKS } from './demo-catalog.js';   // a COPY of the server catalog shape (regenerate from weapons.json when it changes)

// ?demo            scripted match (kit → arm → live → down → redeploy…)
// ?demo&kit        stops at KITTED so the LOADOUT browser can be explored (fake MC answers picks after ~300 ms)
// ?demo&kit&locked policy host/fixed — the padlock states
// ?demo&kit&reject the fake MC refuses every pick ("Host locked this slot") — the red reason chip
// ?demo&kit&night  night theme
// ?demo&kit&setup  kit_open false — "MISSION CONTROL IS SETTING UP THE GAME" (flips open after 7 s so the reveal can be watched)
// ?demo&kit&brief  lands on the BRIEFING (the default ?demo variants auto-dismiss it so the plates/browser are reachable)
export function startDemo({ engine, log }) {
  const frames = [];
  engine.writer = fr => { frames.push(...fr); log(`demo gun ← ${fr.length} frame(s)`, 'lr'); };
  engine.now = () => Date.now(); engine.isSynced = () => true;
  const q = (typeof location !== 'undefined') ? new URLSearchParams(location.search) : new URLSearchParams('');
  const kitOnly = q.has('kit'), locked = q.has('locked'), reject = q.has('reject'), setup = q.has('setup'), brief = q.has('brief');
  if (q.has('night')) engine.night = true;
  const player = { player_id: 'p-demo', player_num: 7, display: 'REAPER', team_id: 'blue', node_id: null, gun_id: 'GUN-A',
    loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male', ready: false };
  // --- A10: the catalog + this player's slot rights ride along in `assign` (docs/spec/loadout.md §4.1) ---
  const notHeavy = DEMO_WEAPONS.filter(w => !(w.tags || []).includes('heavy')).map(w => w.weapon_id);   // the FFA default: NO HEAVIES
  const catalog = { weapons: DEMO_WEAPONS, perks: DEMO_PERKS };
  const policy = locked
    ? { hud_select: true, primary: { choice: 'fixed', allowed_ids: ['sniper_rifle'] }, secondary: { choice: 'off', kinds: [], allowed_weapon_ids: [], allowed_perk_ids: [] } }
    : { hud_select: true, primary: { choice: 'player', allowed_ids: notHeavy }, secondary: { choice: 'player', kinds: ['weapon', 'perk'], allowed_weapon_ids: notHeavy, allowed_perk_ids: DEMO_PERKS.map(p => p.perk_id) } };
  if (locked) player.loadout = { weapons: [{ weapon_id: 'sniper_rifle' }] };
  policy.kit_open = !setup;   // §4.1
  // §4.6: what the BRIEFING shows (the server's assign.game; here built from the demo config)
  const game = locked
    ? { name: 'Silenced Sniper', desc: 'Free-for-all, sniper rifles only, no armor — one shot drops you. Everyone carries Extended Mags.', mode: 'ffa', mode_name: 'FREE-FOR-ALL', abbr: 'FFA',
        teams_text: 'NONE · ALL VS ALL', win_text: 'FRAG LIMIT / TIME', respawn_text: 'ON · TIMED', time_limit_s: 600, respawn: { type: 'auto', delay_s: 15 }, health: { max_hp: 45, max_armor: 0 },
        environment: 'outdoor', night: q.has('night'), loadout_line: 'Everyone carries the Sniper Rifle, everyone gets Extended Mags in slot 2.', ruleset: 'CUSTOM RULES', hud_select: false }
    : { name: 'Team Deathmatch', desc: 'Squads score a point per elimination. Downed players respawn after the delay and rejoin. First team to the score cap — or the highest score at the time limit — takes the match.',
        mode: 'tdm', mode_name: 'TEAM DEATHMATCH', abbr: 'TDM', teams_text: '2–4 TEAMS', win_text: 'SCORE CAP / TIME', respawn_text: 'ON · TIMED', time_limit_s: 600, respawn: { type: 'auto', delay_s: 8 },
        health: { max_hp: 45, max_armor: 70 }, environment: 'outdoor', night: q.has('night'), loadout_line: `You pick your primary (${notHeavy.length} to choose from), slot 2: a second weapon or a perk.`, ruleset: 'NO HEAVIES', hud_select: true };
  // the fake Mission Control answering loadout_request / loadout_browse
  const prevReport = engine.report;
  const tutorialFor = w => ({ weapon: { ...w, stats: { mag: w.clip, reserve: w.reserve, dmg: w.dmg, rof: w.rpm, rng: w.rng } },
    frames: ['$VOL,69,0,*', '$CLEAR,*', '$START,*', '$GSET,0,1,1,0,1,0,50,1,*', '$TID,1,*', `$WEAP,0,${w.weapon_id},*`, '$SPAWN,,*', '$PLAYX,0,*', `$AMMO,0,${w.clip},${w.reserve},1,*`, '$BMAP,0,0,,,,,*'] });
  engine.report = (kind, body) => {
    if (kind === 'loadout_request') {
      const lo = JSON.parse(JSON.stringify(player.loadout));
      let ok = !reject, reason = reject ? 'Host locked this slot' : null;
      const w = DEMO_WEAPONS.find(x => x.weapon_id === body.id), pk = DEMO_PERKS.find(x => x.perk_id === body.id);
      if (ok && body.kind === 'weapon' && !w) { ok = false; reason = 'Unknown weapon'; }
      if (ok && body.kind === 'perk' && !pk) { ok = false; reason = 'Unknown perk'; }
      if (ok) {
        if (body.slot === 'primary') lo.weapons[0] = { weapon_id: body.id };
        else if (body.kind === 'weapon') { lo.weapons = [lo.weapons[0], { weapon_id: body.id }]; lo.perk = null; }
        else if (body.kind === 'perk') { lo.weapons = [lo.weapons[0]]; lo.perk = body.id; }
        else { lo.weapons = [lo.weapons[0]]; lo.perk = null; }
        player.loadout = lo;
      }
      setTimeout(() => {
        engine.onMcMessage({ kind: 'loadout_ack', body: { slot: body.slot, ok, reason, loadout: player.loadout } });
        if (ok) engine.onMcMessage({ kind: 'assign', body: { player, team, roster, catalog, policy, game } });
        if (ok && body.try && w) setTimeout(() => engine.onMcMessage({ kind: 'tutorial', body: tutorialFor(w) }), 250);
      }, 300);
      log(`demo MC ← loadout_request ${body.slot} ${body.kind} ${body.id || ''}${body.try ? ' (try)' : ''}`, 'lr');
    } else if (kind === 'loadout_browse') log(`demo MC ← loadout_browse open=${body.open}`, 'lr');
    return prevReport ? prevReport(kind, body) : undefined;
  };
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
  setTimeout(() => { engine.onMcMessage({ kind: 'assign', body: { player, team, roster, catalog, policy, game } }); if (!brief && !setup) engine.closeBriefing(); }, 1200);
  if (setup) setTimeout(() => { policy.kit_open = true; engine.onMcMessage({ kind: 'assign', body: { player, team, roster, catalog, policy, game } }); log('demo MC → kit open (BRIEFING)', 'lk'); }, 7000);
  setTimeout(() => { engine.setWsState('bound'); }, 1300);
  if (kitOnly) { log('demo (kit) — staying in KITTED: open a slot plate to browse the loadout', 'lk'); return { fire, hit, reload, lcd }; }
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
