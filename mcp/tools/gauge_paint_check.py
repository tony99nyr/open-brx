"""F1 end-to-end: paint each pool level with `poolgauge` and CHECK the gun lit the right segments.

The mapping is unit-tested, but a unit test only proves we emit the frame we meant to emit. This
proves the GUN lights what we intended, through the calibrated ROIs, which is the part that has been
wrong before on this rig (an ROI on the wrong LED produces a clean-looking table of fiction, so the
ROIs are verified with a 3x3 response matrix before this is worth running).

Sends nothing but `$GLED`: no arming, no damage, no IR. Safe to run any time.

Usage: python gauge_paint_check.py <addr>
"""
import asyncio
import json
import subprocess
import sys

import numpy as np
from PIL import Image

import bench_common as B
from brx_mcp import poolgauge as pg

ADB = "/home/tony/Android/Sdk/platform-tools/adb"
ROIS = json.load(open(r"C:/Users/Tony/.brx-mcp/rois.json"))
KEYS = ["LED1", "LED2", "LED3"]


def grab():
    subprocess.run(["wsl.exe", "-d", "Ubuntu-24.04", "-e", "bash", "-c",
                    f"{ADB} exec-out screencap -p > /mnt/c/Users/Tony/.brx-mcp/_g.png"],
                   capture_output=True, timeout=90)
    im = np.asarray(Image.open(r"C:/Users/Tony/.brx-mcp/_g.png").convert("RGB"), dtype=float)
    if im.mean() < 12:
        raise SystemExit("ABORT: the phone screen is off/locked -- every reading would be black.")
    return im


def read(im):
    """Fraction of SATURATED pixels per ROI -- the only clean lit/dark discriminator here.

    Luminance cannot do it. A lit LED bathes the whole housing in its colour, so a DARK neighbour's
    ROI fills with reflected light: painting armour 2-of-3 measured LED3 at 170 against a 134 dark
    baseline, and both a flat threshold and a nearest-reference classifier called it lit. Looking at
    the actual crop settled it -- LED3 was visibly dark, just washed.

    What separates them is that a lit LED CORE BLOWS OUT (max RGB 255/254/255) while reflected wash
    does not (that same LED3 peaked at G=203). `ledcam.py` documents the blow-out; here it is the
    signal rather than the nuisance.
    """
    out = []
    for (x, y, w, h) in (ROIS[k] for k in KEYS):
        px = im[y:y + h, x:x + w].reshape(-1, 3)
        out.append(float((px.min(axis=1) > 235).mean()))
    return out


async def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    async with B.connected(mgr, (sys.argv[1], "v")):

        async def paint(frame, settle=1.3):
            await mgr.send("v", frame, reply_window_ms=140)
            await asyncio.sleep(settle)
            return read(grab())

        lum0 = await paint("$GLED,9,9,9,0,10,,*")
        print(f"   all-dark saturated fraction: {[round(v, 3) for v in lum0]}\n")

        async def lit_reference(colour):
            """What each ROI reads when THIS colour is definitely lit on all three LEDs.

            Per-colour, because the palette entries differ in brightness (purple reads far dimmer
            than teal) and these LEDs bleed into each other -- the 3x3 verification measured driving
            LED1 alone raising LED2 by 87 while LED1 rose 136. Classifying each segment against a
            lit and a dark reference for ITS OWN colour removes the hand-picked threshold that a
            flat cutoff needs, and with it the temptation to tune until the table passes.
            """
            return await paint(f"$GLED,{colour},{colour},{colour},0,10,,*")

        refs = {}
        for _pool, _c in (("shield", pg.TEAL), ("armor", pg.PURPLE),
                          ("health", pg.GREEN), ("health_low", pg.RED),
                          ("health_mid", pg.YELLOW)):
            refs[_c] = await lit_reference(_c)
        print(f"   {'case':30s} {'expect':>6s}  measured segments      verdict")

        CASES = [("shield", 70, 70, 3), ("shield", 45, 70, 2), ("shield", 20, 70, 1),
                 ("armor", 70, 70, 3), ("armor", 35, 70, 2), ("armor", 1, 70, 1),
                 ("health", 45, 45, 3), ("health", 30, 45, 2), ("health", 10, 45, 1),
                 ("health", 0, 45, 0)]
        ok = True
        for pool, level, maximum, expect in CASES:
            colour = pg.pool_colour(pool, level, maximum)
            ref = refs[colour]
            lum = await paint(pg.gauge_frame(pool, level, maximum))
            # lit if a real share of the ROI is blown out, judged against THIS colour's own lit
            # reference (palette entries differ in brightness, so purple saturates less than teal)
            lit = [1 if lum[i] > max(0.02, 0.25 * ref[i]) else 0 for i in range(3)]
            n = sum(lit)
            good = n == expect
            ok &= good
            print(f"   {pool+' '+str(level)+'/'+str(maximum):30s} {expect:>6d}  "
                  f"{lit} sat={[round(v,3) for v in lum]}  {'OK' if good else 'MISMATCH'}",
                  flush=True)

        tl = await paint(pg.team_frame(1))
        tref = refs.get(pg.TEAM_COLOURS[1]) or await lit_reference(pg.TEAM_COLOURS[1])
        team_lit = sum(1 for i in range(3) if tl[i] > max(0.02, 0.25 * tref[i]))
        print(f"\n   revert to team colour: {team_lit}/3 lit  "
              f"{'OK' if team_lit == 3 else 'MISMATCH'}")
        ok &= team_lit == 3

        await mgr.send("v", pg.team_frame(1), reply_window_ms=140)
        print("\n   " + ("ALL CASES MATCHED -- the gun lights what poolgauge intends."
                        if ok else "SEE MISMATCHES ABOVE -- do not record this as a pass."))


if __name__ == "__main__":
    asyncio.run(main())
