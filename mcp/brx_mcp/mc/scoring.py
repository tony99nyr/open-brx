"""M-MC scoring — contracts.md §4 (A5): exact victim-side attribution, assists, accuracy, medals,
match_id parking, feedback freshness, time base. Pure Python; no I/O. The Session feeds it
persisted facts + status; it hands back ScoreRow/LiveRow/feed/winner/honors.
"""
from __future__ import annotations

import csv
import io
from typing import Callable

from .types import (ASSIST_WINDOW_MS, FEEDBACK_MAX_AGE_MS, MULTI_KILL_MS, STALE_AFTER_MS,
                    Event, Player, ScoreRow, Team)

Feed = dict
Feedback = Callable[[str, dict], None]     # (player_id, feedback body)


class _P:
    __slots__ = ("kills", "deaths", "assists", "hits", "friendly_kills", "streak", "best_streak",
                 "multi_best", "multis", "last_kill_t", "shots", "shots_t", "alive", "deadline_s",
                 "hp", "armor", "last_status_t", "flushed", "team_id", "shots_baseline")

    def __init__(self, team_id: str | None):
        self.kills = self.deaths = self.assists = self.hits = self.friendly_kills = 0
        self.streak = self.best_streak = self.multi_best = 0
        self.multis: list[int] = []
        self.last_kill_t: int | None = None
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
                 now_ms: Callable[[], int] | None = None, win_by: str | None = None):
        self.match_id = match_id
        self.go_live_t = go_live_t
        self.time_limit_s = time_limit_s
        self.mode = mode
        self.players = players
        self.teams = {t["team_id"]: t for t in teams}
        self.node_player = node_player            # node_id -> player_id (Session keeps it current)
        self.synced_at_lobby = synced_at_lobby    # node_id -> bool
        self.win_by = win_by
        self.on_feedback = on_feedback or (lambda pid, body: None)
        self.on_feed = on_feed or (lambda e: None)
        self.now_ms = now_ms or (lambda: 0)
        self.stats: dict[str, _P] = {pid: _P(p.get("team_id")) for pid, p in players.items()}
        self.num_to_pid = {p["player_num"]: pid for pid, p in players.items()}
        self.hits_log: list[tuple[int, str, str, int]] = []   # (t, shooter_pid, victim_pid, dmg)
        self.kills: list[dict] = []
        self.parked: list[tuple[str, Event, int]] = []
        self.feed: list[Feed] = []
        self.first_blood: str | None = None
        self.seen: set[tuple[str, int]] = set()
        # A6.1 end freeze: facts with effective t > end_t are recorded, never scored.
        self.end_t: int | None = (go_live_t + time_limit_s * 1000) if time_limit_s else None
        self.post_end: list[tuple[str, Event, int]] = []

    def set_end(self, end_t: int) -> None:
        """Freeze scoring at end_t (control{end}); later facts park as post_end (A6.1)."""
        if self.end_t is None or end_t < self.end_t:
            self.end_t = end_t

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
    def _pid(self, node_id: str, ev: Event) -> str | None:
        return ev.get("player_id") or self.node_player.get(node_id)

    def _eff_t(self, node_id: str, ev: Event, t_recv: int, rebase: int | None) -> int:
        if rebase is not None:
            return int(ev.get("t", t_recv)) + rebase
        if self.synced_at_lobby.get(node_id, False):
            return int(ev.get("t", t_recv))
        return t_recv

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
        pid = body.get("player_id") or self.node_player.get(node_id)
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
            self.ingest(node_id, ev, t_recv, rebase=rebase, suppress_awards=suppress)

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
        if kind == "hit_taken":
            shooter = self.num_to_pid.get(int(ev.get("shooter_num", 0) or 0))
            if shooter and shooter != pid:
                self.hits_log.append((t, shooter, pid, int(ev.get("dmg", 0) or 0)))
                if not self._friendly(shooter, pid):
                    self.stats[shooter].hits += 1
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
                    if self.first_blood is None:
                        self.first_blood = killer
                        tag = "FIRST BLOOD"
                    elif kill["multi"] == 2:
                        tag = "DOUBLE KILL"
                    elif kill["multi"] >= 3:
                        tag = "TRIPLE KILL"
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
                    body = {"player_id": killer, "kind": "multi" if kill["multi"] >= 2 else "kill", "t": t,
                            "victim": victim, "victim_team": self.stats[victim].team_id}
                    self.on_feedback(killer, body)
        self.kills.append(kill)
        if killer:
            verb = "team-killed" if friendly else "eliminated"
            text = f"{self._name(killer)} {verb} {self._name(victim)}"
        else:
            text = f"{self._name(victim)} went down"
        if tag == "FIRST BLOOD":
            text = f"{self._name(killer)} drew FIRST BLOOD on {self._name(victim)}"
        self._push_feed(t, text, tag, "kill")
        return "scored"

    def sync_point(self, t: int, reconciled: int, total: int) -> None:
        self._push_feed(t, f"SYNC POINT — {reconciled}/{total} NODES RECONCILED", "SYNC POINT", "sync")

    # ---- views ----
    def _accuracy(self, st: _P) -> float | None:
        total = st.shots_baseline + st.shots
        if st.shots_t is None or st.shots_t < self.go_live_t or total <= 0:
            return None
        return round(100.0 * st.hits / total, 1)

    def rows(self) -> list[ScoreRow]:
        out: list[ScoreRow] = []
        for pid, st in self.stats.items():
            p = self.players[pid]
            out.append({
                "player_id": pid, "display": p["display"], "team_id": st.team_id,
                "kills": st.kills, "deaths": st.deaths, "assists": st.assists,
                "shots": st.shots_baseline + st.shots, "shots_total": st.shots_baseline + st.shots,
                "hits": st.hits, "accuracy": self._accuracy(st),
                "kd": round(st.kills / max(st.deaths, 1), 2), "streak": st.streak, "medals": [],
            })
        out.sort(key=lambda r: (-r["kills"], -r["kd"], r["deaths"]))
        medals = self.medals()
        for r in out:
            r["medals"] = medals.get(r["player_id"], [])
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

    def team_scores(self) -> dict[str, int]:
        scores = {tid: 0 for tid in self.teams}
        for st in self.stats.values():
            if st.team_id in scores:
                scores[st.team_id] += st.kills
        return scores

    def winner(self) -> dict:
        if self.mode == "ffa":
            rows = self.rows()
            return {"player_id": rows[0]["player_id"]} if rows else {}
        if self.win_by not in (None, "", "kills"):
            # survival / objective ends are decided by the host or an objective source, not by kills (A5.9/A6.1)
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
        if not self.stats:
            return []
        items = list(self.stats.items())
        def add(award, pid, stat):
            if pid: out.append({"award": award, "player_id": pid, "stat": stat})
        out: list[dict] = []
        mvp = max(items, key=lambda kv: (kv[1].kills - kv[1].deaths, kv[1].kills / max(kv[1].deaths, 1), kv[1].kills))[0]
        m = self.stats[mvp]
        add("MVP", mvp, f"{m.kills} K · {m.kills / max(m.deaths,1):.1f} K/D · ×{m.best_streak} STREAK")
        mk = max(items, key=lambda kv: kv[1].kills)[0]
        add("MOST KILLS", mk, f"{self.stats[mk].kills} ELIMINATIONS")
        non = [kv for kv in items if kv[0] != mvp]
        if non:
            bk = max(non, key=lambda kv: (kv[1].kills / max(kv[1].deaths, 1), kv[1].kills))[0]
            b = self.stats[bk]
            add("BEST K/D · NON-MVP", bk, f"K/D {b.kills / max(b.deaths,1):.1f} · {b.kills} K")
        shooters = [(pid, self._accuracy(st)) for pid, st in items if (st.shots_baseline + st.shots) >= 10 and self._accuracy(st) is not None]
        if shooters:
            ss = max(shooters, key=lambda x: x[1])
            add("SHARPSHOOTER", ss[0], f"{ss[1]:.0f}% ACCURACY")
        sv = min(items, key=lambda kv: (kv[1].deaths, -kv[1].kills))[0]
        add("SURVIVOR", sv, f"{self.stats[sv].deaths} DEATHS")
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

    def recap(self, provisional_override: bool | None = None) -> dict:
        missing = self.missing()
        return {"winner": self.winner(), "score": self.team_scores(), "rows": self.rows(),
                "honors": self.honors(),
                "provisional": bool(missing) if provisional_override is None else provisional_override,
                "missing": missing, "post_end": len(self.post_end), "parked": len(self.parked)}

    @staticmethod
    def _csv_safe(v):
        # neutralise spreadsheet formula injection (=,+,-,@ leading a cell)
        return ("'" + v) if isinstance(v, str) and v[:1] in ("=", "+", "-", "@") else v

    def csv(self) -> str:
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["operator", "team", "kills", "deaths", "assists", "kd", "accuracy", "streak", "shots", "hits", "medals"])
        for r in self.rows():
            w.writerow([self._csv_safe(r["display"]), self._csv_safe(r["team_id"] or ""), r["kills"], r["deaths"],
                        r["assists"], r["kd"], "" if r["accuracy"] is None else r["accuracy"], r["streak"],
                        r["shots"], r["hits"], self._csv_safe(" · ".join(r["medals"]))])
        return buf.getvalue()
