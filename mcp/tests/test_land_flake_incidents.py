"""The land lane's 7-day flake counts leave out flakes recorded inside an incident window (a row
{"incident": {"from", "to", "note"}} in flakes.jsonl): when the machine fails, every rerun fails too, and those rows
would fake recurring jobs. The rows stay in the file as evidence; the summary says how many it excluded."""
import datetime as dt
import json
import os
import pathlib
import shutil
import subprocess
import tempfile

from _skip import needs

REPO = pathlib.Path(__file__).resolve().parents[2]
NODE = shutil.which("node")


def _iso(minutes_ago: int) -> str:
    return (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=minutes_ago)).isoformat()


def _summary(rows: list[dict]) -> str:
    with tempfile.TemporaryDirectory() as d:
        (pathlib.Path(d) / "flakes.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
        r = subprocess.run([NODE, "scripts/land.mjs", "status", "--no-drive"], cwd=REPO, capture_output=True,
                           text=True, timeout=60, env={**os.environ, "LAND_STATE_DIR": d})
        return next((l for l in (r.stdout + r.stderr).splitlines() if "last 7 days" in l), "")


def test_flakes_inside_an_incident_window_leave_the_counts():
    needs(NODE, "node")
    line = _summary([
        {"job": "mc-koth", "time": _iso(120)},                       # inside the incident
        {"job": "mcp", "time": _iso(110)},                           # inside the incident
        {"job": "mc-koth", "time": _iso(10)},                        # after it: real
        {"incident": {"from": _iso(130), "to": _iso(100), "note": "test incident"}, "time": _iso(5)},
    ])
    assert "last 7 days: mc-koth x1" in line, line
    assert "2 excluded as incident noise (test incident)" in line, line


def test_without_an_incident_every_flake_counts():
    needs(NODE, "node")
    line = _summary([{"job": "mc-koth", "time": _iso(120)}, {"job": "mc-koth", "time": _iso(10)}])
    assert "last 7 days: mc-koth x2" in line and "excluded" not in line, line
