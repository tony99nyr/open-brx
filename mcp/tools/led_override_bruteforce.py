"""Can we BRUTE-FORCE our colour over the native animation on a spawned gun? Self-aligning.

The open question after 2026-09-02: our `$GLED` paint appears on a spawned gun but alternates with
the gun's own animation. A single paint and a 4 Hz repaint both looked partial -- but those runs were
scored over a whole clip that was mostly native-only, and `screenrecord` starts 1-2 s late, so the
duty cycle INSIDE the paint window was never actually measured. No design decision should rest on
that, so this measures it properly.

SELF-ALIGNING BY COLOUR. Each phase paints a DIFFERENT hue, so the phases are found in the video by
what they look like rather than by wall-clock timestamps we cannot align:

    phase 1  native only          expect BLUE  (the team colour)
    phase 2  paint GREEN once     how much of this window is green?
    phase 3  hammer RED flat out  how much of this window is red?

If phase 3's duty is far above phase 2's, hammering wins and a solid in-game colour is available at
the cost of BLE traffic. If they match, repaint rate is not the lever and our colour is inherently
interleaved.

Usage: python led_override_bruteforce.py <addr> [rois.json] [hammer_gap_s=0.0]
"""
import asyncio
import json
import subprocess
import sys
import time

import numpy as np

import bench_common as B

WSL = ["wsl.exe", "-d", "Ubuntu-24.04", "-e", "bash", "-c"]
ADB = "/home/tony/Android/Sdk/platform-tools/adb"
FFMPEG = "/home/tony/.local/bin/ffmpeg"
REC_W, REC_H = 1204, 540
SCALE = REC_W / 2410.0
SECS, FPS = 20, 60
PHASE_S = 4.5


def classify(rgb):
    """blue / green / red / other, per frame. Wide margins: we only need to tell three hues apart."""
    r, g, b = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    return {"red": (r > g + 12) & (r > b + 12),
            "green": (g > r + 12) & (g > b + 12),
            "blue": (b > r + 12) & (b > g + 12)}


async def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    addr = sys.argv[1]
    rois_path = sys.argv[2] if len(sys.argv) > 2 else r"C:/Users/Tony/.brx-mcp/rois.json"
    gap = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0
    x, y, w, h = json.load(open(rois_path))["LED1"]

    proc = subprocess.Popen(WSL + [f"{ADB} shell screenrecord --time-limit {SECS} "
                                   f"--size {REC_W}x{REC_H} /sdcard/_bf.mp4"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    async with B.connected(mgr, (addr, "v")):
        for fr in B.arming_frames(40, 1):
            await mgr.send("v", fr, reply_window_ms=0)
            await asyncio.sleep(0.1)
        await mgr.send("v", B.AR, reply_window_ms=0)
        await asyncio.sleep(0.15)
        await mgr.send("v", "$SPAWN,,*", reply_window_ms=0)
        await asyncio.sleep(4.0)

        print(f"   phase 1: native only ({PHASE_S}s)", flush=True)
        await asyncio.sleep(PHASE_S)

        print(f"   phase 2: ONE green paint ({PHASE_S}s)", flush=True)
        await mgr.send("v", "$GLED,3,3,3,0,10,,*", reply_window_ms=0)
        await asyncio.sleep(PHASE_S)

        n = 0
        print(f"   phase 3: HAMMER red, gap={gap}s ({PHASE_S}s)", flush=True)
        end = time.time() + PHASE_S
        while time.time() < end:
            await mgr.send("v", "$GLED,0,0,0,0,10,,*", reply_window_ms=0)
            n += 1
            if gap:
                await asyncio.sleep(gap)
        print(f"   sent {n} frames in {PHASE_S}s = {n/PHASE_S:.0f}/s", flush=True)

    proc.wait(timeout=180)
    time.sleep(1.0)
    subprocess.run(WSL + [
        f"{ADB} pull -a /sdcard/_bf.mp4 /mnt/c/Users/Tony/.brx-mcp/_bf.mp4 >/dev/null && "
        f"{FFMPEG} -v error -y -i /mnt/c/Users/Tony/.brx-mcp/_bf.mp4 "
        f"-vf crop={max(2,int(w*SCALE))}:{max(2,int(h*SCALE))}:{int(x*SCALE)}:{int(y*SCALE)},"
        f"scale=1:1 -f rawvideo -pix_fmt rgb24 /mnt/c/Users/Tony/.brx-mcp/_bf.raw"],
        capture_output=True, timeout=300)
    d = open(r"C:\Users\Tony\.brx-mcp\_bf.raw", "rb").read()
    m = len(d) // 3
    rgb = np.frombuffer(d[:m * 3], dtype=np.uint8).reshape(m, 3).astype(float)
    c = classify(rgb)
    print(f"\n   {m} frames ({m/FPS:.1f}s)")

    # Find each phase by ITS OWN colour: the longest green stretch is phase 2, the longest red
    # stretch is phase 3. No wall-clock alignment needed, which is what broke the earlier attempt.
    # PER-SECOND, not a best-window search. The window search picked t=0 on the first run: the
    # gun's own arm/spawn animation contains red-dominant frames, and a 4.5 s window smears across
    # the phase boundary. A per-second table shows the phases plainly and cannot be fooled that way.
    print(f"\n   t(s)  red%  green%  blue%   meanRGB   (phases are identifiable by colour)")
    for sec in range(m // FPS):
        a, z = sec * FPS, (sec + 1) * FPS
        print(f"   {sec:4d}  {c['red'][a:z].mean()*100:4.0f}  {c['green'][a:z].mean()*100:5.0f}"
              f"  {c['blue'][a:z].mean()*100:5.0f}   {[round(v) for v in rgb[a:z].mean(axis=0)]}")

    def window(mask, span):
        k = int(span * FPS)
        if m < k:
            return None
        conv = np.convolve(mask.astype(float), np.ones(k), "valid")
        i = int(np.argmax(conv))
        return i, i + k, conv[i] / k

    best_red = max((c["red"][s*FPS:(s+1)*FPS].mean() for s in range(m // FPS)), default=0)
    print(f"\n   BEST SINGLE SECOND of hammered red: {best_red*100:.0f}% of frames")
    print("   (a single paint measured ~18%; if hammering is far higher, repaint rate is the lever)")
    for name, span in (("green (one paint)", 1.0), ("red (hammered)", 1.0)):
        key = "green" if name.startswith("green") else "red"
        r = window(c[key], span)
        if r is None:
            print(f"   {name:20s} clip too short")
            continue
        a, b, duty = r
        print(f"   {name:20s} best {span:.1f}s window at t={a/FPS:5.1f}s -> "
              f"OUR COLOUR IN {duty*100:4.0f}% OF FRAMES")
    print(f"   native blue overall: {c['blue'].mean()*100:.0f}% of the whole clip")


if __name__ == "__main__":
    asyncio.run(main())
