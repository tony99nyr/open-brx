"""scripts/land.mjs: the land lane (submit, run, wait, status).

WHY (2026-09-27). Main takes a push about every two minutes from parallel agents, and each agent re-gated the whole
suite before every push. The land lane queues submitted branches as `land/<id>` refs, and one lander merges a batch,
gates it once, bisects a red batch, and pushes main fast-forward only. These tests drive the real script against a
temporary bare remote in each test's own temp dir, with the gate replaced by a stub (LAND_GATE_STUB, which the
script refuses unless LAND_TEST=1; LAND_TEST=1 in turn refuses any remote that is not a local path). Nothing here
can reach the real origin: see test_land_test_refuses_a_non_local_remote.

The stub prints test-all's own table format, so the script's parser is exercised too. Its behaviour follows the
candidate's CONTENT: a file named RED fails the `mcp` job, a file named FLAKE fails `site` once, and cfg.json can
make the stub push to main during a gate (main moving under the lander) or hold two landers at a barrier.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from _skip import needs

REPO = Path(__file__).resolve().parents[2]
LAND = REPO / "scripts" / "land.mjs"
NODE = shutil.which("node")
GIT = shutil.which("git")

STUB = r'''
import json, os, subprocess, sys, time
from pathlib import Path
d = Path(os.environ["STUB_DIR"])
args = sys.argv[1:]
with open(d / "calls.jsonl", "a") as f:
    f.write(json.dumps(args) + "\n")
cfg = json.loads((d / "cfg.json").read_text()) if (d / "cfg.json").exists() else {}
jobs = ["mcp", "site"]
if "--changed" in args:
    jobs = ["mcp"]   # test-all's --changed narrows; a docs-only pick here is just mcp
if "--list" in args:
    print("test-all: --changed vs x: 1 path(s) changed")
    print("  x: a reason")
    for j in jobs + cfg.get("extra_list_jobs", []):
        print(j)
    sys.exit(0)
names = [a for i, a in enumerate(args) if not a.startswith("--") and not (i > 0 and args[i - 1] == "--changed")]
sel = [j for j in jobs if not names or any(n in j for n in names)]
full = not names
wt = Path.cwd()
if full and cfg.get("barrier"):
    mark = d / "barrier" / wt.parent.name
    if not mark.exists():
        mark.parent.mkdir(exist_ok=True)
        mark.write_text("")
        deadline = time.time() + 30
        while len(list(mark.parent.iterdir())) < cfg["barrier"] and time.time() < deadline:
            time.sleep(0.05)
if full and cfg.get("steal_lock"):
    lock = Path(cfg["steal_lock"])
    for e in lock.iterdir():
        e.unlink()
    (lock / f"{1:015d}-{cfg['thief_pid']}-thief0").write_text("")
if full and cfg.get("delete_land_id") and not (d / "deleted_land").exists():
    (d / "deleted_land").write_text("")
    subprocess.run(["git", "push", "-q", "origin", "--delete", f"refs/heads/land/{cfg['delete_land_id']}"],
                   cwd=d / "mover", check=True, capture_output=True)
if full and cfg.get("move_main", 0) > 0:
    n = int((d / "moves").read_text()) if (d / "moves").exists() else 0
    if n < cfg["move_main"]:
        (d / "moves").write_text(str(n + 1))
        m = d / "mover"
        run = lambda *a: subprocess.run(["git", *a], cwd=m, check=True, capture_output=True)
        run("fetch", "-q", "origin", "main")
        run("reset", "-q", "--hard", "origin/main")
        (m / f"moved-{n}.txt").write_text(str(n))
        run("add", "-A")
        run("commit", "-q", "-m", f"moved {n}")
        run("push", "-q", "origin", "HEAD:main")
if full and cfg.get("rm_path") and Path(cfg["rm_path"]).exists():
    import shutil as _sh
    _sh.rmtree(cfg["rm_path"])   # the checkout the lander was started from disappears mid-gate
if ((wt / "BUILDFLAKE").exists() or (wt / "docs" / "BUILDFLAKE").exists()) and not (d / "buildflaked").exists():
    (d / "buildflaked").write_text("")
    blog = d / "app-build.log"
    blog.write_text("tsc: a flaky build\n")
    print(f"app-build failed, see {blog}")
    sys.exit(1)
fail = set()
if (wt / "RED").exists():
    fail.add("mcp")
if (wt / "FLAKE").exists() and not (d / "flaked").exists():
    (d / "flaked").write_text("")
    fail.add("site")
closeflake = (wt / "CLOSEFLAKE").exists() and not (d / "closeflaked").exists()
if closeflake:
    (d / "closeflaked").write_text("")
    fail.add("site")
fail &= set(sel)
print()
print(f"{'job':<18}{'result':<8}secs")
for j in sel:
    print(f"{j:<18}{'FAIL' if j in fail else 'ok':<8}1")
for j in sorted(fail):
    log = d / f"{j}-{time.time_ns()}.log"
    # A browser gate crash (F429/F430): no "FAIL file::test" line, just the error Playwright prints.
    if closeflake and j == "site":
        log.write_text("Error: locator.click: Target page, context or browser has been closed\n")
    else:
        log.write_text(f"FAIL test_{j}::test_thing\n")
    print(f"\n---- {j} (exit 1), last 30 lines of {log}")
    print(log.read_text().strip())
print(f"\n{len(sel) - len(fail)}/{len(sel)} job(s) passed in 1s")
sys.exit(1 if fail else 0)
'''

# LAND_INSTALL_STUB: records where it ran, with which args, and whether node_modules was a symlink at the time.
INSTALL_STUB = r'''
import json, os, sys
from pathlib import Path
d = Path(os.environ["STUB_DIR"])
with open(d / "installs.jsonl", "a") as f:
    f.write(json.dumps({"cwd": os.getcwd(), "args": sys.argv[1:], "linked": os.path.islink("node_modules")}) + "\n")
Path("node_modules").mkdir(exist_ok=True)
(Path("node_modules") / "installed.txt").write_text("x")
'''


def _git(*args, cwd) -> str:
    return subprocess.run([GIT, *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


class Lane:
    """A bare remote plus clones, all inside one temp dir. `with Lane() as t:` removes it all afterwards."""

    def __init__(self):
        needs(NODE, "node")
        needs(GIT, "git")
        self.dir = Path(tempfile.mkdtemp(prefix="brx-land-test-"))
        self.remote = self.dir / "remote.git"
        _git("init", "-q", "--bare", "-b", "main", str(self.remote), cwd=self.dir)
        seed = self.clone("seed")
        (seed / "README").write_text("seed\n")
        _git("add", "README", cwd=seed)
        _git("commit", "-q", "-m", "seed", cwd=seed)
        _git("push", "-q", "origin", "HEAD:main", cwd=seed)
        (self.dir / "stub.py").write_text(STUB)
        (self.dir / "install_stub.py").write_text(INSTALL_STUB)
        self.dev = self.clone("dev")
        self.clone("mover")

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        shutil.rmtree(self.dir, ignore_errors=True)

    def clone(self, name: str) -> Path:
        path = self.dir / name
        _git("clone", "-q", str(self.remote), str(path), cwd=self.dir)
        _git("config", "user.email", "t@example.com", cwd=path)
        _git("config", "user.name", "T", cwd=path)
        _git("config", "commit.gpgsign", "false", cwd=path)
        return path

    def cfg(self, **kw):
        (self.dir / "cfg.json").write_text(json.dumps(kw))

    def env(self, machine="a", **extra):
        e = {**os.environ, "LAND_TEST": "1", "LAND_STATE_DIR": str(self.dir / f"state-{machine}"),
             "LAND_LOCK_DIR": str(self.dir / f"lock-{machine}"), "LAND_POLL_MS": "100",
             "LAND_GATE_STUB": json.dumps([sys.executable, str(self.dir / "stub.py")]), "STUB_DIR": str(self.dir),
             "LAND_INSTALL_STUB": json.dumps([sys.executable, str(self.dir / "install_stub.py")])}
        e.update(extra)
        return e

    def land(self, *args, cwd=None, machine="a", env=None, timeout=120):
        return subprocess.run([NODE, str(LAND), *args], cwd=cwd or self.dev, env=env or self.env(machine),
                              capture_output=True, text=True, timeout=timeout)

    def submit(self, name: str, files: dict, owner="tester", cwd=None) -> str:
        cwd = cwd or self.dev
        _git("fetch", "-q", "origin", cwd=cwd)
        _git("checkout", "-q", "-B", name, "origin/main", cwd=cwd)
        for f, text in files.items():
            (cwd / f).parent.mkdir(parents=True, exist_ok=True)
            (cwd / f).write_text(text)
        _git("add", "-A", cwd=cwd)
        _git("commit", "-q", "-m", name, cwd=cwd)
        r = self.land("submit", "--owner", owner, cwd=cwd)
        assert r.returncode == 0, r.stdout + r.stderr
        m = re.search(r"submitted (\S+) \(queue position \d+\)", r.stdout)
        assert m, r.stdout
        return m.group(1)

    def remote_refs(self) -> dict:
        out = _git("for-each-ref", "--format=%(refname) %(objectname)", cwd=self.remote)
        return dict(line.split(" ") for line in out.splitlines() if line)

    def on_main(self, commit_msg: str) -> int:
        """How many commits on the remote's main carry this exact subject."""
        return _git("log", "--format=%s", "main", cwd=self.remote).splitlines().count(commit_msg)

    def result(self, id_: str, machine="a") -> dict:
        return json.loads((self.dir / f"state-{machine}" / f"{id_}.json").read_text())

    def full_gates(self) -> int:
        calls = [json.loads(line) for line in (self.dir / "calls.jsonl").read_text().splitlines()]
        return sum(1 for c in calls if "--list" not in c and not [a for i, a in enumerate(c)
                                                                 if not a.startswith("--") and not (i > 0 and c[i - 1] == "--changed")])


def _assert_landed_in(t: Lane, id_: str, state: Path):
    assert f"refs/heads/land/{id_}" not in t.remote_refs()
    assert t.on_main(f"Land {id_}") == 1
    assert json.loads((state / f"{id_}.json").read_text())["status"] == "landed"


def _assert_landed(t: Lane, *ids):
    refs = t.remote_refs()
    for id_ in ids:
        assert f"refs/heads/land/{id_}" not in refs, f"{id_} still queued: {refs}"
        assert t.on_main(f"Land {id_}") == 1, f"{id_} is not on main exactly once"
        assert t.result(id_)["status"] == "landed"


def _branch_count(t: Lane, prefix: str) -> int:
    return sum(1 for r in t.remote_refs() if r.startswith(prefix))


# ---- the happy path, conflicts, red, flakes -----------------------------------------------------------------------

def test_a_clean_batch_of_three_lands_in_one_gate():
    with Lane() as t:
        ids = [t.submit(f"b{i}", {f"f{i}.txt": str(i)}) for i in range(3)]
        r = t.land("run")
        assert r.returncode == 0, r.stdout + r.stderr
        _assert_landed(t, *ids)
        assert t.full_gates() == 1
        assert _branch_count(t, "refs/heads/land") == 0



def _gate_calls(t: Lane) -> list:
    return [json.loads(line) for line in (t.dir / "calls.jsonl").read_text().splitlines()]


def test_a_docs_only_candidate_is_gated_with_changed_against_its_base():
    # E3 (2026-10-10): 21% of lands changed only docs and each paid for every job. A docs-only candidate runs
    # test-all's own --changed selection (the jobs that read docs) against the base it was merged onto.
    with Lane() as t:
        base = _git("rev-parse", "main", cwd=t.remote)
        id_ = t.submit("d", {"docs/page.md": "a page\n", "NOTES.md": "root markdown\n"})
        r = t.land("run")
        assert r.returncode == 0 and "docs-only candidate" in r.stdout, r.stdout + r.stderr
        _assert_landed(t, id_)
        gates = [c for c in _gate_calls(t)]
        assert gates and all(c[c.index("--changed") + 1] == base for c in gates), gates



def test_a_docs_only_build_flake_is_retried_with_the_same_narrow_selection():
    # Codex review (2026-10-10): the build retry ran the FULL suite and compared its row count with the docs-only
    # --list count, so a build that failed once and then passed could never count as green.
    with Lane() as t:
        id_ = t.submit("d", {"docs/page.md": "a page\n", "docs/BUILDFLAKE": "x"})
        r = t.land("run")
        assert r.returncode == 0, r.stdout + r.stderr
        _assert_landed(t, id_)
        assert (t.dir / "buildflaked").exists(), "the build never failed: the test proves nothing"
        assert all("--changed" in c for c in _gate_calls(t)), _gate_calls(t)

def test_a_candidate_with_any_code_keeps_the_full_gate():
    with Lane() as t:
        id_ = t.submit("c", {"docs/page.md": "a page\n", "tool.py": "x = 1\n"})
        r = t.land("run")
        assert r.returncode == 0 and "docs-only candidate" not in r.stdout, r.stdout + r.stderr
        _assert_landed(t, id_)
        assert all("--changed" not in c for c in _gate_calls(t)), _gate_calls(t)

def test_a_conflict_leaves_the_batch_and_the_others_land():
    with Lane() as t:
        a = t.submit("a", {"same.txt": "from a\n"})
        b = t.submit("b", {"same.txt": "from b\n"})
        c = t.submit("c", {"other.txt": "c\n"})
        r = t.land("run")
        assert r.returncode == 0, r.stdout + r.stderr
        _assert_landed(t, a, c)
        res = t.result(b)
        assert res["status"] == "conflict" and res["conflict_files"] == ["same.txt"], res
        assert res["conflicts_with"] == a, res
        refs = t.remote_refs()
        assert f"refs/heads/land-failed/{b}" in refs and f"refs/heads/land/{b}" not in refs
        assert t.on_main(f"Land {b}") == 0
        w = t.land("wait", b)
        assert w.returncode == 2, w.stdout + w.stderr
        assert "same.txt" in w.stdout and f"conflicts with {a}" in w.stdout


def test_a_red_branch_is_bisected_out_and_the_others_land():
    with Lane() as t:
        a = t.submit("a", {"a.txt": "a"})
        b = t.submit("b", {"RED": "breaks mcp"})
        c = t.submit("c", {"c.txt": "c"})
        r = t.land("run")
        assert r.returncode == 0, r.stdout + r.stderr
        _assert_landed(t, a, c)
        res = t.result(b)
        assert res["status"] == "red" and res["failed_jobs"] == ["mcp"], res
        assert f"refs/heads/land-failed/{b}" in t.remote_refs()
        assert "RED" not in _git("ls-tree", "--name-only", "main", cwd=t.remote).split()
        w = t.land("wait", b)
        assert w.returncode == 1 and "mcp" in w.stdout, w.stdout + w.stderr


def test_a_flake_is_rerun_recorded_and_lands():
    with Lane() as t:
        a = t.submit("a", {"FLAKE": "fails site once"})
        b = t.submit("b", {"b.txt": "b"})
        r = t.land("run")
        assert r.returncode == 0, r.stdout + r.stderr
        _assert_landed(t, a, b)
        flakes = [json.loads(line) for line in (t.dir / "state-a" / "flakes.jsonl").read_text().splitlines()]
        assert len(flakes) == 1 and flakes[0]["job"] == "site" and flakes[0]["branches"] == [a, b], flakes
        assert flakes[0]["step"] == "test_site::test_thing"
        assert "site x1" in r.stdout
        calls = [json.loads(line) for line in (t.dir / "calls.jsonl").read_text().splitlines()]
        gate_calls = [c for c in calls if "--list" not in c]
        assert "--cache" in gate_calls[0] and "--ui" in gate_calls[0]
        assert "--changed" not in gate_calls[0]
        assert "--no-cache" in gate_calls[1] and "--ui" in gate_calls[1]


def test_a_flake_with_no_parseable_step_records_the_error_line_not_null():
    # F429/F430 (2026-09-27): a browser-gate crash's log has no "FAIL file::test" line, only Playwright's own
    # error. stepOf's fallback must still record it, so flakes.jsonl never lands a bare `step: null`.
    with Lane() as t:
        a = t.submit("a", {"CLOSEFLAKE": "fails site once, browser-crash style"})
        b = t.submit("b", {"b.txt": "b"})
        r = t.land("run")
        assert r.returncode == 0, r.stdout + r.stderr
        _assert_landed(t, a, b)
        flakes = [json.loads(line) for line in (t.dir / "state-a" / "flakes.jsonl").read_text().splitlines()]
        assert len(flakes) == 1 and flakes[0]["job"] == "site" and flakes[0]["branches"] == [a, b], flakes
        assert flakes[0]["step"] is not None and "closed" in flakes[0]["step"], flakes


# ---- main moving, stale locks, racing landers ---------------------------------------------------------------------

def test_main_moving_mid_gate_is_retried_never_failed():
    with Lane() as t:
        ids = [t.submit(f"b{i}", {f"f{i}.txt": str(i)}) for i in range(2)]
        t.cfg(move_main=1)
        r = t.land("run")
        assert r.returncode == 0, r.stdout + r.stderr
        _assert_landed(t, *ids)
        assert t.on_main("moved 0") == 1, "the commit pushed during the gate must survive"
        assert _branch_count(t, "refs/heads/land-failed") == 0
        assert "main moved" in r.stdout


def test_main_that_keeps_moving_stops_the_lander_with_the_batch_queued():
    with Lane() as t:
        a = t.submit("a", {"a.txt": "a"})
        t.cfg(move_main=99)
        r = t.land("run")
        assert r.returncode == 5, r.stdout + r.stderr
        assert "main keeps moving" in r.stderr
        assert f"refs/heads/land/{a}" in t.remote_refs()
        assert _branch_count(t, "refs/heads/land-failed") == 0
        assert t.result(a)["status"] == "queued"


def test_a_stale_lock_is_taken_over_by_wait():
    with Lane() as t:
        a = t.submit("a", {"a.txt": "a"})
        # A crashed lander: an entry whose pid is gone, silent for an hour.
        p = subprocess.Popen([NODE, "-e", ""])
        p.wait(timeout=10)
        lock = t.dir / "lock-a"
        lock.mkdir()
        entry = lock / f"{int((time.time() - 3600) * 1000):015d}-{p.pid}-dead00"
        entry.write_text("")
        old = time.time() - 3600
        os.utime(entry, (old, old))
        w = t.land("wait", a, "--timeout-min", "1")
        assert w.returncode == 0, w.stdout + w.stderr
        assert "running the lander here" in w.stdout
        _assert_landed(t, a)
        assert not entry.exists()


def test_a_live_lock_holder_is_left_alone_by_run():
    with Lane() as t:
        a = t.submit("a", {"a.txt": "a"})
        lock = t.dir / "lock-a"
        lock.mkdir()
        (lock / f"{int(time.time() * 1000):015d}-{os.getpid()}-live00").write_text("")
        r = t.land("run")
        assert r.returncode == 0 and "a lander is running" in r.stdout, r.stdout + r.stderr
        assert f"refs/heads/land/{a}" in t.remote_refs()


def test_two_landers_on_two_machines_land_every_branch_exactly_once():
    with Lane() as t:
        ids = [t.submit(f"b{i}", {f"f{i}.txt": str(i)}) for i in range(4)]
        other = t.clone("other")
        # Another machine, another committer: otherwise both landers can build byte-identical merge commits in the
        # same second, and the second push is a no-op instead of a rejection.
        _git("config", "user.name", "Other machine", cwd=other)
        t.cfg(barrier=2)   # both landers reach their first gate before either pushes
        procs = [subprocess.Popen([NODE, str(LAND), "run"], cwd=cwd, env=t.env(m), stdout=subprocess.PIPE,
                                  stderr=subprocess.STDOUT, text=True)
                 for cwd, m in ((t.dev, "a"), (other, "b"))]
        try:
            outs = [p.communicate(timeout=120)[0] for p in procs]
        finally:
            for p in procs:
                if p.poll() is None:
                    p.kill()
        assert [p.returncode for p in procs] == [0, 0], outs
        for id_ in ids:
            assert t.on_main(f"Land {id_}") == 1, (id_, outs)
        assert _branch_count(t, "refs/heads/land") == 0, t.remote_refs()
        assert any("already on main" in o or "dropping it from the candidate" in o for o in outs), outs


def test_a_gate_that_ran_fewer_jobs_than_it_listed_is_an_error_not_a_pass():
    with Lane() as t:
        a = t.submit("a", {"a.txt": "a"})
        t.cfg(extra_list_jobs=["app-screens"])
        r = t.land("run")
        assert r.returncode == 5 and "--list named 3" in r.stderr, r.stdout + r.stderr
        assert f"refs/heads/land/{a}" in t.remote_refs()
        assert t.on_main(f"Land {a}") == 0


def test_a_red_main_is_not_blamed_on_the_branch():
    with Lane() as t:
        m = t.dir / "mover"
        (m / "RED").write_text("main is broken")
        _git("add", "RED", cwd=m)
        _git("commit", "-q", "-m", "break main", cwd=m)
        _git("push", "-q", "origin", "HEAD:main", cwd=m)
        a = t.submit("a", {"a.txt": "a"})
        r = t.land("run")
        assert r.returncode == 5 and "red on its own" in r.stderr, r.stdout + r.stderr
        assert f"refs/heads/land/{a}" in t.remote_refs()
        assert _branch_count(t, "refs/heads/land-failed") == 0
        calls = [json.loads(line) for line in (t.dir / "calls.jsonl").read_text().splitlines()]
        assert any("--no-cache" in c and "mcp" in c for c in calls)


def test_wait_after_a_lander_stopped_on_a_red_main_exits_5_without_a_second_gate():
    # 2026-09-27: `wait` polled while `run` stopped on "main is red on its own", then started a second full gate on the
    # same red main (about 25 minutes) instead of reporting the stop.
    with Lane() as t:
        m = t.dir / "mover"
        (m / "RED").write_text("main is broken")
        _git("add", "RED", cwd=m)
        _git("commit", "-q", "-m", "break main", cwd=m)
        _git("push", "-q", "origin", "HEAD:main", cwd=m)
        a = t.submit("a", {"a.txt": "a"})
        assert t.land("run").returncode == 5
        gates = t.full_gates()
        w = t.land("wait", a, "--timeout-min", "0.2")
        assert w.returncode == 5 and "red on its own" in w.stderr and a in w.stderr, w.stdout + w.stderr
        assert "running the lander here" not in w.stdout, w.stdout
        assert t.full_gates() == gates, "wait gated the same red main again"
        assert f"refs/heads/land/{a}" in t.remote_refs()
        # The fix moves main: the stop no longer applies, and wait drives the queue again.
        _git("rm", "-q", "RED", cwd=m)
        _git("commit", "-q", "-m", "fix main", cwd=m)
        _git("push", "-q", "origin", "HEAD:main", cwd=m)
        w = t.land("wait", a, "--timeout-min", "0.5")
        assert w.returncode == 0 and "running the lander here" in w.stdout, w.stdout + w.stderr
        _assert_landed(t, a)


# ---- dry run, the guard, submit ---------------------------------------------------------------------------------

def test_dry_run_changes_nothing():
    with Lane() as t:
        t.submit("a", {"same.txt": "a"})
        t.submit("b", {"same.txt": "b"})
        before = t.remote_refs()
        r = t.land("run", "--dry-run")
        assert r.returncode == 0, r.stdout + r.stderr
        assert t.remote_refs() == before
        assert "conflict (same.txt)" in r.stdout and "merges cleanly" in r.stdout
        assert "mcp" in r.stdout and "no push" in r.stdout
        assert t.full_gates() == 0


def test_land_test_refuses_a_non_local_remote():
    with Lane() as t:
        far = t.clone("far")
        # An unreachable loopback URL: even if the guard were broken, nothing leaves the machine.
        _git("remote", "set-url", "origin", "ssh://git@127.0.0.1:1/nowhere.git", cwd=far)
        for args in (["run"], ["wait", "x"], ["status"], ["submit", "--owner", "t"]):
            r = t.land(*args, cwd=far)
            assert r.returncode == 4 and "refuses the non-local remote" in r.stderr, (args, r.stdout, r.stderr)


def test_the_gate_stub_is_refused_without_land_test():
    with Lane() as t:
        env = t.env()
        del env["LAND_TEST"]
        r = t.land("run", env=env)
        assert r.returncode == 4 and "test-only" in r.stderr, r.stdout + r.stderr
        del env["LAND_GATE_STUB"]
        r = t.land("run", env=env)
        assert r.returncode == 4 and "LAND_INSTALL_STUB is test-only" in r.stderr, r.stdout + r.stderr


def test_submit_refuses_a_dirty_tree_and_an_empty_branch():
    with Lane() as t:
        (t.dev / "README").write_text("dirty\n")
        r = t.land("submit", "--owner", "t")
        assert r.returncode == 4 and "uncommitted" in r.stderr, r.stdout + r.stderr
        _git("checkout", "-q", "README", cwd=t.dev)
        r = t.land("submit", "--owner", "t")
        assert r.returncode == 4 and "nothing to land" in r.stderr, r.stdout + r.stderr
        assert _branch_count(t, "refs/heads/land") == 0


def test_submit_names_the_branch_and_never_touches_main():
    with Lane() as t:
        main = t.remote_refs()["refs/heads/main"]
        id_ = t.submit("feature/Some_Thing", {"x.txt": "x"}, owner="f411-play")
        assert re.fullmatch(r"\d{14}-f411_play-feature-some-thing", id_), id_
        assert t.remote_refs()["refs/heads/main"] == main
        s = t.land("status", "--no-drive")
        assert s.returncode == 0 and f"1. {id_}" in s.stdout, s.stdout + s.stderr


def test_withdraw_removes_a_queued_entry_and_wait_reports_withdrawn():
    with Lane() as t:
        id_ = t.submit("a", {"a.txt": "a"}, owner="alice")
        r = t.land("withdraw", id_, "--owner", "alice")
        assert r.returncode == 0 and "withdrawn" in r.stdout, r.stdout + r.stderr
        assert f"refs/heads/land/{id_}" not in t.remote_refs()
        assert t.result(id_)["status"] == "withdrawn"
        w = t.land("wait", id_, "--timeout-min", "0.1")
        assert w.returncode == 6 and "withdrawn" in w.stdout, w.stdout + w.stderr
        s = t.land("status", "--no-drive")
        assert "withdrawn" in s.stdout and id_ in s.stdout, s.stdout + s.stderr



def test_status_lists_results_while_an_active_batch_file_is_in_the_state_dir():
    # 2026-10-05: `status` read active-batch.json as a result and crashed on its missing `status`
    # ("Cannot read properties of undefined (reading 'padEnd')") whenever a batch was running.
    with Lane() as t:
        id_ = t.submit("a", {"a.txt": "a"}, owner="alice")
        assert t.land("withdraw", id_, "--owner", "alice").returncode == 0
        (t.dir / "state-a" / "active-batch.json").write_text(json.dumps({"ids": ["x"], "holder": "h"}))
        s = t.land("status", "--no-drive")
        assert s.returncode == 0 and "unexpected error" not in s.stdout + s.stderr, s.stdout + s.stderr
        assert "recent results" in s.stdout and id_ in s.stdout, s.stdout


def _hung_git_times_out(detach: bool):
    # OP7 (2026-10-10 review): a stalled fetch held the lander lock for ever. A fake git on PATH hangs on fetch AND
    # leaves a child holding the output pipe (an ssh or a credential helper does that), so killing git alone would not
    # end the call. With a 1 s ceiling, `run` (which takes the lander lock) must stop fast, name the timeout, and leave
    # no lock entry behind.
    with Lane() as t:
        t.submit("a", {"a.txt": "a"})
        fake = t.dir / "fakebin"
        fake.mkdir()
        real = shutil.which("git")
        (fake / "git").write_text("#!/bin/sh\n"
                                  "for a in \"$@\"; do [ \"$a\" = fetch ] && { sleep 40 & exec sleep 40; }; done\n"
                                  f"exec {real} \"$@\"\n")
        (fake / "git").chmod(0o755)
        env = t.env(LAND_GIT_TIMEOUT_MS="1000", LAND_GIT_DETACH="1" if detach else "0", PATH=f"{fake}{os.pathsep}{os.environ['PATH']}")
        start = time.monotonic()
        r = t.land("run", env=env, timeout=90)
        assert time.monotonic() - start < 25, "the fetch (or its child) was not cut off"
        assert r.returncode != 0 and "timed out after 1s" in r.stdout + r.stderr, r.stdout + r.stderr
        lock = t.dir / "lock-a"
        assert not lock.exists() or not any(lock.iterdir()), list(lock.iterdir())



def test_a_hung_git_times_out_instead_of_holding_the_lander():
    _hung_git_times_out(detach=True)


def test_a_hung_git_times_out_on_the_terminal_path_too():
    # Codex round 3: without a process group, killing git leaves its child holding the pipe; the lander must still
    # return (it stops waiting for the pipes and settles on the exit).
    _hung_git_times_out(detach=False)

def _hanging_git(t: Lane, body: str) -> dict:
    """A fake git on PATH whose `fetch` runs `body` (bash); every other command is the real git. Returns the env."""
    fake = t.dir / "fakebin"
    fake.mkdir(exist_ok=True)
    real = shutil.which("git")
    (fake / "git").write_text("#!/bin/bash\n"
                              f"for a in \"$@\"; do [ \"$a\" = fetch ] && {{ {body} }}; done\n"
                              f"exec {real} \"$@\"\n")
    (fake / "git").chmod(0o755)
    return {"PATH": f"{fake}{os.pathsep}{os.environ['PATH']}"}


def _alive_with(token: str) -> list:
    out = subprocess.run(["pgrep", "-f", token], capture_output=True, text=True).stdout.split()
    return [p for p in out if p != str(os.getpid())]


def test_a_detached_fetch_dies_with_the_lander():
    # Opus review (2026-10-10): network git runs in its own process group, out of reach of the signal that stops the
    # lander, so a fetch (or a push to main) could outlive it. The lander kills its live network git on the way out.
    if not shutil.which("pgrep"):
        return
    with Lane() as t:
        t.submit("a", {"a.txt": "a"})
        token = f"brxfakefetch{os.getpid()}{int(time.time() * 1000)}"
        started = t.dir / "fetch-started"
        env = t.env(**_hanging_git(t, f'touch "{started}"; (exec -a {token} sleep 60) & exec -a {token} sleep 60;'),
                    LAND_GIT_TIMEOUT_MS="120000")
        p = subprocess.Popen([NODE, str(LAND), "run"], cwd=t.dev, env=env, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True)
        try:
            deadline = time.monotonic() + 30
            while not started.exists() and time.monotonic() < deadline:
                time.sleep(0.1)
            assert started.exists(), "the fake fetch never started"
            assert _alive_with(token), "the fake fetch is not running"
            p.send_signal(15)
            p.wait(timeout=30)
            deadline = time.monotonic() + 10
            while _alive_with(token) and time.monotonic() < deadline:
                time.sleep(0.2)
            assert not _alive_with(token), "a fetch outlived the lander"
        finally:
            if p.poll() is None:
                p.kill()
            for pid in _alive_with(token):
                os.kill(int(pid), 9)


def test_a_timed_out_fetch_gets_sigterm_first_so_git_can_drop_its_lock_files():
    # Opus review: SIGKILL in the middle of a ref update leaves packed-refs.lock, and every later fetch then fails.
    with Lane() as t:
        t.submit("a", {"a.txt": "a"})
        termed = t.dir / "fetch-termed"
        env = t.env(**_hanging_git(t, f'trap \'touch "{termed}"; exit 1\' TERM; sleep 60 & wait;'),
                    LAND_GIT_TIMEOUT_MS="1000")
        r = t.land("run", env=env, timeout=90)
        assert r.returncode != 0 and "timed out after 1s" in r.stdout + r.stderr, r.stdout + r.stderr
        assert termed.exists(), "the timeout went straight to SIGKILL"


def test_a_lander_survives_the_removal_of_the_checkout_it_was_started_from():
    # 2026-10-10: a lander started from a worktree that was then removed lost a whole green batch, because its next
    # git call had no directory to run in. Repository-level git now runs from the shared git dir.
    with Lane() as t:
        id_ = t.submit("a", {"a.txt": "a"})
        side = t.dir / "side"
        _git("worktree", "add", "-q", "--detach", str(side), "origin/main", cwd=t.dev)
        t.cfg(rm_path=str(side))
        r = t.land("run", cwd=side)
        assert r.returncode == 0, r.stdout + r.stderr
        assert not side.exists()
        _assert_landed(t, id_)


def _main_lander(t: Lane, tail: str) -> None:
    """Put a copy of this repo's scripts/ on the test repo's main, with `tail` appended to its land.mjs."""
    seed = t.clone("seeder")
    shutil.copytree(REPO / "scripts", seed / "scripts", ignore=shutil.ignore_patterns("node_modules", "test"))
    with open(seed / "scripts" / "land.mjs", "a") as f:
        f.write("\n" + tail + "\n")
    _git("add", "-A", cwd=seed)
    _git("commit", "-q", "-m", "a lander on main", cwd=seed)
    _git("push", "-q", "origin", "HEAD:main", cwd=seed)


def test_wait_starts_a_lander_from_origin_main_when_its_own_lander_code_differs():
    # 2026-10-10: `wait` from a branch started a lander running that branch's land.mjs. When this lander's code is
    # not byte-identical to origin/main's, wait starts the lander from a worktree at origin/main instead. Relative
    # state and lock dirs must reach that child as the same absolute places (Opus review).
    with Lane() as t:
        _main_lander(t, "console.log('land: MAIN-LANDER-MARKER');")
        id_ = t.submit("a", {"a.txt": "a"})
        env = t.env(LAND_STATE_DIR="rel-state", LAND_LOCK_DIR="rel-lock")
        w = t.land("wait", id_, "--timeout-min", "1", env=env, timeout=120)
        assert "started a lander from origin/main" in w.stdout, w.stdout + w.stderr
        assert w.returncode == 0, w.stdout + w.stderr
        _assert_landed_in(t, id_, t.dev / "rel-state")
        logs = list((t.dev / "rel-state" / "logs").glob("lander-main-*.log"))
        assert logs and any("MAIN-LANDER-MARKER" in p.read_text() for p in logs), "the child did not run main's land.mjs"


def test_a_main_lander_that_dies_at_once_ends_wait_with_its_reason_not_a_respawn_loop():
    # Opus review: a spawned lander that failed was invisible, and wait respawned it every poll.
    with Lane() as t:
        _main_lander(t, "")
        seed = t.dir / "seeder"
        (seed / "scripts" / "land.mjs").write_text("console.log('boom from the main lander'); process.exit(7);\n")
        _git("commit", "-qam", "a broken lander", cwd=seed)
        _git("push", "-q", "origin", "HEAD:main", cwd=seed)
        id_ = t.submit("a", {"a.txt": "a"})
        w = t.land("wait", id_, "--timeout-min", "1", timeout=120)
        assert w.returncode == 5 and "boom from the main lander" in w.stderr, (w.returncode, w.stdout[-400:], w.stderr[-400:])
        assert len(list((t.dir / "state-a" / "logs").glob("lander-main-*.log"))) == 1, "it started more than one"

def test_a_relative_remote_path_is_refused_with_the_fix():
    # Codex review: the lander runs git from the shared git dir, where a relative remote path resolves differently.
    with Lane() as t:
        _git("remote", "set-url", "origin", "../remote.git", cwd=t.dev)
        r = t.land("status", "--no-drive")
        assert r.returncode == 4 and "relative path" in r.stderr and "absolute path" in r.stderr, r.stdout + r.stderr


def test_relative_state_and_lock_dirs_are_made_absolute():
    # Codex review: a relative LAND_STATE_DIR / LAND_LOCK_DIR resolved against different directories for git, the
    # lander and a spawned lander. Run with relative ones from the checkout: the lander lands and uses one place.
    with Lane() as t:
        id_ = t.submit("a", {"a.txt": "a"})
        env = t.env(LAND_STATE_DIR="rel-state", LAND_LOCK_DIR="rel-lock")
        r = t.land("run", env=env)
        assert r.returncode == 0, r.stdout + r.stderr
        assert (t.dev / "rel-state" / f"{id_}.json").exists()

def test_withdraw_refuses_another_owner():
    with Lane() as t:
        id_ = t.submit("a", {"a.txt": "a"}, owner="alice")
        r = t.land("withdraw", id_, "--owner", "bob")
        assert r.returncode == 4 and "owned by alice" in r.stderr, r.stdout + r.stderr
        assert f"refs/heads/land/{id_}" in t.remote_refs()


def test_withdraw_refuses_an_id_in_the_active_lander_batch():
    with Lane() as t:
        id_ = t.submit("a", {"a.txt": "a"}, owner="alice")
        state = t.dir / "state-a"
        state.mkdir()
        lock = t.dir / "lock-a"
        lock.mkdir()
        holder = f"{int(time.time() * 1000):015d}-{os.getpid()}-live00"
        (lock / holder).write_text("")
        (state / "active-batch.json").write_text(json.dumps({"ids": [id_], "holder": holder}))
        r = t.land("withdraw", id_, "--owner", "alice")
        assert r.returncode == 4 and "active lander batch" in r.stderr, r.stdout + r.stderr
        assert f"refs/heads/land/{id_}" in t.remote_refs()


def test_withdraw_works_while_a_lander_holds_the_lock_and_leaves_a_marker():
    with Lane() as t:
        id_ = t.submit("a", {"a.txt": "a"}, owner="alice")
        lock = t.dir / "lock-a"
        lock.mkdir()
        (lock / f"{int(time.time() * 1000):015d}-{os.getpid()}-live00").write_text("")
        r = t.land("withdraw", id_, "--owner", "alice")
        assert r.returncode == 0 and "withdrawn" in r.stdout and "it will skip it" in r.stdout, r.stdout + r.stderr
        assert f"refs/heads/land/{id_}" not in t.remote_refs()
        assert t.result(id_)["status"] == "withdrawn"
        assert (t.dir / "state-a" / "withdrawn" / id_).exists()


def test_a_lander_skips_an_id_withdrawn_after_its_fetch():
    # The race: the lander fetched the queue, then a withdraw marked the id. The ref is still on the remote here (the
    # worst case), and the lander must still leave the id out of the batch, gate nothing for it and keep it off main.
    with Lane() as t:
        id_ = t.submit("a", {"a.txt": "a"}, owner="alice")
        other = t.submit("b", {"b.txt": "b"})
        marks = t.dir / "state-a" / "withdrawn"
        marks.mkdir(parents=True)
        (marks / id_).write_text("{}")
        r = t.land("run")
        assert r.returncode == 0 and f"{id_} was withdrawn; leaving it out" in r.stdout, r.stdout + r.stderr
        assert t.on_main("a") == 0 and t.on_main(f"Land {id_}") == 0, r.stdout + r.stderr
        _assert_landed(t, other)


def test_withdraw_refused_by_a_live_batch_removes_its_marker():
    with Lane() as t:
        id_ = t.submit("a", {"a.txt": "a"}, owner="alice")
        state = t.dir / "state-a"
        state.mkdir()
        lock = t.dir / "lock-a"
        lock.mkdir()
        holder = f"{int(time.time() * 1000):015d}-{os.getpid()}-live00"
        (lock / holder).write_text("")
        (state / "active-batch.json").write_text(json.dumps({"ids": [id_], "holder": holder}))
        r = t.land("withdraw", id_, "--owner", "alice")
        assert r.returncode == 4 and "active lander batch" in r.stderr, r.stdout + r.stderr
        assert f"refs/heads/land/{id_}" in t.remote_refs()
        assert not (state / "withdrawn" / id_).exists()


def test_withdraw_of_an_unknown_id_while_a_lander_runs_leaves_no_marker():
    with Lane() as t:
        lock = t.dir / "lock-a"
        lock.mkdir()
        (lock / f"{int(time.time() * 1000):015d}-{os.getpid()}-live00").write_text("")
        id_ = "20260101000000-alice-missing"
        r = t.land("withdraw", id_, "--owner", "alice")
        assert r.returncode == 4 and "unknown id" in r.stderr, r.stdout + r.stderr
        assert not (t.dir / "state-a" / "withdrawn" / id_).exists()


def test_withdraw_ignores_a_stale_active_batch():
    with Lane() as t:
        id_ = t.submit("a", {"a.txt": "a"}, owner="alice")
        state = t.dir / "state-a"
        state.mkdir()
        (state / "active-batch.json").write_text(json.dumps({"ids": [id_], "holder": "dead-holder"}))
        r = t.land("withdraw", id_, "--owner", "alice")
        assert r.returncode == 0 and "withdrawn" in r.stdout, r.stdout + r.stderr
        assert t.result(id_)["status"] == "withdrawn"


def test_withdraw_preserves_a_landed_result():
    with Lane() as t:
        id_ = t.submit("a", {"a.txt": "a"}, owner="alice")
        run = t.land("run")
        assert run.returncode == 0, run.stdout + run.stderr
        r = t.land("withdraw", id_, "--owner", "alice")
        assert r.returncode == 4 and "already landed" in r.stderr, r.stdout + r.stderr
        assert t.result(id_)["status"] == "landed"


def test_withdraw_reports_a_branch_that_lands_during_ref_deletion():
    with Lane() as t:
        id_ = t.submit("a", {"a.txt": "a"}, owner="alice")
        hook = t.remote / "hooks" / "post-receive"
        hook.write_text("#!/bin/sh\nwhile read old new ref; do\n"
                        f"  if [ \"$ref\" = \"refs/heads/land/{id_}\" ]; then\n"
                        "    git update-ref refs/heads/main \"$old\"\n"
                        "  fi\ndone\n")
        hook.chmod(0o755)
        r = t.land("withdraw", id_, "--owner", "alice")
        assert r.returncode == 0 and "landed" in r.stdout, r.stdout + r.stderr
        assert t.result(id_)["status"] == "landed"
        assert t.on_main("a") == 1


def test_withdraw_preserves_a_red_result():
    with Lane() as t:
        id_ = t.submit("a", {"RED": "fails mcp"}, owner="alice")
        run = t.land("run")
        assert run.returncode == 0, run.stdout + run.stderr
        assert t.result(id_)["status"] == "red"
        r = t.land("withdraw", id_, "--owner", "alice")
        assert r.returncode == 4 and "already red" in r.stderr, r.stdout + r.stderr
        assert t.result(id_)["status"] == "red"


def test_withdraw_refuses_an_unknown_id():
    with Lane() as t:
        r = t.land("withdraw", "20260101000000-alice-missing", "--owner", "alice")
        assert r.returncode == 4 and "unknown id" in r.stderr, r.stdout + r.stderr


def test_a_branch_deleted_during_the_gate_is_not_pushed_to_main():
    with Lane() as t:
        id_ = t.submit("a", {"a.txt": "a"}, owner="alice")
        t.cfg(delete_land_id=id_)
        r = t.land("run")
        assert r.returncode == 0, r.stdout + r.stderr
        assert f"refs/heads/land/{id_}" not in t.remote_refs()
        assert t.on_main(f"Land {id_}") == 0, r.stdout + r.stderr
        assert t.on_main("a") == 0, r.stdout + r.stderr


def test_the_lander_loops_batch_by_batch_until_the_queue_is_empty():
    with Lane() as t:
        ids = [t.submit(f"b{i}", {f"f{i}.txt": str(i)}) for i in range(3)]
        r = t.land("run", "--batch", "2")
        assert r.returncode == 0, r.stdout + r.stderr
        _assert_landed(t, *ids)
        assert t.full_gates() == 2


def test_wait_on_another_machine_reads_the_result_from_the_refs():
    with Lane() as t:
        a = t.submit("a", {"a.txt": "a"})
        b = t.submit("b", {"RED": "breaks mcp"})
        assert t.land("run").returncode == 0
        other = t.clone("other")   # machine b: no result files, only the refs
        w = t.land("wait", a, "--timeout-min", "0.1", cwd=other, machine="b")
        assert w.returncode == 0 and "landed" in w.stdout, w.stdout + w.stderr
        w = t.land("wait", b, "--timeout-min", "0.1", cwd=other, machine="b")
        assert w.returncode == 1 and f"land-failed/{b}" in w.stdout, w.stdout + w.stderr


# ---- review 2026-09-27 (brx1): H1, H2, M(a)-(e) ------------------------------------------------------------------

def test_h1_a_branch_already_on_main_is_marked_landed_and_leaves_the_queue():
    """An emergency direct push (or a crash between the main push and the ref cleanup) puts a queued branch on main.
    It used to be skipped forever: the ref stayed, no result was written, and the queue never emptied."""
    with Lane() as t:
        a = t.submit("a", {"a.txt": "a"})
        _git("push", "-q", "origin", "HEAD:main", cwd=t.dev)   # the emergency path
        r = t.land("run")
        assert r.returncode == 0, r.stdout + r.stderr
        assert f"refs/heads/land/{a}" not in t.remote_refs()
        assert t.result(a)["status"] == "landed"
        w = t.land("wait", a, "--timeout-min", "0.1", timeout=60)
        assert w.returncode == 0, w.stdout + w.stderr


def _stuck_branch(t: Lane) -> str:
    """A queued red branch whose land-failed/<id> already exists at an unrelated commit: the lander can never move it,
    so every lander run finds the queue non-empty."""
    id_ = "20260101000000-stuck-x"
    _git("checkout", "-q", "-B", "stuck", "origin/main", cwd=t.dev)
    (t.dev / "RED").write_text("red")
    _git("add", "RED", cwd=t.dev)
    _git("commit", "-q", "-m", "stuck", cwd=t.dev)
    _git("push", "-q", "origin", f"HEAD:refs/heads/land/{id_}", cwd=t.dev)
    _git("checkout", "-q", "--orphan", "unrelated", cwd=t.dev)
    _git("commit", "-q", "--allow-empty", "-m", "unrelated", cwd=t.dev)
    _git("push", "-q", "origin", f"HEAD:refs/heads/land-failed/{id_}", cwd=t.dev)
    _git("checkout", "-q", "-f", "stuck", cwd=t.dev)
    return id_


def test_h2_wait_times_out_even_while_it_keeps_driving_the_lander():
    with Lane() as t:
        stuck = _stuck_branch(t)
        start = time.time()
        w = t.land("wait", "20260101000000-nobody-x", "--timeout-min", "0.03", timeout=60)
        assert w.returncode == 3, w.stdout + w.stderr
        assert time.time() - start < 30
        assert f"refs/heads/land/{stuck}" in t.remote_refs()   # never deleted: it did not land and was not copied


def test_ma_an_unexpected_error_exits_5_not_1_which_means_red():
    with Lane() as t:
        _git("remote", "set-url", "origin", str(t.dir / "missing.git"), cwd=t.dev)
        r = t.land("run")
        assert r.returncode == 5, (r.returncode, r.stdout, r.stderr)
        r = t.land("wait", "x", "--timeout-min", "0.01")
        assert r.returncode == 5, (r.returncode, r.stdout, r.stderr)


def test_mb_a_malformed_land_ref_is_reported_and_never_landed():
    with Lane() as t:
        _git("checkout", "-q", "-B", "hand", "origin/main", cwd=t.dev)
        (t.dev / "hand.txt").write_text("pushed by hand")
        _git("add", "hand.txt", cwd=t.dev)
        _git("commit", "-q", "-m", "by hand", cwd=t.dev)
        _git("push", "-q", "origin", "HEAD:refs/heads/land/0-Tony-x", cwd=t.dev)
        b = t.submit("b", {"b.txt": "b"})
        r = t.land("run")
        assert r.returncode == 0, r.stdout + r.stderr
        _assert_landed(t, b)
        assert "refs/heads/land/0-Tony-x" in t.remote_refs()
        assert "hand.txt" not in _git("ls-tree", "--name-only", "main", cwd=t.remote).split()
        assert "land/0-Tony-x" in r.stdout


def test_mc_a_branch_that_conflicted_only_with_a_red_member_is_retried_and_lands():
    with Lane() as t:
        a = t.submit("a", {"same.txt": "a", "RED": "breaks mcp"})
        b = t.submit("b", {"same.txt": "b"})
        r = t.land("run")
        assert r.returncode == 0, r.stdout + r.stderr
        assert t.result(a)["status"] == "red"
        _assert_landed(t, b)


def test_mc_a_conflict_with_main_says_main():
    with Lane() as t:
        clean = t.submit("clean", {"clean.txt": "c"})   # lands, so "main" cannot be the empty-batch fallback
        a = t.submit("a", {"same.txt": "a"})
        m = t.dir / "mover"
        _git("pull", "-q", "origin", "main", cwd=m)
        (m / "same.txt").write_text("main's own")
        _git("add", "same.txt", cwd=m)
        _git("commit", "-q", "-m", "main edits same.txt", cwd=m)
        _git("push", "-q", "origin", "HEAD:main", cwd=m)
        assert t.land("run").returncode == 0
        _assert_landed(t, clean)
        res = t.result(a)
        assert res["status"] == "conflict" and res["conflicts_with"] == "main", res


def test_md_a_lander_that_lost_its_lock_during_the_gate_does_not_push():
    with Lane() as t:
        a = t.submit("a", {"a.txt": "a"})
        main = t.remote_refs()["refs/heads/main"]
        t.cfg(steal_lock=str(t.dir / "lock-a"), thief_pid=os.getpid())
        r = t.land("run")
        assert r.returncode == 5 and "lost the lander lock" in r.stderr, r.stdout + r.stderr
        assert t.remote_refs()["refs/heads/main"] == main
        assert f"refs/heads/land/{a}" in t.remote_refs()


def test_md_each_lock_entry_gets_its_own_worktree_and_leaves_none_behind():
    with Lane() as t:
        state = t.dir / "state-a"
        stale = state / "wt-000000000000001-1-dead00"   # a crashed lander's worktree
        stale.mkdir(parents=True)
        a = t.submit("a", {"a.txt": "a"})
        r = t.land("run")
        assert r.returncode == 0, r.stdout + r.stderr
        _assert_landed(t, a)
        assert [p.name for p in state.iterdir() if p.name.startswith("wt")] == []


def test_me_a_changed_package_lock_is_installed_in_the_scratch_tree_not_linked():
    with Lane() as t:
        seed = t.dir / "seed"
        (seed / "app").mkdir()
        (seed / "app" / "package.json").write_text("{}")
        (seed / "app" / "package-lock.json").write_text("{}")
        (seed / ".gitignore").write_text("node_modules\n")
        _git("add", "-A", cwd=seed)
        _git("commit", "-q", "-m", "app", cwd=seed)
        _git("push", "-q", "origin", "HEAD:main", cwd=seed)
        _git("pull", "-q", "origin", "main", cwd=t.dev)
        sentinel = t.dev / "app" / "node_modules" / "main-deps.txt"   # the main checkout's installed deps
        sentinel.parent.mkdir()
        sentinel.write_text("main")
        sub = t.clone("sub")   # submit from elsewhere: the main checkout (dev) stays on main, as it would for real
        a = t.submit("a", {"a.txt": "a"}, cwd=sub)                                    # same lock: linked
        b = t.submit("b", {"app/package-lock.json": '{"new": 1}'}, cwd=sub)          # new lock: npm ci in the scratch tree
        r = t.land("run")
        assert r.returncode == 0, r.stdout + r.stderr
        _assert_landed(t, a, b)
        installs = [json.loads(x) for x in (t.dir / "installs.jsonl").read_text().splitlines()]
        assert len(installs) == 1, installs
        assert installs[0]["args"] == ["npm", "ci", "--no-audit", "--no-fund"] and installs[0]["linked"] is False, installs
        assert installs[0]["cwd"].endswith("/app") and str(t.dev) not in installs[0]["cwd"], installs
        assert sentinel.read_text() == "main" and sorted(p.name for p in sentinel.parent.iterdir()) == ["main-deps.txt"]
        # A candidate that matches main's lock links main's node_modules; removing the worktree must not follow the link.
        _git("pull", "-q", "origin", "main", cwd=t.dev)   # dev's lock now matches main's again
        c = t.submit("c", {"c.txt": "c"}, cwd=sub)
        assert t.land("run").returncode == 0
        _assert_landed(t, c)
        assert len((t.dir / "installs.jsonl").read_text().splitlines()) == 1
        assert sentinel.read_text() == "main"


def test_an_old_git_is_refused_with_the_fix():
    """brx1's check of 702fb334: `git merge-tree --write-tree` needs git 2.38+, and Apple's git can be older."""
    with Lane() as t:
        for old in ("git version 2.37.1 (Apple Git-137.1)", "git version 1.9.0"):
            r = t.land("status", env=t.env(LAND_FAKE_GIT_VERSION=old))
            assert r.returncode == 4 and "2.38 or later" in r.stderr and "brew install git" in r.stderr, r.stderr
        r = t.land("status", env=t.env(LAND_FAKE_GIT_VERSION="git version 2.38.0"))
        assert "2.38 or later" not in r.stderr, r.stderr
        env = t.env(LAND_FAKE_GIT_VERSION="git version 2.99.0")
        del env["LAND_TEST"]
        r = t.land("status", env=env)
        assert r.returncode == 4 and "LAND_FAKE_GIT_VERSION is test-only" in r.stderr, r.stderr
