"""O17: the launcher scripts (scripts/lib/redact.mjs) and the bug-report scrub (report.py) read ONE rule file,
mcp/brx_mcp/mc/redact_patterns.json, and agree on every sample in redact_samples.json. The JS side is
checked by scripts/test/redact.test.mjs, which this file runs when `node` is on the path."""
import json
import shutil
import subprocess
from pathlib import Path

from _skip import needs

from brx_mcp.mc import report

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
SAMPLES = json.loads((HERE / "redact_samples.json").read_text(encoding="utf-8"))["samples"]


def test_report_scrub_matches_every_sample():
    for s in SAMPLES:
        assert report.scrub_text(report.Aliaser(), s["in"]) == s["out"], s["in"]


def test_report_uses_the_shared_rule_file():
    rules = json.loads((REPO / "mcp/brx_mcp/mc/redact_patterns.json").read_text(encoding="utf-8"))["secret_patterns"]
    assert [p.pattern for p in report._SECRET_PATTERNS] == [r["pattern"] for r in rules]


def test_js_side_agrees():
    node = shutil.which("node")
    needs(node, "node")
    files = sorted(str(f) for f in (REPO / "scripts" / "test").glob("*.test.mjs"))
    done = subprocess.run([node, "--test", *files], capture_output=True, text=True, timeout=120)
    assert done.returncode == 0, done.stdout[-2000:] + done.stderr[-2000:]
