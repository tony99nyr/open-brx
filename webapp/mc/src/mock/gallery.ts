import type { Player, RecapView, ScoreRow, State } from '../api/types';
import { copyState } from './copyGallery';
import type { RecapSyncRow, RecapSyncStage, RecapSyncView } from '../api/recapSync';

// F596/F597 render hook: `?mock&gallery=<frame>` freezes the console on RECAP with an injected roster and an
// injected `recap.sync`, so the sync strip can be rendered in every state without playing a match. The frame can
// be changed at run time with `window.__brxGallery('<frame>')` (a late phone arriving is two frames in a row).
// Nothing reads it in a real MC. The rows below are exactly the shape the server sends (`api/recapSync.ts`).
//
// Row tokens: R received · RL<n> received with n facts lost · U not linked · L linked (nothing to send yet) ·
// W/C/B<n> sending over Wi-Fi / cellular / backhaul with n facts left (W/C/B with no n = linked) ·
// ST / SR a hill station not synced / synced · a trailing `!` = stuck (no progress for 3 minutes) · a
// trailing `^` = END not confirmed.
const NAMES = ['VIPER', 'HAWK', 'RAVEN', 'COBRA', 'GHOST', 'NOVA', 'TALON', 'ECHO', 'RIFT', 'JACKAL', 'MAMBA', 'ORION', 'SABLE', 'KESTREL', 'DRIFT', 'BISON'];

interface Frame { spec: string; winner: 'blue' | 'red'; finalised?: boolean; changed?: boolean }
const rep = (n: number) => Array.from({ length: n }, (_, k) => ['R', 'R', 'R', 'W3', 'R', 'C4', 'R', 'B2', 'U', 'R', 'W', 'R', 'R', 'W6!', 'RL3', 'R'][k % 16]).join(' ');
const F8 = (spec: string, winner: 'blue' | 'red' = 'blue', extra: Partial<Frame> = {}): Frame => ({ spec, winner, ...extra });
export const GALLERY_FRAMES: Record<string, Frame> = {
  b: F8('U U U W W U W W'),                                   // 8 waiting, none in
  c: F8('R^ RL5 R W4 C7 B2 U W'),                              // 8 mixed, a station-less field
  cs: F8('R^ RL5 R W4 C7 B2 U W ST'),                          // the same with one hill station
  d: F8('R R R R R R W2 W3!'),                                 // one stuck
  i: F8('R R R R R R R W3 W5 C2 C8 B1 B4 U U W6!'),            // 16
  i48: F8(rep(48)),
  g: F8('R R R R R R R R'),                                    // all received (the strip holds, then collapses)
  lost: F8('R RL12 R R R R R R^'),                             // all received, one lost and one END open: they keep a badge
  fin1: F8('R R R R R R R U', 'blue', { finalised: true }),    // finalised without one phone
  chg: F8('R R R R R R R R', 'red', { changed: true }),        // the winner flipped after the first final
};

export function galleryState(base: State, frame: string): State {
  if (frame.startsWith('copy:')) return copyState(base, frame.slice(5));   // F599: faults laid over the live mock
  const f = GALLERY_FRAMES[frame];
  if (!f) return base;
  const toks = f.spec.split(' ');
  const phoneToks = toks.filter(t => !t.startsWith('S'));
  const tmpl = base.players[0] as Player;
  const players: Player[] = phoneToks.map((_, i) => ({ ...tmpl, player_id: `g${i}`, player_num: i + 1, display: NAMES[i] ?? `PLAYER ${i + 1}`, team_id: i % 2 ? 'red' : 'blue', node_id: `node_g${i}`, ready: true }));
  const sync: RecapSyncRow[] = [];
  let pi = 0;
  toks.forEach((raw, k) => {
    const stuck = raw.includes('!');
    const end = raw.includes('^');
    const t = raw.replace(/[!^]/g, '');
    const kind = t[0];
    const n = Number(t.slice(1)) || 0;
    const common = { end_unconfirmed: end, stuck, idle_s: stuck ? 190 + k : 0 };
    if (t.startsWith('S')) {
      const stage: RecapSyncStage = t === 'SR' ? 'received' : 'unlinked';
      sync.push({ kind: 'station', id: '1', name: 'HILL 1', team_id: null, stage, transport: null, ...common, idle_s: stage === 'received' ? 0 : 30 });
      return;
    }
    const pl = players[pi++];
    const stage: RecapSyncStage = kind === 'R' ? 'received' : kind === 'U' ? 'unlinked' : kind === 'L' ? 'linked' : n > 0 ? 'sending' : 'linked';
    const transport = stage === 'unlinked' || stage === 'received' ? null : kind === 'C' ? 'cellular' : kind === 'B' ? 'backhaul' : 'wifi';
    sync.push({ kind: 'phone', id: pl.player_id, name: pl.display, team_id: pl.team_id, stage, transport,
      ...(stage === 'sending' ? { pending: n } : {}), ...(t.startsWith('RL') ? { lost: Number(t.slice(2)) || 1 } : {}),
      ...common, idle_s: stage === 'received' ? 0 : stuck ? 190 + k : 12 + k * 3, stuck: stage !== 'received' && stuck });
  });
  const rows: ScoreRow[] = players.map((p, i) => ({ player_id: p.player_id, display: p.display, team_id: p.team_id, kills: 9 - (i % 5) * 2 + (i % 3), deaths: 3 + (i % 4), assists: i % 3,
    shots: 80, shots_total: 80, hits: 30, accuracy: 34 + (i % 5) * 3, kd: 1.5, streak: 0, medals: [], best_streak: 3, multi_best: 0, first_blood: false }));
  const score = f.winner === 'blue' ? { blue: 23, red: 19 } : { blue: 21, red: 22 };
  const open = sync.filter(r => r.stage !== 'received').length > 0;
  const view: RecapSyncView = { rows: sync, pending: open && !f.finalised, finalised: !!f.finalised, result_changed: !!f.changed };
  const recap = { winner: { team_id: f.winner }, score, rows, honors: [], provisional: false, missing: [], played_s: 300,
    settling: false, awaiting: [], since_end_ms: 60_000, post_end: 0, post_end_facts: 0, parked: 0, sync: view } as unknown as RecapView;
  return { ...base, phase: 'recap', players, nodes: [], recap, end_delivery: undefined, orphan_match: undefined, warnings: [],
    config: { ...base.config, mode: 'tdm', time_limit_s: 300 }, t: (base.t ?? Date.now()) } as State;
}
