// KIT's cards: the slot cards, the arsenal header, the weapon and perk heroes, the player number and the pool
// card. Split out of Kit.tsx (round-2 candidate 11).
import { useState } from 'react';
import type { PerkView, Player, WeaponView } from '../../api/types';
import { F, PERK_COLOR, T, roleOf } from '../../tokens';
import { GLYPH, colourOf } from '../../alerts';
import { BTN_RESET, GhostButton, NumberCell, Seg, SegBar, StripedSlot, SectionRule, Tag, ValueBox, onKey } from '../../ui';
import { useStore } from '../../store';
import { PRESET_LABELS } from '../../api/contract.gen';
import { Alert } from '../../ui/Alert';
import { useDraftCommit } from '../../ui/useDraftCommit';
import { poolOf, type Slot } from './helpers';
import { Lock, WeaponArt, PerkGlyph, PerkTrade } from './art';

export function SlotCard({ label, slot, active, onClick, rule, item, kind, required, onClear, overridden, onReapply, matchLocked }:
  { matchLocked?: boolean; label: string; slot: Slot; active: boolean; onClick: () => void; rule?: { choice: string } | null; item?: WeaponView | PerkView; kind: 'weapon' | 'perk' | 'none'; required?: boolean; onClear?: () => void;
    overridden?: { slot: Slot; id: string | null; label: string } | null; onReapply?: (h: { slot: Slot; id: string | null }) => void }) {
  const choice = rule?.choice ?? 'player';
  const locked = matchLocked || choice === 'fixed' || choice === 'off';
  const right = matchLocked ? 'LOCKED FOR THIS MATCH' : choice === 'fixed' ? 'FIXED BY THE GAME' : choice === 'off' ? 'OFF FOR THIS GAME' : choice === 'host' ? 'HOST PICKS' : 'PLAYER PICKS · YOU CAN OVERRIDE';
  // F221 polish r2 (Low): FIXED/OFF are configuration facts, not a fault — only a match already LOCKED
  // (`kit-slot-note-locked`) is a real constraint on the operator right now, so only that one is amber.
  const lockColor = matchLocked ? colourOf('kit-slot-note-locked') : T.micro;
  const isPerk = kind === 'perk' && item && 'perk_id' in item;
  const color = isPerk ? PERK_COLOR : T.acc;
  const empty = kind === 'none';
  // `✕ CLEAR` is absolutely positioned in the card's bottom-right corner, and the line it lands on is
  // the weapon's `ROLE · MAG 12 · RES 24` — which ran straight under it on every SECONDARY plate in
  // every Kit screenshot we have (review 2026-09-12). Absolute position takes an element out of flow,
  // so nothing was ever going to move for it: the room has to be RESERVED. The ammo line then WRAPS
  // into that narrower column rather than ellipsising, because truncating it to "SIDEARM · MAG 7 · R…"
  // trades one unreadable reserve count for a missing one.
  const clearW = onClear ? 96 : 0;
  return (
    <div role="button" tabIndex={0} aria-pressed={active} onClick={onClick} onKeyDown={onKey(onClick)} className="hov-acc"
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', minHeight: 96, cursor: 'pointer',
        background: active ? (isPerk ? 'rgba(196,139,255,.07)' : 'rgba(57,180,255,.07)') : T.panel,
        borderTop: `1px ${empty ? 'dashed' : 'solid'} ${active ? color : T.line}`, borderRight: `1px ${empty ? 'dashed' : 'solid'} ${active ? color : T.line}`, borderBottom: `1px ${empty ? 'dashed' : 'solid'} ${active ? color : T.line}`, borderLeft: `3px solid ${active ? color : T.line2}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '2px 8px', flexWrap: 'wrap' }}>
        <span style={{ font: F.chk(700, 12), letterSpacing: '.22em', color: active ? color : T.dim }}>{active ? '▸ ' : ''}{label}</span>
        <span style={{ font: F.mono(500, 11), letterSpacing: '.12em', color: locked ? lockColor : T.micro, marginLeft: 'auto', textAlign: 'right', display: 'inline-flex', alignItems: 'center', gap: 5 }}>{locked && <Lock color={lockColor} />}{right}</span>
      </div>
      {empty ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48 }}>
          <span style={{ width: 64, height: 44, flex: 'none', border: `1px dashed ${T.line2}`, display: 'grid', placeItems: 'center', font: F.osw(700, 20), color: T.faint }}>—</span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ font: F.osw(700, 18), letterSpacing: '.06em', color: T.dim }}>{choice === 'off' ? 'OFF' : slot === 'perk' ? 'NO PERK' : 'EMPTY'}</span>
            <span style={{ font: F.chk(500, 11), color: T.micro }}>{choice === 'off' ? (slot === 'perk' ? 'This game has no perks — change it in GAMES' : 'This game has no slot 2 — change it in GAMES') : matchLocked ? (slot === 'perk' ? 'Rides beside the weapons' : 'Alt-fire does nothing') : slot === 'perk' ? 'Rides beside the weapons · tap to pick' : 'Alt-fire does nothing · tap to pick'}</span>
          </span>
        </div>
      ) : item && 'weapon_id' in item ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, paddingRight: clearW }}>
          <span style={{ width: 84, height: 48, flex: 'none', background: T.inset, border: `1px solid ${T.line}` }}><WeaponArt key={item.weapon_id} id={item.weapon_id} size={20} /></span>
          <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ font: F.osw(700, 18), letterSpacing: '.06em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name.toUpperCase()}</span>
            <span data-slot-ammo="1" style={{ font: F.mono(500, 11), letterSpacing: '.1em', color: T.micro, lineHeight: 1.35 }}><span style={{ color: roleOf(item.role, item.cls).color }}>{roleOf(item.role, item.cls).label}</span> · MAG {item.clip} · RES {item.reserve}</span>
          </span>
        </div>
      ) : item && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, paddingRight: clearW }}>
          <span style={{ width: 48, height: 48, flex: 'none', display: 'grid', placeItems: 'center', background: T.inset, border: `1px solid ${PERK_COLOR}` }}><PerkGlyph id={item.perk_id} size={28} color={PERK_COLOR} /></span>
          <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ font: F.osw(700, 18), letterSpacing: '.06em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name.toUpperCase()}</span>
            <span data-slot-ammo="1" style={{ font: F.mono(500, 11), letterSpacing: '.1em', lineHeight: 1.35 }}><span style={{ color: PERK_COLOR }}>PERK</span> · <PerkTrade k={item} /></span>
          </span>
        </div>
      )}
      {onClear && (
        <button type="button" data-slot-clear={slot} onClick={e => { e.stopPropagation(); onClear(); }} aria-label={`clear ${slot}`} title={slot === 'perk' ? 'No perk' : 'Leave slot 2 empty'} className="hov-acc-ink"
          style={{ ...BTN_RESET, position: 'absolute', right: 8, bottom: 8, width: clearW - 12, textAlign: 'right', font: F.mono(600, 11), letterSpacing: '.14em', color: T.micro, padding: '8px 10px', minHeight: 36, boxSizing: 'border-box' }}>✕ CLEAR</button>
      )}
      {/* F221 polish r2: this was plain mono text colouring itself off the catalogue — RED goes through
          <Alert>, the boxed row a gun card uses (Tony's rule), like every other RED on this card. */}
      {required && !item && <Alert id="kit-primary-required" variant="row" what="a primary is required" />}
      {overridden && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', font: F.mono(600, 11), letterSpacing: '.12em', color: colourOf('kit-changed-from-phone') }}>
          {GLYPH} CHANGED FROM THEIR PHONE: YOURS WAS {overridden.label.toUpperCase()}
          <button type="button" onClick={e => { e.stopPropagation(); onReapply?.(overridden); }} className="hov-warnbg"
            style={{ ...BTN_RESET, font: F.chk(700, 11), letterSpacing: '.16em', color: T.warn, border: `1px solid ${T.warn}`, padding: '7px 12px', minHeight: 36 }}>REAPPLY MINE</button>
        </div>
      )}
    </div>
  );
}

export function ArsenalHeader({ slot, rule, pool, weapons, preset, onClear, onBuild }:
  { slot: Slot; rule?: { choice: string; kinds?: string[] } | null; pool: { primary: string[]; secondary_weapons: string[]; perks: string[] }; weapons: WeaponView[];
    preset?: string; onClear?: () => void; onBuild: () => void }) {
  const choice = rule?.choice ?? 'player';
  const nAllowed = slot === 'primary' ? pool.primary.length : pool.secondary_weapons.length;
  const presetTxt = preset && preset !== 'open' ? ` · ${PRESET_LABELS[preset as keyof typeof PRESET_LABELS] ?? preset.toUpperCase()}` : '';
  const sidearms = !!rule?.kinds && !rule.kinds.includes('weapon') && rule.kinds.includes('sidearm');   // A12: pistols only
  const summary = choice === 'fixed' ? 'FIXED BY THE GAME' : choice === 'off' ? 'OFF FOR THIS GAME'
    : slot === 'perk' ? `${pool.perks.length} PERKS${presetTxt}`                                          // A14: the perk slot
    : sidearms ? `${nAllowed} SIDEARMS${presetTxt}`
    : `${nAllowed} OF ${weapons.length} WEAPONS${presetTxt}`;
  // F221 polish r2 (Low): a navigation link, not a fault -- the ordinary accent colour, not amber.
  const hint = choice === 'fixed' || choice === 'off'
    ? <button type="button" className="hov-acc-ink" onClick={onBuild} style={{ ...BTN_RESET, font: F.mono(600, 11), letterSpacing: '.18em', color: T.acc, minHeight: 36 }}>CHANGE IN GAMES ▸</button>
    : <span>{slot === 'primary' ? 'SELECT TO ARM · TRY-OUT STARTS ON PICK' : slot === 'secondary' ? 'SELECT · WEAPONS TRY OUT ON PICK' : 'SELECT · APPLIED WHEN THE GAME IS PUSHED'}</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
      <SectionRule label={`ARSENAL // ${slot.toUpperCase()} · ${summary}`} hint={hint} style={{ marginBottom: 0 }} />
      {slot !== 'primary' && choice !== 'off' && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          {onClear && <GhostButton size={11} pad="6px 12px" onClick={onClear} title={slot === 'perk' ? 'No perk this game' : 'Leave slot 2 empty — alt-fire does nothing'}>{slot === 'perk' ? 'NONE · NO PERK' : 'NONE · LEAVE EMPTY'}</GhostButton>}
        </div>
      )}
    </div>
  );
}

export function WeaponHero({ w, slot, sp, tryingId, pushed, verdicts, setVerdicts }:
  { w: WeaponView; slot: Slot; sp: Player; tryingId?: string; pushed: boolean; verdicts: Record<string, { verdict: 'pass' | 'issue'; note: string }>; setVerdicts: React.Dispatch<React.SetStateAction<Record<string, { verdict: 'pass' | 'issue'; note: string }>>> }) {
  const { run, api } = useStore();
  const role = roleOf(w.role, w.cls);
  return (
    <>
      <StripedSlot style={{ flex: '1 1 240px', maxWidth: 320, minHeight: 140 }}
        corner={<span style={{ position: 'absolute', top: 8, left: 10, zIndex: 1, font: F.mono(600, 11), letterSpacing: '.22em', color: T.dim, background: 'rgba(7,9,13,.75)', padding: '2px 6px' }}>{slot.toUpperCase()}</span>}>
        <WeaponArt key={w.weapon_id} id={w.weapon_id} size={56} testId="weapon-hero-art" />
      </StripedSlot>
      <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ font: F.osw(700, 28), letterSpacing: '.08em', textTransform: 'uppercase' }}>{w.name}</span>
          <Tag color={role.color} style={{ letterSpacing: '.22em', padding: '3px 10px' }}>{role.label}</Tag>
          {!w.verified && <span title="Retuned from the captured Callsign frame for balance — not the stock numbers" style={{ font: F.mono(500, 11), letterSpacing: '.16em', color: T.micro }}>TUNED · NOT STOCK</span>}
          {/* F221: briefing information (a known hardware quirk), not a live fault — amber, not red. */}
          {w.caution && <span role="alert" style={{ font: F.mono(600, 11), letterSpacing: '.14em', color: colourOf('kit-weapon-caution-hero') }}>{GLYPH} {w.caution.toUpperCase()}</span>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '7px 14px', alignItems: 'center', maxWidth: 440 }}>
          {/* Field 2026-08-30: these read `dmg`/`rpm` straight, but `dmg` is "% of a 115 pool per hit"
              (7-11 for most guns) so every DAMAGE bar sat near empty and no two weapons looked
              different. MC now ranks each stat across the ARSENAL and ships it as `bars`. */}
          {([['POWER', w.bars?.power ?? w.dmg], ['FIRE RATE', w.bars?.rof ?? w.rpm],
             ['AMMO CARRIED', w.bars?.ammo], ['KILL SPEED', w.bars?.ttk]] as const)
            .filter(([, v]) => v != null)
            .map(([l, v]) => <StatRow key={l} label={l} pct={v as number} />)}
        </div>
        <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {w.dmg_per_hit != null && <NumberCell label={w.dual_emitter ? 'DAMAGE / PULL*' : 'DAMAGE / HIT'} value={w.dmg_per_hit} size={20} pad="6px 14px" />}
          <NumberCell label="MAGAZINE" value={w.clip} size={20} pad="6px 14px" />
          <NumberCell label="RESERVE" value={w.reserve} size={20} pad="6px 14px" />
          {/* null means "no reload time", not zero — a bare unit with no number reads as a broken
              cell. CATALOG already showed `—`; this one did not (merge review 2026-09-01). */}
          <NumberCell label="RELOAD" value={w.reload_s ?? '—'} unit={w.reload_s == null ? undefined : 's'} size={20} pad="6px 14px" />
          {/* both follow the host's health config now, not a hardcoded 115 (W2) — say which pool */}
          {/* F221 polish (2026-09-25): a low hits-to-kill figure is data worth noticing, not an alert —
              T.acc, the console's own "look here" data colour, replaces the alert amber. */}
          {w.htk != null && <NumberCell label={w.dual_emitter ? `PULLS TO KILL · ${w.pool ?? ''}*` : (w.pool ? `HITS TO KILL · ${w.pool}` : 'HITS TO KILL')} value={w.htk} size={20} pad="6px 14px" color={w.htk <= 2 ? T.acc : T.ink} />}
          {w.ttk_ms != null && <NumberCell label="TIME TO KILL" value={+(w.ttk_ms / 1000).toFixed(2)} unit="s" size={20} pad="6px 14px" />}
        </div>
        {w.desc && <div style={{ font: F.chk(500, 12), lineHeight: 1.5, color: T.dim, maxWidth: '54ch' }}>{w.desc}</div>}
        {w.dual_emitter && <div style={{ font: F.mono(500, 11), letterSpacing: '.1em', color: T.micro, maxWidth: '54ch' }}>* ONE TRIGGER MAY EMIT SEPARATE GUN AND HEADSET WORDS; THE TOTAL ASSUMES BOTH LAND.</div>}
        {tryingId && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', font: F.mono(500, 11), letterSpacing: '.12em', color: colourOf('kit-tryout-banner') }}>
            {GLYPH} TRYING OUT ON {sp.display}'S GUN: HAVE THEM FIRE A FEW ROUNDS · POINT AWAY FROM OTHERS
            <GhostButton size={11} pad="4px 10px" onClick={() => run(() => api.endTryout(sp.player_id))}>END TRY-OUT</GhostButton>
            <span style={{ display: 'inline-flex', gap: 6 }}>
              <GhostButton size={11} pad="4px 10px" onClick={async () => { const rec = await run(() => api.rangeVerdict(tryingId, 'pass')); if (rec) setVerdicts(v => ({ ...v, [tryingId]: { verdict: rec.verdict, note: rec.note } })); }}>SOUNDS RIGHT ✓</GhostButton>
              <GhostButton size={11} pad="4px 10px" onClick={async () => { const note = window.prompt('what is wrong? (sound / rate / damage / no burst…)'); if (note === null) return; const rec = await run(() => api.rangeVerdict(tryingId, 'issue', note)); if (rec) setVerdicts(v => ({ ...v, [tryingId]: { verdict: rec.verdict, note: rec.note } })); }}>LOG ISSUE ✗</GhostButton>
            </span>
          </div>
        )}
        {pushed && <div style={{ font: F.mono(500, 11), letterSpacing: '.12em', color: colourOf('kit-tryouts-closed') }}>TRY-OUTS CLOSED: THE GAME HAS BEEN PUSHED TO THE GUNS</div>}
        {/* F221: a bench note to fix before play, not a live blocker — amber, not red. */}
        {verdicts[w.weapon_id]?.verdict === 'issue' && <div style={{ font: F.mono(500, 11), letterSpacing: '.12em', color: colourOf('kit-range-log-issue') }}>RANGE LOG: {verdicts[w.weapon_id].note.toUpperCase()}</div>}
      </div>
    </>
  );
}

export function PerkHero({ k }: { k: PerkView }) {
  const fx = k.effects ?? {};
  const gain = k.gain ?? [], cost = k.cost ?? [];
  return (
    <>
      <div style={{ flex: '0 0 auto', width: 150, minHeight: 140, display: 'grid', placeItems: 'center', background: T.inset, border: `1px solid ${PERK_COLOR}` }}>
        <PerkGlyph id={k.perk_id} size={86} color={PERK_COLOR} />
      </div>
      <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ font: F.osw(700, 28), letterSpacing: '.08em', textTransform: 'uppercase' }}>{k.name}</span>
          <Tag color={PERK_COLOR} style={{ letterSpacing: '.22em', padding: '3px 10px' }}>PERK</Tag>
          {/* 'kit-perk-unproven' is NEUTRAL (F221 polish, 2026-09-25): the absence of a hardware proof
              is a status, not a fix-before-match amber. */}
          {!k.verified && <span title="Effect not yet proven on hardware" style={{ font: F.mono(500, 11), letterSpacing: '.16em', color: colourOf('kit-perk-unproven') }}>UNPROVEN ON HARDWARE</span>}
        </div>
        {/* S50 (2026-09-19): GAIN and COST, read straight off the server's `PerkView.gain`/`.cost` —
            this used to rebuild the same numbers from `effects` and got the sign wrong on every
            multiplier over 1 (body_armor's `reload_mult: 1.25`, a cost, printed as a gain). Two rows,
            two colours: gain in the perk colour, cost in an ordinary data tone (F221 polish, 2026-09-25:
            T.body, not the alert amber — a perk's cost is not a fault to fix), never red and never a
            team colour, so a host reads which is which without parsing the words. */}
        <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {gain.map((g, i) => <Tag key={`g${i}`} color={PERK_COLOR} size={12} style={{ letterSpacing: '.1em', padding: '6px 12px' }}>{g}</Tag>)}
        </div>
        {cost.length > 0 && (
          <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            {cost.map((c, i) => <Tag key={`c${i}`} color={T.body} ink={T.ink} size={12} style={{ letterSpacing: '.1em', padding: '6px 12px' }}>{c}</Tag>)}
          </div>
        )}
        <div style={{ font: F.chk(500, 13), lineHeight: 1.5, color: T.body, maxWidth: '54ch' }}>{k.desc}</div>
        <div style={{ font: F.mono(500, 11), letterSpacing: '.12em', color: T.micro }}>PASSIVE — APPLIED TO THE GUN WHEN THE GAME IS PUSHED · NOTHING TO TRY OUT{fx.alt_reload ? ' · TAKES THE ALT BUTTON: NO SECOND WEAPON WITH THIS ONE' : ' · RIDES BESIDE BOTH WEAPONS'}</div>
      </div>
    </>
  );
}

/** Player number 1–63, draft-then-commit (see ValueBox). */
export function PlayerNum({ value, onCommit, disabled }: { value: number; onCommit: (n: number) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  const draftCommit = useDraftCommit(value, v => setDraft(String(v)));
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === '' || String(value) === draft.trim()) { setDraft(String(value)); return; }
    if (Number.isInteger(n) && n >= 1 && n <= 63) { setInvalid(false); draftCommit.commit(n, () => onCommit(n)); }
    else { setInvalid(true); setDraft(String(value)); }   // never a silent revert: the hint below explains
  };
  const setFocused = draftCommit.setFocused;
  return (
    <>
      <input className="numbox" type="number" min={1} max={63} value={draft} disabled={disabled} aria-label="player number (1–63)" aria-invalid={invalid || undefined}
        style={{ width: '2.6em', font: F.mono(600, 11), color: invalid ? T.bad : T.acc, textAlign: 'left', minHeight: 36, borderBottom: invalid ? `1px solid ${T.bad}` : undefined }}
        onFocus={() => { setFocused(true); setInvalid(false); }} onBlur={() => { setFocused(false); commit(); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        onChange={e => setDraft(e.target.value)} />
      {invalid && <span role="alert" style={{ marginLeft: 8, font: F.mono(500, 11), letterSpacing: '.12em', color: colourOf('kit-player-num-invalid') }}>PLAYER NUMBER MUST BE 1–63</span>}
    </>
  );
}

function StatRow({ label, pct }: { label: string; pct: number }) {
  return (
    <>
      <span style={{ font: F.mono(500, 11), letterSpacing: '.2em', color: T.micro }}>{label}</span>
      <SegBar pct={pct} color={T.ink} height={10} cell={10} style={{ display: 'block' }} />
    </>
  );
}

/** The two per-player ACCESSIBILITY switches, in one card on the kit rail (`loadout.overrides`,
 *  modes §1.1): EASY RELOAD, and the POOL override.
 *
 *  Deliberately loud, both of them: a player armed or set up differently from everyone else is a rule
 *  of the match, not a setting, so the card states the game's own numbers beside the player's and
 *  says whose gun it changes. Clearing either is one tap.
 *
 *  They share a card because they answer the same question — is this player set up differently? — and
 *  nothing else: the two are INDEPENDENT, and each is written without touching the other (S50, Tony
 *  2026-09-17: a younger player takes both, a left-handed player takes Easy Reload and no extra
 *  health). Easy Reload reads in the ACCENT colour rather than the pool's amber, because it is a
 *  setting and not a caution: it gives the player nothing an able player would want. */
export function PoolCard({ hp, armor, pool, onSet, onClear, name, easy, onEasy, easyAsk, locked }: {
  hp: number; armor: number; name: string; locked?: boolean;
  pool: ReturnType<typeof poolOf>;
  onSet: (k: 'max_hp' | 'max_armor', v: number) => void; onClear: () => void;
  easy: boolean; onEasy: (on: boolean) => void; easyAsk: string | null;
}) {
  const on = pool.set;
  const mult = pool.mult.toFixed(pool.mult % 1 === 0 ? 0 : 1);
  return (
    // Fix-1: in ARMED/LIVE a disabled <fieldset> turns off every button and input inside it at once
    // (Seg's options, both ValueBoxes, MATCH THE GAME POOL), so the card still SAYS the player's
    // setup without offering a write the server refuses.
    // 'kit-pool-note-on' is NEUTRAL (F221 polish, 2026-09-25): a deliberate, host-set difference is a
    // status, not a fix-before-match amber, so the whole card border/label reads the same colour as the
    // note at the bottom of it, not a hardcoded T.warn.
    <fieldset data-pool-card disabled={locked || undefined} style={{ margin: 0, minWidth: 0, border: `1px solid ${on ? colourOf('kit-pool-note-on') : T.line}`, background: T.panelDeep, padding: '8px 10px 10px', display: 'flex', flexDirection: 'column', gap: 8, opacity: locked ? 0.7 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ font: F.chk(700, 11), letterSpacing: '.18em', color: easy ? T.acc : T.dim }}>EASY RELOAD</span>
        <Seg value={easy ? 'on' : 'off'} onChange={v => onEasy(v === 'on')} size={11} pad="4px 12px"
          label={`easy reload for ${name}`}
          titles={{ off: `${name} reloads with the lever, like everyone else`, on: `The ALT button reloads ${name}'s gun` }}
          options={[{ value: 'off', label: 'OFF' }, { value: 'on', label: 'ON' }]} />
      </div>
      {/* F221: a two-tap confirm (drops the second weapon) — UNCHANGED per Tony's rule. */}
      {easyAsk && <span role="alert" data-easy-ask style={{ font: F.chk(700, 11), letterSpacing: '.12em', color: T.warn }}>▲ {easyAsk}</span>}
      {/* F221: explanatory copy, always shown — NEUTRAL, no glyph (matches kit-easy-note-off/on). */}
      <span style={{ height: 1, background: T.line }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ font: F.chk(700, 11), letterSpacing: '.18em', color: on ? colourOf('kit-pool-note-on') : T.dim }}>POOL</span>
        <span data-pool-state style={{ font: F.mono(500, 11), letterSpacing: '.12em', color: on ? colourOf('kit-pool-note-on') : T.micro }}>
          {on ? `${mult}\u00d7 GAME POOL` : 'GAME DEFAULT'}
        </span>
      </div>
      {(['max_hp', 'max_armor'] as const).map(k => {
        const isHp = k === 'max_hp';
        const val = isHp ? pool.hp : pool.armor, base = isHp ? hp : armor, set = isHp ? pool.hpSet : pool.armorSet;
        return (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ font: F.chk(600, 11), letterSpacing: '.14em', color: T.dim, width: 52 }}>{isHp ? 'HEALTH' : 'ARMOR'}</span>
            <ValueBox value={val} unit={isHp ? 'HP' : 'AR'} min={isHp ? 1 : 0} max={999} label={`${name} ${isHp ? 'health' : 'armor'}`} onChange={v => onSet(k, v)} />
            <span data-pool-base={k} style={{ font: F.mono(500, 11), letterSpacing: '.06em', color: set ? T.micro : T.faint, whiteSpace: 'nowrap' }}>
              {set ? `GAME ${base}` : 'SAME AS GAME'}
            </span>
          </div>
        );
      })}
      {/* F221: a deliberate, host-set difference either way \u2014 NEUTRAL, no glyph (kit-pool-note-off/on). */}
      {on && !locked && <GhostButton onClick={onClear} color={colourOf('kit-pool-note-on')} border={colourOf('kit-pool-note-on')} size={11} pad="7px 12px">MATCH THE GAME POOL</GhostButton>}
    </fieldset>
  );
}
