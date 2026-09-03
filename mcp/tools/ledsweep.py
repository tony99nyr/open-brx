"""Autonomous LED reverse-engineering harness: drives the tagger over BLE AND reads the result
through a phone camera, in one process, with no human in the observation loop.

WHY THIS SHAPE. Every previous LED session had a machine sending frames and a person reporting what
they saw. The two are not synchronised: on 2026-08-30 a timed sweep raced the operator's replies and
produced two confidently wrong theories. Here the sender and the observer are the same process, so a
reading cannot be attributed to the wrong frame. It also means exhaustive sweeps are cheap.

⭐ FIRST: turn the camera exposure DOWN until only the LEDs are visible against black. See
ledcam.py's header -- it removes the need for a reference frame entirely, and with it the whole
family of stale-reference / exposure-drift faults that produced several wrong tables on 2026-09-02.

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

import bench_common as B

# The phone is paired to WSL's adb key, not the Windows one, so this Windows process borrows WSL's
# adb. The screenshot is written to a FILE on the Windows filesystem rather than piped: binary PNG
# through wsl.exe's stdout is not worth trusting.
_SHOT = r"C:\Users\Tony\.brx-mcp\_shot.png"
_WSL_ADB = "/home/tony/Android/Sdk/platform-tools/adb"

# ⚠ NOT t4=3. Measured 2026-09-02: `$GLED,,,,3,,,*` does NOT clear an already-lit gun -- red stayed
# red at [91,29,36] -> [94,35,50], and sending it twice or as `$GLED,0,0,0,3,0` made no difference.
# t4=5 (Callsign's own frame, and the one gameconfig ships for night mode), t4=6, t4=7 and t5=0 all
# DO drop to ambient. Using a blank that does not blank silently poisons every reference frame, which
# is exactly how a palette sweep came back claiming a known-blue index was "dark".
BLANK = ["$GLED,,,,5,,,*", "$HLED,,6,,,,,*"]

PALETTE = {0: "red", 1: "blue", 2: "yellow", 3: "green", 4: "purple", 5: "teal", 6: "white"}


_grabs = 0


def grab() -> np.ndarray:
    """One screenshot of the phone (= the camera preview), as float RGB.

    Every 25th grab also pokes KEYCODE_WAKEUP. The phone sleeping mid-sweep does not just pause the
    run -- it ROTATES the screen back to portrait on wake, which silently invalidates every pixel ROI
    and turns the rest of the sweep into confident nonsense. WAKEUP on an awake screen is a no-op.
    """
    global _grabs
    _grabs += 1
    poke = " ; ".join([f"{_WSL_ADB} shell input keyevent KEYCODE_WAKEUP"]) if _grabs % 25 == 1 else ""
    cmd = (poke + " ; " if poke else "") + \
        f"{_WSL_ADB} exec-out screencap -p > /mnt/c/Users/Tony/.brx-mcp/_shot.png"
    subprocess.run(["wsl.exe", "-d", "Ubuntu-24.04", "-e", "bash", "-c", cmd],
                   capture_output=True, timeout=90)
    im = np.asarray(Image.open(_SHOT).convert("RGB"), dtype=float)
    if im.shape[0] > im.shape[1]:
        raise SystemExit("phone is PORTRAIT -- it slept and rotated. ROIs are invalid; "
                         "re-open the camera and recalibrate with ledcam.py diff.")
    return im


def _name(nr: float, ng: float, nb: float) -> str:
    """Name a colour from channel ratios normalised to the strongest channel."""
    if min(nr, ng, nb) > 0.80:
        return "white"
    i = int(np.argmax([nr, ng, nb]))
    if i == 0:
        return "yellow" if ng > 0.55 else ("purple" if nb > 0.55 else "red")
    if i == 2:
        return "purple" if nr > 0.50 else ("teal" if ng > 0.82 else "blue")
    # 0.82, not 0.72: the gun's three LEDs sit ~25 px apart and bleed into each other, so a GREEN
    # with a lit BLUE neighbour measures B/G ~ 0.73. A real teal reads ~1.0. Measured 2026-09-02.
    return "teal" if nb > 0.82 else ("yellow" if nr > 0.60 else "green")


def classify(patch: np.ndarray) -> tuple[str, tuple]:
    br = patch.sum(1)
    if br.mean() < 45:
        return "dark", (0, 0, 0)
    # WHICH SAMPLE carries the colour depends on how big the emitter is in frame:
    #   gun LEDs are pinpoints that blow out to white  -> the hue is only in the dim FRINGE
    #   headset modules fill most of their box         -> the fringe is just dark surround, use MEAN
    # Guessing wrong makes a lit module read "dark" or a green read "red", so decide on box area.
    if len(patch) > 1500:
        r, g, b = patch.mean(0)
        if r + g + b < 30:
            return "dark", (r, g, b)
        mx = max(r, g, b, 1.0)
        return _name(r / mx, g / mx, b / mx), (r, g, b)
    lo, hi = np.percentile(br, 1), np.percentile(br, 12)
    halo = patch[(br >= lo) & (br <= hi)]
    if len(halo) == 0:
        halo = patch
    r, g, b = halo.mean(0)
    if r + g + b < 14:
        # The fringe sample is black. Two very different cases, and they must not be confused:
        #   - nothing is lit here                              -> genuinely dark
        #   - the emitter is LARGE (the headset modules are     -> the low band sampled the dark
        #     much bigger than the gun's pinpoint LEDs), so        surround while the module itself
        #     most of the box is lit and the dim 1st-12th          is plainly lit
        #     percentile lands on the surround
        # Distinguish on the WHOLE box: if it is meaningfully brighter than the reference, it is lit
        # and we classify on the mean instead of the fringe.
        whole = patch.mean(0)
        if whole.sum() < 30:
            return "dark", (r, g, b)
        r, g, b = whole
    mx = max(r, g, b, 1.0)
    n = (r / mx, g / mx, b / mx)

    return _name(*n), (r, g, b)


def renormalise(im, bg, rois):
    """Undo per-frame AUTO-EXPOSURE and AUTO-WHITE-BALANCE before differencing (see ledcam.py).

    The phone re-meters every frame: lighting the LEDs makes it stop DOWN, so every static surface
    darkens (a wall went [42,44,48] -> [8,9,15]) and colour re-balances. Differencing a lit frame
    against a dark reference therefore compares two different cameras. A GREY roi on a static neutral
    surface no LED can reach is rescaled to match the reference, per channel, per frame. Google Camera
    exposes no AE/AF lock, so this is the only way to make readings comparable across scenes.
    """
    if bg is None or "GREY" not in rois:
        return im
    x, y, w, h = rois["GREY"]
    cur = im[y:y + h, x:x + w].reshape(-1, 3).mean(0)
    want = bg[y:y + h, x:x + w].reshape(-1, 3).mean(0)
    return im * np.where(cur > 1.0, want / np.maximum(cur, 1e-6), 1.0)


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

    def _classify_all(self, im, ref, ambient=None) -> dict:
        im = renormalise(im, ref, self.rois)
        out = {}
        for name, (x, y, w, h) in self.rois.items():
            if name == "GREY":
                continue
            p = np.clip(im[y:y + h, x:x + w].reshape(-1, 3)
                        - ref[y:y + h, x:x + w].reshape(-1, 3), 0, None)
            if ambient is not None and name != "CONTROL":
                p = np.clip(p - ambient, 0, None)     # residual room-light shift
            out[name] = classify(p)
        return out

    async def apply_read(self, frame: str, settle: float = 0.8) -> dict:
        """Apply a frame and read it against ONE reference captured at the start.

        Why not re-blank before every row: the per-row blank is what kept corrupting these sweeps.
        A reference taken right after a blank that did not fully take contains the PREVIOUS colour,
        and every delta is then nonsense -- that produced two entirely bogus palette tables on
        2026-09-02, one of which called a known-blue index "dark". Applying against a single
        verified-dark reference matches what hand-measurement showed to be correct, and the CONTROL
        ROI still catches ambient drift (re-reference when it stops reading dark).
        """
        await self.send(frame, settle)
        r = self._classify_all(grab(), self.ref)
        r["_ok"] = (r["CONTROL"][0] == "dark", (0, 0, 0))
        return r

    async def measure(self, frame: str, settle: float = 0.45, tries: int = 6) -> dict:
        """Blank -> reference -> apply -> read, REJECTING any reading the ambient contaminated.

        The room has RGB lighting that cycles, and a blank->read cycle takes ~2 s -- longer than the
        cycle. So a fresh reference is NOT enough on its own. CONTROL is a patch of bare carpet with
        no LED in it: if it is anything but "dark", the ambient moved between the two captures and
        the whole row is fiction. We retry rather than report it. Whatever residual is left in
        CONTROL is also subtracted from every other ROI.

        This is the check that caught a completely bogus palette sweep on 2026-09-02, in which
        $GLED,3,3,3 (a known green) read "dark" and a BLANKED headset read "yellow".
        """
        last = None
        for attempt in range(tries):
            for f in BLANK:
                await self.send(f, 0.12)
            await asyncio.sleep(0.30)
            ref = grab()
            await self.send(frame, settle)
            im = grab()
            cx, cy, cw, ch = self.rois["CONTROL"]
            amb = np.clip(im[cy:cy + ch, cx:cx + cw].reshape(-1, 3)
                          - ref[cy:cy + ch, cx:cx + cw].reshape(-1, 3), 0, None).mean(0)
            last = self._classify_all(im, ref, ambient=amb)
            if amb.sum() < 24:                       # canary dark => ambient held still
                last["_ok"] = (True, tuple(amb))
                return last
        last["_ok"] = (False, tuple(amb))
        return last

    def read(self) -> dict:
        return self._classify_all(grab(), self.ref)

    def line(self, label, r):
        def cell(k):
            name, (rr, gg, bb) = r[k]
            mx = max(rr, gg, bb, 1.0)
            return f"{k}={name:<6}[{rr/mx:.2f},{gg/mx:.2f},{bb/mx:.2f}]"
        cells = " ".join(cell(k) for k in self.rois if k not in ("CONTROL", "GREY"))
        ok, amb = r.get("_ok", (True, (0, 0, 0)))
        flag = "" if ok else "   <<< CONTROL NOT DARK - ambient moved, DISCARD"
        print(f"   {label:<34} {cells}{flag}", flush=True)


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
        for fr in B.arming_frames(40, 1, sirs=[B.SIR_PLAIN]):
            await rig.send(fr, 0.18)
        await rig.blank_ref()
        print("=== reference captured (all LEDs blanked); gun ARMED, NOT spawned ===\n", flush=True)

        if "palette" in sections:
            print("--- $GLED tokens 1-3: palette index per LED (0-10) ---", flush=True)
            for n in range(11):
                rig.line(f"$GLED,{n},{n},{n},0,10  ({PALETTE.get(n,'?')})",
                         await rig.apply_read(f"$GLED,{n},{n},{n},0,10,,*"))
            print(flush=True)

        if "effect" in sections:
            print("--- $GLED token 4: effect/mode (colour held at 3,3,3 = green) ---", flush=True)
            for t4 in range(11):
                rig.line(f"$GLED,3,3,3,{t4},10", await rig.apply_read(f"$GLED,3,3,3,{t4},10,,*"))
            print(flush=True)

        if "bright" in sections:
            print("--- $GLED token 5: claimed brightness (green) ---", flush=True)
            for t5 in (1, 2, 1, 2, 1, 2):
                r = await rig.apply_read(f"$GLED,3,3,3,0,{t5},,*")
                lum = {k: sum(r[k][1]) for k in rois}
                rig.line(f"$GLED,3,3,3,0,{t5:<4} lum={int(lum['LED1']):4d}", r)
            print(flush=True)

        if "hled" in sections:
            print("--- $HLED token 1: headset palette (0-10) ---", flush=True)
            for n in range(11):
                rig.line(f"$HLED,{n},0,,,10  ({PALETTE.get(n,'?')})",
                         await rig.apply_read(f"$HLED,{n},0,,,10,,*"))
            print(flush=True)

        if "hledfx" in sections:
            print("--- $HLED token 2: effect (colour held at 3 = green) ---", flush=True)
            for t2 in range(11):
                rig.line(f"$HLED,3,{t2},300,300,10,5",
                         await rig.apply_read(f"$HLED,3,{t2},300,300,10,5,*"))
            print(flush=True)

        if "cross" in sections:
            print("--- CROSS-TALK: does each command touch only its own device? ---", flush=True)
            await rig.send("$GLED,,,,3,,,*"); await rig.send("$HLED,,6,,,,,*")
            rig.line("both blanked", rig.read())
            rig.line("$GLED red only", await rig.apply_read("$GLED,0,0,0,0,10,,*"))
            rig.line("$HLED green only", await rig.apply_read("$HLED,3,0,,,10,,*"))
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
        # $CLEAR wipes the $SIR table; a gun with no rows ignores every hit (F11). Put it back.
        await mgr.send("g", "$CLEAR,*", reply_window_ms=200)
        for _sir in B.SIRS:
            await mgr.send("g", _sir, reply_window_ms=120)
        try:
            await mgr.disconnect("g")
        except Exception:
            pass


asyncio.run(main())
