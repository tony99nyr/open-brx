# Capture runbook — how to take a capture, and the jobs still open

**How every protocol fact in this repo was obtained, and how to take the next one.** Part 1 is the
method for each instrument. Part 2 is the open unknowns that need a capture.

Only **one** of the three open jobs needs the **MacBook** (Job 2): Callsign is *effectively* iOS-only
(the Android build installs and opens, but cannot connect a gun or play a game), and PacketLogger
(the BLE tracer) is macOS-only. Job 1 is captured, and Job 3 needs neither a Mac nor a gun. Batch the
Mac work for when the Mac is out — that is the whole reason it keeps slipping.

Jobs covered: **P8** (cloud protocol: captured 2026-09-11, two leftovers) · **G3** (grenade config) ·
the Facebook group re-scrape (called R2 here until 2026-09-06, renamed because FOLLOWUPS R2 is the IR
emitter power control). **The job that stood here until 2026-09-11 (P12, re-testing `$PB*` on v4.32)
is gone:** P12 was answered NEGATIVE on 2026-08-27 — all twelve `$PB*` shapes plus `$INIT` are silent
on v4.32, so the enums cannot be mapped by capture; the values, if anyone still wants them, come out
of P8.

---

## Part 1 — the three instruments

Almost everything we know came from three instruments: BLE HCI captures of the official Callsign app
(iOS via macOS PacketLogger; Android HCI snoop), a VS1838B/ESP32 IR receiver and emitter, and a live
tagger driven one token at a time. Captures decode with `python -m brx_mcp.btsnoop <file>` into `>>`
(host to tagger) and `<<` (tagger to host) transcripts.

### BLE capture on iOS (the one that works)

1. Plug the iPhone into a Mac. Open **PacketLogger** (it ships in Apple's "Additional Tools for
   Xcode" download, not in Xcode itself), then **File → New iOS Trace**. **Confirm lines are
   scrolling before you do anything.**
2. Make sure the tagger's **headset is on and paired**. The app silently drops a headset-less gun and
   you capture nothing. Get the app's connection icon green first.
3. Drive the app: connect, create/join, arm, play, end. For a differential capture change **exactly
   one** setting per trace.
4. **File → Export → btsnoop.** Two traps that have each cost a capture: export acts on the
   *frontmost* window (easy to re-export an old trace), and a trace that was not actually recording
   writes a silently useless file.
5. Decode it:

```bash
python -m brx_mcp.btsnoop capture.btsnoop            # '>> $CLEAR,*' / '<< $LCD,…' with timestamps
python -m brx_mcp.gsetdiff cap5.btsnoop cap6.btsnoop # byte-diff the $GSET/$PSET frames across captures
python -m brx_mcp.weapmap cap14.btsnoop cap15.btsnoop # token x weapon table from annotated captures
```

> **Decoder gotchas.** Apple's btsnoop export uses datalink 1001 (no HCI type byte; the type is in
> the record flags), which decoded to zero frames until it was handled. With two guns in one trace,
> streams must be keyed on the **ACL connection handle** or they merge into garbage silently.

Decoded transcripts live in [`../protocol/captures/`](../protocol/captures/) and the raw traces in
[`../protocol/captures/raw/`](../protocol/captures/raw/).

### BLE capture on Android (partial)

The app rarely holds a connection on Android, so this route yielded the connect ritual and the
version exchange, never a game.

1. Enable **Developer options → Bluetooth HCI snoop log**.
2. Run the app, then `adb bugreport` (5 to 10 minutes; keep the phone still). The btsnoop log rides
   inside.
3. Decode with `python -m brx_mcp.btsnoop`.

### The IR capture rig (ESP32-S3 + VS1838B)

1. A phone camera **cannot** see the ~5 mA IR LED. Judge with the receiver, never a camera.
2. Turn the sketch's per-frame RAW dump **off** (`r`) for any capture that matters. It takes about 15
   to 20 ms at 115200 and truncates the next frame into a prefix.
3. Attenuate at close range. The VS1838B's AGC saturates point-blank. A gun at 1 m decodes cleanly
   where an LED at 5 cm does not.
4. Never fire toward the rig from the gun under test: reflected IR hits your own headset, drains
   armor and kills the player mid-window.
5. Bound the sync to about 1800 to 2200 µs and require 25 bits plus `Z0 != Z1`, or a TV remote will
   decode as a BRX frame.

> **Measurement discipline that mattered.** Check the control *before* reading the result. One
> clean-looking run is not a result: everything that held was measured three times with alternating
> conditions, or came from a human's senses. A host-visible field that correlates with a state is not
> evidence of that state. Damage is a property of the (weapon, victim `$SIR` table) pair, never of
> the weapon alone.

---

## Part 2 — the jobs still open

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

## Job 3 — re-scrape the Facebook group with comments expanded
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
