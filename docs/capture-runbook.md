# Capture runbook — the MacBook + iPhone jobs

**The open unknowns that need a capture nobody has written down how to take.** Two of the three jobs
need the **MacBook**: Callsign is *effectively* iOS-only (the Android build installs and opens, but
cannot connect a gun or play a game), and PacketLogger (the BLE tracer) is macOS-only. Job 3 needs
neither. Batch the Mac jobs for when the Mac is out — that is the whole reason they keep slipping.

Covers: **P8** (cloud protocol: captured 2026-09-11, two leftovers) · **G3** (grenade config) · **C2**
(FB re-scrape; was called R2 here until 2026-09-06, renamed because FOLLOWUPS R2 is the IR emitter
power control). **Job 2 as it stood until 2026-09-11 (P12, re-testing `$PB*` on v4.32) is gone:** P12 was
answered NEGATIVE on 2026-08-27 — all twelve `$PB*` shapes plus `$INIT` are silent on v4.32, so the enums
cannot be mapped by capture; the values, if anyone still wants them, come out of P8.

**⚠ Any job that pairs Callsign to one of OUR guns (Job 2 here) rewrites that gun's `$NAME` to `Tactix2`
on connect** (it bit us 2026-08-25). Finish with `python.exe -m brx_mcp rename` from the armory, and
keep Callsign away from the fleet otherwise.

---

## Job 1 — P8: the Callsign cloud protocol  ✅ captured 2026-09-11 (Mac + WireGuard); two leftovers

**Done:** the whole cloud protocol is decoded (`protocol/callsign-extract/protocol-classes.md`, log
2026-09-11 night). The REST API is **plain HTTP** (OAuth2, hardcoded client secret); the game config does
**not** ride REST, it comes through the **SNS/SQS lobby** as .NET blobs. **P8 is largely resolved, P12 is
moot** (v4.32 ignores `$PB*` and the capture did not carry the enums either).

**What the capture did NOT give, so the job is not closed:**
- the numeric **weapon stat values** — `WeaponSettings` carries names/enum only. Our `weapons.json` and the
  bench-proven `$WEAP` token map stay the source of truth.
- **P3**: `SquadLeaderVoices` in `RoomIsOpenMessage` was empty because no squad voice was set. Re-run =
  set a squad voice in Callsign, re-host, decode. (The per-character map is derivable on-gun since
  A15/B14 anyway; this would only confirm it.)
- the byte layout inside `HitMessage` / `PlayerKilledMessage` / `PlayerGameStatistics`.

**Method that works (re-run recipe).** The iOS system HTTP proxy does NOT work: Callsign is Unity/IL2CPP
and Unity ignores it — login succeeds, nothing reaches the proxy, and it looks like a silent TLS failure.
Capture at the network layer instead:

1. Mac: `brew install mitmproxy`; `mitmweb --mode regular --mode wireguard`.
2. iPhone: install the **WireGuard** app, scan the QR from mitmweb's Capture panel. No Wi-Fi proxy.
3. Cert is still needed for the lobby's TLS (SNS/SQS): browse `mitm.it`, install, then **Settings →
   General → About → Certificate Trust Settings** → full trust. The REST side is plain HTTP and needs none.
4. Drive Callsign: log in, set the squad voice, host, play a short game on two phones, end it.
5. Save the flows; decode; promote facts only.

**⚠ The raw capture is licensed content AND secrets**: it holds a live bearer + refresh token, the client
secret, both phones' IPs and Tony's GPS. Facts and field maps into our docs; raw JSON, tokens and
coordinates never (`RAW_ASSETS_NOTE.md`). Tear down after: tunnel removed, cert profile deleted.
**No gun required.**

---

## Job 2 — G3: the app configuring a grenade

**Rig:** MacBook + iPhone + **one gun** + the grenade + PacketLogger. PacketLogger is not in Xcode
itself: it ships in Apple's **"Additional Tools for Xcode"** download (developer.apple.com/download/all).

1. Plug the iPhone into the Mac (needs a hub — the Mac has no USB-A). PacketLogger →
   **File → New iOS Trace**. **Confirm lines are scrolling before you do anything.**
2. In Callsign, pair the gun (headset on and paired first, or the app silently drops it), pair the
   grenade, then change its settings **one field at a time**, a fresh trace per value.
3. **File → Export → btsnoop**, then decode with `python -m brx_mcp.btsnoop <file>`.
4. **Re-run `rename` on the gun** (see the warning at the top).

**Pass:** the exact `$GREN` frame the app sends, with the field values it corresponds to.
**Priority is low:** G8 proved objective modes are button-locked on the grenade, and hill mode is proven
end to end without this. What it settles is what `$GREN` *does* control (blast type, `channel`,
`MaxCount`) for a paired thrown grenade — it feeds **G9/G10**.
**Two traps that have each cost a capture before:** export acts on the **frontmost window** (easy to
re-export an old trace), and a trace that isn't actually recording writes a silently useless file.

---

## Job 3 — C2: re-scrape the FB group with comments expanded
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
