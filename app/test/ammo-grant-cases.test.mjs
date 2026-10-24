// The AMMO pickup grant against the cases it shares with the bench stage (fixtures/ammo-grant-cases.json; the stage reads
// the same file in mcp/tests/test_ammo_grant_cases.py), so `_ammoShort` and `grantAmmo` have one statement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PlayerPowerups } from '../src/powerup-player.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'ammo-grant-cases.json'), 'utf8'));
const rows = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [+k, v]));

function host(c, rec) {
  return {
    show() {}, log() {}, now: () => 1000, lifeSeq: 1, alive: true, activeSlot: c.active ?? 0,
    spawnAmmo: () => rows(c.spawn), liveAmmo: () => rows(c.live),
    acctWrote: (slot, mag, res) => rec.acct.push([slot, mag, res]), setPrev: (slot, mag, res) => rec.prev.push([slot, mag, res]),
    showSlot: slot => rec.shown.push(slot),
    write: frames => { rec.writes.push(...frames); },   // F589: the grant writes once and settles its own failure
  };
}

for (const c of FIXTURE.cases) {
  test(`AMMO grant cases: ${c.name}`, () => {
    const rec = { writes: [], acct: [], prev: [], shown: [] };
    const pu = new PlayerPowerups(host(c, rec));
    const short = pu._ammoShort(c.item);
    assert.deepEqual(short == null ? null : Object.fromEntries(Object.entries(short).map(([k, v]) => [String(k), v])), c.short);
    pu.grantAmmo(9, { name: 'AMMO', ...c.item }, 1000);
    assert.deepEqual(rec.writes, c.frames);
    assert.deepEqual(rec.acct, c.acct, 'the account takes the grant first (its echo is bookkeeping)');
    assert.deepEqual(rec.prev, c.acct, 'and so do the previous counts');
    assert.deepEqual(rec.shown, c.shown == null ? [] : [c.shown]);
  });
}
