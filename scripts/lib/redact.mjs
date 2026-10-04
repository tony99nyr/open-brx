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

// A head that ends in one of these is waiting for its value (`#tok=`, `"secret":`, `Bearer`, `operator token:`),
// so a cut there would send the value to the next write unredacted.
const WAITING = /(?:[:=]\s*"?|\bBearer|\b(?:tok|token|secret|key|s|authorization))\s*$/i;

/** The index of the last whitespace where `text` can be cut, or -1. Neither half may hold half a secret. */
function safeCut(text) {
  for (let i = text.length - 1; i > 0; i--) {
    if (/\s/.test(text[i]) && !WAITING.test(text.slice(0, i))) return i + 1;
  }
  return -1;
}

/**
 * Redact a stream by complete line. A secret split across two chunks is whole again once its line is
 * complete. `push(chunk)` writes every finished line to `write`; `end()` writes the trailing partial line.
 * Two cases write part of a line: it grows past `maxLine` with no newline, or it sits unfinished for
 * `idleMs`. Both cut only at whitespace that no rule can span and hold back the rest. A forced flush that
 * finds no such cut writes `[REDACTED-LONG-LINE]` for the whole pending text, so no secret leaks.
 */
export function lineRedactor(write, maxLine = 1_000_000, idleMs = 3000) {
  let pending = '';
  let timer = null;
  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const flushPartial = force => {
    const cut = safeCut(pending);
    if (cut > 0) {
      write(redactText(pending.slice(0, cut)));
      pending = pending.slice(cut);
    } else if (force) {
      write('[REDACTED-LONG-LINE]\n');
      pending = '';
    }
  };
  return {
    push(chunk) {
      pending += chunk.toString();
      const cut = pending.lastIndexOf('\n');
      if (cut >= 0) {
        write(redactText(pending.slice(0, cut + 1)));
        pending = pending.slice(cut + 1);
      }
      if (pending.length > maxLine) flushPartial(true);
      clear();
      if (pending && idleMs > 0) {
        timer = setTimeout(() => { timer = null; flushPartial(false); }, idleMs);
        timer.unref?.();
      }
    },
    end() {
      clear();
      if (pending) write(redactText(pending));
      pending = '';
    }
  };
}
