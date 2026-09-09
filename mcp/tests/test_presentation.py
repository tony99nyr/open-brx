"""A11: the presentation profile -- sounds + lights per event, preset or custom, compiled into the bundle."""
import copy
from contextlib import contextmanager

from brx_mcp import poolgauge as pg
from brx_mcp import sounds as snd
from brx_mcp.mc import presentation as P
from brx_mcp.mc.compile import golden_bundle
from brx_mcp.mc import compile as C
from brx_mcp.mc.state import default_config


@contextmanager
def raises(exc):
    """A stand-in for the pytest helper of the same name: `python3 run_tests.py` runs under SYSTEM
    python, which has no pytest, so this file must not import it."""
    try:
        yield
    except exc:
        return
    raise AssertionError(f"expected {exc.__name__}")


def _golden_inputs():
    config = {
        "config_id": "t", "mode": "tdm", "environment": "indoor", "night": False,
        "time_limit_s": 600, "respawn": {"type": "auto", "delay_s": 15},
        "scoring": {"frag_limit": 0, "win_by": "kills"}, "health": {"max_hp": 45, "max_armor": 70},
        "teams": [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
                  {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 2}],
    }
    player = {"player_id": "p1", "player_num": 7, "display": "R", "team_id": "blue", "node_id": None,
              "gun_id": None, "voice": "male", "ready": True,
              "loadout": {"weapons": [{"weapon_id": "assault_rifle"}]}}
    return config, player


def _compile(pres=None, **cfg_over):
    config, player = _golden_inputs()
    config.update(cfg_over)
    if pres is not None:
        config["presentation"] = pres
    return C._DEFAULT.compile(config, player, config["teams"])


# --- the model ------------------------------------------------------------------ #
def test_every_preset_default_sound_is_on_the_gun():
    on = snd.on_gun_ids()
    for name in P.PRESETS:
        prof = P.resolve({"presentation": P.profile_from_preset(name)})
        for ev, spec in prof["events"].items():
            s = spec["sound"]
            # "voice:<role>" (A15, e.g. low_health's "voice:hurt_loop") resolves per player at compile
            # time -- voices.role_id already checks the resolved id is on the gun, so skip the raw string here.
            if s and not s.startswith("voice:") and s != "VSF+JAY":
                assert s in on, (name, ev, s)


def test_mode_default_is_counter_strike_for_cs_and_standard_otherwise():
    assert P.default_for("cs")["preset"] == "counter_strike"
    assert P.default_for("tdm")["preset"] == "standard" and P.default_for("ffa")["preset"] == "standard"
    assert P.default_for("infection")["preset"] == "infection"
    assert P.default_for("lms")["preset"] == "last_stand"
    assert P.default_for("extraction")["preset"] == "extraction"
    assert default_config("infection")["presentation"]["preset"] == "infection"
    assert default_config("tdm")["presentation"]["preset"] == "standard"   # MC has no cs mode yet; cs is the CLI's


def test_merge_preset_replaces_and_an_edit_makes_it_custom():
    p = P.merge(None, {"preset": "silenced"})
    assert p["preset"] == "silenced" and p["announcer"] is False and p["gun_flash"] is False
    q = P.merge(p, {"announcer": True})
    assert q["preset"] == "custom" and q["announcer"] is True and q["gun_flash"] is False
    r = P.merge(q, {"events": {"hit_taken": {"gun_led": "orange", "sound": "X12"}}})
    assert r["events"]["hit_taken"] == {"gun_led": pg.ORANGE, "sound": "X12"}
    s = P.merge(r, {"events": {"hit_taken": None}})          # null removes the override
    assert "hit_taken" not in s["events"]


def test_merge_rejects_bad_input():
    # a plain loop, not parametrize: run_tests.py calls test functions directly
    for bad in [{"preset": "loud"}, {"announcer": "yes"}, {"events": {"nope": {}}},
                {"events": {"hit_taken": {"sound": "E_J10"}}},          # app-only id: NOT on the gun
                {"events": {"hit_taken": {"gun_led": 9}}}, {"events": {"hit_taken": {"colour": 1}}}]:
        with raises(ValueError):
            P.merge(None, bad)


def test_play_frame_puts_voices_on_the_announcer_slot_and_effects_on_the_sfx_slot():
    assert P.play_frame("VA7E", None) == "$PLAY,,4,6,VA7E,,,,*"
    assert P.play_frame("X12", None) == "$PLAY,X12,4,6,,,,,*"
    assert P.play_frame("voice:kill", "V3A") == "$PLAY,,4,6,V3A,,,,*"
    assert P.play_frame("VSF+JAY", None) == "$PLAY,VSF,4,6,JAY,,,,*"
    # A15: a {role: id} map resolves any voice role; a role the map cannot fill is no cue
    assert P.play_frame("voice:boast", {"kill": "V3A", "boast": "V3I"}) == "$PLAY,,4,6,V3I,,,,*"
    assert P.play_frame("voice:boast", "V3A") is None and P.play_frame("voice:taunt", {}) is None


def test_voice_role_sounds_resolve_per_player_through_the_compiler():
    """A15 personality moments: `sound: "voice:boast"` on respawned plays THAT player's boast; the words in the
    ADVANCED table say whose line it is; a made-up role is refused like any bad sound."""
    cfg = {**default_config("tdm"), "presentation": {"events": {"respawned": {"sound": "voice:boast"}, "game_over": {"sound": "voice:defeat_taunt"}}}}
    teams = cfg["teams"]
    player = {"player_id": "p1", "player_num": 3, "display": "X", "team_id": teams[0]["team_id"], "node_id": None, "gun_id": None,
              "voice": "heavy", "ready": True, "loadout": {"weapons": [{"weapon_id": "assault_rifle"}]}}
    b = C.Compiler().compile(cfg, player, teams)
    assert b["cues"]["respawned"] == "$PLAY,,4,6,V3I,,,,*" and b["cues"]["game_over"] == "$PLAY,,4,6,V3B,,,,*"
    b2 = C.Compiler().compile(cfg, {**player, "voice": "scout"}, teams)
    assert b2["cues"]["respawned"] == "$PLAY,,4,6,VBI,,,,*"
    b3 = C.Compiler().compile(cfg, {**player, "voice_slots": {"kill": "V38"}}, teams)
    assert b3["cues"]["kill"] == "$PLAY,,4,6,V38,,,,*" and b3["cues"]["respawned"] == "$PLAY,,4,6,V3I,,,,*"
    rows = {r["event"]: r for r in P.table(cfg)}
    assert rows["respawned"]["words"] == "the player's own voice: boast" and rows["kill"]["words"] == "the player's own voice: kill line"
    with raises(ValueError):
        P.merge(None, {"events": {"respawned": {"sound": "voice:dance"}}})


def test_low_health_plays_the_players_own_hurt_loop_and_long_death_is_retired():
    """Tony, 2026-09-06 (bench): the hurt loop plays at critical health; the long death "is ridiculous,
    probably dont use that one for anything" and can no longer be picked for any presentation event."""
    config, player = _golden_inputs()
    b = C._DEFAULT.compile(config, {**player, "voice": "heavy"}, config["teams"])
    assert b["cues"]["hurt"] == "$PLAY,,4,6,V36,,,,*"
    b2 = C._DEFAULT.compile(config, {**player, "voice": "scout"}, config["teams"])
    assert b2["cues"]["hurt"] == "$PLAY,,4,6,VB6,,,,*"          # V36 replaced by the scout family's own line
    with raises(ValueError):
        P.merge(None, {"events": {"low_health": {"sound": "voice:long_death"}}})


# --- compiled into the bundle ---------------------------------------------------- #
def test_standard_bundle_carries_led_bursts_and_verified_cues():
    b = golden_bundle()
    assert b["presentation"]["preset"] == "standard" and b["presentation"]["custom_events"] == []
    # led-language.md §3.1/§6 finding #5 (2026-09-07): hit_taken/died/healed/armour_up/shield_up no
    # longer carry a default gun burst -- the transient pool readout is the feedback for a pool change,
    # and death is hands-off. "respawned" is dropped too (team-lead correction, 2026-09-07): a burst
    # there lands inside the 2.5 s the body is still blanking off the firmware's own spawn breathing
    # (`gun.take`) and would fight it; the headset's white flash + spawn sound already mark a respawn.
    for ev in ("hit_taken", "died", "healed", "armour_up", "shield_up", "respawned"):
        assert ev not in b["leds"], ev
    # GUN_DEFAULT is "team" (Tony, 2026-09-09) -- the golden player is on "blue" (tid 1 -> BLUE).
    # A16.4 (2026-09-09): the rest is DIM -- brightness is what separates the resting body from the
    # (full-brightness) readout bar, and pregame's full-brightness paint stays elsewhere in the bundle.
    assert b["gun"]["rest"] == pg.team_frame(1, False, dim=True), "team colour by default, dim in play"
    # a burst still ends on the gun's rest frame for any event that DOES carry one -- "extraction_failed"
    # (default RED) stands in, since none of the player-status events keep a default burst any more.
    seq = b["leds"]["extraction_failed"]
    flashes = [f for f, _ in seq if f != b["gun"]["rest"] and not f.startswith("$LED")]
    assert len(flashes) == pg.BURST_FLASHES and all(f.startswith("$GLED,") for f in flashes)
    assert seq[-1][0] == b["gun"]["rest"], "a burst ends on the gun's rest frame (team colour by default)"
    assert b["cues"]["multi"] == "$PLAY,,4,6,VA7E,,,,*"          # "Double Kill", transcript-verified
    assert b["cues"]["first_blood"] == "$PLAY,,4,6,VA7H,,,,*"
    assert b["cues"]["objective_scored"] == f"$PLAY,,4,6,{snd.OBJECTIVE_SCORED},,,,*"
    assert b["cues"]["hurt"] == "$PLAY,,4,6,VA6,,,,*"            # the player's own hurt loop (Tony 2026-09-06: good at critical health)
    assert b["cues"]["kill"].startswith("$PLAY,,4,6,")


def test_silenced_mutes_the_announcer_and_drops_the_gun_flashes_but_keeps_the_player_status():
    b = _compile({"preset": "silenced"})
    assert b["presentation"]["preset"] == "silenced"
    assert b["leds"] == {}
    for ev in ("kill", "multi", "medal", "first_blood", "objective_scored", "lead_taken", "victory", "game_over"):
        assert b["cues"][ev] == "", ev                  # present and deliberately mute -> $SFLASH only
    assert b["cues"]["hurt"] == "$PLAY,,4,6,VA6,,,,*"  # the player's own low-health alert (hurt loop) survives
    assert b["cues"]["countdown"] == "$PLAY,VA81,4,6,,,,,*"
    assert b["headset"]["pregame"] == ["$HLED,1,0,,,10,,*"]   # the lobby team colour is not "announcer stuff" (A11.6: dark in play)
    # led-language.md §3.5 "readout off" (2026-09-07 gap, caught by the engine lane): a silenced sniper
    # mode must not paint a three-segment pool bar on every hit either -- the gun body stays dark and
    # otherwise unlit, `readout` absent entirely from the bundle.
    assert "readout" not in b["gun"]
    assert P.gun_readout(P.resolve({"presentation": {"preset": "silenced"}}), False) == {}


def test_counter_strike_preset_uses_the_real_bomb_lines():
    b = _compile({"preset": "counter_strike"})
    assert b["cues"]["bomb_planted"] == f"$PLAY,,4,6,{snd.BOMB_PLANTED},,,,*"
    assert b["cues"]["bomb_defused"] == f"$PLAY,,4,6,{snd.BOMB_DEFUSED},,,,*"
    assert b["cues"]["bomb_detonated"] == "$PLAY,X12,4,6,,,,,*"
    assert b["leds"]["bomb_planted"][0][0].startswith(f"$GLED,{pg.ORANGE},")


def test_vip_preset_and_a_custom_event_override():
    b = _compile({"preset": "vip"})
    assert b["cues"]["vip_hit"] == "$PLAY,,4,6,VIP,,,,*" and b["cues"]["vip_down"] == "$PLAY,,4,6,VA72,,,,*"
    # led-language.md §6 finding #6 (2026-09-07): a one-shot event headset colour HOLDS then reverts to
    # the headset's own rest frame, rather than staying lit for the rest of the life.
    vip_hit_seq = b["leds"]["vip_hit"]
    assert vip_hit_seq[-2] == [f"$HLED,{pg.ORANGE},0,,,10,,*", P.STATIC_EVENT_HLED_HOLD_S]
    assert vip_hit_seq[-1] == [b["headset"]["rest"], 0.0]
    c = _compile(P.merge(None, {"events": {"hit_taken": {"sound": "H29", "gun_led": "orange"}}}))
    assert c["presentation"]["preset"] == "custom" and c["presentation"]["custom_events"] == ["hit_taken"]
    assert c["cues"]["hit_taken"] == "$PLAY,H29,4,6,,,,,*"
    assert c["leds"]["hit_taken"][0][0].startswith(f"$GLED,{pg.ORANGE},{pg.ORANGE},{pg.ORANGE},")


def test_headset_team_off_removes_every_team_colour_frame():
    b = _compile(P.merge(None, {"headset_team": False}))
    assert b["cues"]["team_led"] == ""
    assert not any(f.startswith("$HLED,") for f in b["spawn"] + b["revive"])


def test_night_dims_and_shortens_but_blackout_alone_empties_everything():
    """led-language.md §6 finding #2 (2026-09-07 fix): night USED TO be a blackout that also deleted the
    down signal; it is now a brightness/hold overlay, and `presentation.blackout` is the only switch
    that empties every table -- `down` survives even that."""
    day = _compile(None, night=False)
    night = _compile(None, night=True)
    assert night["leds"] != {}                                       # night is NOT a blackout any more
    # GUN_DEFAULT is "team" (Tony, 2026-09-09) -- the fixture player is on "blue" (tid 1 -> BLUE).
    assert night["gun"]["rest"] == f"$GLED,{pg.BLUE},{pg.BLUE},{pg.BLUE},0,{pg.BRIGHT_DIM},,*"
    assert night["gun"]["readout"]["hold_s"] < day["gun"]["readout"]["hold_s"]
    assert night["headset"]["down"] == day["headset"]["down"] == {
        "rearm": "$HLOOP,2,750,*", "stop": "$HLOOP,0,0,*", "rearm_after_ms": 2500}
    blackout = _compile(P.merge(None, {"blackout": True}))
    assert blackout["leds"] == {} and "gun" not in blackout    # no `bundle["gun"]` at all -- readout included
    # `gun_readout()` itself is a pure table-builder that does not know about `blackout` (it is gated
    # one level up, in `gun_frames()`'s leds_on check) -- confirm the GATE, not the builder in isolation.
    bo_prof = P.resolve({"presentation": {"blackout": True}})
    assert P.gun_frames(bo_prof, 1, False, False) == {}, "leds_on=False (blackout) must drop the whole gun table, readout included"
    assert P.gun_readout(bo_prof, False) != {}, "the builder itself is unconditional -- blackout is enforced by its caller"
    assert blackout["headset"] == {"down": blackout["headset"]["down"]}   # only the down signal survives blackout
    assert blackout["headset"]["down"] == day["headset"]["down"]


def test_put_config_accepts_a_preset_and_rejects_an_off_gun_sound():
    """A11.1: the MC config validator carries the profile like any other key (A8.3)."""
    from brx_mcp.mc.state import Session
    s = Session.__new__(Session)                      # only the pure sanitizer is exercised
    cfg = s.sanitize_config({"mode": "tdm", "presentation": {"preset": "silenced"}})
    assert cfg["presentation"]["preset"] == "silenced" and cfg["presentation"]["announcer"] is False
    with raises(ValueError):
        s.sanitize_config({"mode": "tdm", "presentation": {"events": {"hit_taken": {"sound": "E_J10"}}}})
    plain = s.sanitize_config({"mode": "tdm"})
    assert plain["presentation"]["preset"] == "standard"


def test_respawn_delay_s_floors_at_3_but_0_stays_valid_for_no_respawn():
    """F34 (2026-09-07 bench): F13 wedges the headset in the relay's out-blink when $SPAWN lands within
    ~2 s of death (2.5 s measured clean) -- so MC must not let a host configure 1-2 s. 0 is the sentinel
    for "unset / no respawn" (respawn.type == "none", e.g. Last Man Standing) and must keep working."""
    from brx_mcp.mc.state import Session
    s = Session.__new__(Session)
    for bad in (1, 2):
        with raises(ValueError):
            s.sanitize_config({"mode": "tdm", "respawn": {"type": "auto", "delay_s": bad}})
    for ok in (0, 3, 15, 600):
        cfg = s.sanitize_config({"mode": "tdm", "respawn": {"type": "auto", "delay_s": ok}})
        assert cfg["respawn"]["delay_s"] == ok
    # the "none" respawn type's own default (0) is unaffected
    lms = s.sanitize_config({"mode": "lms", "respawn": {"type": "none", "delay_s": 0}})
    assert lms["respawn"]["type"] == "none" and lms["respawn"]["delay_s"] == 0


def test_medal_events_each_have_their_own_verified_line_and_alerts_carry_text():
    b = golden_bundle()
    assert b["cues"]["first_blood"] == "$PLAY,,4,6,VA7H,,,,*"
    assert b["cues"]["double_kill"] == "$PLAY,,4,6,VA7E,,,,*"
    assert b["cues"]["triple_kill"] == "$PLAY,,4,6,VA7Q,,,,*"
    assert b["cues"]["killtacular"] == "$PLAY,,4,6,V124,,,,*"
    assert b["cues"]["killing_spree"] == "$PLAY,,4,6,VA7K,,,,*"
    assert "unstoppable" not in b["cues"]                     # no bank line: flash only
    assert b["cues"]["next_kill_wins"] == "$PLAY,,4,6,V115,,,,*"
    assert b["cues"]["time_60"] == "$PLAY,,4,6,V113,,,,*"
    assert P.alert_body("bomb_planted") == {"kind": "bomb_planted", "text": "BOMB PLANTED"}
    assert P.alert_body("last_survivor", {"player_id": "p0"})["player_id_subject"] == "p0"   # the subject, not the recipient


def test_extraction_preset_follows_the_genre_loop_and_last_stand_has_no_last_survivor_by_default():
    b = _compile({"preset": "extraction"})
    for ev, sid in (("extraction_called", "VA1C"), ("extraction_open", "VA1U"), ("extraction_closing", "VX0R"),
                    ("extraction_complete", "VQ8"), ("extraction_failed", "VA8X"), ("extraction_alert", "VA1S"),
                    ("loot_picked", "VA1Q"), ("raid_ending", "VA3U")):
        assert b["cues"][ev] == f"$PLAY,,4,6,{sid},,,,*", ev
    assert b["cues"]["raid_over"] == "$PLAY,X20,4,6,,,,,*" and b["cues"]["extraction_tick"] == "$PLAY,K01,4,6,,,,,*"
    # led-language.md §6 finding #6: the static headset paint holds then reverts, it does not stay lit
    assert b["leds"]["extraction_called"][-2] == [f"$HLED,{pg.ORANGE},0,,,10,,*", P.STATIC_EVENT_HLED_HOLD_S]
    assert b["leds"]["extraction_called"][-1] == [b["headset"]["rest"], 0.0]
    ls = _compile({"preset": "last_stand"})
    assert "last_survivor" not in ls["cues"], "MC cannot know it reliably with HUDs offline; not a default"
    # led-language.md §3.1 "Death is hands-off" (2026-09-07): `died` no longer paints the gun or the
    # headset at all -- the node writes NOTHING to either surface in the 2.5 s after $HP,0.
    assert "died" not in ls["leds"]



def test_event_sources_and_the_class_switches():
    prof = P.resolve({"mode": "tdm"})
    assert prof["events"]["hit_taken"]["source"] == "hud" and prof["events"]["time_60"]["source"] == "hud"
    assert prof["events"]["lead_taken"]["source"] == "mc" and prof["events"]["kill"]["source"] == "mc"
    assert prof["events"]["infected"]["source"] == "both"
    assert P.GLOBAL_STATE_EVENTS <= {ev for ev, spec in prof["events"].items() if spec["source"] in ("mc", "both")}
    # mute the MC class: MC-sourced cues go "" and their LEDs vanish; HUD-sourced ones stay.
    # "extraction_called" (source hud, default gun_led ORANGE) stands in for the old "hit_taken" check
    # here -- hit_taken carries no default light any more (led-language.md §6 finding #5, 2026-09-07).
    b = _compile(P.merge(None, {"mc_events": False}))
    assert b["cues"]["lead_taken"] == "" and b["cues"]["first_blood"] == ""
    assert b["cues"]["time_60"].startswith("$PLAY") and "extraction_called" in b["leds"]
    assert "objective_taken" not in b["leds"]
    # mute the HUD class: the reverse
    c = _compile(P.merge(None, {"hud_events": False}))
    assert c["cues"]["time_60"] == "" and "extraction_called" not in c["leds"]
    assert c["cues"]["first_blood"].startswith("$PLAY")
    assert b["presentation"]["mc_events"] is False and c["presentation"]["hud_events"] is False


def test_table_rows_carry_source_words_and_enabled_for_the_advanced_view():
    rows = {r["event"]: r for r in P.table({"mode": "extraction", "presentation": {"preset": "extraction"}})}
    assert rows["extraction_called"]["words"] == "Black Hawk inbound." and rows["extraction_called"]["source"] == "hud"
    assert rows["extraction_alert"]["source"] == "mc" and rows["extraction_alert"]["words"] == "enemy chopper detected."
    assert rows["kill"]["words"] == "the player's own voice: kill line"
    assert all(r["enabled"] for r in rows.values())
    off = {r["event"]: r for r in P.table({"mode": "tdm", "presentation": P.merge(None, {"mc_events": False})})}
    assert off["lead_taken"]["enabled"] is False and off["hit_taken"]["enabled"] is True


def test_headset_block_defaults_validation_and_frames():
    prof = P.resolve({"mode": "tdm"})
    assert prof["headset"] == P.HEADSET_DEFAULT
    hs = P.headset_frames(prof, 1, True, {1: 1, 2: 2})
    assert hs["pregame"] == ["$HLED,1,0,,,10,,*"] and hs["rest"] == P.HEADSET_DARK
    assert hs["start"][0][0] == "$HLED,6,2,120,120,10,2,*" and hs["start"][-1] == [P.HEADSET_DARK, 0.0]
    assert hs["hit"] == []                                                       # default: the NATIVE hit flash (ladder 2026-09-04: nothing over BLE is as bright)
    red = P.headset_frames(P.resolve({"presentation": P.merge(None, {"headset": {"hit": "red"}})}), 1, True)
    assert red["hit"][0][0].startswith("$HLED,0,2,") and red["hit"][-1][0] == P.HEADSET_DARK   # opt-in colour: flash then rest
    # 2026-09-07 (led-language.md §3.2): the down signal is the firmware's OWN out-flash, restored by
    # $HLOOP if a blank ever suppressed it -- the node writes nothing extra to the headset at death by
    # default ("native"), and `down` carries the $HLOOP re-arm/stop, present even with LEDs off.
    assert hs["death"] == [] and hs["down"] == {"rearm": "$HLOOP,2,750,*", "stop": "$HLOOP,0,0,*", "rearm_after_ms": 2500}
    assert hs["respawn"][0][0] == hs["start"][0][0]
    green = P.headset_frames(P.resolve({"presentation": P.merge(None, {"headset": {"death": "green"}})}), 1, True)
    assert green["death"] == [["$HLED,3,2,400,400,10,200,*", 0.0]]
    assert P.headset_frames(P.resolve({"presentation": P.merge(None, {"headset": {"death": "native"}})}), 1, True)["death"] == []
    # led-language.md §3.3 (2026-09-07 build): the old carrier-only, per-team-coloured table is now
    # `role`, with 5 states; carrier/vip/beacon/extracted are single held frames (WHITE or ORANGE --
    # never a team colour, finding #11), only `infected` is still keyed by team.
    assert set(hs["role"]) == {"carrier", "infected", "vip", "beacon", "extracted"}
    assert hs["role"]["carrier"] == [[f"$HLED,{pg.WHITE},2,300,300,10,200,*", 0.0]]
    assert hs["role"]["vip"] == [[f"$HLED,{pg.WHITE},0,,,10,,*", 0.0]]
    assert hs["role"]["beacon"] == [[f"$HLED,{pg.ORANGE},2,300,300,10,200,*", 0.0]]
    assert hs["role"]["extracted"] == [[f"$HLED,{pg.WHITE},0,,,10,,*", 0.0]]
    assert set(hs["role"]["infected"]) == {"1", "2"} and hs["role"]["infected"]["2"][0][0] == "$HLED,2,0,,,10,,*"
    # `headset.carrier` (legacy) is still accepted and maps onto the same one switch as `role`
    off_legacy = P.headset_frames(P.resolve({"presentation": P.merge(None, {"headset": {"carrier": False}})}), 1, True)
    assert off_legacy["role"] == {}
    # LEDs off/blackout: only the down signal survives -- it costs no light budget and is the one
    # signal other players must read (led-language.md §3.2, §3.4 "blackout: identical").
    assert P.headset_frames(prof, 1, False) == {"down": hs["down"]}
    # every flash ends on an explicit state frame (count-limited blinks ending dark are unverified)
    for k in ("start", "respawn"):
        assert hs[k][-1][0] in (P.HEADSET_DARK, "$HLED,1,0,,,10,,*")
    # edits
    q = P.merge(None, {"headset": {"in_play": "team", "hit": "orange", "death": "red", "pregame": "off", "start_flash": False}})
    assert q["preset"] == "custom" and q["headset"]["in_play"] == "team" and q["headset"]["hit"] == pg.ORANGE
    assert q["headset"]["death"] == pg.RED and q["headset"]["pregame"] == "off"
    fr = P.headset_frames(P.resolve({"presentation": q}), 1, True, {1: 1})
    assert fr["pregame"] == [] and fr["start"] == [["$HLED,1,0,,,10,,*", 0.0]] and fr["death"][0][0] == "$HLED,0,2,400,400,10,200,*"
    for bad in ({"headset": {"in_play": "purple"}}, {"headset": {"hit": 12}}, {"headset": {"glow": True}},
                {"headset": "loud"}, {"headset": {"role": "yes"}}, {"headset": {"carrier": "yes"}}):
        with raises(ValueError):
            P.merge(None, bad)


def test_ffa_paints_white_headset_and_gun_body():
    """led-language.md §6 finding #11 / Q19: FFA has no team identity to protect."""
    prof = P.resolve({"mode": "ffa"})
    hs = P.headset_frames(prof, 1, True, ffa=True)
    assert hs["pregame"] == [f"$HLED,{pg.WHITE},0,,,10,,*"]
    assert P.gun_pregame(prof, 1, False, True, ffa=True) == [f"$GLED,{pg.WHITE},{pg.WHITE},{pg.WHITE},0,10,,*"]
    team = P.resolve({"presentation": {"gun": {"in_play": "team"}}})
    # A16.4 (2026-09-09): the in-play rest is DIM, unlike the full-brightness pregame paint above.
    assert P.gun_frames(team, 1, False, True, ffa=True)["rest"] == pg.team_frame(1, False, ffa=True, dim=True)


def test_headset_night_dims_and_single_flashes_the_start_and_respawn():
    """led-language.md §3.4: pregame/role states dim to tok5=1; start/respawn go from a double flash to
    a single one at night."""
    prof = P.resolve({"mode": "tdm"})
    hs = P.headset_frames(prof, 1, True, night=True)
    assert hs["pregame"] == [f"$HLED,1,0,,,{pg.BRIGHT_DIM},,*"]
    assert hs["start"][0][0] == f"$HLED,{pg.WHITE},2,120,120,{pg.BRIGHT_DIM},1,*"
    assert hs["role"]["vip"] == [[f"$HLED,{pg.WHITE},0,,,{pg.BRIGHT_DIM},,*", 0.0]]
    day = P.headset_frames(prof, 1, True, night=False)
    assert day["start"][0][0] == f"$HLED,{pg.WHITE},2,120,120,{pg.BRIGHT_FULL},2,*"


def test_headset_death_null_is_rejected_at_merge_not_at_push():
    """Polish 2026-09-04: `death: null` passed merge and then int(None) blew up in headset_frames() at PUSH."""
    with raises(ValueError):
        P.merge(None, {"headset": {"death": None}})
    p = P.merge(None, {"headset": {"death": "native", "hit": None}})     # hit may be off; death must be a colour or native
    assert p["headset"]["death"] == "native" and p["headset"]["hit"] is None
    # A11.8 death_flash retired 2026-09-07 (led-language.md §3.2): "flash" is no longer a real value,
    # but a saved game that picked it must keep loading rather than 500 at push time -- merge() maps it
    # forward to "native" (the $HLOOP down signal replaces it, unconditionally, see headset_frames()).
    assert P.merge(None, {"headset": {"death": "flash"}})["headset"]["death"] == "native"
    assert P.headset_frames(P.resolve({"mode": "tdm", "presentation": p}), 1, True)["death"] == []


def test_gun_block_default_native_sends_nothing_and_the_opt_ins_blank_then_paint():
    """A11.7 / S4 (bench 2026-09-04): $GLED,,,,5 after $SPAWN suppresses the firmware breathing; a paint then holds.

    GUN_DEFAULT is "team" (Tony, 2026-09-09: "instead of going dark lets put the team color on the gun
    led") -- the body rests on the team colour and the transient readout layers on top of that rest."""
    prof = P.resolve({"mode": "tdm"})
    assert prof["gun"] == {"in_play": "team", "pregame": "team"} and P.summary(prof)["gun"]["in_play"] == "team"
    assert P.gun_pregame(prof, 1, False, True) == ["$GLED,1,1,1,0,10,,*"] and P.gun_pregame(prof, 1, False, False) == []
    assert P.gun_pregame(P.resolve({"presentation": {"gun": {"pregame": "off"}}}), 1, False, True) == []
    native = P.resolve({"presentation": P.merge(None, {"gun": {"in_play": "native"}})})
    assert native["preset"] == "custom"
    assert P.gun_frames(native, 1, False, True) == {} and P.gun_spawn_tail(native, 1, False, True) == []
    team = prof   # the default profile now RESTS on the team colour
    gf = P.gun_frames(team, 1, False, True)
    # A16.4 (2026-09-09): the in-play rest is DIM even in day -- brightness is what separates the
    # resting body from the (full-brightness) readout bar, so this is `team_frame(dim=True)`, not the
    # full-brightness pregame paint.
    assert gf["in_play"] == "team" and gf["blank"] == "$GLED,,,,5,,,*" and gf["rest"] == pg.team_frame(1, False, dim=True)
    assert gf["after_spawn_s"] == 2.5 and gf["take"] == ["$GLED,,,,5,,,*", pg.team_frame(1, False, dim=True)]
    assert "bands" not in gf, "the legacy whole-strip health bands are only built for in_play=='health'"
    assert P.gun_spawn_tail(team, 1, False, True) == []          # retired: the node takes the body on a timer
    # night and day now paint the SAME dim rest (A16.4) -- night no longer has anything left to dim here.
    assert P.gun_frames(team, 1, True, True)["rest"] == pg.team_frame(1, True, dim=True)
    assert P.gun_frames(team, 1, False, False) == {}                                  # LEDs off for the game
    dark = P.resolve({"presentation": {"gun": {"in_play": "dark"}}})
    assert P.gun_frames(dark, 1, False, True)["rest"] == "$GLED,9,9,9,0,10,,*"    # explicit "dark" still fully supported
    health = P.resolve({"presentation": {"gun": {"in_play": "health"}}})
    hf = P.gun_frames(health, 1, False, True)
    assert hf["take"] == ["$GLED,,,,5,,,*", hf["bands"][0][1]]
    assert [b[0] for b in hf["bands"]] == [0.66, 0.33, 0.0]
    assert [b[1] for b in hf["bands"]] == ["$GLED,3,3,3,0,10,,*", "$GLED,2,2,2,0,10,,*", "$GLED,0,0,0,0,10,,*"]
    assert hf["rest"] == hf["bands"][0][1]
    # led-language.md §4 collapse map: `in_play: "health"` (no explicit `readout` override) collapses
    # onto "readout limited to health" rather than the default three pools.
    assert [p["pool"] for p in hf["readout"]["pools"]] == ["health"]
    # event bursts end on the gun's resting frame; "extraction_failed" (default RED) stands in for the
    # old hit_taken/died check -- those two carry no default gun burst any more (finding #5).
    # team's rest is DIM (A16.4); dark's is not team-coloured at all, so it is untouched by that change.
    assert P.led_table(team, 1, False, True)["extraction_failed"][-1][0] == pg.team_frame(1, False, dim=True)
    assert P.led_table(dark, 1, False, True)["extraction_failed"][-1][0] == "$GLED,9,9,9,0,10,,*"
    assert P.led_table(native, 1, False, True)["extraction_failed"][-1][0] == pg.team_frame(1, False)
    for bad in ({"gun": {"in_play": "breathe"}}, {"gun": {"colour": 3}}, {"gun": "on"}, {"gun": {"pregame": "blue"}},
                {"gun": {"readout": {"pools": ["mana"]}}}, {"gun": {"readout": {"hold_s": 0}}}, {"gun": {"readout": "yes"}}):
        with raises(ValueError):
            P.merge(None, bad)


def test_gun_readout_ships_static_per_band_segment_frames_outermost_pool_first():
    """led-language.md §3.1/§5 (2026-09-07 build): shield/armor/health, outermost first, 3/2/1 lit
    segments per band, `max` shipped so the node never parses a frame."""
    b = golden_bundle()   # hp 45, armor 70, shield defaults to gc.shield (70)
    ro = b["gun"]["readout"]
    assert ro["hold_s"] == 4 and ro["reload_glance_s"] == 2
    assert [p["pool"] for p in ro["pools"]] == ["shield", "armor", "health"]
    shield, armor, health = ro["pools"]
    assert shield["max"] == 70 and armor["max"] == 70 and health["max"] == 45
    assert shield["bands"] == [[thr, f] for thr, f in pg.readout_bands("shield")]
    assert armor["bands"] == [[thr, f] for thr, f in pg.readout_bands("armor")]
    assert health["bands"] == [[thr, f] for thr, f in pg.readout_bands("health")]
    # a narrowed pool list is honoured, and the order stays outermost-first regardless of input order
    only_health = P.resolve({"presentation": {"gun": {"readout": {"pools": ["health", "shield"]}}}})
    rf = P.gun_readout(only_health, False, hp=45, armor=70, shield=70)
    assert [p["pool"] for p in rf["pools"]] == ["shield", "health"]
    assert P.gun_readout(P.resolve({"presentation": {"gun": {"readout": {"pools": []}}}}), False) == {}


def test_gun_readout_also_ships_the_a16_3_seven_level_drop_animation_table():
    """A16.3 (2026-09-07 bench): `levels` rides ALONGSIDE the original `bands` -- an older node that
    has never heard of `levels` keeps reading `bands` exactly as before."""
    b = golden_bundle()
    ro = b["gun"]["readout"]
    assert (ro["lead_ms"], ro["blink_gap_ms"], ro["step_ms"], ro["blink_ms"]) == (180, 80, 120, 400)
    shield, armor, health = ro["pools"]
    for pool_entry, pool in ((shield, "shield"), (armor, "armor"), (health, "health")):
        assert pool_entry["levels"] == pg.readout_levels(pool)
        assert len(pool_entry["levels"]) == 7
        assert "bands" in pool_entry, "bands must stay for older nodes"
    # night: the timings are fixed (untouched by night), but every level frame dims
    night_prof = P.resolve({"presentation": {}})
    night_ro = P.gun_readout(night_prof, True, hp=45, armor=70, shield=70)
    assert (night_ro["lead_ms"], night_ro["blink_gap_ms"], night_ro["step_ms"], night_ro["blink_ms"]) \
        == (180, 80, 120, 400)
    for pool_entry in night_ro["pools"]:
        for solid, blink in pool_entry["levels"]:
            assert solid.split(",")[5] == str(pg.BRIGHT_DIM)
            if blink is not None:
                assert blink.split(",")[5] == str(pg.BRIGHT_DIM)


def test_small_led_flash_rides_at_the_start_of_an_events_lights_and_is_validated():
    """A11.8 (ladder 2026-09-04): `$LED,0,<0 red|1 green>,1,1,*` fires the headset's small native-bright flash LED."""
    prof = P.resolve({"mode": "tdm"})
    assert prof["events"]["kill"]["flash"] == "green" and prof["events"]["died"]["flash"] is None and prof["events"]["lead_taken"]["flash"] is None
    leds = P.led_table(prof, 1, False, True)
    assert leds["kill"][0] == ["$LED,9,1,1,1,*", 0.0]                     # kill: flash only (no gun burst configured)
    # "extraction_failed" (default RED, no flash) stands in for the old "died" check -- died carries no
    # default gun burst any more (led-language.md §6 finding #5, "Death is hands-off").
    assert leds["extraction_failed"][0][0].startswith("$GLED,0,0,0")       # the red gun burst only (the small LED is green-only)
    assert leds["first_blood"][0] == ["$LED,9,1,1,1,*", 0.0]
    q = P.merge(None, {"events": {"lead_taken": {"flash": "green"}, "kill": {"flash": None}}})
    r = P.led_table(P.resolve({"presentation": q}), 1, False, True)
    assert r["lead_taken"][0][0] == "$LED,9,1,1,1,*" and "kill" not in r
    for bad in ("blue", "red"):
        with raises(ValueError):
            P.merge(None, {"events": {"kill": {"flash": bad}}})
    rows = {x["event"]: x for x in P.table({"mode": "tdm"})}
    assert rows["kill"]["flash"] == "green" and rows["died"]["flash"] is None


def test_no_burst_ever_alternates_a_colour_identical_to_the_rest_frame():
    """led-language.md §6 finding #3 (2026-09-07, caught by the LED invariant tests, fixed here): a
    burst alternates flash-colour and rest-colour, so a burst whose event colour EQUALS the rest colour
    produces zero visible transitions -- `objective_scored` (WHITE) against an FFA/no-team rest (also
    WHITE, Q19) was the concrete instance found, but this walks every preset x team (incl. None and
    FFA) as the GENERAL guard, not just that one case.

    GUN_DEFAULT flipping to "team" (Tony, 2026-09-09) made the collision path reachable through the
    DEFAULT profile too (e.g. `counter_strike` team 0 = RED resting against `bomb_detonated`'s own RED
    gun_led), not just an explicit override -- `led_table()` already alternates against DARK instead of
    the rest colour when they collide (see the comment above `gap = ...` in `led_table()`), which adds
    ONE extra frame at the very end: the burst still flashes `BURST_FLASHES` times, then hands back to
    the TRUE rest, and that hand-back frame happens to repeat the immediately-preceding flash colour
    when the collision fired. So the invariant is not "every adjacent pair differs" any more, it is:
    every flash is still a real, visible transition, and only the FINAL pair may repeat (the hand-back)."""
    for preset in sorted(P.PRESETS):
        prof = P.resolve({"presentation": {"preset": preset}})
        for team in (0, 1, 2, 3, None):
            for ffa in (False, True):
                leds = P.led_table(prof, team, False, True, ffa)
                gf = P.gun_frames(prof, team, False, True, ffa)
                rest = gf["rest"] if gf else pg.team_frame(team, False, ffa)
                for ev, seq in leds.items():
                    gled = [f for f, _h in seq if f.startswith("$GLED,")]
                    if not gled:
                        continue
                    assert gled[-1] == rest, (preset, team, ffa, ev, "must end on the true rest frame")
                    # no two ADJACENT frames may repeat -- an equal pair is an invisible transition --
                    # EXCEPT possibly the very last pair, which is the collision guard's hand-back: when
                    # the event colour equals the rest colour, the final "back" frame legitimately
                    # repeats the preceding flash so the burst can still end on the true rest.
                    last_pair = len(gled) - 2
                    real_transitions = 0
                    for i, (f1, f2) in enumerate(zip(gled, gled[1:])):
                        if f1 == f2:
                            assert i == last_pair, (preset, team, ffa, ev, "duplicate adjacent frame not at the final hand-back", gled)
                        else:
                            real_transitions += 1
                    # every flash must be a real, visible transition -- at least BURST_FLASHES of them,
                    # whether or not the collision guard added the extra hand-back pair.
                    assert real_transitions >= pg.BURST_FLASHES, (preset, team, ffa, ev, gled)


def test_voice_role_pools_reach_the_bundle_for_multi_take_roles_only():
    """A15.1: `voice:pain` has six takes -> a six-frame pool the node rolls from; `voice:healed` has one line ->
    no pool entry (the single cue is enough); a muted event has no pool either. A15.3 always adds the node's own
    pain pools (pain_short / pain_long -- Heavy's pain_melee and spawn are single-take, so no pool for those),
    regardless of what `hit_taken`'s own sound is configured to."""
    cfg = {**default_config("tdm"), "presentation": {"events": {"hit_taken": {"sound": "voice:pain"}, "healed": {"sound": "voice:healed"}}}}
    teams = cfg["teams"]
    player = {"player_id": "p1", "player_num": 3, "display": "X", "team_id": teams[0]["team_id"], "node_id": None, "gun_id": None,
              "voice": "heavy", "ready": True, "loadout": {"weapons": [{"weapon_id": "assault_rifle"}]}}
    b = C.Compiler().compile(cfg, player, teams)
    assert b["cue_pools"]["hit_taken"] == [f"$PLAY,,4,6,V3{s},,,,*" for s in "CDEFGH"] and b["cues"]["hit_taken"] == "$PLAY,,4,6,V3C,,,,*"
    assert "healed" not in b["cue_pools"] and b["cues"]["healed"] == "$PLAY,,4,6,V37,,,,*"
    assert set(b["cue_pools"]) == {"hit_taken", "kill", "pain_short", "pain_long"}
    muted = C.Compiler().compile({**cfg, "presentation": {**cfg["presentation"], "hud_events": False}}, player, teams)
    assert "hit_taken" not in muted["cue_pools"] and muted["cues"]["hit_taken"] == ""
    assert P.cue_pool_frames(P.resolve(cfg), "V3A") == {}                # the pre-A15 str form carries no pools
