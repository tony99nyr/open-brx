import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as contract from '../src/transport/contract.gen.js';

const root = fileURLToPath(new URL('../', import.meta.url));

test('team colours and inks in both HTML files match the generated contract', () => {
  for (const file of ['www/index.html', 'www/utility.html']) {
    const html = readFileSync(`${root}/${file}`, 'utf8');
    contract.TEAM_KEYS.forEach((key, tid) => {
      const colour = new RegExp(`--team-${key}\\s*:\\s*(${contract.TEAM_COLOUR_HEX[tid]})\\b`, 'i');
      const ink = new RegExp(`\\[data-team=["']${key}["']\\][^}]*--team-ink\\s*:\\s*(${contract.TEAM_INK_HEX[tid]})\\b`, 'i');
      assert.match(html, colour, `${file}: --team-${key}`);
      assert.match(html, ink, `${file}: [data-team=${key}] --team-ink`);
    });
  }
});

const MODULES = ['src/engine.js', 'src/powerup-player.js', 'src/beacon.js', 'src/control.js', 'src/utility.js', 'src/app.js',
  ...readdirSync(`${root}/src/hud`).filter(file => file.endsWith('.js')).map(file => `src/hud/${file}`)];

test('phone modules do not redeclare generated contract constants', () => {
  const names = Object.keys(contract).join('|');
  const declaration = new RegExp(`\\b(?:const|let|var)\\s+(?:${names})\\s*=`, 'm');
  for (const file of MODULES) {
    const source = readFileSync(`${root}/${file}`, 'utf8');
    assert.doesNotMatch(source, declaration, `${file} declares a generated contract constant`);
  }
});

// Review #4 polish: a module may keep its own name for a generated value (other code imports that name), but the
// alias must read the generated constant, never restate the number.
const ALIASES = {
  'src/beacon.js': { MAGIC: 'ADVERT_MAGIC', VERSION: 'ADVERT_VERSION', ROLE: 'ADVERT_ROLE', TEAM_ANY: 'STATION_TEAM_ANY', MEDIAN_SAMPLES: 'PRESENCE_MEDIAN_SAMPLES', EXIT_GRACE_MS: 'PRESENCE_EXIT_GRACE_MS',
    EXIT_BAND_DB: 'PRESENCE_EXIT_BAND_DB', SIGHT_WINDOW_MS: 'PRESENCE_SIGHT_WINDOW_MS', SIGHT_MS: 'PRESENCE_SIGHT_MS',
    SIGHT_RECENT_MAX: 'PRESENCE_SIGHT_RECENT_MAX' },
  'src/control.js': { CONTROL_STATE: 'ADVERT_CONTROL_STATE', REFUSED_TID: 'HILL_REFUSED_TID', DEFAULT_CAPTURE_S: 'HILL_CAPTURE_S', DEFAULT_NET_CAP: 'HILL_NET_CAP',
    MAX_STEP_MS: 'HILL_MAX_STEP_MS' },
  'src/engine.js': { HILL_NEUTRAL_TEAM: 'HILL_REFUSED_TID' },
  'src/powerup-player.js': { POWERUP_THRESHOLD_DEFAULT: 'PHONE_POWERUP_THRESHOLD_DBM' },
  'src/hud/deathscreen.js': { HILL_NEUTRAL_TID: 'HILL_REFUSED_TID' },
};

test('a local alias of a generated value reads the generated constant, not a literal', () => {
  for (const [file, aliases] of Object.entries(ALIASES)) {
    const source = readFileSync(`${root}/${file}`, 'utf8');
    for (const [alias, generated] of Object.entries(aliases)) {
      assert.ok(generated in contract, `${generated} is not a generated name`);
      assert.match(source, new RegExp(`\\bconst\\s+${alias}\\s*=\\s*${generated}\\s*;`), `${file}: ${alias} must be = ${generated}`);
    }
  }
});
