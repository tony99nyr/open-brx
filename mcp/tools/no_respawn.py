"""Does $SPAWN cause the fade? Keep the victim alive with IR HEALS instead of respawning.

Operator hypothesis, and it indicts our own method: every fade measurement this session sent $SPAWN
before each burst, so if $SPAWN degrades the headset then the measurement was causing the effect it
measured. That is exactly the kind of self-inflicted result this project has been bitten by before.

This never sends $SPAWN after the initial arm. Instead it tops the victim back up with an IR heal:
fn 9 is a bench-confirmed full restore (hp +20, armour +70), delivered from the victim's OWN team
(support functions are own-team only, damage is enemy-only -- the polarity rule).

  $SIR,0,0,,1   proto 0, ENEMY team -> plain damage, the shots under test
  $SIR,1,0,,9   proto 1, OWN team   -> full restore, the top-up

If the hit rate stays flat here but fades when respawning, $SPAWN is implicated. If it fades either
way, $SPAWN is exonerated and the cause is elsewhere.

Usage: python no_respawn.py <victim_addr> [emitter_com=COM8] [minutes=6]
"""
import asyncio
import sys
import time

import serial

import bench_common as B
from brx_mcp.irbridge import payload_parity

VICTIM_TEAM, ENEMY_TEAM, PID = 1, 2, 40
SHOTS = 4


def word(mag, proto, team, sub=0, pid=42, crit=0):
    f = lambda v, n: format(v & ((1 << n) - 1), "0%db" % n)
    pay = f(proto, 4) + f(pid, 6) + f(team, 2) + f(mag, 8) + f(crit, 1) + f(sub, 2)
    return pay + payload_parity(pay)


def pools(fr):
    try:
        t = fr.split(",")
        return int(t[1]), int(t[2]), int(t[3])
    except Exception:
        return None


async def main():
    addr = sys.argv[1]
    com = sys.argv[2] if len(sys.argv) > 2 else "COM8"
    minutes = float(sys.argv[3]) if len(sys.argv) > 3 else 6.0

    from brx_mcp.ble import ConnectionManager
    tx = serial.Serial(com, 115200, timeout=0.3)
    time.sleep(1.6)
    tx.reset_input_buffer()
    mgr = ConnectionManager()
    await mgr.connect(addr, "v")

    async def snd(f, s=0.25):
        await mgr.send("v", f, reply_window_ms=150)
        await asyncio.sleep(s)

    def fire(w, n=1, gap=0.9):
        for _ in range(n):
            tx.write(("TX " + w + "\n").encode())
            tx.flush()
            time.sleep(gap)

    print("=== does $SPAWN cause the fade? (no $SPAWN after the initial arm) ===")
    print("   victim kept alive with IR heals (fn 9, own team) instead of respawning\n")
    print("   %-8s %-10s %-22s %s" % ("t+min", "hits", "pools after", "domes"))
    t0 = time.time()
    try:
        # arm with BOTH rows: plain damage on proto 0, full-restore heal on proto 1
        for fr in ["$VOL,60,0,*", "$CLEAR,*", "$START,*", B.GSET, B.PSET.format(pid=PID),
                   B.SIR_PLAIN, "$SIR,1,0,,9,0,0,1,,*", f"$TID,{VICTIM_TEAM},*", B.AR]:
            await snd(fr)
        await snd("$SPAWN,,*", 1.3)          # the ONLY spawn in the whole run
        await snd("$AMMO,0,32,192,1,*")
        await snd("$BMAP,0,0,,,,,*")

        while time.time() - t0 < minutes * 60:
            seq = mgr.get_events("v", since_seq=0).get("last_seq", 0)
            fire(word(20, 0, ENEMY_TEAM), SHOTS)
            await asyncio.sleep(1.2)
            evs = [e.get("raw", "").strip() for e in
                   mgr.get_events("v", since_seq=seq).get("events", []) if isinstance(e, dict)]
            hir = [e for e in evs if e.startswith("$HIR")]
            hp = [e for e in evs if e.startswith("$HP")]
            p = pools(hp[-1]) if hp else None
            doms = sorted({h.split(",")[1] for h in hir})
            print("   %-8.1f %-10s %-22s %s"
                  % ((time.time() - t0) / 60, "%d/%d" % (len(hir), SHOTS), str(p), doms or "-"),
                  flush=True)
            # top up with heals, from the victim's OWN team -- no $SPAWN
            fire(word(60, 1, VICTIM_TEAM), 3)
            await asyncio.sleep(max(0.0, 30.0 - SHOTS * 0.9 - 3.0 - 2.7))
    finally:
        await snd("$CLEAR,*", 0.2)
        try:
            await mgr.disconnect("v")
        except Exception:
            pass
        tx.close()


asyncio.run(main())
