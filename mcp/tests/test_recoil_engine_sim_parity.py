"""The balance sim's recoil mirror against the phone engine, on the same random inputs (desk review 2026-11-06).

`balance_sim.recoil_profile`, `_recoil_step` and `release_after_pause` claim to mirror engine.js `_recoilProfile`,
`_recoilStep`, `_recoilRelease`/`_recoilPull` and the tick's quiet clock. This test drives the REAL engine (node, the
engine.test.mjs harness shape) through a pull, a burst, a release, a rest and a second pull, for random ladders,
burst lengths, rests and `recoil.recovery` blocks (well formed and malformed), and checks that the sim lands on
the same rung and the same round count at the end of the rest and at the end of the second burst.

The sim's gun-side leak (rounds fired inside RELEASE_RESET_MS of the reset write) is a model of the gun's write
latency, not engine state, so it is not compared. Run: python3 run_tests.py recoil_engine_sim_parity
"""
from __future__ import annotations

import json
import pathlib
import random
import sys
import tempfile

from _node import run_node_json

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "mcp" / "tools"))
import balance_sim as B  # noqa: E402

DMG = 8            # RECOIL_REF_DMG: the shipping AR calibre, so the derived counts are the catalogue's own
FIRE_MS = 100      # the golden bundle's slot-0 t14 (the Assault Rifle)
MAG = 36           # the magazine the fake gun reports after spawn


def _ladder(rng: random.Random) -> dict:
    after = rng.randint(2, 9)
    if rng.random() < 0.3:   # a floor-only ladder: the engine and the sim derive the rungs and the counts
        return {"ceiling": 100, "floor": rng.choice((60, 70, 80)), "per_shot": 10, "recover_ms": 150}
    return {"crisp": 100, "degraded": rng.choice((70, 80, 85)), "heavy": rng.choice((40, 45, 60)),
            "after_shots": after, "after_heavy": after + rng.randint(0, 6),
            "settle_ms": rng.choice((600, 900, 999999))}


def _recovery(rng: random.Random):
    good = {"per_round_ms": rng.choice((0, 10, 25, 40)), "min_ms": rng.choice((50, 100, 160)),
            "max_ms": rng.choice((300, 500, 800))}
    return rng.choice((
        None, good, good, good,
        {**good, "min_ms": 0},                          # the engine needs min_ms > 0
        {**good, "max_ms": good["min_ms"] - 1},         # the engine needs max_ms >= min_ms
        {**good, "per_round_ms": -5},                   # the engine needs per_round_ms >= 0
        {"per_round_ms": 25, "min_ms": 100},            # partial
        {**good, "per_round_ms": None},                 # JS reads +null as 0
        {**good, "min_ms": True},                       # JS reads +true as 1
        {**good, "max_ms": "500"},                      # JS reads +"500" as 500
    ))


def _numbers(rec) -> bool:
    return isinstance(rec, dict) and all(type(rec.get(k)) in (int, float) for k in ("per_round_ms", "min_ms", "max_ms"))


def _spec_timer(rec: dict, burst: int, after_shots: int) -> int:
    """Tony's R2 (2026-11-02), written out here rather than read from either side: per_round_ms for each round of
    the hold past after_shots, clamped to min_ms..max_ms. Used only to aim rests at the edge of the timer."""
    per, lo, hi = (rec.get(k, 0) for k in ("per_round_ms", "min_ms", "max_ms"))
    return int(min(hi, max(lo, per * max(0, burst - after_shots))))


def _cases(n: int, seed: int) -> list[dict]:
    rng = random.Random(seed)
    out = []
    for _ in range(n):
        recoil = _ladder(rng)
        rec = _recovery(rng)
        if rec is not None:
            recoil["recovery"] = rec
        if rng.random() < 0.3:
            recoil["reset_on_release"] = rng.choice((True, True, 1, "yes"))   # only a literal true turns it on
        burst = rng.randint(1, 28)
        pause = rng.choice((0, 50, 99, 100, 150, 299, 300, 499, 500, 599, 600, 800, 1200))
        if _numbers(rec) and "after_shots" in recoil and rng.random() < 0.6:
            pause = _spec_timer(rec, burst, recoil["after_shots"]) + rng.choice((-1, 0, 1))   # the edge
        out.append({"recoil": recoil, "burst": burst, "pause": max(0, pause), "more": rng.randint(0, MAG - 2 - burst)})
    return out


def _sim(case: dict) -> dict:
    prof = B.recoil_profile({"weapon_id": "assault_rifle", "dmg": DMG, "recoil": case["recoil"]})
    state, burst = "crisp", 0
    for _ in range(case["burst"]):
        state, burst = B._recoil_step(prof, state, burst)
    state, burst, _leak, _held = B.release_after_pause(prof, state, burst, float(case["pause"]), float(FIRE_MS))
    after = {"state": state, "burst": burst}
    for _ in range(case["more"]):
        state, burst = B._recoil_step(prof, state, burst)
    return {"model": prof is not None, "after": after, "end": {"state": state, "burst": burst}}


ENGINE = """
import { readFileSync } from 'node:fs';
import { Engine, ACC_HOLD_MS } from '%(root)s/app/src/engine.js';
import { mkStorage } from '%(root)s/app/test/_helpers.mjs';
const golden = JSON.parse(readFileSync('%(root)s/mcp/brx_mcp/mc/golden_bundle.json', 'utf8'));
const cases = JSON.parse(readFileSync(%(cases)s, 'utf8'));
function run(c) {
  let clock = 1_000_000;
  const eng = new Engine({ writer: (fr, why) => String(why).startsWith('gun liveness probe') ? false : fr.length,
    emit: () => {}, report: () => {}, now: () => clock, synced: () => true, storage: mkStorage(), log: () => {},
    delay: (ms, fn) => fn() });
  const team = { team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue',
    loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const roster = [{ player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue' }];
  const config = { config_id: golden.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 },
    teams: [team] };
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player, team, roster, catalog: { weapons: [{ weapon_id: 'assault_rifle',
    name: 'Assault Rifle', clip: 32, reserve: 384, reload_s: 1.4, dmg: %(dmg)d, recoil: c.recoil }], perks: [] } } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: { ...golden, player_id: 'p1' }, roster } });
  eng.feedFrame('$LCD,0,0,0,0,0,0,*'); eng.feedFrame('$ALCD,32,100,0,192,0,*');
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  clock += 10; eng.tick(); clock += ACC_HOLD_MS + 10; eng.tick(); eng._lastTeamRepaintAt = clock;
  let mag = %(mag)d;
  eng.feedFrame(`$LCD,45,70,0,0,${mag},216,*`);
  const fire = n => { for (let i = 0; i < n; i++) { clock += %(fire)d; const r = eng._recoil;
    const acc = r && r.lastWriteValue != null ? r.lastWriteValue : 100; eng.feedFrame(`$ALCD,${--mag},${acc},0,215,0,*`); } };
  const snap = () => ({ state: eng._recoil ? eng._recoil.state : 'crisp', burst: eng._recoil && eng._recoil.model ? eng._recoil.burst : 0 });
  if (!eng.alive || eng.phase !== 'live') throw new Error('the harness did not reach a live, alive gun');
  eng.feedFrame('$BUT,0,1,*'); fire(c.burst); eng.feedFrame('$BUT,0,0,*');
  clock += c.pause; eng.tick();
  const after = snap();
  eng.feedFrame('$BUT,0,1,*'); fire(c.more);
  return { model: !!(eng._recoil && eng._recoil.model), after, end: snap() };
}
console.log(JSON.stringify(cases.map(run)));
"""


def _engine(cases: list[dict]) -> list[dict]:
    with tempfile.TemporaryDirectory() as d:   # the case list is too long for one argv
        path = pathlib.Path(d) / "cases.json"
        path.write_text(json.dumps(cases))
        src = ENGINE % {"root": ROOT.as_posix(), "cases": json.dumps(path.as_posix()), "dmg": DMG, "mag": MAG,
                        "fire": FIRE_MS}
        return run_node_json(src, cwd=ROOT, timeout=120)


def test_the_sim_recoil_lands_where_the_engine_does_for_random_bursts_rests_and_recovery_blocks():
    cases = _cases(1200, seed=20261106)
    got = _engine(cases)
    assert len(got) == len(cases)
    bad = [(c, e, s) for c, e, s in ((c, e, _sim(c)) for c, e in zip(cases, got)) if e != s]
    assert not bad, f"{len(bad)} of {len(cases)} disagree; first: case {bad[0][0]}\n engine {bad[0][1]}\n sim    {bad[0][2]}"


def test_the_random_cases_reach_every_branch():
    """A property test is only as good as its spread: the cases must hit a carried rung, a timer recovery, a settle
    recovery, an F663 reset and a malformed block, or a branch could disagree unseen."""
    cases = _cases(1200, seed=20261106)
    seen = set()
    for c in cases:
        prof = B.recoil_profile({"weapon_id": "assault_rifle", "dmg": DMG, "recoil": c["recoil"]})
        if prof is None:
            continue
        state, burst = "crisp", 0
        for _ in range(c["burst"]):
            state, burst = B._recoil_step(prof, state, burst)
        if state == "crisp":
            seen.add("crisp release")
            continue
        after = B.release_after_pause(prof, state, burst, float(c["pause"]), float(FIRE_MS))[0]
        rec = c["recoil"].get("recovery")
        kind = "r2" if prof.recovery else "f663" if prof.reset_on_release else "settle"
        seen.add(f"{kind} {'carried' if after != 'crisp' else 'reset'}")
        if rec is not None and prof.recovery is None:
            seen.add("malformed block ignored")
    want = {"crisp release", "r2 carried", "r2 reset", "f663 reset", "settle carried", "settle reset",
            "malformed block ignored"}
    assert want <= seen, sorted(want - seen)
