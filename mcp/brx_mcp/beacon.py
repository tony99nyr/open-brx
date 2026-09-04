"""The utility-item advert codec (docs/spec/utility.md §2), Python twin of app/src/beacon.js.

One 128-bit service UUID carries a station's or a player's identity between phones. MC needs the codec
to list stations at muster and to read revives at recap; the bench needs it to stand in for a phone.
The layout is pinned against the JS vectors in tests/test_beacon.py so the two never drift.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

MAGIC = bytes((0x4F, 0x42, 0x52, 0x58))          # 'OBRX'
VERSION = 1
ROLE = {"station": 1, "player": 2}
ROLE_NAME = {v: k for k, v in ROLE.items()}
KIND = {"respawn": 1, "powerup": 2, "extraction": 3, "bomb": 4, "control": 5}
KIND_NAME = {v: k for k, v in KIND.items()}
TEAM_ANY = 255
PLAYER_STATE = {"alive": 1, "planting": 2, "defusing": 4, "extracting": 8}


@dataclass
class Advert:
    role: str
    id: int
    kind: Optional[str] = None
    team: int = TEAM_ANY
    state: int = 0
    value: int = 0
    seq: int = 0
    game: int = 0
    threshold: int = 0          # dBm, int8; 0 = scanner default

    def describe(self) -> str:
        team = "any" if self.team == TEAM_ANY else str(self.team)
        if self.role == "station":
            thr = f" thr={self.threshold}" if self.threshold else ""
            return f"station {self.id} {self.kind} team={team} state={self.state} value={self.value} seq={self.seq}{thr}"
        flags = [n for n, bit in PLAYER_STATE.items() if self.state & bit]
        return f"player {self.id} team={team} {' '.join(flags) or 'down'} seq={self.seq}"


def encode(role: str, id: int, kind: str | int | None = None, team: int = TEAM_ANY, state: int = 0,
           value: int = 0, seq: int = 0, game: int = 0, threshold: int = 0) -> str:
    r = ROLE[role]
    k = KIND.get(kind, 0) if isinstance(kind, str) else int(kind or 0)
    thr = 0
    if threshold:
        thr = (256 + max(-128, round(threshold))) if threshold < 0 else min(127, round(threshold))
    b = bytes([*MAGIC, VERSION, r, (id >> 8) & 0xFF, id & 0xFF, k & 0xFF, team & 0xFF, state & 0xFF,
               value & 0xFF, seq & 0xFF, game & 0xFF, thr & 0xFF, 0])
    h = b.hex()
    return f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


def decode(uuid: str) -> Optional[Advert]:
    """An Advert, or None when the UUID is not an Open BRX advert (any case, dashes optional)."""
    h = str(uuid or "").replace("-", "").lower()
    if len(h) != 32:
        return None
    try:
        b = bytes.fromhex(h)
    except ValueError:
        return None
    if b[:4] != MAGIC or b[4] != VERSION:
        return None
    role = ROLE_NAME.get(b[5])
    if role is None:
        return None
    thr = b[14] - 256 if b[14] > 127 else b[14]
    return Advert(role=role, id=(b[6] << 8) | b[7], kind=KIND_NAME.get(b[8], f"kind{b[8]}") if role == "station" else None,
                  team=b[9], state=b[10], value=b[11], seq=b[12], game=b[13], threshold=thr)


def decode_any(uuids) -> Optional[Advert]:
    for u in uuids or ():
        a = decode(u)
        if a:
            return a
    return None
