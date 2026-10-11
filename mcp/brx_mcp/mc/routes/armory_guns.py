"""Mission Control armory guns routes."""
from __future__ import annotations

import asyncio
import json
import logging

from starlette.responses import JSONResponse
from starlette.routing import BaseRoute, Route


def routes(ctx) -> list[BaseRoute]:
    s = ctx.s
    body = ctx.body
    _err = ctx.err
    _int = ctx.parse_int
    operator = ctx.operator
    _without_pins = ctx.without_pins
    log = logging.getLogger("brx.mc.api")

    weapons_logged = [False]


    def _range_path():
        # `home_dir()`, not `Path.home() / ".brx-mcp"`: the bench log belongs wherever this MC persists
        # everything else, which `BRX_MCP_HOME` moves for a test run (storage.py). Hardcoding the real
        # dotfile path here meant a suite that posted a verdict wrote into the operator's field evidence.
        from ...storage import home_dir
        return home_dir() / "weapon-verdicts.jsonl"

    # A bench day appends one line per try-out and never prunes; the GET re-read and re-parsed the
    # whole file on every KIT mount. Only the LAST verdict per weapon is ever shown, so read the tail
    # (polish-loop deferred low, 2026-08-26). 256 KB is thousands of verdicts — far more than a day.
    _VERDICT_TAIL_BYTES = 256 * 1024


    async def armory_scan(req):
        b = await body(req)
        try:
            dur = _int(b.get("duration_s"), 6, 1, 30)
        except ValueError as e:
            return _err(e)
        rows = await s.scan(dur)
        return JSONResponse(rows)


    async def armory_list(req):
        import asyncio
        rows = await asyncio.to_thread(s.armory.list)   # file lock + disk read: off the event loop
        if operator(req):
            return JSONResponse(rows)
        # OP2 r1 (Opus): free-text notes can quote a PIN inside longer text, which the exact-value rule cannot see
        return JSONResponse(_without_pins([{k: v for k, v in r.items() if k != "notes"} for r in rows]))


    async def weapons(_):
        """O5: the demo catalogue is for a demo MC only. A real MC with a broken catalogue says so (503 plus one
        traceback in the log) instead of serving plausible but wrong stats."""
        from ..fakes import weapon_views as fake_weapon_views
        from ..views import weapon_views
        demo = bool(getattr(s, "demo_session", False))
        try:
            views = weapon_views(s.compiler.weapon_catalog(), s.health_pool())   # htk/ttk at THIS game's health
            if views:
                return JSONResponse(views)
            reason = "the weapon catalogue is empty"
        except Exception as e:
            reason = f"the weapon catalogue failed to load ({type(e).__name__})"
            if not weapons_logged[0]:
                weapons_logged[0] = True
                logging.getLogger("brx.mc").exception("weapon catalogue unavailable")
        if demo:
            return JSONResponse(fake_weapon_views())
        if not weapons_logged[0]:
            weapons_logged[0] = True
            logging.getLogger("brx.mc").error("weapon catalogue unavailable: %s", reason)
        return _err(f"WEAPONS UNAVAILABLE: {reason}. Restart MC or check the weapon data.", 503)


    async def dismiss_armory_corrupt(req):
        """O2: DISMISS on the corrupt-armory banner. The flag is sticky until this is called (operator-token
        gated like every non-GET). For a corrupt file it also moves the file aside (starting a fresh armory); a
        failed move keeps the warning and returns 500. `dismissed` says whether there was a warning to clear."""
        try:
            # the file move may wait up to the inventory lock's timeout: keep it off the event loop
            dismissed = await asyncio.to_thread(s.dismiss_armory_corrupt_io)
        except Exception as e:
            return _err(f"COULD NOT MOVE THE CORRUPT ARMORY ASIDE: {type(e).__name__}: {e}", 500)
        if dismissed:
            guns = await asyncio.to_thread(s._read_guns)     # the re-read may wait on the lock: off the loop
            s.finish_armory_dismiss(guns if guns is not None else {})
        return JSONResponse({"ok": True, "dismissed": dismissed})


    async def range_verdicts(_):
        """Latest verdict per weapon from the bench log."""
        out = {}
        try:
            pth = _range_path()
            with pth.open("rb") as f:
                f.seek(0, 2)
                size = f.tell()
                f.seek(max(0, size - _VERDICT_TAIL_BYTES))
                raw = f.read().decode("utf-8", "replace")
            if size > _VERDICT_TAIL_BYTES:
                # Drop the half line the seek landed inside. Belt-and-braces over the `ValueError`
                # guard below, which already skips it in practice — kept because a truncated record
                # is not GUARANTEED to be invalid JSON, and a half row that happens to parse would
                # be a wrong verdict rather than a skipped one. Deliberately redundant, and no test
                # can distinguish the two paths on realistic data (review 2026-09-01).
                raw = raw.split("\n", 1)[-1]
            for line in raw.splitlines():
                if not line.strip():
                    continue
                try:
                    r = json.loads(line)
                except ValueError:
                    continue                        # a torn line must not hide the verdicts after it
                if isinstance(r, dict) and isinstance(r.get("weapon_id"), str):
                    out[r["weapon_id"]] = r
        except FileNotFoundError:
            pass
        except OSError:
            log.exception("range verdicts unreadable — serving none")
        return JSONResponse(out)


    async def range_verdict(request):
        """Append a bench verdict: {weapon_id, verdict: pass|issue, note?}."""
        # `request.json()` raises on malformed input, which Starlette turns into a 500 — a guard that
        # itself throws. `body()` above is the one that degrades to {} (polish-loop deferred low).
        b = await body(request)
        wid, verdict = b.get("weapon_id"), b.get("verdict")
        if not wid or not isinstance(wid, str) or verdict not in ("pass", "issue"):
            return _err("weapon_id + verdict (pass|issue) required")
        import time as _t
        rec = {"weapon_id": wid, "verdict": verdict, "note": str(b.get("note") or "")[:400], "t": int(_t.time() * 1000)}
        try:
            pth = _range_path(); pth.parent.mkdir(parents=True, exist_ok=True)
            with pth.open("a") as f:
                f.write(json.dumps(rec) + "\n")
        except OSError as e:                        # a full/read-only disk must not 500 the bench
            log.exception("range verdict not written")
            return _err(f"could not write the bench log: {e}", 503)
        return JSONResponse(rec)


    return [
        Route("/api/range/verdicts", range_verdicts),
        Route("/api/range/verdict", range_verdict, methods=["POST"]),
        Route("/api/armory/scan", armory_scan, methods=["POST"]),
        Route("/api/armory", armory_list),
        Route("/api/weapons", weapons),
        Route("/api/armory/corrupt/dismiss", dismiss_armory_corrupt, methods=["POST"]),
    ]
