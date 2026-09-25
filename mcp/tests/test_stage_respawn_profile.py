"""2026-09-19 respawn profiles: the stage MIRRORS engine.js (app/test/respawn-profile.test.mjs is the phone side).

A bundle with `respawn_profile` never ends protection on a shot. The T-0 spawn is neither profile: the live
`$SIR` table goes on at T-3 (PRE_ARM_TABLE_MS), and the spawn carries no t8 and maps the trigger. A TIMED
revive (in place) holds the trigger until `trigger_ms` and protects only when the game sets `protect_s`. A
STATION revive protects for `station_protect_ms`, maps the trigger at once and shows a shield on the headset.
A death soon after a timed revive raises the down-screen warning. The stage clock is in SECONDS.

Run: python3 run_tests.py stage_respawn_profile
"""
from __future__ import annotations

import asyncio

from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.mc.compile import Compiler
from brx_mcp.stage.stage import GunStage
from test_stage import LegacyCompiler, _Clock, _nosleep, settle, tx

GUN = "FA:KE:00:00:00:01"
ON, OFF = "$TMP,,,,,,,,-100,,,,*", "$TMP,,,,,,,,0,,,,*"
HELD, LIVE = "$BMAP,0,98,,,,,*", "$BMAP,0,0,,,,,*"
ENGINE_JS = __import__("pathlib").Path(__file__).resolve().parents[2] / "app" / "src" / "engine.js"


class _RespawnCompiler(Compiler):
    """The real compiler, with `config.respawn` set the way MC's options set it."""

    def __init__(self, respawn: dict):
        super().__init__()
        self.respawn = respawn

    def compile(self, config, *a, **kw):
        return super().compile({**config, "respawn": {**(config.get("respawn") or {}), **self.respawn}}, *a, **kw)


def _mk(respawn: dict | None = None):
    mgr = FakeConnectionManager([FakeTagger(GUN, "FAKE-STAGE", team=1)])
    clock = _Clock()
    st = GunStage(mgr, None, compiler=_RespawnCompiler(respawn) if respawn else None,
                  sleep=_nosleep, now=clock, voice_verdict_sink=lambda _r: None)
    return st, mgr, clock


def _sir(frames):
    return [f for f in frames if f.startswith("$SIR,")]


def _tmp(frames):
    return [f for f in frames if f.startswith("$TMP")]


async def _live(st):
    await st.connect(GUN)
    await st.arm(); await st.spawn(); await settle(st)
    st.poll(); await settle(st)


async def _die(st):
    st._inject_rx("$HP,0,0,0,*"); await settle(st)
    assert not st.alive


async def _revive(st, clock, station=None):
    await _die(st)
    clock.advance(1)
    n = len(tx(st.mgr))
    await st.revive(station=station); await settle(st)
    return n


def _shoot(st):
    st._inject_rx("$ALCD,32,100,0,192,0,*")
    st._inject_rx("$ALCD,31,100,0,192,0,*")


def test_the_constants_are_the_same_numbers_on_both_sides():
    js = ENGINE_JS.read_text(encoding="utf-8")
    assert f"SHIELD_REASSERT_MS = {int(GunStage.SHIELD_REASSERT_S * 1000)};" in js
    assert f"PRE_ARM_TABLE_MS = {int(GunStage.PRE_ARM_TABLE_S * 1000)};" in js
    assert f"DOWN_WARN_MAX = {GunStage.DOWN_WARN_MAX};" in js
    assert GunStage.PRE_ARM_TABLE_S == GunStage.COUNTDOWN_LEAD_S, "the stage's T-3 is its countdown cue"


def test_the_table_goes_on_at_t_minus_3_and_the_t0_spawn_is_live_and_unprotected():
    async def run():
        st, mgr, clock = _mk()
        rp = st.bundle["respawn_profile"]
        await st.connect(GUN); await st.arm()
        n = len(tx(mgr))
        await st.spawn(); await settle(st)
        new = tx(mgr)[n:]
        spawn_at = new.index("$SPAWN,,*")
        assert _sir(new[:spawn_at]) and _sir(new[:spawn_at]) == _sir(new), "the live table is written before $SPAWN only"
        pre = [e["text"] for e in st.log if e["kind"] == "tx" and e["why"].startswith("pre-arm hit table (T-3)")]
        assert pre == _sir(new), "its own write at T-3, not in the spawn write"
        assert not any(e["kind"] == "tx" and e["why"].startswith("spawn") and e["text"].startswith("$SIR") for e in st.log)
        assert rp["spawn"][1:] == new[spawn_at:spawn_at + len(rp["spawn"]) - 1], "the spawn writes respawn_profile.spawn"
        assert not _tmp(new) and LIVE in new and HELD not in new, "no t8, and the trigger is live at go-live"
        assert st._arm_pending is None and st._trigger_pending is None, "nothing is pending at go-live"
        assert st._sir_live
        n = len(tx(mgr)); clock.advance(5); st.poll(); await settle(st)
        assert not _sir(tx(mgr)[n:]) and not _tmp(tx(mgr)[n:]), "and nothing is written after go-live"
        m = st.state()["model"]
        assert m["weapon_arming_s"] is None and m["shielded"] is False and m["down_warn"] == 1
    asyncio.run(run())


def test_a_late_start_carries_the_table_in_front_of_the_spawn():
    async def run():
        st, mgr, clock = _mk()
        await st.connect(GUN); await st.arm()

        async def missed():   # a late start: the T-3 tick never ran
            return None
        st._pre_arm_table = missed
        n = len(tx(mgr))
        await st.spawn(); await settle(st)
        new = tx(mgr)[n:]
        first_sir = new.index(_sir(new)[0])
        assert first_sir < new.index("$SPAWN,,*") and first_sir > new.index(st.bundle["cues"]["countdown"]), new
        assert new.index(_sir(new)[-1]) < new.index(next(f for f in new if f.startswith("$PSET"))), "IN FRONT of the $PSET and $SPAWN"
        assert st._sir_live, "the spawn write claims the table"
    asyncio.run(run())


def test_timed_defaults_no_t8_the_trigger_held_and_live_at_half_a_second():
    async def run():
        st, mgr, clock = _mk()
        rp = st.bundle["respawn_profile"]
        assert (rp["protect_ms"], rp["trigger_ms"]) == (0, 500)
        await _live(st)
        n = await _revive(st, clock)
        new = tx(mgr)[n:]
        start = new.index(rp["revive"][0])   # 2026-09-19: TRIGGER_HELD now leads $SPAWN, so anchor on the list's own first frame
        assert new[start:start + len(rp["revive"])] == rp["revive"], "the revive writes respawn_profile.revive"
        assert not _tmp(new) and HELD in new and LIVE not in new
        assert st._arm_pending is None, "no protection: armed at once"
        assert st.state()["model"]["weapon_arming_s"] == 0.5
        st._inject_rx("$BUT,0,1,*"); st._inject_rx("$BUT,0,0,*")
        assert st._shot_due_at is None, "weaponHold: a pull while the trigger is held owes no shot (F208)"
        clock.advance(0.49); st.poll(); await settle(st)
        assert LIVE not in tx(mgr)[n:], "still held at 0.49 s"
        clock.advance(0.01); st.poll(); await settle(st)
        assert tx(mgr)[n:].count(LIVE) == 1, "trigger_live at 0.5 s"
        assert st._trigger_pending is None and st.state()["model"]["weapon_arming_s"] is None
        k = len(tx(mgr)); clock.advance(5); st.poll(); await settle(st)
        assert LIVE not in tx(mgr)[k:] and not _tmp(tx(mgr)[n:]), "once, and never a $TMP"
    asyncio.run(run())


def test_timed_protection_1s_ends_on_the_clock_not_on_a_shot_and_the_trigger_waits_past_it():
    async def run():
        st, mgr, clock = _mk({"protect_s": 1})
        rp = st.bundle["respawn_profile"]
        assert (rp["protect_ms"], rp["trigger_ms"]) == (1000, 1500)
        await _live(st)
        n = await _revive(st, clock)
        assert _tmp(tx(mgr)[n:]) == [ON] and HELD in tx(mgr)[n:]
        _shoot(st); await settle(st)
        assert _tmp(tx(mgr)[n:]) == [ON], "a shot does not end a profile life's protection"
        clock.advance(0.99); st.poll(); await settle(st)
        assert _tmp(tx(mgr)[n:]) == [ON], "still protected at 0.99 s"
        clock.advance(0.01); st.poll(); await settle(st)
        assert _tmp(tx(mgr)[n:]) == [ON, OFF], "t8 0 at 1 s"
        assert LIVE not in tx(mgr)[n:], "the trigger is still held after protection ends"
        clock.advance(0.49); st.poll(); await settle(st)
        assert LIVE not in tx(mgr)[n:]
        clock.advance(0.01); st.poll(); await settle(st)
        assert tx(mgr)[n:].count(LIVE) == 1, "trigger live at 1.5 s"
    asyncio.run(run())


def test_a_station_revive_protects_maps_the_trigger_and_shows_the_shield_for_2s():
    async def run():
        st, mgr, clock = _mk()
        rp = st.bundle["respawn_profile"]
        hs_respawn = (st.bundle.get("headset") or {}).get("respawn") or []
        await _live(st)
        n = await _revive(st, clock, station=3)
        new = tx(mgr)[n:]
        assert new[new.index("$SPAWN,,*"):][:len(rp["revive_station"])] == rp["revive_station"]
        assert _tmp(new) == [ON] and LIVE in new and HELD not in new and rp["shield_on"] in new
        assert st._trigger_pending is None
        assert not any(f in new for f in hs_respawn if f not in rp["revive_station"]), "no respawn flash under the shield"
        assert st.state()["model"]["shielded"] is True and st.state()["model"]["weapon_arming_s"] is None
        _shoot(st); await settle(st)
        assert _tmp(tx(mgr)[n:]) == [ON], "a shot does not end it"
        # a registered hit clears the painted colour: the shield is painted again, at most once per 0.5 s
        k = len(tx(mgr))
        st._inject_rx("$HIR,0,1,42,2,10,0,0,*"); await settle(st)
        st._inject_rx("$HIR,1,1,42,2,10,0,0,*"); await settle(st)
        assert tx(mgr)[k:].count(rp["shield_on"]) == 1, "one re-assert for two hits inside 0.5 s"
        clock.advance(0.5)
        st._inject_rx("$HIR,0,1,42,2,10,0,0,*"); await settle(st)
        assert tx(mgr)[k:].count(rp["shield_on"]) == 2, "and another 0.5 s later"
        clock.advance(1.49); st.poll(); await settle(st)
        assert _tmp(tx(mgr)[n:]) == [ON], "still protected at 1.99 s"
        clock.advance(0.01); st.poll(); await settle(st)
        tail = tx(mgr)[n:]
        assert _tmp(tail) == [ON, OFF] and tail.index(rp["shield_off"]) > tail.index(OFF), "off, then shield_off, at 2 s"
        assert st.state()["model"]["shielded"] is False
        k = len(tx(mgr))
        st._inject_rx("$HIR,0,1,42,2,10,0,0,*"); await settle(st)
        assert rp["shield_on"] not in tx(mgr)[k:], "no re-assert once the shield is off"
    asyncio.run(run())


def test_the_down_warning_climbs_on_spawn_kills_holds_at_3_and_resets_on_a_new_match():
    async def run():
        st, mgr, clock = _mk()
        await _live(st)
        await _die(st)
        assert st._down_warn == 1, "a death after the T-0 spawn is not a spawn kill"
        await st.revive(); await settle(st)
        clock.advance(10.0); await _die(st)
        assert st._down_warn == 2, "a death 10 s after a timed revive"
        for want in (3, 3):
            await st.revive(); await settle(st)
            clock.advance(2); await _die(st)
            assert st._down_warn == want, want
        assert st.state()["model"]["down_warn"] == 3
        await st.revive(); await settle(st)
        clock.advance(10.01); await _die(st)
        assert st._down_warn == 3, "never decreases"
        # a fresh match starts again at 1; a station revive and a late death do not count
        await st.arm(); await st.spawn(); await settle(st)
        assert st._down_warn == 1, "reset on a new match"
        await _die(st)
        await st.revive(station=1); await settle(st)
        clock.advance(1); await _die(st)
        assert st._down_warn == 1, "a station revive is not a timed respawn"
        await st.revive(); await settle(st)
        clock.advance(10.01); await _die(st)
        assert st._down_warn == 1, "outside the window"
    asyncio.run(run())


def test_a_legacy_bundle_station_revive_does_not_start_the_spawn_kill_window():
    """Review 2026-09-19 (mirrors engine.js `_revive` line ~2888): with NO `respawn_profile` at all (an
    app < 0.4.3), `kind` always computes to "timed", station or not -- `_timed_life_at` must ALSO require
    `station is None`, or a legacy station revive would wrongly start the spawn-kill escalation."""
    async def run():
        mgr = FakeConnectionManager([FakeTagger(GUN, "FAKE-STAGE", team=1)])
        clock = _Clock()
        st = GunStage(mgr, None, compiler=LegacyCompiler(), sleep=_nosleep, now=clock, voice_verdict_sink=lambda _r: None)
        assert st._respawn_profile() is None, "setup: the legacy bundle carries no respawn_profile"
        await _live(st)
        await _die(st)
        await st.revive(station=3); await settle(st)
        assert st._timed_life_at is None, "a legacy station revive must not start the spawn-kill window"
        clock.advance(1); await _die(st)
        assert st._down_warn == 1, "no escalation from a legacy station revive"
    asyncio.run(run())


def test_death_end_panic_and_a_head_clear_both_pendings():
    async def run():
        for how in ("death", "end", "panic", "head"):
            st, mgr, clock = _mk({"protect_s": 1})
            await _live(st)
            await _revive(st, clock)
            assert st._arm_pending is not None and st._trigger_pending is not None
            if how == "death":
                await _die(st)
            elif how == "end":
                await st.end()
            elif how == "panic":
                await st.panic()
            else:
                await st.arm()
            assert st._arm_pending is None and st._trigger_pending is None, how
            n = len(tx(mgr)); clock.advance(5); st.poll(); await settle(st)
            assert LIVE not in tx(mgr)[n:] and OFF not in tx(mgr)[n:], f"{how}: nothing written afterwards"
    asyncio.run(run())


# ---- utility.md §2 (Tony 2026-09-24): the station-revive bit on the player advert ----------------------------

BEACON_JS = ENGINE_JS.parent / "beacon.js"


def test_the_player_advert_decodes_bit6_revived_as_beacon_js_does():
    """beacon.js `PLAYER_STATE.revived` = 0x40, with the station id in `value`. The stage decodes the same byte."""
    from brx_mcp.stage.stage import PLAYER_STATE, REVIVE_ADVERT_S, decode_advert_uuid, encode_advert_uuid, player_state_flags
    js = BEACON_JS.read_text(encoding="utf-8")
    assert "revived: 64 }" in js and PLAYER_STATE["revived"] == 0x40
    assert f"REVIVE_ADVERT_MS = {int(REVIVE_ADVERT_S * 1000)};" in js
    d = decode_advert_uuid(encode_advert_uuid("player", 7, 0, 1, PLAYER_STATE["alive"] | PLAYER_STATE["revived"], 5))
    assert d is not None and d["value"] == 5
    assert player_state_flags(d["state"]) == {"alive", "revived"}
    assert player_state_flags(PLAYER_STATE["alive"]) == {"alive"}, "control: no bit6, no revived"


def test_a_station_revive_holds_revive_advert_for_5s_and_a_timed_one_never_sets_it():
    """engine.js `state().reviveAdvert`: the station id for REVIVE_ADVERT_MS after a STATION revive, else None."""
    async def run():
        st, mgr, clock = _mk()
        await _live(st)
        assert st.state()["model"]["revive_advert"] is None, "control: nothing before a revive"
        await _revive(st, clock, station=3)
        assert st.state()["model"]["revive_advert"] == 3
        clock.advance(4.75)
        assert st.state()["model"]["revive_advert"] == 3, "still held inside 5 s"
        clock.advance(0.25)
        assert st.state()["model"]["revive_advert"] is None, "cleared at 5 s"
        await _revive(st, clock)
        assert st.state()["model"]["revive_advert"] is None, "a timed revive never sets it"
    asyncio.run(run())
