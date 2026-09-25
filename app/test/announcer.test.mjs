// The announcer queue (docs/announcer.md). Field 2026-09-24, app 0.4.11 (Tony): "the hud alert for takes the
// lead and the kill confirmation both played on top of each other. they should not overlap". Every announcer
// voice line and every banner / callout card now goes through ONE queue in the engine; these tests drive the
// real Engine on a mocked clock (the engine's `now` and `delay`), with no real timer anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine, IR_CALLOUT } from '../src/engine.js';
import { Announcer, GunAudio, ANNOUNCE_PRIORITY, ANNOUNCE_TTL_MS, CLIP_MS, clipMs } from '../src/announcer.js';
import * as ann from '../src/announcer.js';

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

test('announcer: a kill confirm and a lead change on the same tick: kill first, then the lead banner, never together; the lead is voice-silent in the streak', () => {
  // Tony 2026-09-24: "i think that is right. they go silent when kill streaks are showing."
  const h = harness().live();
  h.kill(); const cardAt = h.eng.moment.at;
  h.alert('lead_taken', 'YOUR TEAM TAKES THE LEAD');             // MC's own order: the kill's feedback, then its lead alert
  h.adv(200);                                                     // past the 120 ms flash-then-line gap
  assert.equal(h.plays(KILL).length, 1, 'the kill confirm plays at once');
  assert.equal(h.eng.moment.kind, 'kill', 'the kill card owns the screen; the lead banner is not up yet');
  let leadCardAt = null;
  for (let i = 0; i < 80; i++) { h.adv(50); const c = h.eng.state().card; if (leadCardAt == null && c && c.kind === 'alert' && c.data.kind === 'lead_taken') leadCardAt = h.now(); }
  assert.equal(h.plays(LEAD).length, 0, 'the lead line is dropped, not held for later');
  assert.ok(leadCardAt != null && leadCardAt - cardAt >= 1800, `the lead banner still shows, after the kill card's 1.8 s hold (${leadCardAt && leadCardAt - cardAt} ms)`);
  assert.ok(h.logs.some(l => /lead_taken silent: kill streak on air/.test(l)), 'and the log says why');
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

test('announcer: a lead change with no kill streak waits behind an ordinary line and plays; the newest state wins (gap B1)', () => {
  const h = harness().live();
  h.alert('next_kill_wins');                                       // an ordinary line on air (V115, 2.9 s)
  h.adv(200); h.alert('lead_taken'); h.adv(200); h.alert('lead_lost');
  h.adv(9000);
  assert.equal(ANNOUNCE_TTL_MS.lead_taken, Infinity);
  assert.equal(h.plays(LEAD).length, 0, 'the older state is replaced while it waits');
  assert.equal(h.plays(LEAD_LOST).length, 1, 'the newest lead state plays');
  assert.ok(h.plays(LEAD_LOST)[0].t >= h.plays('V115')[0].t + CLIP_MS.V115, 'after the ordinary line ended');
});

test('announcer: a lead change behind 6 s of medal lines is voice-silent (Tony), and its banner shows after them', () => {
  const h = harness().live();
  const medals = ['killtacular', 'killing_spree', 'double_kill'];
  h.kill({ medals }); h.alert('lead_taken');
  let shown = false;
  for (let i = 0; i < 180; i++) { h.adv(50); const c = h.eng.state().card; if (c && c.kind === 'alert' && c.data.kind === 'lead_taken') shown = true; }
  assert.equal(h.plays(LEAD).length, 0);
  assert.ok(shown, 'the banner shows');
});

test('announcer: a hill line during my kill streak is voice-silent; its card still shows', () => {
  const h = harness({ mode: 'koth' }).live();
  h.eng.feedFrame('$HIR,4,15,0,2,8,0,0,*'); h.adv(50);             // the point, neutral
  h.kill({ medals: ['double_kill'] }); h.adv(300);
  h.eng.feedFrame('$HIR,4,15,0,1,50,0,0,*');                       // BLUE (us) captures it, mid-streak
  let shown = false;
  for (let i = 0; i < 120; i++) { h.adv(50); if (h.eng.state().hillCallout && h.eng.state().hillCallout.kind === 'hill_captured') shown = true; }
  assert.equal(h.plays('VB0N').length, 0, 'no Hill Captured line');
  assert.ok(shown, 'the hill card shows');
  assert.ok(h.logs.some(l => /hill_captured silent: kill streak on air/.test(l)));
  // CONTROL, no streak: RED takes it off us with nothing of mine on air: the line is said AND the card shows
  h.adv(3000); let lost = false;
  h.eng.feedFrame('$HIR,4,15,0,0,50,0,0,*');
  for (let i = 0; i < 60; i++) { h.adv(50); if (h.eng.state().hillCallout && h.eng.state().hillCallout.kind === 'hill_lost') lost = true; }
  assert.equal(h.plays('VB0P').length, 1, 'Hill Lost is said');
  assert.ok(lost, 'and its card shows');
});

test('announcer: IR said my kill, then MC\'s medals and the lead change: the lead banner shows before the medals, voice-silent', () => {
  const h = harness().live();
  h.irWord(7, IR_CALLOUT.DOWN_BY + 2); h.adv(300);                // IR first: the kill line is said
  h.kill({ medals: ['double_kill', 'killing_spree'] });           // MC: two medal lines left to say (a `medal` item)
  h.alert('lead_taken', 'YOUR TEAM TAKES THE LEAD');
  let leadAt = null;
  for (let i = 0; i < 240; i++) { h.adv(50); const c = h.eng.state().card; if (leadAt == null && c && c.kind === 'alert' && c.data.kind === 'lead_taken') leadAt = h.now(); }
  const ids = ['double_kill', 'killing_spree'].map(m => golden.cues[m].split(',')[4]);
  const m1 = h.plays(ids[0])[0], m2 = h.plays(ids[1])[0];
  assert.ok(m1 && m2 && m1.t < m2.t, 'both medal lines said, in order');
  assert.equal(h.plays(LEAD).length, 0, 'the lead line is voice-silent in the streak (Tony)');
  assert.ok(leadAt != null && leadAt < m1.t, 'its banner still shows, ahead of the medals (the `medal` rank)');
});

test('announcer: duplicates collapse, and a newer lead state replaces the queued older one', () => {
  const h = harness().live();
  h.kill();
  h.alert('next_kill_wins'); h.alert('next_kill_wins');            // the same alert twice: one line
  h.adv(5000);
  assert.equal(h.plays('V115').length, 1, 'one NEXT KILL WINS');
  h.alert('next_kill_wins', 'again');                               // an ordinary line on air, no kill streak
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
  assert.equal(h.plays(LEAD).length, 0, 'the lead change is voice-silent in the kill streak (Tony)');
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
  assert.equal(h.plays(LEAD_LOST).length, 0, 'the lead line is voice-silent: it met my kill on air (Tony)');
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

test('H1: first blood waits behind the lead change, a double kill arrives: first blood is never folded, and the HUD keeps it', () => {
  const h = harness().live();
  h.irWord(7, IR_CALLOUT.DOWN_BY + 2); h.adv(300);                 // kill 1: IR says the kill line
  h.kill({ medals: ['first_blood'] }); h.alert('lead_taken');       // MC: first blood (a `medal` item) and the lead change
  h.adv(1400);                                                      // the lead line is on air, first blood waits
  h.irWord(7, IR_CALLOUT.DOWN_BY + 2); h.adv(300);                 // kill 2 inside that window
  h.kill({ medals: ['double_kill'] });
  const seen = new Set();
  for (let i = 0; i < 240; i++) { h.adv(50); const c = h.eng.state().card; if (c && c.kind === 'kill') (c.data.medals || []).forEach(m => seen.add(m)); }
  const fb = h.plays(golden.cues.first_blood.split(',')[4])[0], dk = h.plays(golden.cues.double_kill.split(',')[4])[0];
  assert.ok(fb, 'first blood is said, not folded away');
  assert.ok(dk && dk.t > fb.t, 'then the newest tier, the double kill');
  assert.ok(seen.has('first_blood') && seen.has('double_kill'), 'the kill card lists both medals: ' + [...seen]);
  assert.ok(h.eng.medals.includes('first_blood'), 'and `medals` holds first blood');
});

test('X8: a spree fold keeps the plain kill line a folded kill still owed', () => {
  const h = harness().live();
  h.irWord(7, IR_CALLOUT.DOWN_BY + 2); h.adv(50);                  // kill X (a YELLOW victim): the IR confirm is on air
  h.kill({ victim_team: 'blue', victim: 'p3', victim_display: 'GHOST' });   // kill A (a BLUE victim, no IR twin): waits, owes its line
  h.adv(50);
  h.kill({ medals: ['double_kill'] });                              // kill B pairs with X on air; its medal folds A in
  h.adv(8000);
  assert.equal(h.plays(KILL).length, 2, 'X\'s IR line and A\'s own kill line: no kill goes unvoiced');
  assert.equal(h.plays(golden.cues.double_kill.split(',')[4]).length, 1, 'and the double kill');
});

test('X9: a silent card a kill displaces shows again without a second LED burst', () => {
  const h = harness().live();
  h.alert('killjoy', 'KILLJOY');                                    // a silent card with an LED burst (the golden bundle has no killjoy line)
  h.adv(100);
  const bursts = () => h.logs.filter(l => /write event led killjoy/.test(l)).length;
  assert.ok(bursts() >= 1, 'setup: the killjoy burst fired once');
  const first = bursts();
  h.kill();                                                         // my kill takes over the silent card
  let back = false;
  for (let i = 0; i < 200; i++) { h.adv(50); const c = h.eng.state().card; if (c && c.kind === 'alert' && c.data.kind === 'killjoy' && h.eng.moment.kind === 'alert') back = true; }
  assert.ok(back, 'setup: the killjoy card came back after the kill');
  assert.equal(bursts(), first, 'the card came back, its lights did not fire again');
});

// Tony 2026-09-24, "they go silent when kill streaks are showing": the streak guards, one test each.
const unitItem = (log, kind, audioMs, extra = {}) => ({ kind, audioMs, ...extra, play: ({ muted }) => log.push([kind, muted]) });

test('streak unit: a lead waiting behind an ordinary line goes silent when a kill with medals lands meanwhile (the start-time check)', () => {
  let t = 0; const log = [];
  const a = new Announcer(() => t);
  a.push(unitItem(log, 'alert', 2000));                    // an ordinary line on air
  t = 100; a.push(unitItem(log, 'lead_taken', 1900, { key: 'lead' }));   // no streak yet: queued with its voice
  t = 200; a.push(unitItem(log, 'kill_confirmed', 756)); a.push(unitItem(log, 'medal', 1787));
  for (t = 300; t < 15000; t += 50) a.tick(t);
  assert.deepEqual(log.find(x => x[0] === 'lead_taken'), ['lead_taken', true], 'the lead line is silent: the medal was queued when it started');
});

test('streak unit: CONTROL, a lead pushed right as the kill card\'s slot ends (no tick between) is said', () => {
  let t = 0; const log = [];
  const a = new Announcer(() => t);
  const k = a.push(unitItem(log, 'kill_confirmed', 756, { bannerMs: 1800 }));
  t = k.until;                                              // the kill's slot is over; `current` is not cleared yet
  a.push(unitItem(log, 'lead_taken', 1900, { key: 'lead' }));
  assert.deepEqual(log.find(x => x[0] === 'lead_taken'), ['lead_taken', false], 'no streak on air any more: the line is said');
});

test('streak unit: a muted lead card that a kill displaces comes back with no line', () => {
  let t = 0; const log = [];
  const a = new Announcer(() => t);
  a.push(unitItem(log, 'kill_confirmed', 756, { bannerMs: 1800 }));
  t = 100; a.push(unitItem(log, 'lead_taken', 1900, { key: 'lead' }));   // mid-streak: silent
  for (t = 150; t < 2000; t += 50) a.tick(t);                            // the lead card is up, muted
  assert.equal(a.current && a.current.kind, 'lead_taken');
  a.push(unitItem(log, 'kill_confirmed', 756, { bannerMs: 1800 }));      // a second kill takes over the silent card
  for (; t < 8000; t += 50) a.tick(t);
  assert.deepEqual(log.filter(x => x[0] === 'lead_taken'), [['lead_taken', true], ['lead_taken', true]], 'shown twice, silent both times');
});

test('M2 unit: a lead state on air again drops the stale opposite state still queued', () => {
  let t = 0; const played = [];
  const a = new Announcer(() => t);
  const lead = kind => ({ kind, key: 'lead', audioMs: 1900, play: () => played.push(kind) });
  a.push(lead('lead_taken')); t = 100; a.push(lead('lead_lost')); t = 200; a.push(lead('lead_taken'));
  assert.deepEqual(a.queue.map(q => q.kind), [], 'the queued lead_lost is false now: dropped with the duplicate');
  for (t = 300; t < 20000; t += 100) a.tick(t);
  assert.deepEqual(played, ['lead_taken']);
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

// ---------- my death wins (Tony 2026-09-25, F149 / F351 / X4) ----------
// "your death wins. delaying the death scream would be bad. while you are dead you can listen to the queue of KCs and
// game alerts"

/** An announcer on a gun model, with a switch for "I am dead". */
function deadRig() {
  let t = 0, dead = false; const log = [];
  const gun = new GunAudio(), a = new Announcer(() => t);
  a.gun = gun; a.dead = () => dead;
  return { a, gun, log, at: v => { t = v; }, now: () => t, die: (on, stopped = true) => { dead = on; if (on) a.death(t, stopped); },
    item: (kind, audioMs, extra = {}) => ({ kind, audioMs, ...extra, play: ({ muted, flush }) => log.push([kind, t, muted, !!flush]) }) };
}

test('death unit: while dead a must-hear line waits for the gun (no flush over the scream), and is still said 7 s on', () => {
  const r = deadRig();
  r.gun.add(7000, 'the scream and what the gun still holds', 0);
  r.die(true);
  r.a.push(r.item('kill_confirmed', 756));
  assert.deepEqual(r.log, [], 'not started over the scream');
  for (let t = 50; t < 9000; t += 50) { r.at(t); r.a.tick(t); }
  assert.equal(r.log.length, 1);
  const [, t0, muted] = r.log[0];
  assert.ok(t0 >= 7000 && !muted, `said once the gun is free (${t0} ms), past the 6 s late limit, with its line`);
});

test('death unit: an item queued while dead lives DEAD_QUEUE_TTL_MS, so a hill line behind 4 s of scream and kill is kept', () => {
  const r = deadRig();
  assert.ok(ann.DEAD_QUEUE_TTL_MS >= 8000, 'long enough for the scream, a kill line and two medal lines');
  r.gun.add(4000, 'the scream and a kill line', 0);
  r.die(true);
  r.a.push(r.item('hill_lost', 2976, { key: 'hill' }));
  for (let t = 50; t < 9000; t += 50) { r.at(t); r.a.tick(t); }
  assert.deepEqual(r.log.map(x => [x[0], x[2]]), [['hill_lost', false]], 'kept past its 3 s TTL, and said');
});

test('death unit: my kill line on air at the death is said again in full after the scream', () => {
  const r = deadRig();
  r.a.push(r.item('kill_confirmed', 756));
  r.gun.add(636, 'the kill line', 120);
  r.at(300); r.gun.add(1271, 'the scream', 300); r.die(true);
  for (let t = 350; t < 6000; t += 50) { r.at(t); r.a.tick(t); }
  assert.equal(r.log.filter(x => x[0] === 'kill_confirmed').length, 2, 'started twice: the second after the scream');
  assert.ok(r.log[1][1] >= 300 + 1271, `the replay waits out the scream (${r.log[1][1]} ms)`);
});

test('death unit: after the respawn the normal rules resume (a lead line in my kill streak is voice-silent again)', () => {
  const r = deadRig();
  r.die(true); r.a.push(r.item('lead_lost', 2675, { key: 'lead' }));
  for (let t = 50; t < 4000; t += 50) { r.at(t); r.a.tick(t); }
  assert.deepEqual(r.log.map(x => [x[0], x[2]]), [['lead_lost', false]], 'dead: said');
  r.die(false); r.at(5000);
  r.a.push(r.item('kill_confirmed', 756)); r.a.push(r.item('lead_taken', 1943, { key: 'lead' }));
  for (let t = 5050; t < 12000; t += 50) { r.at(t); r.a.tick(t); }
  assert.deepEqual(r.log.slice(1).map(x => [x[0], x[2]]), [['kill_confirmed', false], ['lead_taken', true]]);
});

test('death: the trade through the engine: the scream first (one stop for my kill line ahead of it, then none), then my kill line again, the lead change, the medal', () => {
  const h = harness().live();
  h.irWord(7, IR_CALLOUT.DOWN_BY + 2); h.adv(200);                       // my kill line is on the gun
  const d0 = h.writes.length, dAt = h.now();
  h.eng.feedFrame('$HIR,4,0,19,2,60,0,0,*'); h.eng.feedFrame('$HP,0,0,0,*');   // the trade: I am shot dead
  h.adv(200); h.kill({ medals: ['double_kill'] }); h.alert('lead_lost');
  h.adv(12000);
  const after = h.writes.slice(d0);
  const sp = (after.find(w => w.f.startsWith('$SPAWN')) || { t: Infinity }).t;   // the respawn write opens with its own $PLAYX
  const stops = after.filter(w => w.f === '$PLAYX,0,*' && w.t < sp);
  assert.ok(stops.length === 1 && stops[0].t === dAt, 'one stop, at the death, for the kill line ahead of the scream: ' + stops.map(w => w.t - dAt));
  const scream = CLIP_MS[golden.head.find(f => f.startsWith('$PSET,')).split(',')[10]];
  const vaa = after.filter(w => w.f.startsWith('$PLAY,') && w.f.split(',')[4] === KILL);
  const ll = h.plays(LEAD_LOST)[0], dk = h.plays(golden.cues.double_kill.split(',')[4])[0];
  assert.ok(vaa.length === 1 && vaa[0].t >= dAt + scream, 'my kill line again, after the scream');
  assert.ok(ll && ll.t >= vaa[0].t + CLIP_MS[KILL], 'then the lead change');
  assert.ok(dk && dk.t >= ll.t + CLIP_MS[LEAD_LOST], 'then the medal');
});

// ---------- review of 7173d400 (death-wins) ----------
const die = h => { h.eng.feedFrame('$HIR,4,0,19,2,60,0,0,*'); h.eng.feedFrame('$HP,0,0,0,*'); };
const stopsIn = (h, from, to = Infinity) => h.writes.slice(from).filter(w => w.f === '$PLAYX,0,*' && w.t < to);

test('H1: the lethal hit\'s own $SIR row sound is not counted ahead of the scream: a quiet gun sends no stop at death (F158)', () => {
  const h = harness().live();
  h.eng._write(['$SIR,0,0,X13,1,9,0,0,0,*'], 'test: a row with a 1.5 s sound');
  h.adv(2000); const n = h.writes.length;
  die(h);
  assert.deepEqual(stopsIn(h, n, h.now() + 1).map(w => w.t), [], 'no stop: it could land on the scream');
});

test('H2: a clip that ends within DEATH_STOP_SLACK_MS of the death is not stopped', () => {
  const h = harness().live();
  h.eng._write(['$PLAY,,4,6,VAA,,,,*'], 'test: a 636 ms line'); h.adv(550);   // it ends in about 86 ms
  const n = h.writes.length;
  die(h);
  assert.deepEqual(stopsIn(h, n, h.now() + 1).map(w => w.t), []);
});

test('M1: a death between two medal lines (no stop goes out) never says a line twice', () => {
  const h = harness().live();
  const medals = ['double_kill', 'killing_spree'], ids = medals.map(m => golden.cues[m].split(',')[4]);
  h.kill({ medals });
  h.adv(120 + CLIP_MS[ids[0]] + 50);                     // line 1 is over, line 2 is due in about 100 ms
  die(h); h.adv(9000);
  assert.equal(h.plays(ids[0]).length, 1, 'the first medal once');
  assert.equal(h.plays(ids[1]).length, 1, 'the second medal once');
});

test('M1: a death that cuts the second medal line replays only that line, not the lines already said', () => {
  const h = harness().live();
  const medals = ['double_kill', 'killing_spree'], ids = medals.map(m => golden.cues[m].split(',')[4]);
  h.kill({ medals });
  h.adv(120 + CLIP_MS[ids[0]] + 150 + 600);              // the second line has played about 0.5 s
  const n = h.writes.length;
  die(h); h.adv(9000);
  assert.equal(stopsIn(h, n, h.now()).length >= 1, true, 'setup: the death stopped the second line');
  assert.equal(h.plays(ids[0]).length, 1, 'the first medal is not said again');
  assert.equal(h.plays(ids[1]).length, 2, 'the cut line is said again, after the scream');
});

test('M2: at the respawn the spawn line is never cut, and my kill confirm is not lost', () => {
  const h = harness().live();
  h.irWord(7, IR_CALLOUT.DOWN_BY + 2); h.adv(200);
  die(h); h.adv(100);
  h.kill({ medals: ['killtacular', 'killing_spree', 'double_kill'] }); h.alert('lead_lost');   // ~8 s of lines while dead
  h.adv(16000);
  const sp = h.writes.findIndex(w => w.f.startsWith('$SPAWN'));
  assert.ok(sp > 0, 'setup: respawned');
  const spT = h.writes[sp].t;
  // the spawn line may wait behind a dead-queue line already on the gun (FIFO): give it that line's length too
  const cut = stopsIn(h, sp + 1).filter(w => w.t < spT + 4500);
  assert.deepEqual(cut.map(w => w.t - spT), [], 'no stop over the spawn line');
  assert.ok(killLines(h).some(w => w.t > spT - 16000), 'my kill line was said');
});

test('M3: a hill change while I am dead is queued and said after the scream', () => {
  const h = harness({ mode: 'koth' }).live();
  h.eng.feedFrame('$HIR,4,15,0,2,8,0,0,*'); h.adv(50);
  die(h); const dAt = h.now(); h.adv(300);
  h.eng.feedFrame('$HIR,4,15,0,1,50,0,0,*');   // BLUE (us) takes it while I am down
  h.adv(4000);
  const hc = h.plays('VB0N')[0];
  assert.ok(hc && hc.t >= dAt + 1271, 'Hill Captured, after the scream');
});
