import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PORT = { http: '80', https: '443', ssh: '22', git: '9418' };

/** One key for each remote, regardless of its transport spelling. */
export function remoteKey(remote) {
  if (path.isAbsolute(remote) || remote.startsWith('file://'))
    return fs.realpathSync(remote.startsWith('file://') ? fileURLToPath(remote) : remote);

  let host, port = '', name;
  if (remote.includes('://')) {
    const url = new URL(remote);
    host = url.hostname.toLowerCase();
    port = url.port === DEFAULT_PORT[url.protocol.slice(0, -1)] ? '' : url.port;
    name = url.pathname;
  } else {
    const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(remote);
    if (!scp) throw new Error(`unsupported remote URL: ${remote}`);
    [, host, name] = scp;
    host = host.toLowerCase();
  }
  name = name.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
  return `${host}${port ? `:${port}` : ''}/${name}`;
}
