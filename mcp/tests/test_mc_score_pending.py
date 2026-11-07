"""Domination FINAL SCORE PENDING (Tony 2026-11-07 via brx1): Domination is scored from the phones' `own_change` reports,
so a phone out of Wi-Fi at the whistle may hold a capture MC has not heard, and MC could name the wrong winner. When the
match ends on its target or its clock with a bound phone silent for SCORE_SILENT_MS, MC holds the result: no winner on
the console, no `result` to the phones, and no 120 s bound. Late reports rebuild the timeline; the result goes out when
every phone is in, or when the operator presses END NOW (`finalise_recap`). Hills do not block it (they are not the
score). KOTH and a Domination match with every phone in Wi-Fi keep the A83 bound.

Run: python3 run_tests.py mc_score_pending
"""
import json
import pathlib
import tempfile

from _session import after_end, mc_session, node_heartbeat, restart_session, results
from _domination import domination_live, own_fact

_sess = mc_session


def _pids(s):
    return {p["node_id"]: pid for pid, p in s.players.items() if p.get("node_id")}


def _mono(s):
    mono = {"t": 1_000_000}
    s.mono_ms = lambda: mono["t"]
    return mono


def _keep_fresh(s, net, clock, nid):
    node_heartbeat(net, clock, nid, _pids(s)[nid], "live", s._m().head["match_id"])


def _red_to_target(s, net, clock, silent=True):
    """Red takes hills A and B at 10 s, heard only by node0, and reaches 1000 points at 510 s. node1 is out of Wi-Fi
    from 5 s when `silent`; else it beats on. Returns the match id and the go-live time."""
    r = s.config["teams"][0]["tid"]
    go, mid = s._m().head["go_live_t"], s._m().head["match_id"]
    own_fact(s, net, clock, "node0", "util-a", 2, r, at=go + 10_000)
    own_fact(s, net, clock, "node0", "util-b", 2, r, at=go + 10_000)
    for t in (go + 509_000, go + 511_000):
        clock["t"] = t
        _keep_fresh(s, net, clock, "node0")
        if not silent:
            _keep_fresh(s, net, clock, "node1")
        s.tick()
    assert s.phase == "recap" and s.end_reason == "hold_target", (s.phase, s.end_reason)
    return mid, go


def _sync(s):
    return s.recap()["sync"]


def test_a_target_reached_with_a_phone_silent_holds_the_result_until_its_reports_change_the_winner():
    """MC saw red at 1000. node1, out of Wi-Fi, saw blue drain both hills at 20 s and take them at 21 s. MC must not name
    red: the result waits past the old 120 s bound, then the late reports make blue the winner, and only then do the
    phones get a result."""
    s, net, clock = domination_live("domination", 1000)
    mono = _mono(s)
    r, b = s.config["teams"][0]["tid"], s.config["teams"][1]["tid"]
    mid, go = _red_to_target(s, net, clock)
    view = s.recap()
    assert view["winner"] is None, view["winner"]
    sync = view["sync"]
    assert sync["pending"] and sync.get("score_pending") is True and "release_in_s" not in sync, sync
    clock["t"] += 2_000
    net.simulate_status("node0", after_end(s, {"player_id": _pids(s)["node0"], "pending": 0}), clock["t"])
    mono["t"] += 200_000          # past the 120 s bound: a held result does not release on it
    clock["t"] += 200_000
    s.tick()
    assert _sync(s)["pending"] and s.recap()["winner"] is None, _sync(s)
    assert not results(net), "no phone is told a winner that may change"
    for hill in ("util-a", "util-b"):   # node1 back in Wi-Fi: its two steps on each hill
        own_fact(s, net, clock, "node1", hill, r, 2, at=go + 20_000, mid=mid)
        own_fact(s, net, clock, "node1", hill, 2, b, at=go + 21_000, mid=mid)
    net.simulate_status("node1", after_end(s, {"player_id": _pids(s)["node1"], "pending": 0}), clock["t"])
    view = s.recap()
    assert not view["sync"]["pending"] and view["sync"]["released_by"] == "sync", view["sync"]
    blue = s.config["teams"][1]["team_id"]
    assert view["winner"] == {"team_id": blue}, view["winner"]
    sent = results(net)
    assert sent and all(body["winner"].get("team_id") == blue for body in sent.values()), sent


def test_every_phone_in_wifi_at_the_target_ends_as_before_with_the_bound():
    s, net, clock = domination_live("domination", 1000)
    _mono(s)
    _red_to_target(s, net, clock, silent=False)
    sync = _sync(s)
    assert "score_pending" not in sync and sync.get("release_in_s") == 120, sync


def test_end_now_declares_from_what_mc_has_when_a_phone_is_dead():
    s, net, clock = domination_live("domination", 1000)
    _mono(s)
    _red_to_target(s, net, clock)
    assert _sync(s)["pending"]
    s.finalise_recap()
    view = s.recap()
    red = s.config["teams"][0]["team_id"]
    assert not view["sync"]["pending"] and view["sync"]["released_by"] == "finalise", view["sync"]
    assert view["winner"] == {"team_id": red}, view["winner"]


def test_a_time_limit_end_with_a_phone_silent_holds_the_result_too():
    """brx1 2026-11-07: the clock's end has the same gap as the target's."""
    s, net, clock = domination_live("domination", 1000)
    _mono(s)
    go = s._m().head["go_live_t"]
    clock["t"] = go + 1800_000 + 5_000
    _keep_fresh(s, net, clock, "node0")
    s.tick()
    assert s.phase == "recap" and s.end_reason == "time", (s.phase, s.end_reason)
    sync = _sync(s)
    assert sync["pending"] and sync.get("score_pending") is True and "release_in_s" not in sync, sync


def test_koth_with_a_phone_silent_keeps_the_bound():
    s, net, clock = domination_live("koth", 1000)
    _mono(s)
    go = s._m().head["go_live_t"]
    clock["t"] = go + 1800_000 + 5_000
    _keep_fresh(s, net, clock, "node0")
    s.tick()
    assert s.phase == "recap", s.phase
    sync = _sync(s)
    assert "score_pending" not in sync and sync.get("release_in_s") == 120, sync


def test_a_restart_keeps_the_result_held_with_no_bound():
    s, net, clock = domination_live("domination", 1000, stored=True)
    _mono(s)
    _red_to_target(s, net, clock)
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s._persist_last, s._persist_dirty = 0.0, True
    s.persist_now()
    snap = json.loads(s._persist_path.read_text())["match"]
    assert snap.get("score_pending") is True and "release_due_in_ms" not in snap, snap
    s2, _ = restart_session(s, clock)
    mono2 = {"t": 50}
    s2.mono_ms = lambda: mono2["t"]
    assert s2.resume_match() == "recap"
    mono2["t"] += 300_000
    clock["t"] += 300_000
    s2.tick()
    sync = _sync(s2)
    assert sync["pending"] and sync.get("score_pending") is True and "release_in_s" not in sync, sync
    assert s2.recap()["winner"] is None


def test_a_target_or_time_reached_while_mc_was_down_holds_the_result_until_the_phones_are_back():
    """Codex review 2026-11-07: a restart clears the roster's node ids, so the silence check saw no phone and the resumed
    end took the 120 s bound. The check reads the match's own bindings: no phone has spoken to this MC yet."""
    from _session import restart_no_repersist
    for until_ms, reason in ((1_200_000, "hold_target"), (1_810_000, "time")):
        s, net, clock = domination_live("domination", 1000 if reason == "hold_target" else 5000, stored=True)
        s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
        go = s._m().head["go_live_t"]
        own_fact(s, net, clock, "node0", "util-a", 2, s.config["teams"][0]["tid"], at=go + 10_000)
        clock["t"] = go + 20_000
        s.tick()
        s._persist_last = 0.0
        s._persist()
        clock["t"] = go + until_ms                       # MC was down past red's target, or past the clock
        s2, _ = restart_no_repersist(s, clock)
        _mono(s2)
        s2.resume_match()
        s2.tick()
        assert s2.phase == "recap" and s2.end_reason == reason, (s2.phase, s2.end_reason)
        sync = _sync(s2)
        assert sync["pending"] and sync.get("score_pending") is True and "release_in_s" not in sync, (reason, sync)
