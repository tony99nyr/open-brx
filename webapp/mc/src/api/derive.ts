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
/** A41 — ONE sentence about end delivery, so LIVE and RECAP cannot say it two different ways.
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

export const PUSH_CURES =['ACKED AN OLDER CONFIG', 'GUN ECHO ≠ CONFIG', 'GUN POOL ≠ CONFIG'] as const;

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
