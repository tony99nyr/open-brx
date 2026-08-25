"""PASSIVE tap: connect to one gun and log every RX frame with HOST-side arrival
time (guns each use their own boot-local clock, so we stamp on receipt). Sends
NOTHING that alters game state — for watching a NATIVE offline game from the
shooter's gun to catch the kill-confirm / green-sight frame. Auto-reconnects
through the ~6.6 s client drop.

Usage:  python passive_listen.py <address> [seconds]
"""
import asyncio
import sys
import time

from brx_mcp.ble import ConnectionManager

try:  # Windows cp1252 consoles crash on a stray non-ASCII byte in an RX frame
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
except Exception:
    pass


def _t(a):
    return a.replace(":", "")[-4:]


async def main():
    args = sys.argv[1:]
    secs = 180
    if args and args[-1].isdigit():
        secs = int(args[-1]); args = args[:-1]
    if not args:
        print("usage: python passive_listen.py <address> [seconds]", file=sys.stderr)
        return
    addr = args[0]
    mgr = ConnectionManager()
    tag = _t(addr)
    t0 = time.monotonic()
    last_seq = 0

    async def ensure():
        if mgr.is_connected(addr):
            return True
        try:
            await mgr.disconnect(addr)
        except Exception:
            pass
        try:
            await mgr.connect(addr, addr, attempts=3)
            print(f"# tapped {tag} (passive — no game-altering sends)", flush=True)
            return True
        except Exception as e:
            print(f"# connect {tag} failed: {type(e).__name__}", flush=True)
            return False

    await ensure()
    print(f"# listening {secs}s. Set up + play your NATIVE offline FFA now.", flush=True)
    while time.monotonic() - t0 < secs:
        await asyncio.sleep(0.15)
        if not mgr.is_connected(addr):
            await ensure()
            last_seq = 0
            continue
        try:
            evs = mgr.get_events(addr, since_seq=last_seq)["events"]
        except Exception:
            continue
        for ev in evs:
            last_seq = ev["seq"]
            if ev["direction"] == "rx":
                host_ms = int((time.monotonic() - t0) * 1000)
                print(f"[{host_ms:>7}ms] {tag} >> {ev['raw']}", flush=True)
    try:
        await mgr.disconnect(addr)
    except Exception:
        pass
    print("# done", flush=True)


asyncio.run(main())
