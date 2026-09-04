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
// ?demo&stage=<state>  the STAGE harness (`npm run ui:stage`, app/tools/stage.mjs): NO timeline — jump straight to one
//                  screen state and stay there; window.brxDemo then exposes event triggers (fire/hit/die/respawn/…)
//                  so a reviewer can force in-game events by hand. States: see STAGES below. Extra variants:
//                  &team=blue|yellow|red|green  &respawn=auto|scanner|none  &delay=<respawn secs>  &tminus=<secs>
export function startDemo({ engine, log }) {
  // A demo run is a clean slate — app.js constructs the engine with `storage: null` under ?demo (the constructor
  // restores storage, so it must be decided there; a kitted `?demo&stage=connected` once inherited a live match).
  const frames = [];
  engine.writer = fr => { frames.push(...fr); log(`demo gun ← ${fr.length} frame(s)`, 'lr'); };
  engine.now = () => Date.now(); engine.isSynced = () => true;
  const q = (typeof location !== 'undefined') ? new URLSearchParams(location.search) : new URLSearchParams('');
  const kitOnly = q.has('kit'), locked = q.has('locked'), reject = q.has('reject'), setup = q.has('setup'), brief = q.has('brief');
  if (q.has('night')) engine.night = true;
  const TEAMS = { blue: { team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, yellow: { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 },
    red: { team_id: 'red', name: 'RED', color: 'red', tid: 0 }, green: { team_id: 'green', name: 'GREEN', color: 'green', tid: 3 } };   // tids as MC's TEAM_DEFS / engine TEAM_KEY
  const teamKey = TEAMS[q.get('team')] ? q.get('team') : 'blue', foeKey = teamKey === 'yellow' ? 'blue' : 'yellow';
  const player = { player_id: 'p-demo', player_num: 7, display: 'REAPER', team_id: teamKey, node_id: null, gun_id: 'GUN-A',
    loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male', ready: false };
  // --- A10: the catalog + this player's slot rights ride along in `assign` (docs/spec/loadout.md §4.1) ---
  const notHeavy = DEMO_WEAPONS.filter(w => !(w.tags || []).includes('heavy')).map(w => w.weapon_id);   // the FFA default: NO HEAVIES
  const catalog = { weapons: DEMO_WEAPONS, perks: DEMO_PERKS };
  // A14: three rules — the perk is its own slot
  const policy = locked
    ? { hud_select: true, primary: { choice: 'fixed', allowed_ids: ['sniper_rifle'] }, secondary: { choice: 'off', kinds: ['weapon'], allowed_weapon_ids: [] }, perk: { choice: 'fixed', allowed_perk_ids: ['extended_mags'] } }
    : { hud_select: true, primary: { choice: 'player', allowed_ids: notHeavy }, secondary: { choice: 'player', kinds: ['weapon'], allowed_weapon_ids: notHeavy }, perk: { choice: 'player', allowed_perk_ids: DEMO_PERKS.map(p => p.perk_id) } };
  if (locked) player.loadout = { weapons: [{ weapon_id: 'sniper_rifle' }], perk: 'extended_mags' };
  policy.kit_open = !setup;   // §4.1
  // §4.6: what the BRIEFING shows (the server's assign.game; here built from the demo config)
  const game = locked
    ? { name: 'Silenced Sniper', desc: 'Free-for-all, sniper rifles only, no armor — one shot drops you. Everyone carries Extended Mags.', mode: 'ffa', mode_name: 'FREE-FOR-ALL', abbr: 'FFA',
        teams_text: 'NONE · ALL VS ALL', win_text: 'FRAG LIMIT / TIME', respawn_text: 'ON · TIMED', time_limit_s: 600, respawn: { type: 'auto', delay_s: 15 }, health: { max_hp: 45, max_armor: 0 },
        environment: 'outdoor', night: q.has('night'), loadout_line: 'Everyone carries the Sniper Rifle, no secondary, everyone gets Extended Mags.', ruleset: 'CUSTOM RULES', hud_select: false }
    : { name: 'Team Deathmatch', desc: 'Squads score a point per elimination. Downed players respawn after the delay and rejoin. First team to the score cap — or the highest score at the time limit — takes the match.',
        mode: 'tdm', mode_name: 'TEAM DEATHMATCH', abbr: 'TDM', teams_text: '2–4 TEAMS', win_text: 'SCORE CAP / TIME', respawn_text: 'ON · TIMED', time_limit_s: 600, respawn: { type: 'auto', delay_s: 8 },
        health: { max_hp: 45, max_armor: 70 }, environment: 'outdoor', night: q.has('night'), loadout_line: `You pick your primary (${notHeavy.length} to choose from), slot 2: a second weapon, a perk of your choice (${DEMO_PERKS.length}).`, ruleset: 'NO HEAVIES', hud_select: true };
  // the fake Mission Control answering loadout_request / loadout_browse
  const prevReport = engine.report;
  const tutorialFor = w => ({ weapon: { ...w, stats: { mag: w.clip, reserve: w.reserve, dmg: w.dmg, rof: w.rpm, rng: w.rng } },
    frames: ['$VOL,69,0,*', '$CLEAR,*', '$START,*', '$GSET,0,1,1,0,1,0,50,1,*',
      // $CLEAR wipes the $SIR table and a gun with no rows ignores EVERY hit (F11), so the
      // real bundle (compile.tutorial_frames) restores it here. The demo omitted the row and
      // so taught a bundle that would leave a real gun unhittable.
      '$SIR,0,0,,1,0,0,1,,*',
      '$TID,1,*', `$WEAP,0,${w.weapon_id},*`, '$SPAWN,,*', '$PLAYX,0,*', `$AMMO,0,${w.clip},${w.reserve},1,*`, '$BMAP,0,0,,,,,*'] });
  engine.report = (kind, body) => {
    if (kind === 'loadout_request') {
      const lo = JSON.parse(JSON.stringify(player.loadout));
      let ok = !reject, reason = reject ? 'Host locked this slot' : null;
      const w = DEMO_WEAPONS.find(x => x.weapon_id === body.id), pk = DEMO_PERKS.find(x => x.perk_id === body.id);
      if (ok && body.kind === 'weapon' && !w) { ok = false; reason = 'Unknown weapon'; }
      if (ok && body.kind === 'perk' && !pk) { ok = false; reason = 'Unknown perk'; }
      if (ok && body.slot === 'secondary' && body.kind === 'perk') { ok = false; reason = 'Perks have their own slot this game'; }
      if (ok && body.slot === 'perk' && body.kind === 'weapon') { ok = false; reason = 'Only a perk goes in the perk slot'; }
      // A14: the perk is its own slot; the pick that arrives last wins the ALT-button conflict (policy.set_slot + dropped_by)
      let dropped = null;
      const alt = id => { const k = DEMO_PERKS.find(x => x.perk_id === id); return !!(k && k.effects && k.effects.alt_reload); };
      const wname = id => { const x = DEMO_WEAPONS.find(y => y.weapon_id === id); return x ? x.name : id; };
      const pname = id => { const x = DEMO_PERKS.find(y => y.perk_id === id); return x ? x.name : id; };
      if (ok) {
        if (body.slot === 'primary') lo.weapons[0] = { weapon_id: body.id };
        else if (body.slot === 'secondary') {
          lo.weapons = body.kind === 'weapon' ? [lo.weapons[0], { weapon_id: body.id }] : [lo.weapons[0]];
          if (body.kind === 'weapon' && lo.perk && alt(lo.perk)) { dropped = { slot: 'perk', id: lo.perk, name: pname(lo.perk) }; reason = `${w.name} needs the ALT button to switch — ${pname(lo.perk)} dropped`; lo.perk = null; }
        } else {
          lo.perk = body.kind === 'perk' ? body.id : null;
          if (lo.perk && alt(lo.perk) && lo.weapons[1]) { const sec = lo.weapons[1].weapon_id; dropped = { slot: 'secondary', id: sec, name: wname(sec) }; reason = `${pk.name} takes the ALT button — ${wname(sec)} dropped`; lo.weapons = [lo.weapons[0]]; }
        }
        player.loadout = lo;
      }
      setTimeout(() => {
        engine.onMcMessage({ kind: 'loadout_ack', body: { slot: body.slot, ok, reason, ...(dropped ? { dropped } : {}), loadout: player.loadout } });
        if (ok) engine.onMcMessage({ kind: 'assign', body: { player, team, roster, catalog, policy, game } });
        if (ok && body.try && w) setTimeout(() => engine.onMcMessage({ kind: 'tutorial', body: tutorialFor(w) }), 250);
      }, 300);
      log(`demo MC ← loadout_request ${body.slot} ${body.kind} ${body.id || ''}${body.try ? ' (try)' : ''}`, 'lr');
    } else if (kind === 'loadout_browse') log(`demo MC ← loadout_browse open=${body.open}`, 'lr');
    return prevReport ? prevReport(kind, body) : undefined;
  };
  const team = TEAMS[teamKey], foe = TEAMS[foeKey];
  const roster = [{ player_id: 'p-demo', player_num: 7, display: 'REAPER', team_id: teamKey }, { player_id: 'p-2', player_num: 19, display: 'VIPER', team_id: foeKey }];
  const config = { config_id: golden.config_id, mode: 'tdm', environment: 'outdoor',
    // `?night` is documented at the top of this file but was hardcoded false here, so the
    // config message overwrote the flag set from the URL above and the night theme could
    // never be previewed. Found by the HUD moment suite 2026-09-02.
    night: q.has('night'), time_limit_s: 600,
    respawn: { type: ['auto', 'scanner', 'none'].includes(q.get('respawn')) ? q.get('respawn') : 'auto', delay_s: +q.get('delay') || 8 },
    scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 }, teams: [team, foe] };
  const bundle = { ...golden, player_id: 'p-demo' };

  let hp = 45, armor = 70, mag = 32, reserve = 384;
  const lcd = () => engine.feedFrame(`$LCD,${hp},${armor},0,0,${mag},${reserve},*`);
  const fire = n => { for (let i = 0; i < n && mag > 0; i++) { mag--; engine.feedFrame('$BUT,0,1,*'); engine.feedFrame(`$ALCD,${mag},100,0,${reserve},0,*`); engine.feedFrame('$BUT,0,0,*'); } };
  const reload = () => { const need = 32 - mag; const take = Math.min(need, reserve); reserve -= take; mag += take; engine.feedFrame(`$ALCD,${mag},100,0,${reserve},0,*`); };
  const hit = (dmg = 9) => { if (armor > 0) armor = Math.max(0, armor - dmg); else hp = Math.max(0, hp - dmg); engine.feedFrame(`$HIR,4,0,19,${foe.tid},9,0,3,*`); engine.feedFrame(`$HP,${hp},${armor},0,*`); };


  // ---------- STAGE harness: ?demo&stage=<state> ----------
  const stageName = q.get('stage');
  if (stageName != null) {
    const hud = () => (typeof window !== 'undefined' && window.brx) ? window.brx.hud : null;
    const gunObj = { name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' };
    const ev = {
      // link + MC
      linkGun: () => engine.onBleConnected(gunObj), dropGun: () => engine.onBleDropped(), relinkGun: () => engine.onBleConnected(),
      resyncProbe: () => engine._beginResync('demo'),   // the trigger-first resync prompt (a lobby/armed reconnect, or a resume) — a live rejoin RECONCILES instead (S7.1)
      battery: pct => engine.feedFrame(`$VOLTS,8101,3789,${pct},48,*`),
      mcBound: () => engine.setWsState('bound'), mcLost: () => engine.setWsState('closed'),
      mcRejected: () => engine.setWsState('rejected', { reason: 'roster_full', code: 4003 }),
      scan: () => { const h = hud(); if (h) { h.setScan([{ deviceId: 'a', basename: 'GUN-A', tail: '3D4F', rssi: -52 }, { deviceId: 'b', basename: 'GUN-B', tail: '7C21', rssi: -71, inUse: true }, { deviceId: 'c', basename: 'GUN-C', tail: 'B0E9', rssi: -83 }]); h.render(engine.state()); } },
      // kit-out
      assign: () => engine.onMcMessage({ kind: 'assign', body: { player, team, roster, catalog, policy, game } }),
      kitOpen: open => { policy.kit_open = open; ev.assign(); },
      briefing: () => engine.openBriefing(), briefDone: () => engine.closeBriefing(),
      ready: v => engine.setReady(v == null ? !engine.ready : !!v),
      openLoadout: slot => { const h = hud(); if (h) { h.lo.tab = slot || 'primary'; h.lo.focus = null; h.lo.filter = 'weapons'; } engine.browse(true); },
      closeLoadout: () => engine.browse(false),
      pick: (slot, kind, id) => engine.requestLoadout(slot, kind, id, false),
      tap: sel => { const el = document.querySelector(sel); if (el) el.click(); return !!el; },   // a real tap through the app's data-act delegation (A14 two-tap confirm)
      tryout: id => engine.requestLoadout('primary', 'weapon', id || 'smg', true),
      tryDone: () => engine.dismissTryout(),
      // match control (what Mission Control would send)
      config: () => { engine.onMcMessage({ kind: 'config', body: { config, frames: bundle, roster } }); setTimeout(lcd, 200); },
      start: secs => engine.onMcMessage({ kind: 'start', body: { match_id: 'stage-' + Date.now(), go_live_t: Date.now() + (secs == null ? 30 : secs) * 1000, config_id: golden.config_id, seq: 1, countdown_s: secs == null ? 30 : secs } }),
      abort: () => engine.onMcMessage({ kind: 'control', body: { cmd: 'abort_start', seq: 1 } }),
      end: () => engine.onMcMessage({ kind: 'control', body: { cmd: 'end' } }),
      panic: () => engine.onMcMessage({ kind: 'control', body: { cmd: 'panic' } }),
      endOk: () => engine.ackEnd(),
      score: (kills = 3, deaths = 1, assists = 1) => engine.onMcMessage({ kind: 'score', body: { kills, deaths, assists, accuracy: 41, hits: 11, shots: 28, shots_total: 28,
        board: { teams: [{ team_id: teamKey, name: team.name, score: 18 }, { team_id: foeKey, name: foe.name, score: 21 }], cap: 25 } } }),
      reloadPull: () => engine.feedFrame('$BUT,2,1,*'),   // the gun's reload handle; the mag comes back with the next $ALCD (see `reload`)
      twoWeapons: () => { player.loadout = { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'smg' }], perk: player.loadout.perk || null }; ev.assign(); },
      perk: id => { player.loadout = { ...player.loadout, perk: id }; ev.assign(); },   // A14: the perk rides beside the weapons
      fullKit: () => { player.loadout = { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'glock' }], perk: 'quick_switch' }; ev.assign(); },   // A14: AR + pistol + Quick Switch
      quickSwitch: () => { player.loadout = { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'smg' }], perk: 'quick_switch' }; bundle.swap_ms = 425; ev.assign(); },   // two weapons AND the perk; MC compiles tok15 = 425 into the bundle (bench 2026-09-04)
      alt: () => { engine.feedFrame('$BUT,1,1,*'); engine.feedFrame('$BUT,1,0,*'); },   // the ALT button: a swap with two weapons, a reload with one
      altCycle: () => {                                     // what a real swap looks like: ALT, then the next shot reports the new slot
        if (engine._slotCount() < 2) ev.twoWeapons();
        setTimeout(() => { ev.alt(); setTimeout(() => { const to = engine.activeSlot === 0 ? 1 : 0; engine.feedFrame(`$ALCD,${to === 1 ? 71 : mag},100,${to},${to === 1 ? 288 : reserve},0,*`); }, 700); }, 50);
      },
      reloadCycle: () => {                                  // what a real reload looks like: handle pull, then the refill after the weapon's reload_s
        if (mag >= 32) { log('demo: mag is full — fire first, then reload', 'li'); return; }
        engine.feedFrame('$BUT,2,1,*'); engine.feedFrame('$BUT,2,0,*');
        const w = DEMO_WEAPONS.find(x => x.weapon_id === ((player.loadout.weapons[0] || {}).weapon_id));
        setTimeout(reload, Math.round(((w && w.reload_s) || 1.5) * 1000));
      },
      alert: (kind = 'next_kill_wins', text) => engine.onMcMessage({ kind: 'alert', body: { kind, text: text || ({ next_kill_wins: 'NEXT KILL WINS', bomb_planted: 'BOMB PLANTED', point_captured: 'POINT CAPTURED', lead_taken: 'YOUR TEAM LEADS', time_60: 'ONE MINUTE LEFT', vip_down: 'VIP DOWN' })[kind] || kind.replace(/_/g, ' ').toUpperCase(), t: Date.now() } }),
      killMedals: (medals = ['double_kill', 'killing_spree'], victim = 'VIPER') => engine.onMcMessage({ kind: 'feedback', body: { player_id: 'p-demo', kind: 'kill', t: Date.now(), cue: golden.cues.kill, victim_team: foeKey, victim, medals } }),
      killConfirm: (victim = 'VIPER') => engine.onMcMessage({ kind: 'feedback', body: { player_id: 'p-demo', kind: 'kill', t: Date.now(), cue: golden.cues.kill, victim_team: foeKey, victim } }),
      // the gun (what the tagger would report)
      fire: n => fire(n == null ? 1 : n), reload, hit: d => hit(d == null ? 9 : d),
      spawnEcho: () => { hp = engine.maxHp; armor = engine.maxArmor; mag = 32; reserve = 384; lcd(); },
      die: () => { armor = 0; hp = 0; engine.feedFrame(`$HIR,4,0,19,${foe.tid},9,0,3,*`); engine.feedFrame('$HP,0,0,0,*'); },
      respawn: () => { if (engine.alive) return; engine._revive(false); hp = engine.maxHp; armor = engine.maxArmor; setTimeout(lcd, 250); },
      heal: (n = 15) => { hp = Math.min(engine.maxHp, hp + n); engine.feedFrame(`$HP,${hp},${armor},0,*`); },
      armorUp: (n = 30) => { armor = Math.min(engine.maxArmor, armor + n); engine.feedFrame(`$HP,${hp},${armor},0,*`); },
      lowHp: () => { armor = 0; hp = 8; engine.feedFrame(`$HIR,4,0,19,${foe.tid},9,0,3,*`); engine.feedFrame(`$HP,${hp},${armor},0,*`); },
      lowAmmo: () => { mag = 3; reserve = 0; engine.feedFrame(`$ALCD,${mag},100,0,${reserve},0,*`); },
      emptyMag: () => { mag = 0; engine.feedFrame(`$ALCD,0,100,0,${reserve},0,*`); },
      station: (rssi = -78, present = false, threshold = -74) => { if (typeof engine.setStations !== 'function') { log('demo: this engine has no stations', 'le'); return; }
        const list = rssi == null ? [] : [{ role: 'station', kind: 'respawn', id: 3, team: 255, state: 1, value: 0, rssi, raw: rssi, threshold, present: !!present, seenAt: Date.now() }];
        const pr = (typeof window !== 'undefined' && window.brx) ? window.brx.presence : null;
        if (pr) pr.stations = () => list;   // the app feeds engine.setStations(presence.stations()) every 250 ms — so the fake lives in presence
        engine.setStations(list); },
      scanner: (delay_s = 1, gate = 'trigger') => { config.respawn = { type: 'scanner', delay_s, gate }; },   // stage-time: a scanner game with a short delay so the hint shows quickly
      state: () => engine.state(),
    };
    // each STAGE is a list of [delayMs, step] — the delays give the app's boot + render loop room between steps
    const kit = [[0, 'linkGun'], [50, () => ev.battery(82)], [150, 'assign'], [200, 'mcBound']];
    const kitted = [...kit, [300, 'briefDone']];
    const lobby = [...kitted, [500, 'config']];
    const live = [...lobby, [900, () => ev.start(0.4)], [1800, 'spawnEcho']];
    const STAGES = {
      'idle':              [[0, 'scan']],
      'connected':         [[0, 'linkGun'], [50, () => ev.battery(82)]],
      'setup':             [[0, () => { policy.kit_open = false; }], ...kit],
      'briefing':          kit,
      'kitted':            kitted,
      'kitted-ready':      [...kitted, [400, () => ev.ready(true)]],
      'loadout-primary':   [...kitted, [400, () => ev.openLoadout('primary')]],
      'loadout-secondary': [...kitted, [400, () => ev.openLoadout('secondary')]],
      'loadout-picked':    [...kitted, [400, () => ev.openLoadout('primary')], [600, () => ev.pick('primary', 'weapon', 'smg')]],
      'loadout-sidearms':  [[0, () => { policy.secondary.kinds = ['sidearm']; policy.secondary.allowed_weapon_ids = DEMO_WEAPONS.filter(w => w.role === 'sidearm').map(w => w.weapon_id); }], ...kitted, [400, () => ev.openLoadout('secondary')]],
      'kitted-perk':       [...kitted, [400, () => ev.pick('perk', 'perk', 'quick_hands')]],
      'kitted-full':       [[0, 'fullKit'], ...kitted],                                                       // A14: all three plates filled
      'loadout-perk':      [[0, 'fullKit'], ...kitted, [400, () => ev.openLoadout('perk')]],
      'loadout-perk-conflict': [[0, 'twoWeapons'], ...kitted, [400, () => ev.openLoadout('perk')], [700, () => ev.tap('.lrow[data-arg="perk:easy_reload"]')]],   // first tap = the warning
      'tryout':            [...kitted, [400, () => ev.tryout('smg')]],
      'lobby':             lobby,
      'armed':             [...lobby, [900, () => ev.start(+q.get('tminus') || 30)]],
      'aborted':           [...lobby, [900, () => ev.start(30)], [1600, 'abort']],
      'live':              live,
      'live-fired':        [...live, [2300, () => ev.fire(7)]],
      'live-hit':          [...live, [2300, () => { ev.hit(); ev.hit(); ev.hit(); }]],
      'live-lowhp':        [...live, [2300, 'lowHp']],
      'live-lowammo':      [...live, [2300, () => ev.fire(29)]],
      'live-kill':         [...live, [2300, () => ev.killConfirm()]],
      'down':              [...live, [2300, () => ev.score(3, 1, 1)], [2350, 'die']],
      'live-reload':       [...live, [2300, () => ev.fire(12)], [2600, 'reloadCycle']],
      'live-switch':       [[0, 'twoWeapons'], ...live, [2300, () => ev.fire(3)], [2600, 'altCycle']],
      'live-switch-perk':  [[0, 'quickSwitch'], ...live, [2300, () => ev.fire(3)], [2600, 'alt']],
      'down-hold':         [[0, () => ev.scanner(8)], ...live, [2300, 'die'], [2400, () => ev.station(-70, true)]],
      'down-find':         [[0, () => ev.scanner(1)], ...live, [2300, 'die'], [2400, () => ev.station(null)]],
      'down-find-presence': [[0, () => ev.scanner(1, 'presence')], ...live, [2300, 'die'], [2400, () => ev.station(null)]],
      'down-approach':     [[0, () => ev.scanner(1)], ...live, [2300, 'die'], [2400, () => ev.station(-78, false)]],
      'down-at':           [[0, () => ev.scanner(1)], ...live, [2300, 'die'], [2400, () => ev.station(-58, true)]],
      'live-alert':        [...live, [2300, () => ev.alert('bomb_planted')]],
      'live-medals':       [...live, [2300, () => ev.killMedals(['double_kill', 'killing_spree'])]],
      'redeploy':          [...live, [2300, 'die'], [2800, 'respawn']],
      'live-nogun':        [...live, [2300, 'dropGun']],
      'resync':            [...live, [2300, 'dropGun'], [3300, 'relinkGun']],   // a live rejoin → the 3 s RECONCILING takeover (S7.1)
      'resync-prompt':     [...live, [2300, 'resyncProbe']],                     // the trigger-first resync prompt itself
      'live-mclost':       [...live, [2300, 'mcLost']],
      'mc-rejected':       [...kitted, [400, 'mcRejected']],
      'result':            [...live, [2200, () => ev.fire(12)], [2300, () => ev.score(3, 1, 1)], [2400, 'end']],
      'over':              [...live, [2200, () => ev.fire(12)], [2300, () => ev.score(3, 1, 1)], [2400, 'end'], [2600, 'endOk']],
      'panic':             [...live, [2300, 'panic']],
    };
    const steps = STAGES[stageName];
    if (!steps) log(`stage "${stageName}" unknown — one of: ${Object.keys(STAGES).join(' ')}`, 'le');
    else { for (const [ms, st] of steps) setTimeout(() => { try { (typeof st === 'string' ? ev[st] : st)(); } catch (e) { log(`stage step failed: ${e && e.message || e}`, 'le'); } }, 300 + ms); log(`stage "${stageName}" — ${steps.length} step(s)`, 'lk'); }
    return { ...ev, stages: Object.keys(STAGES), stage: stageName, fire, hit, reload, lcd };
  }

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
