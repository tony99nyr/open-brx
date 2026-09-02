// The three MC regressions the 2026-08-30 field session shipped, each pinned where it broke.
//
// Every one of them was found by a person looking at a screen. None of them needed hardware, a
// server, or a browser to catch (W5, handoff-post-first-match).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Armory } from '../src/screens/Armory';
import { Catalog } from '../src/screens/Catalog';
import { Designer } from '../src/screens/Designer';
import { Kit } from '../src/screens/Kit';
import { Recap } from '../src/screens/Recap';
import { CommandBar } from '../src/frame/CommandBar';
import { counted, demo, makeStore, mount, mountScreen, starved } from './harness';
import { StoreCtx } from '../src/store';
import { isRoutableLanIp } from '../src/api/derive';
import type { MatchHistoryRow, State, WeaponView } from '../src/api/types';
import type { View } from '../src/store';

const VIEWS: View[] = ['muster', 'build', 'designer', 'catalog', 'kit', 'lobby', 'armed', 'live', 'recap'];

describe('the command bar labels every view', () => {
  // "the black ARSENAL page": the bar indexes a phase table by view, and a view that is not a phase
  // indexed it at -1 — `PH[-1][1]` threw and took the whole console down, not just the tab.
  it.each(VIEWS)('renders on %s', async view => {
    const d = await demo();
    const m = await mountScreen(<CommandBar />, { ...d, view });
    // The PHASE telemetry strip moved to the Debug page when the header was simplified
    // (2026-09-02), so assert what the bar is FOR: it still renders, and still offers the nav.
    expect(m.text()).toMatch(/MISSION CONTROL/);
    expect(m.text()).toMatch(/ARMORY/);
    m.unmount();
  });

  it('survives a phase it has never heard of', async () => {
    // an older/newer server, or a hand-edited hash: an unknown phase must not blank the console
    const d = await demo();
    const state = { ...d.state, phase: 'wat' as State['phase'] };
    const m = await mountScreen(<CommandBar />, { ...d, state, view: 'muster' });
    expect(m.text().length).toBeGreaterThan(0);
    m.unmount();
  });
});

describe('the runway outlives a tab switch', () => {
  beforeEach(() => { localStorage.clear(); });

  it('remembers the operator pick across a remount', async () => {
    // Field 2026-08-30: the countdown reset to 02:00 on every tab switch. Lobby and Armed each held
    // it in `useState(120)`, and React re-runs a useState initialiser on REMOUNT — a tab switch.
    const { DEFAULT_RUNWAY, getRunway, setRunway } = await import('../src/runway');
    expect(getRunway()).toBe(DEFAULT_RUNWAY);
    setRunway(30);
    expect(getRunway()).toBe(30);          // module scope survives the remount
    expect(localStorage.getItem('brx.mc.runway')).toBe('30');   // and localStorage survives a reload
  });

  // `vi.resetModules()` below re-imports runway.ts to simulate a console reload. Nothing else in
  // this file may dynamically import a module afterwards: it would get a SECOND copy, and a second
  // copy of store.tsx means a second React context that no mounted screen is inside.
  it('reads the operator pick back on a fresh console load', async () => {
    // a reload/restart re-imports the module: the stored pick must come BACK, and a value that is
    // not on the dial (an older build's, or a hand-edited key) must fall back to the default
    for (const [stored, want] of [['45', 45], ['9999', null], ['nonsense', null]] as const) {
      localStorage.setItem('brx.mc.runway', stored);
      vi.resetModules();
      const mod = await import('../src/runway');
      expect(mod.getRunway()).toBe(want ?? mod.DEFAULT_RUNWAY);
    }
  });
});

// ---------------------------------------------------------------- RECAP history + per-match CSV

const RECAP_ROWS = [{ player_id: 'p1', display: 'ALPHA', team_id: 'blue', kills: 4, deaths: 1, assists: 0,
                      kd: 4, accuracy: 30, streak: 3, shots: 40, hits: 12, medals: ['MVP'] }];
const csvNameOf = (id: string) => `brx-recap-${id}.csv`;
const archived = (id: string, mode = 'ffa'): MatchHistoryRow => ({
  match_id: id, mode, go_live_t: 1000, ended_t: 2000,
  recap: { winner: { player_id: 'p1' }, score: {}, rows: RECAP_ROWS, honors: [], provisional: false, missing: [] },
});

function withLive(state: State): State {
  return { ...state, phase: 'recap',
    live: { match_id: 'live-1', go_live_t: 1, time_limit_s: 300, ends_t: 2, score: {}, rows: [] },
    recap: { winner: { player_id: 'p1' }, score: {}, rows: RECAP_ROWS, honors: [], provisional: false, missing: [] } };
}

describe('the RECAP history picker', () => {
  it('exports the ARCHIVED match, not the live one', async () => {
    // W1/F6: `/api/recap.csv` only ever serves the LIVE scorer, so the picker used to HIDE its
    // export button on a past match rather than hand the operator the wrong game's numbers.
    const d = await demo();
    const m = await mountScreen(<Recap />, {
      ...d, state: withLive(d.state), view: 'recap',
      api: { matchHistory: async () => [archived('m7')], recapCsvUrl: () => '/api/recap.csv',
             matchCsvUrl: (id: string) => `/api/matches/${id}.csv` },
    });
    const href = () => (m.find('a[download]')[0] as HTMLAnchorElement | undefined)?.getAttribute('href');
    expect(href()).toBe('/api/recap.csv');            // THIS MATCH → the live scorer
    await m.click('· FFA');                            // the archived chip
    expect(m.text()).toContain('ARCHIVED MATCH');
    expect(href()).toBe('/api/matches/m7.csv');        // that match, by id
    expect(m.text()).not.toContain('NEW MATCH');       // a record is not a place to start a game from
    m.unmount();
  });

  it('fetches the history once, not on every snapshot', async () => {
    // The refetch storm: the effect was keyed on `state.recap`, and the store hands out a FRESH
    // recap object with every snapshot, so the picker refetched several times a second for as long
    // as RECAP was open. It has to key on the match id — the thing that actually changes.
    const d = await demo();
    const { api, calls } = counted('matchHistory', async () => [archived('m7')]);
    // one store, as the real one is (`api` is useMemo'd); only the SNAPSHOT changes
    const base = makeStore({ ...d, state: withLive(d.state), view: 'recap', api });
    const fresh = () => ({ ...withLive(d.state), recap: { ...withLive(d.state).recap! } });
    const render = (state: State) => (
      <StoreCtx.Provider value={{ ...base, state }}><Recap /></StoreCtx.Provider>
    );
    const m = await mount(render(fresh()));
    expect(calls.n).toBe(1);
    for (let i = 0; i < 5; i++) await m.update(render(fresh()));   // five more of the SAME match
    expect(calls.n).toBe(1);
    // ...but a NEW match must refetch: that is the whole point of the history
    const next = fresh();
    await m.update(render({ ...next, live: { ...next.live!, match_id: 'live-2' } }));
    expect(calls.n).toBe(2);
    m.unmount();
  });

  it('shows an archived match by ITS OWN facts, not the live ones', async () => {
    // Nothing asserted any of this (review 2026-09-01): the header showed the CURRENT draft's mode,
    // DATA SYNC read the live roster and node links, and the provisional banner told the operator to
    // "bring them into range to finalize" a match that ended hours ago.
    const d = await demo();
    const rows = [{ ...RECAP_ROWS[0], display: 'OLD NAME' }];
    const past: MatchHistoryRow = {
      match_id: 'm9', mode: 'tdm', go_live_t: 1, ended_t: 2,
      recap: { winner: { player_id: 'p1' }, score: {}, rows, honors: [{ award: 'MVP', player_id: 'p1', stat: '4 K' }],
               provisional: true, missing: ['p1'] },
    };
    const live = withLive(d.state);
    const m = await mountScreen(<Recap />, {
      ...d, state: { ...live, config: { ...live.config, mode: 'ffa' } }, view: 'recap',
      api: { matchHistory: async () => [past], matchCsvUrl: (id: string) => `/api/matches/${id}.csv` },
    });
    await m.click('· TDM');
    const txt = m.text();
    expect(txt, "the header must name the archived match's mode").toContain('TDM');
    expect(txt, 'DATA SYNC reads the LIVE roster — meaningless here').not.toContain('DATA SYNC');
    expect(txt, 'the live CTA must not appear on an archived match').not.toContain('BRING THEM INTO RANGE');
    expect(txt).toContain('AS RECORDED WHEN THE MATCH WAS ARCHIVED');
    expect(txt, "the archived recap's own name must win over the live roster").toContain('OLD NAME');
    m.unmount();
  });

  it('says so when there is nothing to show', async () => {
    const d = await demo();
    const m = await mountScreen(<Recap />, { ...d, state: starved(d.state), view: 'recap',
                                             api: { matchHistory: async () => [] } });
    expect(m.text()).toContain('NO RECAP YET');
    m.unmount();
  });
});

// ---------------------------------------------------------------- ARSENAL numbers

describe('the ARSENAL quotes the game that is actually set up', () => {
  const arsenal = (pool: number | undefined): WeaponView[] => ([
    { weapon_id: 'assault_rifle', name: 'Assault Rifle', cls: '0', clip: 32, mags: 6, reserve: 192,
      reload_s: 1.4, dmg: 8, rpm: 54, rng: 75, verified: false, role: 'assault', tags: ['assault'],
      htk: pool === 200 ? 23 : 13, ttk_ms: pool === 200 ? 3080 : 1680, dmg_per_hit: 9, pool },
    { weapon_id: 'rocket_launcher', name: 'Rocket Launcher', cls: '4', clip: 2, mags: 1, reserve: 2,
      reload_s: 2.6, dmg: 100, rpm: 8, rng: 75, verified: false, role: 'power', tags: ['heavy'],
      htk: 1, ttk_ms: 0, dmg_per_hit: 115, pool },
  ]);

  it('names the pool its hits-to-kill is measured against', async () => {
    // W2: `POOL = 115` was hardcoded in views.py, so both screens claimed the AR takes 13 hits
    // whatever the host had set health to (docs/weapon-design.md §2.5).
    const d = await demo();
    const m = await mountScreen(<Catalog />, { ...d, weapons: arsenal(200), view: 'catalog' });
    expect(m.text()).toContain('200 POOL');
    expect(m.text()).toContain('23');
    m.unmount();
  });

  it('says nothing about a pool the server did not send', async () => {
    const d = await demo();
    const m = await mountScreen(<Catalog />, { ...d, weapons: arsenal(undefined), view: 'catalog' });
    expect(m.text()).not.toMatch(/POOL \(HP/);
    m.unmount();
  });

  it('sorts a missing stat LAST in both directions, never as a zero', async () => {
    const d = await demo();
    const weapons = [...arsenal(115)];
    weapons[1] = { ...weapons[1], ttk_ms: undefined };     // a one-shot weapon has no time-to-kill
    const m = await mountScreen(<Catalog />, { ...d, weapons, view: 'catalog' });
    const names = () => m.find('tbody tr td:first-child').map(td => (td.textContent ?? '').trim().split(' ')[0]);
    expect(names()[names().length - 1]).toBe('ROCKET');    // ascending: the blank sorts last
    await m.click(/TIME TO KILL/);                          // flip to descending
    expect(names()[names().length - 1]).toBe('ROCKET');    // ...and still last
    m.unmount();
  });

  it('renders with no catalog at all', async () => {
    const d = await demo();
    const m = await mountScreen(<Catalog />, { ...d, weapons: [], view: 'catalog' });
    expect(m.text()).toContain('NO CATALOG');
    m.unmount();
  });
});

// ---------------------------------------------------------------- the armory refetch storm

describe('the armory is refetched when the FLEET changes, not on a clock', () => {
  // Review 2026-09-01: both screens keyed this effect on `readiness.t`, which is `now_ms()` stamped
  // on every snapshot and pushed up to 4x/s — so they refetched the armory ~4 times a second for as
  // long as they were open. Same bug class as the RECAP history storm, re-introduced by its fix.
  const screens: [string, View, () => React.ReactElement][] = [
    ['muster', 'muster', () => <Armory />],
    ['kit', 'kit', () => <Kit />],
  ];

  it.each(screens)('%s · a new snapshot with only a new clock does not refetch', async (_n, view, make) => {
    const d = await demo();
    const { api, calls } = counted('armory', async () => []);
    const base = makeStore({ ...d, view, api });
    const tick = (t: number): State => ({ ...d.state, t, readiness: { ...d.state.readiness, t } });
    const render = (t: number) => (
      <StoreCtx.Provider value={{ ...base, state: tick(t) }}>{make()}</StoreCtx.Provider>
    );
    const m = await mount(render(1000));
    expect(calls.n).toBe(1);
    for (let i = 1; i <= 8; i++) await m.update(render(1000 + i * 250));   // 2 seconds of snapshots
    expect(calls.n, 'the clock alone must not refetch the armory').toBe(1);
    m.unmount();
  });

  it.each(screens)('%s · a gun appearing DOES refetch', async (_n, view, make) => {
    const d = await demo();
    const { api, calls } = counted('armory', async () => []);
    const base = makeStore({ ...d, view, api });
    // a full ScanRow-shaped row: the screen renders basename/rssi/identity too, and a partial
    // fixture would fail for the wrong reason
    const gun = (tail: string) => ({ tail, basename: 'TACTIX2', gun_id: `GUN-${tail}`, rssi: -55, identity: 'ok' });
    const withGuns = (tails: string[]): State => ({
      ...d.state,
      readiness: { ...d.state.readiness, t: Date.now(), unclaimed: tails.map(gun) as never },
    });
    const render = (u: string[]) => (
      <StoreCtx.Provider value={{ ...base, state: withGuns(u) }}>{make()}</StoreCtx.Provider>
    );
    const m = await mount(render([]));
    expect(calls.n).toBe(1);
    await m.update(render(['FE30']));       // a scan enrolled a gun
    expect(calls.n, 'a new gun must reach the picker without a reload').toBe(2);
    await m.update(render(['FE30']));       // ...and then settle
    expect(calls.n).toBe(2);
    m.unmount();
  });
});

describe('exporting an archived match', () => {
  it('saves the file on the success path', async () => {
    // The branch that actually matters, and the one that had NO coverage: jsdom implements neither
    // ObjectURL function, so this path threw a TypeError the screen reported to the operator as
    // "MC UNREACHABLE" — a code bug wearing a network fault's clothes (review 2026-09-01).
    const d = await demo();
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response('operator,team,kills\nALPHA,blue,4\n',
      { status: 200, headers: { 'content-type': 'text/csv' } })) as typeof fetch;
    try {
      const m = await mountScreen(<Recap />, {
        ...d, state: withLive(d.state), view: 'recap',
        api: { matchHistory: async () => [archived('m7')], matchCsvUrl: (id: string) => `/api/matches/${id}.csv` },
      });
      // spy on the download lifecycle: the invariant is the ORDER, not the values
      // NB: do NOT stub HTMLAnchorElement.prototype.click — the harness's own click() goes through
      // it, so stubbing it stops the React handler ever running and the test measures nothing.
      const madeUrls: string[] = [], revoked: string[] = [];
      const realCreate = URL.createObjectURL, realRevoke = URL.revokeObjectURL;
      const appended: HTMLElement[] = [];
      const realAppend = document.body.appendChild.bind(document.body);
      URL.createObjectURL = (b: Blob) => { const u = realCreate.call(URL, b); madeUrls.push(u); return u; };
      URL.revokeObjectURL = (u: string) => { revoked.push(u); realRevoke.call(URL, u); };
      document.body.appendChild = (<T extends Node>(n: T): T => { appended.push(n as unknown as HTMLElement); return realAppend(n) as T; }) as typeof document.body.appendChild;
      try {
        await m.click('· FFA');
        await m.click('EXPORT CSV');
        expect(m.text(), 'a successful export must not show an error').not.toContain('EXPORT FAILED');
        expect(m.text()).not.toContain('TOO OLD');
        expect(madeUrls.length, 'the blob must be handed to a download').toBe(1);
        // Safari and Firefox cancel a download from a DETACHED anchor, and cancel one whose object
        // URL is revoked synchronously after the click. Both were true before (review 2026-09-01).
        const anchor = appended.find(n => (n as HTMLAnchorElement).download === csvNameOf('m7'));
        expect(anchor, 'the download anchor must be attached to the document').toBeTruthy();
        expect(revoked, 'the object URL must not be revoked synchronously after the click').toEqual([]);
      } finally {
        URL.createObjectURL = realCreate; URL.revokeObjectURL = realRevoke;
        document.body.appendChild = realAppend as typeof document.body.appendChild;
      }
      m.unmount();
    } finally { globalThis.fetch = orig; }
  });

  it('does not save a 404 body as a .csv', async () => {
    // `<a download>` saves whatever comes back; an MC predating the archived route would hand the
    // operator its 404 JSON in a file named .csv (review 2026-09-01).
    const d = await demo();
    const calls: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (u: string) => { calls.push(String(u)); return new Response('{"error":"not found"}', { status: 404 }); }) as typeof fetch;
    try {
      const m = await mountScreen(<Recap />, {
        ...d, state: withLive(d.state), view: 'recap',
        api: { matchHistory: async () => [archived('m7')], matchCsvUrl: (id: string) => `/api/matches/${id}.csv` },
      });
      await m.click('· FFA');
      await m.click('EXPORT CSV');
      expect(calls).toContain('/api/matches/m7.csv');
      expect(m.text()).toContain('TOO OLD TO EXPORT');
      m.unmount();
    } finally { globalThis.fetch = orig; }
  });
});

describe('controls that must not fire twice', () => {
  it('NEW MATCH disables itself in flight', async () => {
    // `newSession()` rebuilds the whole session; a double-tap on a slow field LAN fired it twice and
    // the second landed on a session the first had already replaced. The ledger claimed this fix
    // with no test behind it (review 2026-09-01).
    const d = await demo();
    let release: (() => void) | null = null;
    const inFlight = new Promise<void>(r => { release = r; });
    let calls = 0;
    const m = await mountScreen(<Recap />, {
      ...d, state: withLive(d.state), view: 'recap',
      api: {
        matchHistory: async () => [],
        newSession: async () => { calls++; await inFlight; return d.state; },
      },
    });
    await m.click('NEW MATCH');
    expect(calls).toBe(1);
    expect(m.text()).toContain('STARTING');
    const btn = m.find('button').find(b => /STARTING/.test(b.textContent ?? ''));
    expect((btn as HTMLButtonElement).disabled, 'the button must be disabled while in flight').toBe(true);
    await m.click('STARTING');                 // a second tap while the first is still open
    expect(calls, 'a second tap must not start a second session').toBe(1);
    release!();
    m.unmount();
  });
});

describe('the APK QR is only offered on an address a phone can reach', () => {
  it('rejects loopback and the unspecified address', async () => {
    // `lan.ip` is never empty — the server falls back to 127.0.0.1 — so a truthiness guard passed
    // while MC printed a QR for loopback (review 2026-09-01).
    for (const bad of ['', '   ', '0.0.0.0', '127.0.0.1', '127.1.2.3', '::', '::1', undefined, null]) {
      expect(isRoutableLanIp(bad as string), String(bad)).toBe(false);
    }
    for (const ok of ['192.168.1.20', '10.0.0.5', '172.20.10.3']) {
      expect(isRoutableLanIp(ok), ok).toBe(true);
    }
  });
});

describe('the designer seeds a late snapshot without stomping edits', () => {
  // NOTE: Designer is imported statically at the top of this file. A dynamic import here would get a
  // SECOND copy of store.tsx after the runway test's `vi.resetModules()`, and its `StoreCtx` would be
  // a different React context than the one this provider supplies — "useStore outside StoreProvider".
  it('fills a null draft when the snapshot arrives, then never touches it again', async () => {
    // `cfg` is a lazy useState initialiser, so mounting before the first snapshot captured `null`
    // and the screen stayed blank forever. The seeding effect that fixes it depends on `initial`,
    // which depends on `state` — which changes on EVERY snapshot. If the `cfg === null` guard were
    // wrong, every snapshot would reset the config the operator is editing (review 2026-09-01).
    const d = await demo();
    const modes = await d.api.getModes();
    const base = makeStore({ ...d, view: 'designer' });
    const render = (state: State | null) => (
      <StoreCtx.Provider value={{ ...base, state, modes }}><Designer /></StoreCtx.Provider>
    );
    const m = await mount(render(null));
    await m.update(render({ ...d.state }));           // the first snapshot arrives
    expect(m.text(), 'the draft must be seeded, not left blank forever').toContain('OF 18');

    // Now make a REAL edit and prove it survives five more snapshots. Asserting that the text is
    // merely UNCHANGED would pass against a broken guard: re-seeding restores the same defaults, so
    // it looks identical unless something has actually been changed away from them.
    await m.click('NO HEAVIES');
    expect(m.text()).toContain('13 OF 18');
    for (let i = 0; i < 5; i++) await m.update(render({ ...d.state, t: Date.now() + i }));
    expect(m.text(), 'a snapshot must not reset the draft being edited').toContain('13 OF 18');
    m.unmount();
  });
});

describe('the RECAP selection and its export error', () => {
  it('drops a selection whose match is gone, instead of silently showing the live one', async () => {
    // Lane A's fix (`stale` in Recap.tsx). The merge review found it had NO test at all: deleting
    // `const stale` and `&& !stale` left all 66 green. It is the change the merge was most likely
    // to break, and nothing would have said so (2026-09-01).
    const d = await demo();
    // TWO archived matches, so the picker still renders after one of them disappears. With an empty
    // archive the picker is hidden entirely and `archive.find()` returns undefined anyway — the bug
    // is invisible in that setup, which is how it went untested (merge review 2026-09-01).
    let rows: MatchHistoryRow[] = [archived('m7'), archived('m8', 'tdm')];
    const state = withLive(d.state);
    const base = makeStore({ ...d, state, view: 'recap', api: { matchHistory: async () => rows,
                                                                matchCsvUrl: (id: string) => `/api/matches/${id}.csv` } });
    const render = (phase: State['phase'] = 'recap') =>
      <StoreCtx.Provider value={{ ...base, state: { ...state, phase } }}><Recap /></StoreCtx.Provider>;
    const m = await mount(render());
    await m.click('· FFA');
    expect(m.text()).toContain('ARCHIVED MATCH');

    // NEW MATCH: the session is rebuilt, the history is empty, and the phase moves — which is what
    // re-runs the fetch. The selection now points at a match the server no longer lists.
    rows = [archived('m8', 'tdm')];        // m7 is gone; m8 remains so the picker still shows
    await m.update(render('muster'));
    expect(m.text(), 'a vanished selection must not still render as archived').not.toContain('ARCHIVED MATCH');
    expect(m.text(), 'the live match must be fully in charge again').toContain('NEW MATCH');

    // The real symptom: the screen shows the LIVE recap while the picker highlights NOTHING, so the
    // operator cannot tell which match they are reading. THIS MATCH must be selected again.
    const chipFor = (label: string) => m.find('button').find(b => (b.textContent ?? '').includes(label));
    const thisMatch = chipFor('THIS MATCH');
    expect(thisMatch, 'the picker must still be on screen').toBeTruthy();
    expect(thisMatch!.style.background, 'THIS MATCH must be highlighted once the selection is dropped')
      .not.toBe('transparent');
    expect(chipFor('· TDM')!.style.background, 'the surviving archived chip must NOT be selected').toBe('transparent');
    m.unmount();
  });

  it('clears an export error when the operator selects a different match', async () => {
    // The error belonged to the SCREEN, not the selection: a failed archived export left
    // "THIS MC IS TOO OLD…" sitting beside the live export link, which works fine.
    const d = await demo();
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response('{"error":"no"}', { status: 404 })) as typeof fetch;
    try {
      const m = await mountScreen(<Recap />, {
        ...d, state: withLive(d.state), view: 'recap',
        api: { matchHistory: async () => [archived('m7')], matchCsvUrl: (id: string) => `/api/matches/${id}.csv` },
      });
      await m.click('· FFA');
      await m.click('EXPORT CSV');
      expect(m.text()).toContain('TOO OLD');
      await m.click('THIS MATCH');
      expect(m.text(), 'an error about another match must not follow the operator').not.toContain('TOO OLD');
      m.unmount();
    } finally { globalThis.fetch = orig; }
  });
});

describe('a weapon with no reload time', () => {
  it('reads as an em dash on every screen, never a bare unit', async () => {
    // `views.weapon_view` returns `reload_s: null` deliberately — a confident "RELOAD 0.0S" was
    // wrong. CATALOG handled it; KIT rendered the label over a bare "s" because the TS type still
    // said `number`, so nothing flagged it (merge 2026-09-01).
    const d = await demo();
    const weapons = d.weapons.map(w => ({ ...w, reload_s: null }));
    for (const [name, screen] of [['kit', <Kit />], ['catalog', <Catalog />]] as const) {
      const m = await mountScreen(screen, { ...d, weapons, view: name });
      const cells = m.find('span').filter(s => (s.textContent ?? '').startsWith('RELOAD')
                                            && (s.textContent ?? '').length < 20);
      for (const c of cells) {
        expect(c.textContent, `${name}: a reload cell must not be a bare unit`).not.toBe('RELOADs');
      }
      m.unmount();
    }
  });
});
