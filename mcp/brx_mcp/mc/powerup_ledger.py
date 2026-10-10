"""The per-match powerup spawn ledger and its Session-facing port."""
from __future__ import annotations

import logging
from typing import Any, Protocol, TypeGuard, TypedDict, cast

from . import powerups as _pu
from .types import Event, Player, PowerupSlot, StationAssignment, StationItem


# F473: how far before an item's respawn a PHONE's own clock may date its pickup fact and still count. MC keeps no
# per-node clock-offset error bound (a node's `t` is its synced clock; nothing records the sync's uncertainty), so
# this is a fixed bound: the claim-to-taker advert chain on the phone (about 100 ms in Android low-latency mode, a
# few hundred in the worst reading) plus the clock sync's own error. A station's report is MC-dated and needs none.
PU_PHONE_CLOCK_TOL_MS = 500
# F473: a phone's pickup fact carries the station's advertised seconds to its next spawn; MC credits the spawn whose
# next spawn time is closest to `t_recv + that`, and refuses a fact further than this from either of the last two.
# Sized from the worst error of the phone's countdown: the Stick rounds its seconds UP (under 1 s late), its advert
# repeats about once a second so the phone's read can be up to 1 s stale beyond the age it measures, and the phone
# rounds to whole seconds (0.5 s): about 2.5 s in all, and the clocks agree to milliseconds because the fact's own
# event time is used. 8 s is over three times that and still under a quarter of the shortest interval (30 s), so two
# spawns can never be confused. The advert carries whole seconds only, so the bias is documented, not removed.
PU_NAMED_SPAWN_TOL_MS = 8000
# One record per ended spawn (phone-credited AND station-settled, so a fact naming a settled spawn is a no-op and a
# phone credit can still be corrected): the last 8 spawns.
_PU_HIST = 8   # F454: how many ended spawns keep their taker record for a late station report


def _pu_old_hist(old: dict) -> list:
    """The taker history of a stored row: `hist`, or the single `prev` an earlier F454 build kept."""
    hist = old.get("hist")
    return hist if isinstance(hist, list) else [old.get("prev")]


def _pu_valid_taker(num: object) -> TypeGuard[int]:
    """A powerup taker is player_num 1..63 (powerups.md item 6; 0 = none)."""
    return isinstance(num, int) and not isinstance(num, bool) and 1 <= num <= 63


class PowerupRow(TypedDict):
    item: StationItem
    available: bool
    next_k: int
    since: int
    taken_by: int | None
    taken: bool
    by_station: bool
    line: str | None
    fid: int | None
    hist: list[dict[str, Any]]


class PowerupSnapshot(TypedDict):
    match_id: str
    go: int
    st: dict[str, PowerupRow]


class PowerupHost(Protocol):
    """Services the ledger needs from its owning Session."""

    def powerup_enabled(self) -> bool: ...
    def powerup_context(self) -> tuple[str, int] | None: ...
    def powerup_active_match(self) -> str | None: ...
    def powerup_item_stations(self) -> list[tuple[str, dict, StationItem]]: ...
    def powerup_slots(self) -> list[PowerupSlot]: ...
    def powerup_assignments(self) -> list[tuple[str, StationAssignment]]: ...
    def powerup_assignment(self, nid: str) -> StationAssignment | None: ...
    def powerup_required_assignment(self, nid: str) -> StationAssignment: ...
    def powerup_now(self) -> int: ...
    def powerup_player(self, player_id: str) -> Player | None: ...
    def powerup_player_num(self, num: object) -> Player | None: ...
    def powerup_pickup_time(self, src: str, raw: int, t_recv: int, seq: int | None) -> tuple[str | None, bool]: ...
    def powerup_t_match(self, now: int) -> int: ...
    def powerup_feed(self, entry: dict) -> None: ...
    def powerup_edit_feed(self, rec: PowerupRow | dict, old: str | None, fid: int | None,
                          new: str, station_id: object) -> None: ...
    def powerup_push(self, nid: str, body: dict) -> None: ...
    def powerup_changed(self) -> None: ...


class PowerupLedger:
    """One schedule at a time; a restored schedule waits for its matching match's first tick."""

    def __init__(self, host: PowerupHost):
        self.host = host
        self.match_id: str | None = None
        self.go_live_t: int = 0
        self.rows: dict[str, PowerupRow] = {}
        self._restored: dict[str, Any] | None = None

    def to_snapshot(self) -> PowerupSnapshot | None:
        """The existing `powerups` JSON shape, only for the match in play."""
        if self.match_id is None or self.match_id != self.host.powerup_active_match():
            return None
        return {"match_id": self.match_id, "go": self.go_live_t, "st": self.rows}

    def from_snapshot(self, value: dict | None) -> None:
        """Hold a saved schedule until the first tick can confirm its match id."""
        self._restored = value if isinstance(value, dict) else None

    def pending_snapshot(self) -> dict[str, Any] | None:
        """Let a failed session restore put the prior pending value back."""
        return self._restored

    def legacy_schedule(self) -> dict:
        """Compatibility view for callers that inspect the old Session field."""
        return {"match_id": self.match_id, "go": self.go_live_t, "st": self.rows} if self.match_id is not None else {}

    def has_station(self, nid: str) -> bool:
        return nid in self.rows

    def slots_view(self) -> list[PowerupSlot]:
        return self.host.powerup_slots()

    def station_state(self, nid: str) -> tuple[dict | None, dict | None, int | None]:
        """The update body, scheduled row, and start time for one item station."""
        # Only for the match in play (M2): a station reconnecting in RECAP or LOBBY must not get the old
        # match's state and start counting down to a spawn that will never come.
        if self.host.powerup_active_match() is None or self.match_id != self.host.powerup_active_match():
            return None, None, None
        row = self.rows.get(nid)
        a = self.host.powerup_assignment(nid)
        if row is None or not a:
            return None, None, None
        # The time to the NEXT spawn instant, ALWAYS (even while the item is there): the station counts down
        # and spawns on its own, so a lost MC link never freezes it.
        go = self.go_live_t
        body = {"id": a["id"], "available": row["available"],
                "next_spawn_in_ms": max(0, _pu.spawn_at(row["item"], go, row["next_k"]) - self.host.powerup_now())}
        return body, cast(dict, row), go

    def push_station_update(self, nid: str, reset: bool = False) -> None:
        body, _, _ = self.station_state(nid)
        if body is not None:
            if reset:
                body["reset"] = True   # the station tells an operator reset from a re-send of a spawn it awarded
            self.host.powerup_push(nid, body)

    def tick(self, now: int) -> None:
        """A56: the Halo schedule on MC's match clock. Items spawn at `first_at_s`, then every `spawn_every_s`
        after go-live; a spawn never stacks (an untaken item just stays). Built once per match, at the first
        tick that sees it armed, and each station is told its state then, at every spawn time, on a pickup
        and on its reconnect. A match resumed after an MC restart assumes an item is there if a spawn passed."""
        context = self.host.powerup_context()
        if context is None:
            return
        mid, go = context
        if self.match_id != mid:
            rows = {}
            restored, self._restored = self._restored, None
            kept = (restored.get("st") or {}) if isinstance(restored, dict) and restored.get("match_id") == mid else {}
            for nid, _a, item in self.host.powerup_item_stations():
                old = kept.get(nid)
                if isinstance(old, dict) and isinstance(old.get("next_k"), int) and isinstance(old.get("since"), int):
                    # M1: the SAME match's schedule from before the restart, taken items and all; any spawn
                    # that passed while MC was down fires on the catch-up tick below.
                    rows[nid] = {"item": item, "available": bool(old.get("available")), "next_k": old["next_k"],
                                 "since": old["since"], "taken_by": old.get("taken_by"),
                                 # a snapshot from before F454 has no `taken`/`by_station`: a spent item reads as
                                 # taken by a phone fact (a station report may still correct it)
                                 "taken": bool(old.get("taken", (not old.get("available")) and (old["next_k"] >= 1 or old.get("taken_by") is not None))),
                                 "by_station": bool(old.get("by_station", False)), "line": old.get("line"),
                                 "fid": old.get("fid") if isinstance(old.get("fid"), int) else None,
                                 "hist": [h for h in _pu_old_hist(old) if isinstance(h, dict)][-_PU_HIST:]}
                    continue
                k = _pu.last_spawn_index(item, go, now)
                # `since`: when the item in the station now became available (a spawn or an operator reset);
                # a fact older than that is about an earlier item. `taken_by`: this spawn's taker, if any.
                rows[nid] = {"item": item, "available": k >= 0, "next_k": k + 1,
                             "since": _pu.spawn_at(item, go, k) if k >= 0 else go, "taken_by": None,
                             "taken": False, "by_station": False, "line": None, "fid": None, "hist": []}
            self.match_id, self.go_live_t, self.rows = mid, go, rows
            self._pu_catch_up(now, go, push=False)
            for nid in rows:
                self.push_station_update(nid)
            if rows:
                self.host.powerup_changed()
            return
        if self._pu_catch_up(now, go, push=True):
            self.host.powerup_changed()

    def _pu_catch_up(self, now: int, go: int, push: bool) -> bool:
        """Fire every spawn time that has passed; True when any did."""
        changed = False
        for nid, row in self.rows.items():
            fired = False
            while now >= _pu.spawn_at(row["item"], go, row["next_k"]):
                row["next_k"] += 1
                fired = True
            if fired:
                new_since = _pu.spawn_at(row["item"], go, row["next_k"] - 1)
                self._pu_archive(row, new_since)
                row["available"], row["taken_by"] = True, None
                row["since"] = new_since
                if push:
                    self.push_station_update(nid)  # at each spawn time, even one that finds the item still there
                changed = True
        return changed

    def pickup(self, ev: Event, t_recv: int, parked: bool, nid: str = "") -> None:
        """A56: a player's `pickup` fact. Stored by the caller and NEVER scored; here it only empties the
        station until its next spawn time on the schedule and tells the station. A second report of an item
        already taken (the station's own `taken`, or another pickup), or a late fact about an item that has
        spawned or been reset since, changes nothing."""
        if parked or self.host.powerup_active_match() is None or self.match_id is None or ev.get("match_id") != self.match_id:
            return   # integration review (Low): a pickup flushed in RECAP or LOBBY changes nothing
        sid = ev.get("station_id")
        src = nid
        # A null id must not match a released powerup station that is no longer assigned.
        found = next((n for n, a in self.host.powerup_assignments()
                      if a.get("id") == sid and n in self.rows), None)
        if found is None:
            return
        nid = found
        raw = ev.get("t")
        raw = raw if isinstance(raw, int) and not isinstance(raw, bool) else t_recv
        # The verdict reads the fact's OWN time: a pickup queued during a forward step is stamped ahead of its arrival, and
        # the clamp below would hide that it sits in the stepped band (round 3).
        verdict, pending = self.host.powerup_pickup_time(src, raw, t_recv, ev.get("seq"))     # F485: an MC step seen first, so a genuine pickup is not read as future-dated
        t = min(raw, t_recv)
        if verdict == "ambiguous":
            # Queued across the node's clock step: it may be about the spawn before or the one after, and a take cannot be
            # undone. The station's own report settles it (F454).
            logging.getLogger("brx.mc").info("node %s: a pickup made across its clock step is ambiguous; it takes nothing "
                                             "(the station's report decides)", src)
            return
        if src and (verdict is not None or pending):
            t = t_recv     # F474: the phone's wall clock stepped, so its own time names the wrong spawn
        n = ev.get("next_spawn_in_s")
        # The fact's EVENT time (the phone's synced grant time, never after t_recv), not its arrival: a fact flushed
        # from an offline outbox arrives long after the grant and must name the spawn it was about.
        named = t + n * 1000 if isinstance(n, int) and not isinstance(n, bool) and 0 < n <= 255 else None
        self._take_item(nid, t, self.host.powerup_player(ev.get("player_id") or ""), tol=PU_PHONE_CLOCK_TOL_MS, named_next_ms=named)

    def _take_item(self, nid: str, t: int, player: Player | None, player_num: int | None = None,
                   from_station: bool = False, tol: int = 0, named_next_ms: int | None = None) -> bool:
        """Mark this spawn's item taken, once. The dedupe key is the station and its current item: an item
        already taken is a no-op, and so is a report from before the item became available (`since`).
        F454 (Tony, 2026-10-04): the STATION decides who took it. A station's `taken` report that names a
        different player than a phone's earlier `pickup` fact corrects the taker in place (no second TOOK
        line); a later phone fact never overrides it, and a second station report changes nothing.
        F473: `tol` (a phone's pickup fact only) is how far BEFORE the item's `since` the phone's own clock may
        date the fact and still count; a station's report is dated by MC and needs none. `named_next_ms` (MC clock) is
        when the phone says the station's NEXT spawn comes (its advert's countdown at the grant): it NAMES the spawn the
        fact is about, whatever the clocks say, and `tol` is only the fallback for a fact without it."""
        # A Stick spawns on its own clock and may report a take before MC's next tick: fire every spawn that is
        # already due first, so the take is judged against the item that was there (powerups.md, "Schedule").
        self._pu_catch_up(self.host.powerup_now(), self.go_live_t, push=True)
        row = self.rows[nid]
        a = self.host.powerup_required_assignment(nid)
        num = player.get("player_num") if player else player_num
        go, item, k = self.go_live_t, row["item"], row["next_k"]
        spawn_start = _pu.spawn_at(item, go, k - 1) if k >= 1 else go    # the latest spawn instant (a reset may be later)
        if named_next_ms is not None:
            # F473: the fact names its spawn by the station's own countdown: the spawn whose NEXT spawn time is
            # closest to when the phone says it comes. Intervals are 30 s or more, so a few seconds is unambiguous.
            step = int(item["spawn_every_s"]) * 1000
            j_next = round((named_next_ms - _pu.spawn_at(item, go, 0)) / step)       # the index of that next spawn
            off = abs(named_next_ms - _pu.spawn_at(item, go, j_next))
            # F484: index 0 is valid. A preset's first spawn is one interval after go-live, so an item the operator
            # restored before it has spawn 0 as its NEXT spawn. With k >= 1 it names the restored item, which is gone:
            # `_pu_past_take` refuses index -1, so a late fact about it never takes a later spawn.
            if off > PU_NAMED_SPAWN_TOL_MS or j_next < 0 or j_next > k:
                logging.getLogger("brx.mc").info("powerup pickup at station %s names no spawn (next spawn index %s, %s ms off; current %s): refused",
                                                 a["id"], j_next, off, k - 1)
                return False
            if j_next - 1 < k - 1:
                return self._pu_past_take(nid, row, a, player, num, j_next - 1, from_station=False)
            tol, t = 0, max(t, spawn_start)   # the current spawn: the countdown settles WHICH spawn, but a fact dated before a reset still precedes it
        if tol and t < row["since"] <= t + tol and row["available"] and row["since"] == spawn_start:
            t = row["since"]      # F473, a fact without a countdown (an older phone): inside the phone-clock tolerance
        if t < row["since"]:
            # A station's aged report about the PREVIOUS spawn (it arrived after the next spawn began) corrects
            # that spawn's taker and never takes the current one.
            prev = next((h for h in row.get("hist", ()) if h["since"] <= t < h["until"]), None)
            if from_station and prev and prev.get("by_station") is False:
                self._pu_correct_taker(row, prev, a, player, num)
            elif from_station and not prev and k >= 2 and _pu.spawn_at(item, go, k - 2) <= t < _pu.spawn_at(item, go, k - 1):
                self._pu_past_take(nid, row, a, player, num, k - 2, from_station=True)   # the previous spawn, never recorded
            return False
        if not row["available"]:
            # Taken. An item from a snapshot older than F454 has no `by_station`: that reads "not by the station".
            if from_station and row.get("taken") and not row.get("by_station"):
                self._pu_correct_taker(row, row, a, player, num)
            return False
        # A taker is player_num 1..63 (0 = none, powerups.md item 6): the item is taken either way, but a number
        # outside that range is never credited.
        valid = _pu_valid_taker(num)
        row["available"], row["taken"] = False, True
        row["taken_by"] = num if valid else None
        row["by_station"] = from_station and valid      # F454: only a station's own VALID report is final
        who = (player or {}).get("display") or (f"PLAYER {num}" if valid else "A PLAYER")
        row["line"] = f"{str(who).upper()} TOOK {row['item']['name']} · STATION #{a['id']}"
        line = {"t_match_s": self.host.powerup_t_match(self.host.powerup_now()), "tag": "POWERUP", "kind": "info", "text": row["line"]}
        self.host.powerup_feed(line)
        row["fid"] = line["id"]       # this spawn's feed row, so a correction edits THAT row
        self.push_station_update(nid)
        self.host.powerup_changed()
        return True

    def _pu_past_take(self, nid: str, row: PowerupRow | dict, a: StationAssignment, player: Player | None, num: object, j: int,
                      from_station: bool) -> bool:
        """F473: a take that belongs to the spawn BEFORE the current one (a station awarded it just before the next
        spawn; the report or the phone's fact arrived after). That spawn's item is gone, so nothing about the
        station changes; only its record and TOOK line are written, once, so a later report can correct or settle it."""
        go, item, k = self.go_live_t, row["item"], row["next_k"]
        if j < 0 or j >= k - 1 or j < k - 1 - _PU_HIST:
            return False
        ps, pe = _pu.spawn_at(item, go, j), _pu.spawn_at(item, go, j + 1)
        if any(h["since"] < pe and h["until"] > ps for h in row.get("hist", ())):
            return False        # that spawn already has its taker
        valid = _pu_valid_taker(num)
        who = (player or {}).get("display") or (f"PLAYER {num}" if valid else "A PLAYER")
        text = f"{str(who).upper()} TOOK {item['name']} · STATION #{a['id']}"
        entry = {"t_match_s": self.host.powerup_t_match(self.host.powerup_now()), "tag": "POWERUP", "kind": "info", "text": text}
        self.host.powerup_feed(entry)
        rec = {"since": ps, "until": pe, "taken_by": num if valid else None, "by_station": from_station and valid,
               "line": text, "fid": entry["id"]}
        row["hist"] = sorted([*row.get("hist", ()), rec], key=lambda h: h["since"])[-_PU_HIST:]
        self.host.powerup_changed()
        return True

    @staticmethod
    def _pu_archive(row: PowerupRow | dict, until: int) -> None:
        """Keep the spawn that is ending (its window, taker and feed row) so a station's aged report for it can
        still correct it (a phone-credited one), or so a late phone fact can be told from a new spawn's (F473), for the last `_PU_HIST` spawns. A
        station's own report is final."""
        hist = list(row.get("hist") or [])
        if row.get("taken") and not row["available"]:
            hist.append({"since": row["since"], "until": until, "taken_by": row.get("taken_by"),
                         "by_station": bool(row.get("by_station")),
                         "line": row.get("line"), "fid": row.get("fid")})
        row["hist"] = hist[-_PU_HIST:]
        row["taken"], row["by_station"], row["line"], row["fid"] = False, False, None, None

    def _pu_correct_taker(self, row: PowerupRow | dict, rec: PowerupRow | dict, a: StationAssignment, player: Player | None, num: object) -> None:
        """F454: a station's report names the taker of the spawn `rec` records (the row itself, or its `prev`);
        replace a phone's earlier credit in place. An invalid number does nothing: it neither credits nor blocks a
        later valid report. The recap carries no taker, so the feed row and `taken_by` are all that move."""
        if not _pu_valid_taker(num):
            return
        rec["by_station"] = True
        if num == rec.get("taken_by"):
            self.host.powerup_changed()
            return
        rec["taken_by"] = num
        who = (player or {}).get("display") or f"PLAYER {num}"
        new = f"{str(who).upper()} TOOK {row['item']['name']} · STATION #{a['id']}"
        old, fid = rec.get("line"), rec.get("fid")
        self.host.powerup_edit_feed(rec, old, fid, new, a["id"])
        self.host.powerup_changed()

    def _reset_item(self, nid: str) -> None:
        """The operator reset: the item is available NOW. The fixed spawn times do not move (no restart, and
        the next spawn does not stack a second item)."""
        row = self.rows[nid]
        self._pu_archive(row, self.host.powerup_now())
        row["available"], row["taken_by"], row["since"] = True, None, self.host.powerup_now()
        self.host.powerup_feed({"t_match_s": self.host.powerup_t_match(self.host.powerup_now()), "tag": "OPERATOR", "kind": "info",
                       "text": f"OPERATOR RESET · STATION #{self.host.powerup_required_assignment(nid)['id']}"})
        self.push_station_update(nid, reset=True)
        self.host.powerup_changed()

    def station_report(self, nid: str, body: dict, t_recv: int) -> None:
        """A56: a station's live-only report (`StationAction`). Ignored unless it comes from the station that
        holds that id and an item schedule runs for it."""
        a = self.host.powerup_assignment(nid) or {}
        if (not self.host.powerup_enabled() or self.host.powerup_active_match() is None or self.match_id is None
                or self.match_id != self.host.powerup_active_match() or nid not in self.rows
                or body.get("id") != a.get("id")):
            return
        if body.get("action") == "reset":
            self._reset_item(nid)
        elif body.get("action") == "taken":
            num = body.get("player_num")
            player = self.host.powerup_player_num(num)
            # Dated by `age_ms` (how long ago the station awarded it), never by the station's `t`: a Stick has no
            # synced clock, and a report queued while the link was down must not take a LATER spawn.
            age = body.get("age_ms")
            t = t_recv - age if isinstance(age, int) and not isinstance(age, bool) and 0 <= age <= t_recv else t_recv
            self._take_item(nid, t, player, num if isinstance(num, int) else None, from_station=True)
