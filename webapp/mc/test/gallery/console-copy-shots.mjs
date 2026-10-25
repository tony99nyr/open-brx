// F599 console copy renders at 1280x720 from the real console against `?mock`.
// Injected faults come from `&gallery=copy:<tokens>` (src/mock/copyGallery.ts).
//   node test/gallery/console-copy-shots.mjs <outDir> <baseUrl>
import { chromium } from 'playwright';
import fs from 'node:fs';
const out = process.argv[2];
const base = process.argv[3];
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const log = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

// Drivers: how a frame gets from a fresh `?mock` to the state it shows.
const toArmed = async p => {
  await p.goto(p.__url('lobby')); await p.waitForTimeout(700);
  await p.getByRole('button', { name: /PUSH CONFIG/ }).click(); await p.waitForTimeout(2200);
  await p.getByRole('button', { name: /ARM COUNTDOWN/ }).click(); await p.waitForTimeout(1200);
};
const toLive = async p => { await toArmed(p); await p.waitForSelector('[data-testid="phase-chip"]:has-text("LIVE")', { timeout: 45000 }); await p.waitForTimeout(800); };
const scrollTo = sel => async p => { try { await p.locator(sel).first().scrollIntoViewIfNeeded({ timeout: 2500 }); await p.evaluate(s => document.querySelector(s)?.scrollIntoView({ block: 'center' }), sel); } catch { /* The element is absent in this frame. */ } await p.waitForTimeout(250); };
const scrollBy = y => async p => { await p.evaluate(v => { const e = document.scrollingElement; e.scrollTop += v; document.querySelector('.screen')?.scrollBy?.(0, v); }, y); await p.waitForTimeout(250); };
const click = (sel, wait = 300) => async p => { await p.locator(sel).first().click(); await p.waitForTimeout(wait); };

// id, view hash, mock flags, injected faults, prepare steps (run after load, before the shot), `open` steps (the tap that opens a "Why?")
export const FRAMES = [
  { id: 'armory-banners', hash: 'muster', tokens: 'restorefail,corrupt,restored', mock: '', prep: [], open: [click('[data-testid="restore-failed-banner"] button'), click('[data-testid="armory-corrupt-banner"] button')],
    cap: 'ARMORY, three banners: session not restored (red), armory file corrupt (red), session restored (amber). The detail opens on tap.' },
  { id: 'armory-outbox', hash: 'muster', tokens: 'outbox', mock: '&stalephone=1', prep: [scrollTo('[data-node-card]')], open: [],
    cap: 'ARMORY, an unclaimed phone card that lost facts from its outbox. The chip sits on the card.' },
  { id: 'server-failures', hash: 'kit', tokens: 'notsaving,ticker,joinerr', mock: '', prep: [], open: [click('[data-testid="not-saving-store"] button')],
    cap: 'Every screen (here KIT): not saving, match clock failing, join QR stale. Three lines of capitals become three short pills in one row.' },
  { id: 'frame-offline-token', hash: 'muster', tokens: 'offline,token,tunnel', mock: '', prep: [], open: [click('[data-alert="frame-tunnel-down"] button')],
    cap: 'Frame: MC offline, token refused (tap to paste a token), internet tunnel down. The tunnel detail is open.' },
  { id: 'join-panel', hash: 'muster', tokens: 'lanwarn,older', mock: '', prep: [scrollTo('[data-testid="join-hint"]')], open: [click('[data-alert="armory-joinpanel-lanwarn"]'), click('[data-alert="armory-reach-predates-backhaul"]')],
    cap: 'ARMORY join panel: phones cannot find MC (Wi-Fi), and MC older than the console. Both are chips on the panel they concern.' },
  { id: 'join-no-lan', hash: 'muster', tokens: 'nolan', mock: '', prep: [click('text=/SHOW QR CODES/'), scrollTo('[data-alert="armory-joinpanel-no-lan-address"]')], open: [],
    cap: 'ARMORY join panel with no LAN address (QR opened).' },
  { id: 'games-hill', hash: 'build', tokens: 'nohill', mock: '', prep: [], open: [click('[data-testid="help-info"] button')],
    cap: 'PLAY: King of the Hill with no hill. The chip and ASSIGN A HILL button stay together. Mode notes open from INFO.' },
  { id: 'games-respawn', hash: 'build', tokens: 'respawn', mock: '', prep: [scrollTo('[data-testid="games-setup-line"]')], open: [click('[data-testid="games-setup-line"]')],
    cap: 'PLAY (GAMES): respawn is set to a station and none is assigned. The chip names the problem, the button stays.' },
  { id: 'kit-locked', hash: 'kit', tokens: '', mock: '', drive: toArmed, prep: [async p => { await p.evaluate(() => { location.hash = '#kit'; }); await p.waitForTimeout(900); }, scrollBy(580)], open: [],
    cap: 'KIT while a match is armed: the kit is locked. One chip replaces the line of capitals.' },
  { id: 'kit-continue', hash: 'kit', tokens: '', mock: '', prep: [click('[data-continue="kit"] button:has-text("CONTINUE")', 500)], open: [],
    cap: 'KIT, CONTINUE tapped with players still kitting: the confirm names up to three players, then shows a count.' },
  { id: 'items-departed', hash: 'muster', tokens: 'departed', mock: '&stationlock=1', prep: [scrollTo('[data-testid="items-panel"]')], open: [],
    cap: 'ITEMS: the hill station left (above the cards) and a powerup station that returned (on its card). Chips name the station, not the sentence.' },
  { id: 'live', hash: 'live', tokens: '', mock: '', drive: toLive, prep: [scrollBy(300)], open: [click('[data-testid="help-info"] button')],
    cap: 'MATCH (LIVE) with its help notes.' },
  { id: 'armed', hash: 'lobby', tokens: '', mock: '', drive: toArmed, prep: [], open: [click('[data-testid="help-info"] button')],
    cap: 'ARMED with its help notes. Only the abort fact stays, behind an INFO button.' },
  { id: 'items-notes', hash: 'muster', tokens: '', mock: '&stationlock=1', prep: [scrollTo('[data-testid="items-panel"]')], open: [],
    cap: 'ITEMS station cards: the dim explainers under the controls.' },
  { id: 'kit-notes', hash: 'kit', tokens: '', mock: '', prep: [scrollBy(480)], open: [],
    cap: 'KIT slot cards: "player picks, you can override" and the other dim explainers.' },
  { id: 'backhaul', hash: 'muster', tokens: 'auto', mock: '', prep: [scrollTo('[data-testid="backhaul-status"]')], open: [],
    cap: 'Backhaul auto-start: a globe and a short label in the command bar and beside the join panel.' },
  { id: 'backhaul-error', hash: 'muster', tokens: 'autoerr', mock: '', prep: [scrollTo('[data-testid="backhaul-status"]')], open: [click('[data-testid="backhaul-status"] button')],
    cap: 'Backhaul auto-start with an error: the label turns red and the error opens on tap.' },
];

const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
for (const f of FRAMES) {
  if (ONLY && !ONLY.includes(f.id)) continue;
  for (const side of ['current']) {
    const p = await ctx.newPage();
    p.on('pageerror', e => log.push(`PAGEERROR ${f.id}/${side}: ${e}`));
    p.__url = h => `${base}/?mock&norandom=1&allgreen=1${f.mock}&gallery=copy:${f.tokens}#${h}`;
    if (f.drive) await f.drive(p); else await p.goto(p.__url(f.hash));
    await p.waitForTimeout(900);
    for (const step of f.prep) await step(p);
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/${f.id}-${side}.png` });
    if (f.open.length) {   // the same page after the taps that open each "Why?" / chip
      for (const step of f.open) { try { await step(p); } catch (e) { log.push(`OPEN-MISS ${f.id}: ${String(e).split('\n')[0]}`); } }
      await p.waitForTimeout(300);
      await p.screenshot({ path: `${out}/${f.id}-open.png` });
    }
    // text under 11 px, counted among visible elements that carry their own text
    const small = await p.evaluate(() => [...document.querySelectorAll('body *')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
      && parseFloat(getComputedStyle(e).fontSize) < 11 && e.getBoundingClientRect().width > 0).length);
    log.push(`${f.id}/${side}: text<11px elements ${small}`);
    await p.close();
  }
}
fs.writeFileSync(`${out}/captions.json`, JSON.stringify(FRAMES.map(({ id, cap }) => ({ id, cap })), null, 1));
await browser.close();
console.log(log.join('\n'));
if (log.some(l => l.startsWith('PAGEERROR'))) process.exit(1);
