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
    sched = local.with_suffix(".json"); sched.write_text(json.dumps({"t0_note": "offsets from screenrecord process start", "secs": total, "schedule": schedule}, indent=1))
    print(f"video {local} ({local.stat().st_size // 1024} KB)")
    analyze(str(local), str(sched), args.gap)


def change_series(video: str, secs: float):
    """Per-video-frame CHANGE vs the run's median frame (ambient, the TV and the camera UI cancel out):
    core = pixels > 200 above median (the blown-out LED core + its bloom), mid = pixels > 100. Frame-wide
    counts at >40 are contaminated by the camera re-metering on a bright static paint, so they are not used."""
    import numpy as np
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", video], capture_output=True, text=True)
    info = json.loads(probe.stdout)["streams"][0]
    w = 270; h = max(2, int(info["height"] * w / info["width"]) // 2 * 2)
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", video, "-vf", f"scale={w}:{h},format=gray", "-f", "rawvideo", "-"], stdout=subprocess.PIPE)
    frames = []
    while True:
        buf = p.stdout.read(w * h)
        if len(buf) < w * h:
            break
        frames.append(np.frombuffer(buf, dtype=np.uint8).reshape(h, w).astype(np.int16))
    F = np.stack(frames); n = len(F)
    dprobe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video], capture_output=True, text=True)
    dur = float((dprobe.stdout or "0").strip() or 0) or secs
    fps = n / dur                                           # screenrecord's rate tag is bogus; frames / real duration
    pos = np.clip(F - np.median(F, axis=0), 0, None).reshape(n, -1)
    core = (pos > 200).sum(axis=1); mid = (pos > 100).sum(axis=1)
    return [(i / fps, int(core[i]), int(mid[i])) for i in range(n)], fps


def analyze(video: str, schedule_path: str, gap: float = 3.0):
    meta = json.loads(pathlib.Path(schedule_path).read_text())
    sched = meta["schedule"]; secs = float(meta.get("secs") or (sched[-1]["t"] + gap + 3 if sched else 25))
    series, fps = change_series(video, secs)
    print(f"\n{len(series)} video frames @ {fps:.0f} fps · change vs the median frame")
    print(f"{'offset':>7}  {'core>200':>8}  {'mid>100':>7}  {'frames':>6}  {'at':>6}  frame")
    for ev in sched:
        win = [s for s in series if ev["t"] - 1.0 <= s[0] <= ev["t"] + gap - 0.6]     # non-overlapping windows; measured start lag was < 0.1 s
        if not win:
            print(f"{ev['t']:7.2f}  (no video frames in window)  {ev['frame']}"); continue
        peak = max(win, key=lambda s: (s[1], s[2]))
        dur = sum(1 for s in win if s[1] >= peak[1] * 0.5) if peak[1] else 0
        print(f"{ev['t']:7.2f}  {peak[1]:8d}  {peak[2]:7d}  {dur:6d}  {peak[0]:6.2f}  {ev['frame']}")
    print("\nRead: core = blown-out pixels (the LED + its bloom) at the peak; frames = how long it stayed above half the peak (60 fps).")


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
