"""S56 ("what hit me") -- MC half: the `feedback{kind:"hit"}` relay to the SHOOTER's own node.

A victim's own gun already tells its phone it was hit (`$HIR`). What that phone does NOT know is
whose gun it was, unless the shooter's own weapon carries a magnitude no other rostered weapon
shares. So MC relays the shooter's own `hit_taken` fact back to the SHOOTER'S node, best-effort --
no queue, no retry, exactly like the existing "kill" feedback (`scoring.Scorer._death`) -- so both
phones can show the same trade. `state.Session._relay_hit_feedback`/`_relay_batch_hits`."""
from test_mc_block_b import go_live, mk, online


def _hits(net):
    return [b for _n, _k, b in net.pushes("feedback") if b.get("kind") == "hit"]


def test_a_live_hit_relays_once_to_the_shooters_node():
    """The BATCH path (`ingest_batch`): no `weapon_id` here on purpose -- `Scorer.ingest_batch` sorts
    and re-times events before scoring them, so pairing a `hits_log` entry back to the wire event
    that produced it is not reliable (see `_relay_batch_hits`); `weapon_id` is optional on the wire
    and the single-fact path below is where it actually gets attached."""
    s, net, clock, ps, info = go_live(2)
    shooter, victim = ps[0], ps[1]
    clock["t"] += 1000
    ev = {"type": "hit_taken", "t": clock["t"], "match_id": info["match_id"], "player_id": victim["player_id"],
          "shooter_num": shooter["player_num"], "dmg": 9, "weapon_id": "assault_rifle", "seq": 1}
    s.ingest_batch("node1", [ev], clock["t"])
    hits = _hits(net)
    assert len(hits) == 1, hits
    body = hits[0]
    assert body["player_id"] == shooter["player_id"] and body["t"] == clock["t"]
    assert body["victim"] == victim["player_id"] and body["victim_num"] == victim["player_num"]
    assert body["victim_display"] == victim["display"]
    assert body["dmg"] == 9 and "weapon_id" not in body


def test_a_duplicate_seq_never_relays_twice():
    s, net, clock, ps, info = go_live(2)
    shooter, victim = ps[0], ps[1]
    clock["t"] += 1000
    ev = {"type": "hit_taken", "t": clock["t"], "match_id": info["match_id"], "player_id": victim["player_id"],
          "shooter_num": shooter["player_num"], "dmg": 9, "seq": 5}
    s.ingest_batch("node1", [dict(ev)], clock["t"])
    s.ingest_batch("node1", [dict(ev)], clock["t"] + 10)     # a replayed fact, same seq
    assert len(_hits(net)) == 1


def test_no_relay_outside_live():
    """`start()` schedules the scorer at ARMED, ahead of the countdown -- a hit fact landing before
    go-live (which the real protocol should never send, but a test can force) must still score
    normally, purely because MC's relay is gated on `phase`, not on the scorer merely existing."""
    s, net, clock, ps = mk(2)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    s.push_config()
    for i in range(2):
        net.simulate_node_message(f"node{i}", "ack_config",
                                  {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD"}, clock["t"])
    info = s.start(runway_s=10)
    assert s.phase == "armed"
    shooter, victim = ps[0], ps[1]
    ev = {"type": "hit_taken", "t": clock["t"], "match_id": info["match_id"], "player_id": victim["player_id"],
          "shooter_num": shooter["player_num"], "dmg": 9, "seq": 1}
    s.ingest_batch("node1", [ev], clock["t"])
    assert s.scorer.hits_log, "the fact should still be scored"
    assert not _hits(net), "but never relayed outside LIVE"


def test_no_relay_for_an_unknown_shooter():
    s, net, clock, ps, info = go_live(2)
    victim = ps[1]
    clock["t"] += 1000
    ev = {"type": "hit_taken", "t": clock["t"], "match_id": info["match_id"], "player_id": victim["player_id"],
          "shooter_num": 99, "dmg": 9, "seq": 1}          # no player holds num 99
    s.ingest_batch("node1", [ev], clock["t"])
    assert not s.scorer.hits_log
    assert not _hits(net)


def test_no_relay_for_a_self_inflicted_hit():
    s, net, clock, ps, info = go_live(2)
    victim = ps[1]
    clock["t"] += 1000
    ev = {"type": "hit_taken", "t": clock["t"], "match_id": info["match_id"], "player_id": victim["player_id"],
          "shooter_num": victim["player_num"], "dmg": 9, "seq": 1}   # shot themselves (a grenade, say)
    s.ingest_batch("node1", [ev], clock["t"])
    assert not s.scorer.hits_log       # scoring.py's own hit_taken branch already excludes shooter==victim
    assert not _hits(net)


def test_a_single_fact_over_the_event_path_relays_too():
    """`_on_event` is the single-fact path (as opposed to `ingest_batch`); it must carry the same relay."""
    s, net, clock, ps, info = go_live(2)
    shooter, victim = ps[0], ps[1]
    clock["t"] += 1000
    ev = {"type": "hit_taken", "t": clock["t"], "match_id": info["match_id"], "player_id": victim["player_id"],
          "shooter_num": shooter["player_num"], "dmg": 20, "weapon_id": "shotgun", "shot_group": 4, "seq": 9}
    s._on_event("node1", ev, clock["t"])
    body = _hits(net)[0]
    assert body["dmg"] == 20 and body["weapon_id"] == "shotgun" and body["player_id"] == shooter["player_id"]
    # a two-word shot is two facts: the shooter's phone counts it once by the victim's shot_group
    assert body["shot_group"] == 4
