"""A25 background log sync + A27 the guarded CONTINUE + A29 app versions — the MC SERVER half.

The phone half is `app/src/logsync.js` (it answers `pull_log` only when not ARMED/LIVE and its fact ring
is empty, and reports `status.log`). Everything here is the other end: when MC ASKS, what it refuses to
ask, what it shows the operator about each node's log, and what it does with the build a phone reports.
"""
from _skip import needs

from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory, fake_app_ver
from brx_mcp.mc.state import NotReadyError, Session
from brx_mcp.mc.types import APP_MAJOR, APP_MINOR, app_tier, compatible, parse_app_ver

try:
    from starlette.testclient import TestClient
    import httpx  # noqa: F401
    HAVE = True
except Exception:
    HAVE = False

T0 = 5_000_000


def mk(n_players=2):
    clock = {"t": T0}
    net = FakeNet()
    s = Session(FakeCompiler(), net, FakeArmory(demo_armory()), now_ms=lambda: clock["t"])
    s.set_config({"mode": "tdm", "time_limit_s": 60})
    ps = [s.add_player(f"OP{i}", gun_id=f"GUN-{chr(65 + i)}") for i in range(n_players)]
    return s, net, clock, ps


def online(s, net, clock, p, i, synced=True, app_ver=None, platform="android"):
    tail = demo_armory()[i]["ble"]["tail"]
    net.simulate_hello(f"node{i}", f"GUN-{chr(65 + i)}-{tail}", app_ver=app_ver, platform=platform)
    net.simulate_status(f"node{i}", {"player_id": p["player_id"], "hp": 45, "armor": 70, "ammo": 36, "alive": True,
                                     "shots": 0, "battery": 80, "fw": "v4.32", "arm_state": "kitted", "synced": synced,
                                     "preflight": {"ssid_ok": True, "mc_reachable": True, "phone_batt": 90,
                                                   "screen_on": True, "foreground": True, "gun_linked": True}}, clock["t"])


def pulls(net, nid=None):
    return [(n, b.get("reason")) for n, k, b in net.pushed if k == "pull_log" and (nid is None or n == nid)]


def run_match(s, net, clock, ps):
    """kit → lobby push → start → live → the whistle. Returns the match_id that ended."""
    for p in ps:
        s.set_ready(p["player_id"], True, host_override=True)
    s.push_config(force=True)
    for i, _ in enumerate(ps):
        net.simulate_node_message(f"node{i}", "ack_config", {"config_id": s.config["config_id"], "ok": True,
                                                             "gun_echo": "$LCD"}, clock["t"])
    info = s.start(runway_s=1)
    clock["t"] += 2000
    s.tick()
    s.control("end", confirm=True)
    return info["match_id"]


# ---------------------------------------------------------------- A25: the four triggers

def test_pull_at_recap_and_the_log_sync_gate():
    s, net, clock, ps = mk(2)
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    run_match(s, net, clock, ps)
    assert sorted(pulls(net)) == [("node0", "recap"), ("node1", "recap")], net.pushed

    # …and with the option off, the whistle asks nobody. (Same session: a new match, no new nodes.)
    s.options["log_sync"] = "manual"
    net.pushed.clear()
    s.new_session(keep_roster=True)
    run_match(s, net, clock, ps)
    assert pulls(net) == [], "log_sync: manual must silence the automatic recap ask"


def test_offer_triggers_a_pull_and_is_gated_too():
    s, net, clock, ps = mk(1)
    online(s, net, clock, ps[0], 0)
    s._on_node_message("node0", "log_offer", {"node_id": "node0", "bytes": 4096, "lines": 120, "reason": "manual"}, clock["t"])
    assert pulls(net, "node0") == [("node0", "offer")]
    assert s.nodes["node0"]["log"]["state"] == "offered"
    assert s.nodes["node0"]["log"]["bytes"] == 4096 and s.nodes["node0"]["log"]["lines"] == 120

    net.pushed.clear()
    s.options["log_sync"] = "manual"
    s._on_node_message("node0", "log_offer", {"node_id": "node0", "bytes": 10, "lines": 1}, clock["t"])
    assert pulls(net) == [], "an offer under log_sync: manual is recorded, not answered"
    assert s.nodes["node0"]["log"]["bytes"] == 10, "…but the offer is still shown to the operator"


def test_manual_pull_ignores_the_gate_and_refuses_a_utility_node():
    s, net, clock, ps = mk(1)
    online(s, net, clock, ps[0], 0)
    net.simulate_utility_hello("util-1")
    s.options["log_sync"] = "manual"
    assert s.pull_log("node0", "manual") is True
    assert pulls(net, "node0") == [("node0", "manual")], "the LOGS button is never gated (A25)"
    # F106(d): a station never binds a match, so its log holds nothing about one.
    assert s.pull_log("util-1", "manual") is False and pulls(net, "util-1") == []
    assert s.pull_log("nobody", "manual") is False


def test_reconnect_asks_only_when_the_last_match_log_is_missing():
    s, net, clock, ps = mk(2)
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    mid = run_match(s, net, clock, ps)

    # node0 delivers a COMPLETE stream; node1's is cut off after one chunk.
    s._on_node_message("node0", "log_data", {"node_id": "node0", "seq": 0, "chunk": "x" * 50, "last": True}, clock["t"])
    s._on_node_message("node1", "log_data", {"node_id": "node1", "seq": 0, "chunk": "y" * 50, "last": False}, clock["t"])
    assert s._log_done["node0"] == mid and s.nodes["node0"]["log"]["state"] == "complete"
    assert s.nodes["node1"]["log"]["state"] == "pulling"

    net.pushed.clear()
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)     # both phones come back
    assert pulls(net) == [("node1", "reconnect")], "only the node that still owes a log is re-asked"

    # node1 finishes; a later reconnect asks nobody.
    s._on_node_message("node1", "log_data", {"node_id": "node1", "seq": 1, "chunk": "z", "last": True}, clock["t"])
    net.pushed.clear()
    online(s, net, clock, ps[1], 1)
    assert pulls(net) == []


def test_reconnect_is_gated_and_silent_before_any_match():
    s, net, clock, ps = mk(1)
    online(s, net, clock, ps[0], 0)
    assert pulls(net) == [], "no match has ended — nothing is owed"
    run_match(s, net, clock, ps)
    s.options["log_sync"] = "manual"
    net.pushed.clear()
    online(s, net, clock, ps[0], 0)
    assert pulls(net) == [], "log_sync: manual silences the reconnect ask too"


def test_node_log_transitions_and_the_1mb_cap():
    s, net, clock, ps = mk(1)
    online(s, net, clock, ps[0], 0)
    nv = s.nodes["node0"]
    assert nv.get("log") is None

    net.simulate_status("node0", {"arm_state": "live", "synced": True, "log": "held(2 facts pending)"}, clock["t"])
    assert nv["log"]["state"] == "held" and nv["log"]["reason"] == "2 facts pending"
    net.simulate_status("node0", {"arm_state": "kitted", "synced": True, "log": "offered"}, clock["t"])
    assert nv["log"]["state"] == "offered" and "reason" not in nv["log"]
    net.simulate_status("node0", {"arm_state": "kitted", "synced": True, "log": "pulling"}, clock["t"])
    assert nv["log"]["state"] == "pulling"
    s._on_node_message("node0", "log_data", {"node_id": "node0", "seq": 0, "chunk": "a" * 10, "last": True}, clock["t"])
    assert nv["log"]["state"] == "complete" and nv["log"]["bytes"] == 10
    # The phone idles back to `none` the instant it finishes. Taking that literally would erase the one
    # state the operator was waiting to see, two seconds after it appeared.
    net.simulate_status("node0", {"arm_state": "kitted", "synced": True, "log": "none"}, clock["t"])
    assert nv["log"]["state"] == "complete"
    # A shape we do not know is ignored rather than rendered.
    net.simulate_status("node0", {"arm_state": "kitted", "synced": True, "log": "wat"}, clock["t"])
    assert nv["log"]["state"] == "complete"

    s._log_bytes["node0"] = 1_000_001
    net.pushed.clear()
    assert s.pull_log("node0", "manual") is False, "the ~1 MB per-node budget still holds"
    assert pulls(net) == []


def test_readiness_row_carries_the_log_state():
    s, net, clock, ps = mk(1)
    online(s, net, clock, ps[0], 0)
    net.simulate_status("node0", {"arm_state": "kitted", "synced": True, "log": "held(live)"}, clock["t"])
    row = s.readiness()["board"][0]
    assert row["log"] == {"state": "held", "reason": "live", "last_t": clock["t"]}


# ---------------------------------------------------------------- A29: versions

class tier:
    """`APP_MAJOR`/`APP_MINOR` for the duration of a `with` — run_tests.py is not pytest, no fixtures."""

    def __init__(self, major, minor): self.want = (major, minor)

    def __enter__(self):
        import brx_mcp.mc.types as T
        self.T, self.had = T, (T.APP_MAJOR, T.APP_MINOR)
        T.APP_MAJOR, T.APP_MINOR = self.want
        return T

    def __exit__(self, *_):
        self.T.APP_MAJOR, self.T.APP_MINOR = self.had
        return False


def test_parse_and_compatible_in_both_regimes():
    assert parse_app_ver("0.1.9+abc123") == (0, 1, 9)
    assert parse_app_ver("0.1.9+abc123-dirty") == (0, 1, 9)
    assert parse_app_ver("2.0.0") == (2, 0, 0)
    for bad in ("hud-0.2", "fake", "", None, "1.2", "1.2.3.4", "a.b.c", 7):
        assert parse_app_ver(bad) is None, bad

    # 0.x: MINOR is the breaking tier (semver's own rule) — 0.1.x plays, 0.2.0 does not.
    with tier(0, 1) as T:
        assert T.app_tier() == "0.1"
        assert T.compatible("0.1.0") and T.compatible("0.1.99")
        assert not T.compatible("0.2.0") and not T.compatible("1.1.0")
        assert T.compatible("nope") is None
    # 1.0.0 on: MAJOR alone decides and MINOR may differ freely.
    with tier(2, 3) as T:
        assert T.app_tier() == "2"
        assert T.compatible("2.0.0") and T.compatible("2.9.4")
        assert not T.compatible("1.9.9") and not T.compatible("3.0.0")


def test_red_amber_none_across_the_field():
    s, net, clock, ps = mk(3)
    s.release_version = f"{APP_MAJOR}.{APP_MINOR}.9"
    newest = f"{APP_MAJOR}.{APP_MINOR}.9"
    behind = f"{APP_MAJOR}.{APP_MINOR}.2"
    wrong = f"{APP_MAJOR}.{APP_MINOR + 1}.0" if APP_MAJOR == 0 else f"{APP_MAJOR + 1}.0.0"
    online(s, net, clock, ps[0], 0, app_ver=f"{newest}+aaa")
    online(s, net, clock, ps[1], 1, app_ver=f"{behind}+bbb")
    online(s, net, clock, ps[2], 2, app_ver=wrong)
    rows = {r["player_id"]: r for r in s.readiness()["board"]}

    r0 = rows[ps[0]["player_id"]]
    assert not [a for a in r0["ambers"] if a.startswith("APP ")], r0["ambers"]
    assert r0["app_ver"] == f"{newest}+aaa" and r0["platform"] == "android"

    r1 = rows[ps[1]["player_id"]]
    assert f"APP OLDER THAN THE FIELD ({behind} < {newest})" in r1["ambers"], r1["ambers"]
    assert f"APP OLDER THAN THE RELEASE ({behind} < {newest})" in r1["ambers"], r1["ambers"]
    assert r1["status"] == "amber" and not r1["blockers"], "A1: amber never blocks"

    r2 = rows[ps[2]["player_id"]]
    assert f"APP {wrong} INCOMPATIBLE WITH MC (NEEDS {app_tier()}) — UPDATE THE APP" in r2["blockers"], r2["blockers"]
    assert r2["status"] == "red" and not s.readiness()["go"]
    # An incompatible build says ONE thing. It is not also "older than the field".
    assert not [a for a in r2["ambers"] if a.startswith("APP ")], r2["ambers"]


def test_unparsable_version_is_amber_never_red():
    s, net, clock, ps = mk(1)
    online(s, net, clock, ps[0], 0, app_ver="hud-0.2")
    row = s.readiness()["board"][0]
    assert "APP VERSION UNKNOWN (hud-0.2)" in row["ambers"], row["ambers"]
    assert row["status"] == "amber" and not row["blockers"], "the app shipped `hud-0.2` for months"
    assert s.readiness()["go"]


def test_versions_summary_and_a_missing_build_json():
    s, net, clock, ps = mk(3)
    v = f"{APP_MAJOR}.{APP_MINOR}"
    online(s, net, clock, ps[0], 0, app_ver=f"{v}.9")
    online(s, net, clock, ps[1], 1, app_ver=f"{v}.9")
    online(s, net, clock, ps[2], 2, app_ver=f"{v}.8")
    net.simulate_utility_hello("util-1", app_ver=f"{v}.1")
    s.release_version = f"{v}.9"
    summ = s.versions()
    assert summ["field"] == {f"{v}.9": 2, f"{v}.8": 1}, summ         # a station is not in the match
    assert summ["newest"] == f"{v}.9" and summ["release"] == f"{v}.9" and summ["mc_major"] == app_tier()

    s.release_version = None                                         # no sidecar (never cut an APK)
    assert s.versions()["release"] is None
    rows = {r["player_id"]: r for r in s.readiness()["board"]}
    older = rows[ps[2]["player_id"]]["ambers"]
    assert f"APP OLDER THAN THE FIELD ({v}.8 < {v}.9)" in older
    assert not [a for a in older if "RELEASE" in a], "no build.json means no RELEASE amber, not a crash"


def test_platform_and_app_ver_reach_nodes_and_stations():
    s, net, clock, ps = mk(1)
    online(s, net, clock, ps[0], 0, app_ver=f"{APP_MAJOR}.{APP_MINOR}.7", platform="ios")
    assert s.nodes["node0"]["platform"] == "ios" and s.nodes["node0"]["app_ver"] == f"{APP_MAJOR}.{APP_MINOR}.7"
    # A heartbeat that omits the fields is a heartbeat, not a downgrade.
    net.simulate_status("node0", {"arm_state": "kitted", "synced": True}, clock["t"])
    assert s.nodes["node0"]["platform"] == "ios"
    # …and one that carries a NEW build (the phone updated mid-session) moves it.
    net.simulate_status("node0", {"arm_state": "kitted", "synced": True,
                                  "app_ver": f"{APP_MAJOR}.{APP_MINOR}.8", "platform": "android"}, clock["t"])
    assert s.nodes["node0"]["app_ver"] == f"{APP_MAJOR}.{APP_MINOR}.8" and s.nodes["node0"]["platform"] == "android"

    net.simulate_utility_hello("util-1", app_ver=f"{APP_MAJOR}.{APP_MINOR}.3")
    s._on_status("util-1", {"node_id": "util-1", "arm_state": "idle", "synced": True, "role": "utility",
                            "kind": "respawn", "platform": "android"}, clock["t"])
    st = next(r for r in s.stations_view() if r["node_id"] == "util-1")
    assert st["app_ver"] == f"{APP_MAJOR}.{APP_MINOR}.3" and st["platform"] == "android"


# ---------------------------------------------------------------- A27: the guarded CONTINUE

def test_set_phase_refuses_kit_to_lobby_until_ready():
    s, net, clock, ps = mk(2)
    s.phase = "kit"
    try:
        s.set_phase("lobby")
        raise AssertionError("expected a NotReadyError")
    except NotReadyError as e:
        assert e.status == 409 and e.not_ready == ["OP0", "OP1"] and e.greens == 0 and e.roster_size == 2
    assert s.phase == "kit", "a refused CONTINUE must not move the phase"

    s.set_ready(ps[0]["player_id"], True, host_override=True)
    try:
        s.set_phase("lobby")
        raise AssertionError("expected a NotReadyError")
    except NotReadyError as e:
        assert e.not_ready == ["OP1"] and e.greens == 1
    assert s.set_phase("lobby", force=True) == "lobby"

    # All ready: no guard at all. And the guard is KIT→LOBBY only.
    s.phase = "kit"
    s.set_ready(ps[1]["player_id"], True, host_override=True)
    assert s.set_phase("lobby") == "lobby"
    s.phase = "muster"
    for p in ps:
        s.set_ready(p["player_id"], False, host_override=True)
    assert s.set_phase("lobby") == "lobby", "only a move OUT OF KIT is guarded"


def test_set_phase_still_refuses_a_driven_phase():
    s, net, clock, ps = mk(1)
    for bad in ("armed", "live", "recap", "nope", None):
        try:
            s.set_phase(bad)
            raise AssertionError(bad)
        except NotReadyError:
            raise AssertionError(bad)
        except ValueError:
            pass


# ---------------------------------------------------------------- the routes

def _client(n_players=2):
    from brx_mcp.mc.api import create_app
    net = FakeNet()
    s = Session(FakeCompiler(), net, FakeArmory(demo_armory()))
    s.set_config({"mode": "tdm", "time_limit_s": 60})
    ps = [s.add_player(f"OP{i}", gun_id=f"GUN-{chr(65 + i)}") for i in range(n_players)]
    return TestClient(create_app(s)), s, net, ps


def test_options_route():
    needs(HAVE, "starlette + httpx")
    c, s, net, ps = _client(0)
    assert c.get("/api/options").json() == {"log_sync": "auto"}
    assert c.put("/api/options", json={"log_sync": "manual"}).json() == {"log_sync": "manual"}
    assert s.options["log_sync"] == "manual"
    assert c.put("/api/options", json={"log_sync": "sometimes"}).status_code == 400
    assert c.put("/api/options", json={"nope": 1}).status_code == 400
    assert s.options["log_sync"] == "manual", "a rejected PUT changes nothing"
    assert c.get("/api/state").json()["options"] == {"log_sync": "manual"}
    assert set(c.get("/api/state").json()["versions"]) == {"field", "newest", "release", "mc_major"}


def test_pull_log_route():
    needs(HAVE, "starlette + httpx")
    c, s, net, ps = _client(1)
    assert c.post("/api/nodes/nope/pull_log").status_code == 404
    net.simulate_hello("node0", "GUN-A-" + demo_armory()[0]["ble"]["tail"])
    s.options["log_sync"] = "manual"
    r = c.post("/api/nodes/node0/pull_log")
    assert r.status_code == 200 and r.json()["ok"] is True and r.json()["node_id"] == "node0"
    assert pulls(net, "node0") == [("node0", "manual")]


def test_phase_route_409_and_force():
    needs(HAVE, "starlette + httpx")
    c, s, net, ps = _client(2)
    s.phase = "kit"
    r = c.post("/api/phase", json={"phase": "lobby"})
    assert r.status_code == 409, r.text
    b = r.json()
    assert b["not_ready"] == ["OP0", "OP1"] and b["greens"] == 0 and b["roster_size"] == 2 and b["error"]
    assert s.phase == "kit"
    assert c.post("/api/phase", json={"phase": "lobby", "force": True}).status_code == 200
    assert s.phase == "lobby"

    s.phase = "kit"
    for p in ps:
        s.set_ready(p["player_id"], True, host_override=True)
    assert c.post("/api/phase", json={"phase": "lobby"}).status_code == 200
    assert c.post("/api/phase", json={"phase": "live"}).status_code == 400


def test_fake_node_reports_a_real_build():
    """The fake is the only phone most of this suite ever sees. A version MC cannot parse would make
    every fake node carry an APP VERSION UNKNOWN amber — a phone that cannot exist (stage-mirrors-phone)."""
    assert compatible(fake_app_ver()) is True, fake_app_ver()


# ---------------------------------------------------------------- A29: MC and the app are ONE statement
def test_mc_is_pinned_to_the_app_version_in_the_repo():
    """`APP_MAJOR`/`APP_MINOR` ARE the compatibility statement (A29), and nothing held them to the app.

    They are two constants in `types.py`; the app's real version is `app/package.json`. Bumping one
    without the other is a one-line change that turns every phone in the field RED with
    `APP 0.2.0 INCOMPATIBLE WITH MC (NEEDS 0.1) — UPDATE THE APP` — at muster, in a car park, with no
    way to fix it there. So the desk fails instead: this test goes red the moment either side moves
    alone, which is the ONLY moment anyone can still do something about it.
    """
    import json
    import pathlib
    pkg = pathlib.Path(__file__).resolve().parents[2] / "app" / "package.json"
    raw = json.loads(pkg.read_text(encoding="utf-8")).get("version")
    v = parse_app_ver(raw)
    assert v is not None, f"app/package.json version {raw!r} is not MAJOR.MINOR.PATCH"
    if APP_MAJOR == 0:
        # 0.x: MINOR is the breaking tier, so MC pins BOTH halves.
        assert v[:2] == (APP_MAJOR, APP_MINOR), (
            f"app/package.json is {raw} but mc/types.py says {app_tier()} — bump BOTH "
            f"(APP_MAJOR/APP_MINOR and the package version) in the same commit as the APK cut")
    else:
        assert v[0] == APP_MAJOR, f"app/package.json is {raw} but mc/types.py needs major {APP_MAJOR}"
    # and the statement has to be true of the app that ships: MC must accept its own repo's build.
    assert compatible(raw) is True, f"MC would refuse the app in this repo ({raw})"


def test_a_prerelease_tag_ranks_WITH_its_release_not_below_it():
    """Documented, not accidental (`parse_app_ver`): `0.2.0-rc1` is a 0.2.0 build for compatibility.

    Ranking it below would amber every rc phone with OLDER THAN THE RELEASE the day before a cut.
    """
    assert parse_app_ver("0.2.0-rc1") == (0, 2, 0) == parse_app_ver("0.2.0")
    assert parse_app_ver("0.1.9-rc2+abc123") == (0, 1, 9)
    with tier(0, 2) as T:
        assert T.compatible("0.2.0-rc1") is True


def test_a_node_that_left_the_field_sets_no_version_and_counts_for_nobody():
    """`self.nodes` is every node that EVER said hello, and a bound one is never pruned. A phone
    swapped out an hour ago used to sit in the muster header and — worse — could still be `newest`,
    ambering every phone actually on the pitch for a build nobody was carrying."""
    from brx_mcp.mc.types import OFFLINE_AFTER_MS
    s, net, clock, ps = mk(2)
    v = f"{APP_MAJOR}.{APP_MINOR}"
    online(s, net, clock, ps[0], 0, app_ver=f"{v}.9")        # the phone that then goes home
    clock["t"] += OFFLINE_AFTER_MS + 1
    online(s, net, clock, ps[1], 1, app_ver=f"{v}.8")        # the phone actually in the match
    assert s.versions()["field"] == {f"{v}.8": 1}, s.versions()
    assert s.versions()["newest"] == f"{v}.8"
    row = next(r for r in s.readiness()["board"] if r["player_id"] == ps[1]["player_id"])
    assert not [a for a in row["ambers"] if "OLDER THAN THE FIELD" in a], row["ambers"]
    # CONTROL: while it is still there, it counts and it does set `newest`.
    s2, net2, clock2, ps2 = mk(2)
    online(s2, net2, clock2, ps2[0], 0, app_ver=f"{v}.9")
    online(s2, net2, clock2, ps2[1], 1, app_ver=f"{v}.8")
    assert s2.versions()["newest"] == f"{v}.9"
    row2 = next(r for r in s2.readiness()["board"] if r["player_id"] == ps2[1]["player_id"])
    assert [a for a in row2["ambers"] if "OLDER THAN THE FIELD" in a], row2["ambers"]


# ---------------------------------------------------------------- A25: one ask per node, and a per-MATCH budget
def test_a_reconnect_and_an_offer_in_the_same_breath_ask_once():
    """The node reconnects (MC asks `reconnect`) and then offers its log (MC asked `offer` too), so the
    phone uploaded the same ~1 MB twice. One automatic ask per node is outstanding at a time."""
    s, net, clock, ps = mk(1)
    online(s, net, clock, ps[0], 0)
    run_match(s, net, clock, ps)
    net.pushed.clear()
    online(s, net, clock, ps[0], 0)                       # back on the LAN: the reconnect ask
    s._on_node_message("node0", "log_offer", {"node_id": "node0", "bytes": 4096, "lines": 120}, clock["t"])
    assert pulls(net) == [("node0", "reconnect")], f"asked twice for one log: {pulls(net)}"
    assert s.nodes["node0"]["log"]["state"] == "offered", "the offer is still shown to the operator"
    # the LOGS button is never deduped — "manual" means the button is the only asker (A25)
    assert s.pull_log("node0", "manual") is True
    # once the node starts answering, the ask is settled and a later offer may ask again
    s._on_node_message("node0", "log_data", {"node_id": "node0", "seq": 0, "chunk": "x", "last": False}, clock["t"])
    net.pushed.clear()
    s._on_node_message("node0", "log_offer", {"node_id": "node0", "bytes": 10, "lines": 1}, clock["t"])
    assert pulls(net) == [("node0", "offer")]


def test_the_1mb_log_budget_is_per_match_not_per_session():
    """It was never reset. After three or four matches of logs every node was over it and the recap ask
    stopped going out — silently, on the match most likely to be the one worth debugging."""
    s, net, clock, ps = mk(1)
    online(s, net, clock, ps[0], 0)
    run_match(s, net, clock, ps)
    s._on_node_message("node0", "log_data",
                       {"node_id": "node0", "seq": 0, "chunk": "x" * 1_000_001, "last": True}, clock["t"])
    assert s.pull_log("node0", "manual") is False, "the cap still holds inside one match"
    s.new_session(keep_roster=True)
    net.pushed.clear()
    run_match(s, net, clock, ps)
    assert pulls(net) == [("node0", "recap")], "a new match gets a fresh budget"


# ---------------------------------------------------------------- the node view's own defaults
def test_a_node_that_only_said_hello_still_has_arm_state_and_synced():
    """`_hydrate` fires BEFORE `_on_node` (net.py answers the hello first), so `_note_version`'s
    `setdefault` pre-created the node dict and `_on_node`'s `{arm_state:"idle", synced:False}` never
    applied. The board then read both as ABSENT rather than as the idle, unsynced phone it is —
    `API.md` NodeView says they are always there."""
    s, net, clock, ps = mk(1)
    tail = demo_armory()[0]["ble"]["tail"]
    net.simulate_hello("node0", f"GUN-A-{tail}", app_ver=f"{APP_MAJOR}.{APP_MINOR}.9", platform="android")
    nv = s.nodes["node0"]
    assert nv["arm_state"] == "idle", nv
    assert nv["synced"] is False, nv
    assert nv["node_type"] == "phone" and nv["app_ver"] == f"{APP_MAJOR}.{APP_MINOR}.9"
    assert isinstance(nv.get("last_seen_ms"), int)


# ---------------------------------------------------------------- A30-shaped: the phase a match is in
def test_set_phase_refuses_to_leave_a_running_match():
    """`{phase:"kit"}` during LIVE used to succeed. `tick()` returns early unless the phase is
    armed/live, so the match could never reach its timed end: it just sat there while the field played
    on with no whistle coming. Ending a match is `control{end}` — this is a 409, not a 400."""
    from brx_mcp.mc.state import ConflictError
    s, net, clock, ps = mk(2)
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    for p in ps:
        s.set_ready(p["player_id"], True, host_override=True)
    s.push_config(force=True)
    for i in range(2):
        net.simulate_node_message(f"node{i}", "ack_config", {"config_id": s.config["config_id"], "ok": True,
                                                             "gun_echo": "$LCD"}, clock["t"])
    s.start(runway_s=1)
    assert s.phase == "armed"
    for ph in ("kit", "lobby", "build", "muster"):
        try:
            s.set_phase(ph)
            raise AssertionError(f"ARMED let the session move to {ph}")
        except ConflictError as e:
            assert getattr(e, "status", None) == 409 and "ARMED" in str(e), str(e)
    try:
        s.set_phase("kit", force=True)
        raise AssertionError("force must not open the door either")
    except ConflictError:
        pass
    clock["t"] += 2000
    s.tick()
    assert s.phase == "live"
    try:
        s.set_phase("kit")
        raise AssertionError("LIVE let the session move to kit — tick() would never end the match")
    except ConflictError as e:
        assert "LIVE" in str(e)
    # the whistle is the way out, and then the setup phases are open again
    s.control("end", confirm=True)
    assert s.phase == "recap"
    assert s.set_phase("build") == "build"
