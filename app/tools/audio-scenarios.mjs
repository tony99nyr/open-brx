// Deterministic audio cases for docs/audio-queue-scenarios.md.
import { simulateGun, GUN_RULES, CLIP_MS, PLAYX, play } from './gun-audio-sim.mjs';

export const CUE = Object.freeze({
  kill: 'VAA', lead_taken: 'VA6D', lead_lost: 'VA6E', hill_lost: 'VB0P', spawn: 'VAI',
  low_health: 'VA86', scream: 'VA3', pain_short: 'VAG', hill_tick: 'U100',
});
export const WANT = Object.freeze({
  kill: 'must', lead_taken: 'must', lead_lost: 'must', hill_lost: 'want', spawn: 'want',
  low_health: 'want', scream: 'native', pain_short: 'filler', hill_tick: 'filler',
});
export const ENGINE_MIRROR = Object.freeze({ PLAY_GAP_MS: 150 });
export const ANNOUNCE_PRIORITY = ['kill_confirmed', 'lead_taken', 'lead_lost', 'medal', 'hill_captured', 'hill_lost', 'powerup_swap', 'alert', 'teammate_down', 'enemy_down', 'powerup_spawn', 'status'];
export const ANNOUNCE_AUDIO_LATE_DEFAULT_MS = 2000;
export const MUST_HEAR = new Set(['kill_confirmed', 'medal', 'lead_taken', 'lead_lost']);
export const OBJECTIVE = new Set(['hill_captured', 'hill_lost', 'enemy_down']);

export const SCENARIOS = Object.freeze([
  { id: 'fifo-3s', title: 'FIFO clips 3.5 s apart', horizonMs: 12000,
    writes: [{ t: 0, frames: [play('VA6D')] }, { t: 3500, frames: [play('VA6E')] }, { t: 7000, frames: [play('VAA')] }] },
  { id: 'zero-gap-burst', title: 'Zero-gap four-clip burst', horizonMs: 12000, frameGapMs: 0,
    writes: [{ t: 0, frames: [play('VA6D'), play('VA6E'), play('VB0P'), play('VAA')] }] },
  { id: 'multi-stop-clear', title: 'Three stops in one write clear the queue', horizonMs: 8000,
    writes: [{ t: 0, frames: [play('VA6D')] }, { t: 100, frames: [play('VA6E')] }, { t: 200, frames: [play('VB0P')] }, { t: 300, frames: [play('VAA')] }, { t: 1500, frames: [PLAYX, PLAYX, PLAYX] }] },
  { id: 'single-stop-current', title: 'One stop cuts only the current clip', horizonMs: 8000,
    writes: [{ t: 0, frames: [play('VA6D')] }, { t: 100, frames: [play('VA6E')] }, { t: 500, frames: [PLAYX] }] },
  { id: 'death-stops-spaced', title: 'Two death stops, one write each, 150 ms apart', horizonMs: 6000,
    writes: [{ t: 0, frames: [play('VA6D')] }, { t: 50, frames: [play('VA6E')] }, { t: 100, frames: [PLAYX] }, { t: 250, frames: [PLAYX] }],
    natives: [{ t: 75, id: 'VA3', cue: 'scream' }] },
]);

export function runScenario(sc, _policyName = 'B', rules = GUN_RULES) {
  const gun = simulateGun({ writes: sc.writes, natives: sc.natives || [], horizonMs: sc.horizonMs }, sc.frameGapMs == null ? rules : { ...rules, writeFrameGapMs: sc.frameGapMs });
  return { scenario: sc.id, policy: 'B', gun, dropped: [], writes: sc.writes };
}
export function runAll(rules = GUN_RULES) { return SCENARIOS.map(sc => ({ sc, B: runScenario(sc, 'B', rules) })); }
export function summarise(run) {
  return { rows: run.gun.clips.map(c => ({ cue: c.cue, want: WANT[c.cue] || 'want', eventT: c.eventT,
    latency: c.latency, fate: c.status === 'never' ? 'never' : c.status === 'dropped' ? `dropped (${c.dropReason})` : c.status === 'flushed' ? 'cleared from queue by a multi-stop write'
      : c.status === 'cut' ? `cut after ${c.playedMs} ms of ${c.ms}` : 'full' })), filler: 0 };
}
function fmtRun(run) {
  const rows = summarise(run).rows;
  return ['| Cue | Want | Event (s) | Latency (ms) | Fate |', '|---|---|---|---|---|',
    ...rows.map(r => `| ${r.cue} | ${r.want} | ${(r.eventT / 1000).toFixed(2)} | ${r.latency == null ? 'n/a' : r.latency} | ${r.fate} |`)].join('\n');
}
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const { sc, B } of runAll()) console.log(`\n### ${sc.id}: ${sc.title}\n\n${fmtRun(B)}`);
}
