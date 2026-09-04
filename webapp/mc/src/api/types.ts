// Mirrors mcp/brx_mcp/mc/API.md + types.py (contracts A5). Keep field names identical.

export type Phase = 'muster' | 'build' | 'kit' | 'lobby' | 'armed' | 'live' | 'recap';
export type ArmState = 'idle' | 'connected' | 'kitted' | 'lobby' | 'armed' | 'live';

export interface WeaponSel { weapon_id: string }
/** contracts A9 / docs/spec/loadout.md §2 — weapons[] is canonical: [primary] or [primary, secondary]; `perk` excludes a secondary weapon. */
export interface Loadout { weapons: WeaponSel[]; perk?: string | null; overrides?: { max_hp?: number; max_armor?: number } }

export type SlotChoice = 'player' | 'host' | 'fixed' | 'off';
export type ItemKind = 'weapon' | 'perk' | 'sidearm';   // 'sidearm' (A12): a policy kind — only the pistols; never a request kind (a pistol is a 'weapon' on the wire)
export interface SlotRule {
  choice: SlotChoice; kinds: ItemKind[];
  exclude_tags: string[]; exclude_ids: string[]; only_ids: string[];
  fixed_id?: string | null;
}
export type LoadoutPreset = 'open' | 'no_heavies' | 'snipers' | 'custom';
export interface LoadoutPolicy { preset: LoadoutPreset; hud_select: boolean; primary: SlotRule; secondary: SlotRule }
/** allowed ids per slot, catalog order — computed server-side (loadout.md §3.2) */
export interface LoadoutPool { primary: string[]; secondary_weapons: string[]; secondary_perks: string[] }

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
  loadout_policy: LoadoutPolicy;
  /** A11: sounds + lights per event (preset or custom). Optional — an older server never sends it. */
  presentation?: Record<string, unknown>;
}

/** A11/A11.5 — one row of the resolved presentation profile (GET /api/presentation). */
export interface PresentationRow {
  event: string; source: 'hud' | 'mc' | 'both'; desc: string;
  sound: string | null; words: string; gun_led: number | null; headset: number | null;
  text: string; enabled: boolean;
}
export interface PresentationView {
  summary: { preset: string; announcer: boolean; gun_flash: boolean; headset_team: boolean; sight_flash: boolean;
    hud_events: boolean; mc_events: boolean; mc_confidence: boolean; custom_events: string[];
    /** A11.6 headset block: pregame team|off · start_flash · in_play dark|team · hit colour|null · death native|colour · respawn_flash · carrier */
    headset?: { pregame: string; start_flash: boolean; in_play: string; hit: number | null; death: string | number; respawn_flash: boolean; carrier: boolean };
    /** A11.7 gun body block: in_play native (firmware breathing) | team | dark | health */
    gun?: { in_play: string } };
  events: PresentationRow[];
  mc_confidence: { confident: boolean; missing: string[]; stale: string[]; unflushed: string[] };
  presets: string[];
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
  /** `waiting` = no phone yet. Blocks the start like `red`, but it is NOT a fault — render it
   *  as inactive, never as an error (field 2026-09-01). */
  status: 'green' | 'amber' | 'red' | 'waiting';
  blockers: string[];   // things that actually gate the start
  ambers?: string[];    // advisories — never gate anything
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
  kit: { kitted: number; total: number; trying: Record<string, string>; browsing: Record<string, number> };
  loadout_pool: LoadoutPool;
  active_preset_id?: string | null;   // the saved game that was applied (null after any real config edit)
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
  /** seconds, or **null** when the weapon has no reload time — render `—`, never `0.0` and never a
   *  bare unit. `views.weapon_view` returns null deliberately (a confident "RELOAD 0.0S" was wrong);
   *  the type said `number` so nothing flagged the screens that did not handle it (merge 2026-09-01). */
  reload_s: number | null;
  dmg: number; rpm: number; rng: number; verified: boolean;
  desc?: string;
  role: string;        // assault | cqb | marksman | support | power — the human class label
  tags: string[];      // heavy | sniper | … — what loadout rules match on
  htk?: number;        // hits to kill AT `pool` — replaces the RANGE bar (t41 is 75 on every gun)
  ttk_ms?: number;     // time to kill in ms at `pool`; null when it cannot be derived
  dmg_per_hit?: number;   // the REAL per-hit damage, independent of the pool (`dmg` is its share of the 115 default)
  /** hp + armour htk/ttk_ms are quoted against — the HOST'S health config, not a constant. Show it
   *  next to either number: at a 100/100 game the AR needs 23 hits, not the 13 it needs at 45/70. */
  pool?: number;
  ammo_total?: number;    // clip + reserve
  /** 0-100 meters ranked ACROSS the arsenal (views.weapon_views). Raw stats do not make usable bars —
   *  see the note there. `ttk` is inverted: a faster kill is a longer bar. No range bar: t41 is
   *  identical on all 18 guns, so it measured nothing. */
  bars?: { power: number | null; rof: number | null; ammo: number | null; ttk: number | null };
  caution?: string;    // human copy for a weapon with a known live problem (energy_launcher: zero damage in the shipped $SIR row)
}

export interface PerkView {
  perk_id: string; name: string; desc: string; tags: string[];
  mechanism: 'passive' | 'slot_frame';
  effects: { max_armor_add?: number; ammo_mult?: number; reload_mult?: number; alt_reload?: boolean };
  verified: boolean; hidden?: boolean;
}

/** loadout.md §8 — a whole GameConfig saved under a name on the MC host ("mode creation"). */
export interface SavedGame {
  preset_id: string; name: string; desc: string; builtin: boolean;
  created_t: number; updated_t: number;
  config: GameConfig;
  weapon_tuning?: Record<string, unknown>;   // RESERVED — future weapon-tuning spec
}

/** The surface both the real client and the in-browser mock implement. */
export interface Api {
  getState(): Promise<State>;
  subscribe(onSnapshot: (s: State) => void, onFeed: (e: FeedEntry) => void, onLink?: (connected: boolean) => void): () => void;
  scan(duration_s?: number): Promise<ScanRow[]>;
  armory(): Promise<{ gun_id: string; sticker: string; ble: { tail?: string } }[]>;
  setPhase(phase: string): Promise<unknown>;
  getModes(): Promise<ModeInfo[]>;
  getVoices(): Promise<VoiceList>;
  getWeapons(): Promise<WeaponView[]>;
  getPerks(): Promise<PerkView[]>;
  getPresets(): Promise<SavedGame[]>;
  savePreset(p: { name: string; desc?: string; config?: GameConfig; replace?: boolean }): Promise<SavedGame>;
  deletePreset(id: string): Promise<void>;
  applyPreset(id: string): Promise<{ ok: boolean; errors: string[]; config: GameConfig }>;
  updatePreset(id: string, p: { name?: string; desc?: string; config?: GameConfig }): Promise<SavedGame>;
  /** preview the pool a DRAFT policy would allow (designer) — same rule engine, nothing applied */
  previewPool(policy: Partial<LoadoutPolicy>, mode?: string): Promise<{ policy: LoadoutPolicy; pool: LoadoutPool }>;
  /** A11: tonight's presentation profile, resolved, for the read-only ADVANCED view. Rejects with status 404 on an older server. */
  getPresentation(): Promise<PresentationView>;
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
  pushLobby(force?: boolean): Promise<{ ok: boolean; acks: State['lobby']['acks'] }>;
  start(runway_s: number, force?: boolean): Promise<{ match_id: string; go_live_t: number; seq: number }>;
  reschedule(runway_s: number): Promise<{ match_id: string; go_live_t: number; seq: number }>;
  abort(): Promise<{ ok: boolean; reached: string[]; unreachable: string[] }>;
  /** `reached` = how many nodes the broadcast actually landed on, out of `nodes` bound. A control
   *  that reaches nobody used to report plain success (field 2026-09-01). */
  control(cmd: 'end' | 'recall' | 'panic', confirm?: boolean): Promise<{ ok: boolean; reached?: number; nodes?: number }>;
  getRecap(): Promise<RecapView>;
  matchHistory(): Promise<MatchHistoryRow[]>;
  recapCsvUrl(): string;
  /** an ARCHIVED match's stats table — `recapCsvUrl` only ever serves the LIVE scorer (W1/F6) */
  matchCsvUrl(match_id: string): string;
  newSession(keep_roster: boolean): Promise<State>;
}

/** One finished match from MC's session store — the RECAP screen's history picker (A8). */
export interface MatchHistoryRow {
  match_id: string;
  mode: string;
  go_live_t: number | null;
  ended_t: number | null;
  recap: RecapView | null;
  /** The full GameConfig the match actually ran with, plus `_heads`: the compiled head frames pushed
   *  to each player. The frames are the ground truth — a setting can be misread, a token cannot. */
  config?: Record<string, unknown> & { _heads?: Record<string, string[]> };
}

/** Selectable voice personas. `$PSET`'s trailing tokens are a positional voice pack; only HEAVY is
 *  confirmed by ear, the rest are inferred from the pack layout (see gameconfig.VOICE_PACKS). */
export interface VoiceList {
  default: string;
  voices: { id: string; name: string; family: string; kill_line: string; verified: boolean }[];
}
