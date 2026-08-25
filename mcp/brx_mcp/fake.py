"""FakeTagger — an in-memory BRX emulator for hardware-free testing.

Models a gun's state and its wire behaviour (config frames, `$SPAWN`/`$LIFE`,
`$VERSION`/`$VOLTS`, and — the point — producing `$HIR`+`$HP` when it's "shot").
`FakeConnectionManager` presents the same surface `run_live`/the game loop uses
(scan/connect/send/sessions/get_events/disconnect) plus `inject_hit`/`inject_kill`
to simulate shooting. Together they let the ENTIRE live path (`run_live`, the
driver, scoring, respawn, teardown) run in CI with no Bluetooth and no bench.

No bleak import — built on `protocol.BufferedEvent`/`parse_event`, so it loads
anywhere (WSL/CI included).
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .protocol import BufferedEvent, parse_event


def _toks(frame: str) -> list[str]:
    return frame.strip().lstrip("$").rstrip("*").rstrip(",").split(",")


def _int(tok: str | None):
    if tok is None:
        return None
    t = tok.strip()
    return int(t) if t.lstrip("-").isdigit() else None


class FakeTagger:
    """One emulated gun. Feed it frames with `write`; shoot it with `receive_ir`."""

    def __init__(self, address: str, name: str | None = None, hp: int = 45,
                 armor: int = 70, team: int = 0, damage: int = 25,
                 friendly_fire: bool = False):
        self.address = address
        self.name = name or f"FAKE-{address[-4:]}"
        self.cfg_hp, self.cfg_armor, self.cfg_shield = hp, armor, 0
        self.hp, self.armor, self.shield = hp, armor, 0
        self.team = team
        self.alive = True
        self.damage = damage
        self.friendly_fire = friendly_fire  # set from $GSET token1 when a game configs it
        self._tap = False                   # $PHONE opens the event tap (models the ritual)
        self._out: list[str] = []          # queued rx frames (tagger→host)

    # -- host → tagger ------------------------------------------------------- #
    def write(self, frame: str) -> None:
        t = _toks(frame)
        cmd = t[0] if t else ""
        if cmd == "VERSION":
            if self._tap:                           # cold $VERSION gets no reply (exp-log 8-24)
                self._out.append("$VERSION,v4.32,?,4,,devhost.03,*")
        elif cmd == "PHONE":
            self._tap = True                        # open the event tap → VERSION/VOLTS answer
            self._out.append("$BUT,3,0,*")
            self._out.append("$VOLTS,7500,3900,55,70,*")
        elif cmd == "PING":
            pass                            # real firmware doesn't $PONG — match it
        elif cmd == "TID":
            v = _int(t[1]) if len(t) > 1 else None
            if v is not None:
                self.team = v
        elif cmd == "GSET":                 # GSET,friendlyFire,outdoor,... (token1)
            self.friendly_fire = len(t) > 1 and t[1] == "1"
        elif cmd == "PSET":                 # PSET,0,0,hp,armor,shield,...
            for idx, attr in ((3, "cfg_hp"), (4, "cfg_armor"), (5, "cfg_shield")):
                v = _int(t[idx]) if idx < len(t) else None
                if v is not None:
                    setattr(self, attr, v)
        elif cmd == "SPAWN":
            self.alive = True
            self.hp, self.armor, self.shield = self.cfg_hp, self.cfg_armor, self.cfg_shield
            self._out.append(f"$LCD,{self.hp},{self.armor},0,0,0,0,*")
        elif cmd == "LIFE":                  # additive, clamped
            self.hp = min(self.cfg_hp, self.hp + (_int(t[1] if len(t) > 1 else None) or 0))
            self.armor = min(self.cfg_armor, self.armor + (_int(t[2] if len(t) > 2 else None) or 0))
            if self.hp > 0:
                self.alive = True
        # all other config frames (CLEAR/START/GSET/WEAP/SIR/BMAP/VOL/AMMO/PLAY…) accepted

    # -- IR hit → events ----------------------------------------------------- #
    def receive_ir(self, shooter_team: int) -> None:
        """Take a hit from `shooter_team`: emit `$HIR` then `$HP` (0 = died).
        No-op if dead, or a same-team hit while friendly-fire is off (the real gun
        ignores teammate IR unless FF is enabled via $GSET). With FF on, a same-team
        hit DOES damage — the host engine then declines to credit it as a kill."""
        if not self.alive:
            return
        if shooter_team == self.team and not self.friendly_fire:
            return
        d = self.damage
        if self.armor >= d:
            self.armor -= d
        else:
            d -= self.armor
            self.armor = 0
            self.hp -= d
        self._out.append(f"$HIR,0,0,0,{shooter_team},9,0,3,*")
        if self.hp <= 0:
            self.hp = 0
            self.alive = False
            self._out.append(f"$HP,0,{self.armor},{self.shield},*")
        else:
            self._out.append(f"$HP,{self.hp},{self.armor},{self.shield},*")

    def drain(self) -> list[str]:
        out, self._out = self._out, []
        return out


@dataclass
class _FakeSession:
    alias: str
    address: str
    seq: int = 0
    buffer: list = field(default_factory=list)

    def record(self, direction: str, raw: str) -> BufferedEvent:
        self.seq += 1
        ev = BufferedEvent(seq=self.seq, t_ms=0, direction=direction, raw=raw,
                           parsed=parse_event(raw) if direction == "rx" else {})
        self.buffer.append(ev)
        return ev


class FakeConnectionManager:
    """Drop-in for `ConnectionManager` over the game path — pass to `run_live(...,
    manager=mgr)`. Backed by `FakeTagger`s; `inject_hit`/`inject_kill` simulate shots."""

    def __init__(self, taggers: list[FakeTagger]):
        self.taggers = {t.address: t for t in taggers}
        self.sessions: dict[str, _FakeSession] = {}
        self.dropped: set[str] = set()          # aliases whose BLE link has "dropped"
        self.fail_connect: set[str] = set()     # addresses whose connect() will fail

    async def scan(self, duration_s: int = 8) -> list[dict]:
        return [{"name": t.name, "address": a, "rssi": -50, "has_uart_service": True}
                for a, t in self.taggers.items()]

    async def connect(self, address: str, alias: str, **_) -> dict:
        if alias in self.sessions:                  # mirror the real manager (catches a
            raise ValueError(f"alias '{alias}' already connected")  # missing disconnect)
        if address in self.fail_connect:            # simulate a gun that won't come up
            raise ConnectionError(f"could not connect to {address}")
        self.dropped.discard(alias)                 # a (re)connect heals a recoverable drop
        self.sessions[alias] = _FakeSession(alias=alias, address=address)
        return {"alias": alias, "address": address, "connected": True}

    def is_connected(self, alias: str) -> bool:
        return alias in self.sessions and alias not in self.dropped

    async def wait_for(self, alias: str, prefix: str, timeout_s: int = 0) -> dict:
        """Scan the session buffer for an rx frame starting with `prefix`. The fake
        delivers replies synchronously on send(), so the frame is already buffered —
        return the latest match (or unmatched). Mirrors ConnectionManager.wait_for's
        result shape for the shared diagnostics flow."""
        s = self.sessions.get(alias)
        if s is not None:
            for e in reversed(s.buffer):
                if e.direction == "rx" and e.raw.startswith(prefix):
                    return {"matched": True, "event": e.to_dict()}
        return {"matched": False}

    async def send(self, alias: str, command: str, reply_window_ms: int = 0) -> dict:
        if alias in self.dropped:            # writing to a dropped link fails (real BLE raises)
            raise ConnectionError(f"link dropped: {alias}")
        s = self.sessions[alias]
        s.record("tx", command)
        tagger = self.taggers[s.address]
        tagger.write(command)
        replies = tagger.drain()
        for r in replies:
            s.record("rx", r)
        return {"sent": command, "replies_within_window": []}

    def get_events(self, alias: str, since_seq: int = 0, max_events: int = 200) -> dict:
        if alias in self.dropped:            # a dropped link goes silent (no new events)
            return {"events": []}
        s = self.sessions[alias]
        evs = [e.to_dict() for e in s.buffer if e.seq > since_seq][:max_events]
        return {"events": evs}

    def drop(self, alias: str) -> None:
        """Simulate a mid-game BLE drop: writes to this alias raise, reads go silent,
        and it can't be shot any more. Use to test that a game survives a lost link."""
        self.dropped.add(alias)

    async def disconnect(self, alias: str) -> dict:
        self.sessions.pop(alias, None)
        return {"alias": alias, "disconnected": True}

    # -- simulate shooting --------------------------------------------------- #
    def inject_hit(self, victim_alias: str, shooter_team: int) -> None:
        if victim_alias in self.dropped:     # a dropped gun can't report a hit
            return
        s = self.sessions[victim_alias]
        tagger = self.taggers[s.address]
        tagger.receive_ir(shooter_team)
        for r in tagger.drain():
            s.record("rx", r)

    def inject_kill(self, victim_alias: str, shooter_team: int, max_hits: int = 30) -> None:
        """Shoot until the victim is down (one clean kill)."""
        tagger = self.taggers[self.sessions[victim_alias].address]
        n = 0
        while tagger.alive and n < max_hits:
            self.inject_hit(victim_alias, shooter_team)
            n += 1
