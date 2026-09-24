import { useEffect, useState } from 'react';
import { pushGate } from '../api/derive';
import { GAME_VOLUME_MAX, GAME_VOLUME_MIN, VENUE_VOLUME_INDOOR, VENUE_VOLUME_OUTDOOR } from '../api/types';
import type { GameConfig, LoadoutPolicy, SlotRule, WeaponView } from '../api/types';
import { useStore } from '../store';
import { F, T, roleOf } from '../tokens';
import { DEFAULT_POLICY, HEALTH_PRESET_COPY, computePool, healthPresetOf, kindRows, splitLine } from '../screens/gameSummary';
import { HealthPresetEditor } from '../screens/HealthPresetEditor';
import { GhostButton, PrimaryButton, Seg, SwitchConfirm, Toggle } from './index';
import { LoadStatus } from './LoadedGame';

type Slot = 'primary' | 'secondary';
const toggleId = (xs: string[], x: string) => (xs.includes(x) ? xs.filter(y => y !== x) : [...xs, x]);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
/** the phases `state.py set_config` takes a config patch in. RECAP too since 2026-09-16: the edit rolls
 *  the finished session forward first, roster and game kept. */
const EDITABLE = new Set(['muster', 'build', 'kit', 'lobby', 'recap']);

type Modes = ReturnType<typeof useStore>['modes'];

/** The config a patch is measured AGAINST. A mode switch rebuilds the whole config from that mode's
 *  defaults server-side (`state.py set_config`), so once the draft has changed mode, "did the
 *  operator change the health" is a question about the NEW mode's defaults, not the old game's --
 *  otherwise the patch would carry the previous mode's numbers and pin them. */
function baseFor(d: GameConfig, cfg: GameConfig, modes: Modes): GameConfig | null {
  if (d.mode === cfg.mode) return cfg;
  const def = modes.find(m => m.mode === d.mode)?.defaults;
  // `null`, never `cfg`, when the new mode's defaults cannot be found (a `modes` catalog that is
  // empty or missing this entry -- an older/partial fetch). `cfg` still carries the OLD mode's
  // health/policy, and comparing the draft against it either drops a real edit that happens to
  // coincide with the old value, or -- the actual bug -- PINS the old mode's numbers into the patch
  // as if the operator had deliberately chosen them. `patchOf` below reads `null` as "no baseline to
  // diff against" and sends the draft's own values outright instead.
  return def ? ({ ...clone(def), environment: cfg.environment, night: cfg.night } as GameConfig) : null;
}
/** ONE patch, carrying exactly what the operator changed — never the whole config (which would
 *  re-assert this mode's every default over anything another screen touched meanwhile). */
function patchOf(d: GameConfig, cfg: GameConfig, modes: Modes): Partial<GameConfig> {
  const b = baseFor(d, cfg, modes);
  const p: Partial<GameConfig> = {};
  if (d.mode !== cfg.mode) p.mode = d.mode;
  if (d.night !== cfg.night) p.night = d.night;
  // K8: `null` is a real value here (back to the venue default), so it is compared, and sent, as one.
  if ((d.volume ?? null) !== ((b ?? cfg).volume ?? null)) p.volume = d.volume ?? null;
  // `!b` (no known baseline for the new mode) always sends health/policy rather than silently
  // omitting or mis-comparing them -- see `baseFor`. Sent-but-unnecessary is harmless (it repeats a
  // value the server's own mode rebuild would have chosen anyway); pinned-but-wrong is not.
  if (!b || JSON.stringify(d.health) !== JSON.stringify(b.health)) p.health = d.health;
  if (!b || JSON.stringify(d.loadout_policy) !== JSON.stringify(b.loadout_policy)) p.loadout_policy = d.loadout_policy;
  return p;
}

/** B3 (field 2026-09-12): editing the LOADED game meant leaving KIT/LOBBY for the GAMES stepper or the
 *  full DESIGNER. Tony: "the flow for editing the current loaded game is very bad. i need to be able
 *  to edit the current loaded game on the fly." This is that edit, inline, on the screen the operator
 *  is already looking at, for exactly the knobs he asked for: MODE, NIGHT, DEFAULT HEALTH, WHICH
 *  WEAPONS ARE AVAILABLE. Team editing is NOT here -- that is the lobby roster drag.
 *
 *  2026-09-13 — A DRAFT, NOT A LIVE WIRE. Every tap used to apply IMMEDIATELY (one `PUT /api/config`
 *  per tap, each one re-pushing the whole roster when the lobby was already pushed), so setting mode
 *  + health + three weapons mid-kit sent five heads to every gun and the operator watched five ack
 *  counters race each other. Tony's ask makes the model explicit: "Click Edit to modify and then Save
 *  and Load to update all phones." Nothing leaves this panel until SAVE AND LOAD, which fires ONE PUT
 *  with the whole patch; the server's `set_config` then re-pushes once (`_repush_lobby_config`) and
 *  the ack counter below drops to 0/N and climbs -- the one visible proof that the guns took it.
 *
 *  Only ACTIONABLE while the phase is one the server accepts a config edit in. The console's own nav
 *  lets the host free-browse to KIT/LOBBY at ANY phase (`CommandBar`'s tabs are not phase-gated), so
 *  this panel does not trust it is only ever mounted at the right time -- it gates itself on
 *  `state.phase`, disables every control with a real HTML `disabled` (never a tap that quietly does
 *  nothing), and still carries a fallback: if the request lands in the race between the phase
 *  advancing and this panel's next render, the server's refusal is rewritten with the one instruction
 *  that unblocks it (RECALL) and surfaces in the normal error strip -- never swallowed. */
export function GameEditPanel({ style, alwaysOpen = false, onDone, onDirtyChange }:
  { style?: React.CSSProperties; alwaysOpen?: boolean; onDone?: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const { state, modes, weapons, perks, run, api, openDesigner } = useStore();
  /** the config being edited, or null for "not editing". NOTHING here is sent until SAVE AND LOAD. */
  const [draft, setDraft] = useState<GameConfig | null>(() => (alwaysOpen && state ? clone(state.config) : null));
  const [confirmSave, setConfirmSave] = useState(false);      // a reshaping SAVE asks once (see `split`)
  const [confirmCancel, setConfirmCancel] = useState(false);  // abandoning a dirty draft asks once
  const [saving, setSaving] = useState(false);
  // Says "RE-PUSHING" for a few seconds after a successful save -- comfortably past a real gun's
  // ~1.5s echo (state.py `ack_config`) -- so cause and effect stay legible right when the count starts
  // moving. It has to expire: a gun that never acks (a standing fault, same one LOBBY's own step 2
  // lives with) would otherwise leave this claiming an active push forever.
  const [recentEdit, setRecentEdit] = useState(false);
  useEffect(() => { if (!recentEdit) return; const h = setTimeout(() => setRecentEdit(false), 4_000); return () => clearTimeout(h); }, [recentEdit]);
  // mounted with the editor already open (GAMES's EDIT state): seed the draft as soon as there is a
  // config to seed it from.
  const cfgId = state?.config.config_id;
  useEffect(() => { if (alwaysOpen && !draft && state) setDraft(clone(state.config)); }, [alwaysOpen, draft, state, cfgId]);
  const patch = draft && state ? patchOf(draft, state.config, modes) : {};
  const dirty = Object.keys(patch).length > 0;
  // GAMES's `editing` flag (Games.tsx `guarded`) needs to tell an UNTOUCHED draft (silently dropped)
  // from a CHANGED one (worth one word: UNSAVED EDITS DISCARDED) when the operator picks a different
  // game while this panel is still open. That question belongs here, next to `dirty` itself.
  // F318: above the `!state` return, so the hook order never depends on whether a snapshot has arrived.
  const hasState = !!state;
  useEffect(() => { if (hasState) onDirtyChange?.(dirty); }, [dirty, onDirtyChange, hasState]);
  if (!state) return null;
  const cfg = state.config;
  // Defensive like KIT's own `pol` read: a session restored from before A10 (or an older MC) can carry
  // a config with no policy at all -- `ConfigView` promises one, a persisted snapshot does not.
  const polOf = (c: GameConfig): LoadoutPolicy => (c.loadout_policy?.primary ? c.loadout_policy : DEFAULT_POLICY());
  const shown = draft ?? cfg;                 // what the controls read while open; the header reads `cfg`
  const pol = polOf(shown);
  const locked = !EDITABLE.has(state.phase);
  const pushed = state.lobby.pushed;
  const loaded = !!state.game?.loaded || pushed;   // PreArmSummary's own test for NO GAME LOADED
  // A36/pushGate, not a second `a.ok` count kept here: an ack with no test against `config.config_id`
  // reads CONFIRMED for a gun that answered the PREVIOUS config, and did so on KIT and LOBBY the day
  // `pushGate` was written to stop exactly that -- but this panel had grown its own count and never
  // heard about it, so a late stale ack read CONFIRMED here and UNCONFIRMED everywhere else.
  const gate = pushGate(state);
  const acked = gate.acked;
  const total = gate.total;
  const open = draft !== null;

  /** The reshape this SAVE would produce -- the SAME predicate GAMES's mode tiles show, never a second
   *  one. Asked of the DRAFT, which is why the per-tap confirm this panel used to carry is gone: the
   *  question belongs to the tap that actually moves people, and that tap is SAVE AND LOAD. */
  const split = draft ? splitLine(state.players, cfg.teams, draft.teams) : '';

  // Clears BOTH confirms, not just SAVE's: an operator who tapped CANCEL once (declining to discard),
  // then kept editing, has a fresh draft the OLD "TAP CANCEL AGAIN TO DISCARD" would still be primed
  // for -- one more CANCEL would throw away work it never asked about a second time.
  const edit = (fn: (d: GameConfig) => GameConfig) => { setConfirmSave(false); setConfirmCancel(false); setDraft(d => (d ? fn(d) : d)); };
  const editPolicy = (p: Partial<LoadoutPolicy>) => edit(d => ({ ...d, loadout_policy: { ...polOf(d), ...p } }));
  const editSlot = (slot: Slot, r: Partial<SlotRule>) => editPolicy({ [slot]: { ...pol[slot], ...r } });
  const pickMode = (v: string) => {
    if (!draft || v === draft.mode) return;
    const def = modes.find(m => m.mode === v)?.defaults;
    // mirrors `set_config`: rebuild from the mode's defaults, carry the VENUE (a fact about the site,
    // not about the game) and whatever the operator has already set in this draft for it.
    edit(d => (def ? ({ ...clone(def), config_id: d.config_id, environment: cfg.environment, night: d.night, ...(d.volume != null ? { volume: d.volume } : {}) } as GameConfig) : { ...d, mode: v }));
  };

  const startEdit = () => { setConfirmCancel(false); setConfirmSave(false); setDraft(clone(cfg)); };
  const cancel = () => {
    if (dirty && !confirmCancel) { setConfirmCancel(true); return; }   // abandoning a draft asks ONCE
    setConfirmCancel(false); setConfirmSave(false); setDraft(null); onDone?.();
  };
  const save = async () => {
    if (!draft || saving || locked) return;
    if (!dirty) { cancel(); return; }                       // nothing changed: closing is the honest action
    if (split && !confirmSave) { setConfirmSave(true); return; }
    setSaving(true);
    const r = await run(async () => {
      try {
        return await api.putConfig(patch);
      } catch (e) {
        const err = e as Error;
        // The one server refusal this panel can actually provoke (state.py `set_config`, phase guard).
        // The raw sentence is true but gives no next step; RECALL is the next step.
        if (/cannot change config after the match/i.test(err.message)) throw new Error(`${err.message.toUpperCase()} — RECALL FIRST, THEN EDIT AGAIN.`);
        throw e;
      }
    });
    setSaving(false);
    // `run` answers `undefined` ONLY on a throw — the refusal is already in the error strip and the
    // draft stays exactly as the operator left it, so nothing they typed is lost to a 409.
    if (r === undefined) return;
    setRecentEdit(true); setConfirmSave(false); setConfirmCancel(false); setDraft(null); onDone?.();
  };

  // Computed client-side from the DRAFT policy, same rule engine as the DESIGNER (gameSummary.ts
  // mirrors mcp/brx_mcp/mc/policy.py `pool()`) -- every tap shows instantly and needs no round trip.
  const pool = computePool(pol, weapons, perks);
  const poolOf = (slot: Slot) => (slot === 'primary' ? pool.primary : pool.secondary_weapons);
  const saveLabel = pushed ? 'SAVE AND LOAD ▸' : 'SAVE ▸';

  return (
    <div data-testid="game-edit-panel" style={{ border: `1px solid ${T.line}`, background: T.panelSoft, ...style }}>
      {!alwaysOpen && (
        <button type="button" data-testid="game-edit-toggle" onClick={() => (open ? cancel() : startEdit())} aria-expanded={open}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 14px',
                   background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', minHeight: 44, color: T.ink }}>
          {/* 2026-09-16, Tony: "VIEW" is more intuitive and less distracting. Opening it shows the loaded
              game; nothing changes until SAVE. */}
          {/* F318: with nothing loaded, LOBBY's pre-arm check says NO GAME LOADED right below this row, so
              the row must not call the game LOADED. The same predicate as PreArmSummary's. */}
          <span style={{ font: F.chk(700, 12), letterSpacing: '.2em', color: T.acc }}>{open ? '▾' : '▸'} {loaded ? 'VIEW LOADED GAME' : 'VIEW GAME · NOT LOADED'}</span>
          {/* G (round-2, 2026-09-12): 11px, not 10.5 — the host reads this chip at arm's length on the
              collapsed row. */}
          <span style={{ font: F.mono(500, 11), letterSpacing: '.12em', color: T.micro }}>
            {(modes.find(m => m.mode === cfg.mode)?.abbr ?? cfg.mode.toUpperCase())} · {cfg.night ? 'NIGHT' : 'DAY'} · {
              healthPresetOf(cfg.health) === 'custom'
                ? `HP ${cfg.health.max_hp}/${cfg.health.max_armor}${cfg.health.max_shield ? `/${cfg.health.max_shield}` : ''}`
                : HEALTH_PRESET_COPY.find(p => p.value === healthPresetOf(cfg.health))!.label
            }{cfg.volume != null ? ` · VOL ${cfg.volume}` : ''}
          </span>
          <span style={{ flex: 1 }} />
          {/* The count lives on the COLLAPSED row too, because that is where the operator is standing
              when they wonder. A successful SAVE closes the draft — and the seconds right after it
              are exactly when "are the guns caught up?" is the live question, so closing the panel
              must not take the answer off the screen with it (caught by the jsdom suite, 2026-09-13). */}
          <LoadStatus pushed={pushed} acked={acked} total={total} recent={recentEdit} />
          {/* 2026-09-16: no yellow LOCKED badge on this row (Tony). After a match nothing is locked any
              more, and in ARMED/LIVE the open panel still says why every control is disabled. */}
        </button>
      )}
      {open && (
        <div style={{ borderTop: alwaysOpen ? undefined : `1px solid ${T.line}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {locked && (
            <div role="alert" data-testid="game-edit-locked" style={{ font: F.chk(700, 12), letterSpacing: '.08em', lineHeight: 1.5,
                                                                       color: T.warn, background: 'rgba(255,176,32,.08)', border: `1px solid ${T.warn}`, padding: '9px 12px' }}>
              {`▲ THE MATCH IS ${state.phase.toUpperCase()}. MC REFUSES CONFIG EDITS ONCE IT HAS STARTED. RECALL FIRST, THEN EDIT.`}
            </div>
          )}
          {/* A real `disabled`, not a tap that quietly does nothing (ui-build-verify): every control
              below is inert together the moment the phase locks, and says why above. */}
          <fieldset disabled={locked} style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Row label="MODE">
              {modes.length > 0 ? (
                <>
                  <Seg label="mode" value={shown.mode} wrap options={modes.map(m => ({ value: m.mode, label: m.abbr }))}
                    titles={Object.fromEntries(modes.map(m => [m.mode, m.name]))}
                    onChange={pickMode} />
                  <div style={{ font: F.chk(500, 11.5), color: T.micro, marginTop: 6 }}>Switching mode replaces time limit, respawn, health and weapon rules with that mode's defaults, and moves players onto that mode's teams. Venue (day/night) and volume stay. Nothing is sent until {saveLabel.replace(' ▸', '')}.</div>
                </>
              ) : (
                <span style={{ font: F.chk(600, 12), color: T.micro }}>{shown.mode.toUpperCase()} — mode list unavailable (server predates this UI?)</span>
              )}
            </Row>
            <Row label="NIGHT OPS">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                <Toggle on={shown.night} onChange={v => edit(d => ({ ...d, night: v }))} label="night ops" />
                <span style={{ font: F.chk(600, 12), color: shown.night ? T.ink : T.dim }}>{shown.night ? 'NIGHT' : 'DAY'}</span>
              </span>
            </Row>
            <Row label="VOLUME">
              <VolumeEditor volume={shown.volume} environment={shown.environment} benchVolume={state.bench_volume}
                onChange={v => edit(d => { const n = { ...d }; if (v == null) delete n.volume; else n.volume = v; return n; })} />
            </Row>
            <Row label="LIFE PRESET">
              <HealthPresetEditor health={shown.health} onChange={h => edit(d => ({ ...d, health: h }))} />
            </Row>
            <Row label="WEAPONS AVAILABLE">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
                <PoolEditor label="PRIMARY" rule={pol.primary} allowed={poolOf('primary')} weapons={weapons}
                  onToggleId={id => editSlot('primary', { exclude_ids: toggleId(pol.primary.exclude_ids, id) })} />
                <PoolEditor label="SECONDARY" rule={pol.secondary} allowed={poolOf('secondary')} weapons={weapons}
                  onToggleId={id => editSlot('secondary', { exclude_ids: toggleId(pol.secondary.exclude_ids, id) })} />
              </div>
            </Row>
          </fieldset>

          {/* The one place anything leaves this panel. */}
          {confirmSave && split && (
            <SwitchConfirm dropsDraft={false} split={split} action={`TAP ${saveLabel.replace(' ▸', '')} AGAIN TO APPLY`} />
          )}
          {confirmCancel && (
            <div role="status" data-testid="game-edit-discard" style={{ font: F.chk(700, 11), letterSpacing: '.12em', color: T.warn, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span>▲ THIS DISCARDS YOUR UNSAVED CHANGES</span>
              <span>TAP CANCEL AGAIN TO DISCARD THEM</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', borderTop: `1px solid ${T.line}`, paddingTop: 12 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {/* while the draft is open the header above is not rendered (or is the toggle row of a
                  panel whose own copy is hidden behind it), so this is the one on screen */}
              <LoadStatus testid={alwaysOpen ? 'game-edit-repush' : 'game-edit-repush-open'}
                pushed={pushed} acked={acked} total={total} recent={recentEdit} />
              <span data-testid="game-edit-dirty" style={{ font: F.mono(500, 11), letterSpacing: '.12em', color: dirty ? T.warn : T.micro }}>
                {dirty ? `UNSAVED: ${Object.keys(patch).map(k => k.replace('loadout_policy', 'weapons').toUpperCase()).join(' · ')}` : 'NO CHANGES YET'}
              </span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {/* Round-2 fix pass F (2026-09-12): this sat OUTSIDE the fieldset above, so the ONE control
                  on this panel that navigates somewhere was the one the lock did not reach. */}
              <GhostButton size={10.5} pad="8px 12px" disabled={locked}
                title={locked ? `THE MATCH IS ${state.phase.toUpperCase()} — RECALL FIRST, THEN EDIT.` : undefined}
                onClick={() => { if (!locked) openDesigner({ fromLive: true }); }}>WHO PICKS / FIXED / SIDEARMS-ONLY RULES — OPEN GAME DESIGNER ▸</GhostButton>
              <span data-testid="game-edit-cancel"><GhostButton size={11} pad="9px 14px" onClick={cancel}>CANCEL</GhostButton></span>
              <span data-testid="game-edit-save">
                <PrimaryButton onClick={save} disabled={locked || saving || !dirty}
                  title={locked ? `THE MATCH IS ${state.phase.toUpperCase()} — RECALL FIRST, THEN EDIT.`
                    : !dirty ? 'Nothing has changed yet'
                    : pushed ? 'Sends the whole change to MC in one go, then re-pushes it to every gun. The count on the left drops to 0 and climbs as each one answers.'
                    : 'Applies the change. Nothing has been loaded to the guns yet — LOAD on the GAMES tab sends it.'}>
                  {saving ? 'SAVING…' : saveLabel}
                </PrimaryButton>
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ font: F.mono(600, 10.5), letterSpacing: '.22em', color: T.micro }}>{label}</span>
      {children}
    </div>
  );
}

/** K8 (Tony, field 2026-09-12): the host's per-game volume. VENUE DEFAULT is the absent key, so an older
 *  server (no `volume` field at all) renders as the venue default and a tap there sends `null`. The
 *  steps are the on-gun levels (`gameconfig.VOLUME_LEVELS`, 60..100); a value set another way (the API
 *  takes any integer in range) gets its own button so the control never hides what the game holds. */
const VOLUME_STEPS = [60, 70, 80, 90, 100] as const;
function venueVolume(environment: string | undefined): number {
  return environment === 'outdoor' ? VENUE_VOLUME_OUTDOOR : VENUE_VOLUME_INDOOR;   // unknown = the quieter, as the server
}
function VolumeEditor({ volume, environment, benchVolume, onChange }:
  { volume: number | null | undefined; environment: string | undefined; benchVolume?: number; onChange: (v: number | null) => void }) {
  const venue = venueVolume(environment);
  const set = volume ?? null;
  const steps: number[] = [...VOLUME_STEPS];
  if (set != null && !steps.includes(set)) steps.push(set);
  steps.sort((a, b) => a - b);
  const btn = (on: boolean): React.CSSProperties => ({
    font: F.chk(on ? 700 : 600, 12), letterSpacing: '.06em', padding: '6px 12px', minHeight: 36, minWidth: 44, cursor: 'pointer',
    background: on ? 'rgba(57,180,255,.10)' : T.panelDeep, color: on ? T.acc : T.micro, border: `1px solid ${on ? T.acc : T.line}`,
  });
  const plays = benchVolume ?? set ?? venue;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div role="group" aria-label="volume" data-testid="game-edit-volume" style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        <button type="button" className="hit44" aria-pressed={set == null} data-volume="venue" onClick={() => onChange(null)}
          title={`Play at the venue level: ${venue} ${(environment ?? 'indoor').toUpperCase()}`} style={btn(set == null)}>
          VENUE DEFAULT ({venue})
        </button>
        {steps.map(v => (
          <button key={v} type="button" className="hit44" aria-pressed={set === v} data-volume={v} onClick={() => onChange(v)}
            title={`Every gun plays this game at $VOL ${v}`} style={btn(set === v)}>
            {v}
          </button>
        ))}
      </div>
      <div data-testid="game-edit-volume-note" style={{ font: F.chk(500, 11.5), color: T.micro, lineHeight: 1.45 }}>
        {set == null
          ? `PLAYS AT ${venue}: the ${(environment ?? 'indoor').toUpperCase()} venue default.`
          : `PLAYS AT ${set}, set for this game (the venue default is ${venue}).`}
        {` ${GAME_VOLUME_MIN} is on-gun level 1, ${GAME_VOLUME_MAX} the loudest. Try-outs stay at 69.`}
        {benchVolume != null && (
          <span style={{ color: T.warn }}>{` ▲ BENCH VOLUME ${benchVolume} OVERRIDES THIS ON THIS RUN: every gun plays at ${plays}.`}</span>
        )}
      </div>
    </div>
  );
}

function PoolEditor({ label, rule, allowed, weapons, onToggleId }:
  { label: string; rule: SlotRule; allowed: string[]; weapons: WeaponView[]; onToggleId: (id: string) => void }) {
  if (rule.choice === 'off') return <PoolNote label={label} text="OFF for this game — the alt-fire button does nothing." />;
  if (rule.choice === 'fixed') {
    const w = weapons.find(x => x.weapon_id === rule.fixed_id);
    return <PoolNote label={label} text={`FIXED — everyone carries ${w?.name ?? rule.fixed_id ?? '—'}.`} />;
  }
  const candidates = kindRows(rule, weapons);
  return (
    <div>
      <div style={{ font: F.mono(600, 11), letterSpacing: '.2em', color: T.micro, marginBottom: 6 }}>{label} · {allowed.length} OF {candidates.length} ALLOWED</div>
      <div role="group" aria-label={`${label.toLowerCase()} weapons available`} style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {[...candidates].sort((a, b) => a.name.localeCompare(b.name)).map(w => {
          const on = allowed.includes(w.weapon_id);
          const role = roleOf(w.role, w.cls);
          return (
            <button key={w.weapon_id} type="button" className="hit44" aria-pressed={on} onClick={() => onToggleId(w.weapon_id)}
              title={on ? `${w.name} — allowed, tap to switch off` : `${w.name} — off, tap to allow`}
              aria-label={`${w.name}, ${on ? 'allowed' : 'off'}`}
              style={{ font: F.chk(600, 11), letterSpacing: '.04em', padding: '5px 10px', minHeight: 36, cursor: 'pointer',
                       background: on ? 'rgba(57,180,255,.10)' : T.panelDeep, color: on ? T.ink : T.micro,
                       border: `1px solid ${on ? T.acc : T.line}`, borderLeft: `3px solid ${on ? role.color : T.line}` }}>
              {on ? '✓ ' : '· '}{w.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
function PoolNote({ label, text }: { label: string; text: string }) {
  return <div style={{ font: F.chk(500, 12), color: T.dim }}><b style={{ font: F.mono(600, 11), letterSpacing: '.2em', color: T.micro }}>{label} </b>{text}</div>;
}
