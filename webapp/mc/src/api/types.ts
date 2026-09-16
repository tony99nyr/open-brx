// The server⇒UI contract. The WIRE shapes are NOT written here: they are GENERATED from the one
// Python source (`mcp/brx_mcp/mc/types.py` + `envelope.py`) into `./contract.gen.ts` by
// `python3 mcp/tools/gen_contract.py`, and this file re-exports them so every screen keeps importing
// from one place. A field added on the Python TypedDict reaches the console by running that script;
// forgetting to run it fails `mcp/tests/test_contract_generated.py`.
//
// What stays HAND-WRITTEN below is the remaining composed view surface (`State`, `LiveView`,
// `StartView`), the `Api` surface and response bodies. Leaf and mid-level views already come
// from the Python producers. Never
// re-declare a generated shape here -- `mcp/tests/test_ui_contract.py` fails if this file does.

// ---- generated wire shapes (contract.gen.ts) ----
export type {
  ArmoryRecord, BleId, Envelope, Event, FrameBundle, GameConfig, Health, Loadout, LoadoutOverrides,
  LoadoutPolicy, LoadoutPool, LogView, PerkEffects, PerkView, Player, Preflight, ReadinessRow,
  ReadinessSnapshot, Respawn, RosterEntry, ScanRow, ScoreRow, Scoring, Siphon, SlotRule, StationRef,
  Stun, Team, Weapon, WeaponSel, PoolEmptyCode, ModeParamSpec, Honor, RecapStationRow,
  StationAssignment, EndDeliveryView, VoiceList, VoiceOption, PhaseRefusalBody,
  WeaponView, SavedGame, LiveRow, EndDeliveryRow, WeaponBars, Coverage,
  LanPublic, PresentationRow, PresentationView, PresentationSummary, HeadsetSummary, GunSummary,
  McConfidence, RecapView, WinnerView, PossessionView, AfterEndPlayer, AfterEndView,
  MatchHistoryRow, ModeInfo, NodeView, StationControl, StationReport, StationArmed, StationView,
  TunnelStatus, TunnelProviderValue,
} from './contract.gen';
export type {
  ArmState, ControlCmd, ItemKind, LoadoutPreset, McKind, NodeKind, PersistedEventType, Phase,
  SlotChoice, StationKind, StationSourceId, WinBy,
} from './contract.gen';
// values (verbatimModuleSyntax: a value re-export may not ride in a `export type` statement)
export { CONTROL_CMDS, MC_KINDS, NODE_KINDS, STALE_AFTER_MS, STATION_KINDS, STATION_SOURCE_IDS } from './contract.gen';

import type { ArmState, GameConfig, LoadoutPolicy, LoadoutPool, LogView, Phase, Player,
  PerkView, ReadinessSnapshot, ScanRow, StationKind, Team,
  EndDeliveryView, VoiceList, PhaseRefusalBody, ModeInfo,
  WeaponView, SavedGame, LiveRow, Coverage, LanPublic, RecapView, MatchHistoryRow, PresentationView,
  NodeView, StationView } from './contract.gen';

export type TunnelProvider = import('./contract.gen').TunnelProviderValue | null;

/** A config as the console READS one. `GameConfig.loadout_policy` is `NotRequired` on the Python side
 *  because a PUT body legitimately omits it -- but every config the server SERVES has been through
 *  `state.py`'s policy fill (`_apply_config` / `modes()`), so a config that arrived from MC always has
 *  one. Those are two types, not one type with a hole: this is what MC hands us, `Partial<GameConfig>`
 *  is what we hand back, and `withPolicy()` is the runtime guard at the one place a config from
 *  anywhere else (a session persisted before A10, an older MC) enters the store. */
export type ConfigView = GameConfig & { loadout_policy: LoadoutPolicy };

export interface LiveView {
  match_id: string; go_live_t: number; time_limit_s: number; ends_t: number;
  score: Record<string, number>; rows: LiveRow[];
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

export interface State {
  session_id: string;
  phase: Phase;
  t: number;
  lan: {
    /** field 2026-09-12 (ISSUE 12/F143): no platform ever told `router` from `hotspot` apart, so the
     *  field always read `unknown` and the console printed that WORD as if it were the network name.
     *  The server now sends the flat `"lan"` and, separately, `ssid` — `null` (never the string
     *  `"unknown"`) when it genuinely could not read one. `router`/`hotspot` still decode for an older
     *  server; the console must never print a MODE as a placeholder network name either way. */
    mode: 'router' | 'hotspot' | 'unknown' | 'lan'; ssid?: string | null; ip: string; port: number; ws_url: string;
    /** A28.2: `ws://<ip>:<ws-port>/ws?s=<join_secret>[&pub=<url-encoded public ws_url>]` — no
     *  longer the same as `ws_url`; carries the public URL only while `public.status == "up"`. */
    qr: string;
    /** T3-A (field 2026-09-12): MC advertised a WSL2 NAT address in the QR/mDNS and no phone could
     *  reach it. Set only when the server DETECTED it is running under WSL and nothing (`--advertise`)
     *  has told it the advertised address is already correct -- the reachability claim itself is an
     *  INFERENCE (there is no phone on the server to ask), so render it verbatim rather than
     *  paraphrasing it into a stronger claim. `null`/absent everywhere else, including every non-WSL
     *  host — macOS and plain Linux never set this. */
    warning?: string | null;
    /** A28.2: 8 url-safe chars, per session, persisted. Absent on a server that predates A28. */
    join_secret?: string;
    /** A28.1. Absent on a server that predates A28 — the UI must not invent a toggle for a route
     *  that does not exist there. */
    public?: LanPublic;
    auth_required?: boolean;
  };
  /** A28.4. Absent on a server that predates A28. */
  coverage?: Coverage;
  nodes: NodeView[];
  stations?: StationView[];      // A13.5: absent on a server older than 2026-09-11
  game_no?: number;
  readiness: ReadinessSnapshot;
  config: ConfigView;
  config_errors: string[];
  config_warnings?: string[];
  players: Player[];
  /** STANDBY (2026-09-12): players pulled out of the roster but kept (callsign, team, gun, loadout) so PLAY
   *  puts them straight back. Absent on a server that predates it — the console then shows no standby
   *  section and never invents a control for a route that is not there. */
  standby?: Player[];
  teams: Team[];
  kit: { kitted: number; total: number; trying: Record<string, string>; browsing: Record<string, number> };
  loadout_pool: LoadoutPool;   // `reasons` rides on the generated type now
  active_preset_id?: string | null;   // the saved game that was applied (null after any real config edit)
  /** `acks[player_id].config_id` (A36) is WHICH config that gun answered for. An ack naming a
   *  previous one is not an ack for the game about to start — the server refuses the whistle on it
   *  (not even with `force`) and names it in the row's `blockers`, so anything counting "acked" here
   *  has to ask the same question. Optional: an older server sends none, and the console then falls
   *  back to `ok` alone rather than reading every ack as stale. `all_acked` is the server's own
   *  answer to the same question and wins wherever it is present. */
  lobby: { ready: number; total: number; pushed: boolean; all_acked?: boolean;
           acks: Record<string, { ok: boolean; gun_echo?: string; err?: string; config_id?: string }> };
  /** LOAD (2026-09-13) — the GAME the phones have been told about: mode, teams, health, night,
   *  respawn, venue, the rules. NO frames and NO head go with it (`state.py load_game` pushes
   *  `assign`), so `lobby.pushed` stays FALSE through a LOAD and the LOBBY push remains the only
   *  thing that ever configures a gun. `sent` is DELIVERY — how many phones' sockets accepted the
   *  announcement — and is NOT a claim that a phone rendered it, nor anything to do with a gun ack.
   *  Absent on a server that predates LOAD; treat that as "no game announced". */
  game?: { loaded: boolean; config_id?: string; sent: number; total: number };
  /** The pre-arm "is the field in sync" summary (`state.py sync_summary`). Four independent facts per
   *  rostered player; `totals.in_sync` is FALSE for an empty roster, because a zero-of-zero must
   *  never read as ready. Absent on an older server. */
  sync?: {
    rows: { player_id: string; display: string; gun_id: string; player_num: number; bound: boolean;
            phone_game: boolean; gun_sent: boolean; gun_acked: boolean;
            /** A37 (`state.py _echo_state`). FOUR states, and `null` is one of them: the server
             *  returns it when there is NO check to report — nothing pushed, no ack for this config,
             *  or no readable `$WEAP` in the head. `not_echoed` is the ordinary answer on our v4.32
             *  units. Only `mismatch` is a fault; the other three must never render as one. */
            gun_echo: 'proven' | 'mismatch' | 'not_echoed' | null }[];
    totals: { rostered: number; phone_game: number; gun_sent: number; gun_acked: number;
              gun_echo_proven: number; in_sync: boolean };
    unconfigured: string[];
  };
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
  /** A42 (2026-09-13) — did the END actually reach every player's HUD? Present from the moment a match
   *  ends until the next one is scheduled; absent on a server that predates it, and absent before any
   *  match has ended, so presence is the rule for rendering anything at all.
   *
   *  This is a fact about DELIVERY — whether a phone acknowledged the end, read off the heartbeat it
   *  already sends — and it must never be rendered as, or beside, a judgement about how that player
   *  played. `confirmed` is `total - unconfirmed.length`; `retrying` says MC is still re-delivering (it
   *  stops after `tries` reaches the end of the ladder, at which point the answer is a person walking
   *  over to the gun). */
  end_delivery?: EndDeliveryView;
  /** field 2026-09-12 (ISSUE 11/F142): a `--demo` session used to persist into `~/.brx-mcp/` and get
   *  silently RESTORED on the next real launch — two ghost players with no phone sat on a live roster
   *  and were mistaken for real ones until match 2 was already mid-setup. Present only on the FIRST
   *  snapshot(s) after a session was hydrated from a previous run (demo or real); absent once the
   *  operator has acknowledged it (FRESH SESSION) or on a session that started clean. `players` is how
   *  many roster rows came back with it, so the banner can say a number instead of "some". */
  restored_from?: { at: number; players: number };
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
  putStation(node_id: string, a: { kind: StationKind; team: number | string; id: number; threshold?: number }): Promise<StationView>;
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
export type PhaseRefusal = Partial<PhaseRefusalBody>;

/** Selectable voice personas. `$PSET`'s trailing tokens are a positional voice pack; only HEAVY is
 *  confirmed by ear, the rest are inferred from the pack layout (see gameconfig.VOICE_PACKS). */
