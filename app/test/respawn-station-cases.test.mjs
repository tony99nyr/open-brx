// F658 (A86): the respawn station a down player uses, against the cases the phone shares with the stage
// (mcp/tests/test_respawn_station_cases.py). The phone decides whether a station is enabled: its own config.stations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Presence, encodeUuid, respawnStation } from '../src/beacon.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'respawn-station-cases.json'), 'utf8'));

for (const c of FIXTURE.cases) {
  test(`respawn station case: ${c.name}`, () => {
    const config = c.config_stations == null ? {} : { stations: c.config_stations };
    // one tracker across the player's games, as app.js keeps one: a new game byte goes through Presence's game setter
    const presence = new Presence({ game: c.player.games[0] });
    let now = 1000;
    for (const g of c.player.games) {
      presence.game = g;
      now += 500;
      for (const s of c.heard) {
        presence.observe([encodeUuid({ role: 'station', id: s.id, kind: s.kind, team: s.team, state: s.state, game: s.game })], s.rssi, now);
      }
      presence.tick(now);
      const byId = new Map(c.heard.map(s => [s.id, s]));
      // the presence verdict is the case's (dwell and exit are presence-hill-cases.json's business), strongest first
      const entries = presence.stations().map(e => ({ ...e, present: byId.get(e.id).present, rssi: byId.get(e.id).rssi })).sort((a, b) => b.rssi - a.rssi);
      if (c.expect_heard) assert.deepEqual(entries.map(e => e.id).sort((a, b) => a - b), c.expect_heard, `game ${g}: heard`);
      const got = respawnStation(entries, config, c.player.tid);
      assert.equal(got ? got.id : null, c.expect, `game ${g}`);
    }
  });
}

test('the respawn case file is not empty', () => { assert.ok(FIXTURE.cases.length >= 8); });
