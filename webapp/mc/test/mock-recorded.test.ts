import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import recording from './fixtures/mock-recorded.json';
import expectedGaps from './fixtures/mock-recorded-gaps.json';
import { MockBackend } from '../src/mock/backend';
import { TEAMS } from '../src/mock/data';
import type { Phase, State } from '../src/api/types';

type Value = null | boolean | number | string | Value[] | { [key: string]: Value };
type Step = { name: string; action: string; [key: string]: any };
type Gap = { script: string; step: string; path: string; server: Value; mock: Value };
type PinnedGap = { group: Group; path: string; count: number; sha1: string };
type Group = 'by design' | 'fixture' | 'the mock shows it wrong' | 'cosmetic';
const MISSING = Symbol('missing');
const ABSENT: Value = { __state_absent__: true };
const T0 = 1_700_000_000_000;
const REGEN_HELP = 'From repo root: cd mcp && BRX_GENERATE_MOCK_RECORDED=1 python3 run_tests.py mock_recorded_states; then cd ../webapp/mc && BRX_GENERATE_MOCK_RECORDED_GAPS=1 npx vitest run --configLoader runner test/mock-recorded.test.ts. Review both fixtures and the gap list.';

type Snapshot = { script: string; step: string; state: State };
type SnapshotDelta = { script: string; step: string; state?: State; copy?: [string, string];
  patch?: (['set', string, Value] | ['delete', string])[] };
type PhaseStep = { script: string; step: string; from: Phase | null; server: Phase; mock: Phase };

function recordedSnapshots(): Snapshot[] {
  const previous = new Map<string, State>();
  const seen = new Map<string, State>();
  return (recording.snapshots as SnapshotDelta[]).map(row => {
    let state: State;
    if (previous.has(row.script)) {
      if (!row.patch || row.state !== undefined) throw new Error(`invalid delta row: ${row.script}/${row.step}`);
      state = structuredClone(previous.get(row.script)!);
      for (const operation of row.patch) {
        const [kind, pointer] = operation;
        if (!pointer.startsWith('/')) throw new Error(`invalid State pointer: ${pointer}`);
        const parts = pointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
        let target: any = state;
        for (const part of parts.slice(0, -1)) target = target[part];
        const key = parts[parts.length - 1];
        if (kind === 'delete' && operation.length === 2) {
          if (Array.isArray(target)) target.splice(Number(key), 1);
          else delete target[key];
        } else if (kind === 'set' && operation.length === 3) {
          target[key] = operation[2];
        } else throw new Error(`invalid State patch operation: ${row.script}/${row.step}`);
      }
    } else {
      if (row.patch !== undefined || (row.state === undefined) === (row.copy === undefined)) {
        throw new Error(`invalid first row: ${row.script}/${row.step}`);
      }
      const copied = row.copy && seen.get(JSON.stringify(row.copy));
      if (row.copy && !copied) throw new Error(`unknown copied row: ${row.copy.join('/')}`);
      state = row.state ?? structuredClone(copied!);
    }
    previous.set(row.script, state);
    seen.set(JSON.stringify([row.script, row.step]), state);
    return { script: row.script, step: row.step, state };
  });
}

// Whole State comparison. No path is ignored. Add a path and a reason here only when
// both backends expose a value that cannot be made comparable at the source.
const ignored: Readonly<Record<string, string>> = {};

// All arrays compare in order. The console renders feed, players and nodes in their
// supplied order. It also renders readiness, recap and station rows in that order.
// No State array is sorted by id.
function normalise(state: State): Value {
  const source = JSON.parse(JSON.stringify(state)) as Record<string, Value>;
  const ids: Record<string, string> = {};
  ids[source.session_id as string] = 'session:current';
  for (const p of state.players) ids[p.player_id] = `player:${p.player_num}`;
  ids[state.config.config_id] = 'config:current';
  for (const block of [state.start, state.live]) {
    if (block?.match_id) ids[block.match_id] = 'match:current';
  }
  const base = state.t;
  function walk(value: Value): Value {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [ids[k] ?? k, walk(v)]));
    }
    if (typeof value === 'string') return ids[value] ?? value;
    // The recording uses T0_EPOCH_MS. Seconds-based epochs and the small test clock stay raw.
    // Rebasing cannot catch the same offset error in t and every timestamp.
    if (typeof value === 'number' && value > T0 / 2) return value - base;
    return value;
  }
  return walk(source);
}

function comparedState(state: State, previous?: State): Value {
  const value = normalise(state) as Record<string, Value>;
  const id = (s: State | undefined, key: 'session_id' | 'config_id' | 'match_id'): string | null => {
    if (!s) return null;
    if (key === 'session_id') return s.session_id;
    if (key === 'config_id') return s.config.config_id;
    return s.start?.match_id ?? s.live?.match_id ?? null;
  };
  value.__recorded_meta__ = {
    t_delta_ms: previous ? state.t - previous.t : 0,
    session_id_changed: !!previous && id(state, 'session_id') !== id(previous, 'session_id'),
    config_id_changed: !!previous && id(state, 'config_id') !== id(previous, 'config_id'),
    match_id_changed: !!previous && id(state, 'match_id') !== id(previous, 'match_id'),
    player_ids_changed: Object.fromEntries(state.players.map(player => {
      const before = previous?.players.find(p => p.player_num === player.player_num);
      return [String(player.player_num), !!before && player.player_id !== before.player_id];
    })),
  };
  return value;
}

function gaps(script: string, step: string, server: Value | typeof MISSING,
  mock: Value | typeof MISSING, at = '$'): Gap[] {
  if (ignored[at]) return [];
  if (server !== MISSING && mock !== MISSING && server && mock &&
      typeof server === 'object' && typeof mock === 'object' &&
      !Array.isArray(server) && !Array.isArray(mock)) {
    const a = server as Record<string, Value>, b = mock as Record<string, Value>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
      .flatMap(k => gaps(script, step, k in a ? a[k] : MISSING,
        k in b ? b[k] : MISSING, `${at}.${k}`));
  }
  if (Array.isArray(server) && Array.isArray(mock)) {
    return Array.from({ length: Math.max(server.length, mock.length) }, (_, i) =>
      gaps(script, step, i < server.length ? server[i] : MISSING,
        i < mock.length ? mock[i] : MISSING, `${at}[${i}]`)).flat();
  }
  return server === MISSING || mock === MISSING || JSON.stringify(server) !== JSON.stringify(mock)
    ? [{ script, step, path: at, server: server === MISSING ? ABSENT : server,
         mock: mock === MISSING ? ABSENT : mock }]
    : [];
}

function canonical(value: Value): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function rootPath(path: string): string {
  const p = path.replace(/\[\d+\]/g, '[*]');
  if (p.startsWith('$.live.rows[*].')) return p;
  for (const root of ['$.loadout_pool', '$.readiness.board[*]', '$.nodes[*]', '$.stations[*]',
    '$.sync.rows[*]', '$.players[*].loadout', '$.recap.rows[*]', '$.live.rows[*]',
    '$.config.presentation']) {
    if (p === root || p.startsWith(`${root}.`) || p.startsWith(`${root}[`)) return root;
  }
  return p;
}

function groupOf(root: string): Group {
  if (/^\$\.lan\.(ip|join_secret|qr|ssid|ws_url)$/.test(root)) return 'by design';
  if (root === '$.feed[*]' || root === '$.recap.rows[*]' || root === '$.recap.honors[*]' ||
      root === '$.recap.after_end' || root === '$.recap.post_end' || root === '$.recap.post_end_facts' ||
      root.startsWith('$.recap.score.') || root.startsWith('$.recap.winner.') ||
      /^\$\.live\.rows\[\*\]\.(kills|deaths|assists|shots|shots_total|hits|accuracy|kd|streak|best_streak|multi_best|first_blood|after_end_kills|after_end_deaths|medals\[\*\])$/.test(root)) {
    return 'fixture';
  }
  // These paths reflect the seeded field: demo phone readings, offline items and kits.
  // Keep this list exact so a new readiness or sync field receives its own review.
  if (new Set([
    '$.nodes[*]', '$.stations[*]', '$.readiness.board[*]',
    '$.readiness.greens', '$.readiness.unrostered_phones',
    '$.sync.rows[*]', '$.sync.unconfigured[*]', '$.sync.totals.phone_game',
    '$.mc_confidence.confident', '$.mc_confidence.missing[*]', '$.mc_confidence.stale[*]',
    '$.players[*].loadout',
  ]).has(root)) return 'fixture';
  if (/^\$\.(kit\.(browsing|trying)|game\.config_id|recap\.(parked|post_end))/.test(root)) return 'cosmetic';
  return 'the mock shows it wrong';
}

// Each digest covers every raw tuple in one row of the human gap list.
// Keep the count so a duplicate tuple cannot disappear unnoticed.
function pinGaps(rows: Gap[]): PinnedGap[] {
  const grouped = new Map<string, { group: Group; path: string; tuples: string[] }>();
  for (const row of rows) {
    const path = rootPath(row.path);
    const group = groupOf(path);
    const key = JSON.stringify([group, path]);
    let found = grouped.get(key);
    if (!found) {
      found = { group, path, tuples: [] };
      grouped.set(key, found);
    }
    found.tuples.push(JSON.stringify([row.script, row.step, row.path,
      canonical(row.server), canonical(row.mock)]));
  }
  return [...grouped.values()].map(({ group, path, tuples }) => ({
    group, path, count: tuples.length,
    sha1: createHash('sha1').update(JSON.stringify(tuples.sort())).digest('hex').slice(0, 16),
  })).sort((a, b) => a.group.localeCompare(b.group) || a.path.localeCompare(b.path));
}

function screenOf(root: string): string {
  if (/^\$\.(config|game|game_pick|loadout_pool|versions)/.test(root)) return 'Games and Armory';
  if (/^\$\.(players|kit|teams)/.test(root)) return 'Kit';
  if (/^\$\.(readiness|lobby|sync)/.test(root)) return 'Lobby';
  if (/^\$\.(start|phase)/.test(root)) return 'Armed';
  if (/^\$\.(live|feed|mc_confidence)/.test(root)) return 'Live';
  if (/^\$\.(recap|end_delivery)/.test(root)) return 'Recap';
  if (/^\$\.stations/.test(root)) return 'Items';
  return 'Command Bar and other State';
}

function reasonOf(root: string): string {
  const known: Record<string, string> = {
    '$.loadout_pool': 'The real Compiler derives a different allowed catalogue.',
    '$.versions': 'The mock omits version metadata read by Armory.',
    '$.nodes[*]': 'The identities match; fake status reports differ from the demo readings.',
    '$.stations[*]': 'The demo station reports and offline history have no equivalent setup call.',
    '$.readiness.board[*]': 'The fake phone status differs from the demo phone readings.',
    '$.players[*].loadout': 'The mock seeds selected demo kits; the server creates default kits.',
    '$.players[*].ready': 'Server host override and mock ready rules differ in this harness.',
    '$.sync.rows[*]': 'The seeded field binds different phones and reports different phone states.',
    '$.readiness.roster_size': 'The mock counts every demo gun after a player leaves the roster.',
    '$.feed[*]': 'The mock emits a demo sync feed entry when the match goes live.',
    '$.recap.rows[*]': 'The mock fills recap rows from seeded demo results after this empty match.',
    '$.recap.honors[*]': 'The mock awards honours from its seeded demo results.',
    '$.recap.after_end': 'The mock seeds three late facts that the compared match never produced.',
    '$.recap.post_end_facts': 'The mock counts three seeded late facts that the compared match never produced.',
    '$.recap.post_end': 'The mock uses a separate demo field for its seeded late facts.',
    '$.config.presentation': 'The mock omits the server presentation settings.',
    '$.lan.ip': 'The recording pins a safe network address.',
    '$.lan.join_secret': 'The recording pins a safe join secret.',
    '$.lan.qr': 'The recording pins a safe QR URL.',
    '$.lan.ssid': 'The recording pins a safe network name.',
    '$.lan.ws_url': 'The recording pins a safe WebSocket URL.',
  };
  if (known[root]) return known[root];
  if (/^\$\.start\.per_node\.[^.]+\.last_seen_ms$/.test(root)) return 'The fake and demo phone receipt times differ at this step.';
  if (root.startsWith('$.readiness.')) return 'The fake phone status differs from the mock demo readings.';
  if (root.startsWith('$.sync.')) return 'The starting field binds different phones in the server and mock.';
  if (root.startsWith('$.recap.score.') || root.startsWith('$.recap.winner.')) return 'The mock derives this from seeded demo recap scores.';
  if (root.startsWith('$.live.rows[*].after_end_')) return 'The mock omits these zero fact counts in its demo live rows.';
  if (root.startsWith('$.live.rows[*].')) return 'The recorded server and mock live row values differ.';
  if (root.startsWith('$.mc_confidence.')) return 'The fake and demo phone status inputs differ.';
  return 'The recorded server and mock values differ.';
}

function report(rows: Gap[]): string {
  type Summary = { root: string; group: Group; screen: string; count: number;
    steps: Set<string>; example: Gap };
  const grouped = new Map<string, Summary>();
  for (const row of rows) {
    const root = rootPath(row.path);
    const group = groupOf(root);
    const key = `${group}:${root}`;
    const found = grouped.get(key);
    if (found) { found.count++; found.steps.add(`${row.script}/${row.step}`); }
    else grouped.set(key, { root, group, screen: screenOf(root), count: 1,
      steps: new Set([`${row.script}/${row.step}`]), example: row });
  }
  const groups: Group[] = ['by design', 'fixture', 'the mock shows it wrong', 'cosmetic'];
  const summaries = [...grouped.values()];
  const sample = (v: Value) => {
    const json = JSON.stringify(v);
    return `\`${json.length > 120 ? `${json.slice(0, 117)}...` : json}\``;
  };
  const counted = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  const out = [
    '# Recorded mock gaps', '',
    'Generated by `BRX_GENERATE_MOCK_RECORDED_GAPS=1 npx vitest run --configLoader runner test/mock-recorded.test.ts`.',
    'The JSON fixture pins each grouped path with a raw count and a digest of every script, step, path, server and mock tuple. Array indices appear as `[*]` here.', '',
    `**Raw gaps:** ${rows.length.toLocaleString('en-GB')}. **Grouped paths:** ${summaries.length}.`, '',
    '| Group | Raw gaps | Grouped paths |', '| --- | ---: | ---: |',
    ...groups.map(g => `| ${g} | ${summaries.filter(s => s.group === g).reduce((n, s) => n + s.count, 0).toLocaleString('en-GB')} | ${summaries.filter(s => s.group === g).length} |`),
    '', '## Harness notes', '',
    '- The server ready step uses `host_override=True`; the mock has no matching flag.',
    '- The mock start ignores `force`. The server start applies it.',
    '- The test uses the mock’s `?norandom=1` switch. Its twenty timer ticks and the server’s two `tick()` calls contain no kills.',
    '- Live scores therefore compare the same empty match.',
    '- At the whistle, the mock fills recap scores and late facts from demo data. No test-only switch suppresses that fallback.',
    '- The resulting score and feed gaps sit under fixture: the mock’s demo simulation.',
    '- Every bound fake phone answers a push by node, including newly claimed phones. GUN-D has no phone.',
    '- The recorder phones ack a push and report START at once, so pending acks and slow phones are not compared.',
    '- At LIVE, the fake phones report at the same instant as the last demo tick. NOMAD restates its pool claim.',
    '- At go-live, every bound phone reports. The alive, bound player with the lowest player number then reports protection owed and goes silent for 10 seconds.',
    '- The seeded demo app versions are too old for server start. The harness upgrades them at that step.',
    '- The fake phones use the demo gun names, node types and initial app versions.',
    '- GUN-D is unpowered and has no phone. The two replacement players adopt their connected demo phones.',
    '- Time rebasing does not detect the same offset error in `t` and every timestamp. The test also compares each step’s change in `t`.', '',
  ];
  for (const group of groups) {
    out.push(`## ${group}`, '');
    const inGroup = summaries.filter(s => s.group === group);
    for (const screen of [...new Set(inGroup.map(s => s.screen))]) {
      out.push(`### ${screen}`, '');
      for (const s of inGroup.filter(x => x.screen === screen).sort((a, b) => b.count - a.count || a.root.localeCompare(b.root))) {
        out.push(`- ${'`'}${s.root}${'`'}: ${reasonOf(s.root)} ${counted(s.count, 'raw gap')} across ${counted(s.steps.size, 'step')}. First: ${s.example.script} / ${s.example.step}. Server: ${sample(s.example.server)}. Mock: ${sample(s.example.mock)}.`);
      }
      out.push('');
    }
  }
  return `${out.join('\n')}\n`;
}

async function replay(onPhaseStep?: (row: PhaseStep) => void): Promise<Gap[]> {
  const all: Gap[] = [];
  const snapshots = recordedSnapshots();
  for (const [script, steps] of Object.entries(recording.scripts)) {
    let previousServer: State | undefined;
    let previousMock: State | undefined;
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    let seed = 1;
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    });
    const previousUrl = window.location.href;
    window.history.replaceState({}, '', '?norandom=1');
    const b = new MockBackend();
    try {
      if (script !== 'config') {
        const setup = await b.putConfig({ time_limit_s: 60, teams: TEAMS.slice(0, 2) });
        expect(setup.ok).toBe(true);
      } else {
        expect((await b.getState()).phase).toBe('muster');
      }
      for (const step of steps as Step[]) {
        switch (step.action) {
          case 'snapshot': break;
          case 'remove': {
            const player = (await b.getState()).players.find(p => p.display === step.display)!;
            await b.deletePlayer(player.player_id); break;
          }
          case 'add': {
            await b.addPlayer({ display: step.display, team_id: step.team_id, gun_id: step.gun_id });
            expect((await b.getState()).players.some(p => p.display === step.display), step.name).toBe(true);
            break;
          }
          case 'pick': {
            const r = await b.pick({ pieces: { mode: `builtin:mode:${step.mode}` }, match: { time_limit_s: step.time_limit_s } });
            expect(r.ok, step.name).toBe(true); break;
          }
          case 'load': await b.loadGame(); break;
          case 'phase': await b.setPhase(step.phase, step.force); break;
          case 'config': {
            const r = await b.putConfig({ scoring: step.scoring });
            expect(r.ok, step.name).toBe(true); break;
          }
          case 'ready': {
            const player = (await b.getState()).players.find(p => p.display === step.display)!;
            await b.setReady(player.player_id, true); break;
          }
          case 'ready_demo': {
            for (const player of (await b.getState()).players) {
              if (player.display !== 'ALPHA' && player.display !== 'BRAVO') {
                await b.setReady(player.player_id, true);
              }
            }
            break;
          }
          case 'push': await b.pushLobby(step.force); break;
          case 'start': await b.start(step.runway_s, step.force); break;
          case 'advance': vi.advanceTimersByTime(step.ms); break;
          case 'control': await b.control(step.cmd, step.cmd === 'panic'); break;
          case 'abort': await b.abort(); break;
          case 'new': await b.newSession(step.keep_roster); break;
          case 'next': await b.nextMatch(); break;
          default: throw new Error(`unknown action ${step.action}`);
        }
        const wanted = snapshots.find(row => row.script === script && row.step === step.name);
        expect(wanted, `${script}/${step.name}`).toBeDefined();
        const server = wanted!.state as State;
        const mock = await b.getState();
        onPhaseStep?.({ script, step: step.name, from: previousServer?.phase ?? null,
          server: server.phase, mock: mock.phase });
        if (step.action === 'advance') {
          // The query switch must keep the compared match free of simulated facts.
          for (const state of [server, mock]) {
            expect(state.live?.rows.every(row => row.kills === 0 && row.deaths === 0),
              `${script}/${step.name}: unexpected score`).toBe(true);
            expect(state.feed.some(entry => entry.kind === 'kill'),
              `${script}/${step.name}: unexpected kill feed`).toBe(false);
          }
        }
        if (script === 'config') expect(mock.phase, 'config must move MUSTER to BUILD').toBe('build');
        all.push(...gaps(script, step.name, comparedState(server, previousServer), comparedState(mock, previousMock)));
        previousServer = server;
        previousMock = mock;
      }
    } finally {
      b.dispose();
      window.history.replaceState({}, '', previousUrl);
      random.mockRestore();
      vi.useRealTimers();
    }
  }
  return all;
}

describe('recorded server State against the console mock', () => {
  it('matches the server phase after every recorded script step', async () => {
    const phases: PhaseStep[] = [];
    await replay(row => phases.push(row));
    expect(phases).toHaveLength(recording.snapshots.length);
    const transitions = phases.filter(row => row.from !== null && row.from !== row.server);
    expect([...new Set(transitions.map(row => row.server))].sort()).toEqual(
      ['armed', 'build', 'kit', 'live', 'lobby', 'muster', 'recap']);
    const mismatches = phases.filter(row => row.server !== row.mock);
    // The slice 1 whole-State pins already cover $.phase; this is the explicit, readable check. It must stay empty:
    // a phase that differs is a bug to fix, not a row to pin here.
    expect(mismatches).toEqual([]);
  });
  it('distinguishes absent, null and present', () => {
    expect(gaps('check', 'check', MISSING, null)).toHaveLength(1);
    expect(gaps('check', 'check', null, MISSING)).toHaveLength(1);
    expect(gaps('check', 'check', MISSING, '<missing>')).toHaveLength(1);
    expect(gaps('check', 'check', null, null)).toHaveLength(0);
  });
  it('pins every grouped gap row to all raw values and script steps', async () => {
    const rows = await replay();
    const actual = pinGaps(rows);
    if (process.env.BRX_GENERATE_MOCK_RECORDED_GAPS === '1') {
      fs.writeFileSync(path.join(__dirname, 'fixtures/mock-recorded-gaps.json'),
        JSON.stringify({
          _comment: 'Each row matches a group and path in mock-gap-list.md. count is the number of raw gaps. sha1 is the first 16 hex digits of SHA-1 over a JSON array of sorted serialised [script, step, path, canonical(server), canonical(mock)] tuples. A missing value is {"__state_absent__":true}.',
          rows: actual,
        }, null, 2) + '\n');
      fs.writeFileSync(path.join(__dirname, 'fixtures/mock-gap-list.md'), report(rows));
    } else {
      const pinned = (expectedGaps as unknown as { rows: PinnedGap[] }).rows;
      const expectedByRow = new Map(pinned.map(row => [JSON.stringify([row.group, row.path]), row]));
      const actualByRow = new Map(actual.map(row => [JSON.stringify([row.group, row.path]), row]));
      for (const key of [...new Set([...expectedByRow.keys(), ...actualByRow.keys()])].sort()) {
        const before = expectedByRow.get(key);
        const after = actualByRow.get(key);
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          const row = before ?? after!;
          throw new Error(`mock gap row ${row.group} / ${row.path} changed: ` +
            `expected ${JSON.stringify(before ?? null)}, actual ${JSON.stringify(after ?? null)}. ` +
            `${REGEN_HELP} Detail: webapp/mc/test/fixtures/mock-gap-list.md`);
        }
      }
    }
  });
});
