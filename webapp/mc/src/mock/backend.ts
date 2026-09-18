// In-browser mock of the MC server (mcp/brx_mcp/mc/API.md). Stateful enough for every UI interaction.
import type {
  Api, ConfigView, Coverage, FeedEntry, GameConfig, LanPublic, LiveRow, Loadout, LoadoutPolicy, LogView, MatchHistoryRow, ModeInfo, NodeView, OperatorActionResult, OperatorCmd, PerkView, Phase, Player,
  ReadinessRow, ReadinessSnapshot, RecapStationRow, RecapView, ReportResult, SavedGame, ScanRow, ScoreRow, StartView, State, StationAssignment, StationKind, StationSourceId,
  StationView, TunnelProvider, TunnelStatus, WeaponView,
} from '../api/types';
import { STATION_KINDS, STATION_SOURCE_IDS } from '../api/types';
import { withPolicy } from '../screens/gameSummary';
import { GUN_FLAPPING_LINE } from '../api/derive';
import { GUNS, LIVE, MODES, PERKS, PLAYERS, READY, RECAP, TEAMS, WEAPONS } from './data';
import { PRESETS, apply as applyPolicy, conflict, defaultPolicy, pool as poolOf, presetOf, reject } from './policy';

const now = () => Date.now();
// loadout.md §8 — the shipped example so the SAVED GAMES shelf is never empty on first use
const BUILTIN_SNIPER = (): SavedGame => {
  const ffa: ConfigView = withPolicy(clone(MODES.find(m => m.mode === 'ffa')!.defaults));
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
  // S50 (2026-09-17): Easy Reload moved from the perk slot to the per-player accessibility override
  // (docs/spec/loadout.md §2) — it is no longer a `perk` id, so the demo kit shows the override shape.
  () => ({ weapons: [{ weapon_id: 'assault_rifle' }], perk: null, overrides: { easy_reload: true } }),
];
// The server's `SETUP: ` warnings, one per objective source (compile.py validate). The demo carries both
// so the LOBBY / ARMED strip and the GAMES rail show in `?mock` exactly what a real MC sends — including
// that an `ir_station` game is NOT silent about being a source we have never had on a bench.
const SETUP_WARNING: Record<string, string> = {
  grenade: 'SETUP: POWER-CYCLE THE GRENADE SO IT STARTS NEUTRAL, SET IT TO HILL MODE, AND PLACE IT — a hill that starts already owned skews the whole match, and only a power cycle guarantees neutral. ONE POINT ONLY (F88: a beacon carries no station id)',
  ir_station: 'SETUP: PLACE AND POWER THE IR STATION, AND CHECK IT READS NEUTRAL BEFORE THE WHISTLE — ⚠ UNPROVEN: we have never had one on the bench, so nothing confirms it speaks the protocol our nodes read. Run the grenade if you want a hill we have measured',
  phone: 'SETUP: THE CONTROL POINT IS A PHONE — open the app in the UTILITY role, kind CONTROL, confirm it shows MC-ARMED for THIS game (arming resets the point; do NOT power-cycle it), leave the screen awake on the point, and check its battery. Players must be advertising (the HUD does this) or the point counts nobody',
};
// The refusal wording, mirroring `STATION_SOURCES` in mcp/brx_mcp/mc/types.py. The IDS are not mirrored:
// they come from the generated `STATION_SOURCE_IDS`, and the map is keyed by `StationSourceId`, so a source
// added on the server fails this file's compile instead of quietly going missing from the demo's refusal.
const MOCK_SOURCE_DESC: Record<StationSourceId, string> = {
  grenade: 'a BRX Smart Grenade in hill mode (protocol-15 beacons; bench-proven 2026-09-10)',
  ir_station: 'a BRX station / Utility Box emitting $CAPTURE objective events (unproven on our bench)',
  phone: 'a spare phone in the utility role as a BLE control point, capture by presence (spec/utility.md §5d)',
};
const MOCK_STATION_SOURCES = STATION_SOURCE_IDS.map(value => ({ value, desc: MOCK_SOURCE_DESC[value] }));
const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

// ---- `?mock&faults=1`: A36/A37's four config-proof states, one gun each ---------------------
// The strings are the SERVER'S, verbatim (`state.py` `_STALE_ACK_FAULT` / `_ECHO_FAULT` /
// `_POOL_FAULT`) — a demo that paraphrases them is demoing a screen the field will never show.
// Four guns that are otherwise GREEN, so each state is the only thing wrong with its row.
const DEMO_FAULT_GUN: Record<string, 'stale' | 'echo' | 'pool' | 'noecho'> = {
  'GUN-A': 'stale', 'GUN-B': 'echo', 'GUN-C': 'pool', 'GUN-E': 'noecho',
};
const DEMO_OLD_CFG = '9f2a1c04';
const DEMO_STALE_LINE = `ACKED AN OLDER CONFIG (${DEMO_OLD_CFG}) — RE-PUSH`;
const DEMO_ECHO_LINE = 'GUN ECHO ≠ CONFIG (WEAPON 31/192 echoed vs 32/192 expected, mag/reserve) — RE-PUSH';
const DEMO_POOL_LINE = 'GUN POOL ≠ CONFIG (REPORTS 45/115, THIS CONFIG GRANTS 45/70, hp/armor) — LIKELY ON AN OLDER HEAD; RE-PUSH';
/** A37: the three blockers a re-push CURES — `state.py PUSH_CURES`. They do not refuse the push. */
const PUSH_CURES = ['ACKED AN OLDER CONFIG', 'GUN ECHO ≠ CONFIG', 'GUN POOL ≠ CONFIG'];
const curedByPush = (b: string) => PUSH_CURES.some(p => b.startsWith(p));

type Sub = { snap: (s: State) => void; feed: (e: FeedEntry) => void };

export class MockBackend implements Api {
  private subs = new Set<Sub>();
  private phase: Phase = 'muster';
  private config: ConfigView = withPolicy(clone(MODES[0].defaults));
  private players: Player[] = [];
  private trying: Record<string, string> = {};
  private standby: Player[] = [];   // STANDBY: parked players (never counted in kit/lobby/readiness)
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
  /** The demo's config-proof fault for this gun, or undefined — only under `?mock&faults=1`.
   *
   *  R2-1: STICKY UNTIL THE FIRST RE-PUSH. The point of the switch is to be able to LOOK at the four
   *  states, so they survive the initial push — but a re-push is their cure on a real server, and a
   *  demo whose faults outlived it would be demoing a button that does nothing. `noecho` is exempt:
   *  it is the v4.32 firmware declining to echo its weapon, which no push can change. */
  private faultOf(gun_id?: string | null) {
    const f = this.demoFaults && gun_id ? DEMO_FAULT_GUN[gun_id] : undefined;
    return this.demoCured && f !== 'noecho' ? undefined : f;
  }
  private demoCured = false;

  /** The `ack_config` this player's phone answers a push with — ONE place, so the initial push and
   *  the A35 re-push after a config edit cannot drift apart (and so the `?mock&faults=1` states are
   *  produced by the same code path a clean demo uses). */
  private ackFor(p: Player, cfgId: string): State['lobby']['acks'][string] {
    const g = GUNS.find(x => x[0] === p.gun_id);
    if (g?.[2] === 'r' && this.gunOverride[g[0]] !== 'g') return { ok: false, err: 'no_echo' };
    switch (this.faultOf(p.gun_id)) {
      // The gun answered — for the game BEFORE this one. `ok: true`, which is exactly why truthiness
      // alone missed it on the field (A36).
      case 'stale': return { ok: true, gun_echo: '$ALCD,32,100,0,192,0,*', config_id: DEMO_OLD_CFG };
      // Answered this head, with LAST game's magazine.
      case 'echo': return { ok: true, gun_echo: '$ALCD,31,100,0,192,0,*', config_id: cfgId };
      // Answered with `$START`'s `$LCD` and nothing else — the NORMAL answer on v4.32 firmware, and
      // the reason the echo check has a third state at all (A37).
      case 'noecho': return { ok: true, gun_echo: '$LCD,0,0,0,0,0,0,*', config_id: cfgId };
      default: return { ok: true, gun_echo: '$ALCD,32,100,0,192,0,*', config_id: cfgId };
    }
  }

  /** `state.py all_acked()`: every rostered player with a node bound has answered for THIS config. */
  private allAcked() {
    return this.players.length > 0 && this.players.filter(p => p.node_id).every(p => {
      const a = this.acks[p.player_id];
      return !!a && a.ok && a.config_id === this.config.config_id;
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
  /** A41: mirrors `state.py release_station` — best-effort, `ok` only says a socket took the push
   *  (`st.offline` is the mock's stand-in for "no live socket"), and nothing else about the station
   *  changes (no un-assign, no re-arm). */
  async releaseStation(node_id: string): Promise<{ ok: boolean }> {
    const st = this.stations[node_id]; if (!st) throw Object.assign(new Error('no such station'), { status: 404 });
    return { ok: !st.offline };
  }
  private pushed = false;
  // LOAD (2026-09-13): the GAME has been announced to the phones. Deliberately SEPARATE from
  // `pushed`, which means "the guns have a head" -- Tony: "weapons have to go with the arm". The
  // demo has to predict that split or `?mock` shows a console the real server cannot produce.
  private gameLoaded = false;
  private gameSent: Record<string, string> = {};   // player_id -> config_id a socket accepted
  private acks: State['lobby']['acks'] = {};
  private start_?: State['start'];
  // A25: the session option table and the per-node log state, mirrored so `?mock` shows the LOG SYNC
  // switch and the LOGS button doing something. The demo field is deliberately MIXED — one phone
  // holding with a reason, one mid-upload, one delivered — because a board where every row says the
  // same thing proves nothing about the states the operator has to tell apart.
  private options: { log_sync: 'auto' | 'manual' } = { log_sync: 'auto' };
  private logs: Record<string, LogView> = {};
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
  // Mock-only debug hook: `?mock&allgreen=1` turns every linked row green, so ARMORY's HARDWARE READY ▸
  // and ENABLE BACKHAUL (bench 2026-09-17) can be seen in a browser. The default demo keeps a red gun.
  private demoAllGreen = typeof location !== 'undefined' && new URLSearchParams(location.search).get('allgreen') === '1';
  private tunnelFailNext = typeof location !== 'undefined' && new URLSearchParams(location.search).get('tunnelfail') === '1';
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
  private demoLanWarning = typeof location !== 'undefined' && new URLSearchParams(location.search).get('lanwarn') === '1';
  /** `?mock&restored=1` — a `--demo` (or any prior) session persisted and was silently restored: two
   *  ghost players with no phone ever bound sit on the roster from the first snapshot. */
  private demoRestored = typeof location !== 'undefined' && new URLSearchParams(location.search).get('restored') === '1';
  // The delay before the mock re-acks a re-pushed config (see `putConfig`). A test can make it longer,
  // so that a slow machine still reads the transitional "re-pushing" state before the acks return.
  // `?repushack=<ms>` sets it in the browser; a unit test sets the field directly.
  repushAckMs = (typeof location !== 'undefined' && Number(new URLSearchParams(location.search).get('repushack'))) || 220;
  /** `?mock&faults=1` — A36/A37's four config-proof states, on four otherwise-green guns, so every
   *  one of them can be looked at without a field and a stale gun. Until this existed the mock always
   *  acked with the config it had just pushed, which meant `?mock` could demo exactly none of them
   *  and the console's rendering of all four was unverifiable by eye. STICKY: the faults survive a
   *  re-push (the point is to look at them), so this is a demo switch, not a scripted failure. */
  private demoFaults = typeof location !== 'undefined' && ['1', 'stale', 'on'].includes(new URLSearchParams(location.search).get('faults') ?? '');
  /** T2 review S5: the phones this demo treats as having GONE SILENT, keyed by gun tail. `state.py`
   *  raises `stale` on a node nothing has been heard from in STALE_AFTER_MS (8 s) and clears it on the
   *  next heartbeat; `unrostered_phone_count()` skips a stale node, because a phone that said hello
   *  wearing a gun and then walked off the field must stop propping up "N CONNECTED PHONES NOT IN THE
   *  ROSTER" with nothing claimable behind it on ARMORY. The mock had no stale node of any kind, so
   *  `?mock` could not predict that rule at all. */
  private staleNodes = new Set<string>();
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

  constructor() {
    this.players = PLAYERS.map(([display, team_id, gi], i) => ({
      player_id: `p${i + 1}`, player_num: i + 1, display, team_id, node_id: `node_${GUNS[gi][1]}`,
      gun_id: GUNS[gi][0], loadout: DEMO_LOADOUTS[i % DEMO_LOADOUTS.length](),
      voice: 'male', ready: READY[display] ?? false,
    }));
    this.trying = { p4: 'smg' };
    this.browsing = { p6: now() };   // SABLE is browsing on the phone
    // F155 pass 1 (2026-09-12): GUN-F reported backhaul EARLIER this session, then dropped — `lastReach`
    // is what `readiness()` reads for the row's own `last_reach` (below), so it must be seeded before
    // the override forces the row red, or the row would show no history at all (this is what made the
    // earlier version of this demo bolt on a second, disconnected NodeView instead — the actual source
    // of the "NEVER THIS SESSION" + "NOT REACHED FOR" contradiction pass 1 caught).
    if (this.demoLastStale) { this.lastReach['A0B3'] = 'backhaul'; this.gunOverride['GUN-F'] = 'r'; }
    // F3 (iteration 3): under `?mock&faults=1` the one row NO push can cure is a phone that has not
    // arrived, not a gun nobody switched on. That is what makes the RE-PUSH's two labels visible: the
    // FIRST push is refused unforced (nothing reaches a phone that is not here), and the RE-push is
    // ORDINARY — the head is handed over on that phone's hello — so the button reads plain
    // `RE-PUSH CONFIG ▸` rather than the forcing `OVER 1 BLOCKED` variant.
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
      this.staleNodes.add('C3E5');   // GUN-H's phone: it said hello earlier, and has been silent since
    }
    this.timer = window.setInterval(() => this.tick(), 1000);
  }

  // ---------- state assembly ----------
  /** A29 — what each demo phone reports as its build. Deliberately NOT uniform: the muster summary and
   *  the amber row only mean anything on a field that is mixed, and that is the field we keep having. */
  private appVer(sticker: string): { app_ver: string; platform: string } {
    const old = sticker === 'GUN-C' || sticker === 'GUN-H';
    return { app_ver: old ? '0.1.8+99ffee1' : '0.1.9+ab12cd3', platform: sticker === 'GUN-A' ? 'ios' : 'android' };
  }

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
    return this.oneTeamFault()
      ? 'ONLY ONE SIDE HAS PLAYERS — a match fought on one side cannot register a hit; move players between teams'
      : null;
  }

  /** `state.py _reteam_for_config()`, mirrored — round-3 FIELD-1.
   *
   *  Map by team INDEX (so a TDM blue/yellow split survives a KOTH pick as blue/green), least-count
   *  fill anyone the new config has no index for, and rebalance ONLY when the one-side predicate is
   *  then true. The demo used to do what the server used to do — dump everyone onto `teams[0]` — so
   *  `?mock` stranded itself on one side on every cross-family mode pick, which is a demo predicting
   *  a state the real MC no longer produces. */
  private reteamForConfig(prevTeams: { team_id: string }[]) {
    const ids = this.config.teams.map(t => t.team_id);
    const legal = new Set(ids);
    const byOldIndex = new Map(prevTeams.map((t, i) => [t.team_id, i]));
    const unplaced: typeof this.players = [];
    for (const p of [...this.players].sort((a, b) => a.player_num - b.player_num)) {
      if (legal.has(p.team_id ?? '')) continue;
      const i = byOldIndex.get(p.team_id ?? '');
      if (i !== undefined && i < ids.length) p.team_id = ids[i];
      else unplaced.push(p);
    }
    for (const p of unplaced) p.team_id = this.leastCountTeam();
    if (this.oneTeamFault()) this.rebalanceSides();
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
    const board: ReadinessRow[] = GUNS.map(([sticker, tail, s0, batt, link]) => {
      const s = this.gunOverride[sticker] ?? s0;
      const pl = this.players.find(p => p.gun_id === sticker);
      const red = s === 'r', a1 = s === 'a1', a2 = s === 'a2';
      const blockers: string[] = [];
      if (red) blockers.push('NOT POWERED — BLOCKS START');
      // A36/A37 under `?mock&faults=1` — the three reds, exactly as `state.py readiness()` writes them.
      const fault = this.faultOf(sticker);
      if (this.pushed && fault === 'stale') blockers.push(DEMO_STALE_LINE);
      if (this.pushed && fault === 'echo') blockers.push(DEMO_ECHO_LINE);
      if (this.pushed && fault === 'pool') blockers.push(DEMO_POOL_LINE);
      // …and they are REDS, like the server's. `noecho` is deliberately not here: NOT ECHOED is the
      // absence of a proof, not a fault, and a row that went amber for it would be amber all night
      // on every gun in the field.
      const proofRed = this.pushed && (fault === 'stale' || fault === 'echo' || fault === 'pool');
      if (a1) blockers.push('BATTERY UNREAD — DOES NOT BLOCK');
      if (a2) blockers.push(`STALE LINK (${link}s) — DOES NOT BLOCK`);
      // A29: the version flags are the SERVER's words, amber only (A1: amber never blocks). The demo
      // writes them the way `state.py readiness()` will, so the console can render and never re-derive.
      const ver = this.appVer(sticker);
      const ambers: string[] = [];
      if (ver.app_ver.startsWith('0.1.8')) ambers.push('APP OLDER THAN THE FIELD (0.1.8 < 0.1.9) — DOES NOT BLOCK');
      // A32: the demo board shows BOTH proofs, because they read differently and the operator has to
      // recognise each. GUN-F's link is still counting up (it is already an amber row for its unread
      // battery, so the extra advisory perturbs no other card's status); every other linked phone has
      // held its link past the 10 s a headless gun cannot survive. After the push the echo takes over.
      const flapping = !red && this.demoFlap && sticker === 'GUN-C';
      if (flapping) ambers.push(GUN_FLAPPING_LINE);   // one steady amber, as `state.py readiness()` writes it
      const confirming = !red && !this.pushed && sticker === 'GUN-F';
      if (confirming) ambers.push('HEADSET · CONFIRMING (LINK 4 s)');
      const proof = red || confirming || flapping ? null : this.pushed ? 'echo' as const : 'link' as const;
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
        battery_pct: waiting ? null : batt ?? null, battery_age_ms: waiting || batt == null ? null : 4000,
        last_seen_age_ms: waiting ? null : red ? (droppedBackhaul ? 130_000 : null) : link * 1000,
        gun_linked: waiting || red ? null : true,
        gun_flapping: flapping,
        pool_stale: null, pool_stale_ms: null,
        fw: 'v4.32', phone_batt: 80, ssid_ok: true, mc_reachable: !red && !waiting, synced: !red && !waiting,
        screen_on: true, foreground: true,
        // A28.3 / F155: the server stamps `reach` from the socket path and clears it on disconnect; `last_reach` outlives it.
        reach: red || waiting ? null : (this.lastReach[tail] ?? 'lan'),
        last_reach: waiting ? null : this.lastReach[tail] ?? (red ? null : 'lan'),
        status: waiting ? 'waiting' : red || proofRed ? 'red' : a1 || a2 || ambers.length ? 'amber' : 'green',
        blockers: waiting ? [] : blockers,
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
                                                && !this.staleNodes.has(b.tail.toUpperCase())).length;
    return { t: now(), roster_size: board.length, greens: board.filter(b => b.status === 'green').length, board, unclaimed: [],
             roster_faults: rf ? [rf] : [], unrostered_phones, go: !board.some(b => b.status === 'red') && !rf };
  }

  /** A28.1: MC's own view of the tunnel it (may have) started. */
  private publicView(): LanPublic {
    return { ws_url: this.tunnelWsUrl, status: this.tunnelStatus, provider: this.tunnelProvider, available: this.tunnelAvailable, error: this.tunnelError,
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
    const linked = readiness.board.filter(b => b.node === 'linked' && !this.evicted.has(`node_${b.tail}`));
    const nodes: NodeView[] = linked.map((b, i) => {
      const reach = (this.tunnelStatus === 'up' && i % 2 === 0 ? 'backhaul' : 'lan') as 'lan' | 'backhaul';
      // F155 (field 2026-09-12): `last_reach` survives past whatever CLEARS `reach` on a real server
      // (a disconnect) — the demo tracks it the same way, keyed by tail, so a card that goes stale
      // still knows which path it lost.
      this.lastReach[b.tail] = reach;
      return {
        node_id: `node_${b.tail}`, node_type: 'phone', gun_name: `${b.sticker}-${b.tail}`, gun_tail: b.tail,
        player_id: b.player_id, arm_state: this.armStateFor(b.player_id), last_seen_ms: b.last_seen_age_ms ?? 0,
        synced: true, battery: b.battery_pct, fw: b.fw,
        app_ver: b.app_ver, platform: b.platform,      // A29
        log: this.logFor(`node_${b.tail}`),            // A25
        reach, last_reach: this.lastReach[b.tail],
      };
    });
    // F155 pass 1 (2026-09-12): the earlier version of this demo bolted a SECOND, disconnected NodeView
    // onto `state.nodes` here to carry `last_reach` for GUN-F — decoupled from GUN-F's own readiness
    // ROW (which stayed `node: 'none'`), so the card read "NEVER THIS SESSION" and "NOT REACHED FOR
    // 2m10s" at once. `readiness()` now stamps `reach`/`last_reach` on the row itself (seeded via
    // `lastReach['A0B3']` in the constructor), so there is nothing to bolt on here any more — the ONE
    // row already carries the ONE explanation.
    const kitted = this.players.filter(p => PLAYERS.find(x => x[0] === p.display)?.[3] === 'kitted' || (p.player_id in this.acks)).length;
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
        warning: this.demoLanWarning
          ? 'PHONES CANNOT REACH THIS ADDRESS — this looks like WSL2\'s own private network, not the '
            + 'Windows host\'s LAN. Pass --advertise <windows-lan-ip> (find it with `ipconfig` on '
            + 'Windows) to put the real address in the QR and mDNS without moving where MC binds, and '
            + 'forward the ports with a netsh portproxy (`netsh interface portproxy add v4tov4 '
            + 'listenaddress=<windows-lan-ip> listenport=8766 connectaddress=<this WSL IP> '
            + 'connectport=8766`, and again for 8765) — the WSL IP changes on every restart, so redo '
            + 'the portproxy each time.'
          : null,
      },
      ...(this.restoredFrom ? { restored_from: this.restoredFrom } : {}),
      coverage: this.coverage(nodes),
      // The demo keeps one off-grid node in the confidence sample so the same MC-gating view is
      // available in ?mock as in the advanced presentation panel.
      mc_confidence: { confident: false, missing: ['p-demo-2'], stale: [], unflushed: [] },
      feed: [...(this.live_?.feed ?? [])],
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
      standby: clone(this.standby),
      kit: { kitted, total: this.players.length, trying: { ...this.trying }, browsing: { ...this.browsing } },
      loadout_pool: this.pool(),
      active_preset_id: this.activePreset,
      // A36/C-5: `all_acked` is the SERVER's own answer to "has every gun answered for THIS config",
      // and the console prefers it over its own count. The mock exists to predict the server, so it
      // sends it too — without it `?mock` exercised only the fallback path.
      lobby: { ready: this.players.filter(p => p.ready).length, total: this.players.length, pushed: this.pushed,
               acks: clone(this.acks), all_acked: this.allAcked() },
      // LOAD: the game the phones were told about (no frames, no head) — what the GAMES tab keys its
      // ACTIVE GAME CONFIG state on, and a different fact from `lobby.pushed` above.
      game: { loaded: this.gameLoaded, config_id: this.config.config_id,
              sent: this.players.filter(p => this.gameSent[p.player_id] === this.config.config_id).length,
              total: this.players.length },
      sync: this.syncSummary(),
      options: { ...this.options },      // A25
      // A31: the compiler writes this ONCE, so MC and the phones cannot disagree. The demo raises it
      // whenever the game's end state is MC's call (a frag cap, or an objective win_by) — which is the
      // only condition under which a phone with no backhaul changes what the players should do.
      notices: (this.config.scoring.frag_limit || this.config.scoring.win_by === 'objective')
        ? { mc_verify: 'WIN IS CONFIRMED AT MC · 2 PHONES OFF-GRID · TELL PLAYERS TO RETURN AFTER THE WHISTLE (SABLE, DRIFT)' }
        : undefined,
      start: this.start_ ? clone(this.start_) : undefined,
      live: this.live_ ? this.liveView() : undefined,
      recap: this.recap_ ? clone(this.recap_) : undefined,
      end_delivery: this.endDelivery(),      // A42
      orphan_match: this.orphanView(),
    };
  }
  /** A42 — did the END reach every player's HUD? Plain `?mock` shows the ordinary answer (all of them
   *  did, which is the sentence the operator asked to see); `?mock&faults=1` shows one phone that never
   *  confirmed, which is the state the field hit twice on 2026-09-12 and the only way to look at that
   *  notice without a match on the ground. Mirrors `state.py _end_delivery_view()`. */
  /** `state.py END_RETRY_MS`, mirrored so the demo cannot invent a different ladder. The whistle's own
   *  push is try 1, so try N falls due at the sum of the first N-1 gaps: 0, 2s, 7s, 17s, 37s, 77s,
   *  137s -- after which the server STOPS and A34's reconcile is the long tail. */
  private static readonly END_RETRY_MS = [2_000, 5_000, 10_000, 20_000, 40_000, 60_000];
  /** when the whistle blew (`endedAt`), so `tries`/`retrying` are DERIVED the way the server derives
   *  them rather than frozen at the spent end of the ladder. */
  private endedAt?: number;

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
    if (this.endedAt === undefined) return undefined;
    const total = this.players.length;
    if (!total) return undefined;
    const out = this.demoFaults ? [this.players[total - 1]] : [];
    const since = Math.max(0, now() - this.endedAt);
    // Count the attempts that have actually fallen due, exactly as `_end_delivery_tried` does.
    let tries = 1, due = 0;
    for (const gap of MockBackend.END_RETRY_MS) { due += gap; if (since >= due) tries += 1; else break; }
    const exhausted = tries >= 1 + MockBackend.END_RETRY_MS.length;
    return {
      match_id: this.live_?.match_id ?? 'm-mock', total, confirmed: total - out.length,
      retrying: out.length > 0 && !exhausted,
      unconfirmed: out.map(p => ({ player_id: p.player_id, display: p.display, node_id: `node-${p.player_id}`,
                                   tries, since_ms: since, reached: true, retrying: !exhausted })),
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
        if (r.pool_stale_ms != null) r.pool_stale_ms += 1000;
      }
      if (Math.random() < 0.12) this.simKill();
      this.emit();
    }
  }
  // `killerId` is a test hook. The e2e walk names a killer to put one row at exactly 6 shots, which
  // is a number that is still settling. The tick never passes it, so the demo still picks at random.
  private simKill(killerId?: string) {
    const l = this.live_!; const alive = l.rows.filter(r => r.status === 'alive');
    if (alive.length < 2) return;
    const k = alive.find(r => r.player_id === killerId) ?? alive[Math.floor(Math.random() * alive.length)];
    let v = alive[Math.floor(Math.random() * alive.length)];
    if (v === k) v = alive[(alive.indexOf(k) + 1) % alive.length];
    for (const x of [k, v]) { delete x.pool_stale; delete x.pool_stale_ms; } k.kills++; k.streak++; k.hits += 3; k.shots += 6; v.deaths++; v.streak = 0; v.status = 'down'; v.respawn_in_s = this.config.respawn.delay_s;
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
    if (cap && k.kills === cap - 1) {
      this.feed({ t_match_s: tm, kind: 'alert', tag: 'ALERT',
                  text: `${k.display} is one kill from the cap` });
    } else if (k.kills === 3 && k.kills > Math.max(...l.rows.filter(r => r !== k).map(r => r.kills))) {
      this.feed({ t_match_s: tm, kind: 'alert', tag: this.config.mode === 'ffa' ? 'ALERT' : 'WITHHELD',
                  text: this.config.mode === 'ffa' ? `${k.display} takes the lead`
                                                   : `${(k.team_id ?? '').toUpperCase()} takes the lead` });
    }
    if (cap && k.kills >= cap) this.endMatch();
  }
  private goLive() {
    const s = this.start_!;
    this.phase = 'live';
    const rows: LiveRow[] = this.players.map(p => {
      const d = LIVE.find(x => x[0] === p.display) ?? [p.display, 0, 0, 0, 0, 0, 'alive', 1];
      return { player_id: p.player_id, display: p.display, team_id: p.team_id, kills: 0, deaths: 0, assists: 0, shots: 0, hits: 0,
        // A24: the additive row fields, so ?mock shows what a current server sends. `acc_provisional`
        // starts TRUE for everyone — under 10 shots the number has not settled (F119), and the demo
        // is the only place the settling look can be seen without a match on the field.
        shots_total: 0, best_streak: 0, multi_best: 0, first_blood: false, acc_provisional: true,
        accuracy: null, kd: 0, streak: 0, medals: [], status: d[6] === 'stale' ? 'stale' : 'alive', sync_age_ms: d[7] * 1000,
        respawn_in_s: null };
    });
    // F208: one player's gun has gone quiet, so ?mock shows the grey GUN SILENT cue. Its age counts up
    // each tick and the claim clears the moment that player kills or dies (their gun spoke).
    const quiet = rows.find(r => r.status === 'alive');
    if (quiet) { quiet.pool_stale = 'silent'; quiet.pool_stale_ms = 190_000; }
    this.live_ = { rows, feed: [], go_live_t: s.go_live_t, match_id: s.match_id }; this.endedAt = undefined;
    this.feed({ t_match_s: 0, text: `MATCH LIVE — ${rows.length} NODES SPAWNED`, kind: 'sync', tag: 'SYNC POINT' });
  }
  private endMatch() {
    const l = this.live_; if (!l) return;
    this.phase = 'recap';
    // A42: the server arms the end-delivery watch in `_finish()` -- AT THE WHISTLE -- not when the
    // operator happens to open RECAP. Stamping it here is what lets the demo reach the RE-DELIVERING
    // state and the LIVE banner at all; keyed off `recap_` it could only ever show the spent ladder.
    this.endedAt = now();
    // R2-1: `state.py _finish()` drops `lobby_pushed` and the acks at the whistle — the next match
    // needs a FULL fresh head push (A36), which is also what makes that push a first push rather
    // than a re-push, so the game number moves for it. The mock kept `pushed` true across the END,
    // and with a re-push now being a distinct action that difference is visible.
    this.pushed = false; this.acks = {};
    this.gameLoaded = false; this.gameSent = {};   // a finished match is not a loaded game (`_finish`)
    const rows: ScoreRow[] = l.rows.map(r => {
      const d = RECAP.find(x => x[0] === r.display);
      const kills = r.kills || d?.[1] || 0, deaths = r.deaths || d?.[2] || 0;
      const shots = r.shots || 40;
      return { player_id: r.player_id, display: r.display, team_id: r.team_id, kills, deaths, assists: r.assists || d?.[3] || 0,
        shots, shots_total: shots, hits: r.hits || Math.round((d?.[4] ?? 30) * 0.4), accuracy: r.accuracy ?? d?.[4] ?? 30,
        kd: +(kills / Math.max(deaths, 1)).toFixed(1), streak: r.streak || d?.[5] || 0, medals: [],
        // A24: the match is over, so accuracy has settled; `best_streak` is the longest run, which at
        // the whistle is what the RECAP column must show (`streak` is the survivor of the last death).
        best_streak: Math.max(r.best_streak ?? 0, r.streak || d?.[5] || 0),
        multi_best: r.multi_best ?? 0, first_blood: !!r.first_blood, acc_provisional: false };
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
    // A6.1: two kills landed after the whistle. They are REAL and they do NOT count — the demo carries
    // them so the "recorded, not counted" block can be seen (and tested) without a match on the field.
    const late = rows.slice(0, 2);
    const after_end = late.length === 2 ? {
      facts: 3,
      by_player: { [late[0].player_id]: { kills: 1, deaths: 0 }, [late[1].player_id]: { kills: 0, deaths: 1 } },
    } : undefined;
    this.recap_ = { winner: ffa ? { player_id: top.player_id } : { team_id: winnerTeam }, score, rows, honors, provisional: missing.length > 0, missing,
                    ...(after_end ? { after_end, post_end_facts: after_end.facts } : {}),
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
    this.phase = phase as Phase; this.emit(); return {};
  }
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
    const { config_id: _cid, ...cfg } = withPolicy(clone(p.config ?? this.config)); void _cid;
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
    if (p.config) { const { config_id: _c, ...cfg } = withPolicy(clone(p.config)); void _c; sg.config = { ...cfg, config_id: '' }; }
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
      summary: { preset: 'standard', announcer: true, gun_flash: true, headset_team: true, sight_flash: true, hud_events: true, mc_events: true, mc_confidence: true, blackout: false, voice: 'on' as const, custom_events: [] as string[],
        headset: { pregame: 'team', start_flash: true, in_play: 'dark', hit: 0, death: 'native', respawn_flash: true, role: true, carrier: true },
        gun: { in_play: 'team', pregame: 'team' } },
      events: rows.map(r => ({ ...r, flash: null, slot: null })),
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
    const { config_id: _cid, loadout_policy, ...rest } = withPolicy(clone(sg.config)); void _cid;
    const r = await this.putConfig({ ...rest, loadout_policy: { ...loadout_policy, preset: presetOf(loadout_policy) } });   // the name is re-derived, like the server
    this.activePreset = id; this.emit();
    return r;
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
    const rolled = await this.rollFromRecap();
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
    if (Object.keys(partial).some(k => !['environment', 'night', 'config_id'].includes(k))) this.activePreset = null;   // a real edit: no longer that saved game
    // F-10 (2026-09-13): `state.py set_config` rebuilds the WHOLE config from `default_config(mode)`
    // whenever the mode changes, THEN merges the patch on top — so nothing belonging to the OLD mode
    // can survive the switch. `station_source` was the one key this mirrored (F70: only the objective
    // modes carry one); `teams` was not, so a bare `{ mode: 'koth' }` (GameEditPanel's inline mode Seg,
    // never `Games.tsx`'s full-defaults tile) spread onto the PREVIOUS config left TDM's BLUE/YELLOW in
    // place instead of KOTH's BLUE/GREEN, and `?mock` predicted a roster the real server never
    // produces. Venue facts (environment/night/coverage) are carried forward exactly like the server
    // carries them (`set_config`, same three keys, same "unless the patch itself names them" rule) —
    // they describe the SITE, not the game.
    const modeChanged = !!partial.mode && partial.mode !== prevMode;
    const base: ConfigView = modeChanged ? withPolicy(clone(MODES.find(m => m.mode === partial.mode)!.defaults)) : clone(this.config);
    if (modeChanged) {
      if (partial.environment === undefined) base.environment = this.config.environment;
      if (partial.night === undefined) base.night = this.config.night;
      if (partial.coverage === undefined && this.config.coverage !== undefined) base.coverage = this.config.coverage;
    }
    this.config = { ...base, ...partial, config_id: uid('cfg') };
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
      this.config.loadout_policy = polBase;
    }
    // 🔴 The real server re-teams anyone left on a team the new mode does not have
    // (state.py `_reteam_for_config`). The demo used to skip this entirely, so `?mock` showed a KING
    // OF THE HILL roster still half YELLOW — the exact $TID 2 the server refuses (F82) and the one
    // thing this screen must never appear to allow. A demo that predicts the wrong state is worse than
    // no demo: it is where a "verified" screenshot comes from. Round-3 FIELD-1 moved both sides off
    // "everyone onto teams[0]" and onto index-mapping + rebalance; this mirrors that rule.
    this.reteamForConfig(prevTeams);
    this.applyPolicy();
    const errors: string[] = [];
    if (this.config.time_limit_s == null || this.config.time_limit_s <= 0) errors.push('time_limit_s is required on the phone path');
    if (MODES.find(m => m.mode === this.config.mode)?.defaults.station_source && !this.config.station_source) {
      errors.push(`mode '${this.config.mode}' needs a station/objective source (Tier 1) — set config.station_source to one of: `
        + MOCK_STATION_SOURCES.map(x => `'${x.value}' (${x.desc})`).join(', '));
    }
    if (this.config.mode === 'ffa') { const t = this.config.teams[0]; if (t) for (const p of this.players) p.team_id = t.team_id; }
    // B3 (2026-09-12, coordinated with the real server's fix): editing a game that had already been
    // pushed to the guns used to un-push it SILENTLY -- `pushed` fell false and the acks were just
    // dropped, with nothing on screen saying the guns were now stale (B1's root cause: guns left
    // running the OLD config with nothing visible naming the skew). The real `state.py set_config` now
    // keeps `lobby_pushed` true and RE-PUSHES the fresh config to every bound node; the mock mirrors
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
      this.gameSent = Object.fromEntries(this.players.filter(p => p.node_id).map(p => [p.player_id, this.config.config_id]));
    }
    if (this.pushed && errors.length) { this.pushed = false; this.acks = {}; }
    else if (this.pushed) {
      this.acks = {};
      const cfgId = this.config.config_id;
      setTimeout(() => {
        if (!this.pushed || this.config.config_id !== cfgId) return;   // recalled, or superseded by a newer edit
        for (const p of this.players) this.acks[p.player_id] = this.ackFor(p, cfgId);
        this.emit();
      }, this.repushAckMs);   // long enough for a real-browser poll to see the transitional "re-pushing" state
    }
    if (rolled) this.phase = 'build';   // `set_config` moves muster -> build once a game is picked
    this.cfgErrors = errors;
    this.emit();
    return { ok: errors.length === 0, errors, config: clone(this.config) };
  }
  async addPlayer(p: { display: string; team_id?: string; gun_id?: string; voice?: string }): Promise<Player> {
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
    const pl: Player = { player_id: uid('p'), player_num: n, display: p.display.toUpperCase(), team_id: teamId, node_id: null,
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
    const back: Player = { ...p, player_num: n, ready: false, node_id: p.gun_id ? `node_${GUNS.find(g => g[0] === p.gun_id)?.[1] ?? 'x'}` : null };
    this.players.push(back); this.emit(); return clone(back);
  }
  async evictNode(id: string) { this.evicted.add(id); this.emit(); }
  /** T2 review S5 demo/test hook: mark a phone (by gun tail) silent, or heard again — the mock's
   *  stand-in for the `stale` flag the server's net layer raises and clears on its own. */
  setNodeStale(tail: string, stale = true) {
    const k = tail.toUpperCase();
    if (stale) this.staleNodes.add(k); else this.staleNodes.delete(k);
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
    return { ok: true, node_id, log: this.logFor(node_id) };
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
  /** Bench 2026-09-17: MARK ALL READY -- the roster-wide `host_override`, mirroring `state.py
   *  ready_all()`. LOBBY only, `this.players` alone (STANDBY lives in `this.standby`, untouched),
   *  and never touches acks or the config head. */
  async readyAll() {
    if (this.phase !== 'lobby') throw new Error('mark all ready only runs on LOBBY');
    const readied: string[] = [];
    for (const p of this.players) {
      if (!p.ready) { p.ready = true; delete this.trying[p.player_id]; delete this.browsing[p.player_id]; readied.push(p.player_id); }
    }
    this.emit();
    return { ok: true, readied };
  }
  /** LOAD: announce the game, write no gun (`state.py load_game`). `pushed` stays FALSE. */
  async loadGame() {
    if (this.phase === 'armed' || this.phase === 'live') {
      throw new Error('cannot load a game once the match has started — ABORT or RECALL first');
    }
    await this.rollFromRecap();          // a LOAD after the whistle loads the NEXT match
    const cfg = this.config.config_id;
    this.gameLoaded = true;
    // DELIVERY: only a player whose phone is actually connected is counted. The demo ships one
    // player whose phone has never arrived, so this is never a full house by accident.
    this.gameSent = Object.fromEntries(this.players.filter(p => p.node_id).map(p => [p.player_id, cfg]));
    if (this.phase === 'muster') this.phase = 'build';
    this.emit();
    return { ok: true, config_id: cfg, sent: Object.keys(this.gameSent).length, total: this.players.length };
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
      throw Object.assign(new Error(`the match is ${this.phase.toUpperCase()}: END it before starting the next one`), { status: 409 });
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
      phone_game: this.gameSent[p.player_id] === cur,
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
    await this.rollFromRecap();          // a push after the whistle is for the NEXT match
    const rf = this.rosterFault();
    if (rf) throw new Error(rf);          // round-2 B: not a readiness judgement, so `force` does not open it
    // A37: the three A36 proofs all SAY "RE-PUSH" and are cured by this very call, so they do not
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
    if (this.gameStarted) { this.gameNo = (this.gameNo % 255) + 1; this.gameStarted = false; }
    // …and the demo faults are cured by the cure. `noecho` is NOT: it is the v4.32 firmware not
    // echoing its weapon, and no number of pushes changes that (webapp/mc/README.md → demo switches).
    if (repushed) this.demoCured = true;
    for (const n of Object.keys(this.stations)) this.armStation(n);
    this.phase = 'lobby'; this.pushed = true; this.trying = {}; this.acks = {};
    // ...and only a phone that is ON THE NET answers one: `_push_config_to` compiles for every player
    // and sends to those with a socket, so a player whose phone has not arrived has a bundle and no ack.
    for (const p of this.players) if (p.node_id) this.acks[p.player_id] = this.ackFor(p, this.config.config_id);
    this.emit(); return { ok: true, acks: clone(this.acks), repushed, config_id: this.config.config_id };
  }
  private schedule(runway_s: number, seq: number, match_id: string) {
    const go_live_t = now() + runway_s * 1000;
    const per_node: StartView['per_node'] = {};
    for (const p of this.players) {
      const noAck = p.display === 'DRIFT';
      per_node[p.player_id] = { arm_state: noAck ? 'lobby' : 'armed', t_minus_ms: noAck ? null : runway_s * 1000, synced: !noAck, last_seen_ms: noAck ? 40000 : 1000 };
    }
    this.start_ = { match_id, go_live_t, config_id: this.config.config_id, seq, countdown_s: runway_s, per_node };
    this.phase = 'armed'; this.emit();
    return { match_id, go_live_t, seq };
  }
  async start(runway_s: number, _force?: boolean) {
    if (!this.pushed) throw new Error('push config first');
    const rf = this.rosterFault();
    if (rf) throw new Error(rf);          // a team can empty out between the push and the whistle
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
    const nodes = this.players.filter(p => p.node_id).length;
    // `?mock` must never look more permissive than a real MC (the rule at `putStation` above; here it
    // is `state.py` `control`). An END with no scorer — or a second END once the recap is written —
    // ends NOTHING and moves NO phase, and says so in `error`. This used to fall through to the
    // recall branch: the demo answered a bare `{ok:true}` and quietly reset the session, which is the
    // exact defect the server fixed. The press IS still forwarded, so `pushed` is non-zero while
    // `reached` is 0 and `ended` is false.
    if (cmd === 'end' && !this.live_) {
      return { ok: false, ended: false, reached: 0, pushed: nodes, nodes, phase: this.phase,
               error: this.phase === 'recap'
                 ? 'this match has already ended — the recap stands (RECALL returns the field to KIT)'
                 : 'no match is being scored — nothing to end (RECALL returns the field to KIT)' };
    }
    if (cmd === 'end') { this.endMatch(); return { ok: true, ended: true, reached: nodes, pushed: nodes, nodes, phase: this.phase }; }
    // recall/panic stop a live game -> KITTED (A5.9), the same landing `state.py` gives them. The
    // mock used to go back to LOBBY whenever a config head had been pushed, so a recall in `?mock`
    // ended somewhere a recall on a real MC never does.
    this.start_ = undefined; this.live_ = undefined; this.phase = 'kit'; this.pushed = false; this.acks = {}; this.endedAt = undefined;
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
      if (cmd === 'respawn') { r.status = 'alive'; r.respawn_in_s = null; }
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
    this.phase = 'muster'; this.pushed = false; this.acks = {}; this.start_ = undefined; this.live_ = undefined; this.recap_ = undefined; this.endedAt = undefined;
    this.gameLoaded = false; this.gameSent = {};
    this.session_id = uid('sess');
    this.restoredFrom = null;   // F142: NEW SESSION, CLEAR ROSTER is the acknowledgment — a restored banner never lingers
    if (!keep_roster) this.players = []; else for (const p of this.players) p.ready = false;
    this.emit(); return this.state();
  }
  /** "Report a problem" — mirrors `POST /api/report` (mcp/brx_mcp/mc/api.py, Lane A) closely enough
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
