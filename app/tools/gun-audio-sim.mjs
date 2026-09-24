// A deterministic model of the BRX gun's audio channel (docs/audio-queue-scenarios.md).
//
// Pure: no DOM, no BLE, no clock. Input = the timed writes the phone sends plus the shield value over time.
// Output = what the gun plays: each clip's start and end, which clips a `$PLAYX` or a token-1 clip cut off (and how
// much of them was heard), which clips never played by the horizon, the shield hum's spans, and each cue's latency.
//
// Every rule below is either a bench measurement (the date and gun are named) or marked ASSUMPTION / ESTIMATE. An
// assumption is a lever: a bench answer changes one constant, and `docs/audio-queue-scenarios.md` (Bench plan) names
// the step that settles each one.

export const PLAYX = '$PLAYX,0,*';
/** The slot-4 queued clip frame every announcer line uses (`$PLAY,,4,6,<id>,,,,*`). */
export const play = id => `$PLAY,,4,6,${id},,,,*`;
/** A slot-1 (interrupt) clip frame, e.g. the hill possession tick `$PLAY,U100,4,6,,,,,*`. */
export const playNow = id => `$PLAY,${id},4,6,,,,,*`;

/** The gun's audio rules. Pass a copy with one field changed to ask "what if the bench says otherwise". */
export const GUN_RULES = Object.freeze({
  /** MEASURED 2026-09-24 (Tactix-FE30, v4.32): `$PLAY` token-4 clips play first in, first out. A clip sent while
   *  another plays does not cut in; it starts when the one before it ends. `false` = the old belief, for comparison. */
  fifo: true,
  /** MEASURED 2026-09-11 (Tactix-3D4F, six trials, experiment log "$PLAY has an INTERRUPT slot and a QUEUE slot"):
   *  a token-1 clip (`$PLAY,<id>,4,6,,,,,*`) cuts whatever clip plays and starts at once; token-4 clips sent after it
   *  wait behind it; a frame with both slots plays token 1, then queues token 4. `false` = treat token 1 as FIFO. */
  interruptSlot: true,
  /** ASSUMPTION: what a token-1 clip does to the shield hum. 'mix' = it plays over the hum, which carries on (the only
   *  hint: 2026-09-07, A10 was heard "under every shield-band hit"); 'cut' = it stops the hum like a `$PLAYX`;
   *  'queue' = it waits behind the hum like a token-4 clip. */
  interruptOverHum: 'mix',
  /** MEASURED 2026-09-24: `$PLAYX,0,*` stops ONLY what is playing now; the next queued clip then starts. N stops sent
   *  150 ms apart flush N clips, each leaving a fragment of the time it played. */
  playxStopsCurrentOnly: true,
  /** ASSUMPTION: a `$PLAYX` with nothing playing. 'noop' = forgotten; 'stopsNext' = remembered, and the next clip to
   *  start is cut at once. Bench step 3 (a tight burst) settles it. */
  playxOnIdle: 'noop',
  /** MEASURED 2026-09-24: while the shield is above 0 and `$PSET` t23 names a sound, the gun plays that sound (the hum)
   *  and a queued clip waits behind it: 9 s late in one trial, not played in 60+ s in another. Shield 0 = no hum. A
   *  `$PLAYX,0` stops the hum and the queue then plays in order. `false` = no hum at all, for comparison. */
  humBlocksQueue: true,
  /** ASSUMPTION: the hum is the t23 CLIP (A10 is 14.952 s, "sustained / loop-like") replayed while the shield is up.
   *  When does a queued clip get the channel at the end of one play?
   *    'everyLoopEnd'  at every loop end: a clip waits at most one play. Fits the 9 s trial and the field's "10-15 s
   *                    late" lines; does NOT fit the 60+ s trial.
   *    'never'         the hum re-plays ahead of the queue: a clip waits until a stop or shield 0. Fits the 60+ s
   *                    trial; does NOT fit the 9 s trial.
   *    'firstLoopEnd'  only at the end of the FIRST play after the hum (re)starts; later plays loop without a break.
   *                    The one variant that fits both trials, IF the 9 s trial's line was sent during the first play
   *                    and the 60+ s trial's line was not. Tonight's notes do not record that timing.
   *  Bench step 2 separates the three. */
  humYield: 'firstLoopEnd',
  /** ASSUMPTION: the length of one hum play. null = the t23 id's catalogue length (CLIP_MS; A10 = 14952 ms). */
  humClipMs: null,
  /** MEASURED 2026-09-24: after a `$PLAYX,0` stopped it and the queue drained, the hum RESUMED by itself with the
   *  shield still up. `false` = it stays off until the shield next rises from 0. */
  humResumesWhenQueueDrains: true,
  /** ASSUMPTION: the delay from the shield rising above 0 (an idle channel) to the hum starting. A clip that arrives
   *  inside it plays before the hum. This decides whether a spawn line written right behind the F348 spawn fill
   *  (`$LIFE,0,0,<max>,*` in the same write, 20 ms ahead of the line) is heard. Bench step 4. */
  humStartMs: 0,
  /** ASSUMPTION: the idle gap before the hum restarts after a stop, a yield or the queue draining. A `$PLAY` that
   *  arrives inside the gap starts before the hum does. brx4's rule (the stops first, the line last, in one write)
   *  needs this to be longer than writeFrameGapMs. Bench step 1. */
  humRestartMs: 50,
  /** ASSUMPTION: a shield rising above 0 while a clip plays. true = the clip (and the queue behind it) finishes before
   *  the hum starts; false = the hum takes the channel at once and cuts the clip. */
  humWaitsForQueue: true,
  /** Frames that make no sound. MEASURED 2026-09-24: `$LIFE` grants (x11, silent) and `$HLOOP` (LED only).
   *  ASSUMPTION (not measured tonight): `$SFLASH`, `$HLED`, `$SPAWN` (the `$PSET` cry field ships empty, A15.2),
   *  `$PSET` (a rewrite in play keeps the hum, 2026-09-11), `$SIR`, and the rest of the spawn write (`$TMP`, `$TID`,
   *  `$AMMO`, `$BMAP`). Any other frame is reported in `unknown`. */
  silentPrefixes: Object.freeze(['$LIFE', '$HLOOP', '$SFLASH', '$HLED', '$SPAWN', '$PSET', '$SIR', '$TMP', '$TID', '$AMMO', '$BMAP']),
  /** ESTIMATE: the spacing between two frames of ONE BLE write as the gun parses them. Stops sent "tightly" are this
   *  far apart, so each clip they flush leaves a fragment about this long. */
  writeFrameGapMs: 10,
  /** ESTIMATE: a fragment shorter than this is not heard as a word. 2026-09-24's 150 ms spacing was audible. */
  audibleFragmentMs: 80,
});

/** Clip lengths (ms), from `mcp/brx_mcp/data/sound_catalog.json` `duration_s` (checked by the test). Every id the
 *  scenarios play, plus the t23 candidates: A10 (Callsign's shield loop) and the near-silent N1A, N89, N87. */
export const CLIP_MS = Object.freeze({
  VAA: 636, VA8: 1014, VAI: 1786, VAN: 758,                  // kill line (first take of the pool), spawn lines
  VA7H: 2456, VA7E: 1787, VA7Q: 1904, V124: 1885, VA7K: 1924, VX0U: 1175,   // medals
  VA6D: 1943, VA6E: 2675, V115: 2851,                        // lead taken / lost, next kill wins
  VB0N: 1924, VB0P: 2976, U100: 114, VB8: 1014,              // hill captured / lost, possession tick, "Target down."
  N101: 2571, N102: 2108, VA6Y: 2026, N74: 1940, VA8C: 1497, // shield down / charging / online / heartbeat / up
  VA86: 1984, VAG: 584, VAE: 1250,                           // low health, pain short / long
  A10: 14952, N1A: 44, N89: 45, N87: 48,                     // t23 candidates: the hum, and three near-silent ids
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
 * @param {Array<[number, number]>} [input.shield] the shield value over time, as steps `[t, value]` (default 0).
 * @param {string|null} [input.humClip] the `$PSET` t23 id; null or '' = no hum (Standard, or t23 left EMPTY).
 * @param {number} input.horizonMs how long to run.
 * @param {object} [rules] GUN_RULES, or a copy with a changed field.
 */
export function simulateGun({ writes, shield = [], humClip = null, horizonMs }, rules = GUN_RULES) {
  const clipMs = id => (CLIP_MS[id] != null ? CLIP_MS[id] : 2500);
  const humMs = rules.humClipMs != null ? rules.humClipMs : humClip ? clipMs(humClip) : Infinity;
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

  const clips = [];    // every clip, in arrival order
  const stops = [];    // every $PLAYX: what it hit
  const hum = [];      // [{start, end, plays}]
  const unknown = [];  // frames this model does not know to be silent
  const queue = [];
  let cur = null;      // {type:'clip', c} | {type:'hum', start, loopStart, first}
  let humAt = null;    // the channel is idle with the shield up: the hum starts at this time
  let pendingStops = 0;   // playxOnIdle 'stopsNext'
  let sv = 0;
  const humWanted = () => rules.humBlocksQueue && !!humClip && sv > 0;
  const mayYield = h => rules.humYield === 'everyLoopEnd' || (rules.humYield === 'firstLoopEnd' && h.first);

  const cut = (c, t, by) => { c.status = 'cut'; c.playedMs = t - c.start; c.end = t; c.cutBy = by; };
  const startClip = (c, t) => {
    c.start = t; c.end = t + c.ms; cur = { type: 'clip', c }; humAt = null;
    if (pendingStops > 0) { pendingStops--; cut(c, t, 'a $PLAYX remembered from an idle channel'); idle(t); }
  };
  const idle = t => {   // the channel just went idle at t
    cur = null;
    if (queue.length) { startClip(queue.shift(), t); return; }
    humAt = humWanted() && rules.humResumesWhenQueueDrains ? t + rules.humRestartMs : null;
  };
  const startHum = t => { cur = { type: 'hum', start: t, loopStart: t, first: true }; hum.push({ start: t, end: null }); humAt = null; };
  const endHum = t => { hum[hum.length - 1].end = t; };
  const advance = to => {
    for (;;) {
      if (cur && cur.type === 'clip' && cur.c.end <= to) { cur.c.status = 'full'; cur.c.playedMs = cur.c.ms; idle(cur.c.end); continue; }
      if (cur && cur.type === 'hum' && cur.loopStart + humMs <= to) {
        const boundary = cur.loopStart + humMs;
        if (queue.length && mayYield(cur)) { endHum(boundary); idle(boundary); continue; }
        // no yield: skip every whole play that ends by `to` (the queue cannot change inside this call)
        const k = Math.floor((to - cur.loopStart) / humMs);
        cur.loopStart += k * humMs; cur.first = false;
        return;
      }
      if (!cur && humAt != null && humAt <= to) { startHum(humAt); continue; }
      return;
    }
  };
  const newClip = (id, e, slot) => {
    const c = { id, slot, ms: clipMs(id), sentAt: e.t, cue: e.o.cue || id, eventT: e.o.eventT != null ? e.o.eventT : e.t,
      must: !!e.o.must, why: e.why, start: null, end: null, status: 'never', playedMs: 0 };
    clips.push(c);
    return c;
  };

  for (const e of events) {
    if (e.t > horizonMs) break;
    advance(e.t);
    if (e.kind === 'shield') {
      const was = sv; sv = e.v;
      if (sv === 0 && was > 0) {   // the hum stops with the shield; queued clips play at once
        humAt = null;
        if (cur && cur.type === 'hum') { endHum(e.t); idle(e.t); }
      } else if (sv > 0 && was === 0 && humWanted()) {
        if (!cur) humAt = e.t + rules.humStartMs;
        else if (!rules.humWaitsForQueue && cur.type === 'clip') { cut(cur.c, e.t, 'the shield hum'); startHum(e.t); }
      }
      continue;
    }
    const f = e.o.f;
    if (isStop(f)) {
      const hit = cur ? (cur.type === 'hum' ? 'hum' : cur.c.id) : null;
      stops.push({ t: e.t, hit, why: e.why });
      if (!cur) { if (rules.playxOnIdle === 'stopsNext') pendingStops++; continue; }
      if (cur.type === 'hum') { endHum(e.t); idle(e.t); continue; }
      cut(cur.c, e.t, e.why || '$PLAYX');
      if (!rules.playxStopsCurrentOnly) for (const q of queue.splice(0)) { q.status = 'flushed'; q.playedMs = 0; }
      idle(e.t);
      continue;
    }
    if (!isPlay(f)) {
      if (!rules.silentPrefixes.some(p => f.startsWith(p + ',') || f === p)) unknown.push({ t: e.t, f });
      continue;
    }
    const { slot1, slot4 } = clipSlots(f);
    if (slot1 && rules.interruptSlot) {   // the interrupt slot: measured to cut a clip, assumed against the hum
      const c = newClip(slot1, e, 1);
      if (cur && cur.type === 'hum' && rules.interruptOverHum === 'mix') { c.start = e.t; c.end = e.t + c.ms; c.status = 'full'; c.playedMs = c.ms; c.mixed = true; }
      else if (cur && cur.type === 'hum' && rules.interruptOverHum === 'queue') queue.push(c);
      else {
        if (cur && cur.type === 'hum') endHum(e.t);
        else if (cur) cut(cur.c, e.t, `the token-1 clip ${slot1}`);
        startClip(c, e.t);
      }
    } else if (slot1) queue.length || cur ? queue.push(newClip(slot1, e, 1)) : startClip(newClip(slot1, e, 1), e.t);
    if (!slot4) continue;
    const c = newClip(slot4, e, 4);
    if (!cur) startClip(c, e.t);
    else if (cur.type === 'clip' && !rules.fifo) { cut(cur.c, e.t, 'a newer $PLAY'); startClip(c, e.t); }   // the old belief
    else queue.push(c);
  }
  advance(horizonMs);
  if (cur && cur.type === 'clip') { cur.c.status = 'full'; cur.c.playedMs = cur.c.ms; }   // it finishes past the horizon; nothing is left to cut it
  if (hum.length && hum[hum.length - 1].end == null) hum[hum.length - 1].end = horizonMs;
  for (const c of clips) {
    c.latency = c.start == null ? null : c.start - c.eventT;
    c.fragment = c.status === 'cut' && c.playedMs >= rules.audibleFragmentMs;   // an audible piece of a cut clip
  }
  return { clips, stops, hum, unknown, horizonMs };
}
