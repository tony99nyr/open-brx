"""The start script keeps cloudflared at Cloudflare's minimum version (scripts/lib/cloudflared.mjs). The JS logic is
checked by scripts/test/cloudflared.test.mjs, which this file runs when `node` is on the path. The one minimum
lives in tunnel.py, and the install hint quotes it."""
import re
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


def test_every_doc_mention_of_the_minimum_matches_the_constant():
    docs = ("docs/mac-dev-runbook.md", "docs/platform/install.md", "docs/platform/run.md")
    seen = 0
    for rel in docs:
        text = (REPO / rel).read_text(encoding="utf-8")
        for m in re.finditer(r"\b20\d\d\.\d+\.\d+\b", text):
            seen += 1
            assert m.group(0) == tunnel.CLOUDFLARED_MIN_VERSION, f"{rel}: {m.group(0)}"
    assert seen >= 3, "the docs should still name the minimum"


def test_install_hint_names_both_launchers_and_winget():
    assert "start.cmd" in tunnel.INSTALL_HINT and "winget install Cloudflare.cloudflared" in tunnel.INSTALL_HINT
    assert "\u2014" not in tunnel.INSTALL_HINT
