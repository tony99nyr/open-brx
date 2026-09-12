"""A24 + A31 (2026-09-12) — the match RESULT reaches every node, and the recap is a REPLAY.

Three things are proved here, each of which the server could not do before:

* **A24 `result`** — MC pushes the outcome to EVERY bound player node, losers included, with
  `outcome` computed per RECIPIENT. A node never infers win or lose, because silence means "you lost"
  and "your phone was off the LAN" identically (game test 2026-09-11 D3).
* **A24/M2 the replay** — the match ends at the TIMESTAMP of the kill that reached the frag cap, not
  when MC learned of it. A phone that flushes minutes late can reveal an EARLIER cap kill by somebody
  else, which moves the end backwards and un-scores everything MC counted after that moment. The
  recap is therefore a pure function of (the stored facts, the end rule) and is re-derived.
* **A31 `mc_verify`** — the pre-game "a win is confirmed at MC" warning, present only when MC decides
  the end AND the venue is not full coverage AND some rostered phone has no backhaul.
"""
import pathlib
import tempfile

from test_mc_block_b import heartbeat, kill, online

from brx_mcp.mc import compile as C
from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.scoring import rows_csv
from brx_mcp.mc.state import Session
from brx_mcp.mc.store import Store
from brx_mcp.mc.types import CLOCK_TIE_MS

T0 = 5_000_000


def mk(n_players=2, mode="tdm", cfg=None, store=True):
    """The block-B harness with a REAL sqlite store attached — the replay's only input."""
    clock = {"t": T0}
    net = FakeNet()
    st = Store("t", pathlib.Path(tempfile.mkdtemp()) / "s.sqlite") if store else None
    s = Session(FakeCompiler(), net, FakeArmory(demo_armory()), store=st, now_ms=lambda: clock["t"])
    s.set_config({"mode": mode, "time_limit_s": 600, **(cfg or {})})
    ps = [s.add_player(f"OP{i}", gun_id=f"GUN-{chr(65 + i)}") for i in range(n_players)]
    return s, net, clock, ps


def go_live(n_players=2, mode="tdm", cfg=None, store=True):
    s, net, clock, ps = mk(n_players, mode, cfg, store)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    s.push_config()
    for i in range(n_players):
        net.simulate_node_message(f"node{i}", "ack_config", {"config_id": s.config["config_id"], "ok": True,
                                                             "gun_echo": "$LCD"}, clock["t"])
    info = s.start(runway_s=10)
    clock["t"] = info["go_live_t"] + 1
    s.tick()
    assert s.phase == "live"
    heartbeat(s, net, clock, ps)
    return s, net, clock, ps, info


def results(net):
    """The LATEST `result` body each node was pushed."""
    out = {}
    for nid, _kind, body in net.pushes("result"):
        out[nid] = body
    return out


# ---------------------------------------------------------------------------------------------
# A24 — the result reaches everyone, computed per recipient
# ---------------------------------------------------------------------------------------------
def test_result_is_pushed_to_every_node_with_a_per_recipient_outcome():
    """A team match: the winners are told WIN and the losers are told LOSE, by MC, in the same breath.

    Before A24 the losers got nothing at all — `_push_victory` only ever reached the winning team's
    guns — so a phone could not tell a loss from a dropped socket.
    """
    s, net, clock, ps, info = go_live(4, "tdm")          # ps[0]/ps[2] blue, ps[1]/ps[3] yellow
    kill(s, net, clock, ps, 0, 1, info, seq=1)           # blue 1 - 0 yellow
    s.control("end")
    got = results(net)
    assert set(got) == {"node0", "node1", "node2", "node3"}, f"a node was left out: {sorted(got)}"
    assert [got[f"node{i}"]["outcome"] for i in range(4)] == ["win", "lose", "win", "lose"]
    b = got["node0"]
    assert b["winner"]["team_id"] == "blue" and b["mode"] == "tdm" and b["match_id"] == info["match_id"]
    assert {t["team_id"] for t in b["team_scores"]} == {"blue", "yellow"}
    assert len(b["rows"]) == 4, "every player's row rides along, not just the recipient's"
    assert b["my"]["player_id"] == ps[0]["player_id"] and got["node1"]["my"]["player_id"] == ps[1]["player_id"]
    # `provisional` is a REAL claim, so assert the real value: at the whistle only the victim's node
    # had flushed a fact, so three of four players are still `missing` and the sheet can still move.
    assert b["provisional"] is True, s.last_recap.get("missing")
    assert isinstance(b["t"], int)


def test_the_result_stops_being_provisional_once_every_node_has_flushed():
    """The other half of the claim — `provisional` has to be able to go FALSE, or the phone's "results
    may still move" line never clears and the player never learns the sheet is final."""
    s, net, clock, ps, info, g, late = _late_cap_scenario()
    assert results(net)["node0"]["provisional"] is True, "two of four phones had not reported yet"
    clock["t"] = g + 300_000
    net.simulate_node_message("node3", "event_batch", {"events": late}, clock["t"])
    assert s.last_recap["missing"] == [], s.last_recap["missing"]
    assert results(net)["node0"]["provisional"] is False, "the last phone reported; the sheet is final"


def test_result_says_undecided_rather_than_inventing_a_winner():
    """An objective match nobody reported on is UNDECIDED (A5.9/A6.1 — the host decides). MC says so
    to every phone; it must never fall back to the kills table it happens to have."""
    s, net, clock, ps, info = go_live(2, "koth", {"scoring": {"win_by": "objective"}, "station_source": "grenade"})
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    s.control("end")
    got = results(net)
    assert [got[f"node{i}"]["outcome"] for i in range(2)] == ["undecided", "undecided"]
    assert got["node0"]["winner"].get("undecided") == "objective" and got["node0"]["win_by"] == "objective"


def test_welcome_carries_the_result_while_the_session_is_in_recap():
    """A phone that was out of coverage at the whistle learns the result on its next hello — the only
    route there is for a node MC could not push to."""
    s, net, clock, ps, info = go_live(2, "ffa", {"scoring": {"frag_limit": 1, "win_by": "kills"}})
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    assert s.phase == "recap"
    node = net.simulate_hello("node1", f"GUN-B-{demo_armory()[1]['ble']['tail']}")
    assert node and node["result"]["outcome"] == "lose", node.get("result")
    assert node["result"]["winner"]["player_id"] == ps[0]["player_id"]
    # ...and never while a match is still being played: a live `welcome` carries `score`, not a verdict.
    s2, net2, clock2, ps2, info2 = go_live(2, "ffa")
    live = net2.simulate_hello("node1", f"GUN-B-{demo_armory()[1]['ble']['tail']}")
    assert "result" not in live and live["score"]["rows"], "a live welcome carries the leaderboard, not a result"


def test_score_pushes_carry_every_row_in_every_mode():
    """A24: `_push_scores` already looped over every player's row and sent each node only its own.
    The data was withheld, not missing — a team match could not show per-player lines."""
    s, net, clock, ps, info = go_live(3, "tdm")
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    body = [p for p in net.pushes("score") if p[0] == "node2"][-1][2]
    assert len(body["rows"]) == 3 and {r["player_id"] for r in body["rows"]} == {p["player_id"] for p in ps}
    assert body["player_id"] == ps[2]["player_id"], "the recipient's own row is still the body itself"
    assert body["board"]["teams"], "the DOWN-screen race is untouched"


# ---------------------------------------------------------------------------------------------
# A24/M2 — the replay: a late fact can move the END ITSELF
# ---------------------------------------------------------------------------------------------
def _late_cap_scenario():
    """A caps at +2.0 s in coverage; B's victim is off the LAN and flushes a cap of its own at +0.9 s.

    Four players: A (node0) kills C (node2, online), B (node1) kills D (node3, whose facts arrive as a
    store-and-forward batch AFTER the whistle).
    """
    s, net, clock, ps, info = go_live(4, "ffa", {"scoring": {"frag_limit": 2, "win_by": "kills"}})
    g = info["go_live_t"]
    def death(victim_i, killer_i, t, seq, batch=False):
        ev = {"type": "death", "t": t, "match_id": info["match_id"], "player_id": ps[victim_i]["player_id"],
              "shooter_num": ps[killer_i]["player_num"], "shooter_team": 1, "seq": seq}
        if batch:
            return ev
        net.simulate_event(f"node{victim_i}", ev, t, seq=seq)
    death(2, 0, g + 1000, 1)
    death(2, 0, g + 2000, 2)
    assert s.phase == "recap", "A reached the cap in coverage and MC ended the match"
    assert s.scorer.end_t == g + 2000 and s.recap()["winner"]["player_id"] == ps[0]["player_id"]
    late = [death(3, 1, g + 500, 1, batch=True), death(3, 1, g + 900, 2, batch=True)]
    return s, net, clock, ps, info, g, late


def test_a_late_flush_moves_the_end_earlier_and_unscores_what_followed():
    """THE case. B's cap kill at +0.9 s happened BEFORE A's at +2.0 s — MC just did not know. When it
    arrives, the end moves back to +0.9 s, A's two kills fall after it and stop counting, and B is the
    winner. Everything MC scored after that moment is un-scored, not patched."""
    s, net, clock, ps, info, g, late = _late_cap_scenario()
    clock["t"] = g + 300_000                              # four minutes later, the outbox drains
    net.simulate_node_message("node3", "event_batch", {"events": late}, clock["t"])

    assert s.scorer.end_t == g + 900, f"the end did not move: {s.scorer.end_t - g}"
    rows = {r["player_id"]: r for r in s.recap()["rows"]}
    assert rows[ps[1]["player_id"]]["kills"] == 2, "B's two kills are inside the match"
    assert rows[ps[0]["player_id"]]["kills"] == 0, "A's kills landed after the new end and are un-scored"
    assert s.recap()["winner"]["player_id"] == ps[1]["player_id"]
    assert s.last_recap["winner"]["player_id"] == ps[1]["player_id"], "the STORED recap moved too"


def test_the_unscored_kills_survive_as_an_after_the_whistle_block():
    """They are real facts — A did shoot C twice — so they are reported, clearly separated, and they
    feed nothing: not kills, not streaks, not medals, not the winner."""
    s, net, clock, ps, info, g, late = _late_cap_scenario()
    clock["t"] = g + 300_000
    net.simulate_node_message("node3", "event_batch", {"events": late}, clock["t"])
    ae = s.recap()["after_end"]
    assert ae["facts"] == 2, ae
    assert ae["by_player"][ps[0]["player_id"]] == {"kills": 2, "deaths": 0}
    assert ae["by_player"][ps[2]["player_id"]] == {"kills": 0, "deaths": 2}
    rows = {r["player_id"]: r for r in s.recap()["rows"]}
    assert rows[ps[0]["player_id"]]["after_end_kills"] == 2 and rows[ps[0]["player_id"]]["kills"] == 0
    assert rows[ps[2]["player_id"]]["after_end_deaths"] == 2


def test_the_field_is_re_told_the_result_when_the_replay_changes_it():
    """A24: `result` is re-sent whenever the recap moves. A player who was told WIN at the whistle has
    to be told the match was re-scored — the alternative is two phones showing two different winners."""
    s, net, clock, ps, info, g, late = _late_cap_scenario()
    first = results(net)
    assert first["node0"]["outcome"] == "win" and first["node1"]["outcome"] == "lose"
    clock["t"] = g + 300_000
    net.simulate_node_message("node3", "event_batch", {"events": late}, clock["t"])
    after = results(net)
    assert after["node0"]["outcome"] == "lose", "A was told the re-scored result"
    assert after["node1"]["outcome"] == "win", "B was told they actually won"
    assert after["node0"]["after_end"]["facts"] == 2
    assert any("END MOVED BACK" in e["text"] for e in s.feed), "the operator is told the end moved"


def test_a_host_end_and_a_timed_end_are_never_re_derived():
    """A6.1: a whistle and a clock are moments the whole field lived through. A late fact updates the
    tallies (it always has) but must not move the END, or a match could re-end in the past."""
    s, net, clock, ps, info = go_live(3, "ffa", {"scoring": {"frag_limit": 9, "win_by": "kills"}})
    g = info["go_live_t"]
    clock["t"] = g + 5000
    s.control("end")
    end_t = s.scorer.end_t
    assert s.end_reason == "host"
    net.simulate_node_message("node2", "event_batch", {"events": [
        {"type": "death", "t": g + 1000, "match_id": info["match_id"], "player_id": ps[2]["player_id"],
         "shooter_num": ps[1]["player_num"], "shooter_team": 1, "seq": 7}]}, g + 200_000)
    assert s.scorer.end_t == end_t, "a host END is not a cap and does not move"
    assert {r["player_id"]: r["kills"] for r in s.recap()["rows"]}[ps[1]["player_id"]] == 1, "but it still scores"


def test_two_cap_kills_inside_the_clock_band_are_a_tie():
    """contracts §7: phone clocks agree to well under a second, so inside `CLOCK_TIE_MS` MC cannot
    order two kills — and must not pretend to. Both sides are at the cap; that is a draw."""
    s, net, clock, ps, info = go_live(4, "ffa", {"scoring": {"frag_limit": 1, "win_by": "kills"}})
    g = info["go_live_t"]
    net.simulate_event("node2", {"type": "death", "t": g + 5000, "match_id": info["match_id"],
                                 "player_id": ps[2]["player_id"], "shooter_num": ps[0]["player_num"],
                                 "shooter_team": 1}, g + 5000, seq=1)
    assert s.phase == "recap" and s.scorer.end_t == g + 5000
    # B's cap kill lands 400 ms later — inside the band, so it is post_end AND a dead heat.
    net.simulate_node_message("node3", "event_batch", {"events": [
        {"type": "death", "t": g + 5400, "match_id": info["match_id"], "player_id": ps[3]["player_id"],
         "shooter_num": ps[1]["player_num"], "shooter_team": 1, "seq": 1}]}, g + 60_000)
    w = s.recap()["winner"]
    assert w.get("tie") == sorted([ps[0]["player_id"], ps[1]["player_id"]]), w
    assert w.get("player_id") is None
    got = results(net)
    assert got["node0"]["outcome"] == "draw" and got["node1"]["outcome"] == "draw"
    assert got["node2"]["outcome"] == "lose"
    # CONTROL: the same kill one tolerance LATER is just a late kill, and A keeps the win.
    s2, net2, clock2, ps2, info2 = go_live(4, "ffa", {"scoring": {"frag_limit": 1, "win_by": "kills"}})
    g2 = info2["go_live_t"]
    net2.simulate_event("node2", {"type": "death", "t": g2 + 5000, "match_id": info2["match_id"],
                                  "player_id": ps2[2]["player_id"], "shooter_num": ps2[0]["player_num"],
                                  "shooter_team": 1}, g2 + 5000, seq=1)
    net2.simulate_node_message("node3", "event_batch", {"events": [
        {"type": "death", "t": g2 + 5000 + CLOCK_TIE_MS + 500, "match_id": info2["match_id"],
         "player_id": ps2[3]["player_id"], "shooter_num": ps2[1]["player_num"], "shooter_team": 1, "seq": 1}]},
        g2 + 60_000)
    assert s2.recap()["winner"]["player_id"] == ps2[0]["player_id"], s2.recap()["winner"]


def test_rows_csv_reports_the_after_the_whistle_columns_last():
    """The export is where a late flush is otherwise invisible. The two columns are LAST so nothing in
    the official half of the row can be read as including them."""
    head, row = rows_csv([{"display": "ALPHA", "kills": 3, "after_end_kills": 2, "after_end_deaths": 1}]).splitlines()
    assert head.endswith("medals,after_end_kills,after_end_deaths")
    assert row.split(",")[-2:] == ["2", "1"]
    # an ARCHIVED row predates the fields and exports 0 for them rather than failing
    assert rows_csv([{"display": "OLD", "kills": 1}]).splitlines()[1].split(",")[-2:] == ["0", "0"]


# ---------------------------------------------------------------------------------------------
# A31 — the "verify at MC" pre-game warning
# ---------------------------------------------------------------------------------------------
def _armed(cfg=None, backhaul=False, coverage=None):
    s, net, clock, ps = mk(2, (cfg or {}).pop("mode", "tdm"), cfg)
    if coverage:
        s.set_config({"coverage": coverage})
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    for nv in s.nodes.values():
        nv["backhaul"] = backhaul
    return s, net, ps


def test_mc_verify_is_present_only_when_mc_decides_the_end_off_grid():
    """A31: three conditions, all required. A frag cap is MC's call, the venue is not covered, and a
    phone that cannot reach MC will never hear the result — so tell the player up front."""
    s, _net, _ps = _armed({"scoring": {"frag_limit": 7, "win_by": "kills"}})
    assert s.game_brief()["mc_verify"] == C.MC_VERIFY_PLAYER
    notice = s.snapshot()["notices"]["mc_verify"]
    assert notice.startswith("WIN IS CONFIRMED AT MC · 2 PHONES OFF-GRID")
    assert "OP0" in notice and "OP1" in notice, f"the host's copy names the phones: {notice}"
    # and it rides the kit-out push the phone actually reads
    assert s._assign_body(list(s.players.values())[0])["game"]["mc_verify"] == C.MC_VERIFY_PLAYER


def test_mc_verify_is_absent_under_full_coverage_or_with_backhaul_or_on_a_timed_match():
    covered, _n, _p = _armed({"scoring": {"frag_limit": 7, "win_by": "kills"}}, coverage="full")
    assert "mc_verify" not in covered.game_brief() and covered.snapshot()["notices"] == {}
    wired, _n, _p = _armed({"scoring": {"frag_limit": 7, "win_by": "kills"}}, backhaul=True)
    assert "mc_verify" not in wired.game_brief(), "every phone can be reached; there is nothing to warn about"
    timed, _n, _p = _armed({"scoring": {"frag_limit": None, "win_by": "kills"}})
    assert "mc_verify" not in timed.game_brief(), "a timed kills match ends on every phone's own clock"


def test_mc_verify_covers_objective_and_survival_ends_too():
    """An objective win is merged at MC from the nodes' possession reports, and a survival win is a
    fact about the whole field — neither is something a phone can work out alone."""
    obj, _n, _p = _armed({"mode": "koth", "scoring": {"win_by": "objective"}, "station_source": "grenade"})
    assert obj.game_brief()["mc_verify"] == C.MC_VERIFY_PLAYER
    surv, _n, _p = _armed({"mode": "lms"})
    assert surv.game_brief()["mc_verify"] == C.MC_VERIFY_PLAYER
    assert C.mc_decided_end({"mode": "tdm", "scoring": {"win_by": "kills"}}) is False


# ---------------------------------------------------------------------------------------------
# A24/M2 — what the replay must NOT take from the live session
# ---------------------------------------------------------------------------------------------
def test_the_replay_scores_the_teams_the_field_actually_wore():
    """`_replay` built its Scorer from `old.players`, which IS `self.players` — the LIVE roster.

    So a re-team made during the debrief (the operator setting up the next match, or fixing a name)
    silently re-teamed the match that was already played, and the next late flush replayed it on sides
    nobody wore. Here yellow's cap kills land late; if the replay reads the live roster it sees their
    scorer on BLUE, calls both kills friendly fire, finds no cap at all and leaves blue the winner.
    """
    s, net, clock, ps, info = go_live(4, "tdm", {"scoring": {"frag_limit": 2, "win_by": "kills"}})
    g = info["go_live_t"]
    blue, yellow = ps[0]["team_id"], ps[1]["team_id"]
    assert blue != yellow and ps[2]["team_id"] == blue and ps[3]["team_id"] == yellow
    # BLUE reaches the cap in coverage: ps[0] kills ps[1] twice.
    for n, t in enumerate((g + 1000, g + 2000), start=1):
        net.simulate_event("node1", {"type": "death", "t": t, "match_id": info["match_id"],
                                     "player_id": ps[1]["player_id"], "shooter_num": ps[0]["player_num"],
                                     "shooter_team": 1}, t, seq=n)
    assert s.phase == "recap" and s.recap()["winner"]["team_id"] == blue

    # The operator re-teams the yellow player in the DEBRIEF — next match, not this one.
    s.patch_player(ps[1]["player_id"], team_id=blue)
    assert s.players[ps[1]["player_id"]]["team_id"] == blue

    # …and only now does yellow's node flush the two kills that reached the cap FIRST.
    clock["t"] = g + 300_000
    net.simulate_node_message("node2", "event_batch", {"events": [
        {"type": "death", "t": g + 400, "match_id": info["match_id"], "player_id": ps[2]["player_id"],
         "shooter_num": ps[1]["player_num"], "shooter_team": 2, "seq": 1},
        {"type": "death", "t": g + 900, "match_id": info["match_id"], "player_id": ps[2]["player_id"],
         "shooter_num": ps[1]["player_num"], "shooter_team": 2, "seq": 2}]}, clock["t"])

    assert s.scorer.end_t == g + 900, f"the end did not move: {s.scorer.end_t - g}"
    assert s.recap()["winner"]["team_id"] == yellow, s.recap()["winner"]
    assert s.scorer.stats[ps[1]["player_id"]].team_id == yellow, "the replay wore the recap's teams"
    assert s.scorer.stats[ps[1]["player_id"]].kills == 2, "two clean kills, not two friendly fires"


def test_the_replay_keeps_the_parked_count():
    """Facts for ANOTHER match — a phone still flushing the previous one — never reach the replay:
    `_match_facts` reads THIS match_id only. The count the recap reports must survive anyway, or the
    operator's one signal that a phone is a match behind vanishes the moment a late fact lands."""
    s, net, clock, ps, info, g, late = _late_cap_scenario()
    net.simulate_node_message("node2", "event_batch", {"events": [
        {"type": "death", "t": g + 100, "match_id": "some-older-match", "player_id": ps[2]["player_id"],
         "shooter_num": ps[0]["player_num"], "shooter_team": 1, "seq": 90}]}, g + 250_000)
    assert s.recap()["parked"] == 1, s.recap()["parked"]
    clock["t"] = g + 300_000
    net.simulate_node_message("node3", "event_batch", {"events": late}, clock["t"])
    assert s.scorer.end_t == g + 900, "the reconcile ran"
    assert s.recap()["parked"] == 1, "a reconcile must not forget the facts it could not score"


def test_a_late_fact_after_a_reconcile_still_reaches_the_operator_s_feed():
    """The replayed Scorer is built with NO callbacks (it must never re-fire a cue at a player standing
    in the debrief) — and it was then adopted as the live scorer with those callbacks still absent. So
    the FIRST late flush reconciled loudly and every one after it landed in silence: the operator's feed
    stopped naming late kills exactly when the recap was moving under them."""
    s, net, clock, ps, info, g, late = _late_cap_scenario()
    clock["t"] = g + 300_000
    net.simulate_node_message("node3", "event_batch", {"events": late}, clock["t"])
    assert s.scorer.end_t == g + 900, "the reconcile ran"
    before = len(s.feed)
    # a SECOND late flush, inside the new scored window, from the fourth phone
    net.simulate_node_message("node2", "event_batch", {"events": [
        {"type": "death", "t": g + 800, "match_id": info["match_id"], "player_id": ps[2]["player_id"],
         "shooter_num": ps[3]["player_num"], "shooter_team": 2, "seq": 40}]}, g + 320_000)
    new = s.feed[:len(s.feed) - before]
    assert any("eliminated" in e["text"] for e in new), [e["text"] for e in s.feed[:4]]
    assert s.scorer.on_feed is not None and s.scorer.feed, "the adopted scorer keeps its own feed too"


def test_the_replay_reads_facts_not_heartbeats():
    """`_match_facts` used to read EVERY envelope of the match back and `json.loads` each one, twice per
    late death (a probe pass and a frozen pass), only to throw the heartbeats away. A ten-minute match
    is mostly heartbeats. The filter is SQL now, so the heartbeats never leave the database."""
    import time
    s, net, clock, ps, info, g, late = _late_cap_scenario()
    mid = info["match_id"]
    # A realistic match's worth of status heartbeats around the handful of facts.
    for i in range(5000):
        s.store.log(f"node{i % 4}", "status", None, g + i * 100, g + i * 100, mid, 0,
                    {"match_id": mid, "shots": i, "alive": True, "hp": 45})
    rows = s.store.events(match_id=mid, kinds=s._FACT_KINDS)
    assert rows and not [r for r in rows if r["kind"] == "status"], "the query still returned heartbeats"
    assert {r["kind"] for r in rows} <= set(s._FACT_KINDS)
    # and the reconcile stays cheap: 200 late facts on that match, each re-deriving the whole recap.
    t0 = time.monotonic()
    for n in range(200):
        clock["t"] = g + 300_000 + n
        net.simulate_node_message("node3", "event_batch", {"events": [
            {"type": "death", "t": g + 800, "match_id": mid, "player_id": ps[3]["player_id"],
             "shooter_num": ps[1]["player_num"], "shooter_team": 2, "seq": 500 + n}]}, clock["t"])
    took = time.monotonic() - t0
    assert took < 2.0, f"200 late facts on a 5000-envelope match took {took:.1f}s"


def test_the_venue_survives_a_mode_change():
    """A31: `coverage` is a fact about the SITE, not the game. `set_config` swaps in `default_config()`
    on a mode change, which knows the mode's defaults and nothing about where anyone is standing — so
    picking a new mode on Build reset the venue. The UI re-sent `environment` and `night` in the same
    patch and hid two thirds of it; `coverage` it did not, so a full-coverage site quietly became
    partial and the verify-at-MC warning appeared out of nowhere on a match that had never earned it.
    """
    s, _net, _clock, _ps = mk(2, "tdm")
    s.set_config({"environment": "indoor", "night": True, "coverage": "full"})
    assert "mc_verify" not in s.set_config({"mode": "tdm", "scoring": {"frag_limit": 5, "win_by": "kills"}})["config"]
    s.set_config({"mode": "ffa"})                     # the operator picks a different game, same field
    assert s.config["coverage"] == "full", s.config.get("coverage")
    assert s.config["environment"] == "indoor" and s.config["night"] is True
    s.set_config({"mode": "koth", "coverage": "partial"})   # …and a patch that NAMES it still wins
    assert s.config["coverage"] == "partial"
    # a venue MC was never told about stays untold — the key is absent, not invented
    s2, _n2, _c2, _p2 = mk(2, "tdm")
    s2.set_config({"mode": "ffa"})
    assert "coverage" not in s2.config


# ---------------------------------------------------------------------------------------------
# A24/M2 round-2 — the RESULT is addressed to the roster as it was WORN, not as it is now
# ---------------------------------------------------------------------------------------------
def test_the_result_tells_a_re_teamed_player_the_outcome_of_the_side_they_wore():
    """`_replay` was fixed to score the frozen roster, but the RESULT still read the live one.

    So the replay could hand the win to yellow, and the very same flush could push the player who won
    it `outcome: "lose"` — because the operator had already moved them to blue for the next match. The
    recipient's side is a fact about the match that was played, so it comes from `_match_players`.
    """
    s, net, clock, ps, info = go_live(4, "tdm", {"scoring": {"frag_limit": 2, "win_by": "kills"}})
    g = info["go_live_t"]
    blue, yellow = ps[0]["team_id"], ps[1]["team_id"]
    for n, t in enumerate((g + 1000, g + 2000), start=1):
        net.simulate_event("node1", {"type": "death", "t": t, "match_id": info["match_id"],
                                     "player_id": ps[1]["player_id"], "shooter_num": ps[0]["player_num"],
                                     "shooter_team": 1}, t, seq=n)
    assert s.phase == "recap" and results(net)["node1"]["outcome"] == "lose"

    s.patch_player(ps[1]["player_id"], team_id=blue)          # the DEBRIEF re-team, for the next match
    clock["t"] = g + 300_000
    net.simulate_node_message("node2", "event_batch", {"events": [
        {"type": "death", "t": g + 400, "match_id": info["match_id"], "player_id": ps[2]["player_id"],
         "shooter_num": ps[1]["player_num"], "shooter_team": 2, "seq": 1},
        {"type": "death", "t": g + 900, "match_id": info["match_id"], "player_id": ps[2]["player_id"],
         "shooter_num": ps[1]["player_num"], "shooter_team": 2, "seq": 2}]}, clock["t"])

    got = results(net)
    assert s.recap()["winner"]["team_id"] == yellow, s.recap()["winner"]
    assert got["node1"]["outcome"] == "win", "the player who WON it was told they lost, on a recap re-team"
    assert got["node3"]["outcome"] == "win", "their team-mate wore yellow too"
    assert got["node0"]["outcome"] == "lose" and got["node2"]["outcome"] == "lose"


def test_a_player_added_during_the_debrief_is_told_no_result_at_all():
    """`add_player` has no recap guard: it registered into the FINISHED scorer and was auto-assigned a
    team, so the next push told somebody who was standing in the car park that they had won a match
    they never played — and put a 0/0 row in the archived recap. They get no `result` (their HUD shows
    the neutral "no result for you" state) and the recap rows stay the roster that played.
    """
    s, net, clock, ps, info = go_live(2, "tdm")
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    s.control("end")
    rows_before = sorted(r["player_id"] for r in s.recap()["rows"])

    late = s.add_player("LATECOMER", gun_id="GUN-C")
    welcome = net.simulate_hello("node2", f"GUN-C-{demo_armory()[2]['ble']['tail']}")

    assert welcome is not None and "result" not in welcome, \
        "the welcome handed a match result to a player who was not in it"
    assert "node2" not in results(net), "a `result` was pushed to a player who never played"
    assert sorted(r["player_id"] for r in s.recap()["rows"]) == rows_before, \
        "the finished match grew a row for somebody who arrived after the whistle"
    # …and the two who DID play are still told, unchanged
    assert [results(net)[f"node{i}"]["outcome"] for i in (0, 1)] == ["win", "lose"]


def test_a_late_friendly_kill_never_moves_the_whistle_FORWARD():
    """`_reconcile_end` clamped nothing: it adopted whatever `cap_t` the probe found.

    A late friendly-fire death inside the tie band SUBTRACTS a kill, so the cap is reached LATER on
    the re-derived facts — and the end moved forward, promoting kills the live scorer had parked as
    after-the-whistle into the official tally, minutes after the field was told `control{end}`.
    Contracts §4 lets the end move EARLIER only.
    """
    s, net, clock, ps, info = go_live(4, "tdm", {"scoring": {"frag_limit": 3, "win_by": "kills"}})
    g = info["go_live_t"]
    for n, t in enumerate((g + 1000, g + 2000, g + 3000), start=1):     # blue caps at g+3000
        net.simulate_event("node1", {"type": "death", "t": t, "match_id": info["match_id"],
                                     "player_id": ps[1]["player_id"], "shooter_num": ps[0]["player_num"],
                                     "shooter_team": 1}, t, seq=n)
    assert s.phase == "recap" and s.scorer.end_t == g + 3000
    # one more blue kill, well after the whistle: parked, reported, never counted
    net.simulate_event("node1", {"type": "death", "t": g + 5000, "match_id": info["match_id"],
                                 "player_id": ps[1]["player_id"], "shooter_num": ps[0]["player_num"],
                                 "shooter_team": 1}, g + 5000, seq=4)
    assert s.scorer.end_t == g + 3000

    # …and now a TEAM kill from mid-match flushes late: blue loses a kill, so on the re-derived facts
    # the cap falls at g+5000 instead of g+3000.
    clock["t"] = g + 300_000
    net.simulate_node_message("node2", "event_batch", {"events": [
        {"type": "death", "t": g + 1500, "match_id": info["match_id"], "player_id": ps[2]["player_id"],
         "shooter_num": ps[0]["player_num"], "shooter_team": 1, "seq": 1}]}, clock["t"])

    assert s.scorer.end_t == g + 3000, \
        f"the whistle moved FORWARD to +{(s.scorer.end_t - g) / 1000:.1f}s — the field had already gone home"
    ae = s.recap().get("after_end") or {}
    assert ae.get("facts"), "the post-whistle kill was promoted into the official tally"
