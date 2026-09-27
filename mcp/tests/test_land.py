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
fail = set()
if (wt / "RED").exists():
    fail.add("mcp")
if (wt / "FLAKE").exists() and not (d / "flaked").exists():
    (d / "flaked").write_text("")
    fail.add("site")
fail &= set(sel)
print()
print(f"{'job':<18}{'result':<8}secs")
for j in sel:
    print(f"{j:<18}{'FAIL' if j in fail else 'ok':<8}1")
for j in sorted(fail):
    log = d / f"{j}-{time.time_ns()}.log"
    log.write_text(f"FAIL test_{j}::test_thing\n")
    print(f"\n---- {j} (exit 1), last 30 lines of {log}")
    print(f"FAIL test_{j}::test_thing")
print(f"\n{len(sel) - len(fail)}/{len(sel)} job(s) passed in 1s")
sys.exit(1 if fail else 0)
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
             "LAND_GATE_STUB": json.dumps([sys.executable, str(self.dir / "stub.py")]), "STUB_DIR": str(self.dir)}
        e.update(extra)
        return e

    def land(self, *args, cwd=None, machine="a", env=None):
        return subprocess.run([NODE, str(LAND), *args], cwd=cwd or self.dev, env=env or self.env(machine),
                              capture_output=True, text=True, timeout=120)

    def submit(self, name: str, files: dict, owner="tester", cwd=None) -> str:
        cwd = cwd or self.dev
        _git("fetch", "-q", "origin", cwd=cwd)
        _git("checkout", "-q", "-B", name, "origin/main", cwd=cwd)
        for f, text in files.items():
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
        refs = t.remote_refs()
        assert f"refs/heads/land-failed/{b}" in refs and f"refs/heads/land/{b}" not in refs
        assert t.on_main(f"Land {b}") == 0
        w = t.land("wait", b)
        assert w.returncode == 2, w.stdout + w.stderr
        assert "same.txt" in w.stdout


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
        assert any("already on main" in o for o in outs), outs   # the race really happened: one lander lost the push


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
