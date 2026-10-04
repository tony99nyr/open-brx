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


class DeafNet(FakeNet):
    """A FakeNet where named nodes are out of coverage: `push` returns False, as the real net does."""

    def __init__(self, deaf=()):
        super().__init__()
        self.deaf = set(deaf)

    def push(self, node_id, kind, body):
        super().push(node_id, kind, body)
        return False if node_id in self.deaf else None


def heartbeat(s, net, clock, ps, shots=0):
    """A11.5: MC withholds a global-state alert while any node is stale, so a live-feed test has to
    keep the board fresh or it measures the WITHHELD path instead of the one it means to."""
    for i, p in enumerate(ps):
        net.simulate_status(f"node{i}", {"player_id": p["player_id"], "shots": shots, "alive": True,
                                         "synced": True, "pending": 0}, clock["t"])
    assert s.mc_confidence()["confident"], s.mc_confidence()


def kill(s, net, clock, ps, killer_i, victim_i, info, seq, dt=1000):
    """`killer` shoots `victim`, one second later than the last fact."""
    clock["t"] += dt
    net.simulate_event(f"node{victim_i}", {"type": "death", "t": clock["t"], "match_id": info["match_id"],
                                           "player_id": ps[victim_i]["player_id"],
                                           "shooter_num": ps[killer_i]["player_num"], "shooter_team": 1},
                       clock["t"], seq=seq)


def _go_live(s, net, clock, ps, koth_hill=False):
    n_players = len(ps)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    if koth_hill:
        # F402: push/start refuses a koth game with nothing on the field that IS the hill.
        net.simulate_utility_hello("util-hill")
        s.set_station("util-hill", {"kind": "control"})
    s.push_config()
    for i in range(n_players):
        net.simulate_node_message(f"node{i}", "ack_config", {"config_id": s.config["config_id"], "ok": True,
                                                             "gun_echo": "$LCD"}, clock["t"])
    info = s.start(runway_s=10)
    clock["t"] = info["go_live_t"] + 1
    s.tick()
    assert s.phase == "live"
    heartbeat(s, net, clock, ps)
    return s, net, clock, ps, info


def go_live(n_players=2, mode="tdm", cfg=None, net=None):
    """The block-B harness driven to LIVE: `(session, net, clock, players, start_info)`."""
    s, net, clock, ps = mk_kit_session(n_players, mode, cfg, net)
    return _go_live(s, net, clock, ps)


def go_live_stored(n_players=2, mode="tdm", cfg=None, store=True):
    """`go_live` with a REAL sqlite store, and a koth hill assigned (F402). `store` defaults to ON."""
    s, net, clock, ps = mk_stored_session(n_players, mode, cfg, store)
    return _go_live(s, net, clock, ps, koth_hill=(mode == "koth"))


def mk_online_session(n=3):
    """`mk_session(n)` with every phone online and synced (the lobby is NOT pushed)."""
    s, net, clock, ps = mk_session(n)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    return s, net, clock, ps


def results(net):
    """The LATEST `result` body each node was pushed."""
    out = {}
    for nid, _kind, body in net.pushes("result"):
        out[nid] = body
    return out


def row(s, pid):
    return next(r for r in s.readiness()["board"] if r["player_id"] == pid)


def lobby(s):
    return s.snapshot()["lobby"]


def echo_for(s, pid, slot=0):
    """The `$ALCD` a gun holding THIS player's pushed head would answer with."""
    from brx_mcp.mc import frames as _f
    mag, reserve = _f.head_spawn_ammo(s.bundles[pid]["head"]) or (0, 0)
    return f"$ALCD,{mag},100,{slot},{reserve},0,*"


def ack_head(net, s, i, pid, *, config_id=None, echo=None, t=None, gun_config=None):
    """Node `i` acks the current config with the `$ALCD` THIS player's head would produce (or `echo`)."""
    body = {"config_id": config_id or s.config["config_id"], "ok": True,
            "gun_echo": echo if echo is not None else echo_for(s, pid)}
    if gun_config is not None:
        body["gun_config"] = gun_config
    net.simulate_node_message(f"node{i}", "ack_config", body, t if t is not None else s.now_ms())


LOBBY_ECHO = "$ALCD,32,100,0,192,0,*"


def ack_lobby(s, net, clock, i, config_id=None, ok=True):
    """Node `i` answers the lobby push with a fixed echo (`ok=False`: it could not echo)."""
    body = {"config_id": config_id or s.config["config_id"], "ok": ok}
    body.update({"gun_echo": LOBBY_ECHO} if ok else {"err": "no_echo"})
    net.simulate_node_message(f"node{i}", "ack_config", body, clock["t"])
