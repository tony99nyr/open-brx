"""Field, twice in one day (2026-09-19): MC kept a node's ghost around after the same physical phone
rejoined under a NEW node_id (its app storage cleared, or -- the ITEMS-panel twin of this bug, see
`test_mc_stations.test_a_stale_station_reads_offline_and_refuses_a_new_assignment` -- a station that
reopened as a player). The old node_id's record sat in `self.nodes` reading `gun_linked: True`,
`arm_state: "kitted"`, green/connected, for as long as nobody looked at `last_seen_ms` -- because
nothing in the console did.

Two fixes, both here:
  1. `State.snapshot()`'s `nodes` rows now carry the net layer's own `stale` flag (STALE_AFTER_MS = 8 s
     of silence), so a client reads MC's judgement instead of inventing its own threshold.
  2. When a NEW node reports the same gun a STALE other node still claims, the stale record's claim is
     released -- the gun belongs to the live node, and ARMORY must not carry two rows for one gun.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from test_mc_state import mk, online


def _node(s, node_id):
    return next(n for n in s.snapshot()["nodes"] if n["node_id"] == node_id)


def test_snapshot_carries_the_nets_own_stale_flag_per_node():
    s, net, clock, ps = mk(1)
    online(s, net, clock, ps[0], 0)
    assert _node(s, "node0")["stale"] is False, "a node just heard from is not stale"
    net.simulate_stale("node0", 9_000)
    assert _node(s, "node0")["stale"] is True
    net.simulate_return("node0")
    assert _node(s, "node0")["stale"] is False


def test_a_rejoined_gun_releases_the_stale_nodes_claim_and_armory_shows_one_row():
    """Break it once: before the fix, `node0`'s `gun_name`/`gun_tail` were never cleared, so the
    snapshot carried TWO rows claiming `GUN-A-<tail>` -- the live `node0b` and the stale ghost `node0`
    still reading LINKED/KITTED off last session's data. The dedup below is exactly what used to be
    missing, and the ghost's own fields (asserted absent) are exactly what used to still be there."""
    s, net, clock, ps = mk(1)
    p = ps[0]
    online(s, net, clock, p, 0)
    tail = next(n for n in s.snapshot()["nodes"] if n["node_id"] == "node0")["gun_tail"]
    gun_name = f"GUN-A-{tail}"
    assert p["node_id"] == "node0"
    assert _node(s, "node0")["gun_name"] == gun_name

    # node0 goes quiet (app storage cleared, or the phone walked off) -- the net layer flags it stale
    net.simulate_stale("node0", 9_000)
    assert _node(s, "node0")["stale"] is True

    # ...and the SAME gun rejoins under a brand-new node_id
    net.simulate_hello("node0b", gun_name)

    # the player follows the gun to the live node
    assert p["node_id"] == "node0b"
    # the stale ghost no longer claims the gun
    ghost = _node(s, "node0")
    assert ghost.get("gun_name") is None and ghost.get("gun_tail") is None, ghost
    assert ghost["stale"] is True, "the ghost record is kept (it may come back), just unclaimed"
    # exactly one row on the snapshot claims this gun
    claimants = [n["node_id"] for n in s.snapshot()["nodes"] if n.get("gun_name") == gun_name]
    assert claimants == ["node0b"], claimants


def test_a_fresh_other_nodes_claim_survives_a_second_hello():
    """The dedup only touches a STALE other record -- a FRESH holder is net.py's `_claim_gun`/A8 gun
    rule to arbitrate (it may legitimately refuse the newcomer's hello), and this must never race ahead
    of that by unclaiming a gun a live, contested holder still rightfully has."""
    s, net, clock, ps = mk(1)
    p = ps[0]
    online(s, net, clock, p, 0)
    tail = _node(s, "node0")["gun_tail"]
    gun_name = f"GUN-A-{tail}"
    # node0 is NOT stale -- a second node reporting the same gun must not clear node0's claim
    net.simulate_hello("node0b", gun_name)
    assert _node(s, "node0").get("gun_name") == gun_name, "a fresh holder's claim must survive"
