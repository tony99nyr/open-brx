"""Domination on three REAL hill stations (review push 2026-11-06, brx4).

`domination.py`'s domination-mixed scores phone `possession` facts on one site. The field's Domination scores
something else: each hill station's own heartbeat, `control.own_ms` (the owned clock), summed over the three hills
(`stations.ownership_clock`, `Session._station_possession`). Nothing in chaos drove that path. Here three utility
nodes stand in for the hills. Each one's heartbeat (every 40 ms, like a real hill's 1 s beat) carries its cumulative
owned clock, so after a drop, a return or an MC restart the next beat brings the station's truth back.

The truth is the stations' own clocks (`world.hill_own`): a hill only ever banks time already played, one owner at
a time, so the sum over teams on one hill never passes the time since go-live. The check: the recap's points per team
and the winner equal that truth, whatever else happened (kills, drops, MC restarts and crashes, a hill that walks
out of Wi-Fi and back, a target reached mid-match).
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
_MARGIN_MS = 30   # a beat banks a little less than played, so MC's played-time clamp never trims it


def _hill_state(world: World) -> dict[str, dict[int, int]]:
    if not hasattr(world, "hill_own"):
        world.hill_own = {nid: {} for nid in HILLS}   # type: ignore[attr-defined]
    return world.hill_own   # type: ignore[attr-defined]


def _station_body(world: World, nid: str) -> dict | None:
    a = world.session.station_registry.assignment(nid)
    if not a:
        return None
    own = _hill_state(world)[nid]
    owner = max(own, key=lambda t: own[t]) if own else 2
    return {"role": "utility", "kind": "control", "team": 255, "station_id": a["id"], "armed": True, "live": True,
            "control": {"owner": owner, "progress": 100, "contested": False,
                        "hold_ms": {str(t): ms // 2 for t, ms in own.items()},   # presence: Domination never scores it
                        "own_ms": {str(t): ms for t, ms in own.items()}}}


def _pick_hill_bank(world: World, rng: random.Random):
    if world.session.phase != "live":
        return None
    # a hill out of Wi-Fi keeps counting (review round 2): its next beat, in play or after the whistle, brings it
    known = [nid for nid in HILLS if world.station_nodes.get(nid) is not None]
    if not known:
        return None
    tids = sorted(world.tid(t) for t in world.team_ids())
    return {"nid": rng.choice(known), "tid": rng.choice(tids), "share": rng.choice((0.25, 0.5, 1.0))}


@action("hill_bank", pick=_pick_hill_bank)
async def hill_bank(world: World, nid: str, tid: int, share: float) -> None:
    """The hill `nid` banks `share` of its unbanked played time to team `tid` and says so on its next beat."""
    node = world.station_nodes.get(nid)
    sc = match_scorer(world.session)
    if node is None or sc is None or world.session.phase != "live":
        return
    own = _hill_state(world)[nid]
    if not node.connected:
        # Out of Wi-Fi: it banks only time since MC last heard it, as a real hill does (one owner at a time), and says
        # so when it is back. MC bounds a report after the whistle by that same window (`Scorer._late_bound`).
        spent = _away_spent(world)
        away = world.session.now_ms() - _dropped_at(world).get(nid, world.session.now_ms()) - spent.get(nid, 0)
        room = min(world.session.now_ms() - sc.go_live_t - sum(own.values()), away) - _MARGIN_MS
        if room > 0:
            add = int(room * share)
            own[tid] = own.get(tid, 0) + add
            spent[nid] = spent.get(nid, 0) + add
            if (body := _station_body(world, nid)) is not None:
                node.extra_status.update(body)
        return
    st = world.session.station_registry.stations.get(nid) or {}
    armed_at = (st.get("armed") or {}).get("at") or 0
    # a beat within one heartbeat of an arming may carry the last game's tally, so MC does not seed from it
    # (`_keep_tally`); a real hill beats on. Wait that window out instead.
    await until(lambda: world.session.now_ms() >= armed_at + STATUS_HEARTBEAT_MS + 100, 4.0)
    room = world.session.now_ms() - sc.go_live_t - sum(own.values()) - _MARGIN_MS
    if room <= 0:
        return
    own[tid] = own.get(tid, 0) + int(room * share)
    body = _station_body(world, nid)
    if body is None:
        return
    node.extra_status.update(body)
    node.send_status()
    # wait until MC has the beat: its tally for this hill reads the new clock
    want = dict(own)
    await until(lambda: _mc_hill(world, nid) == want or world.session.phase != "live", 3.0)
    if world.session.phase != "live":
        await _after_whistle(world)   # this beat crossed the target: the hills out of Wi-Fi come back and report late


def _dropped_at(world: World) -> dict[str, int]:
    if not hasattr(world, "hill_dropped_at"):
        world.hill_dropped_at = {}   # type: ignore[attr-defined]
    return world.hill_dropped_at   # type: ignore[attr-defined]


def _away_spent(world: World) -> dict[str, int]:
    """Per hill, the ms it banked since it left Wi-Fi: one owner at a time, so never more than the time away."""
    if not hasattr(world, "hill_away_spent"):
        world.hill_away_spent = {}   # type: ignore[attr-defined]
    return world.hill_away_spent   # type: ignore[attr-defined]


def _mc_hill(world: World, nid: str) -> dict[int, int] | None:
    tally = (world.session.station_registry.stations.get(nid) or {}).get("tally") or {}
    hold = tally.get("hold_ms")
    return {int(k): v for k, v in hold.items()} if isinstance(hold, dict) else None


def _pick_hill_drop(world: World, rng: random.Random):
    up = [nid for nid in HILLS if (n := world.station_nodes.get(nid)) is not None and n.connected]
    return {"nid": rng.choice(up)} if up and world.session.phase == "live" else None


@action("hill_drop", pick=_pick_hill_drop)
async def hill_drop(world: World, nid: str) -> None:
    """The hill walks out of Wi-Fi: its socket closes and it stays quiet. Its clock keeps what it banked."""
    node = world.station_nodes.get(nid)
    if node is not None and node.connected:
        await node.disconnect()
        # after the last beat MC heard from it. A hill MC never heard in play (gone inside the first heartbeat after its
        # arming) has no base a late report can be bounded against, so MC calls that report unverified, by design
        # (`Scorer.station_possession`): such a hill banks nothing while away here.
        heard = ((world.session.station_registry.stations.get(nid) or {}).get("tally") or {}).get("at") is not None
        _dropped_at(world)[nid] = world.session.now_ms()
        _away_spent(world)[nid] = 0 if heard else 10**12


def _pick_hill_return(world: World, rng: random.Random):
    down = [nid for nid in HILLS if (n := world.station_nodes.get(nid)) is not None and not n.connected]
    return {"nid": rng.choice(down)} if down else None


@action("hill_return", pick=_pick_hill_return)
async def hill_return(world: World, nid: str) -> None:
    """The hill comes back into Wi-Fi: it says hello again, MC re-arms it, and its next beat carries its clock."""
    node = await _utility(world, nid)
    body = _station_body(world, nid)
    if body is not None:
        node.extra_status.update(body)
        node.send_status()
    # MC counts no beat within one heartbeat of the re-arming hello (`_keep_tally`); the hill beats on, so wait for the
    # first one it counts. A restart inside that window shows the hill's owner blank until its next beat (cosmetic).
    await _hills_heard(world, [nid])


async def _hills_heard(world: World, nids: list[str]) -> None:
    """Wait (bounded) until MC's tally for each hill holds its truth. A real hill beats every second, and MC seeds no
    tally from a beat within one heartbeat (`STATUS_HEARTBEAT_MS`) of an arming, so this waits that out after a hello or a relock."""
    def heard() -> bool:
        for nid in nids:
            st = world.session.station_registry.stations.get(nid) or {}
            if world.session.now_ms() < ((st.get("armed") or {}).get("at") or 0) + STATUS_HEARTBEAT_MS + 100:
                return False
            if _hill_state(world)[nid] and _mc_hill(world, nid) != _hill_state(world)[nid]:
                return False
        return True
    await until(heard, 5.0)


def _pick_live_restart(world: World, rng: random.Random):
    return {} if world.session.phase == "live" else None


async def _restart_on_field_time(world: World, crash: bool) -> None:
    """An MC restart or crash at field time scales. A crash loses what MC heard since its last snapshot write, at
    most 2 s on a field where something changes every second (`_persist`'s throttle); these matches last seconds, so
    without the wait a crash would lose every reading of the match, which no field match can. A new MC then takes
    seconds to start, while each hill beats every second: the hills are heard again before anything else happens."""
    if crash:
        await asyncio.sleep(2.2)
        world.session.tick()   # a change past the throttle: the write a field MC makes every 2 s
    await world.restart_mc(crash=crash)
    await _hills_heard(world, [nid for nid in HILLS if (n := world.station_nodes.get(nid)) is not None and n.connected])


@action("hill_restart", pick=_pick_live_restart)
async def hill_restart(world: World) -> None:
    """MC stops cleanly mid-match and a new MC resumes it; the hills say hello again and beat on."""
    await _restart_on_field_time(world, crash=False)


@action("hill_crash", pick=_pick_live_restart)
async def hill_crash(world: World) -> None:
    """MC dies mid-match without a last write (a laptop lid, a power cut); a new MC resumes from the snapshot."""
    await _restart_on_field_time(world, crash=True)


def _pick_hill_end(world: World, rng: random.Random):
    return {} if world.session.phase in ("live", "armed") else None


@action("hill_end", pick=_pick_hill_end, terminal=True)
async def hill_end(world: World) -> None:
    """The operator presses END on a field whose hills beat every second. Before the whistle each hill in Wi-Fi has
    been heard; after it, a hill that was out of Wi-Fi walks back in and reports late (utility.md §5c), and every hill
    beats on, so its final count reaches the recap (`Session._late_station_report`)."""
    up = [nid for nid in HILLS if (n := world.station_nodes.get(nid)) is not None and n.connected]
    await _hills_heard(world, up)
    await world.settle()
    world.mark_end()
    world.session.control("end")
    await _after_whistle(world)


async def _after_whistle(world: World) -> None:
    """After the whistle each hill out of Wi-Fi walks back in and reports late, and every hill beats on."""
    for nid in HILLS:
        if (n := world.station_nodes.get(nid)) is not None and not n.connected:
            await hill_return(world, nid)
    await _hills_heard(world, [nid for nid in HILLS if nid in world.station_nodes])


def domination_hills_check(world: World) -> None:
    """The recap's Domination points are the hills' own owned clocks, summed per team, and the winner follows them."""
    sc = match_scorer(world.session)
    if sc is None or world.session.phase != "recap":
        return
    tid_team = {t["tid"]: team_id for team_id, t in sc.teams.items()}
    want_ms = {team_id: 0 for team_id in sc.teams}
    for own in _hill_state(world).values():
        for tid, ms in own.items():
            if tid in tid_team:
                want_ms[tid_team[tid]] += ms
    want = {k: round(v / 1000) for k, v in want_ms.items()}
    recap = world.session.last_recap or {}
    got = ((recap.get("possession") or {}).get("by_team")) or {k: 0 for k in want}
    if {k: got.get(k, 0) for k in want} != want:
        raise InvariantError("domination_points", f"the hills banked {want} points (ms {want_ms}); the recap says {got}")
    target = (world.session.config.get("scoring") or {}).get("hold_target_s")
    # Codex pass 2026-11-07: `want_ms` is already ms (this was `v * 1000`, which passed a finish at 1 point of 4), and the
    # check runs before the no-points return, so a target end with nothing banked fails too
    if world.session.end_reason == "hold_target" and target and not any(v >= target * 1000 for v in want_ms.values()):
        raise InvariantError("domination_points", f"MC ended on the {target}-point target; the hills banked only {want_ms} ms")
    held = {k: v for k, v in want.items() if v > 0}
    if not held:
        return
    winner = recap.get("winner") or {}
    reached = {k: v for k, v in want_ms.items() if target and v >= target * 1000}
    if reached:
        # past the target, raw ms decide, even when the totals round alike (scoring.py `winner()`)
        best = max(reached.values())
        tops = sorted(k for k, v in reached.items() if v == best)
        want_w = {"team_id": tops[0]} if len(tops) == 1 else {"team_id": None, "tie": tops}
        if {k: winner.get(k) for k in want_w} != want_w:
            raise InvariantError("domination_points", f"over the {target} target the hills say {want_w} ({want_ms} ms); MC's winner is {winner}")
        return
    top = max(held.values())
    lead = sorted(k for k, v in held.items() if v == top)
    if len(lead) == 1 and winner.get("team_id") != lead[0]:
        raise InvariantError("domination_points", f"the hills say {lead[0]} won {held}; MC's winner is {winner}")
    if len(lead) > 1 and sorted(winner.get("tie") or []) != lead:
        raise InvariantError("domination_points", f"the hills say a tie {lead} {held}; MC's winner is {winner}")


HILL_MIX = {
    "hit": 4, "kill": 4, "respawn": 4, "drop": 1, "reconnect": 1.5, "duplicate": 1, "reorder": 0.5,
    "hill_restart": 0.8, "hill_crash": 0.8, "hill_bank": 8, "hill_drop": 1, "hill_return": 1.5,
}

scenario(Scenario(
    name="domination-hills-target", mode="domination", nodes=6, steps=40, finish="hill_end", real_stations=True,
    config={"scoring": {"hold_target_s": 4}},
    doc="domination-hills with a target the hills can reach (4 points): MC ends on it, the team that crossed it wins "
        "even when both round to it, and a hill out of Wi-Fi at the whistle reports its count late.",
    setup_script=SETUP, weights=HILL_MIX, checks=(domination_hills_check,), ci_seeds=(3,),
))

scenario(Scenario(
    name="domination-hills", mode="domination", nodes=6, steps=40, finish="hill_end", real_stations=True,
    doc="Domination scored from three real hill stations' owned clocks, through kills, node drops, hill drops and "
        "returns, MC restarts and MC crashes: the recap's points per team are the hills' own clocks, summed.",
    setup_script=SETUP, weights=HILL_MIX, checks=(domination_hills_check,), ci_seeds=(2,),
))

# The field's order of trouble, scripted: two hills bank, MC restarts mid-match, hill B walks out of Wi-Fi while
# A and C bank on, B comes back, MC crashes, and every hill banks again before the operator's END.
_SCRIPT = [
    {"name": "hill_bank", "params": {"nid": "dom-hill-a", "tid": 0, "share": 0.5}},
    {"name": "hill_bank", "params": {"nid": "dom-hill-b", "tid": 1, "share": 1.0}},
    {"name": "hill_restart", "params": {}},
    {"name": "hill_bank", "params": {"nid": "dom-hill-a", "tid": 0, "share": 1.0}},
    {"name": "hill_drop", "params": {"nid": "dom-hill-b"}},
    {"name": "hill_bank", "params": {"nid": "dom-hill-c", "tid": 1, "share": 1.0}},
    {"name": "hill_return", "params": {"nid": "dom-hill-b"}},
    {"name": "hill_bank", "params": {"nid": "dom-hill-b", "tid": 1, "share": 0.5}},
    {"name": "hill_crash", "params": {}},
    {"name": "hill_bank", "params": {"nid": "dom-hill-a", "tid": 0, "share": 1.0}},
    {"name": "hill_bank", "params": {"nid": "dom-hill-c", "tid": 0, "share": 1.0}},
    {"name": "hill_end", "params": {}},
]

scenario(Scenario(
    name="domination-hills-restart", mode="domination", nodes=4, real_stations=True,
    doc="Three hill stations: an MC restart mid-match, a hill out of Wi-Fi and back, then an MC crash. The recap "
        "keeps every point each hill banked: none lost, none counted twice.",
    setup_script=SETUP, script=_SCRIPT, checks=(domination_hills_check,), ci_seeds=(1,),
))
