// BUILD · SAVED GAMES shelf — "mode creation" (docs/spec/loadout.md §8). A saved game is the whole GameConfig
// under a name, persisted on the MC host. Tap to apply; SAVE AS… the current build; delete behind a two-step confirm.
import { useCallback, useEffect, useState } from 'react';
import type { GameConfig, SavedGame } from '../api/types';
import { useStore } from '../store';
import { F, PERK_COLOR, T } from '../tokens';
import { BTN_RESET, GhostButton, PrimaryButton, SectionRule, Tag, onKey } from '../ui';

const PRESET_LABEL: Record<string, string> = { open: 'OPEN', no_heavies: 'NO HEAVIES', snipers: 'SNIPERS ONLY', custom: 'CUSTOM RULES' };

/** the parts of a config that make a saved game "the same" as the draft — config_id is per-apply noise */
const sig = (c: GameConfig) => { const { config_id: _c, ...rest } = c; void _c; return JSON.stringify(rest); };

/** The saved game whose config equals the current draft byte-for-byte (config_id aside), if any. */
export function useActiveSavedGame(): SavedGame | null {
  const { state, api } = useStore();
  const [games, setGames] = useState<SavedGame[]>([]);
  const cfgSig = state ? sig(state.config) : '';
  useEffect(() => { api.getPresets().then(setGames).catch(() => {}); }, [api, cfgSig]);   // re-read after any config change (a save may have landed)
  return games.find(g => sig(g.config) === cfgSig) ?? null;
}

export function SavedGames() {
  const { state, modes, run, api } = useStore();
  const [games, setGames] = useState<SavedGame[]>([]);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const reload = useCallback(() => api.getPresets().then(setGames).catch(() => {}), [api]);
  useEffect(() => { reload(); }, [reload]);
  if (!state) return null;
  const cfg = state.config;
  const cur = sig(cfg);
  const matching = games.find(g => sig(g.config) === cur);   // the draft IS this saved game, byte for byte
  const modified = applied && !matching ? games.find(g => g.preset_id === applied) : null;

  const save = async (replace = false) => {
    const nm = name.trim(); if (!nm) return;
    const r = await run(() => api.savePreset({ name: nm, desc: desc.trim(), replace }));
    if (r) { setSaving(false); setName(''); setDesc(''); setApplied(r.preset_id); await reload(); }
  };
  const apply = async (g: SavedGame) => {
    const r = await run(() => api.applyPreset(g.preset_id));
    if (r) setApplied(g.preset_id);
  };
  const remove = async (g: SavedGame) => { await run(() => api.deletePreset(g.preset_id)); setConfirmDel(null); if (applied === g.preset_id) setApplied(null); await reload(); };

  return (
    <div style={{ marginBottom: 18 }}>
      <SectionRule label={`SAVED GAMES // ${games.length}`} style={{ marginBottom: 10 }}
        hint={modified ? <span style={{ color: T.warn }}>MODIFIED FROM "{modified.name.toUpperCase()}" — SAVE AS… TO KEEP IT</span> : 'TAP TO LOAD · SAVE THIS BUILD TO REPLAY IT'} />
      <div className="shelf-x" style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6, alignItems: 'stretch' }}>
        {games.map(g => {
          const on = matching?.preset_id === g.preset_id;
          const mode = modes.find(m => m.mode === g.config.mode);
          const lp = g.config.loadout_policy;
          // the same generated line for built-ins and host-saved games (review round 3)
          const rules = lp ? [lp.preset !== 'custom' ? PRESET_LABEL[lp.preset] : null,
            lp.primary.choice === 'fixed' ? 'PRIMARY FIXED' : `PRIMARY ${lp.primary.choice.toUpperCase()}`,
            lp.secondary.choice === 'off' ? 'NO SLOT 2' : lp.secondary.choice === 'fixed' ? 'SLOT 2 FIXED' : `SLOT 2 ${lp.secondary.choice.toUpperCase()}`,
            lp.hud_select ? 'PHONE PICKS' : 'NO PHONE PICKS'].filter(Boolean).join(' · ') : '';
          const del = confirmDel === g.preset_id;
          return (
            <div key={g.preset_id} className="hov-acc" role="button" tabIndex={0} aria-pressed={on} onClick={() => { if (!on) apply(g); }} onKeyDown={onKey(() => { if (!on) apply(g); })}
              style={{ flex: '0 0 250px', display: 'flex', flexDirection: 'column', gap: 8, padding: 12, cursor: on ? 'default' : 'pointer',
                background: on ? 'rgba(196,139,255,.07)' : T.panel, border: `1px solid ${on ? PERK_COLOR : T.line}`, borderTop: `2px solid ${on ? PERK_COLOR : T.line2}` }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ font: F.osw(700, 13), letterSpacing: '.12em', background: on ? PERK_COLOR : T.panelAlt, color: on ? T.accInk : T.dim, padding: '2px 7px' }}>{mode?.abbr ?? g.config.mode.toUpperCase()}</span>
                <span style={{ font: F.osw(600, 16), letterSpacing: '.06em', lineHeight: 1.1, flex: 1, minWidth: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{g.name.toUpperCase()}</span>
                {on && <Tag size={9} color={PERK_COLOR}>ACTIVE</Tag>}
                {g.builtin && !on && <span title="Shipped example — load it, tune it, save your own" style={{ font: F.mono(500, 8), letterSpacing: '.14em', color: T.micro }}>BUILT-IN</span>}
              </div>
              <div style={{ font: F.mono(500, 9), letterSpacing: '.1em', color: T.acc }}>{rules}</div>
              <div style={{ font: F.chk(500, 12), color: T.dim, lineHeight: 1.45, flex: 1 }}>{g.desc || `${mode?.name ?? g.config.mode} · ${Math.round((g.config.time_limit_s ?? 0) / 60)} MIN · HP ${g.config.health.max_hp} / AR ${g.config.health.max_armor}`}</div>
              {!g.builtin && (
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                  {del ? (
                    <>
                      <button type="button" className="hov-badbg" onClick={() => remove(g)} style={{ ...BTN_RESET, font: F.chk(700, 10), letterSpacing: '.14em', color: T.bad, border: `1px solid ${T.bad}`, padding: '5px 10px', minHeight: 32 }}>CONFIRM DELETE</button>
                      <button type="button" onClick={() => setConfirmDel(null)} style={{ ...BTN_RESET, font: F.chk(600, 10), letterSpacing: '.14em', color: T.dim, border: `1px solid ${T.line}`, padding: '5px 10px', minHeight: 32 }}>CANCEL</button>
                    </>
                  ) : (
                    <button type="button" className="hov-acc-ink" onClick={() => setConfirmDel(g.preset_id)} aria-label={`delete ${g.name}`} style={{ ...BTN_RESET, font: F.mono(600, 9), letterSpacing: '.14em', color: T.micro, padding: '5px 6px', minHeight: 32 }}>✕ DELETE</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {/* save-as card — deliberately NOT a <form>: GhostButton/PrimaryButton render plain <button>s, which would implicitly submit; Enter is handled per input */}
        <div style={{ flex: '0 0 270px', display: 'flex', flexDirection: 'column', gap: 8, padding: 12, background: T.panelDeep, border: `1px dashed ${saving ? T.acc : T.line2}` }}>
          {saving ? (
            <div role="group" aria-label="save this build" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ font: F.chk(700, 11), letterSpacing: '.2em', color: T.acc }}>SAVE THIS BUILD AS</span>
              <input className="textbox" autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} placeholder="NAME · e.g. SILENCED SNIPER" aria-label="saved game name" maxLength={32}
                style={{ font: F.osw(600, 16), letterSpacing: '.06em', borderBottomColor: T.line2, minHeight: 36, textTransform: 'uppercase' }} />
              <input className="textbox" value={desc} onChange={e => setDesc(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} placeholder="one line for next time (optional)" aria-label="saved game description" maxLength={140}
                style={{ font: F.chk(500, 12), borderBottomColor: T.line2, minHeight: 32 }} />
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <GhostButton size={10} pad="6px 12px" onClick={() => { setSaving(false); setName(''); setDesc(''); }}>CANCEL</GhostButton>
                <PrimaryButton size={10} pad="6px 14px" disabled={!name.trim()} onClick={() => save()}>SAVE</PrimaryButton>
              </div>
              {games.some(g => !g.builtin && g.name.toLowerCase() === name.trim().toLowerCase()) && (
                <button type="button" onClick={() => save(true)} className="hov-warnbg" style={{ ...BTN_RESET, font: F.mono(600, 9), letterSpacing: '.14em', color: T.warn, border: `1px solid ${T.warn}`, padding: '6px 10px', minHeight: 32, alignSelf: 'flex-end' }}>REPLACE THE EXISTING "{name.trim().toUpperCase()}"</button>
              )}
            </div>
          ) : (
            <button type="button" className="hov-acc-ink" onClick={() => { setSaving(true); setName(modified?.name ?? ''); setDesc(modified?.desc ?? ''); }}
              style={{ ...BTN_RESET, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, flex: 1, minHeight: 96, justifyContent: 'center', color: T.dim }}>
              <span style={{ font: F.osw(700, 22), letterSpacing: '.08em', color: T.ink }}>+ SAVE AS…</span>
              <span style={{ font: F.chk(500, 12), lineHeight: 1.45 }}>Keep this mode + settings + loadout rules under a name, so next time it's one tap.</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
