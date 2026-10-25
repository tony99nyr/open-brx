// In-browser mock of the MC server (mcp/brx_mcp/mc/API.md). Stateful enough for every UI interaction.
import type {
  Api, ConfigView, PowerupPreset, PowerupsView, Coverage, FeedEntry, Favourite, GameConfig, GamePick, GamePiece, LanPublic, LastMatch, LiveRow, LiveView, Loadout, LoadoutPolicy, LogView,
  HillSettings, MatchHistoryRow, MatchSettings, ModeInfo, NodeView, OperatorActionResult, OperatorCmd, PerkView, Phase, PieceKind, Player,
  ReadinessRow, ReadinessSnapshot, RecapStationRow, RecapView, ReportResult, Respawn, ScanRow, ScoreRow, SlotRule, StartView, State, StationAssignment, StationDeparture, StationItem, StationKind,
  StationView, TeamColour, TunnelProvider, TunnelStatus, TxPower, WeaponView,
} from '../api/types';
import { GAME_VOLUME_MAX, GAME_VOLUME_MIN, HILL_CAPTURE_S_MAX, HILL_CAPTURE_S_MIN, HILL_NET_CAP_MAX, HILL_NET_CAP_MIN, STALE_AFTER_MS, STATION_KINDS, STATION_SOURCE_IDS, STATION_PROTECT_S_DEFAULT, TIMED_PROTECT_S_DEFAULT, WEAPON_DELAY_MS_DEFAULT } from '../api/types';
import {
  ECHO_FAULT, GUN_CONFIG_FAULT, GUN_LINK_LOST, HOLD_TARGET_MAX_S, OFFLINE_AFTER_MS, POOL_FAULT, POWERUP_STATION_ID_MAX, STALE_ACK_FAULT, STATION_ARMED_OLDER,
  STALE_LIVE_RETELL_MS, STATION_BATTERY_LOW, STATION_BRING_BACK, STATION_NOT_ARMED, STATION_REARM, STATION_TEAM_ANY, TEAM_KEYS,
  OBJECTIVE_MODES, STATION_NO_HILL, GUN_DID_NOT_TAKE_CONFIG,
} from '../api/contract.gen';
import { chainConflict, withPolicy } from '../rules/loadoutPolicy';
import { defaultModeParams, mergeModeParams } from '../rules/modeParams';
import { perkEffectsResolved } from '../rules/perkEffects';
import { mergePresentation } from '../rules/presentation';
import { healthPresetOf } from '../rules/health';
import { fmtServerAge } from '../tokens';
import { GUN_FLAPPING_LINE, LOCAL_ONE_TEAM_FAULT, curedByPush } from '../api/derive';
import { batteryLow } from '../alerts';
import { DEMO_TEAMS, GUNS, MODES, PERKS, PLAYERS, POLICY_WEAPONS, READY, RECAP, TEAMS, WEAPONS } from './data';
import { PRESETS, apply as applyPolicy, conflict, defaultPolicy, pool as poolOf, presetOf, reject } from './policy';
import { WSL_UNREACHABLE_WARNING } from './wslWarning';
import { computeHonors } from './honors';
import { storedTag, tagError } from '../api/tag';
import { carryTeams } from '../teamColours';
import { defaultThreshold } from '../rules/stationBubble';   // the per-kind platform default the console shows (F383)
import { isKillScored, isObjectiveScored } from '../rules/scoring';
import { sessionCoverage, sessionKitted, sessionNoticesMcVerify, sessionOffGrid, sessionReadinessRosterSize, sessionUpdating } from '../rules/readiness';
import { scorerLiveRow, sessionLiveView, sessionWithPoolStale } from '../rules/live';
import { sessionStartView } from '../rules/start';
import { sessionArmEndDelivery, sessionEndDeliveryTried, sessionEndDeliveryView, sessionNoteEndConfirm,
  sessionNoteEndConfirmLine, sessionRetryEndDelivery, sessionSayEndUnconfirmed, type EndReceipt } from '../rules/endDelivery';
import { galleryState } from './gallery';
import type { RecapSyncRow, RecapSyncStage } from '../api/recapSync';
import { scorerMissing, sessionMarkFlushedLive, sessionScorerRecap, sessionSettling } from '../rules/recap';
import { sessionVersions } from '../rules/versions';
import { sessionGameSentN } from '../rules/game';
import { compilerValidation, holdTargetWarning } from '../rules/configcheck';
import releaseBuild from '../../../download/build.json';
import demoLoadouts from './demoLoadouts.json';
import { POWERUP_AMOUNT_MAX, POWERUP_AMOUNT_MIN, POWERUP_AMOUNT_STEP, POWERUP_CHARGES_MAX, POWERUP_CHARGES_MIN, POWERUP_SPAWN_EVERY_MAX, POWERUP_SPAWN_EVERY_MIN, POWERUP_SPAWN_EVERY_STEP } from '../api/contract.gen';
import { HEALTH_PRESETS as GEN_HEALTH_PRESETS, SYNC_STUCK_S, STATION_KIND_LABEL, STATION_KIND_SHORT, POWERUP_PRESETS as GEN_POWERUP_PRESETS, NAME_MAX, RUNWAY_MIN_S, RUNWAY_MAX_S, TEAM_COUNT_MIN, TEAM_COUNT_MAX, STATION_THRESHOLD_MIN_DBM, STATION_THRESHOLD_MAX_DBM,
  STATION_SOURCE_DESCRIPTIONS, TIMED_PROTECT_S_OPTIONS, WEAPON_DELAY_MS_OPTIONS, STATION_PROTECT_S_OPTIONS } from '../api/contract.gen';

const now = () => Date.now();
// A56 (S58, docs/spec/powerups.md): MC's item presets, expanded from its default constants (Tony 2026-09-24:
// heavies every 120 s, Overshield +75 every 60 s, Ammo every 60 s, each first spawning after one interval; a weapon item's
// charges are its magazine, weapons.json `mag`). The real list comes from `GET /api/powerups`; this mirrors it
// so `?mock` and the tests work without the server. `?mock&powerups=off` demos MC started with
// `--no-powerups`; `?mock&powerups=old` demos an MC that predates the route (404).
// The table is MC's own (contract.gen, from powerups.py): mc.md #7, the mock's Rockets and Rail Gun colours had drifted
// from F427's. `charges` is the weapon's magazine on the server (weapons.json `mag`); the mock gives every weapon 2.
const POWERUP_PRESETS: PowerupPreset[] = GEN_POWERUP_PRESETS.map(p => ({
  preset: p.id,
  item: p.kind === 'weapon'
    ? { kind: 'weapon', weapon_id: p.weapon_id, charges: 2, spawn_every_s: p.spawn_every_s, first_at_s: p.first_at_s, name: p.name, color: p.color }
    : p.kind === 'ammo'
      ? { kind: 'ammo', refill: p.refill, spawn_every_s: p.spawn_every_s, first_at_s: p.first_at_s, name: p.name, color: p.color }
      : { kind: p.kind, amount: p.amount, spawn_every_s: p.spawn_every_s, first_at_s: p.first_at_s, name: p.name, color: p.color },
} as PowerupPreset));
const mockPowerups = (): 'on' | 'off' | 'old' => {
  const v = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('powerups') : null;
  return v === 'off' || v === 'old' ? v : 'on';
};
// S-powerup-overrides (2026-09-28): CHARGES/AMOUNT/RESPAWN are optional siblings of `item_preset` on the
// station PUT, mirroring mcp/brx_mcp/mc/powerups.py exactly (constants AND wording).
const inRange = (v: unknown, lo: number, hi: number, step: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi && (v - lo) % step === 0;
/** As `powerups.py apply_overrides()`: stateless -- recomputes the item from the preset default plus
 *  whichever override fields are present in THIS request, never from what was stored before. */
function applyOverrides(item: StationItem, a: { charges?: number; amount?: number; spawn_every_s?: number }): StationItem {
  const out = { ...item };
  if (a.charges != null) {
    if (out.kind !== 'weapon') throw Object.assign(new Error(`CHARGES ONLY APPLIES TO A WEAPON ITEM: ${out.name} HAS NONE`), { status: 400 });
    if (!inRange(a.charges, POWERUP_CHARGES_MIN, POWERUP_CHARGES_MAX, 1)) throw Object.assign(new Error(`CHARGES MUST BE A WHOLE NUMBER, ${POWERUP_CHARGES_MIN}-${POWERUP_CHARGES_MAX}`), { status: 400 });
    out.charges = a.charges;
  }
  if (a.amount != null) {
    if (out.kind !== 'overshield') throw Object.assign(new Error(`AMOUNT ONLY APPLIES TO AN OVERSHIELD ITEM: ${out.name} HAS NONE`), { status: 400 });
    if (!inRange(a.amount, POWERUP_AMOUNT_MIN, POWERUP_AMOUNT_MAX, POWERUP_AMOUNT_STEP)) throw Object.assign(new Error(`AMOUNT MUST BE ${POWERUP_AMOUNT_MIN}-${POWERUP_AMOUNT_MAX}, IN STEPS OF ${POWERUP_AMOUNT_STEP}`), { status: 400 });
    out.amount = a.amount;
  }
  if (a.spawn_every_s != null) {
    if (!inRange(a.spawn_every_s, POWERUP_SPAWN_EVERY_MIN, POWERUP_SPAWN_EVERY_MAX, POWERUP_SPAWN_EVERY_STEP)) throw Object.assign(new Error(`RESPAWN MUST BE ${POWERUP_SPAWN_EVERY_MIN}-${POWERUP_SPAWN_EVERY_MAX} SECONDS, IN STEPS OF ${POWERUP_SPAWN_EVERY_STEP}`), { status: 400 });
    out.spawn_every_s = a.spawn_every_s;
    out.first_at_s = a.spawn_every_s;
  }
  return out;
}
// F411 (docs/spec/design/games-presets.md §1): the eight PLAY pickers' built-in pieces. `piece_id`s are
// `builtin:<kind>:<slug>` and never edited/deleted (403); a fresh session picks the first of each kind.
const builtinPiece = (kind: PieceKind, slug: string, name: string, value: Record<string, unknown>, post_mvp = false): GamePiece =>
  ({ piece_id: `builtin:${kind}:${slug}`, kind, name, note: '', builtin: true, post_mvp, created_t: 0, updated_t: 0, value });
const BUILTIN_PIECES = (): GamePiece[] => [
  builtinPiece('mode', 'tdm', 'TEAM DEATHMATCH', { mode: 'tdm' }),
  builtinPiece('mode', 'ffa', 'FREE-FOR-ALL', { mode: 'ffa' }),
  builtinPiece('mode', 'koth', 'KING OF THE HILL', { mode: 'koth' }),
  // F-scope A: post-MVP modes still ship a mode piece (so an old config naming one still resolves a
  // name/brief), but `post_mvp: true` keeps them off PLAY (§5's "a post_mvp piece is not pickable").
  builtinPiece('mode', 'infection', 'INFECTION', { mode: 'infection' }, true),
  builtinPiece('mode', 'lms', 'LAST MAN STANDING', { mode: 'lms' }, true),
  builtinPiece('mode', 'extraction', 'EXTRACTION', { mode: 'extraction' }, true),
  builtinPiece('life', 'standard', 'STANDARD', { ...GEN_HEALTH_PRESETS.standard }),   // compile.py HEALTH_PRESETS, generated
  builtinPiece('life', 'shields', 'SHIELDS', { ...GEN_HEALTH_PRESETS.shields }),
  builtinPiece('life', 'hardcore', 'HARDCORE', { ...GEN_HEALTH_PRESETS.hardcore }),
  builtinPiece('spawn', 'auto', 'AUTO', { type: 'auto', delay_s: 15, protect_s: TIMED_PROTECT_S_DEFAULT, weapon_delay_ms: WEAPON_DELAY_MS_DEFAULT }),
  builtinPiece('spawn', 'station', 'STATION', { type: 'scanner', delay_s: 10, station_protect_s: STATION_PROTECT_S_DEFAULT, gate: 'trigger' }),
  builtinPiece('primary', 'all', 'ALL', { choice: 'player', kinds: ['weapon'], exclude_tags: [], exclude_ids: [], only_ids: [], fixed_id: null }),
  builtinPiece('secondary', 'all', 'ALL', { choice: 'player', kinds: ['weapon'], exclude_tags: [], exclude_ids: [], only_ids: [], fixed_id: null }),
  builtinPiece('perks', 'all', 'ALL', { choice: 'player', kinds: ['perk'], exclude_tags: [], exclude_ids: [], only_ids: [], fixed_id: null }),
  builtinPiece('misc_loadouts', 'standard', 'PLAYERS PICK · HEAVIES ON', { hud_select: true, heavies: true }),
  builtinPiece('gameplay', 'standard', 'OPEN BRX STANDARD', { mode_params: {} }),
];
const PICKER_KINDS: PieceKind[] = ['mode', 'life', 'spawn', 'primary', 'secondary', 'perks', 'misc_loadouts', 'gameplay'];
// every kit shape the Kit page can show: weapon + perk (A14: all three slots), perk only, empty, weapon only
// Shared with the Python recorder. Keep the design field's selected kits intact.
const DEMO_LOADOUTS: Loadout[] = demoLoadouts;
const MOCK_STATION_SOURCES = STATION_SOURCE_IDS.map(value =>
  ({ value, desc: STATION_SOURCE_DESCRIPTIONS[value] as string }));
const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

class ConfigMergeError extends Error {}

// ---- `?mock&faults=1`: A36/A37/F271's five config-proof states, one gun each ----------------
// The strings are the SERVER'S, verbatim (`state.py` `STALE_ACK_FAULT` / `ECHO_FAULT` /
// `POOL_FAULT` / `GUN_CONFIG_FAULT`, generated from `types.py`) — a paraphrase would demo a screen the field never shows.
// Five guns that are otherwise GREEN, so each state is the only thing wrong with its row.
const DEMO_FAULT_GUN: Record<string, 'stale' | 'echo' | 'pool' | 'readback' | 'noecho' | 'noconfig'> = {
  'GUN-A': 'stale', 'GUN-B': 'echo', 'GUN-C': 'pool', 'GUN-G': 'readback', 'GUN-E': 'noecho',
};
// F549: state.py GUN_DID_NOT_TAKE_CONFIG, verbatim
const DEMO_NO_CONFIG_LINE = GUN_DID_NOT_TAKE_CONFIG;
const DEMO_OLD_CFG = '9f2a1c04';
const DEMO_STALE_LINE = `${STALE_ACK_FAULT} (${DEMO_OLD_CFG}): RE-PUSH`;
const DEMO_ECHO_LINE = `${ECHO_FAULT} (WEAPON 31/192 ECHOED, 32/192 EXPECTED, MAG/RESERVE): RE-PUSH`;
const DEMO_POOL_LINE = `${POOL_FAULT} (REPORTS 45/115, THIS CONFIG GRANTS 45/70, HP/ARMOR, LIKELY AN OLDER HEAD): RE-PUSH BEFORE THE NEXT GAME`;
const DEMO_READBACK_LINE = `${GUN_CONFIG_FAULT} (TEAM 99 READ BACK, 1 PUSHED): RE-PUSH`;
// F221/A14: the readiness and station lines are the SERVER'S words, generated from `types.py` (`WHAT IS WRONG: WHAT TO DO`).

type Sub = { snap: (s: State) => void; feed: (e: FeedEntry, edit?: boolean) => void };

export class MockBackend implements Api {
  private subs = new Set<Sub>();
  private phase: Phase = 'muster';
  // The public setPhase method implements Api, so the field funnel needs a distinct name.
  private setPhaseField(p: Phase): Phase {
    this.phase = p;
    return this.phase;
  }
  // F413 (games-presets.md §7): `MODES[].defaults.teams` is red+blue now, matching the server (a fresh
  // pick, a mode change, and default_config all read it) -- but this DEMO SESSION is a fixture already
  // in progress, not a fresh one: its PLAYERS fixture (data.ts) is hardcoded to blue/yellow team_id
  // strings across dozens of unrelated tests. `DEMO_TEAMS()` (a function, not a shared array -- compose
  // clones its OWN objects each time) keeps the demo's own starting roster on the OLD colours on purpose.
  private config: ConfigView = withPolicy({ ...clone(MODES[0].defaults), teams: DEMO_TEAMS() });
  private players: Player[] = [];
  private trying: Record<string, string> = {};
  private standby: Player[] = [];   // STANDBY: parked players (never counted in kit/lobby/readiness)
  private browsing: Record<string, number> = {};
  // F411 (docs/spec/design/games-presets.md): PLAY picks pieces, BUILD creates them. No migration —
  // the old whole-game preset store above this is gone; a fresh session picks the first builtin of
  // every kind.
  private pieces: GamePiece[] = BUILTIN_PIECES();
  private gamePick: GamePick = this.defaultPick();
  private lastMatch?: LastMatch;
  // F411 §6 FAVOURITES: a named bundle of the whole PLAY pick. Memory-only here (as the real
  // `FavouriteStore(None, ...)` fallback is), by `created_t`.
  private favourites: Favourite[] = [];
  private evicted = new Set<string>();
  // A13.5: one utility phone that said hello and is waiting to be assigned (the ITEMS panel demo). Mirrors
  // `Session.stations` / `_station_view` in state.py, including the attention flags the server derives.
  private stations: Record<string, { assigned: StationAssignment | null; armed: StationView['armed']; arm_pending: boolean; report: StationView['report']; seen: number; offline?: boolean; takenAt?: number; takenBy?: number; resetAt?: number;
    /** A58: MC's clock, absent = unlocked -- `unlockStations()` is the one write that clears it. */
    lockUntil?: number; attention?: string[] }> = {
    'util-a1b2c3': { assigned: null, armed: null, arm_pending: false, report: { kind: 'respawn', team: 1, station_id: 1, threshold: -74, live: false, revives: 0, armed: false, battery: 64 }, seen: now() },
    // F106(i): a second seeded phone that is ASSIGNED but OUT OF WI-FI (the operator carried it out to the
    // field before it ever got the arming push) so `?mock` alone can show OUT OF WI-FI / ARM PENDING on the
    // ITEMS panel without live hardware — the first phone's `online` was hard-coded true for every station,
    // so that pair of states could never be demoed (review 2026-09-11 lane-4).
    'util-d4e5f6': { assigned: { kind: 'extraction', team: 255, id: 8, threshold: 0, at: now() - 20 * 60 * 1000 },
                     armed: null, arm_pending: true,
                     report: { kind: 'extraction', team: 255, station_id: 8, threshold: -74, live: true, revives: 0, armed: false, battery: 41 },
                     seen: now() - 20 * 60 * 1000, offline: true },
  };
  private gameNo = 1;
  private gameStarted = false;
  /** A56: a powerup station's live item state on the match clock (`StationView.item_available` /
   *  `next_spawn_at_ms`): spawns at `first_at_s`, then every `spawn_every_s`; an item stays until taken and a
   *  spawn never stacks. Only while a match is armed or live; outside one the fields are absent. */
  private itemState(st: { assigned: StationAssignment | null; takenAt?: number; takenBy?: number; resetAt?: number }): Partial<StationView> {
    const it = st.assigned?.item;
    const t0 = this.live_?.go_live_t ?? this.start_?.go_live_t;
    if (!it || t0 == null || !['armed', 'live'].includes(this.phase)) return {};
    const t = now();
    const spawnAt = (k: number) => t0 + (it.first_at_s + k * it.spawn_every_s) * 1000;
    let k = 0; while (spawnAt(k) <= t) k++;          // k = spawns so far; spawnAt(k) is the next one
    // the item last appeared at the later of the last spawn and a host RESET
    const appeared = Math.max(k > 0 ? spawnAt(k - 1) : -Infinity, st.resetAt ?? -Infinity);
    const available = appeared > -Infinity && (st.takenAt == null || st.takenAt < appeared);
    // as the server: next_spawn_at_ms is the next spawn instant, sent while AVAILABLE too
    return { item_available: available, next_spawn_at_ms: spawnAt(k), ...(!available && st.takenBy != null ? { taken_by: st.takenBy } : {}) };
  }
  /** Demo/test stand-in for a player's `pickup` fact relayed by MC: the item at this station was taken now. */
  pickupStation(node_id: string, player_num?: number) { const st = this.stations[node_id]; if (st) { st.takenAt = now(); st.takenBy = player_num; this.emit(); } }
  async resetStation(node_id: string): Promise<{ ok: boolean }> {
    const st = this.stations[node_id]; if (!st) throw Object.assign(new Error('no such station'), { status: 404, body: { error: 'no such station' } });
    if (mockPowerups() !== 'on') throw new Error('powerups are OFF: Mission Control was started with --no-powerups; drop that flag to give a station an item');
    if (!st.assigned?.item) throw new Error('this station has no item to reset');
    if (!['armed', 'live'].includes(this.phase)) throw new Error(`the match is ${this.phase.toUpperCase()}: an item can be reset only while a match is armed or live`);   // state.py reset_station
    st.resetAt = now(); st.takenAt = undefined; st.takenBy = undefined; this.emit();
    return { ok: true };
  }
  async getPowerups(): Promise<PowerupsView> {
    const m = mockPowerups();
    if (m === 'old') throw Object.assign(new Error('Not Found'), { status: 404 });
    return { enabled: m === 'on', presets: clone(POWERUP_PRESETS) };
  }
  private stationViews(): StationView[] {
    return Object.entries(this.stations).map(([node_id, st]) => {
      const attention: string[] = [];
      const a = st.assigned, rep = st.report;
      const down = this.stoodDown(a);   // F535: stations.py stood_down
      if (down) attention.push(STATION_NO_HILL);
      else if (a && st.arm_pending) attention.push(STATION_BRING_BACK);
      if (a && st.armed && st.armed.game !== this.gameNo && !down) attention.push(STATION_ARMED_OLDER);
      const fresh = !down && !!st.armed && st.seen > st.armed.at;   // a report only contradicts an arming it post-dates (F535: none)
      if (a && fresh && rep.armed === false) attention.push(STATION_NOT_ARMED);
      if (a && fresh && rep.station_id != null && rep.station_id !== a.id) attention.push(`PHONE ADVERTISES ID ${rep.station_id}, ASSIGNED ${a.id}: ${STATION_REARM}`);
      if (batteryLow(rep.battery)) attention.push(STATION_BATTERY_LOW);
      if (this.demoObs.has('claims')) attention.push('3 CLAIM REPORTS DROPPED BY THE STICK: CHECK THE RECAP\'S PICKUPS FOR STATION #4');   // O10: state.py station_claims_dropped_line
      if (this.demoObs.has('nvs')) attention.push('STICK CANNOT SAVE TO FLASH [2 FAILED WRITES], A RESTART LOSES ITS SETTINGS: REPLACE IT');   // O12: stations.py station_nvs_line
      if (this.demoObs.has('stickfw')) attention.push('STICK FIRMWARE TOO OLD: REFLASH IT');   // O13: stations.py STATION_FW_TOO_OLD
      attention.push(...(st.attention ?? []));   // A58 demo/test seed: STATION #N ... lines
      return { node_id, assigned: a, armed: down ? null : st.armed, arm_pending: !down && st.arm_pending, report: rep, app_ver: 'utility',
        last_seen_ms: now() - st.seen, online: !st.offline, attention, game: this.gameNo,
        ...(st.lockUntil ? { lock_until_ms: st.lockUntil } : {}), ...this.itemState(st),
        // A67: the range as the station applies it, with who set it (the mock's stations only ever take MC's)
        // (STRENGTH only as the station reports it, as `state.py _station_range_view`)
        ...(a && (rep.threshold != null || rep.tx_power) ? { range: {
          ...(rep.threshold != null ? { threshold: rep.threshold, threshold_src: a.threshold_src ?? 'mc' } : {}),
          ...(rep.tx_power ? { tx_power: rep.tx_power, tx_power_src: a.tx_power_src ?? 'mc' } : {}) } } : {}) };
    });
  }
  /** The demo's config-proof fault for this gun, or undefined — only under `?mock&faults=1`.
   *
   *  R2-1: STICKY UNTIL THE FIRST RE-PUSH. The point of the switch is to be able to LOOK at the four
   *  states, so they survive the initial push — but a re-push is their cure on a real server, and a
   *  demo whose faults outlived it would be demoing a button that does nothing. `noecho` is exempt:
   *  it is the v4.32 firmware declining to echo its weapon, which no push can change. */
  private faultOf(gun_id?: string | null) {
    if (this.demoReadbackOnly) return !this.demoCured && gun_id === 'GUN-G' ? 'readback' : undefined;
    // F549 `?mock&faults=noconfig`: GUN-A acks no_config (the gun loaded nothing), until the first re-push
    if (this.demoNoConfigOnly) return !this.demoCured && gun_id === 'GUN-A' ? 'noconfig' : undefined;
    const f = this.demoFaults && gun_id ? DEMO_FAULT_GUN[gun_id] : undefined;
    return this.demoCured && f !== 'noecho' ? undefined : f;
  }
  private demoCured = false;
  /** F586: guns whose headset an echo already proved (state.py `ack_config` sets `headset = 'proven'`); a later no_config keeps it. */
  private echoedGuns = new Set<string>();

  /** The `ack_config` this player's phone answers a push with — ONE place, so the initial push and
   *  the A35 re-push after a config edit cannot drift apart (and so the `?mock&faults=1` states are
   *  produced by the same code path a clean demo uses). */
  private ackFor(p: Player, cfgId: string): State['lobby']['acks'][string] {
    const g = GUNS.find(x => x[0] === p.gun_id);
    if (g?.[2] === 'r' && this.gunOverride[g[0]] !== 'g') return { ok: false, err: 'no_echo' };
    // The gun echoes t40, half the configured reserve (frames.py head_spawn_ammo).
    const weapon = WEAPONS.find(w => w.weapon_id === p.loadout.weapons[0]?.weapon_id);
    const echo = `$ALCD,${weapon?.clip ?? 32},100,0,${Math.floor((weapon?.reserve ?? 192) / 2)},0,*`;
    let ack: State['lobby']['acks'][string];
    switch (this.faultOf(p.gun_id)) {
      // The gun answered — for the game BEFORE this one. `ok: true`, which is exactly why truthiness
      // alone missed it on the field (A36).
      case 'stale': ack = { ok: true, gun_echo: '$ALCD,32,100,0,192,0,*', config_id: DEMO_OLD_CFG }; break;
      // Answered this head, with LAST game's magazine.
      case 'echo': ack = { ok: true, gun_echo: '$ALCD,31,100,0,192,0,*', config_id: cfgId }; break;
      case 'readback': ack = { ok: true, gun_echo: '$ALCD,32,100,0,192,0,*', config_id: cfgId,
        gun_config: { player_id: p.player_num, team: 99, hp: 45, armor: 70, shield: 0 } }; break;
      // Answered with `$START`'s `$LCD` and nothing else — the NORMAL answer on v4.32 firmware, and
      // the reason the echo check has a third state at all (A37).
      case 'noecho': ack = { ok: true, gun_echo: '$LCD,0,0,0,0,0,0,*', config_id: cfgId }; break;
      case 'noconfig': ack = { ok: false, err: 'no_config', config_id: cfgId }; break;   // F549: the phone's own ack
      default: ack = { ok: true, gun_echo: echo, config_id: cfgId };
    }
    if (p.gun_id && ack.ok && ack.gun_echo) this.echoedGuns.add(p.gun_id);   // F586: the server keeps `nodes[nid].headset = 'proven'`
    // The server serialises a clear error as null. The generated LobbyAck type still omits null.
    return { err: null, ...ack } as unknown as State['lobby']['acks'][string];   // F549: an ack's own err (no_config) wins
  }

  /** `state.py all_acked()`: every rostered player with a node bound has answered for THIS config. */
  private allAcked() {
    return this.players.length > 0 && this.players.filter(p => p.node_id).every(p => {
      const a = this.acks[p.player_id];
      return !!a && a.ok && !!a.gun_echo && a.config_id === this.config.config_id;
    });
  }
  /** `state.py _updating()` (F178): READY players with a node bound whose gun has not answered the
   *  pushed head (no ack yet, or an ok ack for an older config). A refused ack is a red, not counted. */
  private updating() {
    return sessionUpdating(this.players, this.pushed, this.acks, this.config.config_id);
  }
  /** F535, as stations.py `stood_down`: a CONTROL assignment in a mode with no hill is not armed or allow-listed. */
  private hillBytes = new Set<number>();
  private stoodDown(a: { kind: string } | null | undefined) { return !!a && a.kind === 'control' && !OBJECTIVE_MODES.includes(this.config.mode); }
  private stationIds() { return Object.values(this.stations).flatMap(s => s.assigned && !this.stoodDown(s.assigned) ? [s.assigned.id] : []).sort((a, b) => a - b); }
  private armStation(node_id: string) {
    const st = this.stations[node_id]; if (!st?.assigned) return;
    if (this.stoodDown(st.assigned)) { st.arm_pending = false; return; }
    if (st.assigned.kind === 'control') this.hillBytes.add(this.gameNo);   // F535: stations.py `_hill_bytes`
    st.armed = { game: this.gameNo, at: now(), kind: st.assigned.kind, team: st.assigned.team, id: st.assigned.id };
    st.arm_pending = false;
    // the demo phone applies it, as utility.js does: it now reports what it was told
    st.report = { ...st.report, kind: st.assigned.kind, team: st.assigned.team, station_id: st.assigned.id, threshold: st.assigned.threshold || defaultThreshold(st.assigned.kind, node_id.startsWith('stick-')), armed: true, live: true };
  }
  /** F364, as state.py `_auto_station_id`: a station keeps its id, then the one it was handed, else the lowest free. */
  private stationIdOf: Record<string, number> = {};
  private autoStationId(node_id: string, kind?: string): number {
    const top = kind === 'powerup' ? POWERUP_STATION_ID_MAX : 65535;   // cross-lane #7, as stations.py auto_station_id
    const used = new Set(Object.entries(this.stations).flatMap(([n, s]) => n !== node_id && s.assigned ? [s.assigned.id] : []));
    for (const c of [this.stations[node_id]?.assigned?.id, this.stationIdOf[node_id]]) if (c != null && c <= top && !used.has(c)) return c;
    for (const [n, i] of Object.entries(this.stationIdOf)) if (n !== node_id) used.add(i);
    // bench 2026-10-02: a departed station gets its old number back when nobody holds it and it was not handed on
    const gone = this.departures[node_id]?.id;
    if (gone != null && gone <= top && !used.has(gone)) return gone;
    let id = 1; while (used.has(id)) id += 1;
    return id;
  }
  /** Bench 2026-10-02 (option B), as state.py `_station_departures`: an ASSIGNED station that left ITEMS (its own
   *  BACK TO HUD, or an accepted RELEASE). `line` is derived on every view, as `_departure_line`. */
  private departures: Record<string, Omit<StationDeparture, 'line' | 'label' | 'id_free'>> = {};
  private recordDeparture(node_id: string, reason: StationDeparture['reason'], successor?: string) {
    const a = this.stations[node_id]?.assigned;
    if (!a) {
      // polish r1 M1: back, then gone again before anyone assigned it -- not back any more
      const old = this.departures[node_id];
      // polish r2: a genuine second departure (it had come back) restamps when and how it left; the HUD hello after a
      // RELEASE (never back in between) does not overwrite the release (state.py `_record_departure`)
      if (old) { if (old.returned) { old.reason = reason; old.at_ms = now(); } old.returned = false; if (successor) old.successor = successor; }
      return;
    }
    const restore: StationDeparture['restore'] = { kind: a.kind, team: a.team, threshold: a.threshold, ...(a.tx_power ? { tx_power: a.tx_power } : {}) };
    const it = a.item;
    const preset = it ? POWERUP_PRESETS.find(p => p.item.kind === it.kind && (p.item.weapon_id ?? null) === (it.weapon_id ?? null))?.preset : undefined;
    if (it && preset) {
      restore.item_preset = preset; restore.spawn_every_s = it.spawn_every_s;
      if (it.kind === 'weapon' && it.charges != null) restore.charges = it.charges;
      if (it.kind === 'overshield' && it.amount != null) restore.amount = it.amount;
    }
    // the mock's stations report no platform, so every one is a PHONE (state.py `_device_label`)
    this.departures[node_id] = { node_id, kind: a.kind, id: a.id, team: a.team, threshold: a.threshold,
      ...(a.tx_power ? { tx_power: a.tx_power } : {}), ...(it ? { item: clone(it) } : {}),
      ...(successor ? { successor } : {}), reason, at_ms: now(), returned: false, restore };
  }
  /** polish r1 M3, as state.py `_departure_label`: the player whose HUD the phone became, else what the card shows. */
  private departureLabel(d: Omit<StationDeparture, 'line' | 'label' | 'id_free'>): string {
    // overnight review L8: once the same utility node is back (`returned`), it is not that player's HUD any more
    const p = d.successor && !d.returned ? this.players.find(x => x.node_id === d.successor) : undefined;
    if (p) return `NOW ${p.display.toUpperCase()}'S HUD`;
    return `${d.platform === 'esp32' ? 'STICKS3' : 'PHONE'} ${d.node_id.slice(0, 12)}`;
  }
  /** polish r1 L1, as state.py `_departure_id_free`. */
  private departureIdFree(d: { node_id: string; id: number; kind?: string }): boolean {
    if (d.kind === 'powerup' && d.id > POWERUP_STATION_ID_MAX) return false;   // cross-lane #7, as stations.py
    if (Object.entries(this.stations).some(([n, s]) => n !== d.node_id && s.assigned?.id === d.id)) return false;
    return !Object.entries(this.stationIdOf).some(([n, i]) => n !== d.node_id && i === d.id);
  }
  /** O2: `POST /api/armory/corrupt/dismiss`. */
  async dismissArmoryCorrupt(): Promise<{ ok: boolean; dismissed: boolean }> {
    const dismissed = this.demoArmoryCorrupt;
    this.demoArmoryCorrupt = false; this.emit();
    return { ok: true, dismissed };
  }
  /** polish r1 M2(b): `DELETE /api/stations/{node_id}/departure`. */
  async dismissDeparture(node_id: string): Promise<{ ok: boolean }> {
    if (!this.departures[node_id]) throw Object.assign(new Error('NO DEPARTED STATION BY THAT ID: REFRESH ITEMS'), { status: 404 });
    delete this.departures[node_id]; this.emit();
    return { ok: true };
  }
  private departureLine(d: Omit<StationDeparture, 'line' | 'label' | 'id_free'>): string {
    const stick = d.platform === 'esp32';
    const what = d.reason === 'back_to_hud' ? 'WENT BACK TO HUD' : stick ? 'WAS RELEASED' : 'WAS RELEASED TO ITS HUD';
    const t = new Date(d.at_ms), at = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    const online = d.returned && !this.stations[d.node_id]?.offline;
    const act = online ? 'IT IS BACK, SO TAP RESTORE ON ITS ITEMS CARD TO ASSIGN IT AGAIN'
      : d.returned ? 'IT IS BACK BUT OUT OF WI-FI: BRING IT BACK INTO WI-FI, THEN TAP RESTORE ON ITS ITEMS CARD'
      : stick ? 'BRING IT BACK INTO WI-FI, THEN TAP RESTORE IN THE ARMORY TO ASSIGN IT AGAIN'
      : 'SWITCH IT BACK TO UTILITY, THEN TAP RESTORE IN THE ARMORY TO ASSIGN IT AGAIN';
    const name: Record<StationKind, string> = STATION_KIND_SHORT;   // the server's own short names (stations.py), generated
    return `${name[d.kind] ?? d.kind.toUpperCase()} ${d.id} (${this.departureLabel(d)}) ${what} AT ${at}: ${act}`;
  }
  /** Overnight review L4, as state.py `_keep_stored_overrides`: the same preset sent with NO override key (a console
   *  from before S-powerup-overrides) keeps the stored CHARGES/AMOUNT/RESPAWN, only where they differ from the default. */
  private keepStoredOverrides<A extends { item_preset?: string; charges?: number; amount?: number; spawn_every_s?: number }>(node_id: string, a: A): A {
    if (typeof a.item_preset !== 'string' || ('charges' in a) || ('amount' in a) || ('spawn_every_s' in a)) return a;
    const prev = this.stations[node_id]?.assigned?.item;
    const p = POWERUP_PRESETS.find(x => x.preset === a.item_preset);
    if (!prev || !p || p.item.kind !== prev.kind || (p.item.weapon_id ?? null) !== (prev.weapon_id ?? null)) return a;
    const kept: { charges?: number; amount?: number; spawn_every_s?: number } = {};
    if (prev.spawn_every_s != null && prev.spawn_every_s !== p.item.spawn_every_s) kept.spawn_every_s = prev.spawn_every_s;
    if (prev.kind === 'weapon' && prev.charges != null && prev.charges !== p.item.charges) kept.charges = prev.charges;
    if (prev.kind === 'overshield' && prev.amount != null && prev.amount !== p.item.amount) kept.amount = prev.amount;
    return { ...a, ...kept };
  }
  private departureViews(): StationDeparture[] {
    return Object.values(this.departures).sort((x, y) => x.at_ms - y.at_ms).map(d => ({ ...clone(d), label: this.departureLabel(d), id_free: this.departureIdFree(d), line: this.departureLine(d) }));
  }
  async putStation(node_id: string, a: { kind: StationKind; team: number | string; id?: number; threshold?: number; item_preset?: string; tx_power?: TxPower;
    charges?: number; amount?: number; spawn_every_s?: number }): Promise<StationView> {
    a = this.keepStoredOverrides(node_id, a);
    // A67, as `state.py _set_station_range_only`: a RANGE/STRENGTH-only change of an assigned station, any phase.
    // S-powerup-overrides (2026-09-28): the requested ITEM (preset + overrides) must also match the one already
    // assigned, or this is not range-only -- it falls through to the normal path below, which refuses an item
    // change in play exactly as it refuses a kind/team change in play.
    const prev = this.stations[node_id]?.assigned;
    const inPlay = this.phase === 'armed' || this.phase === 'live';
    const sameKindTeamId = !!prev && prev.kind === a.kind && (a.id == null || prev.id === a.id) && prev.team === a.team;
    let sameItem = true;
    if (sameKindTeamId) {
      if (a.item_preset != null) {
        try {
          const p = POWERUP_PRESETS.find(x => x.preset === a.item_preset);
          sameItem = !!p && JSON.stringify(applyOverrides(clone(p.item), a)) === JSON.stringify(prev!.item ?? null);
        } catch { sameItem = false; }
      } else if (a.charges != null || a.amount != null || a.spawn_every_s != null) {
        sameItem = false;   // an override with no item_preset is not a range-only shape; let the normal path refuse it
      }
    }
    if (sameKindTeamId && sameItem) {
      const thr = a.threshold ?? 0;
      if (!Number.isInteger(thr) || (thr !== 0 && (thr < STATION_THRESHOLD_MIN_DBM || thr > STATION_THRESHOLD_MAX_DBM))) throw new Error("threshold must be 0 (the station's own default) or an integer dBm in -100..-30 (the presence bubble)");
      const moved = thr !== prev!.threshold || (a.tx_power != null && a.tx_power !== prev!.tx_power);
      if (!moved) {
        // nothing moved: in play that is the view as it is, not a refusal; outside play the full path runs
        if (inPlay) return this.stationViews().find(v => v.node_id === node_id)!;
      } else {
        if (a.tx_power != null && !['ultra_low', 'low', 'medium', 'high'].includes(a.tx_power)) throw new Error('tx_power must be one of ultra_low, low, medium, high');
        this.stations[node_id].assigned = { ...prev!, threshold: thr, threshold_src: 'mc', at: now(),
          ...(a.tx_power != null ? { tx_power: a.tx_power, tx_power_src: 'mc' as const } : {}) };
        this.armStation(node_id); this.emit();
        return this.stationViews().find(v => v.node_id === node_id)!;
      }
    }
    // as `state.py set_station`: no station PUT while the match is armed or live (players already hold
    // `config.stations`, and A56's items are locked for the match)
    if (inPlay) {
      throw Object.assign(new Error(`the match is ${this.phase.toUpperCase()}: stations and their items are locked for the match -- RECALL or END it first`), { status: 400 });
    }
    if (!STATION_KINDS.includes(a.kind)) throw new Error(`kind must be one of ${STATION_KINDS.join(', ')}`);
    // S-powerup-overrides: CHARGES/AMOUNT/RESPAWN are optional siblings of `item_preset`, never free-standing.
    const overrideKeys = (['charges', 'amount', 'spawn_every_s'] as const).filter(k => a[k] != null);
    if (overrideKeys.length && a.item_preset == null) throw Object.assign(new Error(`${overrideKeys[0].toUpperCase()} NEEDS item_preset IN THE SAME REQUEST`), { status: 400 });
    let item: StationAssignment['item'];
    if (a.item_preset != null) {
      if (mockPowerups() !== 'on') throw new Error('powerups are OFF: Mission Control was started with --no-powerups; drop that flag to give a station an item');   // powerups.py REFUSED_FLAG_OFF
      if (a.kind !== 'powerup') throw new Error(`item_preset is for a powerup station, not '${a.kind}'`);   // MC writes {kind!r}: a string, so quoted
      const p = POWERUP_PRESETS.find(x => x.preset === a.item_preset);
      if (!p) throw new Error(`unknown item_preset '${a.item_preset}': one of ${POWERUP_PRESETS.map(x => x.preset).join(', ')}`);
      item = applyOverrides(clone(p.item), a);
    }
    let team: number;
    if (typeof a.team === 'string') {
      if (a.team === 'any' || a.team === 'ffa') team = STATION_TEAM_ANY;
      else { const t = TEAMS.find(t => t.team_id === a.team); if (!t) throw new Error(`team '${a.team}' is not a team_id in this game (or 'any')`); team = t.tid; }
    } else team = a.team;
    if (!([0, 1, 2, 3].includes(team) || team === STATION_TEAM_ANY)) throw new Error("team must be a $TID 0-3, a team_id, or 'any' (255)");
    if (a.kind === 'control' && team !== STATION_TEAM_ANY) throw new Error("a control point starts NEUTRAL and is taken by presence (spec/utility.md §5d): team must be 'any'");
    const id = a.id ?? this.autoStationId(node_id, a.kind);
    if (!Number.isInteger(id) || id < 1 || id > 65535) throw new Error('id must be an integer 1..65535 (the station id in the advert), or absent for MC to assign one');
    // cross-lane #7: mirrors stations.py set_station (the powerup claim advert carries the id in one byte)
    if (a.kind === 'powerup' && id > POWERUP_STATION_ID_MAX) throw new Error(`A POWERUP STATION NEEDS AN ID FROM 1 TO ${POWERUP_STATION_ID_MAX} (ITS CLAIM ADVERT CARRIES ONE BYTE): GIVE IT A LOWER ID, OR CLEAR THE ID SO MC ASSIGNS ONE`);
    const clash = Object.entries(this.stations).find(([n, s]) => n !== node_id && s.assigned?.id === id);
    if (clash) throw new Error(`station id ${id} is already assigned to ${clash[0]}; ids must be unique on the field`);
    // F345, as state.py `set_station`: 0 (and absent) = the station's own platform default
    const threshold = a.threshold ?? 0;
    if (!Number.isInteger(threshold) || (threshold !== 0 && (threshold < STATION_THRESHOLD_MIN_DBM || threshold > STATION_THRESHOLD_MAX_DBM))) throw new Error("threshold must be 0 (the station's own default) or an integer dBm in -100..-30 (the presence bubble)");
    const st = this.stations[node_id] ?? (this.stations[node_id] = { assigned: null, armed: null, arm_pending: false, report: {}, seen: now() });
    this.stationIdOf[node_id] = id;
    delete this.departures[node_id];   // bench 2026-10-02: assigned again (RESTORE or anew)
    // polish r1 M2(a): KOTH has one hill, so a new hill answers every hill that left
    if (a.kind === 'control') for (const [n, d] of Object.entries(this.departures)) if (d.kind === 'control') delete this.departures[n];
    st.assigned = { kind: a.kind, team, id, threshold, at: now(), ...(item ? { item } : {}), ...(a.tx_power ? { tx_power: a.tx_power } : {}) };
    st.takenAt = undefined; st.takenBy = undefined; st.resetAt = undefined;
    for (const n of Object.keys(this.stations)) this.armStation(n);
    this.emit();
    return this.stationViews().find(v => v.node_id === node_id)!;
  }
  async deleteStation(node_id: string) {
    const st = this.stations[node_id]; if (!st) throw Object.assign(new Error('no such station'), { status: 404 });
    st.assigned = null; st.armed = null; st.arm_pending = false; this.emit();
  }
  async armStations() { for (const n of Object.keys(this.stations)) this.armStation(n); this.emit(); return { ok: true, armed: this.stationIds().length, pending: [] }; }
  /** A58: `POST /api/stations/unlock` -- a lock value of 0 to every ASSIGNED station, any phase. */
  async unlockStations() {
    for (const st of Object.values(this.stations)) if (st.assigned) st.lockUntil = undefined;
    this.emit();
    return { ok: true, armed: this.stationIds().length, pending: [] };
  }
  /** A41/F184: accepted RELEASE clears deployment truth but retains the card until a proven HUD hello. */
  async releaseStation(node_id: string): Promise<{ ok: boolean }> {
    const st = this.stations[node_id]; if (!st) throw Object.assign(new Error('no such station'), { status: 404 });
    if (st.offline) return { ok: false };
    this.recordDeparture(node_id, 'released');   // bench 2026-10-02: before the assignment goes
    st.assigned = null; st.armed = null; st.arm_pending = false;
    for (const n of Object.keys(this.stations)) this.armStation(n);
    this.emit();
    return { ok: true };
  }
  /** Test/demo stand-in for NetServer's authenticated `prior_utility` handoff on the first HUD hello. */
  confirmStationHud(node_id: string, successor?: string) {
    this.recordDeparture(node_id, 'back_to_hud', successor);   // bench 2026-10-02: a no-op after a RELEASE (already unassigned)
    delete this.stations[node_id]; delete this.stationIdOf[node_id];   // F364: a station that became a HUD frees its number
    this.emit();
  }
  /** Test/demo stand-in for a utility hello (`state.py _on_node`'s utility branch): the node is back as an
   *  UNASSIGNED station, and a departure of the same node is offered for RESTORE. Never restored on its own. */
  utilityHello(node_id: string) {
    this.stations[node_id] ??= { assigned: null, armed: null, arm_pending: false, report: {}, seen: now() };
    this.stations[node_id].seen = now(); this.stations[node_id].offline = false;
    const gone = this.departures[node_id]; if (gone) gone.returned = true;
    this.emit();
  }
  private pushed = false;
  // LOAD (2026-09-13): the GAME has been announced to the phones. Deliberately SEPARATE from
  // `pushed`, which means "the guns have a head" -- Tony: "weapons have to go with the arm". The
  // demo has to predict that split or `?mock` shows a console the real server cannot produce.
  private gameLoaded = false;
  private gameCfg: string | null = null;
  private gameSent: Record<string, string> = {};   // player_id -> config_id a socket accepted
  private cachedCompilerResult?: ReturnType<typeof compilerValidation>;
  private cachedCoverageLevel?: Coverage['level'];
  private readonly mockOptions: { releaseVersion?: string; syncDemo?: boolean };
  private acks: State['lobby']['acks'] = {};
  private start_?: State['start'];
  // A25: the session option table and the per-node log state, mirrored so `?mock` shows the LOG SYNC
  // switch and the LOGS button doing something. The demo field is deliberately MIXED — one phone
  // holding with a reason, one mid-upload, one delivered — because a board where every row says the
  // same thing proves nothing about the states the operator has to tell apart.
  private options: { log_sync: 'auto' | 'manual' } = { log_sync: 'auto' };
  private logs: Record<string, LogView> = {};
  private live_?: { rows: LiveRow[]; go_live_t: number; match_id: string };
  private feed_: FeedEntry[] = [];
  private staleTold = new Map<string, number>();
  private retiredMatches: string[] = [];
  // One record per phone, as state.py keeps on nv. A report replaces the previous claim.
  private nodeReports: Record<string, { lastSeen: number; pool_stale?: LiveRow['pool_stale']; pool_stale_ms?: number;
    cure?: LiveRow['cure']; gun_locked?: boolean; protect_owed?: boolean; pending?: number;
    arm_state?: string; match_id?: string; end?: EndReceipt }> = {};
  private reportedAppVersions: Record<string, string> = {};
  private scorerFlushed = new Set<string>();
  private endDeliveryTold?: string;
  private disconnectedNodes = new Set<string>();
  // A bound, alive phone reports protection owed after go-live, then stops reporting.
  private demoQuietNodeId?: string;
  private demoQuietUntil?: number;
  private nodeAge(node_id?: string | null): number | null {
    const seen = node_id ? this.nodeReports[node_id]?.lastSeen : undefined;
    return seen === undefined ? null : now() - seen;
  }
  private reportNode(node_id: string, lastSeen = now(), claim: Omit<(typeof this.nodeReports)[string], 'lastSeen'> = {}) {
    this.disconnectedNodes.delete(node_id);
    const previous = this.nodeReports[node_id];
    this.nodeReports[node_id] = { lastSeen, ...claim,
      ...(previous?.end ? { end: previous.end } : {}),
      ...(previous?.pending !== undefined && claim.pending === undefined ? { pending: previous.pending } : {}) };
    const end = this.nodeReports[node_id].end;
    if (end) {
      const confirmed = sessionNoteEndConfirm(end, claim.arm_state, claim.match_id);
      this.nodeReports[node_id].end = confirmed;
      if (!end.confirmed && confirmed.confirmed && end.tries > 1) {
        const display = this.players.find(p => p.player_id === end.player_id)?.display || end.player_id;
        this.feed({ t_match_s: 0, kind: 'alert', tag: 'END',
          text: sessionNoteEndConfirmLine(display, end.since, lastSeen, end.tries) });
      }
    }
    // state.py _check_stale_live(): an ARMED/LIVE heartbeat for a retired match gets END now.
    const mid = claim.match_id;
    const current = this.phase === 'armed' ? this.start_?.match_id : this.phase === 'live' ? this.live_?.match_id : undefined;
    const retired = mid ? mid !== current && this.retiredMatches.includes(mid) : !current && this.retiredMatches.length > 0;
    if ((claim.arm_state === 'armed' || claim.arm_state === 'live') && retired) {
      const key = `${node_id}:${mid ?? ''}`;
      const told = this.staleTold.get(key);
      if (told === undefined || lastSeen - told >= STALE_LIVE_RETELL_MS) {
        this.staleTold.set(key, lastSeen);
        if (mid && end?.match_id === mid) this.nodeReports[node_id].end = sessionEndDeliveryTried(end, mid, lastSeen, this.nodeConnected(node_id));
      }
    }
  }
  private rowClaims(): Record<string, (typeof this.nodeReports)[string]> {
    return Object.fromEntries(this.players.filter(p => p.node_id && this.nodeReports[p.node_id])
      .map(p => [p.player_id, this.nodeReports[p.node_id!]]));
  }
  private recap_?: RecapView;
  private history_: MatchHistoryRow[] = [];
  private gunOverride: Partial<Record<string, 'g' | 'r'>> = {};
  private timer: number | null = null;
  private session_id = uid('sess');
  // A28: the demo's own tunnel — off by default, available (cloudflared "found"), never manual —
  // so ?mock can walk the whole TURN ON -> STARTING -> UP loop without a real server.
  private joinSecret = 'k7q2m9xz';
  private tunnelStatus: TunnelStatus = 'off';
  private tunnelWasUp = false;
  private tunnelWsUrl: string | null = null;
  private tunnelProvider: TunnelProvider = null;
  private tunnelAvailable = true;
  private tunnelError?: string;
  private tunnelTimer: number | null = null;
  // Mock-only debug hook, read once at construction: `?mock&tunnelfail=1` makes the NEXT TURN ON fail
  // instead of coming up, so the e2e suite (and a human) can drive the persistent "TUNNEL DOWN" banner
  // without a real cloudflared process to kill. One-shot, like a real flaky start.
  // Mock-only debug hook: `?mock&allgreen=1` turns every linked row green, so ARMORY's HARDWARE READY ▸
  // and ENABLE BACKHAUL (bench 2026-09-17) can be seen in a browser. The default demo keeps a red gun.
  private demoAllGreen = typeof location !== 'undefined' && new URLSearchParams(location.search).get('allgreen') === '1';
  private tunnelFailNext = typeof location !== 'undefined' && new URLSearchParams(location.search).get('tunnelfail') === '1';
  // F181 browser fixture: keep the ordinary live clock/status tick, but let a walk own every score transition.
  // This is query-gated mock behavior only; the default interactive demo retains its random background kills.
  private demoNoRandomKills = typeof location !== 'undefined' && new URLSearchParams(location.search).has('norandom');
  // the server's validate() errors ride on every snapshot (config_errors); the demo used to hardcode []
  // so a refusal shown in the PUT response vanished from the rail on the very next tick
  private cfgErrors: string[] = [];
  // F155/F143/F142 demo hooks — none change default `?mock` behaviour, each proves one field fix:
  private lastReach: Record<string, 'lan' | 'backhaul'> = {};
  /** `?mock&laststale=1` — one node goes dark with a known internet-tunnel history, so the console can
   *  show "NOT REACHED FOR Ns" (and "TUNNEL DOWN" once the tunnel is also off) without a real dropped
   *  socket to arrange. */
  // Bench 2026-09-17: `?mock&flap=1` shows GUN-C with its headset off, so its phone reports `gun_flapping`.
  private demoFlap = typeof location !== 'undefined' && new URLSearchParams(location.search).get('flap') === '1';
  private demoLastStale = typeof location !== 'undefined' && new URLSearchParams(location.search).get('laststale') === '1';
  /** `?mock&nossid=1` — MC could not read the phone's Wi-Fi network name (any platform without a
   *  detector), so the REACH block must print "LAN · ip:port", never a mode word standing in for one. */
  private demoNoSsid = typeof location !== 'undefined' && new URLSearchParams(location.search).get('nossid') === '1';
  /** `?mock&lanwarn=1` — T3-A (field 2026-09-12): MC is running under WSL and nothing has told it the
   *  advertised address is already correct, so the CommandBar's reachability banner must be visible
   *  without a real WSL host to boot MC on. Wording mirrors `netinfo.WSL_UNREACHABLE_WARNING` server-side
   *  (kept in sync by hand -- there is no shared string across the Python/TS boundary). */
  private demoArmoryCorrupt = typeof location !== 'undefined' && new URLSearchParams(location.search).get('armorycorrupt') === '1';
  private demoLanWarning = typeof location !== 'undefined' && new URLSearchParams(location.search).get('lanwarn') === '1';
  /** `?mock&restored=1` — a `--demo` (or any prior) session persisted and was silently restored: two
   *  ghost players with no phone ever bound sit on the roster from the first snapshot. */
  /** `?mock&obs=store,archive,snapshot,tick,join,outbox,claims` (O6/O7/O8/O10): each names one failure MC reports on the
   *  snapshot, mirroring state.py `snapshot()` (per match: `outbox_lost`/`claims_dropped` are "lost THIS match") (`not_saving`, `ticker_failing`, `join_error`, `NodeView.outbox_lost`,
   *  and the station line `station_claims_dropped_line`). Absent = a healthy MC, the default demo. */
  private demoObs = new Set((typeof location !== 'undefined' ? new URLSearchParams(location.search).get('obs') ?? '' : '').split(',').filter(Boolean));
  private demoRestored = typeof location !== 'undefined' && new URLSearchParams(location.search).get('restored') === '1';
  // The delay before the mock re-acks a re-pushed config (see `putConfig`). A test can make it longer,
  // so that a slow machine still reads the transitional "re-pushing" state before the acks return.
  // `?repushack=<ms>` sets it in the browser; a unit test sets the field directly.
  repushAckMs = (typeof location !== 'undefined' && Number(new URLSearchParams(location.search).get('repushack'))) || 220;
  /** `?mock&faults=1` — five config-proof states, on five otherwise-green guns, so every
   *  one of them can be looked at without a field and a stale gun. Until this existed the mock always
   *  acked with the config it had just pushed, which meant `?mock` could demo exactly none of them
   *  and the console's rendering of all four was unverifiable by eye. STICKY: the faults survive a
   *  re-push (the point is to look at them), so this is a demo switch, not a scripted failure. */
  private demoReadbackOnly = typeof location !== 'undefined' && new URLSearchParams(location.search).get('faults') === 'readback';
  private demoNoConfigOnly = typeof location !== 'undefined' && new URLSearchParams(location.search).get('faults') === 'noconfig';
  private demoFaults = typeof location !== 'undefined' && ['1', 'stale', 'on', 'readback'].includes(new URLSearchParams(location.search).get('faults') ?? '');
  /** T2 review S5: the phones this demo treats as having GONE SILENT, keyed by gun tail. `state.py`
   *  raises `stale` on a node nothing has been heard from in STALE_AFTER_MS (8 s) and clears it on the
   *  next heartbeat; `unrostered_phone_count()` skips a stale node, because a phone that said hello
   *  wearing a gun and then walked off the field must stop propping up "N CONNECTED PHONES NOT IN THE
   *  ROSTER" with nothing claimable behind it on ARMORY. The mock had no stale node of any kind, so
   *  `?mock` could not predict that rule at all. */
  /** `?mock&stalephone=1` — two phones are wearing guns nobody claims and ONE of them has gone silent,
   *  so the banner must read 1, not 2. The rule is only legible when both cases are on screen at once. */
  private demoStalePhone = typeof location !== 'undefined' && new URLSearchParams(location.search).get('stalephone') === '1';
  private restoredFrom: { at: number; players: number } | null = null;
  /** `?mock&orphan=1` — bench 2026-09-17: two bound phones report a LIVE match this MC did not start (MC
   *  restarted with no snapshot). Mirrors `state.py orphan_match_view()`: present only while unresolved,
   *  RESUME MATCH adopts it (MUSTER/BUILD/KIT/LOBBY only), END THEIR MATCH clears it. */
  private orphan_: { match_id: string; player_ids: string[] } | null =
    typeof location !== 'undefined' && new URLSearchParams(location.search).get('orphan') === '1'
      ? { match_id: 'm-lost', player_ids: ['p1', 'p2'] } : null;
  /** `?mock&stationlock=1` — A58: seeds the seeded powerup station (`util-a1b2c3`, assigned once
   *  `putStation` runs) with a live tamper lock and a RESTARTED attention line, so `StationAlerts` and
   *  the ITEMS card's LOCKED tag can be seen without a real station bench. */
  private demoStationLock = typeof location !== 'undefined' && new URLSearchParams(location.search).get('stationlock') === '1';

  constructor(mockOptions: { releaseVersion?: string; syncDemo?: boolean } = {}) {
    this.mockOptions = mockOptions;
    this.players = PLAYERS.map(([display, team_id, gi], i) => ({
      player_id: `p${i + 1}`, player_num: i + 1, display, team_id,
      node_id: GUNS[gi][2] === 'r' ? null : `node_${GUNS[gi][1]}`,
      gun_id: GUNS[gi][0], loadout: clone(DEMO_LOADOUTS[i % DEMO_LOADOUTS.length]),
      voice: 'male', ready: READY[display] ?? false,
    }));
    for (const [, tail, kind, , linkAge] of GUNS) {
      if (kind !== 'r') this.reportNode(`node_${tail}`, now() - linkAge * 1000);
    }
    this.trying = { p4: 'smg' };
    this.browsing = { p6: now() };   // SABLE is browsing on the phone
    // F155 pass 1 (2026-09-12): GUN-F reported backhaul EARLIER this session, then dropped — `lastReach`
    // is what `readiness()` reads for the row's own `last_reach` (below), so it must be seeded before
    // the override forces the row red, or the row would show no history at all (this is what made the
    // earlier version of this demo bolt on a second, disconnected NodeView instead — the actual source
    // of the "NEVER THIS SESSION" + "NOT REACHED FOR" contradiction pass 1 caught).
    if (this.demoLastStale) { this.lastReach['A0B3'] = 'backhaul'; this.gunOverride['GUN-F'] = 'r'; }
    if (this.demoLastStale) this.reportNode('node_A0B3', now() - 130_000);
    // F3 (iteration 3): under `?mock&faults=1` the one row NO push can cure is a phone that has not
    // arrived, not a gun nobody switched on. That is what makes the RE-PUSH's two labels visible: the
    // FIRST push is refused unforced (nothing reaches a phone that is not here), and the RE-push is
    // ORDINARY — the head is handed over on that phone's hello — so the button reads plain
    // `RE-PUSH CONFIG ▸` rather than the forcing `OVER 1 BLOCKED` variant.
    // `?mock&allgreen=1` means every gun and phone is here: GUN-D is switched on and DRIFT's phone has joined
    // (with no phone the server could only show DRIFT waiting, never green).
    if (this.demoAllGreen) {
      this.gunOverride['GUN-D'] = 'g';
      for (const [, tail] of GUNS) this.reportNode(`node_${tail}`);
      const drift = this.players.find(x => x.gun_id === 'GUN-D');
      if (drift) drift.node_id = 'node_22E8';
    }
    if (this.demoFaults) {
      this.gunOverride['GUN-D'] = 'g';
      const drift = this.players.find(x => x.gun_id === 'GUN-D');
      if (drift) drift.node_id = null;
    }
    // F142 (field 2026-09-12, ISSUE 11/11b): two ghosts with no phone ever bound, exactly as a
    // restored `--demo` session left them on a real board — present from the FIRST snapshot, same as
    // the real bug (the banner has to be there before the operator ever does anything).
    if (this.demoRestored) {
      this.players.push(
        { player_id: 'p_ghost1', player_num: 9, display: 'ALPHA', team_id: 'blue', node_id: null, gun_id: 'GUN-A', loadout: { weapons: [{ weapon_id: 'assault_rifle' }], perk: null }, voice: 'male', ready: false },
        { player_id: 'p_ghost2', player_num: 10, display: 'BRAVO', team_id: 'yellow', node_id: null, gun_id: 'GUN-B', loadout: { weapons: [{ weapon_id: 'assault_rifle' }], perk: null }, voice: 'male', ready: false },
      );
      this.restoredFrom = { at: now() - 11 * 60 * 60 * 1000, players: 2 };   // "last night", like the field find
    }
    // T2 review S5: drop two players so their phones become strays, then silence one of the two. The
    // banner counts the phone that is still here and NOT the one that left, which is the whole rule.
    if (this.demoStalePhone) {
      this.players = this.players.filter(p => p.gun_id !== 'GUN-G' && p.gun_id !== 'GUN-H');
      // GUN-H's seeded 52-second receipt is the silent phone.
    }
    // A58: seed the already-assigned station (util-d4e5f6) with a live lock and a RESTARTED line, so
    // StationAlerts / UNLOCK STATIONS / the ITEMS LOCKED tag can all be seen from `?mock&stationlock=1`.
    if (this.demoStationLock) {
      const st = this.stations['util-d4e5f6'];
      st.lockUntil = now() + 6 * 60 * 1000;
      st.attention = ['STATION #8 RESTARTED 2 TIMES: CHECK THE STATION'];
    }
    this.timer = window.setInterval(() => this.tick(), 1000);
  }

  // ---------- state assembly ----------
  /** A29 — what each demo phone reports as its build. Deliberately NOT uniform: the muster summary and
   *  the amber row only mean anything on a field that is mixed, and that is the field we keep having. */
  private appVer(sticker: string): { app_ver: string; platform: string } {
    const old = sticker === 'GUN-C' || sticker === 'GUN-H';
    const gun = GUNS.find(row => row[0] === sticker);
    const nodeId = gun ? `node_${gun[1]}` : '';
    return { app_ver: this.reportedAppVersions[nodeId] ?? (old ? '0.1.8+99ffee1' : '0.1.9+ab12cd3'),
      platform: sticker === 'GUN-A' ? 'ios' : 'android' };
  }

  /** A phone hello may report a new app build after an update (state.py _note_version). */
  private reportAppVersion(nodeId: string, version: string): void {
    this.reportedAppVersions[nodeId] = version;
    this.reportNode(nodeId);
    this.emit();
  }
  /** Test-only phone hello seam. The mock's public API has no version-report command. */
  readonly __test = { reportAppVersion: (nodeId: string, version: string) => this.reportAppVersion(nodeId, version) };

  /** A25 demo states, seeded once per node and then moved by the LOGS button. */
  private logFor(node_id: string): LogView {
    if (!this.logs[node_id]) {
      const seed: Record<string, LogView> = {
        node_3D4F: { state: 'complete', lines: 812, bytes: 41_233, last_t: now() - 40_000 },
        node_91C2: { state: 'pulling', lines: 240, bytes: 9_100, last_t: now() - 2_000 },
        node_7A10: { state: 'held', reason: '2 facts pending', last_t: now() - 15_000 },
        node_5D77: { state: 'offered', lines: 1_004, bytes: 55_800, last_t: now() - 9_000 },
      };
      this.logs[node_id] = seed[node_id] ?? { state: 'none', last_t: now() };
    }
    return { ...this.logs[node_id] };
  }

  /** `state.py one_team_fault()`, mirrored — round-2 fix pass B, corrected by round-3 MERGE-0.
   *
   *  `(declared teams >= 2) and (rostered players >= 2) and (populated $TIDs < 2)`. Stated on the
   *  TIDs, not the team ids, because the TID is what the gun reads: two config teams sharing one tid
   *  are ONE side however they are named, and the old "every declared team is populated" rule was
   *  wrong in both directions — it refused a perfectly playable 2/2/0 across three declared teams,
   *  and it passed a 2 v 2 that no hit could register in. Scoped on the TEAM COUNT rather than the
   *  mode name because `ffa`/`lms` declare the single `ffa` team, where sharing it is the design; and
   *  on 2+ players, because "one side" says nothing about a solo session. `force` does not open it,
   *  here or on the server. */
  private populatedTids(): Set<number> {
    const byTeam = new Map((this.config.teams ?? []).map(t => [t.team_id, t.tid]));
    const out = new Set<number>();
    for (const p of this.players) {
      const tid = byTeam.get(p.team_id ?? '');
      if (tid !== undefined) out.add(tid);
    }
    return out;
  }

  private oneTeamFault(): boolean {
    if ((this.config.teams ?? []).length < 2 || this.players.length < 2) return false;
    // FFA shares one team BY DESIGN. On the server that falls out of the team count
    // (`default_config("ffa")` declares a single team); here a bare `{ mode: 'ffa' }` patch leaves the
    // previous mode's `teams` in place, so the clause is stated as well as implied — both sides ask
    // the identical question, which is the whole point of MERGE-0.
    if (this.config.mode === 'ffa') return false;
    return this.populatedTids().size < 2;
  }

  private rosterFault(): string | null {
    return this.oneTeamFault() ? LOCAL_ONE_TEAM_FAULT : null;
  }

  /** `state.py _reteam_for_config()`, mirrored — round-3 FIELD-1.
   *
   *  Map by team INDEX (so a TDM blue/yellow split survives a KOTH pick as blue/purple), least-count
   *  fill anyone the new config has no index for, and rebalance ONLY when the one-side predicate is
   *  then true. The demo used to do what the server used to do — dump everyone onto `teams[0]` — so
   *  `?mock` stranded itself on one side on every cross-family mode pick, which is a demo predicting
   *  a state the real MC no longer produces. */
  private reteamForConfig(prevTeams: { team_id: string }[]) {
    const ids = this.config.teams.map(t => t.team_id);
    const legal = new Set(ids);
    const byOldIndex = new Map(prevTeams.map((t, i) => [t.team_id, i]));
    const prevIds = new Set(prevTeams.map(t => t.team_id));
    const setChanged = prevIds.size !== legal.size || [...prevIds].some(id => !legal.has(id));
    const countChanged = prevTeams.length !== ids.length;
    // Tony 2026-09-27 (server state.py _reteam_for_config): a same-count colour change RECOLOURS by index
    // and moves nobody, so a deliberate 1-v-3 stays 1-v-3. Every player on the old teams[i] takes the new
    // teams[i], even one whose old colour is still legal (leaving them put would merge two sides).
    const recolour = setChanged && !countChanged;
    const unplaced: typeof this.players = [];
    for (const p of [...this.players].sort((a, b) => a.player_num - b.player_num)) {
      const i = byOldIndex.get(p.team_id ?? '');
      if (recolour && i !== undefined) { p.team_id = ids[i]; continue; }
      if (legal.has(p.team_id ?? '')) continue;
      if (i !== undefined && i < ids.length) p.team_id = ids[i];
      else unplaced.push(p);
    }
    for (const p of unplaced) p.team_id = this.leastCountTeam();
    // The even re-split (brx1 review of e8811fea) fires only when the team COUNT changed, or on a one-team
    // fault. A colour-only change and an edit that leaves the set alone never rebalance an operator's split.
    if (countChanged || this.oneTeamFault()) this.rebalanceSides();
  }

  private teamCounts(ids: string[]): Map<string, number> {
    const counts = new Map(ids.map(id => [id, 0]));
    for (const p of this.players) {
      const n = counts.get(p.team_id ?? '');
      if (n !== undefined) counts.set(p.team_id!, n + 1);
    }
    return counts;
  }

  private leastCountTeam(): string | null {
    const ids = this.config.teams.map(t => t.team_id);
    if (!ids.length) return null;
    const counts = this.teamCounts(ids);
    return ids.reduce((best, id) => (counts.get(id)! < counts.get(best)! ? id : best), ids[0]);
  }

  /** Even the roster out across the declared teams — reached ONLY from a true one-side predicate.
   *  Moves the HIGHEST `player_num` off the fullest side, so the operator's first picks stay put, and
   *  stops at a spread of 1 (four on one side come out 2/2, not the 3/1 that merely clears the gate). */
  private rebalanceSides() {
    const ids = this.config.teams.map(t => t.team_id);
    if (ids.length < 2) return;
    for (let guard = this.players.length * ids.length + 1; guard > 0; guard--) {
      const counts = this.teamCounts(ids);
      const fullest = ids.reduce((a, b) => (counts.get(b)! > counts.get(a)! ? b : a), ids[0]);
      const emptiest = ids.reduce((a, b) => (counts.get(b)! < counts.get(a)! ? b : a), ids[0]);
      if (counts.get(fullest)! - counts.get(emptiest)! <= 1) return;
      const movers = this.players.filter(p => p.team_id === fullest);
      if (!movers.length) return;
      movers.reduce((a, b) => (b.player_num > a.player_num ? b : a)).team_id = emptiest;
    }
  }

  private readiness(): ReadinessSnapshot {
    const board: ReadinessRow[] = GUNS.map(([sticker, tail, s0, batt]) => {
      const s = this.gunOverride[sticker] ?? s0;
      const pl = this.players.find(p => p.gun_id === sticker);
      const red = s === 'r', a1 = s === 'a1';
      const age = this.nodeAge(`node_${tail}`);
      const blockers: string[] = [];
      // A claimed gun that is switched off reads as the server writes it: the phone has lost the gun.
      if (red && pl?.node_id) blockers.push(GUN_LINK_LOST);
      if (!red && pl?.node_id && age != null && age > OFFLINE_AFTER_MS)
        blockers.push(`OFFLINE (LAST SEEN ${fmtServerAge(age).toUpperCase()}): RECONNECT THE PHONE`);
      // A36/A37/F271 under `?mock&faults=1` — the four reds, exactly as `state.py readiness()` writes them.
      const fault = this.faultOf(sticker);
      if (pl?.node_id && this.pushed && fault === 'stale') blockers.push(DEMO_STALE_LINE);
      if (pl?.node_id && this.pushed && fault === 'echo') blockers.push(DEMO_ECHO_LINE);
      if (pl?.node_id && this.pushed && fault === 'pool') blockers.push(DEMO_POOL_LINE);
      if (pl?.node_id && this.pushed && fault === 'readback') blockers.push(DEMO_READBACK_LINE);
      if (pl?.node_id && this.pushed && fault === 'noconfig') blockers.push(DEMO_NO_CONFIG_LINE);
      // …and they are REDS, like the server's. `noecho` is deliberately not here: NOT ECHOED is the
      // absence of a proof, not a fault, and a row that went amber for it would be amber all night
      // on every gun in the field.
      const proofRed = this.pushed && (fault === 'stale' || fault === 'echo' || fault === 'pool' || fault === 'readback');
      // A29: the version flags are the SERVER's words, amber only (A1: amber never blocks). The demo
      // writes them the way `state.py readiness()` will, so the console can render and never re-derive.
      // F221: BATTERY UNREAD and STALE LINK are `ambers` on the server, so they are here too.
      const ver = this.appVer(sticker);
      const ambers: string[] = [];
      if (a1) ambers.push('BATTERY UNREAD');
      if (!red && age != null && age > STALE_AFTER_MS && age <= OFFLINE_AFTER_MS)
        ambers.push(`STALE LINK (${fmtServerAge(age).toUpperCase()})`);
      if (ver.app_ver.startsWith('0.1.8')) ambers.push('APP OLDER THAN THE FIELD (0.1.8 < 0.1.9): UPDATE THE APP');
      // A32: the demo board shows BOTH proofs, because they read differently and the operator has to
      // recognise each. GUN-F's link is still counting up (it is already an amber row for its unread
      // battery, so the extra advisory perturbs no other card's status); every other linked phone has
      // held its link past the 10 s a headless gun cannot survive. After the push the echo takes over.
      const flapping = !red && this.demoFlap && sticker === 'GUN-C';
      if (!red && this.demoObs.has('outbox') && sticker === 'GUN-A') ambers.push("12 FACTS LOST FROM THE PHONE OUTBOX: CHECK THIS PLAYER'S RECAP BY HAND");   // O6: state.py outbox_lost_line
      if (flapping) ambers.push(GUN_FLAPPING_LINE);   // one steady amber, as `state.py readiness()` writes it
      const confirming = !red && !this.pushed && sticker === 'GUN-F';
      if (confirming) ambers.push('HEADSET CONFIRMING (LINK 4 S)');
      // F549: a no_config ack proves nothing by echo; the link still stands (state.py leaves the headset to it)
      // F586: ...unless an earlier echo already proved the headset, which `_readiness_headset` reads first
      const proof = red || confirming || flapping ? null
        : this.pushed && (this.faultOf(sticker) !== 'noconfig' || this.echoedGuns.has(sticker)) ? 'echo' as const : 'link' as const;
      // F155 pass 1 (2026-09-12): `?mock&laststale=1` puts GUN-F through a node that WAS bound (it
      // reported over the internet path earlier this session — `lastReach` seeded in the constructor)
      // and has since gone dark, as distinct from a gun that was NEVER powered at all. `present` (and
      // a real `last_seen_age_ms`, not null) is what tells the two apart — without it every red row
      // reads as "never seen", and a genuinely-dropped one shows a contradiction ("NEVER THIS
      // SESSION" over "NOT REACHED FOR 2m10s", the exact bug pass 1 found).
      const droppedBackhaul = red && this.demoLastStale && sticker === 'GUN-F';
      // F3: the server's `waiting` row — a rostered player whose phone has never said hello. It is not
      // a fault and carries no blockers; it is the commonest thing on a real muster board, and the
      // mock could not produce one at all, which is why nothing here predicted the push gate's
      // FIRST-push-only rule for it.
      const waiting = !!pl && !pl.node_id;
      return {
        ...ver,
        log: this.logFor(`node_${tail}`),            // A25: the same view, on the per-player board
        ambers,
        // `player_id`/`player_num` are REQUIRED on the row: `state.py readiness()` walks the ROSTER, so a
        // real board never carries a gun nobody is holding (an unclaimed gun goes in `unclaimed`). This demo
        // boards every gun so the muster screen is not empty before players are typed in, so it says
        // "nobody" the way the wire does -- "" and the reserved wire id 0 (types.py MAX_PLAYERS comment).
        gun_id: sticker, sticker, tail, player_id: pl?.player_id ?? '', player_num: pl?.player_num ?? 0,
        present: waiting ? false : (!red || droppedBackhaul), identity: 'ok',
        node: waiting || red ? 'none' : 'linked',
        headset: waiting ? 'unknown' : red ? 'absent' : proof ? 'proven' : 'unknown',
        headset_proof: waiting ? null : proof,
        // A37: the WEAPON check's own three-state answer. `null` until a push has been answered (and
        // for a stale ack, whose own blocker owns that row); `not_echoed` is neutral, never green.
        echo: !this.pushed || red || waiting || !pl || !this.acks[pl.player_id]?.ok || fault === 'stale' ? null
          : fault === 'echo' ? 'mismatch' : fault === 'noecho' ? 'not_echoed' : 'proven',
        // null, not undefined: these are the NODE's last word and the server sends an explicit null for
        // one it has not heard (`readiness()`'s closing `row.update`).
        battery_pct: waiting ? null : batt ?? null, battery_age_ms: waiting || batt == null ? null : age,
        last_seen_age_ms: waiting || (red && !droppedBackhaul) ? null : this.nodeAge(`node_${tail}`),
        gun_linked: waiting || red ? null : true,
        gun_flapping: flapping,
        pool_stale: pl?.node_id ? this.nodeReports[pl.node_id]?.pool_stale ?? null : null,
        pool_stale_ms: pl?.node_id ? this.nodeReports[pl.node_id]?.pool_stale_ms ?? null : null,
        cure: pl?.node_id ? this.nodeReports[pl.node_id]?.cure ?? null : null,
        fw: 'v4.32', phone_batt: 80, ssid_ok: true, mc_reachable: !red && !waiting, synced: !red && !waiting,
        screen_on: true, foreground: true,
        // A28.3 / F155: the server stamps `reach` from the socket path and clears it on disconnect; `last_reach` outlives it.
        reach: red || waiting ? null : (this.lastReach[tail] ?? 'lan'),
        last_reach: waiting ? null : this.lastReach[tail] ?? (red ? null : 'lan'),
        status: waiting ? 'waiting' : red || proofRed || blockers.length ? 'red' : a1 || ambers.length ? 'amber' : 'green',
        blockers: waiting ? ['WAITING FOR THE PHONE: OPEN THE APP AND SET THE GUN'] : blockers,
      };
    });
    if (this.demoAllGreen) board.forEach((r, i) => { if (r.status !== 'waiting') board[i] = { ...r, status: 'green', blockers: [], ambers: [] }; });
    const rf = this.rosterFault();
    // F-3/A39 (2026-09-13): a connected phone (`node: 'linked'`) with no player claiming it, and not
    // the gun of someone currently on STANDBY (a deliberate stand-down, not a stray) — mirrors
    // `state.py unrostered_phone_count()`. Simpler here than on the server: the mock's `sticker` IS the
    // `gun_id` a player carries (`GUN-A` etc.), so no registry tail-resolution is needed.
    // T2 review S5: ...and not a phone that has gone SILENT. `state.py unrostered_phone_count()` skips
    // a node whose `stale` flag the net layer has raised (STALE_AFTER_MS), so a phone that said hello
    // with a gun and then left stops raising a banner the operator cannot act on.
    const standbyGuns = new Set(this.standby.map(p => (p.gun_id || '').toUpperCase()));
    const unrostered_phones = board.filter(b => b.node === 'linked' && !b.player_id && !standbyGuns.has(b.sticker.toUpperCase())
                                                && (b.last_seen_age_ms ?? Infinity) <= STALE_AFTER_MS).length;
    return { t: now(), roster_size: sessionReadinessRosterSize(this.players), greens: board.filter(b => b.player_id && b.status === 'green').length, board, unclaimed: [],
             roster_faults: rf ? [rf] : [], unrostered_phones, respawn_rules_warning: null,
             go: this.players.length > 0 && this.players.every(p =>
               board.some(b => b.player_id === p.player_id && b.status !== 'red' && b.status !== 'waiting')) && !rf };
  }

  /** A28.1: MC's own view of the tunnel it (may have) started. */
  private publicView(): LanPublic {
    return { ws_url: this.tunnelWsUrl, status: this.tunnelStatus, provider: this.tunnelProvider, available: this.tunnelAvailable,
      was_up: this.tunnelWasUp || this.tunnelStatus === 'up', error: this.tunnelError,
      // field 2026-09-12 (ISSUE 7): cloudflared's own "up" line is premature for OTHER people's DNS —
      // a phone can get ERR_NAME_NOT_RESOLVED for minutes after MC calls it up. The demo's own
      // `starting` phase is instant, so this is aspirational text the real server will earn once it
      // waits on DNS-over-HTTPS before announcing UP; kept here so the console's rendering is proven.
      detail: this.tunnelStatus === 'starting' ? 'RESOLVING HOSTNAME…' : undefined };
  }
  /** A28.2: the LAN URL first, the join secret always, the public URL only while the tunnel is up. */
  private joinQr(): string {
    const base = `ws://192.168.8.10:8765/ws?s=${this.joinSecret}`;
    return this.tunnelStatus === 'up' && this.tunnelWsUrl ? `${base}&pub=${encodeURIComponent(this.tunnelWsUrl)}` : base;
  }
  /** A28.4: derived from the nodes' own reach, never asserted. A node with no player_id is not
   *  "bound" — an unclaimed phone joining over backhaul does not move the needle. F309, as `state.py
   *  _independent_path()`: a connected phone that reports cellular is covered on the tunnel, or on the LAN when it holds pub. */
  private coverage(nodes: NodeView[]): Coverage {
    return sessionCoverage(this.players, nodes);
  }
  /** `?mock&fullcoverage=1` — F309: once the tunnel is up every phone joins through it on cellular and
   *  none is stale (the demo's 52 s link included), so the console's FULL coverage chip can be seen.
   *  Otherwise half the tunnel phones are on Wi-Fi. */
  private demoFullCoverage = typeof location !== 'undefined' && new URLSearchParams(location.search).get('fullcoverage') === '1';

  /** F596/F597 storyboard hook (`?gallery=<frame>`, `window.__brxGallery(frame)`): see gallery.ts. Off by default. */
  private galleryFrame: string | null = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('gallery') : null;
  private state(): State {
    const s = this.stateBase();
    return this.galleryFrame ? galleryState(s, this.galleryFrame) : s;
  }
  private stateBase(): State {
    const t = now();
    const readiness = this.readiness();
    const end_delivery = this.endDelivery();
    // A28.3: half the demo's connected nodes report backhaul once the tunnel is up (and only then —
    // a node cannot be on a path that does not exist), so `?mock` can show a mixed LAN/BACKHAUL board.
    const seen = readiness.board.filter(b => this.nodeReports[`node_${b.tail}`] && !this.evicted.has(`node_${b.tail}`));
    const nodes: NodeView[] = seen.map((b, i) => {
      const connected = b.node === 'linked';
      const reach = connected ? (this.tunnelStatus === 'up' && (this.demoFullCoverage || i % 2 === 0) ? 'backhaul' : 'lan') : null;
      // F309: the phone's own connection. Half the tunnel phones ride cellular, the rest the field Wi-Fi.
      const transport = connected ? (reach === 'backhaul' && (this.demoFullCoverage || i % 4 === 0) ? 'cellular' : 'wifi') : undefined;
      // F155 (field 2026-09-12): `last_reach` survives past whatever CLEARS `reach` on a real server
      // (a disconnect) — the demo tracks it the same way, keyed by tail, so a card that goes stale
      // still knows which path it lost.
      if (reach) this.lastReach[b.tail] = reach;
      return {
        node_id: `node_${b.tail}`, node_type: 'phone', gun_name: `${b.sticker}-${b.tail}`, gun_tail: b.tail,
        player_id: b.player_id, arm_state: this.armStateFor(b.player_id), last_seen_ms: b.last_seen_age_ms ?? 0,
        // 2026-09-19: the demo mirrors the real server's own STALE_AFTER_MS judgement (`state.py
        // snapshot()`), the same freshness rule `?mock`'s comments above already describe for
        // `unrostered_phone_count` -- not a hard-coded `false` that could never show the console's new
        // OFFLINE card.
        stale: (b.last_seen_age_ms ?? Infinity) > STALE_AFTER_MS,
        synced: true, battery: b.battery_pct, fw: b.fw,
        app_ver: b.app_ver, platform: b.platform,      // A29
        log: this.logFor(`node_${b.tail}`),            // A25
        ...(reach ? { reach } : {}), last_reach: this.lastReach[b.tail],
        ...(transport ? { transport } : {}),
        ...(this.demoObs.has('outbox') && b.sticker === 'GUN-A' ? { outbox_lost: 12 } : {}),   // O6
      };
    });
    // The server retains the same node record after disconnect. Readiness can say "none" while
    // state.nodes still shows its last receipt and path history.
    const kitted = sessionKitted(this.players);
    const notice = sessionNoticesMcVerify(this.config, sessionOffGrid(this.players, nodes), sessionReadinessRosterSize(this.players));
    const holdWarning = holdTargetWarning(this.config, Object.values(this.stations).filter(st => st.assigned?.kind === 'control').length);
    const coverage = this.coverage(nodes);
    if (this.cachedCoverageLevel !== coverage.level) {
      this.cachedCoverageLevel = coverage.level;
      this.cachedCompilerResult = undefined;
    }
    const compiler = this.cachedCompilerResult ??= compilerValidation(this.config, this.players, WEAPONS,
      coverage.level === 'full', PERKS);
    const perkEffects = Object.fromEntries(this.players.flatMap(player => {
      const resolved = perkEffectsResolved(this.config, player, WEAPONS, PERKS);
      return resolved ? [[player.player_id, resolved]] : [];
    }));
    return {
      session_id: this.session_id, phase: this.phase, t,
      lan: {
        // F143 (field 2026-09-12): the server no longer tells router/hotspot apart (nothing ever did) —
        // it sends the flat "lan" and, separately, an `ssid` it may or may not have been able to read.
        // `?mock&nossid=1` demos the "could not read one" case, which must print "LAN", never a
        // placeholder word standing in for a network name.
        mode: 'lan', ssid: this.demoNoSsid ? null : 'BRX-FIELD', ip: '192.168.8.10', port: 8765, ws_url: 'ws://192.168.8.10:8765/ws',
        qr: this.joinQr(), join_secret: this.joinSecret, public: this.publicView(),
        // T3-A: `?mock&lanwarn=1` — see `demoLanWarning` above.
        warning: this.demoLanWarning ? WSL_UNREACHABLE_WARNING : null,
      },
      ...(this.restoredFrom ? { restored_from: this.restoredFrom } : {}),
      // `?mock&armorycorrupt=1` demos the O2 warning.
      ...(this.demoArmoryCorrupt ? { armory_corrupt: { kept: '/home/op/.brx-mcp/armory.json.bad-20261004T010203', error: 'JSONDecodeError: Expecting value: line 1 column 1 (char 0)' } } : {}),
      coverage,
      mc_confidence: (() => {
        const missing = this.players.filter(p => !p.node_id || !nodes.some(n => n.node_id === p.node_id)).map(p => p.player_id);
        const stale = this.players.filter(p => p.node_id && nodes.some(n => n.node_id === p.node_id)
          && (this.nodeAge(p.node_id) ?? Infinity) > 6_000).map(p => p.player_id);
        return { confident: this.players.length > 0 && !missing.length && !stale.length,
          missing, stale, unflushed: [] };
      })(),
      feed: [...this.feed_],
      // The demo mirrors the server's own `SETUP: ` warning for a grenade objective (compile.py validate),
      // so the KotH rail in `?mock` shows the same field step the real MC does.
      nodes, readiness, config: clone(this.config), config_errors: [...new Set([...this.cfgErrors, ...compiler.errors])],
      stations: this.stationViews(), station_departures: this.departureViews(), game_byte: this.gameNo,
      config_warnings: [
        ...compiler.warnings,
        // mirrors Session._station_warnings(): a station-gated rule with nothing assigned in ITEMS.
        // F402: retired for koth -- that case is now a hard LOAD/push refusal (`kothHillFault`), not
        // an amber advisory, or the console would say the same fact twice in two colours.
        ...(this.config.station_source === 'phone' && !Object.values(this.stations).some(s => s.assigned?.kind === 'control')
          && this.config.mode !== 'koth'
          ? ['SETUP: NO CONTROL STATION IS ASSIGNED (THE OBJECTIVE IS A BLUETOOTH CONTROL POINT, SO NOTHING ON THE FIELD IS THE HILL): ASSIGN A STATION AS CONTROL IN ITEMS AND ARM IT'] : []),
        // F535: mirrors station_warnings(): a hill left assigned in a mode with no hill, and then (elif) the source conflict
        ...(Object.values(this.stations).some(s => s.assigned?.kind === 'control') && !OBJECTIVE_MODES.includes(this.config.mode)
          ? ['SETUP: A CONTROL STATION IS ASSIGNED BUT THIS MODE HAS NO HILL (MC DOES NOT ARM IT): CLEAR IT IN ITEMS, OR TURN THE HILL PHONE OFF'] : []),
        ...((this.config.station_source === 'grenade' || this.config.station_source === 'ir_station')
          && OBJECTIVE_MODES.includes(this.config.mode)
          && Object.values(this.stations).some(s => s.assigned?.kind === 'control')
          ? [`SETUP: A CONTROL STATION IS ASSIGNED BUT THIS GAME'S OBJECTIVE IS ${this.config.station_source === 'grenade' ? 'THE GRENADE' : 'AN IR STATION'} (EVERY PHONE IGNORES THE STATION'S HILL): SET OBJECTIVE SOURCE TO PHONE, OR CLEAR THE CONTROL STATION IN ITEMS`] : []),
        ...(this.config.respawn.type === 'scanner' && !Object.values(this.stations).some(s => s.assigned?.kind === 'respawn')
          ? ['SETUP: NO RESPAWN STATION IS ASSIGNED (RESPAWN IS SET TO STATION, SO A DOWNED PLAYER CAN ONLY COME BACK AT A STATION): ASSIGN A STATION AS RESPAWN IN ITEMS AND ARM IT'] : []),
        // F402 item 2: mirrors StationRegistry.koth_hill_offline_warning() -- computed fresh here too, never
        // cached, so a hill that goes quiet after LOAD with no other edit still shows it.
        ...(this.config.mode === 'koth' && this.config.station_source === 'phone'
          && Object.values(this.stations).some(s => s.assigned?.kind === 'control' && s.offline)
          ? ['SETUP: THE HILL IS OFFLINE: BRING IT INTO WI-FI OR RE-ARM IT BEFORE YOU START'] : []),
        // F401: mirrors StationRegistry.station_sync_warnings() -- any station of the LAST FINISHED match MC
        // has not heard from since that match's whistle. `util-d4e5f6` demos this by default (F106(i):
        // seeded 20 min stale), so `?mock` shows the LOAD warning with no operator action needed.
        ...((this.lastMatchStations ?? []).filter(r => r.synced === false)
          .map(r => `${(STATION_KIND_LABEL as Record<string, string>)[r.kind] ?? r.kind.toUpperCase()} ${r.id} HAS NOT SYNCED THE LAST MATCH: BRING IT INTO WI-FI BEFORE YOU LOAD, OR ITS RESULT IS LOST`)),
        ...(holdWarning ? [holdWarning] : []),
      ],
      players: clone(this.players), teams: clone(this.config.teams),
      ...(Object.keys(perkEffects).length ? { perk_effects: perkEffects } : {}),
      standby: clone(this.standby),
      kit: { kitted, total: this.players.length, trying: { ...this.trying }, browsing: { ...this.browsing } },
      loadout_pool: this.pool(),
      game_pick: clone(this.gamePick),
      ...(this.lastMatch ? { last_match: clone(this.lastMatch) } : {}),
      // A36/C-5: `all_acked` is the SERVER's own answer to "has every gun answered for THIS config",
      // and the console prefers it over its own count. The mock exists to predict the server, so it
      // sends it too — without it `?mock` exercised only the fallback path.
      lobby: { ready: this.players.filter(p => p.ready).length, updating: this.updating(), total: this.players.length, pushed: this.pushed,
               acks: clone(this.acks), all_acked: this.allAcked() },
      // LOAD: the game the phones were told about (no frames, no head) — what the GAMES tab keys its
      // ACTIVE GAME CONFIG state on, and a different fact from `lobby.pushed` above.
      game: { loaded: this.gameLoaded, config_id: this.gameCfg ?? undefined,
              sent: sessionGameSentN(this.players, this.gameSent, this.gameCfg),
              total: this.players.length },
      versions: sessionVersions(nodes, this.mockOptions.releaseVersion ?? releaseBuild.version),
      sync: this.syncSummary(),
      options: { ...this.options },      // A25
      // A31: the compiler writes this ONCE, so MC and the phones cannot disagree. The demo raises it
      // whenever the game's end state is MC's call (a frag cap, or an objective win_by) — which is the
      // only condition under which a phone with no backhaul changes what the players should do.
      notices: notice ? { mc_verify: notice } : {},
      start: sessionStartView(this.start_ ? { ...clone(this.start_), per_node: Object.fromEntries(
        Object.entries(this.start_.per_node ?? {}).map(([pid, view]) => {
          const node_id = this.players.find(p => p.player_id === pid)?.node_id;
          return [pid, { ...view, last_seen_ms: this.nodeAge(node_id) ?? t }];
        })) } : undefined),
      live: sessionLiveView(this.live_ ? this.liveView() : this.start_ ? this.armedLiveView() : undefined),
      // `since_end_ms`, as `state.py settling()` adds it: RECAP reads the real match length from it (M23)
      recap: this.recapView(),
      ...(end_delivery ? { end_delivery } : {}),
      orphan_match: this.orphanView(),
      // O7/O8: absent = healthy, as the server omits them
      ...(this.demoObs.has('store') || this.demoObs.has('archive') || this.demoObs.has('snapshot') ? { not_saving: {
        ...(this.demoObs.has('store') ? { store: { since: now() - 90_000, count: 41, error: 'OSError: [Errno 28] No space left on device' } } : {}),
        ...(this.demoObs.has('archive') ? { archive: { since: now() - 60_000, count: 1, error: 'LookupError: store.match_ended: no row for match' } } : {}),
        ...(this.demoObs.has('snapshot') ? { snapshot: { since: now() - 30_000, count: 15, error: 'OSError: [Errno 28] No space left on device' } } : {}),
      } } : {}),
      ...(this.demoObs.has('tick') ? { ticker_failing: { since: now() - 20_000, count: 40, error: 'KeyError: go_live_t' } } : {}),
      ...(this.demoObs.has('join') ? { join_error: { error: 'RuntimeError: no network interface', ws_url: '' } } : {}),
    };
  }
  /** The scorer's whistle time. Delivery receipts live on the existing per-node reports. */
  private endedAt?: number;
  /** F401: mirrors `Session.match.frozen_stations` -- the LAST FINISHED match's frozen station rows (each
   *  already carrying its own `synced`), kept across `newSession()` (a roll forward, or a fresh
   *  session) so the Games/LOAD warning still shows an unsynced station after the operator moves on,
   *  the same as the real server. */
  private lastMatchStations?: RecapStationRow[];

  private orphanView() {
    const o = this.orphan_;
    if (!o) return undefined;
    const players = o.player_ids.map(id => this.players.find(p => p.player_id === id)?.display ?? id).sort();
    return { match_id: o.match_id, phones: players.length, players, arm_state: 'live' as const,
             can_resume: ['muster', 'build', 'kit', 'lobby'].includes(this.phase) && !this.start_ };
  }
  /** Test hook, the same shape as `?mock&orphan=1`. */
  setOrphan(match_id: string | null, player_ids: string[] = ['p1', 'p2']) {
    this.orphan_ = match_id ? { match_id, player_ids } : null;
    this.emit();
  }
  private endDelivery() {
    return sessionEndDeliveryView(Object.fromEntries(Object.entries(this.nodeReports)
      .map(([node_id, report]) => [node_id, report.end])), this.players, now());
  }
  private matchMissing() {
    const ids = this.live_?.rows.map(row => row.player_id) ?? [];
    sessionMarkFlushedLive(ids, this.players, this.nodeReports, now(), this.scorerFlushed);
    return scorerMissing(ids, this.scorerFlushed);
  }
  // ---- F596/F597: the RECAP sync view. Mirrors `state.py Session._recap_sync`: one row per phone bound at the whistle
  // plus one per assigned station, a stage per row, `pending` while any row is not received and the operator has not
  // finalised. `syncDemo` (`?mock` in a browser) spreads the phones' arrivals over the first half-minute so the strip
  // MOVES; without it every connected phone has delivered at the whistle, as a phone that was in range does.
  private syncBase: { player_id: string; node_id: string }[] = [];
  private syncFinalised = false;
  private syncFinalWinner: string | undefined;
  private syncResultChanged = false;
  private syncView(recap: RecapView): NonNullable<RecapView['sync']> | undefined {
    if (this.phase !== 'recap' || this.endedAt === undefined) return undefined;
    const elapsed = now() - this.endedAt;
    const demo = !!this.mockOptions.syncDemo;
    const unconfirmed = new Set((this.endDelivery()?.unconfirmed ?? []).map(u => u.player_id));
    const rows: RecapSyncRow[] = this.syncBase.map((b, i): RecapSyncRow => {
      const pl = this.players.find(p => p.player_id === b.player_id);
      const never = demo && i === this.syncBase.length - 1;   // the demo's last phone is out of range for good, so FINALISE can be tried
      const linked = this.nodeConnected(b.node_id) && b.node_id !== this.demoQuietNodeId && !never;
      const arrive = demo ? 6000 + i * 2500 : 0;   // when this phone's last fact lands
      const sendFrom = arrive - 4000;
      const stage: RecapSyncStage = !linked ? 'unlinked' : elapsed >= arrive ? 'received' : demo && elapsed >= sendFrom ? 'sending' : 'linked';
      const pending = stage === 'sending' ? Math.max(1, Math.ceil((arrive - elapsed) / 1000)) : 0;
      const idle = stage === 'received' || stage === 'sending' ? 0 : Math.floor(elapsed / 1000);
      const lost = demo && i === 2 ? 3 : 0;
      return { kind: 'phone' as const, id: b.player_id, name: pl?.display ?? b.player_id, team_id: pl?.team_id ?? null, stage,
        transport: stage === 'unlinked' ? null : demo && i % 4 === 1 ? 'cellular' : demo && i % 4 === 3 ? 'backhaul' : 'wifi',
        ...(pending ? { pending } : {}), ...(lost ? { lost } : {}),
        end_unconfirmed: unconfirmed.has(b.player_id),
        idle_s: idle, stuck: stage !== 'received' && idle >= SYNC_STUCK_S };
    });
    // Server rule (`_recap_sync`): only a CONTROL station holds the wait, and it is received only once it has sent its
    // tally (a heartbeat since the whistle is `synced`, but it is not the result). Every other kind gets no row.
    for (const st of (recap.stations ?? []).filter(x => x.kind === 'control')) {
      const tallied = st.synced === true && (st.owner != null || (st.hold_ms != null && Object.keys(st.hold_ms).length > 0));
      const stage: RecapSyncStage = tallied ? 'received' : this.nodeConnected(st.node_id) ? 'linked' : 'unlinked';
      const idle = stage === 'received' ? 0 : Math.floor(elapsed / 1000);
      rows.push({ kind: 'station', id: String(st.id), name: `${(STATION_KIND_LABEL as Record<string, string>)[st.kind] ?? st.kind.toUpperCase()} ${st.id}`,
        team_id: null, stage, transport: null, end_unconfirmed: false, idle_s: idle, stuck: stage !== 'received' && idle >= SYNC_STUCK_S });
    }
    const pending = !this.syncFinalised && rows.some(r => r.stage !== 'received');
    const key = JSON.stringify(recap.winner);
    if (!pending && this.syncFinalWinner === undefined) this.syncFinalWinner = key;
    else if (this.syncFinalWinner !== undefined && key !== this.syncFinalWinner) this.syncResultChanged = true;
    return { rows, pending, finalised: this.syncFinalised, result_changed: this.syncResultChanged } as unknown as NonNullable<RecapView['sync']>;   // typed by api/recapSync.ts, not the generated name clash
  }
  /** `state.py finalise_recap`: the operator releases the result although phones are missing. 409 outside RECAP. */
  async finaliseRecap() {
    if (this.phase !== 'recap') throw Object.assign(new Error('no match in RECAP to finalise'), { status: 409 });
    if (!this.syncFinalised) {
      this.syncFinalised = true;
      this.recapView();   // captures the winner shown when the wait first ends
      this.emit();
    }
    return { ok: true };
  }
  private recapView(): RecapView | null {
    const r = this.recapViewBase();
    if (r && this.phase === 'recap') { const sync = this.syncView(r); if (sync) (r as { sync?: unknown }).sync = sync; }
    return r;
  }
  private recapViewBase(): RecapView | null {
    if (this.phase !== 'live' && this.phase !== 'recap') return null;
    const settling = sessionSettling(this.players, this.nodeReports, this.endedAt, now());
    if (this.recap_) {
      const missing = this.matchMissing();
      return sessionScorerRecap({ ...clone(this.recap_), missing,
        provisional: missing.length > 0, ...settling }, this.recap_.stations,
      Object.fromEntries(Object.entries(this.stations).map(([id, station]) => [id, station.seen])), this.endedAt);
    }
    if (!this.live_) return null;
    const live = this.liveView();
    const scores = Object.entries(live.score).sort((a, b) => b[1] - a[1]);
    const top = scores[0]?.[1] ?? 0;
    const tied = scores.filter(([, value]) => value === top).map(([id]) => id);
    const rows: ScoreRow[] = live.rows.map(r => ({ player_id: r.player_id, display: r.display,
      team_id: r.team_id, kills: r.kills, deaths: r.deaths, assists: r.assists, shots: r.shots,
      shots_total: r.shots_total, hits: r.hits, accuracy: r.accuracy, acc_provisional: true,
      kd: r.kd, streak: r.streak, medals: r.medals, best_streak: r.best_streak,
      multi_best: r.multi_best, first_blood: r.first_blood }));
    const missing = this.matchMissing();
    return sessionScorerRecap({ winner: this.config.mode === 'ffa' ? { player_id: rows[0]?.player_id ?? null }
      : { team_id: tied.length === 1 ? tied[0] : null, ...(tied.length > 1 ? { tie: tied } : {}) },
      score: live.score, rows, honors: [], provisional: true, missing,
      post_end: 0, post_end_facts: 0, parked: 0, ...settling }, this.recapStations(false));
  }
  private recapStations(ended: boolean): RecapStationRow[] {
    return this.stationViews().filter(s => s.assigned && !this.stoodDown(s.assigned)).map(s => {   // F535: no hill row outside a hill mode
      const a = s.assigned!;
      const heard = Object.keys(s.report ?? {}).length > 0;
      const row: RecapStationRow = { node_id: s.node_id, kind: a.kind, id: a.id, team: a.team, heard };
      if (a.kind === 'respawn') row.revives = s.report.revives ?? null;
      else if (a.kind === 'control' && s.report.control) {
        row.hold_ms = s.report.control.hold_ms ?? null;
        row.owner = s.report.control.owner ?? null;
      }
      if (ended) row.synced = this.endedAt !== undefined && this.stations[s.node_id].seen >= this.endedAt;
      return row;
    });
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
    const tl = this.activeTimeLimit();
    const rows = l.rows.map(r => ({ ...r, ...scorerLiveRow(now(), this.nodeReports[
      this.players.find(p => p.player_id === r.player_id)?.node_id ?? '']?.lastSeen,
      r.status !== 'down', r.respawn_in_s) }));
    const view: LiveView = { match_id: l.match_id, go_live_t: l.go_live_t, time_limit_s: tl,
      ends_t: l.go_live_t + tl * 1000, score, rows: sessionWithPoolStale(rows, this.rowClaims()) };
    // Visual QA H2: an objective match carries the possession tally (state.py `_live_view`). The demo
    // phones "report" a fixed split of the elapsed time so ?mock shows the hill panel filling.
    if (isObjectiveScored(this.config)) {
      const el = Math.max(0, Math.min(tl, (now() - l.go_live_t) / 1000));
      const ids = this.config.teams.map(t => t.team_id);
      const by_team: Record<string, number> = {};
      ids.forEach((id, i) => { by_team[id] = Math.round(el * (i === 0 ? 0.55 : i === 1 ? 0.35 : 0)); });
      view.possession = { by_team, neutral_s: Math.round(el * 0.1), sites: 1, reports: l.rows.length, observed_s: Math.round(el), of_s: tl };
    }
    return view;
  }
  private armedLiveView(): LiveView {
    const start = this.start_!;
    const time_limit_s = this.activeTimeLimit();
    const rows = sessionWithPoolStale(this.players.map(p => this.blankLiveRow(p)), this.rowClaims());
    return { match_id: start.match_id, go_live_t: start.go_live_t, time_limit_s,
      ends_t: start.go_live_t + time_limit_s * 1000,
      score: Object.fromEntries(this.config.teams.map(t => [t.team_id, 0])), rows };
  }
  private activeTimeLimit(): number {
    if (this.config.time_limit_s == null) throw new Error('active scorer has no time limit');
    return this.config.time_limit_s;
  }
  private blankLiveRow(p: Player): LiveRow {
    return { player_id: p.player_id, display: p.display, team_id: p.team_id, kills: 0, deaths: 0,
      assists: 0, shots: 0, shots_total: 0, hits: 0, accuracy: null, acc_provisional: true,
      kd: 0, streak: 0, medals: [], best_streak: 0, multi_best: 0, first_blood: false,
      after_end_kills: 0, after_end_deaths: 0,
      ...scorerLiveRow(now(), p.node_id ? this.nodeReports[p.node_id]?.lastSeen : undefined, true) };
  }
  private pool() { return poolOf(this.config.loadout_policy, POLICY_WEAPONS, PERKS, healthPresetOf(this.config.health)); }
  /** server `apply_policy()` — every player's kit brought into compliance with the current rules */
  private applyPolicy() {
    const pl = this.pool();
    for (const p of this.players) {
      const next = applyPolicy(this.config.loadout_policy, p.loadout, pl, WEAPONS, PERKS);
      if (JSON.stringify(next) !== JSON.stringify(p.loadout)) { p.loadout = next; delete this.trying[p.player_id]; }
    }
  }
  private emit() { const s = this.state(); this.subs.forEach(x => x.snap(s)); }
  /** What `putConfig` writes, so a refused PICK, FAVOURITES LOAD or picked-piece edit can put ALL of it back: routes/config_game.py
   *  `_apply_patch` prechecks and a refusal touches nothing, while `putConfig` here re-teams, re-kits, drops the push and
   *  syncs `gamePick` before it reports its errors (cross-lane review 0.4.19). */
  private composeSnapshot() {
    return clone({ config: this.config, players: this.players, standby: this.standby, pushed: this.pushed, acks: this.acks,
      gameSent: this.gameSent, cfgErrors: this.cfgErrors, trying: this.trying, phase: this.phase, gamePick: this.gamePick });
  }
  private composeRestore(b: ReturnType<MockBackend['composeSnapshot']>) {
    ({ config: this.config, players: this.players, standby: this.standby, pushed: this.pushed, acks: this.acks,
      gameSent: this.gameSent, cfgErrors: this.cfgErrors, trying: this.trying, gamePick: this.gamePick } = b);
    this.setPhaseField(b.phase);
  }
  private feedSeq = 0;
  private feed(e: FeedEntry) { e.id = ++this.feedSeq; this.feed_.unshift(e); this.subs.forEach(x => x.feed(e)); }
  private nodeConnected(node_id: string) {
    return !this.evicted.has(node_id) && !this.disconnectedNodes.has(node_id) && !!this.nodeReports[node_id];
  }
  private recordRetired(match_id?: string) {
    if (!match_id) return;
    this.retiredMatches = [...this.retiredMatches.filter(id => id !== match_id), match_id].slice(-16);
  }
  private armEndDelivery(match_id: string, t: number) {
    if (Object.values(this.nodeReports).some(report => report.end && report.end.match_id !== match_id)) {
      for (const report of Object.values(this.nodeReports)) {
        if (report.end?.match_id !== match_id) delete report.end;
      }
      this.endDeliveryTold = undefined;
    }
    for (const player of this.players) {
      if (!player.node_id || this.nodeReports[player.node_id]?.end) continue;
      const report = this.nodeReports[player.node_id] ?? (this.nodeReports[player.node_id] = { lastSeen: 0 });
      report.end = sessionArmEndDelivery(match_id, player.player_id, t);
    }
  }
  private sayEndUnconfirmed() {
    const receipts = Object.values(this.nodeReports).flatMap(report => report.end ? [report.end] : []);
    const match_id = receipts[0]?.match_id;
    if (!match_id || this.endDeliveryTold === match_id) return;
    const left = receipts.filter(e => !e.confirmed);
    if (!left.length || left.some(e => !e.exhausted)) return;
    this.endDeliveryTold = match_id;
    const names = left.map(e => this.players.find(p => p.player_id === e.player_id)?.display || e.player_id);
    this.feed({ t_match_s: 0, kind: 'alert', tag: 'WITHHELD', text: sessionSayEndUnconfirmed(names) });
  }
  private resumeQuietNode(t: number) {
    const node_id = this.demoQuietNodeId;
    if (!node_id || this.demoQuietUntil === undefined || t < this.demoQuietUntil) return;
    this.demoQuietNodeId = undefined;
    this.demoQuietUntil = undefined;
    if (this.evicted.has(node_id)) return;
    const match_id = this.live_?.match_id;
    this.reportNode(node_id, t, { pending: 0, ...(match_id ? {
      arm_state: this.phase === 'recap' ? 'kitted' : 'live', match_id } : {}) });
  }
  /** F454: replace the feed row with the same id, as the server's `feed_edit` does (an unknown id is a no-op). */
  feedEdit(e: FeedEntry) {
    const rows = this.feed_;
    const i = e.id == null || !rows ? -1 : rows.findIndex(r => r.id === e.id);
    if (i < 0 || !rows) return;
    rows[i] = e;
    this.subs.forEach(x => x.feed(e, true));
  }

  // ---------- simulation tick ----------
  private tick() {
    const t = now();
    for (const [node_id, report] of Object.entries(this.nodeReports)) {
      if (report.end) report.end = sessionRetryEndDelivery(report.end, t, this.nodeConnected(node_id));
    }
    this.sayEndUnconfirmed();
    this.resumeQuietNode(t);
    for (const [pid, at] of Object.entries(this.browsing)) if (t - at > 60_000) delete this.browsing[pid];
    if (this.phase === 'armed' && this.start_) {
      // START contains each phone's last reported countdown. Time passing is not a new report.
      if (t >= this.start_.go_live_t) this.goLive();
      this.emit();
    } else if (this.phase === 'live' && this.live_) {
      const lv = this.liveView();
      // state.py tick(): the scorer stays LIVE for five seconds after the phone's limit.
      if (t >= lv.ends_t + 5000) { this.endMatch('time'); return; }
      for (const r of this.live_.rows) {
        if (r.status === 'down') { r.respawn_in_s = Math.max(0, (r.respawn_in_s ?? 0) - 1); if (r.respawn_in_s === 0) r.status = 'alive'; }
        // The phone that reported protection owed after go-live remains silent.
        const player = this.players.find(p => p.player_id === r.player_id);
        if (player?.node_id && player.node_id !== this.demoQuietNodeId) {
          this.reportNode(player.node_id, t, player.display === 'NOMAD'
            ? { pool_stale: 'silent', pool_stale_ms: 190_000 } : {});
        }
        Object.assign(r, scorerLiveRow(t, player?.node_id ? this.nodeReports[player.node_id]?.lastSeen : undefined,
          r.status !== 'down', r.respawn_in_s));
      }
      if (!this.demoNoRandomKills && Math.random() < 0.12) this.simKill();
      this.emit();
    }
  }
  // `killerId` is a test hook. The e2e walk names a killer to put one row at exactly 6 shots, which
  // is a number that is still settling. The tick never passes it, so the demo still picks at random.
  private simKill(killerId?: string) {
    const l = this.live_!; const alive = l.rows.filter(r => r.status === 'alive');
    if (alive.length < 2) return;
    const k = alive.find(r => r.player_id === killerId) ?? alive[Math.floor(Math.random() * alive.length)];
    const targets = alive.filter(r => r !== k &&
      (!this.demoQuietNodeId || this.players.find(p => p.player_id === r.player_id)?.node_id !== this.demoQuietNodeId) &&
      (this.config.mode === 'ffa' || !k.team_id || r.team_id !== k.team_id));
    if (!targets.length) return;
    const v = targets[Math.floor(Math.random() * targets.length)];
    for (const x of [k, v]) {
      const node_id = this.players.find(p => p.player_id === x.player_id)?.node_id;
      if (node_id && node_id !== this.demoQuietNodeId) this.reportNode(node_id);
    }
    k.kills++; k.streak++; k.hits += 3; k.shots += 6; v.deaths++; v.streak = 0; v.status = 'down'; v.respawn_in_s = this.config.respawn.delay_s;
    this.scorerFlushed.add(k.player_id);
    this.scorerFlushed.add(v.player_id);
    // F116: `best_streak` is the longest of the match and NEVER resets — `streak` is 0 for whoever
    // died last, which is what made a 9-kill row read "streak 0" on the field.
    k.best_streak = Math.max(k.best_streak ?? 0, k.streak);
    if (!l.rows.some(r => r.first_blood)) k.first_blood = true;
    if (Math.random() < 0.2) k.multi_best = Math.max(k.multi_best ?? 0, 2);
    for (const r of l.rows) {
      r.kd = +(r.kills / Math.max(r.deaths, 1)).toFixed(1);
      r.accuracy = r.shots ? Math.round((r.hits / r.shots) * 100) : null;
      r.shots_total = r.shots;
      // F119: the server's own test — accuracy is not settled until the row has ≥10 shots behind it
      r.acc_provisional = (r.shots_total ?? 0) < 10;
    }
    l.rows.sort((a, b) => b.kills - a.kills);
    const tm = Math.floor((now() - l.go_live_t) / 1000);
    const friendly = k.team_id && k.team_id === v.team_id && this.config.mode !== 'ffa';
    this.feed({ t_match_s: tm, text: `${k.display} eliminated ${v.display}`, kind: 'kill',
      tag: friendly ? 'TEAM KILL' : k.streak >= 5 ? `STREAK ×${k.streak}` : Math.random() < 0.2 ? 'DOUBLE KILL' : undefined });
    // A11.4/F118: MC's own global-state alerts land in the feed as `kind: 'alert'`, in the OPERATOR's
    // third-person copy. `WITHHELD` is the one mc_confidence refused to push — it has to LOOK
    // different from one that landed, or the operator reads a withheld call as a delivered one.
    const cap = this.config.scoring.frag_limit;
    if (cap && isKillScored(this.config) && k.kills === cap - 1) {   // the server ignores a frag cap unless kills score
      this.feed({ t_match_s: tm, kind: 'alert', tag: 'ALERT',
                  text: `${k.display} is one kill from the cap` });
    } else if (k.kills === 3 && k.kills > Math.max(...l.rows.filter(r => r !== k).map(r => r.kills))) {
      this.feed({ t_match_s: tm, kind: 'alert', tag: this.config.mode === 'ffa' ? 'ALERT' : 'WITHHELD',
                  text: this.config.mode === 'ffa' ? `${k.display} takes the lead`
                                                   : `${(k.team_id ?? '').toUpperCase()} takes the lead` });
    }
    if (cap && k.kills >= cap) this.endMatch('frag_limit');
  }
  private goLive() {
    const s = this.start_!;
    this.setPhaseField('live');
    // The phones report at T-0. An old protection claim was cleared when START was scheduled.
    for (const p of this.players) {
      if (!p.node_id) continue;
      this.reportNode(p.node_id, now(), p.display === 'NOMAD'
        ? { pool_stale: 'silent', pool_stale_ms: 190_000 } : {});
      if (this.start_?.per_node[p.player_id]) {
        this.start_.per_node[p.player_id].arm_state = 'live';
        this.start_.per_node[p.player_id].t_minus_ms = 0;
      }
    }
    const rows = this.players.map(p => this.blankLiveRow(p));
    // F289: a live respawn reports protection owed, then the phone falls silent.
    const protectedPlayer = this.players.filter(p => p.node_id &&
      rows.some(r => r.player_id === p.player_id && r.status === 'alive'))
      .sort((a, b) => a.player_num - b.player_num)[0];
    this.demoQuietNodeId = this.demoAllGreen ? undefined : protectedPlayer?.node_id ?? undefined;
    this.demoQuietUntil = this.demoQuietNodeId ? now() + 20_000 : undefined;
    if (this.demoQuietNodeId) this.reportNode(this.demoQuietNodeId, now(), { protect_owed: true });
    this.live_ = { rows, go_live_t: s.go_live_t, match_id: s.match_id }; this.endedAt = undefined;
    this.feed({ t_match_s: 0, text: `MATCH LIVE: ${rows.length} NODES SPAWNED`, kind: 'sync', tag: 'SYNC POINT' });
  }
  private endMatch(reason: 'host' | 'time' | 'frag_limit' | 'hold_target') {
    const wasArmed = this.phase === 'armed';
    const l = this.live_ ?? (wasArmed && this.start_ ? {
      rows: this.players.map(p => this.blankLiveRow(p)),
      go_live_t: this.start_.go_live_t, match_id: this.start_.match_id,
    } : undefined);
    if (!l || (this.phase !== 'live' && !wasArmed)) return;
    if (wasArmed) this.live_ = l;
    this.recordRetired(l.match_id);
    this.setPhaseField('recap');
    this.start_ = undefined;  // state.py Session._finish() clears the match head at the whistle.
    // A42: the server arms the end-delivery watch in `_finish()` -- AT THE WHISTLE -- not when the
    // operator happens to open RECAP. Stamping it here is what lets the demo reach the RE-DELIVERING
    // state and the LIVE banner at all; keyed off `recap_` it could only ever show the spent ladder.
    this.endedAt = now();
    const bound = this.players.filter(p => p.node_id);
    this.syncBase = bound.map(p => ({ player_id: p.player_id, node_id: p.node_id! }));
    this.syncFinalised = false; this.syncFinalWinner = undefined; this.syncResultChanged = false;
    const knownNodes = new Set(Object.keys(this.nodeReports));
    const faultNode = this.demoFaults ? bound[bound.length - 1]?.node_id : undefined;
    if (faultNode) this.disconnectedNodes.add(faultNode);
    // state.py _finish() arms the watch; _broadcast_control() records the whistle's host push.
    this.armEndDelivery(l.match_id, this.endedAt);
    for (const player of this.players) {
      if (!player.node_id) continue;
      const node_id = player.node_id;
      const hadNode = knownNodes.has(node_id);
      const connected = this.nodeConnected(node_id);
      if (!hadNode) this.disconnectedNodes.add(node_id);
      const report = this.nodeReports[node_id] ?? (this.nodeReports[node_id] = { lastSeen: 0 });
      if (reason !== 'time' && hadNode && report.end) {
        report.end = sessionEndDeliveryTried(report.end, l.match_id, this.endedAt, connected);
      }
    }
    for (const player of bound) {
      if (!player.node_id || player.node_id === this.demoQuietNodeId || !this.nodeConnected(player.node_id)) continue;
      this.reportNode(player.node_id, this.endedAt, { pending: 0, arm_state: 'kitted', match_id: l.match_id });
    }
    // R2-1: `state.py _finish()` drops `lobby_pushed` and the acks at the whistle — the next match
    // needs a FULL fresh head push (A36), which is also what makes that push a first push rather
    // than a re-push, so the game number moves for it. The mock kept `pushed` true across the END,
    // and with a re-push now being a distinct action that difference is visible.
    this.pushed = false; this.acks = {}; this.echoedGuns.clear();
    for (const player of this.players) player.ready = false;
    this.gameLoaded = false; this.gameCfg = null; this.gameSent = {};   // a finished match is not a loaded game (`_finish`)
    const rows: ScoreRow[] = l.rows.map(r => {
      const d = RECAP.find(x => x[0] === r.display);
      const kills = wasArmed ? r.kills : r.kills || d?.[1] || 0;
      const deaths = wasArmed ? r.deaths : r.deaths || d?.[2] || 0;
      const shots = wasArmed ? r.shots : r.shots || 40;
      return { player_id: r.player_id, display: r.display, team_id: r.team_id, kills, deaths,
        assists: wasArmed ? r.assists : r.assists || d?.[3] || 0,
        shots, shots_total: shots, hits: wasArmed ? r.hits : r.hits || Math.round((d?.[4] ?? 30) * 0.4),
        accuracy: wasArmed ? r.accuracy : r.accuracy ?? d?.[4] ?? 30,
        kd: +(kills / Math.max(deaths, 1)).toFixed(1), streak: wasArmed ? r.streak : r.streak || d?.[5] || 0, medals: [],
        // A24: the match is over, so accuracy has settled; `best_streak` is the longest run, which at
        // the whistle is what the RECAP column must show (`streak` is the survivor of the last death).
        best_streak: wasArmed ? (r.best_streak ?? 0) : Math.max(r.best_streak ?? 0, r.streak || d?.[5] || 0),
        multi_best: r.multi_best ?? 0, first_blood: !!r.first_blood, acc_provisional: false };
    }).sort((a, b) => b.kills - a.kills);
    const score: Record<string, number> = Object.fromEntries(this.config.teams.map(team => [team.team_id, 0]));
    for (const r of rows) if (r.team_id) score[r.team_id] = (score[r.team_id] ?? 0) + r.kills;
    const ffa = this.config.mode === 'ffa';
    const top = rows[0];
    const winnerTeam = Object.entries(score).sort((a, b) => b[1] - a[1])[0]?.[0];
    const winBy = this.config.scoring?.win_by ?? 'kills';
    const winner = wasArmed
      ? ffa ? { player_id: null, tie: rows.map(row => row.player_id).sort() }
        : winBy !== 'kills' ? { team_id: null, undecided: winBy }
        : { team_id: null, tie: Object.keys(score).sort() }
      : ffa ? { player_id: top.player_id } : { team_id: winnerTeam };
    const firstBlood = rows.find(r => r.first_blood);
    const firstKill = [...this.feed_].reverse().find(e => e.kind === 'kill');
    const missing = this.matchMissing();
    // Codex r1: a stale player is not flushed (MC never awards it SURVIVOR or IRON MAN), and the mock has no life log,
    // so a player's longest life is estimated from the match length and their deaths (an even split), not one constant.
    const matchMs = (this.config.time_limit_s ?? 600) * 1000;
    const honors = wasArmed ? [] : computeHonors(rows.map(r => ({ id: r.player_id, kills: r.kills, deaths: r.deaths, assists: r.assists,
      best_streak: r.best_streak, multis: r.multi_best ? [r.multi_best] : [], shots: r.shots_total, accuracy: r.accuracy,
      flushed: !missing.includes(r.player_id), longest_life_ms: Math.round(matchMs / (r.deaths + 1)) })), this.config.mode,
      firstBlood && firstKill ? { player_id: firstBlood.player_id, t_match_s: firstKill.t_match_s } : undefined);
    for (const h of honors) rows.find(r => r.player_id === h.player_id)?.medals.push(h.award.replace(' · NON-MVP', ''));
    // Roadmap A6: mirror `Session._recap_stations()` -- one row per ASSIGNED station, straight from its
    // own report, so ?mock's RECAP screen can demo the STATIONS block with no server at all.
    // Server: state.py Session._recap_stations() and Session._scorer_recap().
    const stationRows = this.recapStations(true);
    this.lastMatchStations = stationRows;   // F401: survives `newSession()`, unlike `recap_`
    // A6.1: two kills landed after the whistle. They are REAL and they do NOT count — the demo carries
    // them so the "recorded, not counted" block can be seen (and tested) without a match on the field.
    const late = wasArmed ? [] : rows.slice(0, 2);
    const after_end = late.length === 2 ? {
      facts: 3,
      by_player: { [late[0].player_id]: { kills: 1, deaths: 0 }, [late[1].player_id]: { kills: 0, deaths: 1 } },
    } : undefined;
    this.recap_ = sessionScorerRecap({ winner, score, rows, honors,
                    played_s: Math.max(0, Math.floor((now() - l.go_live_t) / 1000)), provisional: missing.length > 0, missing,
                    post_end: after_end?.facts ?? 0, parked: 0,
                    ...(after_end ? { after_end, post_end_facts: after_end.facts } : {}),
                    }, stationRows);
    // the demo keeps its own history, exactly as the server's session store does — without it the
    // RECAP history picker and the per-match CSV had no way to be seen (let alone tested) in ?mock
    this.history_.unshift({ match_id: l.match_id, mode: this.config.mode, go_live_t: l.go_live_t,
                            ended_t: now(), recap: clone(this.recap_) });
    this.emit();
  }

  // ---------- Api ----------
  async getState() { return this.state(); }
  subscribe(snap: (s: State) => void, feed: (e: FeedEntry, edit?: boolean) => void) {
    // F596/F597 storyboard hook, bound here because this is the instance the console actually uses (StrictMode builds two)
    if (this.galleryFrame && typeof window !== 'undefined') (window as unknown as { __brxGallery?: (f: string) => void }).__brxGallery = (f: string) => { this.galleryFrame = f; this.emit(); };
    const s = { snap, feed }; this.subs.add(s); queueMicrotask(() => snap(this.state()));
    return () => { this.subs.delete(s); };
  }
  async scan(): Promise<ScanRow[]> {
    await new Promise(r => setTimeout(r, 600));
    this.emit();
    return GUNS.map(([s, tail]) => ({ tail, name: `${s}-${tail}`, basename: s, gun_id: s, rssi: -60, identity: 'ok', t: now() }));
  }
  /** A27 (F127): kit -> lobby is REFUSED while a rostered player is not ready, unless `force`. The
   *  refusal is a 409 carrying WHO is not ready, so the console shows the server's list rather than
   *  its own guess — and the mock has to refuse the same way, or `?mock` proves nothing about it. */
  async setPhase(phase: string, force?: boolean) {
    await this.rollFromRecap();          // leaving RECAP by the nav starts the next match (`state.py set_phase`)
    if (phase === 'lobby' && this.phase === 'kit' && !force) {
      const notReady = this.players.filter(p => !p.ready);
      if (notReady.length) {
        const names = notReady.map(p => p.display.toUpperCase());
        const err = new Error(`${names.length} PLAYER${names.length === 1 ? ' IS' : 'S ARE'} NOT READY — CONTINUE ANYWAY TO LOCK THEIR KITS`) as Error & { status?: number; body?: unknown };
        err.status = 409;
        err.body = { error: err.message, not_ready: names, greens: this.players.length - names.length, roster_size: this.players.length };
        throw err;
      }
    }
    this.setPhaseField(phase as Phase); this.emit(); return {};
  }
  async armory() { return GUNS.map(([s, tail]) => ({ gun_id: s, sticker: s, ble: { tail } })); }
  async getVoices() { return { default: 'male', voices: [{ id: 'male', name: 'MALE', family: 'VA', kill_line: 'VAA', verified: false }] }; }
  /** O5: a switch to make the weapon and mode lists fail the way a real MC's 503 does, so the console's
   *  retry chip can be seen and tested in mock mode. `?mock&catalogue=down` sets it at load; a test or
   *  the console (`window.__MC_MOCK__.failCatalogue = false`) clears it. */
  failCatalogue = typeof location !== 'undefined' && new URLSearchParams(location.search).get('catalogue') === 'down';
  failPerks = typeof location !== 'undefined' && new URLSearchParams(location.search).get('perks') === 'down';
  /** `?mock&perks=gone`: an MC with no /api/perks at all (a 404), so the store's stop-on-404 can be seen and tested */
  perksGone = typeof location !== 'undefined' && new URLSearchParams(location.search).get('perks') === 'gone';
  private catalogueDown(): never { throw Object.assign(new Error('WEAPONS UNAVAILABLE: the weapon catalogue failed to load'), { status: 503 }); }
  async getModes(): Promise<ModeInfo[]> { if (this.failCatalogue) this.catalogueDown(); return clone(MODES); }
  async getWeapons(): Promise<WeaponView[]> { if (this.failCatalogue) this.catalogueDown(); return clone(POLICY_WEAPONS); }
  async getPerks(): Promise<PerkView[]> { if (this.perksGone) throw Object.assign(new Error('Not Found'), { status: 404 }); if (this.failPerks) throw Object.assign(new Error('PERKS UNAVAILABLE'), { status: 503 }); return clone(PERKS.filter(k => !k.hidden)); }
  /** F411 §1: every piece, builtins first (they are constructed first and never reordered), then the
   *  host's own pieces by `created_t`. */
  async getPieces(): Promise<GamePiece[]> {
    return clone([...this.pieces].sort((a, b) => (a.builtin === b.builtin ? a.created_t - b.created_t : a.builtin ? -1 : 1)));
  }
  async createPiece(p: { kind: PieceKind; name: string; note?: string; value: Record<string, unknown> }): Promise<GamePiece> {
    if (p.kind === 'mode' || p.kind === 'gameplay') throw Object.assign(new Error(`${p.kind} pieces are fixed and cannot be created`), { status: 403 });
    const name = (p.name ?? '').trim();
    if (!name || name.length > NAME_MAX) throw new Error(`name must be 1 to ${NAME_MAX} characters`);
    const clash = this.pieces.find(x => x.kind === p.kind && x.name.toLowerCase() === name.toLowerCase());
    if (clash) throw Object.assign(new Error(clash.builtin ? `"${clash.name}" is a built-in — pick another name` : `"${clash.name}" already exists for ${p.kind}`), { status: clash.builtin ? 403 : 409 });
    const value = this.checkPieceValue(p.kind, p.value);
    const t = now();
    const piece: GamePiece = { piece_id: uid('piece'), kind: p.kind, name, note: (p.note ?? '').slice(0, 80), builtin: false, post_mvp: false, created_t: t, updated_t: t, value };
    this.pieces = [...this.pieces, piece];
    this.emit();
    return clone(piece);
  }
  /** MEDIUM 3 (review follow-up), mirrors `mcp/brx_mcp/mc/routes/config_game.py pieces_update` exactly: ONLY a value
   *  change on a PICKED piece recomposes the config -- a name/note-only edit changes no game value and
   *  must not touch it at all (this used to recompose on EVERY picked-piece save, which overwrote a
   *  KIT/LOBBY inline edit and re-pushed every gun for a plain rename). The caller (Build.tsx's SAVE)
   *  is the one that decides whether `value` is even in `p` -- omitted when the draft's value has not
   *  changed, exactly as this checks `p.value !== undefined`, never comparing against the old value
   *  itself (the server cannot tell "sent but unchanged" from "sent and changed" either).
   *
   *  Review MEDIUM (brx1, 222b1a81): a value that passes `checkPieceValue`'s own shape check can still
   *  fail to COMPOSE (a bench-gate rule, a cross-field conflict) -- this used to save the piece and
   *  commit the config regardless, reporting `ok:false` in a 200. The server refuses outright and saves
   *  NOTHING; test-compose the checked value before committing anything, so a refusal here rolls back
   *  cleanly (nothing else has been mutated yet) and throws the same 400 `{errors}` the server does. */
  async updatePiece(id: string, p: { name?: string; note?: string; value?: Record<string, unknown> }):
    Promise<GamePiece & { fallbacks?: PieceKind[] }> {
    const piece = this.pieces.find(x => x.piece_id === id);
    if (!piece) throw Object.assign(new Error('no such piece'), { status: 404 });
    if (piece.builtin) throw Object.assign(new Error('a built-in piece cannot be edited — copy it into a new one'), { status: 403 });
    const picked = Object.values(this.gamePick.pieces).includes(id);
    if (picked && (this.phase === 'armed' || this.phase === 'live')) {
      throw Object.assign(new Error('IN USE BY THE RUNNING GAME'), { status: 409 });
    }
    if (picked) await this.rollFromRecap();   // routes/config_game.py `pieces_update`: any picked-piece PUT rolls RECAP, before any precheck
    // Precheck BEFORE anything is saved: a bad value (or, for a picked piece, one `resolvePiecesMixed`
    // cannot resolve) must not leave `piece.name`/`.note` mutated ahead of the throw.
    const willRecompose = picked && p.value !== undefined;
    const checked = p.value !== undefined ? this.checkPieceValue(piece.kind, p.value) : undefined;
    const mixed = willRecompose ? this.resolvePiecesMixed(this.gamePick.pieces, new Set([piece.kind])) : undefined;
    let nm: string | undefined;
    if (p.name != null) {
      nm = p.name.trim();
      if (!nm || nm.length > NAME_MAX) throw new Error(`name must be 1 to ${NAME_MAX} characters`);
      const clash = this.pieces.find(x => x !== piece && x.kind === piece.kind && x.name.toLowerCase() === nm!.toLowerCase());
      if (clash) throw Object.assign(new Error(`"${clash.name}" already exists for ${piece.kind}`), { status: 409 });
    }
    let fallbacks: PieceKind[] | undefined;
    if (mixed) {
      // Speculative: the piece's OWN value must already carry the checked one for `composePartial` to
      // read the NEW value (it looks the piece up by id, not from a value passed in) -- reverted below
      // on a refusal, before the piece is otherwise touched at all.
      const originalValue = piece.value;
      piece.value = checked!;
      const partial = this.composePartial(mixed.ids, this.gamePick.match, piece.kind === 'mode' || piece.kind === 'gameplay');
      const before = this.composeSnapshot();
      const r = await this.putConfig(partial);
      if (!r.ok) {
        piece.value = originalValue;
        this.composeRestore(before);
        throw Object.assign(new Error(r.errors.join(' · ')), { status: 400 });
      }
      fallbacks = mixed.fallbacks;
    }
    if (nm !== undefined) piece.name = nm;
    if (p.note != null) piece.note = p.note.slice(0, 80);
    // Round 3 (invalid preset field): a PUT with a value the CURRENT rules accept clears `invalid` --
    // `checkPieceValue` above already threw if this value would not; reaching here means it does.
    if (checked !== undefined) { piece.value = checked; delete piece.invalid; }
    piece.updated_t = now();
    const out: GamePiece & { fallbacks?: PieceKind[] } = clone(piece);
    if (fallbacks) out.fallbacks = fallbacks;
    this.emit();
    return out;
  }
  async deletePiece(id: string): Promise<void> {
    const piece = this.pieces.find(x => x.piece_id === id);
    if (!piece) throw Object.assign(new Error('no such piece'), { status: 404 });
    if (piece.builtin) throw Object.assign(new Error('a built-in piece cannot be deleted'), { status: 403 });
    if (Object.values(this.gamePick.pieces).includes(id)) throw Object.assign(new Error('IN USE: PICK ANOTHER ON PLAY FIRST'), { status: 409 });
    this.pieces = this.pieces.filter(x => x !== piece);
    this.emit();
  }
  /** The eight-kind default pick (the first builtin of each), and TDM's own MATCH SETTINGS —
   *  games-presets.md §2: "a fresh session picks the first builtin of every kind... and the strip
   *  starts from TDM's defaults, day, not silenced." Called once, from the `gamePick` field
   *  initialiser — `this.pieces` is already assigned by then (fields run top to bottom). */
  private defaultPick(): GamePick {
    const firstOf = (k: PieceKind) => this.pieces.find(p => p.kind === k && !p.post_mvp)!.piece_id;
    const tdm = MODES.find(m => m.mode === 'tdm')!.defaults;
    const pieces: Record<string, string> = {};
    for (const k of PICKER_KINDS) pieces[k] = firstOf(k);
    return { pieces, match: { time_limit_s: tdm.time_limit_s, frag_limit: tdm.scoring.frag_limit, night: false, silenced: false,
      teams: this.config.teams.map(t => t.team_id as TeamColour) } };
  }
  /** Bench-proven-only gate (§13): a piece's `value` is validated the same way `PUT /api/config`
   *  validates the field it feeds, before it can ever be saved. Never trust the caller's shape. */
  private checkPieceValue(kind: PieceKind, value: Record<string, unknown>): Record<string, unknown> {
    const v = value ?? {};
    switch (kind) {
      case 'life': {
        // Review MEDIUM 4: 0..999 for every field was never the server's own range -- max_hp is the
        // one number a player cannot have none of (0 HP is not "hardcore", it is dead on arrival).
        const RANGE = { max_hp: [1, 255], max_armor: [0, 255], max_shield: [0, 255] } as const;
        const keys = ['max_hp', 'max_armor', 'max_shield'] as const;
        // Review Low (brx1, 222b1a81): `Number(v[k])` coerced a STRING ("45") into a passing integer --
        // the server's own equivalent (state.py `_check_loadout`'s `overrides.max_hp`/`max_armor`)
        // checks the RAW value's type first (`isinstance(v, bool) or not isinstance(v, int)`); the raw
        // type check here is `typeof n !== 'number'`, which a string OR a boolean both fail outright.
        keys.forEach(k => {
          const n = v[k];
          const [lo, hi] = RANGE[k];
          if (typeof n !== 'number' || !Number.isInteger(n) || n < lo || n > hi) throw Object.assign(new Error(`${k} must be an integer ${lo}..${hi}`), { status: 400 });
        });
        const [max_hp, max_armor, max_shield] = keys.map(k => v[k] as number);
        return { max_hp, max_armor, max_shield };
      }
      case 'spawn': {
        const type = v.type;
        if (type !== 'auto' && type !== 'scanner') throw new Error("spawn.type must be 'auto' or 'scanner'");
        const delay_s = Number(v.delay_s ?? 0);
        if (!Number.isInteger(delay_s) || delay_s < 0 || delay_s > 300) throw new Error('spawn.delay_s must be an integer 0..300');
        if (delay_s > 0 && delay_s < 3) throw new Error('spawn.delay_s of 1 or 2 seconds wedges the headset relay: use 0, or 3 or more');
        if ('gate' in v && v.gate != null && v.gate !== 'trigger') throw new Error("spawn.gate may only be 'trigger' — presence is not yet bench-proven (§13)");
        if ('station_source' in v) throw new Error('a spawn piece never carries station_source — the mode decides it');
        if (type === 'auto') {
          const protect_s = v.protect_s ?? TIMED_PROTECT_S_DEFAULT;
          if (!(TIMED_PROTECT_S_OPTIONS as readonly unknown[]).includes(protect_s)) throw new Error(`spawn.protect_s must be one of ${TIMED_PROTECT_S_OPTIONS.join(', ')}`);
          const weapon_delay_ms = v.weapon_delay_ms ?? WEAPON_DELAY_MS_DEFAULT;
          if (!(WEAPON_DELAY_MS_OPTIONS as readonly unknown[]).includes(weapon_delay_ms)) throw new Error(`spawn.weapon_delay_ms must be one of ${WEAPON_DELAY_MS_OPTIONS.join(', ')}`);
          return { type, delay_s, protect_s, weapon_delay_ms };
        }
        const station_protect_s = v.station_protect_s ?? STATION_PROTECT_S_DEFAULT;
        if (!(STATION_PROTECT_S_OPTIONS as readonly unknown[]).includes(station_protect_s)) throw new Error(`spawn.station_protect_s must be one of ${STATION_PROTECT_S_OPTIONS.join(', ')}`);
        return { type, delay_s, station_protect_s, gate: 'trigger' };
      }
      case 'primary': case 'secondary': case 'perks': {
        const choice = v.choice;
        if (!['player', 'host', 'fixed', 'off'].includes(choice as string)) throw new Error('choice must be one of player, host, fixed, off');
        if (kind === 'primary' && choice === 'off') throw new Error('primary cannot be off — a player needs something to carry');
        const kinds = kind === 'perks' ? ['perk'] : (Array.isArray(v.kinds) && v.kinds.length ? v.kinds : ['weapon']);
        const only_ids: string[] = Array.isArray(v.only_ids) ? v.only_ids : [];
        const fixed_id = choice === 'fixed' ? ((v.fixed_id as string | null) ?? null) : null;
        // Review MEDIUM 4 / round 3 HIGH 1: a hidden/pickup-only/unknown id used to sail straight
        // through -- refused with the SAME words `check_value`/`_check_slot` uses, which is also the
        // exact reason text a stored piece's own `invalid` field carries (games-presets.md's "invalid"
        // shape) when a rule tightens under it later. The mock's own catalogue carries no hidden ROW
        // today (only perks.hidden and weapons.pickup_only), so "pickable" here is exactly "not
        // excluded by either" -- an id failing that is either unknown or excluded, and both read the
        // same to the operator: not offered any more.
        const pickable = kind === 'perks'
          ? (id: string) => PERKS.some(k => k.perk_id === id && !k.hidden)
          : (id: string) => WEAPONS.some(w => w.weapon_id === id && !w.pickup_only);
        const displayOf = (id: string) => {
          const row = kind === 'perks' ? PERKS.find(k => k.perk_id === id) : WEAPONS.find(w => w.weapon_id === id);
          return (row?.name ?? id.replace(/_/g, ' ')).toUpperCase();
        };
        const named = [...(fixed_id != null ? [fixed_id] : []), ...only_ids];
        const bad = named.filter(id => !pickable(id));
        if (bad.length) {
          const names = [...new Set(bad.map(displayOf))].join(', ');
          const verb = bad.length === 1 ? 'IS' : 'ARE';
          throw Object.assign(new Error(`NAMES ${names}, WHICH ${verb} NO LONGER OFFERED: PICK A DIFFERENT WEAPON OR PERK`), { status: 400 });
        }
        return { choice, kinds,
          exclude_tags: Array.isArray(v.exclude_tags) ? v.exclude_tags : [],
          exclude_ids: Array.isArray(v.exclude_ids) ? v.exclude_ids : [],
          only_ids, fixed_id };
      }
      case 'misc_loadouts':
        return { hud_select: !!v.hud_select, heavies: v.heavies !== false };
      case 'mode': case 'gameplay':
        throw Object.assign(new Error(`${kind} pieces are fixed and cannot be created or edited`), { status: 403 });
    }
  }
  /** §3: compose the `GameConfig` partial the pick's pieces + strip describe. */
  /** F413 (games-presets.md §7): 2 to 4 UNIQUE colours from red/blue/yellow/purple; KOTH is exactly 2
   *  and never offers yellow (a neutral hill broadcasts tid 2, F82 -- the same fault a yellow ROSTER
   *  refuses elsewhere, refused here before it ever reaches one). */
  /** gamepick.merge_match checks team choice shape before composing a config patch. */
  private checkTeamsShape(teams: unknown): TeamColour[] {
    const ALL: TeamColour[] = [...TEAM_KEYS];
    const validShape = Array.isArray(teams) && teams.length >= TEAM_COUNT_MIN && teams.length <= TEAM_COUNT_MAX
      && teams.every(c => typeof c === 'string' && ALL.includes(c as TeamColour))
      && new Set(teams).size === teams.length;
    if (!validShape) throw Object.assign(new Error(`TEAM COLOURS MUST BE ${TEAM_COUNT_MIN}-${TEAM_COUNT_MAX} UNIQUE PICKS FROM ${ALL.map(c => c.toUpperCase()).join(', ')}`), { status: 400 });
    return teams as TeamColour[];
  }
  /** gamepick.merge_match checks the integer shape. Config merge checks the mode and range. */
  private checkHoldTargetShape(v: unknown): number | null {
    if (v == null) return null;
    if (!Number.isInteger(v)) throw Object.assign(new Error('HOLD TARGET MUST BE A WHOLE NUMBER OR EMPTY: CHECK THE VALUE'), { status: 400 });
    return v as number;
  }
  /** gamepick.merge_match's `hill` branch: null clears all, a null key clears that key, each set key a whole number in range. */
  private mergeHillPatch(prev: HillSettings | undefined, v: unknown): HillSettings | undefined {
    if (v === null) return undefined;
    if (typeof v !== 'object' || Array.isArray(v)) throw Object.assign(new Error('HILL SETTINGS MUST BE AN OBJECT OR EMPTY: CHECK THE REQUEST'), { status: 400 });
    const bounds: Record<string, [number, number]> = { capture_s: [HILL_CAPTURE_S_MIN, HILL_CAPTURE_S_MAX], net_cap: [HILL_NET_CAP_MIN, HILL_NET_CAP_MAX] };
    const hill: Record<string, number> = { ...(prev ?? {}) };
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (!(k in bounds)) throw Object.assign(new Error(`${k.toUpperCase()} IS NOT A HILL SETTING: USE CAPTURE_S OR NET_CAP`), { status: 400 });
      if (x == null) { delete hill[k]; continue; }
      const [lo, hi] = bounds[k];
      if (typeof x !== 'number' || !Number.isInteger(x) || x < lo || x > hi) {
        // two literal lines, as gamepick.py words them (test_mc_mock_lines matches the mock's lines against MC's)
        throw Object.assign(new Error(k === 'capture_s' ? `CAPTURE TIME MUST BE A WHOLE NUMBER ${lo}-${hi}: CHECK THE VALUE`
          : `NET CAP MUST BE A WHOLE NUMBER ${lo}-${hi}: CHECK THE VALUE`), { status: 400 });
      }
      hill[k] = x;
    }
    return Object.keys(hill).length ? hill as HillSettings : undefined;
  }
  /** picks.py `_hill_for_mode`: a mode without the hill item drops a hill the pick or favourite names, and the pick then
   *  holds what the config holds. A pick and a favourite load both come through here. */
  private hillForMode(match: MatchSettings, mode: string): void {
    if (MODES.find(m => m.mode === mode)?.match_items?.includes('hill')) return;
    delete match.hill;
    if (this.config.hill && Object.keys(this.config.hill).length) match.hill = { ...this.config.hill };
  }

  private composePartial(pieceIds: Record<string, string>, match: MatchSettings, resetModeParams = true): Partial<GameConfig> {
    const valueOf = <T,>(kind: PieceKind) => this.pieces.find(x => x.piece_id === pieceIds[kind])!.value as T;
    const modeV = valueOf<{ mode: string }>('mode');
    const modeInfo = MODES.find(m => m.mode === modeV.mode)!;
    const lifeV = valueOf<{ max_hp: number; max_armor: number; max_shield: number }>('life');
    const spawnV = valueOf<Respawn>('spawn');
    const primaryV = valueOf<SlotRule>('primary');
    const secondaryV = valueOf<SlotRule>('secondary');
    const perkV = valueOf<SlotRule>('perks');
    const miscV = valueOf<{ hud_select: boolean; heavies: boolean }>('misc_loadouts');
    const gameplayV = valueOf<{ mode_params: Record<string, unknown> }>('gameplay');

    // §3.4: the blanket HEAVIES exclude, unless the slot piece already carries its own (the slot wins).
    const withHeavyExcl = (rule: SlotRule): SlotRule =>
      (!miscV.heavies && rule.exclude_tags.length === 0) ? { ...rule, exclude_tags: ['heavy'] } : rule;
    const loadout_policy: LoadoutPolicy = {
      preset: 'custom', hud_select: miscV.hud_select,
      primary: withHeavyExcl(clone(primaryV)), secondary: withHeavyExcl(clone(secondaryV)), perk: clone(perkV),
    };
    loadout_policy.preset = presetOf(loadout_policy);

    const partial: Partial<GameConfig> = {
      mode: modeV.mode,
      health: { ...clone(lifeV), preset: healthPresetOf(lifeV) },
      // §3.3: a mode whose own default respawn type is "none" (post-MVP LMS) keeps its own.
      ...(modeInfo.defaults.respawn.type === 'none' ? {} : { respawn: clone(spawnV) }),
      loadout_policy,
      // F470, as gamepick.py compose: only a pick naming the mode or gameplay piece (or a favourite load) resets mode_params
      ...(resetModeParams ? { mode_params: { ...defaultModeParams(modeInfo), ...gameplayV.mode_params } as Record<string, number | boolean | string> } : {}),
      time_limit_s: match.time_limit_s,
      // gamepick.compose writes the hold target only when the mode offers that control.
      scoring: { win_by: modeInfo.defaults.scoring.win_by, frag_limit: match.frag_limit,
        ...(modeInfo.match_items?.includes('hold') ? { hold_target_s: match.hold_target_s ?? null } : {}) },
      night: match.night,
      // gamepick.compose, F559: written whenever the mode offers it (null clears), every key named so a cleared one crosses as null.
      ...(modeInfo.match_items?.includes('hill')
        ? { hill: match.hill ? { capture_s: match.hill.capture_s ?? null, net_cap: match.hill.net_cap ?? null } as unknown as HillSettings : null } : {}),
      // §3.6: SILENCED applies the full silenced preset together; off returns the mode's own automatic one.
      presentation: { preset: match.silenced ? 'silenced' : String(modeInfo.defaults.presentation?.preset ?? 'standard') },
      // §3.7 (F546): no `environment`: a pick keeps the operator's venue, and putConfig carries it across a mode change.
      // A cleared team choice writes the picked mode's defaults. FFA has no team control.
      ...(modeInfo.match_items?.includes('teams') ? { teams: (match.teams ?? modeInfo.defaults.teams.map(t => t.team_id as TeamColour))
        .map(c => TEAMS.find(t => t.team_id === c)!) } : {}),
    };
    return partial;
  }
  /** F411 `POST /api/play/pick` (games-presets.md §4). `ok: false` changes nothing: not the pick, not
   *  the config — so a content-validation failure rolls the config back rather than leaving the two
   *  disagreeing. A bad piece id/kind/post_mvp pick, or a bad match value, throws before anything is
   *  touched at all (the routes table's 400s); a phase refusal propagates from `putConfig` unchanged. */
  async pick(p: { pieces?: Partial<Record<PieceKind, string>>; match?: Partial<MatchSettings> }):
    Promise<{ ok: boolean; errors: string[]; config: ConfigView; pick: GamePick; fallbacks: PieceKind[] }> {
    const patchIds = p.pieces ?? {};
    // Round 2 (server review): a kind the REQUEST itself names still 404s/400s on a bad id -- the
    // operator's own mistake to fix. A kind merely INHERITED from the previous pick (a post-MVP mode
    // set on KIT, say) falls back to that kind's builtin instead of 404ing an UNRELATED pick, named in
    // the returned `fallbacks` -- the same grace `loadFavourite` already gives a saved pick.
    const { ids: resolvedIds, fallbacks } = this.resolvePiecesMixed({ ...this.gamePick.pieces, ...patchIds }, new Set(Object.keys(patchIds)));
    const modeChanged = resolvedIds.mode !== this.gamePick.pieces.mode;
    const modePiece = this.pieces.find(x => x.piece_id === resolvedIds.mode)!;
    const modeInfo = MODES.find(m => m.mode === (modePiece.value as { mode: string }).mode)!;
    const match: MatchSettings = { ...this.gamePick.match };
    if (modeChanged) {
      match.time_limit_s = modeInfo.defaults.time_limit_s;
      match.frag_limit = modeInfo.defaults.scoring.frag_limit ?? null;
      // F413/F415: "a mode change resets teams to the new mode's default, like the limits" -- gated on
      // the mode's OWN match_items (the same authority the console's strip renders from), never on
      // `defaults.teams` alone: a SOLO mode (FFA) still carries one placeholder team (`team_id: 'ffa'`,
      // rules/scoring.ts's own SOLO_MODES rule) that is not a real TeamColour and must never reach
      // `match.teams` -- it composed into a config.teams row TEAMS.find() could never resolve.
      //
      // team-lead's scope decision (2026-09-27): `modeInfo.defaults.teams` IS red+blue now for every
      // team mode (data.ts's `base()`), matching the server -- reading it straight here (rather than a
      // separate hardcoded literal) keeps ONE source of truth for it, shared with `putConfig`'s own
      // mode-changed base rebuild and `Games.tsx`'s client-side prediction. Only the static DEMO's own
      // STARTING session (mock/backend.ts's `config` field initialiser) overrides back to blue/yellow,
      // on purpose -- a fixture already in progress, not a fresh pick.
      //
      // Bench 2026-09-28 (Tony): the teams CARRY when the count still fits, with only an illegal colour
      // swapped (`carryTeams`, mirroring gamepick.py `carry_teams`); reteamForConfig then recolours by
      // index, so every player keeps their side.
      match.teams = modeInfo.match_items?.includes('teams')
        ? carryTeams(this.gamePick.match.teams
            ?? this.config.teams.filter(t => t.team_id !== 'ffa').map(t => t.team_id as TeamColour), modeInfo.defaults.teams.map(t => t.team_id as TeamColour), modeInfo.mode)
        : undefined;
      delete match.hold_target_s;
      // F559: `hill` is kept across a mode change, as picks.py keeps it; only koth composes it
    }
    const pm = p.match ?? {};
    if ('time_limit_s' in pm) {
      if (pm.time_limit_s != null && (!Number.isInteger(pm.time_limit_s) || pm.time_limit_s <= 0)) throw Object.assign(new Error('match.time_limit_s must be a positive integer of seconds, or null'), { status: 400 });
      match.time_limit_s = pm.time_limit_s ?? null;
    }
    if ('frag_limit' in pm) {
      if (pm.frag_limit != null && (!Number.isInteger(pm.frag_limit) || pm.frag_limit <= 0)) throw Object.assign(new Error('scoring.frag_limit must be a positive integer or null'), { status: 400 });
      match.frag_limit = pm.frag_limit ?? null;
    }
    if ('night' in pm) match.night = !!pm.night;
    if ('silenced' in pm) match.silenced = !!pm.silenced;
    if ('teams' in pm) {
      if (pm.teams == null) delete match.teams;
      else match.teams = this.checkTeamsShape(pm.teams);
    }
    if ('hold_target_s' in pm) {
      const hold = this.checkHoldTargetShape(pm.hold_target_s);
      if (hold == null) delete match.hold_target_s;
      else match.hold_target_s = hold;
    }

    if ('hill' in pm) {
      const hill = this.mergeHillPatch(match.hill, pm.hill);
      if (hill) match.hill = hill; else delete match.hill;
    }
    this.hillForMode(match, modeInfo.mode);

    const partial = this.composePartial(resolvedIds, match, modeChanged || 'mode' in (p.pieces ?? {}) || 'gameplay' in (p.pieces ?? {}));
    await this.rollFromRecap();   // routes/config_game.py: `_refuse_config_locked` rolls RECAP forward before the precheck
    const before = this.composeSnapshot();
    let r: Awaited<ReturnType<MockBackend['putConfig']>>;
    try {
      r = await this.putConfig(partial);
    } catch (error) {
      // GamePick._apply_patch returns a config-merge precheck refusal as ok:false.
      if (!(error instanceof ConfigMergeError)) throw error;
      return { ok: false, errors: [error.message], config: clone(this.config), pick: clone(this.gamePick), fallbacks };
    }
    if (!r.ok) {
      this.composeRestore(before);   // "ok: false changes nothing" — not the pick, not the config
      this.emit();
      return { ok: false, errors: r.errors, config: clone(this.config), pick: clone(this.gamePick), fallbacks };
    }
    // From `resolvedIds`, not the raw merged ids (mirrors routes/config_game.py play_pick exactly): a kind that fell
    // back to its builtin must PERSIST that builtin's id, or the stale one sits right back in
    // `game_pick` for the next request to trip over again.
    this.gamePick = { pieces: resolvedIds, match };
    this.emit();
    return { ok: true, errors: [], config: r.config, pick: clone(this.gamePick), fallbacks };
  }

  // ---------- F411 §6: FAVOURITES ----------
  async getFavourites(): Promise<Favourite[]> {
    return clone([...this.favourites].sort((a, b) => a.created_t - b.created_t));
  }
  async createFavourite(p: { name: string; countdown_s: number; pick?: GamePick }): Promise<Favourite> {
    const name = (p.name ?? '').trim().replace(/\s+/g, ' ');
    if (!name || name.length > NAME_MAX) throw new Error(`name must be ${NAME_MAX} characters or fewer`);
    if (this.favourites.some(f => f.name.toLowerCase() === name.toLowerCase())) {
      throw Object.assign(new Error(`a favourite named "${name}" already exists`), { status: 409 });
    }
    if (!Number.isInteger(p.countdown_s) || p.countdown_s < RUNWAY_MIN_S || p.countdown_s > RUNWAY_MAX_S) {
      throw new Error(`countdown_s must be an integer ${RUNWAY_MIN_S}..${RUNWAY_MAX_S}`);
    }
    const pick = p.pick ?? this.gamePick;   // default: the current pick (games-presets.md §6)
    if (pick?.match && 'hill' in pick.match) {   // favourites._check_match
      const h = pick.match.hill as unknown;
      const okHill = typeof h === 'object' && h !== null && !Array.isArray(h) && Object.entries(h).every(([k, v]) =>
        (k === 'capture_s' && Number.isInteger(v) && (v as number) >= HILL_CAPTURE_S_MIN && (v as number) <= HILL_CAPTURE_S_MAX)
        || (k === 'net_cap' && Number.isInteger(v) && (v as number) >= HILL_NET_CAP_MIN && (v as number) <= HILL_NET_CAP_MAX));
      if (!okHill) throw Object.assign(new Error(`HILL SETTINGS MUST BE CAPTURE_S ${HILL_CAPTURE_S_MIN}-${HILL_CAPTURE_S_MAX} AND/OR NET_CAP ${HILL_NET_CAP_MIN}-${HILL_NET_CAP_MAX}, WHOLE NUMBERS: CHECK THE VALUES`), { status: 400 });
    }
    if (!pick?.pieces || PICKER_KINDS.some(k => typeof pick.pieces[k] !== 'string' || !pick.pieces[k])) {
      throw new Error(`pick.pieces must carry a piece id for every kind (${PICKER_KINDS.join(', ')})`);
    }
    const t = now();
    const row: Favourite = { favourite_id: uid('fav'), name, created_t: t, updated_t: t, pick: clone(pick), countdown_s: p.countdown_s };
    this.favourites = [...this.favourites, row];
    this.emit();
    return clone(row);
  }
  async updateFavourite(id: string, p: { name: string }): Promise<Favourite> {
    const row = this.favourites.find(f => f.favourite_id === id);
    if (!row) throw Object.assign(new Error('no such favourite'), { status: 404 });
    const name = (p.name ?? '').trim().replace(/\s+/g, ' ');
    if (!name || name.length > NAME_MAX) throw new Error(`name must be ${NAME_MAX} characters or fewer`);
    if (this.favourites.some(f => f !== row && f.name.toLowerCase() === name.toLowerCase())) {
      throw Object.assign(new Error(`a favourite named "${name}" already exists`), { status: 409 });
    }
    row.name = name; row.updated_t = now();
    this.emit();
    return clone(row);
  }
  async deleteFavourite(id: string): Promise<void> {
    const row = this.favourites.find(f => f.favourite_id === id);
    if (!row) throw Object.assign(new Error('no such favourite'), { status: 404 });
    this.favourites = this.favourites.filter(f => f !== row);
    this.emit();
  }
  /** Like the pick-id loop in `pick()` above, but a missing/wrong-kind/post_mvp id falls back to that
   *  kind's first builtin instead of throwing (games-presets.md §6: "stores piece references... never a
   *  404 for the whole favourite"). `this.pieces` always carries builtins first (never reordered), so
   *  the first non-post_mvp match of a kind IS that kind's shipped builtin — mirrors the server's own
   *  fixed `BUILTIN_IDS` table exactly. */
  /** Round 2: `POST /api/play/pick` calls this too now (mirrors `gamepick.py resolve_pieces_mixed`
   *  exactly). A kind in `strictKinds` (the REQUEST itself named it) still 404s/400s on a bad id --
   *  the operator's own mistake to fix. A kind merely INHERITED from the previous pick (or, for
   *  `loadFavourite` below, EVERY kind: `strictKinds` empty) falls back to that kind's first builtin
   *  instead, named in the returned `fallbacks` -- never a 404 for the whole request/favourite over a
   *  piece nobody asked to change. */
  private resolvePiecesMixed(ids: Record<string, string>, strictKinds: ReadonlySet<string>): { ids: Record<string, string>; fallbacks: PieceKind[] } {
    const out: Record<string, string> = {};
    const fallbacks: PieceKind[] = [];
    for (const kind of PICKER_KINDS) {
      const pid = ids[kind];
      if (strictKinds.has(kind)) {
        if (!pid) throw Object.assign(new Error(`no piece picked for '${kind}'`), { status: 400 });
        const piece = this.pieces.find(x => x.piece_id === pid);
        if (!piece) throw Object.assign(new Error(`unknown piece id '${pid}'`), { status: 404 });
        if (piece.kind !== kind) throw Object.assign(new Error(`piece '${pid}' is a ${piece.kind} piece, not ${kind}`), { status: 400 });
        if (piece.post_mvp) throw Object.assign(new Error(`'${piece.name}' is post-MVP and cannot be picked yet`), { status: 400 });
        // Round 3 (invalid preset field): a piece a rule tightened under is kept, shown in BUILD, but
        // never pickable -- the REQUEST naming it directly gets its own stored reason as the 400,
        // exactly as if it had just failed that same check live.
        if (piece.invalid) throw Object.assign(new Error(piece.invalid), { status: 400 });
        out[kind] = pid;
        continue;
      }
      const piece = pid ? this.pieces.find(x => x.piece_id === pid) : undefined;
      if (piece && piece.kind === kind && !piece.post_mvp && !piece.invalid) { out[kind] = pid; continue; }
      out[kind] = this.pieces.find(x => x.kind === kind && !x.post_mvp && !x.invalid)!.piece_id;
      fallbacks.push(kind);
    }
    return { ids: out, fallbacks };
  }
  async loadFavourite(id: string):
    Promise<{ ok: boolean; errors: string[]; config: ConfigView; pick: GamePick; countdown_s: number; fallbacks: PieceKind[] }> {
    const row = this.favourites.find(f => f.favourite_id === id);
    if (!row) throw Object.assign(new Error('no such favourite'), { status: 404 });
    const { ids, fallbacks } = this.resolvePiecesMixed(row.pick.pieces, new Set());
    const match = clone(row.pick.match);
    this.hillForMode(match, (this.pieces.find(x => x.piece_id === ids.mode)!.value as { mode: string }).mode);
    const partial = this.composePartial(ids, match);
    await this.rollFromRecap();   // routes/config_game.py: `_refuse_config_locked` rolls RECAP forward before the precheck
    const before = this.composeSnapshot();
    let r: Awaited<ReturnType<MockBackend['putConfig']>>;
    try {
      r = await this.putConfig(partial);
    } catch (error) {
      // the server's favourite load runs the same precheck as a pick: a merge refusal is ok:false, not a throw
      if (!(error instanceof ConfigMergeError)) throw error;
      return { ok: false, errors: [error.message], config: clone(this.config), pick: clone(this.gamePick), countdown_s: row.countdown_s, fallbacks };
    }
    if (!r.ok) {
      this.composeRestore(before);   // "ok: false changes nothing" -- same rule as pick()
      this.emit();
      return { ok: false, errors: r.errors, config: clone(this.config), pick: clone(this.gamePick), countdown_s: row.countdown_s, fallbacks };
    }
    this.gamePick = { pieces: ids, match };
    this.emit();
    return { ok: true, errors: [], config: r.config, pick: clone(this.gamePick), countdown_s: row.countdown_s, fallbacks };
  }

  async previewPool(policy: Partial<LoadoutPolicy>, mode?: string) {
    const base = policy.preset && policy.preset !== 'custom' ? clone(PRESETS[policy.preset]) : clone(defaultPolicy(mode ?? this.config.mode));
    const merged: LoadoutPolicy = { ...base, ...policy, primary: { ...base.primary, ...(policy.primary ?? {}) }, secondary: { ...base.secondary, ...(policy.secondary ?? {}) }, perk: { ...base.perk, ...(policy.perk ?? {}) } };
    merged.preset = policy.preset === 'custom' ? 'custom' : presetOf(merged);
    return { policy: merged, pool: poolOf(merged, POLICY_WEAPONS, PERKS, healthPresetOf(this.config.health)) };
  }
  async putConfig(partial: Partial<GameConfig>) {
    // F151 (field 2026-09-12, ISSUE 25): the mock used to accept `PUT /api/config` in ANY phase, which
    // let `?mock` show a Games/Designer screen that looked fully live even after the field had moved on
    // to armed/live/recap, hiding the exact "silent tap" defect the console has to guard against on a
    // real server. The phase list is `state.py set_config`'s, read off the server and not off API.md:
    // LOBBY is accepted (it always was server-side, and B3's inline GameEditPanel on KIT and LOBBY is
    // built on it — an edit there RE-PUSHES rather than being refused). What F151 locks at lobby is the
    // GAMES STEPPER, and that lock lives in `Games.tsx`, where it can explain itself. A mock stricter
    // than the server is the same defect in the other direction: a demo that refuses what the field
    // does every match.
    // 2026-09-16: in RECAP, ANY config edit rolls the finished session forward (`state.py
    // _roll_forward_from_recap`: roster kept, game kept, recap archived) and then applies. The old
    // server took a MODE pick only; Tony: "why? just make a new one".
    await this.rollFromRecap();
    if (!(['muster', 'build', 'kit', 'lobby'] as Phase[]).includes(this.phase)) {
      throw Object.assign(new Error(`game settings are locked: the match is already in ${this.phase.toUpperCase()} — RECALL or END it first to edit the game again`), { status: 409 });
    }
    const prevMode = this.config.mode, prevPol = this.config.loadout_policy;
    const prevTeams = [...(this.config.teams ?? [])];   // FIELD-1: the INDEX map needs the old order
    // F70: `station_source` is a CLOSED vocabulary server-side (state.py _merge_config raises, the API
    // answers 400 naming every legal value). The demo refuses the same way, so the OBJECTIVE SOURCE
    // control cannot look more permissive in `?mock` than it is against a real MC.
    if ('station_source' in partial && partial.station_source != null && !MOCK_STATION_SOURCES.some(s => s.value === partial.station_source)) {
      throw new Error('station_source must be null or one of: '
        + MOCK_STATION_SOURCES.map(s => `${s.value} (${s.desc})`).join(', '));
    }
    // K8: `volume` is an integer GAME_VOLUME_MIN..MAX or null (the venue default), refused in the server's words.
    if ('volume' in partial && partial.volume != null
        && !(Number.isInteger(partial.volume) && partial.volume >= GAME_VOLUME_MIN && partial.volume <= GAME_VOLUME_MAX)) {
      throw Object.assign(new Error(`volume must be an integer ${GAME_VOLUME_MIN}-${GAME_VOLUME_MAX} or null (the venue default), got ${JSON.stringify(partial.volume)}`), { status: 400 });
    }
    // 2026-09-19 respawn profiles: `respawn.protect_s`/`weapon_delay_ms`/`station_protect_s` are each a
    // closed set of options (`compile.respawn_settings`, same refusal wording); an absent key keeps its
    // default rather than being refused, exactly like the real server merging onto the current config.
    if (partial.respawn) {
      const merged = { ...this.config.respawn, ...partial.respawn };
      for (const [name, v, ok] of [
        ['protect_s', merged.protect_s ?? TIMED_PROTECT_S_DEFAULT, TIMED_PROTECT_S_OPTIONS],
        ['weapon_delay_ms', merged.weapon_delay_ms ?? WEAPON_DELAY_MS_DEFAULT, WEAPON_DELAY_MS_OPTIONS],
        ['station_protect_s', merged.station_protect_s ?? STATION_PROTECT_S_DEFAULT, STATION_PROTECT_S_OPTIONS],
      ] as const) {
        if (!(ok as readonly number[]).includes(v)) throw new Error(`respawn.${name} must be one of ${ok.join(', ')}`);
      }
    }
    // F-10 (2026-09-13): `state.py set_config` rebuilds the WHOLE config from `default_config(mode)`
    // whenever the mode changes, THEN merges the patch on top — so nothing belonging to the OLD mode
    // can survive the switch. `station_source` was the one key this mirrored (F70: only the objective
    // modes carry one); `teams` was not, so a bare `{ mode: 'koth' }` (GameEditPanel's inline mode Seg,
    // never `Games.tsx`'s full-defaults tile) spread onto the PREVIOUS config left TDM's BLUE/YELLOW in
    // place instead of KOTH's BLUE/PURPLE, and `?mock` predicted a roster the real server never
    // produces. Venue facts (environment/night/coverage/volume) are carried forward exactly like the server
    // carries them (`_candidate_config`, same four keys, same "unless the patch itself names them" rule) —
    // they describe the SITE, not the game.
    const modeChanged = !!partial.mode && partial.mode !== prevMode;
    const base: ConfigView = modeChanged ? withPolicy(clone(MODES.find(m => m.mode === partial.mode)!.defaults)) : clone(this.config);
    if (modeChanged) {
      if (partial.environment === undefined) base.environment = this.config.environment;
      if (partial.night === undefined) base.night = this.config.night;
      if (partial.coverage === undefined && this.config.coverage !== undefined) base.coverage = this.config.coverage;
      // K8 / mc.md #1: the host's volume is a venue fact too (state.py `_candidate_config`); a PICK never writes it
      if (!('volume' in partial) && this.config.volume != null) base.volume = this.config.volume;
      // F559: the hill tuning carries across a mode change too (`_candidate_config`)
      if (!('hill' in partial) && this.config.hill != null) base.hill = this.config.hill;
    }
    // config_merge.py rejects these before Session.set_config changes config or the roster.
    // PICK turns the same precheck refusal into ok:false, while a direct PUT throws.
    if (partial.teams && (partial.mode ?? base.mode) === 'koth') {
      if (partial.teams.length !== 2) throw new ConfigMergeError('KING OF THE HILL IS EXACTLY 2 TEAMS: PICK TWO COLOURS');
      if (partial.teams.some(t => t.team_id === 'yellow')) {
        throw new ConfigMergeError("YELLOW IS KING OF THE HILL'S NEUTRAL TEAM: PICK RED, BLUE OR PURPLE");
      }
    }
    const scoring = partial.scoring ? { ...base.scoring, ...partial.scoring } : base.scoring;
    const hold = scoring.hold_target_s;
    if (partial.scoring && 'hold_target_s' in partial.scoring && hold != null) {
      if ((partial.mode ?? base.mode) !== 'koth') {
        throw new ConfigMergeError('A HOLD TARGET ONLY APPLIES TO KING OF THE HILL: CLEAR IT OR PICK KING OF THE HILL');
      }
      if (!Number.isInteger(hold) || hold <= 0 || hold > HOLD_TARGET_MAX_S) {
        throw new ConfigMergeError('HOLD TARGET MUST BE 1 S TO 2:00:00, OR NO TARGET');
      }
    }
    const candidate: ConfigView = { ...base, ...partial, scoring, config_id: uid('cfg') };
    if (partial.mode_params !== undefined) {
      const mode = MODES.find(row => row.mode === candidate.mode)!;
      const params = mergeModeParams(mode, base.mode_params, partial.mode_params);
      if (params) candidate.mode_params = params;
      else delete candidate.mode_params;
    }
    if (partial.presentation !== undefined) {
      candidate.presentation = mergePresentation(base.presentation, partial.presentation, candidate.mode);
    }
    if (candidate.scoring.hold_target_s == null) delete candidate.scoring.hold_target_s;
    if (partial.hill !== undefined) {
      // F559: config_merge.py `_hill`, in its words: merged key by key onto the stored one, a null key or `hill: null` clears
      const h = partial.hill as Record<string, unknown> | null;
      if (h !== null && (typeof h !== 'object' || Array.isArray(h))) throw new ConfigMergeError('hill must be {capture_s?, net_cap?} or null');
      const bounds: Record<string, [number, number]> = { capture_s: [HILL_CAPTURE_S_MIN, HILL_CAPTURE_S_MAX], net_cap: [HILL_NET_CAP_MIN, HILL_NET_CAP_MAX] };
      const merged: Record<string, number> = h === null ? {} : { ...(base.hill ?? {}) };
      for (const [k, v] of Object.entries(h ?? {})) {
        if (!(k in bounds)) throw new ConfigMergeError(`hill.${k} is not a hill setting (capture_s, net_cap)`);
        if (v === null) { delete merged[k]; continue; }
        const [lo, hi] = bounds[k];
        if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new ConfigMergeError(`hill.${k} must be a whole number ${lo}-${hi}`);
        merged[k] = v;
      }
      if (Object.keys(merged).length) candidate.hill = merged; else delete candidate.hill;
    }
    if (candidate.volume == null) delete candidate.volume;   // K8: null = the venue default, stored as absence
    if (candidate.coverage == null) delete candidate.coverage;   // config_merge.py: a null coverage removes the key
    if (partial.loadout_policy) {
      // mirrors policy.merge (A10 §3): a preset NAME rewrites the rules, then any slot/hud_select keys in the same
      // patch merge on top, then the name is re-derived (custom if nothing matches). The un-named base is the
      // NEW mode's policy once the mode has changed (`base.loadout_policy`), never the old one (`prevPol`) —
      // the same "fresh default, patch on top" rule as the rest of this rebuild.
      const lp = partial.loadout_policy as Partial<typeof prevPol>;
      const polBase = lp.preset && lp.preset !== 'custom' ? clone(PRESETS[lp.preset]) : clone(base.loadout_policy);
      if (lp.primary) polBase.primary = { ...polBase.primary, ...lp.primary };
      if (lp.secondary) polBase.secondary = { ...polBase.secondary, ...lp.secondary };
      if (lp.perk) polBase.perk = { ...polBase.perk, ...lp.perk };
      if (lp.hud_select != null) polBase.hud_select = lp.hud_select;
      polBase.preset = lp.preset === 'custom' ? 'custom' : presetOf(polBase);
      candidate.loadout_policy = polBase;
    }
    this.config = candidate;
    // 🔴 The real server re-teams anyone left on a team the new mode does not have
    // (state.py `_reteam_for_config`). The demo used to skip this entirely, so `?mock` showed a KING
    // OF THE HILL roster still half YELLOW — the exact $TID 2 the server refuses (F82) and the one
    // thing this screen must never appear to allow. A demo that predicts the wrong state is worse than
    // no demo: it is where a "verified" screenshot comes from. Round-3 FIELD-1 moved both sides off
    // "everyone onto teams[0]" and onto index-mapping + rebalance; this mirrors that rule.
    this.reteamForConfig(prevTeams);
    this.applyPolicy();
    if (this.config.mode === 'ffa') { const t = this.config.teams[0]; if (t) for (const p of this.players) p.team_id = t.team_id; }
    this.cachedCompilerResult = undefined;
    const covered = this.state().coverage?.level === 'full';
    const errors = compilerValidation(this.config, this.players, WEAPONS, covered, PERKS).errors;
    // B3 (2026-09-12, coordinated with the real server's fix): editing a game that had already been
    // pushed to the guns used to un-push it SILENTLY -- `pushed` fell false and the acks were just
    // dropped, with nothing on screen saying the guns were now stale (B1's root cause: guns left
    // running the OLD config with nothing visible naming the skew). The real `state.py set_config` now
    // keeps `lobby_pushed` true and RE-PUSHES the fresh config to every bound node; shared checks live
    // in mcp/brx_mcp/mc/fake_invariants.json, with cases in test/fake-invariants.test.ts. The mock models
    // that so `?mock` cannot demo a re-edit flow the real server would not produce. Acks clear
    // IMMEDIATELY (the console's "re-pushing" moment -- `GameEditPanel`'s status line reads this same
    // `acks` object) and repopulate the way `pushLobby` does, after a short delay standing in for the
    // real node round-trip (state.py: `ack_config` lands ~1.5s after a push).
    // Round-2 fix pass (2026-09-12): the re-push used to run UNCONDITIONALLY. The server only
    // re-pushes when the fresh config VALIDATES (`state.py set_config`: `if res["ok"]` … else
    // `lobby_pushed = False; acks = {}`) — an invalid config cannot arm a gun, so the push is dropped
    // and the errors are what the operator sees. A mock that re-pushes an invalid config demos a
    // "pushed" lobby the real MC would never produce.
    // SAVE AND LOAD: an ANNOUNCED game is re-announced on every edit, so the briefing on the phones
    // never describes a game nobody is playing. Independent of the frames re-push below.
    if (this.gameLoaded && !errors.length) {
      this.gameCfg = this.config.config_id;
      this.gameSent = Object.fromEntries(this.players.filter(p => p.node_id).map(p => [p.player_id, this.config.config_id]));
    }
    if (this.pushed && errors.length) { this.pushed = false; this.acks = {}; this.echoedGuns.clear(); }
    else if (this.pushed) {
      this.acks = {}; this.echoedGuns.clear();
      const cfgId = this.config.config_id;
      setTimeout(() => {
        if (!this.pushed || this.config.config_id !== cfgId) return;   // recalled, or superseded by a newer edit
        for (const p of this.players) this.acks[p.player_id] = this.ackFor(p, cfgId);
        this.emit();
      }, this.repushAckMs);   // long enough for a real-browser poll to see the transitional "re-pushing" state
    }
    if (this.phase === 'muster') this.setPhaseField('build');   // `set_config`: every applied write moves muster -> build (rolled or not)
    // Polish round 1 H2 parity, round 2 (6): mirrors `state.py Session._sync_game_pick_from_config`
    // exactly -- called on EVERY applied `set_config`, errors or not (the mock used to skip this while
    // refused, disagreeing with the server the moment a KIT/LOBBY edit was rejected but still applied
    // to `self.config`, as an invalid one always is). `mode` is a kind BUILD can never create a piece
    // for, so the picked mode piece is always a builtin named `builtin:mode:<mode>` -- recomputed from
    // the config's own mode string directly, with no PieceStore lookup and no post_mvp exclusion (a
    // post-MVP mode still gets its own real builtin id, never falls back to another mode's).
    this.gamePick.match = {
      time_limit_s: this.config.time_limit_s ?? null,
      frag_limit: this.config.scoring.frag_limit ?? null,
      night: !!this.config.night,
      silenced: this.config.presentation?.preset === 'silenced',
      ...(this.config.teams.some(t => t.team_id !== 'ffa')
        ? { teams: this.config.teams.map(t => t.team_id as TeamColour) } : {}),
      ...(this.config.scoring.hold_target_s != null ? { hold_target_s: this.config.scoring.hold_target_s } : {}),
      ...(this.config.hill && Object.keys(this.config.hill).length ? { hill: { ...this.config.hill } } : {}),   // gamepick.match_from_config, F559
    };
    if (this.config.mode) this.gamePick.pieces.mode = `builtin:mode:${this.config.mode}`;
    this.cfgErrors = errors;
    this.cachedCompilerResult = undefined; // state.py set_config calls _validate().
    this.emit();
    return { ok: errors.length === 0, errors, config: clone(this.config) };
  }
  async addPlayer(p: { display: string; team_id?: string; gun_id?: string; voice?: string }): Promise<Player> {
    { const e = tagError(p.display); if (e) throw new Error(e); }   // F366, as state.py `_check_tag`
    const assigned = p.gun_id && this.players.find(x => (x.gun_id || '').toUpperCase() === p.gun_id!.toUpperCase());
    if (assigned) throw new Error(`gun ${p.gun_id} is already assigned to ${assigned.display}`);
    const parked = p.gun_id && this.standby.find(x => (x.gun_id || '').toUpperCase() === p.gun_id!.toUpperCase());
    if (parked) throw new Error(`gun ${p.gun_id} is on standby with ${parked.display} - PLAY puts them back`);
    const teams = this.config.teams ?? [];
    if (p.team_id != null && !teams.some(t => t.team_id === p.team_id)) throw new Error(`unknown team_id '${p.team_id}'`);
    // mirrors state.py add_player: an omitted team_id auto-balances onto the lightest declared team
    // (a bare gamertag claim from ARMORY never asks the operator to pick a side -- F-armory-claim).
    let teamId = p.team_id ?? null;
    if (teamId == null && teams.length) {
      const counts = new Map(teams.map(t => [t.team_id, 0]));
      for (const q of this.players) if (counts.has(q.team_id ?? '')) counts.set(q.team_id!, (counts.get(q.team_id!) ?? 0) + 1);
      teamId = teams.map(t => t.team_id).reduce((best, id) => (counts.get(id)! < counts.get(best)! ? id : best));
    }
    const used = new Set(this.players.map(x => x.player_num));
    let n = 1; while (used.has(n)) n++;
    // add_player adopts a connected phone that already reports this gun. GUNS index is a demo-fleet
    // shortcut; the server matches the reported gun name or tail in _find_player_for_gun.
    const gun = GUNS.find(g => g[0].toUpperCase() === p.gun_id?.toUpperCase());
    const node_id = gun && gun[2] !== 'r' && !this.evicted.has(`node_${gun[1]}`) ? `node_${gun[1]}` : null;
    const pl: Player = { player_id: uid('p'), player_num: n, display: storedTag(p.display), team_id: teamId, node_id,
      gun_id: p.gun_id ?? null, loadout: applyPolicy(this.config.loadout_policy, { weapons: [{ weapon_id: 'assault_rifle' }], perk: null }, this.pool(), WEAPONS, PERKS), voice: p.voice ?? 'male', ready: false };
    this.players.push(pl); this.cachedCompilerResult = undefined; this.emit(); return clone(pl);
  }
  async patchPlayer(id: string, patch: Partial<Player>): Promise<Player> {
    const p = this.players.find(x => x.player_id === id); if (!p) throw new Error('no such player');
    if (this.phase === 'armed' || this.phase === 'live') {
      // F172/B1: team is not display-only. The real server refuses a mid-match change because the
      // roster/scorer would move while the gun kept the old `$TID`; `?mock` must not demonstrate a
      // flow the field rejects. As on `state.py patch_player`, null means "no instruction" in play,
      // and writing the team already held is a legal no-op.
      if (patch.team_id == null) {
        const { team_id: _ignored, ...rest } = patch; void _ignored; patch = rest;
      } else if (patch.team_id !== p.team_id) {
        const msg = `the match is ${this.phase.toUpperCase()}: changing a player's TEAM now moves the beacon, LEDs and scoring but NOT the gun's $TID -- combat would still resolve on the old team and same-team shots would do no damage. RECALL to return the field to KIT, change teams there, and re-push`;
        throw Object.assign(new Error(msg), { status: 409, body: { error: msg } });
      }
    }
    if (patch.display != null) {             // F366, as state.py `_check_tag`: refused, never cut
      const e = tagError(patch.display); if (e) throw new Error(e);
      if (!storedTag(patch.display)) throw new Error('display must not be empty');
      patch = { ...patch, display: storedTag(patch.display) };
    }
    if (patch.player_num != null) {
      if (patch.player_num < 1 || patch.player_num > 63) throw new Error('player_num must be 1–63');
      if (this.players.some(x => x !== p && x.player_num === patch.player_num)) throw new Error('player_num in use');
    }
    if (patch.loadout?.perk) {
      // F551, as state.py `_check_loadout` (which runs before the pool check): a perk the push would refuse with these
      // weapons, or under this game's health preset (honest pickers: Shields refuses AP and Body Armor), is dropped,
      // not kept and not refused
      const k = PERKS.find(x => x.perk_id === patch.loadout!.perk);
      const w0 = patch.loadout.weapons?.[0]?.weapon_id, w1 = patch.loadout.weapons?.[1]?.weapon_id;
      if (k && ((w0 && (k.blocked_primary ?? []).includes(w0)) || (w1 && (k.blocked_secondary ?? []).includes(w1))
                || (k.blocked_presets ?? []).includes(healthPresetOf(this.config.health)))) {
        const { perk: _dropped, ...rest } = patch.loadout;
        patch = { ...patch, loadout: rest };
      }
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
      if (conflict(lo)) throw new Error("Easy Reload takes the ALT button, so it can't ride with a second weapon");
      const cc = chainConflict(lo, WEAPONS);   // Codex r1: MC refuses Easy Reload on a chain-reload weapon (policy.py)
      if (cc) throw new Error(`${WEAPONS.find(w => w.weapon_id === cc.weapon)?.name ?? cc.weapon} loads shell by shell — Easy Reload only taps the button once, so it can't reload it`);
    }
    Object.assign(p, patch);
    if (patch.loadout) delete this.trying[id];
    this.cachedCompilerResult = undefined; // state.py _after_player_change calls _validate().
    this.emit(); return clone(p);
  }
  async deletePlayer(id: string) { this.players = this.players.filter(p => p.player_id !== id); this.emit(); }
  async standbyPlayer(id: string): Promise<Player> {
    const p = this.players.find(x => x.player_id === id); if (!p) throw new Error('no such player');
    if (this.phase === 'armed' || this.phase === 'live') throw new Error('cannot stand a player down after the match has started');   // the pushed LOBBY is fine, as on the real server
    this.players = this.players.filter(x => x !== p);
    delete this.trying[id]; delete this.browsing[id]; delete this.acks[id];
    const parked: Player = { ...p, node_id: null, ready: false };
    this.standby.push(parked); this.emit(); return clone(parked);
  }
  async reinstatePlayer(id: string): Promise<Player> {
    const p = this.standby.find(x => x.player_id === id); if (!p) throw new Error('no such player on standby');
    if (this.phase === 'armed' || this.phase === 'live') throw new Error('cannot reinstate a player after the match has started');
    const holder = p.gun_id && this.players.find(x => x.gun_id === p.gun_id);
    if (holder) throw new Error(`gun ${p.gun_id} is now assigned to ${holder.display}`);
    this.standby = this.standby.filter(x => x !== p);
    const used = new Set(this.players.map(x => x.player_num));
    let n = p.player_num; if (used.has(n)) { n = 1; while (used.has(n)) n++; }
    // The server adopts only a connected phone whose hello reports this gun.
    const gun = GUNS.find(g => g[0].toUpperCase() === p.gun_id?.toUpperCase());
    const node_id = gun && (this.gunOverride[gun[0]] ?? gun[2]) !== 'r'
      && !this.evicted.has(`node_${gun[1]}`) ? `node_${gun[1]}` : null;
    const back: Player = { ...p, player_num: n, ready: false, node_id };
    this.players.push(back); this.cachedCompilerResult = undefined; this.emit(); return clone(back);
  }
  async evictNode(id: string) {
    this.evicted.add(id);
    if (this.nodeReports[id]) delete this.nodeReports[id].end;
    for (const p of this.players) if (p.node_id === id) {
      p.node_id = null;
      p.ready = false;
      delete this.acks[p.player_id];
    }
    this.emit();
  }
  /** T2 review S5 demo/test hook: mark a phone (by gun tail) silent, or heard again — the mock's
   *  stand-in for the `stale` flag the server's net layer raises and clears on its own. */
  setNodeStale(tail: string, stale = true) {
    this.reportNode(`node_${tail.toUpperCase()}`, now() - (stale ? STALE_AFTER_MS + 1 : 0));
    this.emit();
  }

  // ---------- A25 ----------
  async getOptions() { return { ...this.options }; }
  async setOptions(opts: { log_sync?: 'auto' | 'manual' }) {
    if (opts.log_sync && opts.log_sync !== 'auto' && opts.log_sync !== 'manual') throw new Error('log_sync must be auto|manual');
    if (opts.log_sync) this.options.log_sync = opts.log_sync;
    this.emit();
    return { ...this.options };
  }
  async pullLog(node_id: string) {
    // MC asking does not make the phone answer: the state moves to `pulling` only for a node that had
    // something to send. A node with nothing stays where it is and the ask is still reported as sent —
    // which is what `ok` means (the ASK went out), never "a log arrived".
    const cur = this.logFor(node_id);
    if (cur.state === 'offered' || cur.state === 'held') {
      this.logs[node_id] = { state: 'pulling', lines: cur.lines, bytes: cur.bytes, last_t: now() };
      this.emit();
    }
    return { ok: true, reason: null, node_id, log: this.logFor(node_id) };
  }
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
      this.tunnelStatus = 'starting'; this.tunnelProvider = 'cloudflared'; this.tunnelWasUp = false;
      this.tunnelError = undefined; this.emit();
      this.tunnelTimer = window.setTimeout(() => {
        if (this.tunnelFailNext) {
          this.tunnelFailNext = false;
          this.tunnelStatus = 'error'; this.tunnelWsUrl = null;
          this.tunnelError = 'cloudflared exited before printing a trycloudflare.com hostname (connect: network is unreachable)';
        } else {
          this.tunnelStatus = 'up';
          this.tunnelWasUp = true;
          this.tunnelWsUrl = `wss://${Math.random().toString(36).slice(2, 10)}.trycloudflare.com/ws`;
        }
        this.emit();
      }, 1000);
    } else {
      this.tunnelStatus = 'off'; this.tunnelProvider = null; this.tunnelWsUrl = null;
      this.tunnelError = undefined; this.emit();
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
    if (this.phase === 'kit' && this.players.length && this.players.every(x => x.ready)) this.setPhaseField('lobby');
    this.emit(); return clone(p);
  }
  /** Bench 2026-09-17: MARK ALL READY -- the roster-wide `host_override`, mirroring `state.py
   *  ready_all()`. LOBBY only, `this.players` alone (STANDBY lives in `this.standby`, untouched),
   *  and never touches acks or the config head. */
  async readyAll() {
    if (this.phase !== 'lobby') throw new Error(`mark all ready needs the lobby, and MC is at ${String(this.phase).toUpperCase()}: ${this.phase === 'recap' ? 'press NEXT MATCH first' : 'load a game and send it to the phones first'}`);   // mirrors state.py
    const readied: string[] = [];
    for (const p of this.players) {
      if (!p.ready) { p.ready = true; delete this.trying[p.player_id]; delete this.browsing[p.player_id]; readied.push(p.player_id); }
    }
    this.emit();
    return { ok: true, readied };
  }
  /** F402 (2026-09-25): mirrors `state.py Session._koth_hill_fault` -- "no way to play it without
   *  it". A koth LOAD/push is refused with nothing on the field that IS the hill, `force` does not
   *  open it either, and this is checked fresh (never cached), the same as the server. */
  private kothHillFault(): string | null {
    if (this.config.mode !== 'koth') return null;
    if (this.config.station_source !== 'phone') {
      return 'KING OF THE HILL NEEDS A HILL: SET OBJECTIVE SOURCE TO PHONE, THEN ASSIGN A PHONE OR STICK AS A HILL IN THE ARMORY';
    }
    if (Object.values(this.stations).some(s => s.assigned?.kind === 'control')) return null;
    // bench 2026-10-02: a hill that left is named, as state.py `_koth_hill_fault`
    const gone = this.departureViews().filter(d => d.kind === 'control').map(d => d.line);
    if (gone.length) return `KING OF THE HILL NEEDS A HILL: ${gone.join('; ')}`;
    return 'KING OF THE HILL NEEDS A HILL: ASSIGN A PHONE OR STICK AS A HILL IN THE ARMORY';
  }

  /** LOAD: announce the game, write no gun (`state.py load_game`). `pushed` stays FALSE. */
  async loadGame() {
    if (this.phase === 'armed' || this.phase === 'live') {
      throw new Error('cannot load a game once the match has started - ABORT or RECALL first');
    }
    const hillFault = this.kothHillFault();
    if (hillFault) throw new Error(hillFault);
    await this.rollFromRecap();          // a LOAD after the whistle loads the NEXT match
    const cfg = this.config.config_id;
    this.gameLoaded = true;
    this.gameCfg = cfg;
    // DELIVERY: only a player whose phone is actually connected is counted. The demo ships one
    // player whose phone has never arrived, so this is never a full house by accident.
    this.gameSent = Object.fromEntries(this.players.filter(p => p.node_id).map(p => [p.player_id, cfg]));
    if (this.phase === 'muster') this.setPhaseField('build');
    this.emit();
    return { ok: true, config_id: cfg, sent: sessionGameSentN(this.players, this.gameSent, this.gameCfg), total: this.players.length };
  }

  /** `state.py _roll_forward_from_recap` — in RECAP only: roster and game kept, back to muster. */
  private async rollFromRecap() {
    if (this.phase !== 'recap') return false;
    await this.newSession(true);
    return true;
  }
  /** `state.py next_match` — RECAP's NEXT MATCH ▸: roll, then LOAD the same game (lands on GAMES). */
  async nextMatch() {
    if (this.phase === 'armed' || this.phase === 'live') {
      throw Object.assign(new Error(`the match is ${this.phase.toUpperCase()} — END it before starting the next one`), { status: 409 });
    }
    await this.rollFromRecap();
    await this.loadGame();
    return this.state();
  }

  /** `state.py sync_summary()` — the four pre-arm facts per player, with honest denominators. */
  private syncSummary() {
    const cur = this.config.config_id;
    const rows = this.players.map(p => ({
      player_id: p.player_id, display: p.display, gun_id: p.gun_id ?? '', player_num: p.player_num,
      bound: !!p.node_id,
      phone_game: !!this.gameCfg && this.gameSent[p.player_id] === this.gameCfg,
      // the mock has no compiled bundles; a real push is what configures a gun, and its ack is the
      // proof of it, so both halves are read off the same push the demo models.
      gun_sent: this.pushed,
      gun_acked: this.pushed && !!(this.acks[p.player_id]?.ok) && this.acks[p.player_id]?.config_id === cur,
      // `state.py _sync_ack_state`. The mock acks at the push itself, so `waiting` only shows for a
      // bound phone with no ack yet; there is no timeout to model.
      ack_state: (!this.pushed ? 'none'
        : this.acks[p.player_id]?.ok && this.acks[p.player_id]?.config_id === cur ? 'acked'
        : !p.node_id || this.acks[p.player_id]?.config_id === cur ? 'failed'
        : 'waiting') as 'acked' | 'waiting' | 'failed' | 'none',
      // mirrors `state.py _echo_state`: NULL when there is no check to report at all (nothing pushed,
      // or no ack for THIS config). A demo that reported `not_echoed` there would be inventing a
      // check that never ran, which is what the console must never render.
      gun_echo: (!this.pushed || !(this.acks[p.player_id]?.ok && this.acks[p.player_id]?.config_id === cur)
        ? null
        : (this.acks[p.player_id]?.gun_echo ? 'proven' : 'not_echoed')) as 'proven' | 'mismatch' | 'not_echoed' | null,
    })).sort((a, b) => a.player_num - b.player_num);
    const n = rows.length;
    const totals = {
      rostered: n,
      phone_game: rows.filter(r => r.phone_game).length,
      gun_sent: rows.filter(r => r.gun_sent).length,
      gun_acked: rows.filter(r => r.gun_acked).length,
      gun_echo_proven: rows.filter(r => r.gun_echo === 'proven').length,
      // a zero-of-zero is never in sync
      in_sync: n > 0 && rows.every(r => r.gun_sent && r.gun_acked),
    };
    return { rows, totals, unconfigured: rows.filter(r => !r.gun_acked).map(r => r.display) };
  }

  async pushLobby(force?: boolean) {
    const hillFault = this.kothHillFault();     // F402: not a readiness judgement either; force does not open it
    if (hillFault) throw new Error(hillFault);
    await this.rollFromRecap();          // a push after the whistle is for the NEXT match
    const rf = this.rosterFault();
    if (rf) throw new Error(rf);          // round-2 B: not a readiness judgement, so `force` does not open it
    const validation = compilerValidation(this.config, this.players, WEAPONS,
      this.state().coverage?.level === 'full', PERKS);
    if (validation.errors.length) throw new Error(validation.errors.join('; '));
    // A37/F271: the four red proofs SAY "RE-PUSH" and are cured by this very call, so they do not
    // refuse it (`state.py push_config`). Every other red still does. F3: a `waiting` row — a phone
    // that has not arrived — refuses the FIRST push only; a re-push is handed over on that phone's
    // hello (`state.py push_config.is_repush`).
    const blocking = this.readiness().board.filter(r =>
      (r.status === 'waiting' && !this.pushed) || (r.status === 'red' && (r.blockers ?? []).some(b => !curedByPush(b))));
    if (blocking.length && !force) {
      // R2-10: the server names what blocks, never an empty list after the colon.
      const waiting = blocking.filter(r => r.status === 'waiting').map(r => r.sticker);
      const reds = blocking.filter(r => r.status === 'red')
        .map(r => `${r.player_num}:${(r.blockers ?? []).filter(b => !curedByPush(b)).join('/')}`);
      const parts = [waiting.length ? `${waiting.length} phone(s) not arrived: ${waiting.join(', ')}` : '',
                     reds.length ? `red: ${reds.join('; ')}` : ''].filter(Boolean);
      throw new Error(`readiness blocks the push — clear it before pushing, or push with force: ${parts.join(' · ')}`);
    }
    // R2-1: a push onto an ALREADY-PUSHED lobby is a RE-PUSH, and the game number does not move
    // (nobody has started a game on it). The server says which one it did so the console can label
    // the action; the mock has to predict that or `?mock` demos a flow the real server would not
    // produce.
    const repushed = this.pushed;
    // F6 (iteration 3): a re-push MINTS A FRESH `config_id`, exactly as the server does. Holding the
    // id constant made the re-push unprovable — an ack already on the wire when the acks were cleared
    // landed afterwards carrying the same id and counted as current.
    if (repushed) this.config = { ...this.config, config_id: uid('cfg') };
    // The number still moves only on the first push AFTER a match started (`Session._next_game_no`,
    // gated on `_game_no_started`). The two signals cannot disagree on a real server: `_finish()`
    // drops `lobby_pushed`, and a push while the match is still armed/live is refused outright.
    // F535: also past a byte a hill was armed on, in a mode with no hill (`hill_may_advertise_on`), push or re-push alike
    const hillOnByte = !OBJECTIVE_MODES.includes(this.config.mode) && this.hillBytes.has(this.gameNo);
    if (this.gameStarted || hillOnByte) {
      this.gameNo = (this.gameNo % 255) + 1; this.gameStarted = false;
      // step past every remembered hill byte, as `Session._bump_game_no` (bounded: only 255 bytes exist)
      for (let i = 0; i < 254 && !OBJECTIVE_MODES.includes(this.config.mode) && this.hillBytes.has(this.gameNo); i++) this.gameNo = (this.gameNo % 255) + 1;
    }
    // …and the demo faults are cured by the cure. `noecho` is NOT: it is the v4.32 firmware not
    // echoing its weapon, and no number of pushes changes that (webapp/mc/README.md → demo switches).
    if (repushed) this.demoCured = true;
    for (const n of Object.keys(this.stations)) this.armStation(n);
    this.setPhaseField('lobby'); this.pushed = true; this.trying = {}; this.acks = {}; this.echoedGuns.clear();
    this.cachedCompilerResult = undefined; // state.py push_config validates before sending.
    // ...and only a phone that is ON THE NET answers one: `_push_config_to` compiles for every player
    // and sends to those with a socket, so a player whose phone has not arrived has a bundle and no ack.
    for (const p of this.players) {
      const gun = GUNS.find(g => g[0] === p.gun_id);
      if (p.node_id && !this.evicted.has(p.node_id) &&
          (gun?.[2] !== 'r' || this.gunOverride[gun[0]] === 'g')) {
        this.acks[p.player_id] = this.ackFor(p, this.config.config_id);
      }
    }
    this.emit(); return { ok: true, acks: clone(this.acks), repushed, config_id: this.config.config_id };
  }
  private schedule(runway_s: number, seq: number, match_id: string) {
    const go_live_t = now() + runway_s * 1000;
    const per_node: StartView['per_node'] = {};
    for (const report of Object.values(this.nodeReports)) {
      delete report.protect_owed;
      delete report.end; // state.py Session._schedule(): the last match's delivery is no claim for this match.
      delete report.pending;
    }
    this.scorerFlushed.clear();
    this.endDeliveryTold = undefined;
    this.feed_ = [];
    for (const p of this.players.filter(p => p.node_id)) {
      this.reportNode(p.node_id!);
      per_node[p.player_id] = { arm_state: 'armed', t_minus_ms: runway_s * 1000, synced: true,
        last_seen_ms: this.nodeAge(p.node_id) ?? now() };
    }
    this.start_ = { match_id, go_live_t, config_id: this.config.config_id, seq, countdown_s: runway_s, per_node };
    this.demoQuietNodeId = undefined;
    this.demoQuietUntil = undefined;
    this.setPhaseField('armed'); this.emit();
    return { match_id, go_live_t, seq };
  }
  async start(runway_s: number, _force?: boolean) {
    if (!this.pushed) throw new Error('push config first');
    const rf = this.rosterFault();
    if (rf) throw new Error(rf);          // a team can empty out between the push and the whistle
    const stale = this.players.filter(p => {
      const a = this.acks[p.player_id];
      return a?.ok && a.gun_echo && a.config_id && a.config_id !== this.config.config_id;
    });
    if (stale.length) throw new Error(`${stale.length} gun(s) last answered an OLDER config`);
    this.gameStarted = true;
    // F411 LAST MATCH (games-presets.md §2): captured when a match STARTs, `countdown_s` from this
    // request. Survives an MC restart and a new session — a small session-store key, not a preset.
    this.lastMatch = { ...this.gamePick.match, countdown_s: runway_s };
    return this.schedule(runway_s, 1, uid('match'));
  }
  async reschedule(runway_s: number) { return this.schedule(runway_s, (this.start_?.seq ?? 0) + 1, uid('match')); }
  async abort() {
    const reached = this.players.filter(p => p.node_id && (this.nodeAge(p.node_id) ?? Infinity) <= STALE_AFTER_MS).map(p => p.player_id);
    const unreachable = this.players.map(p => p.player_id).filter(id => !reached.includes(id));
    this.recordRetired(this.start_?.match_id);
    this.start_ = undefined; this.setPhaseField('lobby'); this.emit();
    return { ok: true, reached, unreachable };
  }
  async control(cmd: 'end' | 'recall' | 'panic', confirm?: boolean) {
    if (cmd === 'panic' && !confirm) throw new Error('panic requires confirm');
    const nodes = this.players.filter(p => p.node_id).length;
    const pushed = this.players.filter(p => p.node_id && this.nodeConnected(p.node_id)).length;
    // `?mock` must never look more permissive than a real MC (the rule at `putStation` above; here it
    // is `state.py` `control`). An END with no scorer — or a second END once the recap is written —
    // ends NOTHING and moves NO phase, and says so in `error`. This used to fall through to the
    // recall branch: the demo answered a bare `{ok:true}` and quietly reset the session, which is the
    // exact defect the server fixed. The press IS still forwarded, so `pushed` is non-zero while
    // `reached` is 0 and `ended` is false.
    if (cmd === 'end' && this.phase === 'recap') {
      const match_id = this.history_[0]?.match_id;
      if (match_id) this.armEndDelivery(match_id, now());
      for (const player of this.players) {
        if (!player.node_id) continue;
        const report = this.nodeReports[player.node_id];
        if (report?.end && match_id) report.end = sessionEndDeliveryTried(report.end, match_id, now(), this.nodeConnected(player.node_id));
      }
      this.feed({ t_match_s: 0, kind: 'alert', tag: 'WITHHELD',
        text: `END AGAIN: the match already ended and the recap stands. ${pushed} node(s) were told to stop again` });
      this.emit();
      return { ok: false, ended: false, reached: 0, pushed, nodes, phase: this.phase,
        error: 'this match has already ended — the recap stands (RECALL returns the field to KIT)' };
    }
    if (cmd === 'end' && !this.live_ && !(this.phase === 'armed' && this.start_)) {
      this.feed({ t_match_s: 0, kind: 'alert', tag: 'WITHHELD',
        text: `END DID NOTHING: no match is being scored (phase ${this.phase.toUpperCase()}). ${pushed} node(s) were told to stop; RECALL returns the field to KIT` });
      this.emit();
      return { ok: false, ended: false, reached: 0, pushed, nodes, phase: this.phase,
               error: 'no match is being scored — nothing to end (RECALL returns the field to KIT)' };
    }
    if (cmd === 'end') {
      this.endMatch('host');
      const reached = this.players.filter(p => p.node_id && this.nodeConnected(p.node_id)).length;
      return { ok: true, ended: true, reached, pushed: reached, nodes, phase: this.phase };
    }
    // recall/panic stop a live game -> KITTED (A5.9), the same landing `state.py` gives them. The
    // mock used to go back to LOBBY whenever a config head had been pushed, so a recall in `?mock`
    // ended somewhere a recall on a real MC never does.
    this.recordRetired(this.start_?.match_id ?? this.live_?.match_id);
    this.start_ = undefined; this.live_ = undefined; this.setPhaseField('kit'); this.pushed = false; this.acks = {}; this.echoedGuns.clear(); this.endedAt = undefined;
    this.emit();
    return { ok: true, ended: true, reached: nodes, pushed: nodes, nodes, phase: this.phase };
  }
  /** (player_id, cmd) -> ms of the last accepted send: `state.py OPERATOR_REPEAT_MS`, the double-tap guard. */
  private opSent: Record<string, number> = {};
  /** A47: `state.py operator_action`, with the same refusals, so `?mock` is never more permissive than MC.
   *  The demo phone answers with an `operator_result` a moment later (`_on_operator_result`). */
  async operatorAction(player_id: string, cmd: OperatorCmd, match_id: string): Promise<OperatorActionResult> {
    const refuse = (msg: string, status = 409) => { throw Object.assign(new Error(msg), { status, body: { error: msg } }); };
    if (!['resync', 'respawn', 'relink'].includes(cmd)) refuse(`unknown operator action '${cmd}'`, 400);
    const current = this.live_?.match_id ?? this.start_?.match_id;
    if (!['armed', 'live'].includes(this.phase) || !current) refuse(`no match is ARMED or LIVE (phase ${this.phase.toUpperCase()})`);
    if (!match_id || match_id !== current) refuse('that match is over: the board was stale. Look at the player again');
    const word = cmd.toUpperCase();
    if (cmd !== 'relink' && this.phase !== 'live') refuse(`${word} NEEDS A LIVE MATCH: the phone refuses it before T-0`);
    const p = this.players.find(x => x.player_id === player_id);
    if (!p) return refuse('unknown player', 400);
    const who = p.display.toUpperCase();
    const row = this.live_?.rows.find(r => r.player_id === player_id);
    if (cmd === 'respawn' && this.config.respawn.type === 'none' && row?.status === 'down') {
      refuse(`${who} IS OUT: THIS MODE HAS NO RESPAWN, SO FORCE RESPAWN WOULD CHANGE WHO SURVIVES`);
    }
    if (!p.node_id || (row && row.status === 'stale')) refuse(`${who}'S PHONE IS OUT OF REACH: nothing was sent`);
    const key = `${player_id}|${cmd}`, t = now();
    if (this.opSent[key] != null && t - this.opSent[key] < 2000) refuse(`${word} WAS JUST SENT TO ${who}: wait for the phone`);
    this.opSent[key] = t;
    const tm = () => (this.live_ ? Math.max(0, Math.floor((now() - this.live_.go_live_t) / 1000)) : 0);
    if (row) row.operator = { cmd, state: 'sent', why: null, sent_t: t, result_t: null };
    this.feed({ t_match_s: tm(), kind: 'alert', tag: 'OPERATOR', text: `SENT ${word} TO ${who}` });
    this.emit();
    setTimeout(() => {
      const r = this.live_?.rows.find(x => x.player_id === player_id);
      if (!r || this.live_?.match_id !== match_id || r.operator?.sent_t !== t) return;
      if (cmd === 'respawn') { r.status = 'alive'; r.respawn_in_s = null; delete r.possibly_protected; }
      r.operator = { cmd, state: 'done', why: null, sent_t: t, result_t: now() };
      this.feed({ t_match_s: tm(), kind: 'alert', tag: 'OPERATOR',
                  text: cmd === 'respawn' ? `RESPAWNED ${who} (OPERATOR)` : `${word} DONE: ${who}` });
      this.emit();
    }, 1200);
    return { ok: true, cmd, player_id, match_id, pushed: true };
  }
  async resumeOrphan(match_id: string) {
    if (!this.orphan_ || this.orphan_.match_id !== match_id) {
      throw Object.assign(new Error('no phone reports that match any more'), { status: 409 });
    }
    if (!['muster', 'build', 'kit', 'lobby'].includes(this.phase) || this.start_) {
      throw Object.assign(new Error(`MC is in ${this.phase.toUpperCase()}: end or leave that first, then resume their match`), { status: 409 });
    }
    this.orphan_ = null;
    this.schedule(0, 1, match_id);
    this.goLive();
    this.emit();
    return this.state();
  }
  async endOrphan(match_id: string) {
    if (!this.orphan_ || this.orphan_.match_id !== match_id) {
      throw Object.assign(new Error('no phone reports that match any more'), { status: 409 });
    }
    this.orphan_ = null;
    this.emit();
    return this.state();
  }
  async matchHistory() { return clone(this.history_); }
  async getRecap() { const recap = this.recapView(); if (!recap) throw new Error('no recap yet'); return recap; }
  recapCsvUrl() { return this.csvOf(this.recap_); }
  matchCsvUrl(match_id: string) { return this.csvOf(this.history_.find(h => h.match_id === match_id)?.recap ?? undefined); }
  private csvOf(r?: RecapView) {
    if (!r) return '#';
    const lines = ['operator,team,kills,deaths,assists,kd,accuracy,streak,medals',
      ...r.rows.map(x => [x.display, x.team_id ?? '', x.kills, x.deaths, x.assists, x.kd, x.accuracy ?? '', x.streak, x.medals.join(' · ')].join(','))];
    return 'data:text/csv;charset=utf-8,' + encodeURIComponent(lines.join('\n'));
  }
  async newSession(keep_roster: boolean) {
    const rolling = keep_roster && this.phase === 'recap';
    if (this.phase === 'armed' || this.phase === 'live') this.recordRetired(this.start_?.match_id ?? this.live_?.match_id);
    this.setPhaseField('muster'); this.pushed = false; this.acks = {}; this.echoedGuns.clear(); this.start_ = undefined; this.live_ = undefined; this.recap_ = undefined; this.endedAt = undefined; this.syncBase = [];
    if (!rolling) for (const report of Object.values(this.nodeReports)) delete report.end;
    if (!rolling) this.endDeliveryTold = undefined;
    if (!rolling) this.staleTold.clear();
    this.feed_ = [];
    this.scorerFlushed.clear();
    this.demoQuietNodeId = undefined;
    this.demoQuietUntil = undefined;
    this.gameLoaded = false; this.gameCfg = null; this.gameSent = {};
    this.session_id = uid('sess');
    this.restoredFrom = null;   // F142: NEW SESSION, CLEAR ROSTER is the acknowledgment — a restored banner never lingers
    if (!keep_roster) { this.players = []; this.departures = {}; } else for (const p of this.players) p.ready = false;   // NEXT MATCH keeps departures
    this.emit(); return this.state();
  }
  /** "Report a problem" — mirrors `POST /api/report` (mcp/brx_mcp/mc/routes/reports.py, Lane A) closely enough
   *  that `?mock` proves the whole panel: a short delay (the real route zips real evidence and can
   *  take a few seconds), a `download` the panel can actually fetch (a `data:` URL, same trick as
   *  `csvOf` above — no server exists under `?mock` to serve a real file from), and a real GitHub
   *  "new issue" link for the shipped repo. */
  async makeReport(): Promise<ReportResult> {
    await new Promise(r => setTimeout(r, 900));
    const st = this.state();
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
    const file = `mc-report-${stamp}.zip`;
    const summary = {
      session_id: this.session_id, phase: this.phase, mode: this.config.mode,
      players: st.players.length, nodes: st.nodes.length, generated_t: now(),
    };
    const removed = { names: st.players.length, tagger_ids: st.nodes.length, ip_addresses: 1, access_code: 1 };
    // Not a real zip — `?mock` has no server to build one from — but a real file a browser will save.
    // `encodeURIComponent`, not `btoa`: `csvOf` above already learned this — `btoa` throws on any
    // codepoint past Latin1, and a real browser enforces that where jsdom's stand-in does not, so a
    // fixture-driven test cannot catch it (found only by actually clicking DOWNLOAD in Chromium).
    const download = 'data:application/zip;charset=utf-8,' + encodeURIComponent(`MOCK REPORT (?mock): ${JSON.stringify(summary)}`);
    const title = encodeURIComponent('Mission Control bug report');
    const body = encodeURIComponent('Describe what went wrong, and what you expected instead.\n\n'
      + 'Drag the downloaded report file into this issue — GitHub issues are public, so open it and check it first.');
    const issue_url = `https://github.com/tony99nyr/open-brx/issues/new?title=${title}&body=${body}`;
    return { file, download, issue_url, summary, removed, too_large: false };
  }
  dispose() { if (this.timer) window.clearInterval(this.timer); if (this.tunnelTimer) window.clearTimeout(this.tunnelTimer); }
}
