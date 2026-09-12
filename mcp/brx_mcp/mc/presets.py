"""M-LOADOUT saved games (docs/spec/loadout.md §8) — a whole GameConfig under a name, on the MC host.

`PresetStore` owns `~/.brx-mcp/presets.json` (atomic write). Every stored config is re-validated through
the SAME path as `PUT /api/config` (`sanitize`) on load and on save, so an old/hand-edited file drops unknown
keys instead of crashing startup; a corrupt file is renamed aside and logged — never fatal. One builtin
example ("Silenced Sniper") always exists: not deletable, not editable, apply/copy only.
"""
from __future__ import annotations

import copy
import json
import logging
import pathlib
import time
import uuid
from typing import Any, Callable, Mapping

from ..storage import BASE_DIR
from .types import GameConfig

log = logging.getLogger("brx.mc.presets")

BUILTIN_SILENCED_SNIPER = "builtin:silenced_sniper"
_NAME_MAX = 40
_DESC_MAX = 240


class PresetError(ValueError):
    def __init__(self, status: int, msg: str):
        super().__init__(msg)
        self.status = status


def _builtin_configs(default_config, merge_policy) -> list[dict]:
    """The shipped examples. Built from the live defaults so a policy/mode change never leaves a stale copy."""
    cfg = default_config("ffa")
    cfg["health"] = {**cfg["health"], "max_armor": 0}             # one shot kills: 52 × 1.25 vs 45 HP
    cfg["loadout_policy"] = merge_policy(cfg["loadout_policy"], {
        "hud_select": False,
        "primary": {"choice": "fixed", "fixed_id": "sniper_rifle"},
        "secondary": {"choice": "off"},
        "perk": {"choice": "fixed", "fixed_id": "extended_mags"},      # A14: the perk is its own slot
    })
    cfg.pop("config_id", None)
    return [{
        "preset_id": BUILTIN_SILENCED_SNIPER, "name": "Silenced Sniper",
        "desc": "Free-for-all, sniper rifles only, no armor — one shot drops you. Everyone carries Extended Mags. "
                "The \"silenced\" fire sound is pending the weapon-tuning spec; today the rifle sounds stock.",
        "builtin": True, "created_t": 0, "updated_t": 0, "config": cfg,
    }]


class PresetStore:
    """CRUD over SavedGame rows. `sanitize(config) -> GameConfig` is the PUT /api/config validator (raises
    ValueError on junk); `path=None` keeps the store in memory (tests / throwaway hosts)."""

    def __init__(self, path: pathlib.Path | None, sanitize: Callable[[dict], GameConfig], default_config, merge_policy,
                 now_ms: Callable[[], int] | None = None):
        self.path = path
        self.sanitize = sanitize
        self.now_ms = now_ms or (lambda: int(time.time() * 1000))
        self._builtin = _builtin_configs(default_config, merge_policy)
        for b in self._builtin:
            b["config"] = self.sanitize(b["config"])
        self._rows: list[dict] = []
        self._load()

    # ---------- persistence ----------
    def _load(self) -> None:
        self._rows = []
        if not self.path or not self.path.exists():
            return
        try:
            raw = json.loads(self.path.read_text())
            rows = raw.get("presets") if isinstance(raw, dict) else raw
            if not isinstance(rows, list):
                raise ValueError("presets.json: expected a list")
        except Exception as e:
            aside = self.path.with_name(f"{self.path.name}.corrupt-{int(time.time())}")
            try:
                self.path.replace(aside)
            except Exception:
                pass
            log.error("presets.json unreadable (%s) — moved aside to %s; starting with the builtin only", e, aside)
            return
        seen = set()
        for r in rows:
            try:
                row = self._clean_row(r)
            except Exception as e:
                log.warning("presets.json: dropping preset %r (%s)", (r or {}).get("name") if isinstance(r, dict) else r, e)
                continue
            if row["name"].lower() in seen or self._is_builtin_name(row["name"]):
                log.warning("presets.json: dropping duplicate name %r", row["name"])
                continue
            seen.add(row["name"].lower())
            self._rows.append(row)

    def _clean_row(self, r) -> dict:
        if not isinstance(r, dict) or not isinstance(r.get("config"), dict):
            raise ValueError("not a preset object")
        name = self._check_name(r.get("name"))
        pid = r.get("preset_id") if isinstance(r.get("preset_id"), str) and r["preset_id"] and not r["preset_id"].startswith("builtin:") else uuid.uuid4().hex[:8]
        cfg = self.sanitize(r["config"])
        cfg.pop("config_id", None)
        return {"preset_id": pid, "name": name, "desc": self._check_desc(r.get("desc")), "builtin": False,
                "created_t": int(r.get("created_t") or self.now_ms()), "updated_t": int(r.get("updated_t") or self.now_ms()),
                "config": cfg}

    def _save(self) -> None:
        if not self.path:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"v": 1, "presets": self._rows}, indent=1))
        tmp.replace(self.path)                                # atomic on POSIX + NTFS

    # ---------- validation ----------
    @staticmethod
    def _check_name(name) -> str:
        if not isinstance(name, str) or not name.strip():
            raise PresetError(400, "name is required")
        name = " ".join(name.split())[:_NAME_MAX]
        return name

    @staticmethod
    def _check_desc(desc) -> str:
        if desc is None:
            return ""
        if not isinstance(desc, str):
            raise PresetError(400, "desc must be a string")
        return desc.strip()[:_DESC_MAX]

    def _is_builtin_name(self, name: str) -> bool:
        return any(b["name"].lower() == name.lower() for b in self._builtin)

    def _find_name(self, name: str, exclude_id: str | None = None) -> dict | None:
        return next((r for r in self._rows if r["name"].lower() == name.lower() and r["preset_id"] != exclude_id), None)

    # ---------- CRUD ----------
    def list(self) -> list[dict]:
        return [copy.deepcopy(b) for b in self._builtin] + [copy.deepcopy(r) for r in self._rows]

    def get(self, preset_id: str) -> dict:
        for r in self._builtin + self._rows:
            if r["preset_id"] == preset_id:
                return copy.deepcopy(r)
        raise PresetError(404, "no such preset")

    def create(self, name, desc, config: Mapping[str, Any], replace: bool = False) -> dict:   # raw OR validated: sanitized inside
        name = self._check_name(name)
        if self._is_builtin_name(name):
            raise PresetError(403, f"\"{name}\" is a built-in game — pick another name")
        cfg = self.sanitize(dict(config))
        cfg.pop("config_id", None)
        now = self.now_ms()
        clash = self._find_name(name)
        if clash and not replace:
            raise PresetError(409, f"a saved game named \"{clash['name']}\" already exists")
        if clash:
            clash.update({"name": name, "desc": self._check_desc(desc), "config": cfg, "updated_t": now})
            self._save()
            return copy.deepcopy(clash)
        row = {"preset_id": uuid.uuid4().hex[:8], "name": name, "desc": self._check_desc(desc), "builtin": False,
               "created_t": now, "updated_t": now, "config": cfg}
        self._rows.append(row)
        self._save()
        return copy.deepcopy(row)

    def update(self, preset_id: str, name=None, desc=None, config: Mapping[str, Any] | None = None) -> dict:
        if any(b["preset_id"] == preset_id for b in self._builtin):
            raise PresetError(403, "built-in games can't be edited — apply it, tune, then SAVE AS a new one")
        row = next((r for r in self._rows if r["preset_id"] == preset_id), None)
        if row is None:
            raise PresetError(404, "no such preset")
        if name is not None:
            name = self._check_name(name)
            if self._is_builtin_name(name):
                raise PresetError(403, f"\"{name}\" is a built-in game — pick another name")
            if self._find_name(name, exclude_id=preset_id):
                raise PresetError(409, f"a saved game named \"{name}\" already exists")
            row["name"] = name
        if desc is not None:
            row["desc"] = self._check_desc(desc)
        if config is not None:
            cfg = self.sanitize(dict(config))
            cfg.pop("config_id", None)
            row["config"] = cfg
        row["updated_t"] = self.now_ms()
        self._save()
        return copy.deepcopy(row)

    def delete(self, preset_id: str) -> None:
        if any(b["preset_id"] == preset_id for b in self._builtin):
            raise PresetError(403, "built-in games can't be deleted")
        before = len(self._rows)
        self._rows = [r for r in self._rows if r["preset_id"] != preset_id]
        if len(self._rows) == before:
            raise PresetError(404, "no such preset")
        self._save()


def default_path() -> pathlib.Path:
    return BASE_DIR / "presets.json"
