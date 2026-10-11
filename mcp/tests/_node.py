"""Run small Node expressions from Python tests."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from _skip import needs

NODE_BIN = shutil.which("node")   # not NODE: a dozen older tests still define their own NODE (the A19 lint)


def run_node(expression: str, *, cwd: Path, timeout: int = 30) -> str:
    needs(NODE_BIN, "node")
    result = subprocess.run([NODE_BIN, "--input-type=module", "-e", expression], cwd=cwd,
                            capture_output=True, text=True, timeout=timeout)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def run_node_json(expression: str, *, cwd: Path, timeout: int = 30):
    return json.loads(run_node(expression, cwd=cwd, timeout=timeout))
