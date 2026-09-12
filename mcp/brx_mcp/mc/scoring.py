"""M-MC scoring — contracts.md §4 (A5): exact victim-side attribution, assists, accuracy, medals,
match_id parking, feedback freshness, time base. Pure Python; no I/O. The Session feeds it
persisted facts + status; it hands back ScoreRow/LiveRow/feed/winner/honors.
"""
from __future__ import annotations

import csv
import io
from typing import Any, Callable, Mapping

from .types import (ACC_MIN_SHOTS, ASSIST_WINDOW_MS, FEEDBACK_MAX_AGE_MS, MULTI_KILL_MS,
                    STALE_AFTER_MS, Event, Player, ScoreRow, Team)

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
MEDAL_LABEL = {"first_blood": "FIRST BLOOD", "double_kill": "DOUBLE KILL", "triple_kill": "TRIPLE KILL",
               "killtacular": "KILLTACULAR", "killing_spree": "KILLING SPREE", "unstoppable": "UNSTOPPABLE"}
# The per-kill label an `honors()` award ALREADY stands for. FIRST BLOOD is the same word in both lists
# and needs no entry; the multi-kill honor is called MULTIKILL and is awarded for a double/triple, so
# without this a 3+ player row printed `MULTIKILL` and `DOUBLE KILL ×2` as two separate chips for one
# thing (polish review 2026-09-12). Base labels only -- the `×N` suffix is stripped before the lookup.
HONOR_ALIAS = {"DOUBLE KILL": "MULTIKILL", "TRIPLE KILL": "MULTIKILL", "KILLTACULAR": "MULTIKILL"}


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
                 "deadline_s", "hp", "armor", "last_status_t", "flushed", "team_id", "shots_baseline")

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


class Scorer:
    def __init__(self, match_id: str, go_live_t: int, time_limit_s: int | None, mode: str,
                 players: dict[str, Player], teams: list[Team],
                 node_player: dict[str, str], synced_at_lobby: dict[str, bool],
                 on_feedback: Feedback | None = None, on_feed: Callable[[Feed], None] | None = None,
                 now_ms: Callable[[], int] | None = None, win_by: str | None = None,
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
        self.win_by = win_by
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

    def after_end(self) -> dict | None:
        """The UNOFFICIAL after-the-whistle block (A6.1 + A24), or None when nothing arrived late.

        These are real facts — a player kept playing, or a phone flushed minutes later — and A6.1
        already records them without scoring them. Until now the recap could only say HOW MANY; a
        player whose last three kills landed after the end saw them vanish with no explanation. So
        the breakdown rides along, clearly separated: it feeds nothing (not kills, not streaks, not
        medals, not the winner) and is shown as "after the whistle".
        """
        if not self.post_end:
            return None
        by: dict[str, dict[str, int]] = {}
        def slot(pid: str) -> dict[str, int]:
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
        for node_id, ev, t_recv in self.post_end:
            if ev.get("type") != "death":
                continue
            if self._eff_t(node_id, ev, t_recv, None) > self.end_t + tol_ms:
                continue
            victim, killer = self._kill_pair(node_id, ev)
            if victim is None or not killer:
                continue
            kills[killer] += -1 if self._friendly(killer, victim) else 1
        if self.mode == "ffa":
            scores = kills
        else:
            scores = {tid: 0 for tid in self.teams}
            for pid, k in kills.items():
                tid = self.stats[pid].team_id
                if tid in scores:
                    scores[tid] += k
        at_cap = sorted(k for k, v in scores.items() if v >= self.frag_limit)
        return at_cap if len(at_cap) > 1 else None

    def shots_total(self, pid: str) -> int:
        st = self.stats[pid]
        return st.shots_baseline + st.shots

    def register_player(self, pid: str, player: Player) -> None:
        """A5.6 late joiner: make a mid-match arrival scorable (stats + num map + players)."""
        if pid in self.stats:
            return
        self.players[pid] = player
        self.stats[pid] = _P(player.get("team_id"))
        self.num_to_pid[player["player_num"]] = pid

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
            return self._possession(node_id, ev)
        pid = self._pid(node_id, ev)
        if not pid or pid not in self.stats:
            return "ignored"
        st = self.stats[pid]
        st.flushed = True
        t = self._eff_t(node_id, ev, t_recv, rebase)
        if not self.synced_at_lobby.get(node_id, False):
            suppress_awards = True                  # A5.7: never-synced node → no window awards on the live path either
        if self.end_t is not None and t > self.end_t:
            self.post_end.append((node_id, ev, t_recv))
            return "post_end"
        kind = ev.get("type")
        if kind in self.wire0 and int(ev.get("shooter_num", 0) or 0) == 0:
            self.wire0[kind] += 1
        if kind == "hit_taken":
            shooter = self.num_to_pid.get(int(ev.get("shooter_num", 0) or 0))
            if shooter and shooter != pid:
                self.hits_log.append((t, shooter, pid, int(ev.get("dmg", 0) or 0)))
                if not self._friendly(shooter, pid):
                    self.stats[shooter].hits += 1
                    ss = self.stats[shooter]
                    ss.last_hit_t = t if ss.last_hit_t is None else max(ss.last_hit_t, t)
            return "scored"
        if kind == "death":
            return self._death(pid, ev, t, suppress_awards)
        if kind == "respawn":
            st.alive = True
            st.streak = 0
            return "scored"
        if kind == "team_change":
            tid = int(ev.get("tid", -1))
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

    def _death(self, victim: str, ev: Event, t: int, suppress: bool) -> str:
        vs = self.stats[victim]
        vs.deaths += 1
        vs.alive = False
        vs.streak = 0
        killer = self.num_to_pid.get(int(ev.get("shooter_num", 0) or 0))
        if killer == victim:
            killer = None
        friendly = self._friendly(killer, victim)
        kill = {"t": t, "match_id": self.match_id, "victim": victim, "killer": killer,
                "team": vs.team_id, "friendly": friendly, "multi": 1, "desync": bool(ev.get("desync"))}
        tag = None
        if killer:
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
                    if ks.last_kill_t is not None and t - ks.last_kill_t <= MULTI_KILL_MS:
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
                if kill["multi"] == 2:
                    medals.append("double_kill")
                elif kill["multi"] == 3:
                    medals.append("triple_kill")
                elif kill["multi"] >= 4:
                    medals.append("killtacular")
                if ks.streak == 5:
                    medals.append("killing_spree")
                elif ks.streak == 10:
                    medals.append("unstoppable")
                kill["medals"] = medals
                if medals:
                    tag = " + ".join(m.replace("_", " ").upper() for m in medals)
                elif ks.streak >= 3:
                    tag = f"STREAK ×{ks.streak}"
                ks.last_kill_t = t
                # assists: other players who damaged the victim inside the window
                # assists: each OTHER player who damaged the victim inside the window gets exactly one
                assisters: list[str] = []
                for ht, shooter, v, _dmg in self.hits_log:
                    if v == victim and shooter not in (killer, victim) and t - ASSIST_WINDOW_MS <= ht <= t and shooter not in assisters:
                        assisters.append(shooter)
                for a in assisters:
                    self.stats[a].assists += 1
                if assisters:
                    kill["assists"] = assisters
                # feedback to the killer only if fresh
                if self.now_ms() - t <= FEEDBACK_MAX_AGE_MS and not suppress:
                    # kind stays "kill" (older nodes play their kill line); `medals` is the A11.4 stack,
                    # which a current node plays INSTEAD of the plain line, one after another.
                    body = {"player_id": killer, "kind": "kill", "t": t, "medals": list(kill.get("medals") or []),
                            "victim": victim, "victim_team": self.stats[victim].team_id}
                    self.on_feedback(killer, body)
        # Polish 2026-09-04: alerts after EVERY scored death, not only enemy kills -- a team kill (kills -= 1)
        # can flip the lead, and a death with no known shooter still leaves a last survivor.
        if not suppress:
            self._match_state_alerts(t)
        self.kills.append(kill)
        if killer:
            verb = "team-killed" if friendly else "eliminated"
            text = f"{self._name(killer)} {verb} {self._name(victim)}"
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
        if self.win_by not in (None, "", "kills"):
            return
        scores = ({pid: st.kills for pid, st in self.stats.items()} if self.mode == "ffa"
                  else self.team_scores())
        if not scores or max(scores.values()) < self.frag_limit:
            return
        self._announced.add("frag_limit")
        self.limit_reached_t = t
        self.on_limit(t)

    def _match_state_alerts(self, t: int) -> None:
        """A11.4: lead changes, next-kill-wins and the last survivor, to the nodes they concern.

        Lead: team modes compare team totals; FFA compares players. `lead_taken` goes to the new leader
        (team or player), `lead_lost` to the one displaced; ties change nothing. `next_kill_wins`
        fires ONCE when anyone reaches cap-1. `last_survivor` fires once when exactly one player is
        alive in a survival mode (lms / infection)."""
        if self.now_ms() - t > FEEDBACK_MAX_AGE_MS:
            return
        if self.win_by in (None, "", "kills"):
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

    def live_rows(self, now: int, node_last_seen: dict[str, int]) -> list[dict]:
        rows = []
        pid_node = {pid: nid for nid, pid in self.node_player.items()}
        for r in self.rows():
            st = self.stats[r["player_id"]]
            nid = pid_node.get(r["player_id"])
            seen = node_last_seen.get(nid, 0) if nid else 0
            age = now - seen if seen else 10**9
            if age > STALE_AFTER_MS:
                status = "stale"
            elif not st.alive:
                status = "down"
            else:
                status = "alive"
            row = dict(r)
            row.update({"status": status, "sync_age_ms": age,
                        "respawn_in_s": st.deadline_s if status == "down" else None})
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

    def possession(self) -> dict | None:
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
        scores = {tid: 0 for tid in self.teams}
        for st in self.stats.values():
            if st.team_id in scores:
                scores[st.team_id] += st.kills
        return scores

    def winner(self) -> dict:
        # A24/M2: two sides reached the cap inside the clock-sync band — MC cannot order them, so it
        # does not pretend to. Checked first, because a dead heat outranks every other rule below.
        if self.cap_tie:
            key = "player_id" if self.mode == "ffa" else "team_id"
            return {key: None, "tie": list(self.cap_tie)}
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
        if self.win_by not in (None, "", "kills"):
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

    def honors(self) -> list[dict]:
        # honors need an audience (design review 2026-08-26 #3): a 1-player recap crowned itself
        # MVP · 0 K · 0.0 K/D + SURVIVOR · 1 DEATHS. Under 3 scored players there are no honors.
        if len(self.stats) < 3:
            return []
        items = list(self.stats.items())
        def add(award, pid, stat):
            if pid: out.append({"award": award, "player_id": pid, "stat": stat})
        out: list[dict] = []
        mvp = max(items, key=lambda kv: (kv[1].kills - kv[1].deaths, kv[1].kills / max(kv[1].deaths, 1), kv[1].kills))[0]
        m = self.stats[mvp]
        if m.kills > 0:                                   # a zero-kill MVP is noise
            add("MVP", mvp, f"{m.kills} K · {m.kills / max(m.deaths,1):.1f} K/D · ×{m.best_streak} STREAK")
        mk = max(items, key=lambda kv: kv[1].kills)[0]
        if self.stats[mk].kills > 0:
            add("MOST KILLS", mk, f"{self.stats[mk].kills} ELIMINATIONS")
        non = [kv for kv in items if kv[0] != mvp]
        if non:
            bk = max(non, key=lambda kv: (kv[1].kills / max(kv[1].deaths, 1), kv[1].kills))[0]
            b = self.stats[bk]
            add("BEST K/D · NON-MVP", bk, f"K/D {b.kills / max(b.deaths,1):.1f} · {b.kills} K")
        shooters = [(pid, acc) for pid, st in items
                    if (st.shots_baseline + st.shots) >= ACC_MIN_SHOTS
                    and (acc := self._accuracy(st)) is not None]
        if shooters:
            ss = max(shooters, key=lambda x: x[1])
            add("SHARPSHOOTER", ss[0], f"{ss[1]:.0f}% ACCURACY")
        sv = min(items, key=lambda kv: (kv[1].deaths, -kv[1].kills))[0]
        if self.stats[sv].deaths < max(kv[1].deaths for kv in items):   # someone must actually have outlived the field
            add("SURVIVOR", sv, f"FEWEST DEATHS · {self.stats[sv].deaths}")
        if self.first_blood:
            fb = next((k for k in self.kills if k["killer"] == self.first_blood), None)
            add("FIRST BLOOD", self.first_blood, f"AT {self._match_t(fb['t']) if fb else '--:--'}")
        multis = [(pid, st.multi_best, sum(1 for x in st.multis if x >= 2)) for pid, st in items if st.multi_best >= 2]
        if multis:
            mm = max(multis, key=lambda x: (x[1], x[2]))
            add("MULTIKILL", mm[0], f"{'DOUBLE' if mm[1] == 2 else 'TRIPLE'} KILL ×{mm[2]}")
        return out

    def missing(self) -> list[str]:
        return [pid for pid, st in self.stats.items() if not st.flushed]

    def recap(self, provisional_override: bool | None = None, stations: list[dict] | None = None) -> dict:
        missing = self.missing()
        out = {"winner": self.winner(), "score": self.team_scores(), "rows": self.rows(),
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
            out["stations"] = stations
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
