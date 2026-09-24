// The announcer queue (docs/announcer.md). Field 2026-09-24, app 0.4.11 (Tony): "the hud alert for takes the
// lead and the kill confirmation both played on top of each other. they should not overlap". Every announcer
// voice line and every banner / callout card now goes through ONE queue in the engine; these tests drive the
// real Engine on a mocked clock (the engine's `now` and `delay`), with no real timer anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine, IR_CALLOUT } from '../src/engine.js';
import { Announcer, ANNOUNCE_PRIORITY, ANNOUNCE_TTL_MS, CLIP_MS, clipMs } from '../src/announcer.js';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
const catalog = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/data/sound_catalog.json', import.meta.url))));
const KILL = 'VAA', LEAD = 'VA6D', LEAD_LOST = 'VA6E', ENEMY_DOWN = 'VB8';

function mkStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }

// Me: p1, player_num 7, BLUE (tid 1). VIPER: 19, YELLOW (tid 2).
function harness({ num = 7, mode = 'tdm', shieldMax = null } = {}) {
  const writes = [], logs = []; let clock = 1_000_000; const timers = [];
  const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }];
  const config = { config_id: golden.config_id, mode, environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: 'auto', delay_s: 5 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 }, teams };
  const player = { player_id: 'p1', player_num: num, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const roster = [{ player_id: 'p1', player_num: num, display: 'REAPER', team_id: 'blue' }, { player_id: 'p2', player_num: 19, display: 'VIPER', team_id: 'yellow' },
    { player_id: 'p3', player_num: 20, display: 'GHOST', team_id: 'blue' }, { player_id: 'p4', player_num: 21, display: 'SABLE', team_id: 'yellow' }];
  // `delay` is the engine's own timer seam: here it runs on the mocked clock, so a 120 ms flash-then-line gap is real
  const eng = new Engine({ writer: fr => fr.forEach(f => writes.push({ f, t: clock })), emit: () => {}, report: () => {}, now: () => clock,
    synced: () => true, storage: mkStorage(), log: m => logs.push(String(m)), delay: (ms, fn) => timers.push({ at: clock + ms, fn }), rng: () => 0 });
  const bundle = { ...golden, player_id: 'p1', callout_team: 0 };
  if (shieldMax != null) {   // a shield ceiling on every $PSET the gun is armed with (F341 repairs a pool above its ceiling)
    const t5 = f => f.split(',').map((tok, i) => (i === 5 ? String(shieldMax) : tok)).join(',');
    bundle.head = bundle.head.map(f => (f.startsWith('$PSET,') ? t5(f) : f));
    if (Array.isArray(bundle.pset_pool)) bundle.pset_pool = bundle.pset_pool.map(t5);
  }
  const run = () => { for (;;) { timers.sort((a, b) => a.at - b.at); if (!timers.length || timers[0].at > clock) return; timers.shift().fn(); } };
  const h = {
    eng, writes, logs, now: () => clock,
    adv(ms, step = 50) { const end = clock + ms; while (clock < end) { clock = Math.min(end, clock + step); run(); eng.tick(); run(); } return h; },
    live() {
      eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
      eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster } });
      eng.onMcMessage({ kind: 'config', body: { config, frames: bundle, roster } });
      eng.feedFrame('$LCD,0,0,0,0,0,0,*');
      eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
      h.adv(3000); eng.feedFrame('$LCD,45,70,0,0,30,90,*'); h.adv(3000); writes.length = 0; logs.length = 0; return h;
    },
    kill(extra = {}) { eng.onMcMessage({ kind: 'feedback', body: { player_id: 'p1', kind: 'kill', t: clock, victim_team: 'yellow', victim: 'p2', victim_display: 'VIPER', ...extra } }); run(); return h; },
    alert(kind, text) { eng.onMcMessage({ kind: 'alert', body: { kind, text: text || kind, t: clock } }); run(); return h; },
    irWord(p, magnitude) { eng.feedFrame(`$HIR,4,15,${p},0,${magnitude},0,0,*`); run(); return h; },
    plays(id) { return writes.filter(w => w.f.startsWith('$PLAY,') && w.f.split(',')[4] === id); },
  };
  return h;
}

// ---------- the field bug ----------

test('announcer: a kill confirm and a lead change on the same tick play kill first, then the lead, never together', () => {
  const h = harness().live();
  h.kill(); const cardAt = h.eng.moment.at;
  h.alert('lead_taken', 'YOUR TEAM TAKES THE LEAD');             // MC's own order: the kill's feedback, then its lead alert
  h.adv(200);                                                     // past the 120 ms flash-then-line gap
  assert.equal(h.plays(KILL).length, 1, 'the kill confirm plays at once');
  assert.equal(h.plays(LEAD).length, 0, 'the lead change waits: it must not play on top of the kill line');
  assert.equal(h.eng.moment.kind, 'kill', 'the kill card owns the screen; the lead banner is not up yet');
  h.adv(4000);
  assert.equal(h.plays(LEAD).length, 1, 'then the lead change plays');
  const killAt = h.plays(KILL)[0].t, leadAt = h.plays(LEAD)[0].t;
  assert.ok(leadAt - killAt >= CLIP_MS[KILL], `the lead line starts after the kill line has finished (${leadAt - killAt} ms apart)`);
  assert.ok(leadAt - cardAt >= 1800, `and after the kill card has had its 1.8 s hold, so the two banners never share the screen (${leadAt - cardAt} ms)`);
  assert.equal(h.eng.moment.kind, 'alert', 'the lead banner went up with its line');
});

test('announcer: a higher-priority item jumps the queue whatever order it arrived in', () => {
  const h = harness().live();
  h.irWord(20, IR_CALLOUT.DOWN_BY + 2);                              // a line is already on air ("Target down.", 1.0 s)
  h.alert('lead_taken'); h.kill();                                   // both wait: lead arrived FIRST, kill second
  h.adv(6000);
  const kill = h.plays(KILL)[0], lead = h.plays(LEAD)[0];
  assert.ok(kill && lead, 'both played');
  assert.ok(kill.t < lead.t, 'the own kill confirm goes ahead of the lead change that was queued before it');
});

test('announcer: a line still playing is never cut, and no $PLAYX is written for a kill confirm', () => {
  const h = harness().live();
  h.alert('lead_lost');
  h.adv(200); h.kill();
  assert.equal(h.plays(KILL).length, 0, 'the kill waits for the lead line to finish');
  assert.equal(h.writes.filter(w => w.f === '$PLAYX,0,*').length, 0, 'F149/F158: nothing stopped with $PLAYX');
  h.adv(3000);
  assert.equal(h.plays(KILL).length, 1);
  assert.ok(h.plays(KILL)[0].t - h.plays(LEAD_LOST)[0].t >= CLIP_MS[LEAD_LOST]);
});

// ---------- expiry and dedupe ----------

test('announcer: a lead change is must-hear: behind 6 s of medal lines it waits and plays, it never expires (gap B1)', () => {
  const h = harness().live();
  const medals = ['killtacular', 'killing_spree', 'double_kill'];
  h.kill({ medals });   // ~6 s of medal lines on air (no IR word: this item is the kill confirm)
  h.alert('lead_taken');
  h.adv(9000);
  assert.equal(ANNOUNCE_TTL_MS.lead_taken, Infinity);
  assert.equal(h.plays(LEAD).length, 1, 'the lead change waited out the kill and played');
  const lastId = golden.cues[medals[2]].split(',')[4], last = h.plays(lastId)[0];
  assert.ok(h.plays(LEAD)[0].t >= last.t + CLIP_MS[lastId], 'after the last medal line ended');
});

test('announcer: IR said my kill, then MC\'s medals and the lead change: the lead change plays before the medal lines', () => {
  const h = harness().live();
  h.irWord(7, IR_CALLOUT.DOWN_BY + 2); h.adv(300);                // IR first: the kill line is said
  h.kill({ medals: ['double_kill', 'killing_spree'] });           // MC: two medal lines left to say (a `medal` item)
  h.alert('lead_taken', 'YOUR TEAM TAKES THE LEAD');
  h.adv(12000);
  const ids = ['double_kill', 'killing_spree'].map(m => golden.cues[m].split(',')[4]);
  const lead = h.plays(LEAD)[0], m1 = h.plays(ids[0])[0], m2 = h.plays(ids[1])[0];
  assert.ok(lead && m1 && m2, 'all three said');
  assert.ok(killLines(h).length === 1 && killLines(h)[0].t < lead.t, 'the kill line first');
  assert.ok(lead.t < m1.t && m1.t < m2.t, `then the lead change, then the medals (${lead.t - m1.t} ms)`);
});

test('announcer: duplicates collapse, and a newer lead state replaces the queued older one', () => {
  const h = harness().live();
  h.kill();
  h.alert('next_kill_wins'); h.alert('next_kill_wins');            // the same alert twice: one line
  h.adv(5000);
  assert.equal(h.plays('V115').length, 1, 'one NEXT KILL WINS');
  h.kill();
  h.alert('lead_taken'); h.alert('lead_lost');                      // the lead changed twice while waiting: only the newest is true
  h.adv(5000);
  assert.equal(h.plays(LEAD).length, 0, 'the stale "takes the lead" is replaced');
  assert.equal(h.plays(LEAD_LOST).length, 1, 'by the newer "lost the lead"');
});

// ---------- S57 kept ----------

test('announcer: the S57 name pairing still makes ONE callout, even while it waits in the queue', () => {
  const h = harness().live();
  h.irWord(21, IR_CALLOUT.DOWN + 2);                                // on air: an earlier death's ENEMY DOWN (a lone DOWN)
  h.irWord(20, IR_CALLOUT.DOWN_BY + 2); h.adv(300);                 // player 20 killed a yellow...
  h.irWord(19, IR_CALLOUT.DOWN + 2);                                // ...and it was VIPER (paired, 300 ms later)
  assert.equal(h.plays(ENEMY_DOWN).length, 1, 'the second callout still waits behind the first line');
  h.adv(3000);
  assert.equal(h.plays(ENEMY_DOWN).length, 2, 'one ENEMY DOWN per death, none for the name word');
  const co = h.eng.state().callout;
  assert.equal(co.kind, 'enemy_down'); assert.equal(co.victim, 'VIPER', 'the queued callout took the name');
});

test('announcer: one kill never flashes twice -- IR first, then MC: one kill line and one flash-worthy card', () => {
  const h = harness().live();
  h.irWord(7, IR_CALLOUT.DOWN_BY + 2);                              // my kill, heard over IR
  h.adv(300); h.kill();                                             // MC confirms the same kill
  h.adv(4000);
  assert.equal(h.plays(KILL).length, 1, 'one kill line');
  assert.equal(h.eng.moment.kind, 'kill');
  assert.equal(h.eng.moment.data.ir_paired, true, 'MC\'s card knows the IR card already flashed for this kill');
});

test('announcer: MC first, IR second while MC is still queued: no IR card of its own', () => {
  const h = harness().live();
  h.alert('lead_lost');                                             // on air
  h.kill();                                                         // MC's confirm queues behind it
  h.irWord(7, IR_CALLOUT.DOWN_BY + 2);                              // the IR twin lands while MC waits
  assert.equal(h.eng.state().callout, null, 'no IR KILL CONFIRMED card on top of the lead banner');
  h.adv(5000);
  assert.equal(h.plays(KILL).length, 1, 'one kill line');
  assert.equal(h.eng.moment.data.ir_paired, false, 'MC\'s card is the only card for the kill, so it flashes');
});

// ---------- the unit ----------

test('announcer unit: the tables are single constants and cover every kind', () => {
  assert.equal(ANNOUNCE_PRIORITY[0], 'kill_confirmed', 'Tony: the own kill confirm first');
  assert.deepEqual(ANNOUNCE_PRIORITY.slice(1, 3), ['lead_taken', 'lead_lost'], 'then the lead change');
  for (const k of ANNOUNCE_PRIORITY) assert.ok(ANNOUNCE_TTL_MS[k] > 0, `a TTL for ${k}`);
});

test('announcer unit: every CLIP_MS row matches the sound catalogue', () => {
  const byId = new Map(catalog.sounds.map(s => [s.id, Math.round(s.duration_s * 1000)]));
  for (const [id, ms] of Object.entries(CLIP_MS)) assert.equal(ms, byId.get(id), `${id}`);
  assert.equal(clipMs('$PLAY,,4,6,VA6D,,,,*'), 1943);
  assert.equal(clipMs('$PLAY,,4,6,VB0N,,,,*', 0), 0, 'a bundle cue_ms of 0 wins');
});

test('announcer unit: a silent card gives way to a kill confirm at once; a sounding one does not', () => {
  let t = 0; const played = [];
  const a = new Announcer(() => t);
  const item = (kind, audioMs) => ({ kind, audioMs, play: () => played.push(kind) });
  a.push(item('teammate_down', 0));
  t = 100; a.push(item('kill_confirmed', 700));
  assert.deepEqual(played, ['teammate_down', 'kill_confirmed'], 'the teammate card had no sound: the kill takes the screen');
  t = 5000; a.tick();
  a.push(item('enemy_down', 1014));
  t = 5100; a.push(item('kill_confirmed', 700));
  assert.deepEqual(played.slice(2), ['enemy_down'], 'Target down. is still sounding: the kill waits');
  t = 5100 + 1014 + 150; a.tick();
  assert.deepEqual(played.slice(2), ['enemy_down', 'kill_confirmed'], 'same card surface: it takes over when the audio ends');
});

// ---------- phantom-kill guards (2026-09-24 investigation: every kill confirm matched an MC-credited kill) ----------

const KILL_POOL = (golden.cue_pools && golden.cue_pools.kill) || [golden.cues.kill];
const killLines = h => h.writes.filter(w => KILL_POOL.includes(w.f));

test('announcer guard: a station hill beacon (magnitude 8) five times, 5 s apart, is never a kill confirm', () => {
  const h = harness().live();
  for (let i = 0; i < 5; i++) { h.eng.feedFrame('$HIR,4,15,0,2,8,0,0,*'); h.adv(5000); }
  assert.equal(killLines(h).length, 0, 'no kill line');
  assert.notEqual(h.eng.state().callout && h.eng.state().callout.kind, 'kill_confirmed', 'no KILL CONFIRMED card');
  assert.equal(h.logs.filter(l => /S57/.test(l)).length, 0, 'the S57 callout path never saw it: ' + h.logs.filter(l => /S57/.test(l)).join(' | '));
});

test('announcer guard: a bare DOWN naming this phone is logged, not dropped silently (field: magnitude 28 where 22 was expected)', () => {
  const h = harness({ num: 2 }).live();
  h.eng.feedFrame('$HIR,4,15,2,0,28,0,0,*');
  assert.ok(h.logs.some(l => l === 'S57: DOWN naming me, magnitude 28, ignored'), 'the log line: ' + h.logs.join(' | '));
  assert.equal(killLines(h).length, 0); assert.equal(h.eng.state().callout, null);
});

test('announcer invariant: only MC feedback{kill} or a DOWN_BY naming me ever queues a kill confirm', () => {
  const h = harness().live();
  const kinds = []; const push = h.eng._ann.push.bind(h.eng._ann);
  h.eng._ann.push = it => { kinds.push(`${it.kind}:${it.src || ''}`); return push(it); };
  // every other way a word or a message can reach the announcer
  h.eng.feedFrame('$HIR,4,15,0,2,8,0,0,*');              // hill beacon
  h.irWord(19, IR_CALLOUT.DOWN_BY + 1);                    // DOWN_BY naming someone else (VIPER killed a blue)
  h.adv(700); h.irWord(7, IR_CALLOUT.DOWN + 1);           // a bare DOWN naming me
  h.adv(700); h.irWord(7, IR_CALLOUT.FLAG_TAKEN + 2);     // a reserved CTF word naming me
  h.alert('kill', 'KILL');                                  // an alert that calls itself a kill
  h.eng.onMcMessage({ kind: 'feedback', body: { player_id: 'p1', kind: 'hit', t: h.now(), victim: 'p2', victim_num: 19, dmg: 9 } });
  h.adv(6000);
  assert.ok(!kinds.some(k => k.startsWith('kill_confirmed')), 'no unknown source queued a kill confirm: ' + kinds.join(', '));
  assert.equal(killLines(h).length, 0, 'and no kill line was said');
  // the control: the two real sources do queue one each
  h.irWord(7, IR_CALLOUT.DOWN_BY + 2); h.adv(4000); h.kill({ victim_team: 'blue' }); h.adv(4000);
  assert.deepEqual(kinds.filter(k => k.startsWith('kill_confirmed')), ['kill_confirmed:ir', 'kill_confirmed:mc']);
});

// ---------- polish round 1 ----------

test('announcer: a kill behind a 4-medal stack is never dropped: its card shows in order; its voice, 8 s late, does not', () => {
  const h = harness().live();
  const medals = ['killtacular', 'killing_spree', 'double_kill', 'triple_kill'];
  h.kill({ medals }); h.adv(500); h.kill({ victim_display: 'GHOST' });   // the second kill lands 0.5 s into ~8 s of medal lines
  const cards = [];
  for (let i = 0; i < 280; i++) { h.adv(50); const c = h.eng.state().card; if (c && c.kind === 'kill' && !cards.includes(c)) cards.push(c); }
  assert.equal(cards.length, 2, 'both kill cards showed: the second was not dropped: ' + h.logs.filter(l => /expired/.test(l)).join(' | '));
  assert.equal(cards[1].data.victim, 'GHOST');
  const ids = medals.map(m => golden.cues[m].split(',')[4]);
  assert.ok(cards[1].at >= h.plays(ids[3])[0].t + CLIP_MS[ids[3]] - 120, 'and after the last medal line had finished');
  assert.equal(killLines(h).length, 0, 'round 2 backstop: a kill line that would start > 6 s after its kill is not said');
});

test('announcer: a spree of 5 kills 1 s apart, each with a medal, never queues more than ~4 s of voice', () => {
  const h = harness().live();
  const medals = [[], ['double_kill'], ['triple_kill'], ['killtacular'], ['killing_spree']];
  const voice = () => { const a = h.eng._ann, now = h.now(); return a.queue.reduce((t, q) => t + q.audioMs, 0) + (a.current ? Math.max(0, a.current.audioUntil - now) : 0); };
  let worst = 0;
  for (const m of medals) { h.kill({ medals: m }); worst = Math.max(worst, voice()); for (let i = 0; i < 20; i++) { h.adv(50); worst = Math.max(worst, voice()); } }
  h.adv(8000);
  assert.ok(worst <= 4500, `the queued voice peaked at ${worst} ms`);
  assert.equal(h.plays(golden.cues.killing_spree.split(',')[4]).length, 1, 'the newest medal line was said');
});

test('announcer: a kill confirm dropped unheard never silences its twin (the pairing is undone)', () => {
  const h = harness().live();
  h.alert('lead_lost');                                       // on air
  h.irWord(7, IR_CALLOUT.DOWN_BY + 2);                        // my IR kill confirm queues behind it
  h.eng._ann.clear();                                         // ...and is dropped unheard (the gun link dropped)
  h.kill();                                                   // MC's twin for the same kill
  h.adv(4000);
  assert.equal(killLines(h).length, 1, 'MC speaks the kill: nobody heard the IR confirm');
  assert.equal(h.eng.moment.data.ir_paired, false, 'and its card flashes, because no IR card showed');
});

test('announcer: an ENEMY DOWN never cuts the KILL CONFIRMED card short', () => {
  const h = harness().live();
  h.irWord(7, IR_CALLOUT.DOWN_BY + 2); const at = h.now();   // my kill: line ~0.76 s, card 2 s
  h.adv(100); h.irWord(20, IR_CALLOUT.DOWN_BY + 2);           // a teammate's kill queues behind it
  h.adv(1500);
  assert.equal(h.eng.state().callout.kind, 'kill_confirmed', 'the kill card keeps its hold after its line has ended');
  h.adv(1000);
  assert.equal(h.eng.state().callout.kind, 'enemy_down');
  assert.ok(h.plays(ENEMY_DOWN)[0].t - at >= 2000);
});

test('announcer unit: a flapping hill word never jumps a waiting kill confirm', () => {
  let t = 0; const played = [];
  const a = new Announcer(() => t);
  const hill = kind => ({ kind, key: 'hill', preemptKey: true, audioMs: 1924, play: ({ preempted }) => played.push(kind + (preempted ? '!' : '')) });
  a.push(hill('hill_captured'));
  t = 200; a.push({ kind: 'kill_confirmed', audioMs: 756, play: () => played.push('kill') });
  t = 400; a.push(hill('hill_lost'));
  assert.deepEqual(played, ['hill_captured'], 'the kill waits for the sounding hill line; the newer hill word waits behind the kill');
  t = 2400; a.tick(); t = 4500; a.tick();
  assert.deepEqual(played, ['hill_captured', 'kill'], 'the kill went first; the hill word, 4 s stale by then, is dropped (TTL 3 s)');
  // the control: with nothing higher waiting, the newer hill word still takes over at once ($PLAYX while it sounds)
  const b = new Announcer(() => t); played.length = 0;
  b.push(hill('hill_captured')); t += 300; b.push(hill('hill_lost'));
  assert.deepEqual(played, ['hill_captured', 'hill_lost!']);
});

test('announcer unit: a hill line and a powerup card never overlap, whichever lands first', () => {
  let t = 0; const played = [];
  const a = new Announcer(() => t);
  const hill = { kind: 'hill_captured', key: 'hill', preemptKey: true, audioMs: 1924, play: () => played.push(['hill', t]) };
  const spawn = { kind: 'powerup_spawn', key: 'pu:ROCKETS', play: () => played.push(['spawn', t]) };
  a.push(hill); t = 100; a.push(spawn);
  for (; t < 6000; t += 50) a.tick(t);
  assert.equal(played[1][0], 'spawn'); assert.ok(played[1][1] >= 2200, `the spawn card waits out the hill card's slot (${played[1][1]} ms)`);
  const b = new Announcer(() => t); played.length = 0; const t0 = t;
  b.push(spawn); t += 100; b.push(hill);
  for (; t < t0 + 6000; t += 50) b.tick(t);
  assert.equal(played[1][0], 'hill'); assert.ok(played[1][1] - t0 >= 2400, `the hill waits out the silent spawn card (${played[1][1] - t0} ms)`);
});

test('announcer unit: a silent card a kill takes over shows again after the kill', () => {
  let t = 0; const played = [];
  const a = new Announcer(() => t);
  a.push({ kind: 'powerup_swap', key: 'pu_swap', play: () => played.push('swap') });
  t = 100; a.push({ kind: 'kill_confirmed', audioMs: 756, play: () => played.push('kill') });
  for (; t < 5000; t += 50) a.tick(t);
  assert.deepEqual(played, ['swap', 'kill', 'swap'], 'the swap card is not lost');
});

test('announcer: the pool voice lines and the infection line wait their turn', () => {
  const h = harness({ mode: 'infection' }).live();
  h.eng.frames.team_flip = { 1: ['$TID,1,*'], 2: ['$TID,2,*'] };   // the infection flip's table, as MC ships it
  h.kill();                                                   // on air: the kill card holds 1.8 s
  h.adv(200); h.eng.feedFrame('$HP,45,70,40,*');              // a shield grant: "Shield up"
  const up = golden.cues.shield_up.split(',')[4];
  assert.equal(h.plays(up).length, 0, 'the pool line does not play on top of the kill line');
  h.eng.feedFrame('$HIR,4,0,19,2,60,0,0,*'); h.eng.feedFrame('$HP,0,0,0,*');   // shot dead: this gun turns
  const inf = golden.cues.infected.split(',')[4];
  h.adv(100);
  assert.equal(h.plays(inf).length, 0, 'the infection line waits for the kill line');
  h.adv(4000);
  assert.equal(h.plays(inf).length, 1, 'then plays');
});

// ---------- round 2 + cue delivery (Tony's match 2026-09-24) ----------

test('M2: two same-team deaths 400 ms apart, the first name word lost: the second name pairs with the second death', () => {
  const h = harness().live();
  h.irWord(20, IR_CALLOUT.DOWN_BY + 2);                          // GHOST kills a yellow (its name word never comes)
  h.adv(400); h.irWord(7, IR_CALLOUT.DOWN_BY + 2);                // 400 ms later I kill another yellow
  h.adv(300); h.irWord(21, IR_CALLOUT.DOWN + 2);                  // SABLE's name word, 300 ms after MY kill word
  assert.equal(h.eng.state().callout.kind, 'enemy_down');
  assert.equal(h.eng.state().callout.victim, undefined, 'GHOST\'s kill (on air) is not named SABLE');
  h.adv(1000);
  assert.equal(h.eng.state().callout.kind, 'kill_confirmed');
  assert.equal(h.eng.state().callout.victim, 'SABLE', 'my kill is');
});

test('L3: a card a kill displaced takes its name while it waits to show again', () => {
  const h = harness().live();
  h.irWord(19, IR_CALLOUT.DOWN_BY + 1);                          // VIPER kills a blue: TEAMMATE DOWN, a silent card
  assert.equal(h.eng.state().callout.kind, 'teammate_down');
  h.adv(100); h.irWord(7, IR_CALLOUT.DOWN_BY + 2);                // my kill takes the screen; the teammate card is re-queued
  assert.equal(h.eng.state().callout.kind, 'kill_confirmed');
  h.adv(200); h.irWord(20, IR_CALLOUT.DOWN + 1);                  // the teammate's name word: GHOST
  h.adv(2500);
  assert.equal(h.eng.state().callout.kind, 'teammate_down');
  assert.equal(h.eng.state().callout.victim, 'GHOST', 'the card shows again, named');
});

test('C1: a first-blood kill (a medal) with its lead alert, then the IR word: one kill line, and the kill card', () => {
  const h = harness().live();
  h.kill({ medals: ['first_blood'] }); h.alert('lead_taken');     // MC: the medal replaces MC's plain line
  h.adv(300); h.irWord(7, IR_CALLOUT.DOWN_BY + 2);               // the IR twin of the same kill
  h.adv(8000);
  assert.equal(killLines(h).length, 1, 'the kill is confirmed once: the IR word says it, since MC\'s item said only the medal');
  assert.equal(h.plays(golden.cues.first_blood.split(',')[4]).length, 1, 'and the medal is said');
  assert.ok(h.plays(KILL_POOL[0].split(',')[4])[0].t < h.plays(LEAD)[0].t, 'the kill line goes ahead of the lead change');
  assert.ok(!h.logs.some(l => /MC already played/.test(l)), 'no false "MC already played the kill cue" log');
});

test('C2: a hit in the same render as the kill card cannot swallow it', () => {
  const h = harness().live();
  h.kill(); h.alert('lead_taken');
  h.eng.feedFrame('$HIR,4,0,19,2,9,0,3,*'); h.eng.feedFrame('$HP,40,70,0,*');   // shot in the same tick
  assert.equal(h.eng.state().card.kind, 'kill', 'the kill card is still there for the HUD to draw');
  h.adv(2000);
  assert.equal(h.eng.state().card.kind, 'alert', 'then the lead banner');
});

test('C3: a non-must-hear line that would start > 2 s after its event shows its card silently', () => {
  const h = harness().live();
  h.kill(); h.alert('lead_lost'); h.alert('next_kill_wins');       // NKW waits 1.8 s + 2.8 s
  h.adv(8000);
  assert.equal(h.plays('V115').length, 0, 'NEXT KILL WINS 4.6 s late is not said');
  assert.equal(h.plays(LEAD_LOST).length, 1, 'the must-hear lead line still is (3 s late is inside its TTL)');
  assert.ok(h.logs.some(l => /next_kill_wins|alert would start/.test(l) && /without its line/.test(l)), 'and the log says why');
});

// ---------- the gun's audio FIFO (bench 2026-09-24, brx2 on Tactix-FE30) ----------

const PLAYX = '$PLAYX,0,*';
/** The frames written from index `from`, as a list of '$PLAYX' / clip ids, for reading an order at a glance. */
const tail = (h, from) => h.writes.slice(from).map(w => w.f === PLAYX ? 'X' : w.f.startsWith('$PLAY,') ? w.f.split(',')[4] : null).filter(Boolean);
const quiet = h => { h.eng.frames = { ...h.eng.frames }; return h; };

test('P2: a must-hear kill line sends one $PLAYX per clip the gun still holds, then the line; none when the gun is quiet', () => {
  const h = quiet(harness().live());
  h.eng._write(['$PLAY,,4,6,VA8C,,,,*'], 'test: a body clip'); h.eng._write(['$PLAY,,4,6,VA7,,,,*'], 'test: another');   // 1.5 s + 2.1 s queued
  h.adv(200); const n = h.writes.length;
  h.kill(); h.adv(200);
  assert.deepEqual(tail(h, n), ['X', 'X', 'VAA'], 'two stops, then the kill line');
  h.adv(4000); const m = h.writes.length;
  h.kill(); h.adv(200);
  assert.deepEqual(tail(h, m), ['VAA'], 'nothing outstanding: no stop');
});

test('P2 + hits: six hits whose $SIR row sound is 1.5 s, in 3 s, then a kill: a stop per hit clip still held, then the line', () => {
  const h = harness().live();
  h.eng._write(['$SIR,0,3,X13,1,9,0,0,0,*'], 'test: a hit row with a 1.548 s sound');
  for (let i = 0; i < 6; i++) { h.eng.feedFrame('$HIR,4,0,19,2,9,0,3,*'); h.adv(500); }
  const n = h.writes.length;
  h.kill(); h.adv(200);
  // FIFO from the first hit: 6 x 1548 ms, ending 1.5, 3.1, 4.6, 6.2, 7.7, 9.3 s. The kill line goes out at 3.15 s (the
  // 120 ms flash-then-line gap, on this 50 ms clock): two have finished, four are held.
  assert.deepEqual(tail(h, n), ['X', 'X', 'X', 'X', 'VAA']);
});

test('shield heartbeat: a kill mid-beat stops the beat (and any hit clip), then speaks; no beat until the line is over', () => {
  const h = harness().live();
  const loop = golden.cues.shield_loop.split(',')[4];
  h.eng._shieldLoopTick(h.now());                                 // the heartbeat, as `_shieldTick` plays it while the shield is gone
  h.adv(500); const n = h.writes.length;
  h.kill(); h.adv(150);
  assert.deepEqual(tail(h, n), ['X', 'VAA'], 'one stop for the beat, then the kill line');
  const vaa = killLines(h)[0];
  for (let i = 0; i < 40; i++) { h.adv(50); h.eng._shieldLoopTick(h.now()); }
  const beats = h.writes.filter(w => w.f.split(',')[4] === loop && w.t > vaa.t);
  assert.ok(beats.length >= 1 && beats[0].t - vaa.t >= CLIP_MS.VAA, `the next beat waits out the kill line (${beats.length ? beats[0].t - vaa.t : 'none'} ms)`);
});

// The shield loop: `$PSET` t23 (`energyShieldLoop`, A10 in the golden bundle) plays while the shield is above 0 and
// blocks the gun's FIFO indefinitely; `$PLAYX,0` stops it and it RESUMES on its own (bench 2026-09-24).
const shieldUp = h => { h.eng.feedFrame('$HP,45,70,105,*'); if (h.eng.shield <= 0) { h.eng.shield = 105; h.eng._audioSync(); } return h; };

test('shield loop: shield 105, kill confirm: $PLAYX,0 then VAA at once', () => {
  const h = shieldUp(harness({ shieldMax: 125 }).live());
  assert.equal(h.eng._gun.blocked, true, 'setup: the loop blocks the gun');
  const n = h.writes.length;
  h.kill(); h.adv(150);
  assert.deepEqual(tail(h, n), ['X', 'VAA']);
  h.adv(3000); const m = h.writes.length;
  h.kill(); h.adv(150);
  assert.deepEqual(tail(h, m), ['X', 'VAA'], 'the loop resumed, so the next must-hear line gets its own stop');
});

test('shield loop: a clip stuck behind it before the kill: two stops then the line; nothing ambient is written while it blocks', () => {
  const h = harness({ shieldMax: 125 }).live();
  h.eng._write(['$PLAY,,4,6,VA8C,,,,*'], 'test: a body clip');         // written just before the shield came up
  shieldUp(h);
  const n = h.writes.length;
  h.alert('next_kill_wins');                                           // an ambient alert: not must-hear, not objective
  h.eng._write(['$PLAY,,4,6,VA7,,,,*'], 'test: a body sound while blocked');
  h.adv(3000);
  assert.deepEqual(tail(h, n), [], 'no ambient write while the loop blocks: it would all play late at once');
  assert.equal(h.eng.state().card.data.kind, 'next_kill_wins', 'the banner still shows');
  h.kill(); h.adv(150);
  assert.deepEqual(tail(h, n), ['X', 'X', 'VAA'], 'one stop for the loop, one for the stuck clip, then the kill line');
});

test('shield loop: "Target down" is an objective line: it cuts the loop (a stop, then VB8), it is not muted (gap B2)', () => {
  const h = shieldUp(harness({ shieldMax: 125 }).live());
  const n = h.writes.length;
  h.irWord(20, IR_CALLOUT.DOWN_BY + 2); h.adv(200);
  assert.deepEqual(tail(h, n), ['X', ENEMY_DOWN]);
  assert.equal(h.eng.state().callout.kind, 'enemy_down');
});

test('shield loop: the hill lines are objective lines: each cuts the loop and is said (gap B2)', () => {
  const h = shieldUp(harness({ mode: 'koth', shieldMax: 125 }).live());
  h.eng.feedFrame('$HIR,4,15,0,2,8,0,0,*'); h.adv(50);                // the point, neutral
  const n = h.writes.length;
  h.eng.feedFrame('$HIR,4,15,0,1,50,0,0,*'); h.adv(200);              // BLUE (us) captures it
  assert.deepEqual(tail(h, n), ['X', 'VB0N'], 'Hill Captured, through the loop');
  h.adv(5000); const m = h.writes.length;
  h.eng.feedFrame('$HIR,4,15,0,0,50,0,0,*'); h.adv(200);              // RED takes it off us
  assert.deepEqual(tail(h, m), ['X', 'VB0P'], 'Hill Lost, through the loop');
});

test('the possession tick never sounds while my kill or its medal lines are on air (a token-1 clip cuts them)', () => {
  const h = harness({ mode: 'koth' }).live();
  const beacon = () => h.eng.feedFrame('$HIR,4,15,0,1,8,0,0,*');   // BLUE (us) holds the point
  beacon(); h.adv(2000);
  assert.ok(h.writes.some(w => w.f === '$PLAY,U100,4,6,,,,,*'), 'setup: the tick runs');
  const medals = ['double_kill', 'killing_spree'], ids = medals.map(m => golden.cues[m].split(',')[4]);
  const t0 = h.now();
  h.irWord(7, IR_CALLOUT.DOWN_BY + 2); h.adv(300); h.kill({ medals });
  for (let i = 0; i < 20; i++) { h.adv(400); if (i % 8 === 0) beacon(); }   // the point stays fresh
  const m2 = h.plays(ids[1])[0];
  assert.ok(m2, 'both medal lines said');
  const end = m2.t + CLIP_MS[ids[1]];
  const ticks = h.writes.filter(w => w.f === '$PLAY,U100,4,6,,,,,*' && w.t >= t0 && w.t < end).map(w => w.t - t0);
  assert.deepEqual(ticks, [], 'no tick from the kill\'s flash to the end of its last medal line');
  assert.ok(h.writes.some(w => w.f === '$PLAY,U100,4,6,,,,,*' && w.t >= end), 'and the tick resumes after');
});


// ---------- round 3 ----------

test('H1: 20 hits under the shield loop, then a kill: at most 4 stops; once the shield breaks the gun is free within one clip', () => {
  const h = harness({ shieldMax: 125 }).live();
  h.eng._write(['$SIR,0,3,X13,1,9,0,0,0,*'], 'test: a hit row with a 1.548 s sound');
  shieldUp(h);
  for (let i = 0; i < 20; i++) { h.eng.feedFrame('$HIR,4,0,19,2,9,0,3,*'); h.adv(100); }
  const n = h.writes.length;
  h.kill(); h.adv(150);
  const t = tail(h, n);
  assert.ok(t.filter(x => x === 'X').length <= 4 && t[t.length - 1] === 'VAA', 'a bounded flush, then the line: ' + t.join(' '));
  for (let i = 0; i < 20; i++) { h.eng.feedFrame('$HIR,4,0,19,2,9,0,3,*'); h.adv(100); }
  h.eng.feedFrame('$HP,45,70,0,*'); if (h.eng.shield > 0) { h.eng.shield = 0; } h.eng._audioSync();   // the shield breaks: the loop stops
  // Twenty hits replay as ONE hit clip, then the break cue the shield's fall itself plays (shield_down, N101).
  assert.equal(h.eng._gun.clips.filter(c => c.id === 'X13').length, 1, 'the hits collapsed to one pending clip');
  const busy = h.eng._gun.freeAt(h.now()) - h.now();
  assert.ok(busy <= CLIP_MS.X13 + CLIP_MS.N101, `free within one hit clip and the break cue (${busy} ms)`);
});

test('M2: the gun audio model is cleared with the announcer queue (a dropped link: the gun is power-cycled or gone)', () => {
  const h = harness().live();
  h.eng._write(['$PLAY,,4,6,JAS,,,,*'], 'test: stale');   // 10.7 s: still on the gun by any clock here
  h.eng.onBleDropped();                                    // no `$PLAYX` goes out on this path, so only a clear empties it
  assert.ok(!h.eng._gun.clips.some(c => c.why === 'test: stale'), 'the stale clip is gone: ' + JSON.stringify(h.eng._gun.clips.map(c => c.why)));
});

test('M3: shield up, a 2-medal kill: both medal lines are written, each right after its own stop', () => {
  const h = shieldUp(harness({ shieldMax: 125 }).live());
  const n = h.writes.length;
  h.kill({ medals: ['killtacular', 'killing_spree'] }); h.adv(6000);
  const ids = ['killtacular', 'killing_spree'].map(m => golden.cues[m].split(',')[4]);
  assert.deepEqual(tail(h, n), ['X', ids[0], 'X', ids[1]]);
});

test('M4: a double kill with medals: the second kill starts after the first kill\'s last clip, and nothing cuts the first', () => {
  const h = harness().live();
  const m1 = ['first_blood', 'killtacular'];   // VA7H 2.456 s, then V124: longer than the old fixed 2 s grid
  h.kill({ medals: m1 }); const t0 = h.now(); h.adv(500); h.kill({ medals: ['double_kill'] });
  h.adv(12000);
  const id1 = golden.cues[m1[0]].split(',')[4], id2 = golden.cues[m1[1]].split(',')[4];
  const first = h.plays(id1)[0], last = h.plays(id2)[0];
  // the gun plays FIFO: the second medal ends when it has played after the first, whenever it was written
  const lastEnd = Math.max(last.t, first.t + CLIP_MS[id1]) + CLIP_MS[id2];
  const second = h.plays(golden.cues.double_kill.split(',')[4])[0];
  assert.ok(second && second.t >= lastEnd, `the second kill waits for the first kill's last clip (${second && second.t - lastEnd} ms)`);
  assert.equal(h.writes.filter(w => w.f === PLAYX && w.t > t0 && w.t < lastEnd).length, 0, 'no stop over my own kill audio');
});

// ---------- the double buzz (screens.mjs "one kill, one buzz", seen once under load) ----------

test('one kill, one buzz: MC\'s card names the EXACT IR card it paired with, even when the clock moves between reads', () => {
  // hud.js silences MC's card only when `ir_at` equals the IR card's own `callout.at`. Both were read from the
  // synced clock at different instants; a millisecond tick between the two reads made them differ, and the one kill
  // flashed and buzzed twice. This clock moves 1 ms on every read, as a busy phone's does.
  const h = harness().live();
  const base = h.eng.now; let drift = 0;
  h.eng.now = () => base() + (drift += 1);
  h.irWord(7, IR_CALLOUT.DOWN_BY + 2);
  const irAt = h.eng.state().callout.at;
  h.kill();
  assert.equal(h.eng.state().card.data.ir_paired, true);
  assert.equal(h.eng.state().card.data.ir_at, irAt, 'the pairing names the card the HUD saw');
});
