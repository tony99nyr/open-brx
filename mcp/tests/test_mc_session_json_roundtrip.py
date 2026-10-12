"""Whole-file restart fixtures written by the pre-slice-2a Session code."""
import json
import pathlib
import shutil
import tempfile

from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.state import Session
from brx_mcp.mc.store import Store


FIXTURES = pathlib.Path(__file__).parent / "fixtures" / "session-json"
from _session_json_fixtures import generate


def _active_comparable(snapshot, *, after_restart=False):
    snapshot = dict(snapshot)
    # saved_ms is the wall clock at the write, not match state.
    snapshot.pop("saved_ms")
    snapshot["match"] = dict(snapshot["match"])
    # match.store_path names this process's SQLite file, which changes on restart.
    snapshot["match"].pop("store_path")
    if after_restart:
        # resume_match appends this operator alert in the new process.
        alert = snapshot["feed"].pop()
        assert alert["text"] == "MC RESTARTED. RESUMED THE MATCH IN PLAY"
        assert alert["tag"] == "RESUMED"
    return snapshot


def test_committed_fixtures_are_stable_across_two_generations():
    first, second = generate(), generate()
    assert first == second
    assert set(first) == {"armed", "live", "recap", "retired"}
    for name, snapshot in first.items():
        committed = json.loads((FIXTURES / name / "session.json").read_text(encoding="utf-8"))
        assert snapshot == committed, name


def test_session_json_restores_and_persists_the_same_file():
    for name in ("armed", "live", "recap", "retired"):
        source = FIXTURES / name / "session.json"
        original = json.loads(source.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as root:
            path = pathlib.Path(root) / "session.json"
            shutil.copyfile(source, path)
            store = Store("restart", pathlib.Path(root) / "restart.sqlite")
            try:
                session = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()),
                                  store=store, now_ms=lambda: original["saved_ms"])
                session._persist_path = path
                assert session.restore_snapshot() == len(original["players"]), name
                if name in ("armed", "live"):
                    assert "match" in original
                    assert session.resume_match() == name
                else:
                    # RECAP and retired KIT have no match block. The current to_snapshot equivalent returns None.
                    assert "match" not in original
                    assert session.snapshot_codec._match_snapshot() is None
                    assert session.resume_match() is None
                session._persist_last = 0.0
                session._persist()
                saved = json.loads(path.read_text(encoding="utf-8"))
            finally:
                store.close()
            if name in ("recap", "retired"):
                # No exclusions: compare the whole file, including saved_ms.
                assert saved == original, name
            else:
                assert _active_comparable(saved, after_restart=True) == _active_comparable(original), name


def test_live_fixture_carries_the_difficult_match_fields():
    match = json.loads((FIXTURES / "live" / "session.json").read_text(encoding="utf-8"))["match"]
    assert match["evicted_nodes"] == ["node0"]
    assert "node1" in match["unbound_nodes"]
    assert "hot-joined" in match["node_player"]
    assert match["joined_t"]
    assert [row["node_id"] for row in match["departed_stations"]] == ["station-left"]
