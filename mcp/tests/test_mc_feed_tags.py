"""M7 (maintainability review 2026-10-10): the feed's fixed tag vocabulary was kept by hand in API.md, the console's
`FeedTag` and the emitters' literals, with no test. The console tests a row's tag by exact value (Live.tsx), so a new
tag that reached only the server fell through to the catch-all. `types.FeedTagValue` is the one list (generated into
contract.gen.ts); this lint finds every literal tag MC emits and requires it there. A kill's medal tag is built from
`MEDALS` (joined by " + ", or `STREAK ×N`) and is not a fixed tag."""
from __future__ import annotations

import ast
import pathlib
import re
from typing import get_args

MC = pathlib.Path(__file__).resolve().parents[1] / "brx_mcp" / "mc"


def _literals(v: ast.AST) -> list[str]:
    """The string literals an expression can evaluate to, following both branches of `a if c else b` (Codex r1: ROLE
    is emitted only from a conditional) and every operand of `a or b`."""
    if isinstance(v, ast.Constant) and isinstance(v.value, str):
        return [v.value]
    if isinstance(v, ast.IfExp):
        return _literals(v.body) + _literals(v.orelse)
    if isinstance(v, ast.BoolOp):
        return [x for e in v.values for x in _literals(e)]
    return []


def _reads_tag(e: ast.AST) -> bool:
    """`x["tag"]`, `x.get("tag")` or a name `tag`: one side of a tag comparison."""
    if isinstance(e, ast.Name):
        return e.id == "tag"
    if isinstance(e, ast.Subscript):
        return isinstance(e.slice, ast.Constant) and e.slice.value == "tag"
    return isinstance(e, ast.Call) and getattr(e.func, "attr", None) == "get" and bool(e.args) \
        and isinstance(e.args[0], ast.Constant) and e.args[0].value == "tag"


def _emitted_tags() -> dict[str, str]:
    """tag -> where, for every literal tag: a `"tag": "X"` dict entry, a `_push_feed(t, text, "X", kind)` argument, a
    `tag = "X"` assignment and the class attribute `AFTER_WHISTLE = "X"`."""
    out: dict[str, str] = {}
    for path in sorted(MC.glob("*.py")):
        text = path.read_text(encoding="utf-8")
        tree = ast.parse(text)
        feeds = "_push_feed" in text or "_on_feed" in text     # `tag = ...` means a feed tag only in a feed emitter
        class_consts = {id(a) for c in ast.walk(tree) if isinstance(c, ast.ClassDef) for a in c.body if isinstance(a, ast.Assign)}
        for node in ast.walk(tree):
            where = f"{path.name}:{getattr(node, 'lineno', '?')}"
            if isinstance(node, ast.Dict):
                for k, v in zip(node.keys, node.values):
                    if isinstance(k, ast.Constant) and k.value == "tag":
                        for tag in _literals(v):
                            out.setdefault(tag, where)
            elif isinstance(node, ast.Call) and getattr(node.func, "attr", None) == "_push_feed":
                args = list(node.args[2:3]) + [k.value for k in node.keywords if k.arg == "tag"]
                for tag in (t for a in args for t in _literals(a)):
                    out.setdefault(tag, where)
            elif isinstance(node, ast.Assign):
                # `tag = "X"` anywhere, and a class constant named for a tag (`AFTER_WHISTLE = "AFTER WHISTLE"`)
                if any(isinstance(t, ast.Name) and (t.id == "tag" and feeds or id(node) in class_consts and t.id.isupper()
                                                    and _literals(node.value)
                                                    and _literals(node.value)[0].replace(" ", "_") == t.id)
                       for t in node.targets):
                    for tag in _literals(node.value):
                        out.setdefault(tag, where)
            elif isinstance(node, ast.Compare) and len(node.comparators) == 1 and _reads_tag(node.left):
                # a tag a reader compares against (`ev.get("tag") != "POWERUP"`) must exist too (Opus r1)
                for tag in _literals(node.comparators[0]):
                    out.setdefault(tag, where)
    return out


def _known() -> set[str]:
    """The fixed tags plus every single-medal tag (`scoring.py` builds a kill's tag from the medal keys)."""
    from brx_mcp.mc.types import MEDALS, FeedTagValue
    return set(get_args(FeedTagValue)) | {m["key"].replace("_", " ").upper() for m in MEDALS}


CONSOLE = pathlib.Path(__file__).resolve().parents[2] / "webapp" / "mc" / "src"
_TS_TAG = re.compile(r"""\btag\s*(?:===|!==|:)\s*([^,}\n;]+)""")
_TS_STR = re.compile(r"""'([^'$`]+)'""")


def _ts_tags(expr: str) -> list[str]:
    """The string literals a tag expression can take. A ternary's condition holds other strings (`mode === 'ffa'`), so
    only the branches after its first `?` count (Codex r2: `tag: friendly ? 'TEAM KILL' : ...`)."""
    return _TS_STR.findall(expr.split("?", 1)[1] if "?" in expr else expr)


def test_every_tag_the_console_names_is_a_real_tag():
    """Opus r1 (Medium): the console's `FeedTag` ends in a `string` catch-all, so a typo in a comparison
    (`ev.tag === 'WITHELD'`) or a tag the mock invents still compiles. Every `tag === '...'` and `tag: '...'` literal in
    the console and the mock must be a fixed or a medal tag."""
    bad = {}
    for path in sorted(CONSOLE.rglob("*.ts*")):
        if path.name.endswith(".gen.ts"):
            continue
        for m in _TS_TAG.finditer(path.read_text(encoding="utf-8")):
            for tag in _ts_tags(m.group(1)):
                if tag not in _known():
                    bad.setdefault(tag, f"{path.relative_to(CONSOLE)}")
    assert not bad, f"console tags that are neither a FeedTagValue nor a medal tag: {bad}"


def test_every_literal_feed_tag_is_in_the_generated_list():
    from brx_mcp.mc.types import FeedTagValue
    known = set(get_args(FeedTagValue))
    emitted = {t: w for t, w in _emitted_tags().items() if t not in _known() - known}   # a compare may name a medal tag
    assert len(emitted) >= 10, f"the lint found too few tags to be looking in the right place: {emitted}"
    assert "ROLE" in emitted, "the lint must see a tag emitted from a conditional expression (state.py's ROLE)"
    missing = {t: w for t, w in emitted.items() if t not in known}
    assert not missing, f"feed tags MC emits that FeedTagValue (types.py) does not list: {missing}"
