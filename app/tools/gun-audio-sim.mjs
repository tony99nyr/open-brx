// A deterministic model of the BRX gun's ONE audio channel (docs/audio-queue-scenarios.md).
//
// Pure: no DOM, no BLE, no clock. Input = the timed writes the phone sends plus the shield value over time.
// Output = what the gun plays: each clip's start and end, which clips a `$PLAYX` cut off (and how much of them
// was heard), which clips never played by the horizon, the shield hum's spans, and each cue's latency.
//
// Every rule below is a bench measurement of 2026-09-24 (Tactix-FE30, firmware v4.32, laptop MCP, Tony timing
// by ear) or is marked ASSUMPTION / ESTIMATE. An assumption is a lever: a bench answer changes one constant.

export const PLAYX = '$PLAYX,0,*';
/** The slot-4 queued clip frame every announcer line uses (`$PLAY,,4,6,<id>,,,,*`). */
export const play = id => `$PLAY,,4,6,${id},,,,*`;

/** The gun's audio rules. Pass a copy with one field changed to ask "what if the bench says otherwise". */
export const GUN_RULES = Object.freeze({
  /** Rule 1 (MEASURED): `$PLAY` clips play first in, first out. A clip sent while another plays does not cut in;
   *  it starts when the one before it ends. `false` = the old belief (a new clip interrupts), for comparison. */
  fifo: true,
  /** Rule 2 (MEASURED): `$PLAYX,0,*` stops ONLY what is playing now; the next queued clip then starts. N stops sent
   *  about 150 ms apart flush N clips, each leaving a fragment of the time it played. */
  playxStopsCurrentOnly: true,
  /** Rule 3 (MEASURED): while the shield is above 0 and `$PSET` t23 (energyShieldLoop) names a sound, the gun plays
   *  a continuous hum that holds the channel. A clip queued behind it waits indefinitely (60+ s observed). A
   *  `$PLAYX,0` stops the hum; the queued clips then play in order. With shield 0 there is no hum. */
  humBlocksQueue: true,
  /** Rule 3 (MEASURED): the hum RESUMES by itself once the queue drains, while the shield is still above 0. */
  humResumesWhenQueueDrains: true,
  /** ASSUMPTION (not measured): how long the channel stays idle before the hum restarts (after a stop or after the
   *  queue drains). A `$PLAY` that arrives inside this window starts before the hum does. brx4's rule (stops first,
   *  the line last, in one write) needs this to be longer than WRITE_FRAME_GAP_MS; bench question Q1. */
  humRestartMs: 50,
  /** ASSUMPTION: a shield rising above 0 while a clip plays lets that clip (and the queue behind it) finish before
   *  the hum starts. `false` is not modelled; the phone model (brx4's GunAudio) assumes the hum takes over at once,
   *  which only makes the phone over-count, and an extra stop is harmless under `playxOnIdle: 'noop'`. */
  humWaitsForQueue: true,
  /** ASSUMPTION: a `$PLAYX` with nothing playing does nothing (it is not remembered for the next clip). Q3. */
  playxOnIdle: 'noop',
  /** Rule 4 (MEASURED): `$LIFE` regen grants are silent, and `$HLOOP` is an LED loop. Every frame that is not a
   *  `$PLAY` or `$PLAYX` is silent to this model ($SFLASH, $HLED, $SPAWN and friends). */
  silentPrefixes: Object.freeze(['$LIFE', '$HLOOP', '$SFLASH', '$HLED', '$SPAWN', '$PSET', '$SIR']),
  /** ESTIMATE: the spacing between two frames of ONE BLE write as the gun parses them. Stops sent "tightly" are
   *  this far apart, so each clip they flush leaves a fragment about this long. */
  writeFrameGapMs: 10,
  /** ESTIMATE: a fragment shorter than this is not heard as a word. Tonight's 150 ms spacing was audible. */
  audibleFragmentMs: 80,
});

/** Clip lengths (ms), from `mcp/brx_mcp/data/sound_catalog.json` `duration_s` (checked by the test). Every id the
 *  scenarios play. A10 is Callsign's stock t23 shield loop; its length does not matter because it loops. */
export const CLIP_MS = Object.freeze({
  VAA: 636, VA8: 1014, VAI: 1786, VAN: 758,                  // kill line (first take of the pool), spawn lines
  VA7H: 2456, VA7E: 1787, VA7Q: 1904, V124: 1885, VA7K: 1924, VX0U: 1175,   // medals
  VA6D: 1943, VA6E: 2675, V115: 2851,                        // lead taken / lost, next kill wins
  VB0N: 1924, VB0P: 2976, U100: 114, VB8: 1014,              // hill captured / lost, possession tick, "Target down."
  N101: 2571, N102: 2108, VA6Y: 2026, N74: 1940, VA8C: 1497, // shield down / charging / online / heartbeat / up
  VA86: 1984, VAG: 584, VAE: 1250, A10: 14952,               // low health, pain short / long, the hum
});
/** Measured by ear tonight, for the doc (the catalogue agrees): VAA "kill" about 0.6 s, VA6Y about 2 s. */
export const EAR_MS = Object.freeze({ VAA: 600, VA6Y: 2000, N74: 1940 });

/** The clip id of a `$PLAY` frame: token 4 (the queue slot), else token 1 (e.g. `$PLAY,U100,4,6,,,,,*`). ⚠ Whether
 *  the token-1 slot queues like token 4 is not measured; this model treats both the same. */
export function clipId(frame) {
  const t = String(frame).split(',');
  return ((t[4] || '').trim() || (t[1] || '').trim());
}
const isPlay = f => typeof f === 'string' && f.startsWith('$PLAY,');
const isStop = f => typeof f === 'string' && f.startsWith('$PLAYX');

/**
 * Run the gun.
 * @param {object} input
 * @param {Array<{t:number, frames:Array<string|{f:string, cue?:string, eventT?:number, must?:boolean}>, why?:string}>} input.writes
 *        what the phone sent; the frames of one write reach the gun `writeFrameGapMs` apart, in order.
 * @param {Array<[number, number]>} [input.shield] the shield value over time, as steps `[t, value]` (default 0).
 * @param {string|null} [input.humClip] the `$PSET` t23 loop id; null or '' = no hum (Standard, or a host who cleared it).
 * @param {number} input.horizonMs how long to run.
 * @param {object} [rules] GUN_RULES, or a copy with a changed field.
 */
export function simulateGun({ writes, shield = [], humClip = null, horizonMs }, rules = GUN_RULES) {
  const clipMs = id => (CLIP_MS[id] != null ? CLIP_MS[id] : 2500);
  const events = [];
  let n = 0;
  for (const w of writes) {
    w.frames.forEach((fr, i) => {
      const o = typeof fr === 'string' ? { f: fr } : fr;
      events.push({ t: w.t + i * rules.writeFrameGapMs, kind: 'frame', o, why: w.why, n: n++ });
    });
  }
  for (const [t, v] of shield) events.push({ t, kind: 'shield', v, n: n++ });
  // A shield change sorts before a frame at the same instant: the `$HP` echo that moved it came first.
  events.sort((a, b) => a.t - b.t || (a.kind === b.kind ? a.n - b.n : a.kind === 'shield' ? -1 : 1));

  const clips = [];    // every $PLAY, in arrival order
  const stops = [];    // every $PLAYX: what it hit
  const hum = [];      // [{start, end}]
  const queue = [];
  let cur = null;      // {type:'clip', c} | {type:'hum', start}
  let humAt = null;    // the channel went idle with the shield up: the hum starts at this time
  let sv = 0;
  const humWanted = () => rules.humBlocksQueue && !!humClip && sv > 0;

  const startClip = (c, t) => { c.start = t; c.end = t + c.ms; cur = { type: 'clip', c }; humAt = null; };
  const idle = t => {   // the channel just went idle at t
    cur = null;
    if (queue.length) { startClip(queue.shift(), t); return; }
    humAt = humWanted() && rules.humResumesWhenQueueDrains ? t + rules.humRestartMs : null;
  };
  const endHum = t => { hum[hum.length - 1].end = t; };
  const advance = to => {
    for (;;) {
      if (cur && cur.type === 'clip' && cur.c.end <= to) { cur.c.status = 'full'; cur.c.playedMs = cur.c.ms; idle(cur.c.end); continue; }
      if (!cur && humAt != null && humAt <= to) { cur = { type: 'hum', start: humAt }; hum.push({ start: humAt, end: null }); humAt = null; continue; }
      return;
    }
  };

  for (const e of events) {
    if (e.t > horizonMs) break;
    advance(e.t);
    if (e.kind === 'shield') {
      const was = sv; sv = e.v;
      if (sv === 0 && was > 0) {   // the hum stops with the shield; queued clips play at once
        humAt = null;
        if (cur && cur.type === 'hum') { endHum(e.t); idle(e.t); }
      } else if (sv > 0 && was === 0 && !cur && humWanted()) humAt = e.t;   // idle channel: the hum starts now
      continue;
    }
    const f = e.o.f;
    if (isStop(f)) {
      const hit = cur ? (cur.type === 'hum' ? 'hum' : cur.c) : null;
      stops.push({ t: e.t, hit: hit === 'hum' ? 'hum' : hit ? hit.id : null, why: e.why });
      if (!cur) continue;   // playxOnIdle 'noop'
      if (cur.type === 'hum') { endHum(e.t); idle(e.t); continue; }
      const c = cur.c; c.status = 'cut'; c.playedMs = e.t - c.start; c.end = e.t; c.cutBy = e.why || '$PLAYX';
      if (rules.playxStopsCurrentOnly) idle(e.t);
      else { for (const q of queue.splice(0)) { q.status = 'flushed'; q.playedMs = 0; } idle(e.t); }
      continue;
    }
    if (!isPlay(f)) continue;   // rule 4: silent frames
    const id = clipId(f);
    const c = { id, ms: clipMs(id), sentAt: e.t, cue: e.o.cue || id, eventT: e.o.eventT != null ? e.o.eventT : e.t,
      must: !!e.o.must, why: e.why, start: null, end: null, status: 'never', playedMs: 0 };
    clips.push(c);
    if (!cur) startClip(c, e.t);
    else if (cur.type === 'clip' && !rules.fifo) {   // the old belief: a new clip interrupts
      const p = cur.c; p.status = 'cut'; p.playedMs = e.t - p.start; p.end = e.t; p.cutBy = 'a newer $PLAY'; startClip(c, e.t);
    } else queue.push(c);
  }
  advance(horizonMs);
  if (cur && cur.type === 'clip') { cur.c.status = 'full'; cur.c.playedMs = cur.c.ms; }   // it finishes past the horizon; nothing is left to cut it
  if (hum.length && hum[hum.length - 1].end == null) hum[hum.length - 1].end = horizonMs;
  for (const c of clips) {
    c.latency = c.start == null ? null : c.start - c.eventT;
    c.fragment = c.status === 'cut' && c.playedMs >= rules.audibleFragmentMs;   // an audible piece of a cut clip
  }
  return { clips, stops, hum, horizonMs };
}
