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
import { useEffect, useState } from 'react';
import { StationAlerts } from '../ui/StationAlerts';
import { STATION_CONFLICT, conflictWords, friendlySetupLine, setupLines } from '../ui/SetupSteps';
import { CONFIG_ERRORS_ALERT_ID } from '../api/derive';
import type { Favourite, GamePick, GamePiece, MatchSettings, PieceKind } from '../api/types';
import { setNotice } from '../notice';
import { useStore } from '../store';
import { F, T } from '../tokens';
import { BTN_RESET, DraftText, GhostButton, InfoIcon, PrimaryButton, Seg, StepBtn, Toggle } from '../ui';
import { Alert } from '../ui/Alert';
import { alertWords, serverLine } from '../alerts';
import { emptyRequiredSlots, poolEmptyMessage } from './gameSummary';
import { operatorNote } from './operatorNote';
import { type MatchItemKey, matchItems } from './matchItems';
import { kindLabel } from './presets/kinds';
import { RUNWAYS, getRunway, nearestRunway, setRunway, useRunway } from '../runway';
import { VenueModeManualLink } from '../ui/VenueModeReminder';
import { MODE_ART } from '../modeArt';
import { ModeEmblem } from './ModeEmblem';

/** F411 games-presets.md §5: PLAY's picker order. GAMEPLAY is always hidden for MVP (§3/§13/§15). */
const PICKER_ORDER: Exclude<PieceKind, 'gameplay'>[] = ['mode', 'life', 'spawn', 'primary', 'secondary', 'perks', 'misc_loadouts'];
// Polish round 1 Low: this duplicated BUILD's own `kindLabel` (screens/presets/kinds.ts) under a
// second name with the same eight strings -- one table now, imported.

const TIME_QUICK_MIN = [5, 10, 15, 20, 30];
// VQA QA-08: the server's own cap on a match's time limit (2 hours) — the stepper never sends past it.
const TIME_MAX_MIN = 120;
const KILLS_QUICK = [0, 10, 15, 25, 50, 100];   // 0 = NO KILL LIMIT
const COUNTDOWN_QUICK = [10, 30, 60];

/** the phases `POST /api/play/pick` (and `PUT /api/config`) accept in — same list `state.py` gates on.
 *  RECAP is editable too: any pick rolls the finished session forward first, roster and game kept. */
export const CONFIG_EDITABLE_PHASES = new Set(['muster', 'build', 'kit', 'lobby', 'recap']);
export function lockedReason(phase: string): string {
  if (phase === 'armed') return 'GAME SETTINGS ARE LOCKED: THE MATCH IS ARMED. ABORT ON THE MATCH TAB RETURNS IT TO THE LOBBY.';
  if (phase === 'live') return 'GAME SETTINGS ARE LOCKED: THE MATCH IS LIVE. END OR RECALL IT ON THE MATCH TAB TO EDIT THE GAME AGAIN.';
  return `GAME SETTINGS ARE LOCKED: THE MATCH IS ALREADY IN ${phase.toUpperCase()}.`;
}

export function Games() {
  const { state, api, run, setView, openBuild, setFocusHill, connected } = useStore();
  const [pieces, setPieces] = useState<GamePiece[]>([]);
  const [piecesStale, setPiecesStale] = useState(false);
  // VQA QA-09: a `GET /api/pieces` failure that is NOT a 404 (an older-console signal) is a real fetch
  // problem — show it, and retry once the socket reconnects, rather than swallowing it and leaving
  // every picker silently gone.
  const [piecesError, setPiecesError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [runwayVal] = useRunway();
  useEffect(() => {
    let cancelled = false;
    api.getPieces().then(ps => { if (cancelled) return; setPieces(ps); setPiecesStale(false); setPiecesError(null); })
      .catch(e => {
        if (cancelled) return;
        if ((e as { status?: number }).status === 404) { setPiecesStale(true); setPiecesError(null); }
        else setPiecesError((e as Error)?.message || 'could not load the game pieces');
      });
    return () => { cancelled = true; };
    // `connected` retries on a real reconnect (mock mode holds it true, so `retryTick` — RETRY below,
    // or a future reconnect against a real server — is what fires there).
  }, [api, connected, retryTick]);

  // ---- F411 §6 FAVOURITES: a named bundle of the whole PLAY pick, like a named LAST MATCH ---------
  const [favourites, setFavourites] = useState<Favourite[]>([]);
  // Polish round 1 M5: a 404 (an older MC, no FAVOURITES route) is stale, same as `piecesError`'s own
  // 404 case -- silent. Any OTHER failure used to be swallowed the same way, hiding a real fetch
  // problem behind an empty shelf that looked like "no favourites saved yet". The effect used to run
  // once, off `[api]` only, so a reconnect after the server came back never tried again.
  const [favouritesError, setFavouritesError] = useState<string | null>(null);
  const refreshFavourites = () => api.getFavourites().then(fs => { setFavourites(fs); setFavouritesError(null); })
    .catch(e => {
      if ((e as { status?: number }).status === 404) { setFavouritesError(null); return; }
      setFavouritesError((e as Error)?.message || 'could not load favourites');
    });
  useEffect(() => { refreshFavourites(); }, [api, connected, retryTick]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [savingFav, setSavingFav] = useState(false);
  const [favNameDraft, setFavNameDraft] = useState('');
  const [renamingFav, setRenamingFav] = useState<string | null>(null);
  const [confirmDeleteFav, setConfirmDeleteFav] = useState<string | null>(null);
  const [fallbackNote, setFallbackNote] = useState<string[] | null>(null);
  // Polish round 1 Low: guards SAVE AS A FAVOURITE against a double submit (declared up here with
  // every other hook -- a hook after the `if (!state) return null` below breaks the rules of hooks).
  const [submittingFav, setSubmittingFav] = useState(false);

  if (!state) return null;
  const cfg = state.config;
  const pick = state.game_pick;
  // F411 "stale server": `game_pick` absent from the snapshot, or `GET /api/pieces` 404 — an MC that
  // predates PLAY/BUILD. PLAY still renders: it just has nothing pickable to show.
  const staleServer = !pick || piecesStale;

  const locked = !CONFIG_EDITABLE_PHASES.has(state.phase);
  const poolEmpty = emptyRequiredSlots(state.loadout_pool);
  const poolEmptyReason = poolEmpty.any
    ? [poolEmpty.primary && poolEmptyMessage('PRIMARY', state.loadout_pool.reasons!.primary!),
       poolEmpty.secondary && poolEmptyMessage('SECONDARY', state.loadout_pool.reasons!.secondary_weapons!),
       poolEmpty.perk && poolEmptyMessage('PERK', state.loadout_pool.reasons!.perks!)].filter(Boolean).join(' ')
    : '';
  // games-redesign.md §8: KOTH needs a hill station assigned in ARMORY — never a dead end.
  const kothNoHill = cfg.mode === 'koth' && !(state.stations ?? []).some(s => s.assigned?.kind === 'control');
  // VQA QA-19: a real fault (locked, or an empty required slot) is red; KOTH-with-no-hill-yet is a
  // setup step, not a fault, so it gets its own amber block instead of sharing the red one.
  const realFault = locked || poolEmpty.any;
  const blocked = realFault || kothNoHill;
  const realFaultReason = locked ? lockedReason(state.phase) : poolEmptyReason;

  // Polish round 1 Low: a FAVOURITE's fallback note ("SPAWN — ITS SAVED PICK IS GONE…") used to sit on
  // screen until the NEXT favourite load, surviving every ordinary tap in between and describing a load
  // that was no longer the reason anything on screen looked the way it did.
  const pickPiece = (kind: PieceKind, piece_id: string) => { setFallbackNote(null); return run(() => api.pick({ pieces: { [kind]: piece_id } }))
    .then(r => { if (r && !r.ok) setNotice(r.errors.join(' · '), true); }); };
  const pickMatch = (patch: Partial<MatchSettings>) => { setFallbackNote(null); return run(() => api.pick({ match: patch }))
    .then(r => { if (r && !r.ok) setNotice(r.errors.join(' · '), true); }); };

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
    try { const r = await run(() => api.setPhase('kit')); if (r) setView('kit'); } finally { setBusy(false); }
  };

  const assignAHill = () => { setFocusHill(true); setView('muster'); };

  // ---- FAVOURITES actions (games-presets.md §6) ----------------------------------------------------
  // Polish round 1 Lows: (1) `submittingFav` (declared above, with the other hooks) guards against a
  // double Enter/click firing two `createFavourite` calls, the second landing as the 409 "already
  // exists" refusal for what looked like one tap. (2) the runway can be a non-RUNWAYS value by the time
  // this runs (a FAVOURITE or LAST MATCH load can set it to whatever it was actually armed with) --
  // snap it, so a newly saved favourite never carries a countdown the COUNTDOWN control itself could
  // not have picked.
  const saveFavourite = async (name: string) => {
    if (submittingFav) return;
    setSubmittingFav(true);
    try {
      const r = await run(() => api.createFavourite({ name, countdown_s: nearestRunway(runwayVal) }));
      if (r) { setSavingFav(false); setFavNameDraft(''); await refreshFavourites(); }
    } finally { setSubmittingFav(false); }
  };
  const renameFavourite = async (id: string, name: string) => {
    const r = await run(() => api.updateFavourite(id, { name }));
    if (r) { setRenamingFav(null); await refreshFavourites(); }
  };
  const deleteFavourite = async (id: string) => {
    await run(() => api.deleteFavourite(id));
    setConfirmDeleteFav(null);
    await refreshFavourites();   // harmless even on a refused delete — just re-syncs the shelf
  };
  const loadFavourite = async (id: string) => {
    const r = await run(() => api.loadFavourite(id));
    if (!r) return;
    // Polish round 1 H2: `ok: false` is a REFUSED load (a bench-gate refusal, same as any other pick) --
    // the mock changes nothing behind it (backend.ts's own "ok:false changes nothing" rule), so the
    // console must not either. This used to apply the runway and the fallback note regardless, showing
    // a countdown and a fallback list for a favourite that was never actually loaded.
    if (!r.ok) { setNotice(r.errors.join(' · '), true); return; }
    setRunway(r.countdown_s);
    // "SPAWN — STATION IS GONE, USING AUTO" (games-presets.md §6) needs the OLD piece's name, which a
    // fallback means we no longer have -- say what it is USING instead, always true, never invented.
    setFallbackNote(r.fallbacks.length
      ? r.fallbacks.map(k => `${kindLabel(k)} — ITS SAVED PICK IS GONE, USING ${pieces.find(p => p.piece_id === r.pick.pieces[k])?.name ?? 'ITS DEFAULT'}`)
      : null);
  };

  // ---- the operator note (games-redesign.md §9), derived off the composed config -----------------
  const note = operatorNote(cfg);

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
            <Alert key={i} id="games-loadouts-reset" what={w} style={{ alignSelf: 'flex-start' }} />
          ))}
          {[...state.config_warnings!].filter(w => /HAS NOT SYNCED THE LAST MATCH/.test(w)).map((w, i) => {
            const line = serverLine(w, 'amber');
            return <Alert key={`sync-${i}`} id={line.id} sev={line.sev} testid="games-station-not-synced" style={{ alignSelf: 'flex-start' }}>{w}</Alert>;
          })}
          {setupLines(state.config_warnings).filter(w => STATION_CONFLICT.test(w)).map((w, i) => {
            const line = serverLine(w, 'amber');
            // VQA QA-17: the raw server words say "respawn is set to station" now (matching the SPAWN
            // picker's own STATION option), but the shared friendly-rewrite table (ui/SetupSteps.tsx,
            // another lane's file this round) still hard-codes "scanner" — override the words here,
            // in the one file this fix owns, and add the button the KOTH block already has.
            const isRespawnSetup = /NO RESPAWN STATION IS ASSIGNED/i.test(w);
            const words = isRespawnSetup
              ? 'NO RESPAWN STATION IS ASSIGNED, AND RESPAWN IS SET TO STATION, SO A DOWNED PLAYER CAN ONLY COME BACK AT A STATION. ASSIGN A STATION AS RESPAWN IN ITEMS AND ARM IT.'
              : conflictWords(w);
            return (
              <div key={`setup-conflict-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <Alert id={line.id} sev={line.sev} testid="games-setup-line" style={{ alignSelf: 'flex-start', flex: '1 1 auto' }}>{words}</Alert>
                {isRespawnSetup && (
                  <span data-testid="assign-a-respawn-station">
                    <GhostButton size={14} pad="8px 14px" color={T.ink} border={T.line2} onClick={() => setView('muster')}>ASSIGN A RESPAWN STATION ▸</GhostButton>
                  </span>
                )}
              </div>
            );
          })}
          {/* QA-26: upper case, the same transform its STATION_CONFLICT sibling above already uses
              (`conflictWords` = `friendlySetupLine(w).toUpperCase()`) -- this was the one setup line
              left in mixed case, with internal terms, on an otherwise all-caps screen. */}
          {setupLines(state.config_warnings).filter(w => !STATION_CONFLICT.test(w)).map((w, i) => (
            <div key={`setup-step-${i}`} data-testid="games-setup-step" style={{ font: F.chk(500, 12), letterSpacing: '.02em', lineHeight: 1.5, color: T.body }}>
              {friendlySetupLine(w).toUpperCase()}
            </div>
          ))}
        </div>
      )}
      {state.config_errors.length > 0 && <Alert id={CONFIG_ERRORS_ALERT_ID} what={state.config_errors.join(', ')} size={11.5} />}
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

      {staleServer && (
        <Alert id="frame-server-old" testid="play-stale-server" style={{ marginBottom: 18 }}>
          THE SERVER PREDATES THIS CONSOLE. RESTART MISSION CONTROL (./start.sh).
        </Alert>
      )}
      {!staleServer && piecesError && (
        <Alert id="games-pieces-error" testid="play-pieces-error" style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ lineHeight: 1.5 }}>{alertWords(`COULD NOT LOAD THE GAME PIECES: ${piecesError}`)}</span>
          <span data-testid="pieces-retry">
            <GhostButton size={14} pad="8px 14px" color={T.ink} border={T.line2} onClick={() => setRetryTick(t => t + 1)}>RETRY ▸</GhostButton>
          </span>
        </Alert>
      )}
      {/* Polish round 1 M5: a real FAVOURITES fetch failure (not the older-MC 404) is shown, not
          swallowed -- the shelf otherwise looks the same as "no favourites saved yet". */}
      {!staleServer && favouritesError && (
        <Alert id="games-favourites-error" testid="play-favourites-error" style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ lineHeight: 1.5 }}>{alertWords(`COULD NOT LOAD FAVOURITES: ${favouritesError}`)}</span>
          <span data-testid="favourites-retry">
            <GhostButton size={14} pad="8px 14px" color={T.ink} border={T.line2} onClick={() => setRetryTick(t => t + 1)}>RETRY ▸</GhostButton>
          </span>
        </Alert>
      )}

      {!staleServer && realFault && (
        <Alert id="games-locked-banner" testid="games-locked" style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ lineHeight: 1.5 }}>{alertWords(realFaultReason ?? '')}</span>
          {(state.phase === 'armed' || state.phase === 'live') && (
            <GhostButton size={14} pad="8px 14px" color={T.ink} border={T.line2} onClick={() => setView(state.phase)}>JUMP TO MATCH ▸</GhostButton>
          )}
        </Alert>
      )}
      {!staleServer && !realFault && kothNoHill && (
        <Alert id="games-koth-no-hill" testid="games-locked" style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ lineHeight: 1.5 }}>NO HILL STATION ASSIGNED: KING OF THE HILL NEEDS ONE PHONE OR STICK SET AS THE HILL, IN ARMORY.</span>
          <span data-testid="assign-a-hill">
            <GhostButton size={14} pad="8px 14px" color={T.ink} border={T.line2} onClick={assignAHill}>ASSIGN A HILL ▸</GhostButton>
          </span>
        </Alert>
      )}

      {!staleServer && pick && (
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
              const options = pieces.filter(p => p.kind === kind && !p.post_mvp);
              if (options.length <= 1) return null;
              const selected = pick.pieces[kind];
              return (
                <div key={kind} data-testid={`picker-${kind}`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ font: F.mono(600, 11), letterSpacing: '.22em', color: T.micro }}>{kindLabel(kind)}</div>
                  {kind === 'mode' ? (
                    // Tony, 2026-09-26: "on play mode picker would be great" -- each option carries its
                    // own mark, so this is a bespoke row (Seg has no per-option slot for one), styled to
                    // match it otherwise.
                    <span role="group" aria-label="game mode" style={{ display: 'flex', flexWrap: 'wrap', border: `1px solid ${T.line}` }}>
                      {options.map(p => {
                        const on = p.piece_id === selected;
                        const modeId = (p.value as { mode: string }).mode;
                        return (
                          <button key={p.piece_id} type="button" className="hit44" aria-pressed={on} title={p.note || p.name}
                            onClick={() => pickPiece('mode', p.piece_id)}
                            style={{ ...BTN_RESET, font: F.chk(on ? 700 : 600, 14), letterSpacing: '.08em', padding: '8px 16px 8px 8px',
                              background: on ? T.panelAlt : 'transparent', color: on ? T.acc : T.micro,
                              boxShadow: on ? `inset 0 -2px 0 ${T.acc}` : undefined,
                              cursor: on ? 'default' : 'pointer', minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                            <ModeMark mode={modeId} />
                            {p.name}
                          </button>
                        );
                      })}
                    </span>
                  ) : (
                    <Seg wrap size={14} label={kindLabel(kind).toLowerCase()} value={selected} pad="10px 16px"
                      options={options.map(p => ({ value: p.piece_id, label: p.name }))}
                      titles={Object.fromEntries(options.map(p => [p.piece_id, p.note || p.name]))}
                      onChange={id => pickPiece(kind, id)} />
                  )}
                  {kind === 'mode' && note.length > 0 && (
                    <div data-testid="operator-note" role="status"
                      style={{ marginTop: 2, display: 'flex', flexDirection: 'column', gap: 3, font: F.chk(600, 12.5), lineHeight: 1.5, color: T.dim,
                               border: `1px solid ${T.line2}`, padding: '8px 12px', maxWidth: 420 }}>
                      {note.map((l, i) => (
                        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <InfoIcon size={13} color={T.acc} /> {l}
                        </span>
                      ))}
                    </div>
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
            {matchItems(cfg.mode, cfg.scoring.win_by).map(key => (
              <MatchItem key={key} itemKey={key} pick={pick} locked={locked} runwayVal={runwayVal} pickMatch={pickMatch} />
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
                    const lm = state.last_match!;
                    const r = await run(() => api.pick({ match: { time_limit_s: lm.time_limit_s, frag_limit: lm.frag_limit, night: lm.night, silenced: lm.silenced } }));
                    if (r?.ok) setRunway(lm.countdown_s);
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
                <PrimaryButton size={14} disabled={blocked || busy || staleServer}
                  title={blocked ? (realFaultReason || 'NO HILL STATION ASSIGNED: KING OF THE HILL NEEDS ONE PHONE OR STICK SET AS THE HILL, IN ARMORY.') : 'Sends this game to every connected phone. Weapons go with the arm, at the lobby push after kitting.'}
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

/** One FAVOURITES chip (games-presets.md §6): tap the name to LOAD it, ✎ to rename inline (DraftText,
 *  commits on blur/Enter), ✕ for the two-tap delete confirm. */
function FavouriteChip({ fav, renaming, confirmingDelete, onLoad, onRenameStart, onRenameCommit, onRenameCancel, onDeleteStart, onDeleteConfirm, onDeleteCancel }: {
  fav: Favourite; renaming: boolean; confirmingDelete: boolean;
  onLoad: () => void; onRenameStart: () => void; onRenameCommit: (name: string) => void; onRenameCancel: () => void;
  onDeleteStart: () => void; onDeleteConfirm: () => void; onDeleteCancel: () => void;
}) {
  if (renaming) {
    return (
      <span data-testid={`favourite-rename-${fav.favourite_id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: `1px solid ${T.line2}`, padding: '4px 8px', minHeight: 44 }}>
        <DraftText value={fav.name} onCommit={onRenameCommit} ariaLabel={`rename ${fav.name}`} maxLength={24}
          style={{ font: F.chk(700, 14), minWidth: 120, borderBottomColor: T.line2 }} />
        <button type="button" onClick={onRenameCancel} aria-label="cancel rename" className="hit44"
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

/** GAME MODE's own mark (Tony, 2026-09-26), beside its name in a FIXED box so the row never jumps.
 *  `object-fit: contain` -- the whole mark shows, never a crop. A mode with no `<mode>.jpg` yet, or
 *  whose image fails to load, falls back to ModeEmblem's line drawing (never a broken-image icon);
 *  `MODE_ART` decides which modes have art, never a name hard-coded here, so a mode added later (or
 *  koth, once its art lands) needs no change to this file. */
function ModeMark({ mode }: { mode: string }) {
  const [broken, setBroken] = useState(false);
  const hasArt = MODE_ART.has(mode) && !broken;
  return (
    <span style={{ display: 'inline-block', width: 44, height: 28, flexShrink: 0, position: 'relative',
      background: T.inset, border: `1px solid ${T.line2}`, overflow: 'hidden' }}>
      {hasArt
        ? <img src={`assets/modes/${mode}.jpg`} alt="" onError={() => setBroken(true)}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        : <ModeEmblem mode={mode} />}
    </span>
  );
}

/** One MATCH SETTINGS strip item, by key (screens/matchItems.ts). Each wraps its own control in a
 *  `display: contents` fieldset (disables with `locked`, contributes no box of its own); an item's
 *  own extras (the manual link, the ON/OFF word) are siblings, never inside that fieldset. */
function MatchItem({ itemKey, pick, locked, runwayVal, pickMatch }:
  { itemKey: MatchItemKey; pick: GamePick; locked: boolean; runwayVal: number; pickMatch: (p: Partial<MatchSettings>) => void }) {
  const guarded = (child: React.ReactNode) => (
    <fieldset disabled={locked} style={{ border: 'none', margin: 0, padding: 0, display: 'contents' }}>{child}</fieldset>
  );
  switch (itemKey) {
    case 'time':
      return guarded(<TimeControl seconds={pick.match.time_limit_s} onChange={s => pickMatch({ time_limit_s: s })} />);
    case 'kills':
      return guarded(<KillsControl fragLimit={pick.match.frag_limit} onChange={n => pickMatch({ frag_limit: n })} />);
    case 'countdown':
      return guarded(<CountdownControl seconds={runwayVal} onChange={setRunway} />);
    case 'daynight':
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {guarded(
            <Seg size={14} value={pick.match.night ? 'night' : 'day'} pad="10px 14px"
              options={[{ value: 'day', label: 'DAY' }, { value: 'night', label: 'NIGHT' }]}
              onChange={v => pickMatch({ night: v === 'night' })} />,
          )}
          <VenueModeManualLink />
        </span>
      );
    case 'silenced':
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
          {guarded(<Toggle on={pick.match.silenced} onChange={v => pickMatch({ silenced: v })} label="silenced" />)}
          {/* VQA QA-12: the switch alone (grey/blue) was the only sign of the state — add the word. */}
          <span style={{ font: F.chk(700, 14), letterSpacing: '.04em', color: pick.match.silenced ? T.ink : T.dim }}>
            SILENCED: {pick.match.silenced ? 'ON' : 'OFF'}
          </span>
        </span>
      );
  }
}

/** Tapping the value opens a short quick-pick row; the steppers stay for fine adjustment beyond it
 *  (games-redesign.md §5). One shape, three uses below. */
function QuickPick({ testid, valueLabel, quick, quickLabel, onQuick, step }:
  { testid: string; valueLabel: string; quick: number[]; quickLabel: (v: number) => string; onQuick: (v: number) => void; step: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" data-testid={testid} className="hov-acc hit44"
          onClick={() => setOpen(o => !o)} aria-expanded={open}
          style={{ ...BTN_RESET, font: F.chk(700, 14), padding: '8px 12px', minHeight: 44, cursor: 'pointer', color: T.acc, border: `1px solid ${T.line2}` }}>
          {valueLabel}
        </button>
        {step}
      </div>
      {open && (
        <div role="group" data-testid="quick-pick-row" style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {quick.map(v => (
            <button key={v} type="button" onClick={() => { onQuick(v); setOpen(false); }} className="hit44"
              style={{ ...BTN_RESET, font: F.chk(600, 14), padding: '8px 12px', minHeight: 44, minWidth: 44, cursor: 'pointer', background: T.panelDeep, border: `1px solid ${T.line}`, color: T.body }}>
              {quickLabel(v)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TimeControl({ seconds, onChange }: { seconds: number | null; onChange: (s: number) => void }) {
  const mins = Math.max(1, Math.round((seconds ?? 600) / 60));
  return (
    <QuickPick testid="match-time-value" valueLabel={`${mins} MIN`} quick={TIME_QUICK_MIN}
      quickLabel={v => `${v} MIN`} onQuick={v => onChange(v * 60)}
      step={(
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <StepBtn label="time limit minus" onClick={() => onChange(Math.max(1, mins - 1) * 60)}>−</StepBtn>
          {/* VQA QA-08: the server refuses a time limit past its own cap; never send past it. */}
          <StepBtn label="time limit plus" disabled={mins >= TIME_MAX_MIN} onClick={() => onChange(Math.min(TIME_MAX_MIN, mins + 1) * 60)}>+</StepBtn>
        </span>
      )} />
  );
}

function KillsControl({ fragLimit, onChange }: { fragLimit: number | null; onChange: (n: number | null) => void }) {
  // VQA QA-22: stepping down from a low kill count must land on NO KILL LIMIT, not stick at "1 KILLS"
  // (and pressing − again while already at NO KILL LIMIT must stay there, not go negative).
  const step = (dir: 1 | -1) => { const next = (fragLimit ?? 0) + dir * 5; onChange(next <= 0 ? null : next); };
  return (
    <QuickPick testid="match-kills-value" valueLabel={fragLimit ? `${fragLimit} KILLS` : 'NO KILL LIMIT'}
      quick={KILLS_QUICK} quickLabel={v => (v === 0 ? 'NO KILL LIMIT' : `${v}`)}
      onQuick={v => onChange(v === 0 ? null : v)}
      step={(
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <StepBtn label="kill limit minus" onClick={() => step(-1)}>−</StepBtn>
          <StepBtn label="kill limit plus" onClick={() => step(1)}>+</StepBtn>
        </span>
      )} />
  );
}

function CountdownControl({ seconds, onChange }: { seconds: number; onChange: (s: number) => void }) {
  const idx = Math.max(0, RUNWAYS.indexOf(seconds));
  const step = (d: number) => onChange(RUNWAYS[Math.max(0, Math.min(RUNWAYS.length - 1, idx + d))] ?? getRunway());
  return (
    <QuickPick testid="match-countdown-value" valueLabel={`COUNTDOWN ${seconds} S`} quick={COUNTDOWN_QUICK}
      quickLabel={v => `${v} S`} onQuick={onChange}
      step={(
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <StepBtn label="countdown minus" onClick={() => step(-1)}>−</StepBtn>
          <StepBtn label="countdown plus" onClick={() => step(1)}>+</StepBtn>
        </span>
      )} />
  );
}
