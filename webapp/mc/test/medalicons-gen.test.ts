// The recap medal icons have ONE source, app/src/hud/medalicons.js; MC's copy (src/api/medalicons.gen.ts) must be it,
// byte for byte after the generator's header. Whether the copy is stale is mcp/tests/test_generated_fresh.py's job.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AWARDS, MEDALS } from '../src/api/contract.gen';
import { medalIcon } from '../src/api/medalicons.gen';

const MARK = '// ---- app/src/hud/medalicons.js, verbatim ----\n';
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');   // a CRLF checkout is not a copy that drifted

describe('medalicons.gen.ts', () => {
  // The content contract: freshness alone would pass a generator that started rewriting the copy.
  it('carries the phone module byte for byte after its mark', () => {
    const gen = read('../src/api/medalicons.gen.ts');
    expect(gen.includes(MARK)).toBe(true);
    expect(gen.slice(gen.indexOf(MARK) + MARK.length)).toBe(read('../../../app/src/hud/medalicons.js'));
  });
  it('draws every MEDALS and AWARDS key with an accessible name', () => {
    for (const r of [...MEDALS, ...AWARDS]) expect(medalIcon(r.key, { label: r.label }), r.key).toMatch(new RegExp(`^<svg [^>]*role="img" aria-label="${r.label.replace(/[/]/g, '.')}"`));
  });
});
