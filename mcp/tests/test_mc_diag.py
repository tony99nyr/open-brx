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


def test_perk_aware_hp_armor_mismatch_rule():
    r = diag.build_report(sqlite3.connect(f"file:{_hand_built_db()}?mode=ro", uri=True))
    nodes = r[0]["nodes"]
    # nodeA: exact match on both — no flags
    assert nodes["nodeA"]["hp_mismatch"] is False and nodes["nodeA"]["armor_mismatch"] is False
    assert nodes["nodeA"]["max_hp"] == 70 and nodes["nodeA"]["max_armor"] == 60
    # nodeB: armor ABOVE config (perk) — never flagged, even though it does not equal cfg+any fixed delta
    assert nodes["nodeB"]["max_armor"] == 110 and nodes["nodeB"]["armor_mismatch"] is False
    assert nodes["nodeB"]["hp_mismatch"] is False
    # nodeC: hp below config (genuine) AND armor below config (genuine) — both flagged
    assert nodes["nodeC"]["max_hp"] == 45 and nodes["nodeC"]["hp_mismatch"] is True
    assert nodes["nodeC"]["max_armor"] == 30 and nodes["nodeC"]["armor_mismatch"] is True


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
