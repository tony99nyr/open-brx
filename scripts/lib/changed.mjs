// Maps changed repo-relative paths to job-name substrings for `test:all -- --changed [base]`. A substring here
// is exactly what scripts/test-all.mjs's own `filters` matching already does: a job runs when its name INCLUDES
// one of these strings. mcp/tests/test_suite_registry.py fails if a JOBS entry's name matches none of
// JOB_NAME_SUBSTRINGS -- that job could never be picked by --changed, so it would quietly stop running once a
// branch relies on the re-gate rule in CLAUDE.md instead of the full suite.
//
// Fail safe: an unmapped path, or a path that trips a full-suite trigger, selects EVERYTHING (`filters: null`),
// never a narrower guess.

/** Every substring a rule below can add to the selection. Keep this in step with the rules themselves. */
export const JOB_NAME_SUBSTRINGS = ['app-', 'site', 'mc-', 'mcp', 'chaos'];

// Files whose change can move the *shape* of test data the phone HUD screen-truth suite (app-screens) reads,
// so a change to mcp/** that touches one of these also runs app-screens, not just mcp/chaos/mc-*.
const SCREENS_SENSITIVE = new Set([
  'mcp/brx_mcp/mc/types.py', 'mcp/brx_mcp/mc/envelope.py',
  'mcp/tools/gen_contract.py', 'mcp/tools/gen_ui_catalog.py',
]);
const isCatalogueData = p => /\/(weapons|perks)\.json$/.test(p);

const FULL_SUITE_TRIGGERS = new Set(['scripts/test-all.mjs']);
const isCiWorkflow = p => p.startsWith('.github/workflows/');

/** paths: repo-relative, forward-slash. Returns { filters, reasons }: `filters` is a string[] of job-name
 *  substrings to OR together (test-all.mjs's own `filters.some(f => name.includes(f))`), or null for
 *  "run everything". `reasons` is one line per rule that fired, for the --changed dry-run to print. */
export function selectJobs(paths) {
  if (!paths.length) return { filters: null, reasons: ['no changed paths: running everything'] };
  const trigger = paths.find(p => FULL_SUITE_TRIGGERS.has(p) || isCiWorkflow(p));
  if (trigger) return { filters: null, reasons: [`${trigger}: a full-suite trigger, running everything`] };

  const filters = new Set();
  const reasons = [];
  for (const p of paths) {
    let matched = false;
    if (p.startsWith('app/')) { filters.add('app-'); filters.add('site'); reasons.push(`${p}: app/** -> the app-* jobs, site`); matched = true; }
    if (p.startsWith('webapp/mc/')) { filters.add('mc-'); reasons.push(`${p}: webapp/mc/** -> the mc-* jobs`); matched = true; }
    if (p.startsWith('mcp/')) {
      filters.add('mcp'); filters.add('chaos'); filters.add('mc-'); matched = true;
      reasons.push(`${p}: mcp/** -> mcp, chaos, the mc-* jobs`);
      if (SCREENS_SENSITIVE.has(p) || isCatalogueData(p)) { filters.add('app-screens'); reasons.push(`${p}: contract/catalogue source -> app-screens too`); }
    }
    if (p.startsWith('docs/') || p.endsWith('.md')) { filters.add('mcp'); filters.add('site'); reasons.push(`${p}: docs/** or *.md -> mcp (docs hygiene), site`); matched = true; }
    if (p.startsWith('hardware/')) { filters.add('mcp'); reasons.push(`${p}: hardware/** -> mcp (the Stick host tests)`); matched = true; }
    // scripts/test-all.mjs itself is a full-suite trigger (above); scripts/lib/** (its scheduling/lock/--changed
    // logic) is unit tested from mcp/tests/test_test_all_*.py, so it runs inside the mcp job.
    if (p.startsWith('scripts/')) { filters.add('mcp'); reasons.push(`${p}: scripts/** -> mcp (its unit tests)`); matched = true; }
    if (!matched) return { filters: null, reasons: [`${p}: no mapping rule -- fail safe, running everything`] };
  }
  return { filters: [...filters], reasons };
}
