"""Every third-party import in the repo's Python resolves to a declared dependency.

2026-09-12 polish pass. `mcp/pyproject.toml` carries the only written record of what each venv needs
(CLAUDE.md "Environment": the WSL `.venv` runs Mission Control and wants the `mc` extra; the Windows
venv `C:\\Users\\Tony\\.brx-mcp\\venv` runs the bench tools and wants `bench`). Neither venv is built by
`pip install -e ./mcp` today, so nothing ever exercised that list — and it had drifted: `matplotlib`,
which `tools/soundbank_analyze.py` imports, was in neither extra. The cost of that is paid at the bench
with a gun in hand: a tool dies on `ModuleNotFoundError` and the run stops while somebody works out
which package it wanted.

So: parse the real imports and check them against the real file. Function-level imports count — half
the tools import lazily so `--help` works without the heavy stack, and a lazy import is still a
dependency.

Which extra covers which tree:
  `brx_mcp/` (rest: top-level modules, `modes/`, `diag/`) — the plain-install surface. An EAGER
                       third-party import (nothing between it and module load) must be in
                       `[project.dependencies]`: there is no extra a plain install pulls in to save it.
                       A GUARDED import (inside a function/method body, or a module-level try/except) may
                       live in any extra instead, same as the lazy imports below -- `irbridge.py`'s
                       `import serial` is the real example: it is the bench's `pyserial`, never installed
                       into the MC venv, and the module still loads there because the import never runs.
  `brx_mcp/mc/`        + `mc`, the WSL Mission Control venv
  `brx_mcp/stage/`     + `mc` OR `bench`: the stage drives a REAL gun and the IR emitter, so it runs on
                       the bench machine, which is why its one serial-port import resolves via `pyserial`
                       in `bench` rather than being declared into the MC venv that never calls it
  `tools/`             + `bench` OR `mc`: the tools span both machines (`soundbank_analyze.py` is bench,
                       `webview_eval.py` drives the phone webview over CDP from WSL), so either extra
                       satisfies one. An import in NEITHER is the failure this catches.

Run: python3 run_tests.py optional_deps
"""
from __future__ import annotations

import ast
import pathlib
import sys

from _skip import Skipped

REPO = pathlib.Path(__file__).resolve().parents[2]
PYPROJECT = REPO / "mcp" / "pyproject.toml"
TOOLS = REPO / "mcp" / "tools"
BRX_MCP = REPO / "mcp" / "brx_mcp"
MC = BRX_MCP / "mc"
STAGE = BRX_MCP / "stage"

# Import name -> the distribution that provides it, for every third-party package this repo uses or has
# used. A module NOT in this map is reported by `test_no_unknown_third_party_module` rather than passed
# silently: a new dependency should be a deliberate line here and in pyproject.toml, not a guess.
DIST = {
    "bleak": "bleak",
    "cv2": "opencv-python",
    "faster_whisper": "faster-whisper",
    "httpx": "httpx",
    "librosa": "librosa",
    "matplotlib": "matplotlib",
    "mcp": "mcp",
    "numpy": "numpy",
    "PIL": "pillow",
    "scipy": "scipy",
    "serial": "pyserial",
    "soundfile": "soundfile",
    "starlette": "starlette",
    "uvicorn": "uvicorn",
    "websockets": "websockets",
    "zeroconf": "zeroconf",
}

# Imported from inside this repo, not installed: the package itself, the bench tools' shared helper, and
# the test harness's own modules (`_skip`, a sibling test imported by name). This is the fixed set that
# reads the same from every directory; `_local_names` below resolves the REST -- a bare name that happens
# to be a sibling `.py` file (`import native_capture` inside a bench tool) or a `brx_mcp` subpackage
# (`import stage` alongside the package's own `from . import stage`) -- because those depend on where the
# importing file lives, not on a fixed list.
LOCAL = {"brx_mcp", "bench_common", "_skip", "tests", "run_tests"}


def _local_names(path: pathlib.Path) -> set[str]:
    """Bare module names that resolve INSIDE the repo for an import written from `path`, not a real
    distribution: sibling `.py` files in the importer's own directory, plus `brx_mcp`'s own subpackages
    (reachable from anywhere, the way `LOCAL`'s fixed names are). Without this, `import native_capture`
    from a tool sitting right next to `native_capture.py` reads as an unknown third-party module."""
    names = {p.stem for p in path.parent.glob("*.py")} if path.parent.is_dir() else set()
    if BRX_MCP.is_dir():
        names |= {p.name for p in BRX_MCP.iterdir() if p.is_dir() and (p / "__init__.py").is_file()}
    return names


def _rel(path: pathlib.Path):
    """`path` relative to the repo for a readable message -- or `path` itself when it is not under the
    repo at all, which a probe file built in a plain `tempfile.TemporaryDirectory()` (item 3c: no longer
    forced under `mcp/`) is not."""
    try:
        return path.relative_to(REPO)
    except ValueError:
        return path


def _pyproject() -> dict:
    try:
        import tomllib
    except ModuleNotFoundError:                      # py<3.11; pyproject requires-python says >=3.11
        raise Skipped("tomllib needs python 3.11+")
    if not PYPROJECT.is_file():
        raise Skipped(f"{PYPROJECT.relative_to(REPO)} is missing")
    return tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))


def _declared() -> tuple[set[str], dict[str, set[str]]]:
    """(`[project.dependencies]`, {extra: its distributions}) as bare, lowercased names."""
    cfg = _pyproject()
    name = lambda spec: spec.split(";")[0].strip().split("[")[0].strip("<>=!~ ").split(">")[0].split("<")[0].split("=")[0].strip().lower()
    core = {name(s) for s in cfg.get("project", {}).get("dependencies", [])}
    extras = {k: {name(s) for s in v}
              for k, v in cfg.get("project", {}).get("optional-dependencies", {}).items()}
    return core, extras


def _imports(path: pathlib.Path) -> set[str]:
    """Top-level module names imported anywhere in the file, including inside functions.

    A relative import (`from . import x`) is in-package by definition and never a dependency.
    """
    try:
        tree = ast.parse(path.read_text(encoding="utf-8", errors="ignore"), filename=str(path))
    except SyntaxError as e:
        raise AssertionError(f"{_rel(path)} does not parse: {e}")
    out: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            out |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom) and not node.level and node.module:
            out.add(node.module.split(".")[0])
    return out


def _third_party(path: pathlib.Path) -> set[str]:
    local = _local_names(path)
    return {m for m in _imports(path)
            if m not in sys.stdlib_module_names and m not in LOCAL and m not in local}


def _classify_imports(path: pathlib.Path) -> tuple[set[str], set[str]]:
    """Third-party imports in `path`, split into (eager, guarded).

    Eager: reachable the moment the module is loaded, with nothing between the import and a
    ModuleNotFoundError -- a plain install must have the package or the module cannot even be imported.
    Guarded: inside a function/method body (only runs when that code path is exercised -- the same lazy
    imports `test_every_bench_tool_import_is_declared` already counts as real dependencies), or inside a
    module-level `try`/`except` (the module tolerates the package being absent, e.g. `irbridge.py`'s
    `import serial.tools.list_ports` under `except Exception: return None`). Either way pyproject.toml
    only needs the package in SOME extra, not necessarily `[project.dependencies]`.
    """
    text = path.read_text(encoding="utf-8", errors="ignore")
    try:
        tree = ast.parse(text, filename=str(path))
    except SyntaxError as e:
        raise AssertionError(f"{_rel(path)} does not parse: {e}")
    local = _local_names(path)

    def mods_of(node) -> set[str]:
        if isinstance(node, ast.Import):
            names = {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom) and not node.level and node.module:
            names = {node.module.split(".")[0]}
        else:
            return set()
        return {m for m in names if m not in sys.stdlib_module_names and m not in LOCAL and m not in local}

    eager: set[str] = set()
    guarded: set[str] = set()

    def walk(stmts, guard: bool) -> None:
        for stmt in stmts:
            if isinstance(stmt, (ast.Import, ast.ImportFrom)):
                (guarded if guard else eager).update(mods_of(stmt))
            elif isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
                walk(stmt.body, True)                                # a function body never runs at load
            elif isinstance(stmt, ast.ClassDef):
                walk(stmt.body, guard)                                # a class BODY runs at load time
            elif isinstance(stmt, ast.Try):
                walk(stmt.body, guard or bool(stmt.handlers))         # a caught except guards the try
                for h in stmt.handlers:
                    walk(h.body, guard)
                walk(stmt.orelse, guard)
                walk(stmt.finalbody, guard)
            elif isinstance(stmt, (ast.If, ast.For, ast.AsyncFor, ast.While, ast.With, ast.AsyncWith)):
                walk(stmt.body, guard)
                walk(getattr(stmt, "orelse", []) or [], guard)
            # any other statement kind carries no nested body worth descending into

    walk(tree.body, False)
    return eager, guarded


def _tree(root: pathlib.Path, glob: str = "*.py") -> list[pathlib.Path]:
    return sorted(p for p in root.glob(glob) if p.is_file()) if root.is_dir() else []


def _check(files: list[pathlib.Path], allowed: set[str], where: str, extras_named: str) -> list[str]:
    bad = []
    for f in files:
        for mod in sorted(_third_party(f)):
            dist = DIST.get(mod)
            if dist is None:
                continue                             # reported by the unknown-module test instead
            if dist not in allowed:
                bad.append(f"{_rel(f)} imports {mod} ({dist}), which {where} does not "
                           f"declare in {extras_named}")
    return bad


def test_every_bench_tool_import_is_declared():
    """A tool that dies on ModuleNotFoundError at the bench costs a run. `tools/*.py` may lean on either
    venv's extra, but not on nothing."""
    files = _tree(TOOLS)
    if not files:
        raise Skipped("mcp/tools/ has no python files")
    core, extras = _declared()
    allowed = core | extras.get("bench", set()) | extras.get("mc", set())
    bad = _check(files, allowed, "pyproject.toml", "[project.dependencies], .bench or .mc")
    assert not bad, ("undeclared third-party imports — add each to the extra whose venv runs that tool "
                     "(`bench` = the Windows bench venv, `mc` = the WSL Mission Control venv):\n  "
                     + "\n  ".join(bad))


def test_every_mission_control_import_is_declared():
    """`brx_mcp/mc/` is the server the WSL `.venv` runs; `mc` is exactly the extra that venv installs."""
    files = _tree(MC, "**/*.py")
    if not files:
        raise Skipped("mcp/brx_mcp/mc/ has no python files")
    core, extras = _declared()
    bad = _check(files, core | extras.get("mc", set()), "pyproject.toml", "[project.dependencies] or .mc")
    assert not bad, ("Mission Control imports something the `mc` extra does not install, so a venv built "
                     "from pyproject.toml cannot start it:\n  " + "\n  ".join(bad))


def test_every_stage_import_is_declared():
    """`brx_mcp/stage/` runs on the bench machine (a real gun over BLE, the IR emitter over serial), so
    either extra covers it — but something must."""
    files = _tree(STAGE, "**/*.py")
    if not files:
        raise Skipped("mcp/brx_mcp/stage/ has no python files")
    core, extras = _declared()
    allowed = core | extras.get("mc", set()) | extras.get("bench", set())
    bad = _check(files, allowed, "pyproject.toml", "[project.dependencies], .mc or .bench")
    assert not bad, "the bench stage imports an undeclared package:\n  " + "\n  ".join(bad)


def test_every_core_brx_mcp_import_is_declared_eager_or_guarded():
    """The rest of `brx_mcp/` -- top-level modules plus `modes/` and `diag/` -- is the plain-install
    surface (`mc/` and `stage/` have their own checks above because they need an extra). An EAGER
    third-party import here must be in `[project.dependencies]`: a plain install has no extra to fall
    back on. A GUARDED import (inside a function/method, or a module-level try/except) may live in any
    extra -- `irbridge.py`'s two `import serial` call sites are the real example, both guarded, so the
    module still loads on the MC venv that never installs `pyserial`."""
    files = _tree(BRX_MCP) + _tree(BRX_MCP / "modes") + _tree(BRX_MCP / "diag")
    if not files:
        raise Skipped("mcp/brx_mcp/ has no top-level python files")
    core, extras = _declared()
    any_extra = set(core)
    for dists in extras.values():
        any_extra |= dists
    bad = []
    for f in files:
        eager, guarded = _classify_imports(f)
        for mod in sorted(eager):
            dist = DIST.get(mod)
            if dist is None:
                continue                             # reported by the unknown-module test instead
            if dist not in core:
                bad.append(f"{_rel(f)} imports {mod} ({dist}) EAGERLY (not inside a "
                           f"function or a try/except), which [project.dependencies] does not declare")
        for mod in sorted(guarded):
            dist = DIST.get(mod)
            if dist is None:
                continue
            if dist not in any_extra:
                bad.append(f"{_rel(f)} imports {mod} ({dist}) guarded, but no extra in "
                           f"pyproject.toml declares it either")
    assert not bad, "undeclared brx_mcp import(s):\n  " + "\n  ".join(bad)


def test_the_brx_mcp_rule_can_actually_fail():
    """The floor under the check above: an eager top-level `import numpy` must classify as eager (and
    would fail the real check, since numpy is only in `bench`), the same import inside a function must
    classify as guarded, and one wrapped in a module-level try/except must too."""
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        tmp = pathlib.Path(d) / "probe.py"
        tmp.write_text("import numpy\n", encoding="utf-8")
        eager, guarded = _classify_imports(tmp)
        assert eager == {"numpy"} and not guarded, (eager, guarded)

        tmp.write_text("def f():\n    import numpy\n", encoding="utf-8")
        eager, guarded = _classify_imports(tmp)
        assert guarded == {"numpy"} and not eager, (eager, guarded)

        tmp.write_text("try:\n    import numpy\nexcept ImportError:\n    numpy = None\n", encoding="utf-8")
        eager, guarded = _classify_imports(tmp)
        assert guarded == {"numpy"} and not eager, (eager, guarded)

    core, _extras = _declared()
    assert "numpy" not in core, "fixture: this probe only proves something if numpy is NOT a core dependency"


def test_no_unknown_third_party_module():
    """A brand-new import this file has never heard of. It cannot be checked against pyproject.toml
    without knowing its distribution NAME (`PIL` ships as `pillow`, `serial` as `pyserial`), so it is
    reported here: add the row to `DIST`, then declare the package."""
    unknown: dict[str, str] = {}
    for root, glob in ((TOOLS, "*.py"), (MC, "**/*.py"), (STAGE, "**/*.py"),
                       (BRX_MCP, "*.py"), (BRX_MCP / "modes", "*.py"), (BRX_MCP / "diag", "*.py")):
        for f in _tree(root, glob):
            for mod in _third_party(f):
                if mod not in DIST:
                    unknown.setdefault(mod, str(_rel(f)))
    assert not unknown, ("imports with no module->distribution row in DIST (add one, then declare the "
                         f"package in pyproject.toml): {unknown}")


def test_the_declaration_check_can_actually_fail():
    """The floor. Every assertion above reports zero, which a dead parser would too — so prove the parser
    sees lazy imports, prove the pyproject reader sees real names, and provoke the check itself."""
    core, extras = _declared()
    assert "bleak" in core, f"[project.dependencies] did not parse: {core}"
    assert {"mc", "bench"} <= set(extras), f"the extras did not parse: {list(extras)}"
    assert "websockets" in extras["mc"] and "numpy" in extras["bench"], extras

    # a FUNCTION-level import is found (half the tools import lazily; missing those makes this free)
    probe = REPO / "mcp" / "tools" / "webview_eval.py"
    if probe.is_file():
        assert "websockets" in _third_party(probe), (
            "the ast walk stopped seeing imports inside functions — every lazy tool import is invisible")

    # and an undeclared import IS reported. The check only ever READS the path, so the temp dir needs no
    # placement inside the repo -- the system default keeps a stray module out of the working tree
    # entirely, where a concurrent `run_tests.py` collecting `mcp/` could otherwise pick it up.
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        tmp = pathlib.Path(d) / "probe.py"
        tmp.write_text("def f():\n    import cv2\n", encoding="utf-8")     # lazy, like the real tools
        bad = _check([tmp], core | extras["bench"] | extras["mc"], "pyproject.toml", "any extra")
    assert bad and "opencv-python" in bad[0], f"an undeclared import was not reported: {bad}"
