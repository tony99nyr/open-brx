"""A10 stage 1: scripts/test-all.mjs's command line, --changed plan, results record and report, as lib modules.

WHY. test-all.mjs was about 750 lines with hidden globals and source-text test pins (the 2026-10-10 tooling review).
These modules are pure, so these tests drive them directly; the end-to-end tests (test_test_all_changed,
test_gate_results) still run the real script.
"""
import json
import tempfile
from pathlib import Path

from _node import run_node_json
from _skip import needs

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
    assert "process.exit(0)" not in src.split("const printAllCached")[1].split("const runner = createJobRunner(")[0]
    assert src.count("writeResults(true);\n") == src.count("writeResults(true);\n    process.exit(process.exitCode || 0);") + \
        src.count("writeResults(true);\n  process.exit(process.exitCode || 0);")


def _run_jobs(body: str):
    """`body` gets `r` (a job runner on a temp root, with an `mcp` folder) and `root`; it returns the result."""
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "mcp").mkdir()
        return _node(f"const root = {json.dumps(tmp)}; const fs = await import('node:fs');"
                     " const ends = []; const r = jr.createJobRunner({ root, logs: root + '/logs', baseEnv: { BASE: 'b', PATH: process.env.PATH },"
                     " runToken: 'test-' + process.pid, onEnd: name => ends.push(name), logError: () => {} });"
                     " fs.mkdirSync(root + '/logs');" + body, "jr=job-runner")


def test_the_runner_gives_a_job_its_environment_and_its_own_log():
    got = _run_jobs("const res = await r.run('envjob', '.', [process.execPath, '-e',"
                    " 'const e = process.env; console.log(JSON.stringify({ b: e.BASE, own: e.OWN, py: e.PYTHONPATH,"
                    " exp: e.BRX_MCP_EXPECT_DIR, home: e.BRX_MCP_HOME, reap: e.BRX_TEST_REAP }))'],"
                    " { OWN: 'o', PYTHONPATH: '/x' }, 10);"
                    " return { res, env: JSON.parse(fs.readFileSync(res.log, 'utf8')), root, ends };")
    env, root = got["env"], got["root"]
    assert got["res"]["code"] == 0 and got["res"]["name"] == "envjob" and got["ends"] == ["envjob"]
    assert env["b"] == "b" and env["own"] == "o"
    assert env["py"] == f"{root}/mcp:/x" and env["exp"] == f"{root}/mcp"   # this checkout's mcp first
    assert env["home"] == f"{root}/logs/envjob-brx-mcp-home" and env["reap"].endswith(":envjob")


# A pid counts as alive unless /proc says it is gone or a zombie. `kid` files hold the pids a job started; the finally
# kills them, so a failed assertion cannot leave a 30 s sleep behind.
_ALIVE = ("const alive = f => { const pid = Number(fs.readFileSync(root + '/' + f, 'utf8'));"
          " try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1][0] !== 'Z'; } catch { return false; } };"
          " const cleanup = () => { for (const f of ['kid']) { try { process.kill(Number(fs.readFileSync(root + '/' + f, 'utf8')), 'SIGKILL'); }"
          " catch { /* gone, or never started */ } } };")


def test_the_runner_times_a_job_out_and_takes_its_whole_group_down():
    needs(Path("/proc/self/stat").exists(), "/proc (the liveness check and lib/reap.mjs read it)")
    # The grandchild drops the reap token, so only the group kill can reach it. `up` proves it was running.
    got = _run_jobs(_ALIVE + " try { const res = await r.run('slow', '.', ['sh', '-c',"
                    " 'env -u BRX_TEST_REAP sleep 30 & echo $! > kid; sleep 0.2; kill -0 $! && echo yes > up; wait'], {}, 2);"
                    " return { res, up: fs.existsSync(root + '/up'), alive: alive('kid'), tail: fs.readFileSync(res.log, 'utf8'),"
                    " groups: r.groups.size }; } finally { cleanup(); }")
    assert got["up"] and got["res"]["code"] == "TIMEOUT" and got["alive"] is False and got["groups"] == 0
    assert "test-all: killed after 2s" in got["tail"]


def test_the_runner_reaps_what_a_job_left_in_a_session_of_its_own():
    needs(Path("/proc/self/stat").exists(), "/proc (the liveness check and lib/reap.mjs read it)")
    # A detached MC or vite is out of reach of the group kill; it carries the job's reap token, so the reaper takes it.
    # `up` proves setsid really started it in a session of its own before the job ended.
    got = _run_jobs(_ALIVE + " try { const res = await r.run('leaver', '.', ['sh', '-c',"
                    " 'setsid sleep 30 & echo $! > kid; sleep 0.3; kill -0 $! && [ \"$(ps -o sid= -p $!)\" -ne \"$(ps -o sid= -p $$)\" ]"
                    " && echo yes > up'], {}, 10);"
                    " return { res, up: fs.existsSync(root + '/up'), alive: alive('kid') }; } finally { cleanup(); }")
    assert got["up"], "setsid did not start the child in its own session: this test would prove nothing"
    assert got["res"]["code"] == 0 and got["alive"] is False


def test_the_runner_refuses_a_job_without_a_timeout():
    got = _run_jobs("try { await r.run('x', '.', ['true'], {}); return 'ran'; } catch (e) { return e.message; }")
    assert "needs a timeout" in got


def test_the_runner_reports_a_failing_job_with_its_exit_code():
    got = _run_jobs("return await r.run('bad', '.', ['sh', '-c', 'echo nope; exit 3'], {}, 10);")
    assert got["code"] == 3


def test_jobs_never_inherit_lander_priority():
    # Opus review (older bug): jobEnv copied the environment before BRX_LAND_PRIORITY was removed, so every job (and a
    # test-all a test started) inherited the lander's pool priority.
    src = (REPO / "scripts" / "test-all.mjs").read_text()
    assert src.index("delete process.env.BRX_LAND_PRIORITY;") < src.index("stripDebugEnv(process.env)")


# app-screens' elastic shards (lib/screens-raise.mjs), driven with a fake pool, a fake clock and real handshake files.
_SCREENS = ("const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');"
            " const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brx-screens-test-'));"
            " process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));"
            " const want = dir + '/want', ack = dir + '/ack'; let t = 1e6, used = 1000, queued = 0; const logs = [], leases = [];"
            " let grant = true, attempts = 0, failPgid = false;"
            " const tryAcquire = req => { attempts++; if (!grant) return null;"
            "   const sized = req.size({ freeMb: 1e6, freeCores: 64, freeTasks: 1e6 });"
            "   const l = { ...sized, released: 0, release() { this.released++; },"
            "   setPgid(p) { if (failPgid) throw new Error('pgid boom'); this.pgid = p; } }; leases.push(l); return l; };"
            " const s = sr.createScreensRaise({ job: { env: { SCREENS_WANT_FILE: want, SCREENS_ACK_FILE: ack }, screensCap: 8 },"
            "   runId: 'r', ceilingMb: 1000 + 240 * 3, tally: { used: () => used, add: mb => { used += mb; } },"
            "   queued: () => queued, stopping: () => false, tryAcquire, now: () => t, log: l => logs.push(l), logError: l => logs.push(l) });"
            " const step = () => { t += 600; s.tick(); };"
            " const read = () => fs.existsSync(want) ? fs.readFileSync(want, 'utf8') : null;")


def test_screens_raise_requests_shards_and_keeps_their_lease_once_applied():
    got = _node(_SCREENS + " s.start(2); s.setPgid(77); fs.writeFileSync(want, '2'); step();"
                " const asked = read(), afterRaise = used, held = leases.map(l => [l.shards, l.released, l.pgid]);"
                " fs.writeFileSync(ack, '5'); step();"
                " return { asked, afterRaise, held, state: s.state, released: leases.map(l => l.released), used, logs };", "sr=screens-raise")
    assert got["asked"] == "5" and got["afterRaise"] == 1000 + 240 * 3     # room for 3 more under the ceiling
    assert got["held"] == [[3, 0, 77]]
    assert got["state"]["shards"] == 5 and got["released"] == [0] and got["used"] == 1000 + 240 * 3
    assert "test-all: app-screens applied 5 shards (3 added)" in got["logs"]


def test_screens_raise_waits_for_the_queue_and_for_want():
    got = _node(_SCREENS + " s.start(2); queued = 1; fs.writeFileSync(want, '2'); step(); const busy = leases.length;"
                " queued = 0; fs.rmSync(want); step(); const notReady = leases.length;"
                " fs.writeFileSync(want, '2'); step(); return { busy, notReady, now: leases.length };", "sr=screens-raise")
    assert got == {"busy": 0, "notReady": 0, "now": 1}


def test_a_given_up_raise_lowers_want_and_releases_its_lease():
    # screens.mjs never applies the 5: after ten ticks the runner gives up. A queued job holds off the retry, which
    # would otherwise ask again in the same tick, so the lowered `want` is visible.
    got = _node(_SCREENS + " s.start(2); fs.writeFileSync(want, '2'); step(); fs.writeFileSync(ack, '2');"
                " for (let i = 0; i < 9; i++) step(); const before = [read(), leases[0].released]; queued = 1; step();"
                " const gaveUp = { want: read(), state: s.state, released: leases[0].released, used };"
                " queued = 0; step(); return { before, gaveUp, retry: [read(), leases.length] };", "sr=screens-raise")
    assert got["before"] == ["5", 0]
    g = got["gaveUp"]
    assert g["want"] == "2" and g["state"]["target"] == 2 and g["released"] == 1 and g["used"] == 1000
    assert got["retry"] == ["5", 2]   # the retry gets a new lease


def test_a_closed_ack_stops_raises_and_finish_releases_everything():
    got = _node(_SCREENS + " s.start(2); fs.writeFileSync(want, '2'); step(); fs.writeFileSync(ack, '5'); step();"
                " fs.writeFileSync(ack, 'closed'); step(); const closed = s.state.closed, kept = leases[0].released;"
                " step(); const after = leases.length; s.finish();"
                " return { closed, kept, after, released: leases[0].released, used, logs };", "sr=screens-raise")
    assert got["closed"] and got["kept"] == 0 and got["after"] == 1          # applied shards keep their lease; no new raise
    assert got["released"] == 1 and got["used"] == 1000
    assert "test-all: app-screens shard acknowledgement: not applied" in got["logs"]   # `closed` is not a number


def test_a_refused_lease_backs_off_for_1500_ms_more():
    # Both reviews: count the attempts, and grant the lease on the tick that comes too soon.
    got = _node(_SCREENS + " s.start(2); fs.writeFileSync(want, '2'); grant = false; step(); const first = attempts;"
                " grant = true; t += 1900; s.tick(); const tooSoon = attempts;"
                " t += 200; s.tick(); return { first, tooSoon, later: attempts, leases: leases.length };", "sr=screens-raise")
    assert got == {"first": 1, "tooSoon": 1, "later": 2, "leases": 1}


def test_ticks_closer_than_500_ms_apart_do_nothing_and_an_ack_above_the_target_is_ignored():
    got = _node(_SCREENS + " s.start(2); fs.writeFileSync(want, '2'); step(); fs.writeFileSync(ack, '5');"
                " t += 100; s.tick(); const early = s.state.shards; t += 400; s.tick(); const onTime = s.state.shards;"
                " fs.writeFileSync(ack, '9'); step(); return { early, onTime, over: s.state.shards };", "sr=screens-raise")
    assert got == {"early": 2, "onTime": 5, "over": 5}


def test_a_raise_that_throws_releases_its_lease_and_stops_raising():
    got = _node(_SCREENS + " s.start(2); fs.writeFileSync(want, '2'); failPgid = true; step();"
                " const after = { closed: s.state.closed, released: leases[0].released, used, extra: s.extraLeases.length };"
                " failPgid = false; step(); return { after, attempts, logs };", "sr=screens-raise")
    assert got["after"] == {"closed": True, "released": 1, "used": 1000, "extra": 0}
    assert got["attempts"] == 1   # closed: no further raise
    assert "test-all: app-screens shard raise stopped: pgid boom" in got["logs"]
