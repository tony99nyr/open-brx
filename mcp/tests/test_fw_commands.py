"""R4/T1: stock-image command inventory without copying firmware into the repo."""
from __future__ import annotations

import pathlib
import subprocess
import sys
import tempfile

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))

import fw_commands as F  # noqa: E402
from brx_mcp.protocol import DENIED_COMMANDS, HANG_PRONE_COMMANDS, KNOWN_COMMANDS  # noqa: E402

REPO = pathlib.Path(__file__).resolve().parents[2]


def test_extracts_distinct_sorted_command_words_at_binary_boundaries():
    image = (
        b"prefix:$NOPElower "             # no terminator: prose, not a command-shaped string
        b"word$EMBEDDED\x00"              # no left boundary: part of another identifier
        b"\x00$PING\x00$FREE,*\xff"
        b"$PING\r\n$YIYH*"
        b"$A\x00"                         # one-letter fragments in the images are not command words
        b"$haslower\x00"                  # firmware log text, not a command word
    )
    assert F.extract_commands(image) == ["FREE", "PING", "YIYH"]


def test_command_length_is_bounded_so_corrupt_data_cannot_make_an_unlimited_name():
    assert F.extract_commands(b"$" + b"A" * (F.MAX_COMMAND_LEN + 1) + b"\x00") == []


def test_cli_prints_dollar_prefixed_ascii_one_per_line():
    with tempfile.TemporaryDirectory() as td:
        image = pathlib.Path(td) / "private-image.bin"
        image.write_bytes(b"\x00$ZON\x00$PING\x00$ZON\x00")
        run = subprocess.run(
            [sys.executable, str(TOOLS / "fw_commands.py"), str(image)],
            capture_output=True, text=True, timeout=10,
        )
    assert run.returncode == 0, run.stderr
    assert run.stdout == "$PING\n$ZON\n"
    run.stdout.encode("ascii")


def test_cli_refuses_a_directory_instead_of_printing_a_traceback():
    with tempfile.TemporaryDirectory() as td:
        run = subprocess.run(
            [sys.executable, str(TOOLS / "fw_commands.py"), td],
            capture_output=True, text=True, timeout=10,
        )
    assert run.returncode == 2
    assert "regular file" in run.stderr.lower()
    assert "traceback" not in run.stderr.lower()


def test_the_published_inventory_is_sorted_complete_and_routes_every_protocol_gap():
    doc = (REPO / "docs/reference/firmware-commands.md").read_text(encoding="utf-8")
    rows = []
    for line in doc.splitlines():
        if line.startswith("| `$"):
            rows.append([cell.strip() for cell in line.strip("|").split("|")])
    commands = [row[0][2:-1] for row in rows]
    assert len(commands) == 128 and commands == sorted(set(commands)), (len(commands), commands[:5])
    assert sum("4.32" in row[1].split(", ") for row in rows) == 111
    assert all(row[2] in {"yes", "**no**"} for row in rows)
    assert all(row[3] in {"known-safe", "denied", "hang-prone", "confirm-required"} for row in rows)
    assert all(row[4] in {"proven", "claimed", "never sent"} for row in rows)
    gaps = {row[0][2:-1] for row in rows if row[2] == "**no**"}
    assert gaps == {"CLEARDEVICE", "FREE", "IRH", "IRL", "IRS", "SER"}
    followups = (REPO / "docs/FOLLOWUPS.md").read_text(encoding="utf-8")
    assert all(f"`${command}`" in followups for command in gaps), gaps
    bench = {row[0][2:-1]: row[4] for row in rows}
    assert all(bench[command] == "proven" for command in {"BUMP", "DPLAY", "IRTX", "STUN", "TMP"})
    for row in rows:
        command = row[0][2:-1]
        expected = ("denied" if command in DENIED_COMMANDS else
                    "hang-prone" if command in HANG_PRONE_COMMANDS else
                    "known-safe" if command in KNOWN_COMMANDS else "confirm-required")
        assert row[3] == expected, (command, row[3], expected)
