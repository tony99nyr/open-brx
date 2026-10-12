"""A10 stage 1: scripts/test-all.mjs's command line, --changed plan, results record and report, as lib modules.

WHY. test-all.mjs was about 750 lines with hidden globals and source-text test pins (the 2026-10-10 tooling review).
These modules are pure, so these tests drive them directly; the end-to-end tests (test_test_all_changed,
test_gate_results) still run the real script.
"""
import json
import tempfile
from pathlib import Path

from _node import run_node_json

REPO = Path(__file__).resolve().parents[2]
LIB = REPO / "scripts" / "lib"


def _node(body: str, *mods: str):
    imports = " ".join(f"const {name} = await import({json.dumps((LIB / f'{mod}.mjs').as_uri())});"
                       for name, mod in (m.split("=") for m in mods))
    return run_node_json(f"{imports}\nconsole.log(JSON.stringify(await (async () => {{ {body} }})()));", cwd=REPO)


def test_parse_args_reads_flags_filters_and_the_changed_base():
    got = _node("return [c.parseArgs(['--ui', 'mcp', '--changed', 'abc123', 'site']),"
                " c.parseArgs(['--changed', '--list']), c.parseArgs(['--cache', '--no-cache', 'app'])];", "c=test-all-cli")
    a, b, c = got
    assert a == {"ui": True, "list": False, "cache": False, "changed": True, "changedBase": "abc123", "filters": ["mcp", "site"]}
    assert b["changed"] and b["changedBase"] is None and b["list"] and b["filters"] == []
    assert c["cache"] is False and c["filters"] == ["app"]


def test_plan_changed_adds_named_jobs_turns_ui_on_and_logs_each_reason():
    got = _node("const lines = []; const allJobs = [{ name: 'mcp' }, { name: 'site' }, { name: 'mc-play', ui: true }];"
                " const one = c.planChanged({ base: 'B', paths: ['webapp/mc/test/e2e/play.mjs'], named: ['site'], ui: false,"
                "   allJobs, log: l => lines.push(l) });"
                " const all = c.planChanged({ base: 'B', paths: ['scripts/test-all.mjs'], named: ['mcp'], ui: false,"
                "   allJobs, log: () => {} });"
                " return { one, all, lines };", "c=test-all-cli")
    assert got["one"]["ui"] is True and "site" in got["one"]["filters"]
    assert got["all"]["filters"] == []   # everything: a named job never narrows it
    assert got["lines"][0] == "test-all: --changed vs B: 1 path(s) changed"
    assert "test-all: --changed selected a UI-only job; adding --ui (ci.yml does not run those)" in got["lines"]
    assert any(l.startswith("  site: ") and "named on the command line" in l for l in got["lines"])


def test_gate_record_writes_both_copies_and_reports_a_lost_lander_copy():
    with tempfile.TemporaryDirectory() as tmp:
        logs, lander = Path(tmp) / "logs", Path(tmp) / "lander" / "r.json"
        blocked = Path(tmp) / "a-file"
        blocked.write_text("")   # a lander path under a file cannot be written (ENOTDIR)
        got = _node(f"const g = r.createGateRecord({{ logs: {json.dumps(str(logs))}, resultsJson: {json.dumps(str(lander))},"
                    " logError: () => {} });"
                    " g.addJob({ name: 'mcp', code: 0, secs: 3 }); g.addJob({ name: 'site', code: 'SIGKILL', secs: 1, log: '/x' });"
                    " g.addJob({ name: 'app', code: 'ERROR boom', secs: 0 });"
                    " const ok = g.write(true);"
                     " const bad = r.createGateRecord({ logs: " + json.dumps(str(Path(tmp) / "logs2")) + ", resultsJson: " + json.dumps(str(blocked / "r.json")) + ","
                    " logError: () => {} }).write(true);"
                    " return { ok, bad, written: g.written };", "r=gate-record")
        assert got == {"ok": True, "bad": False, "written": True}
        own, theirs = json.loads((logs / "results.json").read_text()), json.loads(lander.read_text())
        assert own["jobs"] == theirs["jobs"] and own["complete"] is True
        assert [(j["name"], j["ok"], j["exit"]) for j in own["jobs"]] == [("mcp", True, 0), ("site", False, "SIGKILL"), ("app", False, 1)]
        assert own["jobs"][0]["log"] == str(logs / "mcp.log")


def test_the_report_round_trips_through_the_landers_fallback_parser():
    got = _node("const results = [{ name: 'mcp', code: 0, secs: 12.4 }, { name: 'site', code: 1, secs: 40, log: '/tmp/site.log' },"
                " { name: 'mc-play', code: 'TIMEOUT', secs: 600, log: '/tmp/p.log' }];"
                " const out = [...rep.tableLines(results, ['app-tsc']),"
                "   ...rep.failureLines(results[1], 'a\\nb\\n'), ...rep.failureLines(results[0], null)].join('\\n');"
                " return { out, parsed: g.parseGate(out) };", "rep=report", "g=land-gate")
    parsed = got["parsed"]
    assert [(r["name"], r["ok"]) for r in parsed["rows"]] == [("mc-play", False), ("site", False), ("mcp", True)]
    assert parsed["logs"]["site"] == "/tmp/site.log" and parsed["exits"]["site"] == "1"
    assert "cached: app-tsc" in got["out"]


def test_the_summary_line_keeps_its_wording():
    got = _node("return [rep.summaryLine({ passed: 30, total: 31, secs: 861.4, realPeakMb: 3943.2, ceilingMb: 6482, taskPeak: 5021,"
                " taskMax: 37051, taskReserve: 1500, plannedPeakMb: 6480, budgetMb: 7627 }),"
                " rep.summaryLine({ passed: 1, total: 1, secs: 2, realPeakMb: null, ceilingMb: 10, taskPeak: 900, taskMax: 1000,"
                " taskReserve: 200, plannedPeakMb: 5, budgetMb: 12 })];", "rep=report")
    assert got[0] == ("\n30/31 job(s) passed in 861s (real peak 3943 MB against a 6482 MB ceiling, peak 5021 of 37051 tasks,"
                      " planned peak 6480 MB, 7627 MB budget)")
    assert "real peak not measured" in got[1] and "(over the 200 reserve: outside load used the margin)" in got[1]


def test_the_table_the_cached_report_and_the_failure_tail_keep_their_exact_text():
    got = _node("const t = rep.tableLines([{ name: 'mcp', code: 0, secs: 12.4 }, { name: 'mc-play', code: 'TIMEOUT', secs: 600 }], ['a']);"
                " const log = Array.from({ length: 40 }, (_, i) => `l${i}`).join('\\n') + '\\n';"
                " return { t, c: rep.allCachedLines(['mcp', 'site']), f: rep.failureLines({ name: 'x', code: 2, log: '/l' }, log),"
                "   missing: rep.failureLines({ name: 'y', code: 'TIMEOUT', log: '/m' }, null) };", "rep=report")
    assert got["t"] == ["\njob               result  secs", "mc-play           TIMEOUT 600", "mcp               ok      12", "cached: a"]
    assert got["c"] == ["\njob               result  secs", "mcp               ok      0", "site              ok      0",
                        "cached: mcp, site", "\n2/2 job(s) passed in 0s (all cached)"]
    assert got["f"][0] == "\n---- x (exit 2), last 30 lines of /l"
    assert got["f"][1].split("\n") == [f"l{i}" for i in range(10, 40)]
    assert got["missing"] == ["\n---- y (exit TIMEOUT), last 30 lines of /m", "TIMEOUT"]


def test_an_all_cached_exit_keeps_a_lost_record_failure():
    # Opus review: `process.exit(0)` after writeResults(true) overrode the exitCode a lost lander copy set.
    src = (REPO / "scripts" / "test-all.mjs").read_text()
    assert "process.exit(0)" not in src.split("const printAllCached")[1].split("const groups = new Set()")[0]
    assert src.count("writeResults(true);\n") == src.count("writeResults(true);\n    process.exit(process.exitCode || 0);") + \
        src.count("writeResults(true);\n  process.exit(process.exitCode || 0);")
