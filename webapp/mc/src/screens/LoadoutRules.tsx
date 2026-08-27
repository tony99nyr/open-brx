// BUILD · LOADOUT RULES — who may pick what, per slot (docs/spec/loadout.md §3 / §5).
// The server owns the rule engine (`State.loadout_pool`); this panel only edits `config.loadout_policy`
// and renders the pool it gets back. Any rule edit flips the preset to CUSTOM server-side.
import { useState } from 'react';
import type { LoadoutPolicy, LoadoutPreset, SlotChoice, SlotRule } from '../api/types';
import { useStore } from '../store';
import { F, PERK_COLOR, ROLE, T } from '../tokens';
import { BTN_RESET, Chamfer, PanelHeader, Seg, Toggle } from '../ui';

const PRESET_OPTS: { value: LoadoutPreset; label: string; hint: string }[] = [
  { value: 'open', label: 'OPEN', hint: 'Everything, players pick both slots' },
  { value: 'no_heavies', label: 'NO HEAVIES', hint: 'Rockets, rail, cannon and launchers off in both slots' },
  { value: 'snipers', label: 'SNIPERS', hint: 'Everyone gets the sniper rifle, no secondary, no picking' },
  { value: 'custom', label: 'CUSTOM', hint: 'Your own rules below' },
];
const TAGS: { tag: string; label: string; color: string }[] = [
  { tag: 'heavy', label: 'HEAVY', color: ROLE.power.color }, { tag: 'sniper', label: 'SNIPER', color: ROLE.marksman.color },
  { tag: 'assault', label: 'ASSAULT', color: ROLE.assault.color }, { tag: 'cqb', label: 'CLOSE RANGE', color: ROLE.cqb.color }, { tag: 'support', label: 'SUPPORT', color: ROLE.support.color },
];

export function LoadoutRules() {
  const { state, weapons, perks, run, api } = useStore();
  const [perWeapon, setPerWeapon] = useState(false);
  if (!state) return null;
  const pol = state.config.loadout_policy;
  const pool = state.loadout_pool;
  if (!pol || !pool) return null;
  // Server `policy.merge` (A10 §3): a preset NAME rewrites the rules; a partial rule edit merges and the server
  // re-derives the preset name (custom if nothing matches). So: send ONLY the keys that changed, never the whole object.
  const put = (lp: Partial<LoadoutPolicy>) => run(() => api.putConfig({ loadout_policy: lp as LoadoutPolicy }));
  const putPreset = (preset: LoadoutPreset) => run(() => api.putConfig({ loadout_policy: { preset } as LoadoutPolicy }));
  const putSlot = (slot: 'primary' | 'secondary', r: Partial<SlotRule>) => put({ [slot]: { ...pol[slot], ...r } });
  const nW = weapons.length;
  const sec = pol.secondary;
  const secCount = `${pool.secondary_weapons.length} OF ${nW} WEAPONS · ${pool.secondary_perks.length} PERK${pool.secondary_perks.length === 1 ? '' : 'S'}`;

  return (
    <Chamfer style={{ flex: '1 1 330px', maxWidth: 460 }}>
      <PanelHeader label="LOADOUT RULES" tick={PERK_COLOR} right={<span style={{ font: F.mono(500, 9), letterSpacing: '.16em', color: T.micro }}>WHO PICKS WHAT</span>} />
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* preset */}
        <div role="radiogroup" aria-label="loadout preset" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 4 }}>
          {PRESET_OPTS.map(o => {
            const on = pol.preset === o.value;
            return (
              <button key={o.value} type="button" role="radio" aria-checked={on} title={o.hint} className={on ? undefined : 'hov-acc'}
                onClick={() => { if (o.value !== 'custom' && !on) putPreset(o.value); }}
                style={{ ...BTN_RESET, font: F.chk(700, 11), letterSpacing: '.12em', padding: '10px 4px', textAlign: 'center', minHeight: 44,
                  background: on ? (o.value === 'custom' ? PERK_COLOR : T.acc) : 'transparent', color: on ? T.accInk : T.dim,
                  border: `1px solid ${on ? 'transparent' : T.line}`, cursor: on || o.value === 'custom' ? 'default' : 'pointer' }}>
                {o.label}
              </button>
            );
          })}
        </div>
        <div style={{ font: F.chk(500, 12), color: T.dim, marginTop: -6, minHeight: 16 }}>{PRESET_OPTS.find(o => o.value === pol.preset)?.hint}</div>

        <Row label={<>PLAYERS PICK ON PHONE <span style={{ font: F.mono(500, 10), color: T.micro }}>// SELF-SERVE KIT</span></>}>
          <Toggle on={pol.hud_select} onChange={v => put({ hud_select: v })} label="players pick on phone" />
        </Row>
        <div style={{ height: 1, background: T.line }} />

        {/* primary */}
        <SlotBlock label="PRIMARY" summary={pol.primary.choice === 'fixed' ? `EVERYONE GETS ${nameOf(pol.primary.fixed_id, weapons)}` : `${pool.primary.length} OF ${nW} WEAPONS`}>
          <Seg value={pol.primary.choice} options={[{ value: 'player', label: 'PLAYER' }, { value: 'host', label: 'HOST' }, { value: 'fixed', label: 'FIXED' }]}
            onChange={(v: SlotChoice) => putSlot('primary', { choice: v, fixed_id: v === 'fixed' ? (pol.primary.fixed_id ?? pool.primary[0] ?? 'assault_rifle') : pol.primary.fixed_id })} pad="5px 11px" />
          {pol.primary.choice === 'fixed' ? (
            <select aria-label="fixed primary weapon" value={pol.primary.fixed_id ?? ''} onChange={e => putSlot('primary', { fixed_id: e.target.value })} style={SELECT}>
              {weapons.map(w => <option key={w.weapon_id} value={w.weapon_id}>{w.name}</option>)}
            </select>
          ) : <TagChips rule={pol.primary} onToggle={tag => putSlot('primary', { exclude_tags: toggle(pol.primary.exclude_tags, tag) })} />}
        </SlotBlock>

        {/* secondary */}
        <SlotBlock label="SECONDARY" summary={sec.choice === 'off' ? 'OFF — ALT-FIRE DOES NOTHING' : sec.choice === 'fixed' ? `EVERYONE GETS ${nameOf(sec.fixed_id, weapons, perks)}` : secCount}>
          <Seg value={sec.choice} options={[{ value: 'player', label: 'PLAYER' }, { value: 'host', label: 'HOST' }, { value: 'fixed', label: 'FIXED' }, { value: 'off', label: 'OFF' }]}
            onChange={(v: SlotChoice) => putSlot('secondary', { choice: v, fixed_id: v === 'fixed' ? (sec.fixed_id ?? pool.secondary_weapons[0] ?? pool.secondary_perks[0] ?? 'shotgun') : sec.fixed_id })} pad="5px 11px" />
          {sec.choice === 'fixed' ? (
            <select aria-label="fixed secondary" value={sec.fixed_id ?? ''} onChange={e => putSlot('secondary', { fixed_id: e.target.value })} style={SELECT}>
              <optgroup label="Weapons">{weapons.map(w => <option key={w.weapon_id} value={w.weapon_id}>{w.name}</option>)}</optgroup>
              <optgroup label="Perks">{perks.map(k => <option key={k.perk_id} value={k.perk_id}>{k.name}</option>)}</optgroup>
            </select>
          ) : sec.choice !== 'off' && (
            <>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <KindChip on={sec.kinds.includes('weapon')} label="WEAPONS" color={T.acc} onClick={() => putSlot('secondary', { kinds: toggleKind(sec.kinds, 'weapon') })} />
                <KindChip on={sec.kinds.includes('perk')} label="PERKS" color={PERK_COLOR} onClick={() => putSlot('secondary', { kinds: toggleKind(sec.kinds, 'perk') })} />
              </div>
              {sec.kinds.includes('weapon') && <TagChips rule={sec} onToggle={tag => putSlot('secondary', { exclude_tags: toggle(sec.exclude_tags, tag) })} />}
            </>
          )}
        </SlotBlock>

        {/* per-weapon */}
        <button type="button" className="hov-acc-ink" aria-expanded={perWeapon} onClick={() => setPerWeapon(v => !v)}
          style={{ ...BTN_RESET, display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', color: T.micro, minHeight: 44 }}>
          <span style={{ font: F.mono(600, 10), letterSpacing: '.22em' }}>PER-WEAPON OVERRIDES{(pol.primary.exclude_ids.length + sec.exclude_ids.length) ? ` · ${pol.primary.exclude_ids.length + sec.exclude_ids.length} OFF` : ''}</span>
          <span>{perWeapon ? '▾' : '▸'}</span>
        </button>
        {perWeapon && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ font: F.chk(500, 12), color: T.dim }}>Tap a weapon to switch it off in <b style={{ color: T.ink }}>both</b> slots. Greyed = already excluded by a tag rule.</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {weapons.map(w => {
                const offById = pol.primary.exclude_ids.includes(w.weapon_id);
                const offByTag = !offById && !pool.primary.includes(w.weapon_id) && pol.primary.choice !== 'fixed';
                return (
                  <button key={w.weapon_id} type="button" aria-pressed={offById} disabled={offByTag} title={offByTag ? 'excluded by a tag rule' : offById ? 'switched off — tap to allow' : 'allowed — tap to switch off'}
                    onClick={() => put({ primary: { ...pol.primary, exclude_ids: toggle(pol.primary.exclude_ids, w.weapon_id) }, secondary: { ...sec, exclude_ids: toggle(sec.exclude_ids, w.weapon_id) } })}
                    style={{ ...BTN_RESET, font: F.chk(600, 11), letterSpacing: '.06em', padding: '6px 9px', minHeight: 32, cursor: offByTag ? 'not-allowed' : 'pointer',
                      border: `1px solid ${offById ? T.bad : T.line}`, color: offByTag ? T.faint : offById ? T.bad : T.body, textDecoration: offById ? 'line-through' : 'none', opacity: offByTag ? .6 : 1 }}>
                    {w.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Chamfer>
  );
}

const SELECT: React.CSSProperties = { background: T.inset, color: T.ink, border: `1px solid ${T.line2}`, font: F.mono(600, 11), letterSpacing: '.06em', padding: '6px 8px', minHeight: 36, cursor: 'pointer', maxWidth: 220 };
const toggle = (xs: string[], x: string) => (xs.includes(x) ? xs.filter(y => y !== x) : [...xs, x]);
const toggleKind = (xs: ('weapon' | 'perk')[], x: 'weapon' | 'perk') => { const n = toggle(xs, x) as ('weapon' | 'perk')[]; return n.length ? n : xs; };   // never empty
const nameOf = (id: string | null | undefined, weapons: { weapon_id: string; name: string }[], perks: { perk_id: string; name: string }[] = []) =>
  (weapons.find(w => w.weapon_id === id)?.name ?? perks.find(k => k.perk_id === id)?.name ?? '—').toUpperCase();

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 }}>
      <span style={{ font: F.chk(600, 13), letterSpacing: '.1em' }}>{label}</span>
      {children}
    </div>
  );
}

function SlotBlock({ label, summary, children }: { label: string; summary: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', background: T.panelDeep, border: `1px solid ${T.line}`, borderLeft: `2px solid ${T.line2}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ font: F.chk(700, 13), letterSpacing: '.16em' }}>{label}</span>
        <span style={{ font: F.mono(500, 10), letterSpacing: '.12em', color: T.acc }}>{summary}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>{children}</div>
    </div>
  );
}

function TagChips({ rule, onToggle }: { rule: SlotRule; onToggle: (tag: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ font: F.mono(500, 9), letterSpacing: '.18em', color: T.micro, marginRight: 4 }}>ALLOW</span>
      {TAGS.map(t => {
        const on = !rule.exclude_tags.includes(t.tag);
        return (
          <button key={t.tag} type="button" className="hit44" aria-pressed={on} onClick={() => onToggle(t.tag)} title={on ? `${t.label} allowed — tap to switch off` : `${t.label} off — tap to allow`}
            style={{ ...BTN_RESET, font: F.chk(700, 10), letterSpacing: '.14em', padding: '5px 9px', minHeight: 30, cursor: 'pointer',
              border: `1px solid ${on ? t.color : T.line}`, color: on ? T.accInk : T.micro, background: on ? t.color : 'transparent' }}>
            {on ? '✓ ' : ''}{t.label}
          </button>
        );
      })}
    </div>
  );
}

function KindChip({ on, label, color, onClick }: { on: boolean; label: string; color: string; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className="hit44"
      style={{ ...BTN_RESET, font: F.chk(700, 10), letterSpacing: '.16em', padding: '6px 10px', minHeight: 30, cursor: 'pointer',
        background: on ? color : 'transparent', color: on ? T.accInk : T.faint, border: `1px solid ${on ? color : T.line}` }}>
      {on ? '✓ ' : ''}{label}
    </button>
  );
}
