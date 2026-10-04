"""D4/A8 (maintainability review 2026-10-03): ONE cue table. Event frames come from `presentation.EVENTS` only; the
cues no event owns (countdown, the low-health pair, tick, klaxon, the runway) come from `compile.base_cues` only.
`Compiler.cues()` once shipped `game_over`, `victory`, `multi` and `medal` beside `EVENTS`, which overwrote them in
silence, and `fakes.py` and `soak/patterns.py` kept hand copies. These tests fail if a second table appears.

Run: python3 run_tests.py cue_table_single_source
"""
from __future__ import annotations

import copy
import inspect
import re

from brx_mcp.gameconfig import VOICE_PACKS
from brx_mcp.mc import compile as C
from brx_mcp.mc import presentation as P
from brx_mcp.mc.compile import Compiler, base_cues, golden_bundle
from brx_mcp.mc.fakes import FakeCompiler

_PLAY_LITERAL = re.compile(r"[\"']\$PLAY,")


def test_the_base_table_shares_no_key_with_the_event_table():
    for night in (False, True):
        assert not set(base_cues(night)) & set(P.EVENTS), "a cue lives in both tables; EVENTS would overwrite it in silence"


def test_compiler_cues_are_the_base_table_plus_the_kill_helper_only():
    assert set(Compiler().cues("male")) - set(base_cues()) == {"kill"}


def test_no_hand_copy_of_a_cue_frame_outside_the_two_tables():
    assert not _PLAY_LITERAL.search(inspect.getsource(Compiler.cues)), "Compiler.cues() holds its own frame literal"
    from brx_mcp.mc import fakes
    from brx_mcp.soak import patterns
    for mod in (fakes, patterns):
        assert not _PLAY_LITERAL.search(inspect.getsource(mod)), f"{mod.__name__} holds a hand copy of a cue frame"


def test_the_fallback_compiler_ships_what_the_real_one_ships():
    real = golden_bundle()["cues"]
    fake = FakeCompiler().cues("male")
    assert fake, "the fallback ships cues"
    assert {k: v for k, v in fake.items()} == {k: real[k] for k in fake}, "the fallback and the real bundle disagree"


def test_every_voice_ships_the_kill_line_the_kill_helper_names():
    base = {"config_id": "g", "mode": "tdm", "environment": "indoor", "night": False, "time_limit_s": 600,
            "respawn": {"type": "auto", "delay_s": 15}, "scoring": {"frag_limit": 0, "win_by": "kills"},
            "health": C.default_health(),
            "teams": [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
                      {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 2}]}
    for v in VOICE_PACKS:
        pl = {"player_id": "p", "player_num": 7, "display": "R", "team_id": "blue", "node_id": None, "gun_id": None,
              "voice": v, "ready": True, "loadout": {"weapons": [{"weapon_id": "assault_rifle"}]}}
        b = C._DEFAULT.compile(copy.deepcopy(base), pl, base["teams"])
        assert b["cues"]["kill"] == Compiler().cues(v)["kill"], v
