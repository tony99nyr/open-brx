// Records every file: module a node generator loads (ESM `load` hook, runs on the hooks thread).
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let log = null;
export async function initialize(data) { log = data.log; }
export async function load(url, context, nextLoad) {
  if (log && url.startsWith('file:')) appendFileSync(log, fileURLToPath(url) + '\n');
  return nextLoad(url, context);
}
