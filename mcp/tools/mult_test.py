"""Bench 0.1 - settle the DISPUTED fn 36/37 magnitude multipliers, with a control in every trial.

THE DISPUTE. Two of our own datasets disagree: one says fn 36 lands x1.25 and fn 37 x2, the other
says both land x1.0. Four explanatory hypotheses were tested and refuted. Until it is settled we
cannot publish an htk/ttk table, because five shipped weapons key to those rows.

THE DESIGN. One arming, three $SIR rows on the SAME protocol, differing only in subtype:
    $SIR,0,0,,1   subtype 0 -> fn 1   PLAIN DAMAGE = the CONTROL, must read exactly the magnitude
    $SIR,0,1,,36  subtype 1 -> fn 36  the x1.25 claim
    $SIR,0,3,,37  subtype 3 -> fn 37  the x2 claim
Every trial fires the identical word except for the 2 subtype bits, from a full respawn, and reads
the $HP delta. If the control is not exactly the magnitude the trial is void -- that is the whole
point of carrying it.

WHOSE TABLE. The applied function is chosen by the VICTIM's $SIR row, so this answers "what does fn
36 do in OUR table", which is the configuration we ship and the numbers we would publish. It cannot
speak for a native game; that needs a native capture.

Usage: python mult_test.py <victim_addr> [emitter_com=COM8] [trials=3] [magnitude=20]
"""
import asyncio
import sys
import time

import serial

from brx_mcp.irbridge import payload_parity

AR = ("$WEAP,0,,100,0,0,9,0,,,,,,,,190,850,32,384,1400,0,0,100,100,,0,,,"
      "R01,,,,D04,D03,D02,D18,,,,,32,192,75,*")
PSET = ("$PSET,40,0,45,70,150,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,"
        "H06,H55,H13,H21,H02,U15,W71,A10,*")
VICTIM_TEAM, ENEMY_TEAM = 1, 2
CASES = [("fn 1  CONTROL", 0, 1.0), ("fn 36 (x1.25?)", 1, 1.25), ("fn 37 (x2?)", 3, 2.0)]


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
    trials = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    mag = int(sys.argv[4]) if len(sys.argv) > 4 else 20

    from brx_mcp.ble import ConnectionManager
    tx = serial.Serial(com, 115200, timeout=0.3)
    time.sleep(1.6)
    tx.reset_input_buffer()
    mgr = ConnectionManager()
    await mgr.connect(addr, "v")

    async def snd(fr, s=0.16):
        await mgr.send("v", fr, reply_window_ms=140)
        await asyncio.sleep(s)

    async def respawn_full():
        """A trial that starts from unknown pools is not a trial. Spawn until HP reads full."""
        for _ in range(5):
            seq = mgr.get_events("v", since_seq=0).get("last_seq", 0)
            await snd("$SPAWN,,*", 0.7)
            evs = [e.get("raw", "").strip() for e in
                   mgr.get_events("v", since_seq=seq).get("events", []) if isinstance(e, dict)]
            lcd = [e for e in evs if e.startswith("$LCD")]
            if lcd and (p := pools(lcd[-1])) and p[0] >= 45:
                return p
        return None

    async def fire(sub):
        seq = mgr.get_events("v", since_seq=0).get("last_seq", 0)
        tx.write(("TX " + word(mag, 0, ENEMY_TEAM, sub=sub) + "\n").encode())
        tx.flush()
        await asyncio.sleep(1.6)
        evs = [e.get("raw", "").strip() for e in
               mgr.get_events("v", since_seq=seq).get("events", []) if isinstance(e, dict)]
        hp = [e for e in evs if e.startswith("$HP")]
        hir = [e for e in evs if e.startswith("$HIR")]
        return (pools(hp[-1]) if hp else None), len(hir), (hir[-1] if hir else None)

    print(f"=== bench 0.1: fn 36/37 multipliers, magnitude {mag}, {trials} trials ===")
    print("    control = fn 1 on subtype 0; it MUST read exactly the magnitude or the trial is void\n")
    print("    %-16s %-7s %-9s %-8s %s" % ("case", "sub", "delta", "ratio", "verdict"))
    try:
        for fr in ["$CLEAR,*", "$START,*", "$VOL,30,*", "$GSET,0,0,1,0,1,0,50,1,*", PSET, AR,
                   "$SIR,0,0,,1,0,0,1,,*", "$SIR,0,1,,36,0,0,1,,*", "$SIR,0,3,,37,0,0,1,,*",
                   f"$TID,{VICTIM_TEAM},*", "$AMMO,0,32,192,1,*", "$BMAP,0,0,,,,,*"]:
            await snd(fr)
        await asyncio.sleep(0.8)

        totals = {}
        for t in range(trials):
            print(f"    -- trial {t + 1} --")
            for label, sub, claim in CASES:
                before = await respawn_full()
                if not before:
                    print(f"    {label:<16} {sub:<7} VOID (could not confirm full pools)")
                    continue
                after, hits, hirf = await fire(sub)
                if after is None:
                    print(f"    {label:<16} {sub:<7} VOID (no $HP; hits={hits})")
                    continue
                delta = (before[0] + before[1]) - (after[0] + after[1])
                ratio = delta / mag if mag else 0
                verdict = "= magnitude (x1.0)" if abs(ratio - 1) < 0.06 else f"x{ratio:.2f}"
                print(f"    {label:<16} {sub:<7} {delta:<9} {ratio:<8.2f} {verdict}")
                totals.setdefault(label, []).append(delta)

        print("\n    === summary ===")
        ctrl = totals.get("fn 1  CONTROL", [])
        ok = ctrl and all(d == mag for d in ctrl)
        print(f"    control fn 1: {ctrl}  -> {'VALID' if ok else 'INVALID - discard everything below'}")
        for label, _, claim in CASES[1:]:
            ds = totals.get(label, [])
            if not ds:
                continue
            same = len(set(ds)) == 1
            print(f"    {label}: {ds}  {'consistent' if same else 'INCONSISTENT ACROSS TRIALS'}"
                  f"  -> {'multiplier NOT present (= magnitude)' if ds[0] == mag else f'lands {ds[0]/mag:.2f}x'}")
    finally:
        await snd("$CLEAR,*", 0.2)
        try:
            await mgr.disconnect("v")
        except Exception:
            pass
        tx.close()


asyncio.run(main())
