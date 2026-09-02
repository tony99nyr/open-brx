"""Characterise the $GLED / $HLED EFFECT enums from VIDEO, because single frames cannot.

WHY VIDEO. A screencap of a blinking LED catches whichever phase it happens to land in, so a
still-frame sweep of an effect enum reports noise: on 2026-09-02 one produced "dark" for a lit value
and assorted hues for the animated ones, and a bright headset flash lit the GUN rois while the gun
was blanked. Effects are a TIME signal and have to be sampled as one. Recording ~6 s at 60 fps and
reading the luminance series gives static-vs-animated, the period, and the duty cycle directly, which
is also the one thing a camera does far better than an eye.

Runs on Windows python (BLE), borrowing WSL's adb and ffmpeg (the phone is paired to WSL's adb key).

Usage: python led_effects.py <gun_addr> <rois.json> gled|hled [roi=LED2]
"""
import asyncio
import json
import subprocess
import sys

import numpy as np

import bench_common as B

WSL = ["wsl.exe", "-d", "Ubuntu-24.04", "-e", "bash", "-c"]
# The screen is 2410x1080 (2.23:1). Recording at 1280x720 (16:9) LETTERBOXES it, so ROI coordinates
# in screen space land somewhere else entirely and every reading is of the wrong pixels. Record at
# exactly half the screen so the mapping is a clean 0.5 scale.
REC_W, REC_H = 1204, 540
SCALE = REC_W / 2410.0
ADB = "/home/tony/Android/Sdk/platform-tools/adb"
FFMPEG = "/home/tony/.local/bin/ffmpeg"
RAW = r"C:\Users\Tony\.brx-mcp\_roi.raw"
SECS = 6


def record_roi(x, y, w, h):
    """Record the preview and return the ROI's mean RGB per frame, at 60 fps."""
    subprocess.run(WSL + [
        f"{ADB} shell screenrecord --time-limit {SECS} --size {REC_W}x{REC_H} /sdcard/_fx.mp4 && "
        f"{ADB} pull -a /sdcard/_fx.mp4 /mnt/c/Users/Tony/.brx-mcp/_fx.mp4 >/dev/null && "
        # the recording is 1280x720 but the ROIs are in 2410x1080 screen space -> scale the box
        f"{FFMPEG} -v error -y -i /mnt/c/Users/Tony/.brx-mcp/_fx.mp4 "
        f"-vf crop={max(2,int(w*SCALE))}:{max(2,int(h*SCALE))}:"
        f"{int(x*SCALE)}:{int(y*SCALE)},scale=1:1 "
        f"-f rawvideo -pix_fmt rgb24 /mnt/c/Users/Tony/.brx-mcp/_roi.raw"],
        capture_output=True, timeout=180)
    d = open(RAW, "rb").read()
    n = len(d) // 3
    return np.frombuffer(d[:n * 3], dtype=np.uint8).reshape(n, 3).astype(float)


def describe(rgb) -> str:
    """static / blink / breathe, decided by SPECTRUM rather than by threshold crossings.

    A midpoint-crossing counter treats camera noise as animation: the phone preview's own
    auto-exposure jitter produced swings of 30-50 on a mean of ~120 and got reported as "BREATHE
    period 1.43s", differently on two identical runs. A real animation puts its energy at ONE
    frequency, so we take the FFT of the (detrended) luminance and require the dominant component to
    carry a real share of the power before calling anything animated. Shape then comes from where the
    signal spends its time: a square blink sits near the two extremes, a breathe sweeps between them.
    """
    if len(rgb) < 60:
        return "NO VIDEO"
    lum = rgb.sum(1)
    lum = lum[6:]                                   # drop the recorder's first frames (exposure settles)
    mean, swing = lum.mean(), lum.max() - lum.min()
    if mean < 40:
        return f"dark (mean {mean:.0f})"
    x = lum - lum.mean()
    if x.std() < 4:
        return f"STATIC lit (mean {mean:.0f}, sd {x.std():.1f})"
    n = len(x)
    freqs = np.fft.rfftfreq(n, d=1 / 60.0)
    power = np.abs(np.fft.rfft(x * np.hanning(n))) ** 2
    band = (freqs > 0.25) & (freqs < 12.0)
    if not band.any():
        return f"STATIC lit (mean {mean:.0f})"
    pk = np.argmax(np.where(band, power, 0))
    share = power[pk] / max(power[band].sum(), 1e-9)
    f0 = freqs[pk]
    if share < 0.22:                                # energy smeared across the band => noise, not rhythm
        return f"STATIC lit (mean {mean:.0f}, sd {x.std():.1f}, no dominant freq)"
    hi, lo = lum.max(), lum.min()
    near_ends = ((lum > hi - 0.25 * swing) | (lum < lo + 0.25 * swing)).mean()
    shape = "BLINK" if near_ends > 0.70 else "BREATHE"
    duty = (lum > (hi + lo) / 2).mean()
    return (f"{shape} {f0:.2f} Hz (period {1/f0:.2f}s), duty {duty*100:.0f}%, "
            f"peak share {share*100:.0f}%, swing {swing:.0f} on mean {mean:.0f}")


async def main():
    addr, rois_path, which = sys.argv[1], sys.argv[2], sys.argv[3]
    roi_name = sys.argv[4] if len(sys.argv) > 4 else ("LED2" if which == "gled" else "HS_C")
    x, y, w, h = json.load(open(rois_path))[roi_name]

    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    await mgr.connect(addr, "g")
    try:
        for fr in B.arming_frames(40, 1, sirs=[B.SIR_PLAIN]):
            await mgr.send("g", fr, reply_window_ms=140)
            await asyncio.sleep(0.18)

        # optional 5th arg: a comma-separated list of token values, to re-check one suspect value
        # rather than re-running the whole enum.
        vals = [int(v) for v in sys.argv[5].split(",")] if len(sys.argv) > 5 else list(range(11))
        if which == "gled":
            cases = [(f"$GLED,3,3,3,{t4},10,,*", f"t4={t4}") for t4 in vals]
        else:
            cases = [(f"$HLED,3,{t2},300,300,10,5,*", f"t2={t2}") for t2 in vals]

        print(f"=== {which.upper()} effect enum, from {SECS}s of video, roi {roi_name} ===")
        print("    (a still frame cannot tell these apart -- it samples one arbitrary phase)\n")
        for frame, label in cases:
            await mgr.send("g", "$GLED,,,,5,,,*", reply_window_ms=120)
            await mgr.send("g", "$HLED,,6,,,,,*", reply_window_ms=120)
            await asyncio.sleep(0.4)
            await mgr.send("g", frame, reply_window_ms=140)
            await asyncio.sleep(0.25)
            print(f"   {label:<7} {frame:<28} {describe(record_roi(x, y, w, h))}", flush=True)
    finally:
        await mgr.send("g", "$GLED,,,,5,,,*", reply_window_ms=200)
        await mgr.send("g", "$HLED,,6,,,,,*", reply_window_ms=200)
        await mgr.send("g", "$CLEAR,*", reply_window_ms=200)
        try:
            await mgr.disconnect("g")
        except Exception:
            pass


asyncio.run(main())
