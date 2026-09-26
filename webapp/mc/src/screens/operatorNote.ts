// F411 (docs/spec/design/games-redesign.md §9): the PLAY/LOBBY/ARMED operator note. At most two
// short, words-only lines, derived from real behaviour, never invented. A pure function: PLAY calls
// it off the composed config, and LOBBY/ARMED show the same lines the same way (one source, three
// render sites).
import type { GameConfig } from '../api/types';

type NoteConfig = Pick<GameConfig, 'mode'> & {
  respawn: Pick<GameConfig['respawn'], 'type'>;
  scoring: Pick<GameConfig['scoring'], 'frag_limit'>;
};

export function operatorNote(cfg: NoteConfig): string[] {
  const lines: string[] = [];
  if (cfg.mode === 'koth') lines.push('PLACE THE HILL BEFORE START · HOLD IT TO SCORE');
  else if (cfg.mode === 'tdm') lines.push("TEAM HITS DON'T COUNT");
  // ffa: no note (games-redesign.md §9)
  if (cfg.respawn.type === 'scanner') lines.push('RESPAWN AT STATIONS');
  if (cfg.scoring.frag_limit) lines.push('WIN: PLAYERS CONFIRM AT MC');
  // VQA round 1 QA-28: "TIME: RUNS UNTIL YOU END IT" could never show -- PLAY's TIME control has no
  // "no limit" quick-pick, so time_limit_s is never null in practice. Dropped rather than left dead.
  return lines.slice(0, 2);
}
