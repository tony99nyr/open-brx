"""Session snapshot: an MC restart must not dump the roster (Tony, 2026-08-26 — three restarts
mid-setup each left phones on WAITING FOR KIT-OUT with every gun ghosted NOT SEEN)."""
import json, pathlib, sys, tempfile
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from test_mc_state import mk


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
