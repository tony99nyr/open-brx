"""Whole-file restart fixtures written by the pre-slice-2a Session code."""
from _session import scorer_of
import json
import os
import pathlib
import shutil
import tempfile

from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.state import Session
from brx_mcp.mc.store import Store


FIXTURES = pathlib.Path(__file__).parent / "fixtures" / "session-json"
from _session_json_fixtures import fixture_run, generate


def _active_comparable(snapshot, *, after_restart=False):
    snapshot = dict(snapshot)
    # saved_ms is the wall clock at the write, not match state.
    snapshot.pop("saved_ms")
    snapshot["match"] = dict(snapshot["match"])
    # match.store_path names this process's SQLite file, which changes on restart.
    snapshot["match"].pop("store_path")
    if after_restart:
        # _on_feed prepends the restart alert. Leave every earlier row and id in order.
        alert = snapshot["feed"].pop(0)
        assert alert["text"] == "MC RESTARTED. RESUMED THE MATCH IN PLAY"
        assert alert["tag"] == "RESUMED"
        assert alert["id"] == max((row["id"] for row in snapshot["feed"]), default=0) + 1
    return snapshot


def test_committed_fixtures_are_stable_across_two_generations():
    first, second = generate(), generate()
    assert first == second
    assert set(first) == {"armed", "live", "live-capped", "adopted", "recap", "retired"}
    for name, snapshot in first.items():
        committed = json.loads((FIXTURES / name / "session.json").read_text(encoding="utf-8"))
        assert snapshot == committed, name


def test_session_json_restores_and_persists_the_same_file():
    with fixture_run() as (generated, stores, scores):
        for name in ("armed", "live", "live-capped", "adopted", "recap", "retired"):
            source = FIXTURES / name / "session.json"
            original = json.loads(source.read_text(encoding="utf-8"))
            assert generated[name] == original, name
            with tempfile.TemporaryDirectory() as root:
                root = pathlib.Path(root)
                path = root / "session.json"
                shutil.copyfile(source, path)
                if name in stores:
                    old_store = root / "session.sqlite"
                    shutil.copyfile(stores[name], old_store)
                    copied = json.loads(path.read_text(encoding="utf-8"))
                    assert copied["match"]["store_path"] == "session.sqlite"
                    copied["match"]["store_path"] = str(old_store)
                    path.write_text(json.dumps(copied), encoding="utf-8")
                session = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()),
                                  now_ms=lambda: original["saved_ms"])
                session._persist_path = path
                assert session.restore_snapshot() == len(original["players"]), name
                store = Store("restart", root / "restart.sqlite")
                session.store = store
                try:
                    if name in scores:
                        assert "match" in original
                        expected_phase = {"live-capped": "recap", "adopted": "live"}.get(name, name)
                        assert session.resume_match() == expected_phase, name
                        assert scorer_of(session).team_scores() == scores[name], name
                        if name in ("live", "live-capped"):
                            assert len(store.events(match_id=original["match"]["match_id"],
                                                    kinds=("death",))) == (3 if name == "live-capped" else 4)
                        if name == "live-capped":
                            assert scorer_of(session).cap_recv == original["match"]["cap_recv"]
                    else:
                        # RECAP and retired KIT have no active match block.
                        assert "match" not in original
                        assert session.snapshot_codec._match_snapshot() is None
                        assert session.resume_match() is None
                    session._persist_last = 0.0
                    session._persist()
                    saved = json.loads(path.read_text(encoding="utf-8"))
                finally:
                    store.close()
                if name in ("recap", "retired"):
                    assert saved == original, name
                elif name == "live-capped":
                    # The capped match finishes on resume, so the file becomes a RECAP file. Compare all of it with
                    # the reviewed golden of that restart (written by the pre-slice-2a code; see the module docstring).
                    assert "match" not in saved
                    assert saved["ended"][-1]["recap"]["score"] == scores[name]
                    golden = FIXTURES / "live-capped" / "after-restart.json"
                    if os.environ.get("BRX_WRITE_SESSION_JSON_GOLDEN") == "1":
                        golden.write_text(json.dumps(saved, indent=2, sort_keys=True) + "\n", encoding="utf-8")
                    assert saved == json.loads(golden.read_text(encoding="utf-8")), name
                else:
                    assert _active_comparable(saved, after_restart=True) == _active_comparable(original), name


def test_live_fixture_carries_the_difficult_match_fields():
    live = json.loads((FIXTURES / "live" / "session.json").read_text(encoding="utf-8"))
    match = live["match"]
    assert match["evicted_nodes"] == ["node0"]
    assert "node1" in match["unbound_nodes"]
    assert "hot-joined" in match["node_player"]
    assert match["joined_t"]
    assert [row["node_id"] for row in match["departed_stations"]] == ["station-left"]
    assert match["store_path"] == "session.sqlite"
    assert match["alerts"]["leader"] is not None
    assert match["alerts"]["announced"] == ["next_kill_wins"]
    assert len(live["feed"]) > 1
    assert len({row["id"] for row in live["feed"]}) == len(live["feed"])


def test_capped_and_adopted_fixtures_carry_their_match_state():
    capped = json.loads((FIXTURES / "live-capped" / "session.json").read_text(encoding="utf-8"))["match"]
    adopted = json.loads((FIXTURES / "adopted" / "session.json").read_text(encoding="utf-8"))["match"]
    assert capped["live"] is True and capped["cap_recv"] is not None
    assert capped["adopted"] is False
    assert capped["config"]["scoring"]["frag_limit"] == 3
    assert adopted["adopted"] is True and adopted["live"] is True
    assert adopted["match_id"] == "orphan-match"
