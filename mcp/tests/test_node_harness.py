"""The shared Node expression runner returns text and decoded JSON."""
from pathlib import Path

from _node import run_node, run_node_json

REPO = Path(__file__).resolve().parents[2]


def test_node_expression_returns_stdout():
    assert run_node("console.log('ready')", cwd=REPO) == "ready"


def test_node_expression_can_return_json():
    assert run_node_json("console.log(JSON.stringify({ok:true}))", cwd=REPO) == {"ok": True}
