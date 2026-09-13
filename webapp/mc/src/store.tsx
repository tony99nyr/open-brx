import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Api, FeedEntry, ModeInfo, PerkView, Phase, SavedGame, State, WeaponView } from './api/types';

/** UI views = server phases + the game DESIGNER (authoring, not a phase — loadout.md §5). */
/** UI views = server phases + the game DESIGNER (authoring, not a phase — loadout.md §5) + `spectate`,
 *  the read-only board for a projector (S25). `spectate` is a VIEW and never a phase: it follows the
 *  match but the store must never auto-navigate INTO or OUT of it, or a room-facing screen would jump
 *  to a setup page the moment the host touched something. */
export type View = Phase | 'designer' | 'catalog' | 'debug' | 'spectate';

// Tony 2026-08-31: "each tab of the MC should put state in the URL so you can refresh the page."
// The view lives in the hash (the operator token is picked out of the same hash and stripped, see
// client.ts). Whitelisted on the way in so a hand-typed hash can never select a view that does not
// exist — that is what blanked the console when a non-phase view reached the phase-indexed label.
export const VIEWS: View[] = ['muster', 'build', 'designer', 'kit', 'lobby', 'armed', 'live', 'recap', 'catalog', 'debug', 'spectate'];
const asView = (h: string): View | null => ((VIEWS as string[]).includes(h) ? (h as View) : null);
const hashParts = (): string[] => {
  try { return decodeURIComponent(location.hash.replace(/^#/, '')).split('&').map(x => x.trim()); }
  catch { return []; }
};
function viewFromHash(): View | null {
  return asView(hashParts()[0] ?? '');
}
/** The view a LATCHED tab was asked for and could not have (see the latch below). It rides in the
 *  hash beside the view, `#spectate&want=kit`, exactly the way the operator token does — so the URL
 *  still says SPECTATE (what is on screen), and a RELOAD of that URL is a fresh load that carries
 *  the request and releases the board. */
function wantFromHash(): View | null {
  const w = hashParts().slice(1).find(x => x.startsWith('want='));
  const v = w ? asView(w.slice(5)) : null;
  return v && v !== 'spectate' ? v : null;
}
function writeHash(v: View, want?: View | null) {
  try {
    const h = '#' + v + (want ? `&want=${want}` : '');
    if (location.hash === h) return;
    history.replaceState(null, '', location.pathname + location.search + h);
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
  /** this tab LOADED at `#spectate`: it is the projector, and it refuses every other view (S25) */
  latched: boolean;
  /** the view this latched tab was last asked for — it opens on the next reload, and the board says so */
  wantedView: View | null;
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
  // S25 — THE PROJECTOR LATCH. A tab that LOADS at `#spectate` is the one pointed at the room, and it
  // carries the operator token like any other tab: reaching the console from it is reaching PANIC,
  // END MATCH and RECALL, in front of whoever is standing next to the screen. The hash was the way
  // in — `#kit` typed into that window, or a back button — because `hashchange` moved every tab
  // alike (review 2026-09-12). So the tab is latched read-only AT LOAD: hash navigation away from
  // the board is refused for the rest of the session and the hash is put back.
  //
  // A reload was always meant to be the way out — but the rewrite made that unreachable: typing
  // `#kit` put `#spectate` straight back in the URL bar, so the reload that followed reloaded the
  // BOARD, and the latch could never be released at all (round-2 review 2026-09-12). The typed view
  // is now REMEMBERED in the hash as `&want=`, which this tab ignores and the NEXT load honours: type
  // the view, reload, and the tab comes back as a console on that screen. Still a deliberate act at a
  // keyboard, which is the whole point — nothing a passer-by does to the projector can reach PANIC.
  const loadedWant = useRef<View | null>(wantFromHash());
  const spectatorTab = useRef<boolean>(viewFromHash() === 'spectate' && !loadedWant.current);
  const [view, setViewRaw] = useState<View>(() => loadedWant.current ?? viewFromHash() ?? 'muster');
  // the request has been spent: the URL says the view it opened, not the one it came from
  useEffect(() => { if (loadedWant.current) { writeHash(loadedWant.current); loadedWant.current = null; } }, []);
  // what a latched tab was last asked for, so the board can say how to get there (nothing is rendered
  // until somebody actually tries)
  const [wanted, setWanted] = useState<View | null>(null);
  const setView = useCallback((v: View) => {
    if (spectatorTab.current) { setWanted(v === 'spectate' ? null : v); writeHash('spectate', v === 'spectate' ? null : v); return; }
    writeHash(v); setViewRaw(v);
  }, []);
  // back/forward and a hand-edited hash both move the console
  useEffect(() => {
    const onHash = () => {
      if (spectatorTab.current) {
        const asked = viewFromHash();
        const want = asked && asked !== 'spectate' ? asked : wantFromHash();
        setWanted(want);
        writeHash('spectate', want);      // the board stays the board; the request survives a reload
        return;
      }
      const v = viewFromHash(); if (v) setViewRaw(v);
    };
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
          // S25: a tab left on #spectate is pointed at a ROOM. The phase-follow that is right for the
          // operator's console would swap it to KIT the moment the host moved on, so the spectator
          // view opts out and keeps showing the board (which handles live / recap / neither itself).
          if (!seeding && !spectatorTab.current && viewFromHash() !== 'spectate') { writeHash(s.phase); setViewRaw(s.phase); }
        }
      },
      e => setFeed(f => [e, ...f].slice(0, 60)),
      ok => setConnected(ok),
    );
    const unAuth = mock ? () => {} : onAuthRequired(setAuthRequired);
    return () => { un(); unAuth(); };
  }, [api, mock, tokenVersion]);

  // A test hook, and ONLY in `?mock`: the in-browser demo has no server to poke from outside, so a
  // browser walk had no way to reach a LIVE match without sitting through the 60 s runway the UI
  // offers. Never attached against a real server — there the suite drives the real MC over HTTP,
  // which is the honest thing to drive.
  //
  // In an EFFECT, not in the `useMemo` that builds the api: StrictMode runs that factory twice and
  // keeps one of the two backends, so assigning from inside it published an ORPHAN — a second
  // MockBackend, with its own ticker, that the console was not subscribed to. Driving it moved
  // nothing on screen (2026-09-12). An effect can only ever see the instance React actually kept.
  useEffect(() => {
    if (!mock) return;
    const w = window as unknown as { __MC_MOCK__?: Api };
    w.__MC_MOCK__ = api;
    return () => { if (w.__MC_MOCK__ === api) delete w.__MC_MOCK__; };
  }, [api, mock]);

  // While the operator token is missing/wrong, seed the board read-only from the open GET so the host
  // sees the console (not a blank CONNECTING page) behind the token prompt.
  useEffect(() => {
    if (!authRequired || mock) return;
    api.getState().then(s => setState(prev => prev ?? s)).catch(() => {});
  }, [authRequired, api, mock]);

  const store = useMemo<Store>(() => ({
    api, state, feed, modes, weapons, perks, view, setView, selPlayer, setSelPlayer, error, mock,
    latched: spectatorTab.current, wantedView: wanted,
    designerSeed, openDesigner: seed => { setDesignerSeed(seed); setView('designer'); },
    connected: mock ? true : connected, authRequired, serverOld, hasToken: !!getToken(),
    setToken: tok => { saveToken(tok); setAuthRequired(false); setTokenVersion(v => v + 1); },
    clearError: () => setError(null),
    run: async fn => { try { setError(null); return await fn(); } catch (e) { setError((e as Error).message); return undefined; } },
    serverNow: () => Date.now() + offset.current,
  }), [api, state, feed, modes, weapons, perks, view, setView, wanted, selPlayer, error, mock, connected, authRequired, designerSeed, serverOld]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
