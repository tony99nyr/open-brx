"""The built-in chaos invariants. Each one runs after every step of every scenario (or once at the end,
`when="end"`), and raises `InvariantError` on a breach.

Most of them compare MC's scorer with the `Ledger`, the independent record of what the field emitted.
A fact counts as DELIVERED once its node has had it acknowledged (it has left the node's ring).

To add one: write a function (world) -> None here, decorate it with `@invariant("name")`, and raise
`InvariantError(name, message)` with the evidence. It then applies to every scenario.
"""
from __future__ import annotations

from collections import Counter

from ..mc.types import AWARDS, CLOCK_TIE_MS, MEDALS, MULTI_KILL_MS
from .registry import InvariantError, invariant
from .world import World

# Every phase change a running Session may make by itself or on an operator action. `resume` is the
# restart path: a new process comes back in the phase the old one was in (or in RECAP, when the
# match ended while MC was down).
LEGAL = {
    ("muster", "build"), ("muster", "kit"), ("muster", "lobby"), ("build", "kit"), ("build", "lobby"),
    ("kit", "lobby"), ("lobby", "kit"), ("kit", "build"), ("lobby", "build"), ("build", "muster"),
    ("kit", "armed"), ("lobby", "armed"), ("armed", "live"), ("armed", "lobby"),
    ("armed", "recap"), ("live", "recap"), ("armed", "kit"), ("live", "kit"),
    ("recap", "muster"), ("recap", "build"), ("recap", "kit"), ("recap", "lobby"),
}


def _fail(name: str, msg: str) -> None:
    raise InvariantError(name, msg)


def _current(world: World):
    sc = world.session.scorer
    if sc is None:
        return None, []
    return sc, world.ledger.delivered(world.nodes, sc.match_id)


def _post_end_keys(sc) -> set[tuple[str, int]]:
    return {(nid, int(ev.get("seq"))) for nid, ev, _t in sc.post_end if ev.get("seq") is not None}


def _expected(world: World, sc, facts):
    """What the credited facts add up to, player by player, by the ledger's account."""
    num_pid = world.num_to_pid()
    post = _post_end_keys(sc)
    kills: Counter = Counter()
    deaths: Counter = Counter()
    kill_pairs: Counter = Counter()
    groups: dict[str, set] = {}
    ungrouped: Counter = Counter()
    for nid, seq, ev in facts:
        if (nid, seq) in post:
            continue
        victim = ev.get("player_id")
        shooter = num_pid.get(int(ev.get("shooter_num", 0) or 0))
        if shooter == victim:
            shooter = None
        friendly = (shooter is not None and world.scenario.mode != "ffa"
                    and world.team_of(shooter) == world.team_of(victim))
        if ev.get("type") == "death":
            deaths[victim] += 1
            kill_pairs[(victim, shooter)] += 1
            if shooter:
                kills[shooter] += -1 if friendly else 1
        elif ev.get("type") == "hit_taken" and shooter and not friendly:
            g = ev.get("shot_group")
            if g is None:
                ungrouped[shooter] += 1
            else:
                groups.setdefault(shooter, set()).add((victim, str(g)))
    hits = Counter({pid: len(s) for pid, s in groups.items()}) + ungrouped
    return kills, deaths, hits, kill_pairs


@invariant("kills_credited_once")
def kills_credited_once(world: World) -> None:
    """Every delivered death is credited exactly once: it is either on the board or parked as an
    after-the-whistle fact, never both, never neither, and never twice."""
    sc, facts = _current(world)
    if sc is None:
        return
    _k, _d, _h, pairs = _expected(world, sc, facts)
    got = Counter((k["victim"], k["killer"]) for k in sc.kills)
    if got != pairs:
        _fail("kills_credited_once", f"MC's kill list {dict(got - pairs)} extra, {dict(pairs - got)} missing "
                                     f"(victim, killer) against the delivered deaths")


@invariant("scores_equal_facts")
def scores_equal_facts(world: World) -> None:
    """Each row's kills, deaths and hits equal the sum of the credited facts (a team kill is -1)."""
    sc, facts = _current(world)
    if sc is None:
        return
    kills, deaths, hits, _p = _expected(world, sc, facts)
    for r in sc.rows():
        pid = r["player_id"]
        want = (kills.get(pid, 0), deaths.get(pid, 0), hits.get(pid, 0))
        have = (r["kills"], r["deaths"], r["hits"])
        if want != have:
            _fail("scores_equal_facts", f"{r['display']}: board (kills, deaths, hits)={have}, facts say {want}")


@invariant("no_fact_double_counted")
def no_fact_double_counted(world: World) -> None:
    """MC has taken each delivered fact of this match exactly once: its dedup set is exactly the
    delivered (node, seq) set, whatever was resent, reordered or replayed after a restart."""
    sc, facts = _current(world)
    if sc is None:
        return
    want = {(nid, seq) for nid, seq, _ev in facts}
    have = set(sc.seen)
    if want != have:
        _fail("no_fact_double_counted", f"MC took {sorted(have - want)[:5]} it was never sent; "
                                        f"lost {sorted(want - have)[:5]}")


@invariant("stale_match_parks")
def stale_match_parks(world: World) -> None:
    """A fact stamped with another match's id is parked by the MC that took it, and scores nothing.
    (Scoring nothing is also `no_fact_double_counted`: the dedup set holds this match's facts only.)"""
    sc = world.session.scorer
    if sc is None or world.stack is None:
        return
    parked = {(nid, ev.get("seq")) for nid, ev, _t in sc.parked}
    pending = {(n.node_id, s) for n in world.nodes for s, _ in n.ring}
    for nid, seq, gen in world.stale_facts:
        if gen == world.stack.generation and (nid, seq) not in pending and (nid, seq) not in parked:
            _fail("stale_match_parks", f"the stale-match fact {nid}#{seq} was delivered and not parked")


@invariant("pools_in_range")
def pools_in_range(world: World) -> None:
    """No node and no MC mirror ever holds a negative pool or one above the armed maximum."""
    for n in world.nodes:
        if not (0 <= n.hp <= n.max_hp and 0 <= n.armor <= n.max_armor):
            _fail("pools_in_range", f"node {n.index}: hp {n.hp}/{n.max_hp}, armor {n.armor}/{n.max_armor}")
    sc = world.session.scorer
    if sc is None:
        return
    top = max((max(n.max_hp, n.max_armor) for n in world.nodes), default=0)
    for pid, st in sc.stats.items():
        if st.hp < 0 or st.armor < 0 or st.hp > top or st.armor > top:
            _fail("pools_in_range", f"MC mirrors {pid}: hp {st.hp}, armor {st.armor} (max {top})")
        if st.deaths < 0 or st.hits < 0 or st.assists < 0:
            _fail("pools_in_range", f"MC holds a negative count for {pid}: {st.deaths}/{st.hits}/{st.assists}")


@invariant("one_death_per_life")
def one_death_per_life(world: World) -> None:
    """A player dies at most once per life: deaths never outrun respawns + 1."""
    sc, facts = _current(world)
    if sc is None:
        return
    respawns = Counter(ev.get("player_id") for _n, _s, ev in facts if ev.get("type") == "respawn")
    post_deaths = Counter(ev.get("player_id") for _n, ev, _t in sc.post_end if ev.get("type") == "death")
    for pid, st in sc.stats.items():
        if st.deaths + post_deaths.get(pid, 0) > respawns.get(pid, 0) + 1:
            _fail("one_death_per_life", f"{pid}: {st.deaths} deaths (+{post_deaths.get(pid, 0)} after the end) "
                                        f"with only {respawns.get(pid, 0)} respawns")


@invariant("credited_inside_window")
def credited_inside_window(world: World) -> None:
    """A6.1: no credited fact from a clock-synced node carries a time after the match's end.

    The TIME LIMIT is known from the start, so no credited fact may be later than it, whenever it
    arrived. The operator's END and a FRAG CAP are moments MC learns as they happen: a fact MC took
    BEFORE that moment was scored by the rules in force then, so only a fact that arrived after it is
    judged by the end. (A fact from a phone whose clock runs ahead can carry a time after a cap that
    MC reached on an earlier arrival. Contracts §4 lets the end move EARLIER only, so that kill stays
    credited: un-crediting it would leave a match ended on a cap nobody holds.) The runner marks
    `end_delivered` after the step that ended the match, so a fact in that same step is exempt too:
    the chaos run cannot tell which of them arrived first."""
    sc, facts = _current(world)
    if sc is None:
        return
    tl = sc.time_limit_s
    limits = [sc.go_live_t + tl * 1000] if tl else []
    reason = next((f["reason"] for f in world.finishes if f["match_id"] == sc.match_id), None)
    host_end = reason in ("host", "time", "frag_limit") and sc.end_t is not None
    post = _post_end_keys(sc)
    before_end = world.end_delivered or set()
    for nid, seq, ev in facts:
        if (nid, seq) in post or ev.get("type") == "possession" or not world.session.synced_at_lobby.get(nid):
            continue
        t = int(ev.get("t", 0))
        end = min(limits) if limits else None
        if host_end and sc.end_t is not None and (nid, seq) not in before_end:
            end = sc.end_t if end is None else min(end, sc.end_t)
        if end is not None and t > end:
            _fail("credited_inside_window",
                  f"{nid}#{seq} {ev.get('type')} at t={t} is credited, but the match ended at {end} "
                  f"({(t - end) / 1000:.1f} s earlier; end by {reason})")


@invariant("legal_phase_transitions")
def legal_phase_transitions(world: World) -> None:
    """The phase machine only moves along legal edges, and a restart resumes the phase it left."""
    for a, b, how in world.transitions:
        if how == "resume":
            if b != a and not (a in ("live", "armed") and b == "recap"):
                _fail("legal_phase_transitions", f"an MC restart in {a.upper()} came back in {b.upper()}")
        elif (a, b) not in LEGAL:
            _fail("legal_phase_transitions", f"illegal phase change {a.upper()} -> {b.upper()}")


@invariant("tick_never_raises")
def tick_never_raises(world: World) -> None:
    """`Session.tick()` never raises. The server logs a failed tick and carries on, so a raise there is
    silent in the field: the timed end, the countdown and the end re-delivery would all stop."""
    if world.tick_errors:
        _fail("tick_never_raises", f"{len(world.tick_errors)} tick(s) raised; first: {world.tick_errors[0]}")


@invariant("no_config_to_live_node")
def no_config_to_live_node(world: World) -> None:
    """MC never pushes a `config` to a node in the middle of its match (a re-push clears `spawned`)."""
    for n in world.nodes:
        if n.live_configs:
            _fail("no_config_to_live_node", f"node {n.index} took {n.live_configs} config push(es) while LIVE")


@invariant("game_byte_matches_stations")
def game_byte_matches_stations(world: World) -> None:
    """One game byte per match (the 0.4.10 hotfix): a connected node that holds MC's current head holds the
    byte MC arms its stations with (`_arm_station` sends `_game_byte()` as `station_config.game`), across
    restarts and crashes. A phone on another byte ignores every MC-armed station, and they ignore it."""
    s = world.session
    want = s._game_byte()
    for n in world.nodes:
        cfg = n.context.get("config")
        if not n.link_up or not isinstance(cfg, dict) or cfg.get("config_id") != s.config.get("config_id"):
            continue
        if cfg.get("game_byte") != want:
            _fail("game_byte_matches_stations",
                  f"node {n.index} holds game_byte {cfg.get('game_byte')!r}; MC arms stations with {want}")


@invariant("snapshot_survives_restart")
def snapshot_survives_restart(world: World) -> None:
    """An MC restart mid-match brings back the same match, phase and board."""
    for c in world.restart_checks:
        b, a = c["before"], c["after"]
        if (b["match_id"], b["phase"], b["rows"]) != (a["match_id"], a["phase"], a["rows"]):
            diff = {pid: (b["rows"].get(pid), a["rows"].get(pid)) for pid in set(b["rows"]) | set(a["rows"])
                    if b["rows"].get(pid) != a["rows"].get(pid)}
            _fail("snapshot_survives_restart",
                  f"restart at step {c['step']}: {b['phase']}/{b['match_id']} -> {a['phase']}/{a['match_id']}; "
                  f"rows changed {diff}")


@invariant("possession_is_max_merged")
def possession_is_max_merged(world: World) -> None:
    """KOTH: each team's possession is the highest cumulative report any node delivered, never a sum,
    and never more than the match length."""
    sc, facts = _current(world)
    if sc is None:
        return
    best: dict[int, int] = {}
    for _nid, _seq, ev in facts:
        if ev.get("type") != "possession":
            continue
        for tid, ms in (ev.get("hold_ms") or {}).items():
            best[int(tid)] = max(best.get(int(tid), 0), int(ms))
    if not best:
        return
    cap = (sc.time_limit_s or 0) * 1000 or None
    poss = sc.possession() or {}
    tid_team = {t["tid"]: team_id for team_id, t in sc.teams.items()}
    want: dict[str, int] = {team_id: 0 for team_id in sc.teams}
    neutral = 0
    for tid, ms in best.items():
        ms = min(ms, cap) if cap else ms
        if tid in tid_team:
            want[tid_team[tid]] += ms
        else:
            neutral += ms
    want_s = {k: round(v / 1000) for k, v in want.items()}
    if poss.get("by_team") != want_s or poss.get("neutral_s") != round(neutral / 1000):
        _fail("possession_is_max_merged", f"MC possession {poss.get('by_team')} neutral {poss.get('neutral_s')}, "
                                          f"the reports say {want_s} neutral {round(neutral / 1000)}")


def credited_enemy_kills(world: World, sc, *, cued_before_end: bool = False) -> Counter:
    """The kills the ledger says MC must credit and cue: (killer, victim, t) for every emitted death of
    this match that is not parked after the end, whose shooter is a rostered player other than the
    victim, and that is not a team kill. Read from EVERY emitted fact, not only the acknowledged ones:
    MC can cue a kill before its ack reaches the node, and the cue must still match a real fact.

    `cued_before_end`: also count a death parked after the end if MC held it BEFORE the whistle
    (`world.end_delivered`). A late fact can move a frag-cap end EARLIER (A24/M2), and that parks a kill
    MC had already credited and cued live. A cue cannot be taken back, so that cue is legitimate."""
    num_pid = world.num_to_pid()
    post = _post_end_keys(sc)
    held = (world.end_delivered or set()) if cued_before_end else set()
    out: Counter = Counter()
    for (nid, seq), ev in world.ledger.facts.items():
        if ev.get("type") != "death" or ev.get("match_id") != sc.match_id:
            continue
        if (nid, seq) in post and (nid, seq) not in held:
            continue
        victim = str(ev.get("player_id"))
        killer = num_pid.get(int(ev.get("shooter_num", 0) or 0))
        if killer is None or killer == victim:
            continue
        if world.scenario.mode != "ffa" and world.team_of(killer) == world.team_of(victim):
            continue
        out[(killer, victim, int(ev.get("t", 0)))] += 1
    return out


def kill_feedback(world: World) -> Counter:
    """Every `feedback` of kind "kill" each node received, keyed as `credited_enemy_kills` keys them.
    A cue addressed to a player other than the node's own is keyed to the node's player, so a misroute
    shows up as a cue for a kill that player never made."""
    got: Counter = Counter()
    for n in world.nodes:
        own = world.players[n.index]["player_id"]
        for fb in n.feedback:
            if fb.get("kind") != "kill":
                continue
            who = fb.get("player_id") if fb.get("player_id") == own else f"{own}<-misrouted:{fb.get('player_id')}"
            got[(who, fb.get("victim"), int(fb.get("t", 0) or 0))] += 1
    return got


@invariant("kill_feedback_matches_credit")
def kill_feedback_matches_credit(world: World) -> None:
    """brx1 + brx4 (2026-09-24): every kill cue MC sends to a node matches exactly one kill credited to
    that node's player. No cue for a death nobody is credited with (an unknown or unrostered shooter, a
    self-kill, a team kill), and never two cues for one kill (a duplicate, a resend, a restart, a resume).

    ONE-WAY on purpose: cues are a SUBSET of credited kills. MC skips a cue by design when the kill is
    older than FEEDBACK_MAX_AGE_MS on arrival (a flush after a drop, a clock jump), when the victim's node
    never synced its clock (A5.7), in a replay (`_replay`, `_retire_scorer`), and when the killer's node
    has no socket (best effort, no queue). A kill MC cued live and a late fact then parked, by moving a
    frag-cap end earlier, still counts as credited (see `credited_enemy_kills`). A scenario with none of those checks the other direction
    itself (`every_kill_cued` in scenarios/regressions.py)."""
    sc = world.session.scorer
    if sc is None:
        return
    want = credited_enemy_kills(world, sc, cued_before_end=True)
    got = kill_feedback(world)
    extra = got - want
    if extra:
        _fail("kill_feedback_matches_credit",
              f"kill cues with no credited kill behind them (or one too many), as (player, victim, t): "
              f"{dict(list(extra.items())[:5])}")


# The medal table, read from `types.MEDALS` (the one table) and nowhere else.
_MULTI_COUNTS = sorted((m["count"], m["key"]) for m in MEDALS if m["kind"] == "multi")
_STREAK_COUNTS = {m["count"]: m["key"] for m in MEDALS if m["kind"] == "streak"}
_FIRST_KEY = next(m["key"] for m in MEDALS if m["kind"] == "first")
_KILLJOY_AT = next(m["count"] for m in MEDALS if m["kind"] == "killjoy")


def multi_medal_for(chain: int) -> str | None:
    """Halo 3's ladder: the HIGHEST multi medal whose count the chain has reached (None below the lowest)."""
    best = None
    for count, key in _MULTI_COUNTS:
        if chain >= count:
            best = key
    return best


def expected_medals(world: World, entries: list[dict]) -> list[tuple[str, str, int, tuple[str, ...]]]:
    """The medals each credited enemy kill must carry, derived from ONE scorer's input stream (the
    World's tap), as (killer, victim, t, medals) in the order the scorer took them.

    The fact's content comes from the ledger when it holds the (node, seq); the ORDER, t_recv, the batch
    re-base and the node's sync state come from the tap, because the medals depend on the order MC took
    the facts in, and a drop, a flush, a reorder or a restart's replay changes that order. MC's verdict
    ("scored" or not) is taken as given: dedup, the stale-match park and the end freeze are the other
    invariants' business. The rules, from scoring.py and types.MEDALS:

    * the chain: an enemy kill within MULTI_KILL_MS of the killer's previous enemy kill (by the scored
      time, which may be EARLIER after a reorder) extends it; a bigger gap starts a new chain of 1. The
      killer's own death does NOT reset the chain (only the streak).
    * A5.7 suppression (the VICTIM's node never synced, or its batch was re-based): the kill scores
      multi 1 and leaves the chain as it was, but it still moves the killer's previous-kill time.
    * first blood: the first credited enemy kill this scorer took.
    * a streak medal at its exact count of enemy kills without a death or a (non-operator) respawn.
    * killjoy (A63): the VICTIM's streak, before this death resets it, is at least the killjoy count.
    """
    num_pid = world.num_to_pid()
    streak: Counter = Counter()
    last_t: dict[str, int] = {}
    chain: dict[str, int] = {}
    first_taken = False
    out = []
    for e in entries:
        if e["result"] != "scored" or not isinstance(e["ev"], dict):
            continue
        ev = world.ledger.facts.get((e["node_id"], e["seq"]), e["ev"]) if e["seq"] is not None else e["ev"]
        kind = ev.get("type")
        pid = str(ev.get("player_id"))
        if kind == "respawn":
            if not ev.get("operator"):
                streak[pid] = 0
            continue
        if kind != "death":
            continue
        if e["rebase"] is not None:
            t = int(ev.get("t", e["t_recv"])) + e["rebase"]
        elif e["synced"]:
            t = int(ev.get("t", e["t_recv"]))
        else:
            t = int(e["t_recv"])
        suppressed = e["suppress"] or not e["synced"]
        victim_streak = streak[pid]
        streak[pid] = 0
        killer = num_pid.get(int(ev.get("shooter_num", 0) or 0))
        if killer is None or killer == pid:
            continue
        if world.scenario.mode != "ffa" and world.team_of(killer) == world.team_of(pid):
            continue
        streak[killer] += 1
        multi = 1
        if not suppressed:
            if killer in last_t and t - last_t[killer] <= MULTI_KILL_MS:
                chain[killer] = chain.get(killer, 1) + 1
                multi = chain[killer]
            else:
                chain[killer] = 1
        medals = []
        if not first_taken:
            first_taken = True
            medals.append(_FIRST_KEY)
        if (m := multi_medal_for(multi)) is not None:
            medals.append(m)
        if ev.get("melee") is True:            # A62: the melee medal, from the death fact's own flag
            medals.append("melee_kill")
        if victim_streak >= _KILLJOY_AT:
            medals.append("killjoy")
        if (m := _STREAK_COUNTS.get(streak[killer])) is not None:
            medals.append(m)
        last_t[killer] = t
        out.append((killer, pid, t, tuple(medals)))
    return out


@invariant("medals_track_credited_kills")
def medals_track_credited_kills(world: World) -> None:
    """Tony 2026-09-24 (Halo 3's multi-kill ladder): every enemy kill carries the medals its killer's
    credited kills imply: the ladder medal for the chain length at that kill, first blood once per match
    on the first credited kill, and a streak medal at its exact count (`expected_medals` has the rules).

    Two checks. (1) The current scorer's per-kill record (`kills[i]["medals"]`) equals what its own input
    stream implies, kill for kill. (2) Every kill cue a node received carries the medals that the input
    stream of SOME scorer of this match implies for that (killer, victim, t): the cue came from the scorer
    live at the time, which a restart or a frag-cap reconcile may since have replaced, and a replay can
    take the facts in another order. Check (2) is one-way, as `kill_feedback_matches_credit` is: MC skips a
    cue by design (a stale kill, an unsynced victim node, a replay, no socket), and that invariant already
    fails a cue with no credited kill behind it."""
    sc = world.session.scorer
    if sc is None:
        return
    mine = world.ingests.get(id(sc), [])
    want = expected_medals(world, mine)
    have = [(k["killer"], k["victim"], int(k["t"]), tuple(k["medals"])) for k in sc.kills if "medals" in k]
    if want != have:
        i = next((j for j, (a, b) in enumerate(zip(want, have)) if a != b), min(len(want), len(have)))
        _fail("medals_track_credited_kills",
              f"kill #{i + 1} of {len(have)} (killer, victim, t, medals): MC recorded "
              f"{have[i] if i < len(have) else None}, its credited kills imply {want[i] if i < len(want) else None}")
    allowed: dict[tuple[str, str, int], set[tuple[str, ...]]] = {}
    for sid, entries in world.ingests.items():
        if getattr(world.scorers.get(sid), "match_id", None) != sc.match_id:
            continue
        for killer, victim, t, medals in expected_medals(world, entries):
            allowed.setdefault((killer, victim, t), set()).add(medals)
    for n in world.nodes:
        for fb in n.feedback:
            if fb.get("kind") != "kill" or fb.get("player_id") is None:
                continue
            key = (str(fb["player_id"]), str(fb.get("victim")), int(fb.get("t", 0) or 0))
            if key not in allowed:
                continue            # a cue with no credited kill is `kill_feedback_matches_credit`'s to fail
            got = tuple(fb.get("medals") or ())
            if got not in allowed[key]:
                _fail("medals_track_credited_kills",
                      f"node {n.index}'s kill cue for {key} carried medals {list(got)}; the credited kills "
                      f"imply {sorted(allowed[key])}")


# ------------------------------------------------------------------------------ end of the run
@invariant("honors_from_ledger", when="end")
def honors_from_ledger(world: World) -> None:
    """A63: the recap's awards name only rostered players under their AWARDS key and label, none under 3
    scored players, and the simple ones agree with the ledger: MOST KILLS is the top credited kill count,
    IRON MAN the fewest delivered deaths among reporting players who were there from go-live (never a hot joiner),
    and WINGMAN the top assist count on the board."""
    s = world.session
    sc = s.scorer
    if sc is None or s.last_recap is None:
        return
    honors = s.last_recap.get("honors") or []
    labels = {a["key"]: a["label"] for a in AWARDS}
    rostered = {p["player_id"] for p in world.players}
    for h in honors:
        if h.get("player_id") not in rostered or labels.get(str(h.get("key"))) != h.get("award"):
            _fail("honors_from_ledger", f"an honor names no rostered player or no AWARDS row: {h}")
    if len(sc.stats) < 3:
        if honors:
            _fail("honors_from_ledger", f"{len(sc.stats)} scored player(s), yet honors {honors}")
        return
    kills, deaths, _h, _p = _expected(world, sc, world.ledger.delivered(world.nodes, sc.match_id))
    def holders(key: str) -> set[str]:
        return {h["player_id"] for h in honors if h.get("key") == key}
    top_k = max((kills.get(pid, 0) for pid in sc.stats), default=0)
    want = {pid for pid in sc.stats if kills.get(pid, 0) == top_k} if top_k > 0 else set()
    if holders("most_kills") != want:
        _fail("honors_from_ledger", f"MOST KILLS went to {sorted(holders('most_kills'))}; the ledger's top "
                                    f"({top_k} kills) is {sorted(want)}")
    im = holders("iron_man")
    if im & world.late_pids:
        _fail("honors_from_ledger", f"IRON MAN went to a hot joiner: {sorted(im & world.late_pids)}")
    silent = set(s.last_recap.get("missing") or [])       # no fact reached MC: not eligible (A63 polish)
    full = [pid for pid in sc.stats if pid not in world.late_pids and pid not in silent]
    fewest = min((deaths.get(pid, 0) for pid in full), default=0)
    if any(deaths.get(pid, 0) != fewest for pid in im):
        _fail("honors_from_ledger", f"IRON MAN went to {sorted(im)}; the fewest delivered deaths is {fewest}")
    assists = {r["player_id"]: r["assists"] for r in s.last_recap.get("rows") or []}
    top_a = max(assists.values(), default=0)
    want = {pid for pid, a in assists.items() if a == top_a} if top_a > 0 else set()
    if holders("wingman") != want:
        _fail("honors_from_ledger", f"WINGMAN went to {sorted(holders('wingman'))}; the top assists "
                                    f"({top_a}) are {sorted(want)}")


@invariant("ends_exactly_once", when="end")
def ends_exactly_once(world: World) -> None:
    """The match ended, and it ended exactly once, however many ENDs, ticks and late facts followed."""
    per = Counter(f["match_id"] for f in world.finishes)
    if world.match_id is None or per.get(world.match_id, 0) != 1:
        _fail("ends_exactly_once", f"match {world.match_id} finished {per.get(world.match_id, 0)} time(s): {world.finishes}")
    if world.session.phase != "recap":
        _fail("ends_exactly_once", f"the run ended in {world.session.phase.upper()}, not RECAP")


@invariant("frag_cap_ends_match", when="end")
def frag_cap_ends_match(world: World) -> None:
    """A frag cap reached by the credited facts ends the match at the capping kill, and a match whose
    credited facts never reach the cap is not ended by it."""
    s = world.session
    sc = s.scorer
    cap = (s.config.get("scoring") or {}).get("frag_limit")
    if sc is None or not cap or sc.win_by != "kills":
        return
    reason = next((f["reason"] for f in world.finishes if f["match_id"] == world.match_id), None)
    scores = ({pid: st.kills for pid, st in sc.stats.items()} if sc.mode == "ffa" else sc.team_scores())
    top = max(scores.values(), default=0)
    if reason == "frag_limit":
        if sc.limit_reached_t is None or sc.end_t != sc.limit_reached_t:
            _fail("frag_cap_ends_match", f"a frag-limit end froze at {sc.end_t}, the cap was reached at {sc.limit_reached_t}")
        if top < cap and not sc.cap_tie:
            _fail("frag_cap_ends_match", f"ended on the frag limit {cap} with a top score of {top}")
    elif top >= cap:
        _fail("frag_cap_ends_match", f"the board reached the cap ({top} >= {cap}) but the match ended by {reason!r}")


@invariant("recap_equals_board", when="end")
def recap_equals_board(world: World) -> None:
    """The stored recap is the board: the rows at the whistle, plus any late facts that were still in
    the scored window. With no late facts it is exactly the board the operator saw before END."""
    s = world.session
    sc = s.scorer
    if sc is None or s.last_recap is None:
        return
    def shape(rows):
        return {r["player_id"]: (r["kills"], r["deaths"], r["assists"], r["hits"]) for r in rows}
    recap = shape(s.last_recap.get("rows") or [])
    board = shape(sc.rows())
    if recap != board:
        _fail("recap_equals_board", f"the stored recap {recap} differs from the scorer's board {board}")
    before = world.board_before_end
    if before is not None and not world.late_after_end and world.finishes and \
            world.finishes[-1]["reason"] in ("host", "time"):
        pre = {pid: (r["kills"], r["deaths"], r["assists"], r["hits"]) for pid, r in before["rows"].items()}
        if pre != recap:
            diff = {pid: (pre.get(pid), recap.get(pid)) for pid in set(pre) | set(recap) if pre.get(pid) != recap.get(pid)}
            _fail("recap_equals_board", f"the recap differs from the live board at END: {diff}")


__all__ = ["LEGAL", "CLOCK_TIE_MS"]
