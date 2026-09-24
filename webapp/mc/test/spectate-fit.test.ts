// F318 (Tony, 2026-09-24): "just dropping [players] because it doesn't fit is not very responsive". The
// SPECTATE wall fits EVERY player: normal size, then smaller row type down to the legibility floor, then more
// columns, and only then rotating pages. `fitBoard` decides it; these cases pin each step and the invariant.
import { describe, expect, it } from 'vitest';
import { fitBoard, ROW_FLOOR, ROWK_FLOOR, MAX_COLS } from '../src/screens/Spectate';

const base = { row: 22, rowK: 28 };
const shown = (f: ReturnType<typeof fitBoard>) => f.cols * f.perCol * f.pages;

describe('fitBoard: a wall never drops a player', () => {
  it('keeps the normal size and one column when everybody fits', () => {
    expect(fitBoard(8, 600, 700, base)).toMatchObject({ cols: 1, rowK: 28, row: 22, pages: 1 });
  });
  it('shrinks the type before it adds a column, never below the floor', () => {
    const f = fitBoard(12, 380, 700, base);   // 10 rows at full size, 12 at a smaller size
    expect(f.cols).toBe(1);
    expect(f.rowK).toBeLessThan(28);
    expect(f.rowK).toBeGreaterThanOrEqual(ROWK_FLOOR);
    expect(f.row).toBeGreaterThanOrEqual(ROW_FLOOR);
  });
  it('adds columns when the floor still does not fit, as far as the width allows', () => {
    const f = fitBoard(30, 450, 700, base);   // one column at the floor holds 17, two hold 34
    expect(f.cols).toBe(2);
    expect(f.pages).toBe(1);
    expect(shown(f)).toBeGreaterThanOrEqual(30);
    expect(fitBoard(30, 450, 300, base).cols, 'no room for a second column').toBe(1);
  });
  it('pages only as the last resort, and every player is on some page', () => {
    const f = fitBoard(63, 200, 1200, base);
    expect(f.cols).toBe(MAX_COLS);
    expect(f.pages).toBeGreaterThan(1);
    expect(f.rowK).toBe(ROWK_FLOOR);
  });
  it('covers every roster size on common walls with nobody left out', () => {
    for (const [h, w] of [[250, 620], [300, 700], [600, 1200], [900, 1600]])
      for (let n = 1; n <= 63; n++) {
        const f = fitBoard(n, h, w, base);
        expect(shown(f), `n=${n} on ${w}x${h}`).toBeGreaterThanOrEqual(n);
        expect(f.rowK).toBeGreaterThanOrEqual(ROWK_FLOOR);
        expect(f.row).toBeGreaterThanOrEqual(ROW_FLOOR);
      }
  });
});
