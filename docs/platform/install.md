# Install
Last verified: 2026-09-11

## What you need

- A laptop with a Bluetooth radio (Windows, macOS or Linux), for `brx-mcp` and for arming taggers at the bench.
- Any laptop on the same LAN, for Mission Control. It does not need Bluetooth: it talks to phones over Wi-Fi.
- One Android phone per player, for the Companion app. iOS builds from source.

## The Android app

Download the current build from [`/download/`](/download/), which also covers iOS.

## Installing the Python package

From a clone of the repository:

```
pip install -e ./mcp
```

Requires Python 3.11 or later.

## Running Mission Control

```
python -m brx_mcp.mc
```

The server prints its URL and an operator token on launch; open the link it prints, including the `#tok=` part. A restart mints a new token.

For a no-hardware demo:

```
python -m brx_mcp.mc --demo --fake-net
```

`--demo` seeds a roster of players and taggers; `--fake-net` simulates the phone nodes in memory, so the demo needs no phones and no taggers.

## First contact with a tagger

```
python -m brx_mcp scan
python -m brx_mcp identify <address>
python -m brx_mcp listen <address> [seconds]
```

`scan` finds every tagger in Bluetooth range. `diagnose` reads one tagger's firmware, ping latency and battery; `identify` only confirms it answers and which generation it is. `listen` opens a read-only console on a tagger's live traffic.

## The MCP server, for agents

```
python -m brx_mcp
```

With no subcommand, `brx-mcp` runs as an MCP server over stdio, so an agent can drive the bench directly: scan, connect, send, wait for events, read diagnostics, and panic.
