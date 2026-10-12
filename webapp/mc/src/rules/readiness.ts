// Pure snapshot rules shared by the mock and console tests. These mirror state.py.
import type { ConfigView, Coverage, LobbyAck, NodeView, Player } from '../api/types';

type Binding = Pick<Player, 'player_id' | 'display' | 'node_id'>;
type Path = Pick<NodeView, 'node_id' | 'reach' | 'stale' | 'transport'>;

// Server: state.py Session.readiness(): roster_size.
export const sessionReadinessRosterSize = (players: readonly Binding[]) => players.length;
// Server: state.py Session.snapshot(): the kitted count passed to _snapshot_kit.
export const sessionKitted = (players: readonly Binding[]) => players.filter(p => !!p.node_id).length;

// Server: state.py Session._updating().
export function sessionUpdating(players: readonly (Binding & Pick<Player, 'ready'>)[], pushed: boolean,
  acks: Readonly<Record<string, LobbyAck>>, configId: string): number {
  if (!pushed) return 0;
  return players.filter(p => {
    if (!p.ready || !p.node_id) return false;
    const ack = acks[p.player_id];
    return !ack || !!(ack.ok && ack.gun_echo && ack.config_id && ack.config_id !== configId);
  }).length;
}

const independentPath = (node?: Path): boolean =>
  node?.reach === 'backhaul' && !node.stale && node.transport === 'cellular';

// Server: state.py Session.coverage().
export function sessionCoverage(players: readonly Binding[], nodes: readonly Path[]): Coverage {
  const byId = new Map(nodes.map(node => [node.node_id, node]));
  const bound = players.filter(p => !!p.node_id);
  const on_backhaul = bound.filter(p => {
    const node = byId.get(p.node_id!);
    return node?.reach === 'backhaul' && !node.stale;
  }).length;
  const on_cellular = bound.filter(p => independentPath(byId.get(p.node_id!))).length;
  return { level: bound.length && on_cellular === bound.length ? 'full' : 'zones',
    on_backhaul, on_cellular, bound: bound.length };
}

// Server: state.py Session._off_grid().
export function sessionOffGrid(players: readonly Binding[], nodes: readonly Path[]): string[] {
  const byId = new Map(nodes.map(node => [node.node_id, node]));
  return players.filter(p => !p.node_id || !independentPath(byId.get(p.node_id)))
    .map(p => p.display || p.player_id);
}

// Server: state.py Session._notices(): mc_verify.
export function sessionNoticesMcVerify(config: Pick<ConfigView, 'mode' | 'scoring' | 'coverage'>,
  offGrid: readonly string[]): string | undefined {
  const decided = !!config.scoring.frag_limit ||
    (!!config.scoring.win_by && config.scoring.win_by !== 'kills') ||
    config.mode === 'lms' || config.mode === 'infection';
  if (!decided || config.coverage === 'full' || !offGrid.length) return undefined;
  const shown = offGrid.slice(0, 6).join(', ') + (offGrid.length > 6 ? ` +${offGrid.length - 6} MORE` : '');
  return `WIN IS CONFIRMED AT MC, ${offGrid.length} PHONE${offGrid.length === 1 ? '' : 'S'} OFF-GRID (${shown}): TELL PLAYERS TO RETURN AFTER THE WHISTLE`;
}
