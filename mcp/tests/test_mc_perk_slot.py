"""A14 (2026-09-04): a perk is its OWN slot — AR + pistol + Quick Switch is a legal kit.

Pins: the three-rule policy + pool shape, the pre-A14 migration (`secondary.kinds` holding "perk"),
the one hardware exception (an ALT-button perk cannot ride with a second weapon: the pick that arrives
last wins and the ack says what it dropped), and the phone/host copy. `docs/spec/loadout.md` §2–§4.
"""
from brx_mcp.mc import policy as P
from brx_mcp.mc.perks import default_perks
from brx_mcp.mc.compile import WeaponCatalog
from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.state import Session

W = WeaponCatalog().all()
PK = default_perks().all()
T0 = 1_700_000_000_000


def _mk(mode="tdm"):
    net = FakeNet()
    clock = {"t": T0}
    s = Session(FakeCompiler(), net, FakeArmory(demo_armory()), now_ms=lambda: clock["t"])
    s.set_config({"mode": mode})
    p = s.add_player("REAPER", team_id="blue", gun_id="GUN-A")
    s.set_phase("kit")   # adding a player never moves the phase (2026-09-17) -- CONTINUE TO KIT does
    tail = demo_armory()[0]["ble"]["tail"]
    net.simulate_hello("node0", f"GUN-A-{tail}")
    net.simulate_status("node0", {"player_id": p["player_id"], "hp": 45, "armor": 70, "ammo": 36, "alive": True, "shots": 0,
                                  "battery": 80, "fw": "v4.32", "arm_state": "kitted", "synced": True,
                                  "preflight": {"ssid_ok": True, "mc_reachable": True, "phone_batt": 90, "screen_on": True,
                                                "foreground": True, "gun_linked": True}}, clock["t"])
    return s, net, clock, p


def _req(net, slot, kind, rid=None):
    body = {"node_id": "node0", "player_id": "x", "slot": slot, "kind": kind}
    if rid:
        body["id"] = rid
    net.simulate_node_message("node0", "loadout_request", body, T0)
    return net.pushes("loadout_ack", "node0")[-1][2]


# ---------------------------------------------------------------- shape
def test_three_rules_and_the_pool_has_a_perks_list():
    for name in ("open", "no_heavies", "snipers"):
        pol = P.preset_rules(name)
        assert set(pol) == {"preset", "hud_select", "primary", "secondary", "perk"}
        assert pol["perk"]["kinds"] == ["perk"] and "perk" not in pol["secondary"]["kinds"]
    lp = P.pool(P.preset_rules("open"), W, PK)
    assert lp == {**lp, "perks": [p["perk_id"] for p in PK]} and set(lp) == {"primary", "secondary_weapons", "perks"}
    assert P.preset_rules("snipers")["perk"]["choice"] == "off"
    # the perk rule filters like any other: exclude_ids / only_ids / fixed
    pol = P.merge(P.preset_rules("open"), {"perk": {"exclude_ids": ["easy_reload"]}})
    assert "easy_reload" not in P.pool(pol, W, PK)["perks"] and pol["preset"] == "custom"
    pol = P.merge(P.preset_rules("open"), {"perk": {"only_ids": ["quick_switch", "body_armor"]}})
    assert P.pool(pol, W, PK)["perks"] == ["body_armor", "quick_switch"]          # catalog order
    # a perk rule never admits weapons; a weapon slot never admits perks — the pre-A14 spelling is an error, not a shim (S6)
    assert P.merge(P.preset_rules("open"), {"perk": {"kinds": ["weapon"]}})["perk"]["kinds"] == ["perk"]
    for bad in ({"secondary": {"kinds": ["weapon", "perk"]}}, {"secondary": {"kinds": ["perk"]}}, {"primary": {"kinds": ["perk"]}}):
        try:
            P.merge(P.preset_rules("open"), bad); raise AssertionError(bad)
        except ValueError:
            pass
    assert P.normalize({**P.preset_rules("open"), "secondary": {**P.preset_rules("open")["secondary"], "kinds": ["weapon", "perk"]}}, "ffa")["preset"] == "no_heavies"   # unreadable → the mode default


def test_ar_plus_pistol_plus_quick_switch_is_legal_everywhere():
    op = P.preset_rules("open"); lp = P.pool(op, W, PK)
    lo = {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "usp"}], "perk": "quick_switch"}
    assert P.validate_loadout(op, lp, lo, W, PK) == (True, None)
    assert P.apply(op, lp, lo, W, PK) == lo
    s, net, clock, p = _mk()                                 # the fake compiler's catalog has no pistols: the SMG stands in
    lo2 = {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "smg"}], "perk": "quick_switch"}
    assert s.patch_player(p["player_id"], loadout=lo2)["loadout"] == lo2
    # the phone builds it one slot at a time
    _req(net, "secondary", "weapon", "shotgun")
    ack = _req(net, "perk", "perk", "body_armor")
    assert ack["ok"] and "dropped" not in ack and ack["loadout"] == {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "shotgun"}], "perk": "body_armor"}


# ---------------------------------------------------------------- the ALT-button exception (S50: now
# `loadout.overrides.easy_reload`, a host-only accessibility flag -- not a perk pick. FOLLOWUPS S50.)
def test_easy_reload_and_a_second_weapon_cannot_both_be_stored_by_the_host():
    op = P.preset_rules("open"); lp = P.pool(op, W, PK)
    ok, why = P.validate_loadout(op, lp, {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "smg"}],
                                          "overrides": {"easy_reload": True}}, W, PK)
    assert not ok and why == "Easy Reload takes the ALT button, so it can't ride with a second weapon"
    assert P.conflict({"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "smg"}],
                       "overrides": {"easy_reload": True}}) == {"weapon": "smg"}
    assert P.conflict({"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "smg"}],
                       "perk": "quick_switch"}) is None
    assert P.conflict({"weapons": [{"weapon_id": "assault_rifle"}],
                       "overrides": {"easy_reload": True}}) is None
    s, net, clock, p = _mk()
    try:
        s.patch_player(p["player_id"], loadout={"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "smg"}],
                                                 "overrides": {"easy_reload": True}})
        raise AssertionError("stored the ALT button beside a second weapon")
    except ValueError as e:
        assert "ALT button" in str(e)


def test_phone_perk_picks_never_touch_overrides():
    """S50: a `loadout_request` perk pick can never create or resolve the ALT-button conflict any
    more (it lives on `overrides.easy_reload`, host-set only) -- picking perks back to back just
    picks perks, no drops, no surprises. `easy_reload` itself is not even a valid perk id to request
    any more (it left the catalog)."""
    s, net, clock, p = _mk()
    pid = p["player_id"]
    _req(net, "secondary", "weapon", "smg")
    ack = _req(net, "perk", "perk", "body_armor")
    assert ack["ok"] is True and "dropped" not in ack
    assert s.players[pid]["loadout"] == {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "smg"}], "perk": "body_armor"}
    assert ack["loadout"] == s.players[pid]["loadout"]
    # requesting the retired perk id is refused like any other unknown perk
    ack = _req(net, "perk", "perk", "easy_reload")
    assert ack["ok"] is False and "Unknown perk" in ack["reason"]
    assert s.players[pid]["loadout"]["perk"] == "body_armor", "the refused pick left the kit alone"
    # every ack still names its slot, and `assign` carried the new loadout each time
    assert net.pushes("loadout_ack", "node0")[-1][2]["slot"] == "perk"
    assert net.pushes("assign", "node0")[-1][2]["player"]["loadout"]["perk"] == "body_armor"


def test_apply_policy_never_touches_the_easy_reload_override():
    """S50: `loadout_policy.perk` governs the PERK slot only -- `overrides.easy_reload` is not a
    policy-governed pool item (it never rides in `LoadoutPool.perks`), so a preset/rule change that
    resets everyone's perk must leave a stored override alone."""
    s, net, clock, p = _mk()
    pid = p["player_id"]
    s.patch_player(pid, loadout={"weapons": [{"weapon_id": "assault_rifle"}], "perk": "quick_switch",
                                 "overrides": {"easy_reload": True}})
    s.set_config({"loadout_policy": {"perk": {"choice": "fixed", "fixed_id": "body_armor"}}})
    assert s.players[pid]["loadout"] == {"weapons": [{"weapon_id": "assault_rifle"}], "perk": "body_armor",
                                         "overrides": {"easy_reload": True}}
    assert s.config["loadout_policy"]["preset"] == "custom"
    # switching the perk rule off clears the perk and leaves the weapons AND the override alone
    s.set_config({"loadout_policy": {"perk": {"choice": "off"}}})
    assert s.players[pid]["loadout"] == {"weapons": [{"weapon_id": "assault_rifle"}], "overrides": {"easy_reload": True}}


def test_pool_preview_route_returns_the_perk_list():
    try:
        from starlette.testclient import TestClient
        import httpx  # noqa: F401  — the system python has no extras (run_tests.py): skip cleanly
    except Exception:
        return
    from brx_mcp.mc.api import create_app
    s, net, clock, p = _mk()
    c = TestClient(create_app(s))
    r = c.post("/api/loadout/pool", json={"loadout_policy": {"perk": {"choice": "off"}}})
    assert r.status_code == 200 and r.json()["pool"]["perks"] == [] and r.json()["policy"]["perk"]["choice"] == "off"
    r = c.post("/api/loadout/pool", json={"loadout_policy": {"preset": "no_heavies"}})
    assert len(r.json()["pool"]["perks"]) == 5 and "secondary_perks" not in r.json()["pool"]


# ---------------------------------------------------------------- what the phone is told
def test_node_view_and_brief_carry_the_perk_rule():
    s, net, clock, p = _mk()
    s.patch_player(p["player_id"], display="REAPER")       # any player change → assign
    pol = net.pushes("assign", "node0")[-1][2]["policy"]
    assert pol["perk"] == {"choice": "player", "allowed_perk_ids": [k["perk_id"] for k in PK]}
    assert "allowed_perk_ids" not in pol["secondary"] and "perk" not in pol["secondary"]["kinds"]
    line = s.game_brief()["loadout_line"]
    assert "a perk of your choice (5)" in line and "slot 2: a second weapon" in line
    s.set_config({"loadout_policy": {"perk": {"choice": "fixed", "fixed_id": "body_armor"}}})
    assert "everyone gets Body Armor" in s.game_brief()["loadout_line"]
    s.set_config({"loadout_policy": {"perk": {"choice": "off"}}})
    assert "no perks" in s.game_brief()["loadout_line"]
    assert net.pushes("assign", "node0")[-1][2]["policy"]["perk"]["choice"] == "off"
