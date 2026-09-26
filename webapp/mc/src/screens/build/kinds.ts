// F411 BUILD: the eight piece kinds, in the order the tabs and the storyboard show them
// (docs/spec/design/games-presets.md §1, games-redesign.md §3).
import type { PieceKind } from '../../api/contract.gen';

export interface KindMeta {
  kind: PieceKind;
  label: string;
  /** GAME MODE and GAMEPLAY: cards only, no editor (games-presets.md §5) */
  readOnly: boolean;
}

export const KIND_TABS: KindMeta[] = [
  { kind: 'mode', label: 'GAME MODE', readOnly: true },
  { kind: 'life', label: 'LIFE', readOnly: false },
  { kind: 'spawn', label: 'SPAWN', readOnly: false },
  { kind: 'primary', label: 'PRIMARY', readOnly: false },
  { kind: 'secondary', label: 'SECONDARY', readOnly: false },
  { kind: 'perks', label: 'PERKS', readOnly: false },
  { kind: 'misc_loadouts', label: 'MISC LOADOUTS', readOnly: false },
  { kind: 'gameplay', label: 'GAMEPLAY', readOnly: true },
];

export const kindLabel = (k: PieceKind): string => KIND_TABS.find(t => t.kind === k)?.label ?? k.toUpperCase();
