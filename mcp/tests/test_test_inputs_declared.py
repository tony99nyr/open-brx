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
LITERAL_PATH = re.compile(r"['\"`]((?:\.\./)*)((?:" + "|".join(re.escape(x) for x in TOPS) + r")/[A-Za-z0-9_./@+-]+)")
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


_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.S)
_LINE_COMMENT = re.compile(r"(?<![:'\"`\\])//[^\n]*")


def _code_only(file: pathlib.Path, text: str) -> str:
    """The text with comments and docstrings removed: a path named in prose is not a read."""
    if file.suffix == ".py":
        import ast
        import io
        import tokenize
        drop = set()
        try:
            for node in ast.walk(ast.parse(text)):
                body = getattr(node, "body", None)
                if isinstance(body, list) and body and isinstance(body[0], ast.Expr) \
                        and isinstance(getattr(body[0], "value", None), ast.Constant) and isinstance(body[0].value.value, str):
                    drop.update(range(body[0].lineno, body[0].end_lineno + 1))
            out = []
            for tok in tokenize.generate_tokens(io.StringIO(text).readline):
                if tok.type == tokenize.COMMENT or tok.start[0] in drop:
                    continue
                out.append(tok.string)
            return " ".join(out)
        except (SyntaxError, tokenize.TokenError):
            return text
    if file.suffix in {".js", ".mjs", ".cjs", ".ts", ".tsx"}:
        return _LINE_COMMENT.sub("", _BLOCK_COMMENT.sub("", text))
    return text


PACKAGES = ("webapp/mc", "app", "site", "mcp")


def _candidates(file: pathlib.Path, up: str, rest: str) -> list[str]:
    """Every repo path a literal could mean: repo-relative, relative to the citing file, and relative to the file's
    package root (a test's cwd, or a ROOT joined onto a bare 'scripts/x'). A static approximation: a literal is a
    finding only when NO candidate is declared."""
    rel = file.relative_to(REPO).as_posix()
    bases = [REPO, file.parent] + [REPO / p for p in PACKAGES if rel.startswith(p + "/")]
    out = [] if up else [rest]
    for base in bases:
        target = (base / (up + rest)).resolve()
        if target.is_relative_to(REPO):
            out.append(target.relative_to(REPO).as_posix())
    return out


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
            text = _code_only(file, text)
            for up, rest in LITERAL_PATH.findall(text):
                options = _candidates(file, up, rest)
                if options and not any(_covers(declarations, o) for o in options):
                    findings.append(f"{job}: {file.relative_to(REPO)} refers to {options[0]}")
            for top in ROOT_JOIN.findall(text):
                if not _covers(declarations, top + "/"):
                    findings.append(f"{job}: {file.relative_to(REPO)} joins {top}/")
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


def test_comments_and_docstrings_are_not_reads():
    js = _code_only(pathlib.Path("x.mjs"), "/* see 'docs/a.md' */\n// 'app/src/b.js'\nconst u = 'http://x';\nread('mcp/c.json');")
    assert [r for _, r in LITERAL_PATH.findall(js)] == ["mcp/c.json"], js
    py = _code_only(pathlib.Path("x.py"), '"""Reads `docs/a.md`."""\n# \'app/b.js\'\nopen("mcp/c.json")\n')
    assert [r for _, r in LITERAL_PATH.findall(py)] == ["mcp/c.json"], py


def test_a_literal_is_read_against_every_plausible_base():
    assert "app/scripts/build.mjs" in _candidates(REPO / "app/test/x.test.mjs", "../", "scripts/build.mjs")
    assert "app/scripts/build.mjs" in _candidates(REPO / "app/test/x.test.mjs", "", "scripts/build.mjs")
    assert "mcp/brx_mcp/mc/api.py" in _candidates(REPO / "webapp/mc/test/c.test.ts", "../../", "mcp/brx_mcp/mc/api.py")
    assert _candidates(REPO / "app/tools/e2e.mjs", "", "app/www/app.js")[0] == "app/www/app.js"
