"""A88 (brx5 and brx4, 2026-11-07): the phones relay each Domination hill's own tally to MC as a persisted `hill_tally`
fact. This file pins the contract: MC's socket takes the fact and refuses one without its required fields.

Run: python3 run_tests.py mc_hill_tally
"""
from _session import mc_session
from brx_mcp.mc.envelope import EnvelopeError, validate_event

_sess = mc_session


def _tally(**over):
    return {"type": "hill_tally", "t": 1_800_000_000_000, "match_id": "m1", "node_id": "n1", "player_id": "p1",
            "site": "1", "game_byte": 3, "own_s": {"0": 40, "1": 12}, "final": True, "partial": False,
            "heard_age_ms": 900, **over}


def test_the_socket_takes_a_hill_tally_and_refuses_one_missing_a_required_field():
    assert validate_event(_tally())["type"] == "hill_tally"
    validate_event({k: v for k, v in _tally().items() if k not in ("partial", "heard_age_ms")})   # both optional
    for key in ("site", "game_byte", "own_s", "final"):
        try:
            validate_event({k: v for k, v in _tally().items() if k != key})
        except EnvelopeError as e:
            assert key in str(e), (key, e)
        else:
            raise AssertionError(f"a hill_tally without {key} was accepted")


# ---------- the merge (brx1 2026-11-07, option b) ----------
from _domination import domination_live, own_fact   # noqa: E402

_SEQ = {"n": 9000}


def _hill_tally(s, net, clock, node, hill, own_s, final, game_byte=None, mid=None):
    _SEQ["n"] += 1
    site = str(s.station_registry.stations[hill]["assigned"]["id"])
    net.simulate_event(node, {"type": "hill_tally", "t": clock["t"], "match_id": mid or s._m().scorer.match_id,
                              "site": site, "game_byte": s._m().scorer.game_byte if game_byte is None else game_byte,
                              "own_s": {str(k): v for k, v in own_s.items()}, "final": final}, clock["t"], seq=_SEQ["n"])
    return site


def _ended_with_red_on_a(stored=False):
    """Red takes hill A at 10 s, heard by phone 0. Phone 1 alone saw blue drain A at 20 s and take it at 21 s, and its
    phone died: MC never hears it. The operator ends the match at 300 s. The phones' timeline says red 290."""
    s, net, clock = domination_live("domination", 1000, stored=stored)
    go = s._m().head["go_live_t"]
    r, b = (t["tid"] for t in s.config["teams"][:2])
    own_fact(s, net, clock, "node0", "util-a", 2, r, at=go + 10_000)
    clock["t"] = go + 300_000
    s.control("end")
    assert s.phase == "recap"
    return s, net, clock, r, b


def _by(s):
    return (s.recap() or {}).get("possession", {}).get("by_team", {})


def test_a_final_tally_scores_a_capture_only_a_dead_phone_saw_and_the_row_keeps_the_timeline():
    s, net, clock, r, b = _ended_with_red_on_a()
    red, blue = (t["team_id"] for t in s.config["teams"][:2])
    assert _by(s) == {red: 290, blue: 0}, _by(s)
    clock["t"] += 600_000   # phone 0 walks past the hill ten minutes later; a final tally is never too late
    site = _hill_tally(s, net, clock, "node0", "util-a", {r: 10, b: 279}, True)
    rc = s.recap()
    assert rc["possession"]["by_team"] == {red: 10, blue: 279}, rc["possession"]
    assert rc["possession"]["from_tally"] == {site: {red: 290}}, rc["possession"]
    assert s._m().scorer.winner() == {"team_id": blue}, s._m().scorer.winner()   # the recap shows it once released


def test_a_final_tally_that_agrees_with_a_complete_timeline_does_not_replace_it():
    s, net, clock, r, b = _ended_with_red_on_a()
    red, blue = (t["team_id"] for t in s.config["teams"][:2])
    _hill_tally(s, net, clock, "node0", "util-a", {r: 292}, True)   # within 1 s a change plus 3 s
    rc = s.recap()
    assert rc["possession"]["by_team"] == {red: 290, blue: 0} and "from_tally" not in rc["possession"], rc["possession"]


def test_a_live_tally_never_changes_the_score_and_never_follows_a_final():
    s, net, clock, r, b = _ended_with_red_on_a()
    red, blue = (t["team_id"] for t in s.config["teams"][:2])
    _hill_tally(s, net, clock, "node0", "util-a", {r: 10, b: 279}, False)
    assert _by(s) == {red: 290, blue: 0}, "only a final tally scores"
    _hill_tally(s, net, clock, "node0", "util-a", {r: 10, b: 285}, True)
    _hill_tally(s, net, clock, "node1", "util-a", {r: 10, b: 279}, True)   # a later final, trimmed further, replaces it
    _hill_tally(s, net, clock, "node0", "util-a", {r: 10, b: 299}, False)  # a live tally after the final: ignored
    assert _by(s) == {red: 10, blue: 279}, _by(s)


def test_a_tally_of_another_game_byte_is_ignored():
    s, net, clock, r, b = _ended_with_red_on_a()
    red, blue = (t["team_id"] for t in s.config["teams"][:2])
    _hill_tally(s, net, clock, "node0", "util-a", {b: 279}, True, game_byte=(s._m().scorer.game_byte % 255) + 1)
    assert _by(s) == {red: 290, blue: 0}, _by(s)


def test_a_hill_no_phone_reported_scores_from_its_final_tally_and_its_row_says_so():
    s, net, clock, r, b = _ended_with_red_on_a()
    red, blue = (t["team_id"] for t in s.config["teams"][:2])
    site = _hill_tally(s, net, clock, "node1", "util-b", {b: 120}, True)
    rc = s.recap()
    assert rc["possession"]["by_team"] == {red: 290, blue: 120}, rc["possession"]
    assert rc["possession"]["from_tally"] == {site: {}}, rc["possession"]


def test_a_hill_is_in_on_the_sync_track_once_its_final_tally_arrives():
    s, net, clock, r, b = _ended_with_red_on_a()
    site = str(s.station_registry.stations["util-a"]["assigned"]["id"])
    row = lambda: next(x for x in s.recap()["sync"]["rows"] if x["kind"] == "station" and x["id"] == site)   # noqa: E731
    assert row()["stage"] != "received", row()
    _hill_tally(s, net, clock, "node0", "util-a", {r: 290}, True)
    assert row()["stage"] == "received", row()


def test_the_phones_are_told_to_relay_tallies_in_domination_only():
    s, net, clock, r, b = _ended_with_red_on_a()
    assert s._wire_config().get("hill_tally") is True
    s2, _net, _clock = domination_live("koth", 1000)
    assert "hill_tally" not in s2._wire_config()


def test_a_restart_after_the_next_push_keeps_the_matchs_own_game_byte():
    """The next push moves MC's game byte; the ended match keeps the one its hills tallied under, through a restart."""
    import pathlib
    import tempfile
    from _session import restart_session
    s, net, clock, r, b = _ended_with_red_on_a(stored=True)
    red, blue = (t["team_id"] for t in s.config["teams"][:2])
    gb = s._m().scorer.game_byte
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    _hill_tally(s, net, clock, "node0", "util-a", {r: 10, b: 279}, True)
    s._bump_game_no()
    assert s._game_byte() != gb
    s2, net2 = restart_session(s, clock)
    assert s2.resume_match() == "recap"
    assert s2._m().scorer.game_byte == gb, (s2._m().scorer.game_byte, gb)
    assert _by(s2) == {red: 10, blue: 279}, _by(s2)


def test_an_empty_final_tally_clears_a_hill_nobody_owned():
    """Codex review: a final tally of {} (the hill was never owned) must take the hill's points to 0, not keep the
    phones' timeline behind an `or`."""
    s, net, clock, r, b = _ended_with_red_on_a()
    red, blue = (t["team_id"] for t in s.config["teams"][:2])
    site = _hill_tally(s, net, clock, "node0", "util-a", {}, True)
    rc = s.recap()
    assert rc["possession"]["by_team"] == {red: 0, blue: 0}, rc["possession"]
    assert rc["possession"]["from_tally"] == {site: {red: 290}}, rc["possession"]


def test_two_finals_keep_the_most_trimmed_whatever_order_they_arrive_in_and_across_a_restart():
    """Codex review: live play kept the last final to arrive, a replay the last by timestamp, so a restart could change
    the winner. A hill only trims its final down, so MC keeps the final with the least banked, in any order."""
    import pathlib
    import tempfile
    from _session import restart_session
    for order in ((100, 98), (98, 100)):
        s, net, clock, r, b = _ended_with_red_on_a(stored=True)
        red, blue = (t["team_id"] for t in s.config["teams"][:2])
        s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
        t0 = clock["t"]
        for i, secs in enumerate(order):
            clock["t"] = t0 + 5_000 - i * 4_000   # the second arrives later but carries an earlier phone timestamp
            _hill_tally(s, net, clock, f"node{i}", "util-a", {r: secs}, True)
        clock["t"] = t0 + 10_000
        assert _by(s)[red] == 98, (order, _by(s))
        s2, _ = restart_session(s, clock)
        assert s2.resume_match() == "recap"
        assert _by(s2)[red] == 98, (order, _by(s2))
