"""The start script keeps cloudflared at Cloudflare's minimum version (scripts/lib/cloudflared.mjs). The JS logic is
checked by scripts/test/cloudflared.test.mjs, which this file runs when `node` is on the path. The one minimum
lives in tunnel.py, and the install hint quotes it."""
import shutil
import subprocess
from pathlib import Path

from _skip import needs

from brx_mcp.mc import tunnel

REPO = Path(__file__).resolve().parents[2]


def test_install_hint_quotes_the_minimum_version():
    assert tunnel.CLOUDFLARED_MIN_VERSION in tunnel.INSTALL_HINT
    assert "start.sh" in tunnel.INSTALL_HINT


def test_minimum_is_a_plain_literal_the_launcher_can_parse():
    text = (REPO / "mcp/brx_mcp/mc/tunnel.py").read_text(encoding="utf-8")
    assert f'\nCLOUDFLARED_MIN_VERSION = "{tunnel.CLOUDFLARED_MIN_VERSION}"\n' in text


def test_js_side_passes():
    node = shutil.which("node")
    needs(node, "node")
    done = subprocess.run([node, "--test", str(REPO / "scripts/test/cloudflared.test.mjs")],
                          capture_output=True, text=True, timeout=120)
    assert done.returncode == 0, done.stdout[-2000:] + done.stderr[-2000:]
