// Small pure helpers derived FROM the server's shapes — not part of the wire contract.
//
// `types.ts` is the contract (the wire shapes generated from `mcp/brx_mcp/mc/types.py`, the view
// shapes mirroring `mc/API.md`), so UI policy does not belong in it (review 2026-09-01). Nothing here
// talks to the network; everything is a pure function of `State`.
import type { NodeView, State } from './types';
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
