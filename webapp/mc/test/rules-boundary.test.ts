import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const filesUnder = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? filesUnder(path) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
});
const importsFrom = (file: string): string[] => {
  const source = readFileSync(file, 'utf8');
  const hits: string[] = [];
  const pattern = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1];
    if (/^(?:\.\.\/screens(?:\/|$)|(?:\.\.\/)*(?:src\/)?screens(?:\/|$))/.test(specifier) || /(?:^|\/)screens(?:\/|$)/.test(specifier)) hits.push(specifier);
  }
  return hits.map(specifier => `${relative(process.cwd(), file)} imports ${specifier}`);
};

describe('rules module boundaries', () => {
  it('keeps mock imports independent of screens', () => {
    expect(filesUnder('src/mock').flatMap(importsFrom)).toEqual([]);
  });
  it('keeps rules independent of screens, UI, mock and store', () => {
    const forbidden = /(?:^|\/)(?:screens|ui|mock|store)(?:\/|$)/;
    const violations = filesUnder('src/rules').flatMap(file => {
      const source = readFileSync(file, 'utf8');
      const pattern = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
      return [...source.matchAll(pattern)].filter(m => forbidden.test(m[1])).map(m => `${relative(process.cwd(), file)} imports ${m[1]}`);
    });
    expect(violations).toEqual([]);
  });
});
