"""Station actions on the real utility socket path."""
from __future__ import annotations

from ..registry import Scenario, scenario

STATION_SETUP = [
    {"name": "station_assign_control", "params": {"nid": "utility-hill"}},
    {"name": "mc_restart", "params": {}},
    {"name": "station_depart", "params": {"nid": "utility-hill"}},
    {"name": "mc_restart", "params": {}},
    {"name": "station_restore", "params": {"nid": "utility-hill", "dep": 0}},
    {"name": "station_release", "params": {"nid": "utility-hill"}},
    {"name": "mc_restart", "params": {}},
    {"name": "station_dismiss", "params": {"nid": "utility-hill"}},
    {"name": "station_assign_control", "params": {"nid": "utility-hill"}},
    {"name": "station_assign_powerup", "params": {"nid": "utility-powerup", "preset": "overshield"}},
    {"name": "station_assign_respawn", "params": {"nid": "utility-respawn"}},
]


scenario(Scenario(
    name="stations-mixed", mode="koth", nodes=8, steps=20, finish="end", real_stations=True,
    doc="Assign utility stations before the match, exercise an authenticated HUD return and restore, "
        "then claim and take powerup items during play.",
    setup_script=STATION_SETUP,
    weights={"powerup_reset": 1, "powerup_claim": 2, "powerup_station_take": 2, "powerup_conflict": 1,
             "station_release": 0.15, "station_depart": 0.15, "station_dismiss": 0.2,
             "mc_restart": 0.25, "mc_crash": 0.25},
    ci_seeds=(1,),    xfail="F484: a phone pickup after a reset before the first spawn names spawn 0 and MC refuses it",
    xfail_invariant="pickup_credited",
))

scenario(Scenario(
    name="stations-powerup-paths", mode="koth", nodes=4, real_stations=True,
    doc="A player's pickup fact and a utility station's taken message each credit their player; a station report "
        "corrects a conflicting phone claim, and a later phone claim does not override it (F454).",
    setup_script=STATION_SETUP,
    script=[
        {"name": "powerup_reset", "params": {"nid": "utility-powerup"}},
        {"name": "powerup_claim", "params": {"node": 0, "nid": "utility-powerup"}},
        {"name": "powerup_reset", "params": {"nid": "utility-powerup"}},
        {"name": "powerup_station_take", "params": {"nid": "utility-powerup", "player_num": 1}},
        {"name": "powerup_reset", "params": {"nid": "utility-powerup"}},
        {"name": "powerup_conflict", "params": {"node": 0, "nid": "utility-powerup", "player_num": 2}},
        {"name": "end", "params": {}},
    ],
    ci_seeds=(1,),    xfail="F484: a phone pickup after a reset before the first spawn names spawn 0 and MC refuses it",
    xfail_invariant="pickup_credited",
))


# F473 (review 2026-10-05): MC compares a phone's `pickup.t` (the phone's synced clock) with the item's `since`
# (MC's clock) with no tolerance. Each step respawns the item (operator reset), waits for the advert, then sends
# a real pickup with the phone's clock off by the given amount. Leading clocks are clamped to arrival, so they
# pass; trailing ones by more than the advert delay lose the take.
_SKEW_SETUP = [
    {"name": "station_assign_control", "params": {"nid": "utility-hill"}},
    {"name": "station_assign_powerup", "params": {"nid": "utility-powerup", "preset": "overshield"}},
]


def _skew_script(skews: tuple[int, ...]) -> list[dict]:
    steps = [{"name": "powerup_reset", "params": {"nid": "utility-powerup"}},
             {"name": "powerup_claim", "params": {"node": 1, "nid": "utility-powerup"}}]
    steps += [{"name": "powerup_skew_claim", "params": {"node": 0, "nid": "utility-powerup", "skew_ms": k}}
              for k in skews]
    return steps + [{"name": "end", "params": {}}]


scenario(Scenario(
    name="pickup-clock-lead", mode="koth", nodes=4, real_stations=True,
    doc="A real pickup after a respawn, from a phone whose synced clock LEADS MC by 50, 200 and 500 ms, is credited.",
    setup_script=_SKEW_SETUP, script=_skew_script((50, 200, 500)), ci_seeds=(1,),    xfail="F484: a phone pickup after a reset before the first spawn names spawn 0 and MC refuses it",
    xfail_invariant="pickup_credited",
))

scenario(Scenario(
    name="pickup-clock-skew", mode="koth", nodes=4, real_stations=True,
    doc="A real pickup after a respawn, from a phone whose synced clock TRAILS MC by 50, 200 and 500 ms, is "
        "credited. F473 (fixed 2026-10-05): MC used to drop it once the trail passed the advert delay.",
    setup_script=_SKEW_SETUP, script=_skew_script((-50, -200, -500)), ci_seeds=(1,),    xfail="F484: a phone pickup after a reset before the first spawn names spawn 0 and MC refuses it",
    xfail_invariant="pickup_credited",
))
