// PLAY (F411 rewrite, docs/spec/design/games-presets.md + games-redesign.md): BUILD creates presets,
// PLAY only picks among them, then LOADs. Rewritten from the old GAMES card-shelf/mode-tile screen,
// which is retired along with the GAME DESIGNER it opened (BUILD, screens/Build.tsx, replaces both).
//
// The rule this screen exists to keep: PLAY never edits a preset, never leaves a "tuned, not saved"
// draft, and never shows the guns' own state (that is LOBBY's job — "GUNS READY n/n").
//
// VQA round 1 (2026-09-26, docs/spec/design storyboard Proposal A frames 05/06/09/10/12): the layout
// below follows the storyboard directly — pickers in one wrapping row (a label above a Seg group, not
// a full-width bar each), the MATCH SETTINGS strip as one bordered row with no per-control caption
// (each control's own value already names it), LOAD under the strip, right-aligned.
import { FaultPill, ItemChip, HelpNote } from '../ui/Compact';
import { useEffect, useRef, useState } from 'react';
import { StationAlerts } from '../ui/StationAlerts';
import { STATION_CONFLICT, friendlySetupLine, setupLines } from '../ui/SetupSteps';
import { CONFIG_ERRORS_ALERT_ID } from '../api/derive';
import type { Favourite, GamePick, GamePiece, HillSettings, MatchSettings, PieceKind, TeamColour } from '../api/types';
import { setNotice } from '../notice';
import { useStore } from '../store';
import { F, T } from '../tokens';
import { BTN_RESET, GhostButton, PrimaryButton, Seg, SEG_PAD_44, useFlashOnChange } from '../ui';
import { LoadError } from '../ui/LoadError';
import { useResource } from '../ui/useResource';
import { serverLine } from '../alerts';
import { emptyRequiredSlots, poolEmptyMessage } from './gameSummary';
import { hillCount, operatorNote } from './operatorNote';
import { kindLabel } from './presets/kinds';
import { pickFallbackNote } from './pieceFallbackNote';
import { getRunway, setRunway, useRunway } from '../runway';
import { markPristine, picksDirty, seedBaseline } from '../playBaseline';
import { FavouriteChip } from './games/FavouriteChip';
import { matchItems } from './matchItems';
import { ModeMark, MatchItem } from './games/match';

/** F411 games-presets.md §5: PLAY's picker order. GAMEPLAY is always hidden for MVP (§3/§13/§15). */
const PICKER_ORDER: Exclude<PieceKind, 'gameplay'>[] = ['mode', 'life', 'spawn', 'primary', 'secondary', 'perks', 'misc_loadouts'];
// Polish round 1 Low: this duplicated BUILD's own `kindLabel` (screens/presets/kinds.ts) under a
// second name with the same eight strings -- one table now, imported.

// F413 (games-presets.md §7): every team mode's own catalogue `defaults.teams` is red+blue now,
// matching the server (team-lead's scope decision, 2026-09-27; mock/data.ts's own `base()` and
// `MODES` comments have the full reasoning) -- ONE source of truth, so `pickMode`/`loadFavourite`
// below read it straight off `modes` again, the same way they did before F413.


/** the phases `POST /api/play/pick` (and `PUT /api/config`) accept in — same list `state.py` gates on.
 *  RECAP is editable too: any pick rolls the finished session forward first, roster and game kept. */
export const CONFIG_EDITABLE_PHASES = new Set(['muster', 'build', 'kit', 'lobby', 'recap']);
export function lockedReason(phase: string): string {
  if (phase === 'armed') return 'GAME SETTINGS ARE LOCKED: THE MATCH IS ARMED. ABORT ON THE MATCH TAB RETURNS IT TO THE LOBBY.';
  if (phase === 'live') return 'GAME SETTINGS ARE LOCKED: THE MATCH IS LIVE. END OR RECALL IT ON THE MATCH TAB TO EDIT THE GAME AGAIN.';
  return `GAME SETTINGS ARE LOCKED: THE MATCH IS ALREADY IN ${phase.toUpperCase()}.`;
}

export function Games() {
  const { state, api, run, setView, enterPhase, openBuild, setFocusHill, connected, modes } = useStore();
  // A failed pieces request stays visible until a retry succeeds (useResource keeps the last good list).
  const piecesRes = useResource<GamePiece[]>(() => api.getPieces(), [], [], 'could not load the game pieces');
  const pieces = piecesRes.data;
  const [busy, setBusy] = useState(false);
  const [runwayVal] = useRunway();
  const seenPick = state?.game_pick;
  useEffect(() => { if (seenPick) seedBaseline(seenPick, runwayVal); }, [seenPick, runwayVal]);

  // ---- F411 §6 FAVOURITES: a named bundle of the whole PLAY pick, like a named LAST MATCH ---------
  // A failed favourites request must not look like an empty shelf. `reload` re-syncs the shelf after a save,
  // a rename or a delete, and resolves once it has.
  const favouritesRes = useResource<Favourite[]>(() => api.getFavourites(), [], [], 'could not load favourites', { skipOffline: true });
  const favourites = favouritesRes.data;
  const refreshFavourites = favouritesRes.reload;
  const [savingFav, setSavingFav] = useState(false);
  const [favNameDraft, setFavNameDraft] = useState('');
  const [renamingFav, setRenamingFav] = useState<string | null>(null);
  const [confirmDeleteFav, setConfirmDeleteFav] = useState<string | null>(null);
  // Bench 2026-09-28 (Tony): the favourite waiting on "DISCARD YOUR CHANGES?" (playBaseline.ts).
  const [favDiscard, setFavDiscard] = useState<string | null>(null);
  // Polish 2026-09-28: the question takes focus when it appears, so a keyboard operator's next key acts
  // on DISCARD / CANCEL, not on the tapped chip's own rename or delete buttons.
  const discardRef = useRef<HTMLDivElement>(null);
  const discardOpener = useRef<HTMLElement | null>(null);   // the chip that asked, to hand focus back to
  useEffect(() => { if (favDiscard) discardRef.current?.querySelector('button')?.focus(); }, [favDiscard]);
  const closeDiscard = () => { setFavDiscard(null); discardOpener.current?.focus(); discardOpener.current = null; };
  // Bench 2026-09-28: the GAME MODE card that just became selected flashes (ui `useFlashOnChange`).
  const modeGroupRef = useRef<HTMLSpanElement>(null);
  useFlashOnChange(modeGroupRef, state?.game_pick?.pieces.mode, '[aria-pressed="true"]');
  const [fallbackNote, setFallbackNote] = useState<string[] | null>(null);
  // Polish round 1 Low: guards SAVE AS A FAVOURITE against a double submit (declared up here with
  // every other hook -- a hook after the `if (!state) return null` below breaks the rules of hooks).
  const [submittingFav, setSubmittingFav] = useState(false);
  // Bench 2026-09-28 (Tony, "just change the choices, don't make me read warnings"): a mode pick and a
  // TEAMS change apply at once, no confirm. The server keeps each player's side (a same-count change
  // recolours by index; a count change splits evenly). A FAVOURITE load still asks first.

  if (!state) return null;
  const cfg = state.config;
  const pick = state.game_pick;
  // A restored snapshot can lack a game pick. Keep the screen usable around that old data.
  const missingPick = !pick;

  const locked = !CONFIG_EDITABLE_PHASES.has(state.phase);
  const poolEmpty = emptyRequiredSlots(state.loadout_pool);
  const poolEmptyReason = poolEmpty.any
    ? [poolEmpty.primary && poolEmptyMessage('PRIMARY', state.loadout_pool.reasons!.primary!, null, cfg.loadout_policy?.primary?.choice === 'fixed'),
       poolEmpty.secondary && poolEmptyMessage('SECONDARY', state.loadout_pool.reasons!.secondary_weapons!, null, cfg.loadout_policy?.secondary?.choice === 'fixed'),
       poolEmpty.perk && poolEmptyMessage('PERK', state.loadout_pool.reasons!.perks!)].filter(Boolean).join(' ')
    : '';
  // games-redesign.md §8: KOTH needs a hill station assigned in ARMORY — never a dead end.
  const kothNoHill = cfg.mode === 'koth' && !(state.stations ?? []).some(s => s.assigned?.kind === 'control');
  // VQA QA-19: a real fault (locked, or an empty required slot) is red; KOTH-with-no-hill-yet is a
  // setup step, not a fault, so it gets its own amber block instead of sharing the red one.
  const realFault = locked || poolEmpty.any;
  const blocked = realFault || kothNoHill;
  const realFaultReason = locked ? lockedReason(state.phase) : poolEmptyReason;

  // "SPAWN — ITS SAVED PICK IS GONE, USING AUTO" (games-presets.md §6) needs the OLD piece's name,
  // which a fallback means we no longer have -- say what it is USING instead, always true, never
  // invented.
  const favouriteFallbackNote = (fallbacks: PieceKind[], pick: GamePick): string[] | null => (fallbacks.length
    ? fallbacks.map(k => `${kindLabel(k)} — ITS SAVED PICK IS GONE, USING ${pieces.find(p => p.piece_id === pick.pieces[k])?.name ?? 'ITS DEFAULT'}`)
    : null);
  // Round 3: a PICK fallback (round 2, server review: a kind the request did not itself name, e.g. a
  // post-MVP mode set on KIT, falls back to its builtin) is a DIFFERENT story from a favourite's own
  // fallback above -- there is no "saved pick" here that went missing, so "ITS SAVED PICK IS GONE"
  // said something that never happened. Worded separately (pieceFallbackNote.ts, shared with Build.tsx's
  // own SAVE, review follow-up), naming where the value actually came from.
  const pickFallback = (fallbacks: PieceKind[]) => pickFallbackNote(fallbacks, pieces);
  // Polish round 1 Low: a fallback note used to sit on screen until the NEXT favourite load, surviving
  // every ordinary tap in between and describing a load that was no longer the reason anything on
  // screen looked the way it did.
  const pickPiece = (kind: PieceKind, piece_id: string) => { setFallbackNote(null); setFavDiscard(null); return run(() => api.pick({ pieces: { [kind]: piece_id } }))
    .then(r => { if (!r) return; if (!r.ok) { setNotice(r.errors.join(' · '), true); return; } setFallbackNote(pickFallback(r.fallbacks)); }); };
  const pickMatch = (patch: Partial<MatchSettings>) => { setFallbackNote(null); setFavDiscard(null); return run(() => api.pick({ match: patch }))
    .then(r => { if (!r) return; if (!r.ok) { setNotice(r.errors.join(' · '), true); return; } setFallbackNote(pickFallback(r.fallbacks)); }); };
  const pickMode = (p: GamePiece) => pickPiece('mode', p.piece_id);
  const pickTeams = (teams: TeamColour[]) => pickMatch({ teams });

  const load = async () => {
    if (busy) return;
    setBusy(true);
    try { await run(() => api.loadGame()); } finally { setBusy(false); }
  };
  // VQA QA-01: after LOAD succeeds nothing on screen said so, and LOAD stayed the only control — an
  // operator could not tell it had worked, or press on. `state.game.loaded` is that fact.
  const loaded = !!state.game?.loaded;
  const gameSent = state.game?.sent ?? 0;
  const gameTotal = state.game?.total ?? state.players.length;
  // Polish round 1 H1: `setPhase` used to be navigated PAST regardless of what it answered -- a refused
  // A27 not-ready guard (409) still landed on KIT, showing a screen for a phase the server never moved
  // to. Also a `busy` guard: a second tap before the first round-trip lands used to fire the request twice.
  const continueToKit = async () => {
    if (busy) return;
    setBusy(true);
    try { const r = await run(() => api.setPhase('kit')); if (r) enterPhase('kit'); } finally { setBusy(false); }
  };

  const assignAHill = () => { setFocusHill(true); setView('muster'); };

  // ---- FAVOURITES actions (games-presets.md §6) ----------------------------------------------------
  // Polish round 1 Low: `submittingFav` (declared above, with the other hooks) guards against a
  // double Enter/click firing two `createFavourite` calls, the second landing as the 409 "already
  // exists" refusal for what looked like one tap. `runwayVal` no longer needs snapping here (round 2):
  // `setRunway` itself snaps now, so the screen and the saved favourite already agree.
  const saveFavourite = async (name: string) => {
    if (submittingFav) return;
    setSubmittingFav(true);
    try {
      const r = await run(() => api.createFavourite({ name, countdown_s: runwayVal }));
      if (r) { setSavingFav(false); setFavNameDraft(''); if (pick) markPristine(pick, runwayVal); await refreshFavourites(); }
    } finally { setSubmittingFav(false); }
  };
  const renameFavourite = async (id: string, name: string): Promise<boolean> => {
    const r = await run(() => api.updateFavourite(id, { name }));
    if (r) { setRenamingFav(null); await refreshFavourites(); }
    return !!r;   // the chip stays in rename mode on a refusal and must accept another try (DRY #10 review)
  };
  const deleteFavourite = async (id: string) => {
    await run(() => api.deleteFavourite(id));
    setConfirmDeleteFav(null);
    await refreshFavourites();   // harmless even on a refused delete — just re-syncs the shelf
  };
  const doLoadFavourite = async (id: string) => {
    const r = await run(() => api.loadFavourite(id));
    if (!r) return;
    // Polish round 1 H2: `ok: false` is a REFUSED load (a bench-gate refusal, same as any other pick) --
    // the mock changes nothing behind it (backend.ts's own "ok:false changes nothing" rule), so the
    // console must not either. This used to apply the runway and the fallback note regardless, showing
    // a countdown and a fallback list for a favourite that was never actually loaded.
    if (!r.ok) { setNotice(r.errors.join(' · '), true); return; }
    setRunway(r.countdown_s);
    markPristine(r.pick, getRunway());
    setFallbackNote(favouriteFallbackNote(r.fallbacks, r.pick));
  };
  // Bench 2026-09-28 (Tony): a favourite loads in one tap, with no roster warning (the server keeps each
  // player's side on a same-count colour change and splits evenly on a count change). The one question
  // left guards lost work: over picks changed since the last load or save, "DISCARD YOUR CHANGES?".
  const loadFavourite = async (id: string) => {
    if (!favourites.some(f => f.favourite_id === id)) return;
    if (pick && picksDirty(pick, runwayVal)) {
      discardOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setFavDiscard(id);
      return;
    }
    setFavDiscard(null);
    await doLoadFavourite(id);
  };

  // ---- the operator note (games-redesign.md §9), derived off the composed config -----------------
  const note = operatorNote(cfg, hillCount(state.stations));

  // ---- the read-only PICKUPS line (§7): what ARMORY has armed, never edited here -----------------
  const pickupsLine = (state.stations ?? [])
    .filter(s => s.assigned?.kind === 'powerup' && s.assigned.item)
    .map(s => `${s.assigned!.item!.name} @ STATION ${s.assigned!.id}`)
    .join(' · ');

  const errorsAndWarnings = (
    <>
      {(state.config_warnings?.length ?? 0) > 0 && (
        <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {[...state.config_warnings!].filter(w => /LOADOUTS? RESET/i.test(w)).map((w, i) => (
            <ItemChip key={i} id="games-loadouts-reset" short="Loadouts reset" detail={w} />
          ))}
          {[...state.config_warnings!].filter(w => /HAS NOT SYNCED THE LAST MATCH/.test(w)).map((w, i) => {
            const line = serverLine(w, 'amber');
            return line.sev === 'red'
              ? <FaultPill key={`sync-${i}`} id={line.id} sev={line.sev} testid="games-station-not-synced" short="Station not synced" why={w} role="status" />
              : <ItemChip key={`sync-${i}`} id={line.id} sev={line.sev} testid="games-station-not-synced" short="Station not synced" detail={w} />;
          })}
          {setupLines(state.config_warnings).filter(w => STATION_CONFLICT.test(w)).map((w, i) => {
            const line = serverLine(w, 'amber');
            const isRespawnSetup = /NO RESPAWN STATION IS ASSIGNED/i.test(w);
            return (
              <div key={`setup-conflict-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                {line.sev === 'red'
                  ? <FaultPill id={line.id} sev={line.sev} testid="games-setup-line" short="Station conflict" why={w} role="status" />
                  : <ItemChip id={line.id} sev={line.sev} testid="games-setup-line" inline short={isRespawnSetup ? 'Respawn station missing' : 'Station conflict'} detail={w} />}
                {isRespawnSetup && (
                  <span data-testid="assign-a-respawn-station">
                    <GhostButton size={14} pad="8px 14px" color={T.ink} border={T.line2} onClick={() => setView('muster')}>ASSIGN A RESPAWN STATION ▸</GhostButton>
                  </span>
                )}
              </div>
            );
          })}
          {/* Non-conflict setup steps remain in the standing status region. */}
          {setupLines(state.config_warnings).filter(w => !STATION_CONFLICT.test(w)).map((w, i) => (
            <div key={`setup-step-${i}`} data-testid="games-setup-step" style={{ font: F.chk(500, 12), letterSpacing: '.02em', lineHeight: 1.5, color: T.body }}>
              {friendlySetupLine(w).toUpperCase()}
            </div>
          ))}
        </div>
      )}
      {state.config_errors.length > 0 && <FaultPill id={CONFIG_ERRORS_ALERT_ID} short="Game config error" why={state.config_errors.join(', ')} />}
    </>
  );

  return (
    <div className="screen">
      <StationAlerts unlockOnly />
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '14px 28px', marginBottom: 20 }}>
        <div>
          {/* VQA QA-20: the stepper's own step number is 02 — match it (was "A2"). */}
          <div style={{ font: F.mono(600, 11), letterSpacing: '.3em', color: T.acc }}>[ 02 // PLAY ]</div>
          <div style={{ font: F.osw(700, 30), letterSpacing: '.1em', textTransform: 'uppercase', marginTop: 2 }}>Pick Game</div>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
          <GhostButton size={14} onClick={openBuild}>BUILD ▸</GhostButton>
        </div>
      </div>

      {/* Review Low: while the console itself is known offline, a stale piecesError is not a NEW fact
          -- CommandBar's own MC_OFFLINE banner already says so, and this one used to flash on
          (in)/(out) with every reconnect blip instead of staying quiet until there is something new
          to report. */}
      {piecesRes.error && connected && (
        <LoadError id="games-pieces-error" testid="play-pieces-error" retryTestid="pieces-retry" what="THE GAME PIECES" error={piecesRes.error} onRetry={piecesRes.retry} />
      )}
      {favouritesRes.error && (
        <LoadError id="games-favourites-error" testid="play-favourites-error" retryTestid="favourites-retry" what="FAVOURITES" error={favouritesRes.error} onRetry={favouritesRes.retry} />
      )}

      {!missingPick && realFault && (
        <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <FaultPill id="games-locked-banner" testid="games-locked" short="Game settings locked" why={realFaultReason ?? ''} />
          {(state.phase === 'armed' || state.phase === 'live') && (
            <GhostButton size={14} pad="8px 14px" color={T.ink} border={T.line2} onClick={() => setView(state.phase)}>JUMP TO MATCH ▸</GhostButton>
          )}
        </div>
      )}
      {!missingPick && !realFault && kothNoHill && (
        <div data-testid="games-locked" style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <ItemChip id="games-koth-no-hill" inline short="No hill assigned"
            detail={<>King of the Hill needs one phone or Stick set as the hill, in ARMORY.
              {state.station_departures?.filter(d => d.kind === 'control').map(d =>
                <span key={d.node_id} data-testid="games-hill-departed" style={{ display: 'block', marginTop: 4 }}>{d.line}</span>)}</>} />
          <span data-testid="assign-a-hill">
            <GhostButton size={14} pad="8px 14px" color={T.ink} border={T.line2} onClick={assignAHill}>ASSIGN A HILL ▸</GhostButton>
          </span>
        </div>
      )}

      {pick && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* ---- FAVOURITES (games-presets.md §6): a named bundle of the whole pick, hidden when empty --- */}
          {favourites.length > 0 && (
            <fieldset disabled={locked} style={{ border: 'none', margin: 0, padding: 0, opacity: locked ? 0.5 : 1, display: 'contents' }}>
              <div data-testid="favourites-row" role="group" aria-label="favourites" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {favourites.map(f => (
                  <FavouriteChip key={f.favourite_id} fav={f}
                    renaming={renamingFav === f.favourite_id}
                    confirmingDelete={confirmDeleteFav === f.favourite_id}
                    onLoad={() => loadFavourite(f.favourite_id)}
                    onRenameStart={() => setRenamingFav(f.favourite_id)}
                    onRenameCommit={name => renameFavourite(f.favourite_id, name)}
                    onRenameCancel={() => setRenamingFav(null)}
                    onDeleteStart={() => setConfirmDeleteFav(f.favourite_id)}
                    onDeleteConfirm={() => deleteFavourite(f.favourite_id)}
                    onDeleteCancel={() => setConfirmDeleteFav(null)} />
                ))}
              </div>
            </fieldset>
          )}
          {favDiscard && (
            <div ref={discardRef} data-testid="favourite-discard" role="alertdialog" aria-label="discard your changes"
              onKeyDown={e => { if (e.key === 'Escape') closeDiscard(); }}
              style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ font: F.chk(700, 13), letterSpacing: '.12em', color: T.warn }}>
                ▲ DISCARD YOUR CHANGES?
              </span>
              <GhostButton size={13} pad="10px 16px" color={T.warn} border={T.warn}
                onClick={async () => {
                  const id = favDiscard, opener = discardOpener.current;
                  setFavDiscard(null); discardOpener.current = null;
                  await doLoadFavourite(id);
                  opener?.focus();   // back on the favourite, loaded or refused
                }}>DISCARD</GhostButton>
              <GhostButton size={13} pad="10px 16px" onClick={closeDiscard}>CANCEL</GhostButton>
            </div>
          )}
          {fallbackNote && (
            <div data-testid="favourite-fallback-note" role="status" style={{ display: 'flex', flexDirection: 'column', gap: 2, font: F.chk(600, 12), color: T.warn }}>
              {fallbackNote.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}

          {/* ---- the pickers, one wrapping row (§4's one-choice hiding rule: hidden with one piece) --- */}
          {/* VQA QA-07: every control here is a real HTML `disabled` (a fieldset), not merely a banner
              claiming it — while `locked`, nothing here can silently reach the server any more. */}
          <fieldset disabled={locked} style={{ border: 'none', margin: 0, padding: 0, opacity: locked ? 0.5 : 1,
            display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '20px 32px' }}>
            {PICKER_ORDER.map(kind => {
              // Round 3 (review): an `invalid` piece (a rule tightened under a stored value since it
              // was saved) is never offered here either -- same exclusion as post_mvp, and it does not
              // count toward the one-choice hiding rule.
              const options = pieces.filter(p => p.kind === kind && !p.post_mvp && !p.invalid);
              if (options.length <= 1) return null;
              const selected = pick.pieces[kind];
              return (
                // Bench 2026-09-28 (Tony): GAME MODE takes a whole row, so LIFE and SPAWN share the next one.
                <div key={kind} data-testid={`picker-${kind}`} style={{ display: 'flex', flexDirection: 'column', gap: 6, flexBasis: kind === 'mode' ? '100%' : undefined }}>
                  <div style={{ font: F.mono(600, 11), letterSpacing: '.22em', color: T.micro }}>{kindLabel(kind)}</div>
                  {kind === 'mode' ? (
                    // Tony, 2026-09-26: "on play mode picker would be great" -- each option carries its
                    // own mark, so this is a bespoke row (Seg has no per-option slot for one), styled to
                    // match it otherwise.
                    <span ref={modeGroupRef} role="group" aria-label="game mode" style={{ display: 'flex', flexWrap: 'wrap', alignSelf: 'flex-start', border: `1px solid ${T.line}` }}>
                      {options.map(p => {
                        const on = p.piece_id === selected;
                        const modeId = (p.value as { mode: string }).mode;
                        return (
                          <button key={p.piece_id} type="button" className="hit44" aria-pressed={on} title={p.note || p.name}
                            onClick={() => pickMode(p)}
                            style={{ ...BTN_RESET, font: F.chk(on ? 700 : 600, 15), letterSpacing: '.08em', padding: '10px 22px 10px 10px',
                              background: on ? T.panelAlt : 'transparent', color: on ? T.acc : T.micro,
                              boxShadow: on ? `inset 0 -2px 0 ${T.acc}` : undefined,
                              cursor: on ? 'default' : 'pointer', minHeight: 56, display: 'inline-flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap' }}>
                            <ModeMark mode={modeId} />
                            {p.name}
                          </button>
                        );
                      })}
                    </span>
                  ) : (
                    <Seg wrap size={14} label={kindLabel(kind).toLowerCase()} value={selected} pad={SEG_PAD_44}
                      options={options.map(p => ({ value: p.piece_id, label: p.name }))}
                      titles={Object.fromEntries(options.map(p => [p.piece_id, p.note || p.name]))}
                      onChange={id => pickPiece(kind, id)} />
                  )}
                  {kind === 'mode' && note.length > 0 && (
                    <HelpNote label="Mode notes" testid="operator-note" keep={note.map((l, i) => <span key={i} style={{ display: 'block' }}>{l}</span>)} />
                  )}
                </div>
              );
            })}
          </fieldset>

          {pickupsLine && (
            <div data-testid="pickups-line" style={{ font: F.mono(600, 11), letterSpacing: '.1em', color: T.dim }}>
              PICKUPS: {pickupsLine}
            </div>
          )}

          {/* ---- MATCH SETTINGS — not a picker, not a preset (games-redesign.md §5) ---- */}
          {/* team-lead 2026-09-26: rendered from a per-mode ITEM LIST (screens/matchItems.ts), not a
              fixed set here — F413 (TEAMS) and F415 (a KOTH hold target) each add one key there, never
              a rewrite of this strip. Every item wraps in its own `display: contents` fieldset, so
              disabling stays per-control while the flex row (and the outer dimming) treats them alike;
              an item's own EXTRAS (the manual link, the ON/OFF word) sit as siblings, never inside the
              fieldset, on the same rule as before (venue-mode-reminder.test.tsx). */}
          <div data-testid="match-settings" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 20,
            background: T.panel, border: `1px solid ${T.line}`, borderLeft: `3px solid ${T.acc}`, padding: '14px 18px',
            opacity: locked ? 0.5 : 1 }}>
            {matchItems(modes.find(m => m.mode === cfg.mode), cfg.scoring.win_by).map(key => (
              <MatchItem key={key} itemKey={key} pick={pick} locked={locked} runwayVal={runwayVal} pickMatch={pickMatch}
                mode={cfg.mode} currentTeams={cfg.teams.map(t => t.team_id as TeamColour)}
pickTeams={pickTeams} />
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
            {loaded && (
              <span data-testid="game-loaded-status" style={{ font: F.mono(600, 12), letterSpacing: '.12em', color: T.ok }}>
                LOADED · SENT {gameSent}/{gameTotal} PHONES
              </span>
            )}
            <fieldset disabled={locked} style={{ border: 'none', margin: 0, padding: 0 }}>
              {state.last_match && (
                <span data-testid="last-match">
                  {/* Polish round 1 M4: the runway used to be set (and the note treated as "applied")
                      before the pick round-trip had even answered -- a refused pick (e.g. a bench-gate
                      time_limit_s) still left the countdown control showing LAST MATCH's value with
                      the STRIP itself unchanged, disagreeing with each other on screen. */}
                  <GhostButton size={14} pad="10px 16px" onClick={async () => {
                    setFallbackNote(null);
                    const lm = state.last_match!;
                    // F413/F415: carry teams/hold_target_s forward too, same as the other four fields --
                    // but only where the CURRENT mode's own match_items still offers them (a last match
                    // played on a different mode may name a combination the mode on screen now refuses,
                    // e.g. 3 teams while KOTH is up; the mode row is the same authority the strip itself
                    // renders from, never guessed here).
                    const items = modes.find(m => m.mode === cfg.mode)?.match_items;
                    const patch: Partial<MatchSettings> = { time_limit_s: lm.time_limit_s, frag_limit: lm.frag_limit, night: lm.night, silenced: lm.silenced };
                    // Review MEDIUM (brx1, e8811fea): a last match with 3+ teams or a yellow pick, played
                    // on a mode that HAPPENS to share the 'teams' item (only KOTH today), is not just a
                    // combination this mode refuses -- it refuses the WHOLE pick, rolling back the other
                    // three fields too. KOTH is exactly 2, never yellow, so check that here rather than
                    // let the round-trip find out; the mode's own current teams stay put instead.
                    const kothLegal = cfg.mode !== 'koth' || (lm.teams != null && lm.teams.length === 2 && !lm.teams.includes('yellow'));
                    if (lm.teams && kothLegal && (!items || items.includes('teams'))) patch.teams = lm.teams;
                    if (lm.hold_target_s !== undefined && (!items || items.includes('hold'))) patch.hold_target_s = lm.hold_target_s;
                    // F559: a mode that offers the hill item gets the last match's hill EXPLICITLY, so a last match played at STATION
                    // DEFAULT clears the hill now in force (a null key clears that key; null clears both).
                    if (items?.includes('hill')) {
                      patch.hill = (lm.hill ? { capture_s: lm.hill.capture_s ?? null, net_cap: lm.hill.net_cap ?? null } : null) as unknown as HillSettings;
                    }
                    const r = await run(() => api.pick({ match: patch }));
                    if (r?.ok) { setRunway(lm.countdown_s); setFallbackNote(pickFallback(r.fallbacks)); }
                    else if (r) setNotice(r.errors.join(' · '), true);
                  }}>LAST MATCH ▸</GhostButton>
                </span>
              )}
              {savingFav ? (
                <span data-testid="save-favourite-form" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input className="textbox" value={favNameDraft} onChange={e => setFavNameDraft(e.target.value)}
                    placeholder="FAVOURITE NAME" maxLength={24} aria-label="favourite name"
                    style={{ font: F.chk(700, 14), minHeight: 44, minWidth: 160, borderBottomColor: T.line2 }}
                    onKeyDown={e => { if (e.key === 'Enter' && favNameDraft.trim() && !submittingFav) saveFavourite(favNameDraft.trim()); }} />
                  <GhostButton size={14} pad="10px 14px" disabled={!favNameDraft.trim() || submittingFav} onClick={() => saveFavourite(favNameDraft.trim())}>SAVE ▸</GhostButton>
                  <GhostButton size={14} pad="10px 14px" onClick={() => { setSavingFav(false); setFavNameDraft(''); }}>CANCEL</GhostButton>
                </span>
              ) : (
                <span data-testid="save-favourite">
                  <GhostButton size={14} pad="10px 16px" onClick={() => setSavingFav(true)}>☆ SAVE AS A FAVOURITE ▸</GhostButton>
                </span>
              )}
            </fieldset>
            {loaded ? (
              <span data-testid="game-continue-kit">
                {/* Polish round 1 Low: this used to check `locked` alone, so an empty required loadout
                    slot (`poolEmpty.any`, part of `realFault` but not `locked`) still let CONTINUE TO
                    KIT through -- KIT would then have nobody to kit into that slot. `busy` matches
                    LOAD's own guard against a second tap before the first round-trip lands. */}
                <PrimaryButton size={14} disabled={realFault || busy} title={realFault ? realFaultReason : 'Takes the phones to their kit screens. The guns are configured at the lobby push, after kitting.'}
                  onClick={() => continueToKit()}>{busy ? 'MOVING TO KIT…' : 'CONTINUE TO KIT ▸'}</PrimaryButton>
              </span>
            ) : (
              <span data-testid="game-load">
                <PrimaryButton size={14} disabled={blocked || busy}
                  title={blocked ? (realFaultReason || 'No hill assigned. King of the Hill needs a phone or Stick set as the hill in Armory.') : 'Sends this game to every connected phone. Weapons go with the arm, at the lobby push after kitting.'}
                  onClick={() => load()}>{busy ? 'LOADING…' : 'LOAD ▸'}</PrimaryButton>
              </span>
            )}
          </div>

          {errorsAndWarnings}
        </div>
      )}
    </div>
  );
}
