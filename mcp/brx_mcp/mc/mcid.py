"""A60: Mission Control's install identity, so a phone can rejoin THIS MC with no tap.

MC's `session_id` is new on every launch and its join secret is readable on the LAN, so neither can
tell a phone "this is the MC you trusted". This module keeps a persisted INSTALL SECRET (32 random
bytes, `mc-install-secret` in MC's data directory, mode 600) and derives two values from it:

* `trust_key(node_id)`  = base64url(HMAC-SHA256(install_secret, "open-brx node trust v1:" + node_id)).
  MC hands it to a phone once (`welcome.mc_trust.key`, see `TrustRegistry`), and the phone keeps it.
* `mc_proof(key, challenge, session_id)` = base64url(HMAC-SHA256(key_bytes, "open-brx mc proof v1:" +
  challenge + ":" + session_id)), where `key_bytes` is the DECODED 32-byte trust key. The phone's
  `hello.mc_challenge` asks for it; the phone checks it before it processes anything else.

A phone knows only its own trust key, so it cannot impersonate MC to another phone.

**Why a key is handed out once per node_id (A60 deviation from "on every welcome").** The key is a
pure function of `node_id`, and a phone's node_id is sent in clear in every hello, including a hello
to a rogue host. If MC answered every hello with the key, a rogue could learn a phone's node_id,
hello the real MC as that node, and take home the key that proves "MC" to that phone. So MC gives
the key only to a hello that asks for it (`mc_enroll: true`) for a node_id it has never enrolled,
and appends the node_id to `mc-trust-enrolled.txt` beside the secret (fail closed if that list is lost). A phone that lost its key
falls back to one tap per join; that is the safe failure.

`--demo` / `--ephemeral` keep both in memory only (`path=None`). Neither file ever goes in a bug
report: `report.py` packs a fixed member list, and the live server adds the secret and every trust
key to the guard's search list.
"""
from __future__ import annotations

import base64
import contextlib
import hashlib
import hmac
import logging
import os
import re
import secrets
import tempfile
import time
from collections import deque
from typing import Callable
from pathlib import Path

log = logging.getLogger("brx.mc.mcid")

SECRET_FILE = "mc-install-secret"
ENROLLED_FILE = "mc-trust-enrolled.txt"
TRUST_LABEL = "open-brx node trust v1:"
PROOF_LABEL = "open-brx mc proof v1:"
SECRET_BYTES = 32
ENROLLED_CAP = 5000          # a hello flood cannot grow the file without bound; full = no new keys (fail closed)
# Enrolment rate per peer address. Every phone behind a WSL portproxy arrives from ONE address, so a
# whole field enrolling at once must fit: do not go lower than 30 a minute.
ENROL_PER_PEER = 30
ENROL_WINDOW_S = 60.0
# The per-peer rate table holds at most this many addresses. Idle ones are dropped first; a table full of
# active addresses refuses a NEW address (no key, the phone taps JOIN) rather than grow without bound.
PEER_TABLE_CAP = 1024
# A refusal that repeats (a full pool, a full registry, a rate limit) logs at most once per this many seconds.
REFUSAL_LOG_EVERY_S = 60.0
# F346 (b): enrolments that never bound a player with a gun live in a separate pool of POOL_CAP. A full
# pool refuses NEW ids; an issued id is never dropped, because a dropped id could enrol again and collect
# the same key. Only bound ids count toward ENROLLED_CAP.
POOL_CAP = 5000
# F346 (a): the same key goes again to a hello whose `mc_enroll_nonce` matches the first one, inside this window.
REISSUE_WINDOW_S = 60
COMPACT_SLACK = 256
# The node_id the phone mints (`node-` + hex, transport.js `_persistedNodeId`); nothing else is enrolled.
_NODE_ID = re.compile(r"^node-[A-Za-z0-9]{1,32}$")
# 16..64 random bytes, base64url without padding (22..86 characters). Anything else earns no proof.
_CHALLENGE = re.compile(r"^[A-Za-z0-9_-]{22,86}$")


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def b64url_decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def trust_key(install_secret: bytes, node_id: str) -> str:
    return b64url(hmac.new(install_secret, (TRUST_LABEL + node_id).encode("utf-8"), hashlib.sha256).digest())


def mc_proof(key_b64: str, challenge: str, session_id: str) -> str:
    msg = (PROOF_LABEL + challenge + ":" + session_id).encode("utf-8")
    return b64url(hmac.new(b64url_decode(key_b64), msg, hashlib.sha256).digest())


def valid_node_id(value: object) -> bool:
    return isinstance(value, str) and bool(_NODE_ID.match(value))


def valid_challenge(value: object) -> bool:
    return isinstance(value, str) and bool(_CHALLENGE.match(value))


def _write_private(path: Path, data: bytes) -> None:
    """Atomic write, mode 600 from the first byte (the temp file is created 600 by mkstemp)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(Exception):
            os.unlink(tmp)
        raise
    with contextlib.suppress(Exception):
        os.chmod(path, 0o600)


def load_install_secret(data_dir: Path | None) -> tuple[bytes, bool]:
    """(secret, created). Created on first use; `None` = in memory only (demo, ephemeral, tests)."""
    if data_dir is None:
        return secrets.token_bytes(SECRET_BYTES), True
    path = Path(data_dir) / SECRET_FILE
    try:
        raw = path.read_bytes()
        text = raw.decode("ascii").strip()
        value = b64url_decode(text)
        if len(value) == SECRET_BYTES:
            with contextlib.suppress(Exception):
                if (path.stat().st_mode & 0o077) and os.name == "posix":
                    os.chmod(path, 0o600)
            return value, False
        log.warning("%s is malformed (%d bytes): making a new one, so every phone taps JOIN once", path, len(value))
    except FileNotFoundError:
        pass
    except Exception as e:
        log.warning("%s unreadable (%s): making a new one, so every phone taps JOIN once", path, e)
    value = secrets.token_bytes(SECRET_BYTES)
    # The EMPTY enrolled list first, then the secret. A crash between the two leaves a list with no
    # secret, which the next launch reads as a clean new install. The other order would leave a secret
    # with no list, which fails closed until someone deletes the files by hand.
    _write_private(Path(data_dir) / ENROLLED_FILE, b"")
    _write_private(path, (b64url(value) + "\n").encode("ascii"))
    return value, True


def read_install_secret(data_dir: Path) -> bytes | None:
    """The persisted secret if there is a valid one; never creates it (the bug-report CLI's view)."""
    try:
        value = b64url_decode((Path(data_dir) / SECRET_FILE).read_text(encoding="ascii").strip())
        return value if len(value) == SECRET_BYTES else None
    except Exception:
        return None


class TrustRegistry:
    """The install secret plus the node_ids that already received their trust key.

    The enrolled list is appended, one record per line (a whole-file rewrite happens only to compact it,
    atomically). It is created, empty, together with the secret. A secret that exists with the list
    missing or unreadable means the record of who already has a key is lost, so this run FAILS CLOSED:
    it issues no keys at all, and says how to reset. Treating it as "nobody enrolled" would let anyone
    collect any key.

    Record lines (F346): `<id>` = BOUND (the id bound a player with a gun; a pre-F346 bare line reads the
    same, which is the safe side); `<id> u <epoch> <nonce-hash|->` = issued, not yet bound; `<id> b` = it
    bound. Anything unparsable after a valid id reads as BOUND, so a damaged line never re-opens an id.

    * **Cap (F346 b).** Only BOUND ids count toward `cap` (5000). An id that never binds sits in a pool of
      `pool_cap` (5000). A full pool refuses every NEW id (no key) and never drops an issued one: a dropped
      id could enrol again and collect the same HMAC key. A flood of fake ids is therefore a denial of
      enrolment (new phones tap JOIN) until MC's data is reset, never key theft.
    * **Re-issue (F346 a).** The phone sends a random `mc_enroll_nonce` with `mc_enroll`, and keeps it until
      a trust key arrives. MC stores the nonce's SHA-256 in the `u` record. A later hello for that id gets
      the same key again only when its nonce matches, within `REISSUE_WINDOW_S` (60 s) of the first issue,
      whether or not the id has bound since. A phone with a gun binds on the same hello that enrols it, so
      a lost welcome is always followed by a bind. That covers a welcome that never went out, one lost in the
      socket buffer, and an MC restart in the gap. No nonce, or a wrong one, gets nothing: an older phone
      keeps the A60 once-only rule.
    """

    def __init__(self, data_dir: Path | None = None, *, install_secret: bytes | None = None,
                 cap: int = ENROLLED_CAP, pool_cap: int = POOL_CAP, now: Callable[[], float] = time.monotonic,
                 wall: Callable[[], float] = time.time):
        self.data_dir = Path(data_dir) if data_dir is not None else None
        self.now = now
        self.wall = wall
        self.cap = cap
        self.pool_cap = pool_cap
        self.bound: set[str] = set()
        # id -> [issued_epoch, nonce_sha256_hex or "-"]
        self.unbound: dict[str, list] = {}
        # id -> [issued_epoch, nonce_sha256_hex]: a BOUND id's issue record, kept so the F346 (a) re-issue
        # window stays open after the bind. Only records inside REISSUE_WINDOW_S are used.
        self.bound_issue: dict[str, list] = {}
        self._lines = 0
        self.closed_reason: str | None = None
        self._by_peer: dict[str, deque] = {}
        self._last_log: dict[str, float] = {}
        self._quiet: dict[str, int] = {}
        if install_secret is not None:
            self.secret, created = install_secret, self.data_dir is None
        else:
            try:
                self.secret, created = load_install_secret(self.data_dir)
            except Exception as e:
                self.secret, created = secrets.token_bytes(SECRET_BYTES), True
                self._fail_closed(f"could not create the install identity in {self.data_dir} ({e})")
                return
        if self.data_dir is None or created:
            return
        path = self.data_dir / ENROLLED_FILE
        try:
            text = path.read_text(encoding="utf-8")
        except Exception as e:
            self._fail_closed(f"{path} is {'missing' if isinstance(e, FileNotFoundError) else 'unreadable'} ({type(e).__name__})")
            return
        if text and not text.endswith("\n"):
            # A torn last line (a crash mid-append). End it now, or the next append would glue a new
            # node_id onto it and that node would read back as never enrolled.
            try:
                with open(path, "a", encoding="utf-8") as f:
                    f.write("\n")
                    f.flush()
                    os.fsync(f.fileno())
            except Exception as e:
                self._fail_closed(f"could not repair the last line of {path} ({e})")
                return
        for ln in text.splitlines():
            self._replay(ln)
        self._prune_bound_issue()
        if self._lines > 2 * (len(self.bound) + len(self.unbound)) + COMPACT_SLACK:
            self._compact()

    @property
    def enrolled(self) -> set[str]:
        """Every id that holds a key MC will not issue again to another peer (bound or not)."""
        return self.bound | set(self.unbound)

    def _replay(self, line: str) -> None:
        parts = line.split()
        if not parts or not valid_node_id(parts[0]):
            return
        self._lines += 1
        nid, rest = parts[0], parts[1:]
        if rest and rest[0] == "u" and len(rest) == 3 and rest[1].isdigit() and nid not in self.bound:
            self.unbound[nid] = [int(rest[1]), rest[2]]
        else:                                      # a bare id, `b`, or anything unparsable: BOUND
            issue = self.unbound.pop(nid, None)
            if issue is not None and rest == ["b"]:
                self.bound_issue[nid] = issue
            self.bound.add(nid)

    def _append(self, line: str) -> bool:
        if self.data_dir is None:
            return True
        path = self.data_dir / ENROLLED_FILE
        size: int | None = None
        try:
            size = path.stat().st_size
            with open(path, "a", encoding="utf-8") as f:
                f.write(line + "\n")
                f.flush()
                os.fsync(f.fileno())
        except Exception as e:
            log.warning("could not append to %s (%s)", ENROLLED_FILE, e)
            # F362 (m): cut the file back to where it was. A torn line would join the next append onto it,
            # and a whole line the caller does not apply in memory would leave disk and memory apart.
            if size is not None:
                try:
                    os.truncate(path, size)
                except Exception as e2:
                    self._fail_closed(f"could not cut a failed append back off {path} ({e2})")
            return False
        self._lines += 1
        return True

    def _maybe_compact(self) -> None:
        """Polish r2: compact only AFTER the in-memory change the appended line records, or the rewrite drops it."""
        if self._lines > 4 * (len(self.bound) + len(self.unbound)) + COMPACT_SLACK:
            self._compact()

    def _compact(self) -> None:
        """Rewrite the list as its live records only (atomic, mode 600). A failure keeps the long file."""
        if self.data_dir is None:
            return
        # polish r1: an id with an open re-issue window is written ONLY as its `u` + `b` pair. A bare line ahead of
        # it would mark it bound first, and `_replay` would then drop the `u` line and the window with it.
        windowed = {nid for nid, (t, _h) in self.bound_issue.items() if nid in self.bound and self._in_window(t)}
        out = [*sorted(self.bound - windowed)]
        for nid, (t, nonce_h) in self.bound_issue.items():
            if nid in windowed:   # keep a bound id's open re-issue window
                out += [f"{nid} u {t} {nonce_h}", f"{nid} b"]
        for nid, (t, nonce_h) in self.unbound.items():
            out.append(f"{nid} u {t} {nonce_h}")
        try:
            _write_private(self.data_dir / ENROLLED_FILE, ("".join(x + "\n" for x in out)).encode("utf-8"))
            self._lines = len(out)
        except Exception as e:
            log.warning("could not compact %s (%s); it stays as it is", ENROLLED_FILE, e)

    def _fail_closed(self, why: str) -> None:
        self.cap = 0
        self.closed_reason = why
        d = self.data_dir
        log.warning("A60 trust registry: %s. Issuing NO trust keys this run (phones still join with a tap). "
                    "To reset, stop MC and delete BOTH %s and %s; every phone then taps JOIN once.",
                    why, d / SECRET_FILE if d else SECRET_FILE, d / ENROLLED_FILE if d else ENROLLED_FILE)

    def key_for(self, node_id: str) -> str:
        return trust_key(self.secret, node_id)

    def proof(self, node_id: str, challenge: str, session_id: str) -> str:
        return mc_proof(self.key_for(node_id), challenge, session_id)

    def _warn_limited(self, what: str, msg: str, *args) -> None:
        """One warning per `what` per REFUSAL_LOG_EVERY_S; the next one says how many were not logged."""
        t = self.now()
        last = self._last_log.get(what)
        if last is not None and t - last < REFUSAL_LOG_EVERY_S:
            self._quiet[what] = self._quiet.get(what, 0) + 1
            return
        self._last_log[what] = t
        n = self._quiet.pop(what, 0)
        log.warning(msg + (f" ({n} more like this not logged)" if n else ""), *args)

    def _rate_ok(self, peer: str | None) -> bool:
        key, t = peer or "?", self.now()
        if key not in self._by_peer and len(self._by_peer) >= PEER_TABLE_CAP:
            for k in [k for k, q in self._by_peer.items() if not q or t - q[-1] > ENROL_WINDOW_S]:
                del self._by_peer[k]
            if len(self._by_peer) >= PEER_TABLE_CAP:
                self._warn_limited("peers", "trust key rate table full (%d active addresses); a new address gets none",
                                   PEER_TABLE_CAP)
                return False
        q = self._by_peer.setdefault(key, deque())
        while q and t - q[0] > ENROL_WINDOW_S:
            q.popleft()
        if len(q) >= ENROL_PER_PEER:
            return False
        q.append(t)
        return True

    def _prune_bound_issue(self) -> None:
        self.bound_issue = {k: v for k, v in self.bound_issue.items() if v[1] != "-" and self._in_window(v[0])}

    def _in_window(self, t: float) -> bool:
        return 0 <= self.wall() - t <= REISSUE_WINDOW_S

    def _reissue_ok(self, entry: list, nonce_h: str | None, peer: str | None) -> bool:
        t, first_h = entry
        return (nonce_h is not None and first_h != "-" and hmac.compare_digest(nonce_h, first_h)
                and self._in_window(t) and self._rate_ok(peer))

    @staticmethod
    def _nonce_hash(nonce: object) -> str | None:
        """SHA-256 hex of a well-formed enrol nonce (the challenge shape); None for anything else."""
        return hashlib.sha256(str(nonce).encode("ascii")).hexdigest() if valid_challenge(nonce) else None

    def enroll(self, node_id: str, peer: str | None = None, nonce: object = None) -> str | None:
        """The key for a node_id that has never had one, recorded as issued; None otherwise.
        `peer` = the socket's address: at most ENROL_PER_PEER issues per ENROL_WINDOW_S from one address.
        `nonce` = the hello's `mc_enroll_nonce`; a matching one inside the window gets the key again (F346 a)."""
        if not valid_node_id(node_id) or self.closed_reason:
            return None
        nonce_h = self._nonce_hash(nonce)
        if node_id in self.bound:
            # F346 (a): a phone with a gun binds on the hello that enrols it, so a lost welcome must still
            # be re-issued after the bind, inside the same window and to the same nonce only.
            issue = self.bound_issue.get(node_id)
            if issue is None or not self._reissue_ok(issue, nonce_h, peer):
                return None
            log.info("node %s: re-issued its trust key to the hello that holds the enrol nonce", node_id)
            return self.key_for(node_id)
        if node_id in self.unbound:
            if not self._reissue_ok(self.unbound[node_id], nonce_h, peer):
                return None
            log.info("node %s: re-issued its trust key to the hello that holds the enrol nonce", node_id)
            return self.key_for(node_id)
        if len(self.bound) >= self.cap:
            self._warn_limited("cap", "trust registry full (%d bound), so node %s gets no trust key", self.cap, node_id)
            return None
        if len(self.unbound) >= self.pool_cap:
            self._warn_limited("pool", "trust pool full (%d ids that never bound), so node %s gets no trust key",
                               self.pool_cap, node_id)
            return None
        if not self._rate_ok(peer):
            self._warn_limited("rate", "trust key rate limit (%d per %ds) hit for peer %s; node %s gets none",
                               ENROL_PER_PEER, ENROL_WINDOW_S, peer, node_id)
            return None
        t = int(self.wall())
        if not self._append(f"{node_id} u {t} {nonce_h or '-'}"):
            log.warning("node %s gets no trust key (the enrolled list could not be written)", node_id)
            return None
        self.unbound[node_id] = [t, nonce_h or "-"]
        self._maybe_compact()
        return self.key_for(node_id)

    def confirm(self, node_id: str) -> None:
        """The id bound a player with a gun: it now counts toward the cap, not the pool (F346 b)."""
        if node_id not in self.unbound or self.closed_reason:
            return
        if self._append(f"{node_id} b"):
            issue = self.unbound.pop(node_id)
            self.bound.add(node_id)
            self._prune_bound_issue()
            if issue[1] != "-" and self._in_window(issue[0]):
                self.bound_issue[node_id] = issue
            self._maybe_compact()

    def secret_values(self, node_ids) -> list[str]:
        """What the bug-report guard must never find: the secret and every trust key it can name."""
        return [b64url(self.secret), *(self.key_for(n) for n in set(node_ids) | self.enrolled)]
