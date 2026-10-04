// Declared repository inputs for test-all jobs. Prefixes end in `/` and exact
// paths have no trailing slash. These are intentionally broad: missing a
// cross-tree input can make a cached test result incorrect.
const COMMON = ['scripts/test-all.mjs', 'scripts/lib/', 'package.json', 'pnpm-lock.yaml'];
const APP = ['app/', 'mcp/', 'docs/', 'hardware/', 'protocol/'];
const MC = ['webapp/mc/', 'app/', 'mcp/', 'docs/', 'hardware/', 'protocol/'];
const PYTHON = ['mcp/', 'app/', 'webapp/', 'site/', 'scripts/', 'docs/', 'hardware/', 'protocol/', '.claude/', '.github/'];
const SITE = ['site/', 'app/', 'mcp/', 'webapp/', 'docs/'];
const DOWNLOAD = 'webapp/download/build.json';
const WEB_LOCK = ['webapp/mc/package.json', 'webapp/mc/package-lock.json'];
const APP_LOCK = ['app/package.json', 'app/package-lock.json'];
const SITE_LOCK = ['site/package.json', 'site/package-lock.json'];

const rows = {
  // Docs hygiene and suite registration inspect repository-wide files and paths.
  mcp: ['.'],
  chaos: [...PYTHON, ...WEB_LOCK, ...APP_LOCK, ...SITE_LOCK],
  'mc-tsc': ['webapp/mc/', 'mcp/', 'app/', ...WEB_LOCK],
  'mc-vitest': [...MC, ...WEB_LOCK],
  'app-tsc': ['app/', ...APP_LOCK],
  'app-test': [...APP, 'scripts/', 'webapp/', ...APP_LOCK, ...WEB_LOCK],
  site: [...SITE, ...APP_LOCK, ...WEB_LOCK, ...SITE_LOCK],
  'app-screens': [...APP, ...APP_LOCK],
  'app-logsync': [...APP, DOWNLOAD, ...APP_LOCK],
  'app-moments': [...APP, ...APP_LOCK],
  'app-e2e': [...MC, DOWNLOAD, ...APP_LOCK, ...WEB_LOCK],
};

for (const name of ['koth', 'backhaul', 'kit-continue', 'end-delivery', 'standby', 'm2-ui', 'game-edit',
  'operator-menu', 'report', 'frame', 'lobby-updating', 'recap-next', 'feed-reload', 'mc-restart',
  'live-board', 'vqa2', 'play', 'build', 'lobby-outcome']) {
  rows[`mc-${name}`] = [...MC, DOWNLOAD, 'scripts/', '.claude/', ...WEB_LOCK];
}

/** Return declared repo-relative inputs for a test-all job. */
export function inputsForJob(jobName) {
  const inputs = rows[jobName];
  if (!inputs) throw new Error(`no declared inputs for test-all job: ${jobName}`);
  return [...new Set([...COMMON, ...inputs])];
}

export const declaredInputs = inputsForJob;

export const INPUT_JOBS = Object.freeze(Object.keys(rows));
