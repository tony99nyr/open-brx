// The land lane's records in its state folder, and how an outcome is reported (A11, the land.mjs split, stage 3).
//   - `<id>.json`: one entry's result (landed, red, conflict, withdrawn, queued).
//   - `main-red`: the last lander run on this machine that stopped because main is red on its own. Not a `.json`
//     (status lists those as results). `wait` reads it so it neither reports a stop as nothing nor starts another full
//     gate on the same red main; a new main sha makes it stale. A queued fix-main entry can also run against it.
import fs from 'node:fs';
import path from 'node:path';

/** A7 (2026-10-10 review): state another process reads (withdraw reads active-batch.json while a lander writes it)
 *  is written to a temp file and renamed, so a reader sees the old file or the new one, never a torn one. */
export function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}
/** The owner part of an entry id (`<time>-<owner>-<slug>`). */
export const ownerOf = id => id.split('-')[1] || null;
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

/** The records in `state`. `fail(message)` throws the lander's own error (land.mjs passes its LandError). */
export function createResultStore(state, { fail = message => { throw new Error(message); } } = {}) {
  const resultPath = id => path.join(state, `${id}.json`);
  const runResults = [];   // this run's results, for the summary
  const mainRedFile = path.join(state, 'main-red');

  const readResult = id => readJson(resultPath(id));
  /** Writes `r` with its owner and the time. A withdraw never replaces a final result. */
  function writeResult(r) {
    fs.mkdirSync(state, { recursive: true });
    const previous = readResult(r.id);
    if (r.status === 'withdrawn' && ['landed', 'red', 'conflict'].includes(previous?.status)) {
      fail(`${r.id} is already ${previous.status}; refusing to replace its result`);
    }
    const full = { id: r.id, owner: ownerOf(r.id), ...r, time: new Date().toISOString() };
    writeJsonAtomic(resultPath(r.id), full);
    runResults.push(full);
  }
  const readMainRed = () => readJson(mainRedFile);
  /** Records that main is red, keeping the fix-main ids already tried on this main (each gets one lander start). */
  function recordMainRed(sha, message, tried = []) {
    const prev = readMainRed();
    const fixTried = [...new Set([...(prev?.main_sha === sha ? prev.fix_tried || [] : []), ...tried])];
    fs.mkdirSync(state, { recursive: true });
    writeJsonAtomic(mainRedFile, { main_sha: sha, message, time: new Date().toISOString(), fix_tried: fixTried });
  }
  return { resultPath, readResult, writeResult, runResults, readMainRed, recordMainRed };
}

/** The lines `wait` and `status` print for a final result. `ci` is the CI run's URL, or null. */
export function reportLines(r, ci) {
  const out = [];
  if (r.fix_main) out.push(`land: fix-main: ${r.fix_main}`);
  if (r.status === 'landed') {
    out.push(`land: ${r.id} landed; main ${r.main_sha}${ci ? `\nland: CI ${ci}` : ''}`);
  } else if (r.status === 'conflict') {
    out.push(`land: ${r.id} conflicts with ${r.conflicts_with || 'main'} in: ${(r.conflict_files || []).join(', ') || '(no file list)'}; the branch is now land-failed/${r.id}`);
  } else if (r.status === 'withdrawn') {
    out.push(`land: ${r.id} withdrawn; it was removed from the queue`);
  } else {
    out.push(`land: ${r.id} is red: ${[(r.failed_jobs || []).join(', '), r.note].filter(Boolean).join('; ')}${r.log ? `\nland: log ${r.log}` : ''}; the branch is now land-failed/${r.id}`);
  }
  return out;
}
