// F411 BUILD: the preset editor (docs/spec/design/games-presets.md §5, docs/spec/design/games-redesign.md
// §1-§3). "On BUILD you create the presets. On PLAY you pick the presets." BUILD never starts a game —
// every action here writes a named GamePiece for PLAY to offer later, never the running config.
//
// Rendered for the `designer` view (replaces the old five-part GAME DESIGNER scroll, brief §2: "one
// deep-edit surface, not two"). `◂ BACK TO PLAY` is `setView('build')` — the phase named `build` IS the
// PLAY step (formerly GAMES).
import { useCallback, useEffect, useState } from 'react';
import type {
  GamePiece, LifePiece, MiscLoadoutsPiece, PerkView, PieceKind, Respawn, SlotRule, WeaponView,
} from '../api/contract.gen';
import { viewLabel } from '../frame/CommandBar';
import { useStore } from '../store';
import { F, T } from '../tokens';
import { GhostButton, PrimaryButton, ScreenHeader, SectionRule, Shelf } from '../ui';
import { pickFallbackNote } from './pieceFallbackNote';
import { KIND_TABS } from './presets/kinds';
import { draftOf, isDirty, MAX_NOTE, proposeCopyName, slotNeedsFixedItem, type PieceDraft } from './presets/helpers';
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

interface Editing {
  base: GamePiece;
  action: 'create' | 'edit';
  initial: PieceDraft;
  draft: PieceDraft;
}

export function Build() {
  const { api, run, setView, weapons, perks, state, connected, setDirty, navBlockedTo, clearNavBlock } = useStore();
  const [pieces, setPieces] = useState<GamePiece[] | null>(null);
  const [stale, setStale] = useState(false);
  // Polish round 1 H3: a `GET /api/pieces` failure that is NOT the older-console 404 used to fall
  // through silently, leaving `pieces` null for ever and the shelf stuck on "LOADING…" with nothing an
  // operator could do about it. Mirrors `Games.tsx`'s own `piecesError`/`retryTick` pair exactly.
  const [piecesError, setPiecesError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [kind, setKind] = useState<PieceKind>('mode');
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  // MEDIUM 3 (review follow-up): a value-changing SAVE on a picked piece can fall an INHERITED,
  // unrelated kind back to its builtin (`resolvePiecesMixed`, the same mechanism PLAY's own pick()
  // reports) -- shown the same way PLAY shows it (pieceFallbackNote.ts, shared with Games.tsx).
  const [fallbackNote, setFallbackNote] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    try {
      const p = await api.getPieces();
      setPieces(p);
      setStale(false);
      setPiecesError(null);
    } catch (e) {
      if ((e as { status?: number }).status === 404) { setStale(true); setPiecesError(null); }
      else setPiecesError((e as Error)?.message || 'could not load the game pieces');
    }
  }, [api]);
  // `connected` retries on a real reconnect (mock mode holds it true); `retryTick` is the RETRY control.
  useEffect(() => { load(); }, [load, connected, retryTick]);

  const list = (pieces ?? []).filter(p => p.kind === kind);
  useEffect(() => {
    if (!list.length) { setSelected(null); return; }
    if (!selected || !list.some(p => p.piece_id === selected)) setSelected(list[0].piece_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, pieces]);

  const meta = KIND_TABS.find(t => t.kind === kind)!;
  const dirty = editing ? isDirty(editing.draft, editing.initial) : false;
  // Polish round 1 M6: this used to gate ONLY BUILD's own back button and its kind tabs -- the
  // CommandBar stepper (and anything else that calls the store's `setView`) reached straight past it,
  // silently discarding an unsaved edit. `dirty` is mirrored into the store, whose `setView` now blocks
  // EVERY navigation attempt the same way (store.tsx); `navBlockedTo` comes back non-null while blocked,
  // so the SAME inline banner below covers both paths.
  useEffect(() => { setDirty(dirty); return () => setDirty(false); }, [dirty, setDirty]);
  // Round 2 Low: a further edit while a nav attempt is already blocked (`navBlockedTo` showing its
  // banner) makes that pending "tap again to leave" stale -- it was about the draft as it stood a
  // moment ago. `editing?.draft` gets a new object identity on every `setDraft` call, so this fires on
  // each keystroke while an editor is open, and is a no-op the rest of the time.
  useEffect(() => { clearNavBlock(); }, [editing?.draft, clearNavBlock]);
  // QA-14 (visual QA round 1): FIXED with no item picked used to reach SAVE and come back as the
  // server's own field name. `SlotFields` preselects the first catalogue item the moment FIXED is
  // chosen, so this only bites an editor opened on an empty catalogue — belt and braces, not the
  // primary defence.
  const isSlotKind = kind === 'primary' || kind === 'secondary' || kind === 'perks';
  const slotDraft = isSlotKind && editing ? (editing.draft.value as unknown as SlotRule) : null;
  const fixedNeedsItem = !!slotDraft && slotNeedsFixedItem(slotDraft.choice, slotDraft.fixed_id);

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
    // Round 2 (1): this confirmed tap must actually leave. `dirty` (this render's value) has not
    // reached the store yet -- the effect below only fires after this handler returns -- so `setView`
    // would still see the OLD (true) value and block a THIRD time. Clear it here first.
    setDirty(false);
    setView('build');
  };

  const setDraft = (patch: Partial<PieceDraft>) => setEditing(e => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));

  // MEDIUM 3 (review follow-up): SAVE used to send `value` unconditionally, even for a plain rename --
  // on a PICKED piece, that recomposes the config exactly as if the value HAD changed (the server
  // cannot tell "sent but identical" from "sent and changed" either), overwriting whatever a KIT/LOBBY
  // inline edit had done since and re-pushing every gun for a rename. Only send it when it actually
  // differs from what the editor opened on.
  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setFallbackNote(null);
    try {
      const valueChanged = JSON.stringify(editing.draft.value) !== JSON.stringify(editing.initial.value);
      const saved = editing.action === 'create'
        ? await run(() => api.createPiece({ kind, name: editing.draft.name, note: editing.draft.note, value: editing.draft.value }))
        : await run(async () => {
            const r = await api.updatePiece(editing.base.piece_id, {
              name: editing.draft.name, note: editing.draft.note,
              ...(valueChanged ? { value: editing.draft.value } : {}),
            });
            // `ok`/`errors` only ride the reply when `value` reached a recompose (a name/note-only
            // save never gets them at all) -- an explicit `=== false` check, never a bare `!r.ok`,
            // since `undefined` here means "nothing to recompose", not "refused".
            if (r.ok === false) throw Object.assign(new Error(r.errors?.join(' · ') || 'save refused'), { status: 400 });
            return r;
          });
      if (!saved) return;   // run() already put the server's words in the error strip
      const savedFallbacks = (saved as { fallbacks?: PieceKind[] }).fallbacks ?? [];
      setFallbackNote(pickFallbackNote(savedFallbacks, pieces ?? []));
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

  // QA-13 (visual QA round 1): a NEW copy's `base` is the built-in it was copied FROM, so comparing
  // against `editing.base.piece_id` read "IN USE" on a piece that has never even been saved yet.
  // Only an `edit` session's base is the piece actually being edited.
  const inUse = editing && editing.action === 'edit' && !!state?.game_pick && state.game_pick.pieces[kind] === editing.base.piece_id;
  const spawnBuiltins = (pieces ?? []).filter(p => p.kind === 'spawn' && p.builtin);
  const primaryCat = weaponCatalogue(weapons, 'primary');
  const secondaryCat = weaponCatalogue(weapons, 'secondary');
  const perkCat = perkCatalogue(perks);

  return (
    // QA-27 (visual QA round 1): BUILD used to cap at 1100px while PLAY (Games.tsx) has no cap at
    // all -- one screen looked narrow next to the other for no reason. Match PLAY: no cap here either.
    <div style={{ padding: '24px 28px 60px' }}>
      <ScreenHeader kicker="[ BUILD ]" title="BUILD" right={<GhostButton onClick={backToPlay}>◂ BACK TO PLAY</GhostButton>} />
      <p style={{ font: F.chk(500, 12), color: T.dim, margin: '0 0 20px', maxWidth: 640 }}>
        BUILD CREATES PRESETS. PLAY PICKS THEM.
      </p>

      {/* Review Low: gated on `connected` the same way Games.tsx's own sibling banner is now -- a
          stale piecesError must not flash on every reconnect blip while the console is already saying
          MC_OFFLINE elsewhere. */}
      {piecesError && connected && (
        <div role="alert" data-alert="build-pieces-error" data-testid="build-pieces-error"
          style={{ font: F.chk(600, 12), letterSpacing: '.02em', color: T.warn, border: `1px solid ${T.warn}`,
            padding: '10px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>▲ COULD NOT LOAD THE GAME PIECES: {piecesError}</span>
          <span data-testid="build-pieces-retry">
            <GhostButton size={14} pad="8px 14px" color={T.ink} border={T.warn} onClick={() => setRetryTick(t => t + 1)}>RETRY ▸</GhostButton>
          </span>
        </div>
      )}

      {fallbackNote && (
        <div data-testid="build-fallback-note" role="status" style={{ display: 'flex', flexDirection: 'column', gap: 2, font: F.chk(600, 12), color: T.warn, marginBottom: 16 }}>
          {fallbackNote.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}

      <div role="tablist" aria-label="preset kind" style={{ display: 'flex', flexWrap: 'wrap', gap: 2, borderBottom: `1px solid ${T.line}`, marginBottom: 18 }}>
        {KIND_TABS.map(t => (
          <button key={t.kind} type="button" role="tab" aria-selected={kind === t.kind} data-testid={`build-tab-${t.kind}`}
            onClick={() => { if (editing && dirty && !confirmLeave) { setConfirmLeave(true); return; } setEditing(null); setConfirmLeave(false); setFallbackNote(null); setKind(t.kind); }}
            style={{ background: 'none', border: 'none', borderBottom: `2px solid ${kind === t.kind ? T.acc : 'transparent'}`,
              color: kind === t.kind ? T.ink : T.micro, font: F.chk(700, 11), letterSpacing: '.16em', padding: '10px 14px', minHeight: 44, cursor: 'pointer' }}>
            {t.label}
          </button>
        ))}
      </div>

      {(confirmLeave || navBlockedTo) && (
        <div role="status" data-testid="build-confirm-leave" style={{ font: F.chk(700, 11), letterSpacing: '.12em', color: T.warn, marginBottom: 12 }}>
          {/* Round 2 (2): `navBlockedTo` covers a nav attempt from ANYWHERE (a CommandBar tab, browser
              back, or the server's own phase advancing under an unattended tab) -- naming what it is
              says what tapping again actually leaves for, which a bare "leave" does not. `confirmLeave`
              (BUILD's own kind-tab/back-button confirm) has no other view to name. */}
          ▲ UNSAVED CHANGES{navBlockedTo ? ` — TAP AGAIN TO LEAVE FOR ${viewLabel(navBlockedTo)} WITHOUT SAVING` : ' — TAP AGAIN TO LEAVE WITHOUT SAVING'}
        </div>
      )}

      {!editing && (
        <>
          <SectionRule label={`${meta.label} — PRESETS`} style={{ marginBottom: 12 }} />
          <Shelf>
            {list.map(p => (
              // QA-24 (visual QA round 1): a read-only tab (GAME MODE, GAMEPLAY) never has a NEW
              // button that reads `selected`, so a card highlighting as "selected" there was a
              // selection state with no effect -- short name + BUILT-IN tag only, no click at all.
              <PieceCard key={p.piece_id} piece={p} selected={!meta.readOnly && selected === p.piece_id}
                onSelect={meta.readOnly ? undefined : () => setSelected(p.piece_id)}
                onOpen={!meta.readOnly && !p.builtin ? () => openEdit(p) : undefined} />
            ))}
            {pieces === null && !piecesError && <span style={{ font: F.mono(500, 11), color: T.micro }}>LOADING…</span>}
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
              style={{ background: T.panelDeep, border: `1px solid ${T.acc}`, color: T.ink, font: F.osw(700, 22), letterSpacing: '.06em', padding: '6px 12px', width: 280, minHeight: 44, boxSizing: 'border-box' }} />
          </div>
          <div style={{ marginBottom: 16 }}>
            {/* QA-16 (visual QA round 1): 32px tall -- under the 44px floor */}
            <input className="textbox" aria-label="preset note" placeholder="ONE-LINE NOTE" value={editing.draft.note} maxLength={MAX_NOTE}
              onChange={e => setDraft({ note: e.target.value })}
              style={{ background: 'transparent', border: `1px solid ${T.line}`, color: T.dim, font: F.chk(500, 12), padding: '7px 12px', width: 420, maxWidth: '100%', minHeight: 44, boxSizing: 'border-box' }} />
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
            <PrimaryButton disabled={busy || !editing.draft.name.trim() || fixedNeedsItem} onClick={save}>SAVE ▸</PrimaryButton>
          </div>
        </div>
      )}
    </div>
  );
}
