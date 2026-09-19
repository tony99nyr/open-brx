"""F264 v3: the stage MIRRORS engine.js's cure (app/test/cure.test.mjs is the phone side).

A player was dead on the gun and alive on the HUD for 94 s. `pool_stale()` said `no_fire` and nothing
acted on it. The cure now acts -- but it ASKS FIRST, because `no_fire` has two proven causes and only
one of them wants a revive: the gun died and the killing `$HP`/`$LCD` never arrived, or the node's own
magazine count is ahead of the gun's after a timed-out reload. Every test here breaks one of those
rules; the CONTROLs pin the neighbouring path that must not move.

THE NODE NEVER ACTS ON NO EVIDENCE (Tony, 2026-09-18). On no reply from the dead-gun probe the node does
NOTHING, records a verdict of `no_answer`, and logs loudly. A free life for a gun that was merely empty
is worse than a wait.

v3 (bench 2026-09-19, two taggers, v4.32): the cure is a TWO-STEP machine now. Step 'life' asks
`$LIFE,0,0,0,*` ALONE -- bench-measured safe to send ANY gun, dead or alive, both answer immediately with
`$HP`. Only once that step proves the gun ALIVE does step 'mag' ask `$QUERY` for the magazine -- `$QUERY`
is asked from EXACTLY ONE place (this step) because a DEAD gun was bench-measured to hold its `$QUERY`
status-array print loop for ~2 s before a late, unterminated body finally arrives, and asking a gun that
might be dead risks that stuck-loop shape.

Mirrors: app/test/cure.test.mjs. Deliberate partial parity, same as the rest of the stage's F208/F209
work: engine.js's stand-down list also names `phase`, `bundle`, `reconciling`, `resync` and `tutorial`,
none of which the stage has a concept of (see `GunStage._STAND_DOWN`'s own comment) -- so the stand-down
tests below cover only the subset the stage actually carries: overheat, stun, reload, switching and a
dropped link. `resync` and `reconcile` have no stage equivalent and are not tested here; neither does
engine.js's own reconcile-site probe (`_askGun('reconcile: read the gun rather than infer it')`), since
the stage has no rejoin-reconcile state machine to hang it off.

Run: python3 run_tests.py stage_cure
"""
from __future__ import annotations

import asyncio

from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.stage.stage import GunStage, PROBE_LIFE
from test_stage import _Clock, _nosleep, settle, tx

GUN = "FA:KE:00:00:00:01"
QUERY = "$QUERY,*"


def _mk():
    tagger = FakeTagger(GUN, "FAKE-STAGE", team=1)
    # F264: every test here drives the gun's answer BY HAND (`_reply_life()`/`_reply_magazine()`), the
    # same separation cure.test.mjs's harness keeps (its `writer` only records). Q18 `listening = False`
    # makes the fake drop every write silently instead of auto-answering it -- a live-answering fake
    # would cure its own `no_fire` claim before the test gets a chance to assert the intermediate state.
    # The end-to-end tests turn `listening` back on themselves.
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
    """A live, spawned, alive stage whose gun has reported a full magazine. The window below is long
    enough for F209's own spawn-protection cap (2.1 s) AND the once-per-life spawn read-back
    (SPAWN_PROBE_S = 2.5 s) to have already run and settled, so neither shows up as a surprise write or a
    surprise probe inside a later test's own "writes nothing but X" assertion."""
    await st.connect(GUN)
    await st.arm(); await st.spawn(); await settle(st)
    await _adv(st, clock, 3.0)
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


async def _reply_life(st, hp: int, armor: int = 70, shield: int = 0):
    """Answer the 'life' step's `PROBE_LIFE` with `$HP`, as the bench (2026-09-19) measures BOTH a dead
    and a live gun doing IMMEDIATELY: `$LIFE`'s own frame shape carries no ammo tokens at all."""
    st._inject_rx(f"$HP,{hp},{armor},{shield},*")
    await settle(st)


async def _reply_magazine(st, mag: int, reserve: int = 90, hp: int = 45, armor: int = 70):
    """Answer the 'mag' step's `$QUERY` with the `$LCD` carrying the live pools and magazine (the leading
    status array is deliberately not injected -- the cure never reads it)."""
    st._inject_rx(f"$LCD,{hp},{armor},0,0,{mag},{reserve},*")
    await settle(st)


async def _reply_alive(st, hp: int = 45, armor: int = 70, mag: int = 30, reserve: int = 90):
    """Drive a cure through BOTH steps to a normal alive resolution."""
    await _reply_life(st, hp, armor)
    await _reply_magazine(st, mag, reserve, hp, armor)


def _query_times(st) -> list[float]:
    """Every clock time a `$QUERY,*` actually went out (the tx log, not the fake's replies)."""
    return [l["t"] for l in st.log if l["kind"] == "tx" and l["text"] == QUERY]


def _life_probe_times(st) -> list[float]:
    """Every clock time a `PROBE_LIFE` (`$LIFE,0,0,0,*`) actually went out."""
    return [l["t"] for l in st.log if l["kind"] == "tx" and l["text"] == PROBE_LIFE]


def _deaths(st) -> list[dict]:
    return [l for l in st.log if "☠ down" in l["text"]]


def _has(st, needle: str) -> bool:
    return any(needle in l["text"] for l in st.log)


# ---------------------------------------------------------------- the probe itself

def test_probe_life_is_byte_exactly_life_0_0_0_never_a_helper_with_arguments():
    """THE HAZARD: a non-zero token 1 is the REVIVE path, so a probe carrying one silently revives the
    player. This is why `PROBE_LIFE` is a bare constant and `_ask_gun`/`_cure_reassert` never build a
    `$LIFE` frame from arguments."""
    assert PROBE_LIFE == "$LIFE,0,0,0,*"

    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        n = len(tx(mgr))
        await _stall(st, clock)
        w = tx(mgr)[n:]
        assert "$LIFE,0,0,0,*" in w, f"the cure's probe carries the exact byte-for-byte frame: {w}"
    asyncio.run(run())


def test_the_cures_first_probe_life_step_sends_life_alone_never_query():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        n = len(tx(mgr))
        await _stall(st, clock)
        w = tx(mgr)[n:]
        assert w.count("$LIFE,0,0,0,*") == 1 and w.count(QUERY) == 0, f"$LIFE alone, on the life step: {w}"
    asyncio.run(run())


def test_the_alive_path_sends_exactly_one_query_once_the_life_step_proves_it():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _stall(st, clock)
        n = len(tx(mgr))
        await _reply_life(st, 45, 70)
        w = tx(mgr)[n:]
        assert w.count(QUERY) == 1, f"exactly one $QUERY, once the gun proves alive: {w}"
        assert w.count("$LIFE,0,0,0,*") == 0, f"no further $LIFE probes once alive: {w}"
    asyncio.run(run())


def test_the_dead_path_never_sends_a_query_at_all():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        n = len(tx(mgr))
        await _stall(st, clock)
        await _reply_life(st, 0, 0, 0)
        w = tx(mgr)[n:]
        assert QUERY not in w, f"the dead path never asks for a magazine: {w}"
    asyncio.run(run())


# ---------------------------------------------------------------- the trigger

def test_the_cure_asks_at_no_fire_pulls_and_not_at_one_fewer():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _adv(st, clock, GunStage.QUERY_POLL_S + 1.0)   # let the divergence poll have its turn first
        n = len(tx(mgr)); polls = len(_life_probe_times(st))
        await _stall(st, clock, GunStage.NO_FIRE_PULLS - 1)
        assert st.pool_stale() is None, "CONTROL: two unanswered pulls are not yet a claim"
        assert len(_life_probe_times(st)) == polls, "and nothing is asked"
        await _pull(st, clock)
        s = st.pool_stale()
        assert s and s["why"] == "no_fire"
        assert len(_life_probe_times(st)) == polls + 1, f"the third pull asks the gun exactly once: {tx(mgr)[n:]}"
        assert any(l["kind"] == "tx" and l["text"] == PROBE_LIFE and "asking the gun where it stands" in l["why"]
                   for l in st.log), "and says why"
        assert st.cure == {"verdict": "asking", "at": st.cure["at"]}
    asyncio.run(run())


def test_the_ask_is_known_frames_which_the_deny_list_passes():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        n = len(tx(mgr))
        await _stall(st, clock)
        w = [f for f in tx(mgr)[n:] if f not in (QUERY, "$LIFE,0,0,0,*")]
        assert w == [], f"the cure writes nothing but its probes: {tx(mgr)[n:]}"
        assert st.refused == 0, "$QUERY and $LIFE are known commands, never refused by `write`"
    asyncio.run(run())


# ---------------------------------------------------------------- the dead gun

def test_a_dead_reply_via_life_books_exactly_one_death_marked_desync_and_sets_verdict_dead():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _stall(st, clock)
        assert st.alive is True, "setup: the stage still believes the player is alive"
        await _reply_life(st, 0, 0, 0)
        deaths = _deaths(st)
        assert len(deaths) == 1, f"exactly one death: {deaths}"
        assert "desync" in deaths[0]["text"], "the node learned it out of band, from its own question (F264)"
        assert st.alive is False
        assert st.pool_stale() is None, "the stale claim is answered"
        assert st.cure["verdict"] == "dead"
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
        await _reply_life(st, 0, 0, 0)
        w = tx(mgr)[n:]
        assert not any(f.startswith("$SPAWN") for f in w), f"the answer itself writes no spawn: the respawn timer owns that: {w}"
        assert len(_deaths(st)) == 1, "and there is one death, not two"
    asyncio.run(run())


def test_a_gun_that_dies_between_the_two_probes_books_the_death_off_the_querys_lcd_marked_desync():
    """The life step proved it ALIVE; then, between the two probes (a hit lands, or a fresh `no_fire`
    could not have caught it any sooner), the gun dies. `$QUERY`'s own `$LCD` reply carries health 0 and
    must book the death -- through the SAME path, still marked desync -- rather than the cure re-asserting
    arming onto a gun it just found out is dead."""
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _stall(st, clock)
        await _reply_life(st, 45, 70)
        assert st._cure is not None and st._cure["step"] == "mag", "setup: the life step proved it alive"
        assert st.alive is True
        n = len(tx(mgr))
        await _reply_magazine(st, mag=0, reserve=0, hp=0, armor=0)
        deaths = _deaths(st)
        assert len(deaths) == 1, f"the $QUERY reply's own $LCD books the death: {deaths}"
        assert "desync" in deaths[0]["text"]
        assert st.alive is False
        assert st.cure["verdict"] == "dead"
        w = tx(mgr)[n:]
        assert not any(f.startswith("$AMMO,") for f in w), f"never re-asserts arming onto a gun just found dead: {w}"
    asyncio.run(run())


def test_a_malformed_lcd_reply_leaves_the_alive_evidence_standing_not_no_answer():
    """levers claim 19: the `$QUERY` token map is confirmed by SHAPE only. A reply that does not fit it is
    treated as no reply, not trusted -- here, too few tokens (`$LCD,45,70,*`, no magazine/reserve). The
    gun is already KNOWN alive (from the life step); this must not downgrade that to `no_answer`."""
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _stall(st, clock)
        await _reply_life(st, 45, 70)
        assert st._cure is not None and st._cure["step"] == "mag"
        st._inject_rx("$LCD,45,70,*")
        await settle(st)
        assert st._cure is not None and st._cure["step"] == "mag", "the mag step stays in flight -- a bad shape is no reply"
        assert st.cure["verdict"] == "asking", "not downgraded to no_answer -- the gun is already known alive"
        assert _has(st, "does not fit"), "and says why"
    asyncio.run(run())


# ---------------------------------------------------------------- the live gun (re-assert, never revive)

def test_stale_belief_false_positive_the_gun_says_empty_the_node_believed_it_loaded_reassert_never_revive():
    """THE FALSE POSITIVE THIS EXISTS FOR: the node's OWN account said the magazine was loaded (it is, in
    `_live()`'s setup: 29 rounds), the gun answers alive and EMPTY, and the cure must re-assert the GUN'S
    OWN (empty) counts -- never revive, and never trust the node's stale belief."""
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _stall(st, clock)
        n = len(tx(mgr))
        await _reply_alive(st, 45, 70, 0, 90)
        assert st.alive is True, "no revive"
        w = tx(mgr)[n:]
        assert f"$AMMO,{st.active_slot},0,90,1,*" in w, f"the gun's own (empty) counts go back, not the node's stale belief: {w}"
        assert any(f.startswith("$BMAP,0,0") for f in w), "and the trigger mapping"
        assert not any(f.startswith("$SPAWN") or f.startswith("$PSET") or f.startswith("$SIR,") for f in w), f"nothing that heals or re-heads: {w}"
        assert st.cure["verdict"] == "alive"
    asyncio.run(run())


def test_alive_reply_with_a_loaded_magazine_also_reasserts_the_guns_own_counts_never_revives():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _stall(st, clock)
        n = len(tx(mgr))
        await _reply_alive(st, 45, 70, 25, 90)         # alive, loaded, and still not answering the trigger
        assert st.alive is True, "no revive"
        w = tx(mgr)[n:]
        assert f"$AMMO,{st.active_slot},25,90,1,*" in w, f"the gun's own counts go back: {w}"
        assert any(f.startswith("$BMAP,0,0") for f in w)
        assert not any(f.startswith("$SPAWN") or f.startswith("$PSET") for f in w)
    asyncio.run(run())


def test_alive_reply_with_no_magazine_reported_reasserts_the_trigger_mapping_only():
    """If mag or reserve is not reported, write the `$BMAP` only -- never guess a magazine into an `$AMMO`."""
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _stall(st, clock)
        await _reply_life(st, 45, 70)
        n = len(tx(mgr))
        st._inject_rx("$LCD,45,70,0,0,,,*")            # tokens present but empty: "not reported"
        await settle(st)
        w = tx(mgr)[n:]
        assert not any(f.startswith("$AMMO,") for f in w), f"no magazine reported -- no $AMMO write: {w}"
        assert any(f.startswith("$BMAP,0,0") for f in w)
    asyncio.run(run())


def test_an_unanswered_magazine_ends_at_alive_not_no_answer_and_writes_only_the_bmap():
    """The gun already PROVED it is alive over `$LIFE`; only the magazine is unknown. That must end at
    `alive`, never `no_answer` -- the operator's board must not say "cannot tell dead from stuck" about a
    gun that has just told it which one."""
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _stall(st, clock)
        await _reply_life(st, 45, 70)
        assert st._cure is not None and st._cure["step"] == "mag"
        n = len(tx(mgr))
        await _adv(st, clock, (GunStage.QUERY_REPLY_S + 0.3) * GunStage.CURE_ASKS)
        w = tx(mgr)[n:]
        assert st._cure is None
        assert st.cure["verdict"] == "alive", f"the gun already proved alive via $LIFE -- not no_answer: {st.cure}"
        assert not any(f.startswith("$AMMO,") for f in w), f"the magazine was never confirmed -- no $AMMO: {w}"
        assert any(f.startswith("$BMAP,0,0") for f in w), f"but the trigger mapping still goes back: {w}"
        assert st.alive is True
        assert _has(st, "never answered $QUERY")
    asyncio.run(run())


def test_the_mag_step_asks_for_the_magazine_exactly_once_never_retried_like_the_life_step():
    """Polish review: engine.js `_cureTick` checks the 'mag' step BEFORE any retry, so an unanswered
    `$QUERY` gets exactly one ask, never `CURE_ASKS` of them like the 'life' step. The stage used to
    retry the mag step too, which left `st.cure['verdict']` sitting at `'asking'` for far longer than
    the engine ever does."""
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _stall(st, clock)
        await _reply_life(st, 45, 70)
        assert st._cure is not None and st._cure["step"] == "mag"
        n = len(tx(mgr))
        await _adv(st, clock, GunStage.QUERY_REPLY_S + 0.3)   # past ONE probe window, not CURE_ASKS of them
        w = [f for f in tx(mgr)[n:] if f == QUERY]
        assert len(w) == 0, f"the mag step's one ask already went out before the stall -- none more: {w}"
        assert st._cure is None, "one unanswered $QUERY step must conclude, not retry"
        assert st.cure["verdict"] == "alive"
    asyncio.run(run())


def test_a_solicited_hp_that_lands_during_the_mag_step_concludes_alive_not_a_fresh_life_probe():
    """Polish review: `_cure_answer` used to branch on `kind` before checking `c['step']`, so an `$HP`
    reply landing while the mag step is already asking for the magazine -- the operator presses RESYNC
    GUN mid-cure, which sends its own `$LIFE` probe -- reset the mag step back to `asks=1` and asked
    for the magazine again, instead of concluding like a gun that has just answered ALIVE, as
    engine.js's `kind === 'HP' && c.step === 'life'` guard does."""
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _stall(st, clock)
        await _reply_life(st, 45, 70)
        assert st._cure is not None and st._cure["step"] == "mag"
        n = len(tx(mgr))
        await st.resync(); await settle(st)          # the operator's own $LIFE probe, mid-cure
        assert PROBE_LIFE in tx(mgr)[n:], "setup: the resync's own probe went out"
        n2 = len(tx(mgr))
        st._inject_rx("$HP,45,70,0,*")
        await settle(st)
        assert QUERY not in tx(mgr)[n2:], "the answer must not re-ask the magazine from scratch"
        assert st._cure is None, "it must conclude, not stay in flight"
        assert st.cure["verdict"] == "alive"
    asyncio.run(run())


def test_companion_when_the_belief_is_correct_and_the_magazine_is_empty_the_cure_never_even_runs():
    """The companion to the false positive above: when the node's account agrees the magazine is empty,
    `_await_shot` dry-fires and never awaits a shot at all, so no pull is ever counted and the cure never
    starts -- there is nothing here for it to correct."""
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        st._inject_rx("$ALCD,0,100,0,192,0,*")         # the gun (and the node's account) agree: empty
        for _ in range(5):
            await _pull(st, clock)
        assert st._no_fire_pulls == 0, "an empty magazine dry-fires: no shot is ever awaited"
        assert st.pool_stale() is None
        assert st._cure is None, "the cure never even starts"
    asyncio.run(run())


# ---------------------------------------------------------------- no reply at all: do nothing

def test_no_reply_to_the_life_probe_does_nothing_writes_nothing_and_sets_verdict_no_answer():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        polls = len(_life_probe_times(st))
        await _stall(st, clock)
        assert len(_life_probe_times(st)) - polls == 1, "setup: the cure has probed once"
        await _adv(st, clock, GunStage.QUERY_REPLY_S + 0.3)
        assert len(_life_probe_times(st)) - polls == GunStage.CURE_ASKS, \
            f"a lost notification is ordinary: it probes {GunStage.CURE_ASKS} times"
        n = len(tx(mgr))
        await _adv(st, clock, GunStage.QUERY_REPLY_S + 0.3)
        w = tx(mgr)[n:]
        assert w == [], f"the node writes NOTHING on no evidence: {w}"
        assert st.alive is True, "no revive, no death: the node did nothing"
        assert st.cure["verdict"] == "no_answer"
        assert _has(st, "doing") and _has(st, "NOTHING"), "and says it is doing nothing"
        assert _has(st, f"hp {st.hp}") and _has(st, "in the magazine"), "and logs the values it went in with"
        n2 = len(tx(mgr))
        await _stall(st, clock)                        # the fresh stall goes straight back to not firing
        assert sum(1 for f in tx(mgr)[n2:] if f == "$LIFE,0,0,0,*") == 0, "the cooldown refuses a second cure in the same breath"
    asyncio.run(run())


# ---------------------------------------------------------------- verdict lifecycle

def test_verdict_is_none_until_a_cure_runs_then_tracks_the_outcome():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        assert st.cure is None
        await _stall(st, clock)
        assert st.cure["verdict"] == "asking"
        await _reply_life(st, 0, 0, 0)
        assert st.cure["verdict"] == "dead"
        assert st.state()["model"]["cure"] == {"verdict": "dead", "at": st.cure["at"]}
    asyncio.run(run())


def test_verdict_stays_asking_through_the_mag_step():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _stall(st, clock)
        await _reply_life(st, 45, 70)
        assert st.cure["verdict"] == "asking", "still asking -- now for the magazine"
        await _reply_magazine(st, 25, 90)
        assert st.cure["verdict"] == "alive"
    asyncio.run(run())


def test_a_new_match_clears_the_cure_and_its_verdict():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _stall(st, clock)
        assert st._cure is not None and st.cure is not None
        await st.arm()
        assert st._cure is None and st.cure is None
    asyncio.run(run())


def test_a_stale_verdict_holds_through_a_volts_and_retires_on_an_unsolicited_alcd():
    """Crying wolf is its own failure: a `no_answer` verdict must not sit on the operator's board for the
    rest of the match over a gun that has come back on its own, or the next REAL `no_answer` reads as the
    same stale chip. But it must retire on POOL FRAMES ONLY -- `$VOLTS` kept arriving right through both
    proven F264 stalls, so treating it as proof would make a dead-but-chatty gun look cured."""
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _stall(st, clock)
        await _adv(st, clock, (GunStage.QUERY_REPLY_S + 0.3) * GunStage.CURE_ASKS)
        assert st.cure["verdict"] == "no_answer", "setup: a stale verdict is sitting on the board"
        st._inject_rx("$VOLTS,8428,4164,100,100,*")
        assert st.cure is not None and st.cure["verdict"] == "no_answer", "a $VOLTS must NOT retire it"
        st._inject_rx("$ALCD,29,100,0,192,0,*")           # the gun reporting on its own, unsolicited
        assert st.cure is None, "an unsolicited pool frame retires the stale verdict"
        assert _has(st, "cure verdict 'no_answer' cleared"), "and says so"
    asyncio.run(run())


# ---------------------------------------------------------------- the late, unterminated $QUERY body

def test_a_late_unterminated_query_body_is_logged_and_books_nothing():
    """Bench 2026-09-19: a dead gun holds its `$QUERY` status-array print loop for ~2 s before a late,
    UNTERMINATED body (no trailing `*`) finally arrives. It carries no health number, so it must book
    nothing at all -- only a log line."""
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _stall(st, clock)
        await _reply_life(st, 45, 70)                  # step 1 resolves alive; step 2 ('mag') now asking
        assert st._cure is not None and st._cure["step"] == "mag"
        n = len(tx(mgr))
        n_log = len(st.log)
        st._inject_rx("$QUERY,0,1,45,70,0,,1,0,,0")     # no trailing '*': the dead-gun signature
        await settle(st)
        assert tx(mgr)[n:] == [], "nothing written for a frame with no health number in it"
        assert len(_deaths(st)) == 0, "and nothing booked"
        assert st._cure is not None and st._cure["step"] == "mag", "the mag step is untouched by this"
        assert any("unterminated" in l["text"] for l in list(st.log)[n_log:]), "and it is logged"
    asyncio.run(run())


def test_a_normal_terminated_query_reply_is_not_mistaken_for_the_late_body():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _stall(st, clock)
        await _reply_life(st, 45, 70)
        n_log = len(st.log)
        st._inject_rx("$QUERY,7,1,45,70,0,0,1,*")       # terminated: the ordinary status array
        await settle(st)
        assert not any("unterminated" in l["text"] for l in list(st.log)[n_log:])
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
        st._cure = None; st._cure_life = None; st._cure_at = 0.0; st.cure = None   # ...and the cure has not run yet
        n = len(tx(mgr))
        await _adv_hold(st, clock, (GunStage.QUERY_REPLY_S + 0.3) * (GunStage.CURE_ASKS + 1), apply)
        w = tx(mgr)[n:]
        assert st._cure_life is None, f"{name} must never start a cure"
        assert st._cure is None, f"{name} must leave no ask in flight"
        assert st.cure is None, f"{name} must never set a verdict"
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
        st._cure = None; st._cure_life = None; st._cure_at = 0.0; st.cure = None
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


def test_an_ask_in_flight_when_the_link_drops_is_abandoned_not_timed_out_into_anything():
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
        assert not any(f.startswith("$SPAWN") or f.startswith("$AMMO,") for f in w), f"the relink owes the old ask nothing: {w}"
    asyncio.run(run())


# ---------------------------------------------------------------- the poll

def test_the_heartbeat_poll_sends_life_and_never_query():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        n = len(tx(mgr))
        await _adv(st, clock, GunStage.QUERY_POLL_S * 2 + 0.5)
        w = tx(mgr)[n:]
        assert w.count(QUERY) == 0, f"the heartbeat never sends $QUERY (v3): {w}"
        assert w.count("$LIFE,0,0,0,*") >= 2, f"and it does send $LIFE: {w}"
    asyncio.run(run())


def test_the_divergence_poll_runs_only_in_a_live_match_at_query_poll_s():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        n = len(_life_probe_times(st))
        await _adv(st, clock, GunStage.QUERY_POLL_S * 3 + 0.5)
        times = _life_probe_times(st)
        assert len(times) - n == 3, f"3 asks in 3 cadences, no more: {len(times) - n}"
        gaps = [b - a for a, b in zip(times[n - 1:], times[n:])]
        for g in gaps:
            assert GunStage.QUERY_POLL_S <= g < GunStage.QUERY_POLL_S + 0.5, f"every gap is one cadence, not a burst: {gaps}"
        await st.end(); await settle(st)
        w = len(tx(mgr))
        await _adv(st, clock, GunStage.QUERY_POLL_S * 3)
        assert not any(f == "$LIFE,0,0,0,*" for f in tx(mgr)[w:]), "a match that is over polls nothing"
    asyncio.run(run())


def test_a_poll_never_runs_before_a_match_spawns():
    async def run():
        st, mgr, clock = _mk()
        await st.connect(GUN)                            # connected, but not armed/spawned -- no phase in the stage beyond `spawned`
        n = len(tx(mgr))
        await _adv(st, clock, GunStage.QUERY_POLL_S * 3)
        assert not any(f == "$LIFE,0,0,0,*" for f in tx(mgr)[n:]), "nothing polls an unspawned gun"
    asyncio.run(run())


def test_a_poll_reply_does_not_clear_the_no_fire_count():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        await _pull(st, clock); await _pull(st, clock)
        assert st._no_fire_pulls == 2, "setup: two unanswered pulls"
        n = len(_life_probe_times(st))
        end = clock() + GunStage.QUERY_POLL_S * 2
        while clock() < end and len(_life_probe_times(st)) == n:
            clock.advance(0.25); st.poll(); await settle(st)
        assert len(_life_probe_times(st)) > n, "no ask went out"
        await _reply_life(st, 45, 70)
        assert st._no_fire_pulls == 2, "the solicited $HP leaves the unanswered pulls standing"
        assert st.pool_stale() is None, "CONTROL: two is still not a claim"
        # CONTROL: an UNSOLICITED pool frame is the gun answering the trigger, and still clears it.
        st._inject_rx("$ALCD,24,100,0,192,0,*")
        assert st._no_fire_pulls == 0
    asyncio.run(run())


def test_a_poll_that_finds_the_gun_dead_books_the_death_with_no_trigger_pulled():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        n = len(_life_probe_times(st))
        end = clock() + GunStage.QUERY_POLL_S * 2
        while clock() < end and len(_life_probe_times(st)) == n:
            clock.advance(0.25); st.poll(); await settle(st)
        assert st._cure is None, "setup: this is the poll, not a cure"
        await _reply_life(st, 0, 0, 0)
        deaths = _deaths(st)
        assert len(deaths) == 1, "the divergence is caught with no dead trigger pulled"
        assert "desync" in deaths[0]["text"]
        assert st.alive is False
    asyncio.run(run())


def test_the_write_cost_of_the_heartbeat_poll_is_3_frames_a_minute_and_nothing_else():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        n = len(_life_probe_times(st))
        await _adv(st, clock, 60.0)
        added = len(_life_probe_times(st)) - n
        assert added == 3, f"{added} asks in a quiet minute"
        assert QUERY == "$QUERY,*" and len(QUERY) == 8 and len(PROBE_LIFE) == 13
    asyncio.run(run())


# ---------------------------------------------------------------- the spawn read-back

def test_the_spawn_probe_runs_once_per_life_life_alone_after_spawn_probe_s_and_stamps_the_polls_clock():
    async def run():
        st, mgr, clock = _mk()
        await st.connect(GUN)
        await st.arm(); await st.spawn(); await settle(st)
        await _adv(st, clock, 0.5)                      # settle the immediate heartbeat's first tick out of the way
        assert st._probed_life is None, "setup: the spawn probe has not run yet"
        poll_before = st._poll_at
        n = len(tx(mgr))
        await _adv(st, clock, GunStage.SPAWN_PROBE_S + 0.5)
        w = tx(mgr)[n:]
        assert w.count(QUERY) == 0, f"the spawn read-back is $LIFE, never $QUERY (v3): {w}"
        assert w.count("$LIFE,0,0,0,*") == 1, f"and it does ask, once: {w}"
        assert st._probed_life == st._life
        assert st._poll_at > poll_before, "the spawn probe stamps the heartbeat's own clock, so it does not also fire in the same breath"
        n2 = len(tx(mgr))
        await _adv(st, clock, 1.0)
        assert tx(mgr)[n2:].count("$LIFE,0,0,0,*") == 0, "and no second ask right behind it"
        await st.revive(); await settle(st)
        assert st._probed_life != st._life, "a fresh life is due its own read-back"
    asyncio.run(run())


def test_operator_resync_probes_the_gun_with_life_alone_before_its_own_writes():
    async def run():
        st, mgr, clock = _mk()
        await _live(st, clock)
        n = len(tx(mgr))
        await st.resync(); await settle(st)
        w = tx(mgr)[n:]
        assert "$LIFE,0,0,0,*" in w, f"RESYNC GUN reads before it writes: {w}"
        assert QUERY not in w, f"and never asks $QUERY from here (v3): {w}"
        life_i = w.index("$LIFE,0,0,0,*")
        ammo_i = next(i for i, f in enumerate(w) if f.startswith("$AMMO,") or f.startswith("$TID,") or f.startswith("$BMAP,"))
        assert life_i < ammo_i, f"the probe goes out before the resync's own writes: {w}"
    asyncio.run(run())


# ---------------------------------------------------------------- fake.py: the dead-gun $LIFE ambiguity

def test_fake_dead_gun_life_probe_reading_is_switchable_and_a_real_revive_still_works():
    """Bench 2026-09-19 (two taggers, v4.32) settled the repo's self-contradiction: a dead gun answers
    `$LIFE,0,0,0,*` IMMEDIATELY with `$HP,0,0,0` -- the MEASURED default now. protocol/brx-protocol.md's
    `$LIFE` row and docs/bench-firmware-levers-2026-09-19.md §22 still read the SUPERSEDED silence
    reading and want correcting; it stays selectable for a test."""
    tagger = FakeTagger(GUN, "FAKE-STAGE", team=1)
    tagger.go_dead_chatty()
    assert tagger.dead_gun_answers_life is True, "the measured reading is the default"
    tagger.write("$LIFE,0,0,0,*")
    assert tagger.drain() == ["$HP,0,0,0,*"], "measured default: answers immediately"
    tagger.dead_gun_answers_life = False
    tagger.write("$LIFE,0,0,0,*")
    assert tagger.drain() == [], "the superseded (silent) reading, switched on for a test"
    # THE HAZARD, re-proven at the fake: a non-zero token is the REVIVE path under EITHER reading.
    tagger.dead_gun_answers_life = True
    tagger.write("$LIFE,30,0,0,*")
    assert tagger.alive is True and tagger.hp == 30, "a real revive (non-zero token) still works regardless of the probe flag"


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


# ---------------------------------------------------------------- end to end, against the fake gun

def test_end_to_end_measured_reading_dead_chatty_gun_is_cured_via_the_life_probe():
    async def run():
        st, mgr, clock = _mk()
        tagger = mgr.taggers[GUN]
        tagger.listening = True                          # this test wants the REAL fake gun answering
        await _live(st, clock)
        tagger.go_dead_chatty()                          # the gun goes dead silently
        assert tagger.dead_gun_answers_life is True, "the measured reading -- $LIFE answers immediately"
        assert not _has(st, "gun not firing"), "setup: no claim yet"
        await _stall(st, clock)                          # the player pulls three times, into silence
        assert _has(st, "gun not firing"), "the unanswered pulls built the claim"
        deaths = _deaths(st)
        assert len(deaths) == 1, f"the fake's own $LIFE probe reply books the death: {deaths}"
        assert "desync" in deaths[0]["text"]
        assert st.alive is False
        n = len(tx(mgr))
        await st.revive(); await settle(st)
        assert st.alive is True
        assert any(f.startswith("$SPAWN") for f in tx(mgr)[n:]), "the respawn's own $SPAWN clears the fake's dead-chatty state too"
    asyncio.run(run())


def test_end_to_end_the_superseded_silent_reading_cannot_detect_a_dead_chatty_gun():
    """Historical/regression proof: under the SUPERSEDED reading (silence), a dead-chatty gun cannot be
    told apart from a merely-stuck one -- which is exactly why the bench measurement (2026-09-19) matters.
    The cure times out at `no_answer` and never books the death; the node correctly refuses to guess."""
    async def run():
        st, mgr, clock = _mk()
        tagger = mgr.taggers[GUN]
        tagger.listening = True
        await _live(st, clock)
        tagger.go_dead_chatty()
        tagger.dead_gun_answers_life = False              # the superseded reading, switched on for this test
        await _stall(st, clock)
        await _adv(st, clock, (GunStage.QUERY_REPLY_S + 0.3) * GunStage.CURE_ASKS)
        assert len(_deaths(st)) == 0, "under the superseded reading, the probe cannot prove anything"
        assert st.cure["verdict"] == "no_answer"
        assert st.alive is True, "the node still believes it -- correctly refusing to guess"
    asyncio.run(run())
