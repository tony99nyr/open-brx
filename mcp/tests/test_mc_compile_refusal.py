"""F551 (field 2026-10-17): a push-blocking compile error left no trace in mc.log, and the kit offered a perk the
compiler then refused.

Armor Piercing refused the push twice in the field, and `mc.log` held neither the guard's text nor a traceback, so
the trigger could not be read back. The perk is priced only on a few primaries (`ap_dmg`); with any other primary the
compiler refuses the whole push. So MC now (1) logs every compile refusal with its traceback and tells the operator in
the feed, (2) drops an ineligible perk when the loadout is set (Tony's rule: fix the pick, do not warn), and (3) says
in each `PerkView` which primaries (and secondaries) the perk cannot ride with, so the kit pickers can hide it.
"""
import logging

from _session import mk_loadout_session

from brx_mcp.mc.compile import Compiler


def _real(n=2):
    s, net, clock, ps = mk_loadout_session(n, compiler=Compiler())[:4]
    return s, net, clock, ps


def test_armor_piercing_with_a_primary_it_cannot_ride_is_dropped_when_the_loadout_is_set():
    s, net, clock, ps = _real()
    pid = ps[0]["player_id"]
    p = s.patch_player(pid, loadout={"weapons": [{"weapon_id": "burst_rifle"}], "perk": "armor_piercing"})
    assert "perk" not in p["loadout"], p["loadout"]
    # control: a primary Armor Piercing is priced on keeps it
    p = s.patch_player(pid, loadout={"weapons": [{"weapon_id": "assault_rifle"}], "perk": "armor_piercing"})
    assert p["loadout"].get("perk") == "armor_piercing", p["loadout"]


def test_each_perk_view_names_the_weapons_it_cannot_ride_with():
    perks = {r["perk_id"]: r for r in Compiler().perk_catalog()}
    ap = perks["armor_piercing"]
    assert "burst_rifle" in ap["blocked_primary"] and "assault_rifle" not in ap["blocked_primary"], ap
    assert ap["blocked_secondary"] == [], ap
    plain = next(r for r in perks.values() if not r["effects"].get("armor_piercing") and not r["effects"].get("crit_pct_add"))
    assert plain["blocked_primary"] == [] and plain["blocked_secondary"] == [], plain


def test_a_compile_refusal_on_push_is_logged_with_its_traceback_and_reaches_the_operator():
    s, net, clock, ps = _real()
    pid = ps[0]["player_id"]
    # past `_check_loadout`, as a restored session or a direct edit would be
    s.players[pid]["loadout"] = {"weapons": [{"weapon_id": "burst_rifle"}], "perk": "armor_piercing"}
    seen: list[logging.LogRecord] = []

    class H(logging.Handler):
        def emit(self, record):
            seen.append(record)
    h = H(level=logging.ERROR)
    logging.getLogger("brx.mc").addHandler(h)
    try:
        try:
            s.push_config(force=True)
            raise AssertionError("the push compiled an ineligible Armor Piercing primary")
        except ValueError as e:
            assert "ARMOUR-PIERCING GUARD" in str(e), e
    finally:
        logging.getLogger("brx.mc").removeHandler(h)
    rec = [r for r in seen if "ARMOUR-PIERCING GUARD" in r.getMessage()]
    assert rec and rec[0].exc_info is not None, [r.getMessage() for r in seen]
    assert any("COULD NOT COMPILE" in (f.get("text") or "") for f in s.feed), [f.get("text") for f in s.feed[:5]]
