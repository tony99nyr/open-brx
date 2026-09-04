"""Measure LED flash brightness OBJECTIVELY with the phone camera, driving the gun through the GUN STAGE.

Why: the 2026-09-04 headset ladder ran on the operator's eyes ("orders of magnitude brighter", "i cant tell")
and the ledcam rule stands -- a machine sends, a human watches, and the two are never synchronised. This tool
records the phone's camera preview (`screenrecord`) for the whole run, sends each candidate frame through the
stage's `raw` action at a KNOWN offset, fires the emitter for a NATIVE reference (the firmware's own hit flash),
then measures per-video-frame brightness and reports the peak that followed each send. Same-video, so the
native flash and ours are measured with one exposure.

Setup (operator): camera app open (`adb shell am start -a android.media.action.STILL_IMAGE_CAMERA`), aimed at
the headset so BOTH LEDs are in frame, exposure pulled DOWN until the room is black (ledcam.py header), phone
propped still. Screen brightness/timeouts pinned (see ledcam.py).

Usage (WSL, uses WSL's paired adb + the running stage on the Windows host):
    python led_flashcam.py run  [--stage http://192.168.16.1:8790] [--serial 192.168.0.48:42183] [--out dir]
                                 [--frames '$LED,9,1,1,1,*' '$HLED,3,4,90,90,10,15,*' ...] [--gap 3.0] [--native]
    python led_flashcam.py analyze <video.mp4> <schedule.json>
`run` = record + send + pull + analyze. `--native` fires the emitter (stage IR shot) as the reference event.
Output: a table  offset_s  frame  peak_luma  peak_area_px  and the video + schedule kept in --out.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys
import time
import urllib.request

ADB = "/home/tony/Android/Sdk/platform-tools/adb"
DEFAULT_FRAMES = ['$LED,9,1,1,1,*', '$LED,0,1,1,1,*', '$HLED,3,4,90,90,10,15,*', '$HLED,3,2,100,100,10,2,*', '$HLED,3,0,,,10,,*']


def adb(serial, *args, timeout=60):
    return subprocess.run([ADB, "-s", serial, *args], capture_output=True, text=True, timeout=timeout)


def stage_do(base, body: dict):
    req = urllib.request.Request(base.rstrip("/") + "/api/do", data=json.dumps(body).encode(), headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


def record(serial, secs, remote="/sdcard/flashcam.mp4"):
    """Start screenrecord in the background; returns the Popen. screenrecord takes 1-2 s to start (known), so
    every offset below is measured from the FIRST frame we can see move, not from the process start."""
    return subprocess.Popen([ADB, "-s", serial, "shell", "screenrecord", "--time-limit", str(int(secs)), "--bit-rate", "8000000", remote],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def run(args):
    out = pathlib.Path(args.out); out.mkdir(parents=True, exist_ok=True)
    frames = args.frames or DEFAULT_FRAMES
    total = 4 + len(frames) * args.gap + (args.gap if args.native else 0) + 3
    print(f"recording {int(total)} s on {args.serial}; {len(frames)} frames every {args.gap} s" + (" + native shot" if args.native else ""), flush=True)
    rec = record(args.serial, total)
    t0 = time.monotonic()
    time.sleep(4.0)                                   # let screenrecord start (1-2 s) and settle
    stage_do(args.stage, {"action": "raw", "frames": ["$HLED,,6,,,,,*"]})
    schedule = []
    for f in frames:
        time.sleep(args.gap)
        t = time.monotonic() - t0
        stage_do(args.stage, {"action": "raw", "frames": [f], "confirm": True})
        schedule.append({"t": round(t, 3), "frame": f})
        print(f"  {t:6.2f}s  {f}", flush=True)
    if args.native:
        time.sleep(args.gap)
        t = time.monotonic() - t0
        stage_do(args.stage, {"action": "ir", "kind": "shot"})
        schedule.append({"t": round(t, 3), "frame": "NATIVE (emitter shot)"})
        print(f"  {t:6.2f}s  NATIVE emitter shot", flush=True)
    rec.wait(timeout=total + 15)
    local = out / f"flashcam-{time.strftime('%H%M%S')}.mp4"
    adb(args.serial, "pull", "/sdcard/flashcam.mp4", str(local), timeout=120)
    sched = local.with_suffix(".json"); sched.write_text(json.dumps({"t0_note": "offsets from screenrecord process start", "schedule": schedule}, indent=1))
    print(f"video {local} ({local.stat().st_size // 1024} KB)")
    analyze(str(local), str(sched), args.gap)


def luma_series(video: str):
    """Per-frame (t, max_luma, bright_px) via ffmpeg -> raw grey frames at 8 fps-scaled 160px wide (fast, enough for a flash)."""
    import numpy as np
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,nb_frames,duration", "-of", "json", video], capture_output=True, text=True)
    info = json.loads(probe.stdout)["streams"][0]
    w = 160; h = max(2, int(info["height"] * w / info["width"]) // 2 * 2)
    # screenrecord's r_frame_rate tag is bogus (90000/1); the frames are variable-rate, so use count / duration
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", video, "-vf", f"scale={w}:{h},format=gray", "-f", "rawvideo", "-"], stdout=subprocess.PIPE)
    frames = []
    while True:
        buf = p.stdout.read(w * h)
        if len(buf) < w * h:
            break
        a = np.frombuffer(buf, dtype=np.uint8).reshape(h, w)
        a = a[int(h * 0.15):int(h * 0.85), :]                      # the middle of the preview: skip the camera app's white UI bars
        frames.append((int(a.max()), int((a > 200).sum()), int(a.mean())))
    dur = float(info.get("duration") or 0) or (len(frames) / 30.0)
    fps = len(frames) / dur if dur else 30.0
    series = [(i / fps, mx, px) for i, (mx, px, _mean) in enumerate(frames)]
    return series, fps


def analyze(video: str, schedule_path: str, gap: float = 3.0):
    series, fps = luma_series(video)
    sched = json.loads(pathlib.Path(schedule_path).read_text())["schedule"]
    base = sorted(s[1] for s in series)[len(series) // 10] if series else 0
    print(f"\n{len(series)} video frames @ {fps:.1f} fps · dark baseline max-luma {base}")
    print(f"{'offset':>7}  {'peak':>4}  {'px>200':>6}  {'at':>6}  frame")
    for ev in sched:
        # screenrecord starts 1-2 s after the process; search a window that tolerates that (t-2.5 .. t+gap-0.5)
        win = [s for s in series if ev["t"] - 2.5 <= s[0] <= ev["t"] + gap - 0.5]
        if not win:
            print(f"{ev['t']:7.2f}  (no video frames in window)  {ev['frame']}"); continue
        peak = max(win, key=lambda s: (s[1], s[2]))
        print(f"{ev['t']:7.2f}  {peak[1]:4d}  {peak[2]:6d}  {peak[0]:6.2f}  {ev['frame']}")
    print("\nRead: peak = brightest pixel (0-255; 255 = saturated, then compare px>200 = how much of the frame saturated).")


def main(argv=None):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run"); r.add_argument("--stage", default="http://192.168.16.1:8790"); r.add_argument("--serial", default="192.168.0.48:42183")
    r.add_argument("--out", default=str(pathlib.Path.home() / ".brx-mcp" / "flashcam")); r.add_argument("--frames", nargs="*"); r.add_argument("--gap", type=float, default=3.0)
    r.add_argument("--native", action="store_true")
    a = sub.add_parser("analyze"); a.add_argument("video"); a.add_argument("schedule"); a.add_argument("--gap", type=float, default=3.0)
    args = ap.parse_args(argv)
    if args.cmd == "run":
        run(args)
    else:
        analyze(args.video, args.schedule, args.gap)


if __name__ == "__main__":
    main()
