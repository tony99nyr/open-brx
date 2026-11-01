"""Tony 2026-11-01: "when players are kitting ... the volume is game volume".

Every `$VOL` MC sends before START uses the game's head volume (`Compiler.head_volume`: `--bench-volume`, else
the K8 knob, else the venue volume, 90 outdoors). Two paths reach a gun in KIT:

- a try-out (`Session.tryout` -> `tutorial{weapon, frames}`), whose head starts with a `$VOL`;
- a fresh gun link (a heartbeat whose `preflight.gun_linked` turns true), where MC sends one `$VOL` in a
  `tutorial{end: true, frames}` message. A KITTED phone writes those frames verbatim (0.4.30 included), so
  the gun plays kit sounds at game volume without a phone change.

Run: python3 run_tests.py kit_volume
"""
from _session import mk_loadout_session, online
from brx_mcp.mc.compile import Compiler

C = Compiler()


def _vols(frames):
    return [int(f.split(",")[1]) for f in frames if f.startswith("$VOL,")]


def _beat(s, net, clock, p, i, linked):
    net.simulate_status(f"node{i}", {"player_id": p["player_id"], "alive": True, "synced": True,
                                     "arm_state": "kitted", "preflight": {"gun_linked": linked}}, clock["t"])


def test_a_tryout_plays_at_the_outdoor_game_volume():
    s, net, clock, ps = mk_loadout_session(1, compiler=C)
    online(s, net, clock, ps[0], 0)
    s.set_config({"environment": "outdoor"})
    s.tryout(ps[0]["player_id"], "assault_rifle")
    frames = net.pushes("tutorial", "node0")[-1][2]["frames"]
    assert _vols(frames) == [90] and frames[0] == "$VOL,90,0,*", frames[:2]


def test_a_tryout_plays_at_the_bench_volume_when_the_flag_is_set():
    s, net, clock, ps = mk_loadout_session(1, compiler=Compiler(bench_volume=65))
    online(s, net, clock, ps[0], 0)
    s.set_config({"environment": "outdoor"})
    s.tryout(ps[0]["player_id"], "assault_rifle")
    assert _vols(net.pushes("tutorial", "node0")[-1][2]["frames"]) == [65]


def test_a_tryout_follows_the_game_volume_knob():
    s, net, clock, ps = mk_loadout_session(1, compiler=C)
    online(s, net, clock, ps[0], 0)
    s.set_config({"environment": "outdoor", "volume": 75})
    s.tryout(ps[0]["player_id"], "assault_rifle")
    assert _vols(net.pushes("tutorial", "node0")[-1][2]["frames"]) == [75]


def _kit_vol_pushes(net):
    return [b for (_, k, b) in [(n, k, b) for (n, k, b) in net.pushes("tutorial", "node0")]
            if b.get("end") is True and b.get("frames") and all(f.startswith("$VOL,") for f in b["frames"])]


def test_a_fresh_gun_link_in_kit_gets_one_vol_at_game_volume():
    s, net, clock, ps = mk_loadout_session(1, compiler=C)
    s.set_config({"environment": "outdoor"})
    online(s, net, clock, ps[0], 0, preflight={"gun_linked": False})
    assert _kit_vol_pushes(net) == []                      # no gun yet: nothing to set
    _beat(s, net, clock, ps[0], 0, True)
    assert [b["frames"] for b in _kit_vol_pushes(net)] == [["$VOL,90,0,*"]]
    _beat(s, net, clock, ps[0], 0, True)
    assert len(_kit_vol_pushes(net)) == 1                  # one per link, not one per heartbeat
    _beat(s, net, clock, ps[0], 0, False)
    _beat(s, net, clock, ps[0], 0, True)
    assert len(_kit_vol_pushes(net)) == 2                  # a relink sets it again (a power cycle forgets it)


def test_the_kit_link_vol_uses_the_bench_volume():
    s, net, clock, ps = mk_loadout_session(1, compiler=Compiler(bench_volume=65))
    online(s, net, clock, ps[0], 0)
    assert [b["frames"] for b in _kit_vol_pushes(net)] == [["$VOL,65,0,*"]]


def test_no_kit_link_vol_during_a_tryout_or_after_the_push():
    s, net, clock, ps = mk_loadout_session(1, compiler=C)
    online(s, net, clock, ps[0], 0)
    n = len(_kit_vol_pushes(net))
    s.tryout(ps[0]["player_id"], "assault_rifle")
    _beat(s, net, clock, ps[0], 0, False)
    _beat(s, net, clock, ps[0], 0, True)
    assert len(_kit_vol_pushes(net)) == n                  # an end message would close the running try-out
    s.tryout(ps[0]["player_id"], None)
    s.lobby_pushed = True                                  # the pushed head carries the game volume itself
    _beat(s, net, clock, ps[0], 0, False)
    _beat(s, net, clock, ps[0], 0, True)
    assert len(_kit_vol_pushes(net)) == n


def test_a_link_reported_before_the_bind_still_gets_its_vol_once_bound():
    s, net, clock, ps = mk_loadout_session(1, compiler=C)
    s.set_config({"environment": "outdoor"})
    s.node_player.pop("node0", None)
    _beat(s, net, clock, ps[0], 0, True)                   # linked, but the node is not bound to a player yet
    s.node_player["node0"] = ps[0]["player_id"]            # stand-in for the bind
    _beat(s, net, clock, ps[0], 0, True)
    assert [b["frames"] for b in _kit_vol_pushes(net)] == [["$VOL,90,0,*"]]


def test_no_kit_link_vol_while_a_match_is_in_play():
    s, net, clock, ps = mk_loadout_session(1, compiler=C)
    online(s, net, clock, ps[0], 0, preflight={"gun_linked": False})
    s.in_play = lambda: True                               # ARMED or LIVE: the head carries the volume
    _beat(s, net, clock, ps[0], 0, True)
    assert _kit_vol_pushes(net) == []


def test_the_push_ends_an_open_tryout_before_the_head():
    """Bench 2026-11-01: a push with a try-out still open sent the head to a gun the try-out left started.
    Its `$START` drew no zeroed `$LCD`, so the phone acked `no_config` (F549) for a gun that took the head.
    The push now ends the try-out first: the node gets the teardown, `$STOP` included, ahead of its config."""
    from brx_mcp.mc.state import TRYOUT_TEARDOWN
    s, net, clock, ps = mk_loadout_session(2, compiler=C)
    online(s, net, clock, ps[0], 0)
    online(s, net, clock, ps[1], 1)
    s.tryout(ps[0]["player_id"], "assault_rifle")
    start = len(net.pushed)
    s.push_config(force=True)
    after = [(n, k, b) for (n, k, b) in net.pushed[start:] if n == "node0" and k in ("tutorial", "config")]
    assert [k for (_, k, _) in after][:2] == ["tutorial", "config"], [k for (_, k, _) in after]
    assert after[0][2] == {"end": True, "frames": list(TRYOUT_TEARDOWN)}
    assert "$STOP,*" in after[0][2]["frames"]
    assert s.trying == {}
    # the player who was not trying gets no teardown, and nobody gets a second kit `$VOL` from the push
    assert [k for (n, k, _) in net.pushed[start:] if n == "node1" and k == "tutorial"] == []
    assert [k for (_, k, _) in after].count("tutorial") == 1
