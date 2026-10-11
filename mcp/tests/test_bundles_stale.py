"""The shared bundle freshness check covers every declared source class."""
from __future__ import annotations

import json
import os
import pathlib
import shutil
import subprocess
import tempfile
from _node import run_node_json

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
        "webapp/mc/dist/index.html", "webapp/mc/dist/assets/index-abc.js", "webapp/mc/.env.local",
        "app/plugins/brx-net/src/net.js", "app/plugins/brx-net/package.json",
        "app/plugins/brx-net/android/build/out.bin",
    ]
    for relative in paths:
        target = tmp_path / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text('<script type="module" crossorigin src="/assets/index-abc.js"></script>'
                          if relative == "webapp/mc/dist/index.html" else "x")
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
        return run_node_json(script, cwd=REPO)

    assert stale() == [None, None]
    for relative, bundle, expected_input in [
        ("app/src/view.js", "app", "app/src"),
        ("app/scripts/build.mjs", "app", "app/scripts/build.mjs"),
        ("mcp/brx_mcp/mc/golden_bundle.json", "app", "mcp/brx_mcp/mc/golden_bundle.json"),
        ("app/package-lock.json", "app", "app/package-lock.json"),
        ("app/plugins/brx-net/src/net.js", "app", "app/plugins/brx-net/src"),
        ("app/plugins/brx-net/package.json", "app", "app/plugins/brx-net/package.json"),
        ("webapp/mc/index.html", "mc", "webapp/mc/index.html"),
        ("webapp/mc/vite.config.ts", "mc", "webapp/mc/vite.config.ts"),
        ("webapp/mc/public/icon.svg", "mc", "webapp/mc/public"),
        ("webapp/mc/tsconfig.app.json", "mc", "webapp/mc/tsconfig.app.json"),
        ("webapp/mc/.env.local", "mc", "webapp/mc/.env.local"),
    ]:
        os.utime(tmp_path / relative, (3000, 3000))
        reason = stale()[0 if bundle == "app" else 1]
        assert reason and reason.startswith(f"{expected_input} is newer"), (relative, reason)
        os.utime(tmp_path / relative, (1000, 1000))
    # A directory's own mtime is not a source change: a job wrote and removed a temp file in webapp/mc/src/api
    # mid-gate (2026-10-11) and e2e refused a fresh dist.
    (tmp_path / "webapp/mc/src/api").mkdir()
    os.utime(tmp_path / "webapp/mc/src/api", (3000, 3000))
    os.utime(tmp_path / "webapp/mc/src", (3000, 3000))
    assert stale() == [None, None]
    # A gradle build tree beside a plugin is not an input; a dangling editor lock link must not throw.
    os.utime(tmp_path / "app/plugins/brx-net/android/build/out.bin", (3000, 3000))
    (tmp_path / "app/src/.#view.js").symlink_to("nowhere@1234")
    os.utime(tmp_path / "app/src/.#view.js", (1000, 1000), follow_symlinks=False)
    os.utime(tmp_path / "app/src", (1000, 1000))   # adding the link moved the directory's own mtime
    assert stale() == [None, None]
    (tmp_path / "webapp/mc/dist/assets/index-abc.js").unlink()
    assert stale()[1].startswith("webapp/mc/dist/assets/index-abc.js is missing")
    (tmp_path / "app/www/index.html").unlink()
    assert stale()[0].startswith("app/www/index.html is missing")
    (tmp_path / "app/www/app.js").unlink()
    assert stale()[0].startswith("app/www/app.js is missing")
