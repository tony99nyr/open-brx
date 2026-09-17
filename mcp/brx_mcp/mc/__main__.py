"""python -m brx_mcp.mc — run Mission Control (HTTP API + UI + node WebSocket server)."""
from __future__ import annotations

import argparse
import asyncio
import inspect
import json
import logging
import os
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


def _check_advertise(value):
    """T3-A: `--advertise <ip>` swaps what the QR and mDNS hand out for a different address than the
    one `_lan_ip()` found -- WITHOUT touching where the socket binds (the bind always follows `--host`
    / `0.0.0.0`, never this value; see `build()`). It exists for exactly the WSL2 case `netinfo.py`
    warns about: MC's own guess is a NAT address private to the Windows host, and the operator already
    knows the real Windows LAN address (`ipconfig`) -- this hands it straight to every phone's QR
    instead of the wrong one, with no restart-time guessing.

    It is spliced into `ws://<here>:<port>/ws`, so a scheme or a path here is a mistake worth catching
    before it reaches a QR code, not after (mDNS also needs a literal IPv4 -- `NetServer.advertise_mdns`
    -- so a hostname here still fixes the QR but silently drops mDNS, which is not this function's job
    to police).

    A PORT is the likeliest typo of all, and it used to pass: `--advertise 192.168.1.42:8766` was accepted
    whole and spliced to `ws://192.168.1.42:8766:8766/ws` -- a doubled port, in the QR, on the flag whose
    entire reason to exist is that a wrong address in the QR cost a field night. The port comes from
    `--ws-port`; this is the host alone. (A bracketed IPv6 literal is refused by the same rule rather than
    half-supported: mDNS needs a literal IPv4, and nothing in the field path has ever been exercised on
    v6.) Anything left has to LOOK like a host -- an IP address, or a DNS name -- because a value that
    cannot be one at all can only produce a URL no phone will dial."""
    if not value:
        return None
    v = str(value).strip()
    if "://" in v or "/" in v:
        raise SystemExit(f"--advertise must be a bare host/IP, e.g. 192.168.1.42 (got {v!r}); it is "
                         "spliced into ws://<here>:<port>/ws, not a URL by itself")
    if ":" in v or v.startswith("[") or v.endswith("]"):
        raise SystemExit(f"--advertise takes the HOST only, with no port (got {v!r}); it is spliced into "
                         f"ws://<here>:<port>/ws, so a port here is handed to every phone twice — the port "
                         "comes from --ws-port. (An IPv6 literal is not supported: mDNS advertises IPv4.)")
    try:
        import ipaddress
        ipaddress.ip_address(v)
        return v
    except ValueError:
        pass
    import re as _re
    if not _re.fullmatch(r"[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*", v):
        raise SystemExit(f"--advertise must be an IP address or a hostname (got {v!r}); it is spliced into "
                         "ws://<here>:<port>/ws and printed into every phone's QR")
    return v


def _check_public_url(url):
    """A28.1: `--public-url` goes straight into every QR and every `welcome`, so a typo would be
    discovered one phone at a time on the field. Refuse it here instead.

    And refuse PLAINTEXT to a public host outright. A `ws://` node socket over the internet carries the
    join secret and every `node_key` in clear, to anyone on the path -- which hands over exactly what
    A28.2's gate exists to protect. Plaintext is allowed only to a LITERAL loopback or private address
    (a local forward, or a `100.x` tailnet address): a HOSTNAME cannot be classified without resolving
    it, and a name that happens to resolve privately today is not a promise about tomorrow."""
    if not url:
        return None
    from urllib.parse import urlsplit
    from .net import peer_class
    u = urlsplit(str(url))
    if u.scheme not in ("ws", "wss") or not u.netloc:
        raise SystemExit(f"--public-url must be a ws:// or wss:// URL with a host (got {url!r}); "
                         "it is the address every phone dials, e.g. wss://mc.example.org/ws")
    if "@" in u.netloc:
        # Userinfo in a URL every phone is handed, and which MC prints on a banner and encodes into a QR.
        raise SystemExit(f"--public-url {url!r} carries userinfo before the host (the `@`). The node "
                         "socket authenticates with the join secret (A28.2), not with URL credentials, "
                         "and this URL is printed, QR-encoded and handed to every phone — drop it.")
    if u.scheme == "ws":
        host = (u.hostname or "").strip("[]")
        if peer_class(host) not in ("loopback", "private"):
            raise SystemExit(
                f"--public-url {url!r} is PLAINTEXT to a public host. The node socket carries the join "
                "secret and every node_key, so over the internet it must be wss://. (ws:// is accepted "
                "only for a literal loopback or private ADDRESS, e.g. ws://127.0.0.1:8766/ws or a "
                "100.x tailnet address -- a hostname cannot be checked without resolving it.)")
    return str(url)


def build(args):
    from .fakes import DemoDriver, FakeArmory, FakeCompiler, FakeNet, demo_armory, DEMO_NAMES
    from .state import Session
    from .store import Store

    bench_volume = getattr(args, "bench_volume", None)
    compiler = FakeCompiler(bench_volume=bench_volume)
    try:
        from .compile import Compiler as RealCompiler  # M-MODES lane
        compiler = RealCompiler(bench_volume=bench_volume)
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
    # F142 round 2: `--demo` is NOT the only way a session ends up holding demo guns. A run with no
    # bleak (WSL, a CI box, a laptop with the radio off) falls back to `FakeArmory(demo_armory())`
    # above, and a roster built from THAT scan is GUN-A..H — which is exactly the roster that was
    # restored into a real field day. The marker has to describe the ARMORY the roster came from, not
    # the flag the operator typed.
    demo_armory_in_use = isinstance(armory, FakeArmory)

    ip = args.host if args.host not in ("0.0.0.0", "") else _lan_ip()
    # T3-A: `--advertise` only ever touches what gets HANDED OUT (this `ip`, folded into `ws_url` below
    # and into `advertise_host=` at the real bind further down) -- never what the socket binds to, which
    # is `bind`/`args.host`, computed separately and unconditionally on `_lan_ip()`/`0.0.0.0`.
    advertise_override = _check_advertise(getattr(args, "advertise", None))
    if advertise_override:
        ip = advertise_override
    ws_url = f"ws://{ip}:{args.ws_port}/ws"
    # A28.1: checked HERE, before the session is built, because `lan_info` needs to know whether phones
    # already have a public way in -- a backhaul URL makes the WSL LAN-address warning below moot, and
    # firing it on a working tunnel setup is how an operator learns to ignore it. (The Tunnel that carries
    # this URL is constructed further down; this is only the validation, and it must not move after the
    # first use of its result.)
    public_url = _check_public_url(getattr(args, "public_url", None))
    # F143 (field 2026-09-12): `mode` used to be the literal "unknown", and the REACH panel printed it
    # as a display word — "UNKNOWN · 192.168.28.167:8765". Best-effort SSID per platform, never fatal,
    # and the no-answer case is "lan" with no ssid (`netinfo.lan_info`).
    from . import netinfo as _netinfo
    session = Session(compiler, net, armory,
                       lan=_netinfo.lan_info(ip, args.port, ws_url,
                                              advertise_overridden=bool(advertise_override),
                                              public_url=bool(public_url)))
    # T3-A / field 2026-09-12: WSL2's own NAT address advertised in the QR/mDNS looked identical to a
    # real LAN address, so no phone could connect and MC never said why. LOUD on purpose -- this is the
    # one line an operator glancing at a scrolling boot log must not be able to miss.
    lan_warning = session.lan.get("warning")
    if lan_warning:
        _rule = "!" * 78
        print(_rule, flush=True)
        print(f"  {lan_warning}", flush=True)
        print(_rule, flush=True)
    # A28.1: the tunnel exists in every run (so `lan.public.available` is honest and the UI can show the
    # install line); it only spawns anything on --tunnel or POST /api/tunnel.
    from pathlib import Path as _PT
    from .tunnel import Tunnel
    from ..storage import home_dir
    if args.demo or getattr(args, "ephemeral", False):
        import tempfile
        pid_dir = _PT(tempfile.mkdtemp(prefix="brx-mc-tunnel-"))
    else:
        pid_dir = home_dir()
    # The file inside is named per WS PORT and records this MC's own pid, so two Mission Controls on one
    # laptop neither share a file nor reap each other's tunnel (`Tunnel.pid_path`).
    tunnel = Tunnel(public_url=public_url, ws_port=args.ws_port, pid_dir=pid_dir)
    if public_url and getattr(args, "tunnel", False):
        print("  backhaul: --tunnel ignored (--public-url already names a public node URL)", flush=True)
    # A cloudflared we started and never stopped (a hard crash, a SIGKILL) still points its hostname at
    # this ws port, and THIS process has no child -- so the secret gate would be down on a socket the
    # internet can still reach. Kill it before we bind.
    orphan = tunnel.reap_orphan()
    if orphan:
        print(f"  backhaul: killed an orphaned cloudflared (pid {orphan}) from a previous run", flush=True)
    def print_tunnel(pub):
        error = pub.get("error")
        print(f"  backhaul: {pub['status']}" + (f"  {pub['ws_url']}" if pub.get("ws_url") else "")
              + (f"  ({error})" if error else ""), flush=True)
    tunnel.on_change(print_tunnel)
    session.attach_tunnel(tunnel)
    # F142 (field 2026-09-12): mark the session BEFORE any restore or persist, so the marker is what
    # `restore_snapshot` compares against and what the first write records.
    session.demo_session = bool(args.demo) or demo_armory_in_use
    if session.demo_session:
        why = "--demo" if args.demo else "no real armory (bleak unavailable) — the guns are stand-ins"
        print(f"  session: DEMO ({why}) — it will not be restored into, or persisted for, a real run",
              flush=True)
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
        session._persist_path = home_dir() / "session.json"
        import atexit
        atexit.register(session.persist_now)         # flush the debounced final write on exit
        restored = session.restore_snapshot()
        if restored:
            print(f"  session restored: {restored} player(s) from the last run (NEW MATCH > fresh session clears it)")
        elif session._persist_path.exists():
            # F142: a snapshot that was there and was DECLINED (the demo/real boundary) says so out loud;
            # `restore_snapshot` logged the detail.
            print("  session file present but NOT restored — see the log line above", flush=True)
    extra = []
    import inspect
    if inspect.iscoroutinefunction(getattr(net, "start", None)):
        # `net.start` is a coroutine function only for the real M-NET `NetServer` (FakeNet.start is
        # sync), so this branch only ever runs with a `RealNet` -- bind it to its own name so the
        # closure below carries the narrowed type instead of the wider `FakeNet | NetServer` union.
        from .net import NetServer as RealNet
        assert isinstance(net, RealNet)
        real_net = net
        # Real M-NET: an asyncio server — start it inside the app's event loop (lifespan task).
        async def _start_net():
            # Bind every interface, advertise the LAN address. Binding the resolved LAN IP alone left
            # loopback closed, so the cloudflared origin (http://127.0.0.1:<ws-port>) answered 502 on the
            # first real tunnel (field test 2026-09-12): the QR scanned, the phone dialled, nothing landed.
            # `real_net`, not `net`: the narrowed name from the isinstance assert above.
            bind = args.host if args.host not in ("0.0.0.0", "") else "0.0.0.0"
            await real_net.start(bind, args.ws_port, "/ws", advertise_host=ip)
            # join info FIRST — it fills lan.ws_url with the REAL bound port. The mDNS advert below is
            # best-effort and once HUNG in a sandboxed netns, leaving ws_url at port 0: every phone that
            # trusted the JOIN strip then dialed ws://…:0/ws (e2e, 2026-08-26).
            try:
                ji = real_net.join_info()
                # A28.2: `qr` is DERIVED (secret, and the public URL when the tunnel is up) -- set the
                # bare URL and let the session render it, or the join strip loses the join secret.
                session.set_ws_url(ji.get("url") or ws_url)
            except Exception as e:  # pragma: no cover
                log.warning("join_info: %s", e)
            try:
                # sync zeroconf blocks if called from inside the running loop (EventLoopBlocked) — thread it,
                # and cap it: a wedged multicast stack must never stall startup.
                if await asyncio.wait_for(asyncio.get_running_loop().run_in_executor(None, real_net.advertise_mdns), timeout=6):
                    print("  mDNS: advertising _openbrx._tcp (phones auto-discover)")
            except Exception as e:
                # the timeout abandons the AWAIT, not the worker thread — tell it to unpublish if it
                # ever does finish, or MC advertises a service nothing tracks (deferred low)
                real_net.abort_mdns()
                print(f"  mDNS advertising failed ({type(e).__name__}: {e!r}) — QR/manual join still work")
            log.info("net: listening on %s", session.lan["ws_url"])
            # print the nodes line HERE (not in the pre-loop banner) so the REAL bound port shows —
            # the banner renders before this async bind, when the port is still 0/unbound.
            print(f"  nodes: {session.lan['ws_url']}   (scan the join QR / enter this URL on each phone)", flush=True)
            if getattr(args, "tunnel", False) and tunnel.stoppable:
                # A28.1: start on boot, once the ws port is REAL. Failures land in `lan.public.error`
                # and the LAN path is untouched, so this must never stop MC coming up.
                try:
                    tunnel.start(real_net.port or args.ws_port)
                    print("  backhaul: starting a cloudflared quick tunnel (the public URL prints when it is up)", flush=True)
                except Exception as e:
                    print(f"  backhaul: NOT started -- {e}", flush=True)
        extra.append(_start_net)
    else:
        net.start(ip, args.ws_port, "/ws")
        if getattr(args, "tunnel", False):
            # --fake-net has no socket to expose, so --tunnel has nothing to do. SAY so: a flag that is
            # silently ignored is the shape of half the bugs in this repo's history.
            print("  backhaul: --tunnel ignored (--fake-net has no node socket to expose)", flush=True)
    try:
        evidence_path = _PT(args.evidence_dir) if getattr(args, "evidence_dir", None) else None
        if evidence_path:
            evidence_path.mkdir(parents=True, exist_ok=True)
        # 2026-09-13: a demo/ephemeral boot -- every e2e boot, run_tests.py, the app's fake-game
        # runner -- must never create a session-*.sqlite under the operator's real ~/.brx-mcp, which
        # is field evidence (hundreds of test session-*.sqlite files had to be sifted from the real
        # ones by hand after a field night). `Store()`'s default path already honours `BRX_MCP_HOME`
        # (mc_dir() -> storage.home_dir()), but a harness that boots --demo/--ephemeral WITHOUT
        # setting that env var (a human at a shell, or a caller this list misses) still got a real
        # path -- unlike the presets shelf and the tunnel pidfile above, which already fall back to a
        # throwaway tempdir. Give the store the same fallback.
        if (args.demo or getattr(args, "ephemeral", False)) and not os.environ.get("BRX_MCP_HOME"):
            import tempfile
            store_path = _PT(tempfile.mkdtemp(prefix="brx-mc-store-")) / f"session-{session.session_id}.sqlite"
            session.store = Store(session.session_id, store_path)
        else:
            session.store = Store(session.session_id, _PT(args.evidence_dir) / "session.sqlite" if getattr(args, "evidence_dir", None) else None)
        if getattr(args, "evidence_dir", None):
            evidence_path = _PT(args.evidence_dir)
            evidence_path.mkdir(parents=True, exist_ok=True)
            (evidence_path / "mc-session.json").write_text(json.dumps({
                "format": 1, "launch_id": os.environ.get("BRX_MC_LAUNCH_ID"), "session_id": session.session_id,
                "sqlite": str(evidence_path / "session.sqlite"),
            }, indent=2) + "\n", encoding="utf-8")
            (evidence_path / "mc-session.json").chmod(0o600)
    except Exception as e:
        log.warning("store disabled: %s", e)
        if getattr(args, "evidence_dir", None):
            raise RuntimeError(f"requested evidence store is unavailable: {e}") from e

    # Bench 2026-09-17: a match that was in play when the last process stopped resumes now, with the store
    # attached, so its recap is rebuilt from the facts the phones already sent.
    resumed = session.resume_match()
    if resumed:
        print(f"  match resumed: {resumed.upper()} (the snapshot named a match in play)", flush=True)

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
            {"weapons": [{"weapon_id": "suppressor"}, {"weapon_id": "deagle"}], "perk": "quick_switch"},   # A14: all three slots
        ]
        for i, name in enumerate(DEMO_NAMES):
            session.add_player(name, team_id="blue" if i % 2 == 0 else "yellow", gun_id=f"GUN-{chr(65 + i)}",
                               loadout=demo_loadouts[i % len(demo_loadouts)])
        # `fake_net` (set above from `net is None` before the FakeNet() fallback) means exactly this,
        # but re-checking it as an isinstance keeps the type narrowed for `DemoDriver` too.
        if isinstance(net, FakeNet):
            driver = DemoDriver(session, net, n=len(DEMO_NAMES), speed=args.demo_speed)
            extra.append(driver.run)
            log.info("demo: %d fake nodes driving the board", len(DEMO_NAMES))
    return session, net, extra


def _bench_volume(value: str) -> int:
    """argparse type for `--bench-volume`: an integer 0-100."""
    try:
        n = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError(f"must be an integer 0-100, got {value!r}")
    if not 0 <= n <= 100:
        raise argparse.ArgumentTypeError(f"must be 0-100, got {n}")
    return n


def parser() -> argparse.ArgumentParser:
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
    ap.add_argument("--tunnel", action="store_true",
                    help="A28: expose the NODE socket (never the API) through a cloudflared quick tunnel at boot")
    ap.add_argument("--public-url", default=None,
                    help="A28: a public wss:// node URL you already run (named tunnel, Tailscale Funnel, port "
                     "forward). provider: manual — MC hands it out but never starts or stops it")
    ap.add_argument("--evidence-dir", default=None,
                    help="write this launch's SQLite session store under the supplied evidence directory")
    ap.add_argument("--advertise", default=None,
                    help="T3-A: put THIS address in the QR/mDNS instead of the one MC auto-detects, without "
                         "moving where it binds (WSL2's own NAT address is what MC auto-detects, and it is "
                         "not reachable from a phone — pass the Windows LAN address here, from ipconfig)")
    ap.add_argument("--bench-volume", nargs="?", type=_bench_volume, default=None, metavar="N",
                    const=55,
                    help="bench run: every $VOL MC compiles (match heads, try-outs) plays at N "
                         "(default 55) instead of the venue volume. Not for a real game")
    ap.add_argument("-v", "--verbose", action="store_true")
    return ap


def main(argv=None):
    args = parser().parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    session, net, extra = build(args)
    token = None if args.no_auth else (args.token or os.environ.get("BRX_MC_TOKEN") or secrets.token_urlsafe(6))
    from .api import create_app
    app = create_app(session, extra_tasks=extra, token=token)
    import uvicorn
    ip = session.lan["ip"]
    url = f"http://{ip}:{args.port}/" + (f"#tok={token}" if token else "")
    print(f"Mission Control  {url}", flush=True)
    if args.bench_volume is not None:
        _rule = "!" * 78
        print(_rule, flush=True)
        print(f"  BENCH VOLUME {args.bench_volume}: not for a real game (every $VOL MC writes, try-outs too)", flush=True)
        print(_rule, flush=True)
    if not inspect.iscoroutinefunction(getattr(net, "start", None)):
        # sync/fake net is already bound → its ws_url is real now. The async NetServer prints the nodes
        # line from _start_net once it binds (avoids the stale ws://<ip>:0 placeholder before the bind).
        print(f"  nodes: {session.lan.get('ws_url') or 'ws://'+ip+':'+str(args.ws_port)+'/ws'}", flush=True)
    pub = session.lan.get("public") or {}
    if pub.get("status") == "up":
        print(f"  public nodes: {pub['ws_url']}   (provider: {pub.get('provider')})", flush=True)
    if token:
        print(f"  operator token: {token}   (open the URL above — it carries the token; --no-auth to disable)", flush=True)
    else:
        print("  auth DISABLED (--no-auth): any device on this LAN can control the match", flush=True)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
