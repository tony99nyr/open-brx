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
import hashlib
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
with open(d / "priority.txt", "a") as f:
    f.write(os.environ.get("BRX_LAND_PRIORITY", "") + "\n")
with open(d / "index_fresh.txt", "a") as f:
    f.write(os.environ.get("BRX_FOLLOWUPS_INDEX_FRESH", "") + "\n")
cfg = json.loads((d / "cfg.json").read_text()) if (d / "cfg.json").exists() else {}
jobs = ["mcp", "site"]
if "--changed" in args:
    jobs = ["mcp"]   # test-all's --changed narrows; a docs-only pick here is just mcp
if "--list" in args:
    print("test-all: --changed vs x: 1 path(s) changed")
    print("  x: a reason")
    for j in jobs + cfg.get("extra_list_jobs", []):
        print(j)
    if cfg.get("write_list_results_json") and os.environ.get("BRX_RESULTS_JSON"):
        Path(os.environ["BRX_RESULTS_JSON"]).write_text(json.dumps({"version": 1, "complete": False,
            "selected": jobs, "jobs": [], "build": None, "startedAt": "a", "finishedAt": "b"}))
    sys.exit(0)
names = [a for i, a in enumerate(args) if not a.startswith("--") and not (i > 0 and args[i - 1] == "--changed")]
sel = [j for j in jobs if not names or any(n in j for n in names)]
full = not names
wt = Path.cwd()
if (wt / "FLAKE").exists():
    with open(d / "candidate_calls.jsonl", "a") as f:
        f.write(json.dumps(args) + "\n")
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
if (full or cfg.get("move_on_narrow_site") and sorted(names) == ["mcp", "site"]) and cfg.get("move_main", 0) > 0:
    n = int((d / "moves").read_text()) if (d / "moves").exists() else 0
    if n < cfg["move_main"]:
        (d / "moves").write_text(str(n + 1))
        m = d / "mover"
        run = lambda *a: subprocess.run(["git", *a], cwd=m, check=True, capture_output=True)
        run("fetch", "-q", "origin", "main")
        run("reset", "-q", "--hard", "origin/main")
        for name in cfg.get("move_paths", [f"moved-{n}.txt"]):
            p = m / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(str(n))
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
if (wt / "OUTSIDELOAD").exists() and not (d / "outsideloaded").exists():
    (d / "outsideloaded").write_text("")
    print("waiting on outside load for site: 30000 tasks, top: chrome")
if (wt / "OUTSIDELOAD_OTHER").exists() and not (d / "outsideloaded-other").exists():
    (d / "outsideloaded-other").write_text("")
    print("waiting on outside load for mcp: 30000 tasks, top: chrome")
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
if cfg.get("fail_narrow_site") and sorted(names) == ["mcp", "site"]:
    fail.add("site")
if cfg.get("fail_narrow_mcp") and sorted(names) == ["mcp", "site"]:
    fail.add("mcp")   # an unlisted or oversized jpg on main: test_site_shots.py, in the mcp job
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
if cfg.get("write_results_json") and os.environ.get("BRX_RESULTS_JSON"):
    json_fail = set(sel) & (fail if cfg.get("json_follow_table") else set(cfg.get("json_fail_jobs", [])))
    record = {"version": 1, "complete": not (cfg.get("incomplete_failed_full") and full and fail), "selected": sel,
              "jobs": [{"name": j, "ok": j not in json_fail, "exit": 1 if j in json_fail else 0,
                        "secs": 1, "log": str(d / f"{j}.log"), "cached": False} for j in sel],
              "build": None, "startedAt": "a", "finishedAt": "b"}
    Path(os.environ["BRX_RESULTS_JSON"]).write_text(json.dumps(record))
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

    def submit(self, name: str, files: dict, owner="tester", cwd=None, env=None) -> str:
        cwd = cwd or self.dev
        _git("fetch", "-q", "origin", cwd=cwd)
        _git("checkout", "-q", "-B", name, "origin/main", cwd=cwd)
        for f, text in files.items():
            (cwd / f).parent.mkdir(parents=True, exist_ok=True)
            (cwd / f).write_text(text)
        _git("add", "-A", cwd=cwd)
        _git("commit", "-q", "-m", name, cwd=cwd)
        r = self.land("submit", "--owner", owner, cwd=cwd, env=env)
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

    def result_or_none(self, id_: str, machine="a"):
        p = self.dir / f"state-{machine}" / f"{id_}.json"
        return json.loads(p.read_text()) if p.exists() else None

    def result(self, id_: str, machine="a") -> dict:
        return json.loads((self.dir / f"state-{machine}" / f"{id_}.json").read_text())

    def full_gates(self) -> int:
        calls = [json.loads(line) for line in (self.dir / "calls.jsonl").read_text().splitlines()]
        return sum(1 for c in calls if "--list" not in c and not [a for i, a in enumerate(c)
                                                                 if not a.startswith("--") and not (i > 0 and c[i - 1] == "--changed")])

    def narrow_site_gates(self) -> int:
        calls = [json.loads(line) for line in (self.dir / "calls.jsonl").read_text().splitlines()]
        return sum(1 for c in calls if "--list" not in c and "site" in c and "mcp" in c and "--no-cache" in c)


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


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


def _commit_branch(t: Lane, name: str, files: dict):
    _git("fetch", "-q", "origin", cwd=t.dev)
    _git("checkout", "-q", "-B", name, "origin/main", cwd=t.dev)
    for f, content in files.items():
        (t.dev / f).parent.mkdir(parents=True, exist_ok=True)
        (t.dev / f).write_text(content)
    _git("add", "-A", cwd=t.dev)
    _git("commit", "-q", "-m", name, cwd=t.dev)


def _record_ref_deletions(t: Lane):
    log = t.dir / "ref-deletions.jsonl"
    hook = t.remote / "hooks" / "post-receive"
    hook.write_text(f"#!{sys.executable}\n" +
                    "import json, pathlib, sys\n" +
                    f"log = pathlib.Path({str(log)!r})\n" +
                    f"state = pathlib.Path({str(t.dir / 'state-a')!r})\n" +
                    "deletions = []\n" +
                    "for line in sys.stdin:\n" +
                    "    old, new, ref = line.split()\n" +
                    "    if set(new) == {'0'} and ref.startswith('refs/heads/land/'):\n" +
                    "        id_ = ref.removeprefix('refs/heads/land/')\n" +
                    "        deletions.append((ref, (state / (id_ + '.json')).exists()))\n" +
                    "    elif set(new) == {'0'} and ref.startswith('refs/heads/land-fix/'):\n" +
                    "        deletions.append((ref, None))\n" +
                    "if deletions:\n" +
                    "    with log.open('a') as f:\n" +
                    "        f.write(json.dumps(deletions) + '\\n')\n")
    hook.chmod(0o755)
    return log


def _assert_refs_deleted_together(t: Lane, log: Path, id_: str):
    refs = t.remote_refs()
    assert f"refs/heads/land/{id_}" not in refs
    assert f"refs/heads/land-fix/{id_}" not in refs
    events = [json.loads(line) for line in log.read_text().splitlines()]
    target = {f"refs/heads/land/{id_}", f"refs/heads/land-fix/{id_}"}
    matching = [event for event in events if any(ref in target for ref, _ in event)]
    assert len(matching) == 1 and {ref for ref, _ in matching[0]} == target, matching
    assert dict(matching[0])[f"refs/heads/land/{id_}"] is True, matching


# ---- the happy path, conflicts, red, flakes -----------------------------------------------------------------------

def test_submit_refuses_a_docs_change_when_hygiene_fails():
    with Lane() as t:
        _git("fetch", "-q", "origin", cwd=t.dev)
        _git("checkout", "-q", "-B", "docs-gate", "origin/main", cwd=t.dev)
        (t.dev / "docs").mkdir()
        (t.dev / "docs/page.md").write_text("page\n")
        (t.dev / "mcp").mkdir()
        (t.dev / "mcp/run_tests.py").write_text("# a checkout with the runner\n")   # the check runs only with one
        _git("add", "-A", cwd=t.dev)
        _git("commit", "-q", "-m", "docs", cwd=t.dev)
        r = t.land("submit", "--owner", "tester", env=t.env(LAND_DOCS_HYGIENE_STUB="test_docs_hygiene::test_stub_failure"))
        assert r.returncode == 4, r.stdout + r.stderr
        assert "test_docs_hygiene::test_stub_failure" in r.stdout + r.stderr
        assert not any(ref.startswith("refs/heads/land/") for ref in t.remote_refs())


def test_a_clean_batch_of_three_lands_in_one_gate():
    with Lane() as t:
        ids = [t.submit(f"b{i}", {f"f{i}.txt": str(i)}) for i in range(3)]
        r = t.land("run")
        assert r.returncode == 0, r.stdout + r.stderr
        _assert_landed(t, *ids)
        assert t.full_gates() == 1
        assert _branch_count(t, "refs/heads/land") == 0


def test_a_land_removes_every_gate_results_file():
    with Lane() as t:
        id_ = t.submit("a", {"a.txt": "a"})
        t.cfg(write_results_json=True, write_list_results_json=True)
        r = t.land("run")
        assert r.returncode == 0, r.stdout + r.stderr
        _assert_landed(t, id_)
        assert not list((t.dir / "state-a" / "logs").glob("*.results.json"))



def _gate_calls(t: Lane) -> list:
    return [json.loads(line) for line in (t.dir / "calls.jsonl").read_text().splitlines()]


def test_a_row_only_candidate_lands_with_a_regenerated_index_commit():
    with Lane() as t:
        seed = t.dir / "mover"
        source = ("<!-- index:start -->\n**MVP open: 1.** Desk 1 · bench 0 · decision 0.\n\n"
                  "**MVP DESK (1),** a keyboard is enough:\n- 🟡 **Z1**\n\n"
                  "**MVP BENCH (0),** needs a gun, a Stick, phones or a field (the order is the bench plan):\n\n"
                  "**MVP DECISION (0),** awaiting Tony:\n<!-- index:end -->\n\n"
                  "## MVP DESK\n- **Z1 🟡 A ROW.** text\n## MVP BENCH\n## MVP DECISION\n")
        (seed / "docs").mkdir()
        (seed / "scripts").mkdir()
        (seed / "docs" / "FOLLOWUPS.md").write_text(source)
        shutil.copyfile(REPO / "scripts" / "followups-index.mjs", seed / "scripts" / "followups-index.mjs")
        _git("add", "-A", cwd=seed)
        _git("commit", "-q", "-m", "index seed", cwd=seed)
        _git("push", "-q", "origin", "HEAD:main", cwd=seed)
        changed = source.replace("- **Z1 🟡 A ROW.** text", "- **Z1 🟡 A ROW.** text\n- **Z2 🟠 ANOTHER ROW.** text")
        id_ = t.submit("row", {"docs/FOLLOWUPS.md": changed})
        result = t.land("run")
        assert result.returncode == 0, result.stdout + result.stderr
        _assert_landed(t, id_)
        assert t.on_main("Land: regenerate the FOLLOWUPS index") == 1
        landed = _git("show", "main:docs/FOLLOWUPS.md", cwd=t.remote)
        assert "**MVP open: 2.** Desk 2 · bench 0 · decision 0." in landed
        assert "- 🟠 **Z2**" in landed
        assert set((t.dir / "index_fresh.txt").read_text().splitlines()) == {"1"}


def test_an_unrelated_candidate_repairs_a_stale_main_index():
    with Lane() as t:
        seed = t.dir / "mover"
        source = ("<!-- index:start -->\n**MVP open: 1.** Desk 1 · bench 0 · decision 0.\n\n"
                  "**MVP DESK (1),** a keyboard is enough:\n- 🟡 **Z1**\n\n"
                  "**MVP BENCH (0),** needs a gun, a Stick, phones or a field (the order is the bench plan):\n\n"
                  "**MVP DECISION (0),** awaiting Tony:\n<!-- index:end -->\n\n"
                  "## MVP DESK\n- **Z1 🟡 A ROW.** text\n## MVP BENCH\n## MVP DECISION\n")
        (seed / "docs").mkdir()
        (seed / "scripts").mkdir()
        (seed / "docs" / "FOLLOWUPS.md").write_text(source)
        shutil.copyfile(REPO / "scripts" / "followups-index.mjs", seed / "scripts" / "followups-index.mjs")
        _git("add", "-A", cwd=seed)
        _git("commit", "-q", "-m", "index seed", cwd=seed)
        _git("push", "-q", "origin", "HEAD:main", cwd=seed)
        (seed / "docs" / "FOLLOWUPS.md").write_text(source.replace(
            "- **Z1 🟡 A ROW.** text", "- **Z1 🟡 A ROW.** text\n- **Z2 🟠 ANOTHER ROW.** text"))
        _git("commit", "-qam", "emergency row", cwd=seed)
        _git("push", "-q", "origin", "HEAD:main", cwd=seed)
        id_ = t.submit("unrelated", {"unrelated.txt": "change\n"})
        result = t.land("run")
        assert result.returncode == 0, result.stdout + result.stderr
        _assert_landed(t, id_)
        assert t.on_main("Land: regenerate the FOLLOWUPS index") == 1
        assert "**MVP open: 2.** Desk 2 · bench 0 · decision 0." in _git("show", "main:docs/FOLLOWUPS.md", cwd=t.remote)


def test_missing_followups_inputs_do_not_stop_a_land():
    for missing in ("docs/FOLLOWUPS.md", "scripts/followups-index.mjs"):
        with Lane() as t:
            seed = t.dir / "mover"
            source = ("<!-- index:start -->\n**MVP open: 1.** Desk 1 · bench 0 · decision 0.\n\n"
                      "**MVP DESK (1),** a keyboard is enough:\n- 🟡 **Z1**\n\n"
                      "**MVP BENCH (0),** needs a gun, a Stick, phones or a field (the order is the bench plan):\n\n"
                      "**MVP DECISION (0),** awaiting Tony:\n<!-- index:end -->\n\n"
                      "## MVP DESK\n- **Z1 🟡 A ROW.** text\n## MVP BENCH\n## MVP DECISION\n")
            (seed / "docs").mkdir()
            (seed / "scripts").mkdir()
            (seed / "docs" / "FOLLOWUPS.md").write_text(source)
            shutil.copyfile(REPO / "scripts" / "followups-index.mjs", seed / "scripts" / "followups-index.mjs")
            _git("add", "-A", cwd=seed)
            _git("commit", "-q", "-m", "index seed", cwd=seed)
            _git("push", "-q", "origin", "HEAD:main", cwd=seed)
            _git("fetch", "-q", "origin", cwd=t.dev)
            _git("checkout", "-q", "-B", "delete-input", "origin/main", cwd=t.dev)
            _git("rm", "-q", missing, cwd=t.dev)
            if missing == "scripts/followups-index.mjs":
                (t.dev / "docs" / "FOLLOWUPS.md").write_text(source.replace(
                    "- **Z1 🟡 A ROW.** text", "- **Z1 🟡 A ROW.** text\n- **Z2 🟠 ANOTHER ROW.** text"))
                _git("add", "docs/FOLLOWUPS.md", cwd=t.dev)
            _git("commit", "-q", "-m", "delete input", cwd=t.dev)
            submitted = t.land("submit", "--owner", "tester", cwd=t.dev)
            assert submitted.returncode == 0, submitted.stdout + submitted.stderr
            id_ = re.search(r"submitted (\S+) \(queue position", submitted.stdout).group(1)
            result = t.land("run")
            assert result.returncode == 0, result.stdout + result.stderr
            assert "could not regenerate the FOLLOWUPS index" not in result.stdout
            _assert_landed(t, id_)


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


def test_the_landers_gate_runs_with_pool_priority():
    # 2026-10-10: the gate's test-all gets BRX_LAND_PRIORITY=1 (it reserves memory and jumps local tickets).
    with Lane() as t:
        id_ = t.submit("a", {"a.txt": "a"})
        assert t.land("run").returncode == 0
        _assert_landed(t, id_)
        flags = (t.dir / "priority.txt").read_text().split()
        assert flags and all(f == "1" for f in flags), flags

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
        assert flakes[0]["exit"] == "1", flakes[0]
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


def _seed_flakes(t: Lane, *rows):
    # Earlier flakes in the lander's flakes.jsonl. Each row: (job, hours ago, extra fields).
    state = t.dir / "state-a"
    state.mkdir(parents=True, exist_ok=True)
    now = time.time()
    iso = lambda s: time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(s))
    with open(state / "flakes.jsonl", "a") as f:
        for job, hours, extra in rows:
            f.write(json.dumps({"job": job, "step": "x", "branches": ["old"], **extra, "time": iso(now - hours * 3600)}) + "\n")
    return iso


def _flakes(t: Lane):
    return [json.loads(line) for line in (t.dir / "state-a" / "flakes.jsonl").read_text().splitlines()]


def test_an_over_budget_flake_is_red_for_a_candidate_that_touches_the_job():
    # T1 (2026-10-10): the third site flake in 24 h, and the candidate changes site/: it may be the cause, so red.
    with Lane() as t:
        _seed_flakes(t, ("site", 1, {}), ("site", 2, {}))
        a = t.submit("a", {"FLAKE": "fails site once", "site/page.txt": "x"})
        r = t.land("run")
        assert f"site is over its flake budget (3 in 24 h): red for {a}" in r.stdout, r.stdout + r.stderr
        res = t.result(a)
        assert res["status"] == "red" and res["failed_jobs"] == ["site"] and "flake budget" in res["note"], res
        assert t.on_main(f"Land {a}") == 0
        last = _flakes(t)[-1]
        assert last["over_budget"] == 3 and "site flaked 3 times" in last["row"], last
        # A budget red is not a suspect main: no run of the job alone on main, so no main-red stop either.
        calls = [json.loads(line) for line in (t.dir / "calls.jsonl").read_text().splitlines()]
        assert len([c for c in calls if "--list" not in c]) == 2, calls   # the gate and the one rerun
        assert "red on its own" not in r.stdout + r.stderr
        w = t.land("wait", a)
        assert w.returncode == 1 and "flake budget" in w.stdout, w.stdout + w.stderr


def test_an_over_budget_flake_warns_and_lands_a_candidate_that_does_not_touch_the_job():
    # A root file is not among site's declared inputs (scripts/lib/inputs.mjs), so it cannot make site flake.
    with Lane() as t:
        _seed_flakes(t, ("site", 1, {}), ("site", 2, {}))
        a = t.submit("a", {"FLAKE": "fails site once"})
        r = t.land("run")
        assert r.returncode == 0, r.stdout + r.stderr
        _assert_landed(t, a)
        assert "WARNING site is over its flake budget (3 in 24 h)" in r.stdout and "File this row: site flaked 3" in r.stdout, r.stdout
        last = _flakes(t)[-1]
        assert last["over_budget"] == 3 and last["row"].startswith("site flaked 3 times"), last
        assert "site x1" in r.stdout   # one flake this run, not two rows


def test_an_over_budget_flake_blames_a_runner_change_that_selectjobs_would_narrow_away():
    # DRY review #2: --changed narrows scripts/lib/ to mcp, but every job runs on it (inputs.mjs COMMON), so a runner
    # change may be what makes site flake. Blame reads the declared inputs, not the narrowed selection.
    with Lane() as t:
        _seed_flakes(t, ("site", 1, {}), ("site", 2, {}))
        a = t.submit("a", {"FLAKE": "fails site once", "scripts/lib/runner.mjs": "x"})
        r = t.land("run")
        assert f"site is over its flake budget (3 in 24 h): red for {a}" in r.stdout, r.stdout + r.stderr
        assert t.result(a)["status"] == "red" and t.on_main(f"Land {a}") == 0


def test_in_a_batch_only_the_branch_that_touches_the_job_goes_red_and_the_rest_land():
    # No bisect: a clean re-gate of a half could hide the budget. Blame comes from each branch's own diff.
    with Lane() as t:
        _seed_flakes(t, ("site", 1, {}), ("site", 2, {}))
        a = t.submit("a", {"site/page.txt": "x"})
        b = t.submit("b", {"FLAKE": "fails site once"})
        r = t.land("run")
        assert f"red for {a}, which touches" in r.stdout, r.stdout + r.stderr
        assert t.result(a)["status"] == "red" and t.on_main(f"Land {a}") == 0
        _assert_landed(t, b)


def test_an_over_budget_flake_beside_a_real_failure_still_blames_the_touching_branch_after_the_bisect():
    # The first gate has b's real mcp failure AND a's over-budget site flake. The bisect gates a alone, cleanly; a
    # must still be red, since it was in the gate where site flaked.
    with Lane() as t:
        _seed_flakes(t, ("site", 1, {}), ("site", 2, {}))
        a = t.submit("a", {"FLAKE": "fails site once", "site/page.txt": "x"})
        b = t.submit("b", {"RED": "fails mcp"})
        r = t.land("run")
        assert f"red for {a}, which touches" in r.stdout, r.stdout + r.stderr
        assert t.result(a)["status"] == "red" and "flake budget" in t.result(a)["note"], t.result(a)
        assert t.result(b)["status"] == "red" and t.result(b)["failed_jobs"] == ["mcp"], t.result(b)
        assert "site is over its flake budget (3 in 24 h). Row text: site flaked 3" in r.stdout   # printed by the gate
        assert t.on_main(f"Land {a}") == 0 and t.on_main(f"Land {b}") == 0


def test_a_flake_inside_an_active_incident_or_future_dated_rows_do_not_count():
    with Lane() as t:
        iso = _seed_flakes(t, ("site", -1, {}), ("site", -2, {}))   # dated in the future: a clock stepped back
        a = t.submit("a", {"FLAKE": "fails site once", "site/page.txt": "x"})
        r = t.land("run")
        assert r.returncode == 0 and "flake budget" not in r.stdout, r.stdout + r.stderr
        _assert_landed(t, a)
    with Lane() as t:
        iso = _seed_flakes(t, ("site", 1, {}), ("site", 2, {}))
        now = time.time()
        with open(t.dir / "state-a" / "flakes.jsonl", "a") as f:   # an incident that is still open
            f.write(json.dumps({"incident": {"from": iso(now - 600), "note": "box, still open: no `to`"}}) + "\n")
        a = t.submit("a", {"FLAKE": "fails site once", "site/page.txt": "x"})
        r = t.land("run")
        assert r.returncode == 0 and "flake budget" not in r.stdout, r.stdout + r.stderr
        assert "1 excluded as incident noise" in r.stdout, r.stdout   # the summary reads the open window too
        _assert_landed(t, a)


def test_a_shared_build_flake_never_counts_toward_a_budget():
    with Lane() as t:
        _seed_flakes(t, ("app-build", 1, {}), ("app-build", 2, {}))
        a = t.submit("a", {"BUILDFLAKE": "fails the build once", "app/x.txt": "x"})
        r = t.land("run")
        assert r.returncode == 0 and "flake budget" not in r.stdout, r.stdout + r.stderr
        _assert_landed(t, a)


def test_box_load_incidents_old_and_other_jobs_flakes_do_not_count_toward_the_budget():
    with Lane() as t:
        iso = _seed_flakes(t, ("site", 1, {"outside_load": True}), ("site", 30, {}), ("mcp", 1, {}), ("mcp", 2, {}),
                           ("site", 3, {}), ("site", 5, {}))
        # One counted flake (5 h) plus this one is 2: under budget. Each excluded row, counted, would make 3.
        now = time.time()
        with open(t.dir / "state-a" / "flakes.jsonl", "a") as f:   # an incident window covering the 3 h old flake
            f.write(json.dumps({"incident": {"from": iso(now - 4 * 3600), "to": iso(now - 2 * 3600), "note": "box"}}) + "\n")
        a = t.submit("a", {"FLAKE": "fails site once", "site/page.txt": "x"})
        r = t.land("run")
        assert r.returncode == 0, r.stdout + r.stderr
        _assert_landed(t, a)
        assert "flake budget" not in r.stdout and "over_budget" not in _flakes(t)[-1], r.stdout


def test_a_flake_in_a_gate_that_waited_on_outside_load_is_recorded_but_never_counted():
    with Lane() as t:
        _seed_flakes(t, ("site", 1, {}), ("site", 2, {}))
        a = t.submit("a", {"FLAKE": "fails site once", "OUTSIDELOAD": "x", "site/page.txt": "x"})
        r = t.land("run")
        assert r.returncode == 0, r.stdout + r.stderr
        _assert_landed(t, a)
        last = _flakes(t)[-1]
        assert last["outside_load"] is True and "over_budget" not in last, last


def test_other_jobs_outside_load_does_not_exempt_a_site_flake():
    with Lane() as t:
        _seed_flakes(t, ("site", 1, {}), ("site", 2, {}))
        t.submit("a", {"FLAKE": "fails site once", "OUTSIDELOAD_OTHER": "mcp waits", "site/page.txt": "x"})
        r = t.land("run")
        assert r.returncode == 0, r.stdout + r.stderr
        last = _flakes(t)[-1]
        assert last["job"] == "site" and "outside_load" not in last and last["over_budget"] == 3, last


def test_flake_budget_docs_scope_outside_load_to_the_job():
    guide = (REPO / "scripts" / "README.md").read_text()
    assert 'a flake whose own job printed "waiting on outside load" in the pool' in guide


def test_land_flake_budget_off_lands_an_over_budget_flake():
    with Lane() as t:
        _seed_flakes(t, ("site", 1, {}), ("site", 2, {}))
        a = t.submit("a", {"FLAKE": "fails site once", "site/page.txt": "x"})
        r = t.land("run", env=t.env(LAND_FLAKE_BUDGET="off"))
        assert r.returncode == 0, r.stdout + r.stderr
        _assert_landed(t, a)
        assert "flake budget" not in r.stdout


# ---- prune (OP8) ---------------------------------------------------------------------------------------------------

def _stamp(days_ago: float) -> str:
    return time.strftime("%Y%m%d%H%M%S", time.gmtime(time.time() - days_ago * 86400))


def _markers(t: Lane) -> Path:
    tag = hashlib.sha256(str(t.remote.resolve()).encode()).hexdigest()[:10]
    return t.dir / "state-a" / "withdrawn" / tag


def _prune_fixture(t: Lane):
    """Old (20 d) and new (1 d) land-failed refs, results, withdrawn markers and flake rows, plus names prune must
    never touch: a land-failed ref that is not id-shaped, and the lander's own state files."""
    old, new = f"{_stamp(20)}-tester-old", f"{_stamp(1)}-tester-new"
    # Never touched: not id-shaped (ID_RE has no capitals), an impossible date, and an old id still in the queue.
    odd, bad_date, queued = f"{_stamp(20)}-Bob-x", "20250132000000-tester-x", f"{_stamp(20)}-tester-queued"
    for ref in (old, new, "hand-made", odd, bad_date):
        _git("push", "-q", "origin", f"origin/main:refs/heads/land-failed/{ref}", cwd=t.dev)
    _git("push", "-q", "origin", f"origin/main:refs/heads/land/{queued}", cwd=t.dev)
    state = t.dir / "state-a"
    markers = _markers(t)
    markers.mkdir(parents=True, exist_ok=True)
    legacy = state / "withdrawn"
    for id_ in (old, new, odd, queued):
        (state / f"{id_}.json").write_text(json.dumps({"id": id_, "status": "red"}))
        (markers / id_).write_text("{}")
        (legacy / id_).write_text("{}")
    (legacy / "keep-this-directory").mkdir()
    (state / "active-batch.json").write_text("{}")
    iso = lambda d: time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time() - d * 86400))
    rows = [{"job": "site", "time": iso(20)}, {"job": "site", "time": iso(1)}, {"job": "mcp", "time": "garbled"},
            {"incident": {"from": iso(21), "to": iso(20), "note": "old"}}, {"incident": {"from": iso(2), "note": "open"}}]
    (state / "flakes.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows) + '{"incident": {"note": "typo"}\n')
    t.odd, t.queued = odd, queued
    return old, new, state


def test_prune_deletes_old_land_failed_refs_results_markers_and_flake_rows_and_keeps_new_ones():
    with Lane() as t:
        old, new, state = _prune_fixture(t)
        r = t.land("prune")
        assert r.returncode == 0, r.stdout + r.stderr
        refs = t.remote_refs()
        assert f"refs/heads/land-failed/{old}" not in refs, refs
        for keep in (new, "hand-made", t.odd, "20250132000000-tester-x"):
            assert f"refs/heads/land-failed/{keep}" in refs, (keep, refs)
        assert not (state / f"{old}.json").exists() and not (_markers(t) / old).exists()
        assert not (state / "withdrawn" / old).exists()
        assert (_markers(t).is_dir() and (state / "withdrawn" / "keep-this-directory").is_dir())
        for id_ in (new, t.odd, t.queued):
            assert (state / f"{id_}.json").exists() and (_markers(t) / id_).exists(), id_
            assert (state / "withdrawn" / id_).exists(), id_
        assert (state / "active-batch.json").exists()
        kept = [json.loads(l) for l in (state / "flakes.jsonl").read_text().splitlines()[:-1]]   # the last is the typo
        assert [r.get("job") or r["incident"]["note"] for r in kept[:3]] == ["site", "mcp", "open"], kept
        assert (state / "flakes.jsonl").read_text().endswith('{"incident": {"note": "typo"}\n')   # unparsable: kept
        assert "deleted 1 land-failed ref(s)" in r.stdout and "deleted 3 local result(s)" in r.stdout, r.stdout


def test_prune_removes_old_legacy_marker_even_when_another_remote_wrote_it():
    with Lane() as a, Lane() as b:
        state = a.dir / "state-a"
        id_ = f"{_stamp(20)}-tester-withdrawn"
        _git("push", "-q", "origin", f"origin/main:refs/heads/land/{id_}", cwd=b.dev)
        marker = state / "withdrawn" / id_
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text("{}")
        r = a.land("prune")
        assert r.returncode == 0, r.stdout + r.stderr
        assert not marker.exists(), "prune kept an old unscoped withdrawal marker"


def test_clones_of_one_remote_share_scoped_withdrawal_markers():
    with Lane() as t:
        other = t.clone("other")
        id_ = f"{_stamp(20)}-tester-withdrawn"
        _git("push", "-q", "origin", f"origin/main:refs/heads/land/{id_}", cwd=t.dev)
        marker = _markers(t) / id_
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text("{}")
        r = t.land("run", cwd=other)
        assert r.returncode == 0 and f"{id_} was withdrawn" in r.stdout, r.stdout + r.stderr
        assert f"refs/heads/land/{id_}" in t.remote_refs()


def test_prune_dry_run_changes_nothing_and_a_running_lander_keeps_the_flake_log():
    with Lane() as t:
        old, new, state = _prune_fixture(t)
        before = (state / "flakes.jsonl").read_text()
        r = t.land("prune", "--dry-run")
        assert r.returncode == 0 and "would delete 1 land-failed ref(s)" in r.stdout, r.stdout + r.stderr
        assert f"refs/heads/land-failed/{old}" in t.remote_refs() and (state / f"{old}.json").exists()
        assert (_markers(t) / old).exists()
        assert (state / "withdrawn" / old).exists()
        assert (state / "flakes.jsonl").read_text() == before
        lock = t.dir / "lock-a"
        lock.mkdir(exist_ok=True)
        (lock / f"{int(time.time() * 1000):015d}-{os.getpid()}-other0").write_text("")   # a live lander
        gated = f"{_stamp(20)}-tester-gated"   # in that lander's batch: an old id, but in flight
        _git("push", "-q", "origin", f"origin/main:refs/heads/land-failed/{gated}", cwd=t.dev)
        (state / f"{gated}.json").write_text("{}")
        (state / "active-batch.json").write_text(json.dumps({"ids": [gated]}))
        r = t.land("prune", "--dry-run")
        assert "would delete 1 land-failed ref(s)" in r.stdout and "a lander is running" in r.stdout, r.stdout
        assert "would delete 1 local result(s)" in r.stdout, r.stdout   # old's result; no markers while it runs
        r = t.land("prune")
        assert r.returncode == 0 and "a lander is running" in r.stdout, r.stdout + r.stderr
        assert (state / "flakes.jsonl").read_text() == before
        assert (_markers(t) / old).exists()   # a marker may be mid-handshake with that lander
        assert (state / "withdrawn" / old).exists()
        assert f"refs/heads/land-failed/{old}" not in t.remote_refs()   # refs and results do not wait for it
        assert f"refs/heads/land-failed/{gated}" in t.remote_refs() and (state / f"{gated}.json").exists()


def test_prune_ignores_a_crashed_landers_active_batch():
    with Lane() as t:
        old, new, state = _prune_fixture(t)
        (state / "active-batch.json").write_text(json.dumps({"ids": [old]}))   # no lander holds the lock
        r = t.land("prune")
        assert r.returncode == 0 and f"refs/heads/land-failed/{old}" not in t.remote_refs(), r.stdout + r.stderr


def test_prune_exits_5_when_the_remote_keeps_a_ref_but_still_cleans_up_locally():
    with Lane() as t:
        old, new, state = _prune_fixture(t)
        hook = t.remote / "hooks" / "pre-receive"
        hook.write_text("#!/bin/sh\nwhile read a b ref; do case $ref in *tester-old) echo refused >&2; exit 1;; esac; done\n")
        hook.chmod(0o755)
        r = t.land("prune")
        assert r.returncode == 5 and "1 ref(s) still there" in r.stdout + r.stderr, r.stdout + r.stderr
        assert f"refs/heads/land-failed/{old}" in t.remote_refs()
        assert not (state / f"{old}.json").exists()   # the local cleanup still ran


def test_an_unknown_flag_is_refused_with_the_nearest_real_one():
    # brx1, 2026-10-10: `wait <id> --timeout 21600` ran silently to the 60 min default (the flag is --timeout-min).
    with Lane() as t:
        for args, want in ((["wait", "x", "--timeout", "21600", "--timeout-min", "0"], "--timeout-min"),   # unfixed: exit 3 at once
                           (["prune", "--older-than-day", "9"], "--older-than-days"),
                           (["status", "--nodrive"], "--no-drive"),
                           (["run", "--dryrun"], "--dry-run"),
                           (["run", "--batch", "--dryrun"], "--dry-run"),
                           (["wait", "x", "--timeout-min=5"], "--timeout-min"),
                           (["wait", "x", "-timeout-min", "5"], "--timeout-min"),
                           (["wait", "x", "\u2014timeout-min", "5"], "--timeout-min")):
            r = t.land(*args, timeout=30)   # unfixed, `wait` hangs to its default
            assert r.returncode == 4 and f"unknown flag {next(a for a in args[1:] if a[0] in '-\u2014' and a not in ('--batch', '--timeout-min'))}" in r.stderr \
                and f"did you mean {want}?" in r.stderr and "usage:" in r.stderr, (args, r.stdout + r.stderr)
        for args in (["status", "--batch", "2"], ["status", "--batch=2"]):   # a real flag on the wrong command too
            r = t.land(*args)
            assert r.returncode == 4 and "status does not take --batch" in r.stderr, (args, r.stdout + r.stderr)
        r = t.land("wait", "x", "21600", timeout=30)   # a stray value is refused, not ignored
        assert r.returncode == 4 and "unexpected 21600" in r.stderr, r.stdout + r.stderr
        r = t.land("withdraw", "nosuch", "--owner", "--x")   # a value may start with --
        assert "unknown flag" not in r.stderr and "unexpected" not in r.stderr, r.stdout + r.stderr
        r = t.land("status", "--no-drive", "--remote", "origin")   # every real flag still passes
        assert r.returncode == 0, r.stdout + r.stderr


def test_prune_refuses_a_bad_day_count():
    with Lane() as t:
        for bad in (["0"], ["Infinity"], []):
            r = t.land("prune", "--older-than-days", *bad)
            assert r.returncode == 4 and "1 or more" in r.stdout + r.stderr, (bad, r.stdout + r.stderr)
        far = t.clone("far")   # the guard: LAND_TEST=1 never prunes a non-local remote
        _git("remote", "set-url", "origin", "ssh://git@127.0.0.1:1/nowhere.git", cwd=far)
        r = t.land("prune", cwd=far)
        assert r.returncode == 4 and "refuses the non-local remote" in r.stderr, r.stdout + r.stderr


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


def test_shots_only_main_advance_runs_site_gate():
    with Lane() as t:
        ids = [t.submit(f"b{i}", {f"f{i}.txt": str(i)}) for i in range(2)]
        t.cfg(move_main=1, move_paths=["site/shots/a.jpg", "site/shots/manifest.json"])
        r = t.land("run")
        assert r.returncode == 0, r.stdout + r.stderr
        _assert_landed(t, *ids)
        assert t.on_main("moved 0") == 1
        assert _git("show", "main:site/shots/a.jpg", cwd=t.remote) == "0"
        assert _git("show", "main:site/shots/manifest.json", cwd=t.remote) == "0"
        assert t.full_gates() == 1
        assert t.narrow_site_gates() == 1
        assert "shots-only main advance" in r.stdout


def test_two_shots_only_main_advances_each_run_site_gate():
    with Lane() as t:
        id_ = t.submit("batch", {"batch.txt": "batch"})
        t.cfg(move_main=2, move_paths=["site/shots/a.jpg"], move_on_narrow_site=True)
        r = t.land("run")
        assert r.returncode == 0, r.stdout + r.stderr
        _assert_landed(t, id_)
        assert t.on_main("moved 0") == t.on_main("moved 1") == 1
        assert t.full_gates() == 1
        assert t.narrow_site_gates() == 2


def test_code_main_advance_regates():
    with Lane() as t:
        id_ = t.submit("batch", {"batch.txt": "batch"})
        t.cfg(move_main=1, move_paths=["src/code.js"])
        r = t.land("run")
        assert r.returncode == 0, r.stdout + r.stderr
        _assert_landed(t, id_)
        assert t.on_main("moved 0") == 1
        assert t.full_gates() == 2
        assert t.narrow_site_gates() == 0
        assert "main advance includes other paths" in r.stdout


def test_mixed_shots_and_code_main_advance_regates():
    with Lane() as t:
        id_ = t.submit("batch", {"batch.txt": "batch"})
        t.cfg(move_main=1, move_paths=["site/shots/a.jpg", "src/code.js"])
        r = t.land("run")
        assert r.returncode == 0, r.stdout + r.stderr
        _assert_landed(t, id_)
        assert t.on_main("moved 0") == 1
        assert t.full_gates() == 2
        assert t.narrow_site_gates() == 0
        assert "main advance includes other paths" in r.stdout


def test_shots_only_main_advance_with_red_site_gate_regates_fully():
    with Lane() as t:
        id_ = t.submit("batch", {"batch.txt": "batch"})
        t.cfg(move_main=1, move_paths=["site/shots/a.jpg"], fail_narrow_site=True)
        r = t.land("run")
        assert r.returncode == 0, r.stdout + r.stderr
        _assert_landed(t, id_)
        assert t.on_main("moved 0") == 1
        assert t.full_gates() == 2
        assert t.narrow_site_gates() == 1
        assert "shots-only site gate failed" in r.stdout


def test_shots_only_main_advance_with_red_mcp_in_the_narrow_gate_regates_fully():
    with Lane() as t:
        id_ = t.submit("batch", {"batch.txt": "batch"})
        t.cfg(move_main=1, move_paths=["site/shots/a.jpg"], fail_narrow_mcp=True)
        r = t.land("run")
        assert r.returncode == 0, r.stdout + r.stderr
        _assert_landed(t, id_)
        assert t.on_main("moved 0") == 1
        assert t.full_gates() == 2
        assert t.narrow_site_gates() == 1
        assert "shots-only site gate failed" in r.stdout


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


def test_a_json_failure_blocks_a_batch_when_the_table_says_ok():
    with Lane() as t:
        a = t.submit("a", {"a.txt": "a"})
        t.cfg(write_results_json=True, json_fail_jobs=["mcp"])
        r = t.land("run")
        assert t.on_main(f"Land {a}") == 0, r.stdout + r.stderr
        assert f"refs/heads/land/{a}" in t.remote_refs() or t.result(a)["status"] == "red"


def test_an_incomplete_failed_gate_is_red_without_a_flake_rerun():
    with Lane() as t:
        a = t.submit("a", {"FLAKE": "fails once"})
        t.cfg(write_results_json=True, json_follow_table=True, incomplete_failed_full=True)
        r = t.land("run")
        assert t.on_main(f"Land {a}") == 0, r.stdout + r.stderr
        assert t.result(a)["status"] == "red", r.stdout + r.stderr
        candidate_calls = [json.loads(line) for line in (t.dir / "candidate_calls.jsonl").read_text().splitlines()]
        assert len(candidate_calls) == 1, candidate_calls
        assert not (t.dir / "state-a" / "flakes.jsonl").exists()


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


def test_missing_local_remote_has_a_clear_error():
    with Lane() as t:
        other = t.clone("missing-remote")
        missing = t.dir / "gone.git"
        _git("remote", "set-url", "origin", str(missing), cwd=other)
        r = t.land("status", cwd=other)
        assert r.returncode == 4, r.stdout + r.stderr
        assert "local remote" in r.stderr and str(missing) in r.stderr, r.stderr
        assert "ENOENT" not in r.stderr and "at realpathSync" not in r.stderr, r.stderr


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


def test_fix_main_gets_batch_priority_and_records_its_reason():
    with Lane() as t:
        normal = [t.submit(f"normal-{i}", {f"n{i}.txt": str(i)}) for i in range(3)]
        _commit_branch(t, "urgent", {"fix.txt": "x"})
        submitted = t.land("submit", "--owner", "tester", "--fix-main", "CI failed: https://ci.example/run/7")
        assert submitted.returncode == 0, submitted.stdout + submitted.stderr
        m = re.search(r"submitted (\S+) \(queue position \d+\)", submitted.stdout)
        assert m, submitted.stdout
        fix = m.group(1)
        refs = t.remote_refs()
        metadata = refs[f"refs/heads/land-fix/{fix}"]
        tip = refs[f"refs/heads/land/{fix}"]
        assert _git("show", "-s", "--format=%B", metadata, cwd=t.remote) == "fix-main: CI failed: https://ci.example/run/7"
        assert _git("rev-parse", f"{metadata}^", cwd=t.remote) == tip
        assert _git("rev-parse", f"{metadata}^{{tree}}", cwd=t.remote) == _git("rev-parse", f"{tip}^{{tree}}", cwd=t.remote)
        queued = t.land("status", fix, "--no-drive")
        assert queued.returncode == 0 and "fix-main: CI failed: https://ci.example/run/7" in queued.stdout, queued.stdout + queued.stderr
        r = t.land("run", "--batch", "1")
        assert r.returncode == 0, r.stdout + r.stderr
        _assert_landed(t, *normal, fix)
        assert t.on_main(f"Land {fix}") == 1
        assert t.result(fix)["fix_main"] == "CI failed: https://ci.example/run/7"
        history = _git("log", "--format=%s", "--reverse", "main", cwd=t.remote).splitlines()
        batches = [subject for subject in history if subject.startswith("Land ")]
        assert batches[0] == f"Land {fix}", history
        assert t.full_gates() == 4
        waited = t.land("wait", fix, "--timeout-min", "0")
        assert waited.returncode == 0 and "fix-main: CI failed: https://ci.example/run/7" in waited.stdout, waited.stdout + waited.stderr


def test_fix_main_refuses_a_second_queued_fix():
    with Lane() as t:
        _commit_branch(t, "first", {"first.txt": "x"})
        first = t.land("submit", "--owner", "tester", "--fix-main", "CI run 7 failed")
        assert first.returncode == 0, first.stdout + first.stderr
        _commit_branch(t, "second", {"second.txt": "x"})
        second = t.land("submit", "--owner", "tester", "--fix-main", "CI run 7 failed")
        assert second.returncode == 4 and "already" in second.stderr, second.stdout + second.stderr


def test_fix_main_requires_a_reason():
    with Lane() as t:
        _commit_branch(t, "change", {"change.txt": "x"})
        for args in (("--fix-main",), ("--fix-main", "  ")):
            r = t.land("submit", "--owner", "tester", *args)
            assert r.returncode == 4 and "reason" in r.stderr, r.stdout + r.stderr


def test_fix_main_rejects_control_characters_and_long_reasons():
    with Lane() as t:
        _commit_branch(t, "change", {"change.txt": "x"})
        for reason, message in (("line one\nline two", "control"), ("tab\tinside", "control"),
                                ("bad\x7fbyte", "control"), ("line\u2028break", "line separators"),
                                ("x" * 301, "300")):
            r = t.land("submit", "--owner", "tester", "--fix-main", reason)
            assert r.returncode == 4 and message in r.stderr, r.stdout + r.stderr
            assert _branch_count(t, "refs/heads/land/") == 0
        accepted = t.land("submit", "--owner", "tester", "--fix-main", "x" * 300)
        assert accepted.returncode == 0, accepted.stdout + accepted.stderr


def test_fix_main_warns_when_the_current_main_is_not_known_red():
    with Lane() as t:
        _commit_branch(t, "change", {"change.txt": "x"})
        state = t.dir / "state-a"
        state.mkdir()
        (state / "main-red").write_text(json.dumps({"main_sha": "0" * 40, "message": "old main was red"}))
        r = t.land("submit", "--owner", "tester", "--fix-main", "CI run 7 failed")
        assert r.returncode == 0, r.stdout + r.stderr
        assert "--fix-main is for a red main" in r.stdout
        assert "reason is recorded" in r.stdout


def test_a_fix_main_entry_starts_the_lander_after_a_main_red_halt():
    with Lane() as t:
        mover = t.dir / "mover"
        (mover / "RED").write_text("main is broken")
        _git("add", "RED", cwd=mover)
        _git("commit", "-q", "-m", "break main", cwd=mover)
        _git("push", "-q", "origin", "HEAD:main", cwd=mover)
        ordinary = t.submit("ordinary", {"ordinary.txt": "x"})
        halted = t.land("run")
        assert halted.returncode == 5 and "red on its own" in halted.stderr, halted.stdout + halted.stderr
        _git("fetch", "-q", "origin", cwd=t.dev)
        _git("checkout", "-q", "-B", "repair", "origin/main", cwd=t.dev)
        _git("rm", "-q", "RED", cwd=t.dev)
        _git("commit", "-q", "-m", "repair main", cwd=t.dev)
        submitted = t.land("submit", "--owner", "tester", "--fix-main", "remove the failing file")
        assert submitted.returncode == 0, submitted.stdout + submitted.stderr
        fix = re.search(r"submitted (\S+) \(queue position \d+\)", submitted.stdout).group(1)
        assert "--fix-main is for a red main" not in submitted.stdout
        waited = t.land("wait", fix, "--timeout-min", "0.5")
        assert waited.returncode == 0 and "running the lander here" in waited.stdout, waited.stdout + waited.stderr
        _assert_landed(t, fix, ordinary)


def test_a_fix_main_still_red_on_main_is_marked_red_and_frees_the_slot():
    with Lane() as t:
        mover = t.dir / "mover"
        (mover / "RED").write_text("main is broken")
        _git("add", "RED", cwd=mover)
        _git("commit", "-q", "-m", "break main", cwd=mover)
        _git("push", "-q", "origin", "HEAD:main", cwd=mover)
        ordinary = t.submit("ordinary", {"ordinary.txt": "x"})
        assert t.land("run").returncode == 5
        _commit_branch(t, "bad-fix", {"still-red.txt": "x"})
        submitted = t.land("submit", "--owner", "tester", "--fix-main", "try a repair")
        assert submitted.returncode == 0, submitted.stdout + submitted.stderr
        fix = re.search(r"submitted (\S+) \(queue position \d+\)", submitted.stdout).group(1)
        stopped = t.land("run", "--batch", "1")
        assert stopped.returncode == 5 and "red on its own" in stopped.stderr, stopped.stdout + stopped.stderr
        result = t.result(fix)
        assert result["status"] == "red" and result["failed_jobs"] == ["mcp"], result
        assert "main is red too" in result["note"] and result["fix_main"] == "try a repair", result
        assert f"refs/heads/land/{fix}" not in t.remote_refs()
        assert f"refs/heads/land-fix/{fix}" not in t.remote_refs()
        assert f"refs/heads/land/{ordinary}" in t.remote_refs()
        main_sha = _git("rev-parse", "main", cwd=t.remote)
        main_red = json.loads((t.dir / "state-a" / "main-red").read_text())
        assert main_red["main_sha"] == main_sha and "red on its own" in main_red["message"]
        _commit_branch(t, "second-fix", {"second.txt": "x"})
        second = t.land("submit", "--owner", "tester", "--fix-main", "another repair")
        assert second.returncode == 0, second.stdout + second.stderr


def test_fix_main_refs_are_deleted_together_after_land_and_red():
    with Lane() as t:
        log = _record_ref_deletions(t)
        _commit_branch(t, "landed", {"landed.txt": "x"})
        landed = t.land("submit", "--owner", "tester", "--fix-main", "CI run 8 failed")
        landed_id = re.search(r"submitted (\S+) \(queue position \d+\)", landed.stdout).group(1)
        assert t.land("run").returncode == 0
        _assert_refs_deleted_together(t, log, landed_id)

        _commit_branch(t, "red", {"RED": "x"})
        red = t.land("submit", "--owner", "tester", "--fix-main", "CI run 9 failed")
        red_id = re.search(r"submitted (\S+) \(queue position \d+\)", red.stdout).group(1)
        assert t.land("run").returncode == 0
        assert t.result(red_id)["status"] == "red"
        _assert_refs_deleted_together(t, log, red_id)


def test_fix_main_refs_are_deleted_together_after_withdraw():
    with Lane() as t:
        log = _record_ref_deletions(t)
        _commit_branch(t, "withdrawn", {"withdrawn.txt": "x"})
        submitted = t.land("submit", "--owner", "tester", "--fix-main", "CI run 9 failed")
        id_ = re.search(r"submitted (\S+) \(queue position \d+\)", submitted.stdout).group(1)
        withdrawn = t.land("withdraw", id_, "--owner", "tester")
        assert withdrawn.returncode == 0, withdrawn.stdout + withdrawn.stderr
        assert t.result(id_)["status"] == "withdrawn"
        _assert_refs_deleted_together(t, log, id_)


def test_a_red_main_gives_each_fix_main_entry_one_lander_start():
    # Codex round 3: a fix-main entry that never resolves (it conflicted while main went red) must not start a lander
    # that stops again on every poll. The main-red record lists the fix ids already tried on that main.
    with Lane() as t:
        _commit_branch(t, "fix", {"fix.txt": "x"})
        r = t.land("submit", "--owner", "tester", "--fix-main", "CI run 7 failed")
        id_ = re.search(r"submitted (\S+) \(queue position \d+\)", r.stdout).group(1)
        main = _git("rev-parse", "main", cwd=t.remote)
        state = t.dir / "state-a"
        state.mkdir(exist_ok=True)
        (state / "main-red").write_text(json.dumps({"main_sha": main, "message": "red", "fix_tried": [id_]}))
        s = t.land("status")
        assert s.returncode == 0 and "running the lander here" not in s.stdout, s.stdout + s.stderr
        assert t.result_or_none(id_) is None, "a tried fix started a lander again on the same red main"
        (state / "main-red").write_text(json.dumps({"main_sha": main, "message": "red", "fix_tried": []}))
        s = t.land("status")
        assert "running the lander here" in s.stdout, s.stdout + s.stderr   # an untried fix still gets its start


def test_fix_main_ref_is_removed_after_land_and_withdraw():
    with Lane() as t:
        _commit_branch(t, "landed", {"landed.txt": "x"})
        landed = t.land("submit", "--owner", "tester", "--fix-main", "CI run 8 failed")
        assert landed.returncode == 0, landed.stdout + landed.stderr
        landed_id = re.search(r"submitted (\S+) \(queue position \d+\)", landed.stdout).group(1)
        assert f"refs/heads/land-fix/{landed_id}" in t.remote_refs()
        r = t.land("run")
        assert r.returncode == 0, r.stdout + r.stderr
        assert f"refs/heads/land-fix/{landed_id}" not in t.remote_refs()
        assert t.result(landed_id)["fix_main"] == "CI run 8 failed"

        _commit_branch(t, "withdrawn", {"withdrawn.txt": "x"})
        withdrawn = t.land("submit", "--owner", "tester", "--fix-main", "CI run 9 failed")
        assert withdrawn.returncode == 0, withdrawn.stdout + withdrawn.stderr
        withdrawn_id = re.search(r"submitted (\S+) \(queue position \d+\)", withdrawn.stdout).group(1)
        assert f"refs/heads/land-fix/{withdrawn_id}" in t.remote_refs()
        w = t.land("withdraw", withdrawn_id, "--owner", "tester")
        assert w.returncode == 0, w.stdout + w.stderr
        assert f"refs/heads/land-fix/{withdrawn_id}" not in t.remote_refs()
        assert t.result(withdrawn_id)["fix_main"] == "CI run 9 failed"
        waited = t.land("wait", withdrawn_id, "--timeout-min", "0")
        assert waited.returncode == 6 and "fix-main: CI run 9 failed" in waited.stdout, waited.stdout + waited.stderr


def test_prune_removes_an_orphan_fix_main_ref():
    with Lane() as t:
        id_ = f"{_stamp(1)}-tester-orphan"
        _git("push", "-q", "origin", f"origin/main:refs/heads/land-fix/{id_}", cwd=t.dev)
        assert f"refs/heads/land-fix/{id_}" in t.remote_refs()
        r = t.land("prune")
        assert r.returncode == 0, r.stdout + r.stderr
        assert f"refs/heads/land-fix/{id_}" not in t.remote_refs()


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


def _main_lander(t: Lane, head: str) -> None:
    """Put a copy of this repo's scripts/ on the test repo's main, with `head` as the first statement of its land.mjs.
    First, not last: a line at the end runs only after the whole run, and wait can see the land before that (CI
    2026-10-10, the marker test went red on a slow runner)."""
    seed = t.clone("seeder")
    shutil.copytree(REPO / "scripts", seed / "scripts", ignore=shutil.ignore_patterns("node_modules", "test"))
    land = seed / "scripts" / "land.mjs"
    shebang, rest = land.read_text().split("\n", 1)
    land.write_text(f"{shebang}\n{head}\n{rest}")
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
        # CI, 2026-10-11 (3d92d497): the child lander writes the landed result BEFORE it deletes land/<id> (so no
        # window has the ref gone and no result), and `wait` returns on the result. Wait for the child to exit, which
        # it does only after the delete, before checking refs and reading its whole log.
        last = next((t.dev / "rel-state").glob("lander-main-*.last"))
        child = json.loads(last.read_text())["pid"]
        deadline = time.time() + 60
        while _pid_alive(child) and time.time() < deadline:
            time.sleep(0.1)
        assert not _pid_alive(child), "the main lander child did not exit after landing"
        _assert_landed_in(t, id_, t.dev / "rel-state")
        logs = list((t.dev / "rel-state" / "logs").glob("lander-main-*.log"))
        text = next((p.read_text() for p in logs if "MAIN-LANDER-MARKER" in p.read_text()), "")
        assert text, "the child did not run main's land.mjs"
        # The marker runs before the child does anything, so it is in the log before the child's first batch line.
        # This fails when the marker is placed at the end of land.mjs (break-tested), the CI race of 2026-10-10.
        assert "batch of" not in text.split("MAIN-LANDER-MARKER")[0], text


def _start_claim(t: Lane) -> Path:
    common = Path(_git("rev-parse", "--path-format=absolute", "--git-common-dir", cwd=t.dev)).resolve()
    tag = hashlib.sha256(str(common).encode()).hexdigest()[:10]
    return t.dir / "state-a" / f"lander-main-{tag}.starting"


def test_an_old_start_claim_with_a_live_owner_is_not_stolen():
    with Lane() as t:
        _main_lander(t, "// main differs from the branch")
        t.submit("a", {"a.txt": "a"})
        state = t.dir / "state-a"
        state.mkdir(exist_ok=True)
        claim = _start_claim(t)
        claim.mkdir()
        (claim / "owner").write_text(str(os.getpid()))
        old = time.time() - 61
        os.utime(claim, (old, old))
        try:
            r = t.land("status")
            assert r.returncode == 0, r.stdout + r.stderr
            assert claim.exists() and (claim / "owner").read_text() == str(os.getpid())
            assert not list(state.glob("lander-main-*.last")), "a second waiter started a lander"
        finally:
            for last in state.glob("lander-main-*.last"):
                try:
                    os.kill(json.loads(last.read_text())["pid"], 15)
                except ProcessLookupError:
                    pass


def test_a_start_removes_retired_claims_over_ten_minutes_old_and_keeps_newer_ones():
    with Lane() as t:
        _main_lander(t, "// main differs from the branch")
        t.submit("a", {"a.txt": "a"})
        state = t.dir / "state-a"
        state.mkdir(exist_ok=True)
        claim = _start_claim(t)
        old_one, new_one = Path(f"{claim}.retired-1-1"), Path(f"{claim}.retired-1-2")
        old_temp = claim.parent / f".{claim.name}-killed"   # a starter killed before its finally
        for d in (old_one, new_one, old_temp):
            (d / ".retired").mkdir(parents=True)
        old = time.time() - 601
        for d in (old_one, old_temp):
            os.utime(d, (old, old))
        try:
            r = t.land("status")
            assert r.returncode == 0, r.stdout + r.stderr
            assert not old_one.exists() and not old_temp.exists() and new_one.exists(), \
                (old_one.exists(), old_temp.exists(), new_one.exists())
            assert not list(state.glob(".trash-*")), "a swept dir was left behind"
        finally:
            for last in state.glob("lander-main-*.last"):
                try:
                    os.kill(json.loads(last.read_text())["pid"], 15)
                except ProcessLookupError:
                    pass


def test_a_start_claim_over_ten_minutes_old_is_stale_even_with_a_live_owner():
    with Lane() as t:
        _main_lander(t, "// main differs from the branch")
        t.submit("a", {"a.txt": "a"})
        state = t.dir / "state-a"
        state.mkdir(exist_ok=True)
        claim = _start_claim(t)
        claim.mkdir()
        (claim / "owner").write_text(str(os.getpid()))
        old = time.time() - 601
        os.utime(claim, (old, old))
        try:
            r = t.land("status")
            assert r.returncode == 0 and "started a lander from origin/main" in r.stdout, r.stdout + r.stderr
        finally:
            for last in state.glob("lander-main-*.last"):
                try:
                    os.kill(json.loads(last.read_text())["pid"], 15)
                except ProcessLookupError:
                    pass


def test_a_claim_without_an_owner_keeps_the_sixty_second_grace():
    for age_seconds, starts in ((59, False), (61, True)):
        with Lane() as t:
            _main_lander(t, "// main differs from the branch")
            t.submit("a", {"a.txt": "a"})
            state = t.dir / "state-a"
            state.mkdir(exist_ok=True)
            claim = _start_claim(t)
            claim.mkdir()
            old = time.time() - age_seconds
            os.utime(claim, (old, old))
            try:
                r = t.land("status")
                assert r.returncode == 0, r.stdout + r.stderr
                assert ("started a lander from origin/main" in r.stdout) is starts, r.stdout + r.stderr
            finally:
                for last in state.glob("lander-main-*.last"):
                    try:
                        os.kill(json.loads(last.read_text())["pid"], 15)
                    except ProcessLookupError:
                        pass


def test_a_recent_claim_with_a_dead_owner_is_stale():
    with Lane() as t:
        _main_lander(t, "// main differs from the branch")
        t.submit("a", {"a.txt": "a"})
        state = t.dir / "state-a"
        state.mkdir(exist_ok=True)
        claim = _start_claim(t)
        claim.mkdir()
        (claim / "owner").write_text("999999999")
        try:
            r = t.land("status")
            assert r.returncode == 0 and "started a lander from origin/main" in r.stdout, r.stdout + r.stderr
        finally:
            for last in state.glob("lander-main-*.last"):
                try:
                    os.kill(json.loads(last.read_text())["pid"], 15)
                except ProcessLookupError:
                    pass


def test_stale_claim_reclamation_does_not_remove_a_new_claim():
    with Lane() as t:
        _main_lander(t, "// main differs from the branch")
        t.submit("a", {"a.txt": "a"})
        state = t.dir / "state-a"
        state.mkdir(exist_ok=True)
        claim = _start_claim(t)
        claim.mkdir()
        (claim / "owner").write_text(str(os.getpid()))
        old = time.time() - 601
        os.utime(claim, (old, old))
        raced = t.dir / "claim-raced"
        shim = t.dir / "claim-race-shim.cjs"
        shim.write_text('''
const fs = require('node:fs');
const rename = fs.renameSync;
fs.renameSync = (from, to) => {
  if (from === process.env.CLAIM_RACE_PATH && to.includes('.retired-') && !fs.existsSync(process.env.CLAIM_RACED)) {
    rename(from, to);
    fs.mkdirSync(from);
    fs.writeFileSync(`${from}/owner`, String(process.pid));
    fs.writeFileSync(process.env.CLAIM_RACED, 'yes');
  }
  return rename(from, to);
};
''')
        env = t.env(NODE_OPTIONS=f"{os.environ.get('NODE_OPTIONS', '')} --require={shim}",
                    CLAIM_RACE_PATH=str(claim), CLAIM_RACED=str(raced))
        r = t.land("status", env=env)
        assert r.returncode == 0, r.stdout + r.stderr
        assert raced.exists() and raced.read_text() == "yes", "the stale claim was not retired"
        assert (claim / "owner").exists(), "reclamation removed the new claim"
        assert not list(state.glob("lander-main-*.last")), "reclamation started another lander"


def test_claim_cleanup_does_not_remove_a_replacement_claim():
    with Lane() as t:
        _main_lander(t, "// main differs from the branch")
        t.submit("a", {"a.txt": "a"})
        claim = _start_claim(t)
        raced = t.dir / "cleanup-raced"
        shim = t.dir / "cleanup-race-shim.cjs"
        shim.write_text('''
const fs = require('node:fs');
const rename = fs.renameSync;
fs.renameSync = (from, to) => {
  if (from === process.env.CLAIM_RACE_PATH && to.includes('.retired-') && !fs.existsSync(process.env.CLAIM_RACED)) {
    rename(from, to);
    fs.mkdirSync(from);
    fs.writeFileSync(`${from}/owner`, String(process.pid));
    fs.writeFileSync(process.env.CLAIM_RACED, 'yes');
  }
  return rename(from, to);
};
''')
        env = t.env(NODE_OPTIONS=f"{os.environ.get('NODE_OPTIONS', '')} --require={shim}",
                    CLAIM_RACE_PATH=str(claim), CLAIM_RACED=str(raced))
        try:
            r = t.land("status", env=env)
            assert r.returncode == 0, r.stdout + r.stderr
            assert raced.exists(), "cleanup did not retire the original claim"
            assert (claim / "owner").exists(), "cleanup removed the replacement claim"
        finally:
            for last in (t.dir / "state-a").glob("lander-main-*.last"):
                try:
                    os.kill(json.loads(last.read_text())["pid"], 15)
                except ProcessLookupError:
                    pass


def test_another_repository_can_start_while_one_has_a_claim():
    with Lane() as a, Lane() as b:
        _main_lander(b, "// main differs from the branch")
        b.submit("a", {"a.txt": "a"})
        state = b.dir / "state-a"
        state.mkdir(exist_ok=True)
        assert _start_claim(a).name != _start_claim(b).name
        for claim in (state / "lander-main.starting", state / _start_claim(a).name):
            claim.mkdir()
            (claim / "owner").write_text(str(os.getpid()))
        try:
            r = b.land("status")
            assert r.returncode == 0 and "started a lander from origin/main" in r.stdout, r.stdout + r.stderr
        finally:
            for last in state.glob("lander-main-*.last"):
                try:
                    os.kill(json.loads(last.read_text())["pid"], 15)
                except ProcessLookupError:
                    pass


def test_start_claim_has_an_owner_before_it_is_renamed_into_place():
    with Lane() as t:
        _main_lander(t, "// main differs from the branch")
        t.submit("a", {"a.txt": "a"})
        observed = t.dir / "claim-observed"
        shim = t.dir / "claim-shim.cjs"
        shim.write_text('''
const fs = require('node:fs');
const path = require('node:path');
const rename = fs.renameSync;
fs.renameSync = (from, to) => {
  if (to.endsWith('.starting')) {
    if (!fs.readFileSync(path.join(from, 'owner'), 'utf8').trim()) throw Error('claim has no owner');
    fs.writeFileSync(process.env.CLAIM_OBSERVED, 'yes');
  }
  return rename(from, to);
};
''')
        env = t.env(NODE_OPTIONS=f"{os.environ.get('NODE_OPTIONS', '')} --require={shim}",
                    CLAIM_OBSERVED=str(observed))
        try:
            r = t.land("status", env=env)
            assert r.returncode == 0 and "started a lander from origin/main" in r.stdout, r.stdout + r.stderr
            assert observed.read_text() == "yes", "the claim was not published with an owner"
        finally:
            for last in (t.dir / "state-a").glob("lander-main-*.last"):
                try:
                    os.kill(json.loads(last.read_text())["pid"], 15)
                except ProcessLookupError:
                    pass


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

def test_a_fetch_that_loses_a_race_with_another_landers_ref_update_is_retried():
    # CI 2026-10-10: two landers on two machines; one fetched while the other deleted landed refs, git failed with
    # "upload-pack: not our ref", and the lander died as an unexpected error.
    with Lane() as t:
        a = t.submit("a", {"a.txt": "a"})
        r = t.land("run", env=t.env(LAND_TEST_FETCH_RACES="2"))
        assert r.returncode == 0, r.stdout + r.stderr
        _assert_landed(t, a)
        b = t.submit("b", {"b.txt": "b"})
        r = t.land("run", env=t.env(LAND_TEST_FETCH_RACES="3"))   # more than the two retries: a real failure
        assert r.returncode == 5 and "not our ref" in r.stderr, r.stdout + r.stderr
        env = t.env(LAND_TEST_FETCH_RACES="1")
        del env["LAND_TEST"]
        r = t.land("status", "--no-drive", env=env)
        assert r.returncode == 4 and "test-only" in r.stderr, r.stdout + r.stderr


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


def test_a_main_lander_that_landed_and_exited_does_not_block_the_next_wait():
    # Codex round 3: the dead-lander rule fired on a lander that had landed everything and exited normally, so the
    # next wait (a new entry within 2 min) exited 5 instead of starting a lander.
    with Lane() as t:
        _main_lander(t, "// main differs from the branch")
        a = t.submit("a", {"a.txt": "a"})
        w = t.land("wait", a, "--timeout-min", "1", timeout=120)
        assert w.returncode == 0, w.stdout + w.stderr
        last = next((t.dir / "state-a").glob("lander-main-*.last"))
        pid = json.loads(last.read_text())["pid"]
        deadline = time.monotonic() + 30
        exited = False
        while time.monotonic() < deadline:   # the main lander must have EXITED before b is queued
            try:
                os.kill(pid, 0)
                if Path(f"/proc/{pid}/stat").read_text().split(") ")[1][0] == "Z":
                    exited = True
                    break
            except (ProcessLookupError, OSError, IndexError):
                exited = True
                break
            time.sleep(0.1)
        assert exited, f"the main lander (pid {pid}) is still running, so b would prove nothing"   # Codex review
        b = t.submit("b", {"b.txt": "b"})
        w = t.land("wait", b, "--timeout-min", "1", timeout=120)
        assert w.returncode == 0 and "exited without landing" not in w.stderr, w.stdout + w.stderr
        _assert_landed(t, a, b)

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


def test_stop_ends_the_running_lander_after_its_current_batch():
    # brx1, 2026-10-10: restarting a lander on new code needs a clean stop between batches, not a kill mid-push.
    with Lane() as t:
        a = t.submit("a", {"a.txt": "a"})
        b = t.submit("b", {"b.txt": "b"})
        r = t.land("stop")
        assert r.returncode == 0 and "no lander is running" in r.stdout, r.stdout + r.stderr
        t.cfg(barrier=2)   # the first gate waits here until the test adds the second mark
        run = subprocess.Popen([NODE, str(LAND), "run", "--batch", "1"], cwd=t.dev, env=t.env(),
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        try:
            barrier = t.dir / "barrier"
            deadline = time.time() + 30
            while not (barrier.exists() and any(barrier.iterdir())) and time.time() < deadline:
                time.sleep(0.05)
            assert barrier.exists() and any(barrier.iterdir()), "the gate never started"
            r = t.land("stop")
            assert r.returncode == 0 and "will stop after its current batch" in r.stdout, r.stdout + r.stderr
            (barrier / "release").write_text("")
            out, _ = run.communicate(timeout=60)
        finally:
            if run.poll() is None:
                run.kill()
        assert run.returncode == 0 and "stopping after this batch, as asked" in out, out
        assert t.result(a)["status"] == "landed", out
        assert not (t.dir / "state-a" / f"{b}.json").exists() and f"refs/heads/land/{b}" in t.remote_refs(), "the second batch ran"
        assert not list((t.dir / "state-a").glob("stop-request*")), "the request outlived the lander it was for"
        assert (t.dir / "state-a" / "stopped.json").exists(), "a clean stop must read as a result, not a failed start"
        r = t.land("run", "--batch", "1")   # the next lander is not stopped by the old request
        assert r.returncode == 0 and t.result(b)["status"] == "landed", r.stdout + r.stderr


def test_a_wait_that_hosted_a_stopped_lander_never_hosts_another():
    # Opus and Codex: after a stop, the `wait` that ran the lander in-process must not start it again on its own code.
    with Lane() as t:
        for n in "abcd":   # `wait` hosts with the default batch of 4, so z is in the second batch
            t.submit(n, {f"{n}.txt": n})
        b = t.submit("z", {"z.txt": "z"})   # last by time and by name
        t.cfg(barrier=2)
        w = subprocess.Popen([NODE, str(LAND), "wait", b, "--timeout-min", "0.1"], cwd=t.dev, env=t.env(),
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        try:
            barrier = t.dir / "barrier"
            deadline = time.time() + 30
            while not (barrier.exists() and any(barrier.iterdir())) and time.time() < deadline:
                time.sleep(0.05)
            assert barrier.exists() and any(barrier.iterdir()), "the gate never started"
            r = t.land("stop")
            assert r.returncode == 0 and "will stop after its current batch" in r.stdout, r.stdout + r.stderr
            (barrier / "release").write_text("")
            out, _ = w.communicate(timeout=90)
        finally:
            if w.poll() is None:
                w.kill()
        assert "stopping after this batch" in out and out.count("running the lander here") == 1, out
        assert w.returncode == 3 and f"refs/heads/land/{b}" in t.remote_refs(), (w.returncode, out)


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
        assert (_markers(t) / id_).exists()
        assert (t.dir / "state-a" / "withdrawn" / id_).exists()   # the unscoped copy, for a lander on older code


def test_a_lander_skips_an_id_withdrawn_after_its_fetch():
    # The race: the lander fetched the queue, then a withdraw marked the id. The ref is still on the remote here (the
    # worst case), and the lander must still leave the id out of the batch, gate nothing for it and keep it off main.
    with Lane() as t:
        id_ = t.submit("a", {"a.txt": "a"}, owner="alice")
        other = t.submit("b", {"b.txt": "b"})
        marks = _markers(t)
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
        assert not (_markers(t) / id_).exists()


def test_withdraw_of_an_unknown_id_while_a_lander_runs_leaves_no_marker():
    with Lane() as t:
        lock = t.dir / "lock-a"
        lock.mkdir()
        (lock / f"{int(time.time() * 1000):015d}-{os.getpid()}-live00").write_text("")
        id_ = "20260101000000-alice-missing"
        r = t.land("withdraw", id_, "--owner", "alice")
        assert r.returncode == 4 and "unknown id" in r.stderr, r.stdout + r.stderr
        assert not (_markers(t) / id_).exists()


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
        invalid = t.dir / "not-a-git-remote"
        invalid.mkdir()
        _git("remote", "set-url", "origin", str(invalid), cwd=t.dev)
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
