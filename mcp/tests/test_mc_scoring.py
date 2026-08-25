"""Scorer — contracts §4 (A5/A6): exact attribution, friendly rule, assists, accuracy, multi-kill,
first blood, parking, feedback freshness, batch re-basing, end freeze, hot-swap shots baseline."""
from brx_mcp.mc.scoring import Scorer
from brx_mcp.mc.types import ASSIST_WINDOW_MS, FEEDBACK_MAX_AGE_MS

T0 = 1_000_000


def _players(mode="tdm"):
    team = (lambda i: "ffa") if mode == "ffa" else (lambda i: "blue" if i % 2 == 0 else "yellow")
    ps = {}
    for i, n in enumerate(["REAPER", "VIPER", "NOMAD", "GHOST"]):
        ps[f"p{i}"] = {"player_id": f"p{i}", "player_num": i + 1, "display": n, "team_id": team(i), "node_id": f"n{i}",
                       "gun_id": None, "loadout": {"weapons": []}, "voice": "male", "ready": True}
    return ps


def _teams(mode="tdm"):
    if mode == "ffa":
        return [{"team_id": "ffa", "name": "FFA", "color": "#fff", "tid": 1}]
    return [{"team_id": "blue", "name": "B", "color": "#00f", "tid": 1}, {"team_id": "yellow", "name": "Y", "color": "#ff0", "tid": 2}]


def mk(mode="tdm", now=None, synced=True, tl=600):
    fb, feed = [], []
    ps = _players(mode)
    sc = Scorer("m1", T0, tl, mode, ps, _teams(mode), {f"n{i}": f"p{i}" for i in range(4)},
                {f"n{i}": synced for i in range(4)}, on_feedback=lambda pid, b: fb.append((pid, b)),
                on_feed=feed.append, now_ms=(lambda: now if now is not None else T0 + 2000))
    return sc, fb, feed


def death(sc, victim_node, victim, shooter_num, t, **kw):
    return sc.ingest(victim_node, {"type": "death", "t": t, "match_id": "m1", "node_id": victim_node, "player_id": victim,
                                   "shooter_num": shooter_num, "shooter_team": 1, **kw}, t)


def hit(sc, victim_node, victim, shooter_num, t, dmg=9):
    return sc.ingest(victim_node, {"type": "hit_taken", "t": t, "match_id": "m1", "node_id": victim_node, "player_id": victim,
                                   "shooter_num": shooter_num, "shooter_team": 1, "dmg": dmg}, t)


def test_exact_kill_credit():
    sc, fb, feed = mk()
    assert death(sc, "n1", "p1", 1, T0 + 1000) == "scored"      # p0 (num 1, blue) kills p1 (yellow)
    rows = {r["player_id"]: r for r in sc.rows()}
    assert rows["p0"]["kills"] == 1 and rows["p1"]["deaths"] == 1
    assert sc.first_blood == "p0" and feed[-1]["tag"] == "FIRST BLOOD"
    assert fb and fb[0][0] == "p0" and fb[0][1]["kind"] == "kill"


def test_shooter_zero_is_no_killer():
    sc, fb, feed = mk()
    death(sc, "n1", "p1", 0, T0 + 1000)
    assert sum(r["kills"] for r in sc.rows()) == 0 and sc.rows()[0]["deaths"] + sum(r["deaths"] for r in sc.rows()) >= 1
    assert not fb


def test_friendly_in_tdm_but_never_in_ffa():
    sc, fb, _ = mk("tdm")
    death(sc, "n2", "p2", 1, T0 + 1000)          # p0 blue kills p2 blue → team-kill
    r = {x["player_id"]: x for x in sc.rows()}
    assert r["p0"]["kills"] == -1 and sc.kills[-1]["friendly"] and not fb
    sc2, fb2, _ = mk("ffa")
    death(sc2, "n2", "p2", 1, T0 + 1000)
    r2 = {x["player_id"]: x for x in sc2.rows()}
    assert r2["p0"]["kills"] == 1 and not sc2.kills[-1]["friendly"] and fb2


def test_assist_window():
    sc, _, _ = mk()
    hit(sc, "n1", "p1", 3, T0 + 1000)                         # p2 hits p1 (in window)
    hit(sc, "n1", "p1", 4, T0 + 5000 - ASSIST_WINDOW_MS - 1)  # p3 too early
    death(sc, "n1", "p1", 1, T0 + 5000)                       # p0 kills p1
    r = {x["player_id"]: x for x in sc.rows()}
    assert r["p2"]["assists"] == 1 and r["p3"]["assists"] == 0 and r["p0"]["assists"] == 0


def test_accuracy_non_friendly_and_stale():
    sc, _, _ = mk()
    sc.ingest_status("n0", {"player_id": "p0", "shots": 10, "alive": True}, T0 + 1000)
    hit(sc, "n1", "p1", 1, T0 + 1100)   # enemy hit counts
    hit(sc, "n2", "p2", 1, T0 + 1200)   # friendly hit does not
    r = {x["player_id"]: x for x in sc.rows()}
    assert r["p0"]["hits"] == 1 and r["p0"]["accuracy"] == 10.0
    assert r["p1"]["accuracy"] is None   # never sent a status this match → "—"


def test_multi_kill_and_streak_tags():
    sc, fb, feed = mk()
    death(sc, "n1", "p1", 1, T0 + 1000)
    death(sc, "n3", "p3", 1, T0 + 2500)   # within MULTI_KILL_MS → double
    assert sc.kills[-1]["multi"] == 2 and feed[-1]["tag"] == "DOUBLE KILL" and fb[-1][1]["kind"] == "multi"
    death(sc, "n1", "p1", 1, T0 + 30000)
    assert feed[-1]["tag"] == "STREAK ×3"


def test_parking_and_dedup():
    sc, _, _ = mk()
    assert sc.ingest("n1", {"type": "death", "t": T0 + 1, "match_id": "OLD", "player_id": "p1", "shooter_num": 1}, T0 + 1) == "parked"
    assert len(sc.parked) == 1 and sum(r["kills"] for r in sc.rows()) == 0
    assert death(sc, "n1", "p1", 1, T0 + 100, ) == "scored"
    assert sc.ingest("n1", {"type": "death", "t": T0 + 200, "match_id": "m1", "player_id": "p1", "shooter_num": 1}, T0 + 200, seq=5) == "scored"
    assert sc.ingest("n1", {"type": "death", "t": T0 + 200, "match_id": "m1", "player_id": "p1", "shooter_num": 1}, T0 + 200, seq=5) == "dup"


def test_feedback_freshness():
    sc, fb, _ = mk(now=T0 + 100_000)
    death(sc, "n1", "p1", 1, T0 + 100_000 - FEEDBACK_MAX_AGE_MS - 1)   # stale death → scored, no flash
    assert sum(r["kills"] for r in sc.rows()) == 1 and not fb
    death(sc, "n3", "p3", 1, T0 + 100_000 - 100)
    assert fb


def test_batch_rebasing_for_unsynced_node_suppresses_awards():
    sc, fb, feed = mk(synced=False, now=T0 + 60_000)
    evs = [{"type": "death", "t": 5_000, "match_id": "m1", "player_id": "p1", "shooter_num": 1},   # raw local clock
           {"type": "death", "t": 6_000, "match_id": "m1", "player_id": "p1", "shooter_num": 1}]
    sc.ingest_batch("n1", evs, T0 + 60_000)
    assert sc.kills[-1]["t"] == T0 + 60_000 and sc.kills[0]["t"] == T0 + 59_000   # re-based, order kept
    r = {x["player_id"]: x for x in sc.rows()}
    assert r["p0"]["kills"] == 2 and sc.kills[-1]["multi"] == 1 and sc.first_blood is None and not fb


def test_winner_ffa_vs_team_and_honors():
    sc, _, _ = mk("ffa")
    death(sc, "n1", "p1", 3, T0 + 1000); death(sc, "n0", "p0", 3, T0 + 9000)
    assert sc.winner() == {"player_id": "p2"}
    h = {x["award"]: x["player_id"] for x in sc.honors()}
    assert h["MVP"] == "p2" and h["MOST KILLS"] == "p2" and h["FIRST BLOOD"] == "p2"
    sc2, _, _ = mk("tdm")
    death(sc2, "n1", "p1", 1, T0 + 1000)
    assert sc2.winner() == {"team_id": "blue"} and sc2.team_scores() == {"blue": 1, "yellow": 0}


def test_end_freeze_parks_post_end_facts():
    sc, _, _ = mk(tl=60)
    death(sc, "n1", "p1", 1, T0 + 10_000)
    assert death(sc, "n1", "p1", 1, T0 + 60_000 + 5_000) == "post_end"     # after go_live + 60 s
    assert sum(r["kills"] for r in sc.rows()) == 1 and sc.recap()["post_end"] == 1
    sc.set_end(T0 + 5_000)                                                  # host end earlier
    assert death(sc, "n3", "p3", 1, T0 + 8_000) == "post_end"


def test_hot_swap_shots_baseline():
    sc, _, _ = mk()
    sc.ingest_status("n0", {"player_id": "p0", "shots": 40, "alive": True}, T0 + 1000)
    sc.rebind_node("p0")
    sc.ingest_status("n9", {"player_id": "p0", "shots": 5, "alive": True}, T0 + 2000)
    assert sc.shots_total("p0") == 45 and next(r for r in sc.rows() if r["player_id"] == "p0")["shots_total"] == 45


def test_csv_and_missing():
    sc, _, _ = mk()
    death(sc, "n1", "p1", 1, T0 + 1000)
    assert "REAPER" in sc.csv() and "p1" not in sc.missing() and "p2" in sc.missing()
