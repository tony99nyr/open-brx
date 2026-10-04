"""Shared MC test fixtures — one Session builder and one match-config dict.

2026-09-12 doc-rot review: `_sess()` was byte-identical in `test_mc_koth.py` and
`test_mode_params.py`, and the same seven-key match config was retyped in five more
files, so a contract change (a new required config key) meant editing five copies and
noticing all five. Import from here instead:

    from _session import mc_session, match_config, TEAMS

2026-10-04 (A19): the "Session on fakes with N phones" builders (`mk_session`, `mk_kit_session`,
`mk_loadout_session`, `mk_stored_session`), `online`, `go_live` and friends live here too. They used to
be defined in a dozen test modules and imported from each other (`from test_mc_state import mk`).
`test_helpers_lint.py` fails if a test module imports another test module or redefines a name from
here.

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


def assign_koth_hill(s, nid: str = "util-hill") -> str:
    """F402 (2026-09-25): a koth `push_config`/`load_game` is now refused with nothing on the field
    that IS the hill (`Session._refuse_koth_hill`) -- `force` does not open it, the same as the F82
    roster gate. A test that wants to reach anything BEYOND that gate assigns one first, the way a
    real host assigns a phone or Stick as CONTROL in ITEMS."""
    s.net.simulate_utility_hello(nid)
    s.set_station(nid, {"kind": "control"})
    return nid


def match_config(mode="tdm", *, teams=None, max_hp=45, max_armor=70, max_shield=0, frag=0,
                 time_limit_s=600, night=False, led=None, **extra):
    """The canonical compile-input config: indoor, auto respawn at 15 s, win by kills. `max_shield`
    defaults to 0 (S45: the Standard preset's own default -- there is no shield unless a caller asks
    for one), matching `compile.HEALTH_PRESETS["standard"]`."""
    c = {"config_id": "c1", "mode": mode, "environment": "indoor", "night": night,
         "time_limit_s": time_limit_s, "respawn": {"type": "auto", "delay_s": 15},
         "scoring": {"frag_limit": frag, "win_by": "kills"},
         "health": {"max_hp": max_hp, "max_armor": max_armor, "max_shield": max_shield,
                    "preset": "standard" if (max_hp, max_armor, max_shield) == (45, 70, 0) else "custom"},
         "teams": TEAMS if teams is None else teams}
    if led is not None:
        c["led"] = led
    c.update(extra)
    return c


# --------------------------------------------------------------------------------------------------
# A real Session on fakes, N phones on GUN-A, GUN-B, ... and an injectable clock.
# --------------------------------------------------------------------------------------------------
import pathlib  # noqa: E402
import tempfile  # noqa: E402

from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory  # noqa: E402
from brx_mcp.mc.state import Session  # noqa: E402
from brx_mcp.mc.store import Store  # noqa: E402

T0 = 5_000_000


def mk_session(n_players=2, compiler=None, *, mode="tdm", time_limit_s=60, cfg=None, net=None, store=None,
               kit=False):
    """Returns `(session, net, clock, players)`. The phase stays at setup unless `kit=True`, which
    reaches KIT the way the operator does (an explicit CONTINUE TO KIT): adding a player never moves
    the phase (2026-09-17), and `online()` only latches `synced_at_lobby` while the phase is
    kit/lobby/armed (A5.7), so a test that reports `synced` needs the KIT phase first."""
    clock = {"t": T0}
    net = net or FakeNet()
    kw = {"store": store} if store is not None else {}
    s = Session(compiler or FakeCompiler(), net, FakeArmory(demo_armory()), now_ms=lambda: clock["t"], **kw)
    s.set_config({"mode": mode, "time_limit_s": time_limit_s, **(cfg or {})})
    ps = [s.add_player(f"OP{i}", gun_id=f"GUN-{chr(65 + i)}") for i in range(n_players)]
    if kit:
        s.set_phase("kit")
    return s, net, clock, ps


def mk_kit_session(n_players=2, mode="tdm", cfg=None, net=None, store=None, compiler=None):
    """`mk_session` in the KIT phase with a 600 s match (the block-B harness)."""
    return mk_session(n_players, compiler, mode=mode, time_limit_s=600, cfg=cfg, net=net, store=store, kit=True)


def mk_loadout_session(n=2, mode="tdm", compiler=None):
    """`mk_session` in the KIT phase with a 60 s match: the loadout picks land in the open window."""
    return mk_session(n, compiler, mode=mode, time_limit_s=60, kit=True)


def mk_stored_session(n_players=2, mode="tdm", cfg=None, store=True):
    """`mk_kit_session` with a REAL sqlite store attached (the replay's only input)."""
    st = Store("t", pathlib.Path(tempfile.mkdtemp()) / "s.sqlite") if store else None
    return mk_kit_session(n_players, mode, cfg, store=st)


def online(s, net, clock, p, i, synced=True, app_ver=None, platform="android", **body):
    """Phone `i` says hello and reports a healthy, kitted status. `body` overrides/extends the status."""
    tail = demo_armory()[i]["ble"]["tail"]
    net.simulate_hello(f"node{i}", f"GUN-{chr(65 + i)}-{tail}", app_ver=app_ver, platform=platform)
    net.simulate_status(f"node{i}", {"player_id": p["player_id"], "hp": 45, "armor": 70, "ammo": 36,
                                     "alive": True, "shots": 0, "battery": 80, "fw": "v4.32",
                                     "arm_state": "kitted", "synced": synced,
                                     "preflight": {"ssid_ok": True, "mc_reachable": True, "phone_batt": 90,
                                                   "screen_on": True, "foreground": True, "gun_linked": True},
                                     **body}, clock["t"])
