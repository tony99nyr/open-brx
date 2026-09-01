import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Api, FeedEntry, ModeInfo, PerkView, Phase, SavedGame, State, WeaponView } from './api/types';

/** UI views = server phases + the game DESIGNER (authoring, not a phase — loadout.md §5). */
export type View = Phase | 'designer' | 'catalog';

// Tony 2026-08-31: "each tab of the MC should put state in the URL so you can refresh the page."
// The view lives in the hash (the operator token is picked out of the same hash and stripped, see
// client.ts). Whitelisted on the way in so a hand-typed hash can never select a view that does not
// exist — that is what blanked the console when a non-phase view reached the phase-indexed label.
const VIEWS: View[] = ['muster', 'build', 'designer', 'kit', 'lobby', 'armed', 'live', 'recap', 'catalog'];
function viewFromHash(): View | null {
  try {
    const h = decodeURIComponent(location.hash.replace(/^#/, '')).split('&')[0].trim();
    return (VIEWS as string[]).includes(h) ? (h as View) : null;
  } catch { return null; }
}
function writeHash(v: View) {
  try {
    if (viewFromHash() === v) return;
    history.replaceState(null, '', location.pathname + location.search + '#' + v);
  } catch { /* no history: the view still works, it just will not survive a refresh */ }
}
/** what the designer opens with: an existing saved game to edit, a stock mode to customise, or the live draft */
export type DesignerSeed = { game?: SavedGame; mode?: string; fromLive?: boolean; copy?: boolean /* open as an unsaved draft named after `game` */ };
import { createHttpApi, getToken, onAuthRequired, setToken as saveToken } from './api/client';
import { MockBackend } from './mock/backend';

export const isMock = () => import.meta.env.VITE_MOCK === '1' || import.meta.env.MODE === 'mock' || new URLSearchParams(location.search).has('mock');

export interface Store {
  api: Api;
  state: State | null;
  feed: FeedEntry[];
  modes: ModeInfo[];
  weapons: WeaponView[];
  perks: PerkView[];
  /** the screen the operator is looking at (free navigation); `state.phase` is the server's phase */
  view: View;
  setView: (p: View) => void;
  designerSeed: DesignerSeed | null;
  openDesigner: (seed: DesignerSeed) => void;
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
  /** the MC process predates this UI: an A10 route (/api/perks, /api/presets) is missing — restart the server */
  serverOld: boolean;
  hasToken: boolean;
  setToken: (tok: string) => void;
}

// Exported for the test suite ONLY (test/harness.tsx): a screen can then be mounted against a
// fixture without a server, which is how the console gets checked screen by screen. Production code
// goes through `StoreProvider`/`useStore` — nothing else should reach for this.
export const StoreCtx = createContext<Store | null>(null);
const Ctx = StoreCtx;

export function StoreProvider({ children }: { children: ReactNode }) {
  const mock = useMemo(isMock, []);
  const api = useMemo<Api>(() => (mock ? new MockBackend() : createHttpApi()), [mock]);
  const [state, setState] = useState<State | null>(null);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [modes, setModes] = useState<ModeInfo[]>([]);
  const [weapons, setWeapons] = useState<WeaponView[]>([]);
  const [perks, setPerks] = useState<PerkView[]>([]);
  const [view, setViewRaw] = useState<View>(() => viewFromHash() ?? 'muster');
  const setView = useCallback((v: View) => { writeHash(v); setViewRaw(v); }, []);
  // back/forward and a hand-edited hash both move the console
  useEffect(() => {
    const onHash = () => { const v = viewFromHash(); if (v) setViewRaw(v); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const [designerSeed, setDesignerSeed] = useState<DesignerSeed | null>(null);
  const [selPlayer, setSelPlayer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean>(mock);
  const [authRequired, setAuthRequired] = useState(false);
  const [tokenVersion, setTokenVersion] = useState(0);
  const [serverOld, setServerOld] = useState(false);
  const followed = useRef<Phase | null>(null);
  // The event feed is streamed and appended client-side, and nothing ever cleared it — so a second
  // match's events piled on top of the first's, producing a feed with two FIRST BLOODs and
  // non-monotonic clocks (`t_match_s` is relative to each match's own start). Field 2026-09-01.
  const feedMatch = useRef<string | null>(null);
  // A view restored from the URL must not be stomped by the first server snapshot. The follow rule is
  // "move when the phase ADVANCES"; on a refresh there has been no advance yet, so the first snapshot
  // only seeds the baseline. Without this every reload bounced straight back to the phase screen.
  const urlView = useRef<boolean>(viewFromHash() != null);
  const offset = useRef(0);

  useEffect(() => {
    api.getModes().then(setModes).catch(() => {});
    api.getWeapons().then(setWeapons).catch(() => {});
    api.getPerks().then(setPerks).catch(e => { if ((e as { status?: number }).status === 404) setServerOld(true); });   // route missing ⇒ older MC
    const un = api.subscribe(
      s => {
        offset.current = s.t - Date.now();
        const mid = s.live?.match_id ?? null;
        if (mid !== feedMatch.current) { feedMatch.current = mid; if (mid) setFeed([]); }   // a new match starts a new feed
        setState(s);
        // follow the server phase when it advances (armed → live → recap), but let the host browse freely
        if (followed.current !== s.phase) {
          const seeding = followed.current === null && urlView.current;
          followed.current = s.phase;
          urlView.current = false;
          if (!seeding) { writeHash(s.phase); setViewRaw(s.phase); }   // the URL follows an auto-advance too
        }
      },
      e => setFeed(f => [e, ...f].slice(0, 60)),
      ok => setConnected(ok),
    );
    const unAuth = mock ? () => {} : onAuthRequired(setAuthRequired);
    return () => { un(); unAuth(); };
  }, [api, mock, tokenVersion]);

  // While the operator token is missing/wrong, seed the board read-only from the open GET so the host
  // sees the console (not a blank CONNECTING page) behind the token prompt.
  useEffect(() => {
    if (!authRequired || mock) return;
    api.getState().then(s => setState(prev => prev ?? s)).catch(() => {});
  }, [authRequired, api, mock]);

  const store = useMemo<Store>(() => ({
    api, state, feed, modes, weapons, perks, view, setView, selPlayer, setSelPlayer, error, mock,
    designerSeed, openDesigner: seed => { setDesignerSeed(seed); setView('designer'); },
    connected: mock ? true : connected, authRequired, serverOld, hasToken: !!getToken(),
    setToken: tok => { saveToken(tok); setAuthRequired(false); setTokenVersion(v => v + 1); },
    clearError: () => setError(null),
    run: async fn => { try { setError(null); return await fn(); } catch (e) { setError((e as Error).message); return undefined; } },
    serverNow: () => Date.now() + offset.current,
  }), [api, state, feed, modes, weapons, perks, view, setView, selPlayer, error, mock, connected, authRequired, designerSeed, serverOld]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
