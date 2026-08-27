# Transport, framing & safety
_How you reach the gun, what a frame looks like, and why nothing here can brick one_
Last verified: 2026-08-27

Headline: "One text protocol, three ways in." Sub: The BRX speaks a plain ASCII, comma-delimited command language on a hardware UART. Gen1 exposes it over Bluetooth Classic, Gen2/3 over BLE, and the community drives it from a wire — the frames are identical on all three. Background: DEV-01.
Source: protocol/brx-protocol.md §1, §7c

## Who found this.
Protocol discovery for the BRX platform is the work of **LaserTagMods** (JEDGE / JBOX). This page restates their findings independently, with our own bench verification noted per row.
Source: protocol/brx-protocol.md (header, §7d), README.md

## Transport by generation
| Generation | Link | Speed | How you connect | Confidence |
|---|---|---|---|---|
| Gen1 | Bluetooth Classic (SPP) | 57600 baud | Pair an HC-05 module (PIN `0001`, master role). The headset must be connected for Bluetooth to function. | 👥 |
| Gen2/3 | BLE — Nordic UART Service (NUS) | UART bridge at 115200 behind the radio | Connect from any BLE central: laptop (bleak), ESP32, phone. No pairing/PIN. | ✅ |
| Any | Hardware UART inside the gun | 115200 | What JEDGE drives directly (`Serial1`). No external accessory port exists on the BRX — a wired tap means opening the gun. Untested by us. | 👥 |
| Any | Micro-USB "Programing Port" | USB CDC (baud ignored) | **Not** the `$` protocol — a separate `QUERY`/`SETUP` console. See the Serial console page. | ✅ |
✅/
Source: protocol/brx-protocol.md §1, §7c

## BLE — Nordic UART Service UUIDs
- Service: `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
- RX characteristic (**write** to tagger): `6E400002-B5A3-F393-E0A9-E50E24DCCA9E`
- TX characteristic (**notify** from tagger): `6E400003-B5A3-F393-E0A9-E50E24DCCA9E`
- Advertised name: `Tactix-XXXX` (the last two bytes of the BLE MAC). The NUS service UUID **is** present in the advertisement, so scan-time generation detection works.
- ATT MTU negotiates to **23 bytes** — chunk writes to ~20-byte payloads; this is required, not defensive.
- `$PING,*` → `$PONG,*` round trip ≈ 59 ms over BLE.
Source: protocol/brx-protocol.md §1, §7a, §7b; mcp/brx_mcp/protocol.py

## Generation detection heuristic.
Power on the tagger and run a BLE scan. If it advertises the UART service → Gen2/3. If nothing appears on BLE but the device pairs over Bluetooth Classic → Gen1.
Source: protocol/brx-protocol.md §1

_[diagram DEV-02: Link topology: host ↔ BLE NUS ↔ tagger ↔ (proprietary link) headset; tagger → IR → other tagger; USB console on the side.]_

## Frame anatomy
(render as an annotated string, not bits)
`$` + `COMMAND` + (`,` + token)* + `,*`
- ASCII, comma-delimited tokens. Starts with `$COMMAND`, ends with `,*`.
- **Empty tokens are legal and meaningful** — consecutive commas mean "leave unchanged / not applicable". `$SPAWN,,*` (one empty token) is a different command from `$SPAWN,*`.
- Example: `$PING,*` → reply `$PONG,*`.
- Tokens may not contain a comma, `*` or a line break (that is the validator in `protocol.py`: `^\$[A-Z0-9!]+(,[^,*\r\n]*)*,\*$`).
- Notifications can arrive merged (`$ALCD,…$BUT,0,1,*`); split on the next `$` as well as on `*`.
Source: protocol/brx-protocol.md §2, §7e; mcp/brx_mcp/protocol.py

_[diagram DEV-03: Annotated frame anatomy.]_

## Waking a gun and holding the link
1. Connect and subscribe to the TX notify characteristic. Establishing a link succeeds roughly **1 attempt in 3** (the official app behaves the same); retry — that *is* the fix.
2. On a **fresh power-up**, send `$STOP,*` then `$PHONE,*` (after a power-cycle `$PHONE,*` alone wakes it). A just-booted gun ignores a bare `$VERSION,*` until then.
3. `$PHONE,*` opens the **event tap**: the gun says "phone connected", answers `$BUT,3,0,*`, streams button events and `$VOLTS` telemetry, and locks its on-gun menu until a game is configured or it is power-cycled.
4. Idle taggers are **silent**: outside app mode no unsolicited messages are sent — no button, trigger or hit traffic.
5. The official app's connect ritual (captured, fw v4.32) is `$STOP,*` → `$PLAYX,0,*` → `$VOL,69,0,*` → `$PLAY,VA20,3,6,,,,,*` ("connection established"), then once per session `$NAME,<name>,*` + `$VERSION,*`. It never sends `$PHONE,*`.
6. **The headset must be linked** or the gun will connect, answer a quick `$PING`, then drop within seconds and echo nothing to config. After a gun-initiated `$DISCONNECT,*`, back off ≥ 5 s before reconnecting.
Source: protocol/brx-protocol.md §7a, §7b, §7m, §7r; docs/gotchas.md

## The safety model.
Three layers, in order of what they protect: (1) firmware is never written, so **a power-cycle always restores a tagger**; (2) a host should refuse malformed frames and require an explicit confirm for any command outside the **known-safe list** (below); (3) the **panic sequence** `$CLEAR,*` then `$SP,99,*` returns a gun to a sane state. Battle Company's official USB updater is the factory-restore path.
Source: README.md "Safety", protocol/brx-protocol.md §8, mcp/brx_mcp/protocol.py

```python
# The known-safe list enforced by brx-mcp (mcp/brx_mcp/protocol.py).
# Everything else needs confirm=True — that is the host's safety rail, not a tagger limit.
KNOWN_SAFE_COMMANDS = {
    "PING", "CLEAR", "START", "SPAWN", "CONNECT", "INIT", "PHONE",
    "GSET", "PSET", "WEAP", "SIR", "BMAP", "GLED", "PLAY", "AS", "SP",
    "PBWEAP", "PBTEAM", "PBPERK", "TID",
    # sent by the official iOS app during a normal captured game:
    "AMMO", "STOP", "PLAYX", "VOL", "HLED", "NAME", "VERSION", "HLOOP",
    "SFLASH",
}
PANIC_SEQUENCE = ["$CLEAR,*", "$SP,99,*"]
```
Source: mcp/brx_mcp/protocol.py

## Volume.
`$VOL,30` is kind to ears on a bench but **measurably inaudible for weapon and game audio**; `$VOL,45` is barely audible. Use **69** (the iOS app's value) for real play.
Source: CLAUDE.md hard rules; protocol/brx-protocol.md §3 ($VOL)

- **Is the baud rate real over BLE?** No — BLE has no baud. 115200 is the UART behind the radio bridge, which is why BLE and a wire speak identical frames.
- **Why does my client drop at ~6.6 s?** The link *holds* fine once up (80 s+ sessions with the official app, multi-minute sessions with ours). Establishment is intermittent; retry in a loop. If it dies within seconds *and echoes nothing to config*, the headset is not linked.
- **Can a command brick the gun?** Nothing in the protocol writes firmware. Every state written over BLE is wiped by a power-cycle (except `$NAME`, which persists).
Source: protocol/brx-protocol.md §7c · protocol/brx-protocol.md §7b, §7e, §7r · protocol/brx-protocol.md §7r, docs/experiment-log.md (2026-08-24 $NAME)
