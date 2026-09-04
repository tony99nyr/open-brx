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
            if s and s not in ("voice:kill", "VSF+JAY"):
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


# --- compiled into the bundle ---------------------------------------------------- #
def test_standard_bundle_carries_led_bursts_and_verified_cues():
    b = golden_bundle()
    assert b["presentation"]["preset"] == "standard" and b["presentation"]["custom_events"] == []
    # the tuned burst: three flashes back to the team colour, per player event
    for ev in ("hit_taken", "died", "respawned", "healed", "armour_up", "shield_up"):
        seq = b["leds"][ev]
        flashes = [f for f, _ in seq if f != pg.team_frame(1)]
        assert len(flashes) == pg.BURST_FLASHES and all(f.startswith("$GLED,") for f in flashes), ev
        assert seq[-1][0] == pg.team_frame(1), "a burst ends on the team colour"
    assert b["cues"]["multi"] == "$PLAY,,4,6,VA7E,,,,*"          # "Double Kill", transcript-verified
    assert b["cues"]["first_blood"] == "$PLAY,,4,6,VA7H,,,,*"
    assert b["cues"]["objective_scored"] == f"$PLAY,,4,6,{snd.OBJECTIVE_SCORED},,,,*"
    assert b["cues"]["hurt"] == "$PLAY,VA8B,3,6,,,,,*"           # Callsign's byte-identical frame is kept
    assert b["cues"]["kill"].startswith("$PLAY,,4,6,")


def test_silenced_mutes_the_announcer_and_drops_the_gun_flashes_but_keeps_the_player_status():
    b = _compile({"preset": "silenced"})
    assert b["presentation"]["preset"] == "silenced"
    assert b["leds"] == {}
    for ev in ("kill", "multi", "medal", "first_blood", "objective_scored", "lead_taken", "victory", "game_over"):
        assert b["cues"][ev] == "", ev                  # present and deliberately mute -> $SFLASH only
    assert b["cues"]["hurt"] == "$PLAY,VA8B,3,6,,,,,*"  # the player's own low-health alert survives
    assert b["cues"]["countdown"] == "$PLAY,VA81,4,6,,,,,*"
    assert b["headset"]["pregame"] == ["$HLED,1,0,,,10,,*"]   # the lobby team colour is not "announcer stuff" (A11.6: dark in play)


def test_counter_strike_preset_uses_the_real_bomb_lines():
    b = _compile({"preset": "counter_strike"})
    assert b["cues"]["bomb_planted"] == f"$PLAY,,4,6,{snd.BOMB_PLANTED},,,,*"
    assert b["cues"]["bomb_defused"] == f"$PLAY,,4,6,{snd.BOMB_DEFUSED},,,,*"
    assert b["cues"]["bomb_detonated"] == "$PLAY,X12,4,6,,,,,*"
    assert b["leds"]["bomb_planted"][0][0].startswith(f"$GLED,{pg.ORANGE},")


def test_vip_preset_and_a_custom_event_override():
    b = _compile({"preset": "vip"})
    assert b["cues"]["vip_hit"] == "$PLAY,,4,6,VIP,,,,*" and b["cues"]["vip_down"] == "$PLAY,,4,6,VA72,,,,*"
    assert b["leds"]["vip_hit"][-1] == [f"$HLED,{pg.ORANGE},0,,,10,,*", 0.0]   # static headset paint appended
    c = _compile(P.merge(None, {"events": {"hit_taken": {"sound": "H29", "gun_led": "orange"}}}))
    assert c["presentation"]["preset"] == "custom" and c["presentation"]["custom_events"] == ["hit_taken"]
    assert c["cues"]["hit_taken"] == "$PLAY,H29,4,6,,,,,*"
    assert c["leds"]["hit_taken"][0][0].startswith(f"$GLED,{pg.ORANGE},{pg.ORANGE},{pg.ORANGE},")


def test_headset_team_off_removes_every_team_colour_frame():
    b = _compile(P.merge(None, {"headset_team": False}))
    assert b["cues"]["team_led"] == ""
    assert not any(f.startswith("$HLED,") for f in b["spawn"] + b["revive"])


def test_night_game_has_no_led_table_at_all():
    b = _compile(None, night=True)
    assert b["leds"] == {}


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
    assert P.alert_body("last_survivor", {"player_id": "p0"})["player_id"] == "p0"


def test_extraction_preset_follows_the_genre_loop_and_last_stand_has_no_last_survivor_by_default():
    b = _compile({"preset": "extraction"})
    for ev, sid in (("extraction_called", "VA1C"), ("extraction_open", "VA1U"), ("extraction_closing", "VX0R"),
                    ("extraction_complete", "VQ8"), ("extraction_failed", "VA8X"), ("extraction_alert", "VA1S"),
                    ("loot_picked", "VA1Q"), ("raid_ending", "VA3U")):
        assert b["cues"][ev] == f"$PLAY,,4,6,{sid},,,,*", ev
    assert b["cues"]["raid_over"] == "$PLAY,X20,4,6,,,,,*" and b["cues"]["extraction_tick"] == "$PLAY,K01,4,6,,,,,*"
    assert b["leds"]["extraction_called"][-1] == [f"$HLED,{pg.ORANGE},0,,,10,,*", 0.0]
    ls = _compile({"preset": "last_stand"})
    assert "last_survivor" not in ls["cues"], "MC cannot know it reliably with HUDs offline; not a default"
    assert ls["leds"]["died"][-1] == [f"$HLED,{pg.RED},0,,,10,,*", 0.0]



def test_event_sources_and_the_class_switches():
    prof = P.resolve({"mode": "tdm"})
    assert prof["events"]["hit_taken"]["source"] == "hud" and prof["events"]["time_60"]["source"] == "hud"
    assert prof["events"]["lead_taken"]["source"] == "mc" and prof["events"]["kill"]["source"] == "mc"
    assert prof["events"]["infected"]["source"] == "both"
    assert P.GLOBAL_STATE_EVENTS <= {ev for ev, spec in prof["events"].items() if spec["source"] in ("mc", "both")}
    # mute the MC class: MC-sourced cues go "" and their LEDs vanish; HUD-sourced ones stay
    b = _compile(P.merge(None, {"mc_events": False}))
    assert b["cues"]["lead_taken"] == "" and b["cues"]["first_blood"] == ""
    assert b["cues"]["time_60"].startswith("$PLAY") and "hit_taken" in b["leds"]
    assert "objective_taken" not in b["leds"]
    # mute the HUD class: the reverse
    c = _compile(P.merge(None, {"hud_events": False}))
    assert c["cues"]["time_60"] == "" and "hit_taken" not in c["leds"]
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
    assert hs["pregame"] == ["$HLED,1,0,,,10,,*"] and hs["rest"] == P.HEADSET_BLANK
    assert hs["start"][0][0] == "$HLED,6,2,120,120,10,2,*" and hs["start"][-1] == [P.HEADSET_BLANK, 0.0]
    assert hs["hit"][0][0].startswith("$HLED,0,2,") and hs["hit"][-1][0] == P.HEADSET_BLANK
    # while out: OUR green slow blink. "native" (write nothing) leaves the headset DARK in a hosted game --
    # the firmware's out-blink does not fire once the node owns the headset (Tony, phones, 2026-09-04).
    assert hs["death"] == [["$HLED,3,2,400,400,10,200,*", 0.0]] and hs["respawn"][0][0] == hs["start"][0][0]
    assert P.headset_frames(P.resolve({"presentation": P.merge(None, {"headset": {"death": "native"}})}), 1, True)["death"] == []
    assert set(hs["carrier"]) == {"1", "2"} and hs["carrier"]["2"][0][0] == "$HLED,2,2,300,300,10,200,*"
    assert P.headset_frames(prof, 1, False) == {}
    # every flash ends on an explicit state frame (count-limited blinks ending dark are unverified)
    for k in ("start", "hit", "respawn"):
        assert hs[k][-1][0] in (P.HEADSET_BLANK, "$HLED,1,0,,,10,,*")
    # edits
    q = P.merge(None, {"headset": {"in_play": "team", "hit": "orange", "death": "red", "pregame": "off", "start_flash": False}})
    assert q["preset"] == "custom" and q["headset"]["in_play"] == "team" and q["headset"]["hit"] == pg.ORANGE
    assert q["headset"]["death"] == pg.RED and q["headset"]["pregame"] == "off"
    fr = P.headset_frames(P.resolve({"presentation": q}), 1, True, {1: 1})
    assert fr["pregame"] == [] and fr["start"] == [["$HLED,1,0,,,10,,*", 0.0]] and fr["death"][0][0] == "$HLED,0,2,400,400,10,200,*"
    for bad in ({"headset": {"in_play": "purple"}}, {"headset": {"hit": 12}}, {"headset": {"glow": True}}, {"headset": "loud"}):
        with raises(ValueError):
            P.merge(None, bad)

