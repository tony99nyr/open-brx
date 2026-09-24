// The command bar's pure text helpers, kept out of CommandBar.tsx so that file exports only components.

/** A wall-clock time for a receipt, always 24-hour (M21: `toLocaleTimeString()` printed "9:36:27 PM"
 *  on a US-locale laptop, and every other clock in this console is 24-hour). */
export const clock24 = (d: Date) => [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');

/** PANIC's receipt. `reached`/`nodes` are the server's own count of nodes that took the control
 *  frame (API.md `POST /api/control`); an older MC answers without them, and then no count is shown
 *  rather than an invented one. A partial reach is not "safed", so it says how far it got instead. */
export function panicReceipt(r: { ok?: boolean; reached?: number; nodes?: number; error?: string } | null | undefined, at: Date): { text: string; bad: boolean } {
  if (!r) return { text: 'PANIC FAILED — CHECK THE SERVER', bad: true };
  if (r.ok === false) return { text: `PANIC REFUSED — ${r.error || 'no reason given'}`, bad: true };
  const t = clock24(at);
  if (r.nodes == null || r.reached == null) return { text: `FLEET SAFED (${t}) — RE-ARM BEFORE PLAY`, bad: true };
  if (r.reached >= r.nodes) return { text: `FLEET SAFED · ${r.reached} OF ${r.nodes} NODES (${t}) — RE-ARM BEFORE PLAY`, bad: true };
  return { text: `PANIC REACHED ${r.reached} OF ${r.nodes} NODES (${t}) — THE REST ARE STILL LIVE`, bad: true };
}

/** M10: the server's LAN warning is one string (`netinfo.py WSL_UNREACHABLE_WARNING`): a headline, an
 *  em dash, then the how-to. The headline is the compact line; the how-to sits behind DETAILS. A
 *  string with no dash is all headline. */
export function splitWarning(w: string): { head: string; rest: string } {
  const i = w.indexOf(' — ');
  return i < 0 ? { head: w, rest: '' } : { head: w.slice(0, i), rest: w.slice(i + 3) };
}
