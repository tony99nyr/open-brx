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
    assert sc.kills[-1]["multi"] == 2 and feed[-1]["tag"] == "DOUBLE KILL"
    assert fb[-1][1]["kind"] == "kill" and fb[-1][1]["medals"] == ["double_kill"]   # A11.4: kind stays "kill", medals stack
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
    # the CLOCK-WINDOW award is still suppressed: two kills 1 s apart on a re-based clock are not a
    # double kill, and no live cue is fired at a player for a flush that arrived a minute late.
    assert r["p0"]["kills"] == 2 and sc.kills[-1]["multi"] == 1 and not fb
    # F150 (field 2026-09-12): first blood is an ORDERING, not a window, and the suppression is decided on
    # the VICTIM's node — so gating it here silently wiped the KILLER's medals. It is credited now.
    assert sc.first_blood == "p0"
    assert "FIRST BLOOD" in r["p0"]["medals"], r["p0"]["medals"]
    assert not any(m.startswith("DOUBLE") for m in r["p0"]["medals"])


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
    sc.node_player["n9"] = "p0"          # Session binds the new node first; a body's player_id alone never counts
    sc.ingest_status("n9", {"player_id": "p0", "shots": 5, "alive": True}, T0 + 2000)
    assert sc.shots_total("p0") == 45 and next(r for r in sc.rows() if r["player_id"] == "p0")["shots_total"] == 45


def test_csv_and_missing():
    sc, _, _ = mk()
    death(sc, "n1", "p1", 1, T0 + 1000)
    assert "REAPER" in sc.csv() and "p1" not in sc.missing() and "p2" in sc.missing()


# ---- A11.4: Halo-style medal stacks + match-state alerts ----------------------------------------
def mk_alerts(mode="tdm", cap=None, tl=600):
    fb, feed, alerts = [], [], []
    ps = _players(mode)
    sc = Scorer("m1", T0, tl, mode, ps, _teams(mode), {f"n{i}": f"p{i}" for i in range(4)},
                {f"n{i}": True for i in range(4)}, on_feedback=lambda pid, b: fb.append((pid, b)),
                on_feed=feed.append, now_ms=(lambda: T0 + 2000), win_by=("survival" if mode in ("lms", "infection") else "kills"),
                on_alert=lambda kind, scope, extra: alerts.append((kind, scope, extra)), frag_limit=cap)
    return sc, fb, feed, alerts


def test_first_blood_is_a_medal_and_a_kill_can_stack_a_multi_and_a_spree():
    sc, fb, feed, alerts = mk_alerts()
    # fixture: player_num = index + 1, so shooter_num 1 is p0 (blue); p1/p3 are yellow
    death(sc, "n1", "p1", 1, T0 + 1000)
    assert fb[-1][1]["medals"] == ["first_blood"] and feed[-1]["tag"] == "FIRST BLOOD"
    # four more kills inside the multi window: kills 2,3,4,5 -> double, triple, killtacular, killtacular+killing_spree
    death(sc, "n3", "p3", 1, T0 + 1500); assert fb[-1][1]["medals"] == ["double_kill"]
    death(sc, "n1", "p1", 1, T0 + 1800); assert fb[-1][1]["medals"] == ["triple_kill"]
    death(sc, "n3", "p3", 1, T0 + 1900); assert fb[-1][1]["medals"] == ["killtacular"]
    death(sc, "n1", "p1", 1, T0 + 1950)
    assert fb[-1][1]["medals"] == ["killtacular", "killing_spree"], fb[-1][1]
    assert fb[-1][1]["kind"] == "kill"
    assert feed[-1]["tag"] == "KILLTACULAR + KILLING SPREE"


def test_lead_alerts_go_to_the_teams_they_concern_and_next_kill_wins_fires_once():
    sc, fb, feed, alerts = mk_alerts(cap=3)
    death(sc, "n1", "p1", 1, T0 + 1000)                  # blue (p0, num 1) leads 1-0
    assert ("lead_taken", "blue", {}) in alerts and not any(a[0] == "lead_lost" for a in alerts)
    death(sc, "n0", "p0", 2, T0 + 1200)                  # yellow (p1, num 2) ties 1-1: nothing new
    assert alerts[-1][0] == "lead_taken"
    death(sc, "n2", "p2", 2, T0 + 1400)                  # yellow leads 2-1 = cap-1 -> lead change + next kill wins
    assert ("lead_lost", "blue", {}) in alerts and ("lead_taken", "yellow", {}) in alerts
    assert alerts.count(("next_kill_wins", "all", {})) == 1
    death(sc, "n0", "p0", 2, T0 + 1600)                  # 3-1: no second next_kill_wins
    assert alerts.count(("next_kill_wins", "all", {})) == 1


def test_last_survivor_and_infected_alerts():
    sc, fb, feed, alerts = mk_alerts(mode="lms")
    death(sc, "n1", "p1", 1, T0 + 1000)
    death(sc, "n2", "p2", 1, T0 + 1001)
    assert not any(a[0] == "last_survivor" for a in alerts)   # two still alive (p0, p3)
    death(sc, "n3", "p3", 1, T0 + 1100)
    assert alerts[-1] == ("last_survivor", "all", {"player_id": "p0"}), alerts
    sc2, fb2, feed2, alerts2 = mk_alerts(mode="infection")
    r = sc2.ingest("n2", {"type": "team_change", "t": T0 + 1000, "match_id": "m1", "node_id": "n2", "player_id": "p2", "tid": 2}, T0 + 1000)
    assert ("infected", "all", {"player_id": "p2"}) in alerts2, (r, alerts2)   # a turn also re-evaluates last_survivor (polish 2026-09-04)


def test_a_team_kill_that_flips_the_lead_still_announces_it():
    """Polish 2026-09-04: alerts ran only inside the enemy-kill branch, so a team kill (kills -= 1) could
    hand the lead over in silence."""
    sc, fb, feed, alerts = mk_alerts()
    death(sc, "n1", "p1", 1, T0 + 1000)          # p0 (blue) kills p1 -> blue leads 1-0
    assert ("lead_taken", "blue", {}) in alerts
    death(sc, "n0", "p0", 2, T0 + 1100)          # p1 (yellow) kills p0 -> 1-1, no change
    alerts.clear()
    death(sc, "n2", "p2", 1, T0 + 1200)          # p0 team-kills p2 -> blue 0, yellow 1
    assert ("lead_lost", "blue", {}) in alerts and ("lead_taken", "yellow", {}) in alerts, alerts


def test_infection_last_survivor_counts_only_the_uninfected_side():
    """Polish 2026-09-04: the infected respawn ALIVE, so counting every alive player never reached one."""
    sc, fb, feed, alerts = mk_alerts(mode="infection")
    death(sc, "n1", "p1", 1, T0 + 1000)          # p1 goes down (still yellow); 3 alive, infected team unknown -> nothing
    assert not any(a[0] == "last_survivor" for a in alerts)
    sc.ingest("n1", {"type": "team_change", "t": T0 + 1500, "match_id": "m1", "node_id": "n1", "player_id": "p1", "tid": 1}, T0 + 1500)
    # p1 turned onto tid 1 (blue) -> blue is the infected side; the only alive non-blue player is p3
    assert alerts[-1] == ("last_survivor", "all", {"player_id": "p3"}), alerts
    sc.ingest("n1", {"type": "respawn", "t": T0 + 2000, "match_id": "m1", "node_id": "n1", "player_id": "p1"}, T0 + 2000)
    assert sum(1 for a in alerts if a[0] == "last_survivor") == 1     # once per match, and a turned player's respawn is not a survivor


# --------------------------------------------------------------- F150: the medals reach the row
def _duel(synced_nodes: dict[str, bool], order: list[str], gap_ms: int = 5000):
    """A scripted 1v1 FFA. `order` is the KILLER of each kill in turn ("p0" or "p1")."""
    ps = {"p0": {"player_id": "p0", "player_num": 1, "display": "OTHERGUY", "team_id": "ffa",
                 "node_id": "n0", "gun_id": None, "loadout": {"weapons": []}, "voice": "male", "ready": True},
          "p1": {"player_id": "p1", "player_num": 2, "display": "TONY", "team_id": "ffa",
                 "node_id": "n1", "gun_id": None, "loadout": {"weapons": []}, "voice": "male", "ready": True}}
    sc = Scorer("m1", T0, 600, "ffa", ps, _teams("ffa"), {"n0": "p0", "n1": "p1"},
                dict(synced_nodes), now_ms=lambda: T0 + 10_000_000)
    for i, killer in enumerate(order):
        victim, vnode = ("p1", "n1") if killer == "p0" else ("p0", "n0")
        shooter_num = 1 if killer == "p0" else 2
        sc.ingest(vnode, {"type": "death", "t": T0 + 1000 + i * gap_ms, "match_id": "m1",
                          "player_id": victim, "shooter_num": shooter_num}, T0 + 1000 + i * gap_ms,
                  seq=i + 1)
    return sc


def test_f150_an_eleven_kill_run_carries_its_streak_medals_to_the_recap_row():
    """Field 2026-09-12: OTHERGUY finished 11-5 in a 1v1 FFA and the recap showed him NO medals, while
    the other row carried FIRST BLOOD. `honors()` is empty under three players by design, so `medals`
    is the per-kill ledger alone — and the per-kill ledger was being thrown away."""
    # n1 (the victim node for every one of p0's kills) was never marked synced at the lobby.
    sc = _duel({"n0": True}, ["p0"] * 6 + ["p1"] * 5 + ["p0"] * 5)
    rows = {r["player_id"]: r for r in sc.rows()}
    assert (rows["p0"]["kills"], rows["p0"]["deaths"]) == (11, 5)
    assert rows["p0"]["best_streak"] == 6
    assert rows["p0"]["medals"] == ["FIRST BLOOD", "KILLING SPREE ×2"], rows["p0"]["medals"]
    # the recap sheet is what the operator reads, and it carries the same list
    recap = sc.recap()
    assert recap["honors"] == [], "under 3 players there are no honors — medals are the whole story"
    got = {r["player_id"]: r["medals"] for r in recap["rows"]}
    assert "KILLING SPREE ×2" in got["p0"], got


def test_f150_the_victims_clock_no_longer_decides_the_killers_medals():
    """The mechanism: `suppress` is A5.7's judgement about the node that REPORTED the death, and every
    medal on that kill belongs to somebody else."""
    both = _duel({"n0": True, "n1": True}, ["p0"] * 11)
    one = _duel({"n0": True}, ["p0"] * 11)                 # p0's victim node unsynced
    assert [r["medals"] for r in both.rows() if r["player_id"] == "p0"] == \
           [r["medals"] for r in one.rows() if r["player_id"] == "p0"]
    assert "UNSTOPPABLE" in one.rows()[0]["medals"], one.rows()[0]["medals"]


def test_f150_the_multi_kill_tier_is_still_suppressed_on_an_untrusted_clock():
    """What stays gated, and why: a double kill is two kills inside MULTI_KILL_MS, and a node whose
    clock MC never saw synced cannot be asked what "inside 4 s" means."""
    fast = _duel({"n0": True, "n1": True}, ["p0"] * 2, gap_ms=1000)
    assert any(m.startswith("DOUBLE KILL") for m in fast.rows()[0]["medals"])
    blind = _duel({"n0": True}, ["p0"] * 2, gap_ms=1000)
    assert not any(m.startswith("DOUBLE KILL") for m in blind.rows()[0]["medals"]), blind.rows()[0]["medals"]
    assert "FIRST BLOOD" in blind.rows()[0]["medals"]


# --------------------------------------------------------------- F154: a tie is a DRAW
def test_f154_equal_top_rows_in_ffa_are_a_draw_not_a_win_for_whoever_sorted_first():
    """Field 2026-09-12: rows tied 1-1 and the Pixel 4 was shown LOSE. `rows[0]` is a sort artefact,
    not a winner."""
    sc = _duel({"n0": True, "n1": True}, ["p0", "p1"])
    rows = {r["player_id"]: r for r in sc.rows()}
    assert (rows["p0"]["kills"], rows["p1"]["kills"]) == (1, 1)
    assert sc.winner() == {"player_id": None, "tie": ["p0", "p1"]}
    # ...and one clear kill ahead still names a winner
    sc2 = _duel({"n0": True, "n1": True}, ["p0", "p1", "p0"])
    assert sc2.winner() == {"player_id": "p0"}


def test_f154_a_tied_ffa_tells_every_phone_it_was_a_draw():
    """The end of the chain: `_outcome_for` already understood `tie` (the cap-tie path built it) — FFA
    simply never produced one."""
    from brx_mcp.mc.state import Session
    from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
    net = FakeNet(); net.start("10.0.0.5", 8766, "/ws")
    s = Session(FakeCompiler(), net, FakeArmory(demo_armory()))
    s.set_config({"mode": "ffa", "time_limit_s": 600})
    a = s.add_player("ALPHA", gun_id="GUN-A")
    b = s.add_player("BRAVO", gun_id="GUN-B")
    s.scorer = _duel({"n0": True, "n1": True}, ["p0", "p1"])
    s.scorer.players = {a["player_id"]: a, b["player_id"]: b}
    winner = {"player_id": None, "tie": [a["player_id"], b["player_id"]]}
    assert s._outcome_for(winner, a) == "draw"
    assert s._outcome_for(winner, b) == "draw"
    c = s.add_player("CHARLIE", gun_id="GUN-C")
    assert s._outcome_for(winner, c) == "lose", "a player outside the tie did not draw"
