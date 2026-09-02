"""Autonomous LED reverse-engineering harness: drives the tagger over BLE AND reads the result
through a phone camera, in one process, with no human in the observation loop.

WHY THIS SHAPE. Every previous LED session had a machine sending frames and a person reporting what
they saw. The two are not synchronised: on 2026-08-30 a timed sweep raced the operator's replies and
produced two confidently wrong theories. Here the sender and the observer are the same process, so a
reading cannot be attributed to the wrong frame. It also means exhaustive sweeps are cheap.

CAMERA. An Android phone on wireless adb, camera app open, aimed at the gun and headset, propped
still. ROIs are pixel boxes in the phone's SCREEN (the camera preview), calibrated by `ledcam.py
diff`. If the phone moves, recalibrate -- the coordinates are meaningless otherwise.

REFERENCE SUBTRACTION is not optional, and it is done PER MEASUREMENT. The LED cores blow out to
white under the phone's auto-exposure, adjacent gun LEDs bleed into each other, and the room tints
everything. On top of that this office has a Hue lamp slowly cycling through a rainbow, so ambient
colour DRIFTS: a reference captured once at the start is wrong by the end of a sweep. So every single
reading is (frame - its own blanked reference), captured about a second apart, which the drift cannot
outrun. A CONTROL ROI on bare carpet (no LED in it) is reported alongside; if the control is ever
brighter than "dark", the ambient moved during that measurement and the row is suspect.

Usage (Windows python -- BLE needs Windows, WSL2 has none):
    python.exe ledsweep.py <gun_addr> <rois.json> [section...]
    sections: palette effect bright hled hledfx cross timing  (default: all)
"""
import asyncio
import json
import subprocess
import sys
import time

import numpy as np
from PIL import Image

# The phone is paired to WSL's adb key, not the Windows one, so this Windows process borrows WSL's
# adb. The screenshot is written to a FILE on the Windows filesystem rather than piped: binary PNG
# through wsl.exe's stdout is not worth trusting.
_SHOT = r"C:\Users\Tony\.brx-mcp\_shot.png"
_WSL_ADB = "/home/tony/Android/Sdk/platform-tools/adb"

AR = ("$WEAP,0,,100,0,0,9,0,,,,,,,,190,850,32,384,1400,0,0,100,100,,0,,,"
      "R01,,,,D04,D03,D02,D18,,,,,32,192,75,*")
PSET = ("$PSET,40,0,45,70,150,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,"
        "H06,H55,H13,H21,H02,U15,W71,A10,*")
BLANK = ["$GLED,,,,3,,,*", "$HLED,,6,,,,,*"]

PALETTE = {0: "red", 1: "blue", 2: "yellow", 3: "green", 4: "purple", 5: "teal", 6: "white"}


def grab() -> np.ndarray:
    subprocess.run(["wsl.exe", "-d", "Ubuntu-24.04", "-e", "bash", "-c",
                    f"{_WSL_ADB} exec-out screencap -p > /mnt/c/Users/Tony/.brx-mcp/_shot.png"],
                   capture_output=True, timeout=90)
    return np.asarray(Image.open(_SHOT).convert("RGB"), dtype=float)


def classify(patch: np.ndarray) -> tuple[str, tuple]:
    br = patch.sum(1)
    if br.mean() < 45:
        return "dark", (0, 0, 0)
    lo, hi = np.percentile(br, 25), np.percentile(br, 75)
    halo = patch[(br >= lo) & (br <= hi)]
    if len(halo) == 0:
        halo = patch
    r, g, b = halo.mean(0)
    mx = max(r, g, b, 1.0)
    n = (r / mx, g / mx, b / mx)
    if min(n) > 0.80:
        return "white", (r, g, b)
    i = int(np.argmax([r, g, b]))
    name = ("red", "green", "blue")[i]
    if name == "red":
        name = "yellow" if n[1] > 0.55 else ("purple" if n[2] > 0.55 else "red")
    elif name == "blue":
        name = "purple" if n[0] > 0.50 else ("teal" if n[1] > 0.60 else "blue")
    elif name == "green":
        name = "teal" if n[2] > 0.60 else ("yellow" if n[0] > 0.60 else "green")
    return name, (r, g, b)


class Rig:
    def __init__(self, mgr, rois):
        self.mgr, self.rois, self.ref = mgr, rois, None

    async def send(self, fr, settle=0.45):
        await self.mgr.send("g", fr, reply_window_ms=140)
        await asyncio.sleep(settle)

    async def blank_ref(self):
        for f in BLANK:
            await self.send(f, 0.3)
        await asyncio.sleep(0.5)
        self.ref = grab()

    def _classify_all(self, im, ref) -> dict:
        out = {}
        for name, (x, y, w, h) in self.rois.items():
            p = np.clip(im[y:y + h, x:x + w].reshape(-1, 3)
                        - ref[y:y + h, x:x + w].reshape(-1, 3), 0, None)
            out[name] = classify(p)
        return out

    async def measure(self, frame: str, settle: float = 0.45) -> dict:
        """Blank -> reference -> apply -> read. The reference is fresh for THIS reading, so the
        office's slowly cycling Hue lamp cannot drift between the two captures."""
        for f in BLANK:
            await self.send(f, 0.15)
        await asyncio.sleep(0.35)
        ref = grab()
        await self.send(frame, settle)
        return self._classify_all(grab(), ref)

    def read(self) -> dict:
        return self._classify_all(grab(), self.ref)

    def line(self, label, r):
        cells = "  ".join(f"{k}={r[k][0]:<7}" for k in self.rois)
        print(f"   {label:<34} {cells}", flush=True)


async def main():
    addr, rois_path = sys.argv[1], sys.argv[2]
    sections = sys.argv[3:] or ["palette", "effect", "bright", "hled", "hledfx", "cross", "timing"]
    rois = {k: tuple(v) for k, v in json.load(open(rois_path)).items()}

    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    await mgr.connect(addr, "g")
    rig = Rig(mgr, rois)
    try:
        # ARMED BUT NOT SPAWNED on purpose: a spawned gun runs its own team-colour animation on the
        # same LEDs and composites over $GLED, so a palette reading would be a mix of ours and its.
        for fr in ["$CLEAR,*", "$START,*", "$VOL,30,*", "$GSET,0,0,1,0,1,0,50,1,*", PSET, AR,
                   "$SIR,0,0,,1,0,0,1,,*", "$TID,1,*"]:
            await rig.send(fr, 0.18)
        await rig.blank_ref()
        print("=== reference captured (all LEDs blanked); gun ARMED, NOT spawned ===\n", flush=True)

        if "palette" in sections:
            print("--- $GLED tokens 1-3: palette index per LED (0-10) ---", flush=True)
            for n in range(11):
                rig.line(f"$GLED,{n},{n},{n},0,10  ({PALETTE.get(n,'?')})",
                         await rig.measure(f"$GLED,{n},{n},{n},0,10,,*"))
            print(flush=True)

        if "effect" in sections:
            print("--- $GLED token 4: effect/mode (colour held at 3,3,3 = green) ---", flush=True)
            for t4 in range(11):
                rig.line(f"$GLED,3,3,3,{t4},10", await rig.measure(f"$GLED,3,3,3,{t4},10,,*"))
            print(flush=True)

        if "bright" in sections:
            print("--- $GLED token 5: claimed brightness (green) ---", flush=True)
            for t5 in (0, 1, 5, 10, 25, 50, 100, 200, 255):
                r = await rig.measure(f"$GLED,3,3,3,0,{t5},,*")
                lum = {k: sum(r[k][1]) for k in rois}
                rig.line(f"$GLED,3,3,3,0,{t5:<4} lum={int(lum['LED1']):4d}", r)
            print(flush=True)

        if "hled" in sections:
            print("--- $HLED token 1: headset palette (0-10) ---", flush=True)
            for n in range(11):
                rig.line(f"$HLED,{n},0,,,10  ({PALETTE.get(n,'?')})",
                         await rig.measure(f"$HLED,{n},0,,,10,,*"))
            print(flush=True)

        if "hledfx" in sections:
            print("--- $HLED token 2: effect (colour held at 3 = green) ---", flush=True)
            for t2 in range(11):
                rig.line(f"$HLED,3,{t2},300,300,10,5",
                         await rig.measure(f"$HLED,3,{t2},300,300,10,5,*", 0.30))
            print(flush=True)

        if "cross" in sections:
            print("--- CROSS-TALK: does each command touch only its own device? ---", flush=True)
            await rig.send("$GLED,,,,3,,,*"); await rig.send("$HLED,,6,,,,,*")
            rig.line("both blanked", rig.read())
            rig.line("$GLED red only", await rig.measure("$GLED,0,0,0,0,10,,*"))
            rig.line("$HLED green only", await rig.measure("$HLED,3,0,,,10,,*"))
            print(flush=True)

        if "timing" in sections:
            print("--- $HLED tokens 3/4 + 6: does count scale, does timing scale? ---", flush=True)
            for on, off, cnt in ((300, 300, 3), (300, 300, 8), (120, 120, 8), (600, 600, 3)):
                await rig.send("$HLED,,6,,,,,*", 0.3)
                t0 = time.time()
                await mgr.send("g", f"$HLED,7,4,{on},{off},10,{cnt},*", reply_window_ms=120)
                seen, dark_run, last = 0, 0, False
                while time.time() - t0 < (on + off) / 1000 * cnt + 2.0:
                    lit = classify(np.clip(grab()[rois["HEADSET"][1]:rois["HEADSET"][1] + rois["HEADSET"][3],
                                                 rois["HEADSET"][0]:rois["HEADSET"][0] + rois["HEADSET"][2]]
                                           .reshape(-1, 3) - rig.ref[rois["HEADSET"][1]:rois["HEADSET"][1] + rois["HEADSET"][3],
                                                                     rois["HEADSET"][0]:rois["HEADSET"][0] + rois["HEADSET"][2]].reshape(-1, 3), 0, None))[0] != "dark"
                    if lit and not last:
                        seen += 1
                    last = lit
                print(f"   on={on} off={off} count={cnt}  -> screencap saw {seen} lit edges "
                      f"(under-counts: screencap is ~1/s, use ledcam.py pulse for real counts)", flush=True)
            print(flush=True)
    finally:
        await rig.send("$GLED,,,,3,,,*", 0.2)
        await rig.send("$HLED,,6,,,,,*", 0.2)
        await mgr.send("g", "$CLEAR,*", reply_window_ms=200)
        try:
            await mgr.disconnect("g")
        except Exception:
            pass


asyncio.run(main())
