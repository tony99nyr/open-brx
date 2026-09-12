// The REAL HTTP client's routes, checked against the REAL server's route table.
//
// Review 2026-09-01: nothing in the suite imported `src/api/client.ts`, so it had zero
// contract-drift protection for the very route it was written to pin — rewriting `matchCsvUrl` to
// return `/api/recap.csv` (re-introducing the exact W1 bug against a real server) left the suite
// green. The screen tests all run against the MockBackend, which cannot catch a wrong URL.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHttpApi } from '../src/api/client';

const API = createHttpApi();

/** Every path Starlette is asked to route, straight out of the server. */
function serverRoutes(): string[] {
  // vitest's cwd is webapp/mc; `import.meta.url` is a vite virtual URL here, not a file:// one
  const src = readFileSync(resolve(process.cwd(), '../../mcp/brx_mcp/mc/api.py'), 'utf8');
  return [...src.matchAll(/Route\("([^"]+)"/g)].map(m => m[1]);
}

/** `/api/matches/{mid}.csv` → a regex that matches a concrete URL for it. */
function routeMatcher(route: string): RegExp {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\\\{[^}]+\\\}/g, '[^/]+')}$`);
}

describe('the client only calls routes the server actually serves', () => {
  const routes = serverRoutes();

  it('the server route table parsed', () => {
    expect(routes).toContain('/api/state');
    expect(routes.length).toBeGreaterThan(20);
  });

  it.each([
    ['recapCsvUrl', API.recapCsvUrl()],
    ['matchCsvUrl', API.matchCsvUrl('m7')],
    ['matchCsvUrl · id needing escaping', API.matchCsvUrl('m 7/../etc')],
  ])('%s → a real route', (_name, url) => {
    const path = url.split('?')[0];
    expect(routes.some(r => routeMatcher(r).test(path)), `${path} matches no Route() in api.py`).toBe(true);
  });

  // A25/A27 (2026-09-12): the methods that FETCH rather than return a URL had no drift protection at
  // all — `matchCsvUrl` was pinned because it returns a string, and everything else was invisible.
  // Calling them against a stubbed fetch pins the path AND the method the same way.
  it.each([
    ['getOptions', (a: ReturnType<typeof createHttpApi>) => a.getOptions(), 'GET', '/api/options'],
    ['setOptions', (a: ReturnType<typeof createHttpApi>) => a.setOptions({ log_sync: 'manual' }), 'PUT', '/api/options'],
    ['pullLog', (a: ReturnType<typeof createHttpApi>) => a.pullLog('node-1'), 'POST', '/api/nodes/node-1/pull_log'],
    ['setPhase', (a: ReturnType<typeof createHttpApi>) => a.setPhase('lobby', true), 'POST', '/api/phase'],
  ])('%s calls %s %s, and it is a real route', async (_name, call, method, path) => {
    const seen: { url: string; method: string; body?: string }[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url: String(url), method: (init?.method ?? 'GET').toUpperCase(), body: init?.body as string });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try { await call(createHttpApi()); } finally { globalThis.fetch = real; }
    expect(seen.length).toBe(1);
    expect(seen[0].url).toBe(path);
    expect(seen[0].method).toBe(method);
    expect(routes.some(r => routeMatcher(r).test(path)), `${path} matches no Route() in api.py`).toBe(true);
  });

  it('setPhase sends `force` only when it is asked for', async () => {
    const bodies: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (_u: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''));
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      const api = createHttpApi();
      await api.setPhase('lobby');
      await api.setPhase('lobby', true);
    } finally { globalThis.fetch = real; }
    expect(JSON.parse(bodies[0])).toEqual({ phase: 'lobby' });        // no `force` key at all
    expect(JSON.parse(bodies[1])).toEqual({ phase: 'lobby', force: true });
  });

  it('matchCsvUrl targets the ARCHIVED route, not the live scorer', () => {
    // the W1 bug in one line: these two must never be the same URL
    expect(API.matchCsvUrl('m7')).toBe('/api/matches/m7.csv');
    expect(API.matchCsvUrl('m7')).not.toBe(API.recapCsvUrl());
  });

  it('escapes a match id so it cannot climb out of its route', () => {
    // ids are server-generated, but a URL builder that lets one through would be a path traversal
    const url = API.matchCsvUrl('../recap');
    expect(url).toBe('/api/matches/..%2Frecap.csv');
    expect(url.split('/').length).toBe(4);   // '', 'api', 'matches', '..%2Frecap.csv'
  });
});
