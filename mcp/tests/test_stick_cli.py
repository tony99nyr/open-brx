"""Unit tests for hardware/m5sticks3/tools/stick.py's pure parts (argv construction, port
selection, STATUS parsing, sketch staging).

`stick.py` never imports pyserial or bleak itself -- every real serial/BLE action shells out to
Windows-side programs -- so it imports cleanly under bare system python3 and needs no hardware.
Run: cd mcp && python3 run_tests.py stick_cli
"""
from __future__ import annotations

import importlib.util
import pathlib
import tempfile

REPO = pathlib.Path(__file__).resolve().parents[2]
STICK_PY = REPO / "hardware" / "m5sticks3" / "tools" / "stick.py"
SKETCH_DIR = REPO / "hardware" / "m5sticks3"

_spec = importlib.util.spec_from_file_location("stick_cli", STICK_PY)
stick = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(stick)


# ---------------------------------------------------------------------------
# sketch_files / stage
# ---------------------------------------------------------------------------

def test_sketch_files_lists_the_ino_and_headers():
    files = stick.sketch_files(SKETCH_DIR)
    names = {f.name for f in files}
    assert "m5sticks3.ino" in names
    assert {"brx_advert.h", "brx_ir.h", "control_point.h"} <= names
    # nothing else (tools/, test/, README.md) leaks in
    assert all(f.suffix in (".ino", ".h") for f in files)


def test_stage_copies_into_its_own_temp_dir():
    # own temp dir per test (parallel-safe): never the real Windows stage path.
    with tempfile.TemporaryDirectory() as td:
        dest = pathlib.Path(td) / "m5sticks3"
        copied = stick.stage(SKETCH_DIR, dest)
        assert len(copied) == len(stick.sketch_files(SKETCH_DIR))
        assert (dest / "m5sticks3.ino").read_text() == (SKETCH_DIR / "m5sticks3.ino").read_text()


def test_stage_is_idempotent():
    with tempfile.TemporaryDirectory() as td:
        dest = pathlib.Path(td) / "m5sticks3"
        stick.stage(SKETCH_DIR, dest)
        second = stick.stage(SKETCH_DIR, dest)  # re-stage, e.g. after an edit
        assert len(second) == len(stick.sketch_files(SKETCH_DIR))


# ---------------------------------------------------------------------------
# argv construction -- every Windows call is an argv list, never a shell string
# ---------------------------------------------------------------------------

def test_ports_argv_uses_windows_python_with_dash_c():
    argv = stick.ports_argv(win_python="/mnt/c/fake/python.exe")
    assert argv[0] == "/mnt/c/fake/python.exe"
    assert argv[1] == "-c"
    assert "list_ports" in argv[2]


def test_compile_argv_shape():
    argv = stick.compile_argv(cli_exe="ARDUINO_CLI", fqbn="FQBN", board_url="URL", win_path="WINPATH")
    assert argv[0] == "ARDUINO_CLI"
    assert argv[1] == "compile"
    assert "--fqbn" in argv and argv[argv.index("--fqbn") + 1] == "FQBN"
    assert "--additional-urls" in argv and argv[argv.index("--additional-urls") + 1] == "URL"
    assert argv[-1] == "WINPATH"
    assert "--build-property" not in argv  # the default build: revive feedback off


def test_compile_argv_revive_on_passes_the_define_as_a_build_property():
    argv = stick.compile_argv(cli_exe="ARDUINO_CLI", fqbn="FQBN", board_url="URL", win_path="WINPATH", revive_on=True)
    i = argv.index("--build-property")
    assert argv[i + 1] == "compiler.cpp.extra_flags=-DBRX_REVIVE_FEEDBACK=1"
    assert argv[-1] == "WINPATH"


def test_upload_argv_includes_port():
    argv = stick.upload_argv("COM7", cli_exe="ARDUINO_CLI", fqbn="FQBN", board_url="URL", win_path="WINPATH")
    assert argv[0] == "ARDUINO_CLI"
    assert argv[1] == "upload"
    assert "-p" in argv and argv[argv.index("-p") + 1] == "COM7"
    assert argv[-1] == "WINPATH"


def test_cmd_argv_passes_port_secs_and_each_command_separately():
    argv = stick.cmd_argv("COM9", 3.5, ["STATUS", "MODE HILL"], win_python="PYEXE", sercmd_path="SERCMD")
    assert argv == ["PYEXE", "SERCMD", "COM9", "3.5", "STATUS", "MODE HILL"]


def test_cmd_argv_defaults_to_the_sibling_sercmd_script():
    argv = stick.cmd_argv("COM9", 1.0, [], win_python="PYEXE")
    assert argv[1].endswith("sercmd.py")


def test_ble_argv_omits_secs_when_not_given():
    argv = stick.ble_argv(None, win_python="PYEXE", blescan_path="BLESCAN")
    assert argv == ["PYEXE", "BLESCAN"]


def test_ble_argv_includes_secs_when_given():
    argv = stick.ble_argv(12.0, win_python="PYEXE", blescan_path="BLESCAN")
    assert argv == ["PYEXE", "BLESCAN", "12.0"]


# ---------------------------------------------------------------------------
# port classification and selection
# ---------------------------------------------------------------------------

def test_classify_port_labels_stick_firmware():
    assert "Stick" in stick.classify_port(stick.STICK_VID, stick.STICK_PID_FW, "ABC123")


def test_classify_port_labels_stick_factory():
    assert "factory" in stick.classify_port(stick.STICK_VID, stick.STICK_PID_FACTORY, "ABC123")


def test_classify_port_labels_stick_unknown_pid():
    label = stick.classify_port(stick.STICK_VID, 0xBEEF, "ABC123")
    assert "Stick" in label and "beef" in label.lower()


def test_classify_port_labels_rig_receiver_and_emitter():
    assert stick.classify_port(stick.RIG_VID, 0x55D4, "5C93045958") == "IR rig receiver"
    assert stick.classify_port(stick.RIG_VID, 0x55D4, "5C4C136487") == "IR rig emitter"


def test_classify_port_labels_unknown_rig_serial_and_other_vendors():
    assert "unknown serial" in stick.classify_port(stick.RIG_VID, 0x55D4, "DEADBEEF01")
    assert stick.classify_port(0x1234, 0x0001, "X") == "unknown"


def test_parse_ports_json_reads_one_dict_per_line():
    raw = (
        '{"device": "COM9", "vid": 12346, "pid": 4097, "serial": "ABC"}\n'
        '\n'
        '{"device": "COM3", "vid": 6790, "pid": 22004, "serial": "5C93045958"}\n'
    )
    ports = stick.parse_ports_json(raw)
    assert len(ports) == 2
    assert ports[0]["device"] == "COM9"
    assert ports[1]["serial"] == "5C93045958"


def test_select_stick_port_finds_the_one_stick():
    ports = [
        {"device": "COM3", "vid": stick.RIG_VID, "pid": 0x55D4, "serial": "5C93045958"},
        {"device": "COM9", "vid": stick.STICK_VID, "pid": stick.STICK_PID_FW, "serial": "X"},
    ]
    assert stick.select_stick_port(ports) == "COM9"


def test_select_stick_port_explicit_picks_among_sticks():
    ports = [{"device": "COM9", "vid": stick.STICK_VID, "pid": stick.STICK_PID_FW, "serial": "X"},
             {"device": "COM11", "vid": stick.STICK_VID, "pid": stick.STICK_PID_FW, "serial": "Y"}]
    assert stick.select_stick_port(ports, explicit="com11") == "COM11"


def test_select_stick_port_explicit_refuses_a_rig_board():
    # a mistyped --port must never reach a CH343 rig board (review round 1)
    ports = [{"device": "COM7", "vid": stick.RIG_VID, "pid": 0x55D3, "serial": "5C93045958"},
             {"device": "COM9", "vid": stick.STICK_VID, "pid": stick.STICK_PID_FW, "serial": "X"}]
    try:
        stick.select_stick_port(ports, explicit="COM7")
    except SystemExit as e:
        assert "not a Stick" in str(e)
    else:
        raise AssertionError("an explicit rig-board port was accepted")


def test_select_stick_port_explicit_refuses_an_unknown_port():
    ports = [{"device": "COM9", "vid": stick.STICK_VID, "pid": stick.STICK_PID_FW, "serial": "X"}]
    try:
        stick.select_stick_port(ports, explicit="COM5")
    except SystemExit as e:
        assert "not an enumerated port" in str(e)
    else:
        raise AssertionError("an unknown explicit port was accepted")


def test_select_stick_port_refuses_when_none_found():
    ports = [{"device": "COM3", "vid": stick.RIG_VID, "pid": 0x55D4, "serial": "5C93045958"}]
    try:
        stick.select_stick_port(ports)
        assert False, "expected SystemExit"
    except SystemExit as e:
        assert "0x303a" in str(e)


def test_select_stick_port_refuses_when_ambiguous():
    ports = [
        {"device": "COM9", "vid": stick.STICK_VID, "pid": stick.STICK_PID_FW, "serial": "A"},
        {"device": "COM11", "vid": stick.STICK_VID, "pid": stick.STICK_PID_FW, "serial": "B"},
    ]
    try:
        stick.select_stick_port(ports)
        assert False, "expected SystemExit"
    except SystemExit as e:
        assert "COM9" in str(e) and "COM11" in str(e)


# ---------------------------------------------------------------------------
# STATUS parsing
# ---------------------------------------------------------------------------

def test_parse_status_reads_key_value_fields():
    line = ("1758000000.123 STATUS mode=BRIDGE owner=-1 charges=0,0,0,0 captures=0 seq=0 "
            "adverts=0 words=3 id=0 game=0 txpin=46 uuid=abcd1234")
    fields = stick.parse_status([line])
    assert fields["mode"] == "BRIDGE"
    assert fields["owner"] == "-1"
    assert fields["charges"] == [0, 0, 0, 0]
    assert fields["words"] == "3"
    assert fields["uuid"] == "abcd1234"


def test_parse_status_ignores_other_lines_and_finds_status_among_them():
    lines = [
        "1758000000.000 # BRX StickS3 station ready",
        "1758000000.500 STATUS mode=HILL owner=1 charges=5,0,0,0 captures=2 seq=4 adverts=4 "
        "words=9 id=1 game=0 txpin=10 uuid=deadbeef",
    ]
    fields = stick.parse_status(lines)
    assert fields["mode"] == "HILL"
    assert fields["charges"] == [5, 0, 0, 0]


def test_parse_status_returns_none_when_absent():
    assert stick.parse_status(["1758000000.000 PONG"]) is None


def test_stage_removes_a_stale_sketch_file():
    # a renamed or deleted header must not keep compiling from the staging folder (review round 1)
    with tempfile.TemporaryDirectory() as tmp:
        dest = pathlib.Path(tmp) / "m5sticks3"
        dest.mkdir()
        (dest / "gone.h").write_text("// stale")
        (dest / "notes.txt").write_text("kept: not a sketch file")
        stick.stage(SKETCH_DIR, dest)
        assert not (dest / "gone.h").exists()
        assert (dest / "notes.txt").exists()

