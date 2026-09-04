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
    st = GunStage(mgr, None, sleep=_nosleep)
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
        assert st.bundle["cues"][ev1] in new
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
        assert st.bundle["headset"]["death"][0][0] in new, "death blink"
        # the died burst lands inside a second of the last hit burst, so the one-burst-per-second gate drops it --
        # exactly what engine.js does; the sound (if any) and the headset blink still play
        assert any("event died" in l["text"] or ("died" in l["text"] and "dropped" in l["text"]) for l in st.log)
        n = len(tx(mgr))
        await st.revive(); await settle(st)
        new = tx(mgr)[n:]
        assert new[:len(st.bundle["revive"])] == st.bundle["revive"] and st.alive
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
        assert ids[:2] == ["arm", "spawn"] and "hit" in ids and "death" in ids and "revive" in ids and ids[-2:] == ["end", "end_victory"]
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
        assert st.state()["walk"]["current"]["id"] == "spawn" and saved[-1]["step"] == "arm" and saved[-1]["ok"] is True
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
        await st.raw(["$BLINK,3,*"], confirm=True)                # explicit confirm: sent and logged as UNKNOWN
        assert tx(mgr)[-1] == "$BLINK,3,*" and any(l["text"].startswith("UNKNOWN command") for l in st.log)
    asyncio.run(run())


def test_ir_registers_reflects_the_games_sir_table():
    st, _ = mk()
    r = st.ir_registers()
    assert r["shot"]["registers"] and r["kill"]["registers"]              # proto 0 rows are in every head
    assert r["emp"]["registers"], r                                          # $SIR,8,0,,38: an EMP word lands as PLAIN damage today (F15 = make it a stun)
    assert not r["medic"]["registers"] and not r["beacon"]["registers"], r  # no proto 1 / 15 rows: ignored until F15 / B23
