"""M-MC Session — the match state machine (docs/spec/contracts.md §5/§6, mc/API.md).

Owns: phase, roster (player_num), teams, GameConfig draft, node registry, readiness rollup,
kit-out/tutorial pushes, lobby push + acks, start/reschedule/abort, controls, hydrate answer,
and the Scorer for the current match. Everything the UI sees is `snapshot()` (API.md State).
"""
from __future__ import annotations

import copy
import json
import random
import time
import uuid
from typing import Any, Callable

from . import presentation as _pres
from .. import voices as _voices
from . import policy as _policy
from .scoring import Scorer
from .types import (DEFAULT_RUNWAY_S, MAX_PLAYERS, OFFLINE_AFTER_MS, STALE_AFTER_MS, SYNC_FRESH_MS, GameConfig, Player,
                    ReadinessRow, ReadinessSnapshot, ScanRow, Team)

PHASES = ("muster", "build", "kit", "lobby", "armed", "live", "recap")

TEAM_DEFS = {  # $TID: 1=blue, 2=yellow, 0=red (protocol §7i); green provisional 3
    "blue": {"team_id": "blue", "name": "BLUE TEAM", "color": "#3a86ff", "tid": 1},
    "yellow": {"team_id": "yellow", "name": "YELLOW TEAM", "color": "#ffd23f", "tid": 2},
    "red": {"team_id": "red", "name": "RED TEAM", "color": "#ff5252", "tid": 0},
    "green": {"team_id": "green", "name": "GREEN TEAM", "color": "#2ecc71", "tid": 3},
    "ffa": {"team_id": "ffa", "name": "FREE-FOR-ALL", "color": "#e8eef5", "tid": 1},
}

# Briefing copy verbatim from the Mission Control design export (A2 mode briefing panel).
MODES = [
    {"mode": "tdm", "name": "TEAM DEATHMATCH", "abbr": "TDM", "desc": "Teams score per elimination",
     "brief": "Squads score a point per elimination. Downed players respawn after the delay and rejoin. First team to the score cap — or the highest score at the time limit — takes the match.",
     "teams_text": "2–4 TEAMS", "win_text": "SCORE CAP / TIME", "respawn_text": "ON · TIMED",
     "teams": ["blue", "yellow"], "win_by": "kills", "frag_limit": 25, "respawn": {"type": "auto", "delay_s": 15}},
    {"mode": "ffa", "name": "FREE-FOR-ALL", "abbr": "FFA", "desc": "Every operator for themselves",
     "brief": "No teams — everyone is a target. Each elimination scores a point. First to the frag limit, or the top score when time expires, wins.",
     "teams_text": "NONE · ALL VS ALL", "win_text": "FRAG LIMIT / TIME", "respawn_text": "ON · TIMED",
     "teams": ["ffa"], "win_by": "kills", "frag_limit": 25, "respawn": {"type": "auto", "delay_s": 15}},
    {"mode": "infection", "name": "INFECTION", "abbr": "INF", "desc": "One infected; survive the spread",
     "brief": "One operator starts infected. Survivors who go down switch sides and hunt their old squad. Survivors win by outlasting the clock; the infected win by converting everyone.",
     "teams_text": "SURVIVORS VS INFECTED", "win_text": "SURVIVE THE CLOCK", "respawn_text": "INFECTED ONLY",
     "teams": ["blue", "red"], "win_by": "survival", "frag_limit": None, "respawn": {"type": "auto", "delay_s": 10}},
    {"mode": "lms", "name": "LAST MAN STANDING", "abbr": "LMS", "desc": "Limited lives, last alive wins",
     "brief": "Every operator carries a fixed pool of lives. Once they are spent there is no respawn. The last operator — or last squad — still standing takes the match.",
     "teams_text": "SOLO OR SQUADS", "win_text": "LAST ALIVE", "respawn_text": "OFF · LIVES",
     "teams": ["ffa"], "win_by": "survival", "frag_limit": None, "respawn": {"type": "none", "delay_s": 0}},
    {"mode": "extraction", "name": "EXTRACTION", "abbr": "EXT", "desc": "Loot, reach the extract, survive the channel",
     "brief": "Gather loot, then reach an extraction point and channel the extract. It is loud: everyone hears the chopper coming and converges on you. Survive the timer and your loot is banked. Die and you drop it all for someone else to take.",
     "teams_text": "SOLO OR SQUADS", "win_text": "BANKED LOOT", "respawn_text": "ON · TIMED",
     "teams": ["blue", "yellow"], "win_by": "objective", "frag_limit": None, "respawn": {"type": "auto", "delay_s": 15}},
]


# End of a private try-out: the gun goes idle and stays UNHITTABLE until the game is pushed. That is
# intended (it is a teardown), and it is a named constant so `test_clear_safety` can track the REAL
# list rather than a hand-copied duplicate that would drift silently.
TRYOUT_TEARDOWN = ("$SPAWN,,*", "$PLAYX,0,*", "$STOP,*", "$CLEAR,*", "$HLOOP,0,0,*",
                   "$HLED,0,0,0,0,0,0,*")


def default_config(mode: str = "tdm") -> GameConfig:
    m = next(x for x in MODES if x["mode"] == mode)
    return {"config_id": uuid.uuid4().hex[:8], "mode": mode, "environment": "outdoor", "night": False,
            "time_limit_s": 600, "respawn": dict(m["respawn"]),
            "scoring": {"frag_limit": m["frag_limit"], "win_by": m["win_by"]},
            "health": {"max_hp": 45, "max_armor": 70},
            "teams": [dict(TEAM_DEFS[t]) for t in m["teams"]],
            "loadout_policy": _policy.default_policy(mode),      # A10: ffa → no_heavies, else open
            "presentation": _pres.default_for(mode)}             # A11: cs → counter_strike, else standard


class Session:
    def __init__(self, compiler, net, armory, store=None, now_ms: Callable[[], int] | None = None,
                 lan: dict | None = None, voice_rng: random.Random | None = None):
        self.compiler, self.net, self.armory, self.store = compiler, net, armory, store
        # A15.1: every push rolls the un-picked $PSET voice fields (death scream, short pain, respawn cry) so two
        # players with the same character do not die with the same scream; inject a seeded Random in tests.
        self._voice_rng = voice_rng or random.Random()
        self.now_ms = now_ms or (lambda: int(time.time() * 1000))
        self.session_id = uuid.uuid4().hex[:8]
        self.phase = "muster"
        self.players: dict[str, Player] = {}
        self.teams: list[Team] = []
        self.config: GameConfig = default_config("tdm")
        self.teams = list(self.config["teams"])
        self.config_errors: list[str] = []
        self.config_warnings: list[str] = []
        self.nodes: dict[str, dict] = {}          # node_id -> NodeView
        self.node_player: dict[str, str] = {}     # node_id -> player_id
        self.synced_at_lobby: dict[str, bool] = {}
        self.scan_rows: list[ScanRow] = []
        self.lan = lan or {"mode": "unknown", "ip": "0.0.0.0", "port": 0, "ws_url": "", "qr": ""}
        self.trying: dict[str, str] = {}          # player_id -> weapon_id
        self.browsing: dict[str, int] = {}        # A10: player_id -> t_ms the HUD opened its loadout browser
        self._policy_notice: str | None = None    # A10: "N LOADOUTS RESET BY …" — shown in config_warnings until the next config PUT
        self.active_preset_id: str | None = None  # A10 §8: the saved game that was APPLIED — GAMES marks it PLAYING (content-matching
                                                  # cannot tell a duplicate from its source: review 2026-08-27 #0)
        self.presets = None                       # A10 §8: PresetStore, attached by __main__/create_app (memory store when absent)
        self.lobby_pushed = False
        self.acks: dict[str, dict] = {}
        self.bundles: dict[str, dict] = {}
        self.start_info: dict | None = None
        self.start_seq = 0
        self.scorer: Scorer | None = None
        self._score_pushed: dict[str, dict] = {}   # A7: last ScoreRow pushed per player
        self._log_bytes: dict[str, int] = {}       # per-node pulled-log byte budget
        self.last_recap: dict | None = None
        self.feed: list[dict] = []
        self._listeners: list[Callable[[], None]] = []
        self._feed_listeners: list[Callable[[dict], None]] = []
        self._attach_net()
        self._gun_index()

    # ---------- plumbing ----------
    def on_change(self, cb): self._listeners.append(cb)
    def on_feed(self, cb): self._feed_listeners.append(cb)
    def _changed(self):
        self._sync_kit_open()          # A10: phase/push flips re-assign the phones (setting-up ⇄ kit editor)
        for cb in self._listeners:
            cb()
        self._persist()

    # An MC restart must not dump the roster: 3x on 2026-08-26 a restart mid-setup left connected
    # phones on "WAITING FOR KIT-OUT" with every gun ghosted NOT SEEN. Snapshot the human work
    # (players/teams/config) — never live link state (node_id, phase, acks).
    _persist_path = None            # set by __main__; None = persistence off (tests)
    _persist_last = 0.0
    _persist_dirty = False

    def persist_now(self):
        """Throttle-bypassing flush — atexit and phase transitions call this so the FINAL
        write of a burst is never lost to the 2s debounce (polish-loop 2026-08-26)."""
        if self._persist_path and self._persist_dirty:
            self._persist_last = 0.0
            self._persist()

    def _persist(self):
        if not self._persist_path:
            return
        now = time.monotonic()
        if now - self._persist_last < 2.0:
            self._persist_dirty = True      # a delayed flush (persist_now via atexit/transitions) picks this up
            return
        self._persist_last = now
        self._persist_dirty = False
        try:
            snap = {"v": 1, "saved_ms": self.now_ms(),
                    "players": [{**p, "node_id": None, "ready": False} for p in self.players.values()],
                    "teams": self.teams, "config": self.config, "active_preset_id": self.active_preset_id}
            tmp = self._persist_path.with_suffix(".tmp")
            tmp.write_text(json.dumps(snap))
            tmp.replace(self._persist_path)
        except Exception:
            import logging; logging.getLogger("brx.mc").exception("session snapshot failed (play continues)")

    def restore_snapshot(self) -> int:
        """Load a prior session.json (if any). Returns the number of players restored."""
        if not self._persist_path or not self._persist_path.exists():
            return 0
        try:
            snap = json.loads(self._persist_path.read_text())
            self.players = {p["player_id"]: p for p in snap.get("players", [])}
            if snap.get("teams"):
                self.teams = snap["teams"]
            if snap.get("config"):
                self.config = snap["config"]
            self.active_preset_id = snap.get("active_preset_id")
            self._repair_player_nums()
            self.config["loadout_policy"] = _policy.normalize(self.config.get("loadout_policy"), self.config["mode"])
            # A11: a snapshot persisted before the presentation profile existed gets the mode default, so the
            # console still reads it as the stock mode it was (the UI compares configs to the mode defaults).
            if not isinstance(self.config.get("presentation"), dict):
                self.config["presentation"] = _pres.default_for(self.config["mode"])
            for pl in self.players.values():                      # a pre-A10 snapshot has no `perk` key; fine
                pl["loadout"] = _policy.apply(self.config["loadout_policy"], self.loadout_pool(), pl.get("loadout") or {"weapons": []},
                                              *self._catalog_rows())
            self._gun_index()
            return len(self.players)
        except Exception:
            import logging; logging.getLogger("brx.mc").exception("session snapshot restore failed — starting clean")
            return 0
    def _repair_player_nums(self) -> None:
        """Every restored player gets a UNIQUE 1..63 `player_num`, whatever the file said.

        `player_num` is what goes on the wire as the `$PSET` player id, so a duplicate is not a
        cosmetic problem: two guns answer to the same id and every hit either of them takes is
        attributed to whichever player MC looks up first. The restore path used to take the file's
        numbers verbatim and only re-derive them at the next config change — so a hand-edited,
        half-written or two-sessions-merged snapshot could arm a game that scores the wrong people
        (polish-loop deferred low). Order is stable: the first player to claim a number keeps it.
        """
        seen: set[int] = set()
        needs: list[Player] = []
        for p in self.players.values():
            n = p.get("player_num")
            ok = isinstance(n, int) and not isinstance(n, bool) and 1 <= n <= MAX_PLAYERS and n not in seen
            if ok:
                seen.add(n)
            else:
                needs.append(p)
        if not needs:
            return
        import logging
        base = int(self.config.get("player_num_base") or 1)
        # Prefer the configured base range (A6.5 keeps concurrent games disjoint), but fall back to
        # the numbers BELOW it before giving up: this path RESTORES a roster, and dropping a real
        # player while 1..base-1 sat free would destroy data the operator already had. The live add
        # path (`_next_num`) may refuse; this one must not (review 2026-09-01).
        start = max(1, min(base, MAX_PLAYERS))
        order = list(range(start, MAX_PLAYERS + 1)) + list(range(1, start))
        free = (n for n in order if n not in seen)
        for p in needs:
            n = next(free, None)
            if n is None:                                  # roster fuller than the wire allows
                logging.getLogger("brx.mc").error(
                    "snapshot has more players than player_nums (%d) — dropping %s", MAX_PLAYERS, p.get("display"))
                self.players.pop(p["player_id"], None)
                continue
            logging.getLogger("brx.mc").warning(
                "snapshot player_num %r for %s was invalid or taken — reassigned to %d",
                p.get("player_num"), p.get("display"), n)
            p["player_num"] = n
            seen.add(n)

    def _log(self, node_id, kind, body, t_recv, seq=None, parked=False):
        if not self.store:
            return
        try:
            mid = body.get("match_id") if isinstance(body, dict) else None
            self.store.log(node_id, kind, seq, body.get("t") if isinstance(body, dict) else None, t_recv, mid, parked, body)
        except Exception:   # a store error must never lose a fact the node has already pruned
            import logging; logging.getLogger("brx.mc").exception("store.log failed (fact still scored in memory)")

    def _gun_index(self):
        self.guns: dict[str, dict] = {}
        try:
            for r in self.armory.list():
                self.guns[r["gun_id"]] = r
        except Exception:
            self.guns = {}

    def _attach_net(self):
        n = self.net
        n.hydrate(self._hydrate)
        if hasattr(n, "resolve_gun"):
            n.resolve_gun(lambda name, tail: (self._find_player_for_gun(name or None, tail or None) or {}).get("player_id"))
        n.on_node(self._on_node)
        n.on_status(self._on_status)
        n.on_event(self._on_event)
        if hasattr(n, "on_batch"):
            n.on_batch(self.ingest_batch)      # real NetServer routes batches here (A5.7)
        n.on_node_message(self._on_node_message)
        n.on_stale(lambda nid, age: self._touch(nid, stale=True))
        n.on_return(lambda nid: self._touch(nid, stale=False))
        try:
            ji = n.join_info()
            self.lan.update({"ws_url": ji.get("url", ""), "qr": ji.get("qr", ji.get("url", ""))})
        except Exception:
            pass

    # ---------- A10 loadout policy / catalog ----------
    def _catalog_rows(self) -> tuple[list[dict], list[dict]]:
        """(visible weapons, visible perks) — the rows the policy engine filters by tag."""
        try:
            weapons = [w for w in self.compiler.weapon_catalog() if isinstance(w, dict)]
        except Exception:
            weapons = []
        pc = getattr(self.compiler, "perk_catalog", None)
        try:
            perks = [r for r in pc()] if callable(pc) else []
        except Exception:
            perks = []
        return weapons, perks

    def policy(self) -> dict:
        pol = self.config.get("loadout_policy")
        if not pol:
            pol = self.config["loadout_policy"] = _policy.default_policy(self.config["mode"])
        return pol

    def loadout_pool(self) -> dict:
        weapons, perks = self._catalog_rows()
        return _policy.pool(self.policy(), weapons, perks)

    def health_pool(self, p: Player | None = None) -> int:
        """hp + armour a full-health player carries — what hits-to-kill is quoted against.

        Per-player `loadout.overrides` win over the game's `health`, exactly as `_gset` and
        `Compiler.validate()` read them, so the phone's stat block is the truth for THAT player.
        Field 2026-08-30 shipped a hardcoded 115 in `views.py`, so KIT and ARSENAL both claimed the
        AR takes 13 hits however the host had set health (docs/weapon-design.md §2.5).

        ⚠ This must mirror `Compiler._to_gc()`'s armour arithmetic EXACTLY — including the
        `body_armor` perk's `max_armor_add` and the 255 policy ceiling — because that is what
        actually goes out on `$PSET`. Review 2026-09-01 caught it missing the perk: a player holding
        `body_armor` is armed at a 165 pool while KIT quoted the AR at 13 hits / 1.68 s when the
        truth is 19 / 2.52 s. A stat block that is wrong for the one perk that moves the pool is
        worse than one that never claimed to be per-player."""
        h = self.config.get("health") or {}
        ov = ((p or {}).get("loadout") or {}).get("overrides") or {}

        def n(key: str, default: int) -> int:
            v = ov.get(key, h.get(key, default))
            try:
                return int(v)
            except (TypeError, ValueError):
                return default

        add = 0
        if p is not None:
            try:
                add = int(self.compiler._perk_effects(p).get("max_armor_add") or 0)
            except Exception:      # a fake/older compiler has no perk model; the base pool still holds
                add = 0
        return max(1, n("max_hp", 45) + min(255, n("max_armor", 70) + add))

    def _catalog_views(self, p: Player | None = None) -> dict:
        """`assign.catalog` — what the phone browses (visible weapons as WeaponView + visible perks)."""
        from .views import weapon_views                  # one view builder for HTTP and the wire
        weapons, perks = self._catalog_rows()
        # `bars` need the whole arsenal; htk/ttk need this game's health pool
        return {"weapons": weapon_views(weapons, self.health_pool(p)), "perks": perks}

    def kit_open(self) -> bool:
        """A10 §4.1: phones may browse/pick/try only while the host is on KIT and the lobby is not pushed. Before
        that the HUD shows "Mission Control is setting up the game" (Tony, 2026-08-27)."""
        return self.phase == "kit" and not self.lobby_pushed

    def _assign_body(self, p: Player) -> dict:
        pol = _policy.node_view(self.policy(), self.loadout_pool())
        pol["kit_open"] = self.kit_open()
        return {"player": p, "team": self.team(p["team_id"]), "roster": self.roster(),
                "catalog": self._catalog_views(p), "policy": pol, "game": self.game_brief()}

    def game_brief(self) -> dict:
        """A10 §4.6: what the phone's BRIEFING screen shows — the chosen game in human terms. Saved-game name/desc
        when the live config matches one, else the stock mode; rules as short lines; the loadout rules as one line."""
        cfg = self.config
        mode = next((m for m in MODES if m["mode"] == cfg.get("mode")), None) or {}
        pol = self.policy()
        lp = self.loadout_pool()
        weapons, perks = self._catalog_rows()
        wname = lambda wid: next((w["name"] for w in weapons if w["weapon_id"] == wid), None) or next((k["name"] for k in perks if k.get("perk_id") == wid), wid)
        prim, sec = pol["primary"], pol["secondary"]
        parts = []
        if prim["choice"] == "fixed":
            parts.append(f"Everyone carries the {wname(prim.get('fixed_id'))}")
        else:
            n = len(lp["primary"])
            parts.append(("You pick your primary" if prim["choice"] == "player" and pol.get("hud_select") else "The host picks your primary") + (f" ({n} to choose from)" if prim["choice"] == "player" and pol.get("hud_select") else ""))
        if sec["choice"] == "off":
            parts.append("no secondary")
        elif sec["choice"] == "fixed":
            parts.append(f"everyone gets {wname(sec.get('fixed_id'))} in slot 2")
        else:
            kinds = [k for k in ("weapon", "sidearm") if k in sec.get("kinds", [])]
            if "weapon" in kinds:
                kinds = [k for k in kinds if k != "sidearm"]        # A12: "weapon" already includes the pistols
            what = " or ".join({"weapon": "a second weapon", "sidearm": "a sidearm"}[k] for k in kinds) or "nothing"
            parts.append(("slot 2: " + what) if pol.get("hud_select") and sec["choice"] == "player" else f"the host sets slot 2 ({what})")
        kr = pol.get("perk") or {"choice": "off"}                  # A14: the perk is its own slot
        if kr["choice"] == "off":
            parts.append("no perks")
        elif kr["choice"] == "fixed":
            parts.append(f"everyone gets {wname(kr.get('fixed_id'))}")
        else:
            n = len(lp["perks"])
            parts.append((f"a perk of your choice ({n})" if pol.get("hud_select") and kr["choice"] == "player" else "the host sets your perk"))
        preset_lbl = _policy.PRESET_LABELS.get(pol.get("preset"), "")
        saved = None
        try:
            if getattr(self, "presets", None) is not None:
                sig = {k: v for k, v in cfg.items() if k != "config_id"}
                saved = next((r for r in self.presets.list() if {k: v for k, v in r["config"].items() if k != "config_id"} == sig), None)
        except Exception:
            saved = None
        return {
            "name": (saved or {}).get("name") or mode.get("name") or str(cfg.get("mode", "")).upper(),
            "desc": (saved or {}).get("desc") or mode.get("brief") or mode.get("desc") or "",
            "mode": cfg.get("mode"), "mode_name": mode.get("name"), "abbr": mode.get("abbr"),
            "teams_text": mode.get("teams_text"), "win_text": mode.get("win_text"), "respawn_text": mode.get("respawn_text"),
            "time_limit_s": cfg.get("time_limit_s"), "respawn": cfg.get("respawn"), "health": cfg.get("health"),
            "environment": cfg.get("environment"), "night": bool(cfg.get("night")),
            "loadout_line": ", ".join(parts) + ".", "ruleset": preset_lbl, "hud_select": bool(pol.get("hud_select")),
        }

    def _sync_kit_open(self) -> None:
        """Re-send `assign` to every bound node when kit_open flips (phase/push transitions) so the HUD switches
        between "setting up" and the kit editor without waiting for an unrelated change."""
        cur = self.kit_open()
        if cur == getattr(self, "_kit_open_sent", None):
            return
        self._kit_open_sent = cur
        for pl in self.players.values():
            if pl.get("node_id"):
                self.net.push(pl["node_id"], "assign", self._assign_body(pl))

    def apply_policy(self) -> list[str]:
        """§3.3: force every loadout to obey the policy (fixed → set, off → cleared, out-of-pool → replaced).
        Returns the ids of the players whose loadout changed; each gets a fresh `assign` (and a re-push
        if the lobby was already pushed) exactly like a PATCH."""
        weapons, perks = self._catalog_rows()
        lp = self.loadout_pool()
        changed: list[str] = []
        for pl in self.players.values():
            new = _policy.apply(self.policy(), lp, pl.get("loadout") or {"weapons": []}, weapons, perks)
            if new != pl.get("loadout"):
                pl["loadout"] = new
                changed.append(pl["player_id"])
        for pid in changed:
            pl = self.players[pid]
            if pid in self.trying:                       # an in-flight try-out of a weapon the ruleset just took away
                self.tryout(pid, None)                   # → tutorial {end} teardown on the node
            if pl.get("node_id"):
                self.net.push(pl["node_id"], "assign", self._assign_body(pl))
                if self.lobby_pushed:
                    self._push_config_to(pl)
        if changed:
            label = _policy.PRESET_LABELS.get(self.policy().get("preset"), "THE LOADOUT RULES")
            try:
                if self.active_preset_id and getattr(self, "presets", None) is not None:
                    label = self.presets.get(self.active_preset_id)["name"].upper()
            except Exception:
                pass
            self._policy_notice = f"{len(changed)} LOADOUT{'S' if len(changed) != 1 else ''} RESET BY {label}"
        return changed

    def _prune_browsing(self) -> None:
        now = self.now_ms()
        for pid, t in list(self.browsing.items()):
            if now - t > 60_000 or pid not in self.players:
                self.browsing.pop(pid, None)

    def _all_ready(self) -> bool:
        return bool(self.players) and all(p.get("ready") for p in self.players.values())

    def _on_ready(self, pid: str, ready: bool) -> None:
        """Shared ready semantics (§4.4): ready ENDS that player's try-out (the gun must not stay armed with
        identity 0) and kit → lobby advances only when EVERY rostered player is ready."""
        p = self.players[pid]
        p["ready"] = ready
        if ready:
            self.browsing.pop(pid, None)
            if pid in self.trying:
                self.tryout(pid, None)
        if self.phase == "kit" and ready and self._all_ready():
            self.phase = "lobby"

    # ---------- roster ----------
    def _next_num(self) -> int:
        used = {p["player_num"] for p in self.players.values()}
        base = int(self.config.get("player_num_base") or 1)     # A6.5: disjoint ranges for concurrent games
        for n in range(max(1, min(base, MAX_PLAYERS)), MAX_PLAYERS + 1):
            if n not in used:
                return n
        raise ValueError("roster full")

    ROSTER_PHASES = ("muster", "build", "kit", "lobby")

    def _check_team(self, team_id):
        """A team_id must name one of config.teams (or be None); never park a player in an unknown team."""
        if team_id is None:
            return None
        if not any(t["team_id"] == team_id for t in self.teams):
            raise ValueError(f"unknown team_id {team_id!r}")
        return team_id

    def add_player(self, display: str, team_id: str | None = None, gun_id: str | None = None,
                   voice: str = "male", loadout: dict | None = None, voice_slots: dict | None = None) -> Player:
        if len(self.players) >= MAX_PLAYERS:
            raise ValueError("roster full")
        voice_slots = _voices.check_slots(voice_slots)      # A15: {role: id} $PSET picks; bad role / off-gun id -> ValueError
        if gun_id:
            for q in self.players.values():
                if (q.get("gun_id") or "").lower() == gun_id.lower():
                    raise ValueError(f"gun {gun_id} is already assigned to {q['display']}")
        pid = uuid.uuid4().hex[:8]
        team_id = self._check_team(team_id)
        if team_id is None and self.teams:
            counts = {t["team_id"]: 0 for t in self.teams}
            for p in self.players.values():
                if p["team_id"] in counts:
                    counts[p["team_id"]] += 1
            team_id = min(counts, key=lambda k: (counts[k], list(counts).index(k)))
        lo = self._check_loadout(loadout) if loadout else {"weapons": [{"weapon_id": "assault_rifle"}]}
        lo = _policy.apply(self.policy(), self.loadout_pool(), lo, *self._catalog_rows())   # §3.3: a new player obeys the ruleset
        p: Player = {"player_id": pid, "player_num": self._next_num(), "display": display.strip().upper() or f"OPERATOR {pid[:4]}",
                     "team_id": team_id, "node_id": None, "gun_id": gun_id,
                     "loadout": lo, "voice": voice, "ready": False}
        if voice_slots:
            p["voice_slots"] = voice_slots
        self.players[pid] = p
        if self.scorer:
            self.scorer.register_player(pid, p)      # A5.6 late joiner: scorable in the running match
        if gun_id:
            self._adopt_node_for_gun(p)
        self._after_player_change(p, new=True)
        return p

    def patch_player(self, pid: str, **fields) -> Player:
        p = self.players[pid]
        old_voice, old_display, old_slots = p.get("voice"), p.get("display"), dict(p.get("voice_slots") or {})
        if "player_num" in fields and fields["player_num"] is not None:
            if self.lobby_pushed:
                raise ValueError("player_num is fixed once config has been pushed")
            try:
                if isinstance(fields["player_num"], bool):
                    raise ValueError
                n = int(fields["player_num"])
                if isinstance(fields["player_num"], float) and fields["player_num"] != n:
                    raise ValueError
            except (TypeError, ValueError, OverflowError):
                raise ValueError("player_num must be an integer")
            fields["player_num"] = n
            if not 1 <= n <= MAX_PLAYERS:
                raise ValueError(f"player_num must be 1..{MAX_PLAYERS} (0 is reserved)")
            if any(q["player_num"] == n and q["player_id"] != pid for q in self.players.values()):
                raise ValueError("player_num already taken")
        if "team_id" in fields:
            fields["team_id"] = self._check_team(fields["team_id"])
        if "loadout" in fields and fields["loadout"] is not None:
            fields["loadout"] = self._check_loadout(fields["loadout"])
            weapons, perks = self._catalog_rows()
            ok, reason = _policy.validate_loadout(self.policy(), self.loadout_pool(), fields["loadout"], weapons, perks)
            if not ok:
                raise ValueError(reason)               # human copy — the UI shows it as-is (loadout.md §3.3)
        if "voice" in fields and fields["voice"] is not None:
            v = fields["voice"]
            if not isinstance(v, str) or v not in self._voice_ids():
                raise ValueError("unknown voice")
        if "voice_slots" in fields:
            fields["voice_slots"] = _voices.check_slots(fields["voice_slots"])   # A15; {} / null clears the picks
        if "ready" in fields and fields["ready"] is not None and not isinstance(fields["ready"], bool):
            raise ValueError("ready must be a boolean")
        if "display" in fields and fields["display"] is not None:
            d = str(fields["display"]).strip().upper()[:24]
            if not d:
                raise ValueError("display must not be empty")
            fields["display"] = d
        if fields.get("gun_id"):
            for q in self.players.values():
                if q["player_id"] != pid and (q.get("gun_id") or "").lower() == str(fields["gun_id"]).lower():
                    raise ValueError(f"gun {fields['gun_id']} is already assigned to {q['display']}")
        for k in ("display", "team_id", "voice", "loadout", "player_num", "gun_id", "ready"):
            if k in fields and fields[k] is not None or (k in fields and k in ("team_id", "gun_id")):
                p[k] = fields[k]
        if "voice_slots" in fields:
            if fields["voice_slots"]:
                p["voice_slots"] = fields["voice_slots"]
            else:
                p.pop("voice_slots", None)
        if "team_id" in fields and self.scorer and pid in self.scorer.stats:
            self.scorer.stats[pid].team_id = p["team_id"]   # team scores + friendly rule follow a mid-match re-team
        if "gun_id" in fields:
            self._adopt_node_for_gun(p)
        self._after_player_change(p)
        # A9.1 bench voice preview: if VOICE or the gamertag changed and the player has a bound node in a
        # pre-lobby phase, play a one-frame sample of the voice so the pick is audible on the tagger.
        if (p.get("voice") != old_voice or p.get("display") != old_display or dict(p.get("voice_slots") or {}) != old_slots) \
                and p.get("node_id") and self.phase in ("muster", "build", "kit"):
            self._push_voice_preview(p)
        return p

    def _push_voice_preview(self, p: Player) -> None:
        """A9.1: best-effort `apply{preview}` of the voice family's kill line so a VOICE/gamertag change is
        audible on the bound tagger. One $PLAY frame — the node's preview gate drops anything that isn't
        $PLAY/$SFLASH and ignores a preview once past LOBBY, so this is safe to fire optimistically."""
        nid = p.get("node_id")
        if not nid:
            return
        try:
            cue = self.compiler.cues(p.get("voice") or "male", p.get("voice_slots")).get("kill")
        except Exception:
            cue = None
        if cue:
            self.net.push(nid, "apply", {"preview": True, "frames": [cue]})

    def _voice_ids(self) -> set[str]:
        ids = {"male", "female"}
        opts = getattr(self.compiler, "voice_options", None)
        if callable(opts):
            try:
                ids |= {o.get("id") for o in opts() if isinstance(o, dict) and o.get("id")}
            except Exception:
                pass
        return ids

    def _check_loadout(self, lo) -> dict:
        """Loadout must be {weapons: [{weapon_id}] | [{primary}, {secondary}], perk?: perk_id, overrides?: {max_hp?, max_armor?}};
        ids from the catalog when known. A14: `perk` is its own slot beside the weapons (loadout.md §2); the one
        pairing the hardware forbids (an ALT-button perk + a second weapon) is a POLICY reject, not a shape error."""
        if not isinstance(lo, dict) or not isinstance(lo.get("weapons"), list) or not lo["weapons"]:
            raise ValueError("loadout must be {weapons: [{weapon_id}, ...]}")
        if len(lo["weapons"]) > 2:
            raise ValueError("loadout.weapons holds at most a primary and a secondary")
        known: set[str] = set()
        cat = getattr(self.compiler, "weapon_catalog", None)
        if callable(cat):
            try:
                known = {w.get("weapon_id") for w in cat() if isinstance(w, dict)}
            except Exception:
                known = set()
        weapons = []
        for w in lo["weapons"]:
            if not isinstance(w, dict) or not isinstance(w.get("weapon_id"), str) or not w["weapon_id"]:
                raise ValueError("each loadout weapon needs a weapon_id")
            if known and w["weapon_id"] not in known:
                raise ValueError(f"unknown weapon_id {w['weapon_id']!r}")
            weapons.append({"weapon_id": w["weapon_id"]})
        out: dict = {"weapons": weapons}
        perk = lo.get("perk")
        if perk is not None and perk != "":
            if not isinstance(perk, str):
                raise ValueError("loadout.perk must be a perk_id string or null")
            _, perks = self._catalog_rows()
            if perks and perk not in {r.get("perk_id") for r in perks}:
                raise ValueError(f"unknown perk_id {perk!r}")
            out["perk"] = perk                        # A14: a perk is its own slot — it rides beside a secondary weapon
        ov = lo.get("overrides")
        if ov is not None:
            if not isinstance(ov, dict):
                raise ValueError("loadout.overrides must be an object")
            clean = {}
            for k in ("max_hp", "max_armor"):
                if k in ov and ov[k] is not None:
                    if isinstance(ov[k], bool) or not isinstance(ov[k], int) or not 1 <= ov[k] <= 999:
                        raise ValueError(f"overrides.{k} must be an integer 1..999")
                    clean[k] = ov[k]
            if clean:
                out["overrides"] = clean
        return out

    def remove_player(self, pid: str) -> None:
        if self.phase not in self.ROSTER_PHASES:
            raise ValueError("cannot remove a player after the match has started")
        p = self.players.pop(pid)
        if p.get("node_id"):
            self.node_player.pop(p["node_id"], None)
        self.acks.pop(pid, None); self.bundles.pop(pid, None); self.trying.pop(pid, None); self.browsing.pop(pid, None)
        self._changed()

    def _after_player_change(self, p: Player, new: bool = False):
        if p.get("node_id"):
            self.net.push(p["node_id"], "assign", self._assign_body(p))
            if self.lobby_pushed:
                self._push_config_to(p)
                if self.start_info:
                    self.net.push(p["node_id"], "start", self._start_body())
        self._validate()
        if self.phase in ("muster", "build") and new:
            self.phase = "kit"
        self._changed()

    def team(self, team_id: str | None) -> Team | None:
        return next((t for t in self.teams if t["team_id"] == team_id), None)

    def roster(self) -> list[dict]:
        return [{"player_id": p["player_id"], "player_num": p["player_num"], "display": p["display"], "team_id": p["team_id"]}
                for p in self.players.values()]

    def set_ready(self, pid: str, ready: bool, host_override: bool = False) -> Player:
        p = self.players[pid]
        nid = p.get("node_id")
        if ready and not host_override:
            nv = self.nodes.get(nid or "", {})
            if not nv.get("synced"):
                raise ValueError("node clock not synced — cannot ready")
        self._on_ready(pid, ready)                     # A10 §4.4: ends the try-out; all-ready advances
        self._changed()
        return p

    # ---------- config ----------
    def modes(self) -> list[dict]:
        return [{**m, "defaults": default_config(m["mode"])} for m in MODES]

    _CONFIG_KEYS = {"mode", "environment", "night", "time_limit_s", "respawn", "scoring",
                    "health", "teams", "led", "player_num_base", "loadout_policy", "presentation"}

    def apply_preset(self, preset_id: str, config: dict) -> dict:
        """A10 §8: apply a saved game — same path as PUT /api/config, but the state remembers WHICH game is playing."""
        self.active_preset_id = preset_id
        try:
            return self.set_config(config, _from_preset=True)
        except Exception:
            self.active_preset_id = None
            raise

    def set_config(self, patch: dict, _from_preset: bool = False) -> dict:
        if not isinstance(patch, dict):
            raise ValueError("config must be an object")
        if not _from_preset and (set(patch) - {"environment", "night", "config_id"}):
            self.active_preset_id = None                     # any real edit means the draft is no longer that saved game
        if self.phase == "recap" and not (isinstance(patch, dict) and patch.get("mode")):
            # only an explicit MODE pick on Build (same mode = "run it back", or a new one) rolls the
            # finished session forward; other config edits from stale tabs get a clear error instead
            raise ValueError("match is over — pick a mode on Build (or press NEW MATCH) to roll the session; other config edits need a fresh session")
        if self.phase == "recap":
            # the match is OVER — a config change is the operator starting the next one (Tony,
            # 2026-08-26: "i get an error bc match in progress, but MC knows its over"). Roll the
            # session forward (roster kept, recap archived) instead of erroring.
            self.new_session(keep_roster=True)
        if self.phase not in ("muster", "build", "kit", "lobby"):
            raise ValueError("cannot change config after the match has started")
        mode = patch.get("mode", self.config["mode"])
        if not isinstance(mode, str) or mode not in {m["mode"] for m in MODES}:
            raise ValueError(f"unknown mode {mode!r}")
        if set(patch) - {"environment", "night", "config_id"}:     # a VENUE-only PUT (GAMES re-asserts it right after
            self._policy_notice = None                       # a saved game applies) must not eat the reset notice

        cfg = default_config(mode) if mode != self.config["mode"] else copy.deepcopy(self.config)
        cfg = self._merge_config(cfg, patch, mode)
        cfg["config_id"] = uuid.uuid4().hex[:8]
        self.config = cfg
        self.teams = list(cfg["teams"])
        for p in self.players.values():
            if p["team_id"] not in {t["team_id"] for t in self.teams}:
                p["team_id"] = self.teams[0]["team_id"] if self.teams else None
        if self.phase == "muster":
            self.phase = "build"
        if self.lobby_pushed:
            self.lobby_pushed = False
            self.acks = {}
        self.apply_policy()                                  # §3.3: every loadout obeys the (new) ruleset
        res = self._validate()
        self._changed()
        return {"ok": res["ok"], "errors": res["errors"], "config": self.config}

    def sanitize_config(self, raw: dict) -> GameConfig:
        """A10 §8: the PUT /api/config validator as a pure function — a stored preset config is rebuilt from the
        mode's defaults + every known key of `raw` (unknown keys dropped, bad values raise ValueError). No session
        state is touched. `config_id` is stripped (assigned fresh on apply)."""
        if not isinstance(raw, dict):
            raise ValueError("config must be an object")
        mode = raw.get("mode", "tdm")
        if not isinstance(mode, str) or mode not in {m["mode"] for m in MODES}:
            raise ValueError(f"unknown mode {mode!r}")
        cfg = self._merge_config(default_config(mode), raw, mode)
        cfg.pop("config_id", None)
        return cfg

    def _merge_config(self, cfg: dict, patch: dict, mode: str) -> dict:
        """Whitelist + range-check every key of `patch` onto `cfg` (A8.3). Pure; raises ValueError."""
        for k, v in patch.items():
            if k not in self._CONFIG_KEYS:
                continue                         # ignore unknown / client-injected keys
            if k == "time_limit_s":
                if v is not None and not (isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= 7200):
                    raise ValueError("time_limit_s must be an integer 1..7200 or null")
                cfg[k] = v
            elif k == "environment":
                if v not in ("indoor", "outdoor"):
                    raise ValueError("environment must be indoor|outdoor")
                cfg[k] = v
            elif k == "night":
                cfg[k] = bool(v)
            elif k in ("respawn", "scoring", "health"):
                if not isinstance(v, dict):
                    raise ValueError(f"{k} must be an object")
                merged = {**cfg[k], **v}
                if k == "respawn":
                    if merged.get("type") not in ("auto", "scanner", "none"):
                        raise ValueError("respawn.type must be auto|scanner|none")
                    d = merged.get("delay_s", 0)
                    if not (isinstance(d, int) and not isinstance(d, bool) and 0 <= d <= 600):
                        raise ValueError("respawn.delay_s must be 0..600")
                if k == "scoring":
                    fl = merged.get("frag_limit")
                    if fl is not None and not (isinstance(fl, int) and not isinstance(fl, bool) and fl > 0):
                        raise ValueError("scoring.frag_limit must be a positive integer or null")
                if k == "health":
                    for hk in ("max_hp", "max_armor"):
                        hv = merged.get(hk, 0)
                        lo = 1 if hk == "max_hp" else 0
                        if not (isinstance(hv, int) and not isinstance(hv, bool) and lo <= hv <= 255):
                            # 255 is a POLICY ceiling, not a hardware one -- $PSET pools are
                            # wider than 8 bits (bench 2026-08-27, see FOLLOWUPS/experiment-log).
                            raise ValueError(f"health.{hk} must be {lo}..255")
                cfg[k] = merged
            elif k == "teams":
                if not (isinstance(v, list) and all(isinstance(t, dict) and "team_id" in t
                                                   and isinstance(t.get("tid"), int) and not isinstance(t.get("tid"), bool) for t in v)):
                    raise ValueError("teams must be a list of team objects with team_id + integer tid")
                cfg[k] = v
            elif k == "led":
                if v is not None and not isinstance(v, dict):
                    raise ValueError("led must be an object")
                cfg[k] = v
            elif k == "player_num_base":
                if not (isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= MAX_PLAYERS):
                    raise ValueError("player_num_base must be 1..63")
                cfg[k] = v
            elif k == "loadout_policy":
                # A10 §3: a preset name rewrites the rules; a rule edit that matches no preset → custom
                cfg[k] = _policy.merge(cfg.get("loadout_policy") or _policy.default_policy(mode), v)
            elif k == "presentation":
                # A11: a preset name replaces the profile; a field edit marks it custom; bad ids/colours raise
                cfg[k] = _pres.merge(cfg.get("presentation") or _pres.default_for(mode), v)
            elif k == "config_id":
                continue                                     # never client-set; minted by set_config
            else:
                cfg[k] = v
        return cfg

    def _validate(self) -> dict:
        try:
            res = self.compiler.validate(self.config, list(self.players.values()), None)
        except Exception as e:  # a broken compiler must not take MC down
            res = {"ok": False, "errors": [f"validate failed: {e}"]}
        self.config_errors = list(res.get("errors", []))
        self.config_warnings = list(res.get("warnings", []))
        if self._policy_notice:
            self.config_warnings.append(self._policy_notice)     # A10: the host sees the overwrite
        return res

    # ---------- nodes ----------
    def _touch(self, nid: str, stale: bool | None = None):
        nv = self.nodes.setdefault(nid, {"node_id": nid, "node_type": "phone", "arm_state": "idle", "last_seen_ms": 0, "synced": False})
        if stale is not None:
            nv["stale"] = stale
        self._changed()

    def _find_player_for_gun(self, gun_name: str | None, gun_tail: str | None) -> Player | None:
        if not gun_name and not gun_tail:
            return None
        base = (gun_name or "").rsplit("-", 1)[0].lower()
        tail = (gun_tail or (gun_name or "").rsplit("-", 1)[-1]).lower()
        full = (gun_name or "").lower()
        for p in self.players.values():
            gid = (p.get("gun_id") or "").lower()
            if not gid:
                continue                      # a gun-less roster entry never matches (an empty name would equal "")
            g = self.guns.get(p.get("gun_id") or "")
            _sticker = g["sticker"].lower() if g else ""
            if g and (((base and _sticker == base) and not _sticker.startswith("tactix")) or (tail and g["ble"].get("tail", "").lower() == tail)):
                return p
            if gid in {x for x in (base, full) if x}:
                return p
        for p in self.players.values():
            gid = (p.get("gun_id") or "").lower()
            if gid and tail and gid == tail:  # device-first claim: gun_id may be just the tail —
                return p                      # SECOND pass: an exact registry match always wins first
        return None

    def _adopt_node_for_gun(self, p: Player):
        """Roster changed after nodes said hello: bind any connected node whose reported gun resolves to THIS
        player — same matcher as the hello path (sticker base, armory tail, or full gun id). Bench 2026-08-25: a
        phone holding `Tactix-XXXX` was left unbound when a gun (matched by its armory tail) was added afterwards."""
        for nid, nv in list(self.nodes.items()):
            name, tail = nv.get("gun_name") or "", nv.get("gun_tail") or ""
            if not (name or tail):
                continue
            q = self._find_player_for_gun(name or None, tail or None)
            if q is not None and q["player_id"] == p["player_id"]:
                self._bind(nid, p)

    def _bind(self, nid: str, p: Player):
        old = self.node_player.get(nid)
        if old and old != p["player_id"] and old in self.players:
            self.players[old]["node_id"] = None
        for q in self.players.values():
            if q.get("node_id") == nid and q["player_id"] != p["player_id"]:
                q["node_id"] = None
        prev = p.get("node_id")
        if prev and prev != nid:
            if self.scorer:
                self.scorer.rebind_node(p["player_id"])      # A6.2 hot-swap shots baseline
            if self.node_player.get(prev) == p["player_id"]:
                self.node_player.pop(prev, None)             # the old node no longer speaks for this player
            if prev in self.nodes:
                self.nodes[prev].pop("player_id", None)
        self.node_player[nid] = p["player_id"]
        p["node_id"] = nid
        self.nodes.setdefault(nid, {"node_id": nid})["player_id"] = p["player_id"]
        if self.phase in ("kit", "lobby", "armed") and self.nodes.get(nid, {}).get("synced"):
            self.synced_at_lobby[nid] = True   # same pre-live gate as _on_status (A5.7)
        # A5.6 late joiner: a node binding a player after the lobby push gets its bundle (+ the running start) now.
        if self.lobby_pushed and p["player_id"] not in self.bundles:
            self._push_config_to(p)
            if self.start_info:
                self.net.push(nid, "start", self._start_body())

    def evict_node(self, nid: str) -> bool:
        """Operator recovery: kick a node (e.g. a stranger that hello'd with a live gun name before its owner's phone).
        Closes its socket, unbinds its player and forgets everything it claimed (ready/ack) so the next legit hello
        re-hydrates by gun (A5.5). Returns False for an id nobody has heard of."""
        known = nid in self.nodes or nid in self.node_player or nid in getattr(self.net, "nodes", {})
        if hasattr(self.net, "evict"):
            self.net.evict(nid)
        pid = self.node_player.pop(nid, None)
        for p in self.players.values():
            if p.get("node_id") == nid or p["player_id"] == pid:
                p["node_id"] = None
                p["ready"] = False
                self.acks.pop(p["player_id"], None)
        self.nodes.pop(nid, None)
        self.synced_at_lobby.pop(nid, None)
        self._changed()
        return known

    def _prune_unbound_nodes(self):
        """Drop hello-only node records that never bound a player (net.md §8 memory). Any unbound record
        silent for >10 min goes — the old count-gated rule let phantom phones pile up on the Armory board
        for hours (15 of them on the bench, 2026-08-26)."""
        now = self.now_ms()
        for nid in [n for n, _ in self.nodes.items() if n not in self.node_player]:
            if now - self.nodes[nid].get("last_seen_ms", 0) > 600_000:
                self.nodes.pop(nid, None)

    def _on_node(self, n: dict):
        nid = n["node_id"]
        nv = self.nodes.setdefault(nid, {"node_id": nid, "arm_state": "idle", "synced": False})
        nv.update({k: v for k, v in n.items() if k in ("node_type", "gun_name", "gun_tail", "fw")})
        nv["last_seen_ms"] = self.now_ms()
        # The gun the node reports NOW wins over a hydrate-era player_id (a re-bind to another gun moves the node).
        p = self._find_player_for_gun(n.get("gun_name"), n.get("gun_tail")) if (n.get("gun_name") or n.get("gun_tail")) else None
        if p is None and n.get("player_id") in self.players:
            p = self.players[n["player_id"]]
        if p:
            self._bind(nid, p)
        self._prune_unbound_nodes()
        self._changed()
        return self.node_player.get(nid)

    def _hydrate(self, hello: dict) -> dict | None:
        gun = hello.get("gun") or {}
        p = self._find_player_for_gun(gun.get("name"), gun.get("tail"))
        if not p:
            pid = self.node_player.get(hello.get("node_id", ""))
            p = self.players.get(pid) if pid else None
        if not p:
            return None
        self._bind(hello["node_id"], p)
        node = self._assign_body(p)                          # A10: welcome carries catalog + policy too
        if self.lobby_pushed:
            if p["player_id"] not in self.bundles:          # A5.6 late joiner hydrated on first hello
                self.bundles[p["player_id"]] = self._compile_rolled(p)
                self.acks.pop(p["player_id"], None)
            node["config"] = self.config
            node["frames"] = self.bundles[p["player_id"]]
        if self.start_info:
            node["start"] = self._start_body()
            node["match_id"] = self.start_info["match_id"]
        if self.scorer:
            row = next((r for r in self.scorer.rows() if r["player_id"] == p["player_id"]), None)
            if row:
                node["score"] = dict(row, board=self._score_board())   # same shape as the live push: the swapped phone's DOWN recap has the race
        return node

    def _on_status(self, nid: str, body: dict, t_recv: int):
        nv = self.nodes.setdefault(nid, {"node_id": nid, "node_type": "phone"})
        nv.update({k: body.get(k) for k in ("arm_state", "synced", "preflight", "battery", "fw", "hp", "armor", "ammo", "alive", "t_minus_ms", "shots", "dropped", "pending") if k in body})
        nv["last_seen_ms"] = t_recv
        nv["stale"] = False
        # A8: the server's binding is authoritative — a status body's player_id never rebinds a node.
        if self.phase in ("kit", "lobby", "armed") and body.get("synced"):
            self.synced_at_lobby[nid] = True   # any node synced before it goes live keeps its own t (A5.7)
        self._log(nid, "status", body, t_recv)
        if self.scorer:
            self.scorer.ingest_status(nid, body, t_recv)
        self._changed()

    def _on_event(self, nid: str, ev: dict, t_recv: int):
        seq = (ev.pop("_seq", None) if isinstance(ev, dict) else None) or (ev.get("seq") if isinstance(ev, dict) else None)
        self.nodes.setdefault(nid, {"node_id": nid})["last_seen_ms"] = t_recv
        parked = bool(self.scorer and ev.get("match_id") != self.scorer.match_id) or not self.scorer
        self._log(nid, ev.get("type", "event"), ev, t_recv, seq=seq, parked=parked)
        if self.scorer:
            self.scorer.ingest(nid, ev, t_recv, seq=seq)
            self._restore_recap()
            self._push_scores()
            self._changed()

    def ingest_batch(self, nid: str, events: list[dict], t_recv: int):
        self.nodes.setdefault(nid, {"node_id": nid})["last_seen_ms"] = t_recv
        for ev in events:
            self._log(nid, ev.get("type", "event"), ev, t_recv, seq=ev.get("seq"),
                      parked=not self.scorer or ev.get("match_id") != self.scorer.match_id)
        if self.scorer:
            self.scorer.ingest_batch(nid, events, t_recv)
            if any(ev.get("match_id") == self.scorer.match_id for ev in events):   # no SYNC POINT for an all-parked batch
                self.scorer.sync_point(t_recv, sum(1 for s in self.scorer.stats.values() if s.flushed), len(self.players))
            self._restore_recap()
            self._push_scores()
            self._changed()

    def _restore_recap(self) -> None:
        """Re-write the stored recap when a fact lands AFTER the match ended.

        `_finish()` wrote it once. Facts held in a node's store-and-forward outbox arrive later — that
        is the whole point of the outbox — and they updated the live scorer but never the stored row,
        so the archive drifted from reality. Measured on real sessions: one match stored 4 kills / 38
        hits against 126 `hit_taken` and 12 deaths on the wire; another matched exactly, because
        nothing arrived late. The RECAP history picker serves these rows, so an archived match was
        showing understated scores (review 2026-09-01).
        """
        if self.phase != "recap" or not (self.store and self.scorer):
            return
        try:
            self.last_recap = self.scorer.recap()
            self.store.match_ended(self.scorer.match_id, self.last_recap)
        except Exception:
            import logging
            logging.getLogger("brx.mc").exception("late-fact recap re-store failed (play continues)")

    def _push_scores(self):
        """A7: push each player's ScoreRow to its node when it changed (best-effort; only reaches nodes in coverage)."""
        if not self.scorer:
            return
        plist = self.players.values() if isinstance(self.players, dict) else self.players
        by_pid = {p["player_id"]: p for p in plist}
        for row in self.scorer.rows():
            pid = row["player_id"]; p = by_pid.get(pid)
            if not p or not p.get("node_id"):
                continue
            body = dict(row); body["shots_total"] = self.scorer.shots_total(pid)
            body["board"] = self._score_board()     # the race to the cap, for the HUD's DOWN-screen recap (review 2026-09-03 #25/#26)
            if self._score_pushed.get(pid) == body:
                continue
            self._score_pushed[pid] = body
            self.net.push(p["node_id"], "score", body)

    def _score_board(self) -> dict:
        """Team totals + the frag cap; in FFA the top three players stand in for teams."""
        cap = (self.config.get("scoring") or {}).get("frag_limit")
        if self.config.get("mode") == "ffa":
            top = sorted(self.scorer.rows(), key=lambda r: -r["kills"])[:3]
            return {"teams": [{"team_id": "ffa", "name": r["display"], "score": r["kills"]} for r in top], "cap": cap}
        totals = self.scorer.team_scores()
        names = {t["team_id"]: str(t.get("name") or t["team_id"]).replace(" TEAM", "") for t in self.teams}
        return {"teams": [{"team_id": tid, "name": names.get(tid, tid), "score": sc} for tid, sc in totals.items()], "cap": cap}

    def _on_node_message(self, nid: str, kind: str, body: dict, t_recv: int):
        self.nodes.setdefault(nid, {"node_id": nid})["last_seen_ms"] = t_recv
        pid = self.node_player.get(nid)   # authoritative binding, not a client-supplied player_id
        if kind == "ready" and pid in self.players:
            self._on_ready(pid, bool(body.get("ready")))     # A10 §4.4
        elif kind == "loadout_request" and pid in self.players:
            self._on_loadout_request(nid, pid, body)
        elif kind == "loadout_browse" and pid in self.players:
            if body.get("open"):
                self.browsing[pid] = t_recv
            else:
                self.browsing.pop(pid, None)
        elif kind == "ack_config" and pid in self.players:
            self.acks[pid] = {"ok": bool(body.get("ok")), "gun_echo": body.get("gun_echo"), "err": body.get("err")}
            if body.get("ok") and body.get("gun_echo"):
                self.nodes[nid]["headset"] = "proven"
        elif kind == "event_batch":
            self.ingest_batch(nid, body.get("events", []), t_recv)
            return
        elif kind == "log_offer":
            got = self._log_bytes.get(nid, 0)
            if got < 1_000_000:            # cap total pulled log per node at ~1 MB
                self.net.push(nid, "pull_log", {})
        elif kind == "log_data":
            self._log_bytes[nid] = self._log_bytes.get(nid, 0) + len(str(body.get("chunk", "")))
        self._log(nid, kind, body, t_recv)
        self._changed()

    # ---------- readiness ----------
    def readiness(self) -> ReadinessSnapshot:
        now = self.now_ms()
        board: list[ReadinessRow] = []
        claimed = set()
        for p in self.players.values():
            g = self.guns.get(p.get("gun_id") or "", {})
            nid = p.get("node_id")
            nv = self.nodes.get(nid, {}) if nid else {}
            pf = nv.get("preflight") or {}
            blockers, ambers = [], []
            row: ReadinessRow = {"gun_id": p.get("gun_id") or "", "sticker": g.get("sticker", p.get("gun_id") or "—"),
                                 "tail": g.get("ble", {}).get("tail", ""), "player_id": p["player_id"], "player_num": p["player_num"],
                                 "present": bool(nid), "node": "linked" if nid else "none"}
            if g:
                claimed.add(g.get("sticker", "").lower())
            scan = next((s for s in self.scan_rows if s.get("gun_id") == p.get("gun_id")), None)
            row["identity"] = scan["identity"] if scan else ("ok" if g else "unknown")
            if not nid:
                # NOT a fault: before a phone has ever connected this is the expected state.
                # It still blocks the start (a player with no phone cannot play), but it must not
                # read as a broken gun — Tony, 2026-09-01: "it makes it look like the guns are
                # broken. They are simply disconnected."
                blockers.append("WAITING FOR THE PHONE — OPEN THE APP AND SET THE GUN")
            elif nv.get("last_seen_ms") and (now - nv["last_seen_ms"]) > OFFLINE_AFTER_MS:
                # Gone, not faulty. Say it once instead of listing the four symptoms of it.
                # Guarded on the key EXISTING: a node that has never reported has no last_seen at all,
                # and treating the epoch as its timestamp read "OFFLINE — LAST SEEN 20698d16h".
                blockers.append(f"OFFLINE — LAST SEEN {self._human_age(now - nv['last_seen_ms'])}")
            else:
                age = now - nv.get("last_seen_ms", 0)
                if age > STALE_AFTER_MS:
                    ambers.append(f"STALE LINK ({self._human_age(age)}) — DOES NOT BLOCK")
                if not nv.get("synced"):
                    blockers.append("CLOCK NOT SYNCED — BLOCKS START")
                if pf.get("ssid_ok") is False or pf.get("mc_reachable") is False:
                    blockers.append("WRONG WI-FI / MC UNREACHABLE — BLOCKS START")
                if pf.get("gun_linked") is False:
                    blockers.append("GUN LINK LOST — BLOCKS START")
                if nv.get("battery") is None:
                    ambers.append("BATTERY UNREAD — DOES NOT BLOCK")
                if pf.get("phone_batt") is not None and pf["phone_batt"] < 20:
                    ambers.append("PHONE BATTERY LOW — DOES NOT BLOCK")
                if pf.get("screen_on") is False or pf.get("foreground") is False:
                    ambers.append("SCREEN OFF / BACKGROUNDED — DOES NOT BLOCK YET")
                if not nv.get("fw"):
                    ambers.append("FIRMWARE UNREAD — DOES NOT BLOCK")
            if row["identity"] in ("reverted", "unknown") and g:
                blockers.append("IDENTITY REVERTED — RE-STAMP $NAME")
            ack = self.acks.get(p["player_id"])
            if self.lobby_pushed and ack is not None and (not ack.get("ok") or not ack.get("gun_echo")):
                blockers.append("GUN DID NOT ANSWER CONFIG — HEADSET OFF? BLOCKS START")
                row["headset"] = "absent"
            elif nv.get("headset") == "proven":
                row["headset"] = "proven"
            else:
                row["headset"] = "unknown"
                if nid and not self.lobby_pushed:
                    ambers.append("HEADSET UNPROVEN UNTIL CONFIG PUSH")
            row.update({"battery_pct": nv.get("battery"), "battery_age_ms": (now - nv.get("last_seen_ms", now)) if nid else None,
                        "last_seen_age_ms": (now - nv.get("last_seen_ms", now)) if nid else None,   # the UI showed "0s AGO" reading a field that didn't exist (2026-08-26)
                        "gun_linked": pf.get("gun_linked"),
                        "fw": nv.get("fw"), "phone_batt": pf.get("phone_batt"), "ssid_ok": pf.get("ssid_ok"),
                        "mc_reachable": pf.get("mc_reachable"), "synced": nv.get("synced"), "screen_on": pf.get("screen_on"),
                        "foreground": pf.get("foreground"),
                        # kept APART. Merging them meant the lobby printed "GUN LINK LOST - BLOCKS
                        # START, STALE LINK - DOES NOT BLOCK, SCREEN OFF - DOES NOT BLOCK YET" as one
                        # run-on blocker string, so a real fault read the same as a shrug.
                        "blockers": blockers, "ambers": ambers,
                        # `waiting` blocks exactly like `red` but is not a fault: nothing has gone
                        # wrong, the phone simply has not arrived yet. Only when the MISSING NODE is
                        # the sole complaint — a real problem alongside it still reads red.
                        # `waiting` covers BOTH "no phone yet" and "the phone went away": each blocks
                        # the start, neither is a fault, and both must read as inactive rather than red.
                        "status": ("waiting" if len(blockers) == 1 and (not nid or blockers[0].startswith("OFFLINE"))
                                   else "red") if blockers else ("amber" if ambers else "green")})
            board.append(row)
        unclaimed = [s for s in self.scan_rows if s.get("basename", "").lower() not in claimed]
        greens = sum(1 for r in board if r["status"] == "green")
        return {"t": now, "roster_size": len(board), "greens": greens, "board": board, "unclaimed": unclaimed,
                "go": all(r["status"] not in ("red", "waiting") for r in board) and bool(board)}

    async def scan(self, duration_s: int = 6) -> list[ScanRow]:
        self.scan_rows = await self.armory.scan(duration_s)
        self._gun_index()
        self._changed()
        return self.scan_rows

    # ---------- kit-out ----------
    def _on_loadout_request(self, nid: str, pid: str, body: dict) -> None:
        """A10 §4.2: validate against the policy → apply → re-assign → optional try-out → ALWAYS `loadout_ack`.
        A14: `slot` may be "perk"; a pick that knocks the other thing out (ALT-button perk vs second weapon)
        still applies, and the ack carries `dropped {slot, id, name}` + the reason line."""
        p = self.players[pid]
        slot, kind = str(body.get("slot") or ""), str(body.get("kind") or "")
        rid = body.get("id") if isinstance(body.get("id"), str) else None
        weapons, perks = self._catalog_rows()
        ok, reason = _policy.check_request(self.policy(), self.loadout_pool(), slot, kind, rid, weapons, perks)
        if ok and not self.lobby_pushed and self.phase != "kit":
            # before KIT the phones are on "setting up" (§4.6); after the push the existing path below still applies
            # the pick (re-push) and only reports the try-out as closed
            ok, reason = False, "Mission Control is still setting up the game"
        dropped = None
        if ok:
            before = p.get("loadout") or {"weapons": []}
            new = _policy.set_slot(before, slot, kind, rid, perks)
            try:
                new = self._check_loadout(new)
            except ValueError as e:
                ok, reason = False, str(e)
            else:
                dropped, why = _policy.dropped_by(before, new, weapons, perks)   # A14: Easy Reload vs a second weapon
                if dropped:
                    reason = why
        if ok:
            p["loadout"] = new
            self.browsing.pop(pid, None)
            self.net.push(nid, "assign", self._assign_body(p))
            if self.lobby_pushed:
                self._push_config_to(p)
            self._validate()
            if body.get("try") and kind == "weapon" and rid:
                try:
                    self.tryout(pid, rid)
                except (ValueError, KeyError) as e:
                    self.net.push(nid, "loadout_ack", {"slot": slot, "ok": True, "reason": str(e), "loadout": p["loadout"]})
                    self._changed()
                    return
        self.net.push(nid, "loadout_ack", {"slot": slot, "ok": bool(ok), **({"reason": reason} if reason else {}),
                                           **({"dropped": dropped} if dropped else {}), "loadout": p["loadout"]})
        self._changed()

    def tryout(self, pid: str, weapon_id: str | None) -> None:
        p = self.players[pid]
        if weapon_id is None:
            self.trying.pop(pid, None)
            # tell the NODE too — without this the phone stayed on the try-out screen and the gun stayed
            # armed until the next config push (e2e find, 2026-08-26). Teardown = the known end sequence.
            if p.get("node_id"):
                self.net.push(p["node_id"], "tutorial", {"end": True,
                                                          "frames": list(TRYOUT_TEARDOWN)})
            self._changed()
            return
        if self.lobby_pushed or self.phase in ("armed", "live"):
            raise ValueError("Try-outs are closed — the game has been pushed to the guns")   # A10 §4.4 (was: any node in LOBBY)
        w = next((w for w in self.compiler.weapon_catalog() if w["weapon_id"] == weapon_id), None)
        if not w:
            raise KeyError(weapon_id)
        frames = self.compiler.tutorial_frames(w, self.config["environment"])
        self.trying[pid] = weapon_id
        if p.get("node_id"):
            # A WeaponView, not the raw catalog row: the HUD's stat block draws from `bars`, which only
            # `weapon_views` produces (it needs the whole arsenal to rank against). Pushing the raw row
            # sent the try-out card back to the near-empty `stats.dmg` meter (review 2026-08-31).
            from .views import weapon_views
            wv = next((v for v in weapon_views(self._catalog_rows()[0], self.health_pool(p))
                       if v["weapon_id"] == w["weapon_id"]), None)
            self.net.push(p["node_id"], "tutorial", {"weapon": wv or w, "frames": frames})
        self._changed()

    # ---------- lobby ----------
    def _compile_rolled(self, p: Player):
        """Compile with this push's voice roll (A15.1) and say what was drawn."""
        bundle = self.compiler.compile(self.config, p, self.teams, roll=self._voice_rng)
        rolled = (bundle.get("voice") or {}).get("rolled") if isinstance(bundle, dict) else None
        if rolled:
            import logging
            logging.getLogger("brx.mc").debug("voice roll for %s: %s", p.get("display"), rolled)
        return bundle

    def _push_config_to(self, p: Player):
        bundle = self._compile_rolled(p)
        self.bundles[p["player_id"]] = bundle
        self.acks.pop(p["player_id"], None)
        if p.get("node_id"):
            self.net.push(p["node_id"], "config", {"config": self.config, "frames": bundle, "roster": self.roster()})

    def push_config(self, force: bool = False) -> dict:
        """Compile + push every player's bundle. `force` is the OPERATOR OVERRIDE.

        Field 2026-08-30: one phone dropped its BLE link, its row went red, and the push was refused
        with no way past it — the operator could see the whole field was otherwise ready and had no
        recourse. `start()` has had a `force` since A6; push did not, which is the inconsistency that
        stranded the session. A forced push still compiles and sends to every BOUND node; a player
        whose gun is not linked simply will not ack, which the lobby already shows.
        """
        rd = self.readiness()
        if not self.players:
            raise ValueError("no players — add someone to the roster first")   # force must not bypass this
        if not rd["go"] and not force:
            reds = [f"{r['player_num']}:{'/'.join(r['blockers'])}" for r in rd["board"] if r["status"] == "red"]
            raise ValueError("readiness has reds — clear them before pushing, or push with force: "
                             + "; ".join(reds))
        if not rd["go"]:
            import logging
            logging.getLogger("brx.mc").warning(
                "FORCED push over %d red row(s): %s", sum(1 for r in rd["board"] if r["status"] == "red"),
                        "; ".join(f"{r['player_num']}:{'/'.join(r['blockers'])}"
                                  for r in rd["board"] if r["status"] == "red"))
        res = self._validate()
        if not res["ok"]:
            raise ValueError("config invalid: " + "; ".join(res["errors"]))
        self.trying.clear()
        for p in self.players.values():
            self._push_config_to(p)
        self.lobby_pushed = True
        self.phase = "lobby"
        self._changed()
        return {"ok": True, "acks": self.acks}

    def all_acked(self) -> bool:
        return bool(self.players) and all(
            self.acks.get(p["player_id"], {}).get("ok") and self.acks.get(p["player_id"], {}).get("gun_echo")
            for p in self.players.values() if p.get("node_id"))

    # ---------- start ----------
    def _start_body(self) -> dict:
        s = self.start_info
        return {"match_id": s["match_id"], "go_live_t": s["go_live_t"], "config_id": self.config["config_id"],
                "seq": s["seq"], "countdown_s": s["countdown_s"]}

    def start(self, runway_s: int | None = None, force: bool = False) -> dict:
        if not self.lobby_pushed:
            raise ValueError("push config first")
        if not self.all_acked() and not force:
            raise ValueError("not every node has acked the config with a gun echo")
        return self._schedule(runway_s or DEFAULT_RUNWAY_S)

    def _schedule(self, runway_s: int) -> dict:
        self.start_seq += 1
        now = self.now_ms()
        self.start_info = {"match_id": uuid.uuid4().hex[:10], "go_live_t": now + runway_s * 1000,
                           "seq": self.start_seq, "countdown_s": runway_s}
        self.scorer = Scorer(self.start_info["match_id"], self.start_info["go_live_t"], self.config["time_limit_s"],
                             self.config["mode"], self.players, self.teams, self.node_player, self.synced_at_lobby,
                             on_feedback=lambda pid, body: self._feedback(pid, body), on_feed=self._on_feed, now_ms=self.now_ms,
                             on_alert=self._alert, frag_limit=(self.config.get("scoring") or {}).get("frag_limit"),
                             win_by=(self.config.get("scoring") or {}).get("win_by"))
        self.feed = []
        self.last_recap = None
        if self.store:
            try:
                # The config AND the compiled head we actually pushed. Tony, 2026-09-01: "as we debug,
                # you should be able to see every single setting for a game on MC. i had to tell you i
                # ran it again on outdoor." That round cost us a whole theory: I built a case on
                # `$GSET` outdoorMode without being able to see which venue had been used, or the
                # frame that carried it. The head is the ground truth — it shows the token, not a
                # setting that maps to it.
                snap = dict(self.config)
                snap["_heads"] = {pid: (b or {}).get("head", []) for pid, b in self.bundles.items()}
                self.store.match_started(self.start_info["match_id"], snap, self.start_info["go_live_t"])
            except Exception:
                pass
        self.net.broadcast("start", self._start_body())
        self.phase = "armed"
        self._changed()
        return dict(self.start_info)

    def reschedule(self, runway_s: int) -> dict:
        if self.phase not in ("armed",):
            raise ValueError("can only reschedule a pending start")
        return self._schedule(runway_s)

    def abort_start(self) -> dict:
        if self.phase != "armed" or not self.start_info:
            raise ValueError("no pending start")
        now = self.now_ms()
        reached = [pid for nid, pid in self.node_player.items() if now - self.nodes.get(nid, {}).get("last_seen_ms", 0) <= STALE_AFTER_MS]
        unreachable = [p["player_id"] for p in self.players.values() if p["player_id"] not in reached]
        self.net.broadcast("control", {"cmd": "abort_start", "seq": self.start_info["seq"]})
        self.start_info = None
        self.scorer = None
        self.phase = "lobby"
        self._changed()
        return {"ok": True, "reached": reached, "unreachable": unreachable}

    def mc_confidence(self) -> dict:
        """A11.5: is MC's picture of the match complete RIGHT NOW? True only when every rostered player's
        HUD has a live socket, was heard from in the last few seconds, and reports nothing left to flush.
        MC-driven global-state events (lead, next-kill-wins, last survivor) are sent only then -- with a
        HUD offline, MC's alive/score picture is exactly what is most likely stale (Tony, 2026-09-04)."""
        now = self.now_ms()
        missing, stale, unflushed = [], [], []
        for p in self.players.values():
            nid = p.get("node_id")
            nv = self.nodes.get(nid or "", {})
            # liveness: the real NetServer keeps a socket per node; a net without that table (fakes,
            # tests) is judged on recency alone.
            table = getattr(self.net, "nodes", None)
            if nid and isinstance(table, dict):
                rec = table.get(nid)
                live = bool(rec is not None and getattr(rec, "ws", None) is not None)
            else:
                live = bool(nid) and bool(nv)
            if not nid or not live:
                missing.append(p["player_id"])
            elif now - nv.get("last_seen_ms", 0) > 6_000:
                stale.append(p["player_id"])
            elif nv.get("pending") not in (0, None):
                unflushed.append(p["player_id"])
        ok = not (missing or stale or unflushed) and bool(self.players)
        return {"confident": ok, "missing": missing, "stale": stale, "unflushed": unflushed}

    def _alert(self, kind: str, scope: str, extra: dict | None = None) -> int:
        """A11.4: push a named game event to every node it concerns. `scope` = "all" | team_id | player_id.
        The node plays `cues[kind]` + `leds[kind]` from its OWN bundle (its presentation profile) and shows
        the text as a HUD alert; MC sends only the name. Returns how many nodes were reached.

        A11.5 gates: the profile's `mc_events` switch, and for GLOBAL-STATE kinds the confidence check --
        a "takes the lead" said on a stale picture is worse than silence."""
        prof = _pres.resolve(self.config)
        if not prof.get("mc_events", True):
            return 0
        if kind in _pres.GLOBAL_STATE_EVENTS and prof.get("mc_confidence", True):
            conf = self.mc_confidence()
            if not conf["confident"]:
                self._on_feed({"t_match_s": max(0, (self.now_ms() - (self.scorer.go_live_t if self.scorer else self.now_ms())) // 1000),
                               "text": f"{_pres.TEXT.get(kind, kind)} withheld: MC not confident "
                                       f"(offline {len(conf['missing'])}, stale {len(conf['stale'])}, unflushed {len(conf['unflushed'])})",
                               "tag": "WITHHELD", "kind": "alert"})
                return 0
        if scope == "all":
            targets = list(self.players.values())
        elif scope in {p.get("team_id") for p in self.players.values()}:
            targets = [p for p in self.players.values() if p.get("team_id") == scope]
        else:
            targets = [p for p in self.players.values() if p["player_id"] == scope]
        n = 0
        base = _pres.alert_body(kind, extra)
        for p in targets:
            if not p.get("node_id"):
                continue
            body = {**base, "player_id": p["player_id"], "t": self.now_ms()}
            if self.net.push(p["node_id"], "alert", body) is not False:   # fakes return None; the real net False = no socket
                n += 1
        self._on_feed({"t_match_s": max(0, (self.now_ms() - (self.scorer.go_live_t if self.scorer else self.now_ms())) // 1000),
                       "text": base["text"].title() + (f" ({scope})" if scope != "all" else ""), "tag": "ALERT", "kind": "alert"})
        return n

    def _feedback(self, pid: str, body: dict):
        p = self.players.get(pid)
        if p and p.get("node_id"):
            cues = (self.bundles.get(pid) or {}).get("cues") or {}
            if cues.get(body.get("kind")):
                body = {**body, "cue": cues[body["kind"]]}   # A6.3: a full $PLAY frame
            body.setdefault("player_id", pid)                # envelope requires it; a node silently DROPS a feedback without it
            self.net.push(p["node_id"], "feedback", body)

    def _on_feed(self, entry: dict):
        self.feed.insert(0, entry)
        del self.feed[200:]
        for cb in self._feed_listeners:
            cb(entry)

    def control(self, cmd: str, confirm: bool = False) -> dict:
        if cmd not in ("end", "recall", "panic"):
            raise ValueError("unknown control")
        if cmd == "panic" and not confirm:
            raise ValueError("panic requires confirm")
        # broadcast() returns how many nodes it actually reached and this discarded it, so END MATCH
        # EARLY reported success even when it landed on nobody (field 2026-09-01: "end game early on
        # MC did not go to each hud"). The operator needs the number — `abort` already shows one.
        reached = self.net.broadcast("control", {"cmd": cmd})
        if cmd == "end" and self.scorer:
            self.scorer.set_end(self.now_ms())           # A6.1 end freeze
            self._finish()
        else:                                            # recall/panic stop a live game → KITTED (A5.9)
            self.start_info = None
            self.scorer = None
            self.lobby_pushed = False
            self.acks = {}
            self.phase = "kit"
        self._changed()
        bound = sum(1 for p in self.players.values() if p.get("node_id"))
        return {"ok": True, "reached": reached, "nodes": bound}

    def _push_victory(self, recap: dict | None) -> None:
        """At recap, the WINNING team's (or FFA winner's) connected nodes get the `victory` cue; losers
        get nothing extra. In-coverage only — a dispersed node just played its neutral `game_over` on its
        own timer. A6-shaped: `_feedback` attaches the pre-composed `$PLAY,VSF,4,6,JAY` frame from the bundle."""
        w = (recap or {}).get("winner") or {}
        wt, wp = w.get("team_id"), w.get("player_id")
        if wt is None and wp is None:
            return
        for p in self.players.values():
            if not p.get("node_id"):
                continue
            won = (wt is not None and p.get("team_id") == wt) or (wp is not None and p["player_id"] == wp)
            if won:
                # feedback.player_id is required by the envelope contract (contracts §5)
                self._feedback(p["player_id"], {"kind": "victory", "player_id": p["player_id"], "t": self.now_ms()})

    def _finish(self):
        self.last_recap = self.scorer.recap() if self.scorer else None
        self._push_victory(self.last_recap)              # winners' guns play the victory sting (in coverage)
        if self.store and self.start_info and self.last_recap:
            try:
                self.store.match_ended(self.start_info["match_id"], self.last_recap)
            except Exception:
                pass
        self.start_info = None            # no re-hydrating a finished match's `start`
        self.phase = "recap"
        for _nid in list(self.nodes):        # harvest every phone's log at match end (debug gold, ~1MB cap each)
            try: self.net.push(_nid, "pull_log", {})
            except Exception: pass
        self.lobby_pushed = False
        self.acks = {}
        for p in self.players.values():
            p["ready"] = False
        self._changed()

    def tick(self) -> None:
        """Call periodically (≥1 Hz): armed→live at go_live_t; live→recap at the timed end (+5 s grace)."""
        if not self.start_info:
            return
        now = self.now_ms()
        if self.phase == "armed" and now >= self.start_info["go_live_t"]:
            self.phase = "live"
            self._changed()
        tl = self.config.get("time_limit_s")
        if self.phase == "live" and tl and now >= self.start_info["go_live_t"] + tl * 1000 + 5000:
            self._finish()

    def recap(self) -> dict | None:
        if self.scorer:
            self._mark_flushed_live()
            r = self.scorer.recap()
            if self.phase != "recap":
                r["provisional"] = True
            r.update(self.settling())     # advisory only — never gates, see settling()
            return r
        return self.last_recap

    @staticmethod
    def _human_age(ms: int) -> str:
        """`1093m32s` is not a duration anyone can read. Give it the right unit."""
        s = max(0, ms // 1000)
        if s < 60:
            return f"{s}s"
        if s < 3600:
            return f"{s // 60}m"
        if s < 86400:
            return f"{s // 3600}h{(s % 3600) // 60:02d}m"
        return f"{s // 86400}d{(s % 86400) // 3600:02d}h"

    def _mark_flushed_live(self) -> None:
        """A node that is CONNECTED, fresh, and reports pending == 0 has nothing left to flush — count its
        player as flushed even if it never sent a single fact (2026-08-26: a zero-event match stayed
        PROVISIONAL forever with the phone sitting right there)."""
        if not self.scorer:
            return
        now = self.now_ms()
        for pid, st in self.scorer.stats.items():
            if st.flushed:
                continue
            p = self.players.get(pid) or {}
            nv = self.nodes.get(p.get("node_id") or "", {})
            fresh = nv and (now - nv.get("last_seen_ms", 0)) < 30_000
            if fresh and nv.get("pending") == 0:
                st.flushed = True

    def settling(self) -> dict:
        """Which bound nodes have NOT been heard from since the whistle (A8, field 2026-08-30).

        Tony: *"it kinda was showing the final results as if it was final and then it finally popped up
        and the totals changed."* `provisional` could not have caught that — `Scorer.ingest` marks a
        player flushed on their FIRST event, so anyone who fired a shot is flushed from second one and
        `missing()` is empty well before the end. The totals moved because late facts were still
        arriving, which is a different question: *has every node reported since the match ended?*

        This is deliberately ADVISORY and additive — it gates nothing. An earlier attempt folded this
        condition into `_mark_flushed_live` instead, which left a phone that went quiet at the whistle
        permanently un-flushable and the recap permanently PROVISIONAL. Never gate on this.
        """
        if not self.scorer or self.scorer.end_t is None:
            return {"settling": False, "awaiting": [], "since_end_ms": None}
        end_t, now = self.scorer.end_t, self.now_ms()
        if now < end_t:
            return {"settling": False, "awaiting": [], "since_end_ms": None}
        awaiting = [p["player_id"] for p in self.players.values()
                    if p.get("node_id")
                    and self.nodes.get(p["node_id"], {}).get("last_seen_ms", 0) < end_t]
        return {"settling": bool(awaiting), "awaiting": awaiting, "since_end_ms": now - end_t}

    def new_session(self, keep_roster: bool = True) -> None:
        self.session_id = uuid.uuid4().hex[:8]
        self.phase = "muster"
        self.start_info = None
        self.scorer = None
        self.last_recap = None
        self.feed = []
        self.lobby_pushed = False
        self.acks = {}
        self.bundles = {}
        self.trying = {}
        self.browsing = {}
        self.synced_at_lobby = {}
        if keep_roster:
            for p in self.players.values():
                p["ready"] = False
            # tell every bound node the new session exists — without this the HUD sat on MATCH COMPLETE
            # forever after NEW MATCH (Tony, 2026-08-26): a fresh assign resets the node to KITTED.
            for p in self.players.values():
                if p.get("node_id"):
                    try:
                        self.net.push(p["node_id"], "assign", self._assign_body(p))
                    except Exception:
                        pass
        else:
            self.players = {}
            self.node_player = {}
            for nv in self.nodes.values():
                nv.pop("player_id", None)
        self._changed()
        if keep_roster:
            self.persist_now()                       # roster survives a crash right after NEW MATCH
        elif self._persist_path:
            self._persist_dirty = False              # nothing to flush — and remove the file LAST so
            try: self._persist_path.unlink(missing_ok=True)   # our own _changed can't resurrect it
            except Exception: pass

    # ---------- snapshot ----------
    def snapshot(self) -> dict:
        now = self.now_ms()
        kitted = sum(1 for p in self.players.values() if p.get("node_id"))
        self._prune_browsing()
        live = None
        if self.scorer and self.phase in ("armed", "live", "recap"):
            tl = self.config.get("time_limit_s")
            live = {"match_id": self.scorer.match_id, "go_live_t": self.scorer.go_live_t, "time_limit_s": tl,
                    "ends_t": (self.scorer.go_live_t + tl * 1000) if tl else None,
                    "score": self.scorer.team_scores(),
                    "rows": self.scorer.live_rows(now, {nid: nv.get("last_seen_ms", 0) for nid, nv in self.nodes.items()})}
        start = None
        if self.start_info:
            per = {}
            for nid, pid in self.node_player.items():
                nv = self.nodes.get(nid, {})
                per[pid] = {"arm_state": nv.get("arm_state", "idle"), "t_minus_ms": nv.get("t_minus_ms"),
                            "synced": nv.get("synced", False), "last_seen_ms": now - nv.get("last_seen_ms", 0)}
            start = {**self._start_body(), "per_node": per}
        return {"session_id": self.session_id, "phase": self.phase, "t": now, "lan": self.lan,
                "mc_confidence": self.mc_confidence(),          # A11.5: gates MC-driven global-state events
                "nodes": [{**nv, "last_seen_ms": now - nv.get("last_seen_ms", 0)} for nv in self.nodes.values()],
                "readiness": self.readiness(), "config": self.config, "config_errors": self.config_errors,
                "config_warnings": self.config_warnings,
                "players": list(self.players.values()), "teams": self.teams,
                "kit": {"kitted": kitted, "total": len(self.players), "trying": dict(self.trying), "browsing": dict(self.browsing)},
                "loadout_pool": self.loadout_pool(),
                "active_preset_id": self.active_preset_id,
                "lobby": {"ready": sum(1 for p in self.players.values() if p["ready"]), "total": len(self.players),
                          "pushed": self.lobby_pushed, "acks": self.acks, "all_acked": self.all_acked()},
                "start": start, "live": live, "recap": self.recap() if self.phase in ("live", "recap") else None,
                "feed": self.feed[:50]}
