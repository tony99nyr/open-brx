"""Diff an official-Callsign BLE capture against OUR game arm.

Built for one question (docs/handoff-callsign-nrf-capture.md): does the iOS app
send a frame we don't — something that flips the guns into their native
**nRF-peered** game (green sight + "double kill" announcer)?

RESOLVED (§7o, 2026-08-25): there is NO such frame — the app's arm is byte-identical
to ours. But the feedback IS BLE-reachable anyway: the phone scores the game itself
and sends `$SFLASH,*` + a token-4 `$PLAY` per kill. So this tool's original either/or
("byte-identical => feedback not BLE-reachable") is retired; it now serves as a
general capture-vs-arm diff (still handy for future protocol work).

What it reports:
  1. connections found (one per gun) and each one's chronological host->gun writes
  2. NOVEL commands — sent by Callsign, absent from our arm  <- the payload
  3. commands we send that Callsign doesn't
  4. token-by-token diff of the config frames we have in common
  5. cross-gun scan: which token values are IDENTICAL on both guns (a shared
     nRF channel / game-id / session would look exactly like this) vs per-gun

usage:
  python -m brx_mcp.callsigndiff <capture.btsnoop> [--mode tdm] [--rx]
"""

from __future__ import annotations

import sys
from collections import OrderedDict
from pathlib import Path

from .btsnoop import extract_att, parse_btsnoop, reconstruct_frames
from .gameconfig import GameConfig

# Commands whose appearance would be a direct hit on the hypothesis. $PB* is the
# playbook remote-start path (protocol §7j); the rest are guesses at a session/
# network/channel setter, matched by prefix so an unknown sibling still trips.
SUSPECT_PREFIXES = ("PB", "NRF", "NET", "CHAN", "GRP", "GROUP", "SESS", "GID",
                    "MESH", "PEER", "LINK", "RF", "GAME", "JOIN", "SYNC")


def cmd_of(frame: str) -> str:
    body = frame.lstrip("$")
    if body.startswith("!"):
        parts = body.split(",")
        return parts[1] if len(parts) > 1 else parts[0]
    return body.split(",", 1)[0]


def toks(frame: str) -> list[str]:
    s = frame.strip()
    if s.endswith(",*"):
        s = s[:-2]
    elif s.endswith("*"):
        s = s[:-1]
    return s.lstrip("$").split(",")


def baseline_frames(mode: str = "tdm") -> list[str]:
    """Everything our own arm writes to one gun, in order."""
    cfg = GameConfig(mode=mode)
    return list(cfg.setup_frames()) + list(cfg.player_frames(1))


def main() -> None:
    argv = [a for a in sys.argv[1:]]
    mode, show_rx = "tdm", False
    if "--rx" in argv:
        show_rx = True
        argv.remove("--rx")
    if "--mode" in argv:
        i = argv.index("--mode")
        if i + 1 >= len(argv):
            print("--mode needs a value (e.g. --mode ffa)", file=sys.stderr)
            sys.exit(2)
        mode = argv[i + 1]
        del argv[i:i + 2]
    if not argv:
        print(__doc__, file=sys.stderr)
        sys.exit(2)

    path = argv[0]
    frames = reconstruct_frames(extract_att(parse_btsnoop(path)))
    if not frames:
        print(f"!! no BRX frames decoded from {path}.\n"
              "   Either the trace wasn't actually recording, or it's the wrong\n"
              "   window's export (PacketLogger exports the FRONTMOST trace).",
              file=sys.stderr)
        sys.exit(1)

    t0 = frames[0]["ts_us"]
    conns = sorted({f["conn"] for f in frames})
    label = {c: f"GUN {chr(ord('A') + i)}" for i, c in enumerate(conns)}

    print(f"=== {Path(path).name}: {len(frames)} frames, "
          f"{len(conns)} connection(s) ===")
    for c in conns:
        tx = sum(1 for f in frames if f["conn"] == c and f["direction"] == "tx")
        rx = sum(1 for f in frames if f["conn"] == c and f["direction"] == "rx")
        print(f"  {label[c]}  handle 0x{c:03x}   {tx} writes / {rx} notifies")
    print()

    # ---- 1. chronological writes, per gun -------------------------------- #
    per_gun: OrderedDict[int, list[str]] = OrderedDict((c, []) for c in conns)
    for f in frames:
        if f["direction"] == "tx":
            per_gun[f["conn"]].append(f["raw"])

    for c in conns:
        print(f"--- {label[c]}: host -> gun, chronological ---")
        for f in frames:
            if f["conn"] != c:
                continue
            if f["direction"] != "tx" and not show_rx:
                continue
            arrow = ">>" if f["direction"] == "tx" else "<<"
            print(f"  [{(f['ts_us'] - t0) / 1e6:8.3f}s] {arrow} {f['raw']}")
        print()

    # ---- 2/3. command vocabulary vs our arm ------------------------------ #
    base = baseline_frames(mode)
    base_cmds = {cmd_of(f) for f in base}
    app_cmds: OrderedDict[str, list[str]] = OrderedDict()
    for c in conns:
        for raw in per_gun[c]:
            app_cmds.setdefault(cmd_of(raw), []).append(raw)

    novel = [k for k in app_cmds if k not in base_cmds]
    missing = sorted(base_cmds - set(app_cmds))

    print("=" * 68)
    print(f"NOVEL — Callsign sends these, our arm ({mode}) does NOT:")
    if not novel:
        print("  (none — the app's command vocabulary is a subset of ours)")
    for k in novel:
        hit = "   <<< SUSPECT" if k.startswith(SUSPECT_PREFIXES) else ""
        print(f"  ${k}{hit}")
        for raw in app_cmds[k][:6]:
            print(f"        {raw}")
        if len(app_cmds[k]) > 6:
            print(f"        ... +{len(app_cmds[k]) - 6} more")
    print()
    print("Our arm sends these, Callsign does not:")
    print("  " + (", ".join("$" + m for m in missing) if missing else "(none)"))
    print()

    # ---- 4. token diff on shared config commands ------------------------- #
    print("=" * 68)
    print("TOKEN DIFF vs our arm (first frame of each shared command):")
    base_first = {}
    for f in base:
        base_first.setdefault(cmd_of(f), f)
    for k in ("GSET", "PSET", "START", "SPAWN", "VOL", "TID"):
        if k not in app_cmds or k not in base_first:
            continue
        a, b = toks(app_cmds[k][0]), toks(base_first[k])
        width = max(len(a), len(b))
        rows = []
        for i in range(1, width):
            av = a[i] if i < len(a) else "<absent>"
            bv = b[i] if i < len(b) else "<absent>"
            if av != bv:
                rows.append(f"      tok {i}: callsign={av!r}  ours={bv!r}")
        print(f"  ${k}")
        print(f"      callsign: {app_cmds[k][0]}")
        print(f"      ours    : {base_first[k]}")
        if rows:
            print("\n".join(rows))
        else:
            print("      (identical)")
    print()

    # ---- 5. cross-gun shared values -------------------------------------- #
    if len(conns) < 2:
        print("=" * 68)
        print("CROSS-GUN SCAN: only one connection captured — cannot tell a\n"
              "shared session/channel value from a per-gun one. Re-capture with\n"
              "both guns on one phone if the app allows it.")
        return

    print("=" * 68)
    print("CROSS-GUN SCAN — a shared nRF channel/game-id is a value that is\n"
          "IDENTICAL on both guns; team/player ids differ. Commands both guns got:")
    a_cmds = {cmd_of(r): r for r in per_gun[conns[0]]}
    b_cmds = {cmd_of(r): r for r in per_gun[conns[1]]}
    for k in a_cmds:
        if k not in b_cmds:
            continue
        ta, tb = toks(a_cmds[k]), toks(b_cmds[k])
        diffs = [i for i in range(1, max(len(ta), len(tb)))
                 if (ta[i] if i < len(ta) else None) != (tb[i] if i < len(tb) else None)]
        base_same = k in base_cmds
        flag = "" if base_same else "   <<< NOT IN OUR ARM"
        if diffs:
            print(f"  ${k}: differs at tokens {diffs}{flag}")
            print(f"        A: {a_cmds[k]}")
            print(f"        B: {b_cmds[k]}")
        else:
            print(f"  ${k}: IDENTICAL on both guns{flag}")
            if not base_same:
                print(f"        {a_cmds[k]}")
    print()
    print("Read it this way: an IDENTICAL frame that is NOT IN OUR ARM is the\n"
          "candidate shared-session enabler. Bring it back to the bench.")


if __name__ == "__main__":
    main()
