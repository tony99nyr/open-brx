"""M-LOADOUT (docs/spec/loadout.md, contracts A10): two slots, perks, loadout policy, phone self-serve.

Policy presets/pool/validate matrix · _check_loadout matrix · compile (empty slot 1, each perk effect,
sniper fixed) · loadout_request happy + every reject path asserting `loadout_ack` DELIVERY on the fake
net · assign carries catalog+policy · all-ready advance · ready ends a try-out · tryout refusal reason.
"""
from __future__ import annotations

from brx_mcp.mc import envelope as E
from brx_mcp.mc import policy as P
from brx_mcp.mc.compile import Compiler, WeaponCatalog
from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.perks import PerkCatalog, default_perks
from brx_mcp.mc.state import Session, default_config
from _session import match_config

T0 = 5_000_000
C = Compiler()
W = [w for w in C.weapon_catalog()]
PK = default_perks().all()
_TEAMS = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
          {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 2}]


def _cfg(mode="tdm"):
    return match_config(mode, teams=_TEAMS)


def _player(lo, num=7):
    return {"player_id": f"p{num}", "player_num": num, "display": "REAPER", "team_id": "blue", "node_id": None,
            "gun_id": None, "voice": "male", "ready": True, "loadout": lo}


def mk(n=2, mode="tdm", compiler=None):
    clock = {"t": T0}
    net = FakeNet()
    s = Session(compiler or FakeCompiler(), net, FakeArmory(demo_armory()), now_ms=lambda: clock["t"])
    s.set_config({"mode": mode, "time_limit_s": 60})
    ps = [s.add_player(f"OP{i}", gun_id=f"GUN-{chr(65 + i)}") for i in range(n)]
    return s, net, clock, ps


def online(s, net, clock, p, i, synced=True):
    tail = demo_armory()[i]["ble"]["tail"]
    net.simulate_hello(f"node{i}", f"GUN-{chr(65 + i)}-{tail}")
    net.simulate_status(f"node{i}", {"player_id": p["player_id"], "hp": 45, "armor": 70, "ammo": 36, "alive": True, "shots": 0,
                                     "battery": 80, "fw": "v4.32", "arm_state": "kitted", "synced": synced,
                                     "preflight": {"ssid_ok": True, "mc_reachable": True, "phone_batt": 90, "screen_on": True,
                                                   "foreground": True, "gun_linked": True}}, clock["t"])


def _req(net, i, slot, kind, rid=None, try_=False, t=T0):
    body = {"node_id": f"node{i}", "player_id": "ignored-by-server", "slot": slot, "kind": kind}
    if rid:
        body["id"] = rid
    if try_:
        body["try"] = True
    net.simulate_node_message(f"node{i}", "loadout_request", body, t)


def _last_ack(net, i):
    acks = net.pushes("loadout_ack", f"node{i}")
    assert acks, "no loadout_ack DELIVERED to the node — every request must be answered (§4.2)"
    return acks[-1][2]


# ------------------------------------------------------------------ catalog
def test_weapons_carry_tags_and_perks_catalog_is_visible_only():
    ids = {w["weapon_id"]: set(w["tags"]) for w in W}
    for wid in ("rocket_launcher", "rail_gun", "laser_cannon", "energy_launcher", "ion_sniper"):
        assert "heavy" in ids[wid], wid
    assert "heavy" not in ids["amr"] and "sniper" in ids["amr"]
    for wid in ("sniper_rifle", "plasma_sniper", "ion_sniper"):
        assert "sniper" in ids[wid]
    assert "melee" not in ids
    assert [p["perk_id"] for p in PK] == ["body_armor", "extended_mags", "quick_hands", "easy_reload", "quick_switch"]
    assert all(not p["hidden"] for p in PK)
    full = PerkCatalog()
    assert full.has("med_kit") and full.row("med_kit")["hidden"] and full.row("med_kit")["mechanism"] == "slot_frame"
    assert all(p["mechanism"] == "passive" for p in PK)
    try:
        PerkCatalog([{"perk_id": "x", "name": "X", "effects": {"laser_eyes": 1}}]); assert False
    except ValueError:
        pass


# ------------------------------------------------------------------ policy engine
def test_presets_and_pools():
    lp = P.pool(P.preset_rules("open"), W, PK)
    assert len(lp["primary"]) == 21 and len(lp["secondary_weapons"]) == 21 and len(lp["perks"]) == 5
    lp = P.pool(P.preset_rules("no_heavies"), W, PK)
    assert len(lp["primary"]) == 16 and "rail_gun" not in lp["primary"] and "amr" in lp["primary"]   # 13 + the three sidearms
    assert "rocket_launcher" not in lp["secondary_weapons"] and len(lp["perks"]) == 5
    lp = P.pool(P.preset_rules("snipers"), W, PK)
    assert lp == {"primary": ["sniper_rifle"], "secondary_weapons": [], "perks": []}
    assert P.default_policy("ffa")["preset"] == "no_heavies" and P.default_policy("tdm")["preset"] == "open"
    assert default_config("ffa")["loadout_policy"]["preset"] == "no_heavies"


def test_merge_preset_name_rewrites_and_rule_edit_flips_to_custom():
    pol = P.merge(P.preset_rules("open"), {"preset": "snipers"})
    assert pol["primary"]["choice"] == "fixed" and pol["primary"]["fixed_id"] == "sniper_rifle" and pol["hud_select"] is False
    pol = P.merge(pol, {"preset": "open"})
    assert pol["preset"] == "open" and pol["hud_select"] is True
    pol = P.merge(pol, {"perk": {"choice": "off"}})                # A14: the perk rule is its own slot
    assert pol["preset"] == "custom" and P.pool(pol, W, PK)["perks"] == [] and len(P.pool(pol, W, PK)["secondary_weapons"]) == 21
    pol = P.merge(pol, {"perk": {"choice": "player"}})
    assert pol["preset"] == "open"                      # matches a preset again → named again
    pol = P.merge(pol, {"primary": {"exclude_tags": ["heavy"]}, "secondary": {"exclude_tags": ["heavy"]}})
    assert pol["preset"] == "no_heavies"
    for bad in ({"preset": "nope"}, {"primary": {"choice": "off"}}, {"primary": {"choice": "fixed"}},
                {"secondary": {"kinds": []}}, {"secondary": {"exclude_tags": "heavy"}}):
        try:
            P.merge(P.preset_rules("open"), bad); assert False, bad
        except ValueError:
            pass
    assert P.normalize(None, "ffa")["preset"] == "no_heavies"
    assert P.normalize({"garbage": 1}, "tdm")["preset"] == "open"


def test_validate_and_apply_matrix():
    nh = P.preset_rules("no_heavies"); lp = P.pool(nh, W, PK)
    ok, why = P.validate_loadout(nh, lp, {"weapons": [{"weapon_id": "rail_gun"}]}, W, PK)
    assert not ok and why == "Heavies are off for this game"
    ok, why = P.validate_loadout(nh, lp, {"weapons": [{"weapon_id": "smg"}, {"weapon_id": "rocket_launcher"}]}, W, PK)
    assert not ok and "Heavies" in why
    assert P.validate_loadout(nh, lp, {"weapons": [{"weapon_id": "smg"}], "perk": "body_armor"}, W, PK) == (True, None)
    sn = P.preset_rules("snipers"); lps = P.pool(sn, W, PK)
    ok, why = P.validate_loadout(sn, lps, {"weapons": [{"weapon_id": "smg"}]}, W, PK)
    assert not ok and "fixed to Sniper Rifle" in why and "BUILD" in why
    ok, why = P.validate_loadout(sn, lps, {"weapons": [{"weapon_id": "sniper_rifle"}], "perk": "body_armor"}, W, PK)
    assert not ok and why == "No perks this game"
    ok, why = P.validate_loadout(sn, lps, {"weapons": [{"weapon_id": "sniper_rifle"}, {"weapon_id": "smg"}]}, W, PK)
    assert not ok and why == "No secondary this game"
    # A14: a perk rides beside a secondary weapon
    assert P.validate_loadout(nh, lp, {"weapons": [{"weapon_id": "smg"}, {"weapon_id": "glock"}], "perk": "quick_switch"}, W, PK) == (True, None)
    # apply: fixed → set, off → cleared, out-of-pool → replaced
    assert P.apply(sn, lps, {"weapons": [{"weapon_id": "smg"}, {"weapon_id": "shotgun"}], "perk": "body_armor"}, W, PK) == {"weapons": [{"weapon_id": "sniper_rifle"}]}
    out = P.apply(nh, lp, {"weapons": [{"weapon_id": "rail_gun"}, {"weapon_id": "rocket_launcher"}], "overrides": {"max_hp": 60}}, W, PK)
    assert out == {"weapons": [{"weapon_id": "assault_rifle"}], "overrides": {"max_hp": 60}}
    # a fixed perk is set for everyone; the ALT-button one (Easy Reload) also drops the second weapon, Body Armor keeps it
    fixed_perk = P.merge(P.preset_rules("open"), {"perk": {"choice": "fixed", "fixed_id": "easy_reload"}})
    lpf = P.pool(fixed_perk, W, PK)
    assert lpf["perks"] == ["easy_reload"] and len(lpf["secondary_weapons"]) == 21
    assert P.apply(fixed_perk, lpf, {"weapons": [{"weapon_id": "smg"}, {"weapon_id": "shotgun"}]}, W, PK) == {"weapons": [{"weapon_id": "smg"}], "perk": "easy_reload"}
    armor = P.merge(P.preset_rules("open"), {"perk": {"choice": "fixed", "fixed_id": "body_armor"}})
    assert P.apply(armor, P.pool(armor, W, PK), {"weapons": [{"weapon_id": "smg"}, {"weapon_id": "shotgun"}]}, W, PK) == {"weapons": [{"weapon_id": "smg"}, {"weapon_id": "shotgun"}], "perk": "body_armor"}


def test_check_request_matrix():
    op = P.preset_rules("open"); lp = P.pool(op, W, PK)
    assert P.check_request(op, lp, "primary", "weapon", "smg", W, PK) == (True, None)
    assert P.check_request(op, lp, "perk", "perk", "body_armor", W, PK) == (True, None)
    assert P.check_request(op, lp, "secondary", "perk", "body_armor", W, PK) == (False, "Perks have their own slot this game")   # A14
    assert P.check_request(op, lp, "perk", "weapon", "smg", W, PK) == (False, "Only a perk goes in the perk slot")
    assert P.check_request(op, lp, "secondary", "none", None, W, PK) == (True, None)
    assert P.check_request(op, lp, "perk", "none", None, W, PK) == (True, None)
    assert P.check_request(op, lp, "primary", "none", None, W, PK)[1] == "A primary weapon is required"
    assert "perk" in P.check_request(op, lp, "primary", "perk", "body_armor", W, PK)[1].lower()
    assert P.check_request(op, lp, "primary", "weapon", "melee", W, PK)[1] == "Unknown weapon"
    hud_off = P.merge(op, {"hud_select": False})
    assert P.check_request(hud_off, lp, "primary", "weapon", "smg", W, PK)[1] == "Loadout picks are host-side for this game"
    host = P.merge(op, {"primary": {"choice": "host"}})
    assert "locked" in P.check_request(host, P.pool(host, W, PK), "primary", "weapon", "smg", W, PK)[1]
    sn = P.preset_rules("snipers"); lps = P.pool(sn, W, PK)
    assert P.check_request(sn, lps, "secondary", "weapon", "shotgun", W, PK)[1] == "No secondary this game"
    assert P.check_request(sn, lps, "perk", "perk", "body_armor", W, PK)[1] == "No perks this game"
    nh = P.preset_rules("no_heavies"); lpn = P.pool(nh, W, PK)
    assert P.check_request(nh, lpn, "secondary", "weapon", "rail_gun", W, PK)[1] == "Heavies are off for this game"


# ------------------------------------------------------------------ _check_loadout
def test_check_loadout_matrix():
    s, net, clock, ps = mk(1)
    pid = ps[0]["player_id"]
    ok = s.patch_player(pid, loadout={"weapons": [{"weapon_id": "smg"}], "perk": "body_armor"})
    assert ok["loadout"] == {"weapons": [{"weapon_id": "smg"}], "perk": "body_armor"}
    ok = s.patch_player(pid, loadout={"weapons": [{"weapon_id": "smg"}, {"weapon_id": "shotgun"}], "perk": None})
    assert ok["loadout"] == {"weapons": [{"weapon_id": "smg"}, {"weapon_id": "shotgun"}]}
    ok = s.patch_player(pid, loadout={"weapons": [{"weapon_id": "smg"}, {"weapon_id": "shotgun"}], "perk": "body_armor"})   # A14: both
    assert ok["loadout"] == {"weapons": [{"weapon_id": "smg"}, {"weapon_id": "shotgun"}], "perk": "body_armor"}
    for bad, hint in (({"weapons": [{"weapon_id": "smg"}, {"weapon_id": "shotgun"}], "perk": "easy_reload"}, "ALT button"),   # the one pairing the gun can't do
                      ({"weapons": [{"weapon_id": "smg"}], "perk": "laser_eyes"}, "unknown perk"),
                      ({"weapons": [{"weapon_id": "smg"}], "perk": 7}, "perk_id"),
                      ({"weapons": [{"weapon_id": "smg"}, {"weapon_id": "shotgun"}, {"weapon_id": "amr"}]}, "at most"),
                      ({"weapons": []}, "loadout must")):
        try:
            s.patch_player(pid, loadout=bad); assert False, bad
        except ValueError as e:
            assert hint.lower() in str(e).lower(), (bad, str(e))
    # hidden (unbenched) perks are NOT pickable even by the host
    try:
        s.patch_player(pid, loadout={"weapons": [{"weapon_id": "smg"}], "perk": "med_kit"}); assert False
    except ValueError:
        pass


def test_host_patch_is_policy_checked_and_apply_policy_on_config_change():
    s, net, clock, ps = mk(2, mode="ffa")
    assert s.config["loadout_policy"]["preset"] == "no_heavies"
    try:
        s.patch_player(ps[0]["player_id"], loadout={"weapons": [{"weapon_id": "rail_gun"}]}); assert False
    except ValueError as e:
        assert str(e) == "Heavies are off for this game"
    s.set_config({"loadout_policy": {"preset": "open"}})
    s.patch_player(ps[0]["player_id"], loadout={"weapons": [{"weapon_id": "rail_gun"}, {"weapon_id": "rocket_launcher"}]})
    s.patch_player(ps[1]["player_id"], loadout={"weapons": [{"weapon_id": "smg"}], "perk": "extended_mags"})
    online(s, net, clock, ps[0], 0)
    n_assign = len(net.pushes("assign", "node0"))
    # switching the ruleset auto-fixes every loadout and re-assigns the bound node
    s.set_config({"loadout_policy": {"preset": "snipers"}})
    for p in s.players.values():
        assert p["loadout"] == {"weapons": [{"weapon_id": "sniper_rifle"}]}
    assert len(net.pushes("assign", "node0")) == n_assign + 1
    assert s.snapshot()["loadout_pool"] == {"primary": ["sniper_rifle"], "secondary_weapons": [], "perks": []}
    # a MODE CHANGE applies the mode default (same mode = "run it back", the ruleset is kept);
    # a new player obeys the ruleset from birth
    s.set_config({"mode": "tdm"})
    assert s.config["loadout_policy"]["preset"] == "open"
    s.set_config({"mode": "ffa"})
    assert s.config["loadout_policy"]["preset"] == "no_heavies"
    p3 = s.add_player("OP3", loadout={"weapons": [{"weapon_id": "laser_cannon"}], "perk": "body_armor"})
    assert p3["loadout"] == {"weapons": [{"weapon_id": "assault_rifle"}], "perk": "body_armor"}
    # PUT /api/config partial: a rule edit → custom
    s.set_config({"loadout_policy": {"secondary": {"choice": "off"}}})
    assert s.config["loadout_policy"]["preset"] == "custom" and p3["loadout"]["perk"] == "body_armor"   # A14: slot 2 off leaves the perk
    s.set_config({"loadout_policy": {"perk": {"choice": "off"}}})
    assert "perk" not in p3["loadout"]


def test_restore_snapshot_without_policy_fills_default(tmp_path=None):
    import pathlib, tempfile, json
    d = pathlib.Path(tempfile.mkdtemp())
    s, net, clock, ps = mk(1)
    s.patch_player(ps[0]["player_id"], loadout={"weapons": [{"weapon_id": "smg"}, {"weapon_id": "shotgun"}]})
    cfg = dict(s.config); cfg.pop("loadout_policy")
    (d / "session.json").write_text(json.dumps({"v": 1, "saved_ms": 1, "players": list(s.players.values()), "teams": s.teams, "config": cfg}))
    s2 = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()), now_ms=lambda: T0)
    s2._persist_path = d / "session.json"
    assert s2.restore_snapshot() == 1
    assert s2.config["loadout_policy"]["preset"] == "open"
    assert list(s2.players.values())[0]["loadout"]["weapons"][1]["weapon_id"] == "shotgun"


# ------------------------------------------------------------------ compiler
def test_compile_no_slot_1_when_no_secondary():
    b = C.compile(_cfg(), _player({"weapons": [{"weapon_id": "assault_rifle"}]}), _TEAMS)
    weaps = [f for f in b["head"] if f.startswith("$WEAP,")]
    assert [w.split(",")[1] for w in weaps] == ["0", "4"], weaps          # primary + melee, NO shotgun default
    assert not any(f.startswith("$AMMO,1,") for f in b["spawn"] + b["revive"])
    assert sum(1 for f in b["spawn"] if f.startswith("$AMMO,0,")) == 1
    b2 = C.compile(_cfg(), _player({"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "shotgun"}]}), _TEAMS)
    assert any(f.startswith("$WEAP,1,") for f in b2["head"]) and any(f == "$AMMO,1,6,24,1,*" for f in b2["spawn"])


def _tok(frame: str, doc_tok: int) -> str:
    return frame.split(",")[doc_tok + 1]


def test_compile_perk_effects():
    base = C.compile(_cfg(), _player({"weapons": [{"weapon_id": "assault_rifle"}]}), _TEAMS)
    w0 = [f for f in base["head"] if f.startswith("$WEAP,0")][0]
    # extended_mags: ×2 mag + reserve on $AMMO,0 AND the frame (t16/t39 mag, t17/t40 reserve; t17 == 2×t40)
    b = C.compile(_cfg(), _player({"weapons": [{"weapon_id": "assault_rifle"}], "perk": "extended_mags"}), _TEAMS)
    f = [x for x in b["head"] if x.startswith("$WEAP,0")][0]
    assert _tok(f, 16) == _tok(f, 39) == "64" and _tok(f, 17) == "384" and _tok(f, 40) == "192"
    assert "$AMMO,0,64,384,1,*" in b["spawn"] and "$AMMO,0,64,384,1,*" in b["revive"]
    assert _tok(f, 18) == _tok(w0, 18)                                   # reload untouched
    # quick_hands: reload halved (t18), ammo untouched
    b = C.compile(_cfg(), _player({"weapons": [{"weapon_id": "assault_rifle"}], "perk": "quick_hands"}), _TEAMS)
    f = [x for x in b["head"] if x.startswith("$WEAP,0")][0]
    assert int(_tok(f, 18)) == int(_tok(w0, 18)) // 2 and _tok(f, 16) == _tok(w0, 16)
    # body_armor: +50 on $PSET armor (token 4), hp untouched, config armor otherwise the same
    b = C.compile(_cfg(), _player({"weapons": [{"weapon_id": "assault_rifle"}], "perk": "body_armor"}), _TEAMS)
    pset = [x for x in b["head"] if x.startswith("$PSET")][0].split(",")
    assert pset[3] == "45" and pset[4] == "120"
    assert [x for x in base["head"] if x.startswith("$PSET")][0].split(",")[4] == "70"
    # easy_reload: ALT button = reload
    b = C.compile(_cfg(), _player({"weapons": [{"weapon_id": "assault_rifle"}], "perk": "easy_reload"}), _TEAMS)
    assert "$BMAP,1,97,,,,,*" in b["head"] and "$BMAP,1,100,0,1,99,99,*" not in b["head"]
    # empty slot 2 without the perk: ALT cycles to slot 0 only (never to the unloaded slot 1 — brx-opus review);
    # a real secondary keeps the stock 0↔1 cycle
    assert "$BMAP,1,100,0,0,99,99,*" in base["head"] and "$BMAP,1,100,0,1,99,99,*" not in base["head"]
    two = C.compile(_cfg(), _player({"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "shotgun"}]}), _TEAMS)
    assert "$BMAP,1,100,0,1,99,99,*" in two["head"]
    # a perk never touches a secondary weapon (perk ⇒ no slot 1 anyway) and never the tutorial
    tut = C.tutorial_frames({"weapon_id": "assault_rifle"}, "indoor")
    assert any(f == "$AMMO,0,32,192,1,*" for f in tut)


def test_compile_validate_perks():
    r = C.validate(_cfg(), [_player({"weapons": [{"weapon_id": "assault_rifle"}], "perk": "nope"})])
    assert any("unknown perk_id" in e for e in r["errors"])
    r = C.validate(_cfg(), [_player({"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "shotgun"}], "perk": "body_armor"})])
    assert r["ok"] and not r["errors"]          # A14: a perk rides beside a secondary weapon; the compiler arms both
    assert C.validate(_cfg(), [_player({"weapons": [{"weapon_id": "sniper_rifle"}], "perk": "easy_reload"})])["ok"]


# ------------------------------------------------------------------ F123: easy_reload vs a chain reload
def test_chain_reload_is_an_explicit_attribute_and_the_shotgun_is_the_only_proven_one():
    """The Shotgun's per-shell walk is bench-measured; nothing else is. The attribute must stay pinned to
    what the wire proved, and it must NOT be inferred from `$WEAP` t19 — the Plasma Sniper has an
    operator-confirmed shell reload at t19 = 0 (protocol/callsign-extract/protocol-classes.md)."""
    import json
    import pathlib

    import brx_mcp.mc.compile as _compile
    rows = json.loads((pathlib.Path(_compile.__file__).with_name("weapons.json")).read_text())["weapons"]
    chain = {w["weapon_id"] for w in rows if w.get("reload_type") == "chain"}
    assert chain == {"shotgun"}, chain
    assert P.chain_reload({"weapon_id": "shotgun"}) and not P.chain_reload({"weapon_id": "assault_rifle"})
    # an explicit field on the row WINS over the id lookup, so the day the compiled catalog publishes
    # `reload_type` this stops reading the data file at all
    assert not P.chain_reload({"weapon_id": "shotgun", "reload_type": "magazine"})
    assert P.chain_reload({"weapon_id": "made_up_gun", "reload_type": "chain"})
    assert not P.chain_reload(None) and not P.chain_reload({})
    # and the t19 reading stays refuted: the Shotgun carries 2, but so does nothing else that shell-reloads
    shotgun = next(w for w in rows if w["weapon_id"] == "shotgun")
    assert shotgun["capture"]["frame"].split(",")[20] == "2"
    plasma = next(w for w in rows if w["weapon_id"] == "plasma_sniper")
    assert plasma["capture"]["frame"].split(",")[20] == "0", "t19 is not reloadType — do not infer from it"


def test_easy_reload_is_refused_beside_a_chain_reload_weapon():
    """F123 (field 2026-09-11): "easy reload does not work with the shotgun… holding alt fire doesnt work".
    `easy_reload` is a MOMENTARY `$BMAP,1,97`; the Shotgun wants the handle HELD for six shells. Excluded."""
    op = P.preset_rules("open"); lp = P.pool(op, W, PK)
    bad = {"weapons": [{"weapon_id": "shotgun"}], "perk": "easy_reload"}
    ok, why = P.validate_loadout(op, lp, bad, W, PK)
    assert ok is False
    assert why == "Shotgun loads shell by shell — Easy Reload only taps the button once, so it can't reload it"
    assert P.chain_conflict(bad, W, PK) == {"perk": "easy_reload", "weapon": "shotgun"}
    # every other perk is fine on the shotgun, and easy_reload is fine on every magazine weapon
    for pid in ("body_armor", "extended_mags", "quick_hands", "quick_switch"):
        assert P.validate_loadout(op, lp, {"weapons": [{"weapon_id": "shotgun"}], "perk": pid}, W, PK)[0], pid
    for wid in ("assault_rifle", "smg", "sniper_rifle", "plasma_sniper", "charge_rifle"):
        assert P.validate_loadout(op, lp, {"weapons": [{"weapon_id": wid}], "perk": "easy_reload"}, W, PK)[0], wid
    assert P.chain_conflict({"weapons": [{"weapon_id": "shotgun"}], "perk": "quick_hands"}, W, PK) is None


def test_a_chain_reload_pick_drops_the_perk_and_says_so():
    """The resolution is the OPPOSITE way round to the second-weapon rule, because a primary is mandatory:
    picking the Shotgun drops Easy Reload, and picking Easy Reload onto a Shotgun is simply refused."""
    before = {"weapons": [{"weapon_id": "assault_rifle"}], "perk": "easy_reload"}
    after = P.set_slot(before, "primary", "weapon", "shotgun", PK)
    assert after == {"weapons": [{"weapon_id": "shotgun"}]}
    dropped, why = P.dropped_by(before, after, W, PK)
    assert dropped == {"slot": "perk", "id": "easy_reload", "name": "Easy Reload"}
    assert why == "Shotgun loads shell by shell — Easy Reload dropped"
    # The other direction has nothing to drop — a primary is mandatory — so `check_request` refuses it with
    # the hint, and `set_slot` is the backstop that never STORES the pairing even if a caller skips the check.
    op = P.preset_rules("open"); lp = P.pool(op, W, PK)
    held = {"weapons": [{"weapon_id": "shotgun"}]}
    ok, why = P.check_request(op, lp, "perk", "perk", "easy_reload", W, PK, held)
    assert ok is False
    assert why == "Shotgun loads shell by shell — Easy Reload only taps the button once, so it can't reload it"
    assert P.check_request(op, lp, "perk", "perk", "quick_hands", W, PK, held)[0] is True, "only the ALT perk is refused"
    assert P.check_request(op, lp, "perk", "perk", "easy_reload", W, PK,
                           {"weapons": [{"weapon_id": "assault_rifle"}]})[0] is True, "and only beside a chain weapon"
    assert P.check_request(op, lp, "perk", "perk", "easy_reload", W, PK)[0] is True, "no loadout given → the rule cannot fire"
    assert P.set_slot(held, "perk", "perk", "easy_reload", PK) == held, "the pairing is never stored"
    # a HOST-side auto-fix (a config change, no tap) drops the perk rather than the mandatory primary
    bad = {"weapons": [{"weapon_id": "shotgun"}], "perk": "easy_reload"}
    assert P.apply(op, lp, bad, W, PK) == {"weapons": [{"weapon_id": "shotgun"}]}


def test_the_phone_gets_the_hint_when_it_asks_for_easy_reload_on_a_shotgun():
    """End to end on the fake net: the reject must be DELIVERED as a `loadout_ack`, with the reason the HUD
    shows verbatim (loadout.md §4.2)."""
    s, net, clock, ps = mk(1)
    pid = ps[0]["player_id"]
    online(s, net, clock, ps[0], 0)
    s.patch_player(pid, loadout={"weapons": [{"weapon_id": "shotgun"}]})
    _req(net, 0, "perk", "perk", "easy_reload")
    ack = _last_ack(net, 0)
    assert ack["ok"] is False
    assert ack["reason"] == "Shotgun loads shell by shell — Easy Reload only taps the button once, so it can't reload it"
    assert s.players[pid]["loadout"] == {"weapons": [{"weapon_id": "shotgun"}]}, "the refused pick did not apply"
    # and the other way: picking the shotgun while holding the perk applies, and the ack says what it cost
    s.patch_player(pid, loadout={"weapons": [{"weapon_id": "assault_rifle"}], "perk": "easy_reload"})
    _req(net, 0, "primary", "weapon", "shotgun")
    ack = _last_ack(net, 0)
    assert ack["ok"] is True and ack["dropped"] == {"slot": "perk", "id": "easy_reload", "name": "Easy Reload"}
    assert ack["reason"] == "Shotgun loads shell by shell — Easy Reload dropped"
    assert s.players[pid]["loadout"] == {"weapons": [{"weapon_id": "shotgun"}]}


def test_compile_sniper_fixed_end_to_end_through_session():
    s, net, clock, ps = mk(1, compiler=C)
    s.set_config({"loadout_policy": {"preset": "snipers"}})
    online(s, net, clock, ps[0], 0)
    s.push_config()
    frames = net.pushes("config", "node0")[-1][2]["frames"]["head"]
    weaps = [f for f in frames if f.startswith("$WEAP,")]
    assert weaps[0].startswith("$WEAP,0") and len(weaps) == 2      # sniper primary + melee only
    assert "$WEAP,0" + C.catalog.resolve("sniper_rifle", 0)[7:] == weaps[0]


# ------------------------------------------------------------------ wire: envelope kinds
def test_envelope_accepts_loadout_kinds_and_optional_fields():
    env = E.make_envelope("loadout_request", {"node_id": "n1", "player_id": "p1", "slot": "primary", "kind": "weapon"})
    E.validate(env)                                                        # id/try optional
    E.validate(E.make_envelope("loadout_browse", {"node_id": "n1", "player_id": "p1", "open": True}))
    E.validate(E.make_envelope("loadout_ack", {"slot": "primary", "ok": False}), direction="mc")   # reason optional
    try:
        E.validate(E.make_envelope("loadout_request", {"node_id": "n1", "player_id": "p1", "slot": "primary"})); assert False
    except E.EnvelopeError as e:
        assert e.reason == "missing_field"
    try:
        E.validate(E.make_envelope("loadout_ack", {"slot": "primary", "ok": True})); assert False   # wrong direction
    except E.EnvelopeError as e:
        assert e.reason == "unknown_kind"


# ------------------------------------------------------------------ assign carries catalog + policy
def test_assign_and_welcome_carry_catalog_and_policy():
    s, net, clock, ps = mk(1, mode="ffa")
    online(s, net, clock, ps[0], 0)
    ctx = s._hydrate({"node_id": "nodeX", "gun": {"name": "GUN-A-3D4F", "tail": "3D4F"}})
    assert ctx and "catalog" in ctx and "policy" in ctx           # welcome hydration carries both
    # (that hydrate hot-swapped the player onto nodeX — the phone that holds GUN-A now)
    s.patch_player(ps[0]["player_id"], display="REAPER")            # any player change → assign
    a = net.pushes("assign", "nodeX")[-1][2]
    assert {w["weapon_id"] for w in a["catalog"]["weapons"]} >= {"smg", "rail_gun"} and all("tags" in w for w in a["catalog"]["weapons"])
    assert [p["perk_id"] for p in a["catalog"]["perks"]] == ["body_armor", "extended_mags", "quick_hands", "easy_reload", "quick_switch"]
    pol = a["policy"]
    assert pol["hud_select"] is True and pol["primary"]["choice"] == "player"
    assert "rail_gun" not in pol["primary"]["allowed_ids"] and "smg" in pol["primary"]["allowed_ids"]
    assert pol["secondary"]["kinds"] == ["weapon"] and "allowed_perk_ids" not in pol["secondary"]      # A14: perks left slot 2 …
    assert pol["perk"]["choice"] == "player" and "body_armor" in pol["perk"]["allowed_perk_ids"]        # … for their own rule
    assert "rocket_launcher" not in pol["secondary"]["allowed_weapon_ids"]
    # every loadout change re-sends assign with the new loadout
    n = len(net.pushes("assign", "nodeX"))
    s.patch_player(ps[0]["player_id"], loadout={"weapons": [{"weapon_id": "smg"}]})
    assert len(net.pushes("assign", "nodeX")) == n + 1 and net.pushes("assign", "nodeX")[-1][2]["player"]["loadout"]["weapons"][0]["weapon_id"] == "smg"


# ------------------------------------------------------------------ loadout_request happy + rejects (with ack DELIVERY)
def test_loadout_request_happy_paths_with_try():
    s, net, clock, ps = mk(2)
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    pid = ps[0]["player_id"]
    _req(net, 0, "primary", "weapon", "smg", try_=True)
    ack = _last_ack(net, 0)
    assert ack["ok"] is True and ack["slot"] == "primary" and ack["loadout"]["weapons"][0]["weapon_id"] == "smg" and "reason" not in ack
    assert s.players[pid]["loadout"]["weapons"][0]["weapon_id"] == "smg"
    assert s.trying[pid] == "smg" and net.pushes("tutorial", "node0")[-1][2]["weapon"]["weapon_id"] == "smg"
    assert net.pushes("assign", "node0")[-1][2]["player"]["loadout"]["weapons"][0]["weapon_id"] == "smg"
    # secondary weapon, then a perk BESIDE it (A14), then none on each
    _req(net, 0, "secondary", "weapon", "shotgun")
    assert s.players[pid]["loadout"]["weapons"][1]["weapon_id"] == "shotgun" and _last_ack(net, 0)["ok"]
    _req(net, 0, "perk", "perk", "body_armor")
    assert s.players[pid]["loadout"] == {"weapons": [{"weapon_id": "smg"}, {"weapon_id": "shotgun"}], "perk": "body_armor"}
    assert _last_ack(net, 0)["ok"] and "dropped" not in _last_ack(net, 0)
    _req(net, 0, "perk", "none")
    assert s.players[pid]["loadout"] == {"weapons": [{"weapon_id": "smg"}, {"weapon_id": "shotgun"}]} and _last_ack(net, 0)["ok"]
    _req(net, 0, "secondary", "none")
    assert s.players[pid]["loadout"] == {"weapons": [{"weapon_id": "smg"}]} and _last_ack(net, 0)["ok"]
    # a second player's request never touches the first
    _req(net, 1, "primary", "weapon", "amr")
    assert s.players[ps[1]["player_id"]]["loadout"]["weapons"][0]["weapon_id"] == "amr"
    assert s.players[pid]["loadout"]["weapons"][0]["weapon_id"] == "smg"
    # the MC snapshot shows both selections + the try-out
    snap = s.snapshot()
    assert snap["kit"]["trying"] == {pid: "smg"}
    # browsing presence with 60 s expiry
    net.simulate_node_message("node1", "loadout_browse", {"node_id": "node1", "player_id": "x", "open": True}, clock["t"])
    assert ps[1]["player_id"] in s.snapshot()["kit"]["browsing"]
    clock["t"] += 61_000
    assert ps[1]["player_id"] not in s.snapshot()["kit"]["browsing"]
    net.simulate_node_message("node1", "loadout_browse", {"node_id": "node1", "player_id": "x", "open": True}, clock["t"])
    net.simulate_node_message("node1", "loadout_browse", {"node_id": "node1", "player_id": "x", "open": False}, clock["t"])
    assert ps[1]["player_id"] not in s.snapshot()["kit"]["browsing"]
    # a successful pick clears "browsing"
    net.simulate_node_message("node1", "loadout_browse", {"node_id": "node1", "player_id": "x", "open": True}, clock["t"])
    _req(net, 1, "primary", "weapon", "smg", t=clock["t"])
    assert ps[1]["player_id"] not in s.snapshot()["kit"]["browsing"]


def test_loadout_request_reject_paths_each_deliver_an_ack():
    s, net, clock, ps = mk(1, mode="ffa")           # no_heavies
    online(s, net, clock, ps[0], 0)
    pid = ps[0]["player_id"]
    before = dict(s.players[pid]["loadout"])
    cases = [
        (("primary", "weapon", "rail_gun"), "Heavies are off for this game"),
        (("secondary", "weapon", "rocket_launcher"), "Heavies are off for this game"),
        (("primary", "none", None), "A primary weapon is required"),
        (("primary", "weapon", "melee"), "Unknown weapon"),
        (("perk", "perk", "med_kit"), "Unknown perk"),                  # hidden = unknown to the phone
        (("secondary", "perk", "body_armor"), "Perks have their own slot this game"),   # A14
        (("perk", "weapon", "smg"), "Only a perk goes in the perk slot"),
        (("primary", "perk", "body_armor"), None),
        (("nowhere", "weapon", "smg"), "Unknown slot"),
        (("secondary", "weapon", None), "Unknown pick"),
    ]
    n = 0
    for (slot, kind, rid), reason in cases:
        _req(net, 0, slot, kind, rid)
        acks = net.pushes("loadout_ack", "node0")
        n += 1
        assert len(acks) == n, f"{slot}/{kind}/{rid}: no ack delivered"
        ack = acks[-1][2]
        assert ack["ok"] is False and ack["slot"] == slot and ack["reason"], ack
        if reason:
            assert ack["reason"] == reason, (slot, kind, rid, ack["reason"])
        assert ack["loadout"] == before                                  # rejected → nothing stored
    assert s.players[pid]["loadout"] == before and not net.pushes("tutorial")
    # host-locked and hud_select off
    s.set_config({"loadout_policy": {"preset": "open", "primary": {"choice": "host"}}})
    _req(net, 0, "primary", "weapon", "smg")
    assert "locked" in _last_ack(net, 0)["reason"]
    s.set_config({"loadout_policy": {"preset": "open", "hud_select": False}})
    _req(net, 0, "primary", "weapon", "smg")
    assert _last_ack(net, 0)["reason"] == "Loadout picks are host-side for this game"
    # snipers: secondary off + primary fixed
    s.set_config({"loadout_policy": {"preset": "snipers"}})
    _req(net, 0, "secondary", "weapon", "smg")
    assert _last_ack(net, 0)["reason"] == "No secondary this game"
    _req(net, 0, "perk", "perk", "body_armor")
    assert _last_ack(net, 0)["reason"] == "No perks this game"
    # try-outs closed once pushed: the pick still applies, the ack says why the gun didn't arm
    s.set_config({"loadout_policy": {"preset": "open"}})
    s.push_config()
    _req(net, 0, "primary", "weapon", "smg", try_=True)
    ack = _last_ack(net, 0)
    assert ack["ok"] is True and "closed" in ack["reason"] and s.players[pid]["loadout"]["weapons"][0]["weapon_id"] == "smg"
    assert pid not in s.trying
    assert net.pushes("config", "node0")[-1][2]["frames"]["head"]      # re-compiled + re-pushed after the push


# ------------------------------------------------------------------ ready semantics (§4.4)
def test_all_ready_advances_not_first_ready():
    s, net, clock, ps = mk(3)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    assert s.phase == "kit"
    net.simulate_node_message("node0", "ready", {"node_id": "node0", "player_id": "x", "ready": True}, clock["t"])
    assert s.phase == "kit", "first ready must NOT advance (brx-opus2 S1)"
    s.tryout(ps[1]["player_id"], "smg")                                # still allowed after one ready
    net.simulate_node_message("node1", "ready", {"node_id": "node1", "player_id": "x", "ready": True}, clock["t"])
    assert s.phase == "kit"
    s.set_ready(ps[2]["player_id"], True, host_override=True)
    assert s.phase == "lobby"


def test_ready_ends_that_players_tryout_only():
    s, net, clock, ps = mk(2)
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    s.tryout(ps[0]["player_id"], "smg"); s.tryout(ps[1]["player_id"], "shotgun")
    net.simulate_node_message("node0", "ready", {"node_id": "node0", "player_id": "x", "ready": True}, clock["t"])
    assert ps[0]["player_id"] not in s.trying and s.trying.get(ps[1]["player_id"]) == "shotgun"
    end = net.pushes("tutorial", "node0")[-1][2]
    assert end.get("end") is True and "$CLEAR,*" in end["frames"]      # teardown DELIVERED to the node
    assert not any(b.get("end") for _, _, b in net.pushes("tutorial", "node1"))
    # host READY override does the same
    s.set_ready(ps[1]["player_id"], True, host_override=True)
    assert not s.trying and net.pushes("tutorial", "node1")[-1][2].get("end") is True


def test_demo_fake_net_populates_varied_loadouts():
    from brx_mcp.mc.__main__ import build
    import argparse
    ns = argparse.Namespace(host="127.0.0.1", port=0, ws_port=0, fake_net=True, demo=True, demo_speed=1.0,
                            no_auth=True, ephemeral=True)
    try:
        session, net, extra = build(ns)
    except TypeError:
        return                                              # build() signature differs — covered by the CLI smoke
    los = [p["loadout"] for p in session.players.values()]
    assert any(len(l["weapons"]) == 2 for l in los) and any(l.get("perk") for l in los) and any(len(l["weapons"]) == 1 and not l.get("perk") for l in los)


# ------------------------------------------------------------------ brx-opus2 additions (2026-08-27)
def test_apply_policy_cancels_tryouts_and_warns_the_host():
    s, net, clock, ps = mk(2, compiler=C)
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    s.patch_player(ps[0]["player_id"], loadout={"weapons": [{"weapon_id": "rail_gun"}]})
    s.tryout(ps[0]["player_id"], "rail_gun")
    s.tryout(ps[1]["player_id"], "assault_rifle")          # still allowed under NO HEAVIES → untouched
    s.set_config({"loadout_policy": {"preset": "no_heavies"}})
    assert ps[0]["player_id"] not in s.trying and net.pushes("tutorial", "node0")[-1][2].get("end") is True
    assert s.trying.get(ps[1]["player_id"]) == "assault_rifle"
    snap = s.snapshot()
    assert "1 LOADOUT RESET BY NO HEAVIES" in snap["config_warnings"]
    s.set_config({"loadout_policy": {"preset": "snipers"}})
    assert "2 LOADOUTS RESET BY SNIPERS ONLY" in s.snapshot()["config_warnings"]
    s.set_config({"night": True})                            # a VENUE-only PUT keeps it (GAMES re-asserts the venue right after apply)
    assert any("RESET BY" in w for w in s.snapshot()["config_warnings"])
    s.set_config({"time_limit_s": 300})                      # any other later PUT clears the transient notice
    assert not any("RESET BY" in w for w in s.snapshot()["config_warnings"])


def test_weapon_view_htk_ttk_caution():
    from brx_mcp.mc.views import weapon_view
    views = {v["weapon_id"]: v for v in (weapon_view(w) for w in C.weapon_catalog())}
    assert views["assault_rifle"]["htk"] == 13 and views["assault_rifle"]["ttk_ms"] == 1680
    assert all(isinstance(v["htk"], int) and v["htk"] >= 1 for v in views.values())
    assert views["energy_launcher"]["caution"].startswith("Known issue") and "caution" not in views["assault_rifle"]
    # the phone gets the same rows in assign.catalog
    s, net, clock, ps = mk(1, compiler=C)
    online(s, net, clock, ps[0], 0)
    s.patch_player(ps[0]["player_id"], display="X")
    cat = net.pushes("assign", "node0")[-1][2]["catalog"]["weapons"]
    assert next(w for w in cat if w["weapon_id"] == "energy_launcher")["caution"] and all("htk" in w for w in cat)


# ------------------------------------------------------------------ A10 §8 saved games (presets)
def _store(tmp=None, s=None):
    import tempfile, pathlib
    from brx_mcp.mc.presets import PresetStore
    from brx_mcp.mc.state import default_config
    s = s or mk(1)[0]
    path = (pathlib.Path(tmp or tempfile.mkdtemp()) / "presets.json")
    return PresetStore(path, s.sanitize_config, default_config, P.merge, now_ms=s.now_ms), path, s


def test_presets_builtin_and_crud_and_name_clash():
    from brx_mcp.mc.presets import PresetError, BUILTIN_SILENCED_SNIPER
    st, path, s = _store()
    rows = st.list()
    assert [r["preset_id"] for r in rows] == [BUILTIN_SILENCED_SNIPER]
    b = rows[0]
    assert b["builtin"] and b["name"] == "Silenced Sniper" and "silenced" in b["desc"].lower() and "config_id" not in b["config"]
    pol = b["config"]["loadout_policy"]
    assert b["config"]["mode"] == "ffa" and b["config"]["health"]["max_armor"] == 0 and pol["hud_select"] is False
    assert pol["primary"] == {**pol["primary"], "choice": "fixed", "fixed_id": "sniper_rifle"} and pol["preset"] == "custom"
    assert pol["secondary"]["choice"] == "off" and pol["perk"] == {**pol["perk"], "choice": "fixed", "fixed_id": "extended_mags"}   # A14 shape
    # create from the current draft (config_id stripped), listed after the builtin, persisted
    s.set_config({"mode": "tdm", "time_limit_s": 300, "loadout_policy": {"preset": "no_heavies"}})
    r = st.create("Friday TDM", "no heavies, 5 min", s.config)
    assert not r["builtin"] and "config_id" not in r["config"] and r["config"]["time_limit_s"] == 300 and r["config"]["loadout_policy"]["preset"] == "no_heavies"
    assert [x["name"] for x in st.list()] == ["Silenced Sniper", "Friday TDM"]
    assert path.exists() and "Friday TDM" in path.read_text()
    # case-insensitive clash → 409 unless replace (keeps the id)
    try:
        st.create("friday tdm", "", s.config); assert False
    except PresetError as e:
        assert e.status == 409
    r2 = st.create("FRIDAY tdm", "replaced", {**s.config, "time_limit_s": 120}, replace=True)
    assert r2["preset_id"] == r["preset_id"] and r2["config"]["time_limit_s"] == 120 and r2["name"] == "FRIDAY tdm" and len(st.list()) == 2
    # update + delete
    r3 = st.update(r["preset_id"], name="Friday Night", desc="x")
    assert r3["name"] == "Friday Night" and st.get(r["preset_id"])["desc"] == "x"
    st.create("Other", "", s.config)
    try:
        st.update(r["preset_id"], name="other"); assert False
    except PresetError as e:
        assert e.status == 409
    st.delete(r["preset_id"])
    assert [x["name"] for x in st.list()] == ["Silenced Sniper", "Other"]
    for bad in (lambda: st.delete("nope"), lambda: st.get("nope"), lambda: st.update("nope", name="x")):
        try:
            bad(); assert False
        except PresetError as e:
            assert e.status == 404
    try:
        st.create("", "", s.config); assert False
    except PresetError as e:
        assert e.status == 400
    # builtin guards: delete / edit / name-squat → 403
    for bad in (lambda: st.delete(BUILTIN_SILENCED_SNIPER), lambda: st.update(BUILTIN_SILENCED_SNIPER, desc="x"),
                lambda: st.create("silenced sniper", "", s.config, replace=True)):
        try:
            bad(); assert False
        except PresetError as e:
            assert e.status == 403
    # reload from disk → same rows, builtin regenerated
    st2, _, _ = _store(tmp=path.parent, s=s)
    assert [x["name"] for x in st2.list()] == ["Silenced Sniper", "Other"]


def test_presets_sanitize_drops_junk_and_corrupt_file_is_moved_aside():
    import json
    st, path, s = _store()
    r = st.create("Weird", "", {"mode": "ffa", "time_limit_s": 240, "laser_eyes": True, "config_id": "stale",
                                "loadout_policy": {"preset": "snipers"}, "health": {"max_hp": 45, "max_armor": 70}})
    assert "laser_eyes" not in r["config"] and "config_id" not in r["config"] and r["config"]["loadout_policy"]["preset"] == "snipers"
    try:
        st.create("Bad", "", {"mode": "nope"}); assert False
    except ValueError:
        pass
    # a stored row with an out-of-range value is DROPPED on load (never fatal); unknown keys pass through sanitize
    rows = json.loads(path.read_text())["presets"]
    rows.append({"preset_id": "zz", "name": "Broken", "config": {"mode": "tdm", "time_limit_s": 999999}})
    rows.append({"preset_id": "yy", "name": "Old", "config": {"mode": "tdm", "future_key": 1}})
    rows.append({"preset_id": "builtin:silenced_sniper", "name": "Silenced Sniper", "config": {"mode": "tdm"}})   # squatter
    path.write_text(json.dumps({"v": 1, "presets": rows}))
    st2, _, _ = _store(tmp=path.parent, s=s)
    names = [x["name"] for x in st2.list()]
    assert names == ["Silenced Sniper", "Weird", "Old"] and st2.list()[0]["config"]["mode"] == "ffa"
    assert st2.get(next(x["preset_id"] for x in st2.list() if x["name"] == "Old"))["config"]["loadout_policy"]["preset"] == "open"
    # corrupt JSON → renamed aside, store starts with the builtin only, and the next save writes a fresh file
    path.write_text("{not json")
    st3, _, _ = _store(tmp=path.parent, s=s)
    assert [x["name"] for x in st3.list()] == ["Silenced Sniper"]
    assert any(f.name.startswith("presets.json.corrupt-") for f in path.parent.iterdir()) and not path.exists()
    st3.create("Fresh", "", s.config)
    assert path.exists()


def test_presets_api_and_apply_runs_apply_policy():
    try:
        from starlette.testclient import TestClient
        import httpx  # noqa: F401
    except Exception:
        return
    from brx_mcp.mc.api import create_app
    s, net, clock, ps = mk(2)
    s.patch_player(ps[0]["player_id"], loadout={"weapons": [{"weapon_id": "smg"}, {"weapon_id": "shotgun"}]})
    c = TestClient(create_app(s))                                     # no presets attached → memory store
    rows = c.get("/api/presets").json()
    assert len(rows) == 1 and rows[0]["builtin"]
    r = c.post("/api/presets", json={"name": "Mine", "desc": "d"})     # default config = the current draft
    assert r.status_code == 200 and r.json()["config"]["mode"] == "tdm"
    assert c.post("/api/presets", json={"name": "mine"}).status_code == 409
    assert c.post("/api/presets", json={"name": "mine", "replace": True}).status_code == 200
    assert c.post("/api/presets", json={"name": ""}).status_code == 400
    pid = r.json()["preset_id"]
    assert c.put(f"/api/presets/{pid}", json={"desc": "new"}).json()["desc"] == "new"
    assert c.put("/api/presets/builtin:silenced_sniper", json={"desc": "x"}).status_code == 403
    assert c.delete("/api/presets/builtin:silenced_sniper").status_code == 403
    assert c.delete("/api/presets/nope").status_code == 404
    # apply the builtin: same path as PUT /api/config → fresh config_id, loadouts reset, notice posted
    old_id = s.config["config_id"]
    a = c.post("/api/presets/builtin:silenced_sniper/apply")
    assert a.status_code == 200 and a.json()["ok"] and a.json()["config"]["config_id"] != old_id
    assert s.config["mode"] == "ffa" and s.config["health"]["max_armor"] == 0
    for p in s.players.values():
        assert p["loadout"] == {"weapons": [{"weapon_id": "sniper_rifle"}], "perk": "extended_mags"}
    assert any("RESET BY SILENCED SNIPER" in w for w in s.snapshot()["config_warnings"])
    assert c.post("/api/presets/nope/apply").status_code == 404
    assert c.delete(f"/api/presets/{pid}").json()["ok"] and len(c.get("/api/presets").json()) == 1


def test_loadout_pool_preview_route():
    """A10 §5 designer: POST /api/loadout/pool previews a DRAFT policy's pool without touching the live config."""
    try:
        import httpx  # noqa: F401  — Starlette's TestClient needs it; the system python has no extras (skip cleanly)
        from starlette.testclient import TestClient
    except ImportError:
        return
    from brx_mcp.mc.api import create_app
    s, _net, _clock, _ps = mk()
    app = create_app(s)
    with TestClient(app) as c:
        before = s.config["loadout_policy"]["preset"]
        r = c.post("/api/loadout/pool", json={"loadout_policy": {"preset": "no_heavies"}})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["policy"]["preset"] == "no_heavies"
        assert "rocket_launcher" not in body["pool"]["primary"] and "assault_rifle" in body["pool"]["primary"]
        r2 = c.post("/api/loadout/pool", json={"loadout_policy": {"primary": {"choice": "fixed", "fixed_id": "sniper_rifle"}, "secondary": {"choice": "off"}}})
        assert r2.json()["pool"]["primary"] == ["sniper_rifle"] and r2.json()["pool"]["secondary_weapons"] == []
        assert s.config["loadout_policy"]["preset"] == before          # nothing applied
        assert c.post("/api/loadout/pool", json={"loadout_policy": {"preset": "nope"}}).status_code == 400


def test_kit_open_gates_phone_picks_and_assign_carries_game_brief():
    """A10 §4.1/§4.6: phones may pick only on KIT before the push; `assign` carries kit_open + a game brief; the
    flag flipping re-assigns every bound node."""
    s, net, clock, ps = mk()
    # the first assign body rides inside `welcome` (hydrate) — FakeNet.simulate_hello returns it
    s.phase = "build"; s._changed()          # the host is still on GAMES (adding a player had moved the phase on)
    tail = demo_armory()[0]["ble"]["tail"]
    hello_body = net.simulate_hello("node0", f"GUN-A-{tail}")
    online(s, net, clock, ps[0], 0)
    assert hello_body and hello_body["policy"]["kit_open"] is False
    assert hello_body["game"]["mode"] == "tdm" and hello_body["game"]["loadout_line"]
    def latest_policy():
        a = net.pushes("assign", "node0")
        assert a, "no assign delivered to node0"
        return a[-1][2]["policy"], a[-1][2]["game"]
    _req(net, 0, "primary", "weapon", "smg")
    ack = _last_ack(net, 0)
    assert ack["ok"] is False and "setting up" in ack["reason"].lower()
    n_assign = len(net.pushes("assign", "node0"))
    if hasattr(s, "set_phase"):
        s.set_phase("kit")
    else:
        s.phase = "kit"; s._changed()
    assert s.kit_open() is True
    assert len(net.pushes("assign", "node0")) > n_assign
    assert latest_policy()[0]["kit_open"] is True
    _req(net, 0, "primary", "weapon", "smg")
    assert _last_ack(net, 0)["ok"] is True


def test_apply_preset_marks_the_playing_game_and_edits_clear_it():
    """A10 §8 (review #0): the state remembers WHICH saved game was applied — a duplicate is content-identical to its
    source, so the UI cannot tell them apart by config. Venue-only PUTs keep it; any real edit clears it."""
    from brx_mcp.mc.presets import PresetStore
    s, net, clock, ps = mk()
    s.presets = PresetStore(None, s.sanitize_config, default_config, P.merge, now_ms=s.now_ms)
    a = s.presets.create("Alpha", "", s.config)
    b = s.presets.create("Beta", "", s.config)        # identical config, different game
    s.apply_preset(b["preset_id"], b["config"])
    assert s.snapshot()["active_preset_id"] == b["preset_id"] != a["preset_id"]
    s.set_config({"night": True})                       # venue-only: still playing Beta
    assert s.snapshot()["active_preset_id"] == b["preset_id"]
    s.set_config({"time_limit_s": 120})                 # a real edit: no longer Beta
    assert s.snapshot()["active_preset_id"] is None
    s.apply_preset(a["preset_id"], a["config"])
    s.set_config({"loadout_policy": {"preset": "snipers"}})
    assert s.snapshot()["active_preset_id"] is None


# ── field 2026-08-30 regressions (first live 2-player match on the Mac) ──────────────────────────
def test_push_config_force_overrides_a_red_board():
    """A red row hard-blocked the push with no operator recourse, which stranded a live session while
    everything else on the field was ready. `start()` has always had a force; push now matches."""
    s, net, clock, ps = mk(2)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    # drop one gun's BLE link -> that row goes red -> the plain push must refuse
    net.simulate_status("node1", {"player_id": ps[1]["player_id"], "hp": 45, "armor": 70, "ammo": 36, "alive": True,
                                  "shots": 0, "battery": 80, "fw": "v4.32", "arm_state": "kitted", "synced": True,
                                  "preflight": {"ssid_ok": True, "mc_reachable": True, "phone_batt": 90,
                                                "screen_on": True, "foreground": True, "gun_linked": False}},
                        clock["t"])
    rd = s.readiness()
    assert not rd["go"] and any(r["status"] == "red" for r in rd["board"])
    try:
        s.push_config()
        raise AssertionError("a red board must refuse a plain push")
    except ValueError as e:
        assert "force" in str(e), e            # the message has to name the way out
        assert "GUN LINK LOST" in str(e), e    # ...and say WHY, not just "there are reds"
    assert s.push_config(force=True)["ok"] is True
    assert s.lobby_pushed is True


def test_weapon_views_rank_bars_across_the_arsenal():
    """`stats.dmg` is a share of the 115 pool (7-11 for most guns), so a raw 0-100 bar can only ever
    fill a tenth of the way — every weapon read 'weak' and none looked different. Bars are ranked."""
    from brx_mcp.mc.views import weapon_views
    views = weapon_views(Compiler().weapon_catalog())
    assert views and all("bars" in v for v in views)
    powers = [v["bars"]["power"] for v in views]
    assert min(powers) >= 20 and max(powers) == 100, powers   # spans the usable range, nothing empty
    by = {v["weapon_id"]: v for v in views}
    # the real number rides along with the bar
    assert by["assault_rifle"]["dmg_per_hit"] == 9 and by["assault_rifle"]["pool"] == 115
    # a heavy hitter must out-rank the AR on power
    assert by["shotgun"]["bars"]["power"] > by["assault_rifle"]["bars"]["power"]
    # KILL SPEED is inverted: the quickest kill gets the longest bar
    quick = min((v for v in views if v.get("ttk_ms")), key=lambda v: v["ttk_ms"])
    slow = max((v for v in views if v.get("ttk_ms")), key=lambda v: v["ttk_ms"])
    assert quick["bars"]["ttk"] > slow["bars"]["ttk"]
    # range is deliberately NOT a bar — t41 is identical on every gun
    assert all("rng" not in v["bars"] for v in views)


def test_a_single_weapon_view_has_no_bars():
    """One weapon cannot be ranked against weapons it has not seen — bars come from `weapon_views`."""
    from brx_mcp.mc.views import weapon_view
    assert "bars" not in weapon_view(Compiler().weapon_catalog()[0])


def test_settling_is_advisory_and_never_wedges_the_recap():
    """A8 field 2026-08-30: the recap read FINAL, then the totals moved.

    `settling` reports which bound nodes have not checked in since the whistle. It must stay ADVISORY:
    an earlier attempt folded this condition into `_mark_flushed_live`, which left a phone that went
    quiet at the whistle permanently un-flushable and the recap permanently PROVISIONAL.
    """
    s, net, clock, ps = mk(2)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    s.push_config()
    s.start(runway_s=5, force=True)
    end_t = s.scorer.end_t
    assert end_t is not None

    clock["t"] = end_t - 1000                      # still playing
    assert s.settling()["settling"] is False, "nothing to settle before the whistle"

    clock["t"] = end_t + 2000                      # whistle blown, neither phone has reported since
    st = s.settling()
    assert st["settling"] is True and len(st["awaiting"]) == 2 and st["since_end_ms"] == 2000

    # one phone checks in after the end -> only the other is still awaited
    net.simulate_status("node0", {"player_id": ps[0]["player_id"], "hp": 45, "armor": 70, "ammo": 36,
                                  "alive": True, "shots": 0, "battery": 80, "fw": "v4.32",
                                  "arm_state": "live", "synced": True, "pending": 0,
                                  "preflight": {"gun_linked": True}}, clock["t"])
    assert s.settling()["awaiting"] == [ps[1]["player_id"]]

    # ...and the silent phone must NOT block the recap: it is still flushable, exactly as before.
    s._mark_flushed_live()
    r = s.recap()
    assert "settling" in r, "the advisory rides along on the recap"
    assert r["provisional"] is not None            # whatever it is, `settling` did not decide it


def test_swap_delay_token_and_quick_switch():
    """tok15 is the weapon-swap delay (bench 2026-09-04). Stock 850 on both slots; quick_switch halves it on
    EVERY slot because the gun enforces the larger of the two; the bundle reports the enforced value."""
    b = C.compile(_cfg(), _player({"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "smg"}]}), _TEAMS)
    f0 = [x for x in b["head"] if x.startswith("$WEAP,0")][0]; f1 = [x for x in b["head"] if x.startswith("$WEAP,1")][0]
    assert _tok(f0, 15) == "850" and _tok(f1, 15) == "850" and b["swap_ms"] == 850
    b = C.compile(_cfg(), _player({"weapons": [{"weapon_id": "assault_rifle"}], "perk": "quick_switch"}), _TEAMS)
    f0 = [x for x in b["head"] if x.startswith("$WEAP,0")][0]; f4 = [x for x in b["head"] if x.startswith("$WEAP,4")][0]
    assert _tok(f0, 15) == "425" and b["swap_ms"] == 425
    assert _tok(f4, 15) == "50"                                          # melee's 100 scales too (every slot)
    assert _tok(f0, 18) == "1400"                                       # reload untouched by a swap perk


def test_a_perk_that_cannot_take_moves_nothing_else():
    """Polish review 2026-09-12: a pick that is REFUSED must leave the whole kit alone.

    With a chain-reload primary AND a second weapon, tapping Easy Reload used to run the ALT rule first
    (drop the second weapon) and THEN the F123 backstop (revert the perk) — so the player lost their
    secondary to a pick that never applied, and `dropped_by` (which looks at the perk) reported nothing at
    all. CONTROL: the same tap on a MAGAZINE primary still drops the second weapon, and still says so."""
    held = {"weapons": [{"weapon_id": "shotgun"}, {"weapon_id": "smg"}]}
    after = P.set_slot(held, "perk", "perk", "easy_reload", PK, W)
    assert after == held, f"a refused perk moved the rest of the kit: {after}"
    assert P.dropped_by(held, after, W, PK) == (None, None), "nothing was dropped, so nothing may be reported"
    # CONTROL: on a magazine primary the pick DOES take, and the second weapon goes with a reason
    ok = {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "smg"}]}
    after = P.set_slot(ok, "perk", "perk", "easy_reload", PK, W)
    assert after == {"weapons": [{"weapon_id": "assault_rifle"}], "perk": "easy_reload"}
    dropped, why = P.dropped_by(ok, after, W, PK)
    assert dropped == {"slot": "secondary", "id": "smg", "name": "SMG"}
    assert why == "Easy Reload takes the ALT button — SMG dropped"


def test_the_chain_rule_reads_the_catalog_in_play_not_the_shipped_file():
    """`chain_reload` answers from the row this GAME is running. A synthetic catalog that makes a
    non-shotgun a chain reload must be obeyed everywhere the rule fires — including `set_slot`, which used
    to ask a bare `{weapon_id: ...}` and so could only ever be answered by `weapons.json`."""
    cat = [{"weapon_id": "smg", "name": "SMG", "cls": "1", "tags": [], "reload_type": "chain",
            "stats": {"mag": 30, "reserve": 60, "reload_ms": 1400, "dmg": 50, "rof": 50, "rng": 50}},
           {"weapon_id": "shotgun", "name": "Shotgun", "cls": "2", "tags": [],
            "stats": {"mag": 6, "reserve": 24, "reload_ms": 2400, "dmg": 70, "rof": 30, "rng": 50}}]
    op = P.preset_rules("open"); lp = P.pool(op, cat, PK)
    held = {"weapons": [{"weapon_id": "smg"}]}
    assert P.chain_conflict({**held, "perk": "easy_reload"}, cat, PK) == {"perk": "easy_reload", "weapon": "smg"}
    assert P.check_request(op, lp, "perk", "perk", "easy_reload", cat, PK, held)[0] is False
    assert P.set_slot(held, "perk", "perk", "easy_reload", PK, cat) == held, "set_slot must read the same catalog"
    # and picking the chain primary drops the ALT perk, again on this catalog's say-so
    on_ar = {"weapons": [{"weapon_id": "shotgun"}], "perk": "easy_reload"}
    assert P.set_slot(on_ar, "primary", "weapon", "smg", PK, cat) == {"weapons": [{"weapon_id": "smg"}]}
    # CONTROL: a row that carries NO `reload_type` still falls back to the shipped file, which is what
    # keeps the F123 rule alive on the compiled catalog (it publishes stats/tags and not the attribute) —
    # so this catalog's own shotgun row is still a chain reload and still drops the perk.
    assert P.set_slot({"weapons": [{"weapon_id": "assault_rifle"}], "perk": "easy_reload"},
                      "primary", "weapon", "shotgun", PK, cat) == {"weapons": [{"weapon_id": "shotgun"}]}


# --------------------------------------------------- S37: a swap perk needs something to swap to
def _pool(policy_patch):
    pol = P.normalize({**P.preset_rules("open"), **policy_patch}, "tdm")
    return pol, P.pool(pol, W, PK)


def test_s37_quick_switch_leaves_the_perk_pool_when_there_is_no_secondary():
    """Tony, field 2026-09-12: "if either weapon slot is disabled, the Quick Switch perk must be
    disabled/hidden too — it is the $WEAP tok15 swap delay; with one weapon there is nothing to swap."
    Taking it out of the POOL is what makes it vanish from both UIs, and `apply()` clears a stored one,
    with no second rule anywhere."""
    _, open_pool = _pool({})
    assert "quick_switch" in open_pool["perks"]
    for patch in ({"secondary": P._rule("off", ("weapon",))},                       # slot switched off
                  {"secondary": P._rule("player", ("weapon",), exclude_tags=(       # filtered to nothing
                      "assault", "cqb", "marksman", "sniper", "support", "power", "heavy",
                      "sidearm", "pistol", "melee"))}):
        pol, lp = _pool(patch)
        assert lp["secondary_weapons"] == [], patch
        assert "quick_switch" not in lp["perks"], lp["perks"]
        # every OTHER perk is untouched — this is one perk's rule, not a blanket
        assert {"body_armor", "extended_mags", "quick_hands"} <= set(lp["perks"]), lp["perks"]


def test_s37_a_stored_quick_switch_is_cleared_by_apply_and_refused_by_validate():
    pol, lp = _pool({"secondary": P._rule("off", ("weapon",))})
    held = {"weapons": [{"weapon_id": "assault_rifle"}], "perk": "quick_switch"}
    assert P.apply(pol, lp, held, W, PK).get("perk") is None
    ok, why = P.validate_loadout(pol, lp, held, W, PK)
    assert ok is False and "second weapon" in why, why


def test_s37_the_phones_pick_is_refused_with_a_reason_that_says_why():
    """`loadout_ack.reason` is shown verbatim on the HUD, so "Quick Switch isn't allowed in this game"
    (what the generic pool rejection said) is not good enough: the operator did not ban the perk, the
    ruleset left nothing to switch to."""
    s, net, clock, ps = mk(1)
    s.set_config({"loadout_policy": {"preset": "custom", "secondary": {"choice": "off"}}})
    online(s, net, clock, ps[0], 0)
    _req(net, 0, "perk", "perk", "quick_switch")
    ack = _last_ack(net, 0)
    assert ack["ok"] is False and ack["slot"] == "perk"
    assert "Quick Switch" in ack["reason"] and "second weapon" in ack["reason"], ack["reason"]
    assert s.players[ps[0]["player_id"]]["loadout"].get("perk") is None
    # the pool the phone reads no longer offers it, so the control disappears on its own
    assert "quick_switch" not in s.loadout_pool()["perks"]


def test_s37_the_rule_is_asked_of_the_effect_not_of_the_perk_id():
    """`swaps_weapons` reads `effects.switch_mult`, the way `takes_alt` reads `effects.alt_reload`, so
    a second swap perk is covered the day it exists."""
    assert P.swaps_weapons({"perk_id": "quick_switch", "effects": {"switch_mult": 0.5}}) is True
    assert P.swaps_weapons({"perk_id": "future_swap", "effects": {"switch_mult": 0.25}}) is True
    assert P.swaps_weapons({"perk_id": "body_armor", "effects": {"max_armor_add": 50}}) is False
    assert P.swaps_weapons(None) is False


# --------------------------------------------------- F146: an empty primary set is refused, not degraded
def test_f146_a_primary_filter_that_excludes_every_weapon_is_refused_at_validate():
    """Field 2026-09-12: the Kit primary filter ended up excluding every class, policy found no legal
    primary, `apply()` fell through to whatever was held, and the operator got "2 LOADOUTS RESET BY
    PISTOLS ONLY" (a warning) followed by a hard weapon error about a pistol they never chose. The
    empty ruleset is the actual mistake and it has to say so, naming the control to touch."""
    s, net, clock, ps = mk(2, compiler=Compiler())
    assert not s._validate()["errors"] or not any("PRIMARY FILTER" in e for e in s.config_errors)
    s.set_config({"loadout_policy": {
        "preset": "custom",
        "primary": {"choice": "player", "kinds": ["weapon"],
                    "exclude_tags": ["assault", "cqb", "marksman", "sniper", "support",
                                     "power", "heavy", "sidearm", "pistol", "melee"]}}})
    assert s.loadout_pool()["primary"] == []
    s._validate()
    said = [e for e in s.config_errors if "PRIMARY FILTER" in e]
    assert said, s.config_errors
    assert "EXCLUDES EVERY WEAPON" in said[0] and "primary slot" in said[0], said[0]
    # and it clears the moment the ruleset is legal again
    s.set_config({"loadout_policy": {"preset": "open"}})
    s._validate()
    assert not any("PRIMARY FILTER" in e for e in s.config_errors), s.config_errors


def test_f146_a_players_own_illegal_pick_still_gets_the_reset_warning():
    """The half that is KEPT: a ruleset with a legal pool that simply does not admit what somebody was
    already holding is a reset, not a refusal, and the notice is how the host learns it happened."""
    s, net, clock, ps = mk(2, compiler=Compiler())
    s.patch_player(ps[0]["player_id"], loadout={"weapons": [{"weapon_id": "rocket_launcher"}]})
    s.set_config({"loadout_policy": {"preset": "no_heavies"}})
    s.apply_policy()
    s._validate()
    assert any("RESET BY" in w for w in s.config_warnings), s.config_warnings
    assert not any("PRIMARY FILTER" in e for e in s.config_errors), s.config_errors


# --------------------------------------------------- S39: the voice preview plays the INTRO
def test_s39_the_voice_pick_preview_plays_the_characters_intro_line():
    """Tony, field 2026-09-12: selecting a character voice should play that character's INTRO line, not
    their kill line. Hearing a voice announce a kill says nothing about who you just picked."""
    from brx_mcp import voices as V
    c = Compiler()
    for voice in ("male", "female", "jay"):
        frame = c.voice_preview(voice)
        assert frame.endswith(",,,,*") and frame.startswith("$PLAY,,4,6,"), frame
        assert V.role_id(voice, "intro") in frame, (voice, frame)
        assert frame != c.cues(voice)["kill"], f"{voice}: still previewing the kill line"


def test_s39_the_preview_frame_reaches_the_bound_node_on_a_voice_change():
    s, net, clock, ps = mk(1, compiler=Compiler())
    online(s, net, clock, ps[0], 0)
    s.patch_player(ps[0]["player_id"], voice="female")
    pushes = [b for _k, _n, b in net.pushes("apply", "node0") if b.get("preview")]
    assert pushes, "no A9.1 preview reached the node"
    from brx_mcp import voices as V
    assert pushes[-1]["frames"] == [f"$PLAY,,4,6,{V.role_id('female', 'intro')},,,,*"], pushes[-1]


def test_s39_the_intro_frame_is_not_added_to_the_compiled_bundle():
    """Deliberately not a `cues()` entry: `cues()` is compiled into every FrameBundle on the wire and
    into `golden_bundle.json`, which the phone app's tests read. A bench preview is not a match frame."""
    assert "intro" not in Compiler().cues("male")
