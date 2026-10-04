"""Every `test_*` function in mcp/tests/ must be callable with NO arguments, because run_tests.py (the runner
`test:all`'s mcp job uses) calls each one that way and does not support pytest fixtures. A test that takes
`tmp_path` or `monkeypatch` passes under pytest and fails in the real gate (it bit two lanes on 2026-10-04).

A required parameter is allowed only when the function is wrapped by a decorator (the wrapper supplies the
argument, e.g. `_with_tmp_path`, or `_skip.pytest_only`, which reports a skip under run_tests.py). Checked with
`ast`, so no test module is imported.
"""
import ast
import pathlib

TESTS = pathlib.Path(__file__).resolve().parent


def _required_params(fn: ast.FunctionDef) -> list[str]:
    a = fn.args
    pos = a.posonlyargs + a.args
    required = [p.arg for p in pos[:len(pos) - len(a.defaults)]]
    required += [p.arg for p, d in zip(a.kwonlyargs, a.kw_defaults) if d is None]
    return required


def offenders(root: pathlib.Path = TESTS) -> list[str]:
    out = []
    for path in sorted(root.glob("test_*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in tree.body:
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) or not node.name.startswith("test_"):
                continue
            req = _required_params(node)
            if req and not node.decorator_list:
                out.append(f"{path.name}:{node.lineno} {node.name}({', '.join(req)})")
    return out


def test_every_test_function_runs_with_no_arguments():
    bad = offenders()
    assert not bad, ("run_tests.py calls every test with no arguments, so these fail in test:all: "
                     + "; ".join(bad) + ". Use a tempfile/try-finally helper, or mark with _skip.pytest_only.")


def test_the_check_can_fail():
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        root = pathlib.Path(d)
        (root / "test_fake.py").write_text(
            "def test_bad(tmp_path):\n    pass\n"
            "def test_default(x=1):\n    pass\n"
            "@wrap\ndef test_wrapped(tmp_path):\n    pass\n"
            "def test_kwonly(*, monkeypatch):\n    pass\n", encoding="utf-8")
        assert offenders(root) == ["test_fake.py:1 test_bad(tmp_path)", "test_fake.py:8 test_kwonly(monkeypatch)"]


def test_pytest_only_skips_under_run_tests_and_keeps_its_signature():
    import inspect
    from _skip import Skipped, pytest_only

    @pytest_only
    def test_needs(tmp_path):
        return tmp_path
    try:
        test_needs()
        raise AssertionError("a pytest-only test must report a skip when called with no arguments")
    except Skipped:
        pass
    assert test_needs("x") == "x"
    assert list(inspect.signature(test_needs).parameters) == ["tmp_path"]

