// The recap medal icons have ONE source, app/src/hud/medalicons.js; MC's copy (src/api/medalicons.gen.ts) must be it,
// byte for byte, after the generator's header. Stale? Run `node app/scripts/gen-medalicons.mjs` from the repo root.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AWARDS, MEDALS } from '../src/api/contract.gen';
import { medalIcon } from '../src/api/medalicons.gen';

const MARK = '// ---- app/src/hud/medalicons.js, verbatim ----\n';
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('medalicons.gen.ts', () => {
  it('is the phone module, verbatim (run node app/scripts/gen-medalicons.mjs)', () => {
    const gen = read('../src/api/medalicons.gen.ts');
    expect(gen.includes(MARK)).toBe(true);
    expect(gen.slice(gen.indexOf(MARK) + MARK.length)).toBe(read('../../../app/src/hud/medalicons.js'));
  });
  it('draws every MEDALS and AWARDS key with an accessible name', () => {
    for (const r of [...MEDALS, ...AWARDS]) expect(medalIcon(r.key, { label: r.label }), r.key).toMatch(new RegExp(`^<svg [^>]*role="img" aria-label="${r.label.replace(/[/]/g, '.')}"`));
  });
});
