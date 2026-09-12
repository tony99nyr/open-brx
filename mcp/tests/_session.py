"""Shared MC test fixtures — one Session builder and one match-config dict.

2026-09-12 doc-rot review: `_sess()` was byte-identical in `test_mc_koth.py` and
`test_mode_params.py`, and the same seven-key match config was retyped in five more
files, so a contract change (a new required config key) meant editing five copies and
noticing all five. Import from here instead:

    from _session import mc_session, match_config, TEAMS

The files keep their own `_sess`/`_cfg` names as thin wrappers where their call sites
pass different knobs (`_TEAMS` is genuinely per-file: `test_armed_pool_formula.py`
runs one team, `test_spawn_protection.py` gives yellow tid 3).
"""

# The two-team default. A file that needs a different roster passes `teams=`.
TEAMS = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
         {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 2}]


def mc_session(mode="koth", n=2, **cfg):
    """A Session with `n` players on GUN-A, GUN-B, ... and a 10-minute `mode` config."""
    from brx_mcp.mc.compile import Compiler
    from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
    from brx_mcp.mc.state import Session

    s = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()))
    s.set_config({"mode": mode, "time_limit_s": 600, **cfg})
    for i in range(n):
        s.add_player(f"OP{i}", gun_id=f"GUN-{chr(65 + i)}")
    return s


def match_config(mode="tdm", *, teams=None, max_hp=45, max_armor=70, frag=0,
                 time_limit_s=600, night=False, led=None, **extra):
    """The canonical compile-input config: indoor, auto respawn at 15 s, win by kills."""
    c = {"config_id": "c1", "mode": mode, "environment": "indoor", "night": night,
         "time_limit_s": time_limit_s, "respawn": {"type": "auto", "delay_s": 15},
         "scoring": {"frag_limit": frag, "win_by": "kills"},
         "health": {"max_hp": max_hp, "max_armor": max_armor},
         "teams": TEAMS if teams is None else teams}
    if led is not None:
        c["led"] = led
    c.update(extra)
    return c
