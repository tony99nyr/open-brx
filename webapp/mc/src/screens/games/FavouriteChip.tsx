// One FAVOURITES chip on PLAY: load, rename and delete. Split out of Games.tsx (round-2 candidate 11).
import { useEffect, useRef, useState } from 'react';
import { NAME_MAX } from '../../api/contract.gen';
import type { Favourite } from '../../api/types';
import { F, T } from '../../tokens';
import { BTN_RESET, GhostButton } from '../../ui';

/** One FAVOURITES chip (games-presets.md §6): tap the name to LOAD it, ✎ to rename inline, ✕ for the two-tap delete confirm. */
export function FavouriteChip({ fav, renaming, confirmingDelete, onLoad, onRenameStart, onRenameCommit, onRenameCancel, onDeleteStart, onDeleteConfirm, onDeleteCancel }: {
  fav: Favourite; renaming: boolean; confirmingDelete: boolean;
  onLoad: () => void; onRenameStart: () => void; onRenameCommit: (name: string) => Promise<boolean> | void; onRenameCancel: () => void;
  onDeleteStart: () => void; onDeleteConfirm: () => void; onDeleteCancel: () => void;
}) {
  const [draft, setDraft] = useState(fav.name);
  // Saving or cancelling unmounts the input, which can still fire a blur: `done` stops that blur saving a second
  // time, or saving a name the operator just cancelled (the old version's round-3 bug). It resets when a rename
  // session starts, and when the server refuses the name (the chip stays open for another try). The draft resets only
  // when a session starts, so a poll that changes `fav.name` mid-edit does not wipe what the operator is typing.
  // Codex r1: `session` scopes a refusal to the session that sent it (a late refusal from an earlier session must not
  // re-open a later one), and cancel stays live while a save is in flight (`saving` blocks only a second save).
  const done = useRef(false), saving = useRef(false), session = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (renaming) { setDraft(fav.name); done.current = false; saving.current = false; session.current += 1; } }, [renaming]);
  if (renaming) {
    const save = () => {
      if (done.current || saving.current) return;
      const v = draft.trim();
      if (!(v && v !== fav.name)) { done.current = true; onRenameCancel(); return; }
      saving.current = true;
      const mine = session.current;
      void Promise.resolve(onRenameCommit(v)).then(ok => {
        if (session.current !== mine) return;             // a later session owns the chip now
        saving.current = false;
        if (ok !== false) done.current = true;            // a refusal leaves it open for another try
      });
    };
    const cancel = () => { if (done.current) return; done.current = true; onRenameCancel(); };
    return (
      <span data-testid={`favourite-rename-${fav.favourite_id}`}
        onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) save(); }}
        onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } }}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: `1px solid ${T.line2}`, padding: '4px 8px', minHeight: 44 }}>
        <input className="textbox" value={draft} onChange={e => setDraft(e.currentTarget.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
          aria-label={`rename ${fav.name}`} maxLength={NAME_MAX}
          style={{ font: F.chk(700, 14), minWidth: 120, borderBottomColor: T.line2 }} />
        {/* onMouseDown preventDefault: Safari and Firefox on macOS do not focus a clicked button, so without it the
            input's blur (relatedTarget null) saves BEFORE the click, and ✕ would save the name it should cancel */}
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={save} aria-label="save rename" className="hit44"
          style={{ ...BTN_RESET, cursor: 'pointer', color: T.ok, padding: '0 8px', minHeight: 44 }}>✓</button>
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={cancel} aria-label="cancel rename" className="hit44"
          style={{ ...BTN_RESET, cursor: 'pointer', color: T.micro, padding: '0 8px', minHeight: 44 }}>✕</button>
      </span>
    );
  }
  if (confirmingDelete) {
    return (
      <span data-testid={`favourite-confirm-delete-${fav.favourite_id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${T.bad}`, padding: '4px 8px', minHeight: 44 }}>
        <span style={{ font: F.chk(700, 12), color: T.bad, letterSpacing: '.04em' }}>DELETE {fav.name.toUpperCase()}?</span>
        <GhostButton size={12} pad="8px 10px" color={T.bad} border={T.bad} onClick={onDeleteConfirm}>CONFIRM</GhostButton>
        <GhostButton size={12} pad="8px 10px" onClick={onDeleteCancel}>CANCEL</GhostButton>
      </span>
    );
  }
  return (
    <span data-testid={`favourite-chip-${fav.favourite_id}`} style={{ display: 'inline-flex', alignItems: 'center', border: `1px solid ${T.line2}` }}>
      <button type="button" className="hit44" onClick={onLoad} title={`Load ${fav.name}`}
        style={{ ...BTN_RESET, font: F.chk(700, 14), letterSpacing: '.04em', padding: '10px 4px 10px 12px', cursor: 'pointer', color: T.acc, minHeight: 44 }}>
        ☆ {fav.name}
      </button>
      <button type="button" onClick={onRenameStart} aria-label={`rename ${fav.name}`} title="Rename" className="hit44"
        style={{ ...BTN_RESET, cursor: 'pointer', color: T.micro, padding: '0 8px', minHeight: 44 }}>✎</button>
      <button type="button" onClick={onDeleteStart} aria-label={`delete ${fav.name}`} title="Delete" className="hit44"
        style={{ ...BTN_RESET, cursor: 'pointer', color: T.micro, padding: '0 10px', minHeight: 44 }}>✕</button>
    </span>
  );
}
