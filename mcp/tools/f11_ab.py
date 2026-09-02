"""F11, measured the only way that counts: both victims in the SAME photon burst.

Every claim we made about R0BQT on 2026-09-02 that compared it to R0BAT at a DIFFERENT time was
wrong -- eight hypotheses, all retracted (docs/FOLLOWUPS.md F11). The one claim that survived was the
one taken in a single session with a single emitter. This tool makes that the whole design: both
taggers are connected at once, both headsets sit in the emitter's cone, and ONE shot is graded
against BOTH. There is no drifting variable left for the two sides to disagree about, because there
is no gap between them.

Position is the confound that this cannot fix in software, so the operator swaps the two victims
physically at the halfway mark and the run reports each side in BOTH positions. A victim that fails
in both while the other succeeds in both is a real difference; anything else is aim.

Damage is deliberately magnitude 1: 20 shots is 20 damage against 185 of pools, so NOBODY DIES and no
respawn happens. That removes the death/respawn hypothesis from the experiment by construction
rather than by argument.

The receiver board is the WITNESS. Sat beside the headsets, facing the emitter, it says for every
single shot whether photons actually arrived at the victims' position -- independently of what either
tagger reports. That is the instrument today lacked: with it, "both victims silent" splits cleanly
into "the emitter did not fire" (witness silent too) and "both taggers are deaf" (witness heard it),
and those two were confused for each other all afternoon. Shots the witness did not hear are VOID and
are excluded from the totals rather than counted as misses.

Usage: python f11_ab.py <addr_A> <addr_B> [emitter_com=COM8] [shots_per_position=12] [receiver_com=COM7]
"""
import asyncio
import sys
import time

import serial

import re

import bench_common as B
from brx_mcp.irbridge import IRBridge, payload_parity

_RAWE = re.compile(r"^RAW\s+\d+\s+edges=(\d+)")
FULL_FRAME_EDGES = 50      # a 25-bit BRX word is 52 edges; allow a couple lost to noise


def witnessed(lines):
    """Did a FULL frame's worth of light arrive? Graded on EDGES, not on a clean decode.

    Measured 2026-09-02: this receiver splits an arriving frame into 2-4 bursts and then fails to
    decode each piece -- our emitter decoded whole only 4/20, and a REAL BRX GUN only 3/44. Real guns
    demonstrably hit real taggers, so the fragmentation is this receiver mis-assembling what arrives,
    not something wrong with the transmission. The EDGE COUNT survives it perfectly: every one of 20
    emitter shots summed to exactly 52 edges across its fragments. So sum the edges and ignore the
    decode -- that is the one thing this board measures reliably, and it is all a witness needs.
    """
    return sum(int(m.group(1)) for m in (_RAWE.match(l.strip()) for l in lines) if m) >= FULL_FRAME_EDGES

VICTIM_TEAM, ENEMY_TEAM = 1, 2
SENSOR = {0: "dome0", 1: "dome1", 2: "dome2", 3: "dome3", 4: "GUNBODY"}


def word(mag, proto, team, sub=0, pid=42, crit=0):
    f = lambda v, n: format(v & ((1 << n) - 1), "0%db" % n)
    pay = f(proto, 4) + f(pid, 6) + f(team, 2) + f(mag, 8) + f(crit, 1) + f(sub, 2)
    return pay + payload_parity(pay)


async def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    addrs = [sys.argv[1], sys.argv[2]]
    com = sys.argv[3] if len(sys.argv) > 3 else "COM8"
    nshot = int(sys.argv[4]) if len(sys.argv) > 4 else 12
    recv_com = sys.argv[5] if len(sys.argv) > 5 else "COM7"
    names = ["A", "B"]

    tx = serial.Serial(com, 115200, timeout=0.3)
    time.sleep(1.6)
    tx.reset_input_buffer()

    # The witness. Optional only in the sense that the run still works without it -- but without it a
    # silent victim is uninterpretable, which is exactly how today went.
    try:
        rx = IRBridge(port=recv_com)
        time.sleep(1.2)
        rx._ser.write(b"s\n")          # capture firmware answers 's'; it has no PING
        if not any("frames=" in ln for ln in rx._readlines(0.6)):
            print(f"!! receiver on {recv_com} did not answer -- running WITHOUT a witness")
            rx = None
        else:
            for _ in range(2):          # RAW must be ON: the edge counts are the measurement
                rx._ser.write(b"r\n")
                if any("RAW dump ON" in ln for ln in rx._readlines(0.5)):
                    break
    except Exception as e:
        print(f"!! no receiver on {recv_com} ({e}) -- running WITHOUT a witness")
        rx = None

    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()

    async with B.connected(mgr, *zip(addrs, names)):
        for i, a in enumerate(names):
            for fr in B.arming_frames(40 + i, VICTIM_TEAM):
                await mgr.send(a, fr, reply_window_ms=140)
                await asyncio.sleep(0.12)
            await mgr.send(a, B.AR, reply_window_ms=140)
            await asyncio.sleep(0.15)
            await mgr.send(a, "$SPAWN,*", reply_window_ms=200)
            await asyncio.sleep(0.4)
        print("both armed + spawned (mag-1 shots: nobody will die)\n", flush=True)

        results = {}
        for pos in ("POSITION 1", "POSITION 2 (swapped)"):
            if pos.startswith("POSITION 2"):
                input("\n>>> SWAP the two victims physically, then press ENTER: ")
            print(f"\n=== {pos} -- {nshot} shots, each graded against BOTH victims", flush=True)
            tally = {a: [] for a in names}
            void = 0
            for s in range(nshot):
                marks = {a: mgr.get_events(a, since_seq=0).get("last_seq", 0) for a in names}
                if rx is not None:
                    rx._ser.reset_input_buffer()
                tx.write(("TX " + word(1, 0, ENEMY_TEAM) + "\n").encode())
                tx.flush()
                await asyncio.sleep(1.0)
                witness = None
                if rx is not None:
                    witness = witnessed(rx._readlines(0.45))
                    if not witness:
                        void += 1
                row = []
                for a in names:
                    evs = [e.get("raw", "").strip() for e in
                           mgr.get_events(a, since_seq=marks[a]).get("events", []) if isinstance(e, dict)]
                    hirs = [e for e in evs if e.startswith("$HIR")]
                    if hirs:
                        try:
                            sen = SENSOR.get(int(hirs[-1].split(",")[1]), "?")
                        except Exception:
                            sen = "?"
                        tally[a].append(sen)
                        row.append(f"{a}=HIT({sen})")
                    else:
                        row.append(f"{a}=  --   ")
                wit = "" if witness is None else ("  [witness OK]" if witness else "  [WITNESS SILENT -> VOID]")
                print(f"  shot {s + 1:2d}  " + "   ".join(row) + wit, flush=True)
            results[pos] = (tally, void)

        print("\n=== SUMMARY -- same burst, so these ARE comparable ===")
        for pos, (tally, void) in results.items():
            good = nshot - void
            print(f"  {pos}   ({good}/{nshot} shots witnessed" + (f", {void} VOID)" if void else ")"))
            for a in names:
                hits = tally[a]
                print(f"     {a} ({addrs[names.index(a)]}): {len(hits)}/{good}   sensors={sorted(set(hits))}")
        print("\n  A victim that fails in BOTH positions while the other succeeds in both is a real\n"
              "  difference. Any other pattern is aim, and the honest answer is 'not established'.")
        if rx is not None:
            print("  Denominators are WITNESSED shots only -- a shot the receiver never heard was never\n"
                  "  fired at anyone, and counting it as a miss is how the emitter got blamed today.")
            rx.close()


if __name__ == "__main__":
    asyncio.run(main())
