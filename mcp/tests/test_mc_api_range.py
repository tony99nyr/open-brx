"""Weapon test-range verdict API — POST /api/range/verdict, GET /api/range/verdicts (api.py).

Verdicts append to ~/.brx-mcp/weapon-verdicts.jsonl via `Path.home()`, so each test owns $HOME
(a throwaway dir) for its body — the suite never touches the real ~/.brx-mcp. Guards the starlette
extras like the other API tests so `python3 run_tests.py` skips cleanly under system python.
"""
import os
import shutil
import tempfile

from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.state import Session

try:
    from starlette.testclient import TestClient
    import httpx  # noqa: F401
    HAVE = True
except Exception:
    HAVE = False


def _sess():
    return Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))


class _Home:
    """Redirect Path.home() (→ os.path.expanduser('~') → $HOME/USERPROFILE) to a throwaway dir for the
    test body, then restore — so the verdict log lands in a temp file, never the real ~/.brx-mcp."""
    def __enter__(self):
        self._dir = tempfile.mkdtemp(prefix="brx-range-")
        self._saved = {k: os.environ.get(k) for k in ("HOME", "USERPROFILE")}
        os.environ["HOME"] = self._dir
        os.environ["USERPROFILE"] = self._dir
        return self._dir

    def __exit__(self, *exc):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self._dir, ignore_errors=True)


def test_range_verdict_append_and_latest_wins():
    if not HAVE:
        return
    from brx_mcp.mc.api import create_app
    with _Home():
        c = TestClient(create_app(_sess(), token=None))
        assert c.get("/api/range/verdicts").json() == {}, "empty before any verdict"

        r = c.post("/api/range/verdict", json={"weapon_id": "assault_rifle", "verdict": "pass", "note": "crisp"})
        assert r.status_code == 200
        rec = r.json()
        assert rec["weapon_id"] == "assault_rifle" and rec["verdict"] == "pass"
        assert rec["note"] == "crisp" and isinstance(rec["t"], int)

        c.post("/api/range/verdict", json={"weapon_id": "smg", "verdict": "issue", "note": "double-fires"})
        # a second verdict for the SAME weapon must win the read-back (latest per weapon)
        c.post("/api/range/verdict", json={"weapon_id": "assault_rifle", "verdict": "issue"})

        m = c.get("/api/range/verdicts").json()
        assert set(m) == {"assault_rifle", "smg"}
        assert m["assault_rifle"]["verdict"] == "issue", "latest AR verdict wins"
        assert m["smg"]["verdict"] == "issue" and m["smg"]["note"] == "double-fires"


def test_range_verdict_bad_input_is_400_and_writes_nothing():
    if not HAVE:
        return
    from brx_mcp.mc.api import create_app
    with _Home():
        c = TestClient(create_app(_sess(), token=None), raise_server_exceptions=False)
        for bad in ({"weapon_id": "ar", "verdict": "maybe"},   # verdict not pass|issue
                    {"weapon_id": "ar"},                        # missing verdict
                    {"verdict": "pass"},                        # missing weapon_id
                    {"weapon_id": 5, "verdict": "pass"},        # weapon_id not a string
                    {}):
            assert c.post("/api/range/verdict", json=bad).status_code == 400, bad
        assert c.get("/api/range/verdicts").json() == {}, "a rejected verdict must not append"


def test_range_verdict_note_optional_and_capped():
    if not HAVE:
        return
    from brx_mcp.mc.api import create_app
    with _Home():
        c = TestClient(create_app(_sess(), token=None))
        # no note → empty string, still a valid row
        rec = c.post("/api/range/verdict", json={"weapon_id": "shotgun", "verdict": "pass"}).json()
        assert rec["note"] == ""
        # an overlong note is capped at 400 chars
        rec2 = c.post("/api/range/verdict", json={"weapon_id": "sniper_rifle", "verdict": "issue", "note": "x" * 999}).json()
        assert len(rec2["note"]) == 400


def test_range_cors_allows_any_origin():
    if not HAVE:
        return
    from brx_mcp.mc.api import create_app
    with _Home():
        c = TestClient(create_app(_sess(), token=None))
        r = c.get("/api/state", headers={"Origin": "http://example.com"})
        assert r.status_code == 200
        assert r.headers.get("access-control-allow-origin") == "*", "CORS is open to any origin"
