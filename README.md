# BRX Open Battle System

An open-source (MIT) platform that turns **Battle Company BRX** laser taggers into a fully
orchestrated laser tag system: forced game modes, live scoring, objectives, items/power-ups,
effects, and a mission-control home base — scaling from 4 taggers to 20+.

> **Credit:** Protocol discovery and the tagger-rider ESP32 concept originate with
> **[LaserTagMods](https://github.com/LaserTagMods)** (JEDGE / JBOX projects). This project is
> a fresh, independent implementation — no code copied — but it stands on that discovery work.

**Prime directives**

1. Stock BRX firmware is **never modified**. All control is via the documented Bluetooth serial
   protocol. Power-cycling always restores a tagger; Battle Company's USB updater is the
   factory-restore path.
2. Store-and-forward everywhere: every node buffers timestamped events locally and syncs when
   in coverage. Live feed is best-effort; final results are always complete.
3. The server is the single source of truth for rules; nodes stay dumb.
4. Everything is a subscriber: scoreboard, lights, smoke, announcer are peers on the event bus.

## Repo layout

| Path | What |
|---|---|
| `protocol/` | BRX serial command reference (`brx-protocol.md`), sound-bank + `$WEAP` maps (todo) |
| `mcp/` | **brx-mcp** — MCP server giving Claude Code direct BLE control of taggers |
| `firmware/` | PlatformIO monorepo: bridge, item-pack, objective-station, effect-node (todo) |
| `server/` | Game engine: MQTT, rules/modes, scoring, announcer, event log (todo) |
| `webapp/` | Web Bluetooth scanner/config, ESP Web Tools flasher, scoreboard, replay (todo) |
| `hardware/` | STLs, wiring diagrams, BOM (todo) |
| `docs/` | Architecture spec, MCP spec, generation ID guide, findings |

## brx-mcp quickstart

The MCP server runs on **whichever machine owns the Bluetooth radio** — it is pure Python
(`bleak` + `mcp`) and works identically on **Windows, macOS, and Linux**.

```bash
# on the machine with the BLE radio (Windows PowerShell, macOS terminal, or Linux):
python -m venv .venv && . .venv/bin/activate   # (Windows: .venv\Scripts\activate)
pip install -e ./mcp

# first contact — no MCP client needed:
python -m brx_mcp scan            # find the tagger (Gen2/3 advertise Nordic UART)
python -m brx_mcp identify <addr> # $PING → generation check
python -m brx_mcp listen <addr>   # read-only live console: pull trigger, watch $BUT/$HIR/$HP

# register with Claude Code:
claude mcp add brx -- python -m brx_mcp
```

### Platform notes

- **WSL2 has no Bluetooth.** Develop in WSL, but run the server with **Windows Python**
  (`python.exe`) — Claude Code in WSL can register it directly:
  `claude mcp add brx -- python.exe -m brx_mcp` (with the package installed into Windows Python).
- **macOS:** grant your terminal Bluetooth permission (System Settings → Privacy & Security →
  Bluetooth). CoreBluetooth reports per-machine UUIDs instead of MAC addresses, so the
  `~/.brx-mcp/known-devices.json` registry is per-machine — re-scan on the MacBook.
- **Gen1 taggers** use Bluetooth Classic (SPP, 57600 baud; headset must be connected). `bleak`
  is BLE-only — pair the tagger in the OS and use the serial port path instead (guide todo).

## Safety

- Nothing here can brick a tagger — stock firmware is untouched; power-cycle restores.
- The MCP refuses malformed frames and requires `confirm=true` for commands outside the
  known-safe list in `protocol/brx-protocol.md` §3.
- A `panic` tool (`$CLEAR,*` + `$SP,99,*`) returns any tagger to a sane state.

## Roadmap

M1 Identify → M2 Control (4 sessions) → M3 Protocol depth (`$WEAP` map, sound bank) →
M4 Pilot game (bridges + engine + scoreboard) → M5 Arena (objectives, items, effects) →
M6 Scale + community. Full detail: `docs/brx-architecture-v0.2.md`.

## License

MIT — see `LICENSE`.
