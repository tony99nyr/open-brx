// F221 (Tony, 2026-09-25): one table pins the severity of every alert the console shows.
//
// `alert-audit-2026-09-25.json` is the approved audit: 350 alerts, each with the severity Tony's rule
// gives it. Every RED, AMBER and NEUTRAL row must be in the catalogue (`src/alerts`) with that
// severity, or be covered by a catalogue row's `also`, or be retired with a reason. A catalogue row
// that differs from the audit must say why. Every catalogue id must be used by a call site, so the
// table cannot pin a colour that no screen draws.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALERTS, RETIRED, SEV_COLOUR, alertWords, glyphed, serverLineSev, SERVER_LINES } from '../src/alerts';
import { T } from '../src/tokens';

type Row = { id: string; proposed: 'RED' | 'AMBER' | 'NEUTRAL' | 'NOT-ALERT' | 'UNCHANGED'; file: string; text: string };
const AUDIT: Row[] = JSON.parse(readFileSync(join(__dirname, 'alert-audit-2026-09-25.json'), 'utf8'));
const SEV = { RED: 'red', AMBER: 'amber', NEUTRAL: 'neutral' } as const;

const covered = new Map<string, string>();   // audit id -> the catalogue id that renders it
for (const [id, d] of Object.entries(ALERTS)) {
  covered.set(id, id);
  for (const a of d.also ?? []) covered.set(a, id);
}

function srcFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? srcFiles(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}
const SRC = join(__dirname, '..', 'src');
const callSites = srcFiles(SRC).filter(p => !p.includes(`${join('src', 'alerts')}`)).map(p => readFileSync(p, 'utf8')).join('\n');

describe('F221 alert severity table', () => {
  const alertRows = AUDIT.filter(r => r.proposed in SEV);

  it.each(alertRows.map(r => [r.id, r.proposed] as const))('%s is %s', (id, proposed) => {
    if (RETIRED[id]) { expect(RETIRED[id].length).toBeGreaterThan(10); return; }
    const cid = covered.get(id);
    expect(cid, `${id} is not in the catalogue, not covered by an \`also\`, and not retired`).toBeTruthy();
    const d = ALERTS[cid!];
    if (d.sev !== SEV[proposed as keyof typeof SEV]) {
      expect(d.why, `${cid} is ${d.sev} but the audit says ${proposed} for ${id}: give a \`why\``).toBeTruthy();
    }
  });

  it('every catalogue id is drawn by a call site', () => {
    const unused = Object.keys(ALERTS).filter(id => !callSites.includes(`'${id}'`) && !callSites.includes(`"${id}"`));
    // server-worded lines are drawn through SERVER_LINES, not by id at a call site
    const viaServer = new Set(SERVER_LINES.map(l => l.id));
    expect(unused.filter(id => !viaServer.has(id))).toEqual([]);
  });

  it('every catalogue row follows the wording rule', () => {
    for (const [id, d] of Object.entries(ALERTS)) {
      expect(d.text, id).not.toMatch(/BLOCKS START|DOES NOT BLOCK/);
      expect(d.text, id).not.toMatch(/▲/);          // the helper adds the glyph, never the words
      expect(d.text, id).not.toMatch(/ — | - /);     // one separator: a colon
      // upper case, apart from {placeholders} and a command in `code`
      const words = d.text.replace(/\{[^}]*\}/g, '').replace(/`[^`]*`/g, '');
      expect(words, id).toBe(words.toUpperCase());
    }
  });

  it('no alert, retired or not, is claimed twice', () => {
    for (const id of Object.keys(RETIRED)) expect(covered.has(id), `${id} is both retired and in the catalogue`).toBe(false);
    const seen = new Map<string, string>();
    for (const [id, d] of Object.entries(ALERTS)) for (const a of d.also ?? []) {
      expect(seen.get(a), `${a} is covered by both ${seen.get(a)} and ${id}`).toBeUndefined();
      expect(a === id || !(a in ALERTS), `${a} is its own catalogue row and also in ${id}'s also`).toBe(true);
      seen.set(a, id);
    }
  });

  it('the helper: one colour per severity, the glyph on red and amber only, one colon', () => {
    expect(SEV_COLOUR).toEqual({ red: T.bad, amber: T.warn, neutral: T.dim });
    expect(alertWords('gun pools wrong', 'force respawn')).toBe('GUN POOLS WRONG: FORCE RESPAWN');
    expect(glyphed('red', 'X')).toBe('▲ X');
    expect(glyphed('amber', 'X')).toBe('▲ X');
    expect(glyphed('neutral', 'X')).toBe('X');
  });

  it('a server line the table does not know keeps its list default', () => {
    expect(serverLineSev('SOMETHING NEW', 'blocker')).toBe('red');
    expect(serverLineSev('SOMETHING NEW', 'amber')).toBe('amber');
    for (const l of SERVER_LINES) expect(ALERTS[l.id], `SERVER_LINES names ${l.id}, which is not in the catalogue`).toBeTruthy();
  });
});

describe('F221 wording in the source', () => {
  it('no call site says BLOCKS START or DOES NOT BLOCK', () => {
    expect(callSites).not.toMatch(/BLOCKS START|DOES NOT BLOCK/);
  });
});
