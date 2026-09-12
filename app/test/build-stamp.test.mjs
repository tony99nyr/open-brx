// The build stamp (contracts A29). `__APP_VER__` is what answers "is that phone running the code we just
// fixed" at the bench, so the ONE thing it must never do is say `clean` about a tree it could not read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { gitStamp, gitIn } from '../scripts/build.mjs';

/** A fake git: `rev-parse` answers, and `status` does whatever the test says. */
const fakeGit = (onStatus) => args => {
  if (args[0] === 'rev-parse') return 'abc1234';
  if (args[0] === 'status') return onStatus();
  throw new Error(`unexpected git ${args[0]}`);
};

test('A29: a clean tree stamps the bare sha, a dirty one stamps -dirty', () => {
  assert.equal(gitStamp(fakeGit(() => '')), 'abc1234');
  assert.equal(gitStamp(fakeGit(() => ' M app/src/engine.js')), 'abc1234-dirty');
});

test('A29: a FAILED dirty probe stamps -unknown-dirty — an unreadable tree is never reported clean', () => {
  // The real-world cause is an index.lock held by a concurrent session, which is routine in this repo.
  const stamp = gitStamp(fakeGit(() => { throw new Error('index.lock: File exists'); }));
  assert.equal(stamp, 'abc1234-unknown-dirty');
  assert.notEqual(stamp, 'abc1234', 'the old catch fell through to CLEAN — a confident lie about what is on the phone');
  assert.ok(/dirty/.test(stamp), 'whatever it says, it must not read as a clean build');
});

test('A29: no git at all stamps `unknown` — a version with no sha, never a wrong one', () => {
  assert.equal(gitStamp(() => { throw new Error('not a git repository'); }), 'unknown');
  assert.equal(gitStamp(() => ''), 'unknown', 'an empty sha is no sha');
  // and the real runner pointed somewhere that is not a repo agrees
  assert.equal(gitStamp(gitIn('/')), 'unknown');
});

test('A29: the stamp the real tree produces is a sha, optionally marked dirty — never empty', () => {
  const stamp = gitStamp();
  assert.match(stamp, /^(unknown|[0-9a-f]{7,}(-dirty|-unknown-dirty)?)$/);
});

test('A29 CONTROL: importing the bundler does not cut a build', () => {
  // If `scripts/build.mjs` ran its esbuild on import, the four tests above would each have rebuilt www/.
  const ran = execFileSync(process.execPath, ['-e', "import('./scripts/build.mjs').then(m => console.log(typeof m.build))"], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' });
  assert.equal(ran.trim(), 'function', 'the module exports build() and does not run it');
});
