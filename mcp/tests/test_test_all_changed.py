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


def _union_filters(selected, named) -> list:
    expr = (f"import({json.dumps(CHANGED_MOD.as_uri())}).then("
            f"m => console.log(JSON.stringify(m.unionFilters({json.dumps(selected)}, {json.dumps(named)}))))")
    return json.loads(_node(expr))


# ---- path -> job edges --------------------------------------------------------------------------------------

def test_app_paths_select_app_site_mc_and_mcp():
    # HIGH fix: webapp/mc/test/medalicons-gen.test.ts reads app/src/hud/medalicons.js (needs mc-); about 40
    # mcp/tests files read app/ sources (needs mcp).
    r = _select(["app/src/hud/live.js"])
    assert set(r["filters"]) == {"app-", "site", "mc-vitest", "mcp"}, r


def test_app_paths_select_mc_vitest_without_selecting_mc_e2e_jobs():
    r = _select(["app/src/hud/medalicons.js"])
    assert "mc-vitest" in r["filters"], r
    assert "mc-" not in r["filters"], r


def test_mcp_paths_select_app_jobs_that_read_mcp_data():
    r = _select(["mcp/brx_mcp/mc/weapons.json"])
    assert {"app-e2e", "app-logsync", "app-test", "app-screens"} <= set(r["filters"]), r


def test_golden_bundle_changes_select_screens_and_moments():
    r = _select(["mcp/brx_mcp/mc/golden_bundle.json"])
    assert {"app-screens", "app-moments"} <= set(r["filters"]), r


def test_webapp_mc_changes_select_app_e2e_for_its_built_dist():
    r = _select(["webapp/mc/src/App.tsx"])
    assert "app-e2e" in r["filters"], r


def test_webapp_mc_paths_select_mc_mcp_and_site():
    # HIGH fix: mcp/tests reads webapp/mc/ (needs mcp); site/lib/facts.mjs reads webapp/mc/src/tokens.ts (needs site).
    r = _select(["webapp/mc/src/api/contract.gen.ts"])
    assert set(r["filters"]) == {"mc-", "mcp", "site", "app-e2e"}, r


def test_mcp_paths_select_mcp_chaos_mc_and_site():
    # HIGH fix: site/lib/data.mjs + facts.mjs read mcp/ data files (weapons.json, sound_catalog.json, state.py).
    r = _select(["mcp/brx_mcp/mc/scoring.py"])
    assert {"mcp", "chaos", "mc-", "site", "app-e2e", "app-logsync", "app-test"} == set(r["filters"]), r


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


def test_announcer_docs_select_app_test():
    assert "app-test" in _select(["docs/announcer.md"])["filters"]


def test_other_docs_do_not_select_app_test():
    assert "app-test" not in _select(["docs/HANDOFF.md"])["filters"]


def test_protocol_paths_select_mcp():
    assert _select(["protocol/messages.bin"])["filters"] == ["mcp"]


def test_root_markdown_keeps_markdown_rule():
    assert set(_select(["CLAUDE.md"])["filters"]) == {"mcp", "site"}


def test_root_build_manifests_select_everything():
    for path in ["package.json", "pnpm-lock.yaml"]:
        r = _select([path])
        assert r["filters"] is None, r
        assert any("full-suite trigger" in reason for reason in r["reasons"]), r


def test_unknown_top_level_directory_selects_mcp_for_repo_wide_hygiene():
    r = _select(["proofshot-artifacts/result.png"])
    assert r["filters"] == ["mcp"], r
    assert any("unknown top-level directory -> mcp" in reason for reason in r["reasons"]), r


def test_proofshot_artifacts_are_ignored():
    assert "proofshot-artifacts/" in (REPO / ".gitignore").read_text()


def test_known_tree_without_path_rule_fails_safe():
    assert _select(["webapp/unclassified-area/file.bin"])["filters"] is None


def test_hardware_non_markdown_selects_mcp():
    assert _select(["hardware/m5sticks3/firmware.cpp"])["filters"] == ["mcp"]


def test_scripts_lib_selects_mcp_its_own_unit_tests():
    for path in ["scripts/lib/budget.mjs", "scripts/lib/lock.mjs", "scripts/lib/pool.mjs"]:
        r = _select([path])
        assert r["filters"] is None, r
        assert any("full-suite trigger" in reason for reason in r["reasons"]), r


def test_test_all_itself_is_a_full_suite_trigger():
    assert _select(["scripts/test-all.mjs"])["filters"] is None


def test_a_ci_workflow_change_is_a_full_suite_trigger():
    assert _select([".github/workflows/ci.yml"])["filters"] is None


def test_an_unmapped_path_fails_safe_to_everything():
    assert _select(["brand-new-tree/file.txt"])["filters"] == ["mcp"]


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


# ---- unionFilters (2026-09-27 fix: named job filters ADD to --changed's pick, never replace it) --------------

def test_named_jobs_add_to_a_diff_selection():
    assert sorted(_union_filters(["mcp"], ["site"])) == ["mcp", "site"]


def test_named_jobs_do_not_duplicate_an_already_selected_job():
    assert sorted(_union_filters(["mcp", "site"], ["site"])) == ["mcp", "site"]


def test_the_trap_named_jobs_do_not_narrow_a_fail_safe_everything_selection():
    """The bug (2026-09-27): `node scripts/test-all.mjs -- --changed <sha> --ui mcp site` treated `mcp site` as a
    filter that REPLACED --changed's fail-safe "everything" pick, so it silently ran only mcp and site. A null
    `selected` (test-all.mjs's own "run everything") must stay "everything" -- an empty filter list, since
    test-all.mjs's selectFiltered() treats an empty list as "no narrowing" -- no matter what was typed by hand."""
    assert _union_filters(None, ["mcp", "site"]) == []


def test_no_named_jobs_leaves_a_diff_selection_untouched():
    assert sorted(_union_filters(["mcp", "chaos"], [])) == ["chaos", "mcp"]


def test_no_named_jobs_and_no_diff_selection_is_still_everything():
    assert _union_filters(None, []) == []


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


def _docs_only(paths: list[str]) -> bool:
    expr = f"import({json.dumps(CHANGED_MOD.as_uri())}).then(m => console.log(JSON.stringify(m.isDocsOnly({json.dumps(paths)}))))"
    return json.loads(_node(expr))


def test_is_docs_only_means_docs_or_root_markdown_and_nothing_else():
    assert _docs_only(["docs/FOLLOWUPS.md", "docs/manual/sounds.md", "CLAUDE.md"])
    assert not _docs_only([])
    assert not _docs_only(["docs/a.md", "scripts/land.mjs"])
    assert not _docs_only(["mcp/brx_mcp/mc/API.md"])          # Markdown inside a code tree is not docs-only
    assert not _docs_only([".claude/skills/x/SKILL.md"])


# The jobs that read docs/ at run time, found from the sources, not from a hand list (brx1, 2026-10-10): the
# lander gates a docs-only candidate with --changed, so a reader that selectJobs misses would let a broken page or
# FOLLOWUPS row land green. A line counts as a read when it names a docs/ path and does file I/O on it.
_READ = __import__("re").compile(r"(readFileSync|readFile|readdirSync|existsSync|new URL\(|path\.(?:resolve|join)\(|open\()")
_DOCS_PATH = __import__("re").compile(r"docs/[A-Za-z0-9_./-]+")
_OWNERS = [   # (source prefix, the test-all job that runs it)
    ("app/test/", "app-test"), ("app/tools/screens", "app-screens"), ("app/tools/moments", "app-moments"),
    ("app/tools/e2e", "app-e2e"), ("app/tools/logsync", "app-logsync"), ("app/src/", "app-test"),
    ("webapp/mc/test/e2e/", "mc-"), ("webapp/mc/", "mc-vitest"), ("site/", "site"),
    ("mcp/", "mcp"), ("scripts/", "mcp"),
]


def test_every_source_that_reads_docs_is_selected_for_a_docs_change():
    needs(GIT, "git")
    files = subprocess.run([GIT, "ls-files", "app", "webapp/mc", "site", "scripts", "mcp/tests", "mcp/tools"],
                           cwd=REPO, capture_output=True, text=True, check=True).stdout.split()
    misses, readers = [], 0
    for f in files:
        if not f.endswith((".mjs", ".js", ".ts", ".tsx", ".py")) or "/node_modules/" in f or f.endswith(".gen.ts"):
            continue
        try:
            lines = (REPO / f).read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeDecodeError):
            continue
        for line in lines:
            stripped = line.strip()
            if stripped.startswith(("//", "*", "/*", "#")) or not _READ.search(line):
                continue
            for doc in _DOCS_PATH.findall(line):
                owner = next((job for prefix, job in _OWNERS if f.startswith(prefix)), None)
                assert owner, f"{f} reads {doc} but no test-all job owns it: add it to _OWNERS"
                readers += 1
                picked = _select([doc])["filters"]
                if picked is not None and not any(owner.startswith(s) or s.startswith(owner) or s in owner for s in picked):
                    misses.append(f"{f} reads {doc}, but a change to it selects {picked}, not {owner}")
    assert readers >= 2, "the scan found almost no docs readers: the patterns above are broken"
    assert not misses, "\n".join(misses)
