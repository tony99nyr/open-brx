"""Entry point.

  python -m brx_mcp            # run the MCP server (stdio)
  python -m brx_mcp scan [s]   # one-shot BLE scan (first-contact CLI)
  python -m brx_mcp identify <address>
  python -m brx_mcp listen <address> [seconds]   # read-only live console
"""

from __future__ import annotations

import asyncio
import json
import sys


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


# Known-good frames straight from protocol/brx-protocol.md §3/§5/§6.
GAME_SEQUENCE = [
    "$PHONE,*",
    "$CLEAR,*",
    "$START,*",
    "$GSET,0,0,1,0,1,0,50,1,*",
    # Health as HP,Armor,Shield triplet (doc §3); tail tokens from doc example
    "$PSET,63,2,500,250,150,50,,H44,JAD,V33,*",
    # Assault Rifle in slot 0 (documented known-good definition)
    "$WEAP,0,,100,0,0,24,0,,,,,,,,100,850,32,32768,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,9999999,75,,*",
    # Standard weapon IR → damage shields→armor→HP; respawn/shield/armor pickups
    "$SIR,0,0,,1,0,0,1,,*",
    "$SIR,0,1,,36,0,0,1,,*",
    "$SIR,1,0,H29,10,0,0,1,,*",
    "$SIR,2,1,VA8C,11,0,0,1,,*",
    "$SIR,3,0,VA16,13,0,0,1,,*",
    "$AS,1,0,4,0,10,0,95,*",
    # Pre-battle selections: team 1, equip weapon slot 0
    "$PBTEAM,1,*",
    "$PBWEAP,0,*",
    # Hypothesis: phone mode unmaps buttons; restore local functions.
    # Trigger→function 0 (fire?), alt-fire→97 (known: reload)
    "$BMAP,0,0,*",
    "$BMAP,1,97,*",
    "$SPAWN,*",
    # Some flows may want START after config to actually begin play
    "$START,*",
    # Immediate-feedback diagnostics: LEDs green + play a sound
    "$GLED,1,0,1,0,10,,*",
    "$PLAY,H29,,,,,,,*",
]


async def _startgame(address: str, listen_s: int) -> None:
    """Push a minimal known-good game config, spawn the player, then listen."""
    from .ble import ConnectionManager
    mgr = ConnectionManager()
    await mgr.connect(address, "cli")
    print("Connected. Pushing game config...", file=sys.stderr)
    for cmd in GAME_SEQUENCE:
        result = await mgr.send("cli", cmd, reply_window_ms=400)
        print(f">> {cmd}", flush=True)
        for r in result["replies_within_window"]:
            print(f"   << {r['raw']}", flush=True)
    print(f"\nGame pushed. Listening {listen_s}s — shoot, get shot, press "
          "things...", file=sys.stderr)
    last_seq = mgr.sessions["cli"].seq
    for _ in range(listen_s):
        await asyncio.sleep(1)
        out = mgr.get_events("cli", since_seq=last_seq)
        for ev in out["events"]:
            if ev["direction"] == "rx":
                print(f"[{ev['t_ms']:>7}ms] {ev['raw']}   {ev['parsed']}",
                      flush=True)
            last_seq = ev["seq"]
    await mgr.disconnect("cli")
    print("Done. (Game may keep running on the tagger; power-cycle resets.)",
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
        asyncio.run(_startgame(args[1], int(args[2]) if len(args) > 2 else 90))
    elif cmd == "diag" and len(args) > 1:
        asyncio.run(_diag(args[1]))
    else:
        print(__doc__, file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
