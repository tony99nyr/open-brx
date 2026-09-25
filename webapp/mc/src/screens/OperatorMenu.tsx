import { useEffect, useRef, useState } from 'react';
import { setNotice } from '../notice';
import type { LiveRow, OperatorCmd } from '../api/types';
import { useStore } from '../store';
import { F, T, fmtAge } from '../tokens';
import { colourOf, glyphed } from '../alerts';

/** A47 (bench 2026-09-17): the operator's cures for ONE player in a bad state, e.g. a gun that cannot fire.
 *  Each goes to that player's phone only (`POST /api/players/{pid}/operator`), and the phone does the work.
 *  A second tap on the same action confirms it: there is no modal. An armed CONFIRM clears after
 *  `ARM_TIMEOUT_MS`, and when the row's status changes under it. The phone's answer (`row.operator`) is
 *  shown here: "sent, waiting for the phone" until it arrives, or "no answer" once MC stops waiting. */
export const ARM_TIMEOUT_MS = 4000;
const ACTIONS: { cmd: OperatorCmd; label: string; what: string; sent: string }[] = [
  { cmd: 'resync', label: 'RESYNC GUN', what: 'Sends team, ammo, trigger and hit table again. Health does not change.', sent: 'RESYNC' },
  { cmd: 'respawn', label: 'FORCE RESPAWN', what: 'Full health and ammo now, with spawn protection. No death or kill is booked.', sent: 'RESPAWN' },
  { cmd: 'relink', label: 'RELINK GUN', what: 'The phone drops the gun and connects again. Takes a few seconds.', sent: 'RELINK' },
];

const WORD: Record<OperatorCmd, string> = { resync: 'RESYNC', respawn: 'RESPAWN', relink: 'RELINK' };

/** The last action's outcome, in the operator's words. `null` = nothing sent this match. */
export function operatorOutcome(r: LiveRow): { text: string; color: 'dim' | 'ok' | 'warn' } | null {
  const o = r.operator;
  if (!o) return null;
  const word = WORD[o.cmd];
  if (o.state === 'sent') return { text: `${word} SENT, WAITING FOR THE PHONE.`, color: 'dim' };
  // pl4: MC stops waiting after 15 s (an older app, a dropped socket). A late answer still replaces this.
  if (o.state === 'no_answer') return { text: 'NO ANSWER FROM THE PHONE.', color: 'dim' };
  // pl4: a relink's `ok` means the phone started it, not that the gun is back
  if (o.state === 'done') return { text: o.cmd === 'respawn' ? 'THE PHONE RESPAWNED THE PLAYER.' : o.cmd === 'relink' ? 'RELINK STARTED ON THE PHONE.' : `${word} DONE ON THE PHONE.`, color: 'ok' };
  return { text: `THE PHONE REFUSED ${word}: ${o.why ?? 'NO REASON GIVEN'}.`, color: 'warn' };
}

export const operatorMenuId = (player_id: string) => `op-menu-${player_id}`;

export function OperatorMenu({ r, matchId, onClose }: { r: LiveRow; matchId: string; onClose: () => void }) {
  const { state, api, run } = useStore();
  const [armed, setArmed] = useState<OperatorCmd | null>(null);
  const [busy, setBusy] = useState(false);
  const who = r.display.toUpperCase();
  const live = state?.phase === 'live';
  const inPlay = state?.phase === 'armed' || live;
  const outOfReach = r.status === 'stale';
  // an armed CONFIRM must never sit there to be pressed by accident minutes later, or after the player changed
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(null), ARM_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [armed]);
  useEffect(() => { setArmed(null); }, [r.status]);
  // M7 (visual QA 2026-09-24): at 1440×900 a row near the bottom opened its menu below the fold, so the
  // host tapped and saw nothing change. The menu brings itself into view once, when it opens.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }, []);
  const noRespawn = state?.config.respawn?.type === 'none';
  const outcome = operatorOutcome(r);

  const send = async (cmd: OperatorCmd, sent: string) => {
    setBusy(true);
    const res = await run(() => api.operatorAction(r.player_id, cmd, matchId));
    setBusy(false); setArmed(null);
    if (res) setNotice(`${sent} SENT TO ${who}'S PHONE`);
  };
  // resync/respawn need LIVE (the phone refuses them before T-0); relink also runs in ARMED
  const offered = ACTIONS.filter(a => live || a.cmd === 'relink');

  return (
    <div ref={box} id={operatorMenuId(r.player_id)} data-operator-menu={r.player_id} role="group" aria-label={`Operator actions for ${who}`}
      style={{ position: 'sticky', left: 0, maxWidth: 'min(560px, calc(100vw - 48px))', boxSizing: 'border-box',
               margin: '0 0 4px', padding: '10px 12px', background: T.panelDeep, border: `1px solid ${T.line2}`,
               borderLeft: `3px solid ${T.acc}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ flex: 1, font: F.chk(700, 12), letterSpacing: '.14em', color: T.ink }}>OPERATOR · {who}</span>
        <button type="button" data-op-close="1" onClick={onClose} className="hov-acc"
          style={{ font: F.chk(600, 11), letterSpacing: '.16em', background: 'transparent', color: T.dim,
                   border: `1px solid ${T.line}`, padding: '8px 14px', minHeight: 40, cursor: 'pointer' }}>CLOSE</button>
      </div>
      {!inPlay ? (
        <div data-op-unavailable="phase" data-alert="frame-op-not-in-play" data-sev="neutral" style={{ font: F.mono(500, 11), letterSpacing: '.08em', color: colourOf('frame-op-not-in-play'), lineHeight: 1.5 }}>
          THE MATCH IS NOT IN PLAY. NOTHING CAN BE SENT.
        </div>
      ) : outOfReach ? (
        // F221 (2026-09-25): a gun/phone link lost DURING a match is RED — the boxed row, per Tony's
        // rule for a gun card. Was a quiet T.dim line; a live-match link loss is act-now, not status.
        <div data-op-unavailable="reach" data-alert="frame-op-out-of-reach" data-sev="red" role="alert"
          style={{ font: F.mono(500, 11), letterSpacing: '.08em', color: colourOf('frame-op-out-of-reach'), lineHeight: 1.5,
            padding: '4px 8px', border: `1px solid ${colourOf('frame-op-out-of-reach')}`, background: 'rgba(255,82,82,.08)' }}>
          {glyphed('red', `${who}'S PHONE IS OUT OF REACH (LAST HEARD ${fmtAge(r.sync_age_ms)} AGO). NOTHING CAN BE SENT UNTIL IT CHECKS IN AGAIN.`)}
        </div>
      ) : <>{!live && (
        <div data-op-unavailable="armed" data-alert="frame-op-wait-t0" data-sev="neutral" style={{ font: F.mono(500, 11), letterSpacing: '.08em', color: colourOf('frame-op-wait-t0'), lineHeight: 1.5 }}>
          RESYNC AND RESPAWN WAIT FOR T-0. RELINK WORKS NOW.
        </div>
      )}{offered.map(a => {
        const downResync = a.cmd === 'resync' && r.status === 'down';
        const out = a.cmd === 'respawn' && noRespawn && r.status === 'down';
        const off = downResync || out;
        const isArmed = armed === a.cmd;
        const color = a.cmd === 'respawn' ? T.warn : T.acc;
        return (
          <div key={a.cmd} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
            <button type="button" data-op={a.cmd} data-armed={isArmed ? '1' : '0'} disabled={busy || off}
              onClick={() => { if (isArmed) void send(a.cmd, a.sent); else setArmed(a.cmd); }}
              className={busy || off ? undefined : 'hov-acc'}
              style={{ font: F.chk(700, 12), letterSpacing: '.14em', minHeight: 44, minWidth: 190, padding: '9px 14px',
                       cursor: busy || off ? 'not-allowed' : 'pointer',
                       background: isArmed ? color : 'transparent', color: off ? T.faint : isArmed ? T.page : color,
                       border: `1px solid ${off ? T.line : color}` }}>
              {isArmed ? `CONFIRM ${a.label}` : a.label}
            </button>
            <span style={{ flex: '1 1 200px', font: F.mono(500, 11), letterSpacing: '.04em', color: isArmed ? T.ink : T.dim, lineHeight: 1.4 }}>
              {out ? `${who} IS OUT. THIS MODE HAS NO RESPAWN.`
                : downResync ? `${who} IS DOWN. USE FORCE RESPAWN.` : isArmed ? `Tap again to send to ${who}'s phone.` : a.what}
            </span>
          </div>
        );
      })}</>}
      {inPlay && outcome && (
        <div data-op-outcome={r.operator?.state} data-alert={outcome.color === 'warn' ? 'frame-op-outcome-refused' : r.operator?.state === 'sent' ? 'frame-op-outcome-sent' : undefined}
          data-sev={outcome.color === 'warn' ? 'amber' : outcome.color === 'ok' ? undefined : 'neutral'}
          role="status"
          style={{ font: F.mono(500, 11), letterSpacing: '.08em', lineHeight: 1.5,
                   color: outcome.color === 'ok' ? T.ok : outcome.color === 'warn' ? colourOf('frame-op-outcome-refused') : colourOf('frame-op-outcome-sent') }}>
          {outcome.color === 'warn' ? glyphed('amber', outcome.text) : outcome.text}
        </div>
      )}
    </div>
  );
}
