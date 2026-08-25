"""Prove Mission Control can drive gun AUDIO (and try the sight) over pure BLE —
the 'reconstruct native feel as scorekeeper' test. Connects to one gun and:
  1. $PLAY,VA20  ("connection established" — known-good proof of life)
  2. $PLAY,VAA   (a 'kill' voice line)
  3. a few $GLED effect variants (does the sight flash green? §7i says maybe not)
Logs any RX. Watch/listen to the gun and report what it did.

Usage:  python play_probe.py <address>
"""
import asyncio
import sys

from brx_mcp.ble import ConnectionManager


def _t(a):
    return a.replace(":", "")[-4:]


async def say(mgr, a, frame, note):
    print(f"# -> {frame}   ({note})", flush=True)
    try:
        await mgr.send(a, frame, reply_window_ms=60)
    except Exception as e:
        print(f"#    send failed: {type(e).__name__}", flush=True)


async def main():
    addr = sys.argv[1]
    mgr = ConnectionManager()
    await mgr.connect(addr, addr, attempts=3)
    print(f"# connected {_t(addr)} — driving audio/LED over BLE", flush=True)
    await asyncio.sleep(0.5)

    await say(mgr, addr, "$VOL,69,0,*", "set volume audible")
    await asyncio.sleep(0.3)
    await say(mgr, addr, "$PLAY,VA20,4,6,,,,,*", "VA20 = 'connection established'")
    await asyncio.sleep(2.5)
    await say(mgr, addr, "$PLAY,VAA,4,6,,,,,*", "VAA = a 'kill' voice line")
    await asyncio.sleep(2.5)

    # sight-green attempts (effect enum: Solid/Glow/ChaseBack/ChaseForward/StopIR)
    for f in ("$GLED,1,1,1,0,10,,*", "$GLED,2,1,0,0,10,,*", "$GLED,1,2,0,0,10,,*"):
        await say(mgr, addr, f, "GLED effect variant — watch the sight")
        await asyncio.sleep(1.5)

    # drain any rx
    try:
        evs = mgr.get_events(addr, since_seq=0)["events"]
        for ev in evs:
            if ev["direction"] == "rx":
                print(f"   rx: {ev['raw']}", flush=True)
    except Exception:
        pass
    await asyncio.sleep(0.3)
    try:
        await mgr.disconnect(addr)
    except Exception:
        pass
    print("# done", flush=True)


asyncio.run(main())
