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
import type { GameConfig } from '../src/api/types';
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

describe('pick() falls back a kind the request did not name, and reports it (server review)', () => {
  it('a post-MVP mode set on KIT (an INHERITED game_pick.pieces.mode) falls back to TDM on the next pick', async () => {
    const b = new MockBackend();
    await b.putConfig({ mode: 'infection' });   // GameEditPanel's inline KIT edit -- round 2 (6) syncs game_pick to it
    expect((await b.getState()).game_pick!.pieces.mode).toBe('builtin:mode:infection');
    const r = await b.pick({});   // a pick that names NO pieces at all -- 'mode' is purely inherited
    expect(r.ok).toBe(true);
    expect(r.fallbacks).toEqual(['mode']);
    expect(r.pick.pieces.mode).toBe('builtin:mode:tdm');
    expect((await b.getState()).game_pick!.pieces.mode).toBe('builtin:mode:tdm');   // and it PERSISTS
  });

  it('a kind the request DOES name still 404s/400s on a bad id -- never a silent fallback', async () => {
    const b = new MockBackend();
    await expect(b.pick({ pieces: { mode: 'nope' } })).rejects.toMatchObject({ status: 404 });
  });
});

describe('updatePiece (review MEDIUM 3): only a value change on a PICKED piece recomposes', () => {
  it('a name-only rename does not touch the config at all', async () => {
    const b = new MockBackend();
    const life = await b.createPiece({ kind: 'life', name: 'CUSTOM LIFE', value: { max_hp: 50, max_armor: 60, max_shield: 0 } });
    await b.pick({ pieces: { life: life.piece_id } });
    // an independent KIT/LOBBY inline edit -- toggling hud_select DIRECTLY, never through a BUILD piece
    await b.putConfig({ loadout_policy: { hud_select: false } as GameConfig['loadout_policy'] });
    expect((await b.getState()).config.loadout_policy!.hud_select, 'control').toBe(false);
    const renamed = await b.updatePiece(life.piece_id, { name: 'RENAMED LIFE' });
    expect(renamed.ok, 'a name-only save never even reaches a recompose').toBeUndefined();
    const after = await b.getState();
    expect(after.config.loadout_policy!.hud_select, 'a rename must not silently revert an unrelated inline edit').toBe(false);
    expect((await b.getPieces()).find(p => p.piece_id === life.piece_id)?.name).toBe('RENAMED LIFE');
  });

  it('a value change on a picked piece DOES recompose, and reports ok/errors/fallbacks', async () => {
    const b = new MockBackend();
    const life = await b.createPiece({ kind: 'life', name: 'CUSTOM LIFE', value: { max_hp: 50, max_armor: 60, max_shield: 0 } });
    await b.pick({ pieces: { life: life.piece_id } });
    const r = await b.updatePiece(life.piece_id, { name: 'CUSTOM LIFE', value: { max_hp: 80, max_armor: 60, max_shield: 0 } });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect((await b.getState()).config.health.max_hp).toBe(80);
  });

  it('the precheck runs BEFORE anything is saved: a bad value leaves the name untouched', async () => {
    const b = new MockBackend();
    const life = await b.createPiece({ kind: 'life', name: 'CUSTOM LIFE', value: { max_hp: 50, max_armor: 60, max_shield: 0 } });
    await expect(b.updatePiece(life.piece_id, { name: 'SHOULD NOT SAVE', value: { max_hp: 0, max_armor: 60, max_shield: 0 } }))
      .rejects.toThrow(/max_hp must be an integer/);
    expect((await b.getPieces()).find(p => p.piece_id === life.piece_id)?.name, 'the refused value must not leave a half-applied rename').toBe('CUSTOM LIFE');
  });
});

describe('LIFE ranges (review MEDIUM 4): max_hp 1..255, armour/shield 0..255', () => {
  it('max_hp 0 is refused (0..999 was never the server’s own range)', async () => {
    const b = new MockBackend();
    await expect(b.createPiece({ kind: 'life', name: 'X', value: { max_hp: 0, max_armor: 0, max_shield: 0 } }))
      .rejects.toThrow(/max_hp must be an integer 1\.\.255/);
  });
  it('256 is refused on every field', async () => {
    const b = new MockBackend();
    await expect(b.createPiece({ kind: 'life', name: 'X', value: { max_hp: 256, max_armor: 0, max_shield: 0 } })).rejects.toThrow(/1\.\.255/);
    await expect(b.createPiece({ kind: 'life', name: 'Y', value: { max_hp: 45, max_armor: 256, max_shield: 0 } })).rejects.toThrow(/0\.\.255/);
    await expect(b.createPiece({ kind: 'life', name: 'Z', value: { max_hp: 45, max_armor: 0, max_shield: 256 } })).rejects.toThrow(/0\.\.255/);
  });
  it('the new ceiling (255) and max_hp’s floor (1) are accepted', async () => {
    const b = new MockBackend();
    const p = await b.createPiece({ kind: 'life', name: 'MAXED', value: { max_hp: 1, max_armor: 255, max_shield: 255 } });
    expect(p.value).toEqual({ max_hp: 1, max_armor: 255, max_shield: 255 });
  });
});

describe('only_ids/fixed_id (review MEDIUM 4): hidden, pickup-only or unknown ids are refused', () => {
  it('an unknown weapon id in only_ids is refused with 400', async () => {
    const b = new MockBackend();
    await expect(b.createPiece({ kind: 'primary', name: 'X',
      value: { choice: 'player', kinds: ['weapon'], exclude_tags: [], exclude_ids: [], only_ids: ['not_a_real_weapon'], fixed_id: null } }))
      .rejects.toMatchObject({ status: 400 });
  });
  it('a pickup-only weapon as fixed_id is refused', async () => {
    const b = new MockBackend();
    const weapons = await b.getWeapons();
    const pickupOnly = weapons.find(w => w.pickup_only);
    expect(pickupOnly, 'fixture must carry at least one pickup-only weapon').toBeTruthy();
    await expect(b.createPiece({ kind: 'secondary', name: 'X',
      value: { choice: 'fixed', kinds: ['weapon'], exclude_tags: [], exclude_ids: [], only_ids: [], fixed_id: pickupOnly!.weapon_id } }))
      .rejects.toMatchObject({ status: 400 });
  });
  it('a real, pickable weapon id is accepted', async () => {
    const b = new MockBackend();
    const weapons = await b.getWeapons();
    const real = weapons.find(w => !w.pickup_only)!.weapon_id;
    const p = await b.createPiece({ kind: 'primary', name: 'X',
      value: { choice: 'fixed', kinds: ['weapon'], exclude_tags: [], exclude_ids: [], only_ids: [], fixed_id: real } });
    expect((p.value as { fixed_id: string }).fixed_id).toBe(real);
  });
  it('an unknown perk id is refused', async () => {
    const b = new MockBackend();
    await expect(b.createPiece({ kind: 'perks', name: 'X',
      value: { choice: 'fixed', kinds: ['perk'], exclude_tags: [], exclude_ids: [], only_ids: [], fixed_id: 'not_a_real_perk' } }))
      .rejects.toMatchObject({ status: 400 });
  });
});
