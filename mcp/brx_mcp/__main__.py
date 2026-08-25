"""Entry point.

  python -m brx_mcp            # run the MCP server (stdio)
  python -m brx_mcp scan [s]   # one-shot BLE scan (first-contact CLI)
  python -m brx_mcp identify <address>
  python -m brx_mcp diagnose <address>           # firmware + battery + latency sweep
  python -m brx_mcp fleet [addr...]              # armory dashboard (scan + diagnose each)
  python -m brx_mcp listen <address> [seconds]   # read-only live console
  python -m brx_mcp startgame <address> [seconds] [respawn_s] [volume]
  python -m brx_mcp deathmatch <address> [minutes] [respawn_s] [volume] [weapon]
  python -m brx_mcp arena <addr1> <addr2> [...] [minutes] [respawn_s] [volume] [weapon]
  python -m brx_mcp fieldstart <addr...> [volume] [weapon]   # start, then disconnect
  python -m brx_mcp fieldresults <addr...> [listen_s]        # reconnect and report
  python -m brx_mcp extraction-sim                # narrated Extraction-mode demo (no BLE)
  python -m brx_mcp game-sim [mode]               # narrated M0 demo, any mode, no BLE
      modes: tdm ffa infection lms cs domination koth ctf extraction
  python -m brx_mcp play <mode> <addr...> [k=v]   # run a configured game LIVE (k=v: volume, outdoor, hp, ...)
      modes: tdm ffa infection lms cs domination koth ctf extraction
      a gun may carry a gamertag: <addr>@<Gamertag> (pushed to the gun via $NAME)
  python -m brx_mcp diag-game <address> [2guns] [ir]   # structured end-to-end test suite → scorecard
  python -m brx_mcp ir-capture [port] [seconds]        # capture BRX IR frames via the ESP32 bridge
  python -m brx_mcp ir-emit <bits> [port] [repeat]     # emit an IR frame via the ESP32 bridge
  python -m brx_mcp ir-range [port] [secs] [shots]     # walk-back range reading (hit-rate at a distance)
  python -m brx_mcp reset <address>                     # reset a tagger to clean idle (revive if dead, silence, headset dark)
  python -m brx_mcp rename <address> <name>             # set a tagger's persistent name over BLE ($NAME); power-cycle to see the advert update
  python -m brx_mcp usb-query [port]                    # read a cabled tagger's device record (headset PIN, serial, ...)
  python -m brx_mcp armory                              # QUERY the cabled tagger + print the accumulated gun<->headset inventory
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

    async def push(alias: str, cmds: list[str]) -> None:
        for cmd in cmds:
            await mgr.send(alias, cmd, reply_window_ms=350)

    spawn_cmds = ["$SPAWN,,*",
                  f"$AMMO,0,{pri_mag},{pri_res},1,*",
                  f"$AMMO,1,{sec_mag},{sec_res},1,*",
                  "$BMAP,0,0,,,,,*"]

    def config_for(tid: int) -> list[str]:
        cfg = [volume_cmd(volume)]
        for frame in GAME_CONFIG:
            if frame.startswith("$WEAP,0,"):
                cfg.extend(guns)
            elif frame.startswith("$WEAP,") or frame.startswith("$PLAY,VA81"):
                continue          # countdown is fired separately, in unison
            else:
                cfg.append(frame)
        cfg.append(f"$TID,{tid},*")           # distinct team per tagger
        return cfg

    try:
        # Connect inside the try so a failure on tagger N still tears down the
        # taggers already connected (the finally disconnects every alias).
        for alias, addr, tid in players:
            print(f"connecting {alias} (team {tid}) -> {addr}", file=sys.stderr)
            await mgr.connect(addr, alias)

        # Configure every tagger CONCURRENTLY. Doing this serially made each
        # tagger count down as its own config finished, so players went live
        # seconds apart — one shooting while another was still counting.
        print(f"--- configuring {len(players)} taggers in parallel",
              file=sys.stderr)
        await asyncio.gather(*(push(alias, config_for(tid))
                               for alias, _addr, tid in players))

        # Countdown together, then spawn when it ends. VA81 measured ~2.7 s.
        print("--- 3... 2... 1...", file=sys.stderr)
        await asyncio.gather(*(push(alias, ["$PLAY,VA81,4,6,,,,,*"])
                               for alias, _addr, _tid in players))
        await asyncio.sleep(2.8)
        await asyncio.gather(*(push(alias, spawn_cmds)
                               for alias, _addr, _tid in players))
        print("--- ALL LIVE", file=sys.stderr)

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


def _split_addrs(args: list[str]) -> tuple[list[str], list[str]]:
    """Split leading BLE addresses from trailing options.

    Address formats differ by platform — macOS/CoreBluetooth gives a 36-char
    UUID, Windows/WinRT and BlueZ give a 17-char MAC. Never pattern-match on
    one of them (an earlier version required a '-' and >20 chars, which found
    zero addresses on Windows). Instead: consume leading args until one looks
    like an option, i.e. an integer or a known weapon name.
    """
    addrs: list[str] = []
    for i, a in enumerate(args):
        if a.isdigit() or a in WEAPON_TAILS:
            return addrs, list(args[i:])
        addrs.append(a)
    return addrs, []


async def _fieldstart(addresses: list[str], volume: int = 69,
                      weapon: str = "primary") -> None:
    """Configure + spawn taggers, then DISCONNECT and leave them running.

    The experiment behind the range problem (followups A): does a tagger keep
    playing once the host goes away? Everything we have built so far assumes the
    laptop stays in BLE range, which it will not on a real field.
    """
    from .ble import ConnectionManager
    mgr = ConnectionManager()
    guns = loadout(weapon)
    pri_mag, pri_res = WEAPON_AMMO[weapon]
    sec_name = next(n for n in WEAPON_TAILS if weap(1, n) == guns[1])
    sec_mag, sec_res = WEAPON_AMMO[sec_name]
    players = [(f"p{i}", a, i + 1) for i, a in enumerate(addresses)]

    async def push(alias, cmds):
        for c in cmds:
            await mgr.send(alias, c, reply_window_ms=350)

    def cfg(tid):
        out = [volume_cmd(volume)]
        for f in GAME_CONFIG:
            if f.startswith("$WEAP,0,"):
                out.extend(guns)
            elif f.startswith("$WEAP,") or f.startswith("$PLAY,VA81"):
                continue
            else:
                out.append(f)
        out.append(f"$TID,{tid},*")
        return out

    try:
        # Connect inside the try so a partial failure still disconnects the
        # taggers already connected (fieldstart ends by disconnecting anyway).
        for alias, addr, tid in players:
            print(f"connecting {alias} (team {tid})", file=sys.stderr)
            await mgr.connect(addr, alias)

        await asyncio.gather(*(push(a, cfg(t)) for a, _, t in players))
        print("--- 3... 2... 1...", file=sys.stderr)
        await asyncio.gather(*(push(a, ["$PLAY,VA81,4,6,,,,,*"])
                               for a, _, _ in players))
        await asyncio.sleep(2.8)
        await asyncio.gather(*(push(a, ["$SPAWN,,*",
                                        f"$AMMO,0,{pri_mag},{pri_res},1,*",
                                        f"$AMMO,1,{sec_mag},{sec_res},1,*",
                                        "$BMAP,0,0,,,,,*"]) for a, _, _ in players))
        print("--- ALL LIVE", file=sys.stderr)
        print("\n*** HOST DISCONNECTED — taggers are on their own ***\n"
              "Go play out of range, then run:  python -m brx_mcp fieldresults <addrs...>",
              file=sys.stderr)
    finally:
        # Always release every open link — the whole point is to leave the
        # taggers running standalone, and on failure we must not leak sessions.
        for alias in list(mgr.sessions):
            try:
                await mgr.disconnect(alias)
            except Exception:  # noqa: BLE001
                pass


async def _fieldresults(addresses: list[str], listen_s: int = 12) -> None:
    """Reconnect after a field game and report whatever the taggers still know.

    Read-mostly on purpose: `$SP` is NOT sent, because $SP,99,* is half the panic
    sequence and would end a game rather than report on one. This connects,
    listens for anything unsolicited, then asks only for state we know is safe.
    """
    from .ble import ConnectionManager
    mgr = ConnectionManager()
    for i, addr in enumerate(addresses):
        alias = f"p{i}"
        print(f"\n=== {alias}  {addr} ===", file=sys.stderr)
        try:
            await mgr.connect(addr, alias)
        except Exception as e:  # noqa: BLE001
            print(f"  UNREACHABLE: {type(e).__name__}: {e}", file=sys.stderr)
            continue
        print(f"  connected — listening {listen_s}s (press buttons / pull the "
              f"trigger to show whether it is still in a game)", file=sys.stderr)
        seq = mgr.sessions[alias].seq
        for _ in range(listen_s):
            await asyncio.sleep(1)
            for ev in mgr.get_events(alias, since_seq=seq)["events"]:
                seq = ev["seq"]
                if ev["direction"] == "rx":
                    print(f"  << {ev['raw']}", flush=True)
        r = await mgr.send(alias, "$PING,*", reply_window_ms=1200)
        print(f"  ping: {[x['raw'] for x in r['replies_within_window']]}",
              file=sys.stderr)
        await mgr.disconnect(alias)


async def _diagnose(address: str, volts_wait_s: int = 10) -> None:
    """Print a one-shot BLE diagnostic record for one tagger."""
    from .ble import ConnectionManager
    rec = await ConnectionManager().diagnose(address, volts_wait_s=volts_wait_s)
    _print(rec)


async def _fleet(addresses: list[str]) -> None:
    """Scan (or use given addresses) and print the armory dashboard."""
    from .ble import ConnectionManager
    result = await ConnectionManager().fleet_status(addresses or None)
    print(f"scanned {result['scanned']} devices; "
          f"{len(result['taggers'])} tagger(s):", file=sys.stderr)
    for t in result["taggers"]:
        batt = t.get("battery") or {}
        line = (f"  {t.get('name') or t['address'][:16]:20} "
                f"fw={t.get('firmware') or '?':8} "
                f"batt={batt.get('pack_v') or '?':>5}V "
                f"{('('+str(batt.get('charge_pct'))+'%)') if batt.get('charge_pct') is not None else '':6} "
                f"ping={t.get('pong_latency_ms') or '?':>4}ms "
                f"rssi={t.get('rssi') or '?'}"
                + ("" if t.get("reachable") else "  UNREACHABLE"))
        print(line, file=sys.stderr)
    _print(result)


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
    # The Windows console defaults to cp1252, which raises UnicodeEncodeError on the
    # emoji/arrows in game output (crashed a live game mid-score). Force UTF-8 with
    # graceful fallback (errors="replace" → no glyph can EVER kill a command) and
    # line buffering so live game/scoreboard output streams in real time.
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
        except Exception:  # noqa: BLE001 — older Pythons / non-reconfigurable streams
            pass
    args = sys.argv[1:]
    if not args:
        from .server import main as run_server
        run_server()
        return
    cmd = args[0]
    try:
        _dispatch(cmd, args)
    except ValueError as e:
        print(f"bad numeric argument: {e}\n", file=sys.stderr)
        print(__doc__, file=sys.stderr)
        sys.exit(2)


def _extraction_sim() -> None:
    """Play a scripted Extraction match against the pure rules engine — no BLE.

    Demonstrates the full genre loop (loot → loud channel → drop-on-death →
    steal the loot → extract → win) so the mode can be seen working before any
    hardware exists. See docs/game-modes.md §Extraction and brx_mcp/modes/.
    """
    from .modes.extraction import (Bank, Callout, ChannelReset, ChannelStarted,
                                   Extracted, ExtractionConfig, ExtractionGame,
                                   GameOver, LootDropped, SendFrame)

    def render(actions: list) -> None:
        for a in actions:
            if isinstance(a, Callout):
                who = "FIELD" if a.scope == "all" else a.scope
                print(f"      📢 [{who}] {a.text}")
            elif isinstance(a, ChannelStarted):
                print(f"      ⏳ {a.player_id} begins extracting at {a.zone}")
            elif isinstance(a, ChannelReset):
                print(f"      ✖  {a.player_id}'s channel reset ({a.reason})")
            elif isinstance(a, LootDropped):
                print(f"      💰 {a.from_player} dropped {a.value} loot "
                      f"(token #{a.drop_id}, policy={a.by})")
            elif isinstance(a, Extracted):
                print(f"      ✅ {a.player_id} EXTRACTED with {a.value} loot")
            elif isinstance(a, Bank):
                print(f"      🏦 {a.player_id} banked {a.value} (total {a.total})")
            elif isinstance(a, SendFrame):
                print(f"      ->  boost to {a.player_id}: {a.frame}")
            elif isinstance(a, GameOver):
                print(f"      🏆 GAME OVER — {a.winner} wins with {a.total}")

    cfg = ExtractionConfig(channel_s=45.0, win_target=100,
                           extract_removes_player=False, loot_per_kill=10)
    g = ExtractionGame(["red", "blue"], cfg)
    print("\n=== Extraction sim: red vs blue, channel 45s, first to 100 banked ===\n")

    print("t=0   red loots a crate (+60), blue loots (+30)")
    render(g.loot_pickup("red", 60)); render(g.loot_pickup("blue", 30))

    print("t=5   red reaches extraction point Alpha and summons it (LOUD)")
    render(g.enter_zone("red", "Alpha", now=5.0))

    print("t=25  blue hears the callout, hunts red down mid-channel")
    render(g.on_death("red", killer_id="blue", now=25.0))
    print(f"      (blue now carries {g.carried('blue')}: 30 looted + 10 kill; red's 60 drops as a token)")

    print("t=30  blue grabs red's dropped token and runs for extraction Bravo")
    # find the dropped token id
    drop_id = next(iter(g.dropped))
    render(g.pickup_dropped("blue", drop_id))
    print(f"      (blue carries {g.carried('blue')})")
    render(g.enter_zone("blue", "Bravo", now=30.0))

    print("t=40  red respawns (empty-handed)")
    render(g.respawn("red"))

    print("t=75  blue holds Bravo for the full 45s -> extracts")
    render(g.tick(now=75.0))

    print(f"\nFinal: red banked {g.banked('red')}, blue banked {g.banked('blue')}, "
          f"game over={g.over}\n")


async def _diag_game(address: str, extra_caps: list[str]) -> None:
    """Run the structured diagnostic game and print + save the scorecard."""
    import json
    from .diag import CATALOG, Capability
    from .diag.runner import run_game
    from .storage import BASE_DIR  # ~/.brx-mcp

    caps = {Capability.BLE, Capability.HUMAN}  # a person drives it by default
    if "2guns" in extra_caps:
        caps.add(Capability.TWO_GUNS)
    if "ir" in extra_caps:
        caps.add(Capability.IR)
    print(f"capabilities: {sorted(c.value for c in caps)}", file=sys.stderr)

    report = await run_game(address, CATALOG, caps)
    print(report.scorecard())
    try:
        d = BASE_DIR / "diag-reports"
        d.mkdir(parents=True, exist_ok=True)
        # no timestamp helper here (Date.now-free); name by target + seq count
        path = d / f"diag-{address.replace(':', '')}.json"
        path.write_text(json.dumps(report.to_dict(), indent=2))
        print(f"\nsaved: {path}", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        print(f"(report not saved: {e})", file=sys.stderr)


def _ir_capture(port: str | None, seconds: float) -> None:
    """Capture BRX IR frames from the ESP32 bridge and print + diff them."""
    from .irbridge import IRBridge, diff_bits
    br = IRBridge(port)
    print(f"# capturing on {br.port} for {seconds:.0f}s — fire a gun / grenade at the "
          f"receiver ...", file=sys.stderr)
    frames = br.capture(seconds)
    br.close()
    if not frames:
        print("no frames — check wiring (VS1838B OUT->GPIO4), aim, and that a gun fired.")
        return
    for f in frames:
        line = (f"frame {f.index}: {f.to_dict()['nbits']} bits  {f.bits}"
                f"{'  [OVERFLOW]' if f.overflow else ''}")
        s = f.shot()                      # field-decode (brx-ir-protocol.md)
        if s["complete"]:
            line += (f"  ->  player={s['player']} team={s['team']} dmg={s['damage']}"
                     f" bullet={s['bullet']} crit={s['crit']}"
                     f" parity={'ok' if s['parity_valid'] else 'BAD'}")
        print(line)
    # diff consecutive distinct bit strings — surfaces type/team/mode fields
    seen = [f.bits for f in frames if f.bits]
    uniq = sorted(set(seen))
    if len(uniq) > 1:
        print("\n# distinct words:")
        for b in uniq:
            print(f"  {b}")
        print(f"\n# diff {uniq[0]} vs {uniq[1]}:\n  {diff_bits(uniq[0], uniq[1])}")


def _usb_query(port: str | None) -> None:
    """Read a cabled tagger's device record over USB (B7) + save a local backup."""
    from .usbconsole import UsbConsole, save_backup, add_to_inventory
    con = UsbConsole(port)
    print(f"# QUERY on {con.port} ...", file=sys.stderr)
    rec = con.query()
    con.close()
    if not rec.get("raw"):
        print("no response — is it the tagger's Teensy CDC port? try another COM/tty.")
        return
    fields = {k: v for k, v in rec.items() if k not in ("raw",)}
    _print(fields)
    path = save_backup(rec)
    if path:
        print(f"\n# backup saved: {path}", file=sys.stderr)
    add_to_inventory(rec)          # accumulate into the armory inventory


def _armory() -> None:
    """Armory inventory sweep: QUERY the cabled tagger (if one is), then print the
    accumulated tagger↔headset identity table. Cable each tagger in turn + re-run."""
    from .usbconsole import find_tagger_port, UsbConsole, save_backup, add_to_inventory, load_inventory
    port = find_tagger_port()
    if port:
        try:
            con = UsbConsole(port)
            rec = con.query()
            con.close()
            if rec.get("raw"):
                save_backup(rec)
                add_to_inventory(rec)
                print(f"# added {rec.get('serial_head_pin')} (from {port})", file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            print(f"# QUERY on {port} failed: {type(e).__name__}: {e}", file=sys.stderr)
    else:
        print("# no tagger cabled (USB Teensy VID 16C0) — showing the inventory; "
              "scanning BLE to bind/reconfirm addresses.", file=sys.stderr)

    # BLE scan → correlate: bind ble_address + confirm names (also the post-rename
    # reconfirm step). Uniquely-named guns bind automatically.
    try:
        from .usbconsole import correlate
        from .ble import ConnectionManager
        scan = asyncio.run(ConnectionManager().scan(8))
        named = [d for d in scan if d.get("name")]
        bound = correlate([{"name": d["name"], "address": d["address"]} for d in named])
        print(f"# BLE correlate: {len(named)} named device(s) seen, {len(bound)} newly bound",
              file=sys.stderr)
        for serial, addr in bound:
            print(f"# confirmed {serial} <-> {addr}", file=sys.stderr)
    except Exception as e:  # noqa: BLE001 — no BLE here is fine; just skip correlation
        print(f"# (skipped BLE correlate: {type(e).__name__})", file=sys.stderr)

    inv = load_inventory()
    if not inv:
        print("armory inventory empty — cable a tagger and re-run `armory`.")
        return
    print(f"\n=== ARMORY INVENTORY ({len(inv)} tagger(s)) ===")
    hdr = (f"{'HEADSET PIN':12} {'GUN NAME':12} {'PID':>3} {'HEADSET':8} {'HEAD V':>6} "
           f"{'GUN V':>6} {'PCB':>3} {'LINK':4} {'BLE ADDRESS':18} {'MAP':4}")
    print(hdr); print("-" * len(hdr))
    for pin, r in sorted(inv.items()):
        # ASCII-only (Windows console is cp1252 — no unicode ticks)
        print(f"{pin:12} {str(r.get('gun_name') or '?'):12} {str(r.get('player_id')):>3} "
              f"{str(r.get('headset_version') or '?'):8} {str(r.get('head_volts') or '?'):>6} "
              f"{str(r.get('gun_volts') or '?'):>6} {str(r.get('pcb') or '?'):>3} "
              f"{'yes' if r.get('headset_linked') else 'no':4} "
              f"{str(r.get('ble_address') or '-'):18} "
              f"{'ok' if r.get('name_confirmed') else 'pend':4}")


def _ir_range(port: str | None, seconds: float, expected: int | None) -> None:
    """One walk-back station: capture a window, report the range reading. Stand at
    a tape distance, fire `expected` shots during the window, read the hit-rates."""
    from .irbridge import IRBridge, range_stats
    br = IRBridge(port)
    hint = f", fire ~{expected} shots" if expected else ""
    print(f"# range sample on {br.port} for {seconds:.0f}s{hint} at this distance ...",
          file=sys.stderr)
    frames = br.capture(seconds)
    br.close()
    s = range_stats(frames, expected)
    dr = f"{s['decode_rate']*100:.0f}%"
    line = (f"detected {s['detected']}  decoded {s['decoded']} ({dr} clean)  "
            f"overflow {s['overflow']}  patterns {s['unique_patterns']}")
    if expected:
        line += f"  |  {s['detected']}/{expected} shots reached ({s['detect_rate']*100:.0f}%)"
    print(line)
    if s["detected"] == 0:
        print("-> nothing received — past effective range, mis-aimed, or wiring/aim off.")
    elif s["decode_rate"] < 0.5:
        print("-> marginal: bursts arrive but rarely decode clean — near the edge of range.")


def _ir_emit(bits: str, port: str | None, repeat: int) -> None:
    from .irbridge import IRBridge
    br = IRBridge(port)
    print(f"# emitting {bits!r} ×{repeat} on {br.port}", file=sys.stderr)
    print(br.emit(bits, repeat))
    br.close()


def _build_config(mode: str, kvs: list[str]):
    """Build a GameConfig from `mode` + key=value overrides (volume=90 outdoor=1 hp=99
    primary=charge respawns=3 game_time_s=180 kid_mode=1 leds=0 ...)."""
    from .gameconfig import GameConfig
    import dataclasses
    cfg = GameConfig(mode=mode)
    fields = {f.name: f.type for f in dataclasses.fields(GameConfig)}
    for kv in kvs:
        if "=" not in kv:
            continue
        k, v = kv.split("=", 1)
        if k not in fields:
            print(f"(ignoring unknown setting {k!r})", file=sys.stderr)
            continue
        cur = getattr(cfg, k)
        if isinstance(cur, bool):
            val = v not in ("0", "false", "False", "no", "off")
        elif isinstance(cur, float):
            val = float(v)
        elif isinstance(cur, int) or (cur is None and k in ("respawns", "game_time_s")):
            val = int(v)
        else:
            val = v
        setattr(cfg, k, val)
    return cfg


# -- game-sim event factories (parsed-frame shapes the engines consume) ------ #
def _hir(team):
    return {"command": "HIR", "tokens": ["HIR", "0", "0", "0", str(team), "9", "0", "3"]}


def _death():
    return {"command": "HP", "tokens": ["HP", "0", "0", "0"]}


def _sim_plan(mode: str):
    """Return (players, config-overrides, steps) for a mode. A step is
    (pid_or_None, event_or_None, dt); pid=None → just advance the clock/tick."""
    def ev(cmd, *toks):
        return {"command": cmd, "tokens": [cmd, *[str(t) for t in toks]]}

    # dt = seconds to advance BEFORE this step's event+tick.
    if mode == "infection":
        return ({"h1": 1, "h2": 1, "z": 2}, ["respawn_s=5"],
                [("h1", _hir(2), 1), ("h1", _death(), 1),      # z infects h1
                 ("h2", _hir(2), 1), ("h2", _death(), 1)])     # z infects h2 → last human
    if mode in ("tdm", "ffa", "lms"):
        ov = ["respawn_s=5", "frag_limit=2"] if mode != "lms" else ["respawn_s=5", "respawns=1"]
        return ({"red": 1, "blue": 2}, ov,
                [("red", _hir(2), 1), ("red", _death(), 1),    # @1-2 blue tags red (down)
                 ("blue", _hir(1), 1), ("blue", _death(), 1),  # @3-4 red tags blue (down)
                 (None, None, 6),                              # @10 both respawn
                 ("red", _hir(2), 1), ("red", _death(), 1)])   # @11-12 blue tags red → limit
    if mode in ("cs", "bomb"):
        return ({"red": 1, "blue": 2}, ["detonation_s=8"],
                [("A", ev("PLANT", "A"), 1),                   # @1 attackers plant site A
                 (None, None, 5),                              # @6 countdown ticking…
                 (None, None, 5)])                             # @11 detonates → attackers win
    if mode in ("domination", "koth"):
        return ({"red": 1, "blue": 2}, ["control_points=2", "score_target=8", "game_time_s=0"],
                [("A", ev("CAPTURE", "A", 1), 1),              # @1 red takes A
                 ("B", ev("CAPTURE", "B", 1), 1),              # @2 red takes B → 2 pt/s
                 (None, None, 10)])                            # @12 holds both → hits target
    if mode == "ctf":
        return ({"red": 1, "blue": 2}, ["cap_target=2"],
                [("st", ev("GRAB", "flag2", 1), 1), ("st", ev("CAP", 1), 1),
                 ("st", ev("GRAB", "flag2", 1), 1), ("st", ev("CAP", 1), 1)])  # 2 caps → win
    if mode == "extraction":
        return ({"red": 1, "blue": 2}, ["channel_s=10", "win_target=15"],
                [("red", ev("LOOT", 15), 1),                   # @1 red grabs loot
                 ("red", ev("ZONE", "Alpha"), 1),              # @2 summons extraction (LOUD)
                 (None, None, 12)])                            # @14 holds 10s → extracts → win
    raise ValueError(f"unknown sim mode {mode!r}")


def _game_sim(mode: str) -> None:
    """Narrated M0 game against a fake sender + scripted events — no BLE.
    Covers every mode: tdm ffa infection lms cs domination koth ctf extraction."""
    import asyncio
    from .modes import GameDriver

    async def sender(pid, frame):
        pass

    players, overrides, steps = _sim_plan(mode)
    cfg = _build_config(mode, overrides)
    # engine-fed players only (station node ids like "A"/"st" aren't guns)
    drv = GameDriver(cfg, players, sender)

    async def run():
        print(f"\n=== game-sim: {mode} ===  players={players}  ({cfg.summary()})")
        await drv.setup()
        t = 0.0
        for pid, event, dt in steps:
            t += dt                                   # advance the clock, THEN act+tick
            if event is not None:
                await drv.execute(drv.feed(pid, event, now=t))
            await drv.execute(drv.tick(now=t))
            if drv.over:
                break
        snap = drv.snapshot()
        print(f"\nsnapshot: {snap}")
        return snap

    return asyncio.run(run())


async def _enroll(name: str | None) -> None:
    """Isolation enroll (for identical guns): power ON only the gun being enrolled,
    cable it. Reads its serial over USB, scans BLE — the single tagger visible IS this
    gun — binds serial↔address with certainty, and (optionally) renames it. No
    name-matching needed, so it works even for indistinguishable stock guns."""
    from .usbconsole import UsbConsole, save_backup, add_to_inventory, bind_address
    from .ble import ConnectionManager
    from .modes.driver import clean_callsign
    nm = clean_callsign(name) if name else None
    # 1. USB identity
    try:
        con = UsbConsole()
    except Exception as e:  # noqa: BLE001
        print(f"# no cabled tagger (Teensy VID 16C0): {e}", file=sys.stderr); return
    rec = con.query(); con.close()
    serial = rec.get("serial_head_pin")
    if not serial:
        print("# no serial over USB — recable and retry", file=sys.stderr); return
    save_backup(rec); add_to_inventory(rec)
    print(f"# USB identity: {serial}  (headset sticker should read {serial})", file=sys.stderr)
    # 2. isolate on BLE — exactly one tagger must be powered
    scan = await ConnectionManager().scan(8)
    brx = [d for d in scan if d.get("has_uart_service")]
    if len(brx) != 1:
        names = ", ".join(f"{d['name'] or '?'}" for d in brx)
        print(f"# found {len(brx)} tagger(s) on BLE [{names}] — power ON ONLY the gun you're "
              f"enrolling (all others OFF), then re-run. {serial}'s USB identity is saved.",
              file=sys.stderr)
        return
    address = brx[0]["address"]
    print(f"# BLE isolated: {serial} <-> {address} (advert {brx[0]['name']!r})", file=sys.stderr)
    # 3. rename over BLE (optional) — mark pending; the bind below confirms it
    if nm:
        await _rename(address, nm)
    # 4. bind with certainty (isolation)
    bind_address(serial, address, name=nm)
    final = nm or rec.get("gun_name")
    print(f"\n# ENROLLED {serial} as '{final}' @ {address}."
          + ("  Power-cycle to refresh its BLE advert." if nm else ""), file=sys.stderr)


async def _reset(address: str) -> None:
    """Reset a tagger to a clean idle state — including reviving a gun left DEAD at
    game end (the death glow that END_SEQUENCE doesn't clear). Finds the sequence
    that clears it; the winner becomes the teardown fix."""
    from .ble import ConnectionManager
    mgr = ConnectionManager()
    # revive (SPAWN clears the dead HP state), immediately silence the spawn voice
    # ($PLAYX,0), then STOP+CLEAR to settle to idle, and blank the headset LED.
    from .gameconfig import END_SEQUENCE
    seq = list(END_SEQUENCE)
    try:
        await mgr.connect(address, "rst")
        try:
            for cmd in seq:
                r = await mgr.send("rst", cmd, reply_window_ms=200)
                print(">> " + cmd
                      + "".join(f"\n   << {x['raw']}" for x in r.get('replies_within_window', [])))
            await asyncio.sleep(0.4)
        finally:
            await mgr.disconnect("rst")
    except Exception as e:  # noqa: BLE001
        print(f"# reset FAILED to reach {address}: {type(e).__name__}: {e}", file=sys.stderr)
        return
    print(f"\n# reset {address} to clean idle (revived, quiet, headset dark; pulses its "
          f"team colour). Same sequence the game teardown uses.", file=sys.stderr)


async def _rename(address: str, name: str) -> None:
    """Set a tagger's persistent name over BLE via `$NAME` (the app's rename path).
    Mirrors the app ritual ($STOP → $PLAYX,0 → $NAME) — no $PHONE, so the on-gun
    menu isn't locked. Verify with a re-scan / USB QUERY afterwards."""
    from .ble import ConnectionManager
    from .modes.driver import clean_callsign
    from .usbconsole import mark_rename, load_inventory
    nm = clean_callsign(name)
    if not nm:
        print("empty/invalid name after sanitize", file=sys.stderr); return
    # a duplicate name can't be mapped — correlate refuses to bind two guns that
    # share a name. Warn before renaming into a collision.
    dupes = [s for s, r in load_inventory().items()
             if (r.get("gun_name") or "").strip().lower() == nm.lower()
             and r.get("ble_address") != address]
    if dupes:
        print(f"# WARNING: '{nm}' already names armory record(s) {dupes} — duplicate names "
              f"can't be auto-mapped. Pick a unique name.", file=sys.stderr)
    mgr = ConnectionManager()
    try:
        await mgr.connect(address, "rn")
        try:
            for cmd in ("$STOP,*", "$PLAYX,0,*", f"$NAME,{nm},*"):
                r = await mgr.send("rn", cmd, reply_window_ms=200)
                print(">> " + cmd
                      + "".join(f"\n   << {x['raw']}" for x in r.get('replies_within_window', [])))
            await asyncio.sleep(0.4)
        finally:
            await mgr.disconnect("rn")
    except Exception as e:  # noqa: BLE001 — a raw traceback here is useless to the operator
        print(f"# rename FAILED to reach {address}: {type(e).__name__}: {e}", file=sys.stderr)
        return
    # update the armory map (only if this address is already bound to a record) and
    # mark it unconfirmed — the advert won't match until the gun reboots.
    updated = mark_rename(nm, address=address)
    if updated:
        print(f"\n# RENAMED {address} -> '{nm}'  (armory record {updated}: name pending).",
              file=sys.stderr)
    else:
        print(f"\n# RENAMED {address} -> '{nm}'.  NOTE: no armory record is bound to this "
              f"address yet, so this rename does NOT update the map. USB-QUERY this gun "
              f"(`armory`) after it reboots to enroll it under the new name.", file=sys.stderr)
    print("# NEXT: 1) power-cycle that gun.  2) run `armory` to RECONFIRM -- the advert\n"
          f"#       should come back '{nm}-<MACtail>' and the map is then confirmed.",
          file=sys.stderr)


async def _play(mode: str, addresses: list[str], kvs: list[str]) -> None:
    from .modes import run_live
    # a gun token may carry a gamertag as ADDR@Gamertag → push it via $NAME
    addrs: list[str] = []
    callsigns: dict[str, str] = {}
    for tok in addresses:
        addr, sep, tag = tok.rpartition("@")
        if sep and addr:
            addrs.append(addr)
            callsigns[addr] = tag
        else:
            addrs.append(tok)
    cfg = _build_config(mode, kvs)
    print(f"config: {cfg.summary()}", file=sys.stderr)
    if callsigns:
        print(f"callsigns: {callsigns}", file=sys.stderr)
    snap = await run_live(cfg, addrs, callsigns or None)
    _print(snap)


def _dispatch(cmd: str, args: list[str]) -> None:
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
        addrs, rest = _split_addrs(args[1:])
        asyncio.run(_arena(addrs,
                           int(rest[0]) if len(rest) > 0 else 3,
                           int(rest[1]) if len(rest) > 1 else 15,
                           int(rest[2]) if len(rest) > 2 else 69,
                           rest[3] if len(rest) > 3 else "primary"))
    elif cmd in ("fieldstart", "fieldresults") and len(args) > 1:
        addrs, rest = _split_addrs(args[1:])
        if cmd == "fieldstart":
            asyncio.run(_fieldstart(addrs,
                                    int(rest[0]) if rest else 69,
                                    rest[1] if len(rest) > 1 else "primary"))
        else:
            asyncio.run(_fieldresults(addrs,
                                      int(rest[0]) if rest else 12))
    elif cmd == "diag" and len(args) > 1:
        asyncio.run(_diag(args[1]))
    elif cmd == "diagnose" and len(args) > 1:
        wait = int(args[2]) if len(args) > 2 and args[2].isdigit() else 10
        asyncio.run(_diagnose(args[1], wait))
    elif cmd == "fleet":
        asyncio.run(_fleet(_split_addrs(args[1:])[0]))
    elif cmd == "extraction-sim":
        _extraction_sim()
    elif cmd == "game-sim":
        _game_sim(args[1] if len(args) > 1 else "tdm")
    elif cmd == "play" and len(args) > 2:
        mode = args[1]
        addrs = [a for a in args[2:] if "=" not in a]   # guns (optionally ADDR@Gamertag)
        kvs = [a for a in args[2:] if "=" in a]
        asyncio.run(_play(mode, addrs, kvs))
    elif cmd == "diag-game" and len(args) > 1:
        asyncio.run(_diag_game(args[1], args[2:]))
    elif cmd == "ir-capture":
        port = args[1] if len(args) > 1 and not args[1].isdigit() else None
        secs = next((float(a) for a in args[1:] if a.replace(".", "").isdigit()), 15.0)
        _ir_capture(port, secs)
    elif cmd == "ir-emit" and len(args) > 1:
        bits = args[1]
        port = args[2] if len(args) > 2 and not args[2].isdigit() else None
        repeat = next((int(a) for a in args[2:] if a.isdigit()), 1)
        _ir_emit(bits, port, repeat)
    elif cmd == "reset" and len(args) > 1:
        asyncio.run(_reset(args[1]))
    elif cmd == "rename" and len(args) > 2:
        asyncio.run(_rename(args[1], " ".join(args[2:])))   # keep multi-word names
    elif cmd == "enroll":
        asyncio.run(_enroll(" ".join(args[1:]) if len(args) > 1 else None))
    elif cmd == "usb-query":
        _usb_query(args[1] if len(args) > 1 else None)
    elif cmd == "armory":
        _armory()
    elif cmd == "ir-range":
        port = args[1] if len(args) > 1 and not args[1].isdigit() else None
        nums = [float(a) for a in args[1:] if a.replace(".", "").isdigit()]
        secs = nums[0] if nums else 8.0
        expected = int(nums[1]) if len(nums) > 1 else None
        _ir_range(port, secs, expected)
    else:
        print(__doc__, file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
