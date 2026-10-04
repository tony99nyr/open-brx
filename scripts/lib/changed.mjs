// Maps changed repo-relative paths to job-name substrings for `test:all -- --changed [base]`. A substring here
// is exactly what scripts/test-all.mjs's own `filters` matching already does: a job runs when its name INCLUDES
// one of these strings. mcp/tests/test_suite_registry.py fails if a JOBS entry's name matches none of
// JOB_NAME_SUBSTRINGS -- that job could never be picked by --changed, so it would quietly stop running once a
// branch relies on the re-gate rule in CLAUDE.md instead of the full suite.
//
// Fail safe: a known tree with no path rule or a full-suite trigger selects EVERYTHING (`filters: null`).
// Unknown directories select mcp because docs hygiene scans every tracked and unignored repository file.
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
import { execFileSync } from 'node:child_process';

/** Every substring a rule below can add to the selection. Keep this in step with the rules themselves. */
export const JOB_NAME_SUBSTRINGS = ['app-', 'site', 'mc-', 'mc-vitest', 'mcp', 'chaos'];

// Files whose change can move the *shape* of test data the phone HUD screen-truth suite (app-screens) reads,
// so a change to mcp/** that touches one of these also runs app-screens, not just mcp/chaos/mc-*/site.
const SCREENS_SENSITIVE = new Set([
  'mcp/brx_mcp/mc/golden_bundle.json',
  'mcp/brx_mcp/mc/types.py', 'mcp/brx_mcp/mc/envelope.py',
  'mcp/tools/gen_contract.py', 'mcp/tools/gen_ui_catalog.py',
]);
const isCatalogueData = p => /\/(weapons|perks)\.json$/.test(p);

// Root package metadata controls the test command, and the root lockfile can change installed job tools.
const FULL_SUITE_TRIGGERS = new Set(['scripts/test-all.mjs', 'scripts/lib/budget.mjs', 'scripts/lib/lock.mjs', 'package.json', 'pnpm-lock.yaml']);
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
    let matched = false;
    if (p.startsWith('app/')) {
      filters.add('app-'); filters.add('site'); filters.add('mc-vitest'); filters.add('mcp'); matched = true;
      reasons.push(`${p}: app/** -> app-*, site (embeds the HUD demo), mc-vitest (medalicons-gen.test.ts reads app/src/hud/medalicons.js), mcp (its tests read app/)`);
    }
    if (p.startsWith('webapp/mc/')) {
      filters.add('mc-'); filters.add('mcp'); filters.add('site'); filters.add('app-e2e'); matched = true;
      reasons.push(`${p}: webapp/mc/** -> the mc-* jobs, app-e2e (serves webapp/mc/dist), mcp (its tests read webapp/mc/), site (facts.mjs reads webapp/mc/src/tokens.ts)`);
    }
    if (p.startsWith('mcp/')) {
      filters.add('mcp'); filters.add('chaos'); filters.add('mc-'); filters.add('site');
      filters.add('app-e2e'); filters.add('app-logsync'); filters.add('app-test'); matched = true;
      reasons.push(`${p}: mcp/** -> mcp, chaos, mc-*, app-e2e, app-logsync, app-test, site (the jobs read MC code or data)`);
      if (SCREENS_SENSITIVE.has(p) || isCatalogueData(p)) {
        filters.add('app-screens');
        reasons.push(`${p}: contract/catalogue source -> app-screens too`);
        if (p === 'mcp/brx_mcp/mc/golden_bundle.json') { filters.add('app-moments'); reasons.push(`${p}: bundled demo source -> app-moments too`); }
      }
    }
    if (p.startsWith('docs/') || p.endsWith('.md')) {
      filters.add('mcp'); filters.add('site'); matched = true;
      reasons.push(`${p}: docs/** or *.md -> mcp (docs hygiene) and site (renders docs/platform and docs/manual)`);
      if (p === 'docs/announcer.md') { filters.add('app-test'); reasons.push(`${p}: app/test/announcer.test.mjs reads this file -> app-test`); }
    }
    if (p.startsWith('protocol/')) { filters.add('mcp'); matched = true; reasons.push(`${p}: protocol/** -> mcp (docs hygiene)`); }
    if (p.startsWith('hardware/')) { filters.add('mcp'); reasons.push(`${p}: hardware/** -> mcp (the Stick host tests)`); matched = true; }
    // scripts/test-all.mjs itself is a full-suite trigger (above); scripts/lib/** (its scheduling/lock/--changed
    // logic) is unit tested from mcp/tests/test_test_all_*.py, so it runs inside the mcp job.
    if (p.startsWith('scripts/')) { filters.add('mcp'); reasons.push(`${p}: scripts/** -> mcp (its unit tests)`); matched = true; }
    if (p.startsWith('.claude/')) { filters.add('mcp'); reasons.push(`${p}: .claude/** -> mcp (docs hygiene)`); matched = true; }
    if (p.startsWith('.github/')) { filters.add('mcp'); reasons.push(`${p}: .github/** -> mcp (docs hygiene)`); matched = true; }
    if (!matched && !p.includes('/')) { filters.add('mcp'); reasons.push(`${p}: root file -> mcp (docs hygiene)`); matched = true; }
    if (!matched) {
      const top = p.split('/')[0];
      if (!KNOWN_TOP_LEVEL.has(top)) {
        filters.add('mcp');
        reasons.push(`${top}/: unknown top-level directory -> mcp (the docs hygiene guards scan the whole repo)`);
        matched = true;
        continue;
      }
      return { filters: null, reasons: [`${p}: known tree has no mapping rule -- fail safe, running everything`] };
    }
  }
  return { filters: [...filters], reasons };
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
