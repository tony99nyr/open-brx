import type { Player } from '../api/types';

// Port of state.py Session.game_sent_n(): the announced config can outlive a fresh gun head.
export function sessionGameSentN(players: Player[], gameSent: Record<string, string>, gameCfg: string | null): number {
  if (!gameCfg) return 0;
  return players.filter(player => gameSent[player.player_id] === gameCfg).length;
}
