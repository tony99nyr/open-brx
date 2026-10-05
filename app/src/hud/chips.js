// Chips rendering for the phone HUD.
import { esc, WARN, refusalWords } from './shared.js';
const warnFull = w => w.full || `${w.head} · ${w.sub}`;

export function _chips(st) {
    const pills = [];
    // S52: this is an accessibility control, not a perk, so keep the instruction
    // visible wherever the player can forget what ALT does. The picker warning
    // handles the conflicting second-weapon choice; this handles actual play.
    // The death screen owns the middle of the frame: while DOWN the pills move to the band above THE GAME NOW
    // (`#frame[data-down]`, set beside `data-takeover`), ALT = RELOAD is moot, and the pills say it in a few words.
    const down = st.phase === 'live' && !st.alive;
    if (!down && st.phase !== 'idle' && st.loadout && st.loadout.overrides && st.loadout.overrides.easy_reload) {
      pills.push('<span class="pill ok easyreload"><span class="unskew">ALT = RELOAD</span></span>');
    }
    if (st.wsState === 'bound') this.mcPill = false;   // the opt-in range pill is per outage, not forever
    const full = [];   // review M3/r2: every warning's full sentence, for the ⓘ panel, from the same branch as its pill
    const say = (w, cls, attrs = '') => { full.push(warnFull(w)); return `<span class="${cls}"${attrs}><span class="unskew" data-short="${w.short}">${down ? w.down : w.full}</span></span>`; };
    if (st.wsState === 'rejected') { const t = `ASK THE HOST — COULDN'T JOIN${refusalWords(st.wsReason) ? ' (' + esc(refusalWords(st.wsReason)).toUpperCase() + ')' : ''}`; full.push(t); pills.push(`<span class="pill bad"><span class="unskew" data-short="ASK THE HOST">${t}</span></span>`); }
    // Playing out of MC range is the NORMAL case mid-match (Tony, review 2026-09-03 #32): live shows it as the amber MC
    // dot only; a tap on the MC label shows the detail pill. Before the match (kitted/lobby) MC is required, so the pill stays.
    // (night hides the header dots, so there the dim pill is the only off-range signal)
    // While DOWN one off the cap, the recap's own A31 line already says MC is out of range: no second pill for it.
    else if (st.phase !== 'idle' && st.phase !== 'connected' && st.wsState !== 'bound') {
      const w = st.phase === 'live' ? WARN.mc_live : WARN.mc_pre;
      if (!(down && this._atCapMinusOne(st)) && (st.phase !== 'live' || this.mcPill || st.night)) pills.push(say(w, 'pill warn mcr'));
      else full.push(warnFull(w));   // live: the amber dot only, but the panel still names it
    }
    // A tappable pill, not just a status: the retry now runs forever, but a player who has just
    // switched the gun on should not have to wait out a backoff — or go hunting in the debug panel,
    // which is where the only reconnect control used to live (Tony, field 2026-09-01).
    // Bench 2026-09-17: a gun with its headset off accepts the link and drops it within seconds, over and
    // over. The GUN LINK LOST pill then blinked on and off with every cycle. While the phone counts 2+
    // quick drops in a row, one steady line says the likely cause, whether the link is up this second or not.
    // Game day 2026-09-19: after 3 flaps in a row the phone stops reconnecting for 30 s (BrxLink's quiet
    // period). The line says what fixes it; RECONNECT NOW ends the quiet period at once. It shows in every phase.
    // F293 (bench 2026-09-24): the phone reads the headset state from `$VERSION` on every connect. While it reads `?`
    // the headset is still joining the gun and the phone waits; after 60 s it stops and waits for RECONNECT NOW. Both
    // lines show in every phase, in place of the flap lines and GUN LINK LOST (the link is down on purpose).
    const hj = st.headsetJoin && st.headsetJoin.state;
    if (hj === 'not_joined') pills.push(say(WARN.headset_not_joined, 'pill bad', ' data-headset="not_joined"') + `<button class="pill warn" data-act="onReconnectNow"><span class="unskew">RECONNECT NOW</span></button>`);
    else if (hj === 'joining' && !st.bleUp) { pills.push(say(WARN.headset_joining, 'pill warn', ' data-headset="joining"') + `<button class="pill warn" data-act="onReconnectNow"><span class="unskew">RECONNECT NOW</span></button>`); }
    else if (st.gunFlapping && st.gunFlapping.quiet) pills.push(say(WARN.flap_quiet, 'pill bad', ` data-flap="${st.gunFlapping.count}" data-quiet="1"`) + `<button class="pill warn" data-act="onReconnectNow"><span class="unskew">RECONNECT NOW</span></button>`);
    else if (st.phase !== 'idle' && st.gunFlapping) pills.push(say(WARN.flap, 'pill warn', ` data-flap="${st.gunFlapping.count}"`) + `<button class="pill warn" data-act="onReconnectNow"><span class="unskew">RECONNECT NOW</span></button>`);
    // QA-02: on the live HUD this is a solid, steady bar (16 px, no blink): the frozen numbers below depend on it.
    else if (st.phase !== 'idle' && !st.bleUp) { full.push(warnFull(WARN.gun_lost)); pills.push(`<button class="pill bad${st.phase === 'live' && !down ? ' gunlost' : ''}" data-act="onReconnectGun"><span class="unskew" data-short="${WARN.gun_lost.short}">${WARN.gun_lost.full}</span></button>`); }
    if (st.moment && st.moment.kind === 'go' && st.phase === 'live' && st.bleUp) pills.push(`<span class="pill ok"><span class="unskew">WEAPONS HOT</span></span>`);   // never 'hot' while the gun link is down
    const prompt = st.resync ? `<div class="prompt"><span class="unskew"><span class="pl">GUN RELINKED</span><span class="pi">${esc(st.resync.prompt).toUpperCase()}</span></span></div>` : '';
    // S57 / QA-05: the IR callouts and the hill transitions are never a pill here: they are lanes (`_lanes`).
    // review r2 M2: two or more warnings in the rail show headlines only (the full sentences stay in the ⓘ panel)
    const many = (pills.join('').match(/data-short=/g) || []).length >= 2;
    const html = `<div class="chipbar${many ? ' many' : ''}">${pills.join('')}</div>${prompt}`;
    if (this.chips.innerHTML !== html) this.chips.innerHTML = html;
    // F368 (docs/announcer.md "Layering and priority on the phone HUD"): on the live HUD the pills are the status rail at
    // the bottom centre. While a kill card is up each shows its short headline (`data-short`, drawn by CSS); the ⓘ
    // panel's WARNINGS section always has every warning's full sentence.
    if (typeof this._gunHealthActive === 'function' && this._gunHealthActive(st)) {
      if (st.spawnLost) full.push(warnFull(WARN.spawn_lost));
      else if (st.cure && st.cure.verdict === 'no_answer') full.push(warnFull(WARN.no_answer));
      else if (st.poolStale && st.poolStale.why === 'no_fire') full.push(warnFull(WARN.no_fire));
    }
    const warn = full.length ? full.map(t => `<span>${esc(t)}</span>`).join('') : '<span class="mut">NONE</span>';
    if (this._warnHtml !== warn) { this._warnHtml = warn; const w = this.diag && this.diag.querySelector('#dg-warn'); if (w) w.innerHTML = warn; }
  }

export const methods = { _chips };
