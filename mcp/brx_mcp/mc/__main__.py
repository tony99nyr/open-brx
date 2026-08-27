"""python -m brx_mcp.mc — run Mission Control (HTTP API + UI + node WebSocket server)."""
from __future__ import annotations

import argparse
import asyncio
import inspect
import logging
import secrets
import socket

log = logging.getLogger("brx.mc")


def _lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def build(args):
    from .fakes import DemoDriver, FakeArmory, FakeCompiler, FakeNet, demo_armory, DEMO_NAMES
    from .state import Session
    from .store import Store

    compiler = FakeCompiler()
    try:
        from .compile import Compiler as RealCompiler  # M-MODES lane
        compiler = RealCompiler()
        log.info("compiler: real M-MODES compiler")
    except Exception as e:
        log.warning("compiler: FAKE (M-MODES compile.py not available: %s)", e)

    net = None
    if not args.fake_net:
        try:
            from .net import NetServer as RealNet  # M-NET lane
            net = RealNet()
            log.info("net: real M-NET WebSocket server")
        except Exception as e:
            log.warning("net: FAKE in-memory (M-NET net.py not available: %s)", e)
    fake_net = net is None
    if fake_net:
        net = FakeNet()

    armory = FakeArmory(demo_armory()) if args.demo else None
    if armory is None:
        try:
            from .armory import LocalArmory
            armory = LocalArmory()
        except Exception as e:
            log.warning("armory: FAKE (%s)", e)
            armory = FakeArmory(demo_armory())

    ip = args.host if args.host not in ("0.0.0.0", "") else _lan_ip()
    ws_url = f"ws://{ip}:{args.ws_port}/ws"
    session = Session(compiler, net, armory, lan={"mode": "unknown", "ip": ip, "port": args.port, "ws_url": ws_url, "qr": ws_url})
    restored_from_file = 0
    if getattr(args, "session_file", None):
        # explicit session file (e2e boots from a fixture, e.g. a pre-A10 snapshot) — honoured even with --demo
        from pathlib import Path as _P
        session._persist_path = _P(args.session_file)
        restored_from_file = session.restore_snapshot()
        print(f"  session file {args.session_file}: {restored_from_file} player(s) restored")
    elif not (args.demo or getattr(args, "ephemeral", False)):
        # --demo / --ephemeral runs (e2e, CI) must not inherit or write a bench session:
        # a restored roster with a bare-tail gun_id once stole the e2e fake gun (2026-08-26).
        from pathlib import Path as _P
        session._persist_path = _P.home() / ".brx-mcp" / "session.json"
        import atexit
        atexit.register(session.persist_now)         # flush the debounced final write on exit
        restored = session.restore_snapshot()
        if restored:
            print(f"  session restored: {restored} player(s) from the last run (NEW MATCH > fresh session clears it)")
    extra = []
    import inspect
    if inspect.iscoroutinefunction(getattr(net, "start", None)):
        # Real M-NET: an asyncio server — start it inside the app's event loop (lifespan task).
        async def _start_net():
            await net.start(ip, args.ws_port, "/ws")
            # join info FIRST — it fills lan.ws_url with the REAL bound port. The mDNS advert below is
            # best-effort and once HUNG in a sandboxed netns, leaving ws_url at port 0: every phone that
            # trusted the JOIN strip then dialed ws://…:0/ws (e2e, 2026-08-26).
            try:
                ji = net.join_info()
                session.lan.update({"ws_url": ji.get("url") or ws_url, "qr": ji.get("qr") or ji.get("url") or ws_url,
                                    "session_id": ji.get("session_id")})
            except Exception as e:  # pragma: no cover
                log.warning("join_info: %s", e)
            try:
                # sync zeroconf blocks if called from inside the running loop (EventLoopBlocked) — thread it,
                # and cap it: a wedged multicast stack must never stall startup.
                if await asyncio.wait_for(asyncio.get_running_loop().run_in_executor(None, net.advertise_mdns), timeout=6):
                    print("  mDNS: advertising _openbrx._tcp (phones auto-discover)")
            except Exception as e:
                print(f"  mDNS advertising failed ({type(e).__name__}: {e!r}) — QR/manual join still work")
            log.info("net: listening on %s", session.lan["ws_url"])
            # print the nodes line HERE (not in the pre-loop banner) so the REAL bound port shows —
            # the banner renders before this async bind, when the port is still 0/unbound.
            print(f"  nodes: {session.lan['ws_url']}   (scan the join QR / enter this URL on each phone)", flush=True)
        extra.append(_start_net)
    else:
        net.start(ip, args.ws_port, "/ws")
    try:
        session.store = Store(session.session_id)
    except Exception as e:
        log.warning("store disabled: %s", e)

    # A10 §8 saved games: the real shelf lives next to armory.json; --demo/--ephemeral get a throwaway copy so a
    # demo "SAVE AS…" never lands in (or wipes) the host's real presets.json
    from pathlib import Path as _PP
    from .presets import PresetStore, default_path
    from .state import default_config
    from . import policy as _policy
    if args.demo or getattr(args, "ephemeral", False):
        import tempfile
        ppath = _PP(tempfile.mkdtemp(prefix="brx-mc-presets-")) / "presets.json"
        log.info("presets: throwaway shelf at %s (demo/ephemeral)", ppath)
    else:
        ppath = default_path()
    session.presets = PresetStore(ppath, session.sanitize_config, default_config, _policy.merge, now_ms=session.now_ms)

    if args.demo and not restored_from_file:   # a restored session keeps its roster; demo seeding would re-add GUN-A..H (e2e lane finding)
        session.set_config({"mode": "tdm"})
        # A10 demo loadouts: a secondary weapon, a perk, an empty slot 2, and different primaries, so the
        # Kit page shows every slot-2 state without anyone typing (docs/spec/loadout.md §5)
        demo_loadouts = [
            {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "shotgun"}]},
            {"weapons": [{"weapon_id": "smg"}], "perk": "body_armor"},
            {"weapons": [{"weapon_id": "burst_rifle"}]},
            {"weapons": [{"weapon_id": "sniper_rifle"}], "perk": "extended_mags"},
            {"weapons": [{"weapon_id": "force_rifle"}, {"weapon_id": "stinger"}]},
            {"weapons": [{"weapon_id": "bolt_rifle"}], "perk": "easy_reload"},
            {"weapons": [{"weapon_id": "charge_rifle"}]},
            {"weapons": [{"weapon_id": "suppressor"}, {"weapon_id": "smg"}]},
        ]
        for i, name in enumerate(DEMO_NAMES):
            session.add_player(name, team_id="blue" if i % 2 == 0 else "yellow", gun_id=f"GUN-{chr(65 + i)}",
                               loadout=demo_loadouts[i % len(demo_loadouts)])
        if fake_net:
            driver = DemoDriver(session, net, n=len(DEMO_NAMES), speed=args.demo_speed)
            extra.append(driver.run)
            log.info("demo: %d fake nodes driving the board", len(DEMO_NAMES))
    return session, net, extra


def main(argv=None):
    ap = argparse.ArgumentParser(prog="brx_mcp.mc")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--ws-port", type=int, default=8766)
    ap.add_argument("--fake-net", action="store_true", help="in-memory node transport (no phones)")
    ap.add_argument("--ephemeral", action="store_true", help="no session snapshot/restore (tests, throwaway hosts)")
    ap.add_argument("--session-file", default=None, help="restore from / persist to this session.json instead of ~/.brx-mcp (e2e fixtures)")
    ap.add_argument("--demo", action="store_true", help="seed 8 demo players/guns; with --fake-net, simulate nodes")
    ap.add_argument("--demo-speed", type=float, default=1.0)
    ap.add_argument("--token", default=None, help="operator token (default: random per launch)")
    ap.add_argument("--no-auth", action="store_true", help="disable the operator token (open API — trusted LAN only)")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    session, net, extra = build(args)
    token = None if args.no_auth else (args.token or secrets.token_urlsafe(6))
    from .api import create_app
    app = create_app(session, extra_tasks=extra, token=token)
    import uvicorn
    ip = session.lan["ip"]
    url = f"http://{ip}:{args.port}/" + (f"#tok={token}" if token else "")
    print(f"Mission Control  {url}", flush=True)
    if not inspect.iscoroutinefunction(getattr(net, "start", None)):
        # sync/fake net is already bound → its ws_url is real now. The async NetServer prints the nodes
        # line from _start_net once it binds (avoids the stale ws://<ip>:0 placeholder before the bind).
        print(f"  nodes: {session.lan.get('ws_url') or 'ws://'+ip+':'+str(args.ws_port)+'/ws'}", flush=True)
    if token:
        print(f"  operator token: {token}   (open the URL above — it carries the token; --no-auth to disable)", flush=True)
    else:
        print("  auth DISABLED (--no-auth): any device on this LAN can control the match", flush=True)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
