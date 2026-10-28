// Maps changed repo-relative paths to job-name substrings for `test:all -- --changed [base]`. A substring here
// is exactly what scripts/test-all.mjs's own `filters` matching already does: a job runs when its name INCLUDES
// one of these strings. mcp/tests/test_suite_registry.py fails if a registry job's name matches none of
// JOB_NAME_SUBSTRINGS -- that job could never be picked by --changed, so it would quietly stop running once a
// branch relies on the re-gate rule in CLAUDE.md instead of the full suite.
//
// Fail safe: a known tree with no path rule or a full-suite trigger selects EVERYTHING (`filters: null`).
// Unknown directories select every Python job (`mcp`): docs hygiene scans every tracked and unignored repository
// file, and test_build_state_in_checkout reads every tracked tsconfig and Vite config, wherever it lives.
//
// F626: the Python suite is three jobs (scripts/lib/jobs.mjs): mcp-docs (run_tests.py GROUPS['docs'], the files that
// read docs widely), mcp-sim (the balance sims) and mcp-core (the rest). A filter is a name SUBSTRING, so `mcp`
// selects all three; a docs, protocol/, .claude/ or .github/ path adds `mcp-docs`, never bare `mcp`, plus the jobs in
// MCP_DOCS_READERS for the few such paths an mcp-core or mcp-sim test reads.
//
// The edges below are derived from the actual cross-directory readers (2026-10-04 review), not guessed:
//   - app/src/hud/medalicons.js is read by webapp/mc/test/medalicons-gen.test.ts (mc-vitest needs app/**);
//   - about 40 mcp/tests files read app/ or webapp/mc/ sources directly (test_contract_generated.py,
//     test_stage_mirror.py, test_suite_registry.py, ...), so `mcp` must run for either tree;
//   - site/lib/data.mjs and site/lib/facts.mjs read mcp/brx_mcp/mc/weapons.json, mcp/brx_mcp/data/sound_catalog.json,
//     mcp/brx_mcp/mc/state.py and webapp/mc/src/tokens.ts, so `site` must run for mcp/** and webapp/mc/**.
//   - app tests read mcp/brx_mcp/mc/golden_bundle.json, compile.py and data/sound_catalog.json; the screens and
//     moments gates bundle the demo, and app/tools/e2e.mjs reads the built webapp/mc/dist.
//     app/tools/logsync-gate.mjs starts app/test/mc_server.py, which imports mcp/brx_mcp.
//   - app/test/announcer.test.mjs reads docs/announcer.md. mcp/tests/test_docs_hygiene.py reads .claude/skills/**.
//   - the mcp tests that read a docs, protocol/ or .claude/ path were found by tracing every file the suite opens
//     (2026-10-26, F626); MCP_DOCS_READERS lists the ones outside mcp-docs. No mcp-core or mcp-sim test read a root
//     Markdown file in that trace.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { inputsForJob, jobsReadingLib } from './jobs.mjs';

// The job registry's inputs (scripts/lib/jobs.mjs) are the one statement of which job reads which paths (the cache
// key). A rule here may select FEWER jobs than those inputs imply only through NARROWED, and each entry says what
// makes skipping safe: a wrong narrowing must cost at most a red lander gate, never a skip that reaches main. The lander narrows with --changed
// only for a docs-only candidate (land.mjs gate); every code candidate gets the full gate.
// test_test_all_changed.py checks every declared input against selectJobs and this table.
export const NARROWED = [
  { jobs: ['chaos'], inputs: ['*'], except: ['mcp/'],
    why: 'chaos runs only the chaos scenarios, which load mcp/ alone; its inputs row is broad for the cache only, '
      + 'where a stale hit is worse than a rerun. It reads nothing else, so even the lander\'s narrow regates '
      + '(docs-only, site/shots) may skip it; flake blame uses the declared inputs, not this table.' },
  { jobs: ['app-screens', 'app-moments'], inputs: ['mcp/'],
    why: 'the app reads mcp/ directly only through golden_bundle.json (SCREENS_SENSITIVE below selects it); the rest '
      + 'reaches these gates through generated files, whose regenerated output selects them and whose staleness test '
      + 'runs in mcp-docs. The lander runs both in full on every code candidate.' },
  { jobs: ['mcp-core', 'mcp-sim'], inputs: ['docs/', 'protocol/', '.claude/', '.github/'],
    why: 'F626: these trees hold docs and reference files. The test files that read them widely are in run_tests.py '
      + 'GROUPS[\'docs\'], the mcp-docs job these paths do select. The pages an mcp-core or mcp-sim test reads select '
      + 'that job through MCP_DOCS_READERS, and a tsconfig or Vite config anywhere selects mcp-core. '
      + 'test_test_all_changed.py checks the docs paths those tests name against these rules, a static check that can '
      + 'miss a path built at run time. The lander gates a docs-only candidate with --changed, so a missed reader could '
      + 'land red; CI runs every mcp test file on main. A .github workflow is a full-suite trigger.' },
  { jobs: ['*'], inputs: ['scripts/lib/'],
    why: 'scripts/lib is the runner; its unit tests run in mcp. A runner change can still change how any job runs, '
      + 'so this is safe only because scripts/lib is code: the lander gates it in full, and flake blame uses '
      + 'the declared inputs, not this table. A local --changed after a runner change runs mcp only.' },
];

/** The index of the NARROWED entry that lets a path under `input` skip `job`, or -1. */
export function narrowedBy(job, input) {
  return NARROWED.findIndex(n => (n.jobs.includes('*') || n.jobs.includes(job))
    && (n.inputs.includes(input) || (n.inputs.includes('*') && !(n.except || []).includes(input))));
}
export const narrowed = (job, input) => narrowedBy(job, input) >= 0;

// Files under app/ that webapp/mc's tests read: mc-vitest runs those tests, and mc-tsc (tsconfig.test.json includes
// test/) sees the ones they import. Read from the registry, the one list: a new case file is added there only.
const MC_READS_FROM_APP = new Set(inputsForJob('mc-tsc').filter(p => p.startsWith('app/') && !p.endsWith('/')));

/** Every substring a rule below can add to the selection. Keep this in step with the rules themselves. */
export const JOB_NAME_SUBSTRINGS = ['app-', 'site', 'mc-', 'mc-vitest', 'mcp', 'mcp-core', 'mcp-docs', 'mcp-sim', 'chaos'];

// F626: the docs, protocol/, .claude/ and root Markdown paths that a test OUTSIDE mcp-docs reads, each with its readers.
// A path ending in `/` is a prefix; `match` is a pattern on the whole path. Keep this list short: a test that reads
// docs widely belongs in run_tests.py GROUPS['docs'] instead. test_test_all_changed.py checks it against the docs
// paths the mcp-core and mcp-sim tests name, and pins each entry.
export const MCP_DOCS_READERS = [
  { path: 'docs/spec/contracts.md', jobs: ['mcp-core'],
    why: 'test_contract_generated, test_contract_kinds, test_bundle_contract and test_sticks3_core check the wire spec against the code' },
  { path: 'docs/spec/utility.md', jobs: ['mcp-core'], why: 'test_sticks3_core checks the Stick constants against it' },
  { path: 'docs/weapon-design.md', jobs: ['mcp-core'], why: 'test_weapon_derivations checks its tables against weapons.json' },
  { path: 'docs/platform/install.md', jobs: ['mcp-core'], why: 'test_launcher and test_cloudflared_upgrade check the minimum versions it quotes' },
  { path: 'docs/platform/run.md', jobs: ['mcp-core'], why: 'test_cloudflared_upgrade checks the minimum version it quotes' },
  { path: 'docs/mac-dev-runbook.md', jobs: ['mcp-core'], why: 'test_cloudflared_upgrade checks the minimum version it quotes' },
  { path: 'docs/reference/sound-catalog.md', jobs: ['mcp-core'], why: 'test_regen_runner copies it and expects soundbank_community --check to pass' },
  { path: 'protocol/captures/', jobs: ['mcp-core'], why: 'test_mc_compile replays the real captures' },
  { path: '.claude/skills/balance-review/', jobs: ['mcp-sim'], why: 'test_balance_review reads the skill' },
  { path: 'tsconfig or Vite config', match: /(^|\/)(tsconfig[^/]*\.json|(vite|vitest)[^/]*\.config\.[mc]?[jt]s)$/, jobs: ['mcp-core'],
    why: 'test_build_state_in_checkout reads every tracked one, wherever it lives' },
];
const docsReadersOf = p => MCP_DOCS_READERS.filter(r => (r.match ? r.match.test(p)
  : r.path.endsWith('/') ? p.startsWith(r.path) : p === r.path));

// The one mcp/ file the phone app reads directly (app/src/demo.js imports it), so a change to it also runs the HUD
// screen and moments gates. Everything else under mcp/ reaches the app only through a generated file (the contract,
// the demo catalogue): its regenerated output is in the diff and selects its readers by the rules below, and a
// forgotten regeneration fails the staleness test in mcp-docs (scripts/generated.json, candidate 14).
export const SCREENS_SENSITIVE = new Set(['mcp/brx_mcp/mc/golden_bundle.json']);

// scripts/generated.json: every generator's sources and outputs. A change to either runs mcp-docs, which holds the
// staleness test (mcp/tests/test_generated_fresh.py). `*` matches within one path segment.
const REGISTRY = (() => {
  try {
    const file = new URL('../generated.json', import.meta.url);
    return JSON.parse(readFileSync(file, 'utf8')).generators.map(g => ({ name: g.name,
      paths: [...g.sources, ...g.outputs].map(glob => new RegExp(`^${glob.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`)) }));
  } catch { return []; }
})();
export const registryEntriesFor = p => REGISTRY.filter(g => g.paths.some(re => re.test(p))).map(g => g.name);

// The runner and the job registry (every job's command, cost and inputs) change how any job runs. Root package metadata
// controls the test command, and the root lockfile can change installed job tools.
const FULL_SUITE_TRIGGERS = new Set(['scripts/test-all.mjs', 'scripts/lib/jobs.mjs', 'scripts/lib/budget.mjs', 'scripts/lib/scheduler.mjs', 'scripts/lib/test-all-cli.mjs', 'scripts/lib/gate-record.mjs', 'scripts/lib/report.mjs', 'scripts/lib/job-runner.mjs', 'scripts/lib/screens-raise.mjs', 'scripts/lib/cache-plan.mjs', 'scripts/lib/lock.mjs', 'scripts/lib/pool.mjs', 'package.json', 'pnpm-lock.yaml']);
const isCiWorkflow = p => p.startsWith('.github/workflows/');
const KNOWN_TOP_LEVEL = new Set(['app', 'webapp', 'mcp', 'site', 'docs', 'protocol', 'hardware', 'scripts', '.github', '.claude']);

/** paths: repo-relative, forward-slash. Returns { filters, reasons }: `filters` is a string[] of job-name
 *  substrings to OR together (test-all.mjs's own `filters.some(f => name.includes(f))`), or null for
 *  "run everything". `reasons` is one line per rule that fired. */
export function selectJobs(paths) {
  if (!paths.length) return { filters: null, reasons: ['no changed paths: running everything'] };
  const trigger = paths.find(p => FULL_SUITE_TRIGGERS.has(p) || isCiWorkflow(p));
  if (trigger) return { filters: null, reasons: [`${trigger}: a full-suite trigger, running everything`] };

  const filters = new Set();
  const reasons = [];
  for (const p of paths) {
    const generated = registryEntriesFor(p);
    if (generated.length) {
      filters.add('mcp-docs');
      reasons.push(`${p}: a source or output of ${generated.join(', ')} (scripts/generated.json) -> mcp-docs (the staleness test)`);
    }
    let matched = false;
    if (p.startsWith('site/shots/')) {
      filters.add('site'); filters.add('mcp'); matched = true;
      reasons.push(`${p}: site/shots/** -> site (the build hashes images, its test checks they load) and mcp `
        + '(test_site_shots.py checks the manifest against the jpgs and their size cap)');
    }
    if (p.startsWith('app/')) {
      filters.add('app-'); filters.add('site'); filters.add('mc-vitest'); filters.add('mcp'); matched = true;
      if (MC_READS_FROM_APP.has(p)) { filters.add('mc-tsc'); reasons.push(`${p}: webapp/mc's tests import it -> mc-tsc too`); }
      reasons.push(`${p}: app/** -> app-*, site (embeds the HUD demo), mc-vitest (medalicons-gen.test.ts reads app/src/hud/medalicons.js), mcp (its tests read app/)`);
    }
    if (p.startsWith('webapp/mc/')) {
      filters.add('mc-'); filters.add('mcp'); filters.add('site'); filters.add('app-e2e'); filters.add('app-postmatch'); matched = true;
      reasons.push(`${p}: webapp/mc/** -> the mc-* jobs, app-e2e and app-postmatch (serve webapp/mc/dist), mcp (its tests read webapp/mc/), site (facts.mjs reads webapp/mc/src/tokens.ts)`);
    }
    if (p.startsWith('mcp/')) {
      filters.add('mcp'); filters.add('chaos'); filters.add('mc-'); filters.add('site');
      filters.add('app-e2e'); filters.add('app-postmatch'); filters.add('app-logsync'); filters.add('app-test'); matched = true;
      reasons.push(`${p}: mcp/** -> mcp, chaos, mc-*, app-e2e, app-postmatch, app-logsync, app-test, site (the jobs read MC code or data)`);
      if (SCREENS_SENSITIVE.has(p)) {
        filters.add('app-screens'); filters.add('app-moments');
        reasons.push(`${p}: the app bundles it (app/src/demo.js) -> app-screens and app-moments too`);
      }
    }
    for (const r of docsReadersOf(p)) {
      for (const job of r.jobs) filters.add(job);
      reasons.push(`${p}: ${r.jobs.join(', ')} (${r.why})`);
    }
    if (p.startsWith('docs/') || p.endsWith('.md')) {
      filters.add('mcp-docs'); filters.add('site'); matched = true;
      reasons.push(`${p}: docs/** or *.md -> mcp-docs (docs hygiene) and site (renders docs/platform and docs/manual)`);
      if (p === 'docs/announcer.md') { filters.add('app-test'); reasons.push(`${p}: app/test/announcer.test.mjs reads this file -> app-test`); }
    }
    if (p.startsWith('protocol/')) { filters.add('mcp-docs'); matched = true; reasons.push(`${p}: protocol/** -> mcp-docs (docs hygiene)`); }
    // hardware/ is code with readers in mcp-core (the Stick host tests) and mcp-docs (hygiene, generated headers): keep `mcp`
    if (p.startsWith('hardware/')) { filters.add('mcp'); reasons.push(`${p}: hardware/** -> mcp (the Stick host tests)`); matched = true; }
    // scripts/test-all.mjs itself is a full-suite trigger (above); scripts/lib/** (its scheduling/lock/--changed
    // logic) is unit tested from mcp/tests/test_test_all_*.py, so it runs inside the mcp-core job.
    if (p.startsWith('scripts/')) { filters.add('mcp'); reasons.push(`${p}: scripts/** -> mcp (its unit tests)`); matched = true; }
    const libReaders = jobsReadingLib(p);
    if (libReaders.length) {
      for (const job of libReaders) filters.add(job);
      reasons.push(`${p}: ${libReaders.join(', ')} import it (their \`libs\` in scripts/lib/jobs.mjs)`);
    }
    if (p.startsWith('.claude/')) { filters.add('mcp-docs'); reasons.push(`${p}: .claude/** -> mcp-docs (docs hygiene)`); matched = true; }
    if (p.startsWith('.github/')) { filters.add('mcp-docs'); reasons.push(`${p}: .github/** -> mcp-docs (docs hygiene)`); matched = true; }
    // mcp-core and mcp-docs tests read root files (start.sh, .gitignore, .gitattributes, any tsconfig). A root file
    // that is not Markdown is code, never docs-only, and rare, so it keeps every Python job (`mcp`), not a narrowing.
    if (!matched && !p.includes('/')) { filters.add('mcp'); reasons.push(`${p}: root file -> mcp (its tests and docs hygiene read root files)`); matched = true; }
    if (!matched) {
      const top = p.split('/')[0];
      if (!KNOWN_TOP_LEVEL.has(top)) {
        filters.add('mcp');
        reasons.push(`${top}/: unknown top-level directory -> mcp (docs hygiene and test_build_state_in_checkout scan the whole repo)`);
        matched = true;
        continue;
      }
      return { filters: null, reasons: [`${p}: known tree has no mapping rule -- fail safe, running everything`] };
    }
  }
  // `mcp` already matches every Python job (a substring), so the narrower names add nothing beside it
  if (filters.has('mcp')) for (const job of ['mcp-core', 'mcp-docs', 'mcp-sim']) filters.delete(job);
  return { filters: [...filters], reasons };
}

/** True when every path is documentation: under docs/, or a Markdown file at the repo root (CLAUDE.md,
 *  CONTRIBUTING.md, README.md). The lander gates such a candidate with --changed (land.mjs `gate`), so selectJobs
 *  above must send every docs path to each job that reads docs. test_test_all_changed.py checks the docs paths the
 *  sources name against these rules: a static check, so a path built at run time can slip past it. Such a candidate
 *  runs mcp-docs and site, not all three Python jobs (F626). Empty means "not docs only". */
export function isDocsOnly(paths) {
  return paths.length > 0 && paths.every(p => p.startsWith('docs/') || (!p.includes('/') && p.endsWith('.md')));
}

/** CI's site-shots job generates these files. Only this advance may use a narrow retry: the site build hashes
 *  their bytes, and the site test checks each referenced image, so the merged candidate must pass the site job. */
export function isShotsOnly(paths) {
  return paths.length > 0 && paths.every(p => p.startsWith('site/shots/'));
}

/** The final job-name filter for `--changed`, combining what the diff picked (`selected`, as returned by
 *  selectJobs: a string[] or null for "everything") with job names typed by hand on the command line AFTER
 *  --changed (`named`, e.g. the `mcp site` in `--changed <sha> mcp site`).
 *
 *  The bug this fixes (2026-09-27): `named` must ADD to `selected`, never replace it. A naive
 *  `selected === null ? named : [...named, ...selected]` looks right until `selected` actually is null (the
 *  fail-safe "run everything" case) -- then it returns `named` verbatim, and test-all.mjs's own
 *  "empty filter list = no narrowing" convention turns that non-empty array back into a narrowing filter, so
 *  `--changed <sha> --ui mcp site` silently ran ONLY mcp and site instead of the fail-safe everything. So:
 *  `selected === null` always returns [] (everything; test-all.mjs treats an empty filter list as "no
 *  narrowing", and everything already includes any job `named` could add), and otherwise returns the
 *  deduplicated union of the two. */
export function unionFilters(selected, named) {
  if (selected === null) return [];
  return [...new Set([...named, ...selected])];
}

/** True if `filters` (as returned by selectJobs) would run at least one UI-only job, given the full job list as
 *  {name, ui} pairs. ci.yml never runs the UI gates (app-screens, app-e2e, the mc-* e2e scripts: `webapp-mc` and
 *  `app` there only typecheck + unit-test, and `site` is not wired into CI at all), so --changed is the only
 *  thing standing between a UI regression and main unless it widens itself to --ui here. */
export function selectionIncludesUiJob(allJobs, filters) {
  return allJobs.some(j => j.ui && (filters === null || filters.some(f => j.name.includes(f))));
}

/** HEAD's parent hashes (1 for an ordinary commit, 2+ for a merge), oldest-parent-first as git reports them. */
function parentsOf(root, ref) {
  return execFileSync('git', ['log', '-1', '--format=%P', ref], { cwd: root, encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean);
}

/** The default base for `--changed` with no explicit one. `git merge-base HEAD origin/main` right after
 *  `git merge origin/main` returns origin/main's OWN tip (it is HEAD's second parent, hence an ancestor of
 *  HEAD), so the diff would omit every path the merge just brought in. If HEAD is a merge commit, use its
 *  first parent instead -- "the branch as it stood right before this merge" -- which is exactly the incoming
 *  diff a post-merge re-gate needs. Otherwise fall back to the merge-base with origin/main, as before. */
export function defaultBase(root) {
  const parents = parentsOf(root, 'HEAD');
  if (parents.length >= 2) return parents[0];
  return execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: root, encoding: 'utf8' }).trim();
}

/** Every path that differs from `base`: tracked changes (`--no-renames`, so a rename's new path is a plain
 *  add-like entry rather than a combined "R100 old -> new" line some git configs print in --name-only mode)
 *  UNION untracked files (a brand new file has no history to diff, so `git diff` alone would silently miss it). */
export function changedPaths(root, base) {
  const diff = execFileSync('git', ['diff', '--no-renames', '--name-only', base], { cwd: root, encoding: 'utf8' });
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  const all = new Set([...diff.split('\n'), ...untracked.split('\n')].map(s => s.trim()).filter(Boolean));
  return [...all].sort();
}
