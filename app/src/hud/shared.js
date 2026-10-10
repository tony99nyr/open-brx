// Shared HUD words, icons and formatting.
import { TEAM_KEYS, TEAM_INK_HEX, ROLE_LABELS, MEDALS } from '../transport/contract.gen.js';
import { isEnergyClass } from '../weaponclass.js';

// F423: tid 3 paints purple, not green (the gun/headset paint) -- MC's roster names it team_id
// "purple" now (state.py TEAM_DEFS), and `st.teamKey` (engine.js TEAM_KEY) tracks that.
// F432 (2026-09-26): `green` stays as an ALIAS of tid 3 in both maps below, a safety net for a
// pre-F423 preset/saved-game/snapshot that reaches this phone before MC's own migration catches it
// (`state.py`'s preset/snapshot loaders) — the gun still paints purple regardless of which string MC
// sends, so a stray "green" team_id must draw exactly like "purple", not fall back to the plain ink.
export const TEAM_COLOR = { blue: 'var(--team-blue)', yellow: 'var(--team-yellow)', red: 'var(--team-red)', purple: 'var(--team-purple)', green: 'var(--team-purple)' };
export const TEAM_INK = { ...Object.fromEntries(TEAM_KEYS.map((key, tid) => [key, TEAM_INK_HEX[tid]])), green: TEAM_INK_HEX[3] };
// F424: engine.js's own possession tally (`st.possession.by_site`) is keyed by the raw numeric tid the
// beacon carries (TEAM_KEY in engine.js, 0..3), but the board's teams (MC's `score.board`) come back
// keyed by the colour string (`t.team_id`, e.g. "blue"). This is the same table, reversed, so a KOTH
// board can look a team's hold up by its colour.
export const TEAM_TID = { ...Object.fromEntries(TEAM_KEYS.map((key, tid) => [key, tid])), green: 3 };
export const pad2 = n => String(Math.max(0, Math.floor(n))).padStart(2, '0');
/** A countdown as one fixed-width cell per digit (F115). Saira Condensed has no tabular figures, so
 *  `font-variant-numeric:tabular-nums` silently does nothing and every value is a different width:
 *  "11" measured 113px and "88" 179px at the DOWN size. The number lives in a centred flex column, so
 *  each tick re-centred and re-laid-out the glyphs WHILE `animation:heartbeat` was transforming them,
 *  which is the tearing Tony saw. Fixed cells make the width a constant of the digit COUNT alone.
 *
 *  TWO cells, always: three of them at .56em of a 170px frame overrun it, and `respawnIn` is a server
 *  number — a 120 s penalty box or a stalled clock is not the HUD's to render as a layout break. 99 is
 *  the honest ceiling for a countdown you watch tick (review 2026-09-12). */
export const digits = n => pad2(Math.min(99, Math.max(0, Math.floor(n)))).split('').map(c => `<span class="d">${c}</span>`).join('');
export const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${pad2(s / 60)}:${pad2(s % 60)}`; };
/** Polish r2 M2: `max_armor: 0` (Silenced Sniper, the Shields preset) painted `width:NaN%`, which draws FULL. */
// HUD QA R2-02: the peak stands in only for a game that arms no armour (a granted pool has no max). A game with a max
// keeps it: a misread 7070 once drew a full 70 as a 1% bar.
/** F341 x HUD QA R2-02: the gun's pools are not the ones this life armed, and two repairs did not hold. */
export const poolWrong = st => !!(st.poolStale && st.poolStale.why === 'pool_wrong');
/** The GUN dot: red when the link is down, amber when the link is up but the gun's pools are wrong (R2-02). */
export const gunDot = st => 'dot ' + (!st.bleUp ? 'off' : poolWrong(st) ? 'warn' : '');
/** The health bar never draws past its track (a misread 4545 of 45 was a 10100% bar). */
export const hpPct = st => (st.maxHp > 0 ? Math.max(0, Math.min(100, Math.round(100 * st.hp / st.maxHp))) : 0);
export const armorPct = (st, peak = 0) => { const top = st.maxArmor > 0 ? st.maxArmor : peak; return top > 0 ? Math.max(0, Math.min(100, Math.round(100 * st.armor / top))) : 0; };
/** Tony 2026-09-24: "If there is no armor we dont need the 0 or the empty armor bar. If we have armor then the number and
 *  bar show." A game with armour, or armour granted in a game without it (a perk, a pickup). */
export const hasArmor = st => st.maxArmor > 0 || st.armor > 0;
/** A56: an item's own colour from the wire, only ever a literal `#rrggbb` (it lands in a style attribute). */
export const itemColor = c => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : 'var(--glow)');
export const num = v => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
export const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Accuracy is hits/shots where hits come from the VICTIMS' phones — shown only once MC has counted at least one
 *  hit for this player and ten shots have gone out; otherwise it reads 0% for every player without a phone in range. */
export const accShown = st => (st.accuracy != null && st.hits > 0 && st.shots >= 10) ? Math.round(st.accuracy) : null;
/** A24: the only four words the results screen may print as an outcome, and it prints one ONLY when MC has
 *  pushed a `result`. There is deliberately no mapping for "no message arrived" — see `_result`. */
export const OUTCOME_WORD = { win: 'WIN', lose: 'LOSE', draw: 'DRAW', undecided: 'UNDECIDED' };
// Every medal in MC's ladder (contract.gen MEDALS, generated from types.py; Tony's final list 2026-09-24). A key missing
// here was filtered out of the kill card, so the map is built from the contract, never hand-kept.
// The fallback labels the two medals Tony added on 2026-09-24 for an older contract that lacks them: BEAT DOWN (MC's key
// is `melee_kill`) and KILLJOY (ending an enemy's killing spree). A contract row of the same key wins. The keys must be
// the ones MC sends: `beat_down` here labelled a key that never arrived (medal-labels.test.mjs).
export const MEDAL_FALLBACK = Object.freeze([{ key: 'melee_kill', kind: 'melee', label: 'BEAT DOWN' }, { key: 'killjoy', kind: 'killjoy', label: 'KILLJOY' }]);
export const MEDAL_ROWS = [...MEDALS, ...MEDAL_FALLBACK.filter(f => !MEDALS.some(m => m.key === f.key))];
export const MEDAL_LABEL = Object.freeze(Object.fromEntries(MEDAL_ROWS.map(m => [m.key, m.label])));
export const splitGun = g => { if (!g) return ['—', '']; return [esc(g.basename || g.name || ''), esc(g.tail || '')]; };

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
export const BOARD_LIVE_MAX_AGE_MS = 16000;
/** Bench 2026-09-17: bullet-shaped pips read as one pip per round, so a 12-pip gauge on a 4-round sniper mag
 *  lied by 3 pips a shot. Pips now count exactly the magazine size — one pip per round — up to this many; past
 *  it they stop reading as bullets and the gauge switches to a continuous bar (exact count stays in the digits
 *  beside it). 30 is the largest count the pip row fits at 667×375 (the SE stage viewport) without reaching the
 *  vitals plate on the other corner, and it sits in the gap the weapon catalogue leaves between a doubled
 *  (Extended Mags) marksman mag — sniper 4→8, AMR 14→28 — and a doubled sidearm or assault mag — glock 16→32,
 *  bolt rifle 18→36, stinger 18→36 — so the perk never straddles the threshold either way. */
export const AMMO_PIP_MAX = 30;
/** Bench 2026-09-17: `weapon_class` ("ballistic" | "energy" | "melee", `st.weaponClass`) decides the
 *  reload-versus-overheat WORDING (RECHARGE/HOLD TO RECHARGE for energy, RELOAD for ballistic) -- that is
 *  its only job. The old id regex is the named fallback for a pre-A48 bundle that carries no class at
 *  all. */
export const isEnergyWeapon = st => isEnergyClass(st && st.weaponClass, st && st.weaponId);   // DRY-1: one rule (weaponclass.js)
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
export const chargeCost = st => {
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
export const usesCellGauge = st => {
  if (st && st.roundsPerCharge != null) return st.roundsPerCharge > 1;
  if (st && st.weaponClass) return false;
  return (st && st.weaponId === 'charge_rifle') ? CHARGE_RIFLE_FULL_CHARGE_COST > 1
    : /energy|charge/i.test(String((st && st.weaponId) || ''));
};
/** S53/S55: the ONE accuracy pill says WHY the player cannot hit. The engine hands the reason (`st.aim.reason`);
 *  the HUD never guesses one. Smoke is the only reason built; S55 adds recoil, flinch and stance rows here. */
export const AIM_REASON = {
  smoke: { word: 'SMOKED', sub: 'YOUR SHOTS WILL MISS' },
  recoil: { word: 'RECOIL', sub: 'RELEASE TO STEADY' },
};
/** F368 (review r2): every warning's words, ONE source for the rail's pill (`full`, `short` while a kill card is up,
 *  `down` on the death screen) and the ⓘ panel's WARNINGS (always `full`). */
export const WARN = {
  mc_live: { full: 'OUT OF MISSION CONTROL RANGE — SCORES SYNC WHEN YOU ARE BACK', short: 'MC OUT OF RANGE', down: 'MC OUT OF RANGE' },
  mc_pre: { full: 'RECONNECTING TO MISSION CONTROL…', short: 'MC OUT OF RANGE', down: 'MC OUT OF RANGE' },
  headset_not_joined: { full: 'HEADSET NOT JOINED · POWER-CYCLE THE HEADSET', short: 'HEADSET NOT JOINED', down: 'HEADSET NOT JOINED' },
  headset_joining: { full: 'HEADSET JOINING', short: 'HEADSET JOINING', down: 'HEADSET JOINING' },
  flap_quiet: { full: 'GUN KEEPS DROPPING. POWER-CYCLE THE HEADSET, THEN THE GUN RECONNECTS.', short: 'GUN KEEPS DROPPING', down: 'POWER-CYCLE THE HEADSET' },
  flap: { full: 'HEADSET OFF? TURN THE HEADSET ON.', short: 'HEADSET OFF?', down: 'HEADSET OFF? TURN IT ON' },
  gun_lost: { full: 'GUN LINK LOST — TAP TO RECONNECT', short: 'GUN LINK LOST · TAP', down: 'GUN LINK LOST — TAP TO RECONNECT' },
  no_answer: { head: 'GUN NOT ANSWERING', sub: 'HOST: FORCE RESPAWN OR RELINK' },
  no_fire: { head: 'GUN NOT REPORTING SHOTS', sub: 'PULL TRIGGER AGAIN · THEN TELL HOST' },
  spawn_lost: { head: 'GUN MAY NOT BE SPAWNED', sub: 'HOST: FORCE RESPAWN' },   // F416: a lost spawn write the node could not check. RESYNC GUN never writes `$SPAWN`; FORCE RESPAWN does
};
/** The digit beside the gauge: a round count for a bullet weapon or a low-cost energy weapon (the Rail
 *  Gun), a percentage of the cell for a weapon whose full charge costs more than one round (F248, see
 *  usesCellGauge above). */
export const magText = st => usesCellGauge(st)
  // Bench 2026-09-18 (Tony): the per-cent sign is noise in a fight -- the number alone reads faster and
  // the bar beside it already says it is a proportion, not a round count.
  ? `${Math.max(0, Math.min(100, Math.round(100 * st.ammo / (st.mag || Math.max(st.ammo, 1)))))}`
  : pad2(st.ammo);
// Polish-loop pass 1 (2026-09-12): the discovered-MC row shows the HOST, never the raw ws://…/ws join URL.
const mcHost = url => { try { return new URL(url).host; } catch (_) { return String(url || ''); } };
// Polish-loop pass 2: `d.source` (app.js, landed) is 'sweep' (a port sweep on the joined Wi-Fi) or 'mdns'
// (a broadcast advert) — worded so a player can tell which kind of "found" this is; the action is the same.
// A60: `d.text` (app.js, autojoin.js `offerText`) says why this address needs a tap: a new MC, several
// found, or one that could not prove it is ours. It is shown verbatim (it names its own tap); no text =
// the plain found row.
export const discoveredRow = d => { if (!d) return '';
  const label = d.source === 'mdns' ? 'FOUND BY BROADCAST' : 'FOUND ON THE NETWORK';
  const text = d.text ? esc(d.text) : `MISSION CONTROL ${label} AT ${esc(mcHost(d.url))} · JOIN`;
  // HUD QA R2-06: only an UNVERIFIED host (autojoin.js reason 'unproven': it failed or lacked the proof) is a warning:
  // amber, with a drawn warning glyph (a font may lack U+26A0). NEW (a first contact) and SEVERAL (a choice) are not.
  const warn = d.reason === 'unproven';
  const glyph = warn ? '<svg class="dwarn" viewBox="0 0 16 14" aria-hidden="true"><path d="M8 1 15 13H1Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 5.2v3.6M8 10.4v1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' : '';
  return `<div class="discoveredrow${warn ? ' warn' : ''}" data-act="onJoinDiscovered" data-reason="${esc(d.reason || 'found')}">${glyph}<span class="unskew">${text}</span></div>`; };
// QA-08 (2026-09-23): MC's refusal (`roster_full (4003)`) in words: `roster full`. The close code stays in the diag log.
export const refusalWords = r => r ? String(r).replace(/\s*\(\d+\)\s*$/, '').replace(/_/g, ' ').toLowerCase() : '';
// QA-13: the old placeholder (ws://mission-control-ip:8766/ws) was cut off in the pre-join field.
export const MC_URL_HINT = 'ws://HOST-IP:8766/ws';
// A10: human labels for catalog rows (never the raw $WEAP class id — design review round 3)
const ROLE_NAME = ROLE_LABELS;
export const roleName = w => ROLE_NAME[w.role] || (w.tags && w.tags[0] ? String(w.tags[0]).toUpperCase() : 'WEAPON');
const PERK_GLYPH = {
  body_armor: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 4 L34 9 V20 C34 29 28 34 20 37 C12 34 6 29 6 20 V9 Z"/><path d="M20 12 V29 M13 20 H27" opacity=".7"/></svg>',
  extended_mags: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 4 H28 L30 36 H10 Z"/><path d="M15 11 H25 M15 17 H25 M15 23 H25 M15 29 H25" opacity=".7"/></svg>',
  quick_hands: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="20" cy="23" r="13"/><path d="M20 15 V24 L26 27 M16 4 H24 M20 4 V9" /></svg>',
  easy_reload: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M31 15 A13 13 0 1 0 33 24"/><path d="M31 6 V15 H22"/></svg>',
};
// A26: the rack row's "read this one" control. Drawn, not typed: U+24D8 (ⓘ) is not in the HUD's font stack
// and rendered as a tofu box on the stage.
export const INFO_SVG = '<svg class="infog" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10" cy="10" r="7.6"/><path d="M10 8.8v5.4" stroke-linecap="round"/><circle cx="10" cy="6.1" r="1" fill="currentColor" stroke="none"/></svg>';
export const perkGlyph = id => PERK_GLYPH[id] || '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 4 L24 15 L36 16 L27 24 L30 36 L20 30 L10 36 L13 24 L4 16 L16 15 Z"/></svg>';
/** A background-image has no onerror hook, so a missing weapon photo used to show the empty
 *  `#0a1626` box with nothing on screen saying why (stripper/smoke_gun have none yet, and it read as
 *  a UI bug, not a missing asset — field 2026-09-18). An <img> DOES fire onerror: swap it for a
 *  generic weapon glyph, the same precedent as `perkGlyph`'s unmatched-id fallback above. Every
 *  weapon-art call site shares this one function, so the fix (and any future one) lands once. */
const WEAPON_GLYPH = '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="20" cy="20" r="13"/><path d="M20 3 V11 M20 29 V37 M3 20 H11 M29 20 H37"/><circle cx="20" cy="20" r="2.6" fill="currentColor" stroke="none"/></svg>';
export const weaponArt = id => `<img class="wpic" src="assets/weapons/${esc(id)}.jpg" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="wpicfb">${WEAPON_GLYPH}</span>`;


// Field 2026-08-30: the old DMG/ROF meters read `stats.dmg` straight, but that number is "share of a
// 115 pool per hit" -- 7 to 11 for most guns -- so every bar sat near empty and no two weapons looked
// different. MC now ranks each stat ACROSS the arsenal and ships it as `bars`, with the real figures
// alongside. Range is gone: t41 is identical on all 18 guns, so a range meter measured nothing.
export function statBlock(r, opts = {}) {
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
    (opts.compact ? '' : `${bar('RESERVE', b.ammo)}${bar('KILL SPEED', b.ttk)}`) +
    (facts ? `<div class="facts">${facts}</div>` : '');
}

// The skin switch draws its own icons: a text ☀ fell back to a different glyph in the phone's font.
