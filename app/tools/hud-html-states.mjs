// Capture stage engine states for the fixed HUD HTML test.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Engine } from '../src/engine.js';
import { renderHtml, domGolden, loadStates, saveStates } from '../test/hud-html-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const writeGolden = process.argv.includes('--write-golden');
if (!writeGolden) throw new Error('Pass --write-golden only for a deliberate HTML change. This replaces the HUD stage-state and HTML golden fixtures.');
console.warn('Warning: --write-golden replaces the HUD stage-state and HTML golden fixtures. Use it only for a deliberate HTML change.');
const stages = ['idle', 'idle-noisy-open', 'connected', 'connected-join-new', 'setup', 'briefing',
  'kitted', 'loadout-primary', 'loadout-perk', 'lobby', 'standby-from-lobby', 'armed',
  'live', 'live-lowammo', 'live-shields-full', 'live-scores-koth', 'down-full',
  'result-win-team', 'result-players', 'history', 'diag-live', 'live-kill-lead-hill',
  // A16 DOM golden: stages that reach the moments, lanes, down screen and score board.
  'live-hit', 'live-switch', 'live-reload', 'live-gun-locked', 'live-stunned', 'live-smoke', 'live-alert', 'live-medals',
  'down-recap', 'down-hill', 'down-ffa', 'down-pickup', 'down-hold', 'live-pu-rockets', 'live-hill-lost', 'live-koth',
  'live-scores', 'live-scores-ffa', 'result-awards', 'result-lose-ffa', 'redeploy', 'armed-with-mc-verify', 'live-overheat',
  'live-charge-low', 'live-callout-teammate', 'live-kill-killjoy', 'result-pending', 'result-unreached'];
const statesFile = path.join(root, 'test/fixtures/hud-html-states.json');
// A stage already captured is kept as it is: its timestamps are part of the golden.
const kept = fs.existsSync(statesFile) ? loadStates(statesFile) : {};
const bundle = await build({ entryPoints: [path.join(root, 'src/demo.js')], bundle: true, write: false,
  format: 'esm', platform: 'node', logLevel: 'silent' });
const { startDemo } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].contents).toString('base64'));
const fixtures = { ...kept };
try {
  for (const name of stages) {
    if (kept[name]) continue;
    const logs = [];
    let diagOpen = false;
    const hud = {
      lo: { tab: 'primary', filter: 'weapons', focus: null, confirm: null },
      scan: [], scanActive: true, scanOther: false, bluetoothOn: true, locationOn: true,
      platform: 'web', mcUrl: '', history: [], diagData: {}, view: null, rtab: null, board: null,
      diag: { classList: { contains: () => diagOpen } },
      setScan(list) { this.scan = list; }, setScanOther(v) { this.scanOther = v; },
      setConnecting(v) { this.connecting = v; }, setDiscovered(v) { this.discovered = v; },
      render() {}, renderDiag() {}, toggleDiag() { diagOpen = !diagOpen; },
    };
    globalThis.location = { search: `?demo&stage=${name}` };
    globalThis.window = { brx: { hud } };
    const engine = new Engine({ writer: () => true, storage: null, now: () => Date.now(), synced: () => true,
      report: () => {}, log: () => {} });
    const api = startDemo({ engine, log: (message, kind) => logs.push({ message, kind }) });
    const ticker = setInterval(() => engine.tick(), 50);
    try {
      const deadline = Date.now() + 20000;
      while ((!api.settled || Date.now() < api.lastScheduledAt + 350) && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      if (!api.settled) throw new Error(`${name}: stage timeout`);
      const failed = logs.filter(x => x.kind === 'le');
      if (failed.length) throw new Error(`${name}: ${JSON.stringify(failed)}`);
      fixtures[name] = { now: Date.now(), state: engine.state(), hud: {
        lo: hud.lo, scan: hud.scan, scanActive: hud.scanActive, scanOther: hud.scanOther,
        bluetoothOn: hud.bluetoothOn, locationOn: hud.locationOn, platform: hud.platform,
        connecting: hud.connecting, discovered: hud.discovered, mcUrl: hud.mcUrl,
        history: hud.history, sessionId: hud.sessionId, view: hud.view, rtab: hud.rtab,
        board: hud.board, diagData: { engine: { phase: engine.state().phase } },
        diagOpen: hud.diag.classList.contains('open'),
      } };
      if (name === 'live-scores-koth') fixtures[name].hud.board = 'team';
      if (name === 'result-players') fixtures[name].hud.rtab = 'awards';
      console.log(name);
    } finally { clearInterval(ticker); }
  }
  saveStates(statesFile, fixtures);
  const timezone = process.env.TZ;
  const priorDocument = globalThis.document;
  process.env.TZ = 'America/New_York';
  globalThis.document = { activeElement: null, querySelector: () => null };
  const golden = Object.fromEntries(Object.entries(fixtures).map(([name, fixture]) => [name, renderHtml(fixture)]));
  await new Promise(resolve => setTimeout(resolve, 0));
  if (timezone === undefined) delete process.env.TZ; else process.env.TZ = timezone;
  if (priorDocument === undefined) delete globalThis.document; else globalThis.document = priorDocument;
  fs.writeFileSync(path.join(root, 'test/fixtures/hud-dom-golden.json'), JSON.stringify(domGolden(fixtures), null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'test/fixtures/hud-html-golden.json'), JSON.stringify(golden, null, 2) + '\n');
} finally { delete globalThis.window; delete globalThis.location; }
