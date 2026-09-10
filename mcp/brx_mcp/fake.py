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
from typing import Optional

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
        elif cmd == "LIFE":
            # Bench-measured 2026-09-09 (protocol/brx-protocol.md $LIFE). Three behaviours the old
            # three-liner did not model, all of which a damage-over-time feature (S16) would be built
            # on -- and a fake that models a command wrongly lets the real bug pass the suite:
            #   1. NEGATIVES DRAIN. `$LIFE,0,-5,0,*` took armour 66 -> 61 on hardware.
            #   2. Per pool, floored at 0, NO SPILL: -100 on armour left armour 0 and HP untouched.
            #      The old `min(cfg, hp + v)` had no lower bound and would go NEGATIVE on a drain.
            #   3. It SELF-EMITS `$HP` -- except when the write is lethal, where the frame shape
            #      SWAPS to `$LCD` and no `$HP` is sent at all (F64).
            clamp = lambda cur, cap, d: max(0, min(cap, cur + d))
            self.hp = clamp(self.hp, self.cfg_hp, _int(t[1] if len(t) > 1 else None) or 0)
            self.armor = clamp(self.armor, self.cfg_armor, _int(t[2] if len(t) > 2 else None) or 0)
            if self.hp > 0:
                self.alive = True
                self._out.append(f"$HP,{self.hp},{self.armor},{self.shield},*")
            else:
                self.alive = False
                # ammo is untouched by a lethal write; the fake does not model a magazine, and the
                # real frame carries whatever was loaded, so 0,0 is the honest stand-in here.
                self._out.append("$LCD,0,0,0,0,0,0,*")
        # all other config frames (CLEAR/START/GSET/WEAP/SIR/BMAP/VOL/AMMO/PLAY…) accepted

    # -- IR hit → events ----------------------------------------------------- #
    def receive_ir(self, shooter_team: int, shooter_id: int = 1,
                   proto: int = 0, mag: Optional[int] = None, sub: int = 3) -> None:
        """Take a hit from `shooter_team`: emit `$HIR` then `$HP` (0 = died).

        No-op if dead, or a same-team hit while friendly-fire is off (the real gun
        ignores teammate IR unless FF is enabled via $GSET). With FF on, a same-team
        hit DOES damage — the host engine then declines to credit it as a kill.

        `proto`/`mag`/`sub` exist so the sim can model words that are NOT an ordinary
        rifle round (F78). The one that matters: a grenade hill's ambient damage word is
        `proto=0, mag=8, shooter_id=0` — an environmental shooter, not a player.
        For a protocol-15 station BEACON use `beacon()`, which changes no pool.

        ⚠ `mag` now drives the damage actually applied. It used to be hardcoded to 9 in
        the frame while `self.damage` (25 by default) was subtracted from the pools, so
        the fake emitted a magnitude that contradicted the damage it had just dealt —
        anything reading dmg off `$HIR` inherited the contradiction.
        """
        if not self.alive:
            return
        if shooter_team == self.team and not self.friendly_fire:
            return
        m = self.damage if mag is None else int(mag)
        d = m
        if self.armor >= d:
            self.armor -= d
        else:
            d -= self.armor
            self.armor = 0
            self.hp -= d
        # token 3 = shooter PLAYER id. It was hardcoded 0, which is why no sim
        # scenario could ever exercise per-gun kill attribution (Q17) — and, because 0 is
        # A5.1's "no identity", why the F69 hill-scoring bug stayed invisible to the suite.
        self._out.append(f"$HIR,0,{proto},{shooter_id},{shooter_team},{m},0,{sub},*")
        if self.hp <= 0:
            self.hp = 0
            self.alive = False
            self._out.append(f"$HP,0,{self.armor},{self.shield},*")
        else:
            self._out.append(f"$HP,{self.hp},{self.armor},{self.shield},*")

    def beacon(self, owner_team: int, mag: int = 8, proto: int = 15) -> None:
        """A station/grenade BEACON: `$HIR` with NO pool change and NO `$HP` (bench 2026-09-10).

        Magnitude is the station MODE, not damage: **8 = hill, 6 = respawn**. The owner's team
        rides in the team field, and a neutral hill reads team 2. Beacons are the half of the
        grenade our compiled table discards in silence for want of a protocol-15 row (F60/F70),
        so a sim that cannot emit one cannot exercise the fix.

        A beacon lands whether or not the gun is alive — it is a broadcast, not a shot.
        """
        self._out.append(f"$HIR,0,{proto},0,{owner_team},{mag},0,0,*")

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

    async def diagnose(self, address: str, volts_wait_s: int = 34) -> dict:
        from .diagnostics import run_diagnose      # same flow the real manager uses
        return await run_diagnose(self, address, volts_wait_s)

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
