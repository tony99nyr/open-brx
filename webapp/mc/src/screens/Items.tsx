// ITEMS — the utility phones (stations) on the net, and the operator's arming of them (A13.5 / F104).
//
// spec/utility.md §5b: at muster the operator sets each utility phone's kind / team / threshold, and MC gives it a
// station id (F364); MC pushes `station_config`; the phone shows MC-ARMED · game N and locks its drawer. This
// panel is that row. Everything shown comes from the server's `StationView` (`GET /api/stations`, on
// every snapshot as `stations`): what was ASSIGNED, what the phone was last ARMED with, what the phone
// itself REPORTS, and the attention flags the server derives from the three disagreeing. Until
// 2026-09-11 none of this existed, so no station was ever armed in the field.
import { useEffect, useState } from 'react';
import type { PowerupPreset, StationDeparture, StationItem, StationKind, StationView, TxPower } from '../api/types';
import { STATION_KINDS } from '../api/types';
import { STATION_DEFAULT_THRESHOLD_DBM, STATION_TEAM_ANY, TEAM_NAMES } from '../api/contract.gen';
import { useStore } from '../store';
import { ContinueToPlay } from './ContinueToPlay';
import { CHAMFER, F, T, fmtAge, fmtDuration, teamColor } from '../tokens';
import { ItemStationRow, Swatch } from '../ui/Powerups';
import { POWERUPS_RESTART, type PowerupsState, itemDetail, schedule, usePowerups } from '../ui/powerupData';
import { GhostButton, Micro, SectionRule, Seg, StepBtn, SwitchConfirm, Tag, ValueBox } from '../ui';
import { AMOUNT_MAX, AMOUNT_MIN, AMOUNT_STEP, CHARGES_MAX, CHARGES_MIN, SPAWN_EVERY_MAX, SPAWN_EVERY_MIN, SPAWN_EVERY_STEP } from '../ui/powerupLimits';
import { CONTROL_CONFLICT, conflictWords, setupLines } from '../ui/SetupSteps';
import { Alert, AlertTag } from '../ui/Alert';
import { GLYPH, MC_OLDER, MC_RESTART_CMD, SEV_COLOUR, alertWords, batteryColour, colourOf, serverLine } from '../alerts';

const KIND_LABEL: Record<StationKind, string> = { respawn: 'RESPAWN', powerup: 'POWERUP', extraction: 'EXTRACTION', bomb: 'BOMB SITE', control: 'CONTROL POINT' };
/** the picker's labels: short enough for five in a card row */
const KIND_SHORT: Record<StationKind, string> = { respawn: 'RESPAWN', powerup: 'POWERUP', extraction: 'EXTRACT', bomb: 'BOMB', control: 'CONTROL' };
// F405 (2026-09-25): Tony -- "so mvp for utility is respawn station, pickup, hill". `extraction` and
// `bomb` keep their code, their type and their recap label (`KIND_LABEL` above) so an OLD assignment of
// either still renders -- they just drop off the kind picker a host assigns a NEW station from.
const MVP_STATION_KINDS: StationKind[] = STATION_KINDS.filter(k => k !== 'extraction' && k !== 'bomb');
const TID_NAME: Record<number, string> = { ...Object.fromEntries(TEAM_NAMES.map((name, tid) => [tid, name])), [STATION_TEAM_ANY]: 'ANY' };   // F423: tid 3 paints purple, not green
/** H1: what threshold 0 resolves to, and where an edit begins: the generated STATION_DEFAULT_THRESHOLD_DBM for the
 *  station's platform and kind (types.py), the same table MC's `_wire_threshold`, the phone and the Stick read. */
export function bubbleDefault(kind: StationKind, stick: boolean): { label: string; start: number } {
  const start = STATION_DEFAULT_THRESHOLD_DBM[stick ? 'sticks3' : 'phone'][kind];
  return stick ? { label: "DEFAULT (the Stick's own)", start } : { label: `DEFAULT (${start}, phone)`, start };
}
/** A67 (F365): the station's advert strength, weakest first. A stronger advert is heard farther, so it moves the range too. */
const TX_POWER_LABEL: Record<TxPower, string> = { ultra_low: 'ULTRA LOW', low: 'LOW', medium: 'MEDIUM', high: 'HIGH' };
const TX_POWER_OPTIONS = (Object.keys(TX_POWER_LABEL) as TxPower[]).map(v => ({ value: v, label: TX_POWER_LABEL[v] }));

export function Items() {
  const { state, focusHill } = useStore();
  const stations = state?.stations ?? [];
  // Bench 2026-10-02: assigned stations that left ITEMS (BACK TO HUD, RELEASE). Absent on an older MC.
  const departures = state?.station_departures ?? [];
  const pu = usePowerups();   // A56
  // F411 §8: PLAY's ASSIGN A HILL ▸ lands here. Scroll the panel into view and call out the slot in
  // words (no station is pre-destined as "the hill" — the operator assigns one, any phone or Stick, to
  // the CONTROL kind below), rather than guessing which card to ring.
  //
  // QA-03 (visual QA round 1, 2026-09-26): this used to gate on `stations.length` too, so a host with
  // NOTHING on the net yet never scrolled or saw the callout at all -- the one screen that should be
  // telling them how to get a station onto the board said nothing and left CONTINUE TO PLAY (Armory's own
  // header button) as the only thing on screen.
  useEffect(() => {
    if (!focusHill) return;
    document.querySelector('[data-testid="items-panel"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusHill, stations.length]);
  if (!state) return null;
  if (!stations.length && !focusHill && !departures.length) return null;
  // A departed node with no card yet (still a HUD, or not heard since) is named above the cards; one that is back
  // carries its line, and RESTORE, on its own card.
  const away = departures.filter(d => !stations.some(s => s.node_id === d.node_id));
  const awayBlock = away.length > 0 && (
    <div data-testid="items-departures" role="status" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
      {away.map(d => (
        <div key={d.node_id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Alert id="items-station-departed" testid="station-departure">{d.line}</Alert>
          {/* polish r1 M2(b): a phone that stays a player would otherwise leave this line up every match */}
          <DismissDeparture node_id={d.node_id} />
        </div>
      ))}
    </div>
  );
  // QA-18: repeated here so it is still on screen once the scroll above has moved Armory's own header
  // button (`armory-back-to-play`) off the top of the viewport.
  const backToPlay = focusHill && <ContinueToPlay testid="items-back-to-play" />;
  if (!stations.length) {
    // QA-03: nobody has claimed a utility role yet, so there is no station card to carry the callout
    // below -- render the instruction on its own rather than returning null with nothing to act on.
    return (
      <div style={{ marginTop: 20 }} data-testid="items-panel">
        {awayBlock}
        {focusHill && <div data-testid="items-hill-focus" role="status" style={{ display: 'flex', flexDirection: 'column', gap: 10, font: F.chk(700, 12), letterSpacing: '.06em', lineHeight: 1.5,
          color: T.acc, border: `1px solid ${T.acc}`, background: 'rgba(57,180,255,.08)', padding: '9px 12px' }}>
          <span>NO STATION HAS SAID HELLO YET. ON A PHONE, HOLD THE SEVEN-TAP GESTURE ON THE IDLE HUD TO SWITCH IT TO A UTILITY STATION, OR POWER ON A STICKS3. IT THEN APPEARS HERE TO ASSIGN AS CONTROL.</span>
          {backToPlay}
        </div>}
      </div>
    );
  }
  // M2 (visual QA 2026-09-24): ARMED is what each card's status says (MC-ARMED), counted apart from the
  // stations with an attention line. A BATTERY LOW used to drop an armed station out of the count, so
  // "1/3 ARMED" sat above three cards that all read MC-ARMED.
  const nArmed = stations.filter(s => s.assigned && s.armed && !s.arm_pending).length;
  const nAttention = stations.filter(s => s.assigned && s.attention.length).length;
  return (
    <div style={{ marginTop: 20 }} data-testid="items-panel">
      {focusHill && (
        <div data-testid="items-hill-focus" role="status" style={{ display: 'flex', flexDirection: 'column', gap: 10, font: F.chk(700, 12), letterSpacing: '.06em', lineHeight: 1.5,
          color: T.acc, border: `1px solid ${T.acc}`, background: 'rgba(57,180,255,.08)', padding: '9px 12px', marginBottom: 10 }}>
          <span>ASSIGN A PHONE OR STICK AS CONTROL BELOW: THAT IS YOUR HILL FOR KING OF THE HILL.</span>
          {backToPlay}
        </div>
      )}
      <SectionRule label={`ITEMS // ${stations.length} STATION${stations.length === 1 ? '' : 'S'}`}
        hint={<>{nArmed}/{stations.length} ARMED{nAttention > 0 && <span data-items-attention style={{ color: colourOf('items-need-attention-count') }}> · {nAttention} NEED ATTENTION</span>} · GAME {state.game_byte ?? state.game_no ?? '—'} · ASSIGN, THEN PLACE: A STATION NEEDS NO WI-FI ONCE ARMED</>} />
      {awayBlock}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 12 }}>
        {/* keyed on the node and the assignment ONLY. The phone's `report` (kind/team/id/threshold/…) is
            deliberately NOT in the key: it starts empty and fills in on the first heartbeat (~2s after
            hello) or changes on a phone reboot, and either would remount the card mid-edit, throwing away
            the operator's draft and `busy` (F104 follow-up). So an unassigned card mounted at hello keeps
            the default draft even after the report fills in: PHONE SAYS shows the phone's own state on the
            same card, and the operator has to assign anyway. */}
        {stations.map(s => <StationCard key={`${s.node_id}|${s.assigned?.at ?? ''}`} s={s} pu={pu} stations={stations}
          departure={departures.find(d => d.node_id === s.node_id)} />)}
      </div>
    </div>
  );
}

/** Polish r1 M2(b) / L7: forget a departure. On the away block and on the station's own card. */
function DismissDeparture({ node_id }: { node_id: string }) {
  const { run, api } = useStore();
  return (
    <span data-testid="station-departure-dismiss">
      <GhostButton size={11} pad="6px 12px" onClick={async () => { await run(() => api.dismissDeparture(node_id)); }}
        title="forget this station: it is not coming back as it was">DISMISS</GhostButton>
    </span>
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
/** Overnight review M1: the words when an MC older than S-powerup-overrides took the PUT (200) but dropped CHARGES /
 *  AMOUNT / RESPAWN. Starts with `MC_OLDER.what`, so the command bar shows it as the AMBER version-skew line. */
export const OVERRIDES_DROPPED = `${alertWords(MC_OLDER.what, MC_OLDER.act)} (${MC_RESTART_CMD}), THEN ARM AGAIN: IT ARMED THE ITEM WITH ITS PRESET DEFAULTS, NOT THIS CARD'S CHARGES, AMOUNT OR RESPAWN`;
type ItemOverrides = { item_preset?: string; charges?: number; amount?: number; spawn_every_s?: number };
/** Throws OVERRIDES_DROPPED when the stored item does not carry an override this request sent. An older MC ignores
 *  the unknown keys and answers 200, so this comparison is the only way the console can tell. */
export function checkOverrides(sent: ItemOverrides, view: StationView): StationView {
  if (!sent.item_preset) return view;
  const item = view.assigned?.item;
  const dropped = (['charges', 'amount', 'spawn_every_s'] as const).some(k => sent[k] != null && item?.[k] !== sent[k]);
  if (dropped) throw new Error(OVERRIDES_DROPPED);
  return view;
}
/** The id to send such an MC: the lowest one no other station holds. */
export function lowestFreeId(stations: StationView[], node_id: string): number {
  const used = new Set(stations.flatMap(o => o.node_id !== node_id && o.assigned ? [o.assigned.id] : []));
  let n = 1; while (used.has(n)) n += 1;
  return n;
}

function StationCard({ s, pu, stations, departure }: { s: StationView; pu: PowerupsState; stations: StationView[]; departure?: StationDeparture }) {
  const { state, run, api, serverNow } = useStore();
  const teams = state?.teams ?? [];
  const a = s.assigned;
  // The draft is the operator's edit in progress; it starts from the assignment (or what the phone reports).
  const [kind, setKind] = useState<StationKind>(a?.kind ?? s.report.kind ?? 'respawn');
  const [team, setTeam] = useState<number>(a?.team ?? s.report.team ?? STATION_TEAM_ANY);
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
  const chosenPreset = presets?.find(p => p.preset === chosen) ?? null;
  const chosenKind = chosenPreset?.item.kind ?? null;
  const assignedItem = a?.kind === 'powerup' ? a.item : undefined;
  // S-powerup-overrides (2026-09-28): per-station CHARGES/AMOUNT/RESPAWN, editable once an item is chosen.
  // Same null-means-follow idiom as `thrEdit`/`txEdit` above. The BASE is the assignment's own stored item
  // while the preset pick is unchanged (so a stored override still shows), or the newly picked preset's own
  // default once the preset itself changes. A preset pick clears every edit (`onPick` below), so a new item
  // always starts from its own defaults; a field that does not apply to the chosen kind (AMOUNT on a weapon,
  // CHARGES on the overshield) is never read or sent.
  const presetChanged = itemPick != null && itemPick !== assignedPreset;
  const baseItem = (!presetChanged ? assignedItem : undefined) ?? chosenPreset?.item;
  const [chargesEdit, setChargesEdit] = useState<number | null>(null);
  const [amountEdit, setAmountEdit] = useState<number | null>(null);
  const [everyEdit, setEveryEdit] = useState<number | null>(null);
  const charges = chargesEdit ?? baseItem?.charges ?? CHARGES_MIN;
  const amount = amountEdit ?? baseItem?.amount ?? AMOUNT_MIN;
  const every = everyEdit ?? baseItem?.spawn_every_s ?? SPAWN_EVERY_MIN;
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
  // S-powerup-overrides: a stepper nudge is a change too, but only while the preset itself is unchanged --
  // a preset change already marks `dirty` below on its own, and comparing against `assignedItem` once the
  // preset changed would compare CHARGES from one weapon against another's, which is not what moved.
  const itemOverrideDirty = picking && !presetChanged && !!assignedItem && (
    (chosenKind === 'weapon' && chargesEdit != null && chargesEdit !== assignedItem.charges)
    || (chosenKind === 'overshield' && amountEdit != null && amountEdit !== assignedItem.amount)
    || (everyEdit != null && everyEdit !== assignedItem.spawn_every_s));
  const dirty = !a || a.kind !== kind || a.team !== (control ? STATION_TEAM_ANY : team) || a.threshold !== threshold
    || (tx != null && tx !== a.tx_power) || (picking && chosen !== assignedPreset) || itemOverrideDirty;
  // a powerup station still waiting for its item pick is not a live button, so it must not look like one
  const lit = (dirty || needsRearm) && !(dirty && needsPick);
  const apply = async () => {
    setBusy(true); setApplyErr(null);
    const keep = <T,>(fn: () => Promise<T>) => async () => { try { return await fn(); } catch (e) { setApplyErr((e as Error).message); throw e; } };
    try {
      // S-powerup-overrides: always resend the EFFECTIVE value for a field that applies to the chosen item,
      // not only when it just changed -- the same full-replace contract `item_preset` itself already has
      // (state.py `set_station` recomputes the whole item from this request; nothing carries over unsent).
      const body = { kind, team: control ? STATION_TEAM_ANY : team, threshold, ...(tx ? { tx_power: tx } : {}),
        ...(picking && chosen ? { item_preset: chosen, spawn_every_s: every,
          ...(chosenKind === 'weapon' ? { charges } : {}), ...(chosenKind === 'overshield' ? { amount } : {}) } : {}) };
      if (dirty) await run(keep(() => api.putStation(s.node_id, body).catch(e => {
        // F364 compatibility: an MC process older than this console (rebuilt, not restarted) still requires an id.
        if (!OLD_MC_WANTS_ID.test((e as Error).message)) throw e;
        return api.putStation(s.node_id, { ...body, id: a?.id ?? lowestFreeId(stations, s.node_id) });
      }).then(v => checkOverrides(body, v))));
      else await run(keep(() => api.armStations()));
    } finally { setBusy(false); }
  };
  // Bench 2026-10-02: RESTORE re-applies the assignment this node held before it left, through the normal PUT and
  // its validation. Offered only once the SAME node is back (`returned`) and reachable; never automatic. A refusal
  // lands on this card like any other apply.
  const canRestore = !!departure && departure.returned && !a && s.online && !locked;   // L6: MC refuses a PUT while ARMED or LIVE
  const restore = async () => {
    if (!departure) return;
    setBusy(true); setApplyErr(null);
    try {
      await run(async () => { try { return checkOverrides(departure.restore, await api.putStation(s.node_id, departure.restore)); } catch (e) { setApplyErr((e as Error).message); throw e; } });
    } finally { setBusy(false); }
  };
  const rep = s.report;
  const age = s.last_seen_ms;
  const teamOptions = [...teams.map(t => ({ value: String(t.tid), label: t.name.toUpperCase().replace(/ TEAM$/, '') })), { value: String(STATION_TEAM_ANY), label: 'ANY' }];
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
          {rep.kind ? `${KIND_LABEL[rep.kind] ?? rep.kind} ${rep.station_id ?? '?'} · ${TID_NAME[rep.team ?? STATION_TEAM_ANY] ?? rep.team}` : '—'}
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
      {departure && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Alert id="items-station-departed" testid="station-departure">{departure.line}</Alert>
          {/* L7 (overnight review): DISMISS sits beside RESTORE here too, not only on the away block above */}
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {canRestore && (
            <span data-testid="station-restore">
              <GhostButton disabled={busy} onClick={restore} color={T.ink} border={T.acc}
                title={departure.id_free ? 'assign this station exactly as it was before it left: the same kind, team, item and range, and its old id'
                  : 'assign this station as it was before it left: the same kind, team, item and range. Its old id is taken now, so MC gives it a new one'}>
                {/* polish r1 L1: the number only while RESTORE would really get it back */}
                RESTORE ▸ {departure.kind === 'control' ? 'HILL' : KIND_SHORT[departure.kind]}{departure.id_free ? ` ${departure.id}` : ''}
              </GhostButton>
            </span>
          )}
          <DismissDeparture node_id={departure.node_id} />
          </span>
        </div>
      )}
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
        {kind === 'powerup' && <ItemPicker node={s.node_id} pu={pu} chosen={chosen} locked={locked} onPick={p => { setItemPick(p); setChargesEdit(null); setAmountEdit(null); setEveryEdit(null); }}
          effective={chosenPreset ? { ...chosenPreset.item, ...(chosenKind === 'weapon' ? { charges } : {}), ...(chosenKind === 'overshield' ? { amount } : {}), spawn_every_s: every, first_at_s: every } : null} />}
        {kind === 'powerup' && chosen && chosenPreset && (
          <div data-testid="item-overrides" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            {chosenKind === 'weapon' && (
              <OverrideStepper node={s.node_id} field="charges" label="CHARGES" value={charges} min={CHARGES_MIN} max={CHARGES_MAX}
                step={1} format={v => String(v)} width={30} disabled={locked} onChange={setChargesEdit} />
            )}
            {chosenKind === 'overshield' && (
              <OverrideStepper node={s.node_id} field="amount" label="AMOUNT" value={amount} min={AMOUNT_MIN} max={AMOUNT_MAX}
                step={AMOUNT_STEP} format={v => `+${v}`} width={44} disabled={locked} onChange={setAmountEdit} />
            )}
            <OverrideStepper node={s.node_id} field="respawn" label="RESPAWN" value={every} min={SPAWN_EVERY_MIN} max={SPAWN_EVERY_MAX}
              step={SPAWN_EVERY_STEP} format={v => fmtDuration(v)} width={44} disabled={locked} onChange={setEveryEdit} />
          </div>
        )}
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
          {applyErr && <span data-testid="station-apply-error" role="alert" style={{ flexBasis: '100%', font: F.chk(700, 11), letterSpacing: '.06em', color: colourOf('items-apply-err') }}>{GLYPH} {applyErr.startsWith(MC_OLDER.what) ? '' : 'NOT ARMED: '}{applyErr}</span>}
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
function ItemPicker({ node, pu, chosen, locked, onPick, effective }:
  { node: string; pu: PowerupsState; chosen: string | null; locked: boolean; onPick: (p: string) => void;
    /** the chosen item with this card's CHARGES/AMOUNT/RESPAWN applied, so its chip agrees with the steppers */
    effective?: StationItem | null }) {
  const note = (text: React.ReactNode, color: string = colourOf('items-itempicker-loading')) => (
    <div data-testid="item-note" style={{ font: F.chk(600, 11), letterSpacing: '.06em', color }}>{text}</div>);
  if (pu.s === 'loading') return note('READING THE ITEM LIST…');
  // F221: use the shared MC_OLDER words — the head stays 'MC SERVER IS OLDER THAN THIS CONSOLE: RESTART MC'.
  if (pu.s === 'old') return note(<>{GLYPH} {MC_OLDER.what}: {MC_OLDER.act} (<code>{MC_RESTART_CMD}</code>) TO GIVE A STATION AN ITEM. NO ITEM PICKER UNTIL THEN.</>, colourOf('items-itempicker-old-mc'));
  if (pu.s === 'err') return note(<>{GLYPH} COULD NOT READ THE ITEM LIST: {pu.msg}</>, colourOf('items-itempicker-err'));
  if (!pu.v.enabled) return note(`POWERUPS ARE OFF ON THIS MC (--no-powerups): THIS STATION ARMS WITH NO ITEM. TO GIVE IT ONE, RESTART MC: ${POWERUPS_RESTART}`, colourOf('items-itempicker-powerups-off'));
  return (
    <div data-testid="item-picker" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Micro>ITEM · ONE PER STATION</Micro>
      <div role="group" aria-label={`item for ${node}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(118px,1fr))', gap: 6 }}>
        {pu.v.presets.map(({ preset, item: presetItem }) => {
          const on = chosen === preset;
          const item = on && effective ? effective : presetItem;
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

/** S-powerup-overrides (2026-09-28): one per-station override on the chosen item -- CHARGES, AMOUNT or
 *  RESPAWN. Same idiom as `Games.tsx`'s own steppers: `StepBtn` either side of a fixed-width `tabular-nums`
 *  value, so stepping it never resizes the box and shoves the pair sideways under the finger pressing it
 *  (bench 2026-09-28, the same finding that shaped `QuickPick`). Disables at each range end on its own,
 *  with no need for the caller to track it. */
function OverrideStepper({ node, field, label, value, min, max, step, format, width, disabled, onChange }: {
  node: string; field: string; label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; width: number; disabled: boolean; onChange: (v: number) => void;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Micro>{label}</Micro>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <StepBtn label={`${label.toLowerCase()} for ${node} minus`} disabled={disabled || value <= min}
          onClick={() => onChange(Math.max(min, value - step))}>−</StepBtn>
        <span data-testid={`station-${field}-${node}`} style={{ font: F.chk(700, 13), letterSpacing: '.04em', minWidth: width,
          textAlign: 'center', fontVariantNumeric: 'tabular-nums', color: disabled ? T.micro : T.ink }}>{format(value)}</span>
        <StepBtn label={`${label.toLowerCase()} for ${node} plus`} disabled={disabled || value >= max}
          onClick={() => onChange(Math.min(max, value + step))}>+</StepBtn>
      </span>
    </span>
  );
}

