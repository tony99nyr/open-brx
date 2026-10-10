"""OP18 (maintainability review 2026-10-10): a node key and the join secret are compared in constant time everywhere in
net.py; the node socket can be exposed to the internet through the tunnel. A plain `==`, `!=` or `in` against a key is
a timing oracle, so this lint fails on one."""
from __future__ import annotations

import pathlib
import re

NET = pathlib.Path(__file__).resolve().parents[1] / "brx_mcp" / "mc" / "net.py"
BAD = re.compile(r"(presented_key|prior_key|node_key|join_secret|displaced_keys)\s*(==|!=)|(==|!=)\s*\S*(node_key|join_secret)\b"
                 r"|presented_key\s+in\s")


def test_no_key_or_secret_is_compared_with_a_plain_operator():
    hits = [f"net.py:{i}: {line.strip()}" for i, line in enumerate(NET.read_text(encoding="utf-8").splitlines(), 1)
            if BAD.search(line) and not line.lstrip().startswith("#")]
    assert not hits, "use _key_eq / secrets.compare_digest:\n" + "\n".join(hits)


def test_the_lint_sees_a_plain_compare():
    """Control: the pattern really catches the shapes it bans."""
    for bad in ("proven = presented_key == other.node_key", "if presented_key != rec.node_key:",
                "returning = presented_key in other.displaced_keys", "ok = body['s'] == self.join_secret"):
        assert BAD.search(bad), bad
    assert not BAD.search("proven = _key_eq(presented_key, other.node_key)")


def test_key_eq_matches_equality_for_real_keys_and_none():
    from brx_mcp.mc.net import _key_eq
    assert _key_eq("abc", "abc") and not _key_eq("abc", "abd") and not _key_eq("", "abc")
    assert not _key_eq(None, "abc") and not _key_eq("abc", None) and _key_eq(None, None)
