import { ACC_MIN_SHOTS, AWARDS, MEDALS, OBJECTIVE_MODES } from '../api/contract.gen';
import type { Honor } from '../api/types';

export interface HonorPlayer {
  id: string;
  kills?: number;
  deaths?: number;
  assists?: number;
  best_streak?: number;
  multis?: number[];
  shots?: number;
  accuracy?: number | null;
  longest_life_ms?: number;
  objective_s?: number;
  flushed?: boolean;
  unsynced?: boolean;
  hot_join?: boolean;
}

const medalLabels = new Map(MEDALS.filter(m => m.kind === 'multi').map(m => [m.count, m.label]));
const awardLabels = new Map(AWARDS.map(a => [a.key, a.label]));
const roundHalfEven = (value: number) => {
  const lower = Math.floor(value);
  const fraction = value - lower;
  return fraction < 0.5 ? lower : fraction > 0.5 ? lower + 1 : lower + (lower % 2);
};
const formatKd = (p: HonorPlayer) => {
  const deaths = Math.max(p.deaths ?? 0, 1);
  return (roundHalfEven((p.kills ?? 0) * 10 / deaths) / 10).toFixed(1);
};
const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function computeHonors(players: HonorPlayer[], mode: string, firstBlood?: { player_id: string; t_match_s: number }): Honor[] {
  if (players.length < 3) return [];
  const k = (p: HonorPlayer) => p.kills ?? 0;
  const d = (p: HonorPlayer) => p.deaths ?? 0;
  const a = (p: HonorPlayer) => p.assists ?? 0;
  const kd = (p: HonorPlayer) => k(p) / Math.max(d(p), 1);
  const top = (pool: HonorPlayer[], rank: (p: HonorPlayer) => number[]) => {
    if (!pool.length) return [];
    const sorted = [...pool].sort((x, y) => {
      const xr = rank(x), yr = rank(y);
      for (let i = 0; i < xr.length; i++) if (xr[i] !== yr[i]) return yr[i] - xr[i];
      return 0;
    });
    const best = rank(sorted[0]);
    return sorted.filter(p => rank(p).every((v, i) => v === best[i]));
  };
  const mvp = top(players, p => [k(p) - d(p), kd(p), k(p)]);
  const by: Record<string, HonorPlayer[]> = {
    mvp: mvp.filter(p => k(p) > 0),
    most_kills: top(players, p => [k(p)]).filter(p => k(p) > 0),
    best_kd: top(players.filter(p => !mvp.includes(p) && k(p) > 0), p => [kd(p), k(p)]),
    sharpshooter: top(players.filter(p => (p.shots ?? 0) >= ACC_MIN_SHOTS && (p.accuracy ?? 0) > 0), p => [roundHalfEven(p.accuracy!)]),
  };
  const lives = players.filter(p => p.flushed !== false && !p.unsynced);
  const survivor = top(lives, p => [Math.floor((p.longest_life_ms ?? 0) / 1000)]);
  by.survivor = survivor.length && survivor.length < lives.length && (survivor[0].longest_life_ms ?? 0) > 0 ? survivor : [];
  const full = players.filter(p => !p.hot_join && p.flushed !== false);
  const iron = top(full, p => [-d(p), k(p)]);
  const mostDeaths = Math.max(0, ...full.map(d));
  by.iron_man = iron.filter(p => d(p) < mostDeaths);
  by.first_blood = firstBlood && players.some(p => p.id === firstBlood.player_id) ? [players.find(p => p.id === firstBlood.player_id)!] : [];
  by.multikill = top(players.filter(p => Math.max(0, ...(p.multis ?? [])) >= 2), p => [Math.max(0, ...(p.multis ?? [])), (p.multis ?? []).filter(n => n >= 2).length]);
  by.wingman = top(players, p => [a(p)]).filter(p => a(p) > 0);
  by.objective_hero = OBJECTIVE_MODES.includes(mode) ? top(players.filter(p => (p.objective_s ?? 0) > 0), p => [p.objective_s ?? 0]) : [];

  const honors: Honor[] = [];
  for (const award of AWARDS) for (const p of by[award.key] ?? []) {
    const streak = p.best_streak ?? 0;
    const multi = p.multis ?? [];
    const best = Math.max(0, ...multi);
    const chainTier = [...medalLabels.keys()].filter(n => n <= best).sort((x, y) => y - x)[0];
    const chainLabel = chainTier ? medalLabels.get(chainTier)! : 'MULTIKILL';
    let stat = '';
    switch (award.key) {
      case 'mvp': stat = `${k(p)} K · ${formatKd(p)} K/D · ×${streak} STREAK`; break;
      case 'most_kills': stat = `${k(p)} ELIMINATIONS`; break;
      case 'best_kd': stat = `K/D ${formatKd(p)} · ${k(p)} K`; break;
      case 'sharpshooter': stat = `${roundHalfEven(p.accuracy ?? 0)}% ACCURACY`; break;
      case 'survivor': stat = `LONGEST LIFE ${mmss(p.longest_life_ms ?? 0)}`; break;
      case 'iron_man': stat = `FEWEST DEATHS · ${d(p)}`; break;
      case 'first_blood': stat = `AT ${String(Math.floor((firstBlood?.t_match_s ?? 0) / 60)).padStart(2, '0')}:${String((firstBlood?.t_match_s ?? 0) % 60).padStart(2, '0')}`; break;
      case 'multikill': stat = `${chainLabel} ×${Math.max(1, multi.filter(n => n >= (chainTier ?? 2)).length)}`; break;
      case 'wingman': stat = `${a(p)} ASSISTS`; break;
      case 'objective_hero': stat = `IN RANGE · ${mmss((p.objective_s ?? 0) * 1000)}`; break;
    }
    honors.push({ key: award.key, award: awardLabels.get(award.key)!, player_id: p.id, stat });
  }
  return honors;
}
