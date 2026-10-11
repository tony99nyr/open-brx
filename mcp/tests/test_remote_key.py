"""The lander gives equivalent remote URLs the same withdrawal marker directory."""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from _skip import needs

REPO = Path(__file__).resolve().parents[2]
MODULE = REPO / "scripts" / "lib" / "remotekey.mjs"
NODE = shutil.which("node")


def _keys(*urls):
    needs(NODE, "node")
    expr = f"import {{ remoteKey }} from {json.dumps(MODULE.as_uri())}; console.log(JSON.stringify(process.argv.slice(1).map(remoteKey)))"
    result = subprocess.run([NODE, "--input-type=module", "-e", expr, *map(str, urls)], cwd=REPO,
                            capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_equivalent_network_remotes_have_one_key():
    keys = _keys("git@github.com:x/y.git", "https://github.com/x/y", "ssh://git@github.com/x/y.git/",
                 "ssh://git@GITHUB.COM:22/x/y.git", "https://github.com:443/x/y/")
    assert keys == ["github.com/x/y"] * len(keys), keys
    assert _keys("https://github.com:8443/x/y") == ["github.com:8443/x/y"]


def test_local_path_and_file_url_resolve_to_one_key():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        actual = root / "remote.git"
        actual.mkdir()
        alias = root / "alias.git"
        alias.symlink_to(actual, target_is_directory=True)
        assert _keys(alias, actual.as_uri()) == [str(actual)] * 2
