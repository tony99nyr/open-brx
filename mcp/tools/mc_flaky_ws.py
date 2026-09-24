"""A fake, broken Mission Control: a WebSocket server that never lets the phone bind.

Why it exists: on 2026-09-24 a Pixel 5 on a debug build crashed (FATAL EXCEPTION on the "OkHttp Dispatcher"
thread, a NullPointerException on PluginCall.resolve inside Capacitor's notifyListeners, called from
BrxNetPlugin.emit in onFailure). The app was looping on an MC that it could not bind to. OkHttp called back on
its own thread while the JS side added and removed its listeners on the plugin thread, and Capacitor's
listener list is not thread-safe. The fix (commit c63876ac) posts every brx-net event through
getBridge().execute(). This server gives that loop on demand, so a build can be checked on a spare phone.

Modes (argv[2]):
  silent   accept the WebSocket upgrade, read and drop frames, never send `welcome` (the transport times out)
  close    accept the upgrade, then send a close frame and drop the connection
  reset    reset the TCP connection (RST) as soon as it is accepted, before any handshake
  cycle    rotate through close, reset and a 1 s silent hold, one mode per connection

Usage (Windows venv, so the phone reaches it on the laptop's LAN address):
  $PY mcp/tools/mc_flaky_ws.py [port=8799] [mode=close]
  then on the phone: window.brx.connectMc('ws://<laptop LAN IPv4>:8799/flaky', false)
  $PY mcp/tools/mc_flaky_ws.py churn [secs=180] [loops=8] [url]   (prints the churn JS, see below)

Use a path other than /ws (here /flaky). The app's LAN sweep reuses the path of the dialled URL on MC's port
8766, so a /ws URL would let the phone find and join a real MC on the same subnet. Do not use 8765 or 8766
as this server's port: those are MC's own ports, and a bench phone sweeps :8766.

What reproduced it (2026-09-24, Pixel 5, build 0.4.7 without the fix): the app's own loop against this
server did NOT crash in 13 min (close 4 min, reset 4 min, silent 5 min, with the app's LAN sweeps). The race
needs more listener churn than one Transport makes. The `churn` subcommand prints a JS snippet that runs 8
parallel loops of addListener x4, open, wait for close, remove x4 on the BrxNet plugin. Its target
(ws://127.0.0.1:1/, a refused port on the phone itself) fails at once, so onFailure fires on OkHttp threads
while the other loops add and remove listeners. The unfixed build crashed in about 11 s with the field stack
trace (Plugin.notifyListeners:681 <- BrxNetPlugin.emit <- onFailure). The fixed build (c63876ac) ran it
for 10 min, with the app sent to the background and back four times, and did not crash.

  $PY mcp/tools/webview_eval.py "$($PY mcp/tools/mc_flaky_ws.py churn 180)" --serial <phone> --port 9233
  then poll `adb -s <phone> logcat -d -b crash` for "FATAL EXCEPTION"; `window.__stress` holds the counts.

Standard library only. Each connection is logged with its peer, its number and what the server did.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import itertools
import socket
import struct
import sys
import time

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC11B7D"
MODES = ("silent", "close", "reset", "cycle")
_counter = itertools.count(1)
_cycle = itertools.cycle(("close", "reset", "silent-1s"))
_start = time.monotonic()


def log(message: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} +{time.monotonic() - _start:7.1f}s {message}", flush=True)


def rst(writer: asyncio.StreamWriter) -> None:
    """Close with SO_LINGER 0, so the kernel sends RST instead of FIN."""
    sock = writer.get_extra_info("socket")
    if sock is not None:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
    writer.transport.abort()


async def upgrade(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> bool:
    """Answer the HTTP upgrade. Returns False when the request is not a WebSocket handshake."""
    head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=10)
    key = ""
    for line in head.decode("latin-1").split("\r\n"):
        name, _, value = line.partition(":")
        if name.strip().lower() == "sec-websocket-key":
            key = value.strip()
    if not key:
        writer.write(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n")
        await writer.drain()
        return False
    accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
    writer.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                  f"Sec-WebSocket-Accept: {accept}\r\n\r\n").encode())
    await writer.drain()
    return True


async def drain_frames(reader: asyncio.StreamReader, hold: float | None) -> int:
    """Read and drop client bytes until EOF, or until `hold` seconds pass. Returns the byte count."""
    total = 0
    deadline = None if hold is None else time.monotonic() + hold
    while True:
        timeout = None if deadline is None else max(0.0, deadline - time.monotonic())
        try:
            chunk = await asyncio.wait_for(reader.read(4096), timeout=timeout)
        except asyncio.TimeoutError:
            return total
        if not chunk:
            return total
        total += len(chunk)


async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter, mode: str) -> None:
    n = next(_counter)
    peer = writer.get_extra_info("peername")
    action = next(_cycle) if mode == "cycle" else mode
    try:
        if action == "reset":
            rst(writer)
            log(f"#{n} {peer} reset (RST before the handshake)")
            return
        if not await upgrade(reader, writer):
            log(f"#{n} {peer} not a WebSocket upgrade, answered 400")
            writer.close()
            return
        if action == "close":
            writer.write(b"\x88\x02" + struct.pack("!H", 1011))   # close frame, 1011, unmasked (server side)
            await writer.drain()
            writer.close()
            log(f"#{n} {peer} upgraded, then closed (1011)")
            return
        hold = 1.0 if action == "silent-1s" else None
        log(f"#{n} {peer} upgraded, silent ({'1 s hold' if hold else 'until the client leaves'})")
        got = await drain_frames(reader, hold)
        if hold:
            rst(writer)
        else:
            writer.close()
        log(f"#{n} {peer} gone after {got} bytes from the client")
    except (asyncio.TimeoutError, asyncio.IncompleteReadError, ConnectionError, OSError) as error:
        log(f"#{n} {peer} {action}: {type(error).__name__}")
        writer.transport.abort()


async def main(port: int, mode: str) -> None:
    server = await asyncio.start_server(lambda r, w: handle(r, w, mode), host="0.0.0.0", port=port)
    log(f"mc_flaky_ws listening on 0.0.0.0:{port}, mode {mode}")
    async with server:
        await server.serve_forever()


CHURN_JS = """(() => {
  const P = window.Capacitor.Plugins.BrxNet;
  const url = %(url)s, until = Date.now() + %(secs)d * 1000;
  const st = window.__stress = { opened: 0, closed: 0, errs: 0, done: false };
  async function loop() {
    while (Date.now() < until) {
      const hs = []; let id = null, fin; const closed = new Promise(r => { fin = r; });
      for (const n of ['open', 'message', 'close', 'error'])
        hs.push(await P.addListener(n, e => { if (n === 'close' && (id === null || e.id === id)) fin(); }));
      try { id = (await P.open({ url })).id; st.opened++; } catch (_) { st.errs++; fin(); }
      await Promise.race([closed, new Promise(r => setTimeout(r, 3000))]);
      st.closed++;
      for (const h of hs) await h.remove();
    }
  }
  Promise.all(Array.from({ length: %(workers)d }, loop)).then(() => { st.done = true; });
  return 'churn started';
})()"""


def churn_js(secs: int = 180, workers: int = 8, url: str = "ws://127.0.0.1:1/") -> str:
    """The in-app BrxNet listener-churn snippet, for webview_eval.py."""
    return CHURN_JS % {"url": repr(url), "secs": secs, "workers": workers}


def cli(argv: list[str]) -> None:
    if argv and argv[0] == "churn":
        rest = argv[1:]
        print(churn_js(int(rest[0]) if rest else 180,
                       int(rest[1]) if len(rest) > 1 else 8,
                       rest[2] if len(rest) > 2 else "ws://127.0.0.1:1/"))
        return
    port = int(argv[0]) if argv else 8799
    mode = argv[1] if len(argv) > 1 else "close"
    if mode not in MODES:
        raise SystemExit(f"mode must be one of {', '.join(MODES)}")
    try:
        asyncio.run(main(port, mode))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    cli(sys.argv[1:])
