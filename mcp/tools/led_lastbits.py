"""The last three LED unknowns, in one pass.

  1. $GLED tokens 6 and 7 -- the trailing pair, never probed at all.
  2. Do $GLED's TWO apparent brightness controls compose? Token 4 = 5 applies at ~1/3 brightness,
     and token 5 is a separate off/dim/full control. Nobody has tried them together.
  3. What is $HLED token 5? Callsign always ships 10. Earlier stills showed 0 = dark and 10 vs 100
     indistinguishable, but 255 changed the trailing flashes, so "enable only" was never safe.

Method throughout: shoot against BLACK (exposure down until only the LEDs are visible), so absolute
luminance is meaningful and no reference frame is needed -- the regime that removed a whole class of
bug earlier today. Each measurement is repeated and reported per trial rather than averaged, because
averaging is how an unstable value gets written down as a number.

Usage: python led_lastbits.py <gun_addr> <rois.json> [trials=3]
"""
import asyncio
import json
import subprocess
import sys

import numpy as np
from PIL import Image

import bench_common as B

W = "/home/tony/Android/Sdk/platform-tools/adb"
S = r"C:\Users\Tony\.brx-mcp\_shot.png"


def grab():
    subprocess.run(["wsl.exe", "-d", "Ubuntu-24.04", "-e", "bash", "-c",
                    f"{W} exec-out screencap -p > /mnt/c/Users/Tony/.brx-mcp/_shot.png"],
                   capture_output=True, timeout=90)
    im = np.asarray(Image.open(S).convert("RGB"), dtype=float)

    if im.mean() < 12:
        raise SystemExit(
            "ABORT: the phone screen is OFF or LOCKED -- every reading would be of a black frame.\n"
            "  This is NOT caught by the CONTROL roi: a locked screen darkens the canary too, so the\n"
            "  run looks internally consistent and produces a table of pure fiction. It happened on\n"
            "  2026-09-02 and nearly went into the docs as 'the gun dims its LEDs with health'.\n"
            "  Unlock the phone, reopen the camera, and re-check the ROIs before re-running.")
    return im


def hue(v):
    if v.sum() < 20:
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
    n = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    rois = json.load(open(rois_path))
    GUN = [k for k in ("LED1", "LED3") if k in rois]
    HS = [k for k in ("HS_C",) if k in rois]

    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    await mgr.connect(addr, "g")

    async def snd(f, s=0.2):
        await mgr.send("g", f, reply_window_ms=140)
        await asyncio.sleep(s)

    def read(keys):
        im = grab()
        return [(round(float(im[y:y + h, x:x + w].reshape(-1, 3).mean()), 1),
                 hue(im[y:y + h, x:x + w].reshape(-1, 3).mean(0)))
                for (x, y, w, h) in (rois[k] for k in keys)]

    async def measure(frame, keys, blank="$GLED,,,,5,,,*"):
        rows = []
        for _ in range(n):
            await snd(blank, 0.45)
            await snd(frame, 0.65)
            rows.append(read(keys))
        lum = [r[0][0] for r in rows]
        hues = sorted({c[1] for r in rows for c in r})
        return lum, hues

    try:
        for fr in B.arming_frames(40, 1, sirs=[B.SIR_PLAIN]):
            await snd(fr)

        print("=== 1. $GLED tokens 6 and 7 (never probed) ===")
        print("   baseline is $GLED,3,3,3,0,10 with both empty; anything that MOVES is a real token\n")
        for t6, t7 in (("", ""), ("0", ""), ("1", ""), ("50", ""), ("255", ""),
                       ("", "0"), ("", "1"), ("", "50"), ("", "255"), ("1", "1")):
            f = f"$GLED,3,3,3,0,10,{t6},{t7},*"
            lum, hues = await measure(f, GUN)
            print(f"   t6={t6 or '-':<4} t7={t7 or '-':<4}  {f:<28} lum {lum}  hue {hues}", flush=True)

        print("\n=== 2. do $GLED's two brightness controls COMPOSE? ===")
        print("   t4=5 applies at ~1/3; token 5 is off/dim/full. Untested together.\n")
        for t4, t5 in ((0, 2), (0, 1), (5, 2), (5, 1), (0, 10), (5, 10)):
            f = f"$GLED,3,3,3,{t4},{t5},,*"
            lum, hues = await measure(f, GUN)
            print(f"   t4={t4} t5={t5:<4} {f:<28} lum {lum}  hue {hues}", flush=True)

        if HS:
            print("\n=== 3. what is $HLED token 5? ===")
            print("   solid (t2=0) isolates brightness; Callsign always ships 10\n")
            for t5 in (0, 1, 2, 5, 10, 50, 100, 255):
                f = f"$HLED,3,0,,,{t5},,*"
                lum, hues = await measure(f, HS, blank="$HLED,,6,,,,,*")
                print(f"   t5={t5:<5} {f:<26} lum {lum}  hue {hues}", flush=True)
    finally:
        await snd("$GLED,,,,5,,,*", 0.2)
        await snd("$HLED,,6,,,,,*", 0.2)
        # $CLEAR wipes the $SIR table; a gun with no rows ignores every hit (F11). Put it back.
        await snd("$CLEAR,*", 0.2)
        for _sir in B.SIRS:
            await snd(_sir, 0.1)
        try:
            await mgr.disconnect("g")
        except Exception:
            pass


asyncio.run(main())
