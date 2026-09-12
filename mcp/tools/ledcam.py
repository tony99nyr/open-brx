"""Bench camera rig: watch tagger + headset LEDs through an Android phone over wireless adb.

WHY. LED colour, flash rate and "is that different?" are the questions this project keeps getting
wrong, because they are reported by a human watching while a machine sends frames, and the two are
not synchronised (2026-08-30 cost an afternoon to exactly that). A camera makes the LED state
MEASURABLE: colours become RGB, "slow pulse" becomes a period in seconds, "fast flash" becomes a
count. Answers stop depending on who was looking.

⭐ SET THE CAMERA EXPOSURE DOWN until the room goes BLACK and only the LEDs are visible.
   This is the single biggest quality win found on 2026-09-02, and it removes an entire class of bug
   rather than mitigating it. On a black background:
     - no reference frame is needed at all (absolute readings work), so stale/blanked-wrong
       references, per-row re-blanking and exposure drift between reference and reading all stop
       mattering -- every one of those produced a confidently wrong table earlier that day;
     - there is no ambient to drift, so the room's cycling RGB lighting is irrelevant;
     - LED cores stop blowing out, so the hue is in the pixels instead of only in the halo.
   Verified: red/green/blue read 1.00/0.29/0.34, 0.25/1.00/0.54, 0.20/0.59/1.00 with the control
   patch at (3, 0.1, 3.4), i.e. black.
   ⚠ The phone DIMS its screen after a while and the camera app then re-meters, silently discarding
   the exposure setting mid-run (operator-observed). Pin it first:
       adb shell settings put system screen_brightness_mode 0
       adb shell settings put system screen_brightness 255
       adb shell settings put system screen_off_timeout 2147483647

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
    calibrate <rois.json> <ref.png> <wb.json>   shoot a known WHITE -> per-ROI white points
    probe <rois.json> [ref.png] [wb.json]             capture + NAME the colour in every ROI (the fast loop).
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


# The LED cores BLOW OUT to white on the phone camera (auto-exposure), so the core carries no colour
# at all -- a box tight on the core reads "white" for every index. The hue lives in the DIM FRINGE.
# Calibrated 2026-09-02 by sweeping ROI size x percentile band against a known $GLED,0,3,1 (red,
# green, blue): a GENEROUS box (~52px, wider than the LED) sampled at a LOW band (3rd-25th percentile)
# separates them cleanly -- R1.00/G0.24/B0.14, R0.36/G1.00/B0.81, R0.03/G0.54/B1.00. Tight boxes and
# mid bands both collapse to white. The box overlapping its neighbours is fine: the dim fringe is
# dominated by the nearest emitter.
_HALO_LO, _HALO_HI = 1, 12


def _name(nr: float, ng: float, nb: float) -> str:
    """Name a colour from channel ratios normalised to the strongest channel."""
    mx = max(nr, ng, nb, 1e-6)
    nr, ng, nb = nr / mx, ng / mx, nb / mx
    if min(nr, ng, nb) > 0.72:
        return "white"
    i = int(np.argmax([nr, ng, nb]))
    if i == 0:
        return "yellow" if ng > 0.55 else ("purple" if nb > 0.55 else "red")
    if i == 2:
        return "purple" if nr > 0.50 else ("teal" if ng > 0.82 else "blue")
    # 0.82, not 0.72: the gun's three LEDs sit ~25 px apart and bleed into each other, so a GREEN
    # with a lit BLUE neighbour measures B/G ~ 0.73. A real teal reads ~1.0. Measured 2026-09-02.
    return "teal" if nb > 0.82 else ("yellow" if nr > 0.60 else "green")


def _wb_load(path: str | None) -> dict:
    """Per-ROI white points from `calibrate`, or {} if none."""
    try:
        return json.load(open(path)) if path else {}
    except Exception:
        return {}


def _wb_apply(rgb, wp):
    """Divide out the camera's colour cast using a measured WHITE as the reference.

    The phone auto-white-balances against a warm room, so a genuinely white LED measures blue-violet
    (~0.64/0.73/1.00) and every hue is dragged the same way. Lowering exposure does NOT fix it -- it
    is a white-balance shift, not saturation. But it is a CONSTANT shift, so shooting a known white
    (palette index 6) once and dividing by it cancels the cast exactly.
    """
    if not wp:
        return rgb
    return tuple(c / w if w > 1e-6 else c for c, w in zip(rgb, wp))


def _classify(patch: np.ndarray, wp=None) -> tuple[str, tuple[float, float, float]]:
    br = patch.sum(1)
    if br.mean() < 45:
        return "dark", (0.0, 0.0, 0.0)
    # WHICH SAMPLE carries the colour depends on how big the emitter is in frame:
    #   gun LEDs are pinpoints that blow out to white  -> the hue is only in the dim FRINGE
    #   headset modules fill most of their box         -> the fringe is just dark surround, use MEAN
    # (was shared with ledsweep.classify until that script was retired 2026-09-12)
    if len(patch) > 1500:
        r, g, b = patch.mean(0)
        if r + g + b < 30:
            return "dark", (r, g, b)
        mx = max(r, g, b, 1.0)
        return _name(*_wb_apply((r / mx, g / mx, b / mx), wp)), (r, g, b)
    lo, hi = np.percentile(br, _HALO_LO), np.percentile(br, _HALO_HI)
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
    return _name(*_wb_apply((r / mx, g / mx, b / mx), wp)), (r, g, b)


def calibrate(rois_json: str, ref: str, out: str) -> None:
    """Shoot a known WHITE (send `$GLED,6,6,6,0,10,,*` / `$HLED,6,0,,,10,,*` first) and store each
    ROI's measured white as its white point. Everything measured afterwards is divided by it."""
    rois = json.load(open(rois_json))
    r = _adb(["exec-out", "screencap", "-p"])
    open("/tmp/_lcwb.png", "wb").write(r.stdout)
    im = np.asarray(Image.open("/tmp/_lcwb.png").convert("RGB"), dtype=float)
    bg = np.asarray(Image.open(ref).convert("RGB"), dtype=float)
    im = _renormalise(im, bg, rois)
    wp = {}
    for name, (x, y, w, h) in rois.items():
        if name == "GREY":
            continue
        p = np.clip(im[y:y + h, x:x + w].reshape(-1, 3) - bg[y:y + h, x:x + w].reshape(-1, 3), 0, None)
        v = p.mean(0) if len(p) > 1500 else p[p.sum(1) >= np.percentile(p.sum(1), 60)].mean(0)
        mx = max(*v, 1.0)
        if v.sum() > 30:
            wp[name] = [float(c / mx) for c in v]
            print(f"  {name:<10} white point {wp[name][0]:.2f},{wp[name][1]:.2f},{wp[name][2]:.2f}")
        else:
            print(f"  {name:<10} not lit - skipped (no white point)")
    json.dump(wp, open(out, "w"), indent=1)
    print(f"-> {out}")


def _renormalise(im, bg, rois):
    """Undo the camera's per-frame AUTO-EXPOSURE and AUTO-WHITE-BALANCE before differencing.

    The phone re-meters the whole scene every frame. Light the LEDs and it stops DOWN to protect the
    highlights, so every static surface goes darker: a wall measured [42,44,48] with the LEDs off read
    [8,9,15] with them on, and the carpet [88,76,81] -> [48,55,56]. It also re-balances colour, so a
    genuinely white LED lands blue-violet. Both effects mean `lit_frame - dark_reference` is comparing
    two different cameras, which is why hues drifted between scenes and why lowering exposure did not
    help.

    Fix: put a GREY roi on a STATIC neutral surface that no LED can reach. Scale each channel of the
    frame so that patch matches its value in the reference, then difference. Per frame, per channel,
    so it tracks both effects with no camera control (Google Camera exposes no AE/AF lock).
    """
    if bg is None or "GREY" not in rois:
        return im
    x, y, w, h = rois["GREY"]
    cur = im[y:y + h, x:x + w].reshape(-1, 3).mean(0)
    want = bg[y:y + h, x:x + w].reshape(-1, 3).mean(0)
    scale = np.where(cur > 1.0, want / np.maximum(cur, 1e-6), 1.0)
    return im * scale


def probe(rois_json: str, ref: str | None = None, wb: str | None = None) -> None:
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
    wps = _wb_load(wb)
    im = _renormalise(im, bg, rois)
    for name, (x, y, w, h) in rois.items():
        if name == "GREY":
            continue
        patch = im[y:y + h, x:x + w].reshape(-1, 3)
        if bg is not None:
            patch = np.clip(patch - bg[y:y + h, x:x + w].reshape(-1, 3), 0, None)
        col, (rr, gg, bb) = _classify(patch, wps.get(name))
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


def main(argv: list[str]) -> None:
    """CLI dispatch. In a function, not at module scope, so the module imports cleanly (and so a
    typo here cannot NameError a bench tool before it ever opens a link -- test_bench_common)."""
    if len(argv) < 2:
        raise SystemExit(__doc__)
    cmd, args = argv[1], argv[2:]
    fn = {"shot": shot, "diff": diff, "crop": crop, "record": record, "pulse": pulse,
          "probe": probe, "calibrate": calibrate}.get(cmd)
    if fn is None:
        raise SystemExit(__doc__)
    if cmd == "diff" and "--min" in args:
        i = args.index("--min")
        fn(args[0], args[1], int(args[i + 1]))
    else:
        fn(*args)


if __name__ == "__main__":
    main(sys.argv)
