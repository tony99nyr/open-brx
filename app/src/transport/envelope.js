// Node↔MC envelope helpers — mirrors mcp/brx_mcp/mc/envelope.py + types.py (contracts.md §5/§9, A6).
// Dependency-free ESM; runs in the Capacitor WebView and in Node ≥ 22.
//
// The constants and the four wire tables (PERSISTED_EVENT_TYPES/NODE_KINDS/MC_KINDS/CONTROL_CMDS
// kind vocabularies, REQUIRED/EVENT_REQUIRED/ACCEPT_MIN required-field tables) are GENERATED from
// the Python source of truth (mcp/brx_mcp/mc/types.py + envelope.py) by
// `python3 mcp/tools/gen_contract.py` — see contract.gen.js. Every name this file exported before
// that split is re-exported here unchanged, so logsync.js/clock.js/utility.js/transport.js/
// engine.js and the tests keep importing from envelope.js with no change on their end.
export {
  PROTOCOL_V, STATUS_HEARTBEAT_MS, STALE_AFTER_MS, SYNC_FRESH_MS, FEEDBACK_MAX_AGE_MS,
  LATE_ARM_GRACE_MS, DEATH_LATCH_MS, RESYNC_PROBE_S, MAX_PLAYERS, MAX_ENVELOPE_BYTES,
  MAX_LOG_CHUNK_BYTES, CONFIG_TTL_MS,
  PERSISTED_EVENT_TYPES, NODE_KINDS, MC_KINDS, CONTROL_CMDS,
} from './contract.gen.js';

import {
  PROTOCOL_V, MAX_ENVELOPE_BYTES, MAX_LOG_CHUNK_BYTES, MAX_PLAYERS,
  PERSISTED_EVENT_TYPES, NODE_KINDS, MC_KINDS, CONTROL_CMDS,
  REQUIRED, EVENT_REQUIRED, ACCEPT_MIN,
} from './contract.gen.js';

const T_MIN_MS = 1_500_000_000_000, T_MAX_MS = 4_000_000_000_000;

export class EnvelopeError extends Error {
  constructor(reason, detail = '') { super(detail ? `${reason}: ${detail}` : reason); this.reason = reason; this.detail = detail; }
}

export function uid(n = 12) {
  const a = new Uint8Array(Math.ceil(n / 2));
  (globalThis.crypto?.getRandomValues ? globalThis.crypto.getRandomValues(a) : a.map(() => Math.random() * 256));
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('').slice(0, n);
}

export function makeEnvelope(kind, body, { seq, t, id } = {}) {
  const env = { v: PROTOCOL_V, kind, id: id || uid(), t: t == null ? Date.now() : Math.trunc(t), body };
  if (seq != null) env.seq = Math.trunc(seq);
  return env;
}

export function encode(env) {
  const text = JSON.stringify(env);
  if (byteLength(text) > MAX_ENVELOPE_BYTES) throw new EnvelopeError('oversize', `${byteLength(text)} bytes > ${MAX_ENVELOPE_BYTES}`);
  return text;
}

export function byteLength(text) {
  return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : Buffer.byteLength(text, 'utf8');
}

const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const isNum = x => typeof x === 'number' && Number.isFinite(x);

export function validateEvent(ev) {
  if (!isObj(ev)) throw new EnvelopeError('bad_event', 'event body is not an object');
  if (!PERSISTED_EVENT_TYPES.has(ev.type)) throw new EnvelopeError('bad_event', `type ${ev.type} is not a persisted fact`);
  for (const k of ['t', 'node_id', 'player_id']) if (!(k in ev)) throw new EnvelopeError('bad_event', `missing ${k}`);
  if (!('match_id' in ev)) throw new EnvelopeError('bad_event', 'missing match_id');
  for (const k of EVENT_REQUIRED[ev.type]) if (!(k in ev)) throw new EnvelopeError('bad_event', `${ev.type} missing ${k}`);
  if (!isNum(ev.t)) throw new EnvelopeError('bad_event', 't is not a number');
  if (ev.type === 'hit_taken' || ev.type === 'death') {
    const n = ev.shooter_num;
    if (!Number.isInteger(n) || n < 0 || n > MAX_PLAYERS) throw new EnvelopeError('bad_event', `shooter_num ${n} out of 0..${MAX_PLAYERS}`);
  }
  return ev;
}

/** direction = 'node' (node→MC, MC receiving) always checks the full REQUIRED[kind] — MC is the
 *  strict side. direction = 'mc' (MC→node, a node receiving) checks ACCEPT_MIN[kind] ?? REQUIRED[kind]:
 *  for the handful of kinds ACCEPT_MIN lists (currently just `result`, A24) the node accepts a body
 *  missing everything but those minimal fields, so a result short a field still reaches the engine
 *  instead of being dropped silently as `missing_field`. Mirrors envelope.py's validate() exactly. */
export function validate(env, direction = 'node') {
  if (!isObj(env)) throw new EnvelopeError('not_object');
  if (env.v !== PROTOCOL_V) throw new EnvelopeError('version', `v=${env.v}, expected ${PROTOCOL_V}`);
  const allowed = direction === 'node' ? NODE_KINDS : MC_KINDS;
  if (!allowed.has(env.kind)) throw new EnvelopeError('unknown_kind', String(env.kind));
  if (typeof env.id !== 'string' || !env.id) throw new EnvelopeError('missing_field', 'id');
  if (!isNum(env.t) || env.t < T_MIN_MS || env.t > T_MAX_MS) throw new EnvelopeError('bad_t', String(env.t));
  if (!isObj(env.body)) throw new EnvelopeError('missing_field', 'body');
  const required = direction === 'mc' ? (ACCEPT_MIN[env.kind] ?? REQUIRED[env.kind]) : REQUIRED[env.kind];
  for (const k of required) if (!(k in env.body)) throw new EnvelopeError('missing_field', `${env.kind}.${k}`);
  const b = env.body;
  if (env.kind === 'event') {
    if (!Number.isInteger(env.seq)) throw new EnvelopeError('missing_field', 'event.seq (envelope)');
    validateEvent(b);
  } else if (env.kind === 'event_batch') {
    if (!Array.isArray(b.events)) throw new EnvelopeError('bad_event', 'events is not a list');
    for (const it of b.events) { if (!isObj(it) || !Number.isInteger(it.seq)) throw new EnvelopeError('bad_event', 'batch item missing seq'); validateEvent(it); }
  } else if (env.kind === 'status') {
    if ('seq' in env) throw new EnvelopeError('bad_event', 'status must not carry seq');
  } else if (env.kind === 'apply') {
    if (!Array.isArray(b.frames) || !b.frames.every(f => typeof f === 'string')) throw new EnvelopeError('missing_field', 'apply.frames');
  } else if (env.kind === 'log_data') {
    if (typeof b.chunk !== 'string' || byteLength(b.chunk) > MAX_LOG_CHUNK_BYTES) throw new EnvelopeError('oversize', 'log_data chunk > 48 KB');
  } else if (env.kind === 'control') {
    if (!CONTROL_CMDS.has(b.cmd)) throw new EnvelopeError('missing_field', `control.cmd ${b.cmd}`);
  }
  return env;
}

export function decode(text, direction = 'node') {
  if (byteLength(text) > MAX_ENVELOPE_BYTES) throw new EnvelopeError('oversize');
  let env;
  try { env = JSON.parse(text); } catch (e) { throw new EnvelopeError('not_object', `json: ${e.message}`); }
  return validate(env, direction);
}
