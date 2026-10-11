"""A test that needs an extra must skip under system python, and this lint proves it without a second interpreter.

CI runs the suite twice: once under system python with no extras, once with them installed. Every local gate and the
lander run only the .venv, which has the extras, so a test that imports starlette with no skip passes everywhere except
CI's first pass (2026-10-10, twice in one night: test_mc_api's route-table test, then test_mc_instance_lock).

The rule, checked on the source with `ast` (nothing is imported). In a test module, these must come after a guard in the
same function:
- an import of an extra, or of a module that imports one at its top level (a `brx_mcp` module or a shared `_*.py`
  helper, directly or through another such module, or through a package `__init__` on the way);
- a call to a module-level `_helper` of the same file that makes such an import.
A guard is `needs(FLAG, ...)` (tests/_skip.py), `if not FLAG: return/raise`, or a `try: import … except ImportError:`
whose handler returns or raises something (a bare `raise` re-raises: not a guard). FLAG is a `HAVE…` name or a name the
module or function assigns inside such a try. Code inside `if FLAG:` is guarded. A nested function inherits the guard
state where it is defined.
Not seen: an import made at call time inside a `brx_mcp` function (net.py imports websockets in start()), and
importlib or __import__. Those still fail only on CI.
Run: cd mcp && python3 run_tests.py extras_imports_lint
"""
import ast
import pathlib

TESTS = pathlib.Path(__file__).resolve().parent
MCP = TESTS.parent
EXTRAS = {"starlette", "uvicorn", "httpx", "websockets", "zeroconf", "bleak", "mcp"}   # absent from CI's first pass
GUARD_ERRORS = {"ImportError", "ModuleNotFoundError", "Exception"}
# Shared helpers that install stub modules in sys.modules around their own import of server.py, so they load anywhere.
STUBBED = {"_server_stub"}


def _imported(node, pkg=""):
    """The absolute module names an import statement loads, with every package prefix (each `__init__` runs)."""
    if isinstance(node, ast.Import):
        names = [a.name for a in node.names]
    else:
        if node.level:
            parts = pkg.split(".") if pkg else []
            mod = ".".join(parts[: len(parts) - node.level + 1] + ([node.module] if node.module else []))
        else:
            mod = node.module or ""
        names = [mod] + [f"{mod}.{a.name}" for a in node.names]
    out = []
    for n in names:
        bits = n.split(".")
        out += [".".join(bits[:i]) for i in range(1, len(bits) + 1)]
    return [n for n in dict.fromkeys(out) if n]


def _catches_import_error(handler):
    return handler.type is None or any(isinstance(n, ast.Name) and n.id in GUARD_ERRORS for n in ast.walk(handler.type))


def _skips(handler):
    """The handler leaves the test: a return, or a raise of something. A bare `raise` re-raises the ImportError."""
    last = handler.body[-1] if handler.body else None
    return isinstance(last, ast.Return) or (isinstance(last, ast.Raise) and last.exc is not None)


def _guarding_try(st):
    return isinstance(st, ast.Try) and any(_catches_import_error(h) and not _reraises(h) for h in st.handlers)


def _reraises(handler):
    last = handler.body[-1] if handler.body else None
    return isinstance(last, ast.Raise) and last.exc is None


def module_imports(source, pkg):
    """Imports a module runs when it is itself imported, at top level (inside if, with and try blocks too). One
    inside a try whose ImportError handler does not re-raise does not count: the module loads without the extra."""
    out = []

    def walk(body):
        for st in body:
            if isinstance(st, (ast.Import, ast.ImportFrom)):
                out.extend(_imported(st, pkg))
            elif isinstance(st, ast.Try):
                if not _guarding_try(st):
                    walk(st.body)
                for h in st.handlers:
                    walk(h.body)
                walk(st.orelse + st.finalbody)
            elif isinstance(st, (ast.If, ast.With)):
                walk(st.body + getattr(st, "orelse", []))
    walk(ast.parse(source).body)
    return out


def needy_modules(graph):
    """{module: [imports]} -> the modules that cannot load without an extra (the closure over the graph)."""
    needy, grew = set(), True
    while grew:
        grew = False
        for name, imports in graph.items():
            if name not in needy and any(m.split(".")[0] in EXTRAS or m in needy for m in imports):
                needy.add(name)
                grew = True
    return needy


def repo_graph():
    graph = {}
    for p in (MCP / "brx_mcp").rglob("*.py"):
        rel = p.relative_to(MCP).with_suffix("")
        init = rel.name == "__init__"
        name = ".".join(rel.parts[:-1] if init else rel.parts)
        graph[name] = module_imports(p.read_text(encoding="utf-8"), name if init else ".".join(rel.parts[:-1]))
    for p in TESTS.glob("_*.py"):
        graph[p.stem] = [] if p.stem in STUBBED else module_imports(p.read_text(encoding="utf-8"), "")
    return graph


def _flags(body, probes=frozenset(), needy_import=None):
    """Extras flags: names assigned inside a try that catches ImportError and imports an extra (`needy_import`), or from
    a call to a `probes` helper (one that tries the import itself and returns None without it, like test_mc_polish's
    `_ws_stack()`). A flag from a try that imports something else (`yaml`) guards nothing here."""
    out = set()
    for st in body:
        if isinstance(st, ast.Assign) and isinstance(st.value, ast.Call) and getattr(st.value.func, "id", None) in probes:
            out |= {n.id for t in st.targets for n in ast.walk(t) if isinstance(n, ast.Name)}
        if (isinstance(st, ast.Try) and any(_catches_import_error(h) for h in st.handlers)
                and (needy_import is None or any(isinstance(n, (ast.Import, ast.ImportFrom)) and needy_import(n)
                                                 for part in st.body for n in ast.walk(part)))):
            for part in st.body + [s for h in st.handlers for s in h.body] + st.orelse:
                for n in ast.walk(part):
                    if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store):
                        out.add(n.id)
    return out


# The `HAVE*` names the tests use for an extras import (each is set by a try/except ImportError). A name like HAVE_NODE
# is not on the list: it guards a tool, not an extra.
EXTRAS_FLAGS = frozenset({"HAVE", "HAVE_WS", "HAVE_HTTP", "HAVE_API", "HAVE_UVICORN"})


def unguarded_imports(source, needy):
    """(function, line, what) for each needy import or needy-helper call that no guard precedes."""
    tree = ast.parse(source)
    found = []
    probes = frozenset(st.name for st in tree.body if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef))
                       and any(isinstance(n, ast.Try) and any(_catches_import_error(h) for h in n.handlers)
                               for n in ast.walk(st)))

    def is_flag(name, flags):
        return name in EXTRAS_FLAGS or name in flags

    def needy_import(node):
        return next((m for m in _imported(node) if m.split(".")[0] in EXTRAS or m in needy), None)

    module_flags = _flags(tree.body, needy_import=needy_import)

    def flag_test(expr, flags, negated):
        """`FLAG` (negated False) or `not FLAG` (negated True), FLAG an extras flag."""
        if negated:
            if (isinstance(expr, ast.Compare) and len(expr.ops) == 1 and isinstance(expr.ops[0], ast.Is)
                    and isinstance(expr.comparators[0], ast.Constant) and expr.comparators[0].value is None):
                return flag_test(expr.left, flags, False)   # `if Stack is None: return`
            return isinstance(expr, ast.UnaryOp) and isinstance(expr.op, ast.Not) and flag_test(expr.operand, flags, False)
        return isinstance(expr, ast.Name) and is_flag(expr.id, flags)

    def is_guard_call(node, flags):
        return (isinstance(node, ast.Expr) and isinstance(node.value, ast.Call)
                and getattr(node.value.func, "id", None) == "needs" and node.value.args
                and flag_test(node.value.args[0], flags, False))

    # Module-level helpers that make a needy import with no guard of their own: calling one is a needy import.
    helpers = {st.name: st for st in tree.body if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef))
               and st.name.startswith("_")}
    needy_helpers, grew = set(), True
    while grew:
        grew = False
        for name, fn in helpers.items():
            if name in needy_helpers:
                continue
            probe = []
            if _scan(fn.body, name, False, module_flags | _flags(fn.body, probes, needy_import), probe, needy_helpers, needy_import,
                     is_guard_call, flag_test):
                needy_helpers.add(name)
                grew = True

    for st in tree.body:
        if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if not st.name.startswith("_"):
                _scan(st.body, st.name, False, module_flags | _flags(st.body, probes, needy_import), found, needy_helpers, needy_import,
                      is_guard_call, flag_test)
        elif isinstance(st, ast.ClassDef):
            for m in st.body:
                if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    _scan(m.body, m.name, False, module_flags | _flags(m.body, probes, needy_import), found, needy_helpers, needy_import,
                          is_guard_call, flag_test)
        else:
            _scan([st], "<module>", False, module_flags, found, needy_helpers, needy_import, is_guard_call, flag_test)
    return found


def _scan(body, fn, guarded, flags, found, needy_helpers, needy_import, is_guard_call, flag_test):
    """Walk one function body in order. Appends to `found`; returns True if anything unguarded was found."""
    start = len(found)
    for st in body:
        if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef)):
            _scan(st.body, fn, guarded, flags | _flags(st.body, needy_import=needy_import), found, needy_helpers, needy_import, is_guard_call, flag_test)
            continue
        if isinstance(st, (ast.Import, ast.ImportFrom)):
            mod = needy_import(st)
            if mod and not guarded:
                found.append((fn, st.lineno, mod))
            continue
        if isinstance(st, ast.Try) and any(_catches_import_error(h) for h in st.handlers):
            _scan(st.body, fn, True, flags, found, needy_helpers, needy_import, is_guard_call, flag_test)
            for h in st.handlers:
                _scan(h.body, fn, guarded, flags, found, needy_helpers, needy_import, is_guard_call, flag_test)
            _scan(st.orelse + st.finalbody, fn, guarded, flags, found, needy_helpers, needy_import, is_guard_call, flag_test)
            if any(_catches_import_error(h) and _skips(h) for h in st.handlers):
                guarded = True
            continue
        if is_guard_call(st, flags):
            guarded = True
            continue
        if isinstance(st, ast.If):
            if flag_test(st.test, flags, True) and st.body and isinstance(st.body[-1], (ast.Return, ast.Raise)):
                guarded = True   # `if not HAVE_WS: return _skip(...)`
                continue
            _scan(st.body, fn, guarded or flag_test(st.test, flags, False), flags, found, needy_helpers, needy_import,
                  is_guard_call, flag_test)
            _scan(st.orelse, fn, guarded, flags, found, needy_helpers, needy_import, is_guard_call, flag_test)
            continue
        if not guarded and not any(isinstance(getattr(st, f, None), list) for f in ("body", "orelse", "handlers")):
            for n in ast.walk(st):
                if isinstance(n, ast.Call) and getattr(n.func, "id", None) in needy_helpers:
                    found.append((fn, n.lineno, f"{n.func.id}()"))
                    break
        for field in ("body", "orelse", "finalbody"):
            sub = getattr(st, field, None)
            if isinstance(sub, list):
                _scan(sub, fn, guarded, flags, found, needy_helpers, needy_import, is_guard_call, flag_test)
        for h in getattr(st, "handlers", []):
            _scan(h.body, fn, guarded, flags, found, needy_helpers, needy_import, is_guard_call, flag_test)
    return len(found) > start


def test_every_import_of_an_extra_in_a_test_is_behind_a_skip():
    needy = needy_modules(repo_graph())
    assert {"brx_mcp.mc.api", "brx_mcp.server"} <= needy, "the graph lost a module that needs an extra"
    problems = []
    for p in sorted(TESTS.glob("test_*.py")):
        for fn, line, what in unguarded_imports(p.read_text(encoding="utf-8"), needy):
            problems.append(f"{p.name}:{line} {fn}() loads {what} with no skip before it")
    assert not problems, ("these fail under CI's system python, which has no extras; put "
                          "`needs(HAVE, \"<extra>\")` (tests/_skip.py) before them:\n  " + "\n  ".join(problems))


def test_the_graph_follows_relative_imports_package_inits_and_chains():
    graph = {
        "pkg": module_imports("import starlette\n", "pkg"),                       # a package __init__ needs it
        "pkg.plain": module_imports("x = 1\n", "pkg"),                            # loads pkg/__init__ anyway
        "other": module_imports("from .sub import thing\n", "other"),             # relative, through a chain
        "other.sub": module_imports("from pkg import plain\n", "other"),
        "safe": module_imports("try:\n    import httpx\nexcept ImportError:\n    httpx = None\n", ""),
        "reraise": module_imports("try:\n    import httpx\nexcept ImportError:\n    raise\n", ""),
    }
    needy = needy_modules(graph)
    assert needy == {"pkg", "other", "other.sub", "reraise"}, needy
    assert "pkg" in _imported(ast.parse("import pkg.plain as p").body[0])


def test_the_lint_catches_tonights_shapes_and_passes_the_guarded_ones():
    needy = needy_modules(repo_graph())
    caught = {
        "def test_route_table():\n    from starlette.routing import Route\n    from brx_mcp.mc.api import _in_order\n":
            ["starlette", "brx_mcp.mc.api"],
        "def test_x():\n    from brx_mcp.server import main\n": ["brx_mcp.server"],    # needy only through a chain
        "def test_x():\n    needs(minutes > 0, 'soak')\n    import websockets\n": ["websockets"],   # wrong reason
        "def test_x():\n    needs(HAVE_NODE, 'node')\n    from starlette.testclient import TestClient\n":
            ["starlette"],                                                                       # not an extras flag
        "try:\n    import yaml\n    HAVE_YAML = True\nexcept ImportError:\n    HAVE_YAML = False\n"
        "def test_x():\n    needs(HAVE_YAML, 'yaml')\n    from starlette.testclient import TestClient\n":
            ["starlette"],                                                    # a try/except flag for a non-extra
        "def test_x():\n    if HAVE_WS:\n        return\n    import websockets\n": ["websockets"],   # wrong direction
        "def test_x():\n    try:\n        import starlette\n    except ImportError:\n        raise\n"
        "    from brx_mcp.mc.api import create_app\n": ["brx_mcp.mc.api"],                          # re-raised
        "def _client():\n    from brx_mcp.mc.api import create_app\n    return create_app\n"
        "def test_x():\n    _client()\n": ["_client()"],                                         # through a helper
    }
    for src, want in caught.items():
        got = [w for _, _, w in unguarded_imports(src, needy)]
        assert got == want, (src, got)
    guarded = [
        "def test_x():\n    needs(HAVE, 'starlette')\n    from brx_mcp.mc.api import create_app\n",
        "def test_x():\n    try:\n        from starlette.testclient import TestClient\n    except ImportError:\n        return\n"
        "    from brx_mcp.mc.api import create_app\n",
        "try:\n    from starlette.testclient import TestClient\n    OK = True\nexcept ImportError:\n    OK = False\n"
        "def test_x():\n    needs(OK, 'starlette')\n    from brx_mcp.mc.api import create_app\n",
        "def _client():\n    from brx_mcp.mc.api import create_app\n"
        "def test_x():\n    needs(HAVE, 'starlette')\n    _client()\n",
        "def test_x():\n    needs(HAVE, 'websockets')\n    async def go():\n        import websockets\n",
        "def test_x():\n    if not HAVE_WS:\n        return _skip('x')\n    import websockets\n",
        "def test_x():\n    if HAVE_WS:\n        import websockets\n",
        "def _stack():\n    try:\n        import websockets\n    except ImportError:\n        return None, None\n"
        "    return 1, 2\ndef test_x():\n    s, u = _stack()\n    if s is None:\n        return\n    import websockets\n",
    ]
    for src in guarded:
        assert unguarded_imports(src, needy) == [], src
