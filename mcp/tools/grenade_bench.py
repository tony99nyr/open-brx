"""Grenade IR bench -- the deferred "grenade + emitter side by side" session (FOLLOWUPS star item, B12, G6).

What this settles, in the order the steps run:

  rf       Does the grenade emit anything on 2.4 GHz? Two BLE scans, grenade OFF then ON, diffed.
           Every grenade interaction we have ever observed is IR, but nobody has looked.
  watch    What a BLE-connected gun reports while the grenade beacons. Decodes every protocol-15
           `$HIR` into owner team + mode and prints the exact 25-bit word that reproduces it from
           our emitter. Three gun configs, because the config decides what the gun surfaces:
             bare      no game at all -- the gun reports every IR word it hears (exp-log #35)
             passthru  a full bench game PLUS `$SIR,15,<sub>,,24,...` rows -- fn 24 registers a
                       `$HIR` and moves no pool (unknowns.md U11'), so the gun can fire AND still
                       surface grenade IR; the thing exp-log #38 said to build
             game      the full bench game with no protocol-15 row -- the control, predicted to
                       show ZERO beacons (a spawned gun drops IR that has no `$SIR` row)
  respawn  The big one. Arms a LIVING gun to a Respawn-mode grenade, kills it with the emitter,
           then tries to revive it four ways in turn, stopping at the first that works:
             1. the grenade button    2. headset-front + trigger at the grenade
             3. our emitter replaying the Respawn beacon word    4. host `$SPAWN,,*`
           The 2026-08-26 brute force (448 words, no revive) fired at a gun that was NEVER armed
           to a station; this is the missing half of that experiment. Step 4 answers B12 (does
           host respawn still work on a station-armed gun) by killing it again if needed.
  hill     Can our emitter impersonate a Hill? Real grenade first (control), silence, then the
           replayed Hill word. The verdict is the operator's ears (chime / "control point
           captured" / faster fire); the script only times the windows and echoes the stream.
  words    Print the replay words for `python -m brx_mcp ir-emit <bits> COM8 [n]` one-liners.

Every gun frame sent is printed with `>>`, every non-noise frame received with `<<` and a stamp,
so "ignored" and "never landed" are told apart, and every phase is announced with its length so
the operator's observation binds to one window. Nothing advances on the operator's cue. With a
receiver COM the capture board sits beside the headset as the WITNESS: it reports each IR burst's
edge count (52 = one 25-bit word; more = a longer accessory word, which is a finding), so the
tape/box test in `watch` can say "the light stopped" rather than "the gun went quiet".

Ends every armed run on `teardown_frames()` so the gun is left hittable (F11).

Usage:
  python grenade_bench.py rf
  python grenade_bench.py watch   <addr> [secs=40] [bare|passthru|game] [receiver_com]
  python grenade_bench.py respawn <addr> <emitter_com> [passthru|game] [receiver_com]
  python grenade_bench.py hill    <addr> <emitter_com> [game|passthru]
  python grenade_bench.py words
"""
from __future__ import annotations

import asyncio
import re
import sys
import time

import bench_common as B
from brx_mcp.irbridge import encode_word, pulses_to_bits, decode_word, PAYLOAD_BITS

NOISE = ("$BUT", "$ALCD", "$VOLTS")
MODE_NAMES = {6: "RESPAWN", 8: "HILL"}
TEAM_NAMES = {0: "team0", 1: "team1/blue", 2: "team2", 3: "team3"}
PID, GUN_TEAM, ENEMY_TEAM = 40, 1, 2

# fn 24 on protocol 15: registers a `$HIR`, moves no pool (U11' enemy-polarity shortlist). One row
# per subtype so nothing the grenade sends is dropped for want of a cell. Enemy polarity means a
# same-team source is discarded when friendly fire is OFF, so passthru arms with FF ON (condition
# stated in the claim, not above it).
PASSTHRU_ROWS = ["$SIR,15,0,,24,0,0,1,,*", "$SIR,15,1,,24,0,0,1,,*",
                 "$SIR,15,2,,24,0,0,1,,*", "$SIR,15,3,,24,0,0,1,,*"]

_RAW = re.compile(r"^RAW\s+(\d+).*?us=\[([0-9,]*)\]")
_RAWE = re.compile(r"^RAW\s+\d+\s+edges=(\d+)")
STITCH_S = 0.15


# --- pure helpers (unit-tested) ---------------------------------------------- #
def hir_fields(raw: str) -> dict | None:
    """`$HIR,<sensor>,<proto>,<pid>,<team>,<mag>,<crit>,<sub>` -> ints, or None if not a $HIR."""
    t = raw.strip().rstrip("*").split(",")
    if t[0] != "$HIR" or len(t) < 6:
        return None
    def n(i):
        try:
            return int(t[i]) if i < len(t) and t[i] != "" else 0
        except ValueError:
            return 0
    return {"sensor": n(1), "proto": n(2), "pid": n(3), "team": n(4), "mag": n(5),
            "crit": n(6), "sub": n(7)}


def is_beacon(raw: str) -> bool:
    f = hir_fields(raw)
    return bool(f) and f["proto"] == 15


def beacon_word(raw: str) -> str | None:
    """The 25-bit word that reproduces this `$HIR` from our emitter. The echo carries every field
    but the parity trailer, and the parity is computed (brx-ir-protocol.md)."""
    f = hir_fields(raw)
    if not f:
        return None
    return encode_word(player=f["pid"], team=f["team"], damage=f["mag"], proto=f["proto"],
                       crit=f["crit"], subtype=f["sub"])


def describe_beacon(raw: str) -> str:
    f = hir_fields(raw)
    if not f or f["proto"] != 15:
        return raw
    mode = MODE_NAMES.get(f["mag"], f"mode?{f['mag']}")
    return (f"GRENADE {mode} owner={TEAM_NAMES.get(f['team'], f['team'])} "
            f"sensor={f['sensor']} sub={f['sub']}")


def alive_from(raw: str) -> bool | None:
    """True/False from an `$HP,<hp>,..` or `$LCD,<hp>,<armor>,..` line; None for anything else."""
    t = raw.strip().split(",")
    if t[0] not in ("$HP", "$LCD") or len(t) < 2:
        return None
    try:
        return int(t[1]) > 0
    except ValueError:
        return None


def respawn_beacon(team: int = GUN_TEAM, sub: int = 0) -> str:
    return encode_word(player=0, team=team, damage=6, proto=15, subtype=sub)


def hill_beacon(team: int = GUN_TEAM, sub: int = 0) -> str:
    return encode_word(player=0, team=team, damage=8, proto=15, subtype=sub)


def respawn_command(team: int = GUN_TEAM) -> str:
    """The Respawn beacon with the CRIT bit set -- what the grenade interleaves at ~1 s after its
    button is pressed (receiver capture 2026-09-04 10:23, parity-valid, distinct trailer)."""
    return encode_word(player=0, team=team, damage=6, proto=15, crit=1)


def kill_word(team: int = ENEMY_TEAM) -> str:
    """Plain proto-0 shot at magnitude 200 -- over the 45+70+70 bench pools in one hit."""
    return encode_word(player=42, team=team, damage=200, proto=0)


REPLAY_WORDS = [
    ("respawn BUTTON word (crit=1), owner team1/blue", respawn_command(1)),
    ("respawn BUTTON word (crit=1), owner team2", respawn_command(2)),
    ("respawn beacon, owner team1/blue", respawn_beacon(1)),
    ("respawn beacon, owner team2", respawn_beacon(2)),
    ("respawn beacon, owner team0", respawn_beacon(0)),
    ("hill beacon, owner team1/blue", hill_beacon(1)),
    ("hill beacon, owner team2", hill_beacon(2)),
    ("kill shot (team2, mag 200)", kill_word()),
]


def config_frames(mode: str) -> list[str]:
    """Frames that arm + spawn the gun for `mode`. `bare` sends nothing."""
    if mode == "bare":
        return []
    if mode == "passthru":
        head = B.arming_frames(PID, GUN_TEAM, ff=True, sirs=list(B.SIRS) + PASSTHRU_ROWS)
    elif mode == "game":
        head = B.arming_frames(PID, GUN_TEAM)
    else:
        raise SystemExit(f"unknown config {mode!r}: bare | passthru | game")
    # F16: BMAP before $SPAWN and the spawn tail after it, or the operator cannot fire.
    return head + list(B.BMAP) + [B.AR, "$SPAWN,,*"] + B.spawn_tail()


# --- session ------------------------------------------------------------------ #
def say(msg: str) -> None:
    print(f"   [{time.strftime('%H:%M:%S')}] {msg}", flush=True)


class Witness:
    """The capture board beside the headset. Reports IR bursts by edge count, stitched."""

    def __init__(self, com: str | None):
        self.br = None
        self._pending: list[tuple[float, int, list[int]]] = []
        if com:
            from brx_mcp.irbridge import IRBridge
            self.br = IRBridge(com)
            B.arm_receiver(self.br)
            say(f"witness on {com}: answering, RAW on")

    def poll(self) -> list[str]:
        """Drain the serial line; return human lines for bursts that have finished stitching."""
        if not self.br:
            return []
        now = time.monotonic()
        for ln in self.br._readlines(0.02):
            m = _RAW.match(ln.strip())
            if not m:
                continue
            durs = [int(x) for x in m.group(2).split(",") if x]
            e = _RAWE.match(ln.strip())
            edges = int(e.group(1)) if e else len(durs) + 1
            self._pending.append((now, edges, durs))
        out = []
        if self._pending and now - self._pending[-1][0] > STITCH_S:
            edges = sum(p[1] for p in self._pending)
            durs = self._pending[0][2]
            bits = pulses_to_bits(durs) if len(self._pending) == 1 else ""
            desc = f"IR witness: {edges} edges"
            if edges >= 50 and edges <= 54:
                desc += " (one 25-bit word)"
            elif edges > 54:
                desc += " (LONGER than a shot word -- accessory format?)"
            else:
                desc += " (fragment / noise)"
            if len(bits) >= PAYLOAD_BITS:
                d = decode_word(bits)
                desc += (f" decoded proto={d['proto']} pid={d['player']} team={d['team']} "
                         f"mag={d['damage']} sub={d['subtype']} parity={'ok' if d['parity_matches'] else 'BAD'}")
            out.append(desc)
            self._pending = []
        return out

    def close(self):
        if self.br:
            self.br.close()


class Emitter:
    def __init__(self, com: str | None):
        self.ser = None
        if com:
            import serial
            self.ser = serial.Serial(com, 115200, timeout=0.3)
            time.sleep(1.8)                       # the board resets on open
            self.ser.reset_input_buffer()
            self.ser.write(b"PING\n")
            time.sleep(0.4)
            if b"PONG" not in self.ser.read(self.ser.in_waiting or 1):
                raise SystemExit(f"ABORT: emitter on {com} did not answer PING")
            say(f"emitter on {com}: PONG")

    def tx(self, bits: str, label: str = "") -> None:
        if not self.ser:
            raise SystemExit("this step needs the emitter COM")
        self.ser.write(f"TX {bits}\n".encode())
        self.ser.flush()
        say(f"IR >> {bits}  {label}")

    def close(self):
        if self.ser:
            self.ser.close()


class Gun:
    def __init__(self, mgr, alias: str, witness: Witness):
        self.mgr, self.alias, self.w = mgr, alias, witness
        self.seq = self._session().seq
        self.alive: bool | None = None
        self.beacons: list[str] = []

    def _session(self):
        return B.sessions_of(self.mgr)[self.alias]

    def _new_rx(self) -> list[str]:
        """Frames the GUN sent since the last drain. The buffer also holds our own tx frames, and
        it is a bounded deque, so this is seq-based and rx-only rather than index-based."""
        sess = self._session()
        out = [e.raw for e in list(sess.buffer) if e.seq > self.seq and e.direction == "rx"]
        self.seq = sess.seq
        return out

    async def send(self, frame: str) -> None:
        print(f"   >> {frame}", flush=True)
        await self.mgr.send(self.alias, frame, reply_window_ms=250)
        self._drain(echo=True)

    def _drain(self, echo: bool) -> list[str]:
        out = []
        for raw in self._new_rx():
            a = alive_from(raw)
            if a is not None:
                self.alive = a
            if raw.split(",")[0] in NOISE:
                continue
            out.append(raw)
            if is_beacon(raw):
                self.beacons.append(raw)
            if echo:
                tag = f"   <-- {describe_beacon(raw)}" if is_beacon(raw) else ""
                print(f"   << {raw}{tag}", flush=True)
        return out

    async def watch(self, secs: float, label: str) -> list[str]:
        say(f"--- {label} ({secs:.0f} s) ---")
        seen: list[str] = []
        end = time.monotonic() + secs
        next_tick = time.monotonic() + 10
        while time.monotonic() < end:
            await asyncio.sleep(0.1)
            seen += self._drain(echo=True)
            for ln in self.w.poll():
                say(ln)
            if time.monotonic() >= next_tick:
                say(f"    ... {end - time.monotonic():.0f} s left")
                next_tick += 10
        return seen

    async def settle(self, secs: float = 1.5) -> None:
        end = time.monotonic() + secs
        while time.monotonic() < end:
            await asyncio.sleep(0.1)
            self._drain(echo=True)
            for ln in self.w.poll():
                say(ln)


def beacon_summary(beacons: list[str]) -> None:
    if not beacons:
        print("   no grenade (protocol-15) frames seen", flush=True)
        return
    counts: dict[str, int] = {}
    for b in beacons:
        counts[b] = counts.get(b, 0) + 1
    print("   distinct grenade frames -> replay word:", flush=True)
    for raw, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"     {n:3d}x  {raw:32s} {describe_beacon(raw)}\n"
              f"           ir-emit {beacon_word(raw)}", flush=True)


def config_note(mode: str) -> str:
    return {"bare": "BARE: no game, gun cannot fire, reports every IR word it hears",
            "passthru": "PASSTHRU: full game + $SIR proto-15 fn-24 rows, FF ON, gun fires",
            "game": "GAME: full bench game, no proto-15 row, FF off (control: expect no beacons)"}[mode]


# --- steps ----------------------------------------------------------------------- #
async def step_rf() -> None:
    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    print("RF CHECK: is the grenade a BLE device at all?\n"
          "  Guns and headsets advertise too, so only the DIFFERENCE between the two scans counts.")
    input("  1) grenade OFF (and out of its power-up window). Press Enter to scan 8 s ... ")
    off = {d["address"]: d for d in await mgr.scan(8)}
    print(f"     {len(off)} device(s) with the grenade off")
    input("  2) grenade ON: power it on, wait for the green ready flash, then press its button once.\n"
          "     Press Enter to scan 8 s ... ")
    on = {d["address"]: d for d in await mgr.scan(8)}
    print(f"     {len(on)} device(s) with the grenade on")
    new = [on[a] for a in on if a not in off]
    print("\nVERDICT:")
    if not new:
        print("  nothing new advertised with the grenade on -> no BLE from the grenade")
    else:
        for d in new:
            print(f"  NEW with grenade on: {d['name'] or '(no name)'} {d['address']} rssi={d['rssi']}"
                  f"{' NUS-uart' if d['has_uart_service'] else ''}")
        print("  -> re-run once with the grenade off again to make sure these are not late guns")


async def step_watch(addr: str, secs: float, mode: str, rx_com: str | None) -> None:
    from brx_mcp.ble import ConnectionManager
    w = Witness(rx_com)
    mgr = ConnectionManager()
    try:
        async with B.connected(mgr, (addr, "g")):
            g = Gun(mgr, "g", w)
            say(config_note(mode))
            for fr in config_frames(mode):
                await g.send(fr)
            if mode != "bare":
                await g.settle()
                say(f"pools after spawn: alive={g.alive}")
            print()
            say("Grenade in RESPAWN (yellow) or HILL (blue), its emitter side facing the headset front,"
                " about 1 ft away. Hands off.")
            say("At the half-way call, put the grenade in a closed CARDBOARD box (blocks light, not radio).")
            half = secs / 2
            await g.watch(half, "OPEN AIR")
            say(">>> BOX IT NOW <<<")
            await g.watch(secs - half, "IN THE BOX")
            print()
            beacon_summary(g.beacons)
            if mode != "bare":
                for fr in B.teardown_frames():
                    await g.send(fr)
    finally:
        w.close()


async def kill(g: Gun, em: Emitter, tries: int = 4) -> bool:
    for i in range(tries):
        em.tx(kill_word(), f"kill shot {i + 1}/{tries}")
        await g.settle(1.6)
        if g.alive is False:
            say("gun is DEAD ($HP/$LCD shows 0)")
            return True
    say(f"NOT killed after {tries} shots -- emitter aim/range (it reaches ~3 ft, 2026-09-03). "
        f"Move it to a headset dome and re-run.")
    return False


async def step_respawn(addr: str, em_com: str, mode: str, rx_com: str | None) -> None:
    from brx_mcp.ble import ConnectionManager
    w = Witness(rx_com)
    em = Emitter(em_com)
    mgr = ConnectionManager()
    verdict: dict[str, str] = {}
    try:
        async with B.connected(mgr, (addr, "g")):
            g = Gun(mgr, "g", w)
            try:
                await _respawn_body(g, em, mode, verdict)
            finally:
                # leave the gun hittable whatever happened above (F11), while still connected
                try:
                    for fr in B.teardown_frames():
                        await g.send(fr)
                except Exception as e:  # noqa: BLE001
                    say(f"teardown failed: {type(e).__name__}: {e} -- power-cycle the gun before the next run")
    finally:
        em.close()
        w.close()
        print("\n===== RESPAWN VERDICT =====")
        for k, v in verdict.items():
            print(f"  {k:28s} {v}")
        print("  operator: write down what the gun/headset SAID and LIT at each phase; the stream"
              " cannot hear it.")


async def _respawn_body(g: Gun, em: Emitter, mode: str, verdict: dict[str, str]) -> None:
    say(config_note(mode))
    for fr in config_frames(mode):
        await g.send(fr)
    await g.settle()
    if g.alive is not True:
        raise SystemExit(f"ABORT: gun not alive after spawn (alive={g.alive}); nothing to arm")

    print()
    say("PHASE 1  CLAIM + ARM (30 s). Grenade in RESPAWN (yellow), powered, neutral (white).")
    say("  - shoot the grenade ONCE with this gun now (claims it team1/blue: chime, LED blue)")
    say("  - then hold it emitter-side facing the headset FRONT, ~1 ft, for the rest")
    say("  - at the 15 s call, press the grenade button ONCE")
    await g.watch(15, "ARM: passive beacon")
    say(">>> PRESS THE GRENADE BUTTON ONCE <<<")
    await g.watch(15, "ARM: after the button")
    verdict["beacons seen while arming"] = str(len(g.beacons))
    beacon_summary(g.beacons)

    print()
    say("PHASE 2  KILL from the emitter. Keep the grenade where it is.")
    if not await kill(g, em):
        verdict["kill"] = "FAILED"
        return
    g.beacons.clear()

    print()
    say("PHASE 3  GRENADE BUTTON (15 s): press the grenade button next to the DEAD headset.")
    say(">>> PRESS IT NOW, once, then again at the 8 s call <<<")
    await g.watch(8, "REVIVE 1: button")
    say(">>> PRESS AGAIN <<<")
    await g.watch(7, "REVIVE 1: button, 2nd press")
    verdict["1 grenade button"] = "REVIVED" if g.alive else "no"
    if g.alive:
        say("*** the grenade button REVIVED the gun ***")

    if not g.alive:
        print()
        say("PHASE 4  HEADSET REQUEST (15 s): face the grenade with the headset FRONT, ~2 ft,")
        say("         and pull the trigger twice. (Witness beside the grenade would see the request.)")
        await g.watch(15, "REVIVE 2: headset-front + trigger")
        verdict["2 headset-front + trigger"] = "REVIVED" if g.alive else "no"
        if g.alive:
            say("*** headset-front + trigger REVIVED the gun ***")

    if not g.alive:
        print()
        say("PHASE 5  REPLAY from our emitter: the beacon words at the dead, station-armed gun.")
        say("         Move the real grenade away or box it so only our emitter is talking.")
        await g.settle(3)
        groups = [("respawn BUTTON word crit=1, team1", respawn_command(1), 6),
                  ("respawn BUTTON word crit=1, team2", respawn_command(2), 3),
                  ("respawn owner team1", respawn_beacon(1), 5),
                  ("respawn owner team2", respawn_beacon(2), 3),
                  ("respawn owner team0", respawn_beacon(0), 3),
                  ("respawn sub1", respawn_beacon(1, 1), 2),
                  ("respawn sub2", respawn_beacon(1, 2), 2),
                  ("respawn sub3", respawn_beacon(1, 3), 2),
                  ("hill owner team1", hill_beacon(1), 3)]
        for label, bits, n in groups:
            for i in range(n):
                em.tx(bits, f"{label} {i + 1}/{n}")
                await g.settle(1.2)
            if g.alive:
                verdict["3 emitter replay"] = f"REVIVED by {label}"
                say(f"*** emitter replay ({label}) REVIVED the gun ***")
                break
        else:
            verdict["3 emitter replay"] = "no (all groups)"

    print()
    say("PHASE 6  HOST $SPAWN on a station-armed gun (B12).")
    if g.alive:
        say("  gun is alive from an earlier revive -> killing it again first")
        if not await kill(g, em):
            verdict["4 host $SPAWN"] = "untested (2nd kill failed)"
            return
    await g.settle(3.2)                      # F13: never respawn within 3 s of a death
    await g.send("$SPAWN,,*")
    for fr in B.spawn_tail():
        await g.send(fr)
    await g.settle(1.5)
    verdict["4 host $SPAWN"] = "REVIVED" if g.alive else "NO -- host respawn is blocked on an armed gun"

    print()
    say("PHASE 7  AFTERMATH (10 s): does the gun still say anything about the station? Hands off.")
    await g.watch(10, "aftermath")


async def step_hill(addr: str, em_com: str, mode: str) -> None:
    from brx_mcp.ble import ConnectionManager
    em = Emitter(em_com)
    mgr = ConnectionManager()
    try:
        async with B.connected(mgr, (addr, "g")):
            g = Gun(mgr, "g", Witness(None))
            say(config_note(mode))
            for fr in config_frames(mode):
                await g.send(fr)
            await g.settle()
            if g.alive is not True:
                raise SystemExit(f"ABORT: gun not alive after spawn (alive={g.alive})")
            print()
            say("PHASE 1  REAL HILL (25 s). Grenade in HILL (blue) mode, neutral. Shoot it once to claim,")
            say("         then hold it facing the headset front. LISTEN: chime? 'control point captured'?")
            say("         ticking? Fire 3 shots at the 15 s call: faster than normal?")
            await g.watch(15, "real hill: claim + hold")
            say(">>> FIRE 3 SHOTS <<<")
            await g.watch(10, "real hill: fire")
            print()
            say("PHASE 2  SILENCE (10 s): box the grenade or power it off. Fire 3 shots at normal rate.")
            await g.watch(10, "silence baseline")
            print()
            say("PHASE 3  REPLAY (25 s): our emitter sends the HILL word (owner team1) every 4 s.")
            say("         Same chime / callout / fire rate as PHASE 1? Fire 3 shots at the 15 s call.")
            for i in range(6):
                em.tx(hill_beacon(1), f"hill team1 {i + 1}/6")
                await g.settle(4.0)
                if i == 3:
                    say(">>> FIRE 3 SHOTS <<<")
            print()
            say("PHASE 4  REPLAY enemy-owned hill (12 s): HILL word owner team2, every 4 s. Different sound?")
            for i in range(3):
                em.tx(hill_beacon(2), f"hill team2 {i + 1}/3")
                await g.settle(4.0)
            print()
            beacon_summary(g.beacons)
            for fr in B.teardown_frames():
                await g.send(fr)
    finally:
        em.close()
        print("\nHILL VERDICT is the operator's: did PHASE 3 sound/feel like PHASE 1? "
              "If nothing reacted in PHASE 1 either, this config does not react to a hill at all --"
              " repeat with the gun in a NATIVE game (no BLE needed): "
              f"ir-emit {hill_beacon(1)} COM8 6")


def step_words() -> None:
    print("replay words (python -m brx_mcp ir-emit <bits> COM8 [repeat]):")
    for label, bits in REPLAY_WORDS:
        print(f"  {bits}  {label}")
    print("\npassthru rows (send after the bench $SIR table, with $GSET friendly fire ON):")
    for r in PASSTHRU_ROWS:
        print(f"  {r}")


def main() -> None:
    a = sys.argv[1:]
    if not a:
        raise SystemExit(__doc__)
    cmd = a[0]
    if cmd == "rf":
        asyncio.run(step_rf())
    elif cmd == "words":
        step_words()
    elif cmd == "watch" and len(a) >= 2:
        secs = float(a[2]) if len(a) > 2 else 40.0
        mode = a[3] if len(a) > 3 else "bare"
        rx = a[4] if len(a) > 4 else None
        asyncio.run(step_watch(a[1], secs, mode, rx))
    elif cmd == "respawn" and len(a) >= 3:
        mode = a[3] if len(a) > 3 else "passthru"
        rx = a[4] if len(a) > 4 else None
        asyncio.run(step_respawn(a[1], a[2], mode, rx))
    elif cmd == "hill" and len(a) >= 3:
        mode = a[3] if len(a) > 3 else "game"
        asyncio.run(step_hill(a[1], a[2], mode))
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
