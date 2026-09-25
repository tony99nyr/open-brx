"""Bench 2026-09-17: MC was restarted during a LIVE match.

The new process came up in MUSTER, both phones stayed LIVE in the old match, and MC could neither
recognise nor end it. A crash, a laptop lid or a restart can do this on the field, so:

* the snapshot carries the running match and a restarted MC RESUMES it (or finishes it, when its end
  passed while MC was down);
* with no snapshot, bound phones reporting a match this MC did not start raise ONE notice, and nothing
  happens until the operator presses RESUME MATCH or END THEIR MATCH.

A34's safety rule is unchanged: MC never ends a match it cannot account for on its own.
"""
import json
import pathlib
import sqlite3
import tempfile

from test_mc_block_b import kill, online
from test_mc_result import go_live, mk

from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.state import Session
from brx_mcp.mc.store import Store
from brx_mcp.mc.types import STALE_AFTER_MS, STALE_LIVE_RETELL_MS


def _persisting_live(n=2, cfg=None):
    s, net, clock, ps, info = go_live(n, "ffa", cfg)
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    return s, net, clock, ps, info


def _restart(s, clock):
    """A new process: a new store FILE (each process writes its own), the same session.json."""
    s._persist_last = 0.0
    s._persist()
    return _restart_no_repersist(s, clock)


def _restart_no_repersist(s, clock):
    """Like `_restart`, but the caller already wrote the snapshot it wants read back -- a REAL crash
    leaves `saved_ms` at the moment of the last write, not at the moment the new process starts."""
    net2 = FakeNet()
    store2 = Store("t2", pathlib.Path(tempfile.mkdtemp()) / "s2.sqlite")
    s2 = Session(FakeCompiler(), net2, FakeArmory(demo_armory()), store=store2, now_ms=lambda: clock["t"])
    s2._persist_path = s._persist_path
    assert s2.restore_snapshot() == len(s.players)
    return s2, net2


def _status(net, clock, i, arm, mid, **extra):
    body = {"arm_state": arm, "synced": True, "alive": True, "pending": 0, **({"match_id": mid} if mid else {}), **extra}
    net.simulate_status(f"node{i}", body, clock["t"])


def _kills(s, pid):
    return next(r["kills"] for r in s.scorer.rows() if r["player_id"] == pid)


def _death(net, clock, ps, killer_i, victim_i, mid, seq):
    clock["t"] += 1000
    net.simulate_event(f"node{victim_i}", {"type": "death", "t": clock["t"], "match_id": mid,
                                           "player_id": ps[victim_i]["player_id"],
                                           "shooter_num": ps[killer_i]["player_num"], "shooter_team": 1},
                       clock["t"], seq=seq)


# ── 1. restart mid-LIVE resumes ────────────────────────────────────────────────────────────────────
def test_a_restart_mid_live_resumes_the_match_and_the_whistle_recaps_facts_from_both_sides():
    s, net, clock, ps, info = _persisting_live()
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    assert _kills(s, ps[0]["player_id"]) == 1, "control: the old process scored the first kill"
    clock["t"] += 20_000
    s2, net2 = _restart(s, clock)
    assert s2.resume_match() == "live"
    snap = s2.snapshot()
    assert snap["phase"] == "live" and snap["live"]["match_id"] == info["match_id"]
    assert _kills(s2, ps[0]["player_id"]) == 1, "the scorer is rebuilt from the facts sent before the restart"
    for i, p in enumerate(ps):
        tail = demo_armory()[i]["ble"]["tail"]
        node = net2.simulate_hello(f"node{i}", f"GUN-{chr(65 + i)}-{tail}")
        assert node is not None and node["player"]["player_id"] == p["player_id"]
        assert "config" not in node and "frames" not in node, "a resume never pushes a config to a phone in play"
        assert node["start"]["match_id"] == info["match_id"] and node["start"]["seq"] == info["seq"], \
            "the re-hello start is the SAME start, which the phone takes as a no-op"
        _status(net2, clock, i, "live", info["match_id"])
    assert not net2.pushes("control"), "heartbeats for the resumed match are the current match"
    assert "orphan_match" not in s2.snapshot()
    kill(s2, net2, clock, ps, 0, 1, info, seq=2)
    assert _kills(s2, ps[0]["player_id"]) == 2, "a fact after the restart scores"
    s2.control("end")
    assert s2.phase == "recap"
    row = next(r for r in s2.last_recap["rows"] if r["player_id"] == ps[0]["player_id"])
    assert row["kills"] == 2, "the recap holds the facts from before AND after the restart"
    assert len(s2._match_facts(info["match_id"])) == 2, "the old store's facts were carried into the new one"
    ends = [b for _n, _k, b in net2.pushes("control")]
    assert ends and all(b == {"cmd": "end", "match_id": info["match_id"]} for b in ends)


def test_a_released_live_station_recap_survives_an_mc_restart():
    """F184 polish: RELEASE removes the only live row, so its frozen tally belongs in the snapshot."""
    s, net, clock, ps = mk(2, "tdm", {"respawn": {"type": "scanner", "delay_s": 15}})
    net.simulate_utility_hello("brxu-live")
    s.set_station("brxu-live", {"kind": "respawn", "team": "blue", "id": 3})
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    s.push_config()
    for i in range(2):
        net.simulate_node_message(f"node{i}", "ack_config", {"config_id": s.config["config_id"], "ok": True,
                                                               "gun_echo": "$LCD"}, clock["t"])
    info = s.start(runway_s=3)
    clock["t"] = info["go_live_t"] + 1
    s.tick()
    net.simulate_status("brxu-live", {"node_id": "brxu-live", "arm_state": "connected", "synced": False,
                                        "role": "utility", "kind": "respawn", "station_id": 3, "armed": True,
                                        "revives": 4}, clock["t"])
    assert s.release_station("brxu-live")
    net.simulate_status("brxu-live", {"node_id": "brxu-live", "arm_state": "connected", "synced": False,
                                        "role": "utility", "kind": "respawn", "station_id": 3, "armed": True,
                                        "revives": 5}, clock["t"])
    net.simulate_status("brxu-live", {"node_id": "brxu-live", "arm_state": "connected", "synced": False,
                                        "role": "utility", "kind": "respawn", "station_id": 3, "armed": True,
                                        "revives": "six"}, clock["t"])

    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s._persist_last = 0.0
    s._persist()
    s2, _net2 = _restart_no_repersist(s, clock)
    assert s2.resume_match() == "live"
    s2.control("end")

    assert s2.last_recap["stations"] == [{"node_id": "brxu-live", "kind": "respawn", "id": 3,
                                            "team": 1, "heard": True, "revives": 5}]


def test_the_snapshot_stops_naming_the_match_once_it_ended():
    s, net, clock, ps, info = _persisting_live()
    s._persist_last = 0.0
    s._persist()
    s.control("end")
    s2, _net2 = _restart(s, clock)
    assert s2.resume_match() is None and s2.phase == "muster", "an ended match is never resumed"


# ── 2. restart after the end time finishes the match ───────────────────────────────────────────────
def test_a_restart_after_the_end_time_restores_it_finished_and_ends_a_phone_still_live():
    s, net, clock, ps, info = _persisting_live()
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    s._persist_last = 0.0
    s._persist()
    clock["t"] = info["go_live_t"] + 600_000 + 6_000
    s2, net2 = _restart(s, clock)
    assert s2.resume_match() == "recap"
    assert s2.last_recap is not None
    assert next(r for r in s2.last_recap["rows"] if r["player_id"] == ps[0]["player_id"])["kills"] == 1
    assert [m["match_id"] for m in s2.store.matches()] == [info["match_id"]], "the archive row is written"
    tail = demo_armory()[1]["ble"]["tail"]
    net2.simulate_hello("node1", f"GUN-B-{tail}")
    _status(net2, clock, 1, "live", info["match_id"])
    assert {"cmd": "end", "match_id": info["match_id"]} in [b for n, _k, b in net2.pushes("control") if n == "node1"], \
        "A34: a phone still live in the finished match is told to end"
    assert "orphan_match" not in s2.snapshot()


def test_a_restart_in_recap_still_ends_a_phone_that_missed_the_end():
    s, net, clock, ps, info = _persisting_live()
    s.control("end")
    s2, net2 = _restart(s, clock)
    assert s2.resume_match() is None
    tail = demo_armory()[1]["ble"]["tail"]
    net2.simulate_hello("node1", f"GUN-B-{tail}")
    _status(net2, clock, 1, "live", info["match_id"])
    assert [b for n, _k, b in net2.pushes("control") if n == "node1"] == [{"cmd": "end", "match_id": info["match_id"]}]


# ── 2b. F-2026-09-17d: a FAR TOO OLD snapshot is restored finished, never resumed ───────────────────
def test_a_snapshot_far_too_old_is_restored_finished_not_resumed():
    """The bound is 2x the time limit -- BELOW where the ordinary "past the time limit" check would
    itself have caught it, so this isolates the age cap and not the existing time-limit check. A crash
    the operator only found later must not boot straight back into a LIVE match nobody is still playing."""
    s, net, clock, ps, info = _persisting_live(cfg={"time_limit_s": 3})
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    s._persist_last = 0.0
    s._persist()                                    # `saved_ms` == now: the last write before the crash
    clock["t"] += 2 * 3_000 + 500                    # past the 2x-time-limit AGE bound (6 s)...
    assert clock["t"] < info["go_live_t"] + 3_000 + 5_000, \
        "keep this inside the ordinary time-limit-passed window so only the age cap can be firing"
    s2, net2 = _restart_no_repersist(s, clock)
    assert s2.resume_match() == "recap"
    assert s2.phase == "recap"
    row = next(r for r in s2.last_recap["rows"] if r["player_id"] == ps[0]["player_id"])
    assert row["kills"] == 1, "the kill logged before the crash still scores"


def test_an_untimed_snapshot_over_an_hour_old_is_restored_finished_not_resumed():
    """An untimed config has no clock of its own to catch a stale snapshot, so the bound is a flat hour."""
    s, net, clock, ps, info = _persisting_live(cfg={"time_limit_s": 30})
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    s.config["time_limit_s"] = None       # the STORED match's config is untimed (no clock of its own);
    s._persist_last = 0.0                 # set directly -- `set_config` would refuse it on this path today
    s._persist()
    clock["t"] += 3_600_000 + 1
    s2, net2 = _restart_no_repersist(s, clock)
    assert s2.resume_match() == "recap"
    assert s2.phase == "recap"


def test_a_snapshot_inside_the_bound_still_resumes_live():
    """The age cap must not fire on an ordinary quick restart."""
    s, net, clock, ps, info = _persisting_live(cfg={"time_limit_s": 30})
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    s._persist_last = 0.0
    s._persist()
    clock["t"] += 5_000                              # well inside the 2x-time-limit bound
    s2, net2 = _restart_no_repersist(s, clock)
    assert s2.resume_match() == "live"
    assert s2.phase == "live"


# ── 2c. F-2026-09-17e: the resume import never writes to the OLD process's store ────────────────────
def test_the_old_store_is_opened_read_only_for_the_resume_import():
    """A resume only ever READS another process's store (`state._import_facts`)."""
    path = pathlib.Path(tempfile.mkdtemp()) / "old.sqlite"
    w = Store("old", path)
    w.log("node0", "status", 1, 0, 0, "m1", False, {"hp": 1})
    w.close()
    assert not pathlib.Path(str(path) + "-wal").exists(), "a clean close checkpoints the WAL away"

    ro = Store("resume", path, read_only=True)
    try:
        assert len(ro.events(match_id="m1")) == 1, "a read-only store still reads"
        try:
            ro.log("node0", "status", 2, 0, 0, "m1", False, {})
            raise AssertionError("a read-only store accepted a write")
        except sqlite3.OperationalError:
            pass
        assert len(ro.events(match_id="m1")) == 1, "the rejected write left no trace"
    finally:
        ro.close()


def test_resume_still_reads_the_old_store_now_that_it_is_opened_read_only():
    s, net, clock, ps, info = _persisting_live()
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    clock["t"] += 20_000
    s2, net2 = _restart(s, clock)
    assert s2.resume_match() == "live"
    assert _kills(s2, ps[0]["player_id"]) == 1, "the facts were still read back through the read-only open"


def test_a_failed_facts_import_raises_a_loud_distinct_alert_not_just_a_log_line():
    """Polish review: `_import_facts`'s failure used to be log-only, and `resume_match` goes straight
    on to say RESUMED THE MATCH IN PLAY right after it — which reads as an ordinary resume even though
    the scorer has nothing from before the restart. The operator needs a loud, separate feed line."""
    s, net, clock, ps, info = _persisting_live()
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    clock["t"] += 20_000
    s._persist_last = 0.0
    s._persist()
    old_path = pathlib.Path(s.store.path)
    s.store.close()
    old_path.write_bytes(b"not a sqlite file")   # the old process's store cannot be read back
    s2, net2 = _restart_no_repersist(s, clock)
    assert s2.resume_match() == "live"
    assert any(f.get("kind") == "alert" and "COULD NOT READ THE OLD SESSION" in f.get("text", "")
               for f in s2.feed), s2.feed
    assert _kills(s2, ps[0]["player_id"]) == 0, "with the old facts unreadable, the scorer really starts from zero"


def test_restore_snapshot_clears_a_half_set_resume_pending_when_a_later_step_fails():
    """Polish review: `self._resume_pending` is assigned from `snap['match']` partway through
    `restore_snapshot`, before the loadout/config repairs that run after it. A snapshot that fails one
    of THOSE later steps must not leave a half-restored match dict sitting in `_resume_pending` for the
    very next `resume_match()` call to pick up — 'restore failed — starting clean' has to mean the
    whole restore, not just the player roster."""
    s, net, clock, ps, info = _persisting_live()
    s._persist_last = 0.0
    s._persist()
    snap = json.loads(s._persist_path.read_text())
    assert snap.get("match"), "setup: a live match is in the snapshot"
    del snap["config"]["mode"]   # breaks the loadout-policy repair, which runs AFTER _resume_pending is set
    s._persist_path.write_text(json.dumps(snap))
    net2 = FakeNet()
    store2 = Store("t2", pathlib.Path(tempfile.mkdtemp()) / "s2.sqlite")
    s2 = Session(FakeCompiler(), net2, FakeArmory(demo_armory()), store=store2, now_ms=lambda: clock["t"])
    s2._persist_path = s._persist_path
    assert s2.restore_snapshot() == 0, "setup: the corrupt config must fail the whole restore"
    assert s2._resume_pending is None, \
        "a failed restore must not leave a half-restored match pending for the next resume_match()"
    assert s2.resume_match() is None


# ── 2d. F-2026-09-17e: a resume into ARMED re-queues the VIP role for go-live ───────────────────────
def test_a_resume_into_armed_still_queues_the_vip_role_for_go_live():
    """`_schedule()` queues the VIP announcement itself (`_queue_roles_for_live`); a resume that lands
    back in ARMED -- a restart that beat the countdown -- must queue it too, or the VIP never hears it."""
    s, net, clock, ps = mk(2, "ffa")
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    s.set_config({"vip_player_id": ps[1]["player_id"]})
    s.push_config(force=True)
    for i in range(2):
        net.simulate_node_message(f"node{i}", "ack_config", {"config_id": s.config["config_id"], "ok": True,
                                                              "gun_echo": "$LCD"}, clock["t"])
    info = s.start(runway_s=30, force=True)
    assert s.phase == "armed"
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s._persist_last = 0.0
    s._persist()
    s2, net2 = _restart_no_repersist(s, clock)
    assert s2.resume_match() == "armed"
    tail = demo_armory()[1]["ble"]["tail"]
    net2.simulate_hello("node1", f"GUN-B-{tail}")           # the VIP's phone re-binds after the restart
    clock["t"] = info["go_live_t"] + Session.ROLE_SETTLE_MS
    s2.tick()
    alerts = [(nid, b) for nid, k, b in net2.pushed if k == "alert" and b.get("kind") == "role"]
    assert len(alerts) == 1, "the resumed match must still hand the VIP their role at go-live"
    nid, body = alerts[0]
    assert nid == "node1" and body["player_id"] == ps[1]["player_id"]
    assert body["role"] == {"name": "vip", "on": True}


# ── 3. no snapshot: phones in an unknown match raise a notice and nothing else ─────────────────────
def _fresh_mc_with_phones_in(n, mids):
    """A new laptop: the roster is typed in again, the phones bind, and they report `mids[i]`."""
    s, net, clock, ps = mk(n, "ffa")
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    before = len(net.pushed)
    for i, mid in enumerate(mids):
        if mid:
            _status(net, clock, i, "live", mid)
    return s, net, clock, ps, before


def test_phones_in_a_match_this_mc_did_not_start_raise_the_notice_and_nothing_happens():
    s, net, clock, ps, before = _fresh_mc_with_phones_in(2, ["m-old", "m-old"])
    orphan = s.snapshot()["orphan_match"]
    assert orphan == {"match_id": "m-old", "phones": 2, "players": ["OP0", "OP1"], "arm_state": "live",
                      "can_resume": True}
    for _ in range(5):
        clock["t"] += 1000
        for i in range(2):
            _status(net, clock, i, "live", "m-old")
        s.tick()
    assert net.pushed[before:] == [], "no control, no config and no start without the operator"
    assert s.phase == "kit" and s.scorer is None and s.start_info is None


def test_the_notice_goes_away_when_the_phones_stop_reporting_that_match():
    s, net, clock, ps, _ = _fresh_mc_with_phones_in(2, ["m-old", "m-old"])
    for i in range(2):
        _status(net, clock, i, "kitted", "m-old")
    assert "orphan_match" not in s.snapshot()
    _status(net, clock, 0, "live", "m-old")
    assert s.snapshot()["orphan_match"]["phones"] == 1
    clock["t"] += 9_000                                    # silent past STALE_AFTER_MS: no claim any more
    assert "orphan_match" not in s.snapshot()


def test_an_unbound_phone_in_an_unknown_match_raises_the_notice_too():
    """F261, bench 2026-09-18: a phone MC has never bound to a player still gets to claim an orphan
    match. Before the fix this stranger raised nothing, the same gap that hid the exact case the
    feature exists for -- a freshly restarted MC with no roster typed in yet (below)."""
    s, net, clock, ps = mk(1, "ffa")
    net.simulate_hello("stranger", "GUN-Z-0000")
    net.simulate_status("stranger", {"arm_state": "live", "match_id": "m-old"}, clock["t"])
    assert "stranger" not in s.node_player, "setup: the hello never matched a player"
    orphan = s.snapshot()["orphan_match"]
    assert orphan == {"match_id": "m-old", "phones": 1, "players": ["stranger"], "arm_state": "live",
                      "can_resume": True}


def test_f261_a_freshly_restarted_mc_with_no_roster_yet_still_sees_the_orphan():
    """F261, bench 2026-09-18 bench finding: MC restarted with its session file moved aside comes up
    with NO roster and NO node bindings at all -- the field case of MC coming up on a different
    laptop. The phones carry on LIVE regardless, and their heartbeats must be enough on their own:
    `orphan_match` must not stay absent just because nothing is bound yet."""
    s, net, clock, ps = mk(0, "ffa")
    for i in range(2):
        net.simulate_hello(f"node{i}", f"GUN-{chr(65 + i)}-0000")
        _status(net, clock, i, "live", "m-old")
    assert not s.node_player, "setup: a fresh MC has bound nobody"
    orphan = s.snapshot()["orphan_match"]
    assert orphan["match_id"] == "m-old" and orphan["phones"] == 2
    assert sorted(orphan["players"]) == ["node0", "node1"], "no display name yet, so the node id stands in"
    assert orphan["can_resume"] is True


def test_no_notice_in_a_normal_muster_kit_lobby_live_and_recap():
    s, net, clock, ps = mk(2, "ffa")
    assert "orphan_match" not in s.snapshot() and s.phase == "kit"
    s2, net2, clock2, ps2, info = go_live(2, "ffa")
    for i in range(2):
        _status(net2, clock2, i, "live", info["match_id"])
    assert "orphan_match" not in s2.snapshot()
    s2.control("end")
    for i in range(2):
        _status(net2, clock2, i, "kitted", info["match_id"])
    assert s2.phase == "recap" and "orphan_match" not in s2.snapshot()
    # a phone still armed for a start MC itself replaced (a reschedule mints a new match id)
    s3, net3, clock3, ps3 = mk(2, "ffa")
    for i, p in enumerate(ps3):
        online(s3, net3, clock3, p, i)
    s3.push_config(force=True)
    first = s3.start(runway_s=30, force=True)
    s3.reschedule(20)
    _status(net3, clock3, 0, "armed", first["match_id"])
    assert s3.phase == "armed" and "orphan_match" not in s3.snapshot()


# ── 4. RESUME MATCH adopts ─────────────────────────────────────────────────────────────────────────
def test_resume_match_adopts_the_phones_match_and_scores_from_the_facts_mc_holds():
    s, net, clock, ps, before = _fresh_mc_with_phones_in(2, ["m-old", "m-old"])
    _death(net, clock, ps, 0, 1, "m-old", seq=7)          # logged, parked: MC runs no match yet
    assert s.scorer is None
    s.adopt_orphan("m-old")
    assert s.phase == "live" and s.start_info["match_id"] == "m-old"
    assert _kills(s, ps[0]["player_id"]) == 1, "the fact that arrived before RESUME scores"
    assert not [k for _n, k, _b in net.pushed[before:] if k in ("config", "start", "control")], \
        "adopting pushes nothing to a phone in play"
    for i in range(2):
        _status(net, clock, i, "live", "m-old")
    assert not net.pushes("control") and "orphan_match" not in s.snapshot()
    tail = demo_armory()[0]["ble"]["tail"]
    node = net.simulate_hello("node0", f"GUN-A-{tail}")
    assert node is not None and "start" not in node and "config" not in node, \
        "an adopted match has no start of MC's own to hand a phone"
    _death(net, clock, ps, 0, 1, "m-old", seq=8)
    assert _kills(s, ps[0]["player_id"]) == 2
    s.control("end")
    assert s.phase == "recap"
    assert {"cmd": "end", "match_id": "m-old"} in [b for _n, _k, b in net.pushes("control")]


# ── F-2026-09-17c: an adopted match arms no end of MC's own ────────────────────────────────────────
# MC holds no config for a match it did not start — `self.config` is the operator's CURRENT DRAFT, which
# need not match what the phones are actually playing to. A short draft used to end their match early.

def test_an_adopted_match_never_ends_early_on_mcs_current_draft_time_limit():
    s, net, clock, ps, before = _fresh_mc_with_phones_in(2, ["m-old", "m-old"])
    s.set_config({"time_limit_s": 5})              # the draft's clock, not the real match's
    s.adopt_orphan("m-old")
    assert s.phase == "live"
    clock["t"] += 60_000                           # well past the draft's 5 s + grace
    s.tick()
    assert s.phase == "live" and s.start_info is not None, \
        "MC must not end an adopted match on its own draft's clock"
    s.control("end")                               # the operator can still stop it by hand
    assert s.phase == "recap"


def test_an_adopted_match_never_ends_early_on_mcs_current_draft_frag_limit():
    s, net, clock, ps, before = _fresh_mc_with_phones_in(2, ["m-old", "m-old"])
    s.set_config({"scoring": {"frag_limit": 1}})   # the draft's cap, not the real match's
    s.adopt_orphan("m-old")
    assert s.phase == "live"
    _death(net, clock, ps, 0, 1, "m-old", seq=1)   # one kill reaches the DRAFT's cap of 1
    assert s.phase == "live" and s.start_info is not None, \
        "MC must not end an adopted match on its own draft's frag limit"
    assert not net.pushes("control"), "no control{end} went out on the draft's cap"
    s.control("end")
    assert s.phase == "recap"


def test_adopting_notes_but_does_not_end_a_draft_cap_the_replayed_facts_already_reach():
    s, net, clock, ps, before = _fresh_mc_with_phones_in(2, ["m-old", "m-old"])
    _death(net, clock, ps, 0, 1, "m-old", seq=1)   # logged before MC adopts the match
    s.set_config({"scoring": {"frag_limit": 1}})   # the draft's cap the replay already reaches
    s.adopt_orphan("m-old")
    assert s.phase == "live" and s.start_info is not None, \
        "reaching the draft's cap in the replay must record, never end, an adopted match"
    assert any("DOES NOT END AN ADOPTED MATCH" in (e.get("text") or "") for e in s.feed)


def test_resume_is_refused_while_mc_runs_its_own_match():
    s, net, clock, ps, info = go_live(2, "ffa")
    _status(net, clock, 1, "live", "m-other")
    assert s.snapshot()["orphan_match"]["can_resume"] is False
    try:
        s.adopt_orphan("m-other")
        raise AssertionError("adopted over a running match")
    except ValueError:
        pass
    assert s.start_info["match_id"] == info["match_id"]


# ── 5. END THEIR MATCH reaches those phones only ───────────────────────────────────────────────────
def test_end_their_match_tells_only_the_phones_in_that_match():
    s, net, clock, ps, before = _fresh_mc_with_phones_in(3, ["m-old", "m-old", "m-else"])
    assert s.snapshot()["orphan_match"]["match_id"] == "m-old", "the match most phones report leads"
    s.end_orphan("m-old")
    ends = [(n, b) for n, k, b in net.pushed[before:] if k == "control"]
    assert sorted(ends, key=lambda e: e[0]) == [("node0", {"cmd": "end", "match_id": "m-old"}),
                                                ("node1", {"cmd": "end", "match_id": "m-old"})]
    assert s.snapshot()["orphan_match"]["match_id"] == "m-else", "the other match is still the operator's call"
    assert s.phase == "kit" and s.scorer is None
    clock["t"] += STALE_LIVE_RETELL_MS + 1000
    _status(net, clock, 0, "live", "m-old")
    assert len([1 for n, k, b in net.pushed if n == "node0" and k == "control"]) == 2, \
        "a phone that missed the end is told again, as for a match MC retired itself"
    assert not [1 for n, k, b in net.pushed if n == "node2" and k == "control"]


# ── A47 review: an ADOPTED match survives a restart unfinished ─────────────────────────────────────
def test_a_restart_never_finishes_an_adopted_match_on_the_draft_clock():
    """MC holds no config for an adopted match, so the draft's clock and the age bound are guesses. A
    finish here armed the end delivery at phones still playing it."""
    s, net, clock, ps, _ = _fresh_mc_with_phones_in(2, ["m-old", "m-old"])
    s.set_config({"time_limit_s": 5})
    s.adopt_orphan("m-old")
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s._persist_last = 0.0
    s._persist()
    assert s.snapshot()["phase"] == "live"
    clock["t"] += 60_000                                   # past the draft's clock AND the 2x age bound
    s2, net2 = _restart_no_repersist(s, clock)
    assert s2.resume_match() == "live", "an adopted match is never finished by a restart"
    assert s2.last_recap is None and not s2._end_delivery, "no recap, and no end delivery at the phones"
    tags = [(e["tag"], e["text"]) for e in s2.feed]
    assert len(tags) == 1 and tags[0][0] == "NOTE" and "PRESS END" in tags[0][1], tags
    assert not net2.pushes("control")


def test_an_untimed_old_snapshot_resumes_when_a_phone_still_plays_the_match():
    s, net, clock, ps, info = _persisting_live(cfg={"time_limit_s": 30})
    s.config["time_limit_s"] = None
    s._persist_last = 0.0
    s._persist()
    clock["t"] += 3_600_000 + 1
    s2, net2 = _restart_no_repersist(s, clock)
    tail = demo_armory()[0]["ble"]["tail"]
    net2.simulate_hello("node0", f"GUN-A-{tail}")
    _status(net2, clock, 0, "live", info["match_id"])      # a fresh heartbeat still names the match
    assert s2.resume_match() == "live"
    assert not s2._end_delivery and s2.last_recap is None
    assert s2.feed[0]["tag"] == "NOTE" and "STILL PLAYS" in s2.feed[0]["text"]


# ── A47 review: an adopted match the phones have ended says so on the MATCH screen ─────────────────
def test_phones_ended_shows_only_when_every_claiming_phone_has_ended_the_adopted_match():
    s, net, clock, ps, _ = _fresh_mc_with_phones_in(3, ["m-old", "m-old", "m-old"])
    s.adopt_orphan("m-old")
    assert "phones_ended" not in s.snapshot()["live"]
    _status(net, clock, 0, "kitted", "m-old")
    _status(net, clock, 1, "kitted", "m-old")
    assert "phones_ended" not in s.snapshot()["live"], "one phone still reports LIVE"
    _status(net, clock, 2, "idle", None)                   # a relaunched phone: no claim either way
    assert s.snapshot()["live"]["phones_ended"] is True
    assert s.phase == "live" and not net.pushes("control"), "MC shows it and ends nothing itself"


def test_phones_ended_is_never_set_on_mcs_own_match():
    s, net, clock, ps, info = go_live(2, "ffa")
    for i in range(2):
        _status(net, clock, i, "kitted", info["match_id"])
    assert "phones_ended" not in s.snapshot()["live"]


def test_pl4_phones_ended_needs_a_heartbeat_from_every_bound_phone_since_mc_started():
    s, net, clock, ps = mk(3, "ffa")
    for i, p in enumerate(ps[:2]):
        online(s, net, clock, p, i)
    _status(net, clock, 0, "live", "m-old")
    _status(net, clock, 1, "live", "m-old")
    s.adopt_orphan("m-old")
    net.simulate_hello("node2", f"GUN-C-{demo_armory()[2]['ble']['tail']}")   # bound, but no heartbeat since this MC started
    assert s.players[ps[2]["player_id"]].get("node_id") == "node2", "setup: bound"
    _status(net, clock, 0, "kitted", "m-old")
    _status(net, clock, 1, "kitted", "m-old")
    assert "phones_ended" not in s.snapshot()["live"], "a phone not heard yet may still be playing"
    _status(net, clock, 2, "kitted", "m-old")
    assert s.snapshot()["live"]["phones_ended"] is True, "control"


def test_pl4_phones_ended_counts_only_fresh_heartbeats():
    s, net, clock, ps, _ = _fresh_mc_with_phones_in(2, ["m-old", "m-old"])
    s.adopt_orphan("m-old")
    _status(net, clock, 0, "live", "m-other")        # an old claim of another match
    clock["t"] += STALE_AFTER_MS + 1
    _status(net, clock, 1, "idle", None)             # the other phone: no claim
    assert "phones_ended" not in s.snapshot()["live"], "a stale claim is not news"
    _status(net, clock, 0, "live", "m-other")
    assert s.snapshot()["live"]["phones_ended"] is True, "control: the same claim, fresh"


def test_a_restart_from_a_live_snapshot_keeps_a_late_team_kill_frozen_out():
    """F356 round 3: the cap fired and a late team kill (stamped before the capping kill) was stored, but
    the post-whistle snapshot write was lost (`_persist` swallows a failed write), so the new process reads
    the LIVE snapshot from before the cap. `resume_match` replays the stored facts in `t` order, which
    scored the team kill BEFORE the capping kill: the cap vanished and MC resumed a match the field had
    heard end. The whistle's moment is an arrival fact, so the resume derives it from the stored facts in
    arrival order and freezes the same team kill the live scorer froze.
    """
    s, net, clock, ps, info = go_live(4, "tdm", {"scoring": {"frag_limit": 2, "win_by": "kills"}})
    good = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s._persist_path = good
    t0 = clock["t"]
    kill(s, net, clock, ps, 0, 1, info, seq=1)          # team A 1, at t0+1000
    s._persist_last = 0.0
    s._persist()                                        # the last snapshot that reached the disk: LIVE
    s._persist_path = good.parent / "gone" / "session.json"     # every later write fails
    kill(s, net, clock, ps, 2, 3, info, seq=2)          # team A 2: the cap, at t0+2000
    assert s.phase == "recap"
    team_a = s.scorer.stats[ps[0]["player_id"]].team_id
    net.simulate_event("node2", {"type": "death", "t": t0 + 1200, "match_id": info["match_id"],
                                 "player_id": ps[2]["player_id"], "shooter_num": ps[0]["player_num"],
                                 "shooter_team": 1}, clock["t"] + 300, seq=10)     # P0 team-kills P2, late
    assert s.scorer.team_scores()[team_a] == 2, "control: the live scorer froze the late team kill out"
    s._persist_path = good
    clock["t"] += 5_000
    s2, _net2 = _restart_no_repersist(s, clock)
    assert s2.resume_match() == "recap", "the resumed facts still reach the cap the field heard"
    assert s2.scorer.team_scores()[team_a] == 2, f"the restart lowered the board: {s2.scorer.team_scores()}"
    assert s2.last_recap["winner"]["team_id"] == team_a


def test_a_resume_ignores_a_cap_only_the_t_order_replay_passes_and_a_real_cap_still_ends_it():
    """F363: the live board (arrival order) never reached the cap, but the `t`-order replay passes it for a
    moment before a team kill takes it back. The resume must keep the match live, and a real cap after it
    must still end the match."""
    s, net, clock, ps, info = go_live(4, "tdm", {"scoring": {"frag_limit": 2, "win_by": "kills"}})
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    t0, mid = clock["t"], info["match_id"]

    def death(killer, victim, t, seq):
        clock["t"] += 100
        net.simulate_event(f"node{victim}", {"type": "death", "t": t, "match_id": mid,
                                             "player_id": ps[victim]["player_id"],
                                             "shooter_num": ps[killer]["player_num"], "shooter_team": 1},
                           clock["t"], seq=seq)
    death(0, 2, t0 + 3000, 1)       # the team kill arrives first, stamped last
    death(0, 1, t0 + 1000, 1)       # team A: -1, then 0, then 1 in arrival order
    death(2, 3, t0 + 2000, 1)       # ...but 1, 2 (the cap), 1 in t order
    team_a = s.scorer.stats[ps[0]["player_id"]].team_id
    assert s.phase == "live" and s.scorer.team_scores()[team_a] == 1, "control: live never reached the cap"
    clock["t"] += 5_000
    s2, net2 = _restart(s, clock)
    assert s2.resume_match() == "live", f"the resume ended the match: {s2.phase} {s2.end_reason}"
    for i in range(4):
        tail = demo_armory()[i]["ble"]["tail"]
        net2.simulate_hello(f"node{i}", f"GUN-{chr(65 + i)}-{tail}")
        _status(net2, clock, i, "live", mid)
    clock["t"] += 1000
    net2.simulate_event("node3", {"type": "death", "t": clock["t"], "match_id": mid,
                                  "player_id": ps[3]["player_id"], "shooter_num": ps[0]["player_num"],
                                  "shooter_team": 1}, clock["t"], seq=2)
    assert s2.phase == "recap" and s2.end_reason == "frag_limit", \
        f"a real cap after the resume ends the match: {s2.phase} {s2.scorer.team_scores()} {s2.scorer.limit_reached_t}"


def test_a_resume_does_not_tell_the_field_the_lead_and_next_kill_wins_again():
    """F362 (k): the resume replay runs with no callbacks, and `_match_state_alerts` skips a fact older
    than FEEDBACK_MAX_AGE_MS, so the replay left `_leader` empty and `next_kill_wins` unannounced. The
    first fresh kill after the resume then told the leader `lead_taken` and the field `next_kill_wins`
    a second time."""
    s, net, clock, ps, info = _persisting_live(2, {"scoring": {"frag_limit": 3, "win_by": "kills"}})
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    kill(s, net, clock, ps, 0, 1, info, seq=2)          # P0 on 2: the lead, and cap - 1
    told = [b["kind"] for _, k, b in net.pushed if k == "alert"]
    assert "lead_taken" in told and "next_kill_wins" in told, f"control: the live match told them: {told}"
    clock["t"] += 20_000
    s2, net2 = _restart(s, clock)
    assert s2.resume_match() == "live"
    for i in range(2):
        tail = demo_armory()[i]["ble"]["tail"]
        net2.simulate_hello(f"node{i}", f"GUN-{chr(65 + i)}-{tail}")
        _status(net2, clock, i, "live", info["match_id"])
    net2.pushed.clear()
    kill(s2, net2, clock, ps, 1, 0, info, seq=3)       # P1 on 1: the lead does not change
    again = [b["kind"] for _, k, b in net2.pushed if k == "alert"]
    assert "lead_taken" not in again and "next_kill_wins" not in again, f"told again after the resume: {again}"


# ── X2: an adopted match keeps the phones' game byte ───────────────────────────────────────────────
# A fresh MC has game_no 1. The phones play under the byte the OLD MC armed (here 42). Before the fix a
# station re-arm after RESUME MATCH moved every station to byte 1: the stations cleared their tally and
# schedule, and the phones dropped the adverts (beacon.js scopes presence by byte).
def _stations_game(net, nid):
    return [b["game"] for n, k, b in net.pushed if n == nid and k == "station_config"]


def test_x2_adopting_takes_the_game_byte_the_phones_report_so_a_station_re_arm_keeps_it():
    s, net, clock, ps = mk(2, "ffa")
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    net.simulate_utility_hello("util-x2")
    s.set_station("util-x2", {"kind": "respawn", "team": "any", "id": 4})
    for i in range(2):
        _status(net, clock, i, "live", "m-old", game_byte=42)
    s.adopt_orphan("m-old")
    assert s._game_byte() == 42, f"the adopted match must run on the phones' byte, not {s._game_byte()}"
    assert s.snapshot()["game_byte"] == 42 and s.snapshot()["game_no"] == 42, "X10: both keys name the byte"
    net.pushed.clear()
    s.arm_stations()
    assert _stations_game(net, "util-x2") == [42], "a re-arm must not move the station to another game"


def test_x2_the_game_number_only_moves_forward_when_it_takes_the_phones_byte():
    s, net, clock, ps = mk(1, "ffa")
    online(s, net, clock, ps[0], 0)
    s.game_no = 300                                        # byte 45
    _status(net, clock, 0, "live", "m-old", game_byte=7)
    s.adopt_orphan("m-old")
    assert s._game_byte() == 7 and s.game_no > 300, s.game_no


def test_x2_an_older_phone_with_no_game_byte_keeps_todays_behaviour():
    s, net, clock, ps, _ = _fresh_mc_with_phones_in(2, ["m-old", "m-old"])
    s.adopt_orphan("m-old")
    assert s.game_no == 1 and s._game_byte() == 1


def test_x2_a_malformed_game_byte_is_ignored():
    s, net, clock, ps = mk(1, "ffa")
    online(s, net, clock, ps[0], 0)
    _status(net, clock, 0, "live", "m-old", game_byte=0)   # 0 = "any game", never a match's byte
    s.adopt_orphan("m-old")
    assert s._game_byte() == 1
