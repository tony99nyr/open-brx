"""Envelope encode / decode / validation for the node↔MC wire (contracts.md §5, net.md §8).

Pure functions, no I/O, no dependencies — importable and testable under the system python.

Wire shape::

    Envelope { v:1, kind:string, id:string, seq?:number, t:number, body:object }

Validation is deliberately permissive about *extra* fields (contracts §9: additive fields are
non-breaking, unknown fields are ignored) and strict about the fields each ``kind`` needs.
"""
from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from .types import MC_KINDS, NODE_KINDS, PROTOCOL_V

MAX_ENVELOPE_BYTES = 64 * 1024        # net.md §8 size cap
MAX_LOG_CHUNK_BYTES = 48 * 1024       # log_data chunk cap (fits under the envelope cap)
# ⚠ This is a WHITELIST and an unlisted type is REJECTED at the socket, not ignored downstream --
# so a fact the phone learns to send reaches nothing until it is named here (the F40/F60 shape:
# both ends report healthy). `possession` is the objective-mode tally (mc/API.md, F70).
PERSISTED_EVENT_TYPES = {"hit_taken", "death", "respawn", "team_change", "possession"}

# Plausibility window for `t` (Unix ms): reject obvious garbage (seconds instead of ms, negative,
# far future). A node with a wrong clock still lands inside this window; MC keeps t_recv anyway.
_T_MIN_MS = 1_500_000_000_000   # 2017-07
_T_MAX_MS = 4_000_000_000_000   # 2096

# Required body fields per kind. `event`'s body is an Event and is checked separately.
_REQUIRED: dict[str, tuple[str, ...]] = {
    # node → MC
    "hello": ("node_id", "node_type", "app_ver", "seq_next"),
    "bind": ("node_id", "gun_name", "gun_tail"),
    "event": (),
    "event_batch": ("events",),
    "status": ("node_id", "arm_state", "synced"),
    "ack_config": ("config_id", "ok"),
    "time_req": ("t_node",),
    "log_offer": ("node_id", "bytes", "lines"),
    "log_data": ("node_id", "seq", "chunk", "last"),
    "ready": ("node_id", "player_id", "ready"),
    # A10 (loadout.md §4): `id`/`try` are OPTIONAL — a required field that is absent DROPS the frame
    "loadout_request": ("node_id", "player_id", "slot", "kind"),
    "loadout_browse": ("node_id", "player_id", "open"),
    # MC → node
    "welcome": ("session_id", "server_t", "seq_hi"),
    "assign": ("player", "team", "roster"),
    "tutorial": ("frames",),   # weapon optional: end-of-try-out pushes {end, frames} only (2026-08-26)
    "config": ("config", "frames", "roster"),
    "start": ("match_id", "go_live_t", "config_id", "seq", "countdown_s"),
    "feedback": ("player_id", "kind", "t"),
    "control": ("cmd",),
    "time_res": ("t_node", "server_t"),
    "pull_log": (),
    "ack": ("seq_hi",),
    "apply": ("frames",),   # A6: best-effort "write these frames now" (coverage-zone runtime effects)
    "loadout_ack": ("slot", "ok"),   # A10: `reason`/`loadout` optional
    "score": ("player_id",), # A7: MC pushes a player's current ScoreRow to its node (coverage-zone live K/A/ACC)
    # A11.4: a named game event. `hud`/`player_id_subject`/`carrier`/`flag_tid` are optional (contracts.md
    # §MC->node). Registered 2026-09-07 alongside the missing MC_KINDS entry -- until then every alert
    # MC sent was rejected at the node and dropped in silence.
    "alert": ("kind", "text", "player_id", "t"),
    # A13.5 (F104): the arming message. `threshold` / `game` / `valid_ids` are optional (utility.md §5c).
    "station_config": ("kind", "team", "id"),
}

_EVENT_REQUIRED: dict[str, tuple[str, ...]] = {
    "hit_taken": ("shooter_num", "shooter_team", "dmg"),
    "death": ("shooter_num", "shooter_team"),
    "respawn": (),
    "team_change": ("tid",),
    # F70: a CUMULATIVE per-team tally for one control point. `site` and `observed_ms` are optional
    # (a single grenade has one point, and a node that cannot say how long it watched still reports
    # what it saw); `hold_ms` is the fact itself, so it is required.
    "possession": ("hold_ms",),
}


class EnvelopeError(ValueError):
    """A frame that failed validation. `.reason` is a short machine-readable tag."""

    def __init__(self, reason: str, detail: str = ""):
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason = reason
        self.detail = detail


@dataclass
class MalformedCounter:
    """Counts malformed frames per socket; `too_many()` answers the net.md §8 quarantine rule
    (> ~20 malformed frames per second → close the socket)."""

    limit_per_s: int = 20
    total: int = 0
    _window: list[float] = field(default_factory=list)

    def hit(self, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        self.total += 1
        self._window.append(now)
        cutoff = now - 1.0
        self._window = [t for t in self._window if t >= cutoff]

    def too_many(self) -> bool:
        return len(self._window) > self.limit_per_s


def now_ms() -> int:
    return int(time.time() * 1000)


def make_envelope(kind: str, body: dict[str, Any], *, seq: int | None = None,
                  t: int | None = None, env_id: str | None = None) -> dict[str, Any]:
    env: dict[str, Any] = {
        "v": PROTOCOL_V,
        "kind": kind,
        "id": env_id or uuid.uuid4().hex[:12],
        "t": now_ms() if t is None else int(t),
        "body": body,
    }
    if seq is not None:
        env["seq"] = int(seq)
    return env


def encode(env: dict[str, Any]) -> str:
    text = json.dumps(env, separators=(",", ":"))
    if len(text.encode("utf-8")) > MAX_ENVELOPE_BYTES:
        raise EnvelopeError("oversize", f"{len(text)} bytes > {MAX_ENVELOPE_BYTES}")
    return text


def validate_event(ev: Any, *, require_seq_on: dict[str, Any] | None = None) -> dict[str, Any]:
    """Validate a persisted Event body (contracts §4). Returns the event dict."""
    if not isinstance(ev, dict):
        raise EnvelopeError("bad_event", "event body is not an object")
    etype = ev.get("type")
    if etype not in PERSISTED_EVENT_TYPES:
        raise EnvelopeError("bad_event", f"type {etype!r} is not a persisted fact")
    for key in ("t", "node_id", "player_id"):
        if key not in ev:
            raise EnvelopeError("bad_event", f"missing {key}")
    if "match_id" not in ev:
        raise EnvelopeError("bad_event", "missing match_id")
    for key in _EVENT_REQUIRED[etype]:
        if key not in ev:
            raise EnvelopeError("bad_event", f"{etype} missing {key}")
    if not isinstance(ev["t"], (int, float)):
        raise EnvelopeError("bad_event", "t is not a number")
    if etype in ("hit_taken", "death"):
        num = ev["shooter_num"]
        if not isinstance(num, int) or not 0 <= num <= 63:
            raise EnvelopeError("bad_event", f"shooter_num {num!r} out of 0..63")
    return ev


def validate(env: Any, *, direction: str = "node") -> dict[str, Any]:
    """Validate a decoded envelope. `direction` = "node" (node→MC) or "mc" (MC→node).

    Raises EnvelopeError with reason ∈ {not_object, version, unknown_kind, missing_field,
    bad_t, bad_event, oversize}.
    """
    if not isinstance(env, dict):
        raise EnvelopeError("not_object")
    v = env.get("v")
    if v != PROTOCOL_V:
        raise EnvelopeError("version", f"v={v!r}, expected {PROTOCOL_V}")
    kind = env.get("kind")
    allowed = NODE_KINDS if direction == "node" else (MC_KINDS | {"apply"})
    if kind not in allowed:
        raise EnvelopeError("unknown_kind", repr(kind))
    if not isinstance(env.get("id"), str) or not env["id"]:
        raise EnvelopeError("missing_field", "id")
    t = env.get("t")
    if not isinstance(t, (int, float)) or not (_T_MIN_MS <= t <= _T_MAX_MS):
        raise EnvelopeError("bad_t", repr(t))
    body = env.get("body")
    if not isinstance(body, dict):
        raise EnvelopeError("missing_field", "body")
    for key in _REQUIRED[kind]:
        if key not in body:
            raise EnvelopeError("missing_field", f"{kind}.{key}")

    if kind == "event":
        if "seq" not in env or not isinstance(env["seq"], int):
            raise EnvelopeError("missing_field", "event.seq (envelope)")
        validate_event(body)
    elif kind == "event_batch":
        events = body["events"]
        if not isinstance(events, list):
            raise EnvelopeError("bad_event", "events is not a list")
        for item in events:
            if not isinstance(item, dict) or not isinstance(item.get("seq"), int):
                raise EnvelopeError("bad_event", "batch item missing seq")
            validate_event(item)
    elif kind == "status":
        if "seq" in env:
            raise EnvelopeError("bad_event", "status must not carry seq")
    elif kind == "apply":
        if not isinstance(body["frames"], list) or not all(isinstance(f, str) for f in body["frames"]):
            raise EnvelopeError("missing_field", "apply.frames must be a list of frame strings")
    elif kind == "log_data":
        chunk = body["chunk"]
        if not isinstance(chunk, str) or len(chunk.encode("utf-8")) > MAX_LOG_CHUNK_BYTES:
            raise EnvelopeError("oversize", "log_data chunk > 48 KB")
    elif kind == "control":
        from .types import CONTROL_CMDS
        if body["cmd"] not in CONTROL_CMDS:
            raise EnvelopeError("missing_field", f"control.cmd {body['cmd']!r}")
    return env


def decode(text: str | bytes, *, direction: str = "node") -> dict[str, Any]:
    """bytes/str → validated envelope. Size cap is enforced before parsing."""
    raw = text if isinstance(text, (bytes, bytearray)) else text.encode("utf-8")
    if len(raw) > MAX_ENVELOPE_BYTES:
        raise EnvelopeError("oversize", f"{len(raw)} bytes > {MAX_ENVELOPE_BYTES}")
    try:
        env = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as e:
        raise EnvelopeError("not_object", f"json: {e}") from None
    return validate(env, direction=direction)
