"""A11 stage 1: scripts/land.mjs's command line and flake ledger as lib modules (lib/land-cli.mjs, lib/land-flakes.mjs).

WHY. land.mjs was about 1550 lines (the 2026-10-10 tooling review). These parts are pure or take their file as an
argument, so these tests drive them directly; test_land.py still runs the real lander against a bare remote.
"""
import datetime as dt
import json
import tempfile
from pathlib import Path

from _node import run_node_json

REPO = Path(__file__).resolve().parents[2]
LIB = REPO / "scripts" / "lib"


def _node(body: str, mod: str):
    return run_node_json(f"const m = await import({json.dumps((LIB / f'{mod}.mjs').as_uri())});\n"
                         f"console.log(JSON.stringify(await (async () => {{ {body} }})()));", cwd=REPO)


def test_number_options_refuse_a_bad_value_instead_of_using_the_default():
    got = _node("const n = (argv, ...a) => m.parseLandArgs(argv).numberOpt(...a);"
                " return [n(['wait', 'x'], '--timeout-min', 60, 0, 1e6, true), n(['wait', 'x', '--timeout-min', '0'], '--timeout-min', 60, 0, 1e6, true),"
                " n(['wait', 'x', '--timeout-min', 'abc'], '--timeout-min', 60), n(['run', '--batch'], '--batch', 4, 1, 50),"
                " n(['run', '--batch', '0'], '--batch', 4, 1, 50), n(['wait', 'x', '--timeout-min', '1e308'], '--timeout-min', 60)];", "land-cli")
    assert got[0] == {"value": 60} and got[1] == {"value": 0}
    assert got[2] == {"error": '--timeout-min needs a number above 0, at most 1000000 (got "abc")'}
    assert got[3] == {"error": "--batch needs a number, 1 or more, at most 50 (got nothing)"}
    assert "error" in got[4] and "error" in got[5]


def test_positionals_skip_the_values_of_valued_flags():
    got = _node("return m.parseLandArgs(['submit', '--owner', 'brx2', '--note', 'a note', 'stray']).positional;", "land-cli")
    assert got == ["stray"]


def test_check_flags_names_the_typo_the_other_commands_flag_and_extra_ids():
    got = _node("const c = argv => m.checkFlags(argv, argv[0], m.parseLandArgs(argv).positional);"
                " return [c(['wait', 'x', '--timeout', '5']), c(['wait', 'x', '--dry-run']), c(['run', '--batch', '--dryrun']),"
                " c(['submit', '--owner', 'b', '--note', '--not-a-flag']), c(['wait', 'a', 'b']), c(['wait', 'x', '\\u2014timeout-min', '5']),"
                " c(['status', '--no-drive'])];", "land-cli")
    assert got[0] == "unknown flag --timeout; did you mean --timeout-min?"
    assert got[1] == "wait does not take --dry-run"
    assert got[2] == "unknown flag --dryrun; did you mean --dry-run?"   # a number value never hides a typo
    assert got[3] is None                                                # a free-text value may start with --
    assert got[4] == "wait takes 1 id; unexpected b"
    assert got[5] == "unknown flag —timeout-min; did you mean --timeout-min?"
    assert got[6] is None


def _iso(minutes_ago: float) -> str:
    return (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=minutes_ago)).isoformat()


def test_the_flake_ledger_counts_the_last_day_outside_incidents_and_load():
    rows = [{"job": "mc-koth", "time": _iso(60)}, {"job": "mc-koth", "time": _iso(30), "outside_load": True},
            {"job": "mc-koth", "time": _iso(25 * 60)}, {"job": "mc-koth", "time": _iso(-30)},   # too old; in the future
            {"job": "mc-koth", "time": _iso(200)}, {"incident": {"from": _iso(210), "to": _iso(190), "note": "n"}, "time": _iso(1)},
            {"job": "mcp", "time": _iso(10), "exit": 1}]
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / "state" / "flakes.jsonl"
        f.parent.mkdir()
        f.write_text("".join(json.dumps(r) + "\n" for r in rows) + "not json\n")
        got = _node(f"const l = m.createFlakeLedger({json.dumps(str(f))});"
                    " const before = [l.counted('mc-koth'), l.counted('mcp'), l.counted('mc-koth', Date.now() - 200 * 60000)];"
                    " l.record({ job: 'mcp', exit: 2 });"
                    " const fresh = m.createFlakeLedger(" + json.dumps(str(Path(d) / "new-state" / "flakes.jsonl")) + ");"
                    " fresh.record({ job: 'site' });"   # record() makes a missing state folder itself
                    " return { before, after: l.counted('mcp'), summary: l.summary(), rows: l.rows().length, budget: m.FLAKE_BUDGET,"
                    " fresh: fresh.rows().map(r => r.job) };",
                    "land-flakes")
    assert got["before"] == [1, 1, None]     # mc-koth: only the one an hour ago; a moment inside an incident counts nothing
    assert got["after"] == 2 and got["rows"] == len(rows) + 1 and got["budget"] == 3
    s = got["summary"]
    assert s.startswith("flakes this run: mcp x1 (exit 2); last 7 days: ")
    # 7 days: every mc-koth row but the one inside the incident (outside load and future rows still show), both mcp rows
    assert "last 7 days: mc-koth x4, mcp x2 (exit 2); 1 excluded as incident noise (n)" in s, s
    assert s.endswith("(a job that keeps coming back here is a FOLLOWUPS row)") and got["fresh"] == ["site"]


def test_a_command_name_from_the_object_prototype_is_refused_with_the_usage():
    # Opus review (older bug): COMMANDS['constructor'] was truthy, so `land constructor --x` passed the usage check and
    # then threw inside the flag check.
    import subprocess
    from _node import NODE_BIN
    from _skip import needs
    needs(NODE_BIN, "node")
    r = subprocess.run([NODE_BIN, str(REPO / "scripts" / "land.mjs"), "constructor", "--x"], cwd=REPO,
                       capture_output=True, text=True, timeout=30)
    assert r.returncode == 4 and r.stdout.startswith("usage: node scripts/land.mjs"), r.stdout + r.stderr


def test_the_lander_lock_has_one_holder_reaps_a_dead_one_and_releases_in_order():
    # A11 stage 2 (lib/land-lock.mjs). Two locks on one folder: the second cannot take it while the first holds it; a
    # dead lander's entry is reaped; release runs onRelease while this entry still exists, then removes it.
    with tempfile.TemporaryDirectory() as d:
        got = _node(f"const fs = await import('node:fs'); const dir = {json.dumps(d)} + '/lock'; let seen = null;"
                    " fs.mkdirSync(dir); const dead = String(Date.now() - 60000).padStart(15, '0') + '-999999999-dead00';"
                    " fs.writeFileSync(dir + '/' + dead, ''); const old = (Date.now() - 60000) / 1000; fs.utimesSync(dir + '/' + dead, old, old);"
                    " const a = m.createLanderLock(dir, { onRelease: () => { seen = fs.readdirSync(dir); } });"
                    " const b = m.createLanderLock(dir);"
                    " const gotA = await a.acquire(); const gotB = await b.acquire();"
                    " const state = { gotA, gotB, entries: fs.readdirSync(dir), holder: a.holder(), still: a.stillHolder(), bStill: b.stillHolder() };"
                    " const entry = a.entry; a.release();"
                    " return { ...state, entry, seen, after: fs.readdirSync(dir), entryAfter: a.entry, holderAfter: b.holder() };",
                    "land-lock")
    assert got["gotA"] is True and got["gotB"] is False
    assert got["entries"] == [got["entry"]]                      # the dead entry was reaped
    assert got["holder"]["pid"] > 0 and got["still"] is True and got["bStill"] is False
    assert got["seen"] == [got["entry"]] and got["after"] == []    # onRelease saw the entry; then it went
    assert got["entryAfter"] is None and got["holderAfter"] is None


def test_a_lander_that_sees_an_earlier_entry_in_its_double_check_backs_off():
    # Codex review: the double check is what stops two landers that start together. Here a second lander's entry, named
    # earlier but written after this one's first check (as a racing process would), appears during the 500 ms sleep:
    # this lander must release (onRelease runs) and lose, leaving the other entry alone.
    with tempfile.TemporaryDirectory() as d:
        got = _node(f"const fs = await import('node:fs'); const dir = {json.dumps(d)} + '/lock'; const released = [];"
                    " const l = m.createLanderLock(dir, { onRelease: () => released.push(fs.readdirSync(dir).length) });"
                    " const pending = l.acquire();"
                    " const other = String(Date.now() - 5).padStart(15, '0') + '-' + process.ppid + '-other0';"
                    " fs.writeFileSync(dir + '/' + other, '');"
                    " const won = await pending;"
                    " return { won, released, left: fs.readdirSync(dir), other, entry: l.entry };", "land-lock")
    assert got["won"] is False and got["entry"] is None
    assert got["released"] == [2]                  # onRelease ran while both entries existed
    assert got["left"] == [got["other"]]           # only the other lander's entry is left


def test_the_result_store_never_lets_a_withdraw_replace_a_final_result():
    # A11 stage 3 (lib/land-results.mjs).
    with tempfile.TemporaryDirectory() as d:
        got = _node(f"const s = m.createResultStore({json.dumps(d)} + '/state', {{ fail: msg => {{ throw new Error('LAND ' + msg); }} }});"
                    " const id = '20261012-brx2-x'; s.writeResult({ id, status: 'queued' }); s.writeResult({ id, status: 'withdrawn' });"
                    " const withdrawn = s.readResult(id).status; s.writeResult({ id: id + 'y', status: 'landed', main_sha: 'abc' });"
                    " let err = ''; try { s.writeResult({ id: id + 'y', status: 'withdrawn' }); } catch (e) { err = e.message; }"
                    " return { withdrawn, owner: s.readResult(id).owner, after: s.readResult(id + 'y').status, err,"
                    "   run: s.runResults.map(r => r.status), missing: s.readResult('nope') };", "land-results")
    assert got["withdrawn"] == "withdrawn" and got["owner"] == "brx2" and got["after"] == "landed"
    assert got["err"] == "LAND 20261012-brx2-xy is already landed; refusing to replace its result"
    assert got["run"] == ["queued", "withdrawn", "landed"] and got["missing"] is None


def test_the_main_red_record_keeps_the_fixes_tried_on_the_same_main_only():
    with tempfile.TemporaryDirectory() as d:
        got = _node(f"const s = m.createResultStore({json.dumps(d)} + '/state');"
                    " s.recordMainRed('sha1', 'red', ['f1']); s.recordMainRed('sha1', 'red again', ['f2', 'f1']);"
                    " const same = s.readMainRed(); s.recordMainRed('sha2', 'new main'); return { same, next: s.readMainRed() };",
                    "land-results")
    assert got["same"]["fix_tried"] == ["f1", "f2"] and got["same"]["message"] == "red again"
    assert got["next"]["main_sha"] == "sha2" and got["next"]["fix_tried"] == []


def test_report_lines_name_each_outcome():
    got = _node("return [[m.fixMainLine({ fix_main: 'why' }), ...m.reportLines({ id: 'a', status: 'landed', main_sha: 's', fix_main: 'why' }, 'http://ci')],"
                " m.reportLines({ id: 'b', status: 'conflict', conflict_files: ['x.md'] }, null),"
                " m.reportLines({ id: 'c', status: 'withdrawn' }, null),"
                " m.reportLines({ id: 'd', status: 'red', failed_jobs: ['mcp'], note: 'n', log: '/l' }, null),"
                " m.reportLines({ id: 'e', status: 'conflict', conflicts_with: 'land/z', conflict_files: [] }, null),"
                " m.reportLines({ id: 'f', status: 'landed', main_sha: 's' }, null), m.reportLines({ id: 'g', status: 'red' }, null),"
                " m.fixMainLine({})];", "land-results")
    assert got[0] == ["land: fix-main: why", "land: a landed; main s\nland: CI http://ci"]
    assert got[1] == ["land: b conflicts with main in: x.md; the branch is now land-failed/b"]
    assert got[2] == ["land: c withdrawn; it was removed from the queue"]
    assert got[3] == ["land: d is red: mcp; n\nland: log /l; the branch is now land-failed/d"]
    assert got[4] == ["land: e conflicts with land/z in: (no file list); the branch is now land-failed/e"]
    assert got[5] == ["land: f landed; main s"] and got[6] == ["land: g is red: ; the branch is now land-failed/g"]
    assert got[7] is None


def test_land_mjs_turns_a_refused_withdraw_into_its_own_error():
    # Opus review: the module tests use a plain Error. The lander must pass a fail that throws its LandError, so the
    # refusal prints without "unexpected error:" (the catch at the bottom of land.mjs).
    src = (REPO / "scripts" / "land.mjs").read_text()
    assert "createResultStore(STATE, { fail: message => { throw new LandError(message); } })" in src
    report = src.split("function report(r) {")[1].split("\n}\n")[0]
    assert report.index("fixMainLine(r)") < report.index("ciUrl(")   # fix-main prints before the slow CI lookup


def test_the_gate_runner_logs_a_command_prunes_old_logs_and_reaps_what_it_left():
    # A11 stage 4 (lib/land-gate-run.mjs). A child in its own session carries the gate token, so the reap takes it.
    needs_proc = Path("/proc/self/stat").exists()
    from _skip import needs
    needs(needs_proc, "/proc (lib/reap.mjs reads it)")
    with tempfile.TemporaryDirectory() as d:
        got = _node(f"const fs = await import('node:fs'); const state = {json.dumps(d)} + '/state', wt = {json.dumps(d)};"
                    " fs.mkdirSync(state + '/logs', { recursive: true });"
                    " for (let i = 0; i < 205; i++) fs.writeFileSync(state + '/logs/' + String(i).padStart(4, '0') + '-old.log', '');"
                    " const g = m.createGateRunner({ state, worktree: () => wt, token: 'tok-' + process.pid });"
                    " const r = await g.runLogged(['sh', '-c', 'echo out; echo err >&2; echo prio=$BRX_LAND_PRIORITY gate=$BRX_LAND_GATE; setsid sleep 30 >/dev/null 2>&1 & echo $! > kid; sleep 0.3; exit 3']);"
                    " const kid = Number(fs.readFileSync(wt + '/kid', 'utf8'));"
                    " let alive; try { alive = fs.readFileSync(`/proc/${kid}/stat`, 'utf8').split(') ')[1][0] !== 'Z'; } catch { alive = false; }"
                    " try { process.kill(kid, 'SIGKILL'); } catch {}"
                    " return { code: r.code, log: fs.readFileSync(r.log, 'utf8'), logs: fs.readdirSync(state + '/logs').length,"
                    "   oldest: fs.readdirSync(state + '/logs').sort()[0], alive, child: g.child };", "land-gate-run")
    assert got["code"] == 3 and got["child"] is None and got["alive"] is False
    assert got["log"].startswith("$ sh -c echo out;") and "out\n" in got["log"] and "err\n" in got["log"]
    assert "land: the gate left 1 process(es) behind; reaped: sleep" in got["log"]
    assert "prio=1 gate=tok-" in got["log"]   # the gate's test-all gets pool priority and carries the reap token
    assert got["logs"] == 201 and got["oldest"] == "0005-old.log"   # the newest 200 kept, then this run's own


def test_step_of_names_the_failing_test_or_the_error_line_and_list_jobs_reads_names():
    with tempfile.TemporaryDirectory() as d:
        for name, text in (("a", "x\nFAIL test_x::test_y\nFAIL other\n"), ("b", "ok\n  Error: Target closed\nmore\n"), ("c", "fine\n")):
            (Path(d) / name).write_text(text)
        got = _node(f"const d = {json.dumps(d)}; return [m.stepOf(d + '/a'), m.stepOf(d + '/b'), m.stepOf(d + '/c'),"
                    " m.stepOf(d + '/missing'), m.listJobs('test-all: 3 job(s)\\nmcp\\n mc-play \\n\\nNot-a-job\\napp-e2e\\n')];",
                    "land-gate-run")
    assert got == ["test_x::test_y", "Error: Target closed", None, None, ["mcp", "mc-play", "app-e2e"]]


def test_land_mjs_signal_handler_stops_the_live_gate_and_reaps_with_the_gate_token():
    # Both reviews: the module tests cannot see land.mjs's wiring. A Ctrl-C during a gate must stop the gate's group
    # and reap with the same token its children carry.
    src = (REPO / "scripts" / "land.mjs").read_text()
    handler = src.split("for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {")[1].split("\n}\n")[0]
    assert "process.kill(-gateRun.child.pid, 'SIGTERM')" in handler
    assert "reapByEnvSync(GATE_KEY, gateRun.token, { waitMs: 3000 })" in handler
    assert src.index("const gateRun = createGateRunner(") < src.index("for (const [sig, code] of [['SIGINT', 130]")
