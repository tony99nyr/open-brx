// Mount one MC screen against a fixture, with no server and no browser automation.
//
// W5, handoff-post-first-match: `webapp/mc` had `build` and `lint` and no `test`. Every MC UI
// regression of the 2026-08-30 field session — the black ARSENAL page, the countdown reset on tab
// switch, the RECAP history refetch storm — was found by a human or a reviewer looking at a screen.
// These are the cheap half of that: does each screen RENDER, and does it render the right numbers,
// against both a full fixture and a starved one. The expensive half (real widgets, a real server,
// two phones) stays in `app/tools/e2e.mjs` — this does not replace it, it catches the crashes long
// before that suite is worth starting.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { StoreCtx, type Store, type View } from '../src/store';
import { MockBackend } from '../src/mock/backend';
import type { Api, PerkView, State, WeaponView } from '../src/api/types';

/** The pieces a screen reads. Anything omitted comes from the mock backend's own demo session. */
export interface Fixture {
  state?: State | null;
  weapons?: WeaponView[];
  perks?: PerkView[];
  view?: View;
  api?: Partial<Api>;
  selPlayer?: string | null;
}

/** A live MockBackend plus the state/catalogs it starts with — the closest thing to a real server. */
export async function demo() {
  const api = new MockBackend();
  return { api, state: await api.getState(), weapons: await api.getWeapons(), perks: await api.getPerks() };
}

/** An `Api` backed by a real MockBackend, with the fixture's overrides in front of it.
 *
 *  A hand-written stub goes stale the moment a screen calls a new route — and it goes stale
 *  SILENTLY, as "api.getPresets is not a function" thrown inside an effect. Deferring to the mock
 *  means a new route is implemented once, in the mock the ?mock demo already uses. */
export function fixtureApi(overrides: Partial<Api> = {}, backend: Api = new MockBackend()): Api {
  return new Proxy(backend as unknown as Record<string, unknown>, {
    get(target, prop: string) {
      if (prop in overrides) return (overrides as Record<string, unknown>)[prop];
      const v = target[prop];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  }) as unknown as Api;
}

export function makeStore(f: Fixture, base?: Partial<Store>): Store {
  return {
    api: fixtureApi(f.api ?? {}),
    state: f.state ?? null, feed: [], modes: [], weapons: f.weapons ?? [], perks: f.perks ?? [],
    view: f.view ?? 'muster', setView: () => {}, designerSeed: null, openDesigner: () => {},
    selPlayer: f.selPlayer ?? null, setSelPlayer: () => {}, error: null, clearError: () => {},
    run: async fn => { try { return await fn(); } catch { return undefined; } },
    serverNow: () => Date.now(), mock: true, connected: true, authRequired: false, serverOld: false,
    hasToken: true, setToken: () => {}, ...base,
  } as Store;
}

/** Wrap an api method so a test can count how often a screen reaches for it. */
export function counted<T>(name: keyof Api, impl: () => Promise<T>) {
  const calls = { n: 0 };
  const api = { [name]: async () => { calls.n++; return impl(); } } as unknown as Partial<Api>;
  return { api, calls };
}

export interface Mounted {
  el: HTMLElement;
  root: Root;
  text(): string;
  /** re-render with a different store (a snapshot arriving, a phase change) */
  update(next: ReactNode): Promise<void>;
  click(match: string | RegExp): Promise<void>;
  find(sel: string): HTMLElement[];
  unmount(): void;
}

/** Render `node` into a detached document and settle every effect. Throws whatever the tree throws —
 *  there is no error boundary here on purpose: a screen that crashes must fail the test, not render
 *  a tidy "CONSOLE ERROR" box the way the shipped App does. */
export async function mount(node: ReactNode): Promise<Mounted> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(node); });
  const m: Mounted = {
    el, root,
    text: () => el.textContent ?? '',
    update: async next => { await act(async () => { root.render(next); }); },
    find: sel => Array.from(el.querySelectorAll(sel)) as HTMLElement[],
    click: async match => {
      // `th` is in here because the ARSENAL sorts by clicking a column header, not a button
      const hit = (Array.from(el.querySelectorAll('button, a, th, [role="button"]')) as HTMLElement[]).find(b => {
        const t = (b.textContent ?? '').trim();
        return typeof match === 'string' ? t.includes(match) : match.test(t);
      });
      if (!hit) throw new Error(`no clickable matching ${match} — saw: ${
        Array.from(el.querySelectorAll('button, a, th, [role="button"]'))
          .map(b => (b.textContent ?? '').trim().slice(0, 24)).join(' | ')}`);
      await act(async () => { hit.click(); });
    },
    unmount: () => { act(() => { root.unmount(); }); el.remove(); },
  };
  return m;
}

/** Mount a screen inside a fixture store. */
export async function mountScreen(screen: ReactNode, f: Fixture): Promise<Mounted & { store: Store }> {
  const store = makeStore(f);
  const m = await mount(<StoreCtx.Provider value={store}>{screen}</StoreCtx.Provider>);
  return Object.assign(m, { store });
}

/** A State stripped to the bone: every list empty, every optional absent. What the console looks
 *  like against a server that has just booted, and the shape that produced the black ARSENAL page. */
export function starved(base: State): State {
  return {
    ...base,
    nodes: [], players: [], teams: [],
    readiness: { ...base.readiness, board: [], unclaimed: [], go: false },
    kit: { kitted: 0, total: 0, trying: {}, browsing: {} },
    loadout_pool: { primary: [], secondary_weapons: [], perks: [] },
    lobby: { ready: 0, total: 0, pushed: false, acks: {} },
    start: undefined, live: undefined, recap: undefined,
    config_errors: [], config_warnings: [],
  };
}
