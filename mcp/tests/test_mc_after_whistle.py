"""F357 and A65 (Tony, 2026-09-25).

* **F357** "MC shouldn't push KCs. Any kills after whistle are shown in MC as after whistle and filtered out from
  normal game results." MC sends no kill confirm (and so no medal cue) for a kill it processes after the end, for
  EVERY end (frag cap, host END, the clock). A kill STAMPED after the end is an after-whistle kill: it is shown,
  tagged AFTER WHISTLE, and counts in nothing. A kill that ARRIVES late but is stamped before the end still counts.
* **A65 (F354)** "killed by blue makes sense": a death whose phone lost the damaging hit and names only the team of
  a fresh non-damaging word (`credit: "team"`, `shooter_num` 0) scores for that TEAM, and for no player.
"""
from brx_mcp.mc.scoring import Scorer

from test_mc_block_b import T0, go_live, kill


def _kill_cues(net, ps, i):
    return [p for p in net.pushes("feedback", ps[i]["node_id"]) if p[2].get("kind") == "kill"]


def _death(net, info, ps, victim_i, t, t_recv, seq, **extra):
    net.simulate_event(f"node{victim_i}", {"type": "death", "t": t, "match_id": info["match_id"],
                                           "player_id": ps[victim_i]["player_id"], **extra}, t_recv, seq=seq)


# ---------------------------------------------------------------------------------------------- F357
def test_a_kill_landing_after_a_host_end_scores_but_gets_no_confirm_or_medal():
    s, net, clock, ps, info = go_live(2, "tdm")
    t_before = clock["t"] + 500
    clock["t"] += 1000
    s.control("end", confirm=True)
    assert s.phase == "recap"
    # stamped before the END, flushed after it: FIRST BLOOD, but nobody hears it
    _death(net, info, ps, 1, t_before, clock["t"] + 100, 1, shooter_num=ps[0]["player_num"], shooter_team=1)
    rows = {r["player_id"]: r for r in s.scorer.rows()}
    assert rows[ps[0]["player_id"]]["kills"] == 1, "a kill stamped before the END still counts"
    assert _kill_cues(net, ps, 0) == [], "no kill confirm (and no FIRST BLOOD cue) after the END"


def test_a_kill_stamped_after_the_end_is_marked_after_whistle_and_counts_for_nothing():
    s, net, clock, ps, info = go_live(3, "tdm")
    kill(s, net, clock, ps, 0, 1, info, seq=1)          # control: one counted kill
    clock["t"] += 1000
    s.control("end", confirm=True)
    end_t = s.scorer.end_t
    _death(net, info, ps, 2, end_t + 2000, end_t + 2100, 1, shooter_num=ps[1]["player_num"], shooter_team=1)
    rows = {r["player_id"]: r for r in s.scorer.rows()}
    assert rows[ps[1]["player_id"]]["kills"] == 0 and rows[ps[2]["player_id"]]["deaths"] == 0
    assert rows[ps[1]["player_id"]]["after_end_kills"] == 1, "the recap's after-whistle block shows it"
    line = next((f for f in s.feed if f.get("tag") == "AFTER WHISTLE"), None)
    assert line and line["kind"] == "kill" and "eliminated" in line["text"], s.feed[:4]
    assert all(h["player_id"] != ps[1]["player_id"] for h in s.scorer.honors()), "no award from it"
    assert _kill_cues(net, ps, 1) == []


def test_a_kill_before_the_whistle_is_still_confirmed():
    """Control for the two above: the same kill, live, is confirmed."""
    s, net, clock, ps, info = go_live(2, "tdm")
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    assert len(_kill_cues(net, ps, 0)) == 1


def test_a_second_kill_after_the_frag_cap_in_the_same_scorer_pass_gets_no_confirm():
    """The cap kill is cued; once the cap is reached (`limit_reached_t`), no later kill is, even before the Session
    has finished the match (a flush of several kills is scored before the cap's end is applied)."""
    cues = []
    ps = {f"p{i}": {"player_id": f"p{i}", "player_num": i + 1, "display": f"P{i}", "team_id": "ffa"} for i in range(3)}
    sc = Scorer("m1", T0, 600, "ffa", ps, [{"team_id": "ffa", "name": "FFA", "color": "#fff", "tid": 1}],
                {f"n{i}": f"p{i}" for i in range(3)}, {f"n{i}": True for i in range(3)}, now_ms=lambda: T0 + 2000,
                win_by="kills", frag_limit=1, on_feedback=lambda pid, b: cues.append((pid, b["victim"])),
                on_limit=lambda t: sc.set_end(t))     # as `Session._on_frag_limit` does, at once, even mid-batch
    sc.ingest("n1", {"type": "death", "t": T0 + 1000, "match_id": "m1", "player_id": "p1", "shooter_num": 1}, T0 + 2000, seq=1)
    sc.ingest("n2", {"type": "death", "t": T0 + 900, "match_id": "m1", "player_id": "p2", "shooter_num": 1}, T0 + 2000, seq=1)
    assert cues == [("p0", "p1")], cues


# ---------------------------------------------------------------------------------------------- A65
def _team_setup():
    s, net, clock, ps, info = go_live(4, "tdm")
    victim = ps[1]
    enemy = next(p for p in ps if p["team_id"] != victim["team_id"])
    tid = s.team(enemy["team_id"])["tid"]
    own = s.team(victim["team_id"])["tid"]
    return s, net, clock, ps, info, victim, enemy, tid, own


def test_a_team_credit_death_scores_for_the_team_and_for_no_player():
    s, net, clock, ps, info, victim, enemy, tid, _own = _team_setup()
    clock["t"] += 1000
    _death(net, info, ps, 1, clock["t"], clock["t"], 1, shooter_num=0, shooter_team=tid, credit="team")
    sc = s.scorer
    assert sc.team_scores()[enemy["team_id"]] == 1, sc.team_scores()
    rows = sc.rows()
    assert all(r["kills"] == 0 and r["assists"] == 0 and r["medals"] == [] and not r["first_blood"] for r in rows), rows
    assert next(r for r in rows if r["player_id"] == victim["player_id"])["deaths"] == 1
    assert sc.first_blood is None, "no player drew first blood"
    assert all(_kill_cues(net, ps, i) == [] for i in range(4)), "nobody gets a kill confirm"
    assert s.feed[0]["tag"] == "TEAM CREDIT" and "eliminated" in s.feed[0]["text"], s.feed[0]
    assert not any(w.startswith("WIRE 0") for w in sc.warnings()), "a team credit has an identity"
    assert s.recap()["winner"].get("team_id") == enemy["team_id"]


def test_a_team_credit_for_the_victims_own_team_or_in_ffa_scores_nothing():
    s, net, clock, ps, info, _victim, _enemy, _tid, own = _team_setup()
    clock["t"] += 1000
    _death(net, info, ps, 1, clock["t"], clock["t"], 1, shooter_num=0, shooter_team=own, credit="team")
    assert sum(s.scorer.team_scores().values()) == 0, s.scorer.team_scores()
    f, fnet, fclock, fps, finfo = go_live(2, "ffa")
    fclock["t"] += 1000
    _death(fnet, finfo, fps, 1, fclock["t"], fclock["t"], 1, shooter_num=0, shooter_team=1, credit="team")
    assert all(r["kills"] == 0 for r in f.scorer.rows())


def test_a_team_credit_can_reach_the_frag_cap():
    s, net, clock, ps, info = go_live(4, "tdm", {"scoring": {"frag_limit": 2, "win_by": "kills"}})
    victim = ps[1]
    enemy = next(p for p in ps if p["team_id"] != victim["team_id"])
    ei = ps.index(enemy)
    other = next(i for i, p in enumerate(ps) if p["team_id"] == victim["team_id"] and i != 1)
    kill(s, net, clock, ps, ei, 1, info, seq=1)
    clock["t"] += 1000
    _death(net, info, ps, other, clock["t"], clock["t"], 1, shooter_num=0,
           shooter_team=s.team(enemy["team_id"])["tid"], credit="team")
    assert s.phase == "recap" and s.end_reason == "frag_limit", (s.phase, s.scorer.team_scores())


def test_a_team_credit_to_an_unknown_team_scores_nothing_and_is_not_a_wire_0_death():
    """Polish r1: a `credit` death names no player on purpose, so it is never counted as a WIRE 0 (no identity)
    death, even when the team it names is not on the roster (MC then credits nobody)."""
    s, net, clock, ps, info, _victim, _enemy, _tid, _own = _team_setup()
    clock["t"] += 1000
    _death(net, info, ps, 1, clock["t"], clock["t"], 1, shooter_num=0, shooter_team=3, credit="team")
    assert sum(s.scorer.team_scores().values()) == 0
    assert s.scorer.wire0["death"] == 0, s.scorer.wire0
    _death(net, info, ps, 2, clock["t"], clock["t"], 1, shooter_num=0, shooter_team=3)   # control: no credit = wire 0
    assert s.scorer.wire0["death"] == 1, s.scorer.wire0


def test_the_session_drops_a_kill_confirm_in_recap_even_with_the_scorer_gate_open():
    """F357 has two gates. With `Scorer._before_whistle` stubbed open, `Session._feedback` alone must still drop a
    kill confirm in RECAP, for a host END (not only a frag-cap end)."""
    s, net, clock, ps, info = go_live(2, "tdm")
    t_before = clock["t"] + 500
    clock["t"] += 1000
    s.control("end", confirm=True)
    assert s.phase == "recap" and s.end_reason != "frag_limit"
    s.scorer._before_whistle = lambda: True             # the Scorer gate open: only the Session's remains
    _death(net, info, ps, 1, t_before, clock["t"] + 100, 1, shooter_num=ps[0]["player_num"], shooter_team=1)
    assert s.scorer.rows()[0]["kills"] + s.scorer.rows()[1]["kills"] == 1, "control: the kill scored"
    assert _kill_cues(net, ps, 0) == []
