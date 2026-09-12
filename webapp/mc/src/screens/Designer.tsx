// GAME DESIGNER — define a game (docs/spec/loadout.md §5). One scrolling page: BASE → RULES → LOADOUT → NAME,
// with a sticky summary rail that reads like the card will and holds SAVE / SAVE AS NEW / PLAY THIS NOW.
// Edits a DRAFT: nothing touches the live config until PLAY. Pool preview comes from the server's rule engine.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConfigView, GameConfig, LoadoutPolicy, LoadoutPool, LoadoutPoolReasons, LoadoutPreset, PerkView, SavedGame, SlotChoice, SlotRule, WeaponView } from '../api/types';
import { useStore } from '../store';
import { F, PERK_COLOR, ROLE, T, TAB, roleOf } from '../tokens';
import { BTN_RESET, GhostButton, PrimaryButton, SectionRule, Seg, StripedSlot, Toggle, ValueBox } from '../ui';
import { PerkGlyph } from './Kit';
import { AdvancedPresentation } from './AdvancedPresentation';
import { STATION_SOURCES, TEMPLATE_RULES, admitsWeapons, computePool, emptyRequiredSlots, gameSig, objectiveLine, poolEmptyMessage, presetOf, rulesLine, withPolicy } from './gameSummary';
import { MODE_ART } from '../modeArt';
import { CONFIG_EDITABLE_PHASES, lockedReason } from './Games';

const TEMPLATES: { value: LoadoutPreset; label: string; hint: string }[] = [
  { value: 'open', label: 'OPEN', hint: 'Everything, players pick all three slots' },
  { value: 'no_heavies', label: 'NO HEAVIES', hint: 'Rockets, rail, cannon and launchers off in both weapon slots; every perk open' },
  { value: 'snipers', label: 'SNIPERS', hint: 'Everyone gets the sniper rifle, no secondary, no perks, no picking' },
];
const TAGS: { tag: string; label: string; color: string }[] = [
  { tag: 'heavy', label: 'HEAVY', color: ROLE.power.color }, { tag: 'sniper', label: 'SNIPER', color: ROLE.marksman.color },
  { tag: 'assault', label: 'ASSAULT', color: ROLE.assault.color }, { tag: 'cqb', label: 'CLOSE RANGE', color: ROLE.cqb.color }, { tag: 'support', label: 'SUPPORT', color: ROLE.support.color },
  { tag: 'sidearm', label: 'SIDEARM', color: ROLE.sidearm.color },   // A12: the pistols
];
const clone = <X,>(x: X): X => JSON.parse(JSON.stringify(x));
const toggle = (xs: string[], x: string) => (xs.includes(x) ? xs.filter(y => y !== x) : [...xs, x]);

export function Designer() {
  const { state, modes, weapons, perks, run, api, setView, designerSeed } = useStore();
  const seed = designerSeed;
  // SAVE updates this one; builtins save as new. Once a draft is saved, further SAVEs / PLAY update that game
  // (a second POST of the same name 409s — found on the real server).
  const [editing, setEditing] = useState<SavedGame | null>(seed?.game && !seed.game.builtin && !seed.copy ? seed.game : null);
  const initial = useMemo<ConfigView | null>(() => {
    if (!state) return null;
    if (seed?.fromLive) return withPolicy(clone(state.config));
    if (seed?.game) return withPolicy(clone(seed.game.config));
    const m = modes.find(x => x.mode === (seed?.mode ?? state.config.mode));
    return withPolicy(m ? clone(m.defaults) : clone(state.config));
  }, [seed, modes, state]);
  const [cfg, setCfg] = useState<ConfigView | null>(() => initial);   // the seed is fixed for the page's lifetime
  // ...but a lazy initialiser runs ONCE, so mounting before the first snapshot arrived captured
  // `null` and the designer stayed blank forever. Seed it only while still empty — `initial` also
  // changes with every snapshot (it depends on `state`), and re-seeding on that would throw away
  // the edits in progress. Same family as the KIT rules-of-hooks bug: state captured at mount and
  // never reconciled (review 2026-09-01).
  useEffect(() => { if (cfg === null && initial) setCfg(initial); }, [cfg, initial]);
  const [name, setName] = useState(!seed?.game ? '' : seed.copy || seed.game.builtin ? `${seed.game.name} ${seed.game.builtin ? '(mine)' : 'copy'}` : seed.game.name);
  const [desc, setDesc] = useState(seed?.game?.desc ?? '');
  const [saved, setSaved] = useState<string | null>(null);
  const [previewOff, setPreviewOff] = useState(false);   // the server has no pool preview (older MC) — counts are "all allowed"
  const [confirmLeave, setConfirmLeave] = useState(false);   // BACK with unsaved edits asks once (review #16)

  // The pool is computed HERE from the rules being edited — every chip/tile/who-picks change shows instantly and needs
  // no server. (Tony, round 8: a server-only preview with an "all allowed" fallback made HEAVY-off and tile taps do
  // nothing visible.) The server preview only re-derives the preset name (OPEN / NO HEAVIES / … / CUSTOM).
  const pool: (LoadoutPool & { reasons?: LoadoutPoolReasons }) | null = useMemo(() => cfg?.loadout_policy ? computePool(cfg.loadout_policy, weapons, perks) : null, [cfg, weapons, perks]);
  const tick = useRef(0);
  useEffect(() => {
    if (!cfg?.loadout_policy) return;
    const my = ++tick.current;
    const h = setTimeout(() => {
      api.previewPool(cfg.loadout_policy, cfg.mode).then(r => {
        if (my !== tick.current) return;
        setPreviewOff(false);
        if (r.policy.preset !== cfg.loadout_policy.preset) setCfg(c => c ? { ...c, loadout_policy: { ...c.loadout_policy, preset: r.policy.preset } } : c);
      }).catch(() => { if (my === tick.current) setPreviewOff(true); });
    }, 150);
    return () => clearTimeout(h);
  }, [cfg?.loadout_policy, cfg?.mode, api]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!state || !cfg) return null;
  const mode = modes.find(m => m.mode === cfg.mode);
  // "this mode needs an objective source" is the SERVER's fact, read off the mode row's defaults
  // (/api/modes → default_config(mode)) rather than a second list of mode names living in the UI.
  // A draft that already carries one counts too, so an older MC's config still shows its own field.
  const stationGated = mode?.defaults.station_source != null || cfg.station_source != null;
  const pol = cfg.loadout_policy;
  const put = (p: Partial<GameConfig>) => setCfg(c => c ? { ...c, ...p } : c);
  const putPol = (p: Partial<LoadoutPolicy>) => setCfg(c => { if (!c) return c; const lp = { ...c.loadout_policy, ...p }; return { ...c, loadout_policy: { ...lp, preset: presetOf(lp) } }; });   // a hand-built NO HEAVIES reads NO HEAVIES (review #18)
  const putSlot = (slot: 'primary' | 'secondary' | 'perk', r: Partial<SlotRule>) => putPol({ [slot]: { ...pol[slot], ...r } });
  // templates are client-side rules — the click must work with no server round-trip (Tony: "you can't click these")
  const applyTemplate = (preset: LoadoutPreset) => { if (preset !== 'custom') setCfg(c => c ? { ...c, loadout_policy: clone(TEMPLATE_RULES[preset]) } : c); };
  const setBase = (m: typeof modes[number]) => { if (m.mode !== cfg.mode) setCfg(withPolicy({ ...clone(m.defaults), environment: cfg.environment, night: cfg.night })); };
  const dirty = editing ? gameSig(editing.config) !== gameSig(cfg) || editing.name !== name.trim() || (editing.desc ?? '') !== desc.trim() : true;
  // F151 (field 2026-09-12): PLAY / APPLY both end in `PUT /api/config`, valid only in
  // muster/build/kit — reachable here whenever CUSTOMIZE was opened before the field moved on.
  const configLocked = !CONFIG_EDITABLE_PHASES.has(state.phase);
  // F141 polish (field 2026-09-12, pass 1): the "THIS EXCLUDES EVERY WEAPON" warning rendered on the
  // slot itself but nothing stopped SAVE/PLAY — a zero-weapon primary reached KIT and every arsenal
  // tile there was locked with no way out. The whole screen refuses until at least one slot has
  // something to carry, exactly like the phase lock above.
  //
  // Pass 2: named per the pool's OWN `reasons` code (policy.py `pool()`), never a generic sentence —
  // "fixed" is no longer assumed safe (the server refuses a push whose fixed id is not in the catalog,
  // `_primary_pool_refusal`), and a perk pruned for having no secondary to swap to gets its own true
  // cause instead of the perk filters taking the blame.
  const poolEmpty = emptyRequiredSlots(pool);
  const poolEmptyReason = poolEmpty.any
    ? [poolEmpty.primary && poolEmptyMessage('PRIMARY', pool!.reasons!.primary!),
       poolEmpty.secondary && poolEmptyMessage('SECONDARY', pool!.reasons!.secondary_weapons!),
       poolEmpty.perk && poolEmptyMessage('PERK', pool!.reasons!.perks!)].filter(Boolean).join(' ')
    : '';
  const blocked = configLocked || poolEmpty.any;
  const blockedReason = configLocked ? lockedReason(state.phase) : poolEmpty.any ? poolEmptyReason : undefined;

  const save = async (asNew = false) => {
    const nm = name.trim(); if (!nm) { setSaved('NAME IT FIRST'); return null; }
    const body = { name: nm, desc: desc.trim(), config: cfg };
    const r = editing && !asNew ? await run(() => api.updatePreset(editing.preset_id, body)) : await run(() => api.savePreset(body));
    if (r) { setSaved(`SAVED "${r.name.toUpperCase()}"`); setEditing(r); }
    return r;
  };
  const play = async () => {
    // saved if it has a name, then applied — the venue stays tonight's
    const nm = name.trim();
    if (nm) { const r = await save(); if (!r) return; await run(() => api.applyPreset(r.preset_id)); }
    else { await run(() => api.putConfig({ ...cfg, config_id: state.config.config_id })); }
    await run(() => api.putConfig({ environment: state.config.environment, night: state.config.night }));
    await run(() => api.setPhase('kit')); setView('kit');
  };

  return (
    <div className="screen">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '14px 28px', marginBottom: 20 }}>
        <div>
          <div style={{ font: F.mono(600, 10), letterSpacing: '.3em', color: T.acc }}>[ A2b // GAME DESIGNER ]</div>
          <div style={{ font: F.osw(700, 30), letterSpacing: '.1em', textTransform: 'uppercase', marginTop: 2 }}>{editing ? `Edit ${editing.name}` : 'Create a Game'}</div>
        </div>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
          {confirmLeave && <span role="status" style={{ font: F.chk(700, 11), letterSpacing: '.12em', color: T.warn }}>▲ UNSAVED CHANGES — TAP AGAIN TO LEAVE WITHOUT SAVING</span>}
          <GhostButton onClick={() => { if (dirty && !confirmLeave) { setConfirmLeave(true); return; } setView('build'); }}>◂ BACK TO GAMES</GhostButton>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        <div style={{ flex: '2 1 600px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 26 }}>
          {/* 1 BASE */}
          <section>
            <SectionRule label="1 // BASE MODE" hint="SWITCHING THE BASE REPLACES EVERY RULE BELOW WITH THAT MODE'S DEFAULTS" style={{ marginBottom: 12 }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8 }}>
              {modes.map(m => {
                const on = m.mode === cfg.mode;
                return (
                  <button key={m.mode} type="button" aria-pressed={on} onClick={() => setBase(m)} className={on ? undefined : 'hov-acc'}
                    style={{ ...BTN_RESET, display: 'flex', flexDirection: 'column', gap: 8, padding: 8, textAlign: 'left', background: on ? 'rgba(57,180,255,.06)' : T.panel, border: `1px solid ${on ? T.acc : T.line}`, cursor: on ? 'default' : 'pointer' }}>
                    <StripedSlot height={54} style={{ background: MODE_ART.has(m.mode) ? `url(assets/modes/${m.mode}.jpg) center/cover no-repeat` : undefined }}
                      corner={<span style={{ position: 'absolute', top: 5, left: 5, font: F.osw(700, 11), letterSpacing: '.12em', background: on ? T.acc : T.panelAlt, color: on ? T.accInk : T.dim, padding: '1px 6px' }}>{m.abbr}</span>} />
                    <span style={{ font: F.osw(600, 13), letterSpacing: '.08em', color: on ? T.ink : T.dim }}>{m.name}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 2 RULES */}
          <section>
            <SectionRule label="2 // RULES" hint={mode ? `${mode.teams_text} · ${mode.win_text}` : undefined} style={{ marginBottom: 12 }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '4px 28px', background: T.panel, border: `1px solid ${T.line}`, padding: '8px 18px' }}>
              <Row label={<>TIME LIMIT <Hint>Required</Hint></>}><ValueBox value={Math.round((cfg.time_limit_s ?? 0) / 60)} unit="MIN" label="time limit minutes" min={1} max={120} onChange={v => put({ time_limit_s: v * 60 })} /></Row>
              <Row label={<>SCORE TO WIN <Hint>0 means time only</Hint></>}><ValueBox value={cfg.scoring.frag_limit ?? 0} label="score to win" min={0} max={999} onChange={v => put({ scoring: { ...cfg.scoring, frag_limit: v || null } })} /></Row>
              <Row label="RESPAWN"><Seg value={cfg.respawn.type} options={[{ value: 'scanner', label: 'SCANNER' }, { value: 'auto', label: 'AUTO' }, { value: 'none', label: 'NONE' }]} onChange={v => put({ respawn: { ...cfg.respawn, type: v } })} pad="5px 11px" /></Row>
              {/* F34/F13: 1-2 s wedges the headset relay in its out-blink, and the server refuses it with a 400. The
                  control skips that band instead of letting the operator step into an error: up from 0 lands on 3,
                  down from 3 lands on 0 (no respawn). */}
              <Row label={<>RESPAWN DELAY <Hint>0 = none · min 3</Hint></>}><ValueBox value={cfg.respawn.delay_s} unit="S" label="respawn delay seconds" min={0} max={300} onChange={v => put({ respawn: { ...cfg.respawn, delay_s: (v > 0 && v < 3) ? (v > (cfg.respawn.delay_s ?? 0) ? 3 : 0) : v } })} /></Row>
              <Row label="HEALTH"><ValueBox value={cfg.health.max_hp} unit="HP" min={1} max={999} label="health" onChange={v => put({ health: { ...cfg.health, max_hp: v } })} /></Row>
              <Row label={<>ARMOR <Hint>0 means one-shot with a sniper</Hint></>}><ValueBox value={cfg.health.max_armor} unit="AR" min={0} max={999} label="armor" onChange={v => put({ health: { ...cfg.health, max_armor: v } })} /></Row>
              {/* F70: the modes with an objective need something ON THE FIELD emitting it, and until now
                  nothing in the console could set that — the operator got a push refused by a server
                  naming a config key no screen owned. `station_source` is a closed vocabulary
                  (gameSummary.STATION_SOURCES ⇄ types.py), so this is a three-value segmented control and
                  never a text field: a typo used to ship a hill match with nothing emitting a hill. */}
              {stationGated && (
                <Row label={<>OBJECTIVE SOURCE <Hint>What is on the field emitting the objective</Hint></>}>
                  <Seg label="objective source" value={cfg.station_source ?? 'grenade'} pad="5px 11px"
                    options={STATION_SOURCES.map(s => ({ value: s.value, label: s.label }))}
                    titles={Object.fromEntries(STATION_SOURCES.map(s => [s.value, s.hint]))}
                    onChange={v => put({ station_source: v })} />
                </Row>
              )}
            </div>
            {stationGated && (
              <div style={{ font: F.chk(500, 12), letterSpacing: '.02em', color: T.micro, marginTop: 8 }}>
                {STATION_SOURCES.find(s => s.value === (cfg.station_source ?? 'grenade'))?.hint}
              </div>
            )}
            <div style={{ font: F.chk(500, 12), letterSpacing: '.02em', color: T.micro, marginTop: 8 }}>Venue (indoor / outdoor, night ops) is set on the Games page each time — it is not part of the game.</div>
          </section>

          {/* 3 LOADOUT */}
          <section>
            <SectionRule label="3 // LOADOUT — WHO CARRIES WHAT" hint={<span style={{ color: PERK_COLOR }}>{pol.preset === 'custom' ? 'CUSTOM RULES' : TEMPLATES.find(t => t.value === pol.preset)?.label}</span>} style={{ marginBottom: 12 }} />
            {previewOff && <div role="alert" style={{ font: F.mono(600, 10), letterSpacing: '.12em', color: T.warn, marginBottom: 10 }}>▲ THE MC SERVER PREDATES THIS UI — RULES PREVIEW LOCALLY BUT SAVE / PLAY WILL FAIL UNTIL YOU RESTART IT.</div>}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <span style={{ font: F.mono(600, 10.5), letterSpacing: '.22em', color: T.dim }} title="A template replaces every loadout rule below, including the phone-picks switch">START FROM</span>
              <span role="group" aria-label="loadout template" style={{ display: 'flex', gap: 4 }}>
                {TEMPLATES.map(t => <button key={t.value} type="button" title={t.hint} onClick={() => applyTemplate(t.value)} aria-pressed={pol.preset === t.value} className="hov-acc"
                  style={{ ...BTN_RESET, font: F.chk(700, 11), letterSpacing: '.12em', padding: '7px 12px', minHeight: 36, cursor: 'pointer', background: pol.preset === t.value ? T.acc : 'transparent', color: pol.preset === t.value ? T.accInk : T.dim, border: `1px solid ${pol.preset === t.value ? T.acc : T.line}` }}>{t.label}</button>)}
              </span>
              <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10, font: F.chk(600, 12), letterSpacing: '.1em' }}>PLAYERS PICK ON THEIR PHONE <Toggle on={pol.hud_select} onChange={v => putPol({ hud_select: v })} label="players pick on phone" /></span>
            </div>
            {!pol.hud_select && <div role="status" style={{ font: F.mono(600, 10.5), letterSpacing: '.12em', color: T.dim, marginBottom: 10 }}>PHONE PICKS ARE OFF — "PLAYER" BELOW MEANS THE HOST KITS THAT SLOT ON THE KIT PAGE; PLAYERS SEE THEIR KIT BUT CANNOT CHANGE IT.</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 12 }}>
              <SlotEditor slot="primary" rule={pol.primary} pool={pool} weapons={weapons} perks={perks} onRule={r => putSlot('primary', r)} />
              <SlotEditor slot="secondary" rule={pol.secondary} pool={pool} weapons={weapons} perks={perks} onRule={r => putSlot('secondary', r)} />
              <SlotEditor slot="perk" rule={pol.perk} pool={pool} weapons={weapons} perks={perks} onRule={r => putSlot('perk', r)} />
            </div>
          </section>

          {/* 4 NAME */}
          <section>
            <SectionRule label="4 // NAME & NOTES" hint="WHAT THE CARD AND THE PLAYERS' BRIEFING WILL SAY" style={{ marginBottom: 12 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: T.panel, border: `1px solid ${T.line}`, padding: 16, maxWidth: 620 }}>
              <input className="textbox" value={name} onChange={e => { setName(e.target.value); setSaved(null); }} placeholder="GAME NAME · e.g. SILENCED SNIPER" aria-label="game name" maxLength={32}
                style={{ font: F.osw(600, 22), letterSpacing: '.06em', borderBottomColor: T.line2, minHeight: 44, textTransform: 'uppercase' }} />
              <textarea className="textbox" value={desc} onChange={e => setDesc(e.target.value)} placeholder="One or two lines the players read in their briefing — what the game is, how to win, what to expect." aria-label="game notes" maxLength={240} rows={3}
                style={{ font: F.chk(500, 13), lineHeight: 1.5, borderBottomColor: T.line2, resize: 'vertical' }} />
            </div>
          </section>

          <AdvancedPresentation />
        </div>

        {/* summary rail */}
        <aside className="designer-rail" style={{ flex: '1 1 300px', maxWidth: 400, position: 'sticky', top: 12, display: 'flex', flexDirection: 'column', background: `linear-gradient(180deg,${T.panelSoft},${T.panelDeep})`, border: `1px solid ${T.line}`, borderLeft: `3px solid ${PERK_COLOR}` }}>
          <div style={{ padding: '14px 18px 0' }}>
            <div style={{ font: F.mono(600, 10.5), letterSpacing: '.26em', color: PERK_COLOR }}>THE CARD WILL SAY</div>
            <div style={{ font: F.osw(700, 26), letterSpacing: '.08em', textTransform: 'uppercase', marginTop: 2, lineHeight: 1.1, color: name.trim() ? T.ink : T.faint }}>{name.trim() || 'UNNAMED GAME'}</div>
          </div>
          {mode && MODE_ART.has(mode.mode) && <div style={{ margin: '12px 18px 0', aspectRatio: '2816 / 1536', background: `url(assets/modes/${mode.mode}.jpg) center/contain no-repeat, ${T.inset}`, border: `1px solid ${T.line2}` }} />}
          <div style={{ padding: '12px 18px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ font: F.mono(500, 10.5), letterSpacing: '.1em', color: T.acc, lineHeight: 1.6 }}>{rulesLine(cfg, weapons, perks)}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 4 }}>
              {[['BASE', mode?.name ?? cfg.mode], ['TIME', `${Math.round((cfg.time_limit_s ?? 0) / 60)} MIN`], ['WIN', cfg.scoring.frag_limit ? `${cfg.scoring.frag_limit} SCORE / TIME` : 'TIME'],
                ['RESPAWN', cfg.respawn.type === 'none' ? 'OFF' : `${cfg.respawn.type.toUpperCase()} · ${cfg.respawn.delay_s} S`], ['HEALTH', `HP ${cfg.health.max_hp} · ARMOR ${cfg.health.max_armor}`],
                ['PRIMARY', pool ? (pol.primary.choice === 'fixed' ? 'FIXED' : `${pool.primary.length} OF ${weapons.length}`) : '…'],
                ['SLOT 2', pol.secondary.choice === 'off' ? 'OFF' : pol.secondary.choice === 'fixed' ? 'FIXED' : pool ? `${pool.secondary_weapons.length} ${!pol.secondary.kinds.includes('weapon') && pol.secondary.kinds.includes('sidearm') ? 'SIDEARMS' : 'WEAPONS'}` : '…'],
                ['PERK', pol.perk.choice === 'off' ? 'OFF' : pol.perk.choice === 'fixed' ? 'FIXED' : pool ? `${pool.perks.length} PERKS` : '…'],
                ...(objectiveLine(cfg) ? [['OBJECTIVE', objectiveLine(cfg)!]] : [])].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, font: F.mono(500, 10.5), letterSpacing: '.14em' }}>
                  <span style={{ color: T.micro }}>{l}</span><span style={{ color: T.body, ...TAB, textAlign: 'right' }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ font: F.chk(500, 12), color: T.dim, lineHeight: 1.45, minHeight: 18 }}>{desc.trim() || (mode?.brief ?? '')}</div>
            <div style={{ height: 1, background: T.line }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <PrimaryButton onClick={play} disabled={blocked} title={blocked ? blockedReason : name.trim() ? 'Save, apply, and go to KIT' : 'Apply without saving and go to KIT'}>PLAY THIS NOW ▸</PrimaryButton>
              {blocked && <div role="alert" style={{ font: F.mono(600, 10.5), letterSpacing: '.1em', color: T.bad, lineHeight: 1.5 }}>▲ {blockedReason}</div>}
              {!blocked && !name.trim() && <div style={{ font: F.mono(500, 10.5), letterSpacing: '.12em', color: T.micro }}>PLAYS TONIGHT WITHOUT SAVING — NAME IT ABOVE TO KEEP IT ON THE SHELF</div>}
              <div style={{ display: 'flex', gap: 6 }}>
                <GhostButton size={11} pad="9px 12px" color={dirty ? T.ink : T.micro} border={dirty ? T.acc : T.line} disabled={blocked} onClick={() => save(false)} title={blocked ? blockedReason : editing ? `Update "${editing.name}"` : 'Save under the name above'}>{editing ? 'SAVE' : 'SAVE GAME'}</GhostButton>
                {editing && <GhostButton size={11} pad="9px 12px" disabled={blocked} onClick={() => save(true)} title={blocked ? blockedReason : 'Keep the original, save this as a new game'}>SAVE AS NEW</GhostButton>}
              </div>
              {saved && <div role="status" style={{ font: F.mono(600, 10.5), letterSpacing: '.14em', color: saved.startsWith('NAME') ? T.warn : T.ok }}>{saved}</div>}
              {saved && !saved.startsWith('NAME') && editing && state.active_preset_id === editing.preset_id && gameSig(editing.config) !== gameSig(state.config) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ font: F.mono(600, 10.5), letterSpacing: '.12em', color: T.warn }}>▲ TONIGHT'S GAME STILL RUNS THE OLD VERSION</div>
                  <GhostButton size={11} pad="9px 12px" color={T.ink} border={T.warn} disabled={blocked} title={blocked ? blockedReason : undefined}
                    onClick={async () => { if (blocked) return; const r = await run(() => api.applyPreset(editing.preset_id)); if (r) await run(() => api.putConfig({ environment: state.config.environment, night: state.config.night })); }}>APPLY TO TONIGHT'S GAME ▸</GhostButton>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ---------- pieces ---------- */

function SlotEditor({ slot, rule, pool, weapons, perks, onRule }:
  { slot: 'primary' | 'secondary' | 'perk'; rule: SlotRule; pool: (LoadoutPool & { reasons?: LoadoutPoolReasons }) | null; weapons: WeaponView[]; perks: PerkView[]; onRule: (r: Partial<SlotRule>) => void }) {
  const sec = slot === 'secondary', isPerk = slot === 'perk';   // A14: the perk is its own slot
  const allowedW = pool ? (sec ? pool.secondary_weapons : pool.primary) : [];
  const allowedK = pool ? pool.perks : [];
  const off = rule.choice === 'off', fixed = rule.choice === 'fixed';
  const sidearmsOnly = !isPerk && !rule.kinds.includes('weapon') && rule.kinds.includes('sidearm');   // A12: pistols only (loadout.md §3)
  const showWeapons = !isPerk && !off && (!sec || admitsWeapons(rule));
  const showPerks = isPerk && !off;
  const pistols = weapons.filter(w => (w.tags ?? []).includes('sidearm')).length;
  const summary = off ? (isPerk ? 'OFF — NO PERKS' : 'OFF — ALT-FIRE DOES NOTHING') : fixed ? `EVERYONE GETS ${(weapons.find(w => w.weapon_id === rule.fixed_id)?.name ?? perks.find(k => k.perk_id === rule.fixed_id)?.name ?? '—').toUpperCase()}`
    : isPerk ? `${allowedK.length} OF ${perks.length} PERKS`
    : sidearmsOnly ? `SIDEARMS ONLY · ${allowedW.length} OF ${pistols} PISTOLS`
    : `${allowedW.length} OF ${weapons.length} WEAPONS`;   // review #22
  // F141 (field 2026-09-12, ISSUE 19): a PLAYER/HOST slot whose filters exclude every candidate used to
  // say only "0 OF 18 WEAPONS" — nothing on screen said the slot would DEGRADE at kit-out (primary
  // falls back to pistols only, which then failed its own one-magazine guard and blocked the push).
  // Say the failure in place, at the moment it is created, not three screens later as an unreadable
  // push error. Pass 2: driven by the pool's own `reasons` code, not a re-derived `!off && !fixed` —
  // a FIXED slot can be just as empty (`fixed_missing`) and must say so too.
  const emptyCode = pool?.reasons?.[isPerk ? 'perks' : sec ? 'secondary_weapons' : 'primary'];
  const emptyPool = !!emptyCode && emptyCode !== 'off';
  const WHO: Record<string, string> = isPerk
    ? { player: 'players pick a perk from what is allowed below (the host can override)', host: 'the host picks each player\'s perk on the KIT page', fixed: 'everyone gets the one perk you tap below', off: 'nobody gets a perk this game' }
    : { player: 'players choose from what is allowed below (the host can override)', host: 'the host chooses for each player on the KIT page', fixed: 'everyone gets the one weapon you tap below', off: 'nobody gets a slot 2 — the alt-fire button does nothing' };
  // a class chip is ON / PARTIAL (some of its weapons switched off by id) / OFF
  const tagState = (tag: string) => {
    if (rule.exclude_tags.includes(tag)) return 'off';
    const members = weapons.filter(w => (w.tags ?? []).includes(tag));
    const n = members.filter(w => allowedW.includes(w.weapon_id)).length;
    return n === members.length ? 'on' : `${n}/${members.length}`;
  };
  // F141 (field 2026-09-12): a chip reading PARTIAL — some of its own weapons off, usually because a
  // DIFFERENT class chip already excludes them (the AMR is support AND sniper; switching HEAVY off
  // switches the Ion Sniper off too, which reads as "sniper: 4/5") — used to fall into the "turn
  // everything back ON" branch on tap. Tapping SNIPER then cleared its exclude_ids but never touched
  // exclude_tags, so if every one of its own members was already off via ANOTHER tag the pool never
  // changed and the chip looked stuck ("cannot deselect it" — exactly what a field operator hit while
  // excluding heavy/support/assault/cqb and then reaching for sniper last). The rule is simpler and
  // matches the chip's own on/off reading: anything but fully OFF taps to OFF; only OFF taps to ON.
  const tapTag = (tag: string) => {
    if (tagState(tag) === 'off') {
      onRule({ exclude_tags: rule.exclude_tags.filter(t => t !== tag),                                    // whole class back ON, incl. members switched off by id
               exclude_ids: rule.exclude_ids.filter(id => !(weapons.find(w => w.weapon_id === id)?.tags ?? []).includes(tag)) });   // review #14
    } else {
      onRule({ exclude_tags: [...rule.exclude_tags, tag] });                                              // whole class off, on or partial alike
    }
  };
  return (
    <div role="group" aria-label={`${slot} slot rules`} style={{ background: T.panelDeep, border: `1px solid ${T.line}`, borderTop: `2px solid ${isPerk ? PERK_COLOR : T.acc}`, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ font: F.chk(700, 13), letterSpacing: '.2em' }}>{isPerk ? 'PERK' : sec ? 'SECONDARY' : 'PRIMARY'}</span>
        <span data-testid={`${slot}-summary`} style={{ font: F.mono(500, 10.5), letterSpacing: '.12em', color: emptyPool ? T.bad : T.acc }}>{summary}</span>
      </div>
      {emptyPool && (
        <div role="alert" data-testid={`${slot}-empty-pool`} style={{ font: F.chk(700, 12), letterSpacing: '.04em', color: T.bad, background: 'rgba(255,82,82,.1)', border: `1px solid ${T.bad}`, padding: '8px 10px', lineHeight: 1.5 }}>
          ▲ {poolEmptyMessage(isPerk ? 'PERK' : sec ? 'SECONDARY' : 'PRIMARY', emptyCode!)}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ font: F.mono(600, 10.5), letterSpacing: '.2em', color: T.micro }} title="Who decides what goes in this slot">WHO PICKS</span>
        <Seg value={rule.choice} pad="5px 11px" options={[{ value: 'player', label: 'PLAYER' }, { value: 'host', label: 'HOST' }, { value: 'fixed', label: 'FIXED' }, ...(sec || isPerk ? [{ value: 'off' as SlotChoice, label: 'OFF' }] : [])]}
          onChange={(v: SlotChoice) => onRule({ choice: v, fixed_id: v === 'fixed' ? (rule.fixed_id ?? (isPerk ? (allowedK[0] ?? perks[0]?.perk_id ?? 'body_armor') : (allowedW[0] ?? 'assault_rifle'))) : rule.fixed_id })} />
      </div>
      {/* WEAPONS|PERKS rides on the description line, which BOTH panels have. On the WHO PICKS row it
          wrapped to a line of its own on the secondary side only, so the two weapon tables started at
          different heights — Tony, 2026-09-02: "the tables dont align". */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 36 }}>
        <span style={{ font: F.chk(500, 11), color: T.dim }}>{WHO[rule.choice]}</span>
        {sec && !off && !fixed && (
          <span style={{ display: 'inline-flex', gap: 4, marginLeft: 'auto', flex: '0 0 auto' }}>
            {/* A12: WEAPONS and SIDEARMS are exclusive — 'weapon' already admits the pistols, 'sidearm' is the narrower kind */}
            <Chip on={rule.kinds.includes('weapon')} color={T.acc} onClick={() => { const k = (rule.kinds.includes('weapon') ? rule.kinds.filter(x => x !== 'weapon') : [...rule.kinds.filter(x => x !== 'sidearm'), 'weapon']) as SlotRule['kinds']; if (k.length) onRule({ kinds: k }); }}>WEAPONS</Chip>
            <Chip on={rule.kinds.includes('sidearm')} color={ROLE.sidearm.color} onClick={() => { const k = (rule.kinds.includes('sidearm') ? rule.kinds.filter(x => x !== 'sidearm') : [...rule.kinds.filter(x => x !== 'weapon'), 'sidearm']) as SlotRule['kinds']; if (k.length) onRule({ kinds: k }); }}>SIDEARMS</Chip>
          </span>
        )}
      </div>
      {showWeapons && !fixed && (
        <>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* A12: under SIDEARMS the other classes are off by KIND, not by id — a row of ◐ 0/5 chips would say the wrong thing */}
            {TAGS.filter(t => !sidearmsOnly || t.tag === 'sidearm').map(t => { const st = tagState(t.tag); return <Chip key={t.tag} on={st !== 'off'} partial={st !== 'on' && st !== 'off' ? st : undefined} color={t.color} onClick={() => tapTag(t.tag)}>{t.label}</Chip>; })}
          </div>
          <div style={{ font: F.chk(500, 12), letterSpacing: '.02em', color: T.micro, lineHeight: 1.5, maxWidth: '68ch' }}>A chip switches a whole class. Tap a weapon to switch just that one. A partial chip (1/5) means some of its weapons are off, and a weapon in two classes is off when either chip is off.</div>
        </>
      )}
      {showWeapons && fixed && <div style={{ font: F.mono(600, 10.5), letterSpacing: '.14em', color: T.acc }}>TAP THE WEAPON EVERYONE GETS</div>}
      {showWeapons && (
        // A TABLE, alphabetical. This was 36 image tiles in a 3-wide grid, each with its class
        // printed in a saturated colour — Tony, 2026-09-02: "too loud, its difficult to quickly scan
        // and parse... maybe a table alphabeticaly order with a little class identifier". You are
        // picking which names are ALLOWED here, not choosing a gun to carry; the pictures belong on
        // KIT and ARSENAL, where you are.
        <div style={{ border: `1px solid ${T.line}`, background: T.panelDeep }}>
          {[...weapons].sort((x, y) => x.name.localeCompare(y.name)).map((w, i) => {
            const inPool = allowedW.includes(w.weapon_id);
            const byId = rule.exclude_ids.includes(w.weapon_id);
            const byTag = !inPool && !byId && !fixed;   // off because of a class chip
            const on = fixed ? rule.fixed_id === w.weapon_id : inPool;
            const role = roleOf(w.role, w.cls);
            const tip = fixed ? `Tap to make ${w.name} the fixed weapon`
              : byTag ? `Off by the ${role.label || 'class'} chip — tap to allow just this one`
              : byId ? 'Off — tap to allow' : 'Allowed — tap to switch off';
            const allowThroughTag = () => {
              const mates = weapons.filter(x => x.weapon_id !== w.weapon_id && (x.tags ?? []).some(t => (w.tags ?? []).includes(t) && rule.exclude_tags.includes(t))).map(x => x.weapon_id);
              onRule({ exclude_tags: rule.exclude_tags.filter(t => !(w.tags ?? []).includes(t)), exclude_ids: Array.from(new Set([...rule.exclude_ids.filter(id => id !== w.weapon_id), ...mates])) });
            };
            return (
              <button key={w.weapon_id} type="button" aria-pressed={on} title={tip} aria-label={`${w.name}${on ? ', allowed' : ', off'}`} className="hov-acc"
                onClick={() => fixed ? onRule({ fixed_id: w.weapon_id }) : byTag ? allowThroughTag() : onRule({ exclude_ids: toggle(rule.exclude_ids, w.weapon_id) })}
                style={{ ...BTN_RESET, width: '100%', display: 'grid', gridTemplateColumns: '22px 1fr auto', alignItems: 'center', gap: 10,
                         padding: '0 12px', minHeight: 38, cursor: 'pointer', textAlign: 'left',
                         borderTop: i ? `1px solid ${T.line}` : 'none',
                         background: fixed && on ? 'rgba(57,180,255,.10)' : 'transparent' }}>
                <span style={{ font: F.chk(700, 12), color: on ? (fixed ? T.acc : T.ok) : T.faint }}>{on ? '✓' : '·'}</span>
                <span style={{ font: F.chk(on ? 700 : 500, 13), letterSpacing: '.02em', color: on ? T.ink : T.micro,
                               textDecoration: on ? undefined : 'line-through', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.name}</span>
                {/* Every class the weapon is in, not just its role. The chips filter on TAGS and a
                    weapon can carry several — the AMR is support AND sniper, the Ion Sniper is heavy
                    AND sniper — so a row labelled only SUPPORT was being switched off by the SNIPER
                    chip with nothing on screen explaining why (Tony, 2026-09-02). */}
                <span style={{ font: F.mono(500, 10), letterSpacing: '.1em', color: T.micro, whiteSpace: 'nowrap' }}>
                  {(TAGS.filter(t => (w.tags ?? []).includes(t.tag)).map(t => t.label).join(' · ')) || role.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {showPerks && fixed && <div style={{ font: F.mono(600, 10.5), letterSpacing: '.14em', color: PERK_COLOR }}>TAP THE PERK EVERYONE GETS</div>}
      {showPerks && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 6 }}>
          {perks.map(k => {
            const inPool = allowedK.includes(k.perk_id);
            const on = fixed ? rule.fixed_id === k.perk_id : inPool;
            return (
              <button key={k.perk_id} type="button" aria-pressed={on} title={fixed ? 'Tap to make this the fixed perk' : on ? 'Allowed — tap to switch off' : 'Off — tap to allow'} aria-label={`${k.name} perk${on ? ', allowed' : ', off'}`} className="hov-acc"
                onClick={() => fixed ? onRule({ fixed_id: k.perk_id }) : onRule({ exclude_ids: toggle(rule.exclude_ids, k.perk_id) })}
                style={{ ...BTN_RESET, display: 'flex', alignItems: 'center', gap: 8, padding: 6, textAlign: 'left', cursor: 'pointer', background: on ? 'rgba(196,139,255,.06)' : T.panelDeep, border: `1px solid ${on ? PERK_COLOR : T.line}`, minHeight: 44, opacity: on ? 1 : .5 }}>
                <span style={{ width: 30, height: 30, flex: 'none', display: 'grid', placeItems: 'center', background: T.inset }}><PerkGlyph id={k.perk_id} size={18} color={on ? PERK_COLOR : T.dim} /></span>
                <span style={{ font: F.chk(700, 11), letterSpacing: '.04em', color: on ? T.ink : T.dim }}>{k.name}</span>
              </button>
            );
          })}
        </div>
      )}
      {showPerks && !fixed && <div style={{ font: F.chk(500, 12), letterSpacing: '.02em', color: T.micro, lineHeight: 1.5, maxWidth: '68ch' }}>A perk rides beside both weapons. Easy Reload is the exception: it takes the ALT button, so a player who picks it gives up their second weapon (the phone and KIT both warn first).</div>}
      {off && <div style={{ font: F.chk(500, 12), color: T.dim }}>{isPerk ? 'No perks this game.' : 'No slot 2 this game — the alt-fire button does nothing.'}</div>}
    </div>
  );
}

// Was a solid fill in the class's own saturated colour — five of them, twice on screen. The colour
// now rides on a 3px left edge, so the chips still read as a set without shouting (2026-09-02).
function Chip({ on, partial, color, onClick, children }: { on: boolean; partial?: string; color: string; onClick: () => void; children: React.ReactNode }) {
  const mixed = on && !!partial;
  return (
    <button type="button" aria-pressed={mixed ? 'mixed' : on} onClick={onClick} className="hit44" title={mixed ? `${partial} of this class allowed (the rest off by another chip or by id) — tap to switch the whole class off` : on ? 'Allowed — tap to switch the whole class off' : 'Off — tap to allow the class'}
      style={{ ...BTN_RESET, font: F.chk(600, 12), letterSpacing: '.02em', padding: '7px 12px', minHeight: 36, cursor: 'pointer',
               // No fill. Five saturated blocks, twice on screen, were the loudest thing on the page —
               // "the colors of the buttons are too harsh maybe just border color or a dimmer hue"
               // (2026-09-02). The class colour survives on the tick and a 3px edge, nowhere else.
               // longhand only: mixing `borderLeft` with `borderLeftWidth` makes React warn.
               borderStyle: 'solid', borderColor: on ? T.line2 : T.line, borderWidth: 1,
               borderLeftColor: on ? color : T.line, borderLeftWidth: 3,
               color: on ? T.ink : T.micro, background: 'transparent' }}>
      <span style={{ color: on ? color : T.faint, marginRight: 6 }}>{mixed ? `◐ ${partial}` : on ? '✓' : '·'}</span>{children}
    </button>
  );
}
// `space-between` inside auto-fit cells of differing widths put every control at its own cell edge,
// and an inline hint wrapped the label and shoved the control further — Tony, 2026-09-02: "these
// controls dont align with the labels that great, its confusing". A fixed label column fixes both.
function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  // Label ABOVE its control. Side by side, the control was right-aligned in a fixed-width cell while
  // the label was left-aligned, so the gap between them was whatever the label's length left over —
  // "TIME LIMIT" sat a mile from its box and "RESPAWN DELAY" nearly touched its own. Tony, twice:
  // "these controls dont align with the labels", then "labels arent next to inputs". Stacked, every
  // label sits directly on its control and every control starts on the same line.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 0' }}>
      <span style={{ font: F.chk(600, 12.5), letterSpacing: '.06em', display: 'flex', flexDirection: 'column', gap: 1 }}>{label}</span>
      <span style={{ display: 'inline-flex' }}>{children}</span>
    </div>
  );
}
/** Its own line, in sentence case: a hint must never change where the control sits. */
function Hint({ children }: { children: React.ReactNode }) {
  return <span style={{ font: F.chk(500, 11), letterSpacing: '.02em', color: T.micro, textTransform: 'none' }}>{children}</span>;
}
