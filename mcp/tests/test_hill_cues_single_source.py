"""A8 (maintainability review 2026-10-03): the King of the Hill cues come from `presentation.EVENTS`, like every other
event cue. engine.js `HILL_CUES` and stage.py `HILL_CUES` keep their frames only as the fallback for a bundle that
MC compiled before these rows existed; their lengths come from the sound catalogue, never from a hand-kept number.

Announcer off: before A8, only `hill_captured` was in the bundle, so the announcer switch muted that one line and the
node's literal fallbacks still played `hill_lost`, `hill_contested`, `hill_moved` and the possession tick. The four new
rows are `ungated`, so the bundle keeps exactly that behaviour. Whether the silenced preset should also mute them is a
design call for Tony, not a side effect of a refactor.

Run: python3 run_tests.py hill_cues_single_source
"""
from __future__ import annotations

import copy

from brx_mcp import sounds as snd
from brx_mcp.mc import compile as C
from brx_mcp.mc import presentation as P
from brx_mcp.mc.compile import golden_bundle
from brx_mcp.stage import stage as S

# The four sounds the node played from its literal fallback, whatever the presentation switches said.
UNGATED = ("hill_lost", "hill_contested", "hill_moved", "hill_tick")
ALL_HILL = ("hill_captured",) + tuple(UNGATED)   # F463: all five play whatever the switches say


def test_every_hill_cue_the_node_can_play_is_a_presentation_event():
    missing = sorted(set(S.HILL_CUES) - set(P.EVENTS))
    assert not missing, f"hill cues with no presentation.EVENTS row (a client fallback is their only source): {missing}"


def test_the_bundle_ships_every_hill_cue_and_it_is_the_fallback_frame():
    cues = golden_bundle()["cues"]
    for kind, d in S.HILL_CUES.items():
        assert kind in cues, f"the compiled bundle has no cue for {kind}"
        assert cues[kind] == d["frame"], f"{kind}: MC ships {cues[kind]!r}, the node falls back to {d['frame']!r}"


def test_the_fallback_lengths_are_the_catalogue_lengths():
    cat = snd._catalog()
    for kind, d in S.HILL_CUES.items():
        sid = S._cue_id(d["frame"])
        assert sid, kind
        assert d["s"] == round(cat[sid]["duration_s"] * 1000) / 1000.0, f"{kind}: {d['s']} s is not {sid}'s catalogue length"


def _koth_bundle(presentation: dict) -> dict:
    cfg = {"config_id": "koth-a8", "mode": "koth", "environment": "outdoor", "night": False, "time_limit_s": 600,
           "respawn": {"type": "auto", "delay_s": 15}, "scoring": {"frag_limit": 0, "win_by": "kills"},
           "health": C.default_health(), "presentation": presentation,
           "teams": [{"team_id": "red", "name": "Red", "color": "red", "tid": 0},
                     {"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1}]}
    pl = {"player_id": "p", "player_num": 7, "display": "R", "team_id": "blue", "node_id": None, "gun_id": None,
          "voice": "male", "ready": True, "loadout": {"weapons": [{"weapon_id": "assault_rifle"}]}}
    return C._DEFAULT.compile(copy.deepcopy(cfg), pl, cfg["teams"])


def test_announcer_off_keeps_all_five_hill_sounds():
    """F463 (Tony 2026-10-05): the hill sounds are game information, not announcer flavour. Silenced (announcer off)
    ships all five, Hill Captured included, as live frames."""
    cues = _koth_bundle({"preset": "silenced"})["cues"]
    for kind in ALL_HILL:
        assert cues[kind] == S.HILL_CUES[kind]["frame"], f"announcer off must not mute {kind}: {cues.get(kind)!r}"


def test_no_event_switch_mutes_any_hill_sound():
    """F463: no switch (announcer, hud_events, mc_events) mutes any of the five hill sounds."""
    for switch in ("announcer", "hud_events", "mc_events"):
        prof = P.resolve({"mode": "koth", "presentation": {"preset": "standard", switch: False}})
        frames = P.cue_frames(prof, {})
        for kind in ALL_HILL:
            assert frames[kind] == S.HILL_CUES[kind]["frame"], f"{switch} off muted {kind}"
        rows = {r["event"]: r for r in P.table({"mode": "koth", "presentation": {"preset": "standard", switch: False}})}
        assert all(rows[k]["enabled"] for k in ALL_HILL), f"{switch} off: the MC table must not show {ALL_HILL} as off"


def test_a_host_can_still_turn_one_hill_sound_off_by_its_own_row():
    """A8 r1 (M1): `sound: null` ships "" (muted). An ABSENT key means an older bundle, and the node plays its literal
    fallback for it, so dropping the key would leave the sound on. `hill_captured` follows the same rule."""
    prof = P.resolve({"mode": "koth", "presentation": {"preset": "custom", "events": {
        "hill_tick": {"sound": None}, "hill_captured": {"sound": None}}}})
    frames = P.cue_frames(prof, {})
    assert frames["hill_tick"] == "" and frames["hill_captured"] == "", "sound: null mutes, it does not drop the key"
    assert frames["hill_lost"] == S.HILL_CUES["hill_lost"]["frame"], "and only those two"
    assert "hit_taken" not in frames, "a soundless event with no node fallback still ships no key"


def test_the_events_that_ship_a_mute_are_exactly_the_nodes_fallbacks():
    assert P.NODE_FALLBACK_EVENTS == set(S.HILL_CUES), "a node fallback with no mute, or a mute with no fallback"
