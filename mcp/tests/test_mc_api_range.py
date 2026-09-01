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

from _skip import needs

try:
    from starlette.testclient import TestClient
    import httpx  # noqa: F401
    HAVE = True
except Exception:
    HAVE = False


def _sess():
    return Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))


def _verdict_log():
    """Where api.py's nested `_range_path()` writes — inside a `_Home()` block, a throwaway dir."""
    import pathlib
    return pathlib.Path.home() / ".brx-mcp" / "weapon-verdicts.jsonl"


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
    needs(HAVE, "starlette + httpx")
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
    needs(HAVE, "starlette + httpx")
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
    needs(HAVE, "starlette + httpx")
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
    needs(HAVE, "starlette + httpx")
    from brx_mcp.mc.api import create_app
    with _Home():
        c = TestClient(create_app(_sess(), token=None))
        r = c.get("/api/state", headers={"Origin": "http://example.com"})
        assert r.status_code == 200
        assert r.headers.get("access-control-allow-origin") == "*", "CORS is open to any origin"


# ── polish-loop 2026-08-26 deferred lows, closed 2026-09-01 ──────────────────────────────────────
def test_malformed_json_is_400_not_500():
    """`request.json()` raises on bad input and Starlette turns that into a 500 — a guard that itself
    throws. Same class as the header defect fixed on 2026-08-31."""
    needs(HAVE, "starlette + httpx")
    from brx_mcp.mc.api import create_app
    with _Home():
        c = TestClient(create_app(_sess(), token=None), raise_server_exceptions=False)
        for raw in (b"{not json", b"", b"[1,2,3]", b'"just a string"', b"\xff\xfe\x00"):
            r = c.post("/api/range/verdict", content=raw, headers={"content-type": "application/json"})
            assert r.status_code == 400, (raw, r.status_code)
        assert c.get("/api/range/verdicts").json() == {}


def test_verdicts_read_only_the_tail_and_skip_torn_lines():
    """A bench day appends one line per try-out and never prunes; the GET re-parsed the whole file on
    every KIT mount. Only the last verdict per weapon is ever shown."""
    needs(HAVE, "starlette + httpx")
    import json as _json
    from brx_mcp.mc.api import create_app
    with _Home():
        c = TestClient(create_app(_sess(), token=None))
        pth = _verdict_log(); pth.parent.mkdir(parents=True, exist_ok=True)
        with pth.open("a") as f:
            for i in range(200):                      # a long bench day, one weapon re-tested
                f.write(_json.dumps({"weapon_id": "smg", "verdict": "pass", "note": f"run {i}", "t": i}) + "\n")
            f.write("{torn half a line\n")            # a crash mid-append
            f.write(_json.dumps({"weapon_id": "shotgun", "verdict": "issue", "note": "last", "t": 999}) + "\n")
        m = c.get("/api/range/verdicts").json()
        assert m["smg"]["note"] == "run 199", "the LAST verdict per weapon wins"
        assert m["shotgun"]["note"] == "last", "a torn line must not hide the verdicts after it"
        assert set(m) == {"smg", "shotgun"}


def test_verdicts_beyond_the_tail_window_are_dropped_cleanly():
    """Past the window the oldest rows fall off. That is the trade — but it must never produce a
    half-parsed row or a 500, and the newest verdict for every recently-tested weapon must survive.

    NOTE: this does NOT isolate the partial-line split in `api.py` — the `except ValueError` guard
    already skips a torn head on any realistic data, so removing the split leaves this green. That
    line is deliberate redundancy for a truncation that happens to parse, and is documented as such
    where it lives rather than pretended to be covered here (review 2026-09-01)."""
    needs(HAVE, "starlette + httpx")
    import json as _json
    from brx_mcp.mc.api import create_app
    with _Home():
        app = create_app(_sess(), token=None)
        c = TestClient(app)
        pth = _verdict_log(); pth.parent.mkdir(parents=True, exist_ok=True)
        pad = "y" * 380
        with pth.open("a") as f:
            for i in range(1200):                     # ~460 KB, comfortably past the 256 KB tail
                f.write(_json.dumps({"weapon_id": f"w{i}", "verdict": "pass", "note": pad, "t": i}) + "\n")
        m = c.get("/api/range/verdicts").json()
        assert m, "the tail still parses"
        assert "w1199" in m, "the newest row survives"
        assert all(r["note"] == pad for r in m.values()), "no half-parsed row"
        # The partial-line drop is what this test is NAMED for, and it was not covering it: the
        # `except ValueError: continue` already swallows a torn head, so removing the drop left the
        # suite green (review 2026-09-01). Pin the boundary instead — the first surviving row must be
        # a WHOLE one, i.e. the window must not start mid-record.
        first = min(int(k[1:]) for k in m)
        assert m[f"w{first}"]["t"] == first, "the first surviving row must be intact"
        row_bytes = len(_json.dumps({"weapon_id": "w1199", "verdict": "pass", "note": pad, "t": 1199})) + 1
        expected = 256 * 1024 // row_bytes
        assert abs(len(m) - expected) <= 2, f"expected ~{expected} rows in a 256 KB window, got {len(m)}"


def test_a_failed_write_is_503_not_500():
    """A full or read-only disk must not 500 the bench console.

    FOLLOWUPS claimed this fix with no test behind it (review 2026-09-01); the claim is only worth
    anything if something checks it."""
    needs(HAVE, "starlette + httpx")
    import pathlib
    from brx_mcp.mc.api import create_app
    with _Home():
        c = TestClient(create_app(_sess(), token=None), raise_server_exceptions=False)
        # a DIRECTORY where the log file goes: every open("a") raises OSError, like a full disk
        log = _verdict_log()
        log.parent.mkdir(parents=True, exist_ok=True)
        log.mkdir()
        r = c.post("/api/range/verdict", json={"weapon_id": "smg", "verdict": "pass"})
        assert r.status_code == 503, f"expected 503, got {r.status_code}"
        assert "could not write" in r.json()["error"]
        # and the read side degrades to empty rather than 500ing on the same broken path
        assert c.get("/api/range/verdicts").status_code == 200
        assert c.get("/api/range/verdicts").json() == {}
        log.rmdir()
        assert pathlib.Path(log).exists() is False
