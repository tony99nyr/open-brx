"""The grenade-hill bridge: protocol-15 `$HIR` beacons → objective state (F70/F82/F85).

A Smart Grenade in hill (or respawn-station) mode transmits an IR word every **5.0 s**. A gun armed
with `$SIR,15,0,,28,0,0,1,,*` registers it with zero player feedback (F73) and reports it over BLE as

    $HIR,<sensor>,15,0,<owner_team>,<mode>,0,0

`DominationEngine` was written against a `$CAPTURE <site> <team>` event that only a *station* device
produces. Nothing translated the grenade's beacons into it, so King of the Hill could not be played
off the hardware primitive that already exists. This module is that translation, and nothing else:
pure state, no I/O, no Actions — a mode engine, the MC server and a unit test all drive it the same
way.

**Every field meaning below is bench-measured, not inferred** (`docs/experiment-log/2026-09.md`,
2026-09-10 evening entries):

* **`<mode>` is the MODE, never a charge level: 8 = hill, 6 = respawn station.** Same protocol, same
  `$SIR` cell, different device role — a respawn station must never move a hill's ownership.
* **Team 2 is NEUTRAL** — nobody owns the point. Hence 🔴 **F82: never roster a player on team 2 in a
  hill mode.** They would read every neutral point as their own, go deaf to it under an enemy-only
  `$SIR` row, and take no hill damage. `owner` deliberately reports neutral as `None` rather than 2,
  so a scorer handed the wire value cannot accrue possession for a team that does not exist.
* **A capture emits `mag=50` carrying the NEW owner**, ~50 ms after the shot that took it.
* **`mag=53` fires only when the point was previously NEUTRAL** (n=2: one neutral→blue capture had
  it, two enemy-to-enemy captures did not), and it arrives **~5 s later on the next beacon cycle** —
  not in the same burst. So a capture is announced on **`mag=50` alone**; a node that waited for both
  words would never announce an enemy-to-enemy capture at all. `mag=53` is a late *confirmation* of
  what was left behind. ⚠ Its team field carries the state LEFT (2, neutral) — adopting that as the
  new owner would flip the point straight back to neutral one beacon after every capture.
* **One transmission can arrive as TWO `$HIR`** on different sensors ~14 ms apart (F85), and a gun
  reports both. Dedupe on **identity** (owner + magnitude), never on time alone: a real capture puts
  `mag=53` and `mag=8` on the wire in the same millisecond on different sensors, so a time-only
  window would swallow one of them.
* **Reception is intermittent at the edge of range** (rung R: long dropouts at ~30 ft). Presence
  expires after **≥ 2 missed beacons (~12 s)**, not one — a single miss is normal reception, not
  "left the hill". F84 is the mirror-image trap: any host constant *wider* than the 5 s period never
  expires at all, which is how `ATTRIB_FUSE_S` and `regen_delay_s` both broke earlier the same day.

**One grenade only.** The beacon's player field is 0 on every capture ever taken — there is no
station id on the wire — so nothing distinguishes two hills from each other. A reader tracks ONE
point's ownership. That is exactly King of the Hill; multi-point Domination still needs a station
source that identifies which point it is talking about.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .. import sounds as snd

# ---- wire constants (all bench-measured; see the module docstring) ---------- #
PROTOCOL = 15            # $HIR token 2 for a grenade/station beacon
NEUTRAL_TEAM = 2         # the firmware's "nobody owns this point"
MODE_HILL = 8            # magnitude 8 = hill
MODE_RESPAWN = 6         # magnitude 6 = respawn station — NOT a hill
CAPTURE_MAG = 50         # a capture: the team field is the NEW owner
FROM_NEUTRAL_MAG = 53    # only ever seen when the point was NEUTRAL before the capture

BEACON_PERIOD_S = 5.0                            # measured 5.0 s, no drift, zero misses at desk range
PRESENCE_GRACE_S = 2 * BEACON_PERIOD_S + 2.0     # ≥ 2 missed beacons (rung R), not one
DEDUPE_WINDOW_S = 0.1                            # one transmission, two sensors, ~14 ms apart (F85)
# How long after a `mag=50` a `mag=53` still counts as that capture's confirmation. The word arrives
# on the NEXT beacon cycle (~5 s), so one period is too tight to be safe and two is the same grace
# presence uses.
CONFIRM_WINDOW_S = 2 * BEACON_PERIOD_S

# Hill callouts, confirmed BY EAR 2026-09-10 (rung S). The `VB0*` set is one female objectives
# announcer covering every hill state and is Tony's own pick over the three male "Control Point"
# lines. ⚠ These two belong in `brx_mcp/sounds.py` beside `HILL_CAPTURED`; they live here only
# because that file is being edited in parallel by the hill-audio session. Move them when it lands.
HILL_CAPTURED = snd.HILL_CAPTURED    # "Hill Captured"  (VB0N, already catalogued)
HILL_CONTESTED = "VB0O"              # "Hill Contested"
HILL_LOST = "VB0P"                   # "Hill Lost!"


@dataclass(frozen=True)
class Proto15Frame:
    """A decoded protocol-15 `$HIR`. `team` is raw off the wire — 2 means neutral."""
    sensor: int
    player: int
    team: int
    magnitude: int


def parse(ev: dict) -> Optional[Proto15Frame]:
    """A parsed rx event → its protocol-15 beacon, or None if it is not one.

    Returns None for the hill's *other* word too: the ambient `proto=0 mag=8` damage shot that
    drains an intruder (F69) is an ordinary protocol-0 `$HIR`, and it must never move ownership or
    presence. `base.shooter_team()` separately refuses it for attribution, on wire id 0.
    """
    if ev.get("command") != "HIR":
        return None
    t = ev.get("tokens", [])
    if len(t) < 6 or str(t[2]).strip() != str(PROTOCOL):
        return None
    try:
        return Proto15Frame(sensor=int(t[1]), player=int(t[3]),
                            team=int(t[4]), magnitude=int(t[5]))
    except (TypeError, ValueError):
        return None                  # a garbled beacon is dropped, never guessed at


# ---- events the reader emits (data only; an engine turns them into Actions) -- #
@dataclass
class BeaconEvent:
    player_id: str       # the gun that HEARD it (presence), not the shooter
    at: float


@dataclass
class HillBeacon(BeaconEvent):
    """An ordinary `mag=8` hill heartbeat. `owner` is None when the point is neutral."""
    owner: Optional[int]
    raw_team: int
    owner_changed: bool  # this beacon reports an owner we did not have → we missed the mag=50


@dataclass
class StationBeacon(BeaconEvent):
    """A `mag=6` respawn station. Deliberately carries no owner: it is not a hill, and treating it
    as one would hand a point to whichever team owns the respawn box."""
    team: int


@dataclass
class PointCaptured(BeaconEvent):
    """`mag=50` — the point changed hands, announce NOW.

    `owner` is the new owner (None only in the never-observed case of a capture word carrying the
    neutral team, handled so a surprise cannot score for a phantom team 2). `from_neutral` is True
    when the point we were tracking was neutral, False when it was another team's, and **None when
    we had never heard a beacon** and honestly cannot say — a `mag=53` may settle it a few seconds
    later.
    """
    owner: Optional[int]
    previous_owner: Optional[int]
    from_neutral: Optional[bool]


@dataclass
class NeutralCaptureConfirmed(BeaconEvent):
    """`mag=53` — the state the last capture LEFT was neutral. `corrected` is True when this
    contradicts what the capture event guessed (we had no prior beacon, or had stale ownership),
    i.e. when a listener that acted on `from_neutral` should revise its story."""
    corrected: bool


@dataclass
class PresenceLost(BeaconEvent):
    """This gun has missed ≥ 2 consecutive beacons — treat it as off the point."""


class HillBeaconReader:
    """Ownership + per-player presence for ONE grenade hill, from its `$HIR` stream.

    Feed every parsed rx event through `on_event`; non-beacon frames cost one dict lookup and
    return nothing. Call `expire(now)` on the clock to age presence out.
    """

    def __init__(self) -> None:
        # As broadcast: 2 = neutral, None = we have never heard this point.
        self.raw_owner: Optional[int] = None
        self.last_beacon_at: dict[str, float] = {}
        self.beacons_heard: int = 0
        # magnitudes we have no meaning for (56 boot, 55, 2 — all single stitched decodes). Counted
        # rather than acted on, so an unexplained word shows up in a snapshot instead of vanishing.
        self.unknown: dict[int, int] = {}
        self._recent: dict[str, dict[tuple[int, int], float]] = {}
        self._capture_at: Optional[float] = None
        self._capture_from_neutral: Optional[bool] = None
        self._lost: set[str] = set()

    # -- state ----------------------------------------------------------------- #
    @property
    def owner(self) -> Optional[int]:
        """The team that OWNS the point — None for neutral OR never-heard.

        Neutral must not read as "team 2 owns it": 2 is the firmware's neutral marker, and a scorer
        handed it would accrue possession for a team that does not exist (F82)."""
        if self.raw_owner is None or self.raw_owner == NEUTRAL_TEAM:
            return None
        return self.raw_owner

    @property
    def neutral(self) -> bool:
        """True only once we have actually heard the point report itself as neutral."""
        return self.raw_owner == NEUTRAL_TEAM

    def is_present(self, player_id: str, now: float) -> bool:
        at = self.last_beacon_at.get(player_id)
        return at is not None and (now - at) <= PRESENCE_GRACE_S

    def present(self, now: float) -> set[str]:
        return {pid for pid in self.last_beacon_at if self.is_present(pid, now)}

    # -- input ----------------------------------------------------------------- #
    def on_event(self, player_id: str, ev: dict, now: float) -> list[BeaconEvent]:
        f = parse(ev)
        if f is None or self._duplicate(player_id, f, now):
            return []
        self.beacons_heard += 1

        if f.magnitude == MODE_RESPAWN:
            # A respawn station shares the protocol and the $SIR cell and nothing else. It moves
            # neither ownership nor hill presence.
            return [StationBeacon(player_id, now, team=f.team)]

        if f.magnitude == MODE_HILL:
            self._seen(player_id, now)
            changed = self.raw_owner is not None and self.raw_owner != f.team
            self.raw_owner = f.team
            return [HillBeacon(player_id, now, owner=self.owner, raw_team=f.team,
                               owner_changed=changed)]

        if f.magnitude == CAPTURE_MAG:
            self._seen(player_id, now)
            if f.team == self.raw_owner:
                # The team that already owns the point cannot capture it. This is the SAME capture
                # reaching us a second time — a second gun in the hill hears the announcement too,
                # and the per-player dedupe window cannot see across guns. Presence still counts;
                # the capture does not, or the confirmation bookkeeping below would be overwritten
                # with "stolen from itself".
                return []
            previous = self.raw_owner
            from_neutral = None if previous is None else (previous == NEUTRAL_TEAM)
            self.raw_owner = f.team
            self._capture_at, self._capture_from_neutral = now, from_neutral
            return [PointCaptured(player_id, now, owner=self.owner,
                                  previous_owner=previous, from_neutral=from_neutral)]

        if f.magnitude == FROM_NEUTRAL_MAG:
            self._seen(player_id, now)
            # NOTE: f.team here is the state that was LEFT (neutral), not the new owner —
            # `raw_owner` is deliberately untouched.
            fresh = (self._capture_at is not None
                     and (now - self._capture_at) <= CONFIRM_WINDOW_S)
            corrected = fresh and self._capture_from_neutral is not True
            if fresh:
                self._capture_from_neutral = True
            return [NeutralCaptureConfirmed(player_id, now, corrected=corrected)]

        self.unknown[f.magnitude] = self.unknown.get(f.magnitude, 0) + 1
        return []

    def expire(self, now: float) -> list[PresenceLost]:
        """Players whose presence has just lapsed (≥ 2 missed beacons). Reported once each; hearing
        another beacon re-arms them."""
        out = []
        for pid, at in self.last_beacon_at.items():
            if (now - at) > PRESENCE_GRACE_S and pid not in self._lost:
                self._lost.add(pid)
                out.append(PresenceLost(pid, now))
        return out

    def snapshot(self, now: Optional[float] = None) -> dict:
        s = {"owner": self.owner, "neutral": self.neutral, "raw_owner": self.raw_owner,
             "beacons": self.beacons_heard,
             "last_beacon_at": dict(self.last_beacon_at)}
        if self.unknown:
            s["unknown_magnitudes"] = dict(self.unknown)
        if now is not None:
            s["present"] = sorted(self.present(now))
        return s

    # -- internals ------------------------------------------------------------- #
    def _seen(self, player_id: str, now: float) -> None:
        self.last_beacon_at[player_id] = now
        self._lost.discard(player_id)

    def _duplicate(self, player_id: str, f: Proto15Frame, now: float) -> bool:
        """F85: the SAME transmission on two sensors, ~14 ms apart. Keyed on identity
        (owner + magnitude) and not on time alone, because a capture legitimately puts two
        DIFFERENT magnitudes on the wire in the same millisecond."""
        recent = self._recent.setdefault(player_id, {})
        for ident, at in list(recent.items()):
            if (now - at) > DEDUPE_WINDOW_S:
                del recent[ident]
        ident = (f.team, f.magnitude)
        dup = ident in recent
        recent[ident] = now
        return dup
