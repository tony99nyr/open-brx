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
