"""T1-B: `brx_mcp.mc.diag` — the post-match diagnostic that reproduces, as one read-only pass over a
session store, the by-hand analysis of the 2026-09-12 field session (docs/experiment-log). Two
fixtures: a hand-built minimal db (full control over the edge cases — the perk-aware hp/armor rule,
the nested `event_batch` hit count, a stale `ack_config`) and a REAL match played end to end through
`Session` + `FakeNet` (the MC-layer fake game runner — the same idea as `test_fake_game.py`'s
FakeTagger, one level up: fake NODES instead of a fake gun) against a real `Store`, so the numbers
diag reports are checked against the actual writer, not against another hand-typed fixture.

Never touches `~/.brx-mcp`: every db here is built fresh under a tmp dir.
"""
import contextlib
import io
import json
import pathlib
import sqlite3
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from brx_mcp.mc import diag
from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.state import Session
from brx_mcp.mc.store import Store

T0 = 5_000_000


def _tmp_db() -> pathlib.Path:
    return pathlib.Path(tempfile.mkdtemp()) / "session.sqlite"


# ---------------------------------------------------------------- hand-built fixture ---- #

def _hand_built_db() -> pathlib.Path:
    """One match, three nodes, by hand: control over exactly the shapes diag must get right."""
    path = _tmp_db()
    st = Store("sess-1", path)
    cfg = {"config_id": "cfg-A", "mode": "tdm", "environment": "outdoor",
           "health": {"max_hp": 70, "max_armor": 60}}
    go_live, ended = 1_000_000, 1_100_000
    st.match_started("m1", cfg, go_live)

    # ack_config: nodeA is CURRENT (acked cfg-A before go-live); nodeB acked a STALE id; nodeC never acked.
    st.log("nodeA", "ack_config", None, None, go_live - 5000, None, False,
           {"node_id": "nodeA", "config_id": "cfg-A", "ok": True, "gun_echo": "$ALCD,10,100,0,90,0,*"})
    st.log("nodeB", "ack_config", None, None, go_live - 4000, None, False,
           {"node_id": "nodeB", "config_id": "cfg-OLD", "ok": True, "gun_echo": "$ALCD,10,100,0,90,0,*"})

    # status: nodeA hp/armor exactly at config (no mismatch); nodeB armor ABOVE config (body_armor perk,
    # must NOT be flagged) with hp matching; nodeC hp BELOW config (a genuine mismatch, must be flagged)
    # and armor also below (also flagged — armor below config is never perk-explained).
    def status(nid, hp, armor, arm_state, alive, linked, shots, t):
        st.log(nid, "status", None, None, t, "m1", False,
               {"node_id": nid, "match_id": "m1", "hp": hp, "armor": armor, "arm_state": arm_state,
                "alive": alive, "shots": shots, "preflight": {"gun_linked": linked}})

    status("nodeA", 70, 60, "live", True, True, 40, go_live + 1000)
    status("nodeA", 70, 60, "live", True, True, 55, go_live + 2000)
    status("nodeB", 70, 110, "live", True, True, 30, go_live + 1000)     # +50 armor: body_armor perk
    status("nodeB", 70, 110, "kitted", False, False, 30, go_live + 500)  # one unlinked/kitted sample too
    status("nodeC", 45, 30, "live", True, False, 10, go_live + 1000)     # hp AND armor below config

    # hits: two rows logged directly as hit_taken, one nested inside an event_batch row (defensive shape)
    st.log("nodeC", "hit_taken", 1, go_live + 1500, go_live + 1501, "m1", False,
           {"type": "hit_taken", "match_id": "m1", "shooter_num": 1, "shooter_team": 1, "dmg": 18})
    st.log("nodeC", "hit_taken", 2, go_live + 1600, go_live + 1601, "m1", False,
           {"type": "hit_taken", "match_id": "m1", "shooter_num": 1, "shooter_team": 1, "dmg": 18})
    st.log("nodeB", "event_batch", None, None, go_live + 1700, "m1", False,
           {"events": [{"type": "hit_taken", "match_id": "m1", "shooter_num": 2, "shooter_team": 2, "dmg": 18},
                       {"type": "respawn", "match_id": "m1"}]})   # a non-hit fact in the same batch must not be counted
    st.log("nodeC", "death", 3, go_live + 1650, go_live + 1651, "m1", False,
           {"type": "death", "match_id": "m1", "shooter_num": 1, "shooter_team": 1})

    st.match_ended("m1", {"winner": {"team_id": "1"}})
    st.db.execute("UPDATE matches SET ended_t=? WHERE match_id='m1'", (ended,))
    st.db.commit()
    st.close()
    return path


def test_hand_built_totals_and_shots_max_per_node():
    r = diag.build_report(sqlite3.connect(f"file:{_hand_built_db()}?mode=ro", uri=True))
    assert len(r) == 1
    m = r[0]
    assert m["match_id"] == "m1" and m["mode"] == "tdm" and m["config_id"] == "cfg-A" and m["environment"] == "outdoor"
    assert m["cfg_health"] == {"max_hp": 70, "max_armor": 60}
    assert m["duration_s"] == 100.0
    # shots = max(shots) PER NODE, summed: nodeA 55, nodeB 30, nodeC 10
    assert m["shots"] == 95, m


def test_hits_count_both_direct_and_event_batch_nested_and_ignore_non_hit_facts():
    r = diag.build_report(sqlite3.connect(f"file:{_hand_built_db()}?mode=ro", uri=True))
    m = r[0]
    assert m["hits"] == 3, "2 direct hit_taken rows + 1 nested in event_batch, the respawn in the same batch excluded"
    assert m["hit_pct"] == round(100 * 3 / 95, 1)
    assert m["deaths"] == 1
    assert m["shooter_team_values"] == [1, 2]


def test_perk_aware_hp_armor_mismatch_rule_vs_the_config():
    """The `_vs_cfg` pair. C-3 renamed these: `config.health` is the NARROW question -- it never
    carries a per-player override -- and the column now says which question it answered."""
    r = diag.build_report(sqlite3.connect(f"file:{_hand_built_db()}?mode=ro", uri=True))
    nodes = r[0]["nodes"]
    # nodeA: exact match on both — no flags
    assert nodes["nodeA"]["hp_mismatch_vs_cfg"] is False and nodes["nodeA"]["armor_mismatch_vs_cfg"] is False
    assert nodes["nodeA"]["max_hp"] == 70 and nodes["nodeA"]["max_armor"] == 60
    # nodeB: armor ABOVE config (perk) — never flagged, even though it does not equal cfg+any fixed delta
    assert nodes["nodeB"]["max_armor"] == 110 and nodes["nodeB"]["armor_mismatch_vs_cfg"] is False
    assert nodes["nodeB"]["hp_mismatch_vs_cfg"] is False
    # nodeC: hp below config (genuine) AND armor below config (genuine) — both flagged
    assert nodes["nodeC"]["max_hp"] == 45 and nodes["nodeC"]["hp_mismatch_vs_cfg"] is True
    assert nodes["nodeC"]["max_armor"] == 30 and nodes["nodeC"]["armor_mismatch_vs_cfg"] is True


def _override_db() -> pathlib.Path:
    """C-3: one match where a PER-PLAYER override explains the whole "mismatch".

    `LoadoutOverrides.max_hp/max_armor` are baked into the pushed `$PSET` and never into
    `config.health`, so a node playing with one reports a pool the config does not name — and the
    old `hp_mismatch` flagged it in every single match of that game. The head MC actually pushed is
    persisted beside the config (`state.py _schedule` writes `config["_heads"][player_id]`), so the
    per-node truth is right there to compare against.
    """
    path = _tmp_db()
    st = Store("sess-3", path)
    cfg = {"config_id": "cfg-O", "mode": "tdm", "environment": "indoor",
           "health": {"max_hp": 70, "max_armor": 60},
           # nodeP's player carries max_hp 100; nodeQ's is the plain config pool
           "_heads": {"pA": ["$START,*", "$PSET,1,0,100,60,0,*"], "pB": ["$START,*", "$PSET,2,0,70,60,0,*"]}}
    go_live = 1_000_000
    st.match_started("mO", cfg, go_live)

    def status(nid, pid, hp, armor, arm_state, alive, t):
        st.log(nid, "status", None, None, t, "mO", False,
               {"node_id": nid, "player_id": pid, "match_id": "mO", "hp": hp, "armor": armor,
                "arm_state": arm_state, "alive": alive, "shots": 1, "preflight": {"gun_linked": True}})

    # nodeP: armed first (not live), then the first LIVE frame of its first life, then damaged.
    status("nodeP", "pA", 100, 60, "armed", True, go_live - 500)
    status("nodeP", "pA", 100, 60, "live", True, go_live + 1000)
    status("nodeP", "pA", 64, 0, "live", True, go_live + 4000)
    # nodeQ: a stale head — it spawned into 45/115, which is neither the config nor what it was pushed
    status("nodeQ", "pB", 45, 115, "live", True, go_live + 1000)
    status("nodeQ", "pB", 45, 115, "live", True, go_live + 4000)
    st.match_ended("mO", {"winner": {}})
    st.db.execute("UPDATE matches SET ended_t=? WHERE match_id='mO'", (go_live + 60_000,))
    st.db.commit()
    st.close()
    return path


def test_a_per_player_override_is_not_reported_as_a_mismatch():
    """C-3. The pair is reported, and the boolean says WHICH question it answers."""
    r = diag.build_report(sqlite3.connect(f"file:{_override_db()}?mode=ro", uri=True))
    n = r[0]["nodes"]
    # The pair, both halves, per node: what the config said and what this node was actually pushed.
    assert n["nodeP"]["cfg_health"] == {"max_hp": 70, "max_armor": 60}
    assert n["nodeP"]["pushed_pool"] == {"hp": 100, "armor": 60}, n["nodeP"]
    assert (n["nodeP"]["max_hp"], n["nodeP"]["max_armor"]) == (100, 60)
    # vs the CONFIG this looks wrong, and the column name now says that is the question it asked…
    assert n["nodeP"]["hp_mismatch_vs_cfg"] is True
    # …and vs the head that was actually pushed, it is exactly right.
    assert n["nodeP"]["hp_mismatch_vs_pushed"] is False and n["nodeP"]["armor_mismatch_vs_pushed"] is False
    # nodeQ really was on another head: neither the config nor its own push explains 45/115.
    assert n["nodeQ"]["pushed_pool"] == {"hp": 70, "armor": 60}
    assert n["nodeQ"]["hp_mismatch_vs_pushed"] is True and n["nodeQ"]["armor_mismatch_vs_pushed"] is True


def test_no_persisted_head_means_no_claim_about_the_push():
    """The hand-built fixture has no `_heads` — a pre-A36 store, or a match MC never compiled for.
    `None`, never a guess, and the `vs_cfg` columns still do their (narrower) job."""
    n = diag.build_report(sqlite3.connect(f"file:{_hand_built_db()}?mode=ro", uri=True))[0]["nodes"]
    assert n["nodeB"]["pushed_pool"] is None
    assert n["nodeB"]["hp_mismatch_vs_pushed"] is None and n["nodeB"]["armor_mismatch_vs_pushed"] is None
    assert n["nodeC"]["hp_mismatch_vs_cfg"] is True


def test_first_settled_pool_of_the_first_life_is_reported():
    """C-4: the exact signature the A36 pool check was built for, which `max` cannot see — a node
    that spawned into the WRONG pool and then self-corrected has a clean `max` and a damning first
    frame. Taken from the first `status` with `arm_state: live` and `alive: true`."""
    r = diag.build_report(sqlite3.connect(f"file:{_override_db()}?mode=ro", uri=True))
    n = r[0]["nodes"]
    # not the `armed` frame that preceded it, and not the damaged one that followed
    assert n["nodeP"]["first_live_pool"] == {"hp": 100, "armor": 60}, n["nodeP"]
    assert n["nodeQ"]["first_live_pool"] == {"hp": 45, "armor": 115}
    # and a node that never reported a live frame makes no claim
    n2 = diag.build_report(sqlite3.connect(f"file:{_hand_built_db()}?mode=ro", uri=True))[0]["nodes"]
    assert n2["nodeA"]["first_live_pool"] == {"hp": 70, "armor": 60}
    assert diag.render_markdown(r).count("first_live") >= 1


def test_arm_state_alive_and_gun_linked_distributions_per_node():
    r = diag.build_report(sqlite3.connect(f"file:{_hand_built_db()}?mode=ro", uri=True))
    nodes = r[0]["nodes"]
    assert nodes["nodeA"]["arm_state_counts"] == {"live": 2}
    assert nodes["nodeA"]["alive_counts"] == {"true": 2, "false": 0}
    assert nodes["nodeA"]["gun_linked_counts"] == {"true": 2, "false": 0, "none": 0}
    assert nodes["nodeB"]["arm_state_counts"] == {"live": 1, "kitted": 1}
    assert nodes["nodeB"]["alive_counts"] == {"true": 1, "false": 1}
    assert nodes["nodeB"]["gun_linked_counts"] == {"true": 1, "false": 1, "none": 0}
    assert nodes["nodeC"]["gun_linked_counts"] == {"true": 0, "false": 1, "none": 0}


def test_ack_config_vs_match_config_id_current_stale_and_missing():
    r = diag.build_report(sqlite3.connect(f"file:{_hand_built_db()}?mode=ro", uri=True))
    nodes = r[0]["nodes"]
    assert nodes["nodeA"]["ack_config_id"] == "cfg-A" and nodes["nodeA"]["ack_matches_config"] is True
    assert nodes["nodeB"]["ack_config_id"] == "cfg-OLD" and nodes["nodeB"]["ack_matches_config"] is False
    assert nodes["nodeC"]["ack_config_id"] is None and nodes["nodeC"]["ack_matches_config"] is None


def test_match_filter_and_json_and_markdown_render():
    path = _hand_built_db()
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    assert diag.build_report(db, match_id="nope") == []
    r = diag.build_report(db, match_id="m1")
    assert len(r) == 1 and r[0]["match_id"] == "m1"
    md = diag.render_markdown(r)
    assert "m1" in md and "tdm" in md and "nodeA" in md and "nodeC" in md
    js = json.loads(json.dumps(r))          # the report must be JSON-safe as-is
    assert js[0]["match_id"] == "m1"


def _run_cli(argv):
    """`run_tests.py` is not pytest -- no `capsys` fixture -- so capture stdout by hand."""
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = diag.main(argv)
    return rc, buf.getvalue()


def test_cli_end_to_end_on_the_hand_built_db():
    path = _hand_built_db()
    rc, out = _run_cli([str(path)])
    assert rc == 0 and "m1" in out and "|" in out
    rc, out = _run_cli([str(path), "--json"])
    assert rc == 0 and json.loads(out)[0]["match_id"] == "m1"
    rc, _ = _run_cli([str(path), "--match", "does-not-exist"])
    assert rc == 1


def test_cli_missing_file_is_a_clean_error():
    rc, _ = _run_cli([str(pathlib.Path(tempfile.mkdtemp()) / "nope.sqlite")])
    assert rc == 2


# ---------------------------------------------------------------- fake-game-runner fixture ---- #
# The MC-layer analogue of `test_fake_game.py`'s FakeTagger: fake NODES (FakeNet) instead of a fake
# gun, driving a real `Session` wired to a real `Store` through one full match — so diag's numbers
# are checked against the actual writer (`state.py` -> `store.py`), not a second hand-typed fixture.

def _play_one_real_match(db_path: pathlib.Path) -> tuple[str, str]:
    clock = {"t": T0}
    net = FakeNet()
    store = Store("sess-2", db_path)
    s = Session(FakeCompiler(), net, FakeArmory(demo_armory()), store=store, now_ms=lambda: clock["t"])
    s.set_config({"mode": "ffa", "time_limit_s": 60, "scoring": {"frag_limit": 1}})
    ps = [s.add_player(f"OP{i}", gun_id=f"GUN-{chr(65 + i)}") for i in range(2)]

    def online(i, p):
        tail = demo_armory()[i]["ble"]["tail"]
        net.simulate_hello(f"node{i}", f"GUN-{chr(65 + i)}-{tail}")
        net.simulate_status(f"node{i}", {"player_id": p["player_id"], "hp": 45, "armor": 70, "ammo": 36,
                                         "alive": True, "shots": 3, "arm_state": "kitted", "synced": True,
                                         "preflight": {"gun_linked": True}}, clock["t"])

    for i, p in enumerate(ps):
        online(i, p)
        s.set_ready(p["player_id"], True, host_override=True)
    s.push_config(force=True)
    for i in range(2):
        net.simulate_node_message(f"node{i}", "ack_config",
                                  {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD"}, clock["t"])
    info = s.start(runway_s=1)
    mid = info["match_id"]
    clock["t"] += 2000
    s.tick()
    net.simulate_status("node0", {"player_id": ps[0]["player_id"], "hp": 45, "armor": 70, "ammo": 30,
                                  "alive": True, "shots": 6, "arm_state": "live", "match_id": mid,
                                  "preflight": {"gun_linked": True}}, clock["t"])
    net.simulate_event("node1", {"type": "hit_taken", "t": clock["t"], "match_id": mid,
                                 "shooter_num": ps[0]["player_num"], "shooter_team": ps[0]["player_num"], "dmg": 18},
                       clock["t"])
    net.simulate_event("node1", {"type": "death", "t": clock["t"], "match_id": mid,
                                 "shooter_num": ps[0]["player_num"], "shooter_team": ps[0]["player_num"]}, clock["t"])
    s.control("end", confirm=True)
    store.close()
    return mid, s.config["config_id"]


def test_diag_against_a_real_session_played_through_fakenet():
    path = _tmp_db()
    mid, cfg_id = _play_one_real_match(path)
    r = diag.build_report(sqlite3.connect(f"file:{path}?mode=ro", uri=True))
    assert len(r) == 1
    m = r[0]
    assert m["match_id"] == mid and m["mode"] == "ffa" and m["config_id"] == cfg_id
    assert m["hits"] == 1 and m["deaths"] == 1
    assert m["shots"] >= 6                                  # node0's later, higher status.shots sample won
    assert m["nodes"]["node0"]["ack_config_id"] == cfg_id
    assert m["nodes"]["node0"]["ack_matches_config"] is True
