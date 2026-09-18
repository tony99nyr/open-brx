"""F264: the stage MIRRORS engine.js's cure (app/test/cure.test.mjs is the phone side).

A player was dead on the gun and alive on the HUD for 94 s. `pool_stale()` said `no_fire` and nothing
acted on it. The cure now acts -- but it ASKS FIRST, because `no_fire` has two proven causes and only
one of them wants a revive: the gun died and the killing `$HP`/`$LCD` never arrived (cure: the revive
head, which carries `$SPAWN`), or the node's own magazine count is ahead of the gun's after a timed-out
reload (cure: nothing, the player reloads). Every test here breaks one of those rules; the CONTROLs pin
the neighbouring path that must not move.

Mirrors: app/test/cure.test.mjs. Deliberate partial parity, same as the rest of the stage's F208/F209
work: engine.js's stand-down list also names `phase`, `bundle`, `reconciling`, `resync` and `tutorial`,
none of which the stage has a concept of (see `GunStage._cure_tick`'s own comment) -- so the stand-down
tests below cover only the subset the stage actually carries: overheat, stun, reload, switching and a
dropped link. `resync` and `reconcile` have no stage equivalent and are not tested here.

Run: python3 run_tests.py stage_cure
"""
from __future__ import annotations

import asyncio

from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.stage.stage import GunStage
from test_stage import _Clock, _nosleep, settle, tx

GUN = "FA:KE:00:00:00:01"
QUERY = "$QUERY,*"


def _mk():
    tagger = FakeTagger(GUN, "FAKE-STAGE", team=1)
    # F264: every test here drives the gun's answer BY HAND (`_reply()`), the same separation
    # cure.test.mjs's harness keeps (its `writer` only records). Q18 `listening = False` makes the fake
    # drop every write silently instead of auto-answering it -- a live-answering fake would cure its own
    # `no_fire` claim before the test gets a chance to assert the intermediate state. The one test that
    # DOES want a real answering gun (the end-to-end one) turns `listening` back on itself.
    tagger.listening = False
    mgr = FakeConnectionManager([tagger])
    clock = _Clock()
    st = GunStage(mgr, None, sleep=_nosleep, now=clock, voice_verdict_sink=lambda _r: None)
    return st, mgr, clock


async def _adv(st, clock, s: float, step: float = 0.25):
    """Tick the stage forward `s` seconds of the hand-driven clock, settling every step so a write
    `_spawn_task` scheduled during `poll()` actually reaches the fake gun before the next one."""
    end = clock() + s
    while clock() < end:
        clock.advance(min(step, end - clock())); st.poll()
        await settle(st)
    return st


async def _adv_hold(st, clock, s: float, apply, step: float = 0.25):
    """Like `_adv`, but re-applies `apply(st)` before every step -- a state the ordinary tick would clear
    on its own (a reload deadline, a stun timer, a heat reading going stale) stays true throughout."""
    end = clock() + s
    while clock() < end:
        clock.advance(min(step, end - clock())); apply(st); st.poll()
        await settle(st)
    return st


async def _live(st, clock):
    """A live, spawned, alive stage whose gun has reported a full magazine -- and whose divergence poll
    has already asked once (mirrors cure.test.mjs's `harness()`, whose own `h.adv(10)` does the same job
    before the initial `$LCD` and shot)."""
    await st.connect(GUN)
    await st.arm(); await st.spawn(); await settle(st)
    # F209's own spawn-protection cap (SPAWN_PROTECT_MAX_S = 2.1 s) writes an unrelated $SIR arm burst if
    # it is still pending when a cure test's own asserts run. Clearing it here, well past the cap, keeps
    # every later "the cure writes nothing but X" assertion honest (mirrors cure.test.mjs's own harness,
    # whose `.adv(3000)` before the first shot does the same job).
    await _adv(st, clock, 3.0)                     # also: the divergence poll's own first ask happens in here
    st._inject_rx("$LCD,45,70,0,0,30,90,*")
    st._inject_rx("$BUT,0,1,*"); st._inject_rx("$ALCD,29,100,0,192,0,*"); st._inject_rx("$BUT,0,0,*")
    await settle(st)
    assert st.alive is True and st.spawned is True
    return st


async def _pull(st, clock):
    """One trigger pull the gun never answers: press, release, and past TRIGGER_NO_FIRE_S so the tick books it."""
    st._inject_rx("$BUT,0,1,*"); await _adv(st, clock, 0.2); st._inject_rx("$BUT,0,0,*"); await _adv(st, clock, 1.8)


async def _stall(st, clock, n: int | None = None):
    """The pulls that make `pool_stale()` say `no_fire`, and nothing more."""
    for _ in range(n if n is not None else GunStage.NO_FIRE_PULLS):
        await _pull(st, clock)


async def _reply(st, hp: int, armor: int = 70, mag: int = 30, reserve: int = 90):
    """Answer the ask the stage just sent, as a real gun does: the status array (pool MAXIMA, deliberately
    useless here) and then the `$LCD` carrying the live pools and magazine."""
    st._inject_rx("$QUERY,7,1,45,70,0,0,1,*")
    st._inject_rx(f"$LCD,{hp},{armor},0,0,{mag},{reserve},*")
    await settle(st)


def _query_times(st) -> list[float]:
    """Every clock time a `$QUERY,*` actually went out (the tx log, not the fake's replies)."""
    return [l["t"] for l in st.log if l["kind"] == "tx" and l["text"] == QUERY]


def _deaths(st) -> list[dict]:
    return [l for l in st.log if "☠ down" in l["text"]]


def _has(st, needle: str) -> bool:
    return any(needle in l["text"] for l in st.log)


# ---------------------------------------------------------------- the trigger

def test_the_cure_asks_at_no_fire_pulls_and_not_at_one_fewer():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _adv(st, clock, GunStage.QUERY_POLL_S + 1.0)   # let the divergence poll have its turn first
        n = len(tx(mgr)); polls = len(_query_times(st))
        await _stall(st, clock, GunStage.NO_FIRE_PULLS - 1)
        assert st.pool_stale() is None, "CONTROL: two unanswered pulls are not yet a claim"
        assert len(_query_times(st)) == polls, "and nothing is asked"
        await _pull(st, clock)
        s = st.pool_stale()
        assert s and s["why"] == "no_fire"
        assert len(_query_times(st)) == polls + 1, f"the third pull asks the gun exactly once: {tx(mgr)[n:]}"
        assert any(l["kind"] == "tx" and l["text"] == QUERY and "asking the gun what it thinks" in l["why"]
                   for l in st.log), "and says why"
    asyncio.run(run())


def test_the_ask_is_one_frame_and_it_is_query_which_the_deny_list_passes():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        n = len(tx(mgr))
        await _stall(st, clock)
        w = [f for f in tx(mgr)[n:] if f != QUERY]
        assert w == [], f"the cure writes nothing but the ask: {tx(mgr)[n:]}"
        assert st.refused == 0, "$QUERY is a known command, never refused by `write`"
    asyncio.run(run())


# ---------------------------------------------------------------- the dead gun

def test_a_dead_reply_books_exactly_one_death_marked_desync_and_the_ordinary_respawn_cures_the_gun():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _stall(st, clock)
        assert st.alive is True, "setup: the stage still believes the player is alive"
        await _reply(st, 0, 0, 0, 0)
        deaths = _deaths(st)
        assert len(deaths) == 1, f"exactly one death: {deaths}"
        assert "desync" in deaths[0]["text"], "the node learned it out of band, from its own question (F264)"
        assert st.alive is False
        assert st.pool_stale() is None, "the stale claim is answered"
        n = len(tx(mgr))
        await st.revive(); await settle(st)
        assert st.alive is True
        assert any(f.startswith("$SPAWN") for f in tx(mgr)[n:]), f"the respawn writes the revive head: {tx(mgr)[n:]}"
    asyncio.run(run())


def test_a_dead_reply_cures_nothing_by_itself_the_cure_books_no_death_of_its_own():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _stall(st, clock)
        n = len(tx(mgr))
        await _reply(st, 0, 0, 0, 0)
        w = tx(mgr)[n:]
        assert not any(f.startswith("$SPAWN") for f in w), f"the answer itself writes no spawn: the respawn timer owns that: {w}"
        assert len(_deaths(st)) == 1, "and there is one death, not two"
    asyncio.run(run())


# ---------------------------------------------------------------- the live gun

def test_a_reply_with_health_above_0_and_an_empty_magazine_never_revives_and_never_writes_ammo():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _stall(st, clock)
        n = len(tx(mgr))
        await _reply(st, 45, 70, 0, 90)                # alive, magazine empty: the timed-out reload, not a death
        assert st.alive is True, "no revive"
        w = tx(mgr)[n:]
        assert w == [], f"no write at all -- an $AMMO here would hand out a free magazine: {w}"
        assert _has(st, "EMPTY magazine"), "and says which case it chose"
        # CONTROL: the no-fire claim is spent by the reply -- a single further unanswered pull cannot
        # retrip it on its own (mirrors cure.test.mjs; the stage does not feed $LCD's own magazine token
        # into its ammo account the way engine.js's `feedFrame` LCD case does -- see the report)
        await _pull(st, clock)
        assert st.pool_stale() is None
    asyncio.run(run())


def test_a_reply_with_health_above_0_and_a_loaded_magazine_reasserts_the_arming_and_does_not_revive():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _stall(st, clock)
        n = len(tx(mgr))
        await _reply(st, 45, 70, 25, 90)               # alive, loaded, and still not answering the trigger
        assert st.alive is True, "no revive"
        w = tx(mgr)[n:]
        assert not any(f.startswith("$SPAWN") or f.startswith("$PSET") for f in w), f"nothing that heals or re-heads: {w}"
        assert any(f.startswith("$AMMO,") for f in w), f"the live counts go back: {w}"
        assert any(f.startswith("$BMAP,0,0") for f in w), "and the trigger mapping"
    asyncio.run(run())


# ---------------------------------------------------------------- no reply at all

def test_no_reply_falls_back_to_the_revive_head_once_after_cure_asks_asks():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        polls = len(_query_times(st))
        await _stall(st, clock)
        assert len(_query_times(st)) - polls == 1, "setup: the cure has asked once"
        await _adv(st, clock, GunStage.QUERY_REPLY_S + 0.3)
        assert len(_query_times(st)) - polls == GunStage.CURE_ASKS, \
            f"a lost notification is ordinary: it asks {GunStage.CURE_ASKS} times"
        assert st.alive is True, "and still nothing written blind"
        n = len(tx(mgr))
        await _adv(st, clock, GunStage.QUERY_REPLY_S + 0.3)
        w = tx(mgr)[n:]
        assert sum(1 for f in w if f.startswith("$SPAWN")) == 1, f"exactly one revive head: {w}"
        assert st.alive is True
        assert _has(st, "taken blind"), "and the log says it was taken blind"
        n2 = len(tx(mgr))
        await _stall(st, clock)                        # the fresh life goes straight back to not firing
        assert sum(1 for f in tx(mgr)[n2:] if f == QUERY) == 0, "the cooldown refuses a second cure in the same breath"
    asyncio.run(run())


def test_a_gun_that_answers_query_but_sends_no_lcd_is_never_revived_blind():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _stall(st, clock)
        st._inject_rx("$QUERY,7,1,45,70,0,0,1,*")       # the array, and nothing behind it
        await settle(st)
        await _adv(st, clock, (GunStage.QUERY_REPLY_S + 0.3) * 2)
        assert st.alive is True, "a gun that is still talking is not guessed at"
        assert len(_deaths(st)) == 0
        assert _has(st, "still talking")
    asyncio.run(run())


def test_blind_fallbacks_stop_at_cure_max_blind_and_hand_the_gun_to_the_operator():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        blind = 0
        for _ in range(GunStage.CURE_MAX_BLIND + 2):
            await _adv(st, clock, GunStage.CURE_COOLDOWN_S + 1.0)
            st._inject_rx("$ALCD,29,100,0,192,0,*")     # the gun reports a pool, so `no_fire` can build again
            await settle(st)
            await _stall(st, clock)
            await _adv(st, clock, (GunStage.QUERY_REPLY_S + 0.3) * GunStage.CURE_ASKS)
            blind = sum(1 for l in st.log if "taken blind" in l["text"])
        assert blind == GunStage.CURE_MAX_BLIND, f"it gives up after {GunStage.CURE_MAX_BLIND}, rather than reviving a dead gun forever"
        assert _has(st, "REVIVE or RELINK"), "and names the human cure"
    asyncio.run(run())


# ---------------------------------------------------------------- the stand-downs

def _overheat(st): st.heat_by_slot[0] = GunStage.HEAT_LOCKOUT + 9; st._heat_at[0] = st.now()
def _stun(st): st.stunned = {"at": st.now(), "until": st.now() + 10.0, "ammo": {}}
def _reload(st): st.reloading = {"at": st.now(), "s": 1.4, "slot": 0, "from": 0}
def _switching(st): st.switching = {"at": st.now(), "from": 0}


def _make_stand_down_test(name: str, apply):
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _stall(st, clock)
        s = st.pool_stale()
        assert s and s["why"] == "no_fire", "setup: the detector has concluded"
        st._cure = None; st._cure_life = None; st._cure_at = 0.0   # ...and the cure has not run yet
        n = len(tx(mgr))
        await _adv_hold(st, clock, (GunStage.QUERY_REPLY_S + 0.3) * (GunStage.CURE_ASKS + 1), apply)
        w = tx(mgr)[n:]
        assert st._cure_life is None, f"{name} must never start a cure"
        assert st._cure is None, f"{name} must leave no ask in flight"
        assert not any(f.startswith("$SPAWN") for f in w), f"{name} must never reach a revive: {w}"
        assert not any(f.startswith("$AMMO,") or f.startswith("$BMAP,") for f in w), f"{name} must never re-assert the arming: {w}"

    def test():
        asyncio.run(run())
    test.__name__ = f"test_f264_{name}_suppresses_the_cure_entirely"
    return test


for _name, _apply in (("overheat", _overheat), ("stun", _stun), ("reload", _reload), ("switching", _switching)):
    globals()[f"test_f264_{_name}_suppresses_the_cure_entirely"] = _make_stand_down_test(_name, _apply)
del _name, _apply


def test_f264_a_dropped_link_suppresses_the_cure_entirely():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _stall(st, clock)
        s = st.pool_stale()
        assert s and s["why"] == "no_fire", "setup: the detector has concluded"
        st._cure = None; st._cure_life = None; st._cure_at = 0.0
        n = len(tx(mgr))
        mgr.drop("stage")
        st.poll()                                       # discovers the drop on the very next poll
        assert not st.connected
        await _adv(st, clock, (GunStage.QUERY_REPLY_S + 0.3) * (GunStage.CURE_ASKS + 1))
        w = tx(mgr)[n:]
        assert st._cure_life is None, "a dropped link must never start a cure"
        assert st._cure is None, "a dropped link must leave no ask in flight"
        assert not any(f.startswith("$SPAWN") for f in w), f"a dropped link must never reach a revive: {w}"
    asyncio.run(run())


def test_an_ask_in_flight_when_the_link_drops_is_abandoned_not_timed_out_into_a_blind_revive():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _stall(st, clock)
        assert st._cure is not None, "setup: an ask is outstanding"
        mgr.drop("stage")
        st.poll()
        assert st._cure is None and st._query_at == 0.0, "the drop clears the outstanding ask (engine.js `onBleDropped`)"
        mgr.dropped.discard("stage"); st.connected = True   # the relink -- a write self-heals the rest
        n = len(tx(mgr))
        await _adv(st, clock, (GunStage.QUERY_REPLY_S + 0.3) * (GunStage.CURE_ASKS + 1))
        w = tx(mgr)[n:]
        assert not any(f.startswith("$SPAWN") for f in w), f"the relink owes the old ask nothing: {w}"
    asyncio.run(run())


# ---------------------------------------------------------------- the poll

def test_the_divergence_poll_runs_only_in_a_live_match_at_query_poll_s():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        assert len(_query_times(st)) == 1, "the first live tick asks once"
        n = len(_query_times(st))
        await _adv(st, clock, GunStage.QUERY_POLL_S * 3 + 0.5)
        times = _query_times(st)
        assert len(times) - n == 3, f"3 asks in 3 cadences, no more: {len(times) - n}"
        gaps = [b - a for a, b in zip(times[n - 1:], times[n:])]
        for g in gaps:
            assert GunStage.QUERY_POLL_S <= g < GunStage.QUERY_POLL_S + 0.5, f"every gap is one cadence, not a burst: {gaps}"
        await st.end(); await settle(st)
        w = len(tx(mgr))
        await _adv(st, clock, GunStage.QUERY_POLL_S * 3)
        assert not any(f == QUERY for f in tx(mgr)[w:]), "a match that is over polls nothing"
    asyncio.run(run())


def test_a_poll_never_runs_before_a_match_spawns():
    async def run():
        st, mgr, clock = _mk()
        await st.connect(GUN)                            # connected, but not armed/spawned -- no phase in the stage beyond `spawned`
        n = len(tx(mgr))
        await _adv(st, clock, GunStage.QUERY_POLL_S * 3)
        assert not any(f == QUERY for f in tx(mgr)[n:]), "nothing polls an unspawned gun"
    asyncio.run(run())


def test_a_poll_reply_does_not_clear_the_no_fire_count():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _pull(st, clock); await _pull(st, clock)
        assert st._no_fire_pulls == 2, "setup: two unanswered pulls"
        n = len(_query_times(st))
        end = clock() + GunStage.QUERY_POLL_S * 2
        while clock() < end and len(_query_times(st)) == n:
            clock.advance(0.25); st.poll(); await settle(st)
        assert len(_query_times(st)) > n, "no ask went out"
        await _reply(st, 45, 70, 25, 90)
        assert st._no_fire_pulls == 2, "the solicited $LCD leaves the unanswered pulls standing"
        assert st.pool_stale() is None, "CONTROL: two is still not a claim"
        # CONTROL: an UNSOLICITED pool frame is the gun answering the trigger, and still clears it.
        st._inject_rx("$ALCD,24,100,0,192,0,*")
        assert st._no_fire_pulls == 0
    asyncio.run(run())


def test_a_poll_that_finds_the_gun_dead_books_the_death_with_no_trigger_pulled():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        n = len(_query_times(st))
        end = clock() + GunStage.QUERY_POLL_S * 2
        while clock() < end and len(_query_times(st)) == n:
            clock.advance(0.25); st.poll(); await settle(st)
        assert st._cure is None, "setup: this is the poll, not a cure"
        await _reply(st, 0, 0, 0, 0)
        deaths = _deaths(st)
        assert len(deaths) == 1, "the divergence is caught with no dead trigger pulled"
        assert "desync" in deaths[0]["text"]
        assert st.alive is False
    asyncio.run(run())


def test_the_write_cost_of_the_poll_is_3_frames_a_minute_and_nothing_else():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        n = len(_query_times(st))
        await _adv(st, clock, 60.0)
        added = len(_query_times(st)) - n
        assert added == 3, f"{added} asks in a quiet minute"
        assert QUERY == "$QUERY,*" and len(QUERY) == 8
    asyncio.run(run())


# ---------------------------------------------------------------- end to end, against the fake gun

def test_fake_dead_chatty_refuses_to_fire_but_still_answers_query_with_health_zero():
    """fake.py alone, no stage: the F264 fault (docs/FOLLOWUPS.md F264) and its one cure."""
    tagger = FakeTagger(GUN, "FAKE-STAGE", team=1)
    tagger.mag[0] = 29
    tagger.go_dead_chatty()
    assert tagger.alive is False and tagger.hp == 0
    tagger.fire(0)
    assert tagger.drain() == [], "a dead-chatty gun's trigger produces no $ALCD"
    tagger.write("$QUERY,*")
    out = tagger.drain()
    assert any(f.startswith("$LCD,0,") for f in out), f"still answers $QUERY, with health 0: {out}"
    tagger.write("$SPAWN,,*")
    assert tagger.alive is True and tagger.hp == tagger.cfg_hp, "the cure: $SPAWN clears the dead-chatty state"
    tagger.drain()
    tagger.fire(0)
    assert tagger.drain(), "the trigger works again post-SPAWN"


def test_end_to_end_a_dead_chatty_fake_gun_is_cured_by_the_stages_own_query_and_the_respawn():
    async def run():
        st, mgr, clock = _mk()
        tagger = mgr.taggers[GUN]
        tagger.listening = True                          # this test wants the REAL fake gun answering, not a hand-fed reply
        await _live(st, clock)
        tagger.go_dead_chatty()                          # the gun goes dead silently -- no $HP/$LCD reaches the stage
        # The player pulls three times, into silence; the fake gun answers the cure's own $QUERY,* almost
        # at once (a real link is ~30-90 ms, F259), so by the time `_stall()` returns the whole no_fire ->
        # ask -> $LCD(health 0) -> death sequence has already run, over the SAME manager a bench gun would.
        assert not _has(st, "gun not firing"), "setup: no claim yet"
        await _stall(st, clock)
        assert _has(st, "gun not firing"), "the unanswered pulls built the claim"
        deaths = _deaths(st)
        assert len(deaths) == 1, f"the fake's own $QUERY reply books the death: {deaths}"
        assert "desync" in deaths[0]["text"]
        assert st.alive is False
        n = len(tx(mgr))
        await st.revive(); await settle(st)
        assert st.alive is True
        assert any(f.startswith("$SPAWN") for f in tx(mgr)[n:]), "the respawn's own $SPAWN clears the fake's dead-chatty state too"
    asyncio.run(run())
