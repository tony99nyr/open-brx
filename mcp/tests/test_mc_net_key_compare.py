"""OP18 (maintainability review 2026-10-10): a node key and the join secret are compared in constant time everywhere in
net.py; the node socket can be exposed to the internet through the tunnel. A plain `==`, `!=`, `in` or `not in` with a
key or the secret on either side is a timing oracle, so this AST lint fails on one. It matches operand NAMES, not data
flow: `k = rec.node_key; k == x` slips past, so never alias a key to a local in net.py (review)."""
from __future__ import annotations

import ast
import pathlib

NET = pathlib.Path(__file__).resolve().parents[1] / "brx_mcp" / "mc" / "net.py"
SECRET_WORDS = ("node_key", "join_secret", "displaced_keys", "presented_key", "prior_key")
PLAIN = (ast.Eq, ast.NotEq, ast.In, ast.NotIn)


def _plain_compares(src: str) -> list[str]:
    out = []
    for node in ast.walk(ast.parse(src)):
        if not isinstance(node, ast.Compare) or not any(isinstance(op, PLAIN) for op in node.ops):
            continue
        sides = [node.left, *node.comparators]
        if len(node.ops) == 1 and any(isinstance(s, ast.Constant) and s.value is None for s in sides):
            continue                                   # `x == None` / `x is None` style checks leak nothing
        if any(w in ast.unparse(s) for s in sides for w in SECRET_WORDS):
            out.append(f"net.py:{node.lineno}: {ast.unparse(node)}")
    return out


def test_no_key_or_secret_is_compared_with_a_plain_operator():
    hits = _plain_compares(NET.read_text(encoding="utf-8"))
    assert not hits, "use _key_eq:\n" + "\n".join(hits)


def test_the_lint_sees_every_plain_shape():
    """Control: both directions of membership, an attribute on either side, and != are caught; a None check is not."""
    for bad in ("proven = presented_key == other.node_key", "x = rec.node_key != k", "r = k in other.displaced_keys",
                "r = presented_key in keys", "r = k not in rec.displaced_keys", "ok = s == self.join_secret",
                "ok = None != presented_key == rec.node_key"):
        assert _plain_compares(bad), bad
    assert not _plain_compares("ok = rec.node_key == None") and not _plain_compares("ok = _key_eq(a, rec.node_key)")


def test_key_eq_matches_equality_and_never_raises():
    from brx_mcp.mc.net import _key_eq
    assert _key_eq("abc", "abc") and not _key_eq("abc", "abd") and not _key_eq("", "abc")
    assert not _key_eq(None, "abc") and not _key_eq("abc", None) and _key_eq(None, None)
    assert _key_eq("ключ", "ключ") and not _key_eq("ключ", "abc"), "a non-ASCII key compares, it does not raise"
    assert not _key_eq(42, "42"), "only strings match, as a str key never equalled an int"
