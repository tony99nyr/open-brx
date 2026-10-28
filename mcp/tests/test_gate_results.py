"""Machine-readable test-all results and the lander verdict."""
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from _node import run_node_json
from _skip import needs

REPO = Path(__file__).resolve().parents[2]
NODE = shutil.which("node")


def _gate(expression):
    return run_node_json("import * as m from './scripts/lib/land-gate.mjs';"
                         f"console.log(JSON.stringify({expression}));", cwd=REPO)


def test_test_all_list_writes_an_incomplete_record_with_its_selection():
    needs(NODE, "node")
    with tempfile.TemporaryDirectory() as directory:
        result_path = Path(directory) / "nested" / "results.json"
        result = subprocess.run([NODE, "scripts/test-all.mjs", "--list", "mcp"], cwd=REPO,
                                env={**os.environ, "BRX_RESULTS_JSON": str(result_path)},
                                capture_output=True, text=True, timeout=30)
        assert result.returncode == 0, result.stderr
        record = json.loads(result_path.read_text())
        assert record["version"] == 1 and record["complete"] is False
        assert record["selected"] == ["mcp-core", "mcp-docs", "mcp-sim"] and record["jobs"] == []   # F626: a substring
        assert record["build"] is None
        assert record["startedAt"] and record["finishedAt"]


def test_test_all_refusal_writes_an_incomplete_record():
    needs(NODE, "node")
    with tempfile.TemporaryDirectory() as directory:
        result_path = Path(directory) / "results.json"
        result = subprocess.run([NODE, "scripts/test-all.mjs", "no-such-gate"], cwd=REPO,
                                env={**os.environ, "BRX_RESULTS_JSON": str(result_path)},
                                capture_output=True, text=True, timeout=30)
        assert result.returncode == 2, result.stderr
        record = json.loads(result_path.read_text())
        assert record["complete"] is False and record["selected"] == []
        assert record["jobs"] == [] and record["build"] is None


def test_test_all_writes_external_results_when_its_logs_dir_cannot_be_created():
    needs(NODE, "node")
    with tempfile.TemporaryDirectory() as directory:
        blocked = Path(directory) / "blocked"
        blocked.write_text("a file cannot contain a logs dir")
        result_path = Path(directory) / "results.json"
        result = subprocess.run([NODE, "scripts/test-all.mjs", "--list", "mcp"], cwd=REPO,
                                env={**os.environ, "BRX_TEST_ALL_LOGS_DIR": str(blocked / "logs"),
                                     "BRX_RESULTS_JSON": str(result_path)},
                                capture_output=True, text=True, timeout=30)
        assert result.returncode != 0, result.stdout + result.stderr
        record = json.loads(result_path.read_text())
        assert record["complete"] is False and record["jobs"] == []


def test_read_gate_prefers_json_and_falls_back_to_the_table():
    with tempfile.TemporaryDirectory() as directory:
        result_path = Path(directory) / "results.json"
        table = "job               result  secs\nmcp               ok      1\n"
        result_path.write_text(json.dumps({"version": 1, "complete": True, "selected": ["mcp"],
                                           "jobs": [{"name": "mcp", "ok": False, "exit": 1, "secs": 1,
                                                     "log": "/tmp/mcp.log", "cached": False}], "build": None,
                                           "startedAt": "a", "finishedAt": "b"}))
        preferred = _gate(f"m.readGate({json.dumps(str(result_path))}, {json.dumps(table)})")
        assert preferred["rows"] == [{"name": "mcp", "ok": False}]
        assert preferred["logs"]["mcp"] == "/tmp/mcp.log"
        assert preferred["complete"] is True
        result_path.unlink()
        fallback = _gate(f"m.readGate({json.dumps(str(result_path))}, {json.dumps(table)})")
        assert fallback["rows"] == [{"name": "mcp", "ok": True}]
        assert _gate(f"m.gateGreen({json.dumps(fallback)}, {{code: 0, expect: ['mcp']}})") is True


def test_an_invalid_or_unreadable_record_is_a_failed_build_never_the_table_and_never_a_crash():
    with tempfile.TemporaryDirectory() as directory:
        result_path = Path(directory) / "results.json"
        table = "job               result  secs\nmcp               ok      1\n"   # says green: must be ignored
        valid = {"version": 1, "complete": True, "selected": ["mcp"], "jobs": [], "build": None,
                 "startedAt": "a", "finishedAt": "b"}
        for bad in (json.dumps({"version": 1, "complete": True, "jobs": []}), "{not json",
                    "null", json.dumps({**valid, "jobs": [None]})):
            result_path.write_text(bad)
            got = _gate(f"m.readGate({json.dumps(str(result_path))}, {json.dumps(table)})")
            assert got["build"] == {"name": "results.json", "log": str(result_path)} and got["rows"] == [], (bad, got)
            assert _gate(f"m.gateGreen({json.dumps(got)}, {{code: 0, expect: ['mcp']}})") is False, bad


def test_gate_green_requires_one_ok_row_per_expected_job_and_a_complete_run():
    base = {"rows": [{"name": "mcp", "ok": True}], "logs": {}, "exits": {}, "build": None,
            "complete": True}
    cases = [
        (base, 0, ["mcp"], True),
        (base, 0, ["mcp", "site"], False),
        ({**base, "rows": [*base["rows"], {"name": "site", "ok": True}]}, 0, ["mcp"], False),
        ({**base, "rows": base["rows"] * 2}, 0, ["mcp"], False),
        (base, 0, [], False),
        ({**base, "rows": []}, 0, ["mcp"], False),
        ({**base, "complete": False}, 0, ["mcp"], False),
        ({**base, "build": {"name": "app-build", "log": "/tmp/build.log"}}, 0, ["mcp"], False),
        (base, 1, ["mcp"], False),
        ({**base, "rows": [*base["rows"], {"name": "site", "ok": False}]}, 0, ["mcp"], False),
    ]
    for result, code, expect, wanted in cases:
        actual = _gate(f"m.gateGreen({json.dumps(result)}, "
                       f"{{code: {code}, expect: {json.dumps(expect)}}})")
        assert actual is wanted, (result, code, expect)
