"""Does a TRAILING $SIR token gate the fn 36/37 damage multiplier?

WHY. Two datasets disagreed for a week about whether fn 36 lands x1.25 and fn 37 x2. Both were
internally consistent with a valid fn 1 control, and `brx-protocol.md` records that "a systematic
difference between the runs has not yet been found". One candidate was never tested: the $SIR row's
TRAILING tokens. A row is `$SIR,<proto>,<sub>,<snd>,<fn>,<t5>,<t6>,<t7>,<t8>` and the runs may simply
have armed different tails -- in which case BOTH datasets are right and the multiplier is CONDITIONAL.

Holds everything constant (protocol 0, one magnitude, same emitter, same victim) and varies ONLY the
tail of the fn 36 / fn 37 row. Every variant carries an fn 1 control on subtype 0 whose row never
changes; if that control ever drifts, the variant is void rather than reported.

Usage: python sir_tail_test.py <victim_addr> [emitter_com=COM8] [magnitude=20]
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

# tail = everything after the function id. The shipped table uses "0,0,1,," (see _SIR_TABLE).
TAILS = [("shipped   0,0,1,,", "0,0,1,,"),
         ("all empty ,,,,",    ",,,,"),
         ("t7=0      0,0,0,,", "0,0,0,,"),
         ("t7=2      0,0,2,,", "0,0,2,,"),
         ("t5=1      1,0,1,,", "1,0,1,,"),
         ("t6=1      0,1,1,,", "0,1,1,,"),
         ("short     (none)",  ""),
         ("t8=60     0,0,1,60", "0,0,1,60")]


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
    mag = int(sys.argv[3]) if len(sys.argv) > 3 else 20

    from brx_mcp.ble import ConnectionManager
    tx = serial.Serial(com, 115200, timeout=0.3)
    time.sleep(1.6)
    tx.reset_input_buffer()
    mgr = ConnectionManager()
    await mgr.connect(addr, "v")

    async def snd(fr, s=0.16):
        await mgr.send("v", fr, reply_window_ms=140)
        await asyncio.sleep(s)

    async def arm(tail):
        f36 = f"$SIR,0,1,,36,{tail}*" if tail else "$SIR,0,1,,36,*"
        f37 = f"$SIR,0,3,,37,{tail}*" if tail else "$SIR,0,3,,37,*"
        for fr in ["$CLEAR,*", "$START,*", "$VOL,30,*", "$GSET,0,0,1,0,1,0,50,1,*", PSET, AR,
                   "$SIR,0,0,,1,0,0,1,,*", f36, f37,
                   f"$TID,{VICTIM_TEAM},*", "$AMMO,0,32,192,1,*", "$BMAP,0,0,,,,,*"]:
            await snd(fr)
        await asyncio.sleep(0.7)

    async def respawn_full():
        for _ in range(5):
            seq = mgr.get_events("v", since_seq=0).get("last_seq", 0)
            await snd("$SPAWN,,*", 0.7)
            evs = [e.get("raw", "").strip() for e in
                   mgr.get_events("v", since_seq=seq).get("events", []) if isinstance(e, dict)]
            lcd = [e for e in evs if e.startswith("$LCD")]
            if lcd and (p := pools(lcd[-1])) and p[0] >= 45:
                return p
        return None

    async def shot(sub):
        before = await respawn_full()
        if not before:
            return None
        seq = mgr.get_events("v", since_seq=0).get("last_seq", 0)
        tx.write(("TX " + word(mag, 0, ENEMY_TEAM, sub=sub) + "\n").encode())
        tx.flush()
        await asyncio.sleep(1.6)
        evs = [e.get("raw", "").strip() for e in
               mgr.get_events("v", since_seq=seq).get("events", []) if isinstance(e, dict)]
        hp = [e for e in evs if e.startswith("$HP")]
        if not hp:
            return None
        a = pools(hp[-1])
        return (before[0] + before[1]) - (a[0] + a[1])

    print(f"=== does a trailing $SIR token gate the fn 36/37 multiplier?  magnitude {mag} ===")
    print(f"    expected if the tail is irrelevant: fn36 = {int(mag*1.25)}, fn37 = {mag*2} everywhere\n")
    print("    %-22s %-9s %-9s %-9s %s" % ("row tail", "fn1 ctrl", "fn36", "fn37", "note"))
    try:
        for label, tail in TAILS:
            await arm(tail)
            c = await shot(0)
            d36 = await shot(1)
            d37 = await shot(3)
            if c != mag:
                print(f"    {label:<22} {str(c):<9} {str(d36):<9} {str(d37):<9} VOID (control != {mag})")
                continue
            note = []
            note.append("x%.2f" % (d36 / mag) if d36 else "fn36 none")
            note.append("x%.2f" % (d37 / mag) if d37 else "fn37 none")
            print(f"    {label:<22} {str(c):<9} {str(d36):<9} {str(d37):<9} {'  '.join(note)}")
    finally:
        await snd("$CLEAR,*", 0.2)
        try:
            await mgr.disconnect("v")
        except Exception:
            pass
        tx.close()


asyncio.run(main())
