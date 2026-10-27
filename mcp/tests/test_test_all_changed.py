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

from _node import run_node, run_node_json
from _skip import needs

REPO = Path(__file__).resolve().parents[2]
CHANGED_MOD = REPO / "scripts" / "lib" / "changed.mjs"
TEST_ALL = REPO / "scripts" / "test-all.mjs"
NODE = shutil.which("node")
GIT = shutil.which("git")


def _node(expr: str, cwd: Path = REPO):
    return run_node(expr, cwd=cwd)


def _select(paths: list[str]) -> dict:
    expr = f"import({json.dumps(CHANGED_MOD.as_uri())}).then(m => console.log(JSON.stringify(m.selectJobs({json.dumps(paths)}))))"
    return json.loads(_node(expr))


def _shots_only(paths: list[str]) -> bool:
    expr = f"import({json.dumps(CHANGED_MOD.as_uri())}).then(m => console.log(JSON.stringify(m.isShotsOnly({json.dumps(paths)}))))"
    return json.loads(_node(expr))


def _job_names() -> list[str]:
    needs(NODE, "node")
    res = subprocess.run([NODE, str(TEST_ALL), "--", "--ui", "--list"], cwd=REPO,
                          capture_output=True, text=True, timeout=30)
    assert res.returncode == 0, res.stderr
    return [n for n in res.stdout.split("\n") if n.strip()]


def _groups() -> dict:
    """run_tests.py's GROUPS, read from the source (importing run_tests would set BRX_MCP_HOME for this process)."""
    import ast
    import re
    src = (REPO / "mcp" / "run_tests.py").read_text()
    return ast.literal_eval(re.search(r"^GROUPS = (\{.*?\n\})", src, re.M | re.S).group(1))


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
    # the jobs that run a real MC read it at runtime; app-screens reads it only through demo-catalog.js (generated)
    r = _select(["mcp/brx_mcp/mc/weapons.json"])
    assert {"app-e2e", "app-logsync", "app-test"} <= set(r["filters"]), r


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


def test_generator_fed_sources_select_mcp_not_app_screens_and_the_bundled_demo_still_does():
    # Candidate 14 (2026-10-11): types.py, envelope.py, the generators and the catalogue reach the app only through a
    # generated file. Its regenerated output is in the diff and selects its readers; a forgotten regeneration fails
    # mcp's staleness test. golden_bundle.json is read by the app directly (app/src/demo.js).
    for p in ["mcp/brx_mcp/mc/types.py", "mcp/brx_mcp/mc/envelope.py", "mcp/tools/gen_contract.py",
              "mcp/tools/gen_ui_catalog.py", "mcp/brx_mcp/mc/weapons.json", "mcp/brx_mcp/mc/perks.json"]:
        r = _select([p])
        assert "mcp" in r["filters"] and "app-screens" not in r["filters"], (p, r)
    r = _select(["mcp/brx_mcp/mc/golden_bundle.json"])
    assert {"app-screens", "app-moments"} <= set(r["filters"]), r
    r = _select(["app/src/transport/contract.gen.js"])   # a regenerated output selects its readers
    assert "app-" in r["filters"], r
    # Pinned, so widening or shrinking the one direct read shows up in review (Opus).
    got = json.loads(_node(f"import({json.dumps(CHANGED_MOD.as_uri())}).then(m => console.log(JSON.stringify([...m.SCREENS_SENSITIVE])))"))
    assert got == ["mcp/brx_mcp/mc/golden_bundle.json"], got


def test_every_registered_source_and_output_selects_mcp_docs_and_names_its_generator():
    # F626: the staleness test (test_generated_fresh) runs in mcp-docs, so the rule selects mcp-docs. A source in a code
    # tree also selects all of mcp through its tree's rule.
    registry = json.loads((REPO / "scripts" / "generated.json").read_text())
    assert registry["generators"], "the registry is empty"
    assert "test_generated_fresh" in _groups()["docs"]
    for g in registry["generators"]:
        for glob in g["sources"] + g["outputs"]:
            probe = glob.replace("*", "zz")
            r = _select([probe])
            assert _covers(r["filters"], "mcp-docs"), (g["name"], probe, r)
            assert any("scripts/generated.json" in why and g["name"] in why for why in r["reasons"]), (g["name"], probe, r)


def test_an_ordinary_mcp_file_does_not_pull_in_app_screens():
    r = _select(["mcp/brx_mcp/mc/scoring.py"])
    assert "app-screens" not in r["filters"]


def test_docs_and_markdown_select_mcp_docs_and_site():
    assert set(_select(["docs/HANDOFF.md"])["filters"]) == {"mcp-docs", "site"}
    # a markdown file under hardware/ matches BOTH the *.md rule and the hardware/** rule (the Stick host tests in mcp)
    assert set(_select(["hardware/brx-companion-spec.md"])["filters"]) == {"mcp", "site"}


def _jobs_picked(paths: list[str]) -> set:
    picked = _select(paths)["filters"]
    return set(_job_names()) if picked is None else {n for n in _job_names() if any(f in n for f in picked)}


def test_a_docs_only_change_runs_mcp_docs_not_all_of_mcp():
    """F626: a docs-only land ran the whole mcp job (300 s in a gate) and timed out twice under load. A docs page that
    no mcp or mcp-sim test reads now runs mcp-docs and site only."""
    for paths in (["docs/HANDOFF.md"], ["docs/FOLLOWUPS.md"], ["docs/experiment-log/2026-10.md", "CLAUDE.md"],
                  ["docs/manual/index.md", "docs/platform/index.md"], ["protocol/brx-protocol.md"],
                  [".claude/skills/bench-session/SKILL.md"], [".github/ISSUE_TEMPLATE/bug_report.yml"]):
        jobs = _jobs_picked(paths)
        assert "mcp-docs" in jobs and not {"mcp-core", "mcp-sim"} & jobs, (paths, sorted(jobs))


def test_the_pages_an_mcp_test_reads_still_select_it():
    """Pinned from a trace of every file the suite opened (2026-10-26), apart from MCP_DOCS_READERS, so a dropped entry
    fails here as well as in the source scan below."""
    for path, job in [("docs/spec/contracts.md", "mcp-core"), ("docs/spec/utility.md", "mcp-core"),
                      ("docs/weapon-design.md", "mcp-core"), ("docs/platform/install.md", "mcp-core"),
                      ("docs/platform/run.md", "mcp-core"), ("docs/mac-dev-runbook.md", "mcp-core"),
                      ("docs/reference/sound-catalog.md", "mcp-core"),
                      ("protocol/captures/2026-08-23-solo-game-full-arm.txt", "mcp-core"),
                      (".claude/skills/balance-review/SKILL.md", "mcp-sim"),
                      # test_build_state_in_checkout reads every tracked tsconfig and Vite config (Opus, F626 review)
                      ("docs/tools/tsconfig.json", "mcp-core"), ("protocol/vite.config.ts", "mcp-core")]:
        jobs = _jobs_picked([path])
        assert {job, "mcp-docs"} <= jobs, (path, sorted(jobs))
    assert _jobs_picked(["docs/spec/contracts.md"]) & {"mcp-sim"} == set()   # the one job that reads it, not all three
    assert "mcp-core" not in _jobs_picked([".claude/skills/balance-review/SKILL.md"])
    readers = json.loads(_node(f"import({json.dumps(CHANGED_MOD.as_uri())}).then(m => console.log(JSON.stringify(m.MCP_DOCS_READERS)))"))
    assert [r["path"] for r in readers] == [
        "docs/spec/contracts.md", "docs/spec/utility.md", "docs/weapon-design.md", "docs/platform/install.md",
        "docs/platform/run.md", "docs/mac-dev-runbook.md", "docs/reference/sound-catalog.md", "protocol/captures/",
        ".claude/skills/balance-review/", "tsconfig or Vite config"], readers


def test_announcer_docs_select_app_test():
    assert "app-test" in _select(["docs/announcer.md"])["filters"]


def test_other_docs_do_not_select_app_test():
    assert "app-test" not in _select(["docs/HANDOFF.md"])["filters"]


def test_protocol_paths_select_mcp_docs():
    assert _select(["protocol/messages.bin"])["filters"] == ["mcp-docs"]
    assert set(_select(["protocol/captures/x.txt"])["filters"]) == {"mcp-core", "mcp-docs"}   # test_mc_compile replays them


def test_root_markdown_keeps_markdown_rule():
    assert set(_select(["CLAUDE.md"])["filters"]) == {"mcp-docs", "site"}


def test_a_root_file_that_is_not_markdown_selects_all_of_mcp():
    # test_launcher reads start.sh, test_append_only_logs_merge .gitattributes, this file .gitignore
    assert _select(["start.sh"])["filters"] == ["mcp"]


def test_root_build_manifests_select_everything():
    for path in ["package.json", "pnpm-lock.yaml"]:
        r = _select([path])
        assert r["filters"] is None, r
        assert any("full-suite trigger" in reason for reason in r["reasons"]), r


def test_unknown_top_level_directory_selects_every_python_job():
    # docs hygiene (mcp-docs) and test_build_state_in_checkout (mcp-core) scan the whole repo (Opus, F626 review)
    r = _select(["proofshot-artifacts/result.png"])
    assert r["filters"] == ["mcp"], r
    assert any("unknown top-level directory -> mcp" in reason for reason in r["reasons"]), r


def test_proofshot_artifacts_are_ignored():
    assert "proofshot-artifacts/" in (REPO / ".gitignore").read_text()


def test_known_tree_without_path_rule_fails_safe():
    assert _select(["webapp/unclassified-area/file.bin"])["filters"] is None


def test_shots_select_site_and_only_shots_allow_narrow_regate():
    shots = ["site/shots/a.jpg", "site/shots/manifest.json"]
    assert sorted(_select(shots)["filters"]) == ["mcp", "site"]   # test_site_shots.py (mcp) reads them too
    assert sorted(_select(["site/shots/notes.md"])["filters"]) == ["mcp", "site"]
    assert _shots_only(shots)
    assert not _shots_only([])
    assert not _shots_only(["site/shots/a.jpg", "src/code.js"])
    assert not _shots_only(["site/shots-old/a.jpg"])


def test_hardware_non_markdown_selects_mcp():
    assert _select(["hardware/m5sticks3/firmware.cpp"])["filters"] == ["mcp"]


def test_scripts_lib_selects_mcp_its_own_unit_tests():
    for path in ["scripts/lib/jobs.mjs", "scripts/lib/budget.mjs", "scripts/lib/scheduler.mjs", "scripts/lib/test-all-cli.mjs", "scripts/lib/gate-record.mjs", "scripts/lib/report.mjs", "scripts/lib/job-runner.mjs", "scripts/lib/screens-raise.mjs", "scripts/lib/cache-plan.mjs", "scripts/lib/lock.mjs", "scripts/lib/pool.mjs"]:
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
# FOLLOWUPS row land green. A line counts as a read when it names a repo docs/ path (not a site URL) AND does file I/O
# or imports it; a docs DIRECTORY held in a constant and joined later (site/build.mjs `DOCS`, a Python `REPO / "docs"`)
# counts as reading the whole tree. Reviewed by Codex and Opus (2026-10-10). F626 adds a literal pass for the
# mcp-core and mcp-sim test files (_LITERAL_DOC below). It is still a static check: a path built at run time can slip
# past it, which is why the pages a trace found are also pinned in test_the_pages_an_mcp_test_reads_still_select_it.
import re as _re
_READ = _re.compile(r"(readFileSync|readFile|readdirSync|existsSync|new URL\(|path\.(?:resolve|join)\(|\bopen\(|"
                    r"read_text|read_bytes|\.r?glob\(|^\s*import\b|\bimport\(|\brequire\()")
_DOCS_PATH = _re.compile(r"""(?:^|[\s'"`(=])(?:\.\./)*(docs/[A-Za-z0-9_./-]+)""")   # relative or repo-anchored only
_DOCS_DIR = _re.compile(r"""(?:path\.(?:resolve|join)\([^)]*|new URL\()['"](?:\.\./)*docs/?['"]|/\s*['"]docs['"]|Path\([^)]*['"]docs['"]""")
# F626: a Python join down to one file (`REPO / "docs" / "spec" / "contracts.md"`) reads that file, not the tree. A join
# that goes on with a variable (`REPO / "docs" / name`) still counts as the whole tree.
_DOCS_JOIN = _re.compile(r"""/\s*['"]docs['"]((?:\s*/\s*['"][\w.-]+['"])+)(?!\s*/)""")
_PY = ("mcp-core", "mcp-docs", "mcp-sim")   # the three jobs of run_tests.py (F626); test files are owned by their GROUPS
_MC_JOBS = (*_PY, "mc-play", "app-e2e", "app-logsync")   # jobs that start Mission Control code ("mc-play" stands for the mc-* e2e family)
# Lines the scan below reads as a docs read that are not one against the real repo, by (source, exact stripped line
# text), so a later real read on another line is still caught (Opus, F626 review). A trace of every file the mcp suite
# opened (2026-10-26) saw none of them read a real docs path. A line no scan finds fails the test, so none goes stale.
_NOT_A_GATE_READ = {   # source: (why, the lines)
    "scripts/land.mjs": ("test_land runs land.mjs only in throwaway repositories",
        ["if (merged.length > 0 && fs.existsSync(path.join(WT, 'docs/FOLLOWUPS.md')) &&",
         "const file = path.join(WT, 'docs/FOLLOWUPS.md');"]),
    "mcp/tools/balance_review.py": (
        "only the CLI's --record writes the decision log; test_balance_review passes record() a temporary path",
        ['DECISIONS = REPO / "docs" / "balance-decisions.md"']),
    "mcp/tests/test_land.py": ("every docs path it names is in a throwaway seed, dev or gate repository", [
        'if ((wt / "BUILDFLAKE").exists() or (wt / "docs" / "BUILDFLAKE").exists()) and not (d / "buildflaked").exists():',
        '(t.dev / "docs").mkdir()', '(seed / "docs").mkdir()', '(seed / "docs").mkdir(exist_ok=True)',
        '(seed / "docs" / "FOLLOWUPS.md").write_text(source)', '(seed / "docs" / "FOLLOWUPS.md").write_text(text)',
        '(seed / "docs" / "FOLLOWUPS.md").write_text(source.replace(',
        '(t.dev / "docs" / "FOLLOWUPS.md").write_text(source.replace(']),
    "mcp/tests/test_append_only_logs_merge.py": ("it writes these logs in a throwaway repository",
        ['LOGS = ["docs/archive/followups-closed.md", "docs/experiment-log/2026-10.md"]']),
    "mcp/tests/test_balance_sim.py": ("failure messages that name the Balance rules table", [
        '"(needs >= 65%). See docs/weapon-design.md\'s Balance rules table, row 4 (F291)."',
        '"65%). See docs/weapon-design.md\'s Balance rules table, row 4 (F291)."',
        '"See docs/weapon-design.md\'s Balance rules table, row 10 (F308)."',
        '"docs/weapon-design.md\'s Balance rules table (F308)."',
        '"docs/weapon-design.md\'s Balance rules table, row 4 (F291)."',
        'f"{r.win_rate:.1%} of {reps} duels (needs >= 65%). See docs/weapon-design.md\'s "']),
    "mcp/tests/test_derived_data.py": ("a failure message", ['"counts published in docs/manual/sounds.md in the same commit"']),
    "mcp/tests/test_gset_t2_pinned.py": ("a failure message", ['"See docs/archive/HANDOFF-gset-t2-2026-09-13.md"']),
    "mcp/tests/test_sticks3_core.py": ("the Stick core's own README, not the root one",
        ['readme = (CORE / "README.md").read_text(encoding="utf-8")']),
    "mcp/tests/test_test_all_no_skip.py": ("sample changed paths for noSkipFor", [
        'assert "pyright" in _skips(_no_skip(foundVenv=True, changedPaths=["docs/x.md", p])), p',
        'assert "pyright" in _skips(_no_skip(foundVenv=True, landGate=True, changedPaths=["docs/x.md"]))']),
    "mcp/tests/test_test_inputs_declared.py": ("sample sources for its comment stripper", [
        'js = _code_only(pathlib.Path("x.mjs"), "/* see \'docs/a.md\' */\\n// \'app/src/b.js\'\\nconst u = \'http://x\';\\nread(\'mcp/c.json\');")',
        'py = _code_only(pathlib.Path("x.py"), \'"""Reads `docs/a.md`."""\\n# \\\'app/b.js\\\'\\nopen("mcp/c.json")\\n\')']),
}
# Files whose string literals name docs paths only for throwaway repositories or as samples. The literal pass skips
# them; the read patterns above still apply, line by line.
_LITERAL_PASS_SKIPS = {
    "mcp/tests/test_land.py": "it builds every FOLLOWUPS file and docs page in a throwaway repository",
}
# This file holds the scanner, its sample lines and the tables above, which quote the lines they exempt. The trace
# saw it read no docs file, so the scan skips it whole.
_SCAN_SKIPS = {"mcp/tests/test_test_all_changed.py"}
_OWNERS = [   # (source prefix, the test-all jobs that run it); the first match wins
    ("mcp/tests/test_chaos", ("chaos",)), ("mcp/brx_mcp/chaos/", ("chaos",)),   # run_tests.py --exclude chaos
    ("mcp/brx_mcp/", _MC_JOBS),
    # regen --check (test_generated_fresh) and test_docs_hygiene run it on the real repo; test_land on throwaway ones
    ("scripts/followups-index.mjs", ("mcp-docs",)),
    ("mcp/tools/soundbank_community.py", ("mcp-core",)),   # imported by test_regen_runner and test_sound_catalog only
    ("app/test/", ("app-test",)), ("app/tools/screens", ("app-screens",)), ("app/tools/moments", ("app-moments",)),
    ("app/tools/e2e", ("app-e2e",)), ("app/tools/logsync", ("app-logsync",)),
    ("app/src/", ("app-test", "app-screens", "app-moments", "app-e2e")),   # bundled into every app gate
    ("webapp/mc/test/e2e/", ("mc-play",)), ("webapp/mc/", ("mc-vitest", "mc-play")), ("site/", ("site",)),
    ("mcp/", _PY), ("scripts/", _PY),
]


def _owners_of(f: str, groups: dict):
    """The jobs that run source `f`: an mcp test file runs in the job of its GROUPS entry (F626), else _OWNERS."""
    stem = f.rsplit("/", 1)[-1].removesuffix(".py")
    if f.startswith("mcp/tests/test_") and not f.startswith("mcp/tests/test_chaos"):
        return ("mcp-docs",) if stem in groups["docs"] else ("mcp-sim",) if stem in groups["sim"] else ("mcp-core",)
    return next((jobs for prefix, jobs in _OWNERS if f.startswith(prefix)), None)


def _covers(picked, job: str) -> bool:
    """test-all runs a job when its name INCLUDES a filter (filters.some(f => name.includes(f)))."""
    return picked is None or any(s in job for s in picked)


def _code_part(line: str) -> str:
    """The line up to a trailing ` // ` or ` # ` comment that sits OUTSIDE any quotes (a string may hold either)."""
    quote = None
    for i, ch in enumerate(line):
        if quote:
            if ch == quote and line[i - 1] != "\\":
                quote = None
        elif ch in "'\"`":
            quote = ch
        elif line.startswith((" // ", " # "), i):
            return line[:i]
    return line


# F626 (Opus): in an mcp-core or mcp-sim test file a docs path held in a constant is read on another line (a tuple of
# pages, then a loop that opens each), so there any "docs/..." string, and any root Markdown name that isDocsOnly
# admits, counts as a read. Docstrings and comments do not; a message that only names a page is exempted by its line.
_LITERAL_DOC = _re.compile(r"(?<![\w/.-])(docs/[\w./-]*\w)")


def _root_markdown() -> list[str]:
    out = subprocess.run([GIT, "ls-files", "*.md"], cwd=REPO, capture_output=True, text=True, check=True).stdout.split()
    return sorted(f for f in out if "/" not in f)


def _docstring_lines(text: str) -> set:
    import ast
    drop = set()
    for node in ast.walk(ast.parse(text)):
        body = getattr(node, "body", None)
        if isinstance(body, list) and body and isinstance(body[0], ast.Expr) \
                and isinstance(getattr(body[0], "value", None), ast.Constant) and isinstance(body[0].value.value, str):
            drop.update(range(body[0].lineno, body[0].end_lineno + 1))
    return drop


def _docs_reads(f: str, text: str, literal: bool, root_md) -> list:
    """(stripped line, docs path) for every docs read the patterns see in source `f`."""
    lines = text.splitlines()
    skip = _docstring_lines(text) if literal else set()
    out = []
    for n, raw in enumerate(lines, 1):
        if n in skip or raw.strip().startswith(("//", "*", "/*", "#")):
            continue
        line = _code_part(raw)   # a trailing comment naming a doc is not a read
        found = _DOCS_PATH.findall(line) if _READ.search(line) else []   # '/docs/...' site URLs never match
        for segs in _DOCS_JOIN.findall(line):
            found.append("docs/" + "/".join(_re.findall(r"""['"]([\w.-]+)['"]""", segs)))
        if _DOCS_DIR.search(_DOCS_JOIN.sub("", line)):
            found.append("docs/any-page.md")   # the whole tree
        if literal:
            found += _LITERAL_DOC.findall(line)
            found += [md for md in root_md if _re.search(r"(?<![\w/.-])" + _re.escape(md) + r"(?![\w-])", line)]
        out += [(raw.strip(), doc) for doc in dict.fromkeys(found)]
    return out


def test_every_source_that_reads_docs_is_selected_for_a_docs_change():
    needs(GIT, "git")
    files = subprocess.run([GIT, "ls-files", "app", "webapp/mc", "site", "scripts", "mcp/tests", "mcp/tools",
                            "mcp/brx_mcp"], cwd=REPO, capture_output=True, text=True, check=True).stdout.split()
    misses, readers, dir_readers, literal_files, exempt = [], 0, 0, 0, set()
    groups, root_md = _groups(), _root_markdown()
    assert {"README.md", "CLAUDE.md", "CONTRIBUTING.md"} <= set(root_md), root_md
    for f in files:
        if not f.endswith((".mjs", ".js", ".ts", ".tsx", ".py")) or "/node_modules/" in f or ".gen." in f \
                or f in _SCAN_SKIPS:
            continue
        try:
            text = (REPO / f).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        owners = _owners_of(f, groups)
        literal = f.startswith("mcp/tests/test_") and owners in (("mcp-core",), ("mcp-sim",)) and f not in _LITERAL_PASS_SKIPS
        literal_files += literal
        for line, doc in _docs_reads(f, text, literal, root_md):
            if line in _NOT_A_GATE_READ.get(f, ("", []))[1]:
                exempt.add((f, line))
                continue
            assert owners, f"{f} reads {doc} but no test-all job owns it: add it to _OWNERS"
            readers += 1
            dir_readers += doc == "docs/any-page.md"
            picked = _select([doc])["filters"]
            for job in owners:
                if not _covers(picked, job):
                    misses.append(f"{f} reads {doc} ({line!r}), but a change to it selects {picked}, not {job}")
    assert dir_readers >= 1, "the docs-directory pattern found no reader: site/build.mjs's DOCS should match"
    assert literal_files >= 100, literal_files   # the literal pass reaches the mcp-core and mcp-sim test files
    listed = {(f, line) for f, (_, lines) in _NOT_A_GATE_READ.items() for line in lines}
    assert exempt == listed, f"stale _NOT_A_GATE_READ lines: {sorted(listed - exempt)}"
    assert readers >= 2, "the scan found almost no docs readers: the patterns above are broken"
    assert not misses, "\n".join(sorted(set(misses)))


def test_the_docs_reader_patterns_catch_reads_and_skip_urls_and_comments():
    import types
    mod = types.SimpleNamespace(**{k: globals()[k] for k in ("_READ", "_DOCS_PATH", "_DOCS_DIR", "_code_part")})
    reads = ["const t = readFileSync('docs/FOLLOWUPS.md', 'utf8')",
             "console.log('ready // now', readFileSync('docs/FOLLOWUPS.md'))",
             "x = readFileSync('docs/a.md').replace('https://example.com', '')",
             "text = (REPO / \"docs\" / \"a.md\").read_text()", "DOCS = Path(REPO, \"docs\")",
             "import md from '../../docs/x.md?raw'"]
    for line in reads:
        code = mod._code_part(line)
        assert (mod._READ.search(code) and mod._DOCS_PATH.findall(code)) or mod._DOCS_DIR.search(code), line
    for line in ["fetch(new URL('/docs/run-a-game', SITE))", "import { a } from './b.js';   // docs/spec/x.md"]:
        code = mod._code_part(line)
        assert not (mod._READ.search(code) and mod._DOCS_PATH.findall(code)) and not mod._DOCS_DIR.search(code), line
    assert not _covers(["mc-vitest"], "mc-play") and _covers(["mc-"], "mc-play") and _covers(None, "x")
    # F626: a join down to one file names that file; a join that goes on with a variable is the whole tree
    one = 'CONTRACTS = REPO / "docs" / "spec" / "contracts.md"'
    assert ["/".join(_re.findall(r"""['"]([\w.-]+)['"]""", g)) for g in _DOCS_JOIN.findall(one)] == ["spec/contracts.md"]
    assert not _DOCS_DIR.search(_DOCS_JOIN.sub("", one))
    tree = 'text = (REPO / "docs" / name).read_text()'
    assert not _DOCS_JOIN.findall(tree) and _DOCS_DIR.search(_DOCS_JOIN.sub("", tree))


_TOPS = ["app/", "webapp/", "mcp/", "site/", "docs/", "protocol/", "hardware/", "scripts/", ".github/", ".claude/", "unknown/"]


def test_every_declared_input_selects_its_job_or_is_a_written_narrowing():
    """DRY review #2 (2026-10-10): changed.mjs and inputs.mjs each said which job reads which tree, and they disagreed,
    so `--changed` after a case-file change skipped mc-tsc. The job registry's inputs (jobs.mjs) are the one statement; a narrower selection must
    be in changed.mjs NARROWED, whose reason names why skipping is safe (the lander's full gate)."""
    inputs_mod = REPO / "scripts" / "lib" / "jobs.mjs"
    expr = (f"Promise.all([import({json.dumps(CHANGED_MOD.as_uri())}), import({json.dumps(inputs_mod.as_uri())})])"
            ".then(([c, i]) => { const out = { gaps: [], why: c.NARROWED.map(n => n.why), used: c.NARROWED.map(() => []) };"
            # F626: `.` (the whole repo) is probed as a root file and as each top-level tree, keyed by the tree, so a
            # job that reads `.` but skips docs/ needs a NARROWED entry for docs/. `unknown/` is a tree nobody knows.
            f" const tops = {json.dumps(_TOPS)};"
            " for (const job of i.JOB_NAMES) for (const input of i.inputsForJob(job))"
            " for (const [probe, e] of input === '.' ? [['zz-probe.txt', '.'], ...tops.map(t => [t + 'zz-probe.txt', t])]"
            "   : [[input.endsWith('/') ? input + 'zz-probe.txt' : input, input]]) {"
            "  const f = c.selectJobs([probe]).filters;"
            "  if (!f || f.some(x => job.includes(x))) continue;"
            "  const k = c.narrowedBy(job, e); if (k < 0) out.gaps.push(`${job} reads ${e}`);"
            "  else if (!out.used[k].includes(e)) out.used[k].push(e); }"
            " out.used = out.used.map(u => u.sort()); console.log(JSON.stringify(out)); })")
    got = json.loads(_node(expr))
    assert not got["gaps"], ("--changed would skip a job for a path it reads; add the rule to changed.mjs, or a "
                             "NARROWED entry that says why skipping is safe:\n  " + "\n  ".join(got["gaps"]))
    assert got["why"] and all("lander" in w for w in got["why"]), got["why"]
    # What each entry excuses, pinned: a new or wider entry changes this list, so it cannot slip in unreviewed.
    assert got["used"] == [
        [".claude/", ".github/", "app/", "app/package-lock.json", "app/package.json", "docs/", "hardware/", "protocol/",
         "scripts/", "scripts/lib/", "webapp/mc/package-lock.json", "webapp/mc/package.json"],   # chaos
        ["mcp/"],                                                                                 # app-screens, app-moments
        [".claude/", ".github/", "docs/", "protocol/"],                                           # mcp-core, mcp-sim (F626)
        ["scripts/lib/"],                                                                         # every other job
    ], got["used"]
    # Readers pinned independently of the registry, so dropping a declared input cannot drop its check.
    for case in ("honors", "policy", "age-format", "config-pick"):
        f = _select([f"app/test/fixtures/{case}-cases.json"])["filters"]
        assert "mc-vitest" in f and "mc-tsc" in f, (case, f)   # webapp/mc/test/*-cases.test.ts read them


# An import of a scripts/lib file (a comment or a log line that names one is not a reader), and a local import, including a
# side-effect `import './x.mjs'`.
_LIB_REF = _re.compile(r"""(?:from\s*|import\s*\(?\s*)['"](?:\.\.?/)+scripts/lib/([\w.-]+\.mjs)['"]""")
_LOCAL_IMPORT = _re.compile(r"""(?:from\s*|import\s*\(?\s*)['"](\.\.?/[^'"]+)['"]""")


def _npm_files(cwd: Path, script: str, seen=None) -> list:
    """The .mjs files an `npm run <script>` in `cwd` runs, following nested `npm run`s (app-test runs screens.mjs)."""
    seen = set() if seen is None else seen
    if script in seen:
        return []
    seen.add(script)
    text = json.loads((cwd / "package.json").read_text())["scripts"][script]
    files = []
    for nested in _re.findall(r"npm run ([\w:.-]+)", text):
        files += _npm_files(cwd, nested, seen)
    for token in _re.findall(r"[\w./*-]+\.mjs", text):
        files += sorted(cwd.glob(token))
    return files


def _lib_readers() -> dict:
    """{scripts/lib file: {job}} for every gate that imports a scripts/lib file, directly or through its own local
    imports. Gates are found from the registry's commands, so a new gate is scanned without an edit here."""
    jobs = json.loads(_node("import('./scripts/lib/jobs.mjs').then(m => console.log(JSON.stringify(m.resolveJobs("
                            "{ budgetMb: 8000, cpus: 4, python: 'py', logs: '/l', ui: true }).map(j => [j.name, j.cwd, j.cmd]))))"))
    entries = {}
    for name, cwd, cmd in jobs:
        files = [REPO / cwd / a for a in cmd if a.endswith(".mjs")]
        if cmd[:2] == ["npm", "run"]:
            files = _npm_files(REPO / cwd, cmd[2])
        if name == "site":   # playwright runs site/test
            files = sorted((REPO / "site" / "test").rglob("*.mjs"))
        entries[name] = files
    readers: dict = {}
    for name, files in entries.items():
        seen, pending = set(), list(files)
        while pending:
            f = pending.pop()
            if f in seen or not f.is_file() or "node_modules" in f.parts:
                continue
            seen.add(f)
            text = f.read_text(errors="ignore")
            for lib in _LIB_REF.findall(text):
                readers.setdefault(f"scripts/lib/{lib}", set()).add(name)
            for rel in _LOCAL_IMPORT.findall(text):
                target = (f.parent / rel).resolve()
                if REPO in target.parents and "scripts" not in target.relative_to(REPO).parts[:1]:
                    pending.append(target)
    return readers


def test_a_scripts_lib_file_a_gate_imports_selects_that_gate():
    """brx5's cross-lane review (2026-10-11): scripts/lib/static-server.mjs selected only mcp, so --changed skipped
    app-test and app-screens, which import it. scripts/lib is otherwise the runner (NARROWED), so each shared file a
    gate imports is declared on its jobs.mjs record (`libs`), and this scan checks every import against selectJobs."""
    readers = _lib_readers()
    assert readers.get("scripts/lib/static-server.mjs", set()) >= {"app-test", "app-screens", "app-e2e"}, readers   # not vacuous
    assert "app-test" in readers.get("scripts/lib/bundles.mjs", set()), readers   # through npm run and screens.mjs
    gaps = []
    for lib, jobs in sorted(readers.items()):
        assert (REPO / lib).is_file(), lib
        f = _select([lib])["filters"]
        if f is None:
            continue
        gaps += [f"{job} imports {lib}" for job in sorted(jobs) if not any(x in job for x in f)]
    assert not gaps, ("--changed skips a gate for a scripts/lib file it imports; add the file to that job's `libs` in "
                      "scripts/lib/jobs.mjs:\n  " + "\n  ".join(gaps))
