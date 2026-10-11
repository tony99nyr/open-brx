// The phone station's station_config rule against the cases it shares with the Stick (A4, review 2026-10-10).
// hardware/m5sticks3/test/test_station_config_cases.cpp runs parse_station_config over the same file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStationConfig } from '../src/stationconfig.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'station-config-cases.json'), 'utf8'));

/** The fields the shared cases compare: a refusal, or the parsed assignment without the platform's own threshold. */
function shared(cfg) {
  if (!cfg.ok) return { refused: true };
  return { kind: cfg.kind, team: cfg.team, id: cfg.id, game: cfg.game, valid_ids: cfg.valid_ids, lock_s: cfg.lock_s, has_item: cfg.item != null };
}

test('the phone parses every station_config case as the Stick does', () => {
  assert.ok(FIXTURE.cases.length >= 25);
  for (const c of FIXTURE.cases) assert.deepEqual(shared(parseStationConfig(c.body)), c.expect, c.name);
});

test('a refusal says why, and the cases refuse and accept', () => {
  const refused = FIXTURE.cases.filter(c => c.expect.refused);
  assert.ok(refused.length >= 10 && refused.length < FIXTURE.cases.length);
  for (const c of refused) assert.match(parseStationConfig(c.body).refused, /\S/, c.name);
});
