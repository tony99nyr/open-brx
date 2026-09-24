"""A60: Mission Control's install identity (`mc/mcid.py`) and the welcome fields it drives.

The phone's half is `app/src/transport/mcproof.js`; `app/test/fixtures/mc-proof-vector.json` is the ONE
test vector both suites check, so the two formulas cannot drift apart. Everything here runs under
system python: the welcome tests drive `NetServer._on_hello` with a fake socket, no network.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import stat
import tempfile
import zipfile
from pathlib import Path

from brx_mcp.mc import envelope as E
from brx_mcp.mc import mcid
from brx_mcp.mc.mcid import TrustRegistry, b64url, b64url_decode, mc_proof, trust_key
from brx_mcp.mc.net import NetServer

VECTOR = Path(__file__).resolve().parents[2] / "app" / "test" / "fixtures" / "mc-proof-vector.json"


def _tmp() -> Path:
    return Path(tempfile.mkdtemp(prefix="brx-mc-trust-test-"))


class _FakeWS:
    remote_address = ("192.168.1.50", 40000)

    def __init__(self):
        self.sent: list[dict] = []
        self.closed = None

    async def send(self, text):
        self.sent.append(json.loads(text))

    async def close(self, code=1000, reason=""):
        self.closed = (code, reason)


def _hello(net: NetServer, **body) -> dict:
    """One hello through the real gate; returns the welcome body MC sent."""
    ws = _FakeWS()
    b = {"node_id": "node-a", "node_type": "phone", "app_ver": "0.4.11+test", "seq_next": 1, **body}

    async def go():
        net._loop = asyncio.get_running_loop()
        await net._on_hello(ws, E.make_envelope("hello", b))
    asyncio.run(go())
    assert ws.sent and ws.sent[0]["kind"] == "welcome", ws.sent
    return ws.sent[0]["body"]


def test_the_install_secret_persists_across_two_builds_with_the_same_data_dir():
    root = _tmp()
    try:
        a = NetServer(trust=TrustRegistry(root))
        b = NetServer(trust=TrustRegistry(root))
        assert a.trust.secret == b.trust.secret and len(a.trust.secret) == 32
        assert a.session_id != b.session_id, "a restart is a new session, the same install"
        f = root / mcid.SECRET_FILE
        assert f.is_file()
        if os.name == "posix":
            assert stat.S_IMODE(f.stat().st_mode) == 0o600, oct(f.stat().st_mode)
        # a different data dir is a different install
        other = _tmp()
        try:
            assert TrustRegistry(other).secret != a.trust.secret
        finally:
            shutil.rmtree(other, ignore_errors=True)
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_ephemeral_keeps_the_secret_in_memory_only():
    before = set(Path(tempfile.gettempdir()).glob("*" + mcid.SECRET_FILE + "*"))
    a, b = NetServer(), NetServer(trust=TrustRegistry(None))
    assert a.trust.secret != b.trust.secret and a.trust.data_dir is None
    assert set(Path(tempfile.gettempdir()).glob("*" + mcid.SECRET_FILE + "*")) == before


def test_trust_key_is_stable_per_node_and_different_between_nodes():
    sec = bytes(range(32))
    k1, k2 = trust_key(sec, "node-a"), trust_key(sec, "node-a")
    assert k1 == k2 and len(b64url_decode(k1)) == 32 and "=" not in k1
    assert trust_key(sec, "node-b") != k1
    assert trust_key(bytes(32), "node-a") != k1, "another install, another key"


def test_the_shared_vector_matches_the_phone_formula():
    v = json.loads(VECTOR.read_text(encoding="utf-8"))
    sec = b64url_decode(v["install_secret_b64url"])
    assert trust_key(sec, v["node_id"]) == v["trust_key"]
    assert mc_proof(v["trust_key"], v["mc_challenge"], v["session_id"]) == v["mc_proof"]
    reg = TrustRegistry(install_secret=sec)
    assert reg.proof(v["node_id"], v["mc_challenge"], v["session_id"]) == v["mc_proof"]


def test_welcome_proves_a_challenge_and_issues_the_key_once_per_node():
    root = _tmp()
    try:
        net = NetServer(trust=TrustRegistry(root))
        ch = b64url(os.urandom(16))
        w = _hello(net, mc_challenge=ch, mc_enroll=True)
        key = w["mc_trust"]["key"]
        assert key == net.trust.key_for("node-a")
        assert w["mc_proof"] == mc_proof(key, ch, net.session_id)
        # the second ask gets nothing: a rogue that learned this node_id cannot collect the key
        w2 = _hello(net, mc_enroll=True, node_key=w["node_key"])
        assert "mc_trust" not in w2 and "mc_proof" not in w2
        # ...and neither does the next launch of the same install (the enrolled list persists)
        net2 = NetServer(trust=TrustRegistry(root))
        w3 = _hello(net2, mc_challenge=ch, mc_enroll=True)
        assert "mc_trust" not in w3
        assert w3["mc_proof"] == mc_proof(key, ch, net2.session_id), "an MC restart still proves itself"
        assert w3["mc_proof"] != w["mc_proof"], "the proof is bound to the session"
        # a hello that does not ask gets no key; a new node that asks gets its own
        assert "mc_trust" not in _hello(net2, node_id="node-b")
        kb = _hello(net2, node_id="node-c", mc_enroll=True)["mc_trust"]["key"]
        assert kb != key
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_no_proof_for_a_malformed_challenge_or_a_utility():
    net = NetServer()
    for bad in ("short", "x" * 200, "has space in it......", 12345, None):
        assert "mc_proof" not in _hello(net, node_id=f"node-{abs(hash(str(bad)))}", mc_challenge=bad)
    w = _hello(net, node_id="brxu-1", node_type="utility", mc_challenge=b64url(os.urandom(16)), mc_enroll=True)
    assert "mc_proof" not in w and "mc_trust" not in w


def test_a_full_registry_issues_no_new_keys():
    net = NetServer(trust=TrustRegistry(None, cap=1))
    assert "mc_trust" in _hello(net, node_id="node-n1", mc_enroll=True)
    assert "mc_trust" not in _hello(net, node_id="node-n2", mc_enroll=True)


class _Logs(logging.Handler):
    def __init__(self):
        super().__init__()
        self.lines: list[str] = []

    def emit(self, record):
        self.lines.append(record.getMessage())


def test_a_lost_enrolled_list_beside_an_existing_secret_fails_closed_and_says_how_to_reset():
    for damage in ("missing", "unreadable"):
        root = _tmp()
        logs = _Logs()
        logging.getLogger("brx.mc.mcid").addHandler(logs)
        try:
            first = TrustRegistry(root)
            assert first.enroll("node-aa11") and first.closed_reason is None
            lst = root / mcid.ENROLLED_FILE
            lst.unlink()
            if damage == "unreadable":
                lst.mkdir()                       # reading a directory raises
            again = TrustRegistry(root)
            assert again.secret == first.secret
            assert again.enroll("node-aa11") is None, f"{damage}: a lost list must not read as nobody enrolled"
            assert again.enroll("node-bb22") is None, f"{damage}: no keys at all this run"
            assert "mc_trust" not in _hello(NetServer(trust=again), node_id="node-cc33", mc_enroll=True)
            msg = " ".join(logs.lines)
            assert "delete BOTH" in msg and mcid.SECRET_FILE in msg and mcid.ENROLLED_FILE in msg, msg
            # the reset it names works: both files gone = a new install that enrols again
            shutil.rmtree(root)
            assert TrustRegistry(root).enroll("node-aa11")
        finally:
            logging.getLogger("brx.mc.mcid").removeHandler(logs)
            shutil.rmtree(root, ignore_errors=True)


def test_only_a_phone_minted_node_id_is_enrolled():
    reg = TrustRegistry(None)
    for bad in ("n1", "brx-rogue", "node-", "node-" + "a" * 33, "node-ab/../x", "node-ab cd", "", None, 7):
        assert reg.enroll(bad) is None, bad
    assert reg.enroll("node-0a1b2c3d4e")        # what transport.js mints: node- + 10 hex


def test_enrolment_is_rate_limited_per_peer_at_30_a_minute():
    t = [1000.0]
    reg = TrustRegistry(None, now=lambda: t[0])
    assert all(reg.enroll(f"node-p{i}", "192.168.1.50") for i in range(30)), "a full portproxy field fits"
    assert reg.enroll("node-p30", "192.168.1.50") is None
    assert reg.enroll("node-q0", "192.168.1.51"), "another address has its own budget"
    t[0] += 61
    assert reg.enroll("node-p30", "192.168.1.50"), "the window slides"


def test_the_enrolled_list_is_appended_not_rewritten():
    root = _tmp()
    try:
        reg = TrustRegistry(root)
        for n in ("node-cc", "node-aa", "node-bb"):
            assert reg.enroll(n)
        lst = root / mcid.ENROLLED_FILE
        assert lst.read_text(encoding="utf-8") == "node-cc\nnode-aa\nnode-bb\n"
        assert TrustRegistry(root).enrolled == {"node-cc", "node-aa", "node-bb"}
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_the_report_zip_never_contains_the_secret_or_a_trust_key():
    from brx_mcp.mc import report
    from brx_mcp.mc.store import Store
    root = _tmp()
    old_home = os.environ.get("BRX_MCP_HOME")
    os.environ["BRX_MCP_HOME"] = str(root)
    try:
        reg = TrustRegistry(root)
        secret_text = (root / mcid.SECRET_FILE).read_text(encoding="ascii").strip()
        key = reg.key_for("node-1")
        ev = root / "sessions" / "launch-t"
        ev.mkdir(parents=True)
        st = Store("t1", ev / "session.sqlite")
        # a phone that echoed both into a log chunk, and a welcome body stored by mistake
        st.log("node-1", "log_data", 1, 1000, 1000, "m1", False,
               {"node_id": "node-1", "seq": 0, "chunk": f"12:00 key {key} secret {secret_text}\n", "last": True})
        st.log("node-1", "status", 2, 2000, 2000, "m1", False, {"mc_trust": {"key": key}, "hp": 45})
        st.close()
        (ev / "mc.log").write_text(f"install secret {secret_text}\n", encoding="utf-8")
        res = report.build_report(ev, root / "out", armory_path=root / "none.json", roster_path=root / "none.json")
        with zipfile.ZipFile(res.zip_path) as zf:
            names = zf.namelist()
            blob = b"".join(zf.read(n) for n in names).decode("utf-8", "replace")
        assert not any(mcid.SECRET_FILE in n or mcid.ENROLLED_FILE in n for n in names), names
        assert secret_text not in blob and key not in blob
        assert secret_text.lower() not in blob.lower() and key.lower() not in blob.lower()
    finally:
        if old_home is None:
            os.environ.pop("BRX_MCP_HOME", None)
        else:
            os.environ["BRX_MCP_HOME"] = old_home
        shutil.rmtree(root, ignore_errors=True)


def test_a_torn_last_line_is_ended_before_the_next_append():
    root = _tmp()
    try:
        TrustRegistry(root)                                   # a real install: secret + list
        (root / mcid.ENROLLED_FILE).write_text("node-bb", encoding="utf-8")   # crash mid-append: no newline
        reg = TrustRegistry(root)
        assert reg.enroll("node-cccc1")
        again = TrustRegistry(root)
        assert "node-cccc1" in again.enrolled and "node-bb" in again.enrolled, again.enrolled
        assert again.enroll("node-cccc1") is None, "a second issue is refused"
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_a_crash_between_creating_the_list_and_the_secret_is_a_clean_new_install():
    root = _tmp()
    real = mcid._write_private

    writes = []

    def crash_on_secret(path, data):     # the power goes after the FIRST of the two files is on disk
        writes.append(Path(path).name)
        if len(writes) == 2:
            raise OSError("power cut")
        return real(path, data)
    try:
        mcid._write_private = crash_on_secret
        try:
            mcid.load_install_secret(root)
            assert False, "the crash did not happen"
        except OSError:
            pass
    finally:
        mcid._write_private = real
    try:
        assert writes == [mcid.ENROLLED_FILE, mcid.SECRET_FILE], writes
        reg = TrustRegistry(root)
        assert reg.closed_reason is None, reg.closed_reason
        assert reg.enroll("node-dd44"), "the next launch is a clean install that issues keys"
    finally:
        shutil.rmtree(root, ignore_errors=True)
