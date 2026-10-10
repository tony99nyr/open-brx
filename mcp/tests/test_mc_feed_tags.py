"""M7 (maintainability review 2026-10-10): the feed's fixed tag vocabulary was kept by hand in API.md, the console's
`FeedTag` and the emitters' literals, with no test. The console colours a row by its exact tag (Live.tsx), so a new
tag that reached only the server fell through to the catch-all. `types.FeedTagValue` is the one list (generated into
contract.gen.ts); this lint finds every literal tag MC emits and requires it there. A kill's medal tag is built from
`MEDALS` (joined by " + ", or `STREAK ×N`) and is not a fixed tag."""
from __future__ import annotations

import ast
import pathlib
from typing import get_args

MC = pathlib.Path(__file__).resolve().parents[1] / "brx_mcp" / "mc"


def _literals(v: ast.AST) -> list[str]:
    """The string literals an expression can evaluate to, following both branches of `a if c else b` (Codex r1: ROLE
    is emitted only from a conditional)."""
    if isinstance(v, ast.Constant) and isinstance(v.value, str):
        return [v.value]
    if isinstance(v, ast.IfExp):
        return _literals(v.body) + _literals(v.orelse)
    return []


def _emitted_tags() -> dict[str, str]:
    """tag -> where, for every literal tag: a `"tag": "X"` dict entry, a `_push_feed(t, text, "X", kind)` argument, a
    `tag = "X"` assignment and the class attribute `AFTER_WHISTLE = "X"`."""
    out: dict[str, str] = {}
    for path in sorted(MC.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            where = f"{path.name}:{getattr(node, 'lineno', '?')}"
            if isinstance(node, ast.Dict):
                for k, v in zip(node.keys, node.values):
                    if isinstance(k, ast.Constant) and k.value == "tag":
                        for tag in _literals(v):
                            out.setdefault(tag, where)
            elif isinstance(node, ast.Call) and getattr(node.func, "attr", None) == "_push_feed" and len(node.args) > 2:
                for tag in _literals(node.args[2]):
                    out.setdefault(tag, where)
            elif isinstance(node, ast.Assign) and path.name == "scoring.py":
                if any(isinstance(t, ast.Name) and t.id in ("tag", "AFTER_WHISTLE") for t in node.targets):
                    for tag in _literals(node.value):
                        out.setdefault(tag, where)
    return out


def test_every_literal_feed_tag_is_in_the_generated_list():
    from brx_mcp.mc.types import FeedTagValue
    known = set(get_args(FeedTagValue))
    emitted = _emitted_tags()
    assert len(emitted) >= 10, f"the lint found too few tags to be looking in the right place: {emitted}"
    assert "ROLE" in emitted, "the lint must see a tag emitted from a conditional expression (state.py's ROLE)"
    missing = {t: w for t, w in emitted.items() if t not in known}
    assert not missing, f"feed tags MC emits that FeedTagValue (types.py) does not list: {missing}"
