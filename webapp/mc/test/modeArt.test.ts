// `MODE_ART` is hand-kept since the `import.meta.glob` into `public/` came out (see src/modeArt.ts for
// why). This is the guard that replaces the glob: it reads the real directory, so the set cannot drift
// from the files. Both directions matter — an id with no file paints a broken `url()` over a striped
// slot, and a file with no id is art nobody ever sees.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODE_ART } from '../src/modeArt';

const DIR = path.resolve(__dirname, '../public/assets/modes');
const basenames = () => fs.readdirSync(DIR).filter((f) => f.endsWith('.jpg')).map((f) => path.basename(f, '.jpg'));

describe('MODE_ART', () => {
  it('lists exactly the images in public/assets/modes', () => {
    const onDisk = basenames().sort();
    expect(onDisk.length).toBeGreaterThan(0);        // the floor: an empty folder would match an empty set
    expect([...MODE_ART].sort()).toEqual(onDisk);
  });

  it('names every id it claims, and no id it does not have a file for', () => {
    const onDisk = new Set(basenames());
    const missingFile = [...MODE_ART].filter((m) => !onDisk.has(m));
    const unlisted = [...onDisk].filter((m) => !MODE_ART.has(m));
    expect(missingFile, 'MODE_ART ids with no public/assets/modes/<id>.jpg — Games.tsx would paint a broken url()').toEqual([]);
    expect(unlisted, 'images in public/assets/modes that MODE_ART does not list — add the id to src/modeArt.ts').toEqual([]);
  });

  it('still has koth as the known gap', () => {
    // Not a rule, a reminder: the comment in src/modeArt.ts points at the open FOLLOWUPS item, and this
    // fails the day the art lands so the note gets removed with it.
    expect(MODE_ART.has('koth')).toBe(false);
  });
});
