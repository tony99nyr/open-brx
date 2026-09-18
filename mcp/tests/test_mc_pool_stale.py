"""F208 (field 2026-09-13): a gun died while its status stayed byte-identical for 105 s, and the MC board
showed a healthy player. The phone now says when its pool is stale (`status.pool_stale`: "silent" or
"no_fire", with `pool_stale_ms`). MC passes the claim through to the node view, the readiness row and the
LIVE row. Every heartbeat restates it, so a status without it clears it; an older app never sends it.

F264 (field 2026-09-18): the node now probes a `pool_stale` gun itself and reports its OWN outcome
(`status.cure`: "asking" / "dead" / "alive" / "no_answer"). MC passes it through the same three ways,
below."""
import pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from test_mc_state import mk, online


def _status(net, clock, i, p, **extra):
    body = {"player_id": p["player_id"], "hp": 45, "armor": 70, "ammo": 36, "alive": True, "shots": 0,
            "battery": 80, "fw": "v4.32", "arm_state": "kitted", "synced": True,
            "preflight": {"ssid_ok": True, "mc_reachable": True, "gun_linked": True}}
    net.simulate_status(f"node{i}", {**body, **extra}, clock["t"])


def _node(s, i):
    return next(n for n in s.snapshot()["nodes"] if n["node_id"] == f"node{i}")


def _ready_row(s, p):
    return next(r for r in s.readiness()["board"] if r["player_id"] == p["player_id"])


def _session(n=2):
    s, net, clock, ps = mk(n)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    return s, net, clock, ps


def test_the_claim_reaches_the_node_view_and_the_readiness_row():
    s, net, clock, ps = _session()
    _status(net, clock, 0, ps[0], pool_stale="silent", pool_stale_ms=185_000)
    assert (_node(s, 0)["pool_stale"], _node(s, 0)["pool_stale_ms"]) == ("silent", 185_000)
    row = _ready_row(s, ps[0])
    assert (row["pool_stale"], row["pool_stale_ms"]) == ("silent", 185_000)


def test_an_app_that_does_not_report_it_gets_no_field():
    s, net, clock, ps = _session()
    assert "pool_stale" not in _node(s, 1) and "pool_stale_ms" not in _node(s, 1)
    row = _ready_row(s, ps[1])
    assert row["pool_stale"] is None and row["pool_stale_ms"] is None


def test_a_heartbeat_without_the_claim_clears_it():
    """Absent means not stale. MC merges status keys into the node record, so without this the first
    `silent` would stay on the board for the rest of the session after the gun came back."""
    s, net, clock, ps = _session()
    _status(net, clock, 0, ps[0], pool_stale="no_fire", pool_stale_ms=3_000)
    assert _node(s, 0)["pool_stale"] == "no_fire", "control"
    _status(net, clock, 0, ps[0])
    assert "pool_stale" not in _node(s, 0) and "pool_stale_ms" not in _node(s, 0)
    assert _ready_row(s, ps[0])["pool_stale"] is None


def test_pl4_a_lost_spawn_write_is_a_known_reason():
    """pl4: the phone flags `write_lost` when a spawn or revive write resolved false and it did not repeat it."""
    s, net, clock, ps = _session()
    _status(net, clock, 0, ps[0], pool_stale="write_lost", pool_stale_ms=900)
    assert _node(s, 0)["pool_stale"] == "write_lost"
    assert _ready_row(s, ps[0])["pool_stale"] == "write_lost"

def test_junk_is_dropped_not_rendered():
    s, net, clock, ps = _session(1)
    for junk in ("stale", True, 1, None):
        _status(net, clock, 0, ps[0], pool_stale=junk, pool_stale_ms=5_000)
        assert "pool_stale" not in _node(s, 0) and "pool_stale_ms" not in _node(s, 0), junk
    for junk_ms in ("45s", -1, True, 1.5):
        _status(net, clock, 0, ps[0], pool_stale="silent", pool_stale_ms=junk_ms)
        assert _node(s, 0)["pool_stale"] == "silent" and "pool_stale_ms" not in _node(s, 0), junk_ms


def test_the_live_row_carries_it_only_for_the_node_that_claims_it():
    s, net, clock, ps = _session()
    s.push_config(force=True)
    for i in range(2):
        net.simulate_node_message(f"node{i}", "ack_config", {"config_id": s.config["config_id"], "ok": True,
                                                           "gun_echo": "x"}, clock["t"])
    s.start(force=True)
    clock["t"] = s.start_info["go_live_t"] + 10
    s.tick()
    _status(net, clock, 0, ps[0], pool_stale="silent", pool_stale_ms=190_000, arm_state="live")
    _status(net, clock, 1, ps[1], arm_state="live")
    rows = {r["player_id"]: r for r in s.snapshot()["live"]["rows"]}
    assert (rows[ps[0]["player_id"]]["pool_stale"], rows[ps[0]["player_id"]]["pool_stale_ms"]) == ("silent", 190_000)
    assert "pool_stale" not in rows[ps[1]["player_id"]]


# F264 (field 2026-09-18): the node's own outcome after it probes a `pool_stale` gun (`status.cure`:
# "asking" / "dead" / "alive" / "no_answer"), so the board reads more than "stale". Flows exactly like
# `pool_stale`: every heartbeat restates it, so a status without it clears it; an older app never sends it.

def test_the_cure_reaches_the_node_view_the_readiness_row_and_the_live_row():
    s, net, clock, ps = _session()
    s.push_config(force=True)
    for i in range(2):
        net.simulate_node_message(f"node{i}", "ack_config", {"config_id": s.config["config_id"], "ok": True,
                                                           "gun_echo": "x"}, clock["t"])
    s.start(force=True)
    clock["t"] = s.start_info["go_live_t"] + 10
    s.tick()
    _status(net, clock, 0, ps[0], cure="no_answer", arm_state="live")
    _status(net, clock, 1, ps[1], arm_state="live")
    assert _node(s, 0)["cure"] == "no_answer"
    assert _ready_row(s, ps[0])["cure"] == "no_answer"
    rows = {r["player_id"]: r for r in s.snapshot()["live"]["rows"]}
    assert rows[ps[0]["player_id"]]["cure"] == "no_answer"
    assert "cure" not in rows[ps[1]["player_id"]]


def test_an_app_that_does_not_report_cure_gets_no_field():
    s, net, clock, ps = _session()
    assert "cure" not in _node(s, 1)
    assert _ready_row(s, ps[1])["cure"] is None


def test_a_heartbeat_without_cure_clears_it():
    s, net, clock, ps = _session()
    _status(net, clock, 0, ps[0], cure="dead")
    assert _node(s, 0)["cure"] == "dead", "control"
    _status(net, clock, 0, ps[0])
    assert "cure" not in _node(s, 0)
    assert _ready_row(s, ps[0])["cure"] is None


def test_junk_cure_is_dropped_not_rendered():
    s, net, clock, ps = _session(1)
    for junk in ("cured", True, 1, None):
        _status(net, clock, 0, ps[0], cure=junk)
        assert "cure" not in _node(s, 0), junk
