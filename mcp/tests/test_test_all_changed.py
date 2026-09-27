"""scripts/lib/changed.mjs: the path -> job mapping behind `test:all -- --changed [base]`.

WHY (2026-09-27). Main takes a push about every 2 minutes, so an agent re-running the full `--ui` gate before
every landing burns most of its time on suites the change could not possibly affect (CLAUDE.md's re-gate rule).
--changed narrows that, but only safely if every rule fails SAFE: an unmapped path, or a path this module does
not recognise, must select everything, never a guess that quietly skips a job. These tests pin that, plus the
one invariant mcp/tests/test_suite_registry.py's registration test cannot check on its own: every job that
exists can actually be reached by some rule here (see test_every_job_is_reachable_by_changed below).

An independent review of the first cut (d93f0f24) found two HIGHs, both about missed cross-directory readers
and edges, fixed here:
  - HIGH: the selector only mapped a changed path to jobs in the SAME tree. In fact about 40 mcp/tests files
    read app/ or webapp/mc/ sources (test_contract_generated, test_stage_mirror, test_suite_registry), and
    site/lib/data.mjs + facts.mjs read mcp/ data (weapons.json, sound_catalog.json, state.py) and
    webapp/mc/src/tokens.ts. The rules below now cross those edges too.
  - HIGH: right after `git merge origin/main`, `git merge-base HEAD origin/main` returns origin/main's own tip
    (an ancestor of the merge commit), so the default base silently omitted everything the merge just brought
    in. defaultBase() now uses HEAD's first parent when HEAD is itself a merge commit.
"""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from _skip import needs

REPO = Path(__file__).resolve().parents[2]
CHANGED_MOD = REPO / "scripts" / "lib" / "changed.mjs"
TEST_ALL = REPO / "scripts" / "test-all.mjs"
NODE = shutil.which("node")
GIT = shutil.which("git")


def _node(expr: str, cwd: Path = REPO):
    needs(NODE, "node")
    res = subprocess.run([NODE, "--input-type=module", "-e", expr], cwd=cwd,
                          capture_output=True, text=True, timeout=30)
    assert res.returncode == 0, res.stderr
    return res.stdout.strip()


def _select(paths: list[str]) -> dict:
    expr = f"import({json.dumps(CHANGED_MOD.as_uri())}).then(m => console.log(JSON.stringify(m.selectJobs({json.dumps(paths)}))))"
    return json.loads(_node(expr))


def _job_names() -> list[str]:
    needs(NODE, "node")
    res = subprocess.run([NODE, str(TEST_ALL), "--", "--ui", "--list"], cwd=REPO,
                          capture_output=True, text=True, timeout=30)
    assert res.returncode == 0, res.stderr
    return [n for n in res.stdout.split("\n") if n.strip()]


def _job_name_substrings() -> list[str]:
    return json.loads(_node(f"import({json.dumps(CHANGED_MOD.as_uri())}).then(m => console.log(JSON.stringify(m.JOB_NAME_SUBSTRINGS)))"))


def _default_base(root: Path) -> str:
    return _node(f"import({json.dumps(CHANGED_MOD.as_uri())}).then(m => console.log(m.defaultBase({json.dumps(str(root))})))", cwd=root)


def _changed_paths(root: Path, base: str) -> list[str]:
    expr = f"import({json.dumps(CHANGED_MOD.as_uri())}).then(m => console.log(JSON.stringify(m.changedPaths({json.dumps(str(root))}, {json.dumps(base)}))))"
    return json.loads(_node(expr, cwd=root))


def _selection_includes_ui_job(all_jobs, filters) -> bool:
    expr = f"import({json.dumps(CHANGED_MOD.as_uri())}).then(m => console.log(JSON.stringify(m.selectionIncludesUiJob({json.dumps(all_jobs)}, {json.dumps(filters)}))))"
    return json.loads(_node(expr))


# ---- path -> job edges --------------------------------------------------------------------------------------

def test_app_paths_select_app_site_mc_and_mcp():
    # HIGH fix: webapp/mc/test/medalicons-gen.test.ts reads app/src/hud/medalicons.js (needs mc-); about 40
    # mcp/tests files read app/ sources (needs mcp).
    r = _select(["app/src/hud/live.js"])
    assert set(r["filters"]) == {"app-", "site", "mc-", "mcp"}, r


def test_webapp_mc_paths_select_mc_mcp_and_site():
    # HIGH fix: mcp/tests reads webapp/mc/ (needs mcp); site/lib/facts.mjs reads webapp/mc/src/tokens.ts (needs site).
    r = _select(["webapp/mc/src/api/contract.gen.ts"])
    assert set(r["filters"]) == {"mc-", "mcp", "site"}, r


def test_mcp_paths_select_mcp_chaos_mc_and_site():
    # HIGH fix: site/lib/data.mjs + facts.mjs read mcp/ data files (weapons.json, sound_catalog.json, state.py).
    r = _select(["mcp/brx_mcp/mc/scoring.py"])
    assert set(r["filters"]) == {"mcp", "chaos", "mc-", "site"}, r


def test_contract_and_catalogue_sources_also_pull_in_app_screens():
    for p in ["mcp/brx_mcp/mc/types.py", "mcp/brx_mcp/mc/envelope.py",
              "mcp/tools/gen_contract.py", "mcp/tools/gen_ui_catalog.py",
              "mcp/brx_mcp/mc/weapons.json", "mcp/brx_mcp/mc/perks.json"]:
        r = _select([p])
        assert "app-screens" in r["filters"], (p, r)


def test_an_ordinary_mcp_file_does_not_pull_in_app_screens():
    r = _select(["mcp/brx_mcp/mc/scoring.py"])
    assert "app-screens" not in r["filters"]


def test_docs_and_markdown_select_mcp_and_site():
    assert set(_select(["docs/HANDOFF.md"])["filters"]) == {"mcp", "site"}
    # a markdown file under hardware/ matches BOTH the *.md rule and the hardware/** rule; still just mcp+site
    assert set(_select(["hardware/brx-companion-spec.md"])["filters"]) == {"mcp", "site"}


def test_hardware_non_markdown_selects_mcp():
    assert _select(["hardware/m5sticks3/firmware.cpp"])["filters"] == ["mcp"]


def test_scripts_lib_selects_mcp_its_own_unit_tests():
    assert _select(["scripts/lib/budget.mjs"])["filters"] == ["mcp"]


def test_test_all_itself_is_a_full_suite_trigger():
    assert _select(["scripts/test-all.mjs"])["filters"] is None


def test_a_ci_workflow_change_is_a_full_suite_trigger():
    assert _select([".github/workflows/ci.yml"])["filters"] is None


def test_an_unmapped_path_fails_safe_to_everything():
    assert _select(["a-brand-new-top-level-thing.txt"])["filters"] is None


def test_no_changed_paths_fails_safe_to_everything():
    assert _select([])["filters"] is None


def test_every_job_is_reachable_by_the_changed_selector():
    """A job whose name matches no substring in JOB_NAME_SUBSTRINGS can NEVER be picked by --changed: it would
    quietly stop running once a branch relies on the --changed re-gate instead of the full suite (CLAUDE.md)."""
    substrings = _job_name_substrings()
    unreachable = [n for n in _job_names() if not any(s in n for s in substrings)]
    assert not unreachable, (
        f"these jobs match none of scripts/lib/changed.mjs's JOB_NAME_SUBSTRINGS {substrings}, so --changed can "
        f"never select them: {unreachable}. Add a rule (and, if needed, a substring) that reaches them.")


# ---- selectionIncludesUiJob (MEDIUM(a): --changed must widen to --ui itself, since CI cannot) ----------------

def test_selection_including_a_ui_job_is_detected():
    all_jobs = [{"name": "mcp", "ui": False}, {"name": "app-screens", "ui": True}, {"name": "app-tsc", "ui": False}]
    assert _selection_includes_ui_job(all_jobs, ["app-"]) is True
    assert _selection_includes_ui_job(all_jobs, ["mcp"]) is False


def test_running_everything_counts_as_including_a_ui_job_when_one_exists():
    all_jobs = [{"name": "mcp", "ui": False}, {"name": "app-screens", "ui": True}]
    assert _selection_includes_ui_job(all_jobs, None) is True
    assert _selection_includes_ui_job([{"name": "mcp", "ui": False}], None) is False


# ---- defaultBase (HIGH: the post-merge merge-base bug) --------------------------------------------------------

def _git(*args, cwd):
    subprocess.run([GIT, *args], cwd=cwd, check=True, capture_output=True, text=True)


def _rev_parse(cwd, ref="HEAD") -> str:
    return subprocess.run([GIT, "rev-parse", ref], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def _temp_repo() -> Path:
    root = Path(tempfile.mkdtemp(prefix="brx-changed-test-"))
    _git("init", "-q", cwd=root)
    _git("config", "user.email", "t@example.com", cwd=root)
    _git("config", "user.name", "T", cwd=root)
    return root


def test_default_base_is_the_origin_main_merge_base_on_an_ordinary_commit():
    needs(GIT, "git")
    root = _temp_repo()
    (root / "f.txt").write_text("0")
    _git("add", "f.txt", cwd=root)
    _git("commit", "-q", "-m", "c0", cwd=root)
    c0 = _rev_parse(root)
    _git("update-ref", "refs/remotes/origin/main", c0, cwd=root)
    (root / "f.txt").write_text("1")
    _git("commit", "-a", "-q", "-m", "c1", cwd=root)
    assert _default_base(root) == c0


def test_default_base_is_head_first_parent_right_after_a_merge():
    """The bug: merge-base(HEAD, origin/main) right after `git merge origin/main` IS origin/main's tip (an
    ancestor of the merge commit), so it would silently omit everything the merge just brought in."""
    needs(GIT, "git")
    root = _temp_repo()
    (root / "f.txt").write_text("0")
    _git("add", "f.txt", cwd=root)
    _git("commit", "-q", "-m", "c0", cwd=root)
    c0 = _rev_parse(root)
    (root / "f.txt").write_text("1 (mine)")
    _git("commit", "-a", "-q", "-m", "c1", cwd=root)
    c1 = _rev_parse(root)
    # An independent commit that will play the role of origin/main's new tip.
    _git("checkout", "-q", "-b", "origin-side", c0, cwd=root)
    (root / "g.txt").write_text("origin's own change")
    _git("add", "g.txt", cwd=root)
    _git("commit", "-q", "-m", "c2", cwd=root)
    c2 = _rev_parse(root)
    _git("update-ref", "refs/remotes/origin/main", c2, cwd=root)
    _git("checkout", "-q", "-", cwd=root)   # back onto c1
    _git("merge", "--no-edit", "-q", "refs/remotes/origin/main", cwd=root)
    assert _default_base(root) == c1, "should be HEAD's first parent, not origin/main's own tip (c2)"
    assert _default_base(root) != c2


# ---- changedPaths (MEDIUM(b): untracked files; LOW: --no-renames) --------------------------------------------

def test_changed_paths_includes_tracked_and_untracked_files():
    needs(GIT, "git")
    root = _temp_repo()
    (root / "a.txt").write_text("orig")
    _git("add", "a.txt", cwd=root)
    _git("commit", "-q", "-m", "base", cwd=root)
    base = _rev_parse(root)
    (root / "a.txt").write_text("changed")           # tracked modification
    (root / "b.txt").write_text("brand new")         # untracked: git diff alone would never see this
    assert set(_changed_paths(root, base)) == {"a.txt", "b.txt"}


def test_changed_paths_shows_both_sides_of_a_rename():
    needs(GIT, "git")
    root = _temp_repo()
    (root / "d.txt").write_text("padding padding padding padding padding padding padding so a rename is detected")
    _git("add", "d.txt", cwd=root)
    _git("commit", "-q", "-m", "base", cwd=root)
    base = _rev_parse(root)
    _git("mv", "d.txt", "e.txt", cwd=root)
    # --no-renames: both the old (now-gone) and new path show up as plain entries, not a combined "R100 d -> e"
    # line that a naive path-prefix match on --name-only's default single-column output could parse wrong.
    assert set(_changed_paths(root, base)) == {"d.txt", "e.txt"}
