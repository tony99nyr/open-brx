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
