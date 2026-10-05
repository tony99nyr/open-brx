"""Chaos actions for utility stations and powerup pickups."""
from __future__ import annotations

import copy
import random
import time

from ..mc import envelope as E
from ..mc import powerups as _pu
from ..mc.mock_node import MockNode
from ..mc.types import StationAssignment
from .registry import InvariantError, action
from .stack import until
from .world import ChaosNode, World

# The least time between an item appearing and a phone's pickup of it (the station's advert must reach it).
_ADVERT_MS = 100


def _never(world: World, rng: random.Random):
    return None


def _assigned(world: World, kind: str | None = None) -> list[str]:
    return [nid for nid, assignment in world.session.station_registry.assignments()
            if kind is None or assignment.get("kind") == kind]


def _pick_assign_control(world: World, rng: random.Random):
    nid = f"utility-hill-{world.step}"
    return {"nid": nid} if world.session.phase not in ("armed", "live") else None


@action("station_assign_control", pick=_pick_assign_control)
async def station_assign_control(world: World, nid: str) -> None:
    """Connect a utility node and assign it as a neutral control point."""
    await _utility(world, nid)
    request = {"kind": "control", "team": "any"}
    world.session.set_station(nid, dict(request))
    _remember_assignment(world, nid, request)


def _pick_assign_respawn(world: World, rng: random.Random):
    nid = f"utility-respawn-{world.step}"
    return {"nid": nid} if world.session.phase not in ("armed", "live") else None


@action("station_assign_respawn", pick=_pick_assign_respawn)
async def station_assign_respawn(world: World, nid: str) -> None:
    """Connect a utility node and assign it as a team neutral respawn point."""
    await _utility(world, nid)
    request = {"kind": "respawn", "team": "any"}
    world.session.set_station(nid, dict(request))
    _remember_assignment(world, nid, request)


def _pick_assign_powerup(world: World, rng: random.Random):
    nid = f"utility-powerup-{world.step}"
    preset = rng.choice(("rockets", "rail_gun", "overshield"))
    return {"nid": nid, "preset": preset} if world.session.phase not in ("armed", "live") else None


@action("station_assign_powerup", pick=_pick_assign_powerup)
async def station_assign_powerup(world: World, nid: str, preset: str) -> None:
    """Connect a utility node and assign one supported powerup preset."""
    await _utility(world, nid)
    request = {"kind": "powerup", "team": "any", "item_preset": preset}
    world.session.set_station(nid, dict(request))
    _remember_assignment(world, nid, request)


def _remember_id(world: World, nid: str) -> None:
    assignment = world.session.station_registry.assignment(nid)
    if assignment:
        world.station_ids[nid] = str(assignment["id"])


# The fields RESTORE must bring back as they were: kind, team, item and range (threshold, tx_power).
_RESTORED_FIELDS = ("kind", "team", "threshold", "tx_power", "item")


def _remember_assignment(world: World, nid: str, request: dict) -> None:
    """Record the station as the operator assigned it: the request, and the assignment MC made of it then."""
    assignment = world.session.station_registry.assignment(nid)
    if not assignment or assignment.get("kind") != request["kind"] or (
            request.get("item_preset") and _pu.preset_of(assignment.get("item")) != request["item_preset"]):
        raise InvariantError("station_restore_matches_assignment",
                             f"{nid}: the operator assigned {request}; MC holds {assignment}")
    world.station_assigned[nid] = {"request": dict(request),
                                   "assignment": {k: copy.deepcopy(assignment.get(k)) for k in _RESTORED_FIELDS}}
    _remember_id(world, nid)


def _record_departure(world: World, nid: str) -> None:
    """Record the ONE departure MC holds for this node, numbered, with the assignment the world saw before it."""
    rows = [d for d in world.session._station_departures_view() if d["node_id"] == nid]
    if len(rows) != 1:
        raise RuntimeError(f"MC holds {len(rows)} departures for {nid}, not one")
    departure = rows[0]
    old_id = int(departure["id"])
    world.station_ids.pop(nid, None)
    world.station_restores.append({
        "dep": len(world.station_restores),
        "node_id": nid,
        "restore": dict(departure["restore"]),
        "before": copy.deepcopy(world.station_assigned.get(nid)),
        "old_id": old_id,
        "restored_id": None,
        "old_id_was_free": str(old_id) not in world.station_ids.values(),
    })


async def _utility(world: World, nid: str) -> MockNode:
    node = world.station_nodes.get(nid)
    if node is not None and node.connected:
        return node
    assert world.stack is not None
    if node is None:
        node = next((n for n in world.stack.nodes
                     if n.node_id == nid and n.node_type == "utility"), None)
    if node is not None:
        node.reconnect()
        if not await until(lambda: node.connected, timeout=3.0):
            raise RuntimeError(f"utility {nid} did not reconnect")
        world.station_nodes[nid] = node
        return node
    node = await world.stack.connect_node("", node_id=nid, node_type="utility", gun_echo=None)
    world.station_nodes[nid] = node
    return node


def _pick_release(world: World, rng: random.Random):
    # The operator releases a station whose phone is online: MC can only release a phone it can reach.
    rows = [nid for nid in _assigned(world) if (n := world.station_nodes.get(nid)) is not None and n.connected]
    return {"nid": rng.choice(rows)} if rows else None


@action("station_release", pick=_pick_release)
async def station_release(world: World, nid: str) -> None:
    """Ask an online utility phone to return to its HUD role. MC must take it and drop the assignment."""
    if not world.session.release_station(nid):
        raise InvariantError("station_release_clears", f"MC refused to release online station {nid}")
    if world.session.station_registry.assignment(nid):
        raise InvariantError("station_release_clears", f"{nid} is still assigned after an accepted release")
    _record_departure(world, nid)


def _pick_depart(world: World, rng: random.Random):
    rows = [nid for nid in _assigned(world) if nid in world.station_nodes]
    return {"nid": rng.choice(rows)} if rows else None


@action("station_depart", pick=_pick_depart)
async def station_depart(world: World, nid: str) -> None:
    """Use the authenticated utility-to-HUD hello handoff."""
    assert world.stack is not None
    utility = world.station_nodes.get(nid)
    if utility is None:
        return
    # The real app closes its utility socket before opening the HUD identity.
    await utility.disconnect()
    hud = await world.stack.connect_node(
        "", node_id=f"hud-{nid}-{world.step}", gun_echo=None,
        prior_utility={"node_id": nid, "node_key": utility.node_key or ""})
    if not hud.prior_utility_consumed:
        raise RuntimeError(f"HUD hello did not consume {nid}'s utility proof")
    if not await until(lambda: nid in world.session._station_departures, timeout=3.0):
        raise RuntimeError(f"utility handoff did not record station departure for {nid}")
    _record_departure(world, nid)
    world.station_nodes.pop(nid, None)
    # The handoff proof has been checked. This unbound HUD has no player to drive.
    await hud.close()


def _pick_restore(world: World, rng: random.Random):
    # Only the newest departure of a node is still in MC (one record per node); an older one was superseded.
    newest = {r["node_id"]: r for r in world.station_restores}
    pending = [r for r in newest.values() if r.get("restored_id") is None
               and r["node_id"] in world.session._station_departures]
    if world.session.phase in ("armed", "live") or not pending:
        return None
    row = rng.choice(pending)
    return {"nid": row["node_id"], "dep": row["dep"]}


@action("station_restore", pick=_pick_restore)
async def station_restore(world: World, nid: str, dep: int) -> None:
    """Return the same utility node and reapply departure `dep` (as the trace names it) through set_station.
    The restored kind, team, item and range must equal what the world recorded before the departure."""
    row = world.station_restores[dep] if 0 <= dep < len(world.station_restores) else None
    if row is None or row["node_id"] != nid:
        raise RuntimeError(f"departure {dep} is not a recorded departure of {nid}")
    if nid not in world.session._station_departures:
        raise RuntimeError(f"MC lost {nid}'s departure before RESTORE")
    await _utility(world, nid)
    result = world.session.set_station(nid, dict(row["restore"]))
    assigned = result["assigned"]
    if assigned is None:
        raise RuntimeError(f"set_station left {nid} with no assignment on RESTORE")
    restored_id = int(assigned["id"])
    row["restored_id"] = restored_id
    before = row["before"]
    after = world.session.station_registry.assignment(nid) or {}
    if before is not None:
        diff = {k: (before["assignment"].get(k), after.get(k)) for k in _RESTORED_FIELDS
                if before["assignment"].get(k) != after.get(k)}
        if diff:
            raise InvariantError("station_restore_matches_assignment",
                                 f"RESTORE of {nid} changed {{field: (before, after)}} {diff}")
        world.station_assigned[nid] = copy.deepcopy(before)
    _remember_id(world, nid)


def _pick_dismiss(world: World, rng: random.Random):
    rows = list(world.session._station_departures)
    return {"nid": rng.choice(rows)} if rows else None


@action("station_dismiss", pick=_pick_dismiss)
async def station_dismiss(world: World, nid: str) -> None:
    """Dismiss a recorded station departure."""
    world.session.dismiss_departure(nid)


def _powerup_rows(world: World) -> list[tuple[str, dict]]:
    rows = []
    for nid in _assigned(world, "powerup"):
        assignment = world.session.station_registry.assignment(nid)
        view = world.session.station_registry.station_view(nid)
        if assignment and assignment.get("item") and view.get("item_available") is True:
            rows.append((nid, assignment))
    return rows


def _pick_powerup_reset(world: World, rng: random.Random):
    if world.session.phase not in ("armed", "live") or not _assigned(world, "powerup"):
        return None
    rows = [nid for nid in _assigned(world, "powerup")
            if (world.session.station_registry.assignment(nid) or {}).get("item")]
    return {"nid": rng.choice(rows)} if rows else None


@action("powerup_reset", pick=_pick_powerup_reset)
async def powerup_reset(world: World, nid: str) -> None:
    """Reset an assigned powerup station through the real Session API."""
    world.session.reset_station(nid)


def _pick_powerup_claim(world: World, rng: random.Random):
    rows = _powerup_rows(world)
    alive = world.alive_nodes()
    if not rows or not alive or world.session.phase != "live":
        return None
    nid, assignment = rng.choice(rows)
    player = rng.choice(alive)
    return {"node": player.index, "nid": nid}


def _num_of(world: World, node: int) -> int:
    return int(world.players[node]["player_num"])


def _display_of(world: World, num: int) -> str:
    return next(f"P{i:02d}" for i, p in enumerate(world.players) if int(p["player_num"]) == num)


def _feed_ids(world: World) -> set:
    return {e.get("id") for e in world.session.feed}


def _expect(world: World, nid: str, num: int, by_station: bool, feed_before: set) -> None:
    """Record a take the world KNOWS is real (sent after the item appeared) for `pickup_credited`."""
    world.pickup_expectations.append({"nid": nid, "num": num, "by_station": by_station, "feed_before": feed_before,
                                      "station_id": int(world.session.station_registry.required_assignment(nid)["id"]),
                                      "display": _display_of(world, num), "step": world.step, "judged": False})


def _item_kind(assignment: StationAssignment) -> str:
    item = assignment.get("item")
    if item is None:
        raise RuntimeError(f"station {assignment['id']} has no item to pick up")
    return str(item["kind"])


async def _phone_pickup(world: World, node: int, nid: str) -> None:
    assignment = world.session.station_registry.assignment(nid)
    assert assignment is not None
    station_id = int(assignment["id"])
    item_kind = _item_kind(assignment)
    # A phone stamps `pickup.t` on its own synced clock, which can trail MC's by a few ms after a restart's
    # re-sync. A real pickup comes after the phone hears the station advertise the item, so it is never in
    # the same ms as the spawn or reset. Model that: wait until the player's own clock is past the item's
    # `since` plus a small advert delay. `pickup-clock-skew` covers a clock that trails by more (F473).
    since = int(world.session._pu_sched["st"][nid]["since"])
    player = world.nodes[node]
    await until(lambda: player.synced_now() > since + _ADVERT_MS, 2.0)
    player.emit({"type": "pickup", "station_id": station_id, "item_kind": item_kind})
    await world.settle()


async def _station_report(world: World, nid: str, player_num: int) -> None:
    node = world.station_nodes[nid]
    assert isinstance(node, ChaosNode)   # `World` sets `stack.node_cls = ChaosNode`
    station_id = int(world.session.station_registry.required_assignment(nid)["id"])
    node.send_env(E.make_envelope("station_action", {
        "id": station_id, "action": "taken", "player_num": player_num, "age_ms": 0,
    }))
    await until(lambda: world.session._pu_sched["st"][nid].get("by_station") is True, 2.0)


@action("powerup_claim", pick=_pick_powerup_claim)
async def powerup_claim(world: World, node: int, nid: str) -> None:
    """Emit the player's persisted pickup fact for an available station item. That player takes it."""
    before = _feed_ids(world)
    await _phone_pickup(world, node, nid)
    _expect(world, nid, _num_of(world, node), False, before)


def _pick_powerup_station_take(world: World, rng: random.Random):
    rows = _powerup_rows(world)
    rows = [(nid, a) for nid, a in rows if nid in world.station_nodes]
    if not rows or world.session.phase != "live":
        return None
    nid, assignment = rng.choice(rows)
    player = rng.choice(world.players)
    return {"nid": nid, "player_num": int(player["player_num"])}


@action("powerup_station_take", pick=_pick_powerup_station_take)
async def powerup_station_take(world: World, nid: str, player_num: int) -> None:
    """Send the supported station_action taken message over the utility socket. That player takes it."""
    if nid not in world.station_nodes:
        return
    before = _feed_ids(world)
    await _station_report(world, nid, player_num)
    _expect(world, nid, player_num, True, before)


def _pick_powerup_conflict(world: World, rng: random.Random):
    rows = [(nid, a) for nid, a in _powerup_rows(world) if nid in world.station_nodes]
    alive = world.alive_nodes()
    if not rows or not alive or world.session.phase != "live" or len(world.players) < 2:
        return None
    nid, _a = rng.choice(rows)
    claimant = rng.choice(alive).index
    other = rng.choice([int(p["player_num"]) for i, p in enumerate(world.players) if i != claimant])
    return {"node": claimant, "nid": nid, "player_num": other}


@action("powerup_conflict", pick=_pick_powerup_conflict)
async def powerup_conflict(world: World, node: int, nid: str, player_num: int) -> None:
    """F454 precedence: a phone claims the item, then the STATION reports a different taker, then the first phone
    claims again. The station decides: its player takes it, on the one TOOK line, and the later phone fact
    changes nothing."""
    if nid not in world.station_nodes:
        return
    before = _feed_ids(world)
    await _phone_pickup(world, node, nid)
    await _station_report(world, nid, player_num)
    world.nodes[node].emit({"type": "pickup", "station_id": int(world.session.station_registry.required_assignment(nid)["id"]),
                            "item_kind": _item_kind(world.session.station_registry.required_assignment(nid))})
    await world.settle()
    _expect(world, nid, player_num, True, before)


@action("powerup_skew_claim", pick=_never)
async def powerup_skew_claim(world: World, node: int, nid: str, skew_ms: int) -> None:
    """F473: the operator resets (respawns) the item, the phone hears its advert, then sends a real pickup
    stamped on a synced clock `skew_ms` off MC's (negative = the phone trails). The take is real: it is after
    the respawn on MC's own clock, so it must be credited whatever the phone's small clock error."""
    assert world.stack is not None
    stack = world.stack
    world.session.reset_station(nid)
    respawn_t = stack.mc_now()
    await until(lambda: stack.mc_now() >= respawn_t + _ADVERT_MS, 2.0)
    player = world.nodes[node]
    assignment = world.session.station_registry.required_assignment(nid)
    synced = player.offset_ms
    before = _feed_ids(world)
    player.offset_ms = stack.mc_now() - time.time() * 1000 + skew_ms
    try:
        player.emit({"type": "pickup", "station_id": int(assignment["id"]), "item_kind": _item_kind(assignment)})
    finally:
        player.offset_ms = synced
    await world.settle()
    _expect(world, nid, _num_of(world, node), False, before)
