"""Rig check: does board B's emitter actually reach board A's receiver, and arrive INTACT?

This is the instrument calibration the 2026-09-02 session did not have, and its absence cost most of
an afternoon. When a tagger fails to register, "our emitter is broken" and "that tagger is deaf" look
identical from the tagger side -- the only way to tell them apart is a receiver we trust. So: emit a
KNOWN word on the emitter, decode it on the receiver, and compare bit for bit.

It answers three separate questions, in order, and each one narrows the next:

  1. PING both boards      -- are they alive on the ports we think? (no IR involved at all)
  2. decode rate           -- do the photons get across?
  3. bit-exact comparison  -- do they arrive UNCORRUPTED, or is the link marginal?

A marginal link is the dangerous case: it decodes sometimes, so the rig looks fine, and then a run
attributes the dropped shots to whatever it happened to be testing. Anything below 100% here means
NO IR result from this rig is trustworthy until it is fixed.

Usage: python loopback.py [emitter_com=COM8] [receiver_com=COM7] [shots=10]
"""
import re
import sys
import time

from brx_mcp.irbridge import IRBridge, payload_parity

# The capture firmware answers 's' with "# frames=N". It does NOT implement PING -- only the emitter
# does. Probing it with PING reports a perfectly good board as dead, which cost a bench window.
_DEC = re.compile(r"^DECODE\s+bits=(\d+)\s+val=([01]*)")


def decoded_bits(lines):
    """Bits from every DECODE line, WITHOUT requiring a preceding RAW.

    `irbridge.parse_frames` pairs DECODE to RAW and drops any DECODE that has no RAW before it. The
    capture firmware's 'r' toggle turns RAW off and the setting survives until the board is power
    cycled -- so with RAW off, a perfectly received shot decodes and is then silently thrown away,
    and the run reports "nothing got across". For a link check we want the decode itself, so read it
    straight off the line.
    """
    return [m.group(2) for m in (_DEC.match(l.strip()) for l in lines) if m]


def word(mag, proto, team, sub=0, pid=42, crit=0):
    f = lambda v, n: format(v & ((1 << n) - 1), "0%db" % n)
    pay = f(proto, 4) + f(pid, 6) + f(team, 2) + f(mag, 8) + f(crit, 1) + f(sub, 2)
    return pay + payload_parity(pay)


def main():
    emit_com = sys.argv[1] if len(sys.argv) > 1 else "COM8"
    recv_com = sys.argv[2] if len(sys.argv) > 2 else "COM7"
    shots = int(sys.argv[3]) if len(sys.argv) > 3 else 10

    print(f"emitter={emit_com}  receiver={recv_com}  shots={shots}\n")

    tx = IRBridge(port=emit_com)
    rx = IRBridge(port=recv_com)
    time.sleep(1.4)

    # --- 1. are both boards alive? This is true or false regardless of aim, so it separates a dead
    #        board / wrong port from an IR problem before we blame the optics.
    ok_tx = tx.ping()
    rx._ser.write(b"s\n")                       # capture firmware: 's' -> "# frames=N"
    rx_reply = rx._readlines(0.6)
    ok_rx = any("frames=" in ln for ln in rx_reply)
    print(f"  1. PING  emitter  {emit_com}: {'PONG OK' if ok_tx else 'NO REPLY FAIL'}")
    print(f"     's'   receiver {recv_com}: {'ALIVE OK' if ok_rx else 'NO REPLY FAIL'}"
          + (f"   ({' | '.join(rx_reply)[:60]})" if rx_reply else ""))
    if not (ok_tx and ok_rx):
        print("\n  A board is not answering. Nothing below would mean anything -- check the port and\n"
              "  the USB cable before touching the aim.")
        return

    # Turn the RAW dump OFF. It costs ~15-20ms per frame at 115200 and the board MISSES EDGES while
    # it prints, so a single arriving frame gets chopped into fragments that each fail to decode.
    # Measured 2026-09-02: with RAW on this link graded 3/10 "marginal"; the fragments were the
    # instrument damaging its own reception, not a weak signal. RAW is only worth having when the
    # pulse timings themselves are the subject.
    rx._ser.write(b"r\n")
    ack = rx._readlines(0.5)
    raw_off = any("RAW dump OFF" in ln for ln in ack)
    if not raw_off:                       # it toggles, so if it was already off we just turned it ON
        rx._ser.write(b"r\n")
        ack = rx._readlines(0.5)
        raw_off = any("RAW dump OFF" in ln for ln in ack)
    print(f"     RAW dump: {'OFF (edges no longer dropped to the print)' if raw_off else 'UNKNOWN -- ' + ' | '.join(ack)[:50]}")

    # --- 2 + 3. fire a known word and grade what comes back.
    sent = word(20, 0, 2)
    print(f"\n  2. firing {shots} x  {sent}   (mag 20, proto 0, team 2)")
    heard, exact, corrupt = 0, 0, []
    for i in range(shots):
        rx._ser.reset_input_buffer()
        tx._ser.write((f"TX {sent}\n").encode())
        tx._ser.flush()
        time.sleep(0.45)
        lines = rx._readlines(0.5)
        got = decoded_bits(lines)
        if not got:
            saw_raw = sum(1 for l in lines if l.startswith("RAW"))
            print(f"     shot {i + 1:2d}   -- nothing decoded"
                  + (f"   ({saw_raw} RAW burst(s) seen but no DECODE -- signal arrived, too weak or"
                     " malformed to decode)" if saw_raw else ""))
            continue
        heard += 1
        b = got[-1]
        if b == sent:
            exact += 1
            print(f"     shot {i + 1:2d}   OK exact")
        else:
            corrupt.append(b)
            bad = sum(1 for x, y in zip(b, sent) if x != y) + abs(len(b) - len(sent))
            print(f"     shot {i + 1:2d}   !! decoded but WRONG ({bad} bit(s) off): {b}")

    print(f"\n  3. decoded {heard}/{shots}   bit-exact {exact}/{shots}")
    if exact == shots:
        print("     OK RIG GOOD. The emitter works, the receiver works, and the link is clean.\n"
              "        A tagger that fails to register now is the TAGGER, not us.")
    elif heard == 0:
        print("     FAIL NOTHING GETS ACROSS. Both boards are alive (step 1), so this is aim, distance,\n"
              "        or the emitter LED itself. Re-aim them at each other, a few inches apart, and\n"
              "        re-run before drawing any conclusion about any tagger.")
    else:
        print("     !! MARGINAL LINK -- the worst case, because it works often enough to look fine.\n"
              "        Do NOT run a hit experiment on this rig: dropped shots will be attributed to\n"
              "        whatever the experiment happens to be varying. Fix the aim/distance first.")
    tx.close()
    rx.close()


if __name__ == "__main__":
    main()
