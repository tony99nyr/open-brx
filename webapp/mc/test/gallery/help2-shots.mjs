// F599 phase 2 copy gallery. Usage: node test/gallery/help2-shots.mjs <outDir> <baseUrl>
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = process.argv[5]
  ? require(process.argv[5])
  : await import('playwright');

const out = process.argv[2], base = process.argv[3];
if (!out || !base) throw new Error('Usage: node test/gallery/help2-shots.mjs <outDir> <baseUrl>');
const notes = JSON.parse(fs.readFileSync(new URL('./help2-notes.json', import.meta.url), 'utf8'));
fs.mkdirSync(out, { recursive: true });
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const mockUrl = (p, extra = '', hash = 'muster') => `${base}/?mock&norandom=1${extra || p.__extra || ''}#${hash}`;
const excerpt = text => text.split('/')[0].replace(/\{[^}]*\}/g, '').replace(/[^a-z0-9 ]/gi, ' ').trim().slice(0, 26).trim();
const normalise = text => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const contains = (body, text) => !text || normalise(body).includes(normalise(text));
const click = async (p, sel, name) => {
  const target = name ? p.locator(sel).filter({ hasText: name }).first() : p.locator(sel).first();
  await target.waitFor({ state: 'visible', timeout: 7000 });
  await target.click({ timeout: 7000 });
};
const go = (p, url) => p.goto(url, { timeout: 15000, waitUntil: 'domcontentloaded' });
const scroll = async (p, selector) => { await p.locator(selector).first().scrollIntoViewIfNeeded({ timeout: 7000 }); };
const capture = async (p, file) => {
  await p.evaluate(() => Promise.all(document.getAnimations()
    .filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime))
    .map(a => a.finished.catch(() => {}))));
  const session = await p.context().newCDPSession(p);
  try {
    const { data } = await session.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
  } finally { await session.detach(); }
};
const armed = async p => {
  await go(p, mockUrl(p, '', 'lobby'));
  await click(p, 'button', 'Push anyway, over 1 missing phone');
  await click(p, 'button', 'Arm anyway');
  await p.waitForSelector('[data-testid="phase-chip"]:has-text("ARMED")', { timeout: 20000 });
};
const live = async p => {
  await armed(p);
  await p.waitForSelector('[data-testid="phase-chip"]:has-text("LIVE")', { timeout: 45000 });
  await click(p, 'header nav button', 'MATCH');
};
const nav = async (p, label) => {
  const hash = { MATCH: 'live', LOBBY: 'lobby', PLAY: 'build', KIT: 'kit', ARMORY: 'muster' }[label];
  if (!hash) throw new Error(`Unknown gallery view: ${label}`);
  await go(p, mockUrl(p, '', hash));
  await p.waitForSelector('header nav button', { timeout: 15000 });
};

// Each entry drives into the exact panel and asserts its anchor. A null entry means the mock has no
// way to produce this conditional state without changing product code; it is listed in skipped.json.
const drivers = {
  'LIVE': { run: async p => { await nav(p, 'MATCH'); }, anchor: 'body' },
  'LIVE feed': { run: async p => { await live(p); }, anchor: 'body', infoTestid: 'help2-live-feed-info', unavailable: 'The default mock feed has no first-sync, withheld or after-whistle note event.' },
  'LIVE hill': { run: async p => { p.__extra = '&gallery=copy:nohill'; await live(p); await scroll(p, '[data-testid="hill-panel"]'); }, anchor: '[data-testid="hill-panel"]', infoTestid: 'help2-live-hill-info', unavailable: 'The mock arming flow does not reach a KOTH live board with no possession.' },
  'ARMED': { run: async p => { await nav(p, 'LOBBY'); await p.waitForSelector('[data-testid="armory-gate"]', { timeout: 10000 }); }, anchor: 'body', unavailable: 'The no-schedule state clears when the mock receives its initial schedule.' },
  'KIT slot cards': { run: async p => { await nav(p, 'KIT'); await p.getByText('#3 NOMAD', { exact: false }).first().click(); }, anchor: 'body' },
  'KIT weapon cards': { run: async p => { await nav(p, 'KIT'); await p.getByText('#2 VIPER', { exact: false }).first().click(); await p.getByText('SHOTGUN', { exact: true }).first().click(); await p.getByText('TIME TO KILL', { exact: false }).last().evaluate(el => el.scrollIntoView({ block: 'center' })); }, anchor: 'body' },
  'KIT perk cards': { run: async p => { await nav(p, 'KIT'); await p.getByText('#3 NOMAD', { exact: false }).first().click(); await p.getByText('BODY ARMOR', { exact: true }).first().click(); await p.getByText('Start every life with 25 extra armor', { exact: false }).first().evaluate(el => el.scrollIntoView({ block: 'center' })); }, anchor: 'body' },
  'KIT focused slot': { run: async p => { await nav(p, 'KIT'); await p.getByText('#2 VIPER', { exact: false }).first().click(); await p.getByText('NO PERK', { exact: true }).first().click(); }, anchor: 'body' },
  'ITEMS picker': { run: async p => { p.__extra = '&powerups=off'; await nav(p, 'ARMORY'); await scroll(p, '[data-testid="items-panel"]'); await p.getByText('POWERUP', { exact: true }).first().click(); }, anchor: '[data-testid="items-panel"]', infoTestid: 'help2-items-picker-info' },
  'ITEMS hill setup': { run: async p => { p.__extra = '&gallery=copy:nohill'; await nav(p, 'PLAY'); await p.evaluate(() => { window.__MC_MOCK__.stations = {}; window.__MC_MOCK__.emit(); }); await click(p, '[data-testid="assign-a-hill"] button'); await p.waitForSelector('[data-testid="items-hill-focus"]', { timeout: 12000 }); }, anchor: '[data-testid="items-hill-focus"]', infoTestid: 'help2-items-hill-info' },
  'ITEMS section header': { run: async p => { await nav(p, 'ARMORY'); await scroll(p, '[data-testid="items-panel"]'); }, anchor: '[data-testid="items-panel"]' },
  'BUILD': { run: async p => { await nav(p, 'PLAY'); await click(p, 'button', 'BUILD ▸'); }, anchor: 'body' },
  'BUILD spawn editor': { run: async p => { await nav(p, 'PLAY'); await click(p, 'button', 'BUILD ▸'); await click(p, '[data-testid="build-tab-spawn"]'); await click(p, 'button', 'NEW ▸'); }, anchor: 'body', infoTestid: 'help2-spawn-info' },
  'BUILD slot editor': { run: async p => { await nav(p, 'PLAY'); await click(p, 'button', 'BUILD ▸'); await click(p, '[data-testid="build-tab-primary"]'); await click(p, 'button', 'NEW ▸'); }, anchor: '[data-testid="slot-only-row"]', infoTestid: 'help2-only-these-info' },
  'BUILD loadout editor': { run: async p => { await nav(p, 'PLAY'); await click(p, 'button', 'BUILD ▸'); await click(p, '[data-testid="build-tab-misc_loadouts"]'); await click(p, 'button', 'NEW ▸'); }, anchor: 'body', infoTestid: 'help2-loadout-info' },
  'CATALOGUE': { run: async p => { await go(p, mockUrl(p)); await click(p, 'button[aria-label="Menu"]'); await click(p, 'button', 'Arsenal'); }, anchor: 'body', infoTestid: 'help2-catalogue-info' },
  'LOBBY': { run: async p => { await nav(p, 'LOBBY'); await p.evaluate(async () => { await window.__MC_MOCK__.setPhase('build', true); location.hash = 'lobby'; }); await p.waitForSelector('[data-mark-all-ready-reason]'); }, anchor: 'body' },
  'Operator menu': { run: async p => { await armed(p); await click(p, 'header nav button', 'MATCH'); await click(p, 'button[data-live-row-toggle]'); }, anchor: '[data-operator-menu]', infoTestid: 'help2-operator-info' },
  'Spectate': { run: async p => { await go(p, mockUrl(p, '', 'spectate')); await p.waitForSelector('[data-spectate]', { timeout: 12000 }); await p.evaluate(() => { window.location.hash = 'kit'; }); await p.waitForSelector('[data-spectate="escape"]', { timeout: 7000 }); }, anchor: '[data-spectate="escape"]' },
  'Report panel': { run: async p => { await go(p, mockUrl(p)); await click(p, 'button[aria-label="Menu"]'); await click(p, 'button', 'Report a problem'); }, anchor: '[data-testid="report-panel"]', infoTestid: 'help2-report-info' },
  'ARMORY log sync': { run: p => nav(p, 'ARMORY'), anchor: 'body', infoTestid: 'help2-log-sync-info' },
  'ARMORY phone section': { run: p => nav(p, 'ARMORY'), anchor: 'body' },
  'ARMORY known guns': { run: p => nav(p, 'ARMORY'), anchor: 'body' },
  'ARMORY unclaimed guns': { run: p => nav(p, 'ARMORY'), anchor: 'body' },
  'Game editor': { run: async p => { await nav(p, 'LOBBY'); await click(p, '[data-testid="game-edit-toggle"]'); }, anchor: '[data-testid="game-edit-panel"]', infoTestid: 'help2-game-settings-info' },
  'Game editor volume': { run: async p => { await nav(p, 'LOBBY'); await click(p, '[data-testid="game-edit-toggle"]'); }, anchor: '[data-testid="game-edit-volume"]' },
  'Debug token prompt': { run: async p => { await go(p, mockUrl(p, '&gallery=copy:token')); await click(p, 'button[aria-label="Menu"]'); await click(p, 'button', 'Debug'); }, anchor: '[data-alert="frame-token-required-app"]' },
  'Report panel privacy': { run: async p => { await go(p, mockUrl(p)); await click(p, 'button[aria-label="Menu"]'); await click(p, 'button', 'Report a problem'); }, anchor: '[data-testid="report-panel"]', infoTestid: 'help2-report-info' },
  'Frame connecting': { run: p => go(p, mockUrl(p, '', 'lobby')), anchor: '[data-alert="frame-connecting"]', unavailable: 'The mock connects immediately, before the connecting message can render.' },
  'Frame token prompt': { run: p => go(p, mockUrl(p, '&gallery=copy:token', 'lobby')), anchor: '[data-alert="frame-token-required-app"]', unavailable: 'The mock keeps a state snapshot while it asks for the token, so the empty-state prompt does not appear.' },
  'Command bar LAN warning': { run: async p => { await go(p, mockUrl(p, '&gallery=copy:lanwarn', 'lobby')); await click(p, '[data-testid="lan-warning"] button', 'HOW TO FIX ▾'); }, anchor: '[data-testid="lan-warning"]' },
  'Command bar bench volume': { run: p => go(p, mockUrl(p, '', 'lobby')), anchor: '[data-testid="bench-volume"]', unavailable: 'The mock does not expose a bench-volume launch flag.' },
  'LOBBY operator note': { run: p => nav(p, 'LOBBY'), anchor: 'body' },
};

const allGroups = [...new Map(notes.map(n => [n.screen, n.screen])).values()];
const groups = process.argv[6] ? allGroups.slice(allGroups.indexOf(process.argv[6])) : allGroups;
if (process.argv[6] && !allGroups.includes(process.argv[6])) throw new Error(`Unknown start screen: ${process.argv[6]}`);
if (!process.argv[6]) for (const screen of allGroups) for (const side of ['current', 'open']) {
  const file = path.join(out, `${slug(screen)}-${side}.png`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
const browser = process.argv[4]
  ? await chromium.connectOverCDP(process.argv[4])
  : await chromium.launch();
const ctx = process.argv[4]
  ? browser.contexts()[0]
  : await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const manifest = [], skipped = [];
for (const screen of groups) {
  const id = slug(screen), groupNotes = notes.filter(n => n.screen === screen), driver = drivers[screen];
  if (!driver) { skipped.push({ screen, reason: 'No verified state driver.' }); continue; }
  if (driver.unavailable) { skipped.push({ screen, notes: groupNotes.map(n => n.id), reason: driver.unavailable }); continue; }
  console.log(`Capturing ${screen}`);
  const page = await ctx.newPage(), errors = [];
  await page.setViewportSize({ width: 1280, height: 720 });
  page.setDefaultTimeout(7000);
  page.setDefaultNavigationTimeout(15000);
  page.on('pageerror', e => errors.push(String(e)));
  try {
    await driver.run(page);
    const anchor = page.locator(driver.anchor).first();
    await anchor.waitFor({ state: 'visible', timeout: 10000 });
    await anchor.evaluate(el => el.scrollIntoView({ block: 'start', inline: 'nearest' }));
    await capture(page, path.join(out, `${id}-current.png`));
    const body = await page.locator('body').innerText();
    for (const n of groupNotes) {
      if (n.proposal === 'CUT' && !n.current.startsWith('{') && contains(body, excerpt(n.current))) {
        throw new Error(`${n.id}: cut wording remains visible`);
      }
      if (n.proposal === 'INLINE' && !n.current.startsWith('{') && contains(body, excerpt(n.current)) && !contains(body, n.wording)) {
        throw new Error(`${n.id}: old inline wording remains visible`);
      }
    }
    const infos = groupNotes.filter(n => n.proposal === 'INFO');
    let opened = false;
    for (const n of infos) {
      const testid = n.infoTestid ?? driver.infoTestid;
      if (!testid) throw new Error(`${n.id}: INFO target test id is not configured`);
      const target = page.locator(`[data-testid="${testid}"]`);
      if (!(await target.count())) {
        skipped.push({ screen, notes: [n.id], reason: 'The conditional INFO state is absent from the default mock.' });
        continue;
      }
      await target.waitFor({ state: 'visible', timeout: 7000 });
      if (await target.getAttribute('aria-expanded') !== 'false') throw new Error(`${n.id}: INFO starts open`);
      await target.click({ timeout: 7000 });
      if (await target.getAttribute('aria-expanded') !== 'true') throw new Error(`${n.id}: INFO did not open`);
      const detail = await target.locator('xpath=..').innerText({ timeout: 5000 });
      if (!contains(detail, n.wording)) throw new Error(`${n.id}: approved INFO wording is absent`);
      if (!opened) await capture(page, path.join(out, `${id}-open.png`));
      opened = true;
      if (n !== infos.at(-1)) await target.click({ timeout: 7000 });
    }
    if (errors.length) throw new Error(`pageerror: ${errors.join('; ')}`);
    manifest.push({ id, screen, notes: groupNotes.map(n => n.id), info: infos.map(n => n.id) });
  } catch (e) {
    console.error(screen, e, errors);
    await page.close(); await ctx.close(); await browser.close();
    throw new Error(`${screen} failed: ${String(e).split('\n')[0]}`);
  }
  await page.close();
}
await ctx.close(); await browser.close();
fs.writeFileSync(path.join(out, 'help2-captions.json'), JSON.stringify(manifest, null, 2));
fs.writeFileSync(path.join(out, 'help2-skipped.json'), JSON.stringify(skipped, null, 2));
console.log(`Rendered ${manifest.length} panels; skipped ${skipped.length} note states.`);
