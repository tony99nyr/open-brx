// Marketing screenshots, generated from the real UIs — never taken by hand.
//
// Run from site/: `node shots.mjs`
//
// Serves the built Mission Control UI (webapp/mc/dist) and the built phone HUD (app/www) over two
// throwaway static servers, drives each with Playwright, and writes JPEGs + a manifest into
// site/shots/. The manifest records the git tree hash of each UI's source directory at capture
// time; mcp/tests/test_site_shots.py fails the moment that source moves on without a re-capture.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(__dirname, 'shots');

const MC_DIST = path.join(REPO_ROOT, 'webapp', 'mc', 'dist');
const HUD_WWW = path.join(REPO_ROOT, 'app', 'www');
const MC_PORT = 4180;
const HUD_PORT = 4181;
const WARN_BYTES = 420 * 1024;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

function contentTypeFor(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

// SPA static server: serves files under `root`, falling back to index.html for anything that
// isn't a real file on disk (both UIs reference assets by absolute /assets/... paths).
function serveStatic(root, port) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const candidate = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
    fs.readFile(candidate, (err, data) => {
      if (err) {
        fs.readFile(path.join(root, 'index.html'), (err2, data2) => {
          if (err2) {
            res.statusCode = 404;
            res.end('not found');
            return;
          }
          res.setHeader('content-type', 'text/html; charset=utf-8');
          res.end(data2);
        });
        return;
      }
      res.setHeader('content-type', contentTypeFor(candidate));
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
}

function gitTree(relPath) {
  try {
    return execFileSync('git', ['rev-parse', `HEAD:${relPath}`], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch (e) {
    throw new Error(`git rev-parse HEAD:${relPath} failed — is ${relPath} the right source dir? (${e.message})`);
  }
}

function requireBuilt(file, howToBuild) {
  if (!fs.existsSync(file)) {
    console.error(`${path.relative(REPO_ROOT, file)} is missing: ${howToBuild}`);
    process.exit(1);
  }
}

function resetShotsDir() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  for (const f of fs.readdirSync(SHOTS_DIR)) {
    if (f.endsWith('.jpg') || f === 'manifest.json') fs.rmSync(path.join(SHOTS_DIR, f));
  }
}

async function main() {
  requireBuilt(
    path.join(MC_DIST, 'index.html'),
    'run "cd webapp/mc && npm run build" first',
  );
  requireBuilt(
    path.join(HUD_WWW, 'app.js'),
    'run "cd app && npm run build" first',
  );

  resetShotsDir();

  const manifestFiles = {};
  const shot = async (page, name) => {
    const outPath = path.join(SHOTS_DIR, name);
    await page.screenshot({ path: outPath, type: 'jpeg', quality: 72 });
    const vp = page.viewportSize();
    const bytes = fs.statSync(outPath).size;
    manifestFiles[name] = { w: vp.width, h: vp.height, bytes };
    console.log(`${name}: ${bytes} bytes`);
    if (bytes > WARN_BYTES) {
      console.warn(`WARNING: ${name} is ${bytes} bytes, over the ${WARN_BYTES} byte target`);
    }
  };

  let mcServer, hudServer, browser;
  try {
    [mcServer, hudServer] = await Promise.all([
      serveStatic(MC_DIST, MC_PORT),
      serveStatic(HUD_WWW, HUD_PORT),
    ]);
    browser = await chromium.launch();

    // ---- Mission Control: ?mock is the in-browser demo, no server needed ----
    const mcPage = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    await mcPage.goto(`http://127.0.0.1:${MC_PORT}/?mock`, { waitUntil: 'networkidle' });
    await mcPage.waitForTimeout(1200);
    await shot(mcPage, 'mc-armory.jpg');
    for (const label of ['GAMES', 'KIT', 'LOBBY']) {
      await mcPage.getByText(label, { exact: true }).first().click();
      await mcPage.waitForTimeout(900);
      await shot(mcPage, `mc-${label.toLowerCase()}.jpg`);
    }
    await mcPage.close();

    // ---- Phone HUD: ?demo is a scripted match that advances on its own ----
    const hudPage = await browser.newPage({ viewport: { width: 891, height: 411 }, deviceScaleFactor: 2 });
    await hudPage.goto(`http://127.0.0.1:${HUD_PORT}/?demo`);
    const captures = [
      { t: 5.6, name: 'hud-armed.jpg' },
      { t: 14.6, name: 'hud-live.jpg' },
      { t: 22.6, name: 'hud-hit.jpg' },
      { t: 29.6, name: 'hud-down.jpg' },   // the demo player dies at ~29.2 s; 28.6 caught them alive at 36 hp
    ];
    let elapsed = 0;
    for (const c of captures) {
      await hudPage.waitForTimeout(Math.round((c.t - elapsed) * 1000));
      elapsed = c.t;
      await shot(hudPage, c.name);
      const st = await hudPage.evaluate(() => {
        const s = window.brx.engine.state();
        return { phase: s.phase, hp: s.hp, alive: s.alive };
      });
      console.log('STATE', c.name, JSON.stringify(st));
    }
    await hudPage.close();

    // ---- Phone HUD: ?demo&kit sits in KITTED with a fake MC answering loadout picks ----
    const kitPage = await browser.newPage({ viewport: { width: 891, height: 411 }, deviceScaleFactor: 2 });
    await kitPage.goto(`http://127.0.0.1:${HUD_PORT}/?demo&kit`);
    await kitPage.waitForTimeout(1800);
    await shot(kitPage, 'hud-kitted.jpg');
    await kitPage.click('[data-act="onOpenLoadout"][data-arg="primary"]');
    await kitPage.waitForTimeout(700);
    await shot(kitPage, 'hud-loadout.jpg');
    await kitPage.close();

    const manifest = {
      taken: new Date().toISOString(),
      mc_src: gitTree('webapp/mc/src'),
      hud_src: gitTree('app/src'),
      files: manifestFiles,
    };
    fs.writeFileSync(path.join(SHOTS_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`wrote ${Object.keys(manifestFiles).length} shots + manifest.json to ${SHOTS_DIR}`);
  } finally {
    await browser?.close();
    await Promise.all([closeServer(mcServer), closeServer(hudServer)]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
