"""A56 / S58 powerup items: MC's default constants and the Halo spawn schedule (docs/spec/powerups.md).

Powerups (Rockets, Rail Gun, Overshield) are ON by default (F372, Tony 2026-09-25: "rockets, railgun,
overshield as powerup/pickups. yes lets enable them"). `--no-powerups` turns everything here inert
(`Session.powerups_enabled = False`); the bench steps in powerups.md "Bench gate" stay open as
verification, not as a condition for the default.

The named constants below are the ONE place a default lives. The player phone mirrors the rules it
enforces on its own (`LOST_AT_DEATH`, `WEAPON_PICKUP_SWAPS`, the overshield's decay and regen); they are not
carried on the wire item, so a change here must be made in `app/src` too (docs/spec/powerups.md, "Items and defaults").
"""
from __future__ import annotations

from typing import Iterable, Protocol

from .types import PowerupPreset, PowerupSlot, PowerupsView, StationItem

# The schedule (Tony, 2026-09-24: "like Halo"): first spawn after one interval, then every interval.
HEAVY_SPAWN_EVERY_S = 120
OVERSHIELD_SPAWN_EVERY_S = 60
OVERSHIELD_AMOUNT = 75            # shield on top of whatever the player has; hit first, gone at death
OVERSHIELD_DECAY_PER_S = 0        # it does not bleed away over time
OVERSHIELD_REGEN = False          # nothing refills it

# Defaults still to confirm with Tony (named so they are easy to change). The phone enforces both.
LOST_AT_DEATH = True              # a weapon item's unused charges do not carry into the next life
WEAPON_PICKUP_SWAPS = True        # weapon pickups share ONE holding: a second weapon replaces the first (Tony,
                                  # 2026-09-24); an overshield stacks alongside a weapon

PICKUP_SLOTS = (2, 3)             # the spare gun slots a pickup weapon is armed into, in this order
MAX_WEAPON_ITEMS = len(PICKUP_SLOTS)
NAME_MAX = 12                     # a Stick may marquee the name

# The presets the host picks from (the ITEMS panel). `charges` is filled from the weapon catalogue at
# expansion time: the weapon's own compiled magazine, never a literal here.
_PRESETS: dict[str, dict] = {
    "rockets": {"kind": "weapon", "weapon_id": "rocket_launcher", "name": "ROCKETS", "color": "#ff7a1a",
                "spawn_every_s": HEAVY_SPAWN_EVERY_S, "first_at_s": HEAVY_SPAWN_EVERY_S},
    "rail_gun": {"kind": "weapon", "weapon_id": "rail_gun", "name": "RAIL GUN", "color": "#22d3ee",
                 "spawn_every_s": HEAVY_SPAWN_EVERY_S, "first_at_s": HEAVY_SPAWN_EVERY_S},
    "overshield": {"kind": "overshield", "amount": OVERSHIELD_AMOUNT, "name": "OVERSHIELD", "color": "#b36bff",
                   "spawn_every_s": OVERSHIELD_SPAWN_EVERY_S, "first_at_s": OVERSHIELD_SPAWN_EVERY_S},
}
PRESET_IDS = tuple(_PRESETS)

REFUSED_FLAG_OFF = ("powerups are OFF: Mission Control was started with --no-powerups. Drop that flag "
                    "(or restart with ./start.sh, no flag needed) to give a station an item")


class _Magazines(Protocol):
    def spawn_ammo(self, weapon_id: str, mods: dict | None = None) -> tuple[int, int]: ...


def _catalog(catalog: _Magazines | None) -> _Magazines:
    if catalog is not None:
        return catalog
    from .compile import WeaponCatalog
    return WeaponCatalog()


def expand(preset: str, catalog: _Magazines | None = None) -> StationItem:
    """One preset as the full `StationItem` MC stores on the assignment. Raises ValueError on an unknown id."""
    row = _PRESETS.get(preset) if isinstance(preset, str) else None
    if row is None:
        raise ValueError(f"item_preset must be one of: {', '.join(PRESET_IDS)}")
    item: dict = dict(row)
    if item["kind"] == "weapon":
        item["charges"] = int(_catalog(catalog).spawn_ammo(item["weapon_id"])[0])
    return item   # type: ignore[return-value]


def presets_view(enabled: bool, catalog: _Magazines | None = None) -> PowerupsView:
    """`GET /api/powerups`."""
    cat = _catalog(catalog)
    rows: list[PowerupPreset] = [{"preset": p, "item": expand(p, cat)} for p in PRESET_IDS]
    return {"enabled": bool(enabled), "presets": rows}


def weapon_slots(items: Iterable[StationItem]) -> list[PowerupSlot]:
    """The pickup weapons to arm and where: each DISTINCT weapon, in the order given, into slot 2 then 3.
    Two stations with the same weapon share its slot. Raises when a third distinct weapon is asked for."""
    out: list[PowerupSlot] = []
    for item in items:
        if item.get("kind") != "weapon":
            continue
        wid = item.get("weapon_id")
        if not isinstance(wid, str) or any(r["weapon_id"] == wid for r in out):
            continue
        if len(out) >= MAX_WEAPON_ITEMS:
            raise ValueError(f"at most {MAX_WEAPON_ITEMS} different weapon items per game (spare slots "
                             f"{' and '.join(map(str, PICKUP_SLOTS))}); {wid!r} would be the third")
        out.append({"weapon_id": wid, "slot": PICKUP_SLOTS[len(out)]})
    return out


def invalid_reason(item: object) -> str | None:
    """Why a stored item cannot be scheduled, or None when it can. F331: an item restored from a session
    snapshot never passed `expand`; `spawn_every_s: 0` would hang the schedule's catch-up loop and a missing
    key raises on every tick."""
    if not isinstance(item, dict):
        return "not an object"
    if item.get("kind") not in ("weapon", "overshield"):
        return f"kind {item.get('kind')!r}"
    for key in ("spawn_every_s", "first_at_s"):
        v = item.get(key)
        if not isinstance(v, int) or isinstance(v, bool) or not (1 if key == "spawn_every_s" else 0) <= v <= 255:
            return f"{key} {v!r} (an integer, 1-255)" if key == "spawn_every_s" else f"{key} {v!r} (an integer, 0-255)"
    if not isinstance(item.get("name"), str) or not isinstance(item.get("color"), str):
        return "name or color missing"
    if item["kind"] == "weapon" and (not isinstance(item.get("weapon_id"), str) or not isinstance(item.get("charges"), int)):
        return "weapon_id or charges missing"
    if item["kind"] == "overshield" and not isinstance(item.get("amount"), int):
        return "amount missing"
    return None


# ---------------------------------------------------------------------- the schedule (match clock, ms)
def spawn_at(item: StationItem, go_live_t: int, k: int) -> int:
    """The k-th spawn time (k = 0 is the first)."""
    return go_live_t + (int(item["first_at_s"]) + k * int(item["spawn_every_s"])) * 1000


def last_spawn_index(item: StationItem, go_live_t: int, t: int) -> int:
    """The index of the latest spawn at or before `t`, or -1 when none has happened yet."""
    first = spawn_at(item, go_live_t, 0)
    if t < first:
        return -1
    return (t - first) // (int(item["spawn_every_s"]) * 1000)


def next_spawn_after(item: StationItem, go_live_t: int, t: int) -> int:
    """The first spawn time strictly after `t`."""
    return spawn_at(item, go_live_t, last_spawn_index(item, go_live_t, t) + 1)
