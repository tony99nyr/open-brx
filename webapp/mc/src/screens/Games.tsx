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
// LOAD deliberately does NOT advance to KIT. `state.py push_config` sets the phase to `lobby` itself,
// so the tab holds that advance (`store.holdPhase`) rather than being thrown onto the LOBBY screen by
// its own success — a tab cannot "change state to active game config" if it navigates away. CONTINUE
// TO KIT ▸ is the way on, one tap, on the active state.
//
// Defining a game happens in the DESIGNER (opened from here) — this page has no forms.
import { useCallback, useEffect, useState } from 'react';
import { STALE_ACK_FAULT, pushGate, sentenceCase, splitBlocker } from '../api/derive';
import type { ModeInfo, SavedGame } from '../api/types';
import { setNotice } from '../notice';
import { useStore } from '../store';
import { F, PERK_COLOR, T } from '../tokens';
import { BTN_RESET, GhostButton, PrimaryButton, SectionRule, Seg, Shelf, StripedSlot, SwitchConfirm, Tag, Toggle, onKey } from '../ui';
import { emptyRequiredSlots, gameSig, poolEmptyMessage, rulesLine, splitLine } from './gameSummary';
import { MODE_ART } from '../modeArt';
import { VenueModeReminder } from '../ui/VenueModeReminder';
import { GameEditPanel } from '../ui/GameEditPanel';
import { GameSettings, LoadStatus, gameSettingRows } from '../ui/LoadedGame';

/** F151 (field 2026-09-12, ISSUE 25) — `PUT /api/config` (and everything that rides on it: playing a
 *  saved game, playing a stock mode, applying a preset) is only VALID in muster/build/kit/lobby
 *  (mc/API.md). Once the field has moved on — the match is armed or live, or even sitting in the
 *  debrief — a tap here used to fail SILENTLY: the store's `error` is a small dismissable strip the
 *  operator can easily miss, and nothing on the Games screen itself said why nothing happened. This
 *  says which door is still open — and names the RIGHT one: `armed` is undone by ABORT, not RECALL. */
export const CONFIG_EDITABLE_PHASES = new Set(['muster', 'build', 'kit', 'lobby']);
/** Round-2 fix pass (2026-09-12): the lock is SPLIT, because the server splits it.
 *
 *  `state.py set_config` takes ANY config edit in muster/build/kit/lobby; in `recap` it takes exactly
 *  ONE patch — an explicit MODE — and that pick rolls the finished session forward
 *  (`new_session(keep_roster=True)`, landing in BUILD with the roster kept). It refuses everything in
 *  armed/live. */
export const MODE_PICK_PHASES = new Set(['muster', 'build', 'kit', 'lobby', 'recap']);
export function lockedReason(phase: string): string {
  if (phase === 'armed') return 'GAME SETTINGS ARE LOCKED — THE MATCH IS ARMED. ABORT ON THE MATCH TAB RETURNS IT TO THE LOBBY.';
  if (phase === 'live') return 'GAME SETTINGS ARE LOCKED — THE MATCH IS LIVE. END OR RECALL IT ON THE MATCH TAB TO EDIT THE GAME AGAIN.';
  if (phase === 'recap') return 'THIS MATCH ENDED — PICK A MODE TO START THE NEXT ONE, OR NEW MATCH (TOP RIGHT).';
  return `GAME SETTINGS ARE LOCKED — THE MATCH IS ALREADY IN ${phase.toUpperCase()}.`;
}

export function Games() {
  const { state, modes, weapons, perks, run, api, setView, openDesigner, holdPhase } = useStore();
  const [games, setGames] = useState<SavedGame[]>([]);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [confirmSwitch, setConfirmSwitch] = useState<string | null>(null);   // tapping a card while the draft is TUNED — NOT SAVED (review #16)
  const [editing, setEditing] = useState(false);        // the ACTIVE state's EDIT draft is open
  const [picking, setPicking] = useState(false);        // ...and the card shelves are showing under it
  const [busy, setBusy] = useState(false);              // a LOAD / RE-PUSH is in flight
  const [recentLoad, setRecentLoad] = useState(false);  // the few seconds after one, so the count reads as moving
  const reload = useCallback(() => api.getPresets().then(setGames).catch(() => {}), [api]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { if (!recentLoad) return; const h = setTimeout(() => setRecentLoad(false), 4_000); return () => clearTimeout(h); }, [recentLoad]);
  if (!state) return null;
  const cfg = state.config;
  const locked = !CONFIG_EDITABLE_PHASES.has(state.phase);          // VENUE / LOAD / EDIT — the general config edits
  const modeLocked = !MODE_PICK_PHASES.has(state.phase);            // playing a stock mode or a saved game — recap takes these too
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

  // ---- has this config been sent to the guns? -------------------------------------------------
  // `lobby.pushed` is the ONE fact that separates the two states of this tab. It survives armed and
  // live (so a match in play still shows what is loaded, read-only) and `_finish()` drops it, so a
  // debrief is back to picking the next game.
  const gate = pushGate(state);
  const loaded = state.lobby.pushed;

  // a TUNED (unsaved) draft is discarded by playing something else — ask once (review #16). Only the
  // PHASE lock applies here — `poolEmpty` describes the config ALREADY applied, and picking a
  // DIFFERENT game/mode is exactly how an operator escapes a bad one; it must never be the gate that
  // traps them.
  // MERGE-3 (round-3 fix pass, 2026-09-13): in RECAP, tapping the game you just played is "run it
  // back" — the commonest action on that screen, and the server's own documented play-again path.
  const runItBack = state.phase === 'recap';
  const tappable = (on: boolean) => !on || runItBack;
  // F-6 (2026-09-13): a mode/game switch RESHAPES the roster onto the target's own declared teams
  // (round-3 FIELD-1's index-map + rebalance — no longer "everyone onto teams[0]", but still a move).
  const splitFor = (targetTeams: { team_id: string }[]) => splitLine(state.players, cfg.teams, targetTeams);
  const guarded = (key: string, targetTeams: { team_id: string }[], go: () => void) => {
    if (modeLocked) { setNotice(lockedReason(state.phase), true); return; }   // never a silent tap (F151)
    if ((custom || splitFor(targetTeams)) && confirmSwitch !== key) { setConfirmSwitch(key); return; }
    setConfirmSwitch(null); go();
  };
  const playSaved = (g: SavedGame) => guarded(g.preset_id, g.config.teams, async () => {
    const r = await run(() => api.applyPreset(g.preset_id));
    if (r) await run(() => api.putConfig(venue));   // the venue is tonight's, never the saved game's
  });
  const playStock = (m: ModeInfo) => guarded(m.mode, m.defaults.teams, async () => { await run(() => api.putConfig({ ...m.defaults, ...venue, config_id: cfg.config_id })); });
  // COPY / MAKE MY OWN open the designer as an UNSAVED draft named after the source — nothing is written until SAVE (review #23)
  const copyOf = (g: SavedGame) => openDesigner({ game: g, copy: true });
  const remove = async (g: SavedGame) => { await run(() => api.deletePreset(g.preset_id)); setConfirmDel(null); await reload(); };

  /** THE PUSH. The only one on this screen, and the same call LOBBY's own two buttons make
   *  (`api.pushLobby` → `POST /api/lobby/push` → `state.py push_config`), so there is exactly one
   *  way a config reaches a gun and exactly one set of refusals to understand. */
  const load = async (force = false) => {
    if (busy) return;
    setBusy(true);
    const wasPhase = state.phase;
    // A successful push lands the SESSION in `lobby`. The store follows a phase that advances, which
    // would throw this tab onto the LOBBY screen at the exact moment it is supposed to become the
    // ACTIVE GAME CONFIG — so the advance is accounted for before it arrives. On a refusal the phase
    // has not moved, and the baseline goes back to where it was so the next real advance still moves
    // the console.
    holdPhase('lobby');
    try {
      const r = await run(() => api.pushLobby(force));
      if (r === undefined) { holdPhase(wasPhase); return; }
      setRecentLoad(true);
    } finally { setBusy(false); }
  };

  // ---- LOAD's gate, which is the SERVER's (derive.pushGate → state.py push_config) -------------
  // A36/A37's three proofs are cured BY the push, so they never refuse it; a roster with one side
  // populated is refused and `force` does NOT open it; a phone that has not arrived refuses the FIRST
  // push only. Every one of those is the same judgement LOBBY renders, read from the same place.
  const loadDisabled = blocked || busy || gate.refused || gate.pushBlockedCount > 0;
  const loadWhy = blockedReason ?? gate.pushWhy ?? '';
  const canForce = !blocked && !gate.refused && gate.pushBlockedCount > 0;
  // The cure, on this screen too: the same control LOBBY carries and every A36 fault line names.
  // The honest predicate, not the server's `all_acked` (which is vacuously true while no phone is
  // bound -- see `LoadStatus`): with 0 of 8 answering, a re-push is exactly what this screen should
  // still be offering, and the rail must not paint itself green.
  const everyoneAcked = gate.total > 0 && gate.acked >= gate.total;
  const showRePush = loaded && !locked && (gate.curableRows.length > 0 || !everyoneAcked);
  const faults = gate.redRows.map(b => ({ who: b.sticker, why: b.blockers ?? [] }));
  const notOnlyStale = gate.redRows.filter(b => !((b.blockers ?? []).length > 0 && (b.blockers ?? []).every(w => w.startsWith(STALE_ACK_FAULT))));

  // VENUE is where you are playing, not what game it is — so it applies straight away, the way it
  // always has, rather than waiting behind a draft. The ONE moment that would contradict is while the
  // EDIT draft is open, because the draft owns NIGHT OPS too: two live controls for one field, with
  // different semantics, three inches apart. The strip stands down for exactly that moment and says
  // where the control went (a real `fieldset disabled`, plus a guard, never a tap that does nothing).
  const venueInert = locked || editing;
  const venueChips = (
    <fieldset disabled={venueInert} style={{ border: 'none', margin: 0, padding: 0 }}>
      <div role="group" aria-label="venue" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 12px', border: `1px solid ${T.line}`, background: T.panelDeep, opacity: venueInert ? 0.5 : 1 }}>
        <span style={{ font: F.mono(600, 10), letterSpacing: '.24em', color: T.dim }}>VENUE</span>
        <Seg value={cfg.environment} options={[{ value: 'indoor', label: 'INDOOR' }, { value: 'outdoor', label: 'OUTDOOR' }]} onChange={v => { if (!venueInert) run(() => api.putConfig({ environment: v })); }} pad="9px 14px" />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, font: F.chk(600, 11), letterSpacing: '.14em', color: cfg.night ? T.ink : T.dim }}>NIGHT OPS <Toggle on={cfg.night} onChange={v => { if (!venueInert) run(() => api.putConfig({ night: v })); }} label="night ops" /></span>
        {editing && <span data-testid="venue-in-draft" style={{ font: F.mono(500, 11), letterSpacing: '.1em', color: T.warn }}>IN THE DRAFT BELOW</span>}
      </div>
    </fieldset>
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
                <StripedSlot height={70} style={{ background: gm && MODE_ART.has(gm.mode) ? `url(assets/modes/${gm.mode}.jpg) center/cover no-repeat` : undefined }}
                  corner={<>
                    <span style={{ position: 'absolute', top: 6, left: 6, font: F.osw(700, 12), letterSpacing: '.12em', background: on ? PERK_COLOR : T.panelAlt, color: on ? T.accInk : T.dim, padding: '2px 7px' }}>{gm?.abbr ?? g.config.mode.toUpperCase()}</span>
                    {on && <span style={{ position: 'absolute', top: 6, right: 6 }}><Tag size={9} color={PERK_COLOR}>PLAYING</Tag></span>}
                    {g.builtin && !on && <span style={{ position: 'absolute', top: 8, right: 6, font: F.mono(500, 9.5), letterSpacing: '.14em', color: T.dim, textShadow: '0 1px 4px #000' }}>BUILT-IN</span>}
                  </>} />
                <div style={{ font: F.osw(600, 17), letterSpacing: '.06em', lineHeight: 1.1, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{g.name.toUpperCase()}</div>
                <div style={{ font: F.mono(500, 10.5), letterSpacing: '.1em', color: T.acc, lineHeight: 1.5 }}>{rulesLine(g.config, weapons, perks)}</div>
                <div style={{ font: F.chk(500, 12), color: T.dim, lineHeight: 1.45, flex: 1, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{g.desc || `${gm?.name ?? g.config.mode} · ${Math.round((g.config.time_limit_s ?? 0) / 60)} MIN · HP ${g.config.health.max_hp} / ARMOR ${g.config.health.max_armor}`}</div>
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
                <StripedSlot height={76} caption={MODE_ART.has(m.mode) ? undefined : 'mode art'} style={{ background: MODE_ART.has(m.mode) ? `url(assets/modes/${m.mode}.jpg) center/cover no-repeat` : undefined }}
                  corner={<>
                    <span style={{ position: 'absolute', top: 6, left: 6, font: F.osw(700, 12), letterSpacing: '.12em', background: on ? T.acc : T.panelAlt, color: on ? T.accInk : T.dim, padding: '2px 7px' }}>{m.abbr}</span>
                    {on && <span style={{ position: 'absolute', top: 6, right: 6 }}><Tag size={9}>PLAYING</Tag></span>}
                    {base && <span style={{ position: 'absolute', top: 6, right: 6 }}><Tag size={9} color={T.line2} ink={T.ink}>BASE</Tag></span>}
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
          <div style={{ font: F.osw(700, 30), letterSpacing: '.1em', textTransform: 'uppercase', marginTop: 2 }}>{loaded ? 'Active Game Config' : 'Pick the Game'}</div>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
          {/* VENUE — where you're playing, not what game it is */}
          {venueChips}
          {loaded ? (
            <span data-testid="game-continue-kit">
              <PrimaryButton disabled={locked} title={locked ? blockedReason : 'The game is on the guns. This takes the phones to their kit screens.'}
                onClick={async () => { await run(() => api.setPhase('kit')); setView('kit'); }}>CONTINUE TO KIT ▸</PrimaryButton>
            </span>
          ) : (
            <span data-testid="game-load">
              <PrimaryButton disabled={loadDisabled} title={loadDisabled ? (loadWhy || 'Not ready to load yet') : 'Compiles this game and sends it to every gun. The count then says how many have confirmed it.'}
                onClick={() => load()}>{busy ? 'LOADING…' : 'LOAD ▸'}</PrimaryButton>
            </span>
          )}
        </div>
      </div>
      {/* F162: the VENUE chips above are a number MC sends AND a switch on every gun that MC cannot
          reach. This is the half the operator has to do, so it sits directly under the control that
          raises it rather than at the bottom of the summary rail — see ui/VenueModeReminder. */}
      <VenueModeReminder screen="games" style={{ marginBottom: 18 }} />
      {blocked && (
        <div role="alert" data-testid="games-locked" style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          background: 'rgba(255,82,82,.08)', border: `1px solid ${T.bad}`, borderLeft: `3px solid ${T.bad}`, padding: '12px 16px' }}>
          <span style={{ font: F.chk(700, 12), letterSpacing: '.06em', color: T.bad, lineHeight: 1.5 }}>▲ {blockedReason}</span>
          {(state.phase === 'armed' || state.phase === 'live') && (
            <GhostButton size={11} pad="8px 14px" color={T.ink} border={T.bad} onClick={() => setView(state.phase)}>JUMP TO MATCH ▸</GhostButton>
          )}
        </div>
      )}
      {/* A LOAD that is refused says so where the button is, not only in the error strip — and says
          whether it is a judgement the operator may override or one they have to go and fix. */}
      {!loaded && loadDisabled && !blocked && loadWhy && (
        <div role="alert" data-testid="load-blocked" style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
          background: 'rgba(255,176,32,.08)', border: `1px solid ${T.warn}`, borderLeft: `3px solid ${T.warn}`, padding: '12px 16px' }}>
          <span style={{ font: F.chk(700, 12), letterSpacing: '.06em', color: T.warn, lineHeight: 1.5 }}>▲ {loadWhy}</span>
          {canForce ? (
            <button type="button" data-load-force="1" className="hov-acc-ink hit44" style={{ ...BTN_RESET, cursor: 'pointer', color: T.bad, font: F.chk(700, 13), minHeight: 36 }}
              title="Compiles and sends to every bound node anyway. A gun that is not linked will simply not ack."
              onClick={() => load(true)}>LOAD ANYWAY, OVER {gate.pushBlockedCount} ▸</button>
          ) : (
            <span data-no-override-reason style={{ font: F.chk(600, 11), letterSpacing: '.1em', color: T.micro }}>CANNOT BE OVERRIDDEN — FIX THE ROSTER FIRST</span>
          )}
        </div>
      )}

      {loaded ? (
        <div data-testid="active-game-config" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* WHAT THE GUNS ARE HOLDING — the answer to "did it push?", above everything else. */}
          <div style={{ background: `linear-gradient(180deg,${T.panelSoft},${T.panelDeep})`, border: `1px solid ${T.line}`, borderLeft: `3px solid ${everyoneAcked ? T.ok : T.warn}` }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 20px', padding: '14px 18px' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ font: F.mono(600, 10.5), letterSpacing: '.26em', color: custom ? T.warn : activeSaved ? PERK_COLOR : T.acc }}>{custom ? 'TUNED — NOT SAVED' : activeSaved ? 'SAVED GAME' : 'STOCK MODE'} // LOADED</div>
                <div data-testid="playing-title" style={{ font: F.osw(700, 28), letterSpacing: '.08em', textTransform: 'uppercase', marginTop: 2, lineHeight: 1.1 }}>{title}</div>
              </div>
              <span style={{ flex: 1 }} />
              <LoadStatus testid="game-load-status" pushed acked={gate.acked} total={gate.total} recent={recentLoad} />
              {showRePush && (
                <button type="button" data-repush="1" data-repush-force={gate.pushBlockedCount > 0 ? '1' : undefined}
                  className={busy ? undefined : 'hov-acc-ink hit44'} disabled={busy || !!gate.rosterFault}
                  style={{ ...BTN_RESET, cursor: busy || gate.rosterFault ? 'not-allowed' : 'pointer',
                           color: busy || gate.rosterFault ? T.micro : gate.pushBlockedCount > 0 ? T.warn : T.acc,
                           font: F.chk(700, 13), letterSpacing: '.06em', minHeight: 44, padding: '0 6px' }}
                  title={gate.rosterFault ?? 'Compiles and sends this config to every gun again. The ack count drops to 0 and climbs as each one answers.'}
                  onClick={() => load(gate.pushBlockedCount > 0)}>
                  {busy ? 'RE-PUSHING…' : gate.pushBlockedCount > 0 ? `RE-PUSH CONFIG OVER ${gate.pushBlockedCount} BLOCKED ▸` : 'RE-PUSH CONFIG ▸'}
                </button>
              )}
              {!editing && (
                <span data-testid="game-edit-open">
                  <GhostButton size={12} pad="10px 16px" color={T.ink} border={T.line2} disabled={locked}
                    title={locked ? lockedReason(state.phase) : 'Open this game for editing. Nothing is sent until SAVE AND LOAD.'}
                    onClick={() => { if (!locked) setEditing(true); }}>EDIT ▸</GhostButton>
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
                    || (!everyoneAcked ? `No config echo from ${gate.noEcho.join(', ') || 'some guns'} — headset off, or gun asleep?`
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
            ? <GameEditPanel alwaysOpen onDone={() => setEditing(false)} />
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
              <div style={{ font: F.mono(600, 10.5), letterSpacing: '.26em', color: custom ? T.warn : activeSaved ? PERK_COLOR : T.acc }}>{custom ? 'TUNED — NOT SAVED' : activeSaved ? 'SAVED GAME' : 'STOCK MODE'} // PLAYING</div>
              <div data-testid="playing-title" style={{ font: F.osw(700, 28), letterSpacing: '.08em', textTransform: 'uppercase', marginTop: 2, lineHeight: 1.1 }}>{title}</div>
            </div>
            {mode && MODE_ART.has(mode.mode) && (
              <div style={{ margin: '12px 18px 0', aspectRatio: '2816 / 1536', background: `url(assets/modes/${mode.mode}.jpg) center/contain no-repeat, ${T.inset}`, border: `1px solid ${T.line2}` }} />
            )}
            <div style={{ padding: '12px 18px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ font: F.chk(500, 13), lineHeight: 1.55, color: T.body }}>{activeSaved?.desc || mode?.brief}</div>
              <GameSettings minCol={9999} rows={gameSettingRows(cfg, mode, weapons, perks)} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <GhostButton size={10} pad="8px 14px" onClick={() => openDesigner(activeSaved && !activeSaved.builtin ? { game: activeSaved } : { fromLive: true, game: activeSaved ?? undefined, copy: !!activeSaved })} title="Open this game in the designer">{activeSaved && !activeSaved.builtin ? 'EDIT THIS GAME ▸' : custom ? 'SAVE THIS AS A GAME ▸' : activeSaved ? 'MAKE MY OWN ▸' : 'CUSTOMIZE ▸'}</GhostButton>
              </div>
              {errorsAndWarnings}
              <div style={{ font: F.mono(500, 10.5), letterSpacing: '.12em', color: T.micro, lineHeight: 1.6 }}>VENUE = WHERE YOU ARE PLAYING TONIGHT (NOT PART OF THE GAME). LOAD ▸ SENDS THIS GAME TO EVERY GUN AND KEEPS YOU HERE, ON THE ACTIVE GAME CONFIG, WHERE YOU CAN EDIT IT AND LOAD AGAIN. CONTINUE TO KIT ▸ IS THEN ONE TAP. A "BASE" TAG MARKS THE STOCK MODE THE PLAYING GAME IS BUILT ON.</div>
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
