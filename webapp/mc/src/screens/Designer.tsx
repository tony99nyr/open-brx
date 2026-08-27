// GAME DESIGNER — define a game (docs/spec/loadout.md §5). One scrolling page: BASE → RULES → LOADOUT → NAME,
// with a sticky summary rail that reads like the card will and holds SAVE / SAVE AS NEW / PLAY THIS NOW.
// Edits a DRAFT: nothing touches the live config until PLAY. Pool preview comes from the server's rule engine.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameConfig, LoadoutPolicy, LoadoutPool, LoadoutPreset, PerkView, SavedGame, SlotChoice, SlotRule, WeaponView } from '../api/types';
import { useStore } from '../store';
import { F, PERK_COLOR, ROLE, T, TAB, roleOf } from '../tokens';
import { BTN_RESET, GhostButton, PrimaryButton, SectionRule, Seg, StripedSlot, Toggle, ValueBox } from '../ui';
import { PerkGlyph } from './Kit';
import { TEMPLATE_RULES, gameSig, rulesLine, withPolicy } from './gameSummary';

const MODE_ART = new Set(['tdm', 'ffa', 'infection', 'lms', 'extraction']);
const TEMPLATES: { value: LoadoutPreset; label: string; hint: string }[] = [
  { value: 'open', label: 'OPEN', hint: 'Everything, players pick both slots' },
  { value: 'no_heavies', label: 'NO HEAVIES', hint: 'Rockets, rail, cannon and launchers off in both slots' },
  { value: 'snipers', label: 'SNIPERS', hint: 'Everyone gets the sniper rifle, no secondary, no picking' },
];
const TAGS: { tag: string; label: string; color: string }[] = [
  { tag: 'heavy', label: 'HEAVY', color: ROLE.power.color }, { tag: 'sniper', label: 'SNIPER', color: ROLE.marksman.color },
  { tag: 'assault', label: 'ASSAULT', color: ROLE.assault.color }, { tag: 'cqb', label: 'CLOSE RANGE', color: ROLE.cqb.color }, { tag: 'support', label: 'SUPPORT', color: ROLE.support.color },
];
const clone = <X,>(x: X): X => JSON.parse(JSON.stringify(x));
const toggle = (xs: string[], x: string) => (xs.includes(x) ? xs.filter(y => y !== x) : [...xs, x]);

export function Designer() {
  const { state, modes, weapons, perks, run, api, setView, designerSeed } = useStore();
  const seed = designerSeed;
  // SAVE updates this one; builtins save as new. Once a draft is saved, further SAVEs / PLAY update that game
  // (a second POST of the same name 409s — found on the real server).
  const [editing, setEditing] = useState<SavedGame | null>(seed?.game && !seed.game.builtin ? seed.game : null);
  const initial = useMemo<GameConfig | null>(() => {
    if (!state) return null;
    if (seed?.fromLive) return withPolicy(clone(state.config));
    if (seed?.game) return withPolicy(clone(seed.game.config));
    const m = modes.find(x => x.mode === (seed?.mode ?? state.config.mode));
    return withPolicy(m ? clone(m.defaults) : clone(state.config));
  }, [seed, modes, state]);
  const [cfg, setCfg] = useState<GameConfig | null>(() => initial);   // the seed is fixed for the page's lifetime
  const [name, setName] = useState(seed?.game?.name && !seed.game.builtin ? seed.game.name : seed?.game?.builtin ? `${seed.game.name} (mine)` : '');
  const [desc, setDesc] = useState(seed?.game?.desc ?? '');
  const [pool, setPool] = useState<LoadoutPool | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [previewOff, setPreviewOff] = useState(false);   // the server has no pool preview (older MC) — counts are "all allowed"

  // pool preview for the DRAFT policy — server rule engine, debounced; the server also re-derives the preset name
  const tick = useRef(0);
  useEffect(() => {
    if (!cfg?.loadout_policy) return;
    const my = ++tick.current;
    const h = setTimeout(() => {
      api.previewPool(cfg.loadout_policy, cfg.mode).then(r => {
        if (my !== tick.current) return;
        setPool(r.pool);
        if (r.policy.preset !== cfg.loadout_policy.preset) setCfg(c => c ? { ...c, loadout_policy: { ...c.loadout_policy, preset: r.policy.preset } } : c);
      }).catch(() => {
        // no preview route (older MC): show everything allowed rather than a page of dimmed tiles — and SAY so
        if (my !== tick.current) return;
        setPreviewOff(true);
        setPool({ primary: weapons.map(w => w.weapon_id), secondary_weapons: weapons.map(w => w.weapon_id), secondary_perks: perks.map(k => k.perk_id) });
      });
    }, 120);
    return () => clearTimeout(h);
  }, [cfg?.loadout_policy, cfg?.mode, api, weapons, perks]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!state || !cfg) return null;
  const mode = modes.find(m => m.mode === cfg.mode);
  const pol = cfg.loadout_policy;
  const put = (p: Partial<GameConfig>) => setCfg(c => c ? { ...c, ...p } : c);
  const putPol = (p: Partial<LoadoutPolicy>) => setCfg(c => c ? { ...c, loadout_policy: { ...c.loadout_policy, ...p, preset: 'custom' } } : c);
  const putSlot = (slot: 'primary' | 'secondary', r: Partial<SlotRule>) => putPol({ [slot]: { ...pol[slot], ...r } });
  // templates are client-side rules — the click must work with no server round-trip (Tony: "you can't click these")
  const applyTemplate = (preset: LoadoutPreset) => { if (preset !== 'custom') setCfg(c => c ? { ...c, loadout_policy: clone(TEMPLATE_RULES[preset]) } : c); };
  const setBase = (m: typeof modes[number]) => { if (m.mode !== cfg.mode) setCfg(withPolicy({ ...clone(m.defaults), environment: cfg.environment, night: cfg.night })); };
  const dirty = editing ? gameSig(editing.config) !== gameSig(cfg) || editing.name !== name.trim() || (editing.desc ?? '') !== desc.trim() : true;

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
        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
          <GhostButton onClick={() => setView('build')}>◂ BACK TO GAMES</GhostButton>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        <div style={{ flex: '2 1 600px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 26 }}>
          {/* 1 BASE */}
          <section>
            <SectionRule label="1 // BASE MODE" hint="SWITCHING THE BASE RESETS THE RULES BELOW" style={{ marginBottom: 12 }} />
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: '6px 24px', background: T.panel, border: `1px solid ${T.line}`, padding: '8px 18px' }}>
              <Row label={<>TIME LIMIT <Hint>REQUIRED</Hint></>}><ValueBox value={Math.round((cfg.time_limit_s ?? 0) / 60)} unit="MIN" label="time limit minutes" min={1} max={120} onChange={v => put({ time_limit_s: v * 60 })} /></Row>
              <Row label={<>SCORE TO WIN <Hint>0 = TIME ONLY</Hint></>}><ValueBox value={cfg.scoring.frag_limit ?? 0} label="score to win" min={0} max={999} onChange={v => put({ scoring: { ...cfg.scoring, frag_limit: v || null } })} /></Row>
              <Row label="RESPAWN"><Seg value={cfg.respawn.type} options={[{ value: 'scanner', label: 'SCANNER' }, { value: 'auto', label: 'AUTO' }, { value: 'none', label: 'NONE' }]} onChange={v => put({ respawn: { ...cfg.respawn, type: v } })} pad="5px 11px" /></Row>
              <Row label="RESPAWN DELAY"><ValueBox value={cfg.respawn.delay_s} unit="S" label="respawn delay seconds" min={0} max={300} onChange={v => put({ respawn: { ...cfg.respawn, delay_s: v } })} /></Row>
              <Row label="HEALTH"><ValueBox value={cfg.health.max_hp} unit="HP" min={1} max={999} label="health" onChange={v => put({ health: { ...cfg.health, max_hp: v } })} /></Row>
              <Row label={<>ARMOR <Hint>0 = ONE-SHOT WITH A SNIPER</Hint></>}><ValueBox value={cfg.health.max_armor} unit="AR" min={0} max={999} label="armor" onChange={v => put({ health: { ...cfg.health, max_armor: v } })} /></Row>
            </div>
            <div style={{ font: F.mono(500, 9), letterSpacing: '.12em', color: T.micro, marginTop: 6 }}>VENUE (INDOOR / OUTDOOR, NIGHT OPS) IS SET ON THE GAMES PAGE EACH TIME — IT IS NOT PART OF THE GAME.</div>
          </section>

          {/* 3 LOADOUT */}
          <section>
            <SectionRule label="3 // LOADOUT — WHO CARRIES WHAT" hint={<span style={{ color: PERK_COLOR }}>{pol.preset === 'custom' ? 'CUSTOM RULES' : TEMPLATES.find(t => t.value === pol.preset)?.label}</span>} style={{ marginBottom: 12 }} />
            {previewOff && <div role="alert" style={{ font: F.mono(600, 10), letterSpacing: '.12em', color: T.warn, marginBottom: 10 }}>▲ THE MC SERVER CAN'T PREVIEW THESE RULES (IT PREDATES THIS UI) — COUNTS SHOW EVERYTHING ALLOWED. RESTART THE SERVER.</div>}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <span style={{ font: F.mono(600, 9), letterSpacing: '.22em', color: T.dim }}>START FROM</span>
              <span role="group" aria-label="loadout template" style={{ display: 'flex', gap: 4 }}>
                {TEMPLATES.map(t => <button key={t.value} type="button" title={t.hint} onClick={() => applyTemplate(t.value)} aria-pressed={pol.preset === t.value} className="hov-acc"
                  style={{ ...BTN_RESET, font: F.chk(700, 11), letterSpacing: '.12em', padding: '7px 12px', minHeight: 36, cursor: 'pointer', background: pol.preset === t.value ? T.acc : 'transparent', color: pol.preset === t.value ? T.accInk : T.dim, border: `1px solid ${pol.preset === t.value ? T.acc : T.line}` }}>{t.label}</button>)}
              </span>
              <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10, font: F.chk(600, 12), letterSpacing: '.1em' }}>PLAYERS PICK ON THEIR PHONE <Toggle on={pol.hud_select} onChange={v => putPol({ hud_select: v })} label="players pick on phone" /></span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 12 }}>
              <SlotEditor slot="primary" rule={pol.primary} pool={pool} weapons={weapons} perks={perks} onRule={r => putSlot('primary', r)} />
              <SlotEditor slot="secondary" rule={pol.secondary} pool={pool} weapons={weapons} perks={perks} onRule={r => putSlot('secondary', r)} />
            </div>
          </section>

          {/* 4 NAME */}
          <section>
            <SectionRule label="4 // NAME & NOTES" hint="WHAT THE CARD AND THE PLAYERS' BRIEFING WILL SAY" style={{ marginBottom: 12 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: T.panel, border: `1px solid ${T.line}`, padding: 16, maxWidth: 620 }}>
              <input className="textbox" value={name} onChange={e => setName(e.target.value)} placeholder="GAME NAME · e.g. SILENCED SNIPER" aria-label="game name" maxLength={32}
                style={{ font: F.osw(600, 22), letterSpacing: '.06em', borderBottomColor: T.line2, minHeight: 44, textTransform: 'uppercase' }} />
              <textarea className="textbox" value={desc} onChange={e => setDesc(e.target.value)} placeholder="One or two lines the players read in their briefing — what the game is, how to win, what to expect." aria-label="game notes" maxLength={240} rows={3}
                style={{ font: F.chk(500, 13), lineHeight: 1.5, borderBottomColor: T.line2, resize: 'vertical' }} />
            </div>
          </section>
        </div>

        {/* summary rail */}
        <aside style={{ flex: '1 1 300px', maxWidth: 400, position: 'sticky', top: 12, display: 'flex', flexDirection: 'column', background: `linear-gradient(180deg,${T.panelSoft},${T.panelDeep})`, border: `1px solid ${T.line}`, borderLeft: `3px solid ${PERK_COLOR}` }}>
          <div style={{ padding: '14px 18px 0' }}>
            <div style={{ font: F.mono(600, 9), letterSpacing: '.26em', color: PERK_COLOR }}>THE CARD WILL SAY</div>
            <div style={{ font: F.osw(700, 26), letterSpacing: '.08em', textTransform: 'uppercase', marginTop: 2, lineHeight: 1.1, color: name.trim() ? T.ink : T.faint }}>{name.trim() || 'UNNAMED GAME'}</div>
          </div>
          {mode && MODE_ART.has(mode.mode) && <div style={{ margin: '12px 18px 0', aspectRatio: '2816 / 1536', background: `url(assets/modes/${mode.mode}.jpg) center/contain no-repeat, ${T.inset}`, border: `1px solid ${T.line2}` }} />}
          <div style={{ padding: '12px 18px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ font: F.mono(500, 9), letterSpacing: '.1em', color: T.acc, lineHeight: 1.6 }}>{rulesLine(cfg, weapons, perks)}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 4 }}>
              {[['BASE', mode?.name ?? cfg.mode], ['TIME', `${Math.round((cfg.time_limit_s ?? 0) / 60)} MIN`], ['WIN', cfg.scoring.frag_limit ? `${cfg.scoring.frag_limit} SCORE / TIME` : 'TIME'],
                ['RESPAWN', cfg.respawn.type === 'none' ? 'OFF' : `${cfg.respawn.type.toUpperCase()} · ${cfg.respawn.delay_s} S`], ['HEALTH', `HP ${cfg.health.max_hp} · ARMOR ${cfg.health.max_armor}`],
                ['PRIMARY', pool ? (pol.primary.choice === 'fixed' ? 'FIXED' : `${pool.primary.length} OF ${weapons.length}`) : '…'],
                ['SLOT 2', pol.secondary.choice === 'off' ? 'OFF' : pol.secondary.choice === 'fixed' ? 'FIXED' : pool ? `${pool.secondary_weapons.length} WEAPONS · ${pool.secondary_perks.length} PERKS` : '…']].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, font: F.mono(500, 9.5), letterSpacing: '.14em' }}>
                  <span style={{ color: T.micro }}>{l}</span><span style={{ color: T.body, ...TAB, textAlign: 'right' }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ font: F.chk(500, 12), color: T.dim, lineHeight: 1.45, minHeight: 18 }}>{desc.trim() || (mode?.brief ?? '')}</div>
            <div style={{ height: 1, background: T.line }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <PrimaryButton onClick={play} title={name.trim() ? 'Save, apply, and go to KIT' : 'Apply without saving and go to KIT'}>PLAY THIS NOW ▸</PrimaryButton>
              <div style={{ display: 'flex', gap: 6 }}>
                <GhostButton size={11} pad="9px 12px" color={dirty ? T.ink : T.micro} border={dirty ? T.acc : T.line} onClick={() => save(false)} title={editing ? `Update "${editing.name}"` : 'Save under the name above'}>{editing ? 'SAVE' : 'SAVE GAME'}</GhostButton>
                {editing && <GhostButton size={11} pad="9px 12px" onClick={() => save(true)} title="Keep the original, save this as a new game">SAVE AS NEW</GhostButton>}
              </div>
              {saved && <div role="status" style={{ font: F.mono(600, 9), letterSpacing: '.14em', color: saved.startsWith('NAME') ? T.warn : T.ok }}>{saved}</div>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ---------- pieces ---------- */

function SlotEditor({ slot, rule, pool, weapons, perks, onRule }:
  { slot: 'primary' | 'secondary'; rule: SlotRule; pool: LoadoutPool | null; weapons: WeaponView[]; perks: PerkView[]; onRule: (r: Partial<SlotRule>) => void }) {
  const sec = slot === 'secondary';
  const allowedW = pool ? (sec ? pool.secondary_weapons : pool.primary) : [];
  const allowedK = pool ? pool.secondary_perks : [];
  const off = rule.choice === 'off', fixed = rule.choice === 'fixed';
  const showWeapons = !off && (!sec || rule.kinds.includes('weapon'));
  const showPerks = sec && !off && rule.kinds.includes('perk');
  const summary = off ? 'OFF — ALT-FIRE DOES NOTHING' : fixed ? `EVERYONE GETS ${(weapons.find(w => w.weapon_id === rule.fixed_id)?.name ?? perks.find(k => k.perk_id === rule.fixed_id)?.name ?? '—').toUpperCase()}`
    : `${allowedW.length} OF ${weapons.length} WEAPONS${sec ? ` · ${allowedK.length} PERKS` : ''}`;
  return (
    <div role="group" aria-label={`${slot} slot rules`} style={{ background: T.panelDeep, border: `1px solid ${T.line}`, borderTop: `2px solid ${sec ? PERK_COLOR : T.acc}`, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ font: F.chk(700, 13), letterSpacing: '.2em' }}>{sec ? 'SECONDARY' : 'PRIMARY'}</span>
        <span data-testid={`${slot}-summary`} style={{ font: F.mono(500, 9.5), letterSpacing: '.12em', color: T.acc }}>{summary}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ font: F.mono(600, 9), letterSpacing: '.2em', color: T.micro }}>WHO PICKS</span>
        <Seg value={rule.choice} pad="5px 11px" options={[{ value: 'player', label: 'PLAYER' }, { value: 'host', label: 'HOST' }, { value: 'fixed', label: 'FIXED' }, ...(sec ? [{ value: 'off' as SlotChoice, label: 'OFF' }] : [])]}
          onChange={(v: SlotChoice) => onRule({ choice: v, fixed_id: v === 'fixed' ? (rule.fixed_id ?? allowedW[0] ?? allowedK[0] ?? 'assault_rifle') : rule.fixed_id })} />
        {sec && !off && !fixed && (
          <span style={{ display: 'inline-flex', gap: 4, marginLeft: 'auto' }}>
            <Chip on={rule.kinds.includes('weapon')} color={T.acc} onClick={() => { const k = toggle(rule.kinds, 'weapon') as SlotRule['kinds']; if (k.length) onRule({ kinds: k }); }}>WEAPONS</Chip>
            <Chip on={rule.kinds.includes('perk')} color={PERK_COLOR} onClick={() => { const k = toggle(rule.kinds, 'perk') as SlotRule['kinds']; if (k.length) onRule({ kinds: k }); }}>PERKS</Chip>
          </span>
        )}
      </div>
      {showWeapons && !fixed && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ font: F.mono(600, 9), letterSpacing: '.2em', color: T.micro, marginRight: 4 }}>CLASSES</span>
          {TAGS.map(t => <Chip key={t.tag} on={!rule.exclude_tags.includes(t.tag)} color={t.color} onClick={() => onRule({ exclude_tags: toggle(rule.exclude_tags, t.tag) })}>{t.label}</Chip>)}
        </div>
      )}
      {showWeapons && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(112px,1fr))', gap: 6 }}>
          {weapons.map(w => {
            const inPool = allowedW.includes(w.weapon_id);
            const byId = rule.exclude_ids.includes(w.weapon_id);
            const byTag = !inPool && !byId && !fixed;
            const on = fixed ? rule.fixed_id === w.weapon_id : inPool;
            const role = roleOf(w.role, w.cls);
            const tip = fixed ? 'Tap to make this the fixed weapon' : byTag ? 'Off by a class chip above' : byId ? 'Off — tap to allow' : 'Allowed — tap to switch off';
            return (
              <button key={w.weapon_id} type="button" aria-pressed={on} disabled={byTag} title={tip} aria-label={`${w.name}${on ? ', allowed' : ', off'}`} className={byTag ? undefined : 'hov-acc'}
                onClick={() => fixed ? onRule({ fixed_id: w.weapon_id }) : onRule({ exclude_ids: toggle(rule.exclude_ids, w.weapon_id) })}
                style={{ ...BTN_RESET, display: 'flex', flexDirection: 'column', gap: 4, padding: 5, textAlign: 'left', cursor: byTag ? 'not-allowed' : 'pointer', background: on ? (fixed ? 'rgba(57,180,255,.1)' : T.panel) : T.panelDeep, border: `1px solid ${on ? (fixed ? T.acc : T.line2) : T.line}`, minHeight: 44 }}>
                <span style={{ display: 'block', height: 40, background: `url(assets/weapons/${w.weapon_id}.jpg) center/contain no-repeat, ${T.inset}`, opacity: on ? 1 : .25, filter: on ? undefined : 'grayscale(1)' }} />
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 4, alignItems: 'baseline' }}>
                  <span style={{ font: F.chk(700, 10), letterSpacing: '.04em', color: on ? T.ink : T.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.name}</span>
                  <span style={{ font: F.mono(600, 7), letterSpacing: '.1em', color: role.color, flex: 'none' }}>{role.label}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
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
      {off && <div style={{ font: F.chk(500, 12), color: T.dim }}>No slot 2 this game — the alt-fire button does nothing.</div>}
    </div>
  );
}

function Chip({ on, color, onClick, children }: { on: boolean; color: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className="hit44"
      style={{ ...BTN_RESET, font: F.chk(700, 10), letterSpacing: '.14em', padding: '5px 9px', minHeight: 30, cursor: 'pointer', border: `1px solid ${on ? color : T.line}`, color: on ? T.accInk : T.micro, background: on ? color : 'transparent' }}>
      {on ? '✓ ' : ''}{children}
    </button>
  );
}
function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 52 }}><span style={{ font: F.chk(600, 13), letterSpacing: '.1em' }}>{label}</span>{children}</div>;
}
function Hint({ children }: { children: React.ReactNode }) { return <span style={{ font: F.mono(500, 9), color: T.micro, marginLeft: 8 }}>// {children}</span>; }
