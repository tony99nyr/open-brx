// `node --import this.mjs gen-x.mjs --check`: logs every module loaded and every file read (to $REGEN_AUDIT_LOG).
import fs, { appendFileSync } from 'node:fs';
import { register, syncBuiltinESMExports } from 'node:module';

const log = process.env.REGEN_AUDIT_LOG;
register('./node_loader.mjs', { parentURL: import.meta.url, data: { log } });
for (const name of ['readFileSync', 'openSync']) {
  const real = fs[name];
  fs[name] = function (p, ...rest) {
    if (typeof p === 'string') appendFileSync(log, p + '\n');
    return real.call(this, p, ...rest);
  };
}
syncBuiltinESMExports();
