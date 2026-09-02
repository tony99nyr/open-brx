"""Do our LED writes actually SURVIVE in a live game? The question that decides what we can ship.

Everything else we know about $GLED was measured on a gun that is ARMED BUT NOT SPAWNED, because a
spawned gun runs its own animation on the same three LEDs and composites over ours. That is fine for
decoding the command and useless for deciding whether a feature is possible: a mode that wants to
show pool state, team colour or a hit flash has to do it on a SPAWNED gun, mid-match.

Samples the LEDs repeatedly after each step instead of once, because the failure mode here is not
"does nothing" but "works for a moment and is then repainted" -- a single reading cannot tell those
apart, and a feature that survives 300 ms is not a feature.

Usage: python led_ingame.py <gun_addr> <rois.json> [samples=8]
"""
import asyncio
import json
import subprocess
import sys
import time

import numpy as np
from PIL import Image

import bench_common as B

W = "/home/tony/Android/Sdk/platform-tools/adb"
S = r"C:\Users\Tony\.brx-mcp\_shot.png"
KEYS = ["LED1", "LED3"]          # the two boxes verified to sit on their cores


def grab():
    subprocess.run(["wsl.exe", "-d", "Ubuntu-24.04", "-e", "bash", "-c",
                    f"{W} exec-out screencap -p > /mnt/c/Users/Tony/.brx-mcp/_shot.png"],
                   capture_output=True, timeout=90)
    return np.asarray(Image.open(S).convert("RGB"), dtype=float)


def name(v):
    if v.sum() < 25:
        return "dark"
    mx = max(*v, 1.0)
    r, g, b = v / mx
    if min(r, g, b) > 0.75:
        return "white"
    i = int(np.argmax([r, g, b]))
    if i == 0:
        return "yellow" if g > 0.55 else ("purple" if b > 0.55 else "red")
    if i == 2:
        return "purple" if r > 0.50 else ("teal" if g > 0.72 else "blue")
    return "teal" if b > 0.82 else ("yellow" if r > 0.60 else "green")


async def main():
    addr, rois_path = sys.argv[1], sys.argv[2]
    n = int(sys.argv[3]) if len(sys.argv) > 3 else 8
    rois = json.load(open(rois_path))

    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    await mgr.connect(addr, "g")

    async def snd(f, s=0.2):
        await mgr.send("g", f, reply_window_ms=140)
        await asyncio.sleep(s)

    def sample(label, count=None):
        out = []
        t0 = time.time()
        for _ in range(count or n):
            im = grab()
            out.append("/".join(name(im[y:y + h, x:x + w].reshape(-1, 3).mean(0))
                                for (x, y, w, h) in (rois[k] for k in KEYS)))
        span = time.time() - t0
        uniq = sorted(set(out))
        verdict = "HELD" if len(uniq) == 1 else "CHANGING %s" % uniq
        print(f"   {label:<44} over {span:4.1f}s: {verdict}", flush=True)
        return out

    try:
        for fr in B.arming_frames(40, 1, sirs=[B.SIR_PLAIN]):
            await snd(fr)
        await snd(B.AR)
        await snd("$AMMO,0,32,192,1,*")
        await snd("$BMAP,0,0,,,,,*")

        print("=== can we drive the gun LEDs in a LIVE game? ===\n")
        await snd("$GLED,3,3,3,0,10,,*", 0.8)
        sample("UNSPAWNED, we set green")

        await snd("$SPAWN,,*", 2.0)
        sample("SPAWNED (our green still set?)")

        await snd("$GLED,0,0,0,0,10,,*", 0.8)
        sample("SPAWNED, we set RED after spawning")

        await snd("$GLED,6,6,6,0,10,,*", 0.8)
        sample("SPAWNED, we set WHITE")

        print("\n   re-asserting the same frame repeatedly (does repainting win?)")
        out = []
        t0 = time.time()
        for _ in range(n):
            await mgr.send("g", "$GLED,0,0,0,0,10,,*", reply_window_ms=100)
            im = grab()
            out.append("/".join(name(im[y:y + h, x:x + w].reshape(-1, 3).mean(0))
                                for (x, y, w, h) in (rois[k] for k in KEYS)))
        print(f"   {'SPAWNED, RED re-sent before every sample':<44} over {time.time()-t0:4.1f}s: "
              f"{'HELD' if len(set(out))==1 else 'CHANGING %s' % sorted(set(out))}", flush=True)
    finally:
        await snd("$GLED,,,,5,,,*", 0.2)
        await snd("$CLEAR,*", 0.2)
        try:
            await mgr.disconnect("g")
        except Exception:
            pass


asyncio.run(main())
