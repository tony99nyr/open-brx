import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Api, FeedEntry, ModeInfo, PerkView, Phase, State, WeaponView } from './api/types';

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
  /** Polish round 2: returns whether it actually navigated (`false` on a first tap the dirty guard
   *  blocked, or a latched spectator tab that only recorded what it was asked for). A caller with its
   *  own follow-up step (`ReportPanel`'s `goToToken`) checks this instead of assuming success. */
  setView: (p: View) => boolean;
  /** this tab LOADED at `#spectate`: it is the projector, and it refuses every other view (S25) */
  latched: boolean;
  /** the view this latched tab was last asked for — it opens on the next reload, and the board says so */
  wantedView: View | null;
  /** F411 (docs/spec/design/games-presets.md §2): BUILD is a header link from PLAY and ARMORY, never a
   *  stepper step — it carries no seed, since BUILD is a preset editor now, not a per-game draft. */
  openBuild: () => void;
  /** F411 §5/§8: PLAY's "ASSIGN A HILL ▸" (KOTH with nothing assigned) sets this and jumps to ARMORY,
   *  which scrolls to and highlights the ITEMS station slot and offers "CONTINUE TO PLAY ▸". Transient,
   *  cleared by that button — never a second source of truth for anything server-side. */
  focusHill: boolean;
  setFocusHill: (v: boolean) => void;
  /** Polish round 1 M6: an open BUILD editor with an unsaved change sets this. `setView` reads it and
   *  gates EVERY navigation attempt (the CommandBar stepper, the ☰ menu, not just BUILD's own back
   *  button) behind one inline "tap again to leave" confirm — the same two-tap shape the rest of the
   *  console already uses for a destructive action. */
  dirty: boolean;
  setDirty: (v: boolean) => void;
  /** the view a nav attempt was blocked to while `dirty`: BUILD renders its confirm banner off this,
   *  and tapping the SAME control again (which calls `setView` with this same target) proceeds. */
  navBlockedTo: View | null;
  /** Round 2 Low: BUILD calls this whenever the draft changes WHILE a block is already showing -- a
   *  further edit made the pending confirm stale (it was about the draft as it stood a moment ago), so
   *  the SAME target must ask again rather than silently reusing an old "tap again" as a confirm for a
   *  never-shown edit. */
  clearNavBlock: () => void;
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

/** F318: one feed line showed twice right after go-live, and FIRST BLOOD twice after a recall and a
 *  restart. Both were one race: a snapshot's `feed` REPLACES the local list (a new match, or a reopened
 *  socket), and a live `feed` push for an entry that snapshot already carried then PREPENDS it again.
 *  A FeedEntry has no seq, so its identity is everything it says: the match clock, kind, tag and text.
 *  Two entries equal in all four say nothing different, so showing one of them loses nothing. */
export const feedKey = (e: FeedEntry): string => `${e.t_match_s}|${e.kind}|${e.tag ?? ''}|${e.text}`;
const FEED_MAX = 60;
/** Polish round 1: identical lines are real too. A second END press sends the same "END AGAIN" line at
 *  t 0, and so do repeated RECONCILED and TOLD N PHONES lines, so the feed must never collapse equals in
 *  general. Only the race above is a double: a live push for a row the snapshot seed ALREADY carried. So a
 *  seed arms one "consume" per row for SEED_RACE_MS, and a matching push inside that window is dropped once. */
export const SEED_RACE_MS = 3000;
export type SeedMemo = { keys: Map<string, number>; until: number };
export const seedMemo = (seed: FeedEntry[], now: number): SeedMemo => {
  const keys = new Map<string, number>();
  for (const e of seed) keys.set(feedKey(e), (keys.get(feedKey(e)) ?? 0) + 1);
  return { keys, until: now + SEED_RACE_MS };
};
/** Is this live push the seed's own row arriving late? Consumes one use when it is. */
export function isSeedEcho(memo: SeedMemo | null, e: FeedEntry, now: number): boolean {
  if (!memo || now > memo.until) return false;
  const k = feedKey(e), n = memo.keys.get(k) ?? 0;
  if (n <= 0) return false;
  memo.keys.set(k, n - 1);
  return true;
}

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
  // Polish round 1 M6 / round 2: `dirty`/`navBlockedTo` below. `dirtyRef`/`navBlockedRef`/`viewRef`
  // mirror the matching state SYNCHRONOUSLY (inside the setter that changes it, not a separate effect
  // reacting to it a render later) — round 2's H1 found that a `useEffect`-only mirror is one render
  // too slow: BUILD's confirmed "leave anyway" tap called `setDirty(false)` then `setView(...)` in the
  // SAME synchronous handler, and `setView` still read the OLD (still-true) ref, blocking a THIRD time.
  const [dirty, setDirtyRaw] = useState(false);
  const dirtyRef = useRef(false);
  const [navBlockedTo, setNavBlockedTo] = useState<View | null>(null);
  const navBlockedRef = useRef<View | null>(null);
  // Round 3 (3, 4): was this block set by an OPERATOR action (setView/onHash) or by `followPhase`
  // catching the server up? Only an operator's own repeat tap at the same target may confirm and
  // proceed — `followPhase` re-checking the SAME phase (its own guard, not a tap) must never count as
  // one, or an unattended tab would discard the edit the moment the server pushed that phase again.
  // And a draft keystroke (Build.tsx) only invalidates a block IT could have caused: a phase-follow
  // banner ("LIVE is waiting") stays up regardless of what the operator keeps typing.
  const navBlockedByFollowRef = useRef(false);
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  const setNavBlocked = useCallback((v: View | null, byFollow = false) => {
    navBlockedRef.current = v;
    navBlockedByFollowRef.current = v == null ? false : byFollow;
    setNavBlockedTo(v);
  }, []);
  const setDirty = useCallback((v: boolean) => { dirtyRef.current = v; setDirtyRaw(v); if (!v) setNavBlocked(null); }, [setNavBlocked]);
  // A stable identity matters here specifically: BUILD puts this in a `useEffect` dependency array
  // (round 2 Low, clearing a stale block when the draft changes), and the store's own `useMemo` below
  // rebuilds on nearly every snapshot -- an inline `() => setNavBlocked(null)' there would have gotten a
  // FRESH identity on every tick, re-firing that effect (and clearing a block that had nothing to do
  // with the draft) far more often than intended.
  const clearNavBlock = useCallback(() => { if (!navBlockedByFollowRef.current) setNavBlocked(null); }, [setNavBlocked]);
  // The one gate every navigation attempt goes through — `setView`, browser back/forward (`onHash`)
  // and the server phase catching up (`followPhase`) alike, so an unsaved BUILD edit is asked about
  // once, not lost to whichever of the three got there first. `debug` (the token screen) is exempt:
  // auth is never something a "tap again to confirm" can be waved past, and everything ELSE — saving
  // the very edit this guard is protecting — needs it reachable first.
  const guardNav = useCallback((v: View, source: 'operator' | 'follow'): 'blocked' | 'go' => {
    if (v === 'debug') { if (navBlockedRef.current !== null) setNavBlocked(null); return 'go'; }
    if (dirtyRef.current && v !== viewRef.current) {
      // a second attempt at the SAME target is the confirm, but ONLY from an operator action -- a
      // `followPhase` call never self-confirms, whatever it names
      if (source === 'operator' && navBlockedRef.current === v) { setDirty(false); return 'go'; }
      setNavBlocked(v, source === 'follow');
      return 'blocked';
    }
    if (navBlockedRef.current !== null) setNavBlocked(null);
    return 'go';
  }, [setDirty, setNavBlocked]);
  const setView = useCallback((v: View): boolean => {
    if (guardNav(v, 'operator') === 'blocked') return false;
    if (spectatorTab.current) { setWanted(v === 'spectate' ? null : v); writeHash('spectate', v === 'spectate' ? null : v); return false; }
    writeHash(v); setViewRaw(v);
    return true;
  }, [guardNav]);
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
      const v = viewFromHash(); if (!v) return;
      // Round 2 (2): the address bar moves BEFORE this fires (a back/forward jump, or a typed hash) --
      // unlike a button's `setView` call, there is no "don't navigate" here, only "put it back". A
      // blocked attempt restores the CURRENT view's hash so the URL never lies about what is on screen;
      // BUILD's own banner (off `navBlockedTo`, set by `guardNav`) says why.
      if (guardNav(v, 'operator') === 'blocked') { writeHash(viewRef.current); return; }
      setViewRaw(v);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [guardNav]);
  const [selPlayer, setSelPlayer] = useState<string | null>(null);
  const [focusHill, setFocusHill] = useState(false);
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
  // Set each time /ui-ws (re)opens: the next snapshot's feed REPLACES the local one. A tab left open
  // across an MC restart kept the old process's events and never showed the new one's "MC RESTARTED"
  // line, so it disagreed with every freshly loaded tab (MC visual QA 2026-09-23). A reconnect after a
  // Wi-Fi blip is the same case: the feed pushes sent while the socket was down were never received.
  const reseedFeed = useRef(true);
  const seedMemoRef = useRef<SeedMemo | null>(null);   // the last seed's rows, for the seed-then-push race (polish round 1)
  // A view restored from the URL must not be stomped by the first server snapshot. The follow rule is
  // "move when the phase ADVANCES"; on a refresh there has been no advance yet, so the first snapshot
  // only seeds the baseline. Without this every reload bounced straight back to the phase screen.
  const urlView = useRef<boolean>(viewFromHash() != null);
  const offset = useRef(0);

  // follow the server phase when it advances (armed → live → recap), but let the host browse freely
  const followPhase = useCallback((s: State) => {
    if (followed.current === s.phase) return;
    const seeding = followed.current === null && urlView.current;
    followed.current = s.phase;
    urlView.current = false;
    // S25: a tab left on #spectate is pointed at a ROOM. The phase-follow that is right for the
    // operator's console would swap it to KIT the moment the host moved on, so the spectator
    // view opts out and keeps showing the board (which handles live / recap / neither itself).
    if (seeding || spectatorTab.current || viewFromHash() === 'spectate') return;
    // Round 2 (2): this used to move the screen out from under an unsaved BUILD edit the instant the
    // match armed/went live, with no warning at all. `guardNav` keeps the operator on BUILD instead and
    // names the phase that is waiting (`navBlockedTo`) -- tapping that SAME tab again is still the way
    // through, exactly as if they had tried to navigate there themselves.
    if (guardNav(s.phase, 'follow') === 'blocked') return;
    writeHash(s.phase); setViewRaw(s.phase);
  }, [guardNav]);

  useEffect(() => {
    api.getModes().then(setModes).catch(() => {});
    api.getWeapons().then(setWeapons).catch(() => {});
    api.getPerks().then(setPerks).catch(e => { if ((e as { status?: number }).status === 404) setServerOld(true); });   // route missing ⇒ older MC
    const un = api.subscribe(
      s => {
        offset.current = s.t - Date.now();
        const mid = s.live?.match_id ?? null;
        // A new match starts a new feed. The snapshot carries the server's feed (newest first, the order kept here),
        // so a console opened or reloaded mid-match shows what already happened (integration pass 2026-09-23); an
        // empty local feed is seeded from it too, and live `feed` pushes keep prepending as before.
        const hasFeed = Array.isArray(s.feed);
        const seed = (hasFeed ? s.feed : []) as FeedEntry[];
        const reseed = reseedFeed.current && hasFeed;   // an older MC sends no feed: keep what this tab has
        if (hasFeed) reseedFeed.current = false;
        const applySeed = () => { seedMemoRef.current = seedMemo(seed, Date.now()); setFeed(seed.slice(0, FEED_MAX)); };
        if (mid !== feedMatch.current) { feedMatch.current = mid; if (mid) applySeed(); else seedMemoRef.current = null; }
        else if (mid && reseed) applySeed();
        else if (mid && seed.length) setFeed(f => { if (f.length) return f; seedMemoRef.current = seedMemo(seed, Date.now()); return seed.slice(0, FEED_MAX); });
        setState(s);
        followPhase(s);
      },
      e => { if (!isSeedEcho(seedMemoRef.current, e, Date.now())) setFeed(f => [e, ...f].slice(0, FEED_MAX)); },
      ok => { if (ok) reseedFeed.current = true; setConnected(ok); },
    );
    const unAuth = mock ? () => {} : onAuthRequired(setAuthRequired);
    return () => { un(); unAuth(); };
  }, [api, mock, tokenVersion, followPhase]);

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
  //
  // The GET REPLACES what the tab holds. An MC restart mints a new token, so the open tab is refused
  // exactly when its last snapshot describes a process that no longer exists. Keeping that snapshot
  // showed a dead LOBBY with the game loaded, while the new process had delivered nothing
  // (bench 2026-09-16). The GET is always the newer answer, from whichever process is up now.
  useEffect(() => {
    if (!authRequired || mock) return;
    api.getState().then(s => { setState(s); followPhase(s); }).catch(() => {});
  }, [authRequired, api, mock, followPhase]);

  const store = useMemo<Store>(() => ({
    api, state, feed, modes, weapons, perks, view, setView, selPlayer, setSelPlayer, error, mock,
    latched: spectatorTab.current, wantedView: wanted,
    openBuild: () => setView('designer'),
    focusHill, setFocusHill,
    dirty, setDirty, navBlockedTo, clearNavBlock,
    connected: mock ? true : connected, authRequired, serverOld, hasToken: !!getToken(),
    setToken: tok => { saveToken(tok); setAuthRequired(false); setError(null); setTokenVersion(v => v + 1); },
    clearError: () => setError(null),
    run: async fn => { try { setError(null); return await fn(); } catch (e) { setError((e as Error).message); return undefined; } },
    serverNow: () => Date.now() + offset.current,
  }), [api, state, feed, modes, weapons, perks, view, setView, wanted, selPlayer, error, mock, connected, authRequired, serverOld, focusHill, dirty, setDirty, navBlockedTo, clearNavBlock]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
