"""F221 (Tony, 2026-09-25): every line MC writes that the console shows as an alert reads
`WHAT IS WRONG: WHAT TO DO`.

The rule, per line:
  * upper case, apart from what sits in parentheses or quotes (a player's name, a config id, a raw
    version string the phone sent);
  * one colon between the fault and the action (a `SETUP: ` category prefix is not counted);
  * no ` — ` or ` - ` join, no "BLOCKS START" / "DOES NOT BLOCK" suffix (the list the line is in and the
    colour the console gives it already say that), and no ▲ (the console adds the glyph).

The test drives a real Session into the states that write these lines, so a new line added beside the
others is checked too, not only the named constants.
"""
import re
from copy import deepcopy
from pathlib import Path

from brx_mcp.mc import state as st
from brx_mcp.mc.compile import Compiler
from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.state import Session
from brx_mcp.mc.types import POOL_CHECK_SETTLE_MS

T0 = 5_000_000


def _session(n_players=4, compiler=None):
    clock = {"t": T0}
    net = FakeNet()
    s = Session(compiler or FakeCompiler(), net, FakeArmory(demo_armory()), now_ms=lambda: clock["t"])
    s.set_config({"mode": "tdm", "time_limit_s": 60})
    ps = [s.add_player(f"Op{i}", gun_id=f"GUN-{chr(65 + i)}") for i in range(n_players)]
    return s, net, clock, ps


def _bad_node(s, net, clock, p, i, **pf):
    tail = demo_armory()[i]["ble"]["tail"]
    net.simulate_hello(f"node{i}", f"GUN-{chr(65 + i)}-{tail}")
    net.simulate_status(f"node{i}", {"player_id": p["player_id"], "hp": 45, "armor": 70, "ammo": 36, "alive": True,
                                     "shots": 0, "fw": "v4.32", "arm_state": "kitted", "synced": False,
                                     "preflight": {"ssid_ok": False, "mc_reachable": False, "phone_batt": 10,
                                                   "screen_on": False, "foreground": False, **pf}}, clock["t"])


def _readiness_lines() -> list[str]:
    """Blockers and ambers from a board that has most of the faults at once."""
    s, net, clock, ps = _session(4)
    _bad_node(s, net, clock, ps[0], 0, gun_linked=False)          # link lost, no battery, wrong Wi-Fi, ...
    _bad_node(s, net, clock, ps[1], 1, gun_flapping=True)         # the headset-off amber
    _bad_node(s, net, clock, ps[2], 2, gun_linked=True)
    clock["t"] += st.STALE_AFTER_MS + 1_000                       # STALE LINK on every live row
    # ps[3] never says hello: WAITING FOR THE PHONE
    lines = [x for r in s.readiness()["board"] for x in r["blockers"] + r["ambers"]]
    clock["t"] += st.OFFLINE_AFTER_MS                              # ...and then OFFLINE
    lines += [x for r in s.readiness()["board"] for x in r["blockers"] + r["ambers"]]
    return lines


def _named_lines() -> list[str]:
    """The line constants and builders, including the ones a board above cannot reach cheaply."""
    s, *_ = _session(1)
    s.phase = "live"                               # a held station offline is flagged only in play
    tamper = s._station_tamper_flags(3, "held", {}, 2, online=False, now=T0)
    return [st.WAITING_FOR_PHONE, st.GUN_LINK_LOST, st.CLOCK_NOT_SYNCED, st.WRONG_WIFI, st.IDENTITY_REVERTED,
            st.GUN_DID_NOT_ANSWER, st.BATTERY_UNREAD, st.PHONE_BATTERY_LOW, st.SCREEN_OFF, st.GUN_FLAPPING_LINE,
            st.STATION_BRING_BACK, st.STATION_ARMED_OLDER, st.STATION_NOT_ARMED, st.STATION_BATTERY_LOW,
            st.not_reached_line("2M", False), st.not_reached_line("2M", True),
            Session._ONE_TEAM_REFUSAL, *tamper]


def _setup_lines() -> list[str]:
    # F221 round 1: this only ever used `FakeCompiler()`, whose `validate()` is a stub -- so it never
    # reached `Compiler.validate()`'s own three SETUP lines (compile.py: the grenade/phone/IR-station
    # physical-setup checklist, one per `station_source`). `_session`'s default stays `FakeCompiler()`
    # for the other callers; this one asks for the real `Compiler()` so those lines build for real.
    s, *_ = _session(2, compiler=Compiler())
    # F402 (2026-09-25): "NO CONTROL STATION IS ASSIGNED" is retired as an amber advisory for koth --
    # it is the hard LOAD/push refusal now (`Session._koth_hill_fault`), so it no longer builds here.
    s.set_config({"mode": "koth", "station_source": "phone"})           # the phone step
    out = list(s.config_warnings)
    s.set_config({"respawn": {"type": "scanner"}})                     # NO RESPAWN STATION
    out += list(s.config_warnings)
    s.set_config({"station_source": "grenade"})
    out += list(s.config_warnings)
    s.set_config({"station_source": "ir_station"})
    out += list(s.config_warnings)
    return [w for w in out if w.startswith("SETUP:")]


# ---- F221 round 1: the wording test above never drove a line that carries a FORMATTED value (app
# version, echo, readback, pool, stale ack, headset confirming), because `_readiness_lines`/
# `_named_lines` never push a config, ack one, or go live. These helpers mirror
# `test_mc_config_proof.py`'s (`online`, `ack`, `echo_for`) and `test_mc_query_readback.py`'s
# (`_expected_from_pushed_head`) so the real code path builds each line, not a hand-typed stand-in.

def _online(s, net, clock, p, i, synced=True, app_ver=None, **body):
    tail = demo_armory()[i]["ble"]["tail"]
    net.simulate_hello(f"node{i}", f"GUN-{chr(65 + i)}-{tail}", app_ver=app_ver)
    net.simulate_status(f"node{i}", {"player_id": p["player_id"], "hp": 45, "armor": 70, "ammo": 36,
                                     "alive": True, "shots": 0, "battery": 80, "fw": "v4.32",
                                     "arm_state": "kitted", "synced": synced,
                                     "preflight": {"ssid_ok": True, "mc_reachable": True, "phone_batt": 90,
                                                   "screen_on": True, "foreground": True, "gun_linked": True},
                                     **body}, clock["t"])


def _echo_for(s, pid, slot=0):
    from brx_mcp.mc import frames as _f
    mag, reserve = _f.head_spawn_ammo(s.bundles[pid]["head"]) or (0, 0)
    return f"$ALCD,{mag},100,{slot},{reserve},0,*"


def _ack(net, s, i, pid, *, config_id=None, echo=None, gun_config=None):
    body = {"config_id": config_id or s.config["config_id"], "ok": True,
            "gun_echo": echo if echo is not None else _echo_for(s, pid)}
    if gun_config is not None:
        body["gun_config"] = gun_config
    net.simulate_node_message(f"node{i}", "ack_config", body, s.now_ms())


def _expected_gun_config(s, pid):
    """Mirrors `test_mc_query_readback._expected_from_pushed_head`: the literal values in the head
    MC actually pushed, read independently of the fault check itself."""
    head = s.bundles[pid]["head"]
    pset = next(frame.split(",") for frame in head if frame.startswith("$PSET,"))
    team = int(pset[2])
    for frame in head:
        parts = frame.split(",")
        if frame.startswith("$PSET,"):
            team = int(parts[2])
        elif frame.startswith("$TID,"):
            team = int(parts[1])
    return {"player_id": int(pset[1]), "team": team, "hp": int(pset[3]), "armor": int(pset[4]), "shield": int(pset[5])}


def _live_status(net, clock, i, p, hp, armor, mid):
    net.simulate_status(f"node{i}", {"player_id": p["player_id"], "hp": hp, "armor": armor, "alive": True,
                                     "shots": 0, "synced": True, "arm_state": "live", "match_id": mid,
                                     "pool_src": "gun",
                                     "preflight": {"gun_linked": True, "ssid_ok": True, "mc_reachable": True}},
                        clock["t"])


def _fstring_lines() -> list[str]:
    """Every line with a value in it that `_readiness_lines`/`_named_lines` cannot reach: app version
    (unknown / incompatible / older than the field / older than the release), a stale ack, an echo
    mismatch, a `$QUERY` read-back mismatch, a pool fault, and HEADSET CONFIRMING's live counter."""
    lines: list[str] = []

    # ---- app version: unknown, incompatible, older than the field, older than the release ----
    from brx_mcp.mc.types import APP_MAJOR, APP_MINOR
    tier, older, newest = f"{APP_MAJOR}.{APP_MINOR}", f"{APP_MAJOR}.{APP_MINOR}.1", f"{APP_MAJOR}.{APP_MINOR}.9"
    s, net, clock, ps = _session(4)
    _online(s, net, clock, ps[0], 0, app_ver="not-a-version")     # APP VERSION UNKNOWN
    _online(s, net, clock, ps[1], 1, app_ver="0.0.1")             # APP <v> INCOMPATIBLE WITH MC
    _online(s, net, clock, ps[2], 2, app_ver=older)               # older than the field AND the release
    _online(s, net, clock, ps[3], 3, app_ver=newest)              # the newest compatible build in the field
    s.release_version = newest
    lines += [x for r in s.readiness()["board"] for x in r["blockers"] + r["ambers"]]

    # ---- stale ack, echo mismatch, `$QUERY` read-back mismatch: a real head, a real Compiler ----
    s, net, clock, ps = _session(3, compiler=Compiler())
    for i, p in enumerate(ps):
        _online(s, net, clock, p, i)
    s.push_config()
    old_id = s.config["config_id"]
    for i, p in enumerate(ps):
        _ack(net, s, i, p["player_id"])
    s.set_config({"time_limit_s": 120})                             # A35 re-push: acks clear, then these land
    _ack(net, s, 0, ps[0]["player_id"], config_id=old_id)                     # ACKED AN OLDER CONFIG
    _ack(net, s, 1, ps[1]["player_id"], echo="$ALCD,1,100,0,2,0,*")           # GUN ECHO ≠ CONFIG
    expected = _expected_gun_config(s, ps[2]["player_id"])
    wrong = deepcopy(expected); wrong["hp"] += 1
    _ack(net, s, 2, ps[2]["player_id"], gun_config=wrong)                     # GUN CONFIG ≠ PUSHED HEAD
    lines += [x for r in s.readiness()["board"] for x in r["blockers"] + r["ambers"]]

    # ---- pool fault: a live gun reporting a previous game's pool (state.py `_pool_faults`) ----
    s, net, clock, ps = _session(2, compiler=Compiler())
    for i, p in enumerate(ps):
        _online(s, net, clock, p, i)
    s.push_config()
    for i, p in enumerate(ps):
        _ack(net, s, i, p["player_id"])
    info = s.start(runway_s=10)
    clock["t"] = info["go_live_t"] + 1
    s.tick()
    mid = info["match_id"]
    _live_status(net, clock, 0, ps[0], 45, 70, mid)                 # the life starts: settle window opens
    _live_status(net, clock, 1, ps[1], 45, 70, mid)
    clock["t"] += POOL_CHECK_SETTLE_MS + 100
    _live_status(net, clock, 0, ps[0], 45, 70, mid)                 # exactly the pushed $PSET
    _live_status(net, clock, 1, ps[1], 115, 70, mid)                # a previous game's HEALTH pool
    lines += [x for r in s.readiness()["board"] for x in r["blockers"] + r["ambers"]]

    # ---- HEADSET CONFIRMING (LINK {n} S): the counter itself is the formatted value ----
    s, net, clock, ps = _session(1)
    _online(s, net, clock, ps[0], 0)
    clock["t"] += 4_000
    _online(s, net, clock, ps[0], 0)               # still linked: the window does not restart
    lines += [x for r in s.readiness()["board"] for x in r["blockers"] + r["ambers"]]

    return lines


def _sync_warning_lines() -> list[str]:
    """F401: LOAD warns about any station of the LAST FINISHED match MC has not heard from since the
    whistle -- the StickS3-brought-back scenario. Checked here too, not just via the named constants."""
    s, net, clock, ps = _session(2)
    for i, p in enumerate(ps):
        _online(s, net, clock, p, i)
    net.simulate_utility_hello("util-1")
    s.set_station("util-1", {"kind": "respawn", "team": "blue", "id": 1})
    s.push_config(force=True)
    s.start(runway_s=3, force=True)
    clock["t"] += 5_000                              # the station goes quiet before the whistle
    s.control("end")
    return list(s.config_warnings)


def _problems(line: str) -> list[str]:
    bad = []
    if re.search(r"BLOCKS START|DOES NOT BLOCK", line):
        bad.append("restates the colour (BLOCKS START / DOES NOT BLOCK)")
    if " — " in line or " - " in line:
        bad.append("joins with a dash, not a colon")
    if "▲" in line:
        bad.append("carries the glyph (the console adds it)")
    body = line[len("SETUP: "):] if line.startswith("SETUP: ") else line
    if body.count(": ") > 1:
        bad.append("more than one colon")
    # names, ids and raw versions live in parentheses or quotes and keep their own case
    bare = re.sub(r"\([^)]*\)|'[^']*'", "", body)
    if bare != bare.upper():
        bad.append("not upper case")
    return bad


def _check(lines: list[str]) -> None:
    assert lines, "the harness produced no lines: it is not checking anything"
    failures = {ln: p for ln in lines if (p := _problems(ln))}
    assert not failures, "\n".join(f"{ln!r}: {', '.join(p)}" for ln, p in failures.items())


def test_every_readiness_line_follows_the_wording_rule():
    lines = _readiness_lines()
    # the harness must actually reach the lines it claims to check
    for head in ("WAITING FOR THE PHONE", "OFFLINE (LAST SEEN", "CLOCK NOT SYNCED", "WRONG WI-FI", "GUN LINK LOST",
                 "BATTERY UNREAD", "PHONE BATTERY LOW", "SCREEN OFF", "STALE LINK", "HEADSET OFF"):
        assert any(x.startswith(head) for x in lines), f"{head} was not produced: {lines}"
    _check(lines)


def test_every_named_line_follows_the_wording_rule():
    _check(_named_lines())


def test_every_setup_line_follows_the_wording_rule():
    lines = _setup_lines()
    # F402: "NO CONTROL STATION IS ASSIGNED" no longer builds for koth (the only mode that ever set
    # `station_source: "phone"`) -- assert its ABSENCE rather than drop the coverage silently.
    assert not any("NO CONTROL STATION" in x for x in lines), lines
    assert any("NO RESPAWN STATION" in x for x in lines), lines
    # the three physical-setup lines compile.py's real `Compiler.validate()` writes (F221 round 1: the
    # harness used `FakeCompiler()` before, so these never built)
    for head in ("POWER-CYCLE THE GRENADE", "THE CONTROL POINT IS A BLUETOOTH STATION", "THE IR STATION IS UNPROVEN"):
        assert any(head in x for x in lines), f"{head} was not produced: {lines}"
    _check(lines)


def test_every_fstring_line_follows_the_wording_rule():
    lines = _fstring_lines()
    for head in ("APP VERSION UNKNOWN", "APP 0.0.1 INCOMPATIBLE", "APP OLDER THAN THE RELEASE",
                 "ACKED AN OLDER CONFIG", "GUN ECHO ≠ CONFIG", "GUN CONFIG ≠ PUSHED HEAD",
                 "GUN POOL ≠ CONFIG", "HEADSET CONFIRMING (LINK 4 S)"):
        assert any(x.startswith(head) for x in lines), f"{head} was not produced: {lines}"
    _check(lines)


def test_every_sync_warning_line_follows_the_wording_rule():
    lines = _sync_warning_lines()
    assert any("HAS NOT SYNCED THE LAST MATCH" in x for x in lines), lines
    _check(lines)


def test_the_phone_battery_rule_is_under_30():
    """F221: under 30 % is AMBER for the gun, the phone and the station alike (was < 20 for the phone)."""
    assert st.BATTERY_LOW_PCT == 30
    for pct, low in ((29, True), (30, False)):
        s, net, clock, ps = _session(1)
        tail = demo_armory()[0]["ble"]["tail"]
        net.simulate_hello("node0", f"GUN-A-{tail}")
        net.simulate_status("node0", {"player_id": ps[0]["player_id"], "hp": 45, "armor": 70, "ammo": 36, "alive": True,
                                      "shots": 0, "battery": 80, "fw": "v4.32", "arm_state": "kitted", "synced": True,
                                      "preflight": {"ssid_ok": True, "mc_reachable": True, "phone_batt": pct,
                                                    "screen_on": True, "foreground": True, "gun_linked": True}}, clock["t"])
        ambers = s.readiness()["board"][0]["ambers"]
        assert (st.PHONE_BATTERY_LOW in ambers) is low, (pct, ambers)


def _console_heads() -> list[str]:
    """The heads the console colours a server line by (`SERVER_LINES` in webapp/mc/src/alerts/server.ts)."""
    src = (Path(__file__).resolve().parents[2] / "webapp" / "mc" / "src" / "alerts" / "server.ts").read_text(encoding="utf-8")
    block = src[src.index("export const SERVER_LINES"):]
    block = block[:block.index("];")]
    return re.findall(r"head: '((?:[^'\\]|\\.)*)'", block)


def test_every_line_mc_writes_has_a_console_colour():
    """F221 round 2: the console matches MC's lines by head. A rewording here that the console table does
    not follow would drop the line to its list's default colour with no failure anywhere, so this joins the
    lines MC really builds to the heads the console really reads."""
    heads = _console_heads()
    assert len(heads) > 20, heads
    lines = _readiness_lines() + _named_lines() + _setup_lines() + _fstring_lines() + _sync_warning_lines()
    orphans = sorted({ln for ln in lines if not any(ln.startswith(h) for h in heads)})
    assert not orphans, "no SERVER_LINES head in webapp/mc/src/alerts/server.ts matches:\n" + "\n".join(orphans)
