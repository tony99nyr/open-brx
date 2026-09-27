// F411 BUILD: one card in a kind's shelf (games-presets.md §5: "name, note, a BUILT-IN tag").
import type { GamePiece } from '../../api/contract.gen';
import { onKey, OutlineTag, Tag } from '../../ui';
import { F, T } from '../../tokens';

export function PieceCard({ piece, selected, onSelect, onOpen }:
  { piece: GamePiece; selected: boolean; onSelect?: () => void; onOpen?: () => void }) {
  const clickable = !!(onSelect || onOpen);
  const activate = () => { onSelect?.(); onOpen?.(); };
  return (
    <div role={clickable ? 'button' : undefined} tabIndex={clickable ? 0 : undefined}
      aria-pressed={clickable ? selected : undefined} aria-label={clickable ? `${onOpen ? 'edit' : 'select'} ${piece.name}` : undefined}
      onClick={clickable ? activate : undefined} onKeyDown={clickable ? onKey(activate) : undefined}
      data-testid={`piece-card-${piece.piece_id}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px', minHeight: 44, flex: '0 0 200px',
        background: selected ? 'rgba(57,180,255,.07)' : T.panel, border: `1px solid ${selected ? T.acc : T.line}`,
        opacity: (piece.post_mvp || piece.invalid) ? 0.55 : 1, cursor: clickable ? 'pointer' : 'default' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ font: F.osw(600, 15), letterSpacing: '.04em', lineHeight: 1.2 }}>{piece.name.toUpperCase()}</span>
        {/* QA-24 (visual QA round 1): 10px was under the console's 11px meaning-bearing-text floor */}
        {piece.builtin && <Tag size={11} color={T.panelAlt} ink={T.dim}>BUILT-IN</Tag>}
      </div>
      {/* QA-24: a read-only card (GAME MODE, GAMEPLAY) shows its name and BUILT-IN only -- no long
          mixed-case paragraph. A host-added piece still shows its own one-line note. */}
      {piece.note && <span style={{ font: F.chk(500, 12), color: T.dim, lineHeight: 1.4, minHeight: 15 }}>{piece.note}</span>}
      {piece.post_mvp && <OutlineTag color={T.warn} border={T.line2}>POST-MVP</OutlineTag>}
      {/* Round 3 (review): a stored piece a rule tightened under is kept, greyed like POST-MVP, but
          with its own reason (never invented -- the server's own text, or the mock's mirror of it)
          instead of a bare tag. Still clickable: EDIT (to fix the value) and DELETE both still work. */}
      {piece.invalid && <span data-testid="piece-invalid-reason" style={{ font: F.chk(600, 11), color: T.warn, lineHeight: 1.4 }}>▲ {piece.invalid}</span>}
    </div>
  );
}
