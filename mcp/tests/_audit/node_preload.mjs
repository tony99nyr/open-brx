// `node --import this.mjs gen-x.mjs --check`: logs every module loaded and every file read (to $REGEN_AUDIT_LOG).
// Hooks: readFileSync, openSync, readFile, open, createReadStream, fs.promises.readFile/open (string, Buffer or file:
// URL paths). A node child process inherits this file through NODE_OPTIONS, so its reads are logged too. A child that
// is not node (python, git) cannot be audited here; scripts/generated.json says so.
import fs, { appendFileSync } from 'node:fs';
import { register, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';

const log = process.env.REGEN_AUDIT_LOG;
register('./node_loader.mjs', { parentURL: import.meta.url, data: { log } });

const asPath = p => {
  if (typeof p === 'string') return p;
  if (Buffer.isBuffer(p)) return p.toString();
  if (p instanceof URL) return p.protocol === 'file:' ? fileURLToPath(p) : null;
  return null;   // a file descriptor
};
const note = p => { const s = asPath(p); if (s && log) appendFileSync(log, s + '\n'); };
const wrap = (target, name) => {
  const real = target[name];
  target[name] = function (p, ...rest) { note(p); return real.call(this, p, ...rest); };
};
for (const name of ['readFileSync', 'openSync', 'readFile', 'open', 'createReadStream']) wrap(fs, name);
for (const name of ['readFile', 'open']) wrap(fs.promises, name);
syncBuiltinESMExports();

// node children: the same preload, the same log
const flag = `--import ${import.meta.url}`;
if (!(process.env.NODE_OPTIONS || '').includes(flag)) process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} ${flag}`.trim();
