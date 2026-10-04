// Secret redaction for the launcher's evidence files. The rules are NOT here: they live in
// mcp/brx_mcp/mc/redact_patterns.json, which report.py (the bug-report scrub) reads too. Never copy a rule.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'mcp', 'brx_mcp', 'mc', 'redact_patterns.json');
const spec = JSON.parse(readFileSync(file, 'utf8'));
const compile = rule => new RegExp(rule.pattern, rule.ignore_case ? 'gi' : 'g');
const SECRET = spec.secret_patterns.map(compile);
const EXTRA = spec.line_extra_patterns.map(rule => [compile(rule), rule.replacement]);

/** The shared rules only: exactly what report.py's scrub does to a secret. */
export function redactSecrets(text) {
  let out = text;
  for (const re of SECRET) out = out.replace(re, '$1[REDACTED]');
  return out;
}

/** The shared rules plus the looser log-file rules (a bare `token`/`authorization` word). */
export function redactText(text) {
  let out = redactSecrets(text);
  for (const [re, replacement] of EXTRA) out = out.replace(re, replacement);
  return out;
}

/**
 * Redact a stream by complete line. A secret split across two chunks is whole again once its line is
 * complete. `push(chunk)` writes every finished line to `write`; `end()` writes the trailing partial line.
 * A line that grows past `maxLine` with no newline is flushed except its last 512 characters, so one
 * endless line cannot grow the buffer without limit (a secret is far shorter than 512 characters).
 */
export function lineRedactor(write, maxLine = 1_000_000) {
  let pending = '';
  return {
    push(chunk) {
      pending += chunk.toString();
      const cut = pending.lastIndexOf('\n');
      if (cut >= 0) {
        write(redactText(pending.slice(0, cut + 1)));
        pending = pending.slice(cut + 1);
      }
      if (pending.length > maxLine) {
        write(redactText(pending.slice(0, -512)));
        pending = pending.slice(-512);
      }
    },
    end() {
      if (pending) write(redactText(pending));
      pending = '';
    }
  };
}
