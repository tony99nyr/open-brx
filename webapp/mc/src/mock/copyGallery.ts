import type { State } from '../api/types';

// F599 render hook: `?mock&gallery=copy:<a>,<b>` lays injected faults on top of whatever the mock is showing
// (the phase and the roster are the mock's own, so the screen is driven by real clicks). Gallery only, nothing
// reads it in a real MC. Tokens, comma separated:
//   restorefail corrupt restored  Armory banners (O1, O2, F142)
//   outbox                        every unclaimed phone's node card has 3 lost facts (O6)
//   notsaving ticker joinerr      the every-screen server failures (O7, O8)
//   tunnel                        the internet tunnel is down (frame)
//   lanwarn nolan older           the join-panel warnings and "MC older than the console"
//   nohill respawn                GAMES: KOTH with no hill; respawn set to a station that is not assigned
//   departed                      ITEMS: the assigned hill station left
//   auto autoerr                  the backhaul auto-start status (`lan.public.auto`, F595)
export function copyState(base: State, spec: string): State {
  const has = new Set(spec.split(',').filter(Boolean));
  const s: State = { ...base };
  const t = base.t ?? Date.now();
  if (has.has('restorefail')) s.restore_failed = { reason: 'session.json: expected a roster list, got null', kept: '~/.brx-mcp/session.json.bad-20261024' };
  if (has.has('corrupt')) s.armory_corrupt = { kept: '~/.brx-mcp/armory.json.bak', error: 'JSONDecodeError: Expecting , delimiter: line 41 column 3' };
  if (has.has('restored')) s.restored_from = { at: t - 3_600_000, players: 2 } as State['restored_from'];
  if (has.has('outbox')) s.nodes = (base.nodes ?? []).map(n => (n.player_id ? n : { ...n, outbox_lost: 3 }));
  const fail = (error: string) => ({ since: t - 95_000, count: 7, error });
  if (has.has('notsaving')) s.not_saving = { store: fail('OSError: [Errno 28] No space left on device') };
  if (has.has('ticker')) s.ticker_failing = { since: t - 40_000, count: 12, error: 'RuntimeError: clock thread died' } as State['ticker_failing'];
  if (has.has('joinerr')) s.join_error = { error: 'OSError: network is unreachable', ws_url: 'ws://192.168.8.10:8765/ws' };
  const pub = (extra: Record<string, unknown>) => ({ ws_url: null, provider: 'cloudflared', available: true, ...(base.lan.public ?? {}), ...extra });
  if (has.has('tunnel')) s.lan = { ...s.lan, public: pub({ status: 'error', error: 'cloudflared exited with code 1: could not reach the edge' }) as never };
  if (has.has('auto')) s.lan = { ...s.lan, public: pub({ status: 'up', ws_url: 'wss://demo.example/ws', auto: { reason: 'kit', cellular: 1 } }) as never };
  if (has.has('autoerr')) s.lan = { ...s.lan, public: pub({ status: 'error', error: 'cloudflared exited with code 1: could not reach the edge', auto: { reason: 'kit' } }) as never };
  if (has.has('lanwarn')) s.lan = { ...s.lan, warning: 'MC IS ADVERTISING A WSL2 ADDRESS PHONES CANNOT REACH — run the port-forward script on Windows, or start MC on the Windows side.' };
  if (has.has('nolan')) s.lan = { ...s.lan, ip: '' };
  if (has.has('older')) s.lan = { ...s.lan, public: undefined };
  if (has.has('nohill')) { s.config = { ...s.config, mode: 'koth' }; s.stations = (base.stations ?? []).filter(x => x.assigned?.kind !== 'control'); }
  if (has.has('respawn')) {
    s.config = { ...s.config, respawn: { ...s.config.respawn, type: 'scanner' } };
    s.config_warnings = [...(base.config_warnings ?? []), 'SETUP: NO RESPAWN STATION IS ASSIGNED (RESPAWN IS SET TO STATION, SO A DOWNED PLAYER CAN ONLY COME BACK AT A STATION): ASSIGN A STATION AS RESPAWN IN ITEMS AND ARM IT'];
  }
  if (has.has('departed')) {
    const dep = (node_id: string, kind: string, id: number, returned: boolean) => ({ node_id, kind, id, team: 1, threshold: 0, label: 'PHONE ' + node_id.slice(0, 12), id_free: true, reason: 'back_to_hud',
      at_ms: t - 120_000, returned, restore: { kind, team: 1, threshold: 0 },
      line: `${kind.toUpperCase()} ${id} WENT BACK TO ITS PLAYER'S HUD, SO NOTHING HOLDS THE ${kind.toUpperCase()}: ${returned ? 'RESTORE IT, OR DISMISS THIS' : 'ASSIGN ANOTHER PHONE OR STICK'}` });
    const have = (base.stations ?? []).map(x => x.node_id);
    s.station_departures = [dep('util-gone-hill', 'control', 1, false), ...(have[0] ? [dep(have[0], 'powerup', 2, true)] : [])] as never;
  }
  return s;
}
