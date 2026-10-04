"""Static approximation guard for test-all cache input declarations.

This scans job entry files and local imports, then checks obvious repo paths in
string literals. Dynamic paths and runtime file access need a runtime tracer.
"""
from __future__ import annotations

import json
import pathlib
import re
import subprocess

REPO = pathlib.Path(__file__).resolve().parents[2]
NODE = "node"
TOPS = ("app", "webapp", "mcp", "site", "docs", "protocol", "hardware", "scripts", ".github", ".claude")
LITERAL_PATH = re.compile(r"['\"`](?:\.\./)*((?:" + "|".join(re.escape(x) for x in TOPS) + r")/[A-Za-z0-9_./@+-]+)")
ROOT_JOIN = re.compile(r"(?:path\.)?(?:join|resolve)\(\s*(?:ROOT|root|REPO|repo)\s*,\s*['\"`]((?:" + "|".join(re.escape(x) for x in TOPS) + r"))['\"`]")
IMPORT = re.compile(r"(?:from\s*|import\s*\(|require\s*\()['\"]([^'\"]+)['\"]\)?")


def _inputs():
    expr = ("import('./scripts/lib/inputs.mjs').then(m => "
            "console.log(JSON.stringify(Object.fromEntries(m.INPUT_JOBS.map(n => [n, m.declaredInputs(n)])))))")
    p = subprocess.run([NODE, "--input-type=module", "-e", expr], cwd=REPO,
                       text=True, capture_output=True, check=True)
    return json.loads(p.stdout)


def _entries(job):
    if job in {"mcp", "chaos"}:
        return [REPO / "mcp/run_tests.py", *sorted((REPO / "mcp/tests").glob("*.py"))]
    if job.startswith("mc-"):
        name = job[3:]
        if name == "tsc":
            return [REPO / "webapp/mc/tsconfig.json", REPO / "webapp/mc/tsconfig.test.json",
                    *sorted((REPO / "webapp/mc/test").rglob("*.ts"))]
        if name == "vitest":
            return sorted((REPO / "webapp/mc/src").rglob("*.ts")) + sorted((REPO / "webapp/mc/src").rglob("*.tsx")) + sorted((REPO / "webapp/mc/test").rglob("*.ts"))
        return [REPO / "webapp/mc/test/e2e" / f"{name}.mjs"]
    if job == "site":
        return [REPO / "site/playwright.config.mjs", REPO / "site/build.mjs",
                *sorted((REPO / "site/test").rglob("*.spec.*"))]
    if job == "app-tsc":
        return [REPO / "app/tsconfig.json"]
    if job == "app-test":
        return sorted((REPO / "app/test").glob("*.test.mjs"))
    tools = {"app-screens": "screens.mjs", "app-logsync": "logsync-gate.mjs",
             "app-moments": "moments.mjs", "app-e2e": "e2e.mjs"}
    return [REPO / "app/tools" / tools[job]]


def _files(start):
    """Scan entry points and their nearby local imports, to a depth of two."""
    seen = set()
    pending = [(p, 0) for p in start if p.is_file()]
    while pending:
        file, depth = pending.pop()
        if file in seen:
            continue
        seen.add(file)
        if depth >= 2:
            continue
        try:
            text = file.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue
        for spec in IMPORT.findall(text):
            if not spec.startswith("."):
                continue
            target = (file.parent / spec).resolve()
            candidates = [target, *[target.with_suffix(s) for s in (".mjs", ".js", ".ts", ".tsx", ".py")]]
            for candidate in candidates:
                if candidate.is_file() and candidate.is_relative_to(REPO):
                    pending.append((candidate, depth + 1))
                    break
    return seen


def _covers(declarations, path):
    return any(d == "." or path == d or (d.endswith("/") and path.startswith(d)) for d in declarations)


def test_every_test_all_job_has_declared_inputs():
    names = subprocess.run([NODE, "scripts/test-all.mjs", "--ui", "--list"], cwd=REPO,
                           text=True, capture_output=True, check=True).stdout.splitlines()
    inputs = _inputs()
    assert set(names) == set(inputs), f"job/input registry mismatch: jobs={set(names) - set(inputs)}, declarations={set(inputs) - set(names)}"


def test_obvious_repo_paths_in_entry_files_are_declared():
    findings = []
    for job, declarations in _inputs().items():
        for file in _files(_entries(job)):
            try:
                text = file.read_text(encoding="utf-8")
            except (OSError, UnicodeError):
                continue
            obvious = LITERAL_PATH.findall(text) + [top + "/" for top in ROOT_JOIN.findall(text)]
            for path in obvious:
                # A known top directory followed by a slash denotes a repo-relative path.
                if not _covers(declarations, path):
                    findings.append(f"{job}: {file.relative_to(REPO)} refers to {path}")
    assert not findings, "static approximation found paths outside declared inputs:\n  " + "\n  ".join(findings)


def test_guard_reaches_real_test_entries_and_relative_imports():
    assert REPO / "site/test/site.spec.mjs" in _files(_entries("site"))
    assert REPO / "webapp/mc/test/fake-invariants.test.ts" in _files(_entries("mc-tsc"))
    assert REPO / "webapp/mc/tsconfig.test.json" in _files(_entries("mc-tsc"))
    assert REPO / "site/lib/facts.mjs" in _files(_entries("site"))


def test_missing_cross_tree_inputs_are_explicit_regressions():
    inputs = _inputs()
    cases = {
        "mc-tsc": ["mcp/brx_mcp/mc/fake_invariants.json"],
        "site": ["webapp/download/build.json", "webapp/favicon.svg", "webapp/.assetsignore"],
        "app-logsync": ["webapp/download/build.json"],
        "app-e2e": ["webapp/download/build.json"],
    }
    cases.update({name: ["webapp/download/build.json"] for name in inputs
                  if name.startswith("mc-") and name not in {"mc-tsc", "mc-vitest"}})
    for job, paths in cases.items():
        for path in paths:
            assert _covers(inputs[job], path), f"{job} omits {path}"
            assert not _covers([d for d in inputs[job] if not _covers([d], path)], path)
