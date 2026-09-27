// Shared between Games.tsx (PLAY, LAST MATCH) and Build.tsx (SAVE on a picked piece): the wording for
// a PICK fallback -- a kind the caller did not itself name (an INHERITED piece, e.g. a post-MVP mode
// set on KIT, or another kind's picked piece falling back while THIS kind's value is what changed)
// falls back to its builtin. Never "ITS SAVED PICK IS GONE" (that is a FAVOURITE's own fallback,
// worded separately in Games.tsx -- there really was a saved pick that vanished; here there was not).
//
// No `GamePick` needed: a fallback always resolves to that kind's first non-post_mvp, non-invalid piece
// (the SAME rule both the mock and the server apply -- `resolvePiecesMixed`/`resolve_pieces_mixed`), so
// `pieces` alone is enough to say what it landed on, and this reads the same from Build.tsx (which has
// no `game_pick` of its own to consult) as it does from Games.tsx.
import type { GamePiece, PieceKind } from '../api/types';
import { kindLabel } from './presets/kinds';

export const pickFallbackNote = (fallbacks: PieceKind[], pieces: GamePiece[]): string[] | null => (fallbacks.length
  ? fallbacks.map(k => `${kindLabel(k)}: USING ${pieces.find(p => p.kind === k && !p.post_mvp && !p.invalid)?.name ?? 'ITS DEFAULT'} (THE KIT PICK IS NOT OFFERED ON PLAY)`)
  : null);
