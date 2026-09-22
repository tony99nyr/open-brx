#!/usr/bin/env python3
"""Print command-shaped ``$WORDS`` found in one stock firmware image.

The image is supplied by the caller and is never copied, modified, or searched by a
repo-relative default. Output is deliberately only the distinct command names: no offsets,
surrounding strings, disassembly, or other firmware content.
"""
from __future__ import annotations

import argparse
import pathlib
import re

MIN_COMMAND_LEN = 2   # `$H`/`$J`/`$K` occur as string fragments; the shortest real words are `$AS`, `$IT`, `$SP`, `$UP`
MAX_COMMAND_LEN = 32
_COMMAND = re.compile(
    rb"(?<![A-Za-z0-9_$])\$([A-Z][A-Z0-9]{" + str(MIN_COMMAND_LEN - 1).encode("ascii") + rb"," + str(MAX_COMMAND_LEN - 1).encode("ascii") + rb"})(?=[,\x00\r\n*]|\Z)"
)


def extract_commands(image: bytes) -> list[str]:
    """Return sorted, unique ASCII command words without their leading ``$``."""
    return sorted({match.group(1).decode("ascii") for match in _COMMAND.finditer(image)})


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="list $ command names in one caller-supplied firmware image")
    parser.add_argument("image", type=pathlib.Path, help="path to a private stock firmware image")
    args = parser.parse_args(argv)
    if not args.image.is_file():
        parser.error(f"image is not a regular file: {args.image}")
    try:
        image = args.image.read_bytes()
    except OSError as exc:
        parser.error(f"cannot read image {args.image}: {exc}")
    for command in extract_commands(image):
        print(f"${command}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
