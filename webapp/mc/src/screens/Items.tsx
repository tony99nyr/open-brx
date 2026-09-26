// ITEMS — the utility phones (stations) on the net, and the operator's arming of them (A13.5 / F104).
//
// spec/utility.md §5b: at muster the operator sets each utility phone's kind / team / threshold, and MC gives it a
// station id (F364); MC pushes `station_config`; the phone shows MC-ARMED · game N and locks its drawer. This
// panel is that row. Everything shown comes from the server's `StationView` (`GET /api/stations`, on
// every snapshot as `stations`): what was ASSIGNED, what the phone was last ARMED with, what the phone
// itself REPORTS, and the attention flags the server derives from the three disagreeing. Until
// 2026-09-11 none of this existed, so no station was ever armed in the field.
import { useEffect, useState } from 'react';
import type { PowerupPreset, StationItem, StationKind, StationView, TxPower } from '../api/types';
import { STATION_KINDS } from '../api/types';
import { PHONE_POWERUP_THRESHOLD_DBM, PHONE_RESPAWN_THRESHOLD_DBM, PHONE_STATION_THRESHOLD_DBM } from '../api/contract.gen';
import { useStore } from '../store';
import { CHAMFER, F, T, fmtAge, teamColor } from '../tokens';
import { ItemStationRow, Swatch } from '../ui/Powerups';
import { POWERUPS_RESTART, type PowerupsState, itemDetail, schedule, usePowerups } from '../ui/powerupData';
import { GhostButton, Micro, SectionRule, Seg, SwitchConfirm, Tag, ValueBox } from '../ui';
import { CONTROL_CONFLICT, conflictWords, setupLines } from '../ui/SetupSteps';
import { Alert, AlertTag } from '../ui/Alert';
import { GLYPH, MC_OLDER, MC_RESTART_CMD, SEV_COLOUR, batteryColour, colourOf, serverLine } from '../alerts';

const KIND_LABEL: Record<StationKind, string> = { respawn: 'RESPAWN', powerup: 'POWERUP', extraction: 'EXTRACTION', bomb: 'BOMB SITE', control: 'CONTROL POINT' };
/** the picker's labels: short enough for five in a card row */
const KIND_SHORT: Record<StationKind, string> = { respawn: 'RESPAWN', powerup: 'POWERUP', extraction: 'EXTRACT', bomb: 'BOMB', control: 'CONTROL' };
// F405 (2026-09-25): Tony -- "so mvp for utility is respawn station, pickup, hill". `extraction` and
// `bomb` keep their code, their type and their recap label (`KIND_LABEL` above) so an OLD assignment of
// either still renders -- they just drop off the kind picker a host assigns a NEW station from.
const MVP_STATION_KINDS: StationKind[] = STATION_KINDS.filter(k => k !== 'extraction' && k !== 'bomb');
const TID_NAME: Record<number, string> = { 0: 'RED', 1: 'BLUE', 2: 'YELLOW', 3: 'GREEN', 255: 'ANY' };
/** H1: what threshold 0 resolves to, as the server resolves it (state.py `_wire_threshold`, F345) and the phone
 *  applies it (app/src/beacon.js `phoneStationThreshold`): a phone respawn station -70, a phone powerup station
 *  -55 (S58), any other phone kind -74, a StickS3 its own. `start` is where an edit begins: that number, or for a Stick its respawn default
 *  (-57, the F345 note in state.py) and the phone value otherwise. */
export function bubbleDefault(kind: StationKind, stick: boolean): { label: string; start: number } {
  const phone = kind === 'respawn' ? PHONE_RESPAWN_THRESHOLD_DBM
    : kind === 'powerup' ? PHONE_POWERUP_THRESHOLD_DBM : PHONE_STATION_THRESHOLD_DBM;
  return stick ? { label: "DEFAULT (the Stick's own)", start: kind === 'respawn' ? STICK_RESPAWN_DBM : phone }
    : { label: `DEFAULT (${phone}, phone)`, start: phone };
}
const STICK_RESPAWN_DBM = -57;
/** A67 (F365): the station's advert strength, weakest first. A stronger advert is heard farther, so it moves the range too. */
const TX_POWER_LABEL: Record<TxPower, string> = { ultra_low: 'ULTRA LOW', low: 'LOW', medium: 'MEDIUM', high: 'HIGH' };
const TX_POWER_OPTIONS = (Object.keys(TX_POWER_LABEL) as TxPower[]).map(v => ({ value: v, label: TX_POWER_LABEL[v] }));

export function Items() {
  const { state } = useStore();
  const stations = state?.stations ?? [];
  const pu = usePowerups();   // A56
  if (!state || !stations.length) return null;
  // M2 (visual QA 2026-09-24): ARMED is what each card's status says (MC-ARMED), counted apart from the
  // stations with an attention line. A BATTERY LOW used to drop an armed station out of the count, so
  // "1/3 ARMED" sat above three cards that all read MC-ARMED.
  const nArmed = stations.filter(s => s.assigned && s.armed && !s.arm_pending).length;
  const nAttention = stations.filter(s => s.assigned && s.attention.length).length;
  return (
    <div style={{ marginTop: 20 }} data-testid="items-panel">
      <SectionRule label={`ITEMS // ${stations.length} STATION${stations.length === 1 ? '' : 'S'}`}
        hint={<>{nArmed}/{stations.length} ARMED{nAttention > 0 && <span data-items-attention style={{ color: colourOf('items-need-attention-count') }}> · {nAttention} NEED ATTENTION</span>} · GAME {state.game_byte ?? state.game_no ?? '—'} · ASSIGN, THEN PLACE: A STATION NEEDS NO WI-FI ONCE ARMED</>} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 12 }}>
        {/* keyed on the node and the assignment ONLY. The phone's `report` (kind/team/id/threshold/…) is
            deliberately NOT in the key: it starts empty and fills in on the first heartbeat (~2s after
            hello) or changes on a phone reboot, and either would remount the card mid-edit, throwing away
            the operator's draft and `busy` (F104 follow-up). So an unassigned card mounted at hello keeps
            the default draft even after the report fills in: PHONE SAYS shows the phone's own state on the
            same card, and the operator has to assign anyway. */}
        {stations.map(s => <StationCard key={`${s.node_id}|${s.assigned?.at ?? ''}`} s={s} pu={pu} stations={stations} />)}
      </div>
    </div>
  );
}

/** The preset an assignment's item came from. The assignment stores only the expanded item (A56), so the
 *  match is on what makes an item THAT item: its kind and weapon, never its name or colour. */
const presetOf = (item: StationItem | undefined, presets: PowerupPreset[] | null) =>
  !item || !presets ? null
    : presets.find(p => p.item.kind === item.kind && (p.item.weapon_id ?? null) === (item.weapon_id ?? null))?.preset ?? null;

/** What the station IS: a StickS3 says hello with platform `esp32` (hardware/m5sticks3), a phone with its OS. */
const deviceOf = (s: StationView) => (s.platform === 'esp32' ? 'STICKS3' : 'PHONE');

/** An MC older than F364 refuses a PUT with no id in exactly these words (a current MC adds "or absent"). */
const OLD_MC_WANTS_ID = /^id must be an integer 1\.\.65535 \(the station id in the advert\)$/;
/** The id to send such an MC: the lowest one no other station holds. */
export function lowestFreeId(stations: StationView[], node_id: string): number {
  const used = new Set(stations.flatMap(o => o.node_id !== node_id && o.assigned ? [o.assigned.id] : []));
  let n = 1; while (used.has(n)) n += 1;
  return n;
}

function StationCard({ s, pu, stations }: { s: StationView; pu: PowerupsState; stations: StationView[] }) {
  const { state, run, api, serverNow } = useStore();
  const teams = state?.teams ?? [];
  const a = s.assigned;
  // The draft is the operator's edit in progress; it starts from the assignment (or what the phone reports).
  const [kind, setKind] = useState<StationKind>(a?.kind ?? s.report.kind ?? 'respawn');
  const [team, setTeam] = useState<number>(a?.team ?? s.report.team ?? 255);
  // F364 (Tony 2026-09-25): MC assigns the station id at ASSIGN + ARM, unique across phones and Sticks and kept
  // across restarts. The card shows it read-only and the PUT sends no id.
  const [applyErr, setApplyErr] = useState<string | null>(null);   // a refused write, on THIS card (the header may be off-screen)
  useEffect(() => { setApplyErr(null); }, [s.armed?.at]);          // armed since (here or by a server re-arm): the refusal is stale
  // H1 (visual QA 2026-09-24): 0 is "the station's own default" (F345: MC sends a phone respawn station -70, a
  // StickS3 keeps its own). The draft starts there, NOT from the phone's report: its advertised bubble IS
  // that default, and copying it here turned every ASSIGN + ARM into an explicit override. A number is
  // sent only once the host opens the BUBBLE and edits it.
  // A67: null = follow the assignment, so an edit made ON THE STATION (adopted by MC) moves the draft with it
  // instead of reading as a change the operator never made.
  const [thrEdit, setThreshold] = useState<number | null>(null);
  const threshold = thrEdit ?? a?.threshold ?? 0;
  const [txEdit, setTx] = useState<TxPower | null>(null);   // A67: the STRENGTH draft; null = MC's (or none)
  const tx = txEdit ?? a?.tx_power ?? null;
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
  // F405: the picker offers only the MVP kinds -- unless the draft is ALREADY on a hidden one (an old
  // extraction/bomb assignment), in which case its own card keeps that option so it still shows
  // selected instead of reading as unset.
  const kindOptions = MVP_STATION_KINDS.includes(kind) ? MVP_STATION_KINDS : [...MVP_STATION_KINDS, kind];
  // A56: the powerup item. `itemPick` is the operator's draft; null = whatever the assignment already has.
  const [itemPick, setItemPick] = useState<string | null>(null);
  const presets = pu.s === 'ok' && pu.v.enabled ? pu.v.presets : null;
  const picking = kind === 'powerup' && !!presets;
  const assignedPreset = a?.kind === 'powerup' ? presetOf(a.item, presets) : null;
  const chosen = itemPick ?? assignedPreset;
  const needsPick = picking && !chosen;
  // items are locked for the match: MC refuses any station PUT while it is armed or live
  const locked = state?.phase === 'armed' || state?.phase === 'live';
  // A56 round 2: RESET makes the item available now, off its schedule. Only in play, only with the flag on.
  const canReset = locked && !!presets && a?.kind === 'powerup' && !!a.item;
  // 2026-09-19: `s.online` is now the server's own STALE_AFTER_MS judgement (state.py `_station_view`),
  // not the old 10-minute "has this record left the field" line -- so a phone that reopened elsewhere
  // under a new node_id reads OFFLINE within seconds, not minutes, instead of sitting there as an
  // assignable, seemingly-live "UTILITY PHONE" ghost. An ALREADY-ASSIGNED station that has simply
  // walked out of Wi-Fi range (utility.md §5c: "a station needs no Wi-Fi once armed") keeps its
  // ARM PENDING / MC-ARMED wording -- that is a real, expected field state, not the ghost this fix is
  // about -- and the LINK row below still says OUT OF WI-FI either way.
  const status = !a ? (s.online ? 'NOT ASSIGNED' : 'OFFLINE') : s.arm_pending ? 'ARM PENDING' : s.armed ? `MC-ARMED · GAME ${s.armed.game}` : 'ASSIGNED';
  // H2 (visual QA 2026-09-24): a CONTROL station under a grenade or IR-station objective is ignored by every
  // phone. The server says so in `config_warnings`; the card carries the same line and is not green.
  const setupConflict = a?.kind === 'control'
    ? setupLines(state?.config_warnings).find(w => CONTROL_CONFLICT.test(w)) ?? null : null;
  // the worst attention line, id and severity together: `color` (the card border) reads its severity,
  // the status tag below reads its id (F221 polish, 2026-09-25).
  const attentionHit = s.attention.length
    ? (['red', 'amber', 'neutral'] as const).map(v => s.attention.map(t => serverLine(t, 'amber')).find(h => h.sev === v)).find(Boolean) ?? null
    : null;
  const color = !a ? colourOf('items-status-not-assigned') : setupConflict ? colourOf('items-setup-conflict')
    : s.arm_pending ? colourOf('items-status-arm-pending') : attentionHit ? SEV_COLOUR[attentionHit.sev] : T.ok;
  // the status chip: AMBER/NEUTRAL/RED never fill (Tony's rule) — only the one positive case (no id)
  // keeps the filled <Tag>; every other case is an outline <AlertTag> coloured by this same id.
  const statusAlertId: string | null = !a ? 'items-status-not-assigned' : setupConflict ? 'items-setup-conflict'
    : s.arm_pending ? 'items-status-arm-pending' : attentionHit ? attentionHit.id : null;
  // A58: a live tamper lock, while it is still in the future -- `lock_until_ms` is MC's clock, so the
  // comparison runs through `serverNow()`, not the browser's own clock (`ItemState`'s countdown above does the same).
  const stick = deviceOf(s) === 'STICKS3';
  const releaseLabel = stick ? 'RELEASE' : 'RELEASE ▸ HUD';
  const tamperLocked = !!s.lock_until_ms && s.lock_until_ms > serverNow();
  // F104 follow-up: a phone that disagrees with what MC thinks it armed (never heard ARM, advertises a
  // different id, or is still on an older game's config) needs the SAME fix as a pending arm — push the
  // arming again. An UNCHANGED assignment goes through POST /api/stations/arm, not a PUT: a PUT is refused
  // while the match is armed/live (it would re-push config to every HUD), whereas arming touches only the
  // stations and is allowed in any phase — and a station that reboots mid-match is exactly this case.
  const needsRearm = s.arm_pending || s.attention.some(t => t.startsWith('PHONE ') || t.startsWith('ARMED FOR'));
  const dirty = !a || a.kind !== kind || a.team !== (control ? 255 : team) || a.threshold !== threshold
    || (tx != null && tx !== a.tx_power) || (picking && chosen !== assignedPreset);
  // a powerup station still waiting for its item pick is not a live button, so it must not look like one
  const lit = (dirty || needsRearm) && !(dirty && needsPick);
  const apply = async () => {
    setBusy(true); setApplyErr(null);
    const keep = <T,>(fn: () => Promise<T>) => async () => { try { return await fn(); } catch (e) { setApplyErr((e as Error).message); throw e; } };
    try {
      const body = { kind, team: control ? 255 : team, threshold, ...(tx ? { tx_power: tx } : {}), ...(picking && chosen ? { item_preset: chosen } : {}) };
      if (dirty) await run(keep(() => api.putStation(s.node_id, body).catch(e => {
        // F364 compatibility: an MC process older than this console (rebuilt, not restarted) still requires an id.
        if (!OLD_MC_WANTS_ID.test((e as Error).message)) throw e;
        return api.putStation(s.node_id, { ...body, id: a?.id ?? lowestFreeId(stations, s.node_id) });
      })));
      else await run(keep(() => api.armStations()));
    } finally { setBusy(false); }
  };
  const rep = s.report;
  const age = s.last_seen_ms;
  const teamOptions = [...teams.map(t => ({ value: String(t.tid), label: t.name.toUpperCase().replace(/ TEAM$/, '') })), { value: '255', label: 'ANY' }];
  return (
    <div data-station-card={s.node_id} style={{ background: T.panel, border: `1px solid ${T.line}`, borderLeft: `3px solid ${color}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 11, clipPath: CHAMFER.tr12 }}>
      {/* M3 (visual QA 2026-09-24): the name owns its row. With LOCKED and the status beside it, the name was
          cut to "RESP…" and the station id was lost, so the tags wrap on a row of their own. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span data-station-title={s.node_id} style={{ font: F.osw(700, 18), letterSpacing: '.08em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {a ? `${KIND_SHORT[a.kind]} ${a.id}` : stick ? 'STICKS3' : 'UTILITY PHONE'}
        </span>
        <span data-station-tags={s.node_id} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {statusAlertId ? <AlertTag id={statusAlertId}>{status}</AlertTag> : <Tag color={T.ok} ink={T.accInk}>{status}</Tag>}
          {tamperLocked && <Tag data-testid="station-locked" color={T.line2} ink={colourOf('items-tag-locked')}>LOCKED</Tag>}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '82px 1fr', gap: '6px 10px', alignItems: 'center' }}>
        <Micro>{deviceOf(s)}</Micro><Val color={T.dim}>{s.node_id.slice(0, 12)}</Val>
        <Micro>ID</Micro><span data-station-id={s.node_id} style={{ font: F.chk(600, 12), letterSpacing: '.08em', color: a ? T.ink : T.micro }}>{a ? a.id : 'SET BY MC AT ARM'}</span>
        {/* 'items-link-out-of-wifi' is NEUTRAL (F221 polish, 2026-09-25): out of range is expected once a
            station is armed; the real fault sits in the attention line below, not here. */}
        <Micro>LINK</Micro><Val color={!s.online ? colourOf('items-link-out-of-wifi') : T.dim}>{age == null ? 'NEVER' : `${fmtAge(age)} AGO`}{!s.online && ': OUT OF WI-FI'}</Val>
        {/* what the PHONE says it is, so an assignment that never landed shows as the two disagreeing.
            F221: unassigned, "not armed" is only a device-says-so status (NEUTRAL) — it is a real
            fault (AMBER) only once the station IS assigned and the phone disagrees with it. */}
        <Micro>{deviceOf(s)} SAYS</Micro>
        <Val color={rep.armed !== false ? T.dim : !a ? colourOf('items-rep-not-armed') : colourOf('items-rep-not-armed-advertising')}>
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
        {a?.item && (<><Micro>ITEM</Micro><ItemStationRow s={s} item={a.item} canReset={canReset} /></>)}
        {s.range?.threshold != null && (<><Micro>RANGE</Micro><Val color={T.dim}><span data-station-range={s.node_id}>{s.range.threshold} dBm{edited(s.range.threshold_src, s.range.threshold_edit_age_ms)}</span></Val></>)}
        {s.range?.tx_power != null && (<><Micro>STRENGTH</Micro><Val color={T.dim}><span data-station-strength={s.node_id}>{TX_POWER_LABEL[s.range.tx_power]}{edited(s.range.tx_power_src, s.range.tx_power_edit_age_ms)}</span></Val></>)}
        {rep.battery != null && (<><Micro>BATTERY</Micro><Val color={batteryColour(rep.battery, T.dim)}>{rep.battery}%</Val></>)}
      </div>
      {/* a standing fact, so a status region that is always mounted (it announces when the line arrives).
          F221: RED — Tony names the KOTH grenade-vs-control conflict by name as RED, the game is wrong. */}
      <div role="status" data-station-setup-region={s.node_id} style={{ display: 'contents' }}>
        {/* F221 polish r2: same words, same case as GAMES/LOBBY's own conflict line (`SetupConflicts`,
            `conflictWords()`) — this card used to hand-draw the glyph and keep sentence case, so the
            one fact read differently on three screens. */}
        {setupConflict && (
          <Alert id="items-setup-conflict" variant="row" testid="station-setup-conflict">{conflictWords(setupConflict)}</Alert>
        )}
      </div>
      {s.attention.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} data-testid="station-attention">
          {s.attention.map(t => (
            <Alert key={t} {...serverLine(t, 'amber')}>{t}</Alert>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: `1px solid ${T.line2}`, paddingTop: 10 }}>
        <div style={{ font: F.chk(700, 11), letterSpacing: '.2em', color: T.acc }}>▸ WHAT IS THIS {deviceOf(s)}?</div>
        <Seg label={`kind for ${s.node_id}`} value={kind} size={11} pad="5px 8px" wrap
          options={kindOptions.map(k => ({ value: k, label: KIND_SHORT[k] }))} titles={Object.fromEntries(kindOptions.map(k => [k, KIND_LABEL[k]]))}
          onChange={k => { setKind(k); if (k === 'control') setTeam(255); }} />
        {kind === 'powerup' && <ItemPicker node={s.node_id} pu={pu} chosen={chosen} locked={locked} onPick={setItemPick} />}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* a control point starts NEUTRAL and is taken by presence (§5d): the team control is moot for it */}
          {!control && <Seg label={`team for ${s.node_id}`} value={String(team)} size={11} pad="5px 8px" wrap options={teamOptions} onChange={v => setTeam(Number(v))} />}
          {control && <span style={{ font: F.chk(600, 11), letterSpacing: '.06em', color: T.micro }}>STARTS NEUTRAL: TAKEN BY PRESENCE</span>}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}><Micro>BUBBLE</Micro>
            {threshold === 0
              ? <GhostButton data-bubble-edit={s.node_id} size={11} onClick={() => setThreshold(bubbleDefault(kind, stick).start)}
                  title="The station uses its own presence bubble. Tap to set a number instead.">{bubbleDefault(kind, stick).label}</GhostButton>
              : <>
                  <ValueBox value={threshold} unit="dBm" min={-100} max={-30} label={`threshold for ${s.node_id}`} onChange={setThreshold} />
                  <GhostButton data-bubble-default={s.node_id} size={11} onClick={() => setThreshold(0)} title="Go back to the station's own bubble">DEFAULT</GhostButton>
                </>}
          </span>
        </div>
        {/* A67 (F365): STRENGTH is the station's advert power. Stronger is heard farther, so the range a player sees moves too.
            Shown only once the station REPORTS a strength: a phone that cannot set its power (an iPhone) reports its real
            value, and a control that changes nothing on it would be a lie. */}
        {rep.tx_power != null && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Micro>STRENGTH</Micro>
          <Seg label={`strength for ${s.node_id}`} value={(tx ?? '') as TxPower} size={11} pad="5px 8px" wrap options={TX_POWER_OPTIONS} onChange={setTx} />
          <span data-strength-note={s.node_id} style={{ font: F.chk(600, 11), letterSpacing: '.06em', color: T.micro }}>strength changes range too</span>
        </div>}
        {/* the confirm sits ABOVE the row it guards, same placement `Games.tsx` uses for `SwitchConfirm`
            under a card it's about to switch away from -- read there before it's acted on, not buried
            beside the button that triggers it. */}
        {confirmRelease && (
          <SwitchConfirm dropsDraft={false}
            split={stick
              // a Stick has no HUD: a release drops it to UNASSIGNED and unlocks it, and its link stays (station_link.h apply_release)
              ? 'RELEASE DROPS THIS STICKS3 TO UNASSIGNED RIGHT NOW, EVEN LIVE, AND UNLOCKS IT. IT STAYS LINKED, SO YOU CAN ASSIGN IT AGAIN HERE.'
              : 'RELEASE SENDS THIS PHONE BACK TO ITS OWN HUD RIGHT NOW, EVEN LIVE — ONCE IT LEAVES, NOTHING ON THIS CONSOLE CAN REACH IT AGAIN. THE ONLY WAY BACK IS WALKING TO IT AND DOING THE SEVEN-TAP GESTURE.'}
            action={`TAP ${releaseLabel} AGAIN TO SEND IT`} />
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* 2026-09-19: an offline phone (stale link, server-judged) cannot be assigned or armed --
              the push would just fail against a dead socket, which used to be the operator's first
              sign anything was wrong. */}
          <button type="button" className={lit ? 'hov-accbg' : ''} disabled={busy || !s.online || (!dirty && !needsRearm) || (dirty && needsPick)} onClick={apply}
            title={!s.online ? 'this phone has not been heard from recently -- it cannot be assigned or armed until it reconnects'
              : dirty && needsPick ? 'pick an item for this powerup station first' : undefined}
            style={{ font: F.osw(700, 15), letterSpacing: '.18em', padding: '8px 18px', whiteSpace: 'nowrap',
              background: lit ? T.acc : T.panelAlt, color: lit ? T.accInk : T.dim,
              border: `1px solid ${lit ? T.acc : T.line}`, clipPath: CHAMFER.tl14, cursor: busy ? 'wait' : dirty && needsPick ? 'not-allowed' : lit ? 'pointer' : 'default', minHeight: 40 }}>
            {a ? (dirty ? 'ARM WITH CHANGES' : needsRearm ? 'RE-ARM' : 'ARMED') : 'ASSIGN + ARM'}
          </button>
          {/* F221: a fix-before-match refusal on ARMORY, not an act-now event — AMBER, not red. */}
          {applyErr && <span data-testid="station-apply-error" role="alert" style={{ flexBasis: '100%', font: F.chk(700, 11), letterSpacing: '.06em', color: colourOf('items-apply-err') }}>{GLYPH} NOT ARMED: {applyErr}</span>}
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
            {releaseLabel}
          </GhostButton>
          {confirmRelease && <GhostButton size={11} onClick={() => setConfirmRelease(false)} title="back out — nothing was sent">CANCEL</GhostButton>}
          {/* F221: NO SOCKET is Tony's own example of a NEUTRAL status, not a warning. */}
          {released != null && <Tag color={released ? T.ok : colourOf('items-released-no-socket')} ink={T.ink}>{released ? 'SENT' : 'NO SOCKET'}</Tag>}
          {dirty && needsPick && <span style={{ font: F.chk(700, 11), letterSpacing: '.1em', color: colourOf('items-pick-item-warning') }}>PICK AN ITEM ABOVE</span>}
          {a && <span style={{ font: F.mono(500, 11), letterSpacing: '.1em', color: teamColor(TID_NAME[a.team]?.toLowerCase() ?? 'any') }}>{TID_NAME[a.team] ?? a.team}</span>}
        </div>
      </div>
    </div>
  );
}

/** A67: " · EDITED ON STATION 2m AGO" when the value came from the station's own long-hold edit. */
function edited(src: string | undefined, age: number | undefined): string {
  if (src !== 'station') return '';
  return age == null ? ' · EDITED ON STATION' : ` · EDITED ON STATION ${fmtAge(age)} AGO`;
}

function Val({ children, color }: { children: React.ReactNode; color: string }) {
  return <span style={{ font: F.chk(600, 12), letterSpacing: '.08em', color }}>{children}</span>;
}


/** A56: the host picks ONE item per powerup station at setup; it is locked once the match is armed. Absent
 *  (with a one-line reason) when MC has powerups off or predates them. */
function ItemPicker({ node, pu, chosen, locked, onPick }:
  { node: string; pu: PowerupsState; chosen: string | null; locked: boolean; onPick: (p: string) => void }) {
  const note = (text: React.ReactNode, color: string = colourOf('items-itempicker-loading')) => (
    <div data-testid="item-note" style={{ font: F.chk(600, 11), letterSpacing: '.06em', color }}>{text}</div>);
  if (pu.s === 'loading') return note('READING THE ITEM LIST…');
  // F221: use the shared MC_OLDER words — the head stays 'MC SERVER IS OLDER THAN THIS CONSOLE: RESTART MC'.
  if (pu.s === 'old') return note(<>{GLYPH} {MC_OLDER.what}: {MC_OLDER.act} (<code>{MC_RESTART_CMD}</code>) TO GIVE A STATION AN ITEM. NO ITEM PICKER UNTIL THEN.</>, colourOf('items-itempicker-old-mc'));
  if (pu.s === 'err') return note(<>{GLYPH} COULD NOT READ THE ITEM LIST: {pu.msg}</>, colourOf('items-itempicker-err'));
  if (!pu.v.enabled) return note(`POWERUPS ARE OFF ON THIS MC: THIS STATION ARMS WITH NO ITEM. TO GIVE IT ONE, RESTART MC WITH ${POWERUPS_RESTART}`, colourOf('items-itempicker-powerups-off'));
  return (
    <div data-testid="item-picker" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Micro>ITEM · ONE PER STATION</Micro>
      <div role="group" aria-label={`item for ${node}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(118px,1fr))', gap: 6 }}>
        {pu.v.presets.map(({ preset, item }) => {
          const on = chosen === preset;
          return (
            <button key={preset} type="button" data-testid={`item-pick-${preset}`} aria-pressed={on} disabled={locked}
              onClick={() => onPick(preset)}
              title={locked ? 'items are locked for the match: RECALL or END it to change this station' : `${item.name}: ${itemDetail(item)}, ${schedule(item).toLowerCase()}`}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3, padding: '7px 9px', minHeight: 44, textAlign: 'left',
                background: on ? T.panelAlt : 'transparent', color: on ? T.ink : T.dim,
                borderTop: `1px solid ${on ? item.color : T.line}`, borderRight: `1px solid ${on ? item.color : T.line}`,
                borderBottom: `1px solid ${on ? item.color : T.line}`, borderLeft: `3px solid ${item.color}`,
                cursor: locked ? 'not-allowed' : 'pointer', opacity: locked && !on ? 0.55 : 1 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: F.osw(700, 14), letterSpacing: '.08em' }}><Swatch color={item.color} />{item.name}</span>
              <span style={{ font: F.chk(600, 11), letterSpacing: '.04em', color: T.micro }}>{itemDetail(item)}</span>
              <span style={{ font: F.chk(600, 11), letterSpacing: '.04em', color: T.micro }}>{schedule(item)}</span>
            </button>
          );
        })}
      </div>
      {locked && <div data-testid="item-locked" style={{ font: F.chk(700, 11), letterSpacing: '.06em', color: colourOf('items-itempicker-locked') }}>LOCKED FOR THE MATCH: RECALL OR END IT TO CHANGE THIS STATION'S ITEM</div>}
    </div>
  );
}

