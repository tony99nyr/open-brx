# Capture runbook — how to take a capture

**How every protocol fact in this repo was obtained, and how to take the next one.** This page is the
method for each instrument. It does not track which capture jobs are still open — that status lives in
`FOLLOWUPS.md` (the "Capture" line under the bench queue, and each job's own row: **P8**, **P12**, **P14**,
**G3**, **G4**, **R2**, and any new one), so it cannot go stale here the way a duplicated job list would.

---

## Part 1 — the three instruments

Almost everything we know came from three instruments: BLE HCI captures of the official Callsign app
(iOS via macOS PacketLogger; Android HCI snoop), a VS1838B/ESP32 IR receiver and emitter, and a live
tagger driven one token at a time. Captures decode with `python -m brx_mcp.btsnoop <file>` into `>>`
(host to tagger) and `<<` (tagger to host) transcripts.

### BLE capture on iOS (the one that works)

0. **Install Apple's Bluetooth logging profile on the iPhone** (Safari on the phone:
   developer.apple.com/bug-reporting/profiles-and-logs → Bluetooth → iOS; Settings → Profile Downloaded →
   Install; restart). **It expires after a few days**, and a lapsed profile gives a trace that opens but
   records nothing (cost a session 2026-09-18). Test: toggle Bluetooth on the phone and watch for lines.
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

## Part 2 — method notes for specific captures

**⚠ Any capture that pairs Callsign to one of OUR guns rewrites that gun's `$NAME` to `Tactix2`
on connect** (it bit us 2026-08-25). Finish with `python.exe -m brx_mcp rename` from the armory, and
keep Callsign away from the fleet otherwise.

### The Callsign cloud protocol (Mac + WireGuard)

The iOS system HTTP proxy does NOT work: Callsign is Unity/IL2CPP and Unity ignores it — login succeeds,
nothing reaches the proxy, and it looks like a silent TLS failure. Capture at the network layer instead:

1. Mac: `brew install mitmproxy`; `mitmweb --mode regular --mode wireguard`.
2. iPhone: install the **WireGuard** app, scan the QR from mitmweb's Capture panel. No Wi-Fi proxy.
3. Cert is still needed for the lobby's TLS (SNS/SQS): browse `mitm.it`, install, then **Settings →
   General → About → Certificate Trust Settings** → full trust. The REST side is plain HTTP and needs none.
4. Drive Callsign: log in, set the squad voice, host, play a short game on two phones, end it.
5. Save the flows; decode; promote facts only.

The REST API is **plain HTTP** (OAuth2, hardcoded client secret); the game config does **not** ride REST,
it comes through the **SNS/SQS lobby** as .NET blobs. Decode target:
`protocol/callsign-extract/protocol-classes.md`.

**⚠ The raw capture is licensed content AND secrets**: it holds a live bearer + refresh token, the client
secret, both phones' IPs and Tony's GPS. Facts and field maps into our docs; raw JSON, tokens and
coordinates never (`RAW_ASSETS_NOTE.md`). Tear down after: tunnel removed, cert profile deleted.
**No gun required.**

### The app configuring a grenade

**Rig:** MacBook + iPhone + **one gun** + the grenade + PacketLogger. PacketLogger is not in Xcode
itself: it ships in Apple's **"Additional Tools for Xcode"** download (developer.apple.com/download/all).

1. Plug the iPhone into the Mac (needs a hub — the Mac has no USB-A). PacketLogger →
   **File → New iOS Trace**. **Confirm lines are scrolling before you do anything.**
2. In Callsign, pair the gun (headset on and paired first, or the app silently drops it), pair the
   grenade, then change its settings **one field at a time**, a fresh trace per value.
3. **File → Export → btsnoop**, then decode with `python -m brx_mcp.btsnoop <file>`.
4. **Re-run `rename` on the gun** (see the warning at the top).

**Pass:** the exact `$GREN` frame the app sends, with the field values it corresponds to.
**Two traps that have each cost a capture before:** export acts on the **frontmost window** (easy to
re-export an old trace), and a trace that isn't actually recording writes a silently useless file.

### Re-scraping a Facebook group with comments expanded

**No Mac, no gun.** A first pass that only expands post "See more" misses the comment threads, where most
of the Q&A lives, so also expand "View more comments". Method: the Chrome-over-CDP setup in memory
(`chrome-cdp-crawling`), clicking "view/more comments" and reply expanders before extracting.
**Pass:** comment threads present for every post already captured.

---

Whether any of this still needs doing — and the current state of **P8**, **P12**, **P14**, **G3**, **G4**
and **R2** — is `FOLLOWUPS.md`'s job, not this page's; see its "Capture" line under the bench queue.
