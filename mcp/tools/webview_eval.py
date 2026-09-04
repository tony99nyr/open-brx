"""Run JavaScript inside the BRX app's WebView on a connected Android phone (the wireless-debug loop).

The app is built with `webContentsDebuggingEnabled`, so its WebView exposes Chrome DevTools. This
tool forwards that socket over adb, picks the page, and evaluates one expression there (awaiting a
promise if it returns one), printing the JSON result. No screen taps, no guessing coordinates:
`window.brx` (HUD) and `window.brxUtility` (utility mode) are the app's own debug handles.

Runs under the Windows venv: adb's port forward binds Windows localhost, which WSL cannot reach.

Usage: python webview_eval.py <js expression> [--serial 192.168.0.48:42183] [--pkg com.openbrx.companion]
  e.g.  python webview_eval.py "window.brx.engine.phase"
        python webview_eval.py "window.brx.switchRole('utility')"
        python webview_eval.py "window.brxUtility.settings"
        python webview_eval.py "window.brxUtility.log.slice(-8)"
"""
import asyncio
import json
import subprocess
import sys
import urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # Windows cp1252 chokes on log arrows etc.
except Exception:
    pass

ADB = r"C:\Users\Tony\platform-tools\adb.exe"
PORT = 9222


def adb(serial, *args):
    return subprocess.run([ADB, "-s", serial, *args], capture_output=True, text=True, timeout=20).stdout.strip()


def forward(serial, pkg):
    pid = adb(serial, "shell", "pidof", pkg)
    if not pid:
        raise SystemExit(f"{pkg} is not running on {serial}")
    adb(serial, "forward", "--remove-all")
    adb(serial, "forward", f"tcp:{PORT}", f"localabstract:webview_devtools_remote_{pid}")
    return pid


def pages():
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=5) as r:
        return json.load(r)


async def evaluate(ws_url, expr):
    import websockets
    async with websockets.connect(ws_url, max_size=16 * 1024 * 1024) as ws:
        await ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate",
                                  "params": {"expression": expr, "awaitPromise": True, "returnByValue": True}}))
        while True:
            msg = json.loads(await ws.recv())
            if msg.get("id") == 1:
                return msg


def main():
    args = sys.argv[1:]
    if not args:
        raise SystemExit(__doc__)
    serial = "192.168.0.48:42183"
    pkg = "com.openbrx.companion"
    expr_parts = []
    i = 0
    while i < len(args):
        if args[i] == "--serial":
            serial = args[i + 1]; i += 2
        elif args[i] == "--pkg":
            pkg = args[i + 1]; i += 2
        else:
            expr_parts.append(args[i]); i += 1
    expr = " ".join(expr_parts)
    forward(serial, pkg)
    pg = [p for p in pages() if p.get("type") == "page"]
    if not pg:
        raise SystemExit("no page in the WebView")
    page = pg[0]
    res = asyncio.run(evaluate(page["webSocketDebuggerUrl"], expr))
    if "error" in res:
        print("ERROR", json.dumps(res["error"]))
        return
    r = res.get("result", {})
    if r.get("exceptionDetails"):
        print("EXCEPTION", json.dumps(r["exceptionDetails"].get("exception", {}).get("description", r["exceptionDetails"]))[:800])
        return
    v = r.get("result", {})
    print(json.dumps(v.get("value", v.get("description")), indent=1, ensure_ascii=False))
    print(f"# page: {page.get('title')} {page.get('url')}", file=sys.stderr)


if __name__ == "__main__":
    main()
