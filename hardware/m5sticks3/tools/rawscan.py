"""Summarise the StickS3's RAW lines so a bench session can see what the receiver delivers (F314).

A DIAGNOSTIC, never a decoder: on 2026-09-23 a "tolerant" re-read of real Stick bursts produced WRONG words that passed
both parity checks, so nothing here may feed ownership. For each burst with enough marks it prints the mark and space
ranges, the sync-region length (everything before the last 25 marks), and the 25-mark bit reading at a 600 us threshold,
labelled CANDIDATE. Compare a candidate with the rig receiver's word for the same shot; that comparison is the result.

usage: python3 rawscan.py < capture.txt      (the sercmd.py output, with RAW on: send `r`)
"""
import re
import sys

WORD = 25


def payload_ok(bits):
    ones = sum(c == "1" for c in bits[:23])
    return bits[23:25] == ("01" if ones % 2 else "10")


def main():
    for line in sys.stdin:
        m = re.search(r"RAW (\d+) edges=\d+.*?us=\[([0-9,]*)\]", line)
        if not m:
            continue
        v = [int(x) for x in m.group(2).split(",") if x]
        marks, spaces = v[0::2], v[1::2]
        if len(marks) < WORD + 1:
            print(f"burst {m.group(1)}: {len(marks)} marks (short of a word), marks {min(marks, default=0)}-{max(marks, default=0)} us")
            continue
        s = len(marks) - WORD
        tail_marks, tail_spaces = marks[s:], spaces[s:s + WORD - 1]
        bits = "".join("1" if x > 600 else "0" for x in tail_marks)
        print(f"burst {m.group(1)}: {len(marks)} marks; sync region {sum(v[:2 * s - 1])} us; "
              f"bit marks {min(tail_marks)}-{max(tail_marks)} us; spaces {min(tail_spaces)}-{max(tail_spaces)} us; "
              f"CANDIDATE {bits} genuine={'yes' if payload_ok(bits) else 'no'}")


if __name__ == "__main__":
    main()
