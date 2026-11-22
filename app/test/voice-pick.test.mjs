// Tony 2026-11-22 (bench): the player picks their voice on the KIT screen. The phone half: the VOICE row's state,
// the debounced `loadout_request {slot: "voice"}`, the ack, and the preview gate that plays MC's line (with its
// `$VOL`) on the gun only before the match. MC's half is mcp/tests/test_mc_voice_pick.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine.js';
import { mkStorage } from './_helpers.mjs';
import { renderHtml } from './hud-html-harness.mjs';

const VOICES = [{ id: 'heavy', name: 'HEAVY' }, { id: 'male', name: 'MALE' }, { id: 'scout', name: 'SCOUT' }];
const POL = { hud_select: true, kit_open: true, primary: { choice: 'player', allowed_ids: ['assault_rifle'] },
  secondary: { choice: 'player', kinds: ['weapon'], allowed_weapon_ids: [] }, perk: { choice: 'player', allowed_perk_ids: [] } };
const PREVIEW = ['$VOL,90,0,*', '$PLAY,V3I,4,6,,,,,*'];

function kit({ voices = VOICES, policy = POL } = {}) {
  const writes = [], reports = [];
  let clock = 1_000_000;
  const eng = new Engine({ writer: fr => writes.push(...fr), report: (k, b) => reports.push({ k, b }), now: () => clock, synced: () => true,
    storage: mkStorage(), log: () => {}, delay: (ms, fn) => fn() });
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const team = { team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 };
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  const catalog = { weapons: [{ weapon_id: 'assault_rifle', name: 'Assault Rifle', clip: 32, reserve: 192 }], perks: [], ...(voices ? { voices } : {}) };
  eng.onMcMessage({ kind: 'assign', body: { player, team, roster: [], catalog, policy } });
  const h = { eng, writes, reports, player, team, catalog, policy, adv: ms => { clock += ms; eng.tick(); },
    sent: () => reports.filter(r => r.k === 'loadout_request').map(r => r.b),
    ack: body => eng.onMcMessage({ kind: 'loadout_ack', body: { slot: 'voice', loadout: player.loadout, ...body } }) };
  return h;
}

test('the KIT screen shows the voice MC holds, and steps wrap through MC\'s list', () => {
  const h = kit();
  const st = h.eng.state();
  assert.equal(st.voice, 'male'); assert.equal(st.canPickVoice, true); assert.equal(st.voices.length, 3);
  assert.ok(h.eng.stepVoice(1)); assert.equal(h.eng.state().voice, 'scout', 'the row changes at once');
  assert.ok(h.eng.stepVoice(1)); assert.equal(h.eng.state().voice, 'heavy', 'wraps at the end');
  assert.ok(h.eng.stepVoice(-1)); assert.equal(h.eng.state().voice, 'scout', 'and back');
  assert.equal(h.eng.state().voicePending, true);
});

test('only the voice a thumb stops on goes to MC, after the debounce', () => {
  const h = kit();
  h.eng.stepVoice(1); h.eng.stepVoice(1); h.eng.stepVoice(1);
  assert.deepEqual(h.sent(), [], 'nothing on the wire inside the window');
  h.adv(400);
  assert.deepEqual(h.sent(), [{ player_id: 'p1', slot: 'voice', kind: 'voice', id: 'male' }]);
  h.adv(400);
  assert.equal(h.sent().length, 1, 'sent once');
});

test('the same voice again asks for another line', () => {
  const h = kit();
  assert.ok(h.eng.requestVoice('male')); h.adv(400);
  assert.deepEqual(h.sent().map(b => b.id), ['male']);
});

test('an ok ack ends the pending look; the voice itself comes from MC\'s assign', () => {
  const h = kit();
  h.eng.stepVoice(1); h.adv(400);
  h.ack({ ok: true });
  assert.equal(h.eng.state().voicePending, false);
  assert.deepEqual(h.eng.state().voiceAck && h.eng.state().voiceAck.ok, true);
  assert.equal(h.eng.state().voice, 'male', 'until MC re-assigns, the voice MC holds');
  h.eng.onMcMessage({ kind: 'assign', body: { player: { ...h.player, voice: 'scout' }, team: h.team, roster: [], catalog: h.catalog, policy: h.policy } });
  assert.equal(h.eng.state().voice, 'scout');
  assert.equal(h.eng.state().loadoutAck, null, 'a voice ack is not a loadout verdict');
  h.adv(4100);
  assert.equal(h.eng.state().voiceAck, null, 'the verdict clears after 4 s');
});

test('a refusal reverts the row and keeps MC\'s reason', () => {
  const h = kit();
  h.eng.stepVoice(1); h.adv(400);
  h.ack({ ok: false, reason: 'THE MATCH HAS STARTED' });
  const st = h.eng.state();
  assert.equal(st.voice, 'male'); assert.equal(st.voicePending, false);
  assert.deepEqual([st.voiceAck.ok, st.voiceAck.reason], [false, 'THE MATCH HAS STARTED']);
});

test('an ack for an older pick keeps a newer pick on screen', () => {
  const h = kit();
  h.eng.stepVoice(1); h.adv(400);
  h.eng.stepVoice(1);                              // heavy, still in the window
  h.ack({ ok: true });                             // the scout ack
  assert.equal(h.eng.state().voice, 'heavy'); assert.equal(h.eng.state().voicePending, true);
});

test('no list from MC (an older MC): no picker and nothing sent', () => {
  const h = kit({ voices: null });
  assert.equal(h.eng.state().canPickVoice, false);
  assert.equal(h.eng.stepVoice(1), false); assert.equal(h.eng.requestVoice('scout'), false);
  h.adv(400); assert.deepEqual(h.sent(), []);
});

test('a closed kit refuses locally, and a pick in the window is dropped when the kit closes', () => {
  const h = kit({ policy: { ...POL, kit_open: false } });
  assert.equal(h.eng.canPickVoice(), false); assert.equal(h.eng.requestVoice('scout'), false);
  const h2 = kit();
  h2.eng.stepVoice(1);
  h2.eng.onMcMessage({ kind: 'assign', body: { player: h2.player, team: h2.team, roster: [], catalog: h2.catalog, policy: { ...POL, kit_open: false } } });
  h2.adv(400);
  assert.deepEqual(h2.sent(), []); assert.equal(h2.eng.state().voicePending, false);
});

test('the voice preview plays on the gun with its $VOL before the match', () => {
  const h = kit();
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'apply', body: { preview: true, frames: PREVIEW } });
  assert.deepEqual(h.writes, PREVIEW);
});

test('a preview with any other frame is dropped whole', () => {
  const h = kit();
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'apply', body: { preview: true, frames: ['$VOL,90,0,*', '$CLEAR,*'] } });
  assert.deepEqual(h.writes, []);
});

test('nothing plays while ARMED or LIVE: a preview is dropped there', () => {
  for (const phase of ['armed', 'live']) {
    const h = kit();
    h.eng.phase = phase;
    h.writes.length = 0;
    h.eng.onMcMessage({ kind: 'apply', body: { preview: true, frames: PREVIEW } });
    assert.deepEqual(h.writes, [], phase);
  }
});

test('the KIT screen draws the VOICE row with its two arrows and the name', () => {
  const h = kit();
  h.eng.closeBriefing();
  const html = renderHtml({ now: 1_000_000, state: h.eng.state(), hud: {} }).screen;
  assert.match(html, /data-testid="voice-row"/);
  assert.match(html, /data-act="onVoiceStep" data-arg="-1"/); assert.match(html, /data-act="onVoiceStep" data-arg="1"/);
  assert.match(html, /data-act="onVoiceHear"[^>]*>.*VOICE · 2\/3.*MALE/s);
  const none = kit({ voices: null }); none.eng.closeBriefing();
  assert.doesNotMatch(renderHtml({ now: 1_000_000, state: none.eng.state(), hud: {} }).screen, /voice-row/, 'no list, no row');
});
