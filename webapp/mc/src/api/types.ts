// The server⇒UI contract. The WIRE shapes are NOT written here: they are GENERATED from the one
// Python source (`mcp/brx_mcp/mc/types.py` + `envelope.py`) into `./contract.gen.ts` by
// `python3 mcp/tools/gen_contract.py`, and this file re-exports them so every screen keeps importing
// from one place. A field added on the Python TypedDict reaches the console by running that script;
// forgetting to run it fails `mcp/tests/test_contract_generated.py`.
//
// What stays HAND-WRITTEN below is everything the server builds as an untyped dict and the console
// therefore has no Python shape for: the VIEW types (`State`, `NodeView`, `LiveView`, `RecapView`,
// `StationView`, `WeaponView`, ...), the `Api` surface itself, and the response bodies. Never
// re-declare a generated shape here -- `mcp/tests/test_ui_contract.py` fails if this file does.

// ---- generated wire shapes (contract.gen.ts) ----
export type {
  ArmoryRecord, BleId, Envelope, Event, FrameBundle, GameConfig, Health, Loadout, LoadoutOverrides,
  LoadoutPolicy, LoadoutPool, LogView, PerkEffects, PerkView, Player, Preflight, ReadinessRow,
  ReadinessSnapshot, Respawn, RosterEntry, ScanRow, ScoreRow, Scoring, Siphon, SlotRule, StationRef,
  Stun, Team, Weapon, WeaponSel,
} from './contract.gen';
export type {
  ArmState, ControlCmd, ItemKind, LoadoutPreset, McKind, NodeKind, PersistedEventType, Phase,
  SlotChoice, StationKind, StationSourceId,
} from './contract.gen';
// values (verbatimModuleSyntax: a value re-export may not ride in a `export type` statement)
export { CONTROL_CMDS, MC_KINDS, NODE_KINDS, STATION_KINDS, STATION_SOURCE_IDS } from './contract.gen';

import type { ArmState, GameConfig, LoadoutPolicy, LoadoutPool, LogView, Phase, Player, Preflight,
  PerkView, ReadinessSnapshot, ScanRow, ScoreRow, StationKind, Team } from './contract.gen';

/** A config as the console READS one. `GameConfig.loadout_policy` is `NotRequired` on the Python side
 *  because a PUT body legitimately omits it -- but every config the server SERVES has been through
 *  `state.py`'s policy fill (`_apply_config` / `modes()`), so a config that arrived from MC always has
 *  one. Those are two types, not one type with a hole: this is what MC hands us, `Partial<GameConfig>`
 *  is what we hand back, and `withPolicy()` is the runtime guard at the one place a config from
 *  anywhere else (a session persisted before A10, an older MC) enters the store. */
export type ConfigView = GameConfig & { loadout_policy: LoadoutPolicy };

/** A18: one row of a mode's parameter schema (`GET /api/modes` → `ModeInfo.params`). Render `int`/`float` as a
 *  number field bounded by `min`/`max`, `bool` as a switch, `str` with `choices` as a segmented control. */
export interface ModeParamSpec {
  name: string;
  type: 'int' | 'float' | 'bool' | 'str';
  default: number | string | boolean;
  desc: string;
  min?: number;
  max?: number;
  choices?: string[];
}

/** A11/A11.5 — one row of the resolved presentation profile (GET /api/presentation). */
export interface PresentationRow {
  event: string; source: 'hud' | 'mc' | 'both'; desc: string;
  sound: string | null; words: string; gun_led: number | null; headset: number | null; flash?: 'green' | null;
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

export interface NodeView {
  node_id: string; node_type: string; gun_name?: string; gun_tail?: string; player_id?: string;
  arm_state: ArmState; last_seen_ms: number; synced: boolean; preflight?: Preflight;
  /** the node's own last word, copied through verbatim by `state.py _on_status` -- an explicit `null`
   *  is what a phone that cannot read the value sends, and is NOT the same as the key being absent. */
  battery?: number | null; fw?: string | null; hp?: number | null; armor?: number | null;
  ammo?: number | null; alive?: boolean | null;
  pending?: number | null;
  /** A29 (2026-09-12): the phone's REAL build — `"<package version>+<git sha>[-dirty]"` baked in at
   *  build time — and `android`/`ios`/`web`. Optional: the app sent a hard-coded `hud-0.2` until
   *  A29, and an MC that predates the change never forwards either. Render what arrived, and say
   *  "UNKNOWN" rather than guess. The RED/AMBER semver rules are the SERVER's (`state.py readiness()`
   *  holds `APP_MAJOR`); the console renders the strings it is sent and derives no version rule. */
  app_ver?: string | null;
  platform?: string | null;
  /** A25: the log sync as this phone reports it. Optional — absent before the phone says anything. */
  log?: LogView | null;
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
  /** F77 / F80 (2026-09-11) — after-the-fact detectors, worded for the operator: a run of identical hits at a
   *  steady ~5 s period (a gun replaying a latched IR event, F74), or hits/deaths from wire id 0 (a hill's
   *  damage word, or a gun whose $PSET never landed). Absent when there is nothing to say. */
  warnings?: string[];
  /** F70 — an OBJECTIVE mode's real result: SECONDS each team held the control point, merged from the
   *  nodes' `possession` facts (max per point per team, never summed — four teammates on one hill all
   *  report the same ownership). Absent unless some node reported, which is itself the answer: a hill
   *  nobody was in range of has no tally. `observed_s` is the best single observer's coverage of
   *  `of_s`, so a partial number can be shown AS partial instead of as the result. */
  possession?: { by_team: Record<string, number>; neutral_s: number; sites: number; reports: number;
                 observed_s: number; of_s: number | null };
  /** A8 — bound nodes not heard from since the whistle. ADVISORY: it gates nothing server-side, but a
   *  recap that is still moving must say so, or the operator reads a settling number as the result. */
  settling?: boolean;
  awaiting?: string[];
  since_end_ms?: number | null;
  /** A6.1 — what the scorer recorded AFTER the whistle: facts that are real but do NOT count. `facts`
   *  is the total (the server's `post_end_facts`), `by_player` the kills/deaths each player picked up
   *  once scoring was frozen. Optional — an older MC sends only the count, and nothing at all before
   *  A6.1 — so the block renders only when the server actually sent it. */
  after_end?: { facts: number; by_player: Record<string, { kills: number; deaths: number }> };
  /** A6.1 — the bare count, which the server has always sent. Kept beside `after_end` because it is
   *  what an older MC has: a count with no breakdown is still worth saying. */
  post_end_facts?: number;
  /** Roadmap A6 — one row per ASSIGNED utility station, from its own self-authoritative heartbeat
   *  (utility.md §5c/§5d.6: a station answers to nobody mid-match, so this is the only place its count is
   *  ever seen). Absent unless some station is assigned; a station never heard from still gets a row, with
   *  its own fields null rather than a fabricated zero. */
  stations?: RecapStationRow[];
}

export interface RecapStationRow {
  node_id: string; kind: StationKind; id: number; team: number;
  /** A6 fix (F105, 2026-09-11): true once at least one heartbeat has landed for this station, set on
   *  EVERY kind — extraction/powerup/bomb have no count of their own, so this is the only signal the UI
   *  has to tell "reported" from "never heard from" for them. */
  heard: boolean;
  revives?: number | null;                          // respawn only
  hold_ms?: Record<string, number> | null;           // control only
  owner?: number | null;                             // control only
}

export type FeedTag = 'DOUBLE KILL' | 'TRIPLE KILL' | `STREAK ×${number}` | 'FIRST BLOOD' | 'TEAM KILL' | 'SYNC POINT'
  /** A11.4/F118: a global-state alert MC pushed to the nodes. `ALERT` reached everyone bound, `WITHHELD`
   *  reached nobody (mc_confidence refused it, or no node was in coverage), `ROLE` is a role assignment
   *  (VIP/carrier). The `text` is the OPERATOR's third-person copy — render it VERBATIM, never re-word. */
  | 'ALERT' | 'WITHHELD' | 'ROLE';
export interface FeedEntry { t_match_s: number; text: string; tag?: FeedTag; kind: 'kill' | 'sync' | 'info' | 'alert' }

export interface StartView {
  match_id: string; go_live_t: number; seq: number; countdown_s: number;
  per_node: Record<string, { arm_state: ArmState; t_minus_ms?: number; synced: boolean; last_seen_ms: number }>;
}

/** A13.5 (F104): a utility phone as MC sees it — the ITEMS panel's row. `assigned` is the operator's call,
 *  `armed` what the phone was last told, `report` the phone's own heartbeat (for a control point that carries
 *  the self-authoritative recap: owner, progress, hold_ms per team). */
export interface StationAssignment { kind: StationKind; team: number; id: number; threshold: number; at?: number }
export interface StationView {
  node_id: string;
  assigned: StationAssignment | null;
  armed: { game: number; at: number; kind: StationKind; team: number; id: number } | null;
  arm_pending: boolean;
  report: { kind?: StationKind; team?: number; station_id?: number; threshold?: number; live?: boolean; revives?: number;
            armed?: boolean; battery?: number;
            control?: { owner?: number; progress?: number; contested?: boolean; hold_ms?: Record<string, number> } };
  app_ver?: string | null;
  last_seen_ms: number | null;   // age
  online: boolean;
  attention: string[];
  game: number;                  // the game byte stations are armed with THIS match
}

export interface State {
  session_id: string;
  phase: Phase;
  t: number;
  lan: { mode: 'router' | 'hotspot' | 'unknown'; ssid?: string; ip: string; port: number; ws_url: string; qr: string; auth_required?: boolean };
  nodes: NodeView[];
  stations?: StationView[];      // A13.5: absent on a server older than 2026-09-11
  game_no?: number;
  readiness: ReadinessSnapshot;
  config: ConfigView;
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
  /** A25 (2026-09-12) — session options. `log_sync: "auto"` lets MC ask every node for its log on its
   *  own (at the recap, on an offer, on a reconnect); `"manual"` leaves the asking to the operator's
   *  LOGS button, which is never gated. Optional: an older server sends none, and the console then
   *  renders no toggle rather than one that writes to a route that is not there. */
  options?: { log_sync?: 'auto' | 'manual' };
  /** A29 (2026-09-12) — the field's builds, as `state.py versions()` counts them: `field` is
   *  `{app_ver: how many PLAYER nodes report it}` with the string verbatim (an unparsable `hud-0.2`
   *  included — the operator needs to see it said out loud), `newest` the highest version in the
   *  field, `release` the one on the download card, `mc_major` the app major MC can play with.
   *  Optional: not on the snapshot yet at the time of writing, so the console falls back to counting
   *  `NodeView.app_ver` itself. Either way it is a TALLY — every version VERDICT is the server's, and
   *  arrives as a worded string in a readiness row's `blockers`/`ambers`. */
  versions?: { field: Record<string, number>; newest?: string | null; release?: string | null; mc_major?: number };
  /** A31 (2026-09-12) — standing lines the COMPILER wrote once, so MC and the phones cannot disagree.
   *  `mc_verify` is the pre-game warning for a game whose end state MC decides while some rostered
   *  phone has no backhaul; it NAMES the phones. Optional: absent under full coverage, absent on an
   *  older server, and the field name is whatever `mc/API.md` documents once the server lane lands —
   *  this is built against `notices.mc_verify` and renders nothing at all when it is missing. */
  notices?: { mc_verify?: string };
}

export interface ModeInfo {
  mode: string; name: string; abbr: string; desc: string; brief: string;
  teams_text: string; win_text: string; respawn_text: string; defaults: ConfigView;
  /** A18: what this mode lets the operator tune (`defaults.mode_params` carries the values). Optional — an
   *  older server never sends it; `[]` for a mode that takes none. */
  params?: ModeParamSpec[];
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

/** loadout.md §8 — a whole GameConfig saved under a name on the MC host ("mode creation"). */
export interface SavedGame {
  preset_id: string; name: string; desc: string; builtin: boolean;
  created_t: number; updated_t: number;
  config: ConfigView;
  weapon_tuning?: Record<string, unknown>;   // RESERVED — future weapon-tuning spec
}

/** The surface both the real client and the in-browser mock implement. */
export interface Api {
  getState(): Promise<State>;
  subscribe(onSnapshot: (s: State) => void, onFeed: (e: FeedEntry) => void, onLink?: (connected: boolean) => void): () => void;
  scan(duration_s?: number): Promise<ScanRow[]>;
  armory(): Promise<{ gun_id: string; sticker: string; ble: { tail?: string } }[]>;
  /** A27: `POST /api/phase {phase:"lobby", force?}` from `kit` is REFUSED 409 while a rostered player
   *  is not ready. The rejection carries `{error, not_ready: display[], greens, roster_size}` — the
   *  client attaches that body to the thrown error as `.body` (see `PhaseRefusal`), so the console can
   *  show the SERVER's list of who is not ready instead of its own guess. `force: true` is the second
   *  tap's override. An older server has no guard: it just answers 200 and the two-step still holds,
   *  because the UI arms on its own roster count first. */
  setPhase(phase: string, force?: boolean): Promise<unknown>;
  getModes(): Promise<ModeInfo[]>;
  getVoices(): Promise<VoiceList>;
  getWeapons(): Promise<WeaponView[]>;
  getPerks(): Promise<PerkView[]>;
  getPresets(): Promise<SavedGame[]>;
  savePreset(p: { name: string; desc?: string; config?: GameConfig; replace?: boolean }): Promise<SavedGame>;
  deletePreset(id: string): Promise<void>;
  applyPreset(id: string): Promise<{ ok: boolean; errors: string[]; config: ConfigView }>;
  updatePreset(id: string, p: { name?: string; desc?: string; config?: GameConfig }): Promise<SavedGame>;
  /** preview the pool a DRAFT policy would allow (designer) — same rule engine, nothing applied */
  previewPool(policy: Partial<LoadoutPolicy>, mode?: string): Promise<{ policy: LoadoutPolicy; pool: LoadoutPool }>;
  /** A11: tonight's presentation profile, resolved, for the read-only ADVANCED view. Rejects with status 404 on an older server. */
  getPresentation(): Promise<PresentationView>;
  putConfig(partial: Partial<GameConfig>): Promise<{ ok: boolean; errors: string[]; config: ConfigView }>;
  addPlayer(p: { display: string; team_id?: string; gun_id?: string; voice?: string; voice_slots?: Record<string, string> }): Promise<Player>;
  patchPlayer(id: string, patch: Partial<Player>): Promise<Player>;
  deletePlayer(id: string): Promise<void>;
  evictNode(node_id: string): Promise<void>;   // DELETE /api/nodes/{id} — operator kick (closes 4000, unbinds, rotates key)
  /** A25: `GET /api/options`. Rejects with status 404 on a server that predates the option table. */
  getOptions(): Promise<{ log_sync?: 'auto' | 'manual' }>;
  /** A25: `PUT /api/options`. Unknown keys and values are a 400 in the operator's voice, never a silent no-op. */
  setOptions(opts: { log_sync?: 'auto' | 'manual' }): Promise<{ log_sync?: 'auto' | 'manual' }>;
  /** A25: the operator's LOGS button — `POST /api/nodes/{id}/pull_log`, always `reason: "manual"` and
   *  so never gated by `log_sync`. `ok` is whether the ASK went out, not whether a log arrived: the
   *  node answers when it is safe to and MC never waits on it. */
  pullLog(node_id: string): Promise<{ ok: boolean; node_id: string; log?: LogView | null }>;
  /** A13.5: assign a utility phone (kind / team / id / threshold); MC pushes `station_config` at once. 400 in the operator's voice. */
  putStation(node_id: string, a: { kind: StationKind; team: number | string; id: number; threshold?: number }): Promise<StationView>;
  deleteStation(node_id: string): Promise<void>;
  armStations(): Promise<{ ok: boolean; armed: number; pending: string[] }>;
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
   *  that reaches nobody used to report plain success (field 2026-09-01).
   *
   *  `ok: false` is a REFUSAL, not a transport failure, and it arrives with a 200: an END with no
   *  scorer, or a second END after the recap is written, ends nothing and says why in `error`. The
   *  press is still forwarded in both cases, so `pushed` can be non-zero while `reached` is 0 and
   *  `ended` is false — "the guns were told to stop, but nothing was ended". `phase` is what MC holds
   *  AFTER the call (a refused END deliberately moves no phase). Every field is optional: an older MC
   *  answers with `{ok, reached, nodes}` alone and the console must still render. */
  control(cmd: 'end' | 'recall' | 'panic', confirm?: boolean): Promise<{
    ok: boolean; ended?: boolean; reached?: number; pushed?: number; nodes?: number; phase?: Phase; error?: string;
  }>;
  getRecap(): Promise<RecapView>;
  matchHistory(): Promise<MatchHistoryRow[]>;
  recapCsvUrl(): string;
  /** an ARCHIVED match's stats table — `recapCsvUrl` only ever serves the LIVE scorer (W1/F6) */
  matchCsvUrl(match_id: string): string;
  newSession(keep_roster: boolean): Promise<State>;
}

/** A27 — the body of the 409 `POST /api/phase` answers with. Every field optional: this is read off a
 *  rejection, and a server that refuses for another reason (or an older one that refuses differently)
 *  must degrade to "the error string alone", never to a crash or an empty list presented as a fact. */
export interface PhaseRefusal { error?: string; not_ready?: string[]; greens?: number; roster_size?: number }

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
  voices: { id: string; name: string; family: string; speaker?: string; lines?: number; kill_line: string; verified: boolean }[];
}
