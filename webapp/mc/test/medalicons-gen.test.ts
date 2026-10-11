// The recap medal icons have ONE source, app/src/hud/medalicons.js; MC's copy (src/api/medalicons.gen.ts) must be it,
// byte for byte; mcp/tests/test_generated_fresh.py holds that (scripts/generated.json).
import { describe, expect, it } from 'vitest';
import { AWARDS, MEDALS } from '../src/api/contract.gen';
import { medalIcon } from '../src/api/medalicons.gen';


describe('medalicons.gen.ts', () => {
  it('draws every MEDALS and AWARDS key with an accessible name', () => {
    for (const r of [...MEDALS, ...AWARDS]) expect(medalIcon(r.key, { label: r.label }), r.key).toMatch(new RegExp(`^<svg [^>]*role="img" aria-label="${r.label.replace(/[/]/g, '.')}"`));
  });
});
