import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

export const STATIC_TYPES = {
  '.js': 'text/javascript', '.html': 'text/html; charset=utf-8', '.json': 'application/json',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2',
};

/** Serve files from root. A handler can serve an alias first and return true. `host` defaults to every interface, as the
 *  interactive tools (stage, rig, scenarios, shots) and e2e's HUD always listened; screens and the galleries pass 127.0.0.1. */
export async function startStaticServer(root, { port = 0, host, types = STATIC_TYPES,
  defaultType = 'application/octet-stream', contentType, decodePath = false,
  missingBody = '', headers = {}, handler } = {}) {
  const server = http.createServer((req, res) => {
    const raw = (req.url || '/').split('?')[0];
    let pathname;
    try { pathname = decodePath ? decodeURIComponent(raw) : raw; }
    catch { res.statusCode = 404; res.end(); return; }
    const serve = (relative, { root: fileRoot = root } = {}) => {
      const base = path.resolve(fileRoot);
      const file = path.resolve(base, relative.replace(/^\/+/, ''));
      const within = (boundary, candidate) => {
        const rel = path.relative(boundary, candidate);
        return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
      };
      if (!within(base, file)) { res.statusCode = 403; res.end(); return; }
      try {
        if (!within(fs.realpathSync(base), fs.realpathSync(file))) { res.statusCode = 403; res.end(); return; }
        const bytes = fs.readFileSync(file);
        res.setHeader('content-type', contentType ? contentType(file) : types[path.extname(file)] || defaultType);
        for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
        res.end(bytes);
      } catch {
        res.statusCode = 404;
        res.end(typeof missingBody === 'function' ? missingBody(pathname) : missingBody);
      }
    };
    if (handler?.({ req, res, pathname, serve })) return;
    serve(pathname === '/' ? 'index.html' : pathname);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(); });
  });
  return { server, port: server.address().port, close: () => new Promise((resolve, reject) =>
    server.close(error => error ? reject(error) : resolve())) };
}
