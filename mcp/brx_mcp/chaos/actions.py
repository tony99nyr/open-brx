"""The built-in chaos actions. Each is a PICK function (world, rng) -> params | None and an APPLY
coroutine (world, **params). Parameters are plain JSON values (node indices, numbers), because the
trace stores them and `replay` feeds them back.

To add one: write both halves here (or in any module the CLI imports), register it with `@action`,
and give it a weight in the scenarios that should use it. docs/chaos-testing.md has the recipe.
"""
from __future__ import annotations

import random

from ..mc import envelope as E
from .registry import action
from .stack import until
from .world import World

CLOCK_JUMPS_MS = (-240_000, -60_000, -3_000, 2_000, 45_000, 180_000)


def _two_alive(world: World, rng: random.Random, *, same_team: bool | None = None):
    alive = world.alive_nodes()
    if len(alive) < 2:
        return None
    victim = rng.choice(alive)
    vt = world.players[victim.index]["team_id"]
    others = [n for n in alive if n is not victim]
    if same_team is True:
        others = [n for n in others if world.players[n.index]["team_id"] == vt]
    elif same_team is False and world.scenario.mode != "ffa":
        others = [n for n in others if world.players[n.index]["team_id"] != vt]
    if not others:
        return None
    return victim, rng.choice(others)


def _shooter(world: World, i: int) -> tuple[int, int]:
    p = world.players[i]
    return p["player_num"], world.tid(p["team_id"])


# --------------------------------------------------------------------------- combat
def _pick_hit(world: World, rng: random.Random):
    pair = _two_alive(world, rng)
    if not pair:
        return None
    return {"victim": pair[0].index, "shooter": pair[1].index, "dmg": rng.choice((5, 12, 25, 40)),
            "words": rng.choice((1, 1, 2))}


@action("hit", pick=_pick_hit)
async def hit(world: World, victim: int, shooter: int, dmg: int, words: int) -> None:
    """One shot. `words=2` is a multi-word shot: two `hit_taken` facts with one `shot_group`."""
    world.shot_group += 1
    num, tid = _shooter(world, shooter)
    world.nodes[victim].take_shot(num, tid, dmg, words, world.shot_group)


def _pick_kill(world: World, rng: random.Random):
    pair = _two_alive(world, rng, same_team=False)
    if not pair:
        return None
    return {"victim": pair[0].index, "shooter": pair[1].index}


@action("kill", pick=_pick_kill)
async def kill(world: World, victim: int, shooter: int) -> None:
    """Shots until the victim is down (an enemy kill; in FFA anyone)."""
    num, tid = _shooter(world, shooter)
    node = world.nodes[victim]
    while node.alive:
        world.shot_group += 1
        node.take_shot(num, tid, 40, 1, world.shot_group)


def _pick_team_kill(world: World, rng: random.Random):
    if world.scenario.mode == "ffa":
        return None
    pair = _two_alive(world, rng, same_team=True)
    if not pair:
        return None
    return {"victim": pair[0].index, "shooter": pair[1].index}


@action("team_kill", pick=_pick_team_kill)
async def team_kill(world: World, victim: int, shooter: int) -> None:
    """A friendly kill: the killer's score goes DOWN one."""
    await kill(world, victim, shooter)


def _pick_trade(world: World, rng: random.Random):
    pair = _two_alive(world, rng, same_team=False)
    if not pair:
        return None
    return {"a": pair[0].index, "b": pair[1].index}


@action("trade", pick=_pick_trade)
async def trade(world: World, a: int, b: int) -> None:
    """A and B kill each other on the same millisecond (two nodes, one tick)."""
    na, nb = world.nodes[a], world.nodes[b]
    t = na.synced_now()
    num_a, tid_a = _shooter(world, a)
    num_b, tid_b = _shooter(world, b)
    na.die_at(num_b, tid_b, t)
    nb.die_at(num_a, tid_a, t)


def _pick_timed_kill(world: World, rng: random.Random):
    return None       # script-only: a random pick has no timeline to place the kill on


@action("timed_kill", pick=_pick_timed_kill)
async def timed_kill(world: World, victim: int, shooter: int, at_ms: int) -> None:
    """The victim dies to the shooter at a SCRIPTED time: `at_ms` after the run's timeline zero (the
    victim's clock at the first `timed_kill`). For a script that needs exact gaps between kills (a
    multi-kill chain), which the real time a step takes cannot give."""
    n = world.nodes[victim]
    if world.timeline_t0 is None:
        world.timeline_t0 = n.synced_now()
    num, tid = _shooter(world, shooter)
    n.die_at(num, tid, world.timeline_t0 + at_ms)


LATE_FLUSH_AGES_MS = (300, 900, 5_000, 9_000, 20_000)   # polish r2: 300 and 900 ms are inside CLOCK_TIE_MS


def _recent_killers(world: World) -> list[int]:
    """Node indices of players the ledger shows with an enemy kill (the killers a late kill can wrongly chain)."""
    num_idx = {p["player_num"]: i for i, p in enumerate(world.players)}
    out = []
    for (_nid, _s), ev in world.ledger.facts.items():
        i = num_idx.get(int(ev.get("shooter_num", 0) or 0))
        if ev.get("type") == "death" and i is not None and i < len(world.nodes) and i not in out:
            out.append(i)
    return out


def _pick_late_flush(world: World, rng: random.Random):
    alive = world.alive_nodes()
    killers = [i for i in _recent_killers(world) if world.nodes[i].arm_state == "live"]
    rng.shuffle(killers)
    for k in killers:
        kt = world.players[k]["team_id"]
        victims = [n for n in alive if n.index != k
                   and (world.scenario.mode == "ffa" or world.players[n.index]["team_id"] != kt)]
        if victims:
            return {"victim": rng.choice(victims).index, "shooter": k, "age_ms": rng.choice(LATE_FLUSH_AGES_MS)}
    return None


@action("late_flush", pick=_pick_late_flush)
async def late_flush(world: World, victim: int, shooter: int, age_ms: int) -> None:
    """A node flushes a kill it held: the death reaches MC now, stamped `age_ms` in the past (a phone that
    was out of coverage, or a batch that waited on a slow link). Its t is BEFORE the shooter's newest kill,
    so it must never join or restart that killer's multi-kill chain (integration review 1)."""
    n = world.nodes[victim]
    num, tid = _shooter(world, shooter)
    n.die_at(num, tid, n.synced_now() - age_ms)


def _pick_melee_kill(world: World, rng: random.Random):
    return _pick_kill(world, rng)


@action("melee_kill", pick=_pick_melee_kill)
async def melee_kill(world: World, victim: int, shooter: int) -> None:
    """An enemy kill by melee: the death fact carries `melee: true`, so MC awards BEAT DOWN (`melee_kill`),
    stacked with any chain or streak medal."""
    n = world.nodes[victim]
    if not n.alive:
        return
    num, tid = _shooter(world, shooter)
    n.alive = False
    n.hp = 0
    n.emit({"type": "death", "shooter_num": num, "shooter_team": tid, "melee": True})


def _pick_unknown_shooter(world: World, rng: random.Random):
    alive = world.alive_nodes()
    if not alive:
        return None
    rostered = set(world.num_to_pid())
    free = [n for n in (11, 42, 63) if n not in rostered]
    return {"victim": rng.choice(alive).index, "shooter_num": rng.choice(free)} if free else None


@action("unknown_shooter_death", pick=_pick_unknown_shooter)
async def unknown_shooter_death(world: World, victim: int, shooter_num: int) -> None:
    """The victim dies to a `shooter_num` no rostered player holds (field 2026-09-24: shooter 11 in a
    match with no player 11). The death counts; nobody is credited the kill, so nobody gets its feedback."""
    n = world.nodes[victim]
    if n.alive:
        n.die_at(shooter_num, 0, n.synced_now())


def _pick_respawn(world: World, rng: random.Random):
    dead = world.dead_nodes()
    return {"node": rng.choice(dead).index} if dead else None


@action("respawn", pick=_pick_respawn)
async def respawn(world: World, node: int) -> None:
    """A dead player respawns (a new life)."""
    n = world.nodes[node]
    if not n.alive:
        n.respawn()


# --------------------------------------------------------------------------- the wire
def _pick_drop(world: World, rng: random.Random):
    up = [n for n in world.nodes if not n._paused]
    if len(up) <= 2:
        return None
    return {"node": rng.choice(up).index}


@action("drop", pick=_pick_drop)
async def drop(world: World, node: int) -> None:
    """The node walks out of LAN range. Its facts queue in its ring until it reconnects."""
    await world.nodes[node].disconnect()


def _pick_reconnect(world: World, rng: random.Random):
    off = world.offline_nodes()
    return {"node": rng.choice(off).index} if off else None


@action("reconnect", pick=_pick_reconnect)
async def reconnect(world: World, node: int) -> None:
    """The node comes back and flushes its queued facts as one `event_batch`."""
    n = world.nodes[node]
    n.reconnect()
    await until(lambda: n.link_up, 4.0)


def _pick_duplicate(world: World, rng: random.Random):
    up = [n for n in world.nodes if n.link_up and not n._paused]
    rng.shuffle(up)
    for n in up:
        mine = [s for (nid, s) in world.ledger.order if nid == n.node_id and s not in {q for q, _ in n.ring}]
        if mine:
            return {"node": n.index, "seq": rng.choice(mine), "as_batch": rng.random() < 0.5}
    return None


@action("duplicate", pick=_pick_duplicate)
async def duplicate(world: World, node: int, seq: int, as_batch: bool) -> None:
    """Send a fact MC already acknowledged again (a resend after a lost ack)."""
    n = world.nodes[node]
    ev = world.ledger.facts.get((n.node_id, seq))
    if ev is not None:
        n.resend(seq, ev, as_batch)


def _pick_resend_death(world: World, rng: random.Random):
    up = [n for n in world.nodes if n.link_up and not n._paused and _last_death(world, n) is not None]
    return {"node": rng.choice(up).index, "as_batch": rng.random() < 0.5} if up else None


def _last_death(world: World, n) -> int | None:
    pending = {q for q, _ in n.ring}
    seqs = [s for (nid, s) in world.ledger.order if nid == n.node_id and s not in pending
            and world.ledger.facts[(nid, s)].get("type") == "death"]
    return seqs[-1] if seqs else None


@action("resend_death", pick=_pick_resend_death)
async def resend_death(world: World, node: int, as_batch: bool) -> None:
    """Send the node's last acknowledged DEATH again (a resend after a lost ack). Unlike `duplicate`, a
    script can aim it at a kill without knowing the fact's seq."""
    n = world.nodes[node]
    seq = _last_death(world, n)
    if seq is not None:
        n.resend(seq, world.ledger.facts[(n.node_id, seq)], as_batch)


def _pick_reorder(world: World, rng: random.Random):
    pair = _two_alive(world, rng)
    if not pair or not pair[0].link_up:
        return None
    return {"victim": pair[0].index, "shooter": pair[1].index}


@action("reorder", pick=_pick_reorder)
async def reorder(world: World, victim: int, shooter: int) -> None:
    """Two hits on one node reach MC in reverse seq order."""
    n = world.nodes[victim]
    num, tid = _shooter(world, shooter)
    n.hold_events = True
    try:
        start = len(n.ring)
        for _ in range(2):
            world.shot_group += 1
            n.take_shot(num, tid, 5, 1, world.shot_group)
        held = n.ring[start:]
    finally:
        n.hold_events = False
    for seq, ev in reversed(held):
        n.resend(seq, ev, as_batch=False)


def _pick_skew(world: World, rng: random.Random):
    up = [n for n in world.nodes if n.arm_state == "live"]
    if not up:
        return None
    return {"node": rng.choice(up).index, "delta_ms": rng.choice(CLOCK_JUMPS_MS)}


@action("clock_jump", pick=_pick_skew)
async def clock_jump(world: World, node: int, delta_ms: int) -> None:
    """The phone's clock jumps (forwards or backwards) after its sync. Its next facts carry that t."""
    world.nodes[node].offset_ms += delta_ms


def _pick_jitter(world: World, rng: random.Random):
    up = [n for n in world.nodes if n.arm_state == "live"]
    if not up:
        return None
    return {"deltas": {str(n.index): rng.randint(-400, 400) for n in up}}


@action("clock_jitter", pick=_pick_jitter)
async def clock_jitter(world: World, deltas: dict[str, int]) -> None:
    """Every live phone's clock wanders a little (up to +-400 ms), each its own way."""
    for i, d in deltas.items():
        world.nodes[int(i)].offset_ms += d


def _pick_late_join(world: World, rng: random.Random):
    if world.late_joins >= 2:
        return None
    return {}


@action("late_join", pick=_pick_late_join)
async def late_join(world: World) -> None:
    """A player joins the running match (hot join): a new roster row and a new node."""
    world.late_joins += 1
    await world.late_join()


def _pick_stale_match(world: World, rng: random.Random):
    up = [n for n in world.nodes if n.link_up and n.arm_state == "live"]
    if not up:
        return None
    return {"node": rng.choice(up).index, "shooter": rng.randrange(len(world.players))}


@action("stale_match_fact", pick=_pick_stale_match)
async def stale_match_fact(world: World, node: int, shooter: int) -> None:
    """A death stamped with ANOTHER match's id (a straggler from a previous match). It must park."""
    num, tid = _shooter(world, shooter)
    n = world.nodes[node]
    seq = n.emit({"type": "death", "shooter_num": num, "shooter_team": tid,
                  "match_id": f"stale-{world.seed}-{world.step}"})
    world.stale_facts.append((n.node_id, seq, world.stack.generation if world.stack else 0))


def _pick_stale_head(world: World, rng: random.Random):
    up = [n for n in world.nodes if n.link_up and n.arm_state == "live"]
    return {"node": rng.choice(up).index} if up else None


@action("stale_head", pick=_pick_stale_head)
async def stale_head(world: World, node: int) -> None:
    """The gun reports a head (config_id) that is not the one MC pushed for this match."""
    world.nodes[node].config_id = f"stale-{world.step}"


def _pick_garbage(world: World, rng: random.Random):
    up = [n for n in world.nodes if n.link_up]
    return {"node": rng.choice(up).index, "kind": rng.choice(("json", "envelope"))} if up else None


@action("garbage", pick=_pick_garbage)
async def garbage(world: World, node: int, kind: str) -> None:
    """Malformed bytes on a node's socket: broken JSON, or an envelope of an unknown kind."""
    n = world.nodes[node]
    if kind == "json":
        n.send_raw('{"v":1,"kind":"event","body":{"type":"death"')
    else:
        n.send_raw(E.encode({"v": 1, "kind": "no_such_kind", "t": n.synced_now(), "body": {}}))


def _pick_possession(world: World, rng: random.Random):
    if world.scenario.mode not in ("koth", "domination"):
        return None
    up = [n for n in world.nodes if n.arm_state == "live"]
    if not up:
        return None
    tids = sorted({world.tid(t) for t in world.team_ids()} | {2})
    # The players near the hill (the first four) report again and again, as they do on the field, so
    # the same node's cumulative total arrives many times: that is what max-merging must not add up.
    return {"node": rng.choice(up[:4]).index, "tid": rng.choice(tids), "add_ms": rng.choice((1000, 5000, 20000))}


@action("possession", pick=_pick_possession)
async def possession(world: World, node: int, tid: int, add_ms: int) -> None:
    """A node reports its CUMULATIVE hill tally (koth). Totals only grow; MC merges them by max."""
    held = world.possession.setdefault(node, {})
    held[tid] = held.get(tid, 0) + add_ms
    obs = sum(held.values())
    world.nodes[node].emit({"type": "possession", "site": "A",
                            "hold_ms": {str(k): v for k, v in held.items()}, "observed_ms": obs})


# --------------------------------------------------------------------------- MC itself
def _pick_restart(world: World, rng: random.Random):
    return {} if world.session.phase == "live" else None


@action("mc_restart", pick=_pick_restart)
async def mc_restart(world: World) -> None:
    """MC stops and a new process resumes the match from its snapshot and the stored facts."""
    await world.restart_mc()


@action("mc_crash", pick=_pick_restart)
async def mc_crash(world: World) -> None:
    """MC dies without its last snapshot write (a crash, a laptop lid): the new process reads the
    snapshot as it last hit the disk, up to 2 s old, and the stored facts."""
    await world.restart_mc(crash=True)


def _pick_end(world: World, rng: random.Random):
    return {} if world.session.phase in ("live", "armed") else None


@action("end", pick=_pick_end, terminal=True)
async def end(world: World) -> None:
    """The operator presses END."""
    await world.settle()
    world.mark_end()
    world.session.control("end")


def _pick_time_up(world: World, rng: random.Random):
    return {} if world.session.phase == "live" else None


@action("time_up", pick=_pick_time_up, terminal=True)
async def time_up(world: World) -> None:
    """MC's clock passes the time limit (+ its 5 s grace). `tick()` must end the match once."""
    await world.settle()
    world.mark_end()
    s = world.session
    sc = s.scorer
    tl = s.config.get("time_limit_s")
    if sc is None or not tl:
        return
    assert world.stack is not None
    world.stack.mc_skew_ms = sc.go_live_t + tl * 1000 + 5_001 - world.now_ms()
    s.tick()
    s.tick()
