"""A19 guard: shared test helpers live in the `_*.py` modules and nowhere else.

Two rules, both checked on the source with `ast` (nothing is imported):

1. No test module imports another `test_*` module. A helper another file needs belongs in a shared
   `_*.py` module (`_session`, `_stage`, `_clock`, `_report`, `_scoring`, `_server_stub`, `_async`,
   `_skip`). Importing a test module also re-runs its module-level code in the importer's process.
2. No test module re-defines a function, class or UPPER_CASE constant that a shared module already
   defines. Two copies drift: `mk`/`online` had eleven and six, and a config change meant editing all.
   If the behaviour truly differs, give the local helper a name that says how.
"""
import ast
import pathlib

TESTS = pathlib.Path(__file__).resolve().parent


def _tree(path):
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def _test_modules():
    return sorted(TESTS.glob("test_*.py"))


def _shared_modules():
    return sorted(TESTS.glob("_*.py"))


def _defined_names(tree):
    """Top-level functions, classes and UPPER_CASE constants."""
    names = set()
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id.isupper():
                    names.add(t.id)
    return names


def _test_module_imports(tree):
    """`(lineno, module)` for every import of a `test_*` module, at any depth."""
    hits = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.level == 0 and (node.module or "").startswith("test_"):
            hits.append((node.lineno, node.module))
        elif isinstance(node, ast.Import):
            hits += [(node.lineno, a.name) for a in node.names if a.name.startswith("test_")]
    return hits


def test_no_test_module_imports_another_test_module():
    bad = [f"{p.name}:{line} imports {mod}" for p in _test_modules() for line, mod in _test_module_imports(_tree(p))]
    assert not bad, "move the helper into a shared _*.py module:\n  " + "\n  ".join(bad)


def test_no_test_module_redefines_a_shared_helper():
    shared = {}
    for p in _shared_modules():
        for name in _defined_names(_tree(p)):
            shared.setdefault(name, []).append(p.name)
    assert shared, "no shared helper modules found: is the glob wrong?"
    bad = []
    for p in _test_modules():
        for name in sorted(_defined_names(_tree(p)) & set(shared)):
            bad.append(f"{p.name} defines {name}, already in {', '.join(shared[name])}")
    assert not bad, "import the shared helper, or rename the local one if it behaves differently:\n  " + "\n  ".join(bad)


def test_the_lint_itself_catches_both_mistakes():
    """Break it once and watch it fail: the checks above must see a planted import and a planted copy."""
    planted = ast.parse("from test_mc_state import mk\nimport test_stage\ndef online(): pass\nT0 = 1\n")
    assert [m for _l, m in _test_module_imports(planted)] == ["test_mc_state", "test_stage"]
    assert _defined_names(planted) == {"online", "T0"}
    assert "online" in _defined_names(_tree(TESTS / "_session.py"))
