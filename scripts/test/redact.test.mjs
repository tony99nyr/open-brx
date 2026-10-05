// O17: the launcher redacts mc.log by complete line, with the same secret rules as report.py.
import test, { mock } from 'node:test';
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
  assert.ok(out.includes('[REDACTED-LONG-LINE]'));
});

test('the looser log rule still redacts a bare token word', () => {
  assert.ok(!run(['authorization abc123\n']).includes('abc123'));
});

test('idle flush holds a line with a secret keyword: key and value stay together', t => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  let out = '';
  const r = lineRedactor(x => { out += x; });
  r.push('operator token: ');
  mock.timers.tick(3001);
  assert.equal(out, '');
  r.push('SECRETVALUE\n');
  assert.equal(out, 'operator token: [REDACTED]\n');
});

test('idle flush emits a keyword-free partial line, holding back a tail', t => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  let out = '';
  const r = lineRedactor(x => { out += x; });
  r.push('Booting the server and loading things up now');
  mock.timers.tick(3001);
  assert.ok(out.startsWith('Booting the server') && out.length > 0 && out.length < 43, out);
  r.push(' and then tok=ABC\n');
  r.end();
  assert.ok(!out.includes('ABC'));
});

test('a keyword split by an idle flush is still caught', t => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  let out = '';
  const r = lineRedactor(x => { out += x; });
  r.push('some words here operator to');
  mock.timers.tick(3001);
  r.push('ken: SECRETVALUE\n');
  assert.ok(!out.includes('SECRETVALUE'), out);
});

test('a quoted JSON value with spaces is not exposed by an idle flush', t => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  let out = '';
  const r = lineRedactor(x => { out += x; });
  r.push('{"secret":"alpha beta ');
  mock.timers.tick(3001);
  r.push('gamma"}\n');
  assert.ok(!/alpha|beta|gamma/.test(out), out);
});

test('a forced flush discards the rest of the line up to the newline', () => {
  let out = '';
  const r = lineRedactor(x => { out += x; }, 1000);
  r.push('x'.repeat(1500) + 'tok=SECRETPART1');
  r.push('SECRETPART2 more words');
  r.push(' and more\nnext line ok\n');
  r.end();
  assert.ok(!/SECRETPART/.test(out), out);
  assert.ok(out.includes('[REDACTED-LONG-LINE]'));
  assert.ok(out.endsWith('next line ok\n'), out);
});

test('end of stream redacts the whole pending text as one line', () => {
  assert.equal(run(['operator token: ', 'SECRET9']), 'operator token: [REDACTED]');
});

// Fuzz: random lines, random chunking, forced flushes (small maxLine) and idle flushes (mock timer).
test('fuzz: 2000 random lines never leak a secret value', t => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  let seed = 20261004;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const pick = list => list[Math.floor(rnd() * list.length)];
  const word = () => 'w' + Math.floor(rnd() * 1e6).toString(36);
  const secret = () => 'Zq' + Math.floor(rnd() * 1e12).toString(36) + 'Xv';
  let out = '';
  const r = lineRedactor(x => { out += x; }, 300);
  const secrets = [];
  let input = '';
  for (let i = 0; i < 2000; i++) {
    const v = [secret(), secret(), secret()];
    const forms = [
      `Mission Control http://h:1/#tok=${v[0]}`, `operator token: ${v[0]}`, `Operator Token:   ${v[0]}`,
      `Authorization: Bearer ${v[0]}`, `{"secret":"${v[0]} ${v[1]} ${v[2]}"}`, `open /x?token=${v[0]}&a=1`,
      `join /j?s=${v[0]} now`, `{"node_key": "${v[0]}", "n": 1}`, `authorization ${v[0]}`, `no secret here`];
    const form = pick(forms);
    if (form.includes('Zq')) secrets.push(...v.filter(x => form.includes(x)));
    const filler = n => Array.from({ length: n }, word).join(' ');
    input += `${filler(Math.floor(rnd() * 6))} ${form} ${filler(Math.floor(rnd() * (rnd() < 0.1 ? 80 : 6)))}\n`;
  }
  for (let i = 0; i < input.length;) {
    const n = 1 + Math.floor(rnd() * 40);
    r.push(input.slice(i, i + n));
    i += n;
    if (rnd() < 0.1) mock.timers.tick(3001);
  }
  r.end();
  for (const v of secrets) assert.ok(!out.includes(v), `leaked ${v}`);
  assert.ok(secrets.length > 1500);
});
