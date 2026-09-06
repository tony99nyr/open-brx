# Capture runbook — the MacBook + iPhone jobs

**Five open unknowns are blocked on captures nobody has written down how to take.** This is the
missing plan for them. All of it is **gun-free except G3**, and all of it needs the **MacBook**:
Callsign is iOS-only, and PacketLogger (the BLE tracer) is macOS-only. Batch these for when the Mac
is out — that is the whole reason they keep slipping.

Covers: **P8/R1** (HTTPS API) · **P12** (`$PB*` enums) · **G3** (grenade config) · **C2** (FB re-scrape; was
called R2 here until 2026-09-06, renamed because FOLLOWUPS R2 is the IR emitter power control).

---

## Job 1 — P8/R1: the Callsign HTTPS API  ⭐ highest-yield item on the board

**Why first:** one capture answers **P3** (voice packs), the server-side **weapon stats**, the game
definitions, and the **ability parameters** (durations, radii, cooldowns) that brx-fable searched the
manual for and confirmed are **not there** — they live server-side. **No gun required.**

**Rig:** MacBook + iPhone on the same Wi-Fi.

1. Install a MITM proxy on the Mac — **mitmproxy** (`brew install mitmproxy`) or Proxyman/Charles.
   Start it; note the Mac's LAN IP and the proxy port (mitmproxy defaults to 8080).
2. iPhone → **Settings → Wi-Fi → (i) → Configure Proxy → Manual** → Mac IP + port.
3. On the iPhone browse to **`mitm.it`** → install the iOS cert → then **Settings → General → About →
   Certificate Trust Settings** → enable full trust for it. **Both steps are required**; the second is
   the one everyone forgets and it produces a silent TLS failure that looks like "the app is offline".
4. Open Callsign and exercise the surfaces: log in, open the weapon list, open loadout/perks, change
   the **voice**, browse arenas/games.
5. Save the flows (`mitmproxy` → `w` writes a flow file) and export the JSON bodies.

**Pass:** JSON responses from `/api/v1/callsign/settings`, `voice-profiles`, `arenas/games`.
**If the app refuses to run under proxy** (cert pinning): don't fight it — record that it pins, and fall
back to the BLE-side probes. Pinning would be a real finding, not a failure.

**⚠ Handle as licensed content**: facts and field maps into our docs; raw asset JSON stays out of the
repo under the existing deferred-licensing note (`RAW_ASSETS_NOTE.md`).

---

## Job 2 — P12: `$PB*` playbook enums, re-tested on v4.32

**Why:** the FB capture of the remote-start sequence was on **v4.30** and this behaviour is
version-sensitive. We have partial values (`$PBGAME 0=FFA`, `$PBWEAP 0=M4 AUTO`, `$PBPERK 2=Body Armor`,
`$PBLIVES 2=5`, `$PBTIME 5=Inf`; `$INIT` blocks start) — not the full tables.

**Rig:** MacBook + iPhone + **one gun** (this one does need a tagger) + PacketLogger.

1. Plug the iPhone into the Mac (needs a hub — the Mac has no USB-A). PacketLogger →
   **File → New iOS Trace**. **Confirm lines are scrolling before you do anything.**
2. In Callsign, set up a game and step **one field at a time**, taking a fresh trace per value.
3. **File → Export → btsnoop**, then decode with `python -m brx_mcp.btsnoop <file>`.

**Pass:** a value→meaning table for each `$PB*`, confirmed on v4.32.
**Two traps that have each cost a capture before:** export acts on the **frontmost window** (easy to
re-export an old trace), and a trace that isn't actually recording writes a silently useless file.

---

## Job 3 — G3: the app configuring a grenade
Same PacketLogger rig as Job 2, plus the grenade. Pair it, then change its settings in Callsign.
**Pass:** the exact `$GREN` frame the app sends, with the field values it corresponds to.
**Worth doing even though G8 proved objective modes are button-locked** — it settles what `$GREN`
*does* control (blast type, `channel`, `MaxCount`) and feeds **G9/G10**.

---

## Job 4 — C2: re-scrape the FB group with comments expanded
**No Mac, no gun.** The 2026-08-24 crawl expanded post "See more" but **not** "View more comments" —
so the comment threads, where most of the Q&A lives, were missed.
Method: the Chrome-over-CDP setup in memory (`chrome-cdp-crawling`), clicking "view/more comments" and
reply expanders before extracting. **Pass:** comment threads present for the posts already captured.

---

## The three with no method, and why

| id | unknown | why there's no plan |
|---|---|---|
| **P14** | Is the audio SD card removable? | needs a **teardown** of a working gun. Not worth the risk on a 4-gun fleet until there's a spare — the USB `AUDIO` path already works for sound swaps |
| **G4** | Is grenade `.bin` flashing real? | the assumed method is **dead** (G7: USB-C is power-only, no PROGRAM pin). If it exists it uses an unknown mechanism; nothing to try until someone finds one |
| ~~K3~~ ✅ CLOSED 2026-08-27 (proto 10, MAG 125, credits the corpse) | Headset death-explosion | the mechanism is **expressible today** (`$WEAP` powerType `HeadSetOnly`/`GunAndHead` + `extraHeadsetDamage`); it needs a weapon built and fired, so it belongs in a bench session, not a capture |
