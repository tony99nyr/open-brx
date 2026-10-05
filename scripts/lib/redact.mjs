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

// A partial line holding any of these words may hold a secret whose key and value must stay together, so the idle
// timer never emits it. The list is in the shared rule file (`hold_keywords`), beside the patterns.
const HOLD = spec.hold_keywords.map(word => word.toLowerCase());
const HOLD_TAIL = Math.max(...HOLD.map(word => word.length)) + 2;
const hasKeyword = text => { const lower = text.toLowerCase(); return HOLD.some(word => lower.includes(word)); };

/**
 * Redact a stream by complete line. A secret split across two chunks is whole again once its line is
 * complete. `push(chunk)` writes every finished line to `write`; `end()` redacts the pending text as one line.
 *  - Idle for `idleMs`: a pending partial line is emitted only if it holds no secret keyword, minus a short tail
 *    (a keyword may straddle the cut). A line with a keyword is held until its newline or the end.
 *  - Longer than `maxLine` with no newline: write `[REDACTED-LONG-LINE]` and discard input up to the next newline.
 */
export function lineRedactor(write, maxLine = 1_000_000, idleMs = 3000) {
  let pending = '';
  let timer = null;
  let discarding = false;
  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const idleFlush = () => {
    timer = null;
    if (hasKeyword(pending) || pending.length <= HOLD_TAIL) return;
    write(redactText(pending.slice(0, -HOLD_TAIL)));
    pending = pending.slice(-HOLD_TAIL);
  };
  return {
    push(chunk) {
      let text = chunk.toString();
      if (discarding) {
        const nl = text.indexOf('\n');
        if (nl < 0) return;
        discarding = false;
        write('\n');
        text = text.slice(nl + 1);
      }
      pending += text;
      const cut = pending.lastIndexOf('\n');
      if (cut >= 0) {
        write(redactText(pending.slice(0, cut + 1)));
        pending = pending.slice(cut + 1);
      }
      if (pending.length > maxLine) {
        write('[REDACTED-LONG-LINE]');
        pending = '';
        discarding = true;
      }
      clear();
      if (pending && idleMs > 0) {
        timer = setTimeout(idleFlush, idleMs);
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
