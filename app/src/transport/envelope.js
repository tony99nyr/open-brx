// Node↔MC envelope helpers (contracts.md §5/§9, A6). Dependency-free ESM; runs in the Capacitor
// WebView and in Node ≥ 22.
//
// The constants and the four wire tables (PERSISTED_EVENT_TYPES/NODE_KINDS/MC_KINDS/CONTROL_CMDS
// kind vocabularies, REQUIRED/EVENT_REQUIRED/ACCEPT_MIN required-field tables) come from
// contract.gen.js, GENERATED from the Python source of truth (mcp/brx_mcp/mc/types.py +
// envelope.py) by `python3 mcp/tools/gen_contract.py`. Only the validation logic below mirrors
// mcp/brx_mcp/mc/envelope.py by hand. Every name this file exported before the generator split is
// re-exported here unchanged, so logsync.js/clock.js/utility.js/transport.js/engine.js and the
// tests keep importing from envelope.js with no change on their end.
export {
  PROTOCOL_V, STATUS_HEARTBEAT_MS, STALE_AFTER_MS, SYNC_FRESH_MS, FEEDBACK_MAX_AGE_MS,
  LATE_ARM_GRACE_MS, DEATH_LATCH_MS, RESYNC_PROBE_S, MAX_PLAYERS, MAX_ENVELOPE_BYTES,
  MAX_LOG_CHUNK_BYTES, CONFIG_TTL_MS, T_MIN_MS, T_MAX_MS,
  PERSISTED_EVENT_TYPES, NODE_KINDS, MC_KINDS, CONTROL_CMDS, NODE_DENIED_COMMANDS,
} from './contract.gen.js';

import {
  PROTOCOL_V, MAX_ENVELOPE_BYTES, MAX_LOG_CHUNK_BYTES, MAX_PLAYERS, T_MIN_MS, T_MAX_MS,
  PERSISTED_EVENT_TYPES, NODE_KINDS, MC_KINDS, CONTROL_CMDS,
  REQUIRED, EVENT_REQUIRED, ACCEPT_MIN,
} from './contract.gen.js';

/** @typedef {Record<string, unknown>} EnvelopeBody */
/** @typedef {{v:number, kind:string, id:string, t:number, body:EnvelopeBody, seq?:number}} Envelope */
/** @typedef {{seq?:number, t?:number, id?:string}} EnvelopeOptions */
/** @typedef {EnvelopeBody & {type?:string, t?:number, node_id?:string, player_id?:string|null, match_id?:string|null}} EventBody */
/** @typedef {'node'|'mc'} EnvelopeDirection */

// The generated JavaScript intentionally exposes Set instances while the generated declaration
// exposes the corresponding literal lists. Keep the runtime checks typed as sets at this boundary.
const eventTypes = /** @type {Set<string>} */ (/** @type {unknown} */ (PERSISTED_EVENT_TYPES));
const nodeKinds = /** @type {Set<string>} */ (/** @type {unknown} */ (NODE_KINDS));
const mcKinds = /** @type {Set<string>} */ (/** @type {unknown} */ (MC_KINDS));
const controlCommands = /** @type {Set<string>} */ (/** @type {unknown} */ (CONTROL_CMDS));
const requiredFields = /** @type {Record<string, readonly string[]>} */ (/** @type {unknown} */ (REQUIRED));
const eventRequiredFields = /** @type {Record<string, readonly string[]>} */ (/** @type {unknown} */ (EVENT_REQUIRED));
const acceptedMinimumFields = /** @type {Record<string, readonly string[]>} */ (/** @type {unknown} */ (ACCEPT_MIN));

export class EnvelopeError extends Error {
  /** @param {string} reason @param {string} [detail] */
  constructor(reason, detail = '') { super(detail ? `${reason}: ${detail}` : reason); this.reason = reason; this.detail = detail; }
}

export function uid(n = 12) {
  const a = new Uint8Array(Math.ceil(n / 2));
  (globalThis.crypto?.getRandomValues ? globalThis.crypto.getRandomValues(a) : a.map(() => Math.random() * 256));
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('').slice(0, n);
}

/** @param {string} kind @param {EnvelopeBody} body @param {EnvelopeOptions} [options] @returns {Envelope} */
export function makeEnvelope(kind, body, { seq, t, id } = {}) {
  /** @type {Envelope} */
  const env = { v: PROTOCOL_V, kind, id: id || uid(), t: t == null ? Date.now() : Math.trunc(t), body };
  if (seq != null) env.seq = Math.trunc(seq);
  return env;
}

/** @param {Envelope} env @returns {string} */
export function encode(env) {
  const text = JSON.stringify(env);
  if (byteLength(text) > MAX_ENVELOPE_BYTES) throw new EnvelopeError('oversize', `${byteLength(text)} bytes > ${MAX_ENVELOPE_BYTES}`);
  return text;
}

/** @param {string} text @returns {number} */
export function byteLength(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  const g = /** @type {any} */ (globalThis);
  return g.Buffer.byteLength(text, 'utf8');
}

/** @param {unknown} x @returns {x is EnvelopeBody} */
const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
/** @param {unknown} x @returns {x is number} */
const isNum = x => typeof x === 'number' && Number.isFinite(x);

/** @param {EventBody} ev @returns {EventBody} */
export function validateEvent(ev) {
  if (!isObj(ev)) throw new EnvelopeError('bad_event', 'event body is not an object');
  const type = ev.type;
  if (typeof type !== 'string' || !eventTypes.has(type)) throw new EnvelopeError('bad_event', `type ${type} is not a persisted fact`);
  for (const k of ['t', 'node_id', 'player_id']) if (!(k in ev)) throw new EnvelopeError('bad_event', `missing ${k}`);
  if (!('match_id' in ev)) throw new EnvelopeError('bad_event', 'missing match_id');
  for (const k of eventRequiredFields[type]) if (!(k in ev)) throw new EnvelopeError('bad_event', `${type} missing ${k}`);
  if (!isNum(ev.t)) throw new EnvelopeError('bad_event', 't is not a number');
  if (ev.type === 'hit_taken' || ev.type === 'death') {
    const n = ev.shooter_num;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > MAX_PLAYERS) throw new EnvelopeError('bad_event', `shooter_num ${n} out of 0..${MAX_PLAYERS}`);
  }
  return ev;
}

/** direction = 'node' (node→MC, MC receiving) always checks the full REQUIRED[kind] — MC is the
 *  strict side. direction = 'mc' (MC→node, a node receiving) checks ACCEPT_MIN[kind] ?? REQUIRED[kind]:
 *  for the handful of kinds ACCEPT_MIN lists (currently just `result`, A24) the node accepts a body
 *  missing everything but those minimal fields, so a result short a field still reaches the engine
 *  instead of being dropped silently as `missing_field`. Mirrors envelope.py's validate() exactly. */
/** @param {Envelope} env @param {EnvelopeDirection} [direction] @returns {Envelope} */
export function validate(env, direction = 'node') {
  if (!isObj(env)) throw new EnvelopeError('not_object');
  if (env.v !== PROTOCOL_V) throw new EnvelopeError('version', `v=${env.v}, expected ${PROTOCOL_V}`);
  const allowed = direction === 'node' ? nodeKinds : mcKinds;
  if (!allowed.has(env.kind)) throw new EnvelopeError('unknown_kind', String(env.kind));
  if (typeof env.id !== 'string' || !env.id) throw new EnvelopeError('missing_field', 'id');
  if (!isNum(env.t) || env.t < T_MIN_MS || env.t > T_MAX_MS) throw new EnvelopeError('bad_t', String(env.t));
  if (!isObj(env.body)) throw new EnvelopeError('missing_field', 'body');
  const required = direction === 'mc' ? (acceptedMinimumFields[env.kind] ?? requiredFields[env.kind]) : requiredFields[env.kind];
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
    const chunk = b.chunk;
    if (typeof chunk !== 'string' || byteLength(chunk) > MAX_LOG_CHUNK_BYTES) throw new EnvelopeError('oversize', 'log_data chunk > 48 KB');
  } else if (env.kind === 'control') {
    const cmd = b.cmd;
    if (typeof cmd !== 'string' || !controlCommands.has(cmd)) throw new EnvelopeError('missing_field', `control.cmd ${cmd}`);
  }
  return env;
}

/** @param {string} text @param {EnvelopeDirection} [direction] @returns {Envelope} */
export function decode(text, direction = 'node') {
  if (byteLength(text) > MAX_ENVELOPE_BYTES) throw new EnvelopeError('oversize');
  let env;
  try { env = JSON.parse(text); } catch (e) { throw new EnvelopeError('not_object', `json: ${e instanceof Error ? e.message : String(e)}`); }
  return validate(env, direction);
}
