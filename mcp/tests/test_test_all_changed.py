"""scripts/lib/changed.mjs: the path -> job mapping behind `test:all -- --changed [base]`.

WHY (2026-09-27). Main takes a push about every 2 minutes, so an agent re-running the full `--ui` gate before
every landing burns most of its time on suites the change could not possibly affect (CLAUDE.md's re-gate rule).
--changed narrows that, but only safely if every rule fails SAFE: an unmapped path, or a path this module does
not recognise, must select everything, never a guess that quietly skips a job. These tests pin that, plus the
one invariant mcp/tests/test_suite_registry.py's registration test cannot check on its own: every job that
exists can actually be reached by some rule here (see test_every_job_is_reachable_by_changed below).
"""
import json
import shutil
import subprocess
from pathlib import Path

from _skip import needs

REPO = Path(__file__).resolve().parents[2]
CHANGED_MOD = REPO / "scripts" / "lib" / "changed.mjs"
TEST_ALL = REPO / "scripts" / "test-all.mjs"
NODE = shutil.which("node")


def _select(paths: list[str]) -> dict:
    needs(NODE, "node")
    expr = (
        f"import({json.dumps(CHANGED_MOD.as_uri())}).then(m => "
        f"console.log(JSON.stringify(m.selectJobs({json.dumps(paths)}))))"
    )
    res = subprocess.run([NODE, "--input-type=module", "-e", expr], cwd=REPO,
                          capture_output=True, text=True, timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def _job_names() -> list[str]:
    needs(NODE, "node")
    res = subprocess.run([NODE, str(TEST_ALL), "--", "--ui", "--list"], cwd=REPO,
                          capture_output=True, text=True, timeout=30)
    assert res.returncode == 0, res.stderr
    return [n for n in res.stdout.split("\n") if n.strip()]


def test_app_paths_select_the_app_jobs_and_site():
    r = _select(["app/src/hud/live.js"])
    assert r["filters"] is not None
    assert set(r["filters"]) == {"app-", "site"}


def test_webapp_mc_paths_select_the_mc_jobs():
    r = _select(["webapp/mc/src/api/contract.gen.ts"])
    assert r["filters"] == ["mc-"]


def test_mcp_paths_select_mcp_chaos_and_mc_jobs():
    r = _select(["mcp/brx_mcp/mc/scoring.py"])
    assert set(r["filters"]) == {"mcp", "chaos", "mc-"}


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


def _job_name_substrings() -> list[str]:
    needs(NODE, "node")
    expr = f"import({json.dumps(CHANGED_MOD.as_uri())}).then(m => console.log(JSON.stringify(m.JOB_NAME_SUBSTRINGS)))"
    res = subprocess.run([NODE, "--input-type=module", "-e", expr], cwd=REPO, capture_output=True, text=True, timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def test_every_job_is_reachable_by_the_changed_selector():
    """A job whose name matches no substring in JOB_NAME_SUBSTRINGS can NEVER be picked by --changed: it would
    quietly stop running once a branch relies on the --changed re-gate instead of the full suite (CLAUDE.md)."""
    substrings = _job_name_substrings()
    unreachable = [n for n in _job_names() if not any(s in n for s in substrings)]
    assert not unreachable, (
        f"these jobs match none of scripts/lib/changed.mjs's JOB_NAME_SUBSTRINGS {substrings}, so --changed can "
        f"never select them: {unreachable}. Add a rule (and, if needed, a substring) that reaches them.")
