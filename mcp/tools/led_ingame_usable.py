"""Given that our colour ALTERNATES with the native team colour on a spawned gun -- is it still usable?

Three product questions, all measurable:

  1. What is the alternation's PERIOD and DUTY? "Alternates" is not a verdict. If our colour holds for
     most of a second at a time it is perfectly readable; if it is a 100 ms sliver between team-colour
     frames it is not. Nobody has measured it.
  2. Is a transient FLASH visible through it? A white flash on a hit does not need to win the argument
     with the native animation, it only needs to be seen.
  3. Can we still control BRIGHTNESS while alternating? If yes, a dim/bright health indicator survives
     even though a solid colour does not.

Measured from video (60 fps) on a SPAWNED gun, which is the only state that matters for a mode. The
noise floor for these ROIs is swing 21-83; the validated positive control (the native pulse alone) is
~494, so anything in the hundreds is real signal.

Usage: python led_ingame_usable.py <gun_addr> <rois.json>
"""
import asyncio
import json
import subprocess
import sys

import numpy as np

import bench_common as B

src = open(r"\\wsl.localhost\Ubuntu-24.04\home\tony\gitrepos\battlecompany\mcp\tools\led_effects.py").read()
_ns = {}
exec(compile(src[:src.index("async def main():")], "fx", "exec"), _ns)
record_roi = _ns["record_roi"]


def stats(rgb, label):
    """Period/duty of whatever is cycling, plus how much of the time each hue is on top."""
    lum = rgb.sum(1)[6:]
    rgb = rgb[6:]
    lo, hi, mean = lum.min(), lum.max(), lum.mean()
    swing = hi - lo
    x = lum - lum.mean()
    n = len(x)
    freqs = np.fft.rfftfreq(n, d=1 / 60.0)
    power = np.abs(np.fft.rfft(x * np.hanning(n))) ** 2
    band = (freqs > 0.2) & (freqs < 15)
    pk = int(np.argmax(np.where(band, power, 0)))
    f0 = freqs[pk]
    share = power[pk] / max(power[band].sum(), 1e-9)
    # which channel dominates each frame -> how much of the time is "ours" vs the team blue
    dom = np.argmax(rgb, axis=1)
    frac = {c: float((dom == i).mean()) for i, c in enumerate(("R", "G", "B"))}
    per = f"{1/f0:.2f}s ({f0:.2f} Hz)" if f0 > 0 else "n/a"
    print(f"   {label:<40} swing {swing:5.0f} on mean {mean:5.0f}   cycle {per:<16} "
          f"peak {share*100:2.0f}%   time-dominant R{frac['R']*100:3.0f}% G{frac['G']*100:3.0f}% B{frac['B']*100:3.0f}%",
          flush=True)


async def main():
    addr, rois_path = sys.argv[1], sys.argv[2]
    rois = json.load(open(rois_path))
    x, y, w, h = rois["LED1"]

    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    await mgr.connect(addr, "g")

    async def snd(f, s=0.2):
        await mgr.send("g", f, reply_window_ms=140)
        await asyncio.sleep(s)

    try:
        for fr in B.arming_frames(40, 1, sirs=[B.SIR_PLAIN]):
            await snd(fr)
        await snd(B.AR)
        await snd("$AMMO,0,32,192,1,*")
        await snd("$BMAP,0,0,,,,,*")
        await snd("$SPAWN,,*", 2.0)

        print("=== is the alternation usable? (SPAWNED gun, team 1 = blue) ===\n")
        await snd("$GLED,,,,5,,,*", 0.8)
        stats(record_roi(x, y, w, h), "native only (nothing from us)")

        for lbl, frame in (("we set WHITE (6)", "$GLED,6,6,6,0,10,,*"),
                           ("we set RED (0)", "$GLED,0,0,0,0,10,,*"),
                           ("we set GREEN (3)", "$GLED,3,3,3,0,10,,*")):
            await snd(frame, 1.0)
            stats(record_roi(x, y, w, h), lbl)

        print("\n   --- can we still control BRIGHTNESS while alternating? ---")
        for lbl, frame in (("WHITE full   (t4=0,t5=10)", "$GLED,6,6,6,0,10,,*"),
                           ("WHITE dim    (t4=5,t5=10)", "$GLED,6,6,6,5,10,,*"),
                           ("GREEN full   (t4=0,t5=10)", "$GLED,3,3,3,0,10,,*"),
                           ("GREEN dim    (t4=5,t5=10)", "$GLED,3,3,3,5,10,,*")):
            await snd(frame, 1.0)
            stats(record_roi(x, y, w, h), lbl)
    finally:
        await snd("$GLED,,,,5,,,*", 0.2)
        # $CLEAR wipes the $SIR table; a gun with no rows ignores every hit (F11). Put it back.
        await snd("$CLEAR,*", 0.2)
        for _sir in B.SIRS:
            await snd(_sir, 0.1)
        try:
            await mgr.disconnect("g")
        except Exception:
            pass


asyncio.run(main())
