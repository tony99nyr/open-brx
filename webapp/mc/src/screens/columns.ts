// The stats-board column model, shared by the LIVE board and the RECAP table.
//
// S24 split the numeric run into visual GROUPS with a hairline rule between them — what you did
// (K·D·A), how well (K/D·ACC), the best run (STK). Drawing that rule used to mean passing a
// hand-counted index into the column list from every cell (`groupEdge(5)` for ACC, `groupEdge(6)`
// for STK), so inserting or moving a column silently drew the rules in the wrong places with
// nothing to fail. LIVE was fixed by asking for the rule BY COLUMN KEY; RECAP still hand-indexed,
// which is the same defect one file over (review 2026-09-12). Both now build the lookup here, from
// their own column list, so a header and its cells can never disagree about where a group opens.
import { T } from '../tokens';

/** One column, in board order. `g` is the visual group: a change of group draws the rule. */
export type Column = { key: string; head: string; g: string; num?: boolean };
/** The rule itself — a border, not a fill (Tony's standing preference). */
export type Edge = { borderLeft: string; paddingLeft: number; marginLeft: number } | undefined;

/** The rule for column `i` of `cols`: drawn when it opens a new group. */
export const groupEdgeAt = (cols: Column[], i: number): Edge =>
  (i > 0 && cols[i].g !== cols[i - 1].g
    ? { borderLeft: `1px solid ${T.line2}`, paddingLeft: 8, marginLeft: -7 } : undefined);

/** The same rule, asked for BY COLUMN KEY. A key cannot drift the way a hand-counted index does. */
export function columnEdges(cols: Column[]): (key: string) => Edge {
  const by = new Map(cols.map((c, i) => [c.key, groupEdgeAt(cols, i)]));
  return (key: string) => by.get(key);
}
