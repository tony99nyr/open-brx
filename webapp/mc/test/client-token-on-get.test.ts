// OP2 (maintainability review 2026-10-10): MC answers the open GETs (`/api/state`, `/api/armory`) without headset PINs
// unless the request carries the operator token, so the console sends its token on every request, GETs included.
import { describe, expect, it } from 'vitest';
import { createHttpApi, setToken } from '../src/api/client';

describe('the console sends its operator token on GETs too', () => {
  it('GET /api/state and GET /api/armory carry the Bearer header', async () => {
    setToken('op-token');
    const seen: Record<string, string | undefined> = {};
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      seen[String(url).replace(/\?.*$/, '')] = h.authorization;
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      const api = createHttpApi();
      await api.getState().catch(() => {});
      await api.armory().catch(() => {});
    } finally { globalThis.fetch = real; setToken(''); }
    expect(seen['/api/state']).toBe('Bearer op-token');
    expect(seen['/api/armory']).toBe('Bearer op-token');
  });
});
