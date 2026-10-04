import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const keyFor = (ordinal, name) => {
  const label = name.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 80);
  const digest = createHash('sha256').update(name).digest('hex');
  return `${ordinal}-${label}-${digest}`;
};

export function claimStep(dir, ordinal, name) {
  const file = path.join(dir, `${keyFor(ordinal, name)}.claim`);
  let fd;
  try { fd = fs.openSync(file, 'wx'); }
  catch (e) { if (e.code === 'EEXIST') return false; throw e; }
  try { fs.writeFileSync(fd, JSON.stringify({ ordinal, name })); }
  finally { fs.closeSync(fd); }
  return true;
}

export function finishStep(dir, ordinal, name, outcome) {
  if (outcome !== 'pass' && outcome !== 'fail') throw new Error(`invalid step outcome: ${outcome}`);
  fs.writeFileSync(path.join(dir, `${keyFor(ordinal, name)}.${outcome}`), '', { flag: 'wx' });
}

export function summariseClaims(dir, expectedSteps = null) {
  let pass = 0, fail = 0;
  const errs = [];
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.claim'))) {
    const key = file.slice(0, -'.claim'.length);
    let name = key;
    try { name = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')).name || key; }
    catch { /* An incomplete claim is still a failed step. */ }
    const passed = fs.existsSync(path.join(dir, `${key}.pass`));
    const failed = fs.existsSync(path.join(dir, `${key}.fail`));
    if (passed && !failed) pass++;
    else { fail++; errs.push(failed ? name : `${name} (unfinished claim)`); }
  }
  if (expectedSteps !== null && pass + fail !== expectedSteps) {
    const missing = expectedSteps - pass - fail;
    errs.push(`selected ${pass + fail} steps, expected ${expectedSteps}`);
    if (missing > 0) fail += missing;
  }
  return { pass, fail, errs };
}

export function namesHash(names) {
  return createHash('sha256').update(JSON.stringify(names)).digest('hex');
}
