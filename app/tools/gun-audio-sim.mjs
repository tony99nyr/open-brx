// A deterministic model of the BRX gun's audio channel (docs/audio-queue-scenarios.md).
//
// Pure: no DOM, no BLE, no clock. Input = the timed writes the phone sends plus the shield value over time.
// Output = each clip's start and end, which clips a `$PLAYX` or token-1 clip cuts, and each cue's latency.
//
// Every rule below is either a bench measurement (the date and gun are named) or marked ASSUMPTION / ESTIMATE. An
// assumption is a lever: a bench answer changes one constant, and `docs/audio-queue-scenarios.md` (Bench plan) names
// the step that settles each one.

export const PLAYX = '$PLAYX,0,*';
/** The slot-4 queued clip frame every announcer line uses (`$PLAY,,4,6,<id>,,,,*`). */
export const play = id => `$PLAY,,4,6,${id},,,,*`;
/** A slot-1 (interrupt) clip frame, e.g. the hill possession tick `$PLAY,U100,4,6,,,,,*`. */
export const playNow = id => `$PLAY,${id},4,6,,,,,*`;

/** The measured gun rules. Every open rule carries its evidence label. */
export const GUN_RULES = Object.freeze({
  /** MEASURED 2026-09-24: token-4 clips play first in, first out. */
  fifo: true,
  /** MEASURED 2026-09-11: token-1 clips interrupt the current clip. */
  interruptSlot: true,
  /** MEASURED 2026-09-24: one stop ends only the current clip. */
  playxStopsCurrentOnly: true,
  /** ASSUMPTION: when a zero-gap burst drops a clip, the second clip drops. */
  burstDropPosition: 2,
  /** UNPROVEN: the phone uses this gap after a zero-gap burst dropped a clip. */
  playGapMs: 150,
  /** ASSUMPTION: only a literal zero-gap burst reaches the drop case; a 100 ms send_batch gap did not. */
  burstDropGapMs: 10,
  /** MEASURED 2026-09-25: two or more stops in one write can clear the entire queue. */
  multiStopClearsQueue: true,
  /** ASSUMPTION: a stop on an idle channel does nothing. */
  playxOnIdle: 'noop',
  /** ASSUMPTION: clips shorter than this leave no audible fragment. */
  audibleFragmentMs: 80,
  /** ESTIMATE: frames in one write reach the gun 10 ms apart. */
  writeFrameGapMs: 10,
  silentPrefixes: Object.freeze(['$LIFE', '$HLOOP', '$SFLASH', '$HLED', '$SPAWN', '$PSET', '$SIR', '$TMP', '$TID', '$AMMO', '$BMAP']),
});

/** Clip lengths (ms), from `mcp/brx_mcp/data/sound_catalog.json` `duration_s` (checked by the test). Every id the
 *  scenarios play. */
export const CLIP_MS = Object.freeze({
  VAA: 636, VA8: 1014, VAI: 1786, VAN: 758,                  // kill line (first take of the pool), spawn lines
  VA7H: 2456, VA7E: 1787, VA7Q: 1904, V124: 1885, VA7K: 1924, VX0U: 1175,   // medals
  VA6D: 1943, VA6E: 2675, V115: 2851,                        // lead taken / lost, next kill wins
  VB0N: 1924, VB0P: 2976, U100: 114, VB8: 1014,              // hill captured / lost, possession tick, "Target down."
  N101: 2571, N102: 2108, VA6Y: 2026, N74: 1940, VA8C: 1497, // shield down / charging / online / heartbeat / up
  VA86: 1984, VAG: 584, VAE: 1250,                           // low health, pain short / long
  VA3: 1271,                                                 // the native death scream ($PSET t10 in the golden take)
});
/** Timed by ear on 2026-09-24, for the doc: VAA "kill" about 0.6 s, VA6Y about 2 s. The catalogue agrees. */
export const EAR_MS = Object.freeze({ VAA: 600, VA6Y: 2000 });

/** The clip ids of a `$PLAY` frame: `slot1` = token 1 (the interrupt slot), `slot4` = token 4 (the queue). */
export function clipSlots(frame) {
  const t = String(frame).split(',');
  return { slot1: (t[1] || '').trim(), slot4: (t[4] || '').trim() };
}
/** The clip id of a `$PLAY` frame: token 4, else token 1. */
export function clipId(frame) { const s = clipSlots(frame); return s.slot4 || s.slot1; }
const isPlay = f => typeof f === 'string' && f.startsWith('$PLAY,');
const isStop = f => typeof f === 'string' && f.startsWith('$PLAYX');

/**
 * Run the gun.
 * @param {object} input
 * @param {Array<{t:number, frames:Array<string|{f:string, cue?:string, eventT?:number, must?:boolean}>, why?:string}>} input.writes
 *        what the phone sent; the frames of one write reach the gun `writeFrameGapMs` apart, in order.
 * @param {Array<{t:number, id:string, cue?:string}>} [input.natives] the gun's OWN sounds that enter the same FIFO (the
 *        native death scream, `$PSET` t10, on the `$HP,0` that kills). ASSUMPTION: the scream queues like a token-4
 *        clip, behind whatever plays (docs/announcer.md models it the same way; unmeasured).
 * @param {number} input.horizonMs how long to run.
 * @param {object} [rules] GUN_RULES, or a copy with a changed field.
 */
export function simulateGun({ writes, natives = [], horizonMs }, rules = GUN_RULES) {
  const clipMs = id => CLIP_MS[id] ?? 2500;
  const events = [];
  let n = 0;
  for (const [wi, w] of writes.entries()) w.frames.forEach((fr, i) => {
    const o = typeof fr === 'string' ? { f: fr } : fr;
    events.push({ t: w.t + i * rules.writeFrameGapMs, kind: 'frame', o, why: w.why, wi, n: n++ });
  });
  for (const x of natives) events.push({ t: x.t, kind: 'native', o: { f: play(x.id), cue: x.cue || x.id }, why: 'the gun own sound', n: n++ });
  events.sort((a, b) => a.t - b.t || (a.kind === b.kind ? a.n - b.n : (a.kind === 'native' ? -1 : 1)));
  const clips = [], stops = [], unknown = [], queue = [];
  let cur = null, previousPlay = null, burstWrite = null, burstPos = 0;
  const cut = (c, t, by) => { c.status = 'cut'; c.playedMs = Math.max(0, t - c.start); c.end = t; c.cutBy = by; };
  const idle = t => { cur = null; if (queue.length) { const c = queue.shift(); c.start = t; c.end = t + c.ms; cur = c; } };
  const advance = t => { while (cur && cur.end <= t) { const end = cur.end; cur.status = 'full'; cur.playedMs = cur.ms; idle(end); } };
  const make = (id, e, slot) => {
    const c = { id, slot, ms: clipMs(id), sentAt: e.t, cue: e.o.cue || id, eventT: e.o.eventT ?? e.t,
      must: !!e.o.must, native: e.kind === 'native', why: e.why, start: null, end: null, status: 'never', playedMs: 0 };
    clips.push(c); return c;
  };
  const start = (c, t) => { c.start = t; c.end = t + c.ms; cur = c; };
  const stopCounts = writes.map(w => w.frames.filter(f => typeof f === 'string' && isStop(f)).length);
  const stopHandled = new Set();
  for (const e of events) {
    if (e.t > horizonMs) break;
    advance(e.t);
    if (e.kind === 'native') {
      const c = make(clipId(e.o.f), e, 4); if (!cur) start(c, e.t); else queue.push(c);
      continue;
    }
    const f = e.o.f;
    if (isStop(f)) {
      stops.push({ t: e.t, hit: cur?.id || null, why: e.why });
      if (stopCounts[e.wi] >= 2 && rules.multiStopClearsQueue) {
        if (!stopHandled.has(e.wi)) {
          stopHandled.add(e.wi);
          if (cur) { cut(cur, e.t, 'multiple $PLAYX in one write'); cur = null; }
          for (const q of queue.splice(0)) { q.status = 'flushed'; q.playedMs = 0; }
        }
      } else if (cur) { cut(cur, e.t, e.why || '$PLAYX'); idle(e.t); }
      continue;
    }
    if (!isPlay(f)) {
      if (!rules.silentPrefixes.some(p => f.startsWith(p + ',') || f === p)) unknown.push({ t: e.t, f });
      continue;
    }
    const gap = previousPlay == null ? Infinity : e.t - previousPlay;
    if (e.kind === 'frame' && gap < rules.burstDropGapMs) {
      burstPos = burstWrite === e.wi ? burstPos + 1 : 2; burstWrite = e.wi;
      if (burstPos === rules.burstDropPosition) {
        const dropped = make(clipId(f), e, clipSlots(f).slot4 ? 4 : 1);
        dropped.status = 'dropped'; dropped.dropReason = 'burst drop position is an assumption'; continue;
      }
    } else { burstWrite = e.wi; burstPos = 1; }
    previousPlay = e.t;
    const { slot1, slot4 } = clipSlots(f);
    if (slot1 && rules.interruptSlot) {
      const c = make(slot1, e, 1); if (cur) cut(cur, e.t, `the token-1 clip ${slot1}`); start(c, e.t);
    } else if (slot1) { const c = make(slot1, e, 1); if (!cur) start(c, e.t); else queue.push(c); }
    if (slot4) { const c = make(slot4, e, 4); if (!cur) start(c, e.t); else queue.push(c); }
  }
  advance(horizonMs);
  if (cur) { cur.status = 'full'; cur.playedMs = cur.ms; }
  for (const c of clips) { c.latency = c.start == null ? null : c.start - c.eventT; c.fragment = c.status === 'cut' && c.playedMs >= rules.audibleFragmentMs; }
  return { clips, stops, unknown, horizonMs };
}
