"""The utility-item advert codec (docs/spec/utility.md §2), Python twin of app/src/beacon.js.

One 128-bit service UUID carries a station's or a player's identity between phones. MC needs the codec
to list stations at muster and to read revives at recap; the bench needs it to stand in for a phone.
The layout is pinned against the JS vectors in tests/test_beacon.py so the two never drift.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Optional

# The advert constants are the generated contract's names, read here directly (DRY review 2026-10-10 #4: no alias
# layer). ADVERT_MAGIC is 'OBRX'. Every ADVERT_PLAYER_STATE bit, `revived` (64) included: reserved post-MVP (F344),
# read by the Stick, never set by the phone.
from .mc.types import ADVERT_MAGIC, ADVERT_PLAYER_STATE, ADVERT_ROLE, ADVERT_VERSION, STATION_TEAM_ANY

ROLE_NAME = {v: k for k, v in ADVERT_ROLE.items()}
KIND = {"respawn": 1, "powerup": 2, "extraction": 3, "bomb": 4, "control": 5}
KIND_NAME = {v: k for k, v in KIND.items()}


@dataclass
class Advert:
    role: str
    id: int
    kind: Optional[str] = None
    team: int = STATION_TEAM_ANY
    state: int = 0
    value: int = 0
    seq: int = 0
    game: int = 0
    threshold: int = 0          # dBm, int8; 0 = scanner default
    taker: int = 0              # byte 15, A56: a powerup station's winner (player_num), 0 = none
    # F658 (A86): a PLAYER's scope. Byte 8 is the kind mask (ADVERT_SCOPE_KIND), bytes 6 (high) and 15 (low) the
    # 16-bit map of station ids in play, bit (id % 16); a player's id is byte 7 alone. 0 on a station advert.
    scope_kinds: int = 0
    scope: int = 0

    def describe(self) -> str:
        team = "any" if self.team == STATION_TEAM_ANY else str(self.team)
        if self.role == "station":
            thr = f" thr={self.threshold}" if self.threshold else ""
            return f"station {self.id} {self.kind} team={team} state={self.state} value={self.value} seq={self.seq}{thr}"
        flags = [n for n, bit in ADVERT_PLAYER_STATE.items() if self.state & bit]
        return f"player {self.id} team={team} {' '.join(flags) or 'down'} seq={self.seq}"


def encode(role: str, id: int, kind: str | int | None = None, team: int = STATION_TEAM_ANY, state: int = 0,
           value: int = 0, seq: int = 0, game: int = 0, threshold: int = 0, taker: int = 0,
           scope_kinds: int = 0, scope: int = 0) -> str:
    r = ADVERT_ROLE[role]
    k = KIND.get(kind, 0) if isinstance(kind, str) else int(kind or 0)
    thr = 0
    if threshold:
        thr = (256 + max(-128, round(threshold))) if threshold < 0 else min(127, round(threshold))
    player = r == ADVERT_ROLE["player"]   # A86: a player's bytes 6, 8 and 15 carry its scope
    b6 = (scope >> 8) & 0xFF if player else (id >> 8) & 0xFF
    b8 = scope_kinds & 0xFF if player else k & 0xFF
    b15 = scope & 0xFF if player else taker & 0xFF
    b = bytes([*ADVERT_MAGIC, ADVERT_VERSION, r, b6, id & 0xFF, b8, team & 0xFF, state & 0xFF,
               value & 0xFF, seq & 0xFF, game & 0xFF, thr & 0xFF, b15])
    h = b.hex()
    return f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


def decode(uuid: str) -> Optional[Advert]:
    """An Advert, or None when the UUID is not an Open BRX advert (any case, dashes optional)."""
    h = str(uuid or "").replace("-", "").lower()
    if not re.fullmatch(r"[0-9a-f]{32}", h):
        return None
    b = bytes.fromhex(h)
    if b[:4] != bytes(ADVERT_MAGIC) or b[4] != ADVERT_VERSION:
        return None
    role = ROLE_NAME.get(b[5])
    if role is None:
        return None
    thr = b[14] - 256 if b[14] > 127 else b[14]
    if role == "player":   # A86: the player id is byte 7 alone; bytes 6, 8 and 15 are its scope
        return Advert(role=role, id=b[7], kind=None, team=b[9], state=b[10], value=b[11], seq=b[12], game=b[13],
                      threshold=thr, taker=0, scope_kinds=b[8], scope=(b[6] << 8) | b[15])
    return Advert(role=role, id=(b[6] << 8) | b[7], kind=KIND_NAME.get(b[8], f"kind{b[8]}"),
                  team=b[9], state=b[10], value=b[11], seq=b[12], game=b[13], threshold=thr, taker=b[15])


def decode_any(uuids) -> Optional[Advert]:
    for u in uuids or ():
        a = decode(u)
        if a:
            return a
    return None
