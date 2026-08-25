// In-browser mock of the MC server (mcp/brx_mcp/mc/API.md). Stateful enough for every UI interaction.
import type {
  Api, FeedEntry, GameConfig, LiveRow, ModeInfo, Phase, Player, ReadinessRow, ReadinessSnapshot,
  RecapView, ScanRow, ScoreRow, StartView, State, WeaponView,
} from '../api/types';
import { GUNS, LIVE, MODES, PLAYERS, READY, RECAP, TEAMS, WEAPONS } from './data';

const now = () => Date.now();
const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

type Sub = { snap: (s: State) => void; feed: (e: FeedEntry) => void };

export class MockBackend implements Api {
  private subs = new Set<Sub>();
  private phase: Phase = 'muster';
  private config: GameConfig = clone(MODES[0].defaults);
  private players: Player[] = [];
  private trying: Record<string, string> = {};
  private pushed = false;
  private acks: State['lobby']['acks'] = {};
  private start_?: State['start'];
  private live_?: { rows: LiveRow[]; feed: FeedEntry[]; go_live_t: number; match_id: string };
  private recap_?: RecapView;
  private gunOverride: Partial<Record<string, 'g' | 'r'>> = {};
  private timer: number | null = null;
  private session_id = uid('sess');

  constructor() {
    this.players = PLAYERS.map(([display, team_id, gi], i) => ({
      player_id: `p${i + 1}`, player_num: i + 1, display, team_id, node_id: `node_${GUNS[gi][1]}`,
      gun_id: GUNS[gi][0], loadout: { weapons: [{ weapon_id: i % 2 ? 'burst_rifle' : 'assault_rifle' }, { weapon_id: 'shotgun' }] },
      voice: 'male', ready: READY[display] ?? false,
    }));
    this.trying = { p4: 'smg' };
    this.timer = window.setInterval(() => this.tick(), 1000);
  }

  // ---------- state assembly ----------
  private readiness(): ReadinessSnapshot {
    const board: ReadinessRow[] = GUNS.map(([sticker, tail, s0, batt, link]) => {
      const s = this.gunOverride[sticker] ?? s0;
      const pl = this.players.find(p => p.gun_id === sticker);
      const red = s === 'r', a1 = s === 'a1', a2 = s === 'a2';
      const blockers: string[] = [];
      if (red) blockers.push('NOT POWERED — BLOCKS START');
      if (a1) blockers.push('BATTERY UNREAD — DOES NOT BLOCK');
      if (a2) blockers.push(`STALE LINK (${link}s) — DOES NOT BLOCK`);
      return {
        gun_id: sticker, sticker, tail, player_id: pl?.player_id, player_num: pl?.player_num,
        present: !red, identity: 'ok', node: red ? 'none' : 'linked',
        headset: red ? 'absent' : this.pushed ? 'proven' : 'unknown',
        battery_pct: batt ?? undefined, battery_age_ms: batt == null ? undefined : 4000,
        fw: 'v4.32', phone_batt: 80, ssid_ok: true, mc_reachable: !red, synced: !red, screen_on: true, foreground: true,
        last_seen_ms: link * 1000,
        status: red ? 'red' : a1 || a2 ? 'amber' : 'green', blockers,
      };
    });
    return { t: now(), roster_size: board.length, greens: board.filter(b => b.status === 'green').length, board, unclaimed: [], go: !board.some(b => b.status === 'red') };
  }

  private state(): State {
    const t = now();
    const readiness = this.readiness();
    const nodes = readiness.board.filter(b => b.node === 'linked').map(b => ({
      node_id: `node_${b.tail}`, node_type: 'phone', gun_name: `${b.sticker}-${b.tail}`, gun_tail: b.tail,
      player_id: b.player_id, arm_state: this.armStateFor(b.player_id), last_seen_ms: b.last_seen_ms ?? 0,
      synced: true, battery: b.battery_pct, fw: b.fw,
    }));
    const kitted = this.players.filter(p => PLAYERS.find(x => x[0] === p.display)?.[3] === 'kitted' || (p.player_id in this.acks)).length;
    return {
      session_id: this.session_id, phase: this.phase, t,
      lan: { mode: 'router', ssid: 'BRX-FIELD', ip: '192.168.8.10', port: 8765, ws_url: 'ws://192.168.8.10:8765/ws', qr: 'ws://192.168.8.10:8765/ws' },
      nodes, readiness, config: clone(this.config), config_errors: [],
      players: clone(this.players), teams: clone(TEAMS),
      kit: { kitted, total: this.players.length, trying: { ...this.trying } },
      lobby: { ready: this.players.filter(p => p.ready).length, total: this.players.length, pushed: this.pushed, acks: clone(this.acks) },
      start: this.start_ ? clone(this.start_) : undefined,
      live: this.live_ ? this.liveView() : undefined,
      recap: this.recap_ ? clone(this.recap_) : undefined,
    };
  }
  private armStateFor(pid?: string) {
    if (!pid) return 'connected' as const;
    if (this.phase === 'live') return 'live' as const;
    if (this.phase === 'armed') return this.start_?.per_node[pid]?.arm_state ?? 'lobby';
    if (this.pushed) return 'lobby' as const;
    return 'kitted' as const;
  }
  private liveView() {
    const l = this.live_!;
    const score: Record<string, number> = {};
    for (const r of l.rows) if (r.team_id) score[r.team_id] = (score[r.team_id] ?? 0) + r.kills;
    const tl = this.config.time_limit_s ?? 600;
    return { match_id: l.match_id, go_live_t: l.go_live_t, time_limit_s: tl, ends_t: l.go_live_t + tl * 1000, score, rows: clone(l.rows) };
  }
  private emit() { const s = this.state(); this.subs.forEach(x => x.snap(s)); }
  private feed(e: FeedEntry) { this.live_?.feed.unshift(e); this.subs.forEach(x => x.feed(e)); }

  // ---------- simulation tick ----------
  private tick() {
    const t = now();
    if (this.phase === 'armed' && this.start_) {
      for (const pid of Object.keys(this.start_.per_node)) {
        const n = this.start_.per_node[pid];
        if (n.arm_state === 'armed') n.t_minus_ms = Math.max(0, this.start_.go_live_t - t);
        else n.last_seen_ms += 1000;
      }
      if (t >= this.start_.go_live_t) this.goLive();
      this.emit();
    } else if (this.phase === 'live' && this.live_) {
      const lv = this.liveView();
      if (t >= lv.ends_t) { this.endMatch(); return; }
      for (const r of this.live_.rows) {
        if (r.status === 'down') { r.respawn_in_s = Math.max(0, (r.respawn_in_s ?? 0) - 1); if (r.respawn_in_s === 0) r.status = 'alive'; }
        r.sync_age_ms = r.status === 'stale' ? r.sync_age_ms + 1000 : Math.floor(Math.random() * 4000);
      }
      if (Math.random() < 0.12) this.simKill();
      this.emit();
    }
  }
  private simKill() {
    const l = this.live_!; const alive = l.rows.filter(r => r.status === 'alive');
    if (alive.length < 2) return;
    const k = alive[Math.floor(Math.random() * alive.length)];
    let v = alive[Math.floor(Math.random() * alive.length)];
    if (v === k) v = alive[(alive.indexOf(k) + 1) % alive.length];
    k.kills++; k.streak++; k.hits += 3; k.shots += 6; v.deaths++; v.streak = 0; v.status = 'down'; v.respawn_in_s = this.config.respawn.delay_s;
    for (const r of l.rows) { r.kd = +(r.kills / Math.max(r.deaths, 1)).toFixed(1); r.accuracy = r.shots ? Math.round((r.hits / r.shots) * 100) : null; }
    l.rows.sort((a, b) => b.kills - a.kills);
    const tm = Math.floor((now() - l.go_live_t) / 1000);
    const friendly = k.team_id && k.team_id === v.team_id && this.config.mode !== 'ffa';
    this.feed({ t_match_s: tm, text: `${k.display} eliminated ${v.display}`, kind: 'kill',
      tag: friendly ? 'TEAM KILL' : k.streak >= 5 ? `STREAK ×${k.streak}` : Math.random() < 0.2 ? 'DOUBLE KILL' : undefined });
    if (this.config.scoring.frag_limit && k.kills >= this.config.scoring.frag_limit) this.endMatch();
  }
  private goLive() {
    const s = this.start_!;
    this.phase = 'live';
    const rows: LiveRow[] = this.players.map(p => {
      const d = LIVE.find(x => x[0] === p.display) ?? [p.display, 0, 0, 0, 0, 0, 'alive', 1];
      return { player_id: p.player_id, display: p.display, team_id: p.team_id, kills: 0, deaths: 0, assists: 0, shots: 0, hits: 0,
        accuracy: null, kd: 0, streak: 0, medals: [], status: d[6] === 'stale' ? 'stale' : 'alive', sync_age_ms: d[7] * 1000 };
    });
    this.live_ = { rows, feed: [], go_live_t: s.go_live_t, match_id: s.match_id };
    this.feed({ t_match_s: 0, text: `MATCH LIVE — ${rows.length} NODES SPAWNED`, kind: 'sync', tag: 'SYNC POINT' });
  }
  private endMatch() {
    const l = this.live_; if (!l) return;
    this.phase = 'recap';
    const rows: ScoreRow[] = l.rows.map(r => {
      const d = RECAP.find(x => x[0] === r.display);
      const kills = r.kills || d?.[1] || 0, deaths = r.deaths || d?.[2] || 0;
      return { player_id: r.player_id, display: r.display, team_id: r.team_id, kills, deaths, assists: r.assists || d?.[3] || 0,
        shots: r.shots || 40, hits: r.hits || Math.round((d?.[4] ?? 30) * 0.4), accuracy: r.accuracy ?? d?.[4] ?? 30,
        kd: +(kills / Math.max(deaths, 1)).toFixed(1), streak: r.streak || d?.[5] || 0, medals: [] };
    }).sort((a, b) => b.kills - a.kills);
    const score: Record<string, number> = {};
    for (const r of rows) if (r.team_id) score[r.team_id] = (score[r.team_id] ?? 0) + r.kills;
    const ffa = this.config.mode === 'ffa';
    const top = rows[0];
    const winnerTeam = Object.entries(score).sort((a, b) => b[1] - a[1])[0]?.[0];
    const mvp = top, bestKd = [...rows].filter(r => r !== mvp).sort((a, b) => b.kd - a.kd)[0] ?? top;
    const sharp = [...rows].sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0))[0];
    const surv = [...rows].sort((a, b) => a.deaths - b.deaths)[0];
    const first = rows[2] ?? top, multi = [...rows].sort((a, b) => b.streak - a.streak)[0];
    const honors = [
      { award: 'MVP', player_id: mvp.player_id, stat: `${mvp.kills} K · ${mvp.kd.toFixed(1)} K/D · ×${mvp.streak} STREAK` },
      { award: 'MOST KILLS', player_id: top.player_id, stat: `${top.kills} ELIMINATIONS` },
      { award: 'BEST K/D · NON-MVP', player_id: bestKd.player_id, stat: `K/D ${bestKd.kd.toFixed(1)} · ${bestKd.kills} K` },
      { award: 'SHARPSHOOTER', player_id: sharp.player_id, stat: `${sharp.accuracy}% ACCURACY` },
      { award: 'SURVIVOR', player_id: surv.player_id, stat: 'LONGEST TIME ALIVE' },
      { award: 'FIRST BLOOD', player_id: first.player_id, stat: 'AT 00:14' },
      { award: 'MULTIKILL', player_id: multi.player_id, stat: `DOUBLE KILL ×${Math.max(1, Math.floor(multi.streak / 2))}` },
    ];
    for (const h of honors) rows.find(r => r.player_id === h.player_id)?.medals.push(h.award.replace(' · NON-MVP', ''));
    const missing = l.rows.filter(r => r.status === 'stale').map(r => r.player_id);
    this.recap_ = { winner: ffa ? { player_id: top.player_id } : { team_id: winnerTeam }, score, rows, honors, provisional: missing.length > 0, missing };
    this.emit();
  }

  // ---------- Api ----------
  async getState() { return this.state(); }
  subscribe(snap: (s: State) => void, feed: (e: FeedEntry) => void) {
    const s = { snap, feed }; this.subs.add(s); queueMicrotask(() => snap(this.state()));
    return () => { this.subs.delete(s); };
  }
  async scan(): Promise<ScanRow[]> {
    await new Promise(r => setTimeout(r, 600));
    this.gunOverride['GUN-D'] = 'g';
    this.emit();
    return GUNS.map(([s, tail]) => ({ tail, name: `${s}-${tail}`, basename: s, gun_id: s, rssi: -60, identity: 'ok', t: now() }));
  }
  async getModes(): Promise<ModeInfo[]> { return clone(MODES); }
  async getWeapons(): Promise<WeaponView[]> { return clone(WEAPONS); }
  async putConfig(partial: Partial<GameConfig>) {
    this.config = { ...this.config, ...partial, config_id: uid('cfg') };
    const errors: string[] = [];
    if (this.config.time_limit_s == null || this.config.time_limit_s <= 0) errors.push('time_limit_s is required on the phone path');
    if (this.config.mode === 'ffa') { const t = this.config.teams[0]; if (t) for (const p of this.players) p.team_id = t.team_id; }
    if (this.pushed) { this.pushed = false; this.acks = {}; }
    this.emit();
    return { ok: errors.length === 0, errors, config: clone(this.config) };
  }
  async addPlayer(p: { display: string; team_id?: string; gun_id?: string; voice?: string }): Promise<Player> {
    const used = new Set(this.players.map(x => x.player_num));
    let n = 1; while (used.has(n)) n++;
    const pl: Player = { player_id: uid('p'), player_num: n, display: p.display.toUpperCase(), team_id: p.team_id ?? null, node_id: null,
      gun_id: p.gun_id ?? null, loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: p.voice ?? 'male', ready: false };
    this.players.push(pl); this.emit(); return clone(pl);
  }
  async patchPlayer(id: string, patch: Partial<Player>): Promise<Player> {
    const p = this.players.find(x => x.player_id === id); if (!p) throw new Error('no such player');
    if (patch.player_num != null) {
      if (patch.player_num < 1 || patch.player_num > 63) throw new Error('player_num must be 1–63');
      if (this.players.some(x => x !== p && x.player_num === patch.player_num)) throw new Error('player_num in use');
    }
    Object.assign(p, patch);
    if (patch.loadout) delete this.trying[id];
    this.emit(); return clone(p);
  }
  async deletePlayer(id: string) { this.players = this.players.filter(p => p.player_id !== id); this.emit(); }
  async tryout(id: string, weapon_id: string) {
    if (this.pushed) throw new Error('try-outs are disabled once a config head has been pushed (modes.md §4)');
    this.trying[id] = weapon_id; this.emit();
  }
  async endTryout(id: string) { delete this.trying[id]; this.emit(); }
  async setReady(id: string, ready: boolean) { const p = this.players.find(x => x.player_id === id)!; p.ready = ready; this.emit(); return clone(p); }
  async pushLobby() {
    if (!this.readiness().go) throw new Error('readiness has reds — clear them before pushing');
    this.phase = 'lobby'; this.pushed = true; this.trying = {}; this.acks = {};
    for (const p of this.players) {
      const g = GUNS.find(x => x[0] === p.gun_id);
      const dead = g?.[2] === 'r' && this.gunOverride[g[0]] !== 'g';
      this.acks[p.player_id] = dead ? { ok: false, err: 'no_echo' } : { ok: true, gun_echo: '$LCD,0,0,0,0,0,0,*' };
    }
    this.emit(); return { ok: true, acks: clone(this.acks) };
  }
  private schedule(runway_s: number, seq: number, match_id: string) {
    const go_live_t = now() + runway_s * 1000;
    const per_node: StartView['per_node'] = {};
    for (const p of this.players) {
      const noAck = p.display === 'DRIFT';
      per_node[p.player_id] = { arm_state: noAck ? 'lobby' : 'armed', t_minus_ms: noAck ? undefined : runway_s * 1000, synced: !noAck, last_seen_ms: noAck ? 40000 : 1000 };
    }
    this.start_ = { match_id, go_live_t, seq, countdown_s: runway_s, per_node };
    this.phase = 'armed'; this.emit();
    return { match_id, go_live_t, seq };
  }
  async start(runway_s: number) {
    if (!this.pushed) throw new Error('push config first');
    return this.schedule(runway_s, 1, uid('match'));
  }
  async reschedule(runway_s: number) { return this.schedule(runway_s, (this.start_?.seq ?? 0) + 1, uid('match')); }
  async abort() {
    const reached = this.players.filter(p => this.start_?.per_node[p.player_id]?.last_seen_ms! < 8000).map(p => p.player_id);
    const unreachable = this.players.map(p => p.player_id).filter(id => !reached.includes(id));
    this.start_ = undefined; this.phase = 'lobby'; this.emit();
    return { ok: true, reached, unreachable };
  }
  async control(cmd: 'end' | 'recall' | 'panic', confirm?: boolean) {
    if (cmd === 'panic' && !confirm) throw new Error('panic requires confirm');
    if (cmd === 'end' && this.live_) { this.endMatch(); return { ok: true }; }
    this.start_ = undefined; this.live_ = undefined; this.phase = this.pushed ? 'lobby' : 'kit'; this.pushed = false; this.acks = {};
    this.emit(); return { ok: true };
  }
  async getRecap() { if (!this.recap_) throw new Error('no recap yet'); return clone(this.recap_); }
  recapCsvUrl() {
    const r = this.recap_; if (!r) return '#';
    const lines = ['operator,team,kills,deaths,assists,kd,accuracy,streak,medals',
      ...r.rows.map(x => [x.display, x.team_id ?? '', x.kills, x.deaths, x.assists, x.kd, x.accuracy ?? '', x.streak, x.medals.join(' · ')].join(','))];
    return 'data:text/csv;charset=utf-8,' + encodeURIComponent(lines.join('\n'));
  }
  async newSession(keep_roster: boolean) {
    this.phase = 'muster'; this.pushed = false; this.acks = {}; this.start_ = undefined; this.live_ = undefined; this.recap_ = undefined;
    this.session_id = uid('sess');
    if (!keep_roster) this.players = []; else for (const p of this.players) p.ready = false;
    this.emit(); return this.state();
  }
  dispose() { if (this.timer) window.clearInterval(this.timer); }
}
