"""Compare config frames across captures, token by token.

Built for the $GSET decode: capture the same game twice changing exactly ONE
app setting, and whichever token moves is that setting. Also works for $PSET
and $WEAP.

usage:
  python -m brx_mcp.gsetdiff <capA.log> <capB.log> [capC.log ...]
  python -m brx_mcp.gsetdiff --cmd PSET a.log b.log
"""
from __future__ import annotations

import sys
from pathlib import Path

from .btsnoop import extract_att, parse_btsnoop, reconstruct_frames


def config_frames(path: str, cmd: str) -> list[str]:
    frames = reconstruct_frames(extract_att(parse_btsnoop(path)))
    return [f["raw"] for f in frames
            if f["direction"] == "tx" and f["raw"].startswith(f"${cmd},")]


def main() -> None:
    args = [a for a in sys.argv[1:]]
    cmd = "GSET"
    if args and args[0] == "--cmd":
        cmd = args[1].upper().lstrip("$")
        args = args[2:]
    if len(args) < 2:
        print(__doc__, file=sys.stderr)
        sys.exit(2)

    captures: list[tuple[str, list[str]]] = []
    for path in args:
        try:
            found = config_frames(path, cmd)
        except Exception as e:  # noqa: BLE001
            print(f"!! {path}: {type(e).__name__}: {e}", file=sys.stderr)
            continue
        captures.append((Path(path).name, found))
        print(f"{Path(path).name}: {len(found)} ${cmd} frame(s)")
        for f in found:
            print(f"    {f}")
    print()

    usable = [(n, f[0]) for n, f in captures if f]
    if len(usable) < 2:
        print(f"need ${cmd} in at least two captures to compare", file=sys.stderr)
        return

    # token-by-token comparison of the FIRST frame from each capture
    rows = [(n, frame.rstrip("*").rstrip(",").split(",")) for n, frame in usable]
    width = max(len(toks) for _, toks in rows)
    names = [n for n, _ in rows]

    print(f"token-by-token (${cmd}, first frame of each):\n")
    head = "  tok │ " + " │ ".join(f"{n[:18]:>18}" for n in names)
    print(head)
    print("  " + "─" * (len(head) - 2))
    for i in range(1, width):          # token 0 is the command name
        vals = [toks[i] if i < len(toks) else "" for _, toks in rows]
        changed = len(set(vals)) > 1
        mark = " ←── CHANGED" if changed else ""
        cells = " │ ".join(f"{v!r:>18}" for v in vals)
        print(f"  {i:>3}  │ {cells}{mark}")

    changed_idx = [i for i in range(1, width)
                   if len({(toks[i] if i < len(toks) else "")
                           for _, toks in rows}) > 1]
    print()
    if not changed_idx:
        print("  NO TOKENS DIFFER — the setting you changed is not in "
              f"${cmd}, or the captures are identical (same file twice?).")
    elif len(changed_idx) == 1:
        print(f"  >>> token {changed_idx[0]} is the one that moved. <<<")
    else:
        print(f"  tokens {changed_idx} all differ — more than one setting "
              "changed between captures, so this cannot isolate a field. "
              "Re-capture changing exactly one thing.")


if __name__ == "__main__":
    main()
