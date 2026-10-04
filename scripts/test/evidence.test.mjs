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

// Writing a file into a folder refreshes its mtime: call this after the writes to age it again.
const age = (sessions, ids, days = 90) => ids.forEach(n => { const w = new Date(NOW - days * DAY); utimesSync(join(sessions, n), w, w); });

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

test('an old folder whose manifest says running (live pid) is kept whatever its age or directory mtime', t => {
  const ids = [1, 2, 3].map(id);
  const { sessions } = tree(t, ids, { ageDays: 90 });
  writeFileSync(join(sessions, ids[0], 'manifest.json'), JSON.stringify({ status: 'running', pid: process.pid }));
  writeFileSync(join(sessions, ids[1], 'manifest.json'), JSON.stringify({ status: 'running' }));
  age(sessions, ids);
  const r = pruneEvidence({ sessionsDir: sessions, keep: 0, days: 0, now: NOW });
  assert.deepEqual(r.removed.map(x => x.id), [ids[2]]);
});

test('a running manifest whose process is gone is a crash and can be pruned', t => {
  const ids = [1, 2].map(id);
  const { sessions } = tree(t, ids, { ageDays: 90 });
  writeFileSync(join(sessions, ids[0], 'manifest.json'), JSON.stringify({ status: 'running', pid: 2 ** 22 + 12345 }));
  age(sessions, ids);
  const r = pruneEvidence({ sessionsDir: sessions, keep: 0, days: 0, now: NOW });
  assert.equal(r.removed.length, 2);
});

test('a symlinked sessions root is refused with a log line and nothing is deleted', t => {
  const { base } = tree(t, [id(1), id(2), id(3)]);
  const link = join(base, 'linked-sessions');
  symlinkSync(join(base, 'sessions'), link);
  const lines = [];
  const r = pruneEvidence({ sessionsDir: link, keep: 0, days: 0, now: NOW, log: l => lines.push(l) });
  assert.deepEqual(r.removed, []);
  assert.ok(lines.some(l => /symlink/i.test(l)));
  assert.ok(existsSync(join(base, 'sessions', id(1))));
});

test('a real root prunes real directories only, and launch-named symlinks never count as newest', t => {
  const ids = [1, 2, 3].map(id);
  const { base, sessions } = tree(t, ids);
  const outside = join(base, 'outside');
  mkdirSync(outside);
  for (const n of ['29991231T000000Z-aaaaa1', '29991231T000000Z-aaaaa2', '29991231T000000Z-aaaaa3']) symlinkSync(outside, join(sessions, n));
  const r = pruneEvidence({ sessionsDir: sessions, keep: 2, days: 0, now: NOW });
  assert.equal(r.count, 3);
  assert.deepEqual(r.removed.map(x => x.id), [ids[0]]);
});

test('a folder created in the last minutes is never pruned, whatever the settings', t => {
  const ids = [1, 2].map(id);
  const { sessions } = tree(t, ids, { ageDays: 0 });
  const fresh = new Date(NOW - 60_000);
  utimesSync(join(sessions, ids[0]), fresh, fresh);
  utimesSync(join(sessions, ids[1]), fresh, fresh);
  const r = pruneEvidence({ sessionsDir: sessions, keep: 0, days: 0, now: NOW });
  assert.deepEqual(r.removed, []);
});

test('failed launches (no store, never got going) do not count towards the newest N', t => {
  const ids = [1, 2, 3, 4].map(id);
  const { sessions } = tree(t, ids, { files: {} });
  writeFileSync(join(sessions, ids[0], 'session.sqlite'), 'db');       // the one real session, oldest
  for (const n of ids.slice(1)) writeFileSync(join(sessions, n, 'manifest.json'), JSON.stringify({ status: 'starting' }));
  age(sessions, ids);
  const r = pruneEvidence({ sessionsDir: sessions, keep: 1, days: 0, now: NOW });
  assert.ok(existsSync(join(sessions, ids[0])), 'the real session holds the newest-1 slot');
  assert.deepEqual(r.removed.map(x => x.id).sort(), ids.slice(1));
});
