"""The generated contract (mcp/tools/gen_contract.py) is the one copy of every shared constant. The phone side is
checked by app/test/contract-copies.test.mjs; this file checks the Python and C++ sides: no Python module outside
the constant's own source holds an equal list, tuple or distinctive string literal, and no Stick source outside the
generated header restates a shared string. (2026-10-04 cross-lane review #15: fakes.py restated PANIC_SEQUENCE.)"""
import ast
import importlib
import pathlib
import re
import sys

MCP = pathlib.Path(__file__).resolve().parents[1]
REPO = MCP.parent
sys.path.insert(0, str(MCP))
SOURCES = {"brx_mcp/mc/types.py", "brx_mcp/mc/envelope.py", "brx_mcp/protocol.py"}   # where the values are defined


def _exported() -> dict:
    js = (REPO / "app" / "src" / "transport" / "contract.gen.js").read_text(encoding="utf-8")
    names = set(re.findall(r"^export const ([A-Z][A-Z0-9_]*)\b", js, re.M))
    out = {}
    for mod in ("brx_mcp.mc.types", "brx_mcp.mc.envelope", "brx_mcp.protocol"):
        m = importlib.import_module(mod)
        out.update({n: getattr(m, n) for n in names if hasattr(m, n)})
    return out


def _is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _distinctive(value) -> bool:
    """A value worth guarding: a sequence of strings, or a string long or odd enough not to collide by chance."""
    if isinstance(value, (list, tuple)):
        return bool(value) and all(isinstance(v, str) for v in value)
    return isinstance(value, str) and (len(value) >= 12 or "$" in value)


def _structural(value) -> bool:
    """Seams batch A: the advert layout tables. A dict of name -> int, a set of ints, or a tuple of 3+ ints."""
    if isinstance(value, dict):
        return len(value) >= 2 and all(isinstance(k, str) and _is_int(v) for k, v in value.items())
    if isinstance(value, (set, frozenset)):
        return len(value) >= 3 and all(_is_int(v) for v in value)
    return isinstance(value, (list, tuple)) and len(value) >= 3 and all(_is_int(v) for v in value)


def python_copies(root: pathlib.Path, exported: dict, skip: set[str]) -> list[str]:
    wanted = {n: (list(v) if isinstance(v, (list, tuple)) else v) for n, v in exported.items() if _distinctive(v)}
    shapes = {n: v for n, v in exported.items() if _structural(v)}
    hits = []
    for path in sorted(root.rglob("*.py")):
        rel = path.relative_to(root).as_posix()
        if rel in skip:
            continue
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, (ast.Dict, ast.Set)):
                try:
                    val = ast.literal_eval(node)
                except (ValueError, SyntaxError):
                    continue
                for name, want in shapes.items():
                    if val == (dict(want) if isinstance(want, dict) else set(want)):
                        hits.append(f"{rel}:{node.lineno} restates {name}")
            if isinstance(node, (ast.List, ast.Tuple)):   # an int sequence, or a tuple/list of the set's members
                try:
                    val = ast.literal_eval(node)
                except (ValueError, SyntaxError):
                    continue
                for name, want in shapes.items():
                    if isinstance(want, (list, tuple)) and list(val) == list(want):
                        hits.append(f"{rel}:{node.lineno} restates {name}")
                    elif (isinstance(want, (set, frozenset)) and len(val) == len(want) and all(_is_int(x) for x in val)
          and set(val) == set(want)):
                        hits.append(f"{rel}:{node.lineno} restates {name}")
            if isinstance(node, (ast.List, ast.Tuple, ast.Constant)):
                try:
                    val = ast.literal_eval(node)
                except (ValueError, SyntaxError):
                    continue
                val = list(val) if isinstance(val, (list, tuple)) else val
                for name, want in wanted.items():
                    if val == want:
                        hits.append(f"{rel}:{node.lineno} restates {name}")
    return hits


def cpp_copies(root: pathlib.Path, exported: dict) -> list[str]:
    strings = {n: v for n, v in exported.items() if isinstance(v, str) and _distinctive(v)}
    seqs = {n: v for n, v in exported.items() if isinstance(v, (list, tuple)) and _distinctive(v)}
    hits = []
    for path in sorted([*root.glob("*.h"), *root.glob("*.cpp"), *root.glob("*.ino")]):
        if path.name == "contract.gen.h":
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        literals = re.findall(r'"((?:[^"\\]|\\.)*)"', text)
        for name, v in strings.items():
            if v in literals:
                hits.append(f"{path.name} restates {name}")
        # A sequence is restated only as a brace list of the same strings in order; one token in use is not a copy.
        lists = [re.findall(r'"((?:[^"\\]|\\.)*)"', body) for body in re.findall(r"\{([^{}]*)\}", text)]
        for name, v in seqs.items():
            if any(items == list(v) for items in lists):
                hits.append(f"{path.name} restates {name} as a list")
        # An int brace list ({0x4f, 0x42, 0x52, 0x58}, {0, 1, 3}) that equals a generated int sequence or set.
        for body in re.findall(r"\{([^{}]*)\}", text):
            try:
                nums = [int(t.strip(), 0) for t in body.split(",") if t.strip()]
            except ValueError:
                continue
            for name, v in exported.items():
                if _structural(v) and not isinstance(v, dict) and len(nums) == len(v) and (
                        nums == list(v) if isinstance(v, (list, tuple)) else set(nums) == set(v)):
                    hits.append(f"{path.name} restates {name} as an int list")
    return hits


def named_int_copies_py(root: pathlib.Path, exported: dict, skip: set[str]) -> list[str]:
    """Seams D: a module-level or class-level `NAME = <int literal>` whose name (leading underscores aside) is a
    generated integer constant. A value scan would drown in coincidences (60, 1000, 5000); a same-name restatement
    is a copy by construction, and it is what drifts."""
    ints = {n: v for n, v in exported.items() if _is_int(v)}
    hits = []
    for path in sorted(root.rglob("*.py")):
        rel = path.relative_to(root).as_posix()
        if rel in skip or rel.startswith("tests/"):
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        scopes = [tree.body, *(c.body for c in ast.walk(tree) if isinstance(c, ast.ClassDef))]   # every class, nested too
        for node in (n for body in scopes for n in body):
            target = node.target if isinstance(node, ast.AnnAssign) else (node.targets[0] if isinstance(node, ast.Assign)
                                                                          and len(node.targets) == 1 else None)
            value = getattr(node, "value", None)
            lit = value.value if isinstance(value, ast.Constant) else (
                -value.operand.value if isinstance(value, ast.UnaryOp) and isinstance(value.op, ast.USub)
                and isinstance(value.operand, ast.Constant) and _is_int(value.operand.value) else None)   # -74
            if isinstance(target, ast.Name) and _is_int(lit) and target.id.lstrip("_") in ints:
                hits.append(f"{rel}:{node.lineno} {target.id} = {lit} restates {target.id.lstrip('_')}")
    return hits


def named_int_copies_cpp(root: pathlib.Path, exported: dict) -> list[str]:
    """The C++ half: a `constexpr`/`const`/`#define` of a generated integer's name with a literal, outside the header."""
    ints = {n: v for n, v in exported.items() if _is_int(v)}
    hits = []
    for path in sorted([*root.rglob("*.h"), *root.rglob("*.cpp"), *root.rglob("*.ino")]):
        if path.name == "contract.gen.h":
            continue
        text = _strip_cpp_comments(path.read_text(encoding="utf-8", errors="replace"))
        # constexpr/const (any type, a u/l suffix), #define, and an enumerator (`X = 63,` or `X = 63 }`)
        num = r"-?(?:0[xX][0-9A-Fa-f]+|\d+)[uUlL]*"   # decimal or hex, with a u/l suffix
        for m in re.finditer(rf"(?:\bconstexpr\b|\bconst\b)[^;=\n{{]*?\b([A-Z][A-Z0-9_]+)\s*(?:=\s*{num}|\{{\s*{num}\s*\}})\s*;"
                             rf"|#define\s+([A-Z][A-Z0-9_]+)\s+{num}\b"
                             r"|\benum\b[^{;]*\{([^}]*)\}", text):
            if m.group(3) is not None:
                for e in re.finditer(r"\b([A-Z][A-Z0-9_]+)\s*=\s*-?\d+[uUlL]*\s*(?:,|$)", m.group(3)):
                    if e.group(1) in ints:
                        hits.append(f"{path.relative_to(root).as_posix()} restates {e.group(1)} as a literal")
                continue
            name = m.group(1) or m.group(2)
            if name in ints:
                hits.append(f"{path.relative_to(root).as_posix()} restates {name} as a literal")
    return hits


def test_no_python_module_or_stick_source_restates_a_generated_integer_by_name():
    exported = _exported()
    hits = named_int_copies_py(MCP, exported, SOURCES | {"tools/gen_contract.py"})
    hits += named_int_copies_cpp(REPO / "hardware" / "m5sticks3", exported)
    assert not hits, hits


def test_the_named_integer_scan_finds_a_planted_copy():
    import tempfile
    exported = {"STALE_AFTER_MS": 8000, "MAX_PLAYERS": 63}
    with tempfile.TemporaryDirectory() as d:
        root = pathlib.Path(d)
        (root / "fake.py").write_text("_STALE_AFTER_MS = 8000\nclass K:\n    MAX_PLAYERS = 63\nOTHER = 8000\n")
        assert named_int_copies_py(root, exported, set()) == [
            "fake.py:1 _STALE_AFTER_MS = 8000 restates STALE_AFTER_MS", "fake.py:3 MAX_PLAYERS = 63 restates MAX_PLAYERS"]
        (root / "x.h").write_text("constexpr int MAX_PLAYERS = 63;\n// constexpr int STALE_AFTER_MS = 8000;\n"
                                  "constexpr int ALIAS = contract::MAX_PLAYERS;\n#define STALE_AFTER_MS 8000\n")
        assert named_int_copies_cpp(root, exported) == ["x.h restates MAX_PLAYERS as a literal",
                                                        "x.h restates STALE_AFTER_MS as a literal"]
        (root / "x.h").write_text("static constexpr uint32_t STALE_AFTER_MS = 8000u;\nenum { MAX_PLAYERS = 63 };\n")
        assert sorted(named_int_copies_cpp(root, exported)) == ["x.h restates MAX_PLAYERS as a literal",
                                                                "x.h restates STALE_AFTER_MS as a literal"]
        (root / "x.h").write_text("constexpr uint8_t MAX_PLAYERS = 0x3f;\nconstexpr int STALE_AFTER_MS{8000};\n")
        assert sorted(named_int_copies_cpp(root, exported)) == ["x.h restates MAX_PLAYERS as a literal",
                                                                "x.h restates STALE_AFTER_MS as a literal"]
        (root / "fake.py").write_text("class A:\n    class B:\n        MAX_PLAYERS = 63\nSTALE_AFTER_MS = -1\n")
        assert sorted(named_int_copies_py(root, exported, set())) == ["fake.py:3 MAX_PLAYERS = 63 restates MAX_PLAYERS",
                                                                      "fake.py:4 STALE_AFTER_MS = -1 restates STALE_AFTER_MS"]


def test_no_python_module_restates_a_generated_constant():
    hits = python_copies(MCP, _exported(), SOURCES | {"tools/gen_contract.py"})
    hits = [h for h in hits if not h.startswith("tests/")]   # tests may pin a value on purpose
    assert not hits, hits


def test_no_stick_source_restates_a_generated_string():
    assert not cpp_copies(REPO / "hardware" / "m5sticks3", _exported()), cpp_copies(REPO / "hardware" / "m5sticks3", _exported())


def test_the_scan_finds_a_planted_copy():
    import tempfile
    exported = {"PANIC_SEQUENCE": ["$CLEAR,*", "$SP,99,*"]}
    with tempfile.TemporaryDirectory() as d:
        (pathlib.Path(d) / "fake.py").write_text('frames = {"panic": ["$CLEAR,*", "$SP,99,*"]}\n')
        assert python_copies(pathlib.Path(d), exported, set()) == ["fake.py:1 restates PANIC_SEQUENCE"]
        (pathlib.Path(d) / "x.h").write_text('if (k == "$CLEAR,*") {} const char* p[] = {"$CLEAR,*", "$SP,99,*"};\n')
        assert cpp_copies(pathlib.Path(d), exported) == ["x.h restates PANIC_SEQUENCE as a list"]


def test_the_scan_finds_a_planted_advert_layout_copy():
    import tempfile
    exported = {"ADVERT_ROLE": {"station": 1, "player": 2}, "HILL_CLAIMABLE_TIDS": frozenset({0, 1, 3}),
                "ADVERT_MAGIC": (79, 66, 82, 88)}
    with tempfile.TemporaryDirectory() as d:
        (pathlib.Path(d) / "a.py").write_text('R = {"station": 1, "player": 2}\nT = (0, 1, 3)\nM = bytes((0x4F, 0x42, 0x52, 0x58))\n')
        assert sorted(python_copies(pathlib.Path(d), exported, set())) == [
            "a.py:1 restates ADVERT_ROLE", "a.py:2 restates HILL_CLAIMABLE_TIDS", "a.py:3 restates ADVERT_MAGIC"]
        (pathlib.Path(d) / "x.h").write_text("const uint8_t b[] = {0x4f, 0x42, 0x52, 0x58};\n")
        assert cpp_copies(pathlib.Path(d), exported) == ["x.h restates ADVERT_MAGIC as an int list"]


# DRY review 2026-10-10 #4 (C++ half): the Stick reads the generated names (`contract::X`) directly, so a header has no
# `constexpr T NAME = contract::X;` alias layer. A same-value literal (`VERSION = 1`) passes every behaviour test until
# the contract moves, and an alias is one more name to keep in step. The few aliases left each narrow the type (the
# contract is int32_t) or are read by a file another branch owns; each is listed here with its reason, and goes when
# that reason goes.
ALLOWED_CPP_ALIASES = {
    "presence.h": {
        "REVIVE_MARGIN_DB": "device int32_t is long; the .ino printf uses %d; remove once the .ino reads it with the right type",
        "PRESENCE_SIGHT_WINDOW_MS": "uint32_t: millisecond arithmetic against uint32_t timestamps",
        "SIGHT_RECENT_MAX": "size_t: array bound and size_t counters",
        "PRESENCE_ALPHA_REF_MS": "double: the EMA divides and std::min deduces its type",
        "PRESENCE_ALPHA_DT_CAP_MS": "double: the EMA divides and std::min deduces its type",
        "MEDIAN_SAMPLES": "size_t: array bound and size_t loop counters",
        "STATION_TICK_MS": "uint32_t, and mc_link_glue.h reads it (owned by another branch)",
        "HILL_NEUTRAL": "mc_link_glue.h reads it (owned by another branch)",
        "PLAYER_ALIVE": "uint8_t, and mc_link_glue.h / m5sticks3.ino read it (owned by another branch)"},
    "brx_advert.h": {
        "ROLE_STATION": "uint8_t, and m5sticks3.ino reads it (owned by another branch)",
        "ROLE_PLAYER": "uint8_t, and mc_link_glue.h reads it (owned by another branch)",
        "TEAM_ANY": "uint8_t, and m5sticks3.ino / mc_link_glue.h read it (owned by another branch)",
        "PLAYER_CLAIMING": "uint8_t, and mc_link_glue.h reads it (owned by another branch)",
        "PLAYER_CLAIM_READY": "uint8_t, and mc_link_glue.h reads it (owned by another branch)"},
    "control_point.h": {"BEACON_PERIOD_MS": "uint32_t, and m5sticks3.ino reads it (owned by another branch)"},
    "mc_link_glue.h": {"STATUS_HEARTBEAT_MS": "file owned by another branch; drop with its next edit"},
}


def _strip_cpp_comments(text: str) -> str:
    """Drop `//` and `/* */` comments, keeping string literals, so a commented-out old line cannot satisfy a check."""
    return re.sub(r'"(?:[^"\\\n]|\\.)*"|//[^\n]*|/\*.*?\*/',
                  lambda m: m.group(0) if m.group(0).startswith('"') else " ", text, flags=re.S)


# What an alias initialiser looks like: the contract name alone, or in a cast, a brace or an element of a table.
_ALIAS_INIT = (r"(?:static_cast<[^<>]*>\(\s*|\(\s*[\w: ]+\)\s*)?(?:::)?contract::\w+(?:\s*\[\s*\d+\s*\])?(?:\s*\))?")


def cpp_alias_names(text: str) -> set[str]:
    """Names declared as a const/constexpr copy of a contract:: name, or imported by `using contract::X;`, anywhere in the text
    (indented, in a namespace, static/inline, any type, cast or brace initialiser, several declarators in one statement)."""
    text = _strip_cpp_comments(text)
    names = set(re.findall(r"\busing\s+(?:::)?contract::(\w+)\s*;", text))
    for st in re.findall(r"\b(?:constexpr|const)\b[^;]*;", text):
        names.update(re.findall(rf"(\w+)\s*(?:=\s*|\{{\s*){_ALIAS_INIT}\s*\}}?\s*(?=[,;])", st))
    return names


def cpp_alias_hits(root: pathlib.Path) -> set[tuple[str, str]]:
    return {(str(p.relative_to(root)), n)
            for p in sorted([*root.rglob("*.h"), *root.rglob("*.cpp"), *root.rglob("*.ino")])
            if p.name != "contract.gen.h" and "mockups" not in p.parts
            for n in cpp_alias_names(p.read_text(encoding="utf-8", errors="replace"))}


def cpp_alias_problems(root: pathlib.Path, allowed: dict) -> list[str]:
    """Every alias over the generated contract in a Stick source that is not on the allowed list, and every allowance
    that no longer matches an alias (a stale one would hide the next alias added under that name)."""
    hits = cpp_alias_hits(root)
    out = [f"{f}: alias {n} over the generated contract; use contract::X at the use"
           for f, n in sorted(hits) if n not in allowed.get(f, {})]
    out += [f"{f}: {n} is allowed but no longer an alias" for f, names in sorted(allowed.items()) for n in names
            if (f, n) not in hits]
    return out


def _function_body(text: str, signature: str) -> str:
    """The text from `signature` to the first line that is a lone closing brace (our headers close functions at column 0)."""
    m = re.search(re.escape(signature) + r".*?\n\}", text, re.S)
    return m.group(0) if m else ""


def cpp_logic_problems(root: pathlib.Path) -> list[str]:
    out = []
    adv = _strip_cpp_comments((root / "brx_advert.h").read_text(encoding="utf-8"))
    m = re.search(r"const uint8_t b\[16\] = \{(.*?)\};", adv, re.S)
    if not m or [t.strip() for t in m.group(1).split(",")][:4] != [f"contract::ADVERT_MAGIC[{i}]" for i in range(4)]:
        out.append("brx_advert.h: advert_bytes must start with contract::ADVERT_MAGIC[0..3]")
    if "contract::ADVERT_MAGIC[i]" not in _function_body(adv, "inline bool decode_advert"):
        out.append("brx_advert.h: decode_advert must compare against contract::ADVERT_MAGIC")
    pres = _strip_cpp_comments((root / "presence.h").read_text(encoding="utf-8"))
    m = re.search(r"inline bool hill_claimable\(int tid\) \{(.*?)\n\}", pres, re.S)
    if not m or "contract::HILL_CLAIMABLE_TIDS[" not in m.group(1) or re.search(r"tid\s*==", m.group(1)):
        out.append("presence.h: hill_claimable must read contract::HILL_CLAIMABLE_TIDS")
    return out


def cpp_state_literal_problems(root: pathlib.Path) -> list[str]:
    """No Stick source masks an advert `state` byte with a bare number: use the brx:: bit names."""
    out = []
    for path in sorted([*root.glob("*.h"), *root.glob("*.ino")]):
        if path.name == "contract.gen.h":
            continue
        text = _strip_cpp_comments(path.read_text(encoding="utf-8", errors="replace"))
        for m in re.finditer(r"state\s*&\s*(0x[0-9a-fA-F]+|\d+)", text):
            out.append(f"{path.name}: `{m.group(0)}` masks a state byte with a number")
    return out


def test_the_stick_has_no_alias_layer_over_the_generated_contract():
    stick = REPO / "hardware" / "m5sticks3"
    assert not cpp_alias_problems(stick, ALLOWED_CPP_ALIASES), cpp_alias_problems(stick, ALLOWED_CPP_ALIASES)
    assert not cpp_logic_problems(stick), cpp_logic_problems(stick)
    assert not cpp_state_literal_problems(stick), cpp_state_literal_problems(stick)


def test_the_alias_scan_finds_every_planted_shape():
    import tempfile
    shapes = [
        "constexpr uint8_t A = contract::X;",
        "static constexpr int A = contract::X;",
        "inline constexpr int A = contract::X;",
        "const int A = contract::X;",
        "constexpr unsigned int A = contract::X;",
        "constexpr std::uint8_t A = contract::X;",
        "constexpr int A = static_cast<int>(contract::X);",
        "constexpr int A = (int)contract::X;",
        "constexpr int A{contract::X};",
        "constexpr int A = ::contract::X;",
        "constexpr uint8_t Z = 1, A = contract::X;",
        "constexpr uint8_t T = contract::TABLE[2];",
        "  constexpr int A = contract::X;",
        "namespace brx { constexpr int A = contract::X; }",
        "namespace brx {\n  inline void f() {\n    const uint32_t A = contract::X;\n  }\n}",
        "namespace brx { using contract::A; }",
        "using ::contract::A;",
    ]
    for i, shape in enumerate(shapes):
        for suffix in (".h", ".cpp", ".ino"):
            assert cpp_alias_names(shape) , f"missed {shape!r}"
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            (root / "sim").mkdir()
            (root / "sim" / "a.cpp").write_text(shape + "\n")
            (root / "b.ino").write_text(shape + "\n")
            problems = cpp_alias_problems(root, {})
            assert len(problems) == 2 * len(cpp_alias_names(shape)), (shape, problems)
            names = cpp_alias_names(shape)
            allowed = {"sim/a.cpp": {n: "r" for n in names}, "b.ino": {n: "r" for n in names}}
            assert not cpp_alias_problems(root, allowed), shape
            assert cpp_alias_problems(root, {**allowed, "a.h": {"GONE": "r"}}) == ["a.h: GONE is allowed but no longer an alias"]
    # what is not an alias: a non-const member default, a computed value, a function-local non-const copy
    for ok in ("uint32_t m = contract::X;", "constexpr int A = contract::X + 1;", "int a = contract::X;",
               "const bool b = contract::X == 3;", "x = f(contract::X);"):
        assert not cpp_alias_names(ok), ok
