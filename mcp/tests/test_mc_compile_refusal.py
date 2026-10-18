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
    n = sum("COULD NOT COMPILE" in (f.get("text") or "") for f in s.feed)
    try:
        s.push_config(force=True)
    except ValueError:
        pass
    assert sum("COULD NOT COMPILE" in (f.get("text") or "") for f in s.feed) == n, "the same refusal is told once"


def test_a_phone_pick_of_a_perk_its_weapons_cannot_carry_is_acked_as_dropped():
    """Codex review: the phone's `loadout_ack` must say the perk was dropped, or the HUD shows a perk the player lacks."""
    from _session import online
    s, net, clock, ps = _real()
    online(s, net, clock, ps[0], 0)
    pid = ps[0]["player_id"]
    s.patch_player(pid, loadout={"weapons": [{"weapon_id": "burst_rifle"}]})
    s._on_loadout_request("node0", pid, {"slot": "perk", "kind": "perk", "id": "armor_piercing"})
    acks = [b for n, k, b in net.pushed if k == "loadout_ack" and n == "node0"]
    assert acks and acks[-1]["ok"] and acks[-1].get("dropped", {}).get("id") == "armor_piercing", acks[-1:]
    assert "does not work with the Burst Rifle" in (acks[-1].get("reason") or ""), acks[-1]
    assert "perk" not in s.players[pid]["loadout"]


def test_a_ruleset_that_fixes_armor_piercing_keeps_primaries_it_cannot_ride_out_of_the_pool():
    """Codex review (High): a FIXED perk used to be forced back onto a Burst Rifle and refused at push."""
    s, net, clock, ps = _real()
    pol = s.policy()
    pol["perk"] = {**pol["perk"], "choice": "fixed", "fixed_id": "armor_piercing"}
    s.set_config({"loadout_policy": pol})
    lp = s.loadout_pool()
    assert "burst_rifle" not in lp["primary"] and "assault_rifle" in lp["primary"], lp["primary"]
    for p in s.players.values():
        assert p["loadout"]["weapons"][0]["weapon_id"] in lp["primary"], p["loadout"]
    s.push_config(force=True)            # nothing on the roster can refuse


def test_a_host_fixing_the_primary_to_a_weapon_the_perk_cannot_ride_drops_the_perk():
    """Codex via brx4: `policy.apply` re-fits every player's kit when the ruleset changes. Fixing the primary to the
    sniper rifle kept an equipped Armor Piercing perk, which the push then refused."""
    s, net, clock, ps = _real()
    pid = ps[0]["player_id"]
    s.patch_player(pid, loadout={"weapons": [{"weapon_id": "assault_rifle"}], "perk": "armor_piercing"})
    assert s.players[pid]["loadout"].get("perk") == "armor_piercing", "setup"
    pol = s.policy()
    pol["primary"] = {**pol["primary"], "choice": "fixed", "fixed_id": "sniper_rifle"}
    s.set_config({"loadout_policy": pol})
    lo = s.players[pid]["loadout"]
    assert lo["weapons"][0]["weapon_id"] == "sniper_rifle" and "perk" not in lo, lo
    s.push_config(force=True)            # nothing on the roster can refuse
