// O18: the launcher prunes old evidence by a clear rule and never leaves the evidence root.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirSize, formatBytes, pruneEvidence } from '../lib/evidence.mjs';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 4, 12);
const id = n => `202609${String(n).padStart(2, '0')}T120000Z-abcdef`;

function tree(t, ids, { ageDays = 90, files = {} } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'brx-evidence-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const sessions = join(base, 'sessions');
  mkdirSync(sessions);
  for (const name of ids) {
    const dir = join(sessions, name);
    mkdirSync(dir);
    writeFileSync(join(dir, 'mc.log'), 'x'.repeat(100));
    for (const [file, body] of Object.entries(files)) writeFileSync(join(dir, file), body);
    const when = new Date(NOW - ageDays * DAY);
    utimesSync(dir, when, when);
  }
  return { base, sessions };
}

test('keeps the newest N and the current launch, removes the rest and logs each one', t => {
  const ids = [1, 2, 3, 4, 5, 6].map(id);
  const { sessions } = tree(t, ids);
  const lines = [];
  const r = pruneEvidence({ sessionsDir: sessions, currentId: ids[0], keep: 2, days: 30, now: NOW, log: l => lines.push(l) });
  assert.deepEqual(r.removed.map(x => x.id), [ids[1], ids[2], ids[3]]);
  assert.equal(lines.length, 3);
  assert.ok(lines[0].includes(ids[1]));
  for (const keep of [ids[0], ids[4], ids[5]]) assert.ok(existsSync(join(sessions, keep)), keep);
  for (const gone of [ids[1], ids[2], ids[3]]) assert.ok(!existsSync(join(sessions, gone)), gone);
});

test('31 folders with the default rule remove only the oldest and log its id', t => {
  const ids = Array.from({ length: 31 }, (_, i) => `2026${String(1 + Math.floor(i / 28)).padStart(2, '0')}${String(1 + (i % 28)).padStart(2, '0')}T000000Z-abcdef`);
  const { sessions } = tree(t, ids);
  const lines = [];
  const r = pruneEvidence({ sessionsDir: sessions, now: NOW, log: l => lines.push(l) });
  assert.deepEqual(r.removed.map(x => x.id), [ids[0]]);
  assert.ok(lines[0].includes(ids[0]));
});

test('a folder newer than the day limit survives even outside the newest N', t => {
  const ids = [1, 2, 3].map(id);
  const { sessions } = tree(t, ids, { ageDays: 2 });
  const r = pruneEvidence({ sessionsDir: sessions, keep: 1, days: 30, now: NOW });
  assert.deepEqual(r.removed, []);
});

test('--keep-all removes nothing', t => {
  const ids = [1, 2, 3, 4].map(id);
  const { sessions } = tree(t, ids);
  const r = pruneEvidence({ sessionsDir: sessions, keep: 1, keepAll: true, now: NOW });
  assert.deepEqual(r.removed, []);
  assert.equal(r.count, 4);
  assert.ok(ids.every(n => existsSync(join(sessions, n))));
});

test('a running session is left alone for a day, a stopped one is not', t => {
  const ids = [1, 2, 3].map(id);
  const { sessions } = tree(t, ids, { ageDays: 90 });
  writeFileSync(join(sessions, ids[0], 'manifest.json'), JSON.stringify({ status: 'running' }));
  const recent = new Date(NOW - 3600_000);
  utimesSync(join(sessions, ids[0]), recent, recent);
  const r = pruneEvidence({ sessionsDir: sessions, keep: 1, days: 0, now: NOW });
  assert.deepEqual(r.removed.map(x => x.id), [ids[1]]);
  assert.ok(existsSync(join(sessions, ids[0])));
});

test('never follows a symlink out of the root and ignores foreign names', t => {
  const ids = [1, 2, 3].map(id);
  const { base, sessions } = tree(t, ids);
  const outside = join(base, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'precious.txt'), 'keep me');
  const link = `20260801T000000Z-aaaaaa`;
  symlinkSync(outside, join(sessions, link));
  mkdirSync(join(sessions, 'notes'));
  const r = pruneEvidence({ sessionsDir: sessions, keep: 1, days: 0, now: NOW });
  assert.ok(existsSync(join(outside, 'precious.txt')));
  assert.ok(existsSync(join(sessions, 'notes')));
  assert.ok(!r.removed.some(x => x.id === link));
  assert.deepEqual(r.removed.map(x => x.id).sort(), [ids[0], ids[1]]);
});

test('a missing root is not an error, and sizes add up', t => {
  assert.deepEqual(pruneEvidence({ sessionsDir: join(tmpdir(), 'brx-no-such-root-xyz') }), { sizeBefore: 0, count: 0, removed: [] });
  const { sessions } = tree(t, [id(1), id(2)], { files: { 'session.sqlite': 'y'.repeat(50) } });
  assert.equal(dirSize(sessions), 2 * 150);
  assert.equal(pruneEvidence({ sessionsDir: sessions, now: NOW }).sizeBefore, 300);
  assert.equal(formatBytes(1536), '1.5 KB');
});
