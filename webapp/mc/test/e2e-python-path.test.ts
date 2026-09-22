import { describe, expect, it } from 'vitest';
// Runtime helper shared with the Node e2e harness; its injected filesystem/Git hooks keep this test hermetic.
// @ts-expect-error The production helper is a native ESM module without a declaration file.
import { findPython } from './e2e/python-path.mjs';

describe('e2e Python resolution', () => {
  it('F189: honors MC_PY, then local venv, then the main checkout venv for a worktree', () => {
    const common = () => '/repo/.git';
    expect(findPython('/worktree', { env: { MC_PY: '/chosen/python' }, exists: () => false, common })).toBe('/chosen/python');
    expect(findPython('/worktree', { env: {}, exists: (p: string) => p === '/worktree/.venv/bin/python', common })).toBe('/worktree/.venv/bin/python');
    expect(findPython('/worktree', { env: {}, exists: (p: string) => p === '/repo/.venv/bin/python', common })).toBe('/repo/.venv/bin/python');
    expect(findPython('/worktree', { env: {}, platform: 'win32',
      exists: (p: string) => p === '/repo/.venv/Scripts/python.exe', common })).toBe('/repo/.venv/Scripts/python.exe');
  });
});
