"""Entry point.

  python -m brx_mcp            # run the MCP server (stdio)
  python -m brx_mcp scan [s]   # one-shot BLE scan (first-contact CLI)
  python -m brx_mcp identify <address>
  python -m brx_mcp listen <address> [seconds]   # read-only live console
  python -m brx_mcp startgame <address> [seconds] [respawn_s] [volume]
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
    elif cmd == "diag" and len(args) > 1:
        asyncio.run(_diag(args[1]))
    else:
        print(__doc__, file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
