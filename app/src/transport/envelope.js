// Node↔MC envelope helpers — mirrors mcp/brx_mcp/mc/envelope.py + types.py (contracts.md §5/§9, A6).
// Dependency-free ESM; runs in the Capacitor WebView and in Node ≥ 22.

export const PROTOCOL_V = 1;
export const STATUS_HEARTBEAT_MS = 2000;
export const STALE_AFTER_MS = 8000;
export const SYNC_FRESH_MS = 10000;
export const FEEDBACK_MAX_AGE_MS = 3000;
export const LATE_ARM_GRACE_MS = 8000;
export const DEATH_LATCH_MS = 2000;
export const RESYNC_PROBE_S = 10;
export const MAX_PLAYERS = 63;
export const MAX_ENVELOPE_BYTES = 64 * 1024;
export const MAX_LOG_CHUNK_BYTES = 48 * 1024;

export const PERSISTED_EVENT_TYPES = new Set(['hit_taken', 'death', 'respawn', 'team_change']);
export const NODE_KINDS = new Set(['hello', 'bind', 'event', 'event_batch', 'status', 'ack_config',
  'time_req', 'log_offer', 'log_data', 'ready', 'loadout_request', 'loadout_browse']);   // A10: phone self-serve kitting
export const MC_KINDS = new Set(['welcome', 'assign', 'tutorial', 'config', 'start', 'feedback',
  'control', 'time_res', 'pull_log', 'ack', 'apply', 'score', 'loadout_ack']);
export const CONTROL_CMDS = new Set(['end', 'panic', 'abort_start', 'recall']);

const T_MIN_MS = 1_500_000_000_000, T_MAX_MS = 4_000_000_000_000;

const REQUIRED = {
  hello: ['node_id', 'node_type', 'app_ver', 'seq_next'],   // optional: gun{name,tail,fw}, node_key (A8 takeover key)
  bind: ['node_id', 'gun_name', 'gun_tail'],
  event: [], event_batch: ['events'],
  status: ['node_id', 'arm_state', 'synced'],
  ack_config: ['config_id', 'ok'], time_req: ['t_node'],
  log_offer: ['node_id', 'bytes', 'lines'], log_data: ['node_id', 'seq', 'chunk', 'last'],
  ready: ['node_id', 'player_id', 'ready'],
  // A10 (docs/spec/loadout.md §4): id / try / reason / loadout stay OPTIONAL — a required field that is missing DROPS the frame
  loadout_request: ['node_id', 'player_id', 'slot', 'kind'], loadout_browse: ['node_id', 'player_id', 'open'],
  welcome: ['session_id', 'server_t', 'seq_hi'], assign: ['player', 'team', 'roster'],
  tutorial: ['frames'],   // weapon optional: an end-of-try-out push carries {end, frames} only (2026-08-26)
  config: ['config', 'frames', 'roster'],
  start: ['match_id', 'go_live_t', 'config_id', 'seq', 'countdown_s'],
  feedback: ['player_id', 'kind', 't'], control: ['cmd'], time_res: ['t_node', 'server_t'],
  pull_log: [], ack: ['seq_hi'], apply: ['frames'], score: ['player_id'],
  loadout_ack: ['slot', 'ok'],
};
const EVENT_REQUIRED = { hit_taken: ['shooter_num', 'shooter_team', 'dmg'], death: ['shooter_num', 'shooter_team'], respawn: [], team_change: ['tid'] };

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
    if (!Number.isInteger(n) || n < 0 || n > 63) throw new EnvelopeError('bad_event', `shooter_num ${n} out of 0..63`);
  }
  return ev;
}

export function validate(env, direction = 'node') {
  if (!isObj(env)) throw new EnvelopeError('not_object');
  if (env.v !== PROTOCOL_V) throw new EnvelopeError('version', `v=${env.v}, expected ${PROTOCOL_V}`);
  const allowed = direction === 'node' ? NODE_KINDS : MC_KINDS;
  if (!allowed.has(env.kind)) throw new EnvelopeError('unknown_kind', String(env.kind));
  if (typeof env.id !== 'string' || !env.id) throw new EnvelopeError('missing_field', 'id');
  if (!isNum(env.t) || env.t < T_MIN_MS || env.t > T_MAX_MS) throw new EnvelopeError('bad_t', String(env.t));
  if (!isObj(env.body)) throw new EnvelopeError('missing_field', 'body');
  for (const k of REQUIRED[env.kind]) if (!(k in env.body)) throw new EnvelopeError('missing_field', `${env.kind}.${k}`);
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
