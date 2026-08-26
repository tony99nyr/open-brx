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
    assert s.players == {}
