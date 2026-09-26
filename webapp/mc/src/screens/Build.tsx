// F411 BUILD: the preset editor (docs/spec/design/games-presets.md §5, docs/spec/design/games-redesign.md
// §1-§3). "On BUILD you create the presets. On PLAY you pick the presets." BUILD never starts a game —
// every action here writes a named GamePiece for PLAY to offer later, never the running config.
//
// Rendered for the `designer` view (replaces the old five-part GAME DESIGNER scroll, brief §2: "one
// deep-edit surface, not two"). `◂ BACK TO PLAY` is `setView('build')` — the phase named `build` IS the
// PLAY step (formerly GAMES).
import { useCallback, useEffect, useState } from 'react';
import type {
  GamePiece, LifePiece, MiscLoadoutsPiece, ModeInfo, PerkView, PieceKind, Respawn, SlotRule, WeaponView,
} from '../api/contract.gen';
import { useStore } from '../store';
import { F, T } from '../tokens';
import { GhostButton, PrimaryButton, ScreenHeader, SectionRule, Shelf } from '../ui';
import { KIND_TABS } from './presets/kinds';
import { draftOf, isDirty, MAX_NOTE, proposeCopyName, type PieceDraft } from './presets/helpers';
import { LifeFields, MiscLoadoutsFields, SlotFields, SpawnFields, type CatalogueRow } from './presets/editors';
import { PieceCard } from './presets/PieceCard';

const weaponCatalogue = (weapons: WeaponView[], slot: 'primary' | 'secondary'): CatalogueRow[] =>
  weapons.filter(w => !w.pickup_only)
    // PRIMARY excludes the sidearm role (no pistol is ever a primary) AND a `lethal: false` support
    // weapon (weapons.json's own placement rule -- a support weapon may never be a PRIMARY, so its
    // TYPE toggle and its FIXED ITEM list must never offer one there either).
    .filter(w => slot === 'secondary' || (w.role !== 'sidearm' && w.lethal !== false))
    .map(w => ({ id: w.weapon_id, name: w.name, types: w.types ?? [] }));
const perkCatalogue = (perks: PerkView[]): CatalogueRow[] =>
  perks.filter(p => !p.hidden).map(p => ({ id: p.perk_id, name: p.name }));

/** GAME MODE's read-only cards get a description line from the mode catalogue when the piece's own
 *  note is blank — the piece is the source of truth, this is only a fallback (brief §9's "derived from
 *  real behaviour, never invented" applies to the note text too). */
const modeSubtitle = (piece: GamePiece, modes: ModeInfo[]): string | undefined => {
  const m = modes.find(x => x.mode === (piece.value as { mode?: string }).mode);
  return m?.brief || m?.desc;
};

interface Editing {
  base: GamePiece;
  action: 'create' | 'edit';
  initial: PieceDraft;
  draft: PieceDraft;
}

export function Build() {
  const { api, run, setView, weapons, perks, modes, state } = useStore();
  const [pieces, setPieces] = useState<GamePiece[] | null>(null);
  const [stale, setStale] = useState(false);
  const [kind, setKind] = useState<PieceKind>('mode');
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await api.getPieces();
      setPieces(p);
      setStale(false);
    } catch (e) {
      if ((e as { status?: number }).status === 404) setStale(true);
    }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const list = (pieces ?? []).filter(p => p.kind === kind);
  useEffect(() => {
    if (!list.length) { setSelected(null); return; }
    if (!selected || !list.some(p => p.piece_id === selected)) setSelected(list[0].piece_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, pieces]);

  const meta = KIND_TABS.find(t => t.kind === kind)!;
  const dirty = editing ? isDirty(editing.draft, editing.initial) : false;

  const openCreate = (base: GamePiece) => setEditing({ base, action: 'create',
    initial: { name: proposeCopyName(base.name), note: base.note, value: base.value },
    draft: { name: proposeCopyName(base.name), note: base.note, value: base.value } });
  const openEdit = (p: GamePiece) => setEditing({ base: p, action: 'edit', initial: draftOf(p), draft: draftOf(p) });

  const closeEditor = () => {
    if (dirty && !confirmLeave) { setConfirmLeave(true); return; }
    setEditing(null); setConfirmLeave(false); setConfirmDelete(false);
  };
  const backToPlay = () => {
    if (editing && dirty && !confirmLeave) { setConfirmLeave(true); return; }
    setEditing(null); setConfirmLeave(false); setConfirmDelete(false);
    setView('build');
  };

  const setDraft = (patch: Partial<PieceDraft>) => setEditing(e => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const saved = editing.action === 'create'
        ? await run(() => api.createPiece({ kind, name: editing.draft.name, note: editing.draft.note, value: editing.draft.value }))
        : await run(() => api.updatePiece(editing.base.piece_id, { name: editing.draft.name, note: editing.draft.note, value: editing.draft.value }));
      if (!saved) return;   // run() already put the server's words in the error strip
      setEditing(null); setConfirmLeave(false); setConfirmDelete(false);
      await load();
      setSelected(saved.piece_id);
    } finally { setBusy(false); }
  };

  const del = async () => {
    if (!editing) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setBusy(true);
    try {
      const ok = await run(async () => { await api.deletePiece(editing.base.piece_id); return true; });
      if (!ok) return;
      setEditing(null); setConfirmDelete(false);
      await load();
    } finally { setBusy(false); }
  };

  if (stale) {
    return (
      <div style={{ padding: 40 }}>
        <div role="alert" data-alert="build-stale-server" style={{ font: F.mono(600, 12), letterSpacing: '.14em', color: T.warn, border: `1px solid ${T.warn}`, padding: '14px 18px' }}>
          ▲ THE SERVER PREDATES THIS CONSOLE. RESTART MISSION CONTROL (./start.sh).
        </div>
      </div>
    );
  }

  const inUse = editing && !!state?.game_pick && state.game_pick.pieces[kind] === editing.base.piece_id;
  const spawnBuiltins = (pieces ?? []).filter(p => p.kind === 'spawn' && p.builtin);
  const primaryCat = weaponCatalogue(weapons, 'primary');
  const secondaryCat = weaponCatalogue(weapons, 'secondary');
  const perkCat = perkCatalogue(perks);

  return (
    <div style={{ padding: '24px 28px 60px', maxWidth: 1100 }}>
      <ScreenHeader kicker="[ BUILD ]" title="BUILD" right={<GhostButton onClick={backToPlay}>◂ BACK TO PLAY</GhostButton>} />
      <p style={{ font: F.chk(500, 12), color: T.dim, margin: '0 0 20px', maxWidth: 640 }}>
        BUILD CREATES PRESETS. PLAY PICKS THEM.
      </p>

      <div role="tablist" aria-label="preset kind" style={{ display: 'flex', flexWrap: 'wrap', gap: 2, borderBottom: `1px solid ${T.line}`, marginBottom: 18 }}>
        {KIND_TABS.map(t => (
          <button key={t.kind} type="button" role="tab" aria-selected={kind === t.kind} data-testid={`build-tab-${t.kind}`}
            onClick={() => { if (editing && dirty && !confirmLeave) { setConfirmLeave(true); return; } setEditing(null); setConfirmLeave(false); setKind(t.kind); }}
            style={{ background: 'none', border: 'none', borderBottom: `2px solid ${kind === t.kind ? T.acc : 'transparent'}`,
              color: kind === t.kind ? T.ink : T.micro, font: F.chk(700, 11), letterSpacing: '.16em', padding: '10px 14px', minHeight: 44, cursor: 'pointer' }}>
            {t.label}
          </button>
        ))}
      </div>

      {confirmLeave && (
        <div role="status" data-testid="build-confirm-leave" style={{ font: F.chk(700, 11), letterSpacing: '.12em', color: T.warn, marginBottom: 12 }}>
          ▲ UNSAVED CHANGES — TAP AGAIN TO LEAVE WITHOUT SAVING
        </div>
      )}

      {!editing && (
        <>
          <SectionRule label={`${meta.label} — PRESETS`} style={{ marginBottom: 12 }} />
          <Shelf>
            {list.map(p => (
              <PieceCard key={p.piece_id} piece={p} selected={selected === p.piece_id} subtitle={kind === 'mode' ? modeSubtitle(p, modes) : undefined}
                onSelect={() => setSelected(p.piece_id)} onOpen={!meta.readOnly && !p.builtin ? () => openEdit(p) : undefined} />
            ))}
            {pieces === null && <span style={{ font: F.mono(500, 11), color: T.micro }}>LOADING…</span>}
          </Shelf>
          {!meta.readOnly && (
            <div style={{ marginTop: 16 }}>
              <PrimaryButton disabled={!selected} onClick={() => { const base = list.find(p => p.piece_id === selected); if (base) openCreate(base); }}>NEW ▸</PrimaryButton>
            </div>
          )}
        </>
      )}

      {editing && (
        <div>
          <GhostButton onClick={closeEditor}>◂ BACK TO {meta.label}</GhostButton>
          <div style={{ marginTop: 14, marginBottom: 16 }}>
            <input className="textbox" aria-label="preset name" value={editing.draft.name} maxLength={24}
              onChange={e => setDraft({ name: e.target.value.toUpperCase() })}
              style={{ background: T.panelDeep, border: `1px solid ${T.acc}`, color: T.ink, font: F.osw(700, 22), letterSpacing: '.06em', padding: '6px 12px', width: 280 }} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <input className="textbox" aria-label="preset note" placeholder="ONE-LINE NOTE" value={editing.draft.note} maxLength={MAX_NOTE}
              onChange={e => setDraft({ note: e.target.value })}
              style={{ background: 'transparent', border: `1px solid ${T.line}`, color: T.dim, font: F.chk(500, 12), padding: '7px 12px', width: 420, maxWidth: '100%' }} />
          </div>

          {kind === 'life' && <LifeFields value={editing.draft.value as unknown as LifePiece} onChange={v => setDraft({ value: v as unknown as Record<string, unknown> })} />}
          {kind === 'spawn' && <SpawnFields value={editing.draft.value as unknown as Respawn} onChange={v => setDraft({ value: v as unknown as Record<string, unknown> })} builtins={spawnBuiltins} />}
          {kind === 'primary' && <SlotFields slotKind="primary" offAllowed={false} catalogue={primaryCat}
            value={editing.draft.value as unknown as SlotRule} onChange={v => setDraft({ value: v as unknown as Record<string, unknown> })} />}
          {kind === 'secondary' && <SlotFields slotKind="secondary" offAllowed catalogue={secondaryCat}
            value={editing.draft.value as unknown as SlotRule} onChange={v => setDraft({ value: v as unknown as Record<string, unknown> })} />}
          {kind === 'perks' && <SlotFields slotKind="perks" offAllowed catalogue={perkCat}
            value={editing.draft.value as unknown as SlotRule} onChange={v => setDraft({ value: v as unknown as Record<string, unknown> })} />}
          {kind === 'misc_loadouts' && <MiscLoadoutsFields value={editing.draft.value as unknown as MiscLoadoutsPiece} onChange={v => setDraft({ value: v as unknown as Record<string, unknown> })} />}

          {inUse && (
            <p style={{ font: F.chk(600, 11), letterSpacing: '.1em', color: T.warn, marginTop: 14 }}>
              IN USE: PICK ANOTHER ON PLAY FIRST TO DELETE THIS
            </p>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
            {editing.action === 'edit' && (
              confirmDelete
                ? <>
                    <GhostButton color={T.bad} border={T.bad} disabled={busy} onClick={del}>CONFIRM DELETE</GhostButton>
                    <GhostButton disabled={busy} onClick={() => setConfirmDelete(false)}>CANCEL</GhostButton>
                  </>
                : <GhostButton color={T.bad} border={T.line} disabled={busy || !!inUse} onClick={del}>DELETE</GhostButton>
            )}
            <PrimaryButton disabled={busy || !editing.draft.name.trim()} onClick={save}>SAVE ▸</PrimaryButton>
          </div>
        </div>
      )}
    </div>
  );
}
