"""GameDriver — runs a mode engine live against real taggers (M0.2).

The driver is the ONE place that touches I/O. It:
  1. applies a GameConfig (setup frames + per-gun team/spawn),
  2. feeds each parsed rx event into the engine tagged with the gun it came from,
  3. runs engine.tick() on a clock,
  4. executes the Actions the engine emits (Respawn→sequence, Heal→$LIFE,
     PlaySound→$PLAY, SendFrame→raw, Score/GameOver→scoreboard).

The `sender` is injected — a coroutine `send(player_id, frame)` — so the driver
is unit-tested with a fake sender (no Bluetooth). `run_live()` wires the real
BLE ConnectionManager.
"""

from __future__ import annotations

import asyncio
import sys
import time
from typing import Awaitable, Callable, Optional

from .. import sounds as snd
from ..gameconfig import GameConfig, RESPAWN_SEQUENCE, END_SEQUENCE
from .. import poolgauge as pg
from .base import (
    Action, Callout, Eliminate, GameEngine, GameOver, Heal, KillConfirm, PlaySound, Respawn,
    Score, SendFrame, SetTeam,
)

Sender = Callable[[str, str], Awaitable[None]]

# How long a player may go un-hit before the operator is told. Long enough that a quiet opening or a
# cautious player is not flagged, short enough to catch an unhittable gun while the match can still
# be saved. A 5-minute default game makes 90 s about a third of the way in.
NEVER_HIT_AFTER_S = 90.0


CALLSIGN_MAX = 12   # BRX gun name field is short (stock name e.g. "Tactix2")


def clean_callsign(name: Optional[str]) -> str:
    """Sanitize a gamertag for a `$NAME` frame: drop comma/`$`/`*`/control chars
    (they'd break the framing) and cap the length. Returns "" for None/blank."""
    if not name:
        return ""
    safe = "".join(c for c in str(name).strip()
                   if c.isprintable() and c not in ",$*")
    # CALLSIGN_MAX is a budget on the WIRE, i.e. bytes -- but a multi-byte character
    # (accents, emoji) is one Python code point that costs several. Slicing by code
    # point (the old `safe[:CALLSIGN_MAX]`) let a 12-character name smuggle 30+ bytes
    # onto a field sized for "Tactix2". Truncate on the encoded bytes instead, and drop
    # any partial character left dangling at the cut (errors="ignore").
    return safe.encode("utf-8")[:CALLSIGN_MAX].decode("utf-8", errors="ignore").strip()


def assign_teams(mode: str, addresses: list[str],
                 explicit: Optional[dict[str, int]] = None) -> dict[str, int]:
    """Map each gun → team. Explicit wins; else FFA = unique team per gun;
    infection/survival = exactly ONE seed infected (team 2), rest human (team 1);
    other modes = alternate 1/2."""
    explicit = explicit or {}
    out: dict[str, int] = {}
    for i, addr in enumerate(addresses):
        if addr in explicit:
            out[addr] = explicit[addr]
        elif mode in ("ffa", "extraction"):
            out[addr] = i + 1                  # unique team → 1:1 kill attribution
        elif mode in ("infection", "survival"):
            out[addr] = 2 if i == 0 else 1     # first gun = the single seed infected
        else:
            out[addr] = (i % 2) + 1
    return out


def build_engine(config: GameConfig, now: float = 0.0) -> GameEngine:
    """Factory: config.mode → the engine instance."""
    from .deathmatch import DeathmatchEngine
    from .survival import InfectionEngine
    from .lms import LastManStandingEngine
    from .cs import BombEngine
    from .objectives import DominationEngine, CtfEngine
    import dataclasses
    m = config.mode
    if m in ("tdm", "ffa"):
        return DeathmatchEngine(config, now)
    if m in ("infection", "survival"):
        return InfectionEngine(config, now)
    if m == "lms":
        return LastManStandingEngine(config, now)
    if m in ("cs", "bomb"):
        return BombEngine(config, now)
    if m == "domination":
        return DominationEngine(config, now)
    if m == "koth":
        # KotH = domination on a single point (hold the hill for time)
        return DominationEngine(dataclasses.replace(config, control_points=1), now)
    if m == "ctf":
        return CtfEngine(config, now)
    if m == "extraction":
        from .extraction_adapter import ExtractionEngineAdapter
        return ExtractionEngineAdapter(config, now)
    raise ValueError(f"unknown mode {m!r} "
                     "(tdm|ffa|infection|lms|cs|domination|koth|ctf|extraction)")


class GameDriver:
    def __init__(self, config: GameConfig, players: dict[str, int],
                 sender: Sender, now: float = 0.0,
                 announce: Optional[Callable[[str], None]] = None,
                 callsigns: Optional[dict[str, str]] = None):
        """`players` maps player_id → team. `sender(pid, frame)` does the write.
        `callsigns` maps player_id → vanity gamertag; a DISPLAY layer only — echoed
        in `snapshot()` so a scoreboard can label by gamertag. NOT pushed to the gun
        (the gun's `$NAME` is its permanent sticker-id hardware identity)."""
        self.config = config
        self.players = players
        # player_id -> setup frames that FAILED to send. Empty is the only healthy state; a $SIR
        # entry here means that player cannot be hit (F11). Surfaced via snapshot() so the operator
        # console can flag it rather than discovering it mid-match.
        self.arming_failures: dict[str, list[str]] = {}
        # player_id -> hits TAKEN. A player still on zero well into a match is the live symptom of a
        # gun that cannot be hit (F11), and is worth flagging to the operator.
        self.hits_taken: dict[str, int] = {}
        self._t0: Optional[float] = None
        self._elapsed: float = 0.0
        # F1 pool gauge: last pools seen per player, and when their gauge was last painted. The
        # gauge is a DISPLAY layer -- it never affects scoring, and a missing $HP simply means no
        # repaint rather than a wrong one.
        self._pools: dict[str, tuple[int, int, int]] = {}
        self._gauge_until: dict[str, float] = {}
        # In-flight event bursts, one per player. Cancelled and replaced when a new event arrives, so
        # two events never interleave their colours on the same strip.
        self._bursts: dict[str, "asyncio.Future"] = {}
        self._last_burst: dict[str, float] = {}
        self.sender = sender
        self.engine = build_engine(config, now)
        self.announce = announce or (lambda s: print(s, flush=True))
        self.callsigns = {pid: clean_callsign(n) for pid, n in (callsigns or {}).items()
                          if clean_callsign(n)}
        # Per-gun PLAYER ID -> $PSET token 1 (protocol §7p). Distinct ids are what make
        # per-player attribution possible at all; with every gun on the default id the
        # shooter field is a constant. Auto-number the fleet 0,1,2… unless the operator
        # pinned ids in config.player_ids. Assignment is computed ONCE here so a
        # mid-game resetup re-sends the SAME id (a changed id mid-game would re-identify
        # the player and orphan their kills).
        pinned = dict(getattr(config, "player_ids", {}) or {})
        self.player_ids: dict[str, int] = {}
        for idx, pid in enumerate(players):
            self.player_ids[pid] = int(pinned.get(pid, idx))
        for pid, team in players.items():
            self.engine.add_player(pid, team)
        # Hand the engine the reverse map so it can credit a kill to the SPECIFIC gun
        # from $HIR token 3, instead of guessing from the shooter's team (Q17).
        roster = getattr(self.engine, "roster", None)
        if roster is not None and hasattr(roster, "wire_ids"):
            roster.wire_ids = {wire: pid for pid, wire in self.player_ids.items()}

    async def _send(self, pid: str, frame: str, critical: bool = False,
                    reply_window_ms: int | None = None) -> None:
        """One write, guarded — a single gun's BLE error must NOT abort the game
        (e.g. a broadcast $PLAY to a gun that just disconnected).

        `critical=True` additionally RECORDS the failure. Swallowing setup-frame errors silently is
        the live-match half of F11: `$CLEAR` wipes the `$SIR` table, so if `$CLEAR` lands and a later
        `$SIR` row does not, that player is UNHITTABLE for the whole match — no error surfaces, the
        gun reports healthy, pools stay full, and the scoreboard shows them alive and simply never
        hit. A dropped `$PLAY` is cosmetic; a dropped `$SIR` ends someone's game.
        """
        try:
            if reply_window_ms is None:
                await self.sender(pid, frame)
            else:
                # A sender that does not accept the kwarg (tests, fakes) is fine: fall back.
                try:
                    await self.sender(pid, frame, reply_window_ms=reply_window_ms)
                except TypeError:
                    await self.sender(pid, frame)
        except Exception as e:  # noqa: BLE001
            self.announce(f"(send to {pid} failed: {type(e).__name__}: {e})")
            if critical:
                self.arming_failures.setdefault(pid, []).append(frame)

    # -- action execution ---------------------------------------------------- #
    async def execute(self, actions: list[Action]) -> None:
        for a in actions:
            if isinstance(a, SendFrame):
                await self._send(a.player_id, a.frame)
            elif isinstance(a, Respawn):
                for f in RESPAWN_SEQUENCE:
                    await self._send(a.player_id, f)
                await self._paint_headset(a.player_id)      # $SPAWN clears the headset (bench 09-03)
                await self._paint_event(a.player_id, "respawned")
                self.announce(f"↻ respawn {a.player_id}")
            elif isinstance(a, Heal):
                await self._send(a.player_id, f"$LIFE,{a.hp},{a.armor},{a.shield},*")
                await self._paint_event(a.player_id, "healed")
            elif isinstance(a, SetTeam):
                await self._send(a.player_id, f"$TID,{a.team},*")
            elif isinstance(a, KillConfirm):
                await self._send(a.scope, "$SFLASH,*")   # green-sight kill confirm (§7o)
            elif isinstance(a, PlaySound):
                # two slots: token 1 = effect, token 4 = announcer voice (§7o)
                frame = (f"$PLAY,,4,6,{a.sound_id},,,,*" if a.slot == "voice"
                         else f"$PLAY,{a.sound_id},4,6,,,,,*")
                if a.scope == "all":
                    for pid in self.players:
                        await self._send(pid, frame)
                else:
                    await self._send(a.scope, frame)
            elif isinstance(a, Callout):
                self.announce(f"📢 {a.text}")
            elif isinstance(a, Score):
                self.announce(f"🎯 {a.who}: {a.total} (+{a.delta})")
            elif isinstance(a, Eliminate):
                await self._paint_event(a.player_id, "died")
                self.announce(f"☠ {a.player_id} eliminated")
            elif isinstance(a, GameOver):
                self.announce(f"🏆 GAME OVER — {a.winner}  {a.detail}")
                for pid in self.players:            # grounded game-over announcer (all guns)
                    await self._send(pid, f"$PLAY,{snd.GAME_OVER},4,6,,,,,*")

    # -- lifecycle ----------------------------------------------------------- #
    async def setup(self) -> None:
        """Push per-game config to every gun, then per-gun team + spawn (synchronised:
        config all, THEN spawn all back-to-back — B10)."""
        spawn_frames = self.config.spawn_frames()   # loadout-correct $AMMO
        # config every gun fully first (incl. team) ...
        # NOTE: callsigns are a DISPLAY layer only (echoed in snapshot for the
        # scoreboard) — we deliberately do NOT push $NAME here. The gun's $NAME is
        # its permanent hardware identity (the headset sticker id, set at Armory
        # Setup); a per-game vanity gamertag must never clobber it. See
        # docs/field-process.md + the tagger-naming architecture.
        for pid in self.players:
            await self._arm_one(pid)
        # ... THEN spawn all guns back-to-back so they start ~together (B10 barrier)
        for f in spawn_frames:
            for pid in self.players:
                await self._send(pid, f)
        for pid in self.players:
            await self._paint_headset(pid)
        self.announce(f"game live: {self.config.summary()}")

    async def _paint_headset(self, pid: str) -> None:
        """Put the headset back on the team colour. Send after every `$SPAWN` and every hit.

        Bench 2026-09-03: `$SPAWN` clears the headset and so does each registered hit (native flash,
        then dark); a static `$HLED` sent afterwards holds solid, and one sent 1 s after spawn lit,
        so no settling gap is needed here. Skipped when LEDs are off -- a lit head in a blackout game
        marks the player. See `poolgauge.headset_team_frame`.
        """
        if not self.config.leds:
            return
        await self._send(pid, pg.headset_team_frame(self.players.get(pid)), reply_window_ms=0)

    async def _paint_event(self, pid: str, event: str) -> None:
        """Play the tuned event burst on the gun WITHOUT blocking the game loop.

        Three short flashes back to the team colour (`poolgauge.event_burst`, tuned on hardware
        2026-09-03). A single frame was not reliably visible -- the firmware repaints the strip
        within ~0.33 s -- and the burst buys both redundancy and a rhythm that reads as an event.

        It runs as a background TASK because the burst takes ~0.44 s of wall clock, and awaiting that
        inline would stall every other player's actions behind one player's light show. A new event
        for the same player CANCELS the one in flight rather than interleaving two colours.

        A kill confirm is deliberately not painted: the gun has a native one (`$SFLASH`, sent on
        `KillConfirm`) in the sight the player is already looking through.
        """
        if not self.config.leds:
            return
        seq = pg.event_burst(event, self.players.get(pid), night=self.config.is_night_mode())
        if not seq:
            return
        # RATE LIMIT. The cancel below only guards OVERLAPPING bursts; two events a second apart
        # would put six flashes into one second, and the whole point of a 3-flash burst is that three
        # in a second is the ceiling. Drop the second event's paint rather than exceed it.
        now = (self._t0 or 0.0) + self._elapsed
        last = self._last_burst.get(pid)
        if last is not None and now - last < pg.BURST_MIN_SPACING_S:
            return
        self._last_burst[pid] = now
        old = self._bursts.pop(pid, None)
        if old is not None and not old.done():
            old.cancel()
        # The gauge deadline is dropped: the burst ends on the team colour itself, so a later revert
        # would repaint a colour that is already showing.
        self._gauge_until.pop(pid, None)
        self._bursts[pid] = asyncio.ensure_future(self._play_burst(pid, seq))

    async def _play_burst(self, pid: str, seq) -> None:
        try:
            for frame, hold in seq:
                await self._send(pid, frame, reply_window_ms=0)
                if hold:
                    await asyncio.sleep(hold)
        except asyncio.CancelledError:      # superseded by a newer event -- expected, not an error
            pass
        finally:
            # Identity, not `.done()`: a coroutine's `finally` runs BEFORE its Task is marked done,
            # so the old check never fired and every player kept a stale Task forever.
            if self._bursts.get(pid) is asyncio.current_task():
                self._bursts.pop(pid, None)

    async def _arm_one(self, pid: str) -> bool:
        """Send one gun's full config, then make sure the `$SIR` table actually landed.

        F11 (bench-proven 2026-09-02, deterministic 5/5): `$CLEAR` WIPES the `$SIR` table, and a gun
        with no rows silently ignores EVERY hit while reporting alive, in-game and healthy. The
        ordering in `setup_frames()` is correct, so a COMPLETE bundle is safe — the danger is a
        PARTIAL one. Retry the rows once, and if they still will not go, say so loudly instead of
        letting a player walk onto the field unhittable.
        """
        self.arming_failures.pop(pid, None)
        frames = list(self.config.setup_frames(self.player_ids[pid]))
        for f in frames:
            await self._send(pid, f, critical=True)
        await self._send(pid, f"$TID,{self.players[pid]},*", critical=True)

        failed = self.arming_failures.get(pid, [])
        if any(f.startswith("$SIR") for f in failed):
            self.announce(f"⚠ {pid}: $SIR row(s) failed to send — retrying (a gun with no $SIR "
                          f"table silently ignores every hit)")
            rest = [f for f in failed if not f.startswith("$SIR")]
            if rest:
                self.arming_failures[pid] = rest
            else:
                self.arming_failures.pop(pid, None)
            for f in frames:
                if f.startswith("$SIR"):
                    await self._send(pid, f, critical=True)

        failed = self.arming_failures.get(pid, [])
        if any(f.startswith("$SIR") for f in failed):
            self.announce(f"🔴 {pid} IS NOT ARMED: its $SIR table did not land, so it will NOT "
                          f"register hits. Re-arm this player before the match starts.")
            return False
        if failed:
            self.announce(f"⚠ {pid}: {len(failed)} setup frame(s) failed to send")
        return True

    def _player_alive(self, pid: str) -> bool:
        """Best-effort: does the ENGINE consider this player alive? Used by the
        reconnect path so we don't revive a gun the engine has dead/eliminated
        (which would desync the physical gun from the scoreboard). Unknown → True."""
        roster = getattr(self.engine, "roster", None)
        if roster is not None:
            p = roster.get(pid)
            if p is not None:
                return bool(getattr(p, "alive", True))
        return True

    async def resetup(self, pid: str) -> None:
        """Re-config ONE gun (after a mid-game reconnect) so it rejoins. Re-sends
        config + team always, but only SPAWNS it live if the engine still considers
        it alive — a gun that dropped while dead stays dead (the engine's own Respawn
        action brings it back on schedule), avoiding a gun-alive/engine-dead desync."""
        await self._arm_one(pid)
        if self._player_alive(pid):
            for f in self.config.spawn_frames():
                await self._send(pid, f)

    async def teardown(self) -> None:
        # Cancel any burst still painting: without this it keeps writing $GLED for ~2 s onto a gun
        # that has just been $CLEAR-ed, and then into a disconnected session.
        for t in list(self._bursts.values()):
            if not t.done():
                t.cancel()
        self._bursts.clear()
        for pid in self.players:
            for f in END_SEQUENCE:
                await self._send(pid, f)

    def feed(self, player_id: str, ev: dict, now: float) -> list[Action]:
        """Feed one parsed rx event; returns the Actions (caller executes)."""
        # Count HITS TAKEN per player. This is the cheapest live detector for the whole F11 class:
        # a gun whose `$SIR` table did not land looks completely healthy -- alive, full pools,
        # answering `$QUERY` -- and simply never registers. The only symptom visible to the host is
        # that this player is never hit, which no scoreboard would otherwise call out.
        cmd = (ev.get("command") or ev.get("cmd") or ev.get("raw", "")[:5])
        if str(cmd).upper().lstrip("$").startswith("HIR"):
            self.hits_taken[player_id] = self.hits_taken.get(player_id, 0) + 1
        if self._t0 is None:
            self._t0 = now
        # `_elapsed` was only advanced in tick(); a driver that is fed events but never ticked left
        # it at 0.0 forever, so `never_hit` silently never fired. Fail-silent is the wrong direction
        # for a detector whose whole job is to notice an unhittable player.
        self._elapsed = max(self._elapsed, now - self._t0)
        actions = self.engine.on_event(player_id, ev, now)
        gauge = self._gauge_action(player_id, ev, now)
        if gauge is not None:
            actions = list(actions) + [gauge]
        if str(cmd).upper().lstrip("$").startswith("HIR") and self.config.leds:
            # A registered hit wipes the headset (native flash, then dark -- bench 2026-09-03), so
            # repaint the team colour. One write per hit; the frame is static and never hammered.
            actions = list(actions) + [SendFrame(player_id,
                                                 pg.headset_team_frame(self.players.get(player_id)))]
        return actions

    def _gauge_action(self, pid: str, ev: dict, now: float) -> Optional[Action]:
        """F1: paint the pool that just changed onto the gun LEDs (see `poolgauge`).

        Driven off `$HP`, which the gun sends on every damage event, so the trigger is free -- no
        polling and no extra round trip. Returns a `SendFrame` so the driver's single I/O path still
        owns the write.
        """
        if not self.config.leds:
            return None
        raw = (ev.get("raw") or "").strip()
        if not raw.startswith("$HP,"):
            return None
        try:
            t = raw.split(",")
            after = (int(t[1]), int(t[2]), int(t[3]))
        except (IndexError, ValueError):
            return None                      # a malformed $HP must not paint a wrong gauge
        before = self._pools.get(pid)
        self._pools[pid] = after
        pool = pg.changed_pool(before, after)
        if pool is None:
            return None
        maxima = {"health": self.config.hp, "armor": self.config.armor,
                  "shield": self.config.shield}
        level = {"health": after[0], "armor": after[1], "shield": after[2]}[pool]
        self._gauge_until[pid] = now + pg.REVERT_AFTER_S
        # WHOLE STRIP, not the segmented bar. A live gun animates its own strip, and a mixed frame
        # (some lit, some dark) does not render reliably against that -- the level is carried by HUE
        # instead, which is why health shifts green/yellow/red. `gauge_frame` is the segmented form
        # and is for a pre-game/lobby gun, where it renders cleanly (verified 10/10).
        return SendFrame(pid, pg.pool_paint_frame(pool, level, maxima[pool],
                                                  night=self.config.is_night_mode()))

    def tick(self, now: float) -> list[Action]:
        if self._t0 is None:
            self._t0 = now
        self._elapsed = now - self._t0
        actions = list(self.engine.tick(now))
        # Revert each expired gauge to the team colour. A fresh change RESTARTS the window rather
        # than queuing, which falls out of storing a deadline instead of a countdown.
        for pid, until in list(self._gauge_until.items()):
            if now >= until:
                del self._gauge_until[pid]
                actions.append(SendFrame(pid, pg.team_frame(self.players.get(pid),
                                                          night=self.config.is_night_mode())))
        return actions

    @property
    def over(self) -> bool:
        return getattr(self.engine, "over", False)

    def snapshot(self) -> dict:
        snap = self.engine.snapshot()
        if self.callsigns:
            snap["callsigns"] = dict(self.callsigns)
        if self.arming_failures:
            # Surfaced so the operator console can flag it BEFORE the match. `unhittable` is the one
            # that ends someone's game: no $SIR table means the gun ignores every hit while looking
            # perfectly healthy (F11).
            snap["arming_failures"] = {k: list(v) for k, v in self.arming_failures.items()}
            unhittable = sorted(pid for pid, frames in self.arming_failures.items()
                                if any(f.startswith("$SIR") for f in frames))
            if unhittable:
                snap["unhittable"] = unhittable
        snap["hits_taken"] = {pid: self.hits_taken.get(pid, 0) for pid in self.players}
        # Only after NEVER_HIT_AFTER_S: at kickoff everyone is legitimately on zero, and a list that
        # cries wolf every match start is a list the operator learns to ignore.
        if self._elapsed >= NEVER_HIT_AFTER_S:
            never = sorted(pid for pid in self.players if not self.hits_taken.get(pid))
            if never:
                snap["never_hit"] = never
                snap["never_hit_after_s"] = round(self._elapsed)
        return snap


# --------------------------------------------------------------------------- #
# Live wiring — the only Bluetooth-touching part                              #
# --------------------------------------------------------------------------- #
async def run_live(config: GameConfig, addresses: list[str],
                   callsigns: Optional[dict[str, str]] = None,
                   manager=None, tick_s: float = 0.5,
                   max_s: Optional[float] = None) -> dict:
    """Connect the given taggers, run the configured mode to completion, return
    the final snapshot. `players` are keyed by address; team from config.teams or
    round-robin (FFA gives each its own team). `callsigns` maps address → gamertag
    (echoed in the snapshot; display-only, not written to the gun).

    `manager` injects a connection manager (a `FakeConnectionManager` for
    hardware-free tests); default is the real BLE `ConnectionManager`. `tick_s` is
    the game-loop poll interval (tiny in tests to run fast)."""
    from ..protocol import parse_event

    if manager is None:
        from ..ble import ConnectionManager
        manager = ConnectionManager()
    mgr = manager

    async def sender(pid: str, frame: str, reply_window_ms: int = 250) -> None:
        # Cosmetic frames (the LED burst) pass 0: a 250 ms reply wait after EVERY write stretched the
        # tuned 0.08 s / 0.10 s flash pattern into 0.33 s / 0.35 s and the whole burst from 0.44 s to
        # 1.94 s, so what shipped was never the pattern that was signed off on the bench.
        await mgr.send(pid, frame, reply_window_ms=reply_window_ms)

    # Connect-grace: BLE establishment is flaky (~1 in 3, §7e). Connect each gun and
    # play with whoever comes up rather than aborting the whole game on one failure.
    connected: list[str] = []
    for addr in addresses:
        try:
            await mgr.connect(addr, addr)
            connected.append(addr)
        except Exception as e:  # noqa: BLE001 — a gun that won't connect is skipped, not fatal
            print(f"(could not connect {addr}: {type(e).__name__}: {e} — skipping)",
                  file=sys.stderr)
    if not connected:
        return {"over": False, "error": "no taggers connected", "requested": addresses}
    if len(connected) < len(addresses):
        print(f"(playing with {len(connected)}/{len(addresses)} taggers: {connected})",
              file=sys.stderr)

    players = assign_teams(config.mode, connected, config.teams or None)
    driver = GameDriver(config, players, sender, now=time.monotonic(),
                        callsigns=callsigns)
    try:
        last_seq = {addr: mgr.sessions[addr].seq for addr in connected}
        await driver.setup()
        # Wall-clock safety: a game with no clock (frag/objective) whose events
        # stall (e.g. a gun dropped) must never loop forever. Default = the game
        # clock + 1 min, else a 1-hour hard cap.
        deadline = (config.game_time_s + 60) if config.game_time_s else 3600.0
        limit = max_s if max_s is not None else deadline
        game_start = time.monotonic()
        reconnect_tries: dict[str, int] = {addr: 0 for addr in connected}
        last_reconnect: dict[str, float] = {addr: -1e9 for addr in connected}
        RECONNECT_CAP = 6          # TOTAL reconnects/gun — bounds a flapping link
        MIN_RECONNECT_S = 8.0      # rate-limit between attempts for the same gun
        RECONNECT_TIMEOUT_S = 3.0  # time-box ONE attempt so a slow connect can't freeze the loop
        loops = 0
        while not driver.over:
            await asyncio.sleep(tick_s)
            now = time.monotonic()
            loops += 1
            # Mid-game reconnection: bring a dropped gun back so it rejoins. Guarded:
            # only if the manager reports link state; time-boxed so a slow real connect
            # can't freeze live players; rate-limited + total-capped so a flapping link
            # can't churn the game forever.
            if loops % 5 == 0 and hasattr(mgr, "is_connected"):
                for addr in connected:
                    if (mgr.is_connected(addr)
                            or reconnect_tries[addr] >= RECONNECT_CAP
                            or now - last_reconnect[addr] < MIN_RECONNECT_S):
                        continue
                    last_reconnect[addr] = now
                    reconnect_tries[addr] += 1
                    try:
                        try:
                            await mgr.disconnect(addr)
                        except Exception:  # noqa: BLE001
                            pass
                        await asyncio.wait_for(mgr.connect(addr, addr, attempts=1),
                                               timeout=RECONNECT_TIMEOUT_S)
                        await driver.resetup(addr)
                        last_seq[addr] = mgr.sessions[addr].seq
                        print(f"(reconnected {addr})", file=sys.stderr)
                    except Exception as e:  # noqa: BLE001 — stay in the game if it fails
                        print(f"(reconnect {addr} failed: {type(e).__name__})", file=sys.stderr)
            for addr in connected:
                for ev in mgr.get_events(addr, since_seq=last_seq[addr])["events"]:
                    last_seq[addr] = ev["seq"]
                    if ev["direction"] != "rx":
                        continue
                    parsed = parse_event(ev["raw"])
                    parsed["raw"] = ev["raw"]
                    await driver.execute(driver.feed(addr, parsed, now))
            await driver.execute(driver.tick(now))
            if now - game_start > limit:
                print(f"(game exceeded {limit:.0f}s with no end — force-stopping)",
                      file=sys.stderr)
                snap = driver.snapshot()
                snap["force_stopped"] = True
                return snap
        return driver.snapshot()
    finally:
        try:
            await driver.teardown()
        except Exception:  # noqa: BLE001
            pass
        for addr in connected:
            try:
                await mgr.disconnect(addr)
            except Exception:  # noqa: BLE001
                pass
