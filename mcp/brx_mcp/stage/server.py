"""HTTP front for GunStage: one page, `GET /api/state`, `POST /api/do`. Runs on the machine with Bluetooth."""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import time
import logging
from pathlib import Path

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse
from starlette.routing import Route

from .stage import GunStage

log = logging.getLogger("brx.stage")
PAGE = Path(__file__).with_name("page.html")

# action -> (is_coroutine, allowed kwargs). Anything else is a 400, so the page cannot call into the manager.
ACTIONS: dict[str, tuple[bool, tuple[str, ...]]] = {
    "scan": (True, ("duration_s",)), "connect": (True, ("address",)), "disconnect": (True, ()),
    "set_profile": (False, ("mode", "preset", "gun", "headset", "night", "tid", "environment", "voice", "voice_slots")),
    "voice_line": (True, ("id",)), "set_voice_slot": (False, ("role", "id")),
    "voice_board": (False, ("voice",)), "voice_board_play": (False, ("voice", "from_slot")), "voice_board_stop": (False, ()),
    "voice_verdict": (False, ("voice", "id", "ok", "note")), "reroll": (False, ()),
    "patch_presentation": (False, ("patch",)), "pull_mc": (True, ("url", "token")),
    "arm": (True, ()), "spawn": (True, ()), "revive": (True, ()), "end": (True, ()), "panic": (True, ()), "game_end": (True, ("outcome",)),
    "event": (False, ("kind",)), "kill": (False, ("medals",)), "headset": (False, ("name", "tid")),
    "ir": (True, ("kind", "team", "damage", "repeat")), "auto_react": (False, ("on",)),
    "set_emitter": (False, ("port",)), "raw": (True, ("frames", "delay_s", "confirm")), "walk_start": (False, ()), "walk_play": (True, ()), "walk_verdict": (False, ("ok", "note")), "walk_stop": (False, ()),
}


async def pull_mc(stage: GunStage, url: str, token: str | None = None) -> dict:
    """GET <mc>/api/state and load its applied config into the stage."""
    import urllib.request
    req = urllib.request.Request(url.rstrip("/") + "/api/state", headers={"Authorization": f"Bearer {token}"} if token else {})

    def fetch():
        with urllib.request.urlopen(req, timeout=5.0) as r:      # stdlib: the Windows venv need not carry httpx
            return json.loads(r.read().decode("utf-8"))
    st = await asyncio.get_event_loop().run_in_executor(None, fetch)
    return stage.load_config(st["config"], source=url)


def create_app(stage: GunStage, poll_s: float = 0.2) -> Starlette:
    async def page(_: Request):
        return HTMLResponse(PAGE.read_text(encoding="utf-8"))

    # 2026-09-07: `state()` is EXPENSIVE (527-658 ms measured on the bench machine: it rebuilds the bundle
    # view, the walkthrough plan and the sound-catalog descriptions). The page polls this route every 700 ms,
    # so an un-cached build leaves the single event loop busy most of the time -- and bleak's notify callback
    # runs on that SAME loop, so a real hit landing mid-build queues behind it. That is exactly the ~600 ms
    # LED lag the operator reported, and splitting `event()` off the hit path does NOT fix it while the page
    # itself keeps triggering the build. Serve a recent snapshot instead: `poll()` still runs every request
    # (it is cheap and it is what drains rx), only the SNAPSHOT is reused. STATE_TTL_S is well under the
    # page's own poll period, so the page still feels live. Proper fix is to make `state()` cheap (F51).
    STATE_TTL_S = 1.0
    cache: dict = {"at": 0.0, "body": None}

    async def state(_: Request):
        stage.poll()
        now = time.monotonic()
        if cache["body"] is None or now - cache["at"] >= STATE_TTL_S:
            cache["body"] = stage.state()
            cache["at"] = now
        return JSONResponse(cache["body"])

    async def scan_results(_: Request):
        return JSONResponse(stage.scan_results)

    async def do(req: Request):
        try:
            body = await req.json()
        except Exception:
            return JSONResponse({"error": "body must be JSON"}, status_code=400)
        action = body.get("action")
        if action not in ACTIONS:
            return JSONResponse({"error": f"unknown action {action!r}", "known": sorted(ACTIONS)}, status_code=400)
        is_coro, allowed = ACTIONS[action]
        kw = {k: v for k, v in body.items() if k in allowed}
        cache["at"] = 0.0          # an action changes things: the next GET /api/state must rebuild, not serve the TTL copy
        try:
            if action == "pull_mc":
                out = await pull_mc(stage, **kw)
            elif action == "auto_react":
                stage.auto_react = bool(kw.get("on", True)); out = stage.state()
            else:
                fn = getattr(stage, action)
                out = await fn(**kw) if is_coro else fn(**kw)
        except (ValueError, KeyError, TypeError) as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        except Exception as e:   # a BLE / serial failure: show it on the page, never a bare 500
            log.exception("action %s failed", action)
            stage._log(f"{action} failed: {e}", "warn")
            return JSONResponse({"error": f"{action} failed: {e}"}, status_code=502)
        if not isinstance(out, dict) or "log" not in out:
            out = stage.state()
        return JSONResponse(out)

    @contextlib.asynccontextmanager
    async def lifespan(app):
        async def poller():
            while True:
                try:
                    stage.poll()
                except Exception:      # never let the poller die
                    log.exception("poll")
                await asyncio.sleep(poll_s)
        stage.bind_loop()                 # 2026-09-07: reactions arriving on the BLE notify thread need this
        task = asyncio.get_event_loop().create_task(poller())
        try:
            yield
        finally:
            task.cancel()
            with contextlib.suppress(Exception):
                await stage.disconnect()

    return Starlette(routes=[Route("/", page), Route("/api/state", state), Route("/api/scan", scan_results),
                             Route("/api/do", do, methods=["POST"])],
                     lifespan=lifespan)


def build(args) -> GunStage:
    if args.fake:
        from ..fake import FakeConnectionManager, FakeTagger
        mgr = FakeConnectionManager([FakeTagger("FA:KE:00:00:00:01", "FAKE-STAGE", team=1)])
        bridge = None
    else:
        from ..ble import ConnectionManager
        mgr = ConnectionManager()
        bridge = None
    stage = GunStage(mgr, bridge)
    if not args.fake and args.ir:
        try:
            stage.set_emitter(args.ir)            # PINGs: a silent port is refused, not trusted
        except Exception as e:
            stage._log(f"emitter {args.ir}: {e}", "warn")
    if args.mode:
        stage.set_profile(mode=args.mode)
    return stage


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(prog="brx_mcp stage", description="the GUN STAGE bench page")
    ap.add_argument("--gun", default=None, help="BLE address (or the fake's) to connect on start")
    ap.add_argument("--ir", default=None, help="ESP32 emitter serial port (COM7, /dev/ttyACM0, or 'auto')")
    ap.add_argument("--mc", default=None, help="a running MC (http://ip:8765) whose applied config drives the stage")
    ap.add_argument("--token", default=None, help="that MC's operator token")
    ap.add_argument("--mode", default=None, help="start on this mode (tdm ffa infection lms extraction)")
    ap.add_argument("--fake", action="store_true", help="no Bluetooth: one emulated gun (page + logic only)")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    stage = build(args)
    app = create_app(stage)

    async def boot():
        if args.mc:
            try:
                await pull_mc(stage, args.mc, args.token)
            except Exception as e:
                stage._log(f"could not pull the MC config from {args.mc}: {e}", "warn")
        gun = args.gun or ("FA:KE:00:00:00:01" if args.fake else None)
        if gun:
            try:
                await stage.connect(gun)
            except Exception as e:
                stage._log(f"connect {gun} failed: {e} -- use SCAN / CONNECT on the page", "warn")

    orig = app.router.lifespan_context

    @contextlib.asynccontextmanager
    async def lifespan(app_):
        async with orig(app_):
            await boot()
            yield

    app.router.lifespan_context = lifespan
    import uvicorn
    print(f"GUN STAGE  http://{args.host}:{args.port}/   ({'FAKE gun' if args.fake else 'real BLE'}"
          f"{', emitter ' + args.ir if args.ir else ', no emitter'})", flush=True)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
