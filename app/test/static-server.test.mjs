import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';

test('static server serves files, aliases, and safe paths', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'brx-static-server-'));
  const root = path.join(parent, 'www');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'index.html'), 'home');
  fs.writeFileSync(path.join(root, 'app.js'), 'script');
  fs.writeFileSync(path.join(root, 'style.css'), 'style');
  fs.writeFileSync(path.join(root, 'icon.png'), 'image');
  fs.writeFileSync(path.join(root, 'fallback.bin'), 'binary');
  fs.writeFileSync(path.join(parent, 'secret.txt'), 'secret');
  fs.symlinkSync(path.join(parent, 'secret.txt'), path.join(root, 'link.txt'));
  let port, close;
  let closed = false;
  try {
    ({ port, close } = await startStaticServer(root, {
      handler: ({ pathname, res }) => {
        if (pathname !== '/health') return false;
        res.end('ok');
        return true;
      },
    }));
    const get = pathname => fetch(`http://127.0.0.1:${port}${pathname}`);
    for (const [pathname, body, type] of [
      ['/', 'home', 'text/html; charset=utf-8'],
      ['/app.js?version=1', 'script', 'text/javascript'],
      ['/style.css', 'style', 'text/css'],
      ['/icon.png', 'image', 'image/png'],
      ['/fallback.bin', 'binary', 'application/octet-stream'],
    ]) {
      const response = await get(pathname);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), type);
      assert.equal(await response.text(), body);
    }
    assert.equal((await get('/missing')).status, 404);
    const traversal = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: '/../secret.txt' }, response => {
        let body = '';
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, body }));
      }).on('error', reject);
    });
    assert.ok([403, 404].includes(traversal.status));
    assert.notEqual(traversal.body, 'secret');
    assert.equal((await get('/link.txt')).status, 403);
    assert.equal(await (await get('/health')).text(), 'ok');
    await close();
    closed = true;
    await assert.rejects(get('/'));
  } finally {
    if (close && !closed) await close();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('static server refuses traversal before reading a file', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'brx-static-path-'));
  const root = path.join(parent, 'www');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(parent, 'secret.txt'), 'secret');
  const original = http.createServer;
  let requestHandler;
  http.createServer = handler => {
    requestHandler = handler;
    return { once() {}, off() {}, listen(_port, _host, done) { done(); },
      address() { return { port: 0 }; }, close(done) { done(); } };
  };
  try {
    const { close } = await startStaticServer(root);
    const response = await new Promise(resolve => requestHandler({ url: '/../secret.txt' }, {
      statusCode: 200,
      setHeader() {},
      end(body = '') { resolve({ status: this.statusCode, body: String(body) }); },
    }));
    assert.equal(response.status, 403);
    assert.notEqual(response.body, 'secret');
    await close();
  } finally {
    http.createServer = original;
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('static server options: decodePath, contentType, headers, missingBody, host and serve from another root', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'brx-static-opts-'));
  const root = path.join(parent, 'www'), other = path.join(parent, 'other');
  fs.mkdirSync(path.join(root, 'x'), { recursive: true }); fs.mkdirSync(other);
  fs.writeFileSync(path.join(root, 'a b.txt'), 'spaced');
  fs.writeFileSync(path.join(root, 'pic.png'), 'png');
  fs.writeFileSync(path.join(other, 'page.html'), 'aliased');
  fs.writeFileSync(path.join(parent, 'secret.txt'), 'secret');
  let close;
  try {
    let port;
    ({ port, close } = await startStaticServer(root, {
      host: '127.0.0.1', decodePath: true, headers: { 'cache-control': 'no-store' },
      contentType: file => (file.endsWith('.png') ? 'image/jpeg' : 'text/plain'),   // e2e's fallback shape
      missingBody: pathname => `not found: ${pathname}`,                             // stage's 404 body
      handler: ({ pathname, serve }) => (pathname === '/alias' ? (serve('page.html', { root: other }), true) : false),
    }));
    const get = p => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: p }, r => {
        let body = ''; r.on('data', c => { body += c; });
        r.on('end', () => resolve({ status: r.statusCode, body, type: r.headers['content-type'], cache: r.headers['cache-control'] }));
      }).on('error', reject);
    });
    const spaced = await get('/a%20b.txt');
    assert.deepEqual([spaced.status, spaced.body, spaced.type, spaced.cache], [200, 'spaced', 'text/plain', 'no-store']);
    assert.equal((await get('/pic.png')).type, 'image/jpeg');
    const alias = await get('/alias');
    assert.deepEqual([alias.status, alias.body], [200, 'aliased']);
    const missing = await get('/nope');
    assert.deepEqual([missing.status, missing.body], [404, 'not found: /nope']);
    const encoded = await get('/x/%2e%2e/%2e%2e/secret.txt');   // decoded traversal is refused too
    assert.equal(encoded.status, 403);
    assert.notEqual(encoded.body, 'secret');
    assert.equal((await get('/%E0%A4%A')).status, 404);       // a malformed escape is a 404, not a thrown listener
  } finally {
    if (close) await close();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
