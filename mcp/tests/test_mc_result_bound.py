"""A83 (Tony 2026-10-26): the A81 result wait is bounded. SYNC_STUCK_S after the whistle, on MC's monotonic clock,
MC releases the result without the phones and hills still missing; a late sync then merges in, and `result_changed`
reaches the console and the phones. A pending-0 beat counts only when the phone sent it after its own end."""
import json
import pathlib
import tempfile

from _session import after_end, go_live_stored, restart_no_repersist, restart_session
from brx_mcp.mc.fakes import demo_armory
from brx_mcp.mc.types import SYNC_STUCK_S

BOUND_MS = SYNC_STUCK_S * 1000


def _ended(n=2, mode="tdm", persist=False):
    """A match ended with a mocked monotonic clock, so the bound can be walked without the wall clock."""
    s, net, clock, ps, info = go_live_stored(n, mode)
    mono = {"t": 1_000_000}
    s.mono_ms = lambda: mono["t"]
    if persist:
        s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    net.pushed.clear()
    s.control("end")
    return s, net, clock, mono, ps, info


def _beat(s, net, clock, i, pid, pending=0, **body):
    net.simulate_status(f"node{i}", after_end(s, {"player_id": pid, "pending": pending, **body}), clock["t"])


def _sync(s):
    return s.recap()["sync"]


def _row(s, pid):
    return next(r for r in _sync(s)["rows"] if r["id"] == pid)


def test_the_bound_releases_at_sync_stuck_s_without_the_missing_phone():
    s, net, clock, mono, ps, _ = _ended()
    _beat(s, net, clock, 0, ps[0]["player_id"])
    mono["t"] += BOUND_MS - 1
    s.tick()
    sync = _sync(s)
    assert sync["pending"] and sync["released_by"] is None and sync["release_in_s"] == 1
    assert s.recap()["winner"] is None and net.pushes("result") == []
    mono["t"] += 1
    s.tick()
    sync = _sync(s)
    assert not sync["pending"] and sync["released_by"] == "timeout" and "release_in_s" not in sync
    assert not sync["finalised"] and s.match.released
    assert s.recap()["winner"] is not None
    # Released without it: the missing phone's row stays on the track, not received.
    assert _row(s, ps[1]["player_id"])["stage"] != "received"
    assert len(net.pushes("result")) == 2
    # Two minutes is past the 30 s victory window, so the bound never plays a late sting.
    assert [p for p in net.pushes("feedback") if p[2].get("kind") == "victory"] == []


def test_the_bound_counts_on_the_monotonic_clock_not_the_wall_clock():
    s, net, clock, mono, ps, _ = _ended()
    clock["t"] += 10 * BOUND_MS          # the wall clock jumps far ahead: no release
    s.tick()
    assert _sync(s)["pending"]
    clock["t"] -= 20 * BOUND_MS          # and steps far back: the bound still fires on time
    mono["t"] += BOUND_MS
    s.tick()
    assert _sync(s)["released_by"] == "timeout"


def test_every_row_in_releases_by_sync_and_the_bound_does_not_relabel_it():
    s, net, clock, mono, ps, _ = _ended()
    for i, p in enumerate(ps):
        _beat(s, net, clock, i, p["player_id"])
    sync = _sync(s)
    assert not sync["pending"] and sync["released_by"] == "sync" and "release_in_s" not in sync
    mono["t"] += 2 * BOUND_MS
    s.tick()
    assert _sync(s)["released_by"] == "sync"


def test_finalise_still_releases_at_once_and_keeps_its_reason():
    s, net, clock, mono, ps, _ = _ended()
    mono["t"] += 5_000
    assert s.finalise_recap() == {"ok": True}
    sync = _sync(s)
    assert not sync["pending"] and sync["finalised"] and sync["released_by"] == "finalise"
    s.tick()
    assert len(net.pushes("result")) == 2
    mono["t"] += 2 * BOUND_MS
    s.tick()
    assert _sync(s)["released_by"] == "finalise"


def test_a_silent_hill_no_longer_blocks_the_result_past_the_bound():
    s, net, clock, mono, ps, _ = _ended(mode="koth")
    for i, p in enumerate(ps):
        _beat(s, net, clock, i, p["player_id"])
    hill = next(r for r in _sync(s)["rows"] if r["kind"] == "station")
    assert hill["stage"] != "received" and _sync(s)["pending"], "a hill switched off or out of range"
    mono["t"] += BOUND_MS
    s.tick()
    sync = _sync(s)
    assert not sync["pending"] and sync["released_by"] == "timeout"
    assert next(r for r in sync["rows"] if r["kind"] == "station")["stage"] != "received"


def test_a_late_sync_after_the_bound_merges_and_tells_the_phones_result_changed():
    s, net, clock, mono, ps, info = _ended()
    _beat(s, net, clock, 0, ps[0]["player_id"])
    mono["t"] += BOUND_MS
    s.tick()
    first = s.recap()["winner"]
    assert _sync(s)["released_by"] == "timeout" and not _sync(s)["result_changed"]
    assert all(p[2]["result_changed"] is False for p in net.pushes("result"))
    net.pushed.clear()
    clock["t"] += 1
    net.simulate_batch("node1", [{"type": "death", "seq": 51, "t": clock["t"] - 2,
                                  "match_id": info["match_id"], "player_id": ps[1]["player_id"],
                                  "shooter_num": ps[0]["player_num"], "shooter_team": 1}], clock["t"])
    # The late fact pushes before any snapshot re-reads the recap: the push itself must carry the flag.
    pushed = net.pushes("result")
    assert pushed and all(p[2]["result_changed"] is True for p in pushed)
    assert s.recap()["winner"] != first
    sync = _sync(s)
    assert sync["result_changed"] and sync["released_by"] == "timeout" and not sync["pending"]


def test_a_beat_sent_before_the_phones_own_end_is_not_received():
    s, net, clock, mono, ps, info = _ended()
    pid = ps[0]["player_id"]
    net.simulate_status("node0", {"player_id": pid, "pending": 0, "arm_state": "live",
                                  "match_id": info["match_id"]}, clock["t"])
    assert _row(s, pid)["stage"] != "received", "still live: its end facts were not booked yet"
    net.simulate_status("node0", {"player_id": pid, "pending": 0, "arm_state": "armed",
                                  "match_id": info["match_id"]}, clock["t"])
    assert _row(s, pid)["stage"] != "received"
    net.simulate_status("node0", {"player_id": pid, "pending": 0, "arm_state": "kitted",
                                  "match_id": "another-match"}, clock["t"])
    assert _row(s, pid)["stage"] != "received", "a beat about another match"
    net.simulate_status("node0", {"player_id": pid, "pending": 0, "arm_state": "kitted"}, clock["t"])
    assert _row(s, pid)["stage"] != "received", "a beat that names no match"
    net.simulate_status("node0", {"player_id": pid, "pending": 2, "arm_state": "live",
                                  "match_id": info["match_id"]}, clock["t"])
    assert _row(s, pid)["stage"] == "sending" and _row(s, pid)["pending"] == 2, "its count still stands"
    _beat(s, net, clock, 0, pid)
    assert _row(s, pid)["stage"] == "received"


def test_a_restart_keeps_the_time_left_on_the_bound():
    s, net, clock, mono, ps, _ = _ended(persist=True)
    mono["t"] += BOUND_MS - 30_000
    s.recap()
    s._persist_last = 0.0
    s._persist()
    assert json.loads(s._persist_path.read_text())["match"]["release_due_in_ms"] == 30_000
    clock["t"] += 3_600_000              # MC is down an hour; the wall clock is not used to time the rest
    s2, _ = restart_session(s, clock)
    mono2 = {"t": 50}
    s2.mono_ms = lambda: mono2["t"]
    assert s2.resume_match() == "recap"
    mono2["t"] += 29_999
    s2.tick()
    assert _sync(s2)["pending"] and _sync(s2)["release_in_s"] == 1
    mono2["t"] += 1
    s2.tick()
    assert _sync(s2)["released_by"] == "timeout"
    s3, _ = restart_session(s2, clock)
    assert s3.resume_match() == "recap" and _sync(s3)["released_by"] == "timeout"


def test_a_snapshot_from_before_the_bound_is_timed_from_the_whistle():
    s, net, clock, mono, ps, _ = _ended(persist=True)
    s._persist_last = 0.0
    s._persist()
    raw = json.loads(s._persist_path.read_text())
    raw["match"].pop("release_due_in_ms")
    raw["match"].pop("release_reason")
    s._persist_path.write_text(json.dumps(raw))
    clock["t"] += 100_000
    s2, _ = restart_no_repersist(s, clock)
    assert s2.resume_match() == "recap"
    assert _sync(s2)["pending"] and 19 <= _sync(s2)["release_in_s"] <= 20


def test_a_phone_rejoining_after_a_moved_result_keeps_the_flag_in_its_welcome():
    s, net, clock, mono, ps, info = _ended()
    _beat(s, net, clock, 0, ps[0]["player_id"])
    mono["t"] += BOUND_MS
    s.tick()
    tail = demo_armory()[1]["ble"]["tail"]
    welcome = net.simulate_hello("node1", f"GUN-B-{tail}")
    assert welcome is not None and welcome["result"]["result_changed"] is False
    clock["t"] += 1
    net.simulate_batch("node1", [{"type": "death", "seq": 51, "t": clock["t"] - 2,
                                  "match_id": info["match_id"], "player_id": ps[1]["player_id"],
                                  "shooter_num": ps[0]["player_num"], "shooter_team": 1}], clock["t"])
    net.pushed.clear()
    tail = demo_armory()[1]["ble"]["tail"]
    welcome = net.simulate_hello("node1", f"GUN-B-{tail}")
    assert welcome is not None and welcome["result"]["result_changed"] is True
