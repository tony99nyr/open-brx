// `site/shots.mjs` hardcoded ports 4180/4181 and deleted `site/shots/` before binding either one --
// so a second worker holding one of the ports left the FIRST process's shots directory empty, which
// reads exactly like a clean slate instead of a failed run (2026-09-13: cost a lane a half-hour run
// and produced a bad commit of an emptied shots dir). These checks never touch the real
// `site/shots/` -- nothing here calls `resetShotsDir()` against it or launches a browser.
import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileP = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS_URL = pathToFileURL(path.resolve(HERE, '../shots.mjs')).href;
const shots = await import(SHOTS_URL);

const freePort = () => new Promise((resolve, reject) => {
  const s = http.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

// MC_PORT/HUD_PORT are read from the environment once, at import -- so proving an override actually
// takes hold needs a fresh process per case, not a second import in this already-cached worker.
const portsSeenBy = async (env) => {
  const { stdout } = await execFileP(process.execPath, ['-e',
    `import(${JSON.stringify(SHOTS_URL)}).then(m => process.stdout.write(JSON.stringify({ mc: m.MC_PORT, hud: m.HUD_PORT })))`],
    { env: { ...process.env, ...env } });
  return JSON.parse(stdout);
};

test('MC_PORT/HUD_PORT default to the historical 4180/4181 with no env override', async () => {
  expect(await portsSeenBy({})).toEqual({ mc: 4180, hud: 4181 });
});

test('SHOTS_MC_PORT / SHOTS_HUD_PORT actually move the ports -- the whole point of this change', async () => {
  expect(await portsSeenBy({ SHOTS_MC_PORT: '9001', SHOTS_HUD_PORT: '9002' })).toEqual({ mc: 9001, hud: 9002 });
});

test('serveStatic loudly refuses an occupied port -- names the port, the label, and never touches the filesystem', async () => {
  const port = await freePort();
  const squatter = http.createServer().listen(port, '127.0.0.1');
  await new Promise((r) => squatter.once('listening', r));
  try {
    await expect(shots.serveStatic(HERE, port, 'phone HUD www')).rejects.toThrow(
      new RegExp(`127\\.0\\.0\\.1:${port}.*phone HUD www`),
    );
  } finally {
    await new Promise((r) => squatter.close(r));
  }
});

test('serveStatic binds a free port fine, and the port is caller-chosen (not the hardcoded default)', async () => {
  const port = await freePort();
  expect(port).not.toBe(4180);
  expect(port).not.toBe(4181);
  const server = await shots.serveStatic(HERE, port, 'test');
  try {
    const res = await fetch(`http://127.0.0.1:${port}/shots-ports.spec.mjs`);
    expect(res.status).toBe(200);
  } finally {
    await shots.closeServer(server);
  }
});

test('shots.mjs never deletes site/shots/ before both static servers are confirmed bound', () => {
  // A structural guard on the exact regression: `resetShotsDir()` must be CALLED (not merely
  // defined) strictly after the `Promise.all([serveStatic(...), serveStatic(...)])` that binds both
  // ports -- not before it, the way it used to run.
  const src = fs.readFileSync(path.resolve(HERE, '../shots.mjs'), 'utf8');
  const bindCall = src.indexOf('Promise.all([\n      serveStatic(');
  const wipeCall = src.search(/\bresetShotsDir\(\);/);
  expect(bindCall, 'could not find the Promise.all server-bind call -- did shots.mjs get restructured?').toBeGreaterThan(-1);
  expect(wipeCall, 'could not find a resetShotsDir() call -- did shots.mjs get restructured?').toBeGreaterThan(-1);
  expect(wipeCall).toBeGreaterThan(bindCall);
});

test('screens.mjs (app/tools) has no hardcoded port: SCREENS_PORT or an ephemeral one', () => {
  // screens.mjs shards its steps across child processes (2026-09-16), each with its own static server,
  // so a fixed default port would make the shards collide. The default is now 0 (the OS picks), and the
  // URLs read the bound port back from the server.
  const src = fs.readFileSync(path.resolve(HERE, '../../app/tools/screens.mjs'), 'utf8');
  expect(src).toContain('process.env.SCREENS_PORT || 0');
  expect(src).toContain('const PORT = srv.address().port');
  expect(src.match(/\b4192\b/g), 'a hardcoded 4192 survives in screens.mjs').toBeNull();
});
