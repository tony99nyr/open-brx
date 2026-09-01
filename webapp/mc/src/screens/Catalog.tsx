import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { F, T, TAB, roleOf } from '../tokens';
import { BTN_RESET, GhostButton, ScreenHeader, SectionRule, SegBar, Tag } from '../ui';

// Field 2026-08-31, Tony: "on the kit page is there a way to review the weapons myself without
// setting the kit? like an armory page?" — there was not. KIT is the only place weapon stats were
// visible, and reading them there means having a player selected and writing their loadout. This
// screen is READ ONLY: it never touches a player, a gun or the config.
// Named ARSENAL: the command bar already calls the tagger/hardware muster "ARMORY", and the KIT
// screen already has a WEAPONS|PERKS tab pair (which a second "WEAPONS" button made ambiguous).

type SortKey = 'name' | 'role' | 'dmg_per_hit' | 'htk' | 'ttk_ms' | 'clip' | 'reserve' | 'reload_s';
const NUMERIC: SortKey[] = ['dmg_per_hit', 'htk', 'ttk_ms', 'clip', 'reserve', 'reload_s'];

// `pool` comes from the server and follows the host's health config — hits-to-kill is only true of
// the game that is actually set up (W2; docs/weapon-design.md §2.5). Never hardcode 115 here again.
const cols = (pool: number | null): { key: SortKey; label: string; hint?: string }[] => [
  { key: 'name', label: 'WEAPON' },
  { key: 'role', label: 'ROLE' },
  { key: 'dmg_per_hit', label: 'DMG / HIT', hint: pool ? `Damage one hit removes from this game's ${pool} pool` : 'Damage one hit removes from a full-health player' },
  { key: 'htk', label: 'HITS TO KILL', hint: pool ? `Hits to drop a full-health player at this game's ${pool} pool` : undefined },
  { key: 'ttk_ms', label: 'TIME TO KILL', hint: 'Seconds of sustained hits to drop a full-health player' },
  { key: 'clip', label: 'MAG' },
  { key: 'reserve', label: 'RESERVE' },
  { key: 'reload_s', label: 'RELOAD' },
];

export function Catalog() {
  const { weapons, setView } = useStore();
  const [sort, setSort] = useState<SortKey>('ttk_ms');
  const [desc, setDesc] = useState(false);
  const [role, setRole] = useState<string>('');
  const [sel, setSel] = useState<string | null>(null);

  const roles = useMemo(
    () => Array.from(new Set(weapons.map(w => w.role).filter(Boolean))).sort(),
    [weapons],
  );

  const rows = useMemo(() => {
    const list = role ? weapons.filter(w => w.role === role) : [...weapons];
    return list.sort((a, b) => {
      const dir = desc ? -1 : 1;
      if (NUMERIC.includes(sort)) {
        // a weapon with no value for this stat sorts last in BOTH directions, never as a phantom zero
        const av = a[sort] as number | undefined, bv = b[sort] as number | undefined;
        if (av == null && bv == null) return a.name.localeCompare(b.name);
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av - bv) * dir || a.name.localeCompare(b.name);
      }
      return String(a[sort] ?? '').localeCompare(String(b[sort] ?? '')) * dir;
    });
  }, [weapons, role, sort, desc]);

  const click = (k: SortKey) => { if (k === sort) setDesc(d => !d); else { setSort(k); setDesc(false); } };
  const focus = sel ? weapons.find(w => w.weapon_id === sel) ?? null : null;
  const pool = weapons.find(w => w.pool != null)?.pool ?? null;
  const COLS = cols(pool);

  if (!weapons.length) {
    return <div className="screen"><ScreenHeader kicker="[ ARSENAL // REFERENCE ]" title="Arsenal"
      right={<GhostButton onClick={() => setView('kit')}>◂ BACK TO KIT</GhostButton>} />
      <div style={{ font: F.mono(500, 10), letterSpacing: '.14em', color: T.micro }}>NO CATALOG — MISSION CONTROL HAS NOT SENT ONE.</div></div>;
  }

  return (
    <div className="screen">
      <ScreenHeader kicker="[ ARSENAL // REFERENCE · READ ONLY ]" title="Arsenal"
        right={<GhostButton onClick={() => setView('kit')}>◂ BACK TO KIT</GhostButton>} />
      <div style={{ font: F.mono(500, 10), letterSpacing: '.12em', color: T.micro, marginBottom: 12 }}>
        {weapons.length} WEAPONS · NOTHING HERE CHANGES A LOADOUT — BROWSE FREELY.
        {' '}METERS RANK EACH WEAPON AGAINST THE WHOLE ARSENAL; THE NUMBERS BESIDE THEM ARE REAL.
        {pool != null && <> {' · '}HITS AND TIME TO KILL ARE AT THIS GAME'S {pool} POOL (HP + ARMOUR).</>}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ font: F.mono(500, 9), letterSpacing: '.22em', color: T.micro }}>ROLE ▸</span>
        <button type="button" onClick={() => setRole('')} style={chip(!role)}>ALL</button>
        {roles.map(r => <button key={r} type="button" onClick={() => setRole(r)} style={chip(role === r)}>{roleOf(r).label || r.toUpperCase()}</button>)}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 820 }}>
          <thead>
            <tr>
              {COLS.map(c => (
                // sorting was mouse-only: no tabIndex, no key handler, no aria-sort. The e2e
                // harness having to add `th` to its clickable selector was the tell (review 2026-09-01).
                <th key={c.key} title={c.hint} onClick={() => click(c.key)}
                  role="columnheader" tabIndex={0}
                  aria-sort={sort === c.key ? (desc ? 'descending' : 'ascending') : 'none'}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); click(c.key); } }}
                  style={{ ...BTN_RESET, textAlign: NUMERIC.includes(c.key) ? 'right' : 'left', cursor: 'pointer',
                           font: F.mono(600, 9.5), letterSpacing: '.18em', color: sort === c.key ? T.acc : T.micro,
                           padding: '8px 10px', borderBottom: `1px solid ${T.line2}`, whiteSpace: 'nowrap' }}>
                  {c.label}{sort === c.key ? (desc ? ' ▾' : ' ▴') : ''}
                </th>
              ))}
              <th style={{ textAlign: 'left', font: F.mono(600, 9.5), letterSpacing: '.18em', color: T.micro, padding: '8px 10px', borderBottom: `1px solid ${T.line2}`, minWidth: 190 }}>POWER / RATE</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(w => {
              const r = roleOf(w.role, w.cls);
              const on = sel === w.weapon_id;
              return (
                <tr key={w.weapon_id} onClick={() => setSel(on ? null : w.weapon_id)}
                  style={{ cursor: 'pointer', background: on ? T.panelAlt : 'transparent', borderBottom: `1px solid ${T.line}` }}>
                  <td style={{ padding: '9px 10px', font: F.osw(700, 14), letterSpacing: '.06em', whiteSpace: 'nowrap' }}>
                    {w.name.toUpperCase()}
                    {!w.verified && <span title="Retuned from the captured Callsign frame for balance — not the stock numbers" style={{ font: F.mono(500, 8.5), letterSpacing: '.14em', color: T.micro, marginLeft: 8 }}>TUNED</span>}
                    {w.caution && <span role="alert" title={w.caution} style={{ font: F.mono(600, 9), color: T.bad, marginLeft: 8 }}>▲</span>}
                  </td>
                  <td style={{ padding: '9px 10px' }}><Tag color={r.color} size={9} style={{ letterSpacing: '.18em', padding: '2px 8px' }}>{r.label || '—'}</Tag></td>
                  {num(w.dmg_per_hit)}
                  {num(w.htk)}
                  {num(w.ttk_ms == null ? null : +(w.ttk_ms / 1000).toFixed(2), 's')}
                  {num(w.clip)}
                  {num(w.reserve)}
                  {num(w.reload_s, 's')}
                  <td style={{ padding: '9px 10px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <SegBar pct={w.bars?.power ?? w.dmg ?? 0} color={T.ink} height={7} cell={8} style={{ display: 'block' }} />
                      <SegBar pct={w.bars?.rof ?? w.rpm ?? 0} color={T.dim} height={7} cell={8} style={{ display: 'block' }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {focus && (
        <div style={{ marginTop: 18 }}>
          <SectionRule label={`${focus.name.toUpperCase()} // DETAIL`} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 26, padding: '14px 2px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '7px 14px', alignItems: 'center', minWidth: 320, flex: '1 1 340px' }}>
              {([['POWER', focus.bars?.power], ['FIRE RATE', focus.bars?.rof],
                 ['AMMO CARRIED', focus.bars?.ammo], ['KILL SPEED', focus.bars?.ttk]] as const)
                .filter(([, v]) => v != null)
                .map(([l, v]) => (
                  <div key={l} style={{ display: 'contents' }}>
                    <span style={{ font: F.mono(500, 9.5), letterSpacing: '.2em', color: T.micro }}>{l}</span>
                    <SegBar pct={v as number} color={T.ink} height={10} cell={10} style={{ display: 'block' }} />
                  </div>
                ))}
            </div>
            {focus.desc && <div style={{ font: F.chk(500, 12), lineHeight: 1.6, color: T.dim, flex: '1 1 340px', maxWidth: '58ch' }}>{focus.desc}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function num(v: number | null | undefined, unit = '') {
  return (
    <td style={{ padding: '9px 10px', textAlign: 'right', font: F.osw(600, 14), ...TAB, color: v == null ? T.micro : T.ink, whiteSpace: 'nowrap' }}>
      {v == null ? '—' : `${v}${unit}`}
    </td>
  );
}

function chip(on: boolean): React.CSSProperties {
  return { ...BTN_RESET, font: F.mono(600, 10), letterSpacing: '.12em', padding: '5px 10px', minHeight: 28, cursor: 'pointer',
           background: on ? T.acc : 'transparent', color: on ? T.accInk : T.dim, border: `1px solid ${on ? T.acc : T.line2}` };
}
