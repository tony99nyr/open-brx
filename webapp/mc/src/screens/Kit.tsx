import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Loadout, PerkView, Player, WeaponView } from '../api/types';
import { useStore } from '../store';
import { EvictButton } from '../ui/EvictButton';
import { CHAMFER, F, PERK_COLOR, T, TAB, fmtAge, roleOf, teamColor } from '../tokens';
import { BTN_RESET, Blink, Brackets, DraftText, GhostButton, NumberCell, PanelHeader, Progress, ScreenHeader, SectionRule, Seg, SegBar, StripedSlot, Tag, onKey, PrimaryButton } from '../ui';

type Slot = 'primary' | 'secondary';
const PRESET_LABEL: Record<string, string> = { open: 'OPEN', no_heavies: 'NO HEAVIES', snipers: 'SNIPERS ONLY', custom: 'CUSTOM RULES' };

export function Kit() {
  const { state, weapons, perks, selPlayer, setSelPlayer, run, api, setView } = useStore();
  const [registry, setRegistry] = useState<{ gun_id: string; sticker: string; ble: { tail?: string } }[]>([]);
  useEffect(() => { api.armory().then(setRegistry).catch(() => {}); }, [api]);
  const [verdicts, setVerdicts] = useState<Record<string, { verdict: 'pass' | 'issue'; note: string }>>({});
  useEffect(() => { api.rangeVerdicts().then(v => setVerdicts(v as never)).catch(() => {}); }, [api]);
  const [newName, setNewName] = useState('');
  const [slot, setSlot] = useState<Slot>('primary');
  const [secKind, setSecKind] = useState<'weapon' | 'perk'>('weapon');
  if (!state) return null;
  const players = state.players;
  const sp = players.find(p => p.player_id === selPlayer) ?? players[0];
  const pol = state.config.loadout_policy?.primary ? state.config.loadout_policy : undefined;   // older MC / pre-A10 session: no rules
  const pool = state.loadout_pool ?? { primary: weapons.map(w => w.weapon_id), secondary_weapons: weapons.map(w => w.weapon_id), secondary_perks: perks.map(k => k.perk_id) };
  const trying = state.kit.trying;
  const browsing = state.kit.browsing ?? {};
  const kitted = players.filter(p => (p.loadout?.weapons?.length ?? 0) > 0 && p.team_id && p.gun_id).length;   // no gun = cannot play (critic #8)
  const nReady = players.filter(p => p.ready).length;
  const node = sp ? state.nodes.find(n => n.player_id === sp.player_id) : undefined;
  const patch = (p: Partial<Player>) => sp && run(() => api.patchPlayer(sp.player_id, p));

  const wById = (id?: string | null) => weapons.find(w => w.weapon_id === id);
  const kById = (id?: string | null) => perks.find(k => k.perk_id === id);
  const lo: Loadout = sp?.loadout ?? { weapons: [] };
  const primary = wById(lo.weapons?.[0]?.weapon_id);
  const secondaryW = wById(lo.weapons?.[1]?.weapon_id);
  const perk = kById(lo.perk);
  const secRule = pol?.secondary, primRule = pol?.primary;
  const slotLocked = (s: Slot) => { const r = s === 'primary' ? primRule : secRule; return r?.choice === 'fixed' || r?.choice === 'off'; };
  // what the arsenal below is showing
  const showKind: 'weapon' | 'perk' = slot === 'primary' ? 'weapon' : secKind;
  const focusItem: WeaponView | PerkView | undefined = slot === 'primary' ? primary : (secondaryW ?? perk);

  // The host's last write per slot. When choice=player BOTH the phone and the host may write; if the phone lands
  // a pick seconds after the host did, the card would just flip — say so instead (brx-opus2, 2026-08-27).
  const hostPick = useRef<{ pid: string; slot: Slot; id: string | null; label: string; t: number } | null>(null);
  const [, bump] = useState(0);
  useEffect(() => { const h = setInterval(() => { if (hostPick.current && Date.now() - hostPick.current.t > 12_000) { hostPick.current = null; bump(v => v + 1); } }, 1000); return () => clearInterval(h); }, []);
  const setLoadout = async (next: Loadout, tryWeapon?: string, note?: { slot: Slot; id: string | null; label: string }) => {
    if (!sp) return;
    if (note) { hostPick.current = { pid: sp.player_id, ...note, t: Date.now() }; }
    await patch({ loadout: { ...(sp.loadout ?? {}), ...next } });
    if (tryWeapon && !state.lobby.pushed) await run(() => api.tryout(sp.player_id, tryWeapon));
  };
  const pickPrimary = (w: WeaponView) => setLoadout({ weapons: [{ weapon_id: w.weapon_id }, ...(lo.weapons ?? []).slice(1, 2)], perk: lo.perk ?? null }, w.weapon_id, { slot: 'primary', id: w.weapon_id, label: w.name });
  const pickSecondary = (w: WeaponView) => setLoadout({ weapons: [lo.weapons[0] ?? { weapon_id: 'assault_rifle' }, { weapon_id: w.weapon_id }], perk: null }, w.weapon_id, { slot: 'secondary', id: w.weapon_id, label: w.name });
  const pickPerk = (k: PerkView) => setLoadout({ weapons: [lo.weapons[0] ?? { weapon_id: 'assault_rifle' }], perk: k.perk_id }, undefined, { slot: 'secondary', id: k.perk_id, label: k.name });
  const clearSecondary = () => setLoadout({ weapons: [lo.weapons[0] ?? { weapon_id: 'assault_rifle' }], perk: null }, undefined, { slot: 'secondary', id: null, label: 'EMPTY' });
  // did the phone overwrite the host's pick within the hold window?
  const overridden = (s: Slot) => {
    const h = hostPick.current; if (!h || h.pid !== sp?.player_id || h.slot !== s) return null;
    const cur = s === 'primary' ? (primary?.weapon_id ?? null) : (secondaryW?.weapon_id ?? perk?.perk_id ?? null);
    return cur !== h.id ? h : null;
  };
  const reapply = (h: { slot: Slot; id: string | null }) => {
    if (h.slot === 'primary') { const w = wById(h.id); if (w) pickPrimary(w); return; }
    const w = wById(h.id), k = kById(h.id);
    if (w) pickSecondary(w); else if (k) pickPerk(k); else clearSecondary();
  };

  const rulesChip = pol && (
    <button type="button" className="hov-acc" onClick={() => setView('build')} title="Loadout rules are set in BUILD"
      style={{ ...BTN_RESET, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', border: `1px solid ${T.line}`, minHeight: 36, cursor: 'pointer' }}>
      <span style={{ width: 6, height: 6, background: PERK_COLOR }} />
      <span style={{ font: F.mono(600, 10), letterSpacing: '.2em', color: T.dim }}>RULES</span>
      <span style={{ font: F.chk(700, 11), letterSpacing: '.14em' }}>{PRESET_LABEL[pol.preset] ?? pol.preset.toUpperCase()}</span>
      {!pol.hud_select && <span style={{ font: F.mono(500, 9), letterSpacing: '.14em', color: T.micro }}>· PHONE PICKS OFF</span>}
    </button>
  );

  return (
    <div className="screen">
      <ScreenHeader kicker="[ A3 // KIT-OUT ]" title="Kit Each Player" right={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          {rulesChip}
          <Progress n={kitted} total={players.length} label="KITTED" />
          <span style={{ font: F.osw(700, 20), ...TAB, color: nReady === players.length && players.length ? T.ok : T.ink }}>{nReady}<span style={{ color: T.micro }}>/{players.length} READY</span></span>
          <PrimaryButton size={12} pad="9px 18px" onClick={async () => { await run(() => api.setPhase('lobby')); setView('lobby'); }}>CONTINUE ▸</PrimaryButton>
        </span>} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
        {/* roster */}
        <div className="kit-roster" style={{ flex: '1 1 250px', maxWidth: 330, display: 'flex', flexDirection: 'column' }}>
          <div style={{ border: `1px solid ${T.line}`, borderBottom: 'none' }}><PanelHeader label="SQUAD ROSTER" right={<span style={{ font: F.mono(500, 10), letterSpacing: '.14em', color: T.micro }}>{players.length} OPERATORS</span>} /></div>
          <div className="kit-roster-rows" style={{ display: 'flex', flexDirection: 'column', gap: 3, border: `1px solid ${T.line}`, padding: 6, background: T.panelDeep }}>
            {players.map(pl => {
              const on = pl.player_id === sp?.player_id;
              const tw = trying[pl.player_id];
              const isBrowsing = !!browsing[pl.player_id];
              const plo = pl.loadout ?? { weapons: [] };
              const p0 = wById(plo.weapons?.[0]?.weapon_id), p1 = wById(plo.weapons?.[1]?.weapon_id), pk = kById(plo.perk);
              const kittedRow = !!(p0 && pl.team_id && pl.gun_id);
              let chip: ReactNode;
              if (tw) chip = <span style={{ font: F.chk(700, 9), letterSpacing: '.14em', color: T.accInk, background: T.warn, padding: '2px 7px', animation: 'tryPulse 1.6s infinite', whiteSpace: 'nowrap' }}>TRYING {(wById(tw)?.name ?? tw).toUpperCase()}</span>;
              else if (pl.ready) chip = <span style={{ font: F.chk(700, 10), letterSpacing: '.14em', color: T.ok }}>READY ✓</span>;
              else if (isBrowsing) chip = <span style={{ font: F.chk(700, 10), letterSpacing: '.14em', color: T.acc, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Blink color={T.acc} period={1.2} size={6} />PICKING…</span>;
              else chip = <span style={{ font: F.chk(700, 10), letterSpacing: '.14em', color: kittedRow ? T.dim : T.micro }}>{kittedRow ? 'KITTED' : pl.gun_id ? 'FITTING' : 'NO GUN'}</span>;
              return (
                <div key={pl.player_id} className="hov-acc kit-row" role="button" tabIndex={0} aria-pressed={on} onClick={() => setSelPlayer(pl.player_id)} onKeyDown={onKey(() => setSelPlayer(pl.player_id))}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: on ? 'rgba(57,180,255,.06)' : 'transparent', border: `1px solid ${on ? T.acc : 'transparent'}`, cursor: 'pointer', minHeight: 44 }}>
                  <span style={{ width: 4, alignSelf: 'stretch', background: teamColor(pl.team_id) }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', font: F.chk(700, 14), letterSpacing: '.14em' }}><span style={{ color: T.micro, font: F.mono(500, 10) }}>#{pl.player_num} </span>{pl.display}</span>
                    <span style={{ display: 'flex', gap: 8, font: F.mono(500, 10), letterSpacing: '.06em', color: T.micro, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                      <span>{pl.gun_id ?? 'NO GUN'}</span>
                      <span style={{ color: T.faint }}>·</span>
                      <span style={{ color: T.dim, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p0 ? shortName(p0.name) : '—'}
                        <span style={{ color: T.faint }}> + </span>
                        {p1 ? shortName(p1.name) : pk ? <span style={{ color: PERK_COLOR }}>◆ {pk.name.toUpperCase()}</span> : <span style={{ color: T.faint }}>NONE</span>}</span>
                    </span>
                  </span>
                  {chip}
                </div>
              );
            })}
            <form onSubmit={e => { e.preventDefault(); if (newName.trim()) { run(() => api.addPlayer({ display: newName.trim() })); setNewName(''); } }}
              style={{ display: 'flex', gap: 6, padding: '6px 4px 2px' }}>
              <input className="textbox" value={newName} onChange={e => setNewName(e.target.value)} placeholder="+ ADD OPERATOR" aria-label="new operator callsign"
                style={{ flex: 1, font: F.chk(600, 12), letterSpacing: '.1em', borderBottomColor: T.line, minHeight: 44 }} />
              <GhostButton size={10} pad="4px 10px">ADD</GhostButton>
            </form>
          </div>
        </div>

        {/* detail */}
        {sp && (
          <div style={{ flex: '3 1 560px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            {/* identity strip */}
            <div style={{ background: T.panel, border: `1px solid ${T.line}`, padding: '16px 20px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px 28px', clipPath: CHAMFER.tr14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span style={{ width: 6, height: 46, background: teamColor(sp.team_id) }} />
                <div>
                  <div style={{ font: F.mono(500, 9), letterSpacing: '.26em', color: T.micro }}>OPERATOR
                    <span style={{ marginLeft: 10, color: T.acc }}>#<PlayerNum key={sp.player_id} value={sp.player_num} onCommit={n => patch({ player_num: n })} /></span>
                  </div>
                  <DraftText key={sp.player_id} value={sp.display} ariaLabel="operator callsign" transform={s => s.toUpperCase()} onCommit={v => patch({ display: v })}
                    style={{ font: F.osw(700, 32), letterSpacing: '.1em', width: `${Math.max(6, sp.display.length + 1)}ch`, minHeight: 44 }} />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ font: F.mono(500, 9), letterSpacing: '.22em', color: T.micro }}>TEAM</span>
                <span role="group" aria-label="team" style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {(state.config.mode === 'ffa' ? ['ffa'] : state.config.teams.map(tm => tm.team_id)).map(t => {
                    const on = sp.team_id === t;
                    const col = state.teams.find(tm => tm.team_id === t)?.color ?? teamColor(t);
                    return (
                      <button key={t} type="button" className="hit44" onClick={() => patch({ team_id: t })} aria-pressed={on}
                        style={{ ...BTN_RESET, font: F.chk(700, 11), letterSpacing: '.14em', padding: '5px 12px', background: on ? col : 'transparent', color: on ? T.accInk : col, border: `1px solid ${on ? col : T.line}`, cursor: 'pointer', minHeight: 28, display: 'inline-flex', alignItems: 'center' }}>
                        {t.toUpperCase()}
                      </button>
                    );
                  })}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ font: F.mono(500, 9), letterSpacing: '.22em', color: T.micro }}>VOICE</span>
                <Seg value={sp.voice === 'female' ? 'female' : 'male'} options={[{ value: 'male', label: 'MALE' }, { value: 'female', label: 'FEMALE' }]} onChange={v => patch({ voice: v })} pad="4px 12px" />
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: T.inset, border: `1px solid ${T.line}` }}>
                <Blink color={node ? T.ok : T.bad} />
                <select aria-label={`gun for ${sp.display}`} value={sp.gun_id ?? ''} onChange={e => patch({ gun_id: e.target.value || null })}
                  style={{ background: T.inset, color: T.ink, border: `1px solid ${T.line2}`, font: F.mono(600, 11), letterSpacing: '.06em', padding: '6px 8px', minHeight: 32, cursor: 'pointer' }}>
                  <option value="">— NO GUN —</option>
                  {registry.map(r => {
                    const takenBy = players.find(q => q.player_id !== sp.player_id && q.gun_id === r.gun_id);
                    return <option key={r.gun_id} value={r.gun_id} disabled={!!takenBy}>{r.sticker}{r.ble?.tail ? `-${r.ble.tail}` : ''}{takenBy ? ` · ${takenBy.display}` : ''}</option>;
                  })}
                </select>
                <span style={{ font: F.mono(500, 11), letterSpacing: '.06em', color: node ? T.ok : sp.gun_id ? T.bad : T.micro }}>{node ? `LINKED ${fmtAge(node.last_seen_ms)}` : sp.gun_id ? 'NO NODE' : 'PICK A GUN'}</span>
                {node && <EvictButton nodeId={node.node_id} />}
              </div>
            </div>

            {/* loadout rail + hero */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'stretch' }}>
              <div className="kit-rail" style={{ flex: '1 1 280px', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <SlotCard label="PRIMARY" slot="primary" active={slot === 'primary'} onClick={() => setSlot('primary')} rule={primRule} item={primary} kind="weapon" required
                  overridden={overridden('primary')} onReapply={reapply} />
                <SlotCard label="SECONDARY" slot="secondary" active={slot === 'secondary'} onClick={() => { setSlot('secondary'); if (perk && !secondaryW) setSecKind('perk'); }} rule={secRule}
                  item={secondaryW ?? perk} kind={secondaryW ? 'weapon' : perk ? 'perk' : 'none'}
                  overridden={overridden('secondary')} onReapply={reapply}
                  onClear={(secondaryW || perk) && !slotLocked('secondary') ? clearSecondary : undefined} />
                <div style={{ font: F.mono(500, 9), letterSpacing: '.14em', color: T.micro, padding: '2px 4px' }}>
                  {pol?.hud_select ? '▲ PLAYERS PICK ON THEIR PHONE — ANYTHING YOU SET HERE OVERRIDES IT AND SHOWS ON THEIR SCREEN' : '▲ PHONE PICKS ARE OFF — YOU KIT EVERY PLAYER HERE'}
                </div>
              </div>

              {/* hero: the focused slot's item */}
              <Brackets color={slot === 'secondary' && perk && !secondaryW ? PERK_COLOR : T.acc} style={{ flex: '2 1 420px', minWidth: 0, padding: 18, display: 'flex', flexWrap: 'wrap', gap: 20 }}>
                {!focusItem ? (
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8, minHeight: 150 }}>
                    <div style={{ font: F.osw(700, 26), letterSpacing: '.08em', color: T.dim }}>{secRule?.choice === 'off' ? 'SECONDARY IS OFF FOR THIS GAME' : 'NO SECONDARY'}</div>
                    <div style={{ font: F.chk(500, 13), color: T.dim, maxWidth: '54ch', lineHeight: 1.5 }}>
                      {secRule?.choice === 'off' ? 'The ruleset switched slot 2 off for everyone. Change it in BUILD.' : 'The alt-fire button does nothing. Pick a second weapon or a perk from the arsenal below — or leave it empty; that is a valid kit.'}
                    </div>
                  </div>
                ) : 'weapon_id' in focusItem ? (
                  <WeaponHero w={focusItem} slot={slot} sp={sp} tryingId={trying[sp.player_id]} pushed={state.lobby.pushed} verdicts={verdicts} setVerdicts={setVerdicts} />
                ) : (
                  <PerkHero k={focusItem} />
                )}
              </Brackets>
            </div>

            {/* arsenal for the focused slot */}
            <div>
              <ArsenalHeader slot={slot} rule={slot === 'primary' ? primRule : secRule} pool={pool} weapons={weapons} preset={pol?.preset} secKind={secKind} setSecKind={setSecKind}
                onClear={slot === 'secondary' && (secondaryW || perk) && !slotLocked('secondary') ? clearSecondary : undefined} onBuild={() => setView('build')} />
              {(slot === 'primary' ? primRule : secRule)?.choice === 'off' ? null : showKind === 'weapon' ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(152px,1fr))', gap: 8 }}>
                  {weapons.map(w => {
                    const allowed = (slot === 'primary' ? pool.primary : pool.secondary_weapons).includes(w.weapon_id);
                    const on = slot === 'primary' ? w.weapon_id === primary?.weapon_id : w.weapon_id === secondaryW?.weapon_id;
                    const fixed = (slot === 'primary' ? primRule : secRule)?.choice === 'fixed';
                    const dis = !allowed || (fixed && !on);
                    const role = roleOf(w.role, w.cls);
                    return (
                      <div key={w.weapon_id} className={dis ? undefined : 'hov-acc'} role="button" tabIndex={dis ? -1 : 0} aria-pressed={on} aria-disabled={dis || undefined}
                        aria-label={`${w.name}, ${role.label}, magazine ${w.clip}${dis ? ', not allowed by the rules' : ''}`}
                        title={!allowed ? 'Not allowed by this game’s rules' : fixed ? 'Fixed by the ruleset' : undefined}
                        onClick={() => { if (!dis) (slot === 'primary' ? pickPrimary : pickSecondary)(w); }} onKeyDown={onKey(() => { if (!dis) (slot === 'primary' ? pickPrimary : pickSecondary)(w); })}
                        style={{ background: on ? 'rgba(57,180,255,.08)' : dis ? T.panelDeep : T.panel, border: `1px solid ${on ? T.acc : T.line}`, padding: 8, cursor: dis ? 'not-allowed' : 'pointer', display: 'flex', flexDirection: 'column', gap: 7, minHeight: 44 }}>
                        <StripedSlot height={64} style={{ background: `url(assets/weapons/${w.weapon_id}.jpg) center/contain no-repeat, repeating-linear-gradient(45deg,${T.slot} 0 6px,${T.panel} 6px 12px)`, opacity: dis ? .25 : 1, filter: dis ? 'grayscale(1)' : undefined }}
                          corner={<>
                            <span style={{ position: 'absolute', top: 3, right: 5, font: F.mono(600, 8), letterSpacing: '.14em', color: role.color }}>{role.label}</span>
                            {on && <span style={{ position: 'absolute', top: 3, left: 5, font: F.chk(700, 8), letterSpacing: '.14em', color: T.accInk, background: T.acc, padding: '1px 5px' }}>{slot === 'primary' ? 'PRIMARY' : 'SECONDARY'}</span>}
                          </>} />
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
                          {dis && <Lock color={T.micro} size={10} />}
                          <span style={{ font: F.chk(700, 12), letterSpacing: '.05em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: dis ? T.dim : T.ink, flex: 1 }}>{w.name}</span>
                          {w.caution && <span title={w.caution} aria-label={w.caution} style={{ font: F.chk(700, 10), color: T.bad }}>▲</span>}
                          <span style={{ font: F.osw(600, 11), ...TAB, color: T.micro }} title={`magazine ${w.clip}`}>MAG {w.clip}</span>
                          {verdicts[w.weapon_id] && <span title={verdicts[w.weapon_id].note || undefined} style={{ font: F.chk(700, 10), color: verdicts[w.weapon_id].verdict === 'pass' ? T.ok : T.bad }}>{verdicts[w.weapon_id].verdict === 'pass' ? '✓' : '✗'}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 8 }}>
                  {perks.map(k => {
                    const allowed = pool.secondary_perks.includes(k.perk_id);
                    const on = k.perk_id === perk?.perk_id;
                    const fixed = secRule?.choice === 'fixed';
                    const dis = !allowed || (fixed && !on);
                    return (
                      <div key={k.perk_id} className={dis ? undefined : 'hov-acc'} role="button" tabIndex={dis ? -1 : 0} aria-pressed={on} aria-disabled={dis || undefined}
                        aria-label={`${k.name} perk${dis ? ', not allowed by the rules' : ''}`} title={!allowed ? 'Not allowed by this game’s rules' : undefined}
                        onClick={() => { if (!dis) pickPerk(k); }} onKeyDown={onKey(() => { if (!dis) pickPerk(k); })}
                        style={{ background: on ? 'rgba(196,139,255,.08)' : T.panel, border: `1px solid ${on ? PERK_COLOR : T.line}`, padding: 10, cursor: dis ? 'not-allowed' : 'pointer', display: 'flex', gap: 12, alignItems: 'center', minHeight: 44, opacity: dis ? .32 : 1 }}>
                        <span style={{ width: 52, height: 52, flex: 'none', display: 'grid', placeItems: 'center', background: T.inset, border: `1px solid ${on ? PERK_COLOR : T.line}` }}><PerkGlyph id={k.perk_id} size={30} color={on ? PERK_COLOR : T.dim} /></span>
                        <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                            <span style={{ font: F.chk(700, 13), letterSpacing: '.05em' }}>{k.name}</span>
                            {!k.verified && <span title="Effect not yet proven on hardware" style={{ font: F.mono(500, 8), letterSpacing: '.14em', color: T.warn }}>UNPROVEN</span>}
                          </span>
                          <span style={{ font: F.mono(600, 10), letterSpacing: '.1em', color: PERK_COLOR }}>{effectLine(k)}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- pieces ---------- */

function SlotCard({ label, slot, active, onClick, rule, item, kind, required, onClear, overridden, onReapply }:
  { label: string; slot: Slot; active: boolean; onClick: () => void; rule?: { choice: string } | null; item?: WeaponView | PerkView; kind: 'weapon' | 'perk' | 'none'; required?: boolean; onClear?: () => void;
    overridden?: { slot: Slot; id: string | null; label: string } | null; onReapply?: (h: { slot: Slot; id: string | null }) => void }) {
  const choice = rule?.choice ?? 'player';
  const locked = choice === 'fixed' || choice === 'off';
  const right = choice === 'fixed' ? 'FIXED · SET IN BUILD' : choice === 'off' ? 'OFF · SET IN BUILD' : choice === 'host' ? 'HOST PICKS' : 'PLAYER PICKS · YOU CAN OVERRIDE';
  const isPerk = kind === 'perk' && item && 'perk_id' in item;
  const color = isPerk ? PERK_COLOR : T.acc;
  const empty = kind === 'none';
  return (
    <div role="button" tabIndex={0} aria-pressed={active} onClick={onClick} onKeyDown={onKey(onClick)} className="hov-acc"
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', minHeight: 96, cursor: 'pointer',
        background: active ? (isPerk ? 'rgba(196,139,255,.07)' : 'rgba(57,180,255,.07)') : T.panel,
        borderTop: `1px ${empty ? 'dashed' : 'solid'} ${active ? color : T.line}`, borderRight: `1px ${empty ? 'dashed' : 'solid'} ${active ? color : T.line}`, borderBottom: `1px ${empty ? 'dashed' : 'solid'} ${active ? color : T.line}`, borderLeft: `3px solid ${active ? color : T.line2}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ font: F.chk(700, 12), letterSpacing: '.22em', color: active ? color : T.dim }}>{active ? '▸ ' : ''}{label}</span>
        <span style={{ font: F.mono(500, 8.5), letterSpacing: '.12em', color: locked ? T.warn : T.micro, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}>{locked && <Lock color={T.warn} />}{right}</span>
      </div>
      {empty ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48 }}>
          <span style={{ width: 64, height: 44, flex: 'none', border: `1px dashed ${T.line2}`, display: 'grid', placeItems: 'center', font: F.osw(700, 20), color: T.faint }}>—</span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ font: F.osw(700, 18), letterSpacing: '.06em', color: T.dim }}>{choice === 'off' ? 'OFF' : 'EMPTY'}</span>
            <span style={{ font: F.chk(500, 11), color: T.micro }}>{choice === 'off' ? 'Ruleset — no slot 2 this game' : 'Alt-fire does nothing · tap to pick'}</span>
          </span>
        </div>
      ) : item && 'weapon_id' in item ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48 }}>
          <span style={{ width: 84, height: 48, flex: 'none', background: `url(assets/weapons/${item.weapon_id}.jpg) center/contain no-repeat, ${T.inset}`, border: `1px solid ${T.line}` }} />
          <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ font: F.osw(700, 18), letterSpacing: '.06em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name.toUpperCase()}</span>
            <span style={{ font: F.mono(500, 10), letterSpacing: '.1em', color: T.micro }}><span style={{ color: roleOf(item.role, item.cls).color }}>{roleOf(item.role, item.cls).label}</span> · MAG {item.clip} · RES {item.reserve}</span>
          </span>
        </div>
      ) : item && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48 }}>
          <span style={{ width: 48, height: 48, flex: 'none', display: 'grid', placeItems: 'center', background: T.inset, border: `1px solid ${PERK_COLOR}` }}><PerkGlyph id={item.perk_id} size={28} color={PERK_COLOR} /></span>
          <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ font: F.osw(700, 18), letterSpacing: '.06em' }}>{item.name.toUpperCase()}</span>
            <span style={{ font: F.mono(500, 10), letterSpacing: '.1em', color: PERK_COLOR }}>PERK · {effectLine(item)}</span>
          </span>
        </div>
      )}
      {onClear && (
        <button type="button" onClick={e => { e.stopPropagation(); onClear(); }} aria-label={`clear ${slot}`} title="Leave slot 2 empty" className="hov-acc-ink"
          style={{ ...BTN_RESET, position: 'absolute', right: 8, bottom: 8, font: F.mono(600, 9), letterSpacing: '.14em', color: T.micro, padding: '6px 8px', minHeight: 32 }}>✕ CLEAR</button>
      )}
      {required && !item && <span style={{ font: F.mono(500, 9), color: T.bad }}>A PRIMARY IS REQUIRED</span>}
      {overridden && (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', font: F.mono(600, 9.5), letterSpacing: '.12em', color: T.warn }}>
          ▲ CHANGED FROM THEIR PHONE — YOURS WAS {overridden.label.toUpperCase()}
          <button type="button" onClick={e => { e.stopPropagation(); onReapply?.(overridden); }} className="hov-warnbg"
            style={{ ...BTN_RESET, font: F.chk(700, 10), letterSpacing: '.16em', color: T.warn, border: `1px solid ${T.warn}`, padding: '5px 10px', minHeight: 32 }}>REAPPLY MINE</button>
        </div>
      )}
    </div>
  );
}

function ArsenalHeader({ slot, rule, pool, weapons, preset, secKind, setSecKind, onClear, onBuild }:
  { slot: Slot; rule?: { choice: string; kinds?: string[] } | null; pool: { primary: string[]; secondary_weapons: string[]; secondary_perks: string[] }; weapons: WeaponView[];
    preset?: string; secKind: 'weapon' | 'perk'; setSecKind: (k: 'weapon' | 'perk') => void; onClear?: () => void; onBuild: () => void }) {
  const choice = rule?.choice ?? 'player';
  const nAllowed = slot === 'primary' ? pool.primary.length : pool.secondary_weapons.length;
  const presetTxt = preset && preset !== 'open' ? ` · ${PRESET_LABEL[preset] ?? preset.toUpperCase()}` : '';
  const summary = choice === 'fixed' ? 'FIXED BY THE RULESET' : choice === 'off' ? 'OFF FOR THIS GAME'
    : slot === 'secondary' && secKind === 'perk' ? `${pool.secondary_perks.length} PERKS${presetTxt}`
    : `${nAllowed} OF ${weapons.length} WEAPONS${presetTxt}`;
  const hint = choice === 'fixed' || choice === 'off'
    ? <button type="button" className="hov-acc-ink" onClick={onBuild} style={{ ...BTN_RESET, font: F.mono(600, 9), letterSpacing: '.18em', color: T.warn, minHeight: 32 }}>CHANGE IN BUILD ▸</button>
    : <span>{slot === 'primary' ? 'SELECT TO ARM · TRY-OUT STARTS ON PICK' : 'SELECT · WEAPONS TRY OUT ON PICK'}</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
      <SectionRule label={`ARSENAL // ${slot.toUpperCase()} · ${summary}`} hint={hint} style={{ marginBottom: 0 }} />
      {slot === 'secondary' && choice !== 'off' && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          <Seg value={secKind} onChange={setSecKind} pad="6px 14px" options={[
            ...(rule?.kinds?.includes('weapon') !== false ? [{ value: 'weapon' as const, label: `WEAPONS · ${pool.secondary_weapons.length}` }] : []),
            ...(rule?.kinds?.includes('perk') !== false ? [{ value: 'perk' as const, label: `PERKS · ${pool.secondary_perks.length}` }] : []),
          ]} />
          {onClear && <GhostButton size={10} pad="6px 12px" onClick={onClear} title="Leave slot 2 empty — alt-fire does nothing">NONE · LEAVE EMPTY</GhostButton>}
          <span style={{ font: F.mono(500, 9), letterSpacing: '.14em', color: T.micro, marginLeft: 'auto' }}>SLOT 2 IS A WEAPON <b style={{ color: T.dim }}>OR</b> A PERK</span>
        </div>
      )}
    </div>
  );
}

function WeaponHero({ w, slot, sp, tryingId, pushed, verdicts, setVerdicts }:
  { w: WeaponView; slot: Slot; sp: Player; tryingId?: string; pushed: boolean; verdicts: Record<string, { verdict: 'pass' | 'issue'; note: string }>; setVerdicts: React.Dispatch<React.SetStateAction<Record<string, { verdict: 'pass' | 'issue'; note: string }>>> }) {
  const { run, api } = useStore();
  const role = roleOf(w.role, w.cls);
  return (
    <>
      <StripedSlot style={{ flex: '1 1 240px', maxWidth: 320, minHeight: 140, background: `url(assets/weapons/${w.weapon_id}.jpg) center/contain no-repeat` }}
        corner={<span style={{ position: 'absolute', top: 8, left: 10, zIndex: 1, font: F.mono(600, 9), letterSpacing: '.22em', color: T.dim, background: 'rgba(7,9,13,.75)', padding: '2px 6px' }}>{slot.toUpperCase()}</span>} />
      <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ font: F.osw(700, 28), letterSpacing: '.08em', textTransform: 'uppercase' }}>{w.name}</span>
          <Tag color={role.color} style={{ letterSpacing: '.22em', padding: '3px 10px' }}>{role.label}</Tag>
          {!w.verified && <span title="Retuned from the captured Callsign frame for balance — not the stock numbers" style={{ font: F.mono(500, 9), letterSpacing: '.16em', color: T.micro }}>TUNED · NOT STOCK</span>}
          {w.caution && <span role="alert" style={{ font: F.mono(600, 9), letterSpacing: '.14em', color: T.bad }}>▲ {w.caution.toUpperCase()}</span>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '7px 14px', alignItems: 'center', maxWidth: 440 }}>
          {([['DAMAGE', w.dmg], ['FIRE RATE', w.rpm]] as const).map(([l, v]) => <StatRow key={l} label={l} pct={v} />)}
        </div>
        <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <NumberCell label="MAGAZINE" value={w.clip} size={20} pad="6px 14px" />
          <NumberCell label="RESERVE" value={w.reserve} size={20} pad="6px 14px" />
          <NumberCell label="RELOAD" value={w.reload_s} unit="s" size={20} pad="6px 14px" />
          {w.htk != null && <NumberCell label="HITS TO KILL" value={w.htk} size={20} pad="6px 14px" color={w.htk <= 2 ? T.warn : T.ink} />}
        </div>
        {w.desc && <div style={{ font: F.chk(500, 12), lineHeight: 1.5, color: T.dim, maxWidth: '54ch' }}>{w.desc}</div>}
        {tryingId && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', font: F.mono(500, 10), letterSpacing: '.12em', color: T.warn }}>
            ▲ TRYING OUT ON {sp.display}'S GUN — HAVE THEM FIRE A FEW ROUNDS · POINT AWAY FROM OTHERS
            <GhostButton size={10} pad="4px 10px" onClick={() => run(() => api.endTryout(sp.player_id))}>END TRY-OUT</GhostButton>
            <span style={{ display: 'inline-flex', gap: 6 }}>
              <GhostButton size={10} pad="4px 10px" onClick={async () => { await run(() => api.rangeVerdict(tryingId, 'pass')); setVerdicts(v => ({ ...v, [tryingId]: { verdict: 'pass', note: '' } })); }}>SOUNDS RIGHT ✓</GhostButton>
              <GhostButton size={10} pad="4px 10px" onClick={async () => { const note = window.prompt('what is wrong? (sound / rate / damage / no burst…)'); if (note === null) return; await run(() => api.rangeVerdict(tryingId, 'issue', note)); setVerdicts(v => ({ ...v, [tryingId]: { verdict: 'issue', note } })); }}>LOG ISSUE ✗</GhostButton>
            </span>
          </div>
        )}
        {pushed && <div style={{ font: F.mono(500, 9), letterSpacing: '.12em', color: T.micro }}>TRY-OUTS CLOSED — THE GAME HAS BEEN PUSHED TO THE GUNS</div>}
        {verdicts[w.weapon_id]?.verdict === 'issue' && <div style={{ font: F.mono(500, 9), letterSpacing: '.12em', color: T.bad }}>RANGE LOG: {verdicts[w.weapon_id].note.toUpperCase()}</div>}
      </div>
    </>
  );
}

function PerkHero({ k }: { k: PerkView }) {
  const fx = k.effects ?? {};
  return (
    <>
      <div style={{ flex: '0 0 auto', width: 150, minHeight: 140, display: 'grid', placeItems: 'center', background: T.inset, border: `1px solid ${PERK_COLOR}` }}>
        <PerkGlyph id={k.perk_id} size={86} color={PERK_COLOR} />
      </div>
      <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ font: F.osw(700, 28), letterSpacing: '.08em', textTransform: 'uppercase' }}>{k.name}</span>
          <Tag color={PERK_COLOR} style={{ letterSpacing: '.22em', padding: '3px 10px' }}>PERK</Tag>
          {!k.verified && <span title="Effect not yet proven on hardware" style={{ font: F.mono(500, 9), letterSpacing: '.16em', color: T.warn }}>UNPROVEN ON HARDWARE</span>}
        </div>
        <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {fx.max_armor_add != null && <NumberCell label="ARMOR" value={`+${fx.max_armor_add}`} color={PERK_COLOR} size={20} pad="6px 14px" />}
          {fx.ammo_mult != null && <NumberCell label="MAG & RESERVE" value={`×${fx.ammo_mult}`} color={PERK_COLOR} size={20} pad="6px 14px" />}
          {fx.reload_mult != null && <NumberCell label="RELOADS" value={`${+(1 / fx.reload_mult).toFixed(1)}× FASTER`} color={PERK_COLOR} size={20} pad="6px 14px" />}
          {fx.alt_reload && <NumberCell label="ALT BUTTON" value="RELOAD" color={PERK_COLOR} size={20} pad="6px 14px" />}
        </div>
        <div style={{ font: F.chk(500, 13), lineHeight: 1.5, color: T.body, maxWidth: '54ch' }}>{k.desc}</div>
        <div style={{ font: F.mono(500, 9), letterSpacing: '.12em', color: T.micro }}>PASSIVE — APPLIED TO THE GUN WHEN THE GAME IS PUSHED · NOTHING TO TRY OUT · ALT-FIRE DOES NOT SWITCH WEAPONS</div>
      </div>
    </>
  );
}

export function Lock({ color = T.warn, size = 10 }: { color?: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" fill={color} /><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke={color} strokeWidth="2.5" /></svg>;
}

export function PerkGlyph({ id, size = 24, color = PERK_COLOR }: { id: string; size?: number; color?: string }) {
  const c = { fill: 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'body_armor': return <svg width={size} height={size} viewBox="0 0 24 24"><path {...c} d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /><path {...c} d="M12 3v18M4 12h16" opacity=".5" /></svg>;
    case 'extended_mags': return <svg width={size} height={size} viewBox="0 0 24 24"><path {...c} d="M8 3h8v18H8zM8 8h8M8 13h8M8 18h8" /><path {...c} d="M4 6v12M20 6v12" opacity=".5" /></svg>;
    case 'quick_hands': return <svg width={size} height={size} viewBox="0 0 24 24"><path {...c} d="M13 2 5 13h6l-1 9 9-12h-6z" /></svg>;
    case 'easy_reload': return <svg width={size} height={size} viewBox="0 0 24 24"><path {...c} d="M20 12a8 8 0 1 1-2.3-5.7" /><path {...c} d="M20 4v5h-5" /><circle cx="12" cy="12" r="2" fill={color} stroke="none" /></svg>;
    case 'med_kit': return <svg width={size} height={size} viewBox="0 0 24 24"><rect {...c} x="3" y="6" width="18" height="14" rx="2" /><path {...c} d="M12 10v6M9 13h6M9 6V4h6v2" /></svg>;
    default: return <svg width={size} height={size} viewBox="0 0 24 24"><circle {...c} cx="12" cy="12" r="8" /><path {...c} d="M12 8v4l3 2" /></svg>;
  }
}

const effectLine = (k: PerkView) => {
  const fx = k.effects ?? {}; const out: string[] = [];
  if (fx.max_armor_add != null) out.push(`+${fx.max_armor_add} ARMOR`);
  if (fx.ammo_mult != null) out.push(`×${fx.ammo_mult} AMMO`);
  if (fx.reload_mult != null) out.push(`RELOADS ${+(1 / fx.reload_mult).toFixed(1)}× FASTER`);
  if (fx.alt_reload) out.push('ALT BUTTON RELOADS');
  return out.join(' · ') || 'PASSIVE';
};
const shortName = (n: string) => n.replace(/ Rifle$/i, '').replace(/ Launcher$/i, ' LNCHR').toUpperCase();

/** Player number 1–63, draft-then-commit (see ValueBox). */
function PlayerNum({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false), pending = useRef<number | null>(null), latest = useRef(value);
  latest.current = value;
  useEffect(() => { if (pending.current != null && value === pending.current) pending.current = null; if (!focused.current && pending.current == null) setDraft(String(value)); }, [value]);
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === '' || String(value) === draft.trim()) { setDraft(String(value)); return; }
    if (Number.isInteger(n) && n >= 1 && n <= 63) { setInvalid(false); pending.current = n; onCommit(n); setTimeout(() => { if (pending.current != null) { pending.current = null; setDraft(String(latest.current)); } }, 1500); }
    else { setInvalid(true); setDraft(String(value)); }   // never a silent revert: the hint below explains
  };
  const setFocused = (f: boolean) => { focused.current = f; };
  return (
    <>
      <input className="numbox" type="number" min={1} max={63} value={draft} aria-label="player number (1–63)" aria-invalid={invalid || undefined}
        style={{ width: '2.6em', font: F.mono(600, 10), color: invalid ? T.bad : T.acc, textAlign: 'left', minHeight: 32, borderBottom: invalid ? `1px solid ${T.bad}` : undefined }}
        onFocus={() => { setFocused(true); setInvalid(false); }} onBlur={() => { setFocused(false); commit(); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        onChange={e => setDraft(e.target.value)} />
      {invalid && <span role="alert" style={{ marginLeft: 8, font: F.mono(500, 9), letterSpacing: '.12em', color: T.bad }}>PLAYER NUMBER MUST BE 1–63</span>}
    </>
  );
}

function StatRow({ label, pct }: { label: string; pct: number }) {
  return (
    <>
      <span style={{ font: F.mono(500, 9.5), letterSpacing: '.2em', color: T.micro }}>{label}</span>
      <SegBar pct={pct} color={T.ink} height={10} cell={10} style={{ display: 'block' }} />
    </>
  );
}
