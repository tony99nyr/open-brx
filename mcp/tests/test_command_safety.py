"""The three-tier command rail (protocol.py): KNOWN (send), DENIED (never, confirm or not), unknown (confirm).

2026-09-18: the V4_30/V4_31 firmware disassembly, Battle Company's command sheets and the 2018 BC app
(all from LaserTagMods' drive) named 85 commands our docs did not have. Some alter persistent state,
re-pair or re-flash a radio, switch the IR word format, or block the gun's main loop with the serial
port unread (`$DPLAY`: the likely screamer mechanism). Those go on `DENIED_COMMANDS`, which
`confirm=true` does NOT override, and the same list reaches the phone as `NODE_DENIED_COMMANDS`
through the generated contract. Useful commands whose versions agree (`$STUN,<ms>`, `$BUMP` in its
5-field shape, `$TMP`, ...) are KNOWN with their arity, but flagged `proven=False` until the bench shows
them on v4.32. Version-conflicted `$PRES`, `$INVU`, `$BHIT` and `$FIREX` require explicit confirmation.

Run: python3 run_tests.py command_safety
"""
from __future__ import annotations

import pathlib
import re

from brx_mcp import protocol
from brx_mcp.fake import FakeTagger
from brx_mcp.mc import envelope as E
from brx_mcp.mc.compile import Compiler, assert_no_denied_frames, golden_bundle
from _session import match_config
from _async import run
from _server_stub import fake_server_manager, server

REPO = pathlib.Path(__file__).resolve().parents[2]
GEN_JS = REPO / "app" / "src" / "transport" / "contract.gen.js"
GEN_TS = REPO / "webapp" / "mc" / "src" / "api" / "contract.gen.ts"


# ---- the tables themselves ------------------------------------------------------------------------
def test_the_tiers_do_not_overlap_and_every_denied_entry_says_why():
    denied = set(protocol.DENIED_COMMANDS) | set(protocol.HANG_PRONE_COMMANDS)
    assert not denied & set(protocol.KNOWN_COMMANDS), "a command cannot be both"
    assert not set(protocol.CONFIRM_REQUIRED_COMMANDS) & set(protocol.KNOWN_COMMANDS)
    assert not set(protocol.CONFIRM_REQUIRED_COMMANDS) & denied
    assert not set(protocol.DENIED_COMMANDS) & set(protocol.HANG_PRONE_COMMANDS)
    for name, reason in {**protocol.DENIED_COMMANDS, **protocol.HANG_PRONE_COMMANDS}.items():
        assert name == name.upper() and reason.strip(), name
    assert protocol.KNOWN_SAFE_COMMANDS == frozenset(protocol.KNOWN_COMMANDS)
    assert protocol.ALL_DENIED_COMMANDS == frozenset(denied)


def test_the_brick_and_hang_classes_are_all_denied():
    """One name per class the brief lists: factory reset, pairing/PIN, DFU, clear paired devices, the IR
    word-format switch, zombie toggles, the laser CW (duty) test, the SETUP console word, and $DPLAY."""
    for name in ("FACTORY", "PAIR", "PIN", "CDFU", "HEADDFU", "DDFU", "CLEARDEVICE", "IRT",
                 "ZOM", "ZTOG", "ZON", "ZOFF", "BOOM", "ZOMBIEKEYACTIVE", "DUTY", "SETUP",
                 "RESET", "SITE", "DTYPE", "DEV", "FTST", "BURN", "SOL", "GPAIR", "GPAIRX"):
        assert name in protocol.DENIED_COMMANDS, name
    assert "DPLAY" in protocol.HANG_PRONE_COMMANDS and protocol.is_denied("$DPLAY,A10,4,*")


def test_a_hang_prone_frame_needs_both_flags_on_send_and_never_goes_in_a_batch():
    """The bench makes a screamer on demand with $DPLAY (levers sheet §14.4); nothing else may send it."""
    with fake_server_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        for kw in ({}, {"confirm": True}, {"allow_hang": True}):
            result = run(server.send("t1", "$DPLAY,A10,4,*", **kw))
            assert result["error"].startswith("refused, confirm or not:") and "allow_hang" in result["error"], (kw, result)
        assert len(mgr.sessions["t1"].buffer) == 0
        result = run(server.send("t1", "$DPLAY,A10,4,*", confirm=True, allow_hang=True))
        assert result["sent"] == "$DPLAY,A10,4,*" and "HANG-PRONE" in result["note"], result
        # the persistent class has no override at all
        result = run(server.send("t1", "$FACTORY,*", confirm=True, allow_hang=True))
        assert result["error"].startswith("refused, confirm or not:"), result
        result = run(server.send_batch("t1", ["$PING,*", "$DPLAY,A10,4,*"], confirm=True))
        assert result["error"].startswith("refused, confirm or not:") and result["command"] == "$DPLAY,A10,4,*"


def test_the_newly_understood_commands_are_known_with_arity_and_the_right_proof_flag():
    expect = {"STUN": 1, "BUMP": 5, "LIFE": 4, "TMP": 11,
              "DIE": 0, "TEAM": 1, "PID": 1, "IRTX": 11, "RADSK": 0, "UP": 3, "KK": 1}
    for name, tokens in expect.items():
        info = protocol.KNOWN_COMMANDS[name]
        assert info.tokens == tokens, (name, info)
    unproven = {n for n, i in protocol.KNOWN_COMMANDS.items() if not i.proven}
    assert {"DIE", "TEAM", "PID", "RADSK"} <= unproven
    # bench-proven since (2026-09-18): the caveat on every send would now be false
    for name in ("STUN", "BUMP", "TMP", "IRTX"):
        assert protocol.KNOWN_COMMANDS[name].proven, name
    assert set(protocol.CONFIRM_REQUIRED_COMMANDS) == {"PRES", "INVU", "BHIT", "FIREX"}
    assert protocol.KNOWN_COMMANDS["SPAWN"].tokens is None  # v4.30 shield arg vs corrected v4.32 no-arg path
    # the bench-proven core is still marked proven (a regression here would nag every bench call)
    for name in ("PING", "CLEAR", "START", "SPAWN", "GSET", "PSET", "WEAP", "SIR", "BMAP", "TID", "AMMO", "LIFE", "SFLASH"):
        assert protocol.KNOWN_COMMANDS[name].proven, name
    # every command that was on the old flat list is still known
    for name in ("PING", "CLEAR", "START", "SPAWN", "CONNECT", "INIT", "PHONE", "GSET", "PSET", "WEAP", "SIR",
                 "BMAP", "GLED", "PLAY", "AS", "SP", "PBWEAP", "PBTEAM", "PBPERK", "TID", "AMMO", "STOP", "PLAYX",
                 "VOL", "HLED", "NAME", "VERSION", "HLOOP", "BLINK", "LED", "SFLASH"):
        assert protocol.is_known_safe(f"${name},*"), name


def test_deny_reason_names_the_word_and_catches_the_radio_control_frames():
    assert protocol.deny_reason("$FACTORY,*") and "FACTORY" in protocol.deny_reason("$FACTORY,*")
    assert "screamer" in protocol.deny_reason("$DPLAY,A10,4,*")
    assert protocol.is_denied("$dplay,A10,4,*"), "case-insensitive: the word is upper-cased before the lookup"
    for f in ("$!FSFORMAT,*", "$^RESET,*", "$&FWRNAME,x,*"):
        assert protocol.is_denied(f), f
    for f in ("$PING,*", "$STUN,3000,*", "$FOOBAR,1,*", "$PLAY,A10,4,6,,,,,*"):
        assert protocol.deny_reason(f) is None, f


def test_unproven_and_arity_notes():
    assert protocol.unproven_note("$PING,*") is None
    n = protocol.unproven_note("$TEAM,2,*")
    assert n and "NOT bench-proven" in n and "TEAM" in n
    assert protocol.unproven_note("$STUN,3000,*") is None, "bench-proven since 2026-09-18: no caveat"
    assert protocol.arity_note("$TEAM,2,*") is None
    a = protocol.arity_note("$TEAM,2,1,2,*")
    assert a and "carries 3 tokens" in a and "reads 1" in a
    assert protocol.arity_note("$FOOBAR,1,2,3,*") is None, "unknown commands have no counted arity"


# ---- the instrument (server.py) --------------------------------------------------------------------
def test_send_refuses_a_denied_command_even_with_confirm_true():
    with fake_server_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        for cmd in ("$FACTORY,*", "$DPLAY,A10,4,*", "$!FSFORMAT,*"):
            result = run(server.send("t1", cmd, confirm=True))
            assert "error" in result and result["error"].startswith("refused, confirm or not:"), result
            assert result["command"] == cmd
        assert len(mgr.sessions["t1"].buffer) == 0, "nothing reached the tagger"


def test_version_conflicted_commands_require_explicit_confirm():
    with fake_server_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        frames = ("$PRES,0,0,-50,*", "$INVU,*", "$BHIT,8,*", "$FIREX,1,2,3,4,5,*")
        for frame in frames:
            refused = run(server.send("t1", frame))
            assert "known-safe" in refused["error"], (frame, refused)
            sent = run(server.send("t1", frame, confirm=True))
            assert sent["sent"] == frame and "provisional" in sent["note"], (frame, sent)


def test_send_batch_refuses_the_whole_batch_on_one_denied_command_even_with_confirm():
    with fake_server_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        result = run(server.send_batch("t1", ["$PING,*", "$CDFU,*", "$PING,*"], confirm=True))
        assert result["error"].startswith("refused, confirm or not:") and result["command"] == "$CDFU,*", result
        assert len(mgr.sessions["t1"].buffer) == 0


def test_send_lets_an_unproven_known_command_through_and_says_so():
    with fake_server_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        result = run(server.send("t1", "$TEAM,2,*"))             # no confirm needed: it is KNOWN
        assert result["sent"] == "$TEAM,2,*" and "NOT bench-proven" in result["note"], result
        result = run(server.send("t1", "$PING,*"))
        assert "note" not in result, "a proven command carries no caveat"
        result = run(server.send_batch("t1", ["$PING,*", "$PID,5,*"]))
        assert result["sent_count"] == 2 and "PID" in result["note"], result


def test_the_deny_gate_runs_before_the_confirm_gate_and_is_load_bearing():
    """Break deny_reason and the same denied command, with confirm=True, goes straight through."""
    old = protocol.deny_reason
    protocol.deny_reason = lambda _c, **_kw: None
    try:
        with fake_server_manager([FakeTagger("AA:1")]) as mgr:
            run(mgr.connect("AA:1", "t1"))
            result = run(server.send("t1", "$FACTORY,*", confirm=True))
            assert result.get("sent") == "$FACTORY,*", result
    finally:
        protocol.deny_reason = old


# ---- the node side: generated contract + compile guard ---------------------------------------------
def _js_upper_set(name: str) -> set[str]:
    m = re.search(rf"export const {name} = new Set\(\[(.*?)\]\)", GEN_JS.read_text(encoding="utf-8"), re.S)
    assert m, f"{name} not in contract.gen.js -- run python3 mcp/tools/gen_contract.py"
    return set(re.findall(r"'([A-Z_]+)'", m.group(1)))


def test_the_node_deny_list_is_the_instrument_deny_list_and_reaches_both_generated_copies():
    assert E.NODE_DENIED_COMMANDS == protocol.ALL_DENIED_COMMANDS and "DPLAY" in E.NODE_DENIED_COMMANDS
    assert _js_upper_set("NODE_DENIED_COMMANDS") == set(protocol.ALL_DENIED_COMMANDS)
    ts = GEN_TS.read_text(encoding="utf-8")
    m = re.search(r"export const NODE_DENIED_COMMANDS = \[(.*?)\] as const;", ts)
    assert m and set(re.findall(r"'([A-Z_]+)'", m.group(1))) == set(protocol.ALL_DENIED_COMMANDS)


def test_no_compiled_bundle_carries_a_denied_frame_and_the_guard_is_load_bearing():
    C = Compiler()
    teams = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
             {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 2}]
    player = {"player_id": "p7", "player_num": 7, "display": "REAPER", "team_id": "blue", "node_id": None,
              "gun_id": None, "voice": "male", "ready": True,
              "loadout": {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "shotgun"}]}}
    for mode in ("tdm", "ffa", "koth", "infection"):
        assert_no_denied_frames(C.compile(match_config(mode, teams=teams), player, teams))
    assert_no_denied_frames(golden_bundle())
    b = dict(golden_bundle())
    b["cues"] = dict(b["cues"], klaxon="$DPLAY,A10,4,*")
    try:
        assert_no_denied_frames(b)
    except ValueError as e:
        assert "DENY-LIST GUARD" in str(e) and "DPLAY" in str(e)
    else:
        raise AssertionError("a bundle carrying $DPLAY must be refused at compile time")


def test_a_denied_word_cannot_hide_behind_a_star_or_whitespace():
    # `$FACTORY*` has no comma, so the old first-token split read the word as 'FACTORY*' and let it by.
    for frame in ("$FACTORY*", "$DPLAY*", "$ FACTORY,*", "$FACTORY\t,*", "$dplay *"):
        assert protocol.deny_reason(frame), frame
    assert protocol.deny_reason("$PLAY,U37,3,10,,,,,*") is None


def test_ztog_and_cleardevice_are_denied_and_free_needs_confirm():
    """Safety guard A (brx-rea firmware pass 2, a code read): $ZTOG,1 turns zombie mode on, keeps it across a power
    cycle and stops the gun's $HIT reports. $CLEARDEVICE wipes the radio's pair list. $FREE is a read-only query of
    the audio-channel busy flags: not denied, so it takes the unknown-command path and needs confirm=true."""
    for f in ("$ZTOG,1,*", "$ZTOG,0,*", "$CLEARDEVICE,*"):
        assert protocol.is_denied(f), f
    assert "power cycle" in protocol.deny_reason("$ZTOG,1,*")
    assert "ZTOG" in E.NODE_DENIED_COMMANDS and "CLEARDEVICE" in E.NODE_DENIED_COMMANDS, "the node refuses them too"
    assert not protocol.is_denied("$FREE,*") and not protocol.is_known_safe("$FREE,*")
    with fake_server_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        result = run(server.send("t1", "$ZTOG,1,*", confirm=True))
        assert result["error"].startswith("refused, confirm or not:"), result
        result = run(server.send("t1", "$FREE,*"))
        assert "confirm=true" in result["error"], result
        assert len(mgr.sessions["t1"].buffer) == 0
        result = run(server.send("t1", "$FREE,*", confirm=True))
        assert result.get("sent") == "$FREE,*", result

def test_validate_frame_refuses_a_weap_slot_above_11_and_a_damage_above_255():
    """Safety guard B (brx-rea firmware pass 2, a code read): the gun has twelve weapon slots and one byte of damage.
    Slot 12 writes past its tables, 13 or more lands on slot 0, and a damage above 255 wraps. validate_frame refuses
    them; the BLE manager and the raw-bytes plan check are pinned in the next test."""
    head = "$WEAP,{slot},1,5,1,2,{dmg},0,*"
    assert protocol.validate_frame(head.format(slot=11, dmg=255)) is None
    assert protocol.validate_frame(head.format(slot=0, dmg="")) is None, "an empty token leaves the value alone"
    for slot, dmg, word in ((12, 45, "slot"), (255, 45, "slot"), (0, 256, "damage"), (3, 1000, "damage")):
        why = protocol.validate_frame(head.format(slot=slot, dmg=dmg))
        assert why and word in why, (slot, dmg, why)
    for f in ("$WEAP,-1,1,5,1,2,45,0,*", "$WEAP,0,1,5,1,2,-3,0,*"):
        assert protocol.validate_frame(f), f
    with fake_server_manager([FakeTagger("AA:1")]) as mgr:
        run(mgr.connect("AA:1", "t1"))
        result = run(server.send("t1", head.format(slot=0, dmg=300), confirm=True))
        assert "error" in result and "damage" in result["error"], result
        assert len(mgr.sessions["t1"].buffer) == 0



def test_every_writer_refuses_an_out_of_range_weap_and_reads_the_leading_integer_as_the_gun_does():
    """Guard B on the writers that do not call validate_frame (the CLI, the stage, the soak and tools write through
    the BLE manager), and on raw bytes. The gun reads a token's leading integer, so `+12` and `300.0` are refused."""
    from brx_mcp.rawbytes import plan_from_stream, validate_plan
    for f in ("$WEAP,+12,1,5,1,2,45,0,*", "$WEAP,0,1,5,1,2,300.0,0,*", "$WEAP,0,1,5,1,2,300x,0,*", "$WEAP, 13,1,5,1,2,45,0,*"):
        assert protocol.weap_range_error(f) and protocol.validate_frame(f), f
    for f in ("$WEAP,<slot>,1,5,1,2,45,0,*", "$WEAP,11,1,5,1,2,+255,0,*", "$PSET,0,0,999,70,70,50,*"):
        assert protocol.weap_range_error(f) is None, f
    bad = "$WEAP,12,1,5,1,2,45,0,*"
    try:
        from brx_mcp.ble import ConnectionManager
    except ImportError:                      # system python has no bleak: the real manager cannot load here
        ConnectionManager = None
    if ConnectionManager is not None:
        writes: list[bytes] = []

        class _Session:
            seq = 0; write_lock = None; client = None
            def record(self, *a): pass

        mgr = ConnectionManager()
        mgr._get = lambda alias: _Session()
        async def _write(client, data, lock, *a, **k): writes.append(data)
        mgr._write = _write
        for call in (lambda: mgr.send("t1", bad), lambda: mgr.send_batch("t1", ["$PING,*", bad]),
                     lambda: mgr.send_phone_paced("t1", bad, chunk_gap_ms=20, frame_gap_ms=0)):
            try:
                run(call())
                raise AssertionError("the BLE manager wrote an out-of-range $WEAP")
            except ValueError as e:
                assert "slot" in str(e), e
        assert writes == [], "nothing reached the gun, not even the $PING before it"
    with fake_server_manager([FakeTagger("AA:1")]) as fake:
        run(fake.connect("AA:1", "t1"))
        try:
            run(fake.send("t1", bad))
            raise AssertionError("the fake manager wrote what the real one refuses")
        except ValueError as e:
            assert "slot" in str(e), e
    try:
        validate_plan(plan_from_stream(bad.encode()), confirm=True)
        raise AssertionError("a raw-bytes plan carried an out-of-range $WEAP")
    except ValueError as e:
        assert "slot" in str(e), e
