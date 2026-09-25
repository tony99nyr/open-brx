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
    net.trust.confirm("node-n1")                        # the cap counts only ids that bound (F346 b)
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
        before = lst.read_text(encoding="utf-8")
        assert [ln.split()[0] for ln in before.splitlines()] == ["node-cc", "node-aa", "node-bb"], before
        reg.confirm("node-aa")
        assert lst.read_text(encoding="utf-8") == before + "node-aa b\n", "a bind appends, it does not rewrite"
        again = TrustRegistry(root)
        assert again.enrolled == {"node-cc", "node-aa", "node-bb"} and again.bound == {"node-aa"}
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


def test_a_failed_append_is_cut_back_so_disk_and_memory_agree():
    """F362 (m): a write or an fsync that fails after part of the line reached the file left it there. A
    torn line then joined the next append onto it, and a whole `b` line left disk and memory apart."""
    root = _tmp()
    real_fsync = mcid.os.fsync
    try:
        reg = TrustRegistry(root)
        assert reg.enroll("node-aa")
        lst = root / mcid.ENROLLED_FILE
        before = lst.read_text(encoding="utf-8")

        def boom(_fd):
            raise OSError("disk full")
        mcid.os.fsync = boom
        reg.confirm("node-aa")                                # the `b` line is written, then fsync fails
        assert reg.enroll("node-bb") is None, "no key when the line could not be made durable"
        mcid.os.fsync = real_fsync
        assert lst.read_text(encoding="utf-8") == before, "the failed lines were cut back off the list"
        assert reg.bound == set() and "node-aa" in reg.unbound
        again = TrustRegistry(root)
        assert again.bound == reg.bound and set(again.unbound) == set(reg.unbound), "disk and memory agree"
    finally:
        mcid.os.fsync = real_fsync
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


# ---------------- F346 (a): the same key again, only to the hello that holds the enrol nonce ----------------

class _DroppingWS(_FakeWS):
    async def send(self, text):
        raise ConnectionError("the socket dropped before the welcome went out")


def _hello_drop(net: NetServer, **body) -> None:
    b = {"node_id": "node-a", "node_type": "phone", "app_ver": "0.4.11+test", "seq_next": 1, **body}

    async def go():
        net._loop = asyncio.get_running_loop()
        try:
            await net._on_hello(_DroppingWS(), E.make_envelope("hello", b))
        except ConnectionError:
            pass
    asyncio.run(go())


def _stale(net: NetServer, nid: str = "node-a") -> None:
    rec = net.nodes[nid]                                 # the phone redials once its old record is stale
    rec.ws, rec.last_seen = None, rec.last_seen - 3600


NONCE = b64url(bytes(range(16)))


def test_a_dropped_enrolling_welcome_is_re_issued_to_the_hello_with_the_same_nonce():
    net = NetServer()
    _hello_drop(net, mc_enroll=True, mc_enroll_nonce=NONCE)   # MC recorded the issue; the phone never saw it
    _stale(net)
    assert "mc_trust" not in _hello(net, mc_enroll=True, mc_enroll_nonce=b64url(bytes(16))), "a wrong nonce gets nothing"
    _stale(net)
    w = _hello(net, mc_enroll=True, mc_enroll_nonce=NONCE)
    assert w["mc_trust"]["key"] == net.trust.key_for("node-a")


def test_a_sent_welcome_is_re_issued_to_the_matching_nonce_too():
    """The send can reach the socket buffer and still never reach the phone, so `sent` is not `received`."""
    net = NetServer()
    w = _hello(net, mc_enroll=True, mc_enroll_nonce=NONCE)
    assert "mc_trust" in w
    w2 = _hello(net, mc_enroll=True, mc_enroll_nonce=NONCE, node_key=w["node_key"])
    assert w2["mc_trust"]["key"] == w["mc_trust"]["key"]


def test_a_phone_with_a_gun_that_lost_its_enrolling_welcome_gets_the_key_after_the_bind():
    """F346 (a): the hello that enrols a phone with a gun also binds it, so the re-issue must survive the bind."""
    net = NetServer()
    net.hydrate(lambda body: {"player": {"player_id": "p1"}} if body.get("gun") else None)
    gun = {"name": "R0XX-AB12", "tail": "AB12"}
    w = _hello(net, mc_enroll=True, mc_enroll_nonce=NONCE, gun=gun)    # sent, but the phone never saw it
    assert "mc_trust" in w and net.trust.bound == {"node-a"}
    _stale(net)
    w2 = _hello(net, mc_enroll=True, mc_enroll_nonce=NONCE, gun=gun)
    assert w2.get("mc_trust", {}).get("key") == net.trust.key_for("node-a")
    _stale(net)
    assert "mc_trust" not in _hello(net, mc_enroll=True, mc_enroll_nonce=b64url(bytes(16)), gun=gun)


def test_with_no_nonce_the_key_is_issued_once_only():
    net = NetServer()
    w = _hello(net, mc_enroll=True)                                    # an older phone: no nonce
    assert "mc_trust" in w
    assert "mc_trust" not in _hello(net, mc_enroll=True, node_key=w["node_key"])
    assert "mc_trust" not in _hello(net, mc_enroll=True, mc_enroll_nonce=NONCE, node_key=w["node_key"]), \
        "a nonce MC never stored opens nothing"


def test_the_nonce_re_issue_closes_after_the_window_and_survives_a_bind_and_an_mc_restart():
    root = _tmp()
    try:
        wall = [1_000_000.0]
        reg = TrustRegistry(root, wall=lambda: wall[0])
        assert reg.enroll("node-r1", "a", NONCE)
        assert NONCE not in (root / mcid.ENROLLED_FILE).read_text(encoding="utf-8"), "only the nonce's hash is stored"
        wall[0] += 20
        again = TrustRegistry(root, wall=lambda: wall[0])              # MC restarted in the gap
        assert again.enroll("node-r1", "b", NONCE) == again.key_for("node-r1"), "any address, the same nonce"
        wall[0] += 41
        assert again.enroll("node-r1", "a", NONCE) is None, "outside the 60 s window"
        assert again.enroll("node-r2", "a", NONCE)
        again.confirm("node-r2")
        assert again.enroll("node-r2", "a", b64url(bytes(16))) is None, "a bound id: a wrong nonce gets nothing"
        assert again.enroll("node-r2", "a") is None, "a bound id: no nonce gets nothing"
        wall[0] += 30
        third = TrustRegistry(root, wall=lambda: wall[0])              # a restart after the bind
        assert third.enroll("node-r2", "a", NONCE) == third.key_for("node-r2"), \
            "a bound id keeps its re-issue window (F346 a): the lost welcome came before the bind"
        wall[0] += 31
        assert third.enroll("node-r2", "a", NONCE) is None, "a bound id: outside the 60 s window"
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_polish_a_compaction_keeps_a_bound_ids_open_re_issue_window():
    """Polish r1 (2026-09-25): the compacted file wrote a bare bound line ahead of the `u` + `b` pair, so a restart
    after a compaction lost the window and the phone with the right nonce got no key."""
    root = _tmp()
    try:
        wall = [1_000_000.0]
        reg = TrustRegistry(root, wall=lambda: wall[0])
        assert reg.enroll("node-c1", "a", NONCE)
        reg.confirm("node-c1")
        reg._compact()
        wall[0] += 5
        again = TrustRegistry(root, wall=lambda: wall[0])
        assert again.enroll("node-c1", "a", NONCE) == again.key_for("node-c1"), "the window survives a compaction"
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_polish_an_append_that_trips_compaction_keeps_the_record_it_appended():
    """Polish r2: compaction ran inside `_append`, BEFORE `enroll` or `confirm` changed memory, so the rewrite
    dropped the record just appended. After a restart the id was unknown and could enrol again."""
    root = _tmp()
    old = mcid.COMPACT_SLACK
    try:
        mcid.COMPACT_SLACK = 0
        wall = [1_000_000.0]
        reg = TrustRegistry(root, wall=lambda: wall[0])
        reg._lines = 10**6                                   # the next append trips compaction
        key = reg.enroll("node-k1", "a", NONCE)
        assert key
        again = TrustRegistry(root, wall=lambda: wall[0])
        assert "node-k1" in again.unbound, "enroll's record survived the compaction it tripped"
        again._lines = 10**6
        again.confirm("node-k1")
        third = TrustRegistry(root, wall=lambda: wall[0])
        assert "node-k1" in third.bound, "confirm's record survived the compaction it tripped"
    finally:
        mcid.COMPACT_SLACK = old
        shutil.rmtree(root, ignore_errors=True)


# ---------------- F346 (b): only ids that bind count toward the cap; a full pool never drops ----------------

def test_a_flood_of_ids_that_never_bind_denies_enrolment_but_never_frees_an_issued_id():
    wall = [5_000_000.0]
    reg = TrustRegistry(None, cap=3, pool_cap=4, wall=lambda: wall[0])
    real_key = reg.enroll("node-real1", "10.0.0.1")
    assert real_key
    for i in range(3):                                     # a LAN host sends fake ids
        assert reg.enroll(f"node-fake{i}", "10.0.0.66")
    assert reg.enroll("node-late", "10.0.0.2") is None, "a full pool refuses new ids"
    wall[0] += 10 * 86400
    assert reg.enroll("node-late", "10.0.0.2") is None, "time never frees a slot"
    assert "node-real1" in reg.enrolled, "an issued id is never dropped"
    assert reg.enroll("node-real1", "10.0.0.66") is None, "so the flooder can never collect the real phone's key"
    # ids that bind move out of the pool and count toward the cap instead
    for n in ("node-fake1", "node-fake2", "node-real1"):
        reg.confirm(n)
    assert reg.bound == {"node-fake1", "node-fake2", "node-real1"}
    assert reg.enroll("node-more", "10.0.0.3") is None, "three bound = the cap of 3"


def test_a_bind_with_a_gun_through_the_real_hello_confirms_the_enrolment():
    net = NetServer()
    net.hydrate(lambda body: {"player": {"player_id": "p1"}} if body.get("gun") else None)
    _hello(net, node_id="node-g0", mc_enroll=True)
    assert "node-g0" in net.trust.unbound, "no gun, no player: not confirmed"
    _hello(net, node_id="node-g1", mc_enroll=True, gun={"name": "R0XX-AB12", "tail": "AB12"})
    assert net.trust.bound == {"node-g1"}


def test_the_pool_reads_back_across_a_restart():
    root = _tmp()
    try:
        reg = TrustRegistry(root, pool_cap=2)
        assert reg.enroll("node-k1", "a", NONCE) and reg.enroll("node-k2", "a")
        reg.confirm("node-k2")
        assert reg.enroll("node-k3", "a")
        again = TrustRegistry(root, pool_cap=2)
        assert again.bound == {"node-k2"} and list(again.unbound) == ["node-k1", "node-k3"], (again.bound, again.unbound)
        assert again.enroll("node-k4", "a") is None, "the pool is full after the restart too"
    finally:
        shutil.rmtree(root, ignore_errors=True)


# ---------------- enrolment hygiene: log volume, table size, tunnel buckets ----------------

class _Count(logging.Handler):
    def __init__(self):
        super().__init__()
        self.lines: list[str] = []

    def emit(self, record):
        self.lines.append(record.getMessage())


def test_a_full_pool_logs_once_a_minute_not_once_per_hello():
    t = [0.0]
    reg = TrustRegistry(None, pool_cap=1, now=lambda: t[0])
    assert reg.enroll("node-p0", "a")
    h = _Count()
    logging.getLogger("brx.mc.mcid").addHandler(h)
    try:
        for i in range(50):
            assert reg.enroll(f"node-x{i}", f"10.0.{i}.1") is None
        assert len([x for x in h.lines if "pool full" in x]) == 1, h.lines
        t[0] += mcid.REFUSAL_LOG_EVERY_S + 1
        assert reg.enroll("node-late", "10.9.9.9") is None
        pool = [x for x in h.lines if "pool full" in x]
        assert len(pool) == 2 and "49 more" in pool[-1], pool
    finally:
        logging.getLogger("brx.mc.mcid").removeHandler(h)


def test_the_per_peer_table_is_capped_and_drops_idle_addresses_first():
    t = [0.0]
    old = mcid.PEER_TABLE_CAP
    mcid.PEER_TABLE_CAP = 3
    try:
        reg = TrustRegistry(None, now=lambda: t[0])
        for i in range(3):
            assert reg.enroll(f"node-c{i}", f"10.0.0.{i}")
        assert reg.enroll("node-c3", "10.0.0.3") is None, "a full table of active addresses refuses a new one"
        assert len(reg._by_peer) == 3
        t[0] += mcid.ENROL_WINDOW_S + 1
        assert reg.enroll("node-c4", "10.0.0.4"), "idle addresses are dropped to make room"
        assert len(reg._by_peer) <= 3
    finally:
        mcid.PEER_TABLE_CAP = old


class _Headers:
    def __init__(self, items):
        self._items = items

    def items(self):
        return list(self._items)


class _TunnelWS(_FakeWS):
    remote_address = ("127.0.0.1", 51000)

    def __init__(self, cf: str | None):
        super().__init__()
        self.request_headers = _Headers([("Cf-Connecting-Ip", cf)] if cf else [])


def test_tunnel_phones_get_a_rate_bucket_each_not_one_for_the_loopback_address():
    net = NetServer()
    net._armed = True                                     # the tunnel is routing
    assert net._enrol_peer(_TunnelWS("203.0.113.7")) != net._enrol_peer(_TunnelWS("198.51.100.9"))
    assert net._enrol_peer(_FakeWS()) == "192.168.1.50", "a LAN phone keeps its address"
    net._armed = False
    assert net._enrol_peer(_TunnelWS("203.0.113.7")) == "127.0.0.1", "no tunnel: the header means nothing"
