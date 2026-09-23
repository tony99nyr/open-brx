"""BRX serial protocol helpers: framing validation, tokenization, event parsing.

Reference: protocol/brx-protocol.md (draft v0.1).
Messages are ASCII, comma-delimited, start with $COMMAND, end with ,*
Empty tokens mean "leave unchanged / not applicable".
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

# Nordic UART Service (Gen2/3 BLE transport)
def is_pool_probe(frame: str) -> bool:
    """F264: is this `$LIFE` frame a PROBE rather than a pool change?

    THE HAZARD. The F264 dead-gun probe and every shield-regen grant are BOTH `$LIFE` frames, so the
    command WORD cannot tell a question from a pool change. On the wire they are still distinguishable,
    but only by VALUE: a `$LIFE` whose pool tokens are all zero or absent moves nothing, by definition,
    so it can never be a grant. Nothing makes a reader look, which is how five shield tests went red the
    hour the probe shipped (2026-09-19): they counted `$LIFE` writes and counted probes as grants.

    This is the Python twin of `engine.js`'s `isPoolProbe`, and it lives HERE rather than in the stage
    because the readers that need it most are the ones no test of ours guards: `mc.diag`, a frame-ring
    scan, anything reading a session file months from now.

    It cannot be fixed on the wire. We never modify firmware, the command set is fixed, and `$LIFE` is
    the only command that answers with the POOLS and changes nothing (`$PING` answers `$PONG` with no
    pools, `$VERSION` carries none). And it cuts both ways: `$LIFE,<hp>,0,0,1,*` is a REVIVE, so one
    token separates the safest question we have from one of the most destructive writes we have.
    """
    if not isinstance(frame, str):
        return False
    f = frame.strip()
    if not f.startswith("$LIFE,"):
        return False
    t = f.rstrip("*").rstrip(",").split(",")

    def _is_zero(i: int) -> bool:
        if i >= len(t) or t[i] == "":
            return True
        try:
            return float(t[i]) == 0
        except ValueError:
            return False

    # NUMERIC, not a string match against "0" -- `engine.js`'s twin tests `Number(t[i]) === 0`, so
    # `$LIFE,00,0,0,*`/`$LIFE,-0,0,0,*` are zero-effect probes there. A string check said otherwise
    # here, which is exactly the divergence this predicate exists to prevent between the two sides.
    return all(_is_zero(i) for i in (1, 2, 3))


NUS_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
NUS_RX_CHAR_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"  # write to tagger
NUS_TX_CHAR_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"  # notify from tagger

# Tokens may not contain a comma, '*', or a line break; frame must end at \Z
# (so an embedded newline can't smuggle a second frame past validation).
_FRAME_RE = re.compile(r"^\$[A-Z0-9!]+(,[^,*\r\n]*)*,\*\Z")

# ---------------------------------------------------------------------------------------------
# The command safety rail: three tiers, one table each.
#
#   KNOWN_COMMANDS   understood shape + effect; the instrument sends them without confirm=true.
#                    `proven` says whether OUR v4.32 guns have shown the effect on the bench. An
#                    unproven entry comes from firmware disassembly, Battle Company's own command
#                    sheets or the 2018 BC app (all via LaserTagMods' drive, 2026-09-18); the
#                    instrument sends it but says so in the reply. `tokens` = how many tokens the
#                    handler reads after the command word where the available versions agree. None
#                    marks a version conflict that bench has not settled.
#   DENIED_COMMANDS  never sent, confirm or not: persistent state, pairing/DFU, an IR word-format
#                    switch, factory tests, or a path that BLOCKS the gun's main loop (the screamer
#                    mechanism). The reason is the value. The node (phone) refuses these too, via
#                    `NODE_DENIED_COMMANDS` in mc/envelope.py -> the generated contract.
#   anything else    unknown: needs confirm=true (the caller opts in, and the write is logged).
#
# Evidence tags in the notes: [bench] our guns · [disasm] V4_30/V4_31 firmware image · [sheet] BC's
# command spreadsheets · [apk2018] BC's 2018 Battle Royale app · [jay] LaserTagMods' ESP32 sources.
# ---------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class CommandInfo:
    tokens: int | None      # tokens the handler reads (None = not counted)
    proven: bool            # effect shown on OUR v4.32 guns
    note: str


def _c(tokens: int | None, proven: bool, note: str) -> CommandInfo:
    return CommandInfo(tokens, proven, note)


KNOWN_COMMANDS: dict[str, CommandInfo] = {
    # -- lifecycle and configuration (protocol §3.1) -----------------------------------------------
    "PING": _c(0, True, "[bench] -> $PONG"),
    "CLEAR": _c(0, True, "[bench] wipes game state AND the $SIR table (F11): re-send $SIR after it"),
    "START": _c(0, True, "[bench] config mode; [disasm] also ARMS IR reception ($STOP disarms it)"),
    "STOP": _c(0, True, "[bench] first frame of every connect; [disasm] drops every IR word while set"),
    "SPAWN": _c(None, True, "[bench] $SPAWN,,* goes live; [disasm] v4.30 reads starting shield but corrected v4.32 consumes no argument; A/B unproven"),
    "CONNECT": _c(0, True, "[bench] no reply on v4.32"),
    "INIT": _c(0, True, "[bench] no reply on v4.32"),
    "PHONE": _c(0, True, "[bench] opens the event tap"),
    "GSET": _c(8, True, "[bench] 8 tokens"),
    "PSET": _c(23, True, "[bench] t1 player id, t3-t5 pools; [disasm] t2 = TEAM (F206), t6 = crit damage bonus [sheet]"),
    "WEAP": _c(43, True, "[bench] slot 0-5; the 2018 app used slots up to 7"),
    "SIR": _c(8, True, "[bench] the incoming-IR table; fn 0-52 [disasm]"),
    "BMAP": _c(6, True, "[bench] buttons 0-29, functions 0-130 [disasm]"),
    "TID": _c(1, True, "[bench] team 0-3; shares ONE byte with $TEAM and $PSET t2 [disasm]"),
    "AMMO": _c(4, True, "[bench] t4 = 0 add / 1 set / 2 set past max [sheet, apk2018]"),
    "VOL": _c(2, True, "[bench]"),
    "NAME": _c(1, True, "[bench] PERSISTENT gun name (the armory writes it on purpose)"),
    "VERSION": _c(0, True, "[bench]"),
    "QUERY": _c(0, True, "[bench] status array + $LCD; fields t1 id, t2 team, t3-t5 pool maxima [disasm]"),
    "VOLTS": _c(0, True, "[bench] battery telemetry"),
    "PLAY": _c(7, True, "[bench] slot 1 interrupts, slot 4 queues"),
    "PLAYX": _c(0, True, "[bench] stop playback"),
    "SFLASH": _c(0, True, "[bench] the kill-confirm sight flash"),
    "SP": _c(1, True, "[bench] $SP,99 = panic half; [jay] t1 = winner (100 + id, or team id)"),
    "AS": _c(9, False, "[jay] native hosting: $AS,<1 start|2 perk|3 team|4 lock|5 weapon>,...; silent on v4.32 so far"),
    "PBWEAP": _c(1, True, "[bench] a 'game starting' sound on v4.32"),
    "PBTEAM": _c(1, False, "[jay] team for the gun's own hosted game"),
    "PBPERK": _c(1, False, "[jay] perk 0-6 for the gun's own hosted game"),
    "UP": _c(3, False, "[jay] $UP,100,<1 lead change|5 2min|6 1min|7 30s|8 10s>,<arg>; unproven on v4.32"),
    "KK": _c(1, False, "[jay] kill-confirmed count for the killer's own gun; unproven on v4.32"),
    "IT": _c(9, False, "[jay] $IT,<gunId>,4,0,0,0,0,0,75,0 'set player id and lock'; unproven on v4.32"),
    "RADSK": _c(0, False, "[jay] the headset keepalive; JEDGE sends it to the gun every 4 s as a fake headset"),
    # -- in-game effects and pools (protocol §3.2) --------------------------------------------------
    "LIFE": _c(4, True, "[bench] additive, takes negatives (S29/F109: hp and armour 2026-09-09, shields 2026-09-17); [disasm] t4 = 0 add / 1 set clamped / 2 set unclamped"),
    "BUMP": _c(5, False, "[disasm, sheet, apk2018] $BUMP,<amount>,<hp 0/1>,<armour 0/1>,<shield 0/1>,<sound>: a cascade. Our 3-token probe was inert (no flag set); the armour flag is proven on the wire by the 2026-09-18 Callsign capture ($BUMP,12,,1,,,*)"),
    "STUN": _c(1, False, "[disasm, apk2018] $STUN,<ms>: a timed stun. Our bare $STUN,* was 0 ms"),
    "TMP": _c(11, False, "[disasm] pool-max bonuses t1-t3, incoming damage % t8, magazine % t9, default hit sound t11"),
    "DIE": _c(0, False, "[disasm] kill self (in app mode: reports instead)"),
    "TEAM": _c(1, False, "[disasm] same team byte as $TID, no debug print"),
    "PID": _c(1, False, "[disasm] same player id as $PSET t1"),
    "IRTX": _c(11, False, "[sheet, apk2018] transmit one IR word; the gun relays it to the headset emitter [disasm]"),
    "GREN": _c(8, True, "[bench] sent; the emitted bits did not track the arguments"),
    "QFX": _c(1, False, "[disasm] queued sound effect"),
    "QPLAY": _c(1, False, "[disasm] queued play"),
    "QHIT": _c(4, False, "[disasm] queue a two-part hit sound: sound1, vol1 0-9, sound2, vol2 0-9"),
    # -- lights (headset + gun body) ---------------------------------------------------------------
    "GLED": _c(6, True, "[bench] gun body LEDs"),
    "HLED": _c(6, True, "[bench] headset LED"),
    "HLOOP": _c(2, True, "[bench] headset flash loop"),
    "LED": _c(2, True, "[bench] headset flash LED, proven harmless 2026-09-04"),
    "BLINK": _c(5, True, "[bench] headset blink, proven harmless 2026-09-04"),
    "GLOW": _c(5, False, "[disasm, jay] headset glow effect"),
    "SOLID": _c(2, False, "[disasm] headset solid colour"),
    "CHASE": _c(4, False, "[disasm] headset chase effect"),
}

# Back-compat name: the set of command words the instrument sends without confirm=true.
KNOWN_SAFE_COMMANDS = frozenset(KNOWN_COMMANDS)

# Known names whose corrected v4.32 shape/effect conflicts with older evidence. They use the same
# explicit-confirm path as an unknown command until the discriminating bench step settles the version.
CONFIRM_REQUIRED_COMMANDS: dict[str, CommandInfo] = {
    "PRES": _c(None, False, "v4.30 says per-cell damage modifier; corrected v4.32 handler unresolved"),
    "INVU": _c(None, False, "v4.30 says invulnerability/$TMP t8; corrected v4.32 handler unresolved"),
    "BHIT": _c(None, False, "v4.30/sheet say seven-field injected hit; corrected v4.32 consumes one event byte"),
    "FIREX": _c(None, False, "v4.30 says one slot; corrected v4.32 consumes five fields and forwards them"),
}

# Refused outright by the instrument (confirm=true does NOT override) and by the node. Names from
# the V4_30/V4_31 firmware command table and Battle Company's sheets; every one either changes
# persistent state, re-pairs or re-flashes a radio, switches the IR word format, runs a factory test,
# or blocks the gun's main loop with the serial port unread.
DENIED_COMMANDS: dict[str, str] = {
    "FACTORY": "factory restore of the gun's persistent record [disasm]",
    "CDFU": "puts the central BT radio into DFU (bootloader) mode [disasm]",
    "HEADDFU": "puts the headset into DFU (bootloader) mode [disasm]",
    "DDFU": "the v2.x DFU entry [disasm]",
    "CLEARDEVICE": "clears the paired-device record (the headset pairing) [disasm]",
    "RESET": "reset routine of unknown scope; drops the link mid-match at best [disasm]",
    "IRT": "Arena/Retail IR word-format switch: a gun on the other format hears nobody [disasm]",
    "DEV": "developer-mode toggle, persistence unknown [disasm]",
    "DTYPE": "rewrites the device type (gun / gun with gyro) in the factory record [disasm]",
    "SITE": "field/site id change; also flags a later reset to force team 2 [disasm]",
    "TSTRNAME": "writes the tester-name field of the factory record [disasm]",
    "ASKSN": "prints the serial number = the headset PIN, which must not enter a log [disasm]",
    "FTST": "the factory test series [disasm, jay]",
    "BURN": "burn-in test [disasm]",
    "DUTY": "IR / laser duty cycle: a laser continuous-wave test [disasm]",
    "SOL": "solenoid (recoil) test [disasm]",
    "MUZ": "muzzle-flash test [disasm]",
    "VIBTOGGLE": "vibration on/off, persistence unknown [disasm]",
    "GPAIR": "writes the grenade pairing record [disasm]",
    "GPAIRX": "clears the grenade pairing record [disasm]",
    "PAIR": "v2.x Bluetooth pairing [disasm]",
    "PIN": "v2.x Bluetooth PIN [disasm]",
    "INQ": "HC-05 radio inquiry [disasm]",
    "ZOM": "zombie headset mode [sheet]",
    "ZTOG": "zombie mode toggle [sheet]",
    "ZON": "zombie mode on [disasm: headset vocabulary]",
    "ZOFF": "zombie mode off [disasm: headset vocabulary]",
    "BOOM": "zombie 'boomer' headset command [sheet]",
    "ZOMBIEKEYACTIVE": "zombie unlock key [sheet]",
    "SETUP": "the USB console's factory provisioning menu is not a $ command; never send its word over BLE",
}

# Refused like DENIED_COMMANDS, with one exception: the bench may send one ON PURPOSE to make a
# lock-up on demand (levers sheet §14.4), with BOTH `confirm=True` and `allow_hang=True` on `send`.
# The node never sends one; `send_batch` never sends one.
HANG_PRONE_COMMANDS: dict[str, str] = {
    "DPLAY": "plays a sound then BLOCKS the main loop until the channel finishes, serial unread: the likely screamer mechanism [disasm]",
}

# Every command word the NODE refuses: both tables. Mirrored to the phone by mc/envelope.py.
ALL_DENIED_COMMANDS = frozenset(DENIED_COMMANDS) | frozenset(HANG_PRONE_COMMANDS)

# Frames whose command word starts with one of these go between the gun MCU and its own radio
# modules (`$!DFP`, `$^RESET`, `$&FWRNAME`, ...). Never ours to send.
_DENIED_PREFIXES = ("!", "^", "&")

PANIC_SEQUENCE = ["$CLEAR,*", "$SP,99,*"]


def _raw_word(command: str) -> str:
    """The first token as written, `$` stripped, no Gen1 prefix handling. Whitespace and a `*` that
    ends the word are stripped too: `$FACTORY*` or `$ FACTORY,*` must not slip past the deny list."""
    return command.lstrip("$").split(",", 1)[0].strip().rstrip("*").strip()


def deny_reason(command: str, allow_hang: bool = False) -> str | None:
    """Why the instrument and the node refuse this frame outright, or None if it is not denied.

    A denied frame is refused even with confirm=true: it re-pairs, re-flashes, re-formats or
    factory-writes the gun, or it blocks the gun's main loop (`$DPLAY`). Power-cycling does not
    undo the persistent ones, which is what makes them different from every other command.
    `allow_hang=True` lets a HANG_PRONE_COMMANDS frame through (a supervised bench run only)."""
    word = _raw_word(command)
    if word.startswith(_DENIED_PREFIXES):
        return f"'{word}' is a gun<->radio module control frame, never a host command"
    reason = DENIED_COMMANDS.get(word.upper())
    if reason:
        return f"'{word}' is refused: {reason}"
    hang = HANG_PRONE_COMMANDS.get(word.upper())
    if hang and not allow_hang:
        return f"'{word}' is refused: {hang}. A supervised bench run may pass confirm=true AND allow_hang=true"
    return None


def is_denied(command: str) -> bool:
    return deny_reason(command) is not None


def command_info(command: str) -> CommandInfo | None:
    name = command_name(command)
    return KNOWN_COMMANDS.get(name) or CONFIRM_REQUIRED_COMMANDS.get(name)


def unproven_note(command: str) -> str | None:
    """A one-line caveat for a recognized command not yet shown on v4.32, else None."""
    info = command_info(command)
    if info is None or info.proven:
        return None
    return f"'{command_name(command)}' is provisional and NOT bench-proven on v4.32: {info.note}"


def arity_note(command: str) -> str | None:
    """A caveat when a frame carries more tokens than the recorded handler reads."""
    info = command_info(command)
    if info is None or info.tokens is None:
        return None
    n = len(tokenize(command)) - 1
    if n > info.tokens:
        return (f"'{command_name(command)}' carries {n} tokens; the recorded handler reads {info.tokens}, "
                f"the rest are ignored")
    return None


def validate_frame(command: str) -> str | None:
    """Return an error string if the frame is malformed, else None."""
    if not command.startswith("$"):
        return "frame must start with '$'"
    if not command.endswith(",*"):
        return "frame must end with ',*'"
    if not _FRAME_RE.match(command):
        return "frame failed pattern check ($NAME,tokens...,*)"
    return None


def command_name(command: str) -> str:
    """Extract the command word: '$GLED,1,...,*' -> 'GLED'."""
    body = command.lstrip("$")
    # Gen1 replies can be prefixed, e.g. $!DFP,PONG,*
    if body.startswith("!"):
        parts = body.split(",")
        return parts[1] if len(parts) > 1 else parts[0]
    return body.split(",", 1)[0]


def is_known_safe(command: str) -> bool:
    return command_name(command) in KNOWN_SAFE_COMMANDS


def tokenize(message: str) -> list[str]:
    """Split a frame into tokens, stripping the leading $ and trailing *."""
    msg = message.strip()
    if msg.endswith(",*"):
        msg = msg[:-2]
    elif msg.endswith("*"):
        msg = msg[:-1]
    if msg.startswith("$"):
        msg = msg[1:]
    return msg.split(",")


def parse_event(message: str) -> dict[str, Any]:
    """Best-effort semantic parse of a tagger→host message.

    Always returns at least {"command": <name>, "tokens": [...]}.
    Adds typed fields for the messages the protocol doc explains.
    """
    tokens = tokenize(message)
    name = command_name(message)
    parsed: dict[str, Any] = {"command": name, "tokens": tokens}

    def tok(i: int) -> str | None:
        return tokens[i] if i < len(tokens) else None

    if name == "HIR":
        # token 3 = shooter player id (0-63, set via $PSET token 1), token 4 = shooter
        # team ($TID). Both hardware-verified: protocol §7q (player id), §7k (team).
        parsed["shooter_player_id"] = tok(3)
        parsed["shooter_team_id"] = tok(4)
    elif name == "HP":
        # $HP,<hp>,<armor>,<shield>. All three are real, live pools and the drain
        # order is shield -> armor -> HP (bench 2026-08-27). Parsing only <hp> made
        # any damage absorbed by shield or armor invisible -- see FOLLOWUPS Q12.
        def _pool(i):
            raw = tok(i)
            if not raw:
                return None
            try:
                return int(raw)
            except ValueError:
                return raw

        parsed["hp"] = _pool(1)
        parsed["armor"] = _pool(2)
        parsed["shield"] = _pool(3)
        parsed["died"] = parsed.get("hp") == 0
    elif name == "BUT":
        parsed["button"] = tok(1)
    elif name == "PONG":
        parsed["pong"] = True
    elif name == "ALCD":
        parsed.update(parse_alcd(message))
    elif name == "VOLTS":
        parsed.update(parse_volts(message))
    elif name == "VERSION":
        parsed.update(parse_version(message))

    return parsed


def _to_int(s: str | None) -> int | None:
    try:
        return int(s) if s not in (None, "") else None
    except (ValueError, TypeError):
        return None


def parse_alcd(frame: str) -> dict[str, Any]:
    """`$ALCD,<mag>,<100>,<slot>,<reserve>,<heat>,*` — the ammo/weapon HUD stream.

    Token 5 is **weapon heat** (protocol §7j): non-zero only on weapons with an
    overheat mechanic (`$WEAP` t24), rising with sustained fire and resetting after
    cooldown. Observed above 100, so treat it as a raw level, not a percentage.
    Returns {} if not an ALCD frame.
    """
    t = tokenize(frame)
    if not t or t[0] != "ALCD":
        return {}
    heat = _to_int(t[5] if len(t) > 5 else None)
    return {
        "mag": _to_int(t[1] if len(t) > 1 else None),
        "slot": _to_int(t[3] if len(t) > 3 else None),
        "reserve": _to_int(t[4] if len(t) > 4 else None),
        "heat": heat,
        "overheating": bool(heat),
    }


def parse_volts(frame: str) -> dict[str, Any]:
    """`$VOLTS,<pack_mV>,<cell_mV>,<n3>,<n4>,*` battery telemetry.

    e.g. `$VOLTS,7662,3921,55,70,*` → 7.662 V pack, 3.921 V cell; the last two
    tokens read as charge %/levels (exact meaning TBC). Returns {} if not VOLTS.
    """
    t = tokenize(frame)
    if not t or t[0] != "VOLTS":
        return {}
    pack_mv, cell_mv = _to_int(t[1] if len(t) > 1 else None), _to_int(t[2] if len(t) > 2 else None)
    return {
        "pack_mv": pack_mv,
        "cell_mv": cell_mv,
        "pack_v": round(pack_mv / 1000, 3) if pack_mv is not None else None,
        "cell_v": round(cell_mv / 1000, 3) if cell_mv is not None else None,
        "charge_pct": _to_int(t[3] if len(t) > 3 else None),
        "level_pct": _to_int(t[4] if len(t) > 4 else None),
    }


def parse_version(frame: str) -> dict[str, Any]:
    """`$VERSION,<ver>,?,<n>,,<host>,*` firmware version reply.

    e.g. `$VERSION,v4.32,?,4,,devhost.03,*` → firmware v4.32, host image
    devhost.03. `devhost*` host images are developer builds, not retail.
    """
    t = tokenize(frame)
    if not t or t[0] != "VERSION":
        return {}
    host = t[5] if len(t) > 5 else None
    return {
        "firmware": t[1] if len(t) > 1 else None,
        "host_image": host,
        "is_devhost": bool(host and host.lower().startswith("devhost")),
    }


def parse_query(text: str) -> dict[str, Any]:
    """Parse the Teensy USB `QUERY` console dump into a device record.

    The dump is free-form `Label: value` / `Label value` lines. We pull the
    fields we know (serial/head PIN, versions, voltages, radio flags, PCB rev,
    tested-by) by label, and keep the raw text. Robust to line-order changes.
    """
    rec: dict[str, Any] = {"raw": text}
    patterns = {
        "serial_head_pin": r"Serial Number\s*/?\s*Head PIN\s*[:=]?\s*([A-Za-z0-9]+)",
        "bt_central_version": r"BT central V(?:ersion)?\s*[:=]?\s*([A-Za-z0-9.]+)",
        "pcb_rev": r"\b(PCB-?\d+)\b",
        "tested_by": r"Tested by\s*[:=]?\s*([A-Za-z0-9 ]+?)\s*(?:\r?\n|$)",
        "nrf_host": r"NRFhost\s*[:=]?\s*(\d+)",
        "nrf_slave": r"NRFslave\s*[:=]?\s*(\d+)",
        "dev_host": r"devHost\s*[:=]?\s*(\d+)",
        "headset_version": r"Headset Version\s*[:=]?\s*([A-Za-z0-9.]+)",
    }
    for key, pat in patterns.items():
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            v = m.group(1).strip()
            rec[key] = int(v) if v.isdigit() else v
    return rec


@dataclass
class BufferedEvent:
    seq: int
    t_ms: int  # ms since connection opened (monotonic)
    direction: str  # "rx" (tagger→host) or "tx" (host→tagger)
    raw: str
    parsed: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "seq": self.seq,
            "t_ms": self.t_ms,
            "direction": self.direction,
            "raw": self.raw,
            "parsed": self.parsed,
        }


def extract_frames(buf: str) -> tuple[list[str], str]:
    """Split a notify-reassembly buffer into complete BRX frames + the remainder.

    A frame starts with ``$`` and ends with ``*``; a *new* ``$`` also delimits, so a
    frame that arrives without its trailing ``*`` (the rare merged-notify case seen on
    the bench, e.g. ``$ALCD,…$BUT,0,1,*``) still splits correctly instead of swallowing
    the next one. Bytes before the first ``$`` are dropped. Returns ``(frames,
    remainder)`` where remainder is an as-yet-incomplete tail for the next notification.
    """
    frames: list[str] = []
    while True:
        s = buf.find("$")
        if s < 0:
            return frames, ""
        if s > 0:
            buf = buf[s:]
        star = buf.find("*", 1)
        nd = buf.find("$", 1)
        if star >= 0 and (nd < 0 or star < nd):
            end = star + 1              # complete frame ending in '*'
        elif nd >= 0:
            end = nd                    # truncated -> the next '$' is the boundary
        else:
            return frames, buf          # incomplete -> keep as remainder
        frame = buf[:end].strip()
        buf = buf[end:]
        if frame:
            frames.append(frame)
