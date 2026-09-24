import { useEffect, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { armoryGate, backhaulOffer, cureLabel, gunLockedLabel, GUN_FLAPPING_LINE, poolStaleLabel, isRoutableLanIp, reachLabel, reachTooltip, registrySig, sentenceCase, splitBlocker, staleReachReason } from '../api/derive';
import { STALE_AFTER_MS, type LogView, type ReadinessRow, type TunnelStatus } from '../api/types';
import { setNotice } from '../notice';
import { useStore } from '../store';
import { CHAMFER, F, T, TAB, fmtAge } from '../tokens';
import { CountBlock, GhostButton, Micro, OutlineTag, ScreenHeader, SectionRule, Seg, SegBar, Tag } from '../ui';
import { Items } from './Items';
import { PlayButton, standDownLocked } from '../ui/Standby';

const statusColor = (s: ReadinessRow['status']) =>
  (s === 'red' ? T.bad : s === 'amber' ? T.warn : s === 'waiting' ? T.micro : T.ok);

// A29 (2026-09-12) — the phones report their REAL build now (`"<version>+<sha>[-dirty]"`). MC could not
// tell APK 0.1.8 from today's tree at the game test, and a phone a version behind can misplay the
// match. Two rules, and BOTH of them live on the server (`state.py readiness()` holds `APP_MAJOR`):
// a wrong MAJOR is a RED blocker, a MINOR/PATCH difference is AMBER. The console renders the strings
// it is sent and derives NO version rule of its own — it only shows the version and counts the field.

/** `"0.1.9+ab12cd3-dirty"` → `"0.1.9"` for the tally; the sha is noise in a summary and gold in a chip. */
const verShort = (v?: string | null) => (v ? v.split('+')[0] : '');
/** newest first by semver, so the summary leads with the version the field SHOULD be on */
const verRank = (v: string) => v.split('.').map(n => parseInt(n, 10) || 0);
const verCmp = (a: string, b: string) => {
  const [x, y] = [verRank(a), verRank(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((y[i] ?? 0) !== (x[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  return 0;
};
/** "PHONES · 6 × 0.1.9 · 2 × 0.1.8" — a TALLY of what is on the field, never a verdict about it.
 *  A phone that has not reported a build is counted as UNKNOWN rather than folded into the majority.
 *
 *  `field` is the server's own count (`state.py versions()`, `State.versions.field`) when the snapshot
 *  carries it; otherwise the console counts the nodes it can see. Both produce the same sentence, and
 *  neither decides anything: every version VERDICT arrives already worded, in a readiness row. */
export function appVerSummary(nodes: { app_ver?: string | null }[], field?: Record<string, number>): string {
  const counts = new Map<string, number>();
  if (field && Object.keys(field).length) {
    for (const [v, n] of Object.entries(field)) counts.set(verShort(v) || 'UNKNOWN', (counts.get(verShort(v) || 'UNKNOWN') ?? 0) + n);
  } else {
    if (nodes.length === 0) return '';
    for (const n of nodes) {
      const v = verShort(n.app_ver) || 'UNKNOWN';
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return '';
  const parts = [...counts.entries()]
    .sort((a, b) => (a[0] === 'UNKNOWN' ? 1 : b[0] === 'UNKNOWN' ? -1 : verCmp(a[0], b[0])))
    .map(([v, n]) => `${n} × ${v}`);
  return `PHONES · ${parts.join(' · ')}`;
}

// A25 (2026-09-12, D6) — background log sync. "For almost all of my games I'm going to want the logs
// from all phones." MC asks on its own while `log_sync` is `auto` (at the recap, on a node's offer, on
// a reconnect); `manual` leaves the asking to the operator. The LOGS button is never gated either way.
//
// What the board shows is what the PHONE reports, never what MC intended: MC asking does not make a
// log `offered`, because the node answers when it is safe to and MC never waits on it (`state.py
// _set_log`). So every state below is a fact about the phone, and `none` is "the phone has not said",
// not "there is nothing".
const LOG_LABEL: Record<LogView['state'], { text: string; color: string }> = {
  none: { text: 'NOTHING OFFERED', color: T.micro },
  offered: { text: 'READY TO SEND', color: T.acc },
  pulling: { text: 'SENDING…', color: T.warn },
  held: { text: 'HOLDING', color: T.warn },
  complete: { text: 'DELIVERED ✓', color: T.ok },
};
const kb = (n?: number) => (n == null ? '' : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/** One node's log line. Always rendered — a row that vanishes when a phone has said nothing reads as
 *  "fine", and "the phone has not said" is exactly what the operator needs to know before a match. */
function LogCell({ log }: { log?: LogView }) {
  const st = log?.state ?? 'none';
  const { text, color } = LOG_LABEL[st] ?? LOG_LABEL.none;
  // the node worded `reason` itself ("2 facts pending") — render it verbatim, never re-phrase it
  const detail = [log?.reason, st === 'pulling' || st === 'complete' || st === 'offered'
    ? [log?.lines ? `${log.lines} lines` : '', kb(log?.bytes)].filter(Boolean).join(' · ') : '']
    .filter(Boolean).join(' · ');
  return (
    <span data-log-state={st} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ font: F.chk(600, 12), letterSpacing: '.08em', color }}>{text}</span>
      {detail && <span style={{ font: F.mono(500, 11), letterSpacing: '.04em', color: T.micro, textTransform: 'none' }}>{detail}</span>}
    </span>
  );
}

export function Armory() {
  const { state, run, api, setView } = useStore();
  const [scanning, setScanning] = useState(false);
  const [registry, setRegistry] = useState<{ gun_id: string; sticker: string; ble: { tail?: string } }[]>([]);
  // Keyed on WHICH GUNS MC knows about, so a SCAN that enrols a new gun shows up in KNOWN GUNS —
  // NOT SEEN without a reload. NOT on `readiness.t`: that is a clock, and at 4 snapshots a second it
  // refetches the armory ~4x/s for as long as this screen is open (review 2026-09-01).
  const backhaul = useBackhaul();   // ENABLE BACKHAUL beside the gate (bench 2026-09-17)
  const sig = registrySig(state);
  useEffect(() => { api.armory().then(setRegistry).catch(() => { /* keep the last good list — a transient failure must not empty KNOWN GUNS */ }); }, [api, sig]);
  if (!state) return null;
  const { readiness } = state;
  const board = readiness.board;
  // A13.5: a utility phone is a station, not a companion; it has its own card in ITEMS below.
  const phones = (state.nodes ?? []).filter(n => n.node_type !== 'utility');
  // F-armory-dedup (operator, bench 2026-09-17): "a linked phone for a rostered player appears twice —
  // once as the gun card, once under PHONES ON THE NET. Confusing." A board row IS that phone once it
  // reads `node: 'linked'` (`state.py`'s `nid` is the same node this loop is walking), so PHONES ON THE
  // NET now lists only what the gun cards do NOT already say: a phone with no bound player, or one
  // bound to a player who is not on this board at all (removed from the roster, say). Everything a
  // hidden card carried that the gun card did not — the LOGS button, the build chip — moved onto
  // GunCard itself (below) rather than being dropped.
  const boardLinkedPlayerIds = new Set(board.filter(g => g.node === 'linked').map(g => g.player_id));
  const visiblePhones = phones.filter(n => !(n.player_id && boardLinkedPlayerIds.has(n.player_id)));
  const hiddenPhoneCount = phones.length - visiblePhones.length;
  const nGreen = board.filter(g => g.status === 'green').length;
  const nAmber = board.filter(g => g.status === 'amber').length;
  const nRed = board.filter(g => g.status === 'red').length;
  const nWaiting = board.filter(g => g.status === 'waiting').length;
  // "waiting" is not a fault and must not be reported as one: it just means the phone has not
  // arrived yet (Tony, 2026-09-01 — a board full of disconnected guns "looked like critical errors").
  // No separate status line under the gate button. Tony, 2026-09-02: "we dont need this extra status.
  // maybe a disabled status on the button and thats it". The history of the gate (R2-2: a red a
  // RE-PUSH cures does not block; F1: the gate asks the server's `blocksPush`) lives on
  // `derive.armoryGate`.
  // Bench 2026-09-17 (Tony): CONTINUE ▸ became HARDWARE READY ▸, and the label is the status: it names
  // what it waits for. The gate did not move (`derive.armoryGate`).
  const gate = armoryGate(board);

  return (
    <div className="screen" style={{ maxWidth: 1380, margin: '0 auto' }}>
      <RestoredBanner />
      <ScreenHeader kicker="[ A1 // GEAR CHECK ]" title="Readiness Board" right={
        <>
          <GhostButton onClick={async () => { setScanning(true); await run(() => api.scan(6)); setScanning(false); }}>{scanning ? 'SCANNING…' : '⟳ SCAN ARMORY'}</GhostButton>
          {/* A29: what the field is running, at the top of the screen where the operator decides whether
              to send someone to update before the night starts. The server may word this itself
              (`readiness.app_vers`); when it does not, the console counts the nodes. */}
          {/* A25: the session switch. Rendered ONLY when the server sends an option table — an older MC
              has no `/api/options` to PUT to, and a switch that writes to a 404 is worse than none. */}
          {state.options?.log_sync && (
            // Bench 2026-09-17 (Tony): the always-visible legend under this switch was noise. What each mode does
            // is a short tooltip on the LOG SYNC label; the LOGS button works in both modes.
            <span data-logsync={state.options.log_sync} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span data-logsync-label="1"
                title={state.options.log_sync === 'auto'
                  ? 'Auto: MC collects each phone log after the match. The LOGS button always works.'
                  : 'Manual: MC collects a log only when you press LOGS.'}
                style={{ font: F.mono(600, 11), letterSpacing: '.16em', color: T.micro, cursor: 'help' }}>LOG SYNC</span>
              <Seg label="log sync" value={state.options.log_sync}
                options={[{ value: 'auto' as const, label: 'AUTO' }, { value: 'manual' as const, label: 'MANUAL' }]}
                onChange={v => run(() => api.setOptions({ log_sync: v }))} pad="5px 12px" />
            </span>
          )}
          {phones.length > 0 && (
            <span data-app-ver-summary="1" title="Every phone on the net and the build it reports"
              style={{ font: F.mono(600, 11), letterSpacing: '.1em', color: T.dim, border: `1px solid ${T.line2}`, padding: '7px 12px' }}>
              {appVerSummary(phones, state.versions?.field)}
            </span>
          )}
          <div style={{ display: 'flex', gap: 2 }}>
            <CountBlock value={nGreen} label="GREEN" color={T.ok} />
            <CountBlock value={nAmber} label="AMBER" color={T.warn} />
            <CountBlock value={nRed} label="RED" color={nRed ? T.bad : T.micro} />
            {nWaiting > 0 && <CountBlock value={nWaiting} label="NO PHONE" color={T.micro} />}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {backhaul.control}
              {/* Disabled on REDS a push cannot cure, only. Amber and a waiting phone never blocked
                  going on: this is navigation to GAMES; the real gate is the lobby push. */}
              <button type="button" data-testid="armory-gate" data-gate-ready={gate.ready ? '1' : '0'}
                className={!gate.disabled ? 'hov-accbg' : ''} disabled={gate.disabled} title={gate.why}
                onClick={async () => { await run(() => api.setPhase('build')); setView('build'); }}
                style={{ font: F.osw(700, 20), letterSpacing: '.22em', padding: '10px 26px 10px 32px', whiteSpace: 'nowrap',
                  background: gate.disabled ? 'transparent' : gate.ready && nGreen ? T.ok : T.panelAlt, color: gate.disabled ? T.micro : gate.ready && nGreen ? T.accInk : T.dim,
                  border: `1px solid ${gate.disabled ? T.line2 : gate.ready && nGreen ? T.ok : T.line}`, clipPath: CHAMFER.tl14,
                  cursor: gate.disabled ? 'not-allowed' : 'pointer', minHeight: 48 }}>{gate.label}</button>
            </div>
            {backhaul.errLine}
          </div>
        </>
      } />
      <div style={{ display: 'flex', gap: 14, alignItems: 'stretch', flexWrap: 'wrap', marginBottom: 20 }}>
        <JoinPanel />
        <div style={{ flex: '1 1 520px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(290px,1fr))', gap: 12, alignContent: 'start' }}>
          {board.map(g => <GunCard key={g.sticker} g={g} />)}
          {board.length === 0 && <div style={{ font: F.mono(500, 11), letterSpacing: '.14em', color: T.micro, padding: '20px 4px' }}>NO PLAYERS YET — ADD OPERATORS IN KIT, OR JUST GET PHONES JOINED FIRST ◂</div>}
        </div>
      </div>
      <Items />
      {phones.length > 0 && (
        /* `data-nodes` is the count this section BELIEVES it is RENDERING AS CARDS; each card carries
           `data-node-card`. A test can then wait for "every phone card is on screen" instead of
           sleeping through the first snapshots — the sleep is what hid the arm_state crash below.
           F-armory-dedup: that count is now `visiblePhones`, not every connected phone — a phone
           already shown on a gun card above is not rendered again here. `data-phones-total` keeps the
           full connected count on the page for anything that needs to know a phone exists at all. */
        <div style={{ marginTop: 20 }} data-nodes={visiblePhones.length} data-phones-total={phones.length}>
          {visiblePhones.length > 0 && (<>
            <SectionRule label={`PHONES ON THE NET // ${visiblePhones.length}`} hint="WITH OR WITHOUT A GUN" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(290px,1fr))', gap: 12 }}>
              {visiblePhones.map(n => <NodeCard key={n.node_id} n={n} registry={registry} />)}
            </div>
          </>)}
          {/* every remaining connected phone already has a gun card above — say so once, quietly,
              instead of a section that either repeats them or simply vanishes with no explanation. */}
          {hiddenPhoneCount > 0 && (
            <div data-hidden-phones={hiddenPhoneCount} style={{ marginTop: visiblePhones.length > 0 ? 10 : 0, font: F.mono(500, 11), letterSpacing: '.1em', color: T.micro }}>
              {hiddenPhoneCount} PHONE{hiddenPhoneCount === 1 ? ' IS' : 'S ARE'} ON PLAYER CARDS ABOVE
            </div>
          )}
        </div>
      )}
      {registry.filter(r => !readiness.unclaimed.some(u => u.gun_id === r.gun_id) && !readiness.board.some(b => b.gun_id === r.gun_id) && !(state?.nodes ?? []).some(n => (n.gun_tail || '').toUpperCase() === (r.ble?.tail || '—').toUpperCase())).length > 0 && (
        <div style={{ marginTop: 20 }}>
          <SectionRule label="KNOWN GUNS — NOT SEEN" hint="POWERED OFF, OUT OF RANGE, OR NOT YET CLAIMED BY A PHONE" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(290px,1fr))', gap: 12 }}>
            {registry.filter(r => !readiness.unclaimed.some(u => u.gun_id === r.gun_id) && !readiness.board.some(b => b.gun_id === r.gun_id) && !(state?.nodes ?? []).some(n => (n.gun_tail || '').toUpperCase() === (r.ble?.tail || '—').toUpperCase())).map(r => <GhostCard key={r.gun_id} r={r} />)}
          </div>
        </div>
      )}
      {readiness.unclaimed.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <SectionRule label={`UNCLAIMED // ${readiness.unclaimed.length} GUNS ADVERTISING, NO NODE`} hint="HAND THEM OUT — A PHONE MUST CLAIM EACH GUN" />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {readiness.unclaimed.map(u => (
              <span key={u.tail} style={{ background: T.panel, border: `1px solid ${T.line}`, padding: '8px 14px', display: 'inline-flex', gap: 10, alignItems: 'baseline' }}>
                <span style={{ font: F.osw(700, 16), letterSpacing: '.08em' }}>{u.basename}</span>
                <Micro>-{u.tail}</Micro>
                <Micro color={T.dim}>{u.rssi} dBm</Micro>
                {u.identity !== 'ok' && <Tag color={u.identity === 'reverted' ? T.bad : T.warn} size={11}>{u.identity.toUpperCase()}</Tag>}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** ENABLE BACKHAUL (bench 2026-09-17): a one-tap start for the internet link, beside HARDWARE READY,
 *  offered only once every rostered phone is on the board and green (`derive.backhaulOffer`). It calls
 *  the same route as REACH's TURN ON and never waits on the link: the operator can go on to GAMES while
 *  the link starts. After a press it stays as a quiet BACKHAUL ON tag, so the press visibly landed; a
 *  link that was already up before this screen pressed anything shows nothing here (REACH says so). An
 *  error is one quiet line under the row and never touches HARDWARE READY. */
function useBackhaul(): { control: ReactNode; errLine: ReactNode } {
  const { state, api } = useStore();
  const [pressed, setPressed] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { offer, status } = backhaulOffer(state);
  // `sending` holds STARTING… from the press until the next snapshot moves `lan.public.status`, so the
  // button does not flash back between the route's reply and the snapshot that follows it.
  useEffect(() => { setSending(false); }, [status]);
  const start = () => {
    setPressed(true); setSending(true); setErr(null);
    // not awaited by the caller: navigation must never wait on the link
    api.setTunnel(true).catch(e => { setErr((e as Error).message || 'the link did not start'); setSending(false); });
  };
  const linkErr = status === 'up' ? null : err ?? (pressed && status === 'error' ? (state?.lan.public?.error || 'the link did not start') : null);
  // one quiet line under the button row, so the row itself keeps its alignment
  const errLine = linkErr ? (
    <span data-backhaul-error="1" title={linkErr}
      style={{ font: F.mono(500, 11), letterSpacing: '.06em', color: T.warn, maxWidth: 'min(420px, calc(100vw - 32px))',
               minWidth: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
      BACKHAUL FAILED: {linkErr}
    </span>
  ) : null;
  let control: ReactNode = null;
  if (status === 'starting' || (sending && status !== 'up')) {
    control = <span data-backhaul="starting" style={{ font: F.chk(700, 11), letterSpacing: '.2em', color: T.dim, padding: '8px 4px' }}>STARTING…</span>;
  } else if (status === 'up') {
    control = pressed ? <span data-backhaul="on"><OutlineTag color={T.ok} border={T.ok} title="The internet link is up. REACH shows its address.">BACKHAUL ON</OutlineTag></span> : null;
  } else if (offer) {
    control = (
      <button type="button" data-backhaul="offer" onClick={start} className="hov-acc"
        title="Start the internet link so phones can reach MC off the field Wi-Fi"
        style={{ minHeight: 44, background: 'transparent', border: `1px solid ${T.line2}`, color: T.dim,
                 font: F.chk(700, 12), letterSpacing: '.18em', padding: '10px 16px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
        ENABLE BACKHAUL
      </button>
    );
  }
  return { control, errLine };
}

/** F142 (field 2026-09-12, ISSUE 11/11b) — a `--demo` session persisted into `~/.brx-mcp/` and was
 *  silently RESTORED on the next real launch: two ghost players with no phone sat on the roster and
 *  were mistaken for real ones until match 2 was already mid-setup. The only tell in the field was one
 *  line MC printed to a terminal nobody was watching. This puts the fact on the board itself, with a
 *  one-tap way out — `state.restored_from` is optional (absent on a clean session, and on a server
 *  that predates the fix), so a fresh launch renders nothing here at all. */
function RestoredBanner() {
  const { state, run, api } = useStore();
  const [busy, setBusy] = useState(false);
  const r = state?.restored_from;
  if (!r) return null;
  const when = new Date(r.at ?? Number.NaN);
  const stamp = Number.isFinite(when.getTime())
    ? when.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—';
  return (
    <div role="alert" data-testid="restored-banner" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      background: 'rgba(255,176,32,.08)', border: `1px solid ${T.warn}`, borderLeft: `3px solid ${T.warn}`, padding: '12px 16px' }}>
      <span style={{ font: F.chk(700, 12), letterSpacing: '.1em', color: T.warn, lineHeight: 1.5 }}>
        ▲ RESTORED FROM {stamp.toUpperCase()} · {r.players} PLAYER{r.players === 1 ? '' : 'S'} CARRIED OVER FROM THE LAST SESSION —
        {' '}CHECK THE ROSTER BEFORE YOU KIT OUT.
      </span>
      <button type="button" disabled={busy} className={busy ? undefined : 'hov-warnbg'}
        onClick={async () => { setBusy(true); try { await run(() => api.newSession(false)); } finally { setBusy(false); } }}
        style={{ marginLeft: 'auto', font: F.chk(700, 11), letterSpacing: '.2em', padding: '8px 16px', minHeight: 36,
                 background: 'transparent', border: `1px solid ${T.warn}`, color: busy ? T.micro : T.warn, cursor: busy ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
        {busy ? 'STARTING…' : 'NEW SESSION, CLEAR ROSTER ▸'}
      </button>
    </div>
  );
}

function GunCard({ g }: { g: ReadinessRow }) {
  const { state } = useStore();
  const color = statusColor(g.status);
  const red = g.status === 'red';
  const waiting = g.status === 'waiting';   // no phone yet: inactive, NOT a fault
  const batt = g.battery_pct;
  const battColor = batt == null ? T.micro : batt < 30 ? T.bad : batt < 60 ? T.warn : T.ok;
  const age = g.last_seen_age_ms ?? g.battery_age_ms ?? null;                 // real link age from the server
  const stale = age != null && age > 60_000;                                   // >1 min old = show nothing as live truth
  const current = g.node === 'linked' && g.reach != null && age != null && age <= STALE_AFTER_MS;
  const linkText = g.node === 'none' ? 'NO PHONE' : age == null ? '—' : `${fmtAge(age)} AGO`;
  // S38 (field 2026-09-12, ISSUE 13): the gamertag lived only in the connected-nodes strip at the top —
  // the card that carries everything ELSE about this player's gear said nothing about who was holding it.
  const player = g.player_id ? (state?.players ?? []).find(p => p.player_id === g.player_id) : undefined;
  // F-armory-dedup (2026-09-17): a rostered player's phone used to carry the LOGS button and its app
  // build ONLY on the separate node card under PHONES ON THE NET — which Armory() now hides for a
  // linked, rostered phone (it is right here already). `player.node_id` is the same id `state.py`
  // resolves into `nid` for this row; the tail match is the fallback for the demo's own "gun claimed,
  // no roster player" preview rows, which carry no `player` object to read a node_id off.
  const nodeId = player?.node_id
    || (state?.nodes ?? []).find(n => (n.gun_tail || '—').toUpperCase() === (g.tail || '—').toUpperCase())?.node_id
    || null;
  // F144/F155 (field 2026-09-12, ISSUE 14/30): the row's own view of its path to MC — `reach`/`last_reach`
  // now ride directly on the ReadinessRow (state.py stamps them the same way it stamps everything else
  // here), so this reads the ROW, never a separate `state.nodes` lookup that could name a different node
  // than the one this card is actually about.
  //
  // Pass 1 (2026-09-12): gated on `present` — a card with NO node ever bound (`g.node === 'none'`,
  // "NEVER THIS SESSION") is a DIFFERENT fact than a node that dropped after being reached over the
  // internet, and showing both on one card ("NEVER THIS SESSION" over "NOT REACHED FOR 2m10s") read as
  // a card contradicting itself.
  const reachReason = g.present
    ? staleReachReason({ reach: g.reach ?? undefined, last_reach: g.last_reach ?? undefined, last_seen_ms: g.last_seen_age_ms ?? 0 }, state?.lan.public?.status)
    : null;
  // A32: the server says WHETHER the headset is proven and HOW — `link` = a BLE link this phone has held
  // for 10 s, which a headless gun cannot do (it drops in ~6 s), `echo` = the gun answered the config push.
  // The "still confirming" count-up is an ordinary server amber and is rendered by the amber list below;
  // this card never times anything itself, so it cannot disagree with the board.
  // Both proofs mean the SAME THING — the headset is on — and they must read that way. `PROVEN BY
  // LINK` beside a plain `CONNECTED` read as two different states, with the echo sounding like the
  // weaker one (round-2 review 2026-09-12): one word for the fact, the proof in brackets after it.
  const hs = stale ? 'UNKNOWN'
    : g.headset === 'proven' ? (g.headset_proof === 'link' ? 'CONNECTED (LINK)' : 'CONNECTED (ECHO)')
    : g.headset === 'absent' ? '—' : 'UNKNOWN';
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderLeft: `3px solid ${color}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 11, clipPath: CHAMFER.tr12, opacity: waiting ? 0.62 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, flex: '1 1 auto' }}>
          {/* the sticker usually ALREADY ends in the tail ("ALPHA-3D4F"), and printing it again wrapped
              the title onto two lines and pushed the status tag off the card edge (field 2026-09-02) */}
          <span title={g.sticker} style={{ font: F.osw(700, 20), letterSpacing: '.06em', whiteSpace: 'nowrap',
                                           overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{g.sticker}</span>
          {!!g.tail && !g.sticker.toUpperCase().endsWith(g.tail.toUpperCase())
            && <span style={{ font: F.mono(500, 11), color: T.micro, whiteSpace: 'nowrap' }}>-{g.tail}</span>}
          {g.player_num != null && <span style={{ font: F.mono(500, 11), color: T.acc, whiteSpace: 'nowrap' }}>#{g.player_num}</span>}
          {/* S38: the gamertag once a player is bound — this card is where the operator is looking. */}
          {player && <span style={{ font: F.chk(700, 12), letterSpacing: '.06em', color: T.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{player.display}</span>}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: '0 0 auto' }}>
          {/* F144 (field 2026-09-12): a node reached over the internet tunnel is READY, not a fault —
              this is information about the PATH, riding beside the status, never instead of GREEN. */}
          {g.node === 'linked' && !!g.reach && (
            <OutlineTag color={g.reach === 'backhaul' ? T.acc : T.micro} border={g.reach === 'backhaul' ? T.acc : T.line} title={reachTooltip(g.reach)}>
              {reachLabel(g.reach)}
            </OutlineTag>
          )}
          <Tag color={color} style={{ whiteSpace: 'nowrap' }}>
            {red ? 'BLOCKED' : g.status === 'waiting' ? (g.node === 'none' ? 'NO PHONE YET' : 'OFFLINE') : g.status === 'amber' ? 'CHECK' : 'READY'}
          </Tag>
        </div>
      </div>
      {g.node === 'none' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '82px 1fr', gap: '6px 10px', alignItems: 'center' }}>
          <Micro>LINK</Micro><Val color={T.micro}>NO PHONE</Val>
          <Micro>LAST SEEN</Micro><Val color={T.micro}>{age == null ? 'NEVER THIS SESSION' : `${fmtAge(age)} AGO`}</Val>
        </div>
      ) : (
      <div style={{ display: 'grid', gridTemplateColumns: '82px 1fr', gap: '6px 10px', alignItems: 'center' }}>
        {/* Bench 2026-09-17: a headset that is off makes the gun drop the link every few seconds. The phone
            reports `gun_flapping`, and this row holds one steady amber line instead of LINKED / LINK LOST in turn. */}
        <Micro>GUN</Micro><span data-gun-flapping={!stale && g.gun_flapping ? 'true' : undefined}>{!stale && g.gun_flapping
          ? <Val color={T.warn}>{GUN_FLAPPING_LINE}</Val>
          : <Val color={stale ? T.warn : g.gun_linked ? T.ink : g.gun_linked === false ? T.bad : T.micro}>{stale ? `UNKNOWN: LAST DATA ${fmtAge(age ?? 0)} AGO` : g.gun_linked ? 'LINKED' : g.gun_linked === false ? 'LINK LOST' : '—'}</Val>}
          {current && gunLockedLabel(g.gun_locked) && <span data-gun-locked={g.player_id} role="alert" title="The player's phone proved that the gun stopped answering."
            style={{ display: 'block', marginTop: 4, font: F.mono(700, 11), letterSpacing: '.08em', color: T.bad }}>{gunLockedLabel(g.gun_locked)}</span>}
          {/* F208: grey information beside the link state, never a warning and never on a stale card */}
          {!stale && poolStaleLabel(g.pool_stale, g.pool_stale_ms) && <span data-gun-silent={g.player_id} title="The phone says this gun's health and ammo readout may be out of date."
            style={{ marginLeft: 8, font: F.mono(500, 11), letterSpacing: '.08em', color: T.micro }}>{poolStaleLabel(g.pool_stale, g.pool_stale_ms)}</span>}
          {/* F264: the node's own outcome. `no_answer` needs a human, so it alone gets the warning colour. */}
          {!stale && cureLabel(g.cure) && <span data-gun-cure={g.player_id} title="The node's own outcome after it probed the gun."
            style={{ marginLeft: 8, font: F.mono(500, 11), letterSpacing: '.08em', color: g.cure === 'no_answer' ? T.warn : T.micro }}>{cureLabel(g.cure)}</span>}</span>
        <Micro>HEADSET</Micro><span data-headset={stale ? 'stale' : g.headset_proof ?? g.headset}><Val color={stale ? T.micro : g.headset === 'proven' ? T.ink : g.headset === 'absent' ? T.micro : T.warn}>{hs}</Val></span>
        {/* A37 — the WEAPON check, said out loud in THREE states. The headset row above answers "did
            the gun answer at all"; this one answers "did it answer with the weapon we compiled". It
            is separate because `not_echoed` is the NORMAL answer on v4.32 firmware (the `$WEAP` echo
            has never been seen from our units, protocol.md), and a board that showed only "no fault"
            was reading GREEN for a check that never ran. Neutral grey, never amber: an unproven
            check is not a warning about this gun, it is the absence of a proof. */}
        {g.echo && (<>
          <Micro>WEAPON</Micro>
          <span data-echo={g.echo}>
            <Val color={g.echo === 'proven' ? T.ink : g.echo === 'mismatch' ? T.bad : T.micro}>
              {g.echo === 'proven' ? 'ECHO MATCHES CONFIG'
                : g.echo === 'mismatch' ? 'ECHO ≠ CONFIG'
                : 'GUN DID NOT ECHO ITS WEAPON — UNPROVEN ON THIS FIRMWARE'}
            </Val>
          </span>
        </>)}
        <Micro>BATTERY</Micro>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ font: F.osw(600, 14), ...TAB, minWidth: 38, color: stale ? T.micro : battColor }}>{batt == null ? '—' : stale ? `${batt}%*` : `${batt}%`}</span>
          <SegBar pct={stale ? 0 : batt ?? 0} color={battColor} height={8} cell={7} style={{ flex: 1, maxWidth: 96 }} />
          {stale && <span style={{ font: F.mono(500, 8), color: T.micro }}>*OLD</span>}
        </span>
        <Micro>LINK</Micro><Val color={stale ? T.warn : T.dim}>{linkText}</Val>   {/* this branch only runs when a node IS linked */}
        {/* F-armory-dedup: phone battery and firmware, carried by the row (`state.py readiness()` puts
            both on `ReadinessRow` already) but never SHOWN here before today — they lived only on the
            node card this fix now hides for a bound phone, so a rostered player's card said nothing
            about either. */}
        {g.phone_batt != null && (<><Micro>PH BATT</Micro><Val color={g.phone_batt < 20 ? T.bad : T.dim}>{g.phone_batt}%</Val></>)}
        {g.fw && (<><Micro>FIRMWARE</Micro><Val color={T.dim}>{g.fw}</Val></>)}
        <AppVerRow app_ver={g.app_ver} platform={g.platform} />
        {/* A25: the same log view as the node card, on the per-player board — this is the one the
            operator is reading before a match, and "whose log is still owed" is a per-PLAYER question. */}
        {g.log && (<><Micro>LOG</Micro><LogCell log={g.log} /></>)}
        {/* COMPANION row returns when the ESP32 rider exists — an always-empty row reads as broken (critic #25) */}
      </div>
      )}
      {/* F-armory-dedup: the LOGS button used to exist only on the node card, which is now hidden for
          this exact phone (a linked, rostered player). `PullLogButton` is never gated by LOG SYNC — see
          its own docstring — so it belongs wherever the operator is actually looking. */}
      {g.node === 'linked' && nodeId && <PullLogButton node_id={nodeId} />}
      {(() => {
        // The HEADSET OFF amber already sits in the GUN row above: once is enough on the card.
        const raw = [...(g.blockers ?? []).map(b => [b, true] as const), ...(g.ambers ?? []).filter(b => b !== GUN_FLAPPING_LINE).map(b => [b, false] as const)];
        // F155 (field 2026-09-12, ISSUE 30): a node whose last known path was the internet tunnel used
        // to read "WRONG WI-FI" the moment that tunnel dropped — sending the operator to the phone's
        // Wi-Fi settings for a fault that is entirely MC's tunnel. When we know the real reason, it
        // REPLACES any wifi-worded line rather than sitting beside it (two explanations for one fault
        // is worse than one, even a partial one).
        const items = reachReason ? [...raw.filter(([b]) => !/WI-?FI/i.test(b)), [reachReason, red] as const] : raw;
        if (items.length === 0) return null;
        return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Every message is `STATEMENT — INSTRUCTION`. As one uppercase run-on in a 248px card it
              wrapped mid-phrase and read as noise; split, the statement carries and the instruction
              sits under it quietly (field 2026-09-02). */}
          {items.map(([b, blocking]) => {
            const { head, hint } = splitBlocker(b);
            return (
              <div key={b} style={{ display: 'flex', gap: 8, padding: '7px 10px',
                background: blocking && red ? 'rgba(255,82,82,.1)' : blocking && !waiting ? 'rgba(255,176,32,.08)' : 'transparent',
                borderLeft: `2px solid ${blocking ? color : T.line2}` }}>
                <span style={{ font: F.chk(700, 11), color: blocking ? color : T.micro, flex: '0 0 auto' }}>{blocking ? (waiting ? '·' : '▲') : '·'}</span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ font: F.chk(700, 11.5), letterSpacing: '.06em', color: blocking ? color : T.micro }}>{head}</span>
                  {hint && <span style={{ font: F.chk(500, 11), letterSpacing: '.02em', color: T.micro, textTransform: 'none' }}>{sentenceCase(hint)}</span>}
                </span>
              </div>
            );
          })}
        </div>
        );
      })()}
    </div>
  );
}

function Val({ children, color }: { children: React.ReactNode; color: string }) {
  return <span style={{ font: F.chk(600, 12), letterSpacing: '.08em', color }}>{children}</span>;
}

/** A29's build chip — shared verbatim by GunCard (S38: the readiness row already carries `app_ver`/
 *  `platform`) and NodeCard, so a rostered phone's card and an unclaimed phone's card can never drift
 *  apart on how they read the same fact. `None` renders UNKNOWN rather than hiding the row — an app
 *  that predates A29 reports nothing at all, and a row that vanishes reads as "fine" (see NodeCard's
 *  own note on optional fields). */
function AppVerRow({ app_ver, platform }: { app_ver?: string | null; platform?: string | null }) {
  return (
    <>
      <Micro>APP</Micro>
      <span data-app-ver={app_ver ?? ''} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <Val color={app_ver ? T.ink : T.micro}>{verShort(app_ver) || 'UNKNOWN'}</Val>
        {app_ver?.includes('+') && (() => {
          const meta = app_ver.split('+').slice(1).join('+');
          const flag = meta.indexOf('-');
          const [sha, rest] = flag < 0 ? [meta, ''] : [meta.slice(0, flag), meta.slice(flag)];
          return (
            <span title={app_ver} style={{ font: F.mono(500, 11), color: T.faint, minWidth: 0, wordBreak: 'break-all' }}>
              +{sha}{rest && <span style={{ color: T.warn }}>{rest}</span>}
            </span>
          );
        })()}
        {platform && <span style={{ font: F.mono(500, 11), letterSpacing: '.12em', color: T.micro }}>{platform.toUpperCase()}</span>}
      </span>
    </>
  );
}


/** A connected companion phone — with or without a gun. Same card language as GunCard.
 *
 *  EVERY field here is optional on purpose, `NodeView` notwithstanding. A node that has said hello
 *  but not yet sent its first `status` has NO `arm_state`, and `n.arm_state.toUpperCase()` took the
 *  whole console down with it for the first ~300 ms of every session — the e2e walk had been
 *  sleeping past it rather than seeing it (review 2026-09-12). The skill's rule: write down what
 *  the UI does when a field is absent, because an older server or an earlier snapshot is normal. */
function NodeCard({ n, registry = [] }: { registry?: { gun_id: string; ble?: { tail?: string } }[]; n: { node_id?: string | null; gun_tail?: string | null; gun_name?: string | null; arm_state?: string | null; last_seen_ms?: number | null; player_id?: string | null; battery?: number | null; fw?: string | null; app_ver?: string | null; platform?: string | null; log?: LogView | null; preflight?: { phone_batt?: number | null } | null; stale?: boolean | null } }) {
  const { state, run, api } = useStore();
  const [name, setName] = useState('');
  const hasGun = !!n.gun_name;

  // device-first claim (Tony 2026-08-26: "first assign roster/gamers with phones/taggers" — naming
  // players then hunting guns in a tiny dropdown is backwards). The gun resolves via the registry
  // tail; an unregistered gun falls back to its tail, which the server matcher also accepts.
  const gunId = n.gun_tail ? (registry.find((r: { gun_id: string; ble?: { tail?: string } }) => (r.ble?.tail || '').toUpperCase() === n.gun_tail!.toUpperCase())?.gun_id ?? n.gun_tail) : null;
  const gunClaimed = !!gunId && (state?.players ?? []).some((pl: { gun_id?: string | null }) => (pl.gun_id || '').toUpperCase() === String(gunId).toUpperCase());
  // STANDBY (2026-09-12): a gun still worn by a PARKED player is not a stray — it used to reappear here
  // with the claim form, and claiming it created the collision PLAY then refused (review). The card says
  // who is sitting out and offers the way back instead.
  const parkedHolder = gunId ? (state?.standby ?? []).find(pl => (pl.gun_id || '').toUpperCase() === String(gunId).toUpperCase()) : undefined;
  const [claiming, setClaiming] = useState(false);
  // F-armory-claim (2026-09-16): the card used to send `team_id: 'blue'|'yellow'`, which the server
  // refuses outright in FFA (only `ffa` exists there) -- the error landed in the shared strip, the
  // card looked unchanged, and the operator read that as "nothing happened". A gamertag claim never
  // needs a team: the server auto-balances one when it is omitted (state.py add_player), and a team
  // swap stays a LOBBY job. `claimErr` shows a refusal ON THIS CARD, not only in the shared strip --
  // the inner try/catch grabs the message before `run` swallows it into the shared error state.
  const [claimErr, setClaimErr] = useState<string | null>(null);
  const claim = async () => {
    const display = name.trim();
    if (!display || !gunId || claiming) return;
    setClaiming(true);
    setClaimErr(null);
    try {
      const ok = await run(async () => {
        try { return await api.addPlayer({ display, gun_id: gunId }); }
        catch (e) { setClaimErr((e as Error).message); throw e; }
      });
      if (ok) setName('');
    } finally { setClaiming(false); }
  };
  // 2026-09-19: `n.stale` is the server's own STALE_AFTER_MS judgement (state.py `snapshot()`), not a
  // threshold re-derived here from `last_seen_ms` -- this card used to have NONE (a phone whose storage
  // was cleared and rejoined under a new node_id kept reading LINKED/KITTED here, green, for as long as
  // the old node_id's record survived). A stale card is OFFLINE: `arm_state`, battery and firmware are
  // last-known facts, not current ones, and the claim form is withdrawn — there is nobody to push a
  // claim to.
  const stale = !!n.stale;
  const accent = stale ? T.micro : hasGun ? T.acc : T.warn;
  const age = n.last_seen_ms ?? 0;
  return (
    <div data-node-card={n.node_id ?? '?'} data-node-stale={stale ? '1' : '0'} style={{ background: T.panel, border: `1px solid ${T.line}`, borderLeft: `3px solid ${accent}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 11, clipPath: CHAMFER.tr12, opacity: stale ? 0.7 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ font: F.osw(700, 18), letterSpacing: '.08em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hasGun ? n.gun_name : 'NO GUN SET'}</span>
        <Tag color={accent}>{stale ? 'OFFLINE' : (n.arm_state ?? 'unknown').toUpperCase()}</Tag>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '82px 1fr', gap: '6px 10px', alignItems: 'center' }}>
        <Micro>PHONE</Micro><Val color={T.dim}>{(n.node_id ?? '—').slice(0, 12)}</Val>
        <Micro>LINK</Micro><Val color={stale ? T.warn : T.dim}>{fmtAge(age)} AGO{stale && ' — OFFLINE'}</Val>
        {!stale && n.preflight?.phone_batt != null && (<><Micro>PH BATT</Micro><Val color={n.preflight.phone_batt < 20 ? T.bad : T.dim}>{n.preflight.phone_batt}%</Val></>)}
        {!stale && n.battery != null && (<><Micro>GUN BATT</Micro><Val color={T.dim}>{n.battery}%</Val></>)}
        {!stale && n.fw && (<><Micro>FIRMWARE</Micro><Val color={T.dim}>{n.fw}</Val></>)}
        {/* A29: always rendered, even when the phone has not said — "UNKNOWN" is the answer the
            operator needs (an app that predates A29 reports nothing at all), and a row that simply
            vanishes reads as "fine". The chip itself, sha/`-dirty`/platform and all, is `AppVerRow` —
            shared with GunCard so a bound phone's card cannot say something different. */}
        <AppVerRow app_ver={n.app_ver} platform={n.platform} />
        <Micro>LOG</Micro><LogCell log={n.log ?? undefined} />
      </div>
      {/* A25: always asks, whatever `log_sync` is set to — `reason: "manual"` is never gated. */}
      <PullLogButton node_id={n.node_id ?? ''} />
      {!stale && !hasGun && <div style={{ font: F.mono(500, 11), letterSpacing: '.1em', color: T.warn }}>▲ WAITING FOR ITS GUN — SET IT ON THE PHONE</div>}
      {/* 2026-09-19: no claim, no standby offer, nothing to act on -- there is no live socket to push a
          claim to, and a claim made now would sit unacknowledged exactly like the assign this same fix
          refuses on a stale station. */}
      {stale && <div style={{ font: F.mono(500, 11), letterSpacing: '.1em', color: T.micro }}>NOT HEARD FROM RECENTLY — WAITING TO RECONNECT</div>}
      {!stale && hasGun && !n.player_id && parkedHolder && (
        <div data-standby-holder={parkedHolder.player_id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderTop: `1px solid ${T.line2}`, paddingTop: 10 }}>
          <span style={{ flex: 1, minWidth: 0, font: F.chk(700, 11), letterSpacing: '.16em', color: T.micro }}>ON STANDBY · {parkedHolder.display}</span>
          {standDownLocked(state?.phase)
            ? <span style={{ font: F.chk(700, 11), letterSpacing: '.14em', color: T.micro }}>MATCH LIVE</span>
            : <PlayButton p={parkedHolder} />}
        </div>
      )}
      {!stale && hasGun && !n.player_id && !gunClaimed && !parkedHolder && (
        <form onSubmit={e => { e.preventDefault(); claim(); }} style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: `1px solid ${T.line2}`, paddingTop: 10 }}>
          <div style={{ font: F.chk(700, 11), letterSpacing: '.2em', color: T.acc }}>▸ WHO CARRIES THIS?</div>
          <input value={name} onChange={e => { setName(e.target.value); setClaimErr(null); }} placeholder="GAMERTAG" maxLength={24} aria-label={`gamertag for ${n.gun_name}`}
            style={{ background: T.panelDeep, border: `1px solid ${T.line2}`, color: T.ink, font: F.osw(600, 15), letterSpacing: '.06em', padding: '9px 12px', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
          <button type="submit" disabled={!name.trim() || claiming}
            style={{ padding: '10px 0', background: T.panelDeep, color: name.trim() ? T.acc : T.micro, border: `1px solid ${name.trim() ? T.acc : T.line2}`, font: F.chk(700, 11), letterSpacing: '.2em', cursor: name.trim() ? 'pointer' : 'default' }}>
            {claiming ? 'SETTING…' : 'SET GAMERTAG'}
          </button>
          {/* the operator's team stays a LOBBY decision; the server auto-balances a new claim */}
          {claimErr && <div role="alert" data-claim-error={n.node_id ?? ''} style={{ font: F.chk(700, 11), letterSpacing: '.05em', color: T.warn, textTransform: 'none' }}>▲ {claimErr.toUpperCase()}</div>}
        </form>
      )}
    </div>
  );
}

/** A25 — the operator's LOGS button.
 *
 *  `ok` is whether the ASK went out, NOT whether a log arrived: MC never waits on the node. So the
 *  answer on screen has to say exactly that much and no more. `ok: false` is MC refusing to ask at all
 *  (a utility phone, a node past the ~1 MB budget, no socket) and must look different from a successful
 *  ask, or the button answers "nothing happened" and "done" the same way — the F40 shape. */
function PullLogButton({ node_id }: { node_id: string }) {
  const { api, run } = useStore();
  const [busy, setBusy] = useState(false);
  if (!node_id) return null;
  return (
    <button type="button" data-pull-log={node_id} disabled={busy}
      title="Ask this phone for its match log now. Never gated by LOG SYNC — the phone still answers when it is safe to."
      onClick={async () => {
        setBusy(true);
        try {
          const r = await run(() => api.pullLog(node_id));
          if (r) setNotice(r.ok ? 'ASKED FOR THE LOG — THE PHONE ANSWERS WHEN IT CAN'
                                : 'COULD NOT ASK FOR THE LOG — THE PHONE IS OFF THE NET, OR PAST ITS UPLOAD BUDGET', !r.ok);
        } finally { setBusy(false); }
      }}
      style={{ alignSelf: 'flex-start', font: F.chk(700, 11), letterSpacing: '.18em', padding: '9px 14px', minHeight: 36,
               background: 'transparent', border: `1px solid ${T.line2}`, color: busy ? T.micro : T.dim,
               cursor: busy ? 'default' : 'pointer' }}>
      {busy ? 'ASKING…' : '⬇ LOGS'}
    </button>
  );
}

/** A registry gun nobody can see right now. */
function GhostCard({ r }: { r: { gun_id: string; sticker: string; ble: { tail?: string } } }) {
  return (
    <div style={{ background: T.panelAlt, border: `1px dashed ${T.line2}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 8, opacity: .75 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ font: F.osw(700, 18), letterSpacing: '.08em', color: T.dim }}>{r.sticker}{r.ble?.tail ? <span style={{ font: F.mono(500, 11), color: T.micro }}>-{r.ble.tail}</span> : null}</span>
        <Tag color={T.micro}>OFFLINE</Tag>
      </div>
      <div style={{ font: F.mono(500, 11), letterSpacing: '.1em', color: T.micro }}>IN THE REGISTRY — POWER IT UP AND SCAN</div>
    </div>
  );
}


/** The join QR is step zero of muster — it earns a real panel, not a status-bar popover (critic #7). */
function JoinPanel() {
  const { state } = useStore();
  const [url, setUrl] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const qr = state?.lan.qr;
  const pub = state?.lan.public;   // A28.1 — absent on a server that predates backhaul
  // routable, not merely truthy: `lan.ip` falls back to 127.0.0.1, and a QR for loopback sends the
  // operator's phone to its own browser (review 2026-09-01)
  const apkUrl = isRoutableLanIp(state?.lan.ip) ? `http://${state!.lan.ip}:${state!.lan.port || 8765}/openbrx.apk` : '';
  const [apkQr, setApkQr] = useState<string | null>(null);
  useEffect(() => {
    if (!apkUrl) return;
    QRCode.toDataURL(apkUrl, { margin: 2, width: 300, errorCorrectionLevel: 'M', color: { dark: '#0b0e13', light: '#ffffff' } }).then(setApkQr).catch(() => setApkQr(null));
  }, [apkUrl]);
  useEffect(() => {
    if (!qr) return;
    QRCode.toDataURL(qr, { margin: 2, width: 480, errorCorrectionLevel: 'M', color: { dark: '#0b0e13', light: '#ffffff' } }).then(setUrl).catch(() => setUrl(null));
  }, [qr]);
  if (!qr) return null;
  return (
    <div style={{ flex: '1 1 320px', maxWidth: 380, background: `linear-gradient(180deg,${T.panelSoft},${T.panelDeep})`, border: `1px solid ${T.line}`, borderTop: `2px solid ${T.acc}`, padding: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div style={{ alignSelf: 'stretch', font: F.chk(700, 11), letterSpacing: '.28em', color: T.acc }}>▸ JOIN THE NET</div>
      {/* M11 (visual QA 2026-09-23): "find MC automatically" sat beside the "cannot reach" note. The claim
          is made only when MC has no reason to doubt its own address. */}
      <div data-testid="join-hint" style={{ font: F.mono(500, 11), letterSpacing: '.1em', color: T.dim, textAlign: 'center', lineHeight: 1.8 }}>
        {state?.lan.warning
          ? <>PHONES WILL <span style={{ color: T.ink }}>NOT</span> FIND MC ON THIS WI-FI UNTIL THE ADDRESS NOTE AT THE TOP IS FIXED{pub?.status === 'up' ? ' — THE INTERNET JOIN IN THE QR STILL WORKS' : ''}</>
          : !isRoutableLanIp(state?.lan.ip)
            ? <>MC IS NOT ON A NETWORK PHONES CAN REACH, SO PHONES WILL <span style={{ color: T.ink }}>NOT</span> FIND IT ON THEIR OWN</>
            : <>PHONES ON THIS WI-FI FIND MC <span style={{ color: T.ink }}>AUTOMATICALLY</span> — OPEN BRX COMPANION AND WAIT A BEAT</>}
      </div>
      <div style={{ font: F.mono(600, 12), letterSpacing: '.04em', color: T.ink, textAlign: 'center', wordBreak: 'break-all' }}>{state?.lan.ws_url}</div>
      <button onClick={() => setShowQr(v => !v)} style={{ minHeight: 36,  alignSelf: 'stretch', background: showQr ? T.panelAlt : 'transparent', border: `1px solid ${T.line2}`, color: T.dim, font: F.chk(700, 11), letterSpacing: '.2em', padding: '9px 0', cursor: 'pointer' }}>
        {showQr ? '▴ HIDE QR CODES' : '▾ SHOW QR CODES'}
      </button>
      {showQr && <>
        <div style={{ font: F.chk(700, 11), letterSpacing: '.22em', color: T.dim }}>JOIN — TAP SCAN QR IN THE APP</div>
        {/* F138 (field 2026-09-12): the QR now carries the LAN url + secret + the url-encoded public
            url once the tunnel is up — ~140 characters, a denser code than before, and 200px was hard
            for an older phone camera to lock onto. At least 280px on desktop, and full width up to
            that on a phone screen; the hint says what an operator has never needed to be told before. */}
        {/* the QR itself (not the white card around it) is the ≥280px target — box-sizing:border-box
            on a 280px card with 10px padding left only 260px for the image (caught in the browser
            verification pass 2026-09-12), so the card is 20px WIDER than the image it holds. */}
        {url && (
          <div style={{ width: 'min(300px, 100%)', background: '#ffffff', padding: 10, lineHeight: 0, boxShadow: `0 0 0 1px ${T.line}, 0 8px 24px rgba(0,0,0,.45)`, boxSizing: 'border-box' }}>
            <img src={url} width={280} height={280} alt="node join QR" style={{ display: 'block', width: '100%', height: 'auto', imageRendering: 'pixelated' }} />
          </div>
        )}
        {url && (
          <div style={{ font: F.mono(500, 11), letterSpacing: '.1em', color: T.micro, textAlign: 'center' }}>
            HOLD THE PHONE 20–30 CM AWAY
          </div>
        )}
        {url && (
          <div style={{ font: F.mono(500, 11), letterSpacing: '.1em', color: T.micro, textAlign: 'center' }}>
            {pub?.status === 'up' ? 'CARRIES THE LAN + INTERNET JOIN' : 'CARRIES THE LAN JOIN ONLY'}
          </div>
        )}
        {/* no lan.ip means no download URL to print and no QR to scan — the header alone told the
            operator to point a camera at nothing (polish-loop deferred low) */}
        {apkUrl ? (
          <div style={{ alignSelf: 'stretch', borderTop: `1px solid ${T.line2}`, paddingTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{ font: F.chk(700, 11), letterSpacing: '.22em', color: T.dim }}>NO APP YET? PHONE CAMERA HERE</div>
            {apkQr && <div style={{ background: '#ffffff', padding: 8, lineHeight: 0, boxShadow: `0 0 0 1px ${T.line}` }}><img src={apkQr} width={132} height={132} alt="apk download QR" style={{ display: 'block', imageRendering: 'pixelated' }} /></div>}
            <div style={{ font: F.mono(500, 11), letterSpacing: '.02em', color: T.micro, wordBreak: 'break-all', textAlign: 'center' }}>{apkUrl}</div>
          </div>
        ) : (
          <div style={{ alignSelf: 'stretch', borderTop: `1px solid ${T.line2}`, paddingTop: 12, font: F.mono(500, 11), letterSpacing: '.1em', color: T.micro, textAlign: 'center' }}>
            NO LAN ADDRESS ({state?.lan.ip || '—'}) — MC IS NOT ON A NETWORK PHONES CAN REACH.
            {' '}JOIN THE FIELD WI-FI AND RESTART MC; SIDELOAD THE APK BY CABLE MEANWHILE.
          </div>
        )}
      </>}
      <ReachBlock />
    </div>
  );
}

function hostnameOf(url: string | null | undefined): string {
  if (!url) return '';
  try { return new URL(url).hostname; } catch { return url; }
}

/** A28 — the phone's own data path to MC when the field Wi-Fi can't reach it. Opt-in and additive:
 *  the control is always SHOWN, never hidden, even when it cannot be used (F70-style: a missing
 *  capability is named, not swallowed). */
function ReachBlock() {
  const { state, run, api } = useStore();
  const [busy, setBusy] = useState(false);
  // 27b (field 2026-09-12, ISSUE 27b): turning the tunnel off — or a restart, which is the same
  // action from a phone's point of view — orphans every phone on the internet path with no way back
  // in but a rescan (a quick tunnel's hostname changes every time). That cost the field 4+ minutes of
  // "why did everyone stop working" before. A two-step confirm, in the console's own style, buys one
  // more look before it happens.
  const [confirmOff, setConfirmOff] = useState(false);
  if (!state) return null;
  const lan = state.lan;
  const pub = lan.public;
  const supported = pub !== undefined;
  const status: TunnelStatus = pub?.status ?? 'off';
  const available = pub?.available ?? false;
  const manual = pub?.provider === 'manual';
  const turningOn = status === 'off' || status === 'error';
  const busyOrPending = busy || status === 'starting';
  const toggle = async () => {
    if (!turningOn && !confirmOff) { setConfirmOff(true); return; }   // arm the warning, do nothing yet
    setConfirmOff(false);
    setBusy(true); try { await run(() => api.setTunnel(turningOn)); } finally { setBusy(false); }
  };
  const statusColor = status === 'up' ? T.ok : status === 'error' ? T.bad : status === 'starting' ? T.warn : T.micro;
  const statusText = status === 'up' ? `UP ${hostnameOf(pub?.ws_url) || pub?.ws_url}`
    // field 2026-09-12 (ISSUE 7): cloudflared's own "up" line is premature for OTHER people's DNS
    // resolvers — `detail` carries whatever the server is doing while the hostname is still resolving.
    : status === 'starting' ? (pub?.detail || 'STARTING…')
    : status === 'error' ? `ERROR ${pub?.error ?? ''}`.trim()
    : 'OFF';
  return (
    <div style={{ alignSelf: 'stretch', borderTop: `1px solid ${T.line2}`, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ font: F.chk(700, 11), letterSpacing: '.28em', color: T.acc }}>▸ REACH</div>
      <div style={{ display: 'grid', gridTemplateColumns: '76px 1fr', gap: '6px 10px', alignItems: 'center', width: '100%' }}>
        <span style={{ font: F.mono(500, 11), letterSpacing: '.1em', color: T.micro }}>NETWORK</span>
        {/* F143 (field 2026-09-12, ISSUE 12): no platform ever told router from hotspot apart, so this
            fell back to printing the MODE WORD ("UNKNOWN") as if it were the network's name. `ssid` is
            `null`/absent, never the string "unknown", when it genuinely could not be read — the
            fallback is now always the generic "LAN", never a mode name standing in for one. */}
        <span style={{ font: F.chk(600, 12), color: T.ink, wordBreak: 'break-word' }}>{lan.ssid || 'LAN'} · {lan.ip ? `${lan.ip}:${lan.port}` : '—'}</span>
        <span style={{ font: F.mono(500, 11), letterSpacing: '.1em', color: T.micro }}>INTERNET</span>
        <span style={{ font: F.chk(700, 11), color: statusColor, wordBreak: 'break-word' }}>{statusText}</span>
      </div>
      {!supported && (
        <div style={{ font: F.mono(500, 11), letterSpacing: '.1em', color: T.warn, lineHeight: 1.6 }}>
          ▲ THIS MC SERVER PREDATES BACKHAUL — restart it to get an internet join option
        </div>
      )}
      {supported && !available && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button type="button" disabled title="cloudflared was not found on this machine's PATH"
            style={{ alignSelf: 'flex-start', minHeight: 36, background: 'transparent', border: `1px solid ${T.line2}`, color: T.micro,
                     font: F.chk(700, 11), letterSpacing: '.2em', padding: '8px 16px', cursor: 'not-allowed' }}>TURN ON</button>
          <div style={{ font: F.mono(500, 11), letterSpacing: '.05em', color: T.micro, lineHeight: 1.7 }}>
            INSTALL CLOUDFLARED — mac: <span style={{ color: T.dim }}>brew install cloudflared</span>
            {' '}· windows: <span style={{ color: T.dim }}>winget install Cloudflare.cloudflared</span>
            {' '}· linux: <span style={{ color: T.dim }}>apt install cloudflared</span>
          </div>
        </div>
      )}
      {supported && available && manual && (
        <div style={{ font: F.mono(500, 11), letterSpacing: '.08em', color: T.micro, lineHeight: 1.6 }}>
          SET BY --public-url ON THE MC COMMAND LINE — not MC's to turn off from here.
        </div>
      )}
      {supported && available && !manual && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {confirmOff && !turningOn && (
            <div role="alert" style={{ font: F.chk(700, 11), letterSpacing: '.08em', color: T.warn, lineHeight: 1.6 }}>
              ▲ EVERY PHONE ON THE INTERNET PATH WILL DROP AND MUST RESCAN THE QR. TURN OFF?
            </div>
          )}
          <button type="button" onClick={toggle} disabled={busyOrPending} className={busyOrPending ? undefined : (confirmOff ? 'hov-warnbg' : 'hov-acc')}
            style={{ alignSelf: 'flex-start', minHeight: 36, background: confirmOff ? 'rgba(255,176,32,.12)' : 'transparent',
                     border: `1px solid ${confirmOff ? T.warn : T.line2}`,
                     color: busyOrPending ? T.micro : confirmOff ? T.warn : T.dim, font: F.chk(700, 11), letterSpacing: '.2em', padding: '8px 16px',
                     cursor: busyOrPending ? 'not-allowed' : 'pointer' }}>
            {status === 'starting' ? 'STARTING…' : turningOn ? 'TURN ON' : confirmOff ? 'CONFIRM — TURN OFF' : 'TURN OFF'}
          </button>
          {/* A28.2: `welcome.join`/MC→node `join` push this to phones that joined over the LAN before
              the tunnel existed — nothing on their end needs to change for them to pick it up. */}
          <div style={{ font: F.mono(500, 11), letterSpacing: '.05em', color: T.micro, lineHeight: 1.6 }}>
            PHONES ALREADY JOINED PICK THIS UP AUTOMATICALLY. NEW PHONES SCAN THE QR.
          </div>
        </div>
      )}
    </div>
  );
}
