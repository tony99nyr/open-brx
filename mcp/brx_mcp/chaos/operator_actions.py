"""Operator actions at the PLAY, KIT and archive seams."""
from __future__ import annotations

import copy
import random

from .registry import action
from .stack import push_when_ready, until
from .world import World


def _never(world: World, rng: random.Random):
    return None


def _pick_play(world: World, rng: random.Random):
    if world.session.phase not in ("muster", "build", "kit", "lobby") or world.session.config["mode"] != "koth":
        return None
    return {"match": {"hold_target_s": rng.choice((60, 120, 180, 240))}}


def _pick_favourite_save(world: World, rng: random.Random):
    if world.session.phase not in ("muster", "build", "kit", "lobby"):
        return None
    return {"slot": f"seed-{world.step}", "name": f"Chaos seed {world.step}"}


def _pick_favourite_load(world: World, rng: random.Random):
    if world.session.phase not in ("muster", "build", "kit", "lobby") or not world.favourite_ids:
        return None
    return {"slot": rng.choice(sorted(world.favourite_ids))}


async def _request(world: World, method: str, path: str, body: dict | None = None) -> dict:
    # ASGITransport drives the same route as the console without binding another socket.
    import httpx
    from ..mc.api import create_app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app(world.session)),
                                 base_url="http://chaos") as client:
        response = await client.request(method, path, json=body)
    data = response.json()
    if response.status_code >= 400 or (isinstance(data, dict) and data.get("ok") is False):
        raise AssertionError(f"{method} {path} failed: {response.status_code} {data}")
    return data


@action("field_join", pick=_never)
async def field_join(world: World) -> None:
    """Join the player's real MockNodes after a MUSTER operator action."""
    await world.join_field()


@action("operator_phase", pick=_never)
async def operator_phase(world: World, *, phase: str) -> None:
    """Move the operator to a pre-match screen through the Session phase API."""
    world.session.set_phase(phase, force=True)


@action("lobby_push", pick=_never)
async def lobby_push(world: World) -> None:
    """Push the kit and reach LOBBY before an MC restart (waiting for the re-synced clocks, as an operator would)."""
    await push_when_ready(world.session)
    if not await until(world.session.all_acked, 6.0):
        raise AssertionError("field did not ack the LOBBY push")


def _declared_mode_params(mode: str, gameplay_id: str) -> dict:
    """games-presets.md §1 rule 5: the mode's DECLARED defaults (the engine's `PARAMS`, contracts A18) merged
    with the gameplay piece's declared value (the shipped builtin catalogue). Never MC's runtime config."""
    from ..mc.pieces import _builtin_pieces
    from ..modes.objectives import DominationEngine
    from ..modes.params import defaults_of, schema_of
    engines = {"koth": DominationEngine}              # tdm and ffa declare no parameters
    piece = next((p for p in _builtin_pieces() if p["piece_id"] == gameplay_id), None)
    if piece is None:
        raise ValueError(f"no declared gameplay piece {gameplay_id!r}")
    defaults = defaults_of(schema_of(engines[mode])) if mode in engines else {}
    return {**defaults, **(piece["value"].get("mode_params") or {})}


@action("play_pick", pick=_pick_play)
async def play_pick(world: World, *, pieces: dict | None = None, match: dict | None = None) -> None:
    """POST a PLAY pick through the same API route the console uses. The oracle is the REQUEST: what the
    operator asked for is recorded here, before MC answers."""
    await _request(world, "POST", "/api/play/pick", {"pieces": pieces or {}, "match": match or {}})
    world.requested_match.update(copy.deepcopy(match or {}))
    if match and "hold_target_s" in match:
        world.expected_hold_target_s = match["hold_target_s"]
        world.hold_target_recorded = True
    if pieces and "gameplay" in pieces:
        mode = (pieces.get("mode") or f"builtin:mode:{world.scenario.mode}").rsplit(":", 1)[-1]
        world.expected_mode_params = _declared_mode_params(mode, pieces["gameplay"])


@action("kit_mode_params", pick=_never)
async def kit_mode_params(world: World, *, params: dict) -> None:
    """Apply a KIT edit before picking STANDARD gameplay."""
    res = world.session.set_config({"mode_params": params})
    if not res["ok"]:
        raise AssertionError(f"KIT edit failed: {res['errors']}")
    for key, value in params.items():
        if (world.session.config.get("mode_params") or {}).get(key) != value:
            raise AssertionError(f"KIT edit lost {key}={value!r}")


@action("favourite_save", pick=_pick_favourite_save)
async def favourite_save(world: World, *, slot: str, name: str = "Chaos favourite") -> None:
    """Save the current PLAY pick through the FAVOURITES API."""
    # The console always sends its runway as `countdown_s` (Games.tsx); the store refuses one outside 5-900 s.
    data = await _request(world, "POST", "/api/favourites",
                          {"name": name, "countdown_s": 10, "pick": world.session.game_pick})
    world.favourite_ids[slot] = data["favourite_id"]
    # The intent is what the operator last REQUESTED, not MC's game_pick (the console sends that pick, so a
    # corrupted one is saved, loaded back and caught against this record).
    world.favourite_intents[slot] = ({"hold_target_s": world.expected_hold_target_s}
                                     if world.hold_target_recorded else {})


@action("favourite_load", pick=_pick_favourite_load)
async def favourite_load(world: World, *, slot: str) -> None:
    """Load a saved FAVOURITE through the console's route."""
    fid = world.favourite_ids[slot]
    await _request(world, "POST", f"/api/favourites/{fid}/load", {})
    intent = world.favourite_intents[slot]
    if "hold_target_s" in intent:
        world.expected_hold_target_s = intent["hold_target_s"]
        world.hold_target_recorded = True
    world.requested_match.update(copy.deepcopy(intent))


@action("armory_fault", pick=_never)
async def armory_fault(world: World, *, kind: str) -> None:
    """Corrupt or remove the per-run real-shape armory before an MC restart."""
    if not world.scenario.real_armory or world.stack is None:
        raise AssertionError("armory_fault needs real_armory")
    if kind == "corrupt":
        world.stack.armory_path.write_text("{bad json")
    elif kind == "missing":
        world.stack.armory_path.unlink(missing_ok=True)
    else:
        raise ValueError(kind)


@action("archive_fail_start", pick=_never)
async def archive_fail_start(world: World) -> None:
    """Make O7 fail both initial and END archive row creation for this run."""
    store = world.session.store
    assert store is not None
    world.archive_original_start = store.match_started

    def fail(*args, **kw):
        raise OSError("chaos archive fault")
    store.match_started = fail


@action("archive_late_retired", pick=_never)
async def archive_late_retired(world: World, *, node: int) -> None:
    """Roll to a new mode, then flush a dropped death into the retired scorer."""
    s = world.session
    assert s.store is not None and s.last_recap is not None and world.match_id is not None
    retired = world.match_id
    assert world.archive_original_start is not None, "archive_fail_start did not run first"
    s.store.match_started = world.archive_original_start
    s.next_match()
    result = s.set_config({"mode": "ffa"})
    if not result["ok"]:
        raise AssertionError(f"next match config failed: {result['errors']}")
    world.nodes[node].reconnect()
    if not await world.settle():
        raise AssertionError("retired match's late fact did not settle")
    # From here the archive row, its recap and the retired scorer must all answer to the Ledger
    # (`retired_recap_matches_ledger`, `archive_row_matches_match_config`).
    world.retired_flushed = retired
