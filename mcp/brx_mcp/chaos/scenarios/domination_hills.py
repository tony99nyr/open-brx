"""Domination on three REAL hill stations, scored from the PHONES (Tony 2026-11-07: "a hill shouldnt be the one reporting
the score right? it should be the phones").

Three utility nodes stand in for the hills; they set up the sites and beat on, carrying their own owned clock, which is
now only the cross-check on each hill's row. The score comes from the phones. Phones walk up to hills and away (on
arrival a phone re-asserts the owner it hears); every phone near a hill hears each flip of its owner and sends an
`own_change` fact (from the owner IT last heard, stamped on its own clock, a few hundred ms off). A hill flips at most
every 1.2 s, as on the field. A phone out of Wi-Fi queues its facts and delivers them when it is back (before END here;
a fact after the whistle is a unit test in `test_mc_domination`).

The truth is the hills' owner timelines (`world.hill_tl`). The check: the recap's points per team are that truth, within
the clocks' skew per flip, and the winner follows it, whatever else happened (kills, phone drops, hill drops and returns,
MC restarts and crashes, a target reached mid-match).
"""
from __future__ import annotations

import asyncio
import random

from ..match_access import match_scorer
from ...mc.types import STATUS_HEARTBEAT_MS
from ..registry import InvariantError, Scenario, action, scenario
from ..stack import until
from ..station_actions import _utility
from ..world import World

HILLS = ("dom-hill-a", "dom-hill-b", "dom-hill-c")
SETUP = [{"name": "station_assign_control", "params": {"nid": nid}} for nid in HILLS]
NEUTRAL = 2


def _skew(i: int) -> int:
    """A phone's clock offset from MC's, in ms: fixed per phone, -300 to +300."""
    return ((i * 37) % 5 - 2) * 150


def _timelines(world: World) -> dict[str, list[tuple[int, int]]]:
    if not hasattr(world, "hill_tl"):
        world.hill_tl = {nid: [] for nid in HILLS}   # type: ignore[attr-defined]
    return world.hill_tl   # type: ignore[attr-defined]


def _heard(world: World) -> dict[tuple[int, str], int]:
    """Per (phone, hill): the owner that phone last heard."""
    if not hasattr(world, "hill_heard"):
        world.hill_heard = {}   # type: ignore[attr-defined]
    return world.hill_heard   # type: ignore[attr-defined]


def _owner(world: World, nid: str) -> int:
    tl = _timelines(world)[nid]
    return tl[-1][1] if tl else NEUTRAL


def _truth_ms(world: World, start: int, end: int) -> tuple[dict[int, int], int]:
    """(ms each tid owned, summed over the hills, from `start` to `end`; the number of flips)."""
    owned: dict[int, int] = {}
    flips = 0
    for tl in _timelines(world).values():
        cur, t0 = NEUTRAL, start
        for t, own in tl:
            if t > end:
                break
            owned[cur] = owned.get(cur, 0) + max(0, t - t0)
            cur, t0 = own, max(t, start)
            flips += 1
        owned[cur] = owned.get(cur, 0) + max(0, end - t0)
    return owned, flips


def _site(world: World, nid: str) -> str | None:
    a = world.session.station_registry.assignment(nid)
    return str(a["id"]) if a else None


def _near(world: World) -> dict[int, set[str]]:
    """Per phone: the hills it is near now (it hears their adverts)."""
    if not hasattr(world, "hill_near"):
        world.hill_near = {}   # type: ignore[attr-defined]
    return world.hill_near   # type: ignore[attr-defined]


FLIP_GAP_MS = 1200   # one hill's owner changes at most this often (a capture takes seconds; a drain to neutral too)


def _queued(world: World) -> list[dict]:
    """Each fact a phone could not deliver at once: {"at": when heard, "acked": when MC acked it, or None}."""
    if not hasattr(world, "hill_queued"):
        world.hill_queued = []   # type: ignore[attr-defined]
    return world.hill_queued   # type: ignore[attr-defined]


async def _watch_ack(node, seq: int, row: dict, world: World) -> None:
    if await until(lambda: all(s > seq for s, _e in node.ring), 120.0):
        row["acked"] = world.session.now_ms()


async def _emit(world: World, i: int, nid: str, frm: int, own: int) -> None:
    """The phone sends the fact. A phone in Wi-Fi has it acked within a beat; one out of Wi-Fi (or whose MC restarted
    before the ack) queues it, and `_queued` notes when, for the check's known limit."""
    site = _site(world, nid)
    if site is None:
        return
    node = world.nodes[i]
    now = world.session.now_ms()
    seq = node.emit({"type": "own_change", "site": site, "from_tid": frm, "owner_tid": own, "at_ms": now + _skew(i)})
    _heard(world)[(i, nid)] = own
    if not node.link_up or not await until(lambda: all(s > seq for s, _e in node.ring), 3.0):
        row = {"at": now, "acked": None}
        _queued(world).append(row)
        tasks = world.__dict__.setdefault("hill_watchers", [])
        tasks.append(asyncio.ensure_future(_watch_ack(node, seq, row, world)))


def _pick_hill_walk(world: World, rng: random.Random):
    if world.session.phase != "live" or not world.nodes:
        return None
    return {"node": rng.choice(world.nodes).index, "nid": rng.choice(HILLS), "near": rng.random() < 0.6}


@action("hill_walk", pick=_pick_hill_walk)
async def hill_walk(world: World, node: int, nid: str, near: bool) -> None:
    """A phone walks up to a hill (it re-asserts the owner it hears, as on a first hearing or after a gap) or away."""
    if world.session.phase != "live" or _site(world, nid) is None:
        return
    here = _near(world).setdefault(node, set())
    if near and nid not in here:
        here.add(nid)
        own = _owner(world, nid)
        await _emit(world, node, nid, own, own)
    elif not near:
        here.discard(nid)


def _pick_hill_flip(world: World, rng: random.Random):
    if world.session.phase != "live" or match_scorer(world.session) is None:
        return None
    nid = rng.choice(HILLS)
    if _site(world, nid) is None or not any(nid in hs for hs in _near(world).values()):
        return None   # a capture or a drain needs a player on the hill, and every player carries a phone
    cur = _owner(world, nid)
    nxt = rng.choice(sorted(world.tid(t) for t in world.team_ids())) if cur == NEUTRAL else NEUTRAL
    return {"nid": nid, "owner": nxt}


@action("hill_flip", pick=_pick_hill_flip)
async def hill_flip(world: World, nid: str, owner: int) -> None:
    """Hill `nid`'s owner becomes `owner` (a capture, or a drain to neutral). Every phone near it hears the step and sends
    an own_change from the owner it last heard; a phone out of Wi-Fi queues it."""
    tl = _timelines(world)[nid]
    if tl and (wait := tl[-1][0] + FLIP_GAP_MS - world.session.now_ms()) > 0:
        await asyncio.sleep(wait / 1000)
    if _site(world, nid) is None or world.session.phase != "live" or _owner(world, nid) == owner:
        return
    tl.append((world.session.now_ms(), owner))
    for i, hs in sorted(_near(world).items()):
        if nid in hs:
            await _emit(world, i, nid, _heard(world).get((i, nid), owner), owner)
    if (st := world.station_nodes.get(nid)) is not None and (body := _station_body(world, nid)) is not None:
        _sticks(world)[nid] = body
        st.extra_status.update(body)   # the Stick's own clock at the flip rides on its beats: the cross-check only
        st.send_status()
        await _sticks_heard(world, [nid])


def _pick_hill_assert(world: World, rng: random.Random):
    pairs = [(i, nid) for i, hs in _near(world).items() for nid in sorted(hs)]
    return {"node": (pick := rng.choice(pairs))[0], "nid": pick[1]} if pairs and world.session.phase == "live" else None


@action("hill_assert", pick=_pick_hill_assert)
async def hill_assert(world: World, node: int, nid: str) -> None:
    """A phone near the hill re-asserts the owner it hears (its 30 s beat)."""
    if world.session.phase == "live" and nid in _near(world).get(node, set()):
        own = _owner(world, nid)
        await _emit(world, node, nid, own, own)


def _sticks(world: World) -> dict[str, dict]:
    """Per hill: the body its Stick beats with, set at its last flip (so a beat says the same until the next one)."""
    if not hasattr(world, "hill_sticks"):
        world.hill_sticks = {}   # type: ignore[attr-defined]
    return world.hill_sticks   # type: ignore[attr-defined]


def _station_body(world: World, nid: str) -> dict | None:
    a = world.session.station_registry.assignment(nid)
    sc = match_scorer(world.session)
    if not a or sc is None:
        return None
    tl = _timelines(world)[nid]
    own: dict[int, int] = {}
    cur, t0 = NEUTRAL, sc.go_live_t
    for t, o in tl:
        own[cur] = own.get(cur, 0) + t - t0
        cur, t0 = o, t
    own[cur] = own.get(cur, 0) + world.session.now_ms() - t0
    return {"role": "utility", "kind": "control", "team": 255, "station_id": a["id"], "armed": True, "live": True,
            "control": {"owner": cur, "progress": 100, "contested": False, "hold_ms": {},
                        "own_ms": {str(t): ms for t, ms in own.items() if t != NEUTRAL}}}


def _pick_hill_drop(world: World, rng: random.Random):
    up = [nid for nid in HILLS if (n := world.station_nodes.get(nid)) is not None and n.connected]
    return {"nid": rng.choice(up)} if up and world.session.phase == "live" else None


@action("hill_drop", pick=_pick_hill_drop)
async def hill_drop(world: World, nid: str) -> None:
    """The Stick walks out of Wi-Fi (or never reaches it). Its points do not depend on it: the phones report them."""
    node = world.station_nodes.get(nid)
    if node is not None and node.connected:
        await node.disconnect()


def _pick_hill_return(world: World, rng: random.Random):
    down = [nid for nid in HILLS if (n := world.station_nodes.get(nid)) is not None and not n.connected]
    return {"nid": rng.choice(down)} if down else None


@action("hill_return", pick=_pick_hill_return)
async def hill_return(world: World, nid: str) -> None:
    """The Stick comes back into Wi-Fi: it says hello again, MC re-arms it, and it beats on."""
    node = await _utility(world, nid)
    if (body := _sticks(world).get(nid)) is not None:
        node.extra_status.update(body)
        node.send_status()
    await _sticks_heard(world, [nid])   # a real Stick beats on: MC keeps its tally once past the re-arming window


def _pick_live_restart(world: World, rng: random.Random):
    return {} if world.session.phase == "live" else None


async def _sticks_heard(world: World, only: list[str] | None = None) -> None:
    """Wait (bounded) until MC holds each Stick's latest beat: a real Stick beats every second, and MC keeps no tally from
    a beat within one heartbeat of an arming (`_keep_tally`). The rows are the cross-check; the score never waits."""
    up = [nid for nid in (only or HILLS) if (n := world.station_nodes.get(nid)) is not None and n.connected]

    def heard() -> bool:
        for nid in up:
            st = world.session.station_registry.stations.get(nid) or {}
            if world.session.now_ms() < ((st.get("armed") or {}).get("at") or 0) + STATUS_HEARTBEAT_MS + 100:
                return False
            body = _sticks(world).get(nid)
            if body is None:
                continue
            own = {int(k): v for k, v in body["control"]["own_ms"].items()}
            hold = (st.get("tally") or {}).get("hold_ms")   # Domination's tally keeps the owned clock (`ownership_clock`)
            if not isinstance(hold, dict) or {int(k): v for k, v in hold.items()} != own:
                return False
        return True

    for _ in range(60):
        if heard():
            return
        for nid in up:
            if (n := world.station_nodes.get(nid)) is not None and (body := _sticks(world).get(nid)) is not None:
                n.extra_status.update(body)
                n.send_status()
        await asyncio.sleep(0.1)


async def _restart_on_field_time(world: World, crash: bool) -> None:
    """An MC restart or crash. The phones' facts are in MC's store as they arrive, so a crash loses none of them (the
    snapshot's 2 s throttle only covers MC's own state). The Sticks beat every second, so MC has heard each one first."""
    await _sticks_heard(world)
    if crash:
        await asyncio.sleep(2.2)
        world.session.tick()
    if world.session.phase != "live":
        return   # the target ended it while the field waited (an owned hill scores on the clock): nothing to restart into
    await world.restart_mc(crash=crash)
    await _sticks_heard(world)


@action("hill_restart", pick=_pick_live_restart)
async def hill_restart(world: World) -> None:
    """MC stops cleanly mid-match and a new MC resumes it."""
    await _restart_on_field_time(world, crash=False)


@action("hill_crash", pick=_pick_live_restart)
async def hill_crash(world: World) -> None:
    """MC dies mid-match without a last write (a laptop lid, a power cut); a new MC resumes from the snapshot."""
    await _restart_on_field_time(world, crash=True)


def _pick_hill_end(world: World, rng: random.Random):
    return {} if world.session.phase in ("live", "armed") else None


@action("hill_end", pick=_pick_hill_end, terminal=True)
async def hill_end(world: World) -> None:
    """The operator presses END once every phone out of Wi-Fi has walked back and delivered what it queued (its kills
    as well, which the kill checks hold to the board at END). A late own_change after the whistle is a unit test
    (`test_mc_domination`)."""
    for n in world.offline_nodes():
        n.reconnect()
    await world.settle()
    world.mark_end()
    if world.session.phase in ("live", "armed"):
        world.session.control("end")
    await world.settle()


def domination_hills_check(world: World) -> None:
    """The recap's Domination points are the hills' owner timelines, summed per team, within the phones' clock skew per
    flip; the winner follows them; a target end means a team really reached the target."""
    sc = match_scorer(world.session)
    if sc is None or world.session.phase != "recap" or sc.end_t is None:
        return
    tid_team = {t["tid"]: team_id for team_id, t in sc.teams.items()}
    owned, flips = _truth_ms(world, sc.go_live_t, sc.end_t)
    want_ms = {team_id: owned.get(t["tid"], 0) for team_id, t in sc.teams.items()}
    tol = 700 * flips + 1000   # each flip's edge moves by at most the skew between two phones (600 ms), plus rounding
    recap = world.session.last_recap or {}
    got = ((recap.get("possession") or {}).get("by_team")) or {k: 0 for k in want_ms}
    for k, ms in want_ms.items():
        if abs(got.get(k, 0) * 1000 - ms) > tol:
            raise InvariantError("domination_points", f"the hills' owners say {want_ms} ms ({flips} flips); the recap says {got}")
    target = (world.session.config.get("scoring") or {}).get("hold_target_s")
    # Known limit (docs/chaos-testing.md): MC scores the owner it knows, so when every phone that heard a drain was out of
    # Wi-Fi, the old owner scores on until that phone is back, and can reach the target first
    whistle = next((f["at_ms"] for f in world.finishes if f.get("reason") == "hold_target"), None)
    stale = whistle is not None and any(q["at"] <= whistle and (q["acked"] is None or q["acked"] > whistle)
                                        for q in _queued(world))   # a step still on a phone at the whistle
    if (world.session.end_reason == "hold_target" and target and not stale
            and not any(v >= target * 1000 - tol for v in want_ms.values())):
        raise InvariantError("domination_points", f"MC ended on the {target}-point target; the hills say only {want_ms} ms "
                             f"(truth {_timelines(world)}; facts {getattr(sc, 'own_changes', {})}; go {sc.go_live_t}, end {sc.end_t})")
    winner = recap.get("winner") or {}
    ranked = sorted(want_ms.items(), key=lambda kv: -kv[1])
    if len(ranked) >= 2 and ranked[0][1] - ranked[1][1] > 2 * tol and winner.get("team_id") != ranked[0][0]:
        raise InvariantError("domination_points", f"the hills say {ranked[0][0]} won {want_ms}; MC's winner is {winner}")
    _ = tid_team


HILL_MIX = {
    "hit": 4, "kill": 4, "respawn": 4, "drop": 1.5, "reconnect": 1.5, "duplicate": 1, "reorder": 0.5,
    "hill_restart": 0.8, "hill_crash": 0.8, "hill_flip": 8, "hill_walk": 5, "hill_assert": 1.5, "hill_drop": 1,
    "hill_return": 1.5,
}

scenario(Scenario(
    name="domination-hills-target", mode="domination", nodes=6, steps=40, finish="hill_end", real_stations=True,
    config={"scoring": {"hold_target_s": 4}},
    doc="domination-hills with a target the hills reach (4 points): MC ends on it (on a fact or on its tick, since an "
        "owned hill scores with nobody near it), and the team that crossed it wins.",
    setup_script=SETUP, weights=HILL_MIX, checks=(domination_hills_check,), ci_seeds=(3,),
))

scenario(Scenario(
    name="domination-hills", mode="domination", nodes=6, steps=40, finish="hill_end", real_stations=True,
    doc="Domination scored from the phones' own_change facts on three real hills, through kills, phone drops (late "
        "facts), Stick drops and returns, MC restarts and crashes: the recap's points are the hills' owner timelines.",
    setup_script=SETUP, weights=HILL_MIX, checks=(domination_hills_check,), ci_seeds=(2,),
))

# The field's order of trouble, scripted: red takes A and blue takes B, MC restarts, phone 1 walks out of Wi-Fi and
# hears blue take C, the Stick on B drops and returns, MC crashes, red drains A, phone 1 comes back after the whistle.
_SCRIPT = [
    {"name": "hill_walk", "params": {"node": 0, "nid": "dom-hill-a", "near": True}},
    {"name": "hill_walk", "params": {"node": 2, "nid": "dom-hill-a", "near": True}},
    {"name": "hill_walk", "params": {"node": 1, "nid": "dom-hill-b", "near": True}},
    {"name": "hill_walk", "params": {"node": 1, "nid": "dom-hill-c", "near": True}},
    {"name": "hill_flip", "params": {"nid": "dom-hill-a", "owner": 0}},
    {"name": "hill_flip", "params": {"nid": "dom-hill-b", "owner": 1}},
    {"name": "hill_restart", "params": {}},
    {"name": "drop", "params": {"node": 1}},
    {"name": "hill_flip", "params": {"nid": "dom-hill-c", "owner": 1}},
    {"name": "hill_drop", "params": {"nid": "dom-hill-b"}},
    {"name": "hill_return", "params": {"nid": "dom-hill-b"}},
    {"name": "hill_crash", "params": {}},
    {"name": "hill_flip", "params": {"nid": "dom-hill-a", "owner": 2}},
    {"name": "hill_end", "params": {}},
]

scenario(Scenario(
    name="domination-hills-restart", mode="domination", nodes=4, real_stations=True,
    doc="Phone-scored Domination: an MC restart and an MC crash mid-match, a phone out of Wi-Fi that delivers a capture "
        "after the whistle, and a Stick that drops and returns. No point lost, none counted twice.",
    setup_script=SETUP, script=_SCRIPT, checks=(domination_hills_check,), ci_seeds=(1,),
))


# Tony 2026-11-07: FINAL SCORE PENDING. Red takes hill A with phones 0 and 1 near it; phone 0 walks away and phone 1 walks
# out of Wi-Fi, where it alone hears blue drain A and take it. MC's clock then steps 25 s on (the field plays on), so MC,
# which knows only red's capture, sees red at the 20-point target and ends the match with phone 1 silent. MC must hold
# the result: no winner on the console, no `result` to any phone, no 120 s bound.
def _never(world: World, rng: random.Random):
    return None   # script-only


@action("hill_tick", pick=_never)
async def hill_tick(world: World) -> None:
    """MC's tick runs (the target is checked on it), then the scenario notes what MC shows: the check reads it."""
    for _ in range(3):
        world.session.tick()
        await asyncio.sleep(0.05)
    s = world.session
    sc = match_scorer(s)
    if s.phase == "recap" and sc is not None and not hasattr(world, "hill_held"):
        rc = s.recap() or {}
        world.hill_held = {"reason": s.end_reason, "winner": rc.get("winner"), "sync": dict(rc.get("sync") or {}),   # type: ignore[attr-defined]
                           "results": sum(1 for n in world.nodes for env in n.received
                                          if env["kind"] == "result" and env["body"].get("match_id") == sc.match_id)}


@action("hill_back", pick=_never)
async def hill_back(world: World, node: int) -> None:
    """Phone `node` walks back into Wi-Fi after the whistle: it delivers its queued reports, takes the END it missed and
    beats on. The step waits (bounded) until MC holds its drained beat, as the field waits for a 2 s beat."""
    n = world.nodes[node]
    n.reconnect()

    def drained() -> bool:
        rows = (((world.session.recap() or {}).get("sync")) or {}).get("rows") or []
        return any(r["kind"] == "phone" and r["id"] == n.player_id and r["stage"] == "received" for r in rows)

    await until(drained, 5.0)


@action("hill_end_now", pick=_never, terminal=True)
async def hill_end_now(world: World) -> None:
    """The operator presses END NOW: phone 1 is dead. MC declares from what it has; the run's aftermath brings the phone
    back later, and its reports then merge in (RESULT CHANGED)."""
    world.session.finalise_recap()
    rc = world.session.recap() or {}
    world.hill_end_now = {"winner": rc.get("winner"), "sync": dict(rc.get("sync") or {})}   # type: ignore[attr-defined]


def domination_held_check(world: World) -> None:
    held = getattr(world, "hill_held", None)
    if held is None or held["reason"] != "hold_target":
        raise InvariantError("domination_held", f"the target did not end the match while phone 1 was out ({held})")
    sync = held["sync"]
    if (held["winner"] is not None or not sync.get("pending") or sync.get("score_pending") is not True
            or "release_in_s" in sync or held["results"]):
        raise InvariantError("domination_held", f"MC showed a result that phone 1 could change: {held}")
    final = ((world.session.recap() or {}).get("sync")) or {}
    end_now = getattr(world, "hill_end_now", None)
    if end_now is None:
        if final.get("released_by") != "sync":
            raise InvariantError("domination_held", f"phone 1 came back, but the result was not released by it: {final}")
        return
    if end_now["winner"] is None or end_now["sync"].get("released_by") != "finalise":
        raise InvariantError("domination_held", f"END NOW did not declare the result: {end_now}")
    if not final.get("result_changed"):
        raise InvariantError("domination_held", f"phone 1's late reports moved the winner, but RESULT CHANGED is off: {final}")


_HELD = [
    {"name": "hill_walk", "params": {"node": 0, "nid": "dom-hill-a", "near": True}},
    {"name": "hill_walk", "params": {"node": 1, "nid": "dom-hill-a", "near": True}},
    {"name": "hill_flip", "params": {"nid": "dom-hill-a", "owner": 0}},
    {"name": "hill_walk", "params": {"node": 0, "nid": "dom-hill-a", "near": False}},
    {"name": "drop", "params": {"node": 1}},
    {"name": "hill_flip", "params": {"nid": "dom-hill-a", "owner": 2}},
    {"name": "hill_flip", "params": {"nid": "dom-hill-a", "owner": 1}},
    {"name": "mc_clock_step", "params": {"delta_ms": 25_000}},
    {"name": "hill_tick", "params": {}},
]

scenario(Scenario(
    name="domination-held-drained", mode="domination", nodes=4, real_stations=True, config={"scoring": {"hold_target_s": 20}},
    doc="FINAL SCORE PENDING: MC reaches the target on what it knows while a phone out of Wi-Fi holds the capture that "
        "changes the winner. MC holds the result past the old bound, then the phone walks back and its reports decide it.",
    setup_script=SETUP, script=[*_HELD, {"name": "hill_back", "params": {"node": 1}}, {"name": "hill_end", "params": {}}],
    checks=(domination_hills_check, domination_held_check), ci_seeds=(1,),
))

scenario(Scenario(
    name="domination-held-dead", mode="domination", nodes=4, real_stations=True, config={"scoring": {"hold_target_s": 20}},
    doc="FINAL SCORE PENDING with a dead phone: the result stays held until the operator presses END NOW, which declares "
        "from what MC has. When the phone does come back, its reports merge in and RESULT CHANGED says so.",
    setup_script=SETUP, script=[*_HELD, {"name": "hill_end_now", "params": {}}],
    checks=(domination_hills_check, domination_held_check), ci_seeds=(1,),
))
