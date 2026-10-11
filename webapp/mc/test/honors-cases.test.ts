import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeHonors, type HonorPlayer } from '../src/mock/honors';

interface Case {
  name: string;
  mode: string;
  players: HonorPlayer[];
  first_blood?: { player_id: string; t_match_s: number };
  honors: { key: string; award: string; player_id: string; stat: string }[];
}
const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../../app/test/fixtures/honors-cases.json'), 'utf8')) as { cases: Case[] };

describe('shared server honours cases', () => {
  it.each(fixture.cases)('$name', c => {
    expect(computeHonors(c.players, c.mode, c.first_blood)).toEqual(c.honors);
  });
});
