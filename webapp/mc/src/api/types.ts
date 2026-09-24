// The server⇒UI contract. The WIRE shapes are NOT written here: they are GENERATED from the one
// Python source (`mcp/brx_mcp/mc/types.py` + `envelope.py`) into `./contract.gen.ts` by
// `python3 mcp/tools/gen_contract.py`, and this file re-exports them so every screen keeps importing
// from one place. A field added on the Python TypedDict reaches the console by running that script;
// forgetting to run it fails `mcp/tests/test_contract_generated.py`.
//
// What stays HAND-WRITTEN below is the `Api` surface and response bodies. View shapes come from
// the Python producers. Never
// re-declare a generated shape here -- `mcp/tests/test_ui_contract.py` fails if this file does.

// ---- generated wire shapes (contract.gen.ts) ----
export type {
  ArmoryRecord, BleId, ConfigView, Envelope, Event, FrameBundle, GameConfig, Health, Loadout, LoadoutOverrides,
  LoadoutPolicy, LoadoutPool, LogView, PerkEffects, PerkEffectsResolved, PerkView, Player, Preflight, ReadinessRow,
  ReadinessSnapshot, Respawn, RosterEntry, RosterWeapon, ScanRow, ScoreRow, Scoring, Siphon, SlotRule, StationRef,
  Stun, Recoil, Team, Weapon, WeaponSel, PoolEmptyCode, ModeParamSpec, Honor, RecapStationRow,
  StationAssignment, EndDeliveryView, VoiceList, VoiceOption, PhaseRefusalBody,
  WeaponView, SavedGame, LiveRow, EndDeliveryRow, WeaponBars, Coverage,
  LanPublic, PresentationRow, PresentationView, PresentationSummary, HeadsetSummary, GunSummary,
  McConfidence, RecapView, WinnerView, PossessionView, AfterEndPlayer, AfterEndView,
  MatchHistoryRow, ModeInfo, NodeView, StationControl, StationReport, StationArmed, StationView,
  LiveView, StartNodeView, StartView, State, GameConfigBase, LanView, KitView, GunConfigReadback, LobbyAck,
  LobbyView, GameAnnouncementView, SyncAckState, SyncRow, SyncTotals, SyncView, SessionOptions, VersionsView,
  NoticesView, RestoredFromView, SnapshotFeedRow, OrphanMatchView, OperatorActionResult, OperatorStatus,
  TunnelStatus, TunnelProviderValue, ValuePair, RespawnProfile, DotSpec, HirCell,
  StationItem, PowerupSlot, StationUpdate, StationAction, PowerupPreset, PowerupsView,   // A56 (S58)
} from './contract.gen';
export type {
  ArmState, ControlCmd, HealthPreset, ItemKind, LoadoutPreset, McKind, NodeDeniedCommand, NodeKind, OperatorCmd, PersistedEventType, Phase,
  SlotChoice, StationKind, StationSourceId, WinBy, TimedProtectS, WeaponDelayMs, StationProtectS, StationItemKind,
} from './contract.gen';
// values (verbatimModuleSyntax: a value re-export may not ride in a `export type` statement)
export { CONTROL_CMDS, MC_KINDS, NODE_KINDS, NEVER_SEEN_MS, STALE_AFTER_MS, STATION_KINDS, STATION_SOURCE_IDS,
  TIMED_PROTECT_S_DEFAULT, WEAPON_DELAY_MS_DEFAULT, STATION_PROTECT_S_DEFAULT } from './contract.gen';

import type { ConfigView, GameConfig, LoadoutPolicy, LoadoutPool, LogView, Phase, Player,
  PerkView, ScanRow, StationKind, StationView, VoiceList, PhaseRefusalBody, ModeInfo,
  WeaponView, SavedGame, LanPublic, MatchHistoryRow, PresentationView, RecapView, State,
  OperatorActionResult, OperatorCmd, PowerupsView } from './contract.gen';


export type TunnelProvider = import('./contract.gen').TunnelProviderValue | null;

export type FeedTag = 'DOUBLE KILL' | 'TRIPLE KILL' | `STREAK ×${number}` | 'FIRST BLOOD' | 'TEAM KILL' | 'SYNC POINT'
  /** A11.4/F118: a global-state alert MC pushed to the nodes. `ALERT` reached everyone bound, `WITHHELD`
   *  reached nobody (mc_confidence refused it, or no node was in coverage), `ROLE` is a role assignment
   *  (VIP/carrier). The `text` is the OPERATOR's third-person copy — render it VERBATIM, never re-word. */
  | 'ALERT' | 'WITHHELD' | 'ROLE'
  /** A47: the operator's menu on the LIVE board sent RESYNC / RESPAWN / RELINK to one player's phone, or
   *  that phone answered (`operator_result`). */
  | 'OPERATOR'
  /** A34: a phone came back live in a match MC retired, or the operator ended a match MC did not start. */
  | 'RECONCILED'
  /** Bench 2026-09-17: MC restarted and resumed (or adopted) the match in play. */
  | 'RESUMED'
  /** A note about a match MC did not start (an adopted match): MC records it and ends nothing. */
  | 'NOTE';
export interface FeedEntry { t_match_s: number; text: string; tag?: FeedTag; kind: 'kill' | 'sync' | 'info' | 'alert' }

/** loadout.md §3.2 (server pass 2, 2026-09-12) — why a slot's pool came out EMPTY. A closed
 *  vocabulary of CODES, not sentences: `policy.py`'s copy of these is the HUD's (`_R_*`, shown
 *  verbatim to a player) and the console needs its own words for the same fact, so there is one
 *  classifier and two vocabularies (mirrored client-side in `screens/gameSummary.ts computePool`,
 *  which the mock's own pool delegates to, so `?mock` carries the same codes). The shape itself is
 *  generated (`mcp/brx_mcp/mc/types.py` LoadoutPool.reasons → `contract.gen.ts`); these are aliases. */
export type LoadoutPoolReasons = NonNullable<LoadoutPool['reasons']>;   // generated (types.py LoadoutPool.reasons), field 2026-09-12
/** One optional code per slot that came out empty; a slot with nothing to say here has something in
 *  its pool. Keyed by the SAME names as `LoadoutPool`'s own fields (`primary`, `secondary_weapons`,
 *  `perks`), not `secondary`/`perk` — those are the POLICY's slot names, these are the POOL's. */

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
  /** STANDBY: `POST /api/players/{id}/standby` — park a rostered player (stand down). Rejects with status 404 on an older server. */
  standbyPlayer(id: string): Promise<Player>;
  /** STANDBY: `DELETE /api/players/{id}/standby` — put a parked player back (PLAY). */
  reinstatePlayer(id: string): Promise<Player>;
  evictNode(node_id: string): Promise<void>;   // DELETE /api/nodes/{id} — operator kick (closes 4000, unbinds, rotates key)
  /** A25: `GET /api/options`. Rejects with status 404 on a server that predates the option table. */
  getOptions(): Promise<{ log_sync?: 'auto' | 'manual' }>;
  /** A25: `PUT /api/options`. Unknown keys and values are a 400 in the operator's voice, never a silent no-op. */
  setOptions(opts: { log_sync?: 'auto' | 'manual' }): Promise<{ log_sync?: 'auto' | 'manual' }>;
  /** A25: the operator's LOGS button — `POST /api/nodes/{id}/pull_log`, always `reason: "manual"` and
   *  so never gated by `log_sync`. `ok` is whether the ASK went out, not whether a log arrived: the
   *  node answers when it is safe to and MC never waits on it. */
  pullLog(node_id: string): Promise<{ ok: boolean; node_id: string; log?: LogView | null }>;
  /** A28.1: `POST /api/tunnel {on}` → `lan.public`. 409 (available:false / provider:"manual") — the
   *  server's `error` text is the whole point of the rejection, never swallow it. */
  setTunnel(on: boolean): Promise<LanPublic>;
  /** A13.5: assign a utility phone (kind / team / id / threshold); MC pushes `station_config` at once. 400 in the operator's voice. */
  putStation(node_id: string, a: { kind: StationKind; team: number | string; id: number; threshold?: number;
    /** A56: a `powerup` station's item, one of `getPowerups().presets[].preset`. Refused when MC's powerups flag is off. */
    item_preset?: string }): Promise<StationView>;
  /** A56: `GET /api/powerups` -- MC's powerups flag and the item presets. Rejects with status 404 on an MC that predates powerups. */
  getPowerups(): Promise<PowerupsView>;
  /** A56 round 2: `POST /api/stations/{node_id}/reset` -- a powerup station's item is available NOW, off its
   *  schedule (armed/live only). A route-less 404 is an MC that predates this UI. */
  resetStation(node_id: string): Promise<{ ok?: boolean }>;
  deleteStation(node_id: string): Promise<void>;
  armStations(): Promise<{ ok: boolean; armed: number; pending: string[] }>;
  /** A41: the cure for a phone stuck in utility mode. Pushes `control{cmd:"release_utility"}` to ONE
   *  utility node; `ok` is whether a socket took the push, not whether the phone reloaded (no ack kind
   *  exists for `control`). Works in every phase, armed/live included, and touches nothing else. */
  releaseStation(node_id: string): Promise<{ ok: boolean }>;
  tryout(id: string, weapon_id: string): Promise<void>;
  rangeVerdicts(): Promise<Record<string, { weapon_id: string; verdict: 'pass' | 'issue'; note: string; t: number }>>;
  rangeVerdict(weapon_id: string, verdict: 'pass' | 'issue', note?: string): Promise<unknown>;
  endTryout(id: string): Promise<void>;
  setReady(id: string, ready: boolean): Promise<Player>;
  /** Bench 2026-09-17: MARK ALL READY -- the roster-wide `host_override`, LOBBY only. Marks every
   *  rostered, non-standby player ready (never touches acks/config); refused outside LOBBY. */
  readyAll(): Promise<{ ok: boolean; readied: string[] }>;
  /** `repushed` (R2-1): this call landed on an ALREADY-PUSHED lobby, so it was a RE-PUSH — same game
   *  number, fresh heads, every judgement about the old head dropped. `config_id` is the head that
   *  was just pushed; a RE-push MINTS A FRESH ONE (F6), which is what makes it provable — an ack
   *  already on the wire when the acks were cleared is then stale and says so, instead of being
   *  recorded as an ack for a head that gun never took. Both optional: a server that predates them
   *  simply omits the fields. */
  /** LOAD — announce the game to every bound phone. No frames, no head, no gun write, and it does
   *  NOT set `lobby.pushed`: `pushLobby` below is still the only call that configures a gun. */
  loadGame(): Promise<{ ok: boolean; config_id?: string; sent: number; total: number }>;
  pushLobby(force?: boolean): Promise<{ ok: boolean; acks: State['lobby']['acks']; repushed?: boolean; config_id?: string }>;
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
  /** A47: `POST /api/players/{pid}/operator {cmd, match_id}` -- the LIVE board's operator menu, to ONE bound
   *  player's phone. 409 outside ARMED/LIVE, for a stale match, or a phone out of reach, with the reason in
   *  `error`. `pushed` means a socket took it (no ack kind exists for `control`). A server that predates it 404s. */
  operatorAction(player_id: string, cmd: OperatorCmd, match_id: string): Promise<OperatorActionResult>;
  getRecap(): Promise<RecapView>;
  matchHistory(): Promise<MatchHistoryRow[]>;
  recapCsvUrl(): string;
  /** an ARCHIVED match's stats table — `recapCsvUrl` only ever serves the LIVE scorer (W1/F6) */
  matchCsvUrl(match_id: string): string;
  newSession(keep_roster: boolean): Promise<State>;
  /** RECAP's NEXT MATCH (2026-09-16): roll forward with the roster and the game kept, then LOAD that
   *  game. Answers the full State. A server that predates it answers 404. */
  nextMatch(): Promise<State>;
  /** Bench 2026-09-17: `POST /api/match/orphan/resume` — RESUME MATCH on the match `state.orphan_match` names. */
  resumeOrphan(match_id: string): Promise<State>;
  /** Bench 2026-09-17: `POST /api/match/orphan/end` — END THEIR MATCH, to the phones reporting it only. */
  endOrphan(match_id: string): Promise<State>;
  /** "Report a problem" — `POST /api/report`. Bundles this session's evidence into a zip, with
   *  names, tagger ids, IP addresses and the access code stripped server-side (`removed` counts what
   *  was taken out). Allowed in every phase; can take a few seconds. `download` is the path to fetch
   *  the zip from (`GET /api/report/{file}`, token-gated the same as any other operator call);
   *  `issue_url` opens a pre-filled GitHub issue. `too_large` says the zip is over GitHub's 25 MB
   *  attachment limit — the server never trims it, so the panel still offers the issue and the
   *  download, and says a developer will ask for the file another way. Rejects with status 404/405
   *  on a server that predates this route. */
  makeReport(): Promise<ReportResult>;
}

/** The body `POST /api/report` answers with (see `Api.makeReport`). */
export interface ReportResult {
  file: string;
  download: string;
  issue_url: string;
  summary: Record<string, unknown>;
  removed: Record<string, number>;
  too_large: boolean;
}

/** A27 — the body of the 409 `POST /api/phase` answers with. Every field optional: this is read off a
 *  rejection, and a server that refuses for another reason (or an older one that refuses differently)
 *  must degrade to "the error string alone", never to a crash or an empty list presented as a fact. */
export type PhaseRefusal = Partial<PhaseRefusalBody>;

/** Selectable voice personas. `$PSET`'s trailing tokens are a positional voice pack; only HEAVY is
 *  confirmed by ear, the rest are inferred from the pack layout (see gameconfig.VOICE_PACKS). */
