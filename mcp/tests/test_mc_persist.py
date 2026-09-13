"""Session snapshot: an MC restart must not dump the roster (Tony, 2026-08-26 — three restarts
mid-setup each left phones on WAITING FOR KIT-OUT with every gun ghosted NOT SEEN)."""
import json, pathlib, sys, tempfile
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from test_mc_state import T0, mk


def test_snapshot_round_trip():
    r = mk(); s = r[0] if isinstance(r, tuple) else r
    tmp = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s._persist_path = tmp
    p = s.add_player("ALPHA", team_id="blue")
    s.patch_player(p["player_id"], voice="female")
    s._persist_last = 0.0
    s._persist()
    assert tmp.exists()
    # fresh boot restores the roster with link state stripped
    r2 = mk(); s2 = r2[0] if isinstance(r2, tuple) else r2
    s2._persist_path = tmp
    assert s2.restore_snapshot() == 3      # mk() seeds OP0/OP1, plus ALPHA
    q = next(p for p in s2.players.values() if p["display"] == "ALPHA")
    assert q["voice"] == "female"
    assert q["node_id"] is None and q["ready"] is False


def test_fresh_session_clears_snapshot():
    r = mk(); s = r[0] if isinstance(r, tuple) else r
    tmp = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s._persist_path = tmp
    s.add_player("ALPHA", team_id="blue")
    s._persist_last = 0.0
    s._persist()
    assert tmp.exists()
    s.new_session(keep_roster=False)
    assert not tmp.exists()


def test_corrupt_snapshot_starts_clean():
    r = mk(); s = r[0] if isinstance(r, tuple) else r
    tmp = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    tmp.write_text("{nope")
    s._persist_path = tmp
    assert s.restore_snapshot() == 0
    assert len(s.players) == 2      # mk()'s seeded roster untouched by the bad snapshot


# ── field 2026-08-30: "the recap doesn't show the previous game once another is started" ─────────
def test_store_reads_back_finished_matches_newest_first():
    """MC has always WRITTEN every finished match to the session store; nothing ever read them back,
    so a new game made the last result unreachable. `Store.matches()` is that read path."""
    from brx_mcp.mc.store import Store
    db = pathlib.Path(tempfile.mkdtemp()) / "s.sqlite"
    st = Store("sess", db)
    st.match_started("m1", {"mode": "tdm"}, 1000)
    st.match_ended("m1", {"winner": {"team_id": "blue"}, "rows": []})
    st.match_started("m2", {"mode": "ffa"}, 2000)
    st.match_ended("m2", {"winner": {"player_id": "p1"}, "rows": []})
    st.match_started("m3", {"mode": "ffa"}, 3000)          # still running -> never listed

    got = st.matches()
    assert [m["match_id"] for m in got] == ["m2", "m1"], got   # newest first, unfinished excluded
    assert got[0]["config"]["mode"] == "ffa"
    assert got[0]["recap"]["winner"]["player_id"] == "p1"
    assert next(m for m in got if m["match_id"] == "m1")["config"]["mode"] == "tdm"
    st.close()


def test_store_matches_survives_a_corrupt_row():
    """A half-written recap must not take the whole history list down with it."""
    from brx_mcp.mc.store import Store
    db = pathlib.Path(tempfile.mkdtemp()) / "s.sqlite"
    st = Store("sess", db)
    st.match_started("ok", {"mode": "tdm"}, 1000)
    st.match_ended("ok", {"rows": []})
    st.db.execute("INSERT INTO matches(match_id,session_id,config,go_live_t,ended_t,recap) "
                  "VALUES ('bad','sess','{not json',5000,6000,'{also not json')")
    st.db.commit()
    assert [m["match_id"] for m in st.matches()] == ["ok"], "an unreadable RECAP has no result to show"

    # ...but a corrupt CONFIG must DEGRADE, not delete a perfectly good recap (review 2026-08-31)
    st.match_started("halfgood", {"mode": "ffa"}, 7000)
    st.match_ended("halfgood", {"winner": {"player_id": "p9"}, "rows": []})
    st.db.execute("UPDATE matches SET config='{not json' WHERE match_id='halfgood'")
    st.db.commit()
    row = next(m for m in st.matches() if m["match_id"] == "halfgood")
    assert row["config"] == {} and row["recap"]["winner"]["player_id"] == "p9"
    st.close()


# ── polish-loop 2026-08-26 deferred low, closed 2026-09-01 ───────────────────────────────────────
def test_restore_repairs_duplicate_and_out_of_range_player_nums():
    """`player_num` goes on the wire as the `$PSET` player id, so a duplicate arms two guns that
    answer to the same id — every hit either takes is attributed to whichever MC looks up first.

    The restore path used to take the file's numbers verbatim and only re-derive them at the next
    config change, so a hand-edited or half-written snapshot could start a game that scores the
    wrong people."""
    from brx_mcp.mc.types import MAX_PLAYERS
    r = mk(); s = r[0] if isinstance(r, tuple) else r
    tmp = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s._persist_path = tmp
    for i, disp in enumerate(("ALPHA", "BRAVO", "CHARLIE", "DELTA")):
        s.add_player(disp, team_id="blue")
    s._persist_last = 0.0
    s._persist()

    snap = json.loads(tmp.read_text())
    bad = {"ALPHA": 5, "BRAVO": 5, "CHARLIE": 0, "DELTA": MAX_PLAYERS + 9}    # dup, dup, reserved, out of range
    for p in snap["players"]:
        if p["display"] in bad:
            p["player_num"] = bad[p["display"]]
    tmp.write_text(json.dumps(snap))

    r2 = mk(); s2 = r2[0] if isinstance(r2, tuple) else r2
    s2._persist_path = tmp
    assert s2.restore_snapshot() == len(snap["players"]), "nobody is dropped for a bad number alone"
    nums = [p["player_num"] for p in s2.players.values()]
    assert len(nums) == len(set(nums)), f"duplicate player_num survived the restore: {nums}"
    assert all(isinstance(n, int) and 1 <= n <= MAX_PLAYERS for n in nums), nums
    # the FIRST claimant keeps the number it had; the rest are reassigned
    assert next(p for p in s2.players.values() if p["display"] == "ALPHA")["player_num"] == 5


def test_restore_survives_a_non_numeric_player_num():
    """A snapshot written by a future/older build, or corrupted: never raise, never keep the value."""
    from brx_mcp.mc.types import MAX_PLAYERS
    r = mk(); s = r[0] if isinstance(r, tuple) else r
    tmp = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s._persist_path = tmp
    s.add_player("ALPHA", team_id="blue")
    s._persist_last = 0.0
    s._persist()
    snap = json.loads(tmp.read_text())
    for p, junk in zip(snap["players"], (None, "3", True, 2.5)):
        p["player_num"] = junk
    tmp.write_text(json.dumps(snap))
    r2 = mk(); s2 = r2[0] if isinstance(r2, tuple) else r2
    s2._persist_path = tmp
    assert s2.restore_snapshot() == len(snap["players"])
    nums = [p["player_num"] for p in s2.players.values()]
    assert all(isinstance(n, int) and not isinstance(n, bool) and 1 <= n <= MAX_PLAYERS for n in nums), nums
    assert len(nums) == len(set(nums))


def test_restore_never_drops_a_player_while_numbers_are_free():
    """`player_num_base` keeps concurrent games disjoint (A6.5), but the RESTORE path must not treat
    it as a hard floor: dropping a real player while 1..base-1 sat free destroys data the operator
    already had. The live add path may refuse; this one may not (review 2026-09-01)."""
    from brx_mcp.mc.types import MAX_PLAYERS
    r = mk(); s = r[0] if isinstance(r, tuple) else r
    tmp = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s._persist_path = tmp
    for d in ("ALPHA", "BRAVO", "CHARLIE", "DELTA"):       # added under the default base
        s.add_player(d, team_id="blue")
    s._persist_last = 0.0
    s._persist()

    # ...then the FILE says base 62, leaving only 62 and 63 at or above it for six players, and every
    # stored number is invalid so all six need one. The base comes from the snapshot's own config.
    snap = json.loads(tmp.read_text())
    snap["config"]["player_num_base"] = MAX_PLAYERS - 1
    for p in snap["players"]:
        p["player_num"] = 0
    tmp.write_text(json.dumps(snap))
    assert len(snap["players"]) > 2, "the roster must exceed the numbers at/above the base"

    r2 = mk(); s2 = r2[0] if isinstance(r2, tuple) else r2
    s2._persist_path = tmp
    restored = s2.restore_snapshot()
    assert restored == len(snap["players"]), "nobody may be dropped while low numbers are free"
    nums = sorted(p["player_num"] for p in s2.players.values())
    assert len(nums) == len(set(nums)) and all(1 <= n <= MAX_PLAYERS for n in nums), nums


def test_a_snapshot_from_before_the_presentation_profile_restores_with_the_mode_default():
    """A11: a session.json written before `presentation` existed must come back reading as the stock
    mode it was -- the console compares the applied config to the mode defaults, which now carry a
    presentation block (caught by the e2e old-session compat step, 2026-09-04)."""
    r = mk(); s = r[0] if isinstance(r, tuple) else r
    tmp = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s._persist_path = tmp
    s._persist_last = 0.0
    s._persist()
    snap = json.loads(tmp.read_text())
    snap["config"].pop("presentation", None)                 # what an older MC wrote
    tmp.write_text(json.dumps(snap))
    r2 = mk(); s2 = r2[0] if isinstance(r2, tuple) else r2
    s2._persist_path = tmp
    assert s2.restore_snapshot() >= 2
    assert s2.config["presentation"]["preset"] == "standard"
    from brx_mcp.mc.state import default_config
    fresh = default_config(s2.config["mode"])
    for k in ("presentation", "loadout_policy"):
        assert s2.config[k] == fresh[k], k                    # identical to the stock mode's defaults


# --------------------------------------------------------------------------- S5(a) — station assignments (2026-09-11)
def test_station_assignment_and_game_no_persist_across_a_restart():
    """S5(a): assignments used to live for the SESSION only, so an MC restart at the field forgot every
    placed station and the operator had to walk out and redo ITEMS from scratch."""
    s, net, clock, ps = mk()
    tmp = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s._persist_path = tmp
    net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 3, "threshold": -70})
    s.game_no = 2
    s._game_no_started = True
    s._persist_last = 0.0
    s._persist()
    assert tmp.exists()

    s2, net2, clock2, ps2 = mk()
    s2._persist_path = tmp
    s2.restore_snapshot()
    assert s2.game_no == 2 and s2._game_no_started is True
    st = s2.stations.get("util-1")
    assert st and st["assigned"] == {"kind": "respawn", "team": 1, "id": 3, "threshold": -70, "at": T0}
    # a restored station comes back UNARMED -- the phone remembers nothing about MC across a restart --
    # and is re-armed on its next hello, the same path a first-contact hello already uses.
    assert st["armed"] is None and st["arm_pending"] is True
    net2.pushed.clear()
    net2.simulate_utility_hello("util-1")
    assert net2.pushes("station_config", "util-1"), "the restored assignment re-arms itself on the next hello"

    # CONTROL: an unassigned station is never persisted
    net.simulate_utility_hello("util-2")           # heard, never assigned
    s._persist_last = 0.0
    s._persist()
    snap = json.loads(tmp.read_text())
    assert "util-1" in snap["stations"] and "util-2" not in snap["stations"], snap["stations"]


def test_a_pre_a18_snapshot_restores_the_modes_complete_params():
    """Polish review 2026-09-11: a session.json written before mode_params existed restored a koth config with
    none, `_validate` skips an ABSENT set, and the wire pushed without it -- against A18's complete-or-absent."""
    from brx_mcp.modes.registry import validate_mode_params
    s, net, clock, ps = mk()
    tmp = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s._persist_path = tmp
    s.set_config({"mode": "koth", "station_source": "phone"})
    s._persist_last = 0.0
    s._persist()
    snap = json.loads(tmp.read_text())
    assert snap["config"].pop("mode_params", None), "CONTROL: a koth config persists its params today"
    tmp.write_text(json.dumps(snap))                              # what a pre-A18 file looks like
    s2, net2, clock2, ps2 = mk()
    s2._persist_path = tmp
    s2.restore_snapshot()
    assert s2.config["mode"] == "koth"
    assert s2.config.get("mode_params") == validate_mode_params("koth", {})[0], s2.config.get("mode_params")
    # CONTROL: a mode that declares no params stays byte-identical (no key)
    s3, net3, clock3, ps3 = mk()
    s3.set_config({"mode": "tdm"})
    assert "mode_params" not in s3.config


# ------------------------------------------------------------- F142: demo never wakes up in a match
def _snap_path():
    return pathlib.Path(tempfile.mkdtemp()) / "session.json"


def _saved(session, demo: bool, path):
    session._persist_path = path
    session.demo_session = demo
    session.add_player("ALPHA", team_id="blue")
    session._persist_last = 0.0
    session._persist()
    return path


def test_f142_a_demo_snapshot_is_not_restored_into_a_real_launch():
    """Field 2026-09-12: ALPHA on GUN-A and BRAVO on GUN-B were restored into a real field session and
    sat on the roster with no phone. Tagging the two REAL phones then created two more players, so a
    match would have been pushed to a four-player roster with two ghosts. The operator's only clue was
    one banner line in a terminal."""
    tmp = _saved(mk()[0] if isinstance(mk(), tuple) else mk(), True, _snap_path())
    assert json.loads(tmp.read_text())["demo"] is True

    real = mk(); real = real[0] if isinstance(real, tuple) else real
    real._persist_path, real.demo_session = tmp, False
    before = dict(real.players)
    assert real.restore_snapshot() == 0, "a demo roster was restored into a real session"
    assert real.players == before, "the real session's own roster was overwritten by a demo file"
    assert real.restored_from is None


def test_f142_a_real_snapshot_is_not_restored_into_a_demo_launch_either():
    """The other direction, and for the same reason: a demo run that inherits the bench roster was the
    original 2026-08-26 bug (a restored bare-tail gun_id stole the e2e fake gun)."""
    tmp = _saved(mk()[0] if isinstance(mk(), tuple) else mk(), False, _snap_path())
    assert json.loads(tmp.read_text())["demo"] is False
    demo = mk(); demo = demo[0] if isinstance(demo, tuple) else demo
    demo._persist_path, demo.demo_session = tmp, True
    assert demo.restore_snapshot() == 0


def test_f142_a_matching_snapshot_still_restores_and_says_so_on_the_state():
    tmp = _saved(mk()[0] if isinstance(mk(), tuple) else mk(), False, _snap_path())
    s = mk(); s = s[0] if isinstance(s, tuple) else s
    s._persist_path, s.demo_session = tmp, False
    n = s.restore_snapshot()
    assert n == 3 and any(p["display"] == "ALPHA" for p in s.players.values())
    # F142: the board is TOLD, instead of the operator being expected to read a terminal
    assert s.restored_from == {"at": json.loads(tmp.read_text())["saved_ms"], "players": n}
    assert s.snapshot()["restored_from"] == s.restored_from
    # ...and FRESH SESSION is the answer to it
    s.new_session(keep_roster=False)
    assert s.restored_from is None and "restored_from" not in s.snapshot()


def test_f142_a_pre_f142_snapshot_with_no_marker_reads_as_a_real_one():
    """Every session.json written before today has no `demo` key. Treating a missing marker as `real`
    keeps a genuine bench roster restorable; the demo side is the one that has to opt in."""
    tmp = _snap_path()
    s = mk(); s = s[0] if isinstance(s, tuple) else s
    s._persist_path = tmp
    s.add_player("ALPHA", team_id="blue")
    s._persist_last = 0.0
    s._persist()
    raw = json.loads(tmp.read_text())
    raw.pop("demo")
    tmp.write_text(json.dumps(raw))
    s2 = mk(); s2 = s2[0] if isinstance(s2, tuple) else s2
    s2._persist_path, s2.demo_session = tmp, False
    assert s2.restore_snapshot() == 3
    s3 = mk(); s3 = s3[0] if isinstance(s3, tuple) else s3
    s3._persist_path, s3.demo_session = tmp, True
    assert s3.restore_snapshot() == 0


def test_f142_a_run_with_no_real_armory_is_marked_demo_even_without_the_flag():
    """Round-2 review 2026-09-12, HIGH. `--demo` was never the only way to end up holding demo guns:
    `__main__` falls back to `FakeArmory(demo_armory())` whenever `LocalArmory` cannot import (no
    bleak — WSL, CI, a laptop with the radio off), and a roster built from THAT scan is GUN-A..H. That
    is the roster that was restored into a real field day, and the old marker called it real."""
    import inspect
    from brx_mcp.mc import __main__ as M
    src = inspect.getsource(M.build)
    assert "demo_armory_in_use = isinstance(armory, FakeArmory)" in src, src[:0] or "the marker does not read the armory"
    assert "session.demo_session = bool(args.demo) or demo_armory_in_use" in src
    # and the operator is told which of the two it was, not left to infer it
    assert "no real armory" in src and "--demo" in src


def test_f142_the_marker_describes_the_armory_not_the_flag():
    """The behaviour behind that wiring: a session holding stand-in guns persists as demo, so the next
    real run declines it — which is the whole incident, and the `--demo` flag was never involved."""
    from brx_mcp.mc.fakes import FakeArmory, demo_armory
    fake = FakeArmory(demo_armory())
    assert isinstance(fake, FakeArmory)
    tmp = _snap_path()
    s = mk(); s = s[0] if isinstance(s, tuple) else s
    s._persist_path = tmp
    s.demo_session = True                 # what `__main__` sets for a bleak-less run with NO --demo
    s.add_player("ALPHA", team_id="blue")
    s._persist_last = 0.0
    s._persist()
    assert json.loads(tmp.read_text())["demo"] is True
    real = mk(); real = real[0] if isinstance(real, tuple) else real
    real._persist_path, real.demo_session = tmp, False       # a MacBook with a radio, no flag
    assert real.restore_snapshot() == 0


def test_f142_restored_from_at_is_a_number_or_absent_never_whatever_the_file_said():
    """`session.json` is a file on disk and `restored_from.at` goes straight out on /api/state for a UI
    to hand to `new Date(...)`. Round-2 review 2026-09-12."""
    for junk, want in (("2026-09-12", None), (None, None), (True, None), ([], None),
                       (1757700000000, 1757700000000), (1757700000000.0, 1757700000000)):
        tmp = _snap_path()
        s = mk(); s = s[0] if isinstance(s, tuple) else s
        s._persist_path = tmp
        s.add_player("ALPHA", team_id="blue")
        s._persist_last = 0.0
        s._persist()
        raw = json.loads(tmp.read_text())
        raw["saved_ms"] = junk
        tmp.write_text(json.dumps(raw))
        s2 = mk(); s2 = s2[0] if isinstance(s2, tuple) else s2
        s2._persist_path = tmp
        assert s2.restore_snapshot() == 3
        got = s2.restored_from["at"]
        assert got == want and (got is None or type(got) is int), (junk, got)
        assert s2.restored_from["players"] == 3
