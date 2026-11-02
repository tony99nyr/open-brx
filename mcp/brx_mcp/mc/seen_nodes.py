"""F659: the node ids this MC home has ever heard from, so a phone's FIRST LAN hello can be told to the host.

One id per line in `mc-seen-nodes.txt` next to session.json, appended and fsynced. A missing list on a fresh home is
seeded from the ids that already hold a trust key, so the upgrade does not announce every known phone. A list that
cannot be read or written costs only the line (it may repeat after a restart): it never blocks a hello.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path


log = logging.getLogger("brx.mc.seen")
SEEN_FILE = "mc-seen-nodes.txt"
SEEN_CAP = 5000


def _ok(node_id: object) -> bool:
    return isinstance(node_id, str) and 0 < len(node_id) <= 64 and node_id.isprintable() and not any(c.isspace() for c in node_id)


class SeenNodes:
    def __init__(self, data_dir: Path | None = None, seed=()):
        self.data_dir = data_dir
        self.ids: set[str] = set()
        if data_dir is None:
            return
        path = data_dir / SEEN_FILE
        try:
            self.ids = {ln.strip() for ln in path.read_text(encoding="utf-8").splitlines() if _ok(ln.strip())}
        except FileNotFoundError:
            for nid in seed:
                self._append(nid)
        except Exception as e:
            log.warning("could not read %s (%s): new-phone lines may repeat", path, e)

    def _append(self, node_id: str) -> None:
        self.ids.add(node_id)
        if self.data_dir is None:
            return
        try:
            with open(self.data_dir / SEEN_FILE, "a", encoding="utf-8") as f:
                f.write(node_id + "\n")
                f.flush()
                os.fsync(f.fileno())
        except Exception as e:
            log.warning("could not append to %s (%s)", SEEN_FILE, e)

    def add(self, node_id: str) -> bool:
        """True when this id was never seen before (and is now recorded)."""
        if not _ok(node_id) or node_id in self.ids:
            return False
        if len(self.ids) >= SEEN_CAP:
            return False
        self._append(node_id)
        return True
