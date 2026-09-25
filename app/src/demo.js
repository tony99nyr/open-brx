// ?demo — a fake gun + a fake Mission Control so the HUD runs in a desktop browser with no
// hardware and no server. Feeds the engine scripted BRX frames and MC messages.
import golden from '../../mcp/brx_mcp/mc/golden_bundle.json';

import { DEMO_WEAPONS, DEMO_PERKS } from './demo-catalog.js';   // a COPY of the server catalog shape (regenerate from weapons.json when it changes)
import { GunPicker } from './gunpicker.js';   // F258: the stage drives the picker the phone drives
import { NUS } from './brxlink.js';
import { locationCheck } from './location.js';   // F340: the stage runs the phone's own Location check
import { offerText } from './transport/autojoin.js';   // A60: the JOIN row's text, exactly as app.js `offerMc` builds it

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
  // A26: the row's ⟳ (tapped, still arming) normally lasts ~700 ms — the node's 400 ms debounce plus this
  // fake MC's 300 ms. `ev.slowAck(ms)` stretches the MC half so the arming state can be LOOKED at.
  let ackDelayMs = 300;
  const tutorialFor = w => ({ weapon: { ...w, stats: { mag: w.clip, reserve: w.reserve, dmg: w.dmg, rof: w.rpm, rng: w.rng } },
    frames: ['$VOL,69,0,*', '$CLEAR,*', '$START,*', '$GSET,0,0,1,0,1,0,50,1,*',
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
        // F147: the real gun answers a try-out's `$WEAP`/`$AMMO` write with its own ammo report a beat later —
        // engine.js now waits for exactly that (`tryoutArming`) before the rack reads EQUIPPED rather than
        // SWITCHING…. Simulate it (200 ms, comfortably under TRYOUT_ARM_MAX_MS) so the demo/stage mirrors the
        // real timeline instead of only ever resolving through the 3 s "assumed" timeout.
        if (ok && body.try && w) setTimeout(() => { engine.onMcMessage({ kind: 'tutorial', body: tutorialFor(w) });
          setTimeout(() => engine.feedFrame(`$ALCD,${w.clip},100,0,${w.reserve},0,*`), 200); }, 250);
      }, ackDelayMs);
      log(`demo MC ← loadout_request ${body.slot} ${body.kind} ${body.id || ''}${body.try ? ' (try)' : ''}`, 'lr');
    } else if (kind === 'loadout_browse') log(`demo MC ← loadout_browse open=${body.open}`, 'lr');
    return prevReport ? prevReport(kind, body) : undefined;
  };
  const team = TEAMS[teamKey], foe = TEAMS[foeKey];
  const roster = [{ player_id: 'p-demo', player_num: 7, display: 'REAPER', team_id: teamKey, weapons: [{ weapon_id: 'assault_rifle', hir: [9] }] }, { player_id: 'p-2', player_num: 19, display: 'VIPER', team_id: foeKey, weapons: [{ weapon_id: 'assault_rifle', hir: [9] }] }];   // S56: the demo $HIR magnitude 9 is the stock Assault Rifle's
  const config = { config_id: golden.config_id, mode: 'tdm', environment: 'outdoor',
    // `?night` is documented at the top of this file but was hardcoded false here, so the
    // config message overwrote the flag set from the URL above and the night theme could
    // never be previewed. Found by the HUD moment suite 2026-09-02.
    night: q.has('night'), time_limit_s: 600,
    respawn: { type: ['auto', 'scanner', 'none'].includes(q.get('respawn')) ? q.get('respawn') : 'auto', delay_s: +q.get('delay') || 8 },
    scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 }, teams: [team, foe] };
  const bundle = { ...golden, player_id: 'p-demo' };
  // the host-locked Silenced Sniper is a no-armour game (its briefing says so): its config and its $PSET must agree
  if (locked) { config.health = { max_hp: 45, max_armor: 0 }; bundle.head = bundle.head.map(f => f.startsWith('$PSET,') ? f.replace(/^(\$PSET,\d+,\d+,)\d+,\d+,/, (_, head) => `${head}45,0,`) : f); }
  // A24 `result.rows`: EVERY player's ScoreRow, which is what makes a leaderboard possible on the phone.
  // Four players over two teams, one of them with `acc_provisional` (dimmed ACC) and one with no medals.
  const RESULT_ROWS = [
    { player_id: 'p-demo', display: 'REAPER', team_id: teamKey, kills: 11, deaths: 6, assists: 3, shots: 184, hits: 63, accuracy: 34, kd: 1.8, streak: 0, best_streak: 5, medals: ['double_kill', 'killing_spree'], first_blood: false, multi_best: 2 },
    { player_id: 'p-3', display: 'HAVOC', team_id: teamKey, kills: 8, deaths: 9, assists: 5, shots: 210, hits: 52, accuracy: 25, kd: 0.9, streak: 1, best_streak: 3, medals: [] },
    { player_id: 'p-2', display: 'VIPER', team_id: foeKey, kills: 13, deaths: 7, assists: 2, shots: 166, hits: 71, accuracy: 43, kd: 1.9, streak: 2, best_streak: 7, medals: ['first_blood', 'triple_kill'], first_blood: true, multi_best: 3 },
    { player_id: 'p-4', display: 'SABLE', team_id: foeKey, kills: 4, deaths: 11, assists: 6, shots: 240, hits: 38, accuracy: 16, kd: 0.4, streak: 0, best_streak: 2, medals: [], acc_provisional: true },
  ];

  let hp = 45, armor = 70, mag = 32, reserve = 384;
  let shield = 0;   // A56: only an OVERSHIELD grant fills it on the demo gun (a `$LIFE` mode-2 set past the max); hits take it first
  let psetPools = null;   // [hp, armour] of the last `$PSET` the demo gun took
  let misread = false;   // F341 x HUD QA R2-02: the gun misread its `$PSET` (4545/7070) and never takes a repair
  let acc = 100;   // S53: the gun's live accuracy ($ALCD token 2). A smoke holds it at 0 for SMOKE_MS, like the bench gun
  const lcd = () => engine.feedFrame(`$LCD,${hp},${armor},0,0,${mag},${reserve},*`);
  // S54 (2026-09-23): one continuous trigger pull for the whole burst, not a press-shot-release per
  // round -- a full-auto weapon does not release between rounds, and the engine now reads a real
  // release edge (`$BUT,0,0`) as evidence a still-CRISP burst has stopped (`_onButton`). A release after
  // every simulated round would reset the recoil model's round count before the burst ever accumulated.
  const fire = n => {
    if (n <= 0 || mag <= 0) return;
    engine.feedFrame('$BUT,0,1,*');
    for (let i = 0; i < n && mag > 0; i++) { mag--; engine.feedFrame(`$ALCD,${mag},${acc},0,${reserve},0,*`); }
    engine.feedFrame('$BUT,0,0,*');
  };
  const reload = () => { const need = 32 - mag; const take = Math.min(need, reserve); reserve -= take; mag += take; engine.feedFrame(`$ALCD,${mag},${acc},0,${reserve},0,*`); };
  // S16: the demo gun answers the node's own poison ticks the way the bench measured (2026-09-09): a negative `$LIFE`
  // is per pool with no spill and floors at 0, a non-lethal one self-emits `$HP`, and a lethal one answers `$LCD`
  // and never `$HP`. Without this the stage would show a poison stack whose ticks change nothing.
  const DEMO_DOT = { 11: { weapon_id: 'toxin_rifle', per_tick: 4, tick_ms: 1000, duration_ms: 5000 } };
  const gunWriter = engine.writer;
  engine.writer = fr => {
    gunWriter(fr);
    for (const f of fr) {
      // S55: the stage gun applies the same absolute t4 accuracy modifier as hardware. This keeps
      // recoil screenshots on the real engine/writer path instead of painting a HUD-only fixture.
      const tmp = /^\$TMP,(?:[^,]*,){3}(-?\d+),/.exec(f);
      if (tmp) {
        acc = Math.max(0, Math.min(100, 100 + Number(tmp[1])));
        // Bench-proven write acknowledgement: t4 self-emits the resulting live accuracy on `$ALCD`
        // after the BLE round trip. Without this, the real verifier retries and eventually disables
        // recoil behind an apparently-correct screenshot.
        const slot = engine.activeSlot || 0;
        setTimeout(() => {
          // Read at delivery time: a stage fixture may legitimately change weapon/magazine during
          // the simulated BLE round trip, just as the real gun's eventual `$ALCD` reports live state.
          const live = engine.state();
          engine.feedFrame(`$ALCD,${live.ammo ?? mag},${acc},${engine.activeSlot || slot},${live.reserve ?? reserve},0,*`);
        }, 40);
      }
      // F341: a gun whose parser appended a re-sent `$PSET` to a partial one answers every pool read and every repair with
      // the doubled pools, so the REAL engine walks its two repairs and reaches its own `pool_wrong` verdict
      if (misread && (f === '$LIFE,0,0,0,*' || /^\$LIFE,\d+,\d+,\d+,1,\*$/.test(f))) { setTimeout(() => engine.feedFrame(`$HP,${hp},${armor},${shield},*`), 40); continue; }
      // HUD QA R2-21: the demo gun arms the pools of the last `$PSET` it took (t3 hp, t4 armour), as a real gun does. It kept
      // 45/70 under a 100/0 preset, so the overshield grant's echo read as a "+55 HEALTH" pickup: a stage artefact.
      const ps = /^\$PSET,\d+,\d+,(\d+),(\d+),/.exec(f); if (ps) psetPools = [+ps[1], +ps[2]];
      if (f.startsWith('$SPAWN,')) { acc = 100; shield = 0; if (psetPools && !misread) [hp, armor] = psetPools; }   // hardware clears every `$TMP` token on spawn, and the spawn shield is 0
      // A56: `$LIFE` mode 2 is an ABSOLUTE set with no clamp (the overshield grant); the gun answers `$HP` with the new pools
      const set = /^\$LIFE,(\d+),(\d+),(\d+),2,\*$/.exec(f);
      if (set) { [hp, armor, shield] = set.slice(1).map(Number); setTimeout(() => engine.feedFrame(`$HP,${hp},${armor},${shield},*`), 40); continue; }
      const m = /^\$LIFE,(-?\d+),(-?\d+),(-?\d+),\*$/.exec(f);
      // S29: the node's shield refill is `$LIFE,0,0,10,*`, additive and clamped at the `$PSET` t5 ceiling (bench 2026-09-17
      // step 7), answered by `$HP`. Without this the stage's Shields preset never recharged, so its HUD could not be looked at.
      if (m && !f.includes('-') && +m[1] === 0 && +m[2] === 0 && +m[3] > 0) {
        shield = Math.min(Math.max(shield, engine.maxShield), shield + Number(m[3]));
        setTimeout(() => engine.feedFrame(`$HP,${hp},${armor},${shield},*`), 40); continue;
      }
      if (!m || !f.includes('-')) continue;
      const [dh, da] = m.slice(1).map(Number);
      hp = Math.max(0, hp + dh); armor = Math.max(0, armor + da);   // the demo gun carries no shield
      setTimeout(() => engine.feedFrame(hp === 0 ? `$LCD,0,0,0,0,${mag},${reserve},*` : `$HP,${hp},${armor},0,*`), 40);
    }
  };
  const hit = (dmg = 9) => { if (shield > 0) shield = Math.max(0, shield - dmg); else if (armor > 0) armor = Math.max(0, armor - dmg); else hp = Math.max(0, hp - dmg); engine.feedFrame(`$HIR,4,0,19,${foe.tid},9,0,3,*`); engine.feedFrame(`$HP,${hp},${armor},${shield},*`); };


  // ---------- STAGE harness: ?demo&stage=<state> ----------
  const stageName = q.get('stage');
  if (stageName != null) {
    const hud = () => (typeof window !== 'undefined' && window.brx) ? window.brx.hud : null;
    const gunObj = { name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' };
    // ---- F258 picker stages ----
    // The bench's room (2026-09-18), in the order the adverts arrived there: the loud household
    // devices first, the two taggers last and quietest.
    const NOISY_ROOM = [
      { deviceId: 'tv1', name: 'Samsung Q80 TV', rssi: -41, uuids: [] },
      { deviceId: 'tv2', name: '[LG] webOS TV', rssi: -44, uuids: [] },
      { deviceId: 'hatch', name: 'Hatch Rest', rssi: -48, uuids: [] },
      { deviceId: 'scu', name: 'WL_SCU', rssi: -52, uuids: [] },
      { deviceId: 'mac1', name: '4C:11:AE:90:22:01', rssi: -55, uuids: [] },
      { deviceId: 'gun1', name: 'ALPHA-FE30', rssi: -70, uuids: [NUS] },
      { deviceId: 'gun2', name: 'BRAVO-9498', rssi: -74, uuids: [NUS] },
    ];
    let stagePicker = null;
    /** Feeds adverts to the stage's picker. `keep` re-uses the picker already on the stage, which is
     *  what makes "the readings moved, the rows did not" testable. */
    const scanRoom = (hits, assigned = null, keep = false) => {
      if (!keep || !stagePicker) stagePicker = new GunPicker();
      stagePicker.setAssigned(assigned);
      for (const h of hits) stagePicker.observe(h);
      return stagePicker.list();
    };
    const paintScan = (rows, inUse = {}) => {
      const h = hud(); if (!h) return;
      h.setScan(rows.map(r => (inUse[r.deviceId] ? { ...r, inUse: true } : r)));
      h.render(engine.state());
    };
    const ev = {
      // link + MC
      linkGun: () => engine.onBleConnected(gunObj), dropGun: () => engine.onBleDropped(), relinkGun: () => engine.onBleConnected(),
      // bench 2026-09-17: the headset is off, so the gun keeps dropping the link (BrxLink.flapping)
      flapGun: (count = 3, quiet = false) => { engine.onBleDropped(); engine.setGunFlapping({ count, next_retry_at: Date.now() + 30000, quiet }); },
      // F293: BrxLink's `$VERSION` probe. 'joining'/'not_joined': the link is down while the headset joins the gun;
      // 'joined': the first hds.N reading, and the link comes up.
      headsetJoin: state => {
        if (state === 'joined') { engine.setHeadsetJoin({ state, since: Date.now() }); engine.onBleConnected(); return; }
        engine.onBleDropped(); engine.setGunFlapping(null); engine.setHeadsetJoin({ state, since: Date.now() });
      },
      resyncProbe: () => engine._beginResync('demo'),   // the trigger-first resync prompt (a lobby/armed reconnect, or a resume) — a live rejoin RECONCILES instead (S7.1)
      battery: pct => engine.feedFrame(`$VOLTS,8101,3789,${pct},48,*`),
      mcBound: () => engine.setWsState('bound'), mcLost: () => engine.setWsState('closed'),
      mcRejected: () => engine.setWsState('rejected', { reason: 'roster_full', code: 4003 }),
      // F258: every picker stage runs the adverts through the REAL `GunPicker` the phone uses, so the
      // stage predicts app.js instead of hand-posing a list that nothing on a phone would produce.
      scan: () => paintScan(scanRoom([
        { deviceId: 'a', name: 'GUN-A-3D4F', rssi: -52, uuids: [NUS] },
        { deviceId: 'b', name: 'GUN-B-7C21', rssi: -71, uuids: [NUS] },
        { deviceId: 'c', name: 'GUN-C-B0E9', rssi: -83, uuids: [NUS] },
      ]), { b: true }),
      // F258 (bench 2026-09-18): the room the picker was measured in — two televisions, a QLED, a
      // Hatch Rest, a WL_SCU and bare MAC addresses, with the taggers arriving LAST and quietest.
      scanNoisy: (assigned = null) => paintScan(scanRoom(NOISY_ROOM, assigned)),
      // The same room a second later: every signal reading has moved, and two of them have swapped
      // which is louder. Not one row may move, and not one row node may be replaced.
      scanAgain: () => paintScan(scanRoom(NOISY_ROOM.map((d, i) => ({ ...d, rssi: -20 - ((i * 37) % 70) })), null, true)),
      // game day 2026-09-19: the picker with an empty list and no scan running (SCAN AGAIN)
      pickerIdle: (active = false) => { const h = hud(); if (!h) return; h.scanActive = active; h.setScan([]); h.render(engine.state()); },
      // app 0.4.2: the picker from a gun tap until the link is up. attempt > 1 is a retry; failed = gave up.
      pickerConnecting: (attempt = 1, failed = false, headset = null) => { const h = hud(); if (!h) return; h.scanActive = false; h.setScan([]); h.setConnecting({ name: 'GUN-A-3D4F', attempt, of: 5, failed, ...(headset ? { headset } : {}) }); h.render(engine.state()); },   // F293: `headset` = BrxLink's probe state
      pickerConnectDone: () => { const h = hud(); if (!h) return; h.setConnecting(null); h.render(engine.state()); },
      scanOther: () => { const h = hud(); if (!h) return; h.setScanOther(!h.scanOther); h.render(engine.state()); },
      // F211: the picker with Bluetooth off (docs/archive/game-test-2026-09-13.md C2). `platform` defaults to 'web'
      // (no enable/settings buttons — iOS has neither); pass 'android' for the button variant.
      bluetoothOff: (platform) => { const h = hud(); if (h) { h.bluetoothOn = false; if (platform) h.platform = platform; h.setScan([]); h.render(engine.state()); } },
      // F340: Android 11 with Location services off. The phone's own `locationCheck` runs with a plugin that answers
      // off (then on), so the stage shows what that check writes, not a hand-set flag.
      locationOff: async () => { const h = hud(); if (!h) return; h.platform = 'android'; h.setScan([]);
        await locationCheck({ platform: () => 'android', sdk: () => 30, probe: async () => false, hud: h, log })(); h.render(engine.state()); },
      locationOn: async () => { const h = hud(); if (!h) return;
        const { cleared } = await locationCheck({ platform: () => 'android', sdk: () => 30, probe: async () => true, hud: h, log })();
        if (cleared) { h.scanActive = true; h.setScan([]); } h.render(engine.state()); },
      // kit-out
      assign: () => engine.onMcMessage({ kind: 'assign', body: { player, team, roster, catalog, policy, game } }),
      kitOpen: open => { policy.kit_open = open; ev.assign(); },
      // A38: the ONE extra `assign` `state.py stand_down()` pushes to a still-connected benched phone.
      // Stated as the real wire body (`standby: true` on an otherwise ordinary assign) rather than by
      // poking `engine.standby`, so the stage exercises `_assign`'s own branch — the stage exists to
      // PREDICT `engine.js`, and a fixture that sets the flag directly predicts nothing.
      bench: (on = true) => engine.onMcMessage({ kind: 'assign', body: on
        ? { player, team, roster, catalog, policy, game, standby: true }
        : { player, team, roster, catalog, policy, game } }),
      briefing: () => engine.openBriefing(), briefDone: () => engine.closeBriefing(),
      // F110 (review): the WORST briefing payload a host can produce — a game name that wraps to two lines
      // over a loadout line that wraps too. The demo payload is one short line of each, which is the F111
      // mistake: a layout only ever driven with its happy-path data.
      longGame: () => { Object.assign(game, {
        name: 'Operation Midnight Thunderdome Extended',
        desc: 'Two squads, one contested corridor, and a scoreboard that only moves when a body hits the floor. Downed players redeploy from their own spawn after the delay and walk straight back into it.',
        ruleset: 'NO HEAVIES · NO SIDEARMS · ONE LIFE PER PUSH',
        loadout_line: 'You pick your primary from the full rack, a second weapon in slot two, and a perk of your choice — the host has locked nothing this game, so every one of them is yours to change until you ready up.' });
        ev.assign(); },
      // F123: a per-shell chain — the gun feeds the tube one round at a time, SLOWER than the per-shell
      // nominal, so the reload bar spends the whole chain past `reloadTotalMs` (the overrun treatment).
      reloadChain: (shells = 18, everyMs = 800) => {
        engine.feedFrame('$BUT,2,1,*');
        let n = 0;
        const shell = () => { if (n++ >= shells || !engine.reloading || mag >= 31) return;
          mag++; if (reserve > 0) reserve--; engine.feedFrame(`$ALCD,${mag},100,0,${reserve},0,*`); setTimeout(shell, everyMs); };
        setTimeout(shell, everyMs);
      },
      ready: v => engine.setReady(v == null ? !engine.ready : !!v),
      openLoadout: slot => { const h = hud(); if (h) { h.lo.tab = slot || 'primary'; h.lo.focus = null; h.lo.filter = 'weapons'; } engine.browse(true); },
      closeLoadout: () => engine.browse(false),
      pick: (slot, kind, id) => engine.requestLoadout(slot, kind, id, false),
      tap: sel => { const el = document.querySelector(sel); if (el) el.click(); return !!el; },   // a real tap through the app's data-act delegation (A14 two-tap confirm)
      // A26: a weapon pick is DEBOUNCED 400 ms on the node; the stage is instantaneous, so flush it at once —
      // the `tryout` stage measures the try-out PANEL, which only exists after MC's tutorial reply.
      tryout: id => { engine.requestLoadout('primary', 'weapon', id || 'smg', true); if (engine._flushPick) engine._flushPick(); },
      slowAck: ms => { ackDelayMs = ms == null ? 6000 : ms; },                       // A26: hold the row on ⟳
      // A30: the server refusal a pick earns once the match has started. MC writes the copy; the HUD prints it.
      refuse: reason => engine.onMcMessage({ kind: 'loadout_ack', body: { slot: 'primary', ok: false,
        reason: reason || 'THE MATCH HAS STARTED — YOUR KIT IS LOCKED UNTIL THE NEXT ONE', loadout: player.loadout } }),
      tryDone: () => engine.dismissTryout(),
      // match control (what Mission Control would send)
      config: () => { engine.onMcMessage({ kind: 'config', body: { config, frames: bundle, roster } }); setTimeout(lcd, 200); },
      start: secs => engine.onMcMessage({ kind: 'start', body: { match_id: 'stage-' + Date.now(), go_live_t: Date.now() + (secs == null ? 30 : secs) * 1000, config_id: golden.config_id, seq: 1, countdown_s: secs == null ? 30 : secs } }),
      abort: () => engine.onMcMessage({ kind: 'control', body: { cmd: 'abort_start', seq: 1 } }),
      end: () => engine.onMcMessage({ kind: 'control', body: { cmd: 'end' } }),
      panic: () => engine.onMcMessage({ kind: 'control', body: { cmd: 'panic' } }),
      endOk: () => engine.ackEnd(),
      score: (kills = 3, deaths = 1, assists = 1) => engine.onMcMessage({ kind: 'score', body: { kills, deaths, assists, accuracy: 41, hits: 11, shots: 28, shots_total: 28,
        board: { teams: [{ team_id: teamKey, name: team.name, score: 18 }, { team_id: foeKey, name: foe.name, score: 21 }], cap: 25 }, rows: RESULT_ROWS } }),   // `rows`: every player's ScoreRow, as MC's live push carries (state.py `_push_scores`)
      // Bench 2026-09-17: the FFA shape of the same push -- no team on any row, and the board is the top three players.
      scoreFfa: () => { config.mode = 'ffa'; const rows = RESULT_ROWS.map(r => ({ ...r, team_id: null }));
        engine.onMcMessage({ kind: 'score', body: { ...rows[0], shots_total: rows[0].shots, rows,
          board: { teams: rows.slice().sort((a, b) => b.kills - a.kills).slice(0, 3).map(r => ({ team_id: 'ffa', name: r.display, score: r.kills })), cap: 25 } } }); },
      // A24: the board one kill off the cap. Paired with `mcLost` this is the DOWN screen the A31 line exists for.
      capBoard: () => engine.onMcMessage({ kind: 'score', body: { kills: 9, deaths: 3, assists: 2, accuracy: 38, hits: 40, shots: 105, shots_total: 105,
        board: { teams: [{ team_id: teamKey, name: team.name, score: 24 }, { team_id: foeKey, name: foe.name, score: 21 }], cap: 25 } } }),
      // ---- A24: the MATCH RESULT push (contracts §5 `result`). `outcome` is MC's, computed for THIS recipient. ----
      result: (outcome = 'win', extra = {}) => engine.onMcMessage({ kind: 'result', body: {
        match_id: engine.matchId, outcome,
        winner: outcome === 'draw' ? { tie: [teamKey, foeKey] } : { team_id: outcome === 'win' ? teamKey : foeKey },
        mode: 'tdm', win_by: 'kills',
        team_scores: [{ team_id: teamKey, name: team.name, score: outcome === 'lose' ? 19 : outcome === 'draw' ? 21 : 25 },
                      { team_id: foeKey, name: foe.name, score: outcome === 'win' ? 19 : outcome === 'draw' ? 21 : 25 }],
        rows: RESULT_ROWS, my: RESULT_ROWS[0],
        // The SERVER's shape (`scoring.py honors()` → `state.py` result push): `medal` is the award label MC
        // already wrote in full, and `stat` is a descriptive STRING. The demo used to send integers here, which
        // is why a HUD guard that rejected strings looked fine on every stage shot for weeks.
        honors: [{ medal: 'MVP', player_id: 'p-demo', display: 'REAPER', stat: '11 K · 2.8 K/D · ×5 STREAK' },
                 { medal: 'FIRST BLOOD', player_id: 'p-2', display: 'VIPER', stat: 'AT 01:12' },
                 { medal: 'SHARPSHOOTER', player_id: 'p-2', display: 'VIPER', stat: '41% ACCURACY' }],
        possession: { by_team: { [teamKey]: 214, [foeKey]: 137 } },
        // the server's shape (A6.1 recap): a COUNT plus a map keyed by player_id — no display name in it, so the
        // HUD resolves names from `rows`. `p-ghost` has no row at all, which is how the id fallback gets exercised.
        after_end: { facts: 4, by_player: { 'p-2': { kills: 2, deaths: 0 }, 'p-demo': { kills: 0, deaths: 1 }, 'p-ghost': { kills: 1, deaths: 0 } } },
        provisional: false, t: Date.now(), ...extra } }),
      // FFA: no team totals at all, so the screen has no TEAM view to offer and never renders an empty one.
      resultFfa: (outcome = 'lose') => engine.onMcMessage({ kind: 'result', body: {
        match_id: engine.matchId, outcome, winner: { player_id: 'p-2' }, mode: 'ffa', win_by: 'kills',
        team_scores: [], rows: RESULT_ROWS.map(r => ({ ...r, team_id: null })), my: { ...RESULT_ROWS[0], team_id: null },
        honors: [{ medal: 'FIRST BLOOD', player_id: 'p-2', display: 'VIPER' }], provisional: false, t: Date.now() } }),   // no `stat` at all: the honour still names the player
      // The settle window has passed and MC is still unreachable: "MC NOT REACHED", which is NOT "you lost".
      unreached: () => { engine.endedAt = engine.now() - 31000; engine.setWsState('closed'); },
      mcVerify: line => { game.mc_verify = line || 'A WIN IS CONFIRMED AT MISSION CONTROL · RETURN AFTER THE WHISTLE'; ev.assign(); },
      seedHistory: () => { const h = hud(); if (!h) return;
        h.sessionId = 'demo-session'; const t0 = Date.now() - 3600e3;
        h.history = [
          { t: t0, session: 'demo-session', match_id: 'h1', mode: 'tdm', kills: 7, deaths: 9, assists: 2, accuracy: 22, shots: 190, outcome: 'lose', win_by: 'kills', best_streak: 3, medals: [], team_scores: [{ team_id: teamKey, name: team.name, score: 18 }, { team_id: foeKey, name: foe.name, score: 25 }] },
          { t: t0 + 1200e3, session: 'demo-session', match_id: 'h2', mode: 'koth', kills: 5, deaths: 4, assists: 6, accuracy: 31, shots: 120, outcome: 'win', win_by: 'hill_time', best_streak: 2, medals: ['killing_spree'], team_scores: [{ team_id: teamKey, name: team.name, score: 300 }, { team_id: foeKey, name: foe.name, score: 211 }] },
          { t: t0 + 2400e3, session: 'demo-session', match_id: 'h3', mode: 'ffa', kills: 12, deaths: 5, assists: 1, accuracy: 44, shots: 160, outcome: null, win_by: null, best_streak: null, medals: null, team_scores: null },   // MC never confirmed this one — "—", never a guess
          ...(h.history || []).filter(g => g.session === 'demo-session' && !['h1', 'h2', 'h3'].includes(g.match_id))];
        h.sig = null; h.render(engine.state()); },
      view: v => { const h = hud(); if (!h) return; h.view = v || null; h.sig = null; h.render(engine.state()); },
      rtab: t => { const h = hud(); if (!h) return; h.rtab = t; h.sig = null; h.render(engine.state()); },
      reloadPull: () => engine.feedFrame('$BUT,2,1,*'),   // the gun's reload handle; the mag comes back with the next $ALCD (see `reload`)
      twoWeapons: () => { player.loadout = { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'smg' }], perk: player.loadout.perk || null }; ev.assign(); },
      perk: id => { player.loadout = { ...player.loadout, perk: id }; ev.assign(); },   // A14: the perk rides beside the weapons
      fullKit: () => { player.loadout = { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'usp' }], perk: 'quick_switch' }; ev.assign(); },   // A14: AR + pistol + Quick Switch
      quickSwitch: () => { player.loadout = { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'smg' }], perk: 'quick_switch' }; bundle.swap_ms = 425; ev.assign(); },   // two weapons AND the perk; MC compiles tok15 = 425 into the bundle (bench 2026-09-04)
      // Bench 2026-09-17 (brx-weapons item 6): charge_rifle's cell reads "ammo left" but a full charge
      // costs 10 -- the first $ALCD sets the 40-cell cap, the second lands the test value.
      chargeRifle: () => { player.loadout = { weapons: [{ weapon_id: 'charge_rifle' }] }; },
      // QA lane B (2026-09-23): three live states the stage had no button for. Each goes through the real engine.
      // OVERHEAT: the charge rifle, then the gun's own $ALCD at heat 108 (past the lockout), fed until the engine
      // takes it (F259's echo window can swallow a single frame, see screens.mjs `setAmmo`).
      overheat: () => { engine.player.loadout.weapons[0] = { weapon_id: 'charge_rifle' }; let n = 0;
        const feed = () => { engine.feedFrame('$ALCD,3,100,0,80,108,*'); if (!engine.state().overheatShown && ++n < 25) setTimeout(feed, 200); }; feed(); },
      // F15 stun: the host's `config.stun` on (set before the bundle, see the stage), then one EMP word (proto 8) from VIPER.
      stun: () => { if (engine.config && !engine.config.stun) engine.config.stun = { duration_s: 10 }; engine.feedFrame(`$HIR,4,8,19,${foe.tid},8,0,0,*`); },   // the button turns the host's stun on first
      // 2026-09-19 station respawn: the bundle's respawn_profile gives a station life 2 s of visible protection (`shielded`).
      stationRespawn: () => { if (engine.alive) return; engine._revive(false, 3); hp = engine.maxHp; armor = engine.maxArmor; setTimeout(lcd, 250); },
      chargeAmmo: (ammo, reserve = 80) => { engine.feedFrame('$ALCD,40,100,0,80,0,*'); engine.feedFrame(`$ALCD,${ammo},100,0,${reserve},0,*`); },
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
      killMedals: (medals = ['double_kill', 'killing_spree'], victim = 'VIPER') => engine.onMcMessage({ kind: 'feedback', body: { player_id: 'p-demo', kind: 'kill', t: Date.now(), cue: golden.cues.kill, victim_team: foeKey, victim: 'p-' + String(victim).toLowerCase(), victim_display: victim, medals } }),
      dealt: (dmg = 9, victim = 'VIPER') => engine.onMcMessage({ kind: 'feedback', body: { player_id: 'p-demo', kind: 'hit', t: Date.now(), victim: 'p-' + String(victim).toLowerCase(), victim_num: 19, victim_display: victim, dmg, weapon_id: 'assault_rifle' } }),   // S56
      killConfirm: (victim = 'VIPER') => engine.onMcMessage({ kind: 'feedback', body: { player_id: 'p-demo', kind: 'kill', t: Date.now(), cue: golden.cues.kill, victim_team: foeKey, victim: 'p-' + String(victim).toLowerCase(), victim_display: victim } }),
      // the gun (what the tagger would report)
      fire: n => fire(n == null ? 1 : n), reload, hit: d => hit(d == null ? 9 : d),
      spawnEcho: () => { hp = engine.maxHp; armor = engine.maxArmor; mag = 32; reserve = 384; lcd(); },
      die: () => { armor = 0; hp = 0; shield = 0; engine.feedFrame(`$HIR,4,0,19,${foe.tid},9,0,3,*`); engine.feedFrame('$HP,0,0,0,*'); },
      respawn: () => { if (engine.alive) return; engine._revive(false); hp = engine.maxHp; armor = engine.maxArmor; setTimeout(lcd, 250); },
      heal: (n = 15) => { hp = Math.min(engine.maxHp, hp + n); engine.feedFrame(`$HP,${hp},${armor},0,*`); },
      armorUp: (n = 30) => { armor = Math.min(engine.maxArmor, armor + n); engine.feedFrame(`$HP,${hp},${armor},0,*`); },
      discovered: (reason, url, source) => { const h = hud(); if (!h) return; h.setDiscovered({ url, at: Date.now(), source, reason, text: offerText(reason, url) }); h.render(engine.state()); },
      poolsDoubled: () => { misread = true; hp = 4545; armor = 7070; engine.feedFrame(`$HP,${hp},${armor},0,*`); },   // F341: the field's `$HP,4545,7070,0`
      lowHp: () => { armor = 0; hp = 8; engine.feedFrame(`$HIR,4,0,19,${foe.tid},9,0,3,*`); engine.feedFrame(`$HP,${hp},${armor},0,*`); },
      // S16: a Toxin Rifle hit (protocol 11) as the gun reports it, with the game's poison table on the bundle.
      poison: (shooter = 19) => { bundle.dot = DEMO_DOT; if (engine.frames && !engine.frames.dot) engine.frames.dot = DEMO_DOT; if (armor > 0) armor = Math.max(0, armor - 8); else hp = Math.max(0, hp - 8); engine.feedFrame(`$HIR,0,11,${shooter},${foe.tid},8,0,0,*`); engine.feedFrame(hp === 0 ? `$LCD,0,0,0,0,${mag},${reserve},*` : `$HP,${hp},${armor},0,*`); },
      // S16: a poisoned player with 4 HP and no armour, so the first tick kills (DOWN says POISONED BY)
      poisonLethal: (shooter = 19) => { armor = 0; hp = 12; engine.feedFrame(`$HP,${hp},${armor},0,*`); ev.poison(shooter); },
      // S53: a Haze word (fn 23 on <7,0>): no pool moves, and the gun's accuracy drops to 0 in the same millisecond
      smoke: () => { acc = 0; engine.feedFrame(`$HIR,0,7,19,${foe.tid},6,0,0,*`); engine.feedFrame(`$ALCD,${mag},0,0,${reserve},0,*`); setTimeout(() => { acc = 100; }, 6000); },
      lowAmmo: () => { mag = 3; reserve = 0; engine.feedFrame(`$ALCD,${mag},100,0,${reserve},0,*`); },
      emptyMag: () => { mag = 0; engine.feedFrame(`$ALCD,0,100,0,${reserve},0,*`); },
      // F288: deterministic screen truth for the gun-health lane. Use the engine's real state() and
      // poolStale() paths; only the measured facts are injected, as hardware would have established them.
      gunNoAnswer: () => { engine._noFirePulls = 3; engine._cureLife = engine._lifeSeq; engine._cureAt = Date.now(); engine.cure = { verdict: 'no_answer', at: Date.now() }; engine._changed(); },
      gunNoFire: () => { engine._noFirePulls = 3; engine._cureLife = engine._lifeSeq; engine._cureAt = Date.now(); engine.cure = { verdict: 'asking', at: Date.now() }; engine._changed(); },
      gunHealthy: () => { engine._noFirePulls = 0; engine.cure = null; engine._changed(); },
      // F272 screen fixture: the detector itself is covered with a fake clock in the engine suite. The
      // browser needs the durable verdict that detector publishes, so it can prove the player's takeover
      // at both supported landscape sizes and then drive the real drop/relink recovery methods below.
      gunLocked: () => { engine.gunLocked = { at: Date.now(), match_id: engine.matchId }; engine._changed(); },
      gunSmokeOverlap: () => { const now = Date.now(); engine.smoke = { at: now, until: now + 6000 }; engine.gunAcc = 0; ev.gunNoAnswer(); },
      gunHitOverlap: () => { engine.smoke = null; engine.lastHitAt = Date.now(); ev.gunNoAnswer(); },
      station: (rssi = -78, present = false, threshold = -74) => { if (typeof engine.setStations !== 'function') { log('demo: this engine has no stations', 'le'); return; }
        const list = rssi == null ? [] : [{ role: 'station', kind: 'respawn', id: 3, team: 255, state: 1, value: 0, rssi, raw: rssi, threshold, present: !!present, seenAt: Date.now() }];
        const pr = (typeof window !== 'undefined' && window.brx) ? window.brx.presence : null;
        if (pr) pr.stations = () => list;   // the app feeds engine.setStations(presence.stations()) every 250 ms — so the fake lives in presence
        engine.setStations(list); },
      scanner: (delay_s = 3, gate = 'trigger') => { config.respawn = { type: 'scanner', delay_s, gate }; },   // stage-time: the SHORTEST legal delay (F13/F34: the engine floors anything under 3 s, so a 1 s fixture silently ran at 3 s and the harness read HOLD where it expected the trigger prompt)
      state: () => engine.state(),
      // the diagnostics panel (the ⓘ button). `on` omitted = toggle. F122's screen-truth steps drive it
      // while the 250 ms render loop keeps pushing fresh diag data underneath.
      diag: on => { const h = hud(); if (!h) return; const open = h.diag.classList.contains('open'); if (on == null || !!on !== open) h.toggleDiag(); },
    };
    // ---- The death screen (2026-09-23): every life below is driven through the REAL engine -- `$HIR`/`$HP` from a
    // named shooter and magnitude, MC's `feedback` relays -- so the stage predicts engine.js instead of posing a ledger.
    const GHOST = { player_id: 'p-3', player_num: 21, display: 'GHOST', team_id: foeKey, weapons: [{ weapon_id: 'smg', hir: [1, 8] }] };
    Object.assign(ev, {
      addGhost: () => { if (!roster.some(r => r.player_num === 21)) roster.push(GHOST); },
      // VIPER carries two weapons that share magnitude 9, so a mag-9 hit is honestly ambiguous
      viperTwin: () => { roster[1].weapons = [{ weapon_id: 'assault_rifle', hir: [9] }, { weapon_id: 'usp', hir: [9] }]; },
      hitFrom: (num, mag, dmg = 9, sensor = 1) => { if (armor > 0) armor = Math.max(0, armor - dmg); else hp = Math.max(0, hp - dmg);
        engine.feedFrame(`$HIR,${sensor},0,${num},${foe.tid},${mag},0,3,*`); engine.feedFrame(`$HP,${hp},${armor},0,*`); },
      dieFrom: (num, mag, sensor = 4) => { armor = 0; hp = 0; engine.feedFrame(`$HIR,${sensor},0,${num},${foe.tid},${mag},0,3,*`); engine.feedFrame('$HP,0,0,0,*'); },
      dealtTo: (victim, num, dmg, weapon_id = 'assault_rifle') => engine.onMcMessage({ kind: 'feedback', body: { player_id: 'p-demo', kind: 'hit', t: Date.now(), victim: 'p-' + victim.toLowerCase(), victim_num: num, victim_display: victim, dmg, weapon_id } }),
      beacon: (tid = 1) => engine.feedFrame(`$HIR,4,15,0,${tid},8,0,0,*`),   // a grenade hill's IR beacon: owner tid, magnitude 8
      hillTaken: (tid = 1) => engine.feedFrame(`$HIR,4,15,0,${tid},50,0,0,*`),   // QA-05: the grenade's capture word (magnitude 50) naming the new owner
      addMate: () => { if (!roster.some(r => r.player_num === 23)) roster.push({ player_id: 'p-4', player_num: 23, display: 'MAVERICK', team_id: teamKey }); },   // QA-05: a teammate the roster can name
    });
    // ---- A56 powerups (docs/spec/powerups.md): a powerup game through the REAL engine. The config carries the stations'
    // items and the armed pickup slots exactly as MC's `--powerups` compile sends them; the stations are fake adverts fed
    // through the same presence path the app uses, with the claim's median RSSI and the station's `taker` byte. ----
    const PU = {
      rockets: { kind: 'weapon', weapon_id: 'rocket_launcher', charges: 2, spawn_every_s: 120, first_at_s: 120, name: 'ROCKETS', color: '#ff7a1a' },
      rail: { kind: 'weapon', weapon_id: 'rail_gun', charges: 2, spawn_every_s: 120, first_at_s: 120, name: 'RAIL GUN', color: '#b06cff' },
      overshield: { kind: 'overshield', amount: 75, spawn_every_s: 60, first_at_s: 60, name: 'OVERSHIELD', color: '#3ad6ff' },
    };
    const PU_WEAP = { 2: '$WEAP,2,2,100,10,0,115,0,,,,,,35,100,1000,850,2,2,2600,0,7,100,100,,0,,,C03,,,,D14,D13,D12,D18,,,,,2,1,75,100,*',
      3: '$WEAP,3,0,100,6,0,149,0,,,,,,,,1200,850,2,2,2400,0,2,100,100,,0,,,C03,C08,,,D36,D35,D34,A73,,,,,2,1,75,*' };
    const puList = new Map();
    const puFeed = () => { const list = [...puList.values()].map(e => ({ ...e, seenAt: Date.now(), ageMs: 0 }));
      const pr = (typeof window !== 'undefined' && window.brx) ? window.brx.presence : null;
      if (pr) pr.stations = () => list;   // the app feeds engine.setStations(presence.stations()) every 250 ms
      engine.setStations(list); };
    Object.assign(ev, {
      // `firstOvershield`: the overshield's first spawn in seconds after go-live (the spawn-card stage uses 1)
      powerups: (firstOvershield = 60) => { config.stations = [{ id: 4, kind: 'powerup', item: PU.rockets }, { id: 5, kind: 'powerup', item: PU.rail },
        { id: 6, kind: 'powerup', item: { ...PU.overshield, first_at_s: firstOvershield } }];
        config.powerups = [{ weapon_id: 'rocket_launcher', slot: 2 }, { weapon_id: 'rail_gun', slot: 3 }];
        // compile arms each pickup in its spare slot with its head `$WEAP` (the grant re-sends it verbatim to put the heavy
        // on the trigger) and empties it at every spawn and revive. The rows are `WeaponCatalog.resolve()` output, 2026-09-24.
        if (!bundle.head.some(f => f.startsWith('$WEAP,2,'))) bundle.head = [...bundle.head, PU_WEAP[2], PU_WEAP[3]];
        const empty = ['$AMMO,2,0,0,1,*', '$AMMO,3,0,0,1,*'], add = l => l.some(f => f === empty[0]) ? l : l.flatMap(f => f.startsWith('$AMMO,1,') ? [f, ...empty] : [f]);
        bundle.spawn = add(bundle.spawn); bundle.revive = add(bundle.revive);
        if (bundle.respawn_profile) bundle.respawn_profile = { ...bundle.respawn_profile, spawn: add(bundle.respawn_profile.spawn), revive: add(bundle.respawn_profile.revive), revive_station: add(bundle.respawn_profile.revive_station) }; },
      // one powerup station's advert: `median` is the claim's range reading (in range at -55, the default threshold)
      puAt: (id = 4, { median = -50, state = 1, value = 0, taker = 0 } = {}) => {
        puList.clear();
        puList.set(id, { role: 'station', kind: 'powerup', id, team: 255, state, value, taker, seq: 0, game: 0, threshold: 0, median, raw: median, rssi: median, present: false });
        puFeed(); },
      puAway: () => { puList.clear(); puFeed(); },
      // the Shields preset at 3-digit pools with a 175 overshield: the widest vitals row a powerup game can draw
      widePools: () => { config.health = { max_hp: 100, max_armor: 0, max_shield: 100 };
        bundle.head = bundle.head.map(f => f.startsWith('$PSET,') ? f.replace(/^(\$PSET,\d+,\d+,)\d+,\d+,\d+,/, (_, head) => `${head}100,0,100,`) : f);
        // HUD QA R2-21: the spawn burst's `$PSET` arms the same pools as the head, as compile ships them (it armed 45/70)
        if (Array.isArray(bundle.pset_pool)) bundle.pset_pool = bundle.pset_pool.map(f => f.replace(/^(\$PSET,\d+,\d+,)\d+,\d+,\d+,/, (_, head) => `${head}100,0,100,`));
        config.stations = config.stations.map(x => x.id === 6 ? { ...x, item: { ...x.item, amount: 175 } } : x); },
      // The shield meter (2026-09-24): the Shields preset exactly as compile.HEALTH_PRESETS ships it (45 HP, 0 armour, 105
      // shield), so the engine's own S29 recharge runs. Everything below feeds frames the gun would send.
      shieldsPreset: () => { config.health = { max_hp: 45, max_armor: 0, max_shield: 105 };
        bundle.head = bundle.head.map(f => f.startsWith('$PSET,') ? f.replace(/^(\$PSET,\d+,\d+,)\d+,\d+,\d+,/, (_, head) => `${head}45,0,105,`) : f); },
      // the gun reports a full shield, as it does at the end of a refill
      shieldFill: () => { shield = engine.maxShield; engine.feedFrame(`$HP,${hp},${armor},${shield},*`); },
      // one hit the shield (or the overshield on top of it) absorbs
      shieldHit: (d = 30) => hit(d),
      // a hit that takes exactly what is left of the shield: SHIELD DOWN, and the engine's recharge clock restarts
      shieldBreak: () => { if (shield > 0) hit(shield); },
      // take the overshield from station 6 (the powerup game must be on: `powerups`)
      overshield: () => ev.puTake(6),
      // stand at the station past the 1 s dwell, then the station names its winner (7 = this phone, 19 = VIPER)
      puTake: (id = 4, taker = 7) => { ev.puAt(id); setTimeout(() => ev.puAt(id, { state: 0, value: 118, taker }), 1300); },
      // SELECT (a press, then its release): with a heavy held it toggles the trigger between the heavy and the player's weapon
      puSelect: () => { engine.feedFrame('$BUT,3,1,*'); engine.feedFrame('$BUT,3,0,*'); },
      // a round out of the heavy on the trigger, as the gun reports it ($ALCD token 3 = the slot)
      puFire: () => { const h = engine.state().powerup && engine.state().powerup.held; if (!h) return;
        engine.feedFrame('$BUT,0,1,*'); engine.feedFrame(`$ALCD,${Math.max(0, h.left - 1)},100,${h.slot},0,0,*`); engine.feedFrame('$BUT,0,0,*'); },
    });
    // A full life: two sources, two victims, rounds fired and a confirmed kill, then VIPER's rifle finishes it.
    const fullLife = [[2000, () => { ev.fire(7); ev.hitFrom(19, 9, 20); ev.hitFrom(21, 8, 12); ev.hitFrom(21, 8, 12); }],
      [2150, () => { ev.dealtTo('VIPER', 19, 18); ev.dealtTo('GHOST', 21, 30, 'assault_rifle'); ev.killConfirm('GHOST'); }],
      [2300, () => ev.score(3, 1, 1)], [2350, () => ev.dieFrom(19, 9)]];
    // each STAGE is a list of [delayMs, step] — the delays give the app's boot + render loop room between steps
    const kit = [[0, 'linkGun'], [50, () => ev.battery(82)], [150, 'assign'], [200, 'mcBound']];
    const kitted = [...kit, [300, 'briefDone']];
    const lobby = [...kitted, [500, 'config']];
    const live = [...lobby, [900, () => ev.start(0.4)], [1800, 'spawnEcho']];
    const STAGES = {
      'idle':              [[0, 'scan']],
      // F258: the bench's room. The taggers are the only rows; the rest waits behind the fold.
      'idle-noisy':        [[0, () => ev.scanNoisy()]],
      'idle-noisy-open':   [[0, () => ev.scanNoisy()], [150, 'scanOther']],
      'idle-assigned':     [[0, () => ev.scanNoisy('BRAVO')]],   // MC told this phone which gun it carries
      'idle-bt-off':         [[0, () => ev.bluetoothOff()]],           // F211: no enable/settings buttons (iOS-like)
      'idle-bt-off-android': [[0, () => ev.bluetoothOff('android')]],  // F211: TURN ON BLUETOOTH + BLUETOOTH SETTINGS
      'picker-location-off': [[0, () => ev.locationOff()]],             // F340: Android 11, Location off: TURN ON LOCATION
      'connected':         [[0, 'linkGun'], [50, () => ev.battery(82)]],
      // F137 (field 2026-09-12): MC binds while the player still sits on the pre-kit CONNECTED screen —
      // the one case that used to need an UNRELATED field to also change before the screen ever caught up.
      'kitted-headset-off': [...kitted, [400, () => ev.flapGun(3)]],   // bench 2026-09-17: HEADSET OFF? + RECONNECT NOW
      'connected-headset-off': [[0, 'linkGun'], [50, () => ev.battery(82)], [400, () => ev.flapGun(2)]],   // the same, before MC binds
      'kitted-headset-joining':    [...kitted, [400, () => ev.headsetJoin('joining')]],      // F293: $VERSION reads ?, the phone waits
      'kitted-headset-not-joined': [...kitted, [400, () => ev.headsetJoin('not_joined')]],   // F293: 60 s of ?, waits for RECONNECT NOW
      // A60 x HUD QA R2-06: the three JOIN rows, by the reason autojoin.js gives (app.js `offerMc` sets exactly this shape)
      'connected-join-new':        [[0, 'linkGun'], [50, () => ev.battery(82)], [300, () => ev.discovered('new', 'ws://192.168.1.44:8766/ws', 'mdns')]],
      'connected-join-unverified': [[0, 'linkGun'], [50, () => ev.battery(82)], [300, () => ev.discovered('unproven', 'ws://192.168.100.144:8766/ws', 'sweep')]],
      'connected-join-several':    [[0, 'linkGun'], [50, () => ev.battery(82)], [300, () => ev.discovered('several', 'ws://192.168.1.44:8766/ws', 'sweep')]],
      'connected-linked':  [[0, 'linkGun'], [400, 'mcBound']],
      'setup':             [[0, () => { policy.kit_open = false; }], ...kit],
      'briefing':          kit,
      'briefing-long':     [...kit, [250, 'longGame']],                                                       // F110: a two-line name AND a wrapped loadout line
      'kitted':            kitted,
      'kitted-ready':      [...kitted, [400, () => ev.ready(true)]],
      'loadout-primary':   [...kitted, [400, () => ev.openLoadout('primary')]],
      'loadout-secondary': [...kitted, [400, () => ev.openLoadout('secondary')]],
      'loadout-picked':    [...kitted, [400, () => ev.openLoadout('primary')], [600, () => ev.pick('primary', 'weapon', 'smg')]],
      'loadout-sidearms':  [[0, () => { policy.secondary.kinds = ['sidearm']; policy.secondary.allowed_weapon_ids = DEMO_WEAPONS.filter(w => w.role === 'sidearm').map(w => w.weapon_id); }], ...kitted, [400, () => ev.openLoadout('secondary')]],
      'kitted-perk':       [...kitted, [400, () => ev.pick('perk', 'perk', 'quick_hands')]],
      'kitted-full':       [[0, 'fullKit'], ...kitted],                                                       // A14: all three plates filled
      'loadout-perk':      [[0, 'fullKit'], ...kitted, [400, () => ev.openLoadout('perk')]],
      // A26 (S20): tapping a row equips AND arms it. ⟳ while it is arming, ✓ once MC has acked.
      'loadout-arming':    [...kitted, [400, () => ev.slowAck(9000)], [500, () => ev.openLoadout('primary')], [700, () => ev.tap('.lrow[data-arg="weapon:smg"]')]],
      'loadout-info':      [...kitted, [400, () => ev.openLoadout('primary')], [700, () => ev.tap('.lrow[data-arg="weapon:shotgun"] .linfo')]],   // the ⓘ READS a row without equipping it
      // S50 (2026-09-17): Easy Reload LEFT the perk slot for the per-player accessibility block, so the two-tap
      // ALT-button conflict it used to raise here cannot happen from the picker any more. The fixture keeps the
      // two-weapon kit, because that is the state the conflict needed, and the screen-truth step now proves the
      // retirement instead of the warning.
      'loadout-perk-conflict': [[0, 'twoWeapons'], ...kitted, [400, () => ev.openLoadout('perk')]],
      'tryout':            [...kitted, [400, () => ev.tryout('smg')]],
      'lobby':             lobby,
      // Bench 2026-09-16: readied up in the kit, then the host pushed the lobby (the state Tony saw grey).
      'lobby-ready':       [...kitted, [400, () => ev.ready(true)], [700, 'config']],
      // A27/A30 (loadout.md §4.4): the host pushed the lobby while this player was still in the rack.
      'lobby-kit-locked':  [...kitted, [400, () => ev.openLoadout('primary')], [700, 'config']],
      // A38 x A39 (T2 integration): benched from the kit screen, and benched out of a pushed LOBBY —
      // the second is the one that proves SITTING OUT beats the lobby's own READY UP button.
      'standby':           [...kitted, [400, () => ev.bench()]],
      'standby-from-lobby': [...lobby, [700, () => ev.bench()]],
      'kit-refused':       [...kitted, [400, () => ev.refuse()]],                                             // A30: MC's refusal copy, verbatim, on the kit screen
      'armed':             [...lobby, [900, () => ev.start(+q.get('tminus') || 30)]],
      'aborted':           [...lobby, [900, () => ev.start(30)], [1600, 'abort']],
      'live':              live,
      'live-gun-no-answer': [...live, [2300, 'gunNoAnswer']],             // F288: phone-visible, actionable health verdict
      'live-pool-wrong':   [...live, [2300, 'poolsDoubled']],             // F341 x HUD QA R2-02: two repairs do not hold, the engine says pool_wrong
      'live-gun-locked':   [...live, [2300, 'gunLocked']],               // F272: power-cycle takeover + real drop/relink recovery
      'live-fired':        [...live, [2300, () => ev.fire(7)]],
      'live-hit':          [...live, [2300, () => { ev.hit(); ev.hit(); ev.hit(); }]],
      // S57: one IR callout word from a victim's gun, as this gun reports it ($HIR, protocol 15; see docs/ir-callouts.md)
      'live-callout-kill':     [...live, [2300, () => engine.feedFrame(`$HIR,4,15,7,3,${21 + foe.tid},0,0,*`)]],    // DOWN_BY naming me: KILL CONFIRMED
      // S57 names (Tony 2026-09-24): the victim's phone sends DOWN_BY (me) and, 300 ms later, DOWN (VIPER): the card names VIPER
      'live-callout-named':    [...live, [2300, () => engine.feedFrame(`$HIR,4,15,7,3,${21 + foe.tid},0,0,*`)], [2600, () => engine.feedFrame(`$HIR,4,15,19,3,${25 + foe.tid},0,0,*`)]],   // 300 ms: the sender's own gap (CALLOUT_NAME_GAP_MS)
      'live-callout-enemy':    [...live, [2300, () => engine.feedFrame(`$HIR,4,15,19,3,${25 + foe.tid},0,0,*`)]],   // DOWN naming VIPER: ENEMY DOWN
      'live-callout-teammate': [[0, () => ev.addMate()], ...live, [2300, () => engine.feedFrame(`$HIR,4,15,23,3,${25 + team.tid},0,0,*`)]],  // DOWN naming MAVERICK (my team): TEAMMATE DOWN (QA-05: a teammate the roster can name)
      // docs/announcer.md (field 2026-09-24, Tony: the lead banner and the kill confirm overlapped): MC's kill feedback and
      // its lead alert on the SAME tick. The announcer queue shows KILL CONFIRMED first, then the lead banner once its slot ends.
      'live-announcer':        [...live, [2300, () => { ev.killConfirm('VIPER'); ev.alert('lead_taken', 'YOUR TEAM TAKES THE LEAD'); }]],
      'live-lowhp':        [...live, [2300, 'lowHp']],
      'live-poison':       [[0, () => { bundle.dot = DEMO_DOT; }], ...live, [2300, () => ev.poison()]],          // S16: POISONED, counting down, health draining
      'live-smoke':        [...live, [2300, 'smoke']],                     // S53: SMOKED, where the reticle was
      'down-poisoned':     [[0, () => { bundle.dot = DEMO_DOT; }], ...live, [2300, () => ev.poisonLethal()]],    // S16: the tick kills, DOWN says POISONED BY
      'live-lowammo':      [...live, [2300, () => ev.fire(29)]],
      // Bench 2026-09-17 (brx-weapons item 6): a charge_rifle cell too small for one full charge (10) shows
      // NOT ENOUGH ENERGY, not the plain low-ammo warning; at exactly the cost it does not.
      'live-charge-low':   [[0, 'chargeRifle'], ...live, [2300, () => ev.chargeAmmo(9)]],
      'live-charge-ok':    [[0, 'chargeRifle'], ...live, [2300, () => ev.chargeAmmo(10)]],
      'live-kill':         [...live, [2300, () => ev.killConfirm()]],
      'down':              [...live, [2300, () => ev.score(3, 1, 1)], [2350, 'die']],
      'down-recap':        [...live, [2100, () => { ev.hit(); ev.dealt(18); ev.dealt(9); }], [2300, () => ev.score(3, 1, 1)], [2350, 'die']],   // S56: TAKEN and DEALT on the down screen
      // The death screen's states (deathscreen.js). Each is a real life through the engine; see `fullLife` above.
      'down-full':         [[0, 'addGhost'], ...live, ...fullLife],
      'down-partial':      [[0, 'addGhost'], ...live, [1950, 'mcLost'], [1960, 'mcBound'], ...fullLife],            // the link dropped this life: DEALT stays PARTIAL
      'down-unclear':      [[0, 'viperTwin'], ...live, [2000, () => ev.hitFrom(19, 9, 20)], [2350, () => ev.dieFrom(19, 9)]],   // AR and USP-S share mag 9
      'down-zero-dealt':   [...live, [2000, () => { ev.fire(4); ev.hitFrom(19, 9, 20); }], [2300, () => ev.score(3, 1, 1)], [2350, () => ev.dieFrom(19, 9)]],
      'down-pickup':       [...live, [2000, () => ev.hitFrom(19, 20, 30)], [2350, () => ev.dieFrom(19, 20)]],       // mag 20 is the Shotgun, not in VIPER's kit
      'down-ffa':          [[0, 'addGhost'], ...live, ...fullLife.slice(0, 2), [2300, 'scoreFfa'], [2350, () => ev.dieFrom(19, 9)]],
      'down-hill':         [[0, () => { config.mode = 'koth'; }], ...live, [2200, () => ev.beacon(1)], [2300, () => ev.score(3, 1, 1)], [2350, () => ev.dieFrom(19, 9)]],
      'down-stale':        [[0, 'addGhost'], ...live, ...fullLife, [2500, 'mcLost']],
      // An MC older than S56: its roster carries no weapons, it pushes no score and relays no hit. The phone can name
      // the killer from the roster but no weapon, and has nothing dealt: the screen must say so, not invent it.
      'down-old-mc':       [[0, () => { for (const r of roster) delete r.weapons; }], ...live, [2000, () => { ev.fire(3); ev.hitFrom(19, 9, 20); }], [2350, () => ev.dieFrom(19, 9)]],                                   // the board is old now: shown with its age
      'live-reload':       [...live, [2300, () => ev.fire(12)], [2600, 'reloadCycle']],
      'live-reload-overrun': [[0, () => { player.loadout = { weapons: [{ weapon_id: 'shotgun' }] }; }], ...live, [2300, () => ev.fire(20)], [2600, () => ev.reloadChain(18, 800)]],   // F123: the chain reload — nominal is the PER-SHELL time, so the bar is in overrun for the whole reload
      'live-switch':       [[0, 'twoWeapons'], ...live, [2300, () => ev.fire(3)], [2600, 'altCycle']],
      'live-switch-perk':  [[0, 'quickSwitch'], ...live, [2300, () => ev.fire(3)], [2600, 'alt']],
      'down-hold':         [[0, () => ev.scanner(8)], ...live, [2300, 'die'], [2400, () => ev.station(-70, true)]],
      'down-find':         [[0, () => ev.scanner(3)], ...live, [2300, 'die'], [2400, () => ev.station(null)]],
      'down-find-presence': [[0, () => ev.scanner(3, 'presence')], ...live, [2300, 'die'], [2400, () => ev.station(null)]],
      'down-approach':     [[0, () => ev.scanner(3)], ...live, [2300, 'die'], [2400, () => ev.station(-78, false)]],
      'down-at':           [[0, () => ev.scanner(3)], ...live, [2300, 'die'], [2400, () => ev.station(-58, true)]],
      'live-alert':        [...live, [2300, () => ev.alert('bomb_planted')]],
      'live-medals':       [...live, [2300, () => ev.killMedals(['double_kill', 'killing_spree'])]],
      // QA lane B (2026-09-23): the station-respawn spawn shield (2 s, `shielded`), the F15 stun, and OVERHEAT.
      'live-shield':       [...live, [2300, 'die'], [2800, 'stationRespawn']],
      'live-stunned':      [[0, () => { config.stun = { duration_s: 10 }; }], ...live, [2300, 'stun']],
      'live-overheat':     [...live, [2300, 'overheat']],
      'redeploy':          [...live, [2300, 'die'], [2800, 'respawn']],
      'live-nogun':        [...live, [2300, 'dropGun']],
      'resync':            [...live, [2300, 'dropGun'], [3300, 'relinkGun']],   // a live rejoin → the 3 s RECONCILING takeover (S7.1)
      'resync-prompt':     [...live, [2300, 'resyncProbe']],                     // the trigger-first resync prompt itself
      'live-mclost':       [...live, [2300, 'mcLost']],
      // Bench 2026-09-17: MC's live score push has landed -- what the scores overlay (tap the name or the clock) reads.
      'live-scores':       [...live, [2300, () => ev.score(3, 1, 1)]],
      'live-scores-ffa':   [[0, () => { config.mode = 'ffa'; }], ...live, [2300, () => ev.scoreFfa()]],
      'mc-rejected':       [...kitted, [400, 'mcRejected']],
      'result':            [...live, [2200, () => ev.fire(12)], [2300, () => ev.score(3, 1, 1)], [2400, 'end']],
      'over':              [...live, [2200, () => ev.fire(12)], [2300, () => ev.score(3, 1, 1)], [2400, 'end'], [2600, 'endOk']],
      // ---- A24 FINAL RESULTS. `ended` is the local fact; the OUTCOME only ever arrives as a `result` push. ----
      'result-pending':    [...live, [2200, () => ev.fire(12)], [2300, () => ev.score(3, 1, 1)], [2400, 'end'], [2500, 'mcLost']],            // ended, no result, MC gone: PENDING — never "lost"
      'result-unreached':  [...live, [2200, () => ev.fire(12)], [2300, () => ev.score(3, 1, 1)], [2400, 'end'], [2500, 'unreached']],         // ... and still nothing 30 s later: MC NOT REACHED
      'result-win-team':   [...live, [2200, () => ev.fire(12)], [2300, () => ev.score(3, 1, 1)], [2400, 'end'], [2600, () => ev.result('win')]],
      'result-lose-ffa':   [...live, [2200, () => ev.fire(12)], [2300, () => ev.score(3, 1, 1)], [2400, 'end'], [2600, () => ev.resultFfa('lose')]],
      'result-draw':       [...live, [2200, () => ev.fire(12)], [2300, () => ev.score(3, 1, 1)], [2400, 'end'], [2600, () => ev.result('draw')]],
      'result-undecided':  [...live, [2200, () => ev.fire(12)], [2300, () => ev.score(3, 1, 1)], [2400, 'end'], [2600, () => ev.result('undecided')]],
      'result-players':    [...live, [2200, () => ev.fire(12)], [2300, () => ev.score(3, 1, 1)], [2400, 'end'], [2600, () => ev.result('win')], [2700, () => ev.rtab('player')]],
      'history':           [...live, [2200, () => ev.fire(12)], [2300, () => ev.score(3, 1, 1)], [2400, 'end'], [2600, () => ev.result('win')], [2700, 'seedHistory'], [2800, () => ev.view('history')]],
      'down-at-cap-offline': [...live, [2300, 'capBoard'], [2400, 'mcLost'], [2500, 'die']],                                                  // A31: one off the cap with no MC link
      'armed-with-mc-verify': [[0, () => { game.mc_verify = 'A WIN IS CONFIRMED AT MISSION CONTROL · RETURN AFTER THE WHISTLE'; }], ...lobby, [900, () => ev.start(+q.get('tminus') || 30)]],
      'panic':             [...live, [2300, 'panic']],
      'diag':              [...kitted, [400, () => ev.diag(true)]],                                            // F122: the ⓘ panel, nothing churning under it
      'diag-live':         [...live, [2300, () => ev.diag(true)]],                                             // F122: the SAME panel while the live clock rewrites its data 4×/s
      // F156/F135 (field 2026-09-12): the join controls (SCAN QR + typed address) now also live in the ⓘ
      // panel, reachable BEFORE a gun is linked and in every phase after. `connected-diag` proves the one
      // case where the pre-join screen's own copy (same #mcurl id) would otherwise coexist with it.
      'idle-diag':         [[0, 'scan'], [400, () => ev.diag(true)]],
      'connected-diag':    [...[[0, 'linkGun']], [400, () => ev.diag(true)]],
      // ---- QA lane C (2026-09-23), QA-05: the callout card. The hill stages drive the REAL engine's hill logic with the
      // grenade's own IR words: a beacon (magnitude 8), then the capture word (magnitude 50) naming the new owner. Default team
      // only: on yellow (tid 2, the neutral sentinel) the engine refuses to decide ownership (F82) and stays silent. ----
      'live-callout-by':    [[0, () => ev.addMate()], ...live, [2300, () => engine.feedFrame(`$HIR,4,15,23,3,${21 + foe.tid},0,0,*`)]],   // DOWN_BY naming MAVERICK: ENEMY DOWN · BY MAVERICK
      'live-hill-captured': [[0, () => { config.mode = 'koth'; }], ...live, [2200, () => ev.beacon(2)], [2400, () => ev.hillTaken(team.tid)]],
      'live-hill-lost':     [[0, () => { config.mode = 'koth'; }], ...live, [2200, () => ev.beacon(team.tid)], [2400, () => ev.hillTaken(team.tid === 0 ? 3 : 0)]],   // we hold it (adopted silently), then an enemy's capture word
      // ---- A56 powerups: every state below is the REAL engine, fed a powerup game and fake station adverts ----
      'live-pu':             [[0, () => ev.powerups()], ...live],                                                      // a powerup game, nothing near: the HUD is unchanged
      'live-pu-spawn':       [[0, () => ev.powerups(1)], ...live],                                                     // OVERSHIELD AVAILABLE, 1 s after go-live
      'live-pu-approach':    [[0, () => ev.powerups()], ...live, [2300, () => ev.puAt(4, { median: -62 })]],          // heard, not at it: GET CLOSER
      'live-pu-claim':       [[0, () => ev.powerups()], ...live, [2300, () => ev.puAt(4)]],                             // standing at it: the ring, HOLD STILL
      'live-pu-rockets':     [[0, () => ev.powerups()], ...live, [2300, () => ev.puTake(4)]],                           // the station named me: ROCKETS, 2 charges beside the ammo
      'live-pu-swap':        [[0, () => ev.powerups()], ...live, [2300, () => ev.puTake(4)], [3900, () => ev.puTake(5)]],   // RAIL GUN replaces ROCKETS
      'live-pu-overshield':  [[0, () => ev.powerups()], ...live, [2300, () => ev.puTake(6)]],                           // +75 on the shield bar
      'live-pu-overshield-hit': [[0, () => ev.powerups()], ...live, [2300, () => ev.puTake(6)], [4800, () => ev.hit(30)]],   // hits take the overshield first (after the 1 s protected grant)
      'live-pu-select':      [[0, () => ev.powerups()], ...live, [2300, () => ev.puTake(4)], [6300, 'puSelect']],       // SELECT: the AR back on the trigger, the rockets kept
      'live-pu-empty':       [[0, () => ev.powerups()], ...live, [2300, () => ev.puTake(4)], [4700, 'puFire'], [4800, 'puFire']],   // both rockets fired: the AR back on the trigger
      'down-pu-held':        [[0, () => ev.powerups()], ...live, [2300, () => ev.puTake(4)], [3900, 'die']],           // a death with an item held: it is gone
      'live-pu-taken-by':    [[0, () => ev.powerups()], ...live, [2300, () => ev.puTake(4, 19)]],                      // VIPER won it: TAKEN BY VIPER
      'live-pu-no-answer':   [[0, () => ev.powerups()], ...live, [2300, () => ev.puAt(4)]],                             // ready, and the station never answers
      'live-pu-taken':       [[0, () => ev.powerups()], ...live, [2300, () => ev.puAt(4, { state: 0, value: 110, median: -60 })]],   // taken: the countdown to the next spawn
      // polish r1 (UX): a hit while standing at a station (the QA-04 weapon line must not cover the hint), the widest
      // night row (Shields preset, 3-digit pools, a 175 overshield) and an Easy Reload player at a weapon station
      'live-pu-claim-hit':   [[0, () => ev.powerups()], ...live, [2300, () => ev.puAt(4)], [2700, () => ev.hitFrom(19, 9, 9)]],
      // ---- The shield meter (the Visor, 2026-09-24): the Shields preset through the REAL engine's S29 recharge ----
      'live-shields':          [[0, () => { ev.powerups(); ev.shieldsPreset(); }], ...live],                                          // spawns at 0; the engine refills after its delay
      'live-shields-full':     [[0, () => { ev.powerups(); ev.shieldsPreset(); }], ...live, [2300, 'shieldFill']],
      'live-shields-hit':      [[0, () => { ev.powerups(); ev.shieldsPreset(); }], ...live, [2300, 'shieldFill'], [2900, () => ev.shieldHit(30)]],
      'live-shields-broken':   [[0, () => { ev.powerups(); ev.shieldsPreset(); }], ...live, [2300, 'shieldFill'], [2900, 'shieldBreak']],   // the recharge starts on its own after the delay
      'live-shields-os':       [[0, () => { ev.powerups(); ev.shieldsPreset(); }], ...live, [2300, 'shieldFill'], [2600, 'overshield']],
      'live-shields-os-hit':   [[0, () => { ev.powerups(); ev.shieldsPreset(); }], ...live, [2300, 'shieldFill'], [2600, 'overshield'], [5000, () => ev.shieldHit(37)]],
      'lobby-shields':         [[0, () => ev.shieldsPreset()], ...lobby],                                                                  // the pre-game line of a no-armour game
      'redeploy-shields':      [[0, () => { ev.powerups(); ev.shieldsPreset(); }], ...live, [2300, 'die'], [2800, 'respawn']],            // REDEPLOYED in a no-armour game
      'live-shields-callout':  [[0, () => { ev.addMate(); ev.powerups(); ev.shieldsPreset(); }], ...live, [2300, 'shieldFill'], [2500, () => engine.feedFrame(`$HIR,4,15,23,3,${21 + foe.tid},0,0,*`)]],   // the meter beside the callout card
      'live-shields-claim':    [[0, () => { ev.powerups(); ev.shieldsPreset(); }], ...live, [2300, 'shieldFill'], [2500, () => ev.puAt(4)]],   // the meter beside the powerup hint
      'live-pu-overshield-wide': [[0, () => { ev.powerups(); ev.widePools(); }], ...live, [2300, () => ev.puTake(6)]],
      'live-pu-easy-reload': [[0, () => { ev.powerups(); player.loadout = { ...player.loadout, overrides: { easy_reload: true } }; }], ...live, [2300, () => ev.puAt(4)]],
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
  setTimeout(() => engine.onMcMessage({ kind: 'feedback', body: { player_id: 'p-demo', kind: 'kill', t: Date.now(), cue: golden.cues.kill, victim_team: 'yellow', victim: 'p-viper', victim_display: 'VIPER' } }), afterSpawn + 4500);
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
