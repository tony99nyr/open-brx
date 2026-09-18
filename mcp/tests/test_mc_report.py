"""The bug-report zip (`brx_mcp.mc.report`, `POST /api/report`): every personal value is gone from every
member, aliases are stable, the guard refuses to write a leak, the WAL tail is included, and the
download route serves only the zips this server built.

Every identifier below is MADE UP. The sticker id is assembled at run time so this file never matches
the docs hygiene rule it is testing the spirit of.
"""
import json
import shutil
import sqlite3
import tempfile
import zipfile
from pathlib import Path

from _skip import needs

from brx_mcp.mc import report
from brx_mcp.mc.store import Store

try:
    from starlette.testclient import TestClient
    import httpx  # noqa: F401
    HAVE = True
except Exception:
    HAVE = False

STICKER = "R" + "0B" + "ZQ"                 # the pattern-shaped sticker (not from the armory)
ARMORY_STICKER = "KESTREL7"                 # a sticker only the armory knows
PIN = "884211"
BLE_ADDR = "C4:DE:E2:19:A0:7F"
LOG_MAC = "AA:BB:CC:11:22:33"
NAMES = ["MAVERICKX", "GHOSTRIDER"]
LAN = "192.168.44.17"
LAN6 = "fe80::1c2b:3d4e:5f60:7182"
TUNNEL = "brave-otter-lake.trycloudflare.com"
TOKEN = "Zx9secretTok"
NODE_KEY = "nk-4f5e6d7c8b9a"
SSID = "HomeNet-5G"
OTHER_HOME = "/home/someoneelse/project/x.py"
HOME = str(Path.home())


def raw_values():
    return [STICKER, ARMORY_STICKER, PIN, BLE_ADDR, LOG_MAC, *NAMES, LAN, LAN6, TUNNEL, TOKEN, NODE_KEY, SSID,
            "someoneelse", HOME]


def make_evidence(root: Path, close: bool = True) -> tuple[Path, Path, Store]:
    ev = root / "sessions" / "launch-abc"
    ev.mkdir(parents=True)
    armory = root / "armory.json"
    armory.write_text(json.dumps({PIN: {"serial_head_pin": PIN, "gun_name": ARMORY_STICKER,
                                        "ble_address": BLE_ADDR}}), encoding="utf-8")
    st = Store("abc12345", ev / "session.sqlite")
    st.log("node-1", "hello", 1, 1000, 1000, None, False,
           {"node_id": "node-1", "app_ver": "0.3.0", "platform": "android", "node_key": NODE_KEY,
            "gun": {"name": f"{STICKER}-1A2B", "tail": "1A2B"}})
    st.log("node-1", "status", 2, 2000, 2000, "m1", False,
           {"player_id": "p1", "display": NAMES[0], "gun_id": PIN, "hp": 45, "mc_url": f"ws://{LAN}:8766/ws",
            "preflight": {"ssid": SSID, "gun_linked": True}})
    chunk = (f"12:00:01 connected to {ARMORY_STICKER} at {LOG_MAC}\n"
             f"12:00:02 {{\"phase\":\"live\",\"player\":{{\"display\":\"{NAMES[1]}\"}}}}\n"
             f"12:00:03 link {LAN6} tok={TOKEN}\n")
    st.log("node-1", "log_data", 3, 3000, 3000, "m1", False, {"node_id": "node-1", "seq": 0, "chunk": chunk, "last": True})
    st.match_started("m1", {"mode": "tdm", "_heads": {"p1": ["$PSET,1,45,70,*"]}}, 1500)
    st.match_ended("m1", {"rows": [{"player_id": "p1", "display": NAMES[0]}], "winner": {}})
    (ev / "mc.log").write_text(
        f"Mission Control  http://{LAN}:8765/#tok={TOKEN}\n"
        f"  operator token: {TOKEN}\n"
        f"  backhaul: up  wss://{TUNNEL}/ws\n"
        f"  gun {ARMORY_STICKER} ({BLE_ADDR}) bound to {NAMES[1]}\n"
        f"Traceback:\n  File \"{HOME}/gitrepos/open-brx/mcp/brx_mcp/mc/state.py\", line 1\n"
        f"  File \"{OTHER_HOME}\", line 2\n", encoding="utf-8")
    (ev / "manifest.json").write_text(json.dumps({
        "launch_id": "launch-abc", "status": "crashed", "repo": f"{HOME}/gitrepos/open-brx",
        "evidence_dir": str(ev), "url": f"http://{LAN}:8765/"}), encoding="utf-8")
    if close:
        st.close()
    return ev, armory, st


def members(zip_path: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(zip_path) as zf:
        return {n: zf.read(n) for n in zf.namelist()}


def assert_clean(files: dict[str, bytes]):
    for name, data in files.items():
        text = data.decode("utf-8", errors="replace").lower()
        for raw in raw_values():
            assert raw.lower() not in text, f"{raw!r} survived in {name}"


def _tmp():
    return Path(tempfile.mkdtemp(prefix="brx-report-test-"))


def test_every_identifier_is_gone_from_every_member():
    root = _tmp()
    try:
        ev, armory, _ = make_evidence(root)
        res = report.build_report(ev, root / "out", armory_path=armory, roster_path=root / "none.json",
                                  secrets=[TOKEN])
        files = members(res.zip_path)
        assert set(files) == {"README.txt", "session.sqlite", "mc.log", "manifest.json", "diag.json",
                              "environment.json"}, set(files)
        assert res.zip_path.name == "open-brx-report-launch-abc.zip"
        assert_clean(files)
        log = files["mc.log"].decode()
        assert "#tok=[REDACTED]" in log and "operator token: [REDACTED]" in log and "TUNNEL-HOST" in log
        assert "~/gitrepos/open-brx" in log and "/home/USER/project" in log, log
        for cat in ("tagger_id", "ble_address", "player_name", "lan_ip", "tunnel_host", "secret", "home_folder"):
            assert res.removed.get(cat), (cat, res.removed)
        # the scrubbed database still opens, and the diagnostic still reads it
        db_path = root / "check.sqlite"
        db_path.write_bytes(files["session.sqlite"])
        db = sqlite3.connect(str(db_path))
        body = json.loads(db.execute("SELECT body FROM envelopes WHERE kind='status'").fetchone()[0])
        db.close()
        assert body["display"].startswith("Player ") and body["gun_id"] == "[PIN]"
        assert body["preflight"]["ssid"].startswith("WIFI-"), body
        assert json.loads(files["diag.json"])[0]["match_id"] == "m1"
        env = json.loads(files["environment.json"])
        assert env["launch_id"] == "launch-abc" and env["match_count"] == 1
        assert env["phone_apps"] == [{"app_ver": "0.3.0", "platform": "android", "hellos": 1}]
        readme = files["README.txt"].decode()
        assert "public" in readme and "python -m brx_mcp.mc.diag session.sqlite" in readme
        assert res.issue_url.startswith("https://github.com/tony99nyr/open-brx/issues/new?")
        assert "template=bug_report.yml" in res.issue_url and "report=open-brx-report-launch-abc.zip" in res.issue_url
        assert len(res.issue_url) < 6000 and not res.too_large
        # the original evidence is untouched
        orig = sqlite3.connect(str(ev / "session.sqlite"))
        assert NAMES[0] in orig.execute("SELECT body FROM envelopes WHERE kind='status'").fetchone()[0]
        orig.close()
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_aliases_are_stable_across_files_and_runs():
    root = _tmp()
    try:
        ev, armory, _ = make_evidence(root)
        a = report.build_report(ev, root / "a", armory_path=armory, roster_path=root / "none.json")
        b = report.build_report(ev, root / "b", armory_path=armory, roster_path=root / "none.json")
        fa, fb = members(a.zip_path), members(b.zip_path)
        assert fa["mc.log"] == fb["mc.log"]
        log = fa["mc.log"].decode()
        # the armory's sticker, in mc.log and in the phone log chunk in the database, has ONE alias
        tagger = log.split("gun ", 1)[1].split(" ", 1)[0]
        assert tagger.startswith("TAGGER-"), log
        db_path = root / "a.sqlite"
        db_path.write_bytes(fa["session.sqlite"])
        db = sqlite3.connect(str(db_path))
        chunk = json.loads(db.execute("SELECT body FROM envelopes WHERE kind='log_data'").fetchone()[0])["chunk"]
        db.close()
        assert f"connected to {tagger} at BLE-" in chunk, chunk
        # the player named in mc.log and the one in the chunk's engine-state line are the same alias
        player = log.split("bound to ", 1)[1].split("\n", 1)[0]
        assert player.startswith("Player ") and f'"display":"{player}"' in chunk, (player, chunk)
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_guard_refuses_to_write_when_a_scrub_step_misses():
    root = _tmp()
    real = report.Aliaser.literal_pattern
    try:
        ev, armory, _ = make_evidence(root)
        report.Aliaser.literal_pattern = lambda self: None     # break the known-value scrub
        try:
            report.build_report(ev, root / "out", armory_path=armory, roster_path=root / "none.json")
        except report.ReportLeak as e:
            assert "no report was written" in str(e)
            for raw in raw_values():
                assert raw not in str(e), "the error must not print the value it found"
        else:
            raise AssertionError("a missed scrub must raise ReportLeak")
        assert not (root / "out").exists() or not list((root / "out").iterdir()), "nothing may be written"
    finally:
        report.Aliaser.literal_pattern = real
        shutil.rmtree(root, ignore_errors=True)


def test_guard_catches_a_pattern_the_scrub_skipped():
    """The guard keeps its own copies of the patterns, so breaking the scrub's tunnel pattern (the host is
    not a known value, only a pattern match) is still caught."""
    root = _tmp()
    real = report._TUNNEL
    try:
        ev, armory, _ = make_evidence(root)
        report._TUNNEL = __import__("re").compile("(?!x)x")
        try:
            report.build_report(ev, root / "out", armory_path=armory, roster_path=root / "none.json")
        except report.ReportLeak as e:
            assert "tunnel host" in str(e) and "mc.log" in str(e), e
        else:
            raise AssertionError("a tunnel host that skipped the scrub must raise ReportLeak")
        assert not (root / "out").exists() or not list((root / "out").iterdir())
    finally:
        report._TUNNEL = real
        shutil.rmtree(root, ignore_errors=True)


def test_the_wal_tail_is_included_while_the_store_is_open():
    root = _tmp()
    try:
        ev, armory, st = make_evidence(root, close=False)
        for i in range(20):
            st.log("node-2", "status", 10 + i, 5000 + i, 5000 + i, "m1", False, {"hp": i})
        assert (ev / "session.sqlite-wal").is_file() and (ev / "session.sqlite-wal").stat().st_size > 0
        res = report.build_report(ev, root / "out", armory_path=armory, roster_path=root / "none.json")
        db_path = root / "check.sqlite"
        db_path.write_bytes(members(res.zip_path)["session.sqlite"])
        db = sqlite3.connect(str(db_path))
        n = db.execute("SELECT count(*) FROM envelopes WHERE node_id='node-2'").fetchone()[0]
        db.close()
        assert n == 20, n
        st.log("node-2", "status", 99, 9999, 9999, "m1", False, {"hp": 1})   # the live store still writes
    finally:
        st.close()
        shutil.rmtree(root, ignore_errors=True)


def test_store_close_checkpoints_and_is_idempotent():
    root = _tmp()
    try:
        st = Store("s1", root / "session.sqlite")
        st.log("n", "status", 1, 1, 1, None, False, {"hp": 1})
        assert (root / "session.sqlite-wal").exists()
        st.close()
        st.close()
        st.log("n", "status", 2, 2, 2, None, False, {"hp": 2})       # a late write after close is a no-op
        assert not (root / "session.sqlite-wal").exists() and not (root / "session.sqlite-shm").exists()
        db = sqlite3.connect(str(root / "session.sqlite"))
        assert db.execute("SELECT count(*) FROM envelopes").fetchone()[0] == 1
        db.close()
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_cli_json_on_a_launch_id():
    import contextlib
    import io
    import os
    root = _tmp()
    old = os.environ.get("BRX_MCP_HOME")
    try:
        ev, armory, _ = make_evidence(root)
        os.environ["BRX_MCP_HOME"] = str(root)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = report.main(["launch-abc", "--json", "--out", str(root / "cli")])
        assert rc == 0
        js = json.loads(out.getvalue())
        assert set(js) == {"zip", "issue_url", "summary", "removed", "too_large"}
        assert Path(js["zip"]).is_file()
        assert_clean(members(Path(js["zip"])))
        # no SESSION: the newest session under $BRX_MCP_HOME/sessions
        assert report.resolve_session(None)[0] == ev
    finally:
        if old is None:
            os.environ.pop("BRX_MCP_HOME", None)
        else:
            os.environ["BRX_MCP_HOME"] = old
        shutil.rmtree(root, ignore_errors=True)


def test_api_post_builds_and_get_downloads_with_the_token():
    needs(HAVE, "starlette + httpx")
    import os
    from brx_mcp.mc.api import create_app
    from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
    from brx_mcp.mc.state import Session
    root = _tmp()
    old = os.environ.get("BRX_MCP_HOME")
    try:
        os.environ["BRX_MCP_HOME"] = str(root)          # the armory file make_evidence writes
        ev, _armory, st = make_evidence(root, close=False)
        s = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))
        s.store = st
        s.add_player("Lowname", gun_id="GUN-A")
        st.log("node-9", "status", 1, 1, 1, None, False, {"note": "LOWNAME joined"})
        tok = "op-token-7788"
        c = TestClient(create_app(s, token=tok))
        assert c.post("/api/report").status_code == 401
        s.phase = "live"                                         # allowed mid-match
        r = c.post("/api/report", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200, r.text
        js = r.json()
        assert set(js) == {"file", "download", "issue_url", "summary", "removed", "too_large"}
        assert js["download"] == f"/api/report/{js['file']}"
        auth = {"Authorization": f"Bearer {tok}"}
        assert c.get(js["download"]).status_code == 401, "the zip is session telemetry: token-gated"
        assert c.get(js["download"], params={"tok": tok}).status_code == 401, "header only: no token in a URL"
        d = c.get(js["download"], headers=auth)
        assert d.status_code == 200 and d.headers["content-type"] == "application/zip"
        assert d.headers["content-disposition"].startswith("attachment")
        zpath = root / "dl.zip"
        zpath.write_bytes(d.content)
        files = members(zpath)
        assert_clean(files)
        assert "lowname" not in b"".join(files.values()).decode("utf-8", "replace").lower()
        for bad in ("open-brx-report-other.zip", "session.sqlite", "..%2Fsession.sqlite",
                    "%2E%2E%2Fsession.sqlite", "open-brx-report-..zip"):
            assert c.get(f"/api/report/{bad}", headers=auth).status_code == 404, bad
    finally:
        if old is None:
            os.environ.pop("BRX_MCP_HOME", None)
        else:
            os.environ["BRX_MCP_HOME"] = old
        shutil.rmtree(root, ignore_errors=True)


def test_an_all_digit_grenade_pin_is_scrubbed_by_key_and_never_blocks_on_a_row_id():
    """Found on a real session: a 4-digit grenade PIN from the armory equalled an `envelopes.id`, so the
    guard (rightly strict) refused every report. A bare number is not an identifier; a number under a
    PIN key is. Made-up values throughout."""
    root = _tmp()
    try:
        ev = root / "sessions" / "launch-num"
        ev.mkdir(parents=True)
        armory = root / "armory.json"
        armory.write_text(json.dumps({"QX7PL": {"serial_head_pin": "QX7PL", "grenade_pin": 3}}), encoding="utf-8")
        st = Store("n1", ev / "session.sqlite")
        for i in range(5):
            st.log("node-1", "status", 3, 3, 3, "m1", False, {"hp": 3, "seq_note": "row 3 of 5"})
        st.log("node-1", "log_data", 4, 4, 4, "m1", False,
               {"chunk": 'cfg {"grenade_pin": 3, "gun_id": "QX7PL", "headset_pin":"QX7PL"} done\n'})
        st.log("node-1", "status", 5, 5, 5, "m1", False, {"grenade_pin": 3, "hp": 45})
        st.close()
        res = report.build_report(ev, root / "out", armory_path=armory, roster_path=root / "none.json")
        files = members(res.zip_path)
        db_path = root / "c.sqlite"
        db_path.write_bytes(files["session.sqlite"])
        db = sqlite3.connect(str(db_path))
        rows = [json.loads(b) for (b,) in db.execute("SELECT body FROM envelopes ORDER BY id")]
        assert db.execute("SELECT count(*) FROM envelopes WHERE id=3 AND seq=3").fetchone()[0] == 1
        db.close()
        assert rows[0] == {"hp": 3, "seq_note": "row 3 of 5"}, "a bare number is data, not a PIN"
        assert rows[6] == {"grenade_pin": "[PIN]", "hp": 45}, rows[6]
        chunk = rows[5]["chunk"]
        assert '"grenade_pin": [PIN]' in chunk and "QX7PL" not in chunk, chunk
        assert "qx7pl" not in b"".join(files.values()).decode("utf-8", "replace").lower()
    finally:
        shutil.rmtree(root, ignore_errors=True)


def _one_shot(root, bodies, armory_json=None):
    ev = root / "sessions" / "launch-x"
    ev.mkdir(parents=True)
    armory = root / "armory.json"
    armory.write_text(json.dumps(armory_json or {}), encoding="utf-8")
    st = Store("x1", ev / "session.sqlite")
    for i, (kind, body) in enumerate(bodies):
        st.log("node-1", kind, i, i, i, "m1", False, body)
    st.close()
    return ev, armory


def test_non_ascii_names_in_escaped_and_nfd_forms_are_scrubbed_and_guarded():
    import unicodedata
    root = _tmp()
    name = "Zo\u00ebbelle"                                    # made up; NFC form
    nfd = unicodedata.normalize("NFD", name)
    try:
        ev, armory = _one_shot(root, [
            ("status", {"player_id": "p1", "display": name}),
            ("log_data", {"chunk": f"joined {nfd} ok\n"}),                          # NFD in free text
            ("log_data", {"chunk": 'state {"x": "' + json.dumps(name)[1:-1] + '"}\n'}),   # escaped in text
        ])
        res = report.build_report(ev, root / "out", armory_path=armory, roster_path=root / "none.json")
        files = members(res.zip_path)
        blob = b"".join(files.values()).decode("utf-8", "replace").lower()
        for form in (name, nfd, json.dumps(name)[1:-1], json.dumps(nfd)[1:-1]):
            assert form.lower() not in blob, ascii(form)
        db_path = root / "c.sqlite"
        db_path.write_bytes(files["session.sqlite"])
        db = sqlite3.connect(str(db_path))
        chunks = [json.loads(b)["chunk"] for (b,) in db.execute("SELECT body FROM envelopes WHERE kind='log_data' ORDER BY id")]
        db.close()
        assert chunks == ['joined Player 1 ok\nstate {"x": "Player 1"}\n', ""], chunks   # one node: rejoined
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_a_name_split_across_two_log_chunks_is_rejoined_and_scrubbed():
    """Phones cut logs by byte count, so a name can straddle two chunks. The scrub rejoins each node's
    chunks, so the report builds; row count and seq are kept."""
    root = _tmp()
    try:
        ev, armory = _one_shot(root, [
            ("status", {"player_id": "p1", "display": "WILDCATZ"}),
            ("log_data", {"seq": 0, "chunk": "hello WILD"}),
            ("log_data", {"seq": 1, "chunk": "CATZ bye\n"}),
        ])
        res = report.build_report(ev, root / "out", armory_path=armory, roster_path=root / "none.json")
        db_path = root / "c.sqlite"
        db_path.write_bytes(members(res.zip_path)["session.sqlite"])
        db = sqlite3.connect(str(db_path))
        rows = [json.loads(b) for (b,) in db.execute("SELECT body FROM envelopes WHERE kind='log_data' ORDER BY id")]
        db.close()
        assert rows == [{"seq": 0, "chunk": "hello Player 1 bye\n"}, {"seq": 1, "chunk": ""}], rows
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_guard_still_sees_a_split_value_the_scrub_missed():
    root = _tmp()
    real = report._rejoin_log_chunks
    try:
        ev, armory = _one_shot(root, [
            ("status", {"player_id": "p1", "display": "WILDCATZ"}),
            ("log_data", {"chunk": "hello WILD"}),
            ("log_data", {"chunk": "CATZ bye\n"}),
        ])
        report._rejoin_log_chunks = lambda al, db: None
        try:
            report.build_report(ev, root / "out", armory_path=armory, roster_path=root / "none.json")
        except report.ReportLeak as e:
            assert "chunks joined" in str(e) and report.LEAK_NEXT_STEP in str(e), e
        else:
            raise AssertionError("a name split across a chunk seam must stop the report")
    finally:
        report._rejoin_log_chunks = real
        shutil.rmtree(root, ignore_errors=True)


def test_players_named_like_schema_and_config_words_still_get_a_report():
    root = _tmp()
    try:
        names = ["Max", "Node", "Match", "Team", "Kind", "Python"]
        bodies = [("status", {"player_id": f"p{i}", "display": n, "max_hp": 45, "node_id": "x", "team_id": "red"})
                  for i, n in enumerate(names)]
        ev, armory = _one_shot(root, bodies)
        st = Store("x1", ev / "session.sqlite")
        st.match_started("m1", {"mode": "tdm", "health": {"max_hp": 45, "max_armor": 70}, "team": "red"}, 1)
        st.close()
        (ev / "mc.log").write_text("node joined the match; max_hp 45\n", encoding="utf-8")
        res = report.build_report(ev, root / "out", armory_path=armory, roster_path=root / "none.json")
        files = members(res.zip_path)
        db_path = root / "c.sqlite"
        db_path.write_bytes(files["session.sqlite"])
        db = sqlite3.connect(str(db_path))
        cfg = json.loads(db.execute("SELECT config FROM matches").fetchone()[0])
        db.close()
        assert cfg["health"] == {"max_hp": 45, "max_armor": 70}, cfg
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_local_host_names_are_aliased():
    root = _tmp()
    try:
        ev, armory = _one_shot(root, [("status", {"hp": 1})])
        (ev / "mc.log").write_text("serving on http://gamebox.local:8765/ and falcon.tail9f3c.ts.net\n"
                                   "router.lan answered; nas.home.arpa too; s.lan[\"ip\"] is code\n"
                                   "try tonys-mac.local.\n",
                                   encoding="utf-8")
        (ev / "manifest.json").write_text(json.dumps({"launch_id": "launch-x", "url": "http://gamebox.local:8765/"}),
                                          encoding="utf-8")
        res = report.build_report(ev, root / "out", armory_path=armory, roster_path=root / "none.json")
        files = members(res.zip_path)
        blob = b"".join(files.values()).decode("utf-8", "replace").lower()
        for host in ("gamebox", "falcon", "tail9f3c", "router.lan", "nas.home", "tonys-mac"):
            assert host not in blob, host
        log = files["mc.log"].decode()
        assert "http://HOST-1:8765/" in log and 's.lan["ip"]' in log, log
        assert "HOST-1" in files["manifest.json"].decode()
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_dict_keys_are_not_scrubbed():
    root = _tmp()
    try:
        ev, armory = _one_shot(root, [
            ("status", {"player_id": "p1", "display": "Red Fox"}),
            ("score", {"score": {"red fox team": 3, "blue": 1}, "hp": 3}),
        ])
        # "red fox" is a name, so a KEY holding it is a leak the guard refuses rather than a key the scrub mangles
        try:
            report.build_report(ev, root / "out", armory_path=armory, roster_path=root / "none.json")
        except report.ReportLeak:
            pass
        else:
            raise AssertionError("a name inside a dict key must be refused, not silently rewritten")
        ev2, armory2 = _one_shot(root / "b", [
            ("status", {"player_id": "p1", "display": "Red"}),
            ("score", {"score": {"red": 3, "blue": 1}}),
        ])
        res = report.build_report(ev2, root / "out2", armory_path=armory2, roster_path=root / "none.json")
        db_path = root / "c.sqlite"
        db_path.write_bytes(members(res.zip_path)["session.sqlite"])
        db = sqlite3.connect(str(db_path))
        body = json.loads(db.execute("SELECT body FROM envelopes WHERE kind='score'").fetchone()[0])
        db.close()
        assert set(body["score"]) == {"red", "blue"}, body
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_readers_after_close_return_empty():
    root = _tmp()
    try:
        st = Store("s2", root / "session.sqlite")
        st.log("n", "status", 1, 1, 1, "m1", False, {"hp": 1})
        st.close()
        assert st.events() == [] and st.matches() == []
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_no_session_message_says_what_to_do():
    import os
    root = _tmp()
    old = os.environ.get("BRX_MCP_HOME")
    try:
        os.environ["BRX_MCP_HOME"] = str(root)
        try:
            report.resolve_session(None)
        except FileNotFoundError as e:
            assert "./start.sh" in str(e) and str(root) in str(e), e
        else:
            raise AssertionError("an empty home has no session")
    finally:
        if old is None:
            os.environ.pop("BRX_MCP_HOME", None)
        else:
            os.environ["BRX_MCP_HOME"] = old
        shutil.rmtree(root, ignore_errors=True)


def test_a_name_only_ever_split_across_a_chunk_seam_is_learned_and_scrubbed():
    root = _tmp()
    try:
        ev, armory = _one_shot(root, [
            ("log_data", {"seq": 0, "chunk": 'state {"player":{"disp'}),
            ("log_data", {"seq": 1, "chunk": 'lay":"QUILLONE"}}\n', "last": True}),
        ])
        res = report.build_report(ev, root / "out", armory_path=armory, roster_path=root / "none.json")
        blob = b"".join(members(res.zip_path).values()).decode("utf-8", "replace").lower()
        assert "quillone" not in blob and res.removed.get("player_name"), res.removed
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_uploads_are_rejoined_separately():
    """seq restarts per upload: a new group at seq 0 or after `last`, so two uploads stay two logs."""
    root = _tmp()
    try:
        ev, armory = _one_shot(root, [
            ("log_data", {"seq": 0, "chunk": "first a", "last": False}),
            ("log_data", {"seq": 1, "chunk": "first b\n", "last": True}),
            ("log_data", {"seq": 0, "chunk": "second\n", "last": True}),
        ])
        res = report.build_report(ev, root / "out", armory_path=armory, roster_path=root / "none.json")
        db_path = root / "c.sqlite"
        db_path.write_bytes(members(res.zip_path)["session.sqlite"])
        db = sqlite3.connect(str(db_path))
        chunks = [json.loads(b)["chunk"] for (b,) in db.execute("SELECT body FROM envelopes ORDER BY id")]
        db.close()
        assert chunks == ["first afirst b\n", "", "second\n"], chunks
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_a_player_named_death_does_not_rewrite_envelope_kinds():
    root = _tmp()
    try:
        ev, armory = _one_shot(root, [
            ("status", {"player_id": "p1", "display": "Death", "arm_state": "live", "alive": True}),
            ("death", {"player_id": "p1", "note": "Death went down"}),
        ])
        st = Store("x1", ev / "session.sqlite")
        st.match_started("m1", {"mode": "tdm"}, 0)
        st.close()
        res = report.build_report(ev, root / "out", armory_path=armory, roster_path=root / "none.json")
        files = members(res.zip_path)
        assert json.loads(files["diag.json"])[0]["deaths"] == 1, files["diag.json"][:400]
        db_path = root / "c.sqlite"
        db_path.write_bytes(files["session.sqlite"])
        db = sqlite3.connect(str(db_path))
        kinds = [k for (k,) in db.execute("SELECT kind FROM envelopes ORDER BY id")]
        note = json.loads(db.execute("SELECT body FROM envelopes WHERE kind='death'").fetchone()[0])["note"]
        db.close()
        assert kinds == ["status", "death"] and note == "Player 1 went down", (kinds, note)
    finally:
        shutil.rmtree(root, ignore_errors=True)
