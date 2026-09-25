"""R4/T1: stock-image command inventory without copying firmware into the repo."""
from __future__ import annotations

import pathlib
import subprocess
import sys
import tempfile

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))

import fw_commands as F  # noqa: E402
from brx_mcp.protocol import (  # noqa: E402
    CONFIRM_REQUIRED_COMMANDS,
    DENIED_COMMANDS,
    HANG_PRONE_COMMANDS,
    KNOWN_COMMANDS,
)

REPO = pathlib.Path(__file__).resolve().parents[2]

EXPECTED_PRESENCE_CLASSES = {
    "2.01U": "IRG IRH IRL IRS MSHIELD SHIELD",
    "2.01U, 2.02c, 2.02e, 2.08b": "PIN",
    "2.01U, 2.02c, 2.02e, 2.08b, 4.32": (
        "AMMO ASKSN BHIT BMAP BUMP BUT CLEAR DEV DIE DLC DPLAY DTYPE DUTY FACTORY FIREX FLED FREE GLED "
        "GPAIR GPAIRX GREN GSET INVU IRLVL IRT LIFE LIGHT LINK MUZ NAME PBGAME PBINDOOR PBLIVES PBLOCK "
        "PBPERK PBSPAWN PBSTART PBTEAM PBTIME PBWEAP PHONE PID PING PLAY PLAYX PRES PSET QFX QHIT QPLAY "
        "QUERY RESET SFLASH SHOWNAME SIR SOL SPAWN START STOP STUN TEAM TID TMP VIB VIBTOGGLE VOL VOLTS WEAP"
    ),
    "2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34": (
        "BAT BLINK CHASE GLOW GPING HADSK HFIRM HIT HLED HLOOP INDOOR INIT IRTX LED RADSK SITE SOLID VERSION"
    ),
    "2.01U, 2.02c, 2.02e, 2.08b, H1.27, H1.34": "PAIR",
    "2.02c, 2.02e, 2.08b": "DDFU",
    "2.02c, 2.02e, 2.08b, 4.32": "BTV CDFU CLEARDEVICE HEADDFU",
    "2.08b": "GAMEPAD",
    "2.08b, 4.32": "CONNECT DISCONNECT FTST TSTRNAME",
    "2.08b, 4.32, H1.27, H1.34": "BURN",
    "4.32": "AD AS ASKDLC DK FL IF IK INQ IT KK PHONECONNECT PHONEDISCONNECT RV SLO SP UP",
    "H1.27, H1.34": "BOOM SER SGREN ZOFF ZOM ZON ZTOG",
}


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
    assert "| command | present in | protocol | safety | bench | needs firmware |" in doc
    rows = []
    for line in doc.splitlines():
        if line.startswith("| `$"):
            rows.append([cell.strip() for cell in line.strip("|").split("|")])
    commands = [row[0][2:-1] for row in rows]
    assert all(len(row) == 6 for row in rows)
    assert len(commands) == 128 and commands == sorted(set(commands)), (len(commands), commands[:5])
    expected_by_command = {
        command: presence
        for presence, names in EXPECTED_PRESENCE_CLASSES.items()
        for command in names.split()
    }
    assert set(commands) == set(expected_by_command)
    assert all(row[1] == expected_by_command[row[0][2:-1]] for row in rows)
    assert {presence: sum(row[1] == presence for row in rows) for presence in EXPECTED_PRESENCE_CLASSES} == {
        presence: len(names.split()) for presence, names in EXPECTED_PRESENCE_CLASSES.items()
    }
    version_totals = {
        version: sum(version in row[1].split(", ") for row in rows)
        for version in ("2.01U", "2.02c", "2.02e", "2.08b", "4.32", "H1.27", "H1.34")
    }
    assert version_totals == {
        "2.01U": 94, "2.02c": 93, "2.02e": 93, "2.08b": 99, "4.32": 111,
        "H1.27": 27, "H1.34": 27,
    }
    known_safe_by_presence = {
        presence: {command for command in names.split() if command in KNOWN_COMMANDS}
        for presence, names in EXPECTED_PRESENCE_CLASSES.items()
    }
    all_tagger_safe = {
        command for command, presence in expected_by_command.items()
        if command in KNOWN_COMMANDS
        and all(version in presence.split(", ") for version in ("2.01U", "2.02c", "2.02e", "2.08b", "4.32"))
    }
    assert len(all_tagger_safe) == 46
    assert known_safe_by_presence["2.08b, 4.32"] == {"CONNECT"}
    assert known_safe_by_presence["4.32"] == {"AS", "IT", "KK", "SP", "UP"}
    assert all(row[2] in {"yes", "**no**"} for row in rows)
    assert all(row[3] in {"known-safe", "denied", "hang-prone", "confirm-required"} for row in rows)
    assert all(row[4] in {"proven", "claimed", "never sent"} for row in rows)
    gaps = {row[0][2:-1] for row in rows if row[2] == "**no**"}
    assert gaps == {"CLEARDEVICE", "FREE", "IRH", "IRL", "IRS", "SER"}
    # The gap rows (F301-F306) are post-MVP research: since 2026-09-25 they live in docs/post-mvp.md.
    followups = "\n".join((REPO / "docs" / name).read_text(encoding="utf-8") for name in ("FOLLOWUPS.md", "post-mvp.md"))
    assert all(f"`${command}`" in followups for command in gaps), gaps
    bench = {row[0][2:-1]: row[4] for row in rows}
    assert all(bench[command] == "proven" for command in {"BUMP", "DPLAY", "IRTX", "STUN", "TMP"})
    for row in rows:
        command = row[0][2:-1]
        expected = ("denied" if command in DENIED_COMMANDS else
                    "hang-prone" if command in HANG_PRONE_COMMANDS else
                    "confirm-required" if command in CONFIRM_REQUIRED_COMMANDS else
                    "known-safe" if command in KNOWN_COMMANDS else "confirm-required")
        assert row[3] == expected, (command, row[3], expected)
    assert set(CONFIRM_REQUIRED_COMMANDS) == {"PRES", "INVU", "BHIT", "FIREX"}

    taggers = ("2.01U", "2.02c", "2.02e", "2.08b", "4.32")
    headsets = ("H1.27", "H1.34")

    def version_gate(present: set[str]) -> str:
        guns = tuple(version for version in taggers if version in present)
        heads = tuple(version for version in headsets if version in present)
        if guns == taggers and heads == headsets:
            return "all sampled taggers/headsets"
        if guns == taggers:
            return "all sampled taggers"
        if guns == taggers[1:]:
            return "tagger 2.02c+ sampled"
        if guns == taggers[3:] and heads == headsets:
            return "tagger 2.08b+ / headset 1.27+ sampled"
        if guns == taggers[3:]:
            return "tagger 2.08b+ sampled"
        if guns == (taggers[-1],):
            return "tagger 4.32 only sampled"
        if guns == (taggers[0],):
            return "legacy: tagger 2.01U only"
        if guns == taggers[:-1] and heads == headsets:
            return "legacy tagger / headset 1.27+ sampled"
        if guns == taggers[:-1]:
            return "legacy: tagger through 2.08b"
        if guns == taggers[1:-1]:
            return "legacy: tagger 2.02c-2.08b"
        if guns == (taggers[3],):
            return "legacy: tagger 2.08b only"
        if not guns and heads == headsets:
            return "headset 1.27+ sampled"
        raise AssertionError((guns, heads))

    for row in rows:
        expected = version_gate(set(row[1].split(", ")))
        assert row[5] == expected, (row[0], row[5], expected)

    assert "`v2.01U`" in doc and "`v4.32`" in doc
    assert "H1.27 embeds `MK128V1.27`" in doc
    assert "H1.34 embeds `1.34` in its `$HFIRM` response data" in doc
    summary = " ".join(doc.split())
    assert "automatically sendable vocabulary, 46 names occur in all sampled tagger images" in summary
    assert "`$CONNECT` is the only later known-safe addition before v4.32" in summary
    assert "Five known-safe names occur only in the v4.32 image: `$AS`, `$IT`, `$KK`, `$SP` and `$UP`" in summary
    assert "Presence never overrides the safety column" in doc
