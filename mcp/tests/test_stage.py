"""The GUN STAGE (brx_mcp/stage): every button plays the compiled bundle's frames; the fake gun proves the loop."""
from __future__ import annotations

import asyncio
import time

from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.stage.stage import GunStage, ir_words
from brx_mcp.mc import presentation as P
from brx_mcp import poolgauge as PG


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
    # 2026-09-07: untouched, the selector shows whatever the "standard" preset's OWN gun.in_play
    # resolves to (GUN_DEFAULT is "team", Tony 2026-09-09) -- not a stage.py literal that can go stale under it.
    assert st.profile["gun"] == "team" and st.bundle["gun"]["in_play"] == "team"
    names = {e["event"] for e in st.event_catalog()}
    assert names == set(P.EVENTS)
    st.set_profile(gun="health", headset="team", preset="silenced", night=False)
    assert st.bundle["gun"]["in_play"] == "health" and st.bundle["gun"]["take"][0] == "$GLED,,,,5,,,*"
    assert st.bundle["headset"]["in_play"] == "team"
    assert st.bundle["presentation"]["announcer"] is False       # silenced preset carried into the summary
    st.set_profile(mode="infection")
    assert st.config["mode"] == "infection" and st.bundle["presentation"]["preset"] == "custom"   # gun/headset edits still applied over the mode preset
    # infection's own preset gun/headset are both GUN_DEFAULT/HEADSET_DEFAULT ("team"/"dark") --
    # explicitly picking those SAME values must still read as "infection", not "custom", because it
    # is genuinely not a customisation any more, only a touched selector that happens to agree.
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
    # A16.4 (2026-09-09): the in-play rest is DIM (`PG.BRIGHT_DIM`), not the full-brightness pregame paint.
    assert st.bundle["gun"]["take"] == ["$GLED,,,,5,,,*", f"$GLED,1,1,1,0,{PG.BRIGHT_DIM},,*"] and not any(f.startswith("$GLED") for f in st.bundle["spawn"])
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
        # A16 §3.3: carrier is ONE flat WHITE role now (never the flag's team colour, finding #11) --
        # `tid` says WHOSE flag for bookkeeping (`st.carrying`), it does not change the frame.
        st.headset("carrier", tid=2); await settle(st)
        assert tx(mgr)[n] == st.bundle["headset"]["role"]["carrier"][0][0] and st.carrying == 2
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
        # A16 §3.1/§5: "hit_taken" carries no default gun/headset burst any more -- the transient pool
        # readout is the feedback for a pool change now (led-language.md §6 finding #5). One throwaway
        # hit first: the fake tagger's own shield field holds the GameConfig's default max (70,
        # "inactive until activated", gameconfig.py) the whole time, but the stage forces its OWN
        # shield tracking to 0 right after spawn (engine.js `_afterSpawn`) -- the FIRST real $HP syncs
        # it back up to 70, which reads as a pool GAIN masking that hit's own damage (a real node would
        # see the same first-life blip). The assertions below start from the second hit, past it.
        await st.ir("shot"); st.poll(); await settle(st)
        assert st.tele["last_hir"] and st.tele["armor"] == 45
        n = len(tx(mgr))
        await st.ir("shot"); st.poll(); await settle(st)
        new = tx(mgr)[n:]
        assert st.tele["hp"] == 45 and st.tele["armor"] == 20
        assert st.bundle["headset"]["hit"][0][0] in new, "headset hit flash"
        assert not any(f.startswith("$GLED") for f in new), "armour-only hit: this profile's readout tracks only health, so armour moving alone paints nothing"
        # two more hits of 25: armour 20 -> 0 (hp 40) -> hp 15 (readout: health's yellow band).
        # A17.2: the low-health alert is NOT here any more -- it fires below LOW_HEALTH_HP (15), and 15 is
        # not under 15. It used to fire on the armour->health transition at hp 40, which is what A17.2
        # removed: an alert named "low health" that meant "your armour just failed".
        for _ in range(2):
            await st.ir("shot"); st.poll(); await settle(st)
        frames = tx(mgr)
        assert st.hp == 15 and st.bundle["cues"]["hurt"] not in frames, "15 HP is not UNDER 15"
        assert "$GLED,2,2,9,0,10,,*" in frames, "the readout painted the health pool's yellow band"
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
        # A16 §3.3: carrier is now ONE flat WHITE role (never the flag's team colour, finding #11), not
        # a step per team; infected is still per-team (the one role whose colour is a team fact).
        assert "carrier" in ids and "carrier_off" in ids and "infected_1" in ids and "infected_2" in ids
        assert "medal_first_blood" in ids and "event_lead_taken" in ids and "event_time_60" in ids
        assert all(s["available"] for s in plan)                     # the fake gun can be shot
        # a silenced game has no medal / announcer steps; blackout (the EXPLICIT "no lights" switch --
        # night is a dim/short-hold overlay now, not a second blackout, led-language.md §4 finding #2)
        # has no headset steps
        st.set_profile(preset="silenced")
        ids2 = [s["id"] for s in st.walk_plan()]
        assert "medal_first_blood" not in ids2 and "event_lead_taken" not in ids2 and "hit" in ids2
        st.set_profile(preset=None)
        st.patch_presentation({"blackout": True})
        assert not any(i.startswith("carrier") or i.startswith("infected") for i in [s["id"] for s in st.walk_plan()])
        st.patch_presentation({"blackout": False})
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
        st.patch_presentation({"headset": {"hit": "red"}})   # hit_taken carries no default reaction any more (A16 §6 finding #5): give it one to prove the dedup
        await st.connect("FA:KE:00:00:00:01")
        await st.arm(); await st.spawn(); await settle(st); st.poll()
        await st.ir("shot"); st.poll(); await settle(st)   # priming hit: past the first-life shield-sync blip, see test_an_ir_hit_on_the_fake_gun_...
        hits = lambda: sum(1 for l in st.log if l["why"] == "headset hit")
        n = hits()
        await st.ir("shot"); st.poll(); await settle(st)
        assert hits() > n, "the hit must have reacted"
        n = hits()
        st.poll(); st.poll(); await settle(st)
        assert hits() == n, "a second poll must not replay the same $HP"
    asyncio.run(run())


# --- 2026-09-07 (Tony at the bench: "seconds after hit it plays and the led changes ... it looks broken")
# -- the stage must react to a hit like the real node (app/src/engine.js): the instant a BLE notification
# decodes the frame, not on its next poll tick. These drive `_on_frame` directly with the fake gun's OWN
# `BufferedEvent`s (exactly what `ble.ConnectionManager.connect(on_frame=...)` hands it) and use the REAL
# clock/sleep (no `sleep=_nosleep`, no `mk()`), so the measured latency means something.
def _hit_via_on_frame(st, mgr, alias="stage"):
    """Inject one IR hit on the fake tagger and feed its new rx frame(s) straight into `st._on_frame`,
    exactly as the real BLE notify path would -- bypassing poll() entirely. Returns the new tx frames
    written by the time this returns (nothing has awaited yet, so this is the SYNCHRONOUS part only)."""
    s = mgr.sessions[alias]
    n0 = s.seq
    mgr.inject_hit(alias, st.enemy_tid())
    for e in list(s.buffer):
        if e.seq > n0:
            st._on_frame(e)
    return n0


def test_a_hit_reacts_the_instant_its_frame_decodes_not_on_the_next_poll_tick():
    async def run():
        mgr = FakeConnectionManager([FakeTagger("FA:KE:00:00:00:01", "FAKE-STAGE", team=1)])
        st = GunStage(mgr, None, voice_verdict_sink=lambda _r: None)   # the REAL sleep/clock, not the test double
        st.patch_presentation({"headset": {"hit": "red"}})
        await st.connect("FA:KE:00:00:00:01")
        await st.arm()
        st.bundle["cues"]["countdown"] = ""    # this test is about the HIT path, not the spawn countdown wait
        await st.spawn(); await settle(st)
        s = mgr.sessions["stage"]
        t0 = time.monotonic()
        n0 = _hit_via_on_frame(st, mgr)
        await asyncio.sleep(0)                 # ONE turn of the loop -- enough for a spawned task to run to its first await
        dt = time.monotonic() - t0
        new_tx = [e.raw for e in s.buffer if e.seq > n0 and e.direction == "tx"]
        assert new_tx, "no reaction was written on the very next loop tick after the hit's frame decoded"
        assert dt < 0.1, f"{dt * 1000:.1f} ms from the rx frame to the first reaction write -- should be near-instant"
    asyncio.run(run())


def test_latency_does_not_grow_under_rapid_fire_and_an_in_flight_burst_never_delays_the_next_hit():
    """Regression for the bug itself: fire several hits close together (each still inside the previous
    one's hardware-tuned LED-burst hold, EVENT_MIN_GAP_S/PAIN_GAP_S), on a stage with real holds, and prove
    every one still gets an IMMEDIATE reaction write -- a burst in flight (its `await self.sleep(hold)`)
    must never delay seeing or reacting to the next incoming frame."""
    async def run():
        mgr = FakeConnectionManager([FakeTagger("FA:KE:00:00:00:01", "FAKE-STAGE", team=1)])
        st = GunStage(mgr, None, voice_verdict_sink=lambda _r: None)
        st.patch_presentation({"headset": {"hit": "red"}})
        await st.connect("FA:KE:00:00:00:01")
        await st.arm()
        st.bundle["cues"]["countdown"] = ""
        await st.spawn(); await settle(st)
        s = mgr.sessions["stage"]
        deltas = []
        for _ in range(4):
            t0 = time.monotonic()
            n0 = _hit_via_on_frame(st, mgr)
            await asyncio.sleep(0)
            new_tx = [e.raw for e in s.buffer if e.seq > n0 and e.direction == "tx"]
            deltas.append(time.monotonic() - t0)
            assert new_tx, "every hit must write something immediately, even while an earlier burst is still holding"
            await asyncio.sleep(0.02)          # hits 20 ms apart -- well inside a still-running burst's holds
        assert max(deltas) < 0.1, f"latency grew under rapid fire: {[round(d * 1000) for d in deltas]} ms"
        await settle(st)                       # drain the in-flight bursts so the loop is clean for the next test
    asyncio.run(run())


def test_poll_does_not_re_react_to_a_frame_the_instant_callback_already_handled():
    """`_on_frame` (the instant path) and `poll()` (the fallback/reconciler the fake gun relies on) must
    never BOTH react to the same rx frame -- `_reacted_seq` is the single gate both paths check."""
    async def run():
        st, mgr = mk(gun="native")
        st.patch_presentation({"headset": {"hit": "red"}})   # hit_taken carries no default reaction any more (A16 §6 finding #5): give it one to prove the dedup
        await st.connect("FA:KE:00:00:00:01")
        await st.arm(); await st.spawn(); await settle(st); st.poll()
        _hit_via_on_frame(st, mgr); await settle(st)   # priming hit: past the first-life shield-sync blip, see test_an_ir_hit_on_the_fake_gun_...
        hits = lambda: sum(1 for l in st.log if l["why"] == "headset hit")
        n = hits()
        _hit_via_on_frame(st, mgr)             # the instant path reacts first; poll() has not run yet
        await settle(st)
        assert hits() > n, "the instant callback must have reacted on its own, with no poll() at all"
        n = hits()
        st.poll(); st.poll(); await settle(st)  # poll()'s cursor still lags behind these frames -- it WILL see them
        assert hits() == n, "poll() must not react a second time to a frame _on_frame already handled"
    asyncio.run(run())


def test_spawn_waits_the_countdown_lead_before_the_burst_and_skips_the_wait_with_no_countdown_cue():
    """start-sequence.md §2 (Tony, bench 2026-09-07: 'the gun announced 3...2... and then was cut off'):
    `cues.countdown` must finish (COUNTDOWN_LEAD_S) before the spawn burst's own $PLAYX/$PLAY can cut it
    off -- and a bundle with nothing configured in `cues.countdown` must not wait at all."""
    async def run():
        calls: list[float] = []
        async def spy_sleep(s):
            calls.append(s)
        st, mgr = mk()
        st.sleep = spy_sleep
        await st.connect("FA:KE:00:00:00:01")
        await st.arm()
        assert st.bundle["cues"].get("countdown"), "sanity: this profile really has a countdown cue"
        await st.spawn()
        assert calls[0] == GunStage.COUNTDOWN_LEAD_S, "the lead wait must happen, and before anything else awaited in spawn()"
        frames = tx(mgr)
        i_cd = frames.index(st.bundle["cues"]["countdown"])
        i_spawn0 = frames.index(st.bundle["spawn"][0])
        assert i_cd < i_spawn0, "the countdown cue must be written before the spawn burst, not after"
        await settle(st)
        calls.clear()
        st.bundle["cues"]["countdown"] = ""    # a bundle with nothing configured here (e.g. a muted profile)
        await st.spawn()
        assert GunStage.COUNTDOWN_LEAD_S not in calls, "no countdown cue: nothing to wait for, so no lead wait either"
        await settle(st)
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
            # "respawned" carries no default gun/headset LED burst any more (A16 §6 finding #5: a
            # burst here would land inside gun.take's own 2.5 s blank-then-hold and render wrong) --
            # the white double-flash (`headset.respawn`, asserted via `hs.get("respawn")` elsewhere)
            # and this spawn line are the respawn signal now.
    asyncio.run(run())
    # the walkthrough's voice step plays the first spawn take (the family's boast)
    step = st.walk_plan()[1]
    assert step["id"] == "voice" and step["args"] == {"id": "VAI"}


# ---- A16.3: the 7-level pool bar with a drop animation (bar-spec.md, 2026-09-07) --------------------
# The MC lane is landing `gun.readout.pools[].levels` separately (in parallel); until it ships for real,
# these frame strings ("L0".."L6", "L3b" the blink-off variant) stand in for real $GLED syntax so the
# tests read the ANIMATION'S ORDER, not the LED encoding -- `stage.py` never inspects frame contents,
# it only ever writes exactly what the bundle hands it (Node rules: "never compose a frame").
LEVELS7 = [["L0", None], ["L1", "L1b"], ["L2", None], ["L3", "L3b"], ["L4", None], ["L5", "L5b"], ["L6", None]]


def install_levels_readout(st, max_=6, **timing):
    """Patch the stage's already-compiled bundle with a synthetic 7-level `gun.readout` for `health`
    (and a fixed `rest` frame), so the drop/rise animation can be exercised on the bench harness before
    a real compiler ships `levels`. Returns the readout dict (mutate `["pools"]` to add more)."""
    readout = {"pools": [{"pool": "health", "max": max_, "levels": LEVELS7}],
               "hold_s": timing.get("hold_s", 2), "lead_ms": timing.get("lead_ms", 100),
               "blink_gap_ms": timing.get("blink_gap_ms", 200), "step_ms": timing.get("step_ms", 300),
               "blink_ms": timing.get("blink_ms", 400), "min_gap_ms": timing.get("min_gap_ms", 400)}
    st.bundle["gun"]["readout"] = readout
    st.bundle["gun"]["rest"] = "REST"
    return readout


def test_level_for_delegates_to_the_one_shared_poolgauge_formula():
    """A16.3's `clamp(round(fraction * 6), 0, 6)` (floored to 1 while anything is left) lives in exactly
    ONE place, `poolgauge.level_for` -- the node calls it rather than re-deriving it, so its rounding can
    never quietly drift from what MC's `levels` frame table assumes. This proves the delegation, not the
    formula itself (that is `poolgauge`'s own tests to own); it also pins the floor-to-1 rule and the
    exact-zero case since those are the two spots a re-derivation would most likely diverge."""
    st, _ = mk()
    cases = [("health", "hp", 45, 45), ("health", "hp", 45, 30), ("health", "hp", 45, 10),
             ("health", "hp", 45, 1), ("health", "hp", 45, 0), ("armor", "armor", 24, 10),
             ("armor", "armor", 70, 0), ("shield", "shield", 10, 10), ("shield", "shield", 0, 5)]
    for pool, attr, maximum, amount in cases:
        setattr(st, attr, amount)
        entry = {"pool": pool, "max": maximum}
        assert st._level_for(entry, pool) == PG.level_for(amount, maximum), (pool, amount, maximum)
    st.hp = 1
    assert st._level_for({"pool": "health", "max": 45}, "health") == 1, "floor-to-1 while anything is left"
    st.hp = 0
    assert st._level_for({"pool": "health", "max": 45}, "health") == 0


def test_drop_animation_lead_blink_gap_step_down_settle_blink_and_revert():
    async def go():
        st, mgr = mk()
        await st.connect("FA:KE:00:00:00:01")
        await st.arm(); await st.spawn(); await settle(st)
        install_levels_readout(st, hold_s=0.01, lead_ms=1, blink_gap_ms=1, step_ms=1, blink_ms=1)
        st._level_state["health"] = 6                # seed: it was full before this change
        st.hp = 3                                     # max=6 -> level 3 (partial: 1 solid + 2nd blinking)
        n = len(tx(mgr))
        st._readout_paint("health")
        await settle(st)
        new = tx(mgr)[n:]
        assert new[:5] == ["L6", "L0", "L5", "L4", "L3"], new   # lead · blink-gap (all off) · step down
        blink = new[5:-1]
        assert blink and blink[0] == "L3b" and all(f in ("L3", "L3b") for f in blink), blink   # settle-blink starts OFF
        assert new[-1] == "REST"
        assert st._level_state["health"] == 3
    asyncio.run(go())


def test_gain_animation_has_no_lead_and_steps_up_immediately():
    """Review 2026-09-07: `engine.js`'s gain path is `if (to > from) { step(from); return; }` -- no
    lead delay before the first paint, ever. A `lead_ms=1` test would hide a reintroduced `sleep(lead_s)`
    (the ~180 ms default is imperceptible either way under this suite's instant-sleep stub), so this one
    uses realistic, DISTINCT timings (`install_levels_readout`'s own defaults) and records every duration
    actually passed to `sleep()`, asserting `lead_s` is never among them -- a future regression that puts
    the sleep back would fail this even though the test still runs instantly."""
    async def go():
        st, mgr = mk()
        await st.connect("FA:KE:00:00:00:01")
        await st.arm(); await st.spawn(); await settle(st)
        readout = install_levels_readout(st)              # lead_ms=100, blink_gap_ms=200, step_ms=300, blink_ms=400, hold_s=2
        lead_s = readout["lead_ms"] / 1000
        st._level_state["health"] = 2
        st.hp = 6                                          # a heal/shield-style gain, level 2 -> 6
        sleeps: list[float] = []
        real_sleep = st.sleep
        async def recording(s):
            sleeps.append(s)
            await real_sleep(s)
        st.sleep = recording
        n = len(tx(mgr))
        st._readout_paint("health")
        await settle(st)
        new = tx(mgr)[n:]
        assert new == ["L2", "L3", "L4", "L5", "L6", "REST"], new   # straight up -- no blink-off, no re-lighting
        assert "L0" not in new, "a gain never shows the drop's all-off blink"
        assert lead_s not in sleeps, f"a gain must never sleep lead_ms before stepping up -- slept {sleeps}"
    asyncio.run(go())


def test_a16_3_levels_rapid_hits_do_not_replay_the_lead_and_all_off_blink():
    """Review 2026-09-07 (safety): automatic fire is a burst of drops inside one second. Without a
    rate limit, EVERY one of them replays its own all-off blink -- a dark->lit transition each time,
    which `poolgauge.py`'s own docstring already flags as a photosensitivity risk. A change landing
    inside `min_gap_ms` of the last one must skip the lead freeze AND the all-off blink and step
    straight from wherever the strip already is; the steps still carry the damage, the blink never
    carried anything but ceremony."""
    async def go():
        st, mgr = mk()
        await st.connect("FA:KE:00:00:00:01")
        await st.arm(); await st.spawn(); await settle(st)
        install_levels_readout(st, hold_s=0.01, lead_ms=1, blink_gap_ms=1, step_ms=1, blink_ms=10, min_gap_ms=400)
        st._level_state["health"] = 6
        n = len(tx(mgr))
        st.hp = 5                                  # the FIRST hit: nothing to rate-limit against yet
        st._readout_paint("health")
        await settle(st)
        first = tx(mgr)[n:]
        assert first == ["L6", "L0", "L5", "L5b", "REST"], first   # lead + all-off blink + step + settle-blink + revert
        n2 = len(tx(mgr))
        st.hp = 4                                  # a SECOND hit landing well inside min_gap_ms (400 ms)
        st._readout_paint("health")
        await settle(st)
        second = tx(mgr)[n2:]
        assert second == ["L4", "REST"], second     # no lead repaint of L5, no L0 blink -- straight to the new level
        assert "L0" not in second, "a rapid retrigger must never replay the all-off blink"
    asyncio.run(go())


def test_a_pool_at_the_same_level_does_not_repaint_but_a_pool_switch_does():
    async def go():
        st, mgr = mk()
        await st.connect("FA:KE:00:00:00:01")
        await st.arm(); await st.spawn(); await settle(st)
        readout = install_levels_readout(st, hold_s=0.01, lead_ms=1, blink_gap_ms=1, step_ms=1, blink_ms=1)
        readout["pools"].append({"pool": "armor", "max": 6, "levels": LEVELS7})
        # explicit seed for BOTH pools -- `_after_spawn` already seeded them from the REAL bundle (this
        # profile's real armour pool, max 70) before this synthetic readout even existed; overwrite both
        # so the scenario is exactly "health is active at level 4, armour's own last level was also 4".
        st._level_state = {"health": 4, "armor": 4}
        st._readout_last_pool = "health"; st._level_current = 4
        st.hp = 4                                       # same bucket, health already the active pool
        n = len(tx(mgr))
        st._readout_paint("health")
        await settle(st)
        assert tx(mgr)[n:] == [], "nothing moved on the strip: no repaint"
        st.armor = 4                                     # a DIFFERENT pool, the same numeric level
        st._readout_paint("armor")
        await settle(st)
        new = tx(mgr)[n:]
        assert new == ["L4", "REST"], new                # still switches the strip over to armour
    asyncio.run(go())


def test_a_change_mid_drop_cancels_the_old_animation_and_retargets_from_the_current_level():
    """bar-spec.md Node rules: "a change arriving mid-animation cancels it and restarts from the
    CURRENT displayed level (never queue)" -- a real `asyncio.Event` gate stalls the first animation
    exactly like `test_play_all_walks_every_line_in_slot_order_and_stop_cancels_it` does for the
    soundboard, so a second change can genuinely land while the first is still running."""
    async def go():
        st, mgr = mk()
        await st.connect("FA:KE:00:00:00:01")
        await st.arm(); await st.spawn(); await settle(st)
        install_levels_readout(st, hold_s=2, lead_ms=100, blink_gap_ms=200, step_ms=300, blink_ms=400)
        st._level_state["health"] = 6
        real_sleep = st.sleep
        gate = asyncio.Event()
        async def gated(s):
            if abs(s - 0.3) < 1e-9:          # the step_ms sleep between step-down writes
                await gate.wait()
            else:
                await real_sleep(s)
        st.sleep = gated
        st.hp = 1                            # a big drop (6 -> 1): plenty of steps to interrupt
        n = len(tx(mgr))
        st._readout_paint("health")
        await asyncio.sleep(0)               # let the task run up to its first (gated) step_ms sleep
        assert tx(mgr)[n:] == ["L6", "L0", "L5"], "stalled after the first step-down write"
        st.hp = 6                            # a change arrives mid-drop: back up to full
        st._readout_paint("health")          # bumps _level_gen -- the stalled task must not write again
        gate.set()
        await settle(st)
        new = tx(mgr)[n:]
        # the stalled task wrote nothing more (no L4/L3/L2/L1); the new one retargets from L5 -- the
        # CURRENT displayed level, not the stale prev=6 or the abandoned target=1 -- and rises to L6
        assert new == ["L6", "L0", "L5", "L5", "L6", "REST"], new
    asyncio.run(go())


def test_a_pool_cut_off_by_ANOTHER_pool_resumes_from_where_it_actually_GOT_TO():
    """Session-close review, 2026-09-07. `_level_state[pool]` used to be set to the animation's TARGET
    before the animation ran. One `_level_gen` is shared across pools, so a second pool's change cancels
    the first pool's in-flight task -- and the cancelled pool was then remembering a level that never
    reached the strip. `engine.js` records inside its own `paint()` (`_roLevels[pool] = lvl`), so it
    resumed from where it actually got to and the two surfaces animated different lengths. The stage
    exists to predict the phone, so this is a divergence, not a preference."""
    async def go():
        st, mgr = mk()
        await st.connect("FA:KE:00:00:00:01")
        await st.arm(); await st.spawn(); await settle(st)
        readout = install_levels_readout(st, hold_s=2, lead_ms=100, blink_gap_ms=200, step_ms=300, blink_ms=400)
        readout["pools"].append({"pool": "armor", "max": 6, "levels": LEVELS7})
        st._level_state = {"health": 6, "armor": 6}
        real_sleep = st.sleep
        gate = asyncio.Event()
        async def gated(sec):
            if abs(sec - 0.3) < 1e-9:        # the step sleep: stall INSIDE the step-down
                await gate.wait()
            else:
                await real_sleep(sec)
        st.sleep = gated
        st.hp = 1                             # 6 -> level 1: a long drop, so it can be caught mid-flight
        st._readout_paint("health")
        await asyncio.sleep(0)
        assert tx(mgr)[-3:] == ["L6", "L0", "L5"], tx(mgr)[-3:]   # got as far as level 5, then stalled
        st.sleep = real_sleep
        st.armor = 4
        st._readout_paint("armor")            # a DIFFERENT pool cancels health's animation outright
        gate.set()
        await settle(st)
        assert st._level_state["health"] == 5, (
            "health must remember 5, the last level it actually PAINTED -- not 1, the target it never reached")
        n = len(tx(mgr))
        st.hp = 0                             # health moves again, long after armour took the strip
        st._readout_paint("health")
        await settle(st)
        new = [f for f in tx(mgr)[n:] if f != "REST"]
        # This lands inside `min_gap_ms` of armour's own paint, so the rapid guard skips the lead freeze
        # and the all-off blink and steps straight down from `prev` -- the first write is 5-1 = L4, and the
        # whole ladder to L0 follows. With the bug, `prev` was health's never-reached target of 1, so the
        # entire animation was the single frame L0 and the operator saw the bar teleport.
        assert new == ["L4", "L3", "L2", "L1", "L0"], f"must resume from 5, the last level painted; got {new}"
    asyncio.run(go())


def test_the_all_off_blink_is_not_recorded_as_a_displayed_level():
    """Session-close review, 2026-09-07. The blank between the lead freeze and the step-down used to set
    `_level_current = 0`. A same-pool retrigger landing inside that ~80 ms window then read prev=0, saw
    `target > prev`, and ran the GAIN branch -- stepping UP with no lead and no blink for what was really
    a continuing drop. `engine.js` writes the blank frame without touching its level bookkeeping at all
    (the blink is ceremony, not a level), so the stage now does the same."""
    async def go():
        st, mgr = mk()
        await st.connect("FA:KE:00:00:00:01")
        await st.arm(); await st.spawn(); await settle(st)
        install_levels_readout(st, hold_s=2, lead_ms=100, blink_gap_ms=200, step_ms=300, blink_ms=400)
        st._level_state["health"] = 6
        real_sleep = st.sleep
        gate = asyncio.Event()
        async def gated(sec):
            if abs(sec - 0.2) < 1e-9:        # the blink gap: stall with the strip dark
                await gate.wait()
            else:
                await real_sleep(sec)
        st.sleep = gated
        st.hp = 5                             # 6 -> 5
        st._readout_paint("health")
        await asyncio.sleep(0)
        assert tx(mgr)[-2:] == ["L6", "L0"], tx(mgr)[-2:]         # lead frame, then all-off, then stalled
        assert st._level_current == 6, "the dark blink frame is not a level the strip is 'at'"
        st.sleep = real_sleep
        n = len(tx(mgr))
        st.hp = 3                             # the SAME pool moves again while the strip is dark
        st._readout_paint("health")
        gate.set()
        await settle(st)
        new = [f for f in tx(mgr)[n:] if f != "REST"]
        assert "L4" in new, f"must keep stepping DOWN 6 -> 3, got {new}"
        assert new[0] != "L0", f"must not restart upward from the blank, got {new}"
    asyncio.run(go())


def test_death_stops_a_running_level_animation_even_without_a_generation_bump():
    async def go():
        st, mgr = mk()
        await st.connect("FA:KE:00:00:00:01")
        await st.arm(); await st.spawn(); await settle(st)
        install_levels_readout(st, hold_s=2, lead_ms=100, blink_gap_ms=200, step_ms=300, blink_ms=400)
        st._level_state["health"] = 6
        real_sleep = st.sleep
        gate = asyncio.Event()
        async def gated(s):
            if abs(s - 0.3) < 1e-9:
                await gate.wait()
            else:
                await real_sleep(s)
        st.sleep = gated
        st.hp = 1
        n = len(tx(mgr))
        st._readout_paint("health")
        await asyncio.sleep(0)
        assert tx(mgr)[n:] == ["L6", "L0", "L5"]
        st.alive = False                     # the gun goes down mid-drop -- no _level_gen bump at all
        gate.set()
        await settle(st)
        assert tx(mgr)[n:] == ["L6", "L0", "L5"], "nothing written once the gun is down (Node rules: cancel on death)"
    asyncio.run(go())


def test_a_real_hit_drives_the_level_animation_through_gun_pool_paint():
    """The wiring, not just the isolated logic: a genuine `_on_pools` hit -- the same call a real $HP
    frame drives -- reaches `_level_animate` through `_gun_pool_paint` -> `_readout_paint` -> `_level_paint`."""
    async def go():
        st, mgr = mk(gun="health")
        await st.connect("FA:KE:00:00:00:01")
        await st.arm(); await st.spawn(); await settle(st)
        install_levels_readout(st, max_=st.max_hp, hold_s=0.01, lead_ms=1, blink_gap_ms=1, step_ms=1, blink_ms=1)
        st._level_state["health"] = 6
        st._gun_taken = True                 # normally set ~2.5 s after spawn by `_gun_take`; force it
        n = len(tx(mgr))
        st._on_pools(30, st.armor, st.shield)   # 45 -> 30: frac 0.667*6 = 4.0 -> level 4 (a drop of 2)
        await settle(st)
        new = [f for f in tx(mgr)[n:] if f.startswith("L") or f == "REST"]   # ignore the hit's own cue/burst frames
        assert new == ["L6", "L0", "L5", "L4", "REST"], new
        assert st._level_state["health"] == 4
    asyncio.run(go())


# ---- state() cost audit (2026-09-07): cache the bundle/profile-derived pieces, never serve them stale ---
class _NoIR:
    """A bare stand-in for `mgr` with no `inject_hit` -- so `walk_plan()`'s `can_ir` starts False, unlike
    every `mk()` stage (its `FakeConnectionManager` always has `inject_hit`, so `can_ir` there is always
    True from the first call and can never be observed flipping)."""


def test_recompile_invalidates_the_cached_event_catalog_and_voice_view():
    st, _ = mk(voice="male")
    first = st.event_catalog()
    assert st.event_catalog() is first, "a repeat call before any recompile is served from the cache, not rebuilt"
    assert st.voice_view()["id"] == "male"
    st.set_profile(voice="heavy")                            # set_profile always ends in recompile()
    assert st.event_catalog() is not first, "a recompile must rebuild the cached event catalog"
    v = st.voice_view()
    assert v["id"] == "heavy" and v["lines"], "the cached voice view must reflect the NEW voice, not the old one"
    # the genuinely live fields never come from the cache, even on a hit for the SAME key
    st.rolled = {"death_scream": "V34"}
    st.scream_this_life = "V34"
    assert st.voice_view()["rolled"] == {"death_scream": "V34"} and st.voice_view()["scream_this_life"] == "V34"


def test_switching_the_soundboard_character_never_serves_the_previous_characters_cache():
    st, _ = mk()
    st.voice_board("scout")
    scout_lines = st.board_view()["lines"]
    assert st.board_view()["voice"] == "scout" and scout_lines
    st.voice_board("medic")
    medic = st.board_view()
    assert medic["voice"] == "medic" and medic["lines"] and medic["lines"] != scout_lines
    st.voice_board("scout")                                   # BACK to an already-cached character
    again = st.board_view()
    assert again["voice"] == "scout" and again["lines"] == scout_lines, "a revisited character must still be correct, not stale from a different one"
    # `playing` / `verdicts` are LIVE -- never stuck on whatever they were when this cache entry was built
    assert st.board_view()["playing"] is None
    st.board_playing = "SCOUT_TEST_ID"
    assert st.board_view()["playing"] == "SCOUT_TEST_ID"
    line_id = scout_lines[0]["id"]
    st.voice_verdict("scout", line_id, True, "sounds right")
    assert st.board_view()["verdicts"].get(line_id) == {"ok": True, "note": "sounds right"}


def test_attaching_the_emitter_mid_bench_immediately_changes_the_walk_plan():
    """`can_ir` changes via `set_emitter()`/a direct `bridge` assignment, which does NOT go through
    `recompile()` -- with no emitter the IR steps (hit/low_health/death) are swapped for a single
    frames-only overlay step, so the plan must never be served stale from before it was attached."""
    st = GunStage(_NoIR(), None, sleep=_nosleep, voice_verdict_sink=lambda _r: None)
    st.walk_start()
    ids_before = {s["id"] for s in st.walk_plan()}
    assert "death_overlay" in ids_before and "hit" not in ids_before, "no emitter: IR steps are replaced by the overlay step"
    st.bridge = type("FakeBridge", (), {"port": "TEST"})()
    ids_after = {s["id"] for s in st.walk_plan()}
    assert "hit" in ids_after and "death_overlay" not in ids_after, "attaching the emitter must switch to the IR steps immediately, not serve the stale pre-emitter plan"
    st.bridge = None
    assert {s["id"] for s in st.walk_plan()} == ids_before, "detaching it must flip back just as immediately"


def test_a_failed_background_task_logs_a_warning_instead_of_vanishing_silently():
    """Review 2026-09-07: `_spawn_task` fires reactions and forgets them; nothing ever awaited
    `_pending`, so an exception inside one used to vanish into Python's default 'Task exception was
    never retrieved' logging instead of reaching the operator's page -- the exact silent-failure shape
    the rest of that session cost us."""
    async def go():
        st, mgr = mk()

        async def boom():
            raise RuntimeError("kaboom")

        st._spawn_task(boom())
        await settle(st)
        assert any("background task failed" in l["text"] and "kaboom" in l["text"] for l in st.log), st.log
    asyncio.run(go())
