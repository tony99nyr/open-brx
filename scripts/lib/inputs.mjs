// Declared repository inputs for test-all jobs. Prefixes end in `/` and exact
// paths have no trailing slash. These are intentionally broad: missing a
// cross-tree input can make a cached test result incorrect.
const COMMON = ['scripts/test-all.mjs', 'scripts/lib/', 'package.json', 'pnpm-lock.yaml'];
// Real cross-tree readers (git grep 2026-10-04; every other docs/, hardware/ and protocol/ hit in app/ and
// webapp/mc/ is a comment): app/test/announcer.test.mjs reads docs/announcer.md; the built app/www bundles
// mcp/brx_mcp/mc/golden_bundle.json; webapp/mc/test/medalicons-gen.test.ts reads app/src/hud/medalicons.js and
// fake-invariants.test.ts imports mcp/brx_mcp/mc/fake_invariants.json; every job that starts MC runs mcp/ and
// reads webapp/download/build.json. The mcp job and site stay broad.
const APP = ['app/', 'mcp/'];
const MC = ['webapp/mc/', 'mcp/'];
const SITE = ['site/', 'app/', 'mcp/', 'webapp/', 'docs/'];
const DOWNLOAD = 'webapp/download/build.json';
const WEB_LOCK = ['webapp/mc/package.json', 'webapp/mc/package-lock.json'];
const APP_LOCK = ['app/package.json', 'app/package-lock.json'];
const SITE_LOCK = ['site/package.json', 'site/package-lock.json'];

const rows = {
  // Docs hygiene and suite registration inspect repository-wide files and paths.
  mcp: ['.'],
  // chaos runs only the chaos files, but the guard scans all of mcp/tests and it costs 11 s: keep it broad.
  chaos: ['mcp/', 'app/', 'webapp/', 'site/', 'scripts/', 'docs/', 'hardware/', 'protocol/', '.claude/', '.github/', ...WEB_LOCK, ...APP_LOCK, ...SITE_LOCK],
  'mc-tsc': [...MC, 'app/src/hud/medalicons.js', ...WEB_LOCK],
  'mc-vitest': [...MC, 'app/src/hud/medalicons.js', ...WEB_LOCK],
  'app-tsc': ['app/', ...APP_LOCK],
  'app-test': [...APP, 'docs/announcer.md', 'webapp/download/', ...APP_LOCK, ...WEB_LOCK],
  site: [...SITE, ...APP_LOCK, ...WEB_LOCK, ...SITE_LOCK],
  'app-screens': [...APP, ...APP_LOCK],
  'app-logsync': [...APP, DOWNLOAD, ...APP_LOCK],
  'app-moments': [...APP, ...APP_LOCK],
  // app-e2e drives two phone HUDs (app/www, built from app/src) against the real console and MC.
  'app-e2e': [...MC, ...APP, DOWNLOAD, ...APP_LOCK, ...WEB_LOCK],
};

for (const name of ['koth', 'backhaul', 'kit-continue', 'end-delivery', 'standby', 'm2-ui', 'game-edit',
  'operator-menu', 'report', 'frame', 'lobby-updating', 'recap-next', 'feed-reload', 'mc-restart',
  'live-board', 'vqa2', 'play', 'build', 'lobby-outcome']) {
  rows[`mc-${name}`] = [...MC, DOWNLOAD, ...WEB_LOCK];
}

/** Return declared repo-relative inputs for a test-all job. */
export function inputsForJob(jobName) {
  const inputs = rows[jobName];
  if (!inputs) throw new Error(`no declared inputs for test-all job: ${jobName}`);
  return [...new Set([...COMMON, ...inputs])];
}

export const declaredInputs = inputsForJob;

export const INPUT_JOBS = Object.freeze(Object.keys(rows));
