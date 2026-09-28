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
import { useEffect, useRef, useState } from 'react';
import { StationAlerts } from '../ui/StationAlerts';
import { STATION_CONFLICT, conflictWords, friendlySetupLine, setupLines } from '../ui/SetupSteps';
import { CONFIG_ERRORS_ALERT_ID } from '../api/derive';
import type { Favourite, GamePick, GamePiece, MatchSettings, PieceKind, TeamColour } from '../api/types';
import { setNotice } from '../notice';
import { useStore } from '../store';
import { F, T, TEAM } from '../tokens';
import { BTN_RESET, DraftText, GhostButton, InfoIcon, PrimaryButton, Seg, SEG_PAD_44, StepBtn, Toggle, useFlashOnChange } from '../ui';
import { Alert } from '../ui/Alert';
import { alertWords, serverLine } from '../alerts';
import { emptyRequiredSlots, poolEmptyMessage } from './gameSummary';
import { legalColours } from '../teamColours';
import { operatorNote } from './operatorNote';
import { type MatchItemKey, matchItems } from './matchItems';
import { kindLabel } from './presets/kinds';
import { pickFallbackNote } from './pieceFallbackNote';
import { RUNWAYS, getRunway, setRunway, useRunway } from '../runway';
import { markPristine, picksDirty, seedBaseline } from '../playBaseline';
import { VenueModeManualLink } from '../ui/VenueModeReminder';
import { MODE_ART } from '../modeArt';
import { ModeEmblem } from './ModeEmblem';

/** F411 games-presets.md §5: PLAY's picker order. GAMEPLAY is always hidden for MVP (§3/§13/§15). */
const PICKER_ORDER: Exclude<PieceKind, 'gameplay'>[] = ['mode', 'life', 'spawn', 'primary', 'secondary', 'perks', 'misc_loadouts'];
// Polish round 1 Low: this duplicated BUILD's own `kindLabel` (screens/presets/kinds.ts) under a
// second name with the same eight strings -- one table now, imported.

// F413 (games-presets.md §7): every team mode's own catalogue `defaults.teams` is red+blue now,
// matching the server (team-lead's scope decision, 2026-09-27; mock/data.ts's own `base()` and
// `MODES` comments have the full reasoning) -- ONE source of truth, so `pickMode`/`loadFavourite`
// below read it straight off `modes` again, the same way they did before F413.

const TIME_QUICK_MIN = [5, 10, 15, 20, 30];
// VQA QA-08: the server's own cap on a match's time limit (2 hours) — the stepper never sends past it.
const TIME_MAX_MIN = 120;
const KILLS_QUICK = [0, 10, 15, 25, 50, 100];   // 0 = NO KILL LIMIT
const COUNTDOWN_QUICK = [10, 30, 60];

// Bench 2026-09-28: `QuickPick`'s own `minValueWidth`, one per control, each sized to that control's
// widest label at its real weight/size (`F.chk(700, 14)`) — measured off the actual "Chakra Petch"
// face (a `<span>` off-screen, `getBoundingClientRect`), not guessed from character counts (the
// font is proportional, not monospace). Each is the measured text width + the button's own
// horizontal padding (24px) + its 1px border each side + a few px of slack for antialiasing/hinting
// differences across browsers. Widest label per control: TIME "120 MIN" (the cap, TIME_MAX_MIN);
// KILLS "NO KILL LIMIT" (wider than any "N KILLS" up to three digits); COUNTDOWN "COUNTDOWN 120 S" /
// "COUNTDOWN 180 S" (RUNWAYS' own top two); HOLD "HOLD 120 MIN" (the cap, HOLD_MAX_S).
const TIME_VALUE_W = 90;
const KILLS_VALUE_W = 136;
const COUNTDOWN_VALUE_W = 172;
const HOLD_VALUE_W = 136;

/** the phases `POST /api/play/pick` (and `PUT /api/config`) accept in — same list `state.py` gates on.
 *  RECAP is editable too: any pick rolls the finished session forward first, roster and game kept. */
export const CONFIG_EDITABLE_PHASES = new Set(['muster', 'build', 'kit', 'lobby', 'recap']);
export function lockedReason(phase: string): string {
  if (phase === 'armed') return 'GAME SETTINGS ARE LOCKED: THE MATCH IS ARMED. ABORT ON THE MATCH TAB RETURNS IT TO THE LOBBY.';
  if (phase === 'live') return 'GAME SETTINGS ARE LOCKED: THE MATCH IS LIVE. END OR RECALL IT ON THE MATCH TAB TO EDIT THE GAME AGAIN.';
  return `GAME SETTINGS ARE LOCKED: THE MATCH IS ALREADY IN ${phase.toUpperCase()}.`;
}

export function Games() {
  const { state, api, run, setView, openBuild, setFocusHill, connected, modes } = useStore();
  const [pieces, setPieces] = useState<GamePiece[]>([]);
  const [piecesStale, setPiecesStale] = useState(false);
  // VQA QA-09: a `GET /api/pieces` failure that is NOT a 404 (an older-console signal) is a real fetch
  // problem — show it, and retry once the socket reconnects, rather than swallowing it and leaving
  // every picker silently gone.
  const [piecesError, setPiecesError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [runwayVal] = useRunway();
  const seenPick = state?.game_pick;
  useEffect(() => { if (seenPick) seedBaseline(seenPick, runwayVal); }, [seenPick, runwayVal]);
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
  // Round 2 Low: this had no `cancelled` guard at all (unlike the pieces-fetch effect just above it) --
  // a stale response landing after `api`/`retryTick` moved on could still clobber newer state, or update
  // state past unmount. And it used to refetch on EVERY `connected` change, including the DISCONNECT
  // itself, which can only fail or race the reconnect fetch that follows it -- skip while known offline.
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    api.getFavourites().then(fs => { if (cancelled) return; setFavourites(fs); setFavouritesError(null); })
      .catch(e => {
        if (cancelled) return;
        if ((e as { status?: number }).status === 404) { setFavouritesError(null); return; }
        setFavouritesError((e as Error)?.message || 'could not load favourites');
      });
    return () => { cancelled = true; };
  }, [api, connected, retryTick]);
  const [savingFav, setSavingFav] = useState(false);
  const [favNameDraft, setFavNameDraft] = useState('');
  const [renamingFav, setRenamingFav] = useState<string | null>(null);
  const [confirmDeleteFav, setConfirmDeleteFav] = useState<string | null>(null);
  // Bench 2026-09-28 (Tony): the favourite waiting on "DISCARD YOUR CHANGES?" (playBaseline.ts).
  const [favDiscard, setFavDiscard] = useState<string | null>(null);
  // Polish 2026-09-28: the question takes focus when it appears, so a keyboard operator's next key acts
  // on DISCARD / CANCEL, not on the tapped chip's own rename or delete buttons.
  const discardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (favDiscard) discardRef.current?.querySelector('button')?.focus(); }, [favDiscard]);
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
    try { const r = await run(() => api.setPhase('kit')); if (r) setView('kit'); } finally { setBusy(false); }
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
  const renameFavourite = async (id: string, name: string) => {
    const r = await run(() => api.updateFavourite(id, { name }));
    if (r) { setRenamingFav(null); await refreshFavourites(); }
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
    if (pick && picksDirty(pick, runwayVal)) { setFavDiscard(id); return; }
    setFavDiscard(null);
    await doLoadFavourite(id);
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
      {/* Review Low: while the console itself is known offline, a stale piecesError is not a NEW fact
          -- CommandBar's own MC_OFFLINE banner already says so, and this one used to flash on
          (in)/(out) with every reconnect blip instead of staying quiet until there is something new
          to report. */}
      {!staleServer && piecesError && connected && (
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
          {favDiscard && (
            <div ref={discardRef} data-testid="favourite-discard" role="alertdialog" aria-label="discard your changes"
              onKeyDown={e => { if (e.key === 'Escape') setFavDiscard(null); }}
              style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ font: F.chk(700, 13), letterSpacing: '.12em', color: T.warn }}>
                ▲ DISCARD YOUR CHANGES?
              </span>
              <GhostButton size={13} pad="10px 16px" color={T.warn} border={T.warn}
                onClick={() => { const id = favDiscard; setFavDiscard(null); void doLoadFavourite(id); }}>DISCARD</GhostButton>
              <GhostButton size={13} pad="10px 16px" onClick={() => setFavDiscard(null)}>CANCEL</GhostButton>
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
  // UX round 1 (2026-09-26): renaming had only a ✕ (cancel), with no visible way to CONFIRM a typed
  // name — Enter or clicking away commits it (`DraftText`'s own blur/Enter rule), but nothing on
  // screen said so. `draft` mirrors `DraftText`'s own live value (its `onDraft` hook) so a sibling ✓
  // button can commit the CURRENT text directly. Both buttons take focus with `onMouseDown`'s
  // `preventDefault` — without it, a click blurs the input FIRST (committing via `DraftText`'s own
  // onBlur) and only THEN runs the button's onClick, so ✕ used to "cancel" an edit it had already sent.
  const [draft, setDraftMirror] = useState(fav.name);
  const suppressCommit = useRef(false);
  // Round 3: `suppressCommit` was never reset, so after ONE Escape/✕ on a chip, every LATER rename on
  // that SAME chip started with it already true -- Enter and click-away saved nothing from then on.
  // Reset when a fresh rename session starts, not when it ends (cancel/save both unmount this branch
  // and race the reset against whichever blur that causes).
  useEffect(() => { if (renaming) { setDraftMirror(fav.name); suppressCommit.current = false; } }, [renaming, fav.name]);
  // Round 2 (4): Tab (not a mouse click) moves focus to ✓/✕ the same way blur/Enter does everywhere
  // else -- `onMouseDown`'s preventDefault above only ever stopped a MOUSE click from blurring first,
  // so a keyboard user tabbing to ✕ still committed the draft via `DraftText`'s own onBlur before ✕'s
  // Enter ever ran. `suppressCommit` covers Escape too (which does not move focus to a sibling at all,
  // so `relatedTarget` alone cannot catch it): both stop the blur reaching `DraftText`'s onCommit by
  // intercepting it in the CAPTURE phase, before the input's own onBlur (the bubble-phase target) fires.
  if (renaming) {
    const save = () => { const v = draft.trim(); if (v && v !== fav.name) onRenameCommit(v); else onRenameCancel(); };
    const cancel = () => { suppressCommit.current = true; onRenameCancel(); };
    return (
      <span data-testid={`favourite-rename-${fav.favourite_id}`}
        onBlurCapture={e => {
          const rt = e.relatedTarget as Node | null;
          if (suppressCommit.current || (rt && e.currentTarget.contains(rt))) e.stopPropagation();
        }}
        onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } }}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: `1px solid ${T.line2}`, padding: '4px 8px', minHeight: 44 }}>
        <DraftText value={fav.name} onCommit={onRenameCommit} onDraft={setDraftMirror} ariaLabel={`rename ${fav.name}`} maxLength={24}
          style={{ font: F.chk(700, 14), minWidth: 120, borderBottomColor: T.line2 }} />
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

/** GAME MODE's own mark (Tony, 2026-09-26), beside its name in a FIXED box so the row never jumps.
 *  `object-fit: contain` -- the whole mark shows, never a crop. A mode with no `<mode>.jpg` yet, or
 *  whose image fails to load, falls back to ModeEmblem's line drawing (never a broken-image icon);
 *  `MODE_ART` decides which modes have art, never a name hard-coded here, so a mode added later (or
 *  koth, once its art lands) needs no change to this file. */
function ModeMark({ mode }: { mode: string }) {
  const [broken, setBroken] = useState(false);
  const hasArt = MODE_ART.has(mode) && !broken;
  return (
    <span data-testid="mode-mark" style={{ display: 'inline-block', width: 56, height: 36, flexShrink: 0, position: 'relative',
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
function MatchItem({ itemKey, pick, locked, runwayVal, pickMatch, mode, currentTeams, pickTeams }:
  { itemKey: MatchItemKey; pick: GamePick; locked: boolean; runwayVal: number; pickMatch: (p: Partial<MatchSettings>) => void;
    mode: string; currentTeams: TeamColour[]; pickTeams: (teams: TeamColour[]) => void }) {
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
            <Seg size={14} label="day or night" value={pick.match.night ? 'night' : 'day'} pad={SEG_PAD_44}
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
    case 'teams':
      // F413: the pick's OWN `match.teams` is only set once a mode change or a TEAMS edit has named
      // one explicitly (games-presets.md §7's "red, blue" default is compose's, not this control's) --
      // absent that, this shows the ROSTER'S actual teams (`cfg.teams`, via `currentTeams`), never an
      // invented default that could disagree with who is on what team right now.
      return guarded(<TeamsControl teams={pick.match.teams ?? currentTeams} mode={mode} onChange={pickTeams} />);
    case 'hold':
      // Review MEDIUM (brx1, e8811fea): NO TARGET said nothing about what it was NO TARGET *of* --
      // the same leading label TEAMS already carries.
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ font: F.mono(600, 11), letterSpacing: '.16em', color: T.micro }}>HOLD</span>
          {guarded(<HoldControl seconds={pick.match.hold_target_s ?? null} onChange={s => pickMatch({ hold_target_s: s })} />)}
        </span>
      );
  }
}

/** F413 (games-presets.md §7): 2 to 4 unique team colours, one chooser per rostered team, each shown
 *  in its own colour (`tokens.ts`'s TEAM swatch map — the same colours the roster/HUD use elsewhere).
 *  KOTH fixes the count at 2 and never offers yellow (a neutral hill broadcasts tid 2, F82). A count or
 *  colour change that would move rostered players between teams is the caller's job (`pickTeams`) --
 *  this component only ever proposes the next `TeamColour[]`, never sends anything itself. */

function TeamsControl({ teams, mode, onChange }: { teams: TeamColour[]; mode: string; onChange: (teams: TeamColour[]) => void }) {
  const isKoth = mode === 'koth';
  const offered = legalColours(mode);
  const setCount = (n: number) => {
    if (n === teams.length) return;
    if (n < teams.length) { onChange(teams.slice(0, n)); return; }
    const next = [...teams];
    for (const c of offered) { if (next.length >= n) break; if (!next.includes(c)) next.push(c); }
    onChange(next);
  };
  const setSlot = (i: number, c: TeamColour) => {
    const next = [...teams];
    next[i] = c;
    onChange(next);
  };
  return (
    <span data-testid="match-teams-item" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ font: F.mono(600, 11), letterSpacing: '.16em', color: T.micro }}>TEAMS</span>
      {/* KOTH: exactly 2, no count control (F413 §7) -- nothing to choose. */}
      {!isKoth && (
        <Seg size={14} label="team count" value={String(teams.length)} pad={SEG_PAD_44}
          options={[2, 3, 4].map(n => ({ value: String(n), label: String(n) }))}
          onChange={v => setCount(Number(v))} />
      )}
      {teams.map((c, i) => (
        <span key={i} style={{ display: 'inline-flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
          <span style={{ font: F.mono(600, 11), letterSpacing: '.08em', color: T.micro }}>TEAM {i + 1}</span>
          <ColourChooser slot={i} value={c} offered={offered} teams={teams}
            onChange={v => setSlot(i, v)} />
        </span>
      ))}
    </span>
  );
}

/** One team slot's colour, as a dropdown (bench 2026-09-28, Tony: it replaced a row of swatch buttons).
 *  The select fills with the chosen colour; each option shows in its own colour. A colour another slot
 *  already uses stays listed, disabled, with that slot's name, so the set never looks shorter than it is.
 *  Controlled: while the F413 reshape confirm is up the value snaps back, and a second pick commits. */
function ColourChooser({ slot, value, offered, teams, onChange }:
  { slot: number; value: TeamColour; offered: TeamColour[]; teams: TeamColour[]; onChange: (c: TeamColour) => void }) {
  return (
    <select aria-label={`team ${slot + 1} colour`} data-testid={`match-teams-colour-${slot}`} value={value}
      onChange={e => onChange(e.target.value as TeamColour)}
      style={{ minWidth: 120, minHeight: 44, padding: '8px 10px', cursor: 'pointer', boxSizing: 'border-box',
        background: TEAM[value], color: '#0c1420', border: `2px solid ${TEAM[value]}`, borderRadius: 0,
        font: F.chk(700, 13), letterSpacing: '.06em' }}>
      {offered.map(c => {
        const owner = teams.findIndex((t, j) => j !== slot && t === c);
        return (
          <option key={c} value={c} disabled={owner >= 0} style={{ background: T.panelDeep, color: TEAM[c] }}>
            {c.toUpperCase()}{owner >= 0 ? ` · TEAM ${owner + 1}` : ''}
          </option>
        );
      })}
    </select>
  );
}

/** F415 (games-presets.md §7): KOTH's own hold target -- NO TARGET (null, the pre-F415 behaviour: most
 *  possession at the clock wins), or 3/5/10 MIN quick-picks with ±1 MIN steppers. Stepping down from a
 *  low value lands on NO TARGET (KillsControl's own idiom, minutes instead of a kill count); stepping
 *  up from NO TARGET starts a fresh target at 1 MIN. */
// Low (b), review e8811fea: the server's own ceiling is 1s..2:00:00 (checkHoldTargetShape's own sibling
// check in mock/backend.ts) -- the stepper must not invite a value it would only send back refused.
const HOLD_MAX_S = 7200;

function HoldControl({ seconds, onChange }: { seconds: number | null; onChange: (s: number | null) => void }) {
  const step = (dir: 1 | -1) => { const next = (seconds ?? 0) + dir * 60; onChange(next <= 0 ? null : Math.min(next, HOLD_MAX_S)); };
  return (
    <QuickPick testid="match-hold-value" valueLabel={seconds ? `HOLD ${Math.round(seconds / 60)} MIN` : 'NO TARGET'} minValueWidth={HOLD_VALUE_W}
      quick={[0, 3, 5, 10]} quickLabel={v => (v === 0 ? 'NO TARGET' : `${v} MIN`)}
      onQuick={v => onChange(v === 0 ? null : v * 60)}
      step={(
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <StepBtn label="hold target minus" onClick={() => step(-1)}>−</StepBtn>
          <StepBtn label="hold target plus" disabled={(seconds ?? 0) >= HOLD_MAX_S} onClick={() => step(1)}>+</StepBtn>
        </span>
      )} />
  );
}

/** Tapping the value opens a short quick-pick row; the steppers stay for fine adjustment beyond it
 *  (games-redesign.md §5). One shape, three uses below.
 *
 *  Bench 2026-09-28: pressing − / + changed the LENGTH of the value text ("10 MIN" -> "9 MIN",
 *  "NO KILL LIMIT" -> "15 KILLS"), which shrank or grew the button and shoved the − / + pair sideways
 *  with it -- a stepper whose own position moves under the finger that is stepping it. `minValueWidth`
 *  fixes the button at its widest label for that control (measured off the real font, callers below),
 *  so the box never resizes; only the text inside it changes. Centred (`textAlign` + the flex centring)
 *  so a short label ("5 MIN") sits in the middle of the box, not jammed against its left edge. */
function QuickPick({ testid, valueLabel, quick, quickLabel, onQuick, step, minValueWidth }:
  { testid: string; valueLabel: string; quick: number[]; quickLabel: (v: number) => string; onQuick: (v: number) => void; step: React.ReactNode; minValueWidth: number }) {
  const [open, setOpen] = useState(false);
  const valueRef = useRef<HTMLButtonElement>(null);
  useFlashOnChange(valueRef, valueLabel);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button ref={valueRef} type="button" data-testid={testid} className="hov-acc hit44"
          onClick={() => setOpen(o => !o)} aria-expanded={open}
          style={{ ...BTN_RESET, font: F.chk(700, 14), padding: '8px 12px', minHeight: 44, minWidth: minValueWidth,
                   display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
                   fontVariantNumeric: 'tabular-nums', cursor: 'pointer', color: T.acc, border: `1px solid ${T.line2}` }}>
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
    <QuickPick testid="match-time-value" valueLabel={`${mins} MIN`} minValueWidth={TIME_VALUE_W} quick={TIME_QUICK_MIN}
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
    <QuickPick testid="match-kills-value" valueLabel={fragLimit ? `${fragLimit} KILLS` : 'NO KILL LIMIT'} minValueWidth={KILLS_VALUE_W}
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
    <QuickPick testid="match-countdown-value" valueLabel={`COUNTDOWN ${seconds} S`} minValueWidth={COUNTDOWN_VALUE_W} quick={COUNTDOWN_QUICK}
      quickLabel={v => `${v} S`} onQuick={onChange}
      step={(
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <StepBtn label="countdown minus" onClick={() => step(-1)}>−</StepBtn>
          <StepBtn label="countdown plus" onClick={() => step(1)}>+</StepBtn>
        </span>
      )} />
  );
}
