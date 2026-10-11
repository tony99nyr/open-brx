// Candidate 10, Codex review: the server ignores a frag cap unless kills score the match, so the demo
// must not post "one kill from the cap" in an objective (hill) match that happens to carry one.
import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/mock/backend';

function oneKillToCap(win_by: 'kills' | 'objective'): string[] {
  const b = new MockBackend() as unknown as Record<string, any>;
  b.config = { ...b.config, mode: 'tdm', scoring: { ...b.config.scoring, win_by, frag_limit: 2 } };
  const row = (id: string, team: string) => ({ player_id: id, display: id.toUpperCase(), team_id: team, status: 'alive', kills: 0, deaths: 0, streak: 0, hits: 0, shots: 0 });
  b.live_ = { match_id: 'm', go_live_t: Date.now(), rows: [row('ash', 'red'), row('bo', 'blue')] };
  const lines: string[] = [];
  b.feed = (e: { text: string }) => { lines.push(e.text); };
  b.simKill('ash');
  return lines;
}

describe('mock: the frag-cap warning follows the server rule', () => {
  it('a kills match one kill from the cap says so', () => {
    expect(oneKillToCap('kills')).toContain('ASH is one kill from the cap');
  });
  it('an objective match with a frag cap set stays quiet about it', () => {
    expect(oneKillToCap('objective').some(t => t.includes('one kill from the cap'))).toBe(false);
  });
});
