"""Review 2026-10-10 (L2): `--evidence-dir` writes `mc-session.json`, and a --demo/--ephemeral run without
BRX_MCP_HOME keeps its store in a temp folder. The marker named `DIR/session.sqlite`, a file that never existed."""
from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import shutil
import tempfile

from _skip import needs

HAVE_UVICORN = importlib.util.find_spec("uvicorn") is not None


def test_the_marker_names_the_store_mc_opened():
    needs(HAVE_UVICORN, "uvicorn")
    from brx_mcp.mc.__main__ import build, parser
    root = pathlib.Path(tempfile.mkdtemp())
    old_home, old_tmp, old_user = os.environ.pop("BRX_MCP_HOME", None), tempfile.tempdir, os.environ.get("HOME")
    tempfile.tempdir = str(root)          # the demo's temp store and scratch land here and go with it
    os.environ["HOME"] = str(root / "home")   # no BRX_MCP_HOME is the case under test: keep ~ inside the temp root
    try:
        ev = root / "evidence"
        s, _n, _x = build(parser().parse_args(["--demo", "--fake-net", "--no-auth", "--evidence-dir", str(ev)]))
        try:
            s.store.log("n1", "status", 1, None, 0, None, False, {"x": 1})
            marker = json.loads((ev / "mc-session.json").read_text(encoding="utf-8"))
            assert pathlib.Path(marker["sqlite"]).is_file(), marker
            assert not (root / "home" / ".brx-mcp" / "mc").exists(), "a demo store never lands in the home folder"
        finally:
            s.store.close()
    finally:
        tempfile.tempdir = old_tmp
        if old_user is None:
            os.environ.pop("HOME", None)
        else:
            os.environ["HOME"] = old_user
        if old_home is not None:
            os.environ["BRX_MCP_HOME"] = old_home
        shutil.rmtree(root, ignore_errors=True)
