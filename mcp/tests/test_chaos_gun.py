"""Chaos testing of the gun serial link: a live `run_live` game on FakeTaggers while the gun-to-host
byte stream is split, merged, cut and flooded (docs/chaos-testing.md).

`FaultyWire` is a `FakeConnectionManager` whose guns' frames do not arrive as whole frames. They are
joined into one byte stream, faulted, cut into random notification-sized chunks, and put back
together by the REAL reassembler (`protocol.extract_frames`, the one `ble.py`'s notify callback
uses). So the host engine sees what a real BLE link hands it on a bad day.

The rules the game must keep, whatever the wire does:
  * a LOSSLESS fault (any split, a frame cut exactly at its `*`) changes nothing: the same kills
    score the same way;
  * a LOSSY fault (lost chunks, a frame missing its `*`) can lose a kill, but never invents one and
    never credits the wrong team;
  * the game still ends and tears down, and once the wire is clean again a kill scores;
  * host traffic from the soak patterns (the screamer-hunt schedules in `soak/patterns.py`) sent in
    the middle of a match does not change who scores.

Seeds are fixed. Each test is well under a second (no real sleeps beyond the engine's own ticks).
"""
from __future__ import annotations

import asyncio
import random

from _async import run as _run

from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.gameconfig import GameConfig
from brx_mcp.modes.driver import run_live
from brx_mcp.protocol import extract_frames
from brx_mcp.soak.patterns import HANG_LIST, PATTERNS, assert_pattern_is_safe

SEEDS = (1, 2, 3, 4, 5)
GUNS = ("AA:1", "BB:2", "CC:3", "DD:4")        # TDM: A, C on team 1; B, D on team 2 (assign_teams)


class FaultyWire(FakeConnectionManager):
    """The fake manager with a faulty gun-to-host link. Faults are seeded and can be switched off."""

    def __init__(self, taggers, rng: random.Random, *, split: bool = True, lose_chunk: float = 0.0,
                 lose_star: float = 0.0):
        super().__init__(taggers)
        self.rng = rng
        self.split, self.lose_chunk, self.lose_star = split, lose_chunk, lose_star
        self.partial: dict[str, str] = {}
        self.frames_in = 0          # frames the guns produced
        self.frames_out = 0         # frames the host got after reassembly
        self.chunks_lost = 0

    def clean(self) -> None:
        self.split, self.lose_chunk, self.lose_star = False, 0.0, 0.0

    def _deliver(self, s, frames: list[str]) -> list[dict]:
        stream = ""
        for i, f in enumerate(frames):
            self.frames_in += 1
            # The merged-notify case the bench saw (`$ALCD,...$BUT,0,1,*`): a frame loses its `*` when
            # another frame FOLLOWS it in the same notify. The last frame of a burst keeps its `*`:
            # the reassembler holds a star-less tail until the next `$`, and a dead gun may send
            # nothing more for a long time (a known limit, noted in docs/chaos-testing.md).
            if self.lose_star and i < len(frames) - 1 and f.endswith("*") and self.rng.random() < self.lose_star:
                f = f[:-1]
            stream += f
        cuts = sorted(self.rng.sample(range(1, len(stream)), min(len(stream) - 1, self.rng.randint(0, 6)))) \
            if self.split and len(stream) > 1 else []
        # also cut right before and right after a `*`, the boundary a notify most often lands on
        if self.split:
            stars = [i for i, c in enumerate(stream) if c == "*"]
            cuts = sorted(set(cuts) | {i for i in stars if 0 < i < len(stream)} | {i + 1 for i in stars if i + 1 < len(stream)})
        out = []
        for chunk in (stream[a:b] for a, b in zip([0] + cuts, cuts + [len(stream)])):
            if self.lose_chunk and self.rng.random() < self.lose_chunk:
                self.chunks_lost += 1
                continue
            buf = self.partial.get(s.alias, "") + chunk
            got, self.partial[s.alias] = extract_frames(buf)
            for frame in got:
                self.frames_out += 1
                out.append(s.record("rx", frame).to_dict())
        return out

    async def send(self, alias: str, command: str, reply_window_ms: int = 0) -> dict:
        if alias in self.dropped:
            raise ConnectionError(f"link dropped: {alias}")
        s = self.sessions[alias]
        s.record("tx", command)
        tagger = self.taggers[s.address]
        tagger.write(command)
        return {"sent": command, "replies_within_window": self._deliver(s, tagger.drain())}

    def inject_hit(self, victim_alias: str, shooter_team: int) -> None:
        if victim_alias in self.dropped:
            return
        s = self.sessions[victim_alias]
        tagger = self.taggers[s.address]
        tagger.receive_ir(shooter_team)
        self._deliver(s, tagger.drain())


def _alias(mgr, addr: str) -> str:
    return next(a for a, s in mgr.sessions.items() if s.address == addr)


def _game(mgr, kills, *, frag_limit: int, mid=None) -> dict:
    """Play a TDM game on the four guns: `kills` is [(victim address, shooter team)], in order.
    `mid(mgr)` runs after the first kill (a fault toggle, pattern traffic). Returns the snapshot."""
    cfg = GameConfig(mode="tdm", frag_limit=frag_limit, respawn_s=1, game_time_s=1)

    async def play():
        task = asyncio.ensure_future(run_live(cfg, list(GUNS), manager=mgr, tick_s=0.005))
        for _ in range(200):                       # wait for connect + setup, not a fixed sleep
            if len(mgr.sessions) == len(GUNS) and all(t.team for t in mgr.taggers.values()):
                break
            await asyncio.sleep(0.005)
        await asyncio.sleep(0.03)
        for i, (victim, team) in enumerate(kills):
            mgr.inject_kill(_alias(mgr, victim), shooter_team=team)
            await asyncio.sleep(0.02)              # let the engine tick over the new events
            if i == 0 and mid is not None:
                await mid(mgr)
        return await asyncio.wait_for(task, timeout=6)
    return _run(play())


def _taggers():
    return [FakeTagger(a, name=f"G{i}") for i, a in enumerate(GUNS)]


# Team 1 kills B and D; team 2 kills A. Frag limit 2 ends it on team 1's second kill.
KILLS = [("AA:1", 2), ("BB:2", 1), ("DD:4", 1)]


def _clean_snapshot():
    return _game(FakeConnectionManager(_taggers()), KILLS, frag_limit=2)


def test_the_clean_game_is_the_control():
    snap = _clean_snapshot()
    assert snap["over"] and snap["team_score"][1] == 2 and snap["team_score"][2] == 1, snap["team_score"]


def test_split_frames_score_exactly_like_whole_frames():
    want = _clean_snapshot()["team_score"]
    for seed in SEEDS:
        mgr = FaultyWire(_taggers(), random.Random(seed), split=True)
        snap = _game(mgr, KILLS, frag_limit=2)
        assert mgr.frames_out == mgr.frames_in, f"seed {seed}: a lossless split lost frames"
        assert snap["over"] and snap["team_score"] == want, f"seed {seed}: {snap['team_score']} != {want}"


def test_frames_missing_their_star_still_split_on_the_next_dollar():
    want = _clean_snapshot()["team_score"]
    for seed in SEEDS:
        mgr = FaultyWire(_taggers(), random.Random(seed), split=True, lose_star=0.3)
        snap = _game(mgr, KILLS, frag_limit=2)
        assert snap["over"] and snap["team_score"] == want, f"seed {seed}: {snap['team_score']} != {want}"


def test_lost_chunks_never_invent_a_kill_or_credit_the_wrong_team():
    for seed in SEEDS[:3]:
        mgr = FaultyWire(_taggers(), random.Random(seed), split=True, lose_chunk=0.25)
        # every kill here is team 1's: team 2 must score nothing, and team 1 at most what it earned
        snap = _game(mgr, [("BB:2", 1), ("DD:4", 1)], frag_limit=3)   # above the kills: an invented kill would show
        assert mgr.chunks_lost, f"seed {seed}: the fault never fired (the control)"
        assert snap["over"], f"seed {seed}: the game did not end"
        assert snap["team_score"].get(2, 0) == 0, f"seed {seed}: team 2 was credited {snap['team_score']}"
        assert 0 <= snap["team_score"].get(1, 0) <= 2, f"seed {seed}: team 1 over-credited {snap['team_score']}"


def test_a_kill_scores_again_once_the_wire_is_clean():
    for seed in SEEDS[:3]:
        mgr = FaultyWire(_taggers(), random.Random(seed), split=True, lose_chunk=0.5)

        async def heal(m):
            m.clean()
            m.partial.clear()          # a reconnect starts the reassembly buffer empty
        # the first kill (on B) crosses the lossy wire; the wire heals; the kill on D must score
        snap = _game(mgr, [("BB:2", 1), ("DD:4", 1)], frag_limit=2, mid=heal)
        assert snap["over"]
        assert snap["team_score"].get(1, 0) >= 1, f"seed {seed}: the clean kill after the fault did not score"


def test_soak_pattern_traffic_mid_match_does_not_change_the_score():
    want = _clean_snapshot()["team_score"]
    # the repeating traffic only: `once` is an arm sequence, and a `revive` group re-spawns every gun,
    # which is a different game, not traffic
    groups = [g for p in PATTERNS.values() for g in p.repeating if "SPAWN" not in "".join(g.frames)]
    for p in PATTERNS.values():
        assert_pattern_is_safe(p)
    frames = [f for g in groups for f in g.frames]
    assert frames and not any(f.startswith(f"${h},") for f in frames for h in HANG_LIST)

    async def flood(m):
        for alias in list(m.sessions):
            for f in frames:
                await m.send(alias, f)
    for seed in SEEDS[:2]:
        mgr = FaultyWire(_taggers(), random.Random(seed), split=True)
        snap = _game(mgr, KILLS, frag_limit=2, mid=flood)
        assert snap["over"] and snap["team_score"] == want, f"seed {seed}: {snap['team_score']} != {want}"
