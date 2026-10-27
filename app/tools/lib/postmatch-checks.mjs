// Pure check helpers for app/tools/postmatch-e2e.mjs (F635), apart from the browser code so each rule reads alone.
//
// Frame comparison. Every phone gets the same result body, except:
//   - `my` is each viewer's own row, and `outcome` is each viewer's win or lose: both differ by design;
//   - `t` is MC's send time. It differs for a frame that MC sent later on its own path (a phone that reconnects gets
//     its frame after the broadcast), so the caller names those viewers in `late`, and `t` is excluded for them only.
//     For the others `t` must be the same broadcast: MC stamps it per recipient inside one push (`_result_body` runs
//     once a player), so two frames of one push can differ by a millisecond (seen 2026-10-27 under load). Within
//     SAME_PUSH_MS is the same push; a separate, stale push comes seconds apart (a status beat is 2 s), so it still fails.
export const PER_VIEWER = ['outcome', 'my'];
export const SAME_PUSH_MS = 1000;
export const strip = (b, extra = []) => { const c = JSON.parse(JSON.stringify(b || {})); for (const k of [...PER_VIEWER, ...extra]) delete c[k]; return c; };
export const diffKeys = (a, b) => { const ks = new Set([...Object.keys(a), ...Object.keys(b)]); return [...ks].filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])); };
/** frames: { name: { at, body } }; late: names whose frame MC sent later. Returns [{ a, b, late, differ }]. */
export const compareFrames = (frames, late = []) => {
  const names = Object.keys(frames).filter(n => frames[n]?.body); if (names.length < 2) return [];
  const f0 = frames[names[0]];
  return names.slice(1).map(nm => {
    const f = frames[nm]; const isLate = late.includes(nm) || late.includes(names[0]);
    const differ = diffKeys(strip(f0.body, ['t']), strip(f.body, ['t']));
    if (!isLate && !(Number.isFinite(f0.body.t) && Number.isFinite(f.body.t) && Math.abs(f0.body.t - f.body.t) <= SAME_PUSH_MS)) differ.push('t');
    return { a: names[0], b: nm, late: isLate, differ };
  });
};
/** Case 3b: a rejoin welcome carries the result at body.node.result. */
export const welcomeResult = (f) => f?.body?.node?.result ?? null;
/** Case 6: in the debrief the phone sits at `kitted`. It keeps the result when it is ended, has an outcome and keeps the matchId. */
export const keepsResult = (eng, matchId) => eng?.ended === true && eng?.outcome != null && eng?.matchId === matchId;

/** The honours strip a phone must draw for a result body: one chip per holder (most first, MC's order on a tie), at most
 *  `shown`, then "+N MORE", and the AWARDS pointer when an honour has a key and a player. Mirrors hud/result.js on the
 *  INPUT, so a strip that drops or invents a holder fails; the strip's look is not checked here. */
export function expectedHonours(body, shown) {
  const all = Array.isArray(body?.honors) ? body.honors.filter(h => h && typeof h === 'object') : [];
  const awards = all.filter(h => (h.key || h.medal) && h.player_id);
  const holders = [];
  for (const h of (awards.length ? awards : all.filter(h => h.medal))) {
    const row = (body.rows || []).find(r => r.player_id === h.player_id);
    const name = String(h.display || row?.display || h.player_id || '').toUpperCase(); if (!name) continue;
    const id = h.player_id || 'name:' + name;
    const e = holders.find(x => x.id === id); if (e) e.n++; else holders.push({ id, name, n: 1 });
  }
  holders.sort((a, b) => b.n - a.n);
  if (!holders.length) return null;
  const more = holders.length - shown;
  return { chips: holders.slice(0, shown).map(x => `${x.name} ×${x.n}`), more: more > 0 ? `+${more} MORE` : null, go: awards.length > 0 };
}

/** "MM:SS" or "M:SS" to seconds; null for anything else. */
export const mmssToS = (s) => { const m = /^(\d+):(\d\d)$/.exec(String(s ?? '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** Deep equality by JSON, with the keys sorted, so key order never decides a check. */
export const sameJson = (a, b) => canon(a) === canon(b);
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);

/** The fields of `actual` that differ from `expected`, as { key: { want, got } }. Only the expected keys count. */
export function fieldDiff(actual, expected) {
  const out = {};
  for (const k of Object.keys(expected)) if (!sameJson(actual?.[k], expected[k])) out[k] = { want: expected[k], got: actual?.[k] };
  return out;
}
