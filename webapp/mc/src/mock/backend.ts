// In-browser mock of the MC server (mcp/brx_mcp/mc/API.md). Stateful enough for every UI interaction.
import type {
  Api, Coverage, FeedEntry, GameConfig, LanPublic, LiveRow, Loadout, LoadoutPolicy, MatchHistoryRow, ModeInfo, NodeView, PerkView, Phase, Player,
  ReadinessRow, ReadinessSnapshot, RecapStationRow, RecapView, SavedGame, ScanRow, ScoreRow, StartView, State, StationAssignment, StationKind,
  StationView, TunnelProvider, TunnelStatus, WeaponView,
} from '../api/types';
import { STATION_KINDS } from '../api/types';
import { GUNS, LIVE, MODES, PERKS, PLAYERS, READY, RECAP, TEAMS, WEAPONS } from './data';
import { PRESETS, apply as applyPolicy, conflict, defaultPolicy, pool as poolOf, presetOf, reject } from './policy';

const now = () => Date.now();
// loadout.md §8 — the shipped example so the SAVED GAMES shelf is never empty on first use
const BUILTIN_SNIPER = (): SavedGame => {
  const ffa = clone(MODES.find(m => m.mode === 'ffa')!.defaults);
  ffa.health = { ...ffa.health, max_armor: 0 };
  ffa.loadout_policy = { preset: 'custom', hud_select: false,
    primary: { choice: 'fixed', kinds: ['weapon'], exclude_tags: [], exclude_ids: [], only_ids: [], fixed_id: 'sniper_rifle' },
    secondary: { choice: 'off', kinds: ['weapon'], exclude_tags: [], exclude_ids: [], only_ids: [], fixed_id: null },
    perk: { choice: 'fixed', kinds: ['perk'], exclude_tags: [], exclude_ids: [], only_ids: [], fixed_id: 'extended_mags' } };   // A14: the perk is its own slot
  return { preset_id: 'builtin:silenced_sniper', name: 'Silenced Sniper', builtin: true, created_t: 0, updated_t: 0, config: ffa,
    desc: 'Everyone gets the bolt-action sniper with extended mags, no armor — one shot kills. No teams, no picking. (Fire-sound "silencing" waits on the weapon-tuning spec.)' };
};
// every kit shape the Kit page can show: weapon + perk (A14: all three slots), perk only, empty, weapon only
const DEMO_LOADOUTS: (() => Loadout)[] = [
  () => ({ weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'deagle' }], perk: 'quick_switch' }),
  () => ({ weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'shotgun' }], perk: null }),
  () => ({ weapons: [{ weapon_id: 'burst_rifle' }], perk: 'body_armor' }),
  () => ({ weapons: [{ weapon_id: 'smg' }], perk: null }),
  () => ({ weapons: [{ weapon_id: 'sniper_rifle' }, { weapon_id: 'smg' }], perk: null }),
  () => ({ weapons: [{ weapon_id: 'assault_rifle' }], perk: 'easy_reload' }),
];
// The server's `SETUP: ` warnings, one per objective source (compile.py validate). The demo carries both
// so the LOBBY / ARMED strip and the GAMES rail show in `?mock` exactly what a real MC sends — including
// that an `ir_station` game is NOT silent about being a source we have never had on a bench.
const SETUP_WARNING: Record<string, string> = {
  grenade: 'SETUP: POWER-CYCLE THE GRENADE SO IT STARTS NEUTRAL, SET IT TO HILL MODE, AND PLACE IT — a hill that starts already owned skews the whole match, and only a power cycle guarantees neutral. ONE POINT ONLY (F88: a beacon carries no station id)',
  ir_station: 'SETUP: PLACE AND POWER THE IR STATION, AND CHECK IT READS NEUTRAL BEFORE THE WHISTLE — ⚠ UNPROVEN: we have never had one on the bench, so nothing confirms it speaks the protocol our nodes read. Run the grenade if you want a hill we have measured',
  phone: 'SETUP: THE CONTROL POINT IS A PHONE — open the app in the UTILITY role, kind CONTROL, confirm it shows MC-ARMED for THIS game (arming resets the point; do NOT power-cycle it), leave the screen awake on the point, and check its battery. Players must be advertising (the HUD does this) or the point counts nobody',
};
// mirrors STATION_SOURCES in mcp/brx_mcp/mc/types.py, including the wording of the refusal
const MOCK_STATION_SOURCES = [
  { value: 'grenade', desc: 'a BRX Smart Grenade in hill mode (protocol-15 beacons; bench-proven 2026-09-10)' },
  { value: 'ir_station', desc: 'a BRX station / Utility Box emitting $CAPTURE objective events (unproven on our bench)' },
  { value: 'phone', desc: 'a spare phone in the utility role as a BLE control point, capture by presence (spec/utility.md §5d)' },
];
const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

type Sub = { snap: (s: State) => void; feed: (e: FeedEntry) => void };

export class MockBackend implements Api {
  private subs = new Set<Sub>();
  private phase: Phase = 'muster';
  private config: GameConfig = clone(MODES[0].defaults);
  private players: Player[] = [];
  private trying: Record<string, string> = {};
  private browsing: Record<string, number> = {};
  private presets: SavedGame[] = [BUILTIN_SNIPER()];
  private activePreset: string | null = null;
  private evicted = new Set<string>();
  // A13.5: one utility phone that said hello and is waiting to be assigned (the ITEMS panel demo). Mirrors
  // `Session.stations` / `_station_view` in state.py, including the attention flags the server derives.
  private stations: Record<string, { assigned: StationAssignment | null; armed: StationView['armed']; arm_pending: boolean; report: StationView['report']; seen: number; offline?: boolean }> = {
    'util-a1b2c3': { assigned: null, armed: null, arm_pending: false, report: { kind: 'respawn', team: 1, station_id: 1, threshold: -74, live: false, revives: 0, armed: false, battery: 64 }, seen: now() },
    // F106(i): a second seeded phone that is ASSIGNED but OUT OF WI-FI (the operator carried it out to the
    // field before it ever got the arming push) so `?mock` alone can show OUT OF WI-FI / ARM PENDING on the
    // ITEMS panel without live hardware — the first phone's `online` was hard-coded true for every station,
    // so that pair of states could never be demoed (review 2026-09-11 lane-4).
    'util-d4e5f6': { assigned: { kind: 'extraction', team: 255, id: 8, threshold: -74, at: now() - 20 * 60 * 1000 },
                     armed: null, arm_pending: true,
                     report: { kind: 'extraction', team: 255, station_id: 8, threshold: -74, live: true, revives: 0, armed: false, battery: 41 },
                     seen: now() - 20 * 60 * 1000, offline: true },
  };
  private gameNo = 1;
  private gameStarted = false;
  private stationViews(): StationView[] {
    return Object.entries(this.stations).map(([node_id, st]) => {
      const attention: string[] = [];
      const a = st.assigned, rep = st.report;
      if (a && st.arm_pending) attention.push('BRING IT BACK TO RE-ARM');
      if (a && st.armed && st.armed.game !== this.gameNo) attention.push('ARMED FOR AN OLDER GAME');
      const fresh = !!st.armed && st.seen > st.armed.at;   // a report only contradicts an arming it post-dates
      if (a && fresh && rep.armed === false) attention.push('PHONE SAYS NOT ARMED');
      if (a && fresh && rep.station_id != null && rep.station_id !== a.id) attention.push(`PHONE ADVERTISES ID ${rep.station_id}, ASSIGNED ${a.id}`);
      if (typeof rep.battery === 'number' && rep.battery < 30) attention.push('BATTERY LOW');
      return { node_id, assigned: a, armed: st.armed, arm_pending: st.arm_pending, report: rep, app_ver: 'utility',
        last_seen_ms: now() - st.seen, online: !st.offline, attention, game: this.gameNo };
    });
  }
  private stationIds() { return Object.values(this.stations).flatMap(s => s.assigned ? [s.assigned.id] : []).sort((a, b) => a - b); }
  private armStation(node_id: string) {
    const st = this.stations[node_id]; if (!st?.assigned) return;
    st.armed = { game: this.gameNo, at: now(), kind: st.assigned.kind, team: st.assigned.team, id: st.assigned.id };
    st.arm_pending = false;
    // the demo phone applies it, as utility.js does: it now reports what it was told
    st.report = { ...st.report, kind: st.assigned.kind, team: st.assigned.team, station_id: st.assigned.id, threshold: st.assigned.threshold, armed: true, live: true };
  }
  async putStation(node_id: string, a: { kind: StationKind; team: number | string; id: number; threshold?: number }): Promise<StationView> {
    if (!STATION_KINDS.includes(a.kind)) throw new Error(`kind must be one of ${STATION_KINDS.join(', ')}`);
    let team: number;
    if (typeof a.team === 'string') {
      if (a.team === 'any' || a.team === 'ffa') team = 255;
      else { const t = TEAMS.find(t => t.team_id === a.team); if (!t) throw new Error(`team '${a.team}' is not a team_id in this game (or 'any')`); team = t.tid; }
    } else team = a.team;
    if (!([0, 1, 2, 3].includes(team) || team === 255)) throw new Error("team must be a $TID 0-3, a team_id, or 'any' (255)");
    if (a.kind === 'control' && team !== 255) throw new Error("a control point starts NEUTRAL and is taken by presence (spec/utility.md §5d): team must be 'any'");
    if (!Number.isInteger(a.id) || a.id < 1 || a.id > 65535) throw new Error('id must be an integer 1..65535 (the station id in the advert)');
    const clash = Object.entries(this.stations).find(([n, s]) => n !== node_id && s.assigned?.id === a.id);
    if (clash) throw new Error(`station id ${a.id} is already assigned to ${clash[0]}; ids must be unique on the field`);
    const threshold = a.threshold ?? -74;
    if (!Number.isInteger(threshold) || threshold < -100 || threshold > -30) throw new Error('threshold must be an integer dBm in -100..-30 (the presence bubble; -74 ≈ 10 ft at high TX)');
    const st = this.stations[node_id] ?? (this.stations[node_id] = { assigned: null, armed: null, arm_pending: false, report: {}, seen: now() });
    st.assigned = { kind: a.kind, team, id: a.id, threshold, at: now() };
    for (const n of Object.keys(this.stations)) this.armStation(n);
    this.emit();
    return this.stationViews().find(v => v.node_id === node_id)!;
  }
  async deleteStation(node_id: string) {
    const st = this.stations[node_id]; if (!st) throw Object.assign(new Error('no such station'), { status: 404 });
    st.assigned = null; st.armed = null; st.arm_pending = false; this.emit();
  }
  async armStations() { for (const n of Object.keys(this.stations)) this.armStation(n); this.emit(); return { ok: true, armed: this.stationIds().length, pending: [] }; }
  private pushed = false;
  private acks: State['lobby']['acks'] = {};
  private start_?: State['start'];
  private live_?: { rows: LiveRow[]; feed: FeedEntry[]; go_live_t: number; match_id: string };
  private recap_?: RecapView;
  private history_: MatchHistoryRow[] = [];
  private gunOverride: Partial<Record<string, 'g' | 'r'>> = {};
  private timer: number | null = null;
  private session_id = uid('sess');
  // A28: the demo's own tunnel — off by default, available (cloudflared "found"), never manual —
  // so ?mock can walk the whole TURN ON -> STARTING -> UP loop without a real server.
  private joinSecret = 'k7q2m9xz';
  private tunnelStatus: TunnelStatus = 'off';
  private tunnelWsUrl: string | null = null;
  private tunnelProvider: TunnelProvider = 'cloudflared';
  private tunnelAvailable = true;
  private tunnelError?: string;
  private tunnelTimer: number | null = null;
  // Mock-only debug hook, read once at construction: `?mock&tunnelfail=1` makes the NEXT TURN ON fail
  // instead of coming up, so the e2e suite (and a human) can drive the persistent "TUNNEL DOWN" banner
  // without a real cloudflared process to kill. One-shot, like a real flaky start.
  private tunnelFailNext = typeof location !== 'undefined' && new URLSearchParams(location.search).get('tunnelfail') === '1';
  // the server's validate() errors ride on every snapshot (config_errors); the demo used to hardcode []
  // so a refusal shown in the PUT response vanished from the rail on the very next tick
  private cfgErrors: string[] = [];

  constructor() {
    this.players = PLAYERS.map(([display, team_id, gi], i) => ({
      player_id: `p${i + 1}`, player_num: i + 1, display, team_id, node_id: `node_${GUNS[gi][1]}`,
      gun_id: GUNS[gi][0], loadout: DEMO_LOADOUTS[i % DEMO_LOADOUTS.length](),
      voice: 'male', ready: READY[display] ?? false,
    }));
    this.trying = { p4: 'smg' };
    this.browsing = { p6: now() };   // SABLE is browsing on the phone
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

  /** A28.1: MC's own view of the tunnel it (may have) started. */
  private publicView(): LanPublic {
    return { ws_url: this.tunnelWsUrl, status: this.tunnelStatus, provider: this.tunnelProvider, available: this.tunnelAvailable, error: this.tunnelError };
  }
  /** A28.2: the LAN URL first, the join secret always, the public URL only while the tunnel is up. */
  private joinQr(): string {
    const base = `ws://192.168.8.10:8765/ws?s=${this.joinSecret}`;
    return this.tunnelStatus === 'up' && this.tunnelWsUrl ? `${base}&pub=${encodeURIComponent(this.tunnelWsUrl)}` : base;
  }
  /** A28.4: derived from the nodes' own reach, never asserted. A node with no player_id is not
   *  "bound" — an unclaimed phone joining over backhaul does not move the needle. */
  private coverage(nodes: Pick<NodeView, 'player_id' | 'reach'>[]): Coverage {
    const bound = nodes.filter(n => n.player_id).length;
    const on_backhaul = nodes.filter(n => n.player_id && n.reach === 'backhaul').length;
    return { level: bound > 0 && on_backhaul === bound ? 'full' : 'zones', on_backhaul, bound };
  }

  private state(): State {
    const t = now();
    const readiness = this.readiness();
    // A28.3: half the demo's connected nodes report backhaul once the tunnel is up (and only then —
    // a node cannot be on a path that does not exist), so `?mock` can show a mixed LAN/BACKHAUL board.
    const nodes = readiness.board.filter(b => b.node === 'linked' && !this.evicted.has(`node_${b.tail}`)).map((b, i) => ({
      node_id: `node_${b.tail}`, node_type: 'phone', gun_name: `${b.sticker}-${b.tail}`, gun_tail: b.tail,
      player_id: b.player_id, arm_state: this.armStateFor(b.player_id), last_seen_ms: b.last_seen_ms ?? 0,
      synced: true, battery: b.battery_pct, fw: b.fw,
      reach: (this.tunnelStatus === 'up' && i % 2 === 0 ? 'backhaul' : 'lan') as 'lan' | 'backhaul',
    }));
    const kitted = this.players.filter(p => PLAYERS.find(x => x[0] === p.display)?.[3] === 'kitted' || (p.player_id in this.acks)).length;
    return {
      session_id: this.session_id, phase: this.phase, t,
      lan: {
        mode: 'router', ssid: 'BRX-FIELD', ip: '192.168.8.10', port: 8765, ws_url: 'ws://192.168.8.10:8765/ws',
        qr: this.joinQr(), join_secret: this.joinSecret, public: this.publicView(),
      },
      coverage: this.coverage(nodes),
      // The demo mirrors the server's own `SETUP: ` warning for a grenade objective (compile.py validate),
      // so the KotH rail in `?mock` shows the same field step the real MC does.
      nodes, readiness, config: clone(this.config), config_errors: [...this.cfgErrors],
      stations: this.stationViews(), game_no: this.gameNo,
      config_warnings: [
        ...(SETUP_WARNING[this.config.station_source ?? ''] ? [SETUP_WARNING[this.config.station_source ?? '']] : []),
        // mirrors Session._station_warnings(): a station-gated rule with nothing assigned in ITEMS
        ...(this.config.station_source === 'phone' && !Object.values(this.stations).some(s => s.assigned?.kind === 'control')
          ? ["SETUP: NO CONTROL-POINT PHONE IS ASSIGNED — this game's objective is a phone (station_source phone); assign a utility phone as CONTROL in ITEMS and arm it, or nothing on the field is the hill"] : []),
        ...(this.config.respawn.type === 'scanner' && !Object.values(this.stations).some(s => s.assigned?.kind === 'respawn')
          ? ['SETUP: NO RESPAWN STATION IS ASSIGNED — respawn is SCANNER, so a downed player can only come back at a station; assign a utility phone as RESPAWN in ITEMS and arm it'] : []),
      ],
      players: clone(this.players), teams: clone(TEAMS),
      kit: { kitted, total: this.players.length, trying: { ...this.trying }, browsing: { ...this.browsing } },
      loadout_pool: this.pool(),
      active_preset_id: this.activePreset,
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
  private pool() { return poolOf(this.config.loadout_policy, WEAPONS, PERKS); }
  /** server `apply_policy()` — every player's kit brought into compliance with the current rules */
  private applyPolicy() {
    const pl = this.pool();
    for (const p of this.players) {
      const next = applyPolicy(this.config.loadout_policy, p.loadout, pl, PERKS);
      if (JSON.stringify(next) !== JSON.stringify(p.loadout)) { p.loadout = next; delete this.trying[p.player_id]; }
    }
  }
  private emit() { const s = this.state(); this.subs.forEach(x => x.snap(s)); }
  private feed(e: FeedEntry) { this.live_?.feed.unshift(e); this.subs.forEach(x => x.feed(e)); }

  // ---------- simulation tick ----------
  private tick() {
    const t = now();
    for (const [pid, at] of Object.entries(this.browsing)) if (t - at > 60_000) delete this.browsing[pid];
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
    // Roadmap A6: mirror `Session._recap_stations()` -- one row per ASSIGNED station, straight from its
    // own report, so ?mock's RECAP screen can demo the STATIONS block with no server at all.
    const stationRows: RecapStationRow[] = this.stationViews().filter(s => s.assigned).map(s => {
      const a = s.assigned!;
      const heard = Object.keys(s.report ?? {}).length > 0;   // F105: same test as `_recap_stations()` -- any heartbeat at all
      const row: RecapStationRow = { node_id: s.node_id, kind: a.kind, id: a.id, team: a.team, heard };
      if (a.kind === 'respawn') row.revives = s.report.revives ?? null;
      else if (a.kind === 'control' && s.report.control) { row.hold_ms = s.report.control.hold_ms ?? null; row.owner = s.report.control.owner ?? null; }
      return row;
    });
    this.recap_ = { winner: ffa ? { player_id: top.player_id } : { team_id: winnerTeam }, score, rows, honors, provisional: missing.length > 0, missing,
                    ...(stationRows.length ? { stations: stationRows } : {}) };
    // the demo keeps its own history, exactly as the server's session store does — without it the
    // RECAP history picker and the per-match CSV had no way to be seen (let alone tested) in ?mock
    this.history_.unshift({ match_id: l.match_id, mode: this.config.mode, go_live_t: l.go_live_t,
                            ended_t: now(), recap: clone(this.recap_) });
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
  async setPhase(phase: string) { this.phase = phase as Phase; this.emit(); return {}; }
  async armory() { return GUNS.map(([s, tail]) => ({ gun_id: s, sticker: s, ble: { tail } })); }
  async getVoices() { return { default: 'male', voices: [{ id: 'male', name: 'MALE', family: 'VA', kill_line: 'VAA', verified: false }] }; }
  async getModes(): Promise<ModeInfo[]> { return clone(MODES); }
  async getWeapons(): Promise<WeaponView[]> { return clone(WEAPONS); }
  async getPerks(): Promise<PerkView[]> { return clone(PERKS.filter(k => !k.hidden)); }
  async getPresets(): Promise<SavedGame[]> { return clone(this.presets); }
  async savePreset(p: { name: string; desc?: string; config?: GameConfig; replace?: boolean }): Promise<SavedGame> {
    const name = p.name.trim(); if (!name) throw new Error('Give the game a name');
    const clash = this.presets.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (clash?.builtin) throw new Error(`"${clash.name}" is a built-in game — pick another name`);
    if (clash && !p.replace) throw new Error(`A saved game called "${clash.name}" already exists`);
    const { config_id: _cid, ...cfg } = clone(p.config ?? this.config); void _cid;
    const t = now();
    const sg: SavedGame = { preset_id: clash?.preset_id ?? uid('preset'), name, desc: p.desc ?? clash?.desc ?? '', builtin: false, created_t: clash?.created_t ?? t, updated_t: t, config: { ...cfg, config_id: '' } };
    this.presets = [...this.presets.filter(x => x !== clash), sg];
    return clone(sg);
  }
  async deletePreset(id: string) {
    const sg = this.presets.find(x => x.preset_id === id); if (!sg) throw new Error('no such saved game');
    if (sg.builtin) throw new Error('Built-in games cannot be deleted');
    this.presets = this.presets.filter(x => x !== sg);
    if (this.activePreset === id) { this.activePreset = null; this.emit(); }
  }
  async updatePreset(id: string, p: { name?: string; desc?: string; config?: GameConfig }): Promise<SavedGame> {
    const sg = this.presets.find(x => x.preset_id === id); if (!sg) throw new Error('no such saved game');
    if (sg.builtin) throw new Error('Built-in games cannot be edited — save a copy under your own name');
    if (p.name != null) {
      const nm = p.name.trim(); if (!nm) throw new Error('Give the game a name');
      const clash = this.presets.find(x => x !== sg && x.name.toLowerCase() === nm.toLowerCase());
      if (clash) throw new Error(`A saved game called "${clash.name}" already exists`);
      sg.name = nm;
    }
    if (p.desc != null) sg.desc = p.desc;
    if (p.config) { const { config_id: _c, ...cfg } = clone(p.config); void _c; sg.config = { ...cfg, config_id: '' } as GameConfig; }
    sg.updated_t = now();
    return clone(sg);
  }
  /** A11: the demo's presentation profile — a few representative rows so the ADVANCED view has something to show. */
  async getPresentation() {
    const rows = [
      { event: 'hit_taken', source: 'hud', desc: 'you were hit', sound: null, words: '', gun_led: 0, headset: null, text: '', enabled: true },
      { event: 'died', source: 'hud', desc: 'you are out', sound: null, words: '', gun_led: 0, headset: null, text: '', enabled: true },
      { event: 'time_60', source: 'hud', desc: 'one minute left', sound: 'V113', words: 'One minute left.', gun_led: null, headset: null, text: 'ONE MINUTE LEFT', enabled: true },
      { event: 'kill', source: 'mc', desc: 'you scored a kill', sound: 'voice:kill', words: "the player's own voice: kill line", gun_led: null, headset: null, text: '', enabled: true },
      { event: 'first_blood', source: 'mc', desc: 'first kill of the match', sound: 'VA7H', words: 'First Blood', gun_led: null, headset: null, text: 'FIRST BLOOD', enabled: true },
      { event: 'lead_taken', source: 'mc', desc: 'your team takes the lead', sound: 'VA6D', words: 'Your team takes the lead.', gun_led: null, headset: null, text: 'YOUR TEAM TAKES THE LEAD', enabled: true },
      { event: 'infected', source: 'both', desc: 'a survivor turned (infection)', sound: 'VB1M', words: 'The infection is spread.', gun_led: null, headset: null, text: 'THE INFECTION SPREADS', enabled: true },
    ] as const;
    return {
      summary: { preset: 'standard', announcer: true, gun_flash: true, headset_team: true, sight_flash: true, hud_events: true, mc_events: true, mc_confidence: true, custom_events: [] as string[],
        headset: { pregame: 'team', start_flash: true, in_play: 'dark', hit: 0, death: 'native', respawn_flash: true, carrier: true } },
      events: rows.map(r => ({ ...r })),
      mc_confidence: { confident: false, missing: ['p-demo-2'], stale: [] as string[], unflushed: [] as string[] },
      presets: ['counter_strike', 'extraction', 'infection', 'last_stand', 'silenced', 'standard', 'vip'],
    };
  }

  async previewPool(policy: Partial<LoadoutPolicy>, mode?: string) {
    const base = policy.preset && policy.preset !== 'custom' ? clone(PRESETS[policy.preset]) : clone(defaultPolicy(mode ?? this.config.mode));
    const merged: LoadoutPolicy = { ...base, ...policy, primary: { ...base.primary, ...(policy.primary ?? {}) }, secondary: { ...base.secondary, ...(policy.secondary ?? {}) }, perk: { ...base.perk, ...(policy.perk ?? {}) } };
    merged.preset = policy.preset === 'custom' ? 'custom' : presetOf(merged);
    return { policy: merged, pool: poolOf(merged, WEAPONS, PERKS) };
  }
  async applyPreset(id: string) {
    const sg = this.presets.find(x => x.preset_id === id); if (!sg) throw new Error('no such saved game');
    const { config_id: _cid, loadout_policy, ...rest } = clone(sg.config); void _cid;
    const r = await this.putConfig({ ...rest, loadout_policy: { ...loadout_policy, preset: presetOf(loadout_policy) } });   // the name is re-derived, like the server
    this.activePreset = id; this.emit();
    return r;
  }
  async putConfig(partial: Partial<GameConfig>) {
    const prevMode = this.config.mode, prevPol = this.config.loadout_policy;
    // F70: `station_source` is a CLOSED vocabulary server-side (state.py _merge_config raises, the API
    // answers 400 naming every legal value). The demo refuses the same way, so the OBJECTIVE SOURCE
    // control cannot look more permissive in `?mock` than it is against a real MC.
    if ('station_source' in partial && partial.station_source != null && !MOCK_STATION_SOURCES.some(s => s.value === partial.station_source)) {
      throw new Error('station_source must be null or one of: '
        + MOCK_STATION_SOURCES.map(s => `${s.value} (${s.desc})`).join(', '));
    }
    if (Object.keys(partial).some(k => !['environment', 'night', 'config_id'].includes(k))) this.activePreset = null;   // a real edit: no longer that saved game
    this.config = { ...this.config, ...partial, config_id: uid('cfg') };
    if (partial.loadout_policy) {
      // mirrors policy.merge (A10 §3): a preset NAME rewrites the rules, then any slot/hud_select keys in the same
      // patch merge on top, then the name is re-derived (custom if nothing matches)
      const lp = partial.loadout_policy as Partial<typeof prevPol>;
      const base = lp.preset && lp.preset !== 'custom' ? clone(PRESETS[lp.preset]) : clone(prevPol);
      if (lp.primary) base.primary = { ...base.primary, ...lp.primary };
      if (lp.secondary) base.secondary = { ...base.secondary, ...lp.secondary };
      if (lp.perk) base.perk = { ...base.perk, ...lp.perk };
      if (lp.hud_select != null) base.hud_select = lp.hud_select;
      base.preset = lp.preset === 'custom' ? 'custom' : presetOf(base);
      this.config.loadout_policy = base;
    }
    // The real server rebuilds the config from `default_config(mode)` whenever the MODE changes, so a
    // key belonging to the old mode cannot survive the switch. `station_source` is the one such key
    // today (F70: only the objective modes have one) — leaving a stale 'grenade' on a TDM game would
    // show the demo a hill setup step the real MC would never send.
    if (partial.mode && partial.mode !== prevMode && partial.station_source === undefined) {
      const src = MODES.find(m => m.mode === partial.mode)?.defaults.station_source;
      if (src) this.config.station_source = src; else delete this.config.station_source;
    }
    // 🔴 The real server re-teams anyone left on a team the new mode does not have
    // (state.py set_config: `p["team_id"] = self.teams[0]["team_id"]`). The demo used to skip this, so
    // `?mock` showed a KING OF THE HILL roster still half YELLOW — the exact $TID 2 the server refuses
    // (F82) and the one thing this screen must never appear to allow. A demo that predicts the wrong
    // state is worse than no demo: it is where a "verified" screenshot comes from.
    const legal = new Set(this.config.teams.map(t => t.team_id));
    for (const p of this.players) if (!legal.has(p.team_id ?? '')) p.team_id = this.config.teams[0]?.team_id ?? null;
    this.applyPolicy();
    const errors: string[] = [];
    if (this.config.time_limit_s == null || this.config.time_limit_s <= 0) errors.push('time_limit_s is required on the phone path');
    if (MODES.find(m => m.mode === this.config.mode)?.defaults.station_source && !this.config.station_source) {
      errors.push(`mode '${this.config.mode}' needs a station/objective source (Tier 1) — set config.station_source to one of: `
        + MOCK_STATION_SOURCES.map(x => `'${x.value}' (${x.desc})`).join(', '));
    }
    if (this.config.mode === 'ffa') { const t = this.config.teams[0]; if (t) for (const p of this.players) p.team_id = t.team_id; }
    if (this.pushed) { this.pushed = false; this.acks = {}; }
    this.cfgErrors = errors;
    this.emit();
    return { ok: errors.length === 0, errors, config: clone(this.config) };
  }
  async addPlayer(p: { display: string; team_id?: string; gun_id?: string; voice?: string }): Promise<Player> {
    const used = new Set(this.players.map(x => x.player_num));
    let n = 1; while (used.has(n)) n++;
    const pl: Player = { player_id: uid('p'), player_num: n, display: p.display.toUpperCase(), team_id: p.team_id ?? null, node_id: null,
      gun_id: p.gun_id ?? null, loadout: applyPolicy(this.config.loadout_policy, { weapons: [{ weapon_id: 'assault_rifle' }], perk: null }, this.pool(), PERKS), voice: p.voice ?? 'male', ready: false };
    this.players.push(pl); this.emit(); return clone(pl);
  }
  async patchPlayer(id: string, patch: Partial<Player>): Promise<Player> {
    const p = this.players.find(x => x.player_id === id); if (!p) throw new Error('no such player');
    if (patch.player_num != null) {
      if (patch.player_num < 1 || patch.player_num > 63) throw new Error('player_num must be 1–63');
      if (this.players.some(x => x !== p && x.player_num === patch.player_num)) throw new Error('player_num in use');
    }
    if (patch.loadout) {
      const lo = patch.loadout, pol = this.config.loadout_policy, pl = this.pool();
      if (!lo.weapons?.length) throw new Error('A primary weapon is required');
      const r0 = reject(pol, pl, 'primary', 'weapon', lo.weapons[0].weapon_id, true);
      if (r0 && lo.weapons[0].weapon_id !== p.loadout.weapons[0]?.weapon_id) throw new Error(r0);
      const secId = lo.weapons[1]?.weapon_id ?? null;
      const r1 = reject(pol, pl, 'secondary', secId ? 'weapon' : 'none', secId, true);
      if (r1 && secId !== (p.loadout.weapons[1]?.weapon_id ?? null)) throw new Error(r1);
      const perkId = lo.perk ?? null;                                     // A14: the perk is its own slot
      const r2 = reject(pol, pl, 'perk', perkId ? 'perk' : 'none', perkId, true);
      if (r2 && perkId !== (p.loadout.perk ?? null)) throw new Error(r2);
      if (conflict(lo, PERKS)) throw new Error(`${PERKS.find(k => k.perk_id === lo.perk)?.name ?? lo.perk} takes the ALT button, so it can't ride with a second weapon`);
    }
    Object.assign(p, patch);
    if (patch.loadout) delete this.trying[id];
    this.emit(); return clone(p);
  }
  async deletePlayer(id: string) { this.players = this.players.filter(p => p.player_id !== id); this.emit(); }
  async evictNode(id: string) { this.evicted.add(id); this.emit(); }
  /** A28.1: `POST /api/tunnel {on}` — mirrors the real MC: `on:true` answers `starting` at once and
   *  flips to `up` with a fresh fake hostname after a beat; `on:false` is immediate. 409s the same
   *  way the server does when the demo has been told to pretend the binary is missing or the tunnel
   *  is a manual (`--public-url`) one — nothing here is MC's to stop in that case. */
  async setTunnel(on: boolean): Promise<LanPublic> {
    if (!this.tunnelAvailable) {
      throw Object.assign(new Error('cloudflared was not found on PATH — install it: brew install cloudflared (mac) / winget install Cloudflare.cloudflared (windows) / apt install cloudflared (linux)'), { status: 409 });
    }
    if (this.tunnelProvider === 'manual') {
      throw Object.assign(new Error("this MC was started with --public-url — the tunnel is not MC's to stop from here"), { status: 409 });
    }
    if (this.tunnelTimer) { window.clearTimeout(this.tunnelTimer); this.tunnelTimer = null; }
    if (on) {
      if (this.tunnelStatus === 'up' || this.tunnelStatus === 'starting') return this.publicView();   // idempotent, like the server
      this.tunnelStatus = 'starting'; this.tunnelError = undefined; this.emit();
      this.tunnelTimer = window.setTimeout(() => {
        if (this.tunnelFailNext) {
          this.tunnelFailNext = false;
          this.tunnelStatus = 'error'; this.tunnelWsUrl = null;
          this.tunnelError = 'cloudflared exited before printing a trycloudflare.com hostname (connect: network is unreachable)';
        } else {
          this.tunnelStatus = 'up';
          this.tunnelWsUrl = `wss://${Math.random().toString(36).slice(2, 10)}.trycloudflare.com/ws`;
        }
        this.emit();
      }, 1000);
    } else {
      this.tunnelStatus = 'off'; this.tunnelWsUrl = null; this.tunnelError = undefined; this.emit();
    }
    return this.publicView();
  }
  private verdicts: Record<string, { weapon_id: string; verdict: 'pass' | 'issue'; note: string; t: number }> = {};
  async rangeVerdicts() { return { ...this.verdicts }; }
  async rangeVerdict(weapon_id: string, verdict: 'pass' | 'issue', note = '') { const r = { weapon_id, verdict, note, t: Date.now() }; this.verdicts[weapon_id] = r; return r; }

  async tryout(id: string, weapon_id: string) {
    if (this.pushed) throw new Error('try-outs are disabled once a config head has been pushed (modes.md §4)');
    this.trying[id] = weapon_id; this.emit();
  }
  async endTryout(id: string) { delete this.trying[id]; this.emit(); }
  async setReady(id: string, ready: boolean) {
    const p = this.players.find(x => x.player_id === id)!; p.ready = ready;
    if (ready) { delete this.trying[id]; delete this.browsing[id]; }
    if (this.phase === 'kit' && this.players.length && this.players.every(x => x.ready)) this.phase = 'lobby';
    this.emit(); return clone(p);
  }
  async pushLobby(force?: boolean) {
    if (!this.readiness().go && !force) throw new Error('readiness has reds — clear them before pushing, or push with force');
    if (this.gameStarted) { this.gameNo = (this.gameNo % 255) + 1; this.gameStarted = false; }   // a new match to every station
    for (const n of Object.keys(this.stations)) this.armStation(n);
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
  async start(runway_s: number, _force?: boolean) {
    if (!this.pushed) throw new Error('push config first');
    this.gameStarted = true;
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
  async matchHistory() { return clone(this.history_); }
  async getRecap() { if (!this.recap_) throw new Error('no recap yet'); return clone(this.recap_); }
  recapCsvUrl() { return this.csvOf(this.recap_); }
  matchCsvUrl(match_id: string) { return this.csvOf(this.history_.find(h => h.match_id === match_id)?.recap ?? undefined); }
  private csvOf(r?: RecapView) {
    if (!r) return '#';
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
  dispose() { if (this.timer) window.clearInterval(this.timer); if (this.tunnelTimer) window.clearTimeout(this.tunnelTimer); }
}
