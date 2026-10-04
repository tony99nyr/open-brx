// The REAL HTTP client's routes, checked against the REAL server's route table.
//
// Review 2026-09-01: nothing in the suite imported `src/api/client.ts`, so it had zero
// contract-drift protection for the very route it was written to pin — rewriting `matchCsvUrl` to
// return `/api/recap.csv` (re-introducing the exact W1 bug against a real server) left the suite
// green. The screen tests all run against the MockBackend, which cannot catch a wrong URL.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
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
    ['standbyPlayer', (a: ReturnType<typeof createHttpApi>) => a.standbyPlayer('p1'), 'POST', '/api/players/p1/standby'],
    ['reinstatePlayer', (a: ReturnType<typeof createHttpApi>) => a.reinstatePlayer('p1'), 'DELETE', '/api/players/p1/standby'],
    ['getPowerups', (a: ReturnType<typeof createHttpApi>) => a.getPowerups(), 'GET', '/api/powerups'],
    ['resetStation', (a: ReturnType<typeof createHttpApi>) => a.resetStation('util-1'), 'POST', '/api/stations/util-1/reset'],
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

// STANDBY (2026-09-12): a 404 from the standby route is version skew ONLY when the ROUTE is missing.
// The handler's own 404 ("no such player" — the second tap of a double-tap) is the server's words.
// Review 2026-09-12: the first cut told the operator to RESTART a server that was fine.
describe('the standby route tells a missing route from a missing player', () => {
  const with404 = async (body: string, type: string, call: (a: ReturnType<typeof createHttpApi>) => Promise<unknown>) => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => new Response(body, { status: 404, headers: { 'content-type': type } })) as typeof fetch;
    try { await call(createHttpApi()); return ''; } catch (e) { return (e as Error).message; } finally { globalThis.fetch = real; }
  };
  it('a JSON `error` from the handler surfaces as the server\'s own words', async () => {
    expect(await with404('{"error":"no such player"}', 'application/json', a => a.standbyPlayer('p1'))).toBe('no such player');
    expect(await with404('{"error":"no such player on standby"}', 'application/json', a => a.reinstatePlayer('p1'))).toBe('no such player on standby');
  });
  it('a bare 404 (no route on an older MC) surfaces the skew text, with the restart command', async () => {
    // F221 (2026-09-25): the shared MC_OLDER words, not a screen-specific paraphrase.
    const msg = await with404('Not Found', 'text/plain', a => a.standbyPlayer('p1'));
    expect(msg).toMatch(/OLDER THAN THIS CONSOLE/);
    expect(msg).toMatch(/start\.sh/);
    expect(await with404('Not Found', 'text/plain', a => a.reinstatePlayer('p1'))).toMatch(/OLDER THAN THIS CONSOLE/);
  });
});

// "Report a problem" — `/api/report` never legitimately answers 404/405 of its own accord (unlike
// standby's per-player 404 above), so both statuses are read as version skew unconditionally.
describe('makeReport posts to /api/report and reads version skew plainly', () => {
  const withStatus = async (status: number, body = 'Not Found') => {
    const real = globalThis.fetch;
    const seen: { url: string; method: string }[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url: String(url), method: (init?.method ?? 'GET').toUpperCase() });
      return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
    }) as typeof fetch;
    try { await createHttpApi().makeReport(); return { msg: '', seen }; }
    catch (e) { return { msg: (e as Error).message, seen }; }
    finally { globalThis.fetch = real; }
  };

  it('POSTs /api/report', async () => {
    const real = globalThis.fetch;
    const seen: { url: string; method: string }[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url: String(url), method: (init?.method ?? 'GET').toUpperCase() });
      return new Response('{"file":"a.zip","download":"/api/report/a.zip","issue_url":"x","summary":{},"removed":{},"too_large":false}',
        { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    let r; try { r = await createHttpApi().makeReport(); } finally { globalThis.fetch = real; }
    expect(seen).toEqual([{ url: '/api/report', method: 'POST' }]);
    expect(r).toEqual({ file: 'a.zip', download: '/api/report/a.zip', issue_url: 'x', summary: {}, removed: {}, too_large: false });
  });

  it('a 404 (route missing) shows the old-server message, with the fix', async () => {
    // F221 round 2: one fact, one sentence — MC_OLDER's own words (`olderServer()`), not a paraphrase.
    const { msg } = await withStatus(404);
    expect(msg).toBe('MC SERVER IS OLDER THAN THIS CONSOLE: RESTART MC (./start.sh)');
  });

  it('a 405 (route exists for another method: e.g. GET) shows the same message', async () => {
    const { msg } = await withStatus(405);
    expect(msg).toBe('MC SERVER IS OLDER THAN THIS CONSOLE: RESTART MC (./start.sh)');
  });

  it('a 500 with the server\'s own words is never overridden by the skew message', async () => {
    const { msg } = await withStatus(500, '{"error":"disk full — could not write the report"}');
    expect(msg).toBe('disk full — could not write the report');
  });
});


// A56 (powerups): the two new routes (also in the route-table list above), and the reset route's 404 rule.
describe('A56 powerup routes', () => {
  const call = async (status: number, body: string, type: string, fn: (a: ReturnType<typeof createHttpApi>) => Promise<unknown>) => {
    const seen: { url: string; method: string }[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url: String(url), method: (init?.method ?? 'GET').toUpperCase() });
      return new Response(body, { status, headers: { 'content-type': type } });
    }) as typeof fetch;
    try { await fn(createHttpApi()); return { seen, err: '' }; } catch (e) { return { seen, err: (e as Error).message }; } finally { globalThis.fetch = real; }
  };
  it('getPowerups is GET /api/powerups; resetStation is POST /api/stations/{id}/reset', async () => {
    expect((await call(200, '{"enabled":true,"presets":[]}', 'application/json', a => a.getPowerups())).seen).toEqual([{ url: '/api/powerups', method: 'GET' }]);
    expect((await call(200, '{"ok":true}', 'application/json', a => a.resetStation('util a'))).seen).toEqual([{ url: '/api/stations/util%20a/reset', method: 'POST' }]);
  });
  it('a bare 404 on reset is an older MC; the handler\'s own 404 is its words', async () => {
    // F221 (2026-09-25): the shared MC_OLDER words, not a screen-specific paraphrase.
    expect((await call(404, 'Not Found', 'text/plain', a => a.resetStation('u1'))).err).toMatch(/OLDER THAN THIS CONSOLE/);
    expect((await call(404, '{"error":"no such station"}', 'application/json', a => a.resetStation('u1'))).err).toBe('no such station');
  });
});

// Review MEDIUM (brx1, 222b1a81): PUT /api/pieces/:id (a picked piece's value change that fails to
// compose) refuses 400 with `{errors: [...]}`, no singular `error` field at all -- `j()` used to fall
// through to `r.statusText` ("Bad Request") for exactly this shape, losing the server's own words.
// Build.tsx's SAVE (the one caller that reads this) must show them in the error strip.
describe('a 400 carrying only `errors` (no `error`) surfaces the server\'s own words, not "Bad Request"', () => {
  const call400 = async (body: string, statusText = 'Bad Request') => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => new Response(body, { status: 400, statusText, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    try { await createHttpApi().updatePiece('p1', { value: { fixed_id: 'assault_rifle' } }); return ''; }
    catch (e) { return (e as Error).message; }
    finally { globalThis.fetch = real; }
  };
  it('joins the errors array with " · ", the same separator the console uses elsewhere', async () => {
    expect(await call400('{"errors":["NAMES FORCE RIFLE, WHICH IS NO LONGER OFFERED: PICK A DIFFERENT WEAPON OR PERK"]}'))
      .toBe('NAMES FORCE RIFLE, WHICH IS NO LONGER OFFERED: PICK A DIFFERENT WEAPON OR PERK');
    expect(await call400('{"errors":["FIRST REASON","SECOND REASON"]}')).toBe('FIRST REASON · SECOND REASON');
  });
  it('an `error` field, when present, still wins over `errors`', async () => {
    expect(await call400('{"error":"THE SINGULAR REASON","errors":["A DIFFERENT REASON"]}')).toBe('THE SINGULAR REASON');
  });
  it('neither field present: falls back to the status line, as before', async () => {
    expect(await call400('{}')).toBe('Bad Request');
  });
});

// O15 (maintainability review 2026-10-03): the REST helper had no timeout, so a stalled MC left a control busy for ever.
describe('a request to a stalled MC gives up with a clear error', () => {
  it('passes an abort signal and words the timeout as WHAT: WHAT TO DO', async () => {
    const real = globalThis.fetch;
    let signal: AbortSignal | undefined;
    globalThis.fetch = ((_u: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise((_res, rej) => {
        signal?.addEventListener('abort', () => rej(signal!.reason));
      });
    }) as typeof fetch;
    const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      const c = new AbortController();
      setTimeout(() => c.abort(new DOMException('timed out', 'TimeoutError')), 5);
      (c.signal as AbortSignal & { ms?: number }).ms = ms;
      return c.signal;
    });
    try {
      await expect(createHttpApi().setPhase('lobby')).rejects.toThrow(/^MC DID NOT ANSWER IN 15 S: /);
      expect(spy).toHaveBeenCalledWith(15000);
      expect(signal).toBeTruthy();
    } finally { globalThis.fetch = real; spy.mockRestore(); }
  });
});

describe('slow routes get their own timeout budget', () => {
  it('the scan waits its duration plus three 10 s lock waits; the report waits two minutes; the rest 15 s', async () => {
    const { REQUEST_TIMEOUT_MS, REPORT_TIMEOUT_MS, scanTimeoutMs } = await import('../src/api/client');
    expect(scanTimeoutMs(6)).toBe(41000);
    expect(scanTimeoutMs(30)).toBe(65000);
    expect(REPORT_TIMEOUT_MS).toBe(120000);
    const real = globalThis.fetch;
    const seen: number[] = [];
    const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => { seen.push(ms); return new AbortController().signal; });
    globalThis.fetch = (async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    try {
      const api = createHttpApi();
      await api.scan(6); await api.makeReport(); await api.setPhase('lobby');
    } finally { globalThis.fetch = real; spy.mockRestore(); }
    expect(seen).toEqual([41000, REPORT_TIMEOUT_MS, REQUEST_TIMEOUT_MS]);
  });
});
