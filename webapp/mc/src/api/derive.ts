// Small pure helpers derived FROM the server's shapes — not part of the wire contract.
//
// `types.ts` is the contract (the wire shapes generated from `mcp/brx_mcp/mc/types.py`, the view
// shapes mirroring `mc/API.md`), so UI policy does not belong in it (review 2026-09-01). Nothing here
// talks to the network; everything is a pure function of `State`.
import type { EndDeliveryView, NodeView, State } from './types';
import { fmtAge } from '../tokens';
/** A stable fingerprint of "which guns does MC know about right now".
 *
 *  For effects that must refetch the armory when the fleet CHANGES. Never key such an effect on
 *  `readiness.t`: that is `now_ms()` stamped on every snapshot (`state.py` `readiness()`) and the
 *  broadcaster pushes up to 4 snapshots a second, so it refetches ~4x/s for as long as the screen is
 *  open — the same storm the RECAP history picker had, measured again here on 2026-09-01.
 */
export function registrySig(state: State | null): string {
  const r = state?.readiness;
  if (!r) return '';
  return [
    (r.board ?? []).map(b => `${b.gun_id ?? ''}:${b.sticker ?? ''}`).join(','),
    (r.unclaimed ?? []).map(u => u.tail ?? '').join(','),
    (state?.nodes ?? []).map(n => n.gun_tail ?? '').join(','),
  ].join('|');
}

/** Is this an address a PHONE on the field LAN could actually reach?
 *
 *  `lan.ip` is never empty — `__main__._lan_ip()` falls back to `127.0.0.1` and the Session default
 *  is `0.0.0.0` — so a truthiness check passes while MC hands out a QR for an address no phone can
 *  reach. Review 2026-09-01: the "no LAN address" branch was dead code for exactly that reason.
 */
export function isRoutableLanIp(ip: string | undefined | null): boolean {
  const v = (ip ?? '').trim();
  if (!v) return false;
  if (v === '0.0.0.0' || v === '::' || v === '::1') return false;
  return !/^127\./.test(v);
}

/** A28.3 — LAN is the honest default: a node that has never reported a `reach` (an older server, or
 *  the first status has not landed yet) is never shown as BACKHAUL it hasn't earned. */
export function reachOf(n: Pick<NodeView, 'reach'> | undefined | null): 'lan' | 'backhaul' {
  return n?.reach === 'backhaul' ? 'backhaul' : 'lan';
}

/** S40 (field 2026-09-12) — "BACKHAUL" read as "on cellular" to an operator, when what it actually
 *  means is WHICH PATH reached Mission Control. The REACH block already says INTERNET; every other
 *  tag now says the same thing. Render this word, never `reach.toUpperCase()` directly. */
export const reachLabel = (reach: 'lan' | 'backhaul'): 'LAN' | 'INTERNET' => (reach === 'backhaul' ? 'INTERNET' : 'LAN');
/** The tooltip is the PATH TO MC, never a claim about the phone's own radio (a phone on the internet
 *  path may still have Wi-Fi on; this says nothing about that). */
export const reachTooltip = (reach: 'lan' | 'backhaul'): string =>
  reach === 'backhaul' ? 'Reached Mission Control through the internet tunnel.' : 'Reached Mission Control over the field Wi-Fi.';

/** A28.4 — the one-line coverage readout, or null when there is nothing to say yet (no bound player
 *  node this session). `bound` is the true denominator even while the tunnel is off — the count is
 *  what should read as unearned, not the sentence. */
export function coverageLine(state: State | null): string | null {
  const c = state?.coverage;
  if (!c || c.bound === 0) return null;
  return c.level === 'full'
    ? `FULL COVERAGE — ${c.on_backhaul} OF ${c.bound} ON THE INTERNET PATH`
    : `COVERAGE ZONES — ${c.on_backhaul} OF ${c.bound} ON THE INTERNET PATH`;
}

/** F155 (field 2026-09-12, ISSUE 30) — a node whose last known path was the internet tunnel reads
 *  "WRONG WI-FI" today when that tunnel drops, which sends the operator chasing the phone's Wi-Fi
 *  settings for a fault that is entirely MC's tunnel. `NodeView.last_reach` survives the disconnect
 *  (`reach` itself is cleared), so the console can say the true reason instead. Returns null when the
 *  node's last path was LAN (or unknown) — that case keeps whatever the server's own wording says. */
export function staleReachReason(n: Pick<NodeView, 'reach' | 'last_reach' | 'last_seen_ms'> | undefined | null, tunnelStatus?: 'off' | 'starting' | 'up' | 'error'): string | null {
  // `reach` present means the node is CURRENTLY connected — this must say nothing about a fault it
  // does not have. Only a node that HAD `reach === 'backhaul'` and has since dropped it (this fired
  // once for every currently-connected backhaul node too, a bug caught in the browser verification
  // pass 2026-09-12) gets the honest "not reached" reading.
  if (n?.reach || n?.last_reach !== 'backhaul') return null;
  const base = `NOT REACHED FOR ${fmtAge(n.last_seen_ms ?? 0).toUpperCase()}`;
  return tunnelStatus === 'error' ? `${base} — TUNNEL DOWN` : base;
}

/** A37 — the three A36 blockers whose CURE IS THE PUSH ITSELF. Mirrors `state.py`'s
 *  `_STALE_ACK_FAULT` / `_ECHO_FAULT` / `_POOL_FAULT`, and `config-proof.test.tsx` reads those three
 *  constants out of `state.py` and pins them to this array — a paraphrase here would quietly re-open
 *  the gate this closes.
 *
 *  R2-2 (polish loop iteration 2, 2026-09-13): the server stopped refusing the push on these rows
 *  (A37) and the CONSOLE went on disabling PUSH CONFIG and CONTINUE for them, so the only route past
 *  a stale ack was the "Push anyway" force — the operator overriding a judgement the board had just
 *  told them to CLEAR, which is the opposite of what `force` is for. */
/** A42 — ONE sentence about end delivery, so LIVE and RECAP cannot say it two different ways.
 *
 *  Both halves are the answer the operator asked for: a clean end says ALL N HUDS CONFIRMED (that is the
 *  thing that was missing), and an unconfirmed one NAMES the phones and, once MC has stopped re-delivering,
 *  says what only a person can do about it. It is a fact about DELIVERY — never about how anyone played —
 *  so nothing here may read as a score, and neither screen may render it inside the board.
 *
 *  `null` when the server sent nothing (an older MC, or no match has ended yet): render nothing at all
 *  rather than invent a state for a field that is not there. */
export function endDeliveryLine(ed: EndDeliveryView | null | undefined): { ok: boolean; text: string } | null {
  if (!ed || !ed.total) return null;
  const n = ed.unconfirmed.length;
  if (!n) return { ok: true, text: `ALL ${ed.total} HUD${ed.total === 1 ? '' : 'S'} CONFIRMED THE END` };
  const who = ed.unconfirmed.map(u => u.display).join(', ');
  const head = `${n} OF ${ed.total} HUD${ed.total === 1 ? '' : 'S'} ${n === 1 ? 'HAS' : 'HAVE'} NOT CONFIRMED THE END (${who})`;
  if (ed.retrying) return { ok: false, text: `${head} — RE-DELIVERING` };
  // The tries are the server's own count, never a number this file knows: the ladder is `state.py`'s.
  const tries = Math.max(...ed.unconfirmed.map(u => u.tries), 0);
  return { ok: false, text: `${head} — TOLD ${tries} TIMES, STILL NOTHING. THAT TAGGER MAY STILL BE IN THE MATCH: END IT ON THE GUN` };
}

/** The readiness amber `state.py readiness()` writes while the phone reports `preflight.gun_flapping`
 *  (`GUN_FLAPPING_LINE` there). The Armory card shows it in the GUN row, so it drops the list copy. */
export const GUN_FLAPPING_LINE = 'HEADSET OFF (GUN KEEPS DROPPING THE LINK)';
export const PUSH_CURES = ['ACKED AN OLDER CONFIG', 'GUN ECHO ≠ CONFIG', 'GUN POOL ≠ CONFIG'] as const;

/** The stale ack alone — the one blocker the rail's own sentence already accounts for by name. */
export const STALE_ACK_FAULT = PUSH_CURES[0];

/** Is this one blocker cured by a re-push? (`state.py cured_by_push`.) */
export const curedByPush = (blocker: string): boolean => PUSH_CURES.some(p => blocker.startsWith(p));

/** Does this RED row carry anything a re-push would clear? (`some`, deliberately, not `every`.)
 *
 *  F1 (polish loop iteration 3, 2026-09-13): both screens asked whether EVERY blocker on the row was
 *  push-cured, which is a different and much narrower question. A gun with an echo mismatch (or a
 *  stale ack) plus any second red — GUN LINK LOST, IDENTITY REVERTED, a version blocker — fell out of
 *  that filter, and an echo mismatch leaves the ack CURRENT, so `all_acked` was true as well: the
 *  RE-PUSH button disappeared from the one board that names RE-PUSH three times, the disabled ARM
 *  carried an EMPTY title, and the host override then threw a force-proof refusal naming a control
 *  that was not on screen. Whether a row ALSO needs something else done to it is the push gate's
 *  question (`blocksPush`), not this one's. */
export const curedByPushRow = (row: { blockers?: string[] | null }): boolean =>
  (row.blockers ?? []).some(curedByPush);

/** Does this readiness row REFUSE A PUSH? (`state.py push_config._blocks_push`, exactly.)
 *
 *  A `red` refuses only when it carries at least one blocker a push cannot cure. A `waiting` row — a
 *  phone that has not arrived — refuses the FIRST push and not a re-push (F3, matching the server's
 *  `is_repush`): nothing reaches a phone that is not there yet, but `_repush_lobby_config` compiles
 *  for the WHOLE roster and `_hydrate` hands that bundle over on the phone's hello, so the head is
 *  delivered. Counting it made the ordinary re-push render as the forcing variant, "RE-PUSH CONFIG
 *  OVER 1 BLOCKED", because one operator had not switched their phone on yet.
 *
 *  Every OTHER gate (START, the host override's own copy) still reads the plain red/waiting counts:
 *  a re-push replaces the head, it does not switch a gun on. */
export function blocksPush(row: { status?: string; blockers?: string[] | null }, opts?: { repush?: boolean }): boolean {
  if (row.status === 'waiting') return !opts?.repush;
  return row.status === 'red' && (row.blockers ?? []).some(b => !curedByPush(b));
}

/** The name of the control that cures A36's three proofs, spelled ONCE (F8a). Every server blocker
 *  line, every disabled title and the LOBBY rail's stale-ack sentence point at the same words, and
 *  those words are the button's. GAMES carries an identically-labelled RE-PUSH CONFIG since the LOAD
 *  work (2026-09-13), so the instruction names a control on whichever screen the operator is on. */
export const RE_PUSH_HERE = 'RE-PUSH CONFIG on LOBBY';

/** The local fallback for a server too old to send `readiness.roster_faults` — the SERVER's sentence
 *  wherever the server has one. */
export const LOCAL_ONE_TEAM_FAULT =
  'ONLY ONE SIDE HAS PLAYERS — a match fought on one side cannot register a hit; move players between teams';

/** Everything the console knows about "may this config be sent to the guns, and did it land".
 *
 *  ONE implementation, because there are now two screens that ask it: LOBBY's PUSH CONFIG & ARM /
 *  RE-PUSH CONFIG rail, and GAMES's LOAD (2026-09-13 — Tony: "instead of continue it should be Load.
 *  Load pushes that config to phones"). A second copy of these predicates is how the console ends up
 *  refusing something the server allows, or offering something the server refuses, on one of the two
 *  screens only — the F151/R2-2 failure exactly. Pure: a function of the snapshot, nothing else. */
export interface PushGate {
  /** a head has been sent at least once (`state.py lobby_pushed`) — so any further push is a RE-push */
  pushed: boolean;
  /** acks that are CURRENT for `config.config_id` (A36: an older ack proves nothing) */
  acked: number;
  total: number;
  /** the SERVER's own `all_acked` wherever it is present; the count is the fallback for an older MC */
  allAcked: boolean;
  /** the unplayable roster (`state.py one_team_fault`). `force` does NOT open this one. */
  rosterFault: string | null;
  /** displays of the guns that answered — for the game BEFORE this one */
  staleAcked: string[];
  /** displays of the guns that have not echoed at all */
  noEcho: string[];
  /** the stale-ack sentence, naming the guns and the control that cures them ('' when there are none) */
  staleAckLine: string;
  redRows: State['readiness']['board'];
  waitRows: State['readiness']['board'];
  /** red rows carrying anything a re-push would clear (F1: `some`, not `every`) */
  curableRows: State['readiness']['board'];
  /** START's gate: every red and every phone that has not arrived */
  blockedCount: number;
  /** THIS push's gate (`state.py push_config._blocks_push`, repush-aware) */
  pushBlockedCount: number;
  /** "Waiting for 2 phones: DRIFT, SABLE" ('' when none) */
  waitWhy: string;
  /** would a push be refused outright, with nothing `force` could do about it? */
  refused: boolean;
  /** why a push is refused, or what `force` would be overriding ('' when the way is clear) */
  pushWhy: string;
}

export function pushGate(state: State): PushGate {
  const { players, lobby, config } = state;
  // An older MC sends NO `readiness` at all. `types.ts` declares it REQUIRED, so nothing ever forced a
  // guard here -- and while LOBBY was the only caller that was survivable, because an old server does
  // not land you on LOBBY. Since GAMES and the KIT editor started reading this same gate (2026-09-13),
  // a missing tally became a THROW on the KIT RENDER PATH, which `kit-continue.mjs` pins: "readiness
  // is the SERVER's tally; the gate counts the roster's own ready flags, so stripping it must change
  // nothing."
  // `roster_faults` is deliberately left UNDEFINED here rather than defaulted to []: `serverKnows`
  // below reads the DIFFERENCE between "the server says this roster is fine" and "the server never
  // said", and an empty array would silently switch the local one-team fallback off for precisely the
  // old servers that still need it.
  const readiness = (state.readiness ?? {}) as State['readiness'];
  const rows = readiness.board ?? [];
  // A36: an ack for a PREVIOUS config is not an ack for this one — the server refuses the whistle on
  // it, `force` included. `config_id` absent = an older server that never sent one; fall back to `ok`
  // rather than reading every ack as stale.
  const ackIsCurrent = (a: { ok: boolean; config_id?: string }) =>
    a.ok && (a.config_id === undefined || a.config_id === config.config_id);
  const acked = Object.values(lobby.acks).filter(ackIsCurrent).length;
  const nameOf = (id: string) => players.find(p => p.player_id === id)?.display ?? id;
  const noEcho = Object.entries(lobby.acks).filter(([, a]) => !a.ok).map(([id]) => nameOf(id));
  const staleAcked = Object.entries(lobby.acks).filter(([, a]) => a.ok && !ackIsCurrent(a)).map(([id]) => nameOf(id));
  const staleAckLine = staleAcked.length ? `${staleAcked.join(', ')} still answering for an older config — ${RE_PUSH_HERE}` : '';
  // A36/C-5: the SERVER's own answer wins wherever it is present — `all_acked` walks the roster the
  // way `start()` does (it skips a player with no node bound, which a local count cannot).
  const allAcked = lobby.pushed && (lobby.all_acked ?? (acked === players.length));
  // FIELD-3: the local one-side rule is a FALLBACK FOR AN OLDER SERVER, so it runs only when the
  // field is ABSENT — a present-but-empty `roster_faults` is the server saying this roster is fine.
  const teamIds = config.mode === 'ffa' ? ['ffa'] : config.teams.map(t => t.team_id);
  const teamsMode = config.mode !== 'ffa' && teamIds.length > 1;
  const serverKnows = readiness.roster_faults !== undefined;
  const oneSideLocally = teamsMode && players.length > 1
    && new Set(config.teams.filter(t => players.some(p => p.team_id === t.team_id)).map(t => t.tid)).size < 2;
  const rosterFault = (readiness.roster_faults ?? [])[0] ?? (!serverKnows && oneSideLocally ? LOCAL_ONE_TEAM_FAULT : null);

  const redRows = rows.filter(b => b.status === 'red');
  const waitRows = rows.filter(b => b.status === 'waiting');
  const curableRows = redRows.filter(curedByPushRow);
  const blockedCount = redRows.length + waitRows.length;
  const pushBlockedCount = rows.filter(r => blocksPush(r, { repush: lobby.pushed })).length;
  const waitWhy = waitRows.length
    ? `Waiting for ${waitRows.length} phone${waitRows.length === 1 ? '' : 's'}: ${waitRows.map(b => b.sticker).join(', ')}`
    : '';
  // A push with nobody on the roster is refused by the server before anything else, and `force` does
  // not bypass it either (`state.py push_config`: "no players — add someone to the roster first").
  const refused = !!rosterFault || players.length === 0;
  const pushWhy = [
    rosterFault ?? '',
    players.length === 0 ? 'Add someone to the roster first' : '',
    pushBlockedCount > 0
      ? rows.filter(r => blocksPush(r, { repush: lobby.pushed }))
          .map(r => `${r.sticker} ${(r.blockers ?? []).filter(b => !curedByPush(b)).map(b => splitBlocker(b).head).join(', ') || 'phone not arrived'}`)
          .join(' · ')
      : '',
  ].filter(Boolean).join('  ·  ');
  return { pushed: lobby.pushed, acked, total: players.length, allAcked, rosterFault, staleAcked, noEcho,
           staleAckLine, redRows, waitRows, curableRows, blockedCount, pushBlockedCount, waitWhy, refused, pushWhy };
}

/** Every readiness line the server writes is `STATEMENT — INSTRUCTION` ("ACKED AN OLDER CONFIG
 *  (9f2a1c04) — RE-PUSH"). Split it: the statement still shouts, the instruction sits under it
 *  quietly in sentence case, and the trailing severity tag ("BLOCKS START", "DOES NOT BLOCK") comes
 *  off because the row's own colour already says that.
 *
 *  ONE implementation, because the two screens that render these lines disagreed: the Armory card
 *  split them, and the LOBBY fault list kept only `split(' — ')[0]` — so "ACKED AN OLDER CONFIG
 *  (id) — RE-PUSH" rendered on the START screen without the RE-PUSH, dropping the "what to do" half
 *  of every A36 line at the exact moment the operator is deciding what to do (U-2, 2026-09-13). */
export function splitBlocker(line: string): { head: string; hint: string } {
  const [head, ...rest] = line.split(' — ');
  const hint = rest.join(' — ').replace(/\b(DOES NOT BLOCK( YET)?|BLOCKS START)\b/g, '').trim();
  return { head, hint };
}

/** "OPEN THE APP AND SET THE GUN" -> "Open the app and set the gun". Shouted instructions are what
 *  made these cards read as noise; the STATEMENT still shouts, the instruction does not. */
export function sentenceCase(t: string): string {
  const s = t.trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** F208: the quiet cue for a gun whose pool the phone calls stale, or null.
 *
 *  The phone decides (`status.pool_stale`): `silent` = no gun frame for a long time, `no_fire` = trigger
 *  presses with no shot back. `write_lost` = the phone lost this life's spawn or revive write (RESYNC GUN
 *  clears it). No claim means no cue: an older app is not evidence of a dead gun. The cue
 *  is grey information, never a warning (Tony wants fewer warnings). */
export function poolStaleLabel(reason: 'silent' | 'no_fire' | 'write_lost' | null | undefined, ms?: number | null): string | null {
  if (reason === 'no_fire') return 'GUN NOT FIRING';
  if (reason === 'write_lost') return 'GUN WRITE LOST';
  if (reason !== 'silent') return null;
  return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? `GUN SILENT ${fmtAge(ms)}` : 'GUN SILENT';
}

/** ARMORY's primary button (bench 2026-09-17, Tony): the button IS the status. It names what it waits
 *  for, and reads HARDWARE READY ▸ when the board allows.
 *
 *  The gate is unchanged: only a red that a push cannot cure (`blocksPush`) disables it. A waiting
 *  phone, an amber, a red a RE-PUSH on LOBBY cures, and an empty board all leave it pressable, because
 *  the button only moves to GAMES; the real gate is the LOBBY push. So the waiting label names the
 *  wait and still navigates. */
export interface ArmoryGate { label: string; disabled: boolean; ready: boolean; why: string }
export function armoryGate(board: { status?: string; blockers?: string[] | null; sticker?: string }[]): ArmoryGate {
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 'S'}`;
  const gating = board.filter(g => g.status === 'red' && blocksPush(g));
  const nRed = board.filter(g => g.status === 'red').length;
  const nCurable = nRed - gating.length;
  const nWaiting = board.filter(g => g.status === 'waiting').length;
  if (gating.length) {
    return { label: `${plural(gating.length, 'GUN')} BLOCKED`, disabled: true, ready: false,
      why: gating[0]?.blockers?.[0] ?? 'Clear the fault to continue' };
  }
  if (nWaiting) {
    return { label: `WAITING FOR ${plural(nWaiting, 'PHONE')}`, disabled: false, ready: false,
      why: 'Open the BRX app on each phone and set its gun. You can still go on to GAMES.' };
  }
  if (board.length === 0) {
    return { label: 'NO PLAYERS YET ▸', disabled: false, ready: false, why: 'Power the guns and open the app on each phone' };
  }
  return { label: 'HARDWARE READY ▸', disabled: false, ready: true,
    why: nCurable ? `${nCurable} gun${nCurable === 1 ? '' : 's'} answered for an older config: ${RE_PUSH_HERE}` : '' };
}

/** Where ARMORY's ENABLE BACKHAUL button stands (bench 2026-09-17).
 *
 *  `offer` is true only when all three hold:
 *  - the internet link can start from here: `lan.public` exists, `available` (cloudflared is on the
 *    PATH), and the provider is not `manual` (a `--public-url` link is not MC's to start);
 *  - the link is not up and not starting (`status` is `off` or `error`);
 *  - the board is not empty and EVERY row is `green` (every rostered phone is connected and clean).
 *  The button starts the link with `POST /api/tunnel {on:true}`, the same route REACH's TURN ON uses. */
export function backhaulOffer(state: Pick<State, 'lan' | 'readiness'> | null): { offer: boolean; status: 'off' | 'starting' | 'up' | 'error' | null } {
  const pub = state?.lan?.public;
  if (!state || !pub) return { offer: false, status: null };
  const board = state.readiness?.board ?? [];
  const allGreen = board.length > 0 && board.every(g => g.status === 'green');
  const canStart = pub.available && pub.provider !== 'manual';
  const down = pub.status === 'off' || pub.status === 'error';
  return { offer: canStart && down && allGreen, status: pub.status };
}
