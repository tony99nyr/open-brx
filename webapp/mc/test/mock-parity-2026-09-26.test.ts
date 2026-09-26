// Polish round 1: two mock-backend parity fixes asked for alongside the console fixes.
//
// (1) `pick()`'s content-validation refusals answered with a plain Error (no `.status`), which a real
// server always gives a 400 for -- a screen branching on `e.status` (as `Games.tsx`'s own pieces-fetch
// error handling does) could not tell "the server refused this" from "the request never landed".
//
// (2) The server now keeps `game_pick`'s mode and match settings following whatever `PUT /api/config`
// last did, not just what `POST /api/play/pick` did -- so `GameEditPanel`'s inline KIT/LOBBY edit
// (a direct `putConfig` call, never through `pick()`) no longer leaves PLAY's marks describing a pick
// the field has since moved past. Round 2 (6): settled on the SERVER's exact rule
// (state.py `_sync_game_pick_from_config`) -- the sync runs on EVERY applied `set_config`, errors or
// not (an invalid config is still APPLIED to `self.config`, just flagged), and the mode piece id is
// recomputed directly as `builtin:mode:<mode>`, with no post_mvp exclusion (a post-MVP mode still gets
// its own real builtin id, never a fallback to another mode's).
import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/mock/backend';

describe('pick() validation refusals carry status 400', () => {
  it('a wrong-kind piece id', async () => {
    const b = new MockBackend();
    const state = await b.getState();
    const lifeId = state.game_pick!.pieces.life;   // a real piece, but not a MODE piece
    await expect(b.pick({ pieces: { mode: lifeId } })).rejects.toMatchObject({ status: 400 });
  });

  it('a post-MVP piece id', async () => {
    const b = new MockBackend();
    const pieces = await b.getPieces();
    const postMvp = pieces.find(p => p.post_mvp);
    expect(postMvp, 'fixture must carry at least one post-MVP piece').toBeTruthy();
    await expect(b.pick({ pieces: { [postMvp!.kind]: postMvp!.piece_id } })).rejects.toMatchObject({ status: 400 });
  });

  it('a non-integer time_limit_s', async () => {
    const b = new MockBackend();
    await expect(b.pick({ match: { time_limit_s: -5 } })).rejects.toMatchObject({ status: 400 });
  });

  it('a non-integer frag_limit', async () => {
    const b = new MockBackend();
    await expect(b.pick({ match: { frag_limit: -5 } })).rejects.toMatchObject({ status: 400 });
  });

  it('an unknown piece id stays a 404 (unchanged)', async () => {
    const b = new MockBackend();
    await expect(b.pick({ pieces: { mode: 'nope' } })).rejects.toMatchObject({ status: 404 });
  });
});

describe('putConfig keeps game_pick following the played config, not just pick()', () => {
  it('a direct putConfig mode switch (GameEditPanel’s inline edit) updates game_pick.pieces.mode', async () => {
    const b = new MockBackend();
    await b.putConfig({ mode: 'koth', station_source: 'ir_station' });
    const state = await b.getState();
    expect(state.config.mode).toBe('koth');
    const pieces = await b.getPieces();
    const modePiece = pieces.find(p => p.piece_id === state.game_pick!.pieces.mode);
    expect((modePiece!.value as { mode: string }).mode).toBe('koth');
  });

  it('a direct putConfig match-settings edit updates game_pick.match', async () => {
    const b = new MockBackend();
    await b.putConfig({ time_limit_s: 900, scoring: { win_by: 'kills', frag_limit: 20 }, night: true });
    const state = await b.getState();
    expect(state.game_pick!.match).toMatchObject({ time_limit_s: 900, frag_limit: 20, night: true });
  });

  it('a REFUSED putConfig (errors non-empty) still syncs game_pick, the server’s own rule', async () => {
    const b = new MockBackend();
    // the mock's own "time_limit_s is required on the phone path" refusal (state.py set_config, same words)
    const r = await b.putConfig({ time_limit_s: 0 });
    expect(r.ok).toBe(false);
    const state = await b.getState();
    expect(state.config.time_limit_s).toBe(0);   // refused, but still APPLIED to the config
    expect(state.game_pick!.match.time_limit_s).toBe(0);   // and game_pick follows it regardless
  });

  it('a post-MVP mode still gets its own real builtin mode piece id, never a fallback', async () => {
    const b = new MockBackend();
    await b.putConfig({ mode: 'infection' });
    const state = await b.getState();
    expect(state.config.mode).toBe('infection');
    expect(state.game_pick!.pieces.mode).toBe('builtin:mode:infection');
  });
});
