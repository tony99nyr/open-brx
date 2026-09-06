"""The headset shows the TEAM COLOUR for the whole life, not just until the first spawn or hit.

Bench 2026-09-03 (`mcp/tools/hled_spawned.py`, `hled_bright.py`, gun DELTA-9498, Tony watching):
`$SPAWN` clears the headset; every registered hit clears it (native flash, then dark, ours never
returns); a static `$HLED` painted AFTER spawn holds solid; a paint 1 s after spawn lit; token 5 is a
two-level brightness with 10 already maximum. So the team colour must be re-sent after every spawn and
every hit, on both paths: the direct-BLE `GameDriver` and the phone bundle MC compiles.
"""
import asyncio
import dataclasses

from brx_mcp import poolgauge as pg
from brx_mcp.gameconfig import GameConfig, RESPAWN_SEQUENCE
from brx_mcp.mc.compile import Compiler, WeaponCatalog, golden_bundle
from brx_mcp.modes.base import Respawn, SendFrame
from brx_mcp.modes.driver import GameDriver


def _drain(d, pid="p1"):
    """Await the in-flight event burst so no Task is left pending when the loop goes away."""
    t = d._bursts.get(pid)
    if t is not None:
        _run(t)


def _run(coro):
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError("closed")
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


def _driver(sent, leds=True, team=1):
    async def sender(pid, frame, reply_window_ms=None):
        sent.append(frame)
    cfg = GameConfig() if leds else dataclasses.replace(GameConfig(), leds=False)
    return GameDriver(cfg, {"p1": team}, sender, announce=lambda s: None)


# --- the frame itself ------------------------------------------------------- #
def test_headset_team_frame_is_static_full_bright_and_uses_the_shared_palette():
    assert pg.headset_team_frame(1) == "$HLED,1,0,,,10,,*"       # team 1 = blue, index 1
    assert pg.headset_team_frame(2) == "$HLED,0,0,,,10,,*"       # team 2 = red, index 0
    assert pg.headset_team_frame(None) == f"$HLED,{pg.WHITE},0,,,10,,*"
    # token 2 = 0 is the STATIC form (the blink form is t2=2); token 5 = 10 is already maximum.
    for t in (1, 2, 3, 4, None):
        toks = pg.headset_team_frame(t).split(",")
        assert toks[2] == "0" and toks[5] == "10"


# --- GameDriver: after every $SPAWN and every hit ---------------------------- #
def test_a_respawn_repaints_the_headset_right_after_the_spawn_sequence():
    sent = []
    d = _driver(sent)
    d.tick(0.0)
    _run(d.execute([Respawn("p1")]))
    _drain(d)
    i = sent.index(RESPAWN_SEQUENCE[-1])
    assert sent[i + 1] == pg.headset_team_frame(1), sent


def test_the_game_start_paints_every_headset_after_the_spawn_burst():
    sent = []
    d = _driver(sent)
    _run(d.setup())
    hled = [f for f in sent if f.startswith("$HLED,1,0")]
    assert hled, "no headset team colour sent at game start"
    assert sent.index(hled[-1]) > sent.index("$SPAWN,,*"), "must come AFTER $SPAWN, which clears it"


def test_a_registered_hit_yields_a_headset_repaint():
    d = _driver([])
    acts = d.feed("p1", {"raw": "$HIR,0,0,42,2,20,0,0,*", "cmd": "HIR"}, 1.0)
    frames = [a.frame for a in acts if isinstance(a, SendFrame)]
    assert pg.headset_team_frame(1) in frames, frames


def test_a_non_hit_event_does_not_repaint_the_headset():
    d = _driver([])
    acts = d.feed("p1", {"raw": "$HP,45,50,0,*", "cmd": "HP"}, 1.0)
    assert not any(isinstance(a, SendFrame) and a.frame.startswith("$HLED") for a in acts)


def test_leds_off_never_lights_a_headset():
    sent = []
    d = _driver(sent, leds=False)
    _run(d.setup())
    _run(d.execute([Respawn("p1")]))
    _drain(d)
    acts = d.feed("p1", {"raw": "$HIR,0,0,42,2,20,0,0,*", "cmd": "HIR"}, 1.0)
    assert not any(f.startswith("$HLED") for f in sent)
    assert not any(isinstance(a, SendFrame) and a.frame.startswith("$HLED") for a in acts)


# --- the MC bundle the phone plays ------------------------------------------ #
def test_default_headset_is_team_pregame_and_dark_in_play():
    """A11.6 (Tony): team colour in the lobby, dark once the game starts; the in-play repaint after
    spawn / revive / hit exists only when the profile's headset.in_play is "team"."""
    b = golden_bundle()
    assert [f for f in b["head"] if f.startswith("$HLED")] == ["$HLED,1,0,,,10,,*"]   # pregame team colour
    assert not any(f.startswith("$HLED") for f in b["spawn"] + b["revive"])              # dark in play
    assert b["cues"]["team_led"] == ""
    assert b["headset"]["in_play"] == "dark" and b["headset"]["rest"] == "$HLED,,6,,,,,*"


def test_in_play_team_restores_the_tails_and_the_repaint_cue():
    from brx_mcp.mc import compile as C, presentation as P
    cfg = {"config_id": "t", "mode": "tdm", "environment": "indoor", "night": False, "time_limit_s": 600,
           "respawn": {"type": "auto", "delay_s": 15}, "scoring": {"frag_limit": 0, "win_by": "kills"},
           "health": {"max_hp": 45, "max_armor": 70},
           "teams": [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1}, {"team_id": "yellow", "name": "Y", "color": "yellow", "tid": 2}],
           "presentation": P.merge(None, {"headset": {"in_play": "team"}})}
    player = {"player_id": "p1", "player_num": 7, "display": "R", "team_id": "blue", "node_id": None, "gun_id": None,
              "voice": "male", "ready": True, "loadout": {"weapons": [{"weapon_id": "assault_rifle"}]}}
    b = C._DEFAULT.compile(cfg, player, cfg["teams"])
    assert b["spawn"][-1] == "$HLED,1,0,,,10,,*" and b["revive"][-1] == "$HLED,1,0,,,10,,*"
    assert b["spawn"].index("$SPAWN,,*") < len(b["spawn"]) - 1          # after $SPAWN, which clears it
    assert b["cues"]["team_led"] == "$HLED,1,0,,,10,,*"
    assert b["headset"]["rest"] == "$HLED,1,0,,,10,,*"


def test_leds_off_bundle_has_no_lit_headset_frame_anywhere():
    """A night game must not light a head: no lobby frame, no spawn/revive frame, empty cue."""
    from brx_mcp.mc import compile as C
    config = {
        "config_id": "night-tdm", "mode": "tdm", "environment": "outdoor", "night": True,
        "time_limit_s": 600, "respawn": {"type": "auto", "delay_s": 15},
        "scoring": {"frag_limit": 0, "win_by": "kills"},
        "health": {"max_hp": 45, "max_armor": 70},
        "teams": [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
                  {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 2}],
    }
    player = {
        "player_id": "p-night", "player_num": 7, "display": "OWL", "team_id": "blue",
        "node_id": None, "gun_id": None, "voice": "male", "ready": True,
        "loadout": {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "shotgun"}]},
    }
    b = C._DEFAULT.compile(config, player, config["teams"])
    for k in ("head", "spawn", "revive"):
        lit = [f for f in b[k] if f.startswith("$HLED") and not f.startswith("$HLED,,6")]
        assert not lit, (k, lit)
    assert b["cues"]["team_led"] == ""
