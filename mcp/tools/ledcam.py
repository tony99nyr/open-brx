"""Bench camera rig: watch tagger + headset LEDs through an Android phone over wireless adb.

WHY. LED colour, flash rate and "is that different?" are the questions this project keeps getting
wrong, because they are reported by a human watching while a machine sends frames, and the two are
not synchronised (2026-08-30 cost an afternoon to exactly that). A camera makes the LED state
MEASURABLE: colours become RGB, "slow pulse" becomes a period in seconds, "fast flash" becomes a
count. Answers stop depending on who was looking.

SETUP (once per session)
    adb pair 192.168.0.x:PPPPP <6-digit code>     # phone: Wireless debugging > Pair device
    adb connect 192.168.0.x:CCCCC                 # port from `adb mdns services` (run it on WINDOWS
                                                  # adb -- WSL cannot see mDNS across its NAT)
    adb shell am start -a android.media.action.STILL_IMAGE_CAMERA
Then aim the phone at the gun and headset and prop it steady.

SUBCOMMANDS
    shot <out.png>                          one still of the phone screen (= the camera preview)
    diff <off.png> <on.png> [--min N]       find what LIT UP between two stills -> ROI boxes
    crop <img.png> <x> <y> <w> <h> <out>    verify an ROI is on the LED you think it is
    probe <rois.json> [ref.png]             capture + NAME the colour in every ROI (the fast loop).
                                            ref.png = a frame with everything BLANK; strongly
                                            recommended, it cancels blown-out cores and room tint.
    record <secs> <out.mp4>                 record the preview
    pulse <video.mp4> <x> <y> <w> <h>       per-frame RGB in the ROI + PERIOD and FLASH COUNT

TYPICAL CALIBRATION (locating the headset LEDs, no guessing at coordinates)
    ledcam.py shot off.png                       # headset dark
    ... send $HLED,6,0,,,10,,*  (white, brightest) ...
    ledcam.py shot on.png
    ledcam.py diff off.png on.png                # prints the box the headset occupies
Do the same for the gun with $GLED lit vs `$GLED,,,,3,,,*` (blank).

Runs under the WSL venv (needs pillow + numpy): .venv/bin/python mcp/tools/ledcam.py ...
"""
import json
import subprocess
import sys

import numpy as np
from PIL import Image

ADB = "/home/tony/Android/Sdk/platform-tools/adb"


def _adb(args: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run([ADB] + args, capture_output=True, timeout=120, **kw)


def shot(out: str) -> None:
    r = _adb(["exec-out", "screencap", "-p"])
    if not r.stdout:
        raise SystemExit(f"no image from adb: {r.stderr.decode()[:200]}")
    open(out, "wb").write(r.stdout)
    im = Image.open(out)
    print(f"{out}  {im.width}x{im.height}")


def record(secs: str, out: str) -> None:
    _adb(["shell", "screenrecord", "--time-limit", str(secs), "--size", "1280x720", "/sdcard/_lc.mp4"])
    _adb(["pull", "/sdcard/_lc.mp4", out])
    print(f"{out}")


def _boxes(mask: np.ndarray, min_px: int):
    """Connected components on a boolean mask, as (x, y, w, h, pixels), biggest first."""
    seen = np.zeros_like(mask, dtype=bool)
    out = []
    ys, xs = np.nonzero(mask)
    for sy, sx in zip(ys, xs):
        if seen[sy, sx]:
            continue
        stack, pts = [(sy, sx)], []
        seen[sy, sx] = True
        while stack:
            y, x = stack.pop()
            pts.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < mask.shape[0] and 0 <= nx < mask.shape[1] \
                            and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
        if len(pts) >= min_px:
            py = [p[0] for p in pts]
            px = [p[1] for p in pts]
            out.append((min(px), min(py), max(px) - min(px) + 1, max(py) - min(py) + 1, len(pts)))
    return sorted(out, key=lambda b: -b[4])


def diff(a: str, b: str, min_px: int = 40) -> None:
    """What got BRIGHTER from a to b. That is the LED, wherever it happens to be in frame."""
    ia = np.asarray(Image.open(a).convert("RGB"), dtype=np.int16)
    ib = np.asarray(Image.open(b).convert("RGB"), dtype=np.int16)
    if ia.shape != ib.shape:
        raise SystemExit("images differ in size - did the phone move or rotate?")
    d = (ib.sum(2) - ia.sum(2))
    thr = max(60, int(d.max() * 0.45))
    boxes = _boxes(d > thr, min_px)
    print(f"threshold {thr} (peak delta {int(d.max())}), {len(boxes)} region(s):")
    for x, y, w, h, n in boxes[:8]:
        rgb = ib[y:y + h, x:x + w].reshape(-1, 3).mean(0)
        print(f"  x={x} y={y} w={w} h={h}  px={n}   mean RGB in 'on' = "
              f"({rgb[0]:.0f},{rgb[1]:.0f},{rgb[2]:.0f})")
        print(f"     -> pulse args:  {x} {y} {w} {h}")


# The LED cores BLOW OUT to white on the phone camera (auto-exposure), so the core carries no
# colour. The hue lives in the HALO around it -- sample the mid-brightness band, never the peak.
_HALO_LO, _HALO_HI = 45, 88


def _classify(patch: np.ndarray) -> tuple[str, tuple[float, float, float]]:
    br = patch.sum(1)
    if br.mean() < 45:
        return "dark", (0.0, 0.0, 0.0)
    lo, hi = np.percentile(br, _HALO_LO), np.percentile(br, _HALO_HI)
    halo = patch[(br >= lo) & (br <= hi)]
    if len(halo) == 0:
        halo = patch
    r, g, b = halo.mean(0)
    mx = max(r, g, b, 1.0)
    n = (r / mx, g / mx, b / mx)
    if min(n) > 0.86:                       # all three channels close => white, not a hue
        return "white", (r, g, b)
    name = {0: "red", 1: "green", 2: "blue"}[int(np.argmax([r, g, b]))]
    if name == "red" and n[1] > 0.75:
        name = "yellow"
    if name == "blue" and n[0] > 0.72:
        name = "purple"
    if name == "green" and n[2] > 0.80:
        name = "teal"
    return name, (r, g, b)


def probe(rois_json: str, ref: str | None = None) -> None:
    """Capture one still and name the colour in every calibrated ROI. The fast iteration loop.

    Pass a REFERENCE image (everything blanked: `$GLED,,,,3,,,*` + `$HLED,,6,,,,,*`) and each ROI is
    classified on what the LED ADDS over it. Without that, three things wreck the reading: the LED
    core blows out to white on the phone's auto-exposure, adjacent LEDs bleed into each other, and
    the room's own light tints everything. Subtracting the dark frame removes all three.
    """
    rois = json.load(open(rois_json))
    r = _adb(["exec-out", "screencap", "-p"])
    open("/tmp/_lcprobe.png", "wb").write(r.stdout)
    im = np.asarray(Image.open("/tmp/_lcprobe.png").convert("RGB"), dtype=float)
    bg = np.asarray(Image.open(ref).convert("RGB"), dtype=float) if ref else None
    for name, (x, y, w, h) in rois.items():
        patch = im[y:y + h, x:x + w].reshape(-1, 3)
        if bg is not None:
            patch = np.clip(patch - bg[y:y + h, x:x + w].reshape(-1, 3), 0, None)
        col, (rr, gg, bb) = _classify(patch)
        print(f"  {name:<10} {col:<7}  (R{rr:3.0f} G{gg:3.0f} B{bb:3.0f})")


def crop(img: str, x: str, y: str, w: str, h: str, out: str) -> None:
    Image.open(img).crop((int(x), int(y), int(x) + int(w), int(y) + int(h))).save(out)
    print(out)


def pulse(video: str, x: str, y: str, w: str, h: str) -> None:
    """Per-frame mean RGB of one ROI, then the period (smooth pulse) and edge count (flashes)."""
    p = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", video, "-vf", f"crop={w}:{h}:{x}:{y},scale=1:1",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True, timeout=300)
    d = p.stdout
    n = len(d) // 3
    if n == 0:
        raise SystemExit(f"no frames: {p.stderr.decode()[:200]}")
    fps = 60.0
    rgb = np.frombuffer(d[:n * 3], dtype=np.uint8).reshape(n, 3).astype(float)
    lum = rgb.sum(1)
    lo, hi = lum.min(), lum.max()
    print(f"{n} frames ({n / fps:.2f}s @ {fps:.0f}fps)   ROI {x},{y} {w}x{h}")
    print(f"mean RGB while LIT: ({rgb[lum > (lo + hi) / 2].mean(0)[0]:.0f},"
          f"{rgb[lum > (lo + hi) / 2].mean(0)[1]:.0f},{rgb[lum > (lo + hi) / 2].mean(0)[2]:.0f})")
    print(f"luma {lo:.0f}..{hi:.0f}  (swing {hi - lo:.0f})")
    if hi - lo < 25:
        print("STEADY - no pulse or flashing in this ROI")
        return
    mid = (lo + hi) / 2
    up = [i for i in range(1, n) if lum[i - 1] < mid <= lum[i]]
    print(f"rising crossings: {len(up)}  at " + ", ".join(f"{c / fps:.2f}s" for c in up[:14]))
    if len(up) > 1:
        per = np.diff(up) / fps
        print(f"periods: " + ", ".join(f"{p_:.2f}s" for p_ in per[:12]))
        print(f"MEAN PERIOD {per.mean():.2f}s  ->  {1 / per.mean():.2f} Hz"
              f"   (jitter +/-{per.std():.3f}s)")
    print(f"FLASH/CYCLE COUNT in window: {len(up)}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    cmd, args = sys.argv[1], sys.argv[2:]
    fn = {"shot": shot, "diff": diff, "crop": crop, "record": record, "pulse": pulse,
          "probe": probe}.get(cmd)
    if fn is None:
        raise SystemExit(__doc__)
    if cmd == "diff" and "--min" in args:
        i = args.index("--min")
        fn(args[0], args[1], int(args[i + 1]))
    else:
        fn(*args)
