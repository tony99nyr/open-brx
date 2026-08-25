import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Api, FeedEntry, ModeInfo, Phase, State, WeaponView } from './api/types';
import { createHttpApi, getToken, onAuthRequired, setToken as saveToken } from './api/client';
import { MockBackend } from './mock/backend';

export const isMock = () => import.meta.env.VITE_MOCK === '1' || import.meta.env.MODE === 'mock' || new URLSearchParams(location.search).has('mock');

export interface Store {
  api: Api;
  state: State | null;
  feed: FeedEntry[];
  modes: ModeInfo[];
  weapons: WeaponView[];
  /** the screen the operator is looking at (free navigation); `state.phase` is the server's phase */
  view: Phase;
  setView: (p: Phase) => void;
  selPlayer: string | null;
  setSelPlayer: (id: string | null) => void;
  error: string | null;
  clearError: () => void;
  /** wraps an action: surfaces errors in the telemetry strip */
  run: <T,>(fn: () => Promise<T>) => Promise<T | undefined>;
  /** server clock offset: serverNow() ≈ state.t + elapsed */
  serverNow: () => number;
  mock: boolean;
  /** /ui-ws is open (mock: always true) */
  connected: boolean;
  /** the server answered 401 — the operator token is missing or wrong */
  authRequired: boolean;
  hasToken: boolean;
  setToken: (tok: string) => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const mock = useMemo(isMock, []);
  const api = useMemo<Api>(() => (mock ? new MockBackend() : createHttpApi()), [mock]);
  const [state, setState] = useState<State | null>(null);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [modes, setModes] = useState<ModeInfo[]>([]);
  const [weapons, setWeapons] = useState<WeaponView[]>([]);
  const [view, setViewRaw] = useState<Phase>('muster');
  const [selPlayer, setSelPlayer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean>(mock);
  const [authRequired, setAuthRequired] = useState(false);
  const [tokenVersion, setTokenVersion] = useState(0);
  const followed = useRef<Phase | null>(null);
  const offset = useRef(0);

  useEffect(() => {
    api.getModes().then(setModes).catch(() => {});
    api.getWeapons().then(setWeapons).catch(() => {});
    const un = api.subscribe(
      s => {
        offset.current = s.t - Date.now();
        setState(s);
        // follow the server phase when it advances (armed → live → recap), but let the host browse freely
        if (followed.current !== s.phase) {
          followed.current = s.phase;
          setViewRaw(s.phase);
        }
      },
      e => setFeed(f => [e, ...f].slice(0, 60)),
      ok => setConnected(ok),
    );
    const unAuth = mock ? () => {} : onAuthRequired(setAuthRequired);
    return () => { un(); unAuth(); };
  }, [api, mock, tokenVersion]);

  const store = useMemo<Store>(() => ({
    api, state, feed, modes, weapons, view, setView: setViewRaw, selPlayer, setSelPlayer, error, mock,
    connected: mock ? true : connected, authRequired, hasToken: !!getToken(),
    setToken: tok => { saveToken(tok); setAuthRequired(false); setTokenVersion(v => v + 1); },
    clearError: () => setError(null),
    run: async fn => { try { setError(null); return await fn(); } catch (e) { setError((e as Error).message); return undefined; } },
    serverNow: () => Date.now() + offset.current,
  }), [api, state, feed, modes, weapons, view, selPlayer, error, mock, connected, authRequired]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
