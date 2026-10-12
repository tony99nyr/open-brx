// scripts/test-all.mjs's command line and its --changed plan (A10, the test-all split, stage 1). Pure: the runner
// passes in argv, the job list and a log function; nothing here reads the process or exits it.
import { selectionIncludesUiJob, selectJobs, unionFilters } from './changed.mjs';
import { selectFiltered } from './jobs.mjs';

/** The flags. --changed [base]: the base, if given, is the token RIGHT AFTER --changed (`--changed abc123`, not
 *  `abc123 --changed`), and must not itself look like a flag (so `--changed --list` still means "default base").
 *  Every other token that is not a flag is a job-name filter. */
export function parseArgs(argv) {
  const changedIdx = argv.indexOf('--changed');
  const changed = changedIdx >= 0;
  const changedBase = changed && changedIdx + 1 < argv.length && !argv[changedIdx + 1].startsWith('--') ? argv[changedIdx + 1] : null;
  return {
    ui: argv.includes('--ui'),   // --changed may force this on (planChanged: a UI job in the selection)
    list: argv.includes('--list'),
    cache: argv.includes('--cache') && !argv.includes('--no-cache'),
    changed, changedBase,
    filters: argv.filter((a, i) => !a.startsWith('--') && !(changed && changedBase !== null && i === changedIdx + 1)),
  };
}

/** `--changed`: maps the changed `paths` to a job-name filter, the same mechanism as `test:all -- mcp app`, and fails
 *  safe (CLAUDE.md's re-gate rule): an unmapped path, or one of changed.mjs's full-suite triggers, runs everything.
 *  `named` (job names typed on the command line) ADD to the pick, never replace it (the 2026-09-27 trap: `--changed
 *  <sha> --ui mcp site` used to narrow a fail-safe "run everything" down to mcp and site). ci.yml never runs the UI
 *  gates, so a selection with one turns --ui on. Logs the reasons and the final selection before any job starts, so a
 *  mistyped or forgotten job name shows up then. Returns { filters, ui }. */
export function planChanged({ base, paths, named, ui, allJobs, log }) {
  const { filters: selected, reasons } = selectJobs(paths);
  log(`test-all: --changed vs ${base}: ${paths.length} path(s) changed`);
  for (const r of reasons) log(`  ${r}`);
  log(selected === null ? 'test-all: --changed selected: everything' : `test-all: --changed selected jobs matching: ${selected.join(', ')}`);
  if (named.length) log(`test-all: also named on the command line: ${named.join(', ')} (adds to the --changed pick, never replaces it)`);
  const filters = unionFilters(selected, named);
  if (!ui && selectionIncludesUiJob(allJobs.map(j => ({ name: j.name, ui: !!j.ui })), selected)) {
    ui = true;
    log('test-all: --changed selected a UI-only job; adding --ui (ci.yml does not run those)');
  }
  const finalPreview = selectFiltered(allJobs, ui, filters);
  log(`test-all: final selection (${finalPreview.length} job(s)):`);
  for (const j of finalPreview) {
    const why = [];
    if (selected === null) why.push('everything (fail-safe)');
    else {
      if (selected.some(f => j.name.includes(f))) why.push('from the diff');
      if (named.some(f => j.name.includes(f))) why.push('named on the command line');
    }
    log(`  ${j.name}: ${why.join(', ') || '(no reason recorded)'}`);
  }
  return { filters, ui };
}
