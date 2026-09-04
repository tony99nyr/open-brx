"""Capture a NATIVE gun's IR words -- Supremacy abilities, alt-fires, grenades -- with F12 worked around.

F12 (2026-09-02): the receiver firmware splits one arriving frame into 2-4 RAW bursts when it sees a
>= 30 ms hole mid-frame, and a real BRX gun fragments the same way our emitter does (3/44 whole).
The fragments always sum to a complete word (52 edges for a 25-bit shot) and the first fragment is a
correct prefix, so nothing is LOST -- it is mis-assembled. This tool therefore:

  1. keeps RAW ON (the durations are the evidence; the firmware's own DECODE is not trusted),
  2. writes EVERY line to disk with a host timestamp, so a capture can be re-analysed later,
  3. decodes each burst host-side (`pulses_to_bits`, sync-gated), and
  4. STITCHES bursts that arrive within STITCH_MS of each other back into one duration list. Each
     split drops exactly ONE duration (see `stitch`); when that was a mark its bit is unknown and
     parity picks between the two candidates. A stitched word is reported as such -- never as a
     clean single-burst capture -- and an unresolved one is reported with all its candidates.

Every decoded word is printed with its field split (proto / player / team / magnitude / crit /
subtype / parity). Words longer than 25 bits are printed raw: an accessory-format word (like the
grenade's) is a finding, not an error. 25-bit words with BAD parity are printed and flagged.

Operator protocol (bench 2026-09-03): receiver ~3 ft from the muzzle, soft background behind it, one
CLASS per capture so the file name says what it holds. Fire the ability 3-4 times ~5 s apart, then
2 normal shots as the class baseline. Say the class out loud before each capture starts.

Usage: python native_capture.py <label> [receiver_com=COM7] [secs=60]
       writes ~/.brx-mcp/ir-captures/<YYYYmmdd-HHMMSS>-<label>.log
"""
import os
import re
import sys
import time

import serial

from brx_mcp.irbridge import PAYLOAD_BITS, decode_word, pulses_to_bits

STITCH_MS = 150          # fragments of one word arrive well inside this; separate shots do not
_RAW = re.compile(r"^RAW\s+(\d+).*?us=\[([0-9,]*)\]")
MARK_0, MARK_1, SPACE = 500, 990, 500


def _candidates(layout: list) -> list[str]:
    """Expand the '?' marks of one frame's layout into every candidate bit string, parity-filtered."""
    unknown = sum(1 for x in layout if x == "?")
    out: list[str] = []
    for combo in range(1 << unknown):
        durs: list[int] = []
        k = 0
        for x in layout:
            if x == "?":
                durs.append(MARK_1 if (combo >> k) & 1 else MARK_0)
                k += 1
            else:
                durs.append(x)
        bits = pulses_to_bits(durs)
        if bits and bits not in out:
            out.append(bits)
    good = [b for b in out if len(b) == PAYLOAD_BITS and decode_word(b)["parity_valid"]]
    return good or out


def stitch(fragments: list[list[int]]) -> list[list[str]]:
    """Re-join the RAW duration lists of a burst group; return one candidate list PER WORD found.

    What a split actually loses (sentinel capture 2026-09-03 16:31): a whole 25-bit frame is 52 edges
    = 51 durations; two fragments printed 41 + 9 = 50, three printed 21 + 22 + 6 = 49. Each split
    drops EXACTLY ONE duration -- the interval that spanned the split -- and no edges. So the join is
    not "insert a space": it is "insert whatever was there". The firmware prints durations starting
    on a MARK and alternating, so a fragment with an ODD count ends on a mark and the lost interval
    was a SPACE (value irrelevant to the bits); an EVEN count ends on a space and the lost interval
    was a MARK whose value is UNKNOWN -- one ambiguous bit. Try both values for each unknown mark and
    let the 25-bit length + parity pick; a word that survives that with several candidates is
    reported as several, never silently chosen.

    A group can also hold MORE THAN ONE frame: the Medic heal pulse emits two words ~50 ms apart
    (capture 2026-09-03 16:36), inside STITCH_MS, and joining them read as one 50-bit "word". Every
    mark >= SYNC_MIN_US that is not the first starts a new frame, so the joined layout is cut there
    and each piece decoded on its own.
    """
    layout: list = []
    for i, d in enumerate(fragments):
        if i:
            layout.append(SPACE if len(layout) % 2 == 1 else "?")
        layout.extend(d)
    # cut at every sync mark (even index = a mark) after the first
    frames: list[list] = []
    cur: list = []
    for i, x in enumerate(layout):
        if i % 2 == 0 and isinstance(x, int) and x >= 1500 and cur:
            frames.append(cur)
            cur = []
        cur.append(x)
    if cur:
        frames.append(cur)
    # a piece has to have a sync of its own (marks on even indices); an odd-length prefix piece
    # left the following frame's sync on an odd index -- realign by dropping its leading element
    out: list[list[str]] = []
    for fr in frames:
        if not (isinstance(fr[0], int) and fr[0] >= 1500):
            continue                        # no sync: an orphan tail, nothing decodable in it
        out.append(_candidates(fr))
    return out


def ensure_raw_on(ser) -> None:
    """The firmware's 'r' is a TOGGLE whose state survives until power-cycle: check, don't assume."""
    ser.write(b"s\n")
    time.sleep(0.4)
    ser.read_all()
    for _ in range(2):
        ser.write(b"r\n")
        time.sleep(0.5)
        txt = ser.read_all().decode("ascii", "ignore")
        if "RAW dump ON" in txt:
            return
        if "RAW dump OFF" in txt:
            continue
    raise SystemExit("ABORT: could not confirm RAW dump is ON -- without RAW there are no durations "
                     "to decode or stitch, and the capture would record nothing useful.")


def describe(bits: str, tag: str) -> str:
    if len(bits) == PAYLOAD_BITS:
        w = decode_word(bits)
        ok = w.get("parity_valid", w.get("parity_ok"))
        return (f"{tag} {bits}  proto={w['proto']} player={w['player']} team={w['team']} "
                f"mag={w['damage']} crit={w['crit']} sub={w['subtype']} "
                f"parity={'ok' if ok else 'BAD'}")
    return f"{tag} {bits}  ({len(bits)} bits -- NOT a 25-bit shot word; accessory format?)"


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    label = re.sub(r"[^A-Za-z0-9_-]+", "_", sys.argv[1])
    com = sys.argv[2] if len(sys.argv) > 2 else "COM7"
    secs = float(sys.argv[3]) if len(sys.argv) > 3 else 60.0

    outdir = os.path.join(os.path.expanduser("~"), ".brx-mcp", "ir-captures")
    os.makedirs(outdir, exist_ok=True)
    path = os.path.join(outdir, f"{time.strftime('%Y%m%d-%H%M%S')}-{label}.log")

    ser = serial.Serial(com, 115200, timeout=0.05)
    time.sleep(1.2)
    ensure_raw_on(ser)
    print(f"# {label}: capturing on {com} for {secs:.0f} s -> {path}", flush=True)
    print("# GO -- fire now. Whole words print as WORD, stitched fragments as STITCH.", flush=True)

    t_end = time.time() + secs
    buf = b""
    pending: list[tuple[float, list[int]]] = []     # bursts awaiting a stitch partner
    n_bursts = n_whole = n_stitched = 0

    def flush_pending(force=False):
        nonlocal n_stitched
        if not pending:
            return
        if not force and time.time() - pending[-1][0] < STITCH_MS / 1000.0:
            return
        if len(pending) > 1:
            edges = sum(len(d) for _, d in pending)
            words = stitch([d for _, d in pending])
            if not words:
                line = f"FRAGS  x{len(pending)} edges={edges} -- no sync at the join; not decodable"
                print(f"   [{time.strftime('%H:%M:%S')}] {line}", flush=True)
                log.write(f"{time.time():.3f} {line}\n")
            for wi, cands in enumerate(words):
                tag = f"STITCH x{len(pending)} edges={edges}" + (f" word{wi + 1}/{len(words)}"
                                                                 if len(words) > 1 else "")
                if len(cands) == 1:
                    n_stitched += 1
                    line = describe(cands[0], tag)
                else:
                    line = f"{tag} AMBIGUOUS {len(cands)}: " + " | ".join(describe(c, "") for c in cands)
                print(f"   [{time.strftime('%H:%M:%S')}] {line}", flush=True)
                log.write(f"{time.time():.3f} {line}\n")
        pending.clear()

    with open(path, "w", encoding="ascii", errors="ignore") as log:
        log.write(f"# label={label} com={com} secs={secs} started={time.time():.3f}\n")
        while time.time() < t_end:
            chunk = ser.read(4096)
            if chunk:
                buf += chunk
                while b"\n" in buf:
                    ln, buf = buf.split(b"\n", 1)
                    line = ln.decode("ascii", "ignore").rstrip("\r")
                    now = time.time()
                    log.write(f"{now:.3f} {line}\n")
                    m = _RAW.match(line)
                    if not m:
                        continue
                    n_bursts += 1
                    durs = [int(x) for x in m.group(2).split(",") if x]
                    bits = pulses_to_bits(durs)
                    if len(bits) == PAYLOAD_BITS:
                        n_whole += 1
                        flush_pending(force=True)
                        out = describe(bits, f"WORD   edges={len(durs)}")
                        print(f"   [{time.strftime('%H:%M:%S')}] {out}", flush=True)
                        log.write(f"{now:.3f} {out}\n")
                    else:
                        # a prefix / fragment: hold it and see whether the rest follows
                        pending.append((now, durs))
            flush_pending()
        flush_pending(force=True)
        summary = (f"# done: bursts={n_bursts} whole={n_whole} stitched={n_stitched} -> {path}")
        print(summary, flush=True)
        log.write(summary + "\n")
    ser.close()


if __name__ == "__main__":
    main()
