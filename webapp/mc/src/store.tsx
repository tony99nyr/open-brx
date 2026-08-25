import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Api, FeedEntry, ModeInfo, Phase, State, WeaponView } from './api/types';
import { createHttpApi } from './api/client';
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
    );
    return un;
  }, [api]);

  const store = useMemo<Store>(() => ({
    api, state, feed, modes, weapons, view, setView: setViewRaw, selPlayer, setSelPlayer, error, mock,
    clearError: () => setError(null),
    run: async fn => { try { setError(null); return await fn(); } catch (e) { setError((e as Error).message); return undefined; } },
    serverNow: () => Date.now() + offset.current,
  }), [api, state, feed, modes, weapons, view, selPlayer, error, mock]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
