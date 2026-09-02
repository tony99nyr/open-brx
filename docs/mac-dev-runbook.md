# Mac dev runbook

Everything a fresh agent needs to work on the MacBook — the setup that is not in git, the
change-to-screen loop, and how to read a session store. Written 2026-09-02 after a long UI/field
session in which several hours went on problems that are all listed here.

The MATCH-DAY guide is [`field-runbook-mc.md`](field-runbook-mc.md). This is the DEVELOPMENT one.

---

## 1. First-time setup (none of this is in git)

```bash
# python — the venv exists but ships without the MC server's deps
.venv/bin/pip install -e ./mcp websockets starlette uvicorn zeroconf httpx
#                                                                    ^^^^^ or 19 API tests skip silently

cd webapp/mc && npm install     # the MC console — no node_modules in git
cd app        && npm install    # the phone HUD + the browser e2e
npx playwright install chromium # the e2e needs the browser, separately
cd site       && npm install    # only if you touch the public website
```

**`~/.brx-mcp/armory.json` is NOT in git and never will be** — it is keyed on the headset
serial/PIN (`CLAUDE.md` hard rule). Copy it from the Windows machine
(`C:\Users\Tony\.brx-mcp\armory.json`). Without it the ARMORY board shows bare BLE tails instead of
stickers and the KNOWN GUNS section is empty. It is re-read per request, so no restart is needed.

## 2. The change-to-screen loop — READ THIS ONE

This cost the most time in the session that produced this file, three separate times, and twice
the operator sent a screenshot of a stale build that I then tried to explain.

| you changed | to see it |
|---|---|
| **Python** (`mcp/`) | **restart MC** — the editable install does not hot-reload |
| **MC console** (`webapp/mc/src`) | `npm run build`, then **hard-reload** (`Cmd-Shift-R`) |
| **Phone HUD** (`app/src`) | `npm run build` — and the phone needs a **new APK** |

The console's JS filename is content-hashed, so a normal reload can keep serving the old
`index.html` and therefore the old bundle. **Always hard-reload.**

**Two tells that you are looking at a stale build**, both seen for real:
- the amber banner *"the MC server predates this UI"* → the **server** is old, restart it;
- the UI shows a control you just removed → the **page** is old, hard-reload it.

Confirm rather than assume — these should match:
```bash
curl -s http://127.0.0.1:8765/ | grep -o 'index-[A-Za-z0-9_-]*\.js'
ls -t webapp/mc/dist/assets/*.js | head -1 | xargs basename
```

**Start MC with a redirect, not a pipe.** `| tee` does not survive as a long-running background
process here (it died twice); `>` is fine:
```bash
.venv/bin/python -m brx_mcp.mc -v > ~/mc-$(date +%Y%m%d-%H%M).log 2>&1 &
```
Every restart mints a **new operator token** and prints it in that log. Read it back with:
```bash
ls -t ~/mc-*.log | head -1 | xargs grep -E "Mission Control|nodes:"
```

## 3. Test suites, and their two traps

```bash
cd mcp       && ../.venv/bin/python run_tests.py   # ~585
cd webapp/mc && npm test                           # ~69, vitest + jsdom
cd app       && node --test test/*.test.mjs        # ~75, engine + brxlink
cd app       && npm run ui:e2e                     # 75 steps, real MC + 2 HUDs
cd site      && npx playwright test                # ~198, only if you touched the website
```

- **Stale e2e ports.** A killed run leaves a server on 8865–8875 and the next run fails with
  *"something already listens on 8865"* or a mid-suite timeout that looks like a real bug.
  `lsof -nP -iTCP:8860-8875 -sTCP:LISTEN | awk 'NR>1{print $2}' | sort -u | xargs -r kill`
- **The e2e refuses a stale bundle** (*"FATAL: STALE BUNDLE"*). `cd app && npm run build` first.

## 4. Reading a session store — the thing that settles arguments

Every match writes `~/.brx-mcp/mc/session-<id>.sqlite`: `envelopes` (every node message) and
`matches` (config + recap). It has repeatedly beaten recollection, including the operator's and mine.

```python
import sqlite3, json, collections, os
db = os.path.expanduser('~/.brx-mcp/mc/session-XXXX.sqlite')
c  = sqlite3.connect(db)
print(collections.Counter(k for k, in c.execute('select kind from envelopes')))
```

**Which sensor caught each hit** (the question that took a whole evening):
```python
# $HIR tok1 — 0,1,2,3 are ALL headset (it has FOUR), 4 is the gun body.
rows = [json.loads(b) for b, in c.execute("select body from envelopes where kind='hit_taken'")]
print(collections.Counter(r.get('sensor') for r in rows))
```
⚠ **Facts recorded before 2026-09-01 have no `sensor` field, and their `ir_proto` holds the sensor**
— the node read `$HIR` token 1 into the wrong name. There is no version marker; use the date.

**The phone's raw BLE frame ring** (only present if someone hit *Share log*):
```python
txt = ''.join(json.loads(b)['chunk'] for b, in c.execute(
    "select body from envelopes where kind='log_data' order by id"))
```

### Four analysis traps, each of which produced a wrong published conclusion
1. **The frame ring holds only the last 60 frames** and usually ends at teardown. It is evidence of a
   moment, never of a session. "10/10 hits were gun-body" came from it and was wrong.
2. **Split by `match_id`.** A session file holds several matches. A blended "64% of hits were headset"
   mixed a normal match (17%) with a deliberate point-blank test (100%).
3. **`status` envelopes are sampled ~2 s apart.** "Ammo never reached 0" was a sampling artifact; the
   frame ring showed the gun counting down to 0 every time.
4. **Prefer `t_recv`** (MC's own clock) over the phone-supplied `t`, which can be absent or skewed.

## 5. Where things are written down

| what | where |
|---|---|
| Every issue reported from a live session + status | [`field-issues.md`](field-issues.md) |
| Shipped-but-unconfirmed fixes, with what would prove/disprove each | [`verify-together.md`](verify-together.md) |
| The lab notebook — append after every session | [`experiment-log.md`](experiment-log.md) |
| Open work split by machine | [`handoff-post-first-match.md`](handoff-post-first-match.md) |

**Record a refuted theory as loudly as a confirmed one.** In one session `outdoorMode`, daylight, gun
uptime and a whole-session "the domes never fired" were each proposed and then killed by the
operator's own observations. Every one is written down as refuted, with the observation that killed
it, so nobody re-derives them. That is the single most useful habit in this repo.
