// Small pure helpers derived FROM the server's shapes — not part of the wire contract.
//
// `types.ts` mirrors `mcp/brx_mcp/mc/API.md` field for field, so UI policy does not belong in it
// (review 2026-09-01). Nothing here talks to the network; everything is a pure function of `State`.
import type { State } from './types';
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
