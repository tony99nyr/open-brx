"""M-MC scoring — contracts.md §4 (A5): exact victim-side attribution, assists, accuracy, medals,
match_id parking, feedback freshness, time base. Pure Python; no I/O. The Session feeds it
persisted facts + status; it hands back ScoreRow/LiveRow/feed/winner/honors.
"""
from __future__ import annotations

import csv
import io
from typing import Any, Callable, Literal, Mapping, Sequence

from .types import (ACC_MIN_SHOTS, ASSIST_WINDOW_MS, AWARDS, CLOCK_TIE_MS, FEEDBACK_MAX_AGE_MS, MEDALS, MULTI_KILL_MS,
                    NEVER_SEEN_MS, OBJECTIVE_MODES, STALE_AFTER_MS, AfterEndPlayer, AfterEndView, Event, Honor, LiveRow, Player,
                    PossessionView, RecapStationRow, RecapView, ScoreRow, Team, WinBy, WinnerView, parse_win_by)

Feed = dict
Feedback = Callable[[str, dict], None]     # (player_id, feedback body)

# A24/M2: the last two columns are UNOFFICIAL -- what a player picked up AFTER the whistle (A6.1
# post-end facts). They are in the export because a late flush is invisible otherwise, and they are
# LAST because nothing in the official half of the row may be read as including them.
CSV_COLUMNS = ["operator", "team", "kills", "deaths", "assists", "kd", "accuracy", "streak",
               "best_streak", "shots", "hits", "medals", "after_end_kills", "after_end_deaths"]

# F116: the per-kill Halo medals, in the order a row lists them. They were computed at every kill,
# fired as A11.4 alerts and then DISCARDED, so `ScoreRow.medals` could only ever carry an `honors()`
# award -- and honors need 3+ players by design (a 1-player recap once crowned itself MVP), so every
# 1v1 showed an empty medals column all match. The labels are deliberately a local map, not an import
# of `presentation.TEXT`: that is the HUD's banner copy and it answers to a different audience.
MEDAL_LABEL = {m["key"]: m["label"] for m in MEDALS}   # types.MEDALS order is the recap's canonical chip order
# The per-kill label an `honors()` award ALREADY stands for. FIRST BLOOD is the same word in both lists
# and needs no entry; the multi-kill honor is called MULTIKILL and is awarded for a double/triple, so
# without this a 3+ player row printed `MULTIKILL` and `DOUBLE KILL ×2` as two separate chips for one
# thing (polish review 2026-09-12). Base labels only -- the `×N` suffix is stripped before the lookup.
HONOR_ALIAS = {m["label"]: "MULTIKILL" for m in MEDALS if m["kind"] == "multi"}
# Halo 3's multi-kill ladder, highest count first: a chain earns the biggest medal whose count it has reached
# (killionaire at 10 and beyond). The streak medals fire at their exact count, as before.
_MULTI_LADDER = sorted(((m["count"], m["key"]) for m in MEDALS if m["kind"] == "multi"), reverse=True)
_STREAK_AT = {m["count"]: m["key"] for m in MEDALS if m["kind"] == "streak"}
# A63: KILLJOY fires when the VICTIM's current streak is at least this (the killing_spree count, types.MEDALS).
_KILLJOY_AT = next(m["count"] for m in MEDALS if m["kind"] == "killjoy")
AWARD_LABEL = {a["key"]: a["label"] for a in AWARDS}


def _chain_key(n: int) -> str | None:
    """The MEDALS ladder key a chain of `n` kills earns (the highest tier reached), or None below 2."""
    return next((key for count, key in _MULTI_LADDER if n >= count), None)


def _mmss(ms: int) -> str:
    s = max(0, ms) // 1000
    return f"{s // 60}:{s % 60:02d}"


def _stands(label: str, honors: set[str]) -> bool:
    """Is this earned chip already on the row, under its own name or the honor's name for it?"""
    return label in honors or HONOR_ALIAS.get(label) in honors


def _csv_safe(v):
    # neutralise spreadsheet formula injection (=,+,-,@ leading a cell)
    return ("'" + v) if isinstance(v, str) and v[:1] in ("=", "+", "-", "@") else v


def rows_csv(rows) -> str:
    """`ScoreRow[]` → the exported stats table.

    Module-level, not a `Scorer` method, because the RECAP history picker exports matches whose
    scorer is long gone — an archived match only has the `rows` its stored recap kept (W1/F6). Both
    exports run through here so the archived CSV cannot quietly diverge from the live one. Rows are
    read defensively for the same reason: they may have been read back off disk.
    """
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(CSV_COLUMNS)
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        acc, medals = r.get("accuracy"), r.get("medals") or []
        if not isinstance(medals, list):      # a stray string would join per-CHARACTER
            medals = [medals]
        w.writerow([_csv_safe(r.get("display", "")), _csv_safe(r.get("team_id") or ""),
                    r.get("kills", 0), r.get("deaths", 0), r.get("assists", 0), r.get("kd", 0),
                    "" if acc is None else acc, r.get("streak", 0), r.get("best_streak", 0),
                    r.get("shots", 0), r.get("hits", 0),
                    _csv_safe(" · ".join(str(m) for m in medals)),
                    r.get("after_end_kills", 0), r.get("after_end_deaths", 0)])
    return buf.getvalue()


class _P:
    __slots__ = ("kills", "deaths", "assists", "hits", "friendly_kills", "streak", "best_streak",
                 "multi_best", "multis", "last_kill_t", "last_hit_t", "shots", "shots_t", "alive",
                 "deadline_s", "hp", "armor", "last_status_t", "flushed", "team_id", "shots_baseline",
                 "life_marks")

    def __init__(self, team_id: str | None):
        self.kills = self.deaths = self.assists = self.hits = self.friendly_kills = 0
        self.streak = self.best_streak = self.multi_best = 0
        self.multis: list[int] = []
        self.last_kill_t: int | None = None
        # F119: when this player last LANDED a hit. Hits are the accuracy numerator and arrive per
        # event; shots are the denominator and arrive on the ~2 s heartbeat. A `shots_t` older than
        # this is a denominator that has not caught up yet -- detectable, not guessed.
        self.last_hit_t: int | None = None
        self.shots = 0                 # latest status.shots from the CURRENT node session
        self.shots_baseline = 0        # total at the moment a new node_id bound this player (A6.2)
        self.shots_t: int | None = None
        self.alive = True
        self.deadline_s = 0
        self.hp = self.armor = 0
        self.last_status_t: int | None = None
        self.flushed = False
        self.team_id = team_id
        # A63 SURVIVOR: (t, "d" | "r") for every SCORED death and every respawn/revive, in arrival order.
        # `honors()` sorts them, so a fact that arrives out of order still measures the right life.
        self.life_marks: list[tuple[int, str]] = []


class Scorer:
    def __init__(self, match_id: str, go_live_t: int, time_limit_s: int | None, mode: str,
                 players: dict[str, Player], teams: list[Team],
                 node_player: dict[str, str], synced_at_lobby: dict[str, bool],
                 on_feedback: Feedback | None = None, on_feed: Callable[[Feed], None] | None = None,
                 now_ms: Callable[[], int] | None = None, win_by: WinBy | None = None,
                 on_alert: Callable[[str, str, dict], object] | None = None, frag_limit: int | None = None,
                 on_limit: Callable[[int], None] | None = None):
        self.match_id = match_id
        self.go_live_t = go_live_t
        self.time_limit_s = time_limit_s
        self.mode = mode
        self.players = players
        self.teams = {t["team_id"]: t for t in teams}
        self.node_player = node_player            # node_id -> player_id (Session keeps it current)
        self.mismatched = 0                       # facts dropped because their player_id != the node's binding
        self.synced_at_lobby = synced_at_lobby    # node_id -> bool
        self.win_by: WinBy = parse_win_by(win_by, "kills")
        self.on_feedback = on_feedback or (lambda pid, body: None)
        # A11.4 match-state alerts: (kind, scope, extra) where scope is "all" | a team_id | a player_id
        self.on_alert = on_alert or (lambda kind, scope, extra: None)
        # F124: fired ONCE, with the effective time of the kill that reached the cap. The Scorer is pure,
        # so it does not end anything itself -- the Session's handler ends the match down the same path
        # `control('end')` takes (`set_end` + `_finish`), and pushes `control{end}` to the field.
        self.on_limit = on_limit or (lambda t: None)
        self.frag_limit = frag_limit
        self.limit_reached_t: int | None = None    # when the cap was hit (None = it never was)
        self._leader: str | None = None            # team_id (or player_id in FFA) currently in the lead
        self._announced: set[str] = set()          # once-per-match alerts already sent (next_kill_wins, last_survivor)
        self._infected_team: str | None = None      # infection: the team players flip TO (learned from team_change)
        self.on_feed = on_feed or (lambda e: None)
        self.now_ms = now_ms or (lambda: 0)
        self.stats: dict[str, _P] = {pid: _P(p.get("team_id")) for pid, p in players.items()}
        self.num_to_pid = {p["player_num"]: pid for pid, p in players.items()}
        self.hits_log: list[tuple[int, str, str, int]] = []   # (t, shooter_pid, victim_pid, dmg)
        # F330: (victim node_id, seq) per `hits_log` entry, same index. A node numbers its facts in the order
        # it emitted them, so a hit with a higher seq than a death on the same node came from a LATER life.
        self._hit_src: list[tuple[str, int | None]] = []
        # A dual-emitter trigger pull can arrive as two hit_taken facts. The node assigns
        # both facts the same shot_group; accuracy counts the physical pull once while the
        # damage log still retains both landed words for assists and replay diagnostics.
        self._counted_hit_groups: set[tuple[str, str]] = set()
        # F80: facts whose shooter is wire id 0 -- a grenade hill's damage word (F69) or a gun whose $PSET
        # never landed. They score for nobody by design (A5.1); the recap says how many there were so a
        # mis-armed gun is at least visible AFTER the match (the arm-time fix is B19).
        self.wire0: dict[str, int] = {"hit_taken": 0, "death": 0}
        self.kills: list[dict] = []
        self.parked: list[tuple[str, Event, int]] = []
        self.feed: list[Feed] = []
        self.first_blood: str | None = None
        # Objective modes: site -> team tid -> node_id -> that node's CUMULATIVE observed ms. Merged by
        # MAX per (site, tid) in `possession()`, never summed — four teammates on one hill all report it.
        self.possession_ms: dict[str, dict[int, dict[str, int]]] = {}
        self.possession_observed: dict[str, int] = {}    # node_id -> ms it was hearing the point at all
        self.seen: set[tuple[str, int]] = set()
        # A6.1 end freeze: facts with effective t > end_t are recorded, never scored.
        self.end_t: int | None = (go_live_t + time_limit_s * 1000) if time_limit_s else None
        self.post_end: list[tuple[str, Event, int]] = []
        # A24/M2: the cap was reached by MORE THAN ONE side inside `CLOCK_TIE_MS` -- team_ids (or
        # player_ids in FFA). Set by the Session at the finish via `check_cap_tie`; `winner()` reports it
        # as a tie rather than letting MC's arrival order pick between two kills it cannot order.
        self.cap_tie: list[str] | None = None
        # F356: the MC time (`t_recv` clock) the frag cap's whistle blew (`state._end_on_frag_limit`). A team
        # kill MC receives after it is frozen out (`_frozen_out`), and no kill is cued after it (F357). It is
        # a fact about ARRIVAL, which the stored facts keep (`t_recv`): a reconcile replay is handed the live
        # value, and a resume derives it from the facts in arrival order (`state._build_scorer`). Never set
        # by the scorer itself, so an adopted match (MC does not end it on the cap) never has one.
        self.cap_recv: int | None = None
        # A63 IRON MAN: player_id -> ms a HOT JOINER was registered (A5.6), only for a join AFTER go-live.
        # Such a player did not play the whole match, so IRON MAN skips them, and their first life starts
        # here, not at go-live. A replay or a resume carries it over (`state._replay`, the match snapshot),
        # because the stored facts cannot say when somebody joined.
        self.joined_t: dict[str, int] = {}
        # A63 OBJECTIVE HERO: node_id -> the player it was bound to when its possession tally arrived.
        self.possession_pid: dict[str, str] = {}
        # A63 SURVIVOR: players with a scored fact from a node MC never saw synced. Such a fact is timed by
        # when MC RECEIVED it (`_eff_t`), so a life measured from it is a guess, and SURVIVOR skips them.
        self.unsynced_pids: set[str] = set()
        # A65 (F354): team_id -> kills credited to a TEAM and to no player. The victim's phone lost the damaging
        # hit and only a non-damaging word (smoke, EMP) was fresh at the death, so it names the team only
        # (`death.credit == "team"`, `shooter_num` 0). The team score counts them; no row, medal or honor does.
        self.team_credit: dict[str, int] = {}

    def _credit_team(self, ev: Event, victim: str) -> str | None:
        """A65 (F354): the team_id a team-only death credits, or None. Only a `credit: "team"` death with no
        player behind it (`shooter_num` 0), in a team mode, naming a rostered team that is not the victim's own
        (a teammate's smoke is no kill for anyone)."""
        if ev.get("credit") != "team" or self.mode == "ffa" or int(ev.get("shooter_num", 0) or 0) != 0:
            return None
        try:
            tid = int(ev.get("shooter_team", -1))
        except (TypeError, ValueError):
            return None
        team_id = next((k for k, t in self.teams.items() if t.get("tid") == tid), None)
        vt = self.stats[victim].team_id if victim in self.stats else None
        return team_id if team_id is not None and team_id != vt else None

    def _before_whistle(self) -> bool:
        """F357 (Tony 2026-09-25): may a kill processed NOW still be cued? Not after the whistle, whatever
        ended the match: a frag cap that froze it (`end_t` at `limit_reached_t`, or its arrival `cap_recv`), a host END (`set_end`)
        or the clock (`end_t` from the time limit). A kill that lands after the end still counts when it
        is stamped before it; it just gets no confirm and no medal cue."""
        if self.cap_recv is not None:
            return False
        # The cap is a whistle only when it froze the match there (`set_end` at the capping kill, applied at once,
        # even mid-batch). An ADOPTED match reaches the operator's draft cap and plays on (polish r1).
        if self.limit_reached_t is not None and self.end_t is not None and self.end_t <= self.limit_reached_t:
            return False
        return self.end_t is None or self.now_ms() <= self.end_t

    def set_end(self, end_t: int) -> None:
        """Freeze scoring at end_t (control{end}); later facts park as post_end (A6.1)."""
        if self.end_t is None or end_t < self.end_t:
            self.end_t = end_t

    # ---- A24/M2: what happened AFTER the whistle, and whether the cap was a dead heat ----
    def _kill_pair(self, node_id: str, ev: Event) -> tuple[str | None, str | None]:
        """(victim, killer) for a death fact, by the SAME rules the scored path uses — the node's
        binding names the victim, `shooter_num` names the killer through the roster, and a shot at
        yourself is nobody's kill. Either may be None (an unbound node, wire id 0, a stale num)."""
        victim = self.node_player.get(node_id)
        if victim not in self.stats:
            return None, None
        killer = self.num_to_pid.get(int(ev.get("shooter_num", 0) or 0))
        if killer == victim or killer not in self.stats:
            killer = None
        return victim, killer

    def after_end(self) -> AfterEndView | None:
        """The UNOFFICIAL after-the-whistle block (A6.1 + A24), or None when nothing arrived late.

        These are real facts — a player kept playing, or a phone flushed minutes later — and A6.1
        already records them without scoring them. Until now the recap could only say HOW MANY; a
        player whose last three kills landed after the end saw them vanish with no explanation. So
        the breakdown rides along, clearly separated: it feeds nothing (not kills, not streaks, not
        medals, not the winner) and is shown as "after the whistle".
        """
        if not self.post_end:
            return None
        by: dict[str, AfterEndPlayer] = {}
        def slot(pid: str) -> AfterEndPlayer:
            return by.setdefault(pid, {"kills": 0, "deaths": 0})
        for node_id, ev, _t_recv in self.post_end:
            if ev.get("type") != "death":
                continue
            victim, killer = self._kill_pair(node_id, ev)
            if victim is None:
                continue
            slot(victim)["deaths"] += 1
            if killer and not self._friendly(killer, victim):
                slot(killer)["kills"] += 1
        return {"facts": len(self.post_end), "by_player": by}

    def check_cap_tie(self, tol_ms: int) -> list[str] | None:
        """Did anyone ELSE reach the frag cap inside `tol_ms` of the kill that ended the match?

        The end freezes at the winning kill's `t`, so a second cap kill a few hundred ms later parks
        as `post_end` and is never scored — and MC would then crown whichever of two effectively
        simultaneous kills it happened to order first. Phone clocks agree to well under a second
        (contracts §7), which is exactly the width of the band where that order means nothing. Inside
        it, both sides are at the cap and the honest answer is a TIE.

        Pure: it replays the post-end deaths onto a COPY of the tallies and touches no state.
        """
        if not self.frag_limit or self.limit_reached_t is None or self.end_t is None:
            return None
        kills = {pid: st.kills for pid, st in self.stats.items()}
        credit = dict(self.team_credit)
        for node_id, ev, t_recv in self.post_end:
            if ev.get("type") != "death":
                continue
            eff = self._eff_t(node_id, ev, t_recv, None)
            if eff > self.end_t + tol_ms or eff <= self.end_t:
                continue    # F356: a pre-whistle team kill frozen out by `_frozen_out` is not in the band
            victim, killer = self._kill_pair(node_id, ev)
            if victim is not None and not killer and (ct := self._credit_team(ev, victim)) is not None:
                credit[ct] = credit.get(ct, 0) + 1       # A65: a team-only kill in the band
                continue
            if victim is None or not killer:
                continue
            kills[killer] += -1 if self._friendly(killer, victim) else 1
        if self.mode == "ffa":
            scores = kills
        else:
            scores = {tid: credit.get(tid, 0) for tid in self.teams}
            for pid, k in kills.items():
                tid = self.stats[pid].team_id
                if tid in scores:
                    scores[tid] += k
        at_cap = sorted(k for k, v in scores.items() if v >= self.frag_limit)
        return at_cap if len(at_cap) > 1 else None

    def shots_total(self, pid: str) -> int:
        st = self.stats[pid]
        return st.shots_baseline + st.shots

    def register_player(self, pid: str, player: Player, t: int | None = None) -> None:
        """A5.6 late joiner: make a mid-match arrival scorable (stats + num map + players). A join after
        go-live is recorded in `joined_t` (A63): that player did not play the whole match."""
        if pid in self.stats:
            return
        self.players[pid] = player
        self.stats[pid] = _P(player.get("team_id"))
        self.num_to_pid[player["player_num"]] = pid
        t = self.now_ms() if t is None else t
        if t > self.go_live_t:
            self.joined_t[pid] = t

    def rebind_node(self, pid: str) -> None:
        """A NEW node_id bound this player (hot-swap): fold the old session's shots into the baseline (A6.2)."""
        st = self.stats.get(pid)
        if st is None:
            return
        st.shots_baseline = st.shots_baseline + st.shots
        st.shots = 0

    # ---- helpers ----
    def _pid(self, node_id: str, body: Mapping[str, Any]) -> str | None:
        """The server's binding is the only identity a fact gets. A body whose player_id disagrees with the node's
        binding is dropped (and counted) — a node can only ever speak for the player MC bound it to."""
        pid = self.node_player.get(node_id)
        claimed = body.get("player_id")
        if claimed and claimed != pid:
            self.mismatched += 1
            return None
        return pid

    def _eff_t(self, node_id: str, ev: Event, t_recv: int, rebase: int | None) -> int:
        if rebase is not None:
            return int(ev.get("t", t_recv)) + rebase
        if self.synced_at_lobby.get(node_id, False):
            return int(ev.get("t", t_recv))
        return t_recv

    def eff_t(self, node_id: str, ev: Event, t_recv: int) -> int:
        """The time this fact is scored AT, by the §7/A4.7 rule (synced node → its own `t`, never-synced
        node → `t_recv`). Public because the Session has to ask the same question of a fact that has not
        been ingested yet — "is this late arrival inside the scored window?" (A24/M2 reconciliation)."""
        return self._eff_t(node_id, ev, t_recv, None)

    def _frozen_out(self, node_id: str, ev: Event, t_recv: int) -> bool:
        """F356: a TEAM kill MC receives after the frag cap fired is frozen out (contracts §4, A6.1).

        A node out of coverage flushes it after the whistle, stamped before the capping kill, so its `t`
        is inside the window. Its -1 would lower the capping team's board below the cap the field heard,
        and A6.1 says the announced winner never mutates, so it parks as `post_end` WHATEVER the score is
        when it lands: the same facts then give the same board in any arrival order. Judged on `t_recv`,
        not on "has this scorer's cap fired yet", so a replay (in `t` order) freezes exactly the same
        facts. An ENEMY kill that lands late still scores (and may move a frag-cap end earlier, A24/M2).
        FFA has no team kill, so it is never affected.
        """
        if self.cap_recv is None or t_recv <= self.cap_recv:
            return False
        victim, killer = self._kill_pair(node_id, ev)
        return victim is not None and killer is not None and self._friendly(killer, victim)

    def _friendly(self, killer: str | None, victim: str) -> bool:
        if not killer or self.mode == "ffa":
            return False
        kt = self.stats[killer].team_id
        vt = self.stats[victim].team_id
        return kt is not None and kt == vt

    def _match_t(self, t: int) -> str:
        s = max(0, (t - self.go_live_t) // 1000)
        return f"{s // 60:02d}:{s % 60:02d}"

    def _push_feed(self, t: int, text: str, tag: str | None, kind: str) -> None:
        e = {"t_match_s": max(0, (t - self.go_live_t) // 1000), "text": text, "tag": tag, "kind": kind}
        self.feed.insert(0, e)
        self.on_feed(e)

    def _name(self, pid: str | None) -> str:
        return self.players[pid]["display"] if pid and pid in self.players else "UNKNOWN"

    # ---- ingestion ----
    def ingest_status(self, node_id: str, body: dict, t_recv: int) -> None:
        pid = self._pid(node_id, body)
        if not pid or pid not in self.stats:
            return
        st = self.stats[pid]
        if body.get("match_id") in (None, self.match_id):
            st.shots = int(body.get("shots", st.shots) or 0)
            st.shots_t = t_recv
        st.alive = bool(body.get("alive", st.alive))
        st.deadline_s = int(body.get("deadline_s", 0) or 0)
        st.hp = int(body.get("hp", 0) or 0)
        st.armor = int(body.get("armor", 0) or 0)
        st.last_status_t = t_recv

    def ingest_batch(self, node_id: str, events: list[Event], t_recv: int) -> None:
        rebase = None
        suppress = False
        if not self.synced_at_lobby.get(node_id, False) and events:
            newest = max(int(e.get("t", t_recv)) for e in events)
            rebase = t_recv - newest
            suppress = True
        for ev in sorted(events, key=lambda e: int(e.get("t", 0))):
            self.ingest(node_id, ev, t_recv, rebase=rebase, suppress_awards=suppress, seq=ev.get("seq"))

    def ingest(self, node_id: str, ev: Event, t_recv: int, *, rebase: int | None = None,
               suppress_awards: bool = False, seq: int | None = None) -> str:
        """Returns 'scored' | 'parked' | 'ignored' | 'dup'."""
        if ev.get("match_id") != self.match_id:
            self.parked.append((node_id, ev, t_recv))
            return "parked"
        if seq is not None:
            key = (node_id, seq)
            if key in self.seen:
                return "dup"
            self.seen.add(key)
        # A possession tally is handled BEFORE the pid gate and BEFORE the A6.1 end freeze, and both
        # are deliberate (see `_possession`): it is a cumulative total, not a timestamped event, and
        # the report that matters arrives AFTER the whistle.
        if ev.get("type") == "possession":
            pid0 = self._pid(node_id, ev)
            if pid0 in self.stats:
                self.stats[pid0].flushed = True
                self.possession_pid[node_id] = pid0
            return self._possession(node_id, ev)
        pid = self._pid(node_id, ev)
        if not pid or pid not in self.stats:
            return "ignored"
        st = self.stats[pid]
        st.flushed = True
        t = self._eff_t(node_id, ev, t_recv, rebase)
        if not self.synced_at_lobby.get(node_id, False):
            suppress_awards = True                  # A5.7: never-synced node → no window awards on the live path either
        kind = ev.get("type")
        if self.end_t is not None and t > self.end_t:
            self.post_end.append((node_id, ev, t_recv))
            if kind == "death":
                self._after_whistle_feed(node_id, ev, t)
            return "post_end"
        if kind in ("hit_taken", "death", "respawn", "team_change") and not self.synced_at_lobby.get(node_id, False):
            self.unsynced_pids.add(pid)
        if kind in self.wire0 and int(ev.get("shooter_num", 0) or 0) == 0 \
                and not (kind == "death" and ev.get("credit")):   # A65: a phone that sent a team credit knew who it was
            self.wire0[kind] += 1
        if kind == "hit_taken":
            shooter = self.num_to_pid.get(int(ev.get("shooter_num", 0) or 0))
            if shooter and shooter != pid:
                self.hits_log.append((t, shooter, pid, int(ev.get("dmg", 0) or 0)))
                self._hit_src.append((node_id, seq))
                if not self._friendly(shooter, pid):
                    group = ev.get("shot_group")
                    group_key = (pid, str(group)) if isinstance(group, (int, str)) and not isinstance(group, bool) else None
                    if group_key is None or group_key not in self._counted_hit_groups:
                        self.stats[shooter].hits += 1
                        if group_key is not None:
                            self._counted_hit_groups.add(group_key)
                    ss = self.stats[shooter]
                    ss.last_hit_t = t if ss.last_hit_t is None else max(ss.last_hit_t, t)
            return "scored"
        if kind == "death":
            # Integration review 2: a team kill frozen out after the frag-cap whistle (F356) still happened to
            # the VICTIM (a death, a streak reset, a life mark: SURVIVOR and IRON MAN read them). Only the
            # killer's -1 is frozen, so the capping team's board stays what the field heard.
            return self._death(pid, ev, t, suppress_awards, src=(node_id, seq),
                               freeze_killer=self._frozen_out(node_id, ev, t_recv))
        if kind == "respawn":
            if not ev.get("operator"):   # A47: the operator's FORCE RESPAWN is not a new life after a death
                st.streak = 0
            st.alive = True
            st.life_marks.append((t, "r"))   # a respawn while alive starts nothing (`_longest_life`)
            return "scored"
        if kind == "team_change":
            tid = int(ev.get("tid", -1))
            st.life_marks.append((t, "r"))       # infection: a turned human is revived on the new team
            for team in self.teams.values():
                if team["tid"] == tid:
                    st.team_id = team["team_id"]
                    self._infected_team = team["team_id"]   # A11.4 last_survivor: who counts as a survivor
            if self.mode == "infection" and not suppress_awards and self.now_ms() - t <= FEEDBACK_MAX_AGE_MS:
                self.on_alert("infected", "all", {"player_id": pid})     # A11.4: "The infection is spread."
            if self.mode == "infection" and not suppress_awards:
                self._match_state_alerts(t)                              # a turn is what changes the survivor count
            return "scored"
        return "ignored"

    AFTER_WHISTLE = "AFTER WHISTLE"

    def _after_whistle_feed(self, node_id: str, ev: Event, t: int) -> None:
        """F357: a death stamped after the end (A6.1 `post_end`) is shown, marked AFTER WHISTLE, and counts for
        nothing. The feed line is the operator's only live sight of it; the recap's `after_end` block is the other."""
        victim, killer = self._kill_pair(node_id, ev)
        if victim is None:
            return
        if killer:
            text = f"{self._name(killer)} {'team-killed' if self._friendly(killer, victim) else 'eliminated'} {self._name(victim)}"
        elif (ct := self._credit_team(ev, victim)) is not None:
            text = f"{self._team_name(ct)} eliminated {self._name(victim)}"
        else:
            text = f"{self._name(victim)} went down"
        self._push_feed(t, text, self.AFTER_WHISTLE, "kill")

    def _team_name(self, team_id: str) -> str:
        return str((self.teams.get(team_id) or {}).get("name") or team_id).replace(" TEAM", "")

    def _death(self, victim: str, ev: Event, t: int, suppress: bool,
               src: tuple[str, int | None] = ("", None), freeze_killer: bool = False) -> str:
        vs = self.stats[victim]
        vs.deaths += 1
        vs.alive = False
        victim_streak = vs.streak          # A63 KILLJOY: the victim's streak AT the death, read before it resets
        vs.streak = 0
        vs.life_marks.append((t, "d"))
        killer = self.num_to_pid.get(int(ev.get("shooter_num", 0) or 0))
        if killer == victim:
            killer = None
        friendly = self._friendly(killer, victim)
        kill = {"t": t, "match_id": self.match_id, "victim": victim, "killer": killer,
                "team": vs.team_id, "friendly": friendly, "multi": 1, "desync": bool(ev.get("desync"))}
        if freeze_killer:
            kill["frozen"] = True           # review 2: the killer's -1 is frozen out (F356); the death stands
        credit = self._credit_team(ev, victim) if killer is None else None
        if credit is not None:
            # A65 (F354): the TEAM scores the kill and no player does: no K, streak, chain, first blood,
            # medal, assist or kill confirm. Nobody on that team fired the damaging word the phone lost.
            self.team_credit[credit] = self.team_credit.get(credit, 0) + 1
            kill["team_credit"] = credit
        tag = None
        if credit is not None:
            tag = "TEAM CREDIT"
        elif killer and freeze_killer:
            tag = self.AFTER_WHISTLE          # F357: one tag for every kill that counts for nothing after the end
        elif killer:
            ks = self.stats[killer]
            if friendly:
                ks.friendly_kills += 1
                ks.kills -= 1
                tag = "TEAM KILL"
            else:
                ks.kills += 1
                ks.streak += 1
                ks.best_streak = max(ks.best_streak, ks.streak)
                # F150 (field 2026-09-12): `suppress` is A5.7's "this node's clock cannot be trusted", and
                # it is decided on the VICTIM's node — while every medal here belongs to the KILLER. The
                # whole block used to sit inside it, so one phone whose clock MC never saw synced wiped the
                # medal ledger of whoever killed them: OTHERGUY finished 11-5 with an empty medals column
                # while the other row (whose deaths came in over a synced node) showed FIRST BLOOD.
                # Only the MULTI-KILL tier is a clock-window award, so only it is suppressed now. A streak
                # is a COUNT of consecutive kills and first blood is an ORDERING — neither reads a
                # timestamp, so neither has any business being decided by the victim's clock.
                if not suppress:
                    # Integration review 1: a kill flushed late (`t` more than CLOCK_TIE_MS before the killer's
                    # newest kill) never joins a chain and never moves the chain clock back. It is a chain of one,
                    # kept BEHIND the running chain so the next fresh kill still extends the right one. Inside the
                    # clock band (two kills a moment apart that arrive swapped, contracts §7) it still chains.
                    late = ks.last_kill_t is not None and ks.last_kill_t - t > CLOCK_TIE_MS
                    if late:
                        ks.multis.insert(max(0, len(ks.multis) - 1), 1)
                    elif ks.last_kill_t is not None and -CLOCK_TIE_MS <= t - ks.last_kill_t <= MULTI_KILL_MS:
                        if ks.multis:
                            ks.multis[-1] += 1
                        else:
                            ks.multis.append(2)
                        kill["multi"] = ks.multis[-1]
                    else:
                        ks.multis.append(1)
                    ks.multi_best = max(ks.multi_best, kill["multi"])
                # Halo-style: a kill can earn SEVERAL medals at once (a killtacular AND a killing
                # spree), and each plays. First blood, the multi tier, then the streak threshold.
                # `kill["multi"]` stays 1 under suppression, so the multi tier simply cannot fire there.
                medals: list[str] = []
                if self.first_blood is None:
                    self.first_blood = killer
                    medals.append("first_blood")
                if kill["multi"] >= 2:
                    medals.append(next(key for count, key in _MULTI_LADDER if kill["multi"] >= count))
                if ev.get("melee") is True:
                    medals.append("melee_kill")     # Tony 2026-09-24: stacks with the chain medal
                if victim_streak >= _KILLJOY_AT:
                    # A63: ended an enemy's killing spree. A count, like the streak medal, so the A5.7
                    # clock suppression does not touch it; a team kill or a self-kill never reaches here.
                    medals.append("killjoy")
                if (streak_medal := _STREAK_AT.get(ks.streak)) is not None:
                    medals.append(streak_medal)
                kill["medals"] = medals
                if medals:
                    tag = " + ".join(m.replace("_", " ").upper() for m in medals)
                elif ks.streak >= 3:
                    tag = f"STREAK ×{ks.streak}"
                ks.last_kill_t = t if ks.last_kill_t is None else max(ks.last_kill_t, t)   # never back (review 1)
                # assists: other players who damaged the victim inside the window
                # assists: each OTHER player who damaged the victim inside the window gets exactly one
                assisters: list[str] = []
                # F330: `t` alone cannot say which life a hit belongs to (a phone clock can jump back), and a
                # replay ingests by `t`, so a hit the victim's node emitted AFTER this death (a higher seq on
                # the same node) is never this death's assist, whatever order it arrives or replays in.
                for (ht, shooter, v, _dmg), (hnode, hseq) in zip(self.hits_log, self._hit_src):
                    if hseq is not None and src[1] is not None and hnode == src[0] and hseq > src[1]:
                        continue
                    if v == victim and shooter not in (killer, victim) and t - ASSIST_WINDOW_MS <= ht <= t and shooter not in assisters:
                        assisters.append(shooter)
                for a in assisters:
                    self.stats[a].assists += 1
                if assisters:
                    kill["assists"] = assisters
                # feedback to the killer only if fresh, and never after the whistle (F357, Tony 2026-09-25:
                # "MC shouldn't push KCs" after it), whatever ended the match (`_before_whistle`). A kill
                # flushed after the end, stamped before it, still scores; it gets no confirm and no medal
                # cue. The capping kill itself is cued: `limit_reached_t` is set by `_check_frag_limit` below.
                if self.now_ms() - t <= FEEDBACK_MAX_AGE_MS and not suppress and self._before_whistle():
                    # kind stays "kill" (older nodes play their kill line); `medals` is the A11.4 stack,
                    # which a current node plays INSTEAD of the plain line, one after another.
                    # `victim` is a player_id (for matching); `victim_display` is what the kill banner shows
                    # (field 2026-09-17: the phone rendered the raw id because only the id rode here).
                    body = {"player_id": killer, "kind": "kill", "t": t, "medals": list(kill.get("medals") or []),
                            "victim": victim, "victim_team": self.stats[victim].team_id,
                            "victim_display": (self.players.get(victim) or {}).get("display") or None}
                    self.on_feedback(killer, body)
        # Polish 2026-09-04: alerts after EVERY scored death, not only enemy kills -- a team kill (kills -= 1)
        # can flip the lead, and a death with no known shooter still leaves a last survivor.
        if not suppress and not freeze_killer:   # a frozen death lands after the whistle: no new alert
            self._match_state_alerts(t)
        self.kills.append(kill)
        if killer:
            verb = "team-killed" if friendly else "eliminated"
            text = f"{self._name(killer)} {verb} {self._name(victim)}"
        elif credit is not None:
            text = f"{self._team_name(credit)} eliminated {self._name(victim)}"
        else:
            text = f"{self._name(victim)} went down"
        if tag == "FIRST BLOOD":
            text = f"{self._name(killer)} drew FIRST BLOOD on {self._name(victim)}"
        self._push_feed(t, text, tag, "kill")
        # LAST, and deliberately: the cap is judged on the board this kill leaves behind, and the
        # kill must already be in `self.kills` + the feed before the Session freezes scoring on it.
        self._check_frag_limit(t)
        return "scored"

    def _check_frag_limit(self, t: int) -> None:
        """F124: the frag limit ENDS the match.

        It was configured, announced at cap-1 (`next_kill_wins`), displayed on the HUD -- and enforced
        by nobody. The end exists in the standalone CLI engine (`modes/deathmatch.py`) and was never
        ported to MC; the node exposes `fragLimit` for display only and the gun never reads it at all.
        Field 2026-09-11: *"the player got the 7th kill after the 'next kill wins' audio and the game
        didnt end"* -- ROCCO finished on 9 kills against a cap of 7, phase still `live`.

        Only a KILLS game can be decided this way: an objective or survival `win_by` is settled by
        possession or by the last player standing, so a kill cap means nothing there and MC must not
        invent one. Fires once; `set_end` + `_finish` happen in the Session's handler, so the victory
        push, the recap and the stored match are byte-identical to a manual END.
        """
        if not self.frag_limit or "frag_limit" in self._announced:
            return
        if self.win_by != "kills":
            return
        scores = ({pid: st.kills for pid, st in self.stats.items()} if self.mode == "ffa"
                  else self.team_scores())
        if not scores or max(scores.values()) < self.frag_limit:
            return
        self._announced.add("frag_limit")
        self.limit_reached_t = t
        self.on_limit(t)

    def prime_match_state_alerts(self) -> None:
        """F362 (k): after a replay, take the lead and `next_kill_wins` from the board, and tell nobody.

        A replay skips `_match_state_alerts` for every fact older than FEEDBACK_MAX_AGE_MS, so a resumed
        scorer had no leader and no `next_kill_wins` mark. The first fresh kill then told the field both
        again. The field already heard them when the facts were fresh."""
        if self.win_by != "kills":
            return
        scores = ({pid: st.kills for pid, st in self.stats.items()} if self.mode == "ffa"
                  else self.team_scores())
        if not scores:
            return
        best = max(scores.values())
        tops = [k for k, v in scores.items() if v == best]
        if len(tops) == 1 and best > 0:
            self._leader = tops[0]
        if self.frag_limit and best >= self.frag_limit - 1:
            self._announced.add("next_kill_wins")

    def match_state_alerts(self) -> dict:
        """F362 (k): what the field was told (the lead and the once-per-match alerts), for the match snapshot."""
        return {"leader": self._leader,
                "announced": sorted(a for a in self._announced if a in ("next_kill_wins", "last_survivor"))}

    def restore_match_state_alerts(self, alerts: dict) -> None:
        """F362 (k): take the lead and the once-per-match alerts the field was told from a match snapshot.
        A value MC cannot read is skipped, and `frag_limit` is never taken (the cap is judged on the facts)."""
        leader = alerts.get("leader")
        known = set(self.teams) if self.mode != "ffa" else set(self.stats)
        self._leader = leader if isinstance(leader, str) and leader in known else None
        announced = alerts.get("announced")
        if isinstance(announced, list):
            keep = {"next_kill_wins"} | ({"last_survivor"} if self.mode in ("lms", "infection") else set())
            self._announced |= {a for a in announced if a in keep}

    def _match_state_alerts(self, t: int) -> None:
        """A11.4: lead changes, next-kill-wins and the last survivor, to the nodes they concern.

        Lead: team modes compare team totals; FFA compares players. `lead_taken` goes to the new leader
        (team or player), `lead_lost` to the one displaced; ties change nothing. `next_kill_wins`
        fires ONCE when anyone reaches cap-1. `last_survivor` fires once when exactly one player is
        alive in a survival mode (lms / infection)."""
        if self.now_ms() - t > FEEDBACK_MAX_AGE_MS:
            return
        if self.win_by == "kills":
            if self.mode == "ffa":
                scores = {pid: st.kills for pid, st in self.stats.items()}
            else:
                scores = self.team_scores()
            if scores:
                best = max(scores.values())
                tops = [k for k, v in scores.items() if v == best]
                leader = tops[0] if len(tops) == 1 and best > 0 else None
                if leader is not None and leader != self._leader:
                    if self._leader is not None:
                        self.on_alert("lead_lost", self._leader, {})
                    self.on_alert("lead_taken", leader, {})
                    self._leader = leader
                if self.frag_limit and best == self.frag_limit - 1 and "next_kill_wins" not in self._announced:
                    self._announced.add("next_kill_wins")
                    self.on_alert("next_kill_wins", "all", {})
        if self.mode in ("lms", "infection") and "last_survivor" not in self._announced:
            alive = [pid for pid, st in self.stats.items() if st.alive]
            if self.mode == "infection":
                # the infected respawn alive, so "survivors" = the alive players still off the infected team
                # (the team the team_change events flip to; unknown until the first turn -> no alert yet)
                if self._infected_team is None:
                    return
                alive = [pid for pid in alive if self.stats[pid].team_id != self._infected_team]
            if len(alive) == 1 and len(self.stats) > 1:
                self._announced.add("last_survivor")
                self.on_alert("last_survivor", "all", {"player_id": alive[0]})

    def sync_point(self, t: int, reconciled: int, total: int) -> None:
        self._push_feed(t, f"SYNC POINT — {reconciled}/{total} NODES RECONCILED", "SYNC POINT", "sync")

    # ---- views ----
    def _accuracy(self, st: _P) -> float | None:
        total = st.shots_baseline + st.shots
        if st.shots_t is None or st.shots_t < self.go_live_t or total <= 0:
            return None
        return round(100.0 * st.hits / total, 1)

    def _acc_provisional(self, st: _P) -> bool:
        """F119: is this row's accuracy a number the operator should act on yet?

        Numerator and denominator run on different clocks -- a hit is a fact, pushed the moment it
        happens; `shots` is SAMPLED off the ~2 s status heartbeat. Land two or three hits between
        samples and ACC spikes, and it can read over 100 %. Two conditions say "not settled":

        * fewer than `ACC_MIN_SHOTS` shots -- the small-sample precedent `honors()` already sets by
          refusing SHARPSHOOTER below the same floor; and
        * a `shots_t` that PREDATES the last landed hit, i.e. the denominator has not caught up with
          a numerator that already moved.

        No accuracy at all (no status since go-live, or no shots) is provisional too: there is nothing
        settled to show. Advisory and additive -- it never changes `accuracy` itself.
        """
        if self._accuracy(st) is None:
            return True
        if st.shots_baseline + st.shots < ACC_MIN_SHOTS:
            return True
        return st.last_hit_t is not None and (st.shots_t is None or st.shots_t < st.last_hit_t)

    def earned_medals(self) -> dict[str, list[str]]:
        """F116: the per-kill Halo medals each player actually WON, as row labels.

        Read back off `self.kills` rather than tallied on a second counter, so the row can never
        disagree with the feed it was built from. Repeats collapse to `×N` (three double kills is one
        `DOUBLE KILL ×3` chip, not three), and the order is the canonical `MEDAL_LABEL` order so two
        rows are comparable at a glance. This is what makes a 1v1 show medals at all: `honors()` is
        empty below three scored players, by design.
        """
        counts: dict[str, dict[str, int]] = {}
        for k in self.kills:
            killer = k.get("killer")
            if not killer:
                continue
            for m in (k.get("medals") or []):
                if m in MEDAL_LABEL:
                    counts.setdefault(killer, {})[m] = counts.setdefault(killer, {}).get(m, 0) + 1
        out: dict[str, list[str]] = {}
        for pid, got in counts.items():
            out[pid] = [MEDAL_LABEL[m] + (f" ×{got[m]}" if got[m] > 1 else "")
                        for m in MEDAL_LABEL if m in got]
        return out

    def rows(self) -> list[ScoreRow]:
        ae = (self.after_end() or {}).get("by_player", {})
        out: list[ScoreRow] = []
        for pid, st in self.stats.items():
            p = self.players[pid]
            out.append({
                "player_id": pid, "display": p["display"], "team_id": st.team_id,
                "kills": st.kills, "deaths": st.deaths, "assists": st.assists,
                "shots": st.shots_baseline + st.shots, "shots_total": st.shots_baseline + st.shots,
                "hits": st.hits, "accuracy": self._accuracy(st),
                "acc_provisional": self._acc_provisional(st),
                "kd": round(st.kills / max(st.deaths, 1), 2), "streak": st.streak, "medals": [],
                # F116: `streak` is the CURRENT one and is 0 for whoever died last, which is how a
                # 9-kill match reported "streak 0". Kept for compatibility; `best_streak` is the
                # number to show. `multi_best` / `first_blood` were tracked and never exposed either.
                "best_streak": st.best_streak, "multi_best": st.multi_best,
                "first_blood": self.first_blood == pid,
                # A24/M2: UNOFFICIAL, and additive. Always present (0/0) so a reader never has to tell
                # "none" from "this server is too old to say"; they feed nothing on this row.
                "after_end_kills": ae.get(pid, {}).get("kills", 0),
                "after_end_deaths": ae.get(pid, {}).get("deaths", 0),
            })
        out.sort(key=lambda r: (-r["kills"], -r["kd"], r["deaths"]))
        medals, earned = self.medals(), self.earned_medals()
        for r in out:
            honors = medals.get(r["player_id"], [])
            # honors first (MVP, MOST KILLS -- the whole-match verdicts), then what was won kill by
            # kill. `honors()` already awards FIRST BLOOD and MULTIKILL above 3 players, so drop an
            # earned chip whose base label is already standing -- under EITHER of its names
            # (`HONOR_ALIAS`): the honor is called MULTIKILL and the thing it is awarded for is called
            # DOUBLE KILL, so a 3+ player row printed both until 2026-09-12.
            base = {h.split(" ×")[0] for h in honors}
            r["medals"] = honors + [m for m in earned.get(r["player_id"], [])
                                    if not _stands(m.split(" ×")[0], base)]
        return out

    def live_rows(self, now: int, node_last_seen: dict[str, int]) -> list[LiveRow]:
        rows: list[LiveRow] = []
        pid_node = {pid: nid for nid, pid in self.node_player.items()}
        for r in self.rows():
            st = self.stats[r["player_id"]]
            nid = pid_node.get(r["player_id"])
            seen = node_last_seen.get(nid, 0) if nid else 0
            age = now - seen if seen else NEVER_SEEN_MS
            status: Literal["alive", "down", "stale"]
            if age > STALE_AFTER_MS:
                status = "stale"
            elif not st.alive:
                status = "down"
            else:
                status = "alive"
            row: LiveRow = {**r, "status": status, "sync_age_ms": age,
                            "respawn_in_s": st.deadline_s if status == "down" else None}
            rows.append(row)
        return rows

    # ---------- possession (objective modes: koth / domination) ----------
    def _possession(self, node_id: str, ev: Event) -> str:
        """Ingest one node's CUMULATIVE possession tally for a control point (mc/API.md `possession`).

        Three rules, and each exists because the obvious alternative is wrong:

        **Cumulative, merged by MAX per (site, team) — never summed.** Every node within beacon range
        of the same hill reports the same ownership, so four teammates standing on one point would
        otherwise score it four times. A cumulative total merged by max is also idempotent: a resend,
        a duplicated batch or a node that reconnects and re-reports cannot inflate it, and a lost
        report costs nothing as long as a later one arrives.

        **It bypasses the A6.1 end freeze.** That freeze exists so a KILL arriving after the whistle
        cannot change the result — a fact about a moment. A possession tally is a fact about the whole
        match, and the report we most want is the one the phone sends *at* the whistle. Dropping it
        would discard the only possession data we ever get. What replaces the freeze is a CLAMP: no
        team can be credited with more than the match length.

        **It does not need a bound player.** The payload carries team ids, not a player, so a node
        whose binding MC has lost still contributes a reading.
        """
        site = str(ev.get("site") or "A")
        hold = ev.get("hold_ms")
        if not isinstance(hold, dict):
            return "ignored"
        cap = self.time_limit_s * 1000 if self.time_limit_s else None
        def clamp(v) -> int | None:
            try:
                ms = int(v)
            except (TypeError, ValueError):
                return None
            ms = max(0, ms)
            return min(ms, cap) if cap is not None else ms
        seen_any = False
        for tid_raw, ms_raw in hold.items():
            try:
                tid = int(tid_raw)
            except (TypeError, ValueError):
                continue
            ms = clamp(ms_raw)
            if ms is None:
                continue
            per_node = self.possession_ms.setdefault(site, {}).setdefault(tid, {})
            per_node[node_id] = max(per_node.get(node_id, 0), ms)   # a node's own total only ever grows
            seen_any = True
        obs = clamp(ev.get("observed_ms"))
        if obs is not None:
            self.possession_observed[node_id] = max(self.possession_observed.get(node_id, 0), obs)
        if not seen_any and obs is None:
            return "ignored"
        return "scored"

    def possession(self) -> PossessionView | None:
        """Merged possession, or None when nobody reported any (mc/API.md RecapView.possession).

        Seconds per TEAM, the max reading per (site, team) — see `_possession`. A hill's NEUTRAL time
        (tid 2, bench-measured 2026-09-10) belongs to no team and is reported separately rather than
        being silently dropped or credited to a colour. `observed_s` is the BEST single observer's
        coverage: possession from a grenade is only ever a lower bound, because the beacon is IR and
        only a gun in range hears it (F92), so a match nobody watched reads as 0 rather than as a lie.
        """
        if not self.possession_ms and not self.possession_observed:
            return None
        tid_team = {t["tid"]: tid for tid, t in self.teams.items()}
        by_team: dict[str, int] = {tid: 0 for tid in self.teams}
        neutral_ms = 0
        for sites in self.possession_ms.values():
            for tid, per_node in sites.items():
                best = max(per_node.values()) if per_node else 0
                team_id = tid_team.get(tid)
                if team_id is None:            # tid 2 on a hill = NEUTRAL, and any tid nobody is on
                    neutral_ms += best
                else:
                    by_team[team_id] += best
        return {"by_team": {k: round(v / 1000) for k, v in by_team.items()},
                "neutral_s": round(neutral_ms / 1000),
                "sites": len(self.possession_ms),
                "reports": len(set(self.possession_observed) | {n for s in self.possession_ms.values()
                                                                for p in s.values() for n in p}),
                "observed_s": round(max(self.possession_observed.values(), default=0) / 1000),
                "of_s": self.time_limit_s}

    def team_scores(self) -> dict[str, int]:
        scores = {tid: self.team_credit.get(tid, 0) for tid in self.teams}   # A65: team-only kills first
        for st in self.stats.values():
            if st.team_id in scores:
                scores[st.team_id] += st.kills
        return scores

    def winner(self) -> WinnerView:
        # A24/M2: two sides reached the cap inside the clock-sync band — MC cannot order them, so it
        # does not pretend to. Checked first, because a dead heat outranks every other rule below.
        if self.cap_tie:
            return ({"player_id": None, "tie": list(self.cap_tie)} if self.mode == "ffa"
                    else {"team_id": None, "tie": list(self.cap_tie)})
        if self.mode == "ffa":
            rows = self.rows()
            if not rows:
                return {}
            # F154 (field 2026-09-12): `rows` is SORTED, and taking `rows[0]` handed the match to
            # whichever of two identical rows the sort happened to put first — the Pixel 4 was told it
            # LOST a 1-1 FFA. Equal top rows are a draw, said the same way the cap tie above says it.
            key = (-rows[0]["kills"], -rows[0]["kd"], rows[0]["deaths"])
            tops = [r["player_id"] for r in rows
                    if (-r["kills"], -r["kd"], r["deaths"]) == key]
            return {"player_id": tops[0]} if len(tops) == 1 else {"player_id": None, "tie": sorted(tops)}
        if self.win_by != "kills":
            # An OBJECTIVE mode is won on possession when the field actually reported some: the top
            # team by held seconds, a tie when two are level. This is the one thing that made the koth
            # card a promise MC could not keep — it printed "WIN · POSSESSION TIME" and then handed the
            # operator a kills table and "UNDECIDED". Nothing else changes: survival (infection / LMS)
            # has no tally to consult and stays undecided, as does an objective match nobody observed
            # (A5.9/A6.1 — decided by the host, not by kills).
            poss = self.possession()
            held = {t: s for t, s in (poss or {}).get("by_team", {}).items() if s > 0}
            if held:
                best = max(held.values())
                tops = sorted(t for t, s in held.items() if s == best)
                return {"team_id": tops[0]} if len(tops) == 1 else {"team_id": None, "tie": tops}
            return {"team_id": None, "undecided": self.win_by}
        scores = self.team_scores()
        if not scores:
            return {}
        best = max(scores.values())
        tops = [t for t, s in scores.items() if s == best]
        return {"team_id": tops[0]} if len(tops) == 1 else {"team_id": None, "tie": tops}

    def medals(self) -> dict[str, list[str]]:
        out: dict[str, list[str]] = {}
        for h in self.honors():
            out.setdefault(h["player_id"], []).append(h["award"])
        return out

    def _longest_life(self, pid: str) -> int:
        """A63 SURVIVOR: this player's longest single life in ms. A life runs from go-live (a hot joiner:
        their join) or a respawn to a death or the match end. The marks are sorted by time; a respawn while
        alive starts nothing, and a death while already down (its respawn fact was lost) measures nothing,
        so a missing fact can shorten a life, never invent a longer one."""
        st = self.stats[pid]
        start: int | None = max(self.go_live_t, self.joined_t.get(pid, self.go_live_t))
        end = self.end_t if self.end_t is not None else self.now_ms()
        best = 0
        for t, kind in sorted(st.life_marks):
            if kind == "d":
                if start is not None:
                    best = max(best, t - start)
                start = None
            elif start is None:
                start = t
        if start is not None:
            best = max(best, end - start)
        return max(0, best)

    def objective_s(self, pid: str) -> int:
        """A63 OBJECTIVE HERO: the seconds this player's own phone REPORTED their team holding a point while
        it was in range of it, summed over sites (the best of the player's nodes per site), from the
        `possession` tally the phone accrues for KOTH scoring. In range means IR range of a grenade beacon, or
        BLE range of a station. It is not proof the player stood on the point or captured it: MC holds no
        per-player capture log. A station's own report, a team-less player and neutral time count for nobody."""
        st = self.stats.get(pid)
        team = self.teams.get(st.team_id) if st and st.team_id else None
        if team is None:
            return 0
        nodes = {n for n, p in self.possession_pid.items() if p == pid}
        total = 0
        for sites in self.possession_ms.values():
            per_node = sites.get(team["tid"]) or {}
            total += max((ms for n, ms in per_node.items() if n in nodes), default=0)
        return round(total / 1000)

    def honors(self) -> list[Honor]:
        """A63: the end-of-match awards, one pass per `types.AWARDS` row, in its order. Each row names its
        rule and tie-break; a tie that survives the tie-break is SHARED (one Honor row per tied player)."""
        # honors need an audience (design review 2026-08-26 #3): a 1-player recap crowned itself
        # MVP · 0 K · 0.0 K/D + SURVIVOR · 1 DEATHS. Under 3 scored players there are no honors.
        if len(self.stats) < 3:
            return []
        items = list(self.stats.items())
        out: list[Honor] = []
        def kd(st: _P) -> float:
            return st.kills / max(st.deaths, 1)
        def top(pool, rank) -> list[str]:
            """Every player whose `rank` equals the best (highest) in `pool`: the shared tie."""
            ranked = [(pid, rank(pid, st)) for pid, st in pool]
            if not ranked:
                return []
            best = max(r for _p, r in ranked)
            return [pid for pid, r in ranked if r == best]
        def add(key: str, pids: Sequence[str], stat: Callable[[str], str]) -> None:
            for pid in pids:
                out.append({"award": AWARD_LABEL[key], "player_id": pid, "stat": stat(pid), "key": key})
        by: dict[str, list[str]] = {}
        mvp = top(items, lambda _p, st: (st.kills - st.deaths, kd(st), st.kills))
        by["mvp"] = [p for p in mvp if self.stats[p].kills > 0]          # a zero-kill MVP is noise
        mk = top(items, lambda _p, st: st.kills)
        by["most_kills"] = [p for p in mk if self.stats[p].kills > 0]
        # M1 (visual QA 2026-09-24): a zero-kill BEST K/D and a 0 % SHARPSHOOTER are noise, like a zero-kill MVP
        by["best_kd"] = top([kv for kv in items if kv[0] not in mvp and kv[1].kills > 0], lambda _p, st: (kd(st), st.kills))
        acc = {pid: a for pid, st in items
               if (st.shots_baseline + st.shots) >= ACC_MIN_SHOTS and (a := self._accuracy(st)) is not None and a > 0}
        by["sharpshooter"] = top([kv for kv in items if kv[0] in acc], lambda p, _st: round(acc[p]))
        life = {pid: self._longest_life(pid) for pid, _st in items}
        # A63 polish: a silent player (no fact ever reached MC) has no deaths MC could see, so neither
        # SURVIVOR nor IRON MAN may go to them; an unsynced node's life is timed by arrival, not by its clock.
        silent = set(self.missing())
        lives = [kv for kv in items if kv[0] not in silent and kv[0] not in self.unsynced_pids]
        sv = top(lives, lambda p, _st: life[p] // 1000)
        by["survivor"] = sv if sv and len(sv) < len(lives) and life[sv[0]] > 0 else []
        full = [kv for kv in items if kv[0] not in self.joined_t and kv[0] not in silent]
        im = top(full, lambda _p, st: (-st.deaths, st.kills))
        most = max((st.deaths for _p, st in full), default=0)   # someone must actually have died more
        by["iron_man"] = [p for p in im if self.stats[p].deaths < most]
        by["first_blood"] = [self.first_blood] if self.first_blood in self.stats else []
        mm = top([kv for kv in items if kv[1].multi_best >= 2],
                 lambda _p, st: (st.multi_best, sum(1 for x in st.multis if x >= 2)))
        by["multikill"] = mm
        wm = top(items, lambda _p, st: st.assists)
        by["wingman"] = [p for p in wm if self.stats[p].assists > 0]
        obj = {pid: self.objective_s(pid) for pid, _st in items} if self.mode in OBJECTIVE_MODES else {}
        oh = top([kv for kv in items if obj.get(kv[0], 0) > 0], lambda p, _st: obj[p])
        by["objective_hero"] = oh
        fb = next((k for k in self.kills if k["killer"] == self.first_blood), None)
        def multi_stat(pid: str) -> str:
            st = self.stats[pid]
            best = _chain_key(st.multi_best)
            n = sum(1 for x in st.multis if _chain_key(x) == best)
            return f"{MEDAL_LABEL.get(best or '', 'MULTIKILL')} ×{max(n, 1)}"
        stats: dict[str, Callable[[str], str]] = {
            "mvp": lambda p: f"{self.stats[p].kills} K · {kd(self.stats[p]):.1f} K/D · ×{self.stats[p].best_streak} STREAK",
            "most_kills": lambda p: f"{self.stats[p].kills} ELIMINATIONS",
            "best_kd": lambda p: f"K/D {kd(self.stats[p]):.1f} · {self.stats[p].kills} K",
            "sharpshooter": lambda p: f"{acc[p]:.0f}% ACCURACY",
            "survivor": lambda p: f"LONGEST LIFE {_mmss(life[p])}",
            "iron_man": lambda p: f"FEWEST DEATHS · {self.stats[p].deaths}",
            "first_blood": lambda p: f"AT {self._match_t(fb['t']) if fb else '--:--'}",
            "multikill": multi_stat,
            "wingman": lambda p: f"{self.stats[p].assists} ASSISTS",
            "objective_hero": lambda p: f"IN RANGE · {_mmss(obj[p] * 1000)}",
        }
        for a in AWARDS:
            add(a["key"], by.get(a["key"], []), stats[a["key"]])
        return out

    def missing(self) -> list[str]:
        return [pid for pid, st in self.stats.items() if not st.flushed]

    def recap(self, provisional_override: bool | None = None,
              stations: Sequence[RecapStationRow] | None = None) -> RecapView:
        missing = self.missing()
        out: RecapView = {"winner": self.winner(), "score": self.team_scores(), "rows": self.rows(),
               "honors": self.honors(),
               "provisional": bool(missing) if provisional_override is None else provisional_override,
               "missing": missing, "post_end": len(self.post_end), "post_end_facts": len(self.post_end),
               "parked": len(self.parked)}
        ae = self.after_end()
        if ae is not None:         # A24/M2: absent when nothing landed after the whistle
            out["after_end"] = ae
        poss = self.possession()
        if poss is not None:       # absent for every mode with no control point, so nothing else changes
            out["possession"] = poss
        warn = self.warnings()
        if warn:
            out["warnings"] = warn
        # Roadmap A6: the utility stations' own self-authoritative report (revives / control hold), one row
        # per ASSIGNED station -- the Scorer has no idea stations exist, so the caller (`Session._finish` /
        # `Session.recap`) hands the list in; absent (not `[]`) when nothing on the field was ever assigned.
        if stations:
            out["stations"] = list(stations)
        return out

    # F74's phantom loop: a gun replaying `$HIR`+`$HP` every 5.07 s with no IR in the air. A replayed hit is
    # indistinguishable from a real one at frame level, so F77 forbids a suppressor (it would eat real bursts).
    # This is the DETECTOR: a run of identical hits at a near-constant period is named in the recap.
    REPLAY_MIN_HITS = 4
    REPLAY_PERIOD_MS = (3000, 8000)     # the measured 5.07 s, with room; nothing a player fires sits here for 4 hits
    REPLAY_JITTER = 0.15                # every gap within ±15 % of the median

    def warnings(self) -> list[str]:
        out: list[str] = []
        by: dict[tuple[str, str, int], list[int]] = {}
        for t, shooter, victim, dmg in self.hits_log:
            by.setdefault((shooter, victim, dmg), []).append(t)
        names = {pid: self._name(pid) for pid in self.stats}
        for (shooter, victim, dmg), ts in sorted(by.items()):
            ts.sort()
            if len(ts) < self.REPLAY_MIN_HITS:
                continue
            gaps = [b - a for a, b in zip(ts, ts[1:])]
            # the longest run of consecutive gaps that look like one clock
            run, best = [], []
            for g in gaps:
                if not run:
                    run = [g]
                    continue
                med = sorted(run)[len(run) // 2]
                if self.REPLAY_PERIOD_MS[0] <= g <= self.REPLAY_PERIOD_MS[1] and abs(g - med) <= self.REPLAY_JITTER * med \
                        and self.REPLAY_PERIOD_MS[0] <= med <= self.REPLAY_PERIOD_MS[1]:
                    run.append(g)
                else:
                    best = max(best, run, key=len); run = [g]
            best = max(best, run, key=len)
            if len(best) + 1 >= self.REPLAY_MIN_HITS:
                period = sorted(best)[len(best) // 2] / 1000
                out.append(f"F74? {names.get(victim, victim)} took {len(best) + 1} identical {dmg}-damage hits from "
                           f"{names.get(shooter, shooter)} at a steady {period:.1f} s period -- the shape of a gun REPLAYING "
                           "a latched IR event, not a player firing. Those hits and any death they caused are counted; "
                           "check the shooter's shots against them, and re-arm the victim's gun with $SPAWN")
        n_hit, n_death = self.wire0["hit_taken"], self.wire0["death"]
        if n_hit or n_death:
            out.append(f"WIRE 0: {n_hit} hit(s) and {n_death} death(s) came from a shooter with NO identity -- a grenade "
                       "hill's damage word (F69) or a gun whose $PSET never landed (F80). They scored for nobody. If no "
                       "hill was on the field, one gun played the whole match unable to score: check its $PSET at the next arm")
        return out

    _csv_safe = staticmethod(_csv_safe)

    def csv(self) -> str:
        """This match's stats table. An ARCHIVED match goes through `rows_csv(recap["rows"])`
        instead — same writer, so the two exports can never drift apart (W1/F6)."""
        return rows_csv(self.rows())
