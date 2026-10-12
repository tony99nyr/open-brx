// scripts/land.mjs's command line (A11, the land.mjs split, stage 1). Pure: nothing here prints or exits; land.mjs
// turns a returned error into its exit 4 (refused).

export const USAGE = 'usage: node scripts/land.mjs submit --owner <name> [--note <text>] [--fix-main <reason>] | run [--batch N] [--dry-run] | wait <id> [--timeout-min N] | status [id] [--no-drive] | withdraw <id> --owner <name> | prune [--older-than-days N] [--dry-run] | stop   (all take [--remote origin])';
// brx1, 2026-10-10: `wait <id> --timeout 21600` ran to the 60 min default, because an unknown flag was ignored.
const FLAGS = {
  submit: ['--owner', '--note', '--fix-main'], run: ['--batch', '--dry-run'], wait: ['--timeout-min'], status: ['--no-drive'],
  withdraw: ['--owner'], prune: ['--older-than-days', '--dry-run'], stop: [],
};
const VALUED = new Set(['--owner', '--note', '--fix-main', '--remote', '--batch', '--timeout-min', '--older-than-days']);
const TEXT_VALUED = new Set(['--owner', '--note', '--fix-main', '--remote']);   // `run --batch --dryrun` must not hide the typo
const POSITIONALS = { submit: 0, run: 0, wait: 1, status: 1, withdraw: 1, prune: 0, stop: 0 };

const editDistance = (a, b) => {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
};

/** The parsed command line: `cmd`, `opt(name, dflt)`, `flag(name)`, `positional`, and `numberOpt`, which returns
 *  { value } or { error }. */
export function parseLandArgs(argv) {
  const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt; };
  const flag = name => argv.includes(name);
  /** A numeric option: `dflt` when the flag is absent, else its value, which must be a finite number above 0 (or 0
   *  with `zeroOk`), of `min` or more and at most `max` (`1e308` minutes overflowed the deadline to Infinity). A
   *  missing or bad value (`--timeout-min abc` made `wait` poll for ever) is an error, never read as the default. */
  const numberOpt = (name, dflt, min = 0, max = 1e6, zeroOk = false) => {
    const i = argv.indexOf(name);
    if (i < 0) return { value: dflt };
    const raw = i + 1 < argv.length ? argv[i + 1] : '';
    const n = raw.trim() === '' ? NaN : Number(raw);
    if (!Number.isFinite(n) || (n <= 0 && !(zeroOk && n === 0)) || n < min || n > max) {
      return { error: `${name} needs a number${min ? `, ${min} or more` : ' above 0'}, at most ${max} (got ${raw === '' ? 'nothing' : `"${raw}"`})` };
    }
    return { value: n };
  };
  const positional = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && VALUED.has(all[i - 1])));
  return { cmd: argv[0], opt, flag, numberOpt, positional };
}

/** The first reason to refuse `cmd`'s flags and ids, or null: a flag another command takes, an unknown flag (with the
 *  nearest one this command takes), or too many ids. */
export function checkFlags(argv, cmd, positional) {
  for (const [i, a] of argv.entries()) {
    if (i === 0 || TEXT_VALUED.has(argv[i - 1])) continue;   // a free-text value may start with --; a number may not
    if (!/^(-|–|—)/.test(a)) continue;   // also a single dash, or a dash a keyboard autocorrected
    const mine = [...FLAGS[cmd], '--remote'];
    if (mine.includes(a)) continue;
    const name = `--${a.replace(/^(-+|–|—)/, '').split('=')[0]}`;
    if (Object.values(FLAGS).flat().includes(name) && !mine.includes(name)) return `${cmd} does not take ${name}`;
    const near = mine.map(f => [f.startsWith(name) || name.startsWith(f) ? 0 : editDistance(name, f), f]).sort((x, y) => x[0] - y[0])[0][1];
    return `unknown flag ${a}; did you mean ${near}?`;
  }
  if (positional.length > POSITIONALS[cmd]) return `${cmd} takes ${POSITIONALS[cmd] || 'no'} id; unexpected ${positional.slice(POSITIONALS[cmd]).join(' ')}`;
  return null;
}
