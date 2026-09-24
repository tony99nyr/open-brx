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

    The enrolled list is one node_id per line, appended as keys are issued (no whole-file rewrite). It is
    created, empty, together with the secret. A secret that exists with the list missing or unreadable
    means the record of who already has a key is lost, so this run FAILS CLOSED: it issues no keys at
    all, and says how to reset. Treating it as "nobody enrolled" would let anyone collect any key."""

    def __init__(self, data_dir: Path | None = None, *, install_secret: bytes | None = None,
                 cap: int = ENROLLED_CAP, now: Callable[[], float] = time.monotonic):
        self.data_dir = Path(data_dir) if data_dir is not None else None
        self.now = now
        self.cap = cap
        self.enrolled: set[str] = set()
        self.closed_reason: str | None = None
        self._by_peer: dict[str, deque] = {}
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
        self.enrolled = {ln.strip() for ln in text.splitlines() if valid_node_id(ln.strip())}

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

    def _rate_ok(self, peer: str | None) -> bool:
        q = self._by_peer.setdefault(peer or "?", deque())
        t = self.now()
        while q and t - q[0] > ENROL_WINDOW_S:
            q.popleft()
        if len(q) >= ENROL_PER_PEER:
            return False
        q.append(t)
        return True

    def enroll(self, node_id: str, peer: str | None = None) -> str | None:
        """The key for a node_id that has never had one, recorded as issued; None otherwise.
        `peer` = the socket's address: at most ENROL_PER_PEER issues per ENROL_WINDOW_S from one address."""
        if not valid_node_id(node_id) or node_id in self.enrolled:
            return None
        if len(self.enrolled) >= self.cap:
            if not self.closed_reason:
                log.warning("trust registry full (%d), so node %s gets no trust key", self.cap, node_id)
            return None
        if not self._rate_ok(peer):
            log.warning("trust key rate limit (%d per %ds) hit for peer %s; node %s gets none",
                        ENROL_PER_PEER, ENROL_WINDOW_S, peer, node_id)
            return None
        if self.data_dir is not None:
            try:
                with open(self.data_dir / ENROLLED_FILE, "a", encoding="utf-8") as f:
                    f.write(node_id + "\n")
                    f.flush()
                    os.fsync(f.fileno())
            except Exception as e:
                log.warning("could not append to %s (%s), so node %s gets no trust key", ENROLLED_FILE, e, node_id)
                return None
        self.enrolled.add(node_id)
        return self.key_for(node_id)

    def secret_values(self, node_ids) -> list[str]:
        """What the bug-report guard must never find: the secret and every trust key it can name."""
        return [b64url(self.secret), *(self.key_for(n) for n in set(node_ids) | self.enrolled)]
