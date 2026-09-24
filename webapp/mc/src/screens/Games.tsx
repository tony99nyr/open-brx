// GAMES — two states on one tab (docs/spec/loadout.md §5).
//
// BEFORE a config has been sent to the guns it is "pick tonight's game": two rows of cards (YOUR
// GAMES · STOCK MODES), a summary of what the players will get, the VENUE chips, and LOAD ▸.
// AFTER, it is the ACTIVE GAME CONFIG: every setting of the game the guns are actually holding, the
// count of guns that have confirmed it, EDIT, and the way on to KIT.
//
// Tony, 2026-09-13: "At first on a new match the game tab should be as it is today. Pick or create
// customize. Instead of continue though it should be Load. Load pushes that config to phones. The tab
// should then change state to active game config. Every setting for the current config shown. Click
// Edit to modify and then Save and Load to update all phones." The reason is the one that decides
// every judgement on this screen: "several times while players were kitting I wanted to make
// adjustments and I would have to remake a game type and hit continue hoping it pushed the updates."
// CONTINUE never pushed anything — it was a bare `setPhase('kit')` — so the operator's doubt was
// well founded. Everything here exists to answer it: one control that loads, one readout of how many
// guns took it, and the config_id they echoed.
//
// LOAD ANNOUNCES THE GAME; IT DOES NOT WRITE A GUN. Tony, 2026-09-13: "weapons have to go with the
// arm." The first cut of this screen called the real config push, which compiles a weapon head per
// player — and nobody has kitted at that point, so it wrote policy-DEFAULT loadouts to every gun and
// re-pushed on every kit pick. LOAD now sends the game (mode, teams, health, night, respawn, venue,
// the rules) to the phones and leaves the guns alone; weapons still reach them at the LOBBY push
// after kitting, exactly as before. So `lobby.pushed` stays FALSE through a LOAD, and this tab keys
// its two states on `state.game.loaded` instead.
//
// LOAD deliberately does NOT advance to KIT either: a tab cannot "change state to active game config"
// if it navigates away. CONTINUE TO KIT ▸ is the way on, one tap, on the active state.
//
// Defining a game happens in the DESIGNER (opened from here) — this page has no forms.
import { useCallback, useEffect, useState } from 'react';
import { STALE_ACK_FAULT, pushGate, sentenceCase, splitBlocker } from '../api/derive';
import type { ModeInfo, SavedGame } from '../api/types';
import { setNotice } from '../notice';
import { useStore } from '../store';
import { F, PERK_COLOR, T } from '../tokens';
import { BTN_RESET, GhostButton, PrimaryButton, SectionRule, Seg, Shelf, StripedSlot, SwitchConfirm, Tag, Toggle, onKey } from '../ui';
import { HEALTH_PRESET_COPY, emptyRequiredSlots, gameSig, healthPresetOf, poolEmptyMessage, rulesLine, splitLine } from './gameSummary';
import { MODE_ART } from '../modeArt';
import { ModeEmblem } from './ModeEmblem';
import { VenueModeManualLink } from '../ui/VenueModeReminder';
import { GameEditPanel } from '../ui/GameEditPanel';
import { GameSentStatus, GameSettings, LoadStatus, gameSettingRows } from '../ui/LoadedGame';

/** F151 (field 2026-09-12, ISSUE 25) — `PUT /api/config` (and everything that rides on it: playing a
 *  saved game, playing a stock mode, applying a preset) is only VALID in muster/build/kit/lobby
 *  (mc/API.md). Once the field has moved on — the match is armed or live, or even sitting in the
 *  debrief — a tap here used to fail SILENTLY: the store's `error` is a small dismissable strip the
 *  operator can easily miss, and nothing on the Games screen itself said why nothing happened. This
 *  says which door is still open — and names the RIGHT one: `armed` is undone by ABORT, not RECALL. */
/** 2026-09-16: RECAP is editable too. `state.py set_config` (and LOAD, and a phase move) in `recap`
 *  rolls the finished session forward first (`_roll_forward_from_recap`: roster and game kept), so any
 *  GAMES action after the whistle simply works on the next match. Tony: "why? just make a new one".
 *  Only armed/live refuse. */
export const CONFIG_EDITABLE_PHASES = new Set(['muster', 'build', 'kit', 'lobby', 'recap']);
/** Kept as its own name for the callers that ask "may a game card be played?"; today it is the same
 *  set, because the server no longer splits a mode pick from any other edit. */
export const MODE_PICK_PHASES = CONFIG_EDITABLE_PHASES;
export function lockedReason(phase: string): string {
  if (phase === 'armed') return 'GAME SETTINGS ARE LOCKED — THE MATCH IS ARMED. ABORT ON THE MATCH TAB RETURNS IT TO THE LOBBY.';
  if (phase === 'live') return 'GAME SETTINGS ARE LOCKED — THE MATCH IS LIVE. END OR RECALL IT ON THE MATCH TAB TO EDIT THE GAME AGAIN.';
  return `GAME SETTINGS ARE LOCKED — THE MATCH IS ALREADY IN ${phase.toUpperCase()}.`;
}

export function Games() {
  const { state, modes, weapons, perks, run, api, setView, openDesigner } = useStore();
  const [games, setGames] = useState<SavedGame[]>([]);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [confirmSwitch, setConfirmSwitch] = useState<string | null>(null);   // tapping a card while the draft is TUNED — NOT SAVED (review #16)
  const [editing, setEditing] = useState(false);        // the ACTIVE state's EDIT draft is open
  const [draftDirty, setDraftDirty] = useState(false);  // ...and whether it actually holds a change (`GameEditPanel`'s own `dirty`, mirrored up)
  const [picking, setPicking] = useState(false);        // ...and the card shelves are showing under it
  const [busy, setBusy] = useState(false);              // a LOAD / RE-PUSH is in flight
  const [recentLoad, setRecentLoad] = useState(false);  // the few seconds after one, so the count reads as moving
  const reload = useCallback(() => api.getPresets().then(setGames).catch(() => {}), [api]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { if (!recentLoad) return; const h = setTimeout(() => setRecentLoad(false), 4_000); return () => clearTimeout(h); }, [recentLoad]);
  // Bench 2026-09-17: `editing` must never outlive its own draft UI. The EDIT panel only renders
  // while `loaded` (below) is true, so if a game were ever to become un-loaded with `editing` still
  // true (an older server's snapshot, a finished match rolling forward under this tab), the operator
  // would be left with `guarded()` refusing a pick over a draft they can no longer see, let alone
  // cancel. Reset both the moment there is nothing loaded to edit.
  const loaded = !!state?.game?.loaded || !!state?.lobby?.pushed;
  useEffect(() => { if (!loaded) { setEditing(false); setDraftDirty(false); } }, [loaded]);
  if (!state) return null;
  const cfg = state.config;
  const locked = !CONFIG_EDITABLE_PHASES.has(state.phase);          // VENUE / LOAD / EDIT / playing a card
  const modeLocked = !MODE_PICK_PHASES.has(state.phase);
  // F141 polish (field 2026-09-12): the applied config's OWN pool, server-computed — a policy that
  // excludes every weapon in a slot can reach `state.config` from a saved game or a race even without
  // visiting DESIGNER this session, and `state.py push_config` refuses such a head
  // (`_primary_pool_refusal`), so LOAD has to refuse it here too rather than at the whistle.
  const poolEmpty = emptyRequiredSlots(state.loadout_pool);
  const poolEmptyReason = poolEmpty.any
    ? [poolEmpty.primary && poolEmptyMessage('PRIMARY', state.loadout_pool.reasons!.primary!),
       poolEmpty.secondary && poolEmptyMessage('SECONDARY', state.loadout_pool.reasons!.secondary_weapons!),
       poolEmpty.perk && poolEmptyMessage('PERK', state.loadout_pool.reasons!.perks!)].filter(Boolean).join(' ')
    : '';
  const blocked = locked || poolEmpty.any;
  const blockedReason = locked ? lockedReason(state.phase) : poolEmpty.any ? poolEmptyReason : undefined;
  const sig = gameSig(cfg);
  // identity = the game the server APPLIED (a duplicate is content-identical to its source — review #0); content match is the fallback for an older MC
  const activeSaved = (state.active_preset_id ? games.find(g => g.preset_id === state.active_preset_id) : null) ?? (state.active_preset_id === undefined ? games.find(g => gameSig(g.config) === sig) : null) ?? null;
  const mode = modes.find(m => m.mode === cfg.mode);
  const activeStock = !activeSaved && mode && gameSig({ ...mode.defaults, teams: cfg.teams }) === sig ? mode : null;   // stock defaults, untouched
  const custom = !activeSaved && !activeStock;   // a tuned draft nobody saved yet
  const venue = { environment: cfg.environment, night: cfg.night };
  const title = activeSaved?.name ?? mode?.name ?? cfg.mode;

  // ---- has a game been LOADED? -----------------------------------------------------------------
  // `game.loaded` is the key, NOT `lobby.pushed`. A LOAD announces the game to the phones and
  // deliberately does not write a gun, so `pushed` no longer becomes true at LOAD — that split is the
  // whole point. A lobby push still implies a loaded game (and is what an older server without a
  // `game` block reports), so it counts too. Both survive armed/live and both are dropped by
  // `_finish()`, so a debrief shows the card picker with the last game still selected: LOAD (or
  // RECAP's NEXT MATCH) starts the next match on it. (`loaded` itself is computed above, before the
  // early return, so the editing-reset effect can see it too.)
  const gate = pushGate(state);
  const gameSent = state.game?.sent ?? 0;
  const gameTotal = state.game?.total ?? state.players.length;

  // a TUNED (unsaved) draft is discarded by playing something else — ask once (review #16). Only the
  // PHASE lock applies here — `poolEmpty` describes the config ALREADY applied, and picking a
  // DIFFERENT game/mode is exactly how an operator escapes a bad one; it must never be the gate that
  // traps them.
  // MERGE-3 (round-3 fix pass, 2026-09-13): in RECAP, tapping the game you just played is "run it
  // back". Since 2026-09-16 LOAD does the same with no tap, and so does RECAP's NEXT MATCH.
  const runItBack = state.phase === 'recap';
  const tappable = (on: boolean) => !on || runItBack;
  // F-6 (2026-09-13): a mode/game switch RESHAPES the roster onto the target's own declared teams
  // (round-3 FIELD-1's index-map + rebalance — no longer "everyone onto teams[0]", but still a move).
  const splitFor = (targetTeams: { team_id: string }[]) => splitLine(state.players, cfg.teams, targetTeams);
  const guarded = (key: string, targetTeams: { team_id: string }[], go: () => void) => {
    // F.2 (2026-09-13): the loaded state shows the EDIT draft and "PLAY A DIFFERENT GAME" on screen
    // together, and a card tap here used to call `putConfig`/`applyPreset` IMMEDIATELY. The draft
    // stayed open, but its patch is diffed against `cfg` (`GameEditPanel`'s `patchOf`), and this tap
    // had just moved `cfg` out from under it -- so SAVE would then send a patch against a game nobody
    // drafted.
    //
    // REVISED (bench 2026-09-17): the fix above was a REFUSAL — "FINISH EDITING FIRST... BEFORE
    // PICKING ANOTHER GAME" — and Tony hit it stone cold: he had opened EDIT, left it, forgotten it
    // was open, and got a sticky error with no visible draft on screen to finish or cancel. Tony's
    // call: picking another game while a draft is open DISCARDS the draft and proceeds, same as any
    // other "this drops your unsaved game" case on this screen (`custom` below). No error either way
    // -- only a one-line, auto-clearing notice, and only when the draft actually held a change.
    if (editing) {
      setEditing(false);
      if (draftDirty) setNotice('UNSAVED EDITS DISCARDED', false, 4_000);
      setDraftDirty(false);
    }
    if (modeLocked) { setNotice(lockedReason(state.phase), true); return; }   // never a silent tap (F151)
    if ((custom || splitFor(targetTeams)) && confirmSwitch !== key) { setConfirmSwitch(key); return; }
    setConfirmSwitch(null); go();
  };
  const playSaved = (g: SavedGame) => guarded(g.preset_id, g.config.teams, async () => {
    const r = await run(() => api.applyPreset(g.preset_id));
    if (r) await run(() => api.putConfig(venue));   // the venue is tonight's, never the saved game's
  });
  const playStock = (m: ModeInfo) => guarded(m.mode, m.defaults.teams, async () => { await run(() => api.putConfig({ ...m.defaults, ...venue, volume: null, config_id: cfg.config_id })); });   // K8: a stock game plays at the venue volume
  // COPY / MAKE MY OWN open the designer as an UNSAVED draft named after the source — nothing is written until SAVE (review #23)
  const copyOf = (g: SavedGame) => openDesigner({ game: g, copy: true });
  const remove = async (g: SavedGame) => { await run(() => api.deletePreset(g.preset_id)); setConfirmDel(null); await reload(); };

  /** LOAD — tell every connected phone WHICH GAME is loaded. It writes no gun.
   *
   *  `POST /api/games/load` → `state.py load_game()`, which pushes an `assign` (the kind that carries
   *  a game and no head; a `config` cannot express "no frames" — `envelope.REQUIRED` makes them
   *  mandatory). Weapons reach the guns at the LOBBY push, after kitting. */
  const load = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await run(() => api.loadGame());
      if (r !== undefined) setRecentLoad(true);
    } finally { setBusy(false); }
  };
  /** …and the re-push, which IS a gun write: the same call LOBBY's own buttons make. Only reachable
   *  once a real push has happened, because before that there is no head on a gun to be stale. */
  const rePush = async (force: boolean) => {
    if (busy) return;
    setBusy(true);
    try { await run(() => api.pushLobby(force)); } finally { setBusy(false); }
  };

  // ---- LOAD's gate ----------------------------------------------------------------------------
  // An announcement is NOT a push, so the push's refusals do not apply to it: the one-team fault,
  // The config proofs and "a phone has not arrived" are every one of them about a HEAD being
  // written, and LOAD writes none. What does apply is the phase — `load_game` refuses in armed/live —
  // and an empty required pool, which is a game nobody can be kitted for and is worth stopping at the
  // door rather than at the whistle.
  const loadDisabled = blocked || busy;
  const loadWhy = blockedReason ?? '';
  // The honest predicate, not the server's `all_acked` (which is vacuously true while no phone is
  // bound -- see `LoadStatus`): with 0 of 8 answering, a re-push is exactly what this screen should
  // still be offering, and the rail must not paint itself green.
  const everyoneAcked = gate.total > 0 && gate.acked >= gate.total;
  // The cure for a stale HEAD belongs to the push that writes heads, so it appears only once there
  // has been one. Before that there is nothing on a gun to be stale.
  const showRePush = state.lobby.pushed && !locked && (gate.curableRows.length > 0 || !everyoneAcked);
  // M12 (visual QA 2026-09-23): this read "The game is on the guns" whenever a game was LOADED, and a
  // LOAD writes no gun. Only a LOBBY push puts a config on the guns, so say which one has happened.
  const continueKitTitle = state.lobby.pushed
    ? 'The guns hold this config. This takes the phones to their kit screens.'
    : 'The game is sent to the phones. The guns are configured at the lobby push, after kitting. This takes the phones to their kit screens.';
  const faults = gate.redRows.map(b => ({ who: b.sticker, why: b.blockers ?? [] }));
  const notOnlyStale = gate.redRows.filter(b => !((b.blockers ?? []).length > 0 && (b.blockers ?? []).every(w => w.startsWith(STALE_ACK_FAULT))));

  // VENUE is where you are playing, not what game it is — so it applies straight away, the way it
  // always has, rather than waiting behind a draft. The ONE moment that would contradict is while the
  // EDIT draft is open, because the draft owns NIGHT OPS too: two live controls for one field, with
  // different semantics, three inches apart. The strip stands down for exactly that moment and says
  // where the control went (a real `fieldset disabled`, plus a guard, never a tap that does nothing).
  const venueInert = locked || editing;
  const venueChips = (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
      <fieldset disabled={venueInert} style={{ border: 'none', margin: 0, padding: 0 }}>
        <div role="group" aria-label="venue" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '6px 12px', border: `1px solid ${T.line}`, background: T.panelDeep, opacity: venueInert ? 0.5 : 1 }}>
          <span style={{ font: F.mono(600, 11), letterSpacing: '.24em', color: T.dim }}>VENUE</span>
          <Seg value={cfg.environment} options={[{ value: 'indoor', label: 'INDOOR' }, { value: 'outdoor', label: 'OUTDOOR' }]} onChange={v => { if (!venueInert) run(() => api.putConfig({ environment: v })); }} pad="9px 14px" />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, font: F.chk(600, 11), letterSpacing: '.14em', color: cfg.night ? T.ink : T.dim }}>NIGHT OPS <Toggle on={cfg.night} onChange={v => { if (!venueInert) run(() => api.putConfig({ night: v })); }} label="night ops" /></span>
          {editing && <span data-testid="venue-in-draft" style={{ font: F.mono(500, 11), letterSpacing: '.1em', color: T.warn }}>IN THE DRAFT BELOW</span>}
        </div>
      </fieldset>
      {/* Bench 2026-09-17: NIGHT OPS was tapped mid-match and the LEDs did not change, with nothing on screen to
          say why. The venue is part of the config, and a config push to a gun in play clears `spawned`, so it
          stays locked until the match ends. Kept OUTSIDE the faded fieldset so the reason is readable. */}
      {locked && <span data-testid="venue-locked" style={{ font: F.mono(600, 11), letterSpacing: '.1em', color: T.dim }}>LOCKED WHILE THE MATCH IS {state.phase.toUpperCase()}</span>}
      {/* F162 (revised 2026-09-16): this is a NUMBER MC sends and a PHYSICAL switch on every gun
          that MC cannot reach, so a quiet link to the how-to sits right beside the control that raises
          the question, not a dismissable banner nagging every screen, see ui/VenueModeReminder.
          Kept OUTSIDE the fieldset above: the link works whether or not venue itself is editable right
          now (F-review 2026-09-16), so it must not fade into the disabled group. */}
      <VenueModeManualLink />
    </div>
  );

  const errorsAndWarnings = (
    <>
      {(state.config_warnings?.length ?? 0) > 0 && (
        <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* `SETUP: ` = a PHYSICAL step on the field the operator must do before the push (F70: power-cycle
              the grenade so the hill starts NEUTRAL, set hill mode, place it). It is not a technical advisory
              like the $SIR/frag-limit warnings, which stay out of this rail — see mc/API.md. */}
          {[...state.config_warnings!].filter(w => /LOADOUTS? RESET/i.test(w) || /^SETUP:/i.test(w)).map((w, i) => <div key={i} style={{ font: F.chk(700, 12), letterSpacing: '.14em', color: T.accInk, background: T.warn, padding: '6px 10px', alignSelf: 'flex-start' }}>▲ {w.toUpperCase()}</div>)}
        </div>
      )}
      {/* Review finding, 2026-09-19: a friendly heads-up, never a blocker -- a mixed fleet plays fine,
          it just keeps the OLD spawn-protection rules until the phone updates. */}
      {gate.respawnRulesWarning && (
        <div role="status" style={{ font: F.chk(700, 12), letterSpacing: '.06em', color: T.accInk, background: T.warn, padding: '6px 10px', alignSelf: 'flex-start' }}>▲ {gate.respawnRulesWarning}</div>
      )}
      {/* A refusal is the one thing here the operator MUST be able to read: these are the server's
          validate() errors (a missing/unknown station_source, F82's yellow roster, F88's second
          control point) and they name the fix. */}
      {state.config_errors.length > 0 && <div role="alert" style={{ font: F.mono(500, 11.5), lineHeight: 1.5, letterSpacing: '.08em', color: T.bad, background: 'rgba(255,82,82,.08)', border: `1px solid ${T.bad}`, padding: '7px 10px' }}>▲ {state.config_errors.join(' · ').toUpperCase()}</div>}
    </>
  );

  // ------------------------------------------------------------------ the card shelves (pick a game)
  const shelves = (
    <div style={{ flex: '2 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* YOUR GAMES */}
      <div>
        <SectionRule label={`YOUR GAMES // ${games.length}`} hint="TAP TO PLAY · EDIT TO CHANGE · CREATE FOR SOMETHING NEW" style={{ marginBottom: 12 }} />
        <Shelf>
          {games.map(g => {
            const on = activeSaved?.preset_id === g.preset_id;
            const gm = modes.find(m => m.mode === g.config.mode);
            const del = confirmDel === g.preset_id;
            return (
              <div key={g.preset_id} className="hov-acc" role="button" tabIndex={0} aria-pressed={on} aria-label={`play ${g.name}`} onClick={() => { if (tappable(on)) playSaved(g); }} onKeyDown={onKey(() => { if (tappable(on)) playSaved(g); })}
                style={{ flex: '0 0 262px', display: 'flex', flexDirection: 'column', gap: 8, padding: 10, cursor: tappable(on) ? 'pointer' : 'default',
                  background: on ? 'rgba(196,139,255,.07)' : T.panel, border: `1px solid ${on ? PERK_COLOR : T.line}`, borderTop: `2px solid ${on ? PERK_COLOR : T.line2}` }}>
                <StripedSlot height={70} style={{ background: gm && MODE_ART.has(gm.mode) ? `url(assets/modes/${gm.mode}.jpg) center/cover no-repeat` : undefined, overflow: 'hidden' }}
                  corner={<>
                    {!(gm && MODE_ART.has(gm.mode)) && <ModeEmblem mode={g.config.mode} />}
                    <span style={{ position: 'absolute', top: 6, left: 6, font: F.osw(700, 12), letterSpacing: '.12em', background: on ? PERK_COLOR : T.panelAlt, color: on ? T.accInk : T.dim, padding: '2px 7px' }}>{gm?.abbr ?? g.config.mode.toUpperCase()}</span>
                    {on && <span style={{ position: 'absolute', top: 6, right: 6 }}><Tag size={11} color={PERK_COLOR}>PLAYING</Tag></span>}
                    {g.builtin && !on && <span style={{ position: 'absolute', top: 8, right: 6, font: F.mono(500, 11), letterSpacing: '.14em', color: T.dim, textShadow: '0 1px 4px #000' }}>BUILT-IN</span>}
                  </>} />
                <div style={{ font: F.osw(600, 17), letterSpacing: '.06em', lineHeight: 1.1, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{g.name.toUpperCase()}</div>
                <div style={{ font: F.mono(500, 11), letterSpacing: '.1em', color: T.acc, lineHeight: 1.5 }}>{rulesLine(g.config, weapons, perks)}</div>
                <div style={{ font: F.chk(500, 12), color: T.dim, lineHeight: 1.45, flex: 1, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{g.desc || `${gm?.name ?? g.config.mode} · ${Math.round((g.config.time_limit_s ?? 0) / 60)} MIN · ${
                  healthPresetOf(g.config.health) === 'custom'
                    ? `HP ${g.config.health.max_hp} / ARMOR ${g.config.health.max_armor}${g.config.health.max_shield ? ` / SHIELD ${g.config.health.max_shield}` : ''}`
                    : HEALTH_PRESET_COPY.find(p => p.value === healthPresetOf(g.config.health))!.label
                }`}</div>
                {confirmSwitch === g.preset_id && (
                  <SwitchConfirm dropsDraft={custom} split={splitFor(g.config.teams)} action="TAP AGAIN TO PLAY THIS" />
                )}
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                  {del ? (
                    <>
                      <SmallBtn color={T.bad} onClick={() => remove(g)}>CONFIRM DELETE</SmallBtn>
                      <SmallBtn onClick={() => setConfirmDel(null)}>CANCEL</SmallBtn>
                    </>
                  ) : (
                    <>
                      {!g.builtin && <SmallBtn onClick={() => openDesigner({ game: g })} label={`edit ${g.name}`}>EDIT</SmallBtn>}
                      <SmallBtn onClick={() => copyOf(g)} label={`copy ${g.name}`}>{g.builtin ? 'MAKE MY OWN' : 'COPY'}</SmallBtn>
                      {!g.builtin && <SmallBtn onClick={() => setConfirmDel(g.preset_id)} label={`delete ${g.name}`} color={T.micro}>✕</SmallBtn>}
                    </>
                  )}
                </div>
              </div>
            );
          })}
          <button type="button" className="hov-acc" onClick={() => openDesigner({ mode: cfg.mode })} aria-label="create a game"
            style={{ ...BTN_RESET, flex: '0 0 220px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 6, padding: 14, minHeight: 120, background: T.panelDeep, border: `1px dashed ${T.line2}`, cursor: 'pointer', color: T.dim, textAlign: 'left' }}>
            <span style={{ font: F.osw(700, 22), letterSpacing: '.08em', color: T.ink }}>+ CREATE A GAME</span>
            <span style={{ font: F.chk(500, 12), lineHeight: 1.45 }}>Start from a stock mode, set the rules and who carries what, save it under a name.</span>
          </button>
        </Shelf>
      </div>

      {/* STOCK MODES */}
      <div>
        <SectionRule label="STOCK MODES" hint="TAP TO PLAY WITH DEFAULTS · CUSTOMIZE TO MAKE YOUR OWN" style={{ marginBottom: 12 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>
          {modes.map(m => {
            const on = activeStock?.mode === m.mode;
            const base = !on && cfg.mode === m.mode;   // the current game (saved or tuned) is built on this mode
            return (
              <div key={m.mode} className="hov-acc" role="button" tabIndex={0} aria-pressed={on} aria-label={`play ${m.name}`} onClick={() => { if (tappable(on)) playStock(m); }} onKeyDown={onKey(() => { if (tappable(on)) playStock(m); })}
                style={{ background: on ? 'rgba(57,180,255,.06)' : T.panel, border: `1px solid ${on ? T.acc : T.line}`, borderTop: `2px solid ${on ? T.acc : base ? T.line2 : 'transparent'}`, padding: 10, display: 'flex', flexDirection: 'column', gap: 10, cursor: tappable(on) ? 'pointer' : 'default' }}>
                <StripedSlot height={76} style={{ background: MODE_ART.has(m.mode) ? `url(assets/modes/${m.mode}.jpg) center/cover no-repeat` : undefined, overflow: 'hidden' }}
                  corner={<>
                    {!MODE_ART.has(m.mode) && <ModeEmblem mode={m.mode} />}
                    <span style={{ position: 'absolute', top: 6, left: 6, font: F.osw(700, 12), letterSpacing: '.12em', background: on ? T.acc : T.panelAlt, color: on ? T.accInk : T.dim, padding: '2px 7px' }}>{m.abbr}</span>
                    {on && <span style={{ position: 'absolute', top: 6, right: 6 }}><Tag size={11}>PLAYING</Tag></span>}
                    {base && <span style={{ position: 'absolute', top: 6, right: 6 }}><Tag size={11} color={T.line2} ink={T.ink}>BASE</Tag></span>}
                  </>} />
                <div style={{ flex: 1 }}>
                  <div style={{ font: F.osw(600, 15), letterSpacing: '.08em' }}>{m.name}</div>
                  <div style={{ font: F.chk(500, 12), color: T.dim, marginTop: 3 }}>{m.desc}</div>
                  {confirmSwitch === m.mode && (
                    <SwitchConfirm dropsDraft={custom} split={splitFor(m.defaults.teams)} action="TAP AGAIN" style={{ marginTop: 6 }} />
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                  <SmallBtn onClick={() => openDesigner({ mode: m.mode })} label={`customize ${m.name}`}>CUSTOMIZE ▸</SmallBtn>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  return (
    <div className="screen">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '14px 28px', marginBottom: 20 }}>
        <div>
          <div style={{ font: F.mono(600, 10), letterSpacing: '.3em', color: T.acc }}>[ A2 // GAMES ]</div>
          {/* int-n1 (2026-09-13): "Active Game Config" fused the two words this whole screen exists to
              keep apart -- the GAME is announced to phones, the CONFIG is what gets pushed to guns.
              "Loaded Game" names only the fact this title is entitled to: something has been LOADED.
              The testid stays `active-game-config` -- a stable hook, not operator-facing copy. */}
          <div style={{ font: F.osw(700, 30), letterSpacing: '.1em', textTransform: 'uppercase', marginTop: 2 }}>{loaded ? 'Loaded Game' : 'Pick the Game'}</div>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
          {/* VENUE — where you're playing, not what game it is */}
          {venueChips}
          {loaded ? (
            <span data-testid="game-continue-kit">
              <PrimaryButton disabled={locked} title={locked ? blockedReason : continueKitTitle}
                onClick={async () => { await run(() => api.setPhase('kit')); setView('kit'); }}>CONTINUE TO KIT ▸</PrimaryButton>
            </span>
          ) : (
            <span data-testid="game-load">
              <PrimaryButton disabled={loadDisabled} title={loadDisabled ? (loadWhy || 'Not ready to load yet') : 'Sends this game to every connected phone — mode, teams, health, night, respawn, venue and the rules. It does NOT write the guns: weapons go with the arm, at the lobby push after kitting.'}
                onClick={() => load()}>{busy ? 'LOADING…' : 'LOAD ▸'}</PrimaryButton>
            </span>
          )}
        </div>
      </div>
      {blocked && (
        <div role="alert" data-testid="games-locked" style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          background: 'rgba(255,82,82,.08)', border: `1px solid ${T.bad}`, borderLeft: `3px solid ${T.bad}`, padding: '12px 16px' }}>
          <span style={{ font: F.chk(700, 12), letterSpacing: '.06em', color: T.bad, lineHeight: 1.5 }}>▲ {blockedReason}</span>
          {(state.phase === 'armed' || state.phase === 'live') && (
            <GhostButton size={11} pad="8px 14px" color={T.ink} border={T.bad} onClick={() => setView(state.phase)}>JUMP TO MATCH ▸</GhostButton>
          )}
        </div>
      )}
      {loaded ? (
        <div data-testid="active-game-config" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* WHAT THE GUNS ARE HOLDING — the answer to "did it push?", above everything else. */}
          <div style={{ background: `linear-gradient(180deg,${T.panelSoft},${T.panelDeep})`, border: `1px solid ${T.line}`, borderLeft: `3px solid ${state.lobby.pushed && everyoneAcked ? T.ok : T.warn}` }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 20px', padding: '14px 18px' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ font: F.mono(600, 11), letterSpacing: '.26em', color: custom ? T.warn : activeSaved ? PERK_COLOR : T.acc }}>{custom ? 'TUNED — NOT SAVED' : activeSaved ? 'SAVED GAME' : 'STOCK MODE'} // LOADED</div>
                <div data-testid="playing-title" style={{ font: F.osw(700, 28), letterSpacing: '.08em', textTransform: 'uppercase', marginTop: 2, lineHeight: 1.1 }}>{title}</div>
              </div>
              <span style={{ flex: 1 }} />
              {/* TWO different facts, never merged into one tick: how many PHONES were told about the
                  game (LOAD, delivery), and how many GUNS are confirmed on the head (the lobby push).
                  The second only exists once there has been a push, and saying nothing is the honest
                  answer until then — a gun count before any push would be a count of nothing. */}
              {/* F.3 (2026-09-13): rendered unconditionally, this read "GAME SENT TO 0/N PHONES" on a
                  server too old to send a `game` block at all -- `gameSent`/`gameTotal` fall back to
                  0 and the roster size, which LOOKS like a real (and alarming) delivery count instead
                  of "this server never told us". Absence is a different fact from zero, and only one
                  of them is true here. */}
              {state.game && <GameSentStatus testid="game-load-status" sent={gameSent} total={gameTotal} recent={recentLoad} />}
              {state.lobby.pushed
                ? <LoadStatus testid="game-gun-status" pushed acked={gate.acked} total={gate.total} recent={false} />
                : <span data-testid="game-gun-status" style={{ font: F.mono(500, 11), letterSpacing: '.12em', color: T.micro }}>GUNS NOT CONFIGURED YET — WEAPONS GO AT THE LOBBY PUSH, AFTER KITTING</span>}
              {showRePush && (
                <button type="button" data-repush="1" data-repush-force={gate.pushBlockedCount > 0 ? '1' : undefined}
                  className={busy ? undefined : 'hov-acc-ink hit44'} disabled={busy || !!gate.rosterFault}
                  style={{ ...BTN_RESET, cursor: busy || gate.rosterFault ? 'not-allowed' : 'pointer',
                           color: busy || gate.rosterFault ? T.micro : gate.pushBlockedCount > 0 ? T.warn : T.acc,
                           font: F.chk(700, 13), letterSpacing: '.06em', minHeight: 44, padding: '0 6px' }}
                  title={gate.rosterFault ?? 'Compiles and sends this config to every gun again. The ack count drops to 0 and climbs as each one answers.'}
                  onClick={() => rePush(gate.pushBlockedCount > 0)}>
                  {busy ? 'RE-PUSHING…' : gate.pushBlockedCount > 0 ? `RE-PUSH CONFIG OVER ${gate.pushBlockedCount} BLOCKED ▸` : 'RE-PUSH CONFIG ▸'}
                </button>
              )}
              {!editing && (
                <span data-testid="game-edit-open">
                  <GhostButton size={12} pad="10px 16px" color={T.ink} border={T.line2} disabled={locked}
                    title={locked ? lockedReason(state.phase) : 'Open this game for editing. Nothing is sent until SAVE AND LOAD.'}
                    onClick={() => { if (!locked) { setDraftDirty(false); setEditing(true); } }}>EDIT ▸</GhostButton>
                </span>
              )}
            </div>
            {/* The same sentence LOBBY's rail carries, from the same derivation: a stale ack names the
                guns and the cure, a red names what cannot be pushed away, and a clean board says so. */}
            <div style={{ padding: '0 18px 14px', font: F.chk(600, 13), lineHeight: 1.5,
                          color: faults.length ? T.bad : gate.waitRows.length ? T.micro : everyoneAcked ? T.ok : T.warn }}>
              {gate.staleAckLine
                || (faults.length ? `${faults.length} gun${faults.length === 1 ? '' : 's'} cannot start`
                  : gate.waitWhy
                    || (!state.lobby.pushed
                        // int-n1 (2026-09-13): this used to say "The phones have the game" whenever the
                        // readiness board was clean, WITHOUT checking delivery -- a fact from a
                        // different server call (`state.game.sent/total`) that can lag behind a LOAD
                        // for as long as a phone takes to answer. The two diverge for real, right after
                        // LOAD, so the claim could sit directly under a counter reading 5 of 8.
                        ? (state.game && gameSent < gameTotal
                            ? `${gameSent} of ${gameTotal} phone${gameTotal === 1 ? '' : 's'} have the game so far — the rest are not connected. Kitting is next, and the guns are configured at the lobby push.`
                            : 'The phones have the game. Kitting is next, and the guns are configured at the lobby push.')
                        : !everyoneAcked ? `No config echo from ${gate.noEcho.join(', ') || 'some guns'} — headset off, or gun asleep?`
                          // F318: under the LOCKED banner there is nothing to adjust, so say what is true.
                          : locked ? 'Every gun is holding this config. The banner above says how to edit it again.'
                            : 'Every gun is holding this config. Adjust it here and SAVE AND LOAD, or continue to KIT.'))}
              {gate.staleAckLine && notOnlyStale.length > 0 && (
                <span style={{ color: T.micro }}>{`  ·  ${notOnlyStale.length} gun${notOnlyStale.length === 1 ? '' : 's'} cannot start`}</span>
              )}
            </div>
            {faults.length > 0 && (
              <div style={{ borderTop: `1px solid ${T.line}`, padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {faults.map(f => (
                  <div key={f.who} style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ font: F.osw(700, 15), letterSpacing: '.06em', color: T.ink, minWidth: 130 }}>{f.who}</span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {f.why.map(w => {
                        const { head, hint } = splitBlocker(w);
                        return (
                          <span key={w} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <span style={{ font: F.chk(600, 12), color: T.bad }}>▲ {head}</span>
                            {hint && <span style={{ font: F.chk(500, 11.5), color: T.micro, textTransform: 'none', paddingLeft: 14 }}>{sentenceCase(hint)}</span>}
                          </span>
                        );
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {editing
            ? <GameEditPanel alwaysOpen onDone={() => { setEditing(false); setDraftDirty(false); }} onDirtyChange={setDraftDirty} />
            : <GameSettings testid="game-settings" rows={gameSettingRows(cfg, mode, weapons, perks, { full: true, players: state.players })} />}
          {errorsAndWarnings}

          {/* The way back to the shelves: a different game is still one tap away, it just is not what
              this tab is FOR any more once something is loaded. */}
          <div>
            <button type="button" data-testid="pick-another" className="hov-acc" onClick={() => setPicking(p => !p)} aria-expanded={picking}
              style={{ ...BTN_RESET, font: F.chk(700, 12), letterSpacing: '.18em', color: T.dim, border: `1px solid ${T.line}`, padding: '10px 16px', minHeight: 44, cursor: 'pointer' }}>
              {picking ? '▾' : '▸'} PLAY A DIFFERENT GAME
            </button>
            {picking && (
              <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
                {shelves}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
          {shelves}
          {/* THE GAME — what the players will get */}
          <div style={{ flex: '1 1 330px', maxWidth: 480, position: 'sticky', top: 12, display: 'flex', flexDirection: 'column', gap: 0, background: `linear-gradient(180deg,${T.panelSoft},${T.panelDeep})`, border: `1px solid ${T.line}`, borderLeft: `3px solid ${custom ? T.warn : activeSaved ? PERK_COLOR : T.acc}` }}>
            <div style={{ padding: '14px 18px 0' }}>
              <div style={{ font: F.mono(600, 11), letterSpacing: '.26em', color: custom ? T.warn : activeSaved ? PERK_COLOR : T.acc }}>{custom ? 'TUNED — NOT SAVED' : activeSaved ? 'SAVED GAME' : 'STOCK MODE'} // PLAYING</div>
              <div data-testid="playing-title" style={{ font: F.osw(700, 28), letterSpacing: '.08em', textTransform: 'uppercase', marginTop: 2, lineHeight: 1.1 }}>{title}</div>
            </div>
            {mode && MODE_ART.has(mode.mode) && (
              <div style={{ margin: '12px 18px 0', aspectRatio: '2816 / 1536', background: `url(assets/modes/${mode.mode}.jpg) center/contain no-repeat, ${T.inset}`, border: `1px solid ${T.line2}` }} />
            )}
            <div style={{ padding: '12px 18px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ font: F.chk(500, 13), lineHeight: 1.55, color: T.body }}>{activeSaved?.desc || mode?.brief}</div>
              {/* H1 (visual QA 2026-09-23): one column in this narrow rail. `minCol={9999}` asked for a
                  9999 px track, so every value sat far off the right edge and read as blank. */}
              <GameSettings testid="rail-settings" style={{ gridTemplateColumns: 'minmax(0,1fr)' }} rows={gameSettingRows(cfg, mode, weapons, perks)} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <span data-testid="rail-designer"><GhostButton size={11} pad="8px 14px" onClick={() => openDesigner(activeSaved && !activeSaved.builtin ? { game: activeSaved } : { fromLive: true, game: activeSaved ?? undefined, copy: !!activeSaved })} title="Open this game in the designer">{activeSaved && !activeSaved.builtin ? 'EDIT THIS GAME ▸' : custom ? 'SAVE THIS AS A GAME ▸' : activeSaved ? 'MAKE MY OWN ▸' : 'CUSTOMIZE ▸'}</GhostButton></span>
              </div>
              {errorsAndWarnings}
              <div style={{ font: F.mono(500, 11), letterSpacing: '.12em', color: T.micro, lineHeight: 1.6 }}>VENUE = WHERE YOU ARE PLAYING TONIGHT (NOT PART OF THE GAME). LOAD ▸ SENDS THIS GAME TO EVERY CONNECTED PHONE AND KEEPS YOU HERE, ON THE ACTIVE GAME CONFIG, WHERE YOU CAN EDIT IT AND LOAD AGAIN. IT DOES NOT WRITE THE GUNS — WEAPONS GO WITH THE ARM, AT THE LOBBY PUSH AFTER KITTING. CONTINUE TO KIT ▸ IS THEN ONE TAP. A "BASE" TAG MARKS THE STOCK MODE THE PLAYING GAME IS BUILT ON.</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SmallBtn({ children, onClick, color = T.dim, label }: { children: React.ReactNode; onClick: () => void; color?: string; label?: string }) {
  return (
    <button type="button" className="hov-acc" onClick={onClick} aria-label={label}
      style={{ ...BTN_RESET, font: F.chk(700, 11), letterSpacing: '.14em', color, border: `1px solid ${color === T.dim ? T.line : color}`, padding: '8px 12px', minHeight: 40, cursor: 'pointer' }}>
      {children}
    </button>
  );
}
