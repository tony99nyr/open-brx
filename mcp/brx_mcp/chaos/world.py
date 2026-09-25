"""The chaos world: one real MC stack, a field of ledger-keeping MockNodes, and what they did.

`World` is what every action and invariant receives. It holds:

* `stack`: a `ChaosStack` (the real Session + NetServer + Compiler + store), replaced in place by an
  MC restart;
* `nodes`: `ChaosNode`s, which are MockNodes that write every fact they emit into the `ledger`;
* `ledger`: the independent record of every fact the field produced. The invariants compare MC's
  scoring against it, so MC is never checked against its own bookkeeping alone;
* the evidence the invariants read: the phase history, every match finish, the board before END and
  the board on both sides of each MC restart.
"""
from __future__ import annotations

import asyncio
import pathlib
import random
import time
from typing import Any

from ..mc import envelope as E
from ..mc.mock_node import MockNode
from ..mc.scoring import Scorer
from ..mc.state import Session
from ..mc.types import Event
from .registry import Scenario
from .stack import ChaosStack, until

SETTLE_TIMEOUT_S = 4.0


class ChaosNode(MockNode):
    """A MockNode that records every fact it emits, and can hold its sends to reorder them."""

    def __init__(self, *a, ledger: "Ledger | None" = None, **kw):
        super().__init__(*a, **kw)
        self.ledger = ledger
        self.hold_events = False      # True: emit() queues the fact in the ring and sends nothing
        self.live_configs = 0         # `config` envelopes that reached this node while it was LIVE
        self.index = -1               # position in World.nodes
        self._emitted_at: dict[int, float] = {}
        self.ack_latency_s: list[float] = []   # emit -> MC's ack, per fact (a fact queued offline included)

    @property
    def connected(self) -> bool:      # MockNode.emit sends only when this is True
        return super().connected and not self.hold_events

    @property
    def link_up(self) -> bool:
        return super().connected

    def emit(self, ev: dict) -> int:
        online = self.connected       # a fact queued offline waits by design: it is not a latency sample
        seq = super().emit(ev)
        if online:
            self._emitted_at[seq] = time.monotonic()
        if self.ledger is not None:
            self.ledger.record(self.node_id, seq, self.ring[-1][1])
        return seq

    def _handle(self, env: dict) -> None:
        if env.get("kind") == "config" and self.arm_state == "live":
            self.live_configs += 1
        if env.get("kind") == "ack":
            hi, now = int(env["body"].get("seq_hi", 0)), time.monotonic()
            for s in [s for s in self._emitted_at if s <= hi]:
                self.ack_latency_s.append(now - self._emitted_at.pop(s))
        super()._handle(env)

    # -- gun behaviour beyond MockNode's --------------------------------------------------------
    def take_shot(self, shooter_num: int, shooter_team: int, dmg: int, words: int, group: int) -> None:
        """One trigger pull. `words` > 1 is a multi-word shot (a dual emitter): each word is its own
        `hit_taken` fact, and all of them share one `shot_group`, so accuracy counts the pull once."""
        for _ in range(words):
            if not self.alive:
                return
            absorbed = min(self.armor, dmg)
            self.armor -= absorbed
            self.hp = max(0, self.hp - (dmg - absorbed))
            self.emit({"type": "hit_taken", "shooter_num": shooter_num, "shooter_team": shooter_team,
                       "dmg": dmg, "ir_proto": 0, "shot_group": group})
            if self.hp == 0:
                self.die(shooter_num, shooter_team)

    def die_at(self, shooter_num: int, shooter_team: int, t: int) -> None:
        """Die with an explicit timestamp: two nodes calling this with one `t` is a same-tick trade."""
        if not self.alive:
            return
        self.alive = False
        self.hp = 0
        self.emit({"type": "death", "shooter_num": shooter_num, "shooter_team": shooter_team, "t": t})

    def send_env(self, env: dict) -> None:
        self._send(env)

    def resend(self, seq: int, ev: dict, as_batch: bool) -> None:
        """Put an already-sent fact on the wire again (a duplicate, or a reordered send)."""
        if as_batch:
            self._send(E.make_envelope("event_batch", {"events": [dict(ev, seq=seq)]}))
        else:
            self._send(E.make_envelope("event", ev, seq=seq))


class Ledger:
    """Every fact the field emitted, keyed by (node_id, seq). Independent of MC."""

    def __init__(self) -> None:
        self.facts: dict[tuple[str, int], dict] = {}
        self.order: list[tuple[str, int]] = []

    def record(self, node_id: str, seq: int, ev: dict) -> None:
        key = (node_id, seq)
        if key not in self.facts:
            self.order.append(key)
        self.facts[key] = dict(ev)

    def delivered(self, nodes: list[ChaosNode], match_id: str | None = None) -> list[tuple[str, int, dict]]:
        """Facts MC has acknowledged (no longer in their node's ring), in emit order."""
        pending = {(n.node_id, s) for n in nodes for s, _ in n.ring}
        out = []
        for key in self.order:
            if key in pending:
                continue
            ev = self.facts[key]
            if match_id is not None and ev.get("match_id") != match_id:
                continue
            out.append((key[0], key[1], ev))
        return out


# ---------------------------------------------------------------------------- the scorer's input tap
# `medals_track_credited_kills` needs what MC's scorer was FED, in the order it was fed: medals are
# order-sensitive (a chain, a streak, first blood), and a drop, a flush, a reorder or a restart's replay
# all change the order in which MC takes the facts. The tap records each call's INPUTS (the node, the
# seq, the fact, t_recv, the batch re-base, the caller's suppress flag, the node's A5.7 sync state, the
# scorer's end_t and its frag-cap whistle `cap_recv` at that moment) plus MC's verdict ("scored", "dup", "post_end", ...). It records no medal, streak or
# chain: the invariant derives those itself. It wraps the class method, so the replays that build a
# scorer inside `Session._build_scorer` and `Session._replay` are recorded too.
_TAPPED: list["World"] = []
_ORIG_INGEST = Scorer.ingest


def _tapped_ingest(self: Scorer, node_id: str, ev: Event, t_recv: int, *, rebase: int | None = None,
                   suppress_awards: bool = False, seq: int | None = None) -> str:
    entry = {"node_id": node_id, "seq": seq, "ev": dict(ev),
             "t_recv": t_recv, "rebase": rebase, "suppress": suppress_awards,
             "synced": bool(self.synced_at_lobby.get(node_id, False)),
             # the end freeze and the frag-cap whistle AS THIS CALL SAW THEM (both inputs, not verdicts), so
             # an oracle can judge "after the end" and "a team kill after the whistle" without `post_end`
             "end_t": self.end_t, "cap_recv": self.cap_recv}
    entry["result"] = _ORIG_INGEST(self, node_id, ev, t_recv, rebase=rebase, suppress_awards=suppress_awards, seq=seq)
    for w in _TAPPED:
        w.scorers.setdefault(id(self), self)          # held, so an id is never reused inside a run
        w.ingests.setdefault(id(self), []).append(entry)
    return entry["result"]


def _tap_on(world: "World") -> None:
    if not _TAPPED:
        setattr(Scorer, "ingest", _tapped_ingest)
    assert not _TAPPED, "the ingest tap observes ONE World at a time (it broadcasts to every tapped World)"
    _TAPPED.append(world)


def _tap_off(world: "World") -> None:
    if world in _TAPPED:
        _TAPPED.remove(world)
    if not _TAPPED:
        setattr(Scorer, "ingest", _ORIG_INGEST)


class World:
    def __init__(self, sc: Scenario, seed: int, workdir: pathlib.Path, *, nodes: int | None = None):
        self.scenario = sc
        self.seed = seed
        self.rng = random.Random(seed)
        self.workdir = pathlib.Path(workdir)
        self.n_nodes = nodes or sc.nodes
        self.ledger = Ledger()
        self.nodes: list[ChaosNode] = []
        self.players: list[dict] = []            # the roster as added (player_id, player_num, team_id)
        self.stack: ChaosStack | None = None
        self.phase_log: list[tuple[int, str]] = []   # (MC generation, phase), each change once
        self.transitions: list[tuple[str, str, str]] = []   # (from, to, how) -- how: "run" | "resume"
        self.finishes: list[dict] = []           # one row per Session._finish call
        self.restart_checks: list[dict] = []     # the board before and after each MC restart
        self.board_before_end: dict | None = None
        self.late_after_end = 0                  # facts delivered after the match ended
        self.end_delivered: set[tuple[str, int]] | None = None   # facts MC held when the operator ended it
        self.ended = False
        self.match_id: str | None = None
        self.step = 0
        self.shot_group = 0
        self.late_joins = 0
        self.late_pids: set[str] = set()         # A63: hot joiners, who may not hold IRON MAN
        self.timings: list[tuple[str, float]] = []           # (action, seconds incl. settle)
        self.tick_errors: list[str] = []                   # Session.tick() exceptions, for an invariant
        self._resuming = False
        self.stale_facts: list[tuple[str, int, int]] = []   # (node_id, seq, MC generation at emit)
        self._tick_task: asyncio.Task | None = None
        self.possession: dict[int, dict[int, int]] = {}   # node index -> tid -> cumulative ms sent
        self.scorers: dict[int, Scorer] = {}                # id -> every Scorer the tap saw fed
        self.ingests: dict[int, list[dict]] = {}            # id -> that Scorer's inputs, in order
        self.timeline_t0: int | None = None                 # `timed_kill`'s zero, set by its first use

    # ------------------------------------------------------------------ setup / teardown
    @property
    def session(self) -> Session:
        assert self.stack is not None
        return self.stack.session

    def team_ids(self) -> list[str]:
        return [t["team_id"] for t in self.session.teams]

    def tid(self, team_id: str | None) -> int:
        t = self.session.team(team_id)
        return int(t["tid"]) if t else 0

    async def setup(self) -> None:
        sc = self.scenario
        _tap_on(self)
        self.stack = ChaosStack(sc.mode, sc.time_limit_s, self.workdir, **sc.config)
        self.stack.node_cls = ChaosNode
        await self.stack.__aenter__()
        self._hook(self.session)
        teams = self.team_ids()
        for i in range(self.n_nodes):
            self._add_player(i, teams[i % len(teams)])
        # connected together, then kept in index order (World.nodes[i] is player i's node)
        self.nodes = sorted(await asyncio.gather(*[self._connect(i) for i in range(self.n_nodes)]),
                            key=lambda n: n.index)
        if not await self.stack.wait_ready(8.0):
            raise RuntimeError(f"field never went ready: {self.session.readiness()['board'][:3]}")
        info = await self.stack.push_and_start(runway_s=1)
        self.match_id = info["match_id"]
        self._tick_task = asyncio.create_task(self._ticker())
        if not await until(lambda: all(n.arm_state == "live" and n.alive for n in self.nodes)
                           and self.session.phase == "live", 8.0):
            raise RuntimeError("the field never went live")

    def _add_player(self, i: int, team_id: str) -> None:
        assert self.stack is not None
        p = self.stack.add_player(f"P{i:02d}", f"GUN-{i:02d}", team_id=team_id)
        self.players.append({"player_id": p["player_id"], "player_num": p["player_num"], "team_id": p["team_id"]})

    async def _connect(self, i: int) -> ChaosNode:
        assert self.stack is not None
        node = await self.stack.connect_node(f"GUN-{i:02d}", heartbeat_ms=100, ledger=self.ledger)
        assert isinstance(node, ChaosNode)
        node.index = i
        return node

    async def late_join(self) -> int:
        i = len(self.players)
        teams = self.team_ids()
        self._add_player(i, teams[i % len(teams)])
        self.late_pids.add(self.players[-1]["player_id"])
        node = await self._connect(i)
        self.nodes.append(node)
        await until(lambda: node.arm_state == "live" and node.alive, 4.0)
        return i

    async def _ticker(self) -> None:
        # `__main__` runs `Session.tick()` about once a second; faster here so a run does not wait on it.
        while True:
            try:
                if self.stack is not None:
                    self.stack.session.tick()
            except Exception as e:     # recorded for `tick_never_raises`; the loop goes on, as `api.py`'s does
                self.tick_errors.append(f"{type(e).__name__}: {e}")
            await asyncio.sleep(0.05)

    async def teardown(self) -> None:
        _tap_off(self)
        if self._tick_task:
            self._tick_task.cancel()
            try:
                await self._tick_task
            except (asyncio.CancelledError, Exception):
                pass
        if self.stack is not None:
            await self.stack.__aexit__(None, None, None)

    # ------------------------------------------------------------------ evidence hooks
    def _hook(self, s: Session, how: str = "run") -> None:
        gen = self.stack.generation if self.stack else 0
        last = {"phase": s.phase}
        self.phase_log.append((gen, s.phase))

        def changed() -> None:
            if s.phase != last["phase"]:
                if not self._resuming:      # a resume's own moves are one "resume" transition
                    self.transitions.append((last["phase"], s.phase, "run"))
                last["phase"] = s.phase
                self.phase_log.append((gen, s.phase))
        s.on_change(changed)
        orig = s._finish

        def finish() -> None:
            self.finishes.append({"gen": gen, "phase": s.phase, "reason": s.end_reason,
                                  "match_id": (s.start_info or {}).get("match_id")
                                  or (s.scorer.match_id if s.scorer else None), "step": self.step})
            orig()
        setattr(s, "_finish", finish)      # every internal `self._finish()` now goes through here
        self._last_phase = last

    async def restart_mc(self, crash: bool = False) -> None:
        assert self.stack is not None
        before = self.board()
        old_phase = self.session.phase
        # The new session is hooked BEFORE it resumes, so a match that finishes during the resume is
        # counted. The board read right after is the one rebuilt from the snapshot and the stored facts,
        # before any node says hello to the new MC.
        self._resuming = True
        try:
            resumed = await self.stack.restart_mc(crash=crash, on_session=self._hook)
        finally:
            self._resuming = False
        after = self.board()
        self.restart_checks.append({"step": self.step, "before": before, "after": after,
                                    "phase_before": old_phase, "resumed": resumed, "crash": crash})
        self.transitions.append((old_phase, self.session.phase, "resume"))

    def mark_end(self) -> None:
        """Called by a terminal action, after settling and before it ends the match."""
        self.board_before_end = self.board()
        self.end_delivered = {(n, s) for n, s, _ in self.ledger.delivered(self.nodes)}

    # ------------------------------------------------------------------ views
    def board(self, s: Session | None = None) -> dict:
        s = s or self.session
        sc = s.scorer
        rows = {r["player_id"]: {"kills": r["kills"], "deaths": r["deaths"], "assists": r["assists"],
                                 "hits": r["hits"], "team_id": r["team_id"]}
                for r in (sc.rows() if sc else [])}
        return {"phase": s.phase, "match_id": sc.match_id if sc else None, "rows": rows,
                "post_end": len(sc.post_end) if sc else 0}

    def num_to_pid(self) -> dict[int, str]:
        return {p["player_num"]: p["player_id"] for p in self.players}

    def team_of(self, pid: str) -> str | None:
        return next((p["team_id"] for p in self.players if p["player_id"] == pid), None)

    def alive_nodes(self) -> list[ChaosNode]:
        return [n for n in self.nodes if n.alive and n.arm_state == "live"]

    def dead_nodes(self) -> list[ChaosNode]:
        return [n for n in self.nodes if not n.alive and n.arm_state == "live" and n.link_up]

    def offline_nodes(self) -> list[ChaosNode]:
        return [n for n in self.nodes if n._paused]

    # ------------------------------------------------------------------ settling
    async def settle(self, timeout: float = SETTLE_TIMEOUT_S) -> bool:
        """Wait until every node that is up has had all its facts acknowledged and MC has caught up.

        A node that is offline (dropped on purpose) keeps its ring; that is the point of the drop."""
        def quiet() -> bool:
            for n in self.nodes:
                if n._paused or n.hold_events:
                    continue
                if not n.link_up or n.ring:
                    return False
            return True
        ok = await until(quiet, timeout, step=0.01)
        # One more loop turn, so an ack's consequences (score pushes, feed) have run.
        await asyncio.sleep(0)
        return ok

    def now_ms(self) -> int:
        return int(time.time() * 1000)


def describe(params: dict[str, Any]) -> str:
    return " ".join(f"{k}={v}" for k, v in params.items())
