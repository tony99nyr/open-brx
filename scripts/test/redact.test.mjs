// O17: the launcher redacts mc.log by complete line, with the same secret rules as report.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineRedactor, redactSecrets } from '../lib/redact.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const samples = JSON.parse(readFileSync(join(here, '..', '..', 'mcp', 'tests', 'redact_samples.json'), 'utf8')).samples;

test('the shared samples redact exactly as report.py expects', () => {
  for (const s of samples) assert.equal(redactSecrets(s.in), s.out, s.in);
});

function run(chunks) {
  let out = '';
  const r = lineRedactor(text => { out += text; });
  for (const c of chunks) r.push(Buffer.from(c));
  r.end();
  return out;
}

test('a secret split across two chunks never reaches the log', () => {
  const out = run(['Mission Control http://h:1/#to', 'k=SECRETVALUE99\nnext line\n']);
  assert.ok(!out.includes('SECRETVALUE99'), out);
  assert.equal(out, 'Mission Control http://h:1/#tok=[REDACTED]\nnext line\n');
});

test('a split inside the value is redacted whole', () => {
  const out = run(['operator token: ABCD', 'EFGH1234\n']);
  assert.equal(out, 'operator token: [REDACTED]\n');
});

test('a trailing partial line is flushed, redacted, at the end of the stream', () => {
  assert.equal(run(['a\nops #tok=ZZZ', '999']), 'a\nops #tok=[REDACTED]');
});

test('an endless line stays bounded and loses no short secret in its tail', () => {
  let out = '';
  const r = lineRedactor(t => { out += t; }, 1000);
  r.push('x'.repeat(3000));
  r.push(' #tok=TAILSECRET');
  r.end();
  assert.ok(!out.includes('TAILSECRET'));
  assert.ok(out.length >= 3000);
});

test('the looser log rule still redacts a bare token word', () => {
  assert.ok(!run(['authorization abc123\n']).includes('abc123'));
});
