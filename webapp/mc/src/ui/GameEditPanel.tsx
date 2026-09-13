import { useEffect, useState } from 'react';
import type { GameConfig, LoadoutPolicy, SlotRule, WeaponView } from '../api/types';
import { useStore } from '../store';
import { F, T, roleOf } from '../tokens';
import { DEFAULT_POLICY, computePool, kindRows } from '../screens/gameSummary';
import { Blink, GhostButton, Seg, Toggle, ValueBox } from './index';

type Slot = 'primary' | 'secondary';
const toggleId = (xs: string[], x: string) => (xs.includes(x) ? xs.filter(y => y !== x) : [...xs, x]);

/** B3 (field 2026-09-12): editing the LOADED game meant leaving KIT/LOBBY for the GAMES stepper or the
 *  full DESIGNER, and an edit made while the lobby was already pushed used to un-push it SILENTLY
 *  (`state.py set_config` cleared `lobby_pushed`/`acks` and pushed nothing back) -- the root cause
 *  chased down as B1's "guns keep stale config with nothing on screen saying so". Tony: "the flow for
 *  editing the current loaded game is very bad. i need to be able to edit the current loaded game on
 *  the fly." This is that edit, inline, on the screen the operator is already looking at, for exactly
 *  the four knobs he asked for: MODE, NIGHT, DEFAULT HEALTH, WHICH WEAPONS ARE AVAILABLE. Team editing
 *  is NOT here -- that is the lobby roster drag, a different lane's ground.
 *
 *  `set_config` (2026-09-12, coordinated with the server-side B3 fix) now keeps `lobby_pushed` true
 *  across an edit and RE-PUSHES the fresh config to every already-bound node, clearing and
 *  re-collecting acks instead of going silently stale. The status line below reads the exact same
 *  `state.lobby.acks` the LOBBY screen's own "config pushed" step reads -- one source, so the two can
 *  never disagree about whether the guns are caught up.
 *
 *  Only meant to be mounted on KIT and LOBBY, and only ACTIONABLE while `state.phase` is one of those
 *  two -- the server refuses a config edit once the match has started (armed/live) and refuses it
 *  differently again once it is over (recap). But the console's own nav lets the host free-browse to
 *  KIT/LOBBY at ANY phase (`CommandBar`'s tabs are not phase-gated), so this panel does not trust it is
 *  only ever mounted at the right time -- it gates itself on `state.phase`, disables every control with
 *  a real HTML `disabled` (never a tap that quietly does nothing), and still carries a fallback: if a
 *  request lands in the race between the phase advancing and this panel's next render, the server's
 *  refusal is rewritten with the one instruction that unblocks it (RECALL) and surfaces in the normal
 *  error strip -- never swallowed. */
export function GameEditPanel({ style }: { style?: React.CSSProperties }) {
  const { state, modes, weapons, perks, run, api, openDesigner } = useStore();
  const [open, setOpen] = useState(false);
  // Says "RE-PUSHING" for a few seconds after a successful edit -- comfortably past a real gun's
  // ~1.5s echo (state.py `ack_config`) -- so cause and effect stay legible right when the count starts
  // moving. It has to expire: a gun that never acks (a standing fault, same one LOBBY's own step 2
  // lives with) would otherwise leave this claiming an active push forever, which is worse than no
  // claim at all. Expires on its own, like the KIT confirms it borrows the pattern from
  // (Kit.tsx `confirm`/`hostPick`).
  const [recentEdit, setRecentEdit] = useState(false);
  useEffect(() => { if (!recentEdit) return; const h = setTimeout(() => setRecentEdit(false), 4_000); return () => clearTimeout(h); }, [recentEdit]);
  if (!state) return null;
  const cfg = state.config;
  // Defensive like KIT's own `pol` read: a session restored from before A10 (or an older MC) can carry
  // a config with no policy at all -- `ConfigView` promises one, a persisted snapshot does not.
  const pol: LoadoutPolicy = cfg.loadout_policy?.primary ? cfg.loadout_policy : DEFAULT_POLICY();
  const locked = state.phase !== 'kit' && state.phase !== 'lobby';
  const pushed = state.lobby.pushed;
  const acked = Object.values(state.lobby.acks).filter(a => a.ok).length;
  const total = state.players.length;
  const allAcked = pushed && total > 0 && acked === total;

  const putGame = (patch: Partial<GameConfig>) => run(async () => {
    try {
      const r = await api.putConfig(patch);
      setRecentEdit(true);
      return r;
    } catch (e) {
      const err = e as Error;
      // The one server refusal this panel can actually provoke (state.py `set_config`, phase guard).
      // The raw sentence is true but gives no next step; RECALL is the next step.
      if (/cannot change config after the match/i.test(err.message)) throw new Error(`${err.message.toUpperCase()} — RECALL FIRST, THEN EDIT AGAIN.`);
      throw e;
    }
  });
  const putPolicy = (p: Partial<LoadoutPolicy>) => putGame({ loadout_policy: { ...pol, ...p } });
  const putSlot = (slot: Slot, r: Partial<SlotRule>) => putPolicy({ [slot]: { ...pol[slot], ...r } });

  // Computed client-side from the DRAFT policy, same rule engine as the DESIGNER (gameSummary.ts
  // mirrors mcp/brx_mcp/mc/policy.py `pool()`) -- every tap shows instantly and needs no round trip.
  const pool = computePool(pol, weapons, perks);
  const poolOf = (slot: Slot) => (slot === 'primary' ? pool.primary : pool.secondary_weapons);

  return (
    <div data-testid="game-edit-panel" style={{ border: `1px solid ${T.line}`, background: T.panelSoft, ...style }}>
      <button type="button" data-testid="game-edit-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 14px',
                 background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', minHeight: 44, color: T.ink }}>
        <span style={{ font: F.chk(700, 12), letterSpacing: '.2em', color: T.acc }}>{open ? '▾' : '▸'} EDIT LOADED GAME</span>
        {/* G (round-2, 2026-09-12): 11px, not 10.5 — this chip and the LOCKED badge below are the two
            things a host reads at arm's length on the collapsed row. */}
        <span style={{ font: F.mono(500, 11), letterSpacing: '.12em', color: T.micro }}>
          {(modes.find(m => m.mode === cfg.mode)?.abbr ?? cfg.mode.toUpperCase())} · {cfg.night ? 'NIGHT' : 'DAY'} · HP {cfg.health.max_hp}/{cfg.health.max_armor}
        </span>
        <span style={{ flex: 1 }} />
        {locked && <span role="status" style={{ font: F.chk(700, 11), letterSpacing: '.14em', color: T.warn }}>LOCKED — {state.phase.toUpperCase()}</span>}
      </button>
      {open && (
        <div style={{ borderTop: `1px solid ${T.line}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {locked && (
            <div role="alert" data-testid="game-edit-locked" style={{ font: F.chk(700, 12), letterSpacing: '.08em', lineHeight: 1.5,
                                                                       color: T.warn, background: 'rgba(255,176,32,.08)', border: `1px solid ${T.warn}`, padding: '9px 12px' }}>
              ▲ THE MATCH IS {state.phase.toUpperCase()} — MC REFUSES CONFIG EDITS ONCE IT HAS STARTED. RECALL FIRST, THEN EDIT.
            </div>
          )}
          {/* A real `disabled`, not a tap that quietly does nothing (ui-build-verify): every control
              below is inert together the moment the phase locks, and says why above. */}
          <fieldset disabled={locked} style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Row label="MODE">
              {modes.length > 0 ? (
                <>
                  <Seg label="mode" value={cfg.mode} wrap options={modes.map(m => ({ value: m.mode, label: m.abbr }))}
                    titles={Object.fromEntries(modes.map(m => [m.mode, m.name]))}
                    onChange={v => putGame({ mode: v })} />
                  <div style={{ font: F.chk(500, 11.5), color: T.micro, marginTop: 6 }}>Switching mode replaces time limit, respawn, health and weapon rules with that mode's defaults. Venue (day/night) stays.</div>
                </>
              ) : (
                <span style={{ font: F.chk(600, 12), color: T.micro }}>{cfg.mode.toUpperCase()} — mode list unavailable (server predates this UI?)</span>
              )}
            </Row>
            <Row label="NIGHT OPS">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                <Toggle on={cfg.night} onChange={v => putGame({ night: v })} label="night ops" />
                <span style={{ font: F.chk(600, 12), color: cfg.night ? T.ink : T.dim }}>{cfg.night ? 'NIGHT' : 'DAY'}</span>
              </span>
            </Row>
            <Row label="DEFAULT HEALTH">
              <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <ValueBox value={cfg.health.max_hp} unit="HP" min={1} max={999} label="default health" onChange={v => putGame({ health: { ...cfg.health, max_hp: v } })} />
                <ValueBox value={cfg.health.max_armor} unit="AR" min={0} max={999} label="default armor" onChange={v => putGame({ health: { ...cfg.health, max_armor: v } })} />
                <span style={{ font: F.mono(500, 10), letterSpacing: '.1em', color: T.micro }}>a player's own POOL override (on KIT) still wins over this</span>
              </span>
            </Row>
            <Row label="WEAPONS AVAILABLE">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
                <PoolEditor label="PRIMARY" rule={pol.primary} allowed={poolOf('primary')} weapons={weapons}
                  onToggleId={id => putSlot('primary', { exclude_ids: toggleId(pol.primary.exclude_ids, id) })} />
                <PoolEditor label="SECONDARY" rule={pol.secondary} allowed={poolOf('secondary')} weapons={weapons}
                  onToggleId={id => putSlot('secondary', { exclude_ids: toggleId(pol.secondary.exclude_ids, id) })} />
              </div>
            </Row>
          </fieldset>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', borderTop: `1px solid ${T.line}`, paddingTop: 12 }}>
            <RepushStatus pushed={pushed} acked={acked} total={total} recent={recentEdit} allAcked={allAcked} />
            {/* Round-2 fix pass F (2026-09-12): this sat OUTSIDE the fieldset above, so the ONE control
                on this panel that navigates somewhere was the one the lock did not reach — tappable
                while the match was live, and dead-ending on the DESIGNER's own lock banner with
                nothing to do there. Gated on the same `locked`, disabled rather than hidden so the
                operator can still see what lives behind it. */}
            <GhostButton size={10.5} pad="8px 12px" disabled={locked}
              title={locked ? `THE MATCH IS ${state.phase.toUpperCase()} — RECALL FIRST, THEN EDIT.` : undefined}
              onClick={() => { if (!locked) openDesigner({ fromLive: true }); }}>WHO PICKS / FIXED / SIDEARMS-ONLY RULES — OPEN GAME DESIGNER ▸</GhostButton>
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

function RepushStatus({ pushed, acked, total, recent, allAcked }: { pushed: boolean; acked: number; total: number; recent: boolean; allAcked: boolean }) {
  if (!pushed) return <span style={{ font: F.mono(500, 10.5), letterSpacing: '.12em', color: T.micro }}>NOT PUSHED YET — nothing on the guns to update</span>;
  // "RE-PUSHING" is a CLAIM that something is actively in flight -- true for the ~1.5s a real gun
  // takes to echo (`recent` -- the 4s window after THIS panel's own edit), but a standing fault (one
  // gun that will never ack, same as LOBBY's own step 2) is a different fact and must not be worded as
  // an in-progress push forever. Once `recent` has expired, an incomplete count reads as what it now
  // is: how many guns are actually caught up.
  const repushing = !allAcked && recent;
  return (
    <span role="status" data-testid="game-edit-repush" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, font: F.chk(700, 11.5), letterSpacing: '.1em', color: allAcked ? T.ok : T.warn }}>
      {repushing && <Blink color={T.warn} size={7} />}
      {allAcked ? `ALL GUNS ON THIS CONFIG (${acked}/${total})`
        : repushing ? `CONFIG CHANGED — RE-PUSHING TO EVERY GUN… ${acked}/${total} CONFIRMED`
        : `${acked}/${total} GUNS CONFIRMED ON THIS CONFIG`}
    </span>
  );
}
