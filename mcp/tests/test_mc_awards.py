"""A63 (Tony 2026-09-24): the KILLJOY medal and the end-of-match awards table (`types.AWARDS`).

Every rule here was broken once on purpose to watch its test fail."""
from brx_mcp.mc.scoring import Scorer
from brx_mcp.mc.types import AWARDS, MEDALS

T0 = 1_000_000
END = T0 + 300_000


def _players(n, mode):
    team = (lambda i: "ffa") if mode == "ffa" else (lambda i: "blue" if i % 2 == 0 else "yellow")
    return {f"p{i}": {"player_id": f"p{i}", "player_num": i + 1, "display": f"P{i}", "team_id": team(i),
                      "node_id": f"n{i}", "gun_id": None, "loadout": {"weapons": []}, "voice": "male", "ready": True}
            for i in range(n)}


def mk(n=4, mode="tdm", end=END, unsynced=()):
    teams = ([{"team_id": "ffa", "name": "FFA", "color": "#fff", "tid": 1}] if mode == "ffa" else
             [{"team_id": "blue", "name": "B", "color": "#00f", "tid": 1},
              {"team_id": "yellow", "name": "Y", "color": "#ff0", "tid": 3}])
    sc = Scorer("m1", T0, 600, mode, _players(n, mode), teams, {f"n{i}": f"p{i}" for i in range(n)},
                {f"n{i}": i not in unsynced for i in range(n)}, now_ms=lambda: T0 + 1000)
    if end is not None:
        sc.set_end(end)
    return sc


def ev(sc, victim_i, kind, t, **kw):
    return sc.ingest(f"n{victim_i}", {"type": kind, "t": t, "match_id": "m1", "player_id": f"p{victim_i}", **kw}, t)


def kill(sc, killer_i, victim_i, t, **kw):
    return ev(sc, victim_i, "death", t, shooter_num=killer_i + 1, shooter_team=1, **kw)


def respawn(sc, i, t):
    return ev(sc, i, "respawn", t)


def honors(sc, key):
    return sorted(h["player_id"] for h in sc.honors() if h["key"] == key)


def stat(sc, key, pid):
    return next(h["stat"] for h in sc.honors() if h["key"] == key and h["player_id"] == pid)


# ── KILLJOY ──────────────────────────────────────────────────────────────────────────────────────
def test_killjoy_is_in_medals_as_text_only():
    row = next(m for m in MEDALS if m["key"] == "killjoy")
    spree = next(m for m in MEDALS if m["key"] == "killing_spree")
    assert row == {"key": "killjoy", "kind": "killjoy", "count": 5, "label": "KILLJOY", "clip": None, "clip_ms": None}
    assert row["count"] == spree["count"], "the Killing Spree threshold"


def _spree(sc, n, t=T0 + 10_000):
    """p1 (yellow) kills p0 (blue) n times, 10 s apart, respawning p0 each time: p1's streak is n."""
    for i in range(n):
        kill(sc, 1, 0, t + i * 10_000)
        respawn(sc, 0, t + i * 10_000 + 5000)
    return t + n * 10_000


def test_killjoy_needs_the_victim_on_the_spree_threshold():
    sc = mk()
    t = _spree(sc, 4)
    kill(sc, 2, 1, t)                                     # p2 (blue) ends a four-kill streak
    assert "killjoy" not in sc.kills[-1]["medals"], sc.kills[-1]
    sc = mk()
    t = _spree(sc, 5)
    kill(sc, 2, 1, t)                                     # ...and a five-kill one
    assert "killjoy" in sc.kills[-1]["medals"], sc.kills[-1]
    assert "KILLJOY" in next(r for r in sc.rows() if r["player_id"] == "p2")["medals"]


def test_killjoy_stacks_with_the_chain_melee_and_streak_medals():
    sc = mk()
    _spree(sc, 5)                                         # p1's streak: 5, by t = 50 s
    for k in range(4):                                    # p2 kills p3 at 60..90 s: p2's streak 4
        kill(sc, 2, 3, T0 + 60_000 + k * 10_000)
        respawn(sc, 3, T0 + 65_000 + k * 10_000)
    kill(sc, 2, 1, T0 + 90_500, melee=True)               # 0.5 s later: a double, a melee, a killjoy, a spree
    assert sc.kills[-1]["medals"] == ["double_kill", "melee_kill", "killjoy", "killing_spree"], sc.kills[-1]["medals"]


def test_killjoy_never_for_a_team_kill_or_a_self_kill():
    sc = mk()
    t = _spree(sc, 5)
    kill(sc, 3, 1, t)                                    # p3 is p1's teammate (yellow): a team kill
    assert "killjoy" not in (sc.kills[-1].get("medals") or []), sc.kills[-1]
    sc = mk()
    t = _spree(sc, 5)
    kill(sc, 1, 1, t)                                    # p1 shoots themselves
    assert "killjoy" not in (sc.kills[-1].get("medals") or []), sc.kills[-1]


# ── the AWARDS table ─────────────────────────────────────────────────────────────────────────────
def test_every_honor_row_carries_its_awards_key_and_label():
    sc = mk()
    t = _spree(sc, 5)
    kill(sc, 2, 1, t)
    got = sc.honors()
    assert got
    labels = {a["key"]: a["label"] for a in AWARDS}
    assert all(h["award"] == labels[h["key"]] for h in got), got
    order = [a["key"] for a in AWARDS]
    assert [h["key"] for h in got] == sorted((h["key"] for h in got), key=order.index), "AWARDS order"
    assert {"rule", "tie"} <= set(AWARDS[0]), "every row names its rule and its tie"


def test_no_awards_under_three_scored_players():
    sc = mk(n=2, mode="ffa")
    kill(sc, 0, 1, T0 + 1000)
    assert sc.honors() == []
    sc = mk(n=3, mode="ffa")
    kill(sc, 0, 1, T0 + 1000)
    assert sc.honors(), "control: three players do get honors"


def test_a_level_mvp_is_shared_as_two_rows():
    sc = mk()
    kill(sc, 0, 1, T0 + 10_000); kill(sc, 1, 0, T0 + 20_000); kill(sc, 0, 3, T0 + 30_000); kill(sc, 1, 2, T0 + 40_000)
    rows = [h for h in sc.honors() if h["key"] == "mvp"]
    assert sorted(h["player_id"] for h in rows) == ["p0", "p1"] and all(h["award"] == "MVP" for h in rows)


def test_most_kills_tie_is_shared():
    sc = mk()
    kill(sc, 0, 1, T0 + 10_000); kill(sc, 1, 0, T0 + 20_000)
    assert honors(sc, "most_kills") == ["p0", "p1"]
    kill(sc, 0, 3, T0 + 30_000)
    assert honors(sc, "most_kills") == ["p0"]


# ── integration review 2026-09-25: a late flush and a frozen team kill ───────────────────────────
def test_review1_a_late_flushed_kill_never_counts_as_a_multi_kill():
    sc = mk(n=6, mode="ffa")
    kill(sc, 0, 1, T0 + 100_000)
    kill(sc, 0, 2, T0 + 10_000)                           # flushed late: 90 s older than the newest kill
    assert "double_kill" not in sc.kills[-1]["medals"], sc.kills[-1]
    kill(sc, 0, 3, T0 + 98_500)                           # late by 1.5 s (past CLOCK_TIE_MS), inside the window: no chain
    assert "double_kill" not in sc.kills[-1]["medals"], sc.kills[-1]
    assert sc.stats["p0"].last_kill_t == T0 + 100_000, "the chain clock never moves back"
    kill(sc, 0, 4, T0 + 101_000)                          # a fresh kill 1 s after the newest: a double
    assert sc.kills[-1]["medals"] == ["double_kill"], sc.kills[-1]
    assert sc.stats["p0"].multi_best == 2


def test_polish_two_kills_a_moment_apart_that_arrive_swapped_still_make_a_double():
    """Polish r1: phones report independently and their clocks agree only to under 1 s (contracts §7), so two
    kills 200 ms apart often arrive swapped. Inside CLOCK_TIE_MS that is still a double, in either order."""
    for order in ((10_200, 10_000), (10_000, 10_200)):
        sc = mk(n=6, mode="ffa")
        kill(sc, 0, 1, T0 + order[0])
        kill(sc, 0, 2, T0 + order[1])
        assert sc.kills[-1]["medals"] == ["double_kill"], (order, sc.kills[-1])
        assert sc.stats["p0"].last_kill_t == T0 + 10_200


def test_review2_a_frozen_team_kill_keeps_the_victims_death():
    sc = mk()
    kill(sc, 0, 1, T0 + 10_000)
    sc.cap_recv = T0 + 20_000                             # the frag-cap whistle
    kills_before = sc.stats["p2"].kills
    r = sc.ingest("n0", {"type": "death", "t": T0 + 15_000, "match_id": "m1", "player_id": "p0",
                         "shooter_num": 3, "shooter_team": 1}, T0 + 25_000)   # p2 team-kills p0, flushed after it
    assert r == "scored"
    assert sc.stats["p2"].kills == kills_before, "the killer's -1 stays frozen (F356)"
    assert sc.stats["p0"].deaths == 1 and sc.stats["p0"].streak == 0, "the death happened to the victim"
    assert sc.kills[-1].get("frozen") is True


def test_multikill_names_the_ladder_label_of_the_best_chain():
    sc = mk(n=8, mode="ffa")
    for i in range(6):                                    # six kills 300 ms apart: KILLAMANJARO
        kill(sc, 0, 1 + i, T0 + 10_000 + i * 300)
    assert honors(sc, "multikill") == ["p0"]
    assert stat(sc, "multikill", "p0") == "KILLAMANJARO ×1"
    sc = mk(n=7, mode="ffa")                              # H3 (visual QA): a 5-chain read "TRIPLE KILL ×1"
    for i in range(5):
        kill(sc, 0, 1 + i, T0 + 10_000 + i * 300)
    assert stat(sc, "multikill", "p0") == "KILLTROCITY ×1"
    sc = mk(n=4, mode="ffa")
    kill(sc, 0, 1, T0 + 10_000); kill(sc, 0, 2, T0 + 10_300)
    kill(sc, 0, 3, T0 + 60_000); kill(sc, 0, 1, T0 + 60_300)
    assert stat(sc, "multikill", "p0") == "DOUBLE KILL ×2"


def _status(sc, i, shots, t=T0 + 50_000):
    sc.ingest_status(f"n{i}", {"shots": shots, "match_id": "m1"}, t)


def _hit(sc, shooter_i, victim_i, t, group=None):
    body = {"shooter_num": shooter_i + 1, "shooter_team": 1, "dmg": 9}
    if group is not None:
        body["shot_group"] = group
    return ev(sc, victim_i, "hit_taken", t, **body)


def test_sharpshooter_keeps_its_shot_floor_and_shares_a_tie():
    sc = mk()
    for k in range(9):
        _hit(sc, 0, 1, T0 + 1000 + k)                     # p0: 9 of 9, under ACC_MIN_SHOTS
    for k in range(5):
        _hit(sc, 1, 0, T0 + 2000 + k)                     # p1: 5 of 10
    _status(sc, 0, 9); _status(sc, 1, 10)
    assert honors(sc, "sharpshooter") == ["p1"], "9 shots is under the floor, however accurate"
    for k in range(5):
        _hit(sc, 2, 1, T0 + 3000 + k)                     # p2: 5 of 10 too
    _status(sc, 2, 10)
    assert honors(sc, "sharpshooter") == ["p1", "p2"]


def test_sharpshooter_needs_accuracy_above_zero():
    sc = mk()
    _status(sc, 0, 20); _status(sc, 1, 20)                # M1: 0 % over the floor must not win
    assert honors(sc, "sharpshooter") == []
    _hit(sc, 1, 0, T0 + 1000)
    assert honors(sc, "sharpshooter") == ["p1"]


def test_best_kd_non_mvp_needs_a_kill():
    sc = mk()
    kill(sc, 0, 1, T0 + 10_000)                           # p0 is MVP; nobody else has a kill
    assert honors(sc, "mvp") == ["p0"]
    assert honors(sc, "best_kd") == [], "M1: a 0-kill K/D is noise"
    kill(sc, 1, 2, T0 + 20_000)
    assert honors(sc, "best_kd") == ["p1"]


def test_sharpshooter_counts_one_shot_group_once():
    sc = mk()
    for k in range(5):
        _hit(sc, 0, 1, T0 + 1000 + k * 10, group=k); _hit(sc, 0, 1, T0 + 1001 + k * 10, group=k)
    for k in range(6):
        _hit(sc, 2, 1, T0 + 2000 + k * 10, group=100 + k)
    _status(sc, 0, 10); _status(sc, 2, 10)
    assert honors(sc, "sharpshooter") == ["p2"], "p0's dual-emitter pairs are 5 pulls, not 10"


def test_survivor_is_the_longest_single_life_not_the_fewest_deaths():
    sc = mk()
    kill(sc, 1, 0, T0 + 150_000); respawn(sc, 0, T0 + 160_000)          # p0: 150 s, then 140 s
    kill(sc, 0, 1, T0 + 50_000); respawn(sc, 1, T0 + 60_000)            # p1: 50 s, then 240 s
    kill(sc, 1, 2, T0 + 10_000); respawn(sc, 2, T0 + 20_000)
    kill(sc, 1, 2, T0 + 250_000)                                        # p2: 10, 230, then down
    kill(sc, 0, 3, T0 + 1000); respawn(sc, 3, T0 + 2000)
    kill(sc, 0, 3, T0 + 3000); respawn(sc, 3, T0 + 4000)                # p3: two deaths, then 296 s
    assert honors(sc, "survivor") == ["p3"]
    assert stat(sc, "survivor", "p3") == "LONGEST LIFE 4:56"
    assert honors(sc, "iron_man") == ["p0", "p1"], "1 death and 3 kills each: shared"


def test_survivor_a_lost_respawn_never_invents_a_longer_life():
    sc = mk()
    kill(sc, 1, 0, T0 + 5000)                             # p0 down at 5 s; the respawn fact is lost
    kill(sc, 1, 0, T0 + 250_000); respawn(sc, 0, T0 + 251_000)
    for i in (1, 2, 3):                                   # 100 s, then 189 s
        kill(sc, 0, i, T0 + 100_000); respawn(sc, i, T0 + 101_000); kill(sc, 0, i, T0 + 290_000)
    assert sc._longest_life("p0") == 49_000, "the death while down measures nothing"
    assert honors(sc, "survivor") == ["p1", "p2", "p3"], "a three-way tie to the second is shared"
    assert stat(sc, "survivor", "p1") == "LONGEST LIFE 3:09"


def test_survivor_is_not_awarded_when_everyone_ties():
    sc = mk()
    for i in range(4):
        respawn(sc, i, T0 + 1000)                         # every phone reported; a respawn while alive starts nothing
    assert honors(sc, "survivor") == [], "nobody died: every life is the whole match"


def test_survivor_reads_life_marks_in_time_order_not_arrival_order():
    sc = mk()
    respawn(sc, 0, T0 + 60_000); kill(sc, 1, 0, T0 + 200_000)    # a flush: the death at 50 s arrives LAST
    kill(sc, 1, 0, T0 + 50_000)
    for i in (1, 2, 3):
        kill(sc, 0, i, T0 + 100_000); respawn(sc, i, T0 + 101_000); kill(sc, 0, i, T0 + 150_000)
    assert sc._longest_life("p0") == 140_000, "50 s, then 60 s to 200 s; arrival order would say 200 s"
    assert honors(sc, "survivor") == ["p0"]


def test_survivor_an_infection_team_change_starts_a_new_life():
    sc = mk(mode="infection")
    kill(sc, 1, 0, T0 + 10_000)
    ev(sc, 0, "team_change", T0 + 12_000, tid=3)          # the turned human is revived on the infected team
    assert sc._longest_life("p0") == END - (T0 + 12_000)


def test_survivor_skips_a_player_with_a_fact_from_an_unsynced_node():
    sc = mk(unsynced=(0,))
    kill(sc, 1, 0, T0 + 1000); respawn(sc, 0, T0 + 2000)  # p0's facts are timed by arrival: a guess
    kill(sc, 0, 1, T0 + 100_000); respawn(sc, 1, T0 + 101_000)            # p1: 100 s, then 199 s
    for i in (2, 3):
        kill(sc, 0, i, T0 + 100_000); respawn(sc, i, T0 + 101_000); kill(sc, 0, i, T0 + 200_000)
    assert sc._longest_life("p0") > sc._longest_life("p1"), "control: p0 WOULD win on the numbers"
    assert honors(sc, "survivor") == ["p1"]


def test_a_silent_player_holds_neither_survivor_nor_iron_man():
    sc = mk()
    for i in (1, 2, 3):                                   # p0's phone never reported: 0 deaths MC could see
        kill(sc, 0, i, T0 + 100_000 + i); respawn(sc, i, T0 + 101_000)
    kill(sc, 0, 1, T0 + 250_000); kill(sc, 0, 2, T0 + 250_000)
    assert "p0" in sc.missing()
    assert "p0" not in honors(sc, "survivor") and "p0" not in honors(sc, "iron_man"), sc.honors()
    assert honors(sc, "iron_man") == ["p3"] and honors(sc, "survivor") == ["p3"]


def test_iron_man_skips_a_hot_joiner_and_needs_fewer_than_the_most():
    sc = mk(n=3, mode="ffa")
    kill(sc, 1, 0, T0 + 10_000); kill(sc, 2, 0, T0 + 20_000)            # p0: 2 deaths
    kill(sc, 0, 1, T0 + 30_000)                                         # p1: 1 death
    kill(sc, 0, 2, T0 + 40_000)                                         # p2: 1 death
    late = _players(4, "ffa")["p3"]
    sc.register_player("p3", late, t=T0 + 100_000)
    sc.node_player["n3"] = "p3"
    sc.synced_at_lobby["n3"] = True
    assert "p3" in sc.joined_t
    # p1 and p2 tie on deaths (1) and on the tie-break (1 kill each); p3 has 0 deaths but joined late
    assert honors(sc, "iron_man") == ["p1", "p2"], "p3 has 0 deaths but did not play the whole match"
    # the late joiner's first life starts at the join, not at go-live
    assert sc._longest_life("p3") == END - (T0 + 100_000)
    # a player registered BEFORE go-live (armed) played the whole match
    sc2 = mk(n=3, mode="ffa")
    sc2.register_player("p3", late, t=T0 - 500)
    assert "p3" not in sc2.joined_t


def test_iron_man_is_not_awarded_when_every_eligible_player_died_as_often():
    sc = mk(n=3, mode="ffa")
    kill(sc, 1, 0, T0 + 10_000); kill(sc, 2, 1, T0 + 20_000); kill(sc, 0, 2, T0 + 30_000)
    assert honors(sc, "iron_man") == []


def _assist(sc, helper_i, killer_i, victim_i, t):
    _hit(sc, helper_i, victim_i, t - 500)
    kill(sc, killer_i, victim_i, t)


def test_wingman_is_the_most_assists_and_needs_one():
    sc = mk()
    kill(sc, 0, 1, T0 + 10_000)
    assert honors(sc, "wingman") == [], "no assists: no WINGMAN"
    _assist(sc, 2, 0, 1, T0 + 20_000)
    _assist(sc, 2, 0, 3, T0 + 30_000)
    _assist(sc, 3, 1, 0, T0 + 40_000)
    assert honors(sc, "wingman") == ["p2"]
    assert stat(sc, "wingman", "p2") == "2 ASSISTS"


def _poss(sc, i, hold, t=END):
    return sc.ingest(f"n{i}", {"type": "possession", "t": t, "match_id": "m1", "player_id": f"p{i}",
                               "site": "A", "hold_ms": hold}, t)


def test_objective_hero_only_in_an_objective_mode_and_only_for_a_contribution():
    sc = mk(mode="koth")
    kill(sc, 0, 1, T0 + 10_000)
    assert honors(sc, "objective_hero") == [], "nobody reported the hill"
    _poss(sc, 0, {"1": 90_000, "3": 5000})               # p0 (blue, tid 1) saw blue hold it 90 s
    _poss(sc, 2, {"1": 30_000})                          # p2 (blue): 30 s
    _poss(sc, 1, {"3": 60_000, "1": 99_000})             # p1 (yellow, tid 3): only yellow's 60 s counts for p1
    assert honors(sc, "objective_hero") == ["p0"]
    assert stat(sc, "objective_hero", "p0") == "IN RANGE · 1:30"
    _poss(sc, 1, {"3": 90_000})
    assert honors(sc, "objective_hero") == ["p0", "p1"], "a tie to the second is shared"
    sc = mk(mode="tdm")
    kill(sc, 0, 1, T0 + 10_000)
    _poss(sc, 0, {"1": 90_000})
    assert honors(sc, "objective_hero") == [], "tdm has no objective"


# ── the Session carries the hot joiner through a replay and a restart ──────────────────────────
def test_a_hot_join_survives_the_replay_and_an_mc_restart():
    from test_mc_resume import _persisting_live, _restart
    s, _net, clock, _ps, info = _persisting_live(3)
    clock["t"] = info["go_live_t"] + 30_000
    p = s.add_player("LATECOMER")
    assert s.scorer.joined_t == {p["player_id"]: clock["t"]}
    replayed = s._replay(s.scorer, s._match_facts(info["match_id"]))
    assert replayed.joined_t == s.scorer.joined_t, "the reconcile replay keeps who joined late"
    s2, _net2 = _restart(s, clock)
    assert s2.resume_match() == "live"
    assert s2.scorer.joined_t == {p["player_id"]: info["go_live_t"] + 30_000}, "the resumed scorer keeps it too"


def test_the_result_push_carries_each_honor_key():
    from test_mc_block_b import kill as s_kill
    from test_mc_result import go_live
    s, net, clock, ps, info = go_live(3, "ffa")
    s_kill(s, net, clock, ps, 0, 1, info, seq=1)
    s_kill(s, net, clock, ps, 0, 2, info, seq=2)
    s.control("end")
    bodies = [b for _n, _k, b in net.pushes("result")]
    assert bodies and all(b["honors"] for b in bodies), bodies
    keys = {a["key"] for a in AWARDS}
    for b in bodies:
        for h in b["honors"]:
            assert h.get("key") in keys and h["medal"], h
