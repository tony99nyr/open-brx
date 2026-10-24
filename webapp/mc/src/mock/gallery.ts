import type { NodeView, Player, RecapView, ScoreRow, State } from '../api/types';

// F596/F597 storyboard hook: `?mock&gallery=<frame>` freezes the console on RECAP with an injected
// roster, so the SYNC BOARD can be rendered in every state without playing a match. The frame can be
// changed at run time with `window.__brxGallery('<frame>')` (a late phone arriving is two frames in a
// row). It exists for the storyboard only; nothing reads it in a real MC. It is not a mock of a new
// server field: every value below is one the real snapshot already carries.
//
// Phone tokens: R received · RL<n> received with n facts lost · U not linked · W/C/B[n] linked over
// Wi-Fi / cellular / backhaul with n facts left to send (omit n for none) · a trailing `!` = no
// progress for 3 minutes.
const NAMES = ['VIPER', 'HAWK', 'RAVEN', 'COBRA', 'GHOST', 'NOVA', 'TALON', 'ECHO', 'RIFT', 'JACKAL', 'MAMBA', 'ORION', 'SABLE', 'KESTREL', 'DRIFT', 'BISON'];

interface Frame { spec: string; winner: 'blue' | 'red'; sinceS: number }
const F8 = (spec: string, winner: 'blue' | 'red' = 'blue', sinceS = 60): Frame => ({ spec, winner, sinceS });
export const GALLERY_FRAMES: Record<string, Frame> = {
  b: F8('U U U W W U W W', 'blue', 20),
  c: F8('R R R W4 C7 B2 U W', 'blue', 75),
  d: F8('R R R R R R W2 W3!', 'blue', 200),
  d2: F8('R R R R R R R W3!', 'blue', 205),
  g: F8('R R R R R R R R', 'blue', 90),
  h: F8('R R R R R R R R', 'red', 260),
  i: F8('R R R R R R R W3 W5 C2 C8 B1 B4 U U W6!', 'blue', 130),
  j: F8('R R RL12 R R R R R', 'blue', 90),
  c2: F8('R RL5 R W4 C7 B2 U W', 'blue', 75),
  i32: F8(Array.from({ length: 32 }, (_, k) => ['R', 'R', 'R', 'W3', 'R', 'C4', 'R', 'B2', 'U', 'R', 'W', 'R', 'R', 'W6!', 'RL3', 'R'][k % 16]).join(' '), 'blue', 140),
  i48: F8(Array.from({ length: 48 }, (_, k) => ['R', 'R', 'R', 'W3', 'R', 'C4', 'R', 'B2', 'U', 'R', 'W', 'R', 'R', 'W6!', 'RL3', 'R'][k % 16]).join(' '), 'blue', 140),
  a16: F8('R R R R R R R W3 W5 C2 C8 B1 B4 U U W6!', 'blue', 130),
  a: F8('R R R W4 C7 B2 U W', 'blue', 75),
};

export function galleryState(base: State, frame: string): State {
  const f = GALLERY_FRAMES[frame];
  if (!f) return base;
  const toks = f.spec.split(' ');
  const tmpl = base.players[0] as Player;
  const players: Player[] = toks.map((_, i) => ({ ...tmpl, player_id: `g${i}`, player_num: i + 1, display: NAMES[i] ?? `PLAYER ${i + 1}`, team_id: i % 2 ? 'red' : 'blue', node_id: `node_g${i}`, ready: true }));
  const idle: Record<string, number> = {};
  const missing: string[] = [];
  const nodes: NodeView[] = toks.map((tok, i) => {
    const id = `g${i}`;
    const stuck = tok.endsWith('!');
    const t = tok.replace('!', '');
    const kind = t[0];
    const n = Number(t.slice(1)) || 0;
    if (kind !== 'R') missing.push(id);
    if (kind !== 'R') idle[id] = stuck ? 190 + i : 12 + i * 3;
    const node: NodeView = { node_id: `node_g${i}`, node_type: 'phone', arm_state: 'kitted', last_seen_ms: kind === 'U' ? 95_000 : 900,
      synced: true, stale: kind === 'U', player_id: id, gun_name: `GUN-${i}`, battery: 70 };
    if (kind === 'W' || kind === 'C' || kind === 'B') {
      node.pending = n;
      if (kind === 'B') { node.reach = 'backhaul'; node.transport = 'cellular'; }
      else { node.reach = 'lan'; node.transport = kind === 'C' ? 'cellular' : 'wifi'; }
    } else if (kind === 'R') { node.reach = 'lan'; node.transport = 'wifi'; if (t.startsWith('RL')) node.outbox_lost = Number(t.slice(2)) || 1; }
    return node;
  });
  (window as unknown as { __brxIdle?: Record<string, number> }).__brxIdle = idle;
  const rows: ScoreRow[] = players.map((p, i) => ({ player_id: p.player_id, display: p.display, team_id: p.team_id, kills: 9 - (i % 5) * 2 + (i % 3), deaths: 3 + (i % 4), assists: i % 3,
    shots: 80, shots_total: 80, hits: 30, accuracy: 0.34 + (i % 5) / 50, kd: 1.5, streak: 0, medals: [], best_streak: 3, multi_best: 0, first_blood: false }));
  const score = f.winner === 'blue' ? { blue: 23, red: 19 } : { blue: 21, red: 22 };
  // Option C storyboard: `&station=1` adds one hill station MC has not heard since the whistle
  const stations = typeof location !== 'undefined' && new URLSearchParams(location.search).get('station') === '1' && missing.length
    ? [{ node_id: 'stick_hill', kind: 'control' as const, id: 1, team: 3, heard: true, synced: false, owner: null }] : undefined;
  // `&endopen=<n>` marks the first n phones' END as not confirmed
  const endN = typeof location !== 'undefined' ? Number(new URLSearchParams(location.search).get('endopen')) || 0 : 0;
  const end_delivery = endN ? { total: players.length, retrying: true, unconfirmed: players.slice(0, endN).map(p => ({ player_id: p.player_id, display: p.display, tries: 2, reached: true })) } : undefined;
  const recap: RecapView = { winner: { team_id: f.winner }, score, rows, honors: [], provisional: missing.length > 0, missing, played_s: 300,
    settling: missing.length > 0, awaiting: missing, since_end_ms: f.sinceS * 1000, post_end: 0, post_end_facts: 0, parked: 0, ...(stations ? { stations } : {}) };
  return { ...base, phase: 'recap', players, nodes, recap, end_delivery, orphan_match: undefined, warnings: [],
    config: { ...base.config, mode: 'tdm', time_limit_s: 300 }, t: (base.t ?? Date.now()) } as State;
}
