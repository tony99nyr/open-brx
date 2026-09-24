// F-row hotfix (0.4.10): a player phone and an MC-armed station must scope presence by the SAME game byte.
// MC arms a station with `station_config.game` and now hands every player the same number as
// `config.game_byte`. Before this, the player hashed its `config_id` instead, so an MC-armed respawn,
// hill or pickup station and the players ignored each other (beacon.js Presence drops a non-zero
// game byte that differs). mcp/tests/test_mc_stations_game_byte.py drives MC's real push path and
// reads the byte back through `configGameByte` below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeUuid, Presence, PLAYER_STATE, configGameByte } from '../src/beacon.js';

const MC_GAME = 3;   // what MC armed the station with (`station_config.game`)

function present(p, uuid, t0 = 1000) {
  for (let t = t0; t <= t0 + 2000; t += 200) { p.observe([uuid], -50, t); p.tick(t); }
}

test('a player whose config carries game_byte sees the MC-armed station, and the station sees the player', () => {
  const cfg = { config_id: 'a1b2c3d4', game_byte: MC_GAME };
  const game = configGameByte(cfg);
  assert.equal(game, MC_GAME, 'the phone takes MC\'s byte verbatim');
  // the player's presence hears the station MC armed
  const player = new Presence({ dwellMs: 800, defaultThreshold: -74, game });
  const station = encodeUuid({ role: 'station', id: 7, kind: 'respawn', team: 1, state: 1, game: MC_GAME });
  present(player, station);
  assert.equal(player.stations().filter(e => e.present).length, 1, 'the MC-armed station is present to the player');
  // ...and the station (utility.js: Presence({game: station_config.game})) hears the player's advert
  const stationSide = new Presence({ dwellMs: 800, defaultThreshold: -74, game: MC_GAME });
  const advert = encodeUuid({ role: 'player', id: 4, team: 1, state: PLAYER_STATE.alive, game });
  assert.notEqual(stationSide.observe([advert], -50, 1000), null, 'the station accepts the player advert');
});

test('CONTROL: without game_byte (an older MC) the phone uses 0 = any game, never the config hash', () => {
  const cfg = { config_id: 'a1b2c3d4' };
  assert.equal(configGameByte(cfg), 0);
  assert.equal(configGameByte(null), 0);
  assert.equal(configGameByte({ game_byte: 0 }), 0);
  assert.equal(configGameByte({ game_byte: 'x' }), 0, 'a malformed value is not a game');
  assert.equal(configGameByte({ game_byte: 256 }), 0, 'outside 1..255 is not a game byte');
  // 0 on the player side accepts an MC-armed station and is accepted by it (beacon rule: either side 0)
  const player = new Presence({ dwellMs: 800, defaultThreshold: -74, game: configGameByte(cfg) });
  present(player, encodeUuid({ role: 'station', id: 7, kind: 'respawn', team: 1, state: 1, game: MC_GAME }));
  assert.equal(player.stations().filter(e => e.present).length, 1);
  const stationSide = new Presence({ game: MC_GAME });
  assert.notEqual(stationSide.observe([encodeUuid({ role: 'player', id: 4, team: 1, game: 0 })], -50, 1000), null);
  // and the rule still scopes: a DIFFERENT non-zero byte is another match's station
  const scoped = new Presence({ game: configGameByte({ game_byte: 2 }) });
  assert.equal(scoped.observe([encodeUuid({ role: 'station', id: 7, kind: 'respawn', game: MC_GAME })], -50, 1000), null);
});

test('app.js takes presence.game and its own advert from the one helper', () => {
  const src = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(src, /presence\.game = configGameByte\(st\.config\)/, 'presence scope');
  assert.match(src, /game: configGameByte\(st\.config\)/, 'the player advert');
  assert.doesNotMatch(src, /gameByte\(st\.config\.config_id\)/, 'the config_id hash is gone');
});
