// ITEMS — the utility phones (stations) on the net, and the operator's arming of them (A13.5 / F104).
//
// spec/utility.md §5b: at muster the operator sets each utility phone's kind / team / station id /
// threshold; MC pushes `station_config`; the phone shows MC-ARMED · game N and locks its drawer. This
// panel is that row. Everything shown comes from the server's `StationView` (`GET /api/stations`, on
// every snapshot as `stations`): what was ASSIGNED, what the phone was last ARMED with, what the phone
// itself REPORTS, and the attention flags the server derives from the three disagreeing. Until
// 2026-09-11 none of this existed, so no station was ever armed in the field.
import { useState } from 'react';
import type { StationKind, StationView } from '../api/types';
import { STATION_KINDS } from '../api/types';
import { useStore } from '../store';
import { CHAMFER, F, T, fmtAge, teamColor } from '../tokens';
import { GhostButton, Micro, SectionRule, Seg, SwitchConfirm, Tag, ValueBox } from '../ui';

const KIND_LABEL: Record<StationKind, string> = { respawn: 'RESPAWN', powerup: 'POWERUP', extraction: 'EXTRACTION', bomb: 'BOMB SITE', control: 'CONTROL POINT' };
/** the picker's labels: short enough for five in a card row */
const KIND_SHORT: Record<StationKind, string> = { respawn: 'RESPAWN', powerup: 'POWERUP', extraction: 'EXTRACT', bomb: 'BOMB', control: 'CONTROL' };
const TID_NAME: Record<number, string> = { 0: 'RED', 1: 'BLUE', 2: 'YELLOW', 3: 'GREEN', 255: 'ANY' };

export function Items() {
  const { state } = useStore();
  const stations = state?.stations ?? [];
  if (!state || !stations.length) return null;
  const nArmed = stations.filter(s => s.assigned && s.armed && !s.attention.length).length;
  return (
    <div style={{ marginTop: 20 }} data-testid="items-panel">
      <SectionRule label={`ITEMS // ${stations.length} UTILITY PHONE${stations.length === 1 ? '' : 'S'}`}
        hint={<>{nArmed}/{stations.length} ARMED · GAME {state.game_no ?? '—'} · ASSIGN, THEN PLACE — A STATION NEEDS NO WI-FI ONCE ARMED</>} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 12 }}>
        {/* keyed on the node and the assignment ONLY. The phone's `report` (kind/team/id/threshold/…) is
            deliberately NOT in the key: it starts empty and fills in on the first heartbeat (~2s after
            hello) or changes on a phone reboot, and either would remount the card mid-edit, throwing away
            the operator's draft and `busy` (F104 follow-up). So an unassigned card mounted at hello keeps
            the default draft even after the report fills in: PHONE SAYS shows the phone's own state on the
            same card, and the operator has to assign anyway. */}
        {stations.map(s => <StationCard key={`${s.node_id}|${s.assigned?.at ?? ''}`} s={s} />)}
      </div>
    </div>
  );
}

function StationCard({ s }: { s: StationView }) {
  const { state, run, api } = useStore();
  const teams = state?.teams ?? [];
  const a = s.assigned;
  // The draft is the operator's edit in progress; it starts from the assignment (or what the phone reports).
  const [kind, setKind] = useState<StationKind>(a?.kind ?? s.report.kind ?? 'respawn');
  const [team, setTeam] = useState<number>(a?.team ?? s.report.team ?? 255);
  const [id, setId] = useState<number>(a?.id ?? s.report.station_id ?? 1);
  const [threshold, setThreshold] = useState<number>(a?.threshold ?? s.report.threshold ?? -74);
  const [busy, setBusy] = useState(false);
  const [released, setReleased] = useState<boolean | null>(null);   // A41: last RELEASE result, this card only
  // HIGH (review, 2026-09-13): RELEASE used to fire on a single tap, styled identically to CLEAR right
  // beside it -- but the two are not remotely equivalent. CLEAR only drops the assignment (the phone
  // keeps advertising; recoverable from this console). RELEASE navigates the phone AWAY from the page
  // that holds its own socket, in ANY phase including LIVE -- after which nothing on this console can
  // reach it again; the only way back is walking to the tagger and doing the seven-tap gesture. A
  // mis-tap here costs a walk across the field mid-match, so it gets the same tap-again confirm
  // `Games.tsx` uses before it moves the roster (`SwitchConfirm`), not just matching CLEAR's look.
  const [confirmRelease, setConfirmRelease] = useState(false);
  const control = kind === 'control';
  // 2026-09-19: `s.online` is now the server's own STALE_AFTER_MS judgement (state.py `_station_view`),
  // not the old 10-minute "has this record left the field" line -- so a phone that reopened elsewhere
  // under a new node_id reads OFFLINE within seconds, not minutes, instead of sitting there as an
  // assignable, seemingly-live "UTILITY PHONE" ghost. An ALREADY-ASSIGNED station that has simply
  // walked out of Wi-Fi range (utility.md §5c: "a station needs no Wi-Fi once armed") keeps its
  // ARM PENDING / MC-ARMED wording -- that is a real, expected field state, not the ghost this fix is
  // about -- and the LINK row below still says OUT OF WI-FI either way.
  const status = !a ? (s.online ? 'NOT ASSIGNED' : 'OFFLINE') : s.arm_pending ? 'ARM PENDING' : s.armed ? `MC-ARMED · GAME ${s.armed.game}` : 'ASSIGNED';
  const color = !a ? T.micro : s.attention.length || s.arm_pending ? T.warn : T.ok;
  // F104 follow-up: a phone that disagrees with what MC thinks it armed (never heard ARM, advertises a
  // different id, or is still on an older game's config) needs the SAME fix as a pending arm — push the
  // arming again. An UNCHANGED assignment goes through POST /api/stations/arm, not a PUT: a PUT is refused
  // while the match is armed/live (it would re-push config to every HUD), whereas arming touches only the
  // stations and is allowed in any phase — and a station that reboots mid-match is exactly this case.
  const needsRearm = s.arm_pending || s.attention.some(t => t.startsWith('PHONE ') || t.startsWith('ARMED FOR'));
  const dirty = !a || a.kind !== kind || a.team !== (control ? 255 : team) || a.id !== id || a.threshold !== threshold;
  const apply = async () => {
    setBusy(true);
    try {
      if (dirty) await run(() => api.putStation(s.node_id, { kind, team: control ? 255 : team, id, threshold }));
      else await run(() => api.armStations());
    } finally { setBusy(false); }
  };
  const rep = s.report;
  const age = s.last_seen_ms;
  const teamOptions = [...teams.map(t => ({ value: String(t.tid), label: t.name.toUpperCase().replace(/ TEAM$/, '') })), { value: '255', label: 'ANY' }];
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderLeft: `3px solid ${color}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 11, clipPath: CHAMFER.tr12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ font: F.osw(700, 18), letterSpacing: '.08em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {a ? `${KIND_SHORT[a.kind]} ${a.id}` : 'UTILITY PHONE'}
        </span>
        <Tag color={color} ink={a ? T.accInk : T.ink}>{status}</Tag>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '82px 1fr', gap: '6px 10px', alignItems: 'center' }}>
        <Micro>PHONE</Micro><Val color={T.dim}>{s.node_id.slice(0, 12)}</Val>
        <Micro>LINK</Micro><Val color={!s.online ? T.warn : T.dim}>{age == null ? 'NEVER' : `${fmtAge(age)} AGO`}{!s.online && ' — OUT OF WI-FI'}</Val>
        {/* what the PHONE says it is, so an assignment that never landed shows as the two disagreeing */}
        <Micro>PHONE SAYS</Micro>
        <Val color={rep.armed ? T.dim : T.warn}>
          {rep.kind ? `${KIND_LABEL[rep.kind] ?? rep.kind} ${rep.station_id ?? '?'} · ${TID_NAME[rep.team ?? 255] ?? rep.team}` : '—'}
          {rep.armed === false && ' · NOT ARMED'}{rep.live ? ' · ADVERTISING' : ''}
        </Val>
        {rep.revives != null && kind === 'respawn' && (<><Micro>REVIVES</Micro><Val color={T.dim}>{rep.revives}</Val></>)}
        {rep.control && (<>
          <Micro>POINT</Micro>
          <Val color={T.dim}>
            {rep.control.owner == null || rep.control.owner === 255 ? 'NEUTRAL' : (TID_NAME[rep.control.owner] ?? rep.control.owner)}
            {rep.control.progress != null && ` · ${rep.control.progress}%`}{rep.control.contested && ' · CONTESTED'}
          </Val>
          {rep.control.hold_ms && Object.keys(rep.control.hold_ms).length > 0 && (<>
            <Micro>HELD</Micro>
            <Val color={T.dim}>{Object.entries(rep.control.hold_ms).map(([tid, ms]) => `${TID_NAME[Number(tid)] ?? tid} ${Math.round(ms / 1000)}s`).join(' · ')}</Val>
          </>)}
        </>)}
        {rep.battery != null && (<><Micro>BATTERY</Micro><Val color={rep.battery < 30 ? T.bad : T.dim}>{rep.battery}%</Val></>)}
      </div>
      {s.attention.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} data-testid="station-attention">
          {s.attention.map(t => (
            <div key={t} style={{ display: 'flex', gap: 8, padding: '7px 10px', background: 'rgba(255,176,32,.08)', borderLeft: `2px solid ${T.warn}` }}>
              <span style={{ font: F.chk(700, 11), color: T.warn }}>▲</span>
              <span style={{ font: F.chk(700, 11.5), letterSpacing: '.06em', color: T.warn }}>{t}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: `1px solid ${T.line2}`, paddingTop: 10 }}>
        <div style={{ font: F.chk(700, 11), letterSpacing: '.2em', color: T.acc }}>▸ WHAT IS THIS PHONE?</div>
        <Seg label={`kind for ${s.node_id}`} value={kind} size={11} pad="5px 8px" wrap
          options={STATION_KINDS.map(k => ({ value: k, label: KIND_SHORT[k] }))} titles={Object.fromEntries(STATION_KINDS.map(k => [k, KIND_LABEL[k]]))}
          onChange={k => { setKind(k); if (k === 'control') setTeam(255); }} />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* a control point starts NEUTRAL and is taken by presence (§5d): the team control is moot for it */}
          {!control && <Seg label={`team for ${s.node_id}`} value={String(team)} size={11} pad="5px 8px" wrap options={teamOptions} onChange={v => setTeam(Number(v))} />}
          {control && <span style={{ font: F.chk(600, 11), letterSpacing: '.06em', color: T.micro }}>STARTS NEUTRAL — TAKEN BY PRESENCE</span>}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Micro>ID</Micro><ValueBox value={id} min={1} max={65535} label={`station id for ${s.node_id}`} onChange={setId} /></span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Micro>BUBBLE</Micro><ValueBox value={threshold} unit="dBm" min={-100} max={-30} label={`threshold for ${s.node_id}`} onChange={setThreshold} /></span>
        </div>
        {/* the confirm sits ABOVE the row it guards, same placement `Games.tsx` uses for `SwitchConfirm`
            under a card it's about to switch away from -- read there before it's acted on, not buried
            beside the button that triggers it. */}
        {confirmRelease && (
          <SwitchConfirm dropsDraft={false}
            split={`RELEASE SENDS THIS PHONE BACK TO ITS OWN HUD RIGHT NOW, EVEN LIVE — ONCE IT LEAVES, NOTHING ON THIS CONSOLE CAN REACH IT AGAIN. THE ONLY WAY BACK IS WALKING TO IT AND DOING THE SEVEN-TAP GESTURE.`}
            action="TAP RELEASE ▸ HUD AGAIN TO SEND IT" />
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* 2026-09-19: an offline phone (stale link, server-judged) cannot be assigned or armed --
              the push would just fail against a dead socket, which used to be the operator's first
              sign anything was wrong. */}
          <button type="button" className={dirty ? 'hov-accbg' : ''} disabled={busy || !s.online || (!dirty && !needsRearm)} onClick={apply}
            title={!s.online ? 'this phone has not been heard from recently -- it cannot be assigned or armed until it reconnects' : undefined}
            style={{ font: F.osw(700, 15), letterSpacing: '.18em', padding: '8px 18px', whiteSpace: 'nowrap',
              background: dirty || needsRearm ? T.acc : T.panelAlt, color: dirty || needsRearm ? T.accInk : T.dim,
              border: `1px solid ${dirty || needsRearm ? T.acc : T.line}`, clipPath: CHAMFER.tl14, cursor: busy ? 'wait' : dirty || needsRearm ? 'pointer' : 'default', minHeight: 40 }}>
            {a ? (dirty ? 'ARM WITH CHANGES' : needsRearm ? 'RE-ARM' : 'ARMED') : 'ASSIGN + ARM'}
          </button>
          {a && <GhostButton onClick={async () => { await run(() => api.deleteStation(s.node_id)); }} title="drop the assignment; the phone keeps advertising whatever it was last armed with">CLEAR</GhostButton>}
          {/* A41: the cure for a phone stuck in utility mode -- a player's own exit is the same seven-tap
              gesture that opens this card's settings, undiscoverable on the phone and with no feedback on
              a single tap. This works in ANY phase, armed/live included, and on ANY utility phone here,
              assigned or not (the stuck case usually is not). An accepted send clears its assignment and
              allow-list entry; the card remains only until the reloaded HUD proves the old utility identity.
              Unlike CLEAR (recoverable here — the phone just keeps advertising) this is NOT: it moves the
              phone off the page holding its socket, so the console loses it the moment it lands. That
              blast-radius mismatch is why it needs its own tap-again confirm rather than CLEAR's look —
              review finding 2026-09-13. First tap only arms the confirm; it sends nothing. */}
          <GhostButton
            onClick={async () => {
              if (!confirmRelease) { setConfirmRelease(true); return; }
              setConfirmRelease(false);
              setReleased(null);
              const r = await run(() => api.releaseStation(s.node_id));
              setReleased(r ? r.ok : false);
            }}
            disabled={!s.online}
            color={confirmRelease ? T.warn : undefined} border={confirmRelease ? T.warn : undefined}
            title={!s.online ? 'no live socket to this phone right now, so there is nothing to push to it'
              : confirmRelease ? 'tap again to confirm — this sends the phone away from this page and nothing here can reach it again until someone walks to it'
              : 'send this phone back to its own HUD — the fix for a phone stuck in utility mode, with no seven-tap gesture needed on the phone itself'}>
            RELEASE ▸ HUD
          </GhostButton>
          {confirmRelease && <GhostButton size={11} onClick={() => setConfirmRelease(false)} title="back out — nothing was sent">CANCEL</GhostButton>}
          {released != null && <Tag color={released ? T.ok : T.warn} ink={T.ink}>{released ? 'SENT' : 'NO SOCKET'}</Tag>}
          {a && <span style={{ font: F.mono(500, 11), letterSpacing: '.1em', color: teamColor(TID_NAME[a.team]?.toLowerCase() ?? 'any') }}>{TID_NAME[a.team] ?? a.team}</span>}
        </div>
      </div>
    </div>
  );
}

function Val({ children, color }: { children: React.ReactNode; color: string }) {
  return <span style={{ font: F.chk(600, 12), letterSpacing: '.08em', color }}>{children}</span>;
}
