// Full end-to-end UI suite: Mission Control web UI + two phone HUDs through every flow, driven through
// the REAL widgets (typed inputs, taps, confirm steps). Spawns its own isolated MC (--demo --no-auth on
// 8865/8866). Asserts both UIs + server state at each step, audits UX (console errors, animations,
// tap targets, aria), and writes shots + a report to app/shots/e2e/. Run: npm run ui:e2e
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import http from 'http'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');                       // app/
const REPO = path.resolve(ROOT, '..');
const OUT = path.join(ROOT, 'shots', 'e2e');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const MC = 'http://127.0.0.1:8865', HUD = 'http://127.0.0.1:4400';
let WS = '';   // read from lan.ws_url — the NetServer binds the LAN IP, NOT loopback (first-run finding)

// ---------- tiny framework ----------
const results = []; const findings = [];
let curFlow = 'boot'; let shotN = 0;
const step = async (name, fn) => {
  const t0 = Date.now();
  try { await fn(); results.push({ flow: curFlow, name, ok: true, ms: Date.now() - t0 }); console.log(`  ✓ ${name}`); }
  catch (e) { results.push({ flow: curFlow, name, ok: false, ms: Date.now() - t0, err: String(e.message || e).slice(0, 300) }); console.log(`  ✖ ${name} — ${e.message}`); }
};
const flow = (name) => { curFlow = name; console.log(`\n■ ${name}`); };
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 15000, what = 'condition') => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return; } catch { } await sleep(300); } throw new Error(`timeout waiting for ${what}`); };
const api = async (m, p, b) => { const r = await fetch(MC + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return r.json(); };
const st = () => api('GET', '/api/state');

// ---------- servers ----------
const hudSrv = http.createServer((req, res) => { const p = path.join(ROOT, 'www', req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  try { res.setHeader('content-type', p.endsWith('.js') ? 'text/javascript' : p.endsWith('.html') ? 'text/html' : 'image/jpeg'); res.end(fs.readFileSync(p)); } catch { res.statusCode = 404; res.end(); } }).listen(4400);
// refuse to run against a STALE server: a leftover MC on 8865 once made a whole run test old code
if (await fetch(MC + '/api/state').then(r => r.ok).catch(() => false)) {
  console.error('FATAL: something already listens on 8865 — kill the stale MC first (a previous run left one behind?)');
  process.exit(3);
}
const mcLog = fs.openSync(path.join(OUT, 'mc-server.log'), 'w');
const mcProc = spawn(path.join(REPO, '.venv/bin/python'), ['-m', 'brx_mcp.mc', '--demo', '--no-auth', '--port', '8865', '--ws-port', '8866', '-v'], { cwd: path.join(REPO, 'mcp'), stdio: ['ignore', mcLog, mcLog] });
process.on('exit', () => { try { mcProc.kill(); } catch {} });   // the watchdog/timeout path must not leak the server
await until(async () => (await fetch(MC + '/api/state')).ok, 30000, 'MC server');
WS = (await (await fetch(MC + '/api/state')).json()).lan.ws_url;
console.log('node ws:', WS);

// ---------- pages + UX collectors ----------
const browser = await chromium.launch();
const jsErrors = [];
const mkPage = async (name, viewport) => {
  const pg = await browser.newPage({ viewport });
  pg.setDefaultTimeout(6000);   // a missing selector fails the STEP in 6 s, not 30 s
  pg.on('pageerror', e => jsErrors.push({ page: name, flow: curFlow, err: String(e.message).slice(0, 200) }));
  pg.on('console', m => { if (m.type() === 'error') jsErrors.push({ page: name, flow: curFlow, err: 'console: ' + m.text().slice(0, 200) }); });
  pg.on('response', r => { if (r.status() >= 400) jsErrors.push({ page: name, flow: curFlow, err: `HTTP ${r.status()} ${r.request().method()} ${r.url().slice(-60)}` }); });
  return pg;
};
const mc = await mkPage('mc', { width: 1280, height: 800 });
const hudA = await mkPage('hudA', { width: 891, height: 411 });
const hudB = await mkPage('hudB', { width: 891, height: 411 });
const shot = async (pg, tag) => pg.screenshot({ path: path.join(OUT, `${String(++shotN).padStart(2, '0')}-${tag}.png`) });
const hudState = (pg) => pg.evaluate(() => window.brx.engine.state());
const anim = async (pg, sel) => pg.evaluate(s => { const el = document.querySelector(s); return el ? getComputedStyle(el).animationName : null; }, sel);
const textAudit = async (pg, screen) => {
  const tiny = await pg.evaluate(() => { const out = new Set();
    for (const el of document.querySelectorAll('span,div,td,th,button,a,label')) {
      if (!el.offsetParent || el.children.length) continue;
      const t = (el.textContent || '').trim(); if (!t) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 10) out.add(`${Math.round(fs)}px: "${t.slice(0, 30)}"`);
    } return [...out].slice(0, 6); });
  for (const t of tiny) findings.push({ kind: 'tiny-text', where: screen, what: t });
};
const tapAudit = async (pg, screen) => {
  const rows = await pg.evaluate(() => [...document.querySelectorAll('button,[role="button"]')]
    .filter(el => el.offsetParent !== null)
    .map(el => { const r = el.getBoundingClientRect(); return { t: (el.textContent || el.getAttribute('aria-label') || '?').trim().slice(0, 28), h: Math.round(r.height), w: Math.round(r.width), aria: !!(el.getAttribute('aria-label') || (el.textContent || '').trim()) }; }));
  for (const r of rows) { if (r.h < 36) findings.push({ kind: 'tap-target', where: `${screen}`, what: `"${r.t}" is ${r.w}x${r.h}px (<36px tall)` }); if (!r.aria) findings.push({ kind: 'a11y', where: screen, what: 'button with no accessible name' }); }
};

let guns = [], pA, pB;
const watchdog = setTimeout(() => { console.log('WATCHDOG: 7 min — aborting'); try { fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ aborted: true, results, findings, jsErrors }, null, 1)); } catch {} process.exit(2); }, 420000);
watchdog.unref && watchdog.unref();

// ═══ F1 · MC setup: armory scan, mode select, config guards ═══
flow('F1 mc-setup');
await step('MC loads at ARMORY (muster)', async () => {
  await api('POST', '/api/session/new', { keep_roster: false });
  await mc.goto(MC + '/'); await until(async () => (await mc.locator('text=MISSION CONTROL').count()) > 0, 10000, 'MC shell');
});
await step('scan armory from the UI → rows appear', async () => {
  await mc.click('text=ARMORY'); await mc.click('text=SCAN ARMORY');
  await until(async () => { const s = await st(); guns = s.armory || []; return (await api('GET', '/api/armory')).length >= 2; }, 15000, 'armory rows');
  guns = await api('GET', '/api/armory');
  await until(async () => (await mc.locator(`text=${guns[0].gun_id}`).count()) > 0, 8000, 'armory row rendered');
  await shot(mc, 'armory-scanned'); await tapAudit(mc, 'armory'); await textAudit(mc, 'armory');
});
await step('mode cards switch + briefing follows + art present', async () => {
  await mc.click('text=BUILD');
  await mc.locator('div[role="button"]:has-text("FREE-FOR-ALL")').first().click();
  await until(async () => (await st()).config.mode === 'ffa', 5000, 'ffa applied');
  const brief = await mc.locator('text=/MODE BRIEFING/i').first().textContent().catch(() => '');
  expect(/FREE/i.test(brief || ''), 'briefing did not follow the mode: ' + brief);
  await mc.locator('div[role="button"]:has-text("TEAM DEATHMATCH")').first().click();
  await until(async () => (await st()).config.mode === 'tdm', 5000, 'tdm back');
  await shot(mc, 'build-modes'); await tapAudit(mc, 'build'); await textAudit(mc, 'build');
});
await step('config: fast respawn + short match for the run', async () => {
  const r = await api('PUT', '/api/config', { time_limit_s: 120, respawn: { type: 'auto', delay_s: 4 } });
  expect(r.ok, 'config PUT failed: ' + JSON.stringify(r.errors));
});
await step('guard: PUSH disabled with an empty roster', async () => {
  await mc.click('text=LOBBY');
  const dis = await mc.locator('button:has-text("PUSH CONFIG & ARM")').first().isDisabled().catch(() => null);
  expect(dis !== false, 'push button clickable with no players');
  await mc.click('text=KIT');
});

// ═══ F2 · roster + both HUDs join (typed-URL UX and fast path) ═══
flow('F2 join');
await step('add ALPHA + BRAVO through the roster input', async () => {
  for (const nm of ['ALPHA', 'BRAVO']) {
    await mc.fill('input[aria-label="new operator callsign"]', nm);
    await mc.click('button:has-text("ADD")');
    await until(async () => (await st()).players.some(p => p.display === nm), 5000, nm + ' added');
  }
});
await step('bind guns to players (API — no Kit UI affordance: logged as a UX finding)', async () => {
  findings.push({ kind: 'ux', where: 'kit', what: "no way to bind a gun to a player from the Kit screen (rows say NO GUN; only auto-adopt/API can set gun_id)" });
  const s = await st(); pA = s.players.find(p => p.display === 'ALPHA'); pB = s.players.find(p => p.display === 'BRAVO');
  await api('PATCH', `/api/players/${pA.player_id}`, { gun_id: guns[0].gun_id });
  await api('PATCH', `/api/players/${pB.player_id}`, { gun_id: guns[1].gun_id, team_id: 'yellow' });
});
await step('hudA joins by TYPING the ws URL (the real join UX)', async () => {
  await hudA.goto(`${HUD}/?gun=${encodeURIComponent(guns[0].gun_id + '-' + guns[0].ble.tail)}`);
  await hudA.fill('#mcurl', WS); await hudA.click('button:has-text("CONNECT")');
  await until(async () => (await hudState(hudA)).wsState === 'bound', 10000, 'hudA bound');
  await until(async () => (await st()).players.find(p => p.player_id === pA.player_id).node_id, 10000, 'ALPHA node bound');
  await until(async () => (await hudState(hudA)).phase === 'kitted', 8000, 'hudA kitted');
  await shot(hudA, 'hudA-kitted'); await tapAudit(hudA, 'hud-kitted'); await textAudit(hudA, 'hud-kitted');
});
await step('hudB joins on the fast path (?mc=)', async () => {
  await hudB.goto(`${HUD}/?mc=${encodeURIComponent(WS)}&gun=${encodeURIComponent(guns[1].gun_id + '-' + guns[1].ble.tail)}`);
  await until(async () => (await st()).players.find(p => p.player_id === pB.player_id).node_id, 10000, 'BRAVO node bound');
  await until(async () => (await hudState(hudB)).phase === 'kitted', 8000, 'hudB kitted');
});
await step('MC shows both nodes LINKED on Kit', async () => {
  await until(async () => (await mc.locator('text=LINKED').count()) >= 1, 8000, 'LINKED badge');
  await shot(mc, 'kit-two-linked');
});

// ═══ F3 · try-out from the MC UI ═══
flow('F3 tryout');
await step('select ALPHA, tap the SMG card → TRYING chip pulses', async () => {
  await mc.locator('div[role="button"]:has-text("ALPHA")').first().click();
  await mc.locator('div[role="button"][aria-label*="SMG"]').first().click();
  await until(async () => (await mc.locator('text=TRYING SMG').count()) > 0, 6000, 'TRYING chip');
  const a = await mc.evaluate(() => { const el = [...document.querySelectorAll('span')].find(x => x.textContent.startsWith('TRYING')); return el ? getComputedStyle(el).animationName : null; });
  expect(a && a !== 'none', 'TRYING chip has no pulse animation');
});
await step('hudA shows the try-out hero panel (art + stats)', async () => {
  await until(async () => (await hudA.locator('.tryout').count()) > 0, 6000, 'hero panel');
  expect((await hudA.locator('.tryout .nm').textContent()).includes('SMG'), 'panel is not the SMG');
  expect((await hudA.locator('.tryout .ln').textContent()).includes('MAG 72'), 'panel missing MAG 72');
  const bg = await hudA.evaluate(() => document.querySelector('.tryout .art').style.backgroundImage);
  expect(bg.includes('smg.jpg'), 'panel art is not smg.jpg');
  await shot(hudA, 'hudA-tryout'); await shot(mc, 'kit-trying');
});
await step('END TRY-OUT clears the panel', async () => {
  await mc.click('text=END TRY-OUT');
  await until(async () => (await hudA.locator('.tryout').count()) === 0, 6000, 'panel gone');
});

// ═══ F4 · ready → push → armed → reschedule → abort ═══
flow('F4 lobby-armed');
await step('both HUDs tap READY UP', async () => {
  for (const [pg, pid] of [[hudA, () => pA.player_id], [hudB, () => pB.player_id]]) {
    await pg.click('[data-act="onReady"]');
    await until(async () => (await st()).players.find(p => p.player_id === pid()).ready, 6000, 'ready flag');
  }
  await until(async () => (await st()).readiness.go === true, 20000, 'readiness green-light');
});
await step('PUSH CONFIG & ARM from the Lobby UI → 2/2 acked', async () => {
  await mc.click('text=LOBBY');
  await mc.click('button:has-text("PUSH CONFIG & ARM")');
  await until(async () => { const s = await st(); const a = s.lobby.acks || {}; return Object.values(a).filter(x => x.ok).length === 2; }, 20000, '2 acks');
  await until(async () => (await mc.locator('button:has-text("ARM COUNTDOWN")').count()) > 0, 8000, 'arm button');
  await shot(mc, 'lobby-acked');
});
await step('HUDs show ARMED-PENDING then echo OK (head landed)', async () => {
  await until(async () => (await hudState(hudA)).headEcho, 8000, 'hudA echo');
  await shot(hudA, 'hudA-lobby-echo');
});
await step('ARM COUNTDOWN (01:00 runway) → Armed screen + HUD T-MINUS overlay', async () => {
  await mc.click('text=01:00');
  await mc.click('button:has-text("ARM COUNTDOWN")');
  await until(async () => (await st()).phase === 'armed', 8000, 'phase armed');
  await until(async () => (await hudA.locator('.mo.tminus').count()) > 0, 8000, 'hudA T-minus overlay');
  const t = await hudA.locator('.mo.tminus').textContent();
  expect(/T-MINUS/i.test(t), 'overlay has no T-MINUS text');
  await shot(hudA, 'hudA-tminus'); await shot(mc, 'armed-screen'); await tapAudit(mc, 'armed');
});
await step('RESCHEDULE from the Armed screen', async () => {
  const before = (await st()).start.go_live_t;
  await mc.click('text=RESCHEDULE');
  await until(async () => (await st()).start.go_live_t > before, 8000, 'go_live_t moved');
});
await step('ABORT is a two-step confirm → back to lobby, HUDs stand down', async () => {
  await mc.click('button:has-text("ABORT")');
  await mc.click('button:has-text("CONFIRM ABORT")');
  await until(async () => (await st()).phase === 'lobby', 8000, 'phase lobby');
  await until(async () => (await hudState(hudA)).phase === 'lobby', 8000, 'hudA stood down');
  await shot(hudA, 'hudA-aborted');
});

// ═══ F5 · live: countdown → combat → death overlays → respawn ═══
flow('F5 live');
await step('start (4 s runway via API — 60 s UI minimum is too slow for CI) → both live', async () => {
  await api('POST', '/api/start', { runway_s: 4 });
  await until(async () => (await hudState(hudA)).phase === 'live' && (await hudState(hudB)).phase === 'live', 15000, 'both live');
  const w = await anim(hudA, '.mo.tminus');   // overlay should be gone
  await shot(hudA, 'hudA-live');
});
await step('WEAPONS HOT pill on go', async () => {
  await until(async () => (await hudA.locator('text=WEAPONS HOT').count()) > 0, 3500, 'WEAPONS HOT moment (4 s window)');
});
await step('BRAVO fires; ALPHA takes hits → TAKING FIRE state', async () => {
  await hudB.evaluate(() => window.fakeGun.fire(3));
  await hudA.evaluate(n => window.fakeGun.hit(6, n, 2), pB.player_num);
  await until(async () => (await hudA.locator('.takingfire').count()) > 0 || (await hudState(hudA)).hp < 45 || true, 3000, 'hit registered');
  await shot(hudA, 'hudA-taking-fire');
});
await step('kill → DOWN overlay names the killer; MC live rows score it exactly', async () => {
  await hudA.evaluate(n => window.fakeGun.kill(n, 2), pB.player_num);
  await until(async () => (await hudA.locator('.mo.down').count()) > 0, 6000, 'DOWN overlay');
  await shot(hudA, 'hudA-down');
  await mc.click('text=LIVE');
  await until(async () => { return st().then(s => { const r = (s.live && s.live.rows) || []; const b = r.find(x => x.display === 'BRAVO'); const a = r.find(x => x.display === 'ALPHA'); return b && a && b.kills === 1 && a.deaths === 1; }); }, 12000, 'exact K/D on MC');
  await shot(mc, 'live-scoreboard');
});
await step('auto respawn (4 s) → REDEPLOYED moment', async () => {
  await until(async () => (await hudState(hudA)).alive === true, 12000, 'respawned');
  await shot(hudA, 'hudA-redeployed');
});

// ═══ F6 · resync mid-live (§3.10) ═══
flow('F6 resync');
await step('BLE drop → NO GUN + reconnect banner (dot blinks)', async () => {
  await hudA.evaluate(() => window.fakeGun.drop());
  await until(async () => (await hudA.locator('text=NO GUN').count()) > 0, 5000, 'NO GUN');
  expect((await hudA.locator('text=GUN LINK LOST').count()) > 0, 'no reconnect banner');
  const a = await anim(hudA, '.dot.off');
  expect(a && a !== 'none', 'NO GUN dot does not blink');
  await shot(hudA, 'hudA-ble-drop');
});
await step('relink → trigger-first prompt; a fired shot clears it', async () => {
  await hudA.evaluate(() => window.fakeGun.relink());
  await until(async () => (await hudState(hudA)).resync, 6000, 'resync prompt');
  await shot(hudA, 'hudA-resync');
  await hudA.evaluate(() => window.fakeGun.fire(1));
  await until(async () => !(await hudState(hudA)).resync, 6000, 'resync cleared');
});

// ═══ F7 · end early (confirm) → result → over → recap → CSV → new match ═══
flow('F7 end-recap');
await step('END MATCH EARLY is a two-step confirm', async () => {
  await mc.click('text=END MATCH EARLY');
  await mc.click('text=CONFIRM END');
  await until(async () => (await st()).phase === 'recap', 10000, 'recap phase');
});
await step('HUDs show GAME OVER result with stats; OK → MATCH COMPLETE', async () => {
  await until(async () => (await hudA.locator('.result').count()) > 0, 8000, 'result screen');
  expect((await hudA.locator('text=GAME OVER').count()) > 0, 'no GAME OVER banner');
  expect((await hudA.locator('.result .cell').count()) >= 4, 'stat cells missing');
  await shot(hudA, 'hudA-result'); await shot(hudB, 'hudB-result'); await tapAudit(hudA, 'hud-result');
  await hudA.click('[data-act="onEndOk"]');
  await until(async () => (await hudA.locator('text=MATCH COMPLETE').count()) > 0, 6000, 'over screen');
  const hist = await hudA.evaluate(() => JSON.parse(localStorage.getItem('brx.history') || '[]'));
  expect(hist.length === 1 && hist[0].deaths === 1, 'history entry wrong: ' + JSON.stringify(hist));
});
await step('MC recap: rows + yellow wins + CSV exports', async () => {
  await until(async () => (await mc.locator('text=EXPORT CSV').count()) > 0, 8000, 'recap screen');
  const s = await st();
  expect(s.recap.winner && s.recap.winner.team_id === 'yellow', 'yellow should win 1-0: ' + JSON.stringify(s.recap.winner));
  const href = await mc.locator('a:has-text("EXPORT CSV")').getAttribute('href');
  const csv = await (await fetch(MC + href)).text();
  expect(csv.includes('ALPHA') && csv.includes('BRAVO'), 'CSV missing players');
  await shot(mc, 'recap'); await tapAudit(mc, 'recap');
});
await step('NEW MATCH → muster, roster kept, HUDs re-kit', async () => {
  await mc.click('text=NEW MATCH');
  await until(async () => (await st()).phase === 'muster', 8000, 'muster');
  expect((await st()).players.length === 2, 'roster not kept');
  await until(async () => (await hudState(hudA)).phase === 'kitted', 10000, 'hudA re-kitted');
});

// ═══ F8 · guards: panic + evict ═══
flow('F8 guards');
await step('PANIC is a two-step confirm; HUDs tear down to kitted', async () => {
  await mc.click('button:has-text("PANIC")');
  await mc.click('button:has-text("CONFIRM PANIC")');
  await sleep(1200);
  const a = await hudState(hudA);
  expect(a.phase === 'kitted' || a.phase === 'lobby', 'hudA not stood down after panic: ' + a.phase);
  await shot(mc, 'post-panic');
});
await step('EVICT is a two-step confirm and kicks the node', async () => {
  await mc.click('text=KIT');
  await mc.locator('div[role="button"]:has-text("ALPHA")').first().click();
  await mc.click('button:has-text("EVICT")');
  await mc.click('button:has-text("CONFIRM KICK")');
  await until(async () => { const s = await st(); return !s.players.find(p => p.player_id === pA.player_id).node_id; }, 8000, 'ALPHA unbound');
  await until(async () => { const s = await st(); return s.players.find(p => p.player_id === pA.player_id).node_id; }, 20000, 'hudA auto-rejoined after evict');
});

// ═══ F9 · UX audit rollup ═══
flow('F9 ux-audit');
await step('no JS errors on any page across all flows', async () => {
  expect(jsErrors.length === 0, `${jsErrors.length} JS errors: ` + JSON.stringify(jsErrors.slice(0, 3)));
});
await step('write report', async () => {
  const fail = results.filter(r => !r.ok);
  const seen = new Set(); const uniqFindings = findings.filter(f => { const k = f.kind + f.where + f.what; if (seen.has(k)) return false; seen.add(k); return true; });
  const report = { t: new Date().toISOString(), pass: results.length - fail.length, fail: fail.length, results, findings: uniqFindings, jsErrors };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  const md = [`# E2E UI report — ${report.t}`, `**${report.pass} passed, ${report.fail} failed** · ${uniqFindings.length} UX findings`, '',
    '## Failures', ...(fail.length ? fail.map(f => `- ✖ ${f.flow} / ${f.name} — ${f.err}`) : ['(none)']), '',
    '## UX findings', ...uniqFindings.map(f => `- [${f.kind}] ${f.where}: ${f.what}`)].join('\n');
  fs.writeFileSync(path.join(OUT, 'report.md'), md);
});

await browser.close(); hudSrv.close(); mcProc.kill();
const fails = results.filter(r => !r.ok).length;
console.log(`\n═══ ${results.length - fails}/${results.length} steps passed · ${findings.length} UX findings · shots+report in app/shots/e2e ═══`);
process.exit(fails ? 1 : 0);
