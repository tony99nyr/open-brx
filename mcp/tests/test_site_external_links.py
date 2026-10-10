"""site/tools/check-external-links.mjs: the manual's external links, checked outside the gate (2026-10-10).

It was spec 2b in the site gate, where a slow GitHub (503/504) timed out a lander gate. The rules are unchanged:
a 4xx is a dead link; 429, a 5xx and a transport error are reported and skipped. CI runs it non-blocking."""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from _skip import needs

REPO = Path(__file__).resolve().parents[2]
MOD = REPO / "site" / "tools" / "check-external-links.mjs"
NODE = shutil.which("node")


def _node(expr: str):
    needs(NODE, "node")
    r = subprocess.run([NODE, "--input-type=module", "-e", f"const m = await import({json.dumps(MOD.as_uri())}); {expr}"],
                       cwd=REPO, capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_a_4xx_is_dead_and_429_5xx_and_errors_are_skipped():
    got = _node("""
      const status = { 'https://a/ok': 200, 'https://a/gone': 404, 'https://a/limit': 429, 'https://a/down': 503 };
      const fake = async u => { if (u === 'https://a/boom') throw new Error('ECONNRESET'); return { status: status[u] }; };
      console.log(JSON.stringify(await m.checkUrls(['https://a/ok', 'https://a/gone', 'https://a/limit', 'https://a/down', 'https://a/boom'], fake)));
    """)
    assert got["bad"] == ["https://a/gone -> 404"], got
    assert len(got["skipped"]) == 3 and any("ECONNRESET" in s for s in got["skipped"]), got


def test_urls_come_from_the_manual_the_platform_pages_and_the_built_html():
    with tempfile.TemporaryDirectory() as tmp:
        docs, web = Path(tmp) / "docs", Path(tmp) / "web"
        (docs / "manual").mkdir(parents=True)
        (docs / "platform").mkdir()
        web.mkdir()
        (docs / "manual" / "a.md").write_text("see https://example.com/a and (https://example.com/b).\n")
        (docs / "manual" / "README.md").write_text("https://example.com/not-published\n")
        (docs / "platform" / "p.md").write_text("https://example.com/p\n")
        (web / "index.html").write_text('<a href="https://example.com/footer">x</a> <a href="/docs/">y</a>')
        got = _node(f"console.log(JSON.stringify(m.collectUrls({{ docs: {json.dumps(str(docs))}, web: {json.dumps(str(web))} }})));")
        assert got == ["https://example.com/a", "https://example.com/b", "https://example.com/footer", "https://example.com/p"], got
