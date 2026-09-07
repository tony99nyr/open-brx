"""The GUN STAGE (brx_mcp/stage): every button plays the compiled bundle's frames; the fake gun proves the loop."""
from __future__ import annotations

import asyncio

from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.stage.stage import GunStage, ir_words
from brx_mcp.mc import presentation as P


async def _nosleep(_s):
    return None


def mk(**profile):
    mgr = FakeConnectionManager([FakeTagger("FA:KE:00:00:00:01", "FAKE-STAGE", team=1)])
    st = GunStage(mgr, None, sleep=_nosleep, voice_verdict_sink=lambda _r: None)   # never read/write ~/.brx-mcp from a test
    if profile:
        st.set_profile(**profile)
    return st, mgr


def tx(mgr, alias="stage"):
    try:
        return [e["raw"] for e in mgr.get_events(alias)["events"] if e["direction"] == "tx"]
    except KeyError:          # never connected
        return []


async def settle(st):
    for _ in range(3):
        await asyncio.sleep(0)
    if st._pending:
        await asyncio.gather(*st._pending, return_exceptions=True)


def test_profile_drives_the_bundle_and_the_event_buttons():
    st, _ = mk()
    assert st.profile["gun"] == "team" and st.bundle["gun"]["in_play"] == "team"
    names = {e["event"] for e in st.event_catalog()}
    assert names == set(P.EVENTS)
    st.set_profile(gun="health", headset="team", preset="silenced", night=False)
    assert st.bundle["gun"]["in_play"] == "health" and st.bundle["gun"]["take"][0] == "$GLED,,,,5,,,*"
    assert st.bundle["headset"]["in_play"] == "team"
    assert st.bundle["presentation"]["announcer"] is False       # silenced preset carried into the summary
    st.set_profile(mode="infection")
    assert st.config["mode"] == "infection" and st.bundle["presentation"]["preset"] == "custom"   # gun/headset edits still applied over the mode preset
    st.set_profile(gun="team", headset="dark")
    assert st.bundle["presentation"]["preset"] == "infection"                                     # back on the mode's own preset
    for bad in ({"gun": "breathe"}, {"mode": "cs2"}, {"preset": "loud"}, {"nope": 1}):
        try:
            st.set_profile(**bad)
        except ValueError:
            pass
        else:
            raise AssertionError(f"accepted {bad}")


def test_a_full_mc_config_and_a_presentation_patch_reshape_the_stage():
    st, _ = mk()
    cfg = {**st.config, "config_id": "from-mc", "mode": "tdm",
           "presentation": P.merge(None, {"preset": "vip", "gun": {"in_play": "team"}})}
    st.load_config(cfg, source="test")
    s = st.state()
    assert s["config_source"] == "mc" and s["config_id"] == "from-mc" and st.profile["gun"] == "team"
    assert st.bundle["gun"]["take"] == ["$GLED,,,,5,,,*", "$GLED,1,1,1,0,10,,*"] and not any(f.startswith("$GLED") for f in st.bundle["spawn"])
    st.patch_presentation({"events": {"hit_taken": {"gun_led": "orange"}}})
    assert st.bundle["leds"]["hit_taken"][0][0].startswith("$GLED,8,8,8")
    try:
        st.patch_presentation({"events": {"hit_taken": {"sound": "NOPE"}}})
    except ValueError:
        pass
    else:
        raise AssertionError("an off-gun sound id was accepted")
    st.set_profile(mode="ffa")                                     # selectors take over again
    assert st.state()["config_source"] == "selectors"


def test_arm_spawn_event_kill_and_headset_write_the_bundles_frames():
    async def run():
        st, mgr = mk(headset="team")
        await st.connect("FA:KE:00:00:00:01")
        await st.arm()
        frames = tx(mgr)
        assert frames[:len(st.bundle["head"])] == st.bundle["head"]
        assert st.bundle["headset"]["pregame"][0] in frames
        await st.spawn(); await settle(st)
        frames = tx(mgr)
        for f in st.bundle["spawn"]:
            assert f in frames
        assert "$SFLASH,*" in frames and st.bundle["headset"]["start"][0][0] in frames
        assert st.spawned and st.alive
        n = len(frames)
        led_events = [k for k in st.bundle["leds"] if k not in ("hit_taken", "died", "respawned") and st.bundle["cues"].get(k)]
        ev1, ev2 = led_events[0], led_events[1]
        st.event(ev1); await settle(st)
        new = tx(mgr)[n:]
        pool1 = (st.bundle.get("cue_pools") or {}).get(ev1) or [st.bundle["cues"][ev1]]   # A15: a pooled event plays one random take
        assert any(f in new for f in pool1), (ev1, new)
        burst = [s[0] for s in st.bundle["leds"][ev1]]
        assert [f for f in new if f.startswith("$GLED")] == [b for b in burst if b.startswith("$GLED")]
        n = len(tx(mgr))
        st.event(ev2); await settle(st)                            # inside 1 s: the sound plays, the burst is dropped
        new = tx(mgr)[n:]
        assert st.bundle["cues"][ev2] in new and not any(f.startswith("$GLED") for f in new)
        n = len(tx(mgr))
        st.kill(["double_kill", "killing_spree"]); await settle(st)
        new = tx(mgr)[n:]
        assert new[0] == "$SFLASH,*" and new[1] == st.bundle["cues"]["double_kill"] and new[2] == st.bundle["cues"]["killing_spree"]
        n = len(tx(mgr))
        st.headset("carrier", tid=2); await settle(st)
        assert tx(mgr)[n] == st.bundle["headset"]["carrier"]["2"][0][0] and st.carrying == 2
        st.headset("carrier_off"); await settle(st)
        assert tx(mgr)[-1] == st.bundle["headset"]["rest"] and st.carrying is None
    asyncio.run(run())


def test_an_ir_hit_on_the_fake_gun_plays_the_victim_overlay_and_a_kill_plays_the_death():
    async def run():
        st, mgr = mk(gun="health")
        st.patch_presentation({"headset": {"hit": "red"}})       # opt-in hit colour so the headset flash is testable
        await st.connect("FA:KE:00:00:00:01")
        await st.arm(); await st.spawn(); await settle(st)
        st.poll()                                                  # the fake's $LCD after $SPAWN
        after_spawn = tx(mgr)[tx(mgr).index("$SPAWN,,*"):]
        assert all(f in after_spawn for f in st.bundle["gun"]["take"]), "the take (blank + full-health paint) followed the spawn"
        n = len(tx(mgr))
        await st.ir("shot"); st.poll(); await settle(st)
        new = tx(mgr)[n:]
        assert st.tele["last_hir"] and st.tele["hp"] == 45 and st.tele["armor"] == 45
        assert st.bundle["leds"]["hit_taken"][0][0] in new, "hit_taken burst"
        assert st.bundle["headset"]["hit"][0][0] in new, "headset hit flash"
        assert not any(f.startswith("$GLED,2,2,2") for f in new), "armour-only hit: still the green band"
        # three more hits of 25: armour 70 -> 45 -> 20 -> 0 (hp 40, the low-health alert fires) -> hp 15 (red band)
        for _ in range(3):
            await st.ir("shot"); st.poll(); await settle(st)
        frames = tx(mgr)
        assert st.hp == 15 and st.bundle["cues"]["hurt"] in frames and "$GLED,0,0,0,0,10,,*" in frames
        n = len(frames)
        await st.ir("kill"); st.poll(); await settle(st)
        new = tx(mgr)[n:]
        assert not st.alive and st.tele["hp"] == 0
        # §3.2 (2026-09-07): the firmware's own out-flash is already running -- the node's only headset
        # write at death is the belt-and-braces $HLOOP rearm, once, after the hands-off window.
        assert new.count(st.bundle["headset"]["down"]["rearm"]) == 1, "one down-rearm insurance write"
        # the died burst lands inside a second of the last hit burst, so the one-burst-per-second gate drops it --
        # exactly what engine.js does; the sound (if any) and the headset blink still play
        assert any("event died" in l["text"] or ("died" in l["text"] and "dropped" in l["text"]) for l in st.log)
        n = len(tx(mgr))
        await st.revive(); await settle(st)
        new = tx(mgr)[n:]
        # §3.2: `down.stop` ($HLOOP,0,0,*) is its own write, first, ahead of everything else in revive()
        off = 0
        down_stop = st.bundle["headset"]["down"]["stop"]
        assert new[off] == down_stop, "down stop written before the revive frames"
        off += 1
        # A15.3: a fresh death-scream $PSET (one of `pset_pool`) rides next in the revive write, ahead of the revive frames
        pool = st.bundle.get("pset_pool") or []
        if pool:
            assert new[off] in pool
            off += 1
        assert new[off:off + len(st.bundle["revive"])] == st.bundle["revive"] and st.alive
        assert all(f in new for f in st.bundle["gun"]["take"]) and st._gun_band == st.bundle["gun"]["rest"]   # the take again after the revive
    asyncio.run(run())


def test_ir_words_are_the_bench_derived_ones():
    from brx_mcp.irbridge import decode_word
    w = ir_words("shot", 2)[0]
    d = decode_word(w)
    assert len(w) == 25 and d["team"] == 2 and d["damage"] == 25 and d["proto"] == 0
    assert decode_word(ir_words("emp", 2)[0])["proto"] == 8
    m = ir_words("medic", 2)
    assert len(m) == 2 and decode_word(m[1])["damage"] == 14 and decode_word(m[1])["proto"] == 1
    assert decode_word(ir_words("beacon", 1)[0])["proto"] == 15 and decode_word(ir_words("button", 1)[0])["crit"] == 1
    try:
        ir_words("nuke", 1)
    except ValueError:
        pass
    else:
        raise AssertionError


def test_dry_run_without_a_gun_logs_the_frames_instead_of_failing():
    async def run():
        st, mgr = mk()
        await st.arm(); await st.spawn(); await settle(st)
        st.event("lead_taken"); await settle(st)
        kinds = [l["kind"] for l in st.log]
        assert "tx" in kinds and not tx(mgr)
        await st.ir("emp")
        assert any("no emitter" in l["text"] for l in st.log)
    asyncio.run(run())


def test_walkthrough_is_built_from_the_config_and_records_verdicts():
    async def run():
        saved = []
        mgr = FakeConnectionManager([FakeTagger("FA:KE:00:00:00:01", "FAKE-STAGE", team=1)])
        st = GunStage(mgr, None, sleep=_nosleep, verdict_sink=saved.append)
        await st.connect("FA:KE:00:00:00:01")
        st.set_profile(headset="team", gun="health")
        plan = st.walk_plan()
        ids = [s["id"] for s in plan]
        assert ids[:3] == ["arm", "voice", "spawn"] and "hit" in ids and "death" in ids and "revive" in ids and ids[-2:] == ["end", "end_victory"]
        assert plan[-2]["action"] == "game_end"
        assert "carrier_1" in ids and "carrier_2" in ids and "carrier_off" in ids
        assert "medal_first_blood" in ids and "event_lead_taken" in ids and "event_time_60" in ids
        assert all(s["available"] for s in plan)                     # the fake gun can be shot
        # a silenced game has no medal / announcer steps, LEDs off has no headset steps
        st.set_profile(preset="silenced")
        ids2 = [s["id"] for s in st.walk_plan()]
        assert "medal_first_blood" not in ids2 and "event_lead_taken" not in ids2 and "hit" in ids2
        st.set_profile(preset=None, night=True)
        assert not any(i.startswith("carrier") for i in [s["id"] for s in st.walk_plan()])
        st.set_profile(night=False)
        st.walk_start()
        w = st.state()["walk"]
        assert w["i"] == 0 and w["current"]["id"] == "arm" and w["n"] == len(plan)
        await st.walk_play(); await settle(st)
        assert tx(mgr)[:3] == st.bundle["head"][:3]
        st.walk_verdict(True)
        assert st.state()["walk"]["current"]["id"] == "voice" and saved[-1]["step"] == "arm" and saved[-1]["ok"] is True
        await st.walk_play(); await settle(st)                    # the voice step: one $PLAY of the respawn cry
        assert tx(mgr)[-1] == "$PLAY,,4,6,VAI,,,,*"
        st.walk_verdict(True)
        assert st.state()["walk"]["current"]["id"] == "spawn"
        await st.walk_play(); await settle(st)
        st.walk_verdict(False, "white flash too short")
        assert saved[-1]["ok"] is False and saved[-1]["note"] == "white flash too short" and saved[-1]["gun"] == "health"
        while not st.state()["walk"]["done"]:
            await st.walk_play(); await settle(st); st.poll(); await settle(st)
            st.walk_verdict(None)
        assert st.state()["walk"]["done"] and len(saved) == len(plan)
        assert any("walkthrough done" in l["text"] for l in st.log)
    asyncio.run(run())


def test_poll_never_replays_frames_it_already_handled():
    async def run():
        st, mgr = mk(gun="native")
        await st.connect("FA:KE:00:00:00:01")
        await st.arm(); await st.spawn(); await settle(st); st.poll()
        await st.ir("shot"); st.poll(); await settle(st)
        hits = lambda: sum(1 for l in st.log if l["text"].startswith("event hit_taken") or l["why"].startswith("event led hit_taken") or l["why"] == "event cue hit_taken")
        n = hits()
        assert n >= 1
        st.poll(); st.poll(); await settle(st)
        assert hits() == n, "a second poll must not replay the same $HP"
    asyncio.run(run())


def test_set_emitter_refuses_a_port_that_does_not_pong():
    import brx_mcp.stage.stage as SM

    class Dead:
        def __init__(self, port=None, **_): self.port = port or "COMX"
        def ping(self): return False
        def close(self): pass
    class Live(Dead):
        def ping(self): return True
        def emit(self, bits, repeat=1): return "TX ok"

    import brx_mcp.irbridge as IB
    real = IB.IRBridge
    try:
        IB.IRBridge = Dead
        st, _ = mk()
        try:
            st.set_emitter("COM3")
        except ValueError as e:
            assert "PING" in str(e)
        else:
            raise AssertionError("a silent port was accepted as the emitter")
        assert st.bridge is None and any("did not answer PING" in l["text"] for l in st.log)
        IB.IRBridge = Live
        st.set_emitter("COM8")
        assert st.bridge is not None and st.state()["link"]["emitter"] == "COM8"
        st.set_emitter(None)
        assert st.bridge is None
    finally:
        IB.IRBridge = real


def test_a_dropped_link_is_noticed_and_a_write_reconnects_once():
    async def run():
        st, mgr = mk()
        await st.connect("FA:KE:00:00:00:01")
        mgr.drop("stage")                                        # the gun went away under us
        assert st.poll() == [] and st.connected is False
        assert any("dropped the BLE link" in l["text"] for l in st.log)
        st.connected = True                                      # the page still thinks it is linked; a write must self-heal
        calls = {"n": 0}
        real_send = mgr.send
        async def flaky(alias, cmd, reply_window_ms=0):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("Not connected")
            return await real_send(alias, cmd, reply_window_ms=reply_window_ms)
        mgr.send = flaky
        await st.arm()
        assert st.connected and any("reconnected" in l["text"] for l in st.log)
        assert tx(mgr)[:2] == st.bundle["head"][:2]
    asyncio.run(run())


def test_raw_writes_only_known_safe_frames():
    async def run():
        st, mgr = mk()
        await st.connect("FA:KE:00:00:00:01")
        await st.raw(["$GLED,,,,5,,,*", "$GLED,1,1,1,0,10,,*"])
        assert tx(mgr)[-2:] == ["$GLED,,,,5,,,*", "$GLED,1,1,1,0,10,,*"]
        try:
            await st.raw(["$FORMAT,*"])
        except ValueError as e:
            assert "known-safe" in str(e)
        else:
            raise AssertionError("an unknown command went to the gun")
        await st.raw(["$CHASE,3,*"], confirm=True)                # explicit confirm: sent and logged as UNKNOWN ($BLINK/$LED are safe-listed since 2026-09-04)
        assert tx(mgr)[-1] == "$CHASE,3,*" and any(l["text"].startswith("UNKNOWN command") for l in st.log)
    asyncio.run(run())


def test_ir_registers_reflects_the_games_sir_table():
    st, _ = mk()
    r = st.ir_registers()
    assert r["shot"]["registers"] and r["kill"]["registers"]              # proto 0 rows are in every head
    assert r["emp"]["registers"], r                                          # $SIR,8,0,,38: an EMP word lands as PLAIN damage today (F15 = make it a stun)
    assert not r["medic"]["registers"] and not r["beacon"]["registers"], r  # no proto 1 / 15 rows: ignored until F15 / B23


def test_kill_button_plays_the_top_medals_lights_too():
    async def run():
        st, mgr = mk()
        await st.connect("FA:KE:00:00:00:01")
        await st.arm(); await st.spawn(); await settle(st)
        n = len(tx(mgr))
        st.kill(["first_blood"]); await settle(st)
        new = tx(mgr)[n:]
        assert "$LED,9,1,1,1,*" in new and st.bundle["cues"]["first_blood"] in new
    asyncio.run(run())


def test_down_writes_nothing_at_death_one_rearm_insurance_then_stops_before_revive():
    """§3.2 (2026-09-07 bench, led-language.md): the A11.8 small-LED pulse scheme is retired -- the
    firmware's own out-flash runs on its own for the whole life. The node's only headset traffic while
    down is ONE belt-and-braces `$HLOOP` rearm after the hands-off window, and `$HLOOP,0,0,*` before the
    next `$SPAWN` (both are insurance: `$SPAWN` clears the loop by itself too)."""
    async def run():
        st, mgr = mk()
        await st.connect("FA:KE:00:00:00:01")
        await st.arm(); await st.spawn(); await settle(st); st.poll()
        down = st.bundle["headset"]["down"]
        assert down == {"rearm": "$HLOOP,2,750,*", "stop": "$HLOOP,0,0,*", "rearm_after_ms": 2500}
        n = len(tx(mgr))
        await st.ir("kill"); st.poll(); await settle(st)
        assert not st.alive
        new = tx(mgr)[n:]
        assert new.count(down["rearm"]) == 1, "exactly one rearm write, no repeating pulse"
        n = len(tx(mgr)); await settle(st)
        assert len(tx(mgr)) == n, "the rearm does not repeat while still down"
        await st.revive(); await settle(st)
        assert down["stop"] in tx(mgr)[n:], "down stop written before the revive frames"
        n = len(tx(mgr)); await settle(st)
        assert len(tx(mgr)) == n, "alive again: nothing keeps firing"
    asyncio.run(run())


# --- the VOICE (Tony 2026-09-06: pick the voice, see what it drives, play its hit sounds + personality moments) ---
def _pset(st):
    return next(f for f in st.bundle["head"] if f.startswith("$PSET,"))


def test_the_voice_pick_drives_the_pset_tail_and_the_kill_cue():
    st, _ = mk()
    assert st.profile["voice"] == "male" and st.state()["voice"]["speaker"] == "Male player"
    st.set_profile(voice="heavy")
    assert ",V33,,,,,V37," in _pset(st)          # A15.3: the cry AND the three pain fields are EMPTY (the node plays them)
    assert st.bundle["cues"]["kill"] == "$PLAY,,4,6,V3A,,,,*"
    assert st.log[-1]["kind"] == "warn" and "re-ARM" in st.log[-1]["text"]
    v = st.state()["voice"]
    assert v["id"] == "heavy" and v["family"] == "V3" and v["speaker"] == "Heavy" and v["kill"] == "V3A"
    assert v["pset"] == {"death_scream": "V33", "respawn_cry": "", "melee_grunt": "", "short_pain": "", "long_pain": "", "pain_relief": "V37"}
    lines = {l["id"]: l for l in v["lines"]}
    assert "pset:death_scream" in lines["V33"]["uses"] and "cue:kill" in lines["V3A"]["uses"]
    assert lines["V31"]["group"] == "personality" and lines["V3C"]["group"] == "hit"
    assert v["sound_roles"] and "boast" in v["sound_roles"]
    assert any(o["id"] == "heavy" and o["verified"] for o in st.state()["voices"])
    for bad in ({"voice": "robot"}, {"voice_slots": {"nope": "V33"}}, {"voice_slots": {"death_scream": "ZZZ9"}}):
        try:
            st.set_profile(**bad)
        except ValueError:
            pass
        else:
            raise AssertionError(f"accepted {bad}")


def test_a_voice_slot_pick_changes_the_pset_and_the_kill_cue_and_a_new_voice_clears_it():
    st, _ = mk(voice="heavy")
    st.set_voice_slot("death_scream", "V34")
    assert ",V34,,,,,V37," in _pset(st), _pset(st)          # needs compile() to honour player["voice_slots"] (voice-core)
    assert st.state()["voice"]["pset"]["death_scream"] == "V34"
    st.set_voice_slot("kill", "V38")
    assert st.bundle["cues"]["kill"] == "$PLAY,,4,6,V38,,,,*"   # needs cues(voice, slots) (voice-core)
    assert st.state()["voice"]["kill"] == "V38"
    st.set_voice_slot("death_scream", None)
    assert ",V33,,,,,V37," in _pset(st)
    st.set_profile(voice="medic")
    assert st.profile["voice_slots"] == {} and st.state()["voice"]["kill"] == "V8S"
    try:
        st.set_voice_slot("kill", "NOPE")
    except ValueError:
        pass
    else:
        raise AssertionError("an id that is not on the gun was accepted")


def test_a_voice_line_is_written_to_the_gun_and_a_bad_id_is_refused():
    async def go():
        st, mgr = mk(voice="heavy")
        await st.connect("FA:KE:00:00:00:01")
        await st.voice_line("V3I")
        assert tx(mgr)[-1] == "$PLAY,,4,6,V3I,,,,*"
        assert "boast" in st.log[-1]["why"] and "Get some" in st.log[-1]["why"]
        try:
            await st.voice_line("NOPE")
        except ValueError:
            pass
        else:
            raise AssertionError("NOPE was played")
    asyncio.run(go())


def test_the_event_catalog_says_which_events_the_voice_drives():
    st, _ = mk(voice="heavy")
    rows = {r["event"]: r for r in st.event_catalog()}
    assert rows["kill"]["sound"] == "voice:kill" and rows["kill"]["voice_id"] == "V3A" and rows["kill"]["voice_words"]
    fw = {f["role"]: f for f in rows["died"]["firmware"]}
    assert fw["death_scream"]["id"] == "V33" and fw["death_scream"]["field"] == "deathScream"
    # A15.3: the three pain fields now ship EMPTY (the node plays pain_short/pain_long/pain_melee itself by
    # damage), so hit_taken carries no $PSET firmware reaction at all any more -- same shape as respawned since A15.2
    assert "firmware" not in rows["hit_taken"]
    assert rows["healed"]["firmware"][0]["id"] == "V37"
    assert "firmware" not in rows["respawned"] and rows["respawned"]["voice_id"] == "V3I"   # A15.2: the firmware plays nothing at spawn; the line is voice:spawn
    assert "firmware" not in rows["first_blood"]


def test_the_walkthrough_has_a_voice_step_after_arm():
    st, _ = mk(voice="scout")
    ids = [s["id"] for s in st.walk_plan()]
    assert ids[:2] == ["arm", "voice"]
    step = st.walk_plan()[1]
    assert step["action"] == "voice_line" and step["args"] == {"id": "VBI"} and "SCOUT" in step["title"]


# --- the SOUNDBOARD (Tony: "act as the character selection and let me hear and test all of these") ---
def test_the_board_picks_any_character_without_touching_the_game_voice():
    st, _ = mk(voice="heavy")
    st.voice_board("scout")
    b = st.state()["board"]
    assert b["voice"] == "scout" and b["family"] == "VB" and b["speaker"] == "Scout (female)" and b["is_game_voice"] is False
    assert len(b["lines"]) == 22 and st.profile["voice"] == "heavy" and ",V33,,,,,V37," in _pset(st)
    assert any("pset:death_scream" in l["uses"] for l in b["lines"])      # badges = the family's default for each $PSET field
    st.set_profile(voice="scout")
    assert st.state()["board"]["is_game_voice"] and any("cue:kill" in l["uses"] for l in st.state()["board"]["lines"])
    try:
        st.voice_board("robot")
    except ValueError:
        pass
    else:
        raise AssertionError("robot accepted")


def test_play_all_walks_every_line_in_slot_order_and_stop_cancels_it():
    async def go():
        st, mgr = mk(voice="heavy")
        await st.connect("FA:KE:00:00:00:01")
        st.voice_board_play("medic")
        assert st.board_voice == "medic"
        await settle(st)
        played = [f for f in tx(mgr) if f.startswith("$PLAY,,4,6,V8")]
        ids = [f.split(",")[4] for f in played]
        assert ids[:3] == ["V81", "V82", "V83"] and len(ids) == len(st.board_lines()) and st.board_playing is None
        assert any(l["text"].startswith("board V81 intro:") for l in st.log)
        # stop: a slow sleep keeps the run pending; STOP bumps the generation and the loop exits
        gate = asyncio.Event()
        async def slow(_s):
            await gate.wait()
        st.sleep = slow
        st.voice_board_play("fury", from_slot="C")
        await asyncio.sleep(0)
        assert st.board_playing == "V0C"
        st.voice_board_stop()
        gate.set()
        await settle(st)
        assert st.board_playing is None and not any(f.endswith("V0D,,,,*") for f in tx(mgr))
    asyncio.run(go())


def test_line_verdicts_are_saved_and_shown_per_character():
    saved = []
    st, _ = mk()
    st.voice_verdict_sink = saved.append
    st.voice_verdict("scout", "VB3", False, "that is a laugh, not a scream")
    st.voice_verdict("scout", "VBI", True)
    rec = saved[0]
    assert rec["voice"] == "scout" and rec["family"] == "VB" and rec["id"] == "VB3" and rec["slot"] == "3" and rec["role"] == "death_scream" and rec["ok"] is False and rec["note"]
    assert st.state()["voice_verdicts"]["scout"] == {"VB3": {"ok": False, "note": "that is a laugh, not a scream"}, "VBI": {"ok": True, "note": ""}}
    st.voice_board("scout")
    assert st.state()["board"]["verdicts"]["VB3"]["ok"] is False
    st.voice_verdict("scout", "VB3", None)                                 # cleared
    assert "VB3" not in st.state()["voice_verdicts"]["scout"]
    for bad in (("scout", "V33", True), ("robot", "VB3", True), ("scout", "VB3", "yes")):
        try:
            st.voice_verdict(*bad)
        except ValueError:
            pass
        else:
            raise AssertionError(f"accepted {bad}")


# ---- A15: the $PSET roll on ARM and the per-kill cue-pool pick (Tony 2026-09-06) --------------------------------
def _pset_of(mgr):
    return [f for f in tx(mgr) if f.startswith("$PSET,")][-1]      # the LAST arm's $PSET


def _mk_rng(seed, **profile):
    import random
    mgr = FakeConnectionManager([FakeTagger("FA:KE:00:00:00:01", "FAKE-STAGE", team=1)])
    st = GunStage(mgr, None, sleep=_nosleep, voice_verdict_sink=lambda _r: None, rng=random.Random(seed))
    if profile:
        st.set_profile(**profile)
    return st, mgr


def test_arm_rolls_the_pset_takes_and_a_pinned_slot_survives_the_roll():
    """"they are all equal and should be picked at random to make the sounds more dynamic" -- the death scream is
    drawn from the family's equal takes on EVERY arm; a picker pin wins. A15.3 narrows the roll to death_scream
    alone (the cry and the three pain fields ship empty and are never rolled -- the node plays them itself)."""
    import random
    st, mgr = _mk_rng(1, voice="heavy")
    assert st.rolled == {} and st.state()["voice"]["rolled"] == {}
    asyncio.run(_arm(st))
    pset = _pset_of(mgr).split(",")
    scream, cry, melee, short, long_ = pset[10], pset[11], pset[12], pset[13], pset[14]
    assert scream in ("V33", "V34", "V35") and cry == melee == short == long_ == "", pset
    assert st.rolled == {"death_scream": scream}, st.rolled     # A15.3: the only field left to roll
    assert any(l["text"].startswith("rolled: death scream ") and scream in l["text"] for l in st.log), [l["text"] for l in st.log]
    v = st.state()["voice"]
    assert v["rolled"] == st.rolled and v["pools"]["death_scream"] == ["V33", "V34", "V35"]
    # different seeds can land on different takes (the draw is real): 40 seeds cover more than one scream
    seen = set()
    for seed in range(40):
        s2, m2 = _mk_rng(seed, voice="heavy"); asyncio.run(_arm(s2)); seen.add(_pset_of(m2).split(",")[10])
    assert len(seen) > 1, seen
    # a pinned slot is never rolled over
    st.set_voice_slot("death_scream", "V35")
    for _ in range(5):
        asyncio.run(_arm(st))
        assert _pset_of(mgr).split(",")[10] == "V35" and "death_scream" not in st.rolled
    # the Male player's spawn line is OURS since A15.2: the cry field stays empty, VAI / VAN / VAO are the spawn pool
    s3, m3 = _mk_rng(0, voice="male"); asyncio.run(_arm(s3))
    assert _pset_of(m3).split(",")[11] == "" and [x["id"] for x in s3.state()["voice"]["spawn"]] == ["VAI", "VAN", "VAO"]


async def _arm(st):
    if not st.connected:
        await st.connect("FA:KE:00:00:00:01")
    await st.arm()
    await settle(st)


def test_reroll_draws_again_without_writing_and_a_voice_change_clears_the_roll():
    st, mgr = _mk_rng(3, voice="heavy")
    asyncio.run(_arm(st))
    n = len(tx(mgr))
    st.reroll()
    assert len(tx(mgr)) == n, "REROLL writes nothing"
    assert st.log[-1]["text"].startswith("rolled: ") and "written to the gun on ARM" in st.log[-1]["text"]
    assert st.rolled and st.state()["voice"]["rolled"] == st.rolled
    st.set_profile(voice="scout")
    assert st.rolled == {}, "the roll belonged to the old family"


def test_a_kill_and_the_kill_event_play_one_random_take_of_the_pool_and_name_it():
    """"the kill confirm sound and taunts should be selected on single kill at random" -- five takes for Heavy."""
    st, mgr = _mk_rng(7, voice="heavy")
    pool = st.bundle["cue_pools"]["kill"]
    assert len(pool) == 5 and st.bundle["cues"]["kill"] in pool
    assert [x["id"] for x in st.state()["voice"]["cue_pools"]["kill"]] == ["V3A", "V38", "V39", "V3K", "V3L"]

    async def run():
        await _arm(st)
        picks = set()
        for _ in range(30):
            n = len(tx(mgr))
            st.kill(); await settle(st)
            new = tx(mgr)[n:]
            assert new[0] == "$SFLASH,*" and new[1] in pool, new
            picks.add(new[1])
            why = next(l["why"] for l in reversed(st.log) if l["text"] == new[1])
            assert why.startswith("kill (") and new[1].split(",")[4] in why, why
        assert len(picks) > 1, "the pick is random, not always cues['kill']"
        n = len(tx(mgr)); st.event("kill"); await settle(st)
        assert tx(mgr)[n] in pool and next(l["why"] for l in reversed(st.log) if l["text"] == tx(mgr)[n]).startswith("event cue kill (")
        # medal stacks are announcer lines: untouched by the pool
        n = len(tx(mgr)); st.kill(["first_blood"]); await settle(st)
        assert tx(mgr)[n + 1] == st.bundle["cues"]["first_blood"]
        # an event without a pool plays its single cue, and a muted profile plays nothing from the pool
        n = len(tx(mgr)); st.event("game_over"); await settle(st)
        assert tx(mgr)[n] == st.bundle["cues"]["game_over"]
        st.set_profile(preset="silenced")
        assert st.bundle["cues"]["kill"] == ""
        n = len(tx(mgr)); st.kill(); await settle(st)
        assert tx(mgr)[n:] == ["$SFLASH,*"], tx(mgr)[n:]
    asyncio.run(run())


# --- A15.2: the spawn line is OURS (Tony, bench 2026-09-06: an empty $PSET cry field silences the firmware; $SPAWN then
# $PLAY in the same write plays clean; "what if we dont rely on the firmware to make the sound on spawn and we just control it") ---
def _voice_plays(frames):
    return [f for f in frames if f.startswith("$PLAY,,4,6,")]


def test_spawn_plays_one_take_of_the_spawn_pool_and_the_pset_cry_field_is_empty():
    """Male player: VAI / VAN / VAO, one at random right after $SFLASH, in the SAME write; the head's $PSET carries an
    EMPTY battleRespawnCry so the firmware says nothing (depends on the compiler shipping cues/cue_pools["spawn"])."""
    st, mgr = _mk_rng(2, voice="male")
    asyncio.run(_arm(st))
    pset = _pset_of(mgr).split(",")
    assert pset[11] == "", f"battleRespawnCry must be empty, got {pset[11]!r} in {_pset_of(mgr)}"
    pool = st.bundle["cue_pools"]["spawn"]
    assert len(pool) == 3 and {p.split(",")[4] for p in pool} == {"VAI", "VAN", "VAO"}, pool
    assert [x["id"] for x in st.state()["voice"]["spawn"]] == [p.split(",")[4] for p in pool]

    # A15.3: a fresh death-scream $PSET (one of `pset_pool`) now rides FIRST in the same write, ahead of $PLAYX
    scream_pool = st.bundle.get("pset_pool") or []
    prefix = (1 if scream_pool else 0) + len(st.bundle["spawn"])       # [$PSET?] $PLAYX,0 $SPAWN $AMMO $AMMO $BMAP

    async def run():
        seen = set()
        for _ in range(12):
            await st.spawn(); await settle(st)
            all_ = tx(mgr)
            i = len(all_) - 1 - all_[::-1].index("$SFLASH,*")          # the LAST spawn write (the fake's log is a ring)
            new = all_[i - prefix:]                                    # [$PSET?] $PLAYX,0 $SPAWN $AMMO $AMMO $BMAP $SFLASH <take> …
            if scream_pool:
                assert new[0] in scream_pool
            assert new[prefix - len(st.bundle["spawn"]):prefix] == st.bundle["spawn"] and new[prefix] == "$SFLASH,*", new
            i = prefix
            assert new[i + 1] in pool, new
            assert _voice_plays(new) == [new[i + 1]], "exactly one spawn line per spawn"
            why = next(l["why"] for l in reversed(st.log) if l["text"] == new[i + 1])
            assert "spawn line (" in why and new[i + 1].split(",")[4] in why, why    # A15.3: "spawn + scream Vxx N/3 + spawn line (…)"
            seen.add(new[i + 1])
        assert len(seen) > 1, "the take is drawn per spawn, not fixed per arm"
    asyncio.run(run())
    # a family with ONE take (Heavy: V3I) plays that one every time, no pool entry needed
    st2, m2 = _mk_rng(2, voice="heavy")
    asyncio.run(_arm(st2))
    p2 = _pset_of(m2).split(",")
    assert p2[11] == "" and p2[12] == "" and p2[10] in ("V33", "V34", "V35"), p2      # `,V3x,,,,,`: the cry AND melee_grunt fields are empty (A15.3)
    assert "spawn" not in (st2.bundle.get("cue_pools") or {}) and st2.bundle["cues"]["spawn"] == "$PLAY,,4,6,V3I,,,,*"
    assert [x["id"] for x in st2.state()["voice"]["spawn"]] == ["V3I"]

    async def run2():
        await st2.spawn(); await settle(st2)
        all_ = tx(m2); i = len(all_) - 1 - all_[::-1].index("$SFLASH,*"); new = all_[i - 5:]
        assert new[new.index("$SFLASH,*") + 1] == "$PLAY,,4,6,V3I,,,,*" and _voice_plays(new) == ["$PLAY,,4,6,V3I,,,,*"]
    asyncio.run(run2())


def test_revive_writes_exactly_one_spawn_line_in_the_revive_write():
    st, mgr = _mk_rng(5, voice="male")
    asyncio.run(_arm(st))
    pool = st.bundle["cue_pools"].get("respawned") or [st.bundle["cues"]["respawned"]]

    async def run():
        await st.spawn(); await settle(st)
        for _ in range(8):
            await st.revive(); await settle(st)
            all_ = tx(mgr)
            i = len(all_) - 1 - all_[::-1].index("$SPAWN,,*")           # the LAST revive write (the fake's log is a ring)
            new = all_[i:]
            plays = _voice_plays(new)
            assert len(plays) == 1 and plays[0] in pool, f"one spawn line per revive, got {plays} in {new}"
            assert new.index(plays[0]) == len(st.bundle["revive"]), "the take rides in the revive write, right after its frames"
            why = next(l["why"] for l in reversed(st.log) if l["text"] == plays[0])
            assert "spawn line (" in why, why    # A15.3: "revive + scream Vxx N/3 + spawn line (…)" -- a fresh death scream now rides ahead too
            assert any(l["why"] == "event led respawned" for l in st.log), "the respawned burst still plays (lights only)"
    asyncio.run(run())
    # the walkthrough's voice step plays the first spawn take (the family's boast)
    step = st.walk_plan()[1]
    assert step["id"] == "voice" and step["args"] == {"id": "VAI"}
