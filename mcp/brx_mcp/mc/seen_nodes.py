"""F659: the node ids this MC home has ever heard from, so a phone's FIRST LAN hello can be told to the host.

One id per line in `mc-seen-nodes.txt` next to session.json. A missing list on a fresh home is seeded from the ids that
already hold a trust key, so the upgrade does not announce every known phone. The write is a plain buffered append (no
fsync): `add` runs on the event loop inside a hello, and a lost line only repeats one notice. A list that cannot be read
or written never blocks a hello. Past SEEN_CAP ids nothing more is written, but new ids are still flagged (the list is
no place for 5000 spoofed hellos to silence the line); a bounded in-memory set stops one id repeating.
"""
from __future__ import annotations

import logging
from collections import OrderedDict
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
        self.overflow: OrderedDict[str, None] = OrderedDict()   # past the cap: remembered in memory only, bounded
        self._lead_newline = False                               # the file ends mid-line (a torn append)
        self._warned = False
        if data_dir is None:
            return
        path = data_dir / SEEN_FILE
        try:
            text = path.read_text(encoding="utf-8")
            self._lead_newline = bool(text) and not text.endswith("\n")
            self.ids = {ln.strip() for ln in text.splitlines() if _ok(ln.strip())}
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
                f.write(("\n" if self._lead_newline else "") + node_id + "\n")
            self._lead_newline = False
        except Exception as e:
            log.warning("could not append to %s (%s)", SEEN_FILE, e)

    def add(self, node_id: str) -> bool:
        """True when this id was never seen before (and is now recorded, in memory at least)."""
        if not _ok(node_id) or node_id in self.ids or node_id in self.overflow:
            return False
        if len(self.ids) >= SEEN_CAP:
            if not self._warned:
                self._warned = True
                log.warning("%s holds %d ids: new ones are flagged but no longer written", SEEN_FILE, len(self.ids))
            self.overflow[node_id] = None
            while len(self.overflow) > SEEN_CAP:
                self.overflow.popitem(last=False)
            return True
        self._append(node_id)
        return True
