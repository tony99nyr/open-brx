import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import recording from './fixtures/mock-recorded.json';
import expectedGaps from './fixtures/mock-recorded-gaps.json';
import { MockBackend } from '../src/mock/backend';
import { TEAMS } from '../src/mock/data';
import type { State } from '../src/api/types';

type Value = null | boolean | number | string | Value[] | { [key: string]: Value };
type Step = { name: string; action: string; [key: string]: any };
type Gap = { script: string; step: string; path: string; server: Value; mock: Value };
type RecordedGap = {
  script: string; step: string[]; path: string;
  kind: 'different' | 'server_absent' | 'mock_absent'; server: string; mock: string;
};
const MISSING = Symbol('missing');
const ABSENT: Value = { __state_absent__: true };
const T0 = 1_700_000_000_000;

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
    // Timestamps are wall-clock-sized. Durations and ages stay as given.
    if (typeof value === 'number' && value > T0 / 2) return value - base;
    return value;
  }
  return walk(source);
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

function digest(value: Value): string {
  return createHash('sha1').update(canonical(value)).digest('hex').slice(0, 12);
}

// A row holds one path/value pair for a script. Its step array names every
// occurrence. This keeps the fixture small without weakening the step check.
function compact(rows: Gap[]): RecordedGap[] {
  const grouped = new Map<string, RecordedGap>();
  for (const row of rows) {
    const kind = row.server === ABSENT ? 'server_absent'
      : row.mock === ABSENT ? 'mock_absent' : 'different';
    const server = digest(row.server), mock = digest(row.mock);
    const key = JSON.stringify([row.script, row.path, kind, server, mock]);
    const group = grouped.get(key);
    if (group) group.step.push(row.step);
    else grouped.set(key, { script: row.script, step: [row.step], path: row.path,
      kind, server, mock });
  }
  return [...grouped.values()];
}

async function replay(): Promise<Gap[]> {
  const all: Gap[] = [];
  for (const [script, steps] of Object.entries(recording.scripts)) {
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
      for (const p of (await b.getState()).players) await b.deletePlayer(p.player_id);
      const teams = ['red', 'blue'].map(id => TEAMS.find(t => t.team_id === id)!);
      const setup = await b.putConfig({ mode: 'tdm', teams, time_limit_s: 60 });
      expect(setup.ok).toBe(true);
      await b.setPhase('build');
      for (const step of steps as Step[]) {
        switch (step.action) {
          case 'snapshot': break;
          case 'add': await b.addPlayer({ display: step.display, team_id: step.team_id, gun_id: step.gun_id }); break;
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
          case 'push': await b.pushLobby(step.force); break;
          case 'start': await b.start(step.runway_s, step.force); break;
          case 'advance': vi.advanceTimersByTime(step.ms); break;
          case 'control': await b.control(step.cmd, step.cmd === 'panic'); break;
          case 'abort': await b.abort(); break;
          case 'new': await b.newSession(step.keep_roster); break;
          case 'next': await b.nextMatch(); break;
          default: throw new Error(`unknown action ${step.action}`);
        }
        const wanted = recording.snapshots.find(row => row.script === script && row.step === step.name);
        expect(wanted, `${script}/${step.name}`).toBeDefined();
        all.push(...gaps(script, step.name, normalise(wanted!.state as State), normalise(await b.getState())));
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
  it('distinguishes absent, null and present', () => {
    expect(gaps('check', 'check', MISSING, null)).toHaveLength(1);
    expect(gaps('check', 'check', null, MISSING)).toHaveLength(1);
    expect(gaps('check', 'check', MISSING, '<missing>')).toHaveLength(1);
    expect(gaps('check', 'check', null, null)).toHaveLength(0);
  });
  it('pins every gap to both current values at one script step', async () => {
    const actual = compact(await replay());
    if (process.env.BRX_GENERATE_MOCK_RECORDED_GAPS === '1') {
      fs.writeFileSync(path.join(__dirname, 'fixtures/mock-recorded-gaps.json'),
        JSON.stringify(actual) + '\n');
    } else {
      expect(actual).toEqual(expectedGaps);
    }
  });
});
