// GAMES — "pick tonight's game" (docs/spec/loadout.md §5). Replaces BUILD in the stepper. Two rows of cards
// (YOUR GAMES · STOCK MODES), a summary of what the players will get, the VENUE chips, CONTINUE ▸ to KIT.
// Defining a game happens in the DESIGNER (opened from here) — this page has no forms.
import { useCallback, useEffect, useState } from 'react';
import type { ModeInfo, SavedGame } from '../api/types';
import { useStore } from '../store';
import { F, PERK_COLOR, T, TAB } from '../tokens';
import { BTN_RESET, GhostButton, PrimaryButton, SectionRule, Seg, Shelf, StripedSlot, Tag, Toggle, onKey } from '../ui';
import { gameSig, objectiveLine, rulesLine } from './gameSummary';

const MODE_ART = new Set(['tdm', 'ffa', 'infection', 'lms', 'extraction']);   // public/assets/modes/*.jpg

export function Games() {
  const { state, modes, weapons, perks, run, api, setView, openDesigner } = useStore();
  const [games, setGames] = useState<SavedGame[]>([]);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [confirmSwitch, setConfirmSwitch] = useState<string | null>(null);   // tapping a card while the draft is TUNED — NOT SAVED (review #16)
  const reload = useCallback(() => api.getPresets().then(setGames).catch(() => {}), [api]);
  useEffect(() => { reload(); }, [reload]);
  if (!state) return null;
  const cfg = state.config;
  const sig = gameSig(cfg);
  // identity = the game the server APPLIED (a duplicate is content-identical to its source — review #0); content match is the fallback for an older MC
  const activeSaved = (state.active_preset_id ? games.find(g => g.preset_id === state.active_preset_id) : null) ?? (state.active_preset_id === undefined ? games.find(g => gameSig(g.config) === sig) : null) ?? null;
  const mode = modes.find(m => m.mode === cfg.mode);
  const activeStock = !activeSaved && mode && gameSig({ ...mode.defaults, teams: cfg.teams }) === sig ? mode : null;   // stock defaults, untouched
  const custom = !activeSaved && !activeStock;   // a tuned draft nobody saved yet
  const venue = { environment: cfg.environment, night: cfg.night };

  // a TUNED (unsaved) draft is discarded by playing something else — ask once (review #16)
  const guarded = (key: string, go: () => void) => { if (custom && confirmSwitch !== key) { setConfirmSwitch(key); return; } setConfirmSwitch(null); go(); };
  const playSaved = (g: SavedGame) => guarded(g.preset_id, async () => {
    const r = await run(() => api.applyPreset(g.preset_id));
    if (r) await run(() => api.putConfig(venue));   // the venue is tonight's, never the saved game's
  });
  const playStock = (m: ModeInfo) => guarded(m.mode, async () => { await run(() => api.putConfig({ ...m.defaults, ...venue, config_id: cfg.config_id })); });
  // COPY / MAKE MY OWN open the designer as an UNSAVED draft named after the source — nothing is written until SAVE (review #23)
  const copyOf = (g: SavedGame) => openDesigner({ game: g, copy: true });
  const remove = async (g: SavedGame) => { await run(() => api.deletePreset(g.preset_id)); setConfirmDel(null); await reload(); };

  return (
    <div className="screen">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '14px 28px', marginBottom: 20 }}>
        <div>
          <div style={{ font: F.mono(600, 10), letterSpacing: '.3em', color: T.acc }}>[ A2 // GAMES ]</div>
          <div style={{ font: F.osw(700, 30), letterSpacing: '.1em', textTransform: 'uppercase', marginTop: 2 }}>Pick the Game</div>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
          {/* VENUE — where you're playing, not what game it is */}
          <div role="group" aria-label="venue" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 12px', border: `1px solid ${T.line}`, background: T.panelDeep }}>
            <span style={{ font: F.mono(600, 10), letterSpacing: '.24em', color: T.dim }}>VENUE</span>
            <Seg value={cfg.environment} options={[{ value: 'indoor', label: 'INDOOR' }, { value: 'outdoor', label: 'OUTDOOR' }]} onChange={v => run(() => api.putConfig({ environment: v }))} pad="9px 14px" />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, font: F.chk(600, 11), letterSpacing: '.14em', color: cfg.night ? T.ink : T.dim }}>NIGHT OPS <Toggle on={cfg.night} onChange={v => run(() => api.putConfig({ night: v }))} label="night ops" /></span>
          </div>
          <PrimaryButton onClick={async () => { await run(() => api.setPhase('kit')); setView('kit'); }}>CONTINUE ▸</PrimaryButton>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
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
                  <div key={g.preset_id} className="hov-acc" role="button" tabIndex={0} aria-pressed={on} aria-label={`play ${g.name}`} onClick={() => { if (!on) playSaved(g); }} onKeyDown={onKey(() => { if (!on) playSaved(g); })}
                    style={{ flex: '0 0 262px', display: 'flex', flexDirection: 'column', gap: 8, padding: 10, cursor: on ? 'default' : 'pointer',
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
                    {confirmSwitch === g.preset_id && <div role="status" style={{ font: F.chk(700, 10), letterSpacing: '.12em', color: T.warn }}>▲ THIS DROPS YOUR UNSAVED TUNED GAME — TAP AGAIN TO PLAY THIS</div>}
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
                  <div key={m.mode} className="hov-acc" role="button" tabIndex={0} aria-pressed={on} aria-label={`play ${m.name}`} onClick={() => { if (!on) playStock(m); }} onKeyDown={onKey(() => { if (!on) playStock(m); })}
                    style={{ background: on ? 'rgba(57,180,255,.06)' : T.panel, border: `1px solid ${on ? T.acc : T.line}`, borderTop: `2px solid ${on ? T.acc : base ? T.line2 : 'transparent'}`, padding: 10, display: 'flex', flexDirection: 'column', gap: 10, cursor: on ? 'default' : 'pointer' }}>
                    <StripedSlot height={76} caption={MODE_ART.has(m.mode) ? undefined : 'mode art'} style={{ background: MODE_ART.has(m.mode) ? `url(assets/modes/${m.mode}.jpg) center/cover no-repeat` : undefined }}
                      corner={<>
                        <span style={{ position: 'absolute', top: 6, left: 6, font: F.osw(700, 12), letterSpacing: '.12em', background: on ? T.acc : T.panelAlt, color: on ? T.accInk : T.dim, padding: '2px 7px' }}>{m.abbr}</span>
                        {on && <span style={{ position: 'absolute', top: 6, right: 6 }}><Tag size={9}>PLAYING</Tag></span>}
                        {base && <span style={{ position: 'absolute', top: 6, right: 6 }}><Tag size={9} color={T.line2} ink={T.ink}>BASE</Tag></span>}
                      </>} />
                    <div style={{ flex: 1 }}>
                      <div style={{ font: F.osw(600, 15), letterSpacing: '.08em' }}>{m.name}</div>
                      <div style={{ font: F.chk(500, 12), color: T.dim, marginTop: 3 }}>{m.desc}</div>
                      {confirmSwitch === m.mode && <div role="status" style={{ font: F.chk(700, 10), letterSpacing: '.12em', color: T.warn, marginTop: 6 }}>▲ THIS DROPS YOUR UNSAVED TUNED GAME — TAP AGAIN</div>}
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

        {/* THE GAME — what the players will get */}
        <div style={{ flex: '1 1 330px', maxWidth: 480, position: 'sticky', top: 12, display: 'flex', flexDirection: 'column', gap: 0, background: `linear-gradient(180deg,${T.panelSoft},${T.panelDeep})`, border: `1px solid ${T.line}`, borderLeft: `3px solid ${custom ? T.warn : activeSaved ? PERK_COLOR : T.acc}` }}>
          <div style={{ padding: '14px 18px 0' }}>
            <div style={{ font: F.mono(600, 10.5), letterSpacing: '.26em', color: custom ? T.warn : activeSaved ? PERK_COLOR : T.acc }}>{custom ? 'TUNED — NOT SAVED' : activeSaved ? 'SAVED GAME' : 'STOCK MODE'} // PLAYING</div>
            <div data-testid="playing-title" style={{ font: F.osw(700, 28), letterSpacing: '.08em', textTransform: 'uppercase', marginTop: 2, lineHeight: 1.1 }}>{activeSaved?.name ?? mode?.name ?? cfg.mode}</div>
          </div>
          {mode && MODE_ART.has(mode.mode) && (
            <div style={{ margin: '12px 18px 0', aspectRatio: '2816 / 1536', background: `url(assets/modes/${mode.mode}.jpg) center/contain no-repeat, ${T.inset}`, border: `1px solid ${T.line2}` }} />
          )}
          <div style={{ padding: '12px 18px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ font: F.chk(500, 13), lineHeight: 1.55, color: T.body }}>{activeSaved?.desc || mode?.brief}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 5 }}>
              {[['TEAMS', mode?.teams_text ?? '—'], ['WIN', mode?.win_text ?? '—'], ['RESPAWN', cfg.respawn.type === 'none' ? 'OFF · LIVES' : `${cfg.respawn.type.toUpperCase()} · ${cfg.respawn.delay_s} S`],
                ['TIME', cfg.time_limit_s ? `${Math.round(cfg.time_limit_s / 60)} MIN` : '—'], ['HEALTH', `HP ${cfg.health.max_hp} · ARMOR ${cfg.health.max_armor}`],
                ['LOADOUT', rulesLine(cfg, weapons, perks) || '—'], ['VENUE', `${cfg.environment.toUpperCase()}${cfg.night ? ' · NIGHT OPS' : ''}`],
                // F70/F88: only the objective modes carry this, and a grenade drives exactly ONE point.
                // Same generator as the designer rail (gameSummary.objectiveLine) so the two never drift.
                ...(objectiveLine(cfg) ? [['OBJECTIVE', objectiveLine(cfg)!]] : [])].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 14, background: T.panel, border: `1px solid ${T.line}`, padding: '7px 12px' }}>
                  <span style={{ font: F.mono(500, 11), letterSpacing: '.2em', color: T.dim, flex: 'none' }}>{l}</span>
                  <span style={{ font: F.chk(700, 12), letterSpacing: '.06em', textAlign: 'right', ...TAB }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <GhostButton size={10} pad="8px 14px" onClick={() => openDesigner(activeSaved && !activeSaved.builtin ? { game: activeSaved } : { fromLive: true, game: activeSaved ?? undefined, copy: !!activeSaved })} title="Open this game in the designer">{activeSaved && !activeSaved.builtin ? 'EDIT THIS GAME ▸' : custom ? 'SAVE THIS AS A GAME ▸' : activeSaved ? 'MAKE MY OWN ▸' : 'CUSTOMIZE ▸'}</GhostButton>
            </div>
            {(state.config_warnings?.length ?? 0) > 0 && (
              <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {/* `SETUP: ` = a PHYSICAL step on the field the operator must do before the push (F70: power-cycle
                    the grenade so the hill starts NEUTRAL, set hill mode, place it). It is not a technical advisory
                    like the $SIR/frag-limit warnings, which stay out of this rail — see mc/API.md. */}
                {[...state.config_warnings!].filter(w => /LOADOUTS? RESET/i.test(w) || /^SETUP:/i.test(w)).map((w, i) => <div key={i} style={{ font: F.chk(700, 12), letterSpacing: '.14em', color: T.accInk, background: T.warn, padding: '6px 10px', alignSelf: 'flex-start' }}>▲ {w.toUpperCase()}</div>)}
              </div>
            )}
            {/* A refusal is the one thing on this rail the operator MUST be able to read: these are the
                server's validate() errors (a missing/unknown station_source, F82's yellow roster, F88's
                second control point) and they name the fix. They rendered at 10px in the corner. */}
            {state.config_errors.length > 0 && <div role="alert" style={{ font: F.mono(500, 11.5), lineHeight: 1.5, letterSpacing: '.08em', color: T.bad, background: 'rgba(255,82,82,.08)', border: `1px solid ${T.bad}`, padding: '7px 10px' }}>▲ {state.config_errors.join(' · ').toUpperCase()}</div>}
            <div style={{ font: F.mono(500, 10.5), letterSpacing: '.12em', color: T.micro, lineHeight: 1.6 }}>VENUE = WHERE YOU ARE PLAYING TONIGHT (NOT PART OF THE GAME). CONTINUE ▸ TAKES THIS GAME TO KIT — PHONES SHOW "SETTING UP" UNTIL THEN, THEN THE BRIEFING, THEN THEIR KIT. A "BASE" TAG MARKS THE STOCK MODE THE PLAYING GAME IS BUILT ON.</div>
          </div>
        </div>
      </div>
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
