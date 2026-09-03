"""F1 config hunt: is there a setting that turns on the gun's NATIVE health gauge in OUR games?

In a NATIVE game the three gun LEDs are a segmented health bar: three lit at full health, dropping to
one as health falls (observed 2026-08-30, native FFA). In OUR compiled games they are not -- damaged
to armour 0 / HP 15 of 45, all three stayed lit. We can now paint a gauge ourselves, but the native
one would cost ZERO BLE writes and survive with no host involvement, which at ten players in a
firefight is a real difference. So it is worth one bounded hunt.

Method: for each config variant, arm, spawn, measure the three LEDs at FULL health, damage to ~30%,
measure again. A gauge shows up as segments going dark. We send NO $GLED at all, so what the camera
sees is entirely the gun's own behaviour.

Each state is sampled several times and averaged, because a spawned gun is always animating: a single
still of a pulsing LED says nothing (that mistake has been made twice today).

Candidates, and why:
  $GSET t8  gameMods        -- an unmapped bitfield, the obvious home for a display option
  $GSET t4  autoAmbientLight-- named for light behaviour
  $GSET t5  gyroscope       -- cheap to include while we are here
  $PSET t2, t6              -- both swept as inert on damage/pools/crit/gating, and the bench notes
                               say "if they do anything it is audio or LED". That is a real lead.

Usage: python gauge_hunt.py <victim_addr> [emitter_com=COM8]
"""
import asyncio
import subprocess
import sys
import time

import numpy as np
import serial
from PIL import Image

import bench_common as B
from brx_mcp.irbridge import payload_parity

W = "/home/tony/Android/Sdk/platform-tools/adb"
S = r"C:\Users\Tony\.brx-mcp\_shot.png"
import json
ROIS = json.load(open(r"C:/Users/Tony/.brx-mcp/rois.json"))
KEYS = ["LED1", "LED2", "LED3"]
VICTIM_TEAM, ENEMY_TEAM, PID = 1, 2, 40


def word(mag, proto, team, sub=0, pid=42, crit=0):
    f = lambda v, n: format(v & ((1 << n) - 1), "0%db" % n)
    pay = f(proto, 4) + f(pid, 6) + f(team, 2) + f(mag, 8) + f(crit, 1) + f(sub, 2)
    return pay + payload_parity(pay)


def grab():
    subprocess.run(["wsl.exe", "-d", "Ubuntu-24.04", "-e", "bash", "-c",
                    f"{W} exec-out screencap -p > /mnt/c/Users/Tony/.brx-mcp/_shot.png"],
                   capture_output=True, timeout=90)
    im = np.asarray(Image.open(S).convert("RGB"), dtype=float)

    if im.mean() < 12:
        raise SystemExit(
            "ABORT: the phone screen is OFF or LOCKED -- every reading would be of a black frame.\n"
            "  This is NOT caught by the CONTROL roi: a locked screen darkens the canary too, so the\n"
            "  run looks internally consistent and produces a table of pure fiction. It happened on\n"
            "  2026-09-02 and nearly went into the docs as 'the gun dims its LEDs with health'.\n"
            "  Unlock the phone, reopen the camera, and re-check the ROIs before re-running.")
    return im


def segs(n=5):
    """Mean luminance per LED over n samples -- a spawned gun animates, so one sample says nothing."""
    acc = np.zeros(len(KEYS))
    for _ in range(n):
        im = grab()
        acc += [im[y:y + h, x:x + w].reshape(-1, 3).mean() for (x, y, w, h) in (ROIS[k] for k in KEYS)]
    return np.round(acc / n, 1)


def pools(fr):
    try:
        t = fr.split(",")
        return int(t[1]), int(t[2]), int(t[3])
    except Exception:
        return None


async def main():
    addr = sys.argv[1]
    com = sys.argv[2] if len(sys.argv) > 2 else "COM8"
    tx = serial.Serial(com, 115200, timeout=0.3)
    time.sleep(1.6)
    tx.reset_input_buffer()

    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    await mgr.connect(addr, "v")

    async def snd(f, s=0.18):
        await mgr.send("v", f, reply_window_ms=140)
        await asyncio.sleep(s)

    async def damage_to(target=40, cap=14):
        """Keep firing until hp+armour is actually LOW, and report what it reached.

        A fixed shot count is not enough: the rig drops shots. The first attempt at this test fired 4
        and landed 1, leaving the victim at 83% health -- a gauge would not move at 83%, so that row
        looked like a clean negative when it was really a missed measurement.
        """
        last, fired = None, 0
        while fired < cap:
            seq = mgr.get_events("v", since_seq=0).get("last_seq", 0)
            tx.write(("TX " + word(20, 0, ENEMY_TEAM) + "\n").encode())
            tx.flush()
            fired += 1
            await asyncio.sleep(1.0)
            evs = [e.get("raw", "").strip() for e in
                   mgr.get_events("v", since_seq=seq).get("events", []) if isinstance(e, dict)]
            hp = [e for e in evs if e.startswith("$HP")]
            if hp:
                last = pools(hp[-1])
            if last and last[0] <= 0:
                return last, fired, "DIED"
            if last and (last[0] + last[1]) <= target:
                return last, fired, "LOW"
        return last, fired, "NOT-LOW-ENOUGH"

    VARIANTS = [("BASELINE (what we ship)", None, None)]
    for v in (1, 2, 4, 8, 16):
        VARIANTS.append((f"$GSET t8 gameMods={v}", f"$GSET,0,0,1,0,1,0,50,{v},*", None))
    VARIANTS += [("$GSET t4 autoAmbient=1", "$GSET,0,0,1,1,1,0,50,1,*", None),
                 ("$GSET t5 gyro=0", "$GSET,0,0,1,0,0,0,50,1,*", None)]
    for v in (1, 2):
        VARIANTS.append((f"$PSET t2={v}", None, v))

    print("=== F1 config hunt: does anything switch on the NATIVE gauge? ===")
    print("   no $GLED is sent; the camera sees only the gun's own behaviour")
    print("   a gauge = segments GOING DARK when health drops\n")
    print("   %-26s %-22s %-22s %s" % ("variant", "full health L1/L2/L3", "after damage", "verdict"))
    try:
        for label, gset, pset_t2 in VARIANTS:
            ps = B.PSET.format(pid=PID)
            if pset_t2 is not None:
                p = ps.split(",")
                p[2] = str(pset_t2)
                ps = ",".join(p)
            frames = ["$VOL,60,0,*", "$CLEAR,*", "$START,*", gset or B.GSET, ps,
                      B.SIR_PLAIN, f"$TID,{VICTIM_TEAM},*", B.AR,
                      "$AMMO,0,32,192,1,*", "$BMAP,0,0,,,,,*"]
            for fr in frames:
                await snd(fr)
            await snd("$SPAWN,,*", 2.0)
            full = segs()
            hp, fired, state = await damage_to()
            if hp is None or state != "LOW":
                print("   %-26s %-22s %-22s VOID (%s after %d shots, pools %s)"
                      % (label, str(full), "-", state, fired, hp), flush=True)
                continue
            hurt = segs()
            # Compare each LED against ITS OWN full-health value, not against the others. The three
            # ROIs do not sit identically on their cores (56 / 19 / 123 for an identical green), so an
            # absolute drop is meaningless. A gauge kills a SEGMENT: that segment's ratio collapses
            # while its neighbours stay near 1. Ratios are immune to unequal boxes.
            ratio = np.round(hurt / np.maximum(full, 1e-6), 2)
            spread = float(ratio.max() - ratio.min())
            verdict = ("GAUGE? ratios %s spread %.2f" % (ratio, spread)) if spread > 0.45 \
                else "no gauge (ratios %s)" % ratio
            print("   %-26s %-20s %-20s %s   pools %s" % (label, str(full), str(hurt), verdict, hp),
                  flush=True)
    finally:
        # ⚠️ Do NOT end on a bare `$CLEAR`. It WIPES the `$SIR` table, and a gun with no rows
        # silently ignores every hit while reporting alive and healthy (F11, bench-proven
        # 2026-09-02). This tool used to leave the victim unhittable for whatever ran next, which is
        # exactly how a "deaf tagger" gets manufactured between experiments. Re-arm the table.
        await snd("$CLEAR,*", 0.2)
        for _sir in B.SIRS:
            await snd(_sir, 0.1)
        try:
            await mgr.disconnect("v")
        except Exception:
            pass
        tx.close()


asyncio.run(main())
