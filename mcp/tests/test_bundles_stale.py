"""The shared bundle freshness check covers every declared source class."""
from __future__ import annotations

import json
import os
import pathlib
import shutil
import subprocess
import tempfile

REPO = pathlib.Path(__file__).resolve().parents[2]
NODE = shutil.which("node")


def test_bundle_freshness_checks_declared_inputs_and_missing_outputs():
    if not NODE:
        from _skip import needs
        needs(False, "node")
    with tempfile.TemporaryDirectory() as directory:
        _check_bundle_freshness(pathlib.Path(directory))


def _check_bundle_freshness(tmp_path):
    paths = [
        "app/src/view.js", "app/scripts/build.mjs", "mcp/brx_mcp/mc/golden_bundle.json",
        "app/package.json", "app/package-lock.json", "app/www/app.js", "app/www/index.html",
        "webapp/mc/src/view.ts", "webapp/mc/public/icon.svg", "webapp/mc/index.html",
        "webapp/mc/vite.config.ts", "webapp/mc/package.json", "webapp/mc/package-lock.json",
        "webapp/mc/tsconfig.json", "webapp/mc/tsconfig.app.json", "webapp/mc/tsconfig.node.json",
        "webapp/mc/dist/index.html",
    ]
    for relative in paths:
        target = tmp_path / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("x")
    # Explicit timestamps also cover directory inputs, independent of filesystem clock resolution.
    for directory, _, files in os.walk(tmp_path, topdown=False):
        for name in files:
            os.utime(pathlib.Path(directory) / name, (1000, 1000))
        os.utime(directory, (1000, 1000))
    for relative in ("app/www/app.js", "webapp/mc/dist/index.html"):
        os.utime(tmp_path / relative, (2000, 2000))

    module = (REPO / "scripts/lib/bundles.mjs").as_uri()
    script = (f"import({json.dumps(module)}).then(m => {{ const root={json.dumps(str(tmp_path))}; "
              "console.log(JSON.stringify([m.bundleStale(root,'app'),m.bundleStale(root,'mc')])) })")
    def stale():
        run = subprocess.run([NODE, "-e", script], cwd=REPO, capture_output=True, text=True, timeout=30)
        assert run.returncode == 0, run.stderr
        return json.loads(run.stdout)

    assert stale() == [None, None]
    for relative, bundle, expected_input in [
        ("app/src/view.js", "app", "app/src"),
        ("app/scripts/build.mjs", "app", "app"),
        ("mcp/brx_mcp/mc/golden_bundle.json", "app", "app"),
        ("webapp/mc/index.html", "mc", "mc"),
        ("webapp/mc/vite.config.ts", "mc", "mc"),
    ]:
        os.utime(tmp_path / relative, (3000, 3000))
        reason = stale()[0 if bundle == "app" else 1]
        assert reason and expected_input in reason, (relative, reason)
        os.utime(tmp_path / relative, (1000, 1000))
    (tmp_path / "app/www/app.js").unlink()
    assert "app/www/app.js" in stale()[0]
