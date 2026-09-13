// STANDBY (2026-09-12). Field ask at the first four-phone session: "i had a player walk away. i dont
// have a way to do that in MC ... pull them out into standby ... i want to be able to select who is
// going to participate in the lobby". DELETE was on the API and nothing used it — and DELETE forgets
// the callsign, team, gun and loadout the operator just typed. STANDBY keeps the record on the server
// (`State.standby`) and PLAY puts it straight back.
//
// One section, used by KIT (under the roster) and LOBBY (under the team columns): the parked players,
// each with its PLAY control. It renders NOTHING on a server that predates the field — the console
// must not invent a control for a route that is not there.
import type { Player } from '../api/types';
import { useStore } from '../store';
import { F, T, teamColor } from '../tokens';
import { BTN_RESET, SectionRule } from '.';

/** Once the match is armed/live the server refuses both directions (the kit is locked), so nothing here
 *  may LOOK tappable in those phases: the controls are not rendered and the section says why. Exported
 *  because the SAME rule used to be re-typed in ARMORY's node card and KIT's detail panel (three copies,
 *  one review 2026-09-13) — every place that decides whether to offer STAND DOWN/PLAY reads THIS. */
export const standDownLocked = (phase: string | undefined): boolean => phase === 'armed' || phase === 'live';

/** A double-tap must send ONE request: the second tap (before the snapshot re-renders the row away) used
 *  to 404 as "no such player". Keyed by player, module-wide, so a re-mounted chip (or KIT's own STAND
 *  DOWN button, which shares this instead of re-inventing it) still sees it. */
const inflight = new Set<string>();
/** Runs `action` for `key` unless one is already in flight for that key; released when it settles.
 *  Exported so every STAND DOWN / PLAY control — this chip, `PlayButton`, and KIT's detail-panel
 *  button — shares one guard rather than each growing its own copy. */
export function guardedOnce(key: string, action: () => Promise<unknown>): void {
  if (inflight.has(key)) return;
  inflight.add(key);
  action().finally(() => inflight.delete(key));
}

/** The STAND DOWN control on a roster row. One verb everywhere (review 2026-09-12): the ACTION is STAND
 *  DOWN on both screens, STANDBY is the noun for the bench. Visually apart from the tap-to-move team chips:
 *  a thin divider, muted ghost colour, dashed edge — not one more pill in that family. */
export function StandDownChip({ p, style }: { p: Player; style?: React.CSSProperties }) {
  const { api, run, state } = useStore();
  if (!state || !Array.isArray(state.standby)) return null;   // older server: no route, no control
  if (standDownLocked(state.phase)) return null;               // armed/live: refused by the server, so not offered
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, ...style }}>
      <span aria-hidden style={{ width: 1, height: 22, background: T.line2 }} />
      <button type="button" className="hit44" data-standby={p.player_id} onClick={e => { e.stopPropagation(); guardedOnce(p.player_id, () => run(() => api.standbyPlayer(p.player_id))); }}
        title={`Pull ${p.display} out of the lobby — kept on STANDBY, PLAY puts them back`}
        style={{ ...BTN_RESET, font: F.chk(600, 11), letterSpacing: '.14em', padding: '4px 8px', color: T.micro, border: `1px dashed ${T.line2}`, background: 'transparent', minHeight: 28, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
        ▸ STAND DOWN
      </button>
    </span>
  );
}

/** The parked players. Hidden when nobody is on standby, and on a server without the field. */
export function StandbySection({ style }: { style?: React.CSSProperties }) {
  const { state } = useStore();
  const parked = state?.standby;
  if (!Array.isArray(parked) || parked.length === 0) return null;
  const lock = standDownLocked(state?.phase);
  return (
    <div data-standby-section style={{ marginTop: 16, ...style }}>
      <SectionRule label={`STANDBY // ${parked.length} SITTING OUT`} hint={lock ? 'MATCH LIVE · PLAY AGAIN AFTER THE WHISTLE' : 'NOT IN THE PUSH · THEIR PHONE STILL SHOWS THE OLD KIT UNTIL PLAY'} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, border: `1px solid ${T.line}`, padding: 6, background: T.panelDeep }}>
        {parked.map(p => (
          <div key={p.player_id} data-standby-row={p.player_id}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: T.panel, border: `1px solid ${T.line}`, minHeight: 44, opacity: .82, flexWrap: 'wrap' }}>
            <span style={{ width: 4, flex: 'none', alignSelf: 'stretch', background: teamColor(p.team_id) }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', font: F.chk(700, 14), letterSpacing: '.14em', color: T.dim }}><span style={{ color: T.micro, font: F.mono(500, 10) }}>#{p.player_num} </span>{p.display}</span>
              <span style={{ display: 'block', font: F.mono(500, 11), color: T.micro }}>{p.gun_id ?? 'NO GUN'} · SITTING OUT · {lock ? 'LOCKED UNTIL THE MATCH ENDS' : 'PLAY PUTS THEM BACK'}</span>
            </span>
            {lock
              ? <span data-standby-locked style={{ font: F.chk(700, 11), letterSpacing: '.14em', color: T.micro, border: `1px solid ${T.line}`, padding: '8px 14px', minHeight: 36, display: 'inline-flex', alignItems: 'center' }}>MATCH LIVE</span>
              : <PlayButton p={p} />}
          </div>
        ))}
      </div>
    </div>
  );
}

/** ▸ PLAY: reinstate. Shared with the ARMORY node card (a parked player's gun is not a stray). */
export function PlayButton({ p }: { p: Player }) {
  const { api, run } = useStore();
  return (
    <button type="button" className="hit44 hov-acc-ink" data-reinstate={p.player_id}
      onClick={() => guardedOnce(p.player_id, () => run(() => api.reinstatePlayer(p.player_id)))}
      title={`Put ${p.display} back in the lobby`}
      style={{ ...BTN_RESET, font: F.chk(700, 11), letterSpacing: '.14em', padding: '8px 14px', color: T.ok, border: `1px solid rgba(46,204,113,.5)`, minHeight: 36, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
      ▸ PLAY
    </button>
  );
}
