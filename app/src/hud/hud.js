// Phone HUD v2 renderer — a pure function of engine state (node.md §4). Landscape 844×390, scaled to
// the viewport. Structure re-renders only when the state "signature" changes; live numbers patch in
// place so CSS animations don't restart every tick. Moments (T-MINUS, KILL, DOWN, REDEPLOY) live in
// #overlay so they animate independently of the base HUD.

const TEAM_COLOR = { blue: 'var(--team-blue)', yellow: 'var(--team-yellow)', red: 'var(--team-red)', green: 'var(--team-green)' };
const TEAM_INK = { blue: '#04121e', yellow: '#1a1400', red: '#1a0404', green: '#041a0c' };
const pad2 = n => String(Math.max(0, Math.floor(n))).padStart(2, '0');
/** A countdown as one fixed-width cell per digit (F115). Saira Condensed has no tabular figures, so
 *  `font-variant-numeric:tabular-nums` silently does nothing and every value is a different width:
 *  "11" measured 113px and "88" 179px at the DOWN size. The number lives in a centred flex column, so
 *  each tick re-centred and re-laid-out the glyphs WHILE `animation:heartbeat` was transforming them,
 *  which is the tearing Tony saw. Fixed cells make the width a constant of the digit COUNT alone.
 *
 *  TWO cells, always: three of them at .56em of a 170px frame overrun it, and `respawnIn` is a server
 *  number — a 120 s penalty box or a stalled clock is not the HUD's to render as a layout break. 99 is
 *  the honest ceiling for a countdown you watch tick (review 2026-09-12). */
const digits = n => pad2(Math.min(99, Math.max(0, Math.floor(n)))).split('').map(c => `<span class="d">${c}</span>`).join('');
const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${pad2(s / 60)}:${pad2(s % 60)}`; };
const mmssS = s => mmss(Math.max(0, Number(s) || 0) * 1000);   // the wire carries possession in SECONDS
const clock12 = t => { const d = new Date(Number(t) || 0); const h = d.getHours(); return `${h % 12 === 0 ? 12 : h % 12}:${pad2(d.getMinutes())}${h < 12 ? 'AM' : 'PM'}`; };
const num = v => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Accuracy is hits/shots where hits come from the VICTIMS' phones — shown only once MC has counted at least one
 *  hit for this player and ten shots have gone out; otherwise it reads 0% for every player without a phone in range. */
const accShown = st => (st.accuracy != null && st.hits > 0 && st.shots >= 10) ? Math.round(st.accuracy) : null;
/** A11.4: alert families → banner colour. Objective = team colour, clock = amber, danger = red, the rest = glow. */
const ALERT_FAMILY = { objective_taken: 'objective', objective_scored: 'objective', flag_returned: 'objective', point_captured: 'objective', hill_captured: 'objective',
  time_60: 'clock', time_30: 'clock', time_10: 'clock',
  bomb_planted: 'danger', bomb_detonated: 'danger', vip_hit: 'danger', vip_down: 'danger', infected: 'danger', lead_lost: 'danger',
  lead_taken: 'info', next_kill_wins: 'info', last_survivor: 'info', survivors_win: 'info', bomb_defused: 'info',
  extraction_called: 'objective', extraction_open: 'objective', extraction_closing: 'objective', extraction_complete: 'objective', extraction_failed: 'danger', extraction_alert: 'danger',
  loot_picked: 'info', raid_ending: 'danger', raid_over: 'danger' };   // extraction ladder + raid (brx session, 2026-09-04)
/** A24: the only four words the results screen may print as an outcome, and it prints one ONLY when MC has
 *  pushed a `result`. There is deliberately no mapping for "no message arrived" — see `_result`. */
const OUTCOME_WORD = { win: 'WIN', lose: 'LOSE', draw: 'DRAW', undecided: 'UNDECIDED' };
const MEDAL_LABEL = { first_blood: 'FIRST BLOOD', double_kill: 'DOUBLE KILL', triple_kill: 'TRIPLE KILL', killtacular: 'KILLTACULAR', killing_spree: 'KILLING SPREE', unstoppable: 'UNSTOPPABLE' };
/** App 0.4.2: the words of the picker's "Connecting to <gun>" block, from `hud.connecting`. */
export function connectingText(conn) {
  const nm = String((conn && conn.name) || 'your gun');
  if (conn && conn.failed) return { head: `Could not connect to ${nm}`, line: 'Turn the gun off and on, then tap Scan again.' };
  // Review 2026-09-19: armed/live makes the loop retry FOREVER (BrxLink.unbounded()), past the `of` it
  // started with -- app.js sends `of: null` for that case, so the count is never printed once `attempt`
  // could run past it ("Retrying (7 of 5)…"). `Math.min` clamps it too, belt and braces, in case a caller
  // ever hands the two mismatched.
  const line = !conn || conn.attempt <= 1 ? 'Keep the gun close and switched on.'
    : conn.of ? `Retrying (${Math.min(conn.attempt, conn.of)} of ${conn.of})…` : 'Retrying…';
  return { head: `Connecting to ${nm}…`, line };
}
const splitGun = g => { if (!g) return ['—', '']; return [esc(g.basename || g.name || ''), esc(g.tail || '')]; };

// F258: one picker row, built once and then written in place. The signal bars light at these dBm
// thresholds, weakest first; the heights are the design's rising staircase.
/** F265, bench 2026-09-18: a bound phone can stop receiving score pushes while `wsState` still reads
 *  `bound`, so the socket state is not proof the scoreboard is current. LIVE is honest only for a
 *  snapshot this fresh; older than this, the overlay shows the age instead, bound or not.
 *
 *  Polish review #2 (2026-09-18): this used to measure the age of `scoreAt` (the last SCORE push).
 *  MC pushes a score only on change (a kill, a cap), so a normal quiet 5 s with nobody dying flipped
 *  a perfectly live board to stale. It now measures `lastMcMsgAt` (engine.js) -- the phone's own clock
 *  time of the last message MC sent over the bound socket, ANY kind. The one message kind guaranteed
 *  periodic whether or not the match is eventful is `time_res`, which answers the transport's own
 *  `time_req` every `syncIntervalMs` (5 s, `transport.js`) -- so this threshold must sit clearly above
 *  that period or one skipped/delayed beat would false-positive as stale; 3x the period plus a second
 *  of margin gives one full missed cycle of slack. */
const BOARD_LIVE_MAX_AGE_MS = 16000;
const SIG_THRESHOLDS = [-85, -75, -65, -55];
const SCAN_ROW = '<span class="nm"></span><span class="inuse" hidden>IN USE</span><span class="sig">'
  + SIG_THRESHOLDS.map((_, i) => `<i style="height:${6 + i * 4}px"></i>`).join('') + '<b></b></span>';
/** Bench 2026-09-17: bullet-shaped pips read as one pip per round, so a 12-pip gauge on a 4-round sniper mag
 *  lied by 3 pips a shot. Pips now count exactly the magazine size — one pip per round — up to this many; past
 *  it they stop reading as bullets and the gauge switches to a continuous bar (exact count stays in the digits
 *  beside it). 30 is the largest count the pip row fits at 667×375 (the SE stage viewport) without reaching the
 *  vitals plate on the other corner, and it sits in the gap the weapon catalogue leaves between a doubled
 *  (Extended Mags) marksman mag — sniper 4→8, AMR 14→28 — and a doubled sidearm or assault mag — glock 16→32,
 *  bolt rifle 18→36, stinger 18→36 — so the perk never straddles the threshold either way. */
const AMMO_PIP_MAX = 30;
/** Bench 2026-09-17: `weapon_class` ("ballistic" | "energy" | "melee", `st.weaponClass`) decides the
 *  reload-versus-overheat WORDING (RECHARGE/HOLD TO RECHARGE for energy, RELOAD for ballistic) -- that is
 *  its only job. The old id regex is the named fallback for a pre-A48 bundle that carries no class at
 *  all. */
const isEnergyWeapon = st => {
  const cls = st && st.weaponClass;
  if (cls) return cls === 'energy';
  return /energy|charge/i.test(String((st && st.weaponId) || ''));
};
/** Bench 2026-09-17: a full charge on the charge rifle spends 10 of its 40-charge cell, so a
 *  cell under 10 fires nothing even though it reads as "ammo left". A48 (merge 2026-09-17) put that cost in
 *  the catalogue as `rounds_per_charge`, which the node passes through as `st.roundsPerCharge`, so the cost
 *  is now read per weapon and the charge-rifle id no longer appears in this rule. The constant stays as the
 *  named fallback for a pre-A48 bundle, and is used ONLY for the charge rifle, the one weapon it was
 *  measured on -- never guessed onto another energy weapon. */
const CHARGE_RIFLE_FULL_CHARGE_COST = 10;
/** What one full charge costs this weapon's cell, or null when it does not charge.
 *  ⚠ `> 1`, not `> 0` (polish 2026-09-17): a weapon that spends ONE round per shot does not charge, and
 *  `rounds_per_charge` now always reaches the node as a concrete number (MC resolves the catalogue's
 *  absent-means-1 row), so a `> 0` test made every bullet weapon look like a charge weapon. A sniper
 *  rifle with an empty magazine then read NOT ENOUGH ENERGY instead of RELOAD. Same question as
 *  `usesCellGauge` below, which is why both ask it the same way. A present value of 1 is an answer, so
 *  it never falls through to the pre-A48 id fallback. */
const chargeCost = st => {
  if (st && st.roundsPerCharge != null) return st.roundsPerCharge > 1 ? st.roundsPerCharge : null;
  // Same short-circuit as `usesCellGauge`, and for the same reason: a post-A48 bundle carries a class,
  // so a missing `roundsPerCharge` there means the catalogue default of 1, not "ask the weapon id". Only
  // a bundle with NEITHER field is old enough for the id fallback. Without this line the two disagreed
  // on a transitional bundle: the charge rifle got the NOT ENOUGH ENERGY note with the big-magazine bar.
  if (st && st.weaponClass) return null;
  return (st && st.weaponId === 'charge_rifle') ? CHARGE_RIFLE_FULL_CHARGE_COST : null;
};
/** F248 (2026-09-17): `weapon_class` decides WORDING (isEnergyWeapon above), never which
 *  ammo gauge to draw -- the arsenal merge picked the gauge from `weapon_class === "energy"`, which is
 *  WIDER than the old id match, so the Rail Gun (class "energy", `mag` 2, one round per shot) drew a
 *  percentage instead of its two pips. The rule agreed then: draw the CELL gauge (percentage
 *  bar / cell-count pills) exactly when a full charge costs MORE than one round (`rounds_per_charge > 1`);
 *  otherwise draw the ordinary per-round pips or big-magazine bar, whatever the class says. A post-A48
 *  bundle always carries `weaponClass`, so a weapon with no explicit `rounds_per_charge` -- the catalogue
 *  default of 1, e.g. the Rail Gun -- reads as "not a cell gauge" via that branch alone. Only a bundle with
 *  NEITHER field (pre-A48, before either concept existed) falls back to the named charge-rifle constant,
 *  then the old id regex -- which never matched "rail_gun" in the first place, so this bug could not have
 *  existed before A48 widened the class match. */
const usesCellGauge = st => {
  if (st && st.roundsPerCharge != null) return st.roundsPerCharge > 1;
  if (st && st.weaponClass) return false;
  return (st && st.weaponId === 'charge_rifle') ? CHARGE_RIFLE_FULL_CHARGE_COST > 1
    : /energy|charge/i.test(String((st && st.weaponId) || ''));
};
/** pl4 (bench 2026-09-17, Energy Rifle): an energy weapon's reload is a HOLD of the lever. Taps of 0.15-0.23 s
 *  refilled nothing; a hold of 0.7 s or more refilled the whole cell in one step. So the prompt says how, and it
 *  is always steady (never blinking), whether the cell is empty or only below a charge: one calm rule. The
 *  empty-cell digit already warns, and NOT ENOUGH ENERGY shows only while the cell still reads above 0. */
const HOLD_TO_RECHARGE = 'HOLD TO RECHARGE';
/** S53/S55: the ONE accuracy pill says WHY the player cannot hit. The engine hands the reason (`st.aim.reason`);
 *  the HUD never guesses one. Smoke is the only reason built; S55 adds recoil, flinch and stance rows here. */
const AIM_REASON = {
  smoke: { word: 'SMOKED', sub: 'YOUR SHOTS WILL MISS' },
  recoil: { word: 'RECOIL', sub: 'RELEASE TO STEADY' },
};
const secsLeft = ms => Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
const pctLeft = (left, total) => Math.max(0, Math.min(100, Math.round(100 * (Number(left) || 0) / (Number(total) || 1))));
/** The digit beside the gauge: a round count for a bullet weapon or a low-cost energy weapon (the Rail
 *  Gun), a percentage of the cell for a weapon whose full charge costs more than one round (F248, see
 *  usesCellGauge above). */
const magText = st => usesCellGauge(st)
  // Bench 2026-09-18 (Tony): the per-cent sign is noise in a fight -- the number alone reads faster and
  // the bar beside it already says it is a proportion, not a round count.
  ? `${Math.max(0, Math.min(100, Math.round(100 * st.ammo / (st.mag || Math.max(st.ammo, 1)))))}`
  : pad2(st.ammo);
// Polish-loop pass 1 (2026-09-12): the discovered-MC row shows the HOST, never the raw ws://…/ws join URL.
const mcHost = url => { try { return new URL(url).host; } catch (_) { return String(url || ''); } };
// Polish-loop pass 2: `d.source` (app.js, landed) is 'sweep' (a port sweep on the joined Wi-Fi) or 'mdns'
// (a broadcast advert) — worded so a player can tell which kind of "found" this is; the action is the same.
const discoveredRow = d => { if (!d) return '';
  const label = d.source === 'mdns' ? 'FOUND BY BROADCAST' : 'FOUND ON THE NETWORK';
  return `<div class="discoveredrow" data-act="onJoinDiscovered"><span class="unskew">MISSION CONTROL ${label} AT ${esc(mcHost(d.url))} · JOIN</span></div>`; };
// Polish-loop pass 1+2: every join control that redials/drops the live MC link needs the armed/live
// two-tap guard (`_click` below) — `onJoinDiscovered` (an address the player never typed) and
// `onReconnectMc` (the same teardown, same button row) joined `onSetUrl`/`onScanQr` in pass 2.
const JOIN_GATED_ACTS = new Set(['onSetUrl', 'onScanQr', 'onJoinDiscovered', 'onReconnectMc']);
const JOIN_ACT_VERB = { onScanQr: 'SCAN A NEW QR', onJoinDiscovered: 'JOIN THAT ADDRESS', onReconnectMc: 'RECONNECT', onSetUrl: 'RECONNECT' };
// A10: human labels for catalog rows (never the raw $WEAP class id — design review round 3)
const ROLE_NAME = { assault: 'ASSAULT', cqb: 'CLOSE RANGE', marksman: 'SNIPER', support: 'SUPPORT', power: 'HEAVY', melee: 'MELEE', sidearm: 'SIDEARM' };
/** A secondary rule whose kinds hold `sidearm` but not `weapon` is a pistols-only slot (policy.py, 2026-09-04). */
const sidearmOnly = rule => !!(rule && rule.kinds && rule.kinds.includes('sidearm') && !rule.kinds.includes('weapon'));
const roleName = w => ROLE_NAME[w.role] || (w.tags && w.tags[0] ? String(w.tags[0]).toUpperCase() : 'WEAPON');
// S50 (2026-09-19): every perk carries a GAIN and a COST, computed ONCE on the server
// (`mcp/brx_mcp/mc/perks.py` `gain_cost_lines`) and shipped on the catalogue's `PerkView` as
// `gain`/`cost` string arrays -- this file used to derive its own from `effects` and, before the fix,
// ran every multiplier through `1 / m` and called the result "FASTER" regardless of which side of 1 it
// fell on (Body Armor's `reload_mult: 1.25` printed "RELOADS 0.8× FASTER", a penalty read as a buff).
// The console (`webapp/mc/src/screens/Kit.tsx`) reads the SAME two arrays, so the two UIs cannot
// disagree about a perk's trade again. `short` is for the kit plate, which is about 124 px wide: the
// gain only, with the cost in the browser row and the detail pane where there is room for it. A stale
// server that has not shipped `gain`/`cost` yet degrades to an empty line, never a crash.
const perkGain = p => (p && p.gain) || [];
const perkCost = p => (p && p.cost) || [];
const perkEffect = (p, short) => {
  const gain = perkGain(p), cost = perkCost(p);
  if (short) return gain[0] || 'PASSIVE';
  return [...gain, ...cost].join(' · ') || 'PASSIVE'; };
/** Same line as `perkEffect`, but the cost half tinted in the neutral warning colour (never a team
 *  colour, never red) so a gain and a cost read as two different kinds of fact, not one flat list. */
const perkEffectHtml = p => {
  const gain = perkGain(p), cost = perkCost(p);
  if (!gain.length && !cost.length) return 'PASSIVE';
  const g = gain.length ? `<span style="color:var(--perk,#c48bff)">${gain.map(esc).join(' · ')}</span>` : '';
  const c = cost.length ? `<span style="color:var(--warn)">${cost.map(esc).join(' · ')}</span>` : '';
  return [g, c].filter(Boolean).join(' · '); };
const PERK_GLYPH = {
  body_armor: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 4 L34 9 V20 C34 29 28 34 20 37 C12 34 6 29 6 20 V9 Z"/><path d="M20 12 V29 M13 20 H27" opacity=".7"/></svg>',
  extended_mags: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 4 H28 L30 36 H10 Z"/><path d="M15 11 H25 M15 17 H25 M15 23 H25 M15 29 H25" opacity=".7"/></svg>',
  quick_hands: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="20" cy="23" r="13"/><path d="M20 15 V24 L26 27 M16 4 H24 M20 4 V9" /></svg>',
  easy_reload: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M31 15 A13 13 0 1 0 33 24"/><path d="M31 6 V15 H22"/></svg>',
};
const LOCK_SVG = '<svg class="lockg" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="9" width="12" height="9"/><path d="M7 9V6a3 3 0 0 1 6 0v3"/></svg>';
// A26: the rack row's "read this one" control. Drawn, not typed: U+24D8 (ⓘ) is not in the HUD's font stack
// and rendered as a tofu box on the stage.
const INFO_SVG = '<svg class="infog" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10" cy="10" r="7.6"/><path d="M10 8.8v5.4" stroke-linecap="round"/><circle cx="10" cy="6.1" r="1" fill="currentColor" stroke="none"/></svg>';
const perkGlyph = id => PERK_GLYPH[id] || '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 4 L24 15 L36 16 L27 24 L30 36 L20 30 L10 36 L13 24 L4 16 L16 15 Z"/></svg>';
/** A background-image has no onerror hook, so a missing weapon photo used to show the empty
 *  `#0a1626` box with nothing on screen saying why (stripper/smoke_gun have none yet, and it read as
 *  a UI bug, not a missing asset — field 2026-09-18). An <img> DOES fire onerror: swap it for a
 *  generic weapon glyph, the same precedent as `perkGlyph`'s unmatched-id fallback above. Every
 *  weapon-art call site shares this one function, so the fix (and any future one) lands once. */
const WEAPON_GLYPH = '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="20" cy="20" r="13"/><path d="M20 3 V11 M20 29 V37 M3 20 H11 M29 20 H37"/><circle cx="20" cy="20" r="2.6" fill="currentColor" stroke="none"/></svg>';
const weaponArt = id => `<img class="wpic" src="assets/weapons/${esc(id)}.jpg" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="wpicfb">${WEAPON_GLYPH}</span>`;


// Field 2026-08-30: the old DMG/ROF meters read `stats.dmg` straight, but that number is "share of a
// 115 pool per hit" -- 7 to 11 for most guns -- so every bar sat near empty and no two weapons looked
// different. MC now ranks each stat ACROSS the arsenal and ships it as `bars`, with the real figures
// alongside. Range is gone: t41 is identical on all 18 guns, so a range meter measured nothing.
function statBlock(r, opts = {}) {
  const st = r && r.stats ? r.stats : (r || {});
  const b = r && r.bars ? r.bars : {};
  const bar = (label, v, note) => v == null ? '' :
    `<div class="tb"><span>${label}${note ? ` <em>${note}</em>` : ''}</span><i><b style="width:${Math.max(0, Math.min(100, v))}%"></b></i></div>`;
  const pick = (...xs) => xs.find(x => x != null);
  const dmgHit = pick(r && r.dmg_per_hit, st.dmg_per_hit);
  const htk = pick(r && r.htk, st.htk);
  const ttk = pick(r && r.ttk_ms, st.ttk_ms);
  const pool = pick(r && r.pool, st.pool);
  const reload = pick(r && r.reload_s, st.reload_s, st.reload_ms != null ? st.reload_ms / 1000 : null);
  const facts = (opts.compact ? [
    // the TRY-OUT panel's one line: dmg · hits to kill · kill time. Pool and reload stay in the ⓘ pane — with them the
    // line ran 394 px into a 312 px box (screen-truth invariants, 2026-09-12).
    dmgHit != null ? `DMG <b>${dmgHit}</b>/HIT` : null,
    htk != null ? `HITS TO KILL <b>${htk}</b>` : null,
    ttk != null ? `KILL <b>${(ttk / 1000).toFixed(2)}S</b>` : null,
  ] : [
    dmgHit != null ? `DMG <b>${dmgHit}</b>/HIT` : null,
    // the pool is part of the number: MC quotes htk against the HOST'S health config now, so the
    // same "13" means a different thing between games (API.md GET /api/weapons; the MC screens
    // label it the same way). Printing it bare made it silently drift (review 2026-09-01).
    htk != null ? `HITS TO KILL <b>${htk}</b>${pool != null ? ` · ${pool}` : ''}` : null,
    ttk != null ? `KILL <b>${(ttk / 1000).toFixed(2)}S</b>` : null,
    reload != null ? `RELOAD <b>${(+reload).toFixed(1)}S</b>` : null,
  ]).filter(Boolean).join(' · ');
  // `compact` = the TRY-OUT panel: two bars + one facts line. The panel sits above READY UP in a fixed box; when the
  // catalog began carrying all four bars and the kill/reload facts (the regenerated demo catalog, 2026-09-12 — and MC's
  // real WeaponView always did), the four-bar block grew the panel into the footer: the F111 hypothesis, made real.
  // The rack's ⓘ pane keeps the full four.
  return `${bar('POWER', pick(b.power, st.dmg, r && r.dmg))}${bar('RATE OF FIRE', pick(b.rof, st.rof, r && r.rpm))}` +
    (opts.compact ? '' : `${bar('AMMO CARRIED', b.ammo)}${bar('KILL SPEED', b.ttk)}`) +
    (facts ? `<div class="facts">${facts}</div>` : '');
}

// The skin switch draws its own icons: a text ☀ fell back to a different glyph in the phone's font.
const SKIN_MOON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M15 3a9 9 0 1 0 6.5 15.2A7.5 7.5 0 0 1 15 3z"/></svg>';
const SKIN_SUN = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></g></svg>';

export class Hud {
  constructor(root, handlers = {}) {
    this.root = root; this.h = handlers;
    this.frame = root.querySelector('#frame'); this.hudEl = root.querySelector('#hud');
    this.overlay = root.querySelector('#overlay'); this.chips = root.querySelector('#chips');
    this.diag = root.querySelector('#diag'); this.info = root.querySelector('#info');
    this.skin = root.querySelector('#skin');   // the day/night skin switch (a sibling of #hud, so it needs its own listener)
    if (this.skin) this.skin.addEventListener('click', e => this._click(e));
    this.sig = null; this.scan = []; this.link = {}; this.diagData = {}; this.mcUrl = '';
    this.scanActive = true;   // game day 2026-09-19: app.js sets whether a picker scan really runs
    this.scanOther = false;   // F258: the "other devices" fold on the picker, closed to start with
    // App 0.4.2 (field 2026-09-19, Pixel 5): after a tap on a gun the list emptied and the screen showed
    // nothing for about 4 s while two connects failed and a third linked. `connecting` is
    // `{name, attempt, of, failed}` from the tap until the link is up or the connect gives up, else null.
    this.connecting = null;
    // F211: adapter-off state, app.js-owned (like `mcUrl`/`discovered` below) — the picker's own concern,
    // never round-tripped through the engine. `platform` gates the Android-only enable/settings buttons.
    this.bluetoothOn = true; this.platform = 'web';
    this.discovered = null;   // {url, at} a LAN-sweep hit MC never auto-joined — null once bound or nothing found
    this._joinConfirm = null; // {act, at} the armed/live two-tap guard on CONNECT / SCAN QR (below)
    this._gunConfirm = null;  // {at} the LIVE two-tap guard on RELINK GUN (bench 2026-09-17, below)
    this.lo = { tab: 'primary', filter: 'weapons', focus: null, confirm: null };   // LOADOUT browser UI state (tab / filter / focused row / A14 two-tap confirm {key, drop})
    this._moment = null; this._momentTimer = null; this._lastTminus = null; this.mcPill = false;   // live: the MC-range pill is opt-in (tap the MC label)
    // A24 FINAL RESULTS: which screen the player has reopened after OK (null | 'result' | 'history') and which
    // half of the segmented toggle they are on (null = pick from the mode: teams for a team game, players for FFA).
    this.view = null; this.rtab = null; this._lastSt = null;
    // Bench 2026-09-17: the live scores overlay (null | 'team' | 'player'). A VIEW like `view` above: opening it
    // sends nothing and touches no engine state. `_cueAt` / `_cueT` drive the ammo gauge's shot-ready cue.
    this.board = null; this._cueAt = null; this._cueT = null;
    this.info.addEventListener('click', () => this.toggleDiag());
    this.hudEl.addEventListener('click', e => this._click(e));
    this.diag.addEventListener('click', e => this._click(e));
    // The chip bar is a sibling of #hud, so its pill buttons (GUN LINK LOST, RECONNECT NOW) need their own listener:
    // without it a tap on them reached no handler at all (bench 2026-09-17).
    this.chips.addEventListener('click', e => this._click(e));
    let pressT = null;
    // (removed 2026-08-26, critic #9: a resting glove/chin tripped the invisible 900 ms night toggle — NIGHT lives in the diag panel)
    this.hudEl.addEventListener('pointerup', () => { if (pressT) clearTimeout(pressT); pressT = null; });
    this.hudEl.addEventListener('pointerleave', () => { if (pressT) clearTimeout(pressT); pressT = null; });
    // Bench 2026-09-16: a player could not tell whether a tap landed. One delegated pair on #frame (the
    // parent of #hud, #diag and the ⓘ button) covers every tappable thing — a native button, a
    // data-act row/pill/tile, or role="button" — so no control needs its own press handler. pointerdown
    // fires on touch-down on both WKWebView and Android WebView (unlike CSS :active, which iOS can miss);
    // pointerup/cancel always clears it, and a window-level fallback catches a release outside the frame
    // (a drag that ends off-screen). Disabled/aria-disabled controls are skipped so a locked tile never
    // flashes pressed.
    this.frame.addEventListener('pointerdown', e => this._tapDown(e));
    this.frame.addEventListener('pointerup', () => this._tapUp());
    this.frame.addEventListener('pointercancel', () => this._tapUp());
    window.addEventListener('pointerup', () => this._tapUp());
    window.addEventListener('pointercancel', () => this._tapUp());
    window.addEventListener('resize', () => this.fit()); this.fit();
  }
  // See the constructor comment above for why this is one delegated pair, not per-button code.
  _tapDown(e) {
    const el = e.target.closest('button, [data-act], [role="button"]');
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    if (this._pressedEl && this._pressedEl !== el) this._pressedEl.classList.remove('tap-press');
    this._pressedEl = el;
    el.classList.add('tap-press');
  }
  _tapUp() {
    if (!this._pressedEl) return;
    this._pressedEl.classList.remove('tap-press');
    this._pressedEl = null;
  }
  fit() {
    // On the phone the OS status bar (clock / battery / signal) is drawn OVER the web view — Android 15 forces
    // edge-to-edge and reports env(safe-area-inset-top) as 0 — so the top-right ⓘ sat under it (Tony, device
    // 2026-09-04). Native builds get a fixed top margin across the whole frame; the frame scales into what is left.
    const st = this.frame.parentElement;
    if (st && !this._nativeInset) {
      this._nativeInset = true;
      try {
        const C = window.Capacitor;
        if (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform()) {
          st.style.paddingTop = 'max(env(safe-area-inset-top, 0px), 28px)';
          st.style.paddingBottom = 'max(env(safe-area-inset-bottom, 0px), 14px)';   // + the gesture-nav pill along the bottom edge (Pixel screenshot 2026-09-04)
        }
      } catch (_) { /* browser */ }
    }
    // the stage's CONTENT box: the viewport minus that padding, so the frame never sits under a bar or a notch
    const w = (st && st.clientWidth) || window.innerWidth, h = (st && st.clientHeight) || window.innerHeight;
    const cs = st && typeof getComputedStyle === 'function' ? getComputedStyle(st) : null;
    const pw = cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 0, ph = cs ? (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) : 0;
    const s = Math.min((w - pw) / 844, (h - ph) / 390);
    this.frame.style.transform = `scale(${s})`;
  }
  _click(e) {
    // The scores overlay closes on a tap anywhere outside its panel. The ⓘ, the day/night switch, the diag
    // panel and the chip bar keep their own taps (they are not part of the live screen under the overlay).
    if (this.board && !e.target.closest('.bdpanel, [data-act="onBoard"], #skin, #info, #diag, #chips')) {
      this.board = null; this.sig = null; if (this._lastSt) this.render(this._lastSt);
      return;
    }
    const el = e.target.closest('[data-act]'); if (!el) return;
    const act = el.dataset.act, arg = el.dataset.arg;
    // The results / history screens are a VIEW of what the engine already holds — reopening them changes nothing
    // on the gun or the wire, so they are handled here and never round-trip through the app's handler map.
    // Re-rendered from the last state IMMEDIATELY: the app's loop is 250 ms and a toggle that lags a quarter of a
    // second past the tap reads as a dead control.
    // A26: the ⓘ on a rack row only MOVES THE DETAIL PANE. It equips nothing, sends nothing and touches no
    // engine state, so like the results views it is answered here and never round-trips the app's handler map.
    if (act === 'onLoInfo') {
      this.lo.focus = arg || null; this.lo.confirm = null;
      this.sig = null; if (this._lastSt) this.render(this._lastSt);
      return;
    }
    // Polish-loop pass 1+2 (2026-09-12, MEDIUM security+UX): CONNECT / SCAN QR / RELINK MC / JOIN (a
    // discovered address, never one the player typed themselves) are reachable in every phase (F156) with
    // nothing stopping a stray tap mid-match — any of the four redials and drops the live MC link, and
    // SCAN QR additionally blacks the HUD out behind the camera. All four stay one-tap everywhere they
    // always were (idle/connected/kitted/lobby/over); only armed/live — an active match — gate them behind
    // a second tap, the same two-tap shape A14's loadout conflict already uses. The warning lives in
    // `dg-mcjoinhint` (`renderDiag`), patched from this state rather than a structural rebuild so it
    // shows on the SAME render the first tap produced.
    if (JOIN_GATED_ACTS.has(act) && this._lastSt && (this._lastSt.phase === 'armed' || this._lastSt.phase === 'live')) {
      const now = Date.now();
      if (this._joinConfirm && this._joinConfirm.act === act && now - this._joinConfirm.at < 4000) { this._joinConfirm = null; this.renderDiag(); }   // second tap: revert the warning now, then let it through below
      else { this._joinConfirm = { act, at: now }; this.renderDiag(); return; }
    } else if (this._joinConfirm) this._joinConfirm = null;   // any other tap (or a phase change) drops a stale confirm
    // Bench 2026-09-17: RELINK GUN takes the phone off the gun, so on a LIVE link it asks for a second tap within 4 s.
    // The GUN LINK LOST pill shares the act, but only shows with the link down, where a tap takes nothing away.
    if (act === 'onReconnectGun' && el.closest('#diag')) {
      if (this.diagData && this.diagData.link && this.diagData.link.relinking) return;   // a relink is running: the button reads RELINKING…
      if (this._lastSt && this._lastSt.phase === 'live' && this._lastSt.bleUp) {
        if (this._gunConfirm && Date.now() - this._gunConfirm.at < 4000) { this._gunConfirm = null; this.renderDiag(); }
        else { this._gunConfirm = { at: Date.now() }; this.renderDiag(); return; }
      }
    } else if (this._gunConfirm) { this._gunConfirm = null; if (this.diag.classList.contains('open')) this.renderDiag(); }
    if (act === 'onBoard' || act === 'onBoardTab' || act === 'onBoardClose') {
      this.board = act === 'onBoardClose' ? null : (arg === 'player' ? 'player' : 'team');
      this.sig = null; if (this._lastSt) this.render(this._lastSt);
      return;
    }
    if (act === 'onEndOk') this.view = null;                                     // OK still acks the end (app handler below)
    else if (act === 'onShowResults' || act === 'onShowHistory' || act === 'onCloseView' || act === 'onResultTab') {
      if (act === 'onShowResults') this.view = 'result';
      else if (act === 'onShowHistory') this.view = 'history';
      else if (act === 'onCloseView') this.view = null;
      else this.rtab = arg === 'player' ? 'player' : 'team';
      this.sig = null; if (this._lastSt) this.render(this._lastSt);
      return;
    }
    const fn = this.h[act]; if (fn) fn(arg, el);
  }
  // F258 (bench 2026-09-18): this used to clear the structural signature, so every scan hit rebuilt
  // the whole screen and destroyed every row node under the player's finger. A scan hit is not a
  // screen change: `_patchScan` writes the rows in place on the next render, and the picker's empty
  // placeholder and its "other devices" fold are patched the same way. Nothing here is structure.
  setScan(list) { this.scan = list || []; }
  /** Opens or closes the "other devices" fold (F258). A view, like `board`: it sends nothing. */
  setScanOther(open) { this.scanOther = !!open; }
  /** Sets the "Connecting to <gun>" state of the picker (null clears it). */
  setConnecting(c) { this.connecting = c || null; }
  setLink(link) { this.link = link; }
  // Polish-loop pass 1 (2026-09-12): a LAN sweep hit MC is no longer auto-joined (app.js, another lane) — it
  // hands the player the choice instead. `null` clears the row (nothing found, or MC is already bound).
  setDiscovered(d) { this.discovered = d || null; this.sig = null; }
  setDiag(d) { this.diagData = d; if (this.diag.classList.contains('open')) this.renderDiag(); }
  // F156/F135/ledger#31 (field 2026-09-12): the diag panel now carries its own `#mcurl` + SCAN QR (below), the
  // one join control reachable in EVERY phase. The pre-join screen's own copy (same id) must not coexist with
  // it in the DOM at once, so opening/closing the panel claims/releases the id on the diag copy AND forces the
  // underlying screen to rebuild around it (`_lobby` hides its own copy while this one holds the id) — same
  // pattern `onLoInfo` already uses to swap a pane with no engine-state change behind it.
  toggleDiag() {
    this.diag.classList.toggle('open');
    const open = this.diag.classList.contains('open');
    if (open) this.renderDiag();   // builds the shell (and the .mcurlfield input) on first open
    const inp = this.diag.querySelector('.mcurlfield');
    if (inp) { if (open) inp.id = 'mcurl'; else inp.removeAttribute('id'); }
    this.sig = null; if (this._lastSt) this.render(this._lastSt);
  }

  render(st) {
    this._lastSt = st;
    if (!st.ended) this.view = null;   // a new match retires a reopened results/history screen
    if (this.board && !(st.phase === 'live' && st.alive)) this.board = null;   // the scores overlay belongs to the live screen only
    this.frame.dataset.team = st.teamKey || 'blue';
    this.frame.dataset.env = st.night ? 'night' : '';
    // F288: gun health owns the top alert lane. Lower-priority chips are hidden by CSS while this flag is
    // present, rather than stacking over the fault or pushing it into the smoke / hit-effect lane.
    if (this._gunHealthActive(st)) this.frame.dataset.gunHealth = '';
    else delete this.frame.dataset.gunHealth;
    if (this.board) this.frame.dataset.board = this.board; else delete this.frame.dataset.board;
    const sig = [st.phase, st.alive, !!st.killedBy, st.night, st.ready, st.tutorial, !!st.resync, st.callsign, st.teamKey, st.weapon, st.endAck, st.ended, st.kills, st.underFire, st.tutorialWeapon && st.tutorialWeapon.weapon_id,
      st.mode, st.gun && st.gun.name, st.switching, st.activeSlot, st.hp <= st.maxHp * .25, (st.mag ? st.ammo / st.mag : 1) <= .15, st.ammo === 0, st.reserve === 0, (st.mag || 0) > AMMO_PIP_MAX, st.battery != null && st.battery <= 15,
      st.heatEverSeen, st.overheatShown, !!(st.aim && AIM_REASON[st.aim.reason]),   // S53: the smoke tell takes the centre slot from the reticle / TAKING FIRE   // bench 2026-09-17: OVERHEAT prompt/overlay and the heat bar's existence are structural, not patched in place. `st.overheating` (the mechanic) is not read here at all: the HUD draws the display window only
      chargeCost(st) != null && st.ammo != null && st.ammo < chargeCost(st), st.reserve > 0,   // OUT OF ENERGY / RECHARGE prompt + the NOT ENOUGH ENERGY note are structural too
      // F288: both gun-health facts change live markup. Flatten the objects: joining the objects themselves
      // would turn every non-null value into the same "[object Object]" and miss no_fire → no_answer.
      st.poolStale && st.poolStale.why, st.cure && st.cure.verdict, !!st.gunFlapping, !!st.reconciling, !!st.gunLocked, st.gunRecovery, st.downReason,
      // F258: `this.scan.length` used to sit here, so every scan hit that added a device rebuilt the
      // whole screen. The picker's rows, its empty placeholder and its fold are all patched in place
      // by `_patchScan` now, so nothing about the scan is structure any more.
      st.kills > 0, st.deaths > 0, st.assists > 0, accShown(st) != null, st.reserve != null, st.bleUp, st.ended, this.bluetoothOn,
      this.discovered && this.discovered.url,   // Polish-loop pass 1: the discovered-MC row on the pre-join screen (`_joinConfirm` only touches the diag panel, patched directly, not here)
      st.rejoin, !!st.pendingTeardown, this.sync && this.sync.bound, this.sync && this.sync.pending,
      // F137 (field 2026-09-12, found verifying the fix below): the pre-kit CONNECTED screen swaps a whole
      // block (the type-address box vs "MC LINKED") on `wsState`, not just text — `_patch` only ever touched
      // `#mcstatus`'s TEXT, so with wsState excluded from the signature that swap needed some UNRELATED field
      // to change too before it would ever rebuild; on the otherwise-static pre-kit screen it often never
      // did, and MC could bind with the player never told. The `typing` guard below already protects the
      // input from a rebuild while it has focus, so this does not reopen the "never rebuild while typing"
      // case the old comment (still true of `synced`/`headEcho`, which stay patched-only) was written for.
      st.wsState,
      // A10 loadout browser + slot plates
      // Pass 3: `tryoutUnconfirmed` is now an object ({tab, kind}) or null — every OTHER object in this join
      // stringifies to the same "[object Object]" too, so it is flattened to its own fields; the join
      // would otherwise never notice a switch from one arm's identity to another's.
      st.browsing, st.canPickPrimary, st.canPickSecondary, st.canPickPerk, st.tryoutSeen, st.tryoutArming,
      st.tryoutUnconfirmed && st.tryoutUnconfirmed.tab, st.tryoutUnconfirmed && st.tryoutUnconfirmed.kind,
      this.lo.tab, this.lo.filter, this.lo.focus, this.lo.confirm && this.lo.confirm.key,
      st.kitOpen, st.briefSeen, st.kitLocked, st.standby, st.game && st.game.name, st.game && st.game.loadout_line,
      st.loadoutAck && st.loadoutAck.t, st.pendingPick && st.pendingPick.id, st.pendingPick && st.pendingPick.kind,
      st.loadout && st.loadout.primary && st.loadout.primary.weapon_id, st.loadout && st.loadout.secondary && st.loadout.secondary.weapon_id, st.loadout && st.loadout.perk && st.loadout.perk.perk_id,
      !!(st.loadout && st.loadout.overrides && st.loadout.overrides.easy_reload),
      !!(st.catalog && st.catalog.weapons && st.catalog.weapons.length),
      // A24 FINAL RESULTS: the headline changes when the result lands and again when the settle window expires,
      // and the toggle/history are structure. `resultWait` is in here because "MC NOT REACHED" appears with NO
      // message arriving — nothing else in the signature moves at that moment.
      this.view, this.rtab, st.resultWait,
      this.board, this.board && st.scoreAt, this.board && st.fragLimit,   // bench 2026-09-17: the scores overlay rebuilds on a new MC push while it is open st.result && st.result.match_id, st.result && st.result.outcome,
      st.result && st.result.provisional, st.result && st.result.rows && st.result.rows.length,
      this.history && this.history.length, this.sessionId, st.game && st.game.mc_verify].join('|');   // synced / headEcho stay patched in place (F137: wsState moved INTO the signature above — see the note there)
    const panel = st.phase === 'kitted' && ((st.ended && (!st.endAck || !!this.view)) || (!st.ended && st.kitOpen && !st.briefSeen && !this._tryoutShown(st)) || (!st.ended && st.browsing && !this._tryoutShown(st)));
    const screen = st.phase === 'live' ? 'live' : st.phase === 'armed' ? 'armed' : st.phase === 'idle' ? 'idle' : panel ? (st.browsing ? 'lo' : 'panel') : 'lobby';
    if (this.frame.dataset.screen !== screen) this.frame.dataset.screen = screen;
    if (sig !== this.sig) {
      const urlEl = this.hudEl.querySelector('#mcurl');
      const typing = urlEl && typeof document !== 'undefined' && document.activeElement === urlEl;
      if (!typing) {
        const lst = this.hudEl.querySelector('.list, .lolist'); const keep = lst ? lst.scrollTop : 0;   // keep the picker's/browser's scroll across re-renders
        this.sig = sig; this.hudEl.innerHTML = this._structure(st);
        if (keep) { const l2 = this.hudEl.querySelector('.list, .lolist'); if (l2) l2.scrollTop = keep; }
        const fo = this.hudEl.querySelector('.lrow.fo'); if (fo && fo.scrollIntoView) { try { fo.scrollIntoView({ block: 'nearest' }); } catch (_) { /* jsdom */ } }
      }
    }
    this._patch(st);
    this._patchScan();   // F258: the picker's rows are written in place, never rebuilt
    this._shotCue(st);
    this._skinSwitch(st);
    this._chips(st);
    this._moments(st);
    this._fitBriefing();
    this._fitMcLinked();
    this._fitLoDetailName();
  }

  /** Bench 2026-09-17: the skin is each player's own choice. The switch shows the skin a tap gives (☾ on day, ☀ on
   *  night). The live night label names NIGHT OPS only when the venue is set to it; otherwise it is just "NIGHT". */
  _skinSwitch(st) {
    const on = !!st.night;
    if (this.skin) {
      if (this.skin.dataset.on !== String(on)) { this.skin.dataset.on = String(on); this.skin.innerHTML = on ? SKIN_SUN : SKIN_MOON; }
      if (this.skin.getAttribute('aria-checked') !== String(on)) this.skin.setAttribute('aria-checked', String(on));
    }
    const lab = this.hudEl.querySelector('.nightlab'), txt = st.nightOps ? 'NIGHT OPS' : 'NIGHT';
    if (lab && lab.textContent !== txt) lab.textContent = txt;
  }

  /** F137 (field 2026-09-12): "MC LINKED ✓ — WAITING FOR KIT-OUT" at the design 28px wrapped to two
   *  uncentred lines inside a padding-less box (the first line ran to the border) at every width this was
   *  checked at — nothing here ever fitted it. Same measure-then-shrink loop as `_fitBriefing`/`_redeploy`;
   *  the CSS gives it `white-space:nowrap` so `scrollWidth` reports the true one-line width to shrink against,
   *  same contract those two already rely on. */
  _fitMcLinked() {
    const nm = this.hudEl.querySelector('.mclinked .unskew');
    if (!nm) { this._mlFit = null; return; }
    const key = nm.textContent + '|' + (nm.parentElement ? nm.parentElement.clientWidth : 0);
    if (this._mlFit !== key) { this._mlFit = key; nm.style.fontSize = ''; }
    if (nm.scrollWidth <= nm.clientWidth + 1) return;
    let fs = parseFloat(getComputedStyle(nm).fontSize) || 28;
    while (nm.scrollWidth > nm.clientWidth + 1 && fs > 15) { fs -= 1; nm.style.fontSize = fs + 'px'; }
  }

  /** Polish-loop pass 2 (found verifying "EQUIPPED · UNCONFIRMED"): the rack's detail-pane `.nm` (weapon
   *  name + role chip + heroTag, all on one `white-space:nowrap` line) has no shrink of its own — a long
   *  enough combination overflows and gets clipped by the CSS ellipsis with no visible fallback. Confirmed
   *  pre-existing (a plain "ASSAULT RIFLE" + role chip + "EQUIPPED" already overflowed at some widths,
   *  independent of this pass); the longer UNCONFIRMED badge just made it reliably visible. Same
   *  measure-then-shrink loop as `_fitMcLinked`/`_fitBriefing`. */
  _fitLoDetailName() {
    const nm = this.hudEl.querySelector('.lodetail .nm');
    if (!nm) { this._loNmFit = null; return; }
    const key = nm.textContent + '|' + nm.clientWidth;
    if (this._loNmFit !== key) { this._loNmFit = key; nm.style.fontSize = ''; }
    if (nm.scrollWidth <= nm.clientWidth + 1) return;
    let fs = parseFloat(getComputedStyle(nm).fontSize) || 24;
    while (nm.scrollWidth > nm.clientWidth + 1 && fs > 13) { fs -= 1; nm.style.fontSize = fs + 'px'; }
  }

  /** F110 (review): `.bfbody` is a fixed 268 px box whose rows are `flex:0 0 auto`, i.e. purely additive — a
   *  game NAME that wraps to two lines at 40 px pushes the rows below it straight through the CTA footer.
   *  The kicker and the loadout line are clamped in CSS; the name is the row that carries a host's arbitrary
   *  text, so it is fitted to whatever room is left, the same measure-then-shrink loop `_redeploy` uses. */
  _fitBriefing() {
    const body = this.hudEl.querySelector('.bf .bfbody');
    if (!body) { this._bfFit = null; return; }
    const nm = body.querySelector('.bfname'); if (!nm) return;
    // Re-checked every render, not memoised on the text: the webfont swaps in AFTER the first paint and a name
    // that fitted on one line in the fallback face wraps to two in Saira Condensed — a one-shot fit measured
    // the wrong font and left the overflow on screen. New content starts again from the design size.
    const key = nm.textContent + '|' + body.clientHeight;
    if (this._bfFit !== key) { this._bfFit = key; nm.style.fontSize = ''; }
    if (body.scrollHeight <= body.clientHeight) return;
    let fs = parseFloat(getComputedStyle(nm).fontSize) || 40;
    while (body.scrollHeight > body.clientHeight && fs > 18) { fs -= 2; nm.style.fontSize = fs + 'px'; }
  }

  // ---------- structure per phase ----------
  _structure(st) {
    switch (st.phase) {
      case 'idle': return this._idle(st);
      case 'connected': return this._lobby(st, 'connected');
      case 'kitted':
        // T2-B item 2: benched overrides everything else on this phase -- no results/briefing/loadout
        // screen should ever race a SITTING OUT one (the server refuses stand_down once a match is
        // armed/live, so `st.ended` and `st.standby` should never actually coincide; this is the order
        // that stays true even if they somehow did).
        if (st.standby) return this._lobby(st, 'standby');
        // A24: the results screen is reachable twice — before OK, and again from RESULTS / HISTORY on the over screen.
        if (st.ended && this.view === 'history') return this._history(st);
        if (st.ended && (!st.endAck || this.view === 'result')) return this._result(st);
        if (!st.ended && !st.kitOpen) return this._lobby(st, 'setup');            // §4.1: MC is still picking the game
        if (!st.ended && !st.briefSeen && !this._tryoutShown(st)) return this._briefing(st);   // §4.6: read the game, then BUILD MY KIT ▸
        if (!st.ended && st.browsing && !this._tryoutShown(st)) return this._loadout(st);
        return this._lobby(st, st.ended ? 'over' : 'kitted');
      case 'lobby':
        // T2 INTEGRATION (A38 x A39): the same override the 'kitted' arm above makes, stated for the
        // one other phase a benched phone could be READ in. It should not be reachable -- `_assign`
        // pulls a benched node back to 'kitted' and `_applyConfig`'s own standby guard refuses the
        // relink re-push that is the only other way back to LOBBY -- so this is the ORDERING rule, not
        // a live path: standby is decided before F-4's lobby READY UP button (below, `mode === 'lobby'
        // && !st.kitOpen && !st.ready`) is ever considered. The two lanes landed those two facts
        // independently; whichever of the three guards is relaxed later, a player MC has taken off the
        // roster must not be shown the control that puts them back on it.
        if (st.standby) return this._lobby(st, 'standby');
        return this._lobby(st, 'lobby');
      case 'armed': return '';
      case 'live': return this._live(st);
      default: return '';
    }
  }

  // F211: with Bluetooth off the picker used to just sit empty, with no line telling the player why
  // (game-test-2026-09-13.md C2). `bluetoothOn` is app.js-owned (constructor note above) and re-checked
  // on every SET MY GUN tap and on the OS adapter-state notification, so this only ever shows what the
  // phone reports right now. The buttons only appear where the plugin actually offers them (Android).
  _idleBtOff() {
    const android = this.platform === 'android';
    return `<div class="sc bad"><i></i>BLUETOOTH IS OFF</div>
      <div class="small bad" style="letter-spacing:normal;font-weight:400;line-height:1.5">Turn on Bluetooth to see nearby taggers.</div>
      ${android ? `<button class="bigbtn ghost" data-act="onEnableBluetooth"><span class="unskew">TURN ON BLUETOOTH</span></button>
      <button class="bigbtn ghost" data-act="onOpenBluetoothSettings"><span class="unskew">BLUETOOTH SETTINGS</span></button>` : ''}
      <div class="help">The list fills in on its own once Bluetooth is back on.</div>`;
  }

  // F258: the picker's list is now a FIXED structure that `_patchScan` writes into — four boxes that
  // never come and go, so a row node survives every re-render and a tap can land on it.
  _scanList() {
    return `<div class="list"><div class="taggers"></div>
      <div class="connecting" hidden><div class="cn"></div><div class="cbar"><i></i></div><div class="cst"></div></div>
      <div class="small nonefound">Scanning…</div>
      <button class="bigbtn ghost rescan" data-act="onScanAgain" hidden><span class="unskew">SCAN AGAIN</span></button>
      <button class="othertog" data-act="onScanOther" hidden><span class="unskew"></span></button>
      <div class="others" hidden></div></div>`;
  }

  _idle(st = {}) {
    return `<div class="idle"><div class="scan"></div>
      <div class="l"><span class="wm">BRX<b>/</b></span><span class="sub">COMBAT HUD</span>
        ${st.rejoin ? '<span class="note" style="color:var(--warn)">MATCH IN PROGRESS — SET YOUR GUN TO REJOIN</span>' : ''}
        <button class="bigbtn" data-act="onSetGun"><span class="unskew">SET MY GUN ▸</span></button>
        <button class="bigbtn ghost" data-act="onDemo"><span class="unskew">DESKTOP DEMO</span></button>
        <button class="bigbtn ghost util" data-act="onUtility"><span class="unskew">▣ UTILITY MODE</span></button></div>
      <div class="r">${this.bluetoothOn === false ? this._idleBtOff() :
        `<div class="sc"><i></i>SCANNING FOR TAGGERS</div>${this._scanList()}
        <div class="help">Tagger not listed? Power-cycle it — it'll appear within a couple seconds.</div>`}</div></div>`;
  }

  /** F258 (bench 2026-09-18): a scan hit must never destroy a row. This reconciles the picker's DOM
   *  against `this.scan` — it writes the signal reading into the row that is already on screen, adds
   *  the rows that are new, and moves a row only when its order genuinely changed. Rows the picker
   *  ranked as `other` (neither the assigned gun, nor a Nordic UART advert, nor a tagger-shaped name)
   *  go behind a fold, so a muster does not put a player's own gun at position 12 behind two
   *  televisions and a Hatch Rest. */
  _patchScan() {
    const list = this.hudEl.querySelector('.idle .list'); if (!list) return;
    const main = list.querySelector('.taggers'), other = list.querySelector('.others');
    const tog = list.querySelector('.othertog'), none = list.querySelector('.nonefound');
    if (!main || !other || !tog || !none) return;
    // App 0.4.2: while a picked gun connects, the rows give way to one "Connecting to <gun>" block.
    const conn = this.connecting, cbox = list.querySelector('.connecting');
    const near = conn ? [] : this.scan.filter(d => !d.other), far = conn ? [] : this.scan.filter(d => d.other);
    this._patchScanRows(main, near);
    this._patchScanRows(other, far);
    if (cbox) {
      if (cbox.hidden !== !conn) cbox.hidden = !conn;
      if (conn) {
        const cn = cbox.querySelector('.cn'), cst = cbox.querySelector('.cst');
        const { head, line } = connectingText(conn);
        if (cn.textContent !== head) cn.textContent = head;
        if (cst.textContent !== line) cst.textContent = line;
        const cls = conn.failed ? 'connecting bad' : 'connecting';
        if (cbox.className !== cls) cbox.className = cls;
      }
    }
    const hideNone = near.length > 0 || !!conn;
    if (none.hidden !== hideNone) none.hidden = hideNone;
    // Game day 2026-09-19: the list showed empty with no scan running, and nothing said so. Now an empty
    // list says whether a scan runs, and always offers SCAN AGAIN.
    const noneTxt = this.scanActive ? 'Scanning…' : 'No guns found. Turn the gun on, then tap Scan again.';
    if (none.textContent !== noneTxt) none.textContent = noneTxt;
    const rescan = list.querySelector('.rescan');
    const hideRescan = conn ? !conn.failed : hideNone;   // a failed connect offers SCAN AGAIN; a running one does not
    if (rescan && rescan.hidden !== hideRescan) rescan.hidden = hideRescan;
    const sc = this.hudEl.querySelector('.idle .sc'), scOn = this.scanActive && !conn;
    if (sc && sc.hidden === scOn) sc.hidden = !scOn;
    if (tog.hidden !== (far.length === 0)) tog.hidden = far.length === 0;
    const lab = `${this.scanOther ? '▾' : '▸'} OTHER DEVICES (${far.length})`;
    const span = tog.firstElementChild;
    if (span && span.textContent !== lab) span.textContent = lab;
    if (other.hidden === this.scanOther) other.hidden = !this.scanOther;
  }

  /** Reconciles one box's `.tagrow` children against `rows`, keyed on `deviceId`. */
  _patchScanRows(box, rows) {
    const have = new Map();
    for (const el of box.children) if (el.dataset && el.dataset.arg) have.set(el.dataset.arg, el);
    let prev = null;
    for (const d of rows) {
      let el = have.get(d.deviceId);
      if (el) have.delete(d.deviceId);
      else {
        el = this.root.createElement('div');
        el.className = 'tagrow'; el.dataset.act = 'onPick'; el.dataset.arg = d.deviceId;
        el.innerHTML = SCAN_ROW;
      }
      this._writeScanRow(el, d);
      const want = prev ? prev.nextElementSibling : box.firstElementChild;
      if (want !== el) box.insertBefore(el, want);   // only a REAL order change moves a node
      prev = el;
    }
    for (const el of have.values()) el.remove();
  }

  /** Writes one row's visible facts, touching only what actually changed. */
  _writeScanRow(el, d) {
    const [nm, tail] = splitGun(d);
    // Office test 2026-09-19: the picker repaints every PAINT_MS while a scan runs (gunpicker.js), and a
    // touch's press class (`tap-press`, set by `_tapDown` on pointerdown) can land inside that same window.
    // Setting `className` outright used to wipe it before the browser ever painted it -- a tap straddling a
    // repaint tick showed no press animation at all. `classList.toggle` leaves any class this method does
    // not own alone.
    if (el.classList.contains('used') !== !!d.inUse) el.classList.toggle('used', !!d.inUse);
    const name = el.querySelector('.nm'), html = `${nm}<b>-${tail}</b>`;
    if (name && name.innerHTML !== html) name.innerHTML = html;
    const inuse = el.querySelector('.inuse'), sig = el.querySelector('.sig');
    if (inuse && inuse.hidden !== !d.inUse) inuse.hidden = !d.inUse;
    if (sig && sig.hidden !== !!d.inUse) sig.hidden = !!d.inUse;
    if (!sig) return;
    const bars = sig.querySelectorAll('i');
    SIG_THRESHOLDS.forEach((thr, i) => {
      const on = d.rssi != null && d.rssi >= thr ? 'on' : '';
      if (bars[i] && bars[i].className !== on) bars[i].className = on;
    });
    const num = sig.querySelector('b'), txt = d.rssi != null ? String(d.rssi) : '';
    if (num && num.textContent !== txt) num.textContent = txt;
  }

  _lobby(st, mode) {
    const [nm, tail] = splitGun(st.gun);
    const cs = esc(st.callsign || (mode === 'connected' ? 'LINKED' : 'OPERATOR'));
    const team = st.teamName ? `<span class="chip"><span class="unskew">${esc(st.teamName)} SQUAD</span></span>` : '';
    const tw = this._tryoutShown(st) ? st.tutorialWeapon : null;
    // MC pushes a WeaponView here (it carries the ranked `bars`), which names the magazine `clip`;
    // older servers push the raw catalog row, where it is `stats.mag`. Accept both.
    const twStats = tw && tw.stats ? tw.stats : (tw || {});
    const twMag = [twStats.mag, tw && tw.clip, tw && tw.mag].find(v => v != null);
    const twRes = [twStats.reserve, tw && tw.reserve].find(v => v != null);
    const bar = (label, v) => v == null ? '' : `<div class="tb"><span>${label}</span><i><b style="width:${Math.max(0, Math.min(100, v))}%"></b></i></div>`;
    const tryout = tw ? `<div class="tryout">
        <div class="art">${weaponArt(tw.weapon_id)}</div>
        <div class="meta"><div class="lbl">TRY-OUT · FIRE A FEW ROUNDS</div><div class="nm">${esc((tw.name || tw.weapon_id || '').toUpperCase())}</div>
          <div class="ln">MAG ${twMag != null ? twMag : '—'} · RESERVE ${twRes != null ? twRes : '—'}${tw.role ? ' · ' + esc(roleName(tw)) : ''}</div>
          ${statBlock(tw, { compact: true })}</div>
        <div class="tact"><button class="lobtn ghost" data-act="onTryDone"><span class="unskew">DONE</span></button><div class="small">Keeps the gun armed with this weapon.</div></div></div>` : '';
    // Ammo is unknown until the game is pushed/armed — say so in words instead of showing "MAG — · RESERVE —".
    const _mag = st.loadMag != null ? st.loadMag : (st.mag != null ? st.mag : null);
    const _res = st.loadReserve != null ? st.loadReserve : (st.reserve != null ? st.reserve : null);
    const ammoLine = (_mag == null && _res == null) ? 'SET AT ARM TIME'
      : `<span class="nw">MAG ${_mag != null ? _mag : '—'} · RES ${_res != null ? _res : '—'}</span>`;   // one line, never a dangling separator (breaker 2026-09-03); RES: the A14 plate is 250px
    // A14: three plates — PRIMARY / SECONDARY / PERK; HP · ARMOR moved up into the header line
    const plates = st.player && mode !== 'setup' ? `${tryout}<div class="plates" ${tw ? 'style="display:none"' : ''}>
        ${this._slotPlate(st, 'primary', mode, ammoLine)}${this._slotPlate(st, 'secondary', mode)}${this._slotPlate(st, 'perk', mode)}
        ${mode === 'kitted' && !tw && (st.canPickPrimary || st.canPickSecondary || st.canPickPerk) ? '<div class="platehint">TAP A SLOT TO CHANGE YOUR LOADOUT</div>' : ''}</div>` : '';
    const hpar = st.player && mode !== 'setup' ? `<span class="hpar tab"><span style="color:var(--health)">HP ${st.maxHp}</span> · <span style="color:var(--armor)">ARMOR ${st.maxArmor}</span>${st.maxShield > 0 ? ` · <span style="color:var(--shield)">SHIELD ${st.maxShield}</span>` : ''}${st.playerNum ? ` · #${st.playerNum}` : ''}</span>` : '';
    // A27/A30 (loadout.md §4.4): a host advance that lands mid-kit is never a silent screen swap, and a refusal
    // from MC is MC's own copy — shown VERBATIM on whichever screen the player is standing on when it arrives.
    const refusal = st.loadoutAck && !st.loadoutAck.ok && st.loadoutAck.reason ? String(st.loadoutAck.reason) : null;
    const lead = (mode === 'kitted' || mode === 'lobby') && (refusal || st.kitLocked)
      ? `<div class="kitlock">${refusal ? esc(refusal.toUpperCase()) : 'THE HOST LOCKED KITS — you play what you had'}</div>` : '';
    let foot, status;
    // F156/F135 (field 2026-09-12): the join controls now also live in the ⓘ panel (`_diagShell`), reachable
    // from every phase — same `#mcurl` id, so this copy steps aside rather than duplicate it while that
    // panel is open (`onSetUrl` reads the input by id; app.js is another lane, so there can only be one).
    const diagHasJoin = this.diag.classList.contains('open');
    if (mode === 'connected') {
      foot = st.wsState === 'bound'
        ? `<div class="mclinked"><span class="unskew">MC LINKED ✓ — WAITING FOR KIT-OUT</span></div><div class="note">Mission Control has this gun. Your callsign and loadout arrive with the kit.</div>`
        : diagHasJoin
        ? `<div class="note join">Connecting from the ⓘ panel, top right — it's already open.</div>`
        // Polish-loop pass 2: mDNS no longer auto-joins (app.js review pass 2 — a phone must never hand its
        // takeover key/join secret to whoever answers first), so "it connects by itself" was now FALSE.
        : `${discoveredRow(this.discovered)}<div class="mcin"><input id="mcurl" value="${esc(this.mcUrl)}" placeholder="ws://mission-control-ip:8766/ws" inputmode="url"><button data-act="onSetUrl">CONNECT</button></div><button class="qrbtn" data-act="onScanQr">▣ SCAN QR</button><div class="note join">On the same Wi-Fi it appears here: tap JOIN. Otherwise scan the QR or type its address.</div>`;
      status = `<div class="status" id="mcstatus">${this._statusLine(st, mode)}</div>`;
    } else if (mode === 'setup') {
      // §4.1: calm, not an error — the host hasn't picked the game yet
      foot = `<div class="setup"><div class="pulse"><i></i><i></i><i></i></div><div class="in"><div class="t">HOST IS SETTING UP THE GAME</div><div class="s">Your kit opens as soon as the host picks the game. Nothing to do yet.</div></div></div>`;
      status = `<div class="status" id="mcstatus">${this._statusLine(st, 'kitted')}</div>`;
    } else if (mode === 'standby') {
      // T2-B item 2: MC benched this player. Calm, not an error, same shape as `setup` above.
      foot = `<div class="setup"><div class="pulse"><i></i><i></i><i></i></div><div class="in"><div class="t">SITTING OUT — the host puts you back</div><div class="s">Nothing to do for now. Your tagger is STILL LIVE — it can fire, and it can be tagged. The host puts you back in.</div></div></div>`;
      status = `<div class="status" id="mcstatus">${this._statusLine(st, 'kitted')}</div>`;
    } else if (mode === 'kitted') {
      // Bench 2026-09-16: "only the label changes" — `st.ready` already IS the confirmed state (a tap
      // only sets it once `setReady` clears the standby/phase/clock-sync guards, engine.js), so the
      // green treatment below tracks the same flag; `aria-pressed` says so explicitly, for a11y and so
      // a test can read the confirmed state without parsing a colour.
      foot = `${lead}<button class="ready ${st.ready ? '' : 'off'}" data-act="onReady" aria-pressed="${!!st.ready}"><span class="unskew">${st.ready ? 'READY ✓' : 'READY UP'}</span></button><div class="note" id="readynote">${this._readyNote(st)}</div>`;
      status = `<div class="status" id="mcstatus">${this._statusLine(st, mode)}</div>${st.game ? '<button class="briefbtn" data-act="onBriefing"><span class="unskew">▤ BRIEFING</span></button>' : ''}`;
    } else if (mode === 'over') {
      // F117: this is the one control gating the next match and it read as a status line — declarative label,
      // muted grey, 20px against the pre-match 26px, and the SAME classes as the genuinely inert STANDING BY
      // button. It now wears the pre-match READY UP treatment exactly, and the note leads with the instruction.
      // The note is `_readyNote`, the same one the kitted screen renders and patches: `setReady` REFUSES while
      // the clock is unsynced, and the hard-coded note said nothing about it — the one control gating the next
      // match went dead with no explanation on screen.
      foot = `<button class="ready ${st.ready ? '' : 'off'}" data-act="onReady" aria-pressed="${!!st.ready}"><span class="unskew">${st.ready ? 'READY ✓' : 'READY FOR NEXT MATCH ▸'}</span></button><div class="note" id="readynote">${this._readyNote(st, 'over')}</div>`;
      // A24 (game test D3: "let players get back to results after OK · maybe a match history"). The outcome word
      // is printed here ONLY out of `st.result` — with no result the line simply does not carry one.
      const rw = st.result ? (OUTCOME_WORD[st.result.outcome] || null) : null;
      status = `<div class="status">${rw ? `<b class="oc ${esc(String(st.result.outcome))}">${rw}</b> · ` : ''}D ${st.deaths} · K ${st.kills != null ? st.kills : '—'}</div>` +
        `<div class="overbtns"><button class="briefbtn" data-act="onShowResults"><span class="unskew">▣ RESULTS</span></button>` +
        `<button class="briefbtn" data-act="onShowHistory"><span class="unskew">▤ HISTORY</span></button></div>`;
    } else if (mode === 'lobby' && !st.kitOpen && !st.ready) {
      // F-4 (2026-09-13): `engine.setReady` now accepts a lobby tap once the kit is closed — for a
      // player whose kit-out window ended (a push or re-push that landed) before they ever hit READY
      // UP, this is the only door left. Same control, same note the kitted screen uses; a player who
      // is already `ready` still reads STANDING BY below, unchanged.
      foot = `${lead}<button class="ready off" data-act="onReady" aria-pressed="false"><span class="unskew">READY UP</span></button><div class="note" id="readynote">${this._readyNote(st)}</div>`;
      status = `<div class="status" id="mcstatus">${this._statusLine(st, mode)}</div>`;
    } else {
      // Bench 2026-09-16: a READY player in the lobby fell through to this grey STANDING BY button, so readying
      // up only changed the label. A confirmed `st.ready` now wears the green `.ready.wait.on` and says READY.
      // Playtest review 2026-09-13: this button has no `data-act` -- it does nothing on tap -- but it still got
      // `.tap-press` feedback (the delegated handler matches any `<button>`) and `aria-pressed`, so it looked and
      // was announced as a toggle. `aria-disabled="true"` makes the press handler skip it (it already checks
      // this attribute); drop `aria-pressed` since it is not a control. The green `.on` ready state stays.
      foot = `${lead}<button class="ready wait${st.ready ? ' on' : ''}" aria-disabled="true"><span class="unskew">${st.ready ? 'READY ✓ · STANDING BY' : 'STANDING BY'}</span></button><div class="note">${st.kitLocked ? 'The plates above are what you take in. Waiting for the host to start the countdown.' : 'Loadout is on the gun. Waiting for the host to start the countdown.'}</div>`;
      status = `<div class="status" id="mcstatus">${this._statusLine(st, mode)}</div>`;
    }
    return `<div class="lobby"><div class="scan"></div><div class="edgeglow"></div>
      <div class="top"><span class="cs">${cs}</span><span class="row">${team}<span class="gid">${nm}-${tail}</span>${hpar}</span></div>${plates}
      <div class="tr">${status}</div><div class="foot">${foot}</div></div>`;
  }

  /** A26: the try-out panel is a KITTED-screen takeover, and under A26 every weapon tap arms a try-out — so
   *  inside the browser it would eject the player from the rack on every pick. While the browser is open the
   *  browser stays: the arming shows as the row's ⟳ → ✓ and the "TRY-OUT ARMED" chip in the action bar. The
   *  panel survives for the one case that is still real: MC pushing a try-out at a player on the plates. */
  _tryoutShown(st) { return !!(st.tutorial && st.tutorialWeapon && st.tryoutSeen !== st.tutorialWeapon.weapon_id && !st.browsing); }

  // ---------- A10 §4.6: the BRIEFING — the chosen game, read at the player's own pace ----------
  _briefing(st) {
    const g = st.game || {};
    const mode = g.mode || st.mode || 'tdm';
    const name = g.name || g.mode_name || String(mode).toUpperCase();
    const mins = g.time_limit_s ? Math.round(g.time_limit_s / 60) : null;
    const rs = g.respawn ? (g.respawn.type === 'none' ? 'NONE · LIVES' : `${g.respawn.type === 'scanner' ? 'AT A SCANNER' : 'AUTO'} · ${g.respawn.delay_s}s`) : (g.respawn_text || '—');
    const hp = g.health ? `${g.health.max_hp} HP · ${g.health.max_armor} ARMOR${g.health.max_shield > 0 ? ` · ${g.health.max_shield} SHIELD` : ''}` : '—';
    const venue = [g.environment ? String(g.environment).toUpperCase() : null, g.night ? 'NIGHT OPS' : null].filter(Boolean).join(' · ') || '—';
    const rows = [['TEAMS', g.teams_text || '—'], ['WIN', g.win_text || '—'], ['RESPAWN', rs], ['TIME', mins ? `${mins} MIN` : '—'], ['LIFE', hp], ['VENUE', venue]];
    const locked = !st.canPickPrimary && !st.canPickSecondary && !st.canPickPerk;
    const cta = locked ? 'SEE MY KIT ▸' : 'BUILD MY KIT ▸';
    const sub = locked ? 'Your kit is set by the host — take a look.' : 'Pick your weapons when you are ready.';
    return `<div class="lobby bf" data-mode="${esc(mode)}"><div class="scan"></div><div class="edgeglow"></div>
      <div class="bfart" style="background-image:url('assets/modes/${esc(mode)}.jpg')"></div><div class="bfveil"></div>
      <div class="bfbody">
        <div class="bfk r r0">${g.abbr ? `<span class="chip"><span class="unskew">${esc(g.abbr)}</span></span>` : ''}<span class="lab">GAME BRIEFING${g.ruleset ? ' · ' + esc(g.ruleset) : ''}</span></div>
        <div class="bfname r r1">${esc(String(name).toUpperCase())}</div>
        ${g.desc ? `<div class="bfdesc r r2">${esc(g.desc)}</div>` : ''}
        <div class="bfrules r r3">${rows.map(([k, v]) => `<div class="cell"><span class="k">${k}</span><span class="v">${esc(String(v))}</span></div>`).join('')}</div>
        ${g.loadout_line ? `<div class="bfload r r4"><span class="k">LOADOUT</span><span class="v">${esc(g.loadout_line)}</span></div>` : ''}
      </div>
      <div class="bffoot r r5"><span class="who"><span class="cs">${esc(st.callsign || '')}</span>${st.playerNum ? `<span class="num">#${st.playerNum}</span>` : ''}</span>
        <div class="cta"><button class="ready go" data-act="onBriefDone"><span class="unskew">${cta}</span></button><div class="note">${sub}</div></div></div></div>`;
  }

  // ---------- A10: slot plates + the LOADOUT browser (docs/spec/loadout.md §4.5) ----------
  /** One KITTED plate. `slot` ∈ primary | secondary | perk (A14: the perk is its own slot). */
  _slotPlate(st, slot, mode, ammoLine) {
    const lo = st.loadout || {}; const item = lo[slot] || null;
    const rule = st.policy ? st.policy[slot] : null;
    const can = slot === 'primary' ? st.canPickPrimary : slot === 'secondary' ? st.canPickSecondary : st.canPickPerk;
    const locked = mode === 'kitted' && st.policy && !can && rule && rule.choice !== 'player';
    const k = slot.toUpperCase();
    const noneSub = slot === 'perk' ? (rule && rule.choice === 'off' ? 'NO PERKS' : 'NO PERK') : (rule && rule.choice === 'off' ? 'NO SECONDARY' : 'NO ALT-FIRE');
    let art = '', h = '', sub = '';
    if (item && item.kind === 'perk') { art = `<div class="thumb perk">${perkGlyph(item.perk_id)}</div>`; h = esc(item.name); sub = esc(perkEffect(item, true)); }   // the line is ~150px wide: the GAIN only (S50), the cost is in the browser row
    else if (item) { art = `<div class="thumb">${weaponArt(item.weapon_id)}</div>`; h = esc(item.name); sub = slot === 'primary' ? (ammoLine || '') : `<span class="nw">MAG ${item.clip != null ? item.clip : '—'} · RES ${item.reserve != null ? item.reserve : '—'}</span>`; }
    else { art = '<div class="thumb none"><span>—</span></div>'; h = 'NONE'; sub = noneSub; }
    if (locked) sub = (rule.choice === 'fixed' ? 'FIXED BY THE HOST' : rule.choice === 'off' ? noneSub : 'SET BY THE HOST');
    const lock = locked ? `<span class="lock" aria-label="locked">${LOCK_SVG}</span>` : (can ? '<span class="cue">▸</span>' : '');
    return `<div class="plate wart slot ${slot === 'perk' ? 'pk' : ''} ${can ? 'tap' : ''} ${locked ? 'locked' : ''}" data-slot="${slot}" ${can ? `data-act="onOpenLoadout" data-arg="${slot}"` : ''}>${art}<div class="in"><div class="k">${k}${lock}</div><div class="h">${h.toUpperCase()}</div><div class="s">${sub}</div></div></div>`;
  }

  /** Rows for a tab: [{key, kind, id, row, allowed}] in catalog order, filtered to the player's pool. */
  _loRows(st, tab) {
    const cat = st.catalog || { weapons: [], perks: [] }; const rule = st.policy ? st.policy[tab] : null;
    if (tab === 'primary') { const ok = new Set((rule && rule.allowed_ids) || []); return (cat.weapons || []).filter(w => ok.has(w.weapon_id)).map(w => ({ key: 'weapon:' + w.weapon_id, kind: 'weapon', id: w.weapon_id, row: w })); }
    if (tab === 'perk') { const okP = new Set((rule && rule.allowed_perk_ids) || []); return (cat.perks || []).filter(p => okP.has(p.perk_id) && !p.hidden).map(p => ({ key: 'perk:' + p.perk_id, kind: 'perk', id: p.perk_id, row: p })); }   // A14: its own tab
    const okW = new Set((rule && rule.allowed_weapon_ids) || []);
    const kinds = (rule && rule.kinds) || ['weapon'];
    return (kinds.includes('weapon') || kinds.includes('sidearm')) ? (cat.weapons || []).filter(w => okW.has(w.weapon_id)).map(w => ({ key: 'weapon:' + w.weapon_id, kind: 'weapon', id: w.weapon_id, row: w })) : [];   // a pistol is still requested as kind "weapon"
  }
  _loadout(st) {
    const tab = this.lo.tab === 'secondary' ? 'secondary' : this.lo.tab === 'perk' ? 'perk' : 'primary';
    const lo = st.loadout || {}; const equipped = lo[tab] || null;
    const eqKey = equipped ? (equipped.kind === 'perk' ? 'perk:' + equipped.perk_id : 'weapon:' + equipped.weapon_id) : (tab === 'primary' ? null : 'none');
    const canOf = t => t === 'primary' ? st.canPickPrimary : t === 'secondary' ? st.canPickSecondary : st.canPickPerk;
    const can = canOf(tab);
    const rule = st.policy ? st.policy[tab] : null;
    const cf = this.lo.confirm && this.lo.confirm.tab === tab ? this.lo.confirm : null;   // A14: the pending two-tap confirm
    const pend = st.pendingPick && st.pendingPick.slot === tab ? (st.pendingPick.kind === 'none' ? 'none' : `${st.pendingPick.kind}:${st.pendingPick.id}`) : null;
    const ack = st.loadoutAck && st.loadoutAck.slot === tab ? st.loadoutAck : null;
    // Polish-loop pass 3 (MEDIUM): `tryoutUnconfirmed` used to be a bare flag applied to whatever row/tab
    // was on screen — a perk picked after a timed-out weapon arm inherited its OWN badge, on a row that
    // never armed anything. It now carries {tab, kind}; only the TAB (and, per row, the KIND) it was
    // actually about may show it.
    const unconfHere = !!(st.tryoutUnconfirmed && st.tryoutUnconfirmed.tab === tab);
    const rows = this._loRows(st, tab);
    const tabBtn = (t, item) => { const on = t === tab; const r = st.policy ? st.policy[t] : null; const lk = st.policy && !canOf(t) && r && r.choice !== 'player';
      const nm = item ? item.name : (t === 'primary' ? '—' : 'NONE');
      return `<button class="lotab ${on ? 'on' : ''} ${lk ? 'locked' : ''}" ${lk ? 'disabled aria-disabled="true"' : ''} data-act="onLoTab" data-arg="${t}"><span class="unskew"><span class="k">${t.toUpperCase()}${lk ? ' ' + LOCK_SVG : ''}</span><span class="v">${esc(nm).toUpperCase()}</span></span></button>`; };
    const name = r => r.kind === 'perk' ? r.row.name : r.row.name;
    const focusKey = (this.lo.focus && rows.some(r => r.key === this.lo.focus)) ? this.lo.focus : (eqKey && rows.some(r => r.key === eqKey) ? eqKey : (rows[0] ? rows[0].key : null));
    const focus = rows.find(r => r.key === focusKey) || null;
    let list = '';
    if (!can) {
      const why = rule && rule.choice === 'fixed' ? 'Fixed for this game — the host set it in Mission Control.' : rule && rule.choice === 'off' ? (tab === 'perk' ? 'No perks this game.' : 'No secondary this game.') : 'The host assigns this slot from Mission Control.';
      list = `<div class="lolock"><div class="big">${LOCK_SVG} SET BY THE HOST</div><div class="s">${why}</div>${equipped ? `<div class="cur">${esc(equipped.name).toUpperCase()}</div>` : ''}</div>`;
    } else {
      // A14: slot 2 is weapons only (its chip reads WEAPONS or SIDEARMS); the perk tab has its own PERKS chip; both carry NONE
      const noneBtn = `<button class="fch none ${eqKey === 'none' && pend == null ? 'on' : ''} ${pend === 'none' ? 'pend' : ''}" data-act="onLoNone" data-arg="${tab}"><span class="unskew">NONE${eqKey === 'none' ? ' ✓' : ''}</span></button>`;
      const filt = tab === 'secondary' ? `<div class="lofilt"><button class="fch on" data-act="onLoFilter" data-arg="weapons"><span class="unskew">${sidearmOnly(rule) ? 'SIDEARMS' : 'WEAPONS'} · ${rows.length}</span></button>${noneBtn}</div>`
        : tab === 'perk' ? `<div class="lofilt"><button class="fch on" data-act="onLoFilter" data-arg="perks"><span class="unskew">PERKS · ${rows.length}</span></button>${noneBtn}</div>` : '';
      const head = tab === 'primary' ? `<div class="locount">${rows.length} WEAPON${rows.length === 1 ? '' : 'S'} · SCROLL FOR MORE</div>` : '';
      list = head + filt + (rows.length ? rows.map(r => {
        // F147: MC acked this row (`eqKey`) but engine.js's `tryoutArming` says the gun has not confirmed the
        // write yet — that row keeps the SAME in-flight look (glow border, blinking ⟳) `pend` already has,
        // never the settled ✓, until the gun's own ammo report closes it out. Polish-loop pass 2: past the
        // 3 s timeout `tryoutArming` clears WITHOUT a confirming report — `tryoutUnconfirmed` marks that
        // honestly (`≈`, muted) instead of the same ✓ a real gun-confirmed pick gets.
        const rowUnconf = unconfHere && st.tryoutUnconfirmed.kind === r.kind;
        const eq = r.key === eqKey && !pend && !st.tryoutArming && !rowUnconf,
          arming = r.key === eqKey && !pend && !!st.tryoutArming,
          unconf = r.key === eqKey && !pend && !st.tryoutArming && rowUnconf,
          pn = r.key === pend, fo = r.key === focusKey, rj = !!(ack && !ack.ok && ack.key === r.key), wn = !!(cf && cf.key === r.key);
        const thumb = r.kind === 'perk' ? `<span class="thumb perk">${perkGlyph(r.id)}</span>` : `<span class="thumb">${weaponArt(r.id)}</span>`;
        const body = r.kind === 'perk' ? `<span class="nm2"><b>${esc(name(r)).toUpperCase()}</b><small>${perkEffectHtml(r.row)}</small></span>` : `<span class="nm">${esc(name(r)).toUpperCase()}</span><span class="role">${esc(roleName(r.row))}</span><span class="mag tab">MAG ${r.row.clip != null ? r.row.clip : '—'}</span>`;
        // A26: ✓ = MC acked this pick AND the gun confirmed the write, ⟳ = still arming (the node's debounce
        // window, waiting on MC's ack, or — F147 — MC acked but the gun has not answered the $WEAP write yet),
        // ≈ = the arming window ran out with no confirming report (pass 2: honest, not a real ✓).
        // The ⓘ is how a row is READ without being equipped — tapping the row itself now commits it.
        const info = `<button class="linfo" data-act="onLoInfo" data-arg="${r.key}" aria-label="Details">${INFO_SVG}</button>`;
        return `<div class="lrow ${eq ? 'eq' : ''} ${(pn || arming) ? 'pend' : ''} ${unconf ? 'unconf' : ''} ${fo ? 'fo' : ''} ${rj ? 'rej' : ''} ${wn ? 'warn' : ''}" data-act="onPickItem" data-arg="${r.key}">${thumb}${body}<span class="st">${eq ? '✓' : (pn || arming) ? '⟳' : unconf ? '≈' : wn ? '▲' : ''}</span>${info}</div>`;
      }).join('') : '<div class="small" style="padding:14px 4px">Nothing to pick here for this game.</div>');
    }
    // detail pane
    let detail = '';
    if (focus) {
      const r = focus.row;
      const bar = (label, v) => v == null ? '' : `<div class="tb"><span>${label}</span><i><b style="width:${Math.max(0, Math.min(100, v))}%"></b></i></div>`;
      // A26 hero tag: the same ⟳-vs-✓ condition the row uses (`pend` is already scoped to this tab), so the
      // hero pane never claims EQUIPPED while the row it belongs to still reads ⟳ waiting on the host's ack.
      // F147 (field 2026-09-12, "shows EQUIPPED/READY on the send; the gun takes a few more seconds"): MC's ack
      // (`eqKey`) is only the network round-trip. `st.tryoutArming` is engine.js's own confirmation that the
      // gun has ANSWERED the new $WEAP write with a matching ammo report — same family as F123, and the same
      // "never claim what the hardware has not confirmed" rule the live SWITCHING takeover already follows.
      // Polish-loop pass 2: the timeout resolution is honest — EQUIPPED · UNCONFIRMED (muted, its own class)
      // rather than the plain EQUIPPED a gun-confirmed pick earns.
      const heroTag = focus.key === pend ? '<span class="eqtag arming">ARMING…</span>'
        : (focus.key === eqKey && !pend && st.tryoutArming) ? '<span class="eqtag arming">SWITCHING…</span>'
        // Shorter than the ackChip's "EQUIPPED · UNCONFIRMED": this badge sits on the SAME nowrap line as
        // the weapon name + role chip (`.lodetail .nm`, `_fitLoDetailName`'s shrink loop only has so much
        // room before 13px stops being legible), and the weapon name here already says what's equipped.
        // Pass 3: gated the same way the row is (`unconfHere` + kind) — a perk's detail pane must never
        // inherit a weapon arm's stale timeout.
        : (focus.key === eqKey && !pend && unconfHere && st.tryoutUnconfirmed.kind === focus.kind) ? '<span class="eqtag unconf">UNCONFIRMED</span>'
        : (focus.key === eqKey && !pend) ? '<span class="eqtag">EQUIPPED</span>' : '';
      if (focus.kind === 'perk') detail = `<div class="art perk">${perkGlyph(focus.id)}</div><div class="nm">${esc(r.name).toUpperCase()}${heroTag}</div><div class="ln pk">PERK · ${perkEffectHtml(r)}${r.verified === false ? ' · <span style="color:var(--warn)">NOT YET FIELD-TESTED</span>' : ''}</div><div class="desc">${esc(r.desc || '')}</div>`;
      else detail = `<div class="art">${weaponArt(focus.id)}</div><div class="nm">${esc(r.name).toUpperCase()} <span class="rolechip">${esc(roleName(r))}</span>${heroTag}</div><div class="ln">MAG ${r.clip != null ? r.clip : '—'} · RESERVE ${r.reserve != null ? r.reserve : '—'}${r.reload_s != null ? ' · RELOAD ' + r.reload_s + 'S' : ''}</div>${statBlock(r)}${r.caution ? `<div class="caution">▲ ${esc(r.caution)}</div>` : ''}<div class="desc">${esc(r.desc || '')}</div>`;
    } else if (can) detail = `<div class="small" style="padding-top:30px">${tab === 'secondary' ? (sidearmOnly(rule) ? 'Pick a sidearm — or leave it on NONE.' : 'Pick a second weapon — or leave it on NONE.') : tab === 'perk' ? 'Pick a perk — or leave it on NONE.' : 'Pick your main weapon.'}</div>`;
    // A14: the two-tap confirm outranks everything else in the action bar; an ack that dropped the other slot says so
    // F147: MC's ack alone must not read as EQUIPPED while `st.tryoutArming` says the gun has not answered
    // the write yet — SWITCHING… holds the same slot the acked-but-not-yet-armed row does.
    // Pass 3: `unconfHere` is already tab-scoped (a perk tab can never match a weapon arm's tab), so the
    // action bar — one chip per tab, no row of its own — only needs that check, not `kind` again.
    const ackChip = cf ? `<span class="ackchip warn cf"><span class="unskew">${esc(cf.text).toUpperCase()} · TAP AGAIN</span></span>`
      : ack ? `<span class="ackchip ${!ack.ok ? 'bad' : unconfHere ? 'unconf' : 'ok'}"><span class="unskew">${ack.ok ? (st.tryoutArming ? 'SWITCHING…' : unconfHere ? 'EQUIPPED · UNCONFIRMED' : ('EQUIPPED ✓' + (ack.dropped ? ' · ' + esc(ack.dropped.name).toUpperCase() + ' DROPPED' : ''))) : esc(ack.reason || 'THE HOST SAID NO').toUpperCase()}</span></span>` : (pend ? '<span class="ackchip"><span class="unskew">ASKING THE HOST…</span></span>' : (st.tutorial ? '<span class="ackchip warn"><span class="unskew">TRY-OUT ARMED — FIRE A FEW ROUNDS</span></span>' : ''));
    // A26: TRY IT is gone — the pick IS the try-out. The forward action is REVIEW KIT ▸, which closes the rack
    // onto the three-plate kit summary (PRIMARY · SECONDARY · PERK) where READY UP lives; CLOSE is the same
    // exit without the commitment framing.
    return `<div class="lobby lo"><div class="scan"></div><div class="edgeglow"></div>
      <div class="lotop">${tabBtn('primary', lo.primary)}${tabBtn('secondary', lo.secondary)}${tabBtn('perk', lo.perk)}<span class="who"><span class="cs">${esc(st.callsign || '')}</span>${st.playerNum ? `<span class="num">#${st.playerNum}</span>` : ''}</span></div>
      <div class="lobody"><div class="lolist" data-tab="${tab}">${list}</div><div class="lodetail">${detail}</div></div>
      <div class="lobar"><span class="ackslot">${ackChip}</span><button class="lobtn review" data-act="onLoReview"><span class="unskew">REVIEW KIT ▸</span></button><button class="lobtn done" data-act="onLoDone"><span class="unskew">CLOSE</span></button></div></div>`;
  }

  // ---------- A24 / node.md §3.13: the FINAL RESULTS screen ----------
  /** Sorted leaderboard rows out of `result.rows` (every player, all modes). `rows` is the only orderable
   *  material on the wire — there is no per-mode objective number in a `ScoreRow` — so the order is kills,
   *  then fewest deaths, then assists, and the heading says so rather than implying a mode ranking. */
  _resultRows(R) {
    const rows = (R && Array.isArray(R.rows)) ? R.rows.filter(r => r && typeof r === 'object') : [];
    const n = v => num(v) == null ? 0 : v;
    return rows.slice().sort((a, b) => n(b.kills) - n(a.kills) || n(a.deaths) - n(b.deaths) || n(b.assists) - n(a.assists)
      || String(a.display || '').localeCompare(String(b.display || '')));
  }
  /** Possession as {team_id -> seconds}, from `result.possession.by_team` or, failing that, summed out of a
   *  `by_site` map. Null when the mode has no point to hold — the screen then shows no possession at all. */
  _resultHold(R) {
    const p = R && R.possession && typeof R.possession === 'object' ? R.possession : null;
    if (!p) return null;
    if (p.by_team && typeof p.by_team === 'object' && Object.keys(p.by_team).length) return p.by_team;
    if (p.by_site && typeof p.by_site === 'object') {
      const out = {};
      for (const site of Object.values(p.by_site)) { if (!site || typeof site !== 'object') continue;
        for (const [tid, v] of Object.entries(site)) out[tid] = (out[tid] || 0) + (num(v) || 0); }
      if (Object.keys(out).length) return out;
    }
    return null;
  }
  /** `after_end` (A6.1: facts past `end_t` are RECORDED and never scored). The server sends a MAP, not a list:
   *  `{facts: <count>, by_player: {[player_id]: {kills, deaths}}}`. No display name rides in it, so the name is
   *  resolved out of `result.rows` and falls back to the raw player_id for someone MC never scored — an id on
   *  screen is ugly, an invented name is a lie. Returns `{facts, rows}`; `facts` is the total the recap counted,
   *  which can exceed the rows shown (a fact from a player with no row at all still happened). */
  _afterEnd(R, rows = []) {
    const a = (R && R.after_end && typeof R.after_end === 'object' && !Array.isArray(R.after_end)) ? R.after_end : null;
    if (!a || !a.by_player || typeof a.by_player !== 'object') return { facts: 0, rows: [] };
    const name = new Map(rows.filter(r => r.player_id).map(r => [r.player_id, r.display]));
    const out = Object.entries(a.by_player)
      .map(([pid, v]) => ({ player_id: pid, display: name.get(pid) || pid, kills: num(v && v.kills) || 0, deaths: num(v && v.deaths) || 0 }))
      .filter(r => r.kills > 0 || r.deaths > 0)
      .sort((x, y) => y.kills - x.kills || y.deaths - x.deaths || String(x.display).localeCompare(String(y.display)));
    return { facts: num(a.facts) != null ? a.facts : out.length, rows: out };
  }
  _teamChip(t, mine) {
    const k = String(t.team_id == null ? '' : t.team_id).toLowerCase();
    const bg = TEAM_COLOR[k] || 'var(--plate)', ink = TEAM_INK[k] || 'var(--num)';
    return `<span class="tm ${mine ? 'mine' : ''}" style="background:${bg};color:${ink}"><span class="unskew">${esc(String(t.name || k || '—').toUpperCase())} <b>${num(t.score) == null ? '—' : t.score}</b></span></span>`;
  }

  /** THE FINAL RESULTS SCREEN.
   *
   *  The one rule that outranks every layout decision here (contracts A24, node.md §3.13, game test D3): **no
   *  branch below writes WIN or LOSE from the absence of a message.** A `victory` cue that never arrived means
   *  "you lost" and "your phone was out of coverage" identically, so with no `result` the screen says the match
   *  is over and the result is PENDING, and — once the settle window has passed with MC still unreachable — that
   *  MC was never reached. The four outcome words live in `OUTCOME_WORD` and are reachable only through
   *  `st.result.outcome`, which MC computes for THIS recipient.
   *
   *  Everything else is mode-aware from `result.mode` / `result.win_by` and the fields that are actually present:
   *  the tiles are built from a list (never five hard-coded cells), the TEAM view appears only when MC sent team
   *  totals, and possession / AFTER THE WHISTLE appear only when their fields do. */
  _result(st) {
    const R = (st.result && typeof st.result === 'object') ? st.result : null;
    const wait = st.resultWait || (R ? 'in' : 'pending');
    const reopened = !!st.endAck;
    const rows = this._resultRows(R);
    const teams = (R && Array.isArray(R.team_scores)) ? R.team_scores.filter(t => t && typeof t === 'object' && (t.team_id != null || t.name)) : [];
    const hasTeam = teams.length > 0;
    const tab = hasTeam ? (this.rtab === 'player' ? 'player' : 'team') : 'player';
    const hold = this._resultHold(R);
    const my = (R && R.my && typeof R.my === 'object') ? R.my : null;
    const myId = (my && my.player_id) || (st.player && st.player.player_id) || null;

    // --- headline ---
    const word = R ? (OUTCOME_WORD[R.outcome] || OUTCOME_WORD.undecided) : null;
    const head = word
      ? `<span class="rh1 w ${esc(String(R.outcome || 'undecided'))}"><span class="unskew">${word}</span></span>`
      : `<span class="rh1 p"><span class="unskew">${wait === 'unreached' ? 'MC NOT REACHED · SEE MISSION CONTROL' : 'RESULT PENDING · CONFIRM AT MISSION CONTROL'}</span></span>`;
    const modeName = String((R && R.mode) || st.mode || '').toUpperCase().replace(/_/g, ' ');
    const meta = [modeName || null,
      (R && R.win_by) ? 'WIN BY ' + String(R.win_by).toUpperCase().replace(/_/g, ' ') : null,
      (R && R.provisional) ? 'PROVISIONAL · SCORES STILL ARRIVING' : null].filter(Boolean).join(' · ');
    const seg = hasTeam ? `<div class="rseg" role="group">
      <button class="sg ${tab === 'team' ? 'on' : ''}" aria-pressed="${tab === 'team'}" data-act="onResultTab" data-arg="team"><span class="unskew">TEAMS</span></button>
      <button class="sg ${tab === 'player' ? 'on' : ''}" aria-pressed="${tab === 'player'}" data-act="onResultTab" data-arg="player"><span class="unskew">PLAYERS</span></button></div>` : '';

    // --- body ---
    let body;
    if (!R) {
      body = `<div class="rwait"><div class="wl">${wait === 'unreached'
        ? 'Your phone never reached Mission Control after the whistle. The host has the scores — the result is read off Mission Control, not off this screen.'
        : 'The match is over. Mission Control decides how it ended and sends the result here — walk back into range if you are out of it.'}</div>
        <div class="wl dim">Your own line is below. It is what this phone counted, not the result.</div></div>`;
    } else if (tab === 'team') {
      body = `<div class="rteams" style="grid-template-columns:repeat(${Math.min(4, teams.length)},minmax(0,1fr))">${teams.map(t => {
        const k = String(t.team_id == null ? '' : t.team_id).toLowerCase();
        const mine = !!(st.teamKey && k === st.teamKey);
        const ps = rows.filter(r => String(r.team_id == null ? '' : r.team_id).toLowerCase() === k);
        const h = hold ? hold[t.team_id] != null ? hold[t.team_id] : hold[k] : null;
        return `<div class="rteam ${mine ? 'mine' : ''}">${this._teamChip(t, mine)}
          ${h != null ? `<div class="thold">HELD <b class="tab">${mmssS(h)}</b></div>` : ''}
          <div class="tpl"><div class="tph"><span>PLAYER</span><span class="tab kda"><i>K</i><i>D</i><i>A</i></span></div>
          ${ps.length ? ps.map(r => `<div class="tp ${myId && r.player_id === myId ? 'me' : ''}"><span class="pn">${esc(String(r.display || r.player_id || '—').toUpperCase())}</span><span class="pv tab kda"><i>${num(r.kills) == null ? '—' : r.kills}</i><i>${num(r.deaths) == null ? '—' : r.deaths}</i><i>${num(r.assists) == null ? '—' : r.assists}</i></span></div>`).join('')
            : '<div class="tp none">NO SCORED PLAYERS</div>'}</div></div>`;
      }).join('')}</div>`;
    } else {
      const cell = (r, k) => num(r[k]) == null ? '—' : r[k];
      body = `<div class="rlb"><div class="lbh"><span class="c r">#</span><span class="c n">PLAYER · MOST KILLS FIRST</span><span class="c">K</span><span class="c">D</span><span class="c">A</span><span class="c">KD</span><span class="c">ACC</span><span class="c">BEST</span><span class="c m">MEDALS</span></div>
        <div class="lbrows">${rows.length ? rows.map((r, i) => {
          const k = String(r.team_id == null ? '' : r.team_id).toLowerCase();
          const meds = Array.isArray(r.medals) ? r.medals : [];
          return `<div class="lbr ${myId && r.player_id === myId ? 'me' : ''}"><span class="c r tab">${i + 1}</span>
            <span class="c n">${TEAM_COLOR[k] ? `<i class="dot" style="background:${TEAM_COLOR[k]}"></i>` : ''}${esc(String(r.display || r.player_id || '—').toUpperCase())}</span>
            <span class="c tab">${cell(r, 'kills')}</span><span class="c tab">${cell(r, 'deaths')}</span><span class="c tab">${cell(r, 'assists')}</span>
            <span class="c tab">${num(r.kd) == null ? '—' : Number(r.kd).toFixed(1)}</span>
            <span class="c tab ${r.acc_provisional ? 'prov' : ''}">${num(r.accuracy) == null ? '—' : Math.round(r.accuracy) + '%'}</span>
            <span class="c tab">${num(r.best_streak) == null ? '—' : r.best_streak}</span>
            <span class="c m">${meds.length ? esc(meds.map(m => MEDAL_LABEL[m] || String(m).toUpperCase().replace(/_/g, ' ')).join(' · ')) : ''}</span></div>`;
        }).join('') : '<div class="lbnone">MISSION CONTROL SENT NO PLAYER ROWS FOR THIS MATCH</div>'}</div></div>`;
    }

    // --- strips: possession (player view), the honors roll, and the unofficial post-whistle tally ---
    const holdStrip = (hold && tab !== 'team') ? `<div class="rstrip poss"><span class="k">HELD</span><span class="v">${Object.entries(hold).map(([tid, v]) => {
      const t = teams.find(x => String(x.team_id) === String(tid));
      return `<span class="ch">${esc(String((t && t.name) || tid).toUpperCase())} <b class="tab">${mmssS(v)}</b></span>`; }).join('')}</span></div>` : '';
    const honors = (R && Array.isArray(R.honors)) ? R.honors.filter(h => h && h.medal) : [];
    // `honors[].display` is the PLAYER's name (not the medal's). `stat` is WHAT EARNED IT, and MC writes it as
    // a descriptive STRING, not a number — `scoring.py honors()` sends "11 K · 2.8 K/D · ×5 STREAK", "8
    // ELIMINATIONS", "AT 01:12". The old guard was `num(h.stat) != null`, which is false for every string MC
    // has ever sent, so the stat never reached a real phone; only the demo (which sent integers) ever showed
    // one, and the stage shot of it was fiction. Anything non-empty is printed as MC wrote it.
    const honorStrip = honors.length ? `<div class="rstrip hon"><span class="k">HONORS</span><span class="v">${honors.slice(0, 6).map(h =>
      `<span class="ch">${esc(MEDAL_LABEL[h.medal] || String(h.medal).toUpperCase().replace(/_/g, ' '))} <b>${esc(String(h.display || h.player_id || '').toUpperCase())}</b>${h.stat != null && h.stat !== '' ? ` <b class="tab">${esc(String(h.stat))}</b>` : ''}</span>`).join('')}</span></div>` : '';
    const ae = this._afterEnd(R, rows);
    // A6.1: facts after the whistle are RECORDED, not scored. Shown so a player who kept shooting can see where
    // those hits went — and shown as visibly not part of the score above, never mixed into it.
    const afterStrip = ae.rows.length ? `<div class="rstrip after"><span class="k">AFTER THE WHISTLE · ${ae.facts} NOT COUNTED</span><span class="v">${ae.rows.slice(0, 8).map(r =>
      `<span class="ch">${esc(String(r.display).toUpperCase())} <b class="tab">${r.kills}·${r.deaths}</b></span>`).join('')}</span></div>` : '';

    // --- my own line, as tiles: a LIST, so the cell set follows the mode and the fields that arrived ---
    const tiles = this._resultTiles(st, R, hold);

    // --- footer ---
    const all = this.history || []; const sid = this.sessionId || null;
    const hist = sid ? all.filter(g => g.session === sid) : all;
    const tot = hist.reduce((a, g) => ({ g: a.g + 1, k: a.k + (g.kills || 0), d: a.d + (g.deaths || 0) }), { g: 0, k: 0, d: 0 });
    const sess = tot.g > 1 ? `<div class="sess">${sid ? 'THIS SESSION' : 'OVERALL'} · ${tot.g} GAMES · ${tot.k} KILLS · ${tot.d} DEATHS</div>` : '';
    const sync = this.sync && this.sync.bound && this.sync.pending === 0
      ? '<div class="syncline ok">SCORES SENT TO THE HOST ✓</div>'
      : this.sync && this.sync.bound
        ? `<div class="syncline warn">SENDING SCORES… ${this.sync.pending} LEFT</div>`
        : '<div class="syncline warn">OUT OF RANGE — SCORES SEND WHEN YOU ARE BACK</div>';
    // The sheet's ask (D3): blink it while the result is not in — that is exactly when walking back matters.
    // It sat a pixel off the OUT OF RANGE line under it, a stack too tight to read (design-result-pending.png);
    // the room comes from `.fl`'s gap, so no line has to lose its own wording to make space.
    const ret = R ? '' : '<div class="retmc">RETURN TO MISSION CONTROL</div>';
    const mcv = (!R && st.game && st.game.mc_verify) ? `<div class="mcvline">${esc(String(st.game.mc_verify).toUpperCase())}</div>` : '';

    return `<div class="lobby result rv"><div class="scan"></div><div class="edgeglow"></div>
      <div class="rhead"><span class="rkick">FINAL RESULTS</span>${head}<span class="rmeta">${esc(meta)}</span>${seg}</div>
      <div class="rbody">${body}</div>
      ${holdStrip}${honorStrip}${afterStrip}
      <div class="rstats" style="grid-template-columns:repeat(${tiles.n},minmax(0,1fr))">${tiles.html}</div>
      <div class="rfoot foot"><div class="fl">${ret}${mcv}${sync}${sess}</div>
        <button class="ready ${reopened ? 'ghost' : ''}" data-act="${reopened ? 'onCloseView' : 'onEndOk'}"><span class="unskew">${reopened ? 'CLOSE' : 'OK'}</span></button></div></div>`;
  }

  /** This player's own line as tiles. A LIST, not five fixed cells (game test D3): BEST STREAK appears only once
   *  MC has counted one, HELD replaces SHOTS only in a mode with a point to hold, and every label is ≥11px. */
  _resultTiles(st, R, hold) {
    const my = (R && R.my && typeof R.my === 'object') ? R.my : null;
    const v = x => x == null ? '—' : x;
    const kills = num(my && my.kills) != null ? my.kills : (num(st.kills) != null ? st.kills : null);
    const assists = num(my && my.assists) != null ? my.assists : (num(st.assists) != null ? st.assists : null);
    const acc = num(my && my.accuracy) != null ? Math.round(my.accuracy) : accShown(st);
    const streak = num(my && my.best_streak);
    const myHold = (hold && st.teamKey && hold[st.teamKey] != null) ? hold[st.teamKey] : null;
    // DEATHS is local-real on the live HUD (node.md §4.4), but on the FINAL screen MC's number sits three rows
    // above it on the leaderboard — a tile reading 0 beside a row reading 6 is a screen arguing with itself.
    const deaths = num(my && my.deaths) != null ? my.deaths : st.deaths;
    const cells = [['KILLS', v(kills)], ['DEATHS', v(deaths)], ['ASSISTS', v(assists)],
      ['ACCURACY', acc == null ? '—' : acc + '%']];
    if (streak != null) cells.push(['BEST STREAK', streak]);
    if (myHold != null) cells.push(['YOUR TEAM HELD', mmssS(myHold)]);
    else cells.push(['SHOTS', v(num(st.shots))]);
    // This player's medals are NOT repeated here: they already read on their own leaderboard line and in the
    // HONORS strip, and a third copy cost 24px of body height on a 390px frame.
    return { n: cells.length, html: cells.map(([lab, val]) => `<div class="cell"><b>${val}</b><span>${lab}</span></div>`).join('') };
  }

  /** The MATCH HISTORY list — this MC session's games out of `localStorage['brx.history']` (`app.js` owns the
   *  writes). A24 fields are shown only when they are there: an entry from before the phone learned `outcome`
   *  reads "—", never a guess at how it went. */
  _history(st) {
    const all = this.history || []; const sid = this.sessionId || null;
    const hist = (sid ? all.filter(g => g.session === sid) : all).slice().reverse();
    const tot = hist.reduce((a, g) => ({ g: a.g + 1, k: a.k + (g.kills || 0), d: a.d + (g.deaths || 0) }), { g: 0, k: 0, d: 0 });
    const rows = hist.map(g => {
      const w = g.outcome ? (OUTCOME_WORD[g.outcome] || '—') : null;
      const scores = Array.isArray(g.team_scores) && g.team_scores.length
        ? g.team_scores.map(t => `${esc(String(t.name || t.team_id || '').toUpperCase())} ${num(t.score) == null ? '—' : t.score}`).join(' · ') : '';
      return `<div class="hr"><span class="c t tab">${clock12(g.t)}</span>
        <span class="c m">${esc(String(g.mode || '—').toUpperCase())}</span>
        <span class="c o ${w ? esc(String(g.outcome)) : 'none'}">${w || 'NOT CONFIRMED'}</span>
        <span class="c s">${scores || '—'}</span>
        <span class="c k tab">${num(g.kills) == null ? '—' : g.kills} · ${num(g.deaths) == null ? '—' : g.deaths} · ${num(g.assists) == null ? '—' : g.assists}</span>
        <span class="c b tab">${num(g.best_streak) == null ? '—' : g.best_streak}</span></div>`;
    }).join('');
    return `<div class="lobby result hist"><div class="scan"></div><div class="edgeglow"></div>
      <div class="rhead"><span class="rkick">MATCH HISTORY</span><span class="rh1 p"><span class="unskew">${sid ? 'THIS SESSION' : 'ON THIS PHONE'} · ${tot.g} GAME${tot.g === 1 ? '' : 'S'}</span></span>
        <span class="rmeta">${tot.k} KILLS · ${tot.d} DEATHS</span></div>
      <div class="rbody"><div class="hlist"><div class="hr hh"><span class="c t">TIME</span><span class="c m">MODE</span><span class="c o">RESULT</span><span class="c s">TEAM SCORES</span><span class="c k">K · D · A</span><span class="c b">BEST</span></div>
        ${rows || '<div class="lbnone">NO MATCHES ON THIS PHONE YET</div>'}</div></div>
      <div class="rfoot foot"><div class="fl"><div class="sess">A MATCH IS RECORDED WHEN IT ENDS · THE RESULT FILLS IN WHEN MISSION CONTROL SENDS IT</div></div>
        <button class="ready ghost" data-act="${st.endAck ? 'onCloseView' : 'onShowResults'}"><span class="unskew">${st.endAck ? 'CLOSE' : 'BACK'}</span></button></div></div>`;
  }

  _live(st) {
    const low = st.hp <= st.maxHp * .25 && st.alive;
    // only nag when genuinely low: live+alive, mag known, not a fresh mag (it blinked constantly on the bench)
    const lowMag = !!(st.alive && st.mag && st.ammo < st.mag && st.ammo / st.mag <= .15);
    // bench 2026-09-17: a reload gives nothing back once the reserve is also empty, so RELOAD is a false
    // promise at that point — say OUT OF AMMO instead. The state the HUD gets from the node has no LIVE
    // round count for the other slot (only its catalogue max), so this never guesses a "swap" hint; it
    // would need that count added to the node's state before it could say so honestly.
    const outOfAmmo = !!(st.alive && st.ammo === 0 && st.reserve === 0);
    const energy = isEnergyWeapon(st);
    // Bench 2026-09-17: a charge weapon only (not a tap-only or bullet weapon) -- a live cell too small for
    // one full charge fires nothing, whether that cell is empty or holds a few rounds. `belowCharge` drives
    // both which big prompt shows (severity depends on the reserve, not the cell) and the small note below.
    // A48: the cost comes from the catalogue (`rounds_per_charge`), so a second charge weapon needs no code.
    const cost = chargeCost(st);
    const belowCharge = !!(st.alive && cost != null && st.ammo != null && st.ammo < cost);
    // F257 (bench 2026-09-18): a cell above 0 but below a charge still fires taps (`t37`), so it is
    // not a dead end -- only a truly empty cell (`ammo === 0`) with no reserve is. `outOfAmmo` above
    // already covers exactly that state and picks the ENERGY wording via `energy`, so this only needs
    // to stop claiming a dead end while ammo is still > 0: the note below says why taps are all it has.
    const energyOut = belowCharge && st.ammo === 0 && !(st.reserve > 0);
    // reserve has something to draw on: one calm prompt, whether the cell reads 0 or a partial charge.
    const energyLow = belowCharge && st.reserve > 0;
    // Bench 2026-09-17: the full-screen OVERHEAT takeover was keyed to `st.overheating`, the MECHANIC's
    // reading, which the node echoes back for up to 25 s after the lockout is over (engine.js
    // `HEAT_STALE_MS`). `st.overheatShown` is the DISPLAY window, about 6 s, and the word, the overlay and
    // the heat bar all read it -- maint review 2026-09-17: the bar still read the mechanic, so it could sit
    // hot for up to 19 s after the word had gone. The engine always sets the field, so there is no fallback.
    const overheating = !!(st.alive && st.overheatShown);
    const [nm] = splitGun(st.gun);
    const stat = (k, v) => `<span>${k}<b class="${v == null ? 'mut' : ''}" id="st-${k}">${v == null ? '—' : v}</b></span>`;
    const kb = st.killedBy ? `` : '';
    return `<div class="alive"><div class="scan"></div><div class="edgeglow"></div><div class="strip l"></div><div class="strip r"></div>
      ${low ? '<div class="firevig"></div>' : ''}
      ${overheating ? '<div class="heatvig"></div><div class="heatword">OVERHEAT</div>' : ''}
      <div class="clockplate" data-act="onBoard" data-arg="team" role="button" aria-label="Team scores"><div class="in"><span class="t tab" id="clock">${mmss(st.clockMs)}</span><span class="m">${esc(st.mode)}</span></div></div>
      <div class="ident" data-act="onBoard" data-arg="player" role="button" aria-label="Player scores"><span class="arrow"></span><span class="cs">${esc(st.callsign || nm)}</span><span class="sq">${esc(st.teamName)} SQUAD</span></div>
      <div class="topright"><span class="link"><span id="linkdot" class="dot ${st.bleUp ? '' : 'off'}"></span><span id="linklab">${st.bleUp ? 'GUN' : 'NO GUN'}</span></span><button class="link mclink" data-act="onToggleMcPill" aria-label="Mission Control link"><span id="mcdot" class="dot ${st.wsState === 'bound' ? '' : 'ws'}"></span>MC</button>
        <span class="batt tab"><span class="shell"><span class="fill" id="battfill" style="right:${100 - (st.battery || 0)}%"></span></span><span id="batt">${st.battery != null ? st.battery + '%' : '—'}</span></span></div>
      ${st.battery != null && st.battery <= 15 ? `<div class="battwarn">GUN BATT ${st.battery}% — CHARGE SOON</div>` : ''}
      ${this._gunHealthWarning(st)}
      <div class="stats tab">${st.kills > 0 ? stat('K', st.kills) : ''}${st.deaths > 0 ? stat('D', st.deaths) : ''}${st.assists > 0 ? stat('A', st.assists) : ''}${accShown(st) != null ? stat('ACC', accShown(st) + '%') : ''}</div>
      ${st.aim && AIM_REASON[st.aim.reason] ? `<div class="aimfx ${esc(st.aim.reason)}${overheating ? ' tight' : ''}" id="aimfx">${this._aimFx(st)}</div>`
        : st.underFire ? '<div class="takingfire"><span class="r"></span><span class="t">TAKING FIRE</span></div>' : '<div class="reticle"></div>'}
      <div class="fxbar" id="fxbar">${this._fx(st)}</div>
      <div class="vitals"><div class="nums"><span class="hp tab ${low ? 'low' : ''}" id="hp">${st.hp}</span><span class="hplab">HP</span><span class="sh tab ${st.armor === 0 ? 'zero' : ''}" id="sh">${st.armor}</span><span class="hplab armorlabel">ARMOR</span>${st.maxShield > 0 ? `<span class="shield tab ${st.shield === 0 ? 'zero' : ''}" id="shield">${st.shield}</span><span class="hplab shieldlabel">SHIELD</span>` : ''}</div>
        <div class="bar ${low ? 'low' : ''}"><i id="hpbar" style="width:${Math.round(100 * st.hp / st.maxHp)}%"></i></div>
        <div class="bar armor"><i id="shbar" style="width:${Math.round(100 * st.armor / st.maxArmor)}%"></i></div>${st.maxShield > 0 ? `<div class="bar shield"><i id="shieldbar" style="width:${Math.round(100 * st.shield / st.maxShield)}%"></i></div>` : ''}</div>
      <div class="ammo">${outOfAmmo ? `<span class="reload out solid"><span class="unskew">${energy ? 'OUT OF ENERGY' : 'OUT OF AMMO'}</span></span>`
          : overheating ? `<span class="reload hot solid"><span class="unskew">OVERHEAT</span></span>`
          : energyOut ? `<span class="reload out solid"><span class="unskew">OUT OF ENERGY</span></span>`
          : energyLow ? `<span class="reload solid"><span class="unskew">${HOLD_TO_RECHARGE}</span></span>`
          : lowMag ? (energy ? `<span class="reload solid"><span class="unskew">${HOLD_TO_RECHARGE}</span></span>`
            : `<span class="reload ${st.ammo === 0 ? 'solid' : ''}"><span class="unskew">RELOAD ▸▸</span></span>`) : ''}
        <div class="nums"><span class="mag tab ${lowMag ? 'warn' : ''}" id="mag">${magText(st)}</span><span class="res tab" id="res">${this._resText(st)}</span></div>
        ${belowCharge && st.ammo > 0 ? '<div class="enote">NOT ENOUGH ENERGY</div>' : ''}
        <div class="pips" id="pips">${this._pips(st)}</div>
        ${this._heatBar(st)}
        <span class="wn"><span class="slot">${st.activeSlot ? 'SECONDARY' : 'PRIMARY'}</span>${esc(st.weapon)}</span></div>
      <div class="nightlab">NIGHT OPS</div>${kb}${this.board ? this._board(st) : ''}</div>`;
  }
  /** F288: a trigger-path failure needs to reach the player, not live only in MC diagnostics. `no_answer`
   *  is conclusive and names the host-side cure. `no_fire` is the earlier, recoverable observation; silence
   *  alone is intentionally omitted because the existing GUN LINK state owns connectivity. */
  _gunHealthActive(st) {
    if (!st.alive || !st.bleUp || st.gunFlapping || st.resync || st.reconciling) return false;
    return !!((st.cure && st.cure.verdict === 'no_answer') || (st.poolStale && st.poolStale.why === 'no_fire'));
  }
  _gunHealthWarning(st) {
    if (!this._gunHealthActive(st)) return '';
    if (st.cure && st.cure.verdict === 'no_answer') {
      return '<div class="gunwarn danger" role="alert"><b>GUN NOT ANSWERING</b> <span>HOST: FORCE RESPAWN OR RELINK</span></div>';
    }
    if (st.poolStale && st.poolStale.why === 'no_fire') {
      return '<div class="gunwarn warn" role="status" aria-live="polite"><b>GUN NOT REPORTING SHOTS</b> <span>PULL TRIGGER AGAIN · THEN TELL HOST</span></div>';
    }
    return '';
  }
  /** S16: the poison pill, just above the health it is draining. It counts the stack down and names the applier,
   *  because a player watching health fall with no hit on screen otherwise reports a bug (Tony, 2026-09-18). Patched
   *  in place every render, so the countdown moves without a rebuild. Empty when nothing ticks. */
  _fx(st) {
    const p = st.alive && st.poison;
    if (!p) return '';
    const by = p.by && (p.by.name || (p.by.num ? '#' + p.by.num : ''));
    return `<div class="fx poison" data-fx="poison"><span class="g" aria-hidden="true">☣</span><span class="k">POISONED</span>`
      + `<span class="t tab" id="fxpoison">${secsLeft(p.leftMs)}<small>SEC</small></span><span class="s">-${esc(p.perTick)} EVERY ${esc(secsLeft(p.tickMs))} S${by ? ' · ' + esc(String(by).toUpperCase()) : ''}</span>`
      + `<i class="drain"><b style="width:${pctLeft(p.leftMs, p.durMs)}%"></b></i></div>`;
  }
  /** S53: the accuracy pill's body -- the reason, what it means, and the count to it clearing (the gun holds a
   *  smoke's accuracy at 0 for about 6 s, then gives it back in one step). */
  _aimFx(st) {
    const a = st.aim; const r = a && AIM_REASON[a.reason];
    if (!r) return '';
    return `<span class="k">${r.word}</span><span class="s">${r.sub}</span><span class="t tab" id="aimleft">${secsLeft(a.leftMs)}<small>SEC</small></span>`
      + `<i class="clr"><b style="width:${pctLeft(a.leftMs, a.totalMs)}%"></b></i>`;
  }
  /** Bench 2026-09-17: how old the scores on the overlay are. MC pushes every change to a bound phone, so the
   *  numbers are current while the link is up; off the link they are the last push, and the label gives its age.
   *  Bench 2026-09-18 (F265): a bound phone can stop receiving pushes and still read `wsState === 'bound'`, so
   *  the socket state alone is not proof the board is current. LIVE is only honest for a few seconds: past
   *  `BOARD_LIVE_MAX_AGE_MS`, show the age even while bound, same as an unbound phone would.
   *
   *  Polish review #2: the freshness clock is `st.lastMcMsgAt` (any message heard from MC), not
   *  `st.scoreAt` (the last score CHANGE) -- MC only pushes a new score when one changes, so a quiet
   *  5 s of no kills is normal play, not a dead socket, and must not read as stale. `!!st.scoreAt`
   *  still gates it: no score has ever arrived, there is nothing to call LIVE. */
  _boardStale(st) { return !!st.scoreAt && (st.wsState !== 'bound' || Date.now() - st.lastMcMsgAt > BOARD_LIVE_MAX_AGE_MS); }
  _boardAge(st) {
    if (!st.scoreAt) return 'NO SCORES YET';
    if (!this._boardStale(st)) return 'LIVE';
    const s = Math.max(0, Math.round((Date.now() - st.scoreAt) / 1000));
    return `AS OF ${s < 60 ? s + ' S' : Math.floor(s / 60) + ' MIN'} AGO`;
  }
  /** Bench 2026-09-17: the live scores overlay, opened from the player name (PLAYERS tab) or the match clock
   *  (TEAMS tab). Everything on it is what the phone already holds: MC's last `score` push (`rows` = every
   *  player's ScoreRow, `board` = team totals, or the top three in FFA) and, before any push, this phone's own
   *  line. It sits between the vitals and the ammo digits, and a tap outside it or on ✕ closes it. */
  _board(st) {
    const ffa = st.mode === 'FFA';
    const tab = this.board === 'player' ? 'player' : 'team';
    const rows = this._resultRows({ rows: st.scoreRows || [] });
    const myId = st.player && st.player.player_id;
    const v = x => num(x) == null ? '—' : x;
    const acc = r => num(r.accuracy) == null ? '—' : Math.round(r.accuracy) + '%';
    const name = r => esc(String(r.display || r.player_id || '—').toUpperCase());
    const stale = this._boardStale(st);
    let body;
    if (tab === 'player' || ffa) {
      const list = rows.length ? rows : [{ player_id: myId, display: st.callsign, kills: st.kills, deaths: st.deaths, assists: st.assists, accuracy: accShown(st) }];
      const cols = tab === 'player';
      body = `<div class="bdlist"><div class="bdr bdh ${cols ? '' : 'rank'}"><span>#</span><span class="pn">PLAYER</span>${cols ? '<span>K</span><span>D</span><span>A</span><span>ACC</span>' : '<span>KILLS</span>'}</div>
        ${list.map((r, i) => `<div class="bdr ${cols ? '' : 'rank'} ${myId && r.player_id === myId ? 'me' : ''}"><span class="tab">${i + 1}</span><span class="pn">${name(r)}</span>${cols
          ? `<span class="tab">${v(r.kills)}</span><span class="tab">${v(r.deaths)}</span><span class="tab">${v(r.assists)}</span><span class="tab">${acc(r)}</span>`
          : `<span class="tab">${v(r.kills)}</span>`}</div>`).join('')}
        ${rows.length ? '' : '<div class="bdnone">YOUR OWN LINE · MISSION CONTROL HAS SENT NO SCORES</div>'}</div>`;
    } else {
      const teams = st.board && Array.isArray(st.board.teams) ? st.board.teams.filter(t => t && typeof t === 'object') : [];
      body = teams.length ? `<div class="bdteams">${teams.map(t => {
        const k = String(t.team_id == null ? '' : t.team_id).toLowerCase(); const mine = !!(st.teamKey && k === st.teamKey);
        const ps = rows.filter(r => String(r.team_id == null ? '' : r.team_id).toLowerCase() === k);
        return `<div class="bdteam ${mine ? 'mine' : ''}">${this._teamChip(t, mine)}
          ${ps.map(r => `<div class="bdr tp ${myId && r.player_id === myId ? 'me' : ''}"><span class="pn">${name(r)}</span><span class="tab">${v(r.kills)} · ${v(r.deaths)} · ${v(r.assists)}</span></div>`).join('')}</div>`; }).join('')}</div>
        ${st.board && num(st.board.cap) != null ? `<div class="bdcap">FIRST TO ${st.board.cap} · K · D · A</div>` : ''}`
        : '<div class="bdnone">NO TEAM TOTALS FROM MISSION CONTROL YET</div>';
    }
    return `<div class="bdscrim"></div><div class="bdpanel" role="dialog" aria-label="Match scores">
      <div class="bdhead"><div class="bdseg" role="group">
        <button class="sg ${tab === 'team' ? 'on' : ''}" aria-pressed="${tab === 'team'}" data-act="onBoardTab" data-arg="team"><span class="unskew">${ffa ? 'STANDINGS' : 'TEAMS'}</span></button>
        <button class="sg ${tab === 'player' ? 'on' : ''}" aria-pressed="${tab === 'player'}" data-act="onBoardTab" data-arg="player"><span class="unskew">PLAYERS</span></button></div>
        <span class="bdage ${stale ? 'stale' : ''}" id="bdage">${this._boardAge(st)}</span>
        <button class="bdx" data-act="onBoardClose" aria-label="Close scores">✕</button></div>
      <div class="bdbody">${body}</div></div>`;
  }
  /** Bench 2026-09-17: the ammo gauge's shot-ready cue. After a shot from a weapon with at least 400 ms between
   *  rounds the engine reports {at, ms, leftMs}; the gauge dims (`data-cool="on"` on the frame, which survives a
   *  structural rebuild) until `leftMs` has passed, then shines once (`ready`, 250 ms). The timer starts at this
   *  render, after the engine read `leftMs`, so the shine can only be late, never early. Timers only: no per-frame work. */
  _shotCue(st) {
    const c = st.phase === 'live' ? st.shotCooldown : null;
    const at = c ? c.at : null;
    if (at === this._cueAt) return;
    this._cueAt = at;
    if (this._cueT) { clearTimeout(this._cueT); this._cueT = null; }
    if (!c || !(c.leftMs > 0)) { delete this.frame.dataset.cool; return; }   // no cue, or the render came after the round was due
    this.frame.dataset.cool = 'on';
    this._cueT = setTimeout(() => {
      this.frame.dataset.cool = 'ready';
      this._cueT = setTimeout(() => { this._cueT = null; delete this.frame.dataset.cool; }, 250);
    }, c.leftMs);
  }
  /** The DOWN screen's middle block: the countdown in auto mode, or in scanner mode the respawn LESSON (utility.md
   *  §4.3, live bench 2026-09-04: "the very first time someone dies… the HUD should make it obvious"):
   *  RUN TO YOUR TEAM'S RESPAWN STATION → GET CLOSER (closeness bar vs the station's threshold) → HOLD… (at the
   *  station, the short delay finishing) → PULL THE TRIGGER TO RESPAWN (green) / RESPAWNING… (presence gate). */
  _downHintKey(st) { const s = st.station || {}; return [st.respawnHint, st.respawnType, st.respawnIn, s.id, s.present, s.rssi != null ? Math.round(s.rssi) : null, st.downWarn].join('|'); }
  /** 2026-09-19 (Tony): a TIMED respawn happens where the player stands, so the DOWN screen tells them to move. The
   *  engine's `downWarn` climbs when they are killed soon after a timed respawn: 1 = this line, 2 = larger and
   *  pulsing, 3 = a full-width flashing band that holds for the match. The flash is 1 Hz, well below any flicker band. */
  _downSafe(st) {
    if (!st.respawnAuto && st.respawnType !== 'auto') return '';
    const lvl = Math.max(1, Math.min(3, Number(st.downWarn) || 1));
    return `<div class="safe w${lvl}" id="dnsafe"><span>GET TO SAFE SPACE FOR REDEPLOY</span></div>`;
  }
  _downHint(st) {
    this._downHintSig = this._downHintKey(st);
    let hint = st.respawnHint || (st.respawnType === 'auto' ? 'timer' : st.respawnType === 'none' ? 'out' : 'find_station');
    if (st.respawnType === 'scanner' && !st.respawnAuto && (hint === 'timer' || hint === 'wait')) hint = 'find_station';   // older engine fallback
    if (hint === 'timer') return `<span class="n tab" id="rd">${digits(st.respawnIn)}</span><span class="lab">${st.respawnIn ? 'REDEPLOY IN' : 'AWAITING REDEPLOY'}</span>`;
    if (hint === 'out') return `<span class="n nn">✕</span><span class="lab">NO RESPAWNS THIS MODE</span>`;
    const s = st.station || {}; const thr = s.threshold != null && s.threshold !== 0 ? s.threshold : -74; const rssi = s.rssi != null ? Math.round(s.rssi) : null;   // -74 = the bench-tuned station default (≈10 ft at high TX)
    const pct = rssi == null ? 0 : Math.max(0, Math.min(100, Math.round(100 * (rssi - (thr - 30)) / 30)));   // 30 dB below the threshold = 0, at it = 100
    const bar = (cls, w) => `<div class="near ${cls}"><i style="width:${w}%"></i></div>`;
    const presence = st.respawnGate === 'presence';   // some games revive by just being at the station — never tell those players to pull the trigger (polish round 2026-09-04)
    if (hint === 'find_station') return `<span class="n nn">▣</span><span class="ins">RUN TO YOUR TEAM'S RESPAWN STATION</span><span class="lab">${presence ? 'AND STAND THERE' : 'THEN PULL THE TRIGGER THERE'}</span>`;
    if (hint === 'approach') return `<span class="n nn">▣</span><span class="ins">GET CLOSER</span>${bar('', pct)}<span class="lab">STATION IN RANGE${rssi != null ? ` · <b class="tab">${rssi}</b> / ${thr} dBm` : ''}</span>`;
    if (hint === 'hold') return `<span class="n nn on">▣</span><span class="ins on">HOLD…</span>${bar('on hold', 100)}<span class="lab on">AT THE STATION · ALMOST THERE</span>`;
    if (hint === 'pull_trigger') return `<span class="n nn on">▣</span><span class="ins on">PULL THE TRIGGER TO RESPAWN</span>${bar('on', 100)}<span class="lab on">AT THE STATION</span>`;
    return `<span class="n nn on">▣</span><span class="ins on">RESPAWNING…</span>${bar('on', 100)}<span class="lab on">AT THE STATION</span>`;
  }
  /** The DOWN-screen recap: three labelled tiles — time left · the team race (cap under it) · your own line. */
  _downRecap(st) {
    const tile = (lab, val) => `<span class="rc"><span class="rv">${val}</span><span class="rl">${lab}</span></span>`;
    const out = [tile('TIME LEFT', `<b class="tab">${mmss(st.clockMs)}</b>`)];
    // Team totals and your kills come from Mission Control — shown only while the link is up (a stale board would lie);
    // off-link the recap sticks to what the phone knows for itself: the clock, the cap, your deaths and shots.
    const linked = st.wsState === 'bound';
    const bd = linked ? st.board : null;
    if (bd && bd.teams && bd.teams.length) {
      const chips = bd.teams.map(t => { const k = String(t.team_id || '').toLowerCase(); const mine = st.teamKey && k === st.teamKey;
        return `<span class="tm ${mine ? 'mine' : ''}" style="background:${TEAM_COLOR[k] || 'var(--plate)'};color:${TEAM_INK[k] || 'var(--num)'}"><span class="unskew">${esc(String(t.name || k).toUpperCase())} <b>${t.score != null ? t.score : '—'}</b></span></span>`; }).join('');
      out.push(tile(bd.cap ? `FIRST TO ${bd.cap}` : 'SCORE', `<span class="tms">${chips}</span>`));
    } else if (st.fragLimit) out.push(tile('SCORE CAP', `<b>${st.fragLimit}</b>`));
    const me = linked && st.kills != null ? [`<b>${st.kills}</b> KILL${st.kills === 1 ? '' : 'S'}`, `<b>${st.deaths}</b> DEATH${st.deaths === 1 ? '' : 'S'}`]
      : [`<b>${st.deaths}</b> DEATH${st.deaths === 1 ? '' : 'S'}`, `<b>${st.shots}</b> SHOT${st.shots === 1 ? '' : 'S'}`];
    if (st.lives != null) me.push(`<b>${st.lives}</b> ${st.lives === 1 ? 'LIFE' : 'LIVES'} LEFT`);   // "no respawns" is already the big label above
    out.push(tile('YOU', me.join(' · ')));
    if (!linked && this._atCapMinusOne(st)) out.push('<div class="capwarn"><span class="unskew">MC OUT OF RANGE · A WIN IS CONFIRMED ONLY AT MISSION CONTROL</span></div>');
    return out.join('');
  }
  /** True when the LAST board MC pushed has this player's team (or, in FFA, this player) one off the cap. The
   *  board may be stale — that is the point: this line makes no claim about the score, only about who confirms it. */
  _atCapMinusOne(st) {
    const bd = st.board && typeof st.board === 'object' ? st.board : null;
    const cap = num(bd && bd.cap) != null ? bd.cap : num(st.fragLimit);
    if (cap == null || cap < 2) return false;
    const mine = (bd && Array.isArray(bd.teams)) ? bd.teams.find(t => t && String(t.team_id == null ? '' : t.team_id).toLowerCase() === st.teamKey) : null;
    return [num(mine && mine.score), num(st.kills)].some(v => v != null && v >= cap - 1 && v < cap);
  }
  /** Bench 2026-09-17 (Tony): "25% /80" made no sense -- a percentage beside a reserve in ROUNDS, on a
   *  weapon with no rounds. A bullet weapon (and, per F248, a low-cost energy weapon like the Rail Gun)
   *  keeps `/reserve`; a cell-gauge weapon gets one pill per FULL spare cell (floor(reserve / clip)) plus a
   *  dimmer half-filled pill for a part cell (reserve % clip > 0), and nothing at all once the reserve is
   *  empty (the OUT OF ENERGY prompt already says that). */
  _resText(st) {
    if (!usesCellGauge(st)) return `/${st.reserve != null ? st.reserve : '—'}`;
    const clip = st.mag || Math.max(st.ammo, 1);
    const reserve = st.reserve || 0;
    if (!(reserve > 0)) return '';
    const full = Math.floor(reserve / clip);
    const left = reserve % clip;
    let s = ''; for (let i = 0; i < full; i++) s += '<i class="cell"></i>';
    // Bench 2026-09-18 (Tony): "the little amber shells did not deplete correctly, they appeared to be
    // half full after a reload". The part cell was painted at a FIXED half, so 5 rounds and 39 rounds
    // looked identical. Fill it at its real fraction instead, with a floor so a nearly empty cell is
    // still visible rather than a sliver of nothing.
    if (left > 0) {
      const pct = Math.max(12, Math.round(100 * left / clip));
      s += `<i class="cell partial" style="--fill:${pct}%"></i>`;
    }
    return `<span class="cells">${s}</span>`;
  }
  /** Bench 2026-09-17: the thin build-up bar for a weapon that heats ($ALCD token 5), shown only once the
   *  active slot has reported heat>0 this life (`heatEverSeen`) -- a weapon that never heats never draws
   *  this at all. `hot` reads `overheatShown`, the SAME field as the OVERHEAT prompt and overlay in `_live()`,
   *  so the bar and the word can never disagree (maint review 2026-09-17: it read `st.overheating`, the
   *  mechanic's 25 s window, and stayed hot for up to 19 s after the word cleared). */
  _heatBar(st) {
    if (!st.heatEverSeen) return '';
    const pct = Math.max(0, Math.min(100, Math.round(st.heat || 0)));
    return `<div class="heat ${st.overheatShown ? 'hot' : ''}" id="heat"><i style="width:${pct}%"></i></div>`;
  }
  /** A cell-gauge weapon (F248: `rounds_per_charge > 1`, see usesCellGauge above) gets the percentage bar
   *  (no round to pip). Everything else -- a bullet weapon, or a low-cost energy weapon like the Rail Gun
   *  -- gets one pip per round up to AMMO_PIP_MAX; above it, a continuous bar (the exact count is already
   *  the digits beside this gauge, in `#mag`/`#res`). Same warn rule throughout: alive, a known mag, at or
   *  under 15% left. */
  _pips(st) {
    const mag = st.mag || Math.max(st.ammo, 1);
    const warn = !!(st.alive && st.mag && st.ammo < st.mag && st.ammo / st.mag <= .15);
    if (usesCellGauge(st)) {
      const pct = Math.max(0, Math.min(100, Math.round(100 * st.ammo / mag)));
      return `<div class="bar energy ${warn ? 'warn' : ''}"><i style="width:${pct}%"></i></div>`;
    }
    if (mag > AMMO_PIP_MAX) {
      const pct = Math.max(0, Math.min(100, Math.round(100 * st.ammo / mag)));
      // "ammobar" (not "ammo"): the ammo COLUMN also uses `.ammo` (position:absolute;right:36px;bottom:32px),
      // and this bar sits inside `.pips`, which is `position:relative` -- a shared class name here pulled
      // the bar out of flow and made it float over the mag digits (bench 2026-09-17).
      return `<div class="bar ammobar ${warn ? 'warn' : ''}"><i style="width:${pct}%"></i></div>`;
    }
    const lit = Math.max(0, Math.min(mag, Math.round(st.ammo)));
    let s = ''; for (let i = 0; i < mag; i++) s += `<i class="${i < lit ? (warn ? 'warn' : '') : 'spent'}"></i>`;
    return s;
  }

  // ---------- per-tick patch ----------
  _statusLine(st, mode) {
    // Player-facing wording; the raw wsState / synced / headEcho / arm_state stay in the diag panel (LINK/ENGINE).
    const mc = st.wsState === 'bound' ? '<b>HOST ✓</b>' : '<span class="bad">CONNECTING…</span>';
    const clock = st.synced ? '<b>IN SYNC ✓</b>' : '<span class="bad">SYNCING…</span>';
    if (mode === 'connected') return `GUN <b>CONNECTED ✓</b> · ${mc}`;
    if (mode === 'lobby') return `<b>LOCKED IN ✓</b>${st.headEcho ? '' : ' · <span class="bad">GUN NOT ANSWERING — CHECK HEADSET</span>'} · ${clock}`;
    return `${st.tutorial ? '<span style="color:var(--warn)">TRY-OUT ARMED — FIRE A FEW ROUNDS</span><br>' : ''}${mc} · ${clock}`;
  }
  /** The line under the READY button. The UNSYNCED case is shared by both screens because `engine.setReady`
   *  refuses the tap until the clock is synced — on either of them, and silently. */
  _readyNote(st, mode) {
    if (!st.synced && !st.ready) return 'Syncing clock with Mission Control… you can ready up in a moment.';
    // NOT "the host cannot start until everyone has": `_all_ready` gates KIT -> LOBBY only, so after a
    // match the host pushes the next one whenever they like. Promising a veto the player does not have is
    // how someone sits out a round waiting to be waited for (review 2026-09-12).
    if (mode === 'over') return st.ready ? 'Standing by — the next match kits you automatically.'
      : 'Tap to ready up for the next match — the host sees who is ready. Scores reconcile at Mission Control.';
    return st.ready ? 'Waiting for the host to arm the match. Tap again to un-ready.'
      : 'Tap when you are set. The host pushes the game once everyone is ready.';
  }
  _patch(st) {
    const q = id => this.hudEl.querySelector('#' + id);
    const set = (id, v) => { const el = q(id); if (el && el.textContent !== String(v)) el.textContent = v; };
    const setHtml = (id, html) => { const el = q(id); if (el && el.innerHTML !== html) el.innerHTML = html; };
    if (st.phase === 'connected' || st.phase === 'kitted' || st.phase === 'lobby') {
      // T2 INTEGRATION: a benched phone renders `_lobby(st, 'standby')` from EITHER phase, and that
      // screen prints `_statusLine(st, 'kitted')` -- so the patch has to agree, or the status line it
      // rewrites every tick contradicts the structure it was rendered into (LOCKED IN on a phone that
      // is sitting out). `readynote` does not exist on that screen; `setHtml` is null-safe.
      const mode = (st.standby && (st.phase === 'kitted' || st.phase === 'lobby')) ? 'kitted' : st.phase === 'connected' ? 'connected' : st.phase === 'lobby' ? 'lobby' : (st.ended ? 'over' : 'kitted');
      if (mode !== 'over') setHtml('mcstatus', this._statusLine(st, mode));
      // F-4: the lobby's own READY UP (kit closed, not yet ready) reads the same live note the kitted
      // screen does — `synced` is patched, never in the render signature.
      if (mode === 'kitted' || mode === 'over' || (mode === 'lobby' && !st.kitOpen && !st.ready)) setHtml('readynote', this._readyNote(st, mode));
    }
    if (st.phase === 'live') {
      set('clock', mmss(st.clockMs)); set('hp', st.hp); set('sh', st.armor); set('shield', st.shield); set('mag', magText(st)); setHtml('res', this._resText(st));
      const shield = q('shield'); if (shield) shield.classList.toggle('zero', st.shield === 0);
      set('batt', st.battery != null ? st.battery + '%' : '—');
      setHtml('fxbar', this._fx(st));                   // S16: the poison countdown
      setHtml('aimfx', this._aimFx(st));                // S53: the smoke countdown (the slot itself is structural)
      const hb = q('hpbar'); if (hb) hb.style.width = `${Math.round(100 * st.hp / st.maxHp)}%`;
      const sb = q('shbar'); if (sb) sb.style.width = `${Math.round(100 * st.armor / st.maxArmor)}%`;
      const shieldb = q('shieldbar'); if (shieldb) shieldb.style.width = `${Math.round(100 * st.shield / st.maxShield)}%`;
      const bf = q('battfill'); if (bf) bf.style.right = `${100 - (st.battery || 0)}%`;
      const pips = q('pips'); if (pips) { const html = this._pips(st); if (pips.innerHTML !== html) pips.innerHTML = html; }
      const heat = q('heat'); if (heat) {
        const pct = Math.max(0, Math.min(100, Math.round(st.heat || 0)));
        const i = heat.querySelector('i'); if (i && i.style.width !== `${pct}%`) i.style.width = `${pct}%`;
        const cls = 'heat' + (st.overheatShown ? ' hot' : ''); if (heat.className !== cls) heat.className = cls;   // the DISPLAY window, same as `_heatBar`/`_live`
      }
      set('st-K', st.kills == null ? '—' : st.kills); set('st-D', st.deaths); set('st-A', st.assists == null ? '—' : st.assists); if (accShown(st) != null) set('st-ACC', accShown(st) + '%');
      const dot = q('linkdot'); if (dot) { const cls = 'dot ' + (st.bleUp ? '' : 'off'); if (dot.className !== cls) dot.className = cls; }
      set('linklab', st.bleUp ? 'GUN' : 'NO GUN');
      if (this.board) { set('bdage', this._boardAge(st)); const ag = q('bdage'); if (ag) ag.classList.toggle('stale', this._boardStale(st)); }
      const md = q('mcdot'); if (md) { const cls = 'dot ' + (st.wsState === 'bound' ? '' : 'ws'); if (md.className !== cls) md.className = cls; }
    }
  }

  // ---------- chips (WS / BLE / resync / tutorial) ----------
  _chips(st) {
    const pills = [];
    // S52: this is an accessibility control, not a perk, so keep the instruction
    // visible wherever the player can forget what ALT does. The picker warning
    // handles the conflicting second-weapon choice; this handles actual play.
    if (st.phase !== 'idle' && st.loadout && st.loadout.overrides && st.loadout.overrides.easy_reload) {
      pills.push('<span class="pill ok easyreload"><span class="unskew">ALT = RELOAD</span></span>');
    }
    if (st.wsState === 'bound') this.mcPill = false;   // the opt-in range pill is per outage, not forever
    if (st.wsState === 'rejected') pills.push(`<span class="pill bad"><span class="unskew">ASK THE HOST — COULDN'T JOIN${st.wsReason ? ' (' + esc(String(st.wsReason)).toUpperCase() + ')' : ''}</span></span>`);
    // Playing out of MC range is the NORMAL case mid-match (Tony, review 2026-09-03 #32): live shows it as the amber MC
    // dot only; a tap on the MC label shows the detail pill. Before the match (kitted/lobby) MC is required, so the pill stays.
    // (night hides the header dots, so there the dim pill is the only off-range signal)
    else if (st.phase !== 'idle' && st.phase !== 'connected' && st.wsState !== 'bound' && (st.phase !== 'live' || this.mcPill || st.night)) pills.push(`<span class="pill warn"><span class="unskew">${st.phase === 'live' ? 'OUT OF MISSION CONTROL RANGE — SCORES SYNC WHEN YOU ARE BACK' : 'RECONNECTING TO MISSION CONTROL…'}</span></span>`);
    // A tappable pill, not just a status: the retry now runs forever, but a player who has just
    // switched the gun on should not have to wait out a backoff — or go hunting in the debug panel,
    // which is where the only reconnect control used to live (Tony, field 2026-09-01).
    // Bench 2026-09-17: a gun with its headset off accepts the link and drops it within seconds, over and
    // over. The GUN LINK LOST pill then blinked on and off with every cycle. While the phone counts 2+
    // quick drops in a row, one steady line says the likely cause, whether the link is up this second or not.
    // Game day 2026-09-19: after 3 flaps in a row the phone stops reconnecting for 30 s (BrxLink's quiet
    // period). The line says what fixes it; RECONNECT NOW ends the quiet period at once. It shows in every phase.
    if (st.gunFlapping && st.gunFlapping.quiet) pills.push(`<span class="pill bad" data-flap="${st.gunFlapping.count}" data-quiet="1"><span class="unskew">GUN KEEPS DROPPING. POWER-CYCLE THE HEADSET, THEN THE GUN RECONNECTS.</span></span><button class="pill warn" data-act="onReconnectNow"><span class="unskew">RECONNECT NOW</span></button>`);
    else if (st.phase !== 'idle' && st.gunFlapping) pills.push(`<span class="pill warn" data-flap="${st.gunFlapping.count}"><span class="unskew">HEADSET OFF? TURN THE HEADSET ON.</span></span><button class="pill warn" data-act="onReconnectNow"><span class="unskew">RECONNECT NOW</span></button>`);
    else if (st.phase !== 'idle' && !st.bleUp) pills.push(`<button class="pill bad" data-act="onReconnectGun"><span class="unskew">GUN LINK LOST — TAP TO RECONNECT</span></button>`);
    if (st.moment && st.moment.kind === 'go' && st.phase === 'live' && st.bleUp) pills.push(`<span class="pill ok"><span class="unskew">WEAPONS HOT</span></span>`);   // never 'hot' while the gun link is down
    const prompt = st.resync ? `<div class="prompt"><span class="unskew"><span class="pl">GUN RELINKED</span><span class="pi">${esc(st.resync.prompt).toUpperCase()}</span></span></div>` : '';
    // S57: the IR callout bus. One word from a victim's gun, heard by this one: KILL CONFIRMED when it names me as the
    // killer, else ENEMY or TEAMMATE DOWN (the victim's name when the word named them). Live and alive only: a dead gun
    // hears nothing, and the down screen owns the dead phone.
    const co = st.callout;
    if (co && st.phase === 'live' && st.alive) {
      const lab = co.kind === 'kill_confirmed' ? 'KILL CONFIRMED' : co.kind === 'teammate_down' ? 'TEAMMATE DOWN' : 'ENEMY DOWN';
      pills.push(`<span class="pill ${co.kind === 'teammate_down' ? 'warn' : 'ok'} callout" data-callout="${esc(co.kind)}"><span class="unskew">${lab}${co.name ? ' · ' + esc(String(co.name).toUpperCase()) : ''}</span></span>`);
    }
    const html = `<div class="chipbar">${pills.join('')}</div>${prompt}`;
    if (this.chips.innerHTML !== html) this.chips.innerHTML = html;
  }

  // ---------- moments (overlay) ----------
  _moments(st) {
    // The reload takeover owns the chip bar. Tracked here, before ANY branch returns: dying mid-reload once left the
    // flag set for the whole DOWN screen and hid GUN LINK LOST exactly when it mattered (pass-2 review 2026-09-03).
    // The phase intentionally restores as IDLE until BLE relinks after an app restart. The verdict itself is
    // match-scoped and durable, so it remains the screen truth during that pre-relink gap too.
    const lockedUp = !!st.gunLocked;
    // A full-screen instruction must also be the only interactive/accessibility surface. `inert` blocks
    // keyboard, pointer and assistive-tech traversal; aria-hidden covers older embedded WebViews.
    for (const el of [this.hudEl, this.chips, this.info, this.skin, this.diag]) {
      if (!el) continue;
      el.inert = lockedUp;
      if (lockedUp) { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); }
      else { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); }
    }
    const reloadUp = !!(st.phase === 'live' && st.alive && st.bleUp && st.reloading);
    const switchUp = !!(st.phase === 'live' && st.alive && st.bleUp && st.switching && !reloadUp);
    const reconcileUp = !!(st.phase === 'live' && st.reconciling);
    const tk = lockedUp ? 'gun_locked' : reloadUp ? 'reload' : switchUp ? 'switch' : reconcileUp ? 'reconcile' : '';
    if ((this.frame.dataset.takeover || '') !== tk) { if (tk) this.frame.dataset.takeover = tk; else delete this.frame.dataset.takeover; }
    // F272: affirmative MCU lock-up. Durable through the expected power-cycle link drop; only the locked
    // relink recovery clears it and moves this player onto the ordinary DOWN/respawn screen.
    if (lockedUp) {
      const phase = st.gunRecovery || 'power_cycle';
      const key = `gun_locked_${phase}`;
      if (this._moment !== key) {
        this._moment = key;
        const copy = phase === 'rearming'
          ? '<span class="k">YOUR GUN IS RESTARTING</span><span class="t">KEEP POWER ON</span><span class="s">RE-ARMING…</span>'
          : phase === 'retry_exhausted'
            ? '<span class="k">RE-ARMING DID NOT FINISH</span><span class="t">POWER-CYCLE AGAIN</span><span class="s">HOLD POWER 3 s, THEN POWER ON</span>'
            : '<span class="k">YOUR GUN HAS STOPPED</span><span class="t">HOLD POWER <b>3 s</b>, THEN POWER ON</span><span class="s">YOUR PHONE WILL RE-ARM IT.</span>';
        this.overlay.innerHTML = `<div class="mo gunlocked" data-gun-locked data-gun-recovery="${phase}" role="alert" aria-live="assertive"><div class="wash"></div>
          <div class="c">${copy}</div></div>`;
      }
      return;
    }
    if (this._moment && this._moment.startsWith('gun_locked_')) { this._moment = null; this.overlay.innerHTML = ''; }

    // T-MINUS while armed
    if (st.phase === 'armed' && st.tMinusMs != null) {
      const secs = Math.ceil(st.tMinusMs / 1000);
      const big = secs > 99 ? mmss(st.tMinusMs) : pad2(secs);
      if (this._moment !== 'tminus') {
        this._moment = 'tminus';
        // A31: the compiler emits this line ONCE (`assign.game.mc_verify`) so MC and every phone say the same
        // thing. Rendered only when it is there — full coverage, or every phone on cellular through the tunnel (F309), and it is absent.
        const mcv = (st.game && st.game.mc_verify) ? `<div class="mcv"><span>${esc(String(st.game.mc_verify).toUpperCase())}</span></div>` : '';
        this.overlay.innerHTML = `<div class="mo tminus"><div class="hz t"></div><div class="hz b"></div><div class="glow"></div>${mcv}
          <div class="c"><div class="lab"><span class="h">T-MINUS</span><span class="s">WEAPONS ARMING</span><span class="s">STAND BY</span></div>
          <span class="n tab ${secs > 99 ? 'mm' : ''}" id="tm">${big}</span>
          <div class="r"><span class="chip"><span class="unskew">${esc(st.teamName)} · ${esc(st.callsign)}</span></span><span class="s">${esc(st.mode)} · ${mmss(st.clockMs)}</span></div></div></div>`;
        this._lastTminus = null;
      }
      const el = this.overlay.querySelector('#tm');
      if (el && this._lastTminus !== big) {
        this._lastTminus = big; el.textContent = big; el.classList.toggle('mm', secs > 99);
        el.classList.remove('punch'); void el.offsetWidth; el.classList.add('punch');
      }
      if (st.tMinusMs <= 0) this._flash();
      return;
    }
    if (this._moment === 'tminus' && st.phase !== 'armed') { this._moment = null; this.overlay.innerHTML = ''; }

    // DOWN (persistent while dead)
    if (st.phase === 'live' && !st.alive) {
      const kb = st.killedBy || {}; const tk = kb.teamKey;   // F81: null = no identity on the wire, so no team chip
      const recoveryDown = st.downReason === 'gun_recovery';
      const downKey = recoveryDown ? 'down_recovery' : 'down';
      if (this._moment !== downKey) {
        this._moment = downKey;
        const title = recoveryDown
          ? '<span class="tt"><span class="t">GUN RESTARTED</span><span class="t t2">REDEPLOYING</span></span><span class="kb">REDEPLOYING</span>'
          : `${st.respawnType === 'scanner' ? '<span class="tt"><span class="t">DOWN</span><span class="t t2">RESPAWN<br>AT STATION</span></span>' : '<span class="t">DOWN</span>'}<span class="kb">${kb.dot ? 'POISONED BY' : 'KILLED BY'} <b style="${tk ? `background:${TEAM_COLOR[tk]};color:${TEAM_INK[tk]}` : 'background:var(--mut);color:var(--bg,#000)'}"><span class="unskew">${esc(kb.name || kb.teamName || 'UNKNOWN')}</span></b></span><span id="dnlife">${this._lifeLine(st, kb)}</span>`;
        this.overlay.innerHTML = `<div class="mo down"><div class="wash"></div>
          <div class="c"><div class="l2">${title}</div>
          <div class="dn" id="dnhint">${this._downHint(st)}</div></div>
          ${this._downSafe(st)}
          <div class="recap" id="downrecap">${this._downRecap(st)}</div></div>`;
        this._downSafeSig = this._downSafe(st);
        this._flash();
        if ((Number(st.downWarn) || 1) >= 3 && st.respawnType === 'auto') this.h.onHaptic && this.h.onHaptic('down');
      } else {
        const el = this.overlay.querySelector('#rd'); if (el) { const h = digits(st.respawnIn); if (el.innerHTML !== h) el.innerHTML = h; }
        const hk = this._downHintKey(st); if (hk !== this._downHintSig) { const h = this.overlay.querySelector('#dnhint'); if (h) h.innerHTML = this._downHint(st); }
        const sf = this._downSafe(st); if (sf !== this._downSafeSig) { this._downSafeSig = sf; const el = this.overlay.querySelector('#dnsafe'); if (el) el.outerHTML = sf; }
        const rc = this.overlay.querySelector('#downrecap'); if (rc) { const h = this._downRecap(st); if (rc.innerHTML !== h) rc.innerHTML = h; }
        // S56: PARTIAL clears once the death grace is over and a straggling relay can still move DEALT, so re-read it
        const dl = this.overlay.querySelector('#dnlife'); if (dl) { const h = this._lifeLine(st, st.killedBy || {}); if (dl.innerHTML !== h) dl.innerHTML = h; }
      }
      return;
    }
    if ((this._moment === 'down' || this._moment === 'down_recovery') && (st.alive || st.phase !== 'live')) { this._moment = null; this.overlay.innerHTML = ''; }

    // RECONCILING (S7.1): a BLE rejoin mid-match holds the gun disarmed for 3 s while the engine reconciles its
    // real pools — it never infers a death and never heals. Tell the player to wait, not to panic or pull anything.
    if (st.phase === 'live' && st.reconciling) {
      if (this._moment !== 'reconcile') {
        this._moment = 'reconcile';
        this.overlay.innerHTML = `<div class="mo reconciling"><div class="c"><span class="k">GUN RELINKED</span><span class="t">SYNCING WITH YOUR GUN</span>
          <div class="track"><i></i></div><span class="s">WEAPON DISARMED FOR A MOMENT · STAND BY</span></div></div>`;
      }
      return;
    }
    if (this._moment === 'reconcile' && !(st.phase === 'live' && st.reconciling)) { this._moment = null; this.overlay.innerHTML = ''; }

    // RELOADING (persistent for the weapon's reload time; the gun will not fire until the mag is back)
    if (reloadUp) {
      // `reloadTotalMs` is only the NOMINAL length, and on a chain weapon it is the PER-SHELL time — a 6-shell
      // tube spends most of its reload past it. Counting "0.0S" down at a bar pinned to 100% for two seconds is
      // a wrong number, so once `reloadOverrun` is up the bar goes indeterminate and the countdown goes away.
      // LATCHED for the takeover: on a chain weapon `reloadOverrun` blinks off at every shell and back on
      // 400 ms later, and a bar that alternates between indeterminate and a wrong number is worse than either.
      // Keyed on WHICH reload this is (`st.reloadAt`), because `_moment` cannot tell two apart: a $ALCD
      // (fired) and a $BUT,2,1 in ONE BLE batch end and re-open the takeover between two renders, so
      // `_moment` never left 'reload' and the new reload opened on the old one's latch — already pulsing,
      // its countdown already gone, at a magazine that had only just started moving (review 2026-09-12).
      const fresh = this._moment !== 'reload' || this._rlAt !== st.reloadAt;
      const over = !!st.reloadOverrun || (!fresh && this._rlOver === true);
      const pct = over ? 100 : Math.min(100, Math.round(100 * st.reloadMs / st.reloadTotalMs)), left = Math.max(0, (st.reloadTotalMs - st.reloadMs) / 1000);
      if (fresh) {
        this._moment = 'reload'; this._rlOver = null; this._rlAt = st.reloadAt;
        this.overlay.innerHTML = `<div class="mo reloading"><div class="c"><span class="t" id="rlt">RELOADING</span><span class="s">${esc(st.weapon)}</span>
          <div class="track"><i id="rlbar" style="width:${pct}%"></i></div><span class="n tab" id="rlleft">${left.toFixed(1)}S</span></div></div>`;
        this.h.onHaptic && this.h.onHaptic('tap');
      }
      if (this._rlOver !== over) {
        this._rlOver = over;
        const mo = this.overlay.querySelector('.mo.reloading'); if (mo) mo.classList.toggle('over', over);
        const t = this.overlay.querySelector('#rlt'); if (t) t.textContent = over ? 'RELOADING…' : 'RELOADING';
      }
      const b = this.overlay.querySelector('#rlbar'); if (b) b.style.width = pct + '%';
      const n = this.overlay.querySelector('#rlleft'); if (n && !over) n.textContent = left.toFixed(1) + 'S';
      // no early return: hits, gains and kills append ABOVE the takeover — reloading is exactly when you get shot (suite audit 2026-09-03)
    } else if (this._moment === 'reload') { this._moment = null; this._rlAt = null; this.overlay.innerHTML = ''; }   // (reloadUp is the single source of truth for the flag AND the overlay)

    // SWITCHING WEAPON (persistent for the assumed swap window; the gun will not fire mid-swap). Ends with a 'switched' moment.
    if (switchUp) {
      const pct = Math.min(100, Math.round(100 * st.switchingMs / st.switchWindowMs));
      if (this._moment !== 'switch') {
        this._moment = 'switch';
        const lo = st.loadout || {}; const items = [lo.primary, lo.secondary];
        this.overlay.innerHTML = `<div class="mo switching"><div class="c"><span class="t">SWITCHING</span>
          <div class="pair">${this._wtile(items[st.switchFrom], 'STOWING', 'from')}<span class="arr">▸▸▸</span>${this._wtile(items[st.switchTo], 'DRAWING', 'to')}</div>
          <div class="track"><i id="swbar" style="width:${pct}%"></i></div></div></div>`;
        this.h.onHaptic && this.h.onHaptic('tap');
      } else { const b = this.overlay.querySelector('#swbar'); if (b) b.style.width = pct + '%'; }
    } else if (this._moment === 'switch') { this._moment = null; this.overlay.innerHTML = ''; }

    this._redeployTick(st);   // 2026-09-19: ACTIVATING WEAPON SYSTEMS… turns to WEAPONS HOT when the trigger goes live
    // transient moments
    const m = st.moment;
    if (m && m.at !== this._momentAt) {
      this._momentAt = m.at;
      if (m.kind === 'kill') this._kill(st, m);
      else if (m.kind === 'redeploy') this._redeploy(st);
      else if (m.kind === 'switched') this._switched(st, m);
      else if (m.kind === 'alert') this._alert(st, m);
      else if (m.kind === 'hit') this._hit(st, m);
      else if (m.kind === 'gain') this._gain(st, m);
      else if (m.kind === 'go') this._flash();
    }
  }
  /** Replace the live overlay of this KIND rather than stacking another on top of it.
   *
   * Appending unconditionally is fine for a rare event and wrong for a frequent one: at 10 hits/s
   * eight hit overlays were alive at once, compositing to a near-opaque red wash that hid the HP and
   * ammo readouts at exactly the moment a player is being focused, and stacking two damage numbers
   * at identical coordinates into an unreadable mash. One node per kind, re-triggered.
   */
  _swap(kind, el, outAt, gone) {
    this._overlays = this._overlays || {};   // (was `this._live`, which collided with the _live(st) render method)
    const prev = this._overlays[kind];
    let node = el;
    if (prev && prev.el.isConnected) {
      // REUSE the live node rather than replacing it. Replacing re-ran the entrance animation on
      // every event, so under sustained fire the vignette sawtoothed 0 -> 0.96 -> 0 at the hit rate
      // and the damage number never settled -- a new ~10 Hz modulation, below the hazard threshold
      // but exactly the kind of thing this design exists to avoid.
      clearTimeout(prev.t1); clearTimeout(prev.t2);
      prev.el.classList.remove('out');
      prev.el.innerHTML = el.innerHTML;
      prev.el.className = el.className;
      node = prev.el;
    } else {
      if (prev) { clearTimeout(prev.t1); clearTimeout(prev.t2); prev.el.remove(); }
      this.overlay.appendChild(el);
    }
    const rec = { el: node, t1: setTimeout(() => node.classList.add('out'), outAt),
                  t2: setTimeout(() => { node.remove(); if (this._overlays[kind] === rec) delete this._overlays[kind]; }, gone) };
    this._overlays[kind] = rec;
    return node;   // the node actually on screen (a reused one is NOT `el`)
  }

  _flash() {
    if (this.frame.dataset.env === 'night') return;
    const now = Date.now(); if (this._flashAt && now - this._flashAt < 500) return; this._flashAt = now;   // ≤2 flashes/s whatever the event burst (WCAG 2.3.1)
    const w = document.createElement('div'); w.className = 'whiteout'; this.overlay.appendChild(w); setTimeout(() => w.remove(), 120); }
  _kill(st, m) {
    if (this.frame.dataset.env === 'night') return;
    const vt = (m.data && m.data.victim_team) || 'yellow'; const vk = String(vt).toLowerCase();
    const el = document.createElement('div');
    el.className = 'mo kill';
    el.innerHTML = `<div class="rays"></div><div class="ring1"></div><div class="ring2"></div>
      <div class="c"><span class="elim"><span class="unskew">+1 ELIMINATION</span></span><span class="k">KILL</span><span class="cf">CONFIRMED</span>
      <div class="bars"><i style="width:90px;background:var(--warn)"></i><i style="width:34px;background:var(--glow)"></i><i style="width:12px;background:var(--glow);opacity:.5"></i></div></div>
      <div class="foot"><span class="vt" style="background:${TEAM_COLOR[vk] || 'var(--team-yellow)'};color:${TEAM_INK[vk] || '#1a1400'}"><span class="unskew">${esc((m.data && m.data.victim) || (vk.toUpperCase() + ' OPERATIVE'))} DOWN</span></span>
      <span class="by">K ${st.kills != null ? st.kills : ''} · CONFIRMED BY MISSION CONTROL</span></div>`;
    const medals = (m.data && Array.isArray(m.data.medals) ? m.data.medals : []).filter(k => MEDAL_LABEL[k]);
    if (medals.length) el.querySelector('.c').insertAdjacentHTML('beforeend', `<div class="medals">${medals.map((k, i) => `<span class="medal ${esc(k)}" style="animation-delay:${.12 + i * 2}s"><span class="unskew">${MEDAL_LABEL[k]}</span></span>`).join('')}</div>`);
    this._flash();
    const hold = 1800 + Math.max(0, medals.length - 1) * 2000;   // each medal line plays 2 s after the last (engine MEDAL_GAP_MS)
    this._swap('kill', el, hold, hold + 400);   // three confirms 300ms apart used to stack three banners
    this.h.onHaptic && this.h.onHaptic('kill');
  }
  /** S56: one short line under KILLED BY: the killer's weapon, what this life took (and from how many sources), and
   *  what it dealt. The weapon is the killer's top weapon by damage: its name when resolved, WEAPON UNCLEAR when the
   *  phone could not choose, nothing when it has no claim. Dealt comes from the victims' phones through Mission Control,
   *  best-effort: PARTIAL when a hit may not have reached this phone, and ? rather than a confident 0 when nothing did. */
  _lifeLine(st, kb) {
    const life = st.lastLife; if (!life) return '';
    const r = kb.num != null && !kb.dot ? (life.taken || []).find(x => x.num === kb.num) : null;
    const w = r && (r.weapons || []).slice().sort((a, b) => b.dmg - a.dmg)[0];
    const parts = [];
    if (w && w.ambiguous) parts.push('WEAPON UNCLEAR');
    else if (w && w.name) parts.push(esc(String(w.name).toUpperCase()));
    const src = (life.taken || []).length;
    if (life.takenTotal) parts.push(`TOOK <b>${life.takenTotal}</b>${src > 1 ? ` FROM ${src}` : ''}`);
    if (life.dealtTotal) parts.push(`DEALT <b>${life.dealtTotal}</b>${life.dealtPartial ? ' PARTIAL' : ''}`);
    else if (life.dealtPartial) parts.push('DEALT <b>?</b>');
    return parts.length ? `<span class="lf">${parts.join(' · ')}</span>` : '';
  }
  /** S56: the weapon line under the HIT chip. An ambiguous resolution names up to two candidates with OR
   *  (never a guess); three or more show WEAPON UNCLEAR instead. No line at all when the phone has no
   *  claim (an older MC sends no roster weapons). */
  _hitWeapon(w) {
    if (!w) return '';
    const names = w.ambiguous ? (w.names || []) : [w.name || w.id];
    if (!names.length || names.length > 2) return w.ambiguous ? '<span class="hw">WEAPON UNCLEAR</span>' : '';
    return `<span class="hw">${names.map(x => esc(String(x).toUpperCase())).join(' OR ')}</span>`;
  }
  // TAKING A HIT. Deliberately a single fade, never a repeating flicker: this feedback moved off the
  // gun's LEDs precisely because winning that surface needed ~30 Hz repaints that strobe, and
  // flicker in the 10-25 Hz band is the photosensitive-epilepsy trigger range. One transition only.
  // Renders at night too (dimmer, no whiteout) -- knowing you are being shot is not optional.
  _hit(st, m) {
    const d = (m.data) || {};
    const tk = d.shooter_key || 'red';
    const el = document.createElement('div');
    el.className = 'mo hit';
    const where = d.sensor === 4 ? 'GUN' : d.sensor != null ? 'HEADSET' : '';
    // The team colour stays INLINE and the night stylesheet overrides it with `!important`, which
    // beats a non-important inline style. Stripping the inline style at night instead worked, but
    // made the chip depend on that one CSS rule existing: delete the rule and the chip would have no
    // background at all. This way the day colour is the fallback.
    el.innerHTML = `<div class="vig"></div>
      <div class="hc"><span class="dmg tab">-${esc(d.dmg)}</span>
      <span class="src" style="background:${TEAM_COLOR[tk] || 'var(--bad)'};color:${TEAM_INK[tk] || '#fff'}"><span class="unskew">HIT${where ? ' · ' + where : ''}</span></span>${this._hitWeapon(d.weapon)}</div>`;
    this._swap('hit', el, 260, 700);
    this.h.onHaptic && this.h.onHaptic('hit');
  }

  // GAINING a pool: heal, armour pickup, shield grant. Colour matches the pool so the player learns
  // one mapping across the gun strip and the HUD (poolgauge.py: shield teal, armour purple, health green).
  _gain(st, m) {
    const d = (m.data) || {};
    const el = document.createElement('div');
    el.className = `mo gain ${esc(d.pool)}`;
    const label = d.pool === 'armor' ? 'ARMOUR' : d.pool === 'shield' ? 'SHIELD' : 'HEALTH';
    el.innerHTML = `<div class="gv"></div>
      <div class="gc"><span class="amt tab">+${esc(d.amount)}</span><span class="lab">${label}</span></div>`;
    this._swap('gain', el, 500, 1000);
    this.h.onHaptic && this.h.onHaptic('gain');   // a pickup you are not looking at should be FELT
  }

  /** One weapon tile for the SWITCHING takeover and the ACTIVE confirm. */
  _wtile(it, label, cls) {
    if (!it) return `<span class="wt ${cls}"><span class="th none">—</span><span class="wl">${label}</span><span class="wn">NONE</span></span>`;
    const th = it.kind === 'perk' ? `<span class="th perk">${perkGlyph(it.perk_id)}</span>` : `<span class="th">${weaponArt(it.weapon_id)}</span>`;
    return `<span class="wt ${cls}">${th}<span class="wl">${label}</span><span class="wn">${esc(it.name).toUpperCase()}</span></span>`;
  }
  /** The swap confirmed (by the next shot's $ALCD) or assumed (window expired): the new weapon, marked ACTIVE. */
  _switched(st, m) {
    const lo = st.loadout || {}; const it = [lo.primary, lo.secondary][m.data && m.data.slot] || null;
    const el = document.createElement('div'); el.className = 'mo switched';
    el.innerHTML = `<div class="c"><div class="in">${this._wtile(it, 'ACTIVE ✓', 'to on')}<span class="s">${m.data && m.data.assumed ? 'READY' : 'CONFIRMED BY YOUR GUN'}</span></div></div>`;
    this._swap('switched', el, 900, 1200);
  }

  /** A11.4 game-event alert: a full-width banner, stronger than a hit, weaker than KILL / DOWN, ~2.5 s. Renders at night too (dim). */
  _alert(st, m) {
    const d = (m.data) || {}; const fam = ALERT_FAMILY[d.kind] || 'info';
    const el = document.createElement('div'); el.className = `mo alert ${fam}`;
    el.innerHTML = `<div class="band"><span class="k">${fam === 'objective' ? 'OBJECTIVE' : fam === 'clock' ? 'CLOCK' : fam === 'danger' ? 'ALERT' : 'MATCH'}</span><span class="t">${esc(String(d.text || d.kind || '').toUpperCase())}</span></div>`;
    this._swap('alert', el, 2200, 2600);
    this.h.onHaptic && this.h.onHaptic('tap');
  }

  /** The REDEPLOYED sub-line (2026-09-19): arming while a timed respawn holds the trigger, the shield on a station
   *  respawn, else WEAPONS HOT. */
  _redeployLine(st) {
    if (st.weaponArming != null) return '<span class="h arming">ACTIVATING WEAPON SYSTEMS…</span>';
    if (st.shielded) return '<span class="h shield">SHIELD UP · WEAPONS HOT ▸▸▸</span>';
    return '<span class="h">WEAPONS HOT ▸▸▸</span>';
  }
  /** Keeps a live REDEPLOYED overlay's sub-line in step with the engine: the trigger goes live under it. */
  _redeployTick(st) {
    const o = this._overlays && this._overlays.redeploy;
    if (!o || !o.el || !o.el.isConnected) return;
    const h = o.el.querySelector('.r .h'); if (!h) return;
    const want = this._redeployLine(st);
    if (h.outerHTML !== want) h.outerHTML = want;
  }
  _redeploy(st) {
    if (this.frame.dataset.env === 'night') return;
    const el = document.createElement('div'); el.className = 'mo redeploy';
    const lo = st.loadout || {};
    const ki = (k, it) => !it ? '' : `<span class="ki">${it.kind === 'perk' ? `<span class="th">${perkGlyph(it.perk_id)}</span>` : `<span class="th">${weaponArt(it.weapon_id)}</span>`}<span><span class="kk">${k}</span><br><span class="kn">${esc(it.name).toUpperCase()}</span></span></span>`;
    el.innerHTML = `<div class="wipe"></div><div class="slash"></div><div class="beam"></div>
      <div class="r"><span class="t">REDEPLOYED</span>${this._redeployLine(st)}<span class="s">${st.maxHp} HP · ${st.maxArmor} ARMOR · MAG FULL</span>
        <div class="kit">${ki('PRIMARY', lo.primary)}${ki('SECONDARY', lo.secondary)}${ki('PERK', lo.perk)}</div></div>
      <div class="l"><span class="cs">${esc(st.callsign)}</span><span class="sq">${esc(st.teamName)} SQUAD</span></div>`;
    this._flash();
    // 2026-09-19: a timed respawn holds the trigger for the weapon delay (up to 3 s), so the overlay stays until the
    // weapon is live and a beat after; `_redeployTick` swaps the line to WEAPONS HOT the moment it is.
    const arming = Number(st.weaponArming) || 0;
    const live = this._swap('redeploy', el, Math.max(1700, arming + 400), Math.max(2100, arming + 800));
    // fit the headline to its column: font metrics differ per platform and a fixed size ran off the right edge (review #31)
    const t = live.querySelector('.t'); let fs = 56;
    while (t && t.scrollWidth > t.clientWidth + 1 && fs > 28) { fs -= 2; t.style.fontSize = fs + 'px'; }
  }

  // ---------- diagnostics ----------
  /** The panel's chrome, built ONCE. F122: `renderDiag` used to replace the whole panel's innerHTML on
   *  every render (app.js pushes fresh diag data 4x/s), which did three things at once — it reset
   *  `scrollTop` to 0, it destroyed the element under the player's finger so a touch that straddled a
   *  render produced NO click at all, and it kept the action row below a growing log. The chrome and the
   *  buttons are now permanent nodes; only the readouts are rewritten, and only when they changed. */
  _diagShell() {
    if (this._diagBuilt) return;
    this._diagBuilt = true;
    const sec = (t, id, pre) => `<h3>${t}</h3>${pre ? `<pre id="${id}"></pre>` : `<div class="kv" id="${id}"></div>`}`;
    // F156/F135/ledger#2+#31 (field 2026-09-12): SCAN QR + the typed address, reachable from every phase —
    // before, the join panel was the ONLY door, gun-first only, and once an address was held there was no
    // way back to it short of clearing app data. This is the one door now; `_lobby`'s own pre-join copy
    // (same eventual #mcurl id — `onSetUrl` reads it by that id, app.js is another lane) hides itself while
    // this one is open. This copy is built ONCE and never destroyed (F122: a rebuilt panel eats a mid-tap
    // touch), so it stays in the DOM behind `#diag{display:none}` after the panel closes — `toggleDiag`
    // above claims/releases the `mcurl` id on it (`.mcurlfield` is the stable hook) so there is never a
    // moment with the id on TWO inputs, hidden or not; `getElementById` on a genuine duplicate is
    // browser-defined, not something to lean on across Android WebView / iOS WKWebView.
    // Polish-loop pass 1 (2026-09-12): `dg-discovered` (a LAN-sweep hit MC no longer auto-joins into) and
    // `dg-mcjoinhint` (what these controls are FOR, or — armed/live only — the two-tap warning) are both
    // live-patched by `renderDiag`, never rebuilt structurally, so a tap on them is never eaten by a render.
    // Pass 3 (UX, a11y HIGH): `dg-mcjoinhint`'s text changing in place is the ONLY signal a first tap on
    // JOIN/RELINK MC/SCAN QR/CONNECT did anything while armed/live — with no live region a screen-reader
    // user hears nothing and the tap reads as dead. `role="status"`/`aria-live="assertive"` announce the
    // swap to the warning text immediately (assertive, not polite: it is safety-relevant — the second tap
    // drops the live MC link).
    const mcjoin = `<div class="mcjoin"><div class="mcjoinnote" id="dg-mcjoinnote">MISSION CONTROL</div>
        <div id="dg-discovered"></div>
        <div class="mcjoinhint" id="dg-mcjoinhint" role="status" aria-live="assertive"></div>
        <div class="mcin"><input class="mcurlfield" value="${esc(this.mcUrl)}" placeholder="ws://mission-control-ip:8766/ws" inputmode="url"><button data-act="onSetUrl">CONNECT</button></div>
        <button class="qrbtn" data-act="onScanQr">▣ SCAN QR</button></div>`;
    const changeGun = !this.diagData.engine || ['idle', 'connected'].includes(this.diagData.engine.phase);
    this.diag.innerHTML = `<button class="close" data-act="onCloseDiag">✕</button>${mcjoin}
      <div class="dbody" id="dbody">
        ${sec('PREFLIGHT', 'dg-pf')}${sec('LINK', 'dg-link')}${sec('ENGINE', 'dg-eng')}${sec('TIMINGS', 'dg-tim')}
        ${sec('LAST FRAMES', 'dg-frames', true)}${sec('HISTORY', 'dg-hist')}${sec('LOG', 'dg-log', true)}
      </div>
      <div class="gunhint" id="dg-gunhint" role="status" aria-live="assertive"></div>
      <div class="btns"><button data-act="onCloseDiag" class="closex">CLOSE</button><button data-act="onChangeGun" id="dg-changegun" ${changeGun ? '' : 'disabled aria-disabled="true"'}>${changeGun ? 'CHANGE TAGGER' : 'TAGGER LOCKED'}</button><button data-act="onReconnectGun" id="dg-relinkgun">RELINK GUN</button><button data-act="onReconnectMc">RELINK MC</button><button data-act="onShareLog">SHARE LOG</button></div>`;
    // Office test 2026-09-19: the debug NIGHT button was redundant -- the ☾/☀ switch (`#skin`, top right,
    // every screen) already flips the same `onToggleNight` handler, and NIGHT OPS (config.night) sets the
    // default from Mission Control's venue on its own. Removed here, not the handler: `#skin` still calls it.
  }
  renderDiag() {
    this._diagShell();
    const d = this.diagData || {}; const pf = d.preflight || {};
    const kv = o => Object.entries(o).map(([k, v]) => `<span>${esc(k)}</span><span class="${v === true ? 'ok' : v === false ? 'bad' : ''}">${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</span>`).join('');
    // F122 (review): read the scroll positions BEFORE the first write. A section that SHRINKS clamps the
    // scroller to its new height, so a position captured afterwards is already the clamped one and "holding
    // the reader's place" would hold the wrong place. The two <pre> scrollers need it as much as the body:
    // they are replaced wholesale ~4x/s and jumped to the top under the reader's thumb.
    const body = this.diag.querySelector('#dbody'), keep = body ? body.scrollTop : 0;
    const pres = ['dg-frames', 'dg-log'].map(id => { const el = this.diag.querySelector('#' + id); if (!el) return null;
      // "was reading the tail" — hold the BOTTOM, so a growing log keeps following; anywhere else, hold the offset.
      return { el, top: el.scrollTop, bottom: el.scrollHeight - el.clientHeight - el.scrollTop <= 4 }; }).filter(Boolean);
    const put = (id, html) => { const el = this.diag.querySelector('#' + id); if (el && el.innerHTML !== html) el.innerHTML = html; };   // an unchanged section is not touched at all
    // MISSION CONTROL join status, one line: never touches the #mcurl input itself (typing survives every push).
    const lk = d.link || {}; const mcs = lk.mc || 'none';
    put('dg-mcjoinnote', mcs === 'bound' ? `MISSION CONTROL · LINKED${lk.reach ? ' · ' + esc(String(lk.reach)).toUpperCase() : ''}`
      : mcs === 'rejected' ? 'MISSION CONTROL · REJECTED — ASK THE HOST'
      : mcs === 'connecting' || mcs === 'open' ? 'MISSION CONTROL · CONNECTING…'
      : lk.mc_url ? 'MISSION CONTROL · NOT CONNECTED' : 'MISSION CONTROL · NO ADDRESS YET — SCAN THE QR');
    // Polish-loop pass 1 (2026-09-12): the discovered-MC row, and the line above CONNECT/SCAN QR — normally
    // what they are FOR, or (armed/live, within the 4 s window `_click` opened) the two-tap warning itself.
    put('dg-discovered', discoveredRow(this.discovered));
    const confirmPending = !!(this._joinConfirm && Date.now() - this._joinConfirm.at < 4000);
    if (this._joinConfirm && !confirmPending) this._joinConfirm = null;
    put('dg-mcjoinhint', confirmPending
      ? `<span class="warn">⚠ TAP AGAIN TO ${JOIN_ACT_VERB[this._joinConfirm.act] || 'RECONNECT'} — THIS DROPS YOUR MISSION CONTROL LINK MID-MATCH</span>`
      : 'NEW MISSION CONTROL ADDRESS? (after a tunnel restart or a different host)');
    // F147-adjacent (pass 1 LOW): this input was built once from `this.mcUrl` and never rebuilt, so a QR
    // rescan (which sets `hud.mcUrl` — app.js, another lane) left the panel showing the address it replaced.
    // Only while the field is not focused — the same rule `render()`'s own `typing` guard already applies.
    // Bench 2026-09-17: RELINK GUN's LIVE confirm line, and RELINKING… (disabled) while `link.relinking`.
    const relinking = !!(d.link && d.link.relinking);
    const gunConfirm = !relinking && !!(this._gunConfirm && Date.now() - this._gunConfirm.at < 4000);
    if (this._gunConfirm && !gunConfirm) this._gunConfirm = null;
    put('dg-gunhint', gunConfirm ? '<span class="warn">RELINK TAKES THE PHONE OFF THE GUN FOR A FEW SECONDS. TAP AGAIN TO RELINK.</span>' : '');
    const rb = this.diag.querySelector('#dg-relinkgun');
    if (rb) { const label = relinking ? 'RELINKING…' : 'RELINK GUN'; if (rb.textContent !== label) rb.textContent = label; if (rb.disabled !== relinking) rb.disabled = relinking; }
    const mcInp = this.diag.querySelector('.mcurlfield');
    if (mcInp && document.activeElement !== mcInp && mcInp.value !== (this.mcUrl || '')) mcInp.value = this.mcUrl || '';
    put('dg-pf', kv(pf));
    put('dg-link', kv(d.link || {}));
    put('dg-eng', kv(d.engine || {}));
    put('dg-tim', kv(d.timings || {}));
    put('dg-frames', esc((d.frames || []).map(f => `${f.dir === 'tx' ? '>>' : '<<'} ${f.f}`).join('\n')));
    const all = this.history || []; const t = all.reduce((a, g) => ({ games: a.games + 1, kills: a.kills + (g.kills || 0), deaths: a.deaths + (g.deaths || 0) }), { games: 0, kills: 0, deaths: 0 });
    put('dg-hist', kv({ 'all-time on this phone': `${t.games} games · ${t.kills} K · ${t.deaths} D`, 'this MC session': this.sessionId || '(not joined)' }));
    put('dg-log', esc((d.log || []).join('\n')));
    if (body && keep && body.scrollTop !== keep) body.scrollTop = keep;   // the LOG grows under the reader's thumb; hold their place
    for (const p of pres) { const want = p.bottom ? p.el.scrollHeight - p.el.clientHeight : p.top; if (p.el.scrollTop !== want) p.el.scrollTop = want; }
  }
}
