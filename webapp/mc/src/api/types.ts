// Mirrors mcp/brx_mcp/mc/API.md + types.py (contracts A5). Keep field names identical.

export type Phase = 'muster' | 'build' | 'kit' | 'lobby' | 'armed' | 'live' | 'recap';
export type ArmState = 'idle' | 'connected' | 'kitted' | 'lobby' | 'armed' | 'live';

export interface WeaponSel { weapon_id: string }
export interface Loadout { weapons: WeaponSel[]; overrides?: { max_hp?: number; max_armor?: number } }

export interface Team { team_id: string; name: string; color: string; tid: number }

export interface Player {
  player_id: string;
  player_num: number; // 1..63 on the wire; 0 reserved
  display: string;
  team_id: string | null;
  node_id: string | null;
  gun_id: string | null;
  loadout: Loadout;
  voice: string;
  ready: boolean;
}

export interface Respawn { type: 'auto' | 'scanner' | 'none'; delay_s: number }
export interface Scoring { frag_limit: number | null; win_by: string }
export interface Health { max_hp: number; max_armor: number }

export interface GameConfig {
  config_id: string;
  mode: string;
  environment: 'indoor' | 'outdoor';
  night: boolean;
  time_limit_s: number | null;
  respawn: Respawn;
  scoring: Scoring;
  health: Health;
  teams: Team[];
  led?: Record<string, unknown>;
}

export interface ScanRow {
  tail: string; name: string; basename: string; gun_id: string | null; rssi: number;
  identity: 'ok' | 'unconfirmed' | 'reverted' | 'unknown'; t: number;
}

export interface ArmoryRecord {
  gun_id: string; sticker: string; headset_pin: string;
  ble: { address?: string; uuid?: string; tail: string };
  gen: 'gen2_3' | 'gen1'; fw: string | null; labeled: boolean; notes?: string;
}

export interface Preflight {
  ssid_ok?: boolean; mc_reachable?: boolean; auto_join_ok?: boolean; cellular_off?: boolean;
  dnd_on?: boolean; phone_batt?: number; screen_on?: boolean; foreground?: boolean;
  gun_linked?: boolean; headset_ok?: boolean;
}

export interface ReadinessRow {
  gun_id?: string; sticker: string; tail: string; player_id?: string; player_num?: number;
  present: boolean;
  identity: 'ok' | 'unconfirmed' | 'reverted' | 'unknown' | 'manual';
  node: 'none' | 'linked';
  headset: 'proven' | 'unknown' | 'absent';
  battery_pct?: number; battery_age_ms?: number; fw?: string; phone_batt?: number;
  last_seen_age_ms?: number | null;
  gun_linked?: boolean | null;
  ssid_ok?: boolean; mc_reachable?: boolean; synced?: boolean; screen_on?: boolean; foreground?: boolean;
  last_seen_ms?: number;
  status: 'green' | 'amber' | 'red';
  blockers: string[];
}

export interface ReadinessSnapshot {
  t: number; roster_size: number; greens: number; board: ReadinessRow[]; unclaimed: ScanRow[]; go: boolean;
}

export interface ScoreRow {
  player_id: string; display: string; team_id: string | null;
  kills: number; deaths: number; assists: number; shots: number; hits: number;
  accuracy: number | null; kd: number; streak: number; medals: string[];
}

export interface NodeView {
  node_id: string; node_type: string; gun_name?: string; gun_tail?: string; player_id?: string;
  arm_state: ArmState; last_seen_ms: number; synced: boolean; preflight?: Preflight;
  battery?: number; fw?: string; hp?: number; armor?: number; ammo?: number; alive?: boolean;
  pending?: number | null;
}

export type LiveRow = ScoreRow & {
  status: 'alive' | 'down' | 'stale';
  respawn_in_s?: number;
  sync_age_ms: number;
};

export interface LiveView {
  match_id: string; go_live_t: number; time_limit_s: number; ends_t: number;
  score: Record<string, number>; rows: LiveRow[];
}

export interface Honor { award: string; player_id: string; stat: string }

export interface RecapView {
  winner: { team_id?: string | null; player_id?: string; undecided?: string; tie?: string[] };   // team / FFA player / undecided (win_by) / tie
  score: Record<string, number>;
  rows: ScoreRow[];
  honors: Honor[];
  provisional: boolean;
  missing: string[];
}

export type FeedTag = 'DOUBLE KILL' | 'TRIPLE KILL' | `STREAK ×${number}` | 'FIRST BLOOD' | 'TEAM KILL' | 'SYNC POINT';
export interface FeedEntry { t_match_s: number; text: string; tag?: FeedTag; kind: 'kill' | 'sync' | 'info' }

export interface StartView {
  match_id: string; go_live_t: number; seq: number; countdown_s: number;
  per_node: Record<string, { arm_state: ArmState; t_minus_ms?: number; synced: boolean; last_seen_ms: number }>;
}

export interface State {
  session_id: string;
  phase: Phase;
  t: number;
  lan: { mode: 'router' | 'hotspot' | 'unknown'; ssid?: string; ip: string; port: number; ws_url: string; qr: string; auth_required?: boolean };
  nodes: NodeView[];
  readiness: ReadinessSnapshot;
  config: GameConfig;
  config_errors: string[];
  config_warnings?: string[];
  players: Player[];
  teams: Team[];
  kit: { kitted: number; total: number; trying: Record<string, string> };
  lobby: { ready: number; total: number; pushed: boolean; acks: Record<string, { ok: boolean; gun_echo?: string; err?: string }> };
  start?: StartView;
  live?: LiveView;
  recap?: RecapView;
}

export interface ModeInfo {
  mode: string; name: string; abbr: string; desc: string; brief: string;
  teams_text: string; win_text: string; respawn_text: string; defaults: GameConfig;
}

export interface WeaponView {
  weapon_id: string; name: string; cls: string; clip: number; mags: number; reserve: number;
  reload_s: number; dmg: number; rpm: number; rng: number; verified: boolean;
  desc?: string;
}

/** The surface both the real client and the in-browser mock implement. */
export interface Api {
  getState(): Promise<State>;
  subscribe(onSnapshot: (s: State) => void, onFeed: (e: FeedEntry) => void, onLink?: (connected: boolean) => void): () => void;
  scan(duration_s?: number): Promise<ScanRow[]>;
  armory(): Promise<{ gun_id: string; sticker: string; ble: { tail?: string } }[]>;
  setPhase(phase: string): Promise<unknown>;
  getModes(): Promise<ModeInfo[]>;
  getWeapons(): Promise<WeaponView[]>;
  putConfig(partial: Partial<GameConfig>): Promise<{ ok: boolean; errors: string[]; config: GameConfig }>;
  addPlayer(p: { display: string; team_id?: string; gun_id?: string; voice?: string }): Promise<Player>;
  patchPlayer(id: string, patch: Partial<Player>): Promise<Player>;
  deletePlayer(id: string): Promise<void>;
  evictNode(node_id: string): Promise<void>;   // DELETE /api/nodes/{id} — operator kick (closes 4000, unbinds, rotates key)
  tryout(id: string, weapon_id: string): Promise<void>;
  rangeVerdicts(): Promise<Record<string, { weapon_id: string; verdict: 'pass' | 'issue'; note: string; t: number }>>;
  rangeVerdict(weapon_id: string, verdict: 'pass' | 'issue', note?: string): Promise<unknown>;
  endTryout(id: string): Promise<void>;
  setReady(id: string, ready: boolean): Promise<Player>;
  pushLobby(): Promise<{ ok: boolean; acks: State['lobby']['acks'] }>;
  start(runway_s: number): Promise<{ match_id: string; go_live_t: number; seq: number }>;
  reschedule(runway_s: number): Promise<{ match_id: string; go_live_t: number; seq: number }>;
  abort(): Promise<{ ok: boolean; reached: string[]; unreachable: string[] }>;
  control(cmd: 'end' | 'recall' | 'panic', confirm?: boolean): Promise<{ ok: boolean }>;
  getRecap(): Promise<RecapView>;
  recapCsvUrl(): string;
  newSession(keep_roster: boolean): Promise<State>;
}
