// F411 (docs/spec/design/games-redesign.md §9): the PLAY/LOBBY/ARMED operator note. At most two
// short, words-only lines, derived from real behaviour, never invented. A pure function: PLAY calls
// it off the composed config, and LOBBY/ARMED show the same lines the same way (one source, three
// render sites).
import type { GameConfig } from '../api/types';

type NoteConfig = Pick<GameConfig, 'mode'> & {
  respawn: Pick<GameConfig['respawn'], 'type'>;
  scoring: Pick<GameConfig['scoring'], 'frag_limit' | 'hold_target_s'>;
};

/** `hills` counts the assigned CONTROL stations: F572 (Tony 2026-10-18) sums the target across them. */
export function operatorNote(cfg: NoteConfig, hills = 1): string[] {
  const lines: string[] = [];
  // F415 (games-presets.md §7): a KOTH hold target changes what "HOLD IT TO SCORE" actually means --
  // say the target outright rather than leave the operator to infer it from the strip. No target keeps
  // the plain setup line (most possession at the clock still wins, the pre-F415 behaviour).
  if (cfg.mode === 'koth' && cfg.scoring.hold_target_s) {
    const m = Math.floor(cfg.scoring.hold_target_s / 60);
    const s = cfg.scoring.hold_target_s % 60;
    lines.push(hills > 1 ? 'PLACE THE HILLS BEFORE START' : 'PLACE THE HILL BEFORE START');
    lines.push(`FIRST TO HOLD ${m}:${String(s).padStart(2, '0')}${hills > 1 ? ' SUMMED ACROSS HILLS' : ''} WINS`);
  } else if (cfg.mode === 'koth') {
    lines.push('PLACE THE HILL BEFORE START · HOLD IT TO SCORE');
  } else if (cfg.mode === 'tdm') {
    lines.push("TEAM HITS DON'T COUNT");
  }
  // ffa: no note (games-redesign.md §9)
  if (cfg.respawn.type === 'scanner') lines.push('RESPAWN AT STATIONS');
  if (cfg.scoring.frag_limit) lines.push('WIN: PLAYERS CONFIRM AT MC');
  // VQA round 1 QA-28: "TIME: RUNS UNTIL YOU END IT" could never show -- PLAY's TIME control has no
  // "no limit" quick-pick, so time_limit_s is never null in practice. Dropped rather than left dead.
  return lines.slice(0, 2);
}

/** F572: how many CONTROL stations are assigned, the hill count `operatorNote` takes. */
export const hillCount = (stations: { assigned?: { kind: string } | null }[] | undefined): number =>
  (stations ?? []).filter(st => st.assigned?.kind === 'control').length;
