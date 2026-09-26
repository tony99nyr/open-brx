// UX round 1 (2026-09-26): the DAY/NIGHT venue-mode manual link (ui/VenueModeReminder.tsx, an <a>)
// had no rule in styles.css's own focus-visible selector, so tabbing to it showed no focus ring.
// jsdom does not apply an external stylesheet, so this reads the rule's own text -- mechanical, but it
// is exactly the line a regression would touch.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '../src/styles.css'), 'utf8');

describe('the keyboard-focus-visible rule', () => {
  it('covers <a>, not only button/input/[tabindex]', () => {
    const line = css.split('\n').find(l => l.includes(':focus-visible') && l.includes('outline: 2px solid'));
    expect(line, 'the focus-visible rule must exist').toBeTruthy();
    const selectors = line!.split('{')[0].split(',').map(s => s.trim());
    expect(selectors).toContain('a:focus-visible');
  });
});
