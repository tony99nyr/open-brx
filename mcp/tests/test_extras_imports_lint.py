"""A test that needs an extra must skip under system python, and this lint proves it without a second interpreter.

CI runs the suite twice: once under system python with no extras, once with them installed. Every local gate and the
lander run only the .venv, which has the extras, so a test that imports starlette with no skip passes everywhere except
CI's first pass (2026-10-10, twice in one night: test_mc_api's route-table test, then test_mc_instance_lock).

The rule, checked on the source with `ast` (nothing is imported): in a test module, an import of an extra, or of a
`brx_mcp` or shared `_*.py` module that imports one at its top level (directly or through another such module), must
come after a guard in the same function: a `needs(...)` call (tests/_skip.py), a `try: import … except ImportError:`
whose handler returns or raises, or an `if not HAVE…:` whose body returns or raises. An import inside such a `try` is guarded too. A nested function inherits the guard state
where it is defined. Module-level `_helpers` are not checked: they run only when a test calls them, after its guard.
Run: cd mcp && python3 run_tests.py extras_imports_lint
"""
import ast
import pathlib

TESTS = pathlib.Path(__file__).resolve().parent
MCP = TESTS.parent
EXTRAS = {"starlette", "uvicorn", "httpx", "websockets", "zeroconf", "bleak"}   # what CI's extras pass installs
GUARD_ERRORS = {"ImportError", "ModuleNotFoundError", "Exception"}


def _imported(node, pkg=""):
    """The absolute module names an import statement loads (`from a import b` may load a.b)."""
    if isinstance(node, ast.Import):
        return [a.name for a in node.names]
    if node.level:
        parts = pkg.split(".") if pkg else []
        base = parts[: len(parts) - node.level + 1]
        mod = ".".join(base + ([node.module] if node.module else []))
    else:
        mod = node.module or ""
    return [mod] + [f"{mod}.{a.name}" for a in node.names]


def _catches_import_error(node):
    return isinstance(node, ast.Try) and any(
        h.type is None or any(isinstance(n, ast.Name) and n.id in GUARD_ERRORS for n in ast.walk(h.type))
        for h in node.handlers)


def _exits(handler):
    return bool(handler.body) and isinstance(handler.body[-1], (ast.Return, ast.Raise))


def _top_level_imports(tree, pkg):
    """Imports a module runs when it is imported. One inside a try that catches ImportError does not count."""
    out = []
    for st in tree.body:
        if isinstance(st, (ast.Import, ast.ImportFrom)):
            out += _imported(st, pkg)
        elif isinstance(st, ast.If):
            out += [m for s in st.body + st.orelse if isinstance(s, (ast.Import, ast.ImportFrom)) for m in _imported(s, pkg)]
    return out


def extras_modules():
    """Every brx_mcp module and shared test helper that cannot be imported without an extra."""
    graph = {}
    for p in (MCP / "brx_mcp").rglob("*.py"):
        rel = p.relative_to(MCP).with_suffix("")
        init = rel.name == "__init__"
        name = ".".join(rel.parts[:-1] if init else rel.parts)
        graph[name] = _top_level_imports(ast.parse(p.read_text(encoding="utf-8")), name if init else ".".join(rel.parts[:-1]))
    for p in TESTS.glob("_*.py"):
        graph[p.stem] = _top_level_imports(ast.parse(p.read_text(encoding="utf-8")), "")
    needy, grew = set(), True
    while grew:
        grew = False
        for name, imports in graph.items():
            if name not in needy and any(m.split(".")[0] in EXTRAS or m in needy for m in imports):
                needy.add(name)
                grew = True
    return needy


def unguarded_imports(source, needy):
    """(function, line, module) for each import of an extra, or of a module in `needy`, that no guard precedes."""
    found = []

    def needs_extra(node):
        return next((m for m in _imported(node) if m.split(".")[0] in EXTRAS or m in needy), None)

    def walk(body, fn, guarded):
        for st in body:
            if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if not (fn == "<module>" and st.name.startswith("_")):
                    walk(st.body, st.name if fn == "<module>" else fn, guarded)
                continue
            if isinstance(st, ast.ClassDef):
                walk(st.body, fn, guarded)
                continue
            if isinstance(st, (ast.Import, ast.ImportFrom)):
                mod = needs_extra(st)
                if mod and not guarded:
                    found.append((fn, st.lineno, mod))
                continue
            if _catches_import_error(st):
                walk(st.body, fn, True)
                for h in st.handlers:
                    walk(h.body, fn, guarded)
                walk(st.orelse + st.finalbody, fn, guarded)
                if any(_exits(h) for h in st.handlers if h.type is None or any(
                        isinstance(n, ast.Name) and n.id in GUARD_ERRORS for n in ast.walk(h.type))):
                    guarded = True
                continue
            if any(isinstance(n, ast.Call) and getattr(n.func, "id", None) == "needs" for n in ast.walk(st)):
                guarded = True
            elif (isinstance(st, ast.If) and st.body and isinstance(st.body[-1], (ast.Return, ast.Raise))
                  and any(isinstance(n, ast.Name) and n.id.upper().startswith("HAVE") for n in ast.walk(st.test))):
                guarded = True   # `if not HAVE_WS: return _skip(...)`: an early exit on an extras flag
            for field in ("body", "orelse", "finalbody"):
                sub = getattr(st, field, None)
                if isinstance(sub, list):
                    walk(sub, fn, guarded)
            for h in getattr(st, "handlers", []):
                walk(h.body, fn, guarded)

    walk(ast.parse(source).body, "<module>", False)
    return found


def test_every_import_of_an_extra_in_a_test_is_behind_a_skip():
    needy = extras_modules()
    assert "brx_mcp.mc.api" in needy, "the graph lost the module tonight's failures imported"
    problems = []
    for p in sorted(TESTS.glob("test_*.py")):
        for fn, line, mod in unguarded_imports(p.read_text(encoding="utf-8"), needy):
            problems.append(f"{p.name}:{line} {fn}() imports {mod} with no needs() before it")
    assert not problems, ("these imports fail under CI's system python, which has no extras; put "
                          "`needs(HAVE, \"<extra>\")` (tests/_skip.py) before them:\n  " + "\n  ".join(problems))


def test_the_lint_catches_tonights_two_shapes_and_passes_the_guarded_ones():
    needy = extras_modules()
    bare = ("def test_route_table():\n    from starlette.routing import Route\n"
            "    from brx_mcp.mc.api import _in_order\n")
    assert [(f, m) for f, _, m in unguarded_imports(bare, needy)] == [
        ("test_route_table", "starlette.routing"), ("test_route_table", "brx_mcp.mc.api")]
    guarded = [
        "from _skip import needs\ndef test_x():\n    needs(HAVE, 'starlette')\n    from brx_mcp.mc.api import create_app\n",
        "def test_x():\n    try:\n        from starlette.testclient import TestClient\n    except ImportError:\n        return\n"
        "    from brx_mcp.mc.api import create_app\n",
        "try:\n    from starlette.testclient import TestClient\nexcept ImportError:\n    TestClient = None\n",
        "def _client():\n    from brx_mcp.mc.api import create_app\n",
        "def test_x():\n    needs(HAVE, 'websockets')\n    async def go():\n        import websockets\n",
        "def test_x():\n    if not HAVE_WS:\n        return _skip('x')\n    import websockets\n",
    ]
    # an early exit that does not test an extras flag is not a guard
    assert unguarded_imports("def test_x():\n    if DEBUG:\n        return\n    import websockets\n", needy)
    for src in guarded:
        assert unguarded_imports(src, needy) == [], src
