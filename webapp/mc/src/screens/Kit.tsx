import { useEffect, useRef, useState } from 'react';
import type { Player, WeaponView } from '../api/types';
import { useStore } from '../store';
import { EvictButton } from '../ui/EvictButton';
import { CHAMFER, CLS_COLOR, F, T, TAB, fmtAge, teamColor } from '../tokens';
import { BTN_RESET, Blink, Brackets, DraftText, GhostButton, NumberCell, PanelHeader, Progress, ScreenHeader, SectionRule, Seg, SegBar, StripedSlot, StripedSlot as Slot, Tag, onKey, PrimaryButton } from '../ui';

export function Kit() {
  const [registry, setRegistry] = useState<{ gun_id: string; sticker: string; ble: { tail?: string } }[]>([]);
  useEffect(() => { api.armory().then(setRegistry).catch(() => {}); }, []);
  const { state, weapons, selPlayer, setSelPlayer, run, api, setView } = useStore();
  const [newName, setNewName] = useState('');
  if (!state) return null;
  const players = state.players;
  const sp = players.find(p => p.player_id === selPlayer) ?? players[0];
  const kitted = players.filter(p => (p.loadout?.weapons?.length ?? 0) > 0 && p.team_id && p.gun_id).length;   // no gun = cannot play (critic #8)
  const selWeapon = weapons.find(w => w.weapon_id === sp?.loadout?.weapons?.[0]?.weapon_id) ?? weapons[0];
  const trying = state.kit.trying;
  const node = sp ? state.nodes.find(n => n.player_id === sp.player_id) : undefined;
  const patch = (p: Partial<Player>) => sp && run(() => api.patchPlayer(sp.player_id, p));

  const pickWeapon = async (w: WeaponView) => {
    if (!sp) return;
    await patch({ loadout: { ...(sp.loadout ?? {}), weapons: [{ weapon_id: w.weapon_id }, ...(sp.loadout?.weapons ?? []).slice(1)] } });
    if (!state.lobby.pushed) await run(() => api.tryout(sp.player_id, w.weapon_id));
  };

  return (
    <div className="screen">
      <ScreenHeader kicker="[ A3 // KIT-OUT ]" title="Kit Each Player" right={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 14 }}><Progress n={kitted} total={players.length} label="KITTED" /><PrimaryButton size={12} pad="9px 18px" onClick={async () => { await run(() => api.setPhase('lobby')); setView('lobby'); }}>CONTINUE ▸</PrimaryButton></span>} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
        {/* roster */}
        <div style={{ flex: '1 1 250px', maxWidth: 330, display: 'flex', flexDirection: 'column' }}>
          <div style={{ border: `1px solid ${T.line}`, borderBottom: 'none' }}><PanelHeader label="SQUAD ROSTER" /></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, border: `1px solid ${T.line}`, padding: 6, background: T.panelDeep }}>
            {players.map(pl => {
              const on = pl.player_id === sp?.player_id;
              const tw = trying[pl.player_id];
              const st = tw ? '' : (pl.loadout?.weapons?.length ?? 0) && pl.team_id ? 'KITTED' : pl.team_id ? 'FITTING' : '—';
              const stColor = st === 'KITTED' ? T.ok : st === 'FITTING' ? T.acc : T.micro;
              return (
                <div key={pl.player_id} className="hov-acc" role="button" tabIndex={0} aria-pressed={on} onClick={() => setSelPlayer(pl.player_id)} onKeyDown={onKey(() => setSelPlayer(pl.player_id))}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', background: on ? 'rgba(57,180,255,.06)' : 'transparent', border: `1px solid ${on ? T.acc : 'transparent'}`, cursor: 'pointer', minHeight: 44 }}>
                  <span style={{ width: 4, alignSelf: 'stretch', background: teamColor(pl.team_id) }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', font: F.chk(700, 14), letterSpacing: '.14em' }}><span style={{ color: T.micro, font: F.mono(500, 10) }}>#{pl.player_num} </span>{pl.display}</span>
                    <span style={{ display: 'block', font: F.mono(500, 10), letterSpacing: '.08em', color: T.micro }}>{pl.gun_id ?? 'NO GUN'}</span>
                  </span>
                  {tw && <span style={{ font: F.chk(700, 9), letterSpacing: '.14em', color: T.accInk, background: T.warn, padding: '2px 7px', animation: 'tryPulse 1.6s infinite', whiteSpace: 'nowrap' }}>TRYING {(weapons.find(w => w.weapon_id === tw)?.name ?? tw).toUpperCase()}</span>}
                  <span style={{ font: F.chk(700, 10), letterSpacing: '.14em', color: stColor }}>{st}</span>
                </div>
              );
            })}
            <form onSubmit={e => { e.preventDefault(); if (newName.trim()) { run(() => api.addPlayer({ display: newName.trim() })); setNewName(''); } }}
              style={{ display: 'flex', gap: 6, padding: '6px 4px 2px' }}>
              <input className="textbox" value={newName} onChange={e => setNewName(e.target.value)} placeholder="+ ADD OPERATOR" aria-label="new operator callsign" maxLength={24}
                style={{ flex: 1, font: F.chk(600, 12), letterSpacing: '.12em', color: T.dim, borderBottom: `1px solid ${T.line}`, minHeight: 44 }} />
              <GhostButton size={10} pad="4px 10px">ADD</GhostButton>
            </form>
          </div>
        </div>
        {/* loadout */}
        {sp && (
          <div style={{ flex: '3 1 560px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
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
            {/* weapon hero */}
            {selWeapon && (
              <Brackets style={{ padding: 20, display: 'flex', flexWrap: 'wrap', gap: 24 }}>
                <Slot style={{ flex: '1 1 260px', maxWidth: 340, minHeight: 150, background: `url(assets/weapons/${selWeapon.weapon_id}.jpg) center/contain no-repeat` }}
                  corner={<span style={{ position: 'absolute', top: 8, left: 10, font: F.mono(500, 9), letterSpacing: '.22em', color: T.micro, textShadow: '0 1px 6px rgba(0,0,0,.9)' }}>VISUAL</span>}>
                  
                </Slot>
                <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
                    <span style={{ font: F.osw(700, 30), letterSpacing: '.08em', textTransform: 'uppercase' }}>{selWeapon.name}</span>
                    <Tag color={CLS_COLOR[selWeapon.cls] ?? T.acc} style={{ letterSpacing: '.22em', padding: '3px 10px' }}>{selWeapon.cls}</Tag>
                    {!selWeapon.verified && <span style={{ font: F.mono(500, 9), letterSpacing: '.16em', color: T.warn }}>FRAME PROVISIONAL</span>}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '8px 14px', alignItems: 'center', maxWidth: 440 }}>
                    {([['DAMAGE', selWeapon.dmg], ['FIRE RATE', selWeapon.rpm], ['RANGE', selWeapon.rng]] as const).map(([l, v]) => (
                      <StatRow key={l} label={l} pct={v} />
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    <NumberCell label="MAGAZINE" value={selWeapon.clip} />
                    <NumberCell label="RESERVE" value={selWeapon.reserve} />
                    <NumberCell label="RELOAD" value={selWeapon.reload_s} unit="s" />
                  </div>
                  {selWeapon.desc && <div style={{ font: F.chk(500, 12), lineHeight: 1.55, color: T.dim, maxWidth: '54ch', marginTop: 10 }}>{selWeapon.desc}</div>}
                  {trying[sp.player_id] && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, font: F.mono(500, 10), letterSpacing: '.12em', color: T.warn }}>
                      ▲ TRYING OUT ON {sp.display}'S GUN — HAVE THEM FIRE A FEW ROUNDS · POINT AWAY FROM OTHERS
                      <GhostButton size={10} pad="4px 10px" onClick={() => run(() => api.endTryout(sp.player_id))}>END TRY-OUT</GhostButton>
                    </div>
                  )}
                  {state.lobby.pushed && <div style={{ font: F.mono(500, 9), letterSpacing: '.12em', color: T.micro }}>TRY-OUTS DISABLED — A CONFIG HEAD HAS BEEN PUSHED (MODES §4)</div>}
                </div>
              </Brackets>
            )}
            {/* arsenal */}
            <div>
              <SectionRule label={`ARSENAL // ${weapons.length} WEAPONS`} hint="SELECT TO ARM" />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(152px,1fr))', gap: 8 }}>
                {weapons.map(w => {
                  const on = w.weapon_id === selWeapon?.weapon_id;
                  return (
                    <div key={w.weapon_id} className="hov-acc" role="button" tabIndex={0} aria-pressed={on} aria-label={`${w.name}, ${w.cls}, magazine ${w.clip}`} onClick={() => pickWeapon(w)} onKeyDown={onKey(() => pickWeapon(w))}
                      style={{ background: on ? 'rgba(57,180,255,.08)' : T.panel, border: `1px solid ${on ? T.acc : T.line}`, padding: 8, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 7, minHeight: 44 }}>
                      <StripedSlot height={64} style={{ background: `url(assets/weapons/${w.weapon_id}.jpg) center/contain no-repeat, repeating-linear-gradient(45deg,${T.slot} 0 6px,${T.panel} 6px 12px)` }}
                        corner={<span style={{ position: 'absolute', top: 3, right: 5, font: F.mono(600, 8), letterSpacing: '.14em', color: CLS_COLOR[w.cls] ?? T.acc }}>{w.cls}</span>} />
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
                        <span style={{ font: F.chk(700, 12), letterSpacing: '.05em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.name}</span>
                        <span style={{ font: F.osw(600, 11), ...TAB, color: T.micro }} title={`magazine ${w.clip}`}>MAG {w.clip}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

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
