"""Characterisation tests for brx_mcp/modes/extraction_adapter.py's own internals.

`test_extraction_adapter.py` already covers the driver-level scenarios (loot ->
zone -> extract -> win, kill drops loot, host respawn, a stray repeat-$HP,0, an
unregistered id, leave-zone reset). This file instead pins the pieces THAT file
doesn't touch:

  * `_to_base()` / `_translate()` — every `extraction.Action` variant's exact
    translation into the base `GameEngine` Action vocabulary (base.py).
  * kill attribution — the last-`$HIR`-within-`ATTRIB_FUSE_S` rule, self-kill
    and unmapped-team guards, and that a grenade-sourced `$HIR` (token2==15,
    see base.shooter_team) never counts as an attributable shot.
  * FFA team -> player resolution for a roster bigger than two.
  * `_ex_config()`'s translation of a driver GameConfig into ExtractionConfig,
    including its `win_target or score_target` fallback.
  * event-token parsing edge cases (`_int`, and ZONE/LOOT/PICKUP with missing
    or malformed tokens).
  * the over-property / post-game-over inertness, and the respawn bookkeeping
    (no duplicate Respawn actions once a player is back up).
"""

import dataclasses

from brx_mcp.gameconfig import GameConfig
from brx_mcp.modes import base
from brx_mcp.modes import extraction as ex
from brx_mcp.modes.extraction_adapter import ATTRIB_FUSE_S, ExtractionEngineAdapter, _int, _to_base, _translate
from brx_mcp import sounds as snd


def _cfg(**kw):
    return GameConfig(mode="extraction", **kw)


def hir(team, grenade=False):
    tok2 = "15" if grenade else "0"
    return {"command": "HIR", "tokens": ["HIR", "0", tok2, "0", str(team), "9", "0", "3"]}


def death():
    return {"command": "HP", "tokens": ["HP", "0", "0", "0"]}


def zone(*parts):
    return {"command": "ZONE", "tokens": ["ZONE", *parts]}


def loot(*parts):
    return {"command": "LOOT", "tokens": ["LOOT", *parts]}


def pickup(*parts):
    return {"command": "PICKUP", "tokens": ["PICKUP", *parts]}


def leave():
    return {"command": "LEAVE", "tokens": ["LEAVE"]}


# --------------------------------------------------------------------------- #
# _to_base / _translate — one full translation per extraction.Action variant  #
# --------------------------------------------------------------------------- #
def test_bank_translates_to_a_score_update():
    assert _to_base(ex.Bank("red", 30, 130)) == [base.Score("red", 30, 130)]


def test_channel_started_translates_to_the_two_part_loud_alarm():
    # the player hears their own "channel called" line on their own node,
    # AND everyone hears the field-wide alert — that's the genre's whole point.
    got = _to_base(ex.ChannelStarted("red", "Alpha"))
    assert got == [
        base.PlaySound(snd.EXTRACTION_CALLED, scope="red", slot="voice"),
        base.PlaySound(snd.EXTRACTION_ALERT, scope="all", slot="voice"),
    ]


def test_channel_reset_translates_to_a_player_scoped_callout_naming_the_reason():
    got = _to_base(ex.ChannelReset("red", "Alpha", "left_zone"))
    assert got == [base.Callout("channel reset for red at Alpha (left_zone)", scope="red")]


def test_extracted_translates_to_a_field_wide_extracted_sound():
    assert _to_base(ex.Extracted("red", 100, "Alpha")) == [
        base.PlaySound(snd.EXTRACTED, scope="all", slot="voice")
    ]


def test_loot_dropped_translates_to_a_field_wide_callout_naming_value_and_destination():
    a = ex.LootDropped(drop_id=1, value=40, from_player="red", by="killer", killer="blue")
    assert _to_base(a) == [base.Callout("loot dropped from red (40, → killer)", scope="all")]


def test_game_over_translates_and_carries_the_banked_total_in_detail():
    assert _to_base(ex.GameOver("red", 250)) == [base.GameOver("red", detail="banked=250")]


def test_callout_passes_through_text_and_scope_unchanged():
    assert _to_base(ex.Callout("custom line", scope="blue")) == [base.Callout("custom line", scope="blue")]
    assert _to_base(ex.Callout("field line")) == [base.Callout("field line", scope="all")]  # default scope


def test_send_frame_passes_through_unchanged():
    a = ex.SendFrame("red", "$LIFE,0,0,50,*")
    assert _to_base(a) == [base.SendFrame("red", "$LIFE,0,0,50,*")]


def test_unrecognised_action_type_translates_to_nothing():
    @dataclasses.dataclass
    class _Mystery(ex.Action):
        pass

    assert _to_base(_Mystery()) == []


def test_translate_flattens_and_preserves_order_across_mixed_actions():
    actions = [ex.Bank("red", 10, 10), ex.ChannelStarted("blue", "Bravo"), ex.Callout("hi")]
    out = _translate(actions)
    assert out == [
        base.Score("red", 10, 10),
        base.PlaySound(snd.EXTRACTION_CALLED, scope="blue", slot="voice"),
        base.PlaySound(snd.EXTRACTION_ALERT, scope="all", slot="voice"),
        base.Callout("hi", scope="all"),
    ]


# --------------------------------------------------------------------------- #
# kill attribution: last-$HIR-within-the-fuse, FFA team -> player             #
# --------------------------------------------------------------------------- #
def test_kill_credited_when_the_shot_lands_just_inside_the_fuse():
    e = ExtractionEngineAdapter(_cfg(loot_per_kill=10, drop_policy="killer"))
    e.add_player("red", 1); e.add_player("blue", 2)
    e.on_event("blue", loot(*["20"]), now=0.0)
    e.on_event("blue", hir(1), now=0.0)
    e.on_event("blue", death(), now=ATTRIB_FUSE_S - 0.1)
    game = e._ensure()
    assert game.carried("red") == 30            # 10 kill-loot + 20 loot-policy-killer


def test_kill_not_credited_when_the_shot_is_outside_the_fuse():
    e = ExtractionEngineAdapter(_cfg(loot_per_kill=10, drop_policy="killer"))
    e.add_player("red", 1); e.add_player("blue", 2)
    e.on_event("blue", loot("20"), now=0.0)
    e.on_event("blue", hir(1), now=0.0)
    e.on_event("blue", death(), now=ATTRIB_FUSE_S + 0.1)
    game = e._ensure()
    assert game.carried("red") == 0              # too late — no credit, no loot transfer
    # no killer resolved -> drop_policy="killer" falls through to a grabbable ground token
    assert list(game.dropped.values())[0].by == "ground"


def test_self_attribution_is_not_possible_even_if_the_wire_implied_it():
    # forge the pathological case where the victim's own team is the "shooter"
    # team on record — _resolve_killer must refuse to credit the victim itself.
    e = ExtractionEngineAdapter(_cfg(loot_per_kill=10))
    e.add_player("red", 1)
    e.on_event("red", hir(1), now=0.0)            # red's own team recorded as shooter
    e.on_event("red", death(), now=0.5)
    game = e._ensure()
    assert game.status("red") is ex.Status.DOWN
    assert game.carried("red") == 0               # no self-kill-loot granted


def test_unmapped_shooter_team_grants_no_kill_credit():
    e = ExtractionEngineAdapter(_cfg(loot_per_kill=10))
    e.add_player("red", 1); e.add_player("blue", 2)
    e.on_event("blue", hir(99), now=0.0)          # team 99 has no registered player
    e.on_event("blue", death(), now=0.5)
    game = e._ensure()
    assert game.carried("red") == 0


def test_grenade_sourced_hir_is_never_treated_as_an_attributable_shot():
    e = ExtractionEngineAdapter(_cfg(loot_per_kill=10))
    e.add_player("red", 1); e.add_player("blue", 2)
    e.on_event("blue", hir(1, grenade=True), now=0.0)   # token2==15 -> grenade beacon
    e.on_event("blue", death(), now=0.5)
    game = e._ensure()
    assert game.carried("red") == 0               # the grenade beacon must not attribute to red


def test_ffa_three_player_roster_resolves_each_teams_sole_owner():
    e = ExtractionEngineAdapter(_cfg(loot_per_kill=5))
    e.add_player("red", 1); e.add_player("blue", 2); e.add_player("green", 3)
    e.on_event("green", hir(3), now=0.0)          # green's own team — not a real kill path
    e.on_event("blue", hir(3), now=0.0)           # green shoots blue
    e.on_event("blue", death(), now=0.5)
    game = e._ensure()
    assert game.carried("green") == 5             # credited to green, not red
    assert game.carried("red") == 0


def test_KNOWN_BUG_two_guns_sharing_a_team_misattribute_kill_loot():
    """PINS a known bug — NOT the intended behaviour. Do not "fix" this test by
    updating the assertion; fix the adapter instead (clone-review followup,
    2026-09-07) and then flip this test to assert the CORRECT killer.

    Unlike DeathmatchEngine (resolves the SPECIFIC shooter gun via `$HIR` token
    3 + `roster.by_wire_id`, Q17), `ExtractionEngineAdapter` has no per-gun map:
    `add_player` does `self._team_player[team] = player_id`, which is
    last-write-wins. Once two guns share a team, `_resolve_killer` therefore
    always credits whichever gun was registered LAST for that team — not
    whichever gun actually fired the shot on record. This is a WORSE failure
    mode than the old TDM bug: TDM credited nobody (a visible absence); this
    silently misattributes kill-loot to a teammate who may not have fired at
    all.

    Currently unreachable via the normal `assign_teams()` path (driver.py
    always gives extraction guns unique teams there) — it only bites a caller
    that passes explicit `config.teams` putting two extraction guns on one
    team. Not fixed here: `ExtractionEngineAdapter` doesn't use `Roster`, so
    the fix isn't a natural consequence of the ScoredEngine refactor, and a
    silent scoring change is the user's call, not ours."""
    e = ExtractionEngineAdapter(_cfg(loot_per_kill=10))
    e.add_player("red", 1)      # registered FIRST on team 1
    e.add_player("amber", 1)    # registered SECOND on team 1 -> overwrites _team_player[1]
    e.add_player("blue", 2)
    e.on_event("blue", hir(1), now=0.0)      # a team-1 gun shot blue — could be either
    e.on_event("blue", death(), now=0.5)
    game = e._ensure()
    # BUG: always "amber" (last-registered), regardless of which gun actually fired.
    assert game.carried("amber") == 10
    assert game.carried("red") == 0


# --------------------------------------------------------------------------- #
# _ex_config(): GameConfig -> ExtractionConfig translation                    #
# --------------------------------------------------------------------------- #
def test_ex_config_pulls_the_extraction_specific_fields_off_a_real_gameconfig():
    e = ExtractionEngineAdapter(_cfg(channel_s=20.0, win_target=75, loot_per_kill=3,
                                     drop_policy="pool", extract_removes_player=False))
    cfg = e._ex_config()
    assert (cfg.channel_s, cfg.win_target, cfg.loot_per_kill,
            cfg.drop_policy, cfg.extract_removes_player) == (20.0, 75, 3, "pool", False)


def test_ex_config_win_target_falls_back_to_score_target_when_unset():
    class _Cfg:
        win_target = 0
        score_target = 40

    cfg = ExtractionEngineAdapter(_Cfg())._ex_config()
    assert cfg.win_target == 40


def test_ex_config_defaults_apply_when_the_driver_config_lacks_extraction_fields():
    class _BareConfig:
        mode = "extraction"

    cfg = ExtractionEngineAdapter(_BareConfig())._ex_config()
    assert cfg.channel_s == 45.0
    assert cfg.win_target == 0
    assert cfg.loot_per_kill == 10
    assert cfg.drop_policy == "ground"
    assert cfg.extract_removes_player is True


# --------------------------------------------------------------------------- #
# event-token parsing edge cases                                             #
# --------------------------------------------------------------------------- #
def test_int_helper_parses_a_valid_token():
    assert _int({"tokens": ["LOOT", "30"]}, 1, 0) == 30


def test_int_helper_falls_back_to_default_when_token_is_missing():
    assert _int({"tokens": ["LOOT"]}, 1, 0) == 0
    assert _int({}, 1, 5) == 5


def test_int_helper_falls_back_to_default_on_a_non_numeric_token():
    assert _int({"tokens": ["LOOT", "abc"]}, 1, 0) == 0


def test_int_helper_falls_back_to_default_on_a_none_token():
    assert _int({"tokens": ["LOOT", None]}, 1, 7) == 7


def test_zone_event_with_no_zone_token_defaults_to_a_placeholder_name():
    e = ExtractionEngineAdapter(_cfg(channel_s=5.0))
    e.add_player("red", 1)
    acts = e.on_event("red", zone(), now=0.0)          # tokens=["ZONE"] -- no zone name
    started = next(a for a in acts if isinstance(a, base.PlaySound) and a.scope == "red")
    assert started.sound_id == snd.EXTRACTION_CALLED
    assert e._ensure().players["red"].zone == "?"


def test_loot_event_with_missing_value_token_adds_zero():
    e = ExtractionEngineAdapter(_cfg())
    e.add_player("red", 1)
    e.on_event("red", {"command": "LOOT", "tokens": ["LOOT"]}, now=0.0)
    assert e._ensure().carried("red") == 0


def test_pickup_event_with_missing_drop_id_is_a_safe_no_op():
    e = ExtractionEngineAdapter(_cfg())
    e.add_player("red", 1)
    acts = e.on_event("red", {"command": "PICKUP", "tokens": ["PICKUP"]}, now=0.0)
    assert acts == []
    assert e._ensure().carried("red") == 0


def test_leave_command_translates_through_to_a_channel_reset_callout():
    e = ExtractionEngineAdapter(_cfg(channel_s=10.0))
    e.add_player("red", 1)
    e.on_event("red", zone("Alpha"), now=0.0)
    acts = e.on_event("red", leave(), now=1.0)
    assert any(isinstance(a, base.Callout) and "left_zone" in a.text for a in acts)


# --------------------------------------------------------------------------- #
# over-property / post-game inertness / respawn bookkeeping                  #
# --------------------------------------------------------------------------- #
def test_over_is_false_before_any_game_has_been_built():
    e = ExtractionEngineAdapter(_cfg())
    e.add_player("red", 1)
    assert e.over is False                    # no on_event/tick yet -> _game is still None


def test_events_and_ticks_are_inert_once_the_game_is_over():
    e = ExtractionEngineAdapter(_cfg(channel_s=5.0, win_target=10, extract_removes_player=False))
    e.add_player("red", 1)
    e.on_event("red", loot("10"), now=0.0)
    e.on_event("red", zone("Alpha"), now=0.0)
    won = e.tick(now=5.0)
    assert any(isinstance(a, base.GameOver) for a in won)
    assert e.over is True
    # now nothing should do anything at all
    assert e.on_event("red", loot("999"), now=6.0) == []
    assert e.tick(now=100.0) == []
    assert e._ensure().carried("red") == 0


def test_respawn_emits_exactly_one_respawn_action_not_one_per_tick():
    e = ExtractionEngineAdapter(_cfg(respawn_s=5))
    e.add_player("red", 1); e.add_player("blue", 2)
    e.on_event("blue", hir(1), now=0.0)
    e.on_event("blue", death(), now=0.0)
    first = e.tick(now=5.0)
    assert any(isinstance(a, base.Respawn) for a in first)
    later = e.tick(now=10.0)
    assert not any(isinstance(a, base.Respawn) for a in later)   # not re-fired every tick


def test_snapshot_reports_mode_totals_and_per_player_state():
    e = ExtractionEngineAdapter(_cfg(win_target=50))
    e.add_player("red", 1); e.add_player("blue", 2)
    e.on_event("red", loot("15"), now=0.0)
    snap = e.snapshot()
    assert snap["mode"] == "extraction"
    assert snap["over"] is False
    assert snap["winner"] is None
    assert snap["win_target"] == 50
    assert snap["players"]["red"] == {"banked": 0, "carried": 15, "status": "alive"}
    assert snap["players"]["blue"] == {"banked": 0, "carried": 0, "status": "alive"}
