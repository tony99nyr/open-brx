"""See the HIT on camera: detect the headset's green flash, because BLE cannot see a native game.

Why this exists. On 2026-09-02 `native_watch.py` reported 0/11 registered while Tony watched the
headset flash and the gun take hits. `$HIR` only reaches BLE once OUR game state is applied -- a gun
in its own native game registers hits perfectly and says NOTHING over Bluetooth. Every conclusion
drawn from BLE silence about a natively-running gun is therefore worthless, and one was drawn.

So this measures the thing that is actually true in both worlds: the headset flashes green when it
is hit. It records the camera preview while firing witnessed shots, then finds transient GREEN
brightenings in the video.

It does NOT need an ROI. The headset is located by the flash itself: the frame is diced into cells
and the cells whose green channel spikes -- against their own baseline, at a moment we fired -- are
the headset. A pre-set ROI would be one more thing to get wrong, and ROI mistakes have produced
confident fiction on this rig twice.

Nothing is sent to the gun. Safe to run against a native game.

Usage: python hit_flash.py [emitter_com=COM8] [shots=5] [receiver_com=COM7] [mag=1]
"""
import subprocess
import sys
import time

import numpy as np
import serial

from f11_ab import witnessed, word
from brx_mcp.irbridge import IRBridge

WSL = ["wsl.exe", "-d", "Ubuntu-24.04", "-e", "bash", "-c"]
REC_W, REC_H = 1204, 540
ADB = "/home/tony/Android/Sdk/platform-tools/adb"
FFMPEG = "/home/tony/.local/bin/ffmpeg"
GRID_W, GRID_H = 96, 44          # cells; big enough to isolate a headset LED, small enough to be fast
SECS = 16
FPS = 60


def start_record():
    """Kick off screenrecord in the background and return the handle."""
    return subprocess.Popen(WSL + [
        f"{ADB} shell screenrecord --time-limit {SECS} --size {REC_W}x{REC_H} /sdcard/_hit.mp4"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def fetch_grid():
    """Pull the clip and decode it to a (frames, GRID_H, GRID_W, 3) array."""
    subprocess.run(WSL + [
        f"{ADB} pull -a /sdcard/_hit.mp4 /mnt/c/Users/Tony/.brx-mcp/_hit.mp4 >/dev/null && "
        f"{FFMPEG} -v error -y -i /mnt/c/Users/Tony/.brx-mcp/_hit.mp4 "
        f"-vf scale={GRID_W}:{GRID_H} -f rawvideo -pix_fmt rgb24 "
        f"/mnt/c/Users/Tony/.brx-mcp/_hit.raw"], capture_output=True, timeout=300)
    d = open(r"C:\Users\Tony\.brx-mcp\_hit.raw", "rb").read()
    per = GRID_W * GRID_H * 3
    n = len(d) // per
    if n == 0:
        raise SystemExit("ABORT: no video decoded. Is the camera app open and the screen on?")
    return np.frombuffer(d[:n * per], dtype=np.uint8).reshape(n, GRID_H, GRID_W, 3).astype(float)


def main():
    com = sys.argv[1] if len(sys.argv) > 1 else "COM8"
    nshot = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    recv_com = sys.argv[3] if len(sys.argv) > 3 else "COM7"
    mag = int(sys.argv[4]) if len(sys.argv) > 4 else 1

    tx = serial.Serial(com, 115200, timeout=0.3)
    time.sleep(1.6)
    tx.reset_input_buffer()
    rx = IRBridge(port=recv_com)
    time.sleep(1.2)
    rx._ser.write(b"s\n")
    rx._readlines(0.5)
    for _ in range(2):
        rx._ser.write(b"r\n")
        if any("RAW dump ON" in l for l in rx._readlines(0.5)):
            break

    print(f"recording {SECS}s; firing {nshot} shots at mag {mag} ...", flush=True)
    proc = start_record()
    t0 = time.time()
    time.sleep(3.0)                      # screenrecord takes 1-2 s to actually start
    fired = []
    for i in range(nshot):
        rx._ser.reset_input_buffer()
        tx.write(("TX " + word(mag, 0, 2, pid=42) + "\n").encode())
        tx.flush()
        t = time.time() - t0
        time.sleep(0.45)
        w = witnessed(rx._readlines(0.4))
        fired.append((t, w))
        print(f"   shot {i+1} at t={t:5.2f}s   witness={'OK' if w else 'silent'}", flush=True)
        time.sleep(1.8)
    proc.wait(timeout=120)
    time.sleep(1.0)

    g = fetch_grid()
    n = len(g)
    dur = n / FPS
    print(f"\n   decoded {n} frames ({dur:.1f}s at {FPS}fps)")

    # "green flash" = the green channel rising above its OWN baseline while also exceeding the
    # other two channels. Using green-minus-baseline (not absolute green) makes a permanently green
    # pixel invisible and a BRIEF green one loud -- which is exactly the difference between the
    # room and a hit.
    green = g[:, :, :, 1] - 0.5 * (g[:, :, :, 0] + g[:, :, :, 2])
    base = np.median(green, axis=0)
    rise = green - base
    peak = rise.max(axis=0)
    cy, cx = np.unravel_index(int(np.argmax(peak)), peak.shape)
    print(f"   strongest green transient at cell (x={cx}/{GRID_W}, y={cy}/{GRID_H}), "
          f"peak rise {peak[cy, cx]:.0f}")
    if peak[cy, cx] < 12:
        print("\n   NO green flash anywhere in the clip.")
        print("   Either nothing was hit, or the headset is not in the camera frame. Check the")
        print("   frame before concluding anything about the gun.")
        rx.close(); tx.close()
        return

    # the flash region: every cell that spikes with the winner (the headset has several LEDs)
    roi = peak > max(10.0, peak[cy, cx] * 0.4)
    sig = (rise * roi).sum(axis=(1, 2)) / max(1, roi.sum())
    thr = sig.mean() + 3 * sig.std()
    hot = sig > max(thr, 8)
    # group contiguous hot frames into events
    events, run = [], None
    for i, h in enumerate(hot):
        if h and run is None:
            run = i
        elif not h and run is not None:
            events.append((run / FPS, (i - run) / FPS, sig[run:i].max()))
            run = None
    if run is not None:
        events.append((run / FPS, (len(hot) - run) / FPS, sig[run:].max()))
    events = [e for e in events if e[1] >= 0.03]

    print(f"   flash region = {int(roi.sum())} cell(s)")
    print(f"\n   {len(events)} green flash event(s):")
    for t, d, amp in events:
        near = min((abs(t - ft) for ft, _ in fired), default=99)
        tag = "  <- matches a shot" if near < 1.2 else ""
        print(f"      t={t:5.2f}s  dur={d*1000:4.0f}ms  amp={amp:5.0f}{tag}")

    matched = sum(1 for ft, w in fired if w and any(abs(ft - t) < 1.2 for t, _, _ in events))
    conf = sum(1 for _, w in fired if w)
    print(f"\n   HITS SEEN ON CAMERA: {matched}/{conf} confirmed-fired shots produced a flash")
    print("   (this is independent of BLE -- it works on a NATIVE game, where $HIR never arrives)")
    rx.close()
    tx.close()


if __name__ == "__main__":
    main()
