"""python -m brx_mcp.mc — run Mission Control (HTTP API + UI + node WebSocket server)."""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import inspect
import json
import logging
import os
import secrets
import socket
import signal
import sys
from typing import NoReturn

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


def _scratch_maker():
    """OP10: one throwaway folder per BUILD (per --demo/--ephemeral MC), holding the tunnel pidfile, the store, the pieces
    and the favourites in subfolders. Each used to be its own `mkdtemp` that nothing removed (44,461 `brx-mc-*` folders on
    the dev box). The server's shutdown removes it (api.py lifespan, which SIGTERM still runs); atexit is the backup.
    Per build, not per module (Codex r1): two builds in one interpreter must never share or delete each other's."""
    import atexit
    import shutil
    import tempfile
    from pathlib import Path
    root: list[str] = []

    def scratch(sub: str) -> Path:
        if not root:
            root.append(tempfile.mkdtemp(prefix="brx-mc-"))
            atexit.register(shutil.rmtree, root[0], True)
        d = Path(root[0]) / sub
        d.mkdir(parents=True, exist_ok=True)
        return d
    return scratch, root


def _cannot_build(what: str, e: BaseException) -> NoReturn:
    print(f"Mission Control cannot start: {what} failed to load ({type(e).__name__}: {e}). A real run never falls "
          f"back to the demo's fakes; reinstall (./start.sh sets it up) and start again.", file=sys.stderr, flush=True)
    raise SystemExit(2) from None


def build(args):
    _scratch, _scratch_root = _scratch_maker()   # OP10
    try:   # fakes and state import compile.py at load, so a broken compile.py fails HERE first (Codex r1)
        from .fakes import DemoDriver, FakeArmory, FakeNet, demo_armory, DEMO_NAMES
        from .state import Session
        from .store import Store
    except Exception as e:
        _cannot_build("Mission Control's modules (compile.py or state.py)", e)

    bench_volume = getattr(args, "bench_volume", None)
    capture_row_fn = getattr(args, "bench_capture_row", None)   # F312
    distinct_cells = bool(getattr(args, "distinct_weapon_cells", False))   # F315
    # DRY review H1 (2026-10-10): the fakes stand in only where the operator asked for one. A real MC used to fall back
    # to FakeCompiler on any import or build error, and its try-out frames (no $START, no $TID, a placeholder $WEAP)
    # could reach a real tagger with only a log line to say so. Now no run builds without the real compiler, and a
    # real run (not --demo, not --fake-net) that cannot build the real net exits 2.
    try:
        from .compile import Compiler as RealCompiler  # M-MODES lane
        compiler = RealCompiler(bench_volume=bench_volume, capture_row_fn=capture_row_fn,
                                distinct_weapon_cells=distinct_cells)
        log.info("compiler: real M-MODES compiler")
    except Exception as e:     # --demo too: its roster carries real weapons the fake compiler does not know
        _cannot_build("the game compiler (compile.py)", e)

    if args.fake_net:
        net = FakeNet()
    else:
        try:
            from .net import NetServer as RealNet  # M-NET lane
            net = RealNet()
            log.info("net: real M-NET WebSocket server")
        except Exception as e:
            if not args.demo:
                _cannot_build("the phone network (net.py)", e)
            log.warning("net: FAKE in-memory for --demo (net.py not available: %s)", e)
            net = FakeNet()
        # A60: the install identity persists next to session.json; demo/ephemeral keep the in-memory one NetServer
        # starts with. Its own refusal, so a bad trust file is not reported as a broken net.py (DRY H1 review).
        if not isinstance(net, FakeNet) and not (args.demo or getattr(args, "ephemeral", False)):
            from ..storage import home_dir as _home
            try:
                from .mcid import TrustRegistry
                net.trust = TrustRegistry(_home())
            except Exception as e:
                _cannot_build(f"the install identity (mc-install-secret, mc-trust-enrolled.txt in {_home()})", e)
    fake_net = isinstance(net, FakeNet)

    # brx5's landed-late review (High): a real run fell back to the demo armory on ANY armory error, marked
    # itself demo, and its first write replaced the real session.json. LocalArmory needs no radio (bleak is
    # imported only by a scan), so a failure here is a broken install, refused like the compiler and the net.
    if args.demo:
        armory = FakeArmory(demo_armory())
    else:
        try:
            from .armory import LocalArmory
            armory = LocalArmory()
        except Exception as e:
            _cannot_build("the armory (armory.py)", e)

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
    # A56 (S58, F372): powerups are ON by default. --no-powerups is the opt-out; a stored item then
    # refuses, compiles no spare slot and sends no item. `--powerups` is kept as a no-op for old commands.
    session.powerups_enabled = not bool(getattr(args, "no_powerups", False))
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
        pid_dir = _scratch("tunnel")
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
    session.demo_session = bool(args.demo)
    if session.demo_session:
        print("  session: DEMO (--demo) — it will not be restored into, or persisted for, a real run", flush=True)
    restored_from_file = 0
    if getattr(args, "session_file", None):
        # explicit session file (e2e boots from a fixture, e.g. a pre-A10 snapshot). With --demo it is used only if it
        # is a demo snapshot: a demo run never restores, saves over or deletes a real one (snapshot_codec).
        from pathlib import Path as _P
        session._persist_path = _P(args.session_file)
        restored_from_file = session.restore_snapshot()
        print(f"  session file {args.session_file}: {restored_from_file} player(s) restored")
        if session.restore_failed:
            rf = session.restore_failed
            print(f"  session file could NOT be restored ({rf['reason']}); "
                  f"{'kept at ' + rf['kept'] if rf['kept'] else 'it could not be moved aside, saving is OFF'}", flush=True)
        elif session.demo_session and session.snapshot_codec._holds_real_session(session._persist_path):
            print(f"  session file {args.session_file} is not a demo snapshot: this demo run will not restore, save over "
                  f"or delete it", flush=True)
    elif not (args.demo or getattr(args, "ephemeral", False)):
        # --demo / --ephemeral runs (e2e, CI) must not inherit or write a bench session:
        # a restored roster with a bare-tail gun_id once stole the e2e fake gun (2026-08-26).
        session._persist_path = home_dir() / "session.json"
        import atexit
        atexit.register(session.persist_now)         # flush the debounced final write on exit
        # OP11: prune old session stores in mc/ (evidence.mjs's rule), never the one this snapshot's match resumes from
        try:
            _snap = json.loads(session._persist_path.read_text(encoding="utf-8"))
            _resumes = (_snap.get("match") or {}).get("store_path") if isinstance(_snap, dict) else None
        except (OSError, ValueError, AttributeError):
            _resumes = None
        from .store import prune_session_stores
        _gone = prune_session_stores(protect={_resumes} if isinstance(_resumes, str) else ())
        if _gone:
            log.info("pruned %d old session store file(s) from %s", len(_gone), home_dir() / "mc")
        restored = session.restore_snapshot()
        if restored:
            print(f"  session restored: {restored} player(s) from the last run (NEW MATCH > fresh session clears it)")
        elif session.restore_failed:
            rf = session.restore_failed
            print(f"  session file could NOT be restored ({rf['reason']}); "
                  f"{'kept at ' + rf['kept'] if rf['kept'] else 'it could not be moved aside, saving is OFF'}", flush=True)
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
            bind = _ws_bind_host(args.host)
            await real_net.start(bind, args.ws_port, "/ws", advertise_host=ip)
            # join info FIRST — it fills lan.ws_url with the REAL bound port. The mDNS advert below is
            # best-effort and once HUNG in a sandboxed netns, leaving ws_url at port 0: every phone that
            # trusted the JOIN strip then dialed ws://…:0/ws (e2e, 2026-08-26).
            # A28.2: `qr` is DERIVED (secret, and the public URL when the tunnel is up) -- set the
            # bare URL and let the session render it, or the join strip loses the join secret.
            # O8: a failure is logged and shown on the console by the session; a later success clears it.
            session.refresh_join_info(real_net, ws_url)
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
        # Session construction attaches the net before a synchronous transport has started, so its
        # initial join_info() still contains the pre-bind host/port (notably 0.0.0.0:0 on FakeNet).
        # Refresh the bare URL now that the transport owns its real advertised endpoint; set_ws_url
        # also re-derives the QR and keeps the join secret in sync.
        session.refresh_join_info(net, ws_url)   # O8: logged and shown on the console on failure, cleared on success
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
        # path -- unlike the pieces shelf and the tunnel pidfile above, which already fall back to a
        # throwaway tempdir. Give the store the same fallback.
        if (args.demo or getattr(args, "ephemeral", False)) and not os.environ.get("BRX_MCP_HOME"):
            store_path = _scratch("store") / f"session-{session.session_id}.sqlite"
            session.store = Store(session.session_id, store_path)
        else:
            session.store = Store(session.session_id, _PT(args.evidence_dir) / "session.sqlite" if getattr(args, "evidence_dir", None) else None)
        if getattr(args, "evidence_dir", None):
            evidence_path = _PT(args.evidence_dir)
            evidence_path.mkdir(parents=True, exist_ok=True)
            (evidence_path / "mc-session.json").write_text(json.dumps({
                "format": 1, "launch_id": os.environ.get("BRX_MC_LAUNCH_ID"), "session_id": session.session_id,
                # the store MC really opened: a --demo/--ephemeral run keeps it in a temp folder (review 2026-10-10)
                "sqlite": str(getattr(session.store, "path", evidence_path / "session.sqlite")),
            }, indent=2) + "\n", encoding="utf-8")
            (evidence_path / "mc-session.json").chmod(0o600)
        # The api lifespan closes the store on an orderly shutdown; atexit covers a path that skips
        # the lifespan (an exception out of uvicorn.run). `Store.close` is idempotent.
        if session.store is not None:
            import atexit
            atexit.register(session.store.close)
    except Exception as e:
        log.warning("store disabled: %s", e)
        if getattr(args, "evidence_dir", None):
            raise RuntimeError(f"requested evidence store is unavailable: {e}") from e

    # Bench 2026-09-17: a match that was in play when the last process stopped resumes now, with the store
    # attached, so its recap is rebuilt from the facts the phones already sent.
    resumed = session.resume_match()
    if resumed:
        print(f"  match resumed: {resumed.upper()} (the snapshot named a match in play)", flush=True)
    if getattr(getattr(net, "trust", None), "identity_created", False):
        session.note_new_identity()      # F552: after the restore, so the line is not replaced by the saved feed
        print(f"  {Session.NEW_IDENTITY_LINE}", flush=True)

    # F411 BUILD pieces: the real shelf lives next to armory.json; --demo/--ephemeral get a throwaway copy
    # so demo NEW ▸ never lands in (or wipes) the host's real pieces.json
    from .pieces import PieceStore, default_path
    if args.demo or getattr(args, "ephemeral", False):
        ppath = _scratch("pieces") / "pieces.json"
        log.info("pieces: throwaway shelf at %s (demo/ephemeral)", ppath)
    else:
        ppath = default_path()
    session.attach_pieces(PieceStore(ppath, now_ms=session.now_ms))   # M1: also reconciles a stale/restored game_pick

    # F411 §6 FAVOURITES: same real-shelf-vs-throwaway-demo split as BUILD pieces above.
    from .favourites import FavouriteStore, default_path as _fav_default_path
    if args.demo or getattr(args, "ephemeral", False):
        fpath = _scratch("favourites") / "favourites.json"
        log.info("favourites: throwaway shelf at %s (demo/ephemeral)", fpath)
    else:
        fpath = _fav_default_path()
    session.favourites = FavouriteStore(fpath, now_ms=session.now_ms)
    # DRY H2 review: a store whose bad file could not be moved aside has stopped saving (load_versioned logged why);
    # say so where the operator looks, as the session snapshot does, or a preset made today vanishes at the restart.
    for label, store, path in (("pieces", session.pieces, ppath), ("favourites", session.favourites, fpath)):
        if store is not None and store.path is None:
            print(f"  {label} file {path} could NOT be read or moved aside: saving {label} is OFF for this run", flush=True)
    session.scratch_dir = _scratch_root[0] if _scratch_root else None   # OP10: the lifespan removes it on shutdown

    if args.demo and not restored_from_file:   # a restored session keeps its roster; demo seeding would re-add GUN-A..H (e2e lane finding)
        session.set_config({"mode": "tdm"})
        # A10 demo loadouts: a secondary weapon, a perk, an empty slot 2, and different primaries, so the
        # Kit page shows every slot-2 state without anyone typing (docs/spec/loadout.md §5)
        demo_loadouts = [
            {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "shotgun"}]},
            {"weapons": [{"weapon_id": "smg"}], "perk": "body_armor"},
            {"weapons": [{"weapon_id": "burst_rifle"}]},
            {"weapons": [{"weapon_id": "sniper_rifle"}], "perk": "extended_mags"},
            {"weapons": [{"weapon_id": "amr"}, {"weapon_id": "energy_rifle"}]},
            {"weapons": [{"weapon_id": "suppressor"}], "perk": "armor_piercing"},   # S50: easy_reload left the perk slot
            {"weapons": [{"weapon_id": "charge_rifle"}]},
            {"weapons": [{"weapon_id": "suppressor"}, {"weapon_id": "deagle"}], "perk": "quick_switch"},   # A14: all three slots
        ]
        for i, name in enumerate(DEMO_NAMES):
            # F413: TDM's own default teams (red + blue) -- was blue/yellow before every team mode
            # defaulted to red+blue.
            session.add_player(name, team_id="red" if i % 2 == 0 else "blue", gun_id=f"GUN-{chr(65 + i)}",
                               loadout=demo_loadouts[i % len(demo_loadouts)])
        # `fake_net` means exactly this; the isinstance keeps the type narrowed for `DemoDriver` too.
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
    ap.add_argument("--demo-speed", type=float, default=1.0,
                    help="with --demo --fake-net: run the simulated phones this many times faster")
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
                    const=65,
                    help="bench run: every $VOL MC compiles (match heads, try-outs) plays at N "
                         "(default 65) instead of the venue volume. Not for a real game")
    ap.add_argument("--bench-capture-row", type=int, choices=[28, 34], default=None, metavar="FN",
                    help="bench run (F312): the $SIR <15,0> row's function in every live table. 34 is the "
                         "team-blind candidate under bench test (bench-2026-09-24 Block 7 step 8); 28 is the "
                         "shipped row. Not for a real game until the bench confirms it")
    ap.add_argument("--distinct-weapon-cells", action="store_true",
                    help="bench run (F315): a weapon that shares an IR cell and a magnitude with another in the "
                         "match moves to a free cell of its own protocol (today <0,2>) with a plain-damage $SIR "
                         "row, so a victim's phone can name it. Not for a real game until a bench step proves a "
                         "<0,2> word registers")
    ap.add_argument("--powerups", action="store_true",
                    help="A56 (S58): no-op. Powerup stations (Rockets, Rail Gun, Overshield) are ON by default "
                         "(F372, Tony 2026-09-25); this flag is kept so an old command line still works, and prints a note "
                         "saying so")
    ap.add_argument("--no-powerups", action="store_true",
                    help="A56 (S58, F372): turn OFF powerup stations (Rockets, Rail Gun, Overshield)")
    ap.add_argument("-v", "--verbose", action="store_true")
    return ap


def _ws_bind_host(host: str) -> str:
    """Bind every interface for the node socket, advertise the LAN address (the cloudflared origin is 127.0.0.1)."""
    return host if host not in ("0.0.0.0", "") else "0.0.0.0"


def probe_port_or_exit(host: str, port: int, flag: str) -> None:
    """The node socket (--ws-port) before the banner (brx4's field report: a busy one failed inside a lifespan task, so MC
    served HTTP with no node socket and no phone could join). It test-binds EVERY address the host resolves to, then
    releases them, so the server's own bind keeps its exact old shape (both stacks for a dual-stack name; Codex r1: a
    pre-bound single socket covered only the first address). Port 0 asks for nothing to probe."""
    if port == 0:
        return
    seen, held = set(), []
    try:
        for family, _t, _p, _c, addr in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM, flags=socket.AI_PASSIVE):
            if (family, addr) in seen:
                continue
            seen.add((family, addr))
            s = socket.socket(family, socket.SOCK_STREAM)
            held.append(s)
            if os.name != "nt":
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if family == socket.AF_INET6 and hasattr(socket, "IPV6_V6ONLY"):
                s.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)   # as asyncio's create_server does
            s.bind(addr)
    except OSError as e:
        print(f"Mission Control could not bind {host}:{port} ({e.strerror or e}). Something else owns that port: "
              f"stop it, or start MC with {flag} <another>.", file=sys.stderr, flush=True)
        raise SystemExit(2)
    finally:
        for s in held:
            with contextlib.suppress(OSError):
                s.close()


def bind_http_or_exit(host: str, port: int, flag: str = "--port") -> socket.socket:
    """F108: bind MC's HTTP socket BEFORE the banner. The node socket (--ws-port) takes the same path (brx4's field
    report: a busy --ws-port failed inside a lifespan task, so MC served HTTP with no node socket and no phone could join).
    It binds the FIRST address getaddrinfo gives (the default 0.0.0.0 is every IPv4 interface). The banner used to print first, so a launch onto a busy
    port showed "Mission Control http://..." and only then "[Errno 98] address already in use", and every
    check after that was answered by whatever already held the port. Binding first means a busy port exits
    non-zero with one clear line, and uvicorn is handed this very socket, so there is no second bind to race."""
    try:
        family, _t, _p, _c, addr = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM, flags=socket.AI_PASSIVE)[0]
        sock = socket.socket(family, socket.SOCK_STREAM)
        if os.name != "nt":   # as asyncio does on POSIX only: on Windows SO_REUSEADDR lets a second MC share a LISTENING port
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)   # a TIME_WAIT is not a squatter
        sock.bind(addr)
        sock.listen(2048)
    except OSError as e:
        print(f"Mission Control could not bind {host}:{port} ({e.strerror or e}). Something else owns that port: "
              f"stop it, or start MC with {flag} <another>.", file=sys.stderr, flush=True)
        raise SystemExit(2)
    sock.set_inheritable(True)
    return sock


def needs_home_lock(args) -> bool:
    """OP1: only an MC that persists into the home folder takes it. --demo and --ephemeral write a throwaway tree."""
    return not (args.demo or getattr(args, "ephemeral", False))


_HOME_LOCK = None   # OP1 r3: the mc.lock handle, held until the process ends (after the atexit snapshot write)


def hold_home_lock(home, port: int) -> None:
    """OP1 r3: take the home lock for the life of the PROCESS. A local in `main()` was dropped when uvicorn returned,
    which freed the lock before the atexit `persist_now` wrote session.json."""
    global _HOME_LOCK
    _HOME_LOCK = lock_home_or_exit(home, port)


def mark_home_stopping(port: int) -> None:
    """Round 2 L3 (2026-10-10): the server's shutdown says it is stopping, in mc.lock.info. It keeps the lock until the
    process exits (the tunnel's stop and the atexit flush can still write session.json), and a relaunch that finds a
    STOPPING holder waits for it instead of exiting 2 at once."""
    from ..storage import home_dir
    if _HOME_LOCK is not None or _PID_FILE is not None:
        _write_lock_info(home_dir(), port, stopping=True)


def _pid_alive(pid: object) -> bool:
    """Is `pid` a running process on this machine? Never signals it (os.kill(pid, 0) TERMINATES a process on Windows)."""
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.OpenProcess.restype = wintypes.HANDLE
        k32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        h = k32.OpenProcess(0x1000, False, pid)   # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return ctypes.get_last_error() == 5   # ERROR_ACCESS_DENIED: it exists, we may not look at it
        try:
            code = ctypes.c_ulong()
            return bool(k32.GetExitCodeProcess(h, ctypes.byref(code))) and code.value == 259   # STILL_ACTIVE
        finally:
            k32.CloseHandle(h)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True             # it exists, owned by someone else
    return True


STOPPING_WAIT_S = 15.0   # round 2 L3: how long a relaunch waits for a STOPPING holder (its shutdown takes about 10 s)


def lock_home_or_exit(home, port: int, wait_s: float = STOPPING_WAIT_S):
    """OP1 (maintainability review 2026-10-10, Critical): one Mission Control per home folder. Two MCs on one laptop
    shared `~/.brx-mcp` and overwrote each other's session.json, pieces.json and favourites.json with no warning. Takes
    an exclusive, non-blocking lock on `<home>/mc.lock` (flock on macOS and Linux, msvcrt on Windows, as the armory
    lock in `usbconsole.py` does) and returns the open handle, which the caller keeps for the life of the process: the
    OS frees the lock when the process exits, a crash included. The owner's pid and port go to `mc.lock.info` (a
    separate file: on Windows a locked byte cannot be read by another process). A second MC exits 2, naming the first.

    Round 2 L1: a filesystem with no locking at all (NFS, some SMB or FUSE mounts) used to make MC exit 2. It now falls
    back to an exclusively created `mc.lock.pid` (a live other pid is still refused) with a loud warning. A lock is per OS: a WSL
    MC and a Windows MC cannot see each other's lock on one /mnt/c folder, so never point both at one BRX_MCP_HOME."""
    from pathlib import Path
    home = Path(home)
    try:
        home.mkdir(parents=True, exist_ok=True)
        fh = open(home / "mc.lock", "a+")
    except OSError as e:   # OP1 review: a read-only or broken home is a clean exit 2, not a traceback
        print(f"Mission Control could not lock {home / 'mc.lock'}: {e.strerror or e}.", file=sys.stderr, flush=True)
        raise SystemExit(2) from None
    import errno
    import time
    deadline = time.monotonic() + wait_s
    waited = False
    while True:
        try:
            if sys.platform == "win32":
                import msvcrt
                fh.seek(0)
                msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except OSError as e:
            unsupported = {getattr(errno, n) for n in ("ENOLCK", "EOPNOTSUPP", "ENOTSUP", "ENOSYS") if hasattr(errno, n)}
            if e.errno in unsupported:
                fh.close()
                return _pid_file_lock(home, port, wait_s)
            owner = _read_owner(home)
            # flock reports a held lock as EWOULDBLOCK/EAGAIN; msvcrt's LK_NBLCK as EACCES. A POSIX EACCES is a holder
            # only when a live owner is on record (round 2: Python documents it for a held lock on some systems; OP1 r2:
            # elsewhere it is a security policy). Anything else is not another Mission Control and names no owner.
            held = ({errno.EACCES} if sys.platform == "win32" else {errno.EWOULDBLOCK, errno.EAGAIN})
            if e.errno not in held and not (e.errno == errno.EACCES and _pid_alive(owner.get("pid"))):
                fh.close()
                print(f"Mission Control could not lock {home / 'mc.lock'}: {e.strerror or e}.", file=sys.stderr, flush=True)
                raise SystemExit(2) from None
            if owner.get("stopping") and time.monotonic() < deadline:
                waited = _say_waiting(owner, waited)   # round 2 L3: the holder is shutting down; its lock goes at exit
                time.sleep(0.25)
                continue
            fh.close()
            _refuse(home, owner, stuck=bool(owner.get("stopping")))
    _write_lock_info(home, port)
    return fh


def _write_lock_info(home, port: int, *, stopping: bool = False) -> None:
    from ..storage import atomic_write_text
    info = {"pid": os.getpid(), "port": port, **({"stopping": True} if stopping else {})}
    try:   # the owner's name for a refused second MC; on Windows a reader can briefly hold the file, so never fatal
        atomic_write_text(home / "mc.lock.info", json.dumps(info))
    except OSError:
        pass


def _read_owner(home) -> dict:
    try:
        owner = json.loads((home / "mc.lock.info").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return owner if isinstance(owner, dict) else {}


_PID_FILE = None   # the pid file this process created, in the no-locking fallback


def _say_waiting(owner: dict, waited: bool) -> bool:
    if not waited:
        print(f"Waiting for the Mission Control that is stopping (pid {owner.get('pid')}) to exit...", file=sys.stderr, flush=True)
    return True


def _refuse(home, owner: dict, *, stuck: bool = False, pid_file=None) -> NoReturn:
    who = f"pid {owner.get('pid')}, port {owner.get('port')}" if owner.get("pid") else "pid unknown"
    what = f"is still stopping after {int(STOPPING_WAIT_S)} s" if stuck else "owns"
    hint = (f" If no Mission Control is running, delete {pid_file}." if pid_file is not None else "")
    print(f"Another Mission Control ({who}) {what} {home}: stop it, or start this one with --ephemeral or "
          f"BRX_MCP_HOME=<another folder>.{hint}", file=sys.stderr, flush=True)
    raise SystemExit(2) from None


_PID_FILE = None   # the pid file this process created, in the no-locking fallback


def _pid_file_lock(home, port: int, wait_s: float = STOPPING_WAIT_S):
    """Round 2 L1: the home's filesystem cannot lock. `mc.lock.pid` is put in place with a hard link from a finished
    temp file (atomic, content included, and exclusive: a link onto an existing name fails), so two launches cannot
    both take it and nobody ever reads it half written. One naming a live other process refuses (or, if that process
    is stopping, is waited for as with the OS lock); a dead one's is removed and taken. Weaker than the OS lock (a
    reused pid reads as alive, and a stop by signal can leave the file), so MC says so, and the refusal names the file."""
    global _PID_FILE
    import atexit
    import time
    pidf = home / "mc.lock.pid"
    deadline = time.monotonic() + wait_s
    waited = False
    tmp = home / f"mc.lock.pid.{os.getpid()}.tmp"
    try:
        tmp.write_text(json.dumps({"pid": os.getpid(), "port": port}), encoding="utf-8")
    except OSError as e:
        print(f"Mission Control could not write {tmp}: {e.strerror or e}.", file=sys.stderr, flush=True)
        raise SystemExit(2) from None
    try:
        while True:
            try:
                os.link(tmp, pidf)
                break
            except FileExistsError:
                pass
            except OSError as e:
                print(f"Mission Control could not lock {pidf}: {e.strerror or e}.", file=sys.stderr, flush=True)
                raise SystemExit(2) from None
            try:
                owner = json.loads(pidf.read_text(encoding="utf-8"))
            except FileNotFoundError:
                continue          # its owner just removed it: try again
            except (OSError, ValueError):
                owner = None      # unreadable is not "dead": refuse rather than take it over
            if not isinstance(owner, dict):
                _refuse(home, {}, pid_file=pidf)
            pid = owner.get("pid")
            if _pid_alive(pid) and pid != os.getpid():
                info = _read_owner(home)
                if info.get("pid") == pid and info.get("stopping") and time.monotonic() < deadline:
                    waited = _say_waiting(info, waited)
                    time.sleep(0.25)
                    continue
                _refuse(home, owner, stuck=bool(info.get("pid") == pid and info.get("stopping")), pid_file=pidf)
            with contextlib.suppress(OSError):
                pidf.unlink()     # a dead owner's: take it on the next pass
    finally:
        with contextlib.suppress(OSError):
            tmp.unlink()
    _PID_FILE = pidf

    def _drop():
        with contextlib.suppress(OSError, ValueError):
            if json.loads(pidf.read_text(encoding="utf-8")).get("pid") == os.getpid():
                pidf.unlink()
    atexit.register(_drop)
    print(f"WARNING: {home} is on a filesystem that cannot lock files, so Mission Control falls back to a pid file. "
          f"Do not start a second MC on this folder from another machine or OS.", file=sys.stderr, flush=True)
    _write_lock_info(home, port)
    return None


# O4: a timestamp with milliseconds, so mc.log lines up with the SQLite t_recv column and a phone log.
LOG_FORMAT = "%(asctime)s.%(msecs)03d %(levelname)s %(name)s: %(message)s"
LOG_DATEFMT = "%Y-%m-%d %H:%M:%S"


def main(argv=None):
    args = parser().parse_args(argv)
    if args.powerups:   # L1 (2026-10-10): a no-op since F372; say so, so a host drops it rather than keep a shim forever
        print("  note: --powerups does nothing (powerups are on by default); drop it from your command", flush=True)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format=LOG_FORMAT, datefmt=LOG_DATEFMT)

    http_sock = bind_http_or_exit(args.host, args.port)   # F108: before build() and before any banner
    # ...and the node socket, which a phone needs to join at all (it bound inside a lifespan task, whose failure left a
    # running MC no phone could reach). --fake-net has none.
    if not args.fake_net:
        probe_port_or_exit(_ws_bind_host(args.host), args.ws_port, "--ws-port")
    if needs_home_lock(args):   # OP1: before build() restores or writes anything in the home folder
        from ..storage import home_dir
        hold_home_lock(home_dir(), http_sock.getsockname()[1])
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
    if args.bench_capture_row is not None:
        _rule = "!" * 78
        print(_rule, flush=True)
        print(f"  BENCH CAPTURE ROW fn {args.bench_capture_row}: the <15,0> row every gun gets (F312). Not for a real game", flush=True)
        print(_rule, flush=True)
    if args.distinct_weapon_cells:
        _rule = "!" * 78
        print(_rule, flush=True)
        print("  DISTINCT WEAPON CELLS: same-cell, same-magnitude weapons move to a free cell (F315). Not for a real game", flush=True)
        print(_rule, flush=True)
    if not session.powerups_enabled:
        print("  POWERUPS OFF (--no-powerups): powerup stations will not carry an item", flush=True)
    from . import keepawake
    keepawake.start(ephemeral=args.ephemeral)   # F595: macOS only; the Mac must not sleep through a whistle
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
    server = uvicorn.Server(uvicorn.Config(app, log_level="warning"))
    app.state.request_shutdown = lambda: setattr(server, "should_exit", True)   # POST /api/shutdown (the launcher)
    app.state.mark_home_stopping = lambda: mark_home_stopping(http_sock.getsockname()[1])   # round 2 L3
    # A closed terminal sends SIGHUP to the whole process group, and Python's default action killed MC at once, so the
    # lifespan never wrote the snapshot. Treat it like SIGTERM (uvicorn handles only SIGINT and SIGTERM). Windows has no
    # SIGHUP; a closed console there still ends the process at once (brx2's launcher review, 2026-10-10).
    # An inherited SIG_IGN (`nohup python -m brx_mcp.mc`, the bench runbooks' `setsid nohup`) means "keep running": it
    # stays (Codex r1). Started through the Node launcher, MC inherits the default instead (libuv resets it).
    if hasattr(signal, "SIGHUP") and signal.getsignal(signal.SIGHUP) is not signal.SIG_IGN:
        signal.signal(signal.SIGHUP, lambda *_: setattr(server, "should_exit", True))
    server.run(sockets=[http_sock])


if __name__ == "__main__":
    main()
