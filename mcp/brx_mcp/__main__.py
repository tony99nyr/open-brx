"""Entry point.

  python -m brx_mcp            # run the MCP server (stdio)
  python -m brx_mcp scan [s]   # one-shot BLE scan (first-contact CLI)
  python -m brx_mcp identify <address>
  python -m brx_mcp listen <address> [seconds]   # read-only live console
  python -m brx_mcp startgame <address> [seconds] [respawn_s] [volume]
  python -m brx_mcp deathmatch <address> [minutes] [respawn_s] [volume] [weapon]
  python -m brx_mcp arena <addr1> <addr2> [...] [minutes] [respawn_s] [volume] [weapon]
"""

from __future__ import annotations

import asyncio
import json
import sys
import time


def _print(obj: object) -> None:
    print(json.dumps(obj, indent=2))


async def _scan(duration_s: int) -> None:
    from .ble import ConnectionManager
    print(f"Scanning BLE for {duration_s}s ...", file=sys.stderr)
    results = await ConnectionManager().scan(duration_s)
    _print(results)
    brx = [d for d in results if d["has_uart_service"]]
    if brx:
        print(f"\n{len(brx)} device(s) advertise the Nordic UART service "
              "(likely BRX Gen2/3):", file=sys.stderr)
        for d in brx:
            print(f"  {d['address']}  rssi={d['rssi']}  name={d['name']!r}",
                  file=sys.stderr)
    else:
        print("\nNo Nordic-UART devices found. If the tagger is on and close, "
              "it may be Gen1 (Bluetooth Classic — pair it in the OS instead).",
              file=sys.stderr)


async def _identify(address: str) -> None:
    from .ble import ConnectionManager
    _print(await ConnectionManager().identify(address))


async def _listen(address: str, seconds: int, pair: bool = False) -> None:
    from .ble import ConnectionManager
    mgr = ConnectionManager()
    await mgr.connect(address, "cli", pair=pair)
    if pair:
        print("Paired + connected.", file=sys.stderr)
    print(f"Connected. Listening read-only for {seconds}s — pull the trigger, "
          "press buttons, get tagged...", file=sys.stderr)
    last_seq = 0
    for i in range(seconds):
        await asyncio.sleep(1)
        out = mgr.get_events("cli", since_seq=last_seq)
        for ev in out["events"]:
            print(f"[{ev['t_ms']:>7}ms] {ev['raw']}   {ev['parsed']}",
                  flush=True)
            last_seq = ev["seq"]
        if i % 5 == 4:
            state = ("CONNECTED" if mgr.sessions["cli"].client.is_connected
                     else "DISCONNECTED")
            print(f"--- {i + 1}s: link {state}", flush=True)
    await mgr.disconnect("cli")


async def _probe(address: str, listen_s: int) -> None:
    """Send the app-mode handshake ($CONNECT/$INIT/$PHONE), then listen.

    Finding from first session: the tagger sends nothing unsolicited outside
    app-controlled mode — this probes whether the handshake opens the tap.
    """
    from .ble import ConnectionManager
    mgr = ConnectionManager()
    await mgr.connect(address, "cli")
    print("Connected. Sending handshake sequence...", file=sys.stderr)
    for cmd in ("$CONNECT,*", "$INIT,*", "$PHONE,*"):
        result = await mgr.send("cli", cmd, reply_window_ms=800)
        print(f">> {cmd}")
        for r in result["replies_within_window"]:
            print(f"   << {r['raw']}")
    print(f"\nListening for {listen_s}s — press buttons / pull trigger now...",
          file=sys.stderr)
    last_seq = mgr.sessions["cli"].seq
    for _ in range(listen_s):
        await asyncio.sleep(1)
        out = mgr.get_events("cli", since_seq=last_seq)
        for ev in out["events"]:
            if ev["direction"] == "rx":
                print(f"[{ev['t_ms']:>7}ms] {ev['raw']}   {ev['parsed']}")
            last_seq = ev["seq"]
    await mgr.disconnect("cli")
    print("Probe complete.", file=sys.stderr)


# Verified against the official iOS Callsign app (protocol §7e). This is a
# transcription of a capture of a real game, not a guess — earlier versions of
# this sequence were reverse-engineered from the connect ritual and never made
# the gun go live. Three things turned out to matter:
#   1. $AMMO must be sent after spawn, or the gun is live with no ammunition.
#   2. All seven $BMAP entries, and $BMAP,0,0 again AFTER $SPAWN.
#   3. $SPAWN,,* with the empty token, not $SPAWN,*.
# Note the app does NOT send $PHONE.

# CLAUDE.md says 30 rather than the app's 100 ("painfully loud indoors").
# BUT verified 2026-08-23: at 30 the weapon fire audio is inaudible — the sounds
# resolve fine (R18/D0x all play), they are just too quiet to hear. The official
# app uses 69. Kept 30 as the documented default; override per-run on the CLI.
DEFAULT_VOLUME = 30


def volume_cmd(level: int) -> str:
    return f"$VOL,{level},0,*"


GAME_CONFIG = [
    "$CLEAR,*",
    "$START,*",
    "$GSET,1,0,1,0,1,0,50,1,*",
    # tokens 3-5 = HP,armor,shield (45,70,70); tail is the app's audio set
    "$PSET,0,0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*",
    # slot 0 primary, slot 1 secondary, slot 4 melee
    "$WEAP,0,,100,0,3,9,0,,,,,,,,75,850,36,216,1700,0,9,100,100,275,0,,,R18,,,,D04,D03,D02,D18,,,,,36,108,75,*",
    "$WEAP,1,2,100,0,0,45,0,,,,,,70,80,900,850,6,24,400,2,7,100,100,,0,,,T01,,,,D01,D28,D27,D18,,,,,6,12,75,30,*",
    "$WEAP,4,1,90,13,1,90,0,,,,,,,,1000,100,1,0,0,10,13,100,100,,0,0,,M92,,,,,,,,,,,,1,0,20,*",
    # IR event table — what each incoming IR protocol does to us
    "$SIR,0,0,,1,0,0,1,,*",
    "$SIR,0,1,,36,0,0,1,,*",
    "$SIR,0,3,,37,0,0,1,,*",
    "$SIR,8,0,,38,0,0,1,,*",
    "$SIR,9,3,,24,10,0,,,*",
    "$SIR,10,0,X13,1,0,100,2,60,*",
    "$SIR,6,0,H02,1,0,90,1,40,*",
    "$SIR,13,1,H57,1,0,0,1,,*",
    "$SIR,13,0,H50,1,0,0,1,,*",
    "$SIR,13,3,H49,1,0,100,0,60,*",
    # Button map — mandatory. Without these the trigger gives the "disabled" chirp.
    "$BMAP,0,0,,,,,*",
    "$BMAP,1,100,0,1,99,99,*",
    "$BMAP,2,97,,,,,*",
    "$BMAP,3,98,,,,,*",
    "$BMAP,4,98,,,,,*",
    "$BMAP,5,98,,,,,*",
    "$BMAP,8,4,,,,,*",
    "$PLAYX,0,*",
    "$PLAY,VA81,4,6,,,,,*",
]

# Takes the tagger live. $AMMO loads the magazines; $BMAP,0,0 is re-sent after
# spawn (the app does this, and the trigger does not work reliably without it).
SPAWN_SEQUENCE = [
    "$SPAWN,,*",
    "$AMMO,0,36,108,1,*",
    "$AMMO,1,6,12,1,*",
    "$BMAP,0,0,,,,,*",
]

# Respawn after death. Ammo is restored implicitly — no $AMMO needed (§7f).
RESPAWN_SEQUENCE = ["$HLOOP,0,0,*", "$SPAWN,,*"]

# Clean teardown, as the app does it at end of game.
END_SEQUENCE = ["$HLED,,6,,,,,*", "$STOP,*", "$CLEAR,*",
                "$PLAY,VS6,4,6,,,,,*"]

# Back-compat: the config phase alone.
GAME_SEQUENCE = GAME_CONFIG

# Weapon definitions, stored as the frame TAIL (everything after "$WEAP,<slot>")
# so the same weapon can be loaded into any slot. The first three are transcribed
# from the iOS Callsign capture and are verified on hardware; the rest come from
# protocol §6 and have NOT been fired by us.
WEAPON_TAILS = {
    # verified (§7e capture)
    "primary": ",,100,0,3,9,0,,,,,,,,75,850,36,216,1700,0,9,100,100,275,0,,,R18,,,,D04,D03,D02,D18,,,,,36,108,75,*",
    "secondary": ",2,100,0,0,45,0,,,,,,70,80,900,850,6,24,400,2,7,100,100,,0,,,T01,,,,D01,D28,D27,D18,,,,,6,12,75,30,*",
    "melee": ",1,90,13,1,90,0,,,,,,,,1000,100,1,0,0,10,13,100,100,,0,0,,M92,,,,,,,,,,,,1,0,20,*",
    # unverified (§6 doc examples)
    "ar": ",,100,0,0,24,0,,,,,,,,100,850,32,32768,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,9999999,75,,*",
    "charge": ",,100,8,0,150,0,,,,,,,,1250,850,100,32768,2500,0,14,100,100,,14,,,E03,C15,C17,,D30,D29,D37,A73,C19,C04,20,150,100,9999999,75,,*",
}

WEAPONS = tuple(WEAPON_TAILS)

# (magazine, reserve) per weapon, for the $AMMO frames sent after $SPAWN.
# Taken from the capture for the verified three; the $WEAP token positions that
# carry ammo are not confidently decoded, so these are stated explicitly rather
# than parsed back out of the tail.
WEAPON_AMMO = {
    "primary": (36, 108),      # from $AMMO,0,36,108,1,* in the §7e capture
    "secondary": (6, 12),      # from $AMMO,1,6,12,1,*
    "melee": (1, 0),
    "ar": (32, 9999999),       # unverified — from the §6 doc string
    "charge": (20, 9999999),   # unverified
}


def weap(slot: int, name: str) -> str:
    return f"$WEAP,{slot}{WEAPON_TAILS[name]}"


def loadout(primary: str, secondary: str = "secondary") -> list[str]:
    """Slot 0 = chosen weapon, slot 1 = something to switch TO, slot 4 = melee.

    Alt-fire is mapped to function 100 ($BMAP,1,100,...) which cycles weapons —
    with only slot 0 loaded it has nothing to cycle to and reloads instead
    (observed 2026-08-23). The official app always sends a melee in slot 4
    regardless of what the player picked, so we do too.
    """
    if secondary == primary:            # don't cycle between two identical guns
        secondary = "primary" if primary != "primary" else "secondary"
    return [weap(0, primary), weap(1, secondary), weap(4, "melee")]

# The firmware's own menu ranges (manual §7h) — offer what the gun offers.
RESPAWN_CHOICES = (0, 15, 30, 60)
DURATION_CHOICES = (5, 10, 15, 20, 30)


async def _deathmatch(address: str, minutes: int = 5, respawn_s: int = 15,
                      volume: int = 69, weapon: str = "primary") -> None:
    """Free-for-all deathmatch. Host owns the clock, the rules and the score.

    The tagger enforces nothing (§7g) — no clock, no score, no respawn. FFA per
    the manual (§7h) means no teams and friendly fire on, so every hit counts.

    NOTE: the $GSET token encoding is still undecoded, so we send the captured
    value rather than guessing at a "FFA bit". That is sound precisely because
    the gun does not enforce modes — FFA lives in this loop, not in the frame.
    """
    from .ble import ConnectionManager
    if weapon not in WEAPON_TAILS:
        print(f"unknown weapon {weapon!r}; choose from: {', '.join(WEAPONS)}",
              file=sys.stderr)
        sys.exit(2)

    mgr = ConnectionManager()
    await mgr.connect(address, "cli")

    async def send_all(cmds, label):
        print(f"--- {label}", file=sys.stderr)
        for cmd in cmds:
            await mgr.send("cli", cmd, reply_window_ms=400)
            print(f">> {cmd}", flush=True)

    guns = loadout(weapon)
    config = [volume_cmd(volume)]
    for frame in GAME_CONFIG:
        # replace the capture's three weapons with our loadout, in place
        if frame.startswith("$WEAP,0,"):
            config.extend(guns)
        elif frame.startswith("$WEAP,"):
            continue
        else:
            config.append(frame)

    hits = deaths = respawns = 0
    try:
        await send_all(config, f"configuring FFA ({weapon}, volume {volume})")
        # $AMMO must match the weapons we actually loaded, not the capture's
        pri_mag, pri_res = WEAPON_AMMO[weapon]
        sec_name = next(n for n in WEAPON_TAILS
                        if weap(1, n) == guns[1])
        sec_mag, sec_res = WEAPON_AMMO[sec_name]
        spawn = [
            "$SPAWN,,*",
            f"$AMMO,0,{pri_mag},{pri_res},1,*",
            f"$AMMO,1,{sec_mag},{sec_res},1,*",
            "$BMAP,0,0,,,,,*",
        ]
        await send_all(spawn, "spawning")

        ends_at = time.monotonic() + minutes * 60
        print(f"\n*** DEATHMATCH LIVE — {minutes} min, respawn {respawn_s}s ***\n",
              file=sys.stderr)
        last_seq = mgr.sessions["cli"].seq
        dead_at = None

        while time.monotonic() < ends_at:
            await asyncio.sleep(1)
            for ev in mgr.get_events("cli", since_seq=last_seq)["events"]:
                last_seq = ev["seq"]
                if ev["direction"] != "rx":
                    continue
                raw = ev["raw"]
                if raw.startswith("$HIR,"):
                    hits += 1
                elif raw.startswith("$HP,0,") and dead_at is None:
                    deaths += 1
                    dead_at = time.monotonic()
                    print(f"   ** DOWN (death {deaths}) — respawn in {respawn_s}s",
                          file=sys.stderr)
                elif raw.startswith(("$HP,", "$ALCD,", "$LCD,")):
                    print(f"   {raw}", flush=True)

            remaining = ends_at - time.monotonic()
            if dead_at and time.monotonic() - dead_at >= respawn_s:
                if remaining > 5:
                    await send_all(RESPAWN_SEQUENCE, "respawn")
                    respawns += 1
                    last_seq = mgr.sessions["cli"].seq
                dead_at = None

        print(f"\n*** TIME — hits taken {hits}, deaths {deaths}, "
              f"respawns {respawns} ***", file=sys.stderr)
    finally:
        try:
            await send_all(END_SEQUENCE, "ending game")
        except Exception as e:  # noqa: BLE001 — link may already be gone
            print(f"(teardown skipped: {type(e).__name__}: {e})", file=sys.stderr)
        await mgr.disconnect("cli")


async def _startgame(address: str, listen_s: int, respawn_s: int = 10,
                     volume: int = DEFAULT_VOLUME) -> None:
    """Run a real game: push config, spawn, then act as game host.

    Mirrors what the official app does (protocol §7e/§7f), including
    host-driven respawn — the gun does not revive itself.
    """
    from .ble import ConnectionManager
    mgr = ConnectionManager()
    await mgr.connect(address, "cli")

    async def send_all(cmds: list[str], label: str) -> None:
        print(f"--- {label}", file=sys.stderr)
        for cmd in cmds:
            result = await mgr.send("cli", cmd, reply_window_ms=400)
            print(f">> {cmd}", flush=True)
            for r in result["replies_within_window"]:
                print(f"   << {r['raw']}", flush=True)

    try:
        await send_all([volume_cmd(volume)] + GAME_CONFIG,
                       f"configuring (volume {volume})")
        await send_all(SPAWN_SEQUENCE, "spawning (tagger goes live here)")
        print(f"\nLIVE. Listening {listen_s}s — pull the trigger, get tagged. "
              f"Auto-respawn {respawn_s}s after death.\n", file=sys.stderr)

        last_seq = mgr.sessions["cli"].seq
        dead_at: float | None = None
        deaths = 0
        for _ in range(listen_s):
            await asyncio.sleep(1)
            out = mgr.get_events("cli", since_seq=last_seq)
            for ev in out["events"]:
                if ev["direction"] == "rx":
                    print(f"[{ev['t_ms']:>7}ms] {ev['raw']}   {ev['parsed']}",
                          flush=True)
                    # $HP,0,0,0,* = death (§7f). Host owns the respawn.
                    if ev["raw"].startswith("$HP,0,") and dead_at is None:
                        dead_at = time.monotonic()
                        deaths += 1
                        print(f"   ** DEATH #{deaths} — respawning in "
                              f"{respawn_s}s", file=sys.stderr)
                last_seq = ev["seq"]

            if dead_at is not None and time.monotonic() - dead_at >= respawn_s:
                await send_all(RESPAWN_SEQUENCE, "respawn")
                dead_at = None
                last_seq = mgr.sessions["cli"].seq
        print(f"\n{deaths} death(s) handled.", file=sys.stderr)
    finally:
        try:
            await send_all(END_SEQUENCE, "ending game")
        except Exception as e:  # noqa: BLE001 — link may already be gone
            print(f"(teardown skipped: {type(e).__name__}: {e})",
                  file=sys.stderr)
        await mgr.disconnect("cli")
    print("Done. Power-cycle the tagger to clear any residual state.",
          file=sys.stderr)


async def _arena(addresses: list[str], minutes: int = 3, respawn_s: int = 15,
                 volume: int = 69, weapon: str = "primary") -> None:
    """Run one game across several taggers from a single host.

    Each tagger gets the same config but a distinct `$TID` (team id), which is
    also the experiment §7f could not run: with two players on default ids every
    `$HIR` read `1,1`, so shooter attribution stayed unconfirmed. Distinct ids
    should make the difference visible in the hit frames.
    """
    from .ble import ConnectionManager
    if weapon not in WEAPON_TAILS:
        print(f"unknown weapon {weapon!r}; choose from: {', '.join(WEAPONS)}",
              file=sys.stderr)
        sys.exit(2)

    mgr = ConnectionManager()
    guns = loadout(weapon)
    pri_mag, pri_res = WEAPON_AMMO[weapon]
    sec_name = next(n for n in WEAPON_TAILS if weap(1, n) == guns[1])
    sec_mag, sec_res = WEAPON_AMMO[sec_name]

    players = [(f"p{i}", addr, i + 1) for i, addr in enumerate(addresses)]
    stats = {a: {"hits": 0, "deaths": 0, "respawns": 0, "hir": []}
             for a, _, _ in players}

    for alias, addr, tid in players:
        print(f"connecting {alias} (team {tid}) -> {addr}", file=sys.stderr)
        await mgr.connect(addr, alias)

    async def push(alias: str, cmds: list[str]) -> None:
        for cmd in cmds:
            await mgr.send(alias, cmd, reply_window_ms=350)

    try:
        for alias, _addr, tid in players:
            config = [volume_cmd(volume)]
            for frame in GAME_CONFIG:
                if frame.startswith("$WEAP,0,"):
                    config.extend(guns)
                elif frame.startswith("$WEAP,"):
                    continue
                else:
                    config.append(frame)
            config.append(f"$TID,{tid},*")     # distinct team per tagger
            print(f"--- configuring {alias} (team {tid})", file=sys.stderr)
            await push(alias, config)

        for alias, _addr, _tid in players:
            await push(alias, ["$SPAWN,,*",
                               f"$AMMO,0,{pri_mag},{pri_res},1,*",
                               f"$AMMO,1,{sec_mag},{sec_res},1,*",
                               "$BMAP,0,0,,,,,*"])
            print(f"--- {alias} LIVE", file=sys.stderr)

        ends_at = time.monotonic() + minutes * 60
        print(f"\n*** ARENA LIVE — {len(players)} taggers, {minutes} min ***\n",
              file=sys.stderr)
        seqs = {a: mgr.sessions[a].seq for a, _, _ in players}
        dead_at: dict[str, float | None] = {a: None for a, _, _ in players}

        while time.monotonic() < ends_at:
            await asyncio.sleep(1)
            for alias, _addr, _tid in players:
                for ev in mgr.get_events(alias, since_seq=seqs[alias])["events"]:
                    seqs[alias] = ev["seq"]
                    if ev["direction"] != "rx":
                        continue
                    raw = ev["raw"]
                    if raw.startswith("$HIR,"):
                        stats[alias]["hits"] += 1
                        stats[alias]["hir"].append(raw)
                        print(f"[{alias}] HIT  {raw}", flush=True)
                    elif raw.startswith("$HP,0,") and dead_at[alias] is None:
                        stats[alias]["deaths"] += 1
                        dead_at[alias] = time.monotonic()
                        print(f"[{alias}] ** DOWN — respawn in {respawn_s}s",
                              file=sys.stderr)
                    elif raw.startswith("$HP,"):
                        print(f"[{alias}] {raw}", flush=True)

                if (dead_at[alias] is not None
                        and time.monotonic() - dead_at[alias] >= respawn_s):
                    if ends_at - time.monotonic() > 5:
                        await push(alias, RESPAWN_SEQUENCE)
                        stats[alias]["respawns"] += 1
                        seqs[alias] = mgr.sessions[alias].seq
                    dead_at[alias] = None

        print("\n*** TIME ***", file=sys.stderr)
        for alias, _addr, tid in players:
            s = stats[alias]
            print(f"  {alias} (team {tid}): hits {s['hits']}  deaths "
                  f"{s['deaths']}  respawns {s['respawns']}", file=sys.stderr)
            uniq = sorted(set(s["hir"]))
            for u in uniq[:6]:
                print(f"      distinct $HIR: {u}", file=sys.stderr)
    finally:
        for alias, _addr, _tid in players:
            try:
                await push(alias, END_SEQUENCE)
            except Exception as e:  # noqa: BLE001 — link may already be gone
                print(f"({alias} teardown skipped: {type(e).__name__})",
                      file=sys.stderr)
            try:
                await mgr.disconnect(alias)
            except Exception:  # noqa: BLE001
                pass


async def _diag(address: str) -> None:
    """Output-command diagnostics using the official app's connect ritual
    (captured via HCI snoop): STOP → PLAYX → VOL → PLAY VA20. No $PHONE.

    Reconnects automatically if the tagger drops the link mid-sequence.
    """
    from bleak.exc import BleakError

    from .ble import ConnectionManager
    mgr = ConnectionManager()
    steps = [
        ("$STOP,*", "app-ritual: stop"),
        ("$PLAYX,0,*", "app-ritual: clear sounds"),
        ("$VOL,30,0,*", "app-ritual: volume 30 (kind to ears)"),
        ("$PLAY,VA20,3,9,,,,,*", "expect 'connection established' voice"),
        ("$VERSION,*", "expect $VERSION reply"),
        ("$GLED,1,0,1,0,10,,*", "LEDs GREEN?"),
        ("$PLAY,H29,,,,,,,*", "sound H29 playing?"),
        ("$GLED,1,1,0,0,10,,*", "LEDs RED?"),
        ("$PLAY,VA9E,,,,,,,*", "sound VA9E playing?"),
        ("$GLED,1,0,0,1,10,,*", "LEDs BLUE?"),
        ("$PLAY,V3M,,,,,,,*", "sound V3M playing?"),
        ("$GLED,1,1,1,1,10,,*", "LEDs WHITE?"),
    ]
    await mgr.connect(address, "cli")
    await asyncio.sleep(2)  # let the link settle before first write
    i = 0
    reconnects = 0
    while i < len(steps):
        cmd, expect = steps[i]
        try:
            result = await mgr.send("cli", cmd, reply_window_ms=600)
        except (BleakError, OSError) as e:
            reconnects += 1
            if reconnects > 5:
                print(f"!! giving up after 5 reconnects ({e})", flush=True)
                return
            print(f"!! link dropped at step {i} ({e}); reconnecting "
                  f"({reconnects}/5)...", flush=True)
            try:
                await mgr.disconnect("cli")
            except Exception:  # noqa: BLE001
                mgr.sessions.pop("cli", None)
            while True:
                await asyncio.sleep(3)
                try:
                    await mgr.connect(address, "cli")
                    await asyncio.sleep(2)
                    break
                except Exception as ce:  # noqa: BLE001
                    reconnects += 1
                    if reconnects > 5:
                        print(f"!! giving up: reconnect failed ({ce})",
                              flush=True)
                        return
                    print(f"!! reconnect failed ({ce}); retrying "
                          f"({reconnects}/5)...", flush=True)
                    mgr.sessions.pop("cli", None)
            continue
        print(f">> {cmd}    [{expect}]", flush=True)
        for r in result["replies_within_window"]:
            print(f"   << {r['raw']}", flush=True)
        i += 1
        await asyncio.sleep(4)
    print("\nListening 30s — press each button once, slowly...", file=sys.stderr)
    last_seq = mgr.sessions["cli"].seq
    for _ in range(30):
        await asyncio.sleep(1)
        out = mgr.get_events("cli", since_seq=last_seq)
        for ev in out["events"]:
            if ev["direction"] == "rx":
                print(f"[{ev['t_ms']:>7}ms] {ev['raw']}", flush=True)
            last_seq = ev["seq"]
    await mgr.disconnect("cli")
    print("Diag complete.", file=sys.stderr)


def main() -> None:
    args = sys.argv[1:]
    if not args:
        from .server import main as run_server
        run_server()
        return
    cmd = args[0]
    if cmd == "scan":
        asyncio.run(_scan(int(args[1]) if len(args) > 1 else 8))
    elif cmd == "identify" and len(args) > 1:
        asyncio.run(_identify(args[1]))
    elif cmd == "listen" and len(args) > 1:
        asyncio.run(_listen(args[1], int(args[2]) if len(args) > 2 else 60,
                            pair="pair" in args))
    elif cmd == "probe" and len(args) > 1:
        asyncio.run(_probe(args[1], int(args[2]) if len(args) > 2 else 60))
    elif cmd == "startgame" and len(args) > 1:
        asyncio.run(_startgame(args[1],
                               int(args[2]) if len(args) > 2 else 90,
                               int(args[3]) if len(args) > 3 else 10,
                               int(args[4]) if len(args) > 4 else DEFAULT_VOLUME))
    elif cmd == "deathmatch" and len(args) > 1:
        asyncio.run(_deathmatch(args[1],
                                int(args[2]) if len(args) > 2 else 5,
                                int(args[3]) if len(args) > 3 else 15,
                                int(args[4]) if len(args) > 4 else 69,
                                args[5] if len(args) > 5 else "primary"))
    elif cmd == "arena" and len(args) > 2:
        addrs = [a for a in args[1:] if "-" in a and len(a) > 20]
        rest = [a for a in args[1 + len(addrs):]]
        asyncio.run(_arena(addrs,
                           int(rest[0]) if len(rest) > 0 else 3,
                           int(rest[1]) if len(rest) > 1 else 15,
                           int(rest[2]) if len(rest) > 2 else 69,
                           rest[3] if len(rest) > 3 else "primary"))
    elif cmd == "diag" and len(args) > 1:
        asyncio.run(_diag(args[1]))
    else:
        print(__doc__, file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
