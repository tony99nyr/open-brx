"""PASSIVE watcher: fire witnessed IR at a tagger running its OWN native game, send it NOTHING.

The discriminator this exists for: GAMMA went deaf under OUR config (0/22 witnessed shots, headset
showing no flash, while ALPHA took hits from the same emitter at the same moment). If it registers
normally in a NATIVE game with our frames never applied, the fault is in something we send. If it
stays deaf, our frames are exonerated and the unit is the problem.

STRICTLY READ-ONLY. `ConnectionManager.connect()` opens the link and subscribes to notifications and
writes nothing (verified in ble.py), and this tool never calls `send`. No $SPAWN, no $CLEAR, no arming
frames -- the operator owns the game on the gun.

⚠ TEAM GATING IS THE TRAP HERE. A shot from the victim's OWN team is rejected and produces NO $HIR at
all, which looks exactly like deafness. In a native FFA we do not know what team the gun took, so the
shooter team is CYCLED 0..3 -- at least three of every four shots must read as an enemy whatever team
it has. A run where only the team-N shots fail is not a deaf gun, it is a gun on team N.

Usage: python native_watch.py <addr> [emitter_com=COM8] [shots=12] [receiver_com=COM7] [mag=1]
"""
import asyncio
import sys
import time

import serial

import bench_common as B
from f11_ab import SENSOR, witnessed, word
from brx_mcp.irbridge import IRBridge


async def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    addr = sys.argv[1]
    com = sys.argv[2] if len(sys.argv) > 2 else "COM8"
    nshot = int(sys.argv[3]) if len(sys.argv) > 3 else 12
    recv_com = sys.argv[4] if len(sys.argv) > 4 else "COM7"
    mag = int(sys.argv[5]) if len(sys.argv) > 5 else 1

    tx = serial.Serial(com, 115200, timeout=0.3)
    time.sleep(1.6)
    tx.reset_input_buffer()
    rx = IRBridge(port=recv_com)
    time.sleep(1.2)
    B.arm_receiver(rx)

    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    by_team = {}
    async with B.connected(mgr, (addr, "v")):
        print(f"connected READ-ONLY -- nothing will be sent to the gun. mag={mag}\n", flush=True)
        for i in range(nshot):
            team = i % 4
            mark = mgr.get_events("v", since_seq=0).get("last_seq", 0)
            rx._ser.reset_input_buffer()
            tx.write(("TX " + word(mag, 0, team, pid=42) + "\n").encode())
            tx.flush()
            await asyncio.sleep(1.0)
            w = witnessed(rx._readlines(0.45))
            evs = [e.get("raw", "").strip() for e in
                   mgr.get_events("v", since_seq=mark).get("events", []) if isinstance(e, dict)]
            hir = [e for e in evs if e.startswith("$HIR")]
            other = [e for e in evs if not e.startswith("$HIR")]
            if hir:
                try:
                    sen = SENSOR.get(int(hir[-1].split(",")[1]), "?")
                except Exception:
                    sen = "?"
                got = f"HIT({sen})"
            else:
                got = "  --  "
            rec = by_team.setdefault(team, [0, 0])
            if w or hir:
                rec[1] += 1
                rec[0] += bool(hir)
            print(f"  shot {i+1:2d}  shooter-team={team}  {got}   "
                  f"witness={'OK ' if w else 'silent'}"
                  + (f"   {other[:2]}" if other else ""), flush=True)

    print("\n  per shooter-team (confirmed-fired shots only):")
    for t in sorted(by_team):
        h, f = by_team[t]
        print(f"     team {t}: {h}/{f}")
    tot_h = sum(v[0] for v in by_team.values())
    tot_f = sum(v[1] for v in by_team.values())
    print(f"     TOTAL : {tot_h}/{tot_f}")
    print("\n  !!  READ THIS BEFORE BELIEVING ANY ZERO ABOVE.")
    print("  `$HIR` DOES NOT REACH BLE IN A NATIVE GAME. A natively-running gun registers hits,")
    print("  flashes its headset and takes damage while sending NOTHING over Bluetooth. This tool")
    print("  therefore CANNOT detect a hit here, and a total of 0/N is its NORMAL output on a")
    print("  perfectly healthy gun. It measured 0/11 on 2026-09-02 while the operator watched the")
    print("  gun get hit every single time, and that reading was briefly written up as deafness.")
    print("\n  Only two readings mean anything:")
    print("    ANY registrations at all -> the gun is in OUR game state, not a native one.")
    print("    exactly ONE team fails   -> that is its own team. Friendly fire, NOT deafness.")
    print("  Score a native game BY EYE (headset flash) or with hit_flash.py. Never from this zero.")
    rx.close()
    tx.close()


if __name__ == "__main__":
    asyncio.run(main())
